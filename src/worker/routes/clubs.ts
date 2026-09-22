// 教练侧：凭认证码绑定俱乐部 + 我的球队概览（附录 A〔1〕，§3.2 照比赛系统 coach/bind 模式）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { rateLimit } from '../../lib/ratelimit.ts';
import { assertPublicRate, cachedJson, waitUntilOf } from '../../lib/guard.ts';
import { ttlForScope } from '../../lib/cache-policy.ts';
import { writeAudit } from '../../lib/audit.ts';
import { authBindTeam, AuthApiError } from '../authClient.ts';
import { getBoundClub } from '../binding.ts';
import { deriveClubTier, deriveClubTiers } from '../tier.ts';
import { loadAttendanceModel, loadTierTable, playerInfluenceSum, teamInfluence } from '../home.ts';
import { createConfigService } from '../../core/config.ts';
import { expandStadium, upgradeStadiumTier, upgradeFacilityLevel, loadFacilityPrices, loadBalance, FACILITY_KEYS } from '../stadium-ops.ts';
import { quoteBrands, signNaming, terminateNaming, getActiveNaming, loadNamingParams } from '../naming-ops.ts';
import { getVisibleSeason } from '../seasons.ts';

const app = new Hono<{ Bindings: Env }>();

// 俱乐部目录（🌐 公开）：球员库筛选下拉用，只出 id/名称/级别，不含经营数据
// 增量 23：公开 GET 挂进程内限流（60/min/IP）+ TTL SWR 缓存
// 增量 28：缓存走分级策略（scope='clubs'，兜底 24h）——固定键、载荷 1KB，写路径 purge 能精确失效
app.get('/clubs/directory', async (c) => {
  assertPublicRate(c, 'clubs-directory');
  const data = await cachedJson(
    'clubs:directory',
    ttlForScope('clubs', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const rows = await c.env.DB.prepare(
        `SELECT id, name, league_tier FROM clubs WHERE status = 'active' ORDER BY name`,
      ).all<{ id: number; name: string; league_tier: string }>();
      return { clubs: rows.results };
    },
    { scope: 'clubs', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
});

// 球队页列表（🌐 公开，增量 31）：全平台 active 俱乐部的四项指标 + 分级 + 队徽。
// 省 D1 额度在三处：① 阵容聚合一条语句算全平台（实测 1,032 行——`club_id IS NOT NULL` 被
// SQLite 改写成范围扫 `club_id > ?`，天然跳过 17,731 条 NULL，所以不需要部分索引）；
// ② club → tour team 映射与队徽各一条批量查询（20 + 40 行），不逐队查；
// ③ 分级走 deriveClubTiers 集合派生（src/worker/tier.ts），不是 20 次 deriveClubTier。
// 冷算约 1,100–1,200 行，证据：scripts/d1-read-audit/clubs-measurements.json。
//
// 训练营口径 = `players.status = 'trainee'`（写入在 routes/registration.ts，读取在 routes/market.ts）。
const CLUB_SQUAD_AGG_SQL = `SELECT p.club_id,
         COUNT(*) AS squad,
         SUM(CASE WHEN p.status = 'trainee' THEN 1 ELSE 0 END) AS trainee,
         AVG(p.ca) AS avg_ca,
         SUM(COALESCE(p.market_value, 0)) AS total_value,
         SUM(COALESCE(ct.wage, 0)) AS total_wage
  FROM players p LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
  WHERE p.club_id IS NOT NULL
  GROUP BY p.club_id`;

interface ClubRow {
  id: number;
  name: string;
  is_cpu: number;
  league_tier: string | null;
}
interface SquadAggRow {
  club_id: number;
  squad: number;
  trainee: number;
  avg_ca: number | null;
  total_value: number | null;
  total_wage: number | null;
}

// club_id → tour_team_id（AUTH_DB 批量，实测 20 行）。队徽与分级派生共用这一份映射：
// 逐队查的话每队都要扫 team 全表 20 行，20 队就是 400 行。
async function loadClubTourTeams(env: Env): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!env.AUTH_DB) return out;
  const rows = await env.AUTH_DB.prepare('SELECT club_id, tour_team_id AS tid FROM team WHERE club_id IS NOT NULL')
    .all<{ club_id: number; tid: number | null }>();
  for (const r of rows.results) if (typeof r.tid === 'number') out.set(r.club_id, r.tid);
  return out;
}

// 队徽：本平台 `clubs.logo_key` 全仓无人**写**（写侧在比赛系统），虽然 `GET /me/club` 会读出来渲染，
// 但没有任何入口能给它赋值 ⇒ 球队页一律取比赛系统 `team.logo_key`（生产 20/20 覆盖）。
// 返回 tour_team_id → key，路由再经上面的映射折回 club_id。
async function loadTeamLogos(env: Env, tourTeamIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (env.TOUR_DB === undefined || tourTeamIds.length === 0) return out;
  const ph = tourTeamIds.map(() => '?').join(', ');
  const rows = await env.TOUR_DB.prepare(`SELECT id, logo_key FROM team WHERE id IN (${ph})`)
    .bind(...tourTeamIds)
    .all<{ id: number; logo_key: string | null }>();
  for (const r of rows.results) if (r.logo_key) out.set(r.id, r.logo_key);
  return out;
}

// 公开球队列表（增量 31）：一屏 20 队，一次算完 —— 固定 4 条 whl-club 语句 + AUTH_DB/TOUR_DB 各 1~2 条，无逐队查询。
// tier 与 logo 派生自比赛系统（AUTH_DB.team / TOUR_DB.entry / TOUR_DB.team），那边改数据本 worker 收不到写事件、
// 无从 purge ⇒ 最长陈旧 clubs scope 的 TTL（24h）。这是外源派生数据的已知代价，要即时生效只能等 TTL 过期。
app.get('/clubs', async (c) => {
  assertPublicRate(c, 'clubs-list');
  const data = await cachedJson(
    'clubs:list',
    ttlForScope('clubs', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const [season, clubRows, aggRows] = await Promise.all([
        getVisibleSeason(c.env.DB),
        c.env.DB.prepare(
          `SELECT id, name, is_cpu, league_tier FROM clubs WHERE status = 'active' ORDER BY name`,
        ).all<ClubRow>(),
        c.env.DB.prepare(CLUB_SQUAD_AGG_SQL).all<SquadAggRow>(),
      ]);

      const tourTeams = await loadClubTourTeams(c.env);
      const clubIds = clubRows.results.map((r) => r.id);
      // 只查可见（active）俱乐部对应的 tour team：退役俱乐部若还留着映射，不必白查一条
      const visibleTourTeamIds = clubIds
        .map((id) => tourTeams.get(id))
        .filter((tid): tid is number => typeof tid === 'number');
      const [logos, tiers] = await Promise.all([
        loadTeamLogos(c.env, visibleTourTeamIds),
        deriveClubTiers(c.env, season, clubIds, tourTeams),
      ]);

      const agg = new Map(aggRows.results.map((r) => [r.club_id, r]));
      return {
        clubs: clubRows.results.map((cl) => {
          const a = agg.get(cl.id);
          const squad = a?.squad ?? 0;
          const trainee = a?.trainee ?? 0;
          const tourTeamId = tourTeams.get(cl.id);
          return {
            id: cl.id,
            name: cl.name,
            isCpu: cl.is_cpu === 1,
            tier: tiers.get(cl.id) ?? null,
            logoKey: (tourTeamId === undefined ? undefined : logos.get(tourTeamId)) ?? null,
            squad: { senior: squad - trainee, trainee },
            avgCa: a?.avg_ca == null ? null : Math.round(a.avg_ca * 10) / 10,
            totalValue: a?.total_value ?? 0,
            totalWage: a?.total_wage ?? 0,
          };
        }),
      };
    },
    { scope: 'clubs', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
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
    namingBrand: string | null;
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
    const naming = await getActiveNaming(c.env.DB, club.id);
    home = {
      name: stadium.name,
      namingBrand: naming?.brand ?? null,
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

// 设施经营（增量 19）：build-info 一次拉全预览数据；扩建/升级操作即批即记账
app.get('/club/stadium/build-info', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const stadium = await c.env.DB
    .prepare('SELECT club_id, capacity, tier, build_credit FROM stadiums WHERE club_id = ?')
    .bind(club.id)
    .first<{ club_id: number; capacity: number; tier: number; build_credit: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const [tierTable, prices] = await Promise.all([loadTierTable(c.env.DB), loadFacilityPrices(c.env.DB)]);
  const config = createConfigService(c.env.DB);
  const maxOpenTier = (await config.getNumber('stadium_max_open_tier')) ?? 1;
  const refundRatio = (await config.getNumber('voucher_refund')) ?? 0.25;
  const tierEntry = tierTable[String(stadium.tier)];
  const nextEntry = tierTable[String(stadium.tier + 1)];
  const facilities = await c.env.DB
    .prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ? ORDER BY facility_key')
    .bind(club.id)
    .all<{ facility_key: string; level: number }>();
  const levelOf = (key: string) => facilities.results.find((f) => f.facility_key === key)?.level ?? 0;
  const balance = await loadBalance(c.env.DB, club.id);
  return c.json({
    credit: stadium.build_credit,
    balance,
    expansionPer100: prices.expansionPer100,
    maxOpenTier,
    refundRatio,
    tier: {
      level: stadium.tier,
      name: tierEntry?.name ?? null,
      capacity: stadium.capacity,
      minSeats: tierEntry?.min_seats ?? null,
      maxSeats: tierEntry?.max_seats ?? null,
    },
    nextTier: nextEntry
      ? {
          name: nextEntry.name,
          minSeats: nextEntry.min_seats,
          upgradeCost: tierEntry?.upgrade_cost ?? null,
          open: stadium.tier + 1 <= maxOpenTier,
          capacityOk: stadium.capacity >= nextEntry.min_seats,
        }
      : null,
    facilities: FACILITY_KEYS.map((key) => {
      const level = levelOf(key);
      return { key, level, nextCost: level >= 5 ? null : (prices.upgradeCosts[level] ?? null) };
    }),
  });
});

app.post('/club/stadium/expand', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const body = (await c.req.raw.json().catch(() => null)) as { seats?: unknown } | null;
  const out = await expandStadium(c.env, club.id, Number(body?.seats));
  return c.json(out, 201);
});

app.post('/club/stadium/upgrade', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const out = await upgradeStadiumTier(c.env, club.id);
  return c.json(out, 201);
});

app.post('/club/facilities/upgrade', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const body = (await c.req.raw.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== 'string') throw new HttpError(400, '缺设施类型');
  const out = await upgradeFacilityLevel(c.env, club.id, body.key);
  return c.json(out, 201);
});

// 冠名市场（增量 20）：报价按本队队况逐品牌现算；合同费用条款签约时快照锁定
function namingContractDto(row: NonNullable<Awaited<ReturnType<typeof getActiveNaming>>>) {
  return {
    id: row.id,
    clubId: row.club_id,
    brand: row.brand,
    baseFee: row.base_fee,
    packageNo: row.package_no,
    pkgName: row.pkg_name,
    feePerWindow: row.fee_per_window,
    windowsTotal: row.windows_total,
    windowsRemaining: row.windows_remaining,
    bonusAmount: row.bonus_amount,
    betAttend: row.bet_attend,
    betFans: row.bet_fans,
    status: row.status,
    startedSeason: row.started_season,
    startedWindow: row.started_window,
  };
}

app.get('/club/naming/quote', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const contract = await getActiveNaming(c.env.DB, club.id);
  if (contract) return c.json({ contract: namingContractDto(contract) });
  const stadium = await c.env.DB
    .prepare('SELECT capacity, fans FROM stadiums WHERE club_id = ?')
    .bind(club.id)
    .first<{ capacity: number; fans: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const params = await loadNamingParams(c.env.DB);
  return c.json({ brands: quoteBrands(params, stadium.capacity, stadium.fans) });
});

app.post('/club/naming/sign', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const body = (await c.req.raw.json().catch(() => null)) as { brand?: unknown; packageNo?: unknown } | null;
  if (typeof body?.brand !== 'string') throw new HttpError(400, '缺品牌');
  const contract = await signNaming(c.env, club.id, body.brand, Number(body?.packageNo));
  return c.json({ contract: namingContractDto(contract) }, 201);
});

app.post('/club/naming/terminate', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const out = await terminateNaming(c.env, club.id);
  return c.json(out, 201);
});

export default app;
