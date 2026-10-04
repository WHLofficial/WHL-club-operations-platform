// v6.30.0 C 段：球队详情页两张球员表共享列系统的单测（列集顺序 / URL 解析 / 排序键显列 / 转会状态优先级）。
// 可选列池是「球员库 COL_DEFS 去掉 工资/解约金」派生来的，所以这里同时也钉住那条派生关系 ——
// 球员库加一列，池子自动 +1，这里的 16 项断言会先红，逼着人看一眼球队页要不要跟着放。
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import {
  CLUB_COL_ITEMS,
  CLUB_OPTIONAL_COLS,
  REG_COLS_KEY,
  REG_FIXED_COLS,
  SQUAD_COLS_KEY,
  SQUAD_FIXED_COLS,
  clubColDef,
  clubVisibleCols,
  parseClubColsParam,
  renderClubCol,
  toggleClubCol,
  transferStatusOf,
  type ClubColRow,
} from './club-columns.tsx';
import { COL_DEFS } from './players-library.ts';

describe('固定列（v6.30.0 C 段）', () => {
  it('阵容名单 11 列：键与文案逐列一致、顺序不可改', () => {
    expect(SQUAD_FIXED_COLS).toHaveLength(11);
    expect(SQUAD_FIXED_COLS.map((c) => c.key)).toEqual([
      'marker',
      'no',
      'uid',
      'name',
      'age',
      'positions',
      'ca',
      'pa',
      'releaseFee',
      'wage',
      'transferStatus',
    ]);
    expect(SQUAD_FIXED_COLS.map((c) => c.label)).toEqual([
      '标记',
      '号码',
      'UID',
      '姓名',
      '年龄',
      '位置',
      'CA',
      'PA',
      '违约金',
      '工资',
      '转会状态',
    ]);
  });

  it('注册名单 11 列：分配必须最左，其余与阵容名单同序但无转会状态', () => {
    expect(REG_FIXED_COLS).toHaveLength(11);
    expect(REG_FIXED_COLS.map((c) => c.key)).toEqual([
      'assignment',
      'marker',
      'no',
      'uid',
      'name',
      'age',
      'positions',
      'ca',
      'pa',
      'releaseFee',
      'wage',
    ]);
    expect(REG_FIXED_COLS[0]!.label).toBe('分配');
    expect(REG_FIXED_COLS.slice(1)).toEqual(SQUAD_FIXED_COLS.filter((c) => c.key !== 'transferStatus'));
  });
});

describe('可选列池（默认全不显示）', () => {
  it('16 项 = 球员库 COL_DEFS 去掉工资/解约金，顺序保持不变', () => {
    expect(CLUB_OPTIONAL_COLS).toHaveLength(16);
    expect(CLUB_OPTIONAL_COLS).toEqual(COL_DEFS.filter((d) => d.key !== 'wage' && d.key !== 'releaseFee'));
    expect(CLUB_OPTIONAL_COLS.map((d) => d.key)).toEqual([
      'marketValue',
      'badges',
      'prestige',
      'baseCa',
      'growthGap',
      'foot',
      'growthTier',
      'futureStar',
      'chinaPlan',
      'agentTier',
      'ps',
      'fcId',
      'contractType',
      'source',
      'protected',
      'years',
    ]);
  });

  it('「列」开关的条目与池子一一对应（顺序 = 面板顺序）', () => {
    expect(CLUB_COL_ITEMS).toEqual(CLUB_OPTIONAL_COLS.map((d) => ({ value: d.key, label: d.label })));
  });

  it('没参数 / 空参数 → 一列不显示', () => {
    expect(parseClubColsParam(null)).toBeNull();
    expect(parseClubColsParam('')).toBeNull();
    expect(clubVisibleCols(null)).toEqual([]);
    expect(clubVisibleCols('')).toEqual([]);
  });

  it('坏值与池子外的键一律忽略：工资/解约金（已升固定列）、球员库的 attr: 列、瞎写的键', () => {
    expect(clubVisibleCols('wage,releaseFee')).toEqual([]);
    expect(parseClubColsParam('attr:ca')).toBeNull();
    expect(parseClubColsParam('nope,,bad')).toBeNull();
    expect(clubVisibleCols('badges,nope,foot')).toEqual(['badges', 'foot']);
    // 键前后的空格照球员库 parseColsParam 的口径先 trim 再判
    expect(clubVisibleCols(' wage , badges ')).toEqual(['badges']);
  });

  it('合法值原样保留（显示顺序跟参数走）', () => {
    expect(parseClubColsParam('foot,badges')).toEqual(['foot', 'badges']);
  });

  it('两套 URL 键分开：阵容名单 cols / 注册名单 regcols（两表在不同页签，防串味）', () => {
    expect(SQUAD_COLS_KEY).toBe('cols');
    expect(REG_COLS_KEY).toBe('regcols');
  });
});

describe('排序键落在可选列时自动显列（照球员库 sortColumnVisible 的语义）', () => {
  it('可选列：没选上就补一列，已选上不重复补', () => {
    expect(clubVisibleCols(null, 'market_value')).toEqual(['marketValue']);
    expect(clubVisibleCols(null, 'foot')).toEqual(['foot']);
    expect(clubVisibleCols('foot,badges', 'market_value')).toEqual(['foot', 'badges', 'marketValue']);
    expect(clubVisibleCols('marketValue', 'market_value')).toEqual(['marketValue']);
  });

  it('固定列承载的排序键：固定列恒在，不用补任何可选列', () => {
    for (const key of ['uid', 'marker', 'name', 'position', 'age', 'ca', 'pa', 'release_fee', 'wage'] as const) {
      expect(clubVisibleCols(null, key)).toEqual([]);
    }
  });

  it('换算不出列的排序键不补列（球队页两张表都没有排序，属防御）', () => {
    expect(clubVisibleCols(null, 'id')).toEqual([]);
    expect(clubVisibleCols(null, 'status')).toEqual([]);
  });
});

describe('转会状态四态与优先级（阵容名单第 11 列）', () => {
  const base = { notForSale: false, status: 'normal', transferListed: false, transferPriced: false };

  it('四态各自成立', () => {
    expect(transferStatusOf({ ...base, status: 'listed' })).toBe('listed');
    expect(transferStatusOf({ ...base, transferListed: true })).toBe('transferListed');
    expect(transferStatusOf({ ...base, transferPriced: true })).toBe('transferPriced');
    expect(transferStatusOf({ ...base, notForSale: true })).toBe('notForSale');
  });

  it('一个都不占 → null（单元格出「—」）', () => {
    expect(transferStatusOf(base)).toBeNull();
    expect(transferStatusOf({ ...base, status: 'trainee' })).toBeNull();
    expect(transferStatusOf({ ...base, transferPriced: undefined })).toBeNull();
  });

  it('优先级：非卖品 > 挂牌中 > 转会名单 > 已标价', () => {
    const all = { notForSale: true, status: 'listed', transferListed: true, transferPriced: true };
    expect(transferStatusOf(all)).toBe('notForSale');
    // 非卖品 + 挂牌中 → 取锁
    expect(transferStatusOf({ ...base, notForSale: true, status: 'listed' })).toBe('notForSale');
    // 挂牌中 + 已标价 → 取拍卖锤
    expect(transferStatusOf({ ...base, status: 'listed', transferPriced: true })).toBe('listed');
    // 转会名单 + 已标价 → 取清单
    expect(transferStatusOf({ ...base, transferListed: true, transferPriced: true })).toBe('transferListed');
    // 非卖品之外三态全占，非卖品也赢
    expect(transferStatusOf({ ...base, notForSale: true, transferListed: true, transferPriced: true })).toBe('notForSale');
  });
});

describe('「列」开关的勾选与表头文案', () => {
  it('toggleClubCol 追加 / 移除，且不改原数组', () => {
    const cols = ['foot'];
    expect(toggleClubCol(cols, 'badges')).toEqual(['foot', 'badges']);
    expect(toggleClubCol(cols, 'foot')).toEqual([]);
    expect(cols).toEqual(['foot']);
  });

  it('clubColDef 认得出的键给中文名与对齐方式，认不出的回落原键（宁可见到怪名）', () => {
    expect(clubColDef('marketValue')).toMatchObject({ label: '身价', num: true });
    expect(clubColDef('foot')).toMatchObject({ label: '惯用脚' });
    expect(clubColDef('mystery')).toEqual({ label: 'mystery' });
  });
});

describe('可选列单元格渲染（与球员库共用一份，元素级断言不用 DOM）', () => {
  /** renderClubCol 返回 ReactElement —— React 19 的类型里 props 是 unknown，取子节点前先收窄 */
  const childOf = (key: string, p: ClubColRow): unknown =>
    (renderClubCol(key, p) as ReactElement<{ children?: unknown }>).props.children;

  const row: ClubColRow = {
    marketValue: 12.5,
    badgesSilver: 0,
    badgesGold: 0,
    prestige: 3,
    baseCa: 78,
    ca: 80,
    pa: 88,
    foot: 0,
    growthTier: 2,
    isFutureStar: true,
    chinaPlan: false,
    agentTier: 1,
    fcId: 239085,
    releaseFee: 30,
    wage: 0.75,
    contractType: 'formal',
    source: null,
    protected: false,
    serviceSeasons: 1.5,
  };

  it('常规列出内容（含单位与文案）', () => {
    expect(childOf('foot', row)).toBe('左脚');
    expect(childOf('futureStar', row)).toBe('★');
    expect(childOf('years', row)).toBe('1.5 赛季');
  });

  it('球队页的行可能缺值（/api/club/squad 的 ca/pa/foot 等列为 NULL）→ 出「—」不炸', () => {
    const bare: ClubColRow = { ...row, ca: null, pa: null, foot: null, growthTier: null, serviceSeasons: null };
    expect(childOf('growthGap', bare)).toBe('—');
    expect(childOf('foot', bare)).toBe('—');
    expect(childOf('growthTier', bare)).toBe('—');
    expect(childOf('years', bare)).toBe('—');
  });

  it('认不出的列键出「—」', () => {
    expect(childOf('mystery', row)).toBe('—');
  });
});
