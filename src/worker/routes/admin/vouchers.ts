// 管理端 · 消费券发放（v6.58.0）：按俱乐部批量发券，逐笔进券账 + 一条发放审计。
// 与「建设支出返还」共用同一本券账（voucherMovement），券只能抵扣、不可转账兑现。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement } from '../../../lib/audit.ts';
import { voucherMovement } from '../../voucher.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 批量发券：body `{ clubIds?: number[], all?: boolean, amount: number, note: string, requestId?: string }`。
 * - clubIds 与 all 二选一；all = 全部俱乐部（上限天然 = 俱乐部总数）。
 * - amount > 0（round2 到分）；note 必填（发放入口无备注等于无凭据）。
 * - requestId 可选（≤64 字符）：同一 requestId 重发只入账一次（前端每次提交生成新 id，
 *   网络重试复用同一 id）；不带 requestId 时按「管理员主动发放」处理，允许重复发放。
 * - 每次真实入账各留一条 voucher_grant 审计。
 */
app.post('/vouchers/grant', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await readJson(c)) as
    | { clubIds?: unknown; all?: unknown; amount?: unknown; note?: unknown; requestId?: unknown }
    | null;
  if (!body) throw new HttpError(400, '缺请求体');
  const amountRaw = Number(body.amount);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) throw new HttpError(400, 'amount 必须是大于 0 的数');
  const amount = round2(amountRaw);
  if (amount <= 0) throw new HttpError(400, 'amount 太小小到四舍五入后为 0');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) throw new HttpError(400, 'note 必填');
  const requestIdRaw = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (requestIdRaw !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(requestIdRaw)) {
    throw new HttpError(400, 'requestId 只能由字母/数字/下划线/短横组成（≤64）');
  }
  const requestId = requestIdRaw === '' ? null : requestIdRaw;

  let clubIds: number[];
  if (body.all === true) {
    // CPU 队不是平台俱乐部（无绑定教练，也不参与建设/消费），发券只会制造无人花的余额
    const rows = await c.env.DB.prepare('SELECT id FROM clubs WHERE is_cpu = 0 ORDER BY id').all<{ id: number }>();
    clubIds = rows.results.map((r) => r.id);
  } else {
    if (!Array.isArray(body.clubIds) || body.clubIds.length === 0) throw new HttpError(400, 'clubIds 必须是非空数组（或传 all: true）');
    const ids = body.clubIds.map((v) => Number(v));
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, 'clubIds 里有非法俱乐部 id');
    clubIds = [...new Set(ids)];
  }
  if (clubIds.length === 0) throw new HttpError(400, '没有可发放的俱乐部');
  const placeholders = clubIds.map(() => '?').join(', ');
  const existing = await c.env.DB.prepare(`SELECT id FROM clubs WHERE id IN (${placeholders})`).bind(...clubIds).all<{ id: number }>();
  const found = new Set(existing.results.map((r) => r.id));
  const missing = clubIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(404, `俱乐部不存在：${missing.join(', ')}`);

  // 分片写：每家 3 条语句（账户 upsert / 流水 / 审计），40 家 = 120 条/批，避免一次 batch
  // 随俱乐部数无限增长；某片失败时前面的片已入账，同 requestId 重试按 payload 幂等补齐。
  const GRANT_CHUNK = 40;
  let granted = 0;
  for (let i = 0; i < clubIds.length; i += GRANT_CHUNK) {
    const chunk = clubIds.slice(i, i + GRANT_CHUNK);
    const statements: D1PreparedStatement[] = [];
    const auditIndexes: number[] = [];
    for (const clubId of chunk) {
      statements.push(
        ...voucherMovement(c.env.DB, {
          clubId,
          delta: amount,
          kind: 'admin_grant',
          refType: requestId === null ? 'admin' : `admin:${requestId}`,
          refId: user.id,
          memo: `管理组发放消费券：${note}`,
          idempotent: requestId === null ? false : true,
        }),
      );
      // 审计逐个俱乐部落：守卫只看「本家流水真的写了没」（上一条语句的 changes()），
      // 幂等重放（同 requestId 已发过）时这一家不留第二条审计。
      statements.push(
        createAuditStatement(c.env.DB)({
          actor: user.id,
          action: 'voucher_grant',
          targetType: 'voucher',
          targetId: null,
          origin: 'user',
          after: { clubId, amount, note, requestId },
          guardSql: 'changes() > 0',
        }),
      );
      auditIndexes.push(statements.length - 1);
    }
    const outs = await c.env.DB.batch(statements);
    for (const idx of auditIndexes) {
      if ((outs[idx]?.meta.changes ?? 0) > 0) granted += 1;
    }
  }
  return c.json({ granted, replayed: clubIds.length - granted, amount, total: round2(amount * granted) }, 201);
});

export default app;
