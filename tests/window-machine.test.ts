// 窗口状态机测试（§11/§6.4-6）：开窗重掷、关窗前置校验（活跃会话/匹配等待/待审队列）、
// 强制结算开关、窗尾收口。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { createConfigService } from '../src/core/config.ts';

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

// 基础局：两 club、球员+合同、窗口 1 开着
async function seedWindow(): Promise<Fixture & { clubA: number; clubB: number }> {
  const fx = freshEnv();
  const clubA = await createClub(fx, '甲队');
  const clubB = await createClub(fx, '乙队');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [clubA, 'tok-coach'],
    [clubB, 'tok-coach2'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${clubA}, 100, '2026-07-01T00:00:00Z'), (${clubB}, 100, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${clubA}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${clubB}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (50, 'fc50', '甲核心', ${clubA}, 'ST', 26, 85, 88, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 50, ${clubA}, 20, 2, 'formal', 1, '2026-06-01');`,
  );
  return { ...fx, clubA, clubB };
}

// 窗 1 内走完一次普通转会挂牌（bidding 态、未截止）
async function seedLiveBidding(fx: Fixture): Promise<void> {
  expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
  expect((await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env)).status).toBe(201);
}

describe('开窗', () => {
  it('无在开窗口时开新窗顺延 windowSeq，自动建赛季档；重掷按 rng 走', async () => {
    const fx = await seedWindow();
    // rng 序列：第 1 次 0.1（<0.3 重掷）→ 第 2 次 0.99 → 档位 3；其余 0.99 不掷
    let call = 0;
    fx.env.rng = () => (call++ === 0 ? 0.1 : 0.99);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1`);
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { season: number; windowSeq: number; rerolled: number };
    expect(body.season).toBe(1);
    expect(body.windowSeq).toBe(2);
    expect(body.rerolled).toBe(1);
    const tier = sqlGet<{ agent_tier: number }>(fx.sqlite, 'SELECT agent_tier FROM players WHERE id = 50');
    expect(tier?.agent_tier).toBe(3); // 0.99 → 1 + floor(2.97) = 3
  });

  it('还有窗口开着时不能开新窗', async () => {
    const fx = await seedWindow();
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
  });
});

describe('关窗', () => {
  it('关窗成功：窗尾收口把竞价单转待审（新待审留给下一窗处理）', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    const close1 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(close1.status).toBe(200);
    const win = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM season_windows WHERE season = 1 AND window_seq = 1');
    expect(win?.status).toBe('closed');
    const listing = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1');
    expect(listing?.status).toBe('pending_review');
  });

  it('已有关键节点未决（活跃谈判会话）挡关窗；force + window_force_settle=true 时按 E 强结并完成过户', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    // 关窗（窗尾收口转待审）→ 批准成交进签约谈判
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
    const taskId = ((await queue.json()) as { reviews: { id: number }[] }).reviews[0].id;
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 窗口已关，再关 → 409 无窗口
    const close2 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(close2.status).toBe(409);
    expect(((await close2.json()) as { error: string }).error).toContain('没有开着的窗口');

    // 开窗 2 → 关窗被活跃会话挡
    fx.env.rng = () => 0.99;
    expect((await post('/api/admin/windows/open', {}, 'tok-admin', fx.env)).status).toBe(201);
    const close3 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(close3.status).toBe(409);
    expect(((await close3.json()) as { error: string }).error).toContain('1 场签约谈判没结束');

    // 打开强制结算开关；会话先提交新 RC（E 快照）→ force 关窗成功，会话按 E 强约、过户完成
    const config = createConfigService(fx.env.DB);
    await config.set('window_force_settle', 'true');
    const feeRes = await post('/api/negotiations/1/release-fee', { fee: 15 }, 'tok-coach2', fx.env);
    expect(feeRes.status).toBe(200);
    fx.env.rng = () => 0.99;
    const close4 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(close4.status).toBe(200);
    expect(((await close4.json()) as { forceSettled: number }).forceSettled).toBe(1);
    const transfer = sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE idempotency_key = 'listing:1'");
    expect(transfer?.status).toBe('completed');
    const session = sqlGet<{ status: string; settle_source: string }>(
      fx.sqlite,
      "SELECT status, settle_source FROM negotiation_sessions WHERE transfer_id = (SELECT id FROM transfers WHERE idempotency_key = 'listing:1')",
    );
    expect(session).toMatchObject({ status: 'settled', settle_source: 'forced' });
  });

  it('匹配等待单挡关窗', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, activated_by, activation_deadline, match_deadline, season, window_seq)
       VALUES (50, ${fx.clubA}, 'activation', 40, 'matched_pending', '2026-07-01T02:00:00Z', '2026-07-01', ${fx.clubB}, NULL, '2027-01-01T00:00:00Z', 1, 1)`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('匹配等待期');
  });

  it('无活跃事项时正常关窗，窗尾无人出价的挂牌收下架费', async () => {
    const fx = await seedWindow();
    // 只挂牌未出价
    expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const win = sqlGet<{ status: string; closed_at: string | null }>(fx.sqlite, 'SELECT status, closed_at FROM season_windows WHERE season = 1 AND window_seq = 1');
    expect(win?.status).toBe('closed');
    expect(win?.closed_at).not.toBeNull();
    const listing = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1');
    expect(listing?.status).toBe('delisted');
    const fee = sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND club_id = ${fx.clubA}`);
    expect(fee?.amount).toBe(-1.5); // 15 × 10%
  });
});
