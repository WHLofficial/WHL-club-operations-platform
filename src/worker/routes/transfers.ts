// 旁路转会入口路由（附录 A〔5〕，👤=登录教练）：
// POST /api/transfers/rc-change    续约（改违约金，±10/±50%）
// POST /api/transfers/termination  解约（效力≥3年免费）
// POST /api/transfers/free-agent   海捞（新 RC 不设限，签入费=新 RC×30%）
// POST /api/transfers/activation   激活（训练营 5m / 普通倍数价，5 分钟首价窗）
// POST /api/transfers/match        匹配（新 RC > 首价 + 差额销毁；不带金额 = 放行）
// v6.50.0 海捞两阶段·暗标段（同前缀）：
// GET  /api/transfers/sea-sealed           本窗暗标段状态（阶段 + 我的密封标 + 开标公示）
// POST /api/transfers/sea-sealed           出标 / 改标（body {playerId, newReleaseFee}）
// POST /api/transfers/sea-sealed/withdraw  撤标（body {playerId}）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach, type SessionUser } from '../../lib/session.ts';
import { getBoundClub, assertTradable } from '../binding.ts';
import { createRcChange, createTermination, createFreeAgent, cancelOwnTransfer } from '../bypass.ts';
import { createActivation, submitMatch } from '../activations.ts';
import { demotePlayer, promotePlayer } from '../promotion.ts';
import { loadSeaPhaseView, submitSealedBid, withdrawSealedBid } from '../sea-sealed.ts';

const app = new Hono<{ Bindings: Env }>();

async function requireCoachClub(env: Env, request: Request): Promise<{ user: SessionUser; clubId: number }> {
  const user = await requireCoach(env, request, 'club.squad.manage');
  const club = await getBoundClub(env, user.id, request);
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
  const result = await createActivation(c.env, clubId, user.id, body?.playerId, body?.proofMediaKey);
  return c.json(result, 201);
});

app.post('/transfers/match', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await submitMatch(c.env, clubId, user.id, body?.listingId, body?.newReleaseFee);
  return c.json(result, 201);
});

// v6.64.4 上调/下放：下放 = 正式合同一线队球员即时转训练营条款（每窗 2 名额）；
// 上调 = 训练营球员直开签约谈判谈正式合同（F>15 付 (F−15)×0.3 附加费，成约收取）
app.post('/transfers/demote', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await demotePlayer(c.env, clubId, user.id, body?.playerId);
  return c.json(result, 201);
});

app.post('/transfers/promotion', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await promotePlayer(c.env, clubId, user.id, body?.playerId, body?.newReleaseFee);
  return c.json(result, 201);
});

// v6.64.4 自助取消：续约 / 解约 / 上调还没被审核时，教练在球员面板一键取消（解约随单解冻）
app.post('/transfers/cancel', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await cancelOwnTransfer(c.env, clubId, user.id, body?.transferId);
  return c.json(result);
});

// ---- 海捞两阶段·暗标段（v6.50.0；设计见 memory/design-sea-two-phase.md）----
// 明标段（常规海捞）仍是上面那个 POST /api/transfers/free-agent，原样不动；暗标段收标期间它会被 409 拦下。
// 读接口不带 assertTradable：受罚俱乐部也得看得见倒计时与开标公示。
async function requireCoachClubRead(env: Env, request: Request): Promise<{ user: SessionUser; clubId: number }> {
  const user = await requireCoach(env, request, 'club.squad.manage');
  const club = await getBoundClub(env, user.id, request);
  if (!club) throw new HttpError(403, '你还没有绑定俱乐部，先找管理组拿认证码');
  return { user, clubId: club.id };
}

app.get('/transfers/sea-sealed', async (c) => {
  const { clubId } = await requireCoachClubRead(c.env, c.req.raw);
  return c.json(await loadSeaPhaseView(c.env, clubId));
});

app.post('/transfers/sea-sealed', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await submitSealedBid(c.env, clubId, user.id, body?.playerId, body?.newReleaseFee);
  return c.json(result, 201);
});

app.post('/transfers/sea-sealed/withdraw', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = await readJson(c);
  const result = await withdrawSealedBid(c.env, clubId, user.id, body?.playerId);
  return c.json(result);
});

export default app;
