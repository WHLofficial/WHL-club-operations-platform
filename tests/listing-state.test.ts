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
  type: string;
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
