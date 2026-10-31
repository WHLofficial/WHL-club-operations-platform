// 运营时刻表测试（v6.49.0 增量 1，验收口径 = plan-v6.49.0-ops-schedule.md §4）：
// ① 注册表 11 行与迁移种子一致；② 五态解析（不限制/未开始/进行中/已结束 + 随窗两锚）；
// ③ 管理端保存（审计 + 读回 + 缓存失效）；④ 闸门接进各写路径（默认「不限制」= 与上线前逐字一致）。
// 变异验证对应关系（开发期手动三改三红，测试常驻断言）：
//   ① 删 resolveOpsRow 的 `!open && (window_open || window_close)` 分支 → 「随窗锚无窗」组变红
//   ② 删 0069 的 INSERT OR IGNORE 11 行 → 「迁移种子」组变红
//   ③ 删 assertOpOpen 里的 op_closed 分支 → 「闸门」组变红
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  OPS_KEYS,
  fmtBeijingMinute,
  opsStateLabel,
  resolveOpsRow,
  validateOpsInput,
  type OpsRow,
} from '../src/core/ops-schedule.ts';
import {
  assertOpOpen,
  opBlockReason,
  opsScheduleView,
  resetOpsScheduleCache,
  saveOpsRow,
} from '../src/worker/ops-schedule.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
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

function seedWorld(fx: Fixture, opts: { windowOpen?: boolean } = {}): void {
  const open = opts.windowOpen ?? true;
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '拜仁', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, '${open ? 'open' : 'closed'}', '2026-07-01T00:00:00Z');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z'), (2, 5, '2026-01-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES
      (1, 'uid1', '球员甲', 1, 'ST', 80, 85, 'normal', 11),
      (2, 'uid2', '球员乙', 2, 'CM', 75, 82, 'normal', 12);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (2, 2, 50, 2, 'formal', 'import', '2026-07-01', 1);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, 100, '2026-07-01T00:00:00Z'), (2, 100, '2026-07-01T00:00:00Z');
  `);
}

function send(env: Env, method: 'GET' | 'POST' | 'PUT', path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.Cookie = `whl_session=${token}`;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

// 直接落一行时刻表（绕过路由，测闸门/视图用）；与 PUT 同一条保存路径
async function setRow(fx: Fixture, key: string, input: Parameters<typeof saveOpsRow>[2]) {
  return saveOpsRow(fx.env, key, input, 1);
}

const ISO_PAST = '2026-07-01T00:00:00.000Z';
const ISO_FUTURE = '2099-01-01T00:00:00.000Z';

describe('时刻表注册表与解析（纯函数）', () => {
  it('OPS_KEYS = 12 项、key 唯一、requiresWindow 口径正确（v6.64.4 加 transfer_promotion）', () => {
    expect(OPS_KEYS.length).toBe(12);
    const keys = OPS_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(12);
    expect(keys).toEqual([
      'transfer_listing',
      'transfer_offer',
      'transfer_negotiation',
      'transfer_sea_sealed',
      'transfer_sea_open',
      'transfer_activation',
      'transfer_match',
      'transfer_termination',
      'transfer_rc_change',
      'transfer_promotion',
      'transfer_forced_auction',
      'consumption',
    ]);
    // 报价与签约谈判是 v6.29.0 起不依赖开窗的两个操作，其余都随窗
    expect(OPS_KEYS.filter((k) => !k.requiresWindow).map((k) => k.key)).toEqual([
      'transfer_offer',
      'transfer_negotiation',
    ]);
    // 合成默认：transfer_promotion 随窗全窗（下放/上调随窗开关），其余键不设默认锚
    const promotion = OPS_KEYS.find((k) => k.key === 'transfer_promotion')!;
    expect(promotion.defaultStartAnchor).toBe('window_open');
    expect(promotion.defaultEndAnchor).toBe('window_close');
    expect(OPS_KEYS.filter((k) => k.defaultStartAnchor !== undefined).map((k) => k.key)).toEqual(['transfer_promotion']);
  });

  it('五态解析：不限制 / 未开始 / 进行中 / 已结束（含随窗两锚与无窗）', () => {
    const none: OpsRow = { opKey: 'x', startAnchor: 'none', startAt: null, endAnchor: 'none', endAt: null, requiresWindow: true, closeInflight: true, note: '' };
    const win = { openedAt: '2026-07-01T00:00:00.000Z', closedAt: null };
    const now = '2026-07-10T00:00:00.000Z';
    expect(resolveOpsRow(none, null, now).state).toBe('unrestricted');
    expect(resolveOpsRow(none, null, now).endIsWindowClose).toBe(false);

    // 随开窗起：有窗 = 开，无窗 = 已结束
    const fromWindow: OpsRow = { ...none, startAnchor: 'window_open' };
    expect(resolveOpsRow(fromWindow, win, now).state).toBe('open');
    expect(resolveOpsRow(fromWindow, win, now).startAt).toBe(win.openedAt);
    expect(resolveOpsRow(fromWindow, null, now).state).toBe('closed');

    // 随关窗止：有窗 = 开，无窗 = 已结束（且不带具体终点时间）
    const toWindow: OpsRow = { ...none, endAnchor: 'window_close' };
    expect(resolveOpsRow(toWindow, win, now)).toMatchObject({ state: 'open', endAt: null, endIsWindowClose: true });
    expect(resolveOpsRow(toWindow, null, now).state).toBe('closed');

    // 具体时间：未到 = 未开始，过了 = 已结束
    const future: OpsRow = { ...none, startAnchor: 'absolute', startAt: ISO_FUTURE, endAnchor: 'absolute', endAt: '2099-02-01T00:00:00.000Z' };
    expect(resolveOpsRow(future, win, now).state).toBe('not_started');
    const past: OpsRow = { ...none, startAnchor: 'absolute', startAt: ISO_PAST, endAnchor: 'absolute', endAt: '2026-07-05T00:00:00.000Z' };
    expect(resolveOpsRow(past, win, now).state).toBe('closed');

    // 只设终点（到点起·到点止型）：没过 = 开
    const endOnly: OpsRow = { ...none, endAnchor: 'absolute', endAt: ISO_FUTURE };
    expect(resolveOpsRow(endOnly, win, now).state).toBe('open');

    expect(opsStateLabel('unrestricted')).toBe('不限制');
    expect(opsStateLabel('not_started')).toBe('未开始');
    expect(opsStateLabel('open')).toBe('进行中');
    expect(opsStateLabel('closed')).toBe('已结束');
  });

  it('保存校验：锚型 / 具体时间 / 随窗必须勾需要开窗 / 终点晚于起点', () => {
    const base = { startAnchor: 'none', startAt: null, endAnchor: 'none', endAt: null, requiresWindow: true };
    expect(validateOpsInput(base)).toBeNull();
    expect(validateOpsInput({ ...base, startAnchor: 'whenever' })).toBe('起点锚只支持：不限制 / 随开窗 / 具体时间');
    expect(validateOpsInput({ ...base, endAnchor: 'whenever' })).toBe('终点锚只支持：不限制 / 随关窗 / 具体时间');
    expect(validateOpsInput({ ...base, startAnchor: 'absolute' })).toBe('起点要填具体时间（北京时间）');
    expect(validateOpsInput({ ...base, endAnchor: 'absolute', endAt: '不是时间' })).toBe('终点要填具体时间（北京时间）');
    expect(validateOpsInput({ ...base, startAnchor: 'window_open', requiresWindow: false })).toBe('随窗锚点的行必须同时勾选「需要开窗」');
    expect(validateOpsInput({ ...base, endAnchor: 'window_close', requiresWindow: false })).toBe('随窗锚点的行必须同时勾选「需要开窗」');
    expect(
      validateOpsInput({ ...base, startAnchor: 'absolute', startAt: '2026-07-05T00:00:00.000Z', endAnchor: 'absolute', endAt: '2026-07-01T00:00:00.000Z' }),
    ).toBe('终点要晚于起点');
  });

  it('北京时间格式化：UTC ISO → +08:00 的「YYYY-MM-DD HH:mm」', () => {
    expect(fmtBeijingMinute('2026-10-15T04:00:00.000Z')).toBe('2026-10-15 12:00');
    expect(fmtBeijingMinute('2026-10-15T16:30:00.000Z')).toBe('2026-10-16 00:30');
    expect(fmtBeijingMinute('坏数据')).toBe('坏数据');
  });
});

describe('迁移种子与视图', () => {
  it('迁移后 11 行（transfer_promotion 无种子行，由合成默认兜底）：consumption 随窗起止，其余全「不限制」', () => {
    const fx = freshEnv();
    const rows = sqlAll<{ op_key: string; start_anchor: string; end_anchor: string; requires_window: number }>(
      fx.sqlite,
      'SELECT op_key, start_anchor, end_anchor, requires_window FROM ops_schedule ORDER BY rowid',
    );
    expect(rows.length).toBe(11);
    // 0078 只把消费档期改成随窗两锚（window_open / window_close），其余 10 行不动
    expect(rows.find((r) => r.op_key === 'consumption')).toMatchObject({
      start_anchor: 'window_open',
      end_anchor: 'window_close',
    });
    expect(
      rows.filter((r) => r.op_key !== 'consumption').every((r) => r.start_anchor === 'none' && r.end_anchor === 'none'),
    ).toBe(true);
    for (const meta of OPS_KEYS) {
      const row = rows.find((r) => r.op_key === meta.key);
      // v6.64.4 后登记的键零迁移不落种子行，靠 loadOpsRows 合成（见视图用例）
      if (meta.defaultStartAnchor !== undefined) {
        expect(row, `${meta.key} 不应有种子行`).toBeUndefined();
        continue;
      }
      expect(row, meta.key).toBeDefined();
      expect(row!.requires_window).toBe(meta.requiresWindow ? 1 : 0);
    }
    // 到期锚与提醒抢占列（0069 四个 ALTER）
    expect(sqlGet<{ name: string }>(fx.sqlite, "SELECT name FROM pragma_table_info('offers') WHERE name = 'expiry_anchor_at'")).toBeDefined();
    expect(sqlGet<{ name: string }>(fx.sqlite, "SELECT name FROM pragma_table_info('offers') WHERE name = 'reminded_at'")).toBeDefined();
    expect(sqlGet<{ name: string }>(fx.sqlite, "SELECT name FROM pragma_table_info('negotiation_sessions') WHERE name = 'expiry_anchor_at'")).toBeDefined();
    expect(sqlGet<{ name: string }>(fx.sqlite, "SELECT name FROM pragma_table_info('negotiation_sessions') WHERE name = 'reminded_at'")).toBeDefined();
  });

  it('视图：12 行（合成 transfer_promotion 默认随窗全窗），消费档期进行中、其余不限制', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const view = await opsScheduleView(fx.env.DB);
    expect(view.rows.length).toBe(12);
    expect(view.rows.find((r) => r.key === 'consumption')).toMatchObject({ state: 'open', stateLabel: '进行中' });
    expect(view.rows.find((r) => r.key === 'transfer_promotion')).toMatchObject({
      state: 'open',
      stateLabel: '进行中',
      startAnchor: 'window_open',
      endAnchor: 'window_close',
      requiresWindow: true,
    });
    expect(
      view.rows
        .filter((r) => r.key !== 'consumption' && r.key !== 'transfer_promotion')
        .every((r) => r.state === 'unrestricted' && r.stateLabel === '不限制'),
    ).toBe(true);
    expect(view.window).toMatchObject({ openedAt: '2026-07-01T00:00:00Z' });
    expect(typeof view.now).toBe('string');

    const res = await send(fx.env, 'GET', '/api/ops-schedule', undefined);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { rows: unknown[] };
    expect(out.rows.length).toBe(12);
  });

  it('视图：没开窗时消费档期与合成的上调/下放行「已结束」，闸门给出 409 文案', async () => {
    const fx = freshEnv();
    seedWorld(fx, { windowOpen: false });
    const view = await opsScheduleView(fx.env.DB);
    expect(view.rows.find((r) => r.key === 'consumption')).toMatchObject({ state: 'closed', stateLabel: '已结束' });
    expect(view.rows.find((r) => r.key === 'transfer_promotion')).toMatchObject({ state: 'closed' });
    const block = await opBlockReason(fx.env.DB, 'consumption');
    expect(block?.status).toBe(409);
    expect(block?.message).toBeTruthy();
    await expect(assertOpOpen(fx.env.DB, 'consumption')).rejects.toMatchObject({ status: 409 });
    // 合成行同样有牙：无窗时上调/下放被 409 挡住（label 来自 meta）
    const promoBlock = await opBlockReason(fx.env.DB, 'transfer_promotion');
    expect(promoBlock?.status).toBe(409);
    expect(promoBlock?.message).toContain('上调/下放已结束');
  });
});

describe('管理端保存（PUT /api/admin/ops-schedule）', () => {
  it('保存到点止：落库 + 审计 ops_schedule_set + 读回已结束 + 缓存立即失效', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    // 先读一次把缓存填上，证明保存后本 isolate 立即失效（≤60s 窗口被绕开）
    await opsScheduleView(fx.env.DB);

    const res = await send(
      fx.env,
      'PUT',
      '/api/admin/ops-schedule',
      {
        key: 'transfer_termination',
        startAnchor: 'absolute',
        startAt: '2026-07-01T00:00:00.000Z',
        endAnchor: 'absolute',
        endAt: '2026-07-05T00:00:00.000Z',
        requiresWindow: true,
        closeInflight: false,
        note: '本期只开到 7/5',
      },
      'tok-admin',
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; row: { state: string; stateLabel: string; note: string } };
    expect(out.ok).toBe(true);
    expect(out.row).toMatchObject({ state: 'closed', stateLabel: '已结束', note: '本期只开到 7/5' });

    const row = sqlGet<{ start_anchor: string; end_anchor: string; end_at: string; close_inflight: number; note: string; updated_by: number }>(
      fx.sqlite,
      'SELECT * FROM ops_schedule WHERE op_key = ?',
      'transfer_termination',
    );
    expect(row).toMatchObject({
      start_anchor: 'absolute',
      end_anchor: 'absolute',
      end_at: '2026-07-05T00:00:00.000Z',
      close_inflight: 0,
      note: '本期只开到 7/5',
      updated_by: 1,
    });
    const audit = sqlGet<{ action: string; target_type: string; origin: string; actor: number }>(
      fx.sqlite,
      "SELECT action, target_type, origin, actor FROM audit_log WHERE action = 'ops_schedule_set'",
    );
    expect(audit).toMatchObject({ action: 'ops_schedule_set', target_type: 'ops_schedule', origin: 'user', actor: 1 });

    const view = await opsScheduleView(fx.env.DB);
    expect(view.rows.find((r) => r.key === 'transfer_termination')).toMatchObject({ state: 'closed' });
  });

  it('保存合成行（transfer_promotion）：upsert 物化落库，再保存走同一条路径更新', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ops_schedule WHERE op_key = 'transfer_promotion'")).toMatchObject({ n: 0 });

    const res = await send(
      fx.env,
      'PUT',
      '/api/admin/ops-schedule',
      { key: 'transfer_promotion', startAnchor: 'window_open', startAt: null, endAnchor: 'window_close', endAt: null, requiresWindow: true, closeInflight: true, note: '随窗开关' },
      'tok-admin',
    );
    expect(res.status).toBe(200);
    const row = sqlGet<{ start_anchor: string; end_anchor: string; note: string; updated_by: number }>(
      fx.sqlite,
      'SELECT * FROM ops_schedule WHERE op_key = ?',
      'transfer_promotion',
    );
    expect(row).toMatchObject({ start_anchor: 'window_open', end_anchor: 'window_close', note: '随窗开关', updated_by: 1 });
    const audit = sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'ops_schedule_set' ORDER BY id DESC LIMIT 1");
    expect(audit).toMatchObject({ action: 'ops_schedule_set' });

    // 二次保存（已有物理行）：更新而非重复插入
    const again = await send(
      fx.env,
      'PUT',
      '/api/admin/ops-schedule',
      { key: 'transfer_promotion', startAnchor: 'none', startAt: null, endAnchor: 'none', endAt: null, requiresWindow: true },
      'tok-admin',
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as { row: { state: string } }).row.state).toBe('unrestricted');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ops_schedule WHERE op_key = 'transfer_promotion'")).toMatchObject({ n: 1 });
  });

  it('非法输入 400 / 未知键 404 / 非管理员 403', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const bad = await send(
      fx.env,
      'PUT',
      '/api/admin/ops-schedule',
      { key: 'transfer_offer', startAnchor: 'absolute', startAt: '2026-07-05T00:00:00.000Z', endAnchor: 'absolute', endAt: '2026-07-01T00:00:00.000Z', requiresWindow: false },
      'tok-admin',
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('终点要晚于起点');

    const unknown = await send(fx.env, 'PUT', '/api/admin/ops-schedule', { key: 'transfer_unknown', startAnchor: 'none', endAnchor: 'none' }, 'tok-admin');
    expect(unknown.status).toBe(404);

    const notAdmin = await send(fx.env, 'PUT', '/api/admin/ops-schedule', { key: 'transfer_offer', startAnchor: 'none', endAnchor: 'none' }, 'tok-coach');
    expect(notAdmin.status).toBe(403);
    const getNotAdmin = await send(fx.env, 'GET', '/api/admin/ops-schedule', undefined, 'tok-coach');
    expect(getNotAdmin.status).toBe(403);
  });
});

describe('闸门（写路径问一句「这个操作现在开着吗」）', () => {
  async function placeOffer(fx: Fixture, token = 'tok-coach2') {
    return send(fx.env, 'POST', '/api/offers', { playerId: 1, amount: 30 }, token);
  }

  it('默认「不限制」零行为变化：报价照落 pending', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    const res = await placeOffer(fx);
    expect(res.status).toBe(201);
  });

  it('报价通道到点止 → 409 op_closed（连关窗期可报价这条 v6.29.0 特例也受时段管）', async () => {
    const fx = freshEnv();
    seedWorld(fx, { windowOpen: false });
    await setRow(fx, 'transfer_offer', { startAnchor: 'absolute', startAt: ISO_PAST, endAnchor: 'absolute', endAt: '2026-07-05T00:00:00.000Z', requiresWindow: false });
    const res = await placeOffer(fx);
    expect(res.status).toBe(409);
    const out = (await res.json()) as { error: string; code: string };
    expect(out.code).toBe('op_closed');
    expect(out.error).toContain('报价已结束');
    expect(out.error).toContain('北京时间 2026-07-05 08:00 止');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM offers')).toMatchObject({ n: 0 });
  });

  it('未开始 → 409 op_not_started（带起点北京时间）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await setRow(fx, 'transfer_offer', { startAnchor: 'absolute', startAt: '2099-01-01T00:00:00.000Z', endAnchor: 'none', endAt: null, requiresWindow: false });
    const res = await placeOffer(fx);
    expect(res.status).toBe(409);
    const out = (await res.json()) as { error: string; code: string };
    expect(out.code).toBe('op_not_started');
    expect(out.error).toContain('北京时间 2099-01-01 08:00 起');
  });

  it('随窗锚：没开窗 = 已结束，开窗后放行', async () => {
    const fx = freshEnv();
    seedWorld(fx, { windowOpen: false });
    await setRow(fx, 'transfer_offer', { startAnchor: 'window_open', startAt: null, endAnchor: 'window_close', endAt: null, requiresWindow: true });
    const closed = await placeOffer(fx);
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { error: string }).error).toContain('（转会窗口已关）');

    fx.sqlite.exec(`UPDATE season_windows SET status = 'open' WHERE season = 1 AND window_seq = 1`);
    resetOpsScheduleCache();
    const opened = await placeOffer(fx);
    expect(opened.status).toBe(201);
  });

  it('闸门接进旁路单据：解约到点止 → 409，且没落 transfers 行', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await setRow(fx, 'transfer_termination', { startAnchor: 'absolute', startAt: ISO_PAST, endAnchor: 'absolute', endAt: '2026-07-05T00:00:00.000Z', requiresWindow: true });
    const res = await send(fx.env, 'POST', '/api/transfers/termination', { playerId: 1 }, 'tok-coach');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('op_closed');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM transfers')).toMatchObject({ n: 0 });
    // 其余行仍是「不限制」：同一次操作换个键不受影响（续约照走）
    const rc = await send(fx.env, 'POST', '/api/transfers/rc-change', { playerId: 1, newReleaseFee: 60 }, 'tok-coach');
    expect(rc.status).toBe(201);
  });

  it('assertOpOpen 直调：未登记的键放行（老库少行不炸）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    await expect(assertOpOpen(fx.env.DB, 'transfer_sea_sealed')).resolves.toBeUndefined();
    await expect(assertOpOpen(fx.env.DB, 'not_a_key')).resolves.toBeUndefined();
  });
});

// 教练侧写入口静态锁（v6.49.0）：时刻表要真挡住人，得每个写入口都接闸门；
// 漏接一个就出现「按钮能点、提交 409」的割裂体验。这里按文件断言「挂了 useOpsGate + 有提示条」，
// 新增写入口时这组会提醒你把它接上（后端 assertOpOpen 是硬闸，这里锁的是前端体验一致性）。
describe('v6.49.0 教练侧写入口静态锁', () => {
  const read = (rel: string): string => readFileSync(rel, 'utf8');
  const SURFACES: [string, string][] = [
    ['web/src/pages/player/SideOps.tsx', "useOpsGate('transfer_listing')"],
    ['web/src/pages/player/SideOps.tsx', "useOpsGate('transfer_sea_open')"],
    ['web/src/pages/player/SideOps.tsx', "useOpsGate('transfer_offer')"],
    ['web/src/pages/player/SideOps.tsx', "useOpsGate('transfer_promotion')"],
    ['web/src/components/MarketBidForm.tsx', "useOpsGate('transfer_listing')"],
    ['web/src/pages/market/MarketAdBoardPage.tsx', "useOpsGate('transfer_offer')"],
    ['web/src/pages/market/MarketActivationPage.tsx', "useOpsGate('transfer_activation')"],
    ['web/src/pages/market/desk/NegotiationsSection.tsx', "useOpsGate('transfer_negotiation')"],
    ['web/src/pages/shop/ShopPage.tsx', "useOpsGate('consumption')"],
    ['web/src/pages/shop/venueCards.tsx', "useOpsGate('consumption')"],
  ];

  it('各写入口都挂了对应键的闸门与提示条', () => {
    for (const [file, needle] of SURFACES) {
      const src = read(file);
      expect(src.includes(needle), `${file} 缺 ${needle}（时刻表挡不住这个入口）`).toBe(true);
      expect(src.includes('<OpsGateNote'), `${file} 缺 <OpsGateNote> 提示条（挡住时要说明原因）`).toBe(true);
    }
  });

  it('闸门挂在组件顶层（不许出现在早退之后，否则 hook 顺序会炸）', () => {
    for (const file of ['web/src/pages/shop/venueCards.tsx', 'web/src/pages/market/MarketActivationPage.tsx']) {
      const src = read(file);
      const gateIdx = src.indexOf('useOpsGate(');
      const earlyReturn = src.indexOf('return null;');
      expect(gateIdx > 0, `${file} 找不到 useOpsGate`).toBe(true);
      if (earlyReturn > 0) {
        expect(gateIdx < earlyReturn, `${file} 的 useOpsGate 落在早退之后（conditional hook）`).toBe(true);
      }
    }
  });
});
