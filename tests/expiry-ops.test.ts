// 到期引擎测试（v6.49.0 增量 1）：报价回合时限 + 签约谈判静默超时 + 时段结束收口（close_inflight）。
// 验收口径见 memory/plan-v6.49.0-ops-schedule.md §4；设计见 memory/design-ops-schedule-expiry.md。
// 三条关键口径（改代码前先读这三行，别把设计当 bug 修）：
//   ① 存量宽限：expiry_anchor_at='' 的行首次扫描按 now 打标，历史 pending 不会在上线首 tick 被批量误杀；
//   ② closeAll 只看「有明确终点且已到」+ close_inflight：勾了就在途全收口（ops_end），不勾才按各自时限（deadline）；
//   ③ 提醒走 reminded_at 抢占：一次只发一条、只发给「轮到的一方」（报价）/ 签约方（谈判）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetOpsScheduleCache, saveOpsRow } from '../src/worker/ops-schedule.ts';
import { runExpiryTick } from '../src/worker/expiry-ops.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  resetOpsScheduleCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTourDb(),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    PUBLIC_CACHE_TTL_MS: '0',
  };
  return { env, sqlite };
}

function createTourDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (5, '教练戊', 'coach', 0, 0);`,
  );
  return createTestD1(sqlite);
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function seedWorld(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '拜仁', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES
      (1, 'uid1', '球员甲', 1, 'ST', 80, 85, 'normal', 11),
      (2, 'uid2', '球员乙', 2, 'CM', 75, 82, 'normal', 12),
      (3, 'uid3', '球员丙', 1, 'LB', 72, 80, 'normal', 13);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (2, 2, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (3, 1, 50, 2, 'formal', 'import', '2026-07-01', 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-01T00:00:00Z'), (2, 100, '2026-07-01T00:00:00Z');
  `);
}

// 一条 pending 报价：anchorHoursAgo = null ⇒ expiry_anchor_at=''（存量宽限路径）
// 顺序有讲究：先落 offers 再落 fund_holds —— fund_holds_offer_guard 会在 INSERT 冻结时校验报价仍 pending
// （另注：idx_offers_active_pair 唯一约束要求同一球员同一买方只能有一条 pending，多条种子要错开 playerId）
function seedOffer(fx: Fixture, opts: { id: number; ageHours: number; anchorHoursAgo: number | null; turn?: string; playerId?: number }): void {
  const turn = opts.turn ?? 'buyer';
  const playerId = opts.playerId ?? 1;
  const anchor = opts.anchorHoursAgo === null ? '' : hoursAgo(opts.anchorHoursAgo);
  fx.sqlite.exec(`
    INSERT INTO offers (id, player_id, buyer_club_id, seller_club_id, amount, init_amount, round, note, status, turn, hold_id, listing_id, season, window_seq, created_at, updated_at, resolved_at, expiry_anchor_at, reminded_at)
    VALUES (${opts.id}, ${playerId}, 2, 1, 30, 30, 1, '', 'pending', '${turn}', ${opts.id}, NULL, 1, 1, '${hoursAgo(opts.ageHours)}', '${hoursAgo(opts.ageHours)}', NULL, '${anchor}', '');
    INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at) VALUES (${opts.id}, 2, 30, 'held', 'offer', ${opts.id}, '${hoursAgo(opts.ageHours)}');
  `);
}

// 一单进入签约阶段的挂牌 + 谈判会话（voidSigningCore 需要的全套形状）
// 顺序：listing 先落成 listed（fund_holds_bid_guard 只认 listed/bidding）→ 冻结 → 出价 → 再改 pending_review
function seedSigning(fx: Fixture, opts: { sessionId: number; ageHours: number; anchorHoursAgo: number | null; attemptHoursAgo?: number }): void {
  const anchor = opts.anchorHoursAgo === null ? '' : hoursAgo(opts.anchorHoursAgo);
  fx.sqlite.exec(`
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES (9, 'uid9', '签约中', 2, 'GK', 70, 78, 'listed', 19);
    INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, last_bid_at, deadline_note, window_seq, season)
      VALUES (9, 9, 1, 'normal', 40, 'listed', '${hoursAgo(100)}', '2026-07-01', '${hoursAgo(90)}', '', 1, 1);
    INSERT INTO fund_holds (id, club_id, amount, status, ref_type, ref_id, created_at) VALUES (99, 2, 40, 'held', 'listing', 9, '${hoursAgo(90)}');
    INSERT INTO bids (id, listing_id, club_id, amount, created_at, status, hold_id) VALUES (9, 9, 2, 40, '${hoursAgo(90)}', 'active', 99);
    UPDATE listings SET status = 'pending_review' WHERE id = 9;
    INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
      VALUES (9, 'transfer', 9, 1, 2, 40, 'signing', 1, 1, 'listing:9', '${hoursAgo(90)}');
    INSERT INTO negotiation_sessions (id, transfer_id, player_id, club_id, release_fee, expected_wage, attempt_count, status, created_at, expiry_anchor_at, reminded_at)
      VALUES (${opts.sessionId}, 9, 9, 2, 40, 3, 0, 'active', '${hoursAgo(opts.ageHours)}', '${anchor}', '');
    ${
      opts.attemptHoursAgo === undefined
        ? ''
        : `INSERT INTO negotiation_attempts (session_id, attempt_no, offered_wage, eff_expected, result, created_at)
           VALUES (${opts.sessionId}, 1, 3, 3, 'fail', '${hoursAgo(opts.attemptHoursAgo)}');`
    }
  `);
}

describe('到期引擎：报价回合时限', () => {
  it('默认「不限制」+ 没有在途 = 零动作零错误', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out).toMatchObject({ closed: 0, reminded: 0, errors: [] });
    expect(out.byAdapter).toEqual({ offer: 0, negotiation: 0, sea_sealed: 0 });
  });

  it('超时报价过期：解冻 + offer_events(expire) + 审计 + 双方通知（reason=deadline）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 100, anchorHoursAgo: 100 }); // 48h 时限，100h 前就没动过
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(1);
    expect(out.byAdapter.offer).toBe(1);
    expect(out.errors).toEqual([]);

    const offer = sqlGet<{ status: string; resolved_at: string }>(fx.sqlite, 'SELECT * FROM offers WHERE id = 1');
    expect(offer!.status).toBe('expired');
    expect(offer!.resolved_at).not.toBeNull();
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM fund_holds WHERE id = 1')).toMatchObject({ status: 'released' });
    const event = sqlGet<{ kind: string; note: string }>(fx.sqlite, 'SELECT kind, note FROM offer_events WHERE offer_id = 1');
    expect(event!.kind).toBe('expire');
    expect(event!.note).toContain('超过 48 小时未回应');
    const audit = sqlGet<{ action: string; origin: string; actor: number | null }>(
      fx.sqlite,
      "SELECT action, origin, actor FROM audit_log WHERE target_type = 'offer' AND target_id = 1",
    );
    expect(audit).toMatchObject({ action: 'offer_expire', origin: 'cron_tick', actor: null });
    const clubs = sqlAll<{ club_id: number }>(fx.sqlite, "SELECT club_id FROM notifications WHERE template = 'offer_expired' ORDER BY club_id");
    expect(clubs.map((r) => r.club_id)).toEqual([1, 2]);
    const payload = sqlGet<{ payload: string }>(fx.sqlite, "SELECT payload FROM notifications WHERE template = 'offer_expired' LIMIT 1");
    expect(payload!.payload).toContain('超过时限没有回应');
  });

  it('存量宽限：expiry_anchor_at 为空的老行本轮只打标、不过期', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 100, anchorHoursAgo: null });
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(0);
    const row = sqlGet<{ status: string; expiry_anchor_at: string }>(fx.sqlite, 'SELECT status, expiry_anchor_at FROM offers WHERE id = 1');
    expect(row!.status).toBe('pending');
    expect(row!.expiry_anchor_at).not.toBe('');
  });

  it('未到点不动：10 小时前动过的报价留着', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 10, anchorHoursAgo: 10 });
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM offers WHERE id = 1')).toMatchObject({ status: 'pending' });
  });

  it('临近提醒：不足 24h 提醒一次、只发轮到的一方、重复 tick 不重发', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 30, anchorHoursAgo: 30, turn: 'buyer' }); // 距 48h 到点还剩 18h
    const first = await runExpiryTick(fx.env, 'cron_tick');
    expect(first).toMatchObject({ closed: 0, reminded: 1 });
    const rows = sqlAll<{ club_id: number; template: string; payload: string }>(fx.sqlite, "SELECT club_id, template, payload FROM notifications WHERE template = 'offer_deadline'");
    expect(rows.length).toBe(1);
    expect(rows[0].club_id).toBe(2); // turn=buyer ⇒ 只提醒买方
    expect(rows[0].payload).toContain('北京时间');
    expect(sqlGet<{ reminded_at: string }>(fx.sqlite, 'SELECT reminded_at FROM offers WHERE id = 1')!.reminded_at).not.toBe('');

    const second = await runExpiryTick(fx.env, 'cron_tick');
    expect(second.reminded).toBe(0);
  });
});

describe('到期引擎：时段结束收口（close_inflight）', () => {
  it('勾了 close_inflight：时段一到，在途报价全收口（含刚发起的新单）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 100, anchorHoursAgo: 100 });
    seedOffer(fx, { id: 2, ageHours: 0, anchorHoursAgo: 0, playerId: 3 }); // 刚发起，按自身时限远未到期
    await saveOpsRow(
      fx.env,
      'transfer_offer',
      { startAnchor: 'absolute', startAt: hoursAgo(200), endAnchor: 'absolute', endAt: hoursAgo(1), requiresWindow: false, closeInflight: true },
      1,
    );
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(2);
    const notes = sqlAll<{ note: string }>(fx.sqlite, 'SELECT note FROM offer_events ORDER BY offer_id');
    expect(notes.map((r) => r.note)).toEqual(['报价通道已结束，自动结束', '报价通道已结束，自动结束']);
    expect(sqlAll<{ payload: string }>(fx.sqlite, "SELECT payload FROM notifications WHERE template = 'offer_expired' LIMIT 1")[0].payload).toContain('报价通道已结束');

    // 幂等：再跑一轮没有可收口的了
    const again = await runExpiryTick(fx.env, 'cron_tick');
    expect(again.closed).toBe(0);
  });

  it('不勾 close_inflight：时段到了但新单留着，只有超时的按各自时限过期', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 100, anchorHoursAgo: 100 });
    seedOffer(fx, { id: 2, ageHours: 0, anchorHoursAgo: 0, playerId: 3 });
    await saveOpsRow(
      fx.env,
      'transfer_offer',
      { startAnchor: 'absolute', startAt: hoursAgo(200), endAnchor: 'absolute', endAt: hoursAgo(1), requiresWindow: false, closeInflight: false },
      1,
    );
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(1);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM offers WHERE id = 1')).toMatchObject({ status: 'expired' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM offers WHERE id = 2')).toMatchObject({ status: 'pending' });
  });

  it('随关窗止 + 没开窗 = 时段结束（勾 close_inflight 时同样收口）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    seedOffer(fx, { id: 1, ageHours: 0, anchorHoursAgo: 0 });
    await saveOpsRow(fx.env, 'transfer_offer', { startAnchor: 'window_open', startAt: null, endAnchor: 'window_close', endAt: null, requiresWindow: true, closeInflight: true }, 1);
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(1);
    expect(sqlGet<{ note: string }>(fx.sqlite, 'SELECT note FROM offer_events WHERE offer_id = 1')!.note).toBe('报价通道已结束，自动结束');
  });
});

describe('到期引擎：签约谈判静默超时', () => {
  it('静默 100h：会话作废 + 解冻 + 撤价 + 挂牌下架 + 球员还原 + 转会单驳回 + 双方通知', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedSigning(fx, { sessionId: 1, ageHours: 100, anchorHoursAgo: 100 });
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(1);
    expect(out.byAdapter.negotiation).toBe(1);

    expect(sqlGet<{ status: string; settled_at: string | null }>(fx.sqlite, 'SELECT status, settled_at FROM negotiation_sessions WHERE id = 1')).toMatchObject({ status: 'cancelled' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM fund_holds WHERE id = 99')).toMatchObject({ status: 'released' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM bids WHERE id = 9')).toMatchObject({ status: 'withdrawn' });
    const listing = sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = 9');
    expect(listing!.status).toBe('delisted');
    expect(listing!.deadline_note).toContain('超过 72 小时没有动作，自动作废');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 9')).toMatchObject({ status: 'normal' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 9')).toMatchObject({ status: 'rejected' });
    const audit = sqlGet<{ action: string; origin: string; actor: number | null }>(fx.sqlite, "SELECT action, origin, actor FROM audit_log WHERE target_type = 'negotiation' AND target_id = 1");
    expect(audit).toMatchObject({ action: 'negotiation_timeout', origin: 'cron_tick', actor: null });

    const clubs = sqlAll<{ club_id: number }>(fx.sqlite, "SELECT DISTINCT club_id FROM notifications WHERE template = 'negotiation_timeout' ORDER BY club_id");
    expect(clubs.map((r) => r.club_id)).toEqual([1, 2]); // 签约方 + 挂牌方
  });

  it('静默时钟被最近一次报价刷新：100h 前开的会话、10h 前报过价 ⇒ 不过期', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedSigning(fx, { sessionId: 1, ageHours: 100, anchorHoursAgo: 100, attemptHoursAgo: 10 });
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.closed).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM negotiation_sessions WHERE id = 1')).toMatchObject({ status: 'active' });
  });

  it('存量宽限 + 临近提醒：老会话本轮只打标，剩 18h 时提醒一次', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedSigning(fx, { sessionId: 1, ageHours: 100, anchorHoursAgo: null });
    const first = await runExpiryTick(fx.env, 'cron_tick');
    expect(first).toMatchObject({ closed: 0, reminded: 0 });
    expect(sqlGet<{ status: string; expiry_anchor_at: string }>(fx.sqlite, 'SELECT status, expiry_anchor_at FROM negotiation_sessions WHERE id = 1')).toMatchObject({ status: 'active' });

    // 手工把锚拨到 54h 前（距 72h 到点还剩 18h）⇒ 落进提醒窗口
    fx.sqlite.exec(`UPDATE negotiation_sessions SET expiry_anchor_at = '${hoursAgo(54)}', reminded_at = '' WHERE id = 1`);
    const second = await runExpiryTick(fx.env, 'cron_tick');
    expect(second).toMatchObject({ closed: 0, reminded: 1 });
    const rows = sqlAll<{ club_id: number }>(fx.sqlite, "SELECT club_id FROM notifications WHERE template = 'negotiation_deadline'");
    expect(rows.map((r) => r.club_id)).toEqual([2]); // 只提醒签约方
    const third = await runExpiryTick(fx.env, 'cron_tick');
    expect(third.reminded).toBe(0);
  });

  it('会话不在签约阶段（转会单已了结）⇒ 静默跳过，不报错', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedSigning(fx, { sessionId: 1, ageHours: 100, anchorHoursAgo: 100 });
    fx.sqlite.exec(`UPDATE transfers SET status = 'completed' WHERE id = 9`);
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out).toMatchObject({ closed: 0, errors: [] });
  });
});

describe('到期引擎：纪律与调度接入', () => {
  it('一个适配器炸了不拖垮另一个（各自 try/catch）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    fx.sqlite.exec('DROP TABLE offers');
    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toContain('offer:');
    expect(out.byAdapter.negotiation).toBe(0);
  });

  it('runSettleTick 第 5 步已接上：POST /api/cron/tick 的响应带 expiry 且真的收口', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedOffer(fx, { id: 1, ageHours: 100, anchorHoursAgo: 100 });
    const res = await app.request('/api/cron/tick', { method: 'POST', headers: { 'content-type': 'application/json' } }, fx.env);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; expiry: { closed: number; byAdapter: Record<string, number> } };
    expect(out.ok).toBe(true);
    expect(out.expiry.closed).toBe(1);
    expect(out.expiry.byAdapter.offer).toBe(1);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM offers WHERE id = 1')).toMatchObject({ status: 'expired' });
  });

  it('config 两键默认值就位：offer_turn_hours=48 / negotiation_silence_hours=72', () => {
    const fx = freshEnv();
    const rows = sqlAll<{ key: string; value: string }>(
      fx.sqlite,
      "SELECT key, value FROM config WHERE key IN ('offer_turn_hours', 'negotiation_silence_hours') ORDER BY key",
    );
    // 键可能只在 CONFIG_DEFAULTS 里（未落库）——落库与默认两条路径都要认
    const fromDb = new Map(rows.map((r) => [r.key, r.value]));
    expect(fromDb.get('offer_turn_hours') ?? '48').toBe('48');
    expect(fromDb.get('negotiation_silence_hours') ?? '72').toBe('72');
  });
});
