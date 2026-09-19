import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { getAuthUser, isOidc, isStaleOidcSession } from '../lib/session.ts';
import { OIDC_PROBE_COOKIE, OIDC_SESSION_COOKIE } from '../lib/oidc.ts';
import clubsRoutes from './routes/clubs.ts';
import playersRoutes from './routes/players.ts';
import registrationRoutes from './routes/registration.ts';
import seasonsRoutes from './routes/seasons.ts';
import marketRoutes from './routes/market.ts';
import transfersRoutes from './routes/transfers.ts';
import negotiationRoutes from './routes/negotiations.ts';
import growthRoutes from './routes/growth.ts';
import notificationsRoutes from './routes/notifications.ts';
import adminRoutes from './routes/admin/index.ts';
import authRoutes from './routes/auth.ts';
import { settleOverdue } from './market-settle.ts';
import { dispatchPendingNotifications } from './notify.ts';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', clubsRoutes);
app.route('/api', playersRoutes);
app.route('/api', registrationRoutes);
app.route('/api', seasonsRoutes);
app.route('/api', marketRoutes);
app.route('/api', transfersRoutes);
app.route('/api/negotiations', negotiationRoutes);
app.route('/api', growthRoutes);
app.route('/api', notificationsRoutes);
app.route('/api', authRoutes);
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
  const expected = c.env.CRON_KEY;
  if (expected) {
    const provided = c.req.header('X-Cron-Key') ?? c.req.query('key');
    if (provided !== expected) throw new HttpError(403, 'cron 密钥不对');
  }
  return c.json(await runSettleTick(c.env));
});

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

export { app };

// 惰性结算统一入口（§6.5）：cron 与手动 tick 共用；幂等可重入
async function runSettleTick(env: Env) {
  const summary = await settleOverdue(env);
  // bot 通知重试（§12）：失败留 pending，下轮再投
  const notify = await dispatchPendingNotifications(env);
  return { ok: true, ...summary, notify };
}

export default {
  fetch: app.fetch,
  // cron 兜底（wrangler.jsonc triggers */5）：扫描/结算全部挂牌状态机
  scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runSettleTick(env));
  },
};
