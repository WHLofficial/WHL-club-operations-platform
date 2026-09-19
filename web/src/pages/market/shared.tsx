// 市场三页共享件（增量 16 拆页）：常量、格式化、我的俱乐部/出价 hook、子导航。
// 数据层暂仍 useEffect（commit 4 换 TanStack Query），行为与拆页前逐字节等价。
import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { api, type MyBidRow, type SquadOverview } from '../../lib/api.ts';

export type ListingFilter = 'active' | 'pending_review' | 'ended' | 'all';

export const FILTER_LABEL: Record<ListingFilter, string> = {
  active: '在挂',
  pending_review: '待审核',
  ended: '已结束',
  all: '全部',
};

export const LISTING_STATUS_LABEL: Record<string, string> = {
  listed: '挂牌中',
  bidding: '竞价中',
  matched_pending: '匹配等待期',
  pending_review: '待审核',
  delisted: '已下架',
};

export const LISTING_STATUS_BADGE: Record<string, string> = {
  listed: 'sky',
  bidding: 'gold',
  matched_pending: 'purple',
  pending_review: 'purple',
  delisted: 'gray',
};

export const BID_STATUS_LABEL: Record<string, string> = {
  active: '领先中',
  superseded: '被超出',
  withdrawn: '已撤下',
  won: '成交',
};

export function money(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : x.toFixed(2);
}

export function deadlineText(iso: string | null, suffix = ' 判定'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${suffix}`;
}

export interface MarketMyClub {
  id: number;
  name: string;
  balance: number | null;
  isCoach: boolean;
}

export interface MyClubState {
  loading: boolean;
  /** /api/me 的角色判定（不看俱乐部绑定） */
  isCoach: boolean;
  /** null = 匿名/未绑定俱乐部 */
  club: MarketMyClub | null;
}

// 未登录也能逛市场：拉不到就静默落空态，页面照常渲染挂牌板。
// loading 与「无俱乐部」必须区分——否则/free、/mine 会永远停在「正在确认」
export function useMyClub(): MyClubState {
  const [state, setState] = useState<MyClubState>({ loading: true, isCoach: false, club: null });
  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ user: { role: string } | null }>('/api/me');
        const isCoach = me.user?.role === 'coach' || me.user?.role === 'admin';
        const overview = await api<{ club: { id: number; name: string } | null; balance: number | null }>('/api/me/club');
        setState({
          loading: false,
          isCoach,
          club: overview.club ? { ...overview.club, balance: overview.balance, isCoach } : null,
        });
      } catch {
        setState({ loading: false, isCoach: false, club: null });
      }
    })();
  }, []);
  return state;
}

export function useMyBids(isCoach: boolean): { bids: MyBidRow[] | null; refresh: () => Promise<void> } {
  const [myBids, setMyBids] = useState<MyBidRow[] | null>(null);
  const refresh = useCallback(async () => {
    if (!isCoach) return;
    try {
      const d = await api<{ bids: MyBidRow[] }>('/api/me/bids');
      setMyBids(d.bids);
    } catch {
      /* 拉失败保留旧值 */
    }
  }, [isCoach]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { bids: myBids, refresh };
}

export function useSquad(isCoach: boolean): SquadOverview | null {
  const [squad, setSquad] = useState<SquadOverview | null>(null);
  useEffect(() => {
    if (!isCoach) return;
    api<SquadOverview>('/api/club/squad')
      .then(setSquad)
      .catch(() => setSquad(null));
  }, [isCoach]);
  return squad;
}

export function MarketNav() {
  return (
    <nav className="seg" aria-label="市场分区">
      <NavLink to="/market" end className={({ isActive }) => (isActive ? 'on' : '')}>
        市场板
      </NavLink>
      <NavLink to="/market/free" className={({ isActive }) => (isActive ? 'on' : '')}>
        海捞
      </NavLink>
      <NavLink to="/market/mine" className={({ isActive }) => (isActive ? 'on' : '')}>
        我的
      </NavLink>
    </nav>
  );
}
