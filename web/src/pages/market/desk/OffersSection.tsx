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
// v6.40.2：开桌提速——列表行播种（列表那条单拼成占位详情，单据头点开即读，不再空等一趟详情）+
//   悬停/聚焦预取详情 + 事件流「正在读取谈判记录…」占位（原先会误显示「还没有事件记录」）；
//   底价设置请求随播种同帧有 playerId，与详情并行发出（原先串行等详情回来才发）。
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiPost,
  type OfferDetailResponse,
  type OfferEventRow,
  type OfferSettingsDto,
  type OfferStatus,
  type OffersListResponse,
} from '../../../lib/api.ts';
import { playerPath } from '../../../lib/player-link.ts';
import { IdTag } from '../../../components/IdTag.tsx';
import ActivationProofButton from '../ActivationProofButton.tsx';
import { moneyIntText } from '../../../lib/club-cards.ts';
import { money } from '../../market/shared.tsx';
import { creditUse } from '../../../lib/credit-line.ts';
import { useOverlayShell } from '../../../lib/use-overlay-shell.ts';
import {
  offerDetailQuery,
  useClubBalance,
  useOfferDetail,
  useOfferSettings,
  useOffers,
  useOffersInvalidation,
} from '../../../lib/queries.ts';
import { useToast } from '../../../lib/toast.tsx';
import { useTimeFmt } from '../../../lib/datetime.ts';
import DeskPlayerRow from './DeskPlayerRow.tsx';
import { groupOffersByPlayer, type OfferPlayerRow } from './desk-rows.ts';
import { offerBadge } from './status.ts';

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

// v6.40.2：列表行 → 占位详情，供谈判桌开桌即读（详情那一趟往返还没回来也能看单据头）。
// 字段口径与 GET /api/offers/:id 的 offer 对齐：buyerClub / sellerClub 按 role 分配（我是买方 ⇒ 本队为买方，
// 对方为卖方）；season / windowSeq / resolvedAt 谈判桌从不读，置 0 / 0 / null；events 置空，
// 由 eventsLoading 显示「正在读取谈判记录…」，不冒充「还没有事件记录」。
// 该单不在当前列表里（深链到更早的单）时返回 null，浮层照旧等详情。
function seedFromList(data: OffersListResponse | undefined, id: number | null): OfferDetailResponse | null {
  if (id === null || !data) return null;
  const row = data.items.find((o) => o.id === id);
  if (!row) return null;
  const mine = { id: data.club.id, name: data.club.name };
  const other = { id: row.counterpart.id, name: row.counterpart.name };
  return {
    offer: {
      ...row,
      buyerClub: row.role === 'buyer' ? mine : other,
      sellerClub: row.role === 'seller' ? mine : other,
      season: 0,
      windowSeq: 0,
      resolvedAt: null,
    },
    events: [],
  };
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
  const qc = useQueryClient();
  const invalidateOffers = useOffersInvalidation();

  const list = useOffers(box, status, true);
  const [params] = useSearchParams();
  // v6.40.0：站内信深链的目标单号（?offer=<id>）。详情按 id 取，因此即便该单不在当前这一页
  // 列表里（被页签/筛选挡下，或属于更早的 50 条）也能展开谈判桌——只有行高亮与滚动需要行在场。
  const offerParam = Number(params.get('offer'));
  const targetOfferId = Number.isInteger(offerParam) && offerParam > 0 ? offerParam : null;
  const [openId, setOpenId] = useState<number | null>(targetOfferId);
  // v6.40.2：当前列表里有这一行就先播种成占位详情——单据头点开即读，不等详情那一趟往返
  const seed = seedFromList(list.data, openId);
  const detail = useOfferDetail(openId, true, seed);
  const [counterDraft, setCounterDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  // 两段式确认的目标动作（拒绝 / 放弃 / 撤回）：点在就地确认条上才真发请求
  const [confirming, setConfirming] = useState<OfferAction | null>(null);
  const [busy, setBusy] = useState(false);
  // 行内历史是独立开关；开「谈判桌」不等于展开行（窄屏抽屉与浮层叠在一起会互相抢焦点）
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const lastFilter = useRef<string | null>(null);

  const detailData = detail.data ?? null;
  const deskOffer = detailData?.offer ?? null;
  // 底价只有卖方视角读得到（GET /api/players/:id/offer-settings 只回本队教练）；买方只认公开标价
  const settingsPlayerId = deskOffer && deskOffer.role === 'seller' ? deskOffer.player.id : 0;
  const settings = useOfferSettings(settingsPlayerId, settingsPlayerId > 0);
  // v6.40.2：事件流还没到（详情在飞、手上只有播种的空事件表）——事件区显示占位文案，不冒充「没有事件记录」
  const eventsLoading = detail.isFetching && (detail.data?.events.length ?? 0) === 0;

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
    const el = document.querySelector(`[data-offer-id="${targetOfferId}"]`) as HTMLElement | null;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [targetOfferId, openId, list.data]);

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
  // v6.55.0 意向单多笔并存：同球员挂了多条意向单（卖方视角本页可见）时提示择一，单条不提示。
  // 买方视角 box=out 里自己的意向单受买方级唯一约束，天然不会 >1，无需再按角色过滤。
  const intentCountByPlayer = new Map<number, number>();
  for (const o of items ?? []) {
    if (o.status === 'intent') intentCountByPlayer.set(o.player.id, (intentCountByPlayer.get(o.player.id) ?? 0) + 1);
  }
  const multiIntentHint = [...intentCountByPlayer.values()].some((n) => n > 1);

  function switchBox(next: 'in' | 'out') {
    onBoxChange(next);
    setOpenId(null);
    setExpandedRows(new Set<number>());
  }

  function switchStatus(next: 'pending' | 'all') {
    onStatusChange(next);
    setOpenId(null);
    setExpandedRows(new Set<number>());
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

  // v6.40.2：悬停 / 聚焦就预取详情——真点开时多半已进缓存（全局 staleTime 30s），浮层只剩渲染
  const prefetchDesk = (id: number) => void qc.prefetchQuery(offerDetailQuery(id));
  const rows = items === null ? null : groupOffersByPlayer(items);

  function toggleRow(playerId: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function openOffer(id: number) {
    setOpenId((prev) => (prev === id ? null : id));
  }

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
      {multiIntentHint && (
        <p className="hint">
          有球员挂了多家求购意向同时待确认：确认一条后其余自动失效（其余买方会收到落选通知、冻结自动解冻）。
        </p>
      )}

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

      {rows !== null && rows.length > 0 && (
        <section className="card admin-section">
          <div className="desk-list">
            {rows.map((row) => {
              const openInRow = openId !== null && row.offers.some((o) => o.id === openId);
              const targetInRow = targetOfferId !== null && row.offers.some((o) => o.id === targetOfferId);
              const dataOfferId = targetInRow && targetOfferId !== null ? targetOfferId : row.current.id;
              const isTarget = targetInRow && openId === targetOfferId;
              const haggling =
                row.current.status === 'pending' &&
                row.current.role === 'seller' &&
                row.current.player.listPrice !== null &&
                row.current.amount < row.current.player.listPrice;
              const intentTurn =
                row.current.status === 'intent'
                  ? row.current.role === 'seller'
                    ? '待卖方确认'
                    : '等对方确认'
                  : null;
              return (
                <DeskPlayerRow
                  key={row.player.id}
                  player={row.player}
                  meta={
                    <>
                      {row.current.counterpart.name} · R{row.current.round}
                      {row.offers.length > 1 ? ` · ${row.offers.length} 单` : ''}
                      {intentTurn && (
                        <>
                          {' '}
                          <span className="badge gold">{intentTurn}</span>
                        </>
                      )}
                    </>
                  }
                  amount={moneyIntText(row.amount) ?? '—'}
                  amountBadges={haggling ? <span className="badge orange">砍价</span> : undefined}
                  badge={row.badge}
                  action={{ ...row.action, label: '谈判桌' }}
                  onAction={() => openOffer(row.current.id)}
                  onActionHover={() => prefetchDesk(row.current.id)}
                  actionExpanded={openInRow}
                  expanded={expandedRows.has(row.player.id)}
                  onToggle={() => toggleRow(row.player.id)}
                  dataOfferId={dataOfferId}
                  rowClassName={isTarget ? 'is-target' : undefined}
                >
                  <OfferPlayerPanel
                    row={row}
                    openId={openId}
                    onOpen={(id) => {
                      setExpandedRows((prev) => {
                        const next = new Set(prev);
                        next.delete(row.player.id);
                        return next;
                      });
                      openOffer(id);
                    }}
                  />
                </DeskPlayerRow>
              );
            })}
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
          eventsLoading={eventsLoading}
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

function OfferPlayerPanel({
  row,
  openId,
  onOpen,
}: {
  row: OfferPlayerRow;
  openId: number | null;
  onOpen: (id: number) => void;
}) {
  const { dateTimeSec } = useTimeFmt();
  return (
    <>
      <div>
        <p className="desk-panel-title">这球员的报价</p>
        <ul className="desk-history">
          {row.offers.map((o) => {
            const badge = offerBadge(o);
            return (
              <li key={o.id} className={`desk-hist-row${o.id === row.current.id ? ' is-current' : ''}`}>
                <div className="desk-hist-main">
                  <span className="mono">{moneyIntText(o.amount)}</span>{' '}
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  <div className="desk-hist-sub">
                    {o.counterpart.name} · R{o.round} · {dateTimeSec(o.updatedAt)}
                  </div>
                </div>
                <span className="desk-hist-tag">
                  <IdTag kind="报价" value={o.id} />
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  aria-expanded={openId === o.id}
                  onClick={() => onOpen(o.id)}
                >
                  谈判桌
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="desk-panel-title">说明</p>
        <p className="hint">
          同一球员只占一行；行内列的是我和他之间的历史单。点「谈判桌」看整条对话，点行尾主按钮看当前这一单。
        </p>
      </div>
    </>
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
  eventsLoading,
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
  eventsLoading: boolean;
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

  // 动用额行（v6.57.0 设计 §2.3 弹层补齐）：买方还价 / 买方接受才产生资金动作（卖方还价不出钱、
  // 接受是收钱，拒绝/撤回是退款）。快照缺失（端点未回）creditUse 回 0，整行不渲染。
  const { data: balSnap } = useClubBalance(buyer);
  // 本人现行冻结 = 自己最后一次出价（事件流可查，与 topUpBuyerHold 读到的 holdRow.amount 同值；
  // 事件没到就不渲染接受行，不冒充「无旧冻结」——漏回加会把动用额算大一整个旧冻结）
  const myLastBid =
    buyer && offer
      ? ([...events]
          .reverse()
          .find((e) => (e.kind === 'open' || e.kind === 'counter') && e.actor?.id === offer.buyerClub.id && e.amount !== null)
          ?.amount ?? null)
      : null;
  // 还价：服务端预检口径 = 新价 ≤ 可支配 + 旧价冻结（myHeld = offer.amount），动用额同式回加
  const counterUse = buyer && canCounter && counterOk && balSnap ? creditUse(counterValue, balSnap, offer.amount) : 0;
  // 接受（买方补足冻结）：spend = 当前价、旧冻结回加本人最后一次出价
  const acceptUse =
    buyer && pending && myTurn && myLastBid !== null && balSnap ? creditUse(offer.amount, balSnap, myLastBid) : 0;

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
                  <span className={`badge ${offerBadge(offer).cls}`}>{offerBadge(offer).label}</span>
                  {/* v6.68.0 期 A：编号改成可复制（原来只有静态「已挂牌 #N」文本） */}
                  {offer.listingId !== null && (
                    <span className="badge green">
                      已挂牌 <IdTag kind="挂牌" value={offer.listingId} />
                    </span>
                  )}
                  <span className="muted">
                    报价 <IdTag kind="报价" value={offer.id} />
                  </span>
                  {/* v6.68.2：卖方能看这单的激活凭证（非激活单/无凭证时按钮自己隐藏） */}
                  {seller && offer.listingId !== null && <ActivationProofButton listingId={offer.listingId} />}
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
              {events.length === 0 && (
                <p className="nego-empty">
                  {eventsLoading ? '正在读取谈判记录…' : error !== null ? '谈判记录没读出来，重开一次可以再试。' : '这一单还没有事件记录。'}
                </p>
              )}
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

              {/* 动用预期收入行（设计 §2.3）：现金不够的部分由额度垫，>0 才渲染 */}
              {counterUse > 0 && (
                <p className="nego-reason credit-use-note">本次动用预期收入 {money(counterUse)} m（旧价冻结会被顶替释放）。</p>
              )}
              {acceptUse > 0 && (
                <p className="nego-reason credit-use-note">本次动用预期收入 {money(acceptUse)} m（接受时先补足冻结到 {moneyIntText(offer.amount)}）。</p>
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
