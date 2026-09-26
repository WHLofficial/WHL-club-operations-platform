// 用户端数据层共享 keys 与 fetchers（v2.2.0 commit 4）。
// 口径沿用v2.1.0 管理端：queryKey 层级化、写后精确 invalidate、不引入 useMutation。
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, apiPost, type ClubDetail, type ClubStanding, type ClubSummary, type MarketListings, type MarketListingDetail, type MyBidRow, type MyClubOverview, type OfferDetailResponse, type OffersListResponse, type PlayersLibraryResponse, type SeasonsCurrent, type SquadOverview } from './api.ts';
import { useAuth } from './auth.tsx';

export const qk = {
  me: ['me'] as const,
  myClub: ['me', 'club'] as const,
  squad: ['club', 'squad'] as const,
  clubsList: ['clubs', 'list'] as const,
  clubDetail: (id: number) => ['clubs', 'detail', id] as const,
  clubStanding: (id: number) => ['clubs', 'standing', id] as const,
  seasonsCurrent: ['seasons', 'current'] as const,
  clubRoster: (id: number) => ['players', 'club-roster', id] as const,
  myBids: ['market', 'my-bids'] as const,
  board: (status: string) => ['market', 'board', status] as const,
  listing: (id: number) => ['market', 'listing', id] as const,
  freeAgents: ['market', 'free-agents'] as const,
  trainees: ['market', 'trainees'] as const,
  notifications: ['notifications'] as const,
  stadiumBuild: ['club', 'stadium-build'] as const,
  naming: ['club', 'naming'] as const,
  offers: (box: 'in' | 'out', status: string) => ['offers', box, status] as const,
  offer: (id: number) => ['offers', 'detail', id] as const,
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
  /** null = 匿名/未绑定俱乐部，或这次没取到（看 failed 区分） */
  club: MarketMyClub | null;
  /** 请求失败（403/500）。失败时 club 也是 null，但「没绑队」和「没取到」对调用方是两件事 */
  failed: boolean;
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
    failed: user != null && isError,
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

// 转会区：状态切换用 keepPreviousData 防闪「正在翻卡柜」
export function useBoard(filter: string) {
  return useQuery({
    queryKey: qk.board(filter),
    queryFn: () => api<MarketListings>(`/api/market/listings?status=${filter}`),
    placeholderData: keepPreviousData,
  });
}

// 按球员查现行挂牌（v6.4.0 改动 6）：球员页左栏出价途径与举报入口用。
// 只看 active（listed/bidding/matched_pending）；球员不在挂牌流程时返回空列表。
export function usePlayerListing(playerId: number, enabled = true) {
  return useQuery({
    queryKey: ['market', 'listing-by-player', playerId],
    queryFn: () => api<MarketListings>(`/api/market/listings?status=active&player_id=${playerId}`),
    enabled: enabled && Number.isInteger(playerId) && playerId > 0,
    staleTime: 30_000,
  });
}

// 球队列表（v3.4.0）：公开页，一屏 20 队一次取完；服务端 clubs scope 缓存 24h，前端再叠 30s 全局 staleTime
export function useClubsList() {
  return useQuery({
    queryKey: qk.clubsList,
    queryFn: () => api<{ clubs: ClubSummary[] }>('/api/clubs'),
  });
}

// 当前赛季与窗口（v6.2.0）：公开端点，球员页左栏按 window.status 门控转会操作提示；
// 真正的开关在管理端市场页（/api/admin/windows/open|close），这里只读。
export function useSeasonsCurrent() {
  return useQuery({
    queryKey: qk.seasonsCurrent,
    queryFn: () => api<SeasonsCurrent>('/api/seasons/current'),
    staleTime: 60_000,
  });
}

// 球队详情：结构统计由服务端一次算完（v3.4.0 步骤 6），前端不再二次聚合。
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

// ---- 报价 / 议价（v6.3.0）----

// 报价清单（box=in 我收到的 / out 我送出的；status=pending|all）。写后整组失效（两个 box 都动）。
export function useOffers(box: 'in' | 'out', status: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.offers(box, status),
    queryFn: () => api<OffersListResponse>(`/api/offers?box=${box}&status=${status}`),
    enabled,
  });
}

// 球员页「我收到的报价」入口徽标：只要轮到我处理的条数，登录教练即拉（轻量端点）
export function useOffersReceivedPending(enabled: boolean) {
  return useQuery({
    queryKey: qk.offers('in', 'pending'),
    queryFn: () => api<OffersListResponse>('/api/offers?box=in&status=pending'),
    enabled,
  });
}

export function useOfferDetail(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.offer(id ?? 0),
    queryFn: () => api<OfferDetailResponse>(`/api/offers/${id}`),
    enabled: enabled && id !== null,
  });
}

// 报价动作后的联动失效：两个 box 的全部状态 + 单条详情 + 我的俱乐部（冻结影响可用余额）
export function useOffersInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['offers'] });
    void qc.invalidateQueries({ queryKey: qk.myClub });
  };
}
