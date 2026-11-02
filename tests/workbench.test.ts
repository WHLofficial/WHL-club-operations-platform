// 审核工作台（v6.68.2 期 C）端点测试：在途五表、CPU 过滤、凭证权限、搜索兜底。
// 这几条锁的是「工作台看得到什么、看不到什么」——它是运营唯一能一眼看完在途单据的地方，
// 少一张表或多露一个凭证 key 都是生产事故。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
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
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '教练丙', 'coach', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
  const kv = new Map<string, string>();
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
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
  return { env, sqlite };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

// 队 901 正常人队 / 队 902 CPU 队；两单挂牌（正常 / CPU 卖方）、一单强拍（CPU 卖方）、
// 一条活跃出价、一个进行中谈判、一张待审转会。
function seed(): Fixture {
  const fx = freshEnv();
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, is_cpu) VALUES (901, '甲队', 0), (902, 'CPU 队', 1);
    INSERT INTO players (id, uid, fc_id, name, club_id, position) VALUES
      (901, 'fc901', 9901, '甲球员', 901, 'ST'),
      (902, 'fc902', 9902, '乙球员', 902, 'CB'),
      (903, 'fc903', 9903, '丙球员', NULL, 'CM'),
      (904, 'fc904', 9904, '丁球员', 902, 'GK');
    INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, deadline_at, activation_proof) VALUES
      (901, 901, 901, 'normal', 10, 'bidding', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z', NULL),
      (902, 902, 902, 'normal', 20, 'listed', '2026-11-01T01:00:00Z', '2026-11-05T00:00:00Z', NULL),
      (903, 903, NULL, 'activation', 5, 'listed', '2026-11-01T02:00:00Z', NULL, 'activation/55/abc.png');
    INSERT INTO bids (id, listing_id, club_id, amount, status, created_at) VALUES
      (901, 901, 901, 12, 'active', '2026-11-01T03:00:00Z'),
      (902, 902, 902, 21, 'active', '2026-11-01T03:10:00Z');
    INSERT INTO transfers (id, player_id, from_club_id, to_club_id, type, status, fee, created_at) VALUES
      (901, 901, 901, 902, 'transfer', 'pending_review', 12, '2026-11-01T04:00:00Z'),
      (902, 902, 902, 901, 'transfer', 'pending_review', 21, '2026-11-01T04:10:00Z');
    INSERT INTO negotiation_sessions (id, transfer_id, player_id, club_id, status, release_fee, expected_wage, attempt_count, expiry_anchor_at, created_at) VALUES
      (901, 901, 901, 902, 'active', 12, 3.5, 0, '2026-11-03T00:00:00Z', '2026-11-01T05:00:00Z');
    INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, deadline_at, bid_paused) VALUES
      (904, 904, 902, 'forced', 5, 'bidding', '2026-11-01T06:00:00Z', '2026-11-07T00:00:00Z', 0);
  `);
  return fx;
}

describe('审核工作台 · 在途五表（v6.68.2 期 C）', () => {
  it('未登录 401（三个端点同权）', async () => {
    const fx = seed();
    for (const path of ['/api/admin/workbench/in-flight', '/api/admin/workbench/search?q=901', '/api/admin/workbench/proof/903']) {
      expect((await get(path, undefined, fx.env)).status).toBe(401);
    }
  });

  it('CPU 参与方默认隐藏，cpu=1 才带出来；强拍表不过滤 CPU', async () => {
    const fx = seed();
    const res = await get('/api/admin/workbench/in-flight', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      listings: { id: number }[];
      bids: { id: number }[];
      transfers: { id: number }[];
      forced: { listingId: number }[];
      counts: Record<string, number>;
      hidden: { listings: number; bids: number; sessions: number; transfers: number };
    };
    // 挂牌 901 正常卖方 / 902 CPU 卖方 ⇒ 默认只剩 901（激活单 903 卖方为自由身，不涉 CPU）
    expect(body.listings.map((l) => l.id).sort()).toEqual([901, 903]);
    // 出价 902 是 CPU 俱乐部出的 ⇒ 默认隐藏
    expect(body.bids.map((b) => b.id)).toEqual([901]);
    // 转会 902 是 CPU 卖方 ⇒ 默认隐藏
    expect(body.transfers.map((t) => t.id)).toEqual([901]);
    // 强拍 904 的卖方是 CPU 队，但强拍表不做 CPU 过滤（设计：强拍量少、运营要一眼看全）
    expect(body.forced.map((f) => f.listingId)).toEqual([904]);
    expect(body.counts.listings).toBe(2);
    // 「已隐藏 N 条」：四张转会类表各藏 1 条（挂牌 902 / 出价 902 / 谈判 901 / 转会 902），强拍不藏
    expect(body.hidden).toEqual({ listings: 1, bids: 1, sessions: 1, transfers: 1 });

    const all = (await (await get('/api/admin/workbench/in-flight?cpu=1', 'tok-admin', fx.env)).json()) as {
      listings: { id: number }[];
      bids: { id: number }[];
      transfers: { id: number }[];
    };
    expect(all.listings.map((l) => l.id).sort()).toEqual([901, 902, 903]);
    expect(all.bids.map((b) => b.id).sort()).toEqual([901, 902]);
    expect(all.transfers.map((t) => t.id).sort()).toEqual([901, 902]);
  });

  it('凭证只回 hasProof 布尔，列表里不出现 key', async () => {
    const fx = seed();
    const res = await get('/api/admin/workbench/in-flight?cpu=1', 'tok-admin', fx.env);
    const text = await res.text();
    expect(text).not.toContain('activation/55/abc.png');
    const body = JSON.parse(text) as { listings: { id: number; hasProof: boolean }[] };
    expect(body.listings.find((l) => l.id === 903)?.hasProof).toBe(true);
    expect(body.listings.find((l) => l.id === 901)?.hasProof).toBe(false);
  });

  it('凭证端点：有凭证回 media 地址，没有 404，不存在 404，参数非法 400', async () => {
    const fx = seed();
    const ok = await get('/api/admin/workbench/proof/903', 'tok-admin', fx.env);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toBe('/api/media/activation/55/abc.png');
    expect((await get('/api/admin/workbench/proof/901', 'tok-admin', fx.env)).status).toBe(404);
    expect((await get('/api/admin/workbench/proof/999', 'tok-admin', fx.env)).status).toBe(404);
    expect((await get('/api/admin/workbench/proof/abc', 'tok-admin', fx.env)).status).toBe(400);
  });

  it('搜索：数字命中多种 id、文字命中球员与俱乐部', async () => {
    const fx = seed();
    const byId = (await (await get('/api/admin/workbench/search?q=901', 'tok-admin', fx.env)).json()) as {
      results: { kind: string; id: number }[];
    };
    const kinds = byId.results.map((r) => `${r.kind}:${r.id}`);
    expect(kinds).toContain('player:901');
    expect(kinds).toContain('club:901');
    expect(kinds).toContain('listing:901');
    expect(kinds).toContain('bid:901');
    expect(kinds).toContain('negotiation:901');
    expect(kinds).toContain('transfer:901');

    const byName = (await (await get('/api/admin/workbench/search?q=%E7%94%B2', 'tok-admin', fx.env)).json()) as {
      results: { kind: string; label: string }[];
    };
    expect(byName.results.some((r) => r.kind === 'player' && r.label.includes('甲球员'))).toBe(true);
    expect(byName.results.some((r) => r.kind === 'club' && r.label.includes('甲队'))).toBe(true);

    // 空串直接回空（不打全表）
    expect(((await (await get('/api/admin/workbench/search?q=', 'tok-admin', fx.env)).json()) as { results: unknown[] }).results).toEqual([]);
  });
});

describe('激活凭证可见范围（v6.68.2 期 C，Q12 裁决）', () => {
  function bind(clubId: number, userId: number, fx: Fixture) {
    fx.sqlite.exec(`INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${clubId}, ${userId}, '2026-11-01T00:00:00Z')`);
  }

  it('匿名 401；非卖方 403；卖方 200；卖方但无凭证 404', async () => {
    const fx = seed();
    // 让球员 903 的激活单挂到队 901 名下，再把 901 绑给 tok-coach
    fx.sqlite.exec(`UPDATE listings SET seller_club_id = 901 WHERE id = 903`);
    bind(901, 2, fx);

    expect((await get('/api/market/listings/903/proof', undefined, fx.env)).status).toBe(401);
    // tok-coach2 没绑任何俱乐部 ⇒ 不是卖方
    expect((await get('/api/market/listings/903/proof', 'tok-coach2', fx.env)).status).toBe(403);

    const ok = await get('/api/market/listings/903/proof', 'tok-coach', fx.env);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toBe('/api/media/activation/55/abc.png');

    // 901 这单的卖方也是队 901，但它没有上传凭证 ⇒ 404（不是 403，卖方确有看这单的资格）
    expect((await get('/api/market/listings/901/proof', 'tok-coach', fx.env)).status).toBe(404);
  });
});
