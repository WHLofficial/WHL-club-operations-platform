// 预期收入额度（设计 §1/§2.1，v6.57.0）：公式三层同源 + 迁移 0081 三个资金触发器的同源锁。
// 口径：在途卖人收入的税后净额 × k 进「可支配」；k = config expected_income_rate（钳制 0–1，缺行 1.0）。
// 锁的目标是「应用层算的额度」与「触发器在事务内兜底的额度」逐字/逐值一致——两边任一侧漂移都要红。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestDb } from './d1.ts';
import type { Env } from '../src/worker/env.ts';
import { availableBalance, balanceSnapshot, creditLineGuard, creditLineSql, expectedIncomeBreakdown } from '../src/worker/ledger.ts';
import { closeSilentSessions, openNegotiationSession, voidSigningCore } from '../src/worker/negotiations.ts';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const readMig = (file: string) => readFileSync(join(MIG_DIR, file), 'utf8');
const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
// 本文件直用 node:sqlite；两个取行小助手让 TC-B-038 的断言体不用到处写 .prepare().get()
const sqlGet = <T>(sqlite: DatabaseSync, sql: string): T | undefined => sqlite.prepare(sql).get() as T | undefined;
const sqlAll = <T>(sqlite: DatabaseSync, sql: string): T[] => sqlite.prepare(sql).all() as T[];

const TRIGGERS = ['fund_holds_bid_guard', 'fund_holds_offer_guard', 'fund_holds_sea_sealed_guard'] as const;

function setup(): { sqlite: DatabaseSync; db: D1Database } {
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status, created_at) VALUES
      (1, '卖方', 'premier', 'active', '2026-01-01T00:00:00Z'),
      (2, '买方', 'premier', 'active', '2026-01-01T00:00:00Z'),
      (3, '第三方', 'premier', 'active', '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, status, ca, pa) VALUES
      (11, 'u11', '甲', 1, 'listed', 100, 120),
      (12, 'u12', '乙', 3, 'listed', 90, 100),
      (13, 'u13', '丙', 3, 'listed', 80, 90);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, is_active) VALUES
      (11, 1, 100, 1, 1), (12, 3, 100, 1, 1), (13, 3, 100, 1, 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
      (1, 0, '2026-01-01T00:00:00Z'), (2, 0, '2026-01-01T00:00:00Z'), (3, 0, '2026-01-01T00:00:00Z');
    -- 源①：卖方 1 的球员 11 挂牌在途，第三方出价 90（另有被顶替的 60，不得计入）
    INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at) VALUES
      (100, 11, 1, 'normal', 80, 'listed', '2026-01-01T00:00:00Z'),
      (200, 12, 3, 'normal', 40, 'listed', '2026-01-01T00:00:00Z'),
      (201, 13, 3, 'normal', 1, 'listed', '2026-01-01T00:00:00Z');
    INSERT INTO bids (listing_id, club_id, amount, created_at, status) VALUES
      (100, 3, 90, '2026-01-01T00:00:00Z', 'active'),
      (100, 2, 60, '2026-01-01T00:00:00Z', 'superseded');
  `);
  return { sqlite, db };
}

function hold(sqlite: DatabaseSync, clubId: number, amount: number, refType: string, refId: number): void {
  sqlite
    .prepare(
      `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
       VALUES (?, ?, 'held', ?, ?, '2026-01-01T00:00:00Z')`,
    )
    .run(clubId, amount, refType, refId);
}

function setK(sqlite: DatabaseSync, value: string | null): void {
  sqlite.exec("DELETE FROM config WHERE key = 'expected_income_rate'");
  if (value !== null) {
    sqlite.prepare("INSERT INTO config (key, value, updated_at) VALUES ('expected_income_rate', ?, '2026-01-01T00:00:00Z')").run(value);
  }
}

/** 一条 pending 报价单（买方 = 俱乐部 1，卖方 = 俱乐部 3），冻结额必须等于 amount */
function seedOffer(sqlite: DatabaseSync, amount = 45): void {
  sqlite
    .prepare(
      `INSERT INTO offers (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at)
       VALUES (1, 12, 1, 3, ?, ?, 0, 'pending', 'seller', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(amount, amount);
}

/** 一个收标中的暗标批次 + 俱乐部 1 的一份标（签入费 = fee × 0.3） */
function seedSea(sqlite: DatabaseSync, fee = 150): void {
  sqlite.exec(`
    INSERT INTO sea_batches (id, season, window_seq, status, deadline_at, created_at)
      VALUES (1, 1, 1, 'sealed', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
  sqlite
    .prepare(
      `INSERT INTO sea_sealed_bids (id, batch_id, player_id, club_id, new_release_fee, status)
       VALUES (1, 1, 12, 1, ?, 'sealed')`,
    )
    .run(fee);
}

describe('预期收入额度公式（设计 §1）', () => {
  it('源①：挂牌最高 active 出价按分段累进税后计入（90m → 税 9 → 净 81）', async () => {
    const { db } = setup();
    expect(await availableBalance(db, 1)).toBe(81);
    expect(await expectedIncomeBreakdown(db, 1)).toEqual([
      { source: 'listing', refId: 100, playerId: 11, gross: 90, tax: 9, net: 81 },
    ]);
    // 没有在途卖人的俱乐部额度为 0（买方不会被卖方的额度带飞）
    expect(await availableBalance(db, 2)).toBe(0);
  });

  it('源②：只认成交类（transfer/activation/forced_auction）；rc_change 等四类一律不计', async () => {
    const { sqlite, db } = setup();
    // rc_change 交 30% 新老差额也能挂出 pending_review，而 fee 写的是新违约金 —— 不筛类型就是假额度
    sqlite.exec(`
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at) VALUES
        ('rc_change', 11, 1, 1, 500, 'pending_review', '2026-01-01T00:00:00Z'),
        ('match', 11, 1, 1, 500, 'pending_review', '2026-01-01T00:00:00Z'),
        ('free_agent', 11, 1, 2, 500, 'pending_review', '2026-01-01T00:00:00Z'),
        ('termination', 11, 1, 2, 500, 'pending_review', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 1)).toBe(81);

    // 换成真成交单：500 元按分段累进（10 + 10 + 140 = 160 税）→ 净 340，盖掉同球员的 81
    sqlite.exec("UPDATE transfers SET type = 'transfer', to_club_id = 2 WHERE type = 'rc_change'");
    expect(await availableBalance(db, 1)).toBe(340);
    // 落空（驳回）后额度自动收缩
    sqlite.exec("UPDATE transfers SET status = 'rejected'");
    expect(await availableBalance(db, 1)).toBe(81);
  });

  it('同一球员多源只取毛额最高的一份（同一份未来收入不重复计）', async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at) VALUES
        ('transfer', 11, 1, 2, 50, 'pending_review', '2026-01-01T00:00:00Z'),
        ('transfer', 11, 1, 3, 70, 'signing', '2026-01-01T00:00:00Z');
    `);
    // 挂牌 90（净 81）仍是最高；70（净 63）与 50（净 45）都不叠
    expect(await availableBalance(db, 1)).toBe(81);
    sqlite.exec("UPDATE listings SET status = 'delisted' WHERE id = 100");
    expect(await availableBalance(db, 1)).toBe(63);
  });

  // TC-B-003 源②：forced_auction 按 auction_tax_rate 整单税率（0.5）——100m 净 50；
  // 漏 forced 分支会按分段累进算成净 90（税 10），额度虚高 40
  it('源②：transfers type=forced_auction 整单税率（100m → 净 50，不是分段累进的 90）', async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`
      UPDATE listings SET status = 'delisted' WHERE id = 100;
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at) VALUES
        ('forced_auction', 11, 1, 2, 100, 'pending_review', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 1)).toBe(50);
    expect(await expectedIncomeBreakdown(db, 1)).toEqual([
      { source: 'transfer', refId: expect.any(Number), playerId: 11, gross: 100, tax: 50, net: 50 },
    ]);
  });

  // TC-B-005b 正路径：activation 成交单是签入方付给卖方的激活费，计入（净 = fee × 0.9，RC 100 首段）。
  // 与「源① activation 挂牌排除」（本文件 :171 组）互补：挂牌不算、成单才算。
  it('源②：transfers type=activation 正路径计入（90m → 税 9 → 净 81）', async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`
      UPDATE listings SET status = 'delisted' WHERE id = 100;
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at) VALUES
        ('activation', 11, 1, 2, 90, 'pending_review', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 1)).toBe(81);
  });

  // TC-B-004：分段累进按现行 active 合同的 RC 预算——is_active=0 的合同不进预算。
  // contracts 对 player_id 有 UNIQUE（一球员一行合同），两态用同一行切：
  // ① is_active=0（RC 500 不认账）⇒ RC=0 ⇒ 税 20 / 净 30——误取它得税 5 / 净 45，断言即红；
  // ② 改回 is_active=1 且 RC=30 ⇒ transferTax(50,30) = 3+3+2 = 8（与 src/core/tax.test.ts 同值）⇒ 净 42。
  it('源②：分段税只认 is_active=1 的合同 RC（is_active=0 不进预算）', async () => {
    const { sqlite, db } = setup();
    sqlite.exec(`
      UPDATE listings SET status = 'delisted' WHERE id = 100;
      INSERT INTO players (id, uid, name, club_id, status, ca, pa) VALUES (14, 'u14', '丁', 1, 'normal', 70, 80);
      INSERT INTO contracts (player_id, club_id, release_fee, wage, is_active) VALUES (14, 1, 500, 1, 0);
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at) VALUES
        ('transfer', 14, 1, 2, 50, 'pending_review', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 1)).toBe(30);
    // 合同转正（is_active=1，RC 30）：税 8 ⇒ 净 42
    sqlite.exec("UPDATE contracts SET is_active = 1, release_fee = 30 WHERE player_id = 14");
    expect(await availableBalance(db, 1)).toBe(42);
  });

  it('强制拍卖按 auction_tax_rate 整单税率（100m → 净 50m，不是分段累进的 90m）', async () => {
    const { sqlite, db } = setup();
    // 一名球员只能有一单活跃挂牌（idx_listings_active_player）⇒ 先把 200 下架再挂强制拍卖
    sqlite.exec(`
      UPDATE listings SET status = 'delisted' WHERE id = 200;
      INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at)
        VALUES (101, 12, 3, 'forced', 100, 'bidding', '2026-01-01T00:00:00Z');
      INSERT INTO bids (listing_id, club_id, amount, created_at, status)
        VALUES (101, 2, 100, '2026-01-01T00:00:00Z', 'active');
    `);
    expect(await expectedIncomeBreakdown(db, 3)).toEqual([
      { source: 'listing', refId: 101, playerId: 12, gross: 100, tax: 50, net: 50 },
    ]);
    expect(await availableBalance(db, 3)).toBe(50);
  });

  it("k 键：缺行按 1.0、写 0.5 按 0.5、写非法值 'abc' 归 0（钳制式，fail 严格方向）", async () => {
    const { sqlite, db } = setup();
    expect(await availableBalance(db, 1)).toBe(81);
    setK(sqlite, '0.5');
    expect(await availableBalance(db, 1)).toBe(40.5);
    setK(sqlite, 'abc');
    expect(await availableBalance(db, 1)).toBe(0);
    setK(sqlite, '2');
    expect(await availableBalance(db, 1)).toBe(81); // 上限钳到 1
    setK(sqlite, null);
    expect(await availableBalance(db, 1)).toBe(81);
    // TC-B-007 钳制矩阵补格（全部走 SQL CAST 语义，不许应用层用 JS Number 静默兜 1.0）：
    // '' → CAST=0 → 0；'-1' → CAST=-1 → 钳到 0；' 0.5 ' / '0.5abc' → 前缀解析 0.5；
    // '0' → 0。'0.5abc' 是哨兵格：JS Number('0.5abc')=NaN，兜 1.0 会得 81（两层打架）。
    setK(sqlite, '');
    expect(await availableBalance(db, 1)).toBe(0);
    setK(sqlite, '-1');
    expect(await availableBalance(db, 1)).toBe(0);
    setK(sqlite, ' 0.5 ');
    expect(await availableBalance(db, 1)).toBe(40.5);
    setK(sqlite, '0.5abc');
    expect(await availableBalance(db, 1)).toBe(40.5);
    setK(sqlite, '0');
    expect(await availableBalance(db, 1)).toBe(0);
  });

  it('balanceSnapshot 三字段同源：expectedIncome 未乘 k、creditLine 乘 k、available 合成', async () => {
    const { sqlite, db } = setup();
    setK(sqlite, '0.5');
    hold(sqlite, 1, 40, 'listing', 200);
    expect(await balanceSnapshot(db, 1)).toEqual({
      balance: 0,
      held: 40,
      expectedIncome: 81,
      creditLine: 40.5,
      available: 0.5,
    });
  });

  it('源①：listed 无出价计零；activation 挂牌与 matched_pending 一律排除', async () => {
    const { sqlite, db } = setup();
    // 200 是 club3 的 listed 挂牌但没有 active 出价 ⇒ 流拍方向不计（下架费是负收益，不是收入）
    expect(await expectedIncomeBreakdown(db, 3)).toEqual([]);
    // activation 挂牌：即使有 active 出价、type 也不是 forced ⇒ 仍排除（激活是签入方掏钱，不产生卖方收入）
    sqlite.exec(`
      UPDATE listings SET status = 'delisted' WHERE id = 200;
      INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at)
        VALUES (202, 12, 3, 'activation', 40, 'bidding', '2026-01-01T00:00:00Z');
      INSERT INTO bids (listing_id, club_id, amount, created_at, status)
        VALUES (202, 2, 50, '2026-01-01T00:00:00Z', 'active');
    `);
    expect(await expectedIncomeBreakdown(db, 3)).toEqual([]);
    // matched_pending（匹配等待窗）：冻结已进待审/匹配，不再算在途挂牌收入
    sqlite.exec("UPDATE listings SET status = 'matched_pending' WHERE id = 202");
    expect(await expectedIncomeBreakdown(db, 3)).toEqual([]);
    // 换回普通挂牌 + bidding 才计入（50 → 税 5 → 净 45）
    sqlite.exec("UPDATE listings SET status = 'bidding', type = 'normal' WHERE id = 202");
    expect(await expectedIncomeBreakdown(db, 3)).toEqual([
      { source: 'listing', refId: 202, playerId: 12, gross: 50, tax: 5, net: 45 },
    ]);
  });
});

// 落空路径零接线：额度是实时公式，来源终态即缩水；已花出去的部分把可用压成负数（负=欠款）
describe('自然收缩（设计 §2.4）', () => {
  it('驳回后可用转负，挡下一条不同单的冻结', async () => {
    const { sqlite, db } = setup();
    // 在途收入改走源②（待审成交单）：90m → 税 9 → 净 81
    sqlite.exec(`
      UPDATE listings SET status = 'delisted' WHERE id = 100;
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at)
        VALUES ('transfer', 11, 1, 2, 90, 'pending_review', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 1)).toBe(81);
    hold(sqlite, 1, 81, 'listing', 200); // 用满额度（200 是 club3 的挂牌，首价 81 ≥ 40）
    sqlite.exec("UPDATE transfers SET status = 'rejected' WHERE from_club_id = 1"); // 审核驳回
    expect(await availableBalance(db, 1)).toBe(-81);
    // 换一单（无旧冻结可回加）：哪怕只要 1m 也被拒
    expect(() => hold(sqlite, 1, 1, 'listing', 201)).toThrow('WHL_BID_REJECT_FUNDS');
  });

  it('来源落空只缩额度，不动已 held 的冻结', async () => {
    const { sqlite, db } = setup();
    hold(sqlite, 1, 40, 'listing', 200);
    sqlite.exec("UPDATE listings SET status = 'delisted' WHERE id = 100");
    expect(sqlite.prepare('SELECT amount, status FROM fund_holds WHERE club_id = 1 ORDER BY id').all()).toEqual([
      { amount: 40, status: 'held' },
    ]);
    expect(await availableBalance(db, 1)).toBe(-40);
  });

  it('抬价：额度收缩后「旧冻结回加」仍按净差额放行', async () => {
    const { sqlite, db } = setup();
    // club3 的在途卖人收入：200 上 club2 出价 70（RC100 → 税 7 → 净 63）
    sqlite.exec(`
      INSERT INTO bids (listing_id, club_id, amount, created_at, status)
        VALUES (200, 2, 70, '2026-01-01T00:00:00Z', 'active');
      INSERT INTO players (id, uid, name, club_id, status, ca, pa) VALUES (14, 'u14', '丁', 1, 'normal', 70, 80);
      INSERT INTO contracts (player_id, club_id, release_fee, wage, is_active) VALUES (14, 1, 100, 1, 1);
      INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at)
        VALUES (203, 14, 1, 'normal', 20, 'listed', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 3)).toBe(63);
    hold(sqlite, 3, 62, 'listing', 203); // 靠额度冻 62
    // 抬到 63：0 − 62 + 62（旧冻结回加）+ 63（额度）= 63 ≥ 63；漏回加只有 1m，这条会 409
    hold(sqlite, 3, 63, 'listing', 203);
    // 出价批里新冻结先落、旧冻结随后释放（market.ts 的顺序）
    sqlite.exec('UPDATE fund_holds SET status = \'released\' WHERE club_id = 3 AND amount = 62');
    // 额度落空后旧冻结照样回加：0 − 63 + 63 + 0 = 0 < 64 ⇒ 拒
    sqlite.exec("UPDATE listings SET status = 'delisted' WHERE id = 200");
    expect(await availableBalance(db, 3)).toBe(-63);
    expect(() => hold(sqlite, 3, 64, 'listing', 203)).toThrow('WHL_BID_REJECT_FUNDS');
  });

  it('审核改 fee：源②额度跟随 transfers.fee 重算净额', async () => {
    const { sqlite, db } = setup();
    sqlite.exec("UPDATE listings SET status = 'delisted' WHERE id = 100");
    sqlite.exec(`
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, created_at)
        VALUES ('transfer', 11, 1, 2, 100, 'pending_review', '2026-01-01T00:00:00Z');
    `);
    expect(await availableBalance(db, 1)).toBe(90); // RC100：10% → 税 10
    sqlite.exec("UPDATE transfers SET fee = 200 WHERE from_club_id = 1");
    expect(await availableBalance(db, 1)).toBe(160); // 10 + 10 + 20 = 税 40
  });
});

describe('0081 触发器同源锁（三个资金闸）', () => {
  it('三个触发器都装了额度式（MIGRATION_FILES 追加的迁移确实跑了）', () => {
    const { sqlite } = setup();
    for (const name of TRIGGERS) {
      const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) as
        | { sql: string }
        | undefined;
      expect(row?.sql, name).toContain('expected_income_rate');
    }
  });

  it('额度足放行、无额度拒绝；来源落空后同一笔冻结被拒（应用层与触发器同值）', async () => {
    const { sqlite, db } = setup();
    expect(await availableBalance(db, 1)).toBe(81);
    // 俱乐部 1 用额度出价 45（首价 ≥ 挂牌价 40）→ 放行
    hold(sqlite, 1, 45, 'listing', 200);
    expect(await availableBalance(db, 1)).toBe(36);
    // 俱乐部 2 没有在途卖人 → 同样的 45 被触发器拒
    expect(() => hold(sqlite, 2, 45, 'listing', 200)).toThrow('WHL_BID_REJECT_FUNDS');

    // 来源落空：额度归零，可用转负（负=欠款），解冻后回到 0，新冻结仍被拒
    sqlite.exec("UPDATE listings SET status = 'delisted' WHERE id = 100");
    expect(await availableBalance(db, 1)).toBe(-45);
    sqlite.exec("UPDATE fund_holds SET status = 'released' WHERE club_id = 1");
    expect(await availableBalance(db, 1)).toBe(0);
    expect(() => hold(sqlite, 1, 45, 'listing', 200)).toThrow('WHL_BID_REJECT_FUNDS');
  });

  it("config 缺 expected_income_rate 按 1.0、写 'abc' 按 0：可用余额与三个触发器两层一致", async () => {
    // k 缺行 = 1.0：三个资金闸各自在满额 81 下放行（每闸单独一套环境，互不吃掉对方的冻结）
    {
      const { sqlite } = setup();
      hold(sqlite, 1, 45, 'listing', 200);
    }
    {
      const { sqlite } = setup();
      seedOffer(sqlite);
      hold(sqlite, 1, 45, 'offer', 1);
    }
    {
      const { sqlite } = setup();
      seedSea(sqlite);
      hold(sqlite, 1, 45, 'sea_sealed', 1);
    }

    // k='abc' → 钳制式归 0（不是回落 1.0）：可用余额为 0，三闸统一按无额度拒绝
    const { sqlite, db } = setup();
    seedOffer(sqlite);
    seedSea(sqlite);
    setK(sqlite, 'abc');
    expect(await availableBalance(db, 1)).toBe(0);
    expect(() => hold(sqlite, 1, 45, 'listing', 200)).toThrow('WHL_BID_REJECT_FUNDS');
    expect(() => hold(sqlite, 1, 45, 'offer', 1)).toThrow('WHL_OFFER_REJECT_FUNDS');
    expect(() => hold(sqlite, 1, 45, 'sea_sealed', 1)).toThrow('WHL_SEA_REJECT_FUNDS');
  });

  it('非资金闸逐字不变：offer 的 CLOSED/AMOUNT、bid 的 AMOUNT、sea 的 AMOUNT 仍按原错误码拦截', () => {
    const { sqlite } = setup();
    seedOffer(sqlite);
    seedSea(sqlite);
    // bid 首价低于挂牌价（额度足够也要拦）
    expect(() => hold(sqlite, 1, 39, 'listing', 200)).toThrow('WHL_BID_REJECT_AMOUNT');
    // offer 金额与单子不一致 / 单子已非 pending
    expect(() => hold(sqlite, 1, 44, 'offer', 1)).toThrow('WHL_OFFER_REJECT_AMOUNT');
    sqlite.exec("UPDATE offers SET status = 'withdrawn' WHERE id = 1");
    expect(() => hold(sqlite, 1, 45, 'offer', 1)).toThrow('WHL_OFFER_REJECT_CLOSED');
    // sea 金额不是 30% / 批次已开标
    expect(() => hold(sqlite, 1, 44, 'sea_sealed', 1)).toThrow('WHL_SEA_REJECT_AMOUNT');
    sqlite.exec("UPDATE sea_batches SET status = 'opened' WHERE id = 1");
    expect(() => hold(sqlite, 1, 45, 'sea_sealed', 1)).toThrow('WHL_SEA_REJECT_CLOSED');
  });

  it('0063 的 offer 非资金闸文本在 0081 里逐字保留；deadline 闸没被重建', () => {
    const mig81 = norm(readMig('0081_expected_income_credit_line.sql'));
    const mig63 = norm(readMig('0063_offers_intent.sql'));
    const closedLock = norm(`SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_CLOSED')
      WHERE IFNULL((SELECT status FROM offers WHERE id = NEW.ref_id), '') != 'pending';`);
    const amountLock = norm(`SELECT RAISE(ABORT, 'WHL_OFFER_REJECT_AMOUNT')
      WHERE NEW.amount != (SELECT amount FROM offers WHERE id = NEW.ref_id);`);
    // 原迁移里在 + 0081 重建后也在（漏抄/改写会让设计 A 的既有断言大面积假红）
    expect(mig63).toContain(closedLock);
    expect(mig63).toContain(amountLock);
    expect(mig81).toContain(closedLock);
    expect(mig81).toContain(amountLock);
    // deadline 闸（0040/0059）不在本轮修复面，0081 不得碰它
    expect(mig81).not.toContain('fund_holds_bid_deadline_guard');
  });

  it('NULL 可达闸位包死：幽灵挂牌 / 无账本行 / 幽灵海捞标一律拒（旧版比较得 NULL 会放行）', () => {
    const { sqlite } = setup();
    expect(() => hold(sqlite, 2, 1, 'listing', 999)).toThrow('WHL_BID_REJECT_CLOSED');
    // 俱乐部 9 没有账本行：余额按 0 算，不能因为 NULL 比较而放行
    expect(() => hold(sqlite, 9, 5, 'listing', 201)).toThrow('WHL_BID_REJECT_FUNDS');
    expect(() => hold(sqlite, 2, 0.3, 'sea_sealed', 777)).toThrow('WHL_SEA_REJECT_CLOSED');
  });

  it('文本锁：0081 内嵌的额度片段与 ledger.ts 逐字同源（三份）', () => {
    const mig81 = norm(readMig('0081_expected_income_credit_line.sql'));
    const frag = norm(creditLineSql('NEW.club_id'));
    expect(mig81.split(frag)).toHaveLength(4); // 出现 3 次 ⇒ split 出 4 段
  });

  // TC-B-018：额度子查询的写放大最坏情况——三个来源基表都必须走索引（SEARCH），不得全表 SCAN。
  // 依赖索引：idx_transfers_from（from_club_id）/ idx_listings_seller（seller_club_id）/
  // idx_bids_listing_amount（listing_id, amount）——0001_init.sql 建表时在场，删索引即红。
  // 行读量级（登记口径，不设硬线）：子查询按 from_club_id/seller_club_id 点筛 + 每挂牌一次
  // bids 索引取 MAX，长历史队（200 笔终态单）行读 ≈ 在途单数 × 常数，不随历史总量线性增长；
  // 生产量级登记归 scripts/d1-read-audit/ 的探针体系，本条只锁「不得 SCAN」的结构性底线。
  it('额度子查询 EXPLAIN QUERY PLAN：三来源基表全走索引，无 SCAN transfers/listings/bids', async () => {
    const { db } = setup();
    const credit = creditLineGuard(1);
    const plan = (
      await db.prepare(`EXPLAIN QUERY PLAN SELECT ${credit.sql}`).bind(...credit.params).all()
    ).results as { detail: string }[];
    expect(plan.length).toBeGreaterThan(0);
    const details = plan.map((r) => r.detail).join('\n');
    // EXPLAIN 文本里基表以别名出现（t/l/b），锚「USING INDEX <索引名>」：索引被删时 SQLite
    // 回落 SCAN，对应 USING INDEX 断言即红——等价于「无 SCAN transfers/listings/bids」。
    expect(details, 'transfers 侧必须走 idx_transfers_from').toContain('USING INDEX idx_transfers_from');
    expect(details, 'listings 侧必须走 idx_listings_seller').toContain('USING INDEX idx_listings_seller');
    expect(details, 'bids 侧必须走 idx_bids_listing_amount').toContain('USING INDEX idx_bids_listing_amount');
  });
});

// TC-B-038（§2.4 落空表第 2 行，P0）：签约谈判作废 / 静默超时后额度归零且源①不复活。
// 三向合取是必要的：只改 transfers 不改 listing，额度会以源①形态复活；只撤 bids 不 delisted，
// 源①虽归零但名单残留。夹具顺序照 tests/expiry-ops.test.ts 的 seedSigning：先 listed（
// fund_holds_bid_guard 只认 listed/bidding）→ 冻结 → 出价 → 再改 pending_review。
describe('TC-B-038 签约谈判落空（作废 / 静默超时 → 额度归零且源①不复活）', () => {
  function seedSigningDeal(): { sqlite: DatabaseSync; db: D1Database } {
    const { sqlite, db } = createTestDb();
    sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status, created_at) VALUES
        (1, '卖方', 'premier', 'active', '2026-01-01T00:00:00Z'),
        (2, '买方', 'premier', 'active', '2026-01-01T00:00:00Z'),
        (3, '第三方', 'premier', 'active', '2026-01-01T00:00:00Z');
      INSERT INTO players (id, uid, name, club_id, status, ca, pa) VALUES
        (21, 'u21', '成交中', 1, 'listed', 100, 120),
        (22, 'u22', '旁证', 3, 'normal', 80, 90);
      INSERT INTO contracts (player_id, club_id, release_fee, wage, is_active) VALUES
        (21, 1, 100, 1, 1), (22, 3, 100, 1, 1);
      INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
        (1, 0, '2026-01-01T00:00:00Z'), (2, 100, '2026-01-01T00:00:00Z'), (3, 0, '2026-01-01T00:00:00Z');
      -- 主链：卖方 1 的挂牌被买 2 出价 100，收标成单（pending_review）——买 2 的 100 是自有现金，
      -- 插冻结时 fund_holds_bid_guard 要考买方资金；卖方 1 保持 0，额度断言才干净
      INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at) VALUES
        (300, 21, 1, 'normal', 10, 'listed', '2026-01-01T00:00:00Z');
      INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at) VALUES
        (301, 2, 100, 'held', 'listing', 300, '2026-01-01T00:00:00Z');
      INSERT INTO bids (id, listing_id, club_id, amount, created_at, status, hold_id) VALUES
        (301, 300, 2, 100, '2026-01-01T00:00:00Z', 'active', 301);
      UPDATE listings SET status = 'pending_review' WHERE id = 300;
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
        VALUES (300, 'transfer', 21, 1, 2, 100, 'pending_review', 1, 1, 'listing:300', '2026-01-01T00:00:00Z');
      -- 旁证挂牌：作废后用「还能不能靠额度冻钱」证明额度真的归零（amount ≥ ask，只考资金闸）
      INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at) VALUES
        (310, 22, 3, 'normal', 40, 'listed', '2026-01-01T00:00:00Z');
    `);
    return { sqlite, db };
  }

  /** 三向合取 + 额度归零 + 触发器拒绝（两态共用的断言体）；negotiations 三函数吃 Env（内部取 env.DB） */
  async function expectCollapsedToZero(sqlite: DatabaseSync, db: D1Database): Promise<void> {
    expect(sqlGet(sqlite, "SELECT status FROM transfers WHERE id = 300")).toMatchObject({ status: 'rejected' });
    // 源①不复活（一）：挂牌不在 ('listed','bidding') —— delisted 才断掉在途收入
    const listing = sqlGet<{ status: string }>(sqlite, "SELECT status FROM listings WHERE id = 300");
    expect(['listed', 'bidding']).not.toContain(listing!.status);
    // 源①不复活（二）：该挂牌出价全 withdrawn、买方冻结 released
    expect(
      sqlAll<{ status: string }>(sqlite, 'SELECT status FROM bids WHERE listing_id = 300').map((r) => r.status),
    ).toEqual(['withdrawn']);
    expect(
      sqlAll<{ status: string }>(sqlite, "SELECT status FROM fund_holds WHERE ref_type = 'listing' AND ref_id = 300").map((r) => r.status),
    ).toEqual(['released']);
    // 额度 90 → 0
    expect(await availableBalance(db, 1)).toBe(0);
    // 触发器方向：对旁证挂牌冻 45（amount ≥ ask 40，只考资金闸）——额度归零后被拒
    expect(() => hold(sqlite, 1, 45, 'listing', 310)).toThrow('WHL_BID_REJECT_FUNDS');
  }

  it('a) 签约谈判作废批（voidSigningCore）：signing → 三向合取 + 额度 90 → 0', async () => {
    const { sqlite, db } = seedSigningDeal();
    const env = { DB: db } as unknown as Env;
    // 计划入口：openNegotiationSession 把 pending_review 推到 signing（不带 fixedReleaseFee，不碰工资表）
    expect((await openNegotiationSession(env, 300, null)).status).toBe('signing');
    // fee 100，RC 100 首段 10% → 净 90 = 额度（k 缺省 1.0）
    expect(await availableBalance(db, 1)).toBe(90);
    // 作废前触发器放行（额度足）；随后清掉这笔测试冻结，不干扰后续断言
    expect(() => hold(sqlite, 1, 45, 'listing', 310)).not.toThrow();
    sqlite.exec('DELETE FROM fund_holds WHERE club_id = 1');

    const session = sqlGet<{ id: number }>(sqlite, 'SELECT id FROM negotiation_sessions WHERE transfer_id = 300');
    expect(session).toBeDefined();
    expect(
      await voidSigningCore(env, session!.id, {
        actor: null,
        origin: 'cron_tick',
        action: 'negotiation_timeout',
        deadlineNote: '签约谈判作废（测试）',
        reason: 'silence_timeout',
      }),
    ).toBe('done');
    await expectCollapsedToZero(sqlite, db);
  });

  it('b) 静默超时（closeSilentSessions 到期引擎）：anchor 早于 72h → 同一作废批收口，额度 90 → 0', async () => {
    const { sqlite, db } = seedSigningDeal();
    const env = { DB: db } as unknown as Env;
    expect((await openNegotiationSession(env, 300, null)).status).toBe('signing');
    expect(await availableBalance(db, 1)).toBe(90);
    // 静默锚点 = MAX(expiry_anchor_at, created_at, 末次 attempt)：openNegotiationSession 的
    // created_at 是真实 now，会把锚点顶到未来——两列一起打到过去（≤ cutoff = now − 72h）
    sqlite.exec("UPDATE negotiation_sessions SET expiry_anchor_at = '2026-01-01T00:00:00Z', created_at = '2026-01-01T00:00:00Z' WHERE transfer_id = 300");
    const closed = await closeSilentSessions(env, { origin: 'cron_tick', nowIso: '2026-01-05T00:00:00Z', closeAll: false, limit: 50, remindLeadHours: 24 });
    expect(closed).toBe(1);
    await expectCollapsedToZero(sqlite, db);
  });
});
