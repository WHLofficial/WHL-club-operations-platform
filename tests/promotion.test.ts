// 上调 / 下放切片测试（v6.64.4，规则 4.3.4 名单段 × 合同类型双向挂钩）：
// 下放即时转训练营条款 + 名额/练满/匹配当窗例外；上调开谈判 + F 附加费 + 窗关强约 + 练满自动开；
// 解约冻结与自助取消。夹具与 ops-schedule.test.ts 同款（本地 SQLite + 真迁移）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetOpsScheduleCache } from '../src/worker/ops-schedule.ts';
import { resetSettleCoalesce } from '../src/worker/market-settle.ts';
import { TRAINEE_WAGE, TRAINEE_RC } from '../src/core/squad-rules.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

export function freshPromotionEnv(): Fixture {
  resetConfigCache();
  resetOpsScheduleCache();
  resetSettleCoalesce();
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
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [5, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, kv };
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

/**
 * 世界线：club 1（我的队）/ club 2（别队）。
 * 球员 1/2/3 = 我队正式合同一线队、可成长（1 号带保护期）；球员 4 = 练满（ca=pa）；
 * 球员 5 = 非成长；球员 6 = 我队训练营合同；球员 7 = 别队正式合同；球员 8 = 我队正式合同但有在途单。
 */
export function seedPromotionWorld(fx: Fixture, opts: { windowOpen?: boolean } = {}): void {
  const open = opts.windowOpen ?? true;
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '拜仁', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
      (1, 1, 'closed', 0, '2026-05-01T00:00:00Z', '2026-06-01T00:00:00Z');
    INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 2, '${open ? 'open' : 'closed'}', 0, '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status, fc_id) VALUES
      (1, 'uid1', '下放甲', 1, 'ST', 24, 80, 85, 1, 'normal', 11),
      (2, 'uid2', '下放乙', 1, 'CM', 23, 78, 84, 1, 'normal', 12),
      (3, 'uid3', '下放丙', 1, 'GK', 22, 76, 83, 1, 'normal', 13),
      (4, 'uid4', '练满丁', 1, 'ST', 25, 85, 85, 1, 'normal', 14),
      (5, 'uid5', '死木头', 1, 'CB', 28, 70, 70, 0, 'normal', 15),
      (6, 'uid6', '青训己', 1, 'ST', 18, 62, 80, 1, 'trainee', 16),
      (7, 'uid7', '别队庚', 2, 'CM', 24, 79, 86, 1, 'normal', 17),
      (8, 'uid8', '在途辛', 1, 'CM', 23, 77, 84, 1, 'normal', 18);
    INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, source, effective_from, protection_ticks, is_active) VALUES
      (1, 1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1, 1),
      (2, 2, 1, 40, 2, 'formal', 'import', '2026-07-01', NULL, 1),
      (3, 3, 1, 30, 2, 'formal', 'import', '2026-07-01', NULL, 1),
      (4, 4, 1, 60, 3, 'formal', 'import', '2026-07-01', NULL, 1),
      (5, 5, 1, 45, 2, 'formal', 'import', '2026-07-01', NULL, 1),
      (6, 6, 1, 5, 0.75, 'trainee', 'trainee', '2026-07-01', NULL, 1),
      (7, 7, 2, 55, 2, 'formal', 'import', '2026-07-01', NULL, 1),
      (8, 8, 1, 35, 2, 'formal', 'import', '2026-07-01', NULL, 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-01T00:00:00Z'), (2, 100, '2026-07-01T00:00:00Z');
    INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
      (1, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
      (2, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z');
  `);
}

export function send(env: Env, method: 'GET' | 'POST' | 'PUT', path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Cookie = `whl_session=${token}`;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

function demote(fx: Fixture, playerId: number, token = 'tok-coach') {
  return send(fx.env, 'POST', '/api/transfers/demote', { playerId }, token);
}

function promote(fx: Fixture, playerId: number, newReleaseFee: number, token = 'tok-coach') {
  return send(fx.env, 'POST', '/api/transfers/promotion', { playerId, newReleaseFee }, token);
}

// 激活证据制 key（模式见 activations.ts PROOF_KEY_PATTERN；key 内嵌激活方俱乐部 id）
const proofKey = (clubId: number) => `activation/${clubId}/t${Math.random().toString(36).slice(2, 8)}.png`;

describe('下放（正式合同 → 训练营条款，v6.64.4）', () => {
  it('TC-D1 下放成功：合同即转训练营条款、保护期清空、球员回训练营态、落 demote 履历行', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    const res = await demote(fx, 1);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; releaseFee: number; wage: number; transferId: number };
    expect(body).toMatchObject({ ok: true, releaseFee: TRAINEE_RC, wage: TRAINEE_WAGE });

    const contract = sqlGet<{ contract_type: string; release_fee: number; wage: number; source: string; protection_ticks: number | null; service_ticks: number; signed_at: string | null }>(
      fx.sqlite,
      'SELECT contract_type, release_fee, wage, source, protection_ticks, service_ticks, signed_at FROM contracts WHERE player_id = 1 AND is_active = 1',
    );
    expect(contract).toMatchObject({
      contract_type: 'trainee',
      release_fee: 5,
      wage: 0.75,
      source: 'demote',
      protection_ticks: null, // 训练营无保护期（下放后 5m 激活即按 1 倍）
    });
    // 效力保留：service_ticks / signed_at / effective_from 一字不动
    expect(contract?.signed_at).toBeNull(); // 夹具没写 signed_at，这里只锁没有被改写
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 1');
    expect(player).toEqual({ club_id: 1, status: 'trainee' });

    const transfer = sqlGet<{ type: string; status: string; from_club_id: number; to_club_id: number; season: number; window_seq: number }>(
      fx.sqlite,
      'SELECT type, status, from_club_id, to_club_id, season, window_seq FROM transfers WHERE type = \'demote\'',
    );
    expect(transfer).toMatchObject({ type: 'demote', status: 'completed', from_club_id: 1, to_club_id: 1, season: 1, window_seq: 2 });
    expect(sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'player_demote'")).toBeDefined();
  });

  it('TC-D2 名额每窗 2 名：第三个 409；名额按事件计（球员被再上调也不退）', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    expect((await demote(fx, 1)).status).toBe(201);
    expect((await demote(fx, 2)).status).toBe(201);
    const third = await demote(fx, 3);
    expect(third.status).toBe(409);
    expect(((await third.json()) as { error: string }).error).toContain('本窗下放名额（2 名）已用完');
  });

  it('TC-D3 练满 / 非成长球员不可下放（与 trainee_growth 对称）', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    const full = await demote(fx, 4);
    expect(full.status).toBe(400);
    expect(((await full.json()) as { error: string }).error).toContain('练满球员不能下放');
    const wood = await demote(fx, 5);
    expect(wood.status).toBe(400);
    expect(((await wood.json()) as { error: string }).error).toContain('练满球员不能下放');
  });

  it('TC-D4 本窗匹配留队的球员当窗不可下放；上一窗的匹配单不拦（事件判据按窗）', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, matched, season, window_seq, created_at)
       VALUES ('match', 1, 1, 1, 25, 'completed', 1, 1, 2, '2026-07-02T00:00:00Z')`,
    );
    const blocked = await demote(fx, 1);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toContain('本窗刚经匹配留队');

    // 上一窗（window_seq=1，已关）的匹配单不占本窗判据
    fx.sqlite.exec(`UPDATE transfers SET window_seq = 1 WHERE type = 'match'`);
    expect((await demote(fx, 1)).status).toBe(201);
  });

  it('TC-D5 保护期内可下放（下放后激活按 5m 一倍价）；训练营合同/训练营态球员下放 400', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    // 球员 1 夹具自带 protection_ticks=1 → 放行（TC-D1 断言 protection 清空）
    expect((await demote(fx, 1)).status).toBe(201);
    // 训练营态球员：状态闸先拦（「当前状态不能下放」）
    const traineeStatus = await demote(fx, 6);
    expect(traineeStatus.status).toBe(400);
    expect(((await traineeStatus.json()) as { error: string }).error).toContain('当前状态不能下放');
    // S9 存量形态（status=normal + trainee 合同）：合同类型闸拦——他已经领训练营条款了
    fx.sqlite.exec(`INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status, fc_id)
      VALUES (9, 'uid9', '存量壬', 1, 'CM', 22, 66, 82, 1, 'normal', 19)`);
    fx.sqlite.exec(`INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active)
      VALUES (9, 9, 1, 5, 0.75, 'trainee', 'trainee', '2026-07-01', 1)`);
    const legacyShape = await demote(fx, 9);
    expect(legacyShape.status).toBe(400);
    expect(((await legacyShape.json()) as { error: string }).error).toContain('已经在训练营了');
  });

  it('TC-D6 在途单据的球员不可下放；别队球员 400；关窗 409', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.sqlite.exec(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, created_at)
       VALUES ('rc_change', 8, 1, 1, 40, 'pending_review', 1, 2, '2026-07-02T00:00:00Z')`,
    );
    const inflight = await demote(fx, 8);
    expect(inflight.status).toBe(400);
    expect(((await inflight.json()) as { error: string }).error).toContain('正在等管理组审核');

    // 别队教练对我队球员 → 400「只能下放自己队里的球员」
    const foreign = await send(fx.env, 'POST', '/api/transfers/demote', { playerId: 1 }, 'tok-coach2');
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: string }).error).toContain('只能下放自己队里的球员');

    const closedFx = freshPromotionEnv();
    seedPromotionWorld(closedFx, { windowOpen: false });
    const noWindow = await demote(closedFx, 1);
    expect(noWindow.status).toBe(409);
    expect(((await noWindow.json()) as { code?: string }).code).toBe('no_window');
  });

  it('闸位收口：transfer_promotion 行到点止 → 409 op_closed（窗口仍开但时段已过）', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.sqlite.exec(
      `INSERT INTO ops_schedule (op_key, start_anchor, start_at, end_anchor, end_at, requires_window, close_inflight)
       VALUES ('transfer_promotion', 'window_open', NULL, 'absolute', '2026-07-05T00:00:00.000Z', 1, 1)`,
    );
    resetOpsScheduleCache();
    const res = await demote(fx, 1);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('op_closed');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM transfers WHERE type = 'demote'")).toMatchObject({ n: 0 });
  });
});

describe('上调（训练营 → 正式合同谈判，v6.64.4）', () => {
  it('TC-P1 提交即开会：F 定死、E 快照、期间锁定（激活/解约/二次上调被拦）', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    const res = await promote(fx, 6, 10);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; transferId: number; sessionId: number; releaseFee: number; surcharge: number; expectedWage: number };
    expect(body).toMatchObject({ ok: true, releaseFee: 10, surcharge: 0 });
    expect(body.expectedWage).toBeGreaterThan(0);

    const transfer = sqlGet<{ type: string; status: string; from_club_id: number; to_club_id: number; fee: number }>(
      fx.sqlite,
      "SELECT type, status, from_club_id, to_club_id, fee FROM transfers WHERE type = 'promotion'",
    );
    expect(transfer).toMatchObject({ type: 'promotion', status: 'signing', from_club_id: 1, to_club_id: 1, fee: 0 });
    const session = sqlGet<{ status: string; release_fee: number | null; expected_wage: number | null }>(
      fx.sqlite,
      'SELECT status, release_fee, expected_wage FROM negotiation_sessions WHERE id = ?',
      body.sessionId,
    );
    expect(session).toMatchObject({ status: 'active', release_fee: 10 });
    expect(session?.expected_wage).toBe(body.expectedWage);

    // F 定死（FIXED_FEE_TYPES）：submitReleaseFee 拒绝
    const refee = await send(fx.env, 'POST', `/api/negotiations/${body.transferId}/release-fee`, { fee: 8 }, 'tok-coach');
    expect(refee.status).toBe(400);
    expect(((await refee.json()) as { error: string }).error).toContain('已经定死');

    // 锁定：他队激活 409、自家解约 409、二次上调 409
    const act = await send(fx.env, 'POST', '/api/transfers/activation', { playerId: 6, proofMediaKey: proofKey(2) }, 'tok-coach2');
    expect(act.status).toBe(409);
    expect(((await act.json()) as { error: string }).error).toContain('上调谈判中');
    const term = await send(fx.env, 'POST', '/api/transfers/termination', { playerId: 6 }, 'tok-coach');
    expect(term.status).toBe(409);
    const again = await promote(fx, 6, 12);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain('签约谈判没结束');
  });

  it('TC-P2 工资谈成：合同翻 formal（保护期重锚、效力保留）、球员回一线队；F≤15 零附加费', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.env.rng = () => 0.7;
    const opened = await promote(fx, 6, 10);
    const { sessionId, expectedWage } = (await opened.json()) as { sessionId: number; expectedWage: number };
    fx.sqlite.exec(`UPDATE contracts SET service_ticks = 2 WHERE player_id = 6`);
    expect((await send(fx.env, 'POST', `/api/negotiations/${sessionId}/offer`, { wage: expectedWage }, 'tok-coach')).status).toBe(200);

    const contract = sqlGet<{ contract_type: string; release_fee: number; wage: number; source: string; protection_ticks: number | null; service_ticks: number; free_rc_change_used: number }>(
      fx.sqlite,
      'SELECT contract_type, release_fee, wage, source, protection_ticks, service_ticks, free_rc_change_used FROM contracts WHERE player_id = 6 AND is_active = 1',
    );
    expect(contract).toMatchObject({ contract_type: 'formal', release_fee: 10, source: 'negotiation', service_ticks: 2, free_rc_change_used: 0 });
    // 保护期按新签重锚：已关常规窗 1（窗1）+ 3 个常规窗
    expect(contract?.protection_ticks).toBe(4);
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 6');
    expect(player).toEqual({ club_id: 1, status: 'normal' });
    // 零附加费：无 promotion_fee 流水、extra_fee = 0
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'promotion_fee'")).toMatchObject({ n: 0 });
    expect(sqlGet<{ extra_fee: number | null }>(fx.sqlite, "SELECT extra_fee FROM transfers WHERE type = 'promotion'")?.extra_fee).toBe(0);
  });

  it('TC-P3 F=25 附加费 (25−15)×0.3=3m：提交预检通过、成约销毁并落 extra_fee', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.env.rng = () => 0.7;
    const opened = await promote(fx, 6, 25);
    expect(opened.status).toBe(201);
    const { sessionId, expectedWage, surcharge } = (await opened.json()) as { sessionId: number; expectedWage: number; surcharge: number };
    expect(surcharge).toBe(3);
    expect((await send(fx.env, 'POST', `/api/negotiations/${sessionId}/offer`, { wage: expectedWage }, 'tok-coach')).status).toBe(200);

    expect(sqlGet<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'promotion_fee'")?.amount).toBe(-3);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')?.balance).toBe(97);
    expect(sqlGet<{ extra_fee: number | null }>(fx.sqlite, "SELECT extra_fee FROM transfers WHERE type = 'promotion'")?.extra_fee).toBe(3);
  });

  it('TC-P4 附加费余额不足：提交即 400 且不留单', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 2 WHERE club_id = 1`);
    const res = await promote(fx, 6, 25);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('上调附加费');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM transfers WHERE type = 'promotion'")).toMatchObject({ n: 0 });
  });

  it('TC-P6 闸关强约（到期引擎适配器）：上调会话按 E 成约，不进静默作废', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    fx.env.rng = () => 0.7;
    const opened = await promote(fx, 6, 10);
    const { expectedWage } = (await opened.json()) as { expectedWage: number };
    // 闸到点止（窗口仍开）
    fx.sqlite.exec(
      `INSERT INTO ops_schedule (op_key, start_anchor, start_at, end_anchor, end_at, requires_window, close_inflight)
       VALUES ('transfer_promotion', 'window_open', NULL, 'absolute', '2026-07-05T00:00:00.000Z', 1, 1)`,
    );
    resetOpsScheduleCache();
    const tick = await send(fx.env, 'POST', '/api/cron/tick', {});
    expect(tick.status).toBe(200);
    const summary = (await tick.json()) as { expiry: { byAdapter: Record<string, number> } };
    expect(summary.expiry.byAdapter.promotion).toBe(1);

    const session = sqlGet<{ status: string; settle_source: string | null; settled_wage: number | null }>(
      fx.sqlite,
      'SELECT status, settle_source, settled_wage FROM negotiation_sessions ORDER BY id DESC LIMIT 1',
    );
    expect(session).toMatchObject({ status: 'settled', settle_source: 'forced', settled_wage: expectedWage });
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE type = 'promotion'")).toMatchObject({ status: 'completed' });
    expect(sqlGet<{ contract_type: string }>(fx.sqlite, 'SELECT contract_type FROM contracts WHERE player_id = 6 AND is_active = 1')).toMatchObject({ contract_type: 'formal' });
  });

  it('TC-P7 练满自动开/预约：闸开直接开会 + 通知；闸关落 pending_review 预约，闸开后 tick 开会', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    // 青训己（6）距练满 1 级：ca 79 / pa 80，growth_xp=10（1 级待办）
    fx.sqlite.exec(`UPDATE players SET ca = 79, pa = 80, growth_xp = 10, levels_applied = 0 WHERE id = 6`);
    const lvl = await send(fx.env, 'POST', '/api/growth/levelup/6', { planIndex: 0 }, 'tok-coach');
    expect(lvl.status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE type = 'promotion'")).toMatchObject({ status: 'signing' });
    expect(sqlGet<{ template: string }>(fx.sqlite, "SELECT template FROM notifications WHERE template = 'promotion_opened'")).toBeDefined();

    // 闸关分支：新练满 → 预约（pending_review）
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status, fc_id, growth_xp, levels_applied)
       VALUES (10, 'uid10', '青训癸', 1, 'CM', 18, 79, 80, 1, 'trainee', 20, 10, 0)`,
    );
    fx.sqlite.exec(`INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active)
      VALUES (10, 10, 1, 5, 0.75, 'trainee', 'trainee', '2026-07-01', 1)`);
    fx.sqlite.exec(
      `INSERT INTO ops_schedule (op_key, start_anchor, start_at, end_anchor, end_at, requires_window, close_inflight)
       VALUES ('transfer_promotion', 'window_open', NULL, 'absolute', '2026-07-05T00:00:00.000Z', 1, 1)`,
    );
    resetOpsScheduleCache();
    const lvl2 = await send(fx.env, 'POST', '/api/growth/levelup/10', { planIndex: 0 }, 'tok-coach');
    expect(lvl2.status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE player_id = 10 AND type = 'promotion'")).toMatchObject({ status: 'pending_review' });
    expect(sqlGet<{ template: string }>(fx.sqlite, "SELECT template FROM notifications WHERE template = 'promotion_reserved'")).toBeDefined();

    // 闸重开（默认合成行回归）→ tick 兜底开会
    fx.sqlite.exec(`DELETE FROM ops_schedule WHERE op_key = 'transfer_promotion'`);
    resetOpsScheduleCache();
    const tick = await send(fx.env, 'POST', '/api/cron/tick', {});
    expect(tick.status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE player_id = 10 AND type = 'promotion'")).toMatchObject({ status: 'signing' });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM negotiation_sessions')).toMatchObject({ n: 2 });
  });

  it('TC-P8 上调会话不能转训练营合同（chooseTrainee 拒绝）；正式合同一线队球员再上调 400', async () => {
    const fx = freshPromotionEnv();
    seedPromotionWorld(fx);
    const opened = await promote(fx, 6, 10);
    const { sessionId } = (await opened.json()) as { sessionId: number };
    const trainee = await send(fx.env, 'POST', `/api/negotiations/${sessionId}/trainee`, {}, 'tok-coach');
    expect(trainee.status).toBe(400);
    expect(((await trainee.json()) as { error: string }).error).toContain('不能转进训练营');

    const normal = await promote(fx, 1, 10);
    expect(normal.status).toBe(400);
    expect(((await normal.json()) as { error: string }).error).toContain('已经在一线队了');
  });
});
