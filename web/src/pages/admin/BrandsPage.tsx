// 管理端 · 品牌池（v6.8.0 冠名活化）：列表 / 新增自定义品牌 / 调热度·行业 / 弃用
// 热度界 0.5–1.5（与 market_heat_rules 钳制边界一致）；有 active 合同的品牌后端会拒弃用（409）
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiSend } from '../../lib/api.ts';
import { useToast } from '../../lib/toast.tsx';

interface BrandRow {
  id: number;
  brand: string;
  heat: number;
  source: string;
  status: string;
  industry: string;
  created_at: string;
  active_contracts: number;
}

const BRANDS_KEY = ['admin', 'brands'] as const;
const HEAT_MIN = 0.5;
const HEAT_MAX = 1.5;

export default function BrandsPage() {
  const qc = useQueryClient();
  const { show, toastNode } = useToast();
  const { data, isPending, isError, error } = useQuery({
    queryKey: BRANDS_KEY,
    queryFn: () => api<{ brands: BrandRow[] }>('/api/admin/brands'),
  });
  const [newName, setNewName] = useState('');
  const [newHeat, setNewHeat] = useState('1.0');
  const [newIndustry, setNewIndustry] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<number, { heat: string; industry: string }>>({});

  const brands = data?.brands ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: BRANDS_KEY });

  function fieldOf(row: BrandRow) {
    return draft[row.id] ?? { heat: String(row.heat), industry: row.industry };
  }
  function setField(row: BrandRow, patch: Partial<{ heat: string; industry: string }>) {
    setDraft((d) => ({ ...d, [row.id]: { ...fieldOf(row), ...patch } }));
  }

  async function addBrand() {
    const heat = Number(newHeat);
    if (!newName.trim()) return show('填品牌名', true);
    if (!Number.isFinite(heat) || heat < HEAT_MIN || heat > HEAT_MAX) return show(`热度需在 ${HEAT_MIN}–${HEAT_MAX} 之间`, true);
    setBusy(true);
    try {
      await apiSend('POST', '/api/admin/brands', { brand: newName.trim(), heat, industry: newIndustry.trim() || undefined });
      setNewName('');
      setNewHeat('1.0');
      setNewIndustry('');
      refresh();
      show('已新增品牌');
    } catch (err) {
      show(err instanceof Error ? err.message : '新增失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function saveBrand(row: BrandRow) {
    const f = fieldOf(row);
    const heat = Number(f.heat);
    if (!Number.isFinite(heat) || heat < HEAT_MIN || heat > HEAT_MAX) return show(`热度需在 ${HEAT_MIN}–${HEAT_MAX} 之间`, true);
    if (!f.industry.trim()) return show('行业名不能空', true);
    setBusy(true);
    try {
      await apiSend('PATCH', `/api/admin/brands/${row.id}`, { heat, industry: f.industry.trim() });
      setDraft((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
      refresh();
      show(`已更新 ${row.brand}`);
    } catch (err) {
      show(err instanceof Error ? err.message : '更新失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(row: BrandRow) {
    const to = row.status === 'adopted' ? 'discarded' : 'adopted';
    if (to === 'discarded' && !window.confirm(`弃用品牌「${row.brand}」？弃用后不再出现在报价池，也不会再有热度演化。`)) return;
    setBusy(true);
    try {
      await apiSend('PATCH', `/api/admin/brands/${row.id}`, { status: to });
      refresh();
      show(to === 'discarded' ? `已弃用 ${row.brand}` : `已恢复 ${row.brand}`);
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      {toastNode}
      <section className="card">
        <h3>品牌池</h3>
        <p className="hint">
          冠名报价 = (基准 + 容量系数×容量万 + 死忠系数×死忠万) × 品牌热度 × 行业系数（行业系数表在系统参数
          `naming_industry_factors`）。热度在关窗时按各队近 3 场战绩演化（全胜 +0.03、全败 −0.02，钳在 {HEAT_MIN}–{HEAT_MAX}）。
          签约时热度定格进合同，改动只影响之后的报价与续约。
        </p>
        {isPending && <p className="muted">加载中…</p>}
        {isError && <p className="muted">{error instanceof Error ? error.message : '读不出来'}</p>}
        {!isPending && !isError && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>品牌</th>
                  <th>行业</th>
                  <th>热度</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>生效冠名</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {brands.map((row) => {
                  const f = fieldOf(row);
                  return (
                    <tr key={row.id}>
                      <td>{row.brand}</td>
                      <td>
                        <input className="input input-sm" style={{ width: 96 }} value={f.industry} maxLength={10} onChange={(e) => setField(row, { industry: e.target.value })} />
                      </td>
                      <td>
                        <input className="input input-sm mono" style={{ width: 72 }} value={f.heat} onChange={(e) => setField(row, { heat: e.target.value })} />
                      </td>
                      <td>{row.source === 'custom' ? '自定义' : '种子'}</td>
                      <td>{row.status === 'adopted' ? '在池' : '已弃用'}</td>
                      <td className="mono">{row.active_contracts}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void saveBrand(row)}>
                          保存
                        </button>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void toggleStatus(row)}>
                          {row.status === 'adopted' ? '弃用' : '恢复'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>新增自定义品牌</h3>
        <p>
          <input className="input input-sm" style={{ width: 160 }} placeholder="品牌名（1-20 字）" value={newName} maxLength={20} onChange={(e) => setNewName(e.target.value)} />
          <input className="input input-sm" style={{ width: 120, marginLeft: 8 }} placeholder="行业（如 科技）" value={newIndustry} maxLength={10} onChange={(e) => setNewIndustry(e.target.value)} />
          <input className="input input-sm mono" style={{ width: 80, marginLeft: 8 }} placeholder="热度" value={newHeat} onChange={(e) => setNewHeat(e.target.value)} />
          <button className="btn btn-sm" style={{ marginLeft: 8 }} type="button" disabled={busy} onClick={() => void addBrand()}>
            新增
          </button>
        </p>
        <p className="hint">热度区间 {HEAT_MIN}–{HEAT_MAX}；行业名未登记在行业系数表时按 1.0 计。</p>
      </section>
    </div>
  );
}
