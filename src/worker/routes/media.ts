// 媒体读取（v3.4.0）：镜像比赛系统的公开媒体路由
// （`WHL-tournament-management-system/worker/routes/media.ts`），**只读不写**——
// 队徽/封面图全部由比赛系统上传，本平台按 key 取。
//
// 为什么走本域而不是直连比赛系统域名：R2 桶 `whl-media` 已绑定本 Worker（`MEDIA`），
// 同源取图省一次跨站请求与 DNS，也没有 CORS / 混内容问题。
//
// 读面：边缘缓存（同 PoP 命中即返）→ R2。**本路由不碰任何 D1**，是球队页里唯一的零 D1 读面。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { waitUntilOf } from '../../lib/guard.ts';

const app = new Hono<{ Bindings: Env }>();

// key 白名单与比赛系统逐字一致：key 全部由服务端生成，前缀只有 team/ 与 tournament/，
// 第三段是数字 id。不放行任意 key——桶里将来混入别的用途的对象，也不该由公开端点吐出。
const KEY_PATTERN = /^(team|tournament)\/\d+\//;

// 版本化 key（换图即换 URL）内容永不变 ⇒ 可长缓存。jsdom/node 里没有 caches，静默旁路。
function edgeCacheAvailable(): boolean {
  return typeof caches !== 'undefined' && Boolean(caches) && 'default' in caches;
}

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
