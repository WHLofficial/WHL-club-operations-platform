// 管理端 · 系统页（v2.1.0 commit 6）：
// 平台参数——普通管理只读（涉密键掩码），超管全键明文 + 逐键编辑（PUT，审计 config_set）；
// 审计日志——最近 100 条，按 action 前缀过滤，非超管看到的涉密键值已被服务端掩掉。
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { api, apiPut, isSuperAdmin, type AuditLogResponse, type ConfigResponse, type ConfigRow, type MeUser } from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';

export default function SystemPage() {
  const user = useOutletContext<MeUser | null | undefined>();
  return (
    <div className="admin-page">
      <ConfigSection editable={isSuperAdmin(user)} />
      <AuditLogSection />
    </div>
  );
}

/* ---------- 平台参数（config） ---------- */

function ConfigSection({ editable }: { editable: boolean }) {
  const { show, toastNode } = useToast();
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ['admin', 'config'],
    // 原 ConfigSection 失败时静默显示空表，queryFn 里吞掉保持一致
    queryFn: () => api<ConfigResponse>('/api/admin/config').catch(() => null),
  });
  const rows = data?.config ?? [];

  async function save(row: ConfigRow) {
    if (saving) return;
    setSaving(true);
    try {
      const value = draft.trim() === '' ? null : draft;
      const res = await apiPut<{ ok: boolean; value: string | null }>('/api/admin/config', { key: row.key, value });
      show(`参数 ${row.key} 已保存${res.value === null ? '（回默认值）' : ''}，改动进审计。`);
      setEditingKey(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
    } catch (err) {
      show(err instanceof Error ? err.message : '保存失败', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card admin-section">
      <h2>平台参数（config）</h2>
      {toastNode}
      <p className="hint">
        {editable
          ? '超管视图：全键明文，可逐键编辑（保存立即生效，改动进审计）。清空输入框保存 = 回到默认值。'
          : '只读视图：涉密键只显示「（内部参数，已隐藏）」。参数调整需要超管操作。'}
      </p>
      {rows.length === 0 ? (
        <p className="muted">{data === undefined ? '读取中…' : '没有参数或读取失败。'}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>键</th>
                <th>当前值</th>
                {editable && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="mono">
                    {r.key} {r.secret && <span className="badge gray">涉密</span>}
                  </td>
                  <td className="mono">
                    {editingKey === r.key ? (
                      <input
                        className="field mono"
                        type="text"
                        value={draft}
                        placeholder={r.value ?? '（默认）'}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void save(r);
                          if (e.key === 'Escape') setEditingKey(null);
                        }}
                        style={{ minWidth: '18rem' }}
                      />
                    ) : (
                      (r.value ?? '（默认）')
                    )}
                  </td>
                  {editable && (
                    <td>
                      {editingKey === r.key ? (
                        <span className="inline-form">
                          <button className="btn btn-sm" type="button" disabled={saving} onClick={() => void save(r)}>
                            {saving ? '保存中…' : '保存'}
                          </button>
                          <button className="btn btn-sm" type="button" disabled={saving} onClick={() => setEditingKey(null)}>
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => {
                            setEditingKey(r.key);
                            setDraft(r.value ?? '');
                          }}
                        >
                          修改
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- 审计日志 ---------- */

// origin 记的是「哪条入口触发的」，不是「谁做的」：管理员点开窗口引发的惰性结算仍是 user。
// 历史行（v6.3.2 之前写入）没有来源，显示为「—（历史行）」。
const AUDIT_ORIGIN_LABELS: Record<string, string> = {
  user: '用户操作',
  cron_tick: '定时任务',
  lazy_settle: '惰性结算',
  backchannel: '认证中心',
  machine: '机器通道',
};

function formatValue(raw: string | null): string {
  if (raw === null) return '—';
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

function AuditLogSection() {
  const [filter, setFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [origin, setOrigin] = useState('');
  const [activeOrigin, setActiveOrigin] = useState('');

  const applyFilter = () => {
    setActiveFilter(filter.trim());
    setActiveOrigin(origin);
  };

  const { data } = useQuery({
    queryKey: ['admin', 'audit-log', activeFilter, activeOrigin],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeFilter) params.set('action', activeFilter);
      if (activeOrigin) params.set('origin', activeOrigin);
      const qs = params.toString();
      return api<AuditLogResponse>(`/api/admin/audit-log${qs ? `?${qs}` : ''}`).catch(
        () => ({ entries: [] }) as AuditLogResponse,
      );
    },
  });
  const entries = data?.entries ?? [];

  return (
    <section className="card admin-section">
      <h2>审计日志</h2>
      <p className="hint">
        敏感操作留痕（最近 100 条，按时间倒序）。按 action 前缀过滤，例如 config_set、market_bid_pause、listing_create；
        来源按触发通道过滤，与「谁做的」无关。
      </p>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="audit-action">action 前缀（留空看全部）</label>
          <input
            id="audit-action"
            className="mono"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilter();
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="audit-origin">来源</label>
          <select
            id="audit-origin"
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
              setActiveOrigin(e.target.value);
            }}
          >
            <option value="">全部</option>
            {Object.entries(AUDIT_ORIGIN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" type="button" onClick={applyFilter}>
          查询
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="muted">没有匹配的审计记录。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th className="num">操作者</th>
                <th>动作</th>
                <th>对象</th>
                <th>内容（before → after）</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.at.slice(0, 19).replace('T', ' ')}</td>
                  <td className="num mono">
                    {e.actor === null || e.actor === 0 ? '系统' : e.actor}
                    <span className="muted"> · {e.origin === null ? '—（历史行）' : (AUDIT_ORIGIN_LABELS[e.origin] ?? e.origin)}</span>
                  </td>
                  <td className="mono">{e.action}</td>
                  <td className="mono">
                    {e.targetType}
                    {e.targetId !== null ? ` #${e.targetId}` : ''}
                  </td>
                  <td className="mono">
                    {formatValue(e.before)} → {formatValue(e.after)}
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
