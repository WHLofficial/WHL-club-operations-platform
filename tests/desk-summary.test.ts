// 转会台汇总端点（v6.73.0 期 B，设计 §5.1 / §8.2）：
// GET /api/market/desk/summary 一次 db.batch 出三域待办数（谈判 active / 报价轮到我 / 出价被超出），
// 未绑队全 0、观众 403、匿名 401；响应头 private, no-store；不跑 settleOverdue。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (2, '教练乙', 'coach', 0, 0),
       (9, '观众', 'user', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  kv.set('sess:tok-viewer', JSON.stringify({ userId: 9 }));
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
  sqlite.exec(
    `INSERT INTO clubs (id, name) VALUES (100, '测试队'), (200, '对家队');
     INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (100, 2, '2026-01-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (10, 'fc10', '甲', 100, 'ST', 25, 80, 85, 'normal'),
       (11, 'fc11', '乙', 200, 'ST', 25, 80, 85, 'normal');
     INSERT INTO negotiation_sessions (id, player_id, club_id, status, created_at) VALUES
       (1, 10, 100, 'active', '2026-01-01T00:00:00Z'),
       (2, 11, 100, 'active', '2026-01-01T00:00:00Z'),
       (3, 10, 100, 'settled', '2026-01-01T00:00:00Z');
     INSERT INTO offers (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at) VALUES
       (1, 10, 200, 100, 10, 10, 0, 'pending', 'seller', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       (2, 11, 100, 200, 10, 10, 0, 'pending', 'buyer', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       (3, 10, 100, 200, 10, 10, 0, 'pending', 'seller', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       (4, 11, 200, 100, 10, 10, 0, 'intent', 'seller', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       (5, 10, 200, 100, 10, 10, 0, 'accepted', 'seller', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
     INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at) VALUES
       (1, 10, 200, 'normal', 30, 'bidding', '2026-01-01T00:00:00Z'),
       (2, 11, 200, 'normal', 30, 'bidding', '2026-01-01T00:00:00Z'),
       (3, 10, 200, 'normal', 30, 'matched_pending', '2026-01-01T00:00:00Z');
     INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES
       (1, 1, 100, 10, '2026-01-01T00:00:00Z', 'superseded'),
       (2, 2, 100, 8, '2026-01-01T00:00:00Z', 'superseded'),
       (3, 3, 100, 10, '2026-01-01T00:00:00Z', 'superseded'),
       (4, 1, 200, 12, '2026-01-02T00:00:00Z', 'active'),
       (5, 2, 100, 10, '2026-01-02T00:00:00Z', 'active');`,
  );
  return { env, sqlite, kv };
}

function get(token: string | undefined, env: Env) {
  return app.request('/api/market/desk/summary', {
    method: 'GET',
    headers: token ? { Cookie: `whl_session=${token}` } : {},
  }, env);
}

beforeEach(() => resetConfigCache());

describe('GET /api/market/desk/summary · 三域待办计数', () => {
  it('谈判 active / 报价轮到我 / 出价被超出，各域与 total 正确', async () => {
    const fx = freshEnv();
    const res = await get('tok-coach', fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ negotiations: 2, offers: 2, bids: 1, total: 5 });
  });

  it('响应头 private, no-store（用户级计数不进共享缓存）', async () => {
    const fx = freshEnv();
    const res = await get('tok-coach', fx.env);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('自己加价后旧价变 superseded、最新一笔 active ⇒ 不计', async () => {
    const fx = freshEnv();
    // 挂牌 2 上再加一笔（最新 id 更大、active）⇒ 该挂牌不再计
    fx.sqlite.exec(
      `INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES
         (6, 2, 100, 12, '2026-01-03T00:00:00Z', 'active');`,
    );
    const res = await get('tok-coach', fx.env);
    expect(((await res.json()) as { bids: number }).bids).toBe(1);
  });

  it('挂牌离开 bidding（matched_pending / pending_review）后不计', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE listings SET status = 'pending_review' WHERE id = 1;`);
    const res = await get('tok-coach', fx.env);
    expect(((await res.json()) as { bids: number }).bids).toBe(0);
  });

  it('报价只算轮到我：in 看 seller、out 看 buyer；intent 不计', async () => {
    const fx = freshEnv();
    // 把 id=1 的 turn 改成 buyer（我是卖方，轮不到我）⇒ 掉一条
    fx.sqlite.exec(`UPDATE offers SET turn = 'buyer' WHERE id = 1;`);
    const res = await get('tok-coach', fx.env);
    expect(((await res.json()) as { offers: number }).offers).toBe(1);
  });

  it('未绑队：全 0 且 200（顶栏不出现 404 噪音）', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`DELETE FROM club_bindings WHERE user_id = 2;`);
    const res = await get('tok-coach', fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ negotiations: 0, offers: 0, bids: 0, total: 0 });
  });

  it('观众 403、匿名 401', async () => {
    const fx = freshEnv();
    expect((await get('tok-viewer', fx.env)).status).toBe(403);
    expect((await get(undefined, fx.env)).status).toBe(401);
  });
});
