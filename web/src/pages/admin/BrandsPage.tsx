// 管理端 · 品牌池（v6.8.0 冠名活化）：列表 / 新增自定义品牌 / 调热度·行业·档位 / 弃用
// 热度界 0.5–1.5（与 market_heat_rules 钳制边界一致）；有 active 合同的品牌后端会拒弃用（409）
// 档位（v6.13.0 C2）：三档下拉 + 锁定开关；锁档的行关窗自动校准跳过
import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiSend } from '../../lib/api.ts';
import { fetchMarketRound, MARKET_ROUND_KEY, reopenMarketRound } from '../../lib/adminQueries.ts';
import { useTimeFmt } from '../../lib/datetime.ts';
import { useToast } from '../../lib/toast.tsx';
import { useMediaQuery } from '../../lib/use-media.ts';

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
  // v6.51.0 批 2/3：企业档案 7 列 + 招商性格 2 列（空串 = 未登记）
  name_en: string;
  full_name: string;
  color: string;
  slogan: string;
  hq: string;
  intro: string;
  origin: string;
  style: string;
  prefer: string;
}

/** 行内编辑草稿（v6.51.0 起含档案与招商性格；数字字段也用字符串，提交时才转数）。 */
interface BrandDraft {
  heat: string;
  industry: string;
  nameEn: string;
  fullName: string;
  color: string;
  slogan: string;
  hq: string;
  intro: string;
  origin: string;
  style: string;
  prefer: string;
}

const BRANDS_KEY = ['admin', 'brands'] as const;
const HEAT_MIN = 0.5;
const HEAT_MAX = 1.5;
const TIERS = ['头部', '新兴', '口碑'] as const;
// 招商性格（v6.51.0 批 3）：决定该品牌递什么套餐；空 = 按档位（头部进取、其余稳健）
const STYLES = ['', '稳健', '进取', '对赌'] as const;
// 招商偏好标签（与后端 PREFER_TAGS 同源）：对赌抽签权重偏向 + 情绪加成
const PREFER_TAG_OPTIONS = ['冠军相', '高上座', '死忠规模', '大场馆'] as const;
// v6.21.0 ②：赞助品牌表窄屏改卡片流的断点——与 AdminLayout 抽屉 / styles.css 管理端媒体块同为 ≤760
const NARROW_QUERY = '(max-width: 760px)';

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

export default function BrandsPage() {
  // v6.25.0：开轮 / 结轮 / 报价截止时刻走共享时区层（默认北京时间）
  const { dateTime } = useTimeFmt();
  const qc = useQueryClient();
  const { show, toastNode } = useToast();
  const narrow = useMediaQuery(NARROW_QUERY);
  const { data, isPending, isError, error } = useQuery({
    queryKey: BRANDS_KEY,
    queryFn: () => api<{ brands: BrandRow[] }>('/api/admin/brands'),
  });
  const [newName, setNewName] = useState('');
  const [newHeat, setNewHeat] = useState('1.0');
  const [newIndustry, setNewIndustry] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<number, BrandDraft>>({});
  // v6.51.0：档案/招商性格区默认收起（28 行池子全展开时表格过长）——按行展开，状态只存展开中的行
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  const brands = data?.brands ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: BRANDS_KEY });

  function isOpen(row: BrandRow): boolean {
    return openIds[row.id] === true;
  }

  function toggleOpen(row: BrandRow) {
    setOpenIds((m) => ({ ...m, [row.id]: !m[row.id] }));
  }

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

  function fieldOf(row: BrandRow): BrandDraft {
    return (
      draft[row.id] ?? {
        heat: String(row.heat),
        industry: row.industry,
        nameEn: row.name_en,
        fullName: row.full_name,
        color: row.color,
        slogan: row.slogan,
        hq: row.hq,
        intro: row.intro,
        origin: row.origin,
        style: row.style,
        prefer: row.prefer,
      }
    );
  }
  function setField(row: BrandRow, patch: Partial<BrandDraft>) {
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
    if (f.color.trim() !== '' && !/^#[0-9A-Fa-f]{6}$/.test(f.color.trim())) return show('色值要写成 #RRGGBB 或留空', true);
    const prefer = f.prefer.split(',').map((t) => t.trim()).filter((t) => t !== '');
    if (prefer.length > 3) return show('偏好标签最多 3 个', true);
    setBusy(true);
    try {
      await apiSend('PATCH', `/api/admin/brands/${row.id}`, {
        heat,
        industry: f.industry.trim(),
        nameEn: f.nameEn.trim(),
        fullName: f.fullName.trim(),
        color: f.color.trim(),
        slogan: f.slogan.trim(),
        hq: f.hq.trim(),
        intro: f.intro.trim(),
        origin: f.origin,
        style: f.style,
        prefer: prefer.join(','),
      });
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

  /** 品牌名 + 品牌色块 + 英文名 + 「中资」标签（v6.51.0 批 2，空字段不渲染）。 */
  function brandLabel(row: BrandRow) {
    return (
      <>
        {row.color !== '' && (
          <span
            className="brand-color-chip"
            style={{ background: row.color }}
            title={`品牌色 ${row.color}`}
          />
        )}
        <b>{row.brand}</b>
        {row.name_en !== '' && <span className="hint" style={{ marginLeft: 6 }}>{row.name_en}</span>}
        {row.origin !== '' && (
          <span className="badge gold" style={{ marginLeft: 6 }} title="中资企业">
            {row.origin}
          </span>
        )}
      </>
    );
  }

  /** 企业档案 7 列 + 招商性格 2 列（v6.51.0 批 2/3）：桌面表格第二行与窄屏卡片共用同一网格。 */
  function profileFields(row: BrandRow, f: BrandDraft) {
    return (
      <div className="brand-profile-grid">
        <label>
          英文名
          <input className="input input-sm" value={f.nameEn} maxLength={40} onChange={(e) => setField(row, { nameEn: e.target.value })} />
        </label>
        <label>
          全称
          <input className="input input-sm" value={f.fullName} maxLength={30} onChange={(e) => setField(row, { fullName: e.target.value })} />
        </label>
        <label>
          口号
          <input className="input input-sm" value={f.slogan} maxLength={20} onChange={(e) => setField(row, { slogan: e.target.value })} />
        </label>
        <label>
          总部
          <input className="input input-sm" value={f.hq} maxLength={20} onChange={(e) => setField(row, { hq: e.target.value })} />
        </label>
        <label>
          品牌色
          <span className="brand-color-cell">
            <input
              type="color"
              value={/^#[0-9A-Fa-f]{6}$/.test(f.color) ? f.color : '#cccccc'}
              onChange={(e) => setField(row, { color: e.target.value })}
            />
            <input className="input input-sm mono" placeholder="#RRGGBB" value={f.color} maxLength={7} onChange={(e) => setField(row, { color: e.target.value })} />
          </span>
        </label>
        <label>
          性质
          <select className="input input-sm" value={f.origin} onChange={(e) => setField(row, { origin: e.target.value })}>
            <option value="">境外</option>
            <option value="中资">中资</option>
          </select>
        </label>
        <label>
          招商性格
          <select className="input input-sm" value={f.style} onChange={(e) => setField(row, { style: e.target.value })}>
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '按档位' : s}
              </option>
            ))}
          </select>
        </label>
        <div className="brand-profile-cell">
          偏好标签
          <span className="brand-prefer-cell">
            {PREFER_TAG_OPTIONS.map((t) => {
              const on = f.prefer.split(',').includes(t);
              return (
                <label key={t} className="hint">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const cur = f.prefer.split(',').map((x) => x.trim()).filter((x) => x !== '');
                      const next = on ? cur.filter((x) => x !== t) : [...cur, t];
                      if (next.length > 3) return;
                      setField(row, { prefer: next.join(',') });
                    }}
                  />{' '}
                  {t}
                </label>
              );
            })}
          </span>
        </div>
        <label style={{ gridColumn: '1 / -1' }}>
          简介
          <textarea className="input input-sm" rows={2} value={f.intro} maxLength={80} onChange={(e) => setField(row, { intro: e.target.value })} />
        </label>
      </div>
    );
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
        <p className="hint">
          v6.51.0：每行的「档案」按钮展开可编辑品牌档案（英文名/全称/口号/总部/品牌色/简介/性质）与招商性格——默认收起；
          套餐由性格决定（稳健/进取/对赌，空 = 按档位），偏好标签（最多 3 个，逗号分隔）影响对赌抽签权重与情绪加成；品牌名与热度留空字段不展示。
        </p>
        {isPending && <p className="muted">加载中…</p>}
        {isError && <p className="muted">{error instanceof Error ? error.message : '读不出来'}</p>}
        {/* v6.21.0 ②：窄屏（≤760）改卡片流；桌面表格分支原样保留（含内联定宽，mobile-baseline 白名单） */}
        {narrow && !isPending && !isError && (
          <div className="brand-cards">
            {brands.map((row) => {
              const f = fieldOf(row);
              return (
                <div className="brand-card" key={row.id}>
                  <div>{brandLabel(row)}</div>
                  {/* P2-4（评审）：与桌面表格「总部/来源/状态/生效冠名」四列对等的元信息行 */}
                  <div className="brand-card-meta">
                    <span>总部 {row.hq || '—'}</span>
                    <span>来源 {row.source === 'custom' ? '自定义' : '种子'}</span>
                    <span>状态 {row.status === 'adopted' ? '在池' : '已弃用'}</span>
                    <span>生效冠名 {row.active_contracts}</span>
                  </div>
                  <div className="brand-card-grid">
                    <input className="input input-sm" aria-label="行业" value={f.industry} maxLength={10} onChange={(e) => setField(row, { industry: e.target.value })} />
                    <input className="input input-sm mono" aria-label="热度" value={f.heat} onChange={(e) => setField(row, { heat: e.target.value })} />
                    <select className="input input-sm" aria-label="档位" value={row.tier} disabled={busy} onChange={(e) => void changeTier(row, e.target.value)}>
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <label className="hint">
                      <input type="checkbox" checked={row.tier_locked === 1} disabled={busy} onChange={() => void toggleTierLock(row)} /> 锁
                    </label>
                  </div>
                  {isOpen(row) && profileFields(row, f)}
                  <div className="btn-row">
                    <button className="btn btn-ghost btn-sm" type="button" aria-expanded={isOpen(row)} onClick={() => toggleOpen(row)}>
                      {isOpen(row) ? '收起' : '档案'}
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void saveBrand(row)}>
                      保存
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void toggleStatus(row)}>
                      {row.status === 'adopted' ? '弃用' : '恢复'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!narrow && !isPending && !isError && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>品牌</th>
                  <th>总部</th>
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
                    <Fragment key={row.id}>
                      <tr>
                        <td>{brandLabel(row)}</td>
                        <td className="brand-meta-cell">{row.hq || '—'}</td>
                        <td>
                          {/* v6.20.0：表格内控件保持定宽——min(N,100%) 的百分比分量会改变桌面列宽分配（评审 P0-1），窄屏保底由 .table-wrap 横滚承担 */}
                          <input className="input input-sm" style={{ width: 72 }} value={f.industry} maxLength={10} onChange={(e) => setField(row, { industry: e.target.value })} />
                        </td>
                        <td>
                          <input className="input input-sm mono" style={{ width: 56 }} value={f.heat} onChange={(e) => setField(row, { heat: e.target.value })} />
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
                        <td className="brand-meta-cell">{row.source === 'custom' ? '自定义' : '种子'}</td>
                        <td className="brand-meta-cell">{row.status === 'adopted' ? '在池' : '已弃用'}</td>
                        <td className="mono">{row.active_contracts}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" type="button" aria-expanded={isOpen(row)} onClick={() => toggleOpen(row)}>
                            {isOpen(row) ? '收起' : '档案'}
                          </button>
                          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void saveBrand(row)}>
                            保存
                          </button>
                          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void toggleStatus(row)}>
                            {row.status === 'adopted' ? '弃用' : '恢复'}
                          </button>
                        </td>
                      </tr>
                      {isOpen(row) && (
                        <tr>
                          <td colSpan={9}>{profileFields(row, f)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>新增自定义品牌</h3>
        {/* v6.21.0 ②：窄屏三字段全宽堆叠（样式在 styles.css 的 .brand-new-form 媒体块）；桌面 <p> 原样 */}
        {narrow ? (
          <div className="brand-new-form">
            <input className="input input-sm" placeholder="品牌名（1-20 字）" value={newName} maxLength={20} onChange={(e) => setNewName(e.target.value)} />
            <input className="input input-sm" placeholder="行业（如 科技）" value={newIndustry} maxLength={10} onChange={(e) => setNewIndustry(e.target.value)} />
            <input className="input input-sm mono" placeholder="热度" value={newHeat} onChange={(e) => setNewHeat(e.target.value)} />
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void addBrand()}>
              新增
            </button>
          </div>
        ) : (
          <p>
            <input className="input input-sm" style={{ width: 'min(160px, 100%)' }} placeholder="品牌名（1-20 字）" value={newName} maxLength={20} onChange={(e) => setNewName(e.target.value)} />
            <input className="input input-sm" style={{ width: 'min(120px, 100%)', marginLeft: 8 }} placeholder="行业（如 科技）" value={newIndustry} maxLength={10} onChange={(e) => setNewIndustry(e.target.value)} />
            <input className="input input-sm mono" style={{ width: 'min(80px, 100%)', marginLeft: 8 }} placeholder="热度" value={newHeat} onChange={(e) => setNewHeat(e.target.value)} />
            <button className="btn btn-sm" style={{ marginLeft: 8 }} type="button" disabled={busy} onClick={() => void addBrand()}>
              新增
            </button>
          </p>
        )}
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
                · 开轮于 {marketRound.opened_season} 赛季第 {marketRound.opened_window} 窗（{dateTime(marketRound.opened_at)}）
                {marketRound.settled_at ? `，结轮 ${dateTime(marketRound.settled_at)}` : ''} · 本轮报价 {marketOffers.length} 份
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
                          <td className="mono">{dateTime(o.expire_at)}</td>
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
