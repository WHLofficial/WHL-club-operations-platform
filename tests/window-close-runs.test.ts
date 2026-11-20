// v6.88.0 B1 关窗流水线测试（docs/test-plans/v6.88.0-window-close-pipeline.md 的 T01–T17 执行层）。
// 被测面：claim 三语句小批（open→closing + 唯一键 INSERT run/step DO NOTHING）、租约 CAS
// （TTL 5 分钟）、close_all 单批全有全无（失败停在 closing、批外强约不回滚）、closing 冻结闸
// （window_closing 409 + 豁免子树）、openWindow / season-settle 的 closing 计数口径、
// settleOverdue 显式窗口回退、0096 迁移真跑、批后动作失败降级 warnings。
//
// 夹具照抄 tests/window-machine.test.ts 的 freshEnv / seedWindow / seedLiveBidding（R1 口径：
// 该文件一字不改、既有断言全绿），新用例全部集中在本文件（测试计划 §2 允许）。
//
// 与测试计划的偏差记录（首轮施工登记，已在 B1 收口修正并补断言）：
//   · T03d 已落：preflight settleOverdue 回到 claim 之前（open 状态下先结算，它造的 pending_review
//     必须挡关窗），claim 后的 settle 只做窗尾收口；
//   · T12 的 cron 豁免已补：EXEMPT_PREFIXES 加入 /api/cron，探针见 T12；
//   · T16 的 CHECK 紧枚举已补：0096 两个 status 列均建 CHECK，断言见 T16。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { HttpError } from '../src/lib/http.ts';
import {
  createTestD1,
  createTestDb,
  applyMigrations,
  runMigration,
  sqlGet,
  sqlAll,
  attachAuthChannel,
  authRegisterClubTeam,
} from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache, createConfigService } from '../src/core/config.ts';
import {
  acquireCloseLease,
  claimCloseRun,
  claimCloseStatements,
  CLOSE_LEASE_TTL_MS,
  CLOSE_STEP_CLOSE_ALL,
} from '../src/worker/window-close-runs.ts';
import { settleOverdue } from '../src/worker/market-settle.ts';
import { checkSeasonSettle } from '../src/worker/season-settle.ts';

// ---------- 夹具（照抄 tests/window-machine.test.ts，不改既有断言） ----------

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

type Seeded = Fixture & { clubA: number; clubB: number };

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
  // v6.39.3 队徽链路：GET /api/players 经 loadTeamLogos 读 TOUR_DB team.logo_key（种子表无此列）
  tour.exec('ALTER TABLE team ADD COLUMN logo_key TEXT');
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
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId: clubSeq, country: 14 }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const payload: { club: { id: number } } = await res.json();
  return payload.club.id;
}

// 基础局：两 club、球员+合同、窗口 1 开着
async function seedWindow(): Promise<Seeded> {
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
    const payload: { code: string } = await res.json();
    expect((await post('/api/clubs/bind', { code: payload.code }, token, fx.env)).status).toBe(201);
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
async function seedLiveBidding(fx: Seeded): Promise<void> {
  expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
  expect((await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env)).status).toBe(201);
}

// ---------- 本文件专用 helper ----------

interface RunRow {
  id: number;
  status: string;
  current_step: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  error: string | null;
  summary_json: string | null;
}

interface StepRow {
  run_id: number;
  step: string;
  status: string;
  attempt: number;
  finished_at: string | null;
  error: string | null;
}

function runRowOf(sqlite: DatabaseSync, season = 1, windowSeq = 1) {
  return sqlGet<RunRow>(
    sqlite,
    `SELECT id, status, current_step, lease_owner, lease_expires_at, started_at, updated_at, completed_at, error, summary_json
     FROM window_close_runs WHERE season = ? AND window_seq = ?`,
    season,
    windowSeq,
  );
}

function stepRowOf(sqlite: DatabaseSync, runId: number) {
  return sqlGet<StepRow>(
    sqlite,
    'SELECT run_id, step, status, attempt, finished_at, error FROM window_close_steps WHERE run_id = ? AND step = ?',
    runId,
    CLOSE_STEP_CLOSE_ALL,
  );
}

function winStatusOf(sqlite: DatabaseSync, season = 1, windowSeq = 1) {
  return sqlGet<{ status: string; closed_at: string | null }>(
    sqlite,
    'SELECT status, closed_at FROM season_windows WHERE season = ? AND window_seq = ?',
    season,
    windowSeq,
  );
}

/** 捕获 Promise 的失败值（测试内统一取错样式：不写 as / 非空断言） */
async function catchHttp(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (err) => err,
  );
}

/** 认领 + 持租（模拟「A 已认领」：claimCloseRun 只认领，租约单独 acquire） */
async function claimWithLease(fx: Fixture, owner: string) {
  const claim = await claimCloseRun(fx.env, 1, 1, 1, false);
  expect(claim.kind).toBe('claimed');
  await acquireCloseLease(fx.env.DB, claim.run.id, owner, CLOSE_LEASE_TTL_MS);
  return claim.run;
}

/** 本窗（ref_type='window'、ref_id=season×100+window_seq=101）某类流水的行数与扣款合计 */
function windowLedger(fx: Seeded, kind: string) {
  return sqlGet<{ n: number; total: number }>(
    fx.sqlite,
    `SELECT COUNT(*) AS n, COALESCE(ROUND(-SUM(amount), 2), 0) AS total FROM ledger_entries
     WHERE ref_type = 'window' AND ref_id = 101 AND kind = '${kind}'`,
  );
}

/** window_close 审计 after 的逐类汇总与本窗流水逐格对账（照 window-machine.test.ts 口径） */
function expectLedgerReconcile(fx: Seeded, after: Record<string, unknown>) {
  const wage = windowLedger(fx, 'wage');
  const tax = windowLedger(fx, 'luxury_tax');
  const maintenance = windowLedger(fx, 'maintenance');
  const namingFee = windowLedger(fx, 'naming_fee');
  expect(after).toMatchObject({
    payroll: { wageClubs: wage?.n, wageTotal: wage?.total, taxClubs: tax?.n, taxTotal: tax?.total },
    home: { maintenanceClubs: maintenance?.n, maintenanceTotal: maintenance?.total, namingClubs: namingFee?.n, namingTotal: namingFee?.total },
  });
}

// 窗口外强拍夹具：缺归属（season/window_seq NULL）、deadline 已过、带 active 出价的 forced 挂牌
async function seedOrphanForcedListing(fx: Seeded): Promise<void> {
  fx.sqlite.exec(
    `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, last_bid_at, deadline_at, season, window_seq)
     VALUES (50, ${fx.clubA}, 'forced', 20, 'bidding', '2020-01-01T00:00:00Z', '2020-01-01', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', NULL, NULL)`,
  );
  fx.sqlite.exec(
    `INSERT INTO bids (listing_id, club_id, amount, status, created_at) VALUES (1, ${fx.clubB}, 20, 'active', '2020-01-01T00:00:00Z')`,
  );
}

// 「校验失败不 claim」的共同尾断言：窗保持 open、run/steps 零行
function expectNotClaimed(fx: Seeded) {
  expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'open', closed_at: null });
  expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_runs')).toMatchObject({ n: 0 });
  expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_steps')).toMatchObject({ n: 0 });
}

// ---------- T01–T03 claim 与业务校验 ----------

describe('v6.88.0 B1 关窗流水线 · claim（T01–T03）', () => {
  it('T01 claim 并发互斥：后到者 409，run/step/窗逐字段原值', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    // 认领后的形态：窗 closing、run running + 租约未来、step pending
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
    const runBefore = runRowOf(fx.sqlite);
    expect(runBefore).toMatchObject({ status: 'running', lease_owner: 'owner-a', current_step: CLOSE_STEP_CLOSE_ALL });
    expect(runBefore?.lease_expires_at).not.toBeNull();
    const steps = sqlAll<{ status: string }>(fx.sqlite, 'SELECT status FROM window_close_steps WHERE run_id = ?', run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'pending' });

    // B 重放 POST close（模拟并发后到者）：acquire 撞租约 → 409 且零覆盖
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('关窗正在处理');
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing' });
    expect(runRowOf(fx.sqlite)).toEqual(runBefore);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_runs')).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_steps')).toMatchObject({ n: 1 });
  });

  it('T02 claim 批 SQL 幂等：重放零改行、closed 不复活、run 不重建', async () => {
    // 分支一（closing + run 已在）：再执行 claim 只读已有 run；runner 同文三语句重放全 0 改行
    const fx = await seedWindow();
    const claim1 = await claimCloseRun(fx.env, 1, 1, 1, false);
    expect(claim1.kind).toBe('claimed');
    await acquireCloseLease(fx.env.DB, claim1.run.id, 'owner-a', CLOSE_LEASE_TTL_MS);
    const runBefore = runRowOf(fx.sqlite);
    const claim2 = await claimCloseRun(fx.env, 2, 1, 1, false);
    expect(claim2.kind).toBe('resumed');
    expect(claim2.run.id).toBe(claim1.run.id);
    expect(runRowOf(fx.sqlite)).toEqual(runBefore);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_steps')).toMatchObject({ n: 1 });
    const replay = await fx.env.DB.batch(claimCloseStatements(fx.env.DB, 1, 1));
    expect(replay.map((r) => r.meta.changes ?? 0)).toEqual([0, 0, 0]);
    expect(runRowOf(fx.sqlite)).toEqual(runBefore);

    // 分支二（窗口已 closed、runs/steps 零行）：claim ① 的 AND status='open' 守卫拒绝，
    // 窗口不被翻回 closing、run 不被 EXISTS 新建
    const fx2 = await seedWindow();
    fx2.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1`);
    const err = await catchHttp(claimCloseRun(fx2.env, 9, 1, 1, false));
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toHaveProperty('status', 409);
    expect(winStatusOf(fx2.sqlite)).toMatchObject({ status: 'closed' });
    expect(sqlGet<{ n: number }>(fx2.sqlite, 'SELECT COUNT(*) AS n FROM window_close_runs')).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx2.sqlite, 'SELECT COUNT(*) AS n FROM window_close_steps')).toMatchObject({ n: 0 });
  });

  it('T03a 匹配等待单挡关窗：失败零 run 行、窗口保持 open', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, activated_by, match_deadline, season, window_seq)
       VALUES (50, ${fx.clubA}, 'activation', 40, 'matched_pending', '2026-07-01T02:00:00Z', '2026-07-01', ${fx.clubB}, '2027-01-01T00:00:00Z', 1, 1)`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('匹配等待期');
    expectNotClaimed(fx);
  });

  it('T03b 待审队列挡关窗：失败零 run 行、窗口保持 open', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
       VALUES ('transfer', 50, ${fx.clubA}, ${fx.clubB}, 15, 'pending_review', 1, 1, 't03b-pending', '2026-07-01T00:00:00Z')`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('审核队列');
    expectNotClaimed(fx);
  });

  it('T03c1 活跃谈判无 force 挡关窗：失败零 run 行、窗口保持 open', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
       VALUES ('transfer', 50, ${fx.clubA}, ${fx.clubB}, 15, 'signing', 1, 1, 't03c1-nego', '2026-07-01T00:00:00Z');
       INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, expected_wage, status, created_at)
       VALUES ((SELECT id FROM transfers WHERE idempotency_key = 't03c1-nego'), 50, ${fx.clubB}, 2, 'active', '2026-07-01T00:00:00Z');`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('签约谈判没结束');
    expectNotClaimed(fx);
  });

  it('T03c2 force 但无 E 快照挡关窗：失败零 run 行、窗口保持 open', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
       VALUES ('transfer', 50, ${fx.clubA}, ${fx.clubB}, 15, 'signing', 1, 1, 't03c2-nego', '2026-07-01T00:00:00Z');
       INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, expected_wage, status, created_at)
       VALUES ((SELECT id FROM transfers WHERE idempotency_key = 't03c2-nego'), 50, ${fx.clubB}, NULL, 'active', '2026-07-01T00:00:00Z');`,
    );
    const config = createConfigService(fx.env.DB);
    await config.set('window_force_settle', 'true');
    const res = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('没有 E 快照');
    expectNotClaimed(fx);
  });

  it('T03d preflight 惰性结算先于业务校验：过期出价单变 pending_review 后挡关窗', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    // 出价单截止时间拨到过去：closeWindow 的 preflight settleOverdue 会把它收口成 pending_review。
    // 若 preflight 被放到 claim 之后（旧施工偏差），校验先跑、看不到这张单，关窗会错误地继续。
    fx.sqlite.exec(`UPDATE listings SET deadline_at = '2000-01-01T00:00:00Z' WHERE id = 1`);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('审核队列');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')).toMatchObject({ status: 'pending_review' });
    expectNotClaimed(fx);
  });
});

// ---------- T04–T05b close_all 批 ----------

describe('v6.88.0 B1 关窗流水线 · close_all 批（T04–T05b）', () => {
  it('T04 close_all 成功全链：run completed + 审计对账 + 响应与 summary_json 逐字段相等', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: Record<string, unknown> = await res.json();
    expect(body).toMatchObject({ ok: true, season: 1, windowSeq: 1, forceSettled: 0 });

    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    expect(winStatusOf(fx.sqlite)?.closed_at).not.toBeNull();
    const run = runRowOf(fx.sqlite);
    expect(run).toMatchObject({ status: 'completed', current_step: CLOSE_STEP_CLOSE_ALL });
    expect(run?.completed_at).not.toBeNull();
    expect(run?.error).toBeNull();
    expect(run?.lease_expires_at).toBeNull(); // 完成清租
    const step = stepRowOf(fx.sqlite, run?.id ?? 0);
    expect(step).toMatchObject({ status: 'done', attempt: 1 });
    expect(step?.finished_at).not.toBeNull();

    // 响应体与 JSON.parse(summary_json) 逐字段相等（completed 重入回放同源）
    const stored: unknown = JSON.parse(run?.summary_json ?? 'null');
    expect(body).toEqual(stored);

    // 审计恰 1 行：actor / target_type / origin / after 形状
    const audits = sqlAll<{ actor: number | null; target_type: string; origin: string; after: string }>(
      fx.sqlite,
      "SELECT actor, target_type, origin, after FROM audit_log WHERE action = 'window_close'",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: 1, target_type: 'season_window', origin: 'user' });
    const after: Record<string, unknown> = JSON.parse(audits[0]?.after ?? '{}');
    expect(after).toMatchObject({ season: 1, windowSeq: 1, forceSettled: 0 });

    // ref_type='window' ref_id=101 逐类对账 + 窗尾收口
    expectLedgerReconcile(fx, after);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')).toMatchObject({ status: 'pending_review' });
  });

  it('T05 close_all 批失败整批回滚：窗口停 closing、零半截行、失败释放租约；清障重试只前进无双扣', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    fx.sqlite.exec(`CREATE TRIGGER fail_close BEFORE INSERT ON ledger_entries WHEN NEW.kind = 'wage' BEGIN SELECT RAISE(ABORT, 'boom-close'); END;`);

    const res1 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res1.status).toBe(500); // 非 HttpError → onError 兜底
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
    const run1 = runRowOf(fx.sqlite);
    expect(run1).toMatchObject({ status: 'failed' });
    expect(run1?.error).toContain('boom-close');
    expect(run1?.lease_expires_at).toBeNull(); // D-1：失败即释放租约
    const step1 = stepRowOf(fx.sqlite, run1?.id ?? 0);
    expect(step1).toMatchObject({ status: 'failed', attempt: 1 });
    expect(step1?.finished_at).not.toBeNull();
    expect(step1?.error).toContain('boom-close');
    // 整批回滚：工资/维护/忠诚零半截行、审计零行、余额不动、业务单据不动
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'window' AND ref_id = 101")).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 0 });
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', fx.clubA)).toMatchObject({ balance: 100 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')).toMatchObject({ status: 'bidding' });

    // 清障重试：closing resume → 只前进；流水恰好一份（整批回滚 + NOT EXISTS 幂等闸）
    fx.sqlite.exec('DROP TRIGGER fail_close');
    const res2 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(200);
    const body2: Record<string, unknown> = await res2.json();
    expect(body2).toMatchObject({ ok: true, season: 1, windowSeq: 1, forceSettled: 0 });
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    expect(runRowOf(fx.sqlite)).toMatchObject({ status: 'completed' });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 1 });
    const after: Record<string, unknown> = JSON.parse(
      sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'window_close'")?.after ?? '{}',
    );
    expectLedgerReconcile(fx, after);
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 1 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')).toMatchObject({ status: 'pending_review' });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM transfers WHERE idempotency_key = 'listing:1'")).toMatchObject({ n: 1 });
  });

  it('T05b 批外强约的半截态不回滚：重放只前进，forceSettled 归零、强约/通知/过户不重复', async () => {
    const fx = await seedWindow();
    // ① promotion 会话（真链路：训练营球员 + 上调单，E 快照开会时已落）
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, growth_tier) VALUES
         (60, 'fc60', '甲青训', ${fx.clubA}, 'ST', 18, 62, 80, 'trainee', 1);
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
         (2, 60, ${fx.clubA}, 5, 0.75, 'trainee', 1, '2026-06-01');`,
    );
    expect((await post('/api/transfers/promotion', { playerId: 60, newReleaseFee: 10 }, 'tok-coach', fx.env)).status).toBe(201);
    // ② 非 promotion 活跃会话（直插）：E 快照在场，force 关窗按 E 强约
    fx.sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
       VALUES ('transfer', 50, ${fx.clubA}, ${fx.clubB}, 15, 'signing', 1, 1, 't05b-nego', '2026-07-01T00:00:00Z');
       INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, expected_wage, status, created_at)
       VALUES ((SELECT id FROM transfers WHERE idempotency_key = 't05b-nego'), 50, ${fx.clubB}, 2, 'active', '2026-07-01T00:00:00Z');`,
    );
    const config = createConfigService(fx.env.DB);
    await config.set('window_force_settle', 'true');
    fx.sqlite.exec(`CREATE TRIGGER fail_close BEFORE INSERT ON ledger_entries WHEN NEW.kind = 'wage' BEGIN SELECT RAISE(ABORT, 'boom-close'); END;`);
    const transferLedgerCount = () =>
      sqlGet<{ n: number }>(
        fx.sqlite,
        "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'transfer' AND ref_id = (SELECT id FROM transfers WHERE idempotency_key = 't05b-nego')",
      );

    const res1 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(res1.status).toBe(500);
    // 批外强约已发生且不回滚：两会话 settled、单据 completed、过户流水与通知在场
    const sessions = sqlAll<{ status: string; settle_source: string | null }>(
      fx.sqlite,
      'SELECT status, settle_source FROM negotiation_sessions ORDER BY id',
    );
    expect(sessions).toHaveLength(2);
    for (const s of sessions) expect(s).toMatchObject({ status: 'settled', settle_source: 'forced' });
    expect(sqlGet<{ status: string; extra_fee: number | null }>(fx.sqlite, "SELECT status, extra_fee FROM transfers WHERE type = 'promotion'")).toMatchObject({
      status: 'completed',
      extra_fee: 0,
    });
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE idempotency_key = 't05b-nego'")).toMatchObject({ status: 'completed' });
    const transferLedger1 = transferLedgerCount();
    expect(transferLedger1?.n).toBeGreaterThan(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'negotiation_settle'")).toMatchObject({ n: 2 });
    // close_all 批整体回滚：窗停 closing、窗内流水与审计零行、run failed + 租约已释放
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'window' AND ref_id = 101")).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 0 });
    const run1 = runRowOf(fx.sqlite);
    expect(run1).toMatchObject({ status: 'failed' });
    expect(run1?.lease_expires_at).toBeNull();

    // 重放：resume 跳过已 settled 的会话 → forceSettled=0，强约/通知/过户不重复
    fx.sqlite.exec('DROP TRIGGER fail_close');
    const res2 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(res2.status).toBe(200);
    const body2: Record<string, unknown> = await res2.json();
    expect(body2).toMatchObject({ ok: true, season: 1, windowSeq: 1, forceSettled: 0 });
    const audits = sqlAll<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'window_close'");
    expect(audits).toHaveLength(1);
    const after: Record<string, unknown> = JSON.parse(audits[0]?.after ?? '{}');
    expect(after).toMatchObject({ promotionForceSettled: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'negotiation_settle'")).toMatchObject({ n: 2 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 1 });
    expect(transferLedgerCount()).toEqual(transferLedger1); // 不双过户
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    expect(runRowOf(fx.sqlite)).toMatchObject({ status: 'completed' });
  });
});

// ---------- T06–T10 resume 与租约 ----------

describe('v6.88.0 B1 关窗流水线 · resume 与租约（T06–T10）', () => {
  it('T06 closing resume：failed run 重放只前进、换主成功', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    // 模拟「上次尝试失败且已释放租约」（D-1 形态）；lease_owner 留 owner-a 残值，
    // CAS 只看 lease_expires_at IS NULL → 命中
    fx.sqlite.prepare(`UPDATE window_close_runs SET status = 'failed', lease_expires_at = NULL WHERE id = ?`).run(run.id);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    const done = runRowOf(fx.sqlite);
    expect(done).toMatchObject({ status: 'completed' });
    expect(done?.completed_at).not.toBeNull();
    expect(done?.lease_owner).toBeNull(); // 完成清租；绝不残留 owner-a
    const step = stepRowOf(fx.sqlite, done?.id ?? 0);
    expect(step).toMatchObject({ status: 'done' });
  });

  it('T07 租约过期接管：过期后他人重放成功接管', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    fx.sqlite.prepare(`UPDATE window_close_runs SET lease_expires_at = '2026-01-01T00:00:00Z' WHERE id = ?`).run(run.id);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    const done = runRowOf(fx.sqlite);
    expect(done).toMatchObject({ status: 'completed' });
    expect(done?.lease_owner).not.toBe('owner-a'); // 新 owner 接管（完成后清租 → NULL）
    expect(done?.completed_at).not.toBeNull();
  });

  it('T07 单元附加：acquireCloseLease 过期可取、未过期拒（CAS changes 口径）', async () => {
    const fx = await seedWindow();
    const claim = await claimCloseRun(fx.env, 1, 1, 1, false);
    // 无租约 → 可取，返回到期时刻，lease 字段落 owner-c
    const expiresAt = await acquireCloseLease(fx.env.DB, claim.run.id, 'owner-c', CLOSE_LEASE_TTL_MS);
    expect(typeof expiresAt).toBe('string');
    expect(runRowOf(fx.sqlite)).toMatchObject({ lease_owner: 'owner-c', status: 'running' });
    // 未过期 → 拒绝且 run 行逐字段原值
    const before = runRowOf(fx.sqlite);
    const err = await catchHttp(acquireCloseLease(fx.env.DB, claim.run.id, 'owner-d', CLOSE_LEASE_TTL_MS));
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toHaveProperty('status', 409);
    expect(err).toHaveProperty('message', '关窗正在处理');
    expect(runRowOf(fx.sqlite)).toEqual(before);
    // 显式过期 → 可接管
    fx.sqlite.prepare(`UPDATE window_close_runs SET lease_expires_at = '2026-01-01T00:00:00Z' WHERE id = ?`).run(claim.run.id);
    await acquireCloseLease(fx.env.DB, claim.run.id, 'owner-e', CLOSE_LEASE_TTL_MS);
    expect(runRowOf(fx.sqlite)).toMatchObject({ lease_owner: 'owner-e' });
  });

  it('T08 租约未过期拒绝：409 且 run 逐字段原值、step 不变、窗仍 closing', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    const runBefore = runRowOf(fx.sqlite);
    expect(runBefore).toMatchObject({ lease_owner: 'owner-a' });
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('关窗正在处理');
    expect(runRowOf(fx.sqlite)).toEqual(runBefore);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_steps WHERE run_id = ?', run.id)).toMatchObject({ n: 1 });
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
  });

  it('T09 closed 拒绝重放：409 无窗口，run 不重建', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const replayBodies: Record<string, unknown>[] = [{}, { force: true }];
    for (const body of replayBodies) {
      const res = await post('/api/admin/windows/close', body, 'tok-admin', fx.env);
      expect(res.status).toBe(409);
      const payload: { error: string } = await res.json();
      expect(payload.error).toContain('没有开着的窗口');
    }
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_runs')).toMatchObject({ n: 1 });
    expect(runRowOf(fx.sqlite)).toMatchObject({ status: 'completed' });
  });

  it('T10 completed 幂等重放：返回既有摘要不重跑', async () => {
    const fx = await seedWindow();
    const summaryJson = JSON.stringify({
      ok: true,
      season: 1,
      windowSeq: 1,
      isTemporary: false,
      forceSettled: 0,
      loyalty: { count: 0, total: 0 },
      payroll: { wageClubs: 1, wageTotal: 2, taxClubs: 0, taxTotal: 0, wageFloorClubs: 0 },
      home: {
        maintenanceClubs: 0, maintenanceTotal: 0, fansClubs: 0, namingClubs: 0, namingTotal: 0,
        activityClubs: 0, activityTotal: 0, activityOpsCost: 0, moodClubs: 0, terminatedClubs: 0,
        marketOffers: 0, activatedClubs: 0, pendingApplied: 0, pendingVoided: 0,
      },
    });
    // SQL 直造防御态（claim 造不出 completed）：窗 closing + run completed + step done + 既有审计/流水
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closing' WHERE season = 1 AND window_seq = 1`);
    fx.sqlite
      .prepare(
        `INSERT INTO window_close_runs (season, window_seq, status, current_step, started_at, updated_at, completed_at, error, summary_json)
         VALUES (1, 1, 'completed', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, ?)`,
      )
      .run(CLOSE_STEP_CLOSE_ALL, summaryJson);
    fx.sqlite
      .prepare(
        `INSERT INTO window_close_steps (run_id, step, seq, status, attempt, finished_at)
         SELECT id, ?, 1, 'done', 1, '2026-01-01T00:00:00.000Z' FROM window_close_runs WHERE season = 1 AND window_seq = 1`,
      )
      .run(CLOSE_STEP_CLOSE_ALL);
    fx.sqlite.exec(
      `INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
       VALUES (1, 'window_close', 'season_window', NULL, 'user', NULL, '{}', '2026-01-01T00:00:00.000Z')`,
    );
    fx.sqlite.exec(
      `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
       VALUES (${fx.clubA}, 'wage', -2, 98, 'window', 101, '预置', '2026-01-01T00:00:00.000Z')`,
    );

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: Record<string, unknown> = await res.json();
    expect(body).toEqual(JSON.parse(summaryJson)); // completed 短路：响应 = 既有摘要逐字段
    // 不重跑：审计/流水行数原样，窗保持 closing、run 原样
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'window' AND ref_id = 101")).toMatchObject({ n: 1 });
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing' });
    expect(runRowOf(fx.sqlite)?.summary_json).toBe(summaryJson);
  });
});

// ---------- T11–T12 closing 冻结 ----------

describe('v6.88.0 B1 关窗流水线 · closing 冻结（T11–T12）', () => {
  it('T11 closing 冻结拦俱乐部写：非 GET 409 window_closing、GET 200、零放行', async () => {
    const fx = await seedWindow();
    // 对照先行：open 期同一请求 201（行为基线）
    expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
    await claimWithLease(fx, 'owner-a');
    // claim 提交后零间隔立即打（冻结判据直查库，无进程内缓存）→ 仍被拦
    const blocked = await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env);
    expect(blocked.status).toBe(409);
    const body: { error: string; code: string } = await blocked.json();
    expect(body).toEqual({ error: '窗口正在关闭，暂时不能修改', code: 'window_closing' });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM listings')).toMatchObject({ n: 1 }); // 零新增

    // 其余四条写探针同码（body 合法性无关——冻结在业务与鉴权之前拦下；
    // notifications/read 是全拦口径探针：任何前缀白名单式漏抄都会让它变绿）
    const probes: { method: string; path: string; body: Record<string, unknown> }[] = [
      { method: 'PUT', path: '/api/players/50/offer-settings', body: {} },
      { method: 'POST', path: '/api/transfers/rc-change', body: {} },
      { method: 'PUT', path: '/api/club/venue-plan', body: {} },
      { method: 'POST', path: '/api/notifications/read', body: { all: true } },
    ];
    for (const p of probes) {
      const res = await app.request(
        p.path,
        { method: p.method, headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-coach' }, body: JSON.stringify(p.body) },
        fx.env,
      );
      expect(res.status, `${p.method} ${p.path}`).toBe(409);
      const payload: { error: string; code: string } = await res.json();
      expect(payload.code, p.path).toBe('window_closing');
      expect(payload.error, p.path).toBe('窗口正在关闭，暂时不能修改');
    }

    // GET/HEAD 永不拦
    expect((await get('/api/market/listings', 'tok-coach', fx.env)).status).toBe(200);
    expect((await get('/api/players', undefined, fx.env)).status).toBe(200);
  });

  it('T12 closing 冻结豁免：admin / internal / auth / media / cron 到达业务处理器', async () => {
    const fx = await seedWindow();
    fx.env.TEAM_SYNC_SECRET = 'k2';
    await claimWithLease(fx, 'owner-a'); // owner-a 持租约，便于 admin 分支判别

    // admin：到达 closeWindow 的租约检查（错误文案是租约口径，不是冻结文案）
    const admin = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(admin.status).toBe(409);
    const adminBody: { error: string } = await admin.json();
    expect(adminBody.error).toContain('关窗正在处理');

    // internal：到达 HMAC 校验（密钥已配、头缺失 → bad_signature）
    const internal = await post('/api/internal/team-upsert', { id: 700, name: 'Arsenal' }, undefined, fx.env);
    expect(internal.status).toBe(403);
    const internalBody: { error: string } = await internal.json();
    expect(internalBody).toMatchObject({ error: 'bad_signature' });

    // auth：登录链路可用（兼容模式无会话登出 → 302 跳赛事站）
    const logout = await post('/api/auth/logout', {}, undefined, fx.env);
    expect(logout.status).toBe(302);

    // media：媒体上传到达鉴权（无 token 401，非冻结文案）
    const media = await post('/api/media/activation', {}, undefined, fx.env);
    expect(media.status).toBe(401);
    const mediaBody: { error: string } = await media.json();
    expect(mediaBody.error).not.toBe('窗口正在关闭，暂时不能修改');

    // cron：机器通道到达 assertCronKey（配了密钥但没带头 → 403，不是冻结文案）
    fx.env.CRON_KEY = 'cron-k2';
    const cron = await post('/api/cron/tick', {}, undefined, fx.env);
    expect(cron.status).toBe(403);
    const cronBody: { error: string } = await cron.json();
    expect(cronBody.error).toBe('cron 密钥不对');

    // 公开 GET 照常
    expect((await get('/api/players', undefined, fx.env)).status).toBe(200);
  });
});

// ---------- T13–T15 计数口径与显式窗口 ----------

describe('v6.88.0 B1 关窗流水线 · 计数口径与显式窗口（T13–T15）', () => {
  it('T13 openWindow 把 closing 算占用：closing 期 409，close_all 完成后 201', async () => {
    const fx = await seedWindow();
    // closing + run，无阻塞单据（claim 直造、不持租——后续 POST close 要能拿到租约走完）
    const claim = await claimCloseRun(fx.env, 1, 1, 1, false);
    expect(claim.kind).toBe('claimed');
    const res1 = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res1.status).toBe(409);
    const body1: { error: string } = await res1.json();
    expect(body1.error).toContain('还有一个窗口开着，先关闭它再开新窗');

    // 完成 close_all → 同款 open 请求成功（IN('open','closing') 改造的两头都锁）
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    fx.env.rng = () => 0.99;
    const res2 = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(201);
    const body2: { season: number; windowSeq: number } = await res2.json();
    expect(body2).toMatchObject({ season: 1, windowSeq: 2 });
  });

  it('T14 settleOverdue 显式窗口归窗：closing 下缺归属单据落显式窗', async () => {
    const fx = await seedWindow();
    await claimWithLease(fx, 'owner-a'); // closing 窗（S1W1）
    await seedOrphanForcedListing(fx);
    await settleOverdue(fx.env, { origin: 'user', actor: 1, season: 1, windowSeq: 1 });
    const t = sqlGet<{ season: number | null; window_seq: number | null; status: string }>(
      fx.sqlite,
      "SELECT season, window_seq, status FROM transfers WHERE idempotency_key = 'listing:1'",
    );
    expect(t).toMatchObject({ season: 1, window_seq: 1, status: 'pending_review' });
  });

  it('T14 对照 B：不传显式窗仍落当前 open 窗（子查询路径现状零变化）', async () => {
    const fx = await seedWindow(); // 窗 open，不 claim
    await seedOrphanForcedListing(fx);
    await settleOverdue(fx.env, { origin: 'user', actor: 1 });
    const t = sqlGet<{ season: number | null; window_seq: number | null }>(
      fx.sqlite,
      "SELECT season, window_seq FROM transfers WHERE idempotency_key = 'listing:1'",
    );
    expect(t).toMatchObject({ season: 1, window_seq: 1 });
  });

  it('T14 对照 C：closing 下不传显式窗落 NULL（closing 不算可归窗，由开窗批回填）', async () => {
    const fx = await seedWindow();
    await claimWithLease(fx, 'owner-a');
    await seedOrphanForcedListing(fx);
    await settleOverdue(fx.env, { origin: 'user', actor: 1 });
    const t = sqlGet<{ season: number | null; window_seq: number | null }>(
      fx.sqlite,
      "SELECT season, window_seq FROM transfers WHERE idempotency_key = 'listing:1'",
    );
    expect(t).toMatchObject({ season: null, window_seq: null });
  });

  it('T15 season-settle 计数把 closing 算占用：blocker 在场、端点 409、close 后消失', async () => {
    const fx = await seedWindow();
    const claim = await claimCloseRun(fx.env, 1, 1, 1, false); // closing，不持租（后续 close 要走完）
    expect(claim.kind).toBe('claimed');
    const check1 = await checkSeasonSettle(fx.env, 1);
    expect(check1.blockers).toContain('还有 1 个窗口没关');
    const res1 = await post('/api/admin/seasons/1/settle-season', {}, 'tok-admin', fx.env);
    expect(res1.status).toBe(409);
    const body1: { error: string } = await res1.json();
    expect(body1.error).toContain('还有 1 个窗口没关');

    // 完成 close_all 后同调用：该 blocker 消失
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const check2 = await checkSeasonSettle(fx.env, 1);
    expect(check2.blockers.some((b) => b.includes('窗口没关'))).toBe(false);
  });
});

// ---------- T16–T17 迁移与批后降级 ----------

describe('v6.88.0 B1 关窗流水线 · 迁移与批后降级（T16–T17）', () => {
  it('T16 迁移与夹具：0096 真跑验证（建表 / 自然键 / claim 三语句 node:sqlite 通过 / 存量行保留）', async () => {
    // 全量迁移通过 + 两表在场（MIGRATION_FILES 追加 0096 已由 B1 施工落盘，本例锁「追加后全绿」）
    const full = createTestDb();
    expect(
      sqlGet<{ n: number }>(full.sqlite, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('window_close_runs', 'window_close_steps')"),
    ).toMatchObject({ n: 2 });
    // CHECK 紧枚举（迁移 0096）：两列都必须在 DDL 里焊死，异常状态写不进去
    const runDdl = sqlGet<{ sql: string }>(full.sqlite, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'window_close_runs'");
    expect(runDdl?.sql).toContain("CHECK (status IN ('running', 'failed', 'completed'))");
    const stepDdl = sqlGet<{ sql: string }>(full.sqlite, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'window_close_steps'");
    expect(stepDdl?.sql).toContain("CHECK (status IN ('pending', 'done', 'failed'))");

    // runMigration 单跑先例（growth-nongrowable legacyDb 模式）：applyMigrations 到 0095 →
    // 造存量窗口数据 → 单跑 0096 → 表建成且存量行原样保留
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0095_player_model_value.sql');
    sqlite.exec(
      `INSERT INTO seasons (season, status) VALUES (1, 'running');
       INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'closing', '2026-01-01T00:00:00Z');`,
    );
    runMigration(sqlite, '0096_window_close_runs.sql');
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM season_windows WHERE season = 1 AND window_seq = 1')).toMatchObject({ status: 'closing' });

    // 主键形状（与 0096 实际 DDL 一致；计划写的「runs 自然键主键」实为代理 id 主键 + 自然键 UNIQUE，
    // 一窗一条 run / 一 run 一步的唯一性由 UNIQUE (season, window_seq) 与 PRIMARY KEY (run_id, step) 承担）
    const runPk = sqlAll<{ name: string; pk: number }>(sqlite, 'PRAGMA table_info(window_close_runs)')
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort();
    expect(runPk).toEqual(['id']);
    const stepPk = sqlAll<{ name: string; pk: number }>(sqlite, 'PRAGMA table_info(window_close_steps)')
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort();
    expect(stepPk).toEqual(['run_id', 'step']);

    // claim 三语句原文在 node:sqlite 真执行通过（施工表自认未验证项的唯一口径）
    const db = createTestD1(sqlite);
    sqlite.exec(`DELETE FROM window_close_steps; DELETE FROM window_close_runs; UPDATE season_windows SET status = 'open' WHERE season = 1 AND window_seq = 1;`);
    const first = await db.batch(claimCloseStatements(db, 1, 1));
    expect(first.map((r) => r.meta.changes ?? 0)).toEqual([1, 1, 1]);
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM season_windows WHERE season = 1 AND window_seq = 1')).toMatchObject({ status: 'closing' });
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM window_close_runs WHERE season = 1 AND window_seq = 1')).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM window_close_steps WHERE step = ?', CLOSE_STEP_CLOSE_ALL)).toMatchObject({ n: 1 });
    // 重放：三句全 0（open 写闸 + 两级 ON CONFLICT DO NOTHING）
    const second = await db.batch(claimCloseStatements(db, 1, 1));
    expect(second.map((r) => r.meta.changes ?? 0)).toEqual([0, 0, 0]);

    // 自然键唯一：同窗重复建 run 被 sqlite 拒
    const insertRun = () =>
      sqlite
        .prepare(
          `INSERT INTO window_close_runs (season, window_seq, status, current_step, started_at, updated_at)
           VALUES (1, 1, 'running', 'close_all', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        )
        .run();
    expect(insertRun).toThrow(/UNIQUE/);
  });

  it('T17 批后动作失败降级 warnings：run 仍 completed、listings 不前进', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx); // 唯一 bidding 单 deadline 未来 ⇒ preflight 不收口
    // 定点注入：窗尾收口建单（INSERT INTO transfers，幂等键 listing:%）必炸。该语句只在窗翻
    // closed 之后的批后 settleOverdue 分支执行（preflight 阶段窗未 closed 且单未到期），触发器
    // 打点必落在批后段（等价测试计划 §4 T17 的 sqlText Proxy 方案，注入点更窄更稳）
    fx.sqlite.exec(
      `CREATE TRIGGER fail_tail BEFORE INSERT ON transfers WHEN NEW.idempotency_key LIKE 'listing:%'
       BEGIN SELECT RAISE(ABORT, 'boom-tail'); END;`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    // 批后失败不影响关窗结果本身
    expect(res.status).toBe(200);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    const run = runRowOf(fx.sqlite);
    expect(run).toMatchObject({ status: 'completed' }); // 不改回 failed
    expect(run?.completed_at).not.toBeNull();
    const stored: Record<string, unknown> = JSON.parse(run?.summary_json ?? '{}');
    expect(Array.isArray(stored.warnings)).toBe(true); // warnings 非空且含该段标识
    expect(JSON.stringify(stored.warnings)).toContain('窗尾收口结算失败');
    // close_all 批不受影响：窗内流水已落；收口动作整批未落（settleListingForReview 只吞 UNIQUE）
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 1 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')).toMatchObject({ status: 'bidding' });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM transfers WHERE idempotency_key = 'listing:1'")).toMatchObject({ n: 0 });
  });
});
