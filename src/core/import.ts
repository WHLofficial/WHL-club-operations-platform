// 球员导入管线（TECH_DESIGN §5.4）：前端 SheetJS 解析出「表头→值」行，本模块在
// Worker 侧做 schema 校验与归一化——预览与确认走同一函数，确认前必再校验一遍。
// upsert 幂等只写 FC 源列（route 层），绝不触碰运营列（status/contracts/badges/growth/market_value/agent_tier）；
// club_id 是唯一例外——新插入时写 CPU 队球员的队籍（增量 14），冲突时不更新，免得覆盖认领/解约后的归属。
import {
  CHINA_NA_ID,
  FC26_CPU_TEAM_IDS,
  FC26_GAME_ATTR_COLUMNS,
  FC26_REQUIRED_COLUMNS,
  FC_EDITOR_GAME_ATTR_COLUMNS,
  FC_EDITOR_REQUIRED_COLUMNS,
  normalizeTeamId,
  POSITION_BY_ID,
  POSITION_NAMES,
} from './fc26.ts';
import { S1_GROWABLE_AGE_CAP, TRAINEE_RC, TRAINEE_WAGE } from './squad-rules.ts';

export type ImportChannel = 'A' | 'B';

export interface ImportRowError {
  row: number; // 数据行号（1 起，不含表头）
  field: string;
  message: string;
}

export interface NormalizedPlayer {
  fcId: number;
  uid: string;
  name: string;
  ca: number;
  pa: number;
  age: number | null;
  foot: 0 | 1;
  position: string | null;
  /** CPU 队球员的队籍（游戏真队 id，增量 14）；其余导入行 null——队籍由合同认领流程建立 */
  clubId: number | null;
  prestige: number | null;
  chinaPlan: 0 | 1;
  futureStarSuggestion: boolean;
  /** 可成长初始判定（规则 4.1.1：第一赛季 ≤25 岁）；之后由赛季结算重判 */
  growableSuggestion: boolean;
  gameAttrs: Record<string, unknown>;
}

export interface NormalizeOutcome {
  players: NormalizedPlayer[];
  errors: ImportRowError[];
  /** 警告清单（增量 22 I4）：脏值已按安全口径落库但不静默——预览页展示供人工扫一眼，不挡确认 */
  warnings: ImportRowError[];
}

export const IMPORT_ROW_LIMIT = 5000; // §5.4：单批 ≤5000 行事务提交，超量由前端切片

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function missingColumns(rows: Record<string, unknown>[], required: readonly string[]): string[] {
  if (rows.length === 0) return [];
  return required.filter((col) => !(col in rows[0]));
}

/** 导入时只给 CPU 队球员写队籍（增量 14）：4 支 CPU 队在平台有 clubs 行，其球员带 club_id。 */
function clubIdForTeam(teamId: unknown): number | null {
  const id = normalizeTeamId(teamId);
  return id !== null && FC26_CPU_TEAM_IDS.has(id) ? id : null;
}

export function normalizeImportBatch(
  channel: ImportChannel,
  rows: Record<string, unknown>[],
  futureStarIds: ReadonlySet<number> = new Set(),
): NormalizeOutcome {
  const players: NormalizedPlayer[] = [];
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];

  const required = channel === 'A' ? FC26_REQUIRED_COLUMNS : FC_EDITOR_REQUIRED_COLUMNS;
  const absent = missingColumns(rows, required);
  if (absent.length > 0) {
    throw new RangeError(`缺少必需列：${absent.join('、')}`);
  }
  if (rows.length > IMPORT_ROW_LIMIT) {
    throw new RangeError(`单批最多 ${IMPORT_ROW_LIMIT} 行，请分批提交`);
  }

  const seen = new Set<number>();

  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const fail = (field: string, message: string) => errors.push({ row: rowNo, field, message });
    const warn = (field: string, message: string) => warnings.push({ row: rowNo, field, message });

    if (channel === 'A') {
      const fcId = toNum(raw['ID']);
      const name = toStr(raw['Name']);
      const age = toNum(raw['Age']);
      const ca = toNum(raw['CA']);
      const pa = toNum(raw['PA']);
      const naId = toNum(raw['naID']);
      const posId1 = toNum(raw['PosID1']);
      const footId = toNum(raw['FootID']);

      if (fcId === null || !Number.isInteger(fcId)) return fail('ID', 'ID 必须是整数');
      if (seen.has(fcId)) return fail('ID', `同批重复 ID：${fcId}`);
      seen.add(fcId);
      if (name === '') return fail('Name', '姓名不能为空');
      if (age === null || age < 14 || age > 50) return fail('Age', '年龄须在 14-50 之间');
      if (ca === null || ca < 1 || ca > 99) return fail('CA', 'CA 须在 1-99 之间');
      if (pa === null || pa < 1 || pa > 99) return fail('PA', 'PA 须在 1-99 之间');
      if (naId === null) return fail('naID', 'naID 缺失');
      // naID 值域（增量 22 I4）：NationID 是 1-1000 量级的整数，域外一定是源文件脏值
      if (!Number.isInteger(naId)) return fail('naID', 'naID 必须是整数');
      if (naId < 1 || naId > 1000) return fail('naID', 'naID 须在 1-1000 之间');
      if (footId !== 1 && footId !== 2) return fail('FootID', 'FootID 只能是 1（右脚）或 2（左脚）');

      let position: string | null = null;
      if (posId1 !== null && posId1 !== -1) {
        position = POSITION_BY_ID[posId1] ?? null;
        if (position === null) return fail('PosID1', `未知的位置 ID：${posId1}`);
      }

      const rep = toNum(raw['internationalrep']);
      const prestige = rep === null ? null : rep;

      const gameAttrs: Record<string, unknown> = {};
      for (const col of FC26_GAME_ATTR_COLUMNS) gameAttrs[col] = raw[col] ?? null;
      gameAttrs['TeamID'] = normalizeTeamId(raw['TeamID']);
      // TeamID 脏值不挡行（按无队籍落库），但出警告清单供人工核对（增量 22 I4）
      if (gameAttrs['TeamID'] === null && toStr(raw['TeamID']) !== '') {
        warn('TeamID', `TeamID「${toStr(raw['TeamID'])}」无法解析，按无队籍处理`);
      }

      players.push({
        fcId,
        uid: `fc${fcId}`,
        name,
        ca: ca!,
        pa: pa!,
        age,
        foot: footId === 2 ? 0 : 1,
        position,
        clubId: clubIdForTeam(raw['TeamID']),
        prestige,
        chinaPlan: naId === CHINA_NA_ID ? 1 : 0,
        futureStarSuggestion: futureStarIds.has(fcId),
        growableSuggestion: age !== null && age <= S1_GROWABLE_AGE_CAP,
        gameAttrs,
      });
      return;
    }

    // 通道 B：FC Editor s901 队壳文件
    const fcId = toNum(raw['playerid']);
    if (fcId === null || !Number.isInteger(fcId)) return fail('playerid', 'playerid 必须是整数');
    if (seen.has(fcId)) return fail('playerid', `同批重复 ID：${fcId}`);
    seen.add(fcId);

    const common = toStr(raw['commonname']);
    const first = toStr(raw['firstname']);
    const last = toStr(raw['lastname']);
    const name = common || `${first} ${last}`.trim();
    if (name === '') return fail('commonname', '姓名不能为空（commonname/firstname/lastname 都缺）');

    const ca = toNum(raw['overallrating']);
    const pa = toNum(raw['potential']);
    if (ca === null || ca < 1 || ca > 99) return fail('overallrating', 'overallrating 须在 1-99 之间');
    if (pa === null || pa < 1 || pa > 99) return fail('potential', 'potential 须在 1-99 之间');

    const age = ageFromBirthdate(toStr(raw['birthdate']));
    if (age === null) return fail('birthdate', '出生日期格式应为 DD/MM/YYYY');
    if (age < 14 || age > 50) return fail('birthdate', '按出生日期推算的年龄须在 14-50 之间');

    const footText = toStr(raw['preferredfoot']).toLowerCase();
    if (footText !== 'right' && footText !== 'left') return fail('preferredfoot', 'preferredfoot 只能是 Right 或 Left');

    const posText = toStr(raw['Position']);
    let position: string | null = null;
    if (posText !== '' && posText.toLowerCase() !== 'none') {
      if (!POSITION_NAMES.includes(posText)) return fail('Position', `位置「${posText}」不在 PositionID 表内`);
      position = posText;
    }

    const gameAttrs: Record<string, unknown> = {};
    for (const col of FC_EDITOR_GAME_ATTR_COLUMNS) gameAttrs[col] = raw[col] ?? null;
    gameAttrs['teamid'] = normalizeTeamId(raw['teamid']);
    if (gameAttrs['teamid'] === null && toStr(raw['teamid']) !== '') {
      warn('teamid', `teamid「${toStr(raw['teamid'])}」无法解析，按无队籍处理`);
    }

    // 通道 B 的 nationality 非必需列：缺省按无中国计划；给了值但不在值域内挡行
    const nationality = toNum(raw['nationality']);
    if (nationality !== null && (!Number.isInteger(nationality) || nationality < 1 || nationality > 1000)) {
      return fail('nationality', 'nationality 须为 1-1000 之间的整数');
    }

    players.push({
      fcId,
      uid: `fc${fcId}`,
      name,
      ca: ca!,
      pa: pa!,
      age,
      foot: footText === 'left' ? 0 : 1,
      position,
      clubId: clubIdForTeam(raw['teamid']),
      prestige: null, // FC Editor 无国际声望列
      chinaPlan: toNum(raw['nationality']) === CHINA_NA_ID ? 1 : 0,
      futureStarSuggestion: futureStarIds.has(fcId),
      growableSuggestion: age !== null && age <= S1_GROWABLE_AGE_CAP,
      gameAttrs,
    });
  });

  return { players, errors, warnings };
}

// FC Editor 出生日期 DD/MM/YYYY → 按导入日推算年龄（FC26db 无出生日期，年龄按库内值）
function ageFromBirthdate(text: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    return null;
  }
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() < month - 1 ||
    (now.getUTCMonth() === month - 1 && now.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

// ---- 通道 C · 名单合同模板（管理组 CSV → contracts 初建，§5.4） ----
// 前端把 CSV 表头（uid/RC/工资/效力起点/类型 及别名）映射成下列规范键再提交。

export const CONTRACT_REQUIRED_COLUMNS = ['uid', 'releaseFee', 'wage', 'effectiveFrom', 'contractType'] as const;

export interface NormalizedContract {
  rowNo: number; // 数据行号（1 起，不含表头），分类报错用
  fcId: number;
  uid: string;
  releaseFee: number;
  wage: number;
  contractType: 'formal' | 'trainee';
  effectiveFrom: string; // YYYY-MM-DD
}

export interface ContractNormalizeOutcome {
  contracts: NormalizedContract[];
  errors: ImportRowError[];
}

export const CONTRACT_ROW_LIMIT = 2000; // 一队名单 ≤37 人，整联赛一批也用不满，给足余量即可

export function normalizeContractBatch(rows: Record<string, unknown>[]): ContractNormalizeOutcome {
  const contracts: NormalizedContract[] = [];
  const errors: ImportRowError[] = [];

  const absent = CONTRACT_REQUIRED_COLUMNS.filter((col) => rows.length > 0 && !(col in rows[0]));
  if (absent.length > 0) throw new RangeError(`缺少必需列：${absent.join('、')}`);
  if (rows.length > CONTRACT_ROW_LIMIT) throw new RangeError(`单批最多 ${CONTRACT_ROW_LIMIT} 行`);

  const seen = new Set<number>();
  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const fail = (field: string, message: string) => errors.push({ row: rowNo, field, message });

    const uidText = toStr(raw['uid']);
    const m = /^(?:fc)?(\d+)$/i.exec(uidText);
    if (!m) return fail('uid', 'uid 应为球员 ID 数字或 fc{ID}');
    const fcId = Number(m[1]);
    if (seen.has(fcId)) return fail('uid', `同批重复 uid：${uidText}`);
    seen.add(fcId);

    const releaseFee = toNum(raw['releaseFee']);
    if (releaseFee === null || releaseFee <= 0 || releaseFee > 1000) {
      return fail('releaseFee', '违约金 RC 须为 0-1000 之间的数值（m）');
    }

    const wage = toNum(raw['wage']);
    if (wage === null || wage < 0 || wage > 100) return fail('wage', '工资须为 0-100 之间的数值（m/半赛季）');

    const typeText = toStr(raw['contractType']).toLowerCase();
    const contractType: 'formal' | 'trainee' | null =
      typeText === 'formal' || typeText === '正式' ? 'formal' : typeText === 'trainee' || typeText === '训练营' ? 'trainee' : null;
    if (contractType === null) return fail('contractType', '类型只能是 formal（正式）或 trainee（训练营）');
    if (contractType === 'trainee') {
      // 规则 4.3.4：训练营合同工资固定 0.75m/半赛季、违约金固定 5m
      if (wage !== TRAINEE_WAGE) return fail('wage', `训练营合同工资固定为 ${TRAINEE_WAGE} m/半赛季`);
      if (releaseFee !== TRAINEE_RC) return fail('releaseFee', `训练营合同违约金固定为 ${TRAINEE_RC} m`);
    }

    const fromText = toStr(raw['effectiveFrom']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromText)) return fail('effectiveFrom', '效力起点格式应为 YYYY-MM-DD');
    const d = new Date(`${fromText}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fromText) {
      return fail('effectiveFrom', `效力起点不是有效日期：${fromText}`);
    }

    contracts.push({
      rowNo,
      fcId,
      uid: `fc${fcId}`,
      releaseFee: releaseFee!,
      wage: wage!,
      contractType,
      effectiveFrom: fromText,
    });
  });

  return { contracts, errors };
}
