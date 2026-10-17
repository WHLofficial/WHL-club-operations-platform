// 管理端 · 成长录入（v6.16.0）：按场给球员补录成长数据（出场 / 评分 / 零封 / 夺回球权 / 扑救）。
// 交互对照参考插件 fixtures 编辑器：行内编辑 + 基线脏检测 + 只提交有改动的行 + 未保存切换要确认；
// 页面结构 = 比赛列表卡（全部可录场次，v6.45.1 起可按赛事/按轮次两个视图切换）+ 行内按钮在该行下方展开的内嵌面板（不弹窗、不跳页）。
import { Fragment, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  COMPETITION_TYPE_LABEL,
  type MatchEntryInput,
  type MatchEntryListItem,
  type MatchEntryPanel,
  type MatchEntryPerPlayerResult,
  type MatchEntrySuspended,
  ocrMatchEntry,
} from '../../lib/api.ts';
import { mergeOcrEntries, sideConcededOf } from '../../lib/growth-ocr.ts';
import { fileToOcrBase64 } from '../../lib/ocr-image.ts';
import { groupMatchEntries, groupMatchEntriesByRound } from '../../lib/growth-entry-group.ts';
import {
  MATCH_ENTRY_LIST_KEY,
  fetchMatchEntryList,
  fetchMatchEntryPanel,
  matchEntryPanelKey,
  submitMatchEntry,
} from '../../lib/adminQueries.ts';
import { entryXp, type GrowthEntryDraft } from '../../lib/growth-xp.ts';
import { useTimeFmt } from '../../lib/datetime.ts';
import { useToast } from '../../lib/toast.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';
import EmptyState from '../../components/EmptyState.tsx';

type Side = 'home' | 'away';
type Mode = 'edit' | 'view';

/** v6.51.3：队名分不清主客的一张图（服务端回 400 code=ocr_team_ambiguous）——留图等用户选边或取消 */
interface OcrPending {
  /** 本轮上传里的第 i 张（0 基），提示行按 key + 1 报张号 */
  key: number;
  /** 这张图的 base64：选边后原样重发，不再要用户重选文件 */
  image: string;
  /** 服务端 400 文案：内含模型照抄的截图英文队名（teamRaw）与本场两侧 */
  message: string;
}

/** v6.21.0 窄屏卡片流断点：与 styles.css 管理端 ≤760 媒体块同档，也与 AdminLayout 抽屉断点一致 */
const ENTRY_CARDS_QUERY = '(max-width: 760px)';

/**
 * v6.51.10 悬停预取的缓存新鲜期：与全局 staleTime（web/src/main.tsx 30s）同口径，写成显式值 ——
 * 全局若被改成 0，这条预取就退化成「每次掠过白拉一趟、点开还要再拉」，等于没有。
 */
const PANEL_PREFETCH_STALE_MS = 30_000;

interface FieldNum {
  value: string;
  locked: boolean;
}

interface FieldBool {
  checked: boolean;
  locked: boolean;
}

/** 面板构建时的基线快照（脏检测用：只比未锁定的格子） */
interface RowBase {
  appearance: boolean;
  rating: string;
  cleanSheet: boolean;
  duelsWon: string;
  saves: string;
}

interface RowDraft {
  playerId: number;
  name: string;
  position: string | null;
  /** players.status === 'trainee'：训练营徽标（v6.45.0 起与正式球员同口径按场次计 XP） */
  trainee: boolean;
  /** 本场停赛（v6.45.0）：非空 = 整行不可录（面板标红置灰、输入禁用、保存跳过，服务端也会整行拒） */
  suspended: MatchEntrySuspended | null;
  appearance: FieldBool;
  rating: FieldNum;
  cleanSheet: FieldBool;
  duelsWon: FieldNum;
  saves: FieldNum;
  /** 已录进球 / 助攻（只读列，没有则为 0 显示 —） */
  goals: number;
  assists: number;
  /** 已录进球/助攻那几行的 XP（本场XP = entryXp(草稿) + extraXp） */
  extraXp: number;
  /** 累计项基数：夺回球权/扑救的历史累计次数（已录行 = 面板累计 − 本场已录值，复现已入账 XP） */
  duelsBase: number;
  savesBase: number;
  /** 已录来源（中文标签，去重） */
  sources: string[];
  base: RowBase;
  result: { kind: 'ok' | 'dup' | 'bad'; text: string } | null;
}

const fmtXp = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 单次提交行数上限（服务端 POST /growth/match-entry/:matchId 每行至少一项、最多 50 行） */
const BATCH_SUBMIT_MAX = 50;

/** 保存成功的 toast 文案：新录 / 改值 / 重复跳过分开说，XP 是差额（改低会为负） */
function savedText(s: { written: number; updated: number; duplicates: number; totalXp: number }): string {
  const parts = [`新录 ${s.written} 项`];
  if (s.updated > 0) parts.push(`改 ${s.updated} 项`);
  if (s.duplicates > 0) parts.push(`重复跳过 ${s.duplicates} 项`);
  const xp = `${s.totalXp < 0 ? '' : '+'}${fmtXp(s.totalXp)}`;
  return `已保存：${parts.join('、')}，合计 ${xp} XP。`;
}

/** 停赛理由中文（与服务端 suspensionLabel 同词：直红 / 两黄变一红 / 累积黄牌） */
const SUSPEND_REASON_LABEL: Record<MatchEntrySuspended['reason'], string> = {
  red: '直红',
  red_2y: '两黄变一红',
  yellow: '累积黄牌',
};

/** 停赛标注：本场停赛（直红 · 总 2 场）——serving 是「服到第几场」，展示总场数更有用 */
const suspendedText = (s: MatchEntrySuspended): string => `本场停赛（${SUSPEND_REASON_LABEL[s.reason]} · 总 ${s.total} 场）`;

/** recorded.source 的展示标注：manual = 管理组补录，其余一律按赛果同步理解 */
const sourceLabel = (source: string): string => (source === 'manual' ? '管理组补录' : '赛果同步');

/**
 * 格子视觉（v6.45.1）：recorded = 库里已有值（灰底），与是否可改无关（基线非空即已录）；
 * editable = 已录但仍能改的格子（手录的评分 / 夺回球权 / 扑救），另给强调边。
 */
const cellCls = (base: string, recorded: boolean, locked: boolean): string =>
  [base, recorded ? 'recorded' : '', recorded && !locked ? 'editable' : ''].filter(Boolean).join(' ');

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const isPositiveInt = (s: string): boolean => {
  const t = s.trim();
  if (t === '') return false;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1;
};

// 夺回球权收 0（v6.42.0）：0 行本身 0 XP，合法 —— 它是「防守球员人工确认」的载体（填了，哪怕是 0）
const isNonNegativeInt = (s: string): boolean => {
  const t = s.trim();
  if (t === '') return false;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0;
};

/** 行输入问题（空格子不报错；非空但不合法给中文原因） */
function rowIssues(r: RowDraft): string[] {
  const out: string[] = [];
  if (!r.rating.locked && r.rating.value.trim() !== '') {
    const v = Number(r.rating.value);
    // v6.46.0：评分放宽到 0.0-10.0（均分要真实）。7.0 以下照录，只是不给 XP
    if (!Number.isFinite(v) || v < 0 || v > 10) out.push('评分需在 0.0–10.0');
  }
  if (!r.duelsWon.locked && r.duelsWon.value.trim() !== '' && !isNonNegativeInt(r.duelsWon.value)) out.push('夺回球权需为非负整数');
  if (!r.saves.locked && r.saves.value.trim() !== '' && !isPositiveInt(r.saves.value)) out.push('扑救需为正整数');
  // 已录的手录值可改但**不能清空**（v6.45.1）：清空等于删事件，平台没有删除通道——照旧提交会被
  // toEntry 跳过（不算改动），可这一行会永远算脏（基线是旧值、格子空着），「全部保存」只会反复报
  //「这些行没有可保存的改动」。拦成非法输入，让人要么填新值、要么走「不保存，继续」丢掉草稿。
  if (!r.rating.locked && r.base.rating !== '' && r.rating.value.trim() === '') out.push('已录的评分不能清空（没有删除通道），填新值即可改');
  if (!r.duelsWon.locked && r.base.duelsWon !== '' && r.duelsWon.value.trim() === '')
    out.push('已录的夺回球权不能清空（没有删除通道），填新值即可改');
  if (!r.saves.locked && r.base.saves !== '' && r.saves.value.trim() === '') out.push('已录的扑救不能清空（没有删除通道），填新值即可改');
  return out;
}

function rowDirty(r: RowDraft): boolean {
  if (!r.appearance.locked && r.appearance.checked !== r.base.appearance) return true;
  if (!r.rating.locked && r.rating.value !== r.base.rating) return true;
  if (!r.cleanSheet.locked && r.cleanSheet.checked !== r.base.cleanSheet) return true;
  if (!r.duelsWon.locked && r.duelsWon.value !== r.base.duelsWon) return true;
  if (!r.saves.locked && r.saves.value !== r.base.saves) return true;
  return false;
}

/** 一行草稿 → 提交条目（只带有值且未锁定的字段；没有可提交字段返回 null） */
function toEntry(r: RowDraft): MatchEntryInput | null {
  const e: MatchEntryInput = { playerId: r.playerId };
  let any = false;
  if (!r.appearance.locked && r.appearance.checked) {
    e.appearance = true;
    any = true;
  }
  if (!r.rating.locked) {
    const v = numOrNull(r.rating.value);
    if (v !== null) {
      e.rating = v;
      any = true;
    }
  }
  if (!r.cleanSheet.locked && r.cleanSheet.checked) {
    e.cleanSheet = true;
    any = true;
  }
  if (!r.duelsWon.locked) {
    const v = numOrNull(r.duelsWon.value);
    if (v !== null) {
      e.duelsWon = v;
      any = true;
    }
  }
  if (!r.saves.locked) {
    const v = numOrNull(r.saves.value);
    if (v !== null) {
      e.saves = v;
      any = true;
    }
  }
  return any ? e : null;
}

const draftOf = (r: RowDraft): GrowthEntryDraft => ({
  appearance: r.appearance.checked,
  rating: numOrNull(r.rating.value),
  cleanSheet: r.cleanSheet.checked,
  duelsWon: numOrNull(r.duelsWon.value),
  saves: numOrNull(r.saves.value),
});

const rowXp = (r: RowDraft): number => entryXp(draftOf(r), { duelsWon: r.duelsBase, saves: r.savesBase }) + r.extraXp;

/**
 * 保存结果回填：基线前移（提交过的格子不再算脏）+ 按 perPlayer 给结果徽标。
 * 锁定状态只由保存本身决定的部分（勾选标记：出场 / 零封已是「记过」⇒ 锁）在这里落；
 * 数值项保持可改（v6.45.1：手录值可改后重提），本格刚提交过 ⇒ 来源已是 manual，仍然解锁。
 */
function applyResult(r: RowDraft, e: MatchEntryInput, p: MatchEntryPerPlayerResult | undefined): RowDraft {
  const next: RowDraft = {
    ...r,
    appearance: e.appearance !== undefined ? { ...r.appearance, locked: true } : r.appearance,
    cleanSheet: e.cleanSheet !== undefined ? { ...r.cleanSheet, locked: true } : r.cleanSheet,
    base: {
      appearance: e.appearance !== undefined ? r.appearance.checked : r.base.appearance,
      rating: e.rating !== undefined ? r.rating.value : r.base.rating,
      cleanSheet: e.cleanSheet !== undefined ? r.cleanSheet.checked : r.base.cleanSheet,
      duelsWon: e.duelsWon !== undefined ? r.duelsWon.value : r.base.duelsWon,
      saves: e.saves !== undefined ? r.saves.value : r.base.saves,
    },
  };
  const xpText = `${p && p.xp < 0 ? '' : '+'}${fmtXp(p?.xp ?? 0)}`;
  if (!p) return { ...next, result: { kind: 'bad', text: '失败：后端未返回该球员结果' } };
  if (p.written > 0 || p.updated > 0) {
    const parts: string[] = [];
    if (p.written > 0) parts.push(`新录 ${p.written} 项`);
    if (p.updated > 0) parts.push(`改 ${p.updated} 项`);
    return {
      ...next,
      result: { kind: 'ok', text: `${parts.join('、')} ${xpText} XP${p.duplicates > 0 ? `（${p.duplicates} 项重复跳过）` : ''}` },
    };
  }
  if (p.duplicates > 0) return { ...next, result: { kind: 'dup', text: '已录重复跳过（值没变）' } };
  return { ...next, result: { kind: 'bad', text: '失败：没有写入任何数据' } };
}

/** 用面板数据构建某一队侧的行草稿：已录项预填；可改性见 lockMark / lockNum */
function buildSideRows(panel: MatchEntryPanel, side: Side, mode: Mode): RowDraft[] {
  const s = panel.sides[side];
  return s.players.map((p) => {
    const recs = panel.recorded.filter((x) => x.playerId === p.id);
    let appearance = false;
    let cleanSheet = false;
    let rating = '';
    let duelsWon = '';
    let saves = '';
    let goals = 0;
    let assists = 0;
    let extraXp = 0;
    const seen = { appearance: false, rating: false, clean_sheet: false, duels_won: false, saves: false };
    // 每类已录值的来源（UNIQUE(player_id, match_ref, event_type) ⇒ 每类至多一行）
    const origin: Partial<Record<'appearance' | 'rating' | 'clean_sheet' | 'duels_won' | 'saves', string>> = {};
    const sources: string[] = [];
    for (const rec of recs) {
      switch (rec.eventType) {
        case 'appearance':
          seen.appearance = true;
          origin.appearance = rec.source;
          appearance = true;
          break;
        case 'rating':
          seen.rating = true;
          origin.rating = rec.source;
          rating = String(rec.value);
          break;
        case 'clean_sheet':
          seen.clean_sheet = true;
          origin.clean_sheet = rec.source;
          cleanSheet = true;
          break;
        case 'duels_won':
          seen.duels_won = true;
          origin.duels_won = rec.source;
          duelsWon = String(rec.value);
          break;
        case 'saves':
          seen.saves = true;
          origin.saves = rec.source;
          saves = String(rec.value);
          break;
        case 'goal':
          goals += rec.value;
          extraXp += rec.xp;
          break;
        case 'assist':
          assists += rec.value;
          extraXp += rec.xp;
          break;
        default:
          break;
      }
      const label = sourceLabel(rec.source);
      if (!sources.includes(label)) sources.push(label);
    }
    // 累计基数（v6.42.0）：面板 duelsTotal/savesTotal = 含本场的全历史；本场已录的行要扣掉
    // 本场值才是「入账当时」的基数（entryXp(已录值, 基数) 精确复现已录 XP），未录行面板值即本次基数
    const duelsBase = (p.duelsTotal ?? 0) - (seen.duels_won ? Number(duelsWon || '0') : 0);
    const savesBase = (p.savesTotal ?? 0) - (seen.saves ? Number(saves || '0') : 0);
    // 锁定口径（v6.45.1）：查看模式全锁；已录的**赛果值**（source 'auto'）只读——值由比赛结果定格；
    // 出场 / 零封是「记过」勾选标记，取消勾选等于删事件（没有删除通道）⇒ 已录即锁；
    // 手录的评分 / 夺回球权 / 扑救可改后重提（服务端更新原行 + 按差额调 XP）。
    const lockMark = (t: 'appearance' | 'clean_sheet'): boolean => mode === 'view' || origin[t] !== undefined;
    const lockNum = (t: 'rating' | 'duels_won' | 'saves'): boolean => mode === 'view' || (origin[t] !== undefined && origin[t] !== 'manual');
    return {
      playerId: p.id,
      // 服务端已按「显示名优先」给 name（rowDisplayName），这里直接用
      name: p.name,
      position: p.position,
      trainee: p.status === 'trainee',
      suspended: p.suspended ?? null,
      appearance: { checked: appearance, locked: lockMark('appearance') },
      rating: { value: rating, locked: lockNum('rating') },
      cleanSheet: { checked: cleanSheet, locked: lockMark('clean_sheet') },
      duelsWon: { value: duelsWon, locked: lockNum('duels_won') },
      saves: { value: saves, locked: lockNum('saves') },
      goals,
      assists,
      extraXp,
      duelsBase,
      savesBase,
      sources,
      base: { appearance, rating, cleanSheet, duelsWon, saves },
      result: null,
    };
  });
}

export default function GrowthEntryPage() {
  return (
    <section className="card admin-section">
      <h2>成长录入</h2>
      <MatchEntrySection />
    </section>
  );
}

/* ---------- 比赛列表 + 内嵌录入面板 ---------- */

type ListView = 'tournament' | 'round';

// 视图偏好落 localStorage（全站 UI 偏好惯例，同 lib/datetime.ts 的时区档）：单页自用，不需要跨组件订阅。
const LIST_VIEW_KEY = 'whl.growth-entry.view';

/** 存量非法值 / 取不到 localStorage（隐私模式）一律回落赛事视图 */
function readListView(): ListView {
  try {
    return localStorage.getItem(LIST_VIEW_KEY) === 'round' ? 'round' : 'tournament';
  } catch {
    return 'tournament';
  }
}

/** 铺满整行的组头单元格（td 铺满 6 列）：赛事/轮次两个视图共用 */
function GroupRow({ className, children }: { className: string; children: ReactNode }) {
  return (
    <tr className={className}>
      <td colSpan={6}>{children}</td>
    </tr>
  );
}

function MatchEntrySection() {
  const { show, toastNode } = useToast();
  // v6.25.0：确认时刻显示走共享时区层（默认北京时间）
  const { dateTime } = useTimeFmt();
  const { data, error } = useQuery({ queryKey: MATCH_ENTRY_LIST_KEY, queryFn: fetchMatchEntryList });
  const [open, setOpen] = useState<{ matchId: number; mode: Mode } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [view, setView] = useState<ListView>(readListView);
  // 确认条的「保存并继续」：行在面板 state 里，面板把这个出口挂到 ref 上（见 EntryPanel.saveAllSides）
  const saveAllRef = useRef<(() => Promise<boolean>) | null>(null);
  // 确认条的「不保存，继续」（v6.51.4）：收起/切比赛靠面板重挂丢弃草稿，但换队侧不重挂，
  // 草稿会留在面板里——所以丢弃也得由面板执行，出口同样挂 ref（见 EntryPanel.discardDrafts）
  const discardRef = useRef<(() => void) | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  // v6.51.10 悬停预取：鼠标掠过（或键盘聚焦到）某一行就先把该场面板数据拉进缓存，点「录数据」时多半
  // 直接命中、省掉一波往返。失败的预取不留错误态——清掉缓存条目，点开后的正常请求照旧、错误由面板自己报。
  const queryClient = useQueryClient();
  const openRef = useRef<number | null>(null);
  useEffect(() => {
    openRef.current = open?.matchId ?? null;
  }, [open]);

  function prefetchPanel(matchId: number) {
    if (open?.matchId === matchId) return; // 已展开的那场由面板自己的 query 管，不重复拉
    const key = matchEntryPanelKey(matchId);
    void queryClient
      .prefetchQuery({
        queryKey: key,
        queryFn: () => fetchMatchEntryPanel(matchId),
        staleTime: PANEL_PREFETCH_STALE_MS,
      })
      .then(() => {
        if (queryClient.getQueryState(key)?.status === 'error' && openRef.current !== matchId) {
          queryClient.removeQueries({ queryKey: key, exact: true });
        }
      });
  }

  function switchView(next: ListView) {
    setView(next);
    try {
      localStorage.setItem(LIST_VIEW_KEY, next);
    } catch {
      // 写不进去只影响下次打开的默认视图，本次切换照常
    }
  }

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '比赛列表加载失败', true);
  }, [error, show]);

  function runOpen(next: { matchId: number; mode: Mode } | null) {
    setPending(null);
    setDirty(false);
    setOpen(next);
  }

  /** 未保存改动闸门：有脏改动先出确认条，确认后才执行切换/收起 */
  function guard(action: () => void) {
    if (dirty) setPending(() => action);
    else action();
  }

  function toggleMatch(m: MatchEntryListItem, mode: Mode) {
    const same = open !== null && open.matchId === m.matchId && open.mode === mode;
    guard(() => runOpen(same ? null : { matchId: m.matchId, mode }));
  }

  /**
   * 确认条的「保存并继续」：先让面板把两队侧的脏行提交掉（保存失败或行内有非法输入则保存在原地、
   * 不执行待执行动作），成功了再收起/切换。保存本身由面板 toast 反馈，这里只管放不放行。
   */
  async function saveThenContinue() {
    const act = pending;
    if (act === null || savingAll) return;
    setSavingAll(true);
    try {
      const ok = await (saveAllRef.current?.() ?? Promise.resolve(true));
      if (!ok) return;
      setPending(null);
      act();
    } finally {
      setSavingAll(false);
    }
  }

  /** 一行比赛 +（展开时）行内录入面板：赛事/轮次两个视图共用 */
  function renderRows(matches: MatchEntryListItem[]) {
    return matches.map((m) => {
      const opened = open !== null && open.matchId === m.matchId ? open : null;
      return (
        <Fragment key={m.matchId}>
          <tr onMouseEnter={() => prefetchPanel(m.matchId)} onFocus={() => prefetchPanel(m.matchId)}>
            <td className="muted">
              S{m.season} · {m.competitionType} · 窗口 {m.windowSeq}
            </td>
            <td>
              {m.homeTeam} <span className="muted">vs</span> {m.awayTeam}
            </td>
            <td className="num mono">
              {m.scoreHome} : {m.scoreAway}
            </td>
            <td className="muted">{dateTime(m.confirmedAt)}</td>
            <td>
              {m.recorded > 0 ? (
                <span className="badge green">已录 {m.recorded} 项</span>
              ) : (
                <span className="badge gray">未录</span>
              )}
            </td>
            <td className="match-entry-actions">
              <button type="button" className="btn btn-sm" onClick={() => toggleMatch(m, 'edit')}>
                {opened?.mode === 'edit' ? '收起' : '录数据'}
              </button>
              {m.recorded > 0 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleMatch(m, 'view')}>
                  {opened?.mode === 'view' ? '收起' : '查看'}
                </button>
              )}
            </td>
          </tr>
          {opened && (
            <tr className="entry-row">
              <td colSpan={6}>
                {pending && (
                  <div className="banner warn entry-confirm">
                    <span>录入面板有未保存的改动：收起面板、切换比赛、切换视图或换队侧，确认后都会丢弃草稿（不提交）。</span>
                    <button type="button" className="btn btn-sm" onClick={() => setPending(null)}>
                      继续编辑
                    </button>
                    <button type="button" className="btn btn-sm" disabled={savingAll} onClick={() => void saveThenContinue()}>
                      {savingAll ? '保存中…' : '保存并继续'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        const act = pending;
                        setPending(null);
                        // 先让面板把两侧草稿按服务端数据重建（换队侧不重挂面板，只有它能丢），再执行待执行动作
                        discardRef.current?.();
                        act();
                      }}
                    >
                      不保存，继续
                    </button>
                  </div>
                )}
                <EntryPanel
                  key={`${m.matchId}:${opened.mode}`}
                  match={m}
                  mode={opened.mode}
                  guard={guard}
                  onClose={() => runOpen(null)}
                  onDirtyChange={setDirty}
                  saveAllRef={saveAllRef}
                  discardRef={discardRef}
                  show={show}
                />
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  }

  /** 赛事视图：赛事 → 轮次 → 比赛 */
  function tournamentView(matches: MatchEntryListItem[]) {
    return groupMatchEntries(matches).map((g) => (
      <Fragment key={g.tournamentId === null ? 'none' : `t${g.tournamentId}`}>
        <GroupRow className="match-entry-group">
          {g.label} <span className="muted">· {g.matchCount} 场</span>
        </GroupRow>
        {g.rounds.map((rd) => (
          <Fragment key={rd.key}>
            <GroupRow className="match-entry-group-sub">
              {rd.label} <span className="muted">· {rd.matches.length} 场</span>
            </GroupRow>
            {renderRows(rd.matches)}
          </Fragment>
        ))}
      </Fragment>
    ));
  }

  /** 轮次视图（v6.45.1）：轮次 → 比赛单层，赛事名收进组头 */
  function roundView(matches: MatchEntryListItem[]) {
    return groupMatchEntriesByRound(matches).map((rd) => (
      <Fragment key={rd.key}>
        <GroupRow className="match-entry-group">
          {rd.label} <span className="muted">· {rd.tournament}</span> <span className="muted">· {rd.matches.length} 场</span>
        </GroupRow>
        {renderRows(rd.matches)}
      </Fragment>
    ));
  }

  return (
    <>
      {toastNode}
      <p className="hint">
        已确认的非弃权场次都可录（v6.46.0 起含冠军杯淘汰赛 / 超级杯 / 资格赛）；列表按确认时间倒序列出全部可补录比赛，可切换「按赛事」或「按轮次」查看。
        不产成长 XP 的场次只能录出场与评分（行首标「不计 XP」）；本场停赛的球员不能录成长（行内已标红）。
        出场与评分走截图识别 + 人工确认；
        赛果确定的值（进球、助攻、赛果零封）只读，手录的评分 / 夺回球权 / 扑救可改后重新提交（XP 按差额调整）；
        已录的出场与零封是记过标记，不能撤销。
      </p>
      <div className="list-head">
        <h3>可补录比赛</h3>
        <div className="seg" role="radiogroup" aria-label="列表视图">
          <button
            type="button"
            className={view === 'tournament' ? 'on' : ''}
            onClick={() => {
              if (view !== 'tournament') guard(() => switchView('tournament'));
            }}
          >
            按赛事
          </button>
          <button
            type="button"
            className={view === 'round' ? 'on' : ''}
            onClick={() => {
              if (view !== 'round') guard(() => switchView('round'));
            }}
          >
            按轮次
          </button>
        </div>
      </div>
      {!data ? (
        <p className="muted">{error ? '加载失败，请稍后重试。' : '加载中…'}</p>
      ) : data.matches.length === 0 ? (
        <EmptyState>没有可补录的比赛。只有联赛与冠军杯小组赛、已确认且可计 XP 的场次会出现在这里。</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>赛季 / 窗口</th>
                <th>对阵</th>
                <th className="num">比分</th>
                <th>确认时间</th>
                <th>已录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>{view === 'round' ? roundView(data.matches) : tournamentView(data.matches)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------- 单场录入面板 ---------- */

function EntryPanel({
  match,
  mode,
  guard,
  onClose,
  onDirtyChange,
  saveAllRef,
  discardRef,
  show,
}: {
  match: MatchEntryListItem;
  mode: Mode;
  guard: (action: () => void) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** 父级确认条的「保存并继续」出口：面板把「保存两队侧脏行」挂到这里（见 saveAllSides） */
  saveAllRef: { current: (() => Promise<boolean>) | null };
  /** 父级确认条的「不保存，继续」出口（v6.51.4）：面板把「按服务端数据重建两队侧行」挂到这里（见 discardDrafts） */
  discardRef: { current: (() => void) | null };
  /**
   * 父级的 toast 出口（v6.45.1）：面板自己 useToast 的 node 渲在面板里，收起面板（保存并继续）时
   * 会和面板一起卸载——「已保存」提示当场消失。所以面板统一用父级的 show，node 挂在列表卡上。
   */
  show: (text: string, err?: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: matchEntryPanelKey(match.matchId),
    queryFn: () => fetchMatchEntryPanel(match.matchId),
  });
  const [rows, setRows] = useState<Record<Side, RowDraft[]> | null>(null);
  const [side, setSide] = useState<Side>('home');
  const [saving, setSaving] = useState<number | 'all' | null>(null);
  const [lastSummary, setLastSummary] = useState<{ written: number; updated: number; duplicates: number; totalXp: number } | null>(
    null,
  );
  // v6.43.1 截图识别：一个入口多选上传，busy 带进度（第 i/n 张），report 常驻展示在工具栏下（比 toast 更耐看——警告多行）
  const [ocrBusy, setOcrBusy] = useState<null | { done: number; total: number }>(null);
  const [ocrReport, setOcrReport] = useState<{ ok: boolean; lines: string[] } | null>(null);
  // v6.51.3 歧义待选：识别成功但队名分不清主客时不失败也不猜 —— 提示 +「主队 / 客队 / 取消」三颗按钮
  const [ocrChoices, setOcrChoices] = useState<OcrPending[]>([]);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const builtRef = useRef<string | null>(null);
  // rows 的同步镜像：截图识别要等 13-90 秒，期间管理员可能手填格子——
  // 响应回来时合并基底必须是最新的行（闭包里的 rows 是发起那一刻的快照，直接用会覆盖等待期的手填）
  const rowsRef = useRef<Record<Side, RowDraft[]> | null>(null);
  /** 在飞的保存（v6.45.1）：确认条「保存并继续」要等它落地再算脏行——闭包里的 saving 是旧渲染的快照，
   *  行内保存刚点完就点「收起」，只看状态会以为没有保存在进行中，那一行会被漏掉。 */
  const savingRef = useRef<Promise<boolean> | null>(null);
  /** 所有 rows 写入都走这里，保证 rowsRef 与状态同调（updateRow / 识别合并 / 保存锁定共用） */
  function setRowsTracked(updater: (prev: Record<Side, RowDraft[]> | null) => Record<Side, RowDraft[]> | null) {
    setRows((prev) => {
      const next = updater(prev);
      rowsRef.current = next;
      return next;
    });
  }
  /** 窄屏（≤760）改渲染卡片流；桌面仍渲染原表格（两端 DOM 互斥，桌面零变化） */
  const narrow = useMediaQuery(ENTRY_CARDS_QUERY);

  // 只在 (比赛, 模式) 首次拿到数据时建行：保存后的 invalidate 重拉不会覆盖本地脏状态与结果徽标
  useEffect(() => {
    if (!data) return;
    const built = `${data.match.matchId}:${mode}`;
    if (builtRef.current === built) return;
    builtRef.current = built;
    setRowsTracked(() => ({ home: buildSideRows(data, 'home', mode), away: buildSideRows(data, 'away', mode) }));
    setSide(data.sides.home.isCpu || data.sides.home.players.length === 0 ? 'away' : 'home');
    setLastSummary(null);
  }, [data, mode]);

  // 把整面板（两侧一起）的脏状态报给父级：切换比赛 / 收起 / 换队侧前要确认
  useEffect(() => {
    if (rows === null) return;
    onDirtyChange((['home', 'away'] as Side[]).some((s) => rows[s].some(rowDirty)));
  }, [rows, onDirtyChange]);

  /**
   * 「不保存，继续」用（v6.51.4）：把两侧行按当前服务端数据重建，丢掉所有未提交的输入。
   * 收起 / 切比赛 / 切视图都会重挂面板（组件卸载，草稿自然没了），只有换队侧不重挂——
   * 那条路上的草稿必须在这里显式清掉，否则「不保存」名不副实（父级确认条文案承诺的是丢弃）。
   */
  function discardDrafts() {
    if (!data) return;
    setRowsTracked(() => ({ home: buildSideRows(data, 'home', mode), away: buildSideRows(data, 'away', mode) }));
  }

  // 父级确认条要在「动作执行前」调到最新的 saveAllSides（行在面板 state 里，父级看不到）：
  // 用 latest-ref 挂上去，父级 await 完拿到 false 就不继续执行待执行动作。
  // 注意：这三个 hook 必须在下面 isLoading/error 早返回之前——早返回会改 hook 数量，React 直接报错。
  const latestSaveAll = useRef(saveAllSides);
  useEffect(() => {
    latestSaveAll.current = saveAllSides;
  });
  useEffect(() => {
    saveAllRef.current = () => latestSaveAll.current();
    return () => {
      saveAllRef.current = null;
    };
  }, [saveAllRef]);
  // 「不保存，继续」同样走 latest-ref（丢弃要吃到最新一次渲染的 data 与 mode）
  const latestDiscard = useRef(discardDrafts);
  useEffect(() => {
    latestDiscard.current = discardDrafts;
  });
  useEffect(() => {
    discardRef.current = () => latestDiscard.current();
    return () => {
      discardRef.current = null;
    };
  }, [discardRef]);

  if (error) {
    return (
      <div>
        <p className="bad-text">面板加载失败：{error instanceof Error ? error.message : '未知错误'}</p>
        <button type="button" className="btn btn-sm" onClick={() => void refetch()}>
          重试
        </button>
      </div>
    );
  }
  if (isLoading || !data || !rows) return <p className="muted">面板加载中…</p>;

  const activeRows = rows[side];
  const totalXp = activeRows.reduce((sum, r) => sum + rowXp(r), 0);
  /**
   * v6.46.0：本场不计成长 XP（冠军杯淘汰赛/超级杯/资格赛）。这些场次也放开补录，但只收出场与评分：
   * 零封/夺回球权/扑救是纯 XP 计数器，写进去服务端整批拒收（440 文案点名），所以这里直接禁掉，
   * 并把 XP 展示统一按住为 0 —— 不让管理组以为有收益。
   */
  const noXp = match.xpEligible === false;
  const hasDirty = (['home', 'away'] as Side[]).some((s) => rows[s].some(rowDirty));
  /** 当前队侧脏行数（窄屏汇总条展示用；saveAll 也只提交当前队侧的脏行） */
  const dirtyCount = activeRows.filter(rowDirty).length;

  function updateRow(playerId: number, fn: (r: RowDraft) => RowDraft) {
    setRowsTracked((prev) => (prev ? { ...prev, [side]: prev[side].map((r) => (r.playerId === playerId ? fn(r) : r)) } : prev));
  }

  // v6.43.0 截图识别，v6.43.1 改一个入口多选上传：逐张顺序调服务端识别（页签由服务端看图决定）
  // 并逐张合并进行草稿——同值去重、异值保留先填的值并提示冲突，重复出现在两页的球员不重复写。
  // 顺序而非并行：视觉模型有 429 限流，四张并发必撞；单张先过 fileToOcrBase64 放大再送（v6.51.5）。
  async function runOcr(files: File[]) {
    if (ocrBusy !== null || rowsRef.current === null || files.length === 0) return;
    setOcrReport(null);
    setOcrChoices([]);
    const lines: string[] = [];
    const pending: OcrPending[] = [];
    let okCount = 0;
    for (let i = 0; i < files.length; i += 1) {
      setOcrBusy({ done: i, total: files.length });
      let image = '';
      try {
        image = await fileToOcrBase64(files[i]);
        const res = await ocrMatchEntry(match.matchId, image);
        const target: Side = res.side;
        // 合并基底取 rowsRef（等待识别期间的手填与上一张的预填都在里面），不用闭包快照
        if (!rowsRef.current) break;
        const merged = mergeOcrEntries(rowsRef.current[target], res.entries, sideConcededOf(match, target), !noXp);
        setRowsTracked((prev) => (prev ? { ...prev, [target]: merged.rows } : prev));
        setSide(target);
        okCount += 1;
        const kindLabel = res.kind === 'goalkeeping' ? '门将页' : 'Summary';
        lines.push(
          `第 ${i + 1} 张（${res.team ?? '?'} · ${kindLabel}）：预填 ${merged.applied} 格${merged.deduped > 0 ? `、去重 ${merged.deduped} 格` : ''}${merged.gkAuto > 0 ? `、零封联动自动勾 ${merged.gkAuto} 名门将` : ''}`,
        );
        if (merged.skipped.length > 0) {
          lines.push(`　跳过 ${merged.skipped.length} 条：${merged.skipped.map((s) => `${s.name}（${s.reason}）`).join('、')}`);
        }
        if (res.unmatched.length > 0) {
          lines.push(`　认人失败 ${res.unmatched.length} 行：${res.unmatched.map((u) => u.name).join('、')}——请在表内手填`);
        }
        for (const w of res.warnings) lines.push(w);
      } catch (err) {
        // 队名对不上侧不是失败（v6.51.3 歧义 / v6.51.8 对不上，含模型给英文名）：不落红字，
        // 改成提示 + 三颗按钮，选完用这张图带 side 续跑
        if (err instanceof ApiError && (err.code === 'ocr_team_ambiguous' || err.code === 'ocr_team_unmatched')) {
          pending.push({ key: i, image, message: err.message });
        } else {
          lines.push(`第 ${i + 1} 张识别失败：${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
    }
    setOcrBusy(null);
    setOcrChoices(pending);
    setOcrReport({ ok: okCount > 0 || pending.length > 0, lines });
  }

  /** v6.51.3 歧义待选收尾：side=null 表示这张确实传错了，取消掉不预填（其余图不受影响） */
  async function resolveOcrChoice(choice: OcrPending, side: Side | null) {
    setOcrChoices((prev) => prev.filter((c) => c.key !== choice.key));
    if (side === null) {
      setOcrReport((prev) => ({
        ok: true,
        lines: [...(prev?.lines ?? []), `第 ${choice.key + 1} 张：已取消，这张图不预填（其余图不受影响）`],
      }));
      return;
    }
    try {
      const res = await ocrMatchEntry(match.matchId, choice.image, side);
      if (!rowsRef.current) return;
      const merged = mergeOcrEntries(rowsRef.current[side], res.entries, sideConcededOf(match, side), !noXp);
      setRowsTracked((prev) => (prev ? { ...prev, [side]: merged.rows } : prev));
      setSide(side);
      const team = side === 'home' ? match.homeTeam : match.awayTeam;
      const kindLabel = res.kind === 'goalkeeping' ? '门将页' : 'Summary';
      setOcrReport((prev) => ({
        ok: true,
        lines: [
          ...(prev?.lines ?? []),
          `第 ${choice.key + 1} 张（按${side === 'home' ? '主队' : '客队'} ${team} · ${kindLabel}）：预填 ${merged.applied} 格`,
        ],
      }));
    } catch (err) {
      setOcrReport((prev) => ({
        ok: prev?.ok ?? false,
        lines: [...(prev?.lines ?? []), `第 ${choice.key + 1} 张识别失败：${err instanceof Error ? err.message : '未知错误'}`],
      }));
    }
  }

  function onOcrPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) void runOcr(files);
  }

  function sideChip(s: Side) {
    const team = s === 'home' ? match.homeTeam : match.awayTeam;
    const isCpu = s === 'home' ? match.homeIsCpu : match.awayIsCpu;
    const count = data ? data.sides[s].players.length : null;
    const noPlayers = count === 0;
    return {
      team,
      count,
      disabled: isCpu || noPlayers,
      reason: isCpu ? 'CPU 队不计成长' : noPlayers ? '该队暂无已建档球员（未建档）' : undefined,
    };
  }

  /**
   * 提交一批 entries 并回填结果：>50 行自动分批（服务端单批上限 50），统计与 perPlayer 合并。
   * 返回是否全部成功——父级确认条的「保存并继续」靠它决定放不放行。
   */
  async function runSubmitEntries(entries: MatchEntryInput[], tag: number | 'all'): Promise<boolean> {
    if (savingRef.current !== null || entries.length === 0) return false;
    setSaving(tag);
    try {
      const merged = { written: 0, updated: 0, duplicates: 0, totalXp: 0 };
      const byId = new Map<number, MatchEntryPerPlayerResult>();
      for (let i = 0; i < entries.length; i += BATCH_SUBMIT_MAX) {
        const res = await submitMatchEntry(match.matchId, entries.slice(i, i + BATCH_SUBMIT_MAX));
        merged.written += res.written;
        merged.updated += res.updated;
        merged.duplicates += res.duplicates;
        merged.totalXp += res.totalXp;
        for (const p of res.perPlayer) {
          const prev = byId.get(p.playerId);
          byId.set(
            p.playerId,
            prev
              ? { ...p, xp: prev.xp + p.xp, written: prev.written + p.written, updated: prev.updated + p.updated, duplicates: prev.duplicates + p.duplicates }
              : p,
          );
        }
      }
      setRowsTracked((prev) => {
        if (!prev) return prev;
        const next: Record<Side, RowDraft[]> = { home: prev.home, away: prev.away };
        for (const s of ['home', 'away'] as Side[]) {
          next[s] = prev[s].map((r) => {
            const e = entries.find((x) => x.playerId === r.playerId);
            return e ? applyResult(r, e, byId.get(r.playerId)) : r;
          });
        }
        return next;
      });
      setLastSummary(merged);
      void queryClient.invalidateQueries({ queryKey: MATCH_ENTRY_LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: matchEntryPanelKey(match.matchId) });
      show(savedText(merged));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setRowsTracked((prev) => {
        if (!prev) return prev;
        const next: Record<Side, RowDraft[]> = { home: prev.home, away: prev.away };
        for (const s of ['home', 'away'] as Side[]) {
          next[s] = prev[s].map((r) =>
            entries.some((e) => e.playerId === r.playerId) ? { ...r, result: { kind: 'bad' as const, text: `失败：${msg}` } } : r,
          );
        }
        return next;
      });
      show(msg, true);
      return false;
    } finally {
      setSaving(null);
    }
  }

  /** submitEntries = 记账 + 把「这次保存」登记进 savingRef，供确认条等待（见 savingRef 注释） */
  function submitEntries(entries: MatchEntryInput[], tag: number | 'all'): Promise<boolean> {
    if (savingRef.current !== null) return Promise.resolve(false);
    const run = runSubmitEntries(entries, tag);
    savingRef.current = run;
    void run.finally(() => {
      if (savingRef.current === run) savingRef.current = null;
    });
    return run;
  }

  async function saveRows(targets: RowDraft[], tag: number | 'all') {
    const entries = targets.map(toEntry).filter((e): e is MatchEntryInput => e !== null);
    if (entries.length === 0) {
      show('这些行没有可保存的改动。', true);
      return;
    }
    await submitEntries(entries, tag);
  }

  function saveAll() {
    if (savingRef.current !== null || rows === null) return;
    const valid: RowDraft[] = [];
    let skipped = 0;
    for (const r of rows[side]) {
      if (r.suspended !== null || !rowDirty(r)) continue;
      if (rowIssues(r).length > 0) {
        skipped += 1;
        continue;
      }
      valid.push(r);
    }
    if (skipped > 0) show(`有 ${skipped} 行输入不合法，已跳过（行内已标红）。`, true);
    if (valid.length === 0) {
      if (skipped === 0) show('这一侧还没有改动。', true);
      return;
    }
    void saveRows(valid, 'all');
  }

  /**
   * 「保存并继续」用（v6.45.1）：把两队侧的脏行一起提交（停赛行跳过）。任何一行输入不合法就
   * 整批不提交、返回 false——确认条留在原地，让人先改掉行内标红的地方；没有脏行时算放行。
   * 若有行内保存在飞则先等它落地：它提交的那一行基线前移后才不算脏，否则会被漏掉。
   */
  async function saveAllSides(): Promise<boolean> {
    const inflight = savingRef.current;
    if (inflight) await inflight;
    const current = rowsRef.current;
    if (current === null) return false;
    const dirty: RowDraft[] = [];
    let invalid = 0;
    for (const s of ['home', 'away'] as Side[]) {
      for (const r of current[s]) {
        if (r.suspended !== null || !rowDirty(r)) continue;
        if (rowIssues(r).length > 0) invalid += 1;
        else dirty.push(r);
      }
    }
    if (invalid > 0) {
      show(`有 ${invalid} 行输入不合法，先改好再保存（行内已标红）。`, true);
      return false;
    }
    if (dirty.length === 0) return true;
    const entries = dirty.map(toEntry).filter((e): e is MatchEntryInput => e !== null);
    if (entries.length === 0) return true;
    return await submitEntries(entries, 'all');
  }

  return (
    <div className="entry-panel">
      <div className="entry-head">
        <div className="seg">
          {(['home', 'away'] as Side[]).map((s) => {
            const chip = sideChip(s);
            return (
              <button
                key={s}
                type="button"
                className={side === s ? 'on' : undefined}
                disabled={chip.disabled}
                title={chip.reason}
                onClick={() => {
                  if (!chip.disabled && s !== side) guard(() => setSide(s));
                }}
              >
                {s === 'home' ? '主队' : '客队'} · {chip.team}
                {chip.count !== null ? `（${chip.count} 人）` : ''}
              </button>
            );
          })}
        </div>
        {noXp ? (
          <span className="badge gray">本场不计成长 XP（只录出场与评分）</span>
        ) : (
          <span className="badge gold">本场合计 +{fmtXp(totalXp)} XP</span>
        )}
        {lastSummary && (
          <span className="badge gray">
            新录 {lastSummary.written}
            {lastSummary.updated > 0 ? ` · 改 ${lastSummary.updated}` : ''} · 重复 {lastSummary.duplicates} · 合计{' '}
            {lastSummary.totalXp < 0 ? '' : '+'}
            {fmtXp(lastSummary.totalXp)} XP
          </span>
        )}
        <span className="entry-head-actions">
          {/* 窄屏（≤760）「全部保存」移入粘性汇总条 entry-sumbar，头里只留「收起」 */}
          {!narrow && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving !== null || !hasDirty}
              title={hasDirty ? '只提交有改动的行' : '当前没有改动'}
              onClick={saveAll}
            >
              {saving === 'all' ? '保存中…' : '全部保存'}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => guard(onClose)}>
            收起
          </button>
        </span>
      </div>

      {mode === 'edit' && (
        <div className="entry-ocr">
          <span className="muted">截图识别（可选）：</span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={ocrBusy !== null}
            onClick={() => ocrInputRef.current?.click()}
          >
            {ocrBusy ? `识别中 ${ocrBusy.done + 1}/${ocrBusy.total}…` : '上传截图识别'}
          </button>
          <input ref={ocrInputRef} type="file" accept="image/png,image/jpeg" multiple hidden onChange={onOcrPick} />
          <span className="muted">
            可一次多选：双方外场 Summary + 双方门将页。门将页左表也并出额外球员，重复出现的球员自动去重；识别出场 /
            评分 / 零封 / 扑救并预填，冲突保留先填的值；夺回球权仍手填。预填后请人工核对。
          </span>
          <span className="muted">
            改值规则：进球 / 助攻 / 赛果零封由赛果确定，只读；手录的评分 / 夺回球权 / 扑救（浅色斜纹格）可改后重新提交，
            XP 按差额调整；已录的出场与零封是「记过」标记，不能取消。
          </span>
          {ocrReport && (
            <div className={`entry-ocr-report${ocrReport.ok ? '' : ' bad-text'}`}>
              {ocrReport.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
              {ocrChoices.map((ch) => (
                <div key={ch.key} className="entry-ocr-choice">
                  <p>
                    第 {ch.key + 1} 张：{ch.message}
                  </p>
                  <button type="button" className="btn btn-sm" onClick={() => void resolveOcrChoice(ch, 'home')}>
                    主队 {match.homeTeam}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void resolveOcrChoice(ch, 'away')}>
                    客队 {match.awayTeam}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void resolveOcrChoice(ch, null)}>
                    取消（这张图不预填）
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'view' && <p className="hint">只读查看：所有格子已锁定，要改值请点「录数据」。</p>}

      {noXp && (
        <p className="hint">
          本场不计成长 XP（{COMPETITION_TYPE_LABEL[data.match.competitionType] ?? data.match.competitionType} ·{' '}
          {data.match.stageName || '—'}）：只能录出场与评分 —— 评分与出场照常入库（球员比赛记录的出场与均分要用），
          本场 XP 恒为 0；零封 / 夺回球权 / 扑救是纯 XP 计数器，本场不开放。
        </p>
      )}

      {narrow ? (
        /* v6.21.0 窄屏卡片流（≤760）：与桌面表格 DOM 互斥；状态判据、格子锁定规则、
           保存按钮禁用条件与下方表格逐条一致，state 复用同一套 updateRow/rowIssues/rowDirty。 */
        <div className="entry-cards">
          {activeRows.map((r) => {
            const issues = rowIssues(r);
            const dirtyRow = rowDirty(r);
            const ro = r.suspended !== null;
            const ratingBad =
              !r.rating.locked &&
              r.rating.value.trim() !== '' &&
              !(Number.isFinite(Number(r.rating.value)) && Number(r.rating.value) >= 7 && Number(r.rating.value) <= 10);
            const duelsBad = !r.duelsWon.locked && r.duelsWon.value.trim() !== '' && !isNonNegativeInt(r.duelsWon.value);
            const savesBad = !r.saves.locked && r.saves.value.trim() !== '' && !isPositiveInt(r.saves.value);
            return (
              <div
                key={r.playerId}
                className={`entry-card${ro ? ' row-suspended' : ''}${dirtyRow ? ' dirty' : ''}`}
                title={r.suspended ? suspendedText(r.suspended) : undefined}
              >
                <div className="entry-card-head">
                  <span className="entry-card-name">{r.name}</span>
                  <span className="entry-card-pos">{r.position ?? '—'}</span>
                  {r.sources.length > 0 && <span className="badge gray">已录 · {r.sources.join('、')}</span>}
                  {r.trainee && <span className="badge gray">训练营</span>}
                  {r.suspended && <span className="badge red">{suspendedText(r.suspended)}</span>}
                  {issues.length > 0 && (
                    <span className="badge red" title={issues.join('；')}>
                      校验问题
                    </span>
                  )}
                </div>
                <div className="entry-card-grid">
                  <label className={cellCls('entry-card-field', r.base.appearance, r.appearance.locked)}>
                    <span className="entry-card-flabel">出场</span>
                    {r.appearance.locked ? (
                      r.base.appearance || mode === 'edit' ? (
                        <input type="checkbox" checked={r.appearance.checked} disabled />
                      ) : (
                        <span className="muted">—</span>
                      )
                    ) : (
                      <input
                        type="checkbox"
                        className="entry-card-check"
                        checked={r.appearance.checked}
                        disabled={ro}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({
                            ...row,
                            appearance: { ...row.appearance, checked: e.target.checked },
                            result: null,
                          }))
                        }
                      />
                    )}
                  </label>
                  <label className={cellCls('entry-card-field', r.base.rating !== '', r.rating.locked)}>
                    <span className="entry-card-flabel">评分</span>
                    {r.rating.locked ? (
                      r.base.rating === '' && mode === 'view' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="entry-num mono" value={r.rating.value} readOnly tabIndex={-1} />
                      )
                    ) : (
                      <input
                        className={`entry-num mono${ratingBad ? ' invalid' : ''}`}
                        value={r.rating.value}
                        disabled={ro}
                        inputMode="decimal"
                        placeholder="0.0–10.0"
                        onChange={(e) => updateRow(r.playerId, (row) => ({ ...row, rating: { ...row.rating, value: e.target.value }, result: null }))}
                      />
                    )}
                  </label>
                  <label className={cellCls('entry-card-field', r.base.cleanSheet, r.cleanSheet.locked)}>
                    <span className="entry-card-flabel">零封</span>
                    {r.cleanSheet.locked ? (
                      r.base.cleanSheet || mode === 'edit' ? (
                        <input type="checkbox" checked={r.cleanSheet.checked} disabled />
                      ) : (
                        <span className="muted">—</span>
                      )
                    ) : (
                      <input
                        type="checkbox"
                        className="entry-card-check"
                        checked={r.cleanSheet.checked}
                        disabled={ro || noXp}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({
                            ...row,
                            cleanSheet: { ...row.cleanSheet, checked: e.target.checked },
                            result: null,
                          }))
                        }
                      />
                    )}
                  </label>
                  <label className={cellCls('entry-card-field', r.base.duelsWon !== '', r.duelsWon.locked)}>
                    <span className="entry-card-flabel">夺回球权</span>
                    {r.duelsWon.locked ? (
                      r.base.duelsWon === '' && mode === 'view' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="entry-num mono" value={r.duelsWon.value} readOnly tabIndex={-1} />
                      )
                    ) : (
                      <input
                        className={`entry-num mono${duelsBad ? ' invalid' : ''}`}
                        value={r.duelsWon.value}
                        disabled={ro || noXp}
                        inputMode="numeric"
                        placeholder="次数"
                        title={`历史累计 ${r.duelsBase} 次 · 每 12 次 1 XP`}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => {
                            // 零封联动（用户裁决）：本侧失球 0 时，手填夺回球权（含 0）= 确认防守球员 → 自动勾零封；
                            // 清空或改错不联动取消，人工反勾不被覆盖
                            const autoClean =
                              sideConcededOf(match, side) === 0 && !row.cleanSheet.locked && !row.cleanSheet.checked && isNonNegativeInt(e.target.value);
                            return {
                              ...row,
                              duelsWon: { ...row.duelsWon, value: e.target.value },
                              cleanSheet: autoClean ? { ...row.cleanSheet, checked: true } : row.cleanSheet,
                              result: null,
                            };
                          })
                        }
                      />
                    )}
                  </label>
                  <label className={cellCls('entry-card-field', r.base.saves !== '', r.saves.locked)}>
                    <span className="entry-card-flabel">扑救</span>
                    {r.saves.locked ? (
                      r.base.saves === '' && mode === 'view' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="entry-num mono" value={r.saves.value} readOnly tabIndex={-1} />
                      )
                    ) : (
                      <input
                        className={`entry-num mono${savesBad ? ' invalid' : ''}`}
                        value={r.saves.value}
                        disabled={ro || noXp}
                        inputMode="numeric"
                        placeholder="次数"
                        title={`历史累计 ${r.savesBase} 次 · 每 8 次 1 XP`}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({ ...row, saves: { ...row.saves, value: e.target.value }, result: null }))
                        }
                      />
                    )}
                  </label>
                </div>
                {/* 自动通道（赛果同步）已录的进球 / 助攻：只读展示，卡片里不提供录入 */}
                <div className="entry-card-auto">
                  <span className="entry-card-flabel">进球 / 助攻</span>
                  <span className="entry-card-auto-val">
                    {r.goals > 0 ? r.goals : '—'} / {r.assists > 0 ? r.assists : '—'}
                  </span>
                  <span className="badge gray">自动</span>
                </div>
                <div className="entry-card-foot">
                  {noXp ? (
                    <span className="badge gray">不计 XP</span>
                  ) : (
                    <span className="badge gold">本场 +{fmtXp(rowXp(r))} XP</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={ro || saving !== null || !dirtyRow || issues.length > 0}
                    title={r.suspended ? suspendedText(r.suspended) : issues.length > 0 ? issues[0] : dirtyRow ? '提交这一行' : '没有改动'}
                    onClick={() => void saveRows([r], r.playerId)}
                  >
                    {saving === r.playerId ? '保存中…' : '保存'}
                  </button>
                  {issues.length > 0 && <div className="bad-text entry-result">{issues[0]}</div>}
                  {r.result && (
                    <div className="entry-result">
                      <span className={`badge ${r.result.kind === 'ok' ? 'green' : r.result.kind === 'dup' ? 'gray' : 'red'}`}>
                        {r.result.text}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="table-wrap">
        <table className="entry-table">
          <thead>
            <tr>
              <th>球员</th>
              <th>位置</th>
              <th>出场</th>
              <th>评分</th>
              <th>零封</th>
              <th className="num">夺回球权</th>
              <th className="num">扑救</th>
              <th className="num">进球</th>
              <th className="num">助攻</th>
              <th className="num">本场XP</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((r) => {
              const issues = rowIssues(r);
              const dirtyRow = rowDirty(r);
              const ro = r.suspended !== null;
              const ratingBad =
                !r.rating.locked &&
                r.rating.value.trim() !== '' &&
                !(Number.isFinite(Number(r.rating.value)) && Number(r.rating.value) >= 0 && Number(r.rating.value) <= 10);
              const duelsBad = !r.duelsWon.locked && r.duelsWon.value.trim() !== '' && !isNonNegativeInt(r.duelsWon.value);
              const savesBad = !r.saves.locked && r.saves.value.trim() !== '' && !isPositiveInt(r.saves.value);
              return (
                <tr key={r.playerId} className={ro ? 'row-suspended' : undefined} title={r.suspended ? suspendedText(r.suspended) : undefined}>
                  <td>
                    {r.name}
                    {noXp && <span className="badge gray entry-src">不计 XP</span>}
                    {r.sources.length > 0 && <div className="muted entry-src">已录 · {r.sources.join('、')}</div>}
                    {r.trainee && <div className="muted entry-src">训练营</div>}
                    {r.suspended && <div className="bad-text entry-src">{suspendedText(r.suspended)}</div>}
                  </td>
                  <td className="muted">{r.position ?? '—'}</td>
                  <td className={cellCls('', r.base.appearance, r.appearance.locked) || undefined}>
                    {r.appearance.locked ? (
                      r.base.appearance || mode === 'edit' ? (
                        <input type="checkbox" checked={r.appearance.checked} disabled />
                      ) : (
                        <span className="muted">—</span>
                      )
                    ) : (
                      <input
                        type="checkbox"
                        checked={r.appearance.checked}
                        disabled={ro}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({
                            ...row,
                            appearance: { ...row.appearance, checked: e.target.checked },
                            result: null,
                          }))
                        }
                      />
                    )}
                  </td>
                  <td className={cellCls('', r.base.rating !== '', r.rating.locked) || undefined}>
                    {r.rating.locked ? (
                      r.base.rating === '' && mode === 'view' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="entry-num mono" value={r.rating.value} readOnly tabIndex={-1} />
                      )
                    ) : (
                      <input
                        className={`entry-num mono${ratingBad ? ' invalid' : ''}`}
                        value={r.rating.value}
                        disabled={ro}
                        inputMode="decimal"
                        placeholder="0.0–10.0"
                        onChange={(e) => updateRow(r.playerId, (row) => ({ ...row, rating: { ...row.rating, value: e.target.value }, result: null }))}
                      />
                    )}
                  </td>
                  <td className={cellCls('', r.base.cleanSheet, r.cleanSheet.locked) || undefined}>
                    {r.cleanSheet.locked ? (
                      r.base.cleanSheet || mode === 'edit' ? (
                        <input type="checkbox" checked={r.cleanSheet.checked} disabled />
                      ) : (
                        <span className="muted">—</span>
                      )
                    ) : (
                      <input
                        type="checkbox"
                        checked={r.cleanSheet.checked}
                        disabled={ro || noXp}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({
                            ...row,
                            cleanSheet: { ...row.cleanSheet, checked: e.target.checked },
                            result: null,
                          }))
                        }
                      />
                    )}
                  </td>
                  <td className={cellCls('num', r.base.duelsWon !== '', r.duelsWon.locked)}>
                    {r.duelsWon.locked ? (
                      r.base.duelsWon === '' && mode === 'view' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="entry-num mono" value={r.duelsWon.value} readOnly tabIndex={-1} />
                      )
                    ) : (
                      <input
                        className={`entry-num mono${duelsBad ? ' invalid' : ''}`}
                        value={r.duelsWon.value}
                        disabled={ro || noXp}
                        inputMode="numeric"
                        placeholder="次数"
                        title={`历史累计 ${r.duelsBase} 次 · 每 12 次 1 XP`}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => {
                            // 零封联动（用户裁决）：本侧失球 0 时，手填夺回球权（含 0）= 确认防守球员 → 自动勾零封；
                            // 清空或改错不联动取消，人工反勾不被覆盖
                            const autoClean =
                              sideConcededOf(match, side) === 0 && !row.cleanSheet.locked && !row.cleanSheet.checked && isNonNegativeInt(e.target.value);
                            return {
                              ...row,
                              duelsWon: { ...row.duelsWon, value: e.target.value },
                              cleanSheet: autoClean ? { ...row.cleanSheet, checked: true } : row.cleanSheet,
                              result: null,
                            };
                          })
                        }
                      />
                    )}
                  </td>
                  <td className={cellCls('num', r.base.saves !== '', r.saves.locked)}>
                    {r.saves.locked ? (
                      r.base.saves === '' && mode === 'view' ? (
                        <span className="muted">—</span>
                      ) : (
                        <input className="entry-num mono" value={r.saves.value} readOnly tabIndex={-1} />
                      )
                    ) : (
                      <input
                        className={`entry-num mono${savesBad ? ' invalid' : ''}`}
                        value={r.saves.value}
                        disabled={ro || noXp}
                        inputMode="numeric"
                        placeholder="次数"
                        title={`历史累计 ${r.savesBase} 次 · 每 8 次 1 XP`}
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({ ...row, saves: { ...row.saves, value: e.target.value }, result: null }))
                        }
                      />
                    )}
                  </td>
                  <td className="num mono">{r.goals > 0 ? r.goals : '—'}</td>
                  <td className="num mono">{r.assists > 0 ? r.assists : '—'}</td>
                  <td className="num mono">{noXp ? '0' : fmtXp(rowXp(r))}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={ro || saving !== null || !dirtyRow || issues.length > 0}
                      title={r.suspended ? suspendedText(r.suspended) : issues.length > 0 ? issues[0] : dirtyRow ? '提交这一行' : '没有改动'}
                      onClick={() => void saveRows([r], r.playerId)}
                    >
                      {saving === r.playerId ? '保存中…' : '保存'}
                    </button>
                    {issues.length > 0 && <div className="bad-text entry-result">{issues[0]}</div>}
                    {r.result && (
                      <div className="entry-result">
                        <span className={`badge ${r.result.kind === 'ok' ? 'green' : r.result.kind === 'dup' ? 'gray' : 'red'}`}>
                          {r.result.text}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {activeRows.length === 0 && <EmptyState>该队侧没有已建档球员，不能录入。</EmptyState>}
      {narrow && (
        /* v6.21.0 汇总条（≤760 才渲染）：fixed 常驻视口底，落在拇指区（面板在 .table-wrap 滚动容器内，
           sticky 贴不到视口——e2e ⑭ 实测裁决，见 spec §0-2）。
           portal 到 body：≤760 时 .table-wrap 升格 container-type:inline-size（评审 P1-1 面板出宽度
           约束的前提），其布局包容含块会让面板内的 fixed 后代改贴容器盒而非视口——portal 逃出包容子树。
           沿用 saveAll（只提交脏行，不合法行会提示跳过），与表头「全部保存」同一动作。 */
        createPortal(
          <div className="entry-sumbar">
            {noXp ? (
              <span className="badge gray">本场不计成长 XP</span>
            ) : (
              <span className="badge gold">本场合计 +{fmtXp(totalXp)} XP</span>
            )}
            <span className="muted">脏行 {dirtyCount}</span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving !== null || !hasDirty}
              title={hasDirty ? '只提交有改动的行' : '当前没有改动'}
              onClick={saveAll}
            >
              {saving === 'all' ? '保存中…' : '全部保存'}
            </button>
          </div>,
          document.body,
        )
      )}
    </div>
  );
}
