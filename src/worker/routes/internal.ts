// 机器通道入站（v6.1.0）：赛事系统建队后推过来，在本仓建俱乐部行。
// 挂 /api/internal，**不走会话**（没有管理员身份），只认 HMAC 签名；未配密钥一律 503（写端点 fail-closed）。
// 出站方向见 tourClient.ts；两侧契约对称：POST /api/internal/team-upsert，body { id, name }。
//
// v6.44.0 追加天气同步入站（POST /api/internal/weather-sync，插件侧天气真源 → match_weather）：
// 同一套签名口径（lib/hmac.ts 的规范串 `POST|path|ts|raw`、±300s 窗口），但用**独立密钥**
// WEATHER_SYNC_SECRET——两把钥匙开两个端点，插件只需知道天气这一把。落库逻辑在 weather-ops.ts。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { verifyTeamSync } from '../../lib/hmac.ts';
import { createClubFromTourTeam } from './admin/clubs.ts';
import { applyWeatherPush, parseWeatherPush, WEATHER_SYNC_PATH } from '../weather-ops.ts';

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
  // 「谁的名字是对的」变成一次推送的副作用，改名不联动（v6.1.0 边界）。
  const existing = await c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string }>();
  if (existing) {
    return c.json({ ok: true, created: false, name: existing.name, nameDiffers: existing.name !== name });
  }

  try {
    const created = await createClubFromTourTeam(c.env, { gameTeamId: id, name, operator: null, origin: 'machine' });
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

// 天气同步入站（v6.44.0）：插件侧按轮推 { season, competition, roundNo, items[{home,away,weather,coef}] }。
// 验签用独立密钥 WEATHER_SYNC_SECRET（未配 503，同 team-upsert 的 fail-closed 口径）；
// 形状错误 400、赛季没绑赛事 409、单场对不上/无球场走 200 的逐场 verdict（插件把它回显给操作者）。
app.post('/weather-sync', async (c) => {
  // 先取原文再验签：签名吃的是字节，重新 JSON.stringify 会改掉键序/空白
  const raw = await c.req.text();
  const verdict = await verifyTeamSync(
    c.env.WEATHER_SYNC_SECRET,
    WEATHER_SYNC_PATH,
    raw,
    c.req.header('x-timestamp') ?? null,
    c.req.header('x-sign') ?? null,
  );
  if (verdict === 'unconfigured') {
    return c.json({ error: 'unconfigured', message: '本仓未配置 WEATHER_SYNC_SECRET，拒绝机器写入' }, 503);
  }
  if (verdict === 'reject') return c.json({ error: 'bad_signature', message: '签名校验失败' }, 403);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'bad_json', message: '请求体不是合法 JSON' }, 400);
  }
  try {
    const payload = parseWeatherPush(body);
    const result = await applyWeatherPush(c.env, payload);
    console.log(
      `[internal] weather-sync ${result.competition} 第${result.roundNo}轮 pushed=${result.summary.pushed} ` +
        `created=${result.summary.created} replaced=${result.summary.replaced} unmatched=${result.summary.unmatched} ` +
        `skipped=${result.summary.skipped_no_stadium} settled=${result.summary.settled}`,
    );
    return c.json({ ok: true, ...result });
  } catch (e) {
    // 手搓 Response 而非 c.json：全局 onError 的 body 是 {error: err.message, code}，
    // 而插件靠 error/message 把原因显示给人看（error 是机器判据、message 是人话），见 team-upsert 同款注释。
    if (e instanceof HttpError) {
      return new Response(JSON.stringify({ error: e.code ?? 'rejected', message: e.message }), {
        status: e.status,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });
    }
    throw e;
  }
});

export default app;
