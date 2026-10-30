// S9 属性回写批（v6.61.0 任务 1）：把 S9 人工订正过的 34 项属性键改回 FC26db 初始值。
//
// 缘起：S9（scripts/prod-20260920-s9-abilities）按「CA 涨多少属性涨多少」手工写入了 game_attrs 的
// 34 项属性。v6.61.0 起「显示属性 = 初始属性 + delta(ca − base_ca)」由代码统一加成 —— S9 写进库的
// 那批值若不回退，这 254 人会变成「S9 值 + delta」双份。本批把 2,336 个键改回 FC26db 原值，
// 让 game_attrs 恢复「官方初始存档」语义；S9 的 CA 涨幅保留，作为成长由 delta 重新加成。
//
// 数据源（handoff §3 已核实，不要重复调查）：
//   - 初始属性：E:/Downloads/FC26db20251217_fixed.xlsx 的 Base sheet（平台 v0.2.0 的导入源，
//     CA/PA 与 S9 写入前 253/253 全中），ID 列对 players.fc_id。
//   - 「S9 改过哪些键、改成什么」：scripts/prod-20260920-s9-abilities/sql/abilities-update-0{1,2}.sql。
//
// SQL 形态（每个键一个 json_set，WHERE 用 S9 写入值做双重守卫）：
//   UPDATE players SET game_attrs = json_set(game_attrs, '$.k', 原值, ...), updated_at = '...'
//   WHERE fc_id = ? AND json_extract(game_attrs, '$.k') = S9写入值 AND ...;
// 守卫不匹配 ⇒ 该条不生效（changes = 0）⇒ 说明这个键后来被动过，必须人工看。
//
// 用法（本脚本只读生产，绝不写库 —— 写库在用户确认后手动逐片 `wrangler d1 execute --file`）：
//   node gen-rewind-sql.ts                       生成分片 + rewind-report.md（本地，不碰库）
//   node gen-rewind-sql.ts --precheck [--local]  只读预检：库内现值 == S9 写入值，差异必须 0（有差异退 4）
//   node gen-rewind-sql.ts --verify  [--local]   写后验收：34 项 == FC26db 差异 0 + 抽 5 人全键肉眼表
//   --ts=<ISO>                                   覆盖 updated_at / 报告时点（默认生成时刻）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import XLSX from 'xlsx';
import { ATTR_KEYS } from '../../src/core/growth-attrs.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const SQL_DIR = join(HERE, 'sql');
const XLSX_PATH = 'E:/Downloads/FC26db20251217_fixed.xlsx';
const S9_SQL_FILES = [
  'scripts/prod-20260920-s9-abilities/sql/abilities-update-01.sql',
  'scripts/prod-20260920-s9-abilities/sql/abilities-update-02.sql',
];
const DB = 'whl-club';
/** 每片最多 50 人（handoff §4 任务 1 执行口径）；单文件再设 64KB 上限防 --file 超长。 */
const SHARD_MAX_PLAYERS = 50;
const SHARD_MAX_BYTES = 64 * 1024;

const argv = process.argv.slice(2);
const MODE = argv.includes('--precheck') ? 'precheck' : argv.includes('--verify') ? 'verify' : 'gen';
const LOCAL = argv.includes('--local');
const TS = (argv.find((a) => a.startsWith('--ts=')) ?? `--ts=${new Date().toISOString()}`).slice(5);
const ATTR_SET = new Set(ATTR_KEYS);

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------- 数据模型

/** S9 语句解析结果：fc_id → 该语句写入的 34 项键值（同一人只允许出现一条带键语句）。 */
type S9Writes = Map<number, Map<string, number>>;

function parseS9(): S9Writes {
  const out: S9Writes = new Map();
  const skipped: string[] = []; // 34 项白名单之外被跳过的键（PSID/RoleID 属 S9 Case B 预期内，其余要人工看）
  let stmts = 0;
  for (const rel of S9_SQL_FILES) {
    const txt = readFileSync(join(ROOT, rel), 'utf8');
    for (const st of txt.split(/;\s*\n/)) {
      if (!st.includes('UPDATE players')) continue;
      stmts++;
      const idm = st.match(/WHERE fc_id = (\d+)/);
      if (!idm) fail(`S9 语句缺 WHERE fc_id 守卫：${st.slice(0, 120)}…`);
      const id = Number(idm![1]);
      const writes = new Map<string, number>();
      for (const m of st.matchAll(/\$\.(\w+)',\s*(-?\d+|null)/g)) {
        const key = m[1];
        if (!ATTR_SET.has(key)) {
          // S9 的 Case B 口径只改 34 项 + RoleID1-5 + PSID1-15；其余键出现在 json_set 里说明白名单漂移
          if (!/^(PSID|RoleID)\d+$/.test(key)) skipped.push(`${id}.${key}`);
          continue;
        }
        const v = m[2] === 'null' ? null : Number(m[2]);
        if (v === null) fail(`S9 把 ${id}.${key} 写成了 null —— 回写守卫写不出「非空原值」形态，先人工看`);
        writes.set(key, v as number);
      }
      if (writes.size === 0) continue; // 纯 CA/PA 语句（3 条）不产生回写键
      const prev = out.get(id);
      if (prev) fail(`fc_id ${id} 在 S9 分片里出现两条带键语句，逐键合并语义未定义，先人工看`);
      out.set(id, writes);
    }
  }
  if (skipped.length > 0) {
    console.error(`✗ S9 里有 ${skipped.length} 个非白名单键被跳过（本批不回写它们，请人工确认是否该扩白名单）：`);
    for (const s of [...new Set(skipped)].slice(0, 40)) console.error(`  - ${s}`);
    if (skipped.length > 40) console.error(`  …（另有 ${skipped.length - 40} 处）`);
  }
  console.log(`S9 语句 ${stmts} 条 → ${out.size} 人带 34 项键写入`);
  return out;
}

/** FC26db Base sheet：fc_id → 行（34 项键 + Name）。 */
function loadFc26db(): Map<number, Record<string, unknown>> {
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets['Base'];
  if (!ws) fail(`xlsx 里没有 Base sheet：${XLSX_PATH}`);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[];
  const byId = new Map<number, Record<string, unknown>>();
  for (const r of rows) {
    const id = Number(r['ID']);
    if (Number.isFinite(id)) byId.set(id, r);
  }
  console.log(`FC26db Base ${rows.length} 行（${XLSX_PATH}）`);
  return byId;
}

type Plan = {
  fcId: number;
  name: string;
  /** key → { s9: S9 写入值（守卫），orig: FC26db 原值（回写目标） } */
  keys: Map<string, { s9: number; orig: number }>;
};

function buildPlan(s9: S9Writes, db: Map<number, Record<string, unknown>>): Plan[] {
  const plans: Plan[] = [];
  const anomalies: string[] = [];
  for (const [fcId, writes] of [...s9.entries()].sort((a, b) => a[0] - b[0])) {
    const row = db.get(fcId);
    if (!row) {
      anomalies.push(`fc_id ${fcId}：FC26db 查无此人`);
      continue;
    }
    const keys = new Map<string, { s9: number; orig: number }>();
    for (const [key, s9v] of [...writes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const raw = row[key];
      const orig = raw == null ? Number.NaN : Number(raw);
      if (!Number.isFinite(orig)) {
        anomalies.push(`fc_id ${fcId} ${key}：FC26db 原值非数值（${String(raw)}）`);
        continue;
      }
      keys.set(key, { s9: s9v, orig });
    }
    if (keys.size > 0) plans.push({ fcId, name: String(row['Name'] ?? ''), keys });
  }
  if (anomalies.length > 0) {
    console.error(`\n数据异常 ${anomalies.length} 处（本批不生成，先人工看）：`);
    for (const a of anomalies) console.error(`  - ${a}`);
    process.exit(4);
  }
  return plans;
}

// ---------------------------------------------------------------- 生产库（只读）

const WRANGLER_JS = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function d1Rows(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  const args = [WRANGLER_JS, 'd1', 'execute', DB, scope, '--json', '--command', sql];
  let lastErr = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = res.stdout ?? '';
    const at = out.indexOf('[');
    if (at >= 0) {
      try {
        const parsed = JSON.parse(out.slice(at)) as Array<{ results?: Record<string, unknown>[] }>;
        if (parsed[0]?.results) return parsed[0].results;
        lastErr = `返回里没有 results：${out.slice(0, 300)}`;
      } catch (e) {
        lastErr = `JSON 解析失败：${(e as Error).message}`;
      }
    } else {
      lastErr = `不是 JSON（exit ${res.status}）：${(res.stderr || out)
        .replace(/\u001b\[[0-9;]*m/g, '')
        .trim()
        .slice(0, 300)}`;
    }
    if (attempt < 5) {
      console.error(`  [重试 ${attempt}/5] ${lastErr.split('\n')[0]}`);
      sleep(3000);
    }
  }
  throw new Error(`wrangler 读取失败（试了 5 次）：\n${lastErr}`);
}

/** fc_id → game_attrs 解析对象（缺行不在表里）。 */
function fetchGameAttrs(fcIds: number[]): Map<number, Record<string, unknown>> {
  const out = new Map<number, Record<string, unknown>>();
  const CHUNK = 90;
  for (let i = 0; i < fcIds.length; i += CHUNK) {
    const slice = fcIds.slice(i, i + CHUNK);
    const rows = d1Rows(`SELECT fc_id, game_attrs FROM players WHERE fc_id IN (${slice.join(',')})`);
    for (const r of rows) {
      const id = Number(r['fc_id']);
      const raw = r['game_attrs'];
      if (typeof raw !== 'string' || raw === '') continue;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') out.set(id, parsed as Record<string, unknown>);
      } catch {
        // 坏 JSON 行保持缺席 ⇒ 预检按「缺行」报出
      }
    }
  }
  return out;
}

function numOrNaN(v: unknown): number {
  if (v == null || v === '') return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

// ---------------------------------------------------------------- gen：生成分片 + 报告

function shardStatements(plan: Plan): string {
  const sets = [...plan.keys.entries()]
    .map(([k, v]) => `'$.${k}', ${v.orig}`)
    .join(', ');
  const guards = [...plan.keys.entries()]
    .map(([k, v]) => ` AND json_extract(game_attrs, '$.${k}') = ${v.s9}`)
    .join('');
  return `UPDATE players SET game_attrs = json_set(game_attrs, ${sets}), updated_at = '${TS}' WHERE fc_id = ${plan.fcId}${guards};`;
}

function runGen(plans: Plan[]): void {
  const header = (no: number, from: number, to: number) =>
    [
      `-- S9 属性回写（FC26db 原值）分片 ${String(no).padStart(2, '0')}`,
      `-- 生成器 scripts/prod-20261025-s9-attr-rewind/gen-rewind-sql.ts；生成时点 ${TS}`,
      `-- 覆盖第 ${from}-${to} 人（共 ${plans.length} 人）；源 ${XLSX_PATH} Base sheet`,
      `-- 守卫：WHERE fc_id = ? AND 每键 json_extract = S9 写入值 ⇒ 重复执行 / 键后被动过时 changes = 0`,
      `-- 口径：只回写 34 项属性键为 FC26db 原值；ca / pa / base_ca / 其余 game_attrs 键一律不动`,
      '',
    ].join('\n');

  mkdirSync(SQL_DIR, { recursive: true });
  const shards: { file: string; players: number; keys: number; bytes: number; sha256: string }[] = [];
  let no = 1;
  for (let i = 0; i < plans.length; ) {
    const lines: string[] = [];
    let players = 0;
    let keys = 0;
    let start = i + 1;
    while (i < plans.length && players < SHARD_MAX_PLAYERS) {
      const stmt = shardStatements(plans[i]!);
      const next = [...lines, `-- ${plans[i]!.fcId} ${plans[i]!.name}`, stmt, ''].join('\n');
      if (next.length > SHARD_MAX_BYTES && players > 0) break;
      lines.push(`-- ${plans[i]!.fcId} ${plans[i]!.name}`, stmt, '');
      keys += plans[i]!.keys.size;
      players++;
      i++;
    }
    const file = `sql/${String(no).padStart(2, '0')}-rewind.sql`;
    const body = header(no, start, i) + lines.join('\n');
    writeFileSync(join(HERE, file), body);
    shards.push({
      file,
      players,
      keys,
      bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
    });
    no++;
  }

  // 报告
  const dist = new Map<number, number>();
  let totalKeys = 0;
  const diffDist = new Map<number, number>();
  for (const p of plans) {
    dist.set(p.keys.size, (dist.get(p.keys.size) ?? 0) + 1);
    totalKeys += p.keys.size;
    for (const { s9, orig } of p.keys.values()) {
      const d = s9 - orig;
      diffDist.set(d, (diffDist.get(d) ?? 0) + 1);
    }
  }
  const L: string[] = [];
  L.push('# S9 属性回写批 · 生成报告', '');
  L.push(`- 生成时点：${TS}`);
  L.push(`- 源（初始属性）：${XLSX_PATH} 的 Base sheet（ID 列对 fc_id）`);
  L.push(`- 源（S9 写入值）：${S9_SQL_FILES.join(' + ')}（解析自 UPDATE 语句的 json_set）`);
  L.push(`- 覆盖：${plans.length} 人 / ${totalKeys} 个 34 项属性键（守卫键数相同）`);
  L.push(`- 分片：${shards.length} 片（每片 ≤ ${SHARD_MAX_PLAYERS} 人），落 ${SQL_DIR}（.gitignore 忽略，可由本生成器逐字复现）`);
  L.push(`- updated_at：${TS}`);
  L.push('');
  L.push('## 1 S9 写入值 − FC26db 原值 分布（handoff §3 实测口径，应全为正）', '');
  for (const [d, c] of [...diffDist.entries()].sort((a, b) => a[0] - b[0])) L.push(`- ${d > 0 ? '+' : ''}${d}: ${c}`);
  L.push('');
  L.push('## 2 分片清单', '', '| 分片 | 人数 | 键数 | 字节 | sha256 |', '|---|---|---|---|---|');
  for (const s of shards) L.push(`| ${s.file} | ${s.players} | ${s.keys} | ${s.bytes} | ${s.sha256.slice(0, 16)}… |`);
  L.push('');
  L.push('## 3 每人键数分布', '');
  L.push([...dist.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}键×${c}人`).join('、'));
  L.push('');
  L.push('## 4 逐人逐键比对（FC26db 原值 ← S9 写入值）', '', '| fc_id | 姓名 | 键 | FC26db 原值 | S9 写入值 | 差(S9−原) |', '|---|---|---|---|---|---|');
  for (const p of plans) {
    for (const [k, v] of p.keys) {
      L.push(`| ${p.fcId} | ${p.name} | ${k} | ${v.orig} | ${v.s9} | ${v.s9 - v.orig > 0 ? '+' : ''}${v.s9 - v.orig} |`);
    }
  }
  L.push('');
  L.push('## 5 执行与验收（等用户确认后）', '');
  L.push('1. `node gen-rewind-sql.ts --precheck` —— 只读预检，期望「差异 0」；有差异 = 键后来被动过，先人工看。');
  L.push('2. 逐片 `npx wrangler d1 execute whl-club --remote --file sql/NN-rewind.sql -y`，每片前后各跑一次预检（后一次应只剩「已回写键」的守卫不匹配 = 预期）。');
  L.push('3. `node gen-rewind-sql.ts --verify` —— 期望「差异 0」+ 抽 5 人全键表。');
  L.push('4. 回写直写 D1 不经 HTTP 写路径 ⇒ 手动 bump 公开缓存代际键 `cache:epoch:public`（SESSION_KV）。');
  L.push('5. 回滚：S9 的 `abilities-update-0{1,2}.sql` 原样重放（守卫是写入前旧 CA/PA，重放 changes=0 的风险见 S9 README）；**S9 的 rollback/abilities-rollback-0*.sql 在回写后作废**（那是把键置 NULL，不是恢复原值）。');
  writeFileSync(join(HERE, 'rewind-report.md'), L.join('\n') + '\n');

  console.log(`\n分片 ${shards.length} 片 / ${plans.length} 人 / ${totalKeys} 键 → ${SQL_DIR}`);
  console.log(`报告：${join(HERE, 'rewind-report.md')}`);
}

// ---------------------------------------------------------------- precheck：库内现值 == S9 写入值？

function runPrecheck(plans: Plan[]): number {
  console.log(`只读预检（${LOCAL ? '本地' : '生产'}）：库内现值应逐键等于 S9 写入值（= 守卫能命中）…`);
  const attrs = fetchGameAttrs(plans.map((p) => p.fcId));
  const missing: string[] = [];
  const mismatches: { fcId: number; key: string; s9: number; actual: unknown }[] = [];
  let checked = 0;
  for (const p of plans) {
    const a = attrs.get(p.fcId);
    if (!a) {
      missing.push(String(p.fcId));
      continue;
    }
    for (const [k, v] of p.keys) {
      checked++;
      // 严格 typeof：SQL 守卫是 `json_extract(...) = <整数字面量>`，TEXT '83' 与 INTEGER 83 不相等
      // ⇒ 守卫不命中 changes=0。预检口径必须与守卫一致（ Number 宽口径会漏报这种「预检过、写不动」）
      const cur = a[k];
      if (typeof cur !== 'number' || cur !== v.s9) mismatches.push({ fcId: p.fcId, key: k, s9: v.s9, actual: cur });
    }
  }
  const L: string[] = [];
  L.push('# S9 属性回写批 · 只读预检', '');
  L.push(`- 时点：${new Date().toISOString()}（${LOCAL ? '本地 D1' : '生产 D1'}）`);
  L.push(`- 范围：${plans.length} 人 / ${checked} 个守卫键`);
  L.push(`- players 缺行：${missing.length === 0 ? '0' : missing.join(', ')}`);
  L.push(`- 守卫键不匹配：**${mismatches.length}**${mismatches.length === 0 ? '（可执行）' : '（先人工看，禁止直接写）'}`);
  L.push('');
  if (mismatches.length > 0) {
    L.push('## 不匹配明细（库内现值 ≠ S9 写入值）', '', '| fc_id | 键 | S9 写入值(守卫) | 库内现值 |', '|---|---|---|---|');
    for (const m of mismatches.slice(0, 500)) {
      L.push(`| ${m.fcId} | ${m.key} | ${m.s9} | ${String(m.actual)} |`);
    }
    if (mismatches.length > 500) L.push(`\n（另有 ${mismatches.length - 500} 处未列）`);
    L.push('');
  }
  writeFileSync(join(HERE, 'precheck-report.md'), L.join('\n') + '\n');
  console.log(L.slice(0, 8).join('\n'));
  console.log(`报告：${join(HERE, 'precheck-report.md')}`);
  return mismatches.length === 0 && missing.length === 0 ? 0 : 4;
}

// ---------------------------------------------------------------- verify：回写后 34 项 == FC26db

function runVerify(plans: Plan[]): number {
  console.log(`只读验收（${LOCAL ? '本地' : '生产'}）：回写后的 34 项应逐键等于 FC26db 原值…`);
  const attrs = fetchGameAttrs(plans.map((p) => p.fcId));
  const mismatches: { fcId: number; key: string; want: number; actual: unknown }[] = [];
  let checked = 0;
  for (const p of plans) {
    const a = attrs.get(p.fcId);
    if (!a) {
      mismatches.push({ fcId: p.fcId, key: '(整行)', want: Number.NaN, actual: 'players 缺行' });
      continue;
    }
    for (const [k, v] of p.keys) {
      checked++;
      // 严格 typeof（同预检口径）：回写后应是与 FC26db 一致的 JSON number
      const cur = a[k];
      if (typeof cur !== 'number' || cur !== v.orig) mismatches.push({ fcId: p.fcId, key: k, want: v.orig, actual: cur });
    }
  }
  // 抽 5 人（首 / 尾 + 中间 3 人）打全 34 项键对照表，供肉眼核对
  const samples = [0, Math.floor(plans.length * 0.25), Math.floor(plans.length * 0.5), Math.floor(plans.length * 0.75), plans.length - 1]
    .map((i) => plans[i]!)
    .filter((p, i, arr) => arr.findIndex((q) => q.fcId === p.fcId) === i);
  const L: string[] = [];
  L.push('# S9 属性回写批 · 写后验收', '');
  L.push(`- 时点：${new Date().toISOString()}（${LOCAL ? '本地 D1' : '生产 D1'}）`);
  L.push(`- 范围：${plans.length} 人 / ${checked} 个回写键`);
  L.push(`- 与 FC26db 差异：**${mismatches.length}**${mismatches.length === 0 ? '（通过）' : '（不通过）'}`);
  L.push('');
  if (mismatches.length > 0) {
    L.push('## 差异明细（前 200）', '', '| fc_id | 键 | 期望(FC26db) | 库内现值 |', '|---|---|---|---|');
    for (const m of mismatches.slice(0, 200)) L.push(`| ${m.fcId} | ${m.key} | ${m.want} | ${String(m.actual)} |`);
    L.push('');
  }
  for (const p of samples) {
    const a = attrs.get(p.fcId) ?? {};
    L.push(`## 抽样 fc_id ${p.fcId}（${p.name}）34 项全键`, '', '| 键 | FC26db | 库内 | 判定 |', '|---|---|---|---|');
    for (const k of ATTR_KEYS) {
      const want = p.keys.get(k)?.orig ?? numOrNaN(a[k]);
      const got = numOrNaN(a[k]);
      L.push(`| ${k} | ${Number.isFinite(want) ? want : '—'} | ${Number.isFinite(got) ? got : '—'} | ${got === want ? '✓' : '✗'} |`);
    }
    L.push('');
  }
  writeFileSync(join(HERE, 'verify-report.md'), L.join('\n') + '\n');
  console.log(L.slice(0, 8).join('\n'));
  console.log(`报告：${join(HERE, 'verify-report.md')}`);
  return mismatches.length === 0 ? 0 : 4;
}

// ---------------------------------------------------------------- main

if (!existsSync(XLSX_PATH)) fail(`找不到 FC26db 源文件：${XLSX_PATH}`);
const s9 = parseS9();
const db = loadFc26db();
const plans = buildPlan(s9, db);
if (MODE === 'precheck') process.exit(runPrecheck(plans));
if (MODE === 'verify') process.exit(runVerify(plans));
runGen(plans);
