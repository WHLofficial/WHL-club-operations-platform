// 预期收入动用额（v6.57.0 设计 §2.3，前端共享口径）：本次支出里有多少要靠「预期收入额度」垫。
// 公式与服务端预检一致：动用额 = max(0, 本次支出 − (balance − held + 本人本单旧冻结))。
// 旧冻结回加对齐服务端四处预检（market.ts / offers.ts ×2 / sea-sealed.ts）——抬价/还价/接受
// 场景旧冻结会被顶替释放，不回加会把动用额算大一整个旧冻结额、甚至超过 creditLine 本身。
// 入参用 balance 端点的快照字段（available 已含额度）：balance − held = available − creditLine。
import type { ClubBalance } from './api.ts';

/** 与服务端 round2 同口径（+EPSILON 防 0.145 类浮点误差） */
export function round2m(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * 动用预期收入额度（m）。快照缺失（未登录 / 端点还没回）回 0——展示层据此整行不渲染，
 * 不冒充「不需要动用」以外的任何判断（服务端预检与触发器才是闸）。
 */
export function creditUse(
  spend: number,
  snap: Pick<ClubBalance, 'available' | 'creditLine'> | null | undefined,
  oldHold = 0,
): number {
  if (!snap || snap.available === null || snap.creditLine === null) return 0;
  const cashFree = round2m(snap.available - snap.creditLine + oldHold);
  return round2m(Math.max(0, round2m(spend) - cashFree));
}
