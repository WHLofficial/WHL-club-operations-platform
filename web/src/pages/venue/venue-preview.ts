// 档期草稿的纯函数层（v6.53.0 P0）：只负责「草稿 → picks」与「草稿是否改动」。
// 合计一律用 POST /api/club/venue-plan/preview 返回的 totals（服务端按同类序位算）：
// 前端不逐槽加总、不连乘上座乘数、不钳制——逐槽相加会与关窗结算的口径不一致（饱和系数按序位递增地打折）。
import type { VenueSlotDto } from '../../lib/api.ts';

/** 槽号 → 草稿活动。undefined = 沿用 `slot.booked`（没动过）；null = 明确清空（当「暂不排」保存） */
export type VenueDraft = Record<number, string | null | undefined>;

/** 草稿一拍（`POST /preview` 的 body 项与 `PUT` 的 body 项同形；activity: null = 空置） */
export interface VenuePick {
  slotNo: number;
  activity: string | null;
}

/** `<select>` 的 DOM 值只有字符串：`''` 归一成「明确清空」，避免把「没动过」和「清空」混成一义 */
function norm(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
}

/** 该槽此刻生效的活动：草稿优先，没写过则沿用已保存值 */
export function effectivePick(slot: VenueSlotDto, draft: VenueDraft): string | null {
  const v = norm(draft[slot.slotNo]);
  return v === undefined ? slot.booked : v;
}

/** 完整草稿（预览用：服务端要「全部槽」才能按同类序位算合计），按槽号升序 */
export function draftToPicks(slots: readonly VenueSlotDto[], draft: VenueDraft): VenuePick[] {
  return slots.map((slot) => ({ slotNo: slot.slotNo, activity: effectivePick(slot, draft) })).sort((a, b) => a.slotNo - b.slotNo);
}

/** 只含真正改动的槽（保存用：PUT 是 partial 语义，与已保存值相同的槽不必重发） */
export function diffDraft(slots: readonly VenueSlotDto[], draft: VenueDraft): VenuePick[] {
  const out: VenuePick[] = [];
  for (const slot of slots) {
    const next = effectivePick(slot, draft);
    if (next !== slot.booked) out.push({ slotNo: slot.slotNo, activity: next });
  }
  return out.sort((a, b) => a.slotNo - b.slotNo);
}

/**
 * 草稿是否恰好就是这份方针的排布（用于方针卡上的「已按此排布」标记）。
 * 两侧都必须完整：picks 里的每一槽要在草稿里被显式写成同一活动，草稿里也不能有 picks 之外的槽
 * （「方针 + 手改」是混合方案，不该继续标成「已按此排布」）。picks 为空时永不算命中。
 */
export function samePicks(draft: VenueDraft, picks: readonly { slotNo: number; activity: string }[]): boolean {
  if (picks.length === 0) return false;
  const want = new Map<number, string>();
  for (const p of picks) want.set(p.slotNo, p.activity);
  for (const [slotNo, activity] of want) {
    if (norm(draft[slotNo]) !== activity) return false;
  }
  for (const key of Object.keys(draft)) {
    const slotNo = Number(key);
    const v = norm(draft[slotNo]);
    // 显式清空的槽不属于任何方针的排布（方针只填不空），但也不能因此否定匹配：方针未覆盖的槽允许是空
    if (v === undefined || v === null) continue;
    if (!want.has(slotNo)) return false;
  }
  return true;
}
