// v6.43.0：截图识别结果 → 录入行草稿的合并（纯函数，无 IO，页面与测试共用）。
// 零封联动口径（用户裁决 2026-10）：本侧失球 0 ⇒ 门将行自动勾零封；
// 外场行「手填夺回球权（含 0）即勾零封」在页面 onChange 里做，不在这里。
import type { MatchEntryListItem, MatchOcrEntry } from './api.ts';

/** 行草稿的结构视图（GrowthEntryPage 的 RowDraft 天然满足，测试好造） */
export interface OcrMergeRow {
  playerId: number;
  position: string | null;
  trainee: boolean;
  appearance: { checked: boolean; locked: boolean };
  rating: { value: string; locked: boolean };
  cleanSheet: { checked: boolean; locked: boolean };
  duelsWon: { value: string; locked: boolean };
  saves: { value: string; locked: boolean };
}

export interface OcrMergeSkip {
  playerId: number;
  name: string;
  reason: string;
}

export interface OcrMergeOutcome<R extends OcrMergeRow> {
  /** 合并后的新行数组（原数组不动） */
  rows: R[];
  /** 成功写入的格子数 */
  applied: number;
  skipped: OcrMergeSkip[];
  /** 零封联动新勾的门将数 */
  gkAuto: number;
  /** 本侧失球是否为 0（零封联动目标） */
  cleanSheetSide: boolean;
}

/** 本侧失球数：主队失球 = 客队得分（比分是零封的权威，OCR 失球对不上时服务端已出警告） */
export function sideConcededOf(
  match: Pick<MatchEntryListItem, 'scoreHome' | 'scoreAway'>,
  side: 'home' | 'away',
): number {
  return side === 'home' ? match.scoreAway : match.scoreHome;
}

/**
 * 把识别条目合并进行草稿：
 * - 只写未锁定（未录入/未提交）的格子，锁定的逐条给跳过原因；
 * - 夺回球权（duelsWon）不预填——按裁决保持人工手填（它同时是防守球员确认的载体）；
 * - 本侧失球 0 时，未锁定的门将行自动勾零封（无论识别条目里有没有他）。
 */
export function mergeOcrEntries<R extends OcrMergeRow>(
  rows: R[],
  entries: MatchOcrEntry[],
  conceded: number,
): OcrMergeOutcome<R> {
  const next = rows.map((r) => ({ ...r }));
  const byId = new Map(next.map((r) => [r.playerId, r]));
  const skipped: OcrMergeSkip[] = [];
  let applied = 0;

  for (const e of entries) {
    const row = byId.get(e.playerId);
    if (!row) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: '不在当前花名册' });
      continue;
    }
    if (row.trainee) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: '训练营球员不按场次计' });
      continue;
    }
    let touched = 0;
    let blocked: string[] = [];
    if (e.draft.appearance) {
      if (!row.appearance.locked) {
        row.appearance = { ...row.appearance, checked: true };
        touched += 1;
      } else blocked.push('出场');
    }
    if (e.draft.rating !== undefined) {
      if (!row.rating.locked) {
        row.rating = { ...row.rating, value: String(e.draft.rating) };
        touched += 1;
      } else blocked.push('评分');
    }
    if (e.draft.cleanSheet) {
      if (!row.cleanSheet.locked) {
        row.cleanSheet = { ...row.cleanSheet, checked: true };
        touched += 1;
      } else blocked.push('零封');
    }
    if (e.draft.saves !== undefined) {
      if (!row.saves.locked) {
        row.saves = { ...row.saves, value: String(e.draft.saves) };
        touched += 1;
      } else blocked.push('扑救');
    }
    if (touched === 0) {
      skipped.push({
        playerId: e.playerId,
        name: e.name,
        reason: blocked.length > 0 ? `${blocked.join('、')}格已录入锁定` : '无可预填字段',
      });
    } else {
      applied += touched;
      if (blocked.length > 0) skipped.push({ playerId: e.playerId, name: e.name, reason: `${blocked.join('、')}格已录入锁定` });
    }
  }

  let gkAuto = 0;
  if (conceded === 0) {
    for (const row of next) {
      if (row.position === 'GK' && !row.cleanSheet.locked && !row.cleanSheet.checked) {
        row.cleanSheet = { ...row.cleanSheet, checked: true };
        gkAuto += 1;
      }
    }
  }

  return { rows: next, applied, skipped, gkAuto, cleanSheetSide: conceded === 0 };
}
