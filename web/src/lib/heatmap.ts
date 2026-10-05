// 位置热区图拓扑与状态（v6.35.0，spec §1.1/§2）：静态坐标照视觉终稿屏
// .superpowers/brainstorm/43039-1791178761/content/heatmap-flatten-v2.html 逐值抄录。
// 语义 = 可踢位置分布（不是比赛跑动热图）；SVG 由 components/PositionHeatmap.tsx 手绘，不引 echarts。
export const HEAT_VIEW = { w: 245, h: 200 } as const;

// 12 位置码：与 lib/players-library.ts 的 POSITIONS 同集合（测试锁同源防漂移）
export const HEAT_CODES = ['GK', 'RB', 'CB', 'LB', 'CDM', 'RM', 'CM', 'LM', 'CAM', 'RW', 'ST', 'LW'] as const;
export type HeatCode = (typeof HEAT_CODES)[number];

export type HeatState = 'main' | 'sub' | 'none';

export interface HeatSlot {
  code: HeatCode;
  x: number;
  y: number;
  w: number;
  h: number;
  labelX: number;
  labelY: number;
}

// 三列网格（列宽 75、列缝 5）：左右列边卫/边前卫跨两块高（59），中列五等分（27）
export const HEAT_SLOTS: readonly HeatSlot[] = [
  { code: 'LW', x: 5, y: 5, w: 75, h: 59, labelX: 42, labelY: 38 },
  { code: 'LM', x: 5, y: 69, w: 75, h: 59, labelX: 42, labelY: 102 },
  { code: 'LB', x: 5, y: 133, w: 75, h: 27, labelX: 42, labelY: 150 },
  { code: 'ST', x: 85, y: 5, w: 75, h: 27, labelX: 122, labelY: 22 },
  { code: 'CAM', x: 85, y: 37, w: 75, h: 27, labelX: 122, labelY: 54 },
  { code: 'CM', x: 85, y: 69, w: 75, h: 27, labelX: 122, labelY: 86 },
  { code: 'CDM', x: 85, y: 101, w: 75, h: 27, labelX: 122, labelY: 118 },
  { code: 'CB', x: 85, y: 133, w: 75, h: 27, labelX: 122, labelY: 150 },
  { code: 'RW', x: 165, y: 5, w: 75, h: 59, labelX: 202, labelY: 38 },
  { code: 'RM', x: 165, y: 69, w: 75, h: 59, labelX: 202, labelY: 102 },
  { code: 'RB', x: 165, y: 133, w: 75, h: 27, labelX: 202, labelY: 150 },
  // 门将：底部梯形带上的居中块（带是图底背景，状态只挂块）
  { code: 'GK', x: 88, y: 167, w: 69, h: 26, labelX: 122, labelY: 184 },
];

// 梯形 GK 带（透视收拢），画在所有块之下
export const HEAT_GK_BAND = '4,164 241,164 204,196 41,196';

const CODE_SET: ReadonlySet<string> = new Set(HEAT_CODES);

// 位置码清洗：12 码外忽略、重复码去重，保留输入顺序（首位即主位、顺序即优先级）
export function heatPositionsOf(posCodes: readonly string[]): HeatCode[] {
  return [...new Set(posCodes.filter((c) => CODE_SET.has(c)))] as HeatCode[];
}

// 位置码 → 三态：首码主位、其余（≤3）副位；空/全非法一律 none。
// 纯门将（isGk 且只有 GK）只 GK 块主位绿、其余照常在场淡显；GK 兼场员按位置顺序照常铺绿。
export function heatStateOf(posCodes: readonly string[], isGk: boolean): Record<HeatCode, HeatState> {
  const state = {} as Record<HeatCode, HeatState>;
  for (const code of HEAT_CODES) state[code] = 'none';
  const valid = heatPositionsOf(posCodes);
  if (valid.length === 0) return state;
  if (isGk && valid.length === 1 && valid[0] === 'GK') {
    state.GK = 'main';
    return state;
  }
  state[valid[0]] = 'main';
  for (const code of valid.slice(1)) state[code] = 'sub';
  return state;
}

// 三态 → 块类名（样式在 styles.css .heat-*）
export function heatToneClass(state: HeatState): string {
  if (state === 'main') return 'heat-main';
  if (state === 'sub') return 'heat-sub';
  return 'heat-off';
}
