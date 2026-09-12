import { Hono } from 'hono';
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { getAuthUser } from '../lib/session.ts';
import clubsRoutes from './routes/clubs.ts';
import playersRoutes from './routes/players.ts';
import registrationRoutes from './routes/registration.ts';
import adminRoutes from './routes/admin.ts';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', clubsRoutes);
app.route('/api', playersRoutes);
app.route('/api', registrationRoutes);
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

// 登录态（附录 A）：user=null 即未登录；must_change_pw 照常返回此人，由前端引导回赛事系统
app.get('/api/me', async (c) => {
  const user = await getAuthUser(c.env, c.req.raw);
  return c.json({ user });
});

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

export { app };

export default {
  fetch: app.fetch,
  // 惰性结算 cron 兜底（§6.5）：扫描/结算随增量 3+ 落地，当前为占位
  scheduled() {},
};
