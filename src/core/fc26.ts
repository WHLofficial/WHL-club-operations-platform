// FC 源列口径（TECH_DESIGN §5.2/§5.4）——对照 FC26db20251217_fixed.xlsx（Base 94 列）
// 与 FC Editor s901 队壳文件（61 列）逐一核对；两源 playerid = ID 同键。
// 存储裁决：查找类只存 ID、名称由前端按 web/assets/ref/*.json 渲染；惯用脚归一化进 players.foot。

export const CHINA_NA_ID = 155; // NationID：China PR（通道 A naID / 通道 B nationality 同表判定）

// PositionID 表（12 个实位 + '-' 占位；FC26db 与 FC Editor Position 文本同集）
export const POSITION_BY_ID: Record<number, string> = {
  0: 'GK',
  3: 'RB',
  5: 'CB',
  7: 'LB',
  10: 'CDM',
  12: 'RM',
  14: 'CM',
  16: 'LM',
  18: 'CAM',
  23: 'RW',
  25: 'ST',
  27: 'LW',
};

export const POSITION_NAMES: readonly string[] = Object.values(POSITION_BY_ID);

// 位置四档（v3.4.0 步骤 11a，用户裁决 2026-09-22）：球队页讲结构只讲「门将/后卫/中场/前锋」，
// 细位（RB/CB/LB…）是数据、四档是叙事。细位表仍是 POSITION_BY_ID，这里只加一层归组，不改数据口径。
export const POSITION_GROUP_BY_POSITION: Record<string, string> = {
  GK: 'GK',
  RB: 'DF',
  CB: 'DF',
  LB: 'DF',
  CDM: 'MF',
  RM: 'MF',
  CM: 'MF',
  LM: 'MF',
  CAM: 'MF',
  RW: 'FW',
  ST: 'FW',
  LW: 'FW',
};

// 档序即展示序（后场到前场）
export const POSITION_GROUPS: readonly { key: string; label: string }[] = [
  { key: 'GK', label: '门将' },
  { key: 'DF', label: '后卫' },
  { key: 'MF', label: '中场' },
  { key: 'FW', label: '前锋' },
];

// 队 id 归一化（v2.0.0，用户裁决 2026-09-18）：游戏内必须用假名的 4 支俱乐部，第三方 fixed 快照
// （gen_ref_json.py 的源）仍带旧 FIFA 号，游戏真表（EAFC 26 IDs.xlsx）用新号。平台统一以游戏真 id
// 为口径——clubs.id 与 players.club_id 都落真号，显示名由 web/assets/ref/team.json 给真名。
export const FC26_TEAM_ID_ALIASES: Record<number, number> = {
  39: 115845, // Atalanta → 游戏内 Bergamo Calcio
  44: 131682, // Inter → 游戏内 Lombardia FC
  46: 115841, // Lazio → 游戏内 Latium
  47: 131681, // AC Milan → 游戏内 Milano FC
};

/** 归一化队 id：legacy 假名队号换成游戏真号，其余原样；非整数返回 null（= 无队籍/自由身）。 */
export function normalizeTeamId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isInteger(n)) return null;
  return FC26_TEAM_ID_ALIASES[n] ?? n;
}

// 比赛系统里的 4 支 CPU 队。2026-09-19 起 tour 的 team.id 与 auth 的 tour_team_id 都已是游戏真号
// （10 曼城 / 241 巴塞罗那 / 112172 RB莱比锡 / 131681 AC米兰），这里就是真号本身；
// 早先「tour 内编号 16/6/19/21」的口径已作废。只有这些队在建档导入时写 players.club_id——
// 其余球队的球员保持无归属，队籍靠合同认领流程建立。
export const FC26_CPU_TEAM_IDS: ReadonlySet<number> = new Set([10, 241, 112172, 131681]);

// 通道 A（FC26db Base）必需列；值域：CA/PA 1-99、Age 14-50（§5.4 列校验）
export const FC26_REQUIRED_COLUMNS = ['ID', 'Name', 'Age', 'CA', 'PA', 'naID', 'PosID1', 'FootID'] as const;

// 通道 A game_attrs 白名单：ID 键列 + 非查找原值列（含 34 细分属性），71 列。
// 不落库：Name、FootID/Foot（归一化进 foot）、Team/nationality/Position1-4/Role1-5/PlayStyles1-8/PlayStyles+（文本列）。
export const FC26_GAME_ATTR_COLUMNS: readonly string[] = [
  'ID',
  'Age',
  'CA',
  'PA',
  'height',
  'weight',
  'weakfoot',
  'skillmoves',
  'hashighqualityhead',
  'internationalrep',
  'naID',
  'TeamID',
  'PosID1',
  'PosID2',
  'PosID3',
  'PosID4',
  'RoleID1',
  'RoleID2',
  'RoleID3',
  'RoleID4',
  'RoleID5',
  'PSID1',
  'PSID2',
  'PSID3',
  'PSID4',
  'PSID5',
  'PSID6',
  'PSID7',
  'PSID8',
  'PSID9',
  'PSID10',
  'PSID11',
  'PSID12',
  'PSID13',
  'PSID14',
  'PSID15',
  'NumofPS',
  'sprintspeed',
  'acceleration',
  'finishing',
  'positioning',
  'shotpower',
  'longshots',
  'penalties',
  'volleys',
  'vision',
  'crossing',
  'freekickaccuracy',
  'longpassing',
  'shortpassing',
  'curve',
  'agility',
  'balance',
  'reactions',
  'composure',
  'ballcontrol',
  'dribbling',
  'interceptions',
  'headingaccuracy',
  'defensiveawareness',
  'standingtackle',
  'slidingtackle',
  'jumping',
  'stamina',
  'strength',
  'aggression',
  'gkdiving',
  'gkhandling',
  'gkkicking',
  'gkpositioning',
  'gkreflexes',
];

// PlayStyle 槽位与两段 ID 口径（TECH_DESIGN §5.2）：15 个槽里 1-12 是银槽、13-15 是金槽；
// 金徽落库时存「基础 ID + 100」，于是银段 1-99、金段 101-199 互不重叠（100 是空档）。
// 后端筛选、前端下拉与两侧 URL 白名单共用这一份，别再各自写 1-99 这样的字面量。
export const PS_SLOT_COUNT = 15;
// 槽位键清单（PSID1..PSID15）。属性页原先手抄了 PSID1-7 + PSID13-15 十个键，落在 PSID8-12 的
// 银徽章因此「可筛不可见」（v3.2.1 收口）；由槽数派生，免得多一个改段界时的漂移点。
export const PS_SLOT_KEYS: readonly string[] = Array.from(
  { length: PS_SLOT_COUNT },
  (_, i) => `PSID${i + 1}`,
);
export const PS_SILVER_SLOT_COUNT = 12;
export const PS_GOLD_BASE = 100;
export const PS_SILVER_MAX = 99;
export const PS_GOLD_MIN = PS_GOLD_BASE + 1;
export const PS_GOLD_MAX = PS_GOLD_BASE + PS_SILVER_MAX;

// 合法的 PlayStyle 筛选值：银段 1-99 或金段 101-199
export function isPlaystyleId(n: number): boolean {
  return Number.isInteger(n) && ((n >= 1 && n <= PS_SILVER_MAX) || (n >= PS_GOLD_MIN && n <= PS_GOLD_MAX));
}

// ps 筛选一次最多接受多少个值：每个值要铺 12-15 个槽位条件，地址栏手改能塞进任意长的清单
// （面板实际能勾 72 项 —— 银 36 + 金 36，100 是给 ref 表扩项留的余量）
export const PS_FILTER_MAX_ITEMS = 100;

// 金徽章：ID 落在金段（= 基础 ID + 100），只可能出现在金槽里
export function isGoldPlaystyleId(n: number): boolean {
  return n >= PS_GOLD_MIN;
}

// 可发放的 PlayStyle 基础 ID 白名单（v3.3.0）：FC26 一共 36 个基础项，金徽 = 基础 ID + 100，
// 一份 36 项清单同时管住两段；与 web/assets/ref/playstyle.json 的银段逐项对齐（测试守住）。
// 升级方案与中国计划只从这里发放 —— 光有「银 1-99 ∪ 金 101-199」的段界拦不住库里没有的 ID。
export const PS_GRANTABLE_BASE_IDS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8,
  11, 12, 13, 14, 15, 16,
  21, 22, 23, 24, 25, 26,
  31, 32, 33, 34, 35,
  41, 42, 43, 44, 45,
  51, 52, 53, 54, 55, 56,
];

export type PlaystyleKind = 'silver' | 'gold';

// 存库 ID → 基础 ID（银徽原样、金徽减 100）
export function basePlaystyleId(psid: number): number {
  return isGoldPlaystyleId(psid) ? psid - PS_GOLD_BASE : psid;
}

// 基础 ID → 存库 ID（银徽原样、金徽加 100）
export function playstyleIdOf(baseId: number, kind: PlaystyleKind): number {
  return kind === 'gold' ? baseId + PS_GOLD_BASE : baseId;
}

export function playstyleKindOf(psid: number): PlaystyleKind {
  return isGoldPlaystyleId(psid) ? 'gold' : 'silver';
}

export function isGrantablePlaystyleId(psid: number): boolean {
  return isPlaystyleId(psid) && PS_GRANTABLE_BASE_IDS.includes(basePlaystyleId(psid));
}

// 槽位段界：银 1-12、金 13-15（发放落槽与筛选铺条件共用，别再各写一次段界）
export function playstyleSlotRange(kind: PlaystyleKind): { min: number; max: number } {
  return kind === 'gold'
    ? { min: PS_SILVER_SLOT_COUNT + 1, max: PS_SLOT_COUNT }
    : { min: 1, max: PS_SILVER_SLOT_COUNT };
}

// 该段里最小的空槽；段满返回 null
export function nextFreePlaystyleSlot(kind: PlaystyleKind, usedSlots: readonly number[]): number | null {
  const { min, max } = playstyleSlotRange(kind);
  for (let slot = min; slot <= max; slot += 1) {
    if (!usedSlots.includes(slot)) return slot;
  }
  return null;
}

export interface PlaystyleSlot {
  slot: number;
  psid: number;
  gold: boolean;
}

// 按槽位键扫全 15 槽取球员已有的 PlayStyle（FC 源数据那一份）：空槽 / 0 / 非数字都不产出条目，
// 免得铺一排「未设置」。属性页清单与后端发放校验共用，槽位口径只留 core 这一处。
export function playstyleSlotsOf(attrs: Record<string, unknown>): PlaystyleSlot[] {
  return PS_SLOT_KEYS.flatMap((key, i) => {
    const psid = Number(attrs[key]);
    if (!Number.isInteger(psid) || psid <= 0) return [];
    const slot = i + 1;
    return [{ slot, psid, gold: isGoldPlaystyleId(psid) || slot > PS_SILVER_SLOT_COUNT }];
  });
}

export interface PlaystylePickPlan {
  /** 本次要发放的银 / 金数量（来自升级方案或中国计划） */
  silverCount: number;
  goldCount: number;
  /** 球员已拥有的 PlayStyle（存库形式）：FC 源槽 + 既有发放明细 */
  ownedPsids: readonly number[];
  /** 球员已占用的槽位号：FC 源槽 + 既有发放明细 */
  usedSlots: readonly number[];
}

export type PlaystylePickOutcome =
  | { ok: true; slots: PlaystyleSlot[] }
  | { ok: false; message: string };

// picks 校验与落槽（纯函数，写库前先把话说清楚）：picks 用存库形式（银 1-99 / 金 101-199），
// kind 由 ID 自己决定，所以调用方不必额外声明哪几个是金的。
export function planPlaystylePicks(picks: readonly number[], plan: PlaystylePickPlan): PlaystylePickOutcome {
  const silver: number[] = [];
  const gold: number[] = [];
  for (const psid of picks) {
    if (!isGrantablePlaystyleId(psid)) {
      return { ok: false, message: `PlayStyle ${psid} 不在可发放清单里` };
    }
    const bucket = playstyleKindOf(psid) === 'gold' ? gold : silver;
    if (bucket.includes(psid)) return { ok: false, message: '同一个 PlayStyle 不能在同一段里选两次' };
    if (plan.ownedPsids.includes(psid)) {
      return { ok: false, message: `PlayStyle ${psid} 已经在这名球员身上了` };
    }
    bucket.push(psid);
  }
  if (silver.length !== plan.silverCount) {
    return { ok: false, message: `本次要发 ${plan.silverCount} 个银 PlayStyle，收到 ${silver.length} 个` };
  }
  if (gold.length !== plan.goldCount) {
    return { ok: false, message: `本次要发 ${plan.goldCount} 个金 PlayStyle，收到 ${gold.length} 个` };
  }
  const usedSlots = [...plan.usedSlots];
  const slots: PlaystyleSlot[] = [];
  const assign = (kind: PlaystyleKind, ids: readonly number[]): string | null => {
    for (const psid of ids) {
      const slot = nextFreePlaystyleSlot(kind, usedSlots);
      if (slot === null) {
        const total = playstyleSlotRange(kind).max - playstyleSlotRange(kind).min + 1;
        return `${kind === 'gold' ? '金' : '银'}槽已满（${total} 个）`;
      }
      usedSlots.push(slot);
      slots.push({ slot, psid, gold: kind === 'gold' });
    }
    return null;
  };
  const silverIssue = assign('silver', silver);
  if (silverIssue !== null) return { ok: false, message: silverIssue };
  const goldIssue = assign('gold', gold);
  if (goldIssue !== null) return { ok: false, message: goldIssue };
  return { ok: true, slots };
}

// 属性页清单 = FC 源槽 + 发放明细。发放时已排除「已拥有」，但大换版折算后 FC 源数据整列换新，
// 可能与留下的明细行撞同一项 ⇒ 按 (段, 基础 ID) 去重，撞了以 FC 源为准（那一份跟着版本走）。
export interface GrantedPlaystyleSlot {
  slot: number;
  kind: PlaystyleKind;
  /** 基础 ID（1-99） */
  psid: number;
}

export function mergePlaystyleSlots(
  fc: readonly PlaystyleSlot[],
  granted: readonly GrantedPlaystyleSlot[],
): PlaystyleSlot[] {
  const out: PlaystyleSlot[] = fc.map((s) => ({ slot: s.slot, psid: s.psid, gold: s.gold }));
  const seen = new Set(fc.map((s) => `${s.gold ? 'gold' : 'silver'}:${basePlaystyleId(s.psid)}`));
  for (const g of granted) {
    const key = `${g.kind}:${g.psid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slot: g.slot, psid: playstyleIdOf(g.psid, g.kind), gold: g.kind === 'gold' });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

// 通道 B（FC Editor s901）必需列；姓名列 commonname/firstname/lastname 缺一可用
export const FC_EDITOR_REQUIRED_COLUMNS = [
  'playerid',
  'overallrating',
  'potential',
  'Position',
  'preferredfoot',
] as const;

// 通道 B game_attrs：61 列原文归档。role/playstyles 虽是文本，但**有反查表**：
// web/assets/ref/{role,playstyle,position}.json（由 scripts/gen_ref_json.py 从同一份 FC26db 源生成，
// 源文件 E:\Downloads\FC26db20251217_fixed.xlsx 的 RoleID / PlayStyleID / PositionID 三张表），
// 可把文本还原成 RoleID1-5 / PSID1-15 的数字 ID。两条映射陷阱：
//   ① 连字符 —— s901 写 `CM Half Winger +`，表里是 `CM Half-Winger +`（`++` = 基础 ID + 100）；
//   ② `Playstyles+` 列给的是**基础名**（如 `Enforcer`），落库要 +100 进金槽 PSID13-15。
// `Playstyles` 列里的 `One club player` / `Injury prone` 不在 PlayStyleID 表内（生涯特性，非花式）⇒ 丢弃。
export const FC_EDITOR_GAME_ATTR_COLUMNS: readonly string[] = [
  'playerid',
  'firstname',
  'lastname',
  'commonname',
  'Position',
  'Position2',
  'Position3',
  'Position4',
  'number',
  'teamid',
  'playerjointeamdate',
  'contractvaliduntil',
  'overallrating',
  'potential',
  'birthdate',
  'nationality',
  'preferredfoot',
  'weakfootabilitytypecode',
  'height',
  'weight',
  'finishing',
  'headingaccuracy',
  'longshots',
  'shotpower',
  'volleys',
  'crossing',
  'longpassing',
  'shortpassing',
  'ballcontrol',
  'curve',
  'dribbling',
  'defensiveawareness',
  'slidingtackle',
  'standingtackle',
  'aggression',
  'composure',
  'interceptions',
  'positioning',
  'reactions',
  'vision',
  'acceleration',
  'agility',
  'balance',
  'jumping',
  'sprintspeed',
  'stamina',
  'strength',
  'freekickaccuracy',
  'penalties',
  'gkdiving',
  'gkhandling',
  'gkkicking',
  'gkpositioning',
  'gkreflexes',
  'role1',
  'role2',
  'role3',
  'role4',
  'role5',
  'Playstyles',
  'Playstyles+',
];
