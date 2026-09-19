// 管理端 · 系统页：平台参数（config）查看（原 Admin.tsx ConfigSection，增量 15 拆分）
// 增量 15 后续 commit 在此页扩展：超管明文编辑 + 审计日志查询
import { useQuery } from '@tanstack/react-query';
import { api, type ConfigRow } from '../../lib/api.ts';

export default function SystemPage() {
  return (
    <div className="admin-page">
      <ConfigSection />
    </div>
  );
}

function ConfigSection() {
  const { data: rows } = useQuery({
    queryKey: ['admin', 'config'],
    // 原 ConfigSection 失败时静默显示空表，queryFn 里吞掉保持一致
    queryFn: () => api<{ config: ConfigRow[] }>('/api/admin/config').then((d) => d.config).catch(() => [] as ConfigRow[]),
  });

  return (
    <section className="card admin-section">
      <h2>平台参数（config）</h2>
      {rows === undefined ? (
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
