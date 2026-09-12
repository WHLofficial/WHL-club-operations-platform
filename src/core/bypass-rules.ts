// 旁路操作规则纯函数（规则 4.4.2 激活/4.4.3 海捞/4.4.4 解约/4.4.6 更改违约金/4.4.2.4 匹配，
// TECH_DESIGN §6.2/§6.3）：费用与倍数全部可从规则原文推导，公开可注释（对齐 §6.10 边界——
// 这些不是谈判判定族，玩家按规则本就能算）。金额单位 m，保留两位（round2 沿 market-rules）。
import { round2 } from './market-rules.ts';

// 海捞签入费率（4.4.3：新违约金的 30%）
export const FREE_AGENT_FEE_RATE = 0.3;
// 续约（更改违约金）费率（4.4.6：提高部分差额的 30%，降低免费）
export const RC_CHANGE_FEE_RATE = 0.3;
// 合同保护期 = 合同前 1.5 赛季 ≈ 548 天（假设口径：赛季按年计，TECH_DESIGN 假设表）
export const PROTECTION_DAYS = 548;
// 强制拍卖挂牌价（4.4.5：联赛管理方以 1m 挂牌）
export const FORCED_AUCTION_PRICE = 1;

const DAY_MS = 86_400_000;

function msOf(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 合同是否在保护期内：protected_until 优先；没落库时按 signed_at + PROTECTION_DAYS 推算
 * （导入合同多只有 signed_at）；两者都缺视为不受保护。
 */
export function isProtected(protectedUntil: string | null, signedAt: string | null, nowMs: number): boolean {
  const until = msOf(protectedUntil) ?? (msOf(signedAt) !== null ? msOf(signedAt)! + PROTECTION_DAYS * DAY_MS : null);
  return until !== null && nowMs < until;
}

/**
 * 激活金额（4.4.2.3，非训练营球员）：保护期内 RC≤20m → 2 倍，>20m → 1.5 倍；
 * 保护期外固定 1 倍。训练营球员固定 5m（TRAINEE_ACTIVATION_FEE，market-rules）。
 */
export function activationFee(
  releaseFee: number,
  protectedUntil: string | null,
  signedAt: string | null,
  nowMs: number,
): number {
  if (!Number.isFinite(releaseFee) || releaseFee <= 0) throw new RangeError('违约金须为正数');
  const mult = isProtected(protectedUntil, signedAt, nowMs) ? (releaseFee <= 20 ? 2 : 1.5) : 1;
  return round2(releaseFee * mult);
}

/** 效力年数（解约费/激活效力校验共用）：按 365.25 天/年折算；效力起点缺失返回 null */
export function serviceYears(effectiveFrom: string | null, nowMs: number): number | null {
  const from = msOf(effectiveFrom);
  if (from === null) return null;
  return (nowMs - from) / (365.25 * DAY_MS);
}

/**
 * 解约费（4.4.4）：效力满 3 年免费；其余 = RC×(3−效力)×0.1。
 * 效力起点缺失返回 null（调用方给可读报错，不放行）。
 */
export function terminationFee(releaseFee: number, effectiveFrom: string | null, nowMs: number): number | null {
  if (!Number.isFinite(releaseFee) || releaseFee <= 0) throw new RangeError('违约金须为正数');
  const years = serviceYears(effectiveFrom, nowMs);
  if (years === null) return null;
  if (years >= 3) return 0;
  return round2(releaseFee * (3 - years) * 0.1);
}

/** 续约费（4.4.6）：提高违约金付差额×30%；降低或不变免费 */
export function rcChangeFee(oldRc: number, newRc: number): number {
  if (newRc <= oldRc) return 0;
  return round2((newRc - oldRc) * RC_CHANGE_FEE_RATE);
}

/** 海捞签入费（4.4.3）：新违约金 × 30% */
export function freeAgentFee(newRc: number): number {
  if (!Number.isFinite(newRc) || newRc <= 0) throw new RangeError('新违约金须为正数');
  return round2(newRc * FREE_AGENT_FEE_RATE);
}

/** 匹配差额（4.4.2.4）：新违约金 − 原违约金，付给联赛销毁（PRD 裁决 6） */
export function matchDiff(oldRc: number, newRc: number): number {
  if (newRc <= oldRc) throw new RangeError('匹配新违约金必须高于原违约金');
  return round2(newRc - oldRc);
}
