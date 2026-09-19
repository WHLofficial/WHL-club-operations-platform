// 管理端共享数据层（增量 15 commit 3）：
// clubs 原来在俱乐部/合同导入/期初余额/手动记账四个 section 各拉一次，共享 key 自动去重；
// /api/seasons/current 赛季页与球员页成长引擎都要用，同样共享。
import { api, type AdminClubRow, type SeasonCurrent } from './api.ts';

export const ADMIN_CLUBS_KEY = ['admin', 'clubs'] as const;
export const SEASON_CURRENT_KEY = ['seasons', 'current'] as const;

export async function fetchAdminClubs(): Promise<AdminClubRow[]> {
  return (await api<{ clubs: AdminClubRow[] }>('/api/admin/clubs')).clubs;
}

export async function fetchSeasonCurrent(): Promise<SeasonCurrent> {
  return api<SeasonCurrent>('/api/seasons/current');
}
