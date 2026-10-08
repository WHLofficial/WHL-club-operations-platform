// v6.37.0 卡片化纯函数层测试：位置分组、徽章优先级、激活价镜像、金额整数显示、四视图列。
import { describe, expect, it } from 'vitest';
import {
  CARD_BUILTIN_COL_KEYS,
  CARD_VIEW_CELLS,
  DESKTOP_CELLS,
  DESKTOP_CELLS_DESK,
  activationFeeOf,
  groupRowsByPosition,
  inlineBadgesOf,
  moneyIntText,
  positionSummary,
  type CardMetricRow,
} from './club-cards.ts';
import { VIEW_COL_WIDTH, VIEW_GRID_COLS } from '../pages/club/card-parts.tsx';

describe('窄屏网格列配置（v6.37.2 两行式）', () => {
  it('列数 = 各视图值数（值区整行 1fr 均分、任何视图值不折行），列宽表保留给桌面链路', () => {
    expect(VIEW_GRID_COLS).toEqual({ basic: 3, growth: 3, contract: 4, market: 3 });
    expect(Object.keys(VIEW_COL_WIDTH).sort()).toEqual(Object.keys(VIEW_GRID_COLS).sort());
    expect(VIEW_COL_WIDTH.contract).toBe('60px');
  });
});

describe('位置四组容器', () => {
  it('RB/CB/LB 落后卫、CDM/CM/CAM 落中场、ST 落前锋、GK 落门将；档序后场→前场', () => {
    const rows = [
      { id: 1, position: 'ST' },
      { id: 2, position: 'CB' },
      { id: 3, position: 'GK' },
      { id: 4, position: 'CM' },
      { id: 5, position: 'LB' },
      { id: 6, position: 'CDM' },
    ];
    const groups = groupRowsByPosition(rows);
    expect(groups.map((g) => g.key)).toEqual(['GK', 'DF', 'MF', 'FW']);
    expect(groups.map((g) => g.label)).toEqual(['门将', '后卫', '中场', '前锋']);
    expect(groups[1]!.rows.map((r) => r.id)).toEqual([2, 5]);
    expect(groups[2]!.rows.map((r) => r.id)).toEqual([4, 6]);
  });

  it('空组丢弃；未知/null 位置殿后单独成组「其他」', () => {
    const groups = groupRowsByPosition([
      { id: 1, position: 'CB' },
      { id: 2, position: null },
      { id: 3, position: 'XXO' },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['DF', 'unknown']);
    expect(groups[1]!.label).toBe('其他');
    expect(groups[1]!.rows.map((r) => r.id)).toEqual([2, 3]);
  });

  it('空输入出空数组（不产空组）', () => {
    expect(groupRowsByPosition([])).toEqual([]);
  });
});

describe('行内徽章优先级（定稿：状态 > 保护期 > 未来之星 > 中国计划）', () => {
  const base = { status: 'normal', contractType: 'formal', protected: false, isFutureStar: false, chinaPlan: false };

  it('四态优先级照抄 transferStatusOf：非卖品 > 挂牌中 > 转会名单 > 已标价', () => {
    expect(inlineBadgesOf({ ...base, notForSale: true, status: 'listed', transferListed: true, transferPriced: true })[0]).toEqual({
      kind: 'status',
      text: '非卖品',
    });
    expect(inlineBadgesOf({ ...base, status: 'listed', transferListed: true })[0]!.text).toBe('挂牌中');
    expect(inlineBadgesOf({ ...base, transferListed: true, transferPriced: true })[0]!.text).toBe('转会名单');
    expect(inlineBadgesOf({ ...base, transferPriced: true })[0]!.text).toBe('已标价');
  });

  it('注册行：无合同属状态类且优先；退役最优先；无合同的人不出保护期', () => {
    const bare = inlineBadgesOf({ ...base, hasContract: false, contractType: null, isFutureStar: true, chinaPlan: true, protected: true });
    expect(bare.map((b) => b.text)).toEqual(['无合同', '未来之星', '中国计划']);
    expect(inlineBadgesOf({ ...base, status: 'retired' })[0]!.text).toBe('退役');
    // 四态 > 无合同（挂牌/标价以合同在身为前提，交叉行按四态优先显示；变异验证发现的钉子）
    expect(inlineBadgesOf({ ...base, hasContract: false, notForSale: true })[0]!.text).toBe('非卖品');
  });

  it('保护期只在有合同时出现；四类齐出时数组顺序即优先级', () => {
    const full = inlineBadgesOf({ ...base, protected: true, isFutureStar: true, chinaPlan: true });
    expect(full.map((b) => b.kind)).toEqual(['protect', 'star', 'china']);
    expect(inlineBadgesOf({ ...base, contractType: null, protected: true })).toEqual([]);
  });
});

describe('激活价前端镜像', () => {
  it('训练营固定 5m', () => {
    expect(activationFeeOf({ hasContract: true, contractType: 'trainee', protected: false, releaseFee: 5 })).toBe(5);
  });

  it('保护期 ×2（≤20）/ ×1.5（>20），1.5 倍的 .5 四舍五入；无保护 ×1', () => {
    expect(activationFeeOf({ hasContract: true, contractType: 'formal', protected: true, releaseFee: 20 })).toBe(40);
    expect(activationFeeOf({ hasContract: true, contractType: 'formal', protected: true, releaseFee: 21 })).toBe(32);
    expect(activationFeeOf({ hasContract: true, contractType: 'formal', protected: false, releaseFee: 21 })).toBe(21);
  });

  it('无合同 / 无违约金 / 违约金 ≤0 → null（定不了价）', () => {
    expect(activationFeeOf({ hasContract: false, contractType: null, protected: false, releaseFee: 20 })).toBeNull();
    expect(activationFeeOf({ hasContract: true, contractType: 'formal', protected: false, releaseFee: null })).toBeNull();
    expect(activationFeeOf({ hasContract: true, contractType: 'formal', protected: false, releaseFee: 0 })).toBeNull();
  });
});

describe('金额整数显示', () => {
  it('去尾零不做取舍并带单位 m（v6.37.2）：37→37m、12.5→12.5m、12.75→12.75m；null→null', () => {
    expect(moneyIntText(37)).toBe('37m');
    expect(moneyIntText(12.5)).toBe('12.5m');
    expect(moneyIntText(12.75)).toBe('12.75m');
    expect(moneyIntText(null)).toBeNull();
  });
});

describe('位置副行文案', () => {
  it('单位置原样；多位默认「主位置 +N」、展开全量逗号分隔；空数组 null', () => {
    expect(positionSummary(['CB'], false)).toBe('CB');
    expect(positionSummary(['CB', 'RB', 'LB'], false)).toBe('CB +2');
    expect(positionSummary(['CB', 'RB', 'LB'], true)).toBe('CB, RB, LB');
    expect(positionSummary([], false)).toBeNull();
  });
});

describe('四视图列与桌面全列', () => {
  it('基本 3 / 成长 3 / 合同 4 / 市场 3；桌面 = 依序合并 13 列', () => {
    expect(CARD_VIEW_CELLS.basic.map((c) => c.key)).toEqual(['age', 'ca', 'pa']);
    expect(CARD_VIEW_CELLS.growth.map((c) => c.key)).toEqual(['baseCa', 'growthGap', 'growthTier']);
    expect(CARD_VIEW_CELLS.contract.map((c) => c.key)).toEqual(['wage', 'releaseFee', 'activation', 'years']);
    expect(CARD_VIEW_CELLS.market.map((c) => c.key)).toEqual(['marketValue', 'influence', 'agent']);
    expect(DESKTOP_CELLS).toHaveLength(13);
    expect(DESKTOP_CELLS.map((c) => c.key)).toEqual([
      'age', 'ca', 'pa',
      'baseCa', 'growthGap', 'growthTier',
      'wage', 'releaseFee', 'activation', 'years',
      'marketValue', 'influence', 'agent',
    ]);
  });

  it('注册台桌面列 = 全列舍「初始CA」「成长空间」共 11 列（v6.39.2 用户裁决：单行放下）', () => {
    expect(DESKTOP_CELLS_DESK).toHaveLength(11);
    expect(DESKTOP_CELLS_DESK.map((c) => c.key)).toEqual([
      'age', 'ca', 'pa',
      'growthTier',
      'wage', 'releaseFee', 'activation', 'years',
      'marketValue', 'influence', 'agent',
    ]);
    // 舍的正是这两列、不是别的；且保序（仍 basic→growth→contract→market 依序）
    expect(DESKTOP_CELLS_DESK.filter((c) => c.key === 'baseCa' || c.key === 'growthGap')).toEqual([]);
    expect(DESKTOP_CELLS_DESK.map((c) => c.key)).toEqual(
      DESKTOP_CELLS.map((c) => c.key).filter((k) => k !== 'baseCa' && k !== 'growthGap'),
    );
  });

  it('取值口径：成长空间 = PA−CA、档位 T1–T3（0 显 —）、效力带年（v6.38.1 赛季→年）、经纪人档位中文名', () => {
    const row = {
      age: 24, ca: 84, pa: 89, baseCa: 84, growthTier: 2,
      wage: 1.25, releaseFee: 45, serviceSeasons: 1.5,
      contractType: 'formal', protected: false,
      marketValue: 52.5, influence: 3.14159, agentTier: 3,
    };
    expect(CARD_VIEW_CELLS.growth.map((c) => c.get(row))).toEqual(['84', '5', 'T2']);
    expect(CARD_VIEW_CELLS.contract.map((c) => c.get(row))).toEqual(['1.25m', '45m', '45m', '1.5年']);
    expect(CARD_VIEW_CELLS.market.map((c) => c.get(row))).toEqual(['52.50m', '3.14', '苛刻']);
    expect(CARD_VIEW_CELLS.growth[2]!.get({ ...row, growthTier: 0 })).toBeNull();
    expect(CARD_VIEW_CELLS.basic[1]!.get({ ...row, ca: null })).toBeNull();
  });

  it('分段配色适用域（v6.38.1）：shade 只给 0-99 能力值刻度列（CA/PA/初始CA），年龄/差值/金额/效力/文本不设', () => {
    const row = { age: 31, ca: 45, pa: 92, baseCa: 88, wage: 1, releaseFee: 12, serviceSeasons: 0.5, influence: 2 } as unknown as CardMetricRow;
    expect(CARD_VIEW_CELLS.basic.find((c) => c.key === 'ca')!.shade!(row)).toBe(45);
    expect(CARD_VIEW_CELLS.basic.find((c) => c.key === 'pa')!.shade!(row)).toBe(92);
    expect(CARD_VIEW_CELLS.growth.find((c) => c.key === 'baseCa')!.shade!(row)).toBe(88);
    for (const c of [
      CARD_VIEW_CELLS.basic.find((x) => x.key === 'age'),
      CARD_VIEW_CELLS.growth.find((x) => x.key === 'growthGap'),
      CARD_VIEW_CELLS.contract.find((x) => x.key === 'wage'),
      CARD_VIEW_CELLS.contract.find((x) => x.key === 'years'),
      CARD_VIEW_CELLS.market.find((x) => x.key === 'influence'),
    ]) expect(c!.shade).toBeUndefined();
    // 缺值（null）也在适用域内可表达：返回 null ⇒ 渲染层套中性墨色
    expect(
      CARD_VIEW_CELLS.basic
        .find((c) => c.key === 'ca')!
        .shade!({ ...row, ca: null } as unknown as CardMetricRow),
    ).toBeNull();
  });

  it('API 漂移守卫：行缺字段（undefined）一律降级 null 显 —，绝不抛错崩整页（e2e ⑨ 教训）', () => {
    const drifted = {} as unknown as CardMetricRow;
    for (const cell of DESKTOP_CELLS) {
      expect(() => cell.get(drifted), cell.key).not.toThrow();
      expect(cell.get(drifted), cell.key).toBeNull();
    }
    // 局部缺失也一样：只有 influence 缺时其余列照常出值
    const noInfluence = {
      age: 24, ca: 80, pa: 85, baseCa: 80, growthTier: 1, wage: 1, releaseFee: 10,
      serviceSeasons: 1, marketValue: 20, agentTier: 1, contractType: 'formal', protected: false,
    } as unknown as CardMetricRow;
    expect(CARD_VIEW_CELLS.market[1]!.get(noInfluence)).toBeNull();
    expect(CARD_VIEW_CELLS.market[0]!.get(noInfluence)).toBe('20.00m');
    expect(moneyIntText(undefined as unknown as null)).toBeNull();
    expect(activationFeeOf({ contractType: 'formal', protected: true, releaseFee: undefined as unknown as null })).toBeNull();
  });

  it('内置列键集合：长尾自选池剔除 8 个内置键（工资/违约金在列）', () => {
    for (const key of ['baseCa', 'growthGap', 'growthTier', 'wage', 'releaseFee', 'years', 'marketValue', 'agentTier']) {
      expect(CARD_BUILTIN_COL_KEYS.has(key), key).toBe(true);
    }
    for (const key of ['badges', 'prestige', 'foot', 'futureStar', 'chinaPlan', 'ps', 'fcId', 'contractType', 'source', 'protected']) {
      expect(CARD_BUILTIN_COL_KEYS.has(key), key).toBe(false);
    }
  });
});
