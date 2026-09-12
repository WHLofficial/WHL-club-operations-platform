// 教练侧：凭认证码绑定俱乐部 + 我的球队概览（附录 A〔1〕，§3.2 照比赛系统 coach/bind 模式）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { rateLimit } from '../../lib/ratelimit.ts';
import { sha256Hex } from '../../lib/crypto.ts';
import { createAuditStatement } from '../../lib/audit.ts';
import { getBoundClub } from '../binding.ts';

const app = new Hono<{ Bindings: Env }>();

app.post('/clubs/bind', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  // 按 IP 限尝试次数：10 分钟窗口 5 次（正常输入一次就成功，够防爆破）
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  const ok = await rateLimit(c.env.SESSION_KV, `bindfail:${ip}`, 5, 600);
  if (!ok) throw new HttpError(429, '尝试太频繁，请 10 分钟后再来');

  const body = (await c.req.raw.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code || code.length !== 8) {
    throw new HttpError(400, '认证码格式不对，应为 8 位字母数字');
  }

  const hash = await sha256Hex(code);
  const row = await c.env.DB.prepare(
    `SELECT id, club_id FROM club_bind_code
     WHERE code_hash = ? AND used_by IS NULL
       AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  )
    .bind(hash)
    .first<{ id: number; club_id: number }>();
  if (!row) throw new HttpError(400, '认证码无效或已过期');

  // 一账号一队先查再插：查不出已绑时不烧码，提示更友好
  const existing = await c.env.DB.prepare('SELECT club_id FROM club_bindings WHERE user_id = ?')
    .bind(user.id)
    .first<{ club_id: number }>();
  if (existing) throw new HttpError(409, '该账号已经绑定了俱乐部，解绑需联系管理组');

  // 条件烧码防并发重复使用（两个请求同码竞速，只有一个能改到行）
  const burn = await c.env.DB.prepare(
    `UPDATE club_bind_code SET used_by = ?, used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND used_by IS NULL`,
  )
    .bind(user.id, row.id)
    .run();
  if ((burn.meta.changes ?? 0) !== 1) throw new HttpError(400, '认证码无效或已过期');

  try {
    const audit = createAuditStatement(c.env.DB);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      ).bind(row.club_id, user.id),
      audit({
        actor: user.id,
        action: 'club_bind',
        targetType: 'club',
        targetId: row.club_id,
        after: { userId: user.id },
      }),
    ]);
  } catch {
    throw new HttpError(409, '该账号已经绑定了俱乐部，解绑需联系管理组');
  }
  return c.json({ ok: true, clubId: row.club_id }, 201);
});

// 我的球队概览（余额/名单数/窗口态）；窗口态在增量 6 落地，此前恒为 null
app.get('/me/club', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.league_tier, c.logo_key, c.status
     FROM club_bindings b JOIN clubs c ON c.id = b.club_id
     WHERE b.user_id = ?`,
  )
    .bind(user.id)
    .first<{ id: number; name: string; league_tier: string; logo_key: string | null; status: string }>();
  if (!club) {
    return c.json({ club: null, balance: null, squadCount: null, window: null });
  }
  const [account, roster, win] = await Promise.all([
    c.env.DB.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?')
      .bind(club.id)
      .first<{ balance: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?')
      .bind(club.id)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT season, window_seq FROM season_windows WHERE status = 'open' ORDER BY id DESC LIMIT 1",
    ).first<{ season: number; window_seq: number }>(),
  ]);
  return c.json({
    club: {
      id: club.id,
      name: club.name,
      leagueTier: club.league_tier,
      logoKey: club.logo_key,
      status: club.status,
    },
    balance: account?.balance ?? 0,
    squadCount: roster?.n ?? 0,
    window: win ? { season: win.season, windowSeq: win.window_seq } : null,
  });
});

// 财政余额（附录 A〔6〕）：余额 / 冻结 / 可支配，口径与出价校验一致（§7.4）
app.get('/club/balance', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, balance: null, held: null, available: null });
  const row = await c.env.DB.prepare(
    `SELECT (SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = ?) AS balance,
            (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = ? AND status = 'held') AS held`,
  )
    .bind(club.id, club.id)
    .first<{ balance: number; held: number }>();
  const balance = row?.balance ?? 0;
  const held = row?.held ?? 0;
  return c.json({ club: { id: club.id, name: club.name }, balance, held, available: balance - held });
});

// 流水账（附录 A〔6〕）：新→旧倒序翻页，cursor=上一页最后一条的 id；hard LIMIT+1 探下一页
const LEDGER_PAGE_SIZE = 30;

app.get('/club/ledger', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, entries: [], nextCursor: null });

  const conditions = ['club_id = ?'];
  const args: unknown[] = [club.id];
  const kind = c.req.query('kind');
  if (kind !== undefined && kind !== '') {
    if (!/^[a-z_]+$/.test(kind)) throw new HttpError(400, '流水类型不对');
    conditions.push('kind = ?');
    args.push(kind);
  }
  const cursor = c.req.query('cursor');
  if (cursor !== undefined) {
    const n = Number(cursor);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'cursor 不对');
    conditions.push('id < ?');
    args.push(n);
  }
  args.push(LEDGER_PAGE_SIZE + 1);
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, amount, balance_after, ref_type, ref_id, memo, created_at
     FROM ledger_entries WHERE ${conditions.join(' AND ')}
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(...args)
    .all<{
      id: number;
      kind: string;
      amount: number;
      balance_after: number;
      ref_type: string | null;
      ref_id: number | null;
      memo: string | null;
      created_at: string;
    }>();
  const hasMore = rows.results.length > LEDGER_PAGE_SIZE;
  const page = hasMore ? rows.results.slice(0, LEDGER_PAGE_SIZE) : rows.results;
  return c.json({
    club: { id: club.id, name: club.name },
    entries: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      amount: r.amount,
      balanceAfter: r.balance_after,
      refType: r.ref_type,
      refId: r.ref_id,
      memo: r.memo,
      createdAt: r.created_at,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  });
});

export default app;
