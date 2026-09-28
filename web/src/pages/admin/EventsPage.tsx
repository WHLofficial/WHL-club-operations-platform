// 管理端 · 事件页（v6.10.0，D 块）：触发 + 池只读启停 + 流水。
// 计划裁决：不做自定义事件编辑（池内容随版本走，管理端只启停），触发由管理端驱动；
// 选择型事件自 v6.11.0 起可触发（只挂待选，等玩家选或到期自动兜底）。
// v6.12.0（D3）：LLM 草稿工坊——生成文案/结构草稿 → 审校修订 → 采纳进池 / 废弃；
// LLM 未配置（LLM_API_BASE/LLM_API_KEY/LLM_MODEL）时生成按钮置灰，草稿其余操作不受影响。
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  apiSend,
  type AdminEventDraft,
  type AdminEventOccurrence,
  type AdminEventPoolRow,
  type AdminEventTriggerResult,
  type EventDraftAdoptResult,
  type EventDraftStruct,
  type LlmDraftResult,
  type LlmStatus,
} from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';

const POOL_KEY = ['admin', 'events', 'pool'] as const;
const OCC_KEY = ['admin', 'events', 'occurrences'] as const;
const LLM_KEY = ['admin', 'events', 'llm-status'] as const;
const DRAFT_KEY = ['admin', 'events', 'drafts'] as const;

function parseNotes(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** 结算人展示：库里存的是 actor id 文本 / 'system'（v6.11.0 还会写 'auto' 超时兜底） */
function resolvedByText(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (raw === 'system') return '系统';
  if (raw === 'auto') return '超时兜底';
  const n = Number(raw);
  return Number.isInteger(n) ? `管理员 #${n}` : raw;
}

/** 逗号/空格分隔的俱乐部 id → 正整数数组；非法返回 null（调用方报错） */
function parseClubIds(raw: string): number[] | null {
  const ids: number[] = [];
  for (const part of raw.split(/[,\s，]+/)) {
    const p = part.trim();
    if (p === '') continue;
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) return null;
    ids.push(n);
  }
  return ids;
}

export default function EventsPage() {
  return (
    <div className="admin-page">
      <TriggerSection />
      <DraftSection />
      <PoolSection />
      <OccurrenceSection />
    </div>
  );
}

function TriggerSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [clubIdsRaw, setClubIdsRaw] = useState('');
  const [eventId, setEventId] = useState('');
  const [result, setResult] = useState<AdminEventTriggerResult | null>(null);

  const { data } = useQuery({
    queryKey: POOL_KEY,
    queryFn: () => api<{ events: AdminEventPoolRow[] }>('/api/admin/events/pool'),
  });
  // 启用的都能点名（v6.11.0 起选择型也可点名：只挂待选，不落效果）
  const namedOptions = (data?.events ?? []).filter((e) => e.status === 'adopted');

  async function run(named: boolean) {
    if (busy) return;
    const ids = parseClubIds(clubIdsRaw);
    if (ids === null) {
      show('俱乐部 id 要写正整数，逗号分隔', true);
      return;
    }
    if (named && eventId === '') {
      show('先选一个要点名触发的事件', true);
      return;
    }
    const payload: Record<string, unknown> = {};
    if (ids.length > 0) payload.clubIds = ids;
    if (named) payload.eventId = eventId;

    setBusy(true);
    try {
      const res = await apiPost<AdminEventTriggerResult>('/api/admin/events/trigger', payload);
      setResult(res);
      const tail = res.capped > 0 ? `，另有 ${res.capped} 队掷中但未触发（条件不符、事件上限或待选已满）` : '';
      show(named ? `点名触发完成：${res.triggered} 条` : `掷点完成：${res.clubs} 队参与，触发 ${res.triggered} 条${tail}`);
      queryClient.invalidateQueries({ queryKey: OCC_KEY });
    } catch (e) {
      show(e instanceof Error ? e.message : '触发失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>触发事件</h2>
      {toastNode}
      <p className="hint">
        按概率触发：每队独立掷一次命中概率（config <code>event_rules.hitProbability</code>，默认 0.4），命中后按权重抽一条事件；即发型当刻结算，选择型只挂出待选（等玩家选或到期自动兜底）。
        点名触发：绕过概率与条件，直接给指定队伍上演指定事件。事件不绑窗口，流水按触发时所在的赛季/窗口归档。
      </p>
      <div className="inline-form">
        <label className="field">
          俱乐部 id
          <input value={clubIdsRaw} onChange={(e) => setClubIdsRaw(e.target.value)} placeholder="留空 = 全部俱乐部，可写 1,2,5" />
        </label>
        <label className="field">
          点名事件
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">（不点名 · 按概率抽）</option>
            {namedOptions.map((e) => (
              <option key={e.id} value={e.event_id}>
                {e.name}（{e.event_type === 'instant' ? '即发' : '选择'} · 权重 {e.weight}）
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="button" disabled={busy} onClick={() => run(false)}>
          {busy ? '触发中…' : '按概率触发一轮'}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy || eventId === ''} onClick={() => run(true)}>
          点名触发
        </button>
      </div>

      {result && (
        <div className="banner info">
          <b>
            S{result.season} 第 {result.windowSeq} 窗 · {result.clubs} 队参与 · 触发 {result.triggered} 条
            {result.capped > 0 ? ` · ${result.capped} 队掷中未触发` : ''}
          </b>
          {result.events.length === 0 ? (
            <p className="muted">这一轮没有事件触发。</p>
          ) : (
            <ul>
              {result.events.map((e) => (
                <li key={e.occurrenceId}>
                  <b>{e.clubName}</b> · {e.eventName}
                  {e.eventType === 'choice' && <span className="badge sky">待选</span>}
                  {e.notes.length > 0 && <span className="muted">（{e.notes.join('；')}）</span>}
                  <div className="muted">{e.text}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** 草稿状态徽标 */
function draftBadge(status: string) {
  if (status === 'draft') return <span className="badge sky">草稿</span>;
  if (status === 'adopted') return <span className="badge green">已采纳</span>;
  return <span className="badge gray">已废弃</span>;
}

/** 结构草稿的一行摘要（采纳前人工核对用） */
function structSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '（结构不完整）';
  const p = payload as Partial<EventDraftStruct>;
  const parts = [
    p.name ?? '?',
    p.event_id ? `(${p.event_id})` : '',
    p.event_type === 'choice' ? '选择' : p.event_type === 'instant' ? '即发' : '',
    `权重 ${p.weight ?? '?'}`,
    Array.isArray(p.options) && p.options.length > 0 ? `${p.options.length} 个选项` : '',
  ].filter((s) => s !== '');
  return parts.join(' · ');
}

function DraftSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const llmQuery = useQuery({
    queryKey: LLM_KEY,
    queryFn: () => api<LlmStatus>('/api/admin/events/llm-status'),
    staleTime: 60_000,
  });
  const { data: poolData } = useQuery({
    queryKey: POOL_KEY,
    queryFn: () => api<{ events: AdminEventPoolRow[] }>('/api/admin/events/pool'),
  });
  const draftsQuery = useQuery({
    queryKey: DRAFT_KEY,
    queryFn: () => api<{ drafts: AdminEventDraft[] }>('/api/admin/events/drafts'),
  });

  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'text' | 'struct'>('text');
  const [eventId, setEventId] = useState('');
  const [hint, setHint] = useState('');
  const [lastResult, setLastResult] = useState<LlmDraftResult | null>(null);
  /** 展开修订的草稿 id（一次一个） */
  const [openId, setOpenId] = useState<number | null>(null);
  /** 各草稿的编辑区文本：text 存 template、struct 存 JSON 串 */
  const [editText, setEditText] = useState<Record<number, string>>({});

  const configured = llmQuery.data?.configured === true;
  const drafts = draftsQuery.data?.drafts ?? [];
  const adopted = (poolData?.events ?? []).filter((e) => e.status === 'adopted');

  function openDraft(d: AdminEventDraft) {
    if (openId === d.id) {
      setOpenId(null);
      return;
    }
    const p = d.payload as { template?: unknown } | null;
    const initial =
      d.kind === 'text'
        ? typeof p?.template === 'string'
          ? p.template
          : ''
        : JSON.stringify(d.payload, null, 2);
    setEditText((prev) => ({ ...prev, [d.id]: initial }));
    setOpenId(d.id);
  }

  async function generate() {
    if (busy) return;
    if (kind === 'text' && eventId === '') {
      show('文案草稿要先选一个要改写的池内事件', true);
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { kind, hint: hint.trim() };
      if (kind === 'text') payload.eventId = eventId;
      const out = await apiPost<LlmDraftResult>('/api/admin/events/llm-draft', payload);
      setLastResult(out);
      setHint('');
      queryClient.invalidateQueries({ queryKey: DRAFT_KEY });
      show(out.adjustments.length > 0 ? `草稿已生成（钳制调整：${out.adjustments.join('；')}）` : '草稿已生成');
    } catch (e) {
      show(e instanceof Error ? e.message : '生成失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(d: AdminEventDraft) {
    if (busy) return;
    let payload: unknown;
    if (d.kind === 'text') {
      payload = { template: editText[d.id] ?? '' };
    } else {
      try {
        payload = JSON.parse(editText[d.id] ?? '');
      } catch {
        show('结构草稿要合法 JSON', true);
        return;
      }
    }
    setBusy(true);
    try {
      await apiSend('PATCH', `/api/admin/events/drafts/${d.id}`, { payload });
      queryClient.invalidateQueries({ queryKey: DRAFT_KEY });
      show('修订已保存');
    } catch (e) {
      show(e instanceof Error ? e.message : '保存失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function adopt(d: AdminEventDraft) {
    if (busy) return;
    setBusy(true);
    try {
      const out = await apiPost<EventDraftAdoptResult>(`/api/admin/events/drafts/${d.id}/adopt`, {});
      show(d.kind === 'text' ? `已把文案写进事件「${out.target}」` : `新事件「${out.target}」已入池并启用`);
      queryClient.invalidateQueries({ queryKey: DRAFT_KEY });
      queryClient.invalidateQueries({ queryKey: POOL_KEY });
    } catch (e) {
      show(e instanceof Error ? e.message : '采纳失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function discard(d: AdminEventDraft) {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost<{ id: number; status: string }>(`/api/admin/events/drafts/${d.id}/discard`, {});
      show(`草稿 #${d.id} 已废弃`);
      queryClient.invalidateQueries({ queryKey: DRAFT_KEY });
    } catch (e) {
      show(e instanceof Error ? e.message : '废弃失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>草稿工坊</h2>
      {toastNode}
      <p className="hint">
        用 LLM 生成事件草稿：「文案」改写池内事件的播报文案，「结构」产出一整条新事件草稿（数值效果会被系统钳制，钳制调整列是被改掉的部分）。草稿先落在这里审校，修订后采纳才进事件池；废弃即作罢。LLM 不进玩家请求路径，生成失败不影响任何现有功能。
      </p>
      {!configured && (
        <p className="banner info">
          LLM 未配置（需要 <code>LLM_API_BASE</code> / <code>LLM_API_KEY</code>（secret）/ <code>LLM_MODEL</code>
          三个变量齐备），生成按钮暂不可用；已有草稿的修订、采纳、废弃不受影响。
        </p>
      )}
      <div className="inline-form">
        <label className="field">
          草稿类型
          <select value={kind} onChange={(e) => setKind(e.target.value as 'text' | 'struct')}>
            <option value="text">文案（改写池内事件）</option>
            <option value="struct">结构（新事件草稿）</option>
          </select>
        </label>
        {kind === 'text' && (
          <label className="field">
            改写对象
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">（选一个启用中的事件）</option>
              {adopted.map((e) => (
                <option key={e.id} value={e.event_id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          生成要求（可空）
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="例：突出球迷的角度，别提钱"
            maxLength={200}
          />
        </label>
        <button className="btn" type="button" disabled={busy || !configured} onClick={() => void generate()}>
          {busy ? '生成中…' : '生成草稿'}
        </button>
      </div>

      {lastResult && (
        <div className="banner info">
          <b>
            草稿 #{lastResult.id}（{lastResult.kind === 'text' ? '文案' : '结构'}）
          </b>
          {lastResult.adjustments.length > 0 && <p className="muted">钳制调整：{lastResult.adjustments.join('；')}</p>}
        </div>
      )}

      {drafts.length === 0 ? (
        <p className="muted">还没有草稿。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>草稿</th>
                <th>类型</th>
                <th>内容</th>
                <th>备注</th>
                <th>状态</th>
                <th>更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => {
                const payload = d.payload as { template?: unknown } | null;
                return (
                  <tr key={d.id}>
                    <td className="mono">#{d.id}</td>
                    <td>{d.kind === 'text' ? '文案' : '结构'}</td>
                    <td>
                      {d.kind === 'text'
                        ? (typeof payload?.template === 'string' ? payload.template : '—')
                        : structSummary(d.payload)}
                    </td>
                    <td className="muted">{d.note || '—'}</td>
                    <td>{draftBadge(d.status)}</td>
                    <td className="mono muted">{d.updated_at.slice(5, 16).replace('T', ' ')}</td>
                    <td className="actions">
                      {d.status === 'draft' && (
                        <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => openDraft(d)}>
                          {openId === d.id ? '收起' : '查看 / 修订'}
                        </button>
                      )}
                      {d.status === 'draft' && (
                        <>
                          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void adopt(d)}>
                            采纳
                          </button>
                          <button
                            className="btn btn-sm btn-ghost"
                            type="button"
                            disabled={busy}
                            onClick={() => void discard(d)}
                          >
                            废弃
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {drafts
        .filter((d) => d.id === openId && d.status === 'draft')
        .map((d) => (
          <div key={d.id} className="banner info">
            <b>{d.kind === 'text' ? `文案修订 → ${d.source_event_id ?? '?'}` : `结构修订（JSON）`}</b>
            {d.kind === 'text' ? (
              <textarea
                rows={3}
                value={editText[d.id] ?? ''}
                onChange={(e) => setEditText((prev) => ({ ...prev, [d.id]: e.target.value }))}
                maxLength={120}
              />
            ) : (
              <textarea
                className="mono"
                rows={14}
                value={editText[d.id] ?? ''}
                onChange={(e) => setEditText((prev) => ({ ...prev, [d.id]: e.target.value }))}
              />
            )}
            <p className="hint">
              {d.kind === 'text'
                ? '文案不超过 120 字，禁止出现数字与金额（数值由系统另行结算公布）；可用 {team} 与 {stadium} 占位符。'
                : '保存时服务端会重新钳制数值（超出区间的被改掉、未登记键丢弃），不合最低要求会报 400。'}
            </p>
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void saveEdit(d)}>
              保存修订
            </button>
          </div>
        ))}
    </section>
  );
}

function PoolSection() {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data, error } = useQuery({
    queryKey: POOL_KEY,
    queryFn: () => api<{ events: AdminEventPoolRow[] }>('/api/admin/events/pool'),
  });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '事件池加载失败', true);
  }, [error, show]);

  async function toggle(row: AdminEventPoolRow) {
    if (busyId !== null) return;
    const next = row.status === 'adopted' ? 'discarded' : 'adopted';
    setBusyId(row.id);
    try {
      await apiSend('PATCH', `/api/admin/events/pool/${row.id}`, { status: next });
      show(next === 'adopted' ? `「${row.name}」已启用` : `「${row.name}」已停用`);
      queryClient.invalidateQueries({ queryKey: POOL_KEY });
    } catch (e) {
      show(e instanceof Error ? e.message : '改状态失败', true);
    } finally {
      setBusyId(null);
    }
  }

  const events = data?.events ?? [];

  return (
    <section className="card admin-section">
      <h2>事件池</h2>
      {toastNode}
      <p className="hint">
        池内容随版本走，这里只能启停：停用的事件不再被抽中，也不能点名触发。选择型事件（触发后给玩家选项、有选择时限）自 v6.11.0 起参与随机抽取，玩家在教练工作台「随机事件」卡里选。
      </p>
      {events.length === 0 ? (
        <p className="muted">事件池是空的。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>事件</th>
                <th>类别</th>
                <th className="num">权重</th>
                <th>类型</th>
                <th>来源</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.name}
                    <div className="muted mono">{e.event_id}</div>
                  </td>
                  <td>{e.category}</td>
                  <td className="num mono">{e.weight}</td>
                  <td>{e.event_type === 'instant' ? '即发' : '选择'}</td>
                  <td>{e.source === 'builtin' ? '种子' : '自定义'}</td>
                  <td>{e.status === 'adopted' ? <span className="badge green">启用</span> : <span className="badge">停用</span>}</td>
                  <td>
                    <button className="btn btn-sm" type="button" disabled={busyId !== null} onClick={() => toggle(e)}>
                      {busyId === e.id ? '提交中…' : e.status === 'adopted' ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OccurrenceSection() {
  const { show, toastNode } = useToast();
  const { data, error } = useQuery({
    queryKey: OCC_KEY,
    queryFn: () => api<{ season: number | null; occurrences: AdminEventOccurrence[] }>('/api/admin/events/occurrences'),
  });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '事件流水加载失败', true);
  }, [error, show]);

  const rows = data?.occurrences ?? [];

  return (
    <section className="card admin-section">
      <h2>事件流水</h2>
      {toastNode}
      <p className="hint">
        {data?.season === null || data?.season === undefined
          ? '当前没有可见赛季。'
          : `当前赛季 S${data.season}，最近 ${rows.length} 条（倒序）。`}
        备注列是本次结算实际落下的效果；即时型触发即结算，选择型等玩家在时限内选。
      </p>
      {rows.length === 0 ? (
        <p className="muted">这个赛季还没有事件记录。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>俱乐部</th>
                <th>事件</th>
                <th className="num">窗</th>
                <th>状态</th>
                <th>结算</th>
                <th>效果 / 文案</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.created_at.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {o.club_name ?? `#${o.club_id}`}
                    <div className="muted mono">#{o.club_id}</div>
                  </td>
                  <td>{o.event_name}</td>
                  <td className="num mono">{o.window_seq}</td>
                  <td>
                    {o.status === 'pending' ? (
                      <span className="badge sky">待选</span>
                    ) : o.status === 'expired' ? (
                      <span className="badge">超时结算</span>
                    ) : (
                      '已结算'
                    )}
                  </td>
                  <td className="muted">
                    {resolvedByText(o.resolved_by)}
                    {o.choice_no !== null && <div className="mono">选项 {o.choice_no}</div>}
                    {o.status === 'pending' && o.deadline_at !== null && (
                      <div className="mono">截止 {o.deadline_at.slice(5, 16).replace('T', ' ')}</div>
                    )}
                  </td>
                  <td>
                    {parseNotes(o.notes_json).join('；') || <span className="muted">（无落账效果）</span>}
                    {o.text && <div className="muted">{o.text}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
