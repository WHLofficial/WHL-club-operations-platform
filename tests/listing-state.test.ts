// 挂单收口转移表与唯一写侧入口（v6.83.0 第一步）：
// 1) core 转移表：12 cause × 5 状态的 (from, cause) 行为矩阵，未知状态一律 null；
// 2) listing-ops SQL 守卫：合法转移 changes=1 并落到目标态，非法转移 changes=0 且整行不动；
// 3) note 文案逐字锁（固定 5 / 参数化 3 / 置 NULL 1 / 不碰 3）与 SET 附带列逐 cause 固化。
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { advance, advanceStatement } from '../src/worker/listing-ops.ts';
import type { ListingCloseParams } from '../src/worker/listing-ops.ts';
import {
  advanceTarget,
  LISTING_CLOSE_CAUSES,
  type ListingCloseCause,
  type ListingStatus,
} from '../src/core/listing-state.ts';
import { createTestDb, sqlGet } from './d1.ts';
import type { Env } from '../src/worker/env.ts';
import type { MarketContext } from '../src/worker/market-context.ts';
import { adminVoidBid } from '../src/worker/market-intervene.ts';
import { delistUnbid, voidExpiredActivation, type ListingCore } from '../src/worker/market-settle.ts';

const ALL_STATUSES: readonly ListingStatus[] = ['listed', 'bidding', 'matched_pending', 'pending_review', 'delisted'];

// 与 core 转移表独立的第二份硬编码：测试自己声明期望，避免「实现即预期」的循环验证。
const LEGAL_FROM: Record<ListingCloseCause, readonly ListingStatus[]> = {
  first_bid: ['listed', 'bidding'],
  activation_match_start: ['listed', 'bidding'],
  settle_for_review: ['bidding', 'matched_pending', 'listed'],
  unbid_expired: ['listed'],
  activation_price_expired: ['listed'],
  admin_reset: ['bidding'],
  admin_cancel: ['listed', 'matched_pending'],
  forced_cancel: ['listed', 'bidding'],
  matched_kept: ['matched_pending'],
  negotiation_closed: ['pending_review'],
  review_rejected: ['pending_review'],
  deal_done: ['listed', 'bidding', 'matched_pending', 'pending_review'],
};

const TARGET: Record<ListingCloseCause, ListingStatus> = {
  first_bid: 'bidding',
  activation_match_start: 'matched_pending',
  settle_for_review: 'pending_review',
  unbid_expired: 'delisted',
  activation_price_expired: 'delisted',
  admin_reset: 'listed',
  admin_cancel: 'delisted',
  forced_cancel: 'delisted',
  matched_kept: 'delisted',
  negotiation_closed: 'delisted',
  review_rejected: 'delisted',
  deal_done: 'delisted',
};

// 每条语句允许出现的 SET 列（语义卡 ④/⑤：附带列逐 cause 固化，其余列只读）。
const SET_COLUMNS: Record<ListingCloseCause, readonly string[]> = {
  first_bid: ['status', 'last_bid_at', 'activation_deadline', 'deadline_at'],
  activation_match_start: ['status', 'match_deadline', 'deadline_at', 'deadline_note'],
  settle_for_review: ['status', 'match_deadline', 'deadline_at'],
  unbid_expired: ['status', 'deadline_note'],
  activation_price_expired: ['status', 'deadline_note', 'activation_deadline'],
  admin_reset: ['status', 'last_bid_at'],
  admin_cancel: ['status', 'deadline_note', 'activation_deadline', 'match_deadline'],
  forced_cancel: ['status', 'deadline_note'],
  matched_kept: ['status', 'deadline_note'],
  negotiation_closed: ['status', 'deadline_note'],
  review_rejected: ['status', 'deadline_note'],
  deal_done: ['status', 'deadline_note'],
};

interface ListingSeed {
  seller_club_id: number | null;
  ask_price: number;
  type: string | null;
  listed_at: string;
  listed_day: string;
  last_bid_at: string | null;
  deadline_note: string | null;
  window_seq: number | null;
  season: number | null;
  deadline_at: string | null;
  activation_proof: string | null;
  activation_deadline: string | null;
  activated_by: number | null;
  match_deadline: string | null;
  bid_paused: number;
}

const BASE_SEED: ListingSeed = {
  seller_club_id: 1,
  ask_price: 10,
  type: 'normal',
  listed_at: '2026-01-01T00:00:00.000Z',
  listed_day: '2026-01-01',
  last_bid_at: '2026-01-02T00:00:00.000Z',
  deadline_note: 'SEED-NOTE',
  window_seq: 3,
  season: 2,
  deadline_at: '2000-01-01T00:00:00.000Z',
  activation_proof: null,
  activation_deadline: '2000-01-01T00:00:00.000Z',
  activated_by: null,
  match_deadline: '2000-01-01T00:00:00.000Z',
  bid_paused: 1,
};

type SeedOverrides = Partial<ListingSeed>;

interface ListingRow extends ListingSeed {
  id: number;
  player_id: number;
  status: string;
}

function readRow(sqlite: DatabaseSync, id: number): ListingRow {
  const row = sqlGet<ListingRow>(
    sqlite,
    `SELECT id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, last_bid_at,
            deadline_note, window_seq, season, deadline_at, activation_proof, activation_deadline,
            activated_by, match_deadline, bid_paused
       FROM listings WHERE id = ?`,
    id,
  );
  if (row === undefined) throw new Error(`listings ${id} 不存在`);
  return row;
}

function seedListing(sqlite: DatabaseSync, id: number, status: string, overrides: SeedOverrides = {}): ListingRow {
  const row = { ...BASE_SEED, ...overrides };
  sqlite
    .prepare(
      `INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, last_bid_at,
                             deadline_note, window_seq, season, deadline_at, activation_proof, activation_deadline,
                             activated_by, match_deadline, bid_paused)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      id,
      row.seller_club_id,
      row.type,
      row.ask_price,
      status,
      row.listed_at,
      row.listed_day,
      row.last_bid_at,
      row.deadline_note,
      row.window_seq,
      row.season,
      row.deadline_at,
      row.activation_proof,
      row.activation_deadline,
      row.activated_by,
      row.match_deadline,
      row.bid_paused,
    );
  return readRow(sqlite, id);
}

// 矩阵调用：参数化 cause 的入参随 from 变（fromStatus 必须与当前行状态一致才可能合法）。
function advanceFor(db: D1Database, id: number, cause: ListingCloseCause, from: string): Promise<number> {
  switch (cause) {
    case 'first_bid':
      return advance(db, id, cause, { deadlineAt: '2030-01-01T00:00:00.000Z' });
    case 'activation_match_start':
      return advance(db, id, cause, {
        fromStatus: from === 'bidding' ? 'bidding' : 'listed',
        matchDeadline: '2030-01-01T00:00:00.000Z',
      });
    case 'settle_for_review':
      return advance(db, id, cause, {
        fromStatus: from === 'matched_pending' ? 'matched_pending' : from === 'listed' ? 'listed' : 'bidding',
      });
    case 'unbid_expired':
      return advance(db, id, cause, { isActivation: false, source: 'window_end' });
    case 'admin_cancel':
      return advance(db, id, cause, { reason: '矩阵' });
    case 'negotiation_closed':
      return advance(db, id, cause, { deadlineNote: '矩阵透传' });
    default:
      return advance(db, id, cause, {});
  }
}

// 列集测试用：不执行，只构造语句。
function paramsFor(cause: ListingCloseCause): ListingCloseParams<ListingCloseCause> {
  switch (cause) {
    case 'first_bid':
      return { deadlineAt: '2030-01-01T00:00:00.000Z' };
    case 'activation_match_start':
      return { fromStatus: 'listed', matchDeadline: '2030-01-01T00:00:00.000Z' };
    case 'settle_for_review':
      return { fromStatus: 'bidding' };
    case 'unbid_expired':
      return { isActivation: false, source: 'deadline' };
    case 'admin_cancel':
      return { reason: 'r' };
    case 'negotiation_closed':
      return { deadlineNote: 'n' };
    default:
      return {};
  }
}

// 批内下标锁：入口函数把 advanceStatement 的结果放回自己 db.batch 的原位置，
// 这里按提交顺序记录每条语句的 sqlText——语句一旦挪位（比如把 listings 挪到批尾），
// 依赖「同批已改 delisted」的 EXISTS 前提就不成立，下标断言会立即翻红。
function traceBatch(db: D1Database): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const wrapped = {
    prepare(input: string) {
      return db.prepare(input);
    },
    async batch(statements: D1PreparedStatement[]) {
      for (const stmt of statements) sql.push((stmt as unknown as { sqlText?: string }).sqlText ?? '');
      return db.batch(statements);
    },
  };
  return { db: wrapped as unknown as D1Database, sql };
}

// SET 子句按顶层逗号切分（避开 strftime(...) 里的逗号），取等号左侧列名。
function setColumns(sql: string): string[] {
  const body = sql.slice(sql.indexOf(' SET ') + ' SET '.length, sql.indexOf(' WHERE '));
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((part) => part.slice(0, part.indexOf('=')).trim());
}

describe('listing-state 转移表（core 纯函数）', () => {
  it('12 × 5 行为矩阵：只认表内 (from, cause)，其余一律 null', () => {
    for (const cause of LISTING_CLOSE_CAUSES) {
      for (const from of ALL_STATUSES) {
        const expected = LEGAL_FROM[cause].includes(from) ? TARGET[cause] : null;
        expect(advanceTarget(from, cause), `${cause} from ${from}`).toBe(expected);
      }
      expect(advanceTarget('sold', cause), `${cause} from sold`).toBeNull();
    }
  });
});

describe('listing-ops 守卫矩阵（真实迁移）', () => {
  it('合法转移恰改 1 行并落到目标态；非法转移静默 no-op（changes=0，整行不动）', async () => {
    const { sqlite, db } = createTestDb();
    let nextId = 100;
    for (const cause of LISTING_CLOSE_CAUSES) {
      for (const from of ALL_STATUSES) {
        const id = nextId++;
        const overrides: SeedOverrides =
          cause === 'first_bid'
            ? { deadline_at: null, activation_deadline: null } // 双时间窗守卫要放行
            : {};
        if (cause === 'forced_cancel') overrides.type = 'forced';
        const before = seedListing(sqlite, id, from, overrides);
        const legal = LEGAL_FROM[cause].includes(from);

        const changes = await advanceFor(db, id, cause, from);
        expect(changes, `${cause} from ${from}`).toBe(legal ? 1 : 0);

        const after = readRow(sqlite, id);
        expect(after.status, `${cause} from ${from}`).toBe(legal ? TARGET[cause] : from);
        if (!legal) expect(after, `${cause} from ${from} 必须整行不动`).toEqual(before);
        // 只读列：任何 cause、任何结果都不许碰（L5）
        expect(
          {
            bid_paused: after.bid_paused,
            listed_at: after.listed_at,
            listed_day: after.listed_day,
            season: after.season,
            window_seq: after.window_seq,
          },
          `${cause} from ${from} 只读列`,
        ).toEqual({
          bid_paused: before.bid_paused,
          listed_at: before.listed_at,
          listed_day: before.listed_day,
          season: before.season,
          window_seq: before.window_seq,
        });
      }
    }
  });

  it('未知状态 sold：12 个 cause 一律 changes=0 且整行不动（正向白名单）', async () => {
    const { sqlite, db } = createTestDb();
    let nextId = 500;
    for (const cause of LISTING_CLOSE_CAUSES) {
      const id = nextId++;
      const before = seedListing(sqlite, id, 'sold');
      expect(await advanceFor(db, id, cause, 'sold'), cause).toBe(0);
      expect(readRow(sqlite, id), cause).toEqual(before);
    }
  });

  it('TC-MX-04 forced_cancel 类型守卫：type 非 forced 时 listed/bidding 均 no-op', async () => {
    const { sqlite, db } = createTestDb();
    const cells: { type: string | null; from: ListingStatus }[] = [
      { type: 'normal', from: 'listed' },
      { type: 'normal', from: 'bidding' },
      { type: null, from: 'listed' },
      { type: null, from: 'bidding' },
    ];
    let id = 1300;
    for (const cell of cells) {
      const listingId = id++;
      const before = seedListing(sqlite, listingId, cell.from, { type: cell.type });
      const label = `${cell.type ?? 'NULL'} from ${cell.from}`;
      expect(await advance(db, listingId, 'forced_cancel', {}), label).toBe(0);
      expect(readRow(sqlite, listingId), `${label} 必须整行不动`).toEqual(before);
    }
    // 正向对照：同一格换成 type='forced' 确实可收口，证明上面四格失败只因类型守卫。
    seedListing(sqlite, id, 'listed', { type: 'forced' });
    expect(await advance(db, id, 'forced_cancel', {})).toBe(1);
    expect(readRow(sqlite, id).status).toBe('delisted');
    expect(readRow(sqlite, id).deadline_note).toBe('管理组取消强制拍卖');
  });

  it('TC-MX-08 admin_reset 活跃出价守卫：有 active bid 时 no-op，仅 superseded/无 bid 可重置', async () => {
    const { sqlite, db } = createTestDb();
    // 有活跃出价：重置会让出价/冻结与挂牌状态脱钩，必须拦下
    const withActive = seedListing(sqlite, 1320, 'bidding');
    sqlite.exec(
      `INSERT INTO bids (id, listing_id, club_id, amount, created_at, status)
       VALUES (7001, 1320, 2, 12, '2026-01-03T00:00:00.000Z', 'active')`,
    );
    expect(await advance(db, 1320, 'admin_reset', {})).toBe(0);
    expect(readRow(sqlite, 1320)).toEqual(withActive);

    // 只有 superseded 历史出价：不阻断重置
    seedListing(sqlite, 1321, 'bidding');
    sqlite.exec(
      `INSERT INTO bids (id, listing_id, club_id, amount, created_at, status)
       VALUES (7002, 1321, 2, 12, '2026-01-03T00:00:00.000Z', 'superseded')`,
    );
    expect(await advance(db, 1321, 'admin_reset', {})).toBe(1);
    const reset = readRow(sqlite, 1321);
    expect(reset.status).toBe('listed');
    expect(reset.last_bid_at).toBeNull();
    expect(reset.deadline_note).toBe('SEED-NOTE');

    // 无出价：正常重置
    seedListing(sqlite, 1322, 'bidding');
    expect(await advance(db, 1322, 'admin_reset', {})).toBe(1);
    expect(readRow(sqlite, 1322).status).toBe('listed');
  });

  it('TC-MX-09 first_bid 双时间窗守卫：任一窗过期即 no-op，仅两窗 NULL 放行', async () => {
    const { sqlite, db } = createTestDb();
    sqlite.exec(`INSERT INTO clubs (id, name) VALUES (5, 'TC-MX-09 激活方')`); // activated_by 外键
    const deadlineAt = '2030-01-01T00:00:00.000Z';
    const expired = '2000-01-01T00:00:00.000Z';
    const future = '2030-01-02T00:00:00.000Z';
    const cells: { overrides: SeedOverrides; changes: number; label: string }[] = [
      { overrides: { deadline_at: expired, activation_deadline: null }, changes: 0, label: 'deadline_at 过期' },
      {
        overrides: { deadline_at: null, activation_deadline: expired, activated_by: 5 },
        changes: 0,
        label: 'activation_deadline 过期',
      },
      { overrides: { deadline_at: null, activation_deadline: null }, changes: 1, label: '两窗 NULL' },
      {
        overrides: { deadline_at: future, activation_deadline: expired, activated_by: 5 },
        changes: 0,
        label: 'deadline_at 未来 + activation_deadline 过期',
      },
    ];
    let id = 1330;
    for (const cell of cells) {
      const listingId = id++;
      const before = seedListing(sqlite, listingId, 'listed', cell.overrides);
      expect(await advance(db, listingId, 'first_bid', { deadlineAt }), cell.label).toBe(cell.changes);
      const after = readRow(sqlite, listingId);
      if (cell.changes === 0) {
        expect(after, `${cell.label} 必须整行不动`).toEqual(before);
      } else {
        expect(after.status).toBe('bidding');
        expect(after.deadline_at).toBe(deadlineAt);
        expect(after.activation_deadline).toBeNull();
      }
    }
  });

  it('TC-MX-06 不存在的挂牌：12 个 cause 一律 changes=0 且不抛', async () => {
    const { db } = createTestDb();
    for (const cause of LISTING_CLOSE_CAUSES) {
      await expect(advance(db, 999999, cause, paramsFor(cause)), cause).resolves.toBe(0);
    }
  });

  it('TC-MX-07 幂等重跑：同一行连跑两次，仅 first_bid 第二次仍变更（重写截止）', async () => {
    const { sqlite, db } = createTestDb();
    let id = 1400;
    for (const cause of LISTING_CLOSE_CAUSES) {
      const listingId = id++;
      const overrides: SeedOverrides = cause === 'first_bid' ? { deadline_at: null, activation_deadline: null } : {};
      if (cause === 'forced_cancel') overrides.type = 'forced';
      seedListing(sqlite, listingId, LEGAL_FROM[cause][0], overrides);

      expect(await advance(db, listingId, cause, paramsFor(cause)), `${cause} 第一次`).toBe(1);
      const second =
        cause === 'first_bid'
          ? await advance(db, listingId, 'first_bid', { deadlineAt: '2031-01-01T00:00:00.000Z' })
          : await advance(db, listingId, cause, paramsFor(cause));
      if (cause === 'first_bid') {
        // 重写式：第二次仍在合法起点内，按第二次入参重写截止时刻
        expect(second, cause).toBe(1);
        expect(readRow(sqlite, listingId).deadline_at).toBe('2031-01-01T00:00:00.000Z');
      } else {
        expect(second, cause).toBe(0);
      }
    }
  });

  it('advanceStatement 形态：单条 prepared statement 可独立执行并回 changes', async () => {
    const { sqlite, db } = createTestDb();
    seedListing(sqlite, 900, 'matched_pending');
    const stmt = advanceStatement(db, 900, 'matched_kept', {});
    expect((stmt as unknown as { sqlText: string }).sqlText).toContain('UPDATE listings SET status');
    const result = await stmt.run();
    expect(result.meta.changes).toBe(1);
    expect(readRow(sqlite, 900).status).toBe('delisted');
  });
});

describe('TC-ORD-04 三条 EXISTS 承重链（真实入口，批内下标锁）', () => {
  it('delistUnbid：listings 语句固定在批首，球员还原/解冻/下架费都以 delisted 为前提', async () => {
    const { sqlite, db } = createTestDb();
    // 先落挂牌：fund_holds 的 BEFORE INSERT 闸会校验挂牌状态与两窗（0005/0059/0087）
    seedListing(sqlite, 2001, 'listed', { type: 'normal', ask_price: 10, deadline_at: null, activation_deadline: null });
    sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (1, 'TC-ORD-04 卖方');
      INSERT INTO players (id, uid, name, club_id, status) VALUES (2001, 'uid2001', '无人出价', 1, 'listed');
      INSERT INTO contracts (id, player_id, club_id, contract_type, is_active) VALUES (2001, 2001, 1, 'formal', 1);
      INSERT INTO ledger_accounts (club_id, balance, updated_at)
      VALUES (1, 100, '2026-01-01T00:00:00.000Z'), (2, 100, '2026-01-01T00:00:00.000Z');
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
      VALUES (5001, 2, 10, 'held', 'listing', 2001, '2026-01-01T00:00:00.000Z');
    `);
    const trace = traceBatch(db);
    const env = { DB: trace.db } as unknown as Env;
    const ctx = { delistFeeRate: 0.1 } as unknown as MarketContext;
    const listing: ListingCore = {
      id: 2001,
      player_id: 2001,
      seller_club_id: 1,
      type: 'normal',
      ask_price: 10,
      season: 2,
      window_seq: 3,
    };

    expect(await delistUnbid(env, listing, ctx, null, 'cron_tick')).toBe('delisted');
    // 下标 0 = listings 收口；一旦挪到批尾，球员还原/解冻/账本/审计的 EXISTS 前提不再同批成立
    expect(trace.sql[0]).toContain("UPDATE listings SET status = 'delisted'");
    expect(trace.sql[1]).toContain('UPDATE players');
    expect(trace.sql[1]).toContain("EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')");
    expect(readRow(sqlite, 2001).status).toBe('delisted');
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = 2001')?.status).toBe('normal');
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM fund_holds WHERE id = 5001')?.status).toBe('released');
    expect(sqlGet<{ balance: number }>(sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')?.balance).toBe(99);
    expect(
      sqlGet<{ amount: number }>(sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND ref_id = 2001")
        ?.amount,
    ).toBe(-1);
  });

  it('voidExpiredActivation：listings 语句在批首，球员还原为合同类型态', async () => {
    const { sqlite, db } = createTestDb();
    sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (3, 'TC-ORD-04 原属'), (4, 'TC-ORD-04 激活方');
      INSERT INTO players (id, uid, name, club_id, status) VALUES (2101, 'uid2101', '激活失效', 3, 'listed');
      INSERT INTO contracts (id, player_id, club_id, contract_type, is_active) VALUES (2101, 2101, 3, 'trainee', 1);
    `);
    seedListing(sqlite, 2101, 'listed', {
      type: 'activation',
      activation_deadline: '2000-01-01T00:00:00.000Z',
      activated_by: 4,
    });
    const trace = traceBatch(db);

    expect(await voidExpiredActivation(trace.db, 2101, 2101, null, 'cron_tick')).toBe(true);
    expect(trace.sql[0]).toContain("UPDATE listings SET status = 'delisted'");
    expect(trace.sql[1]).toContain('UPDATE players');
    expect(trace.sql[1]).toContain("EXISTS (SELECT 1 FROM listings WHERE id = ? AND status = 'delisted')");
    const row = readRow(sqlite, 2101);
    expect(row.status).toBe('delisted');
    expect(row.activation_deadline).toBeNull();
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM players WHERE id = 2101')?.status).toBe('trainee');
  });

  it('adminVoidBid：listings 语句固定在批下标 2，撤空后挂牌回 listed 且出价/冻结同步撤销', async () => {
    const { sqlite, db } = createTestDb();
    seedListing(sqlite, 2201, 'bidding', { deadline_at: null, activation_deadline: null });
    sqlite.exec(`
      INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (2, 100, '2026-01-03T00:00:00.000Z');
      INSERT INTO bids (id, listing_id, club_id, amount, created_at, status)
      VALUES (7101, 2201, 2, 25, '2026-01-03T00:00:00.000Z', 'active');
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at)
      VALUES (5101, 2, 26, 'held', 'listing', 2201, '2026-01-03T00:00:00.000Z');
    `);
    const trace = traceBatch(db);
    const env = { DB: trace.db } as unknown as Env;

    expect(await adminVoidBid(env, 7101, 7, '撤回测试')).toBe('done');
    expect(trace.sql[0]).toContain("UPDATE bids SET status = 'withdrawn'");
    expect(trace.sql[1]).toContain("UPDATE fund_holds SET status = 'released'");
    expect(trace.sql[2]).toContain("UPDATE listings SET status = 'listed'");
    const row = readRow(sqlite, 2201);
    expect(row.status).toBe('listed');
    expect(row.last_bid_at).toBeNull();
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM bids WHERE id = 7101')?.status).toBe('withdrawn');
    expect(sqlGet<{ status: string }>(sqlite, 'SELECT status FROM fund_holds WHERE id = 5101')?.status).toBe('released');
  });
});

describe('note 文案与附带列（逐字锁）', () => {
  it('固定文案 5 条逐字', async () => {
    const { sqlite, db } = createTestDb();
    const fixed: { cause: ListingCloseCause; from: ListingStatus; overrides?: SeedOverrides; note: string }[] = [
      { cause: 'matched_kept', from: 'matched_pending', note: '被匹配，球员留队' },
      { cause: 'forced_cancel', from: 'listed', overrides: { type: 'forced' }, note: '管理组取消强制拍卖' },
      { cause: 'activation_price_expired', from: 'listed', note: '激活方未在出价窗内落价，激活无效' },
      { cause: 'review_rejected', from: 'pending_review', note: '审核驳回' },
      { cause: 'deal_done', from: 'listed', note: '已成交' },
    ];
    let nextId = 1000;
    for (const item of fixed) {
      const id = nextId++;
      seedListing(sqlite, id, item.from, item.overrides);
      expect(await advanceFor(db, id, item.cause, item.from), item.cause).toBe(1);
      expect(readRow(sqlite, id).deadline_note, item.cause).toBe(item.note);
    }
  });

  it('参数化文案：unbid_expired 三变体（激活态优先）、admin_cancel 单次拼装不 trim、negotiation_closed 原样透传', async () => {
    const { sqlite, db } = createTestDb();
    let nextId = 1100;

    // 激活态压过 source：即使 source=deadline 也报「窗口结束激活方仍未落价」
    const unbidCases: { isActivation: boolean; source: 'deadline' | 'window_end'; note: string }[] = [
      { isActivation: false, source: 'deadline', note: '截止时刻无人出价' },
      { isActivation: false, source: 'window_end', note: '窗口结束无人出价' },
      { isActivation: true, source: 'deadline', note: '窗口结束激活方仍未落价，激活无效' },
      { isActivation: true, source: 'window_end', note: '窗口结束激活方仍未落价，激活无效' },
    ];
    for (const item of unbidCases) {
      const id = nextId++;
      seedListing(sqlite, id, 'listed');
      expect(await advance(db, id, 'unbid_expired', { isActivation: item.isActivation, source: item.source })).toBe(1);
      expect(readRow(sqlite, id).deadline_note, `${item.isActivation}/${item.source}`).toBe(item.note);
    }

    // admin_cancel：只拼一次前缀，reason 原样（含首尾空格）落库
    const cancelId = nextId++;
    seedListing(sqlite, cancelId, 'listed');
    expect(await advance(db, cancelId, 'admin_cancel', { reason: '  窗口外交易  ' })).toBe(1);
    const cancelled = readRow(sqlite, cancelId);
    expect(cancelled.deadline_note).toBe('管理组作废：  窗口外交易  ');
    expect(cancelled.activation_deadline).toBeNull();
    expect(cancelled.match_deadline).toBeNull();

    // negotiation_closed：调用方现值原样落库（三处现实文案 + 含「，自动作废」的透传）
    const notes = ['超过 72 小时没有动作，自动作废', '管理组作废：窗口外交易', '教练自助取消'];
    for (const note of notes) {
      const id = nextId++;
      seedListing(sqlite, id, 'pending_review');
      expect(await advance(db, id, 'negotiation_closed', { deadlineNote: note })).toBe(1);
      expect(readRow(sqlite, id).deadline_note).toBe(note);
    }
  });

  it('note 三态覆盖：first_bid/admin_reset/settle_for_review 不碰 note，activation_match_start 置 NULL', async () => {
    const { sqlite, db } = createTestDb();
    const deadlineAt = '2030-01-01T00:00:00.000Z';
    const matchDeadline = '2030-01-05T00:00:00.000Z';
    const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    seedListing(sqlite, 1200, 'listed', { deadline_at: null, activation_deadline: null });
    expect(await advance(db, 1200, 'first_bid', { deadlineAt })).toBe(1);
    const bid = readRow(sqlite, 1200);
    expect(bid.deadline_note).toBe('SEED-NOTE');
    expect(bid.last_bid_at).toMatch(stamp);
    expect(bid.activation_deadline).toBeNull();
    expect(bid.deadline_at).toBe(deadlineAt);

    seedListing(sqlite, 1201, 'bidding');
    expect(await advance(db, 1201, 'admin_reset', {})).toBe(1);
    const reset = readRow(sqlite, 1201);
    expect(reset.deadline_note).toBe('SEED-NOTE');
    expect(reset.last_bid_at).toBeNull();

    seedListing(sqlite, 1202, 'bidding');
    expect(await advance(db, 1202, 'settle_for_review', { fromStatus: 'bidding' })).toBe(1);
    const review = readRow(sqlite, 1202);
    expect(review.deadline_note).toBe('SEED-NOTE');
    expect(review.match_deadline).toBeNull();
    expect(review.deadline_at).toBeNull();

    seedListing(sqlite, 1203, 'listed');
    expect(await advance(db, 1203, 'activation_match_start', { fromStatus: 'listed', matchDeadline })).toBe(1);
    const matched = readRow(sqlite, 1203);
    expect(matched.deadline_note).toBeNull();
    expect(matched.match_deadline).toBe(matchDeadline);
    expect(matched.deadline_at).toBeNull();
  });

  it('TC-COL-02 first_bid 附带列：deadline_at 写入/置 NULL、activation_deadline 必清空', async () => {
    const { sqlite, db } = createTestDb();
    sqlite.exec(`INSERT INTO clubs (id, name) VALUES (5, 'TC-COL-02 激活方')`); // activated_by 外键
    const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const future = '2030-01-01T00:00:00.000Z';

    // (a) 双窗 NULL + 未来截止：写 deadline_at，并清掉 activation_deadline
    seedListing(sqlite, 1500, 'listed', { deadline_at: null, activation_deadline: null });
    expect(await advance(db, 1500, 'first_bid', { deadlineAt: future })).toBe(1);
    let row = readRow(sqlite, 1500);
    expect(row.deadline_at).toBe(future);
    expect(row.activation_deadline).toBeNull();
    expect(row.last_bid_at).toMatch(stamp);
    expect(row.last_bid_at).not.toBe(BASE_SEED.last_bid_at);

    // (b) 双窗 NULL + 截止 NULL：照旧落 NULL
    seedListing(sqlite, 1501, 'listed', { deadline_at: null, activation_deadline: null });
    expect(await advance(db, 1501, 'first_bid', { deadlineAt: null })).toBe(1);
    expect(readRow(sqlite, 1501).deadline_at).toBeNull();

    // (c) 双窗都未来 + 新截止：覆盖为新串，activation_deadline 清空
    seedListing(sqlite, 1502, 'listed', {
      deadline_at: '2030-02-01T00:00:00.000Z',
      activation_deadline: '2031-02-01T00:00:00.000Z',
      activated_by: 5,
    });
    expect(await advance(db, 1502, 'first_bid', { deadlineAt: future })).toBe(1);
    row = readRow(sqlite, 1502);
    expect(row.deadline_at).toBe(future);
    expect(row.activation_deadline).toBeNull();
  });

  it('SET 列集逐 cause 固化：附带列只按语义卡动，只读列绝不入 SET', () => {
    const { db } = createTestDb();
    for (const cause of LISTING_CLOSE_CAUSES) {
      const stmt = advanceStatement(db, 1, cause, paramsFor(cause)) as unknown as { sqlText: string };
      const actual = setColumns(stmt.sqlText).sort();
      expect(actual, cause).toEqual([...SET_COLUMNS[cause]].sort());
      expect(stmt.sqlText, cause).toContain(`UPDATE listings SET status = '${TARGET[cause]}'`);
    }
  });
});
