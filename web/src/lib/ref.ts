// FC 参考表（TECH_DESIGN §5.4：随 SPA 版本发布的静态 JSON，web/assets/ref/，
// scripts/gen_ref_json.py 从 FC26db 源生成；查找类只存 ID，名称由这里渲染）
import nationRef from '../../assets/ref/nation.json';
import positionRef from '../../assets/ref/position.json';
import playstyleRef from '../../assets/ref/playstyle.json';
import roleRef from '../../assets/ref/role.json';
import teamRef from '../../assets/ref/team.json';
import { isGoldPlaystyleId, PS_SILVER_SLOT_COUNT, playstyleSlotsOf } from '../../../src/core/fc26.ts';

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

// 金段徽章 = 基础 ID+100（§5.2）；槽位口径：1-12 银槽、13 起金槽（常量在 core/fc26.ts，
// 与后端筛选共用一份 —— 两边各写一次「>= 100」就是下次改段界时的漂移入口）
export function playstyleIsGold(psid: number, slot: number): boolean {
  return isGoldPlaystyleId(psid) || slot > PS_SILVER_SLOT_COUNT;
}

export interface PlaystyleBadgeSlot {
  psid: number;
  slot: number;
  gold: boolean;
}

// 属性页的徽章清单：扫全 15 槽（银 1-12 + 金 13-15），只收有值的槽 —— 空槽不出现在清单里，
// 免得铺一排「未设置」。扫描本身在 core（后端发放校验走同一份），这里只保留前端的类型别名。
export function playstyleBadges(attrs: Record<string, unknown>): PlaystyleBadgeSlot[] {
  return playstyleSlotsOf(attrs);
}

export function playstyleIconUrl(id: number): string {
  return `/assets/icons/playstyles/${id}.webp`;
}

// 细分属性中文名（34 项，顺序 = FC26 的细分属性列顺序，与 players-library.ts 的 ATTR_KEYS、
// 后端 FC26_GAME_ATTR_COLUMNS 逐序对齐）。
// 增量 27 步骤 2：原先这份表只活在 pages/Player.tsx 里，筛选面板的下拉只好铺英文键；提到这里
// 两处共用一份 —— 各留一份就多一次「下拉里是 sprintspeed、属性页写冲刺速度」的漂移机会。
// 顺序与完整性由 web/src/lib/ref.test.ts 与 ATTR_KEYS 逐序比对兜底。
export const ATTR_LABELS: Record<string, string> = {
  sprintspeed: '冲刺速度',
  acceleration: '加速',
  finishing: '终结',
  positioning: '跑位',
  shotpower: '射门力量',
  longshots: '远射',
  penalties: '点球',
  volleys: '凌空',
  vision: '视野',
  crossing: '传中',
  freekickaccuracy: '任意球',
  longpassing: '长传',
  shortpassing: '短传',
  curve: '弧线',
  agility: '敏捷',
  balance: '平衡',
  reactions: '反应',
  composure: '沉着',
  ballcontrol: '控球',
  dribbling: '盘带',
  interceptions: '拦截',
  headingaccuracy: '头球精度',
  defensiveawareness: '防守意识',
  standingtackle: '站立抢断',
  slidingtackle: '铲断',
  jumping: '弹跳',
  stamina: '体力',
  strength: '力量',
  aggression: '侵略性',
  gkdiving: '扑救',
  gkhandling: '手型',
  gkkicking: '开球',
  gkpositioning: '站位',
  gkreflexes: '反应扑救',
};

// 属性组（增量 6.1 d10 四裁决：六组速查卡；门将追加 GKP 共七组；组值=组内平均）。
// 增量 27 步骤 2：筛选面板的「属性」下拉按这份表分七组小标题，与属性页速查卡同一套分组。
export const ATTR_GROUPS = [
  { key: 'PAC', label: '速度', keys: ['sprintspeed', 'acceleration'] },
  { key: 'SHO', label: '射门', keys: ['finishing', 'positioning', 'shotpower', 'longshots', 'penalties', 'volleys'] },
  { key: 'PAS', label: '传球', keys: ['vision', 'crossing', 'freekickaccuracy', 'longpassing', 'shortpassing', 'curve'] },
  { key: 'DRI', label: '盘带', keys: ['agility', 'balance', 'reactions', 'composure', 'ballcontrol', 'dribbling'] },
  { key: 'DEF', label: '防守', keys: ['interceptions', 'headingaccuracy', 'defensiveawareness', 'standingtackle', 'slidingtackle'] },
  { key: 'PHY', label: '体格', keys: ['jumping', 'stamina', 'strength', 'aggression'] },
  { key: 'GKP', label: '门将', keys: ['gkdiving', 'gkhandling', 'gkkicking', 'gkpositioning', 'gkreflexes'] },
] as const;

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

// 转会单据类型（transfers.type）：球员转会记录与转会市场两处共用，原先只写在 MarketPage 里
export const TRANSFER_TYPE_LABEL: Record<string, string> = {
  transfer: '普通成交',
  activation: '激活成交',
  forced_auction: '强制拍卖',
  rc_change: '续约',
  termination: '解约',
  free_agent: '海捞签入',
  match: '匹配留队',
};

export const LEAGUE_TIER_LABEL: Record<string, string> = {
  premier: '顶级联赛',
  second: '次级联赛',
};
