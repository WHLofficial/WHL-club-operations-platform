// 管理端 · 品牌池（v6.8.0 冠名活化）：列表 / 新增自定义品牌 / 调热度·行业·档位 / 弃用
// 热度界 0.5–1.5（与 market_heat_rules 钳制边界一致）；有 active 合同的品牌后端会拒弃用（409）
// 档位（v6.13.0 C2）：三档下拉 + 锁定开关；锁档的行关窗自动校准跳过
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiSend } from '../../lib/api.ts';
import { fetchMarketRound, MARKET_ROUND_KEY, reopenMarketRound } from '../../lib/adminQueries.ts';
import { useToast } from '../../lib/toast.tsx';

interface BrandRow {
  id: number;
  brand: string;
  heat: number;
  source: string;
  status: string;
  industry: string;
  tier: string;
  tier_locked: number;
  created_at: string;
  active_contracts: number;
}

const BRANDS_KEY = ['admin', 'brands'] as const;
const HEAT_MIN = 0.5;
const HEAT_MAX = 1.5;
const TIERS = ['头部', '新兴', '口碑'] as const;

// 招商轮报价状态徽标（v6.14.0 C3）：pending 待签 / accepted 已签 / queued 待接替 / expired 已过期
const MARKET_OFFER_STATUS: Record<string, { text: string; badge: string }> = {
  pending: { text: '待签', badge: 'gray' },
  accepted: { text: '已签', badge: 'green' },
  queued: { text: '待接替', badge: 'sky' },
  expired: { text: '已过期', badge: 'orange' },
};

// 报价期限按赛季展示（库内按常规窗计数，1 赛季 = 2 个常规窗）
function seasonsText(windows: number): string {
  const s = windows / 2;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

function stampOf(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

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

  // 招商轮（v6.14.0 C3）：当前 open 轮优先、否则最近已结轮 + 全状态报价流水；只读 + 手动恢复按钮
  const marketQuery = useQuery({ queryKey: MARKET_ROUND_KEY, queryFn: fetchMarketRound });
  const marketRound = marketQuery.data?.round ?? null;
  const marketOffers = marketQuery.data?.offers ?? [];

  async function reopenRound() {
    if (!window.confirm('清盘当前招商轮并立即开新一轮？当前轮未签的报价全部作废（整轮无人签的品牌热度 −0.03），随后按当刻队况重新定向递价。')) return;
    setBusy(true);
    try {
      const out = await reopenMarketRound();
      void qc.invalidateQueries({ queryKey: MARKET_ROUND_KEY });
      refresh();
      show(out.hadOpenRound ? `已清盘旧轮并开出新轮，递出 ${out.offerCount} 份报价。` : `已开出新一轮，递出 ${out.offerCount} 份报价。`);
    } catch (err) {
      show(err instanceof Error ? err.message : '重开招商轮失败', true);
    } finally {
      setBusy(false);
    }
  }

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

  async function changeTier(row: BrandRow, tier: string) {
    if (tier === row.tier) return;
    setBusy(true);
    try {
      await apiSend('PATCH', `/api/admin/brands/${row.id}`, { tier });
      refresh();
      show(`已把 ${row.brand} 调为${tier}档（下次关窗生效）`);
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTierLock(row: BrandRow) {
    const to = row.tier_locked ? 0 : 1;
    setBusy(true);
    try {
      await apiSend('PATCH', `/api/admin/brands/${row.id}`, { tierLocked: to });
      refresh();
      show(to === 1 ? `已锁档 ${row.brand}（自动校准跳过）` : `已解锁 ${row.brand}（跟随自动校准）`);
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
          签约时热度定格进合同，改动只影响之后的报价与续约。档位每窗按热度自动校准（热度降序前 3 家且 ≥1.0 → 头部，
          ≥0.9 → 新兴，其余口碑）；锁档后该品牌跳过自动校准。头部档限 1 队、新兴档限 2 队签约。
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
                  <th>档位</th>
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
                        {/* v6.20.0：表格内控件保持定宽——min(N,100%) 的百分比分量会改变桌面列宽分配（评审 P0-1），窄屏保底由 .table-wrap 横滚承担 */}
                        <input className="input input-sm" style={{ width: 96 }} value={f.industry} maxLength={10} onChange={(e) => setField(row, { industry: e.target.value })} />
                      </td>
                      <td>
                        <input className="input input-sm mono" style={{ width: 72 }} value={f.heat} onChange={(e) => setField(row, { heat: e.target.value })} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <select className="input input-sm" style={{ width: 84 }} value={row.tier} disabled={busy} onChange={(e) => void changeTier(row, e.target.value)}>
                          {TIERS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <label className="hint" style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={row.tier_locked === 1} disabled={busy} onChange={() => void toggleTierLock(row)} /> 锁
                        </label>
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
          <input className="input input-sm" style={{ width: 'min(160px, 100%)' }} placeholder="品牌名（1-20 字）" value={newName} maxLength={20} onChange={(e) => setNewName(e.target.value)} />
          <input className="input input-sm" style={{ width: 'min(120px, 100%)', marginLeft: 8 }} placeholder="行业（如 科技）" value={newIndustry} maxLength={10} onChange={(e) => setNewIndustry(e.target.value)} />
          <input className="input input-sm mono" style={{ width: 'min(80px, 100%)', marginLeft: 8 }} placeholder="热度" value={newHeat} onChange={(e) => setNewHeat(e.target.value)} />
          <button className="btn btn-sm" style={{ marginLeft: 8 }} type="button" disabled={busy} onClick={() => void addBrand()}>
            新增
          </button>
        </p>
        <p className="hint">热度区间 {HEAT_MIN}–{HEAT_MAX}；行业名未登记在行业系数表时按 1.0 计。</p>
      </section>

      <section className="card">
        <h3>招商轮</h3>
        <p className="hint">
          非临时窗关窗时自动清盘旧轮、按当刻队况向品牌合作范围内的球队定向递价；报价在有效期内由教练在「冠名市场」签（有现约时选到期接替或解约换签）。
        </p>
        {marketQuery.isPending && <p className="muted">加载中…</p>}
        {marketQuery.isError && <p className="muted">{marketQuery.error instanceof Error ? marketQuery.error.message : '读不出来'}</p>}
        {marketQuery.data && !marketRound && (
          <p className="muted">还没有开过招商轮——等下一次常规窗关窗时会自动开一轮（也可用下面按钮直接开一轮）。</p>
        )}
        {marketRound && (
          <>
            <p>
              <span className={`badge ${marketRound.status === 'open' ? 'green' : 'gray'}`}>{marketRound.status === 'open' ? '进行中' : '已结轮'}</span>
              <span className="hint">
                {' '}
                · 开轮于 {marketRound.opened_season} 赛季第 {marketRound.opened_window} 窗（{stampOf(marketRound.opened_at)}）
                {marketRound.settled_at ? `，结轮 ${stampOf(marketRound.settled_at)}` : ''} · 本轮报价 {marketOffers.length} 份
              </span>
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>品牌</th>
                    <th>球队</th>
                    <th>金额</th>
                    <th>套餐</th>
                    <th>状态</th>
                    <th>到期</th>
                  </tr>
                </thead>
                <tbody>
                  {marketOffers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        本轮没有递出报价。
                      </td>
                    </tr>
                  ) : (
                    marketOffers.map((o) => {
                      const st = MARKET_OFFER_STATUS[o.status] ?? { text: o.status, badge: 'gray' };
                      return (
                        <tr key={o.id}>
                          <td>{o.brand}</td>
                          <td>{o.club_name ?? `俱乐部 #${o.club_id}`}</td>
                          <td className="mono">
                            {o.amount.toFixed(2)} M/窗 × {seasonsText(o.windows)} 赛季
                          </td>
                          <td>套餐 {o.package_no}</td>
                          <td>
                            <span className={`badge ${st.badge}`}>{st.text}</span>
                          </td>
                          <td className="mono">{stampOf(o.expire_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <p>
              <span className="hint">
                {marketRound
                  ? '清盘当前轮：未签报价作废、整轮无人签的品牌热度 −0.03，随后按当刻队况重开一轮。'
                  : '当前没有招商轮：点了按当刻队况直接开一轮。'}
              </span>
            </p>
          </>
        )}
        <p>
          <button className="btn btn-sm" type="button" disabled={busy || marketQuery.isPending} onClick={() => void reopenRound()}>
            手动重开一轮
          </button>
          <span className="hint"> 清盘/开轮口径见上；递出报价数会在操作后提示。</span>
        </p>
      </section>
    </div>
  );
}
