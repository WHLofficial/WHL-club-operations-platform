// v6.28.0 A 段：球队影响力构成文案里的级别系数显示（(球员+队壳)×系数+奖励分）。
// 后端给的就是最终值（config influence_tier_coefs 逐档兜底后），这里只负责显示：去掉浮点尾巴、坏值按 1。
export function influenceCoefText(coef: number): string {
  if (!Number.isFinite(coef)) return '1';
  return String(Number(coef.toFixed(2)));
}
