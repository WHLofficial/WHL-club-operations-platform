// 管理端 · 系统页：平台参数（config）查看（原 Admin.tsx ConfigSection，增量 15 拆分，行为零变化）
// 增量 15 后续 commit 在此页扩展：超管明文编辑 + 审计日志查询
import { useEffect, useState } from 'react';
import { api, type ConfigRow } from '../../lib/api.ts';

export default function SystemPage() {
  return (
    <div className="admin-page">
      <ConfigSection />
    </div>
  );
}

function ConfigSection() {
  const [rows, setRows] = useState<ConfigRow[] | null>(null);
  useEffect(() => {
    api<{ config: ConfigRow[] }>('/api/admin/config')
      .then((d) => setRows(d.config))
      .catch(() => setRows([]));
  }, []);

  return (
    <section className="card admin-section">
      <h2>平台参数（config）</h2>
      {rows === null ? (
        <p className="muted">读取中…</p>
      ) : (
        <details>
          <summary>参数注册表（{rows.length} 键；涉密键只显示「（内部参数，已隐藏）」）</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>键</th>
                  <th>当前值</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">
                      {r.key} {r.secret && <span className="badge gray">涉密</span>}
                    </td>
                    <td className="mono">{r.value ?? '（默认）'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
