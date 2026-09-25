// 市场三页共享件（v2.2.0 拆页）：常量、格式化、子导航。
// 数据层 hooks 在 lib/queries.ts（TanStack Query）。
import { NavLink } from 'react-router';

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
