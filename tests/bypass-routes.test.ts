// 旁路操作路由测试（§6.3/§6.4-5，规则 4.4.4/4.4.6/4.4.10）：续约提交与区间校验、
// 附加费审核时扣收（F 定死）、解约免费/收费与属性还原、窗内回滚（RC/保护期还原+退款）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { expectedWage } from '../src/worker/negotiation-secret.ts';
import { terminationFee } from '../src/core/bypass-rules.ts';

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
       (9, '观众', 'user', 0, 0);`,
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

async function createClub(fx: Fixture, name: string): Promise<number> {
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier' }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

interface BypassFixture extends Fixture {
  clubA: number;
  clubB: number;
}

// clubA（100m）/clubB（50m）+ 窗口开放 + clubA 名下三名球员：
// 20 乡贤 RC10 效力 2020（解约免费）/ 21 老将 RC20 效力近期（解约收费）/ 22 新秀 训练营合同
async function seedBypass(): Promise<BypassFixture> {
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
       (${clubA}, 100, '2026-07-01T00:00:00Z'), (${clubB}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${clubA}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${clubB}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, base_ca, market_value, status) VALUES
       (20, 'fc20', '乡贤', ${clubA}, 'ST', 26, 80, 82, 72, 15, 'normal'),
       (21, 'fc21', '老将', ${clubA}, 'CB', 29, 85, 85, 75, 25, 'normal'),
       (22, 'fc22', '新秀', ${clubA}, 'CM', 17, 55, 78, 55, 3, 'trainee'),
       (23, 'fc23', '无据', ${clubA}, 'GK', 30, 70, 70, 70, 5, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 20, ${clubA}, 10, 1, 'formal', 1, '2020-01-01'),
       (2, 21, ${clubA}, 20, 2.5, 'formal', 1, '2026-08-01'),
       (3, 22, ${clubA}, 5, 0.75, 'trainee', 1, '2026-08-01'),
       (4, 23, ${clubA}, 8, 1, 'formal', 1, NULL);`,
  );
  return { ...fx, clubA, clubB };
}

async function openReviewTaskId(fx: Fixture): Promise<number> {
  const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
  const reviews = ((await queue.json()) as { reviews: { id: number }[] }).reviews;
  expect(reviews.length).toBeGreaterThan(0);
  return reviews[0].id;
}

describe('续约（rc_change）', () => {
  it('提交落单：transfer + 审核任务 + 回链 + 附加费预览', async () => {
    const fx = await seedBypass();
    const res = await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 15 }, 'tok-coach', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { transferId: number; oldReleaseFee: number; changeFee: number };
    expect(body.oldReleaseFee).toBe(10);
    expect(body.changeFee).toBe(1.5);
    const t = sqlGet<{ type: string; fee: number; status: string; review_task_id: number; evidence: string; from_club_id: number; to_club_id: number }>(
      fx.sqlite,
      'SELECT type, fee, status, review_task_id, evidence, from_club_id, to_club_id FROM transfers WHERE id = ?',
      body.transferId,
    );
    expect(t?.type).toBe('rc_change');
    expect(t?.fee).toBe(15);
    expect(t?.status).toBe('pending_review');
    expect(t?.review_task_id).toBeGreaterThan(0);
    expect(JSON.parse(t?.evidence ?? '{}')).toEqual({ oldReleaseFee: 10, oldProtectedUntil: null });
    const task = sqlGet<{ payload: string }>(fx.sqlite, 'SELECT payload FROM review_tasks WHERE ref_id = ?', body.transferId);
    expect(JSON.parse(task?.payload ?? '{}')).toMatchObject({ kind: 'rc_change', oldReleaseFee: 10, newReleaseFee: 15, changeFee: 1.5 });
  });

  it('越界与非法输入被挡（±10m 区间 / 非整数）', async () => {
    const fx = await seedBypass();
    expect((await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 25 }, 'tok-coach', fx.env)).status).toBe(400);
    expect((await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 12.5 }, 'tok-coach', fx.env)).status).toBe(400);
    expect((await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 0 }, 'tok-coach', fx.env)).status).toBe(400);
  });

  it('训练营合同不能续约；他队球员不能续约；资金预检不足拒绝', async () => {
    const fx = await seedBypass();
    const trainee = await post('/api/transfers/rc-change', { playerId: 22, newReleaseFee: 8 }, 'tok-coach', fx.env);
    expect(trainee.status).toBe(400);
    const foreign = await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 15 }, 'tok-coach2', fx.env);
    expect(foreign.status).toBe(400);
    // 乙队 50m 足够，改用高差额：RC10→20 需 3m，甲队 100m 足够；换乙队自己的低余额场景不可行，
    // 这里验证提高 10（差额费 3m）成功提交的边界：把甲队余额临时压到 2m
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 2 WHERE club_id = ${fx.clubA}`);
    const poor = await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 20 }, 'tok-coach', fx.env);
    expect(poor.status).toBe(400);
  });

  it('审核通过：扣续约费 → 进谈判（F 定死、E×续约加薪）→ 成约改合同不换主', async () => {
    const fx = await seedBypass();
    fx.env.rng = () => 0.5; // 续约加薪取区间中点 (0.05+0.15)/2 → ×1.10
    const submit = await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 15 }, 'tok-coach', fx.env);
    expect(submit.status).toBe(201);
    const { transferId } = (await submit.json()) as { transferId: number };
    const taskId = await openReviewTaskId(fx);
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { status: string }).status).toBe('signing');

    const eBase = expectedWage(6, 15, 0.02, 1.9, 0.45); // 26 岁 CA80 → 等级 6
    const expectedE = Math.round(eBase * 1.1 * 100) / 100;
    const session = sqlGet<{ release_fee: number | null; expected_wage: number | null; club_id: number }>(
      fx.sqlite,
      'SELECT release_fee, expected_wage, club_id FROM negotiation_sessions WHERE transfer_id = ?',
      transferId,
    );
    expect(session?.release_fee).toBe(15);
    expect(session?.expected_wage).toBe(expectedE);
    expect(session?.club_id).toBe(fx.clubA); // 签约方 = 本队

    // F 已定死：改 RC 被拒，直接报价
    const refee = await post(`/api/negotiations/${transferId}/release-fee`, { fee: 14 }, 'tok-coach', fx.env);
    expect(refee.status).toBe(400);

    const offer = await post(`/api/negotiations/${session && sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = ?', transferId)?.id}/offer`, { wage: expectedE }, 'tok-coach', fx.env);
    expect(offer.status).toBe(200);
    expect(((await offer.json()) as { result: string; wage: number }).result).toBe('success');

    const done = sqlGet<{ status: string; tax: number | null; extra_fee: number | null }>(
      fx.sqlite,
      'SELECT status, tax, extra_fee FROM transfers WHERE id = ?',
      transferId,
    );
    expect(done?.status).toBe('completed');
    expect(done?.tax).toBe(0);
    expect(done?.extra_fee).toBe(1.5);
    const contract = sqlGet<{ release_fee: number; wage: number; source: string; protected_until: string | null; signed_at: string | null; effective_from: string; club_id: number }>(
      fx.sqlite,
      'SELECT release_fee, wage, source, protected_until, signed_at, effective_from, club_id FROM contracts WHERE player_id = 20 AND is_active = 1',
    );
    expect(contract?.release_fee).toBe(15);
    expect(contract?.source).toBe('negotiation');
    expect(contract?.protected_until).not.toBeNull(); // 保护期收口到当下（4.4.6）
    expect(contract?.effective_from).toBe('2020-01-01'); // 效力年数延续
    expect(contract?.club_id).toBe(fx.clubA);
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 20');
    expect(player).toEqual({ club_id: fx.clubA, status: 'normal' }); // 不换主、状态不动
    const kinds = sqlAll<{ kind: string; amount: number }>(
      fx.sqlite,
      `SELECT kind, amount FROM ledger_entries WHERE club_id = ${fx.clubA} AND kind != 'opening_import' ORDER BY id`,
    );
    expect(kinds).toEqual([{ kind: 'rc_change_fee', amount: -1.5 }]); // 无转会划款，只有续约费
  });

  it('审核驳回：不扣费、单据落 rejected', async () => {
    const fx = await seedBypass();
    const submit = await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 12 }, 'tok-coach', fx.env);
    expect(submit.status).toBe(201);
    const taskId = await openReviewTaskId(fx);
    const reject = await post(`/api/admin/reviews/${taskId}/reject`, { note: '材料不全' }, 'tok-admin', fx.env);
    expect(reject.status).toBe(200);
    const t = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE type = ? AND player_id = 20', 'rc_change');
    expect(t?.status).toBe('rejected');
    const fees = sqlAll<{ kind: string }>(fx.sqlite, `SELECT kind FROM ledger_entries WHERE club_id = ${fx.clubA} AND kind = 'rc_change_fee'`);
    expect(fees).toEqual([]);
  });
});

describe('解约（termination）', () => {
  it('效力 ≥3 年免费解约：批准即过户，球员去归属、CA 回初始、合同失效', async () => {
    const fx = await seedBypass();
    const submit = await post('/api/transfers/termination', { playerId: 20 }, 'tok-coach', fx.env);
    expect(submit.status).toBe(201);
    expect(((await submit.json()) as { terminationFee: number }).terminationFee).toBe(0);
    const taskId = await openReviewTaskId(fx);
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { status: string }).status).toBe('completed');

    const player = sqlGet<{ club_id: number | null; status: string; ca: number | null }>(
      fx.sqlite,
      'SELECT club_id, status, ca FROM players WHERE id = 20',
    );
    expect(player).toEqual({ club_id: null, status: 'free', ca: 72 }); // 属性恢复原始（base_ca）
    const contract = sqlGet<{ is_active: number }>(fx.sqlite, 'SELECT is_active FROM contracts WHERE player_id = 20');
    expect(contract?.is_active).toBe(0);
    const t = sqlGet<{ status: string; tax: number; extra_fee: number }>(
      fx.sqlite,
      "SELECT status, tax, extra_fee FROM transfers WHERE type = 'termination' AND player_id = 20",
    );
    expect(t?.status).toBe('completed');
    expect(t?.tax).toBe(0);
    expect(t?.extra_fee).toBe(0);
    const fees = sqlAll<{ kind: string }>(fx.sqlite, `SELECT kind FROM ledger_entries WHERE kind = 'termination_fee'`);
    expect(fees).toEqual([]);
  });

  it('未满 3 年收解约费：RC×(3−效力)×0.1 销毁', async () => {
    const fx = await seedBypass();
    const submit = await post('/api/transfers/termination', { playerId: 21 }, 'tok-coach', fx.env);
    expect(submit.status).toBe(201);
    const expectedFee = terminationFee(20, '2026-08-01', Date.now()) as number;
    expect(((await submit.json()) as { terminationFee: number }).terminationFee).toBeCloseTo(expectedFee, 2);
    const taskId = await openReviewTaskId(fx);
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    const entry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE kind = 'termination_fee' AND club_id = ${fx.clubA}`,
    );
    expect(entry?.amount).toBeCloseTo(-expectedFee, 2);
  });

  it('合同缺效力起点：提交被挡', async () => {
    const fx = await seedBypass();
    const res = await post('/api/transfers/termination', { playerId: 23 }, 'tok-coach', fx.env);
    expect(res.status).toBe(409);
  });

  it('在流程中的球员不能解约（4.4.10）', async () => {
    const fx = await seedBypass();
    expect((await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 12 }, 'tok-coach', fx.env)).status).toBe(201);
    const res = await post('/api/transfers/termination', { playerId: 20 }, 'tok-coach', fx.env);
    expect(res.status).toBe(400);
  });
});

describe('海捞（free_agent）', () => {
  // 24 无归属自由球员；25 无归属但本窗解约过（由用例自行布置）
  it('自由球员名单：无归属可见、本窗解约标禁签', async () => {
    const fx = await seedBypass();
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (24, 'fc24', '浪人', NULL, 'ST', 27, 78, 80, 'free'),
         (25, 'fc25', '旧将', NULL, 'CM', 30, 74, 74, 'free');
       INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq)
         VALUES ('termination', 25, ${fx.clubA}, NULL, 0, 'completed', 1, 1);`,
    );
    const res = await get('/api/market/free-agents', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { freeAgents: { id: number; bannedThisWindow: boolean }[] };
    const ids = Object.fromEntries(body.freeAgents.map((r) => [r.id, r.bannedThisWindow]));
    expect(ids[24]).toBe(false);
    expect(ids[25]).toBe(true);
  });

  it('提交：新 RC 不设上下限、签入费预检、归属校验', async () => {
    const fx = await seedBypass();
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (24, 'fc24', '浪人', NULL, 'ST', 27, 78, 80, 'free');`,
    );
    const ok = await post('/api/transfers/free-agent', { playerId: 24, newReleaseFee: 7 }, 'tok-coach', fx.env);
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { transferId: number; signFee: number };
    expect(body.signFee).toBe(2.1); // 7 × 30%
    expect(sqlGet<{ fee: number; from_club_id: null; to_club_id: number; type: string }>(
      fx.sqlite,
      'SELECT fee, from_club_id, to_club_id, type FROM transfers WHERE id = ?',
      body.transferId,
    )).toMatchObject({ fee: 7, from_club_id: null, type: 'free_agent' });

    expect((await post('/api/transfers/free-agent', { playerId: 24, newReleaseFee: 0 }, 'tok-coach', fx.env)).status).toBe(400);
    expect((await post('/api/transfers/free-agent', { playerId: 24, newReleaseFee: 3.5 }, 'tok-coach', fx.env)).status).toBe(400);
    expect((await post('/api/transfers/free-agent', { playerId: 20, newReleaseFee: 7 }, 'tok-coach', fx.env)).status).toBe(400);
  });

  it('本窗被解约的球员全联盟禁签（4.4.4）', async () => {
    const fx = await seedBypass();
    // 乡贤免费解约走完整链
    expect((await post('/api/transfers/termination', { playerId: 20 }, 'tok-coach', fx.env)).status).toBe(201);
    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    const ban = await post('/api/transfers/free-agent', { playerId: 20, newReleaseFee: 5 }, 'tok-coach2', fx.env);
    expect(ban.status).toBe(409);
  });

  it('审核通过：签入费销毁 → 谈判（F 定死）→ 成约翻新合同行（含复签 UPSERT）', async () => {
    const fx = await seedBypass();
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (24, 'fc24', '浪人', NULL, 'ST', 27, 78, 80, 'free');`,
    );
    fx.env.rng = () => 0.9;
    const submit = await post('/api/transfers/free-agent', { playerId: 24, newReleaseFee: 6 }, 'tok-coach2', fx.env);
    expect(submit.status).toBe(201);
    const { transferId } = (await submit.json()) as { transferId: number };
    const taskId = await openReviewTaskId(fx);
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { status: string }).status).toBe('signing');

    const session = sqlGet<{ release_fee: number | null; expected_wage: number | null; club_id: number }>(
      fx.sqlite,
      'SELECT release_fee, expected_wage, club_id FROM negotiation_sessions WHERE transfer_id = ?',
      transferId,
    );
    const eBase = expectedWage(5, 6, 0.02, 1.9, 0.45); // 27 岁 CA78 → 等级 5
    expect(session?.release_fee).toBe(6);
    expect(session?.expected_wage).toBe(eBase); // 海捞不乘续约加薪
    const feeEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE kind = 'free_agent_fee' AND club_id = ${fx.clubB}`,
    );
    expect(feeEntry?.amount).toBeCloseTo(-1.8, 2); // 6 × 30%

    const offer = await post(`/api/negotiations/${sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = ?', transferId)?.id}/offer`, { wage: eBase }, 'tok-coach2', fx.env);
    expect(((await offer.json()) as { result: string }).result).toBe('success');

    const contract = sqlGet<{ club_id: number; release_fee: number; is_active: number; protected_until: string | null; source: string; contract_type: string }>(
      fx.sqlite,
      'SELECT club_id, release_fee, is_active, protected_until, source, contract_type FROM contracts WHERE player_id = 24',
    );
    expect(contract).toMatchObject({ club_id: fx.clubB, release_fee: 6, is_active: 1, source: 'negotiation', contract_type: 'formal' });
    expect(contract?.protected_until).not.toBeNull();
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 24');
    expect(player).toEqual({ club_id: fx.clubB, status: 'normal' });
    const done = sqlGet<{ status: string; tax: number; extra_fee: number }>(
      fx.sqlite,
      'SELECT status, tax, extra_fee FROM transfers WHERE id = ?',
      transferId,
    );
    expect(done).toMatchObject({ status: 'completed', tax: 0, extra_fee: 1.8 });
  });

  it('被解约球员下窗可复签：合同行 UPSERT 翻新（旧行 is_active 复位）', async () => {
    const fx = await seedBypass();
    fx.env.rng = () => 0.5;
    // 乡贤本窗解约
    expect((await post('/api/transfers/termination', { playerId: 20 }, 'tok-coach', fx.env)).status).toBe(201);
    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    // 关窗 1、开窗 2
    fx.sqlite.exec(
      `UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1;
       INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 2, 'open', '2026-08-02T00:00:00Z');`,
    );
    const submit = await post('/api/transfers/free-agent', { playerId: 20, newReleaseFee: 9 }, 'tok-coach2', fx.env);
    expect(submit.status).toBe(201);
    const { transferId } = (await submit.json()) as { transferId: number };
    const taskId2 = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId2}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    const sessionId = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = ?', transferId)?.id as number;
    const e = sqlGet<{ expected_wage: number }>(fx.sqlite, 'SELECT expected_wage FROM negotiation_sessions WHERE id = ?', sessionId)?.expected_wage ?? 0;
    expect((await post(`/api/negotiations/${sessionId}/offer`, { wage: e }, 'tok-coach2', fx.env)).status).toBe(200);
    const contract = sqlGet<{ club_id: number; release_fee: number; is_active: number; effective_from: string }>(
      fx.sqlite,
      'SELECT club_id, release_fee, is_active, effective_from FROM contracts WHERE player_id = 20',
    );
    expect(contract).toMatchObject({ club_id: fx.clubB, release_fee: 9, is_active: 1 });
    expect(contract?.effective_from).not.toBe('2020-01-01'); // 效力重新起算
    // 旧解约单仍 completed，未受影响
    const term = sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE type = 'termination' AND player_id = 20");
    expect(term?.status).toBe('completed');
  });
});

describe('窗内回滚（4.4.10）', () => {
  interface RolledFixture extends BypassFixture {
    transferId: number;
  }

  // 乡贤续约 10→15 全链成约（费 1.5 已收，合同 RC=15、保护期收口）
  async function seedCompletedRcChange(): Promise<RolledFixture> {
    const fx = await seedBypass();
    fx.env.rng = () => 0.5;
    const submit = await post('/api/transfers/rc-change', { playerId: 20, newReleaseFee: 15 }, 'tok-coach', fx.env);
    expect(submit.status).toBe(201);
    const { transferId } = (await submit.json()) as { transferId: number };
    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    const sessionId = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = ?', transferId)?.id as number;
    const e = sqlGet<{ expected_wage: number }>(fx.sqlite, 'SELECT expected_wage FROM negotiation_sessions WHERE id = ?', sessionId)?.expected_wage ?? 0;
    const offer = await post(`/api/negotiations/${sessionId}/offer`, { wage: e }, 'tok-coach', fx.env);
    expect(offer.status).toBe(200);
    return { ...fx, transferId };
  }

  it('续约后被挂牌 → RC/保护期还原 + 续约费退还（ref=续约单本身）', async () => {
    const fx = await seedCompletedRcChange();
    expect((await post('/api/market/listings', { playerId: 20, askPrice: 11 }, 'tok-coach', fx.env)).status).toBe(201);
    const contract = sqlGet<{ release_fee: number; protected_until: string | null }>(
      fx.sqlite,
      'SELECT release_fee, protected_until FROM contracts WHERE player_id = 20 AND is_active = 1',
    );
    expect(contract?.release_fee).toBe(10); // 回到本窗第一张续约单之前
    expect(contract?.protected_until).toBeNull(); // 原本无保护期记录，还原为 NULL
    const refund = sqlGet<{ amount: number; ref_type: string; ref_id: number }>(
      fx.sqlite,
      `SELECT amount, ref_type, ref_id FROM ledger_entries WHERE kind = 'rc_change_refund' AND club_id = ${fx.clubA}`,
    );
    expect(refund?.amount).toBe(1.5);
    expect(refund?.ref_type).toBe('transfer');
    expect(refund?.ref_id).toBe(fx.transferId);
    const audit = sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'rc_change_rollback'");
    expect(audit?.action).toBe('rc_change_rollback');
  });

  it('续约后被解约 → 回滚触发，解约单照常走审核', async () => {
    const fx = await seedCompletedRcChange();
    const term = await post('/api/transfers/termination', { playerId: 20 }, 'tok-coach', fx.env);
    expect(term.status).toBe(201);
    const refund = sqlGet<{ amount: number; ref_type: string }>(
      fx.sqlite,
      `SELECT amount, ref_type FROM ledger_entries WHERE kind = 'rc_change_refund' AND club_id = ${fx.clubA}`,
    );
    expect(refund?.amount).toBe(1.5);
    expect(refund?.ref_type).toBe('transfer');
    const contract = sqlGet<{ release_fee: number }>(
      fx.sqlite,
      'SELECT release_fee FROM contracts WHERE player_id = 20 AND is_active = 1',
    );
    expect(contract?.release_fee).toBe(10);
    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    const player = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 20');
    expect(player?.status).toBe('free');
  });

  it('回滚不重复退款（多个不同触发单也只退一次）', async () => {
    const fx = await seedCompletedRcChange();
    // 触发单 A：挂牌（触发回滚退款）
    expect((await post('/api/market/listings', { playerId: 20, askPrice: 11 }, 'tok-coach', fx.env)).status).toBe(201);
    expect(sqlAll<{ id: number }>(fx.sqlite, "SELECT id FROM ledger_entries WHERE kind = 'rc_change_refund'")).toHaveLength(1);
    // 挂牌收口（模拟下架）：球员还原 normal，仍归属原队
    fx.sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE player_id = 20 AND status = 'listed'`);
    fx.sqlite.exec(`UPDATE players SET status = 'normal' WHERE id = 20`);
    // 触发单 B：解约（再次触发回滚——触发单不同，但退款 ref 是续约单本身，幂等闸挡住）
    expect((await post('/api/transfers/termination', { playerId: 20 }, 'tok-coach', fx.env)).status).toBe(201);
    const refunds = sqlAll<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'rc_change_refund'");
    expect(refunds.length).toBe(1); // 两个不同触发单，退款仍然只有一笔
    expect(refunds[0]?.amount).toBe(1.5);
    const contract = sqlGet<{ release_fee: number }>(
      fx.sqlite,
      'SELECT release_fee FROM contracts WHERE player_id = 20 AND is_active = 1',
    );
    expect(contract?.release_fee).toBe(10);
  });
});
