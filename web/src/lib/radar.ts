// 雷达轴与档位辅助（v6.34.0 球员对比）：口径自 pages/Player.tsx 提取的共享件 ——
// 详情页与对比页共用一份，避免两处各写一遍后漂移（提取时行为零变化，与页内原实现逐字同口径）。
import { ATTR_GROUPS } from './ref.ts';

export interface RadarAxis {
  key: string;
  label: string;
  keys: readonly string[];
}

// 门将雷达轴（Player.tsx 原注释：v0.7.1 d11，四裁决：外场 PAC/SHO/PAS/DRI/DEF/PHY；
// 门将换轴 DIV/HAN/KIC/REF/POS/SPD，SPD＝均(冲刺,加速)）
export const GK_RADAR: readonly RadarAxis[] = [
  { key: 'DIV', label: '扑救', keys: ['gkdiving'] },
  { key: 'HAN', label: '手型', keys: ['gkhandling'] },
  { key: 'KIC', label: '开球', keys: ['gkkicking'] },
  { key: 'REF', label: '反应', keys: ['gkreflexes'] },
  { key: 'POS', label: '站位', keys: ['gkpositioning'] },
  { key: 'SPD', label: '速度', keys: ['sprintspeed', 'acceleration'] },
];

// 组值 = 组内有效值的 Math.round 均值；无有效值回 null（轴照画，值按 0 归一）。
// 逐字照抄 Player.tsx:82-85：Number(null) === 0 也算有效值参与 —— 这是既有口径，不在这里改。
export function groupAverage(keys: readonly string[], attrs: Record<string, unknown>): number | null {
  const vals = keys.map((k) => Number(attrs[k])).filter((v) => Number.isFinite(v));
  return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

// 轴选择（对比 spec §4）：全员门将用 GK 六轴，其余（含「门将＋外场」混比）统一外场六维
export function axesFor(isGk: boolean): readonly RadarAxis[] {
  return isGk ? GK_RADAR : ATTR_GROUPS.slice(0, 6);
}

// 轴键 → 轴定义：GK 六轴与外场七组的键集不相交，合并无歧义（GKP 也在表内，属性表侧可用）
const AXIS_BY_KEY: ReadonlyMap<string, RadarAxis> = new Map(
  [...GK_RADAR, ...ATTR_GROUPS].map((g): [string, RadarAxis] => [g.key, g]),
);

// 归一分母 99（顶格＝属性上限）：先钳 [0,99] 再除 —— axisValue 与 bandFrac 共用这一份，别各写一遍
const clamp99 = (v: number): number => Math.min(Math.max(v, 0), 99);

// 轴值归一：组均钳 [0,99] 后除 99（与 AttrRadar 的 min(max(v,0),99)/99 同口径）；
// 未知轴键 / 无有效值 / 非数一律按 0
export function axisValue(attrs: Record<string, unknown>, key: string): number {
  const axis = AXIS_BY_KEY.get(key);
  const avg = axis ? groupAverage(axis.keys, attrs) : null;
  return clamp99(avg ?? 0) / 99;
}

// ★/☆ 档位文案（原 Player.tsx:67-70 逐字口径）：≤0 或非有限 → '—'；封顶 5 星。
// 入参收成 unknown 并先 Number 收口：详情页原本在调用点 Number(attrs.x)，对比页直喂 attrs 原值，
// 这层收进函数后两处行为一致（数字字符串照常出星，缺值/非数串回 '—'）
export function starText(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return '★'.repeat(Math.min(v, 5)) + '☆'.repeat(Math.max(0, 5 - v));
}

// ---- 五档配色与雷达环带（v6.35.0，spec docs/superpowers/specs/2026-10-05-player-heatmap-radar-ticks-design.md §1.2）----
// 色值 = players-library.ts attrClass 五档（v6.19.0 全仓统一口径），测试锁死两处同源 ——
// 雷达轴数值套色与环带配色都从这里取，避免第三处再抄一遍色表
const TIER_COLORS = {
  bad: '#e03131',
  weak: '#fd7e14',
  mid: '#b7892b',
  solid: '#66a80f',
  good: '#2b8a3e',
} as const;

// 值 → 档色：阈值与 attrClass 逐条同源（≤50 红 / ≤60 橙 / ≤70 琥珀金 / ≤80 榈绿 / 其余绿）
export function tierColorOf(v: number): string {
  if (v <= 50) return TIER_COLORS.bad;
  if (v <= 60) return TIER_COLORS.weak;
  if (v <= 70) return TIER_COLORS.mid;
  if (v <= 80) return TIER_COLORS.solid;
  return TIER_COLORS.good;
}

// 环带边界：顶环 = 外框 = 99，档界 80/70/60/50（六边形内叠，非圆环；每环取"下侧档"的色 ——
// 99→绿、80→榈绿、70→琥珀金、60→橙、50→红，即 tierColorOf(边界值)）
export const RADAR_BAND_BOUNDS = [99, 80, 70, 60, 50] as const;

// 值 → 半径占比：归一分母 99（与 axisValue 同口径），钳 [0,99]
export function bandFrac(v: number): number {
  return clamp99(v) / 99;
}
