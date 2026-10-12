// v6.45.0 成长录入列表分组 · 纯函数测试（TC-GRP）。
// 分组是展示层唯一排序口径：只按首次出现序，绝不重排服务端给的「确认时间倒序」。
import { describe, expect, it } from 'vitest';
import { groupMatchEntries, roundGroupLabel } from './growth-entry-group.ts';
import type { MatchEntryListItem } from './api.ts';

function item(over: Partial<MatchEntryListItem> & { matchId: number }): MatchEntryListItem {
  return {
    season: 3,
    windowSeq: 1,
    competitionType: 'league_premier',
    stageName: '',
    stageKind: 'round_robin',
    round: 1,
    homeTeam: '阿森纳',
    awayTeam: '曼城',
    scoreHome: 2,
    scoreAway: 1,
    finishedAt: '2026-07-03T21:00:00Z',
    confirmedAt: '2026-07-03T22:00:00Z',
    tournamentId: 5,
    tournamentName: 'S3 顶级联赛',
    homeClubId: 1,
    awayClubId: 2,
    homeIsCpu: false,
    awayIsCpu: false,
    recorded: 0,
    ...over,
  };
}

describe('TC-GRP 成长录入列表分组', () => {
  it('TC-GRP-01 同赛事同轮并组，轮次/赛事按首次出现序，matchCount 计场数', () => {
    const groups = groupMatchEntries([
      item({ matchId: 900, round: 2 }),
      item({ matchId: 901, round: 1, stageName: '常规赛' }),
      item({ matchId: 902, round: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tournamentId).toBe(5);
    expect(groups[0].label).toBe('S3 顶级联赛');
    expect(groups[0].matchCount).toBe(3);
    // 第 2 轮先出现 → 排在前面；轮次内部保持输入顺序
    expect(groups[0].rounds.map((r) => r.label)).toEqual(['第 2 轮', '第 1 轮 · 常规赛']);
    expect(groups[0].rounds[0].matches.map((m) => m.matchId)).toEqual([900, 902]);
    expect(groups[0].rounds[0].key).toBe('t5|2|');
  });

  it('TC-GRP-02 多赛事交错：赛事各自成组、轮次不跨赛事混并', () => {
    const groups = groupMatchEntries([
      item({ matchId: 900, tournamentId: 5, tournamentName: 'S3 顶级联赛', round: 1, stageName: '常规赛' }),
      item({ matchId: 910, tournamentId: 6, tournamentName: 'S3 冠军杯', round: 1, stageName: '常规赛' }),
      item({ matchId: 901, tournamentId: 5, tournamentName: 'S3 顶级联赛', round: 1, stageName: '常规赛' }),
      item({ matchId: 911, tournamentId: 6, tournamentName: 'S3 冠军杯', round: 2, stageName: '常规赛' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['S3 顶级联赛', 'S3 冠军杯']);
    expect(groups.map((g) => g.matchCount)).toEqual([2, 2]);
    expect(groups[0].rounds).toHaveLength(1); // 同名阶段+轮次的两场并成一组
    expect(groups[0].rounds[0].key).not.toBe(groups[1].rounds[0].key); // 组键带赛事前缀
    expect(groups[1].rounds.map((r) => r.label)).toEqual(['第 1 轮 · 常规赛', '第 2 轮 · 常规赛']);
  });

  it('TC-GRP-03 赛事名缺失的两种回落：无 id → 未关联赛事；有 id 查不到名 → 赛事 #id', () => {
    const groups = groupMatchEntries([
      item({ matchId: 900, tournamentId: null, tournamentName: null }),
      item({ matchId: 901, tournamentId: 7, tournamentName: null }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['未关联赛事', '赛事 #7']);
    expect(groups[0].tournamentId).toBeNull();
  });

  it('TC-GRP-04 roundGroupLabel：阶段名空/空白回落「第 N 轮」，有值接「 · 阶段」', () => {
    expect(roundGroupLabel({ round: 3, stageName: '' })).toBe('第 3 轮');
    expect(roundGroupLabel({ round: 3, stageName: '   ' })).toBe('第 3 轮');
    expect(roundGroupLabel({ round: 3, stageName: '小组赛' })).toBe('第 3 轮 · 小组赛');
  });

  it('TC-GRP-05 不改入参：原数组顺序与元素不被动（matches 保持服务端倒序）', () => {
    const input = [item({ matchId: 902, round: 2 }), item({ matchId: 900, round: 2 }), item({ matchId: 901, round: 1 })];
    const snapshot = input.map((m) => m.matchId);
    const groups = groupMatchEntries(input);
    expect(input.map((m) => m.matchId)).toEqual(snapshot);
    expect(groups[0].rounds[0].matches.map((m) => m.matchId)).toEqual([902, 900]);
  });

  it('TC-GRP-06 空列表不出组', () => {
    expect(groupMatchEntries([])).toEqual([]);
  });
});
