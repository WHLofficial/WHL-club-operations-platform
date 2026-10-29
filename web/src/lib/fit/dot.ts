// fit 卡色点三态（v6.56.0 球员页 fit 卡消费侧新增，非 tour 仓引擎随迁件）：
// 绿 ≥85 / 黄 ≥50 / 橙 ＜50 —— 有意与 tour 战术板 fitTileClass 的四态（红橙黄绿）不同，
// 定稿口径见 memory/plan-v6.55.0-attr-head-relayout.md 与 docs/test-plans/v6.56.0-attr-head-relayout.md TC-C-012。
// 输入 null（跨位置群 / 无数据）回橙；球员页展示行已过滤跨群，null 分支只是兜底。
export const FIT_DOT_GOOD = 85;
export const FIT_DOT_MID = 50;

export type FitTone = 'good' | 'mid' | 'low';

/** 档位语义（不带 `fit-dot-` 前缀），色点与进度条/分数共用同一判据。 */
export function fitTone(tile: number | null): FitTone {
  if (tile !== null && tile >= FIT_DOT_GOOD) return 'good';
  if (tile !== null && tile >= FIT_DOT_MID) return 'mid';
  return 'low';
}

export function fitDotClass(tile: number | null): string {
  return `fit-dot fit-dot-${fitTone(tile)}`;
}
