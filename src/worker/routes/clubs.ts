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
import { deriveClubTier, deriveClubLeagues, deriveClubTiers } from '../tier.ts';
import { closedRegularTicks } from '../contract-ticks.ts';
import { POSITION_BY_ID, POSITION_GROUP_BY_POSITION, POSITION_GROUPS } from '../../core/fc26.ts';
import { loadAttendanceModel, loadTierTable, playerInfluenceSum, teamInfluence } from '../home.ts';
import { createConfigService } from '../../core/config.ts';
import { sqlDisplayName } from '../../core/player-name.ts';
import { expandStadium, upgradeStadiumTier, upgradeFacilityLevel, loadFacilityPrices, loadBalance, FACILITY_KEYS } from '../stadium-ops.ts';
import { quoteBrands, signNaming, terminateNaming, getActiveNaming, loadNamingParams } from '../naming-ops.ts';
import { getVisibleSeason } from '../seasons.ts';

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
const YEARS_BANDS: readonly Band[] = [
  { key: 'le05', label: '0.5 赛季内', min: 0, max: 0.5 },
  { key: '1-15', label: '1–1.5 赛季', min: 1, max: 1.5 },
  { key: '2-25', label: '2–2.5 赛季', min: 2, max: 2.5 },
  { key: '3+', label: '3 赛季及以上', min: 3, max: 999 },
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
// 生产实测（2026-09-22）两套 id 逐队相等（20/20），所以 src/worker/home.ts 的 clubFormPts 绑 club id
// 也能命中；那是数值巧合而非口径，别照抄，新写查询一律绑 tourTeamId。
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
  const club = await getBoundClub(c.env, user.id);
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

// 设施经营（v2.5.0）：build-info 一次拉全预览数据；扩建/升级操作即批即记账
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
  const out = await expandStadium(c.env, club.id, Number(body?.seats), user.id);
  return c.json(out, 201);
});

app.post('/club/stadium/upgrade', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const out = await upgradeStadiumTier(c.env, club.id, user.id);
  return c.json(out, 201);
});

app.post('/club/facilities/upgrade', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(403, '先绑定俱乐部再经营设施');
  const body = (await c.req.raw.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== 'string') throw new HttpError(400, '缺设施类型');
  const out = await upgradeFacilityLevel(c.env, club.id, body.key, user.id);
  return c.json(out, 201);
});

// 冠名市场（v2.6.0）：报价按本队队况逐品牌现算；合同费用条款签约时快照锁定
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
  const out = await terminateNaming(c.env, club.id, user.id);
  return c.json(out, 201);
});

export default app;
