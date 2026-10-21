// 场馆经营（v6.53.0 P0）：一屏走完「看窗口 → 选方针 → 逐档排 → 看预期 → 保存」。
// 所有数字都取服务端（GET 的 slot.quote / recommendations、POST preview 的 totals）：
// 前端不自己算槽数、不逐档加总、不连乘上座乘数——饱和系数按同类序位打折，逐档相加会与关窗结算不一致。
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  apiPut,
  type VenueFigureBlock,
  type VenuePlanResponse,
  type VenuePolicyChoice,
  type VenueSaveResponse,
} from '../../lib/api.ts';
import { qk, useMyClub, useVenuePlan, useVenuePreview } from '../../lib/queries.ts';
import { fmtClock, useCountdown } from '../../lib/use-countdown.ts';
import { useOpsGate } from '../../lib/ops-gate.ts';
import { useToast } from '../../lib/toast.tsx';
import OpsGateNote from '../../components/OpsGateNote.tsx';
import { diffDraft, draftToPicks, effectivePick, samePicks, type VenueDraft, type VenuePick } from './venue-preview.ts';
import './venue-plan.css';

type VenueActivityDto = VenuePlanResponse['activities'][number];

/** 三方针的展示顺序与中文名（key 与 clubs.venue_policy 的取值一致） */
const POLICIES: { key: VenuePolicyChoice; label: string }[] = [
  { key: 'money', label: '多赚钱' },
  { key: 'fans', label: '攒人气' },
  { key: 'reputation', label: '树口碑' },
];

/** 头部固定展示的三项设施（顺序固定；等级由服务端下发，前端不推算） */
const FACILITY_KEYS = ['broadcast', 'youth', 'commercial'] as const;

/** 金额单位「百万」，服务端已四舍五入到 3 位 */
const money = (v: number): string => v.toFixed(3);
const signedMoney = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(3)}`;
const times = (v: number): string => `×${v.toFixed(2)}`;

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message !== '') return err.message;
  return '保存失败，请稍后重试。';
}

/** 一组口径数字（槽口径与整窗合计共用同一份排版） */
function Figures({ block, className = 'vop-figs' }: { block: VenueFigureBlock; className?: string }) {
  return (
    <dl className={className}>
      <div className="vop-fig">
        <dt>预期毛收入</dt>
        <dd>{money(block.gross)}</dd>
      </div>
      <div className="vop-fig">
        <dt>运营成本</dt>
        <dd>−{money(block.opsCost)}</dd>
      </div>
      <div className="vop-fig">
        <dt>草皮损耗</dt>
        <dd>−{money(block.expectedDamage)}</dd>
      </div>
      <div className="vop-fig">
        <dt>预期净额</dt>
        <dd>{signedMoney(block.expectedNet)}</dd>
      </div>
      <div className="vop-fig">
        <dt>下 5 场乘数</dt>
        <dd>{times(block.attendanceMod)}</dd>
      </div>
      <div className="vop-fig">
        <dt>声望</dt>
        <dd>{block.reputationGain >= 0 ? `+${block.reputationGain}` : String(block.reputationGain)}</dd>
      </div>
    </dl>
  );
}

export default function VenuePlanPage() {
  const { loading, isCoach, club: myClub, failed: clubFailed } = useMyClub();
  const planQ = useVenuePlan(isCoach && myClub !== null);
  const plan = planQ.data ?? null;

  // 草稿：只记「动过的槽」（undefined 语义由 venue-preview.ts 承担），保存成功后整份清空
  const [draft, setDraft] = useState<VenueDraft>({});
  // 方针：点「按此方针排满」时记下，保存时随槽位一起 PUT；null = 本次不动方针
  const [policyDraft, setPolicyDraft] = useState<VenuePolicyChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show, toastNode } = useToast();
  const qc = useQueryClient();
  const gate = useOpsGate('consumption');

  // 预览按 250ms 防抖落一拍：连续改下拉只发一次请求；sticky 结算条始终显示上一份合计（keepPreviousData 不闪空）
  const deferredDraft = useDeferredValue(draft);
  const [previewDraft, setPreviewDraft] = useState<VenueDraft>({});
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewDraft(deferredDraft), 250);
    return () => window.clearTimeout(timer);
  }, [deferredDraft]);

  // 预览送「完整草稿」（缺省槽 = 空置），服务端才能按同类序位算合计
  const previewPicks = useMemo(() => (plan === null ? [] : draftToPicks(plan.slots, previewDraft)), [plan, previewDraft]);
  const previewQ = useVenuePreview(previewPicks, plan !== null);
  // 预览失败时不要展示上一份 totals（keepPreviousData 会留下旧数，看起来像「已按新排布算了」）
  const totals = previewQ.isError ? null : (previewQ.data?.totals ?? null);

  const changes = useMemo(() => (plan === null ? [] : diffDraft(plan.slots, draft)), [plan, draft]);
  const policyChanged = plan !== null && policyDraft !== null && policyDraft !== plan.policy;
  const hasChanges = changes.length > 0 || policyChanged;
  // 读秒钩子必须无条件调用；没有具体关窗时刻（closesAt 为 null）时传 null
  const closesLeft = useCountdown(plan?.window?.closesAt ?? null);

  if (loading) {
    return (
      <div className="container vop-page">
        <h1>场馆经营</h1>
        <p className="muted">正在确认你的俱乐部身份…</p>
      </div>
    );
  }

  if (clubFailed && isCoach) {
    return (
      <div className="container vop-page">
        <h1>场馆经营</h1>
        <div className="card empty-state">
          <p className="muted">俱乐部身份暂时取不到，请稍后刷新重试。</p>
        </div>
      </div>
    );
  }

  if (!isCoach || myClub === null) {
    return (
      <div className="container vop-page">
        <h1>场馆经营</h1>
        <div className="card empty-state">
          <p className="muted">
            {isCoach ? '还没有绑定俱乐部。先到我的球队完成绑定，再来排档期。' : '这里只对教练开放。档期是教练的事，观众视角看看就好。'}
          </p>
        </div>
      </div>
    );
  }

  if (planQ.isPending) {
    return (
      <div className="container vop-page">
        <h1>场馆经营</h1>
        <p className="muted">正在读取本窗档期…</p>
      </div>
    );
  }

  if (plan === null) {
    return (
      <div className="container vop-page">
        <h1>场馆经营</h1>
        <div className="card empty-state">
          <p className="vop-error">{planQ.error === null ? '档期暂时读不出来，请稍后刷新重试。' : errorText(planQ.error)}</p>
          <button
            className="btn"
            onClick={() => {
              void planQ.refetch();
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const activities = plan.activities.filter((a) => a.key !== 'idle');
  const activeWindow = plan.window !== null && plan.window.status === 'open' ? plan.window : null;
  // 再可排几档看「已保存」的槽（草稿里的改动还没落库，不能算进来）
  const openSaved = plan.slots.filter((s) => s.booked === null).length;
  const filled = plan.slots.filter((s) => effectivePick(s, draft) !== null).length;

  // 保存按钮的 disabled 优先级（§7.4 #10）：无窗 > 运营闸 > 保存中 > 无改动
  const blockReason =
    activeWindow === null
      ? plan.window === null
        ? '当前没有进行中的转会窗，开窗后才能保存'
        : '这一窗已经关了，档期不能再改'
      : gate?.blocked
        ? `${gate.hint}，现在不能保存`
        : saving
          ? '正在保存…'
          : !hasChanges
            ? '还没有改动'
            : null;

  function setSlot(slotNo: number, activity: string): void {
    setDraft((d) => ({ ...d, [slotNo]: activity }));
  }

  /** 把某类活动填进第一个「草稿里还空着」的槽 */
  function fillFirstEmpty(activity: string): void {
    const target = plan?.slots.find((s) => effectivePick(s, draft) === null);
    if (target === undefined) {
      show('先把某个档位改成暂不排', true);
      return;
    }
    setSlot(target.slotNo, activity);
  }

  function unmetText(a: VenueActivityDto): string {
    return a.requirements.map((r) => `${r.label} ${r.current}/${r.need}`).join(' · ');
  }

  function pickActivity(a: VenueActivityDto): void {
    if (!a.unlocked) {
      show(unmetText(a) === '' ? '这一项还没解锁' : unmetText(a), true);
      return;
    }
    fillFirstEmpty(a.key);
  }

  /** 套用某个方针：先按槽数把全窗清空，再写入该方针的排布（= 全窗覆盖，不留旧排布） */
  function applyPolicy(key: VenuePolicyChoice): void {
    const rec = plan?.recommendations[key];
    if (rec === undefined) return;
    const next: VenueDraft = {};
    for (const slot of plan?.slots ?? []) next[slot.slotNo] = null;
    for (const pick of rec.picks) next[pick.slotNo] = pick.activity;
    setDraft(next);
    setPolicyDraft(key);
    setError(null);
    show(`已按「${POLICIES.find((p) => p.key === key)?.label ?? key}」排满，可逐档再改`);
  }

  function discard(): void {
    setDraft({});
    setPolicyDraft(null);
    setError(null);
  }

  async function save(): Promise<void> {
    // PUT 是 partial 语义：只发真正改动的槽；方针有变才带 policy
    const body: { slots: VenuePick[]; policy?: VenuePolicyChoice | null } = { slots: changes };
    if (policyChanged) body.policy = policyDraft;
    setSaving(true);
    setError(null);
    try {
      await apiPut<VenueSaveResponse>('/api/club/venue-plan', body);
      setDraft({});
      setPolicyDraft(null);
      await qc.invalidateQueries({ queryKey: qk.venuePlan, exact: true });
      show('档期已保存');
    } catch (err) {
      // 失败保留草稿：门槛/开窗/运营闸的文案都由服务端给（前端不硬编码等级判断）
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container vop-page">
      <h1>场馆经营</h1>

      <section className="card">
        <div className="vop-metrics">
          <div className="vop-metric">
            <span className="vop-metric-label">球场容量</span>
            <span className="vop-metric-value">{plan.hasStadium ? `${plan.capacity.toLocaleString('zh-CN')} 座` : '未建球场'}</span>
          </div>
          <div className="vop-metric">
            <span className="vop-metric-label">本窗档位</span>
            <span className="vop-metric-value">
              {plan.slotCount} 档（上限 {plan.slotCap}）
            </span>
          </div>
          <div className="vop-metric">
            <span className="vop-metric-label">场馆声望</span>
            <span className="vop-metric-value">{plan.reputation}</span>
          </div>
          <div className="vop-metric">
            <span className="vop-metric-label">下 5 场上座乘数</span>
            <span className="vop-metric-value">{times(plan.attendance.mod)}</span>
          </div>
        </div>
        <div className="vop-head-notes">
          {!plan.hasStadium && <span className="badge orange">未建球场，按 2 档试排</span>}
          {FACILITY_KEYS.map((key) => {
            const f = plan.facilities.find((x) => x.key === key);
            return f === undefined ? null : (
              <span key={key} className="badge gray">
                {f.label} Lv.{f.level}
              </span>
            );
          })}
          {plan.attendance.mod !== 1 && plan.attendance.matchesLeft > 0 && (
            <span className="badge gray">乘数还剩 {plan.attendance.matchesLeft} 场</span>
          )}
          {plan.configWarning !== null && <span className="vop-slot-warn">{plan.configWarning}</span>}
        </div>
      </section>

      <section className="card vop-banner">
        {activeWindow !== null ? (
          <>
            <p className="vop-banner-title">
              第 {activeWindow.season} 季第 {activeWindow.windowSeq} 窗进行中，{openSaved > 0 ? `本窗还可排 ${openSaved} 档` : '本窗档期已排满'}
            </p>
            <div className="vop-banner-meta">
              {activeWindow.closesAt === null ? (
                <span className="vop-cap">关窗由管理员手工触发</span>
              ) : closesLeft === null ? null : (
                <span className="vop-cap">距离关窗 {fmtClock(closesLeft)}</span>
              )}
              {activeWindow.reminderSent && <span className="badge gray">关窗提醒已发到站内信</span>}
            </div>
          </>
        ) : (
          <p className="vop-banner-title">
            {plan.window === null ? '当前没有进行中的转会窗，可以先试排；开窗后才能保存。' : '这一窗已经关了，档期不能再改；等下一窗开启再排。'}
          </p>
        )}
      </section>

      <section className="vop-policies">
        {POLICIES.map((p) => {
          const rec = plan.recommendations[p.key];
          return (
            <div key={p.key} className="card vop-policy">
              <h3>{p.label}</h3>
              <p className="muted vop-policy-desc">{rec.policy}</p>
              <Figures block={rec.totals} />
              <div className="vop-policy-foot">
                <button className="btn btn-sm" onClick={() => applyPolicy(p.key)} disabled={saving}>
                  按此方针排满
                </button>
                {plan.policy === p.key && <span className="badge gold">上次用</span>}
                {samePicks(draft, rec.picks) && <span className="badge green">已按此排布</span>}
              </div>
            </div>
          );
        })}
      </section>
      <p className="vop-cap">方针只是推荐口径，保存前可逐档改；金额单位百万，本页不逐档加总。</p>

      <section className="vop-slots">
        {plan.slots.map((slot) => {
          const pick = effectivePick(slot, draft);
          const changed = pick !== slot.booked;
          const pickedAct = pick === null ? undefined : activities.find((a) => a.key === pick);
          return (
            <div key={slot.slotNo} className="card vop-slot">
              <div className="vop-slot-head">
                <strong>第 {slot.slotNo} 档</strong>
                <span className={pick === null ? 'badge gray' : 'badge gold'}>{pick === null ? '空置' : '已排'}</span>
                {slot.saturation !== 1 && <span className="badge orange">×{slot.saturation}</span>}
                {changed && <span className="badge red">未保存</span>}
              </div>
              <label className="vop-slot-field">
                <span>这一档安排</span>
                <select
                  value={pick ?? ''}
                  disabled={saving}
                  onChange={(e) => setSlot(slot.slotNo, e.target.value)}
                >
                  <option value="">暂不排</option>
                  {activities.map((a) => {
                    // 已排的项即便门槛已不满足也要能保留（否则设施一降级，连「保持原样」都存不了）
                    const keepable = pick === a.key;
                    return (
                      <option key={a.key} value={a.key} disabled={!a.unlocked && !keepable}>
                        {a.name}
                        {!a.unlocked && !keepable ? '（未解锁）' : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              {pick !== null && pickedAct !== undefined && !pickedAct.unlocked && (
                <p className="vop-slot-warn">当前已排，但门槛已不满足</p>
              )}
              {changed && <p className="vop-cap">下面是已保存口径，改后的数字见底部合计。</p>}
              {slot.quote === null ? (
                <p className="vop-cap">这一档还没排活动，没有单档数字。</p>
              ) : (
                <Figures block={slot.quote} />
              )}
            </div>
          );
        })}
      </section>

      <section className="vop-acts">
        {activities.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`card vop-act${a.unlocked ? '' : ' vop-act-locked'}`}
            aria-disabled={!a.unlocked || saving}
            disabled={saving}
            title={a.unlocked ? undefined : unmetText(a)}
            onClick={() => pickActivity(a)}
          >
            <span className="vop-act-head">
              <strong>{a.name}</strong>
              {a.unlocked ? <span className="badge green">已解锁</span> : <span className="badge gray">未解锁</span>}
            </span>
            <span className="muted vop-act-blurb">{a.blurb}</span>
            {!a.unlocked && a.requirements.length > 0 && <span className="vop-act-reqs">{unmetText(a)}</span>}
          </button>
        ))}
      </section>

      <footer className="card vop-summary">
        <p className="vop-cap">整窗预期（金额单位：百万）{previewQ.isFetching ? ' · 更新中…' : ''}</p>
        <div className="vop-summary-row">
          {totals === null ? (
            <p className="vop-cap">{previewQ.isError ? '预期数字暂时算不出' : '还在算这一窗的预期…'}</p>
          ) : (
            <Figures block={totals} className="vop-figs vop-summary-figs" />
          )}
          <div className="vop-summary-side">
            <span className="vop-count">
              已排 {filled}/{plan.slotCount}
            </span>
            <button className="btn btn-ghost" onClick={discard} disabled={!hasChanges || saving}>
              放弃改动
            </button>
            <button
              className="btn"
              onClick={() => {
                void save();
              }}
              disabled={blockReason !== null}
              title={blockReason ?? undefined}
            >
              保存档期
            </button>
          </div>
        </div>
        {previewQ.isError && <p className="vop-slot-warn">预期数字暂时算不出，保存仍可用服务端校验。</p>}
        {error !== null && <p className="vop-error">{error}</p>}
        <OpsGateNote gate={gate} />
      </footer>

      {toastNode}
    </div>
  );
}
