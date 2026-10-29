// 设施与冠名两卡（v6.26.0 自 CoachPanel.tsx 整体迁入消费中心，v6.59.0 起同处「球场与冠名」页签）：
// 设施经营 / 冠名市场。球场档期（原第三卡）已于 v6.53.0 迁至独立的场馆经营页 web/src/pages/venue/VenuePlanPage.tsx。
// 自包含组件：各自 useQuery + invalidate，端点与刷新口径一字未动；CoachPanel 侧只留只读档案卡。
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  type BuildPaymentResult,
  type BrandProfile,
  type ClubOffer,
  type NamingOfferAcceptResult,
  type NamingTerminateResult,
  type StadiumBuildInfo,
} from '../../lib/api.ts';
import { qk, useNamingInvalidation, useNamingQuote } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';
import OpsGateNote from '../../components/OpsGateNote.tsx';
import { useOpsGate } from '../../lib/ops-gate.ts';

// 冠名期限按赛季展示（v3.0.0：库内按常规窗计数，1 赛季 = 2 个常规窗）
export function seasonsOf(windows: number): string {
  const s = windows / 2;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

export function money2(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(2)}m`;
}

const FACILITY_LABEL: Record<string, string> = {
  commercial: '商业区',
  broadcast: '灯光转播',
  pitch: '草皮',
  youth: '青训中心',
  medical: '医疗中心',
};

// 子设施说明（v6.59.0，口径对齐 src/core/attendance.ts / venue.ts / home.ts 的现行系数）
const FACILITY_DESC: Record<string, string> = {
  commercial: '每升 1 级：每场商业收入 +0.1m / 万观众（2 万观众约 +0.2m / 场）',
  broadcast: '每升 1 级：每场转播收入 +0.3m',
  pitch: '每升 1 级：球场活动收入 +10%；草皮受损概率 −15%',
  youth: '每升 1 级：死忠涨粉速度 +3%；青训类活动收入 +10%',
};

// v6.30.0 施工开窗闸：三类施工按钮的统一置灰原因（与后端 409 no_window 同口径）
const CLOSED_BUILD_HINT = '转会窗口没开，开窗后才能施工';

/** 对赌指标展示名（v6.51.0 批 3，与后端 BET_LABELS 同口径）。 */
const BET_LABEL: Record<string, string> = {
  attend: '上座率',
  sellout: '满座场次',
  fans: '死忠增长',
  points: '窗内积分',
  goals: '窗内进球',
  cleansheet: '零封场次',
};

/** 比率类指标（阈值是 0–1 比例，展示成百分比；其余是场次数/积分的整数线）。 */
function betThresholdText(m: string, threshold: number): string {
  return m === 'attend' || m === 'fans' ? `${(threshold * 100).toFixed(1)}%` : String(threshold);
}

/** 品牌档案碎片（v6.51.0 批 2）：口号 + 「中资」标签 + 招商性格徽标；档案缺失（不在池中的老品牌）时调用点不渲染。 */
function BrandTags({ profile }: { profile: BrandProfile }) {
  return (
    <>
      {profile.slogan !== '' && <span className="hint">「{profile.slogan}」</span>}
      {profile.origin !== '' && (
        <span className="badge gold" style={{ marginLeft: 6 }} title="中资品牌">
          {profile.origin}
        </span>
      )}
      {profile.style !== '' && (
        <span className="badge blue" style={{ marginLeft: 6 }} title="招商性格：决定递什么套餐（稳健 / 进取 / 对赌）">
          {profile.style}
        </span>
      )}
    </>
  );
}

/** 属地 · 行业 hint（批 2）：品牌总部城市与所属行业。 */
function brandHqText(profile: BrandProfile | null, industry: string): string {
  return [profile?.hq ?? '', industry].filter((s) => s !== '').join(' · ');
}

export function FacilityOpsCard() {
  const qc = useQueryClient();
  const { show } = useToast();
  // v6.49.0：消费中心时段（consumption）——必须在早退之前调用（hook 顺序固定）
  const consumptionGate = useOpsGate('consumption');
  const infoQuery = useQuery({
    queryKey: qk.stadiumBuild,
    queryFn: () => api<StadiumBuildInfo>('/api/club/stadium/build-info'),
    retry: false,
  });
  const [seats, setSeats] = useState('500');
  const [busy, setBusy] = useState(false);
  const info = infoQuery.data ?? null;

  function refresh() {
    void qc.invalidateQueries({ queryKey: qk.stadiumBuild });
    void qc.invalidateQueries({ queryKey: qk.myClub });
    void qc.invalidateQueries({ queryKey: ['club', 'balance'] });
  }

  async function run(path: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const out = await apiPost<BuildPaymentResult>(path, body);
      refresh();
      show(
        `${done}：费用 ${out.cost.toFixed(2)}M${out.creditUsed > 0 ? `（消费券抵 ${out.creditUsed.toFixed(2)}M）` : ''}，实付 ${out.cash.toFixed(2)}M，返消费券 ${out.refund.toFixed(2)}M。`,
      );
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  if (infoQuery.isPending) return null;
  if (infoQuery.isError || !info) {
    return (
      <section className="card">
        <h3>设施经营</h3>
        <p className="muted">{infoQuery.error instanceof Error ? infoQuery.error.message : '设施数据读不出来'}</p>
      </section>
    );
  }

  const seatCount = Number(seats);
  const seatsValid = Number.isInteger(seatCount) && seatCount > 0 && seatCount % 100 === 0;
  const expandCost = seatsValid ? (seatCount / 100) * info.expansionPer100 : null;
  const capacityHeadroom = info.tier.maxSeats !== null ? info.tier.maxSeats - info.tier.capacity : null;
  const expandError =
    seatsValid && capacityHeadroom !== null && seatCount > capacityHeadroom
      ? `超当前档位上限，最多还能扩 ${capacityHeadroom.toLocaleString()} 座`
      : null;
  const upgradeBlocked = !info.nextTier || !info.nextTier.open;
  // v6.30.0：门控吃 build-info 的 open（与后端 409 no_window 同一判据），不再单拉窗口端点
  // v6.49.0：消费中心时段（consumption）再叠一层，任一不过都点不动
  const windowOpen = info.open && consumptionGate?.blocked !== true;
  // v6.59.0：档位显示整体 +1（库内 0 档 = 社区级 (1)）
  const tierNo = info.tier.level + 1;
  const facilityRows = info.facilities.filter((f) => f.key !== 'medical'); // 医疗中心本轮不开放

  return (
    <section className="card">
      <h3>设施经营</h3>
      <OpsGateNote gate={consumptionGate} className="hint" />
      <p className="hint">
        消费券余额 <span className="mono">{info.voucherBalance.toFixed(2)}</span> M（建设支出返 {Math.round(info.refundRatio * 100)}% + 管理组发放，可抵扣建设与消费工单）· 当前余额{' '}
        <span className="mono">{info.balance.toFixed(2)}</span> M · 球场档位开放至 {info.maxOpenTierName ?? `第 ${info.maxOpenTier + 1} 档`} ({info.maxOpenTier + 1})
        {!windowOpen && ` · ${CLOSED_BUILD_HINT}。`}
      </p>

      <p>
        <b>扩建</b>（当前 {info.tier.name} ({tierNo}) · 容量 {info.tier.capacity.toLocaleString()} 座 / 上限{' '}
        {info.tier.maxSeats?.toLocaleString() ?? '—'} 座）：
        {/* v6.20.0 窄屏：座位数输入最宽 90px，窄屏按容器收缩 */}
        <input
          className="mono"
          style={{ width: 'min(90px, 100%)', marginLeft: 6 }}
          inputMode="numeric"
          value={seats}
          onChange={(e) => setSeats(e.target.value.replace(/[^\d]/g, ''))}
        />{' '}
        座
        {expandCost !== null && (
          <span className="hint" style={{ marginLeft: 6 }}>
            应付 <span className="mono">{expandCost.toFixed(2)}</span> M
          </span>
        )}
        {expandError && <span className="error-msg"> {expandError}</span>}
        <button
          className="btn btn-sm"
          type="button"
          disabled={busy || !seatsValid || expandError !== null || !windowOpen}
          style={{ marginLeft: 8 }}
          title={!windowOpen ? CLOSED_BUILD_HINT : undefined}
          onClick={() => void run('/api/club/stadium/expand', { seats: seatCount }, `扩建 +${seatCount} 座`)}
        >
          扩建
        </button>
      </p>

      <p>
        <b>球场升级</b>：
        {info.nextTier ? (
          <>
            下一档 {info.nextTier.name} ({tierNo + 1})（建议达到 {info.nextTier.minSeats.toLocaleString()} 座）· 费用{' '}
            <span className="mono">{info.nextTier.upgradeCost?.toFixed(2) ?? '—'}</span> M
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy || upgradeBlocked || !windowOpen}
              style={{ marginLeft: 8 }}
              title={!windowOpen ? CLOSED_BUILD_HINT : upgradeBlocked ? `第 ${tierNo + 1} 档暂未开放` : undefined}
              onClick={() => void run('/api/club/stadium/upgrade', {}, `升级到${info.nextTier!.name}`)}
            >
              {upgradeBlocked ? '未开放' : '升级'}
            </button>
          </>
        ) : (
          <span className="muted">已是最高档位</span>
        )}
      </p>

      <p className="hint" style={{ marginBottom: 4 }}>
        子设施上限随球场档位：当前 {info.tier.name} ({tierNo})，子设施可升到 {info.facilityCap}
      </p>
      <div>
        {facilityRows.map((f) => (
          <div key={f.key} className="facility-row">
            <span className="facility-row-name">
              <b>{FACILITY_LABEL[f.key] ?? f.key}</b> <span className="mono">{f.level}</span>
            </span>
            <span className="hint facility-row-desc">{FACILITY_DESC[f.key] ?? ''}</span>
            {f.nextCost !== null ? (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={busy || !windowOpen}
                title={!windowOpen ? CLOSED_BUILD_HINT : `升到 ${f.level + 1}：${f.nextCost.toFixed(2)}M`}
                onClick={() => void run('/api/club/facilities/upgrade', { key: f.key }, `${FACILITY_LABEL[f.key] ?? f.key}升到 ${f.level + 1}`)}
              >
                升级 {f.nextCost.toFixed(2)}M
              </button>
            ) : (
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {f.cap >= 5 ? '满级' : '已达上限（升级球场后解锁）'}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 品牌方情绪（v6.12.0）：满意度 0–2 映射三档文案，纯展示（C2 才接管行为） */
function moodLabel(satisfaction: number): string {
  if (satisfaction < 0.8) return '低落';
  if (satisfaction <= 1.2) return '平静';
  return '高涨';
}

export function NamingCard() {
  const { show } = useToast();
  // v6.49.0：冠名接报价/续约/终止同属消费中心时段
  const consumptionGate = useOpsGate('consumption');
  const opsBlocked = consumptionGate?.blocked === true;
  const { dateTime } = useTimeFmt();
  const quoteQuery = useNamingQuote();
  const refresh = useNamingInvalidation();
  const [busy, setBusy] = useState(false);
  // 有现约时接报价要二选一：正在选模式的报价 id（行内展开）
  const [pickId, setPickId] = useState<number | null>(null);
  const quote = quoteQuery.data ?? null;
  // 档位徽标配色（v6.13.0 C2）：头部紫 / 新兴天蓝 / 口碑灰
  const TIER_BADGE: Record<string, string> = { 头部: 'purple', 新兴: 'sky', 口碑: 'gray' };
  const TIER_PERK: Record<string, string> = {
    头部: '头部档：情绪地板 0.70，敏感（负向 ×1.5），活动收入 +2%',
    新兴: '新兴档：情绪地板 0.60，性格标准，无加成',
    口碑: '口碑档：情绪地板 0.50，宽容（负向 ×0.75），死忠涨粉 +0.5%',
  };

  // 接报价（v6.14.0 C3）：无现约不带 mode 直接签；有现约必选 queued（到期接替）/ terminate（解约换签）
  async function accept(offer: ClubOffer, mode?: 'queued' | 'terminate') {
    if (mode === 'terminate' && !window.confirm('换约要提前解约现合同：赔金按剩余窗口费的 30% 计（当窗费用照收）。确定解约当前并签新？')) return;
    setBusy(true);
    try {
      const out = await apiPost<NamingOfferAcceptResult>(`/api/club/naming/offers/${offer.id}/accept`, mode ? { mode } : {});
      refresh();
      if (out.result === 'queued') {
        show(`已登记接替：${quote?.contract?.brand ?? '现合同'} 到期后自动换 ${offer.brand}（每窗 ${offer.amount.toFixed(2)}M × ${seasonsOf(offer.windows)} 赛季）。`);
      } else if (out.result === 'terminated') {
        show(
          out.penalty > 0
            ? `已解约旧冠名（赔金 ${out.penalty.toFixed(2)}M 已从余额扣除）并签下 ${offer.brand}：每窗 ${offer.amount.toFixed(2)}M × ${seasonsOf(offer.windows)} 赛季。`
            : `已解约旧冠名（无赔金）并签下 ${offer.brand}：每窗 ${offer.amount.toFixed(2)}M × ${seasonsOf(offer.windows)} 赛季。`,
        );
      } else {
        const c = out.contract;
        show(
          `已签下 ${c?.brand ?? offer.brand}（${c?.pkgName ?? `套餐 ${offer.packageNo}`}）：每窗 ${(c?.feePerWindow ?? offer.amount).toFixed(2)}M × ${seasonsOf(c?.windowsTotal ?? offer.windows)} 赛季，常规窗关窗入账。`,
        );
      }
    } catch (err) {
      show(err instanceof Error ? err.message : '接报价失败', true);
    } finally {
      setBusy(false);
      setPickId(null);
    }
  }

  async function renew(packageNo: number, pkgName: string) {
    setBusy(true);
    try {
      const out = await apiPost<{ contract: { brand: string; feePerWindow: number; windowsTotal: number } }>(
        '/api/club/naming/renew',
        { packageNo },
      );
      refresh();
      show(`已与 ${out.contract.brand} 续约（${pkgName}）：每窗 ${out.contract.feePerWindow.toFixed(2)}M × ${seasonsOf(out.contract.windowsTotal)} 赛季。`);
    } catch (err) {
      show(err instanceof Error ? err.message : '续约失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function terminate() {
    if (!window.confirm('提前解约要赔剩余窗口费用（当窗照收后的 30%）。确定退冠名？')) return;
    setBusy(true);
    try {
      const out = await apiPost<NamingTerminateResult>('/api/club/naming/terminate', {});
      refresh();
      show(
        out.penalty > 0
          ? `已与 ${out.brand} 解约，赔金 ${out.penalty.toFixed(2)}M 已从余额扣除。`
          : `已与 ${out.brand} 解约（无赔金）。`,
      );
    } catch (err) {
      show(err instanceof Error ? err.message : '退约失败', true);
    } finally {
      setBusy(false);
    }
  }

  if (quoteQuery.isPending) return null;
  if (quoteQuery.isError || !quote) {
    return (
      <section className="card">
        <h3>冠名市场</h3>
        <p className="muted">{quoteQuery.error instanceof Error ? quoteQuery.error.message : '冠名数据读不出来'}</p>
      </section>
    );
  }

  const contract = quote.contract;

  // 报价行（v6.14.0 C3）：待签可接受；已登记接班只展示；有现约时接受要先选「到期接替」或「解约换签」
  function offerRow(o: ClubOffer) {
    const hqText = brandHqText(o.brandProfile, o.industry);
    return (
      <p key={o.id}>
        <b>{o.brand}</b>
        {o.brandProfile !== null && <BrandTags profile={o.brandProfile} />}
        <span className={`badge ${TIER_BADGE[o.tier] ?? 'gray'}`} style={{ marginLeft: 6 }} title={TIER_PERK[o.tier] ?? ''}>
          {o.tier}档
        </span>
        {o.status === 'queued' && (
          <span className="badge sky" style={{ marginLeft: 6 }}>
            待接替
          </span>
        )}
        {hqText !== '' && <span className="hint">（{hqText}）</span>}
        <span className="hint">（套餐 {o.packageNo}）</span> <span className="mono">{o.amount.toFixed(2)}</span> M/窗 ×{' '}
        <span className="mono">{seasonsOf(o.windows)}</span> 赛季
        <span className="hint">
          {' '}
          ·{' '}
          {o.expireAt.startsWith('9999')
            ? '本轮内有效'
            : `有效期至 ${dateTime(o.expireAt)}`}
        </span>
        {o.venueName !== '' && (
          <span className="hint"> · 签下将命名为「{o.venueName}」</span>
        )}
        {o.packageNo === 3 && (
          <span className="hint">
            {' '}
            · 对赌：签约时随机抽 2 条指标，每项达线各得 0.25 × 底价奖金
            {o.brandProfile?.prefer ? `（偏向 ${o.brandProfile.prefer.split(',').join('、')}）` : ''}
          </span>
        )}
        {o.status === 'queued' ? null : contract ? (
          pickId === o.id ? (
            <>
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy || opsBlocked} style={{ marginLeft: 8 }} onClick={() => void accept(o, 'queued')}>
                现合同到期后自动接替
              </button>
              <button className="btn btn-sm" type="button" disabled={busy || opsBlocked} style={{ marginLeft: 6 }} onClick={() => void accept(o, 'terminate')}>
                解约当前并签新
              </button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => setPickId(null)}>
                取消
              </button>
            </>
          ) : (
            <button className="btn btn-sm" type="button" disabled={busy} style={{ marginLeft: 8 }} onClick={() => setPickId(o.id)}>
              接受
            </button>
          )
        ) : (
          <button className="btn btn-sm" type="button" disabled={busy || opsBlocked} style={{ marginLeft: 8 }} onClick={() => void accept(o)}>
            接受签约
          </button>
        )}
      </p>
    );
  }

  return (
    <section className="card">
      <h3>冠名市场</h3>
      <OpsGateNote gate={consumptionGate} className="hint" />
      {contract ? (
        <>
          <p>
            现约 <b>{contract.venueName || contract.brand}</b>
            {contract.brandProfile !== null && <BrandTags profile={contract.brandProfile} />}
            <span className={`badge ${TIER_BADGE[contract.tier] ?? 'gray'}`} style={{ marginLeft: 6 }} title={TIER_PERK[contract.tier] ?? ''}>
              {contract.tier}档
            </span>
            （{contract.pkgName}套餐）：每窗{' '}
            <span className="mono">{contract.feePerWindow.toFixed(2)}</span> M，还剩{' '}
            <span className="mono">{seasonsOf(contract.windowsRemaining)}</span>/
            <span className="mono">{seasonsOf(contract.windowsTotal)}</span> 赛季
            {contract.betTerms && contract.betTerms.items.length > 0 ? (
              <>
                {' '}· 对赌条款（每项达线 <span className="mono">0.25</span> × 底价）：{' '}
                {contract.betTerms.items.map((it, i) => (
                  <span key={it.m}>
                    {i > 0 && '、'}
                    <span title={`基线 ${betThresholdText(it.m, it.baseline)}（样本 ${it.nBase} 场，目标概率 ${(it.pTarget * 100).toFixed(0)}%${it.guard !== '' ? `，护栏 ${it.guard}` : ''}）`}>
                      {BET_LABEL[it.m] ?? it.m} 达 <span className="mono">{betThresholdText(it.m, it.threshold)}</span>
                    </span>
                  </span>
                ))}
                <span className="hint">（签约时按品牌偏好抽定，合同期内不重抽）</span>
              </>
            ) : (
              contract.bonusAmount > 0 && (
                <>
                  {' '}· 达线奖金 <span className="mono">{contract.bonusAmount.toFixed(2)}</span> M（上座 ≥{' '}
                  <span className="mono">{contract.betAttend}</span> 或死忠增长 ≥{' '}
                  <span className="mono">{contract.betFans}</span>）
                </>
              )
            )}
          </p>
          <p>
            品牌方情绪：<b>{moodLabel(contract.satisfaction)}</b>
            <span className="hint">
              （<span className="mono">{contract.satisfaction.toFixed(2)}</span> / 2.00；每窗按上座与战绩演化，冠名类事件即时影响）
            </span>
          </p>
          {contract.brandProfile && (contract.brandProfile.intro !== '' || contract.brandProfile.nameEn !== '') && (
            <p className="hint">
              {contract.brandProfile.nameEn !== '' && <span>{contract.brandProfile.nameEn}</span>}
              {contract.brandProfile.intro !== '' && (
                <>
                  {' '}
                  <span title={contract.brandProfile.intro}>企业简介 ▾ 悬停可读（{brandHqText(contract.brandProfile, '')}）</span>
                </>
              )}
            </p>
          )}
          {contract.satisfyFloor !== null && contract.satisfaction <= contract.satisfyFloor + 0.1 && (
            <p>
              <span className="badge red" title={`情绪地板 ${contract.satisfyFloor.toFixed(2)}，跌破即被品牌主动解约（无赔偿）`}>
                低情绪预警
              </span>
              <span className="hint">
                {' '}距离地板 {contract.satisfyFloor.toFixed(2)} 只剩 {Math.max(0, Math.round((contract.satisfaction - contract.satisfyFloor) * 100) / 100).toFixed(2)}
                ，改善上座与战绩，或考虑主动退约止损。
              </span>
            </p>
          )}
          <p className="hint">
            冠名费在常规窗关窗时自动入账（1 赛季 = 2 个常规窗，临时窗不计）；提前解约赔剩余期间的 30%（当窗费用照收）。
          </p>
          {contract.windowsRemaining === 1 && (
            quote.renewal ? (
              <p>
                <b>续约</b>
                <span className="hint">（仅剩最后 1 窗可续；续约价按当前队况与品牌热度重算，剩余窗数重置）</span>
                {quote.renewal.packages.map((p) => (
                  <span key={p.packageNo} style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={busy || opsBlocked}
                      title={`${seasonsOf(p.windows)} 赛季 × ${p.feePerWindow.toFixed(2)}M/窗${p.bonusAmount > 0 ? `，达线奖金 ${p.bonusAmount.toFixed(2)}M` : ''}`}
                      onClick={() => void renew(p.packageNo, p.pkgName)}
                    >
                      {p.pkgName} {p.feePerWindow.toFixed(2)}M×{seasonsOf(p.windows)}赛季
                    </button>
                  </span>
                ))}
                <span className="hint">（品牌现热度 {quote.renewal.heat}）</span>
              </p>
            ) : (
              <p className="hint">仅剩最后 1 窗，但品牌已不在池中，无法续约——到期后合同自然失效。</p>
            )
          )}
          <p>
            <b>收到的报价</b>
            <span className="hint">（有生效冠名：接受时选「到期后自动接替」或「解约当前并签新」）</span>
          </p>
          {quote.offers.length === 0 ? <p className="hint">暂无待签报价。</p> : quote.offers.map(offerRow)}
          <button className="btn btn-sm" type="button" disabled={busy || opsBlocked} onClick={() => void terminate()}>
            退冠名
          </button>
        </>
      ) : (
        <>
          <p className="hint">
            冠名只能从收到的品牌报价里签（关窗时品牌按当刻队况定向递价，「品牌上门」事件也可能带一份）；签下后常规窗关窗时按合同金额入账，同一时间只能有一份生效冠名。
          </p>
          {quote.offers.length === 0 ? (
            <p className="hint">暂无待签报价——等下一次关窗后品牌递价，或抽到「品牌上门」事件。</p>
          ) : (
            quote.offers.map(offerRow)
          )}
        </>
      )}
    </section>
  );
}
