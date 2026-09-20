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

// 队 id 归一化（增量 14，用户裁决 2026-09-18）：游戏内必须用假名的 4 支俱乐部，第三方 fixed 快照
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
