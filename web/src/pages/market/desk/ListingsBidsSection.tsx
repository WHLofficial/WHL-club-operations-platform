// 转会台 · 我的出价区（v6.23.0 从 pages/MarketMinePage.tsx 搬入；v6.24.0 批次 C：挂牌表单删除、锚 id desk-mine → desk-bids）。
// 挂牌入口仍在球员档案左栏（SideOps），后端 POST /api/market/listings 端点保留。
// v6.23.0 新增：成交出价若停在「挂牌待审核」阶段，徽标改「待审核」（listingStatus 推导，不加请求）。
import { useMemo } from 'react';
import { Link } from 'react-router';
import type { MyBidRow } from '../../../lib/api.ts';
import { useMyBids, useMyClub } from '../../../lib/queries.ts';
import { playerPath } from '../../../lib/player-link.ts';
import { BID_STATUS_LABEL, money } from '../shared.tsx';

/** 出价行徽标：成交但挂牌还在审核 → 「待审核」，其余沿用 BID_STATUS_LABEL 四态 */
function bidBadge(b: MyBidRow): { label: string; cls: string } {
  if (b.status === 'won' && b.listingStatus === 'pending_review') return { label: '待审核', cls: 'purple' };
  return { label: BID_STATUS_LABEL[b.status] ?? b.status, cls: b.status === 'active' ? 'sky' : b.status === 'won' ? 'gold' : 'gray' };
}

export default function ListingsBidsSection() {
  const { isCoach, club: myClub } = useMyClub();
  const { bids: myBids } = useMyBids(isCoach);

  const heldTotal = useMemo(() => (myBids ?? []).filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0), [myBids]);
  const available = myClub?.balance !== null && myClub !== null ? (myClub.balance ?? 0) - heldTotal : null;

  return (
    <section id="desk-bids" aria-label="我的出价">
      {myBids !== null && <MyBidsSection bids={myBids} available={available} balance={myClub?.balance ?? null} />}
    </section>
  );
}

/* ---------- 我的出价 ---------- */

function MyBidsSection({ bids, available, balance }: { bids: MyBidRow[]; available: number | null; balance: number | null }) {
  return (
    <section className="card">
      <h3>我的出价</h3>
      <p className="hint">
        账户余额 {money(balance)}m，冻结中 {money(bids.filter((b) => b.holdStatus === 'held').reduce((s, b) => s + b.amount, 0))}m，
        可支配 {money(available)}m。出价即冻结，被超出或落选自动解冻。
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
                  还没出过价。去在售市场挑一件挂单，或到激活页捞别家小将。
                </td>
              </tr>
            ) : (
              bids.map((b) => {
                const badge = bidBadge(b);
                return (
                  <tr key={b.id}>
                    <td>
                      <Link to={playerPath(b.player)}>{b.player.name}</Link>
                    </td>
                    <td>{b.sellerClubName}</td>
                    <td className="num mono">{money(b.amount)}</td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td>
                      {b.holdStatus === 'held' && <span className="stamp stamp-hold stamp-inline">冻结中</span>}
                      {b.holdStatus === 'released' && <span className="stamp-inline stamp-inline-ok">已解冻</span>}
                      {b.holdStatus === 'settled' && <span className="stamp stamp-hold stamp-inline">已划转</span>}
                      {b.holdStatus === null && <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
