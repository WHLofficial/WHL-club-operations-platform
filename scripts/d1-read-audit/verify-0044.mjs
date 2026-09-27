// 迁移 0044（batch 8 两条排序索引）生产核对：结构计数 + EXPLAIN 形状。
// 只读，走管理通道 REST（与 scripts/d1-read-audit/probe-samesource.mjs、verify-0043.mjs 同口径）。
// 用法：node scripts/d1-read-audit/verify-0044.mjs（token 过期时先 npx wrangler whoami 刷新）
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
console.log('idx_players_sort_% 条数 =', (await one(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_players_sort_%'`)).n, '(期望 25)');
console.log('players 索引条数       =', (await one(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'players'`)).n, '(期望 30)');
console.log('d1_migrations 条数     =', (await one(`SELECT COUNT(*) n FROM d1_migrations`)).n, '(期望 44)');
console.log('最后一条迁移           =', (await one(`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`)).name);
const names = (await q(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_players_sort_%' ORDER BY name`)).results.map((r) => r.name);
console.log('全部排序索引           =', names.join(', '));

const SORT_ONLY = [
  ['fc_id 默认', 'COALESCE(players.fc_id, 0)', 'idx_players_sort_fc_id'],
  [
    'pa 初始视图',
    "COALESCE(COALESCE(json_extract(players.game_attrs, '$.PA'), players.pa), 0)",
    'idx_players_sort_initial_pa',
  ],
];

console.log('\n== 纯排序（无筛选）计划 ==');
for (const [label, expr, index] of SORT_ONLY) {
  const p = await plan(`SELECT players.id FROM players ORDER BY ${expr} DESC, players.id DESC LIMIT 21`);
  console.log(`${label.padEnd(14)} ${p.includes(index) ? 'OK  ' : 'MISS'} ${p}`);
}

console.log('\n== 带 keyset 游标的第 2 页（尾列 id 必须进索引，否则仍临时排序）==');
const FC = 'COALESCE(players.fc_id, 0)';
const PA_INIT = "COALESCE(COALESCE(json_extract(players.game_attrs, '$.PA'), players.pa), 0)";
console.log(
  'fc_id 游标     ',
  await plan(
    `SELECT players.id FROM players WHERE (${FC} < 239085 OR (${FC} = 239085 AND players.id < 5000)) ORDER BY ${FC} DESC, players.id DESC LIMIT 21`,
  ),
);
console.log(
  'pa 初始 游标   ',
  await plan(
    `SELECT players.id FROM players WHERE (${PA_INIT} < 150 OR (${PA_INIT} = 150 AND players.id < 5000)) ORDER BY ${PA_INIT} DESC, players.id DESC LIMIT 21`,
  ),
);

// 注意：0044 建好后，同源写法也会 seek 到 idx_players_sort_fc_id（不再是全表扫）—— 裸列仍然更优，它走
// UNIQUE 自动索引的 1 行 unique seek。这一对打印留着当证据，别按「同源必然全表扫」的旧结论读。
console.log('\n== fc_id 筛选保持裸列 ⇒ 期望走 UNIQUE 自动索引（同源写法在 0044 之后也会 seek 新索引）==');
console.log('fc_id=239085 ', await plan('SELECT players.id FROM players WHERE players.fc_id = 239085 ORDER BY players.id ASC LIMIT 21'));
console.log(
  '反例（同源） ',
  await plan(`SELECT players.id FROM players WHERE ${FC} = 239085 ORDER BY players.id ASC LIMIT 21`),
);
