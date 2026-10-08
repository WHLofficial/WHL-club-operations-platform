// capture-snapshot.mjs —— 只读快照抓取（S9 第 1 窗工资触底订正批）
//
// 把 sql/01-precheck.sql 的每条 SELECT 单独走 `wrangler d1 execute --remote --json --command`，
// 结果按标签 A–G 收进 snapshot.json —— 本批的订正额度（三队旧值 49.23 / 37.62 / 33.37）与
// 「工资行之后无流水」这一前提都取自这份快照，执行前必抓一次存档。
//
// 用法：node capture-snapshot.mjs [--local]
//   --local 抓本地夹具（演练用）；默认 --remote（生产只读）。
// 安全：本脚本只执行 SELECT（文件里没有别的语句），不写任何数据。

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const remote = !process.argv.includes('--local');
const scope = remote ? '--remote' : '--local';
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** 与 exec-shards.mjs 同一套切分：去空行/整行注释，遇行尾 `;` 收一条。 */
function readStatements(path) {
  const out = [];
  let buf = '';
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
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

const statements = readStatements(`${DIR}sql/01-precheck.sql`);
if (statements.length !== LABELS.length) {
  throw new Error(`预检语句数 ${statements.length} 与标签数 ${LABELS.length} 不一致，请同步更新 LABELS`);
}
for (const s of statements) {
  if (!/^SELECT\b/i.test(s)) throw new Error(`预检文件里出现非 SELECT 语句，拒绝执行：${s.slice(0, 120)}`);
}

const snapshot = { capturedAt: new Date().toISOString(), scope, statements: [] };
for (let i = 0; i < statements.length; i++) {
  const cmd = `npx wrangler d1 execute whl-club ${scope} --json --command "${statements[i]}"`;
  const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (res.status !== 0) {
    console.error(`语句 ${LABELS[i]} 失败（exit ${res.status}）：`);
    console.error((res.stderr || res.stdout || '').slice(0, 2000));
    process.exit(1);
  }
  const m = res.stdout.match(/^\[/m);
  if (!m || m.index == null) throw new Error(`语句 ${LABELS[i]} 输出里没有以行首 [ 开始的 JSON`);
  const parsed = JSON.parse(res.stdout.slice(m.index));
  const results = parsed[0]?.results ?? [];
  snapshot.statements.push({ label: LABELS[i], sql: statements[i], rows: results.length, results });
  console.log(`语句 ${LABELS[i]}：${results.length} 行`);
}

writeFileSync(`${DIR}snapshot.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`已写出 ${DIR}snapshot.json（${snapshot.scope}，${snapshot.capturedAt}）`);
