// 成长 XP 折算（前端本地复算）：与 src/worker/growth.ts 的 xpForEvent 同口径——两边改必须同步。
// 用途：管理端「成长录入」页在保存前实时复算「本场XP」列与「本场合计」，不入库；最终入账 XP 以后端为准。

/** 单行录入草稿（与 POST /api/admin/growth/match-entry/:matchId 的 entries 字段一致） */
export interface GrowthEntryDraft {
  /** 出场：固定 1 XP */
  appearance?: boolean;
  /** 评分 7.0-10.0：7 档 1 · 8 档 2 · 9 档 3 · 10 档 4；不足 7 → 0 */
  rating?: number | null;
  /** 零封：固定 0.5 XP */
  cleanSheet?: boolean;
  /** 夺回球权：每 12 次 1 XP */
  duelsWon?: number | null;
  /** 扑救：每 8 次 1 XP，单场超 8 额外 +1 */
  saves?: number | null;
}

// §10.1 事件类型折算表（与后端 growth.ts xpForEvent 逐字一致；仅比赛可补录的类型会落到这里）
export function growthXpForEvent(eventType: string, value: number): number {
  switch (eventType) {
    case 'appearance':
      return 1;
    case 'rating':
      if (value >= 10) return 4;
      if (value >= 9) return 3;
      if (value >= 8) return 2;
      if (value >= 7) return 1;
      return 0;
    case 'goal':
    case 'assist':
    case 'clean_sheet':
      return 0.5;
    case 'duels_won':
      return Math.floor(value / 12);
    case 'saves':
      return Math.floor(value / 8) + (value > 8 ? 1 : 0);
    default:
      return 0;
  }
}

/** 一行录入的合计 XP（null/undefined 视为未填，不计入） */
export function entryXp(entry: GrowthEntryDraft): number {
  let xp = 0;
  if (entry.appearance) xp += growthXpForEvent('appearance', 1);
  if (entry.rating !== null && entry.rating !== undefined) xp += growthXpForEvent('rating', entry.rating);
  if (entry.cleanSheet) xp += growthXpForEvent('clean_sheet', 1);
  if (entry.duelsWon !== null && entry.duelsWon !== undefined) xp += growthXpForEvent('duels_won', entry.duelsWon);
  if (entry.saves !== null && entry.saves !== undefined) xp += growthXpForEvent('saves', entry.saves);
  return xp;
}
