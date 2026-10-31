// v6.62.0 普通续约免费机会（设计稿 §5.6 rev22 / 测试计划 docs/test-plans/v6.62.0-renewal-free.md）
// TC-RF-01..11 + TC-RF-13：免费全链路（提交→审核→谈判→apply）、降价同消耗、换队/买回刷新、
// match 与闹涨薪不消耗、4.4.10 回滚与离队 void 不消耗、A 买回现值、evidence 兼容、
// 守卫不放开、迁移 0085 形状。
// 夹具仿 tests/renewal-window.test.ts（引擎函数直调）；路由层由 tests/bypass-routes.test.ts 覆盖。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, runMigration, createAuthDb, authRegisterClubTeam, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { createRcChange, approveTransferDeal, rollbackRcChangeForPlayer } from '../src/worker/bypass.ts';
import { completeTransfer } from '../src/worker/transfers.ts';
import { offerWage } from '../src/worker/negotiations.ts';
import { acceptDemand } from '../src/worker/demand-ops.ts';
import { windowHomeStatements } from '../src/worker/home.ts';
import { loadNegotiationContext } from '../src/worker/negotiation-context.ts';
import { expectedWage } from '../src/worker/negotiation-secret.ts';
import { abilityLevel } from '../src/core/negotiation-rules.ts';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  auth: DatabaseSync;
}

const SEASON = 1;
const WINDOW = 1;
const OLD_SIGNED = '2026-01-01T00:00:00Z';

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const { sqlite: auth, d1: authD1 } = createAuthDb();
  const tour = new DatabaseSync(':memory:');
  tour.exec(`
    CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
    INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0);
  `);
  const kv = new Map<string, string>();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: authD1,
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    PUBLIC_CACHE_TTL_MS: '0',
    rng: () => 0.5,
  } as unknown as Env;
  return { env, sqlite, auth };
}

function seedClub(fx: Fixture, clubId: number, balance = 100): void {
  fx.sqlite
    .prepare(`INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (?, ?, 'premier', 'active', 0)`)
    .run(clubId, `俱乐部${clubId}`);
  fx.sqlite
    .prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, ?, '2026-07-01T00:00:00Z')`)
    .run(clubId, balance);
  fx.sqlite
    .prepare(
      `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at)
       VALUES (?, 'opening_import', ?, ?, '期初', '2026-07-01T00:00:00Z')`,
    )
    .run(clubId, balance, balance);
  fx.auth
    .prepare(`INSERT INTO account (id, name, created_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`)
    .run(clubId, `账号${clubId}`);
  authRegisterClubTeam(fx.auth, clubId, clubId, `队${clubId}`);
  fx.auth
    .prepare(`INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) SELECT ?, id, 'web', '2026-01-01T00:00:00Z' FROM team WHERE club_id = ?`)
    .run(clubId, clubId);
}

function addPlayer(fx: Fixture, id: number, clubId: number | null): void {
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, agent_tier, is_future_star)
       VALUES (?, ?, ?, ?, 'ST', 24, 80, 85, 'normal', 2, 0)`,
    )
    .run(id, `u${id}`, `球员${id}`, clubId);
}

interface ContractSeed {
  wage?: number;
  rc?: number;
  type?: string;
  service?: number;
  protection?: number | null;
  used?: number;
}

function addContract(fx: Fixture, playerId: number, clubId: number, over: ContractSeed = {}): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from,
                              service_ticks, protection_ticks, free_rc_change_used, is_active)
       VALUES (?, ?, ?, ?, ?, 'import', ?, '2026-01-01', ?, ?, ?, 1)`,
    )
    .run(
      playerId,
      clubId,
      over.rc ?? 20,
      over.wage ?? 2.5,
      over.type ?? 'formal',
      OLD_SIGNED,
      over.service ?? 4,
      over.protection ?? 8,
      over.used ?? 0,
    );
}

function contractOf(fx: Fixture, playerId: number): Record<string, unknown> {
  return sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contracts WHERE player_id = ? AND is_active = 1', playerId)!;
}

function addTransfer(
  fx: Fixture,
  over: {
    id: number;
    type?: string;
    playerId: number;
    from: number | null;
    to: number | null;
    fee?: number | null;
    status?: string;
    evidence?: string;
  },
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      over.id,
      over.type ?? 'transfer',
      over.playerId,
      over.from,
      over.to,
      over.fee === undefined ? 10 : over.fee,
      over.status ?? 'pending_review',
      SEASON,
      WINDOW,
      over.evidence ?? null,
    );
}

function addDemand(
  fx: Fixture,
  over: { id?: number; playerId: number; clubId: number; status?: string; wage?: number; rc?: number; resolution?: string | null; resolvedAt?: string | null },
): number {
  const info = fx.sqlite
    .prepare(
      `INSERT INTO contract_demands
         (player_id, club_id, season, window_seq, status, current_wage, expected_wage, target_wage, floor_wage,
          raise_pct, rc_current, rc_floor, rc_fee, round, expires_at, seed, resolution, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, 6.12, 3.7, 3.33, 0.48, ?, 25, 0, 0, '2027-01-01T00:00:00Z', 0, ?, ?)`,
    )
    .run(
      over.playerId,
      over.clubId,
      SEASON,
      WINDOW,
      over.status ?? 'pending',
      over.wage ?? 2.5,
      over.rc ?? 20,
      over.resolution ?? null,
      over.resolvedAt ?? null,
    );
  return over.id ?? Number(info.lastInsertRowid);
}

function addPending(
  fx: Fixture,
  over: { playerId: number; clubId: number; source?: string; wageNew?: number; releaseFeeNew?: number | null; protectionNew?: number | null; free?: number },
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contract_pending_changes
         (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new, rc_fee, free_rc_change, status, effective_window_seq)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?, 'pending', ?)`,
    )
    .run(
      over.playerId,
      over.clubId,
      over.source ?? 'renewal',
      over.wageNew ?? 3,
      over.releaseFeeNew ?? null,
      over.protectionNew ?? null,
      over.free ?? 0,
      WINDOW,
    );
}

function openWindowRow(fx: Fixture): void {
  fx.sqlite
    .prepare(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (?, ?, 'open', 0, '2026-07-01T00:00:00Z')`)
    .run(SEASON, WINDOW);
}

async function closeWindow(fx: Fixture): Promise<void> {
  const { statements } = await windowHomeStatements(fx.env, SEASON, WINDOW, { chargeNaming: false });
  await fx.env.DB.batch(statements);
}

const ledgerKinds = (fx: Fixture, clubId: number, kind: string) =>
  sqlAll<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE club_id = ? AND kind = ? ORDER BY id`, clubId, kind);

const pendingOf = (fx: Fixture, playerId: number): Record<string, unknown> =>
  sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE player_id = ? ORDER BY id DESC LIMIT 1', playerId)!;

/** 免费单的续约谈判基准（与非免费同公式）：E = expectedWage(level, newRc) × (1 + lo + (hi−lo)×roll)，roll 取夹具 rng=0.5 */
async function renewalExpectedWage(fx: Fixture, newRc: number): Promise<number> {
  const ctx = await loadNegotiationContext(fx.env.DB);
  const level = abilityLevel(80, 85, 24, ctx.youngBlendAge);
  const base = expectedWage(level, newRc, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
  const [lo, hi] = ctx.renewalRaise;
  return Math.round(base * (1 + lo + (hi - lo) * 0.5) * 100) / 100;
}

/** 提交 → 审核 → offer 成约（wage 按免费/非免费同公式算足 E 保证 success），返回 transferId */
async function runRenewal(fx: Fixture, playerId: number, clubId: number, newFee: number): Promise<number> {
  const submit = await createRcChange(fx.env, clubId, 1, playerId, newFee);
  const approve = await approveTransferDeal(fx.env, submit.transferId, 1, {
    taskId: submit.transferId,
    decidedBy: 1,
    decision: 'approved',
  });
  expect(approve.status).toBe('signing');
  const e = await renewalExpectedWage(fx, newFee);
  const session = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = ?', submit.transferId)!;
  const offer = await offerWage(fx.env, session.id, clubId, 1, e);
  expect(offer.result).toBe('success');
  return submit.transferId;
}

// ---------------------------------------------------------------------------
// TC-RF-13 · 迁移 0085
// ---------------------------------------------------------------------------

function contractCols(sqlite: DatabaseSync) {
  const rows = sqlAll<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
    sqlite,
    'PRAGMA table_info(contracts)',
  );
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

describe('TC-RF-13 · 迁移 0085', () => {
  it('全量迁移：列形状 INTEGER NOT NULL DEFAULT 0；实插一行读回 0（零回填 = 还没用过）', () => {
    const sqlite = new DatabaseSync(':memory:');
    expect(() => applyMigrations(sqlite)).not.toThrow();

    expect(contractCols(sqlite).free_rc_change_used).toMatchObject({
      type: 'INTEGER',
      notnull: 1,
      dflt_value: '0',
    });

    sqlite.exec(
      `INSERT INTO clubs (id, name) VALUES (1, '甲队');
       INSERT INTO players (id, uid, name, position, age, ca, pa, status) VALUES (1, 'fc1', '甲员', 'ST', 26, 80, 82, 'normal');
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active)
       VALUES (1, 1, 1, 10, 1, 'formal', 1)`,
    );
    expect(sqlGet<{ free_rc_change_used: number }>(sqlite, 'SELECT free_rc_change_used FROM contracts WHERE id = 1')).toEqual({
      free_rc_change_used: 0,
    });
  });

  it('单独 apply 0085（先 apply 再 push 的部署口径）：0084 止的存量库加列成功、既有行读 0', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0084_growth_attr_bonus.sql');
    expect(sqlAll(sqlite, "SELECT name FROM pragma_table_info('contracts') WHERE name = 'free_rc_change_used'")).toHaveLength(0);

    sqlite.exec(
      `INSERT INTO clubs (id, name) VALUES (1, '甲队');
       INSERT INTO players (id, uid, name, position, age, ca, pa, status) VALUES (1, 'fc1', '甲员', 'ST', 26, 80, 82, 'normal');
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active)
       VALUES (1, 1, 1, 10, 1, 'formal', 1)`,
    );
    expect(() => runMigration(sqlite, '0085_contracts_free_rc_change.sql')).not.toThrow();
    expect(contractCols(sqlite).free_rc_change_used).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(sqlGet<{ free_rc_change_used: number }>(sqlite, 'SELECT free_rc_change_used FROM contracts WHERE id = 1')).toEqual({
      free_rc_change_used: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// TC-RF-01 / 02 · 首次免费全链路 + 二次恢复现状
// ---------------------------------------------------------------------------

describe('TC-RF-01/02 · 免费全链路与二次收费', () => {
  it('首次免费提价：提交免预检、审核不扣款、pending 免费 NULL、apply 后 RC 新值保护期不变且 used=1', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 1); // 余额 1 < 差额 3（10→20 × 0.3）——免费必须跳过余额预检
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 10, service: 4, protection: 8 });

    // 提交：免费跳过余额预检（余额 1 < 3 仍 201），changeFee=0，evidence 带标记
    const submit = await createRcChange(fx.env, 1, 1, 1, 20);
    expect(submit.changeFee).toBe(0);
    const t = sqlGet<{ evidence: string; status: string }>(fx.sqlite, 'SELECT evidence, status FROM transfers WHERE id = ?', submit.transferId);
    expect(JSON.parse(t!.evidence)).toEqual({ oldReleaseFee: 10, oldProtectionTicks: 8, freeRcChange: true });

    // 审核：不扣款（无流水、余额不动、extra_fee 不落）
    const approve = await approveTransferDeal(fx.env, submit.transferId, 1, {
      taskId: submit.transferId,
      decidedBy: 1,
      decision: 'approved',
    });
    expect(approve.status).toBe('signing');
    expect(ledgerKinds(fx, 1, 'rc_change_fee')).toEqual([]);
    expect(sqlGet<{ extra_fee: number | null }>(fx.sqlite, 'SELECT extra_fee FROM transfers WHERE id = ?', submit.transferId)).toEqual({ extra_fee: null });

    // 谈判：renewalRaise 基准不变（E = expectedWage × U，免费与非免费同公式）
    const eFree = await renewalExpectedWage(fx, 20);
    const session = sqlGet<{ id: number; expected_wage: number | null }>(fx.sqlite, 'SELECT id, expected_wage FROM negotiation_sessions WHERE transfer_id = ?', submit.transferId);
    expect(session?.expected_wage).toBe(eFree);
    const offer = await offerWage(fx.env, session!.id, 1, 1, eFree);
    expect((offer as { result: string }).result).toBe('success');

    // 成约只写 pending：source=renewal、free_rc_change=1、protection_ticks_new=NULL（不收口）、rc_fee=0
    const pending = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE player_id = 1');
    expect(pending).toMatchObject({ source: 'renewal', free_rc_change: 1, protection_ticks_new: null, rc_fee: 0, status: 'pending' });
    expect(contractOf(fx, 1)).toMatchObject({ release_fee: 10, protection_ticks: 8, free_rc_change_used: 0 });

    // 关窗 apply：RC 新值生效、保护期保持原值（COALESCE 接 NULL）、机会消耗
    await closeWindow(fx);
    expect(contractOf(fx, 1)).toMatchObject({ release_fee: 20, protection_ticks: 8, free_rc_change_used: 1 });
    expect(pendingOf(fx, 1)).toMatchObject({ status: 'applied' });
  });

  it('二次提价恢复现状：审核扣 30%、pending 收口 baseTicks、apply 后保护期收口；余额不足 400', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 1);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 10, service: 4, protection: 8, used: 1 });

    // 余额不足：非免费提价（10→20 差额 3）被预检拦
    await expect(createRcChange(fx.env, 1, 1, 1, 20)).rejects.toThrow('可用资金不足');
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 100 WHERE club_id = 1`);

    const transferId = await runRenewal(fx, 1, 1, 20);
    expect(ledgerKinds(fx, 1, 'rc_change_fee')).toEqual([{ amount: -3 }]);
    expect(sqlGet<{ extra_fee: number | null }>(fx.sqlite, 'SELECT extra_fee FROM transfers WHERE id = ?', transferId)).toEqual({ extra_fee: 3 });
    const pending = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE player_id = 1');
    expect(pending).toMatchObject({ free_rc_change: 0, rc_fee: 3 });
    // 非免费收口：protection_ticks_new = baseTicks（当下已关常规窗数 0）——判定恒不成立，保护期结束
    expect(pending?.protection_ticks_new).toBe(0);

    await closeWindow(fx);
    expect(contractOf(fx, 1)).toMatchObject({ release_fee: 20, protection_ticks: 0, free_rc_change_used: 1 });
  });
});

// ---------------------------------------------------------------------------
// TC-RF-03 · 降价同消耗
// ---------------------------------------------------------------------------

describe('TC-RF-03 · 降价同消耗', () => {
  it('免费可用降价：自动走免费通道（不收费）、apply 消耗；随后提价不再免费', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8 });

    const submit = await createRcChange(fx.env, 1, 1, 1, 10);
    expect(submit.changeFee).toBe(0); // 降价本就不收费
    const t = sqlGet<{ evidence: string }>(fx.sqlite, 'SELECT evidence FROM transfers WHERE id = ?', submit.transferId);
    expect(JSON.parse(t!.evidence).freeRcChange).toBe(true); // 但仍走免费通道（消耗标记）
    await approveTransferDeal(fx.env, submit.transferId, 1, { taskId: submit.transferId, decidedBy: 1, decision: 'approved' });
    const session = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = ?', submit.transferId)!;
    const offer = await offerWage(fx.env, session.id, 1, 1, 2.5);
    expect((offer as { result: string }).result).toBe('success');
    await closeWindow(fx);

    expect(contractOf(fx, 1)).toMatchObject({ release_fee: 10, protection_ticks: 8, free_rc_change_used: 1 });

    // 随后提价不再免费：审核扣 30%（S1W1 已关，开 S1W2）
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    fx.sqlite
      .prepare(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 2, 'open', 0, '2026-08-01T00:00:00Z')`)
      .run();
    const submit2 = await createRcChange(fx.env, 1, 1, 1, 15);
    expect(submit2.changeFee).toBe(1.5);
    const t2 = sqlGet<{ evidence: string }>(fx.sqlite, 'SELECT evidence FROM transfers WHERE id = ?', submit2.transferId);
    expect(JSON.parse(t2!.evidence).freeRcChange).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-RF-04/05/09 · 换队刷新 / match 不动列 / A 买回现值
// ---------------------------------------------------------------------------

describe('TC-RF-04/05/09 · 换队刷新与不动列', () => {
  it('换队刷新：used=1 的球员被买走 → 新队合同归 0；B 分支买回 → 仍 0', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, used: 1 });

    addTransfer(fx, { id: 1, playerId: 1, from: 1, to: 2, fee: 10 });
    await completeTransfer(fx.env, 1, null, 'user', undefined, {
      wage: 3,
      releaseFee: 25,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(contractOf(fx, 1)).toMatchObject({ club_id: 2, free_rc_change_used: 0 });

    addTransfer(fx, { id: 2, playerId: 1, from: 2, to: 1, fee: 12 });
    await completeTransfer(fx.env, 2, null, 'user', undefined, {
      wage: 4,
      releaseFee: 30,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(contractOf(fx, 1)).toMatchObject({ club_id: 1, free_rc_change_used: 0 });
  });

  it('match 成约不动免费列（used=1 保持 1；used=0 保持 0）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, used: 1 });
    addTransfer(fx, { id: 1, type: 'match', playerId: 1, from: 1, to: 1, fee: 22 });
    await completeTransfer(fx.env, 1, null, 'user', undefined, {
      wage: 3,
      releaseFee: 22,
      source: 'match',
      contractType: 'formal',
    });
    expect(contractOf(fx, 1)).toMatchObject({ club_id: 1, release_fee: 22, free_rc_change_used: 1 });

    addPlayer(fx, 2, 1);
    addContract(fx, 2, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, used: 0 });
    addTransfer(fx, { id: 2, type: 'match', playerId: 2, from: 1, to: 1, fee: 22 });
    await completeTransfer(fx.env, 2, null, 'user', undefined, {
      wage: 3,
      releaseFee: 22,
      source: 'match',
      contractType: 'formal',
    });
    expect(contractOf(fx, 2)).toMatchObject({ free_rc_change_used: 0 });
  });

  it('海捞复签 UPSERT 翻新旧合同行：used=1 的旧行翻新后归 0（excluded 兜底）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 5, 1);
    addContract(fx, 5, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, used: 1 });
    // 解约（bypass 路径的终态）：行保留 is_active=0、球员去归属——复签时 INSERT 撞 player_id 走 upsert
    fx.sqlite.exec(`UPDATE contracts SET is_active = 0 WHERE player_id = 5; UPDATE players SET club_id = NULL WHERE id = 5`);

    addTransfer(fx, { id: 6, type: 'free_agent', playerId: 5, from: null, to: 2, fee: 20 });
    await completeTransfer(fx.env, 6, null, 'user', undefined, {
      wage: 3,
      releaseFee: 20,
      source: 'free_agent',
      contractType: 'formal',
    });
    expect(contractOf(fx, 5)).toMatchObject({ club_id: 2, free_rc_change_used: 0 });
  });

  it('A 分支买回（纯回归）：免费列用合同行现值、不进快照恢复', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 25, service: 4, protection: 8, used: 1 });
    // 离开 A 的已完成记录 + 本窗 A 的终局 demand（A 分支判据）
    fx.sqlite
      .prepare(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, completed_at) VALUES (1, 'transfer', 1, 1, 2, 10, 'completed', ?, ?, '2026-10-01T00:00:00Z')`)
      .run(SEASON, WINDOW);
    // 先把人卖到 B（换队刷新：used 1 → 0）——A 买回时的「现值」就是 0
    addTransfer(fx, { id: 2, playerId: 1, from: 1, to: 2, fee: 10 });
    await completeTransfer(fx.env, 2, null, 'user', undefined, {
      wage: 3,
      releaseFee: 25,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(contractOf(fx, 1)).toMatchObject({ club_id: 2, free_rc_change_used: 0 });

    addDemand(fx, { playerId: 1, clubId: 1, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-15T00:00:00Z', wage: 2.5, rc: 25 });
    addTransfer(fx, { id: 3, playerId: 1, from: 2, to: 1, fee: 12 });
    fx.sqlite.prepare(`INSERT INTO review_tasks (id, type, ref_id, status) VALUES (9, 'transfer', 3, 'open')`).run();
    const out = await approveTransferDeal(fx.env, 3, null, { taskId: 9, decidedBy: 1, decision: 'approved' });
    expect(out.status).toBe('completed');
    // A 买回恢复快照（效力/保护期），免费列沿用现值 0——不恢复成离开前的 1
    expect(contractOf(fx, 1)).toMatchObject({ club_id: 1, service_ticks: 4, protection_ticks: 8, free_rc_change_used: 0 });
  });
});

// ---------------------------------------------------------------------------
// TC-RF-06 · 闹涨薪不消耗
// ---------------------------------------------------------------------------

describe('TC-RF-06 · 闹涨薪不消耗', () => {
  it('demand 接受 apply 后 free_rc_change_used 不变；该球员随后续约仍免费', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8 });

    const demandId = addDemand(fx, { playerId: 1, clubId: 1, wage: 2.5, rc: 20 });
    const acc = await acceptDemand(fx.env, { demandId, clubId: 1, actor: 1, origin: 'user' });
    expect(acc).toMatchObject({ demandId, wage: 3.7, releaseFee: 25 }); // rc_floor 3.33 不进 pending，floor 只是还价锚
    expect(contractOf(fx, 1)).toMatchObject({ free_rc_change_used: 0 }); // 接受不动列
    expect(pendingOf(fx, 1)).toMatchObject({ source: 'demand', free_rc_change: 0 });

    await closeWindow(fx);
    expect(contractOf(fx, 1)).toMatchObject({ wage: 3.7, free_rc_change_used: 0 });

    // 同窗已闹过 → 409；下一窗续约仍免费
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    fx.sqlite
      .prepare(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 2, 'open', 0, '2026-08-01T00:00:00Z')`)
      .run();
    const submit = await createRcChange(fx.env, 1, 1, 1, 25);
    expect(submit.changeFee).toBe(0);
    const t = sqlGet<{ evidence: string }>(fx.sqlite, 'SELECT evidence FROM transfers WHERE id = ?', submit.transferId);
    expect(JSON.parse(t!.evidence).freeRcChange).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-RF-07/08 · 回滚与离队 void 不消耗
// ---------------------------------------------------------------------------

describe('TC-RF-07/08 · 回滚与离队不消耗', () => {
  it('4.4.10 回滚免费单：pending 作废、无退款流水、机会未消耗（再续约仍免费）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 10, service: 4, protection: 8 });

    const transferId = await runRenewal(fx, 1, 1, 15); // 免费提价成约，pending 已挂
    expect(pendingOf(fx, 1)).toMatchObject({ free_rc_change: 1, status: 'pending' });

    const rolled = await rollbackRcChangeForPlayer(fx.env, 1, 1, { refType: 'transfer', refId: transferId });
    expect(rolled).toBe(true);
    expect(pendingOf(fx, 1)).toMatchObject({ status: 'void' });
    expect(ledgerKinds(fx, 1, 'rc_change_fee')).toEqual([]); // 免费单退款循环跳过（extra_fee>0 过滤）
    expect(ledgerKinds(fx, 1, 'rc_change_refund')).toEqual([]);
    expect(contractOf(fx, 1)).toMatchObject({ free_rc_change_used: 0 });

    // 再续约仍免费
    const submit = await createRcChange(fx.env, 1, 1, 1, 15);
    expect(submit.changeFee).toBe(0);
  });

  it('非免费单回滚退款照旧（既有行为不回归）：30% 退还', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 10, service: 4, protection: 8, used: 1 });

    const transferId = await runRenewal(fx, 1, 1, 15);
    expect(ledgerKinds(fx, 1, 'rc_change_fee')).toEqual([{ amount: -1.5 }]);
    const rolled = await rollbackRcChangeForPlayer(fx.env, 1, 1, { refType: 'transfer', refId: transferId });
    expect(rolled).toBe(true);
    expect(ledgerKinds(fx, 1, 'rc_change_refund')).toEqual([{ amount: 1.5 }]);
    expect(contractOf(fx, 1)).toMatchObject({ free_rc_change_used: 1 });
  });

  it('离队者 pending 关窗批作废：免费行不消耗任何合同的 used', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    // 球员已在新东家 2（apply 的 void 路径判据）
    addPlayer(fx, 4, 2);
    addContract(fx, 4, 2, { wage: 3, rc: 25, used: 0 });
    addPending(fx, { playerId: 4, clubId: 1, source: 'renewal', wageNew: 3, releaseFeeNew: 30, free: 1 });

    await closeWindow(fx);
    expect(pendingOf(fx, 4)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    // 新东家合同一字不动（apply 只对仍在原队者执行，免费消耗也不例外）
    expect(contractOf(fx, 4)).toMatchObject({ club_id: 2, free_rc_change_used: 0 });
  });
});

// ---------------------------------------------------------------------------
// TC-RF-10/11 · evidence 兼容与守卫不放开
// ---------------------------------------------------------------------------

describe('TC-RF-10/11 · 兼容与守卫', () => {
  it('兼容（上线后裁决）：0085 前在途单 evidence 无 freeRcChange 按免费走全链路——不扣款、保护期不收口、apply 消耗', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 10, service: 4, protection: 8, used: 0 });

    // 0085 上线前已在途的续约单：evidence 只有旧两字段（无 freeRcChange）
    addTransfer(fx, {
      id: 5,
      type: 'rc_change',
      playerId: 1,
      from: 1,
      to: 1,
      fee: 15,
      evidence: JSON.stringify({ oldReleaseFee: 10, oldProtectionTicks: 8 }),
    });
    // 审核侧兜底：缺字段按免费——0085 零回填 DEFAULT 0，提交时机会必然未消耗
    const approve = await approveTransferDeal(fx.env, 5, 1, { taskId: 5, decidedBy: 1, decision: 'approved' });
    expect(approve.status).toBe('signing');
    expect(ledgerKinds(fx, 1, 'rc_change_fee')).toEqual([]);

    // 谈判成约：成约侧兜底同样生效——pending 免费（free_rc_change=1）、保护期写 NULL 不收口
    const eFree = await renewalExpectedWage(fx, 15);
    const session = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = 5');
    const offer = await offerWage(fx.env, session!.id, 1, 1, eFree);
    expect((offer as { result: string }).result).toBe('success');
    const pending = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE player_id = 1');
    expect(pending).toMatchObject({ source: 'renewal', free_rc_change: 1, protection_ticks_new: null, rc_fee: 0, status: 'pending' });

    // apply：机会消耗——每合同一次的口径闭环，旧单免费走完不会白拿第二次
    await closeWindow(fx);
    expect(contractOf(fx, 1)).toMatchObject({ release_fee: 15, protection_ticks: 8, free_rc_change_used: 1 });
  });

  it('守卫不因免费放开：训练营 400 / RC 越界 400 / 同窗 demand 409 / 在途 pending 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, 100);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 10, service: 4, protection: 8 });
    addPlayer(fx, 2, 1);
    addContract(fx, 2, 1, { wage: 0.75, rc: 5, type: 'trainee', protection: null });

    await expect(createRcChange(fx.env, 1, 1, 2, 8)).rejects.toThrow('训练营合同');
    await expect(createRcChange(fx.env, 1, 1, 1, 25)).rejects.toThrow('新违约金需在');
    // 提价越界与免费无关（免费只免钱不免边界）

    addDemand(fx, { playerId: 1, clubId: 1, wage: 2.5, rc: 10 });
    await expect(createRcChange(fx.env, 1, 1, 1, 15)).rejects.toThrow('本窗他的合同谈判机会已经用过');

    addPlayer(fx, 3, 1);
    addContract(fx, 3, 1, { wage: 2.5, rc: 10, service: 4, protection: 8 });
    addPending(fx, { playerId: 3, clubId: 1, source: 'renewal', wageNew: 3, releaseFeeNew: 15 });
    await expect(createRcChange(fx.env, 1, 1, 3, 15)).rejects.toThrow('待生效的合同变更');
  });
});
