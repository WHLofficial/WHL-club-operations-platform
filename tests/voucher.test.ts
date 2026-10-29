// v6.58.0 消费券账务：存量搬运幂等 / voucherMovement 守卫与对账 / 幂等闸 / 现金账本隔离
// 用例对应 docs/test-plans/v6.58.0-shortlist-voucher.md（TC-V-001/002/003）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createTestD1, applyMigrations, runMigration, sqlAll, sqlGet } from './d1.ts';
import { voucherMovement, voucherBalance } from '../src/worker/voucher.ts';

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite, '0081_expected_income_credit_line.sql');
  sqlite.exec(`
    INSERT INTO clubs (id, name, status) VALUES (1, 'A 队', 'active'), (2, 'B 队', 'active'), (3, 'C 队', 'active');
    INSERT INTO stadiums (club_id, capacity, tier) VALUES (1, 20000, 0), (2, 20000, 0), (3, 20000, 0);
    UPDATE stadiums SET build_credit = 12.5 WHERE club_id = 1;
    UPDATE stadiums SET build_credit = 8 WHERE club_id = 3;
    INSERT INTO ledger_accounts (club_id, balance) VALUES (1, 100);
  `);
  runMigration(sqlite, '0082_vouchers_shortlist.sql');
  runMigration(sqlite, '0083_vouchers_backfill.sql');
  return { sqlite, db: createTestD1(sqlite) };
}

describe('TC-V-001 存量建设券搬运（迁移 0083）', () => {
  it('搬余额 + 补账户行 + 建 migrate 流水 + 清零旧列；重放不重复入账', () => {
    const { sqlite } = freshDb();
    const rows = sqlAll<{ club_id: number; balance: number; vouchers: number }>(
      sqlite,
      'SELECT club_id, balance, vouchers FROM ledger_accounts ORDER BY club_id',
    );
    expect(rows).toEqual([
      { club_id: 1, balance: 100, vouchers: 12.5 },
      { club_id: 3, balance: 0, vouchers: 8 },
    ]);
    expect(sqlAll<{ club_id: number; build_credit: number }>(sqlite, 'SELECT club_id, build_credit FROM stadiums ORDER BY club_id')).toEqual([
      { club_id: 1, build_credit: 0 },
      { club_id: 2, build_credit: 0 },
      { club_id: 3, build_credit: 0 },
    ]);
    const entries = sqlAll<{ club_id: number; amount: number; balance_after: number; kind: string }>(
      sqlite,
      'SELECT club_id, amount, balance_after, kind FROM voucher_entries ORDER BY club_id',
    );
    expect(entries).toEqual([
      { club_id: 1, amount: 12.5, balance_after: 12.5, kind: 'migrate' },
      { club_id: 3, amount: 8, balance_after: 8, kind: 'migrate' },
    ]);

    // 幂等重放：余额、流水、旧列都不再变化
    runMigration(sqlite, '0083_vouchers_backfill.sql');
    expect(
      sqlAll<{ club_id: number; vouchers: number }>(sqlite, 'SELECT club_id, vouchers FROM ledger_accounts ORDER BY club_id'),
    ).toEqual(rows.map((r) => ({ club_id: r.club_id, vouchers: r.vouchers })));
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM voucher_entries')?.n).toBe(2);
  });
});

describe('TC-V-002 voucherMovement 守卫与对账', () => {
  it('守卫不足整段空转（不动余额、不落流水）；足额扣减后 balance_after 可复算', async () => {
    const { sqlite, db } = freshDb();
    // 先给 club2 发 5 券（idempotent:false —— 主动发放可重复）
    await db.batch([
      ...voucherMovement(db, {
        clubId: 2,
        delta: 5,
        kind: 'admin_grant',
        refType: 'admin',
        refId: 1,
        memo: '发放 5',
        idempotent: false,
      }),
    ]);
    expect(await voucherBalance(db, 2)).toBe(5);

    // 余额 5 扣 8：守卫不通过，账户 changes=0、流水不落
    const blocked = await db.batch([
      ...voucherMovement(db, {
        clubId: 2,
        delta: -8,
        kind: 'build_use',
        refType: 'stadium',
        refId: 2,
        memo: '扣 8',
        idempotent: false,
        guardSql: '(SELECT COALESCE(vouchers, 0) FROM ledger_accounts WHERE club_id = ?) >= ?',
        guardParams: [2, 8],
      }),
    ]);
    expect(blocked[0]?.meta.changes).toBe(0);
    expect(await voucherBalance(db, 2)).toBe(5);

    // 足额扣 3：券余额 5→2，流水 balance_after=2
    await db.batch([
      ...voucherMovement(db, {
        clubId: 2,
        delta: -3,
        kind: 'build_use',
        refType: 'stadium',
        refId: 2,
        memo: '扣 3',
        idempotent: false,
      }),
    ]);
    expect(await voucherBalance(db, 2)).toBe(2);
    expect(
      sqlAll<{ amount: number; balance_after: number }>(sqlite, 'SELECT amount, balance_after FROM voucher_entries WHERE club_id = 2 ORDER BY id'),
    ).toEqual([
      { amount: 5, balance_after: 5 },
      { amount: -3, balance_after: 2 },
    ]);

    // 对账不变量：每俱乐部 vouchers == SUM(amount)；逐行 balance_after 可复算
    for (const row of sqlAll<{ club_id: number; vouchers: number }>(sqlite, 'SELECT club_id, vouchers FROM ledger_accounts')) {
      const sum = sqlGet<{ s: number }>(sqlite, 'SELECT COALESCE(SUM(amount), 0) AS s FROM voucher_entries WHERE club_id = ?', row.club_id);
      expect(row.vouchers).toBeCloseTo(sum?.s ?? 0, 6);
    }
    let running = 0;
    for (const e of sqlAll<{ amount: number; balance_after: number }>(sqlite, 'SELECT amount, balance_after FROM voucher_entries WHERE club_id = 2 ORDER BY id')) {
      running += e.amount;
      expect(e.balance_after).toBeCloseTo(running, 6);
    }

    // 现金账本不受券动作影响（club1 的 balance 恒 100）
    expect(sqlGet<{ balance: number }>(sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')?.balance).toBe(100);
  });
});

describe('TC-V-003 幂等闸（club 维度）', () => {
  it('同 (club, kind, ref) 连发两次只记一次；不同俱乐部各记各的', async () => {
    const { sqlite, db } = freshDb();
    const mk = (clubId: number) =>
      voucherMovement(db, { clubId, delta: 2, kind: 'shop_refund', refType: 'shop_order', refId: 77, memo: '同单单退' });
    await db.batch(mk(1));
    await db.batch(mk(1));
    await db.batch(mk(2));

    expect(sqlAll<{ club_id: number; amount: number }>(sqlite, 'SELECT club_id, amount FROM voucher_entries WHERE kind = \'shop_refund\' ORDER BY club_id')).toEqual([
      { club_id: 1, amount: 2 },
      { club_id: 2, amount: 2 },
    ]);
    expect(await voucherBalance(db, 1)).toBe(14.5); // 12.5 存量 + 2
  });
});
