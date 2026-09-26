// 角色筛选（v6.6.0）的证据生成器：角色走「五槽 OR」普通表达式谓词，**没有配套索引** —— 本脚本量它在
// 生产上的真实行读量，并复现「为什么没建索引」的证据（OR + ORDER BY 会弃用表达式索引；§6.7 的 UNION
// 驱动形状没有索引时反而更贵、且只在角色是唯一筛选时才正确）。**只读**：走管理通道（REST /query）发
// SELECT / EXPLAIN QUERY PLAN，不写库；读数计入 analytics 统计但不受免费档行读上限约束（见 README §5.4）。
//
// 用途：结论与实测数字落在 README §5.2 / §5.5 / §9。改角色筛选形状（换回索引路或改 OR 写法）时重跑本脚本。
//
// 运行：node scripts/d1-read-audit/probe-role-filter.mjs
// 输出：① 五槽占用普查 + 角色值持有数分布；② 按持有数分档的首屏行读（找出「多少持有数以内单页读量 >1000」）；
//       ③ §6.7 索引驱动形状与 OR 形态的对照（生产未建配套索引 ⇒ 驱动更贵）
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

// 与 src/worker/routes/players.ts 的 role 分支同形：五槽 OR，每槽 `json_extract(...) IN (值)`
// （索引路才需要的 `> 0` 同源守卫在 OR 形态下不产生收益，所以端点里不写 —— 见 README §5.2）。
const R = (n) => `json_extract(players.game_attrs, '$.RoleID${n}')`;
const SLOTS = [1, 2, 3, 4, 5];
const roleWhere = (ids) => `(${SLOTS.map((n) => `${R(n)} IN (${ids.join(', ')})`).join(' OR ')})`;

// 列表主查询（与 players.ts:630 同形，含两个左连接）；COUNT 与 players.ts:786 同形（无 ORDER BY）
const LIST = `SELECT players.id, players.name, players.ca, players.market_value
 FROM players LEFT JOIN clubs cc ON cc.id = players.club_id
 LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1`;
const COUNT = `SELECT COUNT(*) FROM players LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1`;

const measure = async (sql) => {
  const p = await q(`EXPLAIN QUERY PLAN ${sql}`);
  const m = await q(sql);
  const d = p.results.map((r) => r.detail);
  const main = (d.find((x) => /players/.test(x)) ?? '').replace('players ', '');
  return {
    read: m.meta.rows_read,
    n: m.results.length,
    plan: `${main}${d.some((x) => /TEMP B-TREE/.test(x)) ? ' +TEMP' : ''}`,
  };
};

// ── ① 槽占用普查 + 持有数分布 ──
const census = await q(
  `SELECT ${SLOTS.map((n) => `SUM(CASE WHEN ${R(n)} > 0 THEN 1 ELSE 0 END) AS s${n}`).join(', ')},
          COUNT(*) AS total FROM players`,
);
console.log('=== 五槽占用普查（生产 players=%d 行）===', census.results[0].total);
for (const n of SLOTS) console.log(`  RoleID${n} 非零 ${String(census.results[0][`s${n}`]).padStart(6)}`);

const dist = await q(
  `SELECT v, COUNT(*) AS holders FROM (
     ${SLOTS.map((n) => `SELECT ${R(n)} AS v FROM players`).join(' UNION ALL ')}
   ) WHERE v > 0 GROUP BY v ORDER BY holders ASC, v ASC`,
);
const holders = dist.results;
console.log(
  `  合法角色值 ${holders.length} 个持有中；最少 ${holders[0].holders} 人（id=${holders[0].v}），` +
    `最多 ${holders[holders.length - 1].holders} 人（id=${holders[holders.length - 1].v}）`,
);
console.log(`  持有 <21 人（单页取不满）的值 ${holders.filter((h) => h.holders < 21).length} 个`);

// ── ② 按持有数分档量首屏行读（角色是唯一筛选、sort=id 默认序、LIMIT 21）──
// 目的：找出「持有数多少以内单页读量仍 ≤1,000」（§5.4 的验收线），其余值进 §5.5 豁免清单。
const picks = [1, 5, 20, 100, 500, 2772]
  .map((want) => holders.reduce((a, b) => (Math.abs(b.holders - want) < Math.abs(a.holders - want) ? b : a)))
  .filter((h, i, arr) => arr.findIndex((x) => x.v === h.v) === i);

console.log('\n=== 角色筛选首屏行读（生产 18,301 行 / LIMIT 21，按持有数分档）===');
console.log('  role 值  持有   首屏读量  行  计划形状                               COUNT读量');
const common = picks[picks.length - 1];
for (const h of picks) {
  const w = roleWhere([h.v]);
  const list = await measure(`${LIST} WHERE ${w} ORDER BY players.id ASC LIMIT 21`);
  const cnt = await measure(`${COUNT} WHERE ${w}`);
  console.log(
    `  ${String(h.v).padStart(6)}  ${String(h.holders).padStart(5)}  ${String(list.read).padStart(8)}  ${String(
      list.n,
    ).padStart(3)}  ${list.plan.padEnd(38)}${String(cnt.read).padStart(8)}`,
  );
}

// ── ③ §6.7 索引驱动形状 vs OR 形态 ──
// 注意：生产**没有**配套的 5 条部分索引（路线 A 已弃用），所以驱动形状的内层 UNION 要各扫一遍全表
// ⇒ 这里它必然更贵。计划 §6.7 的「98 行/次」是**建了索引之后**的本地读数。
const UNION = SLOTS.map(
  (n) => `SELECT players.id AS id FROM players WHERE ${R(n)} IN (${common.v}) AND ${R(n)} > 0`,
).join(' UNION ALL ');
const DRIVE = `SELECT players.id AS id FROM players WHERE players.id IN (SELECT id FROM (${UNION}) ORDER BY id ASC LIMIT 21) ORDER BY players.id ASC LIMIT 21`;
const d = await measure(DRIVE);
const o = await measure(`${LIST} WHERE ${roleWhere([common.v])} ORDER BY players.id ASC LIMIT 21`);
console.log('\n=== 索引驱动形状 vs OR 形态（role=%d，角色是唯一筛选）===', common.v);
console.log(`  §6.7 驱动形状（生产未建配套索引）rows_read = ${d.read}（n=${d.n}，${d.plan}）`);
console.log(`  五槽 OR 形态                    rows_read = ${o.read}（n=${o.n}，${o.plan}）`);
console.log('  ⇒ 生产上 OR 靠 ORDER BY id 早停更省；驱动要先有 5 条部分索引才划算，且只在稀有角色上胜');
