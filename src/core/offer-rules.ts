// 报价 / 议价规则纯函数（v6.3.0，设计 §2/§3）：金额边界、严格抬高、轮次判定、名单自动应答。
// 单位 m 保留两位，与 market-rules 同一口径；错误码常量供 worker 层与测试共用。
import { round2 } from './market-rules.ts';

export const OFFER_ABSOLUTE_FLOOR = 1;

/** 报价上限系数：与挂牌价上限同源（违约金 1.5 倍），用户裁决 2026-09（设计 §2.1） */
export const OFFER_CAP_RC = 1.5;

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
export type OfferTurn = 'buyer' | 'seller';

/**
 * 报价金额校验（设计 §8 送报价验收：<1、>1.5×RC 越界；名单球员低于线不是 400，走 auto_reject 落库）。
 * 返回可读错误，null = 通过。
 */
export function validateOfferAmount(amount: number, releaseFee: number | null): string | null {
  if (!Number.isFinite(amount) || amount < OFFER_ABSOLUTE_FLOOR) return `报价至少 ${OFFER_ABSOLUTE_FLOOR} m`;
  if (releaseFee === null || !Number.isFinite(releaseFee) || releaseFee <= 0) return '这名球员没有含违约金的现行合同，谈不了报价';
  const max = round2(releaseFee * OFFER_CAP_RC);
  if (amount > max) return `报价不能超过 ${max} m（违约金 ${OFFER_CAP_RC} 倍上限）`;
  return null;
}

/** 最低报价边界（设计 §2.1：1 ≤ min_offer_price ≤ 1.5×RC；违约金无效返回 null） */
export function minOfferPriceBounds(releaseFee: number | null): { min: number; max: number } | null {
  if (releaseFee === null || !Number.isFinite(releaseFee) || releaseFee <= 0) return null;
  return { min: OFFER_ABSOLUTE_FLOOR, max: round2(releaseFee * OFFER_CAP_RC) };
}

/** 还价必须严格高于当前有效报价额（买方抬价、卖方要更高价，同向上升）。null = 通过 */
export function validateStrictRaise(newAmount: number, currentAmount: number): string | null {
  if (!Number.isFinite(newAmount) || newAmount <= currentAmount) {
    return `还价必须严格高于当前报价 ${round2(currentAmount)} m`;
  }
  return null;
}

/** 轮到对方 */
export function otherTurn(turn: OfferTurn): OfferTurn {
  return turn === 'buyer' ? 'seller' : 'buyer';
}

/**
 * 名单球员自动应答判定（设计 §3）：≥ 线 auto_accept、< 线 auto_reject；
 * 没进名单（transfer_listed != 1 或没有最低报价）返回 null，走人工谈判。
 */
export function autoRespondKind(transferListed: number | null, minOfferPrice: number | null, amount: number): 'auto_accept' | 'auto_reject' | null {
  if (transferListed !== 1 || minOfferPrice === null || !Number.isFinite(minOfferPrice)) return null;
  return amount >= minOfferPrice ? 'auto_accept' : 'auto_reject';
}
