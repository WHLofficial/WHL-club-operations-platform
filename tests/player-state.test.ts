// v6.87.0 批 1：players.status 写侧收编核心测试——转移矩阵 + 还原上下文 + resolveTarget 直测。
// 对应 docs/test-plans/v6.87.0-player-ops-state.md §3.1（TC-MX-01…07）/ §3.2（TC-CTX-01…03）/
// TC-GRD-01/02；语句位与批序锁（TC-ORD）、compound 写点与例外登记（TC-CMP）、params 细分
//（TC-PRM）、源码锁（TC-SRC）与三处 bug 红测归后续批 / 既有域文件，不在本文件。
//
// 矩阵口径：16 个构造器 cause（10 pure + 6 restore）× 5 状态 = 80 格；forced_auction_cancel 的
// listed 格跑双分支（club / free）各一次 ⇒ 81 次执行、21 合法格（与计划 §3.1 清单对账）、
// 60 次 no-op（计划按 80 格记 59，差 1 = 双分支多出的那次合法执行，记账口径见计划 §8）。
// 单故障原则：每格只有 status 是被测条件，club_id / 合同 / 挂牌 / 幂等键等守卫输入全部预摆成
// 能通过的形状（含 free/retired 格也种归属与合同——脏行形态，正是守卫要确定性处理的面）。
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb, sqlGet } from './d1.ts';
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
            target = null; // 不在构造器矩阵（由后续批 TC-CMP 钉）
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
