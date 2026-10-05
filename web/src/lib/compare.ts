// 球员对比域纯函数（v6.34.0）：URL ids 解析 / 本命配色 / 胜负标记 / 组均。
// 界面口径见 docs/superpowers/specs/2026-10-05-player-compare-design.md §4/§5/§8。
import { ATTR_GROUPS } from './ref.ts';
import { groupAverage } from './radar.ts';

export interface ParsedCompareIds {
  ids: number[];
  droppedInvalid: number;
  droppedDuplicate: number;
  overLimit: number;
}

// 同时对比上限（spec §3）：超出按 URL 顺序取前 3
const COMPARE_MAX = 3;

// URL ids 解析（spec §8 处理链前四步）：逗号切分（容忍前后空格；空段静默跳过，`ids=` 不算非法项）→
// 整数校验（仅正整数：非数字 / 带字母混写 / 小数 / 0 / 负数 / 超安全整数的巨数计 droppedInvalid）→
// 去重保序（计 droppedDuplicate）→ 取前 3 保序（计 overLimit，去重先于取前 3）。
export function parseCompareIds(raw: string | null | undefined): ParsedCompareIds {
  const parsed: ParsedCompareIds = { ids: [], droppedInvalid: 0, droppedDuplicate: 0, overLimit: 0 };
  if (raw == null) return parsed;
  const seen = new Set<number>();
  for (const item of raw.split(',').map((s) => s.trim()).filter((s) => s !== '')) {
    if (!/^\d+$/.test(item)) {
      parsed.droppedInvalid++;
      continue;
    }
    const n = Number(item);
    if (!Number.isSafeInteger(n) || n <= 0) {
      parsed.droppedInvalid++;
      continue;
    }
    if (seen.has(n)) {
      parsed.droppedDuplicate++;
      continue;
    }
    seen.add(n);
    if (parsed.ids.length >= COMPARE_MAX) {
      parsed.overLimit++;
      continue;
    }
    parsed.ids.push(n);
  }
  return parsed;
}

// 球员色（spec §4，奶油纸底对比度已核对）：A 焦橙深 / B 深蓝灰 / C 深紫。
// 色随人走：只由索引（勾选/URL 顺序）决定，移除中间一人后其余人不换色
export const COMPARE_COLORS = ['#8e5426', '#37505e', '#6d4aa8'] as const;

// 越界索引（正常只取 0-2）回退 A 色，保证调用方永远拿到可用颜色
export function colorFor(index: number): string {
  return COMPARE_COLORS[index] ?? COMPARE_COLORS[0];
}

// 胜负标记乙（spec §5）：返回每人「加粗」布尔——胜方加粗、等值（平手）两侧都加粗，
// 粗体语义＝至少不落下风（v >= 最大值）。null/undefined/非有限视为无值不参与比较；
// 全无值 → 全 false；只有 1 个有效值 → 该值 true；多有效值全体相等 → 全 true
export function rowMarks(values: ReadonlyArray<number | null | undefined>): boolean[] {
  const nums = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const valid = nums.filter((v): v is number => v !== null);
  if (valid.length === 0) return values.map(() => false);
  const best = Math.max(...valid);
  return nums.map((v) => v !== null && v >= best);
}

export interface GroupAverageRow {
  key: string;
  label: string;
  value: number | null;
}

// 对比页组均（spec §4/§5）：只出前六组（外场 PAC/SHO/PAS/DRI/DEF/PHY），不含 GKP。
// 组头行只出三字母组名（spec §5「只留组名」），故 label 取组名本身，不用 ref.ts 的中文名
export function groupAverages(attrs: Record<string, unknown>): GroupAverageRow[] {
  return ATTR_GROUPS.slice(0, 6).map((g) => ({ key: g.key, label: g.key, value: groupAverage(g.keys, attrs) }));
}
