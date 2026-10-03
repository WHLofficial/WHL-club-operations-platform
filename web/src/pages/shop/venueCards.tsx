// 球场消费三卡（v6.26.0 自 CoachPanel.tsx 整体迁入消费中心）：设施经营 / 冠名市场 / 球场档期。
// 自包含组件：各自 useQuery + invalidate，端点与刷新口径一字未动；CoachPanel 侧只留只读档案卡。
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  apiPost,
  type BookingActivityOption,
  type BookingResult,
  type BookingsResponse,
  type BuildPaymentResult,
  type ClubOffer,
  type NamingOfferAcceptResult,
  type NamingTerminateResult,
  type StadiumBuildInfo,
} from '../../lib/api.ts';
import { qk, useNamingInvalidation, useNamingQuote } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { useTimeFmt } from '../../lib/datetime.ts';

// 冠名期限按赛季展示（v3.0.0：库内按常规窗计数，1 赛季 = 2 个常规窗）
export function seasonsOf(windows: number): string {
  const s = windows / 2;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

export function money2(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(2)} m`;
}

const FACILITY_LABEL: Record<string, string> = {
  commercial: '商业区',
  broadcast: '灯光转播',
  pitch: '草皮',
  youth: '青训中心',
  medical: '医疗中心',
};

export function FacilityOpsCard() {
  const qc = useQueryClient();
  const { show } = useToast();
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
        `${done}：费用 ${out.cost.toFixed(2)}M${out.creditUsed > 0 ? `（建设券抵 ${out.creditUsed.toFixed(2)}M）` : ''}，实付 ${out.cash.toFixed(2)}M，返建设券 ${out.refund.toFixed(2)}M。`,
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
  const upgradeBlocked = !info.nextTier || !info.nextTier.open || !info.nextTier.capacityOk;

  return (
    <section className="card">
      <h3>设施经营</h3>
      <p className="hint">
        建设券余额 <span className="mono">{info.credit.toFixed(2)}</span> M（建设支出返 {Math.round(info.refundRatio * 100)}%，可抵扣后续建设）· 当前余额{' '}
        <span className="mono">{info.balance.toFixed(2)}</span> M · 开放至 {info.maxOpenTier} 级
      </p>

      <p>
        <b>扩建</b>（当前 {info.tier.capacity.toLocaleString()} 座 / 档位上限 {info.tier.maxSeats?.toLocaleString() ?? '—'}）：
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
          disabled={busy || !seatsValid || expandError !== null}
          style={{ marginLeft: 8 }}
          onClick={() => void run('/api/club/stadium/expand', { seats: seatCount }, `扩建 +${seatCount} 座`)}
        >
          扩建
        </button>
      </p>

      <p>
        <b>球场升级</b>：
        {info.nextTier ? (
          <>
            下一档 {info.nextTier.name}（至少 {info.nextTier.minSeats.toLocaleString()} 座）· 费用{' '}
            <span className="mono">{info.nextTier.upgradeCost?.toFixed(2) ?? '—'}</span> M
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy || upgradeBlocked}
              style={{ marginLeft: 8 }}
              title={upgradeBlocked ? (!info.nextTier.open ? `第 ${info.tier.level + 1} 档暂未开放` : '容量不足，先扩建') : undefined}
              onClick={() => void run('/api/club/stadium/upgrade', {}, `升级到${info.nextTier!.name}`)}
            >
              {upgradeBlocked ? (info.nextTier.open ? '容量不足' : '未开放') : '升级'}
            </button>
          </>
        ) : (
          <span className="muted">已是最高档位</span>
        )}
      </p>

      <p>
        <b>子设施</b>：
        {info.facilities.map((f) => (
          <span key={f.key} style={{ marginLeft: 10, whiteSpace: 'nowrap' }}>
            {FACILITY_LABEL[f.key] ?? f.key} <span className="mono">{f.level}</span> 级
            {f.nextCost !== null ? (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={busy}
                style={{ marginLeft: 4 }}
                title={`升到 ${f.level + 1} 级：${f.nextCost.toFixed(2)}M`}
                onClick={() => void run('/api/club/facilities/upgrade', { key: f.key }, `${FACILITY_LABEL[f.key] ?? f.key}升到 ${f.level + 1} 级`)}
              >
                升级 {f.nextCost.toFixed(2)}M
              </button>
            ) : (
              <span className="muted"> 满级</span>
            )}
          </span>
        ))}
      </p>
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
    return (
      <p key={o.id}>
        <b>{o.brand}</b>
        <span className={`badge ${TIER_BADGE[o.tier] ?? 'gray'}`} style={{ marginLeft: 6 }} title={TIER_PERK[o.tier] ?? ''}>
          {o.tier}档
        </span>
        {o.status === 'queued' && (
          <span className="badge sky" style={{ marginLeft: 6 }}>
            待接替
          </span>
        )}
        <span className="hint">（套餐 {o.packageNo}）</span> <span className="mono">{o.amount.toFixed(2)}</span> M/窗 ×{' '}
        <span className="mono">{seasonsOf(o.windows)}</span> 赛季
        <span className="hint">
          {' '}
          ·{' '}
          {o.expireAt.startsWith('9999')
            ? '本轮内有效'
            : `有效期至 ${dateTime(o.expireAt)}`}
        </span>
        {o.status === 'queued' ? null : contract ? (
          pickId === o.id ? (
            <>
              <button className="btn btn-ghost btn-sm" type="button" disabled={busy} style={{ marginLeft: 8 }} onClick={() => void accept(o, 'queued')}>
                现合同到期后自动接替
              </button>
              <button className="btn btn-sm" type="button" disabled={busy} style={{ marginLeft: 6 }} onClick={() => void accept(o, 'terminate')}>
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
          <button className="btn btn-sm" type="button" disabled={busy} style={{ marginLeft: 8 }} onClick={() => void accept(o)}>
            接受签约
          </button>
        )}
      </p>
    );
  }

  return (
    <section className="card">
      <h3>冠名市场</h3>
      {contract ? (
        <>
          <p>
            现约 <b>{contract.brand}</b>
            <span className={`badge ${TIER_BADGE[contract.tier] ?? 'gray'}`} style={{ marginLeft: 6 }} title={TIER_PERK[contract.tier] ?? ''}>
              {contract.tier}档
            </span>
            （{contract.pkgName}套餐）：每窗{' '}
            <span className="mono">{contract.feePerWindow.toFixed(2)}</span> M，还剩{' '}
            <span className="mono">{seasonsOf(contract.windowsRemaining)}</span>/
            <span className="mono">{seasonsOf(contract.windowsTotal)}</span> 赛季
            {contract.bonusAmount > 0 && (
              <>
                {' '}· 达线奖金 <span className="mono">{contract.bonusAmount.toFixed(2)}</span> M（上座 ≥{' '}
                <span className="mono">{contract.betAttend}</span> 或死忠增长 ≥{' '}
                <span className="mono">{contract.betFans}</span>）
              </>
            )}
          </p>
          <p>
            品牌方情绪：<b>{moodLabel(contract.satisfaction)}</b>
            <span className="hint">
              （<span className="mono">{contract.satisfaction.toFixed(2)}</span> / 2.00；每窗按上座与战绩演化，冠名类事件即时影响）
            </span>
          </p>
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
                      disabled={busy}
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
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void terminate()}>
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

export function BookingsCard() {
  const qc = useQueryClient();
  const { show } = useToast();
  const listQuery = useQuery({
    queryKey: qk.bookings,
    queryFn: () => api<BookingsResponse>('/api/club/bookings'),
    retry: false,
  });
  const [busySlot, setBusySlot] = useState<number | null>(null);
  // 每档位未提交的选择（不提交不改）；键缺省时回落到已排活动
  const [choice, setChoice] = useState<Record<number, string>>({});
  const data = listQuery.data ?? null;

  function refresh() {
    void qc.invalidateQueries({ queryKey: qk.bookings });
    void qc.invalidateQueries({ queryKey: ['club', 'finance-summary'] });
  }

  async function book(slotNo: number, activityType: string, activityName: string) {
    setBusySlot(slotNo);
    try {
      const out = await apiPost<BookingResult>('/api/club/bookings', { slotNo, activityType });
      refresh();
      show(
        out.previous
          ? `${slotNo} 号档期改排「${activityName}」，原「${out.previous.activityName}」已撤。`
          : `${slotNo} 号档期已排「${activityName}」，收益在窗末结算。`,
      );
    } catch (err) {
      show(err instanceof Error ? err.message : '排档期失败', true);
    } finally {
      setBusySlot(null);
    }
  }

  if (listQuery.isPending) return null;
  if (listQuery.isError || !data) {
    return (
      <section className="card">
        <h3>球场档期</h3>
        <p className="muted">{listQuery.error instanceof Error ? listQuery.error.message : '档期读不出来'}</p>
      </section>
    );
  }

  const bySlot = new Map(data.bookings.map((b) => [b.slotNo, b]));
  const slotNos = Array.from({ length: Math.max(0, data.slots) }, (_, i) => i + 1);
  const fallbackKey = data.catalog.find((o) => o.key === 'idle')?.key ?? data.catalog[0]?.key ?? '';
  const incomeText = (o: BookingActivityOption) =>
    o.incomeMin === o.incomeMax ? money2(o.incomeMin) : `${o.incomeMin.toFixed(2)}–${o.incomeMax.toFixed(2)} m`;

  return (
    <section className="card">
      <h3>球场档期</h3>
      <p className="hint">
        每窗有 <span className="mono">{data.slots}</span> 个非比赛日档位，可以排演唱会、电竞、开放日、青训营这类活动；收益与草皮损坏都在关窗时一起结算。
        {!data.open && (data.season !== null ? '当前看的是已关窗口的档期，只能看不能改。' : '现在没有开着的窗口，开窗后才能排档期。')}
      </p>
      {slotNos.length === 0 ? (
        <p className="muted">本季每窗 0 个档位（activity_slots = 0），不开放档期预订。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>档位</th>
                <th>已排活动</th>
                <th className="num">预计收入</th>
                <th>改排为</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {slotNos.map((slotNo) => {
                const current = bySlot.get(slotNo);
                const currentOption = current ? data.catalog.find((o) => o.key === current.activityType) : undefined;
                const picked = choice[slotNo] ?? current?.activityType ?? fallbackKey;
                const pickedOption = data.catalog.find((o) => o.key === picked);
                return (
                  <tr key={slotNo}>
                    <td className="mono">{slotNo} 号</td>
                    <td>{current ? current.activityName : <span className="muted">空闲</span>}</td>
                    <td className="num mono">{currentOption ? incomeText(currentOption) : '—'}</td>
                    <td>
                      <select
                        value={picked}
                        disabled={!data.open || busySlot !== null}
                        onChange={(e) => setChoice((prev) => ({ ...prev, [slotNo]: e.target.value }))}
                      >
                        {data.catalog.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.name}（{incomeText(o)}）
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        disabled={!data.open || busySlot !== null || pickedOption === undefined}
                        onClick={() => void book(slotNo, picked, pickedOption?.name ?? picked)}
                      >
                        {busySlot === slotNo ? '提交中…' : current ? '改排' : '排上'}
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
  );
}
