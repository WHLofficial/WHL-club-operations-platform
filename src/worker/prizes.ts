// 赛事奖金自动入账（增量 11，TECH_DESIGN §9.1）。
// 分界（用户裁决 2026-09-16）：单场可定值的即时入账（联赛胜平负/超级杯胜负/冠军杯小组赛每胜平/淘汰赛晋级）；
// 赛事完结一次性项（入场奖金/资格赛止步保底/小组赛剩余池）走「赛事完结结算」端点，一次结清。
// 入账一律经 ledgerMovement 幂等闸（ref_type 带侧别防同场双发），AUTH_DB 目录把 tour team id 映射 club_id；
// AUTH_DB 未配置时不发奖金（与绑定派生同一回滚通道口径）。
import type { Env } from './env.ts';
import { createConfigService } from '../core/config.ts';
import { ledgerMovement } from './ledger.ts';
import { cpuClubIds } from './growth.ts';

export interface PrizeTable {
  league_premier: { entry: number; win: number; draw: number; loss: number };
  league_second: { entry: number; win: number; draw: number; loss: number };
  qualifying: { fallback: number };
  champions_group: { entry: number; pool: number; win: number; draw: number };
  champions_ko: { quarterfinal: number; semifinal: number; final: number; champion: number };
  super_cup: { win: number; loss: number };
}

// 单场赛果输入（confirmResult 已拉齐的字段）
export interface MatchPrizeInput {
  matchId: number;
  season: number;
  competitionType: string | null;
  stageKind: string | null; // tour stage.kind: elim/round_robin/group
  round: number | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  scoreHome: number | null;
  scoreAway: number | null;
  penHome: number | null;
  penAway: number | null;
  walkoverSide: string | null;
  winnerTeamId: number | null;
  stageEntryCount: number | null; // elim 阶段入场队数（config_json），晋级轮次由此推
}

interface PrizePayment {
  clubId: number;
  amount: number;
  refType: 'match_home' | 'match_away';
  memo: string;
}

export async function loadPrizeTable(db: Env['DB']): Promise<PrizeTable | null> {
  const config = createConfigService(db);
  const raw = await config.get('prize_table');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PrizeTable;
  } catch {
    return null;
  }
}

/** tour team id → club_id（AUTH_DB team 目录；未配置或目录缺行 → 不入账；CPU 队一律不入账） */
export async function clubIdByTourTeam(env: Env, tourTeamIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!env.AUTH_DB || tourTeamIds.length === 0) return map;
  const ids = [...new Set(tourTeamIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return map;
  const { results } = await env.AUTH_DB.prepare(
    `SELECT tour_team_id, club_id FROM team WHERE tour_team_id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{ tour_team_id: number; club_id: number | null }>();
  // CPU 队禁止入账（增量 14，用户裁决）：目录里的 club_id 照样补上（赛程/展示要用），但奖金与主场收入不发。
  const cpuIds = await cpuClubIds(env.DB);
  for (const r of results) {
    if (r.club_id !== null && !cpuIds.has(r.club_id)) map.set(r.tour_team_id, r.club_id);
  }
  return map;
}

/** 单场比分→胜负平（walkover/点球按 winner 定，平局含点球战前平比分的点球胜负已由 winner 区分） */
function outcome(m: MatchPrizeInput): 'home' | 'away' | 'draw' | null {
  if (m.walkoverSide === 'home') return 'home';
  if (m.walkoverSide === 'away') return 'away';
  if (m.scoreHome === null || m.scoreAway === null) return null;
  if (m.scoreHome > m.scoreAway) return 'home';
  if (m.scoreHome < m.scoreAway) return 'away';
  // 比分相同：淘汰赛看点球胜者定胜负；小组/联赛平局（无点球或点球也平按平局）
  if (m.penHome !== null && m.penAway !== null && m.penHome !== m.penAway) {
    return m.penHome > m.penAway ? 'home' : 'away';
  }
  if (m.winnerTeamId !== null && m.winnerTeamId === m.homeTeamId) return 'home';
  if (m.winnerTeamId !== null && m.winnerTeamId === m.awayTeamId) return 'away';
  return 'draw';
}

/** 淘汰赛晋级奖金：赢下该场后所在轮的队伍数（8→quarterfinal、4→semifinal、2→final、决赛胜=champion +5）。
 * 「可累加」指整个征程逐场各领各档（7.5+10+12.5+5），不是单场累加。 */
function koProgressPrize(m: MatchPrizeInput, table: PrizeTable): number | null {
  if (m.stageKind !== 'elim' || m.stageEntryCount === null || m.round === null) return null;
  const before = m.stageEntryCount / 2 ** m.round; // 该轮开打时的队伍数
  if (before < 2) return null;
  const after = before / 2;
  if (after === 8) return table.champions_ko.quarterfinal;
  if (after === 4) return table.champions_ko.semifinal;
  if (after === 2) return table.champions_ko.final;
  if (after === 1) return table.champions_ko.champion;
  return null;
}

/**
 * 赛果确认即时奖金：返回该场的 ledger 语句（含幂等闸，重复确认/重放安全）。
 * 无可发项（类型不适用/无绑定俱乐部）→ 空数组；不发主通知（确认通知已有）。
 */
export async function matchPrizeStatements(env: Env, m: MatchPrizeInput): Promise<ReturnType<Env['DB']['prepare']>[]> {
  if (m.competitionType === null || m.homeTeamId === null || m.awayTeamId === null) return [];
  const table = await loadPrizeTable(env.DB);
  if (!table) return [];

  const sideByTeam = new Map<number, 'home' | 'away'>([
    [m.homeTeamId, 'home'],
    [m.awayTeamId, 'away'],
  ]);
  const clubMap = await clubIdByTourTeam(env, [m.homeTeamId, m.awayTeamId]);
  const clubOf = (teamId: number): { clubId: number; refType: 'match_home' | 'match_away' } | null => {
    const side = sideByTeam.get(teamId);
    const clubId = clubMap.get(teamId);
    if (!side || clubId === undefined) return null;
    return { clubId, refType: side === 'home' ? 'match_home' : 'match_away' };
  };

  const payments: PrizePayment[] = [];
  const res = outcome(m);

  if (m.competitionType === 'league_premier' || m.competitionType === 'league_second') {
    const p = m.competitionType === 'league_premier' ? table.league_premier : table.league_second;
    if (res === 'home' || res === 'away') {
      const winner = clubOf(res === 'home' ? m.homeTeamId : m.awayTeamId);
      const loser = clubOf(res === 'home' ? m.awayTeamId : m.homeTeamId);
      if (winner) payments.push({ clubId: winner.clubId, amount: p.win, refType: winner.refType, memo: `联赛胜场奖金（比赛 #${m.matchId}）` });
      if (loser) payments.push({ clubId: loser.clubId, amount: p.loss, refType: loser.refType, memo: `联赛出场补贴（比赛 #${m.matchId}）` });
    } else if (res === 'draw') {
      for (const side of ['home', 'away'] as const) {
        const c = clubOf(side === 'home' ? m.homeTeamId : m.awayTeamId);
        if (c) payments.push({ clubId: c.clubId, amount: p.draw, refType: c.refType, memo: `联赛平局奖金（比赛 #${m.matchId}）` });
      }
    }
  } else if (m.competitionType === 'super_cup') {
    if (res === 'home' || res === 'away') {
      const winner = clubOf(res === 'home' ? m.homeTeamId : m.awayTeamId);
      const loser = clubOf(res === 'home' ? m.awayTeamId : m.homeTeamId);
      if (winner) payments.push({ clubId: winner.clubId, amount: table.super_cup.win, refType: winner.refType, memo: `超级杯胜方奖金（比赛 #${m.matchId}）` });
      if (loser) payments.push({ clubId: loser.clubId, amount: table.super_cup.loss, refType: loser.refType, memo: `超级杯出场补贴（比赛 #${m.matchId}）` });
    }
  } else if (m.competitionType === 'champions_cup') {
    if (m.stageKind === 'group' || m.stageKind === 'round_robin') {
      // 小组赛每胜/平即时入账（每胜 7.0/平 2.5）；剩余池完结时按胜场占比分
      const winnerSide = res === 'home' ? 'home' : res === 'away' ? 'away' : null;
      if (winnerSide) {
        const c = clubOf(winnerSide === 'home' ? m.homeTeamId : m.awayTeamId);
        if (c) payments.push({ clubId: c.clubId, amount: table.champions_group.win, refType: c.refType, memo: `冠军杯小组赛胜场奖金（比赛 #${m.matchId}）` });
      } else if (res === 'draw') {
        for (const side of ['home', 'away'] as const) {
          const c = clubOf(side === 'home' ? m.homeTeamId : m.awayTeamId);
          if (c) payments.push({ clubId: c.clubId, amount: table.champions_group.draw, refType: c.refType, memo: `冠军杯小组赛平局奖金（比赛 #${m.matchId}）` });
        }
      }
    } else if (m.stageKind === 'elim') {
      const prize = koProgressPrize(m, table);
      if (prize !== null && (res === 'home' || res === 'away')) {
        const winner = clubOf(res === 'home' ? m.homeTeamId : m.awayTeamId);
        if (winner) payments.push({ clubId: winner.clubId, amount: prize, refType: winner.refType, memo: `冠军杯淘汰赛晋级奖金（比赛 #${m.matchId}）` });
      }
    }
  }

  return payments.flatMap((p) =>
    ledgerMovement(env.DB, {
      clubId: p.clubId,
      delta: p.amount,
      kind: 'prize',
      refType: p.refType,
      refId: m.matchId,
      memo: p.memo,
    }),
  );
}
