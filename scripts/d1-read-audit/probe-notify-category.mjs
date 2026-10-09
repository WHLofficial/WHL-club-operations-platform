// v6.40.0 收件篮类目筛选的读量探针（只读打生产）。
//
// 要回答一个问题：收件篮新增 `GET /api/notifications?category=<类目>` 与
// `GET /api/notifications/unread-count?by=category` 之后，**要不要在 notifications 上补一条
// (user_id, template, id) 索引（候选迁移 0066）**？判断依据是实测行读量，不是算术推导 ——
// 索引是写成本（免费档 10 万行/日），建之前必须先知道现形状读多少（README §5.4 的验收线 1,000 行/次）。
//
// 方法（与 README「二、方法」一致，SQL 不手抄）：用 harness 的假 D1 + `app.request()` 直调真实路由
// （`src/worker/routes/notifications.ts`，挂载前缀 `/api`），把路由实际执行的 SQL 与绑定抓下来，
// 参数内联成字面量后交 `wrangler d1 execute --remote`，读 `meta.rows_read`，并打 EXPLAIN QUERY PLAN。
//
// 三条边界：
// - 会话里的 user_id 是假的（claims.sub='1'）⇒ 测量前把内联后的 `user_id = <n>` 替换成**生产上持有
//   最多站内信的真实 user_id**（替换的只是这一个字面量，SQL 形状仍来自路由）。生产该用户没有信时，
//   读数退化为「索引定位空集」，脚本会明确标注。
// - `POST /api/notifications/read` 会捕到 UPDATE：**只打 EXPLAIN QUERY PLAN，绝不执行**（探针只读）。
// - `--local` 不回传 `meta.rows_read`，所以数字必须打生产；本脚本 target 恒为 remote。
//
// 运行：node scripts/d1-read-audit/probe-notify-category.mjs
// 结论落在 docs/test-plans/v6.40.0-notification-badges.md 第十节（探针）。
import { execSync } from 'node:child_process';
import { mountApp, captureSurface, inlineParams } from './harness.mjs';

const ROOT = new URL('../../', import.meta.url);
const q = (s) => s.replace(/\s+/g, ' ').trim();

function rawQuery(sql) {
  const cmd = `npx wrangler d1 execute whl-club --remote --json --command "${q(sql)}"`;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out.slice(out.indexOf('[')));
      return parsed[0] ?? {};
    } catch (e) {
      lastErr = e;
      const msg = String(e.stderr ?? e.message ?? '');
      if (!/3221226505|UV_HANDLE_CLOSING|ETIMEDOUT|ECONNRESET/.test(msg) || attempt === 3) throw e;
      console.error(`   [retry ${attempt}] wrangler 偶发失败，重跑`);
    }
  }
  throw lastErr;
}
const measure = (sql) => {
  const r = rawQuery(sql);
  return { rows_read: r.meta?.rows_read ?? null, duration_ms: r.meta?.duration ?? null, n: r.results?.length ?? null };
};
const explain = (sql) => {
  const r = rawQuery(`EXPLAIN QUERY PLAN ${sql}`);
  return (r.results ?? []).map((row) => row.detail ?? JSON.stringify(row)).join(' | ');
};

// ── ① 生产现状普查（notifications 本身很小，全表普查的成本可接受） ────────────────────────────
const census = rawQuery(`SELECT COUNT(*) AS n FROM notifications`);
const byChannel = rawQuery(`SELECT channel, COUNT(*) AS n FROM notifications GROUP BY channel`);
const topUsers = rawQuery(
  `SELECT user_id, COUNT(*) AS n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread
   FROM notifications WHERE channel = 'web' GROUP BY user_id ORDER BY n DESC LIMIT 5`,
);
const indexes = rawQuery(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications'`);

console.log('=== ① 生产 notifications 现状 ===');
console.log(`  全表 ${census.results?.[0]?.n ?? '?'} 行`);
for (const r of byChannel.results ?? []) console.log(`  channel=${r.channel}：${r.n} 行`);
const holders = topUsers.results ?? [];
if (holders.length === 0) {
  console.log('  web 渠道**没有任何行**（类目筛选的读数会退化为空集定位）');
} else {
  for (const r of holders) console.log(`  user_id=${r.user_id}：${r.n} 行（未读 ${r.unread}）`);
}
for (const r of indexes.results ?? []) console.log(`  索引 ${r.name}：${q(r.sql ?? '（自动索引）')}`);

const topUser = holders[0]?.user_id ?? 1;
const topUnread = [...holders].sort((a, b) => (b.unread ?? 0) - (a.unread ?? 0))[0]?.user_id ?? topUser;
console.log(`  基准 user_id：行数最多 ${topUser} / 未读最多 ${topUnread}（读量按两者各量一遍 = 最坏情况口径）`);

// ── ② 抓真实路由的 SQL ────────────────────────────────────────────────────────────────────────
const app = await mountApp(ROOT, './src/worker/routes/notifications.ts', '/api');
const surfaces = [
  ['列表（无类目）', '/api/notifications'],
  ['列表（?category=offer）', '/api/notifications?category=offer'],
  ['未读数（全量）', '/api/notifications/unread-count'],
  ['未读数（?by=category）', '/api/notifications/unread-count?by=category'],
  ['标已读（all+category）', '/api/notifications/read'],
];
const captured = [];
for (const [label, url] of surfaces) {
  const body = url.endsWith('/read') ? { all: true, category: 'offer' } : undefined;
  const sink = await captureSurface({ app, url, method: body ? 'POST' : 'GET', body });
  captured.push({ label, url, sink });
}

// ── ③ 逐条量：SELECT 执行 + 计划；UPDATE 只打计划 ─────────────────────────────────────────────
const withUser = (sql, user) => sql.replace(/\buser_id = \d+/g, `user_id = ${user}`);
/** 按 SQL 形状命名（同一形状会在多个 surface 里重复出现，去重后不能借用 surface 标签）。 */
function shapeLabel(sql) {
  if (/FROM oidc_session/i.test(sql)) return '（会话查询·鉴权开销）';
  if (/COUNT\(\*\)/i.test(sql) && /GROUP BY/i.test(sql)) return '未读数（?by=category）';
  if (/COUNT\(\*\)/i.test(sql)) return '未读数（全量）';
  if (/ORDER BY id DESC/i.test(sql)) return /template IN/.test(sql) ? '列表（?category）' : '列表（无类目）';
  if (/^\s*UPDATE/i.test(sql)) return '标已读（UPDATE）';
  return '其它';
}

console.log('\n=== ② 逐形状读量（生产）===');
for (const base of [...new Set([topUser, topUnread])]) {
  console.log(`\n  基准 user_id = ${base}${base === topUnread && base !== topUser ? '（未读最多）' : '（行数最多）'}`);
  console.log('  形状                        读量  行  计划');
  const seen = new Set();
  for (const { sink } of captured) {
    for (const rec of sink) {
      const sql = q(inlineParams(rec.sql, rec.args));
      // 会话查询每次请求都跑（token_hash 与到期时刻两处字面量每次都不同），按「掩掉时间戳」去重。
      const key = /FROM oidc_session/i.test(sql) ? sql.replace(/'[^']*T[^']*Z'/g, "'<TS>'") : sql;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = shapeLabel(sql);
      const real = withUser(sql, base);
      if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
        console.log(`  ${label.padEnd(26)}（写语句，只打计划）${explain(real)}`);
        continue;
      }
      const m = measure(real);
      console.log(
        `  ${label.padEnd(26)}${String(m.rows_read).padStart(5)} ${String(m.n).padStart(3)}  ${explain(real)}`,
      );
    }
  }
}

// ── ④ 对照：把 IN 列表换成「同一形状但只一个模板」，看 IN 的槽数是否影响路径 ──────────────────
// 若两者计划与读量一致，说明模板 IN 是残差谓词（不影响访问路径）⇒ 加索引买不到东西。
const listSql = q(
  (captured.find((c) => c.label.startsWith('列表（?category'))?.sink ?? [])
    .map((r) => q(inlineParams(r.sql, r.args)))
    .find((s) => /FROM notifications/i.test(s) && /ORDER BY/i.test(s)) ?? '',
);
if (listSql) {
  console.log('\n=== ③ 对照：模板 IN 槽数 9 → 1 ===');
  for (const base of [...new Set([topUser, topUnread])]) {
    const one = withUser(listSql.replace(/template IN \([^)]*\)/, "template IN ('offer_received')"), base);
    const m1 = measure(one);
    console.log(`  user_id=${base}  ${String(m1.rows_read).padStart(5)} ${String(m1.n).padStart(3)}  ${explain(one)}`);
  }
}

// ── ⑤ 对照：排序键 ≠ 筛选键（ORDER BY created_at 而非 id）─────────────────────────────────────
// 线上契约固定按 id DESC（索引 idx_notifications_user 的次列），这里只量「若将来改成按时间排」
// 的代价：created_at 不在该索引里，早停失效，看读量会不会翻上去 ⇒ 支撑「不建 (user_id,template,id)」。
if (listSql && /ORDER BY id DESC/i.test(listSql)) {
  console.log('\n=== ⑤ 对照：排序键换成 created_at（线上不这么排，只看代价）===');
  for (const base of [...new Set([topUser, topUnread])]) {
    const byTime = withUser(listSql.replace(/ORDER BY id DESC/i, 'ORDER BY created_at DESC'), base);
    const m = measure(byTime);
    console.log(`  user_id=${base}  ${String(m.rows_read).padStart(5)} ${String(m.n).padStart(3)}  ${explain(byTime)}`);
  }
}
