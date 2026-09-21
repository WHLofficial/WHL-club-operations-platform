// 折叠链的**真引擎**深度体检（增量 26 步骤 1）。
//
// 为什么需要这个脚本：SQL 侧折叠是线性嵌套的 REPLACE 链，嵌套深度 = 表项数，而 D1 的表达式树深度
// 上限是 100（实测 96 项通过、100 项起报 `D1_ERROR: Expression tree is too large (maximum depth
// 100)`）。node:sqlite 的上限是 1000，本地单测**测不出**这条线 —— 曾经 253 项的表在单测里全绿、
// 到真引擎上姓名搜索直接 500。所以每次改 src/core/name-fold.ts 的表，都跑一次这个脚本。
//
// 用法：
//   node scripts/check-name-fold-depth.mjs            # 本地 D1（.wrangler/rehearsal，需先有库）
//   node scripts/check-name-fold-depth.mjs --remote   # 生产 D1（只读 SELECT，安全）
//
// 退出码：0 通过；1 撞深度上限；2 其它失败；3 表项超出预算。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAME_FOLD, SQL_FOLD_DEPTH_LIMIT, SQL_FOLD_ENTRY_BUDGET, sqlFold } from '../src/core/name-fold.ts';

const remote = process.argv.includes('--remote');

function run(sql) {
  const file = join(mkdtempSync(join(tmpdir(), 'name-fold-depth-')), 'probe.sql');
  writeFileSync(file, `${sql}\n`);
  const args = ['wrangler', 'd1', 'execute', 'whl-club', remote ? '--remote' : '--local'];
  if (!remote) args.push('--persist-to', '.wrangler/rehearsal');
  args.push('--file', file);
  try {
    const out = execFileSync('npx', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.toString() };
  }
}

const entries = NAME_FOLD.length;
console.log(`[depth] 折叠表 ${entries} 项 / 预算 ${SQL_FOLD_ENTRY_BUDGET}（D1 上限 ${SQL_FOLD_DEPTH_LIMIT}，链外约 4 层）`);
if (entries > SQL_FOLD_ENTRY_BUDGET) {
  console.error(`[depth] 表项 ${entries} 超出预算 ${SQL_FOLD_ENTRY_BUDGET}：请裁表，或改走物化列 name_folded（迁移 + 回填）`);
  process.exit(3);
}

// 两条真实用法的形状：① 姓名搜索的 WHERE ② 表头点姓名列的 ORDER BY（sort_key 与 ORDER BY 各一次）
const where = run(`SELECT COUNT(*) AS n FROM players WHERE ${sqlFold('players.name')} LIKE '%sesko%';`);
if (!where.ok) {
  const tooLarge = /too large/.test(where.out);
  console.error(`[depth] WHERE 折叠失败${tooLarge ? '（撞深度上限）' : ''}：\n${where.out.trim().split('\n').slice(-6).join('\n')}`);
  process.exit(tooLarge ? 1 : 2);
}
console.log('[depth] WHERE 折叠：真引擎通过');

const orderBy = run(
  `SELECT players.name, ${sqlFold('players.name')} AS sort_key FROM players ORDER BY ${sqlFold('players.name')} ASC, players.id ASC LIMIT 3;`,
);
if (!orderBy.ok) {
  const tooLarge = /too large/.test(orderBy.out);
  console.error(`[depth] ORDER BY 折叠失败${tooLarge ? '（撞深度上限）' : ''}：\n${orderBy.out.trim().split('\n').slice(-6).join('\n')}`);
  process.exit(tooLarge ? 1 : 2);
}
console.log('[depth] ORDER BY 折叠：真引擎通过');

// ③ 最重的一条：文本键翻页的游标条件，折叠表达式在一次查询里出现三次
//    （实际路由用绑定参数，这里换成同形的字面量——wrangler d1 execute 不做参数绑定）
const folded = sqlFold('players.name');
const cursor = run(
  `SELECT players.id FROM players WHERE (${folded} < 'sesko' OR (${folded} = 'sesko' AND players.id < 5)) ORDER BY ${folded} ASC, players.id ASC LIMIT 3;`,
);
if (!cursor.ok) {
  const tooLarge = /too large/.test(cursor.out);
  console.error(`[depth] 游标条件折叠失败${tooLarge ? '（撞深度上限）' : ''}：\n${cursor.out.trim().split('\n').slice(-6).join('\n')}`);
  process.exit(tooLarge ? 1 : 2);
}
console.log('[depth] 游标条件折叠（表达式 ×3）：真引擎通过');

console.log(`[depth] 结论：${remote ? '生产' : '本地'} D1 接受当前折叠链`);
