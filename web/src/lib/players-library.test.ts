// @vitest-environment jsdom
// 筛选模型（web/src/lib/players-library.ts）的单测：URL 互转、排序键校验、摘要条 chips、列联动。
// 这层此前完全没有测试（vitest 的 include 不含 web/），而左栏搬家的多数逻辑都在这里。
import { describe, expect, it } from 'vitest';
import { FC26_GAME_ATTR_COLUMNS } from '../../../src/core/fc26.ts';
import { SORT_KEY_NAMES } from '../../../src/core/players-sort.ts';
import {
  ATTR_KEYS,
  COL_DEFS,
  EMPTY_FILTERS,
  FIXED_COLUMNS,
  SORT_KEYS,
  autoColsFor,
  filterChips,
  filtersFromUrl,
  filtersToQuery,
  firstOrderFor,
  isSortKey,
  parseColsParam,
  sortColumnVisible,
  type Filters,
} from './players-library.ts';

const FIRST_ATTR = 'sprintspeed';

function withQuery(query: string, run: () => void): void {
  window.history.replaceState(null, '', query === '' ? '/players' : `/players?${query}`);
  run();
}

function filters(patch: Partial<Filters>): Filters {
  return { ...EMPTY_FILTERS, ...patch };
}

describe('排序键', () => {
  it('30 个固定键，且就是后端那份表本身（不是副本）', () => {
    expect(SORT_KEYS).toHaveLength(30);
    // 同一引用：前端这份就是 core/players-sort.ts 导出的那个数组，后端 players.ts 也 import 它。
    // 断言字面量清单只会钉住硬编码副本 —— 后端加键、前端漏加时两边各自「自洽」而无人报错
    expect(SORT_KEYS).toBe(SORT_KEY_NAMES);
    expect(SORT_KEYS).toEqual([
      'id', 'uid', 'name', 'club', 'position', 'age', 'ca', 'pa', 'growable', 'influence',
      'status', 'market_value', 'badges', 'prestige', 'base_ca', 'marker', 'growth_gap', 'foot',
      'growth_tier', 'future_star', 'china_plan', 'agent_tier', 'ps', 'fc_id', 'wage',
      'release_fee', 'contract_type', 'source', 'protected', 'years',
    ]);
  });

  it('属性键白名单与后端同一份来源（fc26 的 sprintspeed 起，34 项）', () => {
    expect(ATTR_KEYS).toEqual(FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed')));
    expect(ATTR_KEYS).toHaveLength(34);
    expect(ATTR_KEYS[0]).toBe(FIRST_ATTR);
  });

  it('isSortKey 只放行固定键与白名单属性键', () => {
    for (const key of SORT_KEYS) expect(isSortKey(key), key).toBe(true);
    expect(isSortKey(`attr:${FIRST_ATTR}`)).toBe(true);
    expect(isSortKey('attr:守门员扑救')).toBe(false);
    expect(isSortKey('attr:foo')).toBe(false);
    expect(isSortKey('attr:')).toBe(false);
    expect(isSortKey('不是键')).toBe(false);
    expect(isSortKey('')).toBe(false);
  });

  it('首点方向：身份/文本/业务序升序，其余与属性列降序', () => {
    for (const key of ['id', 'uid', 'name', 'club', 'position', 'status', 'contract_type', 'source'] as const) {
      expect(firstOrderFor(key), key).toBe('asc');
    }
    for (const key of ['ca', 'pa', 'age', 'market_value', 'influence', 'badges', 'years', 'growable'] as const) {
      expect(firstOrderFor(key), key).toBe('desc');
    }
    expect(firstOrderFor(`attr:${FIRST_ATTR}`)).toBe('desc');
  });

  it('29 个键都有列承载（id 除外：它就是「没有点任何列」的默认态）', () => {
    const covered = new Set<string>([...FIXED_COLUMNS.map((c) => c.sort), ...COL_DEFS.map((d) => d.sort)]);
    for (const key of SORT_KEYS) {
      if (key === 'id') continue;
      expect(covered.has(key), `${key} 没有对应表头列，用户点不到`).toBe(true);
    }
    expect(covered.has('id'), 'id 是默认态，不该有列').toBe(false);
    expect(covered.size).toBe(SORT_KEYS.length - 1);
  });
});

describe('URL → 筛选状态', () => {
  it('空 query 得到默认态', () => {
    withQuery('', () => {
      expect(filtersFromUrl()).toEqual(EMPTY_FILTERS);
    });
  });

  it('重复的位置与 PlayStyle 去重（手写 URL 会出重复 chip 与重复 React key）', () => {
    withQuery('position=GK,GK,ST&ps=3,3,7', () => {
      const f = filtersFromUrl();
      expect(f.positions).toEqual(['GK', 'ST']);
      expect(f.ps).toEqual([3, 7]);
    });
  });

  it('位置白名单外的值被丢掉，PlayStyle 收银段（1-99）与金段（101-199），100 与越界值丢掉', () => {
    withQuery('position=GK,XX,门将&ps=0,3,abc,200', () => {
      const f = filtersFromUrl();
      expect(f.positions).toEqual(['GK']);
      expect(f.ps).toEqual([3]);
    });
    // v3.1.1 步骤 4：金徽章 ID（基础 ID+100）合法，100 是两段之间的空档、200 越界
    withQuery('ps=101,125,100,200,-1', () => {
      expect(filtersFromUrl().ps).toEqual([101, 125]);
    });
  });

  it('金段 PlayStyle 发出的 URL 也合法（银金各查各的槽，值本身就是两段的 ID）', () => {
    const q = (f: Filters) => new URLSearchParams(filtersToQuery(f));
    expect(q(filters({ ps: [3, 101] })).get('ps')).toBe('3,101');
    // 模型里混进脏值（比如手改 URL 的中间态）时不发出去：后端会 400，整个列表变错误态
    expect(q(filters({ ps: [3, 100, 200] })).get('ps')).toBe('3');
    expect(q(filters({ ps: [100] })).has('ps')).toBe(false);
  });

  it('非法 sort 回落默认 id，合法属性列排序可通过 URL 分享', () => {
    withQuery('sort=没有这个键&order=asc', () => {
      const f = filtersFromUrl();
      expect(f.sort).toBe('id');
      expect(f.order).toBe('asc');
    });
    withQuery(`sort=attr:${FIRST_ATTR}&order=asc`, () => {
      const f = filtersFromUrl();
      expect(f.sort).toBe(`attr:${FIRST_ATTR}`);
    });
  });

  it('区间值只留数字与小数点（URL 里的垃圾字符不会带着进接口）', () => {
    withQuery('ca_min=70abc&ca_max=..9&age_min=-3', () => {
      const f = filtersFromUrl();
      expect(f.caMin).toBe('70');
      expect(f.caMax).toBe('..9');
      expect(f.ageMin).toBe('-3');
    });
  });

  it('club_id / foot / growable / 布尔开关 / 保护期按白名单解析', () => {
    withQuery('club_id=free&foot=0&growable=1&is_future_star=1&china_plan=1&release_fee_none=1&protected=in', () => {
      const f = filtersFromUrl();
      expect(f.club).toBe('free');
      expect(f.foot).toBe('0');
      expect(f.growable).toBe('1');
      expect(f.futureStar).toBe(true);
      expect(f.chinaPlan).toBe(true);
      expect(f.rcNone).toBe(true);
      expect(f.protectedSel).toBe('in');
    });
    withQuery('club_id=243&growable=没有这个值&protected=两边都不算', () => {
      const f = filtersFromUrl();
      expect(f.club).toBe('243');
      expect(f.growable).toBe('all');
      expect(f.protectedSel).toBe('');
    });
  });
});

describe('筛选状态 → URL', () => {
  it('默认态只留 limit（sort/order 参数被清掉，URL 干净、返回默认态）', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe('limit=20');
  });

  it('点了列排序就写 sort 与 order', () => {
    expect(filtersToQuery(filters({ sort: 'uid', order: 'asc' }))).toBe('sort=uid&order=asc&limit=20');
    expect(filtersToQuery(filters({ sort: `attr:${FIRST_ATTR}`, order: 'desc' })))
      .toBe(`sort=attr%3A${FIRST_ATTR}&order=desc&limit=20`);
  });

  it('attr 为空时区间值不上 URL（避免留下无主条件）', () => {
    expect(filtersToQuery(filters({ attrMin: '80' }))).toBe('limit=20');
    expect(filtersToQuery(filters({ attr: FIRST_ATTR, attrMin: '80', attrMax: '99' })))
      .toBe(`attr=${FIRST_ATTR}&attr_min=80&attr_max=99&limit=20`);
  });

  it('往返一致：一组丰富的筛选过一遍 URL 回来不变', () => {
    const src = filters({
      view: 'initial',
      name: 'sesko',
      positions: ['ST', 'GK'],
      status: 'free',
      growable: '1',
      sort: 'years',
      order: 'asc',
      club: 'free',
      caMin: '70',
      mvMax: '99.5',
      attr: FIRST_ATTR,
      attrMin: '80',
      foot: '1',
      growthTier: '3',
      futureStar: true,
      agentTier: '2',
      ps: [3, 12],
      hasContract: '0',
      rcNone: true,
      contractType: 'trainee',
      source: 'import',
      protectedSel: 'out',
      yearsMin: '1.5',
      fcId: '259516',
    });
    withQuery(filtersToQuery(src), () => {
      expect(filtersFromUrl()).toEqual(src);
    });
  });
});

describe('摘要条 chips', () => {
  const CLUBS = [
    { id: 1, name: '阿森纳' },
    { id: 243, name: '皇家马德里' },
  ];

  it('默认态没有 chip', () => {
    expect(filterChips(EMPTY_FILTERS, CLUBS)).toEqual([]);
  });

  it('区间两边各自成一条，标签带单位', () => {
    const chips = filterChips(filters({ caMin: '70', caMax: '90', yearsMin: '1.5' }), CLUBS);
    expect(chips.map((c) => c.label)).toEqual(['CA ≥ 70', 'CA ≤ 90', '效力时长 ≥ 1.5 赛季']);
    expect(chips.map((c) => c.id)).toEqual(['caMin', 'caMax', 'yearsMin']);
  });

  it('每条 chip 只清掉自己：合并回 Filters 后其余字段一个都不动', () => {
    const f = filters({
      name: 'sesko',
      positions: ['ST', 'GK'],
      status: 'free',
      club: '243',
      growable: '1',
      caMin: '70',
      attr: FIRST_ATTR,
      attrMin: '80',
      ps: [3, 12],
      futureStar: true,
      yearsMax: '2',
    });
    const chips = filterChips(f, CLUBS);
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      const after = { ...f, ...chip.clear };
      for (const k of Object.keys(after) as (keyof Filters)[]) {
        if (Object.prototype.hasOwnProperty.call(chip.clear, k)) continue;
        expect(after[k], `chip「${chip.label}」动到了 ${k}`).toEqual(f[k]);
      }
      const cleared = (Object.keys(chip.clear) as (keyof Filters)[]).filter(
        (k) => JSON.stringify(after[k]) !== JSON.stringify(f[k]),
      );
      expect(cleared.length, `chip「${chip.label}」什么也没清掉`).toBeGreaterThan(0);
    }
  });

  it('位置与 PlayStyle 按类合并成一条 chip：删一条不会连另一类一起丢', () => {
    const chips = filterChips(filters({ positions: ['ST', 'GK'], ps: [3, 12] }), CLUBS);
    const pos = chips.find((c) => c.id === 'positions');
    expect(pos?.label).toBe('位置：ST、GK');
    expect(pos?.clear).toEqual({ positions: [] });
    // 3、12 都在银段 ⇒ 只出银徽章那一条
    expect(chips.filter((c) => c.id.startsWith('ps:')).map((c) => c.id)).toEqual(['ps:silver']);
    expect(chips.find((c) => c.id === 'ps:silver')?.clear).toEqual({ ps: [] });
  });

  it('银/金徽章各成一条：删银留金、删金留银，金徽章名去掉 " +" 后缀', () => {
    const chips = filterChips(filters({ ps: [1, 101] }), CLUBS);
    const silver = chips.find((c) => c.id === 'ps:silver');
    const gold = chips.find((c) => c.id === 'ps:gold');
    expect(silver?.label).toBe('银徽章：精准搓射');
    expect(gold?.label).toBe('金徽章：精准搓射');
    expect(silver?.clear).toEqual({ ps: [101] });
    expect(gold?.clear).toEqual({ ps: [1] });
    // 只有金段时同样只剩一条，且一删就清空（别退化成 clear 里留个拖不动的空银段）
    const onlyGold = filterChips(filters({ ps: [101] }), CLUBS);
    expect(onlyGold.map((c) => c.id)).toEqual(['ps:gold']);
    expect(onlyGold.find((c) => c.id === 'ps:gold')?.clear).toEqual({ ps: [] });
  });

  it('俱乐部名从目录里查，自由身与未知 id 有各自的文案；状态用中文标签、未知状态回落原名', () => {
    expect(filterChips(filters({ club: 'free' }), CLUBS)[0].label).toBe('俱乐部：自由身');
    expect(filterChips(filters({ club: '243' }), CLUBS)[0].label).toBe('俱乐部：皇家马德里');
    expect(filterChips(filters({ club: '999' }), CLUBS)[0].label).toBe('俱乐部：999');
    expect(filterChips(filters({ status: 'free' }), CLUBS)[0].label).toBe('状态：自由身');
    expect(filterChips(filters({ status: '没有这个状态' }), CLUBS)[0].label).toBe('状态：没有这个状态');
  });

  it('属性主 chip 一次清三项（属性键 + 上下限），上下限各再出一条', () => {
    const chips = filterChips(filters({ attr: FIRST_ATTR, attrMin: '80', attrMax: '99' }), CLUBS);
    const attr = chips.find((c) => c.id === 'attr');
    expect(attr?.clear).toEqual({ attr: '', attrMin: '', attrMax: '' });
    expect(chips.map((c) => c.label)).toEqual([`属性：${FIRST_ATTR}`, `${FIRST_ATTR} ≥ 80`, `${FIRST_ATTR} ≤ 99`]);
  });

  it('chip id 不重复（React key 与「按 id 找 chip」都依赖这条）', () => {
    const chips = filterChips(
      filters({
        name: 'x',
        positions: ['ST', 'GK'],
        status: 'free',
        club: '1',
        growable: '0',
        caMin: '70',
        caMax: '90',
        paMin: '60',
        paMax: '95',
        ageMin: '18',
        ageMax: '30',
        baseCaMin: '50',
        baseCaMax: '80',
        gapMin: '1',
        gapMax: '20',
        mvMin: '10',
        mvMax: '90',
        inflMin: '0.1',
        inflMax: '0.9',
        attr: FIRST_ATTR,
        attrMin: '80',
        attrMax: '99',
        foot: '1',
        growthTier: '3',
        futureStar: true,
        chinaPlan: true,
        agentTier: '2',
        ps: [3, 12],
        hasContract: '1',
        wageMin: '0.5',
        wageMax: '10',
        rcMin: '1',
        rcMax: '80',
        rcNone: true,
        contractType: 'formal',
        source: 'import',
        protectedSel: 'in',
        yearsMin: '0.5',
        yearsMax: '3',
        fcId: '259516',
      }),
      CLUBS,
    );
    expect(new Set(chips.map((c) => c.id)).size).toBe(chips.length);
    expect(chips.length).toBeGreaterThan(30);
  });

  it('view / sort / order 不是筛选条件，不出 chip', () => {
    const chips = filterChips(filters({ view: 'initial', sort: 'ca', order: 'asc' }), CLUBS);
    expect(chips).toEqual([]);
  });
});

describe('列联动与可见性', () => {
  it('筛了就自动加列，且每个自动列都能被它的排序键找到', () => {
    const f = filters({
      baseCaMin: '50',
      gapMax: '20',
      mvMin: '10',
      attr: FIRST_ATTR,
      foot: '1',
      growthTier: '3',
      futureStar: true,
      chinaPlan: true,
      agentTier: '2',
      ps: [3],
      fcId: '259516',
      hasContract: '1',
      rcNone: true,
      source: 'import',
      protectedSel: 'in',
      yearsMin: '0.5',
    });
    const cols = autoColsFor(f);
    expect(cols).toContain(`attr:${FIRST_ATTR}`);
    for (const key of cols) {
      const sortKey = key.startsWith('attr:') ? key : COL_DEFS.find((d) => d.key === key)?.sort;
      expect(sortKey, `${key} 不在 COL_DEFS 里`).toBeTruthy();
      expect(sortColumnVisible(sortKey as never, cols), `${key} 加出来了但表头点不到`).toBe(true);
    }
  });

  it('sortColumnVisible：固定列恒可见，可变列按 activeCols 判定（列键与排序键不同名）', () => {
    for (const col of FIXED_COLUMNS) {
      expect(sortColumnVisible(col.sort, []), col.label).toBe(true);
    }
    expect(sortColumnVisible('market_value', [])).toBe(false);
    expect(sortColumnVisible('market_value', ['marketValue'])).toBe(true);
    expect(sortColumnVisible(`attr:${FIRST_ATTR}`, [`attr:${FIRST_ATTR}`])).toBe(true);
    expect(sortColumnVisible(`attr:${FIRST_ATTR}`, [])).toBe(false);
  });

  it('parseColsParam 只认已知列键与白名单属性列', () => {
    expect(parseColsParam(null)).toBeNull();
    expect(parseColsParam('')).toBeNull();
    expect(parseColsParam('不是列')).toBeNull();
    expect(parseColsParam('attr:foo')).toBeNull();
    expect(parseColsParam(' marketValue , badges ')).toEqual(['marketValue', 'badges']);
    expect(parseColsParam(`marketValue,attr:${FIRST_ATTR},不是列`)).toEqual(['marketValue', `attr:${FIRST_ATTR}`]);
  });
});
