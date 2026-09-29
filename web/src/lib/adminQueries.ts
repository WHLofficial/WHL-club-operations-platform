// 管理端共享数据层（v2.1.0 commit 3）：
// clubs 原来在俱乐部/合同导入/期初余额/手动记账四个 section 各拉一次，共享 key 自动去重；
// /api/seasons/current 赛季页与球员页成长引擎都要用，同样共享。
import { api, apiSend, type AdminClubRow, type MarketRoundReopenResult, type MarketRoundResponse, type SeasonCurrent } from './api.ts';

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
