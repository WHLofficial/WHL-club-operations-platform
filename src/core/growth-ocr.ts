// v6.43.0：FC26 赛后截图（Player Performance）视觉识别结果的解析、认人与预填草稿构建。
// 纯函数、零 IO——模型调用在 src/lib/llm.ts，DB 与端点在 src/worker/routes/admin/growth.ts。
// 识别语义（用户裁决）：RR→评分（<7.0 不给 XP ⇒ 只预填出场）；GK 面板→扑救/失球；
// 夺回球权图上看不到 ⇒ 保持手填；防守球员认定 = 手填夺回球权（含 0）。
import { foldName } from './name-fold.ts';

export type OcrKind = 'summary' | 'goalkeeping';

export interface OcrRow {
  pos: string;
  name: string;
  rating: number | null; // N/A（替补没上场）→ null
  goals: number;
  assists: number;
}

export interface OcrSelected {
  name: string;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  possessionWon: number | null;
  minutes: number | null;
}

export interface OcrGk {
  name: string;
  gkRating: number | null;
  shotsAgainst: number | null;
  shotsOnTarget: number | null;
  saves: number | null;
  goalsConceded: number | null;
}

export interface OcrVision {
  team: string | null;
  tab: OcrKind | null;
  rows: OcrRow[];
  selected: OcrSelected | null; // tab = summary 时有值
  gk: OcrGk | null; // tab = goalkeeping 时有值
}

export interface OcrEntryDraft {
  appearance?: true;
  rating?: number;
  cleanSheet?: true;
  saves?: number;
}

export interface OcrEntry {
  playerId: number;
  name: string; // 花名册 officialName
  position: string | null;
  draft: OcrEntryDraft;
  matched: 'official' | 'official-folded' | 'display' | 'display-folded';
}

export interface OcrRosterPlayer {
  id: number;
  officialName: string; // players.name（FC26 官方缩写名，截图同源）
  displayName: string; // rowDisplayName
  position: string | null;
}

/** 数值清洗：非有限数回 null；整数位钳非负。评分另走 roundRating。 */
function asCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.max(0, Math.round(Number(v)));
  return null;
}

/** 评分清洗：0-10.5 之外不可信；保留一位小数。N/A 之类字符串回 null。 */
function roundRating(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : null;
  if (n === null || n < 0 || n > 10.5) return null;
  return Math.round(n * 10) / 10;
}

function asText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 模型回包 → 形状校验 + 清洗。宽容收数：坏字段丢值留行、整行坏丢行，全部问题进 errors 供管理端看。
 * raw 完全不是对象（模型答非所问）时回 { ocr: null }。
 */
export function parseOcrVision(raw: unknown): { ocr: OcrVision | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ocr: null, errors: ['回包不是 JSON 对象'] };
  const tabRaw = asText(raw.tab)?.toLowerCase();
  const tab: OcrKind | null = tabRaw === 'summary' || tabRaw === 'goalkeeping' ? tabRaw : null;
  if (!tab) errors.push(`页签「${asText(raw.tab) ?? '空'}」不是 Summary 或 Goalkeeping`);

  const rows: OcrRow[] = [];
  if (Array.isArray(raw.rows)) {
    raw.rows.forEach((r, i) => {
      if (!isRecord(r)) {
        errors.push(`第 ${i + 1} 行不是对象，已丢弃`);
        return;
      }
      const name = asText(r.name);
      if (!name) {
        errors.push(`第 ${i + 1} 行没有球员名，已丢弃`);
        return;
      }
      const rating = roundRating(r.rating);
      // SUB 行的评分在屏上就是 N/A，是预期值不算识别错；真正的乱码（"bad"、12.7 之类）才报
      if (r.rating != null && rating === null && !/^(n\/?a|-|—|–)$/i.test(String(r.rating).trim()))
        errors.push(`「${name}」评分 ${JSON.stringify(r.rating)} 不像 0-10.5 的数字，按没上场处理`);
      rows.push({
        pos: asText(r.pos) ?? '',
        name,
        rating,
        goals: asCount(r.goals) ?? 0,
        assists: asCount(r.assists) ?? 0,
      });
    });
  } else {
    errors.push('rows 不是数组');
  }

  const selected = isRecord(raw.selected) && asText(raw.selected.name)
    ? {
        name: asText(raw.selected.name) as string,
        rating: roundRating(raw.selected.rating),
        goals: asCount(raw.selected.goals),
        assists: asCount(raw.selected.assists),
        possessionWon: asCount(raw.selected.possessionWon),
        minutes: asCount(raw.selected.minutes),
      }
    : null;

  const gk = isRecord(raw.gk) && asText(raw.gk.name)
    ? {
        name: asText(raw.gk.name) as string,
        gkRating: roundRating(raw.gk.gkRating),
        shotsAgainst: asCount(raw.gk.shotsAgainst),
        shotsOnTarget: asCount(raw.gk.shotsOnTarget),
        saves: asCount(raw.gk.saves),
        goalsConceded: asCount(raw.gk.goalsConceded),
      }
    : null;

  return { ocr: { team: asText(raw.team), tab, rows, selected, gk }, errors };
}

export interface OcrMatchResult {
  player: OcrRosterPlayer;
  matched: OcrEntry['matched'];
}

/** 认人阶梯：official 逐字 → official 归一化 → display 逐字 → display 归一化；同层多个命中即歧义放弃（宁缺勿错）。 */
export function matchRosterPlayer(ocrName: string, roster: OcrRosterPlayer[]): OcrMatchResult | null {
  const folded = foldName(ocrName);
  const ladder: { level: OcrEntry['matched']; key: (p: OcrRosterPlayer) => string }[] = [
    { level: 'official', key: (p) => p.officialName.trim() },
    { level: 'official-folded', key: (p) => foldName(p.officialName) },
    { level: 'display', key: (p) => p.displayName.trim() },
    { level: 'display-folded', key: (p) => foldName(p.displayName) },
  ];
  for (const { level, key } of ladder) {
    const target = level === 'official' || level === 'display' ? ocrName.trim() : folded;
    const hits = roster.filter((p) => key(p) === target && target !== '');
    if (hits.length === 1) return { player: hits[0], matched: level };
    if (hits.length > 1) return null; // 歧义（同队同名/同 folded 名）不猜
  }
  return null;
}

export interface OcrBuildResult {
  entries: OcrEntry[];
  unmatched: { name: string; pos: string }[];
  warnings: string[];
}

/**
 * 识别结果 → 预填草稿。
 * 两个页签都吃左表 rows（外场 Summary 常看不全全队，门将页左表还带着替补等人——两页各传一张、
 * 重复出现的球员由前端合并去重）：rating 有值 ⇒ 出场 + 评分（v6.46.0 起照实预填，0.0-10.0 全部
 * 入库——低于 7.0 只记录不给 XP，均分要真实就得把差评也留下）；N/A 行 = 没上场，跳过。
 * goalkeeping 额外吃 gk 详情 ⇒ 门将出场 + 扑救（>0 才填，扑救没有 0 标记语义）+ 失球 0 ⇒ 零封；
 * 门将本人在 rows 里也出现时与 rows 行合成同一条。
 */
export function buildOcrEntries(ocr: OcrVision, roster: OcrRosterPlayer[]): OcrBuildResult {
  const entries: OcrEntry[] = [];
  const unmatched: { name: string; pos: string }[] = [];
  const warnings: string[] = [];
  const push = (hit: OcrMatchResult, draft: OcrEntryDraft) => {
    const existing = entries.find((e) => e.playerId === hit.player.id);
    if (existing) Object.assign(existing.draft, draft);
    else
      entries.push({
        playerId: hit.player.id,
        name: hit.player.officialName,
        position: hit.player.position,
        draft,
        matched: hit.matched,
      });
  };
  const tryMatch = (name: string, pos: string): OcrMatchResult | null => {
    const hit = matchRosterPlayer(name, roster);
    if (!hit) unmatched.push({ name, pos });
    return hit;
  };
  const pushRows = () => {
    for (const row of ocr.rows) {
      if (row.rating === null) continue; // N/A/没识别到评分 = 没上场，不预填
      const hit = tryMatch(row.name, row.pos);
      if (!hit) continue;
      push(hit, { appearance: true, rating: row.rating });
    }
  };

  pushRows();

  if (ocr.tab === 'goalkeeping') {
    if (!ocr.gk) warnings.push('截图里没有门将详情（Goalkeeping 面板），扑救与零封无法预填');
    else {
      const hit = tryMatch(ocr.gk.name, 'GK');
      if (hit) {
        const draft: OcrEntryDraft = { appearance: true };
        if ((ocr.gk.saves ?? 0) > 0) draft.saves = ocr.gk.saves as number;
        if (ocr.gk.goalsConceded === 0) draft.cleanSheet = true;
        push(hit, draft);
      }
    }
  }

  return { entries, unmatched, warnings };
}

/** 识别结果与比分的交叉校验（不阻断，只出警告让管理员判断）。 */
export function ocrCrossChecks(
  ocr: OcrVision,
  ctx: { side: 'home' | 'away'; scoreHome: number; scoreAway: number },
): string[] {
  const warnings: string[] = [];
  const sideScore = ctx.side === 'home' ? ctx.scoreHome : ctx.scoreAway;
  const opponentScore = ctx.side === 'home' ? ctx.scoreAway : ctx.scoreHome;

  const goalsSum = ocr.rows.reduce((sum, r) => sum + r.goals, 0);
  if (goalsSum > sideScore) warnings.push(`截图行内进球合计 ${goalsSum} 超过本队比分 ${sideScore}，可能有行识别错了`);

  if (ocr.tab === 'goalkeeping' && ocr.gk?.goalsConceded != null) {
    const conceded = ocr.gk.goalsConceded;
    if (conceded > opponentScore) warnings.push(`截图失球 ${conceded} 超过对方比分 ${opponentScore}，数字对不上`);
    else if (conceded < opponentScore) warnings.push(`截图失球 ${conceded} 少于对方比分 ${opponentScore}，对方进球可能没全被识别`);
  }
  const gk = ocr.gk;
  if (gk && gk.saves != null && gk.goalsConceded != null && gk.shotsOnTarget != null && gk.saves + gk.goalsConceded !== gk.shotsOnTarget) {
    warnings.push(`截图内部不一致：扑救 ${gk.saves} + 失球 ${gk.goalsConceded} ≠ 射正 ${gk.shotsOnTarget}，核对一下这张图`);
  }
  return warnings;
}
