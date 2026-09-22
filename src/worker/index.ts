import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { assertCronKey, purgePublicCaches, waitUntilOf } from '../lib/guard.ts';
import { scopesForWritePath } from '../lib/cache-policy.ts';
import { getAuthUser, isOidc, isStaleOidcSession } from '../lib/session.ts';
import { OIDC_PROBE_COOKIE, OIDC_SESSION_COOKIE } from '../lib/oidc.ts';
import clubsRoutes from './routes/clubs.ts';
import playersRoutes, { countPlayers } from './routes/players.ts';
import registrationRoutes from './routes/registration.ts';
import seasonsRoutes from './routes/seasons.ts';
import marketRoutes from './routes/market.ts';
import transfersRoutes from './routes/transfers.ts';
import negotiationRoutes from './routes/negotiations.ts';
import growthRoutes from './routes/growth.ts';
import squadsRoutes from './routes/squads.ts';
import notificationsRoutes from './routes/notifications.ts';
import adminRoutes from './routes/admin/index.ts';
import authRoutes from './routes/auth.ts';
import mediaRoutes from './routes/media.ts';
import { settleOverdue, type SettleSummary } from './market-settle.ts';
import { dispatchPendingNotifications } from './notify.ts';
import { autoConfirmResults } from './results.ts';

const app = new Hono<{ Bindings: Env }>();

// 公开读缓存的中心化失效挂钩（增量 28）：**必须注册在路由之前**——Hono 的 compose 里路由
// 返回响应就结束链路，注册在后面的中间件根本不会执行。
// 不在 27 个含写语句的文件里逐个接 purge：散接必漏，而漏接的代价是「列表最长陈旧 1h、
// 名册/目录 24h」（兜底 TTL 自愈，有界但不新鲜）。判据只看「非 GET/HEAD + 响应 2xx +
// 路径前缀命中」，宁可多 purge（一次 KV 写）不可漏；失败/非 2xx 的写没改数据，不 purge。
app.use('/api/*', async (c, next) => {
  await next();
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return;
  if (c.res.status < 200 || c.res.status >= 300) return;
  if (scopesForWritePath(new URL(c.req.url).pathname).length === 0) return;
  const task = purgePublicCaches(c.env).catch(() => {});
  const ctx = waitUntilOf(c);
  if (ctx) ctx.waitUntil(task);
  else await task;
});

app.route('/api', clubsRoutes);
app.route('/api', playersRoutes);
app.route('/api', registrationRoutes);
app.route('/api', seasonsRoutes);
app.route('/api', marketRoutes);
app.route('/api', transfersRoutes);
app.route('/api/negotiations', negotiationRoutes);
app.route('/api', growthRoutes);
// 全平台一线队名册（增量 33）：赛事系统拉取同步的契约面，只读
app.route('/api', squadsRoutes);
app.route('/api', notificationsRoutes);
app.route('/api', authRoutes);
// 媒体读取（增量 31）：镜像比赛系统的公开媒体路由，只读不写、不碰 D1（队徽/封面图同源取）
app.route('/api/media', mediaRoutes);
app.route('/api/admin', adminRoutes);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    const body: Record<string, string> = { error: err.message };
    if (err.code) body.code = err.code;
    return new Response(JSON.stringify(body), {
      status: err.status,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  }
  console.error('[api] 未处理错误:', err);
  return c.json({ error: '服务器出了点问题，请稍后再试' }, 500);
});

// 三资源可达性（附录 A）：D1 平台库 / TOUR_DB / 共享 KV
app.get('/api/health', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  try {
    await c.env.DB.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').first();
    checks.d1 = 'ok';
  } catch {
    checks.d1 = 'error';
  }
  try {
    await c.env.TOUR_DB.prepare('SELECT id FROM user LIMIT 1').first();
    checks.tour_db = 'ok';
  } catch {
    checks.tour_db = 'error';
  }
  try {
    await c.env.SESSION_KV.get('health:ping');
    checks.kv = 'ok';
  } catch {
    checks.kv = 'error';
  }
  const ok = Object.values(checks).every((v) => v === 'ok');
  return c.json({ ok, checks }, ok ? 200 : 503);
});

// 登录态（附录 A）：user=null 即未登录；must_change_pw 照常返回此人，由前端引导改密。
// authMode 告知前端登录入口走哪条路（oidc=认证中心 /auth/login，shared=跳赛事系统）；
// authHome 是认证中心地址（改密横幅直链用），兼容模式为 null。
// syncProbe：匿名 + oidc 模式 + 不在探测冷却期 → 前端自动跳 /api/auth/sync 无感同步登录态
// （进站即探测；SPA 页面请求直达静态资源，探测只能由前端发起，冷却标记防循环）
app.get('/api/me', async (c) => {
  const user = await getAuthUser(c.env, c.req.raw);
  const probeCooling = Boolean(getCookie(c, OIDC_PROBE_COOKIE));
  // stale 会话 cookie（行已撤销/过期）：顺手清掉，浏览器侧同步瘦身
  if (!user && (await isStaleOidcSession(c.env, c.req.raw))) {
    deleteCookie(c, OIDC_SESSION_COOKIE, { path: '/', secure: true });
  }
  return c.json({
    user,
    authMode: isOidc(c.env) ? 'oidc' : 'shared',
    authHome: isOidc(c.env) ? c.env.OIDC_ISSUER : null,
    syncProbe: !user && isOidc(c.env) && !probeCooling ? true : undefined,
  });
});

// 手动触发惰性结算（附录 A 内部端点）：X-Cron-Key 对不上 403；本地未配 secret 时放行便于联调
app.post('/api/cron/tick', async (c) => {
  assertCronKey(c);
  return c.json(await runSettleTick(c.env));
});

// 内部计数端点（增量 28）：公开列表去掉 total 后（每次请求多跑一条 18,763 行的整表 COUNT），
// 这个口径留给运维/对账。守卫比 tick 更严——**未配 CRON_KEY 就拒绝**，且只认 X-Cron-Key 头
// （GET 带 ?key= 会把密钥写进访问日志）：这个端点每次调用都是整表 COUNT，放行等于公开一个读放大器。
// 不进公开缓存、不挂公开限流。生产已于 2026-09-22 配好 CRON_KEY（此前 tick 是 fail-open 的）。
app.get('/api/cron/players-count', async (c) => {
  assertCronKey(c, { allowUnset: false, queryKey: false });
  return c.json({ count: await countPlayers(c) });
});

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

export { app };

// 惰性结算统一入口（§6.5）：cron 与手动 tick 共用；幂等可重入
async function runSettleTick(env: Env) {
  const summary = await settleOverdue(env);
  // 赛果自动确认（增量 21）：完赛场次逐场入档，异常标人工；开关/上限在 results.ts
  const autoResults = await autoConfirmResults(env);
  // bot 通知重试（§12）：失败留 pending，下轮再投
  const notify = await dispatchPendingNotifications(env);
  return { ok: true, ...summary, autoResults, notify };
}

// tick 是否真的动了**公开数据**（增量 28 的 purge 判据）：只看 settleOverdue 的
// {settled,delisted,voided,notesUpdated,healed}——挂牌结算会写 contracts / players.club_id，
// 正是列表的合同列与名册的俱乐部归属。**刻意不看 notify 与 autoResults**：前者只写 notifications、
// 后者只写 result_confirmations，都不在公开 scope 里，算进来会让每个 tick 都可能白 purge 一次，
// 而每次 purge 之后第一个名册请求就要全表扫 18301 行（288 次/天 ≈ 527 万行，单这一项就吃掉免费档）。
// tick 每 5 分钟一次、空跑占多数，空跑还 purge 等于白付一次 KV 写并让名册重新全表扫。
function tickChanged(summary: SettleSummary): boolean {
  return (
    summary.settled > 0 ||
    summary.delisted > 0 ||
    summary.voided > 0 ||
    summary.notesUpdated > 0 ||
    summary.healed > 0
  );
}

export default {
  fetch: app.fetch,
  // cron 兜底（wrangler.jsonc triggers */5）：扫描/结算全部挂牌状态机
  scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      runSettleTick(env).then(async (summary) => {
        if (!tickChanged(summary)) return;
        await purgePublicCaches(env).catch(() => {});
      }),
    );
  },
};
