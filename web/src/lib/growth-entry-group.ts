// v6.45.0 成长录入列表分组：赛事 → 轮次 → 比赛，纯函数（不改入参顺序、不排序）。
// v6.45.1：列表改为全部可录场次（服务端不再截断），并加「按轮次」视图——轮次 → 比赛单层，
// 组键仍是「赛事 + 轮次 + 阶段」（用户裁决 2026-10-12：赛事加轮次，不算窗口）。
// 两个视图的组内容一致，按首次出现顺序排——也就是最近的赛事/轮次在最上面。
import type { MatchEntryListItem } from './api.ts';

export interface MatchEntryRoundGroup {
  /** 组键：同一「阶段名 + 轮次」才算一组（同名阶段跨赛事各成一组的边界由上层赛事分组保证） */
  key: string;
  /** 展示标题，如「第 3 轮 · 小组赛」 */
  label: string;
  matches: MatchEntryListItem[];
}

export interface MatchEntryTournamentGroup {
  /** 赛事系统 tournament.id（result_confirmations.tournament_id 为空时是 null） */
  tournamentId: number | null;
  /** 赛事名（赛事库查不到时回落「赛事 #id」/「未关联赛事」） */
  label: string;
  rounds: MatchEntryRoundGroup[];
  /** 该赛事下的比赛场数（组头徽标用） */
  matchCount: number;
}

/** 轮次标题：阶段名可能有（冠军杯「小组赛」）也可能没有（部分联赛阶段） */
export function roundGroupLabel(m: Pick<MatchEntryListItem, 'round' | 'stageName'>): string {
  const stage = (m.stageName ?? '').trim();
  return stage === '' ? `第 ${m.round} 轮` : `第 ${m.round} 轮 · ${stage}`;
}

/** 赛事组键：赛事系统 tournament.id 为空时落 'none' */
const tournamentKeyOf = (m: Pick<MatchEntryListItem, 'tournamentId'>): string => {
  const tid = m.tournamentId ?? null;
  return tid === null ? 'none' : `t${tid}`;
};

/**
 * 轮次组键（两个视图共用）：赛事 + 轮次 + 阶段名。不同赛事的同名阶段/轮次不会并成一组；
 * **窗口不进键**——同一赛事同轮次的场次跨窗口并成一组（v6.45.1 用户裁决）。
 * 线上实测（2026-10-12，100 场）：每个 (赛事, 阶段, 轮次) 只落在 1 个窗口，无并组歧义。
 */
const roundKeyOf = (m: Pick<MatchEntryListItem, 'tournamentId' | 'round' | 'stageName'>): string =>
  `${tournamentKeyOf(m)}|${m.round}|${m.stageName ?? ''}`;

/** 赛事名：赛事库查不到时回落「赛事 #id」/「未关联赛事」（两个视图同一口径） */
function tournamentLabelOf(m: MatchEntryListItem): string {
  const tid = m.tournamentId ?? null;
  return m.tournamentName ?? (tid === null ? '未关联赛事' : `赛事 #${tid}`);
}

export function groupMatchEntries(items: MatchEntryListItem[]): MatchEntryTournamentGroup[] {
  const out: MatchEntryTournamentGroup[] = [];
  const byTournament = new Map<string, MatchEntryTournamentGroup>();
  const byRound = new Map<string, MatchEntryRoundGroup>();

  for (const m of items) {
    const tid = m.tournamentId ?? null;
    const tKey = tournamentKeyOf(m);
    let group = byTournament.get(tKey);
    if (!group) {
      group = {
        tournamentId: tid,
        label: tournamentLabelOf(m),
        rounds: [],
        matchCount: 0,
      };
      byTournament.set(tKey, group);
      out.push(group);
    }
    group.matchCount += 1;

    const rKey = roundKeyOf(m);
    let round = byRound.get(rKey);
    if (!round) {
      round = { key: rKey, label: roundGroupLabel(m), matches: [] };
      byRound.set(rKey, round);
      group.rounds.push(round);
    }
    round.matches.push(m);
  }

  return out;
}

/* ---------- 按轮次视图（v6.45.1） ---------- */

export interface MatchEntryRoundView {
  /** 组键：与赛事视图里的轮次键同源（赛事 + 轮次 + 阶段，不含窗口） */
  key: string;
  /** 轮次标题，如「第 3 轮 · 小组赛」 */
  label: string;
  /** 所属赛事名（组头里带出来，单层列表里才认得出这轮属于哪个赛事） */
  tournament: string;
  matches: MatchEntryListItem[];
}

/** 轮次 → 比赛的平铺分组：赛事维度收进组标题，方便「这一轮所有赛事一起录」 */
export function groupMatchEntriesByRound(items: MatchEntryListItem[]): MatchEntryRoundView[] {
  const out: MatchEntryRoundView[] = [];
  const byRound = new Map<string, MatchEntryRoundView>();

  for (const m of items) {
    const key = roundKeyOf(m);
    let round = byRound.get(key);
    if (!round) {
      round = { key, label: roundGroupLabel(m), tournament: tournamentLabelOf(m), matches: [] };
      byRound.set(key, round);
      out.push(round);
    }
    round.matches.push(m);
  }

  return out;
}
