// 轻量名册解析与本地推荐（增量 26 步骤 7）。
// 名册是「姓名|俱乐部ID|球员ID」的多行文本、俱乐部为空时省略中间段 —— 解析必须从行尾反向切分，
// 否则姓名里出现 | 就会串字段（生产库里真有这种姓名，见 tests/players-library.test.ts 的名册用例）。
import { describe, expect, it } from 'vitest';
import { parseRoster, suggestPlayers, ROSTER_SUGGEST_LIMIT } from '../web/src/lib/roster.ts';
import { foldName } from '../src/core/name-fold.ts';

describe('parseRoster', () => {
  it('三段与两段行都能解析；空行跳过', () => {
    const rows = parseRoster(['B. Šeško|2|90001', 'M. Ødegaard|90002', '自由球员||90003', ''].join('\n'));
    expect(rows.map((r) => ({ id: r.id, name: r.name, clubId: r.clubId }))).toEqual([
      { id: 90001, name: 'B. Šeško', clubId: 2 },
      { id: 90002, name: 'M. Ødegaard', clubId: null },
      { id: 90003, name: '自由球员', clubId: null },
    ]);
  });

  it('姓名含分隔符时按行尾反向切分，不串字段', () => {
    const rows = parseRoster('A|B|7|1|42');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 42, name: 'A|B|7', clubId: 1 });
  });

  it('折叠列与 foldName 同源（推荐与提交后的服务端搜索命中同一批人）', () => {
    const [row] = parseRoster('B. Šeško|2|90001');
    expect(row.folded).toBe(foldName('B. Šeško'));
    expect(row.folded).toBe('b. sesko');
  });

  it('坏行丢弃：没有分隔符 / id 不是正整数 / 姓名为空', () => {
    expect(parseRoster('no-separator')).toEqual([]);
    expect(parseRoster('名字|俱乐部|abc')).toEqual([]);
    expect(parseRoster('名字|俱乐部|0')).toEqual([]);
    expect(parseRoster('|2|5')).toEqual([]);
  });
});

describe('suggestPlayers', () => {
  const entries = parseRoster(
    [
      'B. Šeško|2|1',
      'M. Šeško|2|2',
      'A. Sesko|2|3',
      'Sesko Zeta|3|4',
      'M. Ødegaard|5|5',
      'M. Müller|5|6',
      '张三|5|7',
      '',
    ].join('\n'),
  );

  it('去变音：sesko 命中四种写法，整串前缀优先于词中命中', () => {
    const got = suggestPlayers(entries, 'sesko');
    // 库里的名字多是「缩写. 姓」，所以「sesko」多半落在词中（A. Sesko / B. Šeško / M. Šeško）；
    // 只有 Sesko Zeta 是整串前缀，排最前。两类各自按折叠名序。
    expect(got.map((e) => e.id)).toEqual([4, 3, 1, 2]);
  });

  it('查询词自身带变音也命中（SESKO / Šeško 同一批）；空词不推荐', () => {
    // 折叠两侧都做：查「Šeško」与查「SESKO」折出来都是 sesko，命中集合必须一样
    expect(suggestPlayers(entries, 'SESKO').map((e) => e.id)).toEqual([4, 3, 1, 2]);
    expect(suggestPlayers(entries, 'Šeško').map((e) => e.id)).toEqual([4, 3, 1, 2]);
    expect(suggestPlayers(entries, '')).toEqual([]);
    expect(suggestPlayers(entries, '   ')).toEqual([]);
  });

  it('Ø / ü / 中文都能搜到；不匹配返回空', () => {
    expect(suggestPlayers(entries, 'odegaard').map((e) => e.id)).toEqual([5]);
    expect(suggestPlayers(entries, 'muller').map((e) => e.id)).toEqual([6]);
    expect(suggestPlayers(entries, '张').map((e) => e.id)).toEqual([7]);
    expect(suggestPlayers(entries, 'zzzz')).toEqual([]);
  });

  it('条数上限生效', () => {
    const many = parseRoster(Array.from({ length: 30 }, (_, i) => `Player ${i}|1|${i + 1}`).join('\n'));
    expect(suggestPlayers(many, 'player')).toHaveLength(ROSTER_SUGGEST_LIMIT);
    expect(suggestPlayers(many, 'player', 3)).toHaveLength(3);
  });
});
