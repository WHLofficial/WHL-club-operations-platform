// S9 能力导入（FC Editor s901 → 生产 players）离线 SQL 生成器
//
// 为什么不走端上导入：`/api/admin/players/import/confirm` 与管理端会话绑定（通道 B 还会整行覆盖，
// 见 README §4 的三条破坏性副作用），脚本拿不到 OIDC 会话；本生成器只读生产库抓旧值，产出可直接
// `wrangler d1 execute --file` 的 SQL 分片。
//
// 口径（用户 2026-09-20 裁定，README §6 记为本批 Case B）：
//   只改「现值」列 —— players.ca / players.pa / game_attrs 里的 34 项能力项 / RoleID1-5 / PSID1-15；
//   players.base_ca、game_attrs 的 $.CA、$.PA、height/weight/weakfoot/PosID1-4 一律不动。
//   这批涨幅因此以「成长值」形式存在（delta = ca - base_ca），后续换版按 delta 继承、解约时被剥掉。
//
// 映射：34 项能力项两源同名直连（键名取自 src/core/fc26.ts 的 FC26_GAME_ATTR_COLUMNS，与
// src/worker/routes/players.ts:22 同源切片）；角色/花式文本走 web/assets/ref/{role,playstyle,position}.json
// 反查表；槽位合并为**保序追加、不删既有**（s901 是增量侧，库内是子集）。
//
// 守卫：每行 `WHERE fc_id = ? AND ca = 旧 AND pa = 旧` —— 重放或错版落库时 changes = 0。
//
// 用法：
//   node gen-abilities-sql.ts [源目录] [每片语句数]     生成分片 + 回滚 + 预检/验收 + 报告
//   node gen-abilities-sql.ts --verify                  只读复核：执行后重算，期望「剩余差异 0 行」
//   node gen-abilities-sql.ts --local                   读本地 D1（本地演练用，默认远端只读）
//   node gen-abilities-sql.ts --allow-skipped            允许「报告-only 字段」有差异（默认有差异即中止）

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import { FC26_GAME_ATTR_COLUMNS } from '../../src/core/fc26.ts';

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');
const ALLOW_SKIPPED = FLAGS.has('--allow-skipped');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REF_DIR = join(HERE, '..', '..', 'web', 'assets', 'ref');
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const SRC_DIR = POSITIONAL[0] ?? 'E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901';
const PER_FILE = Number(POSITIONAL[1] ?? 200);
const DB = 'whl-club';
const TS = new Date().toISOString();

// 细分属性：sprintspeed 起共 34 项（与 routes/players.ts 的 ATTR_KEYS 同源，不手抄）
const ATTR_KEYS: readonly string[] = FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed'));
const ROLE_SLOTS = ['RoleID1', 'RoleID2', 'RoleID3', 'RoleID4', 'RoleID5'];
const PS_SLOTS = Array.from({ length: 12 }, (_, i) => `PSID${i + 1}`);
const GOLD_SLOTS = ['PSID13', 'PSID14', 'PSID15'];
const POS_SLOTS = ['PosID1', 'PosID2', 'PosID3', 'PosID4'];
// 只比对、不写库的字段（README §8 裁决点 1 与 3：实测 0 差异 ⇒ 写了等于空写）
const REPORT_ONLY_ATTRS = ['height', 'weight', 'weakfoot'];
// 生涯特性，不在 PlayStyleID 表内（FC26 Base 的文本列同样如此）⇒ 明确丢弃
const DROPPED_TOKENS = new Set(['one club player', 'injury prone']);

type RefRow = { id: number; en?: string; chs?: string; name?: string };
type SrcRow = {
  fcId: number;
  clubId: number;
  clubFile: string;
  ca: number | null;
  pa: number | null;
  attrs: Record<string, number | null>;
  roles: number[];
  ps: number[];
  gold: number[];
  pos: number[];
};
type ProdRow = {
  id: number;
  name: string;
  ca: number | null;
  pa: number | null;
  baseCa: number | null;
  attrs: Record<string, unknown>;
};
type SlotSet = { key: string; next: number | null; prev: number | null; prevRaw: number | null };
type Change = {
  fcId: number;
  clubId: number;
  name: string;
  oldCa: number | null;
  newCa: number | null;
  oldPa: number | null;
  newPa: number | null;
  caChanged: boolean;
  paChanged: boolean;
  sets: SlotSet[];
};

// ---------------------------------------------------------------- 文本归一化与反查

/** 归一化：折叠空白（表里存在双空格，如 `GK Sweeper Keeper  +`）、连字符转空格（s901 写
 *  `CM Half Winger +`，表里是 `CM Half-Winger +`）、小写、去首尾。 */
function normKey(s: string): string {
  return s.trim().replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function loadRef(name: string): { map: Map<string, number>; ids: Set<number>; rows: RefRow[] } {
  const rows = JSON.parse(readFileSync(join(REF_DIR, name), 'utf8')) as RefRow[];
  const map = new Map<string, number>();
  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.id);
    // position.json 是 {id,name}（缩写 GK/ST/CB…），role/playstyle.json 是 {id,en,chs}
    for (const text of [r.en ?? '', r.chs ?? '', r.name ?? '']) {
      const key = normKey(text);
      if (!key || key === '-') continue;
      if (map.has(key) && map.get(key) !== r.id) {
        throw new Error(`反查表 ${name} 归一化冲突：「${text}」→ ${map.get(key)} 与 ${r.id}`);
      }
      map.set(key, r.id);
    }
  }
  return { map, ids, rows };
}

/** 花式金徽（`Playstyles+` 列给基础名）：优先查 `名 + +`，退路是基础 ID + 100。 */
function goldenId(ref: { map: Map<string, number>; ids: Set<number> }, text: string): number | null {
  const plus = ref.map.get(normKey(`${text} +`));
  if (plus != null) return plus;
  const base = ref.map.get(normKey(text));
  if (base != null && ref.ids.has(base + 100)) return base + 100;
  return null;
}

function splitTokens(v: unknown): string[] {
  if (v == null) return [];
  const s = String(v).trim();
  if (!s || s === 'None' || s === '-') return [];
  return s
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && t !== 'None' && t !== '-');
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function lit(v: string | number | null): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------- 源（s901 20 个队壳 xlsx）

function readSource(dir: string, role: ReturnType<typeof loadRef>, ps: ReturnType<typeof loadRef>, posRef: ReturnType<typeof loadRef>) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx')).sort();
  const rows: SrcRow[] = [];
  const unknownRoleTexts = new Map<string, number>();
  const unknownPsTexts = new Map<string, number>();
  const droppedPsTexts = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const file of files) {
    const fileMatch = /^(\d+)\s*-\s*(.+)\.xlsx$/i.exec(file);
    if (!fileMatch) {
      console.warn(`跳过文件名不含俱乐部 id 的文件：${file}`);
      continue;
    }
    const clubId = Number(fileMatch[1]);
    const wb = XLSX.read(readFileSync(join(dir, file)), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    for (const r of sheetRows) {
      const fcId = num(r['playerid']);
      if (fcId == null || fcId <= 0) continue;
      const attrs: Record<string, number | null> = {};
      for (const key of ATTR_KEYS) attrs[key] = num(r[key]);
      const roles: number[] = [];
      for (const col of ['role1', 'role2', 'role3', 'role4', 'role5']) {
        for (const t of splitTokens(r[col])) {
          const id = role.map.get(normKey(t));
          if (id == null) bump(unknownRoleTexts, t);
          else if (!roles.includes(id)) roles.push(id);
        }
      }
      const psIds: number[] = [];
      const goldIds: number[] = [];
      for (const t of splitTokens(r['Playstyles'])) {
        if (DROPPED_TOKENS.has(normKey(t))) {
          bump(droppedPsTexts, t);
          continue;
        }
        const id = ps.map.get(normKey(t));
        if (id == null) bump(unknownPsTexts, t);
        else if (id < 100 && !psIds.includes(id)) psIds.push(id);
        else if (id >= 100 && !goldIds.includes(id)) goldIds.push(id);
      }
      for (const t of splitTokens(r['Playstyles+'])) {
        const id = goldenId(ps, t);
        if (id == null) bump(unknownPsTexts, `${t} +`);
        else if (!goldIds.includes(id)) goldIds.push(id);
      }
      const pos: number[] = [];
      for (const col of ['Position', 'Position2', 'Position3', 'Position4']) {
        for (const t of splitTokens(r[col])) {
          const id = posRef.map.get(normKey(t));
          // 位置表里 GK = 0（是真值），只有 `-` = -1 是空哨兵
          if (id != null && id >= 0 && !pos.includes(id)) pos.push(id);
        }
      }
      rows.push({
        fcId,
        clubId,
        clubFile: file,
        ca: num(r['overallrating']),
        pa: num(r['potential']),
        attrs,
        roles,
        ps: psIds,
        gold: goldIds,
        pos,
      });
    }
  }
  const dupes = new Map<number, number>();
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.fcId)) dupes.set(r.fcId, (dupes.get(r.fcId) ?? 1) + 1);
    seen.add(r.fcId);
  }
  return { rows, unknownRoleTexts, unknownPsTexts, droppedPsTexts, dupes };
}

// ---------------------------------------------------------------- 生产库（只读）

function d1Rows(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  const cmd = `npx wrangler d1 execute ${DB} ${scope} --json --command "${sql}"`;
  const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`wrangler 读取失败（exit ${res.status}）：\n${res.stderr || res.stdout}`);
  }
  const at = res.stdout.indexOf('[');
  if (at < 0) throw new Error(`wrangler 输出不是 JSON：\n${res.stdout.slice(0, 400)}`);
  const parsed = JSON.parse(res.stdout.slice(at)) as Array<{ results?: Record<string, unknown>[] }>;
  return parsed[0]?.results ?? [];
}

function loadProd(fcIds: number[]): Map<number, ProdRow> {
  const out = new Map<number, ProdRow>();
  for (let i = 0; i < fcIds.length; i += 90) {
    const chunk = fcIds.slice(i, i + 90);
    const rows = d1Rows(
      `SELECT id, fc_id, name, ca, pa, base_ca, game_attrs FROM players WHERE fc_id IN (${chunk.join(',')})`,
    );
    for (const r of rows) {
      const fid = Number(r['fc_id']);
      const raw = r['game_attrs'];
      let attrs: Record<string, unknown>;
      try {
        attrs = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        throw new Error(`fc ${fid} 的 game_attrs 不是合法 JSON，无法读当前槽位：${String(raw).slice(0, 80)}`);
      }
      if (attrs == null || typeof attrs !== 'object') {
        throw new Error(`fc ${fid} 的 game_attrs 解析结果不是对象（=${String(raw).slice(0, 40)}），无法读当前槽位`);
      }
      out.set(fid, {
        id: Number(r['id']),
        name: String(r['name'] ?? ''),
        ca: r['ca'] == null ? null : Number(r['ca']),
        pa: r['pa'] == null ? null : Number(r['pa']),
        baseCa: r['base_ca'] == null ? null : Number(r['base_ca']),
        attrs,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 差异计算

/** 库内槽位：角色/花式用 0 表示空槽（FC26 导入写的是 0，不是 null）；位置用 -1 表示 `-`（GK = 0 是真值）。 */
function prodSlots(
  attrs: Record<string, unknown>,
  keys: readonly string[],
  isEmpty: (n: number) => boolean,
): (number | null)[] {
  return keys.map((k) => {
    const v = attrs[k];
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || isEmpty(n)) return null;
    return n;
  });
}

const emptySlot = (n: number) => n <= 0;
const emptyPos = (n: number) => n < 0;

/** 保序追加：保留库内既有槽位，把源里没有的追加到尾部（不删既有、不重排既有）。溢出槽位数一并返回。 */
function mergeSlots(prev: (number | null)[], src: number[]): { slots: (number | null)[]; dropped: number[] } {
  const keep = prev.filter((v): v is number => v != null);
  for (const id of src) if (!keep.includes(id)) keep.push(id);
  const slots = Array.from({ length: prev.length }, (_, i) => keep[i] ?? null);
  return { slots, dropped: keep.slice(prev.length) }; // 列数不够时装不下的部分，不能静默丢
}

type Compute = { changes: Change[]; stats: Record<string, number>; skipped: string[]; overflow: string[] };

function computeChanges(rows: SrcRow[], prod: Map<number, ProdRow>): Compute {
  const stats: Record<string, number> = { rows_matched: 0, stmt_rows: 0, no_diff_rows: 0 };
  for (const key of [...ATTR_KEYS, ...ROLE_SLOTS, ...PS_SLOTS, ...GOLD_SLOTS, ...REPORT_ONLY_ATTRS, 'PosID', 'ca', 'pa', 'base_ca', 'attr_ca', 'attr_pa', 'slots_dropped']) {
    stats[key] = 0;
  }
  stats['rows_touched_field'] = 0; // 占位，稍后重算
  const changes: Change[] = [];
  const skipped: string[] = [];
  const overflow: string[] = [];
  for (const src of rows) {
    const p = prod.get(src.fcId);
    if (!p) throw new Error(`源里的 fc_id ${src.fcId} 在生产 players 里查不到（README §3 假设已被打破）`);
    stats['rows_matched']++;
    const sets: SlotSet[] = [];

    // 34 项能力项：只写有差的键
    for (const key of ATTR_KEYS) {
      const next = src.attrs[key];
      const prev = num(p.attrs[key] ?? null);
      if (next == null || next === prev) continue;
      sets.push({ key, next, prev });
      stats[key]++;
    }
    // 身体属性 / 逆足：只比对（README §8 裁决点 1）
    for (const key of REPORT_ONLY_ATTRS) {
      const next = src.attrs[key];
      const prev = num(p.attrs[key] ?? null);
      if (next != null && next !== prev) {
        stats[key]++;
        skipped.push(`fc ${src.fcId}：${key} 源 ${next} ≠ 库 ${prev}（本批不写）`);
      }
    }
    // 位置：只比对（README §8 裁决点 3）
    const prevPos = prodSlots(p.attrs, POS_SLOTS, emptyPos).filter((v): v is number => v != null);
    const posDiff = prevPos.length !== src.pos.length || prevPos.some((v, i) => v !== src.pos[i]);
    if (posDiff) {
      stats['PosID']++;
      skipped.push(`fc ${src.fcId}：位置 源 [${src.pos.join(',')}] ≠ 库 [${prevPos.join(',')}]（本批不写）`);
    }
    // 角色槽位与花式槽位：保序追加，不删既有
    const mergeInto = (keys: readonly string[], src2: number[], statKey: string, isEmpty: (n: number) => boolean) => {
      const raw = keys.map((k) => num(p.attrs[k] ?? null));
      const prev = prodSlots(p.attrs, keys, isEmpty);
      const merged = mergeSlots(prev, src2);
      const next = merged.slots;
      if (merged.dropped.length > 0) {
        // 列数不够 ⇒ 源数据装不下，属数据丢失风险，不能用 --allow-skipped 放过
        stats['slots_dropped']++;
        overflow.push(`fc ${src.fcId}：${statKey} 列数不够，装不下 ${merged.dropped.join(',')}（源共 ${src2.length} 项，列只有 ${keys.length} 个）`);
      }
      for (let i = 0; i < keys.length; i++) {
        const a = prev[i] ?? null;
        const b = next[i] ?? null;
        if (a === b) continue;
        // prevRaw 供回滚原样还原（库内空槽写的是 0，不是 NULL，别把表示法改掉）
        sets.push({ key: keys[i], next: b, prev: a, prevRaw: raw[i] ?? null });
        stats[statKey]++;
      }
    };
    mergeInto(ROLE_SLOTS, src.roles, 'RoleID1', emptySlot);
    mergeInto(PS_SLOTS, src.ps, 'PSID1', emptySlot);
    mergeInto(GOLD_SLOTS, src.gold, 'PSID13', emptySlot);

    const caChanged = src.ca != null && src.ca !== p.ca;
    const paChanged = src.pa != null && src.pa !== p.pa;
    if (caChanged) stats['ca']++;
    if (paChanged) stats['pa']++;
    if (p.baseCa == null) stats['base_ca']++;
    if (num(p.attrs['CA'] ?? null) !== p.ca) stats['attr_ca']++;
    if (num(p.attrs['PA'] ?? null) !== p.pa) stats['attr_pa']++;
    if (p.ca == null || p.pa == null) throw new Error(`fc ${src.fcId} 的 ca/pa 为 NULL，守卫条件写不出来`);
    if (!caChanged && !paChanged && sets.length === 0) {
      stats['no_diff_rows']++;
      continue;
    }
    stats['stmt_rows']++;
    changes.push({
      fcId: src.fcId,
      clubId: src.clubId,
      name: p.name,
      oldCa: p.ca,
      newCa: src.ca ?? p.ca,
      oldPa: p.pa,
      newPa: src.pa ?? p.pa,
      caChanged,
      paChanged,
      sets,
    });
  }
  stats['rows_touched_field'] = changes.length;
  return { changes, stats, skipped, overflow };
}

// ---------------------------------------------------------------- SQL 生成

function buildUpdate(c: Change, reverse: boolean): string {
  const cols: string[] = [];
  if (c.caChanged) cols.push(`ca = ${lit(reverse ? c.oldCa : c.newCa)}`);
  if (c.paChanged) cols.push(`pa = ${lit(reverse ? c.oldPa : c.newPa)}`);
  if (c.sets.length > 0) {
    const pairs = c.sets
      .map((s) => `'$.${s.key}', ${lit(reverse ? s.prevRaw : s.next)}`)
      .join(', ');
    cols.push(`game_attrs = json_set(game_attrs, ${pairs})`);
  }
  cols.push(`updated_at = ${lit(TS)}`);
  const guard = reverse
    ? `ca = ${lit(c.newCa)} AND pa = ${lit(c.newPa)}`
    : `ca = ${lit(c.oldCa)} AND pa = ${lit(c.oldPa)}`;
  return `UPDATE players SET ${cols.join(', ')} WHERE fc_id = ${c.fcId} AND ${guard};`;
}

function shards<T>(list: T[], size: number): { no: string; from: number; to: number; items: T[] }[] {
  const out: { no: string; from: number; to: number; items: T[] }[] = [];
  for (let i = 0; i < list.length; i += size) {
    const items = list.slice(i, i + size);
    out.push({ no: String(out.length + 1).padStart(2, '0'), from: i + 1, to: i + items.length, items });
  }
  return out;
}

/** 先清掉上一次生成的分片：本批行数会随库内状态变化，留旧片会让人误以为还有第 3 片。 */
function clearShards(dir: string, prefix: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(prefix) && name.endsWith('.sql')) unlinkSync(join(dir, name));
  }
}

function writeShards(
  dir: string,
  prefix: string,
  changes: Change[],
  reverse: boolean,
  manifest: string[],
): number {
  mkdirSync(dir, { recursive: true });
  clearShards(dir, prefix);
  let files = 0;
  for (const part of shards(changes, PER_FILE)) {
    const name = `${prefix}-${part.no}.sql`;
    const head = [
      `-- S9 能力导入（${reverse ? '回滚' : '落库'}）分片 ${part.no}`,
      `-- 生成器 scripts/prod-20260920-s9-abilities/gen-abilities-sql.ts；生成时点 ${TS}`,
      `-- 覆盖第 ${part.from}-${part.to} 条语句（共 ${changes.length} 条）；源 ${SRC_DIR}`,
      `-- 守卫：WHERE fc_id = ? AND ca = '${reverse ? '新' : '旧'}' AND pa = ... ⇒ 重复执行 changes = 0`,
      reverse
        ? '-- 回滚把 ca/pa 与「本批动过的槽位」还原为导入前的值（未动过的字段不在语句里）'
        : '-- 口径（Case B）：base_ca 与 $.CA/$.PA 一律不动，涨幅以 delta = ca - base_ca 形式存在',
      '',
    ].join('\n');
    const body = part.items
      .map((c) => `-- ${c.fcId} ${c.name}\n${buildUpdate(c, reverse)}`)
      .join('\n');
    const text = `${head}${body}\n`;
    writeFileSync(join(dir, name), text, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    const sha = createHash('sha256').update(text, 'utf8').digest('hex');
    manifest.push(`| ${reverse ? 'rollback/' : 'sql/'}${name} | ${part.from}-${part.to} | ${part.items.length} | ${bytes} | \`${sha}\` |`);
    files++;
  }
  return files;
}

function buildPrecheck(fcIds: number[]): string {
  const list = fcIds.join(',');
  return [
    '-- 只读预检：执行前跑一次（npx wrangler d1 execute whl-club --remote --file 本文件）',
    `-- 生成时点 ${TS}；期望 src_found = json_ok = ${fcIds.length}，其余四项为 0`,
    '', 'SELECT',
  ]
    .concat([
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list})) AS src_found,`,
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND json_extract(game_attrs, '$.CA') IS NOT NULL) AS json_ok,`,
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND (ca IS NULL OR pa IS NULL OR base_ca IS NULL)) AS null_core,`,
      '  (SELECT COUNT(*) FROM players WHERE ca <> COALESCE(base_ca, ca)) AS delta_gt0,',
      '  (SELECT COUNT(*) FROM players WHERE ca <> COALESCE(json_extract(game_attrs, \'$.CA\'), ca)) AS ca_vs_attr,',
      `  (SELECT COUNT(*) FROM players WHERE updated_at = '${TS}') AS already_touched;`,
      '',
    ])
    .join('\n');
}

function buildVerify(
  fcIds: number[],
  stmtRows: number,
  deltaExpected: number,
  goldRowsExpected: number,
  goldSlotsExpected: number,
): string {
  const list = fcIds.join(',');
  const goldCount = (key: string) => `(CASE WHEN COALESCE(json_extract(game_attrs, '$.${key}'), 0) >= 101 THEN 1 ELSE 0 END)`;
  return [
    '-- 只读验收：执行后跑一次（npx wrangler d1 execute whl-club --remote --file 本文件）',
    `-- 期望 touched = ${stmtRows}（本批语句数）、delta_gt0 = ${deltaExpected}、gold_rows = ${goldRowsExpected}、gold_slots = ${goldSlotsExpected}、null_core = 0`,
    '-- 逐行复核另跑：node gen-abilities-sql.ts --verify（重算差异，期望「剩余差异 0 行」）',
    '', 'SELECT',
  ]
    .concat([
      `  (SELECT COUNT(*) FROM players WHERE updated_at = '${TS}') AS touched,`,
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND ca <> COALESCE(base_ca, ca)) AS delta_gt0,`,
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND (ca IS NULL OR pa IS NULL OR base_ca IS NULL)) AS null_core,`,
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND (${goldCount('PSID13')} + ${goldCount('PSID14')} + ${goldCount('PSID15')}) > 0) AS gold_rows,`,
      `  (SELECT COALESCE(SUM(${goldCount('PSID13')} + ${goldCount('PSID14')} + ${goldCount('PSID15')}), 0) FROM players WHERE fc_id IN (${list})) AS gold_slots,`,
      `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND ca <> COALESCE(json_extract(game_attrs, '$.CA'), ca)) AS ca_vs_attr;`,
      '',
    ])
    .join('\n');
}

// ---------------------------------------------------------------- 主流程

const role = loadRef('role.json');
const ps = loadRef('playstyle.json');
const posRef = loadRef('position.json');
const src = readSource(SRC_DIR, role, ps, posRef);
if (src.dupes.size > 0) throw new Error(`源有重复 playerid：${[...src.dupes.keys()].join(', ')}`);

const fcIds = src.rows.map((r) => r.fcId);
const prod = loadProd(fcIds);
const { changes, stats, skipped, overflow } = computeChanges(src.rows, prod);

if (overflow.length > 0) {
  console.error(`中止：有 ${overflow.length} 行槽位装不下（源项数 > 列数），继续会丢数据。`);
  for (const line of overflow.slice(0, 10)) console.error(`  ${line}`);
  process.exit(5);
}

if (VERIFY) {
  const diffRows = changes.length;
  console.log(`[verify] 源行 ${src.rows.length} / 命中 ${stats['rows_matched']} / 仍有差异的行 ${diffRows}`);
  for (const key of ['ca', 'pa', ...ATTR_KEYS, 'RoleID1', 'PSID1', 'PSID13']) {
    if (stats[key] > 0) console.log(`  ${key}: ${stats[key]}`);
  }
  if (diffRows > 0) {
    console.log('  前 5 条未落地差异：');
    for (const c of changes.slice(0, 5)) {
      console.log(`    fc ${c.fcId} ${c.name}：ca ${c.oldCa}→${c.newCa}，槽位 ${c.sets.map((s) => `${s.key} ${s.prev}→${s.next}`).join('；') || '无'}`);
    }
  }
  if (skipped.length > 0) console.log(`[verify] 报告-only 字段差异 ${skipped.length} 条，前 3：\n    ${skipped.slice(0, 3).join('\n    ')}`);
  process.exit(diffRows === 0 ? 0 : 4);
}

if (skipped.length > 0 && !ALLOW_SKIPPED) {
  console.error(`中止：有 ${skipped.length} 行落在「只比对不写库」的字段上（README §8 裁决点 1/3 的 0 差异假设被打破）。`);
  for (const line of skipped.slice(0, 10)) console.error(`  ${line}`);
  console.error('确认要跳过请加 --allow-skipped。');
  process.exit(3);
}

const sqlText = changes.map((c) => buildUpdate(c, false)).join('\n');
if (/\bbase_ca\b/.test(sqlText) || /\$\.(CA|PA)'/.test(sqlText)) {
  throw new Error('落库 SQL 里出现了 base_ca / $.CA / $.PA —— 违反 Case B 口径，已中止');
}

const manifest: string[] = [];
const sqlFiles = writeShards(OUT_DIR, 'abilities-update', changes, false, manifest);
const rbFiles = writeShards(RB_DIR, 'abilities-rollback', changes, true, manifest);
writeFileSync(join(HERE, '01-precheck.sql'), buildPrecheck(fcIds), 'utf8');
const deltaExpected = changes.filter((c) => c.caChanged).length;
// 金徽：验收 SQL 数的是「行数」（任一金槽 ≥101）与「槽位数」，两者都与语句里的槽位写次数不同，须分开给
const goldKeySet = new Set(GOLD_SLOTS);
const goldRowsExpected = new Set(
  changes.filter((c) => c.sets.some((s) => goldKeySet.has(s.key))).map((c) => c.fcId),
).size;
const goldSlotsExpected = changes.reduce((n, c) => n + c.sets.filter((s) => goldKeySet.has(s.key)).length, 0);
writeFileSync(
  join(HERE, '02-verify.sql'),
  buildVerify(fcIds, changes.length, deltaExpected, goldRowsExpected, goldSlotsExpected),
  'utf8',
);

// 逐队统计
const byClub = new Map<number, { rows: number; up: number; same: number; stmt: number; file: string }>();
for (const r of src.rows) {
  const prev = num(prod.get(r.fcId)?.ca ?? null);
  const e = byClub.get(r.clubId) ?? { rows: 0, up: 0, same: 0, stmt: 0, file: r.clubFile };
  e.rows++;
  if (r.ca != null && prev != null && r.ca > prev) e.up++;
  else e.same++;
  if (changes.some((c) => c.fcId === r.fcId)) e.stmt++;
  byClub.set(r.clubId, e);
}

const lines: string[] = [];
lines.push('# S9 能力导入（FC Editor s901 → 生产 players）生成报告');
lines.push('');
lines.push(`- 生成时点：${TS}`);
lines.push(`- 源目录：\`${SRC_DIR}\``);
lines.push(`- 源行：${src.rows.length}（唯一 playerid ${fcIds.length}）；生产命中 ${stats['rows_matched']}`);
lines.push(`- 落库语句：${changes.length} 条 → ${sqlFiles} 片；回滚语句：${rbFiles} 片（\`rollback/\`）`);
lines.push(`- 口径：**Case B**——只改现值（\`ca\`/\`pa\`/34 项能力项/\`RoleID1-5\`/\`PSID1-15\`），\`base_ca\` 与 \`$.CA\`/\`$.PA\` 不动`);
lines.push('- 生成物**不可逐字节复现**：旧值与守卫取自生成时的生产库，且时间戳为生成时点；重跑只会在差异归零后产出空分片');
lines.push('');
lines.push('## 逐字段变更（语句里实际出现的槽位次数）');
lines.push('');
lines.push('| 字段 | 变更次数 | 说明 |');
lines.push('| --- | --- | --- |');
lines.push(`| \`ca\` | ${stats['ca']} | 源 overallrating → 现值 |`);
lines.push(`| \`pa\` | ${stats['pa']} | 源 potential → 现值 |`);
for (const key of ATTR_KEYS) {
  if (stats[key] > 0) lines.push(`| \`${key}\` | ${stats[key]} | 34 项能力项（两源同名直连） |`);
}
lines.push(`| \`RoleID1-5\` | ${stats['RoleID1']} | 角色槽位（保序追加，不删既有） |`);
lines.push(`| \`PSID1-12\` | ${stats['PSID1']} | 花式槽位（同上） |`);
lines.push(`| \`PSID13-15\` | ${stats['PSID13']} | 金徽槽位（\`Playstyles+\` 基础名 + 100）；落库后涉及 ${goldRowsExpected} 行（02-verify.sql 的 \`gold_rows\`） |`);
lines.push('');
lines.push('## 只比对、不写库的字段（README §8 裁决点）');
lines.push('');
lines.push('| 字段 | 差异行数 |');
lines.push('| --- | --- |');
for (const key of REPORT_ONLY_ATTRS) lines.push(`| \`${key}\` | ${stats[key]} |`);
lines.push(`| \`PosID1-4\` | ${stats['PosID']} |`);
lines.push(`| \`players.base_ca\` 为 NULL 的行 | ${stats['base_ca']} |`);
lines.push(`| \`game_attrs.$.CA\` ≠ \`ca\` 的行（Case B 预期的背离） | ${stats['attr_ca']} |`);
lines.push(`| \`game_attrs.$.PA\` ≠ \`pa\` 的行 | ${stats['attr_pa']} |`);
lines.push('');
lines.push(`明文差异：${skipped.length} 条${ALLOW_SKIPPED ? '（已用 --allow-skipped 跳过）' : '（为 0 才允许生成）'}`);
for (const line of skipped.slice(0, 30)) lines.push(`- ${line}`);
lines.push(`槽位溢出（源项数 > 列数，有即中止生成）：${stats['slots_dropped']} 行`);
lines.push('');
lines.push('## 逐队（源行 / CA 上升 / CA 不变 / 有语句的行）');
lines.push('');
lines.push('| club_id | 文件 | 源行 | CA 升 | CA 同 | 有语句 |');
lines.push('| --- | --- | --- | --- | --- | --- |');
for (const [clubId, e] of [...byClub.entries()].sort((a, b) => a[0] - b[0])) {
  lines.push(`| ${clubId} | \`${e.file}\` | ${e.rows} | ${e.up} | ${e.same} | ${e.stmt} |`);
}
lines.push('');
lines.push(`无差异行（源与库完全一致）：${stats['no_diff_rows']}`);
lines.push('');
lines.push('## 未映射文本（源里有、反查表里没有）');
lines.push('');
lines.push('| 表 | 文本 | 出现次数 |');
lines.push('| --- | --- | --- |');
if (src.unknownRoleTexts.size === 0) lines.push('| role.json | — | 0 |');
for (const [text, n] of src.unknownRoleTexts) lines.push(`| role.json | \`${text}\` | ${n} |`);
if (src.unknownPsTexts.size === 0) lines.push('| playstyle.json | — | 0 |');
for (const [text, n] of src.unknownPsTexts) lines.push(`| playstyle.json | \`${text}\` | ${n} |`);
if (src.droppedPsTexts.size > 0) {
  lines.push('');
  lines.push(`明确丢弃的生涯特性（不在 PlayStyleID 表内）：${[...src.droppedPsTexts.entries()].map(([t, n]) => `\`${t}\`×${n}`).join('、')}`);
}
lines.push('');
lines.push('## 分片清单');
lines.push('');
lines.push('| 文件 | 语句 | 条数 | 字节 | sha256 |');
lines.push('| --- | --- | --- | --- | --- |');
lines.push(...manifest);
lines.push('');
lines.push('## 执行前的本地演练（可选，不碰生产）');
lines.push('');
lines.push('```bash');
lines.push('npx wrangler d1 execute whl-club --local --file scripts/prod-20260920-s9-abilities/sql/abilities-update-01.sql');
lines.push('# 断言：changes 与语句数一致；再跑一次 changes = 0');
lines.push('```');
lines.push('');
lines.push('## 生产执行（等令）');
lines.push('');
lines.push('```bash');
lines.push('npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-abilities/01-precheck.sql');
lines.push('npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-abilities/sql/abilities-update-01.sql   # 逐片');
lines.push('npx wrangler d1 execute whl-club --remote --file scripts/prod-20260920-s9-abilities/02-verify.sql');
lines.push('node scripts/prod-20260920-s9-abilities/gen-abilities-sql.ts --verify   # 期望「仍有差异的行 0」');
lines.push('```');
lines.push('');
lines.push('回滚：`rollback/abilities-rollback-NN.sql` 逆序逐片执行（守卫按导入后的 ca/pa 值，只还原本批动过的字段）。');
lines.push('');
lines.push('样例语句（第 1 条）：');
lines.push('');
lines.push('```sql');
lines.push(changes.length > 0 ? buildUpdate(changes[0], false) : '-- 无差异，未产出语句');
lines.push('```');
lines.push('');

writeFileSync(join(HERE, 'abilities-report.md'), lines.join('\n'), 'utf8');

console.log(`源行 ${src.rows.length}（命中 ${stats['rows_matched']}）→ 落库语句 ${changes.length} 条 / ${sqlFiles} 片，回滚 ${rbFiles} 片`);
console.log(`ca 变更 ${stats['ca']}、pa 变更 ${stats['pa']}、角色槽 ${stats['RoleID1']}、花式槽 ${stats['PSID1']}、金徽 ${stats['PSID13']}、无差异行 ${stats['no_diff_rows']}`);
console.log(`只比对字段差异：${REPORT_ONLY_ATTRS.map((k) => `${k} ${stats[k]}`).join('、')}、PosID ${stats['PosID']}`);
console.log(`报告 scripts/prod-20260920-s9-abilities/abilities-report.md`);
