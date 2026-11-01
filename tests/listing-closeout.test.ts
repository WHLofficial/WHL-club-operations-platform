// 挂单终态收口（v6.66.0）：成交是挂单的终态之一。
// 回归的是「成功路径不回写 listings」——挂牌截止把挂单写成 pending_review，审核通过→谈判成约→
// 球员过户、钱划转，但挂单一直钉在 pending_review，findInFlight 把球员当「还在市场流程里」，
// 续约/解约/海捞/上调全被一票否决（2026-11-01 生产有 14 条）。
//
// 第二个用例锁 findInFlight 的谈判段：`s.status='active' AND t.status <> 'signing'` 里的
// `<> 'signing'` 是刻意的——今天所有 active 会话都还挂在 signing 上，各调用点另有 signing 闸，
// 谈判段只为「单据已结算、条款未谈定」（v6.68.0 翻转后的常态）兜底。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { ensureNotInFlight } from '../src/worker/bypass.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
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
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '教练丙', 'coach', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
  const kv = new Map<string, string>();
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
  // 谈判报价是概率判定（negotiations.ts offerWage：roll() < p）。测试里把随机源钉成 0，
  // 报价一次即成约；否则用例会随 1-p 的概率偶发红。
  env.rng = () => 0;
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-seller'],
    [3, 'tok-buyer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

function post(path: string, body: unknown, token: string | undefined, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

let clubSeq = 9000;
async function createClub(fx: Fixture, name: string): Promise<number> {
  clubSeq += 1;
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId: clubSeq, country: 14 }, 'tok-admin', fx.env);
  if (res.status !== 201) throw new Error(`createClub ${name} -> ${res.status} ${await res.text()}`);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

// 卖方 1 人 + 买方现金 50m；球员 70 是唯一被卖的人，合同 RC 20 / 工资 2。
async function seedDeal(): Promise<Fixture & { seller: number; buyer: number }> {
  const fx = freshEnv();
  const seller = await createClub(fx, '卖方队');
  const buyer = await createClub(fx, '买方队');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [seller, 'tok-seller'],
    [buyer, 'tok-buyer'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${seller}, 40, '2026-07-01T00:00:00Z'), (${buyer}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${seller}, 'opening_import', 40, 40, '期初', '2026-07-01T00:00:00Z'),
       (${buyer}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (70, 'fc70', '待售甲', ${seller}, 'ST', 26, 90, 90, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (70, 70, ${seller}, 20, 2, 'formal', 1, '2026-06-01');`,
  );
  return { ...fx, seller, buyer };
}

async function openReviewTaskId(fx: Fixture): Promise<number> {
  const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
  const reviews = ((await queue.json()) as { reviews: { id: number }[] }).reviews;
  expect(reviews.length).toBeGreaterThan(0);
  return reviews[0].id;
}

// 挂牌 → 出价 → 把竞价时间推老 → 拉一次市场列表触发结算 → 单据进 pending_review。
async function settleToReview(fx: Fixture & { seller: number; buyer: number }): Promise<{ listingId: number; transferId: number }> {
  const create = await post('/api/admin/forced-auctions', { playerId: 70, askPrice: 6 }, 'tok-admin', fx.env);
  expect(create.status).toBe(201);
  const listingId = ((await create.json()) as { listingId: number }).listingId;
  expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 6 }, 'tok-buyer', fx.env)).status).toBe(201);
  fx.sqlite.exec(
    `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                          listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = ${listingId}`,
  );
  await get('/api/market/listings?status=all', 'tok-buyer', fx.env);
  const transfer = sqlGet<{ id: number; status: string }>(
    fx.sqlite,
    'SELECT id, status FROM transfers WHERE idempotency_key = ?',
    `listing:${listingId}`,
  );
  expect(transfer?.status).toBe('pending_review');
  expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', listingId)?.status).toBe('pending_review');
  return { listingId, transferId: transfer!.id };
}

describe('挂单终态收口（v6.66.0）', () => {
  it('审核通过 → 谈判成约 → 过户：挂单必须落 delisted，球员才能再做其它操作', async () => {
    const fx = await seedDeal();
    const { listingId, transferId } = await settleToReview(fx);

    expect((await post(`/api/admin/reviews/${await openReviewTaskId(fx)}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    // 审核通过只把单据推进谈判，挂单仍是 pending_review（收口要靠成交）
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', listingId)?.status).toBe(
      'pending_review',
    );

    const mine = await get('/api/negotiations?mine=1', 'tok-buyer', fx.env);
    const session = ((await mine.json()) as { sessions: { id: number; transferId: number; expectedWage: number | null }[] }).sessions.find(
      (s) => s.transferId === transferId,
    );
    expect(session).toBeTruthy();
    // 卖方有现行合同 ⇒ 买家要先交新违约金（这就是 E 的来源），固定 F 的三型例外
    const feeRes = await post(`/api/negotiations/${transferId}/release-fee`, { fee: 20 }, 'tok-buyer', fx.env);
    if (feeRes.status !== 200) throw new Error(`release-fee -> ${feeRes.status} ${await feeRes.text()}`);
    const { expectedWage } = (await feeRes.json()) as { expectedWage: number };
    expect(expectedWage).toBeGreaterThan(0);
    const offer = await post(`/api/negotiations/${session!.id}/offer`, { wage: expectedWage }, 'tok-buyer', fx.env);
    if (offer.status !== 200) throw new Error(`offer -> ${offer.status} ${await offer.text()}`);

    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = ?', transferId)?.status).toBe('completed');
    // 本用例的靶子：成交后挂单必须收口
    expect(sqlGet<{ status: string; deadline_note: string | null }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', listingId)).toEqual({
      status: 'delisted',
      deadline_note: '已成交',
    });
    // 球员确实走了：归属与合同都在买方
    expect(sqlGet<{ club_id: number }>(fx.sqlite, 'SELECT club_id FROM players WHERE id = 70')?.club_id).toBe(fx.buyer);
    expect(sqlGet<{ club_id: number }>(fx.sqlite, 'SELECT club_id FROM contracts WHERE player_id = 70 AND is_active = 1')?.club_id).toBe(
      fx.buyer,
    );
    // 收口的直接收益：这名球员不再被 findInFlight 当成「还在市场流程里」
    await expect(ensureNotInFlight(fx.env.DB, 70)).resolves.toBeUndefined();
  });

  it('findInFlight 的谈判段：only「已结算 + 会话还开着」才算在途，signing 仍让给旧判据', async () => {
    const fx = await seedDeal();
    const { transferId } = await settleToReview(fx);
    expect((await post(`/api/admin/reviews/${await openReviewTaskId(fx)}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 挂单在 v6.68.0 翻转后于过户时收口；这里先把它挪走，才能单独观察谈判段
    fx.sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE player_id = 70`);

    // 今天（v6.66.0）的常态：会话 active 但单据 signing —— 旧判据负责，谈判段不越位改文案
    await expect(ensureNotInFlight(fx.env.DB, 70)).resolves.toBeUndefined();

    // v6.68.0 翻转后的常态：单据已 completed、会话还没谈定 —— 必须当成在途
    fx.sqlite.exec(`UPDATE transfers SET status = 'completed' WHERE id = ${transferId}`);
    await expect(ensureNotInFlight(fx.env.DB, 70)).rejects.toThrow('这名球员已经成交，还有一场签约谈判没结束，等它结束再操作');

    // 会话一收口（谈成/超时强约），闸就放开
    fx.sqlite.exec(`UPDATE negotiation_sessions SET status = 'settled' WHERE transfer_id = ${transferId}`);
    await expect(ensureNotInFlight(fx.env.DB, 70)).resolves.toBeUndefined();
  });
});
