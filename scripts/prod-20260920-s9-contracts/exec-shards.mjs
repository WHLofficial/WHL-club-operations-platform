// D1 批量执行器（一次性生产 SQL 工件的执行通道）
//
// 为什么需要它：`scripts/README.md` 第 66 行的通道纪律规定「含外键或大事务的工件必须走 --command 或
// D1 REST /query，--file 会让 PRAGMA defer_foreign_keys 失效」。而 `--command` 只吃**单行** SQL
// （多行报 `incomplete input: SQLITE_ERROR [code: 7500]`），所以本脚本把工件里的语句折叠成单行、
// 按 --chunk 分组，一次调用塞多条（D1 支持单行多语句，每条各回一个结果块）。
//
// 用法：
//   node exec-shards.mjs <sql 文件> --remote [--chunk=10] [--dry]
//   node exec-shards.mjs <sql 文件> --local  [--chunk=10] [--dry] [--persist-to=.wrangler/rehearsal]
//
// 安全默认：不带 --remote 就走 --local。--dry 只打印将要执行的语句数与最长命令行长度，不执行。
// --persist-to 只在本地演练时用（把状态写到独立目录，不污染 .wrangler/state）。
// --chunk 默认 10：既受条数约束，也受命令行字节上限约束（见下面的 MAX_BYTES）。
//
// 前提（对工件的约束）：语句以 `;` 结尾、`;` 只出现在语句末尾（字符串字面量里没有分号）、
// 行内 `--` 注释单独成行。这些工件都是生成器产出，满足该约束。

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const remote = argv.includes('--remote');
const local = argv.includes('--local');
const dry = argv.includes('--dry');
const chunkFlag = argv.find((a) => a.startsWith('--chunk='));
const CHUNK = chunkFlag ? Number(chunkFlag.slice('--chunk='.length)) : 10;
const persistFlag = argv.find((a) => a.startsWith('--persist-to='));
const PERSIST = persistFlag ? ` --persist-to "${persistFlag.slice('--persist-to='.length)}"` : ''; // 本地演练用独立状态目录
// 真正的天花板是 cmd.exe 的命令行长度，而且卡的是**字节数**不是字符数（中文 3 字节/字）。
// 实测：约 5.5KB 的批会被 cmd.exe 以「命令行太长」拒绝（同一批有时又通过，怀疑还受环境块/引号
// 展开影响）⇒ 保守取 4000 字节，单批约 9–10 条（本批单条约 400 字节）。
const MAX_BYTES = 4000;
const byteLen = (s) => Buffer.byteLength(s, 'utf8');
const DB = 'whl-club';

if (!file) {
  console.error(`用法：node exec-shards.mjs <sql 文件> --remote|--local [--chunk=10] [--dry] [--persist-to=<dir>]`);
  process.exit(2);
}
if (remote && local) {
  console.error('--remote 与 --local 不能同时给。');
  process.exit(2);
}
const scope = remote ? '--remote' : '--local';

/** 读工件 → 去空行/整行注释 → 折叠成单行语句（末尾 `;` 去掉）。 */
function readStatements(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const out = [];
  let buf = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('--')) continue;
    buf = buf === '' ? line : `${buf} ${line}`;
    if (buf.endsWith(';')) {
      out.push(buf.slice(0, -1).trim());
      buf = '';
    }
  }
  if (buf !== '') throw new Error(`文件末尾有未以 ; 结尾的残留语句：${buf.slice(0, 120)}`);
  return out;
}

const statements = readStatements(file);
if (statements.length === 0) {
  console.error(`没有可执行语句（只有注释/空行？）：${file}`);
  process.exit(2);
}
const worst = Math.max(...statements.map(byteLen));
if (worst > MAX_BYTES) {
  const i = statements.findIndex((s) => byteLen(s) > MAX_BYTES);
  console.error(`第 ${i + 1} 条语句本身就有 ${byteLen(statements[i])} 字节 > ${MAX_BYTES}，无法通过 --command 执行：`);
  console.error(`  ${statements[i].slice(0, 200)}…`);
  process.exit(3);
}

// 分批：既受每批条数（--chunk）约束，也受每批 SQL 总字节数（命令行上限）约束，取先到者。
const batches = [];
let cur = [];
let curLen = 0;
for (const s of statements) {
  if (cur.length > 0 && (cur.length >= CHUNK || curLen + byteLen(s) + 2 > MAX_BYTES)) {
    batches.push(cur);
    cur = [];
    curLen = 0;
  }
  cur.push(s);
  curLen += byteLen(s) + 2;
}
if (cur.length > 0) batches.push(cur);

console.log(`文件：${file}`);
console.log(`语句：${statements.length} 条，单条最长 ${worst} 字节 ⇒ ${batches.length} 批（每批 ≤${CHUNK} 条且 SQL ≤${MAX_BYTES} 字节）`);
console.log(`作用域：${scope === '--remote' ? '生产（--remote）' : '本地（--local）'}${PERSIST ? `，状态目录 ${PERSIST.trim()}` : ''}`);
if (dry) {
  batches.forEach((b, i) => {
    console.log(`  [dry] 批 ${i + 1}：${b.length} 条，命令行 SQL 长度 ${byteLen(b.join('; '))} 字节`);
  });
  process.exit(0);
}

let okStatements = 0;
let failedBatches = 0;
const perBatch = [];
for (let bi = 0; bi < batches.length; bi++) {
  const slice = batches[bi];
  const sql = slice.join('; ');
  const cmd = `npx wrangler d1 execute ${DB} ${scope}${PERSIST} --json --command "${sql}"`;
  const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (res.status !== 0) {
    failedBatches++;
    console.error(`批 ${bi + 1} 失败（exit ${res.status}）：`);
    console.error((res.stderr || res.stdout || '').slice(0, 2000));
    break;
  }
  const at = res.stdout.indexOf('[');
  if (at < 0) {
    failedBatches++;
    console.error(`批 ${bi + 1} 输出不是 JSON：${res.stdout.slice(0, 400)}`);
    break;
  }
  const parsed = JSON.parse(res.stdout.slice(at));
  let changes = 0;
  let rowsWritten = 0;
  let zero = 0;
  for (const b of parsed) {
    const m = b.meta ?? {};
    changes += Number(m.changes ?? 0);
    rowsWritten += Number(m.rows_written ?? 0);
    if (Number(m.changes ?? 0) === 0) zero++;
  }
  okStatements += slice.length;
  perBatch.push({ no: bi + 1, stmts: slice.length, changes, rowsWritten, zero });
  console.log(
    `  批 ${bi + 1}：${slice.length} 条 → changes 合计 ${changes}、rows_written 合计 ${rowsWritten}` +
      `${zero > 0 ? `（其中 ${zero} 条 changes=0）` : ''}`,
  );
}

const totalChanges = perBatch.reduce((n, b) => n + b.changes, 0);
const totalWritten = perBatch.reduce((n, b) => n + b.rowsWritten, 0);
console.log(`合计：已提交 ${okStatements}/${statements.length} 条，changes ${totalChanges}，rows_written ${totalWritten}，失败批 ${failedBatches}`);
if (!remote) {
  console.log('提示：本地（--local）模式下 wrangler 不回传 meta.changes（恒为 0），本地演练请用行数计数判断结果。');
}
process.exit(failedBatches > 0 ? 1 : 0);
