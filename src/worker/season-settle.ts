// 赛季结算域（v1.4.0，PRD 4.8/TECH_DESIGN §11/§9.1-9.2）：
// 1. 赛事完结结算：入场奖金（联赛）、资格赛止步保底、冠军杯小组赛剩余池按胜场占比——一次性项，stage_settled_at 原子闸幂等。
// 2. 赛季结算按钮（手动 + 前置校验）：growable 重判（规则 4.1.1 本季 age_cap）→ 状态 settled。
//    忠诚奖金自v3.0.0 起改在赛季中期窗（同赛季第 2 个常规窗）关窗时发（规则 4.3.2 + 窗刻度），见 loyaltyMovements。
//    死忠演化归v1.5.0（主场收入域），此处留位不实现；富人税/工资在窗末（closeWindow）收，季末不重复（假设 28）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { ledgerMovement } from './ledger.ts';
import { createConfigService } from '../core/config.ts';
import { serviceSeasons } from '../core/bypass-rules.ts';
import { clubIdByTourTeam, loadPrizeTable } from './prizes.ts';
import { getActiveNaming, loadHeatRules, loadSatisfyConfig } from './naming-ops.ts';
import { queueClubNotification } from './notify.ts';

function nowSql(): string {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface ConfirmedRow {
  stage_kind: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
  score_home: number | null;
  score_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  walkover_side: string | null;
  winner_team: string | null;
}

interface ClubRecord {
  clubId: number;
  played: number;
  wins: number;
  draws: number;
}

/** 该赛事已确认赛果按 club 聚合战绩（walkover/点球按 winner 记胜负，其余比分定） */
function aggregateRecords(rows: ConfirmedRow[], clubMap: Map<number, number>): Map<number, ClubRecord> {
  const out = new Map<number, ClubRecord>();
  const touch = (clubId: number): ClubRecord => {
    let r = out.get(clubId);
    if (!r) {
      r = { clubId, played: 0, wins: 0, draws: 0 };
      out.set(clubId, r);
    }
    return r;
  };
  for (const row of rows) {
    if (row.home_team_id === null || row.away_team_id === null) continue;
    const home = clubMap.get(row.home_team_id);
    const away = clubMap.get(row.away_team_id);
    if (home === undefined || away === undefined) continue;
    let outcome: 'home' | 'away' | 'draw' | null = null;
    if (row.walkover_side === 'home') outcome = 'home';
    else if (row.walkover_side === 'away') outcome = 'away';
    else if (row.score_home !== null && row.score_away !== null) {
      if (row.score_home > row.score_away) outcome = 'home';
      else if (row.score_home < row.score_away) outcome = 'away';
      else if (row.pen_home !== null && row.pen_away !== null && row.pen_home !== row.pen_away) {
        outcome = row.pen_home > row.pen_away ? 'home' : 'away';
      } else outcome = 'draw';
    }
    touch(home).played++;
    touch(away).played++;
    if (outcome === 'home') touch(home).wins++;
    else if (outcome === 'away') touch(away).wins++;
    else if (outcome === 'draw') {
      touch(home).draws++;
      touch(away).draws++;
    }
  }
  return out;
}

/**
 * 赛事完结结算（v1.4.0）：按 competition_type 发该赛事的一次性项。
 * - league_premier/league_second：每支参赛队入场奖金；
 * - qualifying：止步保底（确认赛果里输过至少一场的队，多轮晋级失败口径一致，假设 29）；
 * - champions_cup：仅当该绑定有过小组赛（group/round_robin）确认赛果时，剩余池按胜场占比分；
 * - super_cup：无一次性项（逐场全即时），只盖结算戳。
 * 幂等：stage_settled_at 原子闸（NULL→now），同批发钱（batch 原子，闸 0 行=整批跳过）。
 */
export async function settleTournamentStage(env: Env, actor: number, stageIdInput: unknown): Promise<{ ok: true; items: number }> {
  const stageId = Number(stageIdInput);
  if (!Number.isInteger(stageId) || stageId <= 0) throw new HttpError(400, '赛事绑定 ID 不对');
  const db = env.DB;
  const binding = await db
    .prepare('SELECT id, season, tournament_id, competition_type, stage_settled_at FROM season_tournaments WHERE id = ?')
    .bind(stageId)
    .first<{ id: number; season: number; tournament_id: number; competition_type: string | null; stage_settled_at: string | null }>();
  if (!binding) throw new HttpError(404, '赛事绑定不存在');
  if (binding.stage_settled_at) throw new HttpError(409, `这座赛事已完结结算过（${binding.stage_settled_at}）`);

  const rows = await db
    .prepare(
      `SELECT stage_kind, home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side, winner_team
       FROM result_confirmations WHERE tournament_id = ? AND season = ?`,
    )
    .bind(binding.tournament_id, binding.season)
    .all<ConfirmedRow>();
  const tourTeamIds = rows.results.flatMap((r) => [r.home_team_id, r.away_team_id]).filter((n): n is number => n !== null);
  const clubMap = await clubIdByTourTeam(env, tourTeamIds);
  if (clubMap.size === 0) throw new HttpError(409, '认证中心目录里找不到这些球队的俱乐部映射（AUTH_DB 未配置或目录缺行），先补目录再结算');

  const records = aggregateRecords(rows.results, clubMap);
  const table = await loadPrizeTable(db);
  if (!table) throw new HttpError(409, '奖金表（prize_table）未配置');

  const type = binding.competition_type;
  const movements: { clubId: number; amount: number; memo: string }[] = [];
  if (type === 'league_premier' || type === 'league_second') {
    const entry = table[type].entry;
    for (const r of records.values()) movements.push({ clubId: r.clubId, amount: entry, memo: `联赛入场奖金（S${binding.season}）` });
  } else if (type === 'qualifying') {
    const losers = new Set<number>();
    for (const row of rows.results) {
      if (row.home_team_id === null || row.away_team_id === null) continue;
      const home = clubMap.get(row.home_team_id);
      const away = clubMap.get(row.away_team_id);
      if (home === undefined || away === undefined) continue;
      let winner: number | undefined;
      if (row.walkover_side === 'home') winner = home;
      else if (row.walkover_side === 'away') winner = away;
      else if (row.score_home !== null && row.score_away !== null) {
        if (row.score_home > row.score_away) winner = home;
        else if (row.score_home < row.score_away) winner = away;
        else if (row.pen_home !== null && row.pen_away !== null && row.pen_home !== row.pen_away) {
          winner = row.pen_home > row.pen_away ? home : away;
        }
      }
      if (winner !== undefined) losers.add(winner === home ? away : home);
    }
    for (const clubId of losers) movements.push({ clubId, amount: table.qualifying.fallback, memo: `冠军杯资格赛止步保底（S${binding.season}）` });
  } else if (type === 'champions_cup') {
    const groupRows = rows.results.filter((r) => r.stage_kind === 'group' || r.stage_kind === 'round_robin');
    if (groupRows.length === 0) throw new HttpError(409, '该绑定没有小组赛确认赛果，无需剩余池结算（淘汰赛晋级奖金已即时入账）');
    const groupRecords = aggregateRecords(groupRows, clubMap);
    const paid = [...groupRecords.values()].reduce((sum, r) => sum + r.wins * table.champions_group.win + r.draws * table.champions_group.draw, 0);
    const remaining = Math.round((table.champions_group.pool - paid) * 100) / 100;
    const totalWins = [...groupRecords.values()].reduce((sum, r) => sum + r.wins, 0);
    if (remaining > 0 && totalWins > 0) {
      for (const r of groupRecords.values()) {
        if (r.wins === 0) continue;
        const share = Math.round(((remaining * r.wins) / totalWins) * 100) / 100;
        if (share > 0) movements.push({ clubId: r.clubId, amount: share, memo: `冠军杯小组赛剩余池按胜场分配（S${binding.season}，胜 ${r.wins} 场）` });
      }
    }
  }
  // super_cup：无一次性项，直接盖结算章

  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(`UPDATE season_tournaments SET stage_settled_at = ${nowSql()} WHERE id = ? AND stage_settled_at IS NULL`)
      .bind(stageId),
    ...movements.flatMap((m) =>
      ledgerMovement(db, { clubId: m.clubId, delta: m.amount, kind: 'prize', refType: 'stage', refId: stageId, memo: m.memo, idempotent: false }),
    ),
    audit({ actor, action: 'tournament_stage_settle', targetType: 'season_tournament', targetId: stageId, origin: 'user', after: { season: binding.season, type, items: movements.length } }),
  ];
  const results = await db.batch(statements);
  if ((results[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '这座赛事刚被结算过了');
  return { ok: true, items: movements.length };
}

/** growable 重判语句（规则 4.1.1）：growable = CA<PA 且 age ≤ 本季上限；只改有变化的行 */
export function growableStatement(db: Env['DB'], ageCap: number) {
  return db
    .prepare(
      `UPDATE players SET growable = CASE WHEN ca IS NOT NULL AND pa IS NOT NULL AND ca < pa AND age IS NOT NULL AND age <= ? THEN 1 ELSE 0 END,
       updated_at = ${nowSql()}
       WHERE growable != CASE WHEN ca IS NOT NULL AND pa IS NOT NULL AND ca < pa AND age IS NOT NULL AND age <= ? THEN 1 ELSE 0 END`,
    )
    .bind(ageCap, ageCap);
}

/** growable 重判（规则 4.1.1）：建档/建季时即按新上限全量重算 */
export async function rejudgeGrowable(env: Env, ageCap: number): Promise<number> {
  const result = await growableStatement(env.DB, ageCap).run();
  return result.meta.changes ?? 0;
}

export interface SeasonSettleCheck {
  blockers: string[];
  warnings: string[];
}

/** 结算前置校验：硬阻断（开窗/待审/谈判/市场单据）+ 软警示（未确认完赛果） */
export async function checkSeasonSettle(env: Env, season: number): Promise<SeasonSettleCheck> {
  const db = env.DB;
  const blockers: string[] = [];
  const warnings: string[] = [];

  const openWindows = await db.prepare(`SELECT COUNT(*) AS n FROM season_windows WHERE season = ? AND status = 'open'`).bind(season).first<{ n: number }>();
  if ((openWindows?.n ?? 0) > 0) blockers.push(`还有 ${openWindows?.n} 个窗口没关`);

  const pendingReviews = await db
    .prepare(`SELECT COUNT(*) AS n FROM review_tasks WHERE status = 'open' AND json_extract(payload, '$.season') = ?`)
    .bind(season)
    .first<{ n: number }>();
  if ((pendingReviews?.n ?? 0) > 0) blockers.push(`审核队列还有 ${pendingReviews?.n} 张单没处理`);

  const activeSessions = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
       WHERE s.status = 'active' AND t.status = 'signing' AND t.season = ?`,
    )
    .bind(season)
    .first<{ n: number }>();
  if ((activeSessions?.n ?? 0) > 0) blockers.push(`还有 ${activeSessions?.n} 场签约谈判没结束`);

  const openMarket = await db
    .prepare(`SELECT COUNT(*) AS n FROM listings WHERE season = ? AND status IN ('listed', 'bidding', 'matched_pending', 'pending_review')`)
    .bind(season)
    .first<{ n: number }>();
  if ((openMarket?.n ?? 0) > 0) blockers.push(`市场还有 ${openMarket?.n} 张单据没收尾`);

  // 软警示：绑定赛事里已完赛但未确认的场次（管理组确认后不拦结算）
  const bindings = await db
    .prepare(`SELECT tournament_id FROM season_tournaments WHERE season = ?`)
    .bind(season)
    .all<{ tournament_id: number }>();
  const confirmedRows = await db.prepare('SELECT match_id FROM result_confirmations ORDER BY id DESC LIMIT 500').all<{ match_id: number }>();
  const confirmedSet = new Set(confirmedRows.results.map((r) => r.match_id));
  let unconfirmed = 0;
  for (const b of bindings.results) {
    const n = await env.TOUR_DB.prepare(`SELECT COUNT(*) AS n FROM match m JOIN stage s ON s.id = m.stage_id WHERE s.tournament_id = ? AND m.status = 'finished'`).bind(b.tournament_id).first<{ n: number }>();
    unconfirmed += n?.n ?? 0;
  }
  if (unconfirmed - confirmedSet.size > 0) warnings.push(`还有约 ${unconfirmed - confirmedSet.size} 场完赛结果未确认（不阻断结算，弃权场次忽略本提示）`);

  return { blockers, warnings };
}

/**
 * 忠诚奖金（规则 4.3.2）：赛季中期窗（同赛季第 2 个常规窗）关窗时发一次，按窗刻度算效力
 * （1 个常规窗 = 0.5 赛季），取满足的最高档（loyalty_tiers [[赛季, RC 比],…]），逐队汇总入账本。
 * 幂等键 = window/season*100+windowSeq：同一窗重放不重复发；一队多条合同同窗合并成一条流水。
 * 返回待拼进关窗批的语句与汇总（供关窗响应回显）。
 */
export async function loyaltyMovements(
  db: D1Database,
  actor: number | null,
  season: number,
  windowSeq: number,
  ticksAfterClose: number,
): Promise<{ statements: D1PreparedStatement[]; summary: { count: number; total: number } }> {
  const config = createConfigService(db);
  const tiersRaw = await config.get('loyalty_tiers');
  const tiers = (tiersRaw ? JSON.parse(tiersRaw) : [[0.5, 0.05], [1.5, 0.1], [2.5, 0.2]]) as [number, number][];
  tiers.sort((a, b) => a[0] - b[0]); // 配置可能乱序，按起效赛季升序后「取满足的最高档」才成立

  const contracts = await db
    .prepare(
      `SELECT id, club_id, release_fee, service_ticks FROM contracts
       WHERE is_active = 1 AND club_id IS NOT NULL AND release_fee IS NOT NULL`,
    )
    .all<{ id: number; club_id: number; release_fee: number; service_ticks: number | null }>();

  const byClub = new Map<number, { amount: number; count: number }>();
  for (const ct of contracts.results) {
    const seasons = serviceSeasons(ct.service_ticks ?? 0, ticksAfterClose);
    let rate = 0;
    for (const [minSeasons, r] of tiers) if (seasons >= minSeasons) rate = r; // 取满足的最高档
    if (rate <= 0 || ct.release_fee <= 0) continue;
    const amount = Math.round(ct.release_fee * rate * 100) / 100;
    const cur = byClub.get(ct.club_id) ?? { amount: 0, count: 0 };
    byClub.set(ct.club_id, { amount: Math.round((cur.amount + amount) * 100) / 100, count: cur.count + 1 });
  }

  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  let total = 0;
  let count = 0;
  for (const [clubId, agg] of byClub) {
    total = Math.round((total + agg.amount) * 100) / 100;
    count += agg.count;
    statements.push(
      ...ledgerMovement(db, {
        clubId,
        delta: agg.amount,
        kind: 'loyalty',
        refType: 'window',
        refId: season * 100 + windowSeq,
        memo: `忠诚奖金（S${season} 第 ${windowSeq} 窗，${agg.count} 人现行合同）`,
      }),
      audit({
        actor,
        action: 'loyalty_bonus',
        targetType: 'club',
        targetId: clubId,
        origin: 'user',
        after: { season, windowSeq, contracts: agg.count, amount: agg.amount },
      }),
    );
  }
  return { statements, summary: { count, total } };
}

// ─── 联赛冠军加成（v6.13.0 C2）───────────────────────────────────────────────

export interface ChampionBonusDetail {
  applied: boolean;
  /** 跳过原因（applied=false 时给人看的口径，进结算 warnings 触发 acknowledged 流程） */
  note: string | null;
  clubId: number | null;
  clubName: string | null;
  brand: string | null;
  heatDelta: number;
  satDelta: number;
}

interface StandingsRow {
  teamId: number;
  pts: number;
  gd: number;
}

/** 已确认赛果 → 积分表（胜 3 平 1 负 0；**点球决胜按平局计**，与 formPtsOf 战绩口径一致；
 *  弃权按 walkover_side 判负、净胜球按 3:0；双方弃权 / 无有效结果不计） */
export function leagueStandings(rows: ConfirmedRow[]): StandingsRow[] {
  const table = new Map<number, StandingsRow>();
  const touch = (teamId: number): StandingsRow => {
    let r = table.get(teamId);
    if (!r) {
      r = { teamId, pts: 0, gd: 0 };
      table.set(teamId, r);
    }
    return r;
  };
  for (const row of rows) {
    if (row.home_team_id === null || row.away_team_id === null) continue;
    const home = touch(row.home_team_id);
    const away = touch(row.away_team_id);
    if (row.walkover_side === 'home') {
      home.pts += 3;
      home.gd += 3;
      away.gd -= 3;
    } else if (row.walkover_side === 'away') {
      away.pts += 3;
      away.gd += 3;
      home.gd -= 3;
    } else if (row.score_home !== null && row.score_away !== null) {
      if (row.score_home === row.score_away) {
        home.pts += 1;
        away.pts += 1;
      } else {
        const winner = row.score_home > row.score_away ? home : away;
        const loser = row.score_home > row.score_away ? away : home;
        winner.pts += 3;
        const diff = Math.abs(row.score_home - row.score_away);
        winner.gd += diff;
        loser.gd -= diff;
      }
    }
    // 其余（双方弃权、比分缺失）不计
  }
  return [...table.values()];
}

/** tour 队 id → 队名（AUTH_DB team 目录；目录缺行不入 Map，tiebreak 回落队 id） */
async function tourTeamNames(env: Env, teamIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!env.AUTH_DB || teamIds.length === 0) return map;
  const { results } = await env.AUTH_DB.prepare(
    `SELECT tour_team_id, name FROM team WHERE tour_team_id IN (${teamIds.map(() => '?').join(',')})`,
  )
    .bind(...teamIds)
    .all<{ tour_team_id: number; name: string }>();
  for (const r of results) map.set(r.tour_team_id, r.name);
  return map;
}

/**
 * 联赛冠军加成（v6.13.0 C2，插件 champion_bonuses 口径）：定位本季 league_premier 绑定
 * （0 条或 >1 条 → 跳过进 notes），自算积分表取榜首（积分 → 净胜球 → 队名），
 * 冠军队有 active 冠名则品牌热度 + champion（钳 [clampLow, clampHigh]）、
 * 满意度 + championSatisfaction（钳 [0, 2]）；无冠名只发 🏆 站内信（热度加成无落点）。
 * 幂等：语句挂 `(SELECT status FROM seasons WHERE season = ?) != 'settled'` 守卫，
 * 与批尾 seasons 状态 UPDATE 同闸——结算重放 / 并发抢行零改行。
 */
export async function championBonusStatements(
  env: Env,
  season: number,
  actor: number,
): Promise<{ statements: D1PreparedStatement[]; detail: ChampionBonusDetail }> {
  const skip = (note: string): { statements: D1PreparedStatement[]; detail: ChampionBonusDetail } => ({
    statements: [],
    detail: { applied: false, note, clubId: null, clubName: null, brand: null, heatDelta: 0, satDelta: 0 },
  });
  const db = env.DB;
  const bindings = await db
    .prepare(`SELECT id, tournament_id FROM season_tournaments WHERE season = ? AND competition_type = 'league_premier'`)
    .bind(season)
    .all<{ id: number; tournament_id: number }>();
  if (bindings.results.length === 0) return skip('本季没有联赛（league_premier）绑定，跳过冠军加成');
  if (bindings.results.length > 1) return skip(`本季有 ${bindings.results.length} 条联赛绑定，冠军无法唯一判定，跳过冠军加成`);
  const binding = bindings.results[0]!;

  const { results } = await db
    .prepare(
      `SELECT home_team_id, away_team_id, score_home, score_away, pen_home, pen_away, walkover_side, winner_team
       FROM result_confirmations WHERE tournament_id = ? AND season = ?`,
    )
    .bind(binding.tournament_id, season)
    .all<ConfirmedRow>();
  const standings = leagueStandings(results);
  if (standings.length === 0) return skip('该联赛绑定没有已确认赛果，跳过冠军加成');

  const names = await tourTeamNames(env, standings.map((r) => r.teamId));
  standings.sort((a, b) => b.pts - a.pts || b.gd - a.gd || (names.get(a.teamId) ?? '').localeCompare(names.get(b.teamId) ?? '') || a.teamId - b.teamId);
  const championTeam = standings[0]!;

  const clubMap = await clubIdByTourTeam(env, [championTeam.teamId]);
  const clubId = clubMap.get(championTeam.teamId) ?? null;
  if (clubId === null) return skip(`联赛冠军（tour 队 ${championTeam.teamId}）是 CPU 队或无俱乐部映射，加成无落点`);

  const clubRow = await db.prepare('SELECT name FROM clubs WHERE id = ?').bind(clubId).first<{ name: string }>();
  const naming = await getActiveNaming(db, clubId);
  if (!naming) {
    return {
      statements: [],
      detail: {
        applied: false,
        note: `联赛冠军 ${clubRow?.name ?? clubId} 无生效冠名，热度加成无落点（站内信照发）`,
        clubId,
        clubName: clubRow?.name ?? null,
        brand: null,
        heatDelta: 0,
        satDelta: 0,
      },
    };
  }

  const rules = await loadHeatRules(db);
  const cfg = await loadSatisfyConfig(db);
  const seasonGuard = `(SELECT status FROM seasons WHERE season = ?) != 'settled'`;
  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(
        `UPDATE brand_pool SET heat = MAX(?, MIN(?, ROUND(heat + ?, 3)))
         WHERE brand = ? AND status = 'adopted' AND ${seasonGuard}`,
      )
      .bind(rules.clampLow, rules.clampHigh, rules.champion, naming.brand, season),
    db
      .prepare(
        `UPDATE naming_contracts SET satisfaction = MAX(0, MIN(2, ROUND(satisfaction + ?, 3)))
         WHERE id = ? AND status = 'active' AND ${seasonGuard}`,
      )
      .bind(cfg.championSatisfaction, naming.id, season),
    audit({
      actor,
      action: 'champion_bonus',
      targetType: 'season',
      targetId: season,
      origin: 'user',
      after: { season, clubId, brand: naming.brand, heatDelta: rules.champion, satDelta: cfg.championSatisfaction, standingsTop: championTeam },
      guardSql: seasonGuard,
      guardParams: [season],
    }),
  ];
  return {
    statements,
    detail: {
      applied: true,
      note: null,
      clubId,
      clubName: clubRow?.name ?? null,
      brand: naming.brand,
      heatDelta: rules.champion,
      satDelta: cfg.championSatisfaction,
    },
  };
}

/**
 * 赛季结算（手动按钮）：growable 重判 → seasons.status='settled'。
 * 忠诚奖金自v3.0.0 起在赛季中期窗关窗时发（见 loyaltyMovements）。
 * 冠军加成（v6.13.0 C2）并入本批：跳过原因并进 warnings 触发 acknowledged 流程。
 */
export async function settleSeason(
  env: Env,
  actor: number,
  seasonInput: unknown,
  acknowledged: boolean,
): Promise<{ ok: true; growable: number; warnings: string[]; champion: ChampionBonusDetail }> {
  const season = Number(seasonInput);
  if (!Number.isInteger(season)) throw new HttpError(400, '赛季号不对');
  const db = env.DB;
  const row = await db.prepare('SELECT season, status FROM seasons WHERE season = ?').bind(season).first<{ season: number; status: string | null }>();
  if (!row) throw new HttpError(404, '赛季不存在');
  if (row.status === 'settled') throw new HttpError(409, '这个赛季已经结算过了');

  const check = await checkSeasonSettle(env, season);
  if (check.blockers.length > 0) throw new HttpError(409, `结算前置不满足：${check.blockers.join('；')}`);
  // 冠军加成预演算（v6.13.0 C2）：跳过原因并进 warnings，第一次调用会被 acknowledged 流程拦下
  const champion = await championBonusStatements(env, season, actor);
  const warnings = [...check.warnings, ...(champion.detail.note ? [champion.detail.note] : [])];
  if (warnings.length > 0 && !acknowledged) {
    throw new HttpError(409, `待确认提示：${warnings.join('；')}。确认继续请带 acknowledged=true`);
  }

  const audit = createAuditStatement(db);
  const statements = [audit({ actor, action: 'season_settle', targetType: 'season', targetId: null, origin: 'user', after: { season } })];

  // 死忠演化步骤占位：归v1.5.0（主场收入域）实现后插入本批；
  // growable 重判并入主批（规则 4.1.1：按本季 age_cap 全量重算，只改有变化的行）
  const ageCapRow = await db.prepare('SELECT age_cap FROM seasons WHERE season = ?').bind(season).first<{ age_cap: number | null }>();
  const cap = ageCapRow?.age_cap ?? null;
  const growableStmt = cap !== null ? growableStatement(db, cap) : null;

  const batchResults = await db.batch([
    ...statements,
    ...(growableStmt ? [growableStmt] : []),
    ...champion.statements,
    db.prepare(`UPDATE seasons SET status = 'settled', settled_at = ${nowSql()} WHERE season = ? AND status != 'settled'`).bind(season),
  ]);
  const growable = growableStmt ? (batchResults[statements.length]?.meta.changes ?? 0) : 0;
  // 结算真发生（批尾 seasons 状态 UPDATE 改了行）才发冠军站内信；无冠名走「无落点」文案分支
  if ((batchResults[batchResults.length - 1]?.meta.changes ?? 0) > 0 && champion.detail.clubId !== null) {
    await queueClubNotification(env, champion.detail.clubId, 'naming_champion', {
      club: champion.detail.clubName ?? `俱乐部 #${champion.detail.clubId}`,
      season,
      brand: champion.detail.brand,
      heat: champion.detail.heatDelta,
      sat: champion.detail.satDelta,
    });
  }
  return { ok: true, growable, warnings, champion: champion.detail };
}

