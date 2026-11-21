// v6.88.2 B4 关窗并发围栏与恢复测试（docs/test-plans/v6.88.2-window-close-b4.md 的执行层）。
// 被测面：六个段提交点的租约围栏（assertCloseLeaseHeld 抛 CloseLeaseLostError 409 让位，
// 外层 catch 跳过 markCloseStepFailed——零写入退出）、markCloseStepFailed / completeCloseRun
// 的 run 语句 lease_owner 守卫（旧持有者失败收口/finalize 批不清新持有者租约）、
// completeCloseStep / completeCloseRun step 语句的 done 守卫（attempt 不虚增、summary_json
// 是 finalize 回读源不得被污染）、renewCloseLease 批尾续租 CAS、loadCloseSteps 后的段状态
// 洞校验（∃ i<j 使 steps[i] 未 done 且 steps[j] done → 409「跳段」）、死亡跳段态的 completed
// 回放零写、closing 冻结中间态。
//
// 夹具照抄 tests/window-close-runs.test.ts（R1 口径：该文件一字不改、既有断言全绿），新用例
// 全部集中在本文件。故障注入一律用 SQL 触发器（B2-05 先例同款）或 SQL 直造 run/step 状态，
// 不走正常路径——每个测试独立复现故障。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import {
  createTestD1,
  applyMigrations,
  sqlGet,
  sqlAll,
  attachAuthChannel,
  authRegisterClubTeam,
} from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  acquireCloseLease,
  assertCloseLeaseHeld,
  claimCloseRun,
  CLOSE_LEASE_TTL_MS,
  CLOSE_STEPS,
  CLOSE_STEP_FINALIZE,
  CLOSE_STEP_HOME,
  CLOSE_STEP_LOYALTY,
  CLOSE_STEP_PAYROLL,
  CLOSE_STEP_POST_CLOSE,
  CLOSE_STEP_PREFLIGHT,
  CloseLeaseLostError,
  completeCloseRun,
  completeCloseStep,
  loadCloseRun,
  markCloseStepFailed,
  renewCloseLease,
} from '../src/worker/window-close-runs.ts';
import { deliverCloseNotifications } from '../src/worker/window-close-outbox.ts';

// ---------- 夹具（照抄 tests/window-close-runs.test.ts，不改既有文件） ----------

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

// 基础局：两 club、球员+合同、账本期初 100、窗口 1 开着（形状与 runs 文件 seedWindow 一致：
// 仅 clubA 有合同 1 行 wage=2，无 stadiums 行 ⇒ 关窗 maintenance/loyalty/naming 全零形状）
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

// ---------- 本文件 helper ----------

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

function runRowOf(sqlite: DatabaseSync, season = 1, windowSeq = 1) {
  return sqlGet<RunRow>(
    sqlite,
    `SELECT id, status, current_step, lease_owner, lease_expires_at, started_at, updated_at, completed_at, error, summary_json
     FROM window_close_runs WHERE season = ? AND window_seq = ?`,
    season,
    windowSeq,
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

interface StepState {
  step: string;
  seq: number;
  status: string;
  attempt: number;
  error: string | null;
  summary_json: string | null;
}

function stepsOf(fx: Fixture, runId: number): StepState[] {
  return sqlAll<StepState>(
    fx.sqlite,
    'SELECT step, seq, status, attempt, error, summary_json FROM window_close_steps WHERE run_id = ? ORDER BY seq',
    runId,
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

/** 逐表计数快照（零业务写入对账用） */
function tableCounts(sqlite: DatabaseSync) {
  return {
    ledger: sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM ledger_entries')?.n ?? -1,
    audit: sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM audit_log')?.n ?? -1,
    notifications: sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM notifications')?.n ?? -1,
    outbox: sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')?.n ?? -1,
  };
}

/** 把 steps 全行快照成可比对形状（含 finished_at；逐格比对用） */
function stepsFull(sqlite: DatabaseSync, runId: number) {
  return sqlAll<StepState & { finished_at: string | null; started_at: string | null }>(
    sqlite,
    'SELECT step, seq, status, attempt, error, summary_json, started_at, finished_at FROM window_close_steps WHERE run_id = ? ORDER BY seq',
    runId,
  );
}

// TC-B4-03/04/14 共用的偷租触发器（等价对手 B 过 TTL 接管：payroll step done 落库瞬间偷换租约）
const STEAL_TRIGGER_SQL = `
  CREATE TRIGGER steal_b4 BEFORE UPDATE ON window_close_steps
    WHEN NEW.step = 'payroll' AND NEW.status = 'done'
    BEGIN
      UPDATE window_close_runs SET lease_owner = 'thief', lease_expires_at = '2999-01-01T00:00:00.000Z'
        WHERE id = NEW.run_id;
    END;`;

// B2-05 :609-611 先例同款的深层炸弹（打点 loyalty step done）
const FAIL_LOYALTY_TRIGGER_SQL = `
  CREATE TRIGGER fail_b4_loyalty BEFORE UPDATE ON window_close_steps
    WHEN NEW.step = 'loyalty' AND NEW.status = 'done'
    BEGIN SELECT RAISE(ABORT, 'boom-loyalty'); END;`;

// ---------- TC-B4-01 并发 claim ----------

describe('v6.88.2 B4 · TC-B4-01 并发 claim', () => {
  it('同 tick 两次 POST close：恰一 200 一 409，库态干净完成，零业务写入双局对账', async () => {
    // 局 R（竞态局）：node:sqlite 同步执行 + createTestD1 的 batch 原子 ⇒ 两请求按 microtask
    // 锁步交错，结果集确定（恰一个 200 + 一个 409——败者不可能走到 completed 回放：窗
    // closing→closed 与 run completed 同批原子，:631 的 win 查询只认 open/closing），
    // 发起序↔胜负映射不确定——断言一律按集合口径写。
    const fxR = await seedWindow();
    const [r1, r2] = await Promise.all([
      post('/api/admin/windows/close', {}, 'tok-admin', fxR.env),
      post('/api/admin/windows/close', {}, 'tok-admin', fxR.env),
    ]);
    expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    const loserBody: { error: string } = await loser.json();
    // 败者 409 文案按交错时点三分支之一（窗已关 / claim 时撞租约 / claim 时读窗为 closed）——集合口径
    expect(['关窗正在处理', '当前没有开着的窗口', '窗口刚被关过了'].some((m) => loserBody.error.includes(m))).toBe(true);

    // 局 R 库态 = 干净完成态：窗 closed、run 恰 1 行 completed、7 段全 done attempt=1
    //（claim 批恰好生效一次的间接锁——先到者 changes=1、后到者读已有 run 不重建）
    expect(winStatusOf(fxR.sqlite)).toMatchObject({ status: 'closed' });
    expect(sqlGet<{ n: number }>(fxR.sqlite, 'SELECT COUNT(*) AS n FROM window_close_runs')).toMatchObject({ n: 1 });
    const runR = runRowOf(fxR.sqlite);
    expect(runR).toMatchObject({ status: 'completed', current_step: CLOSE_STEP_POST_CLOSE });
    expect(stepsOf(fxR, runR?.id ?? 0)).toHaveLength(7);
    expect(stepsOf(fxR, runR?.id ?? 0).every((s) => s.status === 'done' && s.attempt === 1)).toBe(true);

    // 200 响应体与 JSON.parse(summary_json) 逐字段相等（回执同源）
    const winner = r1.status === 200 ? r1 : r2;
    const winnerBody: Record<string, unknown> = await winner.json();
    expect(winnerBody).toEqual(JSON.parse(runR?.summary_json ?? 'null'));

    // 局 S（单跑对照局）
    const fxS = await seedWindow();
    const resS = await post('/api/admin/windows/close', {}, 'tok-admin', fxS.env);
    expect(resS.status).toBe(200);

    // 零业务写入对账：局 R 与局 S 逐表计数完全一致（seedWindow 形状绝对值锁：wage 1 行 /
    // maintenance 0 行（无 stadiums 行）/ window_close 审计 1 行 / outbox 0 行）
    expect(tableCounts(fxR.sqlite)).toEqual(tableCounts(fxS.sqlite));
    expect(windowLedger(fxR, 'wage')).toMatchObject({ n: 1, total: 2 });
    expect(windowLedger(fxR, 'maintenance')).toMatchObject({ n: 0, total: 0 });
    expect(sqlGet<{ n: number }>(fxR.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(fxR.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')).toMatchObject({ n: 0 });
    expect(sqlGet<{ balance: number }>(fxR.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', fxR.clubA)).toMatchObject({ balance: 98 });
  });
});

// ---------- TC-B4-03 / TC-B4-14 偷租围栏端到端 ----------

describe('v6.88.2 B4 · TC-B4-03/14 偷租围栏端到端', () => {
  // 主局夹具：临时窗（payroll 批只含富人税、余额 100 不触税 ⇒ payroll 批零业务语句，
  // 「零段批业务写入」断言才可满足）+ 偷租触发器
  async function seedTempStolen(): Promise<Seeded> {
    const fx = await seedWindow();
    fx.sqlite.exec(`UPDATE season_windows SET is_temporary = 1 WHERE season = 1 AND window_seq = 1`);
    fx.sqlite.exec(STEAL_TRIGGER_SQL);
    return fx;
  }

  it('TC-B4-03 旧持有者被接管后继续提交被围栏：home 提交点 409 让位、零段批业务写入', async () => {
    const fx = await seedTempStolen();
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('关窗租约已易主');

    // steps：preflight、payroll done（payroll 批照常提交：temp payroll 无业务语句；批尾续租
    // CAS 对 thief 零改行不报错）；home 及其后全 pending attempt=0（CloseLeaseLostError 跳过
    // markCloseStepFailed 的直接后果）
    const run = runRowOf(fx.sqlite);
    expect(run).toMatchObject({
      status: 'running',
      current_step: CLOSE_STEP_HOME,
      lease_owner: 'thief',
      lease_expires_at: '2999-01-01T00:00:00.000Z',
    });
    const steps = stepsOf(fx, run?.id ?? 0);
    expect(steps[0]).toMatchObject({ step: CLOSE_STEP_PREFLIGHT, status: 'done', attempt: 1 });
    expect(steps[1]).toMatchObject({ step: CLOSE_STEP_PAYROLL, status: 'done', attempt: 1 });
    expect(steps.slice(2).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);

    // 零段批业务写入：窗内流水零行、window_close 审计零行、窗仍 closing
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'window' AND ref_id = 101")).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 0 });
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
  });

  it('TC-B4-03 对照局：同夹具去掉偷租触发器跑一次完整 close——证明触发器本身不破链路', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(`UPDATE season_windows SET is_temporary = 1 WHERE season = 1 AND window_seq = 1`);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    const run = runRowOf(fx.sqlite);
    expect(run).toMatchObject({ status: 'completed' });
    expect(stepsOf(fx, run?.id ?? 0).every((s) => s.status === 'done' && s.attempt === 1)).toBe(true);
    // 临时窗不扣工资；seedWindow 无 stadiums 行 ⇒ 维护费 0 行（登记：计划原稿「维护费每队恰
    // 1 行」是 parity seedClubsAndSquad 的形状，与 seedWindow 不符）
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 0 });
    expect(windowLedger(fx, 'maintenance')).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 1 });
  });

  it('TC-B4-14 偷租态第三方 POST 被拒：409 关窗正在处理、runs/steps/ledger/audit 全零变化', async () => {
    const fx = await seedTempStolen();
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(409);
    const runBefore = runRowOf(fx.sqlite);
    const stepsBefore = stepsFull(fx.sqlite, runBefore?.id ?? 0);
    const countsBefore = tableCounts(fx.sqlite);
    expect(runBefore).toMatchObject({ status: 'running', lease_owner: 'thief' });

    // 第三方 POST：claim 读窗 closing → resumed → acquire 撞 thief 的未过期租约 → 409
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('关窗正在处理');
    // acquire 失败 ⇒ 连 lease 列都不变：runs 行逐格原值、steps 全行逐格不变、窗仍 closing
    expect(runRowOf(fx.sqlite)).toEqual(runBefore);
    expect(stepsFull(fx.sqlite, runBefore?.id ?? 0)).toEqual(stepsBefore);
    expect(tableCounts(fx.sqlite)).toEqual(countsBefore);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
  });
});

// ---------- TC-B4-04 旧持有者 catch 不清新租约 ----------

describe('v6.88.2 B4 · TC-B4-04 旧持有者 catch 不清新租约（F2 三相）', () => {
  it('phase1 围栏先手 409 + phase2 markCloseStepFailed 带 owner 不清 thief 租约 + phase3 owner 匹配照常收口', async () => {
    // 常规窗（本例要 payroll 批真提交工资，与 TC-B4-03 的 temp 裁决相反）+ 双触发器同装
    const fx = await seedWindow();
    fx.sqlite.exec(STEAL_TRIGGER_SQL);
    fx.sqlite.exec(FAIL_LOYALTY_TRIGGER_SQL);

    // —— phase 1（围栏先手，端到端）：payroll 批提交时偷租 → home 提交点围栏先于 loyalty
    // 段触达（RAISE 已挂但不可达，这是 F4 先手性的行为锁）→ 409 让位、零写入
    const res1 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res1.status).toBe(409);
    const body1: { error: string } = await res1.json();
    expect(body1.error).toContain('关窗租约已易主');
    const run1 = runRowOf(fx.sqlite);
    expect(run1).toMatchObject({
      status: 'running',
      lease_owner: 'thief',
      lease_expires_at: '2999-01-01T00:00:00.000Z',
    });
    const steps1 = stepsOf(fx, run1?.id ?? 0);
    expect(steps1[0]).toMatchObject({ step: CLOSE_STEP_PREFLIGHT, status: 'done', attempt: 1 });
    expect(steps1[1]).toMatchObject({ step: CLOSE_STEP_PAYROLL, status: 'done', attempt: 1 });
    expect(steps1.slice(2).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);
    // 常规窗 payroll 批已提交：工资流水在场（与 TC-B4-03 的零业务写不同，此处如实登记）
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 1, total: 2 });

    // —— phase 2（F2 直接面）：旧持有者（哨兵串 owner-old ≠ thief）直调失败收口——
    // run 语句被 AND lease_owner = ? 挡住：run 逐格不变（新持有者租约未被清、run 未翻 failed）
    const runBefore = runRowOf(fx.sqlite);
    await markCloseStepFailed(fx.env.DB, run1?.id ?? 0, CLOSE_STEP_LOYALTY, new Error('boom-old'), 'owner-old');
    expect(runRowOf(fx.sqlite)).toEqual(runBefore);
    // 登记面（计划 TC-B4-04 (a)）：step 语句不带 owner 守卫（施工表 M2 字面只守 run 语句）——
    // loyalty step 此处会翻 failed attempt=1，该 step 终态不作 F2 判据
    expect(stepsOf(fx, run1?.id ?? 0)[3]).toMatchObject({ step: CLOSE_STEP_LOYALTY, status: 'failed', attempt: 1 });

    // —— phase 3（owner 匹配对照）：租约回到旧主后同款直调 → run 翻 failed + 租约清空
    //（CAS 不是一刀切闸：owner 匹配时失败收口语义与 T05 一致——T05 既有覆盖不重写）
    fx.sqlite.prepare(`UPDATE window_close_runs SET lease_owner = 'owner-old' WHERE id = ?`).run(run1?.id ?? 0);
    await markCloseStepFailed(fx.env.DB, run1?.id ?? 0, CLOSE_STEP_LOYALTY, new Error('boom-old'), 'owner-old');
    const run3 = runRowOf(fx.sqlite);
    expect(run3).toMatchObject({ status: 'failed', lease_owner: null, lease_expires_at: null });
    expect(run3?.error).toBe('boom-old');
  });
});

// ---------- TC-B4-06 loyalty 段失败 / TC-B4-15 resume 摘要回读防御 ----------

describe('v6.88.2 B4 · TC-B4-06/15 段失败与防御', () => {
  it('TC-B4-06 loyalty 段失败：前段已提交、loyalty 批整回滚、owner 匹配时失败收口语义不变', async () => {
    // 常规 S1W1：ordinal=1 ⇒ loyalty 空批（summary {count:0,total:0} 非 null）⇒ loyalty 批照跑
    // ⇒ RAISE 打点必达
    const fx = await seedWindow();
    fx.sqlite.exec(FAIL_LOYALTY_TRIGGER_SQL);

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(500);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
    const run = runRowOf(fx.sqlite);
    expect(run).toMatchObject({ status: 'failed', current_step: CLOSE_STEP_LOYALTY });
    expect(run?.error).toContain('boom-loyalty');
    const steps = stepsOf(fx, run?.id ?? 0);
    expect(steps[0]).toMatchObject({ step: CLOSE_STEP_PREFLIGHT, status: 'done', attempt: 1 });
    expect(steps[1]).toMatchObject({ step: CLOSE_STEP_PAYROLL, status: 'done', attempt: 1 });
    expect(steps[2]).toMatchObject({ step: CLOSE_STEP_HOME, status: 'done', attempt: 1 });
    // home 段摘要落 step 行（resume 收口回读源；B4 F1 后该列不会被 done 覆写污染）
    const homeSummary: Record<string, unknown> = JSON.parse(steps[2]?.summary_json ?? 'null');
    expect(homeSummary).toHaveProperty('maintenanceClubs');
    expect(steps[3]).toMatchObject({ step: CLOSE_STEP_LOYALTY, status: 'failed', attempt: 1 });
    expect(steps.slice(4).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);
    // 前段已提交（工资恰一份；seedWindow 无 stadiums ⇒ maintenance 0 行）、审计零行、租约已清
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 0 });
    expect(run?.lease_expires_at).toBeNull();
  });

  it('TC-B4-15 resume 摘要回读防御 500：payroll done 无 summary → finalize 汇总回读抛「摘要缺失或损坏」', async () => {
    const fx = await seedWindow();
    // claim（不持租）→ SQL 直造 preflight+payroll done、summary_json 留 NULL（前缀形状成立，
    // 绕过 F5 洞校验；防御点在 finalize 段的汇总回读）
    const claim = await claimCloseRun(fx.env, 1, 1, 1, false);
    expect(claim.kind).toBe('claimed');
    fx.sqlite.exec(`
      UPDATE window_close_steps SET status = 'done', attempt = 1, finished_at = '2026-07-02T00:00:00Z'
        WHERE run_id = (SELECT id FROM window_close_runs WHERE season = 1 AND window_seq = 1)
          AND step IN ('preflight', 'payroll');`);

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(500);
    const run = runRowOf(fx.sqlite);
    expect(run).toMatchObject({ status: 'failed', current_step: CLOSE_STEP_FINALIZE });
    expect(run?.error).toContain('摘要缺失或损坏');
    // preflight 已 done 不重跑、payroll 跳过（builder null）⇒ wage 流水不在场（工资从未扣过——
    // payroll done 是 SQL 伪造）；home/loyalty/squad 段首次真提交 ⇒ squad_audits 在场；
    // 防御点在 finalize 的汇总回读：window_close 审计零行、窗仍 closing
    const steps = stepsOf(fx, run?.id ?? 0);
    expect(steps[0]).toMatchObject({ step: CLOSE_STEP_PREFLIGHT, status: 'done', attempt: 1 });
    expect(steps[1]).toMatchObject({ step: CLOSE_STEP_PAYROLL, status: 'done', attempt: 1 });
    expect(steps.slice(2, 5).every((s) => s.status === 'done' && s.attempt === 1)).toBe(true);
    expect(steps[5]).toMatchObject({ step: CLOSE_STEP_FINALIZE, status: 'failed', attempt: 1 });
    expect(steps[6]).toMatchObject({ step: CLOSE_STEP_POST_CLOSE, status: 'pending', attempt: 0 });
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM squad_audits')).toMatchObject({ n: 2 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 0 });
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
  });
});

// ---------- TC-B4-07 / TC-B4-13 段状态洞拒绝推进（F5）----------

describe('v6.88.2 B4 · TC-B4-07/13 段状态洞拒绝推进（F5）', () => {
  /** 夹具：claim（不持租，后续 POST 要能 acquire）→ SQL 直造洞 → 返回快照 */
  async function seedHole(doneSteps: string[]) {
    const fx = await seedWindow();
    const claim = await claimCloseRun(fx.env, 1, 1, 1, false);
    expect(claim.kind).toBe('claimed');
    fx.sqlite
      .prepare(
        `UPDATE window_close_steps SET status = 'done', attempt = 1, finished_at = '2026-07-02T00:00:00Z'
         WHERE run_id = ? AND step IN (${doneSteps.map(() => '?').join(', ')})`,
      )
      .run(claim.run.id, ...doneSteps);
    const runBefore = runRowOf(fx.sqlite);
    const stepsBefore = stepsFull(fx.sqlite, claim.run.id);
    const countsBefore = tableCounts(fx.sqlite);
    return { fx, runId: claim.run.id, runBefore, stepsBefore, countsBefore };
  }

  /** 共同断言：409「跳段」+ steps/ledger/audit 零变化 + runs 仅 acquire 三列合法变化 + 窗仍 closing */
  async function expectHoleRejected(h: Awaited<ReturnType<typeof seedHole>>) {
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', h.fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('跳段');
    expect(stepsFull(h.fx.sqlite, h.runId)).toEqual(h.stepsBefore);
    expect(tableCounts(h.fx.sqlite)).toEqual(h.countsBefore);
    // runs 行除 lease_owner / lease_expires_at / updated_at（acquire 本身的合法写入，非业务写）
    // 外逐格原值：status 仍 running、current_step 仍 preflight
    const runAfter = runRowOf(h.fx.sqlite);
    expect(runAfter).toBeDefined();
    expect({
      id: runAfter?.id,
      status: runAfter?.status,
      current_step: runAfter?.current_step,
      started_at: runAfter?.started_at,
      completed_at: runAfter?.completed_at,
      error: runAfter?.error,
      summary_json: runAfter?.summary_json,
    }).toEqual({
      id: h.runBefore?.id,
      status: h.runBefore?.status,
      current_step: h.runBefore?.current_step,
      started_at: h.runBefore?.started_at,
      completed_at: h.runBefore?.completed_at,
      error: h.runBefore?.error,
      summary_json: h.runBefore?.summary_json,
    });
    expect(winStatusOf(h.fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
  }

  it('TC-B4-07 洞形态一（首段 pending、次段 done）：409 跳段 + 全零变化', async () => {
    const h = await seedHole([CLOSE_STEP_PAYROLL]); // preflight 保持 pending ⇒ seq1 pending、seq2 done
    await expectHoleRejected(h);
  });

  it('TC-B4-13 洞形态二（中间 pending、其后 done）：409 跳段 + 全零变化', async () => {
    const h = await seedHole([CLOSE_STEP_PREFLIGHT, CLOSE_STEP_HOME]); // payroll pending ⇒ 首 pending 是 seq2、seq3 done
    await expectHoleRejected(h);
  });

  it('TC-B4-18 登记面：手工拨步出「后缀 done 洞态」（home..squad pending + finalize/post_close done）被 F5 拒绝', async () => {
    // 计划原稿的拨步列（home/loyalty/squad_audit pending + finalize/post_close 保持 done）在
    // F5 语义下是洞态（seq3 未 done 而 seq6 done）——真实流不可达，POST close 必 409 拒绝，
    // 不再重放已提交段（M5 的端到端载体改走前缀形状拨步，见下方 TC-B4-18 用例）
    const fx = await seedWindow();
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    fx.sqlite.exec(`
      UPDATE season_windows SET status = 'closing', closed_at = NULL WHERE season = 1 AND window_seq = 1;
      UPDATE window_close_runs SET status = 'running', completed_at = NULL, summary_json = NULL
        WHERE season = 1 AND window_seq = 1;
      UPDATE window_close_steps SET status = 'pending', attempt = 0
        WHERE run_id = (SELECT id FROM window_close_runs WHERE season = 1 AND window_seq = 1)
          AND step IN ('home', 'loyalty', 'squad_audit');`);
    const runBefore = runRowOf(fx.sqlite);
    const stepsBefore = stepsFull(fx.sqlite, runBefore?.id ?? 0);
    const countsBefore = tableCounts(fx.sqlite);

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toContain('跳段');
    expect(stepsFull(fx.sqlite, runBefore?.id ?? 0)).toEqual(stepsBefore);
    expect(tableCounts(fx.sqlite)).toEqual(countsBefore);
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closing', closed_at: null });
  });
});

// ---------- TC-B4-08 finalize↔post_close 死亡跳段态 ----------

describe('v6.88.2 B4 · TC-B4-08 死亡跳段态：completed 回放零写 + outbox 保持', () => {
  it('SQL 直造 run completed + 前六段 done + post_close pending + outbox pending 行 → POST close 零写回放', async () => {
    const fx = await seedWindow();
    // SQL 直造防御态（claim 造不出 completed）：窗 closing（completed 回放仅 closing 可达——
    // closeWindow 的 win 查询只认 open/closing）、run completed（摘要用 T10 形状逐字）、
    // steps 前六段 done + post_close pending、outbox 一行 pending
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
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closing' WHERE season = 1 AND window_seq = 1`);
    fx.sqlite
      .prepare(
        `INSERT INTO window_close_runs (season, window_seq, status, current_step, started_at, updated_at, completed_at, error, summary_json)
         VALUES (1, 1, 'completed', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, ?)`,
      )
      .run(CLOSE_STEP_POST_CLOSE, summaryJson);
    const runId = runRowOf(fx.sqlite)?.id ?? 0;
    fx.sqlite
      .prepare(
        `INSERT INTO window_close_steps (run_id, step, seq, status, attempt, finished_at)
         SELECT ?, ?, ?, ?, 1, '2026-07-01T00:00:00.000Z'`,
      )
      .run(runId, CLOSE_STEP_POST_CLOSE, 7, 'pending');
    for (const [index, step] of CLOSE_STEPS.slice(0, 6).entries()) {
      fx.sqlite
        .prepare(
          `INSERT INTO window_close_steps (run_id, step, seq, status, attempt, finished_at)
           SELECT ?, ?, ?, 'done', 1, '2026-07-01T00:00:00.000Z'`,
        )
        .run(runId, step, index + 1);
    }
    fx.sqlite
      .prepare(
        `INSERT INTO window_close_notifications (run_id, club_id, template, payload, dedup_key, status, attempt, created_at)
         VALUES (?, ?, 'squad_audit_failed', ?, 'squad:dup-check', 'pending', 0, '2026-07-01T00:00:00.000Z')`,
      )
      .run(runId, fx.clubA, '{"text":"x","season":1,"windowSeq":1,"overspend":0,"rules":""}');
    const stepsBefore = stepsFull(fx.sqlite, runId);
    const countsBefore = tableCounts(fx.sqlite);

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: Record<string, unknown> = await res.json();
    // claim 走 resolveExistingRun 的 completed 分支 → 回放既有摘要（响应体逐字段相等）
    expect(body).toEqual(JSON.parse(summaryJson));
    // outbox 行仍 pending attempt=0、notifications 零新增、steps 零变化（completed 零写入 +
    // 已裁决口径：post_close 无自动兜底）
    expect(sqlGet<{ status: string; attempt: number }>(fx.sqlite, 'SELECT status, attempt FROM window_close_notifications WHERE run_id = ?', runId)).toMatchObject({ status: 'pending', attempt: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')).toMatchObject({ n: 0 });
    expect(stepsFull(fx.sqlite, runId)).toEqual(stepsBefore);
    expect(tableCounts(fx.sqlite)).toEqual(countsBefore);

    // 管理端 retry 原语可用：直调 deliverCloseNotifications → 行转 sent、notifications 恰增 1
    const delivered = await deliverCloseNotifications(fx.env, runId);
    expect(delivered).toMatchObject({ delivered: 1, failed: 0, skipped: 0 });
    expect(sqlGet<{ status: string; attempt: number }>(fx.sqlite, 'SELECT status, attempt FROM window_close_notifications WHERE run_id = ?', runId)).toMatchObject({ status: 'sent', attempt: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'squad_audit_failed'")).toMatchObject({ n: 1 });
  });
});

// ---------- TC-B4-09 closing 冻结中间态 ----------

describe('v6.88.2 B4 · TC-B4-09 冻结中间态（B2-14 真身）', () => {
  it('steps 部分 done 时：写 409 window_closing、GET 200（冻结判据只看窗状态、与 step 状态解耦）', async () => {
    const fx = await seedWindow();
    await claimWithLease(fx, 'owner-a');
    // 直造 steps 部分 done（preflight/payroll）——冻结判据只读 season_windows.status
    fx.sqlite.exec(`
      UPDATE window_close_steps SET status = 'done', attempt = 1
        WHERE run_id = (SELECT id FROM window_close_runs WHERE season = 1 AND window_seq = 1)
          AND step IN ('preflight', 'payroll');`);
    const blocked = await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env);
    expect(blocked.status).toBe(409);
    const body: { error: string; code: string } = await blocked.json();
    expect(body).toEqual({ error: '窗口正在关闭，暂时不能修改', code: 'window_closing' });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM listings')).toMatchObject({ n: 0 });
    expect((await get('/api/market/listings', 'tok-coach', fx.env)).status).toBe(200);
  });
});

// ---------- TC-B4-10 / TC-B4-12 / TC-B4-17 原语单元 ----------

describe('v6.88.2 B4 · 原语单元（F1 done no-op / F3 renewCloseLease CAS / F4 assert）', () => {
  it('TC-B4-10 completeCloseStep / completeCloseRun 对已 done step 零改行（F1）', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    const db = fx.env.DB;
    // 直造 payroll step done（带 attempt/finished_at/summary）
    fx.sqlite
      .prepare(
        `UPDATE window_close_steps SET status = 'done', attempt = 2, finished_at = '2026-07-02T00:00:00Z', summary_json = ?
         WHERE run_id = ? AND step = ?`,
      )
      .run('{"wageClubs":9}', run.id, CLOSE_STEP_PAYROLL);
    const rowOf = () =>
      sqlGet<{ status: string; attempt: number; finished_at: string | null; summary_json: string | null }>(
        fx.sqlite,
        'SELECT status, attempt, finished_at, summary_json FROM window_close_steps WHERE run_id = ? AND step = ?',
        run.id,
        CLOSE_STEP_PAYROLL,
      );
    const before = rowOf();

    // 不带 summary 变体：changes=0、行逐字不变（现状无守卫时 changes=1、attempt 虚增——施工前红）
    const r1 = await db.batch(completeCloseStep(db, run.id, CLOSE_STEP_PAYROLL));
    expect(r1.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(rowOf()).toEqual(before);

    // 带 summary 变体：changes=0、summary_json 原值不被覆写（summary 是 finalize 回读源）
    const r2 = await db.batch(completeCloseStep(db, run.id, CLOSE_STEP_PAYROLL, { x: 1 }));
    expect(r2.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(rowOf()).toEqual(before);

    // F1 completeCloseRun 的 step 语句同守卫：直造 finalize done → 只执行 step 语句 → changes=0
    fx.sqlite
      .prepare(
        `UPDATE window_close_steps SET status = 'done', attempt = 3, finished_at = '2026-07-03T00:00:00Z'
         WHERE run_id = ? AND step = ?`,
      )
      .run(run.id, CLOSE_STEP_FINALIZE);
    const finBefore = sqlGet<{ status: string; attempt: number; finished_at: string | null }>(
      fx.sqlite,
      'SELECT status, attempt, finished_at FROM window_close_steps WHERE run_id = ? AND step = ?',
      run.id,
      CLOSE_STEP_FINALIZE,
    );
    const r3 = await db.batch([completeCloseRun(db, run.id, CLOSE_STEP_FINALIZE, { ok: true })[0]]);
    expect(r3.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(
      sqlGet<{ status: string; attempt: number; finished_at: string | null }>(
        fx.sqlite,
        'SELECT status, attempt, finished_at FROM window_close_steps WHERE run_id = ? AND step = ?',
        run.id,
        CLOSE_STEP_FINALIZE,
      ),
    ).toEqual(finBefore);
  });

  it('TC-B4-10 renewCloseLease CAS：owner 匹配续期 changes=1、不匹配零改行（F3 形状锁）', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    const db = fx.env.DB;
    const before = runRowOf(fx.sqlite);

    // owner 匹配：changes=1、lease_expires_at 续期（UTC ISO 串可比，新值 ≥ 旧值）、lease_owner 不变
    const r1 = await db.batch([renewCloseLease(db, run.id, 'owner-a', CLOSE_LEASE_TTL_MS)]);
    expect(r1.map((r) => r.meta.changes ?? 0)).toEqual([1]);
    const after = runRowOf(fx.sqlite);
    expect(after?.lease_owner).toBe('owner-a');
    expect((after?.lease_expires_at ?? '') >= (before?.lease_expires_at ?? '')).toBe(true);
    // 其余列逐格不变（renew 只动 lease_expires_at）
    expect({ ...after, lease_expires_at: undefined }).toEqual({ ...before, lease_expires_at: undefined });

    // owner 不匹配：changes=0、lease 两列逐字不变
    const stolen = runRowOf(fx.sqlite);
    const r2 = await db.batch([renewCloseLease(db, run.id, 'owner-b', CLOSE_LEASE_TTL_MS)]);
    expect(r2.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(runRowOf(fx.sqlite)).toEqual(stolen);
  });

  it('TC-B4-12 assertCloseLeaseHeld：本手不抛、失配抛 CloseLeaseLostError 409（F4 错误形状）', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    // 本手：正常返回（不抛）
    const held = await loadCloseRun(fx.env.DB, run.id);
    expect(held).not.toBeNull();
    expect(() => assertCloseLeaseHeld(held, 'owner-a')).not.toThrow();
    // SQL 偷换 lease_owner → 再直调 → CloseLeaseLostError（409 + 定稿文案）
    fx.sqlite.prepare(`UPDATE window_close_runs SET lease_owner = 'thief' WHERE id = ?`).run(run.id);
    const stolen = await loadCloseRun(fx.env.DB, run.id);
    const err = await catchHttp(
      (async () => {
        assertCloseLeaseHeld(stolen, 'owner-a');
        return null;
      })(),
    );
    expect(err).toBeInstanceOf(CloseLeaseLostError);
    expect(err).toHaveProperty('status', 409);
    expect(err).toHaveProperty('message', '关窗租约已易主，本次请求让位');
    // run 行缺失（对手已完成清租）同判失配：CloseLeaseLostError
    const missingErr = await catchHttp(
      (async () => {
        assertCloseLeaseHeld(null, 'owner-a');
        return null;
      })(),
    );
    expect(missingErr).toBeInstanceOf(CloseLeaseLostError);
    expect(missingErr).toHaveProperty('status', 409);
  });

  it('TC-B4-17 renewCloseLease 边界：过期自续 changes=1、未过期他主 changes=0、过期他主不夺 changes=0', async () => {
    const fx = await seedWindow();
    const run = await claimWithLease(fx, 'owner-a');
    const db = fx.env.DB;
    // ① 过期自续：owner 仍 owner-a、lease_expires_at 拨到过去 → 续租判据是 owner 匹配，changes=1
    fx.sqlite.prepare(`UPDATE window_close_runs SET lease_expires_at = '2026-01-01T00:00:00Z' WHERE id = ?`).run(run.id);
    const r1 = await db.batch([renewCloseLease(db, run.id, 'owner-a', CLOSE_LEASE_TTL_MS)]);
    expect(r1.map((r) => r.meta.changes ?? 0)).toEqual([1]);
    expect(runRowOf(fx.sqlite)).toMatchObject({ lease_owner: 'owner-a' });
    // ② 未过期他主：owner-a 在持 → owner-b 续租零改行
    const r2 = await db.batch([renewCloseLease(db, run.id, 'owner-b', CLOSE_LEASE_TTL_MS)]);
    expect(r2.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    // ③ 过期他主不夺：再拨过期 → owner-b 仍零改行（他主必须走 acquire 的 CAS 接管，不得借续租偷渡）
    fx.sqlite.prepare(`UPDATE window_close_runs SET lease_expires_at = '2026-01-01T00:00:00Z' WHERE id = ?`).run(run.id);
    const r3 = await db.batch([renewCloseLease(db, run.id, 'owner-b', CLOSE_LEASE_TTL_MS)]);
    expect(r3.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(runRowOf(fx.sqlite)).toMatchObject({ lease_owner: 'owner-a' });
  });
});

// ---------- TC-B4-16 六提交点围栏源码文本锁 ----------

describe('v6.88.2 B4 · TC-B4-16 六提交点围栏源码文本锁', () => {
  it('window-machine.ts 源文：assertCloseLeaseHeld ≥ 6 次、renewCloseLease ≥ 6 次（import + 六段调用点）', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/worker/window-machine.ts', import.meta.url).href), 'utf8');
    // 六个段提交点（preflight/payroll/home/loyalty/squad_audit/finalize）各一次围栏调用 +
    // import 各一次；renewCloseLease 为五个业务段批尾续租 + import = 6（finalize 批除外——
    // completeCloseRun 完成即清租，尾追续租会与清租互相覆盖）
    expect(src.split('assertCloseLeaseHeld').length - 1).toBeGreaterThanOrEqual(6);
    expect(src.split('renewCloseLease').length - 1).toBeGreaterThanOrEqual(6);
  });
});

// ---------- TC-B4-18 已提交段重放 × 账本闸（M5 载体）----------

describe('v6.88.2 B4 · TC-B4-18 已提交段重放 × 账本闸（M5 载体）', () => {
  it('前缀形状拨步（payroll..post_close 全 pending）→ resume 重放：wage 恰 1 行、余额不变、attempt=2', async () => {
    const fx = await seedWindow();
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);

    // 手工拨步（真实流不可达态，本例是变异载体与登记面）：窗 closing、run running、
    // payroll..post_close 拨 pending——preflight 保持 done ⇒ 前缀形状成立（F5 放行）；
    // 计划原稿的「finalize/post_close 保持 done」是后缀洞态、会被 F5 拒（见上方登记面用例）
    fx.sqlite.exec(`
      UPDATE season_windows SET status = 'closing', closed_at = NULL WHERE season = 1 AND window_seq = 1;
      UPDATE window_close_runs SET status = 'running', completed_at = NULL, summary_json = NULL
        WHERE season = 1 AND window_seq = 1;
      UPDATE window_close_steps SET status = 'pending', attempt = 0
        WHERE run_id = (SELECT id FROM window_close_runs WHERE season = 1 AND window_seq = 1)
          AND step <> 'preflight';`);

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    // M5 红面：wage 流水恰 1 行——重放的 wage 语句撞 ledgerMovement 幂等闸（NOT EXISTS +
    // changes()>0 联动）零改行；M5 删闸 → 2 行 + 余额漂移（变异轮唯一判据）
    expect(windowLedger(fx, 'wage')).toMatchObject({ n: 1, total: 2 });
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', fx.clubA)).toMatchObject({ balance: 98 });
    // finalize 重跑（拨 pending ⇒ ranFinalize=true）：窗 closed、run completed、summary 重建
    expect(winStatusOf(fx.sqlite)).toMatchObject({ status: 'closed' });
    expect(runRowOf(fx.sqlite)).toMatchObject({ status: 'completed' });
    // 重放面如实登记：拨步把 payroll..post_close 的 attempt 归零，重放后各段 attempt=1
    //（「attempt=2」口径只在真实 failed-resume 路径成立——首轮 failed 时 markCloseStepFailed
    // 已 attempt+1，见 B2-08；本例是手工拨步载体，非该路径）、preflight 不重跑 attempt=1
    const run = runRowOf(fx.sqlite);
    const steps = stepsOf(fx, run?.id ?? 0);
    expect(steps[0]).toMatchObject({ step: CLOSE_STEP_PREFLIGHT, status: 'done', attempt: 1 });
    expect(steps.slice(1).every((s) => s.status === 'done' && s.attempt === 1)).toBe(true);
    // 登记漂移（不作绿判据）：finalize 重跑 → window_close 审计 2 行（审计无闸）；体检存档
    // INSERT OR REPLACE（squad-audit.ts:244）幂等覆写 ⇒ squad_audits 仍 2 行——计划原稿预判
    // 「行数翻倍」不成立，按实际语义登记
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close'")).toMatchObject({ n: 2 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM squad_audits')).toMatchObject({ n: 2 });
    // outbox / notifications 零行（体检全过无通知；post_close 重放零投递）
    expect(tableCounts(fx.sqlite)).toMatchObject({ outbox: 0, notifications: 0 });
  });
});
