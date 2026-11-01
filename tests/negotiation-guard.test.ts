// 「谈判在途」判据（v6.66.0 第 2 期）：全仓从 `transfers.status = 'signing'` 换成会话状态。
//
// 用例造的是 **翻转后的真实形状**——单据已经 completed（钱付了、人走了），只剩会话还在谈条款。
// 旧判据（signing）对这种形状一律返回「没人谈判」，8 处闸会静默失效；本文件锁住新判据。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import {
  ACTIVE_SESSION_SQL,
  findActiveNegotiationSession,
  findActivePromotionSession,
  findNegotiationInFlight,
} from '../src/worker/negotiation-guard.ts';
import { resetConfigCache } from '../src/core/config.ts';

function fixture(): { env: Env; sqlite: DatabaseSync } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const env = { DB: createTestD1(sqlite), KV: new Map<string, string>() } as unknown as Env;
  return { env, sqlite };
}

/** 一张已成交的单 + 一场还在谈的会话（v6.66.0 翻转后的常态）。 */
function seedSettledDealWithSession(sqlite: DatabaseSync, opts: { type?: string; sessionStatus?: string } = {}) {
  const type = opts.type ?? 'transfer';
  const sessionStatus = opts.sessionStatus ?? 'active';
  sqlite.exec(`
    INSERT INTO clubs (id, name) VALUES (1, '卖方队'), (2, '买方队')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO players (id, uid, name, club_id, status, position, age, ca, pa)
      VALUES (70, 'p70', '挂牌人', 2, 'normal', 'ST', 24, 100, 120)
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
      VALUES (501, '${type}', 70, 1, 2, 10, 'completed', 4, 1, 'test:501', '2026-07-02T00:00:00Z');
    INSERT INTO negotiation_sessions (id, transfer_id, player_id, club_id, expected_wage, status, created_at)
      VALUES (601, 501, 70, 2, 5, '${sessionStatus}', '2026-07-02T00:00:00Z');
  `);
}

describe('negotiation-guard（v6.66.0 判据：会话 active，不看单据状态）', () => {
  it('单据已 completed、会话仍 active ⇒ 判为谈判在途', async () => {
    const { env, sqlite } = fixture();
    seedSettledDealWithSession(sqlite);
    expect(await findActiveNegotiationSession(env.DB, 70)).toMatchObject({ id: 601 });
    expect(await findNegotiationInFlight(env.DB, 70)).toMatchObject({ id: 601 });
  });

  it('会话 settled / cancelled 后立刻放开', async () => {
    for (const status of ['settled', 'cancelled']) {
      const { env, sqlite } = fixture();
      seedSettledDealWithSession(sqlite, { sessionStatus: status });
      expect(await findActiveNegotiationSession(env.DB, 70)).toBeNull();
      expect(await findNegotiationInFlight(env.DB, 70)).toBeNull();
    }
  });

  it('上调锁只认 promotion 会话', async () => {
    const plain = fixture();
    seedSettledDealWithSession(plain.sqlite, { type: 'transfer' });
    expect(await findActivePromotionSession(plain.env.DB, 70)).toBeNull();

    const promo = fixture();
    seedSettledDealWithSession(promo.sqlite, { type: 'promotion' });
    expect(await findActivePromotionSession(promo.env.DB, 70)).toMatchObject({ id: 601 });
  });

  it('历史残留兜底：单据 signing 但会话还没建出来，仍算在途', async () => {
    const { env, sqlite } = fixture();
    seedSettledDealWithSession(sqlite, { sessionStatus: 'cancelled' });
    sqlite.exec(`UPDATE transfers SET status = 'signing' WHERE id = 501`);
    expect(await findActiveNegotiationSession(env.DB, 70)).toBeNull();
    expect(await findNegotiationInFlight(env.DB, 70)).toMatchObject({ id: 501 });
  });

  it('批量谓词与 helper 同口径（别名固定 s）', async () => {
    const { env, sqlite } = fixture();
    seedSettledDealWithSession(sqlite);
    const row = await env.DB.prepare(
      `SELECT s.id FROM negotiation_sessions s WHERE s.player_id = ? AND ${ACTIVE_SESSION_SQL} LIMIT 1`,
    )
      .bind(70)
      .first<{ id: number }>();
    expect(row).toMatchObject({ id: 601 });
  });
});
