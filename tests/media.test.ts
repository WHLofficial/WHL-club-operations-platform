// 增量 31：媒体读取路由（镜像比赛系统的公开媒体路由）——白名单、R2 未命中、长缓存头、边缘缓存旁路。
// 本路由是球队页唯一的零 D1 读面，测试里不建任何库：env 只给 MEDIA 桶。
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';

const PNG = 'PNG-BYTES';

function fakeBucket(keys: string[]): { bucket: R2Bucket; reads: string[] } {
  const reads: string[] = [];
  const bucket = {
    async get(key: string) {
      reads.push(key);
      if (!keys.includes(key)) return null;
      return {
        httpEtag: `"etag:${key}"`,
        writeHttpMetadata(headers: Headers) {
          headers.set('content-type', 'image/png');
        },
        async arrayBuffer() {
          return new TextEncoder().encode(PNG).buffer as ArrayBuffer;
        },
      };
    },
  } as unknown as R2Bucket;
  return { bucket, reads };
}

function envWith(bucket: R2Bucket): Env {
  // 媒体路由只读 MEDIA；/api/* 的 purge 中间件对 GET 直接放行，不需要 DB/KV
  return { MEDIA: bucket } as unknown as Env;
}

async function get(path: string, bucket: R2Bucket): Promise<Response> {
  return app.request(`http://localhost${path}`, { method: 'GET' }, envWith(bucket));
}

const G = globalThis as unknown as { caches?: unknown };
const realCaches = G.caches;

afterEach(() => {
  if (realCaches === undefined) delete G.caches;
  else G.caches = realCaches;
});

describe('GET /api/media/*（增量 31）', () => {
  it('白名单内的 key 从 R2 取出，带 immutable 长缓存与 ETag', async () => {
    const { bucket, reads } = fakeBucket(['team/12/1712345678.png']);
    const res = await get('/api/media/team/12/1712345678.png', bucket);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PNG);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toBe('"etag:team/12/1712345678.png"');
    expect(reads).toEqual(['team/12/1712345678.png']);
  });

  it('tournament/ 前缀同样放行', async () => {
    const { bucket } = fakeBucket(['tournament/7/cover.webp']);
    const res = await get('/api/media/tournament/7/cover.webp', bucket);
    expect(res.status).toBe(200);
  });

  it('白名单外的 key 一律 404，且不碰 R2', async () => {
    const { bucket, reads } = fakeBucket(['secret/1/x.png', 'team/abc/x.png']);
    for (const path of ['/api/media/secret/1/x.png', '/api/media/team/abc/x.png', '/api/media/team/12', '/api/media/']) {
      const res = await get(path, bucket);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    expect(reads).toEqual([]); // 未过白名单连桶都不查
  });

  it('路径穿越写法不会解析到桶外对象（R2 按字面 key 取，不做路径归一）', async () => {
    // 桶里只有正常的 secret/1/x.png；`%2e%2e%2f` 在 URL 里是编码态、不被归一，
    // decodeURIComponent 后是一个字面 key `team/12/../../secret/1/x.png`——R2 里不存在这样的对象。
    const { bucket, reads } = fakeBucket(['secret/1/x.png']);
    const res = await get('/api/media/team/12/%2e%2e%2f%2e%2e%2fsecret/1/x.png', bucket);
    expect(res.status).toBe(404);
    expect(reads).toEqual(['team/12/../../secret/1/x.png']);
  });

  it('白名单内但桶里没有 → 404', async () => {
    const { bucket, reads } = fakeBucket([]);
    const res = await get('/api/media/team/99/none.png', bucket);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(reads).toEqual(['team/99/none.png']);
  });

  it('残缺百分号编码与超长 key 都是 404，不是 500', async () => {
    // decodeURIComponent('team/%zz/x.png') 抛 URIError：匿名请求不该拿到 500 + 错误日志
    const { bucket, reads } = fakeBucket(['team/1/a.png']);
    expect((await get('/api/media/team/%zz/x.png', bucket)).status).toBe(404);
    // R2 key 上限 1024 字节
    expect((await get(`/api/media/team/1/${'a'.repeat(1100)}`, bucket)).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('无 Cache API 的环境（node/vitest）静默旁路，不影响取图', async () => {
    delete G.caches;
    const { bucket } = fakeBucket(['team/1/a.png']);
    expect((await get('/api/media/team/1/a.png', bucket)).status).toBe(200);
  });

  it('边缘缓存命中时直接返回，不再读 R2', async () => {
    const cached = new Response(PNG, { headers: { 'content-type': 'image/png', 'x-from': 'cache' } });
    const put: string[] = [];
    const matched: string[] = [];
    G.caches = {
      default: {
        async match(url: string) {
          matched.push(url);
          return cached.clone();
        },
        async put(url: string) {
          put.push(url);
        },
      },
    };
    const { bucket, reads } = fakeBucket(['team/1/a.png']);
    const res = await get('/api/media/team/1/a.png', bucket);

    expect(res.headers.get('x-from')).toBe('cache');
    expect(reads).toEqual([]);
    expect(put).toEqual([]);
    // 键就是请求 URL：路由不读会话，响应不随身份变化，所以不需要分身份缓存
    expect(matched).toEqual(['http://localhost/api/media/team/1/a.png']);
  });

  it('R2 未命中时 404 不进边缘缓存（否则一次手滑会把缺图缓存一年）', async () => {
    const put: string[] = [];
    G.caches = {
      default: {
        async match() {
          return undefined;
        },
        async put(url: string) {
          put.push(url);
        },
      },
    };
    const { bucket } = fakeBucket([]);
    const res = await get('/api/media/team/9/none.png', bucket);

    expect(res.status).toBe(404);
    expect(put).toEqual([]);
  });

  it('边缘缓存未命中时回填缓存（走 waitUntil，不阻塞响应）', async () => {
    const put: string[] = [];
    G.caches = {
      default: {
        async match() {
          return undefined;
        },
        async put(url: string) {
          put.push(url);
        },
      },
    };
    const { bucket } = fakeBucket(['team/1/a.png']);
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(p: Promise<unknown>) {
        pending.push(p);
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext;
    const res = await app.request(
      'http://localhost/api/media/team/1/a.png',
      { method: 'GET' },
      envWith(bucket),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(pending).toHaveLength(1); // 回填登记在 waitUntil 上，响应不等它
    await Promise.all(pending);
    expect(put).toEqual(['http://localhost/api/media/team/1/a.png']);
  });
});
