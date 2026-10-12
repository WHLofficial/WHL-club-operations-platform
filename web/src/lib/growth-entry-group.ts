// v6.45.0 成长录入列表分组：赛事 → 轮次 → 比赛，纯函数（不改入参顺序、不排序）。
// 列表来自服务端「确认时间倒序」的近 50 场，分组按首次出现顺序排——也就是最近的赛事/轮次在最上面。
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

export function groupMatchEntries(items: MatchEntryListItem[]): MatchEntryTournamentGroup[] {
  const out: MatchEntryTournamentGroup[] = [];
  const byTournament = new Map<string, MatchEntryTournamentGroup>();
  const byRound = new Map<string, MatchEntryRoundGroup>();

  for (const m of items) {
    const tid = m.tournamentId ?? null;
    const tKey = tid === null ? 'none' : `t${tid}`;
    let group = byTournament.get(tKey);
    if (!group) {
      group = {
        tournamentId: tid,
        label: m.tournamentName ?? (tid === null ? '未关联赛事' : `赛事 #${tid}`),
        rounds: [],
        matchCount: 0,
      };
      byTournament.set(tKey, group);
      out.push(group);
    }
    group.matchCount += 1;

    // 轮次键带赛事前缀：不同赛事的同名阶段/轮次不会并成一组
    const rKey = `${tKey}|${m.round}|${m.stageName ?? ''}`;
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
