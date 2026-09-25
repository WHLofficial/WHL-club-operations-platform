#!/usr/bin/env node
/**
 * 把 derive.mjs 生成的 SQL 落到 D1（v4.0.0 · 步骤 2）
 *
 *   node scripts/player-names/load.mjs --dry-run           只看语句数与体积，不连库
 *   node scripts/player-names/load.mjs --local             落到本地 D1（wrangler --local）
 *   node scripts/player-names/load.mjs --remote --yes-prod 落到生产（必须显式双开关）
 *   … 再加 --numbers 搬球衣号，--purge 落完把公开缓存版本号 +1（见文末）
 *
 * 设计要点
 *   · 逐条语句执行，走 --command（同步 /query 端点）：生成侧每批 400 行（约 22KB）正好塞进
 *     Windows 命令行。--file 的 import 异步端点实测会对合法 SQL 报假错，已弃用（见 runStatement）。
 *   · 全部语句都是按 fc_id 的 UPDATE，重复执行结果相同（幂等），中断后可整体重跑。
 *     每条失败自动重试 3 次。
 *   · 默认只处理 display_name.sql；加 --numbers 才搬球衣号（number.sql）。
 *   · --purge 是必要的收尾而不是可选项：本脚本直连 D1，不经过 src/worker/index.ts 的
 *     purge 中间件，不 bump 版本号的话公开读最长 24h 才看到新的显示名/球衣号。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const DB = 'whl-club';
// 公开读缓存的版本号（src/lib/guard.ts 的 EPOCH_KV_KEY）；脚本读不到 TS 源码，只能照抄
const EPOCH_KEY = 'cache:epoch:public';
const KV_BINDING = 'SESSION_KV';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const dryRun = flag('--dry-run');
const local = flag('--local');
const remote = flag('--remote');
const yesProd = flag('--yes-prod');
const withNumbers = flag('--numbers');
const purge = flag('--purge');

if (!dryRun && !local && !remote) {
  console.error('用法：--dry-run | --local | --remote --yes-prod（可加 --numbers --purge）');
  process.exit(2);
}
if (remote && !yesProd) {
  console.error('拒绝执行：写生产必须同时给 --remote --yes-prod。');
  process.exit(2);
}

/** 按单引号（'' 转义）切语句，避免人名里的分号把语句切断。 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    buf += ch;
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          buf += sql[++i];
        } else inString = false;
      }
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === ';') {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const files = ['display_name.sql'];
if (withNumbers) files.push('number.sql');

const statements = [];
for (const file of files) {
  const full = path.join(OUT, file);
  if (!fs.existsSync(full)) {
    console.error(`缺少 ${full}，先跑 node scripts/player-names/derive.mjs`);
    process.exit(2);
  }
  const all = splitStatements(fs.readFileSync(full, 'utf8'));
  // D1 拒收 SQL 事务控制语句（本地与远端一样），撞上就先说清楚，别让它变成一条看不懂的 D1 报错
  const txn = all.find((s) => /^\s*(?:--[^\n]*\n\s*)*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(s));
  if (txn) {
    console.error(
      `${file} 里有事务控制语句（${txn.split('\n').pop()?.trim()}）；D1 不接受 BEGIN/COMMIT，请用 derive.mjs 重新生成。`,
    );
    process.exit(2);
  }
  const sized = all.map((s) => ({ sql: s, bytes: Buffer.byteLength(s, 'utf8') }));
  const updates = sized.filter((s) => /\bUPDATE players SET\b/i.test(s.sql)).length;
  console.log(
    `${file}: ${sized.length} 条语句（UPDATE ${updates} 条），最大 ${Math.max(...sized.map((s) => s.bytes))} B`,
  );
  statements.push(...sized);
}

if (dryRun) {
  console.log(
    `共 ${statements.length} 条语句，${statements.reduce((n, s) => n + s.bytes, 0)} B。未连库${purge ? '（--purge 一并跳过）' : ''}。`,
  );
  process.exit(0);
}

// 直接跑 wrangler 的 JS 入口，不经 npx：Node 24 在 Windows 上拒收 spawnSync('npx.cmd')
//（.cmd/.bat 现在必须带 shell，而带 shell 又得自己处理引号），
// node_modules/wrangler/bin/wrangler.js 是 package.json 里登记的 bin 入口，绕开这一整类麻烦。
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(WRANGLER)) {
  console.error(`找不到 wrangler 入口 ${WRANGLER}，先在仓库根目录跑 npm install。`);
  process.exit(2);
}
const mode = local ? '--local' : '--remote';
console.log(`目标：${DB} ${mode}${local ? '（本地，安全）' : '（生产！）'}，共 ${statements.length} 条语句`);

/** 从 wrangler 输出里挑出真正那一行（输出带 ANSI 色码和一堆横幅）。 */
function errorLine(err) {
  const text = `${err.stdout ?? ''}${err.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
  return text.match(/X \[ERROR\]\s*(.+)/)?.[1]?.trim() ?? String(err.message).split('\n')[0];
}

/** 同步睡一会儿，重试之间歇一下。 */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 走 --command（同步 /query 端点），不走 --file：--file 走的是 D1 import 异步端点，实测在同一台库上
// 对完全合法的 SQL 报过一整串假错（{"D1_RESET_DO":true}、「SQL code did not contain a statement」、
// 解析出的 syntax error offset 比文件本身还长）。改用 --command 后仍在 /query 上偶发撞到同一类假错
// （同一条语句隔 30 秒重跑就过，服务端 success:true / rows_written:400），所以保留失败重试。
// 代价是语句要塞进 Windows 命令行（上限约 32KB），所以 derive.mjs 每批只出 400 行，这里再留一道闸门。
const MAX_SQL_CHARS = 30_000;

// wrangler 用 yargs 解析参数：语句头部的 `--` 注释行会被当成命令行选项，报 Unknown arguments。
// 注释对 D1 没有意义（数据行都以 `(` 开头，不会以 `--` 起头），整行删掉最省事。
function cleanForCommand(sql) {
  return `${sql
    .replace(/^[ \t]*--[^\n]*$/gm, '')
    .trim()
    .replace(/;+$/, '')};`;
}

function runStatement(sql, tag) {
  const cleaned = cleanForCommand(sql);
  if (cleaned.length > MAX_SQL_CHARS) {
    console.error(`${tag}（${cleaned.length} 字符）超过命令行上限；调小 derive.mjs 的 BATCH 重新生成。`);
    process.exit(2);
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', DB, mode, '--command', cleaned], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      return attempt;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        console.error(`  ${tag} 第 ${attempt} 次失败（${errorLine(err)}），重试`);
        sleep(2000);
      }
    }
  }
  throw lastErr;
}

let done = 0;
let retried = 0;
for (const s of statements) {
  const attempts = runStatement(`${s.sql};`, `语句 ${done + 1}`);
  if (attempts > 1) retried++;
  done++;
  if (done % 5 === 0 || done === statements.length) console.log(`  已执行 ${done}/${statements.length}`);
}
console.log(`完成 ${done}/${statements.length}${retried ? `（其中 ${retried} 条重试过）` : ''}`);

// ---------------------------------------------------------------- 公开读缓存失效
//
// 版本号进缓存键（guard.ts 的 `${scope}:v${epoch}:${key}`），bump 一次 L1 + L2 同时作废。
// 读现值再写 +1（而不是本地 +1）：键不存在等价于 0（guard.ts getCacheEpoch 的 Number(raw) || 0）。
function bumpCacheEpoch() {
  const wrun = (args) =>
    execFileSync(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    });
  let current = 0;
  try {
    current = Number(wrun(['kv', 'key', 'get', EPOCH_KEY, '--binding', KV_BINDING, mode]).trim()) || 0;
  } catch (err) {
    // 键不存在时 wrangler 报 API 404 而不是返回空值
    const detail = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`;
    if (!/404|not found/i.test(detail)) throw err;
  }
  const next = current + 1;
  wrun(['kv', 'key', 'put', EPOCH_KEY, String(next), '--binding', KV_BINDING, mode]);
  console.log(`公开缓存版本号 ${current} → ${next}（L1 + L2 一次作废）`);
}

if (purge) bumpCacheEpoch();
