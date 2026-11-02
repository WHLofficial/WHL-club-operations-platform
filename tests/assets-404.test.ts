// v6.69.0：/assets/icons/* 走 Worker（wrangler.jsonc run_worker_first）。SPA 模式下静态绑定
// 对不存在的文件答 200 text/html，图片会静默坏掉还被 immutable 缓存一年；这里要求 Worker
// 把 HTML 回落改判 404，真文件原样透传（缓存头不动）。
import { describe, expect, it } from 'vitest';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';

function envWith(fetchImpl: (req: Request) => Promise<Response>): Env {
  return { ASSETS: { fetch: fetchImpl } } as unknown as Env;
}

describe('/assets/icons/* 404 修复（v6.69.0）', () => {
  it('文件不存在：ASSETS 回落 200 text/html ⇒ Worker 改判 404，且不回 HTML 体', async () => {
    const env = envWith(async () => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const res = await app.request('/assets/icons/playstyles/9999.webp', { method: 'GET' }, env);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
    expect(await res.text()).toBe('');
  });

  it('真文件：原样透传 200 + image/webp + immutable 缓存头', async () => {
    const env = envWith(
      async () =>
        new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
          headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' },
        }),
    );
    const res = await app.request('/assets/icons/playstyles/1.webp', { method: 'GET' }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('其他静态路径不受影响：/assets/logo 之类仍由平台直接托管，不进 Worker 分支', async () => {
    let called = 0;
    const env = envWith(async () => {
      called += 1;
      return new Response('ok');
    });
    const res = await app.request('/assets/logo.webp', { method: 'GET' }, env);
    expect(res.status).toBe(404); // Hono 无匹配路由（真实部署由静态绑定先行命中）
    expect(called).toBe(0);
  });
});
