// v6.43.0：截图识别结果 → 录入行草稿的合并（纯函数，无 IO，页面与测试共用）。
// 零封联动口径（用户裁决 2026-10）：本侧失球 0 ⇒ 门将行自动勾零封；
// 外场行「手填夺回球权（含 0）即勾零封」在页面 onChange 里做，不在这里。
import type { MatchEntryListItem, MatchEntrySuspended, MatchOcrEntry } from './api.ts';

/** 行草稿的结构视图（GrowthEntryPage 的 RowDraft 天然满足，测试好造） */
export interface OcrMergeRow {
  playerId: number;
  position: string | null;
  /** v6.45.0：本场停赛（非空即整行不可录），取代 v6.43.x 的训练营锁定 */
  suspended: MatchEntrySuspended | null;
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
  /** 同值去重的格子数（同一球员在两页都出现等场景，值相同不重复写） */
  deduped: number;
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
 * 把识别条目合并进行草稿（多选上传逐张调用，本函数负责跨图去重）：
 * - 只写未锁定（未录入/未提交）的格子，锁定的逐条给跳过原因；
 * - 已填但未锁定的格子不覆盖：同值算去重（deduped），异值保留先填的值并出冲突跳过——
 *   识别等待期间的手填与上一张图的结果都不被后续图覆盖（宁缺勿错，冲突由人工裁决）；
 * - 夺回球权（duelsWon）不预填——按裁决保持人工手填（它同时是防守球员确认的载体）；
 * - 本侧失球 0 时，未锁定的门将行自动勾零封（无论识别条目里有没有他）；
 * - v6.45.0：本场停赛的行整行跳过（停赛不能录成长），也不参与门将零封联动。
 * - v6.46.0：allowCounters=false（本场不计成长 XP —— 冠军杯淘汰赛/超级杯/资格赛）时不预填
 *   零封与扑救，也不做门将零封联动：这两项是纯 XP 计数器，写进去服务端会整批拒收。
 */
export function mergeOcrEntries<R extends OcrMergeRow>(
  rows: R[],
  entries: MatchOcrEntry[],
  conceded: number,
  allowCounters = true,
): OcrMergeOutcome<R> {
  const next = rows.map((r) => ({ ...r }));
  const byId = new Map(next.map((r) => [r.playerId, r]));
  const skipped: OcrMergeSkip[] = [];
  let applied = 0;
  let deduped = 0;

  for (const e of entries) {
    const row = byId.get(e.playerId);
    if (!row) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: '不在当前花名册' });
      continue;
    }
    if (row.suspended) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: '本场停赛' });
      continue;
    }
    let touched = 0;
    let duped = 0;
    let blocked: string[] = [];
    const conflicts: string[] = [];
    if (e.draft.appearance) {
      if (row.appearance.locked) blocked.push('出场');
      else if (row.appearance.checked) duped += 1;
      else {
        row.appearance = { ...row.appearance, checked: true };
        touched += 1;
      }
    }
    if (e.draft.rating !== undefined) {
      const value = String(e.draft.rating);
      if (row.rating.locked) blocked.push('评分');
      else if (row.rating.value === '') {
        row.rating = { ...row.rating, value };
        touched += 1;
      } else if (row.rating.value === value) duped += 1;
      else conflicts.push(`评分识别 ${value} 与已填 ${row.rating.value} 冲突`);
    }
    if (allowCounters && e.draft.cleanSheet) {
      if (row.cleanSheet.locked) blocked.push('零封');
      else if (row.cleanSheet.checked) duped += 1;
      else {
        row.cleanSheet = { ...row.cleanSheet, checked: true };
        touched += 1;
      }
    }
    if (allowCounters && e.draft.saves !== undefined) {
      const value = String(e.draft.saves);
      if (row.saves.locked) blocked.push('扑救');
      else if (row.saves.value === '') {
        row.saves = { ...row.saves, value };
        touched += 1;
      } else if (row.saves.value === value) duped += 1;
      else conflicts.push(`扑救识别 ${value} 与已填 ${row.saves.value} 冲突`);
    }
    applied += touched;
    deduped += duped;
    if (conflicts.length > 0) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: `${conflicts.join('、')}，保留已填值` });
    }
    if (blocked.length > 0) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: `${blocked.join('、')}格已录入锁定` });
    }
    if (!allowCounters && (e.draft.cleanSheet === true || e.draft.saves !== undefined)) {
      skipped.push({ playerId: e.playerId, name: e.name, reason: '本场不计成长 XP，零封与扑救不预填' });
    }
    // 全部同值去重（touched=0、无冲突、无锁定）不算跳过——多选上传时这是常态
  }

  let gkAuto = 0;
  if (allowCounters && conceded === 0) {
    for (const row of next) {
      if (row.position === 'GK' && !row.suspended && !row.cleanSheet.locked && !row.cleanSheet.checked) {
        row.cleanSheet = { ...row.cleanSheet, checked: true };
        gkAuto += 1;
      }
    }
  }

  return { rows: next, applied, deduped, skipped, gkAuto, cleanSheetSide: conceded === 0 };
}
