// v6.46.0 球员页「比赛」页签 · 展示层纯函数测试（TC-PMV）。
// 六档均分徽章、逐场流水两行文案、窄屏副行与裁列：这些口径只在这里兜住 —— 聚合口径在 src/core/player-matches.ts。
import { describe, expect, it } from 'vitest';
import {
  NARROW_STAT_COLUMNS,
  flowEvents,
  flowTitle,
  narrowSubline,
  ratingText,
  ratingTier,
  scoreText,
  statColumns,
} from './player-matches-view.ts';
import type { PlayerMatchesCompStat, PlayerMatchesItem } from './api.ts';

function item(over: Partial<PlayerMatchesItem> = {}): PlayerMatchesItem {
  return {
    matchId: 100,
    season: 9,
    competitionType: 'league_premier',
    competitionName: '顶级联赛',
    tournamentId: 3,
    tournamentName: 'S9 顶级联赛',
    stageName: '循环赛',
    round: 12,
    stageLabel: '顶级联赛 · 循环赛 · 第 12 轮',
    date: '2026-09-20',
    homeTeam: '海港联',
    awayTeam: '北岸城',
    opponent: '北岸城',
    side: 'home',
    scoreHome: 3,
    scoreAway: 1,
    rating: 7.8,
    saves: 0,
    conceded: 1,
    cleanSheet: false,
    events: ['进球 23′', '助攻 67′'],
    missed: false,
    appeared: true,
    sources: ['growth', 'event'],
    ...over,
  };
}

function comp(over: Partial<PlayerMatchesCompStat> = {}): PlayerMatchesCompStat {
  return {
    competitionType: 'league_premier',
    competitionName: '顶级联赛',
    tournamentId: 3,
    tournamentName: 'S9 顶级联赛',
    appearances: 22,
    ratingCount: 19,
    avgRating: 7.42,
    goals: 12,
    assists: 5,
    yellow: 3,
    red: 0,
    penMiss: 0,
    ownGoal: 0,
    injuryOut: 1,
    missed: 2,
    cleanSheets: 8,
    conceded: 12,
    saves: 0,
    ...over,
  };
}

describe('ratingTier / ratingText（六档分界与文本）', () => {
  it('TC-PMV-01 六档分界取闭区间下沿（8.50 / 8.00 / 7.50 / 7.00 / 6.00）', () => {
    expect(ratingTier(10)).toBe(1);
    expect(ratingTier(8.5)).toBe(1);
    expect(ratingTier(8.49)).toBe(2);
    expect(ratingTier(8)).toBe(2);
    expect(ratingTier(7.99)).toBe(3);
    expect(ratingTier(7.5)).toBe(3);
    expect(ratingTier(7.49)).toBe(4);
    expect(ratingTier(7)).toBe(4);
    expect(ratingTier(6.99)).toBe(5);
    expect(ratingTier(6)).toBe(5);
    expect(ratingTier(5.99)).toBe(6);
    // v6.46.0 起评分入库放宽到 0–10，最低档要能兜住 0 分
    expect(ratingTier(0)).toBe(6);
  });

  it('TC-PMV-02 无评分给「—」，位数默认两位（流水用一位）', () => {
    expect(ratingText(null)).toBe('—');
    expect(ratingText(7.42)).toBe('7.42');
    expect(ratingText(7.42, 1)).toBe('7.4');
    expect(ratingText(8)).toBe('8.00');
    expect(ratingText(6, 1)).toBe('6.0');
  });
});

describe('逐场流水两行文案（flowTitle / flowEvents / scoreText）', () => {
  it('TC-PMV-03 标题 = MM-DD · 赛事·阶段·轮次 · 主/客 vs 对手', () => {
    expect(flowTitle(item())).toBe('09-20 · 顶级联赛 · 循环赛 · 第 12 轮 · 主 vs 北岸城');
    expect(flowTitle(item({ side: 'away', stageLabel: '冠军杯 · 小组赛 · 第 2 轮' }))).toBe(
      '09-20 · 冠军杯 · 小组赛 · 第 2 轮 · 客 vs 北岸城',
    );
  });

  it('TC-PMV-04 日期缺失、side/对手判不出时只少那一段，不出现空段', () => {
    expect(flowTitle(item({ date: null }))).toBe('顶级联赛 · 循环赛 · 第 12 轮 · 主 vs 北岸城');
    expect(flowTitle(item({ side: null, opponent: null }))).toBe('09-20 · 顶级联赛 · 循环赛 · 第 12 轮');
    // 有对手但 side 判不出（真实取数里 side=null 时 opponent 也为 null，这里守住不产生「undefined vs」）
    expect(flowTitle(item({ side: null }))).toBe('09-20 · 顶级联赛 · 循环赛 · 第 12 轮');
  });

  it('TC-PMV-05 事件串优先；没事件时缺阵场次回落「缺阵」，其余给「—」', () => {
    expect(flowEvents(item())).toBe('进球 23′ · 助攻 67′');
    expect(flowEvents(item({ events: ['零封', '扑救 4'] }))).toBe('零封 · 扑救 4');
    expect(flowEvents(item({ events: [], missed: true }))).toBe('缺阵（伤病停赛名单）');
    expect(flowEvents(item({ events: [], missed: false }))).toBe('—');
  });

  it('TC-PMV-06 比分缺任一侧给「—」', () => {
    expect(scoreText(item())).toBe('3 : 1');
    expect(scoreText(item({ scoreAway: null }))).toBe('—');
    expect(scoreText(item({ scoreHome: null, scoreAway: null }))).toBe('—');
  });
});

describe('窄屏裁列与副行（statColumns / narrowSubline）', () => {
  it('TC-PMV-07 场上球员八列计数、顺序与定稿一致；窄屏保留前四项', () => {
    expect(statColumns(false).map((c) => c.label)).toEqual([
      '进球',
      '助攻',
      '黄牌',
      '红牌',
      '点球未进',
      '乌龙',
      '伤退',
      '缺阵',
    ]);
    const kept = statColumns(false).slice(0, NARROW_STAT_COLUMNS).map((c) => c.label);
    expect(kept).toEqual(['进球', '助攻', '黄牌', '红牌']);
    // 被裁掉的那四项必须全在副行里，别漏
    const cut = statColumns(false).slice(NARROW_STAT_COLUMNS).map((c) => c.label);
    expect(cut).toEqual(['点球未进', '乌龙', '伤退', '缺阵']);
  });

  it('TC-PMV-08 门将变体同位置换三列（零封/失球/扑救），窄屏保留前四项', () => {
    expect(statColumns(true).map((c) => c.label)).toEqual([
      '零封',
      '失球',
      '黄牌',
      '红牌',
      '扑救',
      '乌龙',
      '伤退',
      '缺阵',
    ]);
    expect(statColumns(true).slice(0, NARROW_STAT_COLUMNS).map((c) => c.label)).toEqual(['零封', '失球', '黄牌', '红牌']);
  });

  it('TC-PMV-09 副行小字：场上「点失」在前、门将「扑救」在前，四项都在', () => {
    const c = comp({ penMiss: 1, ownGoal: 0, injuryOut: 0, missed: 2, saves: 6 });
    expect(narrowSubline(c, false)).toBe('点失 1 · 乌龙 0 · 伤退 0 · 缺阵 2');
    expect(narrowSubline(c, true)).toBe('扑救 6 · 乌龙 0 · 伤退 0 · 缺阵 2');
  });
});
