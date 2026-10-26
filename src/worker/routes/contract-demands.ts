// 闹涨薪（球员主动要求续约/涨薪）教练端路由（v6.54.0 步骤 4，设计 §7 API 表）：
// GET  /api/club/contract-demands             收件箱三组 + wageContext（只对本俱乐部）
// POST /api/club/contract-demands/:id/accept  接受 target + rc_floor（写 pending 变更，不收费）
// POST /api/club/contract-demands/:id/counter 还价 { wage }（同请求即时判定并返回结果）
// POST /api/club/contract-demands/:id/preview 还价档位预览（零副作用：不落库/不耗轮次/不审计）
// POST /api/club/contract-demands/:id/reject  直拒（明确放人，§5.4 三件套在引擎侧同批落）
// GET  /api/club/transfer-requests            存续转会申请（含「不满」徽章 released）
// 客户端只传 demand id 与 counter wage；player_id / target_wage 一律取服务端行（§7 明令）。
// 权限 = requireCoach + 本俱乐部绑定；不挂 assertTradable——闹涨薪是球员发起的合同对话，
// 不是经理发起的市面动作（转会禁令拦的是挂牌/出价/激活/续约/解约那一族，见 binding.ts 清单）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach, type SessionUser } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';
import {
  acceptDemand,
  counterDemand,
  listClubDemands,
  listClubTransferRequests,
  previewDemand,
  rejectDemand,
} from '../demand-ops.ts';

const app = new Hono<{ Bindings: Env }>();

async function requireCoachClub(env: Env, request: Request): Promise<{ user: SessionUser; clubId: number }> {
  const user = await requireCoach(env, request, 'club.squad.manage');
  const club = await getBoundClub(env, user.id, request);
  if (!club) throw new HttpError(403, '你还没有绑定俱乐部，先找管理组拿认证码');
  return { user, clubId: club.id };
}

function demandIdOf(c: { req: { param(name: string): string } }): number {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '要求 ID 不对');
  return id;
}

// 设计 §7 建议的「GET 按俱乐部缓存 5s」不在服务端落：cachedJson 的 L1/SWR 窗口会在
// accept/counter 写后 ≤5s 回陈旧卡面（「接受后卡必须立刻翻页」是本收件箱的硬要求），
// 而 cachedJson 没有按键失效 API；三条查询全走索引（idx_contract_demands_club_status /
// UNIQUE(demand_id, round) / idx_pending_club_status），量级 = 单队条数，缓存无收益。
// 新鲜度由前端 TanStack Query 写后精确 invalidate 承担（前端步骤接线）。
app.get('/club/contract-demands', async (c) => {
  const { clubId } = await requireCoachClub(c.env, c.req.raw);
  return c.json(await listClubDemands(c.env, clubId));
});

app.post('/club/contract-demands/:id/accept', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  return c.json(await acceptDemand(c.env, { demandId: demandIdOf(c), clubId, actor: user.id, origin: 'user' }));
});

app.post('/club/contract-demands/:id/counter', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = (await c.req.raw.json().catch(() => null)) as { wage?: unknown } | null;
  // 只认 body.wage；混进来的 playerId/targetWage 等字段一律忽略（§7：不接受客户端传 player_id/target_wage）
  return c.json(
    await counterDemand(c.env, {
      demandId: demandIdOf(c),
      clubId,
      wage: body?.wage as number, // 运行时由引擎校验（>0、≤wageMax），垃圾值落 400
      actor: user.id,
      origin: 'user',
    }),
  );
});

app.post('/club/contract-demands/:id/preview', async (c) => {
  const { clubId } = await requireCoachClub(c.env, c.req.raw);
  const body = (await c.req.raw.json().catch(() => null)) as { wage?: unknown } | null;
  return c.json(await previewDemand(c.env, demandIdOf(c), clubId, body?.wage));
});

app.post('/club/contract-demands/:id/reject', async (c) => {
  const { user, clubId } = await requireCoachClub(c.env, c.req.raw);
  return c.json(await rejectDemand(c.env, { demandId: demandIdOf(c), clubId, actor: user.id, origin: 'user' }));
});

app.get('/club/transfer-requests', async (c) => {
  const { clubId } = await requireCoachClub(c.env, c.req.raw);
  return c.json(await listClubTransferRequests(c.env, clubId));
});

export default app;
