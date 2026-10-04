// 转会台 · 我的转会台 /market/desk（v6.23.0）：市场 / 报价 / 谈判三域前端合并的落点（纯前端信息架构）。
// 区块顺序：流水线说明条 → 待办速览 → 签约谈判 → 收到报价 → 我的出价；
// ?tab=nego|offers|bids 负责深链定位（进入/切换时把对应区块滚进视野），box/status 也持在本页 searchParams；
// v6.24.0：出价区 tab 键 mine → bids（锚 id 同步 desk-bids），旧链 ?tab=mine 作为 alias 仍落到 bids。
import { useEffect, useRef } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { useMyBids, useMyClub, useOffers } from '../../../lib/queries.ts';
import { MarketNav } from '../shared.tsx';
import ListingsBidsSection from './ListingsBidsSection.tsx';
import NegotiationsSection, { useMyNegotiations } from './NegotiationsSection.tsx';
import OffersSection from './OffersSection.tsx';

type DeskTab = 'nego' | 'offers' | 'bids';

export default function MarketDeskPage() {
  const [params, setParams] = useSearchParams();
  const tabRaw = params.get('tab');
  // v6.24.0：出价区键 mine → bids；旧链接 ?tab=mine 是 alias（直接渲染出价区，不改写 URL、不发重定向）
  const tab: DeskTab = tabRaw === 'offers' || tabRaw === 'bids' || tabRaw === 'mine' ? (tabRaw === 'mine' ? 'bids' : tabRaw) : 'nego';
  const box = params.get('box') === 'out' ? 'out' : 'in';
  const status = params.get('status') === 'all' ? 'all' : 'pending';

  const { loading, isCoach, club: myClub, failed: clubFailed } = useMyClub();
  const { bids: myBids } = useMyBids(isCoach);
  // 待办速览：三个计数全部由区块自身的数据派生，不新开计数端点
  const negotiations = useMyNegotiations(isCoach);
  const offersIn = useOffers('in', 'pending', isCoach);
  const offersOut = useOffers('out', 'pending', isCoach);

  const myTurnCount = (offersIn.data?.pendingMine ?? 0) + (offersOut.data?.pendingMine ?? 0);
  const activeNegoCount = (negotiations.data ?? []).filter((s) => s.status === 'active').length;
  const activeBidCount = (myBids ?? []).filter((b) => b.status === 'active').length;

  // 深链定位：tab 变化（含首次进入带 ?tab=）把对应区块滚到顶。
  // 不能只滚一次：各区块的请求在途时上方还是占位（矮），数据落定后内容回填会把目标挤到视口外，
  // 所以换区后的短窗口里持续对齐；时间闸必须挡住每一次对齐（不只挡循环）——effect 会因任何
  // re-render 重跑（如顶栏未读数每 60s 轮询），窗口过期后绝不能再把用户从下方区块拽回来。
  // jsdom 没实现 scrollIntoView，先探测再调。
  const alignUntil = useRef(0);
  useEffect(() => {
    alignUntil.current = Date.now() + 2000;
  }, [tab]);

  const fetching = useIsFetching();

  useEffect(() => {
    if (loading || !isCoach || myClub === null) return;
    const el = document.getElementById(`desk-${tab}`);
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const align = () => {
      if (Date.now() > alignUntil.current) return;
      if (Math.abs(el.getBoundingClientRect().top) > 8) el.scrollIntoView({ block: 'start' });
    };
    align();
    let raf = requestAnimationFrame(function tick() {
      if (Date.now() > alignUntil.current) return;
      align();
      raf = requestAnimationFrame(tick);
    });
    const stop = () => cancelAnimationFrame(raf);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
    // 依赖用原始值：myClub 是每次 render 新建的对象字面量，进 deps 会放大 effect 重跑面
  }, [tab, loading, isCoach, myClub?.id, fetching]);

  function goTab(next: DeskTab) {
    if (next === tab) return; // 已在当前区块就别再写一次 URL（避免多一条同址历史记录）
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
          {/* 流水线说明条（静态）：把「报价被接受 ≠ 成交」讲清楚，免得把竞价与成约混为一谈 */}
          <section className="card" aria-label="转会流水线">
            <p className="hint">
              <span className="badge sky">挂牌 / 报价</span> → <span className="badge gold">竞价</span> →{' '}
              <span className="badge purple">管理组审核</span> → <span className="badge green">签约谈判</span> →{' '}
              <span className="badge green">成约过户</span>
            </p>
            <p className="hint">
              报价被接受 ≠ 成交：开窗期同意会自动生成一张挂牌，回到市场继续竞价；竞价结束经管理组审核通过后才开启签约谈判。
              关窗期也能报价 / 还价 / 同意，但同意只挂「意向单」（不生成挂牌、资金继续冻结），开窗后由卖方确认才生成挂牌。
            </p>
          </section>

          {/* 待办速览：点各计数切到对应区块（tab 进 URL，刷新/深链都留在原地） */}
          <div className="seg" role="group" aria-label="待办速览">
            <button type="button" className={tab === 'offers' ? 'on' : ''} onClick={() => goTab('offers')}>
              轮到我 <span className="mono">{myTurnCount}</span>
            </button>
            <button type="button" className={tab === 'nego' ? 'on' : ''} onClick={() => goTab('nego')}>
              进行中谈判 <span className="mono">{activeNegoCount}</span>
            </button>
            <button type="button" className={tab === 'bids' ? 'on' : ''} onClick={() => goTab('bids')}>
              竞价中 <span className="mono">{activeBidCount}</span>
            </button>
          </div>

          <NegotiationsSection />
          <OffersSection box={box} status={status} onBoxChange={switchBox} onStatusChange={switchStatus} />
          <ListingsBidsSection />
        </>
      )}
    </div>
  );
}
