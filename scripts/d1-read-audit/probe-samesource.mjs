// 筛选侧同源化（v6.4.1）的证据生成器：把「裸列写法」与「同源 + IS NOT NULL 守卫」两种筛选条件
// 放在两种排序路径下，逐格量生产执行计划与行读量。**只读**：走管理通道（REST /query）发 SELECT /
// EXPLAIN QUERY PLAN，不写库；读数计入 analytics 统计但不受免费档行读上限约束（见 README §5.4 口径）。
//
// 用途：等值筛选该写裸列还是同源，取决于「筛选键是否就是排序键」——这一格无法用推理定论（同键等值
// 时索引首列被钉死、只剩 id 升序，同源写法会落 TEMP B-TREE 整组重排），所以每次改筛选侧都重跑本脚本，
// 结论与实测数字落在 README §8。
//
// 运行：node scripts/d1-read-audit/probe-samesource.mjs
// 输出：NULL 普查（12 列）+ 行读矩阵（形状 / 行读 / 返回行数 / 计划形状，含是否 +TEMP B-TREE）
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cfg = readFileSync(
  join(process.env.APPDATA ?? homedir(), 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8',
);
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(cfg)?.[1];
const U =
  'https://api.cloudflare.com/client/v4/accounts/47f02bad5907ee6539e8aff008a01cec/d1/database/73154873-d5ae-42b0-a630-25f5ef60053d/query';

async function q(sql) {
  const r = await fetch(U, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors ?? j).slice(0, 300));
  return j.result[0];
}

// COALESCE 与裸列在「列全非 NULL」时等价，所以先普查 NULL 分布：守卫的必要性由它决定
const COLS = [
  'ca',
  'pa',
  'age',
  'prestige',
  'market_value',
  'base_ca',
  'growable',
  'foot',
  'growth_tier',
  'is_future_star',
  'china_plan',
  'agent_tier',
];
const { results: census } = await q(
  `SELECT COUNT(*) AS total, ${COLS.map((c) => `COUNT(*) - COUNT(${c}) AS n_${c}`).join(', ')} FROM players`,
);
console.log('=== NULL 普查（total=%d）===', census[0].total);
for (const c of COLS) console.log(`  ${c.padEnd(16)} NULL ${String(census[0][`n_${c}`]).padStart(6)}`);

// 与 src/worker/routes/players.ts 的主查询同形（含两个左连接），否则计划形状不可比
const S = `SELECT players.id, players.name, players.ca, players.market_value
 FROM players LEFT JOIN clubs cc ON cc.id = players.club_id
 LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1`;

const rows = [];
const run = async (label, where, order) => {
  const sql = `${S} WHERE ${where} ORDER BY ${order} LIMIT 21`;
  const p = await q(`EXPLAIN QUERY PLAN ${sql}`);
  const m = await q(sql);
  const d = p.results.map((r) => r.detail);
  const main = (d.find((x) => /players/.test(x)) ?? '').replace('players ', '');
  rows.push([
    label,
    String(m.meta.rows_read).padStart(6),
    String(m.results.length).padStart(3),
    `${main}${d.some((x) => /TEMP B-TREE/.test(x)) ? ' +TEMP' : ''}`,
  ]);
};

// ── 区间键：旧写法（裸列）vs 新写法（同源 + IS NOT NULL），两种排序路径 ──
const RANGE_CASES = [
  ['ca', '>=', 100],
  ['ca', '<=', 200],
  ['pa', '>=', 60],
  ['age', '>=', 20],
  ['prestige', '>=', 5],
  ['market_value', '<=', 500],
];
for (const [col, op, v] of RANGE_CASES) {
  const src = `COALESCE(players.${col}, 0)`;
  const order = `COALESCE(players.${col}, 0) DESC, players.id DESC`;
  await run(`${col}${op}${v} 旧  +同键排序`, `players.${col} ${op} ${v}`, order);
  await run(`${col}${op}${v} 新  +同键排序`, `(${src} ${op} ${v} AND players.${col} IS NOT NULL)`, order);
  await run(`${col}${op}${v} 旧  +id 排序`, `players.${col} ${op} ${v}`, 'players.id ASC');
  await run(`${col}${op}${v} 新  +id 排序`, `(${src} ${op} ${v} AND players.${col} IS NOT NULL)`, 'players.id ASC');
}
// base_ca：裸表达式是 COALESCE(base_ca, ca)，同源目标是 0034 的 initial-ca 索引表达式
{
  const raw = 'COALESCE(players.base_ca, players.ca)';
  const src = 'COALESCE(COALESCE(players.base_ca, players.ca), 0)';
  const order = `${src} DESC, players.id DESC`;
  await run('base_ca>=100 旧  +同键排序', `${raw} >= 100`, order);
  await run('base_ca>=100 新  +同键排序', `(${src} >= 100 AND ${raw} IS NOT NULL)`, order);
  await run('base_ca>=100 旧  +id 排序', `${raw} >= 100`, 'players.id ASC');
  await run('base_ca>=100 新  +id 排序', `(${src} >= 100 AND ${raw} IS NOT NULL)`, 'players.id ASC');
}

// ── 等值键：条件同源的两种写法（筛选键 = 排序键 / ≠ 排序键）──
const EQ_CASES = [
  ['growth_tier', 3],
  ['growth_tier', 1],
  ['growable', 0],
  ['growable', 1],
  ['foot', 0],
  ['foot', 1],
  ['is_future_star', 0],
  ['is_future_star', 1],
];
for (const [col, v] of EQ_CASES) {
  const src = `COALESCE(players.${col}, 0)`;
  await run(`${col}=${v} 裸列 +id 排序`, `players.${col} = ${v}`, 'players.id ASC');
  await run(`${col}=${v} 同源 +id 排序`, `${src} = ${v}`, 'players.id ASC');
  await run(`${col}=${v} 裸列 +同键排序`, `players.${col} = ${v}`, `${src} DESC, players.id DESC`);
  await run(`${col}=${v} 同源 +同键排序`, `${src} = ${v}`, `${src} DESC, players.id DESC`);
}

console.log('\n=== 行读矩阵（LIMIT 21）===');
for (const [label, reads, ret, plan] of rows) {
  console.log(`${label.padEnd(38)} ${reads} 行读  返回${ret}  ${plan}`);
}
