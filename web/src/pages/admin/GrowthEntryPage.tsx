// 管理端 · 成长录入（v6.16.0）：按场给球员补录成长数据（出场 / 评分 / 零封 / 夺回球权 / 扑救）。
// 交互对照参考插件 fixtures 编辑器：行内编辑 + 基线脏检测 + 只提交有改动的行 + 未保存切换要确认；
// 页面结构 = 比赛列表卡（近 50 场）+ 行内按钮在该行下方展开的内嵌面板（不弹窗、不跳页）。
import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type MatchEntryInput,
  type MatchEntryListItem,
  type MatchEntryPanel,
  type MatchEntryPerPlayerResult,
} from '../../lib/api.ts';
import {
  MATCH_ENTRY_LIST_KEY,
  fetchMatchEntryList,
  fetchMatchEntryPanel,
  matchEntryPanelKey,
  submitMatchEntry,
} from '../../lib/adminQueries.ts';
import { entryXp, type GrowthEntryDraft } from '../../lib/growth-xp.ts';
import { useToast } from '../../lib/toast.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';
import EmptyState from '../../components/EmptyState.tsx';

type Side = 'home' | 'away';
type Mode = 'edit' | 'view';

/** v6.21.0 窄屏卡片流断点：与 styles.css 管理端 ≤760 媒体块同档，也与 AdminLayout 抽屉断点一致 */
const ENTRY_CARDS_QUERY = '(max-width: 760px)';

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
  /** players.status === 'trainee'：训练营不按场次计 */
  trainee: boolean;
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
  /** 已录来源（中文标签，去重） */
  sources: string[];
  base: RowBase;
  result: { kind: 'ok' | 'dup' | 'bad'; text: string } | null;
}

const fmtXp = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const fmtTime = (s: string | null): string => (s ? s.slice(0, 16).replace('T', ' ') : '—');

/** recorded.source 的展示标注：manual = 管理组补录，其余一律按赛果同步理解 */
const sourceLabel = (source: string): string => (source === 'manual' ? '管理组补录' : '赛果同步');

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

/** 行输入问题（空格子不报错；非空但不合法给中文原因） */
function rowIssues(r: RowDraft): string[] {
  const out: string[] = [];
  if (!r.rating.locked && r.rating.value.trim() !== '') {
    const v = Number(r.rating.value);
    if (!Number.isFinite(v) || v < 7 || v > 10) out.push('评分需在 7.0–10.0');
  }
  if (!r.duelsWon.locked && r.duelsWon.value.trim() !== '' && !isPositiveInt(r.duelsWon.value)) out.push('夺回球权需为正整数');
  if (!r.saves.locked && r.saves.value.trim() !== '' && !isPositiveInt(r.saves.value)) out.push('扑救需为正整数');
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

const rowXp = (r: RowDraft): number => entryXp(draftOf(r)) + r.extraXp;

/** 保存结果回填：提交过的格子转锁定态，并按 perPlayer 给结果徽标 */
function applyResult(r: RowDraft, e: MatchEntryInput, p: MatchEntryPerPlayerResult | undefined): RowDraft {
  const locked: RowDraft = {
    ...r,
    appearance: e.appearance !== undefined ? { ...r.appearance, locked: true } : r.appearance,
    rating: e.rating !== undefined ? { ...r.rating, locked: true } : r.rating,
    cleanSheet: e.cleanSheet !== undefined ? { ...r.cleanSheet, locked: true } : r.cleanSheet,
    duelsWon: e.duelsWon !== undefined ? { ...r.duelsWon, locked: true } : r.duelsWon,
    saves: e.saves !== undefined ? { ...r.saves, locked: true } : r.saves,
    base: {
      appearance: e.appearance !== undefined ? r.appearance.checked : r.base.appearance,
      rating: e.rating !== undefined ? r.rating.value : r.base.rating,
      cleanSheet: e.cleanSheet !== undefined ? r.cleanSheet.checked : r.base.cleanSheet,
      duelsWon: e.duelsWon !== undefined ? r.duelsWon.value : r.base.duelsWon,
      saves: e.saves !== undefined ? r.saves.value : r.base.saves,
    },
  };
  if (!p) return { ...locked, result: { kind: 'bad', text: '失败：后端未返回该球员结果' } };
  if (p.written > 0) {
    return {
      ...locked,
      result: { kind: 'ok', text: `+${fmtXp(p.xp)} XP 新录${p.duplicates > 0 ? `（${p.duplicates} 项重复跳过）` : ''}` },
    };
  }
  if (p.duplicates > 0) return { ...locked, result: { kind: 'dup', text: '已录重复跳过' } };
  return { ...locked, result: { kind: 'bad', text: '失败：没有写入任何数据' } };
}

/** 用面板数据构建某一队侧的行草稿：已录项预填并锁定；view 模式全锁 */
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
    const sources: string[] = [];
    for (const rec of recs) {
      switch (rec.eventType) {
        case 'appearance':
          seen.appearance = true;
          appearance = true;
          break;
        case 'rating':
          seen.rating = true;
          rating = String(rec.value);
          break;
        case 'clean_sheet':
          seen.clean_sheet = true;
          cleanSheet = true;
          break;
        case 'duels_won':
          seen.duels_won = true;
          duelsWon = String(rec.value);
          break;
        case 'saves':
          seen.saves = true;
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
    const lock = (recorded: boolean): boolean => mode === 'view' || recorded;
    return {
      playerId: p.id,
      name: p.displayName !== '' ? p.displayName : p.name,
      position: p.position,
      trainee: p.status === 'trainee',
      appearance: { checked: appearance, locked: lock(seen.appearance) },
      rating: { value: rating, locked: lock(seen.rating) },
      cleanSheet: { checked: cleanSheet, locked: lock(seen.clean_sheet) },
      duelsWon: { value: duelsWon, locked: lock(seen.duels_won) },
      saves: { value: saves, locked: lock(seen.saves) },
      goals,
      assists,
      extraXp,
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

function MatchEntrySection() {
  const { show, toastNode } = useToast();
  const { data, error } = useQuery({ queryKey: MATCH_ENTRY_LIST_KEY, queryFn: fetchMatchEntryList });
  const [open, setOpen] = useState<{ matchId: number; mode: Mode } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

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

  return (
    <>
      {toastNode}
      <p className="hint">
        仅联赛与冠军杯小组赛可录；训练营球员不按场次计。列表为近 50 场已确认、按确认时间倒序的比赛。
        已录值不可改（平台暂无成长事件删除通道），重复提交会被自动跳过。
      </p>
      <h3>近期可补录比赛</h3>
      {!data ? (
        <p className="muted">{error ? '加载失败，请稍后重试。' : '加载中…'}</p>
      ) : data.matches.length === 0 ? (
        <EmptyState>近期没有可补录的比赛。只有联赛与冠军杯小组赛、已确认且可计 XP 的场次会出现在这里。</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>轮次 / 阶段</th>
                <th>对阵</th>
                <th className="num">比分</th>
                <th>确认时间</th>
                <th>已录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.matches.map((m) => {
                const opened = open !== null && open.matchId === m.matchId ? open : null;
                return (
                  <Fragment key={m.matchId}>
                    <tr>
                      <td>
                        第 {m.round} 轮 · {m.stageName}
                        <div className="muted">
                          S{m.season} · {m.competitionType} · 窗口 {m.windowSeq}
                        </div>
                      </td>
                      <td>
                        {m.homeTeam} <span className="muted">vs</span> {m.awayTeam}
                      </td>
                      <td className="num mono">
                        {m.scoreHome} : {m.scoreAway}
                      </td>
                      <td className="muted">{fmtTime(m.confirmedAt)}</td>
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
                              <span>录入面板有未保存的改动：收起面板或切换比赛会丢弃；换队侧则草稿保留（不提交）。</span>
                              <button type="button" className="btn btn-sm" onClick={() => setPending(null)}>
                                继续编辑
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => {
                                  const act = pending;
                                  setPending(null);
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
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
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
}: {
  match: MatchEntryListItem;
  mode: Mode;
  guard: (action: () => void) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: matchEntryPanelKey(match.matchId),
    queryFn: () => fetchMatchEntryPanel(match.matchId),
  });
  const [rows, setRows] = useState<Record<Side, RowDraft[]> | null>(null);
  const [side, setSide] = useState<Side>('home');
  const [saving, setSaving] = useState<number | 'all' | null>(null);
  const [lastSummary, setLastSummary] = useState<{ written: number; duplicates: number; totalXp: number } | null>(null);
  const builtRef = useRef<string | null>(null);
  /** 窄屏（≤760）改渲染卡片流；桌面仍渲染原表格（两端 DOM 互斥，桌面零变化） */
  const narrow = useMediaQuery(ENTRY_CARDS_QUERY);

  // 只在 (比赛, 模式) 首次拿到数据时建行：保存后的 invalidate 重拉不会覆盖本地脏状态与结果徽标
  useEffect(() => {
    if (!data) return;
    const built = `${data.match.matchId}:${mode}`;
    if (builtRef.current === built) return;
    builtRef.current = built;
    setRows({ home: buildSideRows(data, 'home', mode), away: buildSideRows(data, 'away', mode) });
    setSide(data.sides.home.isCpu || data.sides.home.players.length === 0 ? 'away' : 'home');
    setLastSummary(null);
  }, [data, mode]);

  // 把整面板（两侧一起）的脏状态报给父级：切换比赛 / 收起 / 换队侧前要确认
  useEffect(() => {
    if (rows === null) return;
    onDirtyChange((['home', 'away'] as Side[]).some((s) => rows[s].some(rowDirty)));
  }, [rows, onDirtyChange]);

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
  const hasDirty = (['home', 'away'] as Side[]).some((s) => rows[s].some(rowDirty));
  /** 当前队侧脏行数（窄屏汇总条展示用；saveAll 也只提交当前队侧的脏行） */
  const dirtyCount = activeRows.filter(rowDirty).length;

  function updateRow(playerId: number, fn: (r: RowDraft) => RowDraft) {
    setRows((prev) => (prev ? { ...prev, [side]: prev[side].map((r) => (r.playerId === playerId ? fn(r) : r)) } : prev));
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

  async function saveRows(targets: RowDraft[], tag: number | 'all') {
    if (saving !== null) return;
    const entries: MatchEntryInput[] = [];
    for (const r of targets) {
      const e = toEntry(r);
      if (e !== null) entries.push(e);
    }
    if (entries.length === 0) {
      show('这些行没有可保存的改动。', true);
      return;
    }
    setSaving(tag);
    try {
      const res = await submitMatchEntry(match.matchId, entries);
      const byId = new Map(res.perPlayer.map((p) => [p.playerId, p]));
      setRows((prev) => {
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
      setLastSummary({ written: res.written, duplicates: res.duplicates, totalXp: res.totalXp });
      void queryClient.invalidateQueries({ queryKey: MATCH_ENTRY_LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: matchEntryPanelKey(match.matchId) });
      show(`已保存：新录 ${res.written} 项${res.duplicates > 0 ? `、重复跳过 ${res.duplicates} 项` : ''}，合计 +${fmtXp(res.totalXp)} XP。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setRows((prev) => {
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
    } finally {
      setSaving(null);
    }
  }

  function saveAll() {
    if (saving !== null || rows === null) return;
    const valid: RowDraft[] = [];
    let skipped = 0;
    for (const r of rows[side]) {
      if (r.trainee || !rowDirty(r)) continue;
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
        <span className="badge gold">本场合计 +{fmtXp(totalXp)} XP</span>
        {lastSummary && (
          <span className="badge gray">
            新录 {lastSummary.written} · 重复 {lastSummary.duplicates} · 合计 +{fmtXp(lastSummary.totalXp)} XP
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

      {mode === 'view' && <p className="hint">只读查看：所有格子已锁定，已录值不可修改。</p>}

      {narrow ? (
        /* v6.21.0 窄屏卡片流（≤760）：与桌面表格 DOM 互斥；状态判据、格子锁定规则、
           保存按钮禁用条件与下方表格逐条一致，state 复用同一套 updateRow/rowIssues/rowDirty。 */
        <div className="entry-cards">
          {activeRows.map((r) => {
            const issues = rowIssues(r);
            const dirtyRow = rowDirty(r);
            const ro = r.trainee;
            const ratingBad =
              !r.rating.locked &&
              r.rating.value.trim() !== '' &&
              !(Number.isFinite(Number(r.rating.value)) && Number(r.rating.value) >= 7 && Number(r.rating.value) <= 10);
            const duelsBad = !r.duelsWon.locked && r.duelsWon.value.trim() !== '' && !isPositiveInt(r.duelsWon.value);
            const savesBad = !r.saves.locked && r.saves.value.trim() !== '' && !isPositiveInt(r.saves.value);
            return (
              <div
                key={r.playerId}
                className={`entry-card${ro ? ' row-trainee' : ''}${dirtyRow ? ' dirty' : ''}`}
                title={ro ? '训练营不按场次计' : undefined}
              >
                <div className="entry-card-head">
                  <span className="entry-card-name">{r.name}</span>
                  <span className="entry-card-pos">{r.position ?? '—'}</span>
                  {r.sources.length > 0 && <span className="badge gray">已录 · {r.sources.join('、')}</span>}
                  {ro && <span className="badge gray">训练营不按场次计</span>}
                  {issues.length > 0 && (
                    <span className="badge red" title={issues.join('；')}>
                      校验问题
                    </span>
                  )}
                </div>
                <div className="entry-card-grid">
                  <label className={`entry-card-field${r.appearance.locked ? ' recorded' : ''}`}>
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
                  <label className={`entry-card-field${r.rating.locked ? ' recorded' : ''}`}>
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
                        placeholder="7.0–10.0"
                        onChange={(e) => updateRow(r.playerId, (row) => ({ ...row, rating: { ...row.rating, value: e.target.value }, result: null }))}
                      />
                    )}
                  </label>
                  <label className={`entry-card-field${r.cleanSheet.locked ? ' recorded' : ''}`}>
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
                        disabled={ro}
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
                  <label className={`entry-card-field${r.duelsWon.locked ? ' recorded' : ''}`}>
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
                        disabled={ro}
                        inputMode="numeric"
                        placeholder="次数"
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({ ...row, duelsWon: { ...row.duelsWon, value: e.target.value }, result: null }))
                        }
                      />
                    )}
                  </label>
                  <label className={`entry-card-field${r.saves.locked ? ' recorded' : ''}`}>
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
                        disabled={ro}
                        inputMode="numeric"
                        placeholder="次数"
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
                  <span className="badge gold">本场 +{fmtXp(rowXp(r))} XP</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={ro || saving !== null || !dirtyRow || issues.length > 0}
                    title={ro ? '训练营不按场次计' : issues.length > 0 ? issues[0] : dirtyRow ? '提交这一行' : '没有改动'}
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
              const ro = r.trainee;
              const ratingBad =
                !r.rating.locked &&
                r.rating.value.trim() !== '' &&
                !(Number.isFinite(Number(r.rating.value)) && Number(r.rating.value) >= 7 && Number(r.rating.value) <= 10);
              const duelsBad = !r.duelsWon.locked && r.duelsWon.value.trim() !== '' && !isPositiveInt(r.duelsWon.value);
              const savesBad = !r.saves.locked && r.saves.value.trim() !== '' && !isPositiveInt(r.saves.value);
              return (
                <tr key={r.playerId} className={ro ? 'row-trainee' : undefined} title={ro ? '训练营不按场次计' : undefined}>
                  <td>
                    {r.name}
                    {r.sources.length > 0 && <div className="muted entry-src">已录 · {r.sources.join('、')}</div>}
                    {ro && <div className="muted entry-src">训练营不按场次计</div>}
                  </td>
                  <td className="muted">{r.position ?? '—'}</td>
                  <td className={r.appearance.locked ? 'recorded' : undefined}>
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
                  <td className={r.rating.locked ? 'recorded' : undefined}>
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
                        placeholder="7.0–10.0"
                        onChange={(e) => updateRow(r.playerId, (row) => ({ ...row, rating: { ...row.rating, value: e.target.value }, result: null }))}
                      />
                    )}
                  </td>
                  <td className={r.cleanSheet.locked ? 'recorded' : undefined}>
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
                        disabled={ro}
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
                  <td className={`num${r.duelsWon.locked ? ' recorded' : ''}`}>
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
                        disabled={ro}
                        inputMode="numeric"
                        placeholder="次数"
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({ ...row, duelsWon: { ...row.duelsWon, value: e.target.value }, result: null }))
                        }
                      />
                    )}
                  </td>
                  <td className={`num${r.saves.locked ? ' recorded' : ''}`}>
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
                        disabled={ro}
                        inputMode="numeric"
                        placeholder="次数"
                        onChange={(e) =>
                          updateRow(r.playerId, (row) => ({ ...row, saves: { ...row.saves, value: e.target.value }, result: null }))
                        }
                      />
                    )}
                  </td>
                  <td className="num mono">{r.goals > 0 ? r.goals : '—'}</td>
                  <td className="num mono">{r.assists > 0 ? r.assists : '—'}</td>
                  <td className="num mono">{fmtXp(rowXp(r))}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={ro || saving !== null || !dirtyRow || issues.length > 0}
                      title={ro ? '训练营不按场次计' : issues.length > 0 ? issues[0] : dirtyRow ? '提交这一行' : '没有改动'}
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
           sticky 贴不到视口——e2e ⑭ 实测裁决，见 spec §0-2）；
           沿用 saveAll（只提交脏行，不合法行会提示跳过），与表头「全部保存」同一动作。 */
        <div className="entry-sumbar">
          <span className="badge gold">本场合计 +{fmtXp(totalXp)} XP</span>
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
        </div>
      )}
    </div>
  );
}
