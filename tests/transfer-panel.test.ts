// 球员转会浮层端点（v6.74.0 期 C，设计 §6.1）：
// GET /api/players/:id/transfer-panel 一次给球员页状态条/浮层与转会台行展开共用一份响应。
// 覆盖：挂牌选单（active 优先 / 已结束兜底）、我的出价与挂牌出价窗口互不影响、报价 in/out 各自限额、
// 成交单只认换队类、谈判摘要（剩余轮/静默倒计时/成约文案）、未绑队只回公开部分、权限与缓存头。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
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
    `INSERT INTO clubs (id, name) VALUES (100, '我的队'), (200, '挂牌方'), (300, '另一队');
     INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (100, 2, '2026-01-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (10, 'fc10', '甲', 100, 'ST', 25, 80, 85, 'normal'),
       (11, 'fc11', '乙', 200, 'ST', 25, 80, 85, 'normal'),
       (12, 'fc12', '丙', 200, 'ST', 25, 80, 85, 'normal');
     INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, is_active) VALUES
       (10, 100, 44, 2.5, 'formal', 1);
     INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at) VALUES
       (1, 10, 200, 'normal', 30, 'bidding', '2026-01-01T00:00:00Z'),
       (2, 10, 200, 'normal', 28, 'delisted', '2025-12-01T00:00:00Z'),
       (3, 11, 200, 'normal', 40, 'delisted', '2025-11-01T00:00:00Z');
     INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES
       (1, 1, 100, 10, '2026-01-01T00:00:00Z', 'superseded'),
       (2, 1, 200, 20, '2026-01-02T00:00:00Z', 'active');
     INSERT INTO offers (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at) VALUES
       (1, 10, 200, 100, 10, 10, 0, 'pending', 'seller', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       (2, 10, 100, 200, 12, 12, 0, 'pending', 'buyer', 1, 1, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
     INSERT INTO negotiation_sessions (id, player_id, club_id, status, attempt_count, created_at, settled_wage, settle_source) VALUES
       (5, 10, 100, 'active', 1, '2026-01-01T00:00:00Z', NULL, NULL),
       (6, 10, 100, 'settled', 3, '2025-12-01T00:00:00Z', 3.5, 'negotiation');
     INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, completed_at) VALUES
       (7, 'rc_change', 12, 200, 200, 0, 'completed', '2026-01-01T00:00:00Z'),
       (8, 'transfer', 11, 200, 100, 51, 'completed', '2025-11-02T00:00:00Z'),
       (9, 'transfer', 11, 200, 100, 99, 'pending_review', NULL);`,
  );
  return { env, sqlite };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, {
    method: 'GET',
    headers: token ? { Cookie: `whl_session=${token}` } : {},
  }, env);
}

beforeEach(() => resetConfigCache());

describe('GET /api/players/:id/transfer-panel · 挂牌与出价', () => {
  it('在流程内的最新挂牌优先于已结束单；字段与挂牌详情同口径', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE listings SET status = 'pending_review' WHERE id = 1;`);
    const res = await get('/api/players/10/transfer-panel', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, never>;
    const listing = (body as unknown as { listing: Record<string, unknown> }).listing;
    expect(listing.id).toBe(1);
    expect(listing.status).toBe('pending_review');
    expect(listing.releaseFee).toBe(44);
    expect(listing.marketBidPaused).toBe(false);
    expect(listing.nextMinBid).toBe(21);
    expect((body as unknown as { player: { isMine: boolean } }).player.isMine).toBe(true);
  });

  it('没有在流程内单时回落最新 delisted；bids 只属于该单', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE id = 1;`);
    const body = (await (await get('/api/players/10/transfer-panel', 'tok-coach', fx.env)).json()) as {
      listing: { id: number };
      bids: unknown[];
    };
    expect(body.listing.id).toBe(2);
    expect(body.bids).toEqual([]);
  });

  it('无任何挂牌 ⇒ listing null、bids 空；个人数组仍照常', async () => {
    const fx = freshEnv();
    const body = (await (await get('/api/players/12/transfer-panel', 'tok-coach', fx.env)).json()) as {
      listing: unknown;
      bids: unknown[];
      transfer: { id: number } | null;
    };
    expect(body.listing).toBeNull();
    expect(body.bids).toEqual([]);
    // rc_change 不算换队成交 ⇒ transfer null
    expect(body.transfer).toBeNull();
  });

  it('bids 最多 50 笔且只回当前挂牌；myBids 独立查询不被 50 条窗口截断', async () => {
    const fx = freshEnv();
    const rows: string[] = [];
    for (let i = 0; i < 55; i += 1) {
      rows.push(`(${100 + i}, 1, 200, ${20 + i}, '2026-01-03T00:00:00Z', 'superseded')`);
    }
    fx.sqlite.exec(`INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES ${rows.join(',')};`);
    const body = (await (await get('/api/players/10/transfer-panel', 'tok-coach', fx.env)).json()) as {
      bids: { id: number }[];
      myBids: { id: number; listingId: number; holdStatus: string | null }[];
    };
    expect(body.bids.length).toBe(50);
    expect(body.bids[0].id).toBe(154);
    // 我的 id=1（比 50 条都早）仍必须在 myBids 里
    expect(body.myBids.some((b) => b.id === 1)).toBe(true);
    expect(body.myBids[0]).toMatchObject({ listingId: 1, holdStatus: null });
  });
});

describe('GET /api/players/:id/transfer-panel · 报价与谈判', () => {
  it('报价 in/out 各自一条查询各限 20，in 不会被 out 挤掉；myTurn 口径同列表', async () => {
    const fx = freshEnv();
    // 同一球员已有生效挂牌时 pending 报价会被惰性过期（正常业务态），这里先收单
    fx.sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE id = 1;`);
    const out: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      // 同一买方只允许一张 pending（部分唯一索引），限额测试用已结束单堆量
      out.push(`(${100 + i}, 10, 100, 200, 10, 10, 0, 'settled', 'buyer', 1, 1, '2026-01-05T00:00:00Z', '2026-01-05T00:00:0${i % 10}Z')`);
    }
    fx.sqlite.exec(
      `INSERT INTO offers (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at) VALUES ${out.join(',')};`,
    );
    const body = (await (await get('/api/players/10/transfer-panel', 'tok-coach', fx.env)).json()) as {
      offers: { in: { id: number; myTurn: boolean }[]; out: { id: number; myTurn: boolean }[] };
    };
    expect(body.offers.in.length).toBe(1);
    expect(body.offers.in[0]).toMatchObject({ id: 1, myTurn: true });
    expect(body.offers.out.length).toBe(20);
    expect(body.offers.out[0].myTurn).toBe(false);
  });

  it('谈判取 active 优先，remaining = maxAttempts - attemptsUsed，expiresAt 按静默锚 + 72h', async () => {
    const fx = freshEnv();
    const body = (await (await get('/api/players/10/transfer-panel', 'tok-coach', fx.env)).json()) as {
      negotiation: {
        id: number;
        status: string;
        attemptsUsed: number;
        remaining: number;
        expiresAt: string;
        settled: unknown;
      };
    };
    expect(body.negotiation).toMatchObject({ id: 5, status: 'active', attemptsUsed: 1, remaining: 2 });
    expect(body.negotiation.expiresAt).toBe('2026-01-04T00:00:00.000Z');
    expect(body.negotiation.settled).toBeNull();
  });

  it('只有已结束会话时回 settled 文案（复用 settleMessage）', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE negotiation_sessions SET status = 'cancelled' WHERE id = 5;`);
    const body = (await (await get('/api/players/10/transfer-panel', 'tok-coach', fx.env)).json()) as {
      negotiation: { id: number; settled: { wage: number; source: string; message: string } | null };
    };
    expect(body.negotiation.id).toBe(6);
    expect(body.negotiation.settled).toEqual({
      wage: 3.5,
      source: 'negotiation',
      message: '报价被经纪人接受，按你的报价签约',
    });
  });

  it('成交单只取最新 completed 换队单（pending_review 不算）', async () => {
    const fx = freshEnv();
    const body = (await (await get('/api/players/11/transfer-panel', 'tok-coach', fx.env)).json()) as {
      transfer: { id: number; fee: number; toClubId: number; toClubName: string; completedAt: string } | null;
    };
    expect(body.transfer).toMatchObject({ id: 8, fee: 51, toClubId: 100, toClubName: '我的队' });
  });
});

describe('GET /api/players/:id/transfer-panel · 权限与边界', () => {
  it('未绑队：club null、个人数组为空，但公开挂牌仍在', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`DELETE FROM club_bindings WHERE user_id = 2;`);
    const res = await get('/api/players/10/transfer-panel', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      club: unknown;
      player: { isMine: boolean };
      listing: { id: number } | null;
      myBids: unknown[];
      offers: { in: unknown[]; out: unknown[] };
      negotiation: unknown;
    };
    expect(body.club).toBeNull();
    expect(body.player.isMine).toBe(false);
    expect(body.listing?.id).toBe(1);
    expect(body.myBids).toEqual([]);
    expect(body.offers).toEqual({ in: [], out: [] });
    expect(body.negotiation).toBeNull();
  });

  it('响应头 private, no-store', async () => {
    const fx = freshEnv();
    const res = await get('/api/players/10/transfer-panel', 'tok-coach', fx.env);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('观众 403、匿名 401、非法 id 400、球员不存在 404', async () => {
    const fx = freshEnv();
    expect((await get('/api/players/10/transfer-panel', 'tok-viewer', fx.env)).status).toBe(403);
    expect((await get('/api/players/10/transfer-panel', undefined, fx.env)).status).toBe(401);
    expect((await get('/api/players/abc/transfer-panel', 'tok-coach', fx.env)).status).toBe(400);
    expect((await get('/api/players/999/transfer-panel', 'tok-coach', fx.env)).status).toBe(404);
  });
});
