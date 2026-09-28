// 管理端 · 事件页（v6.10.0，D 块）：触发 + 池只读启停 + 流水。
// 计划裁决：不做自定义事件编辑（池内容随版本走，管理端只启停），触发由管理端驱动；
// 选择型事件（event_type='choice'）要等 v6.11.0（D2）才可触发，这里只展示。
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  apiSend,
  type AdminEventOccurrence,
  type AdminEventPoolRow,
  type AdminEventTriggerResult,
} from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';

const POOL_KEY = ['admin', 'events', 'pool'] as const;
const OCC_KEY = ['admin', 'events', 'occurrences'] as const;

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
  // 只有启用的即发型能点名（选择型与已停用的点名会被后端 400 拦下）
  const namedOptions = (data?.events ?? []).filter((e) => e.event_type === 'instant' && e.status === 'adopted');

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
      const tail = res.capped > 0 ? `，另有 ${res.capped} 队掷中但无可用事件` : '';
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
        按概率触发：每队独立掷一次命中概率（config <code>event_rules.hitProbability</code>，默认 0.4），命中后按权重抽一条即发型事件并当刻结算。
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
                {e.name}（权重 {e.weight}）
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
            {result.capped > 0 ? ` · ${result.capped} 队无可用事件` : ''}
          </b>
          {result.events.length === 0 ? (
            <p className="muted">这一轮没有事件触发。</p>
          ) : (
            <ul>
              {result.events.map((e) => (
                <li key={e.occurrenceId}>
                  <b>{e.clubName}</b> · {e.eventName}
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
        池内容随版本走，这里只能启停：停用的事件不再被抽中，也不能点名触发。选择型事件（触发后给玩家选项、有选择时限）在 v6.11.0 开放。
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
                  <td>{o.status === 'pending' ? <span className="badge sky">待选</span> : '已结算'}</td>
                  <td className="muted">
                    {resolvedByText(o.resolved_by)}
                    {o.choice_no !== null && <div className="mono">选项 {o.choice_no}</div>}
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
