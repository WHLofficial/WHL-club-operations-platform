// 管理端共享数据层（v2.1.0 commit 3）：
// clubs 原来在俱乐部/合同导入/期初余额/手动记账四个 section 各拉一次，共享 key 自动去重；
// /api/seasons/current 赛季页与球员页成长引擎都要用，同样共享。
import { api, apiSend, type AdminClubRow, type AdminShopOrdersResponse, type CpuConvertState, type MarketRoundReopenResult, type MarketRoundResponse, type MatchEntryInput, type MatchEntryListResponse, type MatchEntryPanel, type MatchEntrySubmitResult, type SeasonCurrent, type WeatherForecastPreview } from './api.ts';

export const ADMIN_CLUBS_KEY = ['admin', 'clubs'] as const;
export const SEASON_CURRENT_KEY = ['seasons', 'current'] as const;

export async function fetchAdminClubs(): Promise<AdminClubRow[]> {
  return (await api<{ clubs: AdminClubRow[] }>('/api/admin/clubs')).clubs;
}

export async function fetchSeasonCurrent(): Promise<SeasonCurrent> {
  return api<SeasonCurrent>('/api/seasons/current');
}

// v6.1.0：球队建档双向同步的对账清单（赛事系统 team ↔ 登记册 clubs 按 id 对齐）
export const TEAM_SYNC_KEY = ['admin', 'team-sync'] as const;

export interface TeamSyncDiff {
  /** 赛事系统有球队、登记册里没有俱乐部 → 可一键建俱乐部 */
  onlyTour: { id: number; name: string }[];
  /** 登记册有俱乐部、赛事系统里没有球队 → 可一键推过去建队 */
  onlyClub: { id: number; name: string }[];
  /** 两侧都有但名字不一致 → 只展示，不自动改（改名不联动） */
  nameDiffers: { id: number; tourName: string; clubName: string }[];
  truncated: boolean;
}

export async function fetchTeamSync(): Promise<TeamSyncDiff> {
  return api<TeamSyncDiff>('/api/admin/team-sync');
}

// v6.14.0 C3 招商轮：当前轮（或最近一条已结轮）+ 全状态报价流水；管理端只读 + 手动恢复按钮
export const MARKET_ROUND_KEY = ['admin', 'market-round'] as const;

export async function fetchMarketRound(): Promise<MarketRoundResponse> {
  return api<MarketRoundResponse>('/api/admin/brands/market-round');
}

// 手动「清盘+开轮」：清掉当前 open 轮的未签报价并按当刻队况重开一轮（没有开着的窗口时后端 409）
export async function reopenMarketRound(): Promise<MarketRoundReopenResult> {
  return apiSend<MarketRoundReopenResult>('POST', '/api/admin/brands/market-round/reopen', {});
}

// v6.15.0 场次天气预报表：按 (赛事, 轮次) 预览该轮主场比赛的预报/确认状态（不掷随机）
export const weatherForecastKey = (tournamentId: number, round: number) => ['admin', 'weather-forecast', tournamentId, round] as const;

export async function fetchWeatherForecast(tournamentId: number, round: number): Promise<WeatherForecastPreview> {
  return api<WeatherForecastPreview>(`/api/admin/weather/forecast?tournament_id=${tournamentId}&round=${round}`);
}

// v6.16.0 成长录入：可补录比赛列表（近 50 场）+ 单场录入面板。写后精确 invalidate 这两个 key。
export const MATCH_ENTRY_LIST_KEY = ['admin', 'growth', 'match-entry-list'] as const;

export const matchEntryPanelKey = (matchId: number) => ['admin', 'growth', 'match-entry', matchId] as const;

export async function fetchMatchEntryList(): Promise<MatchEntryListResponse> {
  return api<MatchEntryListResponse>('/api/admin/growth/match-entry');
}

export async function fetchMatchEntryPanel(matchId: number): Promise<MatchEntryPanel> {
  return api<MatchEntryPanel>(`/api/admin/growth/match-entry/${matchId}`);
}

/** 批量提交单场录入；400 的中文原因由 ApiError.message 带出（worker 侧统一 { error } 形状） */
export async function submitMatchEntry(matchId: number, entries: MatchEntryInput[]): Promise<MatchEntrySubmitResult> {
  return apiSend<MatchEntrySubmitResult>('POST', `/api/admin/growth/match-entry/${matchId}`, { entries });
}

// v6.26.0 消费中心：管理端工单队列（待审 / 外部代录 / 历史筛选）
export const ADMIN_SHOP_KEY = (status: string, source: string) => ['admin', 'shop-orders', status, source] as const;

export async function fetchAdminShopOrders(status: string, source: string): Promise<AdminShopOrdersResponse> {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (source) q.set('source', source);
  const qs = q.toString();
  return api<AdminShopOrdersResponse>(`/api/admin/shop/orders${qs ? `?${qs}` : ''}`);
}

// v6.27.0 CPU 接管向导：单队接管状态（五步向导整页吃这一份，动作后 invalidate 本 key）
export const CPU_CONVERT_KEY = (id: number) => ['admin', 'cpu-convert', id] as const;

export async function fetchCpuConvert(id: number): Promise<CpuConvertState> {
  return api<CpuConvertState>(`/api/admin/clubs/${id}/cpu-convert`);
}
