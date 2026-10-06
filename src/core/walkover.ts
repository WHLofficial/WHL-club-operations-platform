// 弃权语义的唯一出处（2026-10-06 订正）。
// 权威口径来自比赛系统 tour 仓 migrations/0013_walkover.sql 的列注释 + 生产 note 文案双向核对：
//   walkover_side 记的是**弃权方（判负方）**，不是取胜方。
//   '' = 普通场；'home' = 主队弃权（客队胜）；'away' = 客队弃权（主队胜）；'both' = 双方弃权（双方各记一负）。
// 订正前 prizes / home / season-settle / event-ops / naming-ops 五处把该列当「取胜方」读，等于整片反向：
// 弃权方白拿胜场奖金、真胜者只拿败方补贴、战绩/积分/胜率全反。生产已按本口径出批追平（scripts/prod-20261006-s9-walkover-fix）。

export type WalkoverSide = string | null | undefined;

/** 是否弃权场（含双弃权）。'' / null / 脏值都不算。 */
export function isWalkover(side: WalkoverSide): boolean {
  return side === 'home' || side === 'away' || side === 'both';
}

/** 单方弃权的取胜侧（弃权方的对面）；双弃权 / 非弃权 / 脏值 → null。 */
export function walkoverWinnerSide(side: WalkoverSide): 'home' | 'away' | null {
  if (side === 'home') return 'away';
  if (side === 'away') return 'home';
  return null;
}

/** 该侧是否因弃权判负：单方弃权 = 弃权方判负，双弃权 = 双方都判负，普通场恒 false。 */
export function walkoverLoser(side: WalkoverSide, ours: 'home' | 'away'): boolean {
  if (side === 'both') return true;
  return side === ours;
}
