// 迁移 0043（batch 7 四条排序索引）生产核对：结构计数 + EXPLAIN 形状。
// 只读，走管理通道 REST（与 scripts/d1-read-audit/probe-samesource.mjs 同口径）。
// 用法：node scratch/verify-0043.mjs（token 过期时先 npx wrangler whoami）
import fs from 'node:fs';
import path from 'node:path';

const cfgPath = path.join(process.env.APPDATA ?? '', 'xdg.config/.wrangler/config/default.toml');
const token = fs.readFileSync(cfgPath, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!token) throw new Error('没读到 oauth_token —— 先跑 npx wrangler whoami');
const ACCOUNT = '47f02bad5907ee6539e8aff008a01cec';
const DB = '73154873-d5ae-42b0-a630-25f5ef60053d';

async function q(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result[0];
}

const one = async (sql) => (await q(sql)).results[0];
const plan = async (sql) => (await q(`EXPLAIN QUERY PLAN ${sql}`)).results.map((r) => r.detail).join(' | ');

console.log('== 结构 ==');
console.log('idx_players_sort_% 条数 =', (await one(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_players_sort_%'`)).n, '(期望 23)');
console.log('players 索引条数       =', (await one(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'players'`)).n, '(期望 28)');
console.log('d1_migrations 条数     =', (await one(`SELECT COUNT(*) n FROM d1_migrations`)).n, '(期望 43)');
console.log('最后一条迁移           =', (await one(`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`)).name);
const names = (await q(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_players_sort_%' ORDER BY name`)).results.map((r) => r.name);
console.log('全部排序索引           =', names.join(', '));

const SORT_ONLY = [
  ['china_plan 默认', 'COALESCE(players.china_plan, 0)', 'idx_players_sort_china_plan'],
  ['agent_tier 默认', 'COALESCE(players.agent_tier, 0)', 'idx_players_sort_agent_tier'],
  ['growth_gap 默认', '(COALESCE(players.pa, 0) - COALESCE(players.ca, 0))', 'idx_players_sort_growth_gap'],
  [
    'growth_gap 初始',
    "(COALESCE(COALESCE(json_extract(players.game_attrs, '$.PA'), players.pa), 0) - COALESCE(COALESCE(players.base_ca, players.ca), 0))",
    'idx_players_sort_initial_growth_gap',
  ],
];

console.log('\n== 纯排序（无筛选）计划 ==');
for (const [label, expr, index] of SORT_ONLY) {
  const p = await plan(`SELECT players.id FROM players ORDER BY ${expr} DESC, players.id DESC LIMIT 21`);
  console.log(`${label.padEnd(18)} ${p.includes(index) ? 'OK  ' : 'MISS'} ${p}`);
}

console.log('\n== 区间筛选 + 同键排序（同源表达式 ⇒ 期望 SEARCH）==');
const GAP_DEFAULT = '(COALESCE(players.pa, 0) - COALESCE(players.ca, 0))';
const GAP_INITIAL =
  "(COALESCE(COALESCE(json_extract(players.game_attrs, '$.PA'), players.pa), 0) - COALESCE(COALESCE(players.base_ca, players.ca), 0))";
const gapPlan = async (expr, index, guard) =>
  plan(
    `SELECT players.id FROM players WHERE (${expr} >= 10${guard}) ORDER BY ${expr} DESC, players.id DESC LIMIT 21`,
  );
console.log(
  '默认口径 ',
  await gapPlan(GAP_DEFAULT, 'idx_players_sort_growth_gap', ' AND (players.pa) IS NOT NULL AND (players.ca) IS NOT NULL'),
);
console.log('初始口径 ', await gapPlan(GAP_INITIAL, 'idx_players_sort_initial_growth_gap', ''));

console.log('\n== 同键等值（写裸列，故意不走表达式索引 ⇒ 期望 SCAN）==');
console.log(
  'china_plan=1 & sort=china_plan ',
  await plan(`SELECT players.id FROM players WHERE players.china_plan = 1 ORDER BY COALESCE(players.china_plan, 0) DESC, players.id DESC LIMIT 21`),
);
console.log(
  'agent_tier=2 & sort=agent_tier ',
  await plan(`SELECT players.id FROM players WHERE players.agent_tier = 2 ORDER BY COALESCE(players.agent_tier, 0) DESC, players.id DESC LIMIT 21`),
);
