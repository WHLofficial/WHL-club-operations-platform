// api.ts 错误文案口径（v6.27.0 修）：错误体有两种——
// ① HttpError 的 {error:'中文'}（本仓既有全部管理端点）；
// ② 机器通道口径 {error:'code', message:'中文'}（tour 新端点的回执原样透出，v6.27.0 四个接管端点）。
// ② 的 error 是给程序看的错误码，直接当 message 显示会让操作员看到 tour_sync_failed 这种码，故有 message 就优先。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiSend } from './api.ts';

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('错误文案选择', () => {
  it('{error:code, message:中文} 口径显示中文，code 不进 message', async () => {
    stubFetch(502, { error: 'tour_sync_failed', message: '赛事系统不可达' });
    const err = await apiSend('POST', '/api/admin/clubs/10/rename-tour', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).message).toBe('赛事系统不可达');
  });

  it('{error:中文} 口径照旧（HttpError 形状没被改坏）', async () => {
    stubFetch(409, { error: '已有俱乐部使用该名字' });
    const err = await api('/api/admin/clubs').catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('已有俱乐部使用该名字');
  });

  it('两样都没有时回落「请求失败」', async () => {
    stubFetch(500, {});
    const err = await api('/api/admin/clubs').catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('请求失败');
  });
});
