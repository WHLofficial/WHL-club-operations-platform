// 用户端数据层共享 keys 与 fetchers（增量 16 commit 4）。
// 口径沿用增量 15 管理端：queryKey 层级化、写后精确 invalidate、不引入 useMutation。
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, apiPost, type ClubDetail, type ClubStanding, type ClubSummary, type MarketListings, type MarketListingDetail, type MyBidRow, type MyClubOverview, type PlayersLibraryResponse, type SquadOverview } from './api.ts';
import { useAuth } from './auth.tsx';

export const qk = {
  me: ['me'] as const,
  myClub: ['me', 'club'] as const,
  squad: ['club', 'squad'] as const,
  clubsList: ['clubs', 'list'] as const,
  clubDetail: (id: number) => ['clubs', 'detail', id] as const,
  clubStanding: (id: number) => ['clubs', 'standing', id] as const,
  clubRoster: (id: number) => ['players', 'club-roster', id] as const,
  myBids: ['market', 'my-bids'] as const,
  board: (status: string) => ['market', 'board', status] as const,
  listing: (id: number) => ['market', 'listing', id] as const,
  freeAgents: ['market', 'free-agents'] as const,
  trainees: ['market', 'trainees'] as const,
  notifications: ['notifications'] as const,
  stadiumBuild: ['club', 'stadium-build'] as const,
  naming: ['club', 'naming'] as const,
};

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

// /api/me/club 全量概览（Club 页与市场页共享一个缓存条目——同一 URL，读各自关心的子集）
export function useMyClubOverview() {
  return useQuery({
    queryKey: qk.myClub,
    queryFn: () => api<MyClubOverview>('/api/me/club'),
    enabled: useAuth().user != null,
  });
}

// 我的俱乐部（登录后才拉）；教练与否看 useAuth 的角色。
// loading 与「无俱乐部」必须区分——否则 /free、/mine 会永远停在「正在确认」
export function useMyClub(): MyClubState {
  const { user } = useAuth();
  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const { data, isPending, isError } = useMyClubOverview();
  return {
    loading: user != null && isPending,
    isCoach,
    club: !isError && data?.club ? { ...data.club, balance: data.balance, isCoach } : null,
  };
}

export function useMyBids(isCoach: boolean): { bids: MyBidRow[] | null; refresh: () => void } {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.myBids,
    queryFn: async () => (await api<{ bids: MyBidRow[] }>('/api/me/bids')).bids,
    enabled: isCoach,
  });
  return { bids: data ?? null, refresh: () => void qc.invalidateQueries({ queryKey: qk.myBids }) };
}

export function useSquad(isCoach: boolean): SquadOverview | null {
  const { data } = useQuery({
    queryKey: qk.squad,
    queryFn: () => api<SquadOverview>('/api/club/squad'),
    enabled: isCoach,
  });
  return data ?? null;
}

// 挂牌板：状态切换用 keepPreviousData 防闪「正在翻卡柜」
export function useBoard(filter: string) {
  return useQuery({
    queryKey: qk.board(filter),
    queryFn: () => api<MarketListings>(`/api/market/listings?status=${filter}`),
    placeholderData: keepPreviousData,
  });
}

// 球队列表（增量 31）：公开页，一屏 20 队一次取完；服务端 clubs scope 缓存 24h，前端再叠 30s 全局 staleTime
export function useClubsList() {
  return useQuery({
    queryKey: qk.clubsList,
    queryFn: () => api<{ clubs: ClubSummary[] }>('/api/clubs'),
  });
}

// 球队详情：结构统计由服务端一次算完（增量 31 步骤 6），前端不再二次聚合。
// 生产实测 12 条语句 / 151–165 行，服务端按 clubs scope 缓存 24h，故这里不覆盖 staleTime。
export function useClubDetail(id: number) {
  return useQuery({
    queryKey: qk.clubDetail(id),
    queryFn: () => api<ClubDetail>(`/api/clubs/${id}`),
    enabled: Number.isInteger(id) && id > 0,
  });
}

// 当季排名：后端代理比赛系统公开积分榜（服务端缓存 300s）。
// 取不到时后端回 200 + standing:null + note，所以这里只需把 note 原样显示，不用当错误处理。
export function useClubStanding(id: number) {
  return useQuery({
    queryKey: qk.clubStanding(id),
    queryFn: () => api<ClubStanding>(`/api/clubs/${id}/standing`),
    enabled: Number.isInteger(id) && id > 0,
    staleTime: 300_000,
  });
}

// 阵容名单：复用球员库列表端点（club_id 筛选），不新建读面。
// limit=100 是端点上限，生产最大阵容 37 人 ⇒ 一页装完；真超了用 nextCursor 提示去球员库看。
export function useClubRoster(id: number) {
  return useQuery({
    queryKey: qk.clubRoster(id),
    queryFn: () => api<PlayersLibraryResponse>(`/api/players?club_id=${id}&limit=100`),
    enabled: Number.isInteger(id) && id > 0,
    staleTime: 60_000,
  });
}

export function useListingDetail(id: number | null) {
  return useQuery({
    queryKey: qk.listing(id ?? 0),
    queryFn: () => api<MarketListingDetail>(`/api/market/listings/${id}`),
    enabled: id !== null,
    // 切换别的挂牌时保留旧详情展示（旧行为：新详情到达前旧卡不清空）
    placeholderData: keepPreviousData,
  });
}

// 出价/挂牌/激活后的联动失效：板（全部筛选项）+ 我的出价 + 当前详情
export function useMarketInvalidation() {
  const qc = useQueryClient();
  return (listingId: number | null) => {
    void qc.invalidateQueries({ queryKey: ['market', 'board'] });
    void qc.invalidateQueries({ queryKey: qk.myBids });
    if (listingId !== null) void qc.invalidateQueries({ queryKey: qk.listing(listingId) });
  };
}

// 未读数（顶栏小蓝点）：60s 轮询 + 窗口聚焦即拉；登录态才启用
export function useUnreadCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => (await api<{ unread: number }>('/api/notifications/unread-count')).unread,
    enabled: user != null,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

// 标已读（单条 ids / 全部 all），写后失效收件篮与未读数
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return async (body: { ids?: number[]; all?: boolean }) => {
    const out = await apiPost<{ marked: number }>('/api/notifications/read', body);
    void qc.invalidateQueries({ queryKey: qk.notifications });
    void qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    return out;
  };
}
