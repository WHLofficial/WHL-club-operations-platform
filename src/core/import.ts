// 球员导入管线（TECH_DESIGN §5.4）：前端 SheetJS 解析出「表头→值」行，本模块在
// Worker 侧做 schema 校验与归一化——预览与确认走同一函数，确认前必再校验一遍。
// upsert 幂等只写 FC 源列（route 层），绝不触碰运营列（club_id/status/contracts/badges/growth/market_value/agent_tier）。
import {
  CHINA_NA_ID,
  FC26_GAME_ATTR_COLUMNS,
  FC26_REQUIRED_COLUMNS,
  FC_EDITOR_GAME_ATTR_COLUMNS,
  FC_EDITOR_REQUIRED_COLUMNS,
  POSITION_BY_ID,
  POSITION_NAMES,
} from './fc26.ts';

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
  prestige: number | null;
  chinaPlan: 0 | 1;
  futureStarSuggestion: boolean;
  gameAttrs: Record<string, unknown>;
}

export interface NormalizeOutcome {
  players: NormalizedPlayer[];
  errors: ImportRowError[];
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

export function normalizeImportBatch(
  channel: ImportChannel,
  rows: Record<string, unknown>[],
  futureStarIds: ReadonlySet<number> = new Set(),
): NormalizeOutcome {
  const players: NormalizedPlayer[] = [];
  const errors: ImportRowError[] = [];

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

      players.push({
        fcId,
        uid: `fc${fcId}`,
        name,
        ca: ca!,
        pa: pa!,
        age,
        foot: footId === 2 ? 0 : 1,
        position,
        prestige,
        chinaPlan: naId === CHINA_NA_ID ? 1 : 0,
        futureStarSuggestion: futureStarIds.has(fcId),
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

    players.push({
      fcId,
      uid: `fc${fcId}`,
      name,
      ca: ca!,
      pa: pa!,
      age,
      foot: footText === 'left' ? 0 : 1,
      position,
      prestige: null, // FC Editor 无国际声望列
      chinaPlan: toNum(raw['nationality']) === CHINA_NA_ID ? 1 : 0,
      futureStarSuggestion: futureStarIds.has(fcId),
      gameAttrs,
    });
  });

  return { players, errors };
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
