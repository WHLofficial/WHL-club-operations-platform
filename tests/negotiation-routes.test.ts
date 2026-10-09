// 签约谈判路由测试（§6.7/§6.10）：开会话、新 RC 区间与 E 快照、报价三路径（成功/强约/直败）、
// 直签训练营、结算-过户分批自愈、响应面收敛、鉴权。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import { previewForecast } from '../src/worker/negotiations.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
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
       (3, '教练丙', 'coach', 0, 0),
       (4, '教练丁', 'coach', 0, 0),
       (9, '观众', 'user', 0, 0);`,
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
    [4, 'tok-coach3'],
    [9, 'tok-viewer'],
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

interface SigningFixture extends Fixture {
  sellerClub: number;
  buyerClub: number;
  sessionId: number;
}

// 卖方（100m）/买方（50m）+ 球员 10（RC 20、wage 2、26 岁 CA85 PA88）成交待审 → 批准进 signing
async function seedSigning(fx: Fixture): Promise<SigningFixture> {
  const sellerClub = await createClub(fx, '卖方');
  const buyerClub = await createClub(fx, '买方');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [sellerClub, 'tok-coach'],
    [buyerClub, 'tok-coach2'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${sellerClub}, 100, '2026-07-01T00:00:00Z'), (${buyerClub}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${sellerClub}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${buyerClub}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
       (10, 'fc10', '王牌', ${sellerClub}, 'ST', 26, 85, 88, 30, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 10, ${sellerClub}, 20, 2, 'formal', 1, '2026-07-01');`,
  );
  expect((await post('/api/market/listings', { playerId: 10, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
  expect((await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env)).status).toBe(201);
  fx.sqlite.exec(
    `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                          listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = 1`,
  );
  await get('/api/market/listings?status=pending_review', 'tok-viewer', fx.env);
  const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
  const taskId = ((await queue.json()) as { reviews: { id: number }[] }).reviews[0].id;
  const approve = await post(`/api/admin/reviews/${taskId}/approve`, { note: '成交确认' }, 'tok-admin', fx.env);
  expect(approve.status).toBe(200);
  expect(((await approve.json()) as { status: string }).status).toBe('signing');
  const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
  const sessionId = ((await mine.json()) as { sessions: { id: number }[] }).sessions[0].id;
  return { ...fx, sellerClub, buyerClub, sessionId };
}

describe('开会话（审核通过 → signing）', () => {
  it('会话分配签入方、审核表落批、重复批准被挡', async () => {
    const fx = await seedSigning(freshEnv());
    const session = sqlGet<{ id: number; transfer_id: number; club_id: number; status: string; expected_wage: number | null; attempt_count: number }>(
      fx.sqlite,
      'SELECT id, transfer_id, club_id, status, expected_wage, attempt_count FROM negotiation_sessions WHERE id = ?',
      fx.sessionId,
    );
    expect(session).toMatchObject({ transfer_id: 1, club_id: fx.buyerClub, status: 'active', expected_wage: null, attempt_count: 0 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM review_tasks WHERE id = 1')?.status).toBe('approved');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'negotiation_open'")?.n).toBe(1);

    const again = await post('/api/admin/reviews/1/approve', {}, 'tok-admin', fx.env);
    expect(again.status).toBe(409);

    // 卖方视角看不到别人的谈判
    const seller = await get('/api/negotiations?mine=1', 'tok-coach', fx.env);
    expect(((await seller.json()) as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('查询面：缺 mine=1 被拒；观众与未绑定教练 403', async () => {
    const fx = await seedSigning(freshEnv());
    expect((await get('/api/negotiations', 'tok-coach2', fx.env)).status).toBe(400);
    expect((await get('/api/negotiations?mine=1', 'tok-viewer', fx.env)).status).toBe(403);
    const admin = await get('/api/negotiations?mine=1', 'tok-admin', fx.env);
    expect(admin.status).toBe(403);
    expect(((await admin.json()) as { error: string }).error).toContain('绑定俱乐部');
    expect((await get('/api/negotiations?mine=1', 'tok-coach3', fx.env)).status).toBe(403);
  });
});

describe('新违约金与 E 快照', () => {
  it('未交 RC 不能报价；非法值与越界被拒；交 RC 出 E、重设更新', async () => {
    const fx = await seedSigning(freshEnv());
    const early = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 1 }, 'tok-coach2', fx.env);
    expect(early.status).toBe(400);
    expect(((await early.json()) as { error: string }).error).toContain('先提交新违约金');

    for (const bad of [0, -5, 2.5, 'abc']) {
      expect((await post(`/api/negotiations/1/release-fee`, { fee: bad }, 'tok-coach2', fx.env)).status).toBe(400);
    }
    const low = await post('/api/negotiations/1/release-fee', { fee: 9 }, 'tok-coach2', fx.env);
    expect(((await low.json()) as { error: string }).error).toBe('新违约金需在 10~30 之间（整数 m）');
    expect((await post('/api/negotiations/1/release-fee', { fee: 31 }, 'tok-coach2', fx.env)).status).toBe(400);

    const fee15 = await post('/api/negotiations/1/release-fee', { fee: 15 }, 'tok-coach2', fx.env);
    expect(fee15.status).toBe(200);
    expect(((await fee15.json()) as { ok: boolean; releaseFee: number; expectedWage: number })).toEqual({ ok: true, releaseFee: 15, expectedWage: 2.73 });

    const fee20 = await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    expect(((await fee20.json()) as { expectedWage: number }).expectedWage).toBe(3.11); // L7·F20
    expect(sqlGet<{ expected_wage: number; release_fee: number }>(
      fx.sqlite,
      'SELECT expected_wage, release_fee FROM negotiation_sessions WHERE id = ?',
      fx.sessionId,
    )).toEqual({ expected_wage: 3.11, release_fee: 20 });
    expect(sqlGet<{ actor: number }>(fx.sqlite, "SELECT actor FROM audit_log WHERE action = 'negotiation_fee'")?.actor).toBe(3);
  });

  it('卖方动会话 403（RC/报价/直签三条路）', async () => {
    const fx = await seedSigning(freshEnv());
    expect((await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach', fx.env)).status).toBe(403);
    expect((await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 3 }, 'tok-coach', fx.env)).status).toBe(403);
    expect((await post(`/api/negotiations/${fx.sessionId}/trainee`, {}, 'tok-coach', fx.env)).status).toBe(403);
  });
});

describe('报价判定三路径', () => {
  it('成功：报价 ≥ E 必成，成约即过户写合同', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    // 球衣号是俱乐部的东西：换队后新东家重新定号，旧号必须清掉
    fx.sqlite.exec("UPDATE players SET number = '11' WHERE id = 10");
    fx.env.rng = () => 0.9;
    const res = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 3.11 }, 'tok-coach2', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string; attemptNo: number; remaining: number; wage: number; message: string };
    expect(body).toMatchObject({ result: 'success', attemptNo: 1, remaining: 0, wage: 3.11 });

    expect(sqlGet<{ status: string; tax: number }>(fx.sqlite, 'SELECT status, tax FROM transfers WHERE id = 1')).toEqual({ status: 'completed', tax: 1.5 });
    expect(
      sqlGet<{ wage: number; release_fee: number; source: string; contract_type: string }>(
        fx.sqlite,
        'SELECT wage, release_fee, source, contract_type FROM contracts WHERE player_id = 10 AND is_active = 1',
      ),
    ).toEqual({ wage: 3.11, release_fee: 20, source: 'negotiation', contract_type: 'formal' });
    expect(sqlGet<{ club_id: number; status: string; number: string | null }>(fx.sqlite, 'SELECT club_id, status, number FROM players WHERE id = 10')).toEqual({
      club_id: fx.buyerClub,
      status: 'normal',
      number: null,
    });
    expect(sqlGet<{ balance: number }>(fx.sqlite, `SELECT balance FROM ledger_accounts WHERE club_id = ${fx.buyerClub}`)?.balance).toBe(35);
    // 已结束的会话不能再报价
    expect((await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 4 }, 'tok-coach2', fx.env)).status).toBe(409);
  });

  it('离队回收中国计划徽章：成约后 china 明细删掉、台账同步减，成长得来的留着', async () => {
    const fx = await seedSigning(freshEnv());
    fx.sqlite.exec(`
      UPDATE players SET badges_silver = 5, china_plan = 1 WHERE id = 10;
      INSERT INTO player_playstyles (player_id, slot, kind, psid, source, created_at) VALUES
        (10, 1, 'silver', 1, 'growth', '2026-01-01T00:00:00Z'),
        (10, 2, 'silver', 2, 'china', '2026-01-02T00:00:00Z'),
        (10, 3, 'silver', 3, 'china', '2026-01-03T00:00:00Z');
    `);

    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    fx.env.rng = () => 0.9;
    const res = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 3.11 }, 'tok-coach2', fx.env);
    expect(res.status).toBe(200);
    expect(sqlGet<{ club_id: number }>(fx.sqlite, 'SELECT club_id FROM players WHERE id = 10')?.club_id).toBe(fx.buyerClub);
    // 走的是成长得来的 1 个留在身上，2 个中国计划的随离队失效
    expect(
      sqlAll<{ slot: number; source: string }>(fx.sqlite, 'SELECT slot, source FROM player_playstyles WHERE player_id = 10 ORDER BY slot'),
    ).toEqual([{ slot: 1, source: 'growth' }]);
    expect(sqlGet<{ badges_silver: number }>(fx.sqlite, 'SELECT badges_silver FROM players WHERE id = 10')?.badges_silver).toBe(3);
  });

  it('三轮未谈拢 → 按 E 强制成约', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    fx.env.rng = () => 0.9;
    expect(((await (await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.5 }, 'tok-coach2', fx.env)).json()) as { remaining: number }).remaining).toBe(2);
    expect(((await (await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.6 }, 'tok-coach2', fx.env)).json()) as { remaining: number }).remaining).toBe(1);
    const third = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.7 }, 'tok-coach2', fx.env);
    expect(((await third.json()) as { result: string; wage: number; attemptNo: number })).toMatchObject({ result: 'forced', wage: 3.11, attemptNo: 3 });
    expect(
      sqlGet<{ wage: number; source: string }>(
        fx.sqlite,
        'SELECT wage, source FROM contracts WHERE player_id = 10 AND is_active = 1',
      ),
    ).toEqual({ wage: 3.11, source: 'forced' });
    expect(sqlGet<{ status: string; settled_wage: number; settle_source: string }>(
      fx.sqlite,
      'SELECT status, settled_wage, settle_source FROM negotiation_sessions WHERE id = ?',
      fx.sessionId,
    )).toEqual({ status: 'settled', settled_wage: 3.11, settle_source: 'forced' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('completed');
  });

  it('直败：第 2 次报价按 eff（E×0.95）结算', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    fx.env.rng = () => 0.9;
    const first = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.5 }, 'tok-coach2', fx.env);
    expect(((await first.json()) as { result: string }).result).toBe('fail');
    fx.env.rng = () => 0.1;
    const second = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.6 }, 'tok-coach2', fx.env);
    const body = (await second.json()) as { result: string; wage: number; message: string };
    expect(body).toMatchObject({ result: 'direct', wage: 2.95 }); // round(3.11 × 0.95, 2)
    expect(body.message).toContain('直接失败');
    expect(
      sqlGet<{ wage: number; source: string; result: string }>(
        fx.sqlite,
        'SELECT wage, source FROM contracts WHERE player_id = 10 AND is_active = 1',
      ) ?? sqlGet<{ result: string }>(fx.sqlite, 'SELECT result FROM negotiation_attempts WHERE session_id = ? AND attempt_no = 2', fx.sessionId),
    ).toEqual({ wage: 2.95, source: 'direct' });
    expect(sqlGet<{ result: string }>(fx.sqlite, 'SELECT result FROM negotiation_attempts WHERE session_id = ? AND attempt_no = 2', fx.sessionId)?.result).toBe('direct_fail');
  });

  it('单调性：低于上次被拒不耗次数；报价越界被拒', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    fx.env.rng = () => 0.9;
    await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 1 }, 'tok-coach2', fx.env);
    expect((await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.5 }, 'tok-coach2', fx.env)).status).toBe(400);
    expect((await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 25 }, 'tok-coach2', fx.env)).status).toBe(400);
    expect(sqlGet<{ attempt_count: number }>(fx.sqlite, 'SELECT attempt_count FROM negotiation_sessions WHERE id = ?', fx.sessionId)?.attempt_count).toBe(1);
  });
});

describe('直签训练营', () => {
  it('固定 0.75/5 成约，覆盖已提交的新 RC，不占下放名额', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    const res = await post(`/api/negotiations/${fx.sessionId}/trainee`, {}, 'tok-coach2', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string; wage: number; message: string };
    expect(body.result).toBe('trainee');
    expect(body.wage).toBe(0.75);
    expect(body.message).toContain('不占本窗下放名额');
    expect(
      sqlGet<{ wage: number; release_fee: number; source: string; contract_type: string }>(
        fx.sqlite,
        'SELECT wage, release_fee, source, contract_type FROM contracts WHERE player_id = 10 AND is_active = 1',
      ),
    ).toEqual({ wage: 0.75, release_fee: 5, source: 'trainee', contract_type: 'trainee' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 10')).toEqual({ status: 'trainee' });
    expect(sqlGet<{ status: string; settle_source: string }>(
      fx.sqlite,
      'SELECT status, settle_source FROM negotiation_sessions WHERE id = ?',
      fx.sessionId,
    )).toEqual({ status: 'settled', settle_source: 'trainee' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('completed');
  });
});

describe('结算-过户分批自愈', () => {
  it('会话已结算但过户未跟上 → 列表触碰即补过户', async () => {
    const fx = await seedSigning(freshEnv());
    fx.sqlite.exec(
      `UPDATE negotiation_sessions SET status = 'settled', settled_wage = 3.11, settle_source = 'negotiation',
         release_fee = 20, expected_wage = 3.11 WHERE id = ${fx.sessionId}`,
    );
    const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
    const session = ((await mine.json()) as { sessions: { id: number; status: string; settled: { wage: number; source: string; message: string } }[] }).sessions[0];
    expect(session.status).toBe('settled');
    expect(session.settled).toMatchObject({ wage: 3.11, source: 'negotiation' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('completed');
    expect(
      sqlGet<{ wage: number; source: string }>(fx.sqlite, 'SELECT wage, source FROM contracts WHERE player_id = 10 AND is_active = 1'),
    ).toEqual({ wage: 3.11, source: 'negotiation' });
  });
});

describe('响应面收敛（§6.10-2）', () => {
  it('列表会话与报价响应均不含判定参数', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    fx.env.rng = () => 0.9;
    await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 0.5 }, 'tok-coach2', fx.env);
    const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
    const sessions = ((await mine.json()) as { sessions: Record<string, unknown>[] }).sessions;
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    for (const forbidden of ['p', 'eff', 'effExpected', 'threshold', 'probability', 'slope', 'decay']) {
      expect(s).not.toHaveProperty(forbidden);
    }
    const attempts = s.attempts as Record<string, unknown>[];
    expect(Object.keys(attempts[0]).sort()).toEqual(['at', 'attemptNo', 'feedback', 'offeredWage', 'result']);
    expect(s.agentTierLabel).toBe('普通');
  });
});

// v6.40.0 对话式改造：预览端点（D5 四档 0.2/0.5/0.8）与逐轮反馈落库
describe('工资预览（成功率档位）', () => {
  it('档位边界逐值：0.2 / 0.5 / 0.8 归上档', () => {
    expect(previewForecast(1)).toBe('成功率很高');
    expect(previewForecast(0.8)).toBe('成功率很高');
    expect(previewForecast(0.7999)).toBe('成功率过半');
    expect(previewForecast(0.5)).toBe('成功率过半');
    expect(previewForecast(0.4999)).toBe('成功率偏低');
    expect(previewForecast(0.2)).toBe('成功率偏低');
    expect(previewForecast(0.1999)).toBe('成功率很低');
    expect(previewForecast(0)).toBe('成功率很低');
  });

  it('预览零副作用：不落库 / 不耗次数 / 不写审计 / 不成约；响应只含档位与风险', async () => {
    const fx = await seedSigning(freshEnv());
    expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 5 }, 'tok-coach2', fx.env)).status).toBe(400);
    const feeRes = await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    const expectedWage = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    const auditBefore = sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'negotiation_offer'")?.n;

    const res = await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: expectedWage }, 'tok-coach2', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['forecast', 'risk']);
    // 报 E 本身必成（successRate 在 offered ≥ expected 时恒 1）
    expect(body.forecast).toBe('成功率很高');
    expect(body.risk).toBe(false);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM negotiation_attempts WHERE session_id = ?', fx.sessionId)?.n).toBe(0);
    expect(sqlGet<{ attempt_count: number }>(fx.sqlite, 'SELECT attempt_count FROM negotiation_sessions WHERE id = ?', fx.sessionId)?.attempt_count).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'negotiation_offer'")?.n).toBe(auditBefore);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('signing');
  });

  it('未交 RC / 非法值 / 越界 / 不升价被拒；档位不随经纪人档位变', async () => {
    const fx = await seedSigning(freshEnv());
    expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 5 }, 'tok-coach2', fx.env)).status).toBe(400);
    const feeRes = await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    const expectedWage = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    expect((await post('/api/negotiations/abc/preview', { wage: 5 }, 'tok-coach2', fx.env)).status).toBe(400);
    for (const bad of [0, -1, 25, 'abc']) {
      expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: bad }, 'tok-coach2', fx.env)).status).toBe(400);
    }

    const probe = Math.round(expectedWage * 0.85 * 100) / 100;
    fx.sqlite.exec('UPDATE players SET agent_tier = 1 WHERE id = 10');
    const mild = (await (await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: probe }, 'tok-coach2', fx.env)).json()) as { forecast: string };
    fx.sqlite.exec('UPDATE players SET agent_tier = 3 WHERE id = 10');
    const harsh = (await (await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: probe }, 'tok-coach2', fx.env)).json()) as { forecast: string };
    expect(harsh.forecast).toBe(mild.forecast);

    fx.sqlite.exec('UPDATE players SET agent_tier = 2 WHERE id = 10');
    fx.env.rng = () => 0.9;
    await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: 1 }, 'tok-coach2', fx.env);
    expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 1 }, 'tok-coach2', fx.env)).status).toBe(400);
    expect(sqlGet<{ attempt_count: number }>(fx.sqlite, 'SELECT attempt_count FROM negotiation_sessions WHERE id = ?', fx.sessionId)?.attempt_count).toBe(1);
  });

  it('次数已满回 409 且不替玩家强约；鉴权与 GET 我的会话同级', async () => {
    const fx = await seedSigning(freshEnv());
    await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 5 }, 'tok-viewer', fx.env)).status).toBe(403);
    expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 5 }, 'tok-coach3', fx.env)).status).toBe(403);
    expect((await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 5 }, 'tok-coach', fx.env)).status).toBe(403);

    fx.sqlite.exec(
      `INSERT INTO negotiation_attempts (session_id, attempt_no, offered_wage, eff_expected, result) VALUES
         (${fx.sessionId}, 1, 1, 1, 'fail'), (${fx.sessionId}, 2, 2, 1, 'fail'), (${fx.sessionId}, 3, 3, 1, 'fail')`,
    );
    fx.sqlite.exec(`UPDATE negotiation_sessions SET attempt_count = 3 WHERE id = ${fx.sessionId}`);
    const res = await post(`/api/negotiations/${fx.sessionId}/preview`, { wage: 9 }, 'tok-coach2', fx.env);
    expect(res.status).toBe(409);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM negotiation_sessions WHERE id = ?', fx.sessionId)?.status).toBe('active');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('signing');
  });
});

describe('逐轮反馈落库（对话流左气泡）', () => {
  it('失败轮：反馈句与风险布尔落库，列表回读带 at / feedback，lastSatisfaction 同源', async () => {
    const fx = await seedSigning(freshEnv());
    const feeRes = await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    const expectedWage = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    fx.env.rng = () => 0.9; // 不直败、不成约 → 记一轮失败

    const res = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: Math.max(0.02, Math.round(expectedWage * 0.6 * 100) / 100) }, 'tok-coach2', fx.env);
    const body = (await res.json()) as { result: string; satisfaction: string; risk: boolean };
    expect(body.result).toBe('fail');
    expect(body.risk).toBe(true);

    const row = sqlGet<{ feedback: string | null; risk: number; created_at: string }>(
      fx.sqlite,
      'SELECT feedback, risk, created_at FROM negotiation_attempts WHERE session_id = ? AND attempt_no = 1',
      fx.sessionId,
    );
    expect(row?.feedback).toBe(body.satisfaction);
    expect(row?.feedback).toContain('（报价过低，有谈崩风险）');
    expect(row?.risk).toBe(1);
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
    const s = ((await mine.json()) as { sessions: { lastSatisfaction: string | null; attempts: Record<string, unknown>[] }[] }).sessions[0];
    expect(s.attempts[0]).toMatchObject({ attemptNo: 1, result: 'fail', feedback: body.satisfaction, at: row?.created_at });
    expect(s.lastSatisfaction).toBe(body.satisfaction);
  });

  it('成功轮：同样落反馈句（不落风险后缀），风险位归 0', async () => {
    const fx = await seedSigning(freshEnv());
    const feeRes = await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    const expectedWage = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    const res = await post(`/api/negotiations/${fx.sessionId}/offer`, { wage: expectedWage }, 'tok-coach2', fx.env);
    expect(((await res.json()) as { result: string }).result).toBe('success');
    expect(
      sqlGet<{ feedback: string | null; risk: number }>(
        fx.sqlite,
        'SELECT feedback, risk FROM negotiation_attempts WHERE session_id = ? AND attempt_no = 1',
        fx.sessionId,
      ),
    ).toEqual({ feedback: '😍 经纪人非常满意', risk: 0 });
  });
});
