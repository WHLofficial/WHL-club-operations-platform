// v6.19.0 球员库移动端卡片化 + 全仓五档配色：前端纯函数层测试。
// 放 web/src/lib（根 tsconfig 有 DOM；tests/ 是 node+workers-types 语义，import 用 window 的
// web 模块会 TS2304，给 tsconfig.tests 加 DOM lib 又与 workers-types 的 CacheStorage 冲突）。
// TC 编号与预期对应 docs/test-plans/v6.19.0-players-mobile-cards.md。
// lensChips / SORT_KEY_LABELS / money 组在卡片网格提交落地后补进本文件。
import { describe, expect, it } from 'vitest';
import type { PlayerLibraryRow } from './api.ts';
import {
  EMPTY_FILTERS,
  LENS_WHITELIST,
  SORT_KEYS,
  SORT_KEY_LABELS,
  attrClass,
  lensChips,
  money,
  sortLabel,
  type Filters,
} from './players-library.ts';

describe('attrClass 五档分段（sofifa 实测口径，阈值 50/60/70/80）', () => {
  it('TC-AC-01 · 八个边界值各归对档', () => {
    expect(attrClass(50)).toBe('attr-bad');
    expect(attrClass(51)).toBe('attr-weak');
    expect(attrClass(60)).toBe('attr-weak');
    expect(attrClass(61)).toBe('attr-mid');
    expect(attrClass(70)).toBe('attr-mid');
    expect(attrClass(71)).toBe('attr-solid');
    expect(attrClass(80)).toBe('attr-solid');
    expect(attrClass(81)).toBe('attr-good');
  });

  it('TC-AC-02 · 域端点与类名退役', () => {
    expect(attrClass(0)).toBe('attr-bad');
    expect(attrClass(99)).toBe('attr-good');
    const all = new Set([0, 25, 50, 51, 55, 60, 61, 65, 70, 71, 75, 80, 81, 90, 99].map(attrClass));
    expect([...all].sort()).toEqual(['attr-bad', 'attr-good', 'attr-mid', 'attr-solid', 'attr-weak']);
  });
});

// ---- v6.19.0 卡片纯函数层：lensChips（受筛选项）/ SORT_KEY_LABELS + sortLabel / money ----

function filters(patch: Partial<Filters>): Filters {
  return { ...EMPTY_FILTERS, ...patch };
}

// 行夹具：PlayerLibraryRow 的必填字段全给合理初值，用例只覆写关心的那几个
function row(patch: Partial<PlayerLibraryRow> = {}): PlayerLibraryRow {
  return {
    id: 1,
    uid: 'uid-1',
    name: '测试球员',
    number: null,
    clubId: null,
    position: 'ST',
    age: 25,
    ca: 70,
    pa: 80,
    prestige: null,
    marketValue: null,
    status: 'free',
    growthTier: 1,
    isFutureStar: false,
    chinaPlan: false,
    agentTier: 2,
    badgesSilver: 0,
    badgesGold: 0,
    marker: null,
    // v6.30.0 列表行新增的转会三态摘要（PlayerListItem 必填）
    transferListed: false,
    notForSale: false,
    transferPriced: false,
    growable: true,
    clubName: null,
    // v6.39.3：队徽 R2 键（无徽回落哈希色块）
    clubLogoKey: null,
    positions: ['ST'],
    influence: 0,
    wage: null,
    releaseFee: null,
    contractType: null,
    foot: 1,
    baseCa: null,
    fcId: null,
    source: null,
    serviceSeasons: null,
    protected: false,
    ...patch,
  };
}

describe('lensChips 透镜（卡片受筛选项行）', () => {
  it('TC-LEN-01 · attr 筛选优先且单条', () => {
    // 排序键 prestige 也在白名单，但 attr 筛选非空时被压制：恰一条属性行
    const chips = lensChips(filters({ attr: 'dribbling', sort: 'prestige' }), row({ attrValue: 79, prestige: 5 }));
    expect(chips).toHaveLength(1);
    expect(chips).toEqual([{ label: '盘带', value: '79', raw: 79, colored: true }]);
  });

  it('TC-LEN-02 · 排序键命中白名单', () => {
    // 声望是 0-10 域，不是 0-99 能力值刻度，保持中性墨色
    const chips = lensChips(filters({ sort: 'prestige' }), row({ prestige: 6 }));
    expect(chips).toHaveLength(1);
    expect(chips).toEqual([{ label: '声望', value: '6', raw: 6, colored: false }]);
  });

  it('TC-LEN-03 · 筛选维度补位', () => {
    // 白名单 = spec §3 的 7 个维度，顺序即补位顺序
    expect([...LENS_WHITELIST]).toEqual(['prestige', 'base_ca', 'growth_gap', 'wage', 'release_fee', 'years', 'agent_tier']);
    // 排序键 ca 不在白名单：由生效筛选维度 base_ca 补位（初始 CA 是 0-99 域，套色）
    const chips = lensChips(filters({ sort: 'ca', baseCaMin: '80' }), row({ baseCa: 82 }));
    expect(chips).toHaveLength(1);
    expect(chips).toEqual([{ label: '初始 CA', value: '82', raw: 82, colored: true }]);
  });

  it('TC-LEN-04 · 排序键 + 筛选维度去重', () => {
    // 排序键与筛选维度同为 wage：只出一条，排序键优先占据候选位
    const chips = lensChips(filters({ sort: 'wage', wageMin: '1' }), row({ wage: 2.5 }));
    expect(chips).toHaveLength(1);
    expect(chips).toEqual([{ label: '工资', value: '2.50m', raw: 2.5, colored: false }]);
  });

  it('TC-LEN-05 · 上限 2 条', () => {
    // 三处命中（排序 base_ca + gap 维度 + wage 维度）：截到 2 条，排序键在最前
    const chips = lensChips(
      filters({ sort: 'base_ca', gapMin: '10', wageMin: '1' }),
      row({ baseCa: 60, ca: 70, pa: 80, wage: 1.5 }),
    );
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.label)).toEqual(['初始 CA', '成长空间']);
    expect(chips.map((c) => c.value)).toEqual(['60', '10']);
  });

  it('TC-LEN-06 · 空集不渲染', () => {
    // 排序键 ca 不在白名单；生效筛选（身价 / 影响力）也不在 → 卡片不渲染这一行
    expect(lensChips(filters({ sort: 'ca', mvMin: '1', inflMin: '0' }), row())).toEqual([]);
    // 默认态（EMPTY_FILTERS：排序 id、无筛选）同样空集
    expect(lensChips(filters({}), row())).toEqual([]);
  });

  it('TC-LEN-07 · attrValue 缺失回退', () => {
    // attr 筛选中但行没带 attrValue（后端只在 attr 筛选时回这个字段，行夹具默认 undefined）→ '—' / null
    const chips = lensChips(filters({ attr: 'finishing' }), row());
    expect(chips).toEqual([{ label: '终结', value: '—', raw: null, colored: false }]);
  });

  it('TC-LEN-08 · 三来源同击取 attr', () => {
    // 最大组合：attr 筛选 + 排序键白名单 + 筛选维度白名单（三个来源都命中）→ attr 优先，恰一条
    const chips = lensChips(
      filters({ attr: 'dribbling', sort: 'wage', baseCaMin: '70' }),
      row({ attrValue: 88, wage: 3, baseCa: 75 }),
    );
    expect(chips).toHaveLength(1);
    expect(chips).toEqual([{ label: '盘带', value: '88', raw: 88, colored: true }]);
  });

  it('TC-LEN-09 · growth_gap 不套色', () => {
    // 成长空间是差值（PA-CA），不是能力值刻度：即使落在 0-99 数值区间也不套五档色
    const chips = lensChips(filters({ sort: 'growth_gap' }), row({ ca: 60, pa: 90 }));
    expect(chips).toEqual([{ label: '成长空间', value: '30', raw: 30, colored: false }]);
  });
});

describe('SORT_KEY_LABELS 与排序行文案', () => {
  it('TC-SKL-01 · SORT_KEY_LABELS 覆盖 SORT_KEYS 全集', () => {
    for (const key of SORT_KEYS) {
      const label = SORT_KEY_LABELS[key];
      expect(typeof label === 'string' && label.length > 0, `排序键 ${key} 没有中文标签，下拉会出 undefined`).toBe(true);
    }
    expect(SORT_KEY_LABELS.id).toBe('默认顺序');
    // 表里也不许有空标签（Record 类型挡不住手写漏值）
    expect(Object.values(SORT_KEY_LABELS).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('TC-SKL-02 · attr 动态键拼接', () => {
    expect(sortLabel('attr:dribbling')).toBe('属性·盘带');
    // 非白名单属性键原样返回（手改 URL 的非法态，不拼「属性·undefined」）
    expect(sortLabel('attr:foo')).toBe('attr:foo');
    // 固定键走 SORT_KEY_LABELS（含 id 的「默认顺序」）
    expect(sortLabel('id')).toBe('默认顺序');
    expect(sortLabel('base_ca')).toBe(SORT_KEY_LABELS.base_ca);
  });
});

describe('money 金额文案', () => {
  it('TC-MONEY-01 · money(null) 与两位小数', () => {
    expect(money(null)).toBe('—');
    expect(money(1234)).toBe('1234.00m');
  });

  it('TC-MONEY-02 · 行为不回归', () => {
    // 0 是有效金额、不是「无值」（页面原本地副本就是这个口径，搬家不许顺手改成 ?? 判空）
    expect(money(0)).toBe('0.00m');
    expect(money(0.5)).toBe('0.50m');
  });
});
