// 条款落地（v6.66.0 第 3 期 design §3.2/§3.6）：审核通过时人已经过户、合同是占位的
// （wage/RC 0），签约谈判谈成后**只落条款**，不再第二次过户。这里锁三件事：
// 幂等（重放不会二次写）、上调（promotion）走「成约才结算」故拒绝、合同类型决定球员状态。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { applyContractTerms } from '../src/worker/transfers.ts';
import { resetConfigCache } from '../src/core/config.ts';

function fixture(): { env: Env; sqlite: DatabaseSync } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const env = { DB: createTestD1(sqlite), KV: new Map<string, string>() } as unknown as Env;
  return { env, sqlite };
}

// 过户刚完成、条款未定的样子：球员与占位合同都在买方（2）。
function seedPlaceholderDeal(sqlite: DatabaseSync, opts: { type?: string; snapshot?: unknown } = {}) {
  const type = opts.type ?? 'transfer';
  const snap = opts.snapshot === undefined ? null : JSON.stringify(opts.snapshot);
  sqlite.exec(`
    INSERT INTO clubs (id, name) VALUES (1, '卖方队'), (2, '买方队');
    INSERT INTO players (id, uid, name, club_id, status, position, age, ca, pa)
      VALUES (70, 'p70', '过户中的人', 2, 'normal', 'ST', 24, 100, 120);
    INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, source, is_active, effective_from)
      VALUES (70, 70, 2, 0, 0, 'formal', 'negotiation', 1, '2026-07-02');
    INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
      VALUES (501, '${type}', 70, 1, 2, 40, 'completed', 4, 1, 'listing:900', '2026-07-02T00:00:00Z');
    ${snap === null ? '' : `UPDATE transfers SET pre_settle_snapshot = '${snap}' WHERE id = 501;`}
    INSERT INTO seasons (season, status) VALUES (4, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (4, 1, 'open', '2026-07-01T00:00:00Z');
  `);
}

const contractRow = (sqlite: DatabaseSync) =>
  sqlite.prepare('SELECT club_id, wage, release_fee, contract_type, source FROM contracts WHERE player_id = 70').get();

describe('applyContractTerms（v6.66.0 只落条款，不再过户）', () => {
  it('谈成一次写入条款并置 terms_applied；再调一次 already 且不二次改写', async () => {
    const { env, sqlite } = fixture();
    seedPlaceholderDeal(sqlite);

    expect(await applyContractTerms(env, 501, { wage: 4.5, releaseFee: 60, source: 'negotiation', contractType: 'formal' }, 1)).toEqual({
      status: 'applied',
    });
    expect(contractRow(sqlite)).toEqual({ club_id: 2, wage: 4.5, release_fee: 60, contract_type: 'formal', source: 'negotiation' });
    expect(sqlite.prepare('SELECT terms_applied FROM transfers WHERE id = 501').get()).toEqual({ terms_applied: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'transfer_terms'").get()).toEqual({ n: 1 });

    // 重放（healSettlement / 并发第二次结算）必须什么都不改
    expect(await applyContractTerms(env, 501, { wage: 9, releaseFee: 99, source: 'negotiation', contractType: 'trainee' }, 1)).toEqual({
      status: 'already',
    });
    expect(contractRow(sqlite)).toEqual({ club_id: 2, wage: 4.5, release_fee: 60, contract_type: 'formal', source: 'negotiation' });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'transfer_terms'").get()).toEqual({ n: 1 });
  });

  it('训练营条款把球员翻回 trainee（过户那一步只能先按 normal 落位）', async () => {
    const { env, sqlite } = fixture();
    seedPlaceholderDeal(sqlite);

    await applyContractTerms(env, 501, { wage: 0.75, releaseFee: 5, source: 'trainee', contractType: 'trainee' }, 1);
    expect(sqlite.prepare('SELECT status FROM players WHERE id = 70').get()).toEqual({ status: 'trainee' });
    expect(contractRow(sqlite)).toMatchObject({ contract_type: 'trainee', wage: 0.75 });
  });

  it('上调单拒绝：promotion 没有审核步，成约那一刻才结算', async () => {
    const { env, sqlite } = fixture();
    seedPlaceholderDeal(sqlite, { type: 'promotion' });

    await expect(applyContractTerms(env, 501, { wage: 4, releaseFee: 30, source: 'negotiation', contractType: 'formal' }, 1)).rejects.toThrow(
      '上调单在成约时结算',
    );
    expect(contractRow(sqlite)).toMatchObject({ wage: 0, release_fee: 0 });
  });

  it('未结算单拒绝：只有 completed 才能落条款', async () => {
    const { env, sqlite } = fixture();
    seedPlaceholderDeal(sqlite);
    sqlite.exec("UPDATE transfers SET status = 'signing' WHERE id = 501");

    await expect(applyContractTerms(env, 501, { wage: 4, releaseFee: 30, source: 'negotiation', contractType: 'formal' }, 1)).rejects.toThrow(
      '不能落合同条款',
    );
  });
});
