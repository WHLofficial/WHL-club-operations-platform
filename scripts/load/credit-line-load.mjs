// 额度线并发压测（v6.57.1，本地真栈口径）——测试计划 docs/test-plans/v6.57.1-concurrency-load.md 的执行层。
//
// 前置：`npm run dev`（8791）在跑；本地 D1 迁移到 0081；本地基线（clubs 1/2、USER_ID 1 绑 club 1、
// season_windows (1,1) open、ops_schedule.transfer_listing 双锚 none、market_bid_paused 无行）。
// 只动本地开发库（默认 .wrangler/state，与 dev 同库）；种子全部带 910xxx id / auth_sid='load-test'
// 标记，结束清理，重跑幂等。所有期望值从压测前实时快照推导（自校准），不硬编码税额。
//
// 场景：买方 club 1 余额 1000m + 自挂 2 单（各 300m active 出价 → 预期收入净额进额度）；
// 卖方 club 2 挂 24 单（ask 50）；24 个并发出价 ×100m 争同一份额度 → 恰 floor(available/100) 单成功。
//
// 运行：node scripts/load/credit-line-load.mjs   （结果同时落 scratch/load/credit-line-load-result.json）
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BASE = process.env.LOAD_BASE ?? 'http://127.0.0.1:8791';
// 本机若配了代理 env，Node 24 的 fetch 会把 127.0.0.1 也丢给代理（ECONNRESET）——脚本内全部直连
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
const MARK_LOW = 910001;
const MARK_HIGH = 910124;
const SEED_DIR = join('scratch', 'load-seed');
const OUT_FILE = join('scratch', 'load', 'credit-line-load-result.json');
const F = 100; // 单次冻结（m）
const K = 24; // 并发挤兑请求数

const wrangler = (args) => {
  const r = spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} 失败：${`${r.stdout ?? ''}${r.stderr ?? ''}`.slice(0, 600)}`);
  return { out: r.stdout ?? '', err: r.stderr ?? '' };
};
const d1File = (sql) => {
  mkdirSync(SEED_DIR, { recursive: true });
  const f = join(SEED_DIR, `load-${randomBytes(4).toString('hex')}.sql`);
  writeFileSync(f, sql, 'utf8');
  return wrangler(['d1', 'execute', 'whl-club', '--local', '--file', f, '--json']);
};
// --command 带 SQL 会被 shell 拆参（smoke.mjs 同款坑）——查询也走 --file。
// 只解析 stdout：WARNING 走 stderr，拼在 JSON 后面会炸出「JSON 之后的多余内容」。
const d1Json = (sql) => {
  const out = d1File(sql).out.replace(/\x1b\[[0-9;]*m/g, '');
  const start = out.lastIndexOf('[', out.indexOf('"results"'));
  return JSON.parse(out.slice(start).trim())[0].results;
};

const token = randomBytes(32).toString('hex');
const COOKIE = `whl_session=${token}; __Host-club_session=${token}`;
async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { cookie: COOKIE, 'content-type': 'application/json', ...(opts.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}
// CLI 直写本地 D1 后，dev 服务器的第一条走 D1 的请求可能 ECONNRESET（实测两轮均如此、随后自愈）——
// 只对 GET 做网络级重试热身；POST 绝不重试（重试可能双花冻结）。
async function getWarm(path, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await api(path);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

// ── 0. 预检 ─────────────────────────────────────────────────────────────────────

const health = await api('/api/health');
if (health.status !== 200) {
  console.error(`dev 不在 ${BASE}（/api/health → ${health.status}）。先跑 npm run dev。`);
  process.exit(2);
}

// ── 1. 种子（幂等：先清标记区）────────────────────────────────────────────────

const oldBalanceRows = d1Json(`SELECT balance FROM ledger_accounts WHERE club_id = 1`);
const oldBalance = oldBalanceRows.length ? oldBalanceRows[0].balance : null;

d1File(`
DELETE FROM bids WHERE listing_id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM fund_holds WHERE ref_type = 'listing' AND ref_id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM listings WHERE id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM contracts WHERE player_id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM players WHERE id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
-- 会话（KV 另种；oidc 行带 load-test 标记）
DELETE FROM oidc_session WHERE auth_sid = 'load-test';
-- 买方（club 1）额度来源：自挂 2 单 + 对方 active 出价 300m（净额按现行 RC 与分段税实算，
-- 具体额度值以压测前实时快照为准，脚本不做硬编码断言）
INSERT INTO players (id, uid, name, club_id, status, ca, pa) VALUES
  (910001, 'load-910001', '额度源甲', 1, 'normal', 88, 92),
  (910002, 'load-910002', '额度源乙', 1, 'normal', 85, 90);
INSERT INTO contracts (player_id, club_id, release_fee, wage, is_active) VALUES
  (910001, 1, 300, 1, 1), (910002, 1, 300, 1, 1);
INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, season, window_seq) VALUES
  (910001, 910001, 1, 'normal', 300, 'listed', '2026-07-01T00:00:00Z', 1, 1),
  (910002, 910002, 1, 'normal', 300, 'listed', '2026-07-01T00:00:00Z', 1, 1);
INSERT INTO bids (listing_id, club_id, amount, created_at, status) VALUES
  (910001, 2, 300, '2026-07-01T00:00:00Z', 'active'),
  (910002, 2, 300, '2026-07-01T00:00:00Z', 'active');
`);
// 卖方（club 2）24 张挂牌：24 个合成球员，deadline 全 NULL（settleOverdue 永不结算）
const pSql = [];
const lSql = [];
for (let i = 0; i < K; i++) {
  const pid = 910101 + i;
  pSql.push(`(${pid}, 'load-${pid}', '挤兑靶${i + 1}', 2, 'normal', 70, 80)`);
  lSql.push(`(${pid}, ${pid}, 2, 'normal', 50, 'listed', '2026-07-01T00:00:00Z', 1, 1)`);
}
d1File(`
INSERT INTO players (id, uid, name, club_id, status, ca, pa) VALUES\n  ${pSql.join(',\n  ')};
INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, season, window_seq) VALUES\n  ${lSql.join(',\n  ')};
INSERT OR REPLACE INTO ledger_accounts (club_id, balance, updated_at)
  VALUES (1, 1000, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`);
// KV 会话（--path 读值：内联 JSON 会被 shell 拆参）
mkdirSync(SEED_DIR, { recursive: true });
const kvFile = join(SEED_DIR, 'load-kv-value.json');
writeFileSync(kvFile, JSON.stringify({ userId: 1 }), 'utf8');
wrangler(['kv', 'key', 'put', '--binding', 'SESSION_KV', '--local', '--path', kvFile, `sess:${token}`]);
const now = new Date();
const claims = JSON.stringify({
  name: '额度压测',
  locked: false,
  must_change_pw: false,
  roles: ['club.admin'],
  permissions: ['club.clubs.manage', 'club.squad.manage', 'club.ledger.manage'],
}).replace(/'/g, "''");
d1File(
  `INSERT INTO oidc_session (token_hash, sub, auth_sid, created_at, expires_at, revoked_at, claims) VALUES ` +
    `('${createHash('sha256').update(token).digest('hex')}', '1', 'load-test', '${now.toISOString()}', ` +
    `'${new Date(now.getTime() + 3600_000).toISOString()}', NULL, '${claims}');`,
);
console.log('种子完成（club 1 余额 1000 + 额度源 2 单；club 2 挤兑靶 24 单）');

// ── 2. TC-L-001 并发读：恒等式 + 吞吐 ────────────────────────────────────────

const READ_WORKERS = 16;
const READ_EACH = 50;
const snap0 = await getWarm('/api/club/balance');
if (snap0.status !== 200) throw new Error(`余额快照 ${snap0.status}：${JSON.stringify(snap0.body)}`);
const s0 = snap0.body;
console.log(`压测前快照：balance ${s0.balance} / held ${s0.held} / 预期收入 ${s0.expectedIncome} / 额度 ${s0.creditLine} / 可支配 ${s0.available}`);
const avail0 = s0.available;

const readResults = [];
const readStart = Date.now();
await Promise.all(
  Array.from({ length: READ_WORKERS }, async () => {
    for (let i = 0; i < READ_EACH; i++) {
      const t0 = performance.now();
      const r = await api('/api/club/balance');
      const ms = performance.now() - t0;
      let invariantOk = null;
      if (r.status === 200 && r.body && typeof r.body.available === 'number') {
        invariantOk = Math.abs(r.body.available - round2(r.body.balance - r.body.held + r.body.creditLine)) < 0.005;
      }
      readResults.push({ status: r.status, ms, invariantOk });
    }
  }),
);
const readWall = (Date.now() - readStart) / 1000;
const readOk = readResults.filter((r) => r.status === 200);
const badInvariant = readResults.filter((r) => r.invariantOk === false);
const lat = readOk.map((r) => r.ms).sort((a, b) => a - b);
const tc1 = {
  total: readResults.length,
  ok200: readOk.length,
  non200: readResults.filter((r) => r.status !== 200).length,
  badInvariant: badInvariant.length,
  p50: percentile(lat, 50)?.toFixed(1),
  p95: percentile(lat, 95)?.toFixed(1),
  max: lat.length ? lat[lat.length - 1].toFixed(1) : '—',
  rps: (readOk.length / readWall).toFixed(1),
};
console.log(`TC-L-001 并发读（${READ_WORKERS}×${READ_EACH}）：200=${tc1.ok200}/${tc1.total} 非法快照=${tc1.badInvariant} p50=${tc1.p50}ms p95=${tc1.p95}ms max=${tc1.max}ms ${tc1.rps} req/s`);

// ── 3. TC-L-002 并发挤兑 ──────────────────────────────────────────────────────

const expected = Math.floor((avail0 + Number.EPSILON) / F);
const t0 = Date.now();
const bids = await Promise.all(
  Array.from({ length: K }, (_, i) =>
    api(`/api/market/listings/${910101 + i}/bids`, { method: 'POST', body: JSON.stringify({ amount: F }) }),
  ),
);
const wall2 = ((Date.now() - t0) / 1000).toFixed(2);
const accepted = bids.filter((b) => b.status === 200 || b.status === 201);
const fundsRejected = bids.filter((b) => b.status >= 400 && b.status < 500 && JSON.stringify(b.body ?? {}).includes('可用资金不足'));
const other = bids.filter((b) => !accepted.includes(b) && !fundsRejected.includes(b));
const serverErrors = bids.filter((b) => b.status >= 500);
const tc2 = { expected, accepted: accepted.length, fundsRejected: fundsRejected.length, other: other.length, serverErrors: serverErrors.length, wall: wall2 };
console.log(`TC-L-002 挤兑（${K} 并发 ×${F}m，${wall2}s）：期望接受 ${expected} → 实际 ${accepted.length}；资金拒 ${fundsRejected.length}；其它 ${other.map((o) => `${o.status}:${JSON.stringify(o.body)?.slice(0, 60)}`).join(' | ') || '无'}；5xx=${serverErrors.length}`);

// ── 4. TC-L-003 压测后对账 ────────────────────────────────────────────────────

const snap1 = await api('/api/club/balance');
const s1 = snap1.body;
const ledgerRows = d1Json(
  `SELECT COALESCE(SUM(amount), 0) AS sum_amount, COUNT(*) AS n FROM fund_holds
   WHERE club_id = 1 AND status = 'held' AND ref_type = 'listing' AND ref_id BETWEEN ${910101} AND ${910124}`,
);
const heldDeltaDb = round2(ledgerRows[0].sum_amount);
const tc3 = {
  dbSum: heldDeltaDb,
  dbRows: ledgerRows[0].n,
  snapshotHeldDelta: round2(s1.held - s0.held),
  snapshotAvailableDelta: round2(s0.available - s1.available),
  availableAfter: s1.available,
};
console.log(`TC-L-003 对账：库内本批冻结 ${tc3.dbSum}（${tc3.dbRows} 行）vs 快照增量 ${tc3.snapshotHeldDelta}；可支配余 ${tc3.availableAfter}`);

// ── 5. TC-L-004 直库超冻被触发器拦截 ──────────────────────────────────────────

let tc4;
try {
  d1File(
    `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
     VALUES (1, 999999, 'held', 'listing', 910001, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
  );
  tc4 = { blocked: false, detail: '直库 INSERT 竟然成功——触发器兜底失效！' };
} catch (e) {
  const msg = String(e?.message ?? e);
  tc4 = { blocked: msg.includes('WHL_BID_REJECT_FUNDS'), detail: msg.slice(0, 200) };
}
console.log(`TC-L-004 直库超冻：${tc4.blocked ? '被 WHL_BID_REJECT_FUNDS 拦截 ✓' : '未拦截！' + tc4.detail}`);

// ── 6. 判定 ───────────────────────────────────────────────────────────────────

const pass =
  tc1.ok200 === tc1.total && tc1.badInvariant === 0 &&
  tc2.accepted === tc2.expected && tc2.other === 0 && tc2.serverErrors === 0 &&
  Math.abs(tc3.dbSum - tc3.snapshotHeldDelta) < 0.005 && tc3.dbRows === tc2.accepted &&
  tc4.blocked;
console.log(pass ? '\n全部通过 ✓' : '\n存在失败项 ✗（见上）');

// ── 7. 清理（幂等）────────────────────────────────────────────────────────────

d1File(`
DELETE FROM bids WHERE listing_id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM fund_holds WHERE ref_type = 'listing' AND ref_id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM listings WHERE id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM contracts WHERE player_id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM players WHERE id BETWEEN ${MARK_LOW} AND ${MARK_HIGH};
DELETE FROM oidc_session WHERE auth_sid = 'load-test';
`);
if (oldBalance === null) {
  d1File(`DELETE FROM ledger_accounts WHERE club_id = 1;`);
} else {
  d1File(`UPDATE ledger_accounts SET balance = ${oldBalance} WHERE club_id = 1;`);
}
wrangler(['kv', 'key', 'delete', '--binding', 'SESSION_KV', '--local', `sess:${token}`]);
console.log('清理完成（910xxx 标记区 + 会话 + 余额还原）');

mkdirSync(join('scratch', 'load'), { recursive: true });
writeFileSync(
  OUT_FILE,
  JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, snapshot0: s0, tc1, tc2, tc3, tc4, pass }, null, 2),
);
console.log(`已写 ${OUT_FILE}`);
process.exit(pass ? 0 : 1);
