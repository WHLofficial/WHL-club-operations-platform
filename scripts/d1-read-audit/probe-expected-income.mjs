// 预期收入额度（v6.57.0 / 收口审 TC-B-018）的生产量级探针：把「余额快照 / 额度单独求值 / 拆解端点」
// 三类查询放在生产真库上量 `meta.rows_read` 与 EXPLAIN QUERY PLAN。**只读**：走管理通道（REST
// /query）发 SELECT / EXPLAIN QUERY PLAN，不写库；读数计入 analytics 统计但不受免费档行读上限约束
// （README §5.4 口径，与 probe-samesource.mjs 同一通道）。
//
// 量什么、为什么：
// - balanceSnapshot（/api/club/balance 每调用一次）：行读 = 该队 fund_holds 行数 + 在途收入子查询扫描面。
// - creditLineSql 单独求值：0081 三个资金触发器与 bypass/offer 守卫内嵌的同一片段——每次 fund_holds
//   写入（出价/报价/海捞冻结）都重求值一次，它的行读就是「触发器写放大」的单位成本。
// - expectedIncomeBreakdown（转会台「预计收入」拆解端点）：同一子查询多一层 ORDER BY。
// - 普查：listings / transfers / fund_holds 按队分布——子查询按 seller_club_id / from_club_id 走
//   idx_listings_seller / idx_transfers_from 后内存筛状态，所以「该队历史总单数」就是这两条 SEARCH
//   的行读下界，登记出来供将来做部分索引时对照。
//
// 零漂移声明：SQL 不手抄，直接 import src/worker/ledger.ts 的真函数（Node 24 原生剥类型跑 .ts），
// 量到的就是线上形状；ledger.ts 改公式这里自动跟上。
//
// 运行：node scripts/d1-read-audit/probe-expected-income.mjs
// 输出：普查 + 行读矩阵（形状 / 队 / 行读 / 返回行数 / 计划标记）+ expected-income-measurements.json
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { balanceSnapshot, creditLineSql, expectedIncomeBreakdown } from '../../src/worker/ledger.ts';

const cfg = readFileSync(
  join(process.env.APPDATA ?? homedir(), 'xdg.config', '.wrangler', 'config', 'default.toml'),
  'utf8',
);
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(cfg)?.[1];
const U =
  'https://api.cloudflare.com/client/v4/accounts/47f02bad5907ee6539e8aff008a01cec/d1/database/73154873-d5ae-42b0-a630-25f5ef60053d/query';

async function q(sql, params = []) {
  const r = await fetch(U, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors ?? j).slice(0, 300));
  return j.result[0];
}

// REST /query 上的最小 D1 适配器：ledger.ts 的真函数直接跑在上面，每次调用的行读记进 reads。
function makeAdapter() {
  const reads = [];
  const record = (sql, meta) => reads.push({ rowsRead: meta.rows_read });
  return {
    reads,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              const m = await q(sql, params);
              record(sql, m.meta);
              return m.results[0] ?? null;
            },
            async all() {
              const m = await q(sql, params);
              record(sql, m.meta);
              return { results: m.results };
            },
          };
        },
      };
    },
  };
}

// ── 普查 ────────────────────────────────────────────────────────────────────────

const { results: totals } = await q(`SELECT (SELECT COUNT(*) FROM listings) AS listings,
  (SELECT COUNT(*) FROM transfers) AS transfers, (SELECT COUNT(*) FROM bids) AS bids,
  (SELECT COUNT(*) FROM bids WHERE status = 'active') AS active_bids,
  (SELECT COUNT(*) FROM fund_holds) AS fund_holds`);
console.log('=== 全库总量 ===', JSON.stringify(totals[0]));

const { results: listingsCensus } = await q(
  `SELECT seller_club_id AS club, COUNT(*) AS total,
          SUM(CASE WHEN status IN ('listed','bidding') THEN 1 ELSE 0 END) AS inflight
   FROM listings GROUP BY seller_club_id ORDER BY total DESC`,
);
const { results: transfersCensus } = await q(
  `SELECT from_club_id AS club, COUNT(*) AS total,
          SUM(CASE WHEN status IN ('pending_review','signing')
                    AND type IN ('transfer','activation','forced_auction') THEN 1 ELSE 0 END) AS inflight
   FROM transfers GROUP BY from_club_id ORDER BY total DESC`,
);
const { results: holdsCensus } = await q(
  `SELECT club_id AS club, COUNT(*) AS total, SUM(CASE WHEN status = 'held' THEN 1 ELSE 0 END) AS held
   FROM fund_holds GROUP BY club_id ORDER BY total DESC`,
);

// 长历史轴 = 该队 listings 历史总数 + transfers 历史总数（SEARCH 落全历史再滤状态）
const hist = new Map();
for (const r of [...listingsCensus, ...transfersCensus]) {
  hist.set(r.club, (hist.get(r.club) ?? 0) + r.total);
}
const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]);
const { results: clubs } = await q(`SELECT id, name FROM clubs ORDER BY id`);
const zeroClub = clubs.find((c) => !hist.has(c.id));

const picks = [];
if (ranked[0]) picks.push({ club: ranked[0][0], label: '最长历史' });
if (ranked[1]) picks.push({ club: ranked[1][0], label: '次长历史' });
if (zeroClub) picks.push({ club: zeroClub.id, label: '零历史' });

console.log('\n=== 按队历史普查（前 6）===');
for (const [club, total] of ranked.slice(0, 6)) {
  const l = listingsCensus.find((r) => r.club === club) ?? { total: 0, inflight: 0 };
  const t = transfersCensus.find((r) => r.club === club) ?? { total: 0, inflight: 0 };
  const h = holdsCensus.find((r) => r.club === club) ?? { total: 0, held: 0 };
  console.log(`  club ${String(club).padStart(6)}  listings ${String(l.total).padStart(4)}（在途 ${l.inflight}）  transfers ${String(t.total).padStart(4)}（在途成交 ${t.inflight}）  fund_holds ${String(h.total).padStart(4)}（held ${h.held}）`);
}
if (zeroClub) console.log(`  零历史对照 club ${zeroClub.id}（${zeroClub.name}）`);

// ── 行读矩阵 ────────────────────────────────────────────────────────────────────

const matrix = [];
console.log('\n=== 行读矩阵（生产真库）===');
for (const { club, label } of picks) {
  // balanceSnapshot：真函数直接跑在 REST 适配器上
  const a = makeAdapter();
  const snap = await balanceSnapshot(a, club);
  const balanceRows = a.reads.reduce((n, r) => n + r.rowsRead, 0);
  // breakdown：真函数直接跑
  const b = makeAdapter();
  const items = await expectedIncomeBreakdown(b, club);
  const breakdownRows = b.reads.reduce((n, r) => n + r.rowsRead, 0);
  // creditLineSql 单独求值（触发器/守卫写放大的单位）：片段是裸表达式，包 SELECT 执行（同 tests/expected-income.test.ts:435）
  const creditSql = `SELECT ${creditLineSql(String(club))} AS credit_line`;
  const p = await q(`EXPLAIN QUERY PLAN ${creditSql}`);
  const m = await q(creditSql);
  const plans = p.results.map((r) => r.detail);
  const scans = plans.map((d) => /SCAN (\w+)/.exec(d)?.[1]).filter(Boolean);
  const temp = plans.some((d) => /TEMP B-TREE/.test(d));

  for (const [shape, rowsRead, returned] of [
    ['balance', balanceRows, 1],
    ['credit', m.meta.rows_read, m.results.length],
    ['breakdown', breakdownRows, items.length],
  ]) {
    matrix.push({ shape, club, label, rowsRead, returned, scans: shape === 'credit' ? scans : [], tempBtree: shape === 'credit' ? temp : false, plans: shape === 'credit' ? plans : [] });
    console.log(
      `${shape.padEnd(10)} club ${String(club).padStart(6)}（${label}）  ${String(rowsRead).padStart(6)} 行读  返回 ${String(returned).padStart(3)}`,
    );
  }
  if (scans.length || temp) {
    console.log(`    ⚠ credit 计划：${scans.length ? 'SCAN ' + scans.join(',') : ''}${temp ? ' +TEMP B-TREE' : ''}`);
  }
}

// 索引使用取证：最长历史队的 credit 计划逐行打印
const worst = matrix.find((r) => r.shape === 'credit' && r.label === '最长历史');
if (worst) {
  console.log(`\n=== EXPLAIN QUERY PLAN（credit × club ${worst.club}）===`);
  for (const d of worst.plans) console.log('  ' + d);
}

writeFileSync(
  join(import.meta.dirname, 'expected-income-measurements.json'),
  JSON.stringify({ note: 'v6.57.0/收口审 TC-B-018：预期收入额度三形状生产实测（只读探针，SQL 由 src/worker/ledger.ts 真函数产生，零漂移）', generatedAt: new Date().toISOString(), totals: totals[0], listingsCensus, transfersCensus, holdsCensus, matrix }, null, 2),
);
console.log('\n已写 expected-income-measurements.json');
