// S9 队籍收尾：把「不在 20 队联盟世界名单里」的平台在册球员释放为自由身
//
// 口径（用户 2026-09-21 裁定「clubID改null，status改free」）：
//   集合 = `players.club_id IS NOT NULL` 且 `fc_id` **不在** s901 那 570 人里
//          （即 2026-09-21 队籍对齐批之后仍然挂在 20 队名下、但联盟世界 20 队名单里没有的名字）。
//   动作 = 写 `players.club_id = NULL` + `players.status = 'free'`（+ `updated_at`）；
//          能力 / 合同 / 成长字段一行不动——本批不走解约路径，不做 CA 回基准与 XP 清零。
//     —— 归属判定一律看 `club_id`（球员库「自由身」筛选、海捞池、合同认领）；`status='free'` 是标签层
//        （球员库徽章与状态筛选）。既存 17427 名自由身是 `status='normal'` + `club_id IS NULL`，
//        本批按用户裁定改用 `free` 标；入队后 status 会被转会落位按新合同类型规范化
//        （src/worker/transfers.ts:199 的 `SET club_id = ?, status = ?`）。
//
// 为什么单开一批：队籍对齐批（scripts/prod-20260920-s9-club-align/，2026-09-21 已执行）只动了 s901 的 570 人，
//   对齐后全库在册 = 874 = 570（联盟世界名单）+ 304（遗留）。用户裁决把遗留这 304 人释放，使在册集合与联盟世界一致。
//   与合同批（462 行）/ 能力批（570 行）无交集：那两条批的 fc_id 全部属于 570 人集合。
//
// 守卫：落库每行 `WHERE fc_id = ? AND club_id IS 旧值 AND status = 旧值`；
//   回滚 `WHERE fc_id = ? AND club_id IS NULL AND status = 'free'` 写回旧队籍 + 旧 status。
//   重放或错版落库时 changes = 0。
//
// 用法：
//   node gen-free-leftover-sql.ts [源目录] [每片语句数]   生成分片 + 回滚 + 预检/验收 + 报告
//   node gen-free-leftover-sql.ts --verify                只读复核：期望「遗留 0 行」（退出码 0；有遗留退 4）
//   node gen-free-leftover-sql.ts --local                 读本地 D1（本地演练用，默认远端只读）

import { mkdirSync, readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const SRC_DIR =
  POSITIONAL[0] ?? 'E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901';
const PER_FILE = Number(POSITIONAL[1] ?? 200);
const DB = 'whl-club';
const TS = new Date().toISOString();
/** 释放归属会牵连的表：执行前全表必须为 0（否则会把既有单据挂到无队球员上）。 */
const GUARD_TABLES = ['contracts', 'listings', 'registrations', 'negotiation_sessions', 'transfers', 'bids'];

type RosterRow = { fcId: number; name: string; clubId: number; status: string };
type Change = { fcId: number; name: string; from: number; statusFrom: string };

/** SQL 字符串字面量（单引号转义）——status 值取自库内，落库前一律过一遍。 */
function lit(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------- 源（s901 20 个队壳 xlsx → 570 个 fc_id）

function readSourceIds(dir: string): Set<number> {
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx'))
    .sort();
  const ids = new Set<number>();
  for (const file of files) {
    if (!/^(\d+)\s*-\s*(.+)\.xlsx$/i.test(file)) continue;
    const wb = XLSX.read(readFileSync(join(dir, file)), { type: 'buffer' });
    const sheet = wb.Sheets['Squad Info'] ?? wb.Sheets[wb.SheetNames[0]!];
    if (!sheet) throw new Error(`${file} 里找不到 Squad Info 表`);
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
    for (const r of json) {
      const rawId = r['playerid'];
      if (rawId == null || rawId === '') continue;
      const fcId = Number(rawId);
      if (!Number.isFinite(fcId) || fcId <= 0) continue;
      ids.add(fcId);
    }
  }
  return ids;
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

/** 全部在册球员（club_id IS NOT NULL）；只在本地按 s901 集合取补集，避免 570 项 NOT IN 长串。 */
function loadRoster(): RosterRow[] {
  // fc_id 是本批唯一的定位键：为空的行读进来会变成 fc_id = 0（永不命中的假语句），必须显式拦下
  const orphan = d1Rows('SELECT COUNT(*) AS n FROM players WHERE club_id IS NOT NULL AND fc_id IS NULL')[0];
  const orphanN = Number(orphan?.['n'] ?? 0);
  if (orphanN > 0) {
    throw new Error(`有 ${orphanN} 名在册球员 fc_id 为空，无法按 fc_id 定位，本批不支持；先补齐 fc_id 或人工处理`);
  }
  const rows = d1Rows('SELECT fc_id, name, club_id, status FROM players WHERE club_id IS NOT NULL');
  return rows.map((r) => ({
    fcId: Number(r['fc_id']),
    name: String(r['name'] ?? ''),
    clubId: Number(r['club_id']),
    status: String(r['status'] ?? ''),
  }));
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

function computeChanges(roster: RosterRow[], srcIds: Set<number>): Change[] {
  return roster
    .filter((r) => !srcIds.has(r.fcId))
    .map((r) => ({ fcId: r.fcId, name: r.name, from: r.clubId, statusFrom: r.status }))
    .sort((a, b) => a.from - b.from || a.fcId - b.fcId);
}

function buildUpdate(c: Change, reverse: boolean): string {
  // 落库：club_id → NULL + status → 'free'（守卫旧值）；回滚：写回旧值（守卫 NULL + 'free'）
  const sets = reverse
    ? `club_id = ${c.from}, status = ${lit(c.statusFrom)}`
    : `club_id = NULL, status = 'free'`;
  const guard = reverse ? `club_id IS NULL AND status = 'free'` : `club_id IS ${c.from} AND status = ${lit(c.statusFrom)}`;
  return `UPDATE players SET ${sets}, updated_at = '${TS}' WHERE fc_id = ${c.fcId} AND ${guard};`;
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
      `-- S9 队籍收尾 · 遗留球员释放自由身（${reverse ? '回滚' : '落库'}）分片 ${part.no}`,
      `-- 生成器 scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts；生成时点 ${TS}`,
      `-- 覆盖第 ${part.from}-${part.to} 条语句（共 ${changes.length} 条）；未在册判据源 ${SRC_DIR}`,
      '-- 口径：写 players.club_id（→ NULL）+ status（→ \'free\'）+ updated_at，不动能力 / 合同 / 成长字段',
      `-- 守卫：WHERE fc_id = ? AND club_id IS ${reverse ? 'NULL' : '旧值'} AND status ${reverse ? "= 'free'" : '= 旧值'} ⇒ 重复执行 changes = 0`,
      '',
    ].join('\n');
    const body = part.items
      .map((c) => {
        const from = reverse ? `NULL/free` : `${c.from}/${c.statusFrom}`;
        const to = reverse ? `${c.from}/${c.statusFrom}` : 'NULL/free';
        return `-- ${c.fcId} ${c.name} ${from} -> ${to}\n${buildUpdate(c, reverse)}`;
      })
      .join('\n');
    const text = `${head}${body}\n`;
    writeFileSync(join(dir, name), text, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    const sha = createHash('sha256').update(text, 'utf8').digest('hex');
    manifest.push(
      `| ${reverse ? 'rollback/' : 'sql/'}${name} | ${part.from}-${part.to} | ${part.items.length} | ${bytes} | \`${sha}\` |`,
    );
    files++;
  }
  return files;
}

// ---------------------------------------------------------------- 预检 / 验收

function buildPrecheck(): string {
  return [
    '-- S9 队籍收尾 · 执行前复查（只读，全部单行语句）',
    `-- 生成器 scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts；生成时点 ${TS}`,
    '-- 判据：rostered_now = 874（570 联盟世界 + 304 遗留）、null_club = 17427、free_now = 0、守卫表全 0',
    '',
    'SELECT (SELECT COUNT(*) FROM players WHERE club_id IS NOT NULL) AS rostered_now,',
    '       (SELECT COUNT(*) FROM players WHERE club_id IS NULL) AS null_club,',
    "       (SELECT COUNT(*) FROM players WHERE status = 'free') AS free_now;",
    '',
    ...GUARD_TABLES.map((t) => `SELECT COUNT(*) AS ${t} FROM ${t};`),
    '',
    '-- 全库 status 分布（执行后应多出 304 行 free）',
    'SELECT status, COUNT(*) AS n FROM players GROUP BY status ORDER BY status;',
    '',
    '-- 各队现有名单规模（释放后这些队会各自减少对应人数）',
    'SELECT c.id AS club_id, c.name, (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS roster_now',
    '  FROM clubs c ORDER BY c.id;',
    '',
  ].join('\n');
}

function buildVerify(fcIds: number[]): string {
  // 真校验：把 304 个 fc_id 用 json_each 内联（不用长 IN 串，也不受 compound SELECT 500 项限制）
  const json = JSON.stringify(fcIds);
  return [
    '-- S9 队籍收尾 · 执行后验收（只读）',
    `-- 生成器 scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts；生成时点 ${TS}`,
    '-- 判据：want_rows = 304、still_rostered = 0、status_not_free = 0、null_club = 17731、rostered_now = 570、touched = 304',
    '',
    `WITH want AS (SELECT json_extract(value, '$') AS fc_id FROM json_each('${json}')) SELECT (SELECT COUNT(*) FROM want) AS want_rows, (SELECT COUNT(*) FROM want w JOIN players p ON p.fc_id = w.fc_id WHERE p.club_id IS NOT NULL) AS still_rostered, (SELECT COUNT(*) FROM want w JOIN players p ON p.fc_id = w.fc_id WHERE p.status != 'free') AS status_not_free, (SELECT COUNT(*) FROM players WHERE club_id IS NULL) AS null_club, (SELECT COUNT(*) FROM players WHERE club_id IS NOT NULL) AS rostered_now, (SELECT COUNT(*) FROM players WHERE updated_at = '${TS}') AS touched;`,
    '',
    '-- 逐队现有名单规模（释放后应等于 s901 队壳文件行数）',
    'SELECT c.id AS club_id, c.name, c.is_cpu, (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS roster_now',
    '  FROM clubs c ORDER BY c.id;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 报告

/** 报告用：status 分布文本（如 `normal×304`）。 */
function statusMix(rows: RosterRow[]): string {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.status, (by.get(r.status) ?? 0) + 1);
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([s, n]) => `${s || '(空)'}×${n}`)
    .join('、');
}

function buildReport(args: {
  srcIds: Set<number>;
  roster: RosterRow[];
  changes: Change[];
  clubs: Map<number, string>;
  guards: Map<string, number>;
  manifest: string[];
  files: { sql: number; rb: number };
}): string {
  const byClub = new Map<number, number>();
  for (const c of args.changes) byClub.set(c.from, (byClub.get(c.from) ?? 0) + 1);
  const rows = [...byClub.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return [
    '# S9 队籍收尾 · 遗留球员释放自由身 —— 生成报告',
    '',
    `- 生成时点：${TS}`,
    `- 源（未在册判据）：${SRC_DIR}（${args.srcIds.size} 个 fc_id）`,
    `- 生产在册（club_id IS NOT NULL）：${args.roster.length}`,
    `- **待释放（在册 且 不在 s901 名单）：${args.changes.length}**`,
    `- 落库分片：${args.files.sql} 片；回滚分片：${args.files.rb} 片（每片 ${PER_FILE} 条）`,
    '',
    '## 执行前守卫表（须全 0）',
    '',
    '| 表 | 行数 |',
    '| --- | --- |',
    ...[...args.guards.entries()].map(([t, n]) => `| \`${t}\` | ${n} |`),
    '',
    '## 待释放球员现挂队伍分布',
    '',
    '| 队 | id | 待释放 | 释放后名单 |',
    '| --- | --- | --- | --- |',
    ...rows.map(([id, n]) => {
      const now = args.roster.filter((r) => r.clubId === id).length;
      return `| ${args.clubs.get(id) ?? '?'} | ${id} | ${n} | ${now - n} |`;
    }),
    `| **合计** | | **${args.changes.length}** | **570** |`,
    '',
    '## 分片清单（sha256）',
    '',
    '| 文件 | 语句区间 | 条数 | 字节 | sha256 |',
    '| --- | --- | --- | --- | --- |',
    ...args.manifest,
    '',
    '## 说明',
    '',
    '- 口径（用户 2026-09-21 裁定）：`club_id → NULL` + `status → \'free\'`（+ `updated_at`）；能力 / 合同 / 成长字段一行不动。',
    `- 在册 ${args.roster.length} 人 status 分布：${statusMix(args.roster)}；其中待释放的 ${args.changes.length} 人本批全部改为 free。`,
    '- 与合同批（462 行）/ 能力批（570 行）无交集：两批的 fc_id 都属于 570 人集合。',
    '- 生成物不可逐字节复现：旧队籍取自生成时点的生产库，`updated_at` 也是生成时点；重跑只在遗留归零后产出空分片。',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 主流程

const srcIds = readSourceIds(SRC_DIR);
const roster = loadRoster();
const changes = computeChanges(roster, srcIds);

if (VERIFY) {
  console.log(`s901 名单 ${srcIds.size} 人；在册 ${roster.length} 人；遗留 ${changes.length} 人`);
  console.log(`在册 status 分布：${statusMix(roster)}`);
  for (const c of changes.slice(0, 20)) console.log(`  ${c.fcId} ${c.name} 挂在 ${c.from}（status=${c.statusFrom}）`);
  process.exit(changes.length === 0 ? 0 : 4);
}

const clubs = loadClubs();
const guards = tableCounts();
const manifest: string[] = [];
const rb = writeShards(RB_DIR, 'free-leftover-rollback', changes, true, manifest);
const sql = writeShards(OUT_DIR, 'free-leftover-update', changes, false, manifest);
writeFileSync(join(HERE, '01-precheck.sql'), buildPrecheck(), 'utf8');
writeFileSync(join(HERE, '02-verify.sql'), buildVerify(changes.map((c) => c.fcId)), 'utf8');
writeFileSync(
  join(HERE, 'free-leftover-report.md'),
  buildReport({ srcIds, roster, changes, clubs, guards, manifest, files: { sql, rb } }),
  'utf8',
);

const bad = [...guards.entries()].filter(([, n]) => n !== 0);
console.log(
  `s901 名单 ${srcIds.size} 人；在册 ${roster.length} 人；待释放 ${changes.length} 人；` +
    `分片 sql/${sql} 片、rollback/${rb} 片（每片 ${PER_FILE} 条）`,
);
if (bad.length > 0) console.warn(`⚠️ 守卫表非 0：${bad.map(([t, n]) => `${t}=${n}`).join(' / ')}`);
