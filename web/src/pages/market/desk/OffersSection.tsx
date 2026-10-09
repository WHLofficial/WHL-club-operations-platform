// 转会台 · 报价区（v6.23.0）：原 pages/Offers.tsx 整体搬入，逻辑行为不变。
// 与旧页的区别只有两点：① box/status 由 desk 页统一持在 searchParams（本组件受控）；
// ② 页级 h1 退役，区块标题改用 h3，toastNode 留在本区块内渲染。
// v6.32.0：money 收口到 ../shared.tsx；标题「收到报价」改「报价」（box=out 是我送出的，旧名不副实）；
// 「报价被接受 ≠ 成交」机制句从页面级说明条收进本区块 hint（这里是唯一讲解点）。
// v6.40.0：支持站内信深链 ?offer=<id>——从收件篮点进来直接展开该单谈判桌并高亮行（.is-target）。
// v6.40.0 同版本补充（对话式改造）：
//   ① 谈判桌从「行下原地展开」改**对话浮层**（B 布局）：桌面居中弹层 / ≤760px 底部抽屉，外壳复用
//      .mkt-ov* + useOverlayShell（锁滚 / Esc / Tab 循环 / 焦点归位）；三段 = 单据头 · 事件流（唯一滚动区）·
//      动作栏（按 角色×状态 收敛：还价 / 同意 / 拒绝（卖方）/ 撤回（买方）；越权那颗不渲染（v6.40.1），
//      状态或轮次不满足则置灰并把理由写进 title）。
//   ② 拒绝语义 R1：规则不动，只把「拒绝」摆到明面（卖方 pending 任意轮次都能拒，与轮次无关）；拒绝 / 放弃 /
//      撤回改两段式就地确认并说清冻结去向；提示句按真实规则订正（名单不产生任何自动行为）。
//   ③ 金额：报价类（当前价 / 还价 / 同意价）走 moneyIntText（整数带 m），列头去掉「（m）」。
//   ④ 时间：气泡与系统行到秒（dateTimeSec）。
//   ⑤ 窄屏清单：表格改卡片行（对手 · 金额 · R轮次 · 完整时间戳），断点 760px（与浮层抽屉同源）。
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  type OfferDetailResponse,
  type OfferEventRow,
  type OfferListItem,
  type OfferSettingsDto,
  type OfferStatus,
} from '../../../lib/api.ts';
import { playerPath } from '../../../lib/player-link.ts';
import { moneyIntText } from '../../../lib/club-cards.ts';
import { useMediaQuery } from '../../../lib/use-media.ts';
import { useOverlayShell } from '../../../lib/use-overlay-shell.ts';
import { useOfferDetail, useOfferSettings, useOffers, useOffersInvalidation } from '../../../lib/queries.ts';
import { useToast } from '../../../lib/toast.tsx';
import { useTimeFmt } from '../../../lib/datetime.ts';

// 清单窄屏断点：与浮层底部抽屉同一条（760px 是本站主流断点，见 Player.tsx / ComparePickerOverlay）
const CARDS_QUERY = '(max-width: 760px)';

const STATUS_BADGE: Record<OfferStatus, { label: string; cls: string }> = {
  pending: { label: '待回复', cls: 'sky' },
  // v6.29.0 意向单：关窗期双方谈成，先挂意向单（不生成挂牌、冻结继续）；开窗后卖方确认才物化
  intent: { label: '意向单·等开窗', cls: 'gold' },
  // v6.23.0 阶段徽标：同意报价即自动挂牌，文案点明「已进入竞价」，免得与成约混淆
  accepted: { label: '已接受·挂牌竞价中', cls: 'green' },
  rejected: { label: '被拒绝', cls: 'red' },
  withdrawn: { label: '已撤回', cls: 'gray' },
  expired: { label: '已过期', cls: 'gray' },
};

const EVENT_LABEL: Record<string, string> = {
  open: '送出报价',
  counter: '还价',
  accept: '同意挂牌',
  reject: '拒绝',
  withdraw: '撤回',
  expire: '过期',
  auto_accept: '名单自动同意',
  auto_reject: '名单自动拒',
  // v6.29.0：关窗期谈成挂意向单；开窗后卖方确认才生成挂牌
  intent: '挂意向单',
  confirm: '确认挂牌',
};

// 仅当事件自己没带 note 时才用的补救句（note 是权威：有值一律直显原文，绝不重写系统句）
const SYS_FALLBACK: Record<string, string> = {
  accept: '挂牌已生成，等窗口收口',
  confirm: '挂牌已生成，等窗口收口',
  auto_accept: '名单自动同意：达线且自动同意开着',
  auto_reject: '名单自动拒：低于最低报价',
  reject: '冻结已退回买方',
  withdraw: '冻结已退回卖方',
  expire: '冻结已退回',
};

// 了结态的结果句：挂牌之后卖方没有任何动作（无下架端点），如实说明「等窗口收口」
const SETTLED_NOTE: Partial<Record<OfferStatus, string>> = {
  accepted: '挂牌已生成，你的价锁成领先出价；之后没有可操作的动作，等窗口收口（本版不加反悔通道）。',
  rejected: '已了结，冻结资金已退回报价方。',
  withdrawn: '已了结，冻结资金已退回报价方。',
  expired: '已了结，冻结资金已退回报价方。',
};

type OfferAction = 'counter' | 'accept' | 'reject' | 'withdraw';

function sysText(e: OfferEventRow): string {
  const label = EVENT_LABEL[e.kind] ?? e.kind;
  const price = e.amount === null ? '' : ` · ${moneyIntText(e.amount)}`;
  if (e.note) return `${label}${price} · ${e.note}`;
  const tail = SYS_FALLBACK[e.kind];
  return `${label}${price}${tail ? ` · ${tail}` : ''}`;
}

export default function OffersSection({
  box,
  status,
  onBoxChange,
  onStatusChange,
}: {
  box: 'in' | 'out';
  status: 'pending' | 'all';
  onBoxChange: (next: 'in' | 'out') => void;
  onStatusChange: (next: 'pending' | 'all') => void;
}) {
  const { show, toastNode } = useToast();
  const { time, dateTimeSec } = useTimeFmt();
  const qc = useQueryClient();
  const invalidateOffers = useOffersInvalidation();
  const cards = useMediaQuery(CARDS_QUERY);

  const list = useOffers(box, status, true);
  const [params] = useSearchParams();
  // v6.40.0：站内信深链的目标单号（?offer=<id>）。详情按 id 取，因此即便该单不在当前这一页
  // 列表里（被页签/筛选挡下，或属于更早的 50 条）也能展开谈判桌——只有行高亮与滚动需要行在场。
  const offerParam = Number(params.get('offer'));
  const targetOfferId = Number.isInteger(offerParam) && offerParam > 0 ? offerParam : null;
  const [openId, setOpenId] = useState<number | null>(targetOfferId);
  const detail = useOfferDetail(openId, true);
  const [counterDraft, setCounterDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  // 两段式确认的目标动作（拒绝 / 放弃 / 撤回）：点在就地确认条上才真发请求
  const [confirming, setConfirming] = useState<OfferAction | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const lastFilter = useRef<string | null>(null);

  const detailData = detail.data ?? null;
  const deskOffer = detailData?.offer ?? null;
  // 底价只有卖方视角读得到（GET /api/players/:id/offer-settings 只回本队教练）；买方只认公开标价
  const settingsPlayerId = deskOffer && deskOffer.role === 'seller' ? deskOffer.player.id : 0;
  const settings = useOfferSettings(settingsPlayerId, settingsPlayerId > 0);

  // 切换页签/筛选时收起谈判桌（旧页在 switchBox / switchStatus 里同步做，这里随受控入参走）。
  // 首跑不收起：那是深链播种的 openId，收起就把 ?offer= 落点丢了。判据用「筛选键前值」而非
  // 「跑过几次」——StrictMode 下 dev 会双跑 mount effect，计数式首跑跳过会被第二次当成切换。
  useEffect(() => {
    const key = `${box}|${status}`;
    if (lastFilter.current === key) return;
    const first = lastFilter.current === null;
    lastFilter.current = key;
    if (!first) setOpenId(null);
  }, [box, status]);

  // 目标行在场时滚到它（jsdom 没有 scrollIntoView，守卫写法照 MarketActivationPage 的先例）
  useEffect(() => {
    if (targetOfferId === null || openId !== targetOfferId) return;
    const el = rowRefs.current.get(targetOfferId);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [targetOfferId, openId, list.data, cards]);

  // 换单 / 关桌时把草稿与确认条复位，免得一单的输入漏到下一单
  useEffect(() => {
    setCounterDraft('');
    setNoteDraft('');
    setConfirming(null);
  }, [openId]);

  const items = list.data?.items ?? null;
  const pendingMine = list.data?.pendingMine ?? 0;
  // v6.29.0：我是卖方、等我确认挂牌（或放弃）的意向单条数
  const intentsMine = list.data?.intentsMine ?? 0;

  function switchBox(next: 'in' | 'out') {
    onBoxChange(next);
    setOpenId(null);
  }

  function switchStatus(next: 'pending' | 'all') {
    onStatusChange(next);
    setOpenId(null);
  }

  async function act(action: OfferAction) {
    const offer = deskOffer;
    if (!offer || busy) return;
    setBusy(true);
    try {
      if (action === 'counter') {
        const amount = Number(counterDraft);
        const note = noteDraft.trim();
        const r = await apiPost<{ ok: boolean; amount: number }>(`/api/offers/${offer.id}/counter`, { amount, note: note || null });
        show(`还价已送出：${moneyIntText(r.amount)}，等对方表态。`);
        setCounterDraft('');
        setNoteDraft('');
      } else {
        await apiPost(`/api/offers/${offer.id}/${action}`, {});
        // v6.29.0：意向单上 accept=卖方确认挂牌、reject=卖方放弃、withdraw=买方撤回，措辞与待回复单区分
        const onIntent = offer.status === 'intent';
        show(
          action === 'accept'
            ? onIntent
              ? '已确认，球员挂牌，你的价锁成领先出价。'
              : '已同意，球员自动挂牌，你的价锁成领先出价。'
            : action === 'reject'
              ? onIntent
                ? '已放弃意向，冻结已退回对方。'
                : '已拒绝，冻结已退回对方。'
              : onIntent
                ? '已撤回意向，冻结资金已退回。'
                : '已撤回，冻结资金已退回。',
        );
      }
      setConfirming(null);
      invalidateOffers();
      void qc.invalidateQueries({ queryKey: ['offers', 'detail'] });
    } catch (err) {
      show(err instanceof Error ? err.message : '操作失败', true);
    } finally {
      setBusy(false);
    }
  }

  // 一排可点开的「谈判桌」按钮：桌面表格行 / 窄屏卡片行共用同一份行数据与 openId
  const openButton = (o: OfferListItem) => (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      aria-expanded={openId === o.id}
      onClick={() => setOpenId(openId === o.id ? null : o.id)}
    >
      谈判桌
    </button>
  );

  const targetClass = (o: OfferListItem) => (targetOfferId === o.id && openId === o.id ? 'is-target' : undefined);

  const registerRow = (o: OfferListItem) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(o.id, el);
    else rowRefs.current.delete(o.id);
  };

  return (
    <section id="desk-offers" aria-label="报价">
      <h3>报价</h3>
      <p className="hint">
        私下议价：对别队真人球员送报价，双方轮流出价；点行尾<span className="mono">谈判桌</span>看整条对话。
        报价被接受 ≠ 成交：开窗期<span className="mono">同意</span>即自动挂牌并把报价方锁成领先出价；
        关窗期也可报价 / 还价 / 同意——但关窗期同意只挂「意向单」（不生成挂牌、资金继续冻结），
        开窗后由卖方确认才挂牌，买方随时可撤回、卖方放弃则冻结退回。
        报价即冻结资金，了结（成交 / 拒绝 / 撤回 / 放弃 / 过期）后自动退回。
        名单不产生自动行为：低于最低报价自动拒（与开关无关）；标价与「自动同意」开关同时满足才自动成交，否则进人工谈判。
      </p>
      {toastNode}

      <div className="seg" role="radiogroup" aria-label="报价页签">
        <button type="button" className={box === 'in' ? 'on' : ''} onClick={() => switchBox('in')}>
          我收到的{pendingMine > 0 && box === 'in' ? `（${pendingMine} 待处理）` : ''}
          {intentsMine > 0 ? `（${intentsMine} 待确认挂牌）` : ''}
        </button>
        <button type="button" className={box === 'out' ? 'on' : ''} onClick={() => switchBox('out')}>
          我送出的
        </button>
        <span style={{ width: 12 }} aria-hidden="true" />
        <button type="button" className={status === 'pending' ? 'on' : ''} onClick={() => switchStatus('pending')}>
          待处理
        </button>
        <button type="button" className={status === 'all' ? 'on' : ''} onClick={() => switchStatus('all')}>
          全部
        </button>
      </div>

      {targetOfferId !== null && openId === targetOfferId && items !== null && !items.some((o) => o.id === targetOfferId) && (
        <p className="banner warn" role="status">
          目标报价 <span className="mono">#{targetOfferId}</span> 不在当前列表里（可能被上面的页签/筛选挡下，或是更早的单子），已按单号打开谈判桌；可切「全部」或继续往后翻。
        </p>
      )}

      {list.isError && <div className="banner bad">{list.error instanceof Error ? list.error.message : '清单拉取失败'}</div>}
      {items === null && list.isPending && <p className="muted">正在翻报价夹…</p>}
      {items !== null && items.length === 0 && (
        <div className="card empty-state">
          <p className="muted">
            {box === 'in' ? '还没有收到的报价。挂到转会区、或把球员放进转会名单会更容易被盯上。' : '还没有送出的报价。去球员页对别队的球员点「报价」。'}
          </p>
        </div>
      )}

      {items !== null && items.length > 0 && cards && (
        <div className="mkt-desk-cards">
          {items.map((o) => {
            const badge = STATUS_BADGE[o.status];
            return (
              <div key={o.id} className={`mkt-desk-card${targetClass(o) ? ' is-target' : ''}`} data-offer-id={o.id} ref={registerRow(o)}>
                <div className="dc-top">
                  <Link to={playerPath(o.player)}>{o.player.name}</Link>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                </div>
                <div className="dc-mid">
                  <span className="dc-opp">{o.counterpart.name}</span>
                  {' · '}
                  <span className="mono dc-amount">{moneyIntText(o.amount)}</span>
                  <span className="muted mono">R{o.round}</span>
                  {o.status === 'pending' ? (
                    o.myTurn ? (
                      <span className="badge gold">待你表态</span>
                    ) : (
                      <span className="muted">等对方</span>
                    )
                  ) : o.status === 'intent' ? (
                    o.role === 'seller' ? (
                      <span className="badge gold">待卖方确认</span>
                    ) : (
                      <span className="muted">等对方确认</span>
                    )
                  ) : null}
                  {o.status === 'pending' && o.role === 'seller' && o.player.listPrice !== null && o.amount < o.player.listPrice && (
                    <span className="badge orange">砍价</span>
                  )}
                </div>
                <div className="dc-bot">
                  <span className="muted mono">{dateTimeSec(o.updatedAt)}</span>
                  {openButton(o)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items !== null && items.length > 0 && !cards && (
        <section className="card admin-section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>{box === 'in' ? '买方' : '卖家'}</th>
                  <th className="num">当前价</th>
                  <th className="num">轮次</th>
                  <th>轮到谁</th>
                  <th>状态</th>
                  <th>最近动作</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const badge = STATUS_BADGE[o.status];
                  return (
                    <tr key={o.id} data-offer-id={o.id} className={targetClass(o)} ref={registerRow(o)}>
                      <td>
                        <Link to={playerPath(o.player)}>{o.player.name}</Link>
                      </td>
                      <td>{o.counterpart.name}</td>
                      <td className="num mono">
                        {moneyIntText(o.amount)}
                        {/* 砍价徽标（v6.33.0）：卖方视角、活单、报价低于对方公开标价时标出（标价本身公开，徽标不泄底线） */}
                        {o.status === 'pending' && o.role === 'seller' && o.player.listPrice !== null && o.amount < o.player.listPrice && (
                          <span className="badge orange">砍价</span>
                        )}
                      </td>
                      <td className="num mono">R{o.round}</td>
                      <td>
                        {o.status === 'pending' ? (
                          o.myTurn ? (
                            <span className="badge gold">待你表态</span>
                          ) : (
                            <span className="muted">等对方</span>
                          )
                        ) : o.status === 'intent' ? (
                          o.role === 'seller' ? (
                            <span className="badge gold">待卖方确认</span>
                          ) : (
                            <span className="muted">等对方确认</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="muted">{time(o.updatedAt)}</td>
                      <td>{openButton(o)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.data?.nextCursor && (
            <p className="muted">还有更早的单子没列出来（清单按最近动作排，只列 50 条；更早的用「全部」筛选往后翻）。</p>
          )}
        </section>
      )}

      {openId !== null && (
        <OfferDesk
          detail={detailData}
          settings={settings.data ?? null}
          loading={detail.isPending}
          error={detail.error instanceof Error ? detail.error.message : null}
          busy={busy}
          counterDraft={counterDraft}
          noteDraft={noteDraft}
          confirming={confirming}
          onCounterDraft={setCounterDraft}
          onNoteDraft={setNoteDraft}
          onConfirming={setConfirming}
          onAct={act}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

// 谈判桌浮层（v6.40.0 对话式）：单据头 / 事件流（唯一滚动区）/ 动作栏。
// 动作可用性只看 role 与 status（拒绝与轮次无关——R1：卖方 pending 任意轮次都能拒）。
// v6.40.1：越权那颗直接不渲染（拒绝只给卖方、撤回只给买方、意向单的同意只给卖方）——
// 置灰 + title 在触屏上读不出「为什么不能点」，留下的动作仍按轮次/状态置灰并把理由写进 title。
function OfferDesk({
  detail,
  settings,
  loading,
  error,
  busy,
  counterDraft,
  noteDraft,
  confirming,
  onCounterDraft,
  onNoteDraft,
  onConfirming,
  onAct,
  onClose,
}: {
  detail: OfferDetailResponse | null;
  settings: OfferSettingsDto | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  counterDraft: string;
  noteDraft: string;
  confirming: OfferAction | null;
  onCounterDraft: (v: string) => void;
  onNoteDraft: (v: string) => void;
  onConfirming: (v: OfferAction | null) => void;
  onAct: (action: OfferAction) => Promise<void>;
  onClose: () => void;
}) {
  const { dateTimeSec } = useTimeFmt();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { narrow, panelRef, onCloseRef } = useOverlayShell(onClose, closeRef);

  const offer = detail?.offer ?? null;
  const events = detail?.events ?? [];
  const pending = offer?.status === 'pending';
  const intent = offer?.status === 'intent';
  const settled = offer !== null && !pending && !intent;
  const seller = offer?.role === 'seller';
  const buyer = offer?.role === 'buyer';
  const myTurn = offer?.myTurn === true;

  // 动作矩阵（v6.40.1）：还价/同意要轮到我；拒绝=卖方（待回复单拒绝 / 意向单放弃）；撤回=买方（撤回 / 撤回意向）
  const canCounter = pending && myTurn;
  const canAccept = (pending && myTurn) || (intent && seller);
  const canReject = seller && (pending || intent);
  const canWithdraw = buyer && (pending || intent);
  // 渲染门：越权那颗不渲染（买方在意向单态没有「同意」，卖方没有「撤回」）
  const showAccept = !intent || seller;

  const counterValue = Number(counterDraft);
  const counterOk = Number.isInteger(counterValue) && counterValue > (offer?.amount ?? 0);

  const reason = (ok: boolean, why: string) => (ok ? undefined : why);
  const counterWhy = settled ? '这一单已经了结' : intent ? '意向单已谈成，等开窗后确认挂牌' : '还没轮到你，等对方表态';
  const acceptWhy = settled ? '这一单已经了结' : '还没轮到你，等对方表态';

  // 名单规则行：只在球员还在转会名单里时出现（不在名单就不留空行）；卖方多打一枪设置端点读底价
  const listed = offer ? (seller ? (settings?.transferListed ?? offer.player.listPrice !== null) : offer.player.listPrice !== null) : false;

  return createPortal(
    <div className={narrow ? 'mkt-ov mkt-ov-drawer' : 'mkt-ov'} onClick={() => onCloseRef.current()} role="presentation">
      <div
        className="mkt-ov-panel nego-panel"
        role="dialog"
        aria-modal="true"
        aria-label={offer ? `谈判桌 · ${offer.player.name}` : '谈判桌'}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        {narrow && <div className="mkt-ov-grab" aria-hidden="true" />}
        {loading && (
          <div className="nego-head">
            <p className="muted">正在摊开谈判桌…</p>
          </div>
        )}
        {!loading && (error !== null || offer === null) && (
          <div className="nego-head">
            <div className="banner bad">{error ?? '这条报价看不到了'}</div>
          </div>
        )}

        {offer && (
          <>
            <div className="nego-head">
              <div className="nego-head-top">
                <h3 className="nego-title">
                  <Link to={playerPath(offer.player)}>{offer.player.name}</Link>
                  <span className={`badge ${STATUS_BADGE[offer.status].cls}`}>{STATUS_BADGE[offer.status].label}</span>
                  {offer.listingId !== null && <span className="badge green">已挂牌 #{offer.listingId}</span>}
                </h3>
                <button className="mkt-ov-x" type="button" aria-label="关闭谈判桌" ref={closeRef} onClick={onClose}>
                  ✕
                </button>
              </div>
              <p className="nego-line">
                <span className="attr-name">当前有效价</span> <b className="mono">{moneyIntText(offer.amount)}</b>
                <span className="muted">
                  （首报 {moneyIntText(offer.initAmount)} · R{offer.round}）
                </span>
              </p>
              <p className="nego-line">
                <span className="attr-name">买方</span> <span>{offer.buyerClub.name}</span>
                <span className="attr-name">卖家</span> <span>{offer.sellerClub.name}</span>
                <span className="attr-name">轮到谁</span>
                <span>{pending ? (myTurn ? '你' : '对方') : '—'}</span>
              </p>
              {listed && (
                <p className="nego-rule">
                  转会名单：标价 <span className="mono">{moneyIntText(offer.player.listPrice)}</span>
                  {seller && (
                    <>
                      {' '}
                      · 最低报价 <span className="mono">{settings ? (settings.minOfferPrice === null ? '未设' : moneyIntText(settings.minOfferPrice)) : '设置锁定'}</span>
                    </>
                  )}
                  {seller && <> · 自动同意 {settings ? (settings.offerAuto ? '开' : '关') : '—'}</>}
                  <br />
                  名单不产生自动行为：低于最低报价自动拒（与开关无关）；标价与「自动同意」开关同时满足才自动成交，否则进人工谈判。
                </p>
              )}
              {intent && (
                <p className="nego-note">
                  关窗期双方已谈成，先挂意向单：不生成挂牌、资金继续冻结。开窗后由卖方确认才生成挂牌；买方随时可撤回，卖方放弃则冻结退回。
                </p>
              )}
              {settled && <p className="nego-settled">{SETTLED_NOTE[offer.status]}</p>}
            </div>

            <div className="nego-stream">
              {events.length === 0 && <p className="nego-empty">这一单还没有事件记录。</p>}
              {events.map((e, i) => {
                const speaking = e.kind === 'open' || e.kind === 'counter';
                if (!speaking) {
                  return (
                    <div className="nego-sys" key={i}>
                      <span className="nego-sys-main">{sysText(e)}</span>
                      <span className="nego-sys-at mono">{dateTimeSec(e.at)}</span>
                    </div>
                  );
                }
                const mine = e.actor !== null && e.actor.id === (seller ? offer.sellerClub.id : offer.buyerClub.id);
                return (
                  <div className={`nego-b ${mine ? 'me' : 'them'}`} key={i}>
                    <p className="nego-b-who">
                      {e.actor?.name ?? '系统'} · {EVENT_LABEL[e.kind] ?? e.kind}
                    </p>
                    {e.amount !== null && <p className="nego-b-main mono">{moneyIntText(e.amount)}</p>}
                    {e.note && <p className="nego-b-note">{e.note}</p>}
                    <p className="nego-b-at mono">{dateTimeSec(e.at)}</p>
                  </div>
                );
              })}
            </div>

            <div className="nego-bar">
              {confirming !== null && (
                <div className="nego-confirm" role="alert">
                  <span>
                    {confirming === 'reject'
                      ? `确认${intent ? '放弃这张意向单' : '拒绝这份报价'}？`
                      : `确认${intent ? '撤回这张意向单' : '撤回报价'}？`}
                    冻结的 {moneyIntText(offer.amount)} 将退回买方。
                  </span>
                  <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void onAct(confirming)}>
                    确认{confirming === 'reject' ? (intent ? '放弃' : '拒绝') : intent ? '撤回意向' : '撤回'}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onConfirming(null)}>
                    再想想
                  </button>
                </div>
              )}

              <div className="nego-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !canCounter || !counterOk}
                  title={reason(canCounter, counterWhy)}
                  onClick={() => void onAct('counter')}
                >
                  还价
                </button>
                {showAccept && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !canAccept}
                    title={reason(canAccept, acceptWhy)}
                    onClick={() => void onAct('accept')}
                  >
                    {intent ? `挂意向单（${moneyIntText(offer.amount)}）` : `同意并挂牌（${moneyIntText(offer.amount)}）`}
                  </button>
                )}
                {seller && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy || !canReject}
                    title={reason(canReject, '这一单已经了结')}
                    onClick={() => onConfirming('reject')}
                  >
                    {intent ? '放弃' : '拒绝'}
                  </button>
                )}
                {buyer && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !canWithdraw}
                    title={reason(canWithdraw, '这一单已经了结')}
                    onClick={() => onConfirming('withdraw')}
                  >
                    {intent ? '撤回意向' : '撤回报价'}
                  </button>
                )}
              </div>

              {canCounter && (
                <div className="nego-fields">
                  <label className="field">
                    <span>还价（m，整数，须高于当前价 {moneyIntText(offer.amount)}）</span>
                    <input
                      className="mono"
                      inputMode="numeric"
                      placeholder={String(Math.floor(offer.amount) + 1)}
                      value={counterDraft}
                      onChange={(e) => onCounterDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                    />
                  </label>
                  <label className="field">
                    <span>附言（可选，100 字内）</span>
                    <input value={noteDraft} maxLength={100} placeholder="给对方的一句话" onChange={(e) => onNoteDraft(e.target.value)} />
                  </label>
                </div>
              )}

              {pending && !myTurn && <p className="nego-reason">还没轮到你，等对方表态。</p>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
