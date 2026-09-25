// Sentry 中间件旁路契约（v6.1.1）：零网络——DSN 不配时 SDK 不初始化，
// 上报验证（真实事件到控制台）由本地 dev / 部署后 probe 完成，不在单测里做。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createTestKV } from './d1.ts';

function freshEnv(): Env {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);`,
  );
  return {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: createTestKV() as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
}

describe('Sentry 中间件旁路（v6.1.1）', () => {
  it('env 无 SENTRY_DSN：请求全链路不受中间件影响（/api/health 三资源全 ok）', async () => {
    const res = await app.request('http://localhost/api/health', {}, freshEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, string> };
    expect(body.ok).toBe(true);
    expect(body.checks).toEqual({ d1: 'ok', tour_db: 'ok', kv: 'ok' });
  });

  it('探针端点：CRON_KEY 对不上 403（守卫在 Sentry 之外照常生效，且 4xx 不上报）', async () => {
    const env = freshEnv();
    env.CRON_KEY = 'test-key';
    const res = await app.request('http://localhost/api/cron/sentry-probe', { method: 'POST' }, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'cron 密钥不对' });
  });

  it('探针端点：本地 fail-open（未配 CRON_KEY 放行）⇒ 抛非 HttpError ⇒ onError 500 JSON 形状不变', async () => {
    const res = await app.request('http://localhost/api/cron/sentry-probe', { method: 'POST' }, freshEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '服务器出了点问题，请稍后再试' });
  });
});
