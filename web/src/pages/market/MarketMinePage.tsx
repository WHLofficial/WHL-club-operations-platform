// 我的 /market/mine（增量 16 拆页）：挂牌我的球员（原 ListSection）+ 我的出价（原 MyBidsSection）。
// 需登录（路由守卫），操作要教练账号；数据层 TanStack Query（lib/queries.ts）。
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { apiPost, type MyBidRow, type SquadOverview } from '../../lib/api.ts';
import { useMarketInvalidation, useMyBids, useMyClub, useSquad } from '../../lib/queries.ts';
import { useToast } from '../../lib/toast.tsx';
import { playerPath } from '../../lib/player-link.ts';
import { BID_STATUS_LABEL, MarketNav, money } from './shared.tsx';

export default function MarketMinePage() {
  const { show, toastNode } = useToast();
  const { loading, isCoach, club: myClub } = useMyClub();
  const { bids: myBids, refresh: refreshMine } = useMyBids(isCoach);
  const squad = useSquad(isCoach);
  const invalidateMarket = useMarketInvalidation();

  const heldTotal = useMemo(() => (myBids ?? []).filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0), [myBids]);
  const available = myClub?.balance !== null && myClub !== null ? (myClub.balance ?? 0) - heldTotal : null;

  return (
    <div className="container">
      <h1>转会市场 · 我的</h1>
      {toastNode}
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : !isCoach || myClub === null ? (
        <div className="card empty-state">
          <p className="muted">
            {isCoach ? '还没有绑定俱乐部。先到球队中心完成绑定，再来挂牌和盯价。' : '挂牌球员与出价都是教练操作，观众视角看看就好。'}
          </p>
        </div>
      ) : (
        <>
          <ListSection
            squad={squad}
            onDone={(msg) => {
              show(msg);
              invalidateMarket(null);
              refreshMine();
            }}
            onError={(m) => show(m, true)}
          />
          {myBids !== null && <MyBidsSection bids={myBids} available={available} balance={myClub.balance} />}
        </>
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
                  {p.name}（违约金 {(p.releaseFee ?? 0).toFixed(2)} m）
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
      <p className="hint">训练营里的孩子不能自己挂出去——他们只能被别队激活带走（见「海捞」页的激活转会）。</p>
    </section>
  );
}

/* ---------- 我的出价 ---------- */

function MyBidsSection({ bids, available, balance }: { bids: MyBidRow[]; available: number | null; balance: number | null }) {
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
            {bids.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  还没出过价。去市场板挑一件挂单，或到海捞页激活别家小将。
                </td>
              </tr>
            ) : (
              bids.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={playerPath(b.player)}>{b.player.name}</Link>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
