// 转会台 · 我的转会台 /market/desk（v6.23.0：市场 / 报价 / 谈判三域前端合并的落点）。
// v6.32.0 页签化（照球队中心 ClubDetail 的真页签模式）：三区块改 .seg.dossier-tabs 页签 + 条件挂载，
// 一次只挂一个区块、未激活页签不发其区块查询；旧速览条退役、计数进页签（同一批 query 键，缓存复用）；
// 滚动对齐机制（rAF 轮询 + 三重监听）随「全挂载长滚动页」一起退役——页签化后深链 = 直接落页签，无需滚动。
// 流水线说明条精简一行徽标链；「报价被接受 ≠ 成约」的机制讲解收进报价区块的 hint（唯一讲解点，
// 静态守卫禁止本页再出现该句）。
// ?tab=nego|offers|bids 语义保留（旧链 /offers、/negotiations 换址依赖它），?tab=mine 是 bids 的旧 alias
// （不改写 URL），非法值回落 nego 也不改写；box/status 仍持在本页 searchParams。
import { useSearchParams } from 'react-router';
import { useMyBids, useMyClub, useMyNegotiations, useOffers } from '../../../lib/queries.ts';
import { MarketNav } from '../shared.tsx';
import ListingsBidsSection from './ListingsBidsSection.tsx';
import NegotiationsSection from './NegotiationsSection.tsx';
import OffersSection from './OffersSection.tsx';

type DeskTab = 'nego' | 'offers' | 'bids';

export default function MarketDeskPage() {
  const [params, setParams] = useSearchParams();
  const tabRaw = params.get('tab');
  // 旧链接 ?tab=mine 是 bids 的 alias（直接渲染出价页签，不改写 URL、不发重定向）
  const tab: DeskTab = tabRaw === 'offers' || tabRaw === 'bids' || tabRaw === 'mine' ? (tabRaw === 'mine' ? 'bids' : tabRaw) : 'nego';
  const box = params.get('box') === 'out' ? 'out' : 'in';
  const status = params.get('status') === 'all' ? 'all' : 'pending';

  const { loading, isCoach, club: myClub, failed: clubFailed } = useMyClub();
  const { bids: myBids } = useMyBids(isCoach);
  // 页签计数：三个数字全部由各区块自身的数据派生（与区块同一批 query 键，TanStack 缓存自动复用，
  // 切页签不会重复发请求）；报价计数 = 两侧 pendingMine 之和（in + out 都可能轮到我表态）。
  const negotiations = useMyNegotiations(isCoach);
  const offersIn = useOffers('in', 'pending', isCoach);
  const offersOut = useOffers('out', 'pending', isCoach);

  const counts: Record<DeskTab, number> = {
    nego: (negotiations.data ?? []).filter((s) => s.status === 'active').length,
    offers: (offersIn.data?.pendingMine ?? 0) + (offersOut.data?.pendingMine ?? 0),
    bids: (myBids ?? []).filter((b) => b.status === 'active').length,
  };

  function goTab(next: DeskTab) {
    if (next === tab) return;
    setParams((p) => {
      const np = new URLSearchParams(p);
      np.set('tab', next);
      return np;
    });
  }

  function switchBox(next: 'in' | 'out') {
    if (next === box && tab === 'offers') return;
    setParams((p) => {
      const np = new URLSearchParams(p);
      np.set('tab', 'offers');
      np.set('box', next);
      return np;
    });
  }

  function switchStatus(next: 'pending' | 'all') {
    if (next === status && tab === 'offers') return;
    setParams((p) => {
      const np = new URLSearchParams(p);
      np.set('tab', 'offers');
      np.set('status', next);
      return np;
    });
  }

  return (
    <div className="container">
      <h1>转会中心 · 我的转会台</h1>
      <MarketNav />
      {loading ? (
        <p className="muted">正在确认你的俱乐部身份…</p>
      ) : clubFailed && isCoach ? (
        // 「没取到」与「没绑队」是两件事（MyClubState.failed）：取不到时别把教练误诊成未绑定
        <div className="card empty-state">
          <p className="muted">俱乐部身份暂时取不到，请稍后刷新重试。</p>
        </div>
      ) : !isCoach || myClub === null ? (
        <div className="card empty-state">
          <p className="muted">
            {isCoach ? '还没有绑定俱乐部。先到球队中心完成绑定，再来盯价和谈判。' : '这里只对教练开放。报价、出价与谈判都是教练操作，观众视角看看就好。'}
          </p>
        </div>
      ) : (
        <>
          {/* 流水线一行（静态）：完整机制讲解在报价页签的 hint，这里只留流程骨架 */}
          <p className="hint" aria-label="转会流水线">
            <span className="badge sky">挂牌 / 报价</span> → <span className="badge gold">竞价</span> →{' '}
            <span className="badge purple">管理组审核</span> → <span className="badge green">签约谈判</span> →{' '}
            <span className="badge green">成约过户</span>
          </p>

          {/* 页签条：自带计数，条件挂载一次只挂一个区块 */}
          <div className="seg dossier-tabs" role="radiogroup" aria-label="转会台页签">
            <button type="button" className={tab === 'nego' ? 'on' : ''} onClick={() => goTab('nego')}>
              签约谈判 <span className="mono">{counts.nego}</span>
            </button>
            <button type="button" className={tab === 'offers' ? 'on' : ''} onClick={() => goTab('offers')}>
              报价 <span className="mono">{counts.offers}</span>
            </button>
            <button type="button" className={tab === 'bids' ? 'on' : ''} onClick={() => goTab('bids')}>
              我的出价 <span className="mono">{counts.bids}</span>
            </button>
          </div>

          {tab === 'nego' && <NegotiationsSection />}
          {tab === 'offers' && (
            <OffersSection box={box} status={status} onBoxChange={switchBox} onStatusChange={switchStatus} />
          )}
          {tab === 'bids' && <ListingsBidsSection />}
        </>
      )}
    </div>
  );
}
