// 旁路操作规则纯函数（规则 4.4.2 激活/4.4.3 海捞/4.4.4 解约/4.4.6 更改违约金/4.4.2.4 匹配，
// TECH_DESIGN §6.2/§6.3）：费用与倍数全部可从规则原文推导，公开可注释（对齐 §6.10 边界——
// 这些不是谈判判定族，玩家按规则本就能算）。金额单位 m，保留两位（round2 沿 market-rules）。
// v3.0.0：效力与保护期从自然日改为转会窗刻度（规则 4.2.3 以半赛季为周期）——
// 1 个常规窗关窗 = 0.5 赛季；currentTicks = 截至当下的已关常规窗数（is_temporary=0），
// serviceTicks = 同一计数在签约时的取值（contracts.service_ticks）。
import { round2 } from './market-rules.ts';

// 海捞签入费率（4.4.3：新违约金的 30%）
export const FREE_AGENT_FEE_RATE = 0.3;
// 续约（更改违约金）费率（4.4.6：提高部分差额的 30%，降低免费）
export const RC_CHANGE_FEE_RATE = 0.3;
// 合同保护期 = 合同前 1.5 赛季（4.3.1）；签约时已关常规窗数 + 3 窗为保护期结束点
export const PROTECTION_TICKS = 3;
// 1 个常规窗关窗推进的效力（4.2.3：工资帽以半赛季为周期）
export const SEASONS_PER_TICK = 0.5;
// 免费解约门槛（4.4.4：效力满 3 年）
export const FREE_TERMINATION_SEASONS = 3;
// 强制拍卖默认挂牌价（4.4.5：联赛管理方挂出；v6.51.0 起管理端可指定挂牌价，此值仅作默认）
export const FORCED_AUCTION_PRICE = 1;

/** 效力（赛季）= 0.5 × 签约后经历的常规窗关窗数；基数缺失按 0（0028 默认值） */
export function serviceSeasons(serviceTicks: number, currentTicks: number): number {
  const ticks = Math.max(0, currentTicks - serviceTicks);
  return round2(ticks * SEASONS_PER_TICK);
}

/**
 * 合同是否在保护期内：protectionTicks = 保护期结束的绝对窗数（= 签约基数 + 3）。
 * NULL = 无保护期（训练营 4.3.4，或历史上按天数记的旧合同）。
 */
export function isProtected(protectionTicks: number | null, currentTicks: number): boolean {
  return protectionTicks !== null && currentTicks < protectionTicks;
}

/** 新签合同的保护期结束窗数：正式合同 = 基数 + 3 窗；训练营无保护期（4.3.4） */
export function protectionTicksFor(serviceTicks: number, contractType: string): number | null {
  return contractType === 'trainee' ? null : serviceTicks + PROTECTION_TICKS;
}

/**
 * 激活金额（4.4.2.3，非训练营球员）：保护期内 RC≤20m → 2 倍，>20m → 1.5 倍；
 * 保护期外固定 1 倍。训练营球员固定 5m（TRAINEE_ACTIVATION_FEE，market-rules）。
 * v6.37.0：激活金额取整（用户裁决「违约金和出价、激活价都保留到整数」），
 * 1.5 倍产生的 .5 四舍五入（21 → 31.5 → 32）；违约金本体在入口已整数校验。
 */
export function activationFee(releaseFee: number, protectionTicks: number | null, currentTicks: number): number {
  if (!Number.isFinite(releaseFee) || releaseFee <= 0) throw new RangeError('违约金须为正数');
  const mult = isProtected(protectionTicks, currentTicks) ? (releaseFee <= 20 ? 2 : 1.5) : 1;
  return Math.round(releaseFee * mult);
}

/** 解约费（4.4.4）：效力满 3 年（6 个常规窗）免费；其余 = RC×(3−效力)×0.1 */
export function terminationFee(releaseFee: number, serviceTicks: number, currentTicks: number): number {
  if (!Number.isFinite(releaseFee) || releaseFee <= 0) throw new RangeError('违约金须为正数');
  const seasons = serviceSeasons(serviceTicks, currentTicks);
  if (seasons >= FREE_TERMINATION_SEASONS) return 0;
  return round2(releaseFee * (FREE_TERMINATION_SEASONS - seasons) * 0.1);
}

/** 续约费（4.4.6）：提高违约金付差额×30%；降低或不变免费 */
export function rcChangeFee(oldRc: number, newRc: number): number {
  if (newRc <= oldRc) return 0;
  return round2((newRc - oldRc) * RC_CHANGE_FEE_RATE);
}

// 上调（v6.64.4，规则 4.3.4 上调谈正式合同）：F ≤ 15 免费（= releaseFeeBounds(5) 的上限），
// 超出部分付 (F−15)×0.3 销毁（用户裁决 2026-10-31：提交预检、成约收取、谈崩不收）
export const PROMOTION_FREE_RC = 15;
export const PROMOTION_SURCHARGE_RATE = 0.3;

export function promotionSurcharge(fee: number): number {
  if (fee <= PROMOTION_FREE_RC) return 0;
  return round2((fee - PROMOTION_FREE_RC) * PROMOTION_SURCHARGE_RATE);
}

/** 海捞签入费（4.4.3）：新违约金 × 30% */
export function freeAgentFee(newRc: number): number {
  if (!Number.isFinite(newRc) || newRc <= 0) throw new RangeError('新违约金须为正数');
  return round2(newRc * FREE_AGENT_FEE_RATE);
}

/** 海捞签入费差额（4.4.3 + 4.3.4(1)）：海捞按提交时的违约金收费，而直签训练营会把违约金
 * 落回固定 5m——两者不一致时那笔费要按合同重算：正数补收、负数退还、0 不动。 */
export function freeAgentFeeGap(paidFee: number, contractRc: number): number {
  const required = freeAgentFee(contractRc);
  const paid = Number.isFinite(paidFee) && paidFee > 0 ? round2(paidFee) : 0;
  return round2(required - paid);
}

/** 匹配差额（4.4.2.4）：新违约金 − 原违约金，付给联赛销毁（PRD 裁决 6） */
export function matchDiff(oldRc: number, newRc: number): number {
  if (newRc <= oldRc) throw new RangeError('匹配新违约金必须高于原违约金');
  return round2(newRc - oldRc);
}
