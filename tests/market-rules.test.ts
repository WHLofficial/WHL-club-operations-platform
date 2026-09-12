// 市场规则纯函数测试（§16：挂牌价边界 / 抬价步长 / 截止顺延 / 下架费 / 触发器防双花闸）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  bidDeadline,
  delistFee,
  isTradingDay,
  listingPriceBounds,
  parseTradeCalendar,
  shanghaiDateStr,
  validateBidAmount,
} from '../src/core/market-rules.ts';
import { applyMigrations, createTestD1 } from './d1.ts';

describe('挂牌价边界（规则 4.4.1.1）', () => {
  it('下限取违约金与身价五折的较低值，且不低于 1m；上限违约金 1.5 倍', () => {
    expect(listingPriceBounds(50, 80)).toEqual({ min: 25, max: 75 }); // min(25, 40)=25
    expect(listingPriceBounds(50, 30)).toEqual({ min: 15, max: 75 }); // min(25, 15)=15
    expect(listingPriceBounds(1, 100)).toEqual({ min: 1, max: 1.5 }); // 0.5m 五折被 1m 绝对下限顶起
    expect(listingPriceBounds(10, null)).toEqual({ min: 5, max: 15 }); // 身价缺失只看违约金
  });

  it('违约金过低挂不出合规价格', () => {
    expect(listingPriceBounds(0.6, null)).toBeNull(); // 上限 0.9 < 绝对下限 1
    expect(listingPriceBounds(0, null)).toBeNull();
  });
});

describe('出价校验（规则 4.4.1.2）', () => {
  it('首笔出价不低于挂牌价', () => {
    expect(validateBidAmount(20, null, 20)).toBeNull();
    expect(validateBidAmount(19.99, null, 20)).toBe('首笔出价不得低于挂牌价 20 m');
  });

  it('抬价至少比当前最高多一个步长', () => {
    expect(validateBidAmount(31, 30, 20, 1)).toBeNull();
    expect(validateBidAmount(30.5, 30, 20, 1)).toBe('抬价至少要比当前最高价多 1 m（当前最高 30 m）');
    expect(validateBidAmount(35, 30, 20, 5)).toBeNull();
  });
});

describe('截止惰性判定（规则 4.4.7）', () => {
  const hours: [number, number] = [18, 23];

  it('18-23 点内静默满 3 小时即截止（段内静默起点=最后出价时刻）', () => {
    // 最后出价 19:00 → 判定时刻 22:00
    const r = bidDeadline({
      lastBidAt: '2026-07-01T11:00:00.000Z', // 上海 19:00
      listedDay: '2026-06-30',
      now: new Date('2026-07-01T13:59:00.000Z'), // 上海 21:59
      deadlineHours: hours,
      silenceHours: 3,
      calendar: 'none',
    });
    expect(r.deadlineDay).toBe('2026-07-01');
    expect(r.deadlineAt).toBe('2026-07-01T14:00:00.000Z'); // 上海 22:00
    expect(r.met).toBe(false);
    expect(bidDeadline({ lastBidAt: '2026-07-01T11:00:00.000Z', listedDay: '2026-06-30', now: new Date('2026-07-01T14:00:00.000Z'), deadlineHours: hours, silenceHours: 3, calendar: 'none' }).met).toBe(true);
  });

  it('挂牌次日起才可判定；白天出价的判定窗从当日 18 点起算', () => {
    // 挂牌日 7-01，7-01 当天（N 日）不可判定
    const n = bidDeadline({ lastBidAt: null, listedDay: '2026-07-01', now: new Date('2026-07-01T14:00:00.000Z'), deadlineHours: hours, silenceHours: 3, calendar: 'none' });
    expect(n.deadlineDay).toBe('2026-07-02');
    expect(n.met).toBe(false);
    // 最后出价在 7-02 白天 12:00（上海）→ 无出价段 18:00-21:00，21:00 截止
    const d = bidDeadline({ lastBidAt: '2026-07-02T04:00:00.000Z', listedDay: '2026-07-01', now: new Date('2026-07-02T10:00:00.000Z'), deadlineHours: hours, silenceHours: 3, calendar: 'none' });
    expect(d.deadlineAt).toBe('2026-07-02T13:00:00.000Z'); // 上海 21:00
    expect(d.met).toBe(false);
  });

  it('出价晚于 20:00 时 3 小时静默落不进当日时段，顺延下一交易日 18-21', () => {
    const r = bidDeadline({
      lastBidAt: '2026-07-01T12:30:00.000Z', // 上海 20:30
      listedDay: '2026-06-30',
      now: new Date('2026-07-01T15:00:00.000Z'),
      deadlineHours: hours,
      silenceHours: 3,
      calendar: 'none',
    });
    expect(r.deadlineDay).toBe('2026-07-02');
    expect(r.deadlineAt).toBe('2026-07-02T13:00:00.000Z'); // 7-02 21:00
  });

  it('节假日顺延到下一交易日（交易日历）', () => {
    const calendar = parseTradeCalendar('{"holidays":["2026-07-02"]}');
    expect(isTradingDay('2026-07-02', calendar)).toBe(false);
    const r = bidDeadline({
      lastBidAt: '2026-07-01T12:30:00.000Z',
      listedDay: '2026-06-30',
      now: new Date('2026-07-01T15:00:00.000Z'),
      deadlineHours: hours,
      silenceHours: 3,
      calendar,
    });
    expect(r.deadlineDay).toBe('2026-07-03');
  });

  it('非法交易日历配置回退自然日', () => {
    expect(parseTradeCalendar('not-json')).toBe('none');
    expect(parseTradeCalendar('{"holidays":[1,2]}')).toBe('none');
    expect(parseTradeCalendar(null)).toBe('none');
  });

  it('上海日期换算', () => {
    expect(shanghaiDateStr(Date.parse('2026-07-01T15:59:00.000Z'))).toBe('2026-07-01'); // 上海 23:59
    expect(shanghaiDateStr(Date.parse('2026-07-01T16:00:00.000Z'))).toBe('2026-07-02'); // 上海 00:00
  });
});

describe('下架费（规则 4.4.7）', () => {
  it('挂牌价的 10%', () => {
    expect(delistFee(25)).toBe(2.5);
    expect(delistFee(33.3)).toBe(3.33);
    expect(delistFee(10, 0.2)).toBe(2);
  });
});

describe('fund_holds 出价闸触发器（0005，§16 并发防线）', () => {
  function setup() {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const db = createTestD1(sqlite);
    sqlite.exec(`INSERT INTO clubs (id, name, league_tier) VALUES (1, '卖方', 'premier'), (2, '买方甲', 'premier'), (3, '买方乙', 'premier');
      INSERT INTO ledger_accounts (club_id, balance) VALUES (1, 100), (2, 50), (3, 5);
      INSERT INTO players (id, uid, name, club_id, ca) VALUES (10, 'p10', '球员甲', 1, 80);
      INSERT INTO contracts (id, player_id, club_id, release_fee, wage, is_active) VALUES (1, 10, 1, 20, 1, 1);
      INSERT INTO listings (id, player_id, seller_club_id, ask_price, status, listed_at, listed_day, season, window_seq)
        VALUES (100, 10, 1, 15, 'listed', '2026-07-01T10:00:00Z', '2026-07-01', 1, 1);`);
    return { sqlite, db };
  }

  function holdInsert(db: ReturnType<typeof createTestD1>, clubId: number, amount: number, refId = 100) {
    return db
      .prepare(
        `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
         VALUES (?, ?, 'held', 'listing', ?, '2026-07-02T10:00:00Z')`,
      )
      .bind(clubId, amount, refId);
  }

  it('放行：首价≥挂牌价且可用资金足额', async () => {
    const { db } = setup();
    await holdInsert(db, 2, 15).run();
    const row = await db.prepare('SELECT COUNT(*) AS n FROM fund_holds').first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('拦截：首价低于挂牌价（WHL_BID_REJECT_AMOUNT）', async () => {
    const { db } = setup();
    await expect(holdInsert(db, 2, 14.99).run()).rejects.toThrow('WHL_BID_REJECT_AMOUNT');
  });

  it('拦截：抬价不足步长（有人出过 15，出 15.9 被拒）', async () => {
    const { sqlite, db } = setup();
    await holdInsert(db, 2, 15).run();
    sqlite.exec(`INSERT INTO bids (id, listing_id, club_id, amount, created_at, status) VALUES (1, 100, 2, 15, '2026-07-02T10:00:00Z', 'active')`);
    await expect(holdInsert(db, 3, 15.9).run()).rejects.toThrow('WHL_BID_REJECT_AMOUNT');
    await holdInsert(db, 2, 16).run(); // 足步长的抬价放行（买方甲资金充裕）
  });

  it('拦截：可用资金不足；抬价顶替自己现行冻结时按净差额校验', async () => {
    const { db } = setup();
    // 买方乙只有 5m
    await expect(holdInsert(db, 3, 15).run()).rejects.toThrow('WHL_BID_REJECT_FUNDS');
    // 买方甲已冻结 15（余额 50），抬到 20 只需净补 5 → 放行
    await holdInsert(db, 2, 15).run();
    await holdInsert(db, 2, 20).run();
    const held = await db.prepare('SELECT SUM(amount) AS s FROM fund_holds WHERE status = \'held\'').first<{ s: number }>();
    expect(held?.s).toBe(35); // 15 + 20（旧冻结此时还未释放，同一事务里先插新冻结）
  });

  it('拦截：挂牌不在竞价状态（WHL_BID_REJECT_CLOSED）', async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE id = 100`);
    await expect(holdInsert(db, 2, 15).run()).rejects.toThrow('WHL_BID_REJECT_CLOSED');
  });
});
