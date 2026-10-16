// FC26 队名表镜像（v6.51.8）：src/core/fc26-team-names.ts 与 web/assets/ref/team.json 逐条一致。
// 这张表是截图识别「英文队名兜底分侧」的比对基准：模型照抄截图英文（如 OLYMPIACOS FC）时用它查队号，
// 再与本场两侧 clubId（= FC26 队号）对齐；两侧报出不同的队名会让用户白点按钮，甚至判错侧。
import { describe, expect, it } from 'vitest';
import { FC26_TEAM_NAMES, fc26TeamName } from '../src/core/fc26-team-names.ts';
import teamRef from '../web/assets/ref/team.json';

describe('FC26 队名表镜像（v6.51.8）', () => {
  it('与 web/assets/ref/team.json 条数与逐条键值一致', () => {
    const refIds = teamRef.map((t) => t.id);
    expect(Object.keys(FC26_TEAM_NAMES).map(Number).sort((a, b) => a - b)).toEqual([...refIds].sort((a, b) => a - b));
    for (const entry of teamRef) {
      expect(FC26_TEAM_NAMES[entry.id], `TeamID ${entry.id}`).toBe(entry.name);
    }
  });

  it('平台现役俱乐部的英文真名钉死（截图里显示的就是这几串）', () => {
    expect(fc26TeamName(1)).toBe('Arsenal');
    expect(fc26TeamName(5)).toBe('Chelsea');
    expect(fc26TeamName(21)).toBe('FC Bayern München');
    expect(fc26TeamName(33)).toBe('TSV 1860 München');
    expect(fc26TeamName(73)).toBe('Paris Saint-Germain');
    expect(fc26TeamName(243)).toBe('Real Madrid');
    expect(fc26TeamName(280)).toBe('Olympiacos FC');
    expect(fc26TeamName(110374)).toBe('Fiorentina');
    expect(fc26TeamName(112172)).toBe('RB Leipzig');
    expect(fc26TeamName(131681)).toBe('AC Milan'); // 游戏内显示假名（Milano FC），表里存改回后的真名
    expect(fc26TeamName(99999999)).toBeNull();
  });
});
