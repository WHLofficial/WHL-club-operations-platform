// fit 卡色点三态（v6.56.0 球员页 fit 卡消费侧新增，非 tour 仓引擎随迁件）：
// 绿 ≥85 / 黄 ≥50 / 灰 ＜50 —— 有意与 tour 战术板 fitTileClass 的四态（红橙黄绿）不同，
// 定稿口径见 memory/plan-v6.55.0-attr-head-relayout.md 与 docs/test-plans/v6.56.0-attr-head-relayout.md TC-C-012。
// 输入 null（跨位置群 / 无数据）回灰；球员页展示行已过滤跨群，null 分支只是兜底。
export const FIT_DOT_GOOD = 85;
export const FIT_DOT_MID = 50;

export function fitDotClass(tile: number | null): string {
  if (tile !== null && tile >= FIT_DOT_GOOD) return 'fit-dot fit-dot-good';
  if (tile !== null && tile >= FIT_DOT_MID) return 'fit-dot fit-dot-mid';
  return 'fit-dot fit-dot-low';
}
