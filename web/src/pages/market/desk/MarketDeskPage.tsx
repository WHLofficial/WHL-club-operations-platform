// 转会台 · 我的转会台 /market/desk（v6.23.0：市场 / 报价 / 谈判三域前端合并的落点）。
// v6.32.0 页签化（照球队详情页 ClubDetail 的真页签模式）：三区块改 .seg.dossier-tabs 页签 + 条件挂载，
// 一次只挂一个区块、未激活页签不发其区块查询；旧速览条退役、计数进页签（同一批 query 键，缓存复用）；
// 滚动对齐机制（rAF 轮询 + 三重监听）随「全挂载长滚动页」一起退役——页签化后深链 = 直接落页签，无需滚动。
// 流水线说明条精简一行徽标链；「报价被接受 ≠ 成约」的机制讲解收进报价区块的 hint（唯一讲解点，
// 静态守卫禁止本页再出现该句）。
// ?tab=nego|offers|bids 语义保留（旧链 /offers、/negotiations 换址依赖它），?tab=mine 是 bids 的旧 alias
// （不改写 URL），非法值回落 nego 也不改写；box/status 仍持在本页 searchParams。
// v6.54.0：?tab=negotiations 是签约谈判页签的正式深链写法（站内信 / 球员页「球员要求」入口带
// &demand=<id>，故意与内部值 nego 不同名、与 v6.40.0 ?offer= 的写法对齐）；这里显式收成 nego，
// 不改写 URL（?demand= 由 NegotiationsSection 的球员要求分组读）。
// v6.73.0 期 B：页签数字改 A 口径待办数（desk/summary，与顶栏红点/子导航数字同源）；
// ?player=<内部 id> 深链落到对应页签并展开该球员行；只有 player 没有 tab 时默认落 bids。
import { useSearchParams } from 'react-router';
import { useDeskSummary, useMyBids, useMyClub, useMyNegotiations, useOffers } from '../../../lib/queries.ts';
import { MarketNav } from '../shared.tsx';
import ListingsBidsSection from './ListingsBidsSection.tsx';
import NegotiationsSection from './NegotiationsSection.tsx';
import OffersSection from './OffersSection.tsx';
import { groupBidsByPlayer } from './desk-rows.ts';
import { isActiveListing } from './status.ts';

type DeskTab = 'nego' | 'offers' | 'bids';

export default function MarketDeskPage() {
  const [params, setParams] = useSearchParams();
  const tabRaw = params.get('tab');
  // 深链目标球员（内部 id）；只有它没有 tab 时默认落 bids（期 B 裁决）
  const playerRaw = Number(params.get('player'));
  const focusPlayerId = Number.isInteger(playerRaw) && playerRaw > 0 ? playerRaw : null;
  // 旧链接 ?tab=mine 是 bids 的 alias；v6.54.0 的 ?tab=negotiations 是签约谈判的正式深链写法
  // （站内信 / 球员页「球员要求」入口带 &demand=<id>）——都直接渲染对应页签，不改写 URL、不发重定向。
  // 别名单列一支，「nego|offers|bids + mine」这句原样保留：tests/mobile-baseline 的静态锁逐字锁它。
  const tab: DeskTab =
    tabRaw === 'negotiations'
      ? 'nego'
      : tabRaw === 'offers' || tabRaw === 'bids' || tabRaw === 'mine'
        ? tabRaw === 'mine'
          ? 'bids'
          : tabRaw
        : focusPlayerId !== null
          ? 'bids'
          : 'nego';
  const box = params.get('box') === 'out' ? 'out' : 'in';
  const status = params.get('status') === 'all' ? 'all' : 'pending';

  const { loading, isCoach, club: myClub, failed: clubFailed } = useMyClub();
  const { bids: myBids } = useMyBids(isCoach);
  // v6.73.0 期 B：页签数字 = A 口径待办数（谈判 active / 报价轮到我 / 出价被超出），
  // 与顶栏红点、MarketNav 数字共用同一份 useDeskSummary（TanStack 缓存只发一次）。
  const summary = useDeskSummary(isCoach);
  const todo: Record<DeskTab, number> = {
    nego: summary.data?.negotiations ?? 0,
    offers: summary.data?.offers ?? 0,
    bids: summary.data?.bids ?? 0,
  };
  // 「进行中」口径与「待办」不同：谈判 active（与待办相同）、报价 pending + intent 全量、
  // 出价页签里当前挂牌仍在流程内的球员行（含领先与被超出）。两个数分开，不混成一个。
  const negotiations = useMyNegotiations(isCoach);
  const offersIn = useOffers('in', 'pending', isCoach);
  const offersOut = useOffers('out', 'pending', isCoach);
  const offerIds = new Set<number>();
  for (const o of [...(offersIn.data?.items ?? []), ...(offersOut.data?.items ?? [])]) offerIds.add(o.id);
  const inProgress: Record<DeskTab, number> = {
    nego: (negotiations.data?.pages[0]?.sessions ?? []).filter((s) => s.status === 'active').length,
    offers:
      offerIds.size + (offersIn.data?.intentsMine ?? 0) + (offersOut.data?.intentsMine ?? 0),
    bids: groupBidsByPlayer(myBids ?? []).filter((r) => isActiveListing(r.current.listingStatus)).length,
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
            {isCoach ? '还没有绑定俱乐部。先到我的球队完成绑定，再来盯价和谈判。' : '这里只对教练开放。报价、出价与谈判都是教练操作，观众视角看看就好。'}
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

          {/* 页签条：自带待办数（A 口径），条件挂载一次只挂一个区块 */}
          <div className="seg dossier-tabs" role="radiogroup" aria-label="转会台页签">
            <button type="button" className={tab === 'nego' ? 'on' : ''} onClick={() => goTab('nego')}>
              签约谈判 <span className="mono">{todo.nego}</span>
            </button>
            <button type="button" className={tab === 'offers' ? 'on' : ''} onClick={() => goTab('offers')}>
              报价 <span className="mono">{todo.offers}</span>
            </button>
            <button type="button" className={tab === 'bids' ? 'on' : ''} onClick={() => goTab('bids')}>
              我的出价 <span className="mono">{todo.bids}</span>
            </button>
          </div>
          {/* v6.73.0 期 B：待办与进行中分开（待办 = 该你动，进行中 = 在途全量） */}
          <p className="hint desk-todo-line">
            待办 <span className="mono">{todo[tab]}</span> · 进行中 <span className="mono">{inProgress[tab]}</span>
          </p>

          {tab === 'nego' && <NegotiationsSection focusPlayerId={focusPlayerId} />}
          {tab === 'offers' && (
            <OffersSection
              box={box}
              status={status}
              onBoxChange={switchBox}
              onStatusChange={switchStatus}
              focusPlayerId={focusPlayerId}
            />
          )}
          {tab === 'bids' && <ListingsBidsSection focusPlayerId={focusPlayerId} />}
        </>
      )}
    </div>
  );
}
