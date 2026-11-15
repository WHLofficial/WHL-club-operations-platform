// v6.87.0 批 1：players.status 写侧收编核心测试——转移矩阵 + 还原上下文 + resolveTarget 直测。
// 对应 docs/test-plans/v6.87.0-player-ops-state.md §3.1（TC-MX-01…07）/ §3.2（TC-CTX-01…03）/
// TC-GRD-01/02；批 2 补齐（评审修复轮）：§3.6 TC-ORD-02 语句位下标锁 + §3.4 TC-CMP-01/02
// compound 整行断言在本文件尾段。其余（TC-ORD-01/03/04、TC-CMP-03/04/05、TC-PRM、TC-SRC-03/04
// 与三处 bug 红测）仍归后续批 / 既有域文件，偏差登记见计划 §8「批 2 交付」条目。
//
// 矩阵口径：16 个构造器 cause（10 pure + 6 restore）× 5 状态 = 80 格；forced_auction_cancel 的
// listed 格跑双分支（club / free）各一次 ⇒ 81 次执行、21 合法格（与计划 §3.1 清单对账）、
// 60 次 no-op（计划按 80 格记 59，差 1 = 双分支多出的那次合法执行，记账口径见计划 §8）。
// 单故障原则：每格只有 status 是被测条件，club_id / 合同 / 挂牌 / 幂等键等守卫输入全部预摆成
// 能通过的形状（含 free/retired 格也种归属与合同——脏行形态，正是守卫要确定性处理的面）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, createTestD1, createTestDb, sqlGet } from './d1.ts';
import {
  PLAYER_PURE_CAUSES,
  PLAYER_RESTORE_CAUSES,
  PLAYER_TRANSITIONS,
  resolveTarget,
  type PlayerCauseMeta,
  type PlayerStatus,
  type PurePlayerCause,
  type RestorePlayerCause,
} from '../src/core/player-state.ts';
import {
  advance,
  advanceStatement,
  restoreAfterListing,
  restoreAfterNegotiation,
  type PlayerCauseParams,
} from '../src/worker/player-ops.ts';
import { advanceStatement as advanceListingStatement } from '../src/worker/listing-ops.ts';
// 批 2 补齐（TC-ORD-02 / TC-CMP-01/02）新增的真实入口与 env 构造件
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetOpsScheduleCache } from '../src/worker/ops-schedule.ts';
import { acceptOffer } from '../src/worker/offers.ts';
import { adminForceVoid } from '../src/worker/market-intervene.ts';
import { delistUnbid, voidExpiredActivation } from '../src/worker/market-settle.ts';
import { loadMarketContext } from '../src/worker/market-context.ts';
import { createActivation, submitMatch } from '../src/worker/activations.ts';
import { demotePlayer } from '../src/worker/promotion.ts';
import { cancelForcedAuction, createForcedAuction } from '../src/worker/bypass.ts';
import { voidSigningCore } from '../src/worker/negotiations.ts';
import {
  completeTermination,
  completeTransfer,
  rejectTransfer,
  type ContractTerms,
} from '../src/worker/transfers.ts';

const CLUB = 501;
const SENTINEL = '2020-01-01T00:00:00.000Z';
const STATUSES: PlayerStatus[] = ['normal', 'listed', 'trainee', 'free', 'retired'];

type ConstructorCause = PurePlayerCause | RestorePlayerCause;
const CONSTRUCTOR_CAUSES: ConstructorCause[] = [...PLAYER_PURE_CAUSES, ...PLAYER_RESTORE_CAUSES];
const RESTORE_CAUSE_SET: ReadonlySet<string> = new Set<string>(PLAYER_RESTORE_CAUSES);
const isRestoreCause = (cause: ConstructorCause): cause is RestorePlayerCause => RESTORE_CAUSE_SET.has(cause);

type Branch = 'club' | 'free';

// 硬编码合法格清单（独立期望源，不从 core 表生成——TC-MX-01/03 的对照面；21 格）
interface HardCell {
  cause: ConstructorCause;
  status: PlayerStatus;
  variant: Branch;
  target: PlayerStatus;
}
const HARDCODED_LEGAL: readonly HardCell[] = [
  { cause: 'market_list', status: 'normal', variant: 'club', target: 'listed' },
  { cause: 'offer_accepted_list', status: 'normal', variant: 'club', target: 'listed' },
  { cause: 'activation_list', status: 'normal', variant: 'club', target: 'listed' },
  { cause: 'activation_list', status: 'trainee', variant: 'club', target: 'listed' },
  { cause: 'forced_auction_list', status: 'free', variant: 'free', target: 'listed' },
  { cause: 'forced_auction_list', status: 'normal', variant: 'club', target: 'listed' },
  { cause: 'forced_auction_cancel', status: 'listed', variant: 'club', target: 'normal' },
  { cause: 'forced_auction_cancel', status: 'listed', variant: 'free', target: 'free' },
  { cause: 'demote', status: 'normal', variant: 'club', target: 'trainee' },
  { cause: 'promotion_complete', status: 'trainee', variant: 'club', target: 'normal' },
  { cause: 'match_terms', status: 'trainee', variant: 'club', target: 'normal' },
  { cause: 'transfer_terms', status: 'normal', variant: 'club', target: 'trainee' },
  { cause: 'transfer_terms', status: 'trainee', variant: 'club', target: 'normal' },
  { cause: 'import_sync', status: 'normal', variant: 'club', target: 'trainee' },
  { cause: 'import_sync', status: 'trainee', variant: 'club', target: 'normal' },
  { cause: 'listing_expire_unbid', status: 'listed', variant: 'club', target: 'normal' },
  { cause: 'activation_price_expired', status: 'listed', variant: 'club', target: 'normal' },
  { cause: 'admin_void_restore', status: 'listed', variant: 'club', target: 'normal' },
  { cause: 'negotiation_void_restore', status: 'listed', variant: 'club', target: 'normal' },
  { cause: 'review_reject_restore', status: 'listed', variant: 'club', target: 'normal' },
  { cause: 'activation_matched_kept', status: 'listed', variant: 'club', target: 'normal' },
];

// 矩阵格宇宙：cancel 的 listed 格双分支，其余每 (status, cause) 一格（forced_auction_list 的
// free 格天然走 null 分支）
function variantsFor(cause: ConstructorCause, status: PlayerStatus | 'sold'): Branch[] {
  if (cause === 'forced_auction_cancel') return status === 'listed' ? ['club', 'free'] : ['club'];
  if (cause === 'forced_auction_list') return status === 'free' ? ['free'] : ['club'];
  return ['club'];
}

function cellKey(cause: ConstructorCause, status: string, variant: Branch, target: string | null): string {
  return `${cause}|${status}|${variant}|${target ?? 'no-op'}`;
}

// demote 的 settledGuard（promotion.ts:202-206 现状形态：字面量拼接、字符串透传、无占位符）
function demoteGuard(pid: number): string {
  return `(SELECT status FROM players WHERE id = ${pid}) = 'normal' AND (SELECT club_id FROM players WHERE id = ${pid}) = ${CLUB} AND EXISTS (SELECT 1 FROM transfers WHERE idempotency_key = 'demote:${pid}:1:1')`;
}

// 各格 params（与 buildSpec 的 bind 语义一一对应；to 映射：normal 格谈 trainee 条款、trainee 格谈 formal）
function buildParams(cause: PurePlayerCause, pid: number, status: PlayerStatus | 'sold', variant: Branch): PlayerCauseParams<PurePlayerCause> {
  switch (cause) {
    case 'market_list':
      return { playerId: pid, clubId: CLUB };
    case 'offer_accepted_list':
      return { playerId: pid, sellerClubId: CLUB };
    case 'activation_list':
      return { playerId: pid, clubId: CLUB };
    case 'forced_auction_list':
      return variant === 'free' ? { playerId: pid, clubId: null } : { playerId: pid, clubId: CLUB };
    case 'forced_auction_cancel':
      return variant === 'free' ? { playerId: pid, sellerClubId: null } : { playerId: pid, sellerClubId: CLUB };
    case 'demote':
      return { playerId: pid, clubId: CLUB, settledGuard: demoteGuard(pid) };
    case 'promotion_complete':
      return { playerId: pid };
    case 'match_terms':
      return { playerId: pid };
    case 'transfer_terms':
      return { playerId: pid, clubId: CLUB, to: status === 'normal' ? 'trainee' : 'normal' };
    case 'import_sync':
      return status === 'trainee'
        ? { playerId: pid, to: 'normal', from: 'trainee' }
        : { playerId: pid, to: 'trainee', from: 'normal' };
    default:
      throw new Error(`矩阵不认的 cause：${String(cause)}`);
  }
}

interface CellSeed {
  clubId: number | null;
  contractType: 'formal' | 'trainee' | null;
  listing: 'delisted' | null;
  demoteTransfer: boolean;
}

interface CellPlan {
  cause: ConstructorCause;
  status: PlayerStatus | 'sold';
  variant: Branch;
  legal: boolean;
  target: PlayerStatus | null;
  seed: CellSeed;
  listingId: 'self' | null; // restore 调用第三参：'self' = 种子挂牌 id（= pid）；null = 透传
}

function buildPlan(cause: ConstructorCause, status: PlayerStatus | 'sold', variant: Branch): CellPlan {
  const hard = HARDCODED_LEGAL.find((h) => h.cause === cause && h.status === status && h.variant === variant);
  const restoreSeed = isRestoreCause(cause);
  const seed: CellSeed = restoreSeed
    ? {
        // 还原格固定上下文「有归属 + formal 合同」（计划 §3.1）——free/retired 格也种，单故障原则
        clubId: CLUB,
        contractType: 'formal',
        listing: cause === 'negotiation_void_restore' ? null : 'delisted',
        demoteTransfer: false,
      }
    : {
        clubId: variant === 'free' ? null : CLUB,
        contractType: null,
        listing: null,
        demoteTransfer: cause === 'demote',
      };
  return {
    cause,
    status,
    variant,
    legal: hard !== undefined,
    target: hard?.target ?? null,
    seed,
    listingId: restoreSeed && cause !== 'negotiation_void_restore' ? 'self' : null,
  };
}

function planMatrix(status: PlayerStatus | 'sold'): CellPlan[] {
  const plans: CellPlan[] = [];
  for (const cause of CONSTRUCTOR_CAUSES) {
    for (const variant of variantsFor(cause, status)) {
      plans.push(buildPlan(cause, status, variant));
    }
  }
  return plans;
}

function seedClub(sqlite: DatabaseSync): void {
  sqlite.exec(`INSERT OR IGNORE INTO clubs (id, name) VALUES (${CLUB}, '矩阵俱乐部')`);
}

function seedCell(sqlite: DatabaseSync, plan: CellPlan, pid: number): void {
  const clubSql = plan.seed.clubId === null ? 'NULL' : String(plan.seed.clubId);
  sqlite.exec(
    `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, updated_at) VALUES
       (${pid}, 'mx${pid}', '矩阵${pid}', ${clubSql}, 'CM', 24, 80, 85, '${plan.status}', '${SENTINEL}')`,
  );
  if (plan.seed.contractType !== null) {
    sqlite.exec(
      `INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from, service_ticks, protection_ticks) VALUES
         (${pid}, ${pid}, ${CLUB}, 10, 1, '${plan.seed.contractType}', 1, '2026-06-01T00:00:00Z', '2026-06-01', 0, 3)`,
    );
  }
  if (plan.seed.listing !== null) {
    sqlite.exec(
      `INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, season, window_seq) VALUES
         (${pid}, ${pid}, ${CLUB}, 'normal', 10, '${plan.seed.listing}', '${SENTINEL}', '2026-01-01', 1, 2)`,
    );
  }
  if (plan.seed.demoteTransfer) {
    sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, tax, extra_fee, status, season, window_seq, idempotency_key, evidence, created_at) VALUES
         ('demote', ${pid}, ${CLUB}, ${CLUB}, 0, 0, 0, 'completed', 1, 1, 'demote:${pid}:1:1', '{}', '${SENTINEL}')`,
    );
  }
}

async function runCell(
  db: D1Database,
  plan: CellPlan,
  pid: number,
): Promise<number> {
  if (isRestoreCause(plan.cause)) {
    const listingId = plan.listingId === 'self' ? pid : null;
    const result = await restoreAfterListing(db, pid, listingId).run();
    return result.meta.changes ?? 0;
  }
  return advance(db, pid, plan.cause, buildParams(plan.cause, pid, plan.status, plan.variant));
}

const rowOf = (sqlite: DatabaseSync, pid: number): Record<string, unknown> =>
  sqlGet<Record<string, unknown>>(sqlite, 'SELECT * FROM players WHERE id = ?', pid) ?? {};

// 夹具扩展（tests/d1.ts 的 createTestD1）暴露 SQL 原文，但该属性不在官方 D1PreparedStatement
// 类型上——用 `in` 收窄 + typeof 收窄取值，不引入 as/any（仓库铁律）
function sqlTextOf(stmt: D1PreparedStatement): string {
  const sql = 'sqlText' in stmt ? stmt.sqlText : undefined;
  if (typeof sql !== 'string') throw new Error('测试夹具缺 sqlText（createTestD1 应暴露 SQL 原文）');
  return sql;
}

// ---- TC-MX-03：表驱动期望与硬编码矩阵逐格一致 ----

function tableDerivedTargets(): Set<string> {
  const out = new Set<string>();
  for (const cause of CONSTRUCTOR_CAUSES) {
    for (const status of STATUSES) {
      for (const variant of variantsFor(cause, status)) {
        const meta: PlayerCauseMeta = PLAYER_TRANSITIONS[cause];
        if (meta.from === null) continue; // compound 无构造器、无 status 守卫，不进矩阵
        const branchFrom = meta.branchFrom ? meta.branchFrom[variant] : meta.from;
        if (!branchFrom.includes(status)) continue;
        let target: PlayerStatus | null = null;
        switch (meta.target.mode) {
          case 'static':
            target = meta.target.value;
            break;
          case 'restore': {
            // 矩阵还原格固定上下文「有归属 + formal 合同」；type guard 收窄后进 resolveTarget
            if (!isRestoreCause(cause)) break;
            target = resolveTarget(cause, { hasClub: true, contractType: 'formal' });
            break;
          }
          case 'club_branch':
            target = variant === 'free' ? 'free' : 'normal';
            break;
          case 'to_param':
            // 与 buildParams 的 to 映射同式：normal 格谈 trainee 条款、trainee 格谈 formal 条款
            target = status === 'normal' ? 'trainee' : 'normal';
            break;
          case 'transfer_complete':
          case 'terminate':
            target = null; // 不在构造器矩阵（由 TC-CMP-01/02 整行断言钉）
            break;
        }
        if (target !== null) out.add(cellKey(cause, status, variant, target));
      }
    }
  }
  return out;
}

describe('转移矩阵（TC-MX，16 构造器 cause × 5 状态）', () => {
  it('TC-MX-03 core 转移表驱动的合法格集合与硬编码矩阵逐格一致', () => {
    const fromTable = tableDerivedTargets();
    const fromHardcode = new Set(HARDCODED_LEGAL.map((h) => cellKey(h.cause, h.status, h.variant, h.target)));
    expect(fromTable.size).toBe(HARDCODED_LEGAL.length);
    expect([...fromHardcode].sort()).toEqual([...fromTable].sort());
  });

  it('TC-MX-01/02 逐格执行：21 合法格 changes=1 落目标态，其余整行不变且不抛', async () => {
    const { sqlite, db } = createTestDb();
    seedClub(sqlite);
    const universe = STATUSES.flatMap((status) => planMatrix(status));
    expect(universe).toHaveLength(81); // 80 格 + cancel listed 格的双分支多一次合法执行
    const legal = universe.filter((p) => p.legal);
    expect(legal).toHaveLength(21); // 与计划 §3.1 合法格清单对账

    // 各格独立（玩家 id / 挂牌 id / 幂等键都按 pid 作用域化），种子→快照→执行→断言单循环完成
    let pid = 100;
    for (const plan of universe) {
      const cellPid = pid++;
      seedCell(sqlite, plan, cellPid);
      const before = JSON.stringify(rowOf(sqlite, cellPid));
      const changes = await runCell(db, plan, cellPid);
      if (plan.legal) {
        expect(changes, `${plan.cause}×${plan.status}(${plan.variant}) 应命中`).toBe(1);
        const row = sqlGet<{ status: string; updated_at: string }>(sqlite, 'SELECT status, updated_at FROM players WHERE id = ?', cellPid);
        expect(row?.status, `${plan.cause}×${plan.status} 目标态`).toBe(plan.target);
        expect(row?.updated_at, `${plan.cause}×${plan.status} updated_at 应离开哨兵`).not.toBe(SENTINEL);
      } else {
        expect(changes, `${plan.cause}×${plan.status}(${plan.variant}) 应静默 no-op`).toBe(0);
        expect(JSON.stringify(rowOf(sqlite, cellPid)), `${plan.cause}×${plan.status} 整行不变`).toBe(before);
      }
    }
  });

  it('TC-MX-04 未知状态 sold × 16 cause：全部 changes=0 行不变（守卫是正向白名单）', async () => {
    const { sqlite, db } = createTestDb();
    seedClub(sqlite);
    const universe = planMatrix('sold'); // 单状态宇宙 = 每 cause 一格（cancel 在非 listed 只跑 club 分支）
    expect(universe).toHaveLength(16);
    let pid = 500;
    for (const plan of universe) {
      const cellPid = pid++;
      seedCell(sqlite, plan, cellPid);
      const before = JSON.stringify(rowOf(sqlite, cellPid));
      const changes = await runCell(db, plan, cellPid);
      expect(changes, `sold×${plan.cause} 应 no-op`).toBe(0);
      expect(JSON.stringify(rowOf(sqlite, cellPid)), `sold×${plan.cause} 整行不变`).toBe(before);
    }
  });

  it('TC-MX-05 不存在的 playerId × 16 cause：全部 0 且不抛', async () => {
    const { db } = createTestDb();
    const missing = 999999;
    for (const cause of CONSTRUCTOR_CAUSES) {
      const plan = buildPlan(cause, 'normal', 'club');
      const changes = await runCell(db, plan, missing);
      expect(changes, `不存在 playerId × ${cause} 应 no-op`).toBe(0);
    }
  });

  it('TC-MX-06 幂等重跑：19 格第二次 0；transfer_terms 两格两次都 1（同值重写）', async () => {
    const { sqlite, db } = createTestDb();
    seedClub(sqlite);
    const legalPlans = STATUSES.flatMap((status) => planMatrix(status)).filter((p) => p.legal);
    expect(legalPlans).toHaveLength(21);
    let pid = 700;
    for (const plan of legalPlans) {
      const cellPid = pid++;
      seedCell(sqlite, plan, cellPid);
      expect(await runCell(db, plan, cellPid), `${plan.cause}×${plan.status} 首跑`).toBe(1);
      const second = await runCell(db, plan, cellPid);
      if (plan.cause === 'transfer_terms') {
        // 不挂 gate、无同值排除：幂等靠入口 terms_applied 短路——同值重写必须仍是 1
        expect(second, 'transfer_terms 二跑应仍为 1').toBe(1);
        const row = sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', cellPid);
        expect(row?.status).toBe(plan.target);
      } else {
        expect(second, `${plan.cause}×${plan.status} 二跑应 no-op（status 已离开 from 集）`).toBe(0);
      }
    }
  });

  it('TC-MX-07 retired × 16 cause 全部 0（retired 不进任何构造器 cause 的 from 集）', async () => {
    const { sqlite, db } = createTestDb();
    seedClub(sqlite);
    const universe = planMatrix('retired');
    expect(universe).toHaveLength(16);
    let pid = 900;
    for (const plan of universe) {
      const cellPid = pid++;
      seedCell(sqlite, plan, cellPid);
      const before = JSON.stringify(rowOf(sqlite, cellPid));
      expect(await runCell(db, plan, cellPid), `retired×${plan.cause} 应 no-op`).toBe(0);
      expect(JSON.stringify(rowOf(sqlite, cellPid))).toBe(before);
    }
  });
});

describe('还原上下文（TC-CTX，restoreAfterListing 直测）', () => {
  interface CtxCombo {
    name: string;
    hasClub: boolean;
    contractType: 'formal' | 'trainee' | null;
    expected: PlayerStatus;
  }
  // 顺序即计划 TC-CTX-01 的预期序列：free/free/free/normal/trainee/normal
  const CTX_COMBOS: readonly CtxCombo[] = [
    { name: '无归属+无合同', hasClub: false, contractType: null, expected: 'free' },
    { name: '无归属+trainee 合同（club_id 优先于合同判定）', hasClub: false, contractType: 'trainee', expected: 'free' },
    { name: '无归属+formal 合同', hasClub: false, contractType: 'formal', expected: 'free' },
    { name: '有归属+无合同', hasClub: true, contractType: null, expected: 'normal' },
    { name: '有归属+trainee 合同（B1 修复面）', hasClub: true, contractType: 'trainee', expected: 'trainee' },
    { name: '有归属+formal 合同', hasClub: true, contractType: 'formal', expected: 'normal' },
  ];

  function seedCtxPlayer(sqlite: DatabaseSync, pid: number, combo: CtxCombo, listingStatus: 'delisted' | 'listed' | null): void {
    sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, updated_at) VALUES
         (${pid}, 'ctx${pid}', '上下文${pid}', ${combo.hasClub ? CLUB : 'NULL'}, 'CM', 24, 80, 85, 'listed', '${SENTINEL}')`,
    );
    if (combo.contractType !== null) {
      sqlite.exec(
        `INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from, service_ticks, protection_ticks) VALUES
           (${pid}, ${pid}, ${CLUB}, 10, 1, '${combo.contractType}', 1, '2026-06-01T00:00:00Z', '2026-06-01', 0, 3)`,
      );
    }
    if (listingStatus !== null) {
      sqlite.exec(
        `INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, season, window_seq) VALUES
           (${pid}, ${pid}, ${CLUB}, 'normal', 10, '${listingStatus}', '${SENTINEL}', '2026-01-01', 1, 2)`,
      );
    }
  }

  it('TC-CTX-01 六组合逐格：club_id 优先于合同判定，(有,trainee)→trainee 是 B1 修复面', async () => {
    const { sqlite, db } = createTestDb();
    seedClub(sqlite);
    let pid = 1100;
    for (const combo of CTX_COMBOS) {
      seedCtxPlayer(sqlite, pid, combo, 'delisted');
      const result = await restoreAfterListing(db, pid, pid).run();
      expect(result.meta.changes ?? 0, combo.name).toBe(1);
      const row = sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', pid);
      expect(row?.status, combo.name).toBe(combo.expected);
      // 语义真源交叉锁：resolveTarget 纯函数与 SQL CASE 同判据（TC-GRD-02 的行为面互证）
      for (const cause of PLAYER_RESTORE_CAUSES) {
        expect(resolveTarget(cause, { hasClub: combo.hasClub, contractType: combo.contractType }), `${cause} × ${combo.name}`).toBe(combo.expected);
      }
      pid += 1;
    }
  });

  it('TC-CTX-02 EXISTS 守卫三态：同批 delisted 命中 / 无 delisted 不还原防幻影 / null 透传照还原', async () => {
    const { sqlite, db } = createTestDb();
    seedClub(sqlite);
    const combo = CTX_COMBOS[5]; // 有归属 + formal → normal

    // ① 同批：listings 侧 admin_cancel 先落 delisted，还原句在同批读到（D1 batch 串行可见）
    const pidA = 1201;
    seedCtxPlayer(sqlite, pidA, combo, 'listed');
    const batchResults = await db.batch([
      advanceListingStatement(db, pidA, 'admin_cancel', { reason: 'ctx02 同批依赖链' }),
      restoreAfterListing(db, pidA, pidA),
    ]);
    expect(batchResults[0]?.meta.changes ?? 0).toBe(1);
    expect(batchResults[1]?.meta.changes ?? 0).toBe(1);
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM listings WHERE id = ?', pidA)?.status).toBe('delisted');
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', pidA)?.status).toBe('normal');

    // ② 挂牌未 delisted（仍 listed）→ 还原 0 行，球员卡在 listed（防幻影还原，delistUnbid P1-1 同款）
    const pidB = 1202;
    seedCtxPlayer(sqlite, pidB, combo, 'listed');
    expect((await restoreAfterListing(db, pidB, pidB).run()).meta.changes ?? 0).toBe(0);
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', pidB)?.status).toBe('listed');
    // ②′ 挂牌 id 不存在 → 同样 0 行
    const pidB2 = 1203;
    seedCtxPlayer(sqlite, pidB2, combo, null);
    expect((await restoreAfterListing(db, pidB2, 987654).run()).meta.changes ?? 0).toBe(0);
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', pidB2)?.status).toBe('listed');

    // ③ listingId=null 透传：无守卫照还原（match 单 / 无挂牌单据不被恒假 EXISTS 吞掉）
    const pidC = 1204;
    seedCtxPlayer(sqlite, pidC, combo, null);
    expect((await restoreAfterListing(db, pidC, null).run()).meta.changes ?? 0).toBe(1);
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', pidC)?.status).toBe('normal');
  });

  it('TC-CTX-03 文本级锁：六还原写点同源，null 形态 = 守卫形态剥掉 EXISTS 行，restoreAfterNegotiation 等价', () => {
    const { db } = createTestDb();
    const withGuard = sqlTextOf(restoreAfterListing(db, 1, 7));
    expect(withGuard).toBe(sqlTextOf(restoreAfterListing(db, 2, 99))); // 同形态全等（写点共用同一构造）
    const noGuard = sqlTextOf(restoreAfterListing(db, 1, null));
    expect(noGuard).toBe(sqlTextOf(restoreAfterNegotiation(db, 1))); // null 形态与 negotiation 版全等
    const guardClause = `\n         AND EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')`;
    expect(withGuard).toContain(guardClause);
    expect(noGuard).not.toContain('EXISTS');
    expect(noGuard).toBe(withGuard.replace(guardClause, '')); // 剥掉 EXISTS 行逐字相同
    // 母本 CASE 三分支逐字在场（club_id 优先 + trainee 分支 + ELSE normal）与占位符计数
    expect(withGuard).toContain("CASE\n   WHEN club_id IS NULL THEN 'free'");
    expect(withGuard).toContain("= 'trainee' THEN 'trainee'\n   ELSE 'normal' END");
    expect(withGuard.split('?').length - 1).toBe(3); // (playerId, playerId, listingId)
    expect(noGuard.split('?').length - 1).toBe(2); // (playerId, playerId)
  });
});

describe('构造器形态与 resolveTarget（TC-GRD）', () => {
  it('TC-GRD-01 纯构造器：守卫片段在场、占位符数与 bind 数一致、双分支形态各自正确', () => {
    const { db } = createTestDb();
    const pid = 1;
    const placeholders = (sql: string) => sql.split('?').length - 1;

    const marketList = sqlTextOf(advanceStatement(db, pid, 'market_list', { playerId: pid, clubId: CLUB }));
    const offerList = sqlTextOf(advanceStatement(db, pid, 'offer_accepted_list', { playerId: pid, sellerClubId: CLUB }));
    const activationList = sqlTextOf(advanceStatement(db, pid, 'activation_list', { playerId: pid, clubId: CLUB }));
    const forcedListClub = sqlTextOf(advanceStatement(db, pid, 'forced_auction_list', { playerId: pid, clubId: CLUB }));
    const forcedListFree = sqlTextOf(advanceStatement(db, pid, 'forced_auction_list', { playerId: pid, clubId: null }));
    const forcedCancelClub = sqlTextOf(advanceStatement(db, pid, 'forced_auction_cancel', { playerId: pid, sellerClubId: CLUB }));
    const forcedCancelFree = sqlTextOf(advanceStatement(db, pid, 'forced_auction_cancel', { playerId: pid, sellerClubId: null }));
    const guard = demoteGuard(pid);
    const demoteSql = sqlTextOf(advanceStatement(db, pid, 'demote', { playerId: pid, clubId: CLUB, settledGuard: guard }));
    const promotionSql = sqlTextOf(advanceStatement(db, pid, 'promotion_complete', { playerId: pid }));
    const matchSql = sqlTextOf(advanceStatement(db, pid, 'match_terms', { playerId: pid }));
    const termsSql = sqlTextOf(advanceStatement(db, pid, 'transfer_terms', { playerId: pid, clubId: CLUB, to: 'trainee' }));
    const syncSql = sqlTextOf(advanceStatement(db, pid, 'import_sync', { playerId: pid, to: 'trainee', from: 'normal' }));

    expect(marketList).toContain("AND club_id = ? AND status = 'normal'");
    expect(offerList).toContain("AND club_id = ? AND status = 'normal' AND not_for_sale = 0");
    expect(activationList).toContain("AND club_id = ? AND status IN ('normal', 'trainee')");
    expect(forcedListClub).toContain("AND club_id = ? AND status = 'normal'");
    expect(forcedListFree).toContain("AND club_id IS NULL AND status = 'free'");
    expect(forcedCancelClub).toContain("SET status = 'normal'");
    expect(forcedCancelFree).toContain("SET status = 'free'");
    expect(demoteSql).toContain(guard); // settledGuard 字符串透传，构造器不重写
    expect(promotionSql).toContain("AND status = 'trainee'");
    expect(matchSql).toBe(promotionSql); // match_terms 与 promotion_complete 逐字同 SQL（transfers.ts 两处原文同）
    expect(termsSql).toContain("AND club_id = ? AND status IN ('normal', 'trainee')");
    expect(syncSql).toContain('WHERE id = ? AND status = ?');

    // 占位符数 = bind 数（参数错位 D1 不报错只静默写错——矩阵列值断言之外的第二道防线）
    expect(placeholders(marketList)).toBe(2);
    expect(placeholders(offerList)).toBe(2);
    expect(placeholders(activationList)).toBe(2);
    expect(placeholders(forcedListClub)).toBe(2);
    expect(placeholders(forcedListFree)).toBe(1);
    expect(placeholders(forcedCancelClub)).toBe(2);
    expect(placeholders(forcedCancelFree)).toBe(1);
    expect(placeholders(demoteSql)).toBe(2);
    expect(placeholders(promotionSql)).toBe(1);
    expect(placeholders(termsSql)).toBe(3);
    expect(placeholders(syncSql)).toBe(3);
  });

  it('TC-GRD-02 resolveTarget 直测：terminate 恒 free、transfer_complete 四式、还原六组合同判据', () => {
    expect(resolveTarget('terminate')).toBe('free');
    expect(resolveTarget('transfer_complete', { dealTermsContractType: 'trainee', currentContractType: 'formal' })).toBe('trainee');
    expect(resolveTarget('transfer_complete', { dealTermsContractType: 'formal', currentContractType: 'trainee' })).toBe('normal');
    expect(resolveTarget('transfer_complete', { currentContractType: 'trainee' })).toBe('trainee');
    expect(resolveTarget('transfer_complete', {})).toBe('normal');
    expect(resolveTarget('transfer_complete', { currentContractType: null })).toBe('normal');
    for (const cause of PLAYER_RESTORE_CAUSES) {
      expect(resolveTarget(cause, { hasClub: false, contractType: null })).toBe('free');
      expect(resolveTarget(cause, { hasClub: false, contractType: 'trainee' })).toBe('free');
      expect(resolveTarget(cause, { hasClub: true, contractType: null })).toBe('normal');
      expect(resolveTarget(cause, { hasClub: true, contractType: 'trainee' })).toBe('trainee');
      expect(resolveTarget(cause, { hasClub: true, contractType: 'formal' })).toBe('normal');
    }
  });
});

// ===========================================================================
// 批 2 补齐（v6.87.0 评审修复轮）：TC-ORD-02 十二站点语句位下标锁 + TC-CMP-01/02
// compound 整行断言（计划 §3.6 / §3.4 承诺、批 1 未交付的两面）。
// 手法 = Proxy 包 env.DB 记录 db.batch 的批内 sqlText——消费 tests/d1.ts:49-52 夹具暴露的
// sqlText，先例 = tests/listing-state.test.ts TC-ORD-04 的真实入口批内下标锁。防的是计划
// §7 头号风险「语句位平移」：activations.ts:301 读 results[2]、offers.ts:536 读 results[1]、
// bypass.ts:781 与 activations.ts:166 读 results[0]/[1] 都是下标硬耦合，advanceStatement
// 内部多包一条语句或调用方挪动批内位置即误判。其余 TC 归后续批（计划 §8 偏差登记）。
// ===========================================================================

/** 批内 players 语句的判别片段（构造器 SQL 的独有子串；文本本身由 TC-GRD-01 锁死） */
const LISTED_FRAGMENT = "UPDATE players SET status = 'listed'";
const RESTORE_CASE_FRAGMENT = "WHEN club_id IS NULL THEN 'free'";
const DEMOTE_FRAGMENT = "UPDATE players SET status = 'trainee'";
const NORMAL_FRAGMENT = "UPDATE players SET status = 'normal'";
const T0 = '2026-07-01T00:00:00.000Z';

interface OpsFixture {
  env: Env;
  sqlite: DatabaseSync;
}

// env 形状照抄 house 夹具（promotion.test.ts / market-routes.test.ts 同款）：
// 本地 SQLite 跑真迁移 + 内存 TOUR_DB 只放 user 表 + KV 会话表
function freshOpsEnv(): OpsFixture {
  resetConfigCache();
  resetOpsScheduleCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0), (5, '教练戊', 'coach', 0, 0);`,
  );
  const kv = new Map<string, string>();
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [5, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
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
  return { env, sqlite };
}

// TC-ORD 站点共用世界线：club 1（卖方，教练 tok-coach=uid2 绑定）/ club 2（买方，tok-coach2=uid5）
// / club 3（守卫格备用）；窗 1 已关、窗 2 开 ⇒ closedRegularTicks=1，激活的「效力为 0 不可激活」
// 校验（activations.ts:100）可过；球员 10 = 在册正式合同（RC 20 / 身价 30），球员 11 = 训练营。
function seedOrdWorld(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES
      (1, '下标锁卖方', 'premier', 'active'), (2, '下标锁买方', 'premier', 'active'), (3, '下标锁第三队', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES
      (1, 1, 'closed', 0, '2026-05-01T00:00:00Z'), (1, 2, 'open', 0, '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, growable, status, updated_at) VALUES
      (10, 'ord10', '下标甲', 1, 'ST', 26, 80, 85, 30, 1, 'normal', '${SENTINEL}'),
      (11, 'ord11', '下标乙', 1, 'ST', 18, 62, 80, NULL, 1, 'trainee', '${SENTINEL}');
    INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from, service_ticks, protection_ticks) VALUES
      (10, 10, 1, 20, 2, 'formal', 1, '2026-06-01T00:00:00Z', '2026-06-01', 2, 1),
      (11, 11, 1, 5, 0.75, 'trainee', 1, '2026-06-01T00:00:00Z', '2026-06-01', 0, NULL);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 200, '${T0}'), (2, 200, '${T0}');
    INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
      (1, 'opening_import', 200, 200, '期初', '${T0}'),
      (2, 'opening_import', 200, 200, '期初', '${T0}');
  `);
}

function seedOrdListing(
  sqlite: DatabaseSync,
  over: { id: number; playerId: number; sellerClubId: number | null; type: string; status: string; askPrice?: number; activatedBy?: number; activationDeadline?: string },
): void {
  sqlite
    .prepare(
      `INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, activated_by, activation_deadline, season, window_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 2)`,
    )
    .run(
      over.id,
      over.playerId,
      over.sellerClubId,
      over.type,
      over.askPrice ?? 10,
      over.status,
      T0,
      '2026-07-01',
      over.activatedBy ?? null,
      over.activationDeadline ?? null,
    );
}

// Proxy 包 db：只在 batch 上加记录（批内 sqlText 数组按批累积），其余属性原样透传。
// Proxy 保持目标对象类型，不需要 as 断言（仓库铁律）。
function traceBatches(db: D1Database): { db: D1Database; batches: string[][] } {
  const batches: string[][] = [];
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          batches.push(statements.map((stmt) => sqlTextOf(stmt)));
          return target.batch(statements);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { db: wrapped, batches };
}

// 找到含目标片段的批（应恰一个），断言该批内 players 语句恰一条且下标不变
function assertPlayerStmtIndex(batches: string[][], fragment: string, expectedIndex: number, label: string): void {
  const hostBatches = batches.filter((batch) => batch.some((sql) => sql.includes(fragment)));
  expect(hostBatches, `${label}：含「${fragment}」语句的批应恰有一个`).toHaveLength(1);
  const indexes = hostBatches[0]
    .map((sql, i) => (sql.includes(fragment) ? i : -1))
    .filter((i) => i >= 0);
  expect(indexes, `${label}：批内 players 语句恰一条`).toHaveLength(1);
  expect(indexes[0], `${label}：players 语句批内下标`).toBe(expectedIndex);
}

const playerStatusOf = (sqlite: DatabaseSync, id: number): string | undefined =>
  sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = ?', id)?.status;

describe('语句位与批序锁（TC-ORD-02，§3.6 批 2 补齐：12 个批内语句位点）', () => {
  it('① market 挂牌路由：players listed 化在批下标 [1]（INSERT listings 之后、audit/demand 之前）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    const trace = traceBatches(fx.env.DB);
    const res = await app.request(
      '/api/market/listings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-coach' },
        body: JSON.stringify({ playerId: 10, askPrice: 15 }),
      },
      { ...fx.env, DB: trace.db },
    );
    expect(res.status).toBe(201);
    assertPlayerStmtIndex(trace.batches, LISTED_FRAGMENT, 1, 'market 挂牌');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('listed');
  });

  it('② offers 履约批：players listed 化在 [1]（[0] 条件 INSERT 之后；results[1] 判成的下标耦合）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    // 先落 offers 再落 fund_holds——fund_holds_offer_guard 校验报价仍 pending（expiry-ops 同款顺序）
    fx.sqlite.exec(`
      INSERT INTO offers (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, note, status, turn, hold_id, listing_id, season, window_seq, created_at, updated_at, resolved_at, expiry_anchor_at, reminded_at)
        VALUES (1, 10, 2, 1, 15, 15, 1, '', 'pending', 'seller', 1, NULL, 1, 2, '${T0}', '${T0}', NULL, '', '');
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
        VALUES (1, 2, 15, 'held', 'offer', 1, '${T0}');
    `);
    const trace = traceBatches(fx.env.DB);
    const out = await acceptOffer({ ...fx.env, DB: trace.db }, { offerId: 1, clubId: 1, actor: 2 });
    expect(out.ok).toBe(true);
    expect(out.listingId).toBeGreaterThan(0); // results[1] 判成 + last_row_id 链路在工作
    assertPlayerStmtIndex(trace.batches, LISTED_FRAGMENT, 1, 'offer 履约');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('listed');
  });

  it('③ createActivation：players 在 [0]（批首；results[0]/[1] 判 409 的下标耦合）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    const trace = traceBatches(fx.env.DB);
    const out = await createActivation({ ...fx.env, DB: trace.db }, 2, 5, 11, 'activation/2/ord02-proof.png');
    expect(out.ok).toBe(true);
    assertPlayerStmtIndex(trace.batches, LISTED_FRAGMENT, 0, '激活挂牌');
    expect(playerStatusOf(fx.sqlite, 11)).toBe('listed');
  });

  it('④ createForcedAuction markListed：players 在 [0]（批首；results[0]/[1] 判 409 的下标耦合）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    const trace = traceBatches(fx.env.DB);
    const out = await createForcedAuction({ ...fx.env, DB: trace.db }, 1, 10, 1);
    expect(out.ok).toBe(true);
    assertPlayerStmtIndex(trace.batches, LISTED_FRAGMENT, 0, '强制拍卖挂牌');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('listed');
  });

  it('⑤ cancelForcedAuction：players 还原在 [1]（listings forced_cancel 之后）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    seedOrdListing(fx.sqlite, { id: 20, playerId: 10, sellerClubId: 1, type: 'forced', status: 'listed', askPrice: 1 });
    fx.sqlite.exec(`UPDATE players SET status = 'listed' WHERE id = 10`);
    const trace = traceBatches(fx.env.DB);
    const out = await cancelForcedAuction({ ...fx.env, DB: trace.db }, 1, 20);
    expect(out.ok).toBe(true);
    assertPlayerStmtIndex(trace.batches, NORMAL_FRAGMENT, 1, '强拍取消还原');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('normal');
  });

  it('⑥ delistUnbid：players 还原在 [1]（unbid_expired 之后，EXISTS 读同批先行语句）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    seedOrdListing(fx.sqlite, { id: 21, playerId: 10, sellerClubId: 1, type: 'normal', status: 'listed', askPrice: 10 });
    fx.sqlite.exec(`
      UPDATE players SET status = 'listed' WHERE id = 10;
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
        VALUES (30, 2, 10, 'held', 'listing', 21, '${T0}');
    `);
    const trace = traceBatches(fx.env.DB);
    const ctx = await loadMarketContext(trace.db);
    const out = await delistUnbid(
      { ...fx.env, DB: trace.db },
      { id: 21, player_id: 10, seller_club_id: 1, type: 'normal', ask_price: 10, season: 1, window_seq: 2 },
      ctx,
      null,
      'cron_tick',
    );
    expect(out).toBe('delisted');
    assertPlayerStmtIndex(trace.batches, RESTORE_CASE_FRAGMENT, 1, 'delistUnbid 还原');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('normal');
  });

  it('⑦ voidExpiredActivation：players 还原在 [1]（listings 语句之后）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    seedOrdListing(fx.sqlite, {
      id: 22,
      playerId: 11,
      sellerClubId: 1,
      type: 'activation',
      status: 'listed',
      askPrice: 5,
      activatedBy: 2,
      activationDeadline: '2000-01-01T00:00:00.000Z',
    });
    fx.sqlite.exec(`UPDATE players SET status = 'listed' WHERE id = 11`);
    const trace = traceBatches(fx.env.DB);
    const out = await voidExpiredActivation(trace.db, 22, 11, null, 'cron_tick');
    expect(out).toBe(true);
    assertPlayerStmtIndex(trace.batches, RESTORE_CASE_FRAGMENT, 1, '激活过期还原');
    expect(playerStatusOf(fx.sqlite, 11)).toBe('trainee'); // trainee 合同按 CASE 还原 trainee
  });

  it('⑧ demotePlayer：players 在 [5]/共 6（settledGuard 同批依赖链尾）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    const trace = traceBatches(fx.env.DB);
    const out = await demotePlayer({ ...fx.env, DB: trace.db }, 1, 2, 10);
    expect(out.ok).toBe(true);
    assertPlayerStmtIndex(trace.batches, DEMOTE_FRAGMENT, 5, '下放');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('trainee');
  });

  it('⑨ submitMatch：players 还原在 [5]/共 6（results[2] 判 409 的下标耦合）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    seedOrdListing(fx.sqlite, {
      id: 23,
      playerId: 11,
      sellerClubId: 1,
      type: 'activation',
      status: 'matched_pending',
      askPrice: 5,
      activatedBy: 2,
    });
    fx.sqlite.exec(`
      UPDATE players SET status = 'listed' WHERE id = 11;
      INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES (1, 23, 2, 5, '${T0}', 'active');
    `);
    const trace = traceBatches(fx.env.DB);
    const out = await submitMatch({ ...fx.env, DB: trace.db }, 1, 2, 23, 10);
    expect(out.ok).toBe(true);
    expect(out.decision).toBe('match');
    assertPlayerStmtIndex(trace.batches, RESTORE_CASE_FRAGMENT, 5, '匹配留人还原');
    expect(playerStatusOf(fx.sqlite, 11)).toBe('trainee'); // B1 修复面在真实批内的落点
  });

  it('⑩ adminForceVoid：players 还原在 [3]/共 5（admin_cancel 之后）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    seedOrdListing(fx.sqlite, { id: 24, playerId: 10, sellerClubId: 1, type: 'normal', status: 'listed', askPrice: 10 });
    fx.sqlite.exec(`
      UPDATE players SET status = 'listed' WHERE id = 10;
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
        VALUES (31, 2, 10, 'held', 'listing', 24, '${T0}');
    `);
    const trace = traceBatches(fx.env.DB);
    const out = await adminForceVoid({ ...fx.env, DB: trace.db }, 24, 1, '下标锁');
    expect(out).toBe('done');
    assertPlayerStmtIndex(trace.batches, RESTORE_CASE_FRAGMENT, 3, '强制作废还原');
    expect(playerStatusOf(fx.sqlite, 10)).toBe('normal');
  });

  it('⑪ voidSigningCore：players 还原在 [4]/共 7（negotiation_closed 之后）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    // 冻结与出价要在挂牌 listed 时落（fund_holds_bid_guard 只认 listed/bidding），再翻进 pending_review
    seedOrdListing(fx.sqlite, { id: 25, playerId: 43, sellerClubId: 1, type: 'normal', status: 'listed', askPrice: 40 });
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, updated_at) VALUES
        (43, 'ord43', '签约中', 2, 'GK', 24, 70, 80, 'listed', '${SENTINEL}');
      INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from, service_ticks, protection_ticks) VALUES
        (43, 43, 2, 40, 2, 'formal', 1, '2026-06-01T00:00:00Z', '2026-06-01', 1, NULL);
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
        VALUES (32, 2, 40, 'held', 'listing', 25, '${T0}');
      INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES (2, 25, 2, 40, '${T0}', 'active');
      UPDATE listings SET status = 'pending_review' WHERE id = 25;
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, evidence, created_at) VALUES
        (26, 'transfer', 43, 1, 2, 40, 'signing', 1, 2, 'listing:25', '{}', '${T0}');
      INSERT INTO negotiation_sessions (id, transfer_id, player_id, club_id, release_fee, expected_wage, attempt_count, status, created_at, expiry_anchor_at, reminded_at)
        VALUES (30, 26, 43, 2, 40, 3, 0, 'active', '${T0}', '${T0}', '');
    `);
    const trace = traceBatches(fx.env.DB);
    const out = await voidSigningCore({ ...fx.env, DB: trace.db }, 30, {
      actor: 1,
      origin: 'user',
      action: 'admin_negotiation_void',
      deadlineNote: '下标锁',
      reason: '下标锁',
    });
    expect(out).toBe('done');
    assertPlayerStmtIndex(trace.batches, RESTORE_CASE_FRAGMENT, 4, '签约作废还原');
    expect(playerStatusOf(fx.sqlite, 43)).toBe('normal');
  });

  it('⑫ rejectTransfer：players 还原在 [4]（review_rejected 之后、transfers UPDATE 之前）', async () => {
    const fx = freshOpsEnv();
    seedOrdWorld(fx.sqlite);
    // 冻结与出价要在挂牌 listed 时落（fund_holds_bid_guard 只认 listed/bidding），再翻进 pending_review
    seedOrdListing(fx.sqlite, { id: 26, playerId: 44, sellerClubId: 1, type: 'normal', status: 'listed', askPrice: 40 });
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, updated_at) VALUES
        (44, 'ord44', '待审中', 1, 'ST', 24, 75, 82, 'listed', '${SENTINEL}');
      INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from, service_ticks, protection_ticks) VALUES
        (44, 44, 1, 40, 2, 'formal', 1, '2026-06-01T00:00:00Z', '2026-06-01', 1, NULL);
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
        VALUES (33, 2, 40, 'held', 'listing', 26, '${T0}');
      INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES (3, 26, 2, 40, '${T0}', 'active');
      UPDATE listings SET status = 'pending_review' WHERE id = 26;
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, evidence, created_at) VALUES
        (27, 'transfer', 44, 1, 2, 40, 'pending_review', 1, 2, 'listing:26', '{}', '${T0}');
      INSERT INTO review_tasks (id, type, ref_id, payload, status) VALUES (1, 'transfer_confirm', 27, '{}', 'open');
    `);
    const trace = traceBatches(fx.env.DB);
    const out = await rejectTransfer({ ...fx.env, DB: trace.db }, 27, 1, 'user', {
      taskId: 1,
      decidedBy: 1,
      decision: 'rejected',
      note: '下标锁',
    });
    expect(out.status).toBe('rejected');
    assertPlayerStmtIndex(trace.batches, RESTORE_CASE_FRAGMENT, 4, '审核驳回还原');
    expect(playerStatusOf(fx.sqlite, 44)).toBe('normal');
  });
});

describe('compound 写点整行断言（TC-CMP-01/02，§3.4 批 2 补齐）', () => {
  // compound 环境不需要会话：直接调 completeTransfer / completeTermination 服务函数
  //（growth-tier-routes.test.ts §10.3 触发点同款直调先例）
  function freshCmpEnv(): OpsFixture {
    resetConfigCache();
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const tour = new DatabaseSync(':memory:');
    tour.exec(
      `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
       INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组', 'admin', 0, 0);`,
    );
    const env: Env = {
      DB: createTestD1(sqlite),
      TOUR_DB: createTestD1(tour),
      SESSION_KV: {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
      } as unknown as KVNamespace,
      MEDIA: {} as never,
      ASSETS: {} as never,
    };
    return { env, sqlite };
  }

  // 挂牌设置六列 + 号码全部预摆成脏值（号码取球员 id，避开 (club_id, number) 唯一索引）：
  // 断言「换队九列整行清写」才有对比面
  function seedCmpPlayer(sqlite: DatabaseSync, over: { id: number; clubId: number | null; status?: string; ca?: number; baseCa?: number; growthXp?: number; levelsApplied?: number }): void {
    sqlite
      .prepare(
        `INSERT INTO players (id, uid, name, club_id, position, age, ca, base_ca, pa, growth_xp, levels_applied, number,
                              transfer_listed, list_price, min_offer_price, offer_auto, not_for_sale, transfer_listed_at,
                              status, updated_at)
         VALUES (?, ?, ?, ?, 'ST', 24, ?, ?, 85, ?, ?, ?, 1, 10, 5, 1, 1, '${T0}', ?, '${SENTINEL}')`,
      )
      .run(
        over.id,
        `cmp${over.id}`,
        `整行${over.id}`,
        over.clubId,
        over.ca ?? 80,
        over.baseCa ?? null,
        over.growthXp ?? 0,
        over.levelsApplied ?? 0,
        over.id,
        over.status ?? 'normal',
      );
  }

  function seedCmpContract(sqlite: DatabaseSync, playerId: number, clubId: number, contractType: 'formal' | 'trainee'): void {
    sqlite
      .prepare(
        `INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, signed_at, effective_from, service_ticks, protection_ticks)
         VALUES (?, ?, ?, 20, 2.5, ?, 1, '2026-06-01T00:00:00Z', '2026-06-01', 2, NULL)`,
      )
      .run(playerId, playerId, clubId, contractType);
  }

  function seedCmpTransfer(
    sqlite: DatabaseSync,
    over: { id: number; type?: string; playerId: number; from: number | null; to: number | null; fee?: number | null; status?: string },
  ): void {
    sqlite
      .prepare(
        `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 2, '{}')`,
      )
      .run(over.id, over.type ?? 'transfer', over.playerId, over.from, over.to, over.fee === undefined ? 10 : over.fee, over.status ?? 'pending_review');
  }

  function seedCmpClubs(sqlite: DatabaseSync): void {
    sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES
        (1, '整行卖方', 'premier', 'active'), (2, '整行买方', 'premier', 'active'), (3, '整行第三队', 'premier', 'active');
      INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 200, '${T0}'), (2, 200, '${T0}'), (3, 200, '${T0}');
      INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
        (1, 'opening_import', 200, 200, '期初', '${T0}'),
        (2, 'opening_import', 200, 200, '期初', '${T0}'),
        (3, 'opening_import', 200, 200, '期初', '${T0}');
    `);
  }

  // 换队九列的目标值形态（transfers.ts:484 的 SET 列集，status 由 resolveTarget 产出）
  const NINE_COL_TARGET = {
    club_id: 2,
    number: null,
    transfer_listed: 0,
    list_price: null,
    min_offer_price: null,
    offer_auto: 0,
    not_for_sale: 0,
    transfer_listed_at: null,
  };

  it('TC-CMP-01 completeTransfer：ctx 四式 status + 九列整行断言 + 守卫格整行不变 + 海捞格照写', async () => {
    const fx = freshCmpEnv();
    seedCmpClubs(fx.sqlite);
    for (const id of [1, 2, 3, 4]) seedCmpPlayer(fx.sqlite, { id, clubId: 1 });
    seedCmpPlayer(fx.sqlite, { id: 5, clubId: 3 }); // 守卫格：实际归属 club 3，单据写 from 1
    seedCmpPlayer(fx.sqlite, { id: 6, clubId: null, status: 'free' }); // 海捞格
    seedCmpContract(fx.sqlite, 1, 1, 'formal'); // v1：现行 formal + terms trainee → trainee
    seedCmpContract(fx.sqlite, 2, 1, 'trainee'); // v2：现行 trainee + terms formal → normal
    seedCmpContract(fx.sqlite, 3, 1, 'trainee'); // v3：无 terms + 现行 trainee → trainee
    seedCmpContract(fx.sqlite, 4, 1, 'formal'); // v4：无 terms + 现行 formal → normal
    seedCmpContract(fx.sqlite, 5, 3, 'formal');
    for (const id of [1, 2, 3, 4, 5]) seedCmpTransfer(fx.sqlite, { id, playerId: id, from: 1, to: 2 });
    seedCmpTransfer(fx.sqlite, { id: 6, type: 'free_agent', playerId: 6, from: null, to: 2, fee: 0 });

    const traineeTerms: ContractTerms = { wage: 2, releaseFee: 20, source: 'negotiation', contractType: 'trainee' };
    const formalTerms: ContractTerms = { wage: 2, releaseFee: 20, source: 'negotiation', contractType: 'formal' };

    // 四式：dealTerms 优先、否则现行合同、无合同回 normal（resolveTarget('transfer_complete')）
    expect((await completeTransfer(fx.env, 1, null, 'user', undefined, traineeTerms)).status).toBe('completed');
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 1')).toMatchObject({
      status: 'trainee',
      ...NINE_COL_TARGET,
    });
    expect((await completeTransfer(fx.env, 2, null, 'user', undefined, formalTerms)).status).toBe('completed');
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 2')).toMatchObject({
      status: 'normal',
      ...NINE_COL_TARGET,
    });
    expect((await completeTransfer(fx.env, 3, null, 'user')).status).toBe('completed');
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 3')).toMatchObject({
      status: 'trainee',
      ...NINE_COL_TARGET,
    });
    expect((await completeTransfer(fx.env, 4, null, 'user')).status).toBe('completed');
    const row4 = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 4');
    expect(row4).toMatchObject({ status: 'normal', ...NINE_COL_TARGET });
    expect(row4?.updated_at).not.toBe(SENTINEL); // 时间列只断言离开哨兵（计划 §3.6 时间列剔除规则同款）

    // 守卫格：moveFromClubId（= null）与球员现 club 不符 → club_id IS NULL 不命中 → 整行不变
    const before5 = JSON.stringify(sqlGet(fx.sqlite, 'SELECT * FROM players WHERE id = 5'));
    expect((await completeTransfer(fx.env, 5, null, 'user')).status).toBe('completed');
    expect(JSON.stringify(sqlGet(fx.sqlite, 'SELECT * FROM players WHERE id = 5'))).toBe(before5);

    // 海捞格：moveFromClubId = null 命中 club_id IS NULL 的自由身 → 照常写入九列
    expect((await completeTransfer(fx.env, 6, null, 'user')).status).toBe('completed');
    const row6 = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 6');
    expect(row6).toMatchObject({ status: 'normal', ...NINE_COL_TARGET });
    expect(row6?.updated_at).not.toBe(SENTINEL);
  });

  it('TC-CMP-02 completeTermination：12 列整行断言（ca 回 base_ca）+ 守卫格整行不变 + retired 格照写 free', async () => {
    const fx = freshCmpEnv();
    seedCmpClubs(fx.sqlite);
    seedCmpPlayer(fx.sqlite, { id: 1, clubId: 1, ca: 90, baseCa: 80, growthXp: 50, levelsApplied: 2 }); // 主格：预置成长
    seedCmpPlayer(fx.sqlite, { id: 2, clubId: 3 }); // 守卫格：归属 club 3，单据 from 1
    seedCmpPlayer(fx.sqlite, { id: 3, clubId: 1, status: 'retired' }); // retired 格：compound 无 status 守卫
    seedCmpContract(fx.sqlite, 1, 1, 'formal');
    seedCmpContract(fx.sqlite, 3, 1, 'formal');
    for (const id of [1, 2, 3]) seedCmpTransfer(fx.sqlite, { id, type: 'termination', playerId: id, from: 1, to: null, fee: null });

    expect((await completeTermination(fx.env, 1, 1, 'user')).status).toBe('completed');
    const row1 = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 1');
    expect(row1).toMatchObject({
      status: 'free',
      club_id: null,
      number: null,
      ca: 80, // COALESCE(base_ca, ca)：成长所得归零回初始
      growth_xp: 0,
      levels_applied: 0,
      transfer_listed: 0,
      list_price: null,
      min_offer_price: null,
      offer_auto: 0,
      not_for_sale: 0,
      transfer_listed_at: null,
    });
    expect(row1?.updated_at).not.toBe(SENTINEL);

    // 守卫格：club_id = from_club_id 不命中 → 终止 UPDATE 0 行——它写的 12 列整组不变。
    //（同批的徽章台账重算 / 成长划断事件会触到该行 updated_at 等其它列，整行 JSON 对比不成立，
    // 断言只锁终止 UPDATE 自己的列集。）
    const TERMINATION_COLS: string[] = [
      'status',
      'club_id',
      'number',
      'ca',
      'growth_xp',
      'levels_applied',
      'transfer_listed',
      'list_price',
      'min_offer_price',
      'offer_auto',
      'not_for_sale',
      'transfer_listed_at',
    ];
    const before2 = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 2');
    expect((await completeTermination(fx.env, 2, 1, 'user')).status).toBe('completed');
    const after2 = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 2');
    for (const key of TERMINATION_COLS) {
      expect(after2?.[key], `守卫格 ${key} 应不变`).toBe(before2?.[key]);
    }

    // retired 格照写 free（changes=1）——compound 无 status 守卫是有意设计（计划 L7 / TC-CMP-02）
    expect((await completeTermination(fx.env, 3, 1, 'user')).status).toBe('completed');
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM players WHERE id = 3')).toMatchObject({ status: 'free', club_id: null });
  });
});
