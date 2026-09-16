// 旁路转会入口路由（附录 A〔5〕，👤=登录教练）：
// POST /api/transfers/rc-change    续约（改违约金，±10/±50%）
// POST /api/transfers/termination  解约（效力≥3年免费）
// POST /api/transfers/free-agent   海捞（新 RC 不设限，签入费=新 RC×30%）
// POST /api/transfers/activation   激活（训练营 5m / 普通倍数价，5 分钟首价窗）
// POST /api/transfers/match        匹配（新 RC > 首价 + 差额销毁；不带金额 = 放行）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach, type SessionUser } from '../../lib/session.ts';
import { getBoundClub, assertTradable } from '../binding.ts';
import { createRcChange, createTermination, createFreeAgent } from '../bypass.ts';
import { createActivation, submitMatch } from '../activations.ts';

const app = new Hono<{ Bindings: Env }>();

async function requireCoachClub(env: Env, request: Request): Promise<{ user: SessionUser; clubId: number }> {
  const user = await requireCoach(env, request, 'club.squad.manage');
  const club = await getBoundClub(env, user.id);
  if (!club) throw new HttpError(403, '你还没有绑定俱乐部，先找管理组拿认证码');
  assertTradable(club);
  return { user, clubId: club.id };
}

async function readJson(c: { req: { raw: Request } }): Promise<Record<string, unknown> | null> {
  return (await c.req.raw.json().catch(() => null)) as Record<string, unknown> | null;
}

app.post('/transfers/rc-change', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await createRcChange(c.env, clubId, user.id, body?.playerId, body?.newReleaseFee);
  return c.json(result, 201);
});

app.post('/transfers/termination', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await createTermination(c.env, clubId, user.id, body?.playerId);
  return c.json(result, 201);
});

app.post('/transfers/free-agent', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await createFreeAgent(c.env, clubId, user.id, body?.playerId, body?.newReleaseFee);
  return c.json(result, 201);
});

app.post('/transfers/activation', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await createActivation(c.env, clubId, user.id, body?.playerId);
  return c.json(result, 201);
});

app.post('/transfers/match', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await submitMatch(c.env, clubId, user.id, body?.listingId, body?.newReleaseFee);
  return c.json(result, 201);
});

export default app;
