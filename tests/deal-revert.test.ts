// 交易撤销（v6.66.0 第 3 期 design §4）：审核通过即过户之后，「作废签约谈判」不再成立
// （人已经在买方队里，谈崩也抢不回来），取而代之的是把整笔交易回滚。
//
// 锁四件事：钱对称退回（税不退）、归属与合同按快照还原、三条硬闸（已结算 / 窗内 / 之后无新单）、
// 幂等与审计。这里直接调 revertDeal，不走 HTTP——路由层只做理由校验与分流（已由
// tests/market-routes.test.ts 的「谈判强制成交与作废」覆盖）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { revertDeal } from '../src/worker/deal-revert.ts';
import { resetConfigCache } from '../src/core/config.ts';

function fixture(): { env: Env; sqlite: DatabaseSync } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const env = { DB: createTestD1(sqlite), KV: new Map<string, string>() } as unknown as Env;
  return { env, sqlite };
}

const snapshot = {
  contract: {
    club_id: 1,
    wage: 2,
    release_fee: 20,
    contract_type: 'formal',
    source: 'auction',
    service_ticks: 0,
    protection_ticks: null,
    signed_at: '2026-06-01T00:00:00Z',
    signed_season: 3,
    signed_window_seq: 1,
    free_rc_change_used: 1,
    is_active: 1,
  },
  player: { club_id: 1, status: 'normal' },
  saleFromClubId: 1,
  baseTicks: 0,
  returnSnapshot: null,
  fee: 40,
  tax: 2,
};

// 过户完成后的状态：球员与合同都在买方（2），卖方（1）账上已收 40、买方已付 40。
function seedSettledDeal(sqlite: DatabaseSync, opts: { type?: string; snapshotJson?: string | null } = {}) {
  const type = opts.type ?? 'transfer';
  const snap = opts.snapshotJson === undefined ? JSON.stringify(snapshot) : opts.snapshotJson;
  sqlite.exec(`
    INSERT INTO clubs (id, name) VALUES (1, '卖方队'), (2, '买方队');
    INSERT INTO players (id, uid, name, club_id, status, position, age, ca, pa)
      VALUES (70, 'p70', '被卖的人', 2, 'normal', 'ST', 24, 100, 120);
    INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, source, is_active, effective_from)
      VALUES (70, 70, 2, 60, 5, 'formal', 'negotiation', 1, '2026-07-02');
    INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
      VALUES (501, '${type}', 70, 1, 2, 40, 'completed', 4, 1, 'listing:900', '2026-07-02T00:00:00Z');
    ${snap === null ? '' : `UPDATE transfers SET pre_settle_snapshot = '${snap}' WHERE id = 501;`}
    INSERT INTO negotiation_sessions (id, transfer_id, player_id, club_id, expected_wage, status, created_at)
      VALUES (601, 501, 70, 2, 5, 'active', '2026-07-02T00:00:00Z');
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-02T00:00:00Z'), (2, 50, '2026-07-02T00:00:00Z');
    INSERT INTO seasons (season, status) VALUES (4, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (4, 1, 'open', '2026-07-01T00:00:00Z');
  `);
}

const balanceOf = (sqlite: DatabaseSync, clubId: number) =>
  (sqlite.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?').get(clubId) as { balance: number }).balance;

describe('revertDeal（v6.66.0 交易撤销）', () => {
  it('换队类：钱对称退回、税不退、归属与合同按快照还原、会话关掉、单据落 reverted', async () => {
    const { env, sqlite } = fixture();
    seedSettledDeal(sqlite);

    expect(await revertDeal(env, 501, 1, '双方谈崩，退回原状')).toEqual({ status: 'reverted' });

    // 钱：买方拿回 40，卖方被收回 40（税 2 不退，等于卖方净承担）
    expect(balanceOf(sqlite, 2)).toBe(90);
    expect(balanceOf(sqlite, 1)).toBe(60);
    expect(
      sqlite.prepare("SELECT kind, amount FROM ledger_entries WHERE ref_type = 'transfer' AND ref_id = 501 ORDER BY kind").all(),
    ).toEqual([
      { kind: 'transfer_clawback', amount: -40 },
      { kind: 'transfer_refund', amount: 40 },
    ]);

    // 归属与合同：按快照回到卖方
    expect(sqlite.prepare('SELECT club_id, status FROM players WHERE id = 70').get()).toEqual({ club_id: 1, status: 'normal' });
    expect(
      sqlite.prepare('SELECT club_id, wage, release_fee, service_ticks, free_rc_change_used FROM contracts WHERE player_id = 70').get(),
    ).toEqual({ club_id: 1, wage: 2, release_fee: 20, service_ticks: 0, free_rc_change_used: 1 });

    // 单据与会话
    expect(sqlite.prepare('SELECT status, revert_reason FROM transfers WHERE id = 501').get()).toEqual({
      status: 'reverted',
      revert_reason: '双方谈崩，退回原状',
    });
    expect(sqlite.prepare('SELECT status FROM negotiation_sessions WHERE id = 601').get()).toEqual({ status: 'cancelled' });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'transfer_revert'").get()).toEqual({ n: 1 });
  });

  it('自由身签入撤销：没有卖方收款人，只退买方；快照无合同 ⇒ 造出来的合同行删掉', async () => {
    const { env, sqlite } = fixture();
    seedSettledDeal(sqlite, { type: 'free_agent', snapshotJson: JSON.stringify({ ...snapshot, contract: null, saleFromClubId: null, fee: 0 }) });

    expect(await revertDeal(env, 501, 1, '签入作废')).toEqual({ status: 'reverted' });
    expect(balanceOf(sqlite, 2)).toBe(50); // 真自由身签入本来就不付转会费，撤销也不动钱
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM contracts WHERE player_id = 70').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT club_id FROM players WHERE id = 70').get()).toEqual({ club_id: 1 });
  });

  it('幂等：同一单撤两次，第二次 already 且钱只退一次', async () => {
    const { env, sqlite } = fixture();
    seedSettledDeal(sqlite);
    await revertDeal(env, 501, 1, '第一次');
    expect(await revertDeal(env, 501, 1, '第二次')).toEqual({ status: 'already' });
    expect(balanceOf(sqlite, 2)).toBe(90);
  });

  it('三条硬闸：无理由 400 / 关窗 409 / 之后还有成交单 409 / 无快照 409 / 未结算 409', async () => {
    const noReason = fixture();
    seedSettledDeal(noReason.sqlite);
    await expect(revertDeal(noReason.env, 501, 1, '   ')).rejects.toThrow('撤销必须写明理由');

    const closed = fixture();
    seedSettledDeal(closed.sqlite);
    closed.sqlite.exec("UPDATE season_windows SET status = 'closed'");
    await expect(revertDeal(closed.env, 501, 1, '关窗后撤')).rejects.toThrow('窗口已关闭');

    const later = fixture();
    seedSettledDeal(later.sqlite);
    later.sqlite.exec(`
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
        VALUES (502, 'transfer', 70, 2, 3, 50, 'completed', 4, 1, 'listing:901', '2026-07-03T00:00:00Z');
    `);
    await expect(revertDeal(later.env, 501, 1, '抽梯子')).rejects.toThrow('之后还有一笔已成交的交易');

    const noSnap = fixture();
    seedSettledDeal(noSnap.sqlite, { snapshotJson: null });
    await expect(revertDeal(noSnap.env, 501, 1, '历史单')).rejects.toThrow('没有过户前快照');

    const notSettled = fixture();
    seedSettledDeal(notSettled.sqlite);
    notSettled.sqlite.exec("UPDATE transfers SET status = 'signing' WHERE id = 501");
    await expect(revertDeal(notSettled.env, 501, 1, '还没结算')).rejects.toThrow('只有已结算的交易才能撤销');
  });
});
