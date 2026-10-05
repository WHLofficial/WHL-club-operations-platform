// 市场共享件（v2.2.0 拆页，v6.18.0 扩为四页，v6.24.0 扩为五页，v6.31.0 扩为六页）：常量、格式化、子导航。
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

export function MarketNav() {
  return (
    <nav className="seg" aria-label="市场分区">
      <NavLink to="/market" end className={({ isActive }) => (isActive ? 'on' : '')}>
        在售市场
      </NavLink>
      {/* v6.31.0：广告板（各队转会名单按着重度分两区展示） */}
      <NavLink to="/market/board" className={({ isActive }) => (isActive ? 'on' : '')}>
        广告板
      </NavLink>
      <NavLink to="/market/free" className={({ isActive }) => (isActive ? 'on' : '')}>
        海捞
      </NavLink>
      {/* v6.24.0：独立成页（激活挂牌 + 首价落定） */}
      <NavLink to="/market/activation" className={({ isActive }) => (isActive ? 'on' : '')}>
        激活
      </NavLink>
      {/* v6.23.0：旧「我的」(/market/mine) 并入转会台，NavLink 不用 end —— desk 内切 tab 时本项保持高亮 */}
      <NavLink to="/market/desk" className={({ isActive }) => (isActive ? 'on' : '')}>
        我的转会台
      </NavLink>
      <NavLink to="/market/intel" className={({ isActive }) => (isActive ? 'on' : '')}>
        市场情报
      </NavLink>
    </nav>
  );
}
