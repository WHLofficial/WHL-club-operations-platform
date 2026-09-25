// 管理端 · 财政域：期初余额导入（§14.1）/ 手动记账兜底（§7.1、§9.1）/ M0 货币监控
// （原 admin.ts 财政域，v2.1.0 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement } from '../../../lib/audit.ts';
import { ledgerMovement } from '../../ledger.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// ---- 期初余额导入（§14.1，kind=opening_import；幂等：已导入的俱乐部跳过） ----

app.post('/ledger/opening-import', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await readJson(c)) as { rows?: unknown } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'rows 应为非空数组');
  if (rows.length > 500) throw new HttpError(400, '单次最多 500 行');

  const parsed = rows.map((r, i) => {
    const item = r as { clubId?: unknown; balance?: unknown } | null;
    const clubId = Number(item?.clubId);
    const balance = Number(item?.balance);
    if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, `第 ${i + 1} 行：俱乐部 ID 不对`);
    if (!Number.isFinite(balance) || balance < 0) throw new HttpError(400, `第 ${i + 1} 行：余额须为非负数值`);
    if (balance > 1e9) throw new HttpError(400, `第 ${i + 1} 行：余额超出合理范围`);
    return { clubId, balance };
  });
  const seen = new Set<number>();
  for (const r of parsed) {
    if (seen.has(r.clubId)) throw new HttpError(400, '同一俱乐部在一批里出现了多次');
    seen.add(r.clubId);
  }

  const ids = [...seen];
  const found = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rowsFound = await c.env.DB.prepare(`SELECT id FROM clubs WHERE id IN (${placeholders})`)
      .bind(...slice)
      .all<{ id: number }>();
    for (const f of rowsFound.results) found.add(f.id);
  }
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(400, `这些俱乐部还不存在：${missing.join('、')}`);

  const imported = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rowsDone = await c.env.DB.prepare(
      `SELECT DISTINCT club_id FROM ledger_entries WHERE kind = 'opening_import' AND club_id IN (${placeholders})`,
    )
      .bind(...slice)
      .all<{ club_id: number }>();
    for (const r of rowsDone.results) imported.add(r.club_id);
  }
  const todo = parsed.filter((r) => !imported.has(r.clubId));
  const audit = createAuditStatement(c.env.DB);
  if (todo.length > 0) {
    const statements = todo.flatMap((r) => [
      c.env.DB.prepare(
        `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, ?, ${nowSql()})
         ON CONFLICT(club_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
      ).bind(r.clubId, r.balance),
      c.env.DB.prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at)
         VALUES (?, 'opening_import', ?, ?, '期初余额导入', ${nowSql()})`,
      ).bind(r.clubId, r.balance, r.balance),
    ]);
    statements.push(
      audit({
        actor: user.id,
        action: 'ledger_opening_import',
        targetType: 'ledger',
        after: { written: todo.length, skipped: parsed.length - todo.length },
      }),
    );
    await c.env.DB.batch(statements); // 流水 + 余额 + 审计一个 batch 提交（§7.4-1）
  }
  return c.json({ written: todo.length, skipped: parsed.length - todo.length });
});

// ---- 手动记账兜底（§7.1 manual_adjust / prize_*，P0 奖金模板入口；§9.1） ----

const MANUAL_KIND_RE = /^(manual_adjust|prize_[a-z_]+)$/;

app.post('/ledger/manual', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await readJson(c)) as { clubId?: unknown; kind?: unknown; amount?: unknown; memo?: unknown } | null;
  const clubId = Number(body?.clubId);
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const kind = typeof body?.kind === 'string' ? body.kind.trim() : '';
  if (!MANUAL_KIND_RE.test(kind)) throw new HttpError(400, '流水类型只能是 manual_adjust 或 prize_*');
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, '金额要是不为 0 的数字（正入账负出账）');
  if (kind !== 'manual_adjust' && amount < 0) {
    throw new HttpError(400, '奖金只能入账，要冲账请选「手动调整」走负数');
  }
  const memo = typeof body?.memo === 'string' ? body.memo.trim() : '';
  if (!memo) throw new HttpError(400, '备注要写清楚这笔钱的来由，方便以后对账');
  if (memo.length > 200) throw new HttpError(400, '备注最多 200 字');

  const club = await c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '找不到这支俱乐部');

  // manual 允许重复记（兜底工具，审计逐笔留痕），不走 (kind, ref) 幂等闸
  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    ...ledgerMovement(c.env.DB, {
      clubId,
      delta: amount,
      kind,
      refType: 'manual',
      refId: null,
      memo,
      idempotent: false,
    }),
    audit({
      actor: user.id,
      action: 'ledger_manual',
      targetType: 'club',
      targetId: clubId,
      after: { kind, amount, memo },
    }),
  ]);
  const acct = await c.env.DB.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?')
    .bind(clubId)
    .first<{ balance: number }>();
  return c.json({ ok: true, balance: acct?.balance ?? 0 }, 201);
});

// ---- M0 货币监控（PRD：M0 = Σ俱乐部余额报表，观察通胀；附录 A〔6〕🛡） ----

app.get('/m0', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const [m0, held, kinds, clubs] = await Promise.all([
    c.env.DB.prepare('SELECT COALESCE(SUM(balance), 0) AS m0 FROM ledger_accounts').first<{ m0: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS held FROM fund_holds WHERE status = 'held'").first<{ held: number }>(),
    c.env.DB.prepare('SELECT kind, SUM(amount) AS total, COUNT(*) AS n FROM ledger_entries GROUP BY kind ORDER BY total LIMIT 30').all<{
      kind: string;
      total: number;
      n: number;
    }>(),
    c.env.DB.prepare(
      `SELECT c.id, c.name, COALESCE(a.balance, 0) AS balance
       FROM clubs c LEFT JOIN ledger_accounts a ON a.club_id = c.id
       ORDER BY a.balance DESC, c.id LIMIT 200`,
    ).all<{ id: number; name: string; balance: number }>(),
  ]);
  return c.json({
    m0: m0?.m0 ?? 0,
    held: held?.held ?? 0,
    available: (m0?.m0 ?? 0) - (held?.held ?? 0),
    byKind: kinds.results,
    byClub: clubs.results,
  });
});

export default app;
