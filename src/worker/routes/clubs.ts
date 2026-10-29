// 教练侧：凭认证码绑定俱乐部 + 我的球队概览（附录 A〔1〕，§3.2 照比赛系统 coach/bind 模式）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach, requireUser } from '../../lib/session.ts';
import { rateLimit } from '../../lib/ratelimit.ts';
import { assertPublicRate, cachedJson, waitUntilOf } from '../../lib/guard.ts';
import { ttlForScope } from '../../lib/cache-policy.ts';
import { writeAudit } from '../../lib/audit.ts';
import { authBindTeam, AuthApiError } from '../authClient.ts';
import { getBoundClub } from '../binding.ts';
import { loadClubTourTeams, loadTeamLogos } from '../club-logos.ts';
import { deriveClubTier, deriveClubLeagues, deriveClubTiers } from '../tier.ts';
import { closedRegularTicks } from '../contract-ticks.ts';
import { POSITION_BY_ID, POSITION_GROUP_BY_POSITION, POSITION_GROUPS } from '../../core/fc26.ts';
import { loadAttendanceModel, loadTierTable, playerInfluenceSum, teamInfluence, influenceTierCoef, loadInfluenceTierCoefs } from '../home.ts';
import { createConfigService } from '../../core/config.ts';
import { balanceSnapshot } from '../ledger.ts';
import { rowDisplayName, sqlDisplayName } from '../../core/player-name.ts';
import { expandStadium, upgradeStadiumTier, upgradeFacilityLevel, loadFacilityPrices, loadBalance, FACILITY_KEYS, facilityCapForTier } from '../stadium-ops.ts';
import { voucherBalance } from '../voucher.ts';
import { quoteBrands, terminateNaming, renewNaming, getActiveNaming, loadNamingParams, loadAdoptedBrands, loadIndustryFactors, loadTierProfiles, composeVenueName, venueNameOf, parseBetTerms } from '../naming-ops.ts';
import { acceptOffer, activateQueuedStatements, listClubOffers } from '../market-ops.ts';
import { queueClubNotification } from '../notify.ts';
import { getOpenWindow, getVisibleSeason } from '../seasons.ts';
import { listBookings, loadActivityCatalog, loadVenueContext, venueSlotStatement, type ActivityCatalog, type VenueBookingRow } from '../venue-ops.ts';
import {
  ATTEND_MOD_MAX,
  ATTEND_MOD_MIN,
  activityUnlockReason,
  quotePlan,
  recommendPlan,
  slotsForCapacity,
  type VenueActivityDef,
  type VenuePlanPick,
  type VenuePolicy,
  type VenueSlotQuote,
  type VenueTotals,
} from '../../core/venue.ts';
import { assertOpOpen } from '../ops-schedule.ts';
import { listClubEvents, parseEventOptions, resolveEvent } from '../event-ops.ts';

const app = new Hono<{ Bindings: Env }>();

// 俱乐部目录（🌐 公开）：球员库筛选下拉用，只出 id/名称/级别，不含经营数据
// v2.8.1：公开 GET 挂进程内限流（60/min/IP）+ TTL SWR 缓存
// v3.2.0：缓存走分级策略（scope='clubs'，兜底 24h）——固定键、载荷 1KB，写路径 purge 能精确失效
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

// 球队页列表（🌐 公开，v3.4.0）：全平台 active 俱乐部的四项指标 + 分级 + 队徽。
// 省 D1 额度在三处：① 阵容聚合一条语句算全平台（实测 1,032 行——`club_id IS NOT NULL` 被
// SQLite 改写成范围扫 `club_id > ?`，天然跳过 17,731 条 NULL，所以不需要部分索引）；
// ② club → tour team 映射与队徽各一条批量查询（20 + 40 行），不逐队查；
// ③ 分级走 deriveClubTiers 集合派生（src/worker/tier.ts），不是 20 次 deriveClubTier。
// 冷算约 1,100–1,200 行，证据：scripts/d1-read-audit/clubs-measurements.json。
//
// 训练营口径 = `players.status = 'trainee'`（写入在 routes/registration.ts，读取在 routes/market.ts）。
//
// 身价不套 COALESCE：`players.market_value` 是运营列（只有 admin PATCH 会写，导入永不触碰），
// 生产 18,301 行全是 NULL ⇒ 全 NULL 时 SUM 出 NULL，前端照球员库的规矩显示「—」。套 COALESCE
// 会把它压成 0，页面就变成「每支球队身价都是 0.00 m」这种假话（2026-09-22 上线后回读发现）。
const CLUB_SQUAD_AGG_SQL = `SELECT p.club_id,
         COUNT(*) AS squad,
         SUM(CASE WHEN p.status = 'trainee' THEN 1 ELSE 0 END) AS trainee,
         AVG(p.ca) AS avg_ca,
         SUM(p.market_value) AS total_value,
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

// 公开球队列表（v3.4.0）：一屏 20 队，一次算完 —— 固定 4 条 whl-club 语句 + AUTH_DB/TOUR_DB 各 1~2 条，无逐队查询。
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
            totalValue: a?.total_value ?? null,
            totalWage: a?.total_wage ?? 0,
          };
        }),
      };
    },
    { scope: 'clubs', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
});

// ---- 球队详情（v3.4.0，🔒 需登录）----

// 单队 club_id → tour_team_id（AUTH_DB 一条）。列表用批量版 loadClubTourTeams；详情只查自己那一条。
async function loadClubTourTeam(env: Env, clubId: number): Promise<number | null> {
  if (!env.AUTH_DB) return null;
  const row = await env.AUTH_DB.prepare('SELECT tour_team_id AS tid FROM team WHERE club_id = ?')
    .bind(clubId)
    .first<{ tid: number | null }>();
  return typeof row?.tid === 'number' ? row.tid : null;
}

// 阵容一条语句取全队（走 idx_players_club_ca，生产实测 61–75 行，随队规模），位置/年龄/CA 三个维度的分布与全部合计
// 都在 JS 里算：分布要按三个维度分组，SQL 里得三条 GROUP BY（≈183 行），JS 算只要那 61 行。
// 名单不在详情里出——前端复用 GET /api/players?club_id=N（那个读面已有索引与缓存）。
const CLUB_SQUAD_ROWS_SQL = `SELECT p.id, p.position, p.age, p.ca, p.pa, p.status, p.market_value,
         p.badges_silver, p.badges_gold,
         ct.id AS contract_id, ct.wage, ct.protection_ticks, ct.service_ticks
  FROM players p LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
  WHERE p.club_id = ?`;

interface ClubSquadRow {
  id: number;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  status: string;
  market_value: number | null;
  badges_silver: number | null;
  badges_gold: number | null;
  contract_id: number | null;
  wage: number | null;
  protection_ticks: number | null;
  service_ticks: number | null;
}

interface Band {
  key: string;
  label: string;
  min: number;
  max: number;
}

// 分档口径只在这里定义一次，前端只画图（不在前端再分一次档，否则两处会漂）。
// 年龄（v3.4.0 步骤 11a，用户裁决）：等宽 3 岁箱 + 竖直直方图 ⇒ 两端开口档、中间四档等宽。
// 代价是「成长年龄上限」（当季 seasons.age_cap，生产 25）不再是档界——直方图的前提是等宽箱，
// 为守住一个档界把箱宽拉成 19 岁反而会让面积读错。
const AGE_BANDS: readonly Band[] = [
  { key: 'u18', label: '≤18', min: 0, max: 18 },
  { key: '19-21', label: '19–21', min: 19, max: 21 },
  { key: '22-24', label: '22–24', min: 22, max: 24 },
  { key: '25-27', label: '25–27', min: 25, max: 27 },
  { key: '28-30', label: '28–30', min: 28, max: 30 },
  { key: '31+', label: '≥31', min: 31, max: 999 },
];
// CA：档界取 70/80/84/90，与游戏自己的「能力等级」阶梯对齐（src/core/negotiation-rules.ts 的
// ratingLevel 十档档界是 60/65/70/75/80/84/87/90/93，也是谈判等级与身价/工资的定价依据）。
// 所以 CA 用横向条形图讲「档位」而不是用直方图讲「数值分箱」——这些档不等宽（70–79 宽 10，
// 80–84 宽 5），画直方图会让人把面积读错。档序由高到低，与条形图的排行语义一致。
const CA_BANDS: readonly Band[] = [
  { key: '90+', label: '90+', min: 90, max: 999 },
  { key: '85-89', label: '85–89', min: 85, max: 89 },
  { key: '80-84', label: '80–84', min: 80, max: 84 },
  { key: '70-79', label: '70–79', min: 70, max: 79 },
  { key: 'u70', label: '<70', min: 0, max: 69 },
];
// 效力是 0.5 的整数倍（1 常规窗 = 0.5 赛季），所以档位之间留的空档取不到值。
// v6.38.1：label 的「赛季」统一改「年」（用户裁决：效力时间的「年」语义同赛季，全仓文案统一）；
// min/max 阈值与 key 都不动（tests/clubs-detail.test.ts 只按 key 数 count，不锁 label）。
const YEARS_BANDS: readonly Band[] = [
  { key: 'le05', label: '0.5 年内', min: 0, max: 0.5 },
  { key: '1-15', label: '1–1.5 年', min: 1, max: 1.5 },
  { key: '2-25', label: '2–2.5 年', min: 2, max: 2.5 },
  { key: '3+', label: '3 年及以上', min: 3, max: 999 },
];

function bandCounts(rows: ClubSquadRow[], value: (r: ClubSquadRow) => number | null, bands: readonly Band[]): Array<{ key: string; label: string; count: number }> {
  const out = bands.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  for (const r of rows) {
    const v = value(r);
    if (v === null) continue;
    const i = bands.findIndex((b) => v >= b.min && v <= b.max);
    if (i >= 0) out[i].count += 1;
  }
  return out;
}

function mean1(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

// 转会记录：与 /api/players/:id/transfers 同一形状（LEFT JOIN clubs 双别名 + 同一排序），
// 球队维度按转入/转出各取 10 条，并补球员名（球队页只看到金额没有意义）。
const CLUB_TRANSFER_SQL = (side: 'from' | 'to') => `SELECT t.id, t.type, t.player_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
         t.from_club_id, fc.name AS from_club_name, t.to_club_id, tc.name AS to_club_name,
         t.fee, t.extra_fee, t.season, t.window_seq, t.completed_at
  FROM transfers t
  LEFT JOIN clubs fc ON fc.id = t.from_club_id
  LEFT JOIN clubs tc ON tc.id = t.to_club_id
  LEFT JOIN players p ON p.id = t.player_id
  WHERE t.${side}_club_id = ? AND t.status = 'completed'
  ORDER BY (t.completed_at IS NULL), t.completed_at DESC, t.id DESC
  LIMIT 10`;

interface ClubTransferRow {
  id: number;
  type: string;
  player_id: number | null;
  player_fc_id: number | null;
  player_name: string | null;
  from_club_id: number | null;
  from_club_name: string | null;
  to_club_id: number | null;
  to_club_name: string | null;
  fee: number | null;
  extra_fee: number | null;
  season: number | null;
  window_seq: number | null;
  completed_at: string | null;
}

// 近期战绩：平台已确认赛果（快照表，无索引但全表 69 行，该 OR 查询实测读 76 行，可忽略）。
// ⚠️ home_team_id / away_team_id 存的是**比赛系统队 id**（迁移 0017），不是 club id——这里绑的是 tourTeamId。
// v6.6.3 起统一口径：home.ts 的 clubFormPts 也只认 tour 队 id（此前绑 club id 靠两套 id 逐队相等的巧合命中）。
const CLUB_FORM_SQL = `SELECT match_id, season, competition_type, stage_name, round,
         home_team_id, away_team_id, home_team, away_team,
         score_home, score_away, pen_home, pen_away, walkover_side, finished_at
  FROM result_confirmations
  WHERE home_team_id = ? OR away_team_id = ?
  ORDER BY (finished_at IS NULL), finished_at DESC, id DESC
  LIMIT 5`;

interface ClubFormRow {
  match_id: number;
  season: number;
  competition_type: string | null;
  stage_name: string | null;
  round: number | null;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team: string | null;
  away_team: string | null;
  score_home: number | null;
  score_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  walkover_side: string | null;
  finished_at: string | null;
}

// 90 分钟口径的胜平负：点球决胜不改判定（与 src/worker/home.ts 的 formPtsOf 同口径——「90 分钟平分
// 就是平，点球胜负只影响淘汰赛晋级/奖金」），另给 penHome/penAway 让前端标注。
// 弃权判负按 walkover_side 定：''=普通场、home/away=该侧弃权判负、both=双弃权双方各记一场负
// （与比赛系统 worker/lib/standings.ts 的口径一致）。
function matchResultOf(r: ClubFormRow, tourTeamId: number): 'win' | 'draw' | 'loss' | null {
  const isHome = r.home_team_id === tourTeamId;
  const ourSide = isHome ? 'home' : 'away';
  if (r.walkover_side === 'both') return 'loss';
  if (r.walkover_side === 'home' || r.walkover_side === 'away') {
    return r.walkover_side === ourSide ? 'loss' : 'win';
  }
  const ours = isHome ? r.score_home : r.score_away;
  const theirs = isHome ? r.score_away : r.score_home;
  if (ours === null || theirs === null) return null;
  if (ours > theirs) return 'win';
  if (ours < theirs) return 'loss';
  return 'draw';
}

// 球队详情（🔒 需登录，裁决 Q1）：队头 + 阵容结构 + 合同结构 + 转会往来 + 近期战绩。
// 不含财政与主场（那两块在自家队中心 /me/club），也不含名单（前端复用 /api/players?club_id=N）。
// 载荷与用户无关（教练区块由前端另取 /api/me/club 判断），所以能按 clubs scope 共享缓存。
app.get('/clubs/:id', async (c) => {
  await requireUser(c.env, c.req.raw);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '球队 ID 不对');

  const data = await cachedJson(
    `clubs:detail:${id}`,
    ttlForScope('clubs', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const club = await c.env.DB.prepare(
        `SELECT id, name, is_cpu, league_tier FROM clubs WHERE id = ? AND status = 'active'`,
      )
        .bind(id)
        .first<ClubRow>();
      if (!club) throw new HttpError(404, '球队不存在');

      const [season, tourTeamId, ticks, squad] = await Promise.all([
        getVisibleSeason(c.env.DB),
        loadClubTourTeam(c.env, id),
        closedRegularTicks(c.env.DB),
        c.env.DB.prepare(CLUB_SQUAD_ROWS_SQL).bind(id).all<ClubSquadRow>(),
      ]);

      const leagues = await deriveClubLeagues(
        c.env,
        season,
        [id],
        tourTeamId === null ? new Map<number, number>() : new Map([[id, tourTeamId]]),
      );
      const logos = tourTeamId === null ? new Map<number, string>() : await loadTeamLogos(c.env, [tourTeamId]);

      const [incoming, outgoing, form] = await Promise.all([
        c.env.DB.prepare(CLUB_TRANSFER_SQL('to')).bind(id).all<ClubTransferRow>(),
        c.env.DB.prepare(CLUB_TRANSFER_SQL('from')).bind(id).all<ClubTransferRow>(),
        tourTeamId === null
          ? Promise.resolve({ results: [] as ClubFormRow[] })
          : c.env.DB.prepare(CLUB_FORM_SQL).bind(tourTeamId, tourTeamId).all<ClubFormRow>(),
      ]);

      const rows = squad.results;
      const trainee = rows.filter((r) => r.status === 'trainee').length;
      const caValues = rows.map((r) => r.ca).filter((v): v is number => typeof v === 'number');
      const paValues = rows.map((r) => r.pa).filter((v): v is number => typeof v === 'number');
      // 成长空间 = pa − ca，只算还有空间的人（pa 缺或已到顶的不进平均，否则会拉低「空间」的含义）
      const growthValues = rows
        .filter((r) => typeof r.pa === 'number' && typeof r.ca === 'number' && r.pa > r.ca)
        .map((r) => (r.pa as number) - (r.ca as number));
      const contracted = rows.filter((r) => r.contract_id !== null);
      // 效力（赛季）= 0.5 × (已关常规窗数 − 签约基数)，与球员库/档案页同一公式（含 trainee 的
      // service_ticks 为 NULL ⇒ 基数按 0 算，见 src/worker/routes/players.ts 的 years 表达式）
      const yearsOf = (r: ClubSquadRow) => (r.contract_id === null ? null : (ticks - (r.service_ticks ?? 0)) * 0.5);
      const yearsValues = contracted.map(yearsOf).filter((v): v is number => v !== null);
      const wageValues = contracted.map((r) => r.wage).filter((v): v is number => typeof v === 'number');
      // 身价与列表同一口径：一个人都没录过身价时给 null（前端显示「—」），不假装是 0
      const valueValues = rows.map((r) => r.market_value).filter((v): v is number => typeof v === 'number');

      // 位置四档（v3.4.0 步骤 11a）：四档恒出（「0 门将」本身就是要看见的信号），档内明细按
      // POSITION_BY_ID 的细位顺序给非零项。未知/空位置另起一档，不混进四档里。
      const byPosition = POSITION_GROUPS.map((g) => {
        const inGroup = rows.filter((r) => r.position !== null && POSITION_GROUP_BY_POSITION[r.position] === g.key);
        const detail = Object.values(POSITION_BY_ID)
          .filter((p) => POSITION_GROUP_BY_POSITION[p] === g.key)
          .map((position) => ({ position, count: inGroup.filter((r) => r.position === position).length }))
          .filter((x) => x.count > 0)
          .map((x) => `${x.position} ${x.count}`)
          .join(' · ');
        return { key: g.key, label: g.label, count: inGroup.length, detail };
      });
      const unknownPosition = rows.filter((r) => r.position === null || POSITION_GROUP_BY_POSITION[r.position] === undefined).length;
      if (unknownPosition > 0) byPosition.push({ key: 'unknown', label: '未知', count: unknownPosition, detail: '' });

      const recent = form.results.map((r) => ({
        matchId: r.match_id,
        season: r.season,
        competitionType: r.competition_type,
        stageName: r.stage_name,
        round: r.round,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        scoreHome: r.score_home,
        scoreAway: r.score_away,
        penHome: r.pen_home,
        penAway: r.pen_away,
        result: tourTeamId === null ? null : matchResultOf(r, tourTeamId),
        finishedAt: r.finished_at,
      }));
      const transferDto = (r: ClubTransferRow) => ({
        id: r.id,
        type: r.type,
        playerId: r.player_id,
        playerFcId: r.player_fc_id,
        playerName: r.player_name,
        fromClubId: r.from_club_id,
        fromClubName: r.from_club_name,
        toClubId: r.to_club_id,
        toClubName: r.to_club_name,
        fee: r.fee,
        extraFee: r.extra_fee,
        season: r.season,
        windowSeq: r.window_seq,
        completedAt: r.completed_at,
      });

      return {
        club: {
          id: club.id,
          name: club.name,
          isCpu: club.is_cpu === 1,
          tier: leagues.get(id)?.tier ?? null,
          logoKey: (tourTeamId === null ? undefined : logos.get(tourTeamId)) ?? null,
        },
        squad: {
          size: rows.length,
          senior: rows.length - trainee,
          trainee,
          avgCa: mean1(caValues),
          maxCa: caValues.length === 0 ? null : Math.max(...caValues),
          avgPa: mean1(paValues),
          avgGrowth: mean1(growthValues),
          totalValue: valueValues.length === 0 ? null : valueValues.reduce((a, b) => a + b, 0),
          totalWage: contracted.reduce((a, r) => a + (r.wage ?? 0), 0),
          avgWage: mean1(wageValues),
          badgesSilver: rows.reduce((a, r) => a + (r.badges_silver ?? 0), 0),
          badgesGold: rows.reduce((a, r) => a + (r.badges_gold ?? 0), 0),
          byPosition,
          byAge: bandCounts(rows, (r) => r.age, AGE_BANDS),
          byCa: bandCounts(rows, (r) => r.ca, CA_BANDS),
        },
        contracts: {
          signed: contracted.length,
          unprotected: contracted.length - contracted.filter((r) => r.protection_ticks !== null && ticks < r.protection_ticks).length,
          protectedCount: contracted.filter((r) => r.protection_ticks !== null && ticks < r.protection_ticks).length,
          avgYears: mean1(yearsValues),
          byYears: bandCounts(contracted, yearsOf, YEARS_BANDS),
        },
        transfers: { incoming: incoming.results.map(transferDto), outgoing: outgoing.results.map(transferDto) },
        form: {
          recent,
          wins: recent.filter((r) => r.result === 'win').length,
          draws: recent.filter((r) => r.result === 'draw').length,
          losses: recent.filter((r) => r.result === 'loss').length,
        },
      };
    },
    { scope: 'clubs', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
});

// 排名代理（🔒 需登录）：比赛系统公开积分榜 GET /api/public/tournaments/:id/standings 自带边缘缓存
// 300s，但名次是「积分 → 净胜球 → 进球 → 相互战绩」多阶段破同分的计算结果
// （比赛系统 worker/lib/standings.ts 的 readStageStandings）——**不可复刻**，所以只代理不重算。
//
// 为什么单独一个端点而不是塞进详情载荷：详情按 clubs scope 缓存 24h（它全是慢变数据），
// 积分榜赛季中天天变，塞进去会被冻住 24h。
//
// 该积分榜 DTO **不带 team id**（只有 teamName/teamLogoUrl，且 rank 字段恒为 0 —— 名次只能按已排好的
// 行序取下标），所以按名字认队：名字取 TOUR_DB `team.name`，与积分榜读的是同一张表同一列，
// 不依赖平台自己的 clubs.name（平台改名不该影响认队）。
const STANDING_TTL_MS = 300_000; // 与比赛系统 pubCache(300) 同频
const STANDING_TIMEOUT_MS = 3_000; // 超时即降级：详情页不该为排名卡住
// 上游响应体上限：超时只给了 3 秒时间窗，3 秒内照样能灌进很大的 JSON。比赛系统是自家上游，
// 但排名区块是详情页里唯一的外部输入，异常/被污染的响应不该把 worker 的内存吃掉。
const STANDING_MAX_BYTES = 2 * 1024 * 1024;

/** 排名取不到（超时/非 2xx/网络错）——抛出它就不会把失败结果写进缓存 */
class StandingUnavailable extends Error {}

// 覆盖开关（PUBLIC_CACHE_TTL_MS）只用于测试/联调：显式给数（含 0=旁路）就照它；
// 生产不配 ⇒ 300s，**不吃** clubs scope 的 24h 兜底。导出仅为让测试直接钉住这个 300s
// ——集成测试观察不到 TTL 差异（都是「第二次请求不打上游」），改坏了也照样绿。
export function standingTtl(env: Env): number {
  return env.PUBLIC_CACHE_TTL_MS === undefined ? STANDING_TTL_MS : ttlForScope('clubs', env.PUBLIC_CACHE_TTL_MS);
}

interface StandingDto {
  tournamentId: number;
  stageName: string | null;
  groupName: string | null;
  position: number;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  pts: number | null;
  pointsDeducted: number | null;
}

// 从积分榜响应里挑出这支球队所在的第一行（阶段按比赛系统给的顺序，先出现的先取）。
// 响应形状是外部契约，逐层 typeof 校验：形状变了只让排名区块降级，不能让详情页 500。
function pickStanding(body: unknown, teamName: string, tournamentId: number): StandingDto | null {
  const stages = (body as { standings?: unknown } | null)?.standings;
  if (!Array.isArray(stages)) return null;
  for (const stage of stages) {
    const groups = (stage as { groups?: unknown } | null)?.groups;
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const rows = (group as { rows?: unknown } | null)?.rows;
      if (!Array.isArray(rows)) continue;
      const index = rows.findIndex((r) => (r as { teamName?: unknown } | null)?.teamName === teamName);
      if (index < 0) continue;
      const row = rows[index] as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === 'number' ? v : null);
      const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
      return {
        tournamentId,
        stageName: str((stage as { name?: unknown }).name),
        groupName: str((group as { name?: unknown }).name),
        position: index + 1,
        played: num(row.played),
        won: num(row.won),
        drawn: num(row.drawn),
        lost: num(row.lost),
        goalsFor: num(row.goalsFor),
        goalsAgainst: num(row.goalsAgainst),
        pts: num(row.pts),
        pointsDeducted: num(row.pointsDeducted),
      };
    }
  }
  return null;
}

async function loadStanding(env: Env, clubId: number): Promise<{ standing: StandingDto | null; note: string | null }> {
  const club = await env.DB.prepare(`SELECT id, name FROM clubs WHERE id = ? AND status = 'active'`)
    .bind(clubId)
    .first<{ id: number; name: string }>();
  if (!club) throw new HttpError(404, '球队不存在');

  const season = await getVisibleSeason(env.DB);
  const tourTeamId = await loadClubTourTeam(env, clubId);
  if (tourTeamId === null || env.TOUR_DB === undefined) return { standing: null, note: '本赛季暂无联赛排名' };

  // 当季定级赛事就是该队联赛所在的那座（口径与分级派生同一份，见 deriveClubLeagues）
  const leagues = await deriveClubLeagues(env, season, [clubId], new Map([[clubId, tourTeamId]]));
  const tournamentId = leagues.get(clubId)?.tournamentId ?? null;
  if (tournamentId === null) return { standing: null, note: '本赛季暂无联赛排名' };

  const team = await env.TOUR_DB.prepare('SELECT name FROM team WHERE id = ?').bind(tourTeamId).first<{ name: string }>();
  const teamName = team?.name ?? club.name;

  const base = (env.TOUR_API_BASE ?? '').replace(/\/+$/, '');
  const url = `${base}/api/public/tournaments/${tournamentId}/standings`;
  let body: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(STANDING_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`比赛系统积分榜返回 ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > STANDING_MAX_BYTES) {
      throw new Error(`积分榜响应过大（${declared} 字节）`);
    }
    const text = await res.text();
    if (text.length > STANDING_MAX_BYTES) throw new Error(`积分榜响应过大（${text.length} 字节）`);
    body = JSON.parse(text) as unknown;
  } catch (e) {
    console.warn(`[clubs] 排名代理失败（${url}）：${e instanceof Error ? e.message : String(e)}`);
    throw new StandingUnavailable('排名暂不可用');
  }

  const standing = pickStanding(body, teamName, tournamentId);
  return standing ? { standing, note: null } : { standing: null, note: '本赛季暂无联赛排名' };
}

app.get('/clubs/:id/standing', async (c) => {
  await requireUser(c.env, c.req.raw);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '球队 ID 不对');
  // 未配比赛系统基址：排名区块整体降级，一个库都不查（前端显示「排名暂不可用」）
  if (!c.env.TOUR_API_BASE) return c.json({ standing: null, note: '排名暂不可用' });

  try {
    const data = await cachedJson(
      `clubs:standing:${id}`,
      standingTtl(c.env),
      () => loadStanding(c.env, id),
      { scope: 'clubs', env: c.env, ctx: waitUntilOf(c) },
    );
    return c.json(data);
  } catch (e) {
    // 取不到就不缓存（cachedJson 里 loader 抛错不会落缓存），前端照常渲染其余区块
    if (e instanceof StandingUnavailable) return c.json({ standing: null, note: e.message });
    throw e;
  }
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

  // 烧码在 auth 认证中心单事务原子完成（v1.0.0：中央码表 team_bind_code + team_binding）；
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
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(502, '绑定已完成，但俱乐部目录尚未关联，请联系管理组');

  // 本地审计只记事实（绑定真源在 auth 库）
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_bind',
    targetType: 'club',
    targetId: club.id,
    origin: 'user',
    after: { userId: user.id },
  });
  return c.json({ ok: true, clubId: club.id }, 201);
});

// 我的球队概览（余额/名单数/窗口态）；窗口态在v0.7.0 落地，此前恒为 null
app.get('/me/club', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const bound = await getBoundClub(c.env, user.id, c.req.raw);
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
    // v1.2.0：级别由报名派生（§3.2 改判），休眠列不再回显
    deriveClubTier(c.env, await getVisibleSeason(c.env.DB), club.id),
  ]);
  // v1.5.0：主场档案（球场/设施/影响力构成）随 /me/club 一并下发（无球场行=null）
  const stadium = await c.env.DB
    .prepare('SELECT name, capacity, tier, shell_influence, bonus_points, fans FROM stadiums WHERE club_id = ?')
    .bind(club.id)
    .first<{ name: string | null; capacity: number; tier: number; shell_influence: number; bonus_points: number; fans: number }>();
  let home: {
    name: string | null;
    namingBrand: string | null;
    namingVenueName: string | null;
    capacity: number;
    tier: number;
    tierName: string | null;
    fans: number;
    influence: { players: number; shell: number; bonus: number; tierCoef: number; total: number };
    facilities: { key: string; level: number }[];
  } | null = null;
  if (stadium) {
    const model = await loadAttendanceModel(c.env.DB);
    const playerSum = await playerInfluenceSum(c.env, club.id, model);
    // v6.28.0 A 段：级别系数来自 config；级别复用上面 Promise.all 里已派生的 tier（未定级 → 1.0）
    const tierCoef = influenceTierCoef(await loadInfluenceTierCoefs(c.env.DB), tier);
    const facilities = await c.env.DB
      .prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ? ORDER BY facility_key')
      .bind(club.id)
      .all<{ facility_key: string; level: number }>();
    const tierTable = await loadTierTable(c.env.DB);
    const naming = await getActiveNaming(c.env.DB, club.id);
    home = {
      name: stadium.name,
      namingBrand: naming?.brand ?? null,
      // v6.51.0 批 1：落点名用合同快照，老合同（空快照）按现球场名现拼；无冠名 null
      namingVenueName: naming ? venueNameOf(naming.venue_name, naming.brand, stadium.name) : null,
      capacity: stadium.capacity,
      tier: stadium.tier,
      tierName: tierTable[String(stadium.tier)]?.name ?? null,
      fans: stadium.fans,
      influence: {
        players: playerSum,
        shell: stadium.shell_influence,
        bonus: stadium.bonus_points,
        tierCoef,
        total: teamInfluence(stadium, playerSum, tierCoef),
      },
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

// 财政余额（附录 A〔6〕）：余额 / 冻结 / 预期收入 / 额度 / 可支配，口径与出价校验一致（§7.4）
// v6.57.0：公式统一走 ledger.ts（availableBalance 同一额度式），不再在端点里手写 balance − held
app.get('/club/balance', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) {
    return c.json({ club: null, balance: null, held: null, available: null, expectedIncome: null, creditLine: null });
  }
  const snapshot = await balanceSnapshot(c.env.DB, club.id);
  return c.json({ club: { id: club.id, name: club.name }, ...snapshot });
});

// 流水账（附录 A〔6〕）：新→旧倒序翻页，cursor=上一页最后一条的 id；hard LIMIT+1 探下一页
const LEDGER_PAGE_SIZE = 30;

app.get('/club/ledger', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
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

// 消费券流水（v6.58.0）：与账本同形（新→旧倒序、cursor 翻页），读 voucher_entries
app.get('/club/vouchers', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
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
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, amount, balance_after, ref_type, ref_id, memo, created_at
     FROM voucher_entries WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ${LEDGER_PAGE_SIZE + 1}`,
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
    balance: await voucherBalance(c.env.DB, club.id),
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

// 候选名单（v6.58.0，FM shortlist 语义）：俱乐部私有的球员跟踪名单，任何状态球员都能收。
// 上限走 config shortlist_cap（默认 30、界 0–100）；入队用 SQL 守卫同时拦重复与超限，
// 不靠「先 COUNT 再 INSERT」的读改写（并发两次同球员只落一条）。
const SHORTLIST_DEFAULT_CAP = 30;
const SHORTLIST_NOTE_MAX = 200;

function shortlistCapClamp(n: number | null): number {
  if (n === null || !Number.isFinite(n)) return SHORTLIST_DEFAULT_CAP;
  return Math.min(100, Math.max(0, Math.floor(n)));
}

async function shortlistContext(c: { env: Env; req: { raw: Request } }) {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再用候选名单');
  return { user, club };
}

app.get('/club/shortlist', async (c) => {
  const { club } = await shortlistContext(c);
  const cap = shortlistCapClamp(await createConfigService(c.env.DB).getNumber('shortlist_cap'));
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.player_id, s.note, s.created_at,
            p.display_name, p.name, p.position, p.age, p.ca, p.pa, p.market_value, p.club_id, p.status, p.fc_id,
            pc.name AS club_name
     FROM player_shortlist s
     JOIN players p ON p.id = s.player_id
     LEFT JOIN clubs pc ON pc.id = p.club_id
     WHERE s.club_id = ?
     ORDER BY s.id DESC LIMIT 200`,
  )
    .bind(club.id)
    .all<{
      id: number;
      player_id: number;
      note: string | null;
      created_at: string;
      display_name: string | null;
      name: string;
      position: string | null;
      age: number | null;
      ca: number | null;
      pa: number | null;
      market_value: number | null;
      club_id: number | null;
      status: string | null;
      fc_id: number | null;
      club_name: string | null;
    }>();
  return c.json({
    clubId: club.id,
    cap,
    items: rows.results.map((r) => ({
      id: r.id,
      playerId: r.player_id,
      note: r.note,
      createdAt: r.created_at,
      player: {
        name: rowDisplayName(r),
        position: r.position,
        age: r.age,
        ca: r.ca,
        pa: r.pa,
        marketValue: r.market_value,
        clubId: r.club_id,
        clubName: r.club_name,
        status: r.status,
        fcId: r.fc_id,
      },
    })),
  });
});

// 登录态小端点：球员库星标列数据源。公开列表是两级缓存，绝不能把 per-user 星标混进去。
app.get('/club/shortlist/ids', async (c) => {
  const { club } = await shortlistContext(c);
  const rows = await c.env.DB.prepare('SELECT id, player_id FROM player_shortlist WHERE club_id = ? ORDER BY id DESC')
    .bind(club.id)
    .all<{ id: number; player_id: number }>();
  return c.json({
    clubId: club.id,
    playerIds: rows.results.map((r) => r.player_id),
    // 行 id 供球员页「移出」直接 DELETE /club/shortlist/:id（v6.58.0）
    entries: rows.results.map((r) => ({ id: r.id, playerId: r.player_id })),
  });
});

app.post('/club/shortlist', async (c) => {
  const { user, club } = await shortlistContext(c);
  const body = (await c.req.raw.json().catch(() => null)) as { playerId?: unknown; note?: unknown } | null;
  const playerId = Number(body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 必须是正整数');
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (note.length > SHORTLIST_NOTE_MAX) throw new HttpError(400, `备注最多 ${SHORTLIST_NOTE_MAX} 字`);
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  const cap = shortlistCapClamp(await createConfigService(c.env.DB).getNumber('shortlist_cap'));
  const res = await c.env.DB.prepare(
    `INSERT INTO player_shortlist (club_id, player_id, note, added_by, created_at)
     SELECT ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE (SELECT COUNT(*) FROM player_shortlist WHERE club_id = ?) < ?
       AND NOT EXISTS (SELECT 1 FROM player_shortlist WHERE club_id = ? AND player_id = ?)`,
  )
    .bind(club.id, playerId, note || null, user.id, club.id, cap, club.id, playerId)
    .run();
  if ((res.meta.changes ?? 0) === 0) {
    const dup = await c.env.DB.prepare('SELECT 1 AS x FROM player_shortlist WHERE club_id = ? AND player_id = ?')
      .bind(club.id, playerId)
      .first();
    if (dup) throw new HttpError(409, '这名球员已经在候选名单里');
    throw new HttpError(409, cap <= 0 ? '候选名单上限为 0（功能未开启）' : `候选名单最多 ${cap} 人`);
  }
  const item = await c.env.DB.prepare('SELECT id, player_id, note, created_at FROM player_shortlist WHERE id = ?')
    .bind(Number(res.meta.last_row_id))
    .first<{ id: number; player_id: number; note: string | null; created_at: string }>();
  return c.json(
    { item: item ? { id: item.id, playerId: item.player_id, note: item.note, createdAt: item.created_at } : null },
    201,
  );
});

app.patch('/club/shortlist/:id', async (c) => {
  const { club } = await shortlistContext(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { note?: unknown } | null;
  if (!body || !('note' in body)) throw new HttpError(400, '缺 note');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > SHORTLIST_NOTE_MAX) throw new HttpError(400, `备注最多 ${SHORTLIST_NOTE_MAX} 字`);
  const res = await c.env.DB.prepare('UPDATE player_shortlist SET note = ? WHERE id = ? AND club_id = ?')
    .bind(note || null, id, club.id)
    .run();
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(404, '候选名单里没有这条记录');
  return c.json({ ok: true, id, note: note || null });
});

app.delete('/club/shortlist/:id', async (c) => {
  const { club } = await shortlistContext(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id 不对');
  const res = await c.env.DB.prepare('DELETE FROM player_shortlist WHERE id = ? AND club_id = ?').bind(id, club.id).run();
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(404, '候选名单里没有这条记录');
  return c.json({ ok: true, id });
});

// 近期主场战报（v6.7.0，B1）：match_attendance（迁移 0018）此前没有任何读端点，教练在页面上
// 看不到每场主场的天气/上座/票务/商业/转播。attendance 行只在「本队是主队」时写入（home.ts 确认钩子④），
// 所以对手恒为 away_team_id；比分/弃权/点球从 result_confirmations 取（match_id UNIQUE，JOIN 不放大行）。
const HOME_MATCHES_LIMIT = 10;

app.get('/club/home-matches', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) return c.json({ club: null, matches: [] });

  const rows = await c.env.DB.prepare(
    `SELECT a.match_id, a.season, a.window_seq, a.weather, a.attendance, a.ticket, a.commercial, a.broadcast,
            s.capacity AS capacity,
            rc.away_team_id, rc.away_team, rc.score_home, rc.score_away, rc.pen_home, rc.pen_away, rc.walkover_side
     FROM match_attendance a
     LEFT JOIN stadiums s ON s.club_id = a.club_id
     LEFT JOIN result_confirmations rc ON rc.match_id = a.match_id
     WHERE a.club_id = ?
     ORDER BY a.created_at DESC, a.match_id DESC
     LIMIT ?`,
  )
    .bind(club.id, HOME_MATCHES_LIMIT)
    .all<{
      match_id: number;
      season: number;
      window_seq: number;
      weather: string | null;
      attendance: number;
      ticket: number;
      commercial: number;
      broadcast: number;
      capacity: number | null;
      away_team_id: number | null;
      away_team: string | null;
      score_home: number | null;
      score_away: number | null;
      pen_home: number | null;
      pen_away: number | null;
      walkover_side: string | null;
    }>();

  const matches = rows.results.map((r) => {
    let result: string | null = null;
    let scoreText: string | null = null;
    // 本表只收自家主场（attendance 行只在主队侧写），故本队恒为 home：
    // walkover_side 记的是弃权方 ⇒ 'home' = 本队弃权判负，'away' = 客队弃权（本队胜）。
    if (r.walkover_side === 'home') result = '弃权负';
    else if (r.walkover_side === 'away') result = '弃权胜';
    else if (r.score_home !== null && r.score_away !== null) {
      scoreText = `${r.score_home}:${r.score_away}`;
      if (r.pen_home !== null && r.pen_away !== null) result = r.pen_home > r.pen_away ? '点球胜' : r.pen_home < r.pen_away ? '点球负' : '平';
      else result = r.score_home > r.score_away ? '胜' : r.score_home < r.score_away ? '负' : '平';
    }
    return {
      matchId: r.match_id,
      season: r.season,
      windowSeq: r.window_seq,
      weather: r.weather,
      attendance: r.attendance,
      attendanceRate: r.capacity ? r.attendance / r.capacity : null,
      ticket: r.ticket,
      commercial: r.commercial,
      broadcast: r.broadcast,
      // 金额口径两位小数（与账本一致），浮点加法尾差在这里收掉
      total: Math.round((r.ticket + r.commercial + r.broadcast) * 100) / 100,
      opponentId: r.away_team_id,
      // 对手名用确认时的快照（rc.away_team，v0.7.0 起就在）；老行快照缺失回退前端「对手 #id」
      opponentName: r.away_team,
      scoreText,
      result,
    };
  });
  return c.json({ club: { id: club.id, name: club.name }, matches });
});

// 窗口财务汇总（v6.7.0，B2）：账本 ledger_entries 没有窗口列，归窗口径分三层——
// ① 比赛日收入按 match_attendance 的 (season, window_seq) 聚合（写入时就带窗口号，精确）；
// ② wage/luxury_tax/maintenance/naming_* 结算时 ref_type='window'，但这里不用 ref：
//    统一按 created_at 落进 season_windows 的 [opened_at, closed_at]（两端含；在开窗口 closed_at 为
//    NULL，吃掉其后全部），一次折叠覆盖所有 kind，不用逐 ref_type 猜；
// ③ 落不进本季任何窗口的流水进 outside（季前开档、跨季残留），只单列不计入 totals。
// closingBalance 按 (created_at, id) 取末笔的 balance_after——流水 id 顺序与时间顺序不做强假设。
app.get('/club/finance-summary', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) return c.json({ club: null, season: null, windows: [], outside: null, totals: null });

  const seasonParam = c.req.query('season');
  let season: number;
  if (seasonParam !== undefined && seasonParam !== '') {
    const n = Number(seasonParam);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'season 参数不对');
    season = n;
  } else {
    const visible = await getVisibleSeason(c.env.DB);
    if (visible === null) return c.json({ club: { id: club.id, name: club.name }, season: null, windows: [], outside: null, totals: null });
    season = visible;
  }

  const [winRows, matchRows, entryRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT window_seq, status, is_temporary, opened_at, closed_at
       FROM season_windows WHERE season = ? ORDER BY window_seq`,
    )
      .bind(season)
      .all<{ window_seq: number; status: string; is_temporary: number; opened_at: string; closed_at: string | null }>(),
    c.env.DB.prepare(
      `SELECT window_seq, COUNT(*) AS matches, SUM(attendance) AS attendance,
              SUM(ticket) AS ticket, SUM(commercial) AS commercial, SUM(broadcast) AS broadcast
       FROM match_attendance WHERE club_id = ? AND season = ? GROUP BY window_seq`,
    )
      .bind(club.id, season)
      .all<{ window_seq: number; matches: number; attendance: number; ticket: number; commercial: number; broadcast: number }>(),
    c.env.DB.prepare(
      `SELECT id, kind, amount, balance_after, created_at
       FROM ledger_entries WHERE club_id = ? ORDER BY id`,
    )
      .bind(club.id)
      .all<{ id: number; kind: string; amount: number; balance_after: number; created_at: string }>(),
  ]);

  interface WindowBucket {
    windowSeq: number;
    status: string;
    isTemporary: boolean;
    openedAt: string;
    closedAt: string | null;
    byKind: Record<string, number>;
    net: number;
    closingBalance: number | null;
    lastCreatedAt: string | null;
    lastId: number;
  }
  const buckets: WindowBucket[] = winRows.results.map((w) => ({
    windowSeq: w.window_seq,
    status: w.status,
    isTemporary: w.is_temporary === 1,
    openedAt: w.opened_at,
    closedAt: w.closed_at,
    byKind: {},
    net: 0,
    closingBalance: null,
    lastCreatedAt: null,
    lastId: 0,
  }));
  const outside: { byKind: Record<string, number>; net: number } = { byKind: {}, net: 0 };
  const addTo = (b: { byKind: Record<string, number>; net: number }, kind: string, amount: number) => {
    b.byKind[kind] = (b.byKind[kind] ?? 0) + amount;
    b.net += amount;
  };
  for (const e of entryRows.results) {
    const bucket = buckets.find((w) => e.created_at >= w.openedAt && (w.closedAt === null || e.created_at <= w.closedAt));
    if (bucket) {
      addTo(bucket, e.kind, e.amount);
      // 末笔按 (created_at, id)：created_at 同值时靠 id 分先后（entries 已按 id 升序，到这里只会更大）
      if (bucket.lastCreatedAt === null || e.created_at > bucket.lastCreatedAt || (e.created_at === bucket.lastCreatedAt && e.id > bucket.lastId)) {
        bucket.lastCreatedAt = e.created_at;
        bucket.lastId = e.id;
        bucket.closingBalance = e.balance_after;
      }
    } else {
      addTo(outside, e.kind, e.amount);
    }
  }

  const matchBySeq = new Map(matchRows.results.map((r) => [r.window_seq, r]));
  const sumKind = (rec: Record<string, number>) => Object.values(rec).reduce((s, v) => s + v, 0);
  // 金额口径两位小数（与账本一致），REAL 求和的浮点尾差在这里收掉
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const windows = buckets.map((w) => {
    const m = matchBySeq.get(w.windowSeq);
    const matchday = {
      matches: m?.matches ?? 0,
      attendance: m?.attendance ?? 0,
      ticket: round2(m?.ticket ?? 0),
      commercial: round2(m?.commercial ?? 0),
      broadcast: round2(m?.broadcast ?? 0),
      total: round2((m?.ticket ?? 0) + (m?.commercial ?? 0) + (m?.broadcast ?? 0)),
    };
    const { lastCreatedAt: _lca, lastId: _li, ...rest } = w;
    return { ...rest, matchday, net: round2(w.net) };
  });
  // 赛季期末余额 = 时间上最后一笔「有流水窗口」的期末（末窗可能一场流水都没有，别把真值丢成 null）
  const seasonClosing = [...windows].reverse().find((w) => w.closingBalance !== null)?.closingBalance ?? null;
  const totals = windows.length > 0
    ? {
        matchday: windows.reduce(
          (a, w) => ({
            matches: a.matches + w.matchday.matches,
            attendance: a.attendance + w.matchday.attendance,
            ticket: round2(a.ticket + w.matchday.ticket),
            commercial: round2(a.commercial + w.matchday.commercial),
            broadcast: round2(a.broadcast + w.matchday.broadcast),
            total: round2(a.total + w.matchday.total),
          }),
          { matches: 0, attendance: 0, ticket: 0, commercial: 0, broadcast: 0, total: 0 },
        ),
        net: round2(windows.reduce((s, w) => s + w.net, 0)),
        closingBalance: seasonClosing,
      }
    : null;
  return c.json({
    club: { id: club.id, name: club.name },
    season,
    windows,
    outside: Object.keys(outside.byKind).length > 0 ? { ...outside, net: round2(outside.net), total: round2(sumKind(outside.byKind)) } : null,
    totals,
  });
});

// 设施经营（v2.5.0）：build-info 一次拉全预览数据；扩建/升级操作即批即记账
app.get('/club/stadium/build-info', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const stadium = await c.env.DB
    .prepare('SELECT club_id, capacity, tier FROM stadiums WHERE club_id = ?')
    .bind(club.id)
    .first<{ club_id: number; capacity: number; tier: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const [tierTable, prices, vouchers] = await Promise.all([
    loadTierTable(c.env.DB),
    loadFacilityPrices(c.env.DB),
    voucherBalance(c.env.DB, club.id),
  ]);
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
  const facilityCap = facilityCapForTier(stadium.tier);
  const balance = await loadBalance(c.env.DB, club.id);
  const win = await getOpenWindow(c.env.DB);
  return c.json({
    // v6.58.0：券余额升格为俱乐部级（建设返 25% + 管理组发放），字段名从 credit 改为 voucherBalance
    voucherBalance: vouchers,
    balance,
    expansionPer100: prices.expansionPer100,
    maxOpenTier,
    maxOpenTierName: tierTable[String(maxOpenTier)]?.name ?? null,
    // v6.59.0：子设施上限随球场档位（tier+1，最高 5）
    facilityCap,
    refundRatio,
    // v6.30.0：施工开窗闸的前端判据，与三个 POST 端点的 409 no_window 同源
    open: win !== null,
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
        }
      : null,
    facilities: FACILITY_KEYS.map((key) => {
      const level = levelOf(key);
      const nextCost = level >= facilityCap ? null : (prices.upgradeCosts[level] ?? null);
      return { key, level, cap: facilityCap, nextCost, canUpgrade: nextCost !== null };
    }),
  });
});

app.post('/club/stadium/expand', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  // v6.30.0 开窗闸在 expandStadium 内：参数校验优先，避免关窗把参数错误也报成 409
  const body = (await c.req.raw.json().catch(() => null)) as { seats?: unknown } | null;
  const out = await expandStadium(c.env, club.id, Number(body?.seats), user.id);
  return c.json(out, 201);
});

app.post('/club/stadium/upgrade', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  // v6.30.0 开窗闸在 upgradeStadiumTier 内：档位/容量校验优先
  const out = await upgradeStadiumTier(c.env, club.id, user.id);
  return c.json(out, 201);
});

app.post('/club/facilities/upgrade', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const body = (await c.req.raw.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== 'string') throw new HttpError(400, '缺设施类型');
  const out = await upgradeFacilityLevel(c.env, club.id, body.key, user.id);
  return c.json(out, 201);
});

// 冠名市场（v2.6.0；v6.14.0 C3 起签约只走招商轮报价——「收到的报价」取代品牌直签列表）
/** 品牌企业档案（v6.51.0 批 2）：合同/报价卡渲染 slogan、属地、色块与「中资」标签用。 */
interface BrandProfileRow {
  name_en: string;
  color: string;
  slogan: string;
  hq: string;
  intro: string;
  origin: string;
  style: string;
  prefer: string;
}

function brandProfileDto(row: BrandProfileRow | null) {
  if (!row) return null;
  return {
    nameEn: row.name_en,
    color: row.color,
    slogan: row.slogan,
    hq: row.hq,
    intro: row.intro,
    origin: row.origin,
    style: row.style,
    prefer: row.prefer,
  };
}

async function loadBrandProfile(db: D1Database, brand: string): Promise<BrandProfileRow | null> {
  return (
    (await db
      .prepare(`SELECT name_en, color, slogan, hq, intro, origin, style, prefer FROM brand_pool WHERE brand = ?`)
      .bind(brand)
      .first<BrandProfileRow>()) ?? null
  );
}

function namingContractDto(
  row: NonNullable<Awaited<ReturnType<typeof getActiveNaming>>>,
  profile: BrandProfileRow | null = null,
) {
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
    satisfaction: row.satisfaction,
    // v6.51.0 批 1/3：落点名快照（空 = 老合同，前端按品牌名回落）与对赌条款快照（null = 旧口径）
    venueName: row.venue_name !== '' ? row.venue_name : null,
    betTerms: parseBetTerms(row.bet_terms),
    brandProfile: brandProfileDto(profile),
  };
}

function offerDto(row: Awaited<ReturnType<typeof listClubOffers>>[number]) {
  return {
    id: row.id,
    brand: row.brand,
    tier: row.tier,
    industry: row.industry,
    packageNo: row.package_no,
    amount: row.amount,
    windows: row.windows,
    status: row.status,
    expireAt: row.expire_at,
    // v6.51.0 批 1：签下将命名为「品牌·球场名」（无球场名时空串，前端不加行）
    venueName: composeVenueName(row.brand, row.stadium_name),
    brandProfile: brandProfileDto({
      name_en: row.name_en,
      color: row.color,
      slogan: row.slogan,
      hq: row.hq,
      intro: '',
      origin: row.origin,
      style: row.style,
      prefer: row.prefer,
    }),
  };
}

app.get('/club/naming/quote', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const contract = await getActiveNaming(c.env.DB, club.id);
  // 收到的报价（v6.14.0 C3）：待签（轮 open 内）+ 排队接班（queued），签约入口只此一处
  const offers = (await listClubOffers(c.env.DB, club.id)).map(offerDto);
  if (contract) {
    // 队况只在有现约（续约候选要按容量/死忠现算）时才读，无约分支不白读一行（评审 P3-1）
    const stadium = await c.env.DB
      .prepare('SELECT name, capacity, fans FROM stadiums WHERE club_id = ?')
      .bind(club.id)
      .first<{ name: string | null; capacity: number; fans: number }>();
    // 档位与情绪地板随约下发（v6.13.0 C2，前端低情绪预警用）；品牌被弃用回口碑兜底
    const [brands, profiles, factors, brandProfile] = await Promise.all([
      loadAdoptedBrands(c.env.DB),
      loadTierProfiles(c.env.DB),
      loadIndustryFactors(c.env.DB),
      loadBrandProfile(c.env.DB, contract.brand),
    ]);
    const brandTier = brands.find((b) => b.brand === contract.brand)?.tier ?? '口碑';
    const tierKey = brandTier as keyof typeof profiles;
    // 续约候选（剩最后 1 窗时前端用）：按当前队况与品牌现热度现算；品牌已弃用则不给（renewal 缺省）
    const params = await loadNamingParams(c.env.DB);
    const renewal = stadium
      ? quoteBrands(params, brands, stadium.capacity, stadium.fans, factors, stadium.name).find(
          (b) => b.brand === contract.brand,
        ) ?? null
      : null;
    return c.json({
      contract: {
        ...namingContractDto(contract, brandProfile),
        tier: brandTier,
        satisfyFloor: profiles[tierKey]?.satisfyFloor ?? null,
      },
      renewal,
      offers,
    });
  }
  return c.json({ offers });
});

app.post('/club/naming/offers/:id/accept', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const offerId = Number(c.req.param('id'));
  if (!Number.isInteger(offerId) || offerId <= 0) throw new HttpError(400, '报价 id 不合法');
  const body = (await c.req.raw.json().catch(() => null)) as { mode?: unknown } | null;
  const out = await acceptOffer(c.env, offerId, club.id, body?.mode, user.id);
  const profile = out.contract ? await loadBrandProfile(c.env.DB, out.contract.brand) : null;
  return c.json(
    { result: out.result, penalty: out.penalty, contract: out.contract ? namingContractDto(out.contract, profile) : null },
    201,
  );
});

app.post('/club/naming/renew', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const body = (await c.req.raw.json().catch(() => null)) as { packageNo?: unknown } | null;
  const contract = await renewNaming(c.env, club.id, Number(body?.packageNo), user.id);
  return c.json({ contract: namingContractDto(contract, await loadBrandProfile(c.env.DB, contract.brand)) }, 201);
});

app.post('/club/naming/terminate', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再谈冠名');
  const out = await terminateNaming(c.env, club.id, user.id);
  // v6.14.0 C3 触发点：退约腾出 active 位，若该队有排队接班报价立即转正（关窗批另有兜底重试）
  const win = await getOpenWindow(c.env.DB);
  if (win) {
    const activation = await activateQueuedStatements(c.env, win.season, win.windowSeq, 'user', user.id, [club.id]);
    if (activation.statements.length > 0) {
      await c.env.DB.batch(activation.statements);
      for (const a of activation.activated) {
        // v6.51.0 批 1/2：落点名与品牌属地随通知下发（老合同 venueName 空 ⇒ 模板回落品牌名口径）
        const hqRow = await c.env.DB
          .prepare('SELECT hq FROM brand_pool WHERE brand = ?')
          .bind(a.brand)
          .first<{ hq: string }>();
        await queueClubNotification(c.env, a.clubId, 'naming_offer_activated', {
          club: club.name,
          brand: a.brand,
          venueName: a.venueName,
          hq: hqRow?.hq ?? '',
          feePerWindow: a.feePerWindow,
          windows: a.windows,
          pkgName: a.pkgName,
        });
      }
    }
  }
  return c.json(out, 201);
});

// 球场档期（v6.9.0）：每窗非比赛日档位的活动预订；收益与草皮损坏在窗末随关窗批结算
function bookingDto(row: VenueBookingRow, nameOf: (key: string) => string) {
  return {
    id: row.id,
    slotNo: row.slot_no,
    activityType: row.activity_type,
    activityName: nameOf(row.activity_type),
    bookedBy: row.booked_by,
    createdAt: row.created_at,
  };
}

/* ---------- 场馆档期（v6.53.0 P0，§4.5）：页数据 / 预览 / 保存 ---------- */

const VENUE_POLICIES = ['money', 'fans', 'reputation'] as const;

const VENUE_FACILITY_LABELS: Record<string, string> = {
  commercial: '商业设施',
  broadcast: '转播设施',
  pitch: '草皮',
  youth: '青训设施',
  medical: '医疗设施',
};

/** 当前开着的窗（专查存档期页需要的 opened_at / venue_reminder_at；不扩被十几处调用的 getOpenWindow）。 */
function getVenueWindow(db: Env['DB']) {
  return db
    .prepare(
      `SELECT season, window_seq, opened_at, venue_reminder_at
       FROM season_windows WHERE status = 'open' LIMIT 1`,
    )
    .first<{ season: number; window_seq: number; opened_at: string; venue_reminder_at: string }>();
}

interface VenuePlanState {
  window: {
    status: 'open';
    season: number;
    windowSeq: number;
    openedAt: string;
    closesAt: string | null;
    reminderSent: boolean;
  } | null;
  capacity: number;
  hasStadium: boolean;
  reputation: number;
  nextAttendanceMod: number;
  attendanceModMatches: number;
  slotCap: number;
  slotCount: number;
  facilities: Map<string, number>;
  attendanceRate: number;
  attendBuff: number;
  catalog: ActivityCatalog;
  booked: VenueBookingRow[];
  policy: VenuePolicy | null;
}

/** 页数据的一次性取数（GET / 预览 / PUT 共用）：场馆、设施、冠名加成、活动目录、当前窗与已排档期。
 *  PUT 把自己已读到的窗口行传进来复用（undefined = 自己查）：两次读之间可能关窗，写入必须绑定同一个窗。 */
async function loadVenuePlanState(
  env: Env,
  clubId: number,
  winOverride?: Awaited<ReturnType<typeof getVenueWindow>>,
): Promise<VenuePlanState> {
  const config = createConfigService(env.DB);
  const [catalog, win, venue, naming, policyRow, windowHours] = await Promise.all([
    loadActivityCatalog(env.DB),
    winOverride === undefined ? getVenueWindow(env.DB) : Promise.resolve(winOverride),
    loadVenueContext(env.DB, clubId),
    getActiveNaming(env.DB, clubId),
    env.DB.prepare(`SELECT venue_policy FROM clubs WHERE id = ?`).bind(clubId).first<{ venue_policy: string }>(),
    config.getNumber('window_length_hours'),
  ]);

  const facilities = venue.facilities;
  const capacity = venue.capacity;
  const reputation = venue.venueReputation;
  const nextAttendanceMod = venue.nextAttendanceMod;
  const attendanceModMatches = venue.attendanceModMatches;
  const slotCap = catalog.slotCap;
  const slotCount = slotsForCapacity(capacity, slotCap);

  const openedAt = win?.opened_at ?? '';
  const openedMs = Date.parse(openedAt);
  const closesAt =
    win !== null && openedAt !== '' && Number.isFinite(openedMs)
      ? new Date(openedMs + (windowHours ?? 168) * 3600_000).toISOString()
      : null;

  let attendanceRate = 1;
  let booked: VenueBookingRow[] = [];
  if (win !== null) {
    const agg = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(attendance), 0) AS total, COUNT(*) AS n
         FROM match_attendance WHERE club_id = ? AND season = ? AND window_seq = ?`,
      )
      .bind(clubId, win.season, win.window_seq)
      .first<{ total: number; n: number }>();
    const played = agg?.n ?? 0;
    attendanceRate = played > 0 && capacity > 0 ? (agg?.total ?? 0) / (capacity * played) : 1;
    // 历史 'idle'（v6.9 的空置档）等同没排：不计已排、不作 diff 基准、不参与保存后合计
    booked = (await listBookings(env.DB, clubId, win.season, win.window_seq)).filter(
      (b) => b.activity_type !== 'idle',
    );
  }

  // attendBuff：生效冠名品牌档位的活动收入加成（与 home.ts 关窗批同口径）
  let attendBuff = 0;
  if (naming !== null) {
    const brand = await env.DB
      .prepare(`SELECT tier FROM brand_pool WHERE brand = ?`)
      .bind(naming.brand)
      .first<{ tier: string }>();
    const profiles = await loadTierProfiles(env.DB);
    attendBuff = profiles[(brand?.tier ?? '口碑') as '头部' | '新兴' | '口碑'].attendBuff;
  }

  const policyRaw = policyRow?.venue_policy ?? '';
  return {
    window:
      win === null
        ? null
        : {
            status: 'open',
            season: win.season,
            windowSeq: win.window_seq,
            openedAt,
            closesAt,
            reminderSent: (win.venue_reminder_at ?? '') !== '',
          },
    capacity,
    hasStadium: venue.hasStadium,
    reputation,
    nextAttendanceMod,
    attendanceModMatches,
    slotCap,
    slotCount,
    facilities,
    attendanceRate,
    attendBuff,
    catalog,
    booked,
    policy: policyRaw === '' ? null : (policyRaw as VenuePolicy),
  };
}

function quotePicks(state: VenuePlanState, picks: VenuePlanPick[]): { quotes: VenueSlotQuote[]; totals: VenueTotals } {
  return quotePlan({
    capacity: state.capacity,
    slots: state.slotCount,
    defs: state.catalog.types,
    facilities: state.facilities,
    reputation: state.reputation,
    attendanceRate: state.attendanceRate,
    attendBuff: state.attendBuff,
    picks,
  });
}

function activityRequirements(def: VenueActivityDef, state: VenuePlanState) {
  const requirements: { label: string; need: number; current: number }[] = [];
  if (def.requiresFacility !== null) {
    requirements.push({
      label: VENUE_FACILITY_LABELS[def.requiresFacility] ?? def.requiresFacility,
      need: def.requiresLevel,
      current: state.facilities.get(def.requiresFacility) ?? 0,
    });
  }
  if (def.requiresReputation !== null) {
    requirements.push({ label: '场馆声望', need: def.requiresReputation, current: state.reputation });
  }
  return requirements;
}

/** GET/PUT/预览 共用的槽号校验（文案与 venueSlotStatement 的 400 口径一致）。
 *  容量下调后已存在的超界档位仍要能清空，故把「已保存的槽号」也放行（见 PUT 的额外限制）。 */
function assertVenueSlotNo(
  state: VenuePlanState,
  slotNo: number,
  saved?: ReadonlyMap<number, VenueBookingRow>,
): void {
  const inRange = Number.isInteger(slotNo) && slotNo >= 1 && slotNo <= state.slotCount;
  if (!inRange && !(saved?.has(slotNo) ?? false)) {
    throw new HttpError(
      400,
      `档位序号应在 1-${state.slotCount} 之间（本队容量 ${state.capacity} 座，本窗 ${state.slotCount} 个档位）`,
    );
  }
}

app.get('/club/venue-plan', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再排档期');
  const state = await loadVenuePlanState(c.env, club.id);
  const nameOf = (key: string) => state.catalog.types[key]?.name ?? key;

  const picks: VenuePlanPick[] = state.booked.map((b) => ({ slotNo: b.slot_no, activity: b.activity_type }));
  const plan = quotePicks(state, picks);
  const quoteBySlot = new Map(plan.quotes.map((q) => [q.slotNo, q] as const));
  const bookedBySlot = new Map(state.booked.map((b) => [b.slot_no, b] as const));

  const activities = Object.entries(state.catalog.types).map(([key, def]) => {
    const requirements = activityRequirements(def, state);
    return {
      key,
      name: def.name,
      blurb: def.blurb,
      unlocked: requirements.every((r) => r.current >= r.need),
      requirements,
    };
  });

  const slots = [];
  for (let slotNo = 1; slotNo <= state.slotCount; slotNo++) {
    const booked = bookedBySlot.get(slotNo) ?? null;
    const current = quoteBySlot.get(slotNo) ?? null;
    const options = Object.entries(state.catalog.types).map(([key, def]) => {
      if (key === 'idle') {
        return {
          activity: 'idle',
          gross: 0,
          opsCost: 0,
          expectedDamage: 0,
          expectedNet: 0,
          attendanceMod: 1,
          reputationGain: 0,
          unlockReason: null,
        };
      }
      // 该槽若排此活动：用「完整草稿替换本槽」重算，同类序位与 preview 同口径
      const trial = picks.filter((p) => p.slotNo !== slotNo).concat([{ slotNo, activity: key }]);
      const quote = quotePicks(state, trial).quotes.find((q) => q.slotNo === slotNo);
      if (!quote) throw new HttpError(500, `槽 ${slotNo} 的「${key}」报价算不出来`);
      return {
        activity: key,
        gross: quote.gross,
        opsCost: quote.opsCost,
        expectedDamage: quote.expectedDamage,
        expectedNet: quote.expectedNet,
        attendanceMod: quote.attendanceMod,
        reputationGain: quote.reputationGain,
        unlockReason: activityUnlockReason(def, state.facilities, state.reputation),
      };
    });
    slots.push({
      slotNo,
      saturation: current?.saturation ?? 1,
      booked: booked?.activity_type ?? null,
      quote:
        current === null
          ? null
          : {
              activity: current.activity,
              gross: current.gross,
              opsCost: current.opsCost,
              expectedDamage: current.expectedDamage,
              expectedNet: current.expectedNet,
              attendanceMod: current.attendanceMod,
              reputationGain: current.reputationGain,
            },
      options,
    });
  }

  const existing = picks.filter((p): p is { slotNo: number; activity: string } => typeof p.activity === 'string' && p.activity !== 'idle');
  const recommendations = Object.fromEntries(
    VENUE_POLICIES.map((policy) => [
      policy,
      recommendPlan({
        capacity: state.capacity,
        slots: state.slotCount,
        policy,
        defs: state.catalog.types,
        facilities: state.facilities,
        reputation: state.reputation,
        attendanceRate: state.attendanceRate,
        attendBuff: state.attendBuff,
        existing,
      }),
    ]),
  );

  return c.json({
    clubId: club.id,
    window: state.window,
    capacity: state.capacity,
    hasStadium: state.hasStadium,
    slotCount: state.slotCount,
    slotCap: state.slotCap,
    reputation: state.reputation,
    attendance: {
      // 事件预置 K=0 也要显示「还剩 1 场」，不能显示 0
      mod: state.nextAttendanceMod,
      matchesLeft: state.nextAttendanceMod !== 1 ? Math.max(1, state.attendanceModMatches) : 0,
      clamp: [ATTEND_MOD_MIN, ATTEND_MOD_MAX] as [number, number],
    },
    facilities: FACILITY_KEYS.map((key) => ({
      key,
      label: VENUE_FACILITY_LABELS[key] ?? key,
      level: state.facilities.get(key) ?? 0,
    })),
    activities,
    slots,
    policy: state.policy,
    recommendations,
    bookings: state.booked.map((r) => bookingDto(r, nameOf)),
    configWarning:
      state.catalog.legacyKeys.length > 0
        ? `activity_config 仍是旧格式（${state.catalog.legacyKeys.join('、')}）：旧配置只保留金额区间与掷点，饱和、设施门槛、声望加成按 P0 生效。`
        : null,
  });
});

app.post('/club/venue-plan/preview', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再排档期');
  const body = (await c.req.raw.json().catch(() => null)) as { slots?: unknown } | null;
  if (!Array.isArray(body?.slots)) throw new HttpError(400, 'slots 要给数组');
  const state = await loadVenuePlanState(c.env, club.id);

  const picks: VenuePlanPick[] = [];
  const seen = new Set<number>();
  for (const item of body.slots) {
    if (item === null || typeof item !== 'object') throw new HttpError(400, 'slots 里每一项要是对象');
    const slotNo = Number((item as { slotNo?: unknown }).slotNo);
    assertVenueSlotNo(state, slotNo);
    if (seen.has(slotNo)) throw new HttpError(400, `档位 ${slotNo} 重复给了`);
    seen.add(slotNo);
    const activity = (item as { activity?: unknown }).activity;
    if (activity === null || activity === undefined || activity === 'idle') continue;
    if (typeof activity !== 'string') throw new HttpError(400, 'activity 要么是活动键要么是 null');
    if (state.catalog.types[activity] === undefined) throw new HttpError(400, `没有「${activity}」这种活动`);
    picks.push({ slotNo, activity });
  }

  const plan = quotePicks(state, picks);
  // 设施/声望不 reject：预览要能显示已排但已锁的项
  const unlockReasons: Record<number, string> = {};
  for (const quote of plan.quotes) {
    const def = state.catalog.types[quote.activity];
    if (!def) continue;
    const reason = activityUnlockReason(def, state.facilities, state.reputation);
    if (reason !== null) unlockReasons[quote.slotNo] = reason;
  }
  return c.json({ slots: plan.quotes, totals: plan.totals, unlockReasons });
});

app.put('/club/venue-plan', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再排档期');
  const body = (await c.req.raw.json().catch(() => null)) as { slots?: unknown; policy?: unknown } | null;

  // policy：省略 = 保持；null = 清空；非法枚举 400（先于窗口检查，避免「参数错也报没开窗」）
  let policyChange: string | null | undefined;
  if (body?.policy === undefined) policyChange = undefined;
  else if (body.policy === null) policyChange = '';
  else if (typeof body.policy === 'string' && (VENUE_POLICIES as readonly string[]).includes(body.policy)) policyChange = body.policy;
  else throw new HttpError(400, '方针只能是 money / fans / reputation 或 null');

  const win = await getVenueWindow(c.env.DB);
  if (win === null) throw new HttpError(409, '现在没有开着的窗，档期保存不了');
  // ops 闸：运营把 consumption 改成 absolute 或临时关闭时必须 409（前端 useOpsGate 只是提示）
  await assertOpOpen(c.env.DB, 'consumption');

  // 复用上面读到的窗口行：两次读之间若被关窗，档位会被写进已结算的窗
  const state = await loadVenuePlanState(c.env, club.id, win);
  const rawSlots = body?.slots;
  if (rawSlots !== undefined && !Array.isArray(rawSlots)) throw new HttpError(400, 'slots 要给数组');
  const savedBySlot = new Map(state.booked.map((b) => [b.slot_no, b] as const));
  const changes: { slotNo: number; activity: string | null }[] = [];
  const seen = new Set<number>();
  for (const item of rawSlots ?? []) {
    if (item === null || typeof item !== 'object') throw new HttpError(400, 'slots 里每一项要是对象');
    if (!('activity' in item)) throw new HttpError(400, '每个槽要带 activity（清空给 null）');
    const slotNo = Number((item as { slotNo?: unknown }).slotNo);
    assertVenueSlotNo(state, slotNo, savedBySlot);
    if (seen.has(slotNo)) throw new HttpError(400, `档位 ${slotNo} 重复给了`);
    seen.add(slotNo);
    const activityRaw = (item as { activity?: unknown }).activity;
    if (activityRaw !== null && typeof activityRaw !== 'string') throw new HttpError(400, 'activity 要么是活动键要么是 null');
    if (activityRaw === 'idle') throw new HttpError(400, '空置档不用保存，选「暂不排」即可');
    if (activityRaw !== null && state.catalog.types[activityRaw] === undefined) {
      throw new HttpError(400, `没有「${activityRaw}」这种活动`);
    }
    // 容量下调留下的超界档位：只允许清空或保持原活动，不允许换个活动继续排在界外
    const saved = savedBySlot.get(slotNo) ?? null;
    if (slotNo > state.slotCount && saved !== null && activityRaw !== null && activityRaw !== saved.activity_type) {
      throw new HttpError(400, `档位 ${slotNo} 已超出本窗 ${state.slotCount} 档，只能清空或保持原活动`);
    }
    // 与已保存值相同的槽不重验设施/声望（否则设施降级后连「保持原样」都保存不了）
    if ((savedBySlot.get(slotNo)?.activity_type ?? null) === activityRaw) continue;
    // venueSlotStatement 只兜活动存在性，设施/声望门槛在写路径上自己拦
    if (activityRaw !== null) {
      const unlock = activityUnlockReason(state.catalog.types[activityRaw], state.facilities, state.reputation);
      if (unlock !== null) throw new HttpError(400, unlock);
    }
    changes.push({ slotNo, activity: activityRaw });
  }

  const statements = [];
  for (const change of changes) {
    statements.push(
      await venueSlotStatement(
        c.env,
        {
          clubId: club.id,
          season: win.season,
          windowSeq: win.window_seq,
          slotNo: change.slotNo,
          activityType: change.activity,
          // 覆盖事件赠档的 '事件' 时必须清回 ''，否则 GET 的 bookedBy 会显示错来源
          bookedBy: '',
        },
        state.catalog,
      ),
    );
  }
  if (policyChange !== undefined) {
    statements.push(c.env.DB.prepare(`UPDATE clubs SET venue_policy = ? WHERE id = ?`).bind(policyChange, club.id));
  }
  if (statements.length > 0) await c.env.DB.batch(statements);

  // 保存后的整窗预期口径：已保存值 + 本次改动
  const finals = new Map<number, string>();
  for (const b of state.booked) finals.set(b.slot_no, b.activity_type);
  for (const change of changes) {
    if (change.activity === null) finals.delete(change.slotNo);
    else finals.set(change.slotNo, change.activity);
  }
  const picks: VenuePlanPick[] = [...finals.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slotNo, activity]) => ({ slotNo, activity }));
  const plan = quotePicks(state, picks);

  return c.json({
    slots: plan.quotes,
    policy: policyChange === undefined ? state.policy : policyChange === '' ? null : policyChange,
    totals: plan.totals,
  });
});

/* ---------- 随机事件（v6.11.0，D2）：待选事件 + 玩家选定 ---------- */

app.get('/club/events', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再看事件');
  const view = await listClubEvents(c.env, club.id);
  return c.json({ clubId: club.id, ...view });
});

app.post('/club/events/:id/choose', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(403, '先绑定俱乐部再选事件');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '事件 id 必须是正整数');
  const body = (await c.req.raw.json().catch(() => null)) as { choiceNo?: unknown } | null;
  const choiceNo = Number(body?.choiceNo);
  if (!Number.isInteger(choiceNo)) throw new HttpError(400, 'choiceNo 要给选项号');
  // 归属、状态、选项号先在本路由拦掉：引擎层对越界选项是「按最差兜底」的宽容口径（超时路径要用），
  // 玩家自己点错号码不该静默吃最差结果，这里直接 400/403/409。
  const row = await c.env.DB.prepare(
    `SELECT o.id, o.club_id, o.status, o.event_type, e.options_json
     FROM event_occurrences o LEFT JOIN event_pool e ON e.event_id = o.event_id
     WHERE o.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      club_id: number;
      status: string;
      event_type: string;
      options_json: string | null;
    }>();
  if (row === null) throw new HttpError(404, '没有这条事件记录');
  if (row.club_id !== club.id) throw new HttpError(403, '这条事件不属于你的俱乐部');
  if (row.status !== 'pending') throw new HttpError(409, '这条事件已经结算过了');
  if (row.event_type !== 'choice') throw new HttpError(409, '即发型事件没有可选项');
  const options = parseEventOptions(row.options_json);
  if (!options.some((o) => o.no === choiceNo)) throw new HttpError(400, `没有「${choiceNo}」号选项`);
  // 过了时限但 cron 还没跑到也能选（时限只驱动自动兜底，不锁玩家）
  const resolved = await resolveEvent(c.env, { occurrenceId: id, choiceNo, actor: user.id, origin: 'user' });
  return c.json({
    event: {
      id: resolved.occurrenceId,
      eventId: resolved.eventId,
      eventName: resolved.eventName,
      optionNo: resolved.optionNo,
      optionName: resolved.optionName,
      auto: resolved.auto,
      effects: resolved.effects,
      notes: resolved.notes,
      text: resolved.text,
    },
  });
});

export default app;
