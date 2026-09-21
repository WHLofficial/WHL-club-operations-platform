#!/usr/bin/env node
// 全库姓名字符覆盖扫描（增量 26 随姓名折叠一起进仓库）。
//
// 为什么需要它：src/core/name-fold.ts 的折叠表是「按生产实测清单建的」——表里有什么字，两侧就折什么字；
// 库里冒出一个表外字符时，按对照形搜它搜不到（静默漏搜）。单测只能证明已有语料通过，证不了今天库里的
// 字符集仍与表一致，所以这个前提得有一个能复跑的脚本，而不是一句注释。
//
// 用法：
//   node scripts/scan-name-chars.mjs            # 生产 D1（只读 SELECT，安全）
//   node scripts/scan-name-chars.mjs --local    # 本地 D1（默认读 .wrangler/rehearsal，可用 --persist-to 换）
//
// 退出码：0 = 库里所有非 ASCII 字符都在表内；1 = 有表外字符（该补表了）；2 = 查询没跑成。
import { execSync } from 'node:child_process';
import { describeChars, NAME_FOLD, SQL_FOLD_ENTRY_BUDGET, unmappedNameChars } from '../src/core/name-fold.ts';

const args = process.argv.slice(2);
const local = args.includes('--local');
const persistIdx = args.indexOf('--persist-to');
const persistTo = persistIdx >= 0 ? args[persistIdx + 1] : '.wrangler/rehearsal';

// 逐字符拆解：姓名 → 单字符 → 非 ASCII 的分组计数。`NOT GLOB` 而不是 `GLOB '[^ -~]'`：
// 这条 SQL 要塞进 --command 交给 cmd.exe，脱字符在 Windows 上是转义符。SQL 必须单行，多行会 incomplete input。
// `ch <> ''`：递归到 i = length+1 时会取出一行空串（每名球员一条），不排掉会把种数报多 1
const SQL =
  "WITH RECURSIVE chars(name,i) AS (SELECT name,1 FROM players UNION ALL SELECT name,i+1 FROM chars WHERE i <= length(name)), one AS (SELECT substr(name,i,1) AS ch FROM chars) SELECT ch, COUNT(*) AS n, unicode(ch) AS cp FROM one WHERE ch <> '' AND ch NOT GLOB '[ -~]' GROUP BY ch ORDER BY cp;";

// 走 shell 的一条命令串（Windows 上 npx 是 .cmd，Node 不再允许无 shell 直接 spawn）。
// SQL 用双引号包住、内部只有单引号与 [ ] ~ 这类引号内的字面字符，cmd.exe 不会拆；刻意不用 % 与 ^
const scope = local ? `--local --persist-to ${persistTo}` : '--remote';
const cmdline = `npx wrangler d1 execute whl-club ${scope} --json --command "${SQL}"`;
const exec = () => execSync(cmdline, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

let rows;
try {
  rows = parseRows(exec());
} catch {
  // wrangler 在 Windows 上偶发子进程断言崩溃（exit 3221226505，win/async.c）——与 SQL 无关，重试一次
  try {
    rows = parseRows(exec());
  } catch (err2) {
    console.error(`[scan] 查询没跑成：${(err2.stdout || '').trim() || err2.message}`);
    process.exit(2);
  }
}

function parseRows(stdout) {
  // 只认「行首是 [」的那段：wrangler 的告警行里也可能出现方括号
  const start = stdout.match(/^\[/m);
  if (!start || start.index === undefined) throw new Error(`没解析出 JSON：${stdout.trim().slice(-200)}`);
  const parsed = JSON.parse(stdout.slice(start.index));
  const results = Array.isArray(parsed) ? parsed[0]?.results : null;
  if (!Array.isArray(results)) throw new Error('结果里没有 results 数组');
  return results;
}

const chars = rows.map((r) => String(r.ch));
const unmapped = unmappedNameChars(chars);
const where = local ? `本地（${persistTo}）` : '生产';
console.log(`[scan] ${where}：非 ASCII 字符 ${chars.length} 种 / 折叠表 ${NAME_FOLD.length} 项（预算 ${SQL_FOLD_ENTRY_BUDGET}）`);

if (unmapped.length === 0) {
  console.log('[scan] 结论：库里所有非 ASCII 字符都在折叠表内，按对照形都能搜到');
  process.exit(0);
}

console.log(`[scan] 表外字符 ${unmapped.length} 种：${describeChars(unmapped)}`);
// 补表前先算账：表项数就是 REPLACE 链的嵌套深度，D1 的上限是 100（详见 name-fold.ts 文件头）
console.log(`[scan] 补表后表长 ${NAME_FOLD.length + unmapped.length} 项，预算 ${SQL_FOLD_ENTRY_BUDGET}，补完要跑 node scripts/check-name-fold-depth.mjs`);
console.log('[scan] 这些字现在按对照形搜不到（不是折了一侧，是两侧都原样留下）；补 FOLD_SPEC 后重跑本脚本应变绿');
process.exit(1);
