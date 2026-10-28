// 关窗期报价与「意向单」（v6.29.0）：关窗期照样能报价 / 还价 / 同意 → 落意向单（不挂牌），
// 开窗后**只有卖方**能确认，确认才走既有挂牌链路（挂牌 + 兄弟 pending 过期 + hold 转正 + 领先出价）；
// v6.55.0 起唯一性从球员级放宽为买方级（多家买方可并存，卖方开窗后择一确认，落选方收 offer_intent_lost）；
// 买方撤回 / 卖方放弃 / 置非卖品 / 球员状态变化各自收口；意向单能活到后面赛季的窗。
// 变异验证对应关系（开发期手动改坏 → 确认该组变红 → 还原）：
//   ④ enterIntent 去掉 NOT EXISTS 买方级唯一闸 → 「一买方一意向单」组变红
//   ⑤ acceptOffer 意向单分支去掉 role !== 'seller' 的 409 → 「只有卖方能确认」组变红
//   ⑥ acceptOffer 关窗分支改回直接落挂牌 → 「关窗期同意落意向单」组变红
//   ⑦ window-machine.openWindow 删掉意向单提醒 → tests/window-machine.test.ts 开窗提醒组变红
//   ⑧ expireStaleOffers 候选人只留 pending（丢 intent 自愈）→ 「球员状态变化」组变红
//   ⑨ fulfill 删掉意向单收口 UPDATE → 「确认一条，其余意向单收口」组变红
//   ⑩ finalizeOffer 删掉终态守卫 → 「finalizeOffer 终态守卫」组变红
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

// 三支真人队（1 阿森纳 / 2 拜仁 / 3 蓝港）：uid 2 绑 club1、uid 5 绑 club2、uid 3 绑 club3
function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    // 兼容模式会话要从 TOUR_DB user 表读角色（与 offers.test.ts 同构的最小镜像）
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
    [3, 'tok-coach3'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, kv };
}

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

// 本文件主角是「关窗期」，默认窗口就是关的（windowOpen: true 用于开窗确认那一组）
function seedWorld(fx: Fixture, opts: { windowOpen?: boolean } = {}): void {
  const open = opts.windowOpen ?? false;
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '拜仁', 'premier', 'active'), (3, '蓝港', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, '${open ? 'open' : 'closed'}', '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z'), (3, 3, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES
      (1, 'uid1', '球员甲', 1, 'ST', 80, 85, 'normal', 11),
      (2, 'uid2', '球员乙', 2, 'CM', 75, 82, 'normal', 12);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (2, 2, 50, 2, 'formal', 'import', '2026-07-01', 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-01T00:00:00Z'), (2, 100, '2026-07-01T00:00:00Z'), (3, 100, '2026-07-01T00:00:00Z');
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
  listingId?: number | null;
}

async function place(fx: Fixture, playerId: number, amount: number, token = 'tok-coach2'): Promise<Response> {
  return send(fx.env, 'POST', '/api/offers', { playerId, amount }, token);
}

/** 关窗期标准前戏：买方（club2）送报价 → 卖方（club1）同意 → 拿到一条意向单 */
async function seedIntent(fx: Fixture, amount = 30): Promise<number> {
  return seedIntentFor(fx, 'tok-coach2', amount);
}

/** 同上，买方换人（v6.55.0 多买方并存用）：token 指定买方，同意仍由卖方（club1）点 */
async function seedIntentFor(fx: Fixture, token: string, amount = 30): Promise<number> {
  const res = await place(fx, 1, amount, token);
  expect(res.status).toBe(201);
  const id = ((await res.json()) as OfferOut).offerId as number;
  const acc = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
  expect(acc.status).toBe(200);
  expect(((await acc.json()) as OfferOut).status).toBe('intent');
  return id;
}

const holdsOf = (fx: Fixture, offerId: number) =>
  sqlAll<{ id: number; status: string; amount: number }>(
    fx.sqlite,
    "SELECT id, status, amount FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ? ORDER BY id",
    offerId,
  );

describe('关窗期同意 → 意向单（不挂牌、不动兄弟单、冻结保持）', () => {
  it('首轮同意：status=intent、season/window_seq 仍为 NULL、无挂牌、冻结 held、intent 事件 + 审计 + 双方通知', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    expect(res.status).toBe(201);
    const id = ((await res.json()) as OfferOut).offerId as number;

    const acc = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(200);
    expect((await acc.json()) as OfferOut).toMatchObject({ ok: true, status: 'intent', listingId: null });

    expect(sqlGet(fx.sqlite, 'SELECT status, listing_id, season, window_seq, turn FROM offers WHERE id = ?', id)).toMatchObject({
      status: 'intent',
      listing_id: null,
      season: null,
      window_seq: null,
    });
    // 球员不进「挂牌中」，也不该有挂牌记录
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'normal' });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM listings WHERE player_id = 1')).toBeUndefined();
    // 冻结照旧 held（不转挂牌、不释放）
    expect(holdsOf(fx, id)).toEqual([expect.objectContaining({ status: 'held', amount: 30 })]);
    expect(sqlGet<{ note: string }>(fx.sqlite, "SELECT note FROM offer_events WHERE offer_id = ? AND kind = 'intent'", id)?.note).toContain('意向单');
    expect(sqlGet(fx.sqlite, "SELECT id FROM audit_log WHERE action = 'offer_intent'")).toBeDefined();
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_created'")?.n).toBe(2);
  });

  it('还价后同意：买方先补足冻结到新价，落 intent 且兄弟单照旧 pending + held', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    // 兄弟单：第三队对同一球员报 32（关窗期照收）
    const sib = await place(fx, 1, 32, 'tok-coach3');
    expect(sib.status).toBe(201);
    const sibId = ((await sib.json()) as OfferOut).offerId as number;

    // 关窗期还价不再被 isWindowOpen 拦
    const counter = await send(fx.env, 'POST', `/api/offers/${id}/counter`, { amount: 35 }, 'tok-coach');
    expect(counter.status).toBe(200);

    const acc = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach2');
    expect(acc.status).toBe(200);
    expect((await acc.json()) as OfferOut).toMatchObject({ ok: true, status: 'intent', listingId: null });
    expect(sqlGet(fx.sqlite, 'SELECT status, amount, season, window_seq FROM offers WHERE id = ?', id)).toMatchObject({
      status: 'intent',
      amount: 35,
      season: null,
      window_seq: null,
    });
    // 旧冻结释放、新冻结 35 held（补足后仍是「冻结在报价上」）
    expect(holdsOf(fx, id)).toEqual([
      expect.objectContaining({ status: 'released', amount: 30 }),
      expect.objectContaining({ status: 'held', amount: 35 }),
    ]);
    // 兄弟单不受影响：不过期、冻结不释放
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', sibId)).toMatchObject({ status: 'pending' });
    expect(holdsOf(fx, sibId)).toEqual([expect.objectContaining({ status: 'held', amount: 32 })]);
  });

  it('关窗期达线自动同意同样只落意向单（不凭空造窗外挂牌）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec('UPDATE players SET transfer_listed = 1, min_offer_price = 40, offer_auto = 1 WHERE id = 1');
    const res = await place(fx, 1, 45);
    expect(res.status).toBe(201);
    expect((await res.json()) as OfferOut).toMatchObject({ status: 'intent', auto: 'auto_accept' });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE player_id = 1')).toMatchObject({ status: 'intent' });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM listings WHERE player_id = 1')).toBeUndefined();
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'normal' });
  });
});

describe('一买方一意向单（多买方可并存，v6.55.0）', () => {
  it('多家买方各落一条意向单；同买方再报第二条 409（dup 预检把 intent 算活跃）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30); // club2 → 意向单 A
    // club3 也谈成一条：买方级唯一不再挡别家（球员级并存在放开之列）
    const b = await place(fx, 1, 32, 'tok-coach3');
    expect(b.status).toBe(201);
    const bId = ((await b.json()) as OfferOut).offerId as number;
    // 关窗期同意由卖方（club1）点：club3 的 pending → intent
    const accB = await send(fx.env, 'POST', `/api/offers/${bId}/accept`, {}, 'tok-coach');
    expect(accB.status).toBe(200);
    expect((await accB.json()) as OfferOut).toMatchObject({ ok: true, status: 'intent', listingId: null });
    // 两条意向单并存，各自冻结保持 held
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', a)).toMatchObject({ status: 'intent' });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', bId)).toMatchObject({ status: 'intent' });
    expect(holdsOf(fx, a)).toEqual([expect.objectContaining({ status: 'held', amount: 30 })]);
    expect(holdsOf(fx, bId)).toEqual([expect.objectContaining({ status: 'held', amount: 32 })]);

    // 同买方（club3）再报一条：dup 预检把 intent 一并算活跃
    const dup = await place(fx, 1, 36, 'tok-coach3');
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as OfferOut).error).toContain('你已经有一条');
  });

  it('已有意向单：挂牌端点仍 409 intent_exists（文案不再说「一条」）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await seedIntent(fx, 30);
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");

    const res = await send(fx.env, 'POST', '/api/market/listings', { playerId: 1, askPrice: 40 }, 'tok-coach');
    expect(res.status).toBe(409);
    const body = (await res.json()) as OfferOut;
    expect(body).toMatchObject({ code: 'intent_exists' });
    expect(body.error).not.toContain('一条');
    expect(sqlGet(fx.sqlite, 'SELECT id FROM listings WHERE player_id = 1')).toBeUndefined();
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'normal' });
  });

  it('轮次不是闸仍要守：没轮到买方时买方也碰不到意向单（409 只有卖方能确认）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    // 关窗期卖方同意的入口只有一条：intent 上的 confirm 由卖方来点
    const buyerConfirm = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach2');
    expect(buyerConfirm.status).toBe(409);
    expect((await buyerConfirm.json()) as OfferOut).toMatchObject({ code: 'not_your_turn' });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'pending' });
  });
});

describe('卖方确认（开窗后）', () => {
  it('买方点确认 → 409 intent_seller_only；卖方在没窗时也确认不了（409 no_window）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);

    const buyer = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach2');
    expect(buyer.status).toBe(409);
    expect((await buyer.json()) as OfferOut).toMatchObject({ code: 'intent_seller_only' });

    const seller = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(seller.status).toBe(409);
    expect((await seller.json()) as OfferOut).toMatchObject({ code: 'no_window' });
    // 两次失败都不改状态
    expect(sqlGet(fx.sqlite, 'SELECT status, season FROM offers WHERE id = ?', id)).toMatchObject({ status: 'intent', season: null });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM listings WHERE player_id = 1')).toBeUndefined();
  });

  it('确认落地：归窗到当前窗 + 挂牌 + 兄弟单过期 + hold 转正 + 领先出价 + confirm 事件 + 买方通知', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);
    const sib = await place(fx, 1, 32, 'tok-coach3');
    const sibId = ((await sib.json()) as OfferOut).offerId as number;

    // 开窗（同赛季第二窗），意向单应归到这一窗
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");
    const acc = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(200);
    const out = (await acc.json()) as OfferOut;
    expect(out).toMatchObject({ ok: true, status: 'accepted' });
    const listingId = out.listingId as number;
    expect(listingId).toBeGreaterThan(0);

    expect(sqlGet(fx.sqlite, 'SELECT status, listing_id, season, window_seq FROM offers WHERE id = ?', id)).toMatchObject({
      status: 'accepted',
      listing_id: listingId,
      season: 1,
      window_seq: 2,
    });
    expect(sqlGet(fx.sqlite, 'SELECT player_id, seller_club_id, ask_price, status, season, window_seq FROM listings WHERE id = ?', listingId)).toMatchObject({
      player_id: 1,
      seller_club_id: 1,
      ask_price: 30,
      status: 'listed',
      season: 1,
      window_seq: 2,
    });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'listed' });
    // 冻结从「报价」转成「挂牌」的冻结，并生成领先出价
    const listingHold = sqlGet<{ id: number; status: string; amount: number }>(
      fx.sqlite,
      "SELECT id, status, amount FROM fund_holds WHERE ref_type = 'listing' AND ref_id = ?",
      listingId,
    );
    expect(listingHold).toMatchObject({ status: 'held', amount: 30 });
    expect(sqlGet(fx.sqlite, 'SELECT club_id, amount, status, hold_id FROM bids WHERE listing_id = ?', listingId)).toMatchObject({
      club_id: 2,
      amount: 30,
      status: 'active',
      hold_id: listingHold?.id,
    });
    // 兄弟 pending 单此刻才过期 + 释放
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', sibId)).toMatchObject({ status: 'expired' });
    expect(holdsOf(fx, sibId)).toEqual([expect.objectContaining({ status: 'released' })]);
    // 事件 kind=confirm；买方收到确认通知，兄弟买方收到 offer_expired('sold')
    expect(sqlGet(fx.sqlite, "SELECT id FROM offer_events WHERE offer_id = ? AND kind = 'confirm'", id)).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_intent_confirmed'")).toBeDefined();
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_expired' AND club_id = 3")?.n).toBe(1);
  });

  it('意向单能活到后面赛季的窗口：确认时按「当前开着的窗」归窗', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);
    fx.sqlite.exec(`
      UPDATE season_windows SET status = 'closed', closed_at = '2026-08-31T00:00:00Z' WHERE season = 1 AND window_seq = 1;
      INSERT INTO seasons (season, status) VALUES (2, 'running');
      INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (2, 1, 'open', '2027-07-01T00:00:00Z');
    `);
    // 关窗 + 换赛季都不会把意向单收掉
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'intent' });

    const acc = await send(fx.env, 'POST', `/api/offers/${id}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(200);
    const listingId = ((await acc.json()) as OfferOut).listingId as number;
    expect(sqlGet(fx.sqlite, 'SELECT season, window_seq FROM offers WHERE id = ?', id)).toMatchObject({ season: 2, window_seq: 1 });
    expect(sqlGet(fx.sqlite, 'SELECT season, window_seq FROM listings WHERE id = ?', listingId)).toMatchObject({ season: 2, window_seq: 1 });
  });
});

describe('意向单的两种了结与自动收口', () => {
  it('卖方放弃：rejected + 释放冻结 + reject 事件说明 + 通知买方 offer_intent_closed', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);

    const res = await send(fx.env, 'POST', `/api/offers/${id}/reject`, {}, 'tok-coach');
    expect(res.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status, resolved_at FROM offers WHERE id = ?', id)).toMatchObject({ status: 'rejected' });
    expect(holdsOf(fx, id)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet<{ note: string }>(fx.sqlite, "SELECT note FROM offer_events WHERE offer_id = ? AND kind = 'reject'", id)?.note).toContain('放弃');
    const notif = sqlGet<{ club_id: number; payload: string }>(fx.sqlite, "SELECT club_id, payload FROM notifications WHERE template = 'offer_intent_closed'");
    expect(notif?.club_id).toBe(2); // 通知买方
    expect(notif?.payload).toContain('放弃');
  });

  it('买方撤回：withdrawn + 释放冻结 + withdraw 事件说明 + 通知卖方 offer_intent_closed', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);

    const res = await send(fx.env, 'POST', `/api/offers/${id}/withdraw`, {}, 'tok-coach2');
    expect(res.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'withdrawn' });
    expect(holdsOf(fx, id)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet<{ note: string }>(fx.sqlite, "SELECT note FROM offer_events WHERE offer_id = ? AND kind = 'withdraw'", id)?.note).toContain('撤回');
    const notif = sqlGet<{ club_id: number; payload: string }>(fx.sqlite, "SELECT club_id, payload FROM notifications WHERE template = 'offer_intent_closed'");
    expect(notif?.club_id).toBe(1); // 通知卖方
    expect(notif?.payload).toContain('撤回');
  });

  it('置非卖品：意向单与 pending 一并自动拒 + 释放 + 双方各自收到 offer_rejected', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);
    const sib = await place(fx, 1, 32, 'tok-coach3');
    const sibId = ((await sib.json()) as OfferOut).offerId as number;

    const res = await send(fx.env, 'PUT', '/api/players/1/offer-settings', { transferListed: false, minOfferPrice: null, notForSale: true }, 'tok-coach');
    expect(res.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'rejected' });
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', sibId)).toMatchObject({ status: 'rejected' });
    expect(holdsOf(fx, id)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(holdsOf(fx, sibId)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_rejected'")?.n).toBe(2);
  });

  it('球员状态变化：意向单自愈过期（note 说明 + 双方 offer_expired 带 state 原因）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);
    fx.sqlite.exec("UPDATE players SET club_id = NULL, status = 'free' WHERE id = 1");

    const { expireStaleOffers } = await import('../src/worker/offers.ts');
    const summary = await expireStaleOffers(fx.env, { origin: 'user' });
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'expired' });
    expect(holdsOf(fx, id)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet<{ note: string }>(fx.sqlite, "SELECT note FROM offer_events WHERE offer_id = ? AND kind = 'expire'", id)?.note).toContain('意向单');
    const notifs = sqlAll<{ club_id: number; payload: string }>(fx.sqlite, "SELECT club_id, payload FROM notifications WHERE template = 'offer_expired' ORDER BY club_id");
    expect(notifs.map((n) => n.club_id)).toEqual([1, 2]);
    expect(notifs.every((n) => n.payload.includes('球员状态已变'))).toBe(true);
  });

  it('关窗期的 pending 单不会被静默收口：expireStaleOffers 只认球员状态与占用', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;

    const { expireStaleOffers } = await import('../src/worker/offers.ts');
    const summary = await expireStaleOffers(fx.env, { origin: 'user' });
    expect(summary.expired).toBe(0);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'pending' });
  });
});

describe('清单里的意向单（status=intent / intentsMine）', () => {
  it('双方都能按 intent 过滤看到它，myTurn 为 false，intentsMine 各记 1', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const id = await seedIntent(fx, 30);

    const inbox = await app.request('/api/offers?box=in&status=intent', { headers: { Cookie: 'whl_session=tok-coach' } }, fx.env);
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as { items: { id: number; status: string; myTurn: boolean }[]; pendingMine: number; intentsMine: number };
    expect(inboxBody.items).toHaveLength(1);
    expect(inboxBody.items[0]).toMatchObject({ id, status: 'intent', myTurn: false });
    expect(inboxBody).toMatchObject({ pendingMine: 0, intentsMine: 1 });

    const outbox = await app.request('/api/offers?box=out&status=intent', { headers: { Cookie: 'whl_session=tok-coach2' } }, fx.env);
    expect(outbox.status).toBe(200);
    expect((await outbox.json()) as { intentsMine: number }).toMatchObject({ intentsMine: 1 });

    // 非法 status 的文案把 intent 列出来
    const bad = await app.request('/api/offers?box=in&status=intents', { headers: { Cookie: 'whl_session=tok-coach' } }, fx.env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as OfferOut).error).toContain('intent');
  });
});

describe('确认一条，其余意向单收口（v6.55.0 择一）', () => {
  it('确认 A：B 的意向单转 expired + 冻结释放，B 买方收 offer_intent_lost 且不收 offer_expired(sold)', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30);
    const b = await seedIntentFor(fx, 'tok-coach3', 32);
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");

    const acc = await send(fx.env, 'POST', `/api/offers/${a}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(200);
    expect(((await acc.json()) as OfferOut).status).toBe('accepted');

    // B 被收口批转 expired、冻结释放
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', b)).toMatchObject({ status: 'expired' });
    expect(holdsOf(fx, b)).toEqual([expect.objectContaining({ status: 'released' })]);
    // B 买方（club3）收 offer_intent_lost，ref = 自己那张单（深链落「我送出的」）
    const lost = sqlAll<{ club_id: number; payload: string }>(
      fx.sqlite,
      "SELECT club_id, payload FROM notifications WHERE template = 'offer_intent_lost'",
    );
    expect(lost.map((n) => n.club_id)).toEqual([3]);
    expect(lost[0].payload).toContain('意向落选');
    expect(lost[0].payload).toContain('球员甲');
    expect(lost[0].payload).toContain(`"id":${b}`);
    // 收口路径不产生 offer_expired('sold')（那是 pending 兄弟的文案，意向单走落选通知）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_expired' AND club_id = 3")?.n).toBe(0);
    // 落选事件（blanket expire 形态、无 note）与胜者确认通知在场
    expect(sqlGet(fx.sqlite, "SELECT id FROM offer_events WHERE offer_id = ? AND kind = 'expire'", b)).toBeDefined();
    expect(sqlGet(fx.sqlite, "SELECT id FROM notifications WHERE template = 'offer_intent_confirmed'")).toBeDefined();
  });

  it('开窗期同意 pending 单：同球员意向单兄弟一并被收口（同一收口批）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30); // club2 关窗期落的意向单（season 为 NULL，开窗后仍然活着）
    // 先开窗再让 club3 送报价：开窗期报价单带 season/window_seq，同意时走挂牌链路（acceptOfferCore）
    // 而非转意向单——关窗期落的单 season 为 NULL，isWindowOpen(null, null) 恒假，即使新窗已开
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");
    const pRes = await place(fx, 1, 32, 'tok-coach3');
    expect(pRes.status).toBe(201);
    const pId = ((await pRes.json()) as OfferOut).offerId as number;

    // 开窗期同意 pending（acceptOfferCore → fulfill）：intent 兄弟被收口批一并失效
    const acc = await send(fx.env, 'POST', `/api/offers/${pId}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(200);
    expect(((await acc.json()) as OfferOut).status).toBe('accepted');
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', a)).toMatchObject({ status: 'expired' });
    expect(holdsOf(fx, a)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_lost' AND club_id = 2")?.n).toBe(1);
  });

  it('跨窗老意向单一并被收（收口 UPDATE 不带窗过滤，Q2d）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30);
    const b = await seedIntentFor(fx, 'tok-coach3', 32);
    // 把 B 伪装成上一窗存活下来的老意向单（归过窗、窗已关）
    fx.sqlite.prepare('UPDATE offers SET season = 1, window_seq = 1 WHERE id = ?').run(b);
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");

    const acc = await send(fx.env, 'POST', `/api/offers/${a}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', b)).toMatchObject({ status: 'expired' });
    expect(holdsOf(fx, b)).toEqual([expect.objectContaining({ status: 'released' })]);
  });
});

describe('双确认与非卖品赛跑（occupy 守卫，v6.55.0）', () => {
  it('完整确认后确认第二条：409（第二条已被收口批转 expired，不再是 intent）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30);
    const b = await seedIntentFor(fx, 'tok-coach3', 32);
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");
    expect((await send(fx.env, 'POST', `/api/offers/${a}/accept`, {}, 'tok-coach')).status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', b)).toMatchObject({ status: 'expired' });

    const acc2 = await send(fx.env, 'POST', `/api/offers/${b}/accept`, {}, 'tok-coach');
    expect(acc2.status).toBe(409);
    expect(((await acc2.json()) as OfferOut).error).toContain('已经了结');
  });

  it('悬挂 accepted（占用成功履约未跑）时确认第二条：被 occupy 守卫拦 409，不走闪变路径', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30);
    const b = await seedIntentFor(fx, 'tok-coach3', 32);
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");
    // 制造悬挂：A 已占用成 accepted 但 listing_id 还没写回（履约批没跑）。
    // 直调 acceptOffer（绕开路由层的 settleOverdue——那会把悬挂单自愈掉，复现不出赛跑窗）
    fx.sqlite.prepare("UPDATE offers SET status = 'accepted', season = 1, window_seq = 2 WHERE id = ?").run(a);

    const { acceptOffer } = await import('../src/worker/offers.ts');
    await expect(acceptOffer(fx.env, { offerId: b, clubId: 1, actor: 2 })).rejects.toMatchObject({ status: 409 });
    expect(sqlGet(fx.sqlite, 'SELECT status, listing_id FROM offers WHERE id = ?', b)).toMatchObject({ status: 'intent', listing_id: null });
  });

  it('非卖品赛跑：读态之后占用批之前被置非卖品 → occupy 守卫拦下，意向单原样', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const a = await seedIntent(fx, 30);
    fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z')");
    // 单线程复现毫秒窗：loadOffer 读到 not_for_sale=0 之后、占用批执行前，球员被直插置非卖品
    //（loadOffer 的 403 预检查的是读态，拦不住这个窗口，只能靠 occupy 的 NOT EXISTS）
    const real = fx.env.DB;
    const raceEnv: Env = {
      ...fx.env,
      DB: new Proxy(real, {
        get(target, prop) {
          if (prop === 'prepare') {
            return (sql: string) => {
              if (sql.includes("SET status = 'accepted', season = ?")) {
                fx.sqlite.exec('UPDATE players SET not_for_sale = 1 WHERE id = 1');
              }
              return target.prepare(sql);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      }) as D1Database,
    };

    const acc = await send(raceEnv, 'POST', `/api/offers/${a}/accept`, {}, 'tok-coach');
    expect(acc.status).toBe(409);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', a)).toMatchObject({ status: 'intent' });
    expect(holdsOf(fx, a)).toEqual([expect.objectContaining({ status: 'held' })]);
    expect(sqlGet(fx.sqlite, 'SELECT id FROM listings WHERE player_id = 1')).toBeUndefined();
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'normal' });
  });
});

describe('fulfill 履约守卫（非卖品）与自愈收口', () => {
  it('悬挂 accepted + 非卖品：expireStaleOffers 收口 expired，球员不被翻转成 listed，其它意向单不误伤', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    // 对照面先落一条正常意向单（club3）；悬挂单随后直插翻转（不走 API——路由的 settleOverdue
    // 会先自愈掉悬挂单，复现不出「占用了、履约失败」的中间态）
    const intentB = await seedIntentFor(fx, 'tok-coach3', 32);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    fx.sqlite.prepare("UPDATE offers SET status = 'accepted' WHERE id = ?").run(id);
    fx.sqlite.exec('UPDATE players SET not_for_sale = 1 WHERE id = 1');

    const { expireStaleOffers } = await import('../src/worker/offers.ts');
    const summary = await expireStaleOffers(fx.env, { origin: 'user' });
    expect(summary.fulfilled).toBe(0);
    expect(summary.expired).toBe(1);
    // 悬挂单收口 expired + 冻结释放；players UPDATE 的同款守卫保证球员不被翻转成 listed
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', id)).toMatchObject({ status: 'expired' });
    expect(holdsOf(fx, id)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM players WHERE id = 1')).toMatchObject({ status: 'normal' });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM listings WHERE player_id = 1')).toBeUndefined();
    // 对照面：正常意向单不被误伤（not_for_sale 不在惰性过期的 stale 判据里）
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', intentB)).toMatchObject({ status: 'intent' });
    expect(holdsOf(fx, intentB)).toEqual([expect.objectContaining({ status: 'held' })]);
  });
});

describe('rollbackGhostOffer 直测（真并发窗：dup 预检读与买方级闸之间的幽灵单）', () => {
  function seedGhost(fx: Fixture, status: string): void {
    fx.sqlite.exec(`
      INSERT INTO offers (player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at)
      VALUES (1, 2, 1, 30, 30, 0, '${status}', 'seller', NULL, NULL, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
      INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
      VALUES (2, 30, 'held', 'offer', 1, '2026-07-01T00:00:00Z');
      UPDATE offers SET hold_id = (SELECT id FROM fund_holds WHERE ref_type = 'offer' AND ref_id = 1) WHERE id = 1;
    `);
  }

  it('pending + held hold：rejected + released + reject 事件 + 审计', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedGhost(fx, 'pending');
    const { rollbackGhostOffer } = await import('../src/worker/offers.ts');
    type GhostOffer = Parameters<typeof rollbackGhostOffer>[1];
    const offer = sqlGet<GhostOffer>(fx.sqlite, 'SELECT * FROM offers WHERE id = 1');
    expect(offer).toBeDefined();
    expect(await rollbackGhostOffer(fx.env, offer!, 2)).toBe(true);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = 1')).toMatchObject({ status: 'rejected' });
    expect(holdsOf(fx, 1)).toEqual([expect.objectContaining({ status: 'released' })]);
    expect(sqlGet<{ note: string }>(fx.sqlite, "SELECT note FROM offer_events WHERE offer_id = 1 AND kind = 'reject'")?.note).toContain('并发意向闸挡回');
    expect(sqlGet(fx.sqlite, "SELECT id FROM audit_log WHERE action = 'offer_reject' AND target_id = 1")).toBeDefined();
  });

  it('对 accepted 单调用：四条全空转（状态/冻结/事件/审计都不动）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedGhost(fx, 'pending');
    fx.sqlite.exec("UPDATE offers SET status = 'accepted' WHERE id = 1");
    const { rollbackGhostOffer } = await import('../src/worker/offers.ts');
    type GhostOffer = Parameters<typeof rollbackGhostOffer>[1];
    const offer = sqlGet<GhostOffer>(fx.sqlite, 'SELECT * FROM offers WHERE id = 1');
    expect(await rollbackGhostOffer(fx.env, offer!, 2)).toBe(false);
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = 1')).toMatchObject({ status: 'accepted' });
    expect(holdsOf(fx, 1)).toEqual([expect.objectContaining({ status: 'held' })]);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM offer_events WHERE offer_id = 1')?.n).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'offer_reject'")?.n).toBe(0);
  });
});

describe('finalizeOffer 终态守卫（撤回与确认赛跑输掉，资金不被动）', () => {
  it('赢家把 hold 转成挂牌冻结后，对原 pending 单 withdraw：409 且 hold 不释放、事件审计不落', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await place(fx, 1, 30);
    const id = ((await res.json()) as OfferOut).offerId as number;
    // 单线程复现赛跑窗：withdraw 的终态批执行前，卖方已把这条单同意挂牌（accepted + hold 转 listing 冻结）。
    // 终态批的第一条 UPDATE 会 0 行（status 已不是 pending），修掉资金洞后后三条必须跟着空转。
    const real = fx.env.DB;
    const raceEnv: Env = {
      ...fx.env,
      DB: new Proxy(real, {
        get(target, prop) {
          if (prop === 'batch') {
            return async (stmts: D1PreparedStatement[]) => {
              fx.sqlite.exec(`UPDATE offers SET status = 'accepted', updated_at = '2026-07-01T01:00:00Z' WHERE id = ${id}`);
              fx.sqlite.exec(`UPDATE fund_holds SET ref_type = 'listing', ref_id = 77 WHERE ref_type = 'offer' AND ref_id = ${id}`);
              return target.batch(stmts);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      }) as D1Database,
    };

    const wd = await send(raceEnv, 'POST', `/api/offers/${id}/withdraw`, {}, 'tok-coach2');
    expect(wd.status).toBe(409);
    // hold 不被释放：它已随赢家转成挂牌冻结（ref_type='listing' / ref_id=77），仍是 held
    //（原报价冻结按 ref_type='offer' 已查不到——所以断言查挂牌那一行，而不是 holdsOf）
    expect(sqlGet(fx.sqlite, "SELECT id FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ?", id)).toBeUndefined();
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'listing' AND ref_id = 77")).toMatchObject({ status: 'held' });
    // 事件与审计不落
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM offer_events WHERE offer_id = ? AND kind = 'withdraw'", id)?.n).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'offer_withdraw'")?.n).toBe(0);
  });
});
