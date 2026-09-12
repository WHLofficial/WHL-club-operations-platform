// FC 参考表（TECH_DESIGN §5.4：随 SPA 版本发布的静态 JSON，web/assets/ref/，
// scripts/gen_ref_json.py 从 FC26db 源生成；查找类只存 ID，名称由这里渲染）
import nationRef from '../../assets/ref/nation.json';
import positionRef from '../../assets/ref/position.json';
import playstyleRef from '../../assets/ref/playstyle.json';
import roleRef from '../../assets/ref/role.json';
import teamRef from '../../assets/ref/team.json';

export interface PlayStyleRow {
  id: number;
  en: string | null;
  chs: string | null;
  type: string | null;
}

export interface RoleRow {
  id: number;
  en: string | null;
  chs: string | null;
}

function indexBy<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export const nationById = indexBy(nationRef);
export const positionById = indexBy(positionRef);
export const teamById = indexBy(teamRef);
export const playstyleById = indexBy(playstyleRef);
export const roleById = indexBy(roleRef);

export function nationName(id: unknown): string | null {
  const n = Number(id);
  return Number.isFinite(n) ? nationById.get(n)?.name ?? null : null;
}

export function teamName(id: unknown): string | null {
  const n = Number(id);
  return Number.isFinite(n) ? teamById.get(n)?.name ?? null : null;
}

export function positionName(id: unknown): string | null {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const row = positionById.get(n);
  return row && row.name !== '-' ? row.name : null;
}

export function roleChs(id: unknown): string | null {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const row = roleById.get(n);
  // 0 / '-' 是源表里的「无角色」占位
  if (!row || row.en === '-' || row.chs === '-') return null;
  return row.chs ?? row.en ?? null;
}

// 金段徽章 = 基础 ID+100（§5.2）；槽位口径：1-7 银槽、13 起金槽
export function playstyleIsGold(psid: number, slot: number): boolean {
  return psid >= 100 || slot >= 13;
}

export function playstyleIconUrl(id: number): string {
  return `/assets/icons/playstyles/${id}.webp`;
}

export const AGENT_TIER_LABEL = ['', '温和', '普通', '苛刻'] as const;

export const STATUS_LABEL: Record<string, string> = {
  normal: '正常',
  listed: '挂牌中',
  trainee: '训练营',
  free: '无归属',
  retired: '退役',
};

export const SOURCE_LABEL: Record<string, string> = {
  negotiation: '报价成约',
  forced: '强制成约',
  direct: '直败结算',
  import: '历史导入',
};

export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  formal: '正式合同',
  trainee: '训练营合同',
};

export const LEAGUE_TIER_LABEL: Record<string, string> = {
  premier: '顶级联赛',
  second: '次级联赛',
};
