// 管理端 · 运营时刻表（v6.49.0）：逐项设「开始 / 结束」时段（双锚：随窗 or 具体时间）+ 只读甘特图。
// 锚解析的唯一真源是 src/core/ops-schedule.ts（前端不自己判状态）；这里只做「表单 ↔ ISO」换算、校验回显与保存。
// 具体时间一律按北京时间填（与 worker 侧 409 话术同口径）：表单里是墙钟串，提交前用 zhWallToUtcIso 换 UTC ISO。
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiPut, type OpsEndAnchor, type OpsSaveResult, type OpsScheduleView, type OpsStartAnchor, type OpsStatusRow } from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt, utcIsoToZhWall, zhWallToUtcIso } from '../../lib/datetime.ts';
import GanttChart from '../../components/GanttChart.tsx';
import { OPS_PRESETS, validateOpsInput } from '../../../../src/core/ops-schedule.ts';

interface Draft {
  startAnchor: OpsStartAnchor;
  startWall: string;
  endAnchor: OpsEndAnchor;
  endWall: string;
  requiresWindow: boolean;
  closeInflight: boolean;
  note: string;
}

function draftOf(row: OpsStatusRow): Draft {
  return {
    startAnchor: row.startAnchor,
    startWall: utcIsoToZhWall(row.startAt),
    endAnchor: row.endAnchor,
    endWall: utcIsoToZhWall(row.endAt),
    requiresWindow: row.requiresWindow,
    closeInflight: row.closeInflight,
    note: row.note,
  };
}

// 状态徽章沿用既有配色（sky=进行中 / gold=未开始 / gray=已结束·不限制）
const STATE_BADGE: Record<string, string> = { open: 'sky', not_started: 'gold', closed: 'gray', unrestricted: 'gray' };

const ANCHOR_START: { value: OpsStartAnchor; label: string }[] = [
  { value: 'none', label: '不限制' },
  { value: 'window_open', label: '随开窗' },
  { value: 'absolute', label: '具体时间' },
];

const ANCHOR_END: { value: OpsEndAnchor; label: string }[] = [
  { value: 'none', label: '不限制' },
  { value: 'window_close', label: '随关窗' },
  { value: 'absolute', label: '具体时间' },
];

export default function SchedulePage() {
  const { show, toastNode } = useToast();
  const { dateTime } = useTimeFmt();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const { data, error } = useQuery({
    queryKey: ['admin', 'ops-schedule'],
    queryFn: () => api<OpsScheduleView>('/api/admin/ops-schedule'),
    // 表单可能正在编辑：窗口重新聚焦不自动覆盖草稿（保存后我们自己 invalidate）
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (error) show(error instanceof Error ? error.message : '时刻表加载失败', true);
  }, [error, show]);

  useEffect(() => {
    if (!data) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of data.rows) if (!next[row.key]) next[row.key] = draftOf(row);
      return next;
    });
  }, [data]);

  function pick(key: string): void {
    setSelected(key);
    rowRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function patch(key: string, part: Partial<Draft>): void {
    setDrafts((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...part } } : prev));
  }

  function applyPreset(key: string, presetId: string): void {
    const preset = OPS_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    patch(key, { startAnchor: preset.startAnchor, endAnchor: preset.endAnchor, requiresWindow: preset.startAnchor === 'window_open' || preset.endAnchor === 'window_close' });
  }

  async function save(row: OpsStatusRow): Promise<void> {
    const draft = drafts[row.key];
    if (!draft) return;
    const startAt = draft.startAnchor === 'absolute' ? zhWallToUtcIso(draft.startWall) : null;
    const endAt = draft.endAnchor === 'absolute' ? zhWallToUtcIso(draft.endWall) : null;
    if (draft.startAnchor === 'absolute' && startAt === null) {
      show('起点要填具体时间（北京时间）', true);
      return;
    }
    if (draft.endAnchor === 'absolute' && endAt === null) {
      show('终点要填具体时间（北京时间）', true);
      return;
    }
    const bad = validateOpsInput({
      startAnchor: draft.startAnchor,
      startAt,
      endAnchor: draft.endAnchor,
      endAt,
      requiresWindow: draft.requiresWindow,
    });
    if (bad) {
      show(bad, true);
      return;
    }
    setBusyKey(row.key);
    try {
      const res = await apiPut<OpsSaveResult>('/api/admin/ops-schedule', {
        key: row.key,
        startAnchor: draft.startAnchor,
        startAt,
        endAnchor: draft.endAnchor,
        endAt,
        requiresWindow: draft.requiresWindow,
        closeInflight: draft.closeInflight,
        note: draft.note,
      });
      setDrafts((prev) => ({ ...prev, [row.key]: draftOf(res.row) }));
      show(`已保存：${res.row.label} · ${res.row.stateLabel}`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'ops-schedule'] });
    } catch (err) {
      show(err instanceof Error ? err.message : '保存失败', true);
    } finally {
      setBusyKey(null);
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="admin-page">
      {toastNode}
      <section className="card admin-section">
        <h2>运营时刻表</h2>
        <p className="hint">
          每一类转会操作与消费中心都能单独设开始 / 结束时段。锚只有两种：随窗（开窗即起 / 关窗即止）与具体时间（按北京时间填）。
          没设时段的行 = 不限制，行为与上线前逐条一致。到点后新操作会被挡下（未开始 / 已结束），在途单按各行自己的时限收口。
          勾了「到点收口在途单」的行，在操作结束时会把还没了结的报价 / 签约谈判一并收口（冻结退回、球员还原）。
        </p>
        {data ? (
          <GanttChart rows={rows} window={data.window} now={data.now} selectedKey={selected} onPick={pick} />
        ) : (
          <p className="hint">加载中…</p>
        )}
      </section>

      <section className="card admin-section">
        <h2>逐项时段</h2>
        {rows.map((row) => {
          const draft = drafts[row.key] ?? draftOf(row);
          return (
            <div
              key={row.key}
              ref={(el) => {
                if (el) rowRefs.current.set(row.key, el);
                else rowRefs.current.delete(row.key);
              }}
              className={`ops-row${selected === row.key ? ' ops-row-selected' : ''}`}
            >
              <div className="ops-row-head">
                <h3>
                  {row.label} <span className={`badge ${STATE_BADGE[row.state] ?? 'gray'}`}>{row.stateLabel}</span>
                </h3>
                <span className="hint">{row.desc}</span>
                <span className="hint">
                  当前：
                  {row.resolvedStartAt ? dateTime(row.resolvedStartAt) : '不限起点'} →{' '}
                  {row.resolvedEndAt ? dateTime(row.resolvedEndAt) : row.endIsWindowClose ? '关窗即止' : row.endAnchor === 'none' ? '不限制' : '—'}
                </span>
              </div>
              <div className="seg ops-presets">
                {OPS_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.hint}
                    className={draft.startAnchor === p.startAnchor && draft.endAnchor === p.endAnchor ? 'on' : ''}
                    onClick={() => applyPreset(row.key, p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="inline-form">
                <div className="field">
                  <label htmlFor={`${row.key}-start`}>起点</label>
                  <select id={`${row.key}-start`} value={draft.startAnchor} onChange={(e) => patch(row.key, { startAnchor: e.target.value as OpsStartAnchor })}>
                    {ANCHOR_START.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.startAnchor === 'absolute' ? (
                  <div className="field">
                    <label htmlFor={`${row.key}-start-at`}>起点时间（北京时间）</label>
                    <input
                      id={`${row.key}-start-at`}
                      className="mono"
                      type="datetime-local"
                      value={draft.startWall}
                      onChange={(e) => patch(row.key, { startWall: e.target.value })}
                    />
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor={`${row.key}-end`}>终点</label>
                  <select id={`${row.key}-end`} value={draft.endAnchor} onChange={(e) => patch(row.key, { endAnchor: e.target.value as OpsEndAnchor })}>
                    {ANCHOR_END.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {draft.endAnchor === 'absolute' ? (
                  <div className="field">
                    <label htmlFor={`${row.key}-end-at`}>终点时间（北京时间）</label>
                    <input
                      id={`${row.key}-end-at`}
                      className="mono"
                      type="datetime-local"
                      value={draft.endWall}
                      onChange={(e) => patch(row.key, { endWall: e.target.value })}
                    />
                  </div>
                ) : null}
                <div className="field grow">
                  <label htmlFor={`${row.key}-note`}>备注（给教练侧与通知用）</label>
                  <input id={`${row.key}-note`} value={draft.note} maxLength={200} onChange={(e) => patch(row.key, { note: e.target.value })} />
                </div>
              </div>
              <div className="ops-row-foot">
                <label className="field field-check">
                  <input type="checkbox" checked={draft.requiresWindow} onChange={(e) => patch(row.key, { requiresWindow: e.target.checked })} />
                  需要开窗（随窗锚必须勾）
                </label>
                <label className="field field-check">
                  <input type="checkbox" checked={draft.closeInflight} onChange={(e) => patch(row.key, { closeInflight: e.target.checked })} />
                  到点收口在途单（报价 / 谈判按各自时限了结）
                </label>
                <button className="btn btn-sm" type="button" disabled={busyKey === row.key} onClick={() => void save(row)}>
                  {busyKey === row.key ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 ? <p className="hint">没有可设项（迁移未应用？）。</p> : null}
      </section>
    </div>
  );
}
