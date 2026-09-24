// 排序索引形态体检（真引擎）：把候选排序表达式逐条在**本地 D1**（miniflare，与线上同一个 SQLite 构建）上
// 试建索引，建得出来就立刻 DROP。目的是在写迁移之前先拿到硬结论：哪些表达式引擎接受、哪些直接报错。
//
// 为什么不能只靠 node:sqlite：node:sqlite 的表达式树深度上限是 1000，D1 是 100
// （见 scripts/check-name-fold-depth.mjs 的教训：253 项的表在单测里全绿、到真引擎上直接 500）。
// 「索引表达式禁止 `.` 限定符」「函数是否确定性（json_extract 能否进索引）」这类限制也以真引擎为准。
//
// 每建一批新索引之前跑一次，候选清单从 src/worker/routes/players.ts 的 buildSortExprs 抄过来
// （去掉 players. 限定符）。零配额：--local 只写 .wrangler/rehearsal，不碰生产。
//
// 用法：node scripts/check-sort-index-feasibility.mjs
// 退出码：0 全部通过；1 有表达式被引擎拒；2 其它失败。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 与 src/worker/routes/players.ts 的 PS_COUNT_EXPR 同源（15 槽；索引侧必须写非限定列名）
const PS = `(${Array.from(
  { length: 15 },
  (_, i) => `(json_extract(game_attrs, '$.PSID${i + 1}') IS NOT NULL)`,
).join(' + ')})`;

// 与 players.ts 的 POSITION_SORT_CASE 同源（去掉 players. 限定符）
const POSITION_CASE = `CASE position
  WHEN 'GK' THEN 1
  WHEN 'RB' THEN 2 WHEN 'CB' THEN 2 WHEN 'LB' THEN 2
  WHEN 'CDM' THEN 3 WHEN 'RM' THEN 3 WHEN 'CM' THEN 3 WHEN 'LM' THEN 3 WHEN 'CAM' THEN 3
  WHEN 'RW' THEN 4 WHEN 'ST' THEN 4 WHEN 'LW' THEN 4
  ELSE 0 END`;

// 2026-09-24 体检（迁移 0034 的依据）：buildSortExprs 里当时还没有索引的 15 个形态
const CANDIDATES = [
  ['base_ca', 'COALESCE(base_ca, 0)'],
  ['badges', '(COALESCE(badges_silver, 0) + COALESCE(badges_gold, 0))'],
  ['growth_gap', '(COALESCE(pa, 0) - COALESCE(ca, 0))'],
  ['uid', 'COALESCE(CAST(SUBSTR(uid, 3) AS INTEGER), 0)'],
  ['position', POSITION_CASE],
  ['growable', 'COALESCE(growable, 0)'],
  ['foot', 'COALESCE(foot, 0)'],
  ['growth_tier', 'COALESCE(growth_tier, 0)'],
  ['future_star', 'COALESCE(is_future_star, 0)'],
  ['china_plan', 'COALESCE(china_plan, 0)'],
  ['agent_tier', 'COALESCE(agent_tier, 0)'],
  ['fc_id', 'COALESCE(fc_id, 0)'],
  ['ps', PS],
  ['view-initial-ca', 'COALESCE(COALESCE(base_ca, ca), 0)'],
  ['attr-sample', "COALESCE(json_extract(game_attrs, '$.sprintspeed') + 0, 0)"],
];

function run(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'sort-index-probe-'));
  const file = join(dir, 'probe.sql');
  writeFileSync(file, `${sql}\n`);
  try {
    const out = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'whl-club', '--local', '--persist-to', '.wrangler/rehearsal', '--file', file],
      { shell: true, stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString();
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.toString() };
  }
}

console.log(`[probe] ${CANDIDATES.length} 个候选表达式，逐条在真引擎上试建 + 立刻 DROP`);
const results = [];
for (const [key, expr] of CANDIDATES) {
  const name = `probe_${key.replace(/-/g, '_')}`;
  const create = run(`CREATE INDEX ${name} ON players(${expr}, id);`);
  if (create.ok) run(`DROP INDEX ${name};`);
  const tail = create.ok ? '' : create.out.trim().split('\n').slice(-4).join(' / ');
  results.push([key, create.ok]);
  console.log(`${create.ok ? 'OK  ' : 'FAIL'} ${key}${tail ? `  <- ${tail}` : ''}`);
}

const failed = results.filter(([, ok]) => !ok).map(([k]) => k);
console.log(`\n[probe] 通过 ${results.length - failed.length}/${results.length}${failed.length ? `；失败：${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
