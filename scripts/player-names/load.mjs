#!/usr/bin/env node
/**
 * 把 derive.mjs 生成的 SQL 落到 D1（增量 32 · 步骤 2）
 *
 *   node scripts/player-names/load.mjs --dry-run           只看语句数与体积，不连库
 *   node scripts/player-names/load.mjs --local             落到本地 D1（wrangler --local）
 *   node scripts/player-names/load.mjs --remote --yes-prod 落到生产（必须显式双开关）
 *
 * 设计要点
 *   · 逐条语句执行：生成文件里每条语句都在 1000 行以内，Windows 命令行放不下 50KB 的
 *     --command，所以每条语句写一个临时文件走 --file，跑完删掉。
 *   · 全部语句都是按 fc_id 的 UPDATE，重复执行结果相同（幂等），中断后可整体重跑。
 *   · 默认只处理 display_name.sql；加 --numbers 才搬球衣号（number.sql）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DB = 'whl-club';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const dryRun = flag('--dry-run');
const local = flag('--local');
const remote = flag('--remote');
const yesProd = flag('--yes-prod');
const withNumbers = flag('--numbers');

if (!dryRun && !local && !remote) {
  console.error('用法：--dry-run | --local | --remote --yes-prod（可加 --numbers）');
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
  console.log(`共 ${statements.length} 条语句，${statements.reduce((n, s) => n + s.bytes, 0)} B。未连库。`);
  process.exit(0);
}

// 直接跑 wrangler 的 JS 入口，不经 npx：Node 24 在 Windows 上拒收 spawnSync('npx.cmd')
//（.cmd/.bat 现在必须带 shell，而带 shell 又得自己处理引号），
// node_modules/wrangler/bin/wrangler.js 是 package.json 里登记的 bin 入口，绕开这一整类麻烦。
const WRANGLER = path.join(HERE, '..', '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(WRANGLER)) {
  console.error(`找不到 wrangler 入口 ${WRANGLER}，先在仓库根目录跑 npm install。`);
  process.exit(2);
}
const mode = local ? '--local' : '--remote';
console.log(`目标：${DB} ${mode}${local ? '（本地，安全）' : '（生产！）'}，共 ${statements.length} 条语句`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whl-name-load-'));
let done = 0;
try {
  for (const s of statements) {
    const file = path.join(tmp, `s${done}.sql`);
    fs.writeFileSync(file, `${s.sql};\n`, 'utf8');
    execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', DB, mode, '--file', file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    done++;
    if (done % 5 === 0 || done === statements.length) console.log(`  已执行 ${done}/${statements.length}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`完成 ${done}/${statements.length}`);
