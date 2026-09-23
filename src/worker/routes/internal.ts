// 机器通道入站（增量 37）：赛事系统建队后推过来，在本仓建俱乐部行。
// 挂 /api/internal，**不走会话**（没有管理员身份），只认 HMAC 签名；未配密钥一律 503（写端点 fail-closed）。
// 出站方向见 tourClient.ts；两侧契约对称：POST /api/internal/team-upsert，body { id, name }。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { verifyTeamSync } from '../../lib/hmac.ts';
import { createClubFromTourTeam } from './admin/clubs.ts';

const app = new Hono<{ Bindings: Env }>();

const NAME_MAX = 40;

app.post('/team-upsert', async (c) => {
  // 先取原文再验签：签名吃的是字节，重新 JSON.stringify 会改掉键序/空白
  const raw = await c.req.text();
  const verdict = await verifyTeamSync(
    c.env.TEAM_SYNC_SECRET,
    new URL(c.req.url).pathname,
    raw,
    c.req.header('x-timestamp') ?? null,
    c.req.header('x-sign') ?? null,
  );
  if (verdict === 'unconfigured') {
    return c.json({ error: 'unconfigured', message: '本仓未配置 TEAM_SYNC_SECRET，拒绝机器写入' }, 503);
  }
  if (verdict === 'reject') return c.json({ error: 'bad_signature', message: '签名校验失败' }, 403);

  let body: { id?: unknown; name?: unknown };
  try {
    body = JSON.parse(raw) as { id?: unknown; name?: unknown };
  } catch {
    return c.json({ error: 'bad_json', message: '请求体不是合法 JSON' }, 400);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'bad_id', message: '游戏球队 ID 应为正整数（与游戏内球队编号一致）' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) {
    return c.json({ error: 'bad_name', message: `俱乐部名字不能为空，且不超过 ${NAME_MAX} 个字` }, 400);
  }

  // 幂等：本仓已有这号就只回报，不覆写。名字不一致留给对账页显示——静默改名会让
  // 「谁的名字是对的」变成一次推送的副作用，改名不联动（增量 37 边界）。
  const existing = await c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string }>();
  if (existing) {
    return c.json({ ok: true, created: false, name: existing.name, nameDiffers: existing.name !== name });
  }

  try {
    const created = await createClubFromTourTeam(c.env, { gameTeamId: id, name, operator: null });
    console.log(`[internal] team-upsert id=${id} name=${name} authLinked=${created.authLinked}`);
    return c.json({ ok: true, created: true, ...created }, 201);
  } catch (e) {
    // 名字被别的队占了之类：回报让赛事仓把「同步失败」记到界面上，不在这里改别人的名字。
    // 手搓 Response 而非 c.json：全局 onError 的 body 只有 {error}，没有 message——
    // 而赛事仓的推送客户端就是靠 message 把原因显示给人看的。
    if (e instanceof HttpError) {
      return new Response(JSON.stringify({ error: 'rejected', message: e.message }), {
        status: e.status,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });
    }
    throw e;
  }
});

export default app;
