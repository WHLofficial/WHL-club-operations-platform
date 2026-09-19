// 教练侧：凭认证码绑定俱乐部 + 我的球队概览（附录 A〔1〕，§3.2 照比赛系统 coach/bind 模式）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { rateLimit } from '../../lib/ratelimit.ts';
import { writeAudit } from '../../lib/audit.ts';
import { authBindTeam, AuthApiError } from '../authClient.ts';
import { getBoundClub } from '../binding.ts';
import { deriveClubTier } from '../tier.ts';
import { loadAttendanceModel, loadTierTable, playerInfluenceSum, teamInfluence } from '../home.ts';
import { getVisibleSeason } from '../seasons.ts';

const app = new Hono<{ Bindings: Env }>();

// 俱乐部目录（🌐 公开）：球员库筛选下拉用，只出 id/名称/级别，不含经营数据
app.get('/clubs/directory', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, league_tier FROM clubs WHERE status = 'active' ORDER BY name`,
  ).all<{ id: number; name: string; league_tier: string }>();
  return c.json({ clubs: rows.results });
});

app.post('/clubs/bind', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  // 按 IP 限尝试次数：10 分钟窗口 5 次（正常输入一次就成功，够防爆破）
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  const ok = await rateLimit(c.env.SESSION_KV, `bindfail:${ip}`, 5, 600);
  if (!ok) throw new HttpError(429, '尝试太频繁，请 10 分钟后再来');

  const body = (await c.req.raw.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code || code.length !== 8) {
    throw new HttpError(400, '认证码格式不对，应为 8 位字母数字');
  }

  // 烧码在 auth 认证中心单事务原子完成（增量 7：中央码表 team_bind_code + team_binding）；
  // 本地 club_bind_code 表休眠（保留防回滚，不再读写）
  try {
    await authBindTeam(c.env, { code, accountId: user.id });
  } catch (e) {
    if (e instanceof AuthApiError) {
      if (e.code === 'invalid_code') throw new HttpError(400, '认证码无效或已过期');
      if (e.code === 'already_bound') throw new HttpError(409, '该账号已经绑定了俱乐部，解绑需联系管理组');
      throw new HttpError(502, '认证中心暂不可用，请稍后再试');
    }
    throw e;
  }

  // 绑定成功后按目录解析本侧俱乐部（目录行在发码时已按 club_id 关联）
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(502, '绑定已完成，但俱乐部目录尚未关联，请联系管理组');

  // 本地审计只记事实（绑定真源在 auth 库）
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_bind',
    targetType: 'club',
    targetId: club.id,
    after: { userId: user.id },
  });
  return c.json({ ok: true, clubId: club.id }, 201);
});

// 我的球队概览（余额/名单数/窗口态）；窗口态在增量 6 落地，此前恒为 null
app.get('/me/club', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const bound = await getBoundClub(c.env, user.id);
  if (!bound) {
    return c.json({ club: null, balance: null, squadCount: null, window: null });
  }
  const club = await c.env.DB.prepare(
    `SELECT id, name, logo_key, status, transfer_banned FROM clubs WHERE id = ?`,
  )
    .bind(bound.id)
    .first<{ id: number; name: string; logo_key: string | null; status: string; transfer_banned: number }>();
  if (!club) {
    return c.json({ club: null, balance: null, squadCount: null, window: null });
  }
  const [account, roster, win, tier] = await Promise.all([
    c.env.DB.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?')
      .bind(club.id)
      .first<{ balance: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?')
      .bind(club.id)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT season, window_seq FROM season_windows WHERE status = 'open' ORDER BY id DESC LIMIT 1",
    ).first<{ season: number; window_seq: number }>(),
    // 增量 9：级别由报名派生（§3.2 改判），休眠列不再回显
    deriveClubTier(c.env, await getVisibleSeason(c.env.DB), club.id),
  ]);
  // 增量 12：主场档案（球场/设施/影响力构成）随 /me/club 一并下发（无球场行=null）
  const stadium = await c.env.DB
    .prepare('SELECT name, capacity, tier, shell_influence, bonus_points, fans FROM stadiums WHERE club_id = ?')
    .bind(club.id)
    .first<{ name: string | null; capacity: number; tier: number; shell_influence: number; bonus_points: number; fans: number }>();
  let home: {
    name: string | null;
    capacity: number;
    tier: number;
    tierName: string | null;
    fans: number;
    influence: { players: number; shell: number; bonus: number; total: number };
    facilities: { key: string; level: number }[];
  } | null = null;
  if (stadium) {
    const model = await loadAttendanceModel(c.env.DB);
    const playerSum = await playerInfluenceSum(c.env, club.id, model);
    const facilities = await c.env.DB
      .prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ? ORDER BY facility_key')
      .bind(club.id)
      .all<{ facility_key: string; level: number }>();
    const tierTable = await loadTierTable(c.env.DB);
    home = {
      name: stadium.name,
      capacity: stadium.capacity,
      tier: stadium.tier,
      tierName: tierTable[String(stadium.tier)]?.name ?? null,
      fans: stadium.fans,
      influence: { players: playerSum, shell: stadium.shell_influence, bonus: stadium.bonus_points, total: teamInfluence(stadium, playerSum) },
      facilities: facilities.results.map((f) => ({ key: f.facility_key, level: f.level })),
    };
  }
  return c.json({
    club: {
      id: club.id,
      name: club.name,
      leagueTier: tier,
      logoKey: club.logo_key,
      status: club.status,
      transferBanned: club.transfer_banned === 1,
    },
    balance: account?.balance ?? 0,
    squadCount: roster?.n ?? 0,
    window: win ? { season: win.season, windowSeq: win.window_seq } : null,
    home,
  });
});

// 财政余额（附录 A〔6〕）：余额 / 冻结 / 可支配，口径与出价校验一致（§7.4）
app.get('/club/balance', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
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
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
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
