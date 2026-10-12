// @vitest-environment jsdom
// v6.46.0 球员页「比赛」页签 · 渲染口径测试（TC-MATCHES）：
// 11 列（门将变体换三列）、斑马纹类、合计行、逐场流水两行、窄屏裁列 + 副行、空态/失败/加载三态。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { MatchesTab } from './MatchesTab.tsx';
import type { PlayerMatchesCompStat, PlayerMatchesItem, PlayerMatchesResponse } from '../../lib/api.ts';

afterEach(cleanup);

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
    penMiss: 1,
    ownGoal: 0,
    injuryOut: 0,
    missed: 2,
    cleanSheets: 8,
    conceded: 12,
    saves: 6,
    ...over,
  };
}

function item(over: Partial<PlayerMatchesItem> = {}): PlayerMatchesItem {
  return {
    matchId: 456,
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

function payload(over: Partial<PlayerMatchesResponse> = {}): PlayerMatchesResponse {
  return {
    player: { id: 10, name: '林岸', position: null },
    seasons: [
      {
        season: 9,
        comps: [
          comp(),
          comp({
            competitionType: 'champions_cup',
            competitionName: '冠军杯',
            tournamentId: 7,
            avgRating: 6.8,
            goals: 2,
            assists: 1,
            penMiss: 0,
            ownGoal: 1,
            injuryOut: 1,
            missed: 1,
          }),
        ],
        total: comp({ competitionName: '合计', appearances: 28, avgRating: 7.15, goals: 14, assists: 6 }),
      },
    ],
    matches: [
      item(),
      item({
        matchId: 457,
        round: 10,
        stageLabel: '顶级联赛 · 循环赛 · 第 10 轮',
        date: '2026-08-30',
        scoreHome: 1,
        scoreAway: 2,
        rating: null,
        events: [],
        missed: true,
        appeared: false,
        sources: [],
      }),
    ],
    ...over,
  };
}

function q(over: Partial<UseQueryResult<PlayerMatchesResponse, Error>>): UseQueryResult<PlayerMatchesResponse, Error> {
  return { data: undefined, isPending: false, isError: false, error: null, ...over } as unknown as UseQueryResult<
    PlayerMatchesResponse,
    Error
  >;
}

function headerTexts(): string[] {
  return screen.getAllByRole('columnheader').map((th) => th.textContent ?? '');
}

describe('MatchesTab（v6.46.0）', () => {
  it('TC-MATCHES-01 场上球员表：11 列表头 + 斑马纹类 + 赛季分组行 + 赛事行 + 合计行', () => {
    const { container } = render(<MatchesTab query={q({ data: payload() })} isGk={false} narrow={false} />);

    expect(headerTexts()).toEqual([
      '赛事',
      '出场*',
      '均分',
      '进球',
      '助攻',
      '黄牌',
      '红牌',
      '点球未进',
      '乌龙',
      '伤退',
      '缺阵',
    ]);
    expect(container.querySelector('table.matches-table.zebra')).not.toBeNull();
    expect(screen.getByText('S9')).toBeDefined();
    expect(screen.getByText('冠军杯')).toBeDefined();
    expect(screen.getByText('合计')).toBeDefined();
    // 合计行：出场与均分跟着走（均分两位小数）
    expect(screen.getByText('7.15')).toBeDefined();
    expect(screen.getByText('7.42')).toBeDefined();
    // 三条脚注（出场口径 / 均分口径 / 黄牌与乌龙）
    expect(screen.getByText(/出场\* = 该场留下成长记录/)).toBeDefined();
    expect(screen.getByText(/均分 = 该赛事已录评分场次的平均/)).toBeDefined();
    expect(screen.getByText(/黄牌不含同场两黄变一红的那张/)).toBeDefined();
  });

  it('TC-MATCHES-02 门将变体：进球/助攻/点球未进 换成 零封/失球/扑救，列数仍是 11', () => {
    render(<MatchesTab query={q({ data: payload() })} isGk narrow={false} />);

    expect(headerTexts()).toEqual([
      '赛事',
      '出场*',
      '均分',
      '零封',
      '失球',
      '黄牌',
      '红牌',
      '扑救',
      '乌龙',
      '伤退',
      '缺阵',
    ]);
    expect(headerTexts()).not.toContain('进球');
  });

  it('TC-MATCHES-03 窄屏只留四项计数列，被裁信息进整行副行小字（场上点失在前 / 门将扑救在前）', () => {
    const { container, unmount } = render(<MatchesTab query={q({ data: payload() })} isGk={false} narrow />);
    expect(headerTexts()).toEqual(['赛事', '出场*', '均分', '进球', '助攻', '黄牌', '红牌']);

    // 副行必须是独立的整行（colSpan = 列数）：塞回「赛事」格会把首列撑到 144px，
    // 375px 视口下 7 列表格就要横向滚 132px（v6.46.0 实测的数）
    const first = screen.getByText('点失 1 · 乌龙 0 · 伤退 0 · 缺阵 2').closest('tr');
    expect(first?.className).toBe('matches-subrow');
    expect(first?.querySelector('td')?.getAttribute('colspan')).toBe('7');
    expect(first?.previousElementSibling?.getAttribute('class')).toBe(null);
    // 两行成对染色：第二个赛事（奇数序号）的数据行与副行一起进 .matches-alt
    const second = screen.getByText('点失 0 · 乌龙 1 · 伤退 1 · 缺阵 1').closest('tr');
    expect(second?.className).toBe('matches-subrow matches-alt');
    expect(second?.previousElementSibling?.className).toBe('matches-alt');
    // 窄屏不用 nth-child 斑马纹（每赛事两行会错位）：桌面才挂 .zebra，窄屏挂密度档 .matches-table-narrow
    const narrowTable = container.querySelector('table.matches-table');
    expect(narrowTable?.className).toBe('matches-table matches-table-narrow');
    expect(narrowTable?.className).not.toContain('zebra');
    expect(container.querySelectorAll('tbody tr.matches-alt')).toHaveLength(2);
    unmount();

    render(<MatchesTab query={q({ data: payload() })} isGk narrow />);
    expect(headerTexts()).toEqual(['赛事', '出场*', '均分', '零封', '失球', '黄牌', '红牌']);
    expect(screen.getAllByText('扑救 6 · 乌龙 0 · 伤退 0 · 缺阵 2').length).toBeGreaterThan(0);
  });

  it('TC-MATCHES-04 逐场流水：标题·比分·事件串·当场评分（一位小数、档位底色）；缺阵场次无评分给「—」', () => {
    const { container } = render(<MatchesTab query={q({ data: payload() })} isGk={false} narrow={false} />);

    expect(screen.getByText('09-20 · 顶级联赛 · 循环赛 · 第 12 轮 · 主 vs 北岸城')).toBeDefined();
    expect(screen.getByText('3 : 1')).toBeDefined();
    expect(screen.getByText('进球 23′ · 助攻 67′')).toBeDefined();
    // 7.8 → 第 3 档（7.50–7.99）；流水一位小数
    expect(container.querySelector('.rating-badge.t3')?.textContent).toBe('7.8');
    // 缺阵且无评分的场次：事件串回落 + 灰字「—」
    expect(screen.getByText('缺阵（伤病停赛名单）')).toBeDefined();
    expect(container.querySelectorAll('.rating-none').length).toBe(1);
  });

  it('TC-MATCHES-05 三态：加载中 / 失败横幅（后端文案）/ 无记录空态', () => {
    const { unmount } = render(<MatchesTab query={q({ isPending: true, data: undefined })} isGk={false} narrow={false} />);
    expect(screen.getByText('正在翻查比赛记录…')).toBeDefined();
    unmount();

    render(<MatchesTab query={q({ isError: true, error: new Error('球员不存在'), data: undefined })} isGk={false} narrow={false} />);
    expect(screen.getByText('球员不存在')).toBeDefined();
    unmount();

    render(
      <MatchesTab
        query={q({ data: { player: { id: 10, name: '林岸', position: null }, seasons: [], matches: [] } })}
        isGk={false}
        narrow={false}
      />,
    );
    expect(screen.getByText(/还没有比赛记录/)).toBeDefined();
  });
});
