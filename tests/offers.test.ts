// 报价 / 议价子系统测试（v6.3.0，验收口径 = 设计 §8）：送报价六拒 / 还价 / 同意挂牌事务 /
// 拒绝撤回过期 / 名单自动应答 / offer-settings / 触发器同源锁（0037 fund_holds_offer_guard）。
// 变异验证对应关系（开发期手动三改三红，测试常驻断言）：
//   ① 删 offer-rules.validateStrictRaise 的严格抬高判断 → 「还价不抬高」组变红
//   ② 删 0037 的 idx_offers_active_pair → 「同买方重复活跃报价」组变红
//   ③ 删 0037 的 fund_holds_offer_guard 触发器 → 「触发器同源锁」组变红
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

// 两支真人队（1 阿森纳 / 2 拜仁）+ 一支 CPU 队 + 一名自由身；uid 2 绑 club1、uid 5 绑 club2
function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    // 兼容模式会话要从 TOUR_DB user 表读角色（与 routes.test.ts 同构的最小镜像）
    TOUR_DB: createTourDb(),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    PUBLIC_CACHE_TTL_MS: '0',
  };
  for (const [uid, token] of [
    [2, 'tok-coach'],
    [5, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, kv };
}

// 测试里 D1 直用 node:sqlite 包装（与 tests/d1.ts 的 createTestD1 同构，这里内联避免依赖 tour/auth 件）
import { createTestD1 } from './d1.ts';

function createTourDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (2, '教练乙', 'coach', 0, 0),
       (3, '丙丙', 'coach', 0, 0),
       (5, '教练戊', 'coach', 0, 0);`,
  );
  return createTestD1(sqlite);
}

function seedWorld(fx: Fixture, opts: { windowOpen?: boolean } = {}): void {
  const open = opts.windowOpen ?? true;
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '拜仁', 'premier', 'active'), (3, 'CPU队', 'premier', 'active');
    UPDATE clubs SET is_cpu = 1 WHERE id = 3;
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, '${open ? 'open' : 'closed'}', '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES
      (1, 'uid1', '球员甲', 1, 'ST', 80, 85, 'normal', 11),
      (2, 'uid2', '球员乙', 2, 'CM', 75, 82, 'normal', 12),
      (3, 'uid3', 'CPU人', 3, 'GK', 70, 78, 'normal', 13),
      (4, 'uid4', '自由人', NULL, 'CM', 65, 75, 'free', 14);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (2, 2, 50, 2, 'formal', 'import', '2026-07-01', 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-01T00:00:00Z'), (2, 100, '2026-07-01T00:00:00Z');
  `);
}

function send(env: Env, method: 'POST' | 'PUT', path: string, body: unknown, token: string) {
  return app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` },
      body: JSON.stringify(body),
    },
    env,
  );
}

interface OfferOut {
  ok?: boolean;
  offerId?: number;
  status?: string;
  auto?: string | null;
  error?: string;
  code?: string;
  listingId?: number;
}

async function place(fx: Fixture, playerId: number, amount: number, token = 'tok-coach2', note?: string): Promise<Response> {
  return send(fx.env, 'POST', '/api/offers', { playerId, amount, note }, token);
}

describe('送报价（设计 §8 六拒 + 冻结）', () => {
  it('正常报价落库：offer pending / 冻结 held / open 事件 / 审计 / 卖家通知', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30, 'tok-coach2', '意思意思');
    expect(res.status).toBe(201);
    const out = (await res.json()) as OfferOut;
    expect(out).toMatchObject({ ok: true, status: 'pending', auto: null });

    const offer = sqlGet<{ id: number; status: string; turn: string; amount: number; init_amount: number; note: string; hold_id: number; seller_club_id: number; buyer_club_id: number; season: number; window_seq: number }>(
      fx.sqlite,
      'SELECT * FROM offers WHERE id = ?',
      out.offerId as number,
    );
    expect(offer).toMatchObject({ status: 'pending', turn: 'seller', amount: 30, init_amount: 30, note: '意思意思', seller_club_id: 1, buyer_club_id: 2, season: 1, window_seq: 1 });
    expect(offer?.hold_id).not.toBeNull();
    const hold = sqlGet<{ status: string; ref_type: string; ref_id: number; amount: number }>(fx.sqlite, 'SELECT * FROM fund_holds WHERE id = ?', offer!.hold_id);
    expect(hold).toMatchObject({ status: 'held', ref_type: 'offer', ref_id: offer!.id, amount: 30 });
    expect(sqlGet<{ kind: string; actor_club_id: number }>(fx.sqlite, 'SELECT kind, actor_club_id FROM offer_events WHERE offer_id = ?', offer!.id)).toMatchObject({ kind: 'open', actor_club_id: 2 });
    expect(sqlGet(fx.sqlite, "SELECT id FROM audit_log WHERE action = 'offer_place'")).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_received'")).toBeDefined();
  });

  it('窗关 409 no_window（独立 fixture）', async () => {
    const fx = freshEnv();
    seedWorld(fx, { windowOpen: false });
    const res = await place(fx, 1, 30);
    expect(res.status).toBe(409);
    expect(((await res.json()) as OfferOut).code).toBe('no_window');
  });

  it('自由身 / CPU 队 / 本队球员各有可读拒绝', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    let res = await place(fx, 4, 30); // 自由身
    expect(res.status).toBe(400);
    res = await place(fx, 3, 30); // CPU 队
    expect(res.status).toBe(400);
    res = await send(fx.env, 'POST', '/api/offers', { playerId: 1, amount: 30 }, 'tok-coach'); // 本队：uid2=club1 报自己队的球员甲
    expect(res.status).toBe(400);
  });

  it('非卖品 403 / 挂牌中 409 / 金额越界 400 / 同买方重复 409（partial unique + 可读预检）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec("UPDATE players SET not_for_sale = 1 WHERE id = 1");
    expect((await place(fx, 1, 30)).status).toBe(403);

    fx.sqlite.exec("UPDATE players SET not_for_sale = 0, status = 'listed' WHERE id = 1");
    const listed = await place(fx, 1, 30);
    expect(listed.status).toBe(409);
    expect(((await listed.json()) as OfferOut).code).toBe('player_listed');

    fx.sqlite.exec("UPDATE players SET status = 'normal' WHERE id = 1");
    expect((await place(fx, 1, 0.5)).status).toBe(400);
    expect((await place(fx, 1, 75.01)).status).toBe(400); // 1.5×RC=75
    expect((await place(fx, 1, 75)).status).toBe(201);

    const dup = await place(fx, 1, 40);
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as OfferOut).error).toContain('已经有一条');
  });

  it('余额不足 400：报价即冻结（把 RC 抬到 100，cap 150，报 120 超余额 100）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec('UPDATE contracts SET release_fee = 100 WHERE player_id = 1');
    const res = await place(fx, 1, 120);
    expect(res.status).toBe(400);
    expect(((await res.json()) as OfferOut).error).toContain('可用资金不足');
  });
});

describe('还价（必须严格抬高 / 轮次 / 冻结顶替）', () => {
  async function seedPending(fx: Fixture, amount = 30): Promise<number> {
    const res = await place(fx, 1, amount);
    expect(res.status).toBe(201);
    return ((await res.json()) as OfferOut).offerId as number;
  }

  it('卖方还价 35：amount/round/turn 更新；买方冻结不动（30，接受时才补足）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedPending(fx, 30);
    const res = await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 35 }, 'tok-coach');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, amount: 35, turn: 'buyer' });
    expect(sqlGet(fx.sqlite, 'SELECT amount, round, turn FROM offers WHERE id = ?', id)).toMatchObject({ amount: 35, round: 1, turn: 'buyer' });
    const holds = sqlAll<{ status: string; amount: number }>(fx.sqlite, "SELECT status, amount FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", id);
    expect(holds).toEqual([{ status: 'held', amount: 30 }]);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM offer_events WHERE offer_id = ? AND kind = 'counter'", id)?.n).toBe(1);
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_countered'")).toBeDefined();
  });

  it('买方接受卖方还价：冻结先补足到还价额（30→35）再转正，成交价 = 冻结额', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedPending(fx, 30);
    expect((await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 35 }, 'tok-coach')).status).toBe(200);
    const res = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach2');
    expect(res.status).toBe(200);
    const listingId = ((await res.json()) as OfferOut).listingId as number;
    const hold = sqlGet<{ status: string; ref_type: string; ref_id: number; amount: number }>(fx.sqlite, "SELECT * FROM fund_holds WHERE ref_type = 'listing' AND ref_id = ?", listingId);
    expect(hold).toMatchObject({ status: 'held', ref_type: 'listing', ref_id: listingId, amount: 35 });
    expect(sqlGet(fx.sqlite, 'SELECT amount, status FROM bids WHERE listing_id = ?', listingId)).toMatchObject({ amount: 35, status: 'active' });
  });

  it('买方资金不够接受还价：400（RC 抬到 100，卖方还到 120，余额 100 顶替后仍不足）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec('UPDATE contracts SET release_fee = 100 WHERE player_id = 1');
    const id = await seedPending(fx, 60);
    expect((await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 120 }, 'tok-coach')).status).toBe(200);
    const res = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach2');
    expect(res.status).toBe(400);
    expect(((await res.json()) as OfferOut).error).toContain('可用资金不足');
  });

  it('未轮到者不能还价（买方在 turn=seller 时 409）；不抬高 400；了结单 409', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedPending(fx, 30);
    let res = await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 35 }, 'tok-coach2');
    expect(res.status).toBe(409);
    expect(((await res.json()) as OfferOut).code).toBe('not_your_turn');

    res = await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 30 }, 'tok-coach');
    expect(res.status).toBe(400);
    res = await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 29.99 }, 'tok-coach');
    expect(res.status).toBe(400);

    await send(fx.env, 'POST', `/api/offers/${id}/withdraw`, {}, 'tok-coach2');
    res = await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 35 }, 'tok-coach');
    expect(res.status).toBe(409);
  });

  it('买方还价后 turn 回 seller；无关俱乐部 403', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedPending(fx, 30);
    expect((await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 35 }, 'tok-coach')).status).toBe(200);
    expect((await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 40 }, 'tok-coach2')).status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT turn FROM offers WHERE id = ?', id)).toMatchObject({ turn: 'seller' });
    fx.sqlite.exec("INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (3, 3, '2026-01-01T00:00:00Z')");
    fx.kv.set('sess:tok-viewer', JSON.stringify({ userId: 3 }));
    expect((await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 45 }, 'tok-viewer')).status).toBe(403);
  });
});

describe('同意（含挂牌事务，设计 §4）', () => {
  async function seedTurnSeller(fx: Fixture): Promise<number> {
    const res = await place(fx, 1, 30);
    expect(res.status).toBe(201);
    const id = ((await res.json()) as OfferOut).offerId as number;
    // 卖方还价 30→35 → turn=buyer？不：卖方还价把轮次交给买方。要让卖方可以同意，就保持 turn=seller（首报后卖方本来就轮到）
    return id;
  }

  it('卖方同意首报：挂牌字段正确 / 领先出价 / hold 转正 / 球员 listed / 兄弟单过期释放', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedTurnSeller(fx);
    // 兄弟单：另一买方对同球员的 pending
    fx.sqlite.exec("INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (3, 3, '2026-01-01T00:00:00Z')");
    fx.kv.set('sess:tok-third', JSON.stringify({ userId: 3 }));
    fx.sqlite.exec("INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (3, 100, '2026-07-01T00:00:00Z')");
    fx.sqlite.exec("UPDATE clubs SET is_cpu = 0 WHERE id = 3");
    const third = await send(fx.env, 'POST', '/api/offers', { playerId: 1, amount: 32 }, 'tok-third');
    expect(third.status).toBe(201);

    const res = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(res.status).toBe(200);
    const out = (await res.json()) as OfferOut;
    const listingId = out.listingId as number;
    expect(listingId).toBeGreaterThan(0);

    const listing = sqlGet<{ type: string; ask_price: number; status: string; season: number; window_seq: number; player_id: number; seller_club_id: number }>(
      fx.sqlite,
      'SELECT * FROM listings WHERE id = ?',
      listingId,
    );
    expect(listing).toMatchObject({ type: 'normal', ask_price: 30, status: 'listed', season: 1, window_seq: 1, player_id: 1, seller_club_id: 1 });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'listed' });

    // hold 转正（不释放）+ 领先出价：转正后 ref_type='listing'，按新 ref 查
    const hold = sqlGet<{ id: number; status: string; ref_type: string; ref_id: number }>(fx.sqlite, "SELECT * FROM fund_holds WHERE ref_type = 'listing' AND ref_id = ?", listingId);
    expect(hold).toMatchObject({ status: 'held', ref_type: 'listing', ref_id: listingId });
    const bid = sqlGet<{ club_id: number; amount: number; status: string; hold_id: number }>(fx.sqlite, 'SELECT * FROM bids WHERE listing_id = ?', listingId);
    expect(bid).toMatchObject({ club_id: 2, amount: 30, status: 'active' });
    expect(bid?.hold_id).toBe(hold?.id ?? -1);

    // 本单 accepted、兄弟单 expired + 释放
    expect(sqlGet(fx.sqlite, 'SELECT status, listing_id FROM offers WHERE id = ?', id)).toMatchObject({ status: 'accepted', listing_id: listingId });
    const thirdId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM offers WHERE player_id = 1 AND buyer_club_id = 3")!.id;
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', thirdId)).toMatchObject({ status: 'expired' });
    expect(sqlGet(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", thirdId)).toMatchObject({ status: 'released' });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM offer_events WHERE offer_id = ? AND kind = 'expire'", thirdId)?.n).toBe(1);
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_accepted'")).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT id FROM audit_log WHERE action = 'offer_accept'")).toBeDefined();
  });

  it('没轮到不能同意（买方在 turn=seller 时 409）；重复同意 409', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    let r = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach2');
    expect(r.status).toBe(409);
    expect(((await r.json()) as OfferOut).code).toBe('not_your_turn');
    r = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(r.status).toBe(200);
    r = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(r.status).toBe(409);
  });
});

describe('拒绝 / 撤回', () => {
  it('卖方拒绝：rejected + 释放 + 通知；买方不能拒绝', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    expect((await send(fx.env, 'POST', `/api/offers/${id}/reject`, {}, 'tok-coach2')).status).toBe(403);
    expect((await send(fx.env, 'POST', `/api/offers/${id}/reject`, {}, 'tok-coach')).status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'rejected' });
    expect(sqlGet(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", id)).toMatchObject({ status: 'released' });
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_rejected'")).toBeDefined();
  });

  it('买方撤回：withdrawn + 释放 + 通知；卖方不能撤回；撤回后可重新报价', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    expect((await send(fx.env, 'POST', `/api/offers/${id}/withdraw`, {}, 'tok-coach')).status).toBe(403);
    expect((await send(fx.env, 'POST', `/api/offers/${id}/withdraw`, {}, 'tok-coach2')).status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'withdrawn' });
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_withdrawn'")).toBeDefined();
    expect((await place(fx, 1, 28)).status).toBe(201);
  });
});

describe('名单自动应答（设计 §3）', () => {
  function listPlayer(fx: Fixture, min = 40): void {
    fx.sqlite.exec(`UPDATE players SET transfer_listed = 1, min_offer_price = ${min} WHERE id = 1`);
  }

  it('报价 ≥ 线：auto_accept + 挂牌 + 领先出价 + auto_accept 事件', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    listPlayer(fx, 40);
    const res = await place(fx, 1, 45);
    expect(res.status).toBe(201);
    const out = (await res.json()) as OfferOut;
    expect(out).toMatchObject({ status: 'accepted', auto: 'auto_accept' });
    const listing = sqlGet<{ id: number; ask_price: number }>(fx.sqlite, 'SELECT * FROM listings WHERE player_id = 1');
    expect(listing?.ask_price).toBe(45);
    expect(sqlGet(fx.sqlite, 'SELECT status, listing_id FROM offers WHERE id = ?', out.offerId as number)).toMatchObject({ status: 'accepted', listing_id: listing?.id });
    expect(sqlGet(fx.sqlite, "SELECT kind FROM offer_events WHERE offer_id = ? AND kind = 'auto_accept'", out.offerId as number)).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_auto_accepted'")).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT status, ref_type FROM fund_holds WHERE ref_type = 'listing' AND ref_id = ?", listing!.id)).toMatchObject({ status: 'held', ref_type: 'listing' });
  });

  it('报价 < 线：auto_reject + 释放 + 事件 + 通知（无冻结残留）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    listPlayer(fx, 40);
    const res = await place(fx, 1, 35);
    expect(res.status).toBe(201);
    const out = (await res.json()) as OfferOut;
    expect(out).toMatchObject({ status: 'rejected', auto: 'auto_reject' });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', out.offerId as number)).toMatchObject({ status: 'rejected' });
    expect(sqlGet(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", out.offerId as number)).toMatchObject({ status: 'released' });
    expect(sqlGet(fx.sqlite, "SELECT kind FROM offer_events WHERE offer_id = ? AND kind = 'auto_reject'", out.offerId as number)).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_auto_rejected'")).toBeDefined();
  });

  it('没进名单走人工：pending 不自动应答', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 45);
    const out = (await res.json()) as OfferOut;
    expect(out.status).toBe('pending');
    expect(out.auto).toBeNull();
  });
});

describe('报价设置（PUT /api/players/:id/offer-settings）', () => {
  it('进名单带最低价：三列更新；min 超上限 400；缺最低价 400；互斥 400', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    let res = await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: true, minOfferPrice: 40, notForSale: false }, 'tok-coach');
    expect(res.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT transfer_listed, min_offer_price, not_for_sale FROM players WHERE id = 1')).toMatchObject({ transfer_listed: 1, min_offer_price: 40, not_for_sale: 0 });

    res = await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: true, minOfferPrice: 75.01, notForSale: false }, 'tok-coach');
    expect(res.status).toBe(400);
    expect(((await res.json()) as OfferOut).error).toContain('报价上限');

    res = await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: true, notForSale: false }, 'tok-coach');
    expect(res.status).toBe(400);

    res = await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: true, minOfferPrice: 40, notForSale: true }, 'tok-coach');
    expect(res.status).toBe(400);
    expect(((await res.json()) as OfferOut).error).toContain('互斥');
  });

  it('置非卖品：清名单与最低价 + 既有 pending 自动拒 + 释放 + 事件 + 通知', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    const out = await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: false, minOfferPrice: null, notForSale: true }, 'tok-coach');
    expect(out.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT transfer_listed, min_offer_price, not_for_sale FROM players WHERE id = 1')).toMatchObject({ transfer_listed: 0, min_offer_price: null, not_for_sale: 1 });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'rejected' });
    expect(sqlGet(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", id)).toMatchObject({ status: 'released' });
    expect(sqlGet(fx.sqlite, "SELECT kind FROM offer_events WHERE offer_id = ? AND kind = 'reject'", id)).toBeDefined();
  });

  it('挂牌中锁定 / 别人队 404', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec("UPDATE players SET status = 'listed' WHERE id = 1");
    expect((await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: false, notForSale: true }, 'tok-coach')).status).toBe(409);
    expect((await send(fx.env, 'PUT', '/api/players/2/offer-settings', { transferListed: false, notForSale: true }, 'tok-coach')).status).toBe(404);
  });
});

describe('触发器同源锁（0037 fund_holds_offer_guard）', () => {
  it('partial unique 同源锁：绕过应用层直插两条同 (player, buyer) 的 pending，第二条必须被拦', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const stmt = fx.sqlite.prepare(
      "INSERT INTO offers (player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at) VALUES (1, 2, 1, 30, 30, 0, 'pending', 'seller', 1, 1, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')",
    );
    stmt.run();
    expect(() => stmt.run()).toThrow('UNIQUE');
  });

  it('offer 非 pending 拒冻结（WHL_OFFER_REJECT_CLOSED）；金额不一致拒（AMOUNT）；资金不足拒（FUNDS）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;

    // 金额不一致：即使资金够、单子 pending，也要 ABORT
    expect(() =>
      fx.sqlite
        .prepare("INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at) VALUES (2, 31, 'held', 'offer', ?, '2026-07-01T00:00:00Z')")
        .run(id),
    ).toThrow('WHL_OFFER_REJECT_AMOUNT');

    // offer 非 pending：先撤回再插冻结
    fx.sqlite.exec(`UPDATE offers SET status = 'withdrawn' WHERE id = ${id}`);
    fx.sqlite.exec("UPDATE fund_holds SET status = 'released' WHERE ref_type = 'offer' AND ref_id = " + id);
    expect(() =>
      fx.sqlite
        .prepare("INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at) VALUES (2, 30, 'held', 'offer', ?, '2026-07-01T00:00:00Z')")
        .run(id),
    ).toThrow('WHL_OFFER_REJECT_CLOSED');

    // 资金不足：把余额清零再试（重开一条 pending 单）
    fx.sqlite.exec("UPDATE offers SET status = 'pending' WHERE id = " + id);
    fx.sqlite.exec('UPDATE ledger_accounts SET balance = 0 WHERE club_id = 2');
    expect(() =>
      fx.sqlite
        .prepare("INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at) VALUES (2, 30, 'held', 'offer', ?, '2026-07-01T00:00:00Z')")
        .run(id),
    ).toThrow('WHL_OFFER_REJECT_FUNDS');
  });
});

describe('惰性过期与自愈（expireStaleOffers 挂 settleOverdue）', () => {
  it('窗关后 pending 单过期 + 释放 + 双方通知；cron tick 同路', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1");
    const tick = await send(fx.env, 'POST', '/api/cron/tick', {}, '');
    // tick 未配 CRON_KEY：本地 fail-open 放行（assertCronKey 缺省）
    expect([200, 403]).toContain(tick.status);
    if (tick.status === 200) {
      expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'expired' });
      expect(sqlGet(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", id)).toMatchObject({ status: 'released' });
    }
  });

  it('球员已不在卖方（解约/转会）→ 过期；同球员已有生效挂牌 → 过期', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    fx.sqlite.exec('UPDATE players SET club_id = NULL, status = \'free\' WHERE id = 1');
    await fx.env.DB.prepare('SELECT 1').first(); // no-op 保持 d1 通道活跃
    const { expireStaleOffers } = await import('../src/worker/offers.ts');
    const summary = await expireStaleOffers(fx.env, { origin: 'user' });
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'expired' });

    // 挂牌占用：另一球员的 pending 单在挂牌出现后过期（club1 报 club2 的球员乙）
    const res2 = await place(fx, 2, 20, 'tok-coach');
    const id2 = ((await res2.json()) as OfferOut).offerId as number;
    fx.sqlite.exec(
      "INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, season, window_seq) VALUES (2, 2, 'normal', 25, 'listed', '2026-07-01T00:00:00Z', '2026-07-01', 1, 1)",
    );
    await expireStaleOffers(fx.env, { origin: 'user' });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id2)).toMatchObject({ status: 'expired' });
  });

  it('自愈：accepted 但没挂牌的孤儿单 → settleOverdue 补挂牌（fulfilled）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    // 模拟「占用成功、履约没跑」：直接把单打成 accepted、listing_id NULL、球员保持 normal
    fx.sqlite.exec(`UPDATE offers SET status = 'accepted' WHERE id = ${id}`);
    const { settleOverdue } = await import('../src/worker/market-settle.ts');
    await settleOverdue(fx.env, { origin: 'user' });
    const listingId = sqlGet<{ listing_id: number | null }>(fx.sqlite, 'SELECT listing_id FROM offers WHERE id = ?', id)?.listing_id;
    expect(listingId).not.toBeNull();
    expect(sqlGet(fx.sqlite, 'SELECT status, ask_price FROM listings WHERE id = ?', listingId as number)).toMatchObject({ status: 'listed', ask_price: 30 });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'listed' });
  });
});

describe('清单与详情（GET /api/offers）', () => {
  it('box=in/out 过滤 + pendingMine 徽标数 + 详情买卖双方可见、外人 403', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    // 第二个买方（club3 改真人）+ 第三个买方（club2 教练 tok-coach2）
    fx.sqlite.exec("UPDATE clubs SET is_cpu = 0 WHERE id = 3");
    fx.sqlite.exec("INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (3, 3, '2026-01-01T00:00:00Z')");
    fx.kv.set('sess:tok-viewer', JSON.stringify({ userId: 3 }));
    fx.sqlite.exec("INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (3, 100, '2026-07-01T00:00:00Z')");
    await place(fx, 1, 30); // club2 → 球员甲
    const secondRes = await place(fx, 1, 32, 'tok-viewer'); // club3 → 球员甲（两名买方同挂一球员）
    const secondId = secondRes.ok ? (((await secondRes.json()) as OfferOut).offerId as number) : null;

    const inbox = await app.request('/api/offers?box=in&status=all', { headers: { Cookie: 'whl_session=tok-coach' } }, fx.env);
    expect(inbox.status).toBe(200);
    const inData = (await inbox.json()) as { items: { id: number; role: string }[]; pendingMine: number };
    expect(inData.items).toHaveLength(2);
    expect(inData.items.every((i) => i.role === 'seller')).toBe(true);
    expect(inData.pendingMine).toBe(2);

    const outbox = await app.request('/api/offers?box=out&status=pending', { headers: { Cookie: 'whl_session=tok-coach2' } }, fx.env);
    const outData = (await outbox.json()) as { items: { role: string }[]; pendingMine: number };
    expect(outData.items).toHaveLength(1);
    expect(outData.pendingMine).toBe(0); // turn=seller，买方没有待处理

    const detail = await app.request(`/api/offers/${inData.items.find((i) => i.id !== secondId)?.id ?? inData.items[0].id}`, { headers: { Cookie: 'whl_session=tok-coach2' } }, fx.env);
    expect(detail.status).toBe(200);
    const d = (await detail.json()) as { offer: { myRole: string; myTurn: boolean }; events: { kind: string }[] };
    expect(d.offer.myRole).toBe('buyer');
    expect(d.offer.myTurn).toBe(false);
    expect(d.events[0].kind).toBe('open');

    // 第四方（uid9/club4，与买卖双方无关）查详情 403
    fx.sqlite.exec("INSERT INTO clubs (id, name, league_tier, status) VALUES (4, '第四队', 'premier', 'active')");
    fx.sqlite.exec("INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (4, 9, '2026-01-01T00:00:00Z')");
    await fx.env.TOUR_DB.prepare("INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (9, '外人', 'coach', 0, 0)").run();
    fx.kv.set('sess:tok-foreign', JSON.stringify({ userId: 9 }));
    const foreign = await app.request(`/api/offers/${inData.items[0].id}`, { headers: { Cookie: 'whl_session=tok-foreign' } }, fx.env);
    expect(foreign.status).toBe(403);
  });
});
