// 用户端数据层共享 keys 与 fetchers（v2.2.0 commit 4）。
// 口径沿用v2.1.0 管理端：queryKey 层级化、写后精确 invalidate、不引入 useMutation。
import { useQuery, useQueryClient, keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api, apiPost, type ActivatableResponse, type ClubDetail, type ClubStanding, type ClubSummary, type FinanceSummaryResponse, type HomeMatchesResponse, type MarketDealsResponse, type MarketListings, type MarketListingDetail, type MyBidRow, type MyClubOverview, type NegotiationSession, type NamingQuoteResponse, type NotificationsPage, type NotificationsUnreadByCategory, type OfferDetailResponse, type OfferSettingsDto, type OffersListResponse, type PlayerDetail, type PlayersLibraryResponse, type RumorsResponse, type SeaLookupResponse, type SeasonsCurrent, type ShopCatalog, type ShopOrdersResponse, type ShopSquadStateResponse, type SquadOverview, type TransferBoardResponse } from './api.ts';
import type { NotifyCategoryId } from '../../../src/core/notify-meta.ts';
import { useAuth } from './auth.tsx';

/** 可激活名单模式（v6.18.0）：all=全部可激活 / trainee=仅训练营 */
export type ActivatableMode = 'all' | 'trainee';

export const qk = {
  me: ['me'] as const,
  myClub: ['me', 'club'] as const,
  squad: ['club', 'squad'] as const,
  clubsList: ['clubs', 'list'] as const,
  clubDetail: (id: number) => ['clubs', 'detail', id] as const,
  clubStanding: (id: number) => ['clubs', 'standing', id] as const,
  seasonsCurrent: ['seasons', 'current'] as const,
  clubRoster: (id: number) => ['players', 'club-roster', id] as const,
  // 球员详情（v6.34.0 收编自 Player.tsx inline query）：详情页与对比页共享同一缓存键。
  // id 一律 string 归一（usePlayerDetail 内 String()）——详情页 useParams 是 string、
  // 对比页可能传 number，键不统一会出现 ['player','7'] 与 ['player',7] 两份缓存
  player: (id: string) => ['player', id] as const,
  myBids: ['market', 'my-bids'] as const,
  board: (status: string) => ['market', 'board', status] as const,
  listing: (id: number) => ['market', 'listing', id] as const,
  rumors: ['market', 'rumors'] as const,
  deals: ['market', 'deals'] as const,
  // 转会广告板（v6.31.0）：只收转会名单内球员，limit 参数化（页 200 / teaser 3）
  transferBoard: (limit: number) => ['market', 'transfer-board', limit] as const,
  seaLookup: (q: string) => ['market', 'sea-lookup', q] as const,
  activatable: (mode: ActivatableMode, q: string) => ['market', 'activatable', mode, q] as const,
  notifications: ['notifications'] as const,
  // 收件篮列表（v6.40.0 类目化）：'' = 全部；键里带类目 ⇒ 切页签各存一份缓存
  notificationsList: (category: string) => ['notifications', 'list', category] as const,
  unreadByCategory: ['notifications', 'unread-by-category'] as const,
  stadiumBuild: ['club', 'stadium-build'] as const,
  naming: ['club', 'naming'] as const,
  bookings: ['club', 'bookings'] as const,
  clubEvents: ['club', 'events'] as const,
  offers: (box: 'in' | 'out', status: string) => ['offers', box, status] as const,
  offer: (id: number) => ['offers', 'detail', id] as const,
  // 报价设置（v6.33.0）：私密预填源（详情端点走公开缓存不能个体化）
  offerSettings: (playerId: number) => ['players', playerId, 'offer-settings'] as const,
  // 我的谈判会话（v6.32.0 自 desk/NegotiationsSection 收编：页签计数与谈判区共用一个键）
  myNegotiations: ['negotiations', 'mine'] as const,
  homeMatches: ['club', 'home-matches'] as const,
  financeSummary: (season?: number) => ['club', 'finance-summary', season ?? 'current'] as const,
  // 消费中心（v6.26.0）
  shopCatalog: ['shop', 'catalog'] as const,
  shopSquadState: ['shop', 'squad-state'] as const,
  shopOrders: ['shop', 'orders'] as const,
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

// 我的谈判会话（v6.32.0 自 desk/NegotiationsSection 收编）：转会台页签计数与谈判区块共用同一个
// query 键，命中缓存不重复发请求。
export function useMyNegotiations(isCoach: boolean) {
  return useQuery({
    queryKey: qk.myNegotiations,
    queryFn: async () => (await api<{ sessions: NegotiationSession[] }>('/api/negotiations?mine=1')).sessions,
    enabled: isCoach,
  });
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

// 报价设置（v6.33.0）：本队教练的私密预填源。staleTime 0——保存后 invalidate 立即重取，
// 面板草稿以它对脏；未登录（401）走 query error，调用方按「数据没到 = 禁存」处理
export function useOfferSettings(playerId: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.offerSettings(playerId),
    queryFn: () => api<OfferSettingsDto>(`/api/players/${playerId}/offer-settings`),
    enabled: enabled && Number.isInteger(playerId) && playerId > 0,
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

// 球员详情（v6.34.0）：详情页（useParams 的 string）与对比页（fc_id，可能 number）共用。
// 键统一 String(id)；enabled 语义沿用原 inline 查询（id 缺省时不发请求）——`null`/空串一并拦掉，
// 否则 key 会成 '' 并请求 `/api/players/`（那是列表端点，不是 404）。
export function usePlayerDetail(id: string | number | null | undefined) {
  const key = id === undefined || id === null ? '' : String(id);
  return useQuery({
    queryKey: qk.player(key),
    queryFn: () => api<PlayerDetail>(`/api/players/${key}`),
    enabled: key !== '',
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

// ---- v6.18.0：市场情报 / 海捞资格 / 激活球员 ----

// 转会传闻（公开）：系统按窗口派生，服务端挂 1h 缓存；失败不重试，页面按 isError 出 banner
export function useRumors() {
  return useQuery({
    queryKey: qk.rumors,
    queryFn: async () => (await api<RumorsResponse>('/api/market/rumors')).rumors,
    retry: false,
  });
}

// 已达成交易（公开）：completed 全类型倒序 ≤50 条
export function useMarketDeals() {
  return useQuery({
    queryKey: qk.deals,
    queryFn: async () => (await api<MarketDealsResponse>('/api/market/deals')).deals,
    retry: false,
  });
}

// 转会广告板（公开，v6.31.0）：limit 默认 200（端点上限）；teaser 传 3 只取前三位
export function useTransferBoard(limit = 200) {
  return useQuery({
    queryKey: qk.transferBoard(limit),
    queryFn: () => api<TransferBoardResponse>(`/api/market/transfer-board?limit=${limit}`),
    staleTime: 60_000,
    retry: false,
  });
}

// 海捞资格查询（教练端点）：q 空不发请求（提交后才带非空 q），结果按输入参数化缓存
export function useSeaLookup(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.seaLookup(query),
    queryFn: async () => (await api<SeaLookupResponse>(`/api/market/sea-lookup?q=${encodeURIComponent(query)}`)).results,
    enabled: query !== '',
    retry: false,
  });
}

// 可激活球员（教练端点）：mode=all/trainee，q 为可选名字筛选；不传 limit 走服务端缺省 100
export function useActivatable(mode: ActivatableMode, q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.activatable(mode, query),
    queryFn: () =>
      api<ActivatableResponse>(`/api/market/activatable?mode=${mode}${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`),
    retry: false,
  });
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

// 收件篮列表：游标分页；category 缺省全部（v6.40.0）
export function useNotificationList(category: NotifyCategoryId | '') {
  return useInfiniteQuery({
    queryKey: qk.notificationsList(category),
    queryFn: ({ pageParam }) =>
      api<NotificationsPage>(`/api/notifications?${category === '' ? '' : `category=${category}&`}${pageParam !== null ? `cursor=${pageParam}` : ''}`),
    initialPageParam: null as number | null,
    // nextCursor 到底时是 null；v5 里 null 仍是合法游标，必须转 undefined 才算「没有下一页」
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// 类目未读分布（页签角标）：进收件篮才拉一次 + 写后由 invalidate 刷新；不轮询（顶栏那份才是 60s 轮询）
export function useUnreadByCategory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.unreadByCategory,
    queryFn: () => api<NotificationsUnreadByCategory>('/api/notifications/unread-count?by=category'),
    enabled: user != null,
    refetchOnWindowFocus: true,
  });
}

// 标已读（ids 单条 / all 全部，可带 category 只清本类），写后失效收件篮与两份未读数。
// opts.keepList：「见过即已读」专用——只刷新未读数、不动列表，否则刚看过的行会当场重排/跳位。
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return async (body: { ids?: number[]; all?: boolean; category?: NotifyCategoryId }, opts?: { keepList?: boolean }) => {
    const out = await apiPost<{ marked: number }>('/api/notifications/read', body);
    if (!opts?.keepList) void qc.invalidateQueries({ queryKey: qk.notifications });
    void qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    void qc.invalidateQueries({ queryKey: qk.unreadByCategory });
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

// ---- 主场战报 / 窗口财务（v6.7.0，B 块可见性）----

// 近期主场战报（教练端）：最近 10 场主场的天气/上座/票务/商业/转播与比分对手
export function useHomeMatches(isCoach: boolean) {
  return useQuery({
    queryKey: qk.homeMatches,
    queryFn: () => api<HomeMatchesResponse>('/api/club/home-matches'),
    enabled: isCoach,
  });
}

// 窗口财务汇总（教练端）：赛季缺省由服务端取当前赛季，前端不传 season
export function useFinanceSummary(isCoach: boolean, season?: number) {
  return useQuery({
    queryKey: qk.financeSummary(season),
    queryFn: () => api<FinanceSummaryResponse>(season !== undefined ? `/api/club/finance-summary?season=${season}` : '/api/club/finance-summary'),
    enabled: isCoach,
  });
}

// ---- 冠名市场（v6.14.0 C3）----

// 冠名全量：现合同 + 续约候选 + 收到的报价（招商轮报价随这个端点一次下发，不另开 query）
export function useNamingQuote() {
  return useQuery({
    queryKey: qk.naming,
    queryFn: () => api<NamingQuoteResponse>('/api/club/naming/quote'),
    retry: false,
  });
}

// 冠名动作后的联动失效：报价 + 我的俱乐部 + 余额（签约费/赔金影响可用余额，口径同设施升级）
export function useNamingInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.naming });
    void qc.invalidateQueries({ queryKey: qk.myClub });
    void qc.invalidateQueries({ queryKey: ['club', 'balance'] });
  };
}

// ---- 消费中心（v6.26.0）----

// 价目 / PA 上限 / 豪门名单（登录即可读，页面按教练身份再收表单）
export function useShopCatalog(enabled: boolean) {
  return useQuery({
    queryKey: qk.shopCatalog,
    queryFn: () => api<ShopCatalog>('/api/shop/catalog'),
    enabled,
    staleTime: 60_000,
  });
}

// 全队表单状态：热区 / 角色 / 徽章占用由服务端按效果引擎同一套规则算好
export function useShopSquadState(enabled: boolean) {
  return useQuery({
    queryKey: qk.shopSquadState,
    queryFn: () => api<ShopSquadStateResponse>('/api/shop/squad-state'),
    enabled,
    retry: false,
  });
}

// 我的消费工单（含管理组代录的 external 单）
export function useShopOrders(enabled: boolean) {
  return useQuery({
    queryKey: qk.shopOrders,
    queryFn: () => api<ShopOrdersResponse>('/api/shop/orders'),
    enabled,
    retry: false,
  });
}

// 提交/审核动作后的联动失效：工单列表 + 表单状态 + 余额（扣费/退款都动余额）
export function useShopInvalidation() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.shopOrders });
    void qc.invalidateQueries({ queryKey: qk.shopSquadState });
    void qc.invalidateQueries({ queryKey: qk.myClub });
    void qc.invalidateQueries({ queryKey: ['club', 'balance'] });
  };
}
