// S9 队籍对齐（FC Editor s901 队壳文件 → 生产 players.club_id）离线 SQL 生成器
//
// 口径（用户 2026-09-20 裁定「s901 对齐归属」）：
//   把 s901 那 570 名球员的 players.club_id 写到 **其所在队壳文件名前缀** 对应的俱乐部 id 上（含 4 支 CPU 队）。
//   只写 club_id 一列（+ updated_at），不动能力/合同/状态/成长字段。
//
// 为什么单开一批：生产现值是 2026-09-19 回填的 **EA 原始队籍**，而 s901 与一线队-S9.csv 是 **联盟世界**
// （两源 570/570 归属一致，见 README §3）。按 s901 对齐后，原本 84 行「异队冲突」不再是冲突，
// 合同批（通道 C）即可整队导入 —— 这是本批排在合同批之前的唯一理由。
//
// 守卫：每行 `WHERE fc_id = ? AND club_id IS 旧值`（NULL 用 `IS NULL`）——重放或错版落库时 changes = 0。
//
// 用法：
//   node gen-club-align-sql.ts [源目录] [每片语句数]   生成分片 + 回滚 + 预检/验收 + 报告
//   node gen-club-align-sql.ts --verify                只读复核：执行后重算，期望「剩余差异 0 行」
//   node gen-club-align-sql.ts --local                 读本地 D1（本地演练用，默认远端只读）

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const SRC_DIR = POSITIONAL[0] ?? 'E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901';
const PER_FILE = Number(POSITIONAL[1] ?? 200);
const DB = 'whl-club';
const TS = new Date().toISOString();
/** 队籍变更会牵连的表：执行前全表必须为 0（否则改归属会把既有单据挂到错队上）。 */
const GUARD_TABLES = ['contracts', 'listings', 'registrations', 'negotiation_sessions', 'transfers', 'bids'];

type SrcRow = { fcId: number; clubId: number; name: string; teamId: number | null };
type ProdRow = { id: number; name: string; clubId: number | null; status: string | null };
type Change = { fcId: number; name: string; from: number | null; to: number };

function lit(v: string | number | null): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------- 源（s901 20 个队壳 xlsx）

function readSource(dir: string): SrcRow[] {
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx'))
    .sort();
  const rows: SrcRow[] = [];
  const seen = new Map<number, string>();
  for (const file of files) {
    const m = /^(\d+)\s*-\s*(.+)\.xlsx$/i.exec(file);
    if (!m) {
      console.warn(`跳过文件名不含俱乐部 id 的文件：${file}`);
      continue;
    }
    const clubId = Number(m[1]);
    const wb = XLSX.read(readFileSync(join(dir, file)), { type: 'buffer' });
    const sheet = wb.Sheets['Squad Info'] ?? wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) throw new Error(`${file} 里找不到 Squad Info 表`);
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
    for (const r of json) {
      const fcId = Number(r['playerid']);
      if (!Number.isFinite(fcId)) continue;
      const prev = seen.get(fcId);
      if (prev) throw new Error(`球员 ${fcId} 同时出现在 ${prev} 与 ${file}`);
      seen.set(fcId, file);
      const teamId = Number(r['teamid']);
      rows.push({
        fcId,
        clubId,
        name: String(r['commonname'] ?? '').trim() || `${r['firstname'] ?? ''} ${r['lastname'] ?? ''}`.trim(),
        teamId: Number.isFinite(teamId) ? teamId : null,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- 生产库（只读）

function d1Rows(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  // 必须传单个命令字符串（传 args 数组 + shell:true 不转义，Node DEP0190）；SQL 必须单行（多行报 incomplete input）
  const cmd = `npx wrangler d1 execute ${DB} ${scope} --json --command "${sql}"`;
  const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`wrangler 读取失败（exit ${res.status}）：\n${res.stderr || res.stdout}`);
  const at = res.stdout.indexOf('[');
  if (at < 0) throw new Error(`wrangler 输出不是 JSON：\n${res.stdout.slice(0, 400)}`);
  const parsed = JSON.parse(res.stdout.slice(at)) as Array<{ results?: Record<string, unknown>[] }>;
  return parsed[0]?.results ?? [];
}

function loadProd(fcIds: number[]): Map<number, ProdRow> {
  const out = new Map<number, ProdRow>();
  for (let i = 0; i < fcIds.length; i += 90) {
    const chunk = fcIds.slice(i, i + 90);
    const rows = d1Rows(`SELECT id, fc_id, name, club_id, status FROM players WHERE fc_id IN (${chunk.join(',')})`);
    for (const r of rows) {
      out.set(Number(r['fc_id']), {
        id: Number(r['id']),
        name: String(r['name'] ?? ''),
        clubId: r['club_id'] == null ? null : Number(r['club_id']),
        status: r['status'] == null ? null : String(r['status']),
      });
    }
  }
  return out;
}

/** 平台现任队籍（用于「遗留球员」分析：对齐后各队名单 = s901 名单 + 遗留）。 */
function loadRoster(): Map<number, number> {
  const rows = d1Rows('SELECT fc_id, club_id FROM players WHERE club_id IS NOT NULL');
  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r['fc_id']), Number(r['club_id']));
  return out;
}

function loadClubs(): Map<number, string> {
  const rows = d1Rows('SELECT id, name FROM clubs ORDER BY id');
  return new Map(rows.map((r) => [Number(r['id']), String(r['name'] ?? '')]));
}

function tableCounts(): Map<string, number> {
  const exprs = GUARD_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`);
  const row = d1Rows(`SELECT ${exprs.join(', ')}`)[0] ?? {};
  return new Map(GUARD_TABLES.map((t) => [t, Number(row[t] ?? -1)]));
}

// ---------------------------------------------------------------- 差异与 SQL

function computeChanges(src: SrcRow[], prod: Map<number, ProdRow>): { changes: Change[]; missing: number[] } {
  const changes: Change[] = [];
  const missing: number[] = [];
  for (const s of src) {
    const p = prod.get(s.fcId);
    if (!p) {
      missing.push(s.fcId);
      continue;
    }
    if (p.clubId === s.clubId) continue; // 已对齐 ⇒ 不产生语句
    changes.push({ fcId: s.fcId, name: p.name || s.name, from: p.clubId, to: s.clubId });
  }
  return { changes, missing };
}

function buildUpdate(c: Change, reverse: boolean): string {
  const to = reverse ? c.from : c.to;
  const guard = reverse ? c.to : c.from;
  return `UPDATE players SET club_id = ${lit(to)}, updated_at = ${lit(TS)} WHERE fc_id = ${c.fcId} AND club_id IS ${lit(guard)};`;
}

function shards<T>(list: T[], size: number): { no: string; from: number; to: number; items: T[] }[] {
  const out: { no: string; from: number; to: number; items: T[] }[] = [];
  for (let i = 0; i < list.length; i += size) {
    const items = list.slice(i, i + size);
    out.push({ no: String(out.length + 1).padStart(2, '0'), from: i + 1, to: i + items.length, items });
  }
  return out;
}

/** 先清掉上一次生成的分片：行数会随库内状态变化，留旧片会让人误以为还有第 3 片。 */
function clearShards(dir: string, prefix: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(prefix) && name.endsWith('.sql')) unlinkSync(join(dir, name));
  }
}

function writeShards(dir: string, prefix: string, changes: Change[], reverse: boolean, manifest: string[]): number {
  mkdirSync(dir, { recursive: true });
  clearShards(dir, prefix);
  let files = 0;
  for (const part of shards(changes, PER_FILE)) {
    const name = `${prefix}-${part.no}.sql`;
    const head = [
      `-- S9 队籍对齐（${reverse ? '回滚' : '落库'}）分片 ${part.no}`,
      `-- 生成器 scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 ${TS}`,
      `-- 覆盖第 ${part.from}-${part.to} 条语句（共 ${changes.length} 条）；源 ${SRC_DIR}`,
      `-- 口径：只写 players.club_id（+ updated_at），不动能力/合同/状态/成长字段`,
      `-- 守卫：WHERE fc_id = ? AND club_id IS ${reverse ? '新' : '旧'}值 ⇒ 重复执行 changes = 0`,
      '',
    ].join('\n');
    const body = part.items.map((c) => `-- ${c.fcId} ${c.name} ${c.from ?? 'NULL'} -> ${c.to}\n${buildUpdate(c, reverse)}`).join('\n');
    const text = `${head}${body}\n`;
    writeFileSync(join(dir, name), text, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    const sha = createHash('sha256').update(text, 'utf8').digest('hex');
    manifest.push(`| ${reverse ? 'rollback/' : 'sql/'}${name} | ${part.from}-${part.to} | ${part.items.length} | ${bytes} | \`${sha}\` |`);
    files++;
  }
  return files;
}

// ---------------------------------------------------------------- 预检 / 验收

function buildPrecheck(fcIds: number[]): string {
  const list = fcIds.join(',');
  return [
    '-- S9 队籍对齐 · 执行前复查（只读，全部单行语句）',
    `-- 生成器 scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 ${TS}`,
    '',
    `SELECT (SELECT COUNT(*) FROM players WHERE fc_id IN (${list})) AS matched_570,`,
    `       (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND club_id IS NULL) AS from_null,`,
    `       (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND club_id IS NOT NULL) AS from_club;`,
    '',
    ...GUARD_TABLES.map((t) => `SELECT COUNT(*) AS ${t} FROM ${t};`),
    '',
    '-- 对齐后各队名单规模（应与 02-verify.sql 的 aligned 列一致）',
    'SELECT club_id, COUNT(*) AS n FROM players WHERE club_id IS NOT NULL GROUP BY club_id ORDER BY club_id;',
    '',
  ].join('\n');
}

function buildVerify(fcIds: number[]): string {
  const list = fcIds.join(',');
  return [
    '-- S9 队籍对齐 · 执行后验收（只读）',
    `-- 生成器 scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 ${TS}`,
    '-- 判据：remaining_570 = 0（570 人全部与 s901 一致）；from_null 归零的 323 人已落到目标队',
    '',
    `SELECT (SELECT COUNT(*) FROM players WHERE fc_id IN (${list}) AND club_id IS NULL) AS null_left;`,
    '',
    '-- 逐队「s901 名单人数 vs 平台现任人数」对照（is_cpu 仅作标注）',
    'SELECT c.id AS club_id, c.name, c.is_cpu,',
    '       (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS roster_now',
    '  FROM clubs c ORDER BY c.id;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 报告

function buildReport(args: {
  src: SrcRow[];
  prod: Map<number, ProdRow>;
  changes: Change[];
  missing: number[];
  roster: Map<number, number>;
  clubs: Map<number, string>;
  counts: Map<string, number>;
  sqlFiles: number;
  rbFiles: number;
  manifest: string[];
}): string {
  const { src, prod, changes, missing, roster, clubs, counts, sqlFiles, rbFiles, manifest } = args;
  const perClub = new Map<number, { src: number; aligned: number; change: number; claim: number; leave: number; leftover: number }>();
  const bump = (clubId: number) => {
    let v = perClub.get(clubId);
    if (!v) {
      v = { src: 0, aligned: 0, change: 0, claim: 0, leave: 0, leftover: 0 };
      perClub.set(clubId, v);
    }
    return v;
  };
  const srcIds = new Set(src.map((s) => s.fcId));
  for (const s of src) bump(s.clubId).src++;
  for (const c of changes) {
    const to = bump(c.to);
    if (c.from == null) to.claim++;
    else {
      to.change++;
      bump(c.from).leave++;
    }
  }
  for (const s of src) {
    const p = prod.get(s.fcId);
    if (p && p.clubId === s.clubId) bump(s.clubId).aligned++;
  }
  for (const [fcId, clubId] of roster) if (!srcIds.has(fcId) && perClub.has(clubId)) bump(clubId).leftover++;

  const statusDist = new Map<string, number>();
  for (const s of src) {
    const p = prod.get(s.fcId);
    const k = p?.status ?? '(缺失)';
    statusDist.set(k, (statusDist.get(k) ?? 0) + 1);
  }

  const L: string[] = [];
  L.push('# S9 队籍对齐 · 生成报告');
  L.push('');
  L.push(`- 生成器：scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 ${TS}`);
  L.push(`- 源：${SRC_DIR}（20 个「<clubs.id> - <队名>.xlsx」，sheet \`Squad Info\`，键 \`playerid\`）`);
  L.push(`- 口径：只写 players.club_id = 队壳文件名前缀对应俱乐部；含 4 支 CPU 队；不动能力/合同/状态/成长字段`);
  L.push('');
  L.push('## 1. 汇总');
  L.push('');
  L.push(`| 指标 | 值 |`);
  L.push(`| --- | --- |`);
  L.push(`| 源球员行 | ${src.length} |`);
  L.push(`| 生产命中（按 fc_id）| ${src.length - missing.length} |`);
  L.push(`| 未命中（须先跑球员导入）| ${missing.length}${missing.length ? `：${missing.slice(0, 20).join(', ')}` : ''} |`);
  L.push(`| 已对齐（无需语句）| ${src.length - changes.length - missing.length} |`);
  L.push(`| **待更新语句** | **${changes.length}**（改队 ${changes.filter((c) => c.from != null).length} + 认领 ${changes.filter((c) => c.from == null).length}）|`);
  L.push(`| SQL 分片 / 回滚分片 | ${sqlFiles} / ${rbFiles}（每片 ${PER_FILE} 条）|`);
  L.push('');
  L.push('## 2. 执行前守卫表（全表行数，必须全 0）');
  L.push('');
  L.push('| 表 | 行数 |');
  L.push('| --- | --- |');
  for (const [t, n] of counts) L.push(`| ${t} | ${n} |`);
  L.push('');
  L.push('## 3. 逐队明细');
  L.push('');
  L.push('`s901` = 队壳文件人数；`已对齐` = 现在就对；`认领` = 现在无队籍；`改队` = 从别队转来；`移出` = 本批移走的现任球员；`遗留` = 平台现任但不在 s901 任何文件里（本批不动，仍挂在本队）。');
  L.push('');
  L.push('| club_id | 队名 | s901 | 已对齐 | 认领 | 改队 | 移出 | 遗留 | 对齐后名单估算 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  let tSrc = 0, tAligned = 0, tClaim = 0, tChange = 0, tLeave = 0, tLeftover = 0;
  for (const [clubId, v] of [...perClub].sort((a, b) => a[0] - b[0])) {
    tSrc += v.src; tAligned += v.aligned; tClaim += v.claim; tChange += v.change; tLeave += v.leave; tLeftover += v.leftover;
    L.push(
      `| ${clubId} | ${clubs.get(clubId) ?? '?'} | ${v.src} | ${v.aligned} | ${v.claim} | ${v.change} | ${v.leave} | ${v.leftover} | ${v.src + v.leftover} |`,
    );
  }
  L.push(`| — | **合计** | ${tSrc} | ${tAligned} | ${tClaim} | ${tChange} | ${tLeave} | ${tLeftover} | — |`);
  L.push('');
  L.push(`「对齐后名单估算」= s901 人数 + 遗留人数（遗留球员本批不动；`);
  L.push(`其中 ${tLeftover} 名平台现任球员不在 s901 文件里 ⇒ 若要严格按联盟世界收口名单，需另开一批处理）。`);
  L.push('');
  L.push('## 4. 球员 status 分布（本批不动该列）');
  L.push('');
  L.push('| status | 行数 |');
  L.push('| --- | --- |');
  for (const [k, n] of [...statusDist].sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${n} |`);
  L.push('');
  L.push('## 5. 工件清单');
  L.push('');
  L.push('| 文件 | 语句区间 | 条数 | 字节 | sha256 |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const line of manifest) L.push(line);
  L.push('');
  L.push('生成物**不可逐字节复现**：旧队籍取自生成时点的生产库，时间戳亦为生成时点。回滚分片已提交，落库分片 gitignore。');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- 主流程

const src = readSource(SRC_DIR);
const fcIds = src.map((s) => s.fcId);
const prod = loadProd(fcIds);
const { changes, missing } = computeChanges(src, prod);

if (VERIFY) {
  const aligned = src.length - changes.length - missing.length;
  console.log(`源 ${src.length} 行；缺失 ${missing.length}；已对齐 ${aligned}；剩余差异 ${changes.length}`);
  if (changes.length > 0) {
    for (const c of changes.slice(0, 20)) console.log(`  ${c.fcId} ${c.name} ${c.from ?? 'NULL'} -> ${c.to}`);
  }
  if (missing.length > 0) for (const id of missing.slice(0, 20)) console.log(`  缺失 ${id}`);
  process.exit(changes.length === 0 && missing.length === 0 ? 0 : 4);
}

if (missing.length > 0) {
  console.error(`源里有 ${missing.length} 名球员在生产库按 fc_id 查不到：${missing.slice(0, 20).join(', ')}`);
  process.exit(3);
}

const roster = loadRoster();
const clubs = loadClubs();
const counts = tableCounts();
const manifest: string[] = [];
const sqlFiles = writeShards(OUT_DIR, 'club-align-update', changes, false, manifest);
const rbFiles = writeShards(RB_DIR, 'club-align-rollback', changes, true, manifest);
writeFileSync(join(HERE, '01-precheck.sql'), buildPrecheck(fcIds), 'utf8');
writeFileSync(join(HERE, '02-verify.sql'), buildVerify(fcIds), 'utf8');
writeFileSync(
  join(HERE, 'club-align-report.md'),
  buildReport({ src, prod, changes, missing, roster, clubs, counts, sqlFiles, rbFiles, manifest }),
  'utf8',
);

console.log(`源 ${src.length} 行｜生产命中 ${src.length - missing.length}｜已对齐 ${src.length - changes.length}｜语句 ${changes.length}`);
console.log(`分片 sql/${sqlFiles} 片、rollback/${rbFiles} 片（每片 ${PER_FILE} 条）`);
const notZero = [...counts].filter(([, n]) => n !== 0);
if (notZero.length > 0) {
  console.warn(`⚠️ 守卫表非空（改归属会牵连既有单据）：${notZero.map(([t, n]) => `${t}=${n}`).join('、')}`);
}
