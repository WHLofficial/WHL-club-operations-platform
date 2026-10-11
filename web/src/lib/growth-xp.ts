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
  /** 夺回球权：跨场累计每 12 次 1 XP（v6.42.0；0 行合法 = 防守球员人工确认标记） */
  duelsWon?: number | null;
  /** 扑救：跨场累计每 8 次 1 XP，单场超 8 额外 +1（两条独立） */
  saves?: number | null;
}

/** 累计项基数：该球员该类型的历史累计次数（面板 duelsTotal / savesTotal） */
export interface GrowthXpBases {
  duelsWon?: number;
  saves?: number;
}

// §10.1 事件类型折算表（与后端 growth.ts xpForEvent 逐字一致；仅比赛可补录的类型会落到这里）。
// duels_won/saves 是跨场累计（v6.42.0）：base = 历史累计次数，单场只入账跨档差值
// floor((base+value)/K) − floor(base/K)；扑救「单场超 8 额外 +1」独立叠加、与跨档无关。
export function growthXpForEvent(eventType: string, value: number, base = 0): number {
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
      return Math.floor((base + value) / 12) - Math.floor(base / 12);
    case 'saves':
      return Math.floor((base + value) / 8) - Math.floor(base / 8) + (value > 8 ? 1 : 0);
    default:
      return 0;
  }
}

/** 一行录入的合计 XP（null/undefined 视为未填，不计入；累计项传基数才算跨档差值） */
export function entryXp(entry: GrowthEntryDraft, bases?: GrowthXpBases): number {
  let xp = 0;
  if (entry.appearance) xp += growthXpForEvent('appearance', 1);
  if (entry.rating !== null && entry.rating !== undefined) xp += growthXpForEvent('rating', entry.rating);
  if (entry.cleanSheet) xp += growthXpForEvent('clean_sheet', 1);
  if (entry.duelsWon !== null && entry.duelsWon !== undefined)
    xp += growthXpForEvent('duels_won', entry.duelsWon, bases?.duelsWon ?? 0);
  if (entry.saves !== null && entry.saves !== undefined) xp += growthXpForEvent('saves', entry.saves, bases?.saves ?? 0);
  return xp;
}
