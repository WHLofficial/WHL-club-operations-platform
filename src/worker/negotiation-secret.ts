export function expectedWage(level: number, releaseFee: number, a: number, b: number, c: number): number {
  return Math.round(a * level ** b * releaseFee ** c * 100) / 100;
}

export function attemptExpected(base: number, attemptNo: number, mult: number): number {
  if (attemptNo > 1) return Math.round(base * mult * 100) / 100;
  return base;
}

export function successRate(offered: number, expected: number, slope: number, mid: number): number {
  if (offered <= 0 || expected <= 0) return 0;
  const ratio = offered / expected;
  if (ratio >= 1) return 1;
  return 1 / (1 + Math.exp((slope * (ratio - mid)) / 0.4));
}

export function directFail(p: number, threshold: number, probability: number, roll: number): boolean {
  return p < threshold && roll < probability;
}

export function satisfactionText(p: number, lo: number, mid: number, hi: number): string {
  if (p >= hi) return '😍 经纪人非常满意';
  if (p >= mid) return '🙂 经纪人比较满意';
  if (p >= lo) return '😐 经纪人不太满意';
  return '😠 经纪人很不满意';
}

// ---- 工资预览四档（v6.54.0 从 negotiations.ts 挪来）----
// 挪动原因：闹涨薪的还价预览（demand-ops.previewDemand）要与签约谈判 preview「同一套词」（设计
// docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md §7），而 demand-ops 不能
// 反向 import negotiations.ts——那是 negotiations → transfers 的下游，将来关窗批把离队作废
// 接进 completeTransfer 会成环。本模块是双方共同的上游，档位放这里只有一份真源。

// 四档边界 0.2 / 0.5 / 0.8（2026-10-09 用户裁决）：硬编码在 Worker 侧，不进 web/、不进 config、
// 不与涉密的满意度阈值（0.25/0.6/0.9）同放一个常量组。档位不随经纪人档位变（档位只影响 risk）。
const PREVIEW_BANDS = [0.8, 0.5, 0.2];

// 措辞故意不复用事后满意度句（😍/🙂/😐/😠 经纪人…）：两套阈值本就不同位，
// 共用词会在 4.40~4.50m 一带出现「预告比较满意、事后不太满意」的错位缝。
export function previewForecast(p: number): string {
  if (p >= PREVIEW_BANDS[0]) return '成功率很高';
  if (p >= PREVIEW_BANDS[1]) return '成功率过半';
  if (p >= PREVIEW_BANDS[2]) return '成功率偏低';
  return '成功率很低';
}
