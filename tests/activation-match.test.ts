// 激活+匹配全链测试（§6.2，规则 4.4.2）：普通球员倍数激活（保护期 2x/1.5x/1x）、
// 首价落定进匹配等待、匹配（新 RC>首价+差额销毁）/放行/24h 到期三条出路、生涯限匹配一次。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { expectedWage } from '../src/worker/negotiation-secret.ts';

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

async function createClub(fx: Fixture, name: string): Promise<number> {
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier' }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

interface MatchFixture extends Fixture {
  ownerClub: number;
  buyerClub: number;
}

// 被激活方（100m）+ 激活方（50m）+ 开放窗口；正式球员 RC10、保护期内（signed_at 近期）
async function seedActivation(fx: Fixture): Promise<MatchFixture> {
  const ownerClub = await createClub(fx, '原东家');
  const buyerClub = await createClub(fx, '撬人队');
  for (const [clubId, token] of [
    [ownerClub, 'tok-coach'],
    [buyerClub, 'tok-coach2'],
  ] as const) {
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${ownerClub}, 100, '2026-07-01T00:00:00Z'), (${buyerClub}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${ownerClub}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${buyerClub}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (30, 'fc30', '核心', ${ownerClub}, 'ST', 24, 80, 85, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from) VALUES
       (1, 30, ${ownerClub}, 10, 1, 'formal', 1, '2026-06-01T00:00:00Z', '2026-06-01');`,
  );
  return { ...fx, ownerClub, buyerClub };
}

async function activateCore(fx: MatchFixture): Promise<{ status: number; body: { ok?: boolean; listingId?: number; askPrice?: number; kind?: string; error?: string } }> {
  const res = await post('/api/transfers/activation', { playerId: 30 }, 'tok-coach2', fx.env);
  return { status: res.status, body: (await res.json()) as { ok?: boolean; listingId?: number; askPrice?: number; kind?: string; error?: string } };
}

// 激活 + 首价落定 → matched_pending 的现成局面
async function seedMatchPending(): Promise<MatchFixture & { listingId: number }> {
  const fx = await seedActivation(freshEnv());
  const act = await activateCore(fx);
  expect(act.status).toBe(201);
  const listingId = act.body.listingId!;
  expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 20 }, 'tok-coach2', fx.env)).status).toBe(201);
  return { ...fx, listingId };
}

async function openReviewTaskId(fx: Fixture): Promise<number> {
  const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
  const reviews = ((await queue.json()) as { reviews: { id: number }[] }).reviews;
  expect(reviews.length).toBeGreaterThan(0);
  return reviews[0].id;
}

describe('普通球员激活（倍数价）', () => {
  it('保护期内 RC≤20 → 2 倍价；首价落定 → matched_pending（24h 匹配窗）', async () => {
    const fx = await seedActivation(freshEnv());
    const act = await activateCore(fx);
    expect(act.status).toBe(201);
    expect(act.body.askPrice).toBe(20); // RC10 × 2（保护期）
    expect(act.body.kind).toBe('normal');
    const listingId = act.body.listingId!;

    const bid = await post(`/api/market/listings/${listingId}/bids`, { amount: 20 }, 'tok-coach2', fx.env);
    expect(bid.status).toBe(201);
    expect(((await bid.json()) as { matchPhase: string }).matchPhase).toBe('matching');

    const listing = sqlGet<{ status: string; match_deadline: string | null; activation_deadline: string | null }>(
      fx.sqlite,
      'SELECT status, match_deadline, activation_deadline FROM listings WHERE id = ?',
      listingId,
    );
    expect(listing?.status).toBe('matched_pending');
    expect(listing?.match_deadline).not.toBeNull();
    expect(listing?.activation_deadline).toBeNull();
    const player = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 30');
    expect(player?.status).toBe('listed');
  });

  it('保护期倍数：RC30 → 1.5 倍；保护期外 → 1 倍', async () => {
    const fx = await seedActivation(freshEnv());
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (31, 'fc31', '大牌', ${fx.ownerClub}, 'CM', 27, 86, 88, 'normal');
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from) VALUES
         (2, 31, ${fx.ownerClub}, 30, 3, 'formal', 1, '2026-06-01T00:00:00Z', '2026-06-01');`,
    );
    const big = await post('/api/transfers/activation', { playerId: 31 }, 'tok-coach2', fx.env);
    expect(big.status).toBe(201);
    expect(((await big.json()) as { askPrice: number }).askPrice).toBe(45); // 30 × 1.5

    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (32, 'fc32', '老臣', ${fx.ownerClub}, 'CB', 30, 80, 80, 'normal');
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from) VALUES
         (3, 32, ${fx.ownerClub}, 10, 1, 'formal', 1, '2024-01-01T00:00:00Z', '2024-01-01');`,
    );
    const vet = await post('/api/transfers/activation', { playerId: 32 }, 'tok-coach2', fx.env);
    expect(vet.status).toBe(201);
    expect(((await vet.json()) as { askPrice: number }).askPrice).toBe(10);
  });
});

describe('匹配 / 放行 / 到期', () => {
  it('放行：按激活价成交进待审', async () => {
    const fx = await seedMatchPending();
    const pass = await post('/api/transfers/match', { listingId: fx.listingId }, 'tok-coach', fx.env);
    expect(pass.status).toBe(201);
    expect(((await pass.json()) as { decision: string }).decision).toBe('pass');

    const transfer = sqlGet<{ type: string; fee: number; to_club_id: number; status: string }>(
      fx.sqlite,
      'SELECT type, fee, to_club_id, status FROM transfers WHERE idempotency_key = ?',
      `listing:${fx.listingId}`,
    );
    expect(transfer).toMatchObject({ type: 'activation', fee: 20, to_club_id: fx.buyerClub, status: 'pending_review' });
    // 非被激活方不能替人决定
    const fx2 = await seedMatchPending();
    expect((await post('/api/transfers/match', { listingId: fx2.listingId }, 'tok-coach2', fx2.env)).status).toBe(403);
  });

  it('匹配：单批收口（首价解冻、球员还原）、非被激活方 403、新 RC 必须高于首价', async () => {
    const fx = await seedMatchPending();
    const match = await post('/api/transfers/match', { listingId: fx.listingId, newReleaseFee: 25 }, 'tok-coach', fx.env);
    expect(match.status).toBe(201);
    const matchBody = (await match.json()) as { decision: string; diff: number };
    expect(matchBody.decision).toBe('match');
    expect(matchBody.diff).toBe(15); // 25 − 10

    const transfer = sqlGet<{ type: string; status: string; fee: number; matched: number; from_club_id: number; to_club_id: number }>(
      fx.sqlite,
      'SELECT type, status, fee, matched, from_club_id, to_club_id FROM transfers WHERE idempotency_key = ?',
      `match:${fx.listingId}`,
    );
    expect(transfer).toMatchObject({ type: 'match', status: 'pending_review', fee: 25, matched: 1, from_club_id: fx.ownerClub });
    const bid = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM bids WHERE listing_id = ?', fx.listingId);
    expect(bid?.status).toBe('withdrawn');
    const hold = sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'listing' AND ref_id = ?", fx.listingId);
    expect(hold?.status).toBe('released');
    const player = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 30');
    expect(player?.status).toBe('normal');
    const listing = sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', fx.listingId);
    expect(listing?.status).toBe('delisted'); // 挂牌落终态，释放一球员一活跃挂牌
    expect(listing?.deadline_note).toBe('被匹配，球员留队');

    const fx2 = await seedMatchPending();
    expect((await post('/api/transfers/match', { listingId: fx2.listingId, newReleaseFee: 25 }, 'tok-coach2', fx2.env)).status).toBe(403);
    expect((await post('/api/transfers/match', { listingId: fx2.listingId, newReleaseFee: 20 }, 'tok-coach', fx2.env)).status).toBe(400); // 不高于首价
    expect((await post('/api/transfers/match', { listingId: fx2.listingId, newReleaseFee: 25.5 }, 'tok-coach', fx2.env)).status).toBe(400);
  });

  it('匹配审核：差额销毁、进谈判（F=25 定死不加薪）→ 成约改合同不换主', async () => {
    const fx = await seedMatchPending();
    fx.env.rng = () => 0.7;
    expect((await post('/api/transfers/match', { listingId: fx.listingId, newReleaseFee: 25 }, 'tok-coach', fx.env)).status).toBe(201);
    const taskId = await openReviewTaskId(fx);
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { status: string }).status).toBe('signing');

    // 差额 15m 销毁（原东家付）
    const diffEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE kind = 'match_diff_burn' AND club_id = ${fx.ownerClub}`,
    );
    expect(diffEntry?.amount).toBe(-15);

    const sessionId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM negotiation_sessions WHERE club_id = ?", fx.ownerClub)?.id as number;
    const session = sqlGet<{ release_fee: number | null; expected_wage: number | null }>(
      fx.sqlite,
      'SELECT release_fee, expected_wage FROM negotiation_sessions WHERE id = ?',
      sessionId,
    );
    const e = expectedWage(6.5, 25, 0.02, 1.9, 0.45); // 24 岁 CA80/PA85 → (6+7)/2=6.5；匹配不乘加薪
    expect(session?.release_fee).toBe(25);
    expect(session?.expected_wage).toBe(e);

    expect((await post(`/api/negotiations/${sessionId}/offer`, { wage: e }, 'tok-coach', fx.env)).status).toBe(200);

    const done = sqlGet<{ status: string; tax: number; extra_fee: number | null }>(
      fx.sqlite,
      "SELECT status, tax, extra_fee FROM transfers WHERE type = 'match'",
    );
    expect(done).toMatchObject({ status: 'completed', tax: 0 });
    const contract = sqlGet<{ release_fee: number; wage: number; source: string; protected_until: string | null; club_id: number }>(
      fx.sqlite,
      'SELECT release_fee, wage, source, protected_until, club_id FROM contracts WHERE player_id = 30 AND is_active = 1',
    );
    expect(contract).toMatchObject({ release_fee: 25, source: 'negotiation', club_id: fx.ownerClub });
    expect(contract?.protected_until).not.toBeNull(); // 匹配后保护期收口
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 30');
    expect(player).toEqual({ club_id: fx.ownerClub, status: 'normal' });
    // 撬人队首价冻结已解、无任何划款
    const buyerEntries = sqlAll<{ kind: string }>(fx.sqlite, `SELECT kind FROM ledger_entries WHERE club_id = ${fx.buyerClub} AND kind != 'opening_import'`);
    expect(buyerEntries).toEqual([]);
  });

  it('匹配资金不足在提交时被挡', async () => {
    const fx = await seedMatchPending();
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 5 WHERE club_id = ${fx.ownerClub}`);
    const res = await post('/api/transfers/match', { listingId: fx.listingId, newReleaseFee: 25 }, 'tok-coach', fx.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('可用资金不足');
  });

  it('24h 匹配窗到期未决定 → 按激活价成交进待审（惰性结算）', async () => {
    const fx = await seedMatchPending();
    fx.sqlite.exec(`UPDATE listings SET match_deadline = '2026-07-01T01:00:00Z' WHERE id = ${fx.listingId}`);
    // 任何市场入口都先跑惰性结算
    await get('/api/market/listings?status=all', 'tok-coach2', fx.env);
    const listing = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', fx.listingId);
    expect(listing?.status).toBe('pending_review');
    const transfer = sqlGet<{ type: string; fee: number; status: string; to_club_id: number }>(
      fx.sqlite,
      'SELECT type, fee, status, to_club_id FROM transfers WHERE idempotency_key = ?',
      `listing:${fx.listingId}`,
    );
    expect(transfer).toMatchObject({ type: 'activation', fee: 20, status: 'pending_review', to_club_id: fx.buyerClub });
  });

  it('生涯只可被匹配一次（4.4.2.4）', async () => {
    const fx = await seedMatchPending();
    fx.env.rng = () => 0.5;
    expect((await post('/api/transfers/match', { listingId: fx.listingId, newReleaseFee: 25 }, 'tok-coach', fx.env)).status).toBe(201);
    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    const sessionId = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE club_id = ?', fx.ownerClub)?.id as number;
    const e = sqlGet<{ expected_wage: number }>(fx.sqlite, 'SELECT expected_wage FROM negotiation_sessions WHERE id = ?', sessionId)?.expected_wage ?? 0;
    expect((await post(`/api/negotiations/${sessionId}/offer`, { wage: e }, 'tok-coach', fx.env)).status).toBe(200);
    // 球员留队（匹配成约）。下窗再被激活，匹配应被生涯一次挡下
    fx.sqlite.exec(
      `UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1;
       INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-09-01T00:00:00Z');`,
    );
    const act2 = await activateCore(fx);
    expect(act2.status).toBe(201);
    const listingId2 = act2.body.listingId!;
    expect((await post(`/api/market/listings/${listingId2}/bids`, { amount: 25 }, 'tok-coach2', fx.env)).status).toBe(201);
    const rematch = await post('/api/transfers/match', { listingId: listingId2, newReleaseFee: 60 }, 'tok-coach', fx.env);
    expect(rematch.status).toBe(409);
  });
});
