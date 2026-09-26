// 强制拍卖测试（规则 4.4.5）：CA 前六（含并列、不含门将）人选校验、1m 挂牌、
// 正常竞价链成交、整单税 50%、管理组取消。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
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
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
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
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId: clubSeq }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

// 被拍卖队（8 人：CA 90..76 非门将 7 人 + 门将；并列 CA84 两名）+ 竞买队（50m）
// + 豪门队（7 名高 CA 非门将）：若按联盟口径，受罚队第六（CA 82）会被压出前六——201 断言据此钉死队内语义
async function seedAuction(): Promise<Fixture & { club: number; buyer: number; rich: number }> {
  const fx = freshEnv();
  const club = await createClub(fx, '受罚队');
  const buyer = await createClub(fx, '接盘队');
  const rich = await createClub(fx, '豪门队');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [club, 'tok-coach'],
    [buyer, 'tok-coach2'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${club}, 60, '2026-07-01T00:00:00Z'), (${buyer}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${club}, 'opening_import', 60, 60, '期初', '2026-07-01T00:00:00Z'),
       (${buyer}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (40, 'fc40', '头牌', ${club}, 'ST', 26, 90, 90, 'normal'),
       (41, 'fc41', '二牌', ${club}, 'CM', 26, 88, 88, 'normal'),
       (42, 'fc42', '三牌', ${club}, 'CB', 27, 86, 86, 'normal'),
       (43, 'fc43', '并列甲', ${club}, 'CM', 25, 84, 84, 'normal'),
       (44, 'fc44', '并列乙', ${club}, 'RB', 25, 84, 84, 'normal'),
       (45, 'fc45', '第六', ${club}, 'LM', 24, 82, 82, 'normal'),
       (46, 'fc46', '第七', ${club}, 'RM', 24, 80, 80, 'normal'),
       (47, 'fc47', '门神', ${club}, 'GK', 28, 91, 91, 'normal'),
       (50, 'fc50', '豪门一', ${rich}, 'ST', 26, 95, 95, 'normal'),
       (51, 'fc51', '豪门二', ${rich}, 'CM', 26, 93, 93, 'normal'),
       (52, 'fc52', '豪门三', ${rich}, 'CB', 27, 92, 92, 'normal'),
       (53, 'fc53', '豪门四', ${rich}, 'CM', 25, 91, 91, 'normal'),
       (54, 'fc54', '豪门五', ${rich}, 'RB', 25, 90, 90, 'normal'),
       (55, 'fc55', '豪门六', ${rich}, 'LM', 24, 89, 89, 'normal'),
       (56, 'fc56', '豪门七', ${rich}, 'RM', 24, 88, 88, 'normal'),
       (57, 'fc57', '豪门门神', ${rich}, 'GK', 28, 96, 96, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 45, ${club}, 20, 2, 'formal', 1, '2026-06-01'),
       (2, 46, ${club}, 20, 2, 'formal', 1, '2026-06-01'),
       (3, 47, ${club}, 20, 2, 'formal', 1, '2026-06-01');`,
  );
  return { ...fx, club, buyer, rich };
}

async function openReviewTaskId(fx: Fixture): Promise<number> {
  const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
  const reviews = ((await queue.json()) as { reviews: { id: number }[] }).reviews;
  expect(reviews.length).toBeGreaterThan(0);
  return reviews[0].id;
}

describe('强制拍卖（4.4.5）', () => {
  it('人选校验：前六（含并列）可拍、第七与门将不可拍', async () => {
    const fx = await seedAuction();
    // CA 82 是本队非门将第六（84 并列占四、五）；豪门队 7 名非门将 CA 均 > 82，
    // 若按联盟口径这里会排到第 13 名而 409——201 即钉死「队内前六」语义
    const ok = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(ok.status).toBe(201);
    const okBody = (await ok.json()) as { askPrice: number; listingId: number };
    expect(okBody.askPrice).toBe(1);
    // 取消后重试边界
    const listingId = okBody.listingId;
    expect((await post(`/api/admin/forced-auctions/${listingId}/cancel`, {}, 'tok-admin', fx.env)).status).toBe(200);

    const seventh = await post('/api/admin/forced-auctions', { playerId: 46 }, 'tok-admin', fx.env);
    expect(seventh.status).toBe(409);
    const gk = await post('/api/admin/forced-auctions', { playerId: 47 }, 'tok-admin', fx.env);
    expect(gk.status).toBe(400);
    // 队内口径对豪门队同样生效：CA 88 是豪门队非门将第七
    const richSeventh = await post('/api/admin/forced-auctions', { playerId: 56 }, 'tok-admin', fx.env);
    expect(richSeventh.status).toBe(409);
  });

  it('CPU 队球员不参与强制拍卖（v2.0.0：CPU 队不入账）', async () => {
    const fx = await seedAuction();
    fx.sqlite.exec(
      `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (131681, 'AC米兰(CPU)', 'premier', 'active', 1);
       INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (60, 'fc60', '米兰头牌', 131681, 'ST', 26, 95, 95, 'normal');`,
    );
    const res = await post('/api/admin/forced-auctions', { playerId: 60 }, 'tok-admin', fx.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('CPU 队球员不参与强制拍卖');
  });

  it('成交链：1m 挂牌 → 竞价 → 待审 → 批准进谈判 → 成约按整单 50% 税过户', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;

    expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env)).status).toBe(201);
    // 拨到过去触发截止（4.4.7 静默判定；deadline_at 清空 = 模拟落库列之前的存量行）
    fx.sqlite.exec(
      `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                            listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = ${listingId}`,
    );
    await get('/api/market/listings?status=all', 'tok-coach2', fx.env);
    const transferRow = sqlGet<{ id: number; type: string; status: string; fee: number }>(
      fx.sqlite,
      'SELECT id, type, status, fee FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transferRow).toMatchObject({ type: 'forced_auction', status: 'pending_review', fee: 5 });

    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    // 买方谈新 RC（卖方 RC20 → ±10 区间内取 15）
    const feeRes = await post(`/api/negotiations/${transferRow!.id}/release-fee`, { fee: 15 }, 'tok-coach2', fx.env);
    expect(feeRes.status).toBe(200);
    const e = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    expect((await post(`/api/negotiations/${transferRow!.id}/offer`, { wage: e }, 'tok-coach2', fx.env)).status).toBe(200);

    const done = sqlGet<{ status: string; tax: number; fee: number }>(
      fx.sqlite,
      'SELECT status, tax, fee FROM transfers WHERE id = ?',
      transferRow!.id,
    );
    expect(done).toMatchObject({ status: 'completed', tax: 2.5, fee: 5 }); // 整单 50%
    const buyerEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE club_id = ${fx.buyer} AND kind = 'transfer_in'`,
    );
    expect(buyerEntry?.amount).toBe(-5);
    const sellerEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE club_id = ${fx.club} AND kind = 'transfer_out'`,
    );
    expect(sellerEntry?.amount).toBe(5);
    const taxEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE club_id = ${fx.club} AND kind = 'transfer_tax'`,
    );
    expect(taxEntry?.amount).toBe(-2.5);
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 45');
    expect(player).toEqual({ club_id: fx.buyer, status: 'normal' });
  });

  it('窗尾无人出价 → 下架收 10% 挂牌费（0.1m）', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    // 关窗触发窗尾收口
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    const listing = sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', ((await create.json()) as { listingId: number }).listingId);
    expect(listing?.status).toBe('delisted');
    const feeEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND club_id = ${fx.club}`,
    );
    expect(feeEntry?.amount).toBe(-0.1);
  });
});
