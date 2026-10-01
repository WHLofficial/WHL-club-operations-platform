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
