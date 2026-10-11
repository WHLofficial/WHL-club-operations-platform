// S10 队表导出生成器：生产 players → FC Editor 61 列 `Squad Info` xlsx
//
// 干什么：把生产库里各支球队导出成与 s901/ 同构的 61 列 xlsx，供 FC Editor 做 s10 档。
// 安全性：只读生产（SELECT），不写库、不碰 FC Editor 目录（除 --out 指定的目录外）。
// 表头：取自 src/core/fc26.ts 的 FC_EDITOR_GAME_ATTR_COLUMNS（单一真源，不手抄）。
// 口径：见本目录 README.md「列映射」与「口径」两节。
//
// 用法：
//   node gen-export.ts                                  导出到 scratch/export-s10/
//   node gen-export.ts --out "E:/…/player_tables/s10"    导出到指定目录（不存在则新建）
//   node gen-export.ts --squad first_team                只导一线队（默认 all = 一线队 + 训练营）
//   node gen-export.ts --dry-run                         只算不写：打印逐队行数与异常统计
//   node gen-export.ts --verify                          读回产物逐列自检（有差异 exit 4）
//   node gen-export.ts --diff-prev                       与 s901 逐列对照（结构列有差异 exit 4）
//   node gen-export.ts --source <players.json>           用快照重跑（不连生产）
//   node gen-export.ts --local                           读本地 D1（演练用）
//
// 退出码：0 通过 / 2 参数或输入错 / 3 导出失败 / 4 自检或对照不通过

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as XLSX_NS from 'xlsx';
import { FC26_GAME_ATTR_COLUMNS, FC_EDITOR_GAME_ATTR_COLUMNS } from '../../src/core/fc26.ts';

// xlsx 是 CJS 包，ESM 下具名导出探测不到（readFile/writeFile 只在 default 上）⇒ 统一从 default 取。
const XLSX: typeof XLSX_NS = (XLSX_NS as unknown as { default?: typeof XLSX_NS }).default ?? XLSX_NS;

// ---------------------------------------------------------------- 参数

const USAGE = `用法：node gen-export.ts [--out <目录>] [--squad all|first_team] [--prev <s901 目录>]
                    [--source <players.json>] [--retry <次数>] [--local] [--dry-run] [--verify] [--diff-prev]`;

const VALUE_FLAGS = new Set(['out', 'squad', 'prev', 'source', 'retry']);
const FLAG = new Set<string>();
const OPT = new Map<string, string>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      console.error(`不认识的参数「${a}」\n${USAGE}`);
      process.exit(2);
    }
    const eq = a.indexOf('=');
    if (eq >= 0) {
      OPT.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const v = argv[++i];
      if (v == null) {
        console.error(`--${name} 缺值\n${USAGE}`);
        process.exit(2);
      }
      OPT.set(name, v);
    } else {
      FLAG.add(name);
    }
  }
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const REF_DIR = join(ROOT, 'web', 'assets', 'ref');
const DEFAULT_PREV = 'E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901';
const DB = 'whl-club';
const SEASON = 9;

const OUT_DIR = resolve(OPT.get('out') ?? join(ROOT, 'scratch', 'export-s10'));
const PREV_DIR = resolve(OPT.get('prev') ?? DEFAULT_PREV);
const SQUAD = OPT.get('squad') ?? 'all';
const SOURCE = OPT.get('source') ?? null;
const RETRY = Math.max(1, Number(OPT.get('retry') ?? 5));
const LOCAL = FLAG.has('local');
const DRY = FLAG.has('dry-run');
const VERIFY = FLAG.has('verify');
const DIFF_PREV = FLAG.has('diff-prev');
const MODES = [DRY, VERIFY, DIFF_PREV].filter(Boolean).length;
const TS = new Date().toISOString();

if (SQUAD !== 'all' && SQUAD !== 'first_team') {
  console.error(`--squad 只接 all 或 first_team，收到「${SQUAD}」\n${USAGE}`);
  process.exit(2);
}
if (MODES > 1) {
  console.error(`--dry-run / --verify / --diff-prev 一次只能用一个\n${USAGE}`);
  process.exit(2);
}

// ---------------------------------------------------------------- 常量（与库内/Editor 两侧键名对齐）

/** 34 项细分能力：FC26 键名与 Editor 列名逐字相同，两侧取交集做交叉校验。 */
const ATTR34 = FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed'));
const EDITOR_ATTR34 = FC_EDITOR_GAME_ATTR_COLUMNS.filter((k) => ATTR34.includes(k));
const ROLE_SLOTS = ['RoleID1', 'RoleID2', 'RoleID3', 'RoleID4', 'RoleID5'];
const PS_SLOTS = Array.from({ length: 12 }, (_, i) => `PSID${i + 1}`);
const GOLD_SLOTS = ['PSID13', 'PSID14', 'PSID15'];
const PS_GOLD_BASE = 100;
/** 槽位空判定（与 s9-abilities 批次同口径）：角色/花式 ≤0 为空；位置 <0 为空（PosID 0 是 GK 真值）。 */
const isEmptySlot = (n: number) => n <= 0;
const isEmptyPos = (n: number) => n < 0;
/** s901 空槽哨兵：位置空写 `None`，角色空写 `0`。 */
const POS_EMPTY = 'None';
const ROLE_EMPTY = '0';

/** A 硬闸（身份 / 位置 / 队伍 / 国籍 / 身体 / 逆足 / 三列缺口）：S9 时两侧逐字一致（0 处）。
 *  此后若出现差异，要么平台内改过、要么映射出错 ⇒ 必须 0，非 0 停下人工确认。 */
const HARD_COLS = new Set([
  'playerid',
  'Position', 'Position2', 'Position3', 'Position4', 'teamid',
  'nationality', 'preferredfoot', 'height', 'weight', 'weakfootabilitytypecode',
  'playerjointeamdate', 'contractvaliduntil', 'birthdate',
]);
/** B 数值列（overallrating / potential / 34 项能力）：导出取库内现值（`ca` / `pa` + `game_attrs`），
 *  s901 是 2026-09-05 快照，之后平台内成长与订正会改现值 ⇒ 差异预期内，不算失败，逐条列出备查。 */
const SOFT_COLS = new Set(['overallrating', 'potential', ...ATTR34]);
/** C 文本列（role1-5 / Playstyles / Playstyles+）：导出按**库内槽位顺序** + 平台反查表出值，
 *  与 s901 的写法（连字符 / 双空格 / 大小写）、顺序、生涯特性差异都是预期内的 ⇒ 不算失败，逐条列出备查。 */
const TEXT_COLS = new Set(['role1', 'role2', 'role3', 'role4', 'role5', 'Playstyles', 'Playstyles+']);
/** D 平台侧可编辑列（姓名三列 + 球衣号）：平台是这三列的真源（v6.0.0 起在平台内维护、可编辑），与 s901 不同不算失败，逐条列出备查。 */
const EDITABLE_COLS = new Set(['firstname', 'lastname', 'commonname', 'number']);
const CLASS_SETS = [HARD_COLS, SOFT_COLS, TEXT_COLS, EDITABLE_COLS] as const;

/** 四类必须无重叠、且恰好覆盖 61 列——否则对照报告会漏字段（「全字段」的机器保证）。 */
{
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const s of CLASS_SETS) {
    for (const c of s) {
      if (seen.has(c)) dup.push(c);
      seen.add(c);
    }
  }
  const missing = FC_EDITOR_GAME_ATTR_COLUMNS.filter((c) => !seen.has(c));
  if (dup.length || missing.length || seen.size !== FC_EDITOR_GAME_ATTR_COLUMNS.length) {
    console.error(
      `对照分级不完整：重复 [${dup.join(', ')}] 缺 [${missing.join(', ')}]（合计 ${seen.size}/${FC_EDITOR_GAME_ATTR_COLUMNS.length}）`,
    );
    process.exit(2);
  }
}

if (EDITOR_ATTR34.length !== 34) {
  console.error(`34 项能力键名两侧不一致（交集 ${EDITOR_ATTR34.length}）——映射假设已被打破，先修脚本`);
  process.exit(2);
}

// ---------------------------------------------------------------- 小工具

class Reporter {
  readonly counters = new Map<string, number>();
  readonly samples = new Map<string, string[]>();
  bump(key: string, sample?: string, limit = 40) {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
    if (sample != null) {
      const arr = this.samples.get(key) ?? [];
      if (arr.length < limit) arr.push(sample);
      this.samples.set(key, arr);
    }
  }
  add(key: string, n: number) {
    if (n) this.counters.set(key, (this.counters.get(key) ?? 0) + n);
  }
  get(key: string): number {
    return this.counters.get(key) ?? 0;
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function textOrEmpty(v: unknown): string {
  return v == null ? '' : String(v);
}

type RefRow = { id: number; en?: string; chs?: string; name?: string };

/** 归一化：折叠空白、连字符转空格、小写——ref 表与 s901 之间存在 `CM Half-Winger +` / `CM Half Winger +` 这类同义异写。 */
function normKey(s: string): string {
  return s.trim().replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function loadRef(file: string): Map<number, RefRow> {
  const rows = JSON.parse(readFileSync(join(REF_DIR, file), 'utf8')) as RefRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** 归一化文本 → id 反查，**只用于对照报告**（认 s901 的同义异写，报「s901 有、库内无槽位」），不参与出值。 */
function normIndex(rows: Map<number, RefRow>, keep: (id: number) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, r] of rows) {
    if (!keep(id) || !r.en || r.en === '-') continue;
    const k = normKey(r.en);
    if (!out.has(k)) out.set(k, id);
  }
  return out;
}

function loadRefs(): Refs {
  const position = loadRef('position.json');
  const role = loadRef('role.json');
  const playstyle = loadRef('playstyle.json');
  const team = loadRef('team.json');
  return {
    position,
    role,
    playstyle,
    team,
    // 角色：银 1..49 / 金 101..149 都进表（`en` 自带 `+` / `++`）——只给对照报告认写法
    roleByNorm: normIndex(role, (id) => id > 0),
    // 花式：只收银槽 id（金槽 `en` 带 ` +` 后缀，s901 的金列给的是基础名）——只给对照报告认写法
    psByNorm: normIndex(playstyle, (id) => id > 0 && id < PS_GOLD_BASE),
  };
}

/** s901 的多值单元格：逗号分隔 + 去空白；空哨兵（``/`0`/`None`/`-`）丢弃。 */
function splitTokens(v: unknown): string[] {
  if (v == null) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '0' && s !== 'None' && s !== '-');
}

// ---------------------------------------------------------------- 生产库（只读）

const WRANGLER_JS = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * 读生产（只读 SELECT）。
 * - 不走 shell、不走 `npx`/`.cmd`：直接 `node node_modules/wrangler/bin/wrangler.js`，
 *   SQL 作为独立 argv 传入，省掉引号转义，也避开 Windows 上 npx 的进程崩溃。
 * - 网络是间歇性的（本环境代理对 api.cloudflare.com 时通时断）⇒ 默认重试 5 次，间隔 3s。
 */
function d1Rows(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  const args = [WRANGLER_JS, 'd1', 'execute', DB, scope, '--json', '--command', sql];
  let lastErr = '';
  for (let attempt = 1; attempt <= RETRY; attempt++) {
    const res = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = res.stdout ?? '';
    const at = out.indexOf('[');
    if (at >= 0) {
      try {
        const parsed = JSON.parse(out.slice(at)) as Array<{ results?: Record<string, unknown>[] }>;
        if (parsed[0]?.results) return parsed[0].results;
        lastErr = `返回里没有 results：${out.slice(0, 300)}`;
      } catch (e) {
        lastErr = `JSON 解析失败：${(e as Error).message}：${out.slice(0, 200)}`;
      }
    } else {
      lastErr = `不是 JSON（exit ${res.status}）：${(res.stderr || out).replace(/\u001b\[[0-9;]*m/g, '').trim().slice(0, 300)}`;
    }
    if (attempt < RETRY) {
      console.error(`  [重试 ${attempt}/${RETRY}] ${lastErr.split('\n')[0]}`);
      sleep(3000);
    }
  }
  throw new Error(`wrangler 读取失败（试了 ${RETRY} 次）：\n${lastErr}`);
}

// ---------------------------------------------------------------- 数据模型

type DbPlayer = {
  id: number;
  fc_id: number | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  common_name: string | null;
  number: number | null;
  foot: number | null;
  ca: number | null;
  pa: number | null;
  club_id: number | null;
  status: string | null;
  game_attrs: string | null;
  reg_squad: string | null;
  ctype: string | null;
};

type PrevTriple = {
  order: number;
  join: unknown;
  contractUntil: unknown;
  birthdate: unknown;
  /** s901 自己的角色 / 花式文本——**只用于对照报告**，不参与出值（导出忠实线上库）。 */
  roles: string[];
  ps: string[];
  gold: string[];
};
type SnapshotPlayer = DbPlayer & { prev: PrevTriple | null };

type SnapshotClub = { id: number; name: string; fileName: string; fileBase: string; fileBaseFrom: 'prev' | 'ref' | 'clubs' };

type Snapshot = {
  generatedAt: string;
  source: string;
  prevDir: string;
  squad: string;
  clubs: SnapshotClub[];
  players: SnapshotPlayer[];
};

type Refs = {
  position: Map<number, RefRow>;
  role: Map<number, RefRow>;
  playstyle: Map<number, RefRow>;
  team: Map<number, RefRow>;
  roleByNorm: Map<string, number>;
  psByNorm: Map<string, number>;
};

// ---------------------------------------------------------------- 取数

const PLAYER_SQL = `SELECT p.id, p.fc_id, p.name, p.first_name, p.last_name, p.common_name,
  p.number, p.foot, p.ca, p.pa, p.club_id, p.status, p.game_attrs,
  (SELECT r.squad FROM registrations r WHERE r.player_id = p.id AND r.season = ${SEASON} LIMIT 1) AS reg_squad,
  (SELECT c.contract_type FROM contracts c WHERE c.player_id = p.id AND c.is_active = 1 LIMIT 1) AS ctype
FROM players p WHERE p.club_id IS NOT NULL AND COALESCE(p.status, '') <> 'retired' ORDER BY p.club_id, p.fc_id`;

function mapPlayer(r: Record<string, unknown>): DbPlayer {
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    id: Number(r['id']),
    fc_id: numOrNull(r['fc_id']),
    name: str(r['name']),
    first_name: str(r['first_name']),
    last_name: str(r['last_name']),
    common_name: str(r['common_name']),
    number: numOrNull(r['number']),
    foot: numOrNull(r['foot']),
    ca: numOrNull(r['ca']),
    pa: numOrNull(r['pa']),
    club_id: numOrNull(r['club_id']),
    status: str(r['status']),
    game_attrs: str(r['game_attrs']),
    reg_squad: str(r['reg_squad']),
    ctype: str(r['ctype']),
  };
}

function readProd(): { clubs: { id: number; name: string }[]; players: DbPlayer[] } {
  const clubs = d1Rows('SELECT id, name FROM clubs ORDER BY id').map((r) => ({
    id: Number(r['id']),
    name: textOrEmpty(r['name']),
  }));
  if (clubs.length === 0) throw new Error('生产 clubs 表读回 0 行');
  const ids = new Set(clubs.map((c) => c.id));
  const raw = d1Rows(PLAYER_SQL).map(mapPlayer);
  const players = raw.filter((p) => p.club_id != null && ids.has(p.club_id));
  if (raw.length !== players.length) console.warn(`  注意：${raw.length - players.length} 行 club_id 不在 clubs 表里，已丢弃`);
  for (const c of clubs) {
    console.log(`  club ${String(c.id).padStart(6)} ${c.name} → ${players.filter((p) => p.club_id === c.id).length} 行`);
  }
  return { clubs, players };
}

function readSnapshot(path: string): { clubs: { id: number; name: string }[]; players: DbPlayer[] } {
  const snap = JSON.parse(readFileSync(resolve(path), 'utf8')) as Snapshot;
  if (!Array.isArray(snap.players) || !Array.isArray(snap.clubs)) throw new Error(`快照 ${path} 结构不对（缺 clubs/players）`);
  return { clubs: snap.clubs.map((c) => ({ id: c.id, name: c.name })), players: snap.players };
}

// ---------------------------------------------------------------- s901（对照 + 三列缺口取值）

type PrevIndex = {
  byFc: Map<number, Record<string, unknown>>;
  triple: Map<number, PrevTriple>;
  fileBase: Map<number, string>;
  rowsByClub: Map<number, number>;
  files: string[];
  problems: string[];
};

function readPrev(dir: string): PrevIndex {
  const idx: PrevIndex = {
    byFc: new Map(),
    triple: new Map(),
    fileBase: new Map(),
    rowsByClub: new Map(),
    files: [],
    problems: [],
  };
  if (!existsSync(dir)) {
    idx.problems.push(`目录不存在：${dir}`);
    return idx;
  }
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .sort();
  idx.files = files;
  for (const f of files) {
    const m = /^(\d+) - (.+)\.xlsx$/.exec(f);
    if (!m) {
      idx.problems.push(`文件名不合 <clubId> - <队名>.xlsx：${f}`);
      continue;
    }
    const clubId = Number(m[1]);
    idx.fileBase.set(clubId, m[2]);
    let rows: Record<string, unknown>[];
    try {
      const wb = XLSX.readFile(join(dir, f));
      const sheet = wb.Sheets['Squad Info'] ?? wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
    } catch (e) {
      idx.problems.push(`读不了 ${f}：${(e as Error).message}（文件被 Excel 占用？）`);
      continue;
    }
    let order = 0;
    for (const r of rows) {
      const fc = numOrNull(r['playerid']);
      if (fc == null) {
        idx.problems.push(`${f} 有行缺 playerid，已跳过`);
        continue;
      }
      if (idx.byFc.has(fc)) idx.problems.push(`playerid ${fc} 在 s901 里重复（${f}）`);
      idx.byFc.set(fc, r);
      idx.triple.set(fc, {
        order: order++,
        join: r['playerjointeamdate'] ?? null,
        contractUntil: r['contractvaliduntil'] ?? null,
        birthdate: r['birthdate'] ?? null,
        roles: ['role1', 'role2', 'role3', 'role4', 'role5'].flatMap((k) => splitTokens(r[k])),
        ps: splitTokens(r['Playstyles']),
        gold: splitTokens(r['Playstyles+']),
      });
      const teamid = numOrNull(r['teamid']);
      if (teamid != null) idx.rowsByClub.set(teamid, (idx.rowsByClub.get(teamid) ?? 0) + 1);
    }
  }
  return idx;
}

// ---------------------------------------------------------------- 61 列映射

type Values = Record<string, string | number | null>;

function buildValues(p: SnapshotPlayer, refs: Refs, rep: Reporter): Values | null {
  if (p.fc_id == null) {
    rep.bump('无法导出：缺 fc_id', `players.id=${p.id} ${p.name ?? ''}`);
    return null;
  }
  const fc = p.fc_id;
  let attrs: Record<string, unknown> = {};
  if (p.game_attrs) {
    try {
      attrs = JSON.parse(p.game_attrs) as Record<string, unknown>;
    } catch {
      rep.bump('无法导出：game_attrs 不是合法 JSON', `fc ${fc}`);
      return null;
    }
  } else {
    rep.bump('game_attrs 为空', `fc ${fc}`);
  }

  const at = (key: string): number | null => {
    if (!(key in attrs)) {
      rep.bump(`game_attrs 缺键：${key}`, `fc ${fc}`);
      return null;
    }
    const n = numOrNull(attrs[key]);
    if (n == null) rep.bump(`game_attrs 键值为空：${key}`, `fc ${fc}`);
    return n;
  };

  const posText = (key: string): string => {
    const n = at(key);
    if (n == null || isEmptyPos(n)) return POS_EMPTY;
    const r = refs.position.get(n);
    if (!r?.name) {
      rep.bump(`位置 id 未知：${n}`, `fc ${fc} ${key}`);
      return POS_EMPTY;
    }
    return r.name;
  };

  // —— 文本列忠实于线上库：角色 / 花式按**库内槽位顺序**出（RoleID1-5 / PSID1-12 / PSID13-15），
  //    文本取平台自己的反查表 `web/assets/ref/{role,playstyle}.json`；s901 的写法与顺序只用于报差异，不参与出值。
  const prevRoles = p.prev?.roles ?? [];
  const prevPs = p.prev?.ps ?? [];
  const prevGold = p.prev?.gold ?? [];

  /** 槽位原值只读一次（at() 对缺键会记数，重复调用会重复记）。 */
  const slotVal = new Map<string, number | null>();
  for (const k of [...ROLE_SLOTS, ...PS_SLOTS, ...GOLD_SLOTS]) slotVal.set(k, at(k));
  /** 非空槽 id；normalizeGold 时把金槽 101..156 归一到银表 1..56。 */
  const slotIds = (keys: readonly string[], normalizeGold: boolean): number[] =>
    keys
      .map((k) => slotVal.get(k) ?? null)
      .filter((n): n is number => n != null && !isEmptySlot(n))
      .map((n) => (normalizeGold && n >= PS_GOLD_BASE ? n - PS_GOLD_BASE : n));
  for (const k of PS_SLOTS) {
    const n = slotVal.get(k) ?? null;
    if (n != null && n >= PS_GOLD_BASE) rep.bump('银槽持有金 id（异常）', `fc ${fc} ${k}=${n}`);
  }
  for (const k of GOLD_SLOTS) {
    const n = slotVal.get(k) ?? null;
    if (n != null && !isEmptySlot(n) && n < PS_GOLD_BASE) rep.bump('金槽持有银 id（异常）', `fc ${fc} ${k}=${n}`);
  }

  const roleIds = slotIds(ROLE_SLOTS, false);
  const roleTextAt = (i: number): string => {
    const id = roleIds[i];
    if (id == null) return ROLE_EMPTY;
    const t = refs.role.get(id)?.en;
    if (!t || t === '-') {
      rep.bump(`角色 id 未知：${id}`, `fc ${fc} RoleID${i + 1}`);
      return ROLE_EMPTY;
    }
    return t;
  };

  const silverIds = slotIds(PS_SLOTS, true);
  const goldIds = slotIds(GOLD_SLOTS, true);
  /** 花式文本一律取银表 `en`（基础名，无 `+` 后缀）——平台侧口径。 */
  const psText = (id: number, where: string): string | null => {
    const t = refs.playstyle.get(id)?.en;
    if (!t || t === '-') {
      rep.bump(`花式 id 未知：${id}`, `fc ${fc} ${where}`);
      return null;
    }
    return t;
  };
  const psTexts = (ids: number[], where: string): string[] =>
    ids.map((id) => psText(id, where)).filter((t): t is string => t != null);
  // s901 有、库内没有槽位的花式 / 角色（`One Club Player` / `Injury Prone` 这类生涯特性，或平台内清掉的槽位）：
  // 只记数备查，**不回填**——用户 2026-10-11 裁定「特性和数值等忠实于线上库，不要回填」。
  const dbPs = new Set([...silverIds, ...goldIds]);
  const droppedPs = new Set<string>();
  for (const t of [...prevPs, ...prevGold]) {
    const id = refs.psByNorm.get(normKey(t));
    if (id == null) droppedPs.add(`${t}（库内无对应 id）`);
    else if (!dbPs.has(id)) droppedPs.add(t);
  }
  if (droppedPs.size) rep.bump('s901 花式库内无槽位（不回填）', `fc ${fc} ${[...droppedPs].join(' / ')}`);
  const dbRoles = new Set(roleIds);
  const droppedRoles = new Set<string>();
  for (const t of prevRoles) {
    const id = refs.roleByNorm.get(normKey(t));
    if (id == null) droppedRoles.add(`${t}（库内无对应 id）`);
    else if (!dbRoles.has(id)) droppedRoles.add(t);
  }
  if (droppedRoles.size) rep.bump('s901 角色库内无槽位（不回填）', `fc ${fc} ${[...droppedRoles].join(' / ')}`);

  // 姓名三列：库内 v6.0.0 起由 s901 三列灌入；万一三列全空则回退 players.name（末空格切分），并记数。
  let first = textOrEmpty(p.first_name);
  let last = textOrEmpty(p.last_name);
  const common = textOrEmpty(p.common_name);
  if (!first && !last) {
    const nm = textOrEmpty(p.name).trim();
    if (nm) {
      const cut = nm.lastIndexOf(' ');
      if (cut > 0) {
        first = nm.slice(0, cut);
        last = nm.slice(cut + 1);
      } else {
        first = nm;
      }
      rep.bump('姓名三列缺失，回退 players.name 拆分', `fc ${fc} name=「${nm}」→ first=「${first}」last=「${last}」`);
    } else {
      rep.bump('姓名三列与 players.name 全空', `fc ${fc}`);
    }
  }

  if (p.number == null) rep.bump('number 为空（单元格留空）', `fc ${fc} ${first} ${last}`);
  if (p.ca == null) rep.bump('ca 为空', `fc ${fc}`);
  if (p.pa == null) rep.bump('pa 为空', `fc ${fc}`);

  let foot: string | null = null;
  if (p.foot === 1) foot = 'Right';
  else if (p.foot === 0) foot = 'Left';
  else rep.bump('foot 既不是 0 也不是 1（preferredfoot 留空）', `fc ${fc} foot=${String(p.foot)}`);

  const vals: Values = {
    playerid: fc,
    firstname: first,
    lastname: last,
    commonname: common,
    Position: posText('PosID1'),
    Position2: posText('PosID2'),
    Position3: posText('PosID3'),
    Position4: posText('PosID4'),
    number: p.number,
    teamid: p.club_id,
    // 三列缺口（birthdate / playerjointeamdate / contractvaliduntil）按用户裁定「s901 照抄，新人留空」
    playerjointeamdate: (p.prev?.join ?? null) as string | number | null,
    contractvaliduntil: (p.prev?.contractUntil ?? null) as string | number | null,
    overallrating: p.ca,
    potential: p.pa,
    birthdate: (p.prev?.birthdate ?? null) as string | number | null,
    nationality: at('naID'),
    preferredfoot: foot,
    weakfootabilitytypecode: at('weakfoot'),
    height: at('height'),
    weight: at('weight'),
    role1: roleTextAt(0),
    role2: roleTextAt(1),
    role3: roleTextAt(2),
    role4: roleTextAt(3),
    role5: roleTextAt(4),
    Playstyles: psTexts(silverIds, 'PSID1-12').join(', '),
    'Playstyles+': psTexts(goldIds, 'PSID13-15').join(', '),
  };
  for (const key of ATTR34) vals[key] = at(key);
  if (p.prev == null) rep.bump('s901 无此人（三列缺口留空）', `fc ${fc} ${first} ${last}`);

  return vals;
}

/** 按 FC_EDITOR_GAME_ATTR_COLUMNS 出列；缺列直接抛（表头真源变了就得改脚本）。 */
function toRow(vals: Values, fc: number): (string | number | null)[] {
  return FC_EDITOR_GAME_ATTR_COLUMNS.map((k) => {
    if (!(k in vals)) throw new Error(`fc ${fc}：列 ${k} 没有映射`);
    return vals[k];
  });
}

// ---------------------------------------------------------------- 组装

type BuiltClub = {
  club: SnapshotClub;
  rows: { fc: number; vals: Values }[];
  regFirst: number;
  regTrainee: number;
};

function buildSnapshot(): { snap: Snapshot; built: BuiltClub[]; rep: Reporter; prev: PrevIndex } {
  const refs = loadRefs();
  const rep = new Reporter();
  const prev = readPrev(PREV_DIR);
  for (const p of prev.problems) rep.bump(`s901 读取告警：${p}`);

  const src = SOURCE ? readSnapshot(SOURCE) : readProd();
  if (SOURCE) console.log(`  源：快照 ${resolve(SOURCE)}（${src.players.length} 人）`);
  else console.log(`  源：生产 D1 ${LOCAL ? '--local' : '--remote'}（${src.players.length} 人）`);

  const players: SnapshotPlayer[] = src.players.map((p) => ({
    ...p,
    prev: p.fc_id != null ? (prev.triple.get(p.fc_id) ?? null) : null,
  }));

  const built: BuiltClub[] = [];
  for (const c of src.clubs) {
    const mine = players.filter((p) => p.club_id === c.id);
    const kept = SQUAD === 'first_team' ? mine.filter((p) => p.reg_squad === 'first_team') : mine;
    const rows: { fc: number; vals: Values }[] = [];
    for (const p of kept) {
      const vals = buildValues(p, refs, rep);
      if (vals) rows.push({ fc: p.fc_id as number, vals });
    }
    // 行序：已存在的按 s901 内原顺序，新人按 fc_id 升序追加
    rows.sort((a, b) => {
      const oa = prev.triple.get(a.fc)?.order ?? Number.MAX_SAFE_INTEGER;
      const ob = prev.triple.get(b.fc)?.order ?? Number.MAX_SAFE_INTEGER;
      return oa !== ob ? oa - ob : a.fc - b.fc;
    });
    // 文件名：优先沿用 s901 原名（FC Editor 侧命名，3 支与 ref 不同），退 ref/team.json，再退 clubs.name
    let fileBase: string;
    let fileBaseFrom: SnapshotClub['fileBaseFrom'];
    if (prev.fileBase.has(c.id)) {
      fileBase = prev.fileBase.get(c.id) as string;
      fileBaseFrom = 'prev';
    } else if (refs.team.get(c.id)?.name) {
      fileBase = refs.team.get(c.id)?.name as string;
      fileBaseFrom = 'ref';
    } else {
      fileBase = c.name;
      fileBaseFrom = 'clubs';
      rep.bump('队名三源全缺，用 clubs.name 兜底', `club ${c.id}`);
    }
    const safe = fileBase.replace(/[\\/:*?"<>|]/g, '_');
    if (safe !== fileBase) rep.bump('队名含非法文件名字符，已替换为 _', `club ${c.id} 「${fileBase}」`);
    built.push({
      club: { id: c.id, name: c.name, fileName: `${c.id} - ${safe}.xlsx`, fileBase: safe, fileBaseFrom },
      rows,
      regFirst: mine.filter((p) => p.reg_squad === 'first_team').length,
      regTrainee: mine.filter((p) => p.reg_squad === 'trainee').length,
    });
  }

  const snap: Snapshot = {
    generatedAt: TS,
    source: SOURCE ? resolve(SOURCE) : `d1:${DB}:${LOCAL ? 'local' : 'remote'}`,
    prevDir: PREV_DIR,
    squad: SQUAD,
    clubs: built.map((b) => b.club),
    players,
  };
  return { snap, built, rep, prev };
}

// ---------------------------------------------------------------- 写盘

function writeXlsx(dir: string, b: BuiltClub) {
  const aoa: (string | number | null)[][] = [[...FC_EDITOR_GAME_ATTR_COLUMNS], ...b.rows.map((r) => toRow(r.vals, r.fc))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Squad Info');
  XLSX.writeFile(wb, join(dir, b.club.fileName));
}

/** 哨兵与空值统计：直接数产物里的值（不是数「异常」，两者在报告里分节）。 */
function sentinelStats(built: BuiltClub[]): [string, number][] {
  const c = new Map<string, number>();
  const bump = (k: string, cond: boolean) => {
    if (cond) c.set(k, (c.get(k) ?? 0) + 1);
  };
  let rows = 0;
  for (const b of built) {
    for (const r of b.rows) {
      rows++;
      const v = r.vals;
      bump('commonname 空串', v['commonname'] === '');
      bump('Position2 = None', v['Position2'] === POS_EMPTY);
      bump('Position3 = None', v['Position3'] === POS_EMPTY);
      bump('Position4 = None', v['Position4'] === POS_EMPTY);
      bump('role2 = 0', v['role2'] === ROLE_EMPTY);
      bump('role3 = 0', v['role3'] === ROLE_EMPTY);
      bump('role4 = 0', v['role4'] === ROLE_EMPTY);
      bump('role5 = 0', v['role5'] === ROLE_EMPTY);
      bump('Playstyles 空串', v['Playstyles'] === '');
      bump('Playstyles+ 空串', v["Playstyles+"] === '');
      bump('number 留空', v['number'] == null);
      bump('birthdate 留空（新人）', v['birthdate'] == null);
      bump('playerjointeamdate 留空（新人）', v['playerjointeamdate'] == null);
      bump('contractvaliduntil 留空（新人）', v['contractvaliduntil'] == null);
    }
  }
  return [['导出行数', rows], ...c.entries()] as [string, number][];
}

function reportLines(snap: Snapshot, built: BuiltClub[], rep: Reporter, prev: PrevIndex): string[] {
  const L: string[] = [];
  const total = built.reduce((n, b) => n + b.rows.length, 0);
  L.push('# S10 队表导出报告', '');
  L.push(`- 生成时点：${snap.generatedAt}`);
  L.push(`- 源：${snap.source}`);
  L.push(`- 球员范围：${snap.squad === 'all' ? 'all（一线队 + 训练营）' : 'first_team（仅一线队）'}`);
  L.push(`- 输出目录：${OUT_DIR}`);
  L.push(`- s901 对照目录：${snap.prevDir}`);
  L.push(`- 表头真源：src/core/fc26.ts 的 FC_EDITOR_GAME_ATTR_COLUMNS（${FC_EDITOR_GAME_ATTR_COLUMNS.length} 列）`);
  L.push(`- 合计：${built.length} 队 / ${total} 人`, '');

  L.push('## 1 逐队行数', '', '| club id | 文件名 | 队名来源 | 一线队 | 训练营 | 导出行数 | s901 行数 | 差 |', '|---|---|---|---|---|---|---|---|');
  for (const b of built) {
    const p = prev.rowsByClub.get(b.club.id) ?? 0;
    L.push(
      `| ${b.club.id} | ${b.club.fileName} | ${b.club.fileBaseFrom} | ${b.regFirst} | ${b.regTrainee} | ${b.rows.length} | ${p} | ${b.rows.length - p} |`,
    );
  }
  L.push('');

  L.push('## 2 哨兵与空值计数（产物实际值）', '', '| 项 | 计数 |', '|---|---|');
  for (const [k, n] of sentinelStats(built)) L.push(`| ${k} | ${n} |`);
  L.push('');

  L.push('## 3 异常与留空清单', '');
  if (rep.counters.size === 0) L.push('（无）', '');
  for (const [k, n] of rep.counters) {
    L.push(`### ${k} —— ${n} 处`, '');
    const s = rep.samples.get(k) ?? [];
    for (const line of s) L.push(`- ${line}`);
    if (n > s.length) L.push(`- …（另有 ${n - s.length} 处未列）`);
    L.push('');
  }
  if (prev.files.length === 0) L.push('> s901 目录没读到文件 ⇒ 三列缺口全部留空、逐队差 = 导出行数。', '');
  return L;
}

// ---------------------------------------------------------------- 自检（--verify）

function recomputeRows(snap: Snapshot): { built: BuiltClub[]; rep: Reporter } {
  const refs = loadRefs();
  const rep = new Reporter();
  const orderOf = new Map<number, number>();
  for (const p of snap.players) if (p.fc_id != null) orderOf.set(p.fc_id, p.prev?.order ?? Number.MAX_SAFE_INTEGER);
  const built: BuiltClub[] = [];
  for (const c of snap.clubs) {
    const mine = snap.players.filter((p) => p.club_id === c.id);
    const kept = snap.squad === 'first_team' ? mine.filter((p) => p.reg_squad === 'first_team') : mine;
    const rows: { fc: number; vals: Values }[] = [];
    for (const p of kept) {
      const vals = buildValues(p, refs, rep);
      if (vals) rows.push({ fc: p.fc_id as number, vals });
    }
    rows.sort((a, b) => {
      const oa = orderOf.get(a.fc) ?? Number.MAX_SAFE_INTEGER;
      const ob = orderOf.get(b.fc) ?? Number.MAX_SAFE_INTEGER;
      return oa !== ob ? oa - ob : a.fc - b.fc;
    });
    built.push({ club: c, rows, regFirst: 0, regTrainee: 0 });
  }
  return { built, rep };
}

function runVerify(): number {
  const snapPath = join(OUT_DIR, 'players.json');
  if (!existsSync(snapPath)) {
    console.error(`找不到快照 ${snapPath}——先跑一次导出再 --verify`);
    return 2;
  }
  const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as Snapshot;
  const { built } = recomputeRows(snap);
  const diffs: { club: number; fc: number; col: string; want: unknown; got: unknown; kind: string }[] = [];
  const L: string[] = ['# S10 导出自检报告（--verify）', '', `- 时点：${new Date().toISOString()}`, `- 目录：${OUT_DIR}`, `- 快照：${snap.generatedAt}`, ''];

  // 文件集合
  const want = new Set(snap.clubs.map((c) => c.fileName));
  const gotFiles = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$')) : [];
  for (const f of gotFiles) if (!want.has(f)) diffs.push({ club: 0, fc: 0, col: '(文件)', want: '(不该存在)', got: f, kind: '多余文件' });
  for (const f of want) if (!gotFiles.includes(f)) diffs.push({ club: 0, fc: 0, col: '(文件)', want: f, got: '(缺失)', kind: '缺文件' });

  for (const b of built) {
    const path = join(OUT_DIR, b.club.fileName);
    if (!existsSync(path)) continue;
    const wb = XLSX.readFile(path);
    const sheet = wb.Sheets['Squad Info'];
    if (!sheet) {
      diffs.push({ club: b.club.id, fc: 0, col: '(sheet)', want: 'Squad Info', got: wb.SheetNames.join(','), kind: 'sheet 名' });
      continue;
    }
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
    const head = (aoa[0] ?? []).map((v) => String(v));
    if (head.length !== FC_EDITOR_GAME_ATTR_COLUMNS.length || head.some((h, i) => h !== FC_EDITOR_GAME_ATTR_COLUMNS[i])) {
      diffs.push({ club: b.club.id, fc: 0, col: '(表头)', want: `${FC_EDITOR_GAME_ATTR_COLUMNS.length} 列`, got: `${head.length} 列`, kind: '表头' });
    }
    if (aoa.length - 1 !== b.rows.length) {
      diffs.push({ club: b.club.id, fc: 0, col: '(行数)', want: b.rows.length, got: aoa.length - 1, kind: '行数' });
    }
    for (let i = 0; i < b.rows.length; i++) {
      const r = b.rows[i];
      const line = aoa[i + 1];
      if (!line) continue;
      const wantRow = toRow(r.vals, r.fc);
      FC_EDITOR_GAME_ATTR_COLUMNS.forEach((col, ci) => {
        const wantV = wantRow[ci];
        const gotV = line[ci] ?? null;
        if (wantV == null && gotV == null) return;
        if (wantV == null || gotV == null) {
          diffs.push({ club: b.club.id, fc: r.fc, col, want: wantV, got: gotV, kind: '空值' });
          return;
        }
        if (typeof wantV === 'number') {
          if (typeof gotV !== 'number' || gotV !== wantV) {
            diffs.push({ club: b.club.id, fc: r.fc, col, want: wantV, got: gotV, kind: typeof gotV !== 'number' ? '单元格类型' : '值' });
          }
        } else if (typeof gotV !== 'string' || gotV !== wantV) {
          diffs.push({ club: b.club.id, fc: r.fc, col, want: wantV, got: gotV, kind: typeof gotV !== 'string' ? '单元格类型' : '值' });
        }
      });
    }
  }

  const byCol = new Map<string, number>();
  for (const d of diffs) byCol.set(d.col, (byCol.get(d.col) ?? 0) + 1);
  L.push('## 结果', '', diffs.length === 0 ? '✅ 逐列自检通过（值 + 单元格类型 + 表头 + 行数 + 文件集合）' : `❌ 差异 ${diffs.length} 处`, '');
  if (diffs.length) {
    L.push('| 列 | 计数 |', '|---|---|');
    for (const [c, n] of [...byCol.entries()].sort((a, b) => b[1] - a[1])) L.push(`| ${c} | ${n} |`);
    L.push('', '## 前 50 处明细', '', '| club | fc | 列 | 期望 | 实得 | 类型 |', '|---|---|---|---|---|---|');
    for (const d of diffs.slice(0, 50)) L.push(`| ${d.club} | ${d.fc} | ${d.col} | ${String(d.want)} | ${String(d.got)} | ${d.kind} |`);
  }
  writeFileSync(join(OUT_DIR, 'verify-report.md'), L.join('\n') + '\n');
  console.log(L.slice(0, 40).join('\n'));
  console.log(`\n报告：${join(OUT_DIR, 'verify-report.md')}`);
  return diffs.length === 0 ? 0 : 4;
}

// ---------------------------------------------------------------- s901 对照（--diff-prev）

function runDiffPrev(): number {
  const snapPath = join(OUT_DIR, 'players.json');
  if (!existsSync(snapPath)) {
    console.error(`找不到快照 ${snapPath}——先跑一次导出再 --diff-prev`);
    return 2;
  }
  const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as Snapshot;
  const prev = readPrev(PREV_DIR);
  const { built, rep } = recomputeRows(snap);
  const rowsByFc = new Map<number, Values>();
  for (const b of built) for (const r of b.rows) rowsByFc.set(r.fc, r.vals);

  // 逐字符比较：null 与空串都表示「没有字符」⇒ 等值；其余一律 String(v) 逐字比，
  // 不做 trim / 大小写 / 标点 / 连字符归一（「全字段全字符」）。
  const charOf = (v: unknown): string => (v == null ? '' : String(v));
  const cell = (v: unknown): string => (charOf(v) === '' ? '（空）' : String(v).replace(/\|/g, '\\|'));
  const diffs: { fc: number; col: string; prev: unknown; mine: unknown }[] = [];
  const missingInMine: number[] = [];
  let cells = 0;
  for (const [fc, pr] of prev.byFc) {
    const mine = rowsByFc.get(fc);
    if (!mine) {
      missingInMine.push(fc);
      continue;
    }
    for (const col of FC_EDITOR_GAME_ATTR_COLUMNS) {
      cells++;
      const a = pr[col] ?? null;
      const b = mine[col] ?? null;
      if (charOf(a) === charOf(b)) continue;
      diffs.push({ fc, col, prev: a, mine: b });
    }
  }

  const hard = diffs.filter((d) => HARD_COLS.has(d.col));
  const soft = diffs.filter((d) => SOFT_COLS.has(d.col));
  const text = diffs.filter((d) => TEXT_COLS.has(d.col));
  const editable = diffs.filter((d) => EDITABLE_COLS.has(d.col));

  const L: string[] = ['# S10 导出 vs s901 对照报告（--diff-prev）', ''];
  L.push(`- 时点：${new Date().toISOString()}`);
  L.push(`- 导出快照：${snap.generatedAt}`);
  L.push(`- s901 目录：${PREV_DIR}（${prev.files.length} 文件 / ${prev.byFc.size} 人）`);
  L.push(`- 导出人数：${rowsByFc.size}`);
  L.push(
    `- 比较口径：**全字段全字符** —— 61 列逐列、逐字符比对（${prev.byFc.size} 人 × 61 列 = ${cells.toLocaleString('en-US')} 个单元格），` +
      '不做 trim / 大小写 / 标点归一；null 与空串都表示「没有字符」，视为等值。',
  );
  L.push('');
  L.push('## 分级口径', '');
  L.push('- **A 硬闸**（playerid / Position1-4 / teamid / nationality / preferredfoot / height / weight / weakfootabilitytypecode / 三列缺口）：S9 时两侧逐字一致（0 处）；此后出现差异要么平台内改过、要么映射出错 ⇒ **必须 0，非 0 停下人工确认**。');
  L.push('- **B 数值**（overallrating / potential / 34 项能力）：导出取库内现值（`ca` / `pa` + `game_attrs`），与 2026-09-05 快照不同是平台内成长与订正的正常结果 ⇒ 不算失败，逐条列。');
  L.push('- **C 文本**（role1-5 / Playstyles / Playstyles+）：导出按**库内槽位顺序** + 平台反查表出值（忠实线上库）；与 s901 的写法（连字符 / 双空格 / 大小写）、顺序、生涯特性差异 ⇒ 不算失败，逐条列。');
  L.push('- **D 平台侧可编辑**（firstname / lastname / commonname / number）：平台是姓名与球衣号的真源（v6.0.0 起在平台内维护、可编辑）⇒ 不算失败，逐条列。');
  L.push('');
  L.push('## 结果', '');
  L.push(`- A 硬闸差异：**${hard.length}**（${hard.length === 0 ? '通过' : '不通过'}）`);
  L.push(`- B 数值差异：${soft.length} 处（不算失败，平台库现值）`);
  L.push(`- C 文本差异：${text.length} 处（不算失败，平台库槽位与反查表）`);
  L.push(`- D 平台侧可编辑差异：${editable.length} 处（不算失败）`);
  L.push(`- 差异涉及球员：${new Set(diffs.map((d) => d.fc)).size} 人 / 共 ${diffs.length} 处`);
  L.push(`- s901 花式库内无槽位（不回填）：${rep.get('s901 花式库内无槽位（不回填）')} 处`);
  L.push(`- s901 角色库内无槽位（不回填）：${rep.get('s901 角色库内无槽位（不回填）')} 处`);
  L.push(
    `- s901 有、本次导出无：${missingInMine.length} 人${missingInMine.length ? `（fc ${missingInMine.slice(0, 20).join(', ')}${missingInMine.length > 20 ? ' …' : ''}）` : ''}`,
  );
  L.push('');
  L.push('## 61 列逐列差异计数（含 0，全字段留痕）', '', '| # | 列 | 分级 | 差异数 |', '|---|---|---|---|');
  const byCol = new Map<string, number>();
  for (const d of diffs) byCol.set(d.col, (byCol.get(d.col) ?? 0) + 1);
  FC_EDITOR_GAME_ATTR_COLUMNS.forEach((c, i) => {
    const cls = HARD_COLS.has(c) ? 'A' : SOFT_COLS.has(c) ? 'B' : TEXT_COLS.has(c) ? 'C' : 'D';
    L.push(`| ${i + 1} | ${c} | ${cls} | ${byCol.get(c) ?? 0} |`);
  });
  L.push('');
  const dump = (title: string, arr: { fc: number; col: string; prev: unknown; mine: unknown }[]) => {
    L.push(`## ${title}`, '');
    if (arr.length === 0) {
      L.push('（无）', '');
      return;
    }
    const by = new Map<string, number>();
    for (const d of arr) by.set(d.col, (by.get(d.col) ?? 0) + 1);
    L.push(`按列：${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join('、')}`, '');
    L.push('| fc | 列 | s901 | 本次导出 |', '|---|---|---|---|');
    for (const d of arr) L.push(`| ${d.fc} | ${d.col} | ${cell(d.prev)} | ${cell(d.mine)} |`);
    L.push('');
  };
  dump('A 硬闸差异（必须 0）', hard);
  dump('B 数值差异（不算失败，平台库现值）', soft);
  dump('C 文本差异（不算失败，平台库槽位与反查表）', text);
  dump('D 平台侧可编辑差异（不算失败）', editable);
  writeFileSync(join(OUT_DIR, 'diff-prev-report.md'), L.join('\n') + '\n');
  console.log(L.slice(0, 20).join('\n'));
  console.log(`\n报告：${join(OUT_DIR, 'diff-prev-report.md')}`);
  return hard.length === 0 ? 0 : 4;
}

// ---------------------------------------------------------------- main

function main(): number {
  if (VERIFY) return runVerify();
  if (DIFF_PREV) return runDiffPrev();

  console.log(`S10 队表导出${DRY ? '（dry-run，不写文件）' : ''}`);
  console.log(`  输出目录：${OUT_DIR}`);
  console.log(`  s901 目录：${PREV_DIR}`);
  const { snap, built, rep, prev } = buildSnapshot();

  if (!DRY) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const b of built) writeXlsx(OUT_DIR, b);
    writeFileSync(join(OUT_DIR, 'players.json'), JSON.stringify(snap, null, 1) + '\n');
    writeFileSync(join(OUT_DIR, 'export-report.md'), reportLines(snap, built, rep, prev).join('\n') + '\n');
  }

  const total = built.reduce((n, b) => n + b.rows.length, 0);
  console.log('');
  console.log(`逐队行数（合计 ${built.length} 队 / ${total} 人）：`);
  for (const b of built) {
    const p = prev.rowsByClub.get(b.club.id) ?? 0;
    console.log(`  ${b.club.fileName.padEnd(34)} ${String(b.rows.length).padStart(3)} 行  （s901 ${String(p).padStart(3)}，差 ${b.rows.length - p >= 0 ? '+' : ''}${b.rows.length - p}）`);
  }
  if (rep.counters.size) {
    console.log('\n异常与留空计数：');
    for (const [k, n] of [...rep.counters.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}：${n}`);
  } else {
    console.log('\n异常与留空计数：无');
  }
  if (!DRY) {
    console.log(`\n产物：${built.length} 个 xlsx + players.json + export-report.md → ${OUT_DIR}`);
    console.log('下一步：node gen-export.ts --verify --out "' + OUT_DIR + '"  &&  node gen-export.ts --diff-prev --out "' + OUT_DIR + '"');
  }
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error(`导出失败：${(e as Error).message}`);
  process.exit(3);
}
