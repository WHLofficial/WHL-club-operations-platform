// 签约谈判路由（附录 A〔4〕，👤=登录教练；操作限签入方俱乐部）
// GET /api/negotiations?mine=1            我的谈判会话（含已结束，LIMIT 50）
// POST /api/negotiations/:transferId/release-fee   提交新 RC（返回 E 数值，仅签入方）
// POST /api/negotiations/:sessionId/offer          工资报价（满意度文案返回）
// POST /api/negotiations/:sessionId/trainee        直签训练营合同（不占下放名额）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach, type SessionUser } from '../../lib/session.ts';
import { getBoundClub, assertTradable } from '../binding.ts';
import { chooseTrainee, listMySessions, offerWage, submitReleaseFee } from '../negotiations.ts';

const app = new Hono<{ Bindings: Env }>();

// 谈判入口共用件：ban 只拦提交动作，GET 我的会话不受禁令影响（能看不能谈）
async function requireCoachClub(env: Env, request: Request): Promise<{ user: SessionUser; clubId: number }> {
  const user = await requireCoach(env, request, 'club.squad.manage');
  const club = await getBoundClub(env, user.id);
  if (!club) throw new HttpError(403, '你还没有绑定俱乐部，先找管理组拿认证码');
  return { user, clubId: club.id };
}

async function requireTradableCoachClub(env: Env, request: Request): Promise<{ user: SessionUser; clubId: number }> {
  const ctx = await requireCoachClub(env, request);
  const club = await getBoundClub(env, ctx.user.id);
  if (club) assertTradable(club);
  return ctx;
}

app.get('/', async (c) => {
  const { clubId } = await requireCoachClub(c.env, c.req.raw);
  if (c.req.query('mine') !== '1') throw new HttpError(400, '只支持 ?mine=1 查自己的谈判');
  return c.json({ sessions: await listMySessions(c.env, clubId) });
});

app.post('/:transferId/release-fee', async (c) => {
  const { user, clubId } = await requireTradableCoachClub(c.env, c.req.raw);
  const transferId = Number(c.req.param('transferId'));
  if (!Number.isInteger(transferId)) throw new HttpError(400, '转会单 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { fee?: unknown } | null;
  const result = await submitReleaseFee(c.env, transferId, clubId, user.id, body?.fee);
  return c.json(result);
});

app.post('/:sessionId/offer', async (c) => {
  const { user, clubId } = await requireTradableCoachClub(c.env, c.req.raw);
  const sessionId = Number(c.req.param('sessionId'));
  if (!Number.isInteger(sessionId)) throw new HttpError(400, '谈判会话 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { wage?: unknown } | null;
  return c.json(await offerWage(c.env, sessionId, clubId, user.id, body?.wage));
});

app.post('/:sessionId/trainee', async (c) => {
  const { user, clubId } = await requireTradableCoachClub(c.env, c.req.raw);
  const sessionId = Number(c.req.param('sessionId'));
  if (!Number.isInteger(sessionId)) throw new HttpError(400, '谈判会话 ID 不对');
  return c.json(await chooseTrainee(c.env, sessionId, clubId, user.id));
});

export default app;
