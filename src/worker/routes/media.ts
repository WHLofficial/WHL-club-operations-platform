// 媒体读取（v3.4.0）：镜像比赛系统的公开媒体路由
// （`WHL-tournament-management-system/worker/routes/media.ts`），**公开面只读不写**——
// 队徽/封面图全部由比赛系统上传，本平台按 key 取。
//
// 为什么走本域而不是直连比赛系统域名：R2 桶 `whl-media` 已绑定本 Worker（`MEDIA`），
// 同源取图省一次跨站请求与 DNS，也没有 CORS / 混内容问题。
//
// 读面：边缘缓存（同 PoP 命中即返）→ R2。**GET 路由不碰任何 D1**，是球队页里唯一的零 D1 读面。
//
// v6.4.0 改动 4：新增唯一一个写端点 POST /api/media/activation（激活通知证据截图，教练鉴权、
// key 服务端生成、限图片类型与 5MB）。公开 GET 白名单随之放行 activation/ 前缀——
// 被激活方与管理端要能直接看到这张截图，别的用途仍不吐。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';
import { writeAudit } from '../../lib/audit.ts';
import { waitUntilOf } from '../../lib/guard.ts';

const app = new Hono<{ Bindings: Env }>();

// key 白名单与比赛系统逐字一致：key 全部由服务端生成，前缀只有 team/ 与 tournament/，
// 第三段是数字 id（v6.4.0 起 activation/<clubId>/ 由本平台自己写，也进白名单）。
// 不放行任意 key——桶里将来混入别的用途的对象，也不该由公开端点吐出。
const KEY_PATTERN = /^(team|tournament|activation)\/\d+\//;

// 激活证据截图上限：5MB 足够任何 QQ 截图，也封死滥用空间
const ACTIVATION_PROOF_MAX_BYTES = 5 * 1024 * 1024;
const ACTIVATION_PROOF_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// 版本化 key（换图即换 URL）内容永不变 ⇒ 可长缓存。jsdom/node 里没有 caches，静默旁路。
function edgeCacheAvailable(): boolean {
  return typeof caches !== 'undefined' && Boolean(caches) && 'default' in caches;
}

// POST /api/media/activation —— 激活通知证据截图上传（v6.4.0 改动 4，仅本队教练）。
// body = 图片原始字节（Content-Type 须为 png/jpeg/webp）；key 服务端生成
// `activation/<clubId>/<ts36>-<rand8>.<ext>`，客户端只回传 key，不指定路径。
// R2 免费档写 100 万次/月：激活是低频动作，用量差几个数量级，不触碰额度。
app.post('/activation', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  const contentType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = ACTIVATION_PROOF_TYPES[contentType];
  if (!ext) throw new HttpError(400, '截图只支持 png / jpg / webp');
  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength === 0) throw new HttpError(400, '截图内容为空');
  if (bytes.byteLength > ACTIVATION_PROOF_MAX_BYTES) throw new HttpError(400, '截图超过 5MB 上限，压缩后再传');
  const rand = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  const key = `activation/${club.id}/${Date.now().toString(36)}-${rand}.${ext}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'activation_proof_upload',
    targetType: 'media',
    targetId: null,
    origin: 'user',
    after: { key, bytes: bytes.byteLength },
  });
  return c.json({ key }, 201);
});

// 错误形状沿用比赛系统的机器 token `not_found`（前端只判状态码，不看文案）——不改成仓库别处的
// 中文文案，是为了让两边的 media 路由逐字可比。
//
// 不加 assertPublicRate：这里零 D1 读、命中边缘缓存后连 R2 都不打，而限流是 60/min/IP，
// 球队列表一屏就要取 20 个队徽，加上去等于把正常浏览打成 429（比赛系统的 media 路由同样不限流）。
app.get('/*', async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(c.req.path.replace(/^\/api\/media\//, ''));
  } catch {
    // 残缺百分号编码（/api/media/team/%zz/x.png）会让 decodeURIComponent 抛 URIError，
    // 不接住就是匿名请求可触发的 500 + 错误日志刷屏
    return c.json({ error: 'not_found' }, 404);
  }
  // R2 的 key 上限 1024 字节，白名单不约束长度
  if (key.length > 1024 || !KEY_PATTERN.test(key)) return c.json({ error: 'not_found' }, 404);

  const useCache = edgeCacheAvailable();
  if (useCache) {
    const hit = await caches.default.match(c.req.url).catch(() => undefined);
    if (hit) return hit;
  }

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'not_found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  const res = new Response(await obj.arrayBuffer(), { headers });
  // 回填边缘缓存不阻塞响应；测试里没有 executionCtx（waitUntilOf 回 undefined）就跳过
  if (useCache) waitUntilOf(c)?.waitUntil(caches.default.put(c.req.url, res.clone()).catch(() => {}));
  return res;
});

export default app;
