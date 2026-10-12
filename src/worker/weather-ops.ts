// 场次天气预报（v6.15.0，revenue 插件 forecast_round 口径）：管理员按轮手动触发、逐场随机、已预报保留。
//
// 与确认时现掷（home.ts matchAttendanceStatements）的分工：
// - 预报把**天气类型与系数 wx 一并提前抽定落库**（用户裁决 2026-10-01：不仅是类型，整个系数就预先抽）；
// - 确认时按「事件预置 > 场次预报 > 现掷」消费，预报命中时 rng 整笔不抽（类型与系数都不再滚）；
// - 概率/区间表仍只读 attendance_model（40/30/20/10 用户裁决值，本域零数值改动）。
//
// 定位键 = (tournament_id, round)：TOUR_DB match.round 为整数，跨锦标赛轮号会撞，必须带赛事 id；
// season 由 season_tournaments 绑定解析（与赛果确认同口径，无绑定 409）。
// 预报范围 = 主队可解析为本平台俱乐部（clubIdByTourTeam 自带 CPU 队过滤）且有球场行的比赛——
// 与消费端的跳过条件一致，保证「预报了必被消费」。已预报保留（幂等，match_id PK 闸）、已确认跳过。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { loadAttendanceModel, rollWeather, uniform, asRange } from './home.ts';
import { clubIdByTourTeam } from './prizes.ts';
import { MATCH_SELECT, type TourMatchRow } from './results.ts';
import { normTeamName } from '../core/name-fold.ts';

/** 轮次定位参数的严格解析（GET query 字符串与 POST body 数字两形态共用）：
 *  `Number('')`/`Number(null)` 都是 0——不拦的话 `?round=` 会被当成第 0 轮、
 *  body `round:null` 会对第 0 轮真的抽定落库（评审 #1）。round 上界 200 防缓存键空间被刷（评审 nit）。 */
export function parseRoundParams(
  rawTournamentId: unknown,
  rawRound: unknown,
): { tournamentId: number; round: number } {
  const toInt = (raw: unknown): number =>
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  const tournamentId = toInt(rawTournamentId);
  const round = toInt(rawRound);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournament_id 应为正整数');
  if (!Number.isInteger(round) || round < 0 || round > 200) throw new HttpError(400, 'round 应为 0-200 的整数');
  return { tournamentId, round };
}

/** 该轮一场比赛的完整视图：tour 行 + 平台侧状态（映射/球场/预报/确认） */
export interface RoundMatchView {
  matchId: number;
  homeClubId: number | null;
  homeClubName: string | null;
  awayTeamName: string | null;
  stageName: string | null;
  finished: boolean;
  /** 主场球场（无球场行 null） */
  stadium: { name: string | null; capacity: number; tier: number } | null;
  /** 预报值（未预报 null） */
  weather: string | null;
  wxCoef: number | null;
  /** 已确认（赛果确认钩子落 match_attendance）后的实际值与收入四件套 */
  confirmedWeather: string | null;
  attendance: number | null;
  ticket: number | null;
  commercial: number | null;
  broadcast: number | null;
  /** 跳过原因：主队信息缺失 / 主队不是平台俱乐部 / 主队没有球场 */
  skippedReason: string | null;
}

export interface ForecastResult {
  tournamentId: number;
  round: number;
  /** 本次新落库的预报 */
  forecast: { matchId: number; homeClubName: string | null; awayTeamName: string | null; weather: string; wxCoef: number }[];
  /** 落库前已预报、本次原样保留的场次 */
  existing: { matchId: number; homeClubName: string | null; awayTeamName: string | null; weather: string; wxCoef: number }[];
  /** 已确认（有 match_attendance 行）跳过的场次 */
  confirmed: { matchId: number; homeClubName: string | null; awayTeamName: string | null; weather: string | null }[];
  /** 不可预报跳过的场次（带原因） */
  skipped: { matchId: number; homeClubName: string | null; awayTeamName: string | null; reason: string }[];
}

export async function resolveSeasonForTournament(env: Env, tournamentId: number): Promise<number> {
  const binding = await env.DB.prepare('SELECT season FROM season_tournaments WHERE tournament_id = ?')
    .bind(tournamentId)
    .first<{ season: number }>();
  if (!binding) throw new HttpError(409, '这个赛事还没绑定到任何赛季，先到「赛季与赛事绑定」里绑');
  return binding.season;
}

/** 收集该轮全部比赛的平台侧状态（只读，预览/触发/fixtures 公开面共用；全程不掷随机） */
export async function buildRoundView(env: Env, tournamentId: number, round: number): Promise<RoundMatchView[]> {
  await resolveSeasonForTournament(env, tournamentId);
  const { results: matches } = await env.TOUR_DB.prepare(
    `${MATCH_SELECT} WHERE s.tournament_id = ? AND m.round = ? ORDER BY m.id`,
  )
    .bind(tournamentId, round)
    .all<TourMatchRow>();

  const homeTeamIds = matches.map((m) => m.home_team_id).filter((id): id is number => id !== null);
  const clubMap = await clubIdByTourTeam(env, homeTeamIds);
  const clubIds = [...new Set([...clubMap.values()])];
  const stadiumRows = clubIds.length
    ? await env.DB.prepare(
        `SELECT club_id, name, capacity, tier FROM stadiums WHERE club_id IN (${clubIds.map(() => '?').join(',')})`,
      )
        .bind(...clubIds)
        .all<{ club_id: number; name: string | null; capacity: number; tier: number }>()
    : { results: [] as { club_id: number; name: string | null; capacity: number; tier: number }[] };
  const stadiumMap = new Map(stadiumRows.results.map((r) => [r.club_id, r]));
  const clubNames = new Map(
    clubIds.length
      ? (
          await env.DB.prepare(`SELECT id, name FROM clubs WHERE id IN (${clubIds.map(() => '?').join(',')})`)
            .bind(...clubIds)
            .all<{ id: number; name: string }>()
        ).results.map((r) => [r.id, r.name])
      : [],
  );

  const forecastRows = new Map(
    (
      await env.DB.prepare(
        'SELECT match_id, club_id, weather, wx_coef FROM match_weather WHERE tournament_id = ? AND round = ?',
      )
        .bind(tournamentId, round)
        .all<{ match_id: number; club_id: number; weather: string; wx_coef: number }>()
    ).results.map((r) => [r.match_id, r]),
  );
  const matchIds = matches.map((m) => m.id);
  const confirmedRows = new Map(
    matchIds.length
      ? (
          await env.DB.prepare(
            `SELECT match_id, weather, attendance, ticket, commercial, broadcast
             FROM match_attendance WHERE match_id IN (${matchIds.map(() => '?').join(',')})`,
          )
            .bind(...matchIds)
            .all<{ match_id: number; weather: string; attendance: number; ticket: number; commercial: number; broadcast: number }>()
        ).results.map((r) => [r.match_id, r])
      : [],
  );

  return matches.map((m) => {
    const clubId = m.home_team_id === null ? undefined : clubMap.get(m.home_team_id);
    const confirmed = confirmedRows.get(m.id);
    const skippedReason =
      clubId === undefined
        ? m.home_team_id === null
          ? '主队信息缺失'
          : '主队不是平台俱乐部'
        : !stadiumMap.has(clubId)
          ? '主队没有球场'
          : null;
    const stadium = clubId !== undefined ? (stadiumMap.get(clubId) ?? null) : null;
    // 预报行只在 club_id 与解析出的主队一致时才有效——改期/换边后旧预报不展示（评审 #2），
    // 与消费端 `AND club_id = ?` 同口径；错配行数据保留（管理端触发回读可见）
    const rawForecast = forecastRows.get(m.id);
    const forecast = rawForecast && rawForecast.club_id === clubId ? rawForecast : undefined;
    return {
      matchId: m.id,
      homeClubId: clubId ?? null,
      homeClubName: clubId !== undefined ? (clubNames.get(clubId) ?? null) : null,
      awayTeamName: m.away_team,
      stageName: m.stage_name,
      finished: m.status === 'finished',
      stadium: stadium ? { name: stadium.name, capacity: stadium.capacity, tier: stadium.tier } : null,
      weather: forecast?.weather ?? null,
      wxCoef: forecast ? forecast.wx_coef : null,
      confirmedWeather: confirmed?.weather ?? null,
      attendance: confirmed?.attendance ?? null,
      ticket: confirmed?.ticket ?? null,
      commercial: confirmed?.commercial ?? null,
      broadcast: confirmed?.broadcast ?? null,
      skippedReason,
    };
  });
}

/** 预览该轮预报状态（GET /api/admin/weather/forecast）：只读、零 rng 消费、零落库 */
export async function previewRound(env: Env, tournamentId: number, round: number) {
  return { tournamentId, round, matches: await buildRoundView(env, tournamentId, round) };
}

/** 触发按轮预报（POST /api/admin/weather/forecast）：对未预报未确认的可预报场次逐场抽类型+系数落库。
 *  INSERT OR IGNORE + meta.changes 区分实际落库/并发撞闸（match_id PK 幂等，先到者赢）；已预报保留。 */
export async function forecastRound(env: Env, actor: number | null, tournamentId: number, round: number): Promise<ForecastResult> {
  const season = await resolveSeasonForTournament(env, tournamentId);
  const view = await buildRoundView(env, tournamentId, round);
  const model = await loadAttendanceModel(env.DB);
  const rng = env.rng ?? Math.random;

  const result: ForecastResult = { tournamentId, round, forecast: [], existing: [], confirmed: [], skipped: [] };
  const pending: { view: RoundMatchView; weather: string; wx: number }[] = [];
  for (const v of view) {
    if (v.confirmedWeather !== null) {
      result.confirmed.push({ matchId: v.matchId, homeClubName: v.homeClubName, awayTeamName: v.awayTeamName, weather: v.confirmedWeather });
    } else if (v.weather !== null) {
      result.existing.push({ matchId: v.matchId, homeClubName: v.homeClubName, awayTeamName: v.awayTeamName, weather: v.weather, wxCoef: v.wxCoef ?? 0 });
    } else if (v.skippedReason !== null) {
      result.skipped.push({ matchId: v.matchId, homeClubName: v.homeClubName, awayTeamName: v.awayTeamName, reason: v.skippedReason });
    } else {
      const weather = rollWeather(rng, model.weather_probabilities);
      const range = asRange(model.weather_ranges[weather]);
      const wx = range ? uniform(rng, range[0], range[1]) : 1;
      pending.push({ view: v, weather, wx });
    }
  }

  if (pending.length > 0) {
    const statements = pending.map(({ view: v, weather, wx }) =>
      env.DB
        .prepare(
          `INSERT INTO match_weather (match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(match_id) DO NOTHING`,
        )
        .bind(v.matchId, v.homeClubId, season, tournamentId, round, weather, wx, actor),
    );
    const audit = createAuditStatement(env.DB);
    statements.push(
      audit({
        actor,
        action: 'weather_forecast',
        targetType: 'tournament',
        targetId: tournamentId,
        origin: 'user',
        // attempted 而非 forecasted：并发撞闸（changes=0）的场次没落库，审计在 batch 内无法回写实际数
        after: { round, attempted: pending.length },
      }),
    );
    const outcomes = await env.DB.batch(statements);
    const raced: typeof pending = [];
    pending.forEach(({ view: v, weather, wx }, i) => {
      const changes = (outcomes[i] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
      if (changes === 0) raced.push({ view: v, weather, wx });
      else result.forecast.push({ matchId: v.matchId, homeClubName: v.homeClubName, awayTeamName: v.awayTeamName, weather, wxCoef: wx });
    });
    // 并发触发撞闸：预报已被另一方落库，回读库值按「已存在」归段（库里是唯一真源）
    if (raced.length > 0) {
      const racedIds = raced.map(({ view: v }) => v.matchId);
      const racedRows = new Map(
        (
          await env.DB.prepare(
            `SELECT match_id, weather, wx_coef FROM match_weather WHERE match_id IN (${racedIds.map(() => '?').join(',')})`,
          )
            .bind(...racedIds)
            .all<{ match_id: number; weather: string; wx_coef: number }>()
        ).results.map((r) => [r.match_id, r]),
      );
      for (const { view: v } of raced) {
        const row = racedRows.get(v.matchId);
        // 回读缺行（理论不可达：changes=0 只能是撞上已存在行）不进返回段，避免给管理员看空天气
        if (!row) continue;
        result.existing.push({
          matchId: v.matchId,
          homeClubName: v.homeClubName,
          awayTeamName: v.awayTeamName,
          weather: row.weather,
          wxCoef: row.wx_coef,
        });
      }
    }
  } else {
    // 零预报也留痕（触发动作即审计：预览过、无空转的排查依据）
    await createAuditStatement(env.DB)({
      actor,
      action: 'weather_forecast',
      targetType: 'tournament',
      targetId: tournamentId,
      origin: 'user',
      after: { round, attempted: 0 },
    }).run();
  }
  return result;
}

// ============================================================================================
// 天气同步（v6.44.0）：插件侧是天气真源，把整轮天气+系数推过来，平台按推送值固化。
//
// 契约（与插件 `services/club_sync.py` 逐字对应）：
//   POST /api/internal/weather-sync，HMAC 签名（lib/hmac.ts，独立密钥 WEATHER_SYNC_SECRET），
//   body { season, competition, roundNo, items: [{ home, away, weather, coef }] }。
//   验签与形状校验在 routes/internal.ts（机器通道的 fail-closed 口径在那边），本文件只管落库。
//
// 三个设计决定：
//   ① **推者赢**：upsert（ON CONFLICT DO UPDATE）覆盖平台自己抽的预报行——真源是插件，
//      平台侧 forecastRound 的随机值只在对该场尚无推送时才有意义。已确认赛果的场次照样覆盖：
//      覆盖后 match_weather 与 match_attendance.weather 不一致，那正是历史账订正批要收敛的差异
//      （见 ROADMAP v6.44.0 节），verdict 里 settled=true 把这类场次点名。
//   ② **判据是队名对**：tour 库没有"客队名+轮次"的稳定唯一键可用（跨锦标赛轮号会撞，见本文件头），
//      所以按 (tournament_id, round) 取该轮全部比赛，再用归一化后的 (主队名, 客队名) 匹对。
//      队名归一走 core/name-fold.ts 的 normTeamName（剥 CPU 后缀 + 折名），与平台侧 CPU 口径同源。
//   ③ **逐场 verdict 而非整体失败**：一场对不上不该让整轮作废（插件一条命令推全季）。
//      只有"赛季没绑定赛事"这类整轮级错误才抛错。
// ============================================================================================

export const WEATHER_SYNC_PATH = '/api/internal/weather-sync';

/** 插件侧 competition 名 → 平台 season_tournaments.competition_type（插件只推这三类有主场的赛事） */
export const COMPETITION_TYPE_BY_NAME: Record<string, string> = {
  顶级联赛: 'league_premier',
  次级联赛: 'league_second',
  冠军杯: 'champions_cup',
};

/** 推送方落款。match_weather.forecast_by 声明为 INTEGER（管理端触发时写管理员 user id），
 *  SQLite 动态类型照收这个字符串；该列**当前无任何读取方**，真凭据是每批一条的审计行。
 *  刻意不写 NULL：库里看到这行的人该能一眼分出「插件推的」与「平台自己抽的」。 */
export const WEATHER_SYNC_FORECAST_BY = 'revenue-plugin';

/** 单轮场次上限（正常一轮 5-9 场；防呆，不是业务约束） */
const SYNC_ITEMS_MAX = 40;
const SYNC_NAME_MAX = 60;

export interface WeatherPushItem {
  home: string;
  away: string;
  weather: string;
  coef: number;
}

export interface WeatherPushPayload {
  season: number;
  competition: string;
  roundNo: number;
  items: WeatherPushItem[];
}

export type WeatherVerdictStatus = 'created' | 'replaced' | 'unchanged' | 'unmatched' | 'skipped_no_stadium' | 'bad_weather';

export interface WeatherVerdict {
  home: string;
  away: string;
  status: WeatherVerdictStatus;
  matchId?: number;
  /** 该场已有 match_attendance 行（历史账已按旧值结过，差异留给订正批） */
  settled?: boolean;
  detail?: string;
}

export interface WeatherPushResult {
  season: number;
  competition: string;
  competitionType: string;
  roundNo: number;
  tournamentIds: number[];
  verdicts: WeatherVerdict[];
  /** 逐状态计数（插件把这段回显给操作者：落库多少、没匹配上多少） */
  summary: Record<WeatherVerdictStatus, number> & { settled: number; pushed: number };
}

/** 严格整数解析：`Number('')`/`Number(null)` 都是 0，机器通道的入参必须先过这一关（同 parseRoundParams）。 */
function syncInt(raw: unknown): number {
  return typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
}

/**
 * 解析并校验推送体（形状错误一律抛 400：插件是唯一调用方，形状不对就是它的 bug，别静默吞）。
 * 逐场**解析层**只校验类型与范围；天气类型是否被平台认识留到落库阶段判（verdict bad_weather），
 * 这样一轮里混进一个表外天气时其余场次照常落库。
 */
export function parseWeatherPush(raw: unknown): WeatherPushPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, '请求体应为 JSON 对象', 'bad_body');
  }
  const body = raw as Record<string, unknown>;
  const season = syncInt(body.season);
  if (!Number.isInteger(season) || season <= 0) {
    throw new HttpError(400, `season 应为正整数（收到 ${JSON.stringify(body.season)}）`, 'bad_season');
  }
  const competition = typeof body.competition === 'string' ? body.competition.trim() : '';
  if (!Object.prototype.hasOwnProperty.call(COMPETITION_TYPE_BY_NAME, competition)) {
    throw new HttpError(
      400,
      `competition 只支持 ${Object.keys(COMPETITION_TYPE_BY_NAME).join(' / ')}（收到 ${competition || '空'}）`,
      'unknown_competition',
    );
  }
  const roundNo = syncInt(body.roundNo);
  if (!Number.isInteger(roundNo) || roundNo < 0 || roundNo > 200) {
    throw new HttpError(400, `roundNo 应为 0-200 的整数（收到 ${JSON.stringify(body.roundNo)}）`, 'bad_round');
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, 'items 应为非空数组', 'bad_items');
  }
  if (body.items.length > SYNC_ITEMS_MAX) {
    throw new HttpError(400, `items 最多 ${SYNC_ITEMS_MAX} 场（收到 ${body.items.length}）`, 'bad_items');
  }
  const items = body.items.map((rawItem, i) => {
    const at = `items[${i}]`;
    if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
      throw new HttpError(400, `${at} 应为对象`, 'bad_item');
    }
    const item = rawItem as Record<string, unknown>;
    const name = (key: 'home' | 'away'): string => {
      const v = typeof item[key] === 'string' ? item[key].trim() : '';
      if (!v || v.length > SYNC_NAME_MAX) throw new HttpError(400, `${at}.${key} 应为 1-${SYNC_NAME_MAX} 字的队名`, 'bad_item');
      return v;
    };
    const weather = typeof item.weather === 'string' ? item.weather.trim() : '';
    if (!weather) throw new HttpError(400, `${at}.weather 不能为空`, 'bad_item');
    const coef = typeof item.coef === 'number' ? item.coef : NaN;
    // 系数只校验「是个正数」：区间真源在插件的天气档位表里，平台侧硬套自己的区间会
    // 把「两侧档位表不同步」误报成「推送非法」——那是配置问题，该在订正报告里看出来。
    if (!Number.isFinite(coef) || coef <= 0) {
      throw new HttpError(400, `${at}.coef 应为正数（收到 ${JSON.stringify(item.coef)}）`, 'bad_item');
    }
    return { home: name('home'), away: name('away'), weather, coef };
  });
  return { season, competition, roundNo, items };
}

/**
 * 落库：按轮取 tour 赛程 → 队名匹对 → 无球场跳过 → upsert match_weather（推者赢）→ 审计。
 * 全部写语句 + 审计行同批 batch（原子；审计的 after 就是本次推送的逐场落库结果）。
 */
export async function applyWeatherPush(env: Env, payload: WeatherPushPayload): Promise<WeatherPushResult> {
  const competitionType = COMPETITION_TYPE_BY_NAME[payload.competition];
  const bindings = await env.DB.prepare(
    'SELECT tournament_id FROM season_tournaments WHERE season = ? AND competition_type = ? ORDER BY tournament_id',
  )
    .bind(payload.season, competitionType)
    .all<{ tournament_id: number }>();
  if (bindings.results.length === 0) {
    throw new HttpError(
      409,
      `第 ${payload.season} 赛季没有绑定「${payload.competition}」（${competitionType}）赛事，先到「赛季与赛事绑定」里绑`,
      'not_bound',
    );
  }
  const tournamentIds = bindings.results.map((r) => r.tournament_id);

  // 该轮全部比赛（可能跨同类型的多座赛事：赛季里同一 competition_type 绑了两座时都算候选）
  const { results: matches } = await env.TOUR_DB.prepare(
    `${MATCH_SELECT} WHERE s.tournament_id IN (${tournamentIds.map(() => '?').join(',')}) AND m.round = ? ORDER BY m.id`,
  )
    .bind(...tournamentIds, payload.roundNo)
    .all<TourMatchRow>();

  const byPair = new Map<string, TourMatchRow>();
  for (const m of matches) {
    if (m.home_team === null || m.away_team === null) continue;
    const key = `${normTeamName(m.home_team)}|${normTeamName(m.away_team)}`;
    if (!byPair.has(key)) byPair.set(key, m); // 同轮同对理论只一场；真撞了取 id 小的（ORDER BY 已保证）
  }

  const model = await loadAttendanceModel(env.DB);
  const homeTeamIds = matches.map((m) => m.home_team_id).filter((id): id is number => id !== null);
  const clubMap = await clubIdByTourTeam(env, homeTeamIds);
  const clubIds = [...new Set(clubMap.values())];
  const stadiumClubIds = new Set(
    clubIds.length
      ? (
          await env.DB.prepare(`SELECT club_id FROM stadiums WHERE club_id IN (${clubIds.map(() => '?').join(',')})`)
            .bind(...clubIds)
            .all<{ club_id: number }>()
        ).results.map((r) => r.club_id)
      : [],
  );

  const matchIds = matches.map((m) => m.id);
  const existing = new Map(
    matchIds.length
      ? (
          await env.DB.prepare(
            `SELECT match_id, weather, wx_coef FROM match_weather WHERE match_id IN (${matchIds.map(() => '?').join(',')})`,
          )
            .bind(...matchIds)
            .all<{ match_id: number; weather: string; wx_coef: number }>()
        ).results.map((r) => [r.match_id, r])
      : [],
  );
  const settledIds = new Set(
    matchIds.length
      ? (
          await env.DB.prepare(
            `SELECT match_id FROM match_attendance WHERE match_id IN (${matchIds.map(() => '?').join(',')})`,
          )
            .bind(...matchIds)
            .all<{ match_id: number }>()
        ).results.map((r) => r.match_id)
      : [],
  );

  const verdicts: WeatherVerdict[] = [];
  const writes: { match: TourMatchRow; item: WeatherPushItem; clubId: number; status: WeatherVerdictStatus }[] = [];
  for (const item of payload.items) {
    const verdict: WeatherVerdict = { home: item.home, away: item.away, status: 'unmatched' };
    const match = byPair.get(`${normTeamName(item.home)}|${normTeamName(item.away)}`);
    if (!match) {
      verdict.detail = '该轮赛程里没有这对主客队（队名或轮次对不上）';
      verdicts.push(verdict);
      continue;
    }
    verdict.matchId = match.id;
    if (model.weather_probabilities[item.weather] === undefined) {
      verdict.status = 'bad_weather';
      verdict.detail = `平台不认识的天气类型「${item.weather}」（平台侧档位：${Object.keys(model.weather_probabilities).join('/')}）`;
      verdicts.push(verdict);
      continue;
    }
    const clubId = match.home_team_id === null ? undefined : clubMap.get(match.home_team_id);
    if (clubId === undefined || !stadiumClubIds.has(clubId)) {
      verdict.status = 'skipped_no_stadium';
      verdict.detail = clubId === undefined ? '主队不是平台俱乐部（CPU 队或未绑定）' : '主队没有球场行（结算端也会跳过）';
      verdicts.push(verdict);
      continue;
    }
    const prior = existing.get(match.id);
    const status: WeatherVerdictStatus = !prior
      ? 'created'
      : prior.weather === item.weather && prior.wx_coef === item.coef
        ? 'unchanged'
        : 'replaced';
    verdict.status = status;
    verdict.settled = settledIds.has(match.id);
    if (verdict.settled) verdict.detail = '该场已确认赛果，历史账差异由订正批收敛';
    verdicts.push(verdict);
    writes.push({ match, item, clubId, status });
  }

  const summary: WeatherPushResult['summary'] = {
    created: 0,
    replaced: 0,
    unchanged: 0,
    unmatched: 0,
    skipped_no_stadium: 0,
    bad_weather: 0,
    settled: 0,
    pushed: payload.items.length,
  };
  for (const v of verdicts) {
    summary[v.status] += 1;
    if (v.settled) summary.settled += 1;
  }

  if (writes.length > 0) {
    const statements = writes.map(({ match, item, clubId }) =>
      env.DB
        .prepare(
          `INSERT INTO match_weather (match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(match_id) DO UPDATE SET
             club_id = excluded.club_id, season = excluded.season, tournament_id = excluded.tournament_id,
             round = excluded.round, weather = excluded.weather, wx_coef = excluded.wx_coef,
             forecast_by = excluded.forecast_by`,
        )
        // club_id 写解析出的平台俱乐部：消费端是 `WHERE match_id = ? AND club_id = ?`，两边必须一致
        .bind(match.id, clubId, payload.season, match.tournament_id, payload.roundNo, item.weather, item.coef, WEATHER_SYNC_FORECAST_BY),
    );
    statements.push(
      createAuditStatement(env.DB)({
        actor: null, // 机器通道：人类行为人取不到（见 lib/audit.ts 的 actor/origin 契约）
        action: 'weather_sync',
        targetType: 'tournament',
        targetId: tournamentIds[0],
        origin: 'machine',
        after: {
          season: payload.season,
          competition: payload.competition,
          competitionType,
          roundNo: payload.roundNo,
          tournamentIds,
          summary,
          applied: writes.map(({ match, item, status }) => ({
            matchId: match.id,
            home: item.home,
            away: item.away,
            weather: item.weather,
            coef: item.coef,
            status,
          })),
        },
      }),
    );
    await env.DB.batch(statements);
  }

  return {
    season: payload.season,
    competition: payload.competition,
    competitionType,
    roundNo: payload.roundNo,
    tournamentIds,
    verdicts,
    summary,
  };
} 
