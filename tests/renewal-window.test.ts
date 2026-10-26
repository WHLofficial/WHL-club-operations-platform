// v6.54.0 步骤 5 集成测试：关窗生效（设计 §5.7）与关窗/转会耦合（§5.4「回原队」）。
// 锁四组口径：
//   ① 关窗批统一 apply：demand 接受 / renewal 续约 / rejection 保护期失效同一条路径；
//      管制是「交易结算之后、下一窗之前」，contracts 在关窗批提交前一字不动；离队者 void。
//   ② completeTransfer 换队分支写快照三列，普通换队仍按窗刻度重锚（既有行为零变化）。
//   ③ 买回三分支（TC-RD-43）：B 无纠葛 → 快照恢复 + 占本窗额度、不计终局；
//      A 已闹 → 跳过谈判纯回归；A 直拒 → 徽章/通告/保护期失效重挂；A 其他终局 → 计一次 expired 入新段。
//   ④ 离队作废链（TC-RD-45）：demand / 在途 pending / 转会申请与「不满」徽章一并收口；
//      cron 的 expireDemands 已挂进 runSettleTick（自带 try/catch）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { completeTermination, completeTransfer } from '../src/worker/transfers.ts';
import { windowHomeStatements } from '../src/worker/home.ts';
import { applyPendingContractChanges, expireDemands, rejectDemand } from '../src/worker/demand-ops.ts';
import { approveTransferDeal, createRcChange } from '../src/worker/bypass.ts';
import { submitReleaseFee } from '../src/worker/negotiations.ts';
import { loadNegotiationContext } from '../src/worker/negotiation-context.ts';
import { expectedWage } from '../src/worker/negotiation-secret.ts';
import { abilityLevel } from '../src/core/negotiation-rules.ts';
import { seededUnit } from '../src/core/seeded.ts';
import { segmentFinals } from '../src/core/demand-rules.ts';

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
  // 兼容模式会话的 TOUR_DB 最小面（requireCoach 才用；本文件主体直接调引擎函数）
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

/** 俱乐部 + 认证侧账号/球队/绑定（通知落 web 行需要绑定；queueClubNotification 不绑就静默 0 条） */
function seedClub(fx: Fixture, clubId: number): void {
  fx.sqlite
    .prepare(`INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (?, ?, 'premier', 'active', 0)`)
    .run(clubId, `俱乐部${clubId}`);
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
  signedAt?: string | null;
}

function addContract(fx: Fixture, playerId: number, clubId: number, over: ContractSeed = {}): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from,
                              service_ticks, protection_ticks, is_active)
       VALUES (?, ?, ?, ?, ?, 'import', ?, '2026-01-01', ?, ?, 1)`,
    )
    .run(
      playerId,
      clubId,
      over.rc ?? 20,
      over.wage ?? 2.5,
      over.type ?? 'formal',
      over.signedAt === undefined ? OLD_SIGNED : over.signedAt,
      over.service ?? 4,
      over.protection === undefined ? 8 : over.protection,
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
    season?: number;
    windowSeq?: number;
  },
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      over.id,
      over.type ?? 'transfer',
      over.playerId,
      over.from,
      over.to,
      over.fee === undefined ? 10 : over.fee,
      over.status ?? 'pending_review',
      over.season ?? SEASON,
      over.windowSeq ?? WINDOW,
    );
}

interface PendingSeed {
  playerId: number;
  clubId: number;
  source: 'demand' | 'renewal' | 'rejection';
  wageNew: number;
  releaseFeeNew?: number | null;
  protectionNew?: number | null;
  demandId?: number | null;
  windowSeq?: number;
}

function addPending(fx: Fixture, over: PendingSeed): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contract_pending_changes
         (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new, rc_fee, status, effective_window_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)`,
    )
    .run(
      over.playerId,
      over.clubId,
      over.source,
      over.demandId ?? null,
      over.wageNew,
      over.releaseFeeNew ?? null,
      over.protectionNew ?? null,
      over.windowSeq ?? WINDOW,
    );
}

interface DemandSeed {
  id?: number;
  playerId: number;
  clubId: number;
  season?: number;
  windowSeq?: number;
  status?: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  voidReason?: string | null;
  wage?: number;
  rc?: number;
}

function addDemand(fx: Fixture, over: DemandSeed): number {
  const info = fx.sqlite
    .prepare(
      `INSERT INTO contract_demands
         (player_id, club_id, season, window_seq, status, current_wage, expected_wage, target_wage, floor_wage,
          raise_pct, rc_current, rc_floor, rc_fee, round, expires_at, seed, resolution, resolved_at, void_reason)
       VALUES (?, ?, ?, ?, ?, ?, 6.12, 3.7, 3.33, 0.48, ?, 25, 0, 0, '2027-01-01T00:00:00Z', 0, ?, ?, ?)`,
    )
    .run(
      over.playerId,
      over.clubId,
      over.season ?? SEASON,
      over.windowSeq ?? WINDOW,
      over.status ?? 'pending',
      over.wage ?? 2.5,
      over.rc ?? 20,
      over.resolution ?? null,
      over.resolvedAt ?? null,
      over.voidReason ?? null,
    );
  return Number(info.lastInsertRowid);
}

function openWindowRow(fx: Fixture, windowSeq = WINDOW): void {
  fx.sqlite
    .prepare(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (?, ?, 'open', 0, '2026-07-01T00:00:00Z')`)
    .run(SEASON, windowSeq);
}

const demandOf = (fx: Fixture, id: number): Record<string, unknown> =>
  sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_demands WHERE id = ?', id)!;
const pendingOf = (fx: Fixture, playerId: number): Record<string, unknown> =>
  sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE player_id = ? ORDER BY id DESC LIMIT 1', playerId)!;

/**
 * 可暂停的 D1 包装：**第一次** batch 调用先挂起（语句已在调用方构建完毕），由测试在放行前
 * 插入「并发第二批」与「其间状态变化」——用于复现 completeTransfer 的 TOCTOU 并发路径。
 * 后续 batch 直通（并发的第二张单要能正常提交）。
 */
function pausableDb(db: D1Database): { db: D1Database; reached: Promise<void>; release: () => void } {
  let releaseFn!: () => void;
  let reachedFn!: () => void;
  const released = new Promise<void>((r) => (releaseFn = r));
  const reached = new Promise<void>((r) => (reachedFn = r));
  let first = true;
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') {
        return async (...args: Parameters<D1Database['batch']>) => {
          if (first) {
            first = false;
            reachedFn();
            await released;
          }
          return target.batch(...args);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as D1Database;
  return { db: proxy, reached, release: releaseFn };
}

// ---------------------------------------------------------------------------
// §5.7 关窗批：统一 apply / void
// ---------------------------------------------------------------------------

describe('§5.7 关窗 apply 段（home.ts 并入关窗批）', () => {
  // 注意：本用例是**手工挂 pending 行**锁 apply 引擎的三来源形状兼容，不是普通续约端到端——
  // 真实 createRcChange → 谈判成约 → renewal pending 的写入链路由 tests/bypass-routes.test.ts 的
  // 「审核通过…成约只写待生效变更」用例锁（v6.54.0 收口审：原用例名让人误以为续约已迁移）。
  it('三来源 pending 走同一条 apply 路径（手工挂行）：apply 后写新 wage·RC·保护期，关窗前 contracts 一字不动', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    addPlayer(fx, 1, 1);
    addPlayer(fx, 2, 1);
    addPlayer(fx, 3, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8 });
    addContract(fx, 2, 1, { wage: 2, rc: 10, service: 4, protection: 7 });
    addContract(fx, 3, 1, { wage: 3, rc: 30, service: 4, protection: 9 });
    const demandId = addDemand(fx, { playerId: 1, clubId: 1, status: 'accepted', resolution: 'accepted', resolvedAt: '2026-10-20T00:00:00Z' });
    addPending(fx, { playerId: 1, clubId: 1, source: 'demand', wageNew: 3.7, releaseFeeNew: 25, demandId });
    // 普通续约：保护期按 4.4.6 收口到 baseTicks（此处 5 = 收口语义值），非 NULL
    addPending(fx, { playerId: 2, clubId: 1, source: 'renewal', wageNew: 2.4, releaseFeeNew: 12, protectionNew: 5 });
    // 直拒：只失效保护期（protection_ticks_new=0），价格两列保持现行
    addPending(fx, { playerId: 3, clubId: 1, source: 'rejection', wageNew: 3, releaseFeeNew: null, protectionNew: 0 });

    const { statements, summary } = await windowHomeStatements(fx.env, SEASON, WINDOW, { chargeNaming: false });
    // 关窗批提交前：contracts 保持旧值（§5.7 不变式）
    expect(contractOf(fx, 1)).toMatchObject({ wage: 2.5, release_fee: 20, protection_ticks: 8 });
    await fx.env.DB.batch(statements);

    expect(contractOf(fx, 1)).toMatchObject({ wage: 3.7, release_fee: 25, protection_ticks: 8, club_id: 1 });
    expect(contractOf(fx, 2)).toMatchObject({ wage: 2.4, release_fee: 12, protection_ticks: 5 });
    expect(contractOf(fx, 3)).toMatchObject({ wage: 3, release_fee: 30, protection_ticks: 0 });
    expect(pendingOf(fx, 1)).toMatchObject({ status: 'applied' });
    expect(pendingOf(fx, 1).applied_at).not.toBeNull();
    // demand 的「已生效」以 applied_at 表达（0048 的 status CHECK 没有 applied 态）
    expect(demandOf(fx, demandId)).toMatchObject({ status: 'accepted' });
    expect(demandOf(fx, demandId).applied_at).not.toBeNull();
    expect(summary.pendingApplied).toBe(3);
    expect(summary.pendingVoided).toBe(0);

    // 幂等：pending 已 applied，同一段重跑不再改合同（重跑期手改的 wage 保持不动）
    fx.sqlite.exec(`UPDATE contracts SET wage = 9 WHERE player_id = 1`);
    const again = await windowHomeStatements(fx.env, SEASON, WINDOW, { chargeNaming: false });
    await fx.env.DB.batch(again.statements);
    expect(contractOf(fx, 1).wage).toBe(9);
  });

  it('离队者的 pending 在关窗批作废（demand void + 徽章收口），不覆盖新东家合同', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 4, 2); // 球员已在新东家 2
    addContract(fx, 4, 2, { wage: 3, rc: 25 });
    const demandId = addDemand(fx, {
      playerId: 4,
      clubId: 1,
      status: 'accepted',
      resolution: 'accepted',
      resolvedAt: '2026-10-20T00:00:00Z',
      wage: 2.5,
      rc: 20,
    });
    addPending(fx, { playerId: 4, clubId: 1, source: 'demand', wageNew: 3.7, releaseFeeNew: 30, demandId });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (?, ?, ?, 'collapse', 'pending')`)
      .run(4, 1, demandId);

    const { statements, summary } = await windowHomeStatements(fx.env, SEASON, WINDOW, { chargeNaming: false });
    await fx.env.DB.batch(statements);

    expect(pendingOf(fx, 4)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    expect(demandOf(fx, demandId)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfer_requests WHERE player_id = 4')).toMatchObject({ status: 'resolved' });
    // 新东家合同一字不动（apply 只对仍在原队者执行）
    expect(contractOf(fx, 4)).toMatchObject({ club_id: 2, wage: 3, release_fee: 25 });
    expect(summary.pendingApplied).toBe(0);
    expect(summary.pendingVoided).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// completeTransfer：快照 / 买回三分支
// ---------------------------------------------------------------------------

describe('§5.4 回原队（TC-RD-43）', () => {
  it('普通换队：写快照三列，合同仍按窗刻度重锚（既有行为零变化）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, signedAt: OLD_SIGNED });
    addTransfer(fx, { id: 1, playerId: 1, from: 1, to: 2, fee: 10 });

    const out = await completeTransfer(fx.env, 1, null, 'user', undefined, {
      wage: 3,
      releaseFee: 25,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(out.status).toBe('completed');
    const row = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM transfers WHERE id = 1')!;
    expect(row).toMatchObject({ src_service_ticks: 4, src_protection_ticks: 8, src_signed_at: OLD_SIGNED });
    // 非买回：service_ticks 归 0（已关常规窗数）、保护期 = 0+3、signed_at = now
    const c = contractOf(fx, 1);
    expect(c).toMatchObject({ club_id: 2, wage: 3, release_fee: 25, service_ticks: 0, protection_ticks: 3 });
    expect(c.signed_at).not.toBe(OLD_SIGNED);
  });

  it('B 无纠葛买回：快照恢复效力/保护期、signed_at 新签、合同按谈判结果、占本窗额度且不计终局', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindowRow(fx);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, signedAt: OLD_SIGNED });
    // 先卖到 B（快照 4/8/旧签约时刻），再买回 A（B 合同被重锚成 0/3）
    addTransfer(fx, { id: 1, playerId: 1, from: 1, to: 2, fee: 10 });
    await completeTransfer(fx.env, 1, null, 'user', undefined, {
      wage: 3,
      releaseFee: 25,
      source: 'negotiation',
      contractType: 'formal',
    });
    const atB = contractOf(fx, 1);
    expect(atB).toMatchObject({ club_id: 2, service_ticks: 0, protection_ticks: 3 });

    addTransfer(fx, { id: 2, playerId: 1, from: 2, to: 1, fee: 12 });
    const out = await completeTransfer(fx.env, 2, null, 'user', undefined, {
      wage: 4,
      releaseFee: 30,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(out.status).toBe('completed');
    const back = contractOf(fx, 1);
    expect(back).toMatchObject({ club_id: 1, wage: 4, release_fee: 30, service_ticks: 4, protection_ticks: 8 });
    expect(back.signed_at).not.toBe(OLD_SIGNED); // B 谈成 = 真新签，覆盖快照签约时刻

    // 占本窗额度：void 占位行（不进段计数、不进收件箱）+ createRcChange 409
    const quota = sqlGet<Record<string, unknown>>(
      fx.sqlite,
      'SELECT * FROM contract_demands WHERE player_id = 1 AND club_id = 1 AND season = ? AND window_seq = ?',
      SEASON,
      WINDOW,
    )!;
    expect(quota).toMatchObject({ status: 'void', void_reason: 'return' });
    await expect(createRcChange(fx.env, 1, 1, 1, 25)).rejects.toThrow('本窗他的合同谈判机会已经用过');
    // 不计终局
    const finals = sqlAll<{ n: number }>(
      fx.sqlite,
      `SELECT COUNT(*) AS n FROM contract_demands WHERE player_id = 1 AND status IN ('rejected','expired')`,
    );
    expect(finals[0].n).toBe(0);
  });

  it('B 无纠葛买回的签约谈判按续约基准：E × U(1.05–1.15)，因子钉在 transfer 上不随重设 F 重摇', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 11, 2);
    addContract(fx, 11, 2, { wage: 3, rc: 20, service: 0, protection: 3 });
    // 离开 A 的记录（买回判据）+ 当前 B→A 的签约谈判会话
    fx.sqlite
      .prepare(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, completed_at) VALUES (1, 'transfer', 11, 1, 2, 10, 'completed', ?, ?, '2026-10-01T00:00:00Z')`)
      .run(SEASON, WINDOW);
    addTransfer(fx, { id: 2, playerId: 11, from: 2, to: 1, fee: 12, status: 'signing' });
    fx.sqlite
      .prepare(
        `INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, release_fee, expected_wage, attempt_count, status, created_at)
         VALUES (2, 11, 1, NULL, NULL, 0, 'active', '2026-10-20T00:00:00Z')`,
      )
      .run();

    const ctx = await loadNegotiationContext(fx.env.DB);
    const level = abilityLevel(80, 85, 24, ctx.youngBlendAge);
    const base = expectedWage(level, 22, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
    const [lo, hi] = ctx.renewalRaise;
    const raised = Math.round(base * (1 + lo + (hi - lo) * seededUnit([2], 22)) * 100) / 100;

    const out = await submitReleaseFee(fx.env, 2, 1, null, 22);
    expect(out.expectedWage).toBe(raised);
    expect(out.expectedWage).toBeGreaterThan(base); // 1.05–1.15 区间恒大于基准
    // 重设 F 重算：同一 transfer 的因子恒定（不会重摇出更低 E）
    const again = await submitReleaseFee(fx.env, 2, 1, null, 23);
    const base23 = expectedWage(level, 23, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
    expect(again.expectedWage).toBe(Math.round(base23 * (1 + lo + (hi - lo) * seededUnit([2], 22)) * 100) / 100);
  });

  it('A 分支经审核通过：跳过签约谈判直接过户（不创建 session）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 12, 2);
    addContract(fx, 12, 2, { wage: 3, rc: 25, service: 0, protection: 3 });
    // 离开 A 的已完成记录 + 本窗 A 的终局 demand（A 分支判据）
    fx.sqlite
      .prepare(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, completed_at) VALUES (1, 'transfer', 12, 1, 2, 10, 'completed', ?, ?, '2026-10-01T00:00:00Z')`)
      .run(SEASON, WINDOW);
    addDemand(fx, { playerId: 12, clubId: 1, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-15T00:00:00Z', wage: 3, rc: 25 });
    addTransfer(fx, { id: 3, playerId: 12, from: 2, to: 1, fee: 12 });
    fx.sqlite
      .prepare(`INSERT INTO review_tasks (id, type, ref_id, status) VALUES (9, 'transfer', 3, 'open')`)
      .run();

    const out = await approveTransferDeal(fx.env, 3, null, { taskId: 9, decidedBy: 1, decision: 'approved' });
    expect(out.status).toBe('completed');
    // 无签约谈判会话
    expect(sqlGet(fx.sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = 3')).toBeUndefined();
    expect(sqlGet<{ club_id: number }>(fx.sqlite, 'SELECT club_id FROM players WHERE id = 12')).toMatchObject({ club_id: 1 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM review_tasks WHERE id = 9')).toMatchObject({ status: 'approved' });
  });

  it('A 已闹 · direct：跳过谈判纯回归（现值带回）+ 徽章重挂 + 通告重发 + 保护期失效重挂', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, signedAt: OLD_SIGNED });
    // 本窗直拒终局（已终局），离队时徽章被 resolved —— 模拟 A 分支前提
    const demandId = addDemand(fx, {
      playerId: 1,
      clubId: 1,
      status: 'rejected',
      resolution: 'direct',
      resolvedAt: '2026-10-20T00:00:00Z',
      wage: 2.5,
      rc: 20,
    });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status, resolved_at) VALUES (?, ?, ?, 'direct', 'resolved', '2026-10-20T00:00:00Z')`)
      .run(1, 1, demandId);

    // 卖到 B：徽章收口、合同重锚
    addTransfer(fx, { id: 1, playerId: 1, from: 1, to: 2, fee: 10 });
    await completeTransfer(fx.env, 1, null, 'user', undefined, {
      wage: 3,
      releaseFee: 25,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfer_requests WHERE demand_id = ?', demandId)!.status).toBe('resolved');

    // 买回 A：不传 terms（= 跳过谈判纯回归）
    addTransfer(fx, { id: 2, playerId: 1, from: 2, to: 1, fee: 12 });
    const out = await completeTransfer(fx.env, 2, null, 'user');
    expect(out.status).toBe('completed');

    const back = contractOf(fx, 1);
    // 工资/RC 按合同行现值（别队期间涨幅有效），效力/保护期/签约时刻按快照恢复
    expect(back).toMatchObject({ club_id: 1, wage: 3, release_fee: 25, service_ticks: 4, protection_ticks: 8, signed_at: OLD_SIGNED });
    // 徽章重挂
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM transfer_requests WHERE demand_id = ?', demandId)).toMatchObject({
      status: 'released',
      resolved_at: null,
    });
    // 保护期失效重挂（关窗生效）：rejection pending，价格不动
    expect(pendingOf(fx, 1)).toMatchObject({
      source: 'rejection',
      protection_ticks_new: 0,
      release_fee_new: null,
      wage_new: 3,
      status: 'pending',
    });
    // 全联盟通告重发（进 notifications web 行）
    const notices = sqlAll<Record<string, unknown>>(fx.sqlite, `SELECT * FROM notifications WHERE template = 'demand_rejected_public'`);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.some((n) => Number(n.club_id) === 1)).toBe(true);
    // direct 终局不改写（不按「其他终局」计 expired）
    expect(demandOf(fx, demandId)).toMatchObject({ status: 'rejected', resolution: 'direct' });
  });

  it('并发重入：第二批的 A 分支回挂语句被 transfer 状态守卫挡住（不出幽灵徽章、不插第二条 pending）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8, signedAt: OLD_SIGNED });
    const demandId = addDemand(fx, {
      playerId: 1,
      clubId: 1,
      status: 'rejected',
      resolution: 'direct',
      resolvedAt: '2026-10-20T00:00:00Z',
    });
    // 卖到 B（第一批正常落库）→ 买回单 id=2 处于 pending_review
    addTransfer(fx, { id: 1, playerId: 1, from: 1, to: 2, fee: 10 });
    await completeTransfer(fx.env, 1, null, 'user', undefined, {
      wage: 3,
      releaseFee: 25,
      source: 'negotiation',
      contractType: 'formal',
    });
    addTransfer(fx, { id: 2, playerId: 1, from: 2, to: 1, fee: 12 });

    // 两张并发单都在提交前读到 pending_review：先让 A 构建完语句并挂起，再让 B 跑完整批
    const gate = pausableDb(fx.env.DB);
    const env2 = { ...fx.env, DB: gate.db } as Env;
    const first = completeTransfer(env2, 2, null, 'user');
    await gate.reached;
    const second = await completeTransfer(env2, 2, null, 'user');
    expect(second.status).toBe('completed');

    // 模拟「第一批的后果在放行前被别的流程收口」：徽章 resolved、rejection pending 已 apply
    fx.sqlite
      .prepare(`UPDATE transfer_requests SET status = 'resolved', resolved_at = '2026-10-24T00:00:00Z' WHERE demand_id = ?`)
      .run(demandId);
    fx.sqlite.prepare(`UPDATE contract_pending_changes SET status = 'applied' WHERE player_id = 1 AND source = 'rejection'`).run();

    gate.release();
    const firstOut = await first;
    // 第一批的状态 UPDATE 被守卫挡下（改 0 行）⇒ 整批按 already 处理
    expect(firstOut.status).toBe('already');
    // 徽章不得被翻回 released（幽灵「不满」）
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM transfer_requests WHERE demand_id = ?', demandId)).toMatchObject({
      status: 'resolved',
    });
    // 不得插出第二条 rejection pending（idx_pending_one_per_player 会一直占到下次关窗）
    expect(
      sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM contract_pending_changes WHERE player_id = 1`),
    ).toMatchObject({ n: 1 });
    expect(
      sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM contract_pending_changes WHERE player_id = 1 AND status = 'pending'`),
    ).toMatchObject({ n: 0 });
  });

  it('A 已闹 · 谈崩/过期：买回计一次 expired 入新段（resolved_at 锚到新 join，旧段不延续）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 1, 1);
    addContract(fx, 1, 1, { wage: 2.5, rc: 20, service: 4, protection: 8 });
    // 挂牌驱赶的过期（void_reason='listing' 平时不计终局）——买回这次折腾要计，void_reason 清空
    const demandId = addDemand(fx, {
      playerId: 1,
      clubId: 1,
      status: 'expired',
      resolution: 'expired',
      resolvedAt: '2026-10-01T00:00:00Z',
      voidReason: 'listing',
    });

    addTransfer(fx, { id: 1, playerId: 1, from: 1, to: 2, fee: 10 });
    await completeTransfer(fx.env, 1, null, 'user');
    addTransfer(fx, { id: 2, playerId: 1, from: 2, to: 1, fee: 12 });
    await completeTransfer(fx.env, 2, null, 'user');

    const demand = demandOf(fx, demandId);
    const transfer2 = sqlGet<{ completed_at: string }>(fx.sqlite, 'SELECT completed_at FROM transfers WHERE id = 2')!;
    expect(demand).toMatchObject({ status: 'expired', void_reason: null });
    expect(demand.resolved_at).toBe(transfer2.completed_at);
    // 用 core 的段口径复核：锚 = 本单 completed_at 时恰好计 1 条（>= 边界）
    const counted = segmentFinals(
      [{ kind: 'expired' as const, clubId: 1, at: Date.parse(String(demand.resolved_at)), byListing: false }],
      1,
      Date.parse(transfer2.completed_at),
    );
    expect(counted).toHaveLength(1);
    // 无在途 pending（谈崩/过期不写保护期失效）
    expect(sqlGet(fx.sqlite, 'SELECT id FROM contract_pending_changes WHERE player_id = 1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 离队作废链（TC-RD-45）与 amendment 不清计数
// ---------------------------------------------------------------------------

describe('离队作废链 / 段计数口径', () => {
  it('转会离队：demand → void、在途 pending → void、转会申请（含不满徽章）→ resolved', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    addPlayer(fx, 5, 1);
    addContract(fx, 5, 1, { wage: 2.5, rc: 20 });
    const demandId = addDemand(fx, { playerId: 5, clubId: 1, status: 'pending' });
    addPending(fx, { playerId: 5, clubId: 1, source: 'demand', wageNew: 3.7, releaseFeeNew: 25, demandId });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (?, ?, ?, 'direct', 'released')`)
      .run(5, 1, demandId);
    addTransfer(fx, { id: 3, playerId: 5, from: 1, to: 2, fee: 8 });

    await completeTransfer(fx.env, 3, null, 'user', undefined, {
      wage: 3,
      releaseFee: 22,
      source: 'negotiation',
      contractType: 'formal',
    });
    expect(demandOf(fx, demandId)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    expect(pendingOf(fx, 5)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfer_requests WHERE player_id = 5')).toMatchObject({ status: 'resolved' });
  });

  it('解约同样收口 pending 与徽章（TC-RD-45 #4）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    addPlayer(fx, 6, 1);
    addContract(fx, 6, 1, { wage: 2.5, rc: 20 });
    const demandId = addDemand(fx, { playerId: 6, clubId: 1, status: 'accepted', resolution: 'accepted', resolvedAt: '2026-10-20T00:00:00Z' });
    addPending(fx, { playerId: 6, clubId: 1, source: 'demand', wageNew: 3.7, releaseFeeNew: 25, demandId });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (?, ?, ?, 'collapse', 'pending')`)
      .run(6, 1, demandId);
    fx.sqlite
      .prepare(`INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, extra_fee, status, season, window_seq) VALUES (4, 'termination', 6, 1, NULL, 5, 'pending_review', ?, ?)`)
      .run(SEASON, WINDOW);

    await completeTermination(fx.env, 4, null, 'user');
    expect(demandOf(fx, demandId)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    expect(pendingOf(fx, 6)).toMatchObject({ status: 'void', void_reason: 'left_club' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfer_requests WHERE player_id = 6')).toMatchObject({ status: 'resolved' });
  });

  it('amendment 续约不算新段：旧终局仍计入 → 再拒绝直接升档三件套', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindowRow(fx);
    addPlayer(fx, 7, 1);
    addContract(fx, 7, 1, { wage: 2.5, rc: 20 });
    // 旧段终局（上一窗）
    addDemand(fx, { playerId: 7, clubId: 1, windowSeq: 0, status: 'expired', resolution: 'expired', resolvedAt: '2026-09-01T00:00:00Z' });
    // 续约（rc_change：from = to，不动归属）
    addTransfer(fx, { id: 5, type: 'rc_change', playerId: 7, from: 1, to: 1, fee: null });
    await completeTransfer(fx.env, 5, null, 'user', undefined, {
      wage: 3,
      releaseFee: 22,
      source: 'rc_change',
      contractType: 'formal',
    });
    // 普通续约改关窗生效（§5.7）：谈成只写 renewal pending，合同不变；这里模拟关窗批把它 apply，
    // 之后的「续约后合同值」才是新值（也顺带把在途 pending 清掉——rejectDemand 的 assertNoPendingChange
    // 不允许带着 pending 再走直拒，§11.2）。
    const applied = await applyPendingContractChanges(fx.env, WINDOW);
    await fx.env.DB.batch(applied.statements);
    expect(contractOf(fx, 7)).toMatchObject({ wage: 3, release_fee: 22 });
    // 续约改过合同 → 待处理 demand 按新合同值造（assertContractUnchanged 逐值比对）
    // 段内已有 1 次终局：再拒绝应升档（transfer_requests 直接 released）
    const demandId = addDemand(fx, { playerId: 7, clubId: 1, windowSeq: WINDOW, status: 'pending', wage: 3, rc: 22 });
    await rejectDemand(fx.env, { demandId, clubId: 1, actor: 1, origin: 'user' });

    const req = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM transfer_requests WHERE demand_id = ?', demandId);
    expect(req).toMatchObject({ status: 'released', source: 'direct' });
    expect(demandOf(fx, demandId)).toMatchObject({ status: 'rejected', resolution: 'direct' });
  });
});

// ---------------------------------------------------------------------------
// cron：runSettleTick 已挂 expireDemands
// ---------------------------------------------------------------------------

describe('cron 接入', () => {
  it('POST /api/cron/tick 带 demands 段且真的把到期要求置 expired', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    addPlayer(fx, 8, 1);
    const dueId = addDemand(fx, { playerId: 8, clubId: 1, status: 'pending' });
    fx.sqlite.prepare(`UPDATE contract_demands SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(dueId);

    const res = await app.request('/api/cron/tick', { method: 'POST', headers: { 'content-type': 'application/json' } }, fx.env);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; demands: { expired: number } };
    expect(out.ok).toBe(true);
    expect(out.demands.expired).toBe(1);
    expect(demandOf(fx, dueId)).toMatchObject({ status: 'expired', resolution: 'expired' });
  });

  it('expireDemands 单独调用幂等：已终局行不重复计数', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    addPlayer(fx, 9, 1);
    const dueId = addDemand(fx, { playerId: 9, clubId: 1, status: 'pending' });
    fx.sqlite.prepare(`UPDATE contract_demands SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(dueId);
    const first = await expireDemands(fx.env, '2026-10-26T00:00:00Z');
    const second = await expireDemands(fx.env, '2026-10-26T00:00:01Z');
    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
  });
});
