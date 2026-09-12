// 转会市场（增量 3 + 激活切片）：挂牌板（卡柜）+ 单卡详情与出价历史 + 我的出价（冻结章）
// + 挂牌表单 + 激活别队训练营球员（规则 4.4.2）。
// 家族口径：mono 数字、口语化文案、操作 toast 反馈、两段式 busy 态。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  api,
  apiPost,
  type ActivatableTrainee,
  type ActivationResult,
  type MarketListing,
  type MarketListingDetail,
  type MarketListings,
  type MyBidRow,
  type SquadOverview,
  type TraineesResponse,
} from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';

type ListingFilter = 'active' | 'pending_review' | 'ended' | 'all';

const FILTER_LABEL: Record<ListingFilter, string> = {
  active: '在挂',
  pending_review: '待审核',
  ended: '已结束',
  all: '全部',
};

const LISTING_STATUS_LABEL: Record<string, string> = {
  listed: '挂牌中',
  bidding: '竞价中',
  pending_review: '待审核',
  delisted: '已下架',
};

const LISTING_STATUS_BADGE: Record<string, string> = {
  listed: 'sky',
  bidding: 'gold',
  pending_review: 'purple',
  delisted: 'gray',
};

const BID_STATUS_LABEL: Record<string, string> = {
  active: '领先中',
  superseded: '被超出',
  withdrawn: '已撤下',
  won: '成交',
};

function money(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : x.toFixed(2);
}

function deadlineText(iso: string | null, suffix = ' 判定'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${suffix}`;
}

export default function Market() {
  const { show, toastNode } = useToast();
  const [filter, setFilter] = useState<ListingFilter>('active');
  const [board, setBoard] = useState<MarketListings | null>(null);
  const [myClub, setMyClub] = useState<{ id: number; name: string; balance: number | null; isCoach: boolean } | null>(null);
  const [myBids, setMyBids] = useState<MyBidRow[] | null>(null);
  const [squad, setSquad] = useState<SquadOverview | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<MarketListingDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  const refreshBoard = useCallback(
    async (f: ListingFilter) => {
      try {
        const data = await api<MarketListings>(`/api/market/listings?status=${f}`);
        setBoard(data);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '市场打不开了，稍后再试');
      }
    },
    [],
  );

  const refreshMine = useCallback(async () => {
    try {
      const bids = await api<{ bids: MyBidRow[] }>('/api/me/bids');
      setMyBids(bids.bids);
    } catch {
      setMyBids(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ user: { role: string } | null }>('/api/me');
        const isCoach = me.user?.role === 'coach' || me.user?.role === 'admin';
        const overview = await api<{ club: { id: number; name: string } | null; balance: number | null }>('/api/me/club');
        setMyClub(overview.club ? { ...overview.club, balance: overview.balance, isCoach } : null);
        if (isCoach) {
          await refreshMine();
          const sq = await api<SquadOverview>('/api/club/squad');
          setSquad(sq);
        }
      } catch {
        // 未登录也能看挂牌板
      }
      await refreshBoard('active');
    })();
  }, [refreshBoard, refreshMine]);

  useEffect(() => {
    refreshBoard(filter);
  }, [filter, refreshBoard]);

  useEffect(() => {
    if (selected === null) {
      setDetail(null);
      return;
    }
    api<MarketListingDetail>(`/api/market/listings/${selected}`)
      .then(setDetail)
      .catch((err: unknown) => show(err instanceof Error ? err.message : '详情打不开了', true));
  }, [selected, show]);

  async function afterBidOrList() {
    await Promise.all([refreshBoard(filter), refreshMine(), selected !== null ? refreshDetail() : Promise.resolve()]);
  }

  async function refreshDetail() {
    if (selected === null) return;
    try {
      setDetail(await api<MarketListingDetail>(`/api/market/listings/${selected}`));
    } catch {
      /* 详情刷新失败静默，下一次点击会重新拉 */
    }
  }

  const heldTotal = useMemo(() => (myBids ?? []).filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0), [myBids]);
  const available = myClub?.balance !== null && myClub !== null ? (myClub.balance ?? 0) - heldTotal : null;

  return (
    <div className="container">
      <h1>转会市场</h1>
      {loadError && <div className="banner warn">{loadError}</div>}
      {toastNode}

      {myClub?.isCoach && (
        <ListSection squad={squad} onDone={(msg) => { show(msg); afterBidOrList(); }} onError={(m) => show(m, true)} />
      )}

      {myClub?.isCoach && (
        <ActivateSection onDone={(msg) => { show(msg); afterBidOrList(); }} onError={(m) => show(m, true)} />
      )}

      <section className="card">
        <h3>挂牌板</h3>
        <div className="seg" role="radiogroup" aria-label="按状态筛选挂牌">
          {(Object.keys(FILTER_LABEL) as ListingFilter[]).map((f) => (
            <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {board === null ? (
          <p className="muted">正在翻卡柜…</p>
        ) : board.listings.length === 0 ? (
          <div className="empty-state">
            <p className="muted">
              {filter === 'active' ? '还没有挂牌。窗口开了之后，这里就是市场。' : '这一栏暂时没有单子。'}
            </p>
          </div>
        ) : (
          <div className="market-grid">
            {board.listings.map((l) => (
              <MarketCard
                key={l.id}
                listing={l}
                mine={myClub?.id === l.sellerClub.id}
                selected={selected === l.id}
                onSelect={() => setSelected(selected === l.id ? null : l.id)}
              />
            ))}
          </div>
        )}
      </section>

      {detail && (
        <DetailSection
          detail={detail}
          myClub={myClub}
          available={available}
          onBid={async (amount) => {
            try {
              const res = await apiPost<{ ok: boolean }>(`/api/market/listings/${detail.listing.id}/bids`, { amount });
              if (res.ok) show(`出价 ${money(amount)} m 已提交，资金冻结中。`);
              await afterBidOrList();
            } catch (err) {
              show(err instanceof Error ? err.message : '出价失败', true);
            }
          }}
        />
      )}

      {myClub?.isCoach && myBids !== null && (
        <MyBidsSection bids={myBids} available={available} balance={myClub.balance} />
      )}
    </div>
  );
}

/* ---------- 挂牌表单（教练） ---------- */

function ListSection({
  squad,
  onDone,
  onError,
}: {
  squad: SquadOverview | null;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [playerId, setPlayerId] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const listable = useMemo(
    () => (squad?.players ?? []).filter((p) => p.status === 'normal' && p.hasContract && (p.releaseFee ?? 0) > 0),
    [squad],
  );
  const chosen = listable.find((p) => String(p.id) === playerId) ?? null;
  // 与规则 4.4.1.1 同式：下限 min(0.5RC, 0.5身价) 与 1m 取高；上限 1.5RC
  const bounds = useMemo(() => {
    if (!chosen) return null;
    const rc = chosen.releaseFee ?? 0;
    const floors = [rc * 0.5, chosen.marketValue !== null ? chosen.marketValue * 0.5 : Number.POSITIVE_INFINITY];
    return { min: Math.max(1, Math.min(...floors)), max: rc * 1.5 };
  }, [chosen]);

  async function submit() {
    if (busy || !chosen) return;
    setBusy(true);
    try {
      await apiPost<{ listingId: number; min: number; max: number }>('/api/market/listings', {
        playerId: chosen.id,
        askPrice: Number(price),
      });
      onDone(`挂牌成功：${chosen.name} 挂 ${Number(price).toFixed(2)} m，等大家来出价。`);
      setPlayerId('');
      setPrice('');
    } catch (err) {
      onError(err instanceof Error ? err.message : '挂牌失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-section">
      <h3>挂牌我的球员</h3>
      {squad === null ? (
        <p className="muted">名单还没加载出来…</p>
      ) : listable.length === 0 ? (
        <p className="muted">队里暂时没有能挂的球员（要正式合同且带违约金）。等管理组导入合同后再来。</p>
      ) : (
        <div className="inline-form">
          <div className="field grow">
            <label htmlFor="list-player">球员</label>
            <select id="list-player" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              <option value="">选一名球员…</option>
              {listable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（RC {(p.releaseFee ?? 0).toFixed(2)} m）
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="list-price">挂牌价（m）</label>
            <input
              id="list-price"
              className="mono"
              type="number"
              min="0"
              step="0.5"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={bounds ? `${bounds.min}` : ''}
            />
          </div>
          <button className="btn" type="button" disabled={busy || !chosen || price === ''} onClick={submit}>
            {busy ? '挂牌中…' : '挂出去'}
          </button>
        </div>
      )}
      {chosen && bounds && (
        <p className="hint">
          规则价：下限 {bounds.min.toFixed(2)} m（违约金/身价五折取低，不低于 1m）、上限 {bounds.max.toFixed(2)} m（违约金 1.5 倍）。
        </p>
      )}
      <p className="hint">训练营里的孩子不能自己挂出去——他们只能被别队激活带走（见下方「激活训练营球员」）。</p>
    </section>
  );
}

/* ---------- 激活别队训练营球员（规则 4.4.2） ---------- */

function ActivateSection({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [data, setData] = useState<TraineesResponse | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    api<TraineesResponse>('/api/market/trainees')
      .then(setData)
      .catch(() => setData(null));
  }, []);

  async function activate(t: ActivatableTrainee) {
    if (busyId !== null) return;
    setBusyId(t.id);
    try {
      const res = await apiPost<ActivationResult>('/api/market/activations', { playerId: t.id });
      onDone(
        `已激活 ${t.name}：挂牌 ${res.askPrice.toFixed(2)} m。你要在 ${deadlineText(res.firstBidDeadline, '')} 前落首价，逾期激活作废（还占本窗激活额度）。`,
      );
      setData(await api<TraineesResponse>('/api/market/trainees'));
    } catch (err) {
      onError(err instanceof Error ? err.message : '激活失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card admin-section">
      <h3>激活训练营球员</h3>
      {data === null ? (
        <p className="muted">训练营名单还没加载出来…</p>
      ) : data.trainees.length === 0 ? (
        <p className="hint">
          别家训练营暂时没有可激活的小将。训练营球员不能自行挂牌，只能走激活转会：激活后按固定{' '}
          <span className="mono">5.00</span> m 强制挂牌，激活方须在 5 分钟内落首价（期间别队出价无效），此后大家正常竞价。
        </p>
      ) : (
        <>
          <p className="hint">
            激活按固定 <span className="mono">5.00</span> m 强制挂牌（规则 4.4.2.3）。激活后你要在 5 分钟内落首价，期间别队出价无效；
            逾期激活作废，且同一球员一个窗口只能被激活一次。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>球员</th>
                  <th>所属俱乐部</th>
                  <th className="num">年龄</th>
                  <th className="num">CA / PA</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.trainees.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/players/${t.id}`}>{t.name}</Link>
                    </td>
                    <td>{t.club.name}</td>
                    <td className="num mono">{t.age ?? '—'}</td>
                    <td className="num mono">
                      {t.ca ?? '—'} / {t.pa ?? '—'}
                    </td>
                    <td>
                      {t.activatedThisWindow ? (
                        <span className="stamp-inline">本窗已激活</span>
                      ) : (
                        <button className="btn btn-sm" type="button" disabled={busyId !== null} onClick={() => activate(t)}>
                          {busyId === t.id ? '激活中…' : '激活（5m）'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- 卡柜单卡 ---------- */

function MarketCard({
  listing,
  mine,
  selected,
  onSelect,
}: {
  listing: MarketListing;
  mine: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`market-card${selected ? ' on' : ''}${mine ? ' mine' : ''}`} onClick={onSelect}>
      <div className="market-card-head">
        <Link to={`/players/${listing.player.id}`} onClick={(e) => e.stopPropagation()}>
          {listing.player.name}
        </Link>
        <span className="badge-stack">
          {listing.type === 'activation' && <span className="badge purple">激活</span>}
          <span className={`badge ${LISTING_STATUS_BADGE[listing.status] ?? 'gray'}`}>
            {LISTING_STATUS_LABEL[listing.status] ?? listing.status}
          </span>
        </span>
      </div>
      <div className="market-card-sub">
        {listing.player.position ?? '—'} · CA <span className="mono">{listing.player.ca ?? '—'}</span> · PA{' '}
        <span className="mono">{listing.player.pa ?? '—'}</span>
      </div>
      <div className="market-card-price">
        <span className="stat-label">{listing.type === 'activation' ? '激活价' : '挂牌价'}</span>
        <span className="mono">{money(listing.askPrice)} m</span>
      </div>
      <div className="market-card-price">
        <span className="stat-label">当前最高</span>
        <span className="mono gold-text">{money(listing.highestBid)} m</span>
      </div>
      <div className="market-card-foot">
        <span>
          {listing.firstBidPending
            ? '等激活方落首价'
            : listing.bidCount > 0
              ? `${listing.bidCount} 次出价`
              : '还没人出价'}
        </span>
        {listing.firstBidPending ? (
          <span className="mono">{deadlineText(listing.activationDeadline, '')} 前须落价</span>
        ) : (
          listing.status === 'bidding' && <span className="mono">{deadlineText(listing.deadlineAt)}</span>
        )}
      </div>
      <div className="market-card-club">{listing.sellerClub.name}</div>
    </button>
  );
}

/* ---------- 详情 + 出价历史 + 出价表单 ---------- */

function DetailSection({
  detail,
  myClub,
  available,
  onBid,
}: {
  detail: MarketListingDetail;
  myClub: { id: number; name: string; isCoach: boolean } | null;
  available: number | null;
  onBid: (amount: number) => Promise<void>;
}) {
  const l = detail.listing;
  const [amount, setAmount] = useState<string>(String(l.nextMinBid));
  const [busy, setBusy] = useState(false);
  const isActivator = myClub !== null && l.activatedBy === myClub.id;
  const baseCanBid =
    myClub !== null && myClub.isCoach && myClub.id !== l.sellerClub.id && (l.status === 'listed' || l.status === 'bidding') && l.windowOpen;
  // 激活首价窗：只有激活方能落价，且金额固定为挂牌价
  const canBid = baseCanBid && !(l.firstBidPending && !isActivator);
  const bidHint = !l.windowOpen
    ? '这单所属的转会窗口已经关了。'
    : l.status === 'pending_review'
      ? '这单已截止，正在等管理组审核。'
      : l.status === 'delisted'
        ? '这单已经下架。'
        : myClub?.id === l.sellerClub.id
          ? '自家的挂牌，等别人来出价。'
          : l.firstBidPending && !isActivator
            ? `激活首价窗内只有 ${l.activatorName ?? '激活方'} 可以出价（${deadlineText(l.activationDeadline, '')} 前须落价）。`
            : null;

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onBid(l.firstBidPending && isActivator ? l.askPrice : Number(amount));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>
        {l.player.name} · 挂牌详情
        {l.type === 'activation' && <span className="badge purple">激活</span>}
        <span className={`badge ${LISTING_STATUS_BADGE[l.status] ?? 'gray'}`}>{LISTING_STATUS_LABEL[l.status] ?? l.status}</span>
      </h3>
      <p className="hint">
        卖方 {l.sellerClub.name} · {l.type === 'activation' ? `激活价 ${money(l.askPrice)} m（${l.activatorName ?? '激活方'} 发起）` : `挂牌价 ${money(l.askPrice)} m`} ·
        违约金 {money(l.releaseFee)} m ·{' '}
        {l.firstBidPending
          ? <>激活首价窗 <span className="mono">{deadlineText(l.activationDeadline, '')}</span> 前须落价</>
          : l.status === 'bidding'
            ? <>截止判定 <span className="mono">{deadlineText(l.deadlineAt)}</span></>
            : (l.deadlineNote ?? '尚未进入竞价')}
      </p>
      {l.type === 'activation' && (
        <p className="hint">
          激活转会的孩子仍持训练营合同（固定 0.75m / 违约金 5m），过户后照旧在买方训练营。
        </p>
      )}
      {bidHint && <p className="hint">{bidHint}</p>}

      {canBid && l.firstBidPending && isActivator && (
        <div className="inline-form">
          <button className="btn" type="button" disabled={busy} onClick={submit}>
            {busy ? '出价中…' : `落激活首价（${money(l.askPrice)} m）`}
          </button>
          <span className="hint">
            激活金额固定，出价即冻结；{deadlineText(l.activationDeadline, '')} 前不落价，激活作废还占本窗额度。
          </span>
        </div>
      )}

      {canBid && !l.firstBidPending && (
        <div className="inline-form">
          <div className="field">
            <label htmlFor="bid-amount">出价（m）</label>
            <input
              id="bid-amount"
              className="mono"
              type="number"
              min={l.nextMinBid}
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button className="btn" type="button" disabled={busy || Number(amount) < l.nextMinBid} onClick={submit}>
            {busy ? '出价中…' : `出价（至少 ${l.nextMinBid.toFixed(2)} m）`}
          </button>
          <span className="hint">
            出价即冻结资金{available !== null ? <>，当前可支配 {money(available)} m</> : null}。
          </span>
        </div>
      )}

      <h4>出价历史</h4>
      {detail.bids.length === 0 ? (
        <p className="muted">还没有出价记录。第一口价就是挂牌价起。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>出价方</th>
                <th className="num">金额（m）</th>
                <th>时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {detail.bids.map((b) => (
                <tr key={b.id}>
                  <td>{b.clubName}</td>
                  <td className="num mono">{money(b.amount)}</td>
                  <td className="mono">{b.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <span className={`badge ${b.status === 'active' ? 'sky' : b.status === 'won' ? 'gold' : 'gray'}`}>
                      {BID_STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- 我的出价 ---------- */

function MyBidsSection({ bids, available, balance }: { bids: MyBidRow[]; available: number | null; balance: number | null }) {
  if (bids.length === 0) return null;
  return (
    <section className="card">
      <h3>我的出价</h3>
      <p className="hint">
        账户余额 {money(balance)} m，冻结中 {money(bids.filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0))} m，
        可支配 {money(available)} m。出价即冻结，被超出或落选自动解冻。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>球员</th>
              <th>卖方</th>
              <th className="num">我的出价（m）</th>
              <th>出价状态</th>
              <th>资金</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link to={`/players/${b.player.id}`}>{b.player.name}</Link>
                </td>
                <td>{b.sellerClubName}</td>
                <td className="num mono">{money(b.amount)}</td>
                <td>
                  <span className={`badge ${b.status === 'active' ? 'sky' : b.status === 'won' ? 'gold' : 'gray'}`}>
                    {BID_STATUS_LABEL[b.status] ?? b.status}
                  </span>
                </td>
                <td>
                  {b.holdStatus === 'held' && <span className="stamp stamp-hold stamp-inline">冻结中</span>}
                  {b.holdStatus === 'released' && <span className="stamp-inline stamp-inline-ok">已解冻</span>}
                  {b.holdStatus === 'settled' && <span className="stamp stamp-hold stamp-inline">已划转</span>}
                  {b.holdStatus === null && <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
