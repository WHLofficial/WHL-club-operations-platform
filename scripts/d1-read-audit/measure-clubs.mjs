// 增量 31 步骤 1：球队页读量量化（只读打生产）。
//
// 要回答两个问题：
// 1) 列表聚合 `WHERE club_id IS NOT NULL GROUP BY club_id` 现在走哪条路、读多少行？
// 2) 迁移 0032 的部分索引（`WHERE club_id IS NOT NULL`，索引内约 570 条）能把它压到多少？
//
// 第 2 问不去算术推导，而是量一条**访问路径等价**的对照形状：把 20 个 club_id 全部写成
// `IN (...)`。SQLite 对 IN 列表走的是「逐个索引定位」，与部分索引生效后的路径同类，而
// 结果行集与 `IS NOT NULL` 完全相同（生产只有这 20 个俱乐部有人）⇒ 两条形状的 rows_read
// 之差就是部分索引买到的东西。EQP 一并打出来，确认两条形状真的走了不同路径。
//
// 顺带量：详情结构一条、战绩一条、clubs 基表一条。
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runWrangler } from './harness.mjs';

const q = (s) => s.replace(/\s+/g, ' ').trim();

// 需要「真的拿回行」（clubs 清单、EQP 文本）时用这个；harness 的 runWrangler 只回 meta。
const rawQuery = (sql) => {
  const out = execSync(`npx wrangler d1 execute whl-club --remote --json --command "${sql}"`, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.slice(out.indexOf('[')));
};

const measure = (label, sql) => {
  const out = runWrangler(q(sql));
  const r = out[0];
  return { label, rows_read: r?.rows_read ?? null, duration_ms: r?.duration_ms ?? null };
};
const explain = (label, sql) => {
  const parsed = rawQuery(`EXPLAIN QUERY PLAN ${q(sql)}`);
  const rows = parsed[0]?.results ?? [];
  return { label, plan: rows.map((r) => `${r.id ?? ''}/${r.parent ?? ''} ${r.detail ?? JSON.stringify(r)}`.trim()).join(' | ') };
};

const CLUBS = q(`SELECT id, name, status, league_tier, logo_key FROM clubs WHERE status = 'active' ORDER BY id`);
const clubRows = rawQuery(CLUBS)[0]?.results ?? [];
const ids = clubRows.map((r) => r.id).filter((v) => typeof v === 'number');

const AGG_SELECT = q(`
  SELECT p.club_id,
         COUNT(*) AS squad,
         SUM(CASE WHEN p.status = 'trainee' THEN 1 ELSE 0 END) AS trainee,
         AVG(p.ca) AS avg_ca,
         SUM(COALESCE(p.market_value, 0)) AS total_value,
         SUM(COALESCE(ct.wage, 0)) AS total_wage
  FROM players p LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1`);

const AGG_IS_NOT_NULL = `${AGG_SELECT} WHERE p.club_id IS NOT NULL GROUP BY p.club_id`;
const AGG_IN = `${AGG_SELECT} WHERE p.club_id IN (${ids.join(', ')}) GROUP BY p.club_id`;

const DETAIL = q(`
  SELECT p.id, p.position, p.status, p.age, p.ca, p.pa, p.growable,
         p.badges_silver, p.badges_gold, p.market_value, p.club_id, ct.wage
  FROM players p LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
  WHERE p.club_id = ${ids[0] ?? 1} ORDER BY p.ca DESC, p.id`);

const RESULTS = q(`
  SELECT id, season, competition_type, stage_name, round, home_team, away_team,
         score_home, score_away, winner_team, finished_at
  FROM result_confirmations
  WHERE home_team_id = 1 OR away_team_id = 1
  ORDER BY finished_at DESC, id DESC LIMIT 5`);

const COUNT_CLUBBED = q(`SELECT COUNT(*) AS n FROM players WHERE club_id IS NOT NULL`);

const measurements = {
  measured_at: new Date().toISOString(),
  database: 'whl-club (remote)',
  clubs: clubRows.map((r) => ({ id: r.id, name: r.name, league_tier: r.league_tier, logo_key: r.logo_key })),
  club_ids: ids,
  shapes: [
    measure('列表聚合（现状：club_id IS NOT NULL 全索引扫）', AGG_IS_NOT_NULL),
    measure('列表聚合（对照：club_id IN 全部 20 队 ⇒ 部分索引生效后的路径）', AGG_IN),
    measure('详情阵容结构（单队）', DETAIL),
    measure('近期战绩（result_confirmations，无索引）', RESULTS),
    measure('clubs 基表（active）', CLUBS),
    measure('部分索引条目数（club_id IS NOT NULL）', COUNT_CLUBBED),
  ],
  eqp: [explain('列表聚合 IS NOT NULL', AGG_IS_NOT_NULL), explain('列表聚合 IN 20 队', AGG_IN), explain('详情单队', DETAIL)],
};

writeFileSync(new URL('./clubs-measurements.json', import.meta.url), `${JSON.stringify(measurements, null, 2)}\n`);

console.log(`clubs: ${ids.length} 队 → ids ${ids.join(',')}`);
for (const s of measurements.shapes) console.log(`  ${String(s.rows_read).padStart(8)} 行  ${s.label}`);
for (const e of measurements.eqp) console.log(`\nEQP ${e.label}:\n  ${e.plan}`);
