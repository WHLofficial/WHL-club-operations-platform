// v3.2.0 步骤 6：球员库以外的读面普查（一次性测量台，产物进 scripts/d1-read-audit/README.md §7）。
//
// 与 scripts/measure-d1-reads.mjs 的关系：同一个「调真实路由 + 假 D1 抓 SQL + 打生产读 meta」机制，
// 机件共用 scripts/d1-read-audit/harness.mjs。区别在鉴权——球员库是公开端点，这里的读面大多在
// requireUser / requireAdmin / requireCoach 后面，所以假 D1 会对 oidc_session 的查询回一份管理员
// claims、请求带 __Host-club_session cookie，让路由跑到业务 SQL（不需要真会话、不碰生产会话）。
//
// 三个必须记住的边界：
// 1) 只测 SELECT。GET 里也可能藏写语句（/api/market/* 每次请求前先 settleOverdue），
//    拿去打生产就是真写 ⇒ selectOnly() 过滤，被跳过的语句在报告里显式列出条数。
// 2) 管理端 /api/admin/overview 有 isolate 级 60s 缓存（OVERVIEW_TTL_MS），进程内只请求一次
//    才能测到未命中的真实读量。
// 3) src/worker/index.ts 在 Node 里 import 不了（authClient.ts 用了 TS 参数属性）⇒ 内联路由
//    （/api/health、/api/me、/api/cron/tick、/api/cron/players-count）不在本表内。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { captureSurface, fetchConfigMap, inlineParams, makeFakeEnv, mountApp, runWrangler, selectOnly } from './d1-read-audit/harness.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const LOCAL = flag('local');
const DUMP = flag('dump');
const ONLY = opt('only');
const JSON_OUT = opt('json-out');

const ROOT = new URL('..', import.meta.url);
if (DUMP && JSON_OUT) {
  console.error('--dump 与 --json-out 不能同时用：dump 的条目里没有测量数据，写进 JSON 会把真数据覆盖成空壳');
  process.exit(2);
}

// ---- 读面清单 ------------------------------------------------------------------------------
// 按嫌疑排序（不是按热度：系统未正式投用，频次数据无意义）。谁的嫌疑大谁在前面：
// 管理端总览带一条 players 全表 COUNT；通知的未读数被前端每 60s 轮询；市场每个 GET 先跑 settleOverdue。
// cron tick 的三段不是 URL，但它是**频次最高的读面**（`*/5 * * * *` = 288 次/日）：
// /api/cron/tick 内联在 src/worker/index.ts 里（该文件在 Node 里 import 不了），所以直调它的三段实现。
// 注意它们是写路径：settleOverdue 会改 listings/transfers ⇒ selectOnly() 会把写语句滤掉并计数。
const CRON_TASKS = [
  { id: 'cron-settle', label: '结算 tick · settleOverdue', kind: 'task', module: 'src/worker/market-settle.ts', fn: 'settleOverdue' },
  { id: 'cron-results', label: '结算 tick · autoConfirmResults', kind: 'task', module: 'src/worker/results.ts', fn: 'autoConfirmResults' },
  { id: 'cron-notify', label: '结算 tick · dispatchPendingNotifications', kind: 'task', module: 'src/worker/notify.ts', fn: 'dispatchPendingNotifications' },
];

// `who` 是**文档字段**：记录「谁能触发这个读面」（决定它值不值得治理），不参与鉴权——
// 所有读面都用 harness 的 PROBE_CLAIMS 管理员会话请求，为的是一路直达业务 SQL。
const SURFACES = [
  { id: 'admin-overview', label: '管理端总览（players 全表 COUNT）', module: 'src/worker/routes/admin/overview.ts', mount: '/api/admin', url: '/api/admin/overview', who: 'admin' },
  { id: 'notifications-unread', label: '未读通知数（前端每 60s 轮询）', module: 'src/worker/routes/notifications.ts', mount: '/api', url: '/api/notifications/unread-count', who: 'user' },
  { id: 'notifications', label: '通知列表（31 条 + 未读 COUNT）', module: 'src/worker/routes/notifications.ts', mount: '/api', url: '/api/notifications', who: 'user' },
  { id: 'market-listings', label: '市场挂牌列表（先 settleOverdue）', module: 'src/worker/routes/market.ts', mount: '/api', url: '/api/market/listings', who: 'user' },
  { id: 'market-free-agents', label: '市场自由身（先 settleOverdue）', module: 'src/worker/routes/market.ts', mount: '/api', url: '/api/market/free-agents', who: 'user' },
  { id: 'market-trainees', label: '市场训练营（先 settleOverdue）', module: 'src/worker/routes/market.ts', mount: '/api', url: '/api/market/trainees', who: 'user' },
  { id: 'market-listing-detail', label: '挂牌详情（先 settleOverdue）', module: 'src/worker/routes/market.ts', mount: '/api', url: '/api/market/listings/1', who: 'user' },
  { id: 'me-bids', label: '我的出价', module: 'src/worker/routes/market.ts', mount: '/api', url: '/api/me/bids', who: 'user' },
  { id: 'transfer-detail', label: '转会/谈判详情', module: 'src/worker/routes/market.ts', mount: '/api', url: '/api/transfers/1', who: 'user' },
  { id: 'me-club', label: '我的俱乐部（约 10 条）', module: 'src/worker/routes/clubs.ts', mount: '/api', url: '/api/me/club', who: 'user' },
  { id: 'club-balance', label: '俱乐部余额', module: 'src/worker/routes/clubs.ts', mount: '/api', url: '/api/club/balance', who: 'coach' },
  { id: 'club-ledger', label: '俱乐部流水账', module: 'src/worker/routes/clubs.ts', mount: '/api', url: '/api/club/ledger', who: 'coach' },
  { id: 'club-stadium', label: '球场建造信息', module: 'src/worker/routes/clubs.ts', mount: '/api', url: '/api/club/stadium/build-info', who: 'coach' },
  { id: 'club-squad', label: '球队阵容', module: 'src/worker/routes/registration.ts', mount: '/api', url: '/api/club/squad', who: 'coach' },
  { id: 'seasons-current', label: '当前赛季（无缓存 3 条）', module: 'src/worker/routes/seasons.ts', mount: '/api', url: '/api/seasons/current', who: 'public' },
  { id: 'clubs-directory', label: '俱乐部目录（已缓存 24h）', module: 'src/worker/routes/clubs.ts', mount: '/api', url: '/api/clubs/directory', who: 'public' },
  { id: 'player-growth', label: '球员成长曲线（4 条）', module: 'src/worker/routes/growth.ts', mount: '/api', url: '/api/players/1/growth', who: 'public' },
  { id: 'players-detail', label: '球员详情（4 条，无缓存无限流）', module: 'src/worker/routes/players.ts', mount: '/api', url: '/api/players/1', who: 'public' },
  ...CRON_TASKS,
];

// ---- 主流程 --------------------------------------------------------------------------------
console.error('读取生产 config 表（路由分支取决于配置：市场费率、results_auto_confirm、attendance_model）…');
const config = fetchConfigMap({ local: LOCAL });
console.error(`  config 覆盖 ${config.size} 项${config.size ? `：${[...config.keys()].join(', ')}` : ''}`);

const apps = new Map();
const results = [];
for (const item of SURFACES) {
  if (ONLY && item.id !== ONLY) continue;
  let inlined;
  let skipped = [];
  try {
    if (item.kind === 'task') {
      // 直调非 URL 入口（cron tick 三段）
      const sink = [];
      const env = makeFakeEnv(sink, { config });
      const mod = await import(new URL(item.module, ROOT));
      await mod[item.fn](env);
      const picked = selectOnly(sink);
      skipped = picked.skipped;
      inlined = picked.keep.map((s) => inlineParams(s.sql, s.args));
    } else {
      if (!apps.has(item.module)) apps.set(item.module, await mountApp(ROOT, item.module, item.mount));
      const sink = await captureSurface({ app: apps.get(item.module), url: item.url, config });
      const picked = selectOnly(sink);
      skipped = picked.skipped;
      inlined = picked.keep.map((s) => inlineParams(s.sql, s.args));
    }
  } catch (e) {
    results.push({ ...item, error: String(e.message ?? e) });
    console.error(`✗ ${item.id}：抓取 SQL 失败 —— ${e.message ?? e}`);
    continue;
  }
  const where = item.url ?? `直调 ${item.fn}()`;
  if (DUMP) {
    console.log(`\n=== ${item.id} · ${item.label} · ${where} · ${inlined.length} 条 SELECT${skipped.length ? `（跳过 ${skipped.length} 条写语句）` : ''}`);
    inlined.forEach((sql, i) => console.log(`--- [${i}] ${sql}`));
    skipped.forEach((sql) => console.log(`~~~ [write skipped] ${sql}`));
    results.push({ ...item, statements: inlined.length, skipped_writes: skipped.length, sql: inlined, writes: skipped });
    continue;
  }
  const metas = [];
  for (const sql of inlined) {
    try {
      metas.push(...runWrangler(sql, { local: LOCAL }));
    } catch (e) {
      metas.push({ error: String(e.stderr ?? e.message ?? e).slice(0, 300) });
    }
  }
  const total = metas.reduce((acc, m) => acc + (typeof m.rows_read === 'number' ? m.rows_read : 0), 0);
  const dur = metas.reduce((acc, m) => acc + (typeof m.duration_ms === 'number' ? m.duration_ms : 0), 0);
  const heaviest = metas.reduce(
    (acc, m, i) => ((m.rows_read ?? 0) > acc.rows ? { rows: m.rows_read ?? 0, sql: inlined[i] } : acc),
    { rows: -1, sql: '' },
  );
  results.push({
    ...item,
    statements: inlined.length,
    skipped_writes: skipped.length,
    metas,
    rows_read_total: total,
    duration_ms_total: Number(dur.toFixed(1)),
    heaviest_rows: heaviest.rows,
    heaviest_sql: heaviest.sql.replace(/\s+/g, ' ').slice(0, 140),
    writes: skipped,
  });
  const per = metas.map((m) => (m.error ? `ERR(${m.error.slice(0, 40)})` : `${m.rows_read}`)).join(' + ');
  console.error(`✓ ${item.id.padEnd(22)} ${String(total).padStart(8)} 行  [${per}]  ${dur.toFixed(0)}ms  · ${item.label}`);
}

if (DUMP) {
  console.error(`\n（--dump：只打印 SQL，未执行。共 ${results.length} 个读面）`);
} else {
  const grand = results.reduce((acc, r) => acc + (r.rows_read_total ?? 0), 0);
  console.error(`\n合计读量：${grand.toLocaleString('en-US')} 行（本次测量消耗；免费档 5,000,000 行/日）`);
  console.log('\n| 读面 | 方法 URL | 语句数 | 单次读量（行） | 最重一条 | 跳过写语句 | 耗时 ms |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.label} | \`${r.url}\` | — | 失败：${r.error} | — | — | — |`);
      continue;
    }
    console.log(
      `| ${r.label} | \`${r.url}\` | ${r.statements} | ${r.rows_read_total} | ${r.heaviest_rows} | ${r.skipped_writes} | ${r.duration_ms_total} |`,
    );
  }
}

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  let prev = { results: [] };
  try {
    prev = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    // 首次运行没有旧文件
  }
  const merged = new Map((prev.results ?? []).map((r) => [r.id, r]));
  for (const r of results) {
    const before = merged.get(r.id);
    if (before && before.metas && !r.metas) continue;
    merged.set(r.id, r);
  }
  writeFileSync(JSON_OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), target: LOCAL ? 'local' : 'remote', results: [...merged.values()] }, null, 2)}\n`);
  console.error(`已写出 ${JSON_OUT}（累计 ${merged.size} 条）`);
}
