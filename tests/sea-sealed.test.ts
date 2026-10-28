// 海捞两阶段·暗标段测试（v6.50.0）。验收口径见 memory/plan-v6.50.0-sea-sealed.md §5；
// 设计见 memory/design-sea-two-phase.md。四条关键口径（改代码前先读这四行，别把设计当 bug 修）：
//   ① 金额保密：教练侧只看得见自己的标；管理端是明账；开标后才公示胜出者与金额。
//   ② 收标中的唯一真源是「批次状态」：关窗 / 到点 / 管理端立即开标都只是把批次推出 sealed，
//      写入口（出标/撤标/改标）只看批次状态 + deadline，不看时刻表行。
//   ③ 开标只建「待审海捞单」（复用现有审核 → 工资谈判 → 过户链）；签入费在审核通过时才收，
//      收的同时销毁这笔密封冻结（避免谈判期内可用额被双重扣减）。
//   ④ sea_enabled=false 的兜底：还收着标的批次整批作废 + 解冻（回滚不静默留冻结）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetOpsScheduleCache, saveOpsRow } from '../src/worker/ops-schedule.ts';
import { runExpiryTick } from '../src/worker/expiry-ops.ts';
import { findBatch, loadSeaAdminView, loadSeaPhaseView } from '../src/worker/sea-sealed.ts';
import { freeAgentFee } from '../src/core/bypass-rules.ts';

const CLUB_A = 701; // 甲队（教练乙 tok-coach 绑定，余额 100m）
const CLUB_B = 702; // 乙队（教练丙 tok-coach2 绑定，余额 100m）
const A = `tok-coach`;
const B = `tok-coach2`;

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  resetOpsScheduleCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '教练丙', 'coach', 0, 0),
       (9, '观众', 'user', 0, 0);`,
  );
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
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
    [2, A],
    [3, B],
    [9, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite };
}

function get(path: string, token: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
}

function post(path: string, body: unknown, token: string, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` },
      body: JSON.stringify(body),
    },
    env,
  );
}

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

/** 甲队/乙队 + 两名自由身浪人 + S4W1 开放；不预置任何单据，让每个用例从零基数出发。 */
function seedWorld(): Fixture {
  const fx = freshEnv();
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES
       (${CLUB_A}, '甲队', 'premier', 'active', 0),
       (${CLUB_B}, '乙队', 'premier', 'active', 0);
     INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES
       (${CLUB_A}, 2, '2026-01-01T00:00:00Z'), (${CLUB_B}, 3, '2026-01-01T00:00:00Z');
     INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${CLUB_A}, 100, '2026-07-01T00:00:00Z'), (${CLUB_B}, 100, '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'settled'), (2, 'settled'), (3, 'settled'), (4, 'running');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
       (3, 1, 'closed', 0, '2026-05-01T00:00:00Z', '2026-05-05T00:00:00Z'),
       (3, 2, 'closed', 0, '2026-06-01T00:00:00Z', '2026-06-05T00:00:00Z'),
       (4, 1, 'open', 0, '2026-07-01T00:00:00Z', NULL);
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (24, 'fc24', '浪人一', NULL, 'ST', 27, 78, 80, 'free'),
       (25, 'fc25', '浪人二', NULL, 'CM', 25, 76, 79, 'free');`,
  );
  return fx;
}

/** 开开关（config sea_enabled）；createConfigService 有模块级缓存，改完必须 reset。 */
function setSeaEnabled(fx: Fixture, on: boolean): void {
  fx.sqlite
    .prepare(`INSERT INTO config (key, value, updated_at) VALUES ('sea_enabled', ?, '2026-07-01T00:00:00Z')
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(on ? 'true' : 'false');
  resetConfigCache();
}

/** 暗标段时段：起点已过、终点还在将来（absolute 两端 ⇒ 统一截止拿得到）。 */
async function setSealedWindow(fx: Fixture, endIso = hoursFromNow(24)): Promise<string> {
  await saveOpsRow(
    fx.env,
    'transfer_sea_sealed',
    {
      startAnchor: 'absolute',
      startAt: hoursFromNow(-1),
      endAnchor: 'absolute',
      endAt: endIso,
      requiresWindow: true,
      closeInflight: true,
      note: '测试',
    },
    null,
  );
  return endIso;
}

function heldTotal(fx: Fixture, clubId: number): number {
  return (
    sqlGet<{ total: number }>(
      fx.sqlite,
      `SELECT COALESCE(SUM(amount), 0) AS total FROM fund_holds WHERE club_id = ? AND status = 'held'`,
      clubId,
    )?.total ?? 0
  );
}

function bidRow(fx: Fixture, playerId: number, clubId: number) {
  return sqlGet<{ id: number; status: string; new_release_fee: number; hold_id: number | null; void_reason: string }>(
    fx.sqlite,
    'SELECT id, status, new_release_fee, hold_id, void_reason FROM sea_sealed_bids WHERE player_id = ? AND club_id = ?',
    playerId,
    clubId,
  );
}

function holdStatus(fx: Fixture, holdId: number | null | undefined): string | undefined {
  if (holdId === null || holdId === undefined) return undefined;
  return sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM fund_holds WHERE id = ?', holdId)?.status;
}

function notices(fx: Fixture, template: string, clubId?: number) {
  return sqlAll<{ club_id: number; payload: string; channel: string }>(
    fx.sqlite,
    clubId === undefined
      ? 'SELECT club_id, payload, channel FROM notifications WHERE template = ? ORDER BY id'
      : 'SELECT club_id, payload, channel FROM notifications WHERE template = ? AND club_id = ? ORDER BY id',
    ...(clubId === undefined ? [template] : [template, clubId]),
  );
}

/** 暗标段就绪世界：开关打开 + 时段进行中 + 批次已惰性建成。 */
async function seedSealed(): Promise<{ fx: Fixture; batchId: number }> {
  const fx = seedWorld();
  setSeaEnabled(fx, true);
  await setSealedWindow(fx);
  const view = await loadSeaPhaseView(fx.env, CLUB_A);
  expect(view.state).toBe('sealed');
  const batchId = view.batch!.id;
  return { fx, batchId };
}

describe('暗标段：阶段与惰性建批', () => {
  it('sea_enabled 默认关闭 ⇒ 教练侧 off，出标被拒（线上行为与今天一致）', async () => {
    const { fx } = await seedSealed();
    setSeaEnabled(fx, false);

    expect((await loadSeaPhaseView(fx.env, CLUB_A)).state).toBe('off');
    const res = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'sea_disabled' });
    expect(sqlAll(fx.sqlite, 'SELECT id FROM sea_sealed_bids')).toEqual([]);
  });

  it('时段进行中 ⇒ 惰性建批次（唯一一份）并给教练倒计时', async () => {
    const { fx } = await seedSealed();
    const view = await loadSeaPhaseView(fx.env, CLUB_B);
    expect(view).toMatchObject({ enabled: true, state: 'sealed' });
    expect(view.batch).toMatchObject({ season: 4, windowSeq: 1, status: 'sealed' });
    expect(Date.parse(view.batch!.deadlineAt)).toBeGreaterThan(Date.now());
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM sea_batches')!.n).toBe(1);
    // 再读一次不会建第二份（INSERT OR IGNORE + UNIQUE(season, window_seq)）
    await loadSeaPhaseView(fx.env, CLUB_A);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM sea_batches')!.n).toBe(1);
  });

  it('时刻表行还是「不限制」⇒ 不建批次，出标提示走明标段', async () => {
    const fx = seedWorld();
    setSeaEnabled(fx, true);
    const res = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'sea_not_sealed' });
    expect(sqlAll(fx.sqlite, 'SELECT id FROM sea_batches')).toEqual([]);
  });

  it('承认「随窗关闭」当终点的配置：暗标段不开批次（拿不到统一截止）', async () => {
    const fx = seedWorld();
    setSeaEnabled(fx, true);
    await saveOpsRow(
      fx.env,
      'transfer_sea_sealed',
      { startAnchor: 'window_open', startAt: null, endAnchor: 'window_close', endAt: null, requiresWindow: true },
      null,
    );
    const view = await loadSeaPhaseView(fx.env, CLUB_A);
    expect(view).toMatchObject({ state: 'none', batch: null });
    expect(sqlAll(fx.sqlite, 'SELECT id FROM sea_batches')).toEqual([]);
  });
});

describe('密封标：冻结 / 改标 / 撤回', () => {
  it('首标：冻结新违约金的 30%（= 签入费额），只有自己看得见', async () => {
    const { fx } = await seedSealed();
    const res = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bidId: number; signFee: number; updated: boolean };
    expect(body.signFee).toBe(freeAgentFee(10));
    expect(body.updated).toBe(false);

    const bid = bidRow(fx, 24, CLUB_A)!;
    expect(bid).toMatchObject({ status: 'sealed', new_release_fee: 10 });
    expect(holdStatus(fx, bid.hold_id)).toBe('held');
    expect(heldTotal(fx, CLUB_A)).toBe(3);
    // 冻结挂在 sea_sealed 上，且以标 id 为 ref_id
    expect(
      sqlGet<{ ref_type: string; ref_id: number }>(fx.sqlite, 'SELECT ref_type, ref_id FROM fund_holds WHERE id = ?', bid.hold_id),
    ).toMatchObject({ ref_type: 'sea_sealed', ref_id: bid.id });
    // 审计：actor 是出标教练，动作分首标/改标
    expect(
      sqlGet<{ actor: number; action: string; origin: string }>(
        fx.sqlite,
        "SELECT actor, action, origin FROM audit_log WHERE action = 'sea_sealed_bid'",
      ),
    ).toMatchObject({ actor: 2, action: 'sea_sealed_bid', origin: 'user' });
    // 保密：乙队看不到甲队的标
    expect((await loadSeaPhaseView(fx.env, CLUB_A)).myBids).toHaveLength(1);
    expect((await loadSeaPhaseView(fx.env, CLUB_B)).myBids).toHaveLength(0);
  });

  it('重复出标 = 改标：标的只有一份，旧冻结释放、新冻结按新价', async () => {
    const { fx } = await seedSealed();
    const first = (await (await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env)).json()) as {
      bidId: number;
    };
    const again = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env);
    expect(again.status).toBe(201);
    expect((await again.json()) as { updated: boolean; bidId: number }).toMatchObject({ updated: true, bidId: first.bidId });

    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM sea_sealed_bids')!.n).toBe(1);
    const bid = bidRow(fx, 24, CLUB_A)!;
    expect(bid.new_release_fee).toBe(20);
    expect(holdStatus(fx, bid.hold_id)).toBe('held');
    expect(
      sqlGet<{ amount: number }>(fx.sqlite, 'SELECT amount FROM fund_holds WHERE id = ?', bid.hold_id),
    ).toMatchObject({ amount: freeAgentFee(20) });
    // 旧冻结释放（三态守恒：held 只剩新的一份）
    expect(heldTotal(fx, CLUB_A)).toBe(freeAgentFee(20));
    expect(
      sqlGet<{ n: number }>(
        fx.sqlite,
        "SELECT COUNT(*) AS n FROM fund_holds WHERE ref_type = 'sea_sealed' AND status = 'released'",
      )!.n,
    ).toBe(1);
  });

  it('可用额不足：预检拦下，且不落任何标（不会留下无冻结的孤儿标）', async () => {
    const { fx } = await seedSealed();
    const res = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 400 }, A, fx.env);
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'sea_no_funds' });
    expect(sqlAll(fx.sqlite, 'SELECT id FROM sea_sealed_bids')).toEqual([]);
    expect(heldTotal(fx, CLUB_A)).toBe(0);
  });

  it('撤回：解冻 + 状态 withdrawn；另一名球员的标不受影响', async () => {
    const { fx } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    await post('/api/transfers/sea-sealed', { playerId: 25, newReleaseFee: 10 }, A, fx.env);
    const res = await post('/api/transfers/sea-sealed/withdraw', { playerId: 24 }, A, fx.env);
    expect(res.status).toBe(200);

    const bid = bidRow(fx, 24, CLUB_A)!;
    expect(bid).toMatchObject({ status: 'withdrawn', void_reason: '出标方撤回' });
    expect(holdStatus(fx, bid.hold_id)).toBe('released');
    expect(heldTotal(fx, CLUB_A)).toBe(3); // 只剩球员 25 那一份
    expect(bidRow(fx, 25, CLUB_A)!.status).toBe('sealed');
    // 撤回过的标不能再改（定局后不能重出）
    const retry = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 12 }, A, fx.env);
    expect(retry.status).toBe(409);
    expect((await retry.json()) as { code: string }).toMatchObject({ code: 'sea_bid_resolved' });
  });

  it('资格链复用：本窗被解约过的球员不能出标（与明标段同一套判定）', async () => {
    const { fx } = await seedSealed();
    fx.sqlite.exec(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
       VALUES (900, 'termination', 24, ${CLUB_A}, NULL, 0, 'completed', 4, 1, 'term:24', '2026-07-02T00:00:00Z');`,
    );
    const res = await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('本窗口被解约过');
  });
});

describe('开标', () => {
  it('价高者得：胜出建待审海捞单，非最高解冻并双向通知', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, B, fx.env);

    const open = await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    expect(open.status).toBe(200);
    expect((await open.json()) as object).toMatchObject({ won: 1, lost: 1, voided: 0, already: false });

    const winner = bidRow(fx, 24, CLUB_B)!;
    const loser = bidRow(fx, 24, CLUB_A)!;
    expect(winner.status).toBe('won');
    expect(loser.status).toBe('lost');
    expect(holdStatus(fx, winner.hold_id)).toBe('held'); // 胜出方的冻结撑到审核通过
    expect(holdStatus(fx, loser.hold_id)).toBe('released');

    const t = sqlGet<{ type: string; status: string; fee: number; to_club_id: number; sealed_bid_id: number; from_club_id: null }>(
      fx.sqlite,
      'SELECT type, status, fee, to_club_id, sealed_bid_id, from_club_id FROM transfers',
    )!;
    expect(t).toMatchObject({ type: 'free_agent', status: 'pending_review', fee: 20, to_club_id: CLUB_B, sealed_bid_id: winner.id });
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM review_tasks WHERE type = 'transfer_confirm' AND status = 'open'")!.n,
    ).toBe(1);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM sea_batches WHERE id = ?', batchId)).toMatchObject({
      status: 'opened',
    });
    // 通知：胜出方收 lead（带金额），非胜出方收「更高标」不公开金额
    expect(JSON.parse(notices(fx, 'sea_sealed_lead', CLUB_B)[0].payload).text).toContain('20');
    expect(notices(fx, 'sea_sealed_lead')[0].club_id).toBe(CLUB_B);
    const lostText = notices(fx, 'sea_sealed_lost', CLUB_A).map((n) => JSON.parse(n.payload).text).join('');
    expect(lostText).toContain('更高');
    expect(lostText).not.toContain('20');
    expect(notices(fx, 'sea_batch_open', CLUB_A).length).toBeGreaterThan(0);
    expect(notices(fx, 'sea_batch_open', CLUB_B)).toEqual([]); // 胜出方不重复打扰
  });

  it('同额取最早：同价时先出的标胜出', async () => {
    const { fx } = await seedSealed();
    const early = (await (
      await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env)
    ).json()) as { bidId: number };
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, B, fx.env);

    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    expect(bidRow(fx, 24, CLUB_A)).toMatchObject({ id: early.bidId, status: 'won' });
    expect(bidRow(fx, 24, CLUB_B)!.status).toBe('lost');
    expect(sqlGet<{ to_club_id: number }>(fx.sqlite, 'SELECT to_club_id FROM transfers')).toMatchObject({ to_club_id: CLUB_A });
  });

  it('开标重跑资格链：收标期间被挂牌 ⇒ 整组作废 + 解冻 + 通知作废原因', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, B, fx.env);
    fx.sqlite.exec(`UPDATE players SET status = 'listed' WHERE id = 24`); // 收标期间被挂牌

    const open = await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    expect((await open.json()) as object).toMatchObject({ won: 0, lost: 0, voided: 2 });
    expect(bidRow(fx, 24, CLUB_A)!.status).toBe('void');
    expect(bidRow(fx, 24, CLUB_B)!.status).toBe('void');
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_A)!.hold_id)).toBe('released');
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_B)!.hold_id)).toBe('released');
    expect(sqlAll(fx.sqlite, 'SELECT id FROM transfers')).toEqual([]);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM sea_batches WHERE id = ?', batchId)).toMatchObject({
      status: 'opened',
    });
    expect(JSON.parse(notices(fx, 'sea_sealed_lost', CLUB_A)[0].payload).text).toContain('当前状态不能海捞');
  });

  it('开标幂等：再开一次 already=true，不重复建单', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const again = await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    expect((await again.json()) as object).toMatchObject({ already: true, won: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM transfers')!.n).toBe(1);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM sea_batches WHERE id = ?', batchId)!.n).toBe(1);
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sea_batch_open'")!.n,
    ).toBe(1);
  });

  it('公示：开标后谁以多少胜出对全联盟可见（跨窗也能回看）', async () => {
    const { fx } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 12 }, A, fx.env);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const view = await loadSeaPhaseView(fx.env, CLUB_B);
    expect(view.results).toEqual([
      { playerId: 24, playerName: '浪人一', clubId: CLUB_A, clubName: '甲队', amount: 12 },
    ]);
    // 开标后教练侧不能再出标（收标已结束）
    const late = await post('/api/transfers/sea-sealed', { playerId: 25, newReleaseFee: 10 }, B, fx.env);
    expect(late.status).toBe(409);
    expect((await late.json()) as { code: string }).toMatchObject({ code: 'sea_batch_resolved' });
  });
});

describe('开标触发点：关窗 / 到点 / 提醒 / 回滚', () => {
  it('关窗时批次还收着标 ⇒ 立即开标（不阻塞关窗，窗尾建单走批次自己的窗）', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);

    const closed = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(closed.status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM season_windows WHERE season = 4 AND window_seq = 1")).toMatchObject({
      status: 'closed',
    });
    const batch = sqlGet<{ status: string; opened_by: number }>(fx.sqlite, 'SELECT status, opened_by FROM sea_batches WHERE id = ?', batchId)!;
    expect(batch).toMatchObject({ status: 'opened', opened_by: 1 });
    // 关窗后仍能建成待审单（窗口已关，靠 batches 的 season/window_seq 过关）
    const t = sqlGet<{ status: string; season: number; window_seq: number; to_club_id: number }>(
      fx.sqlite,
      'SELECT status, season, window_seq, to_club_id FROM transfers',
    )!;
    expect(t).toMatchObject({ status: 'pending_review', season: 4, window_seq: 1, to_club_id: CLUB_A });
    expect(
      JSON.parse(
        sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'sea_batch_open' ORDER BY id DESC LIMIT 1")!
          .after,
      ),
    ).toMatchObject({ reason: 'window_close' });
  });

  it('到点开标走到期引擎（tick 第 5 步的 sea_sealed 适配器）', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    fx.sqlite.exec(`UPDATE sea_batches SET deadline_at = '${hoursFromNow(-0.5)}' WHERE id = ${batchId}`);

    const out = await runExpiryTick(fx.env, 'cron_tick');
    expect(out.byAdapter.sea_sealed).toBe(1);
    expect(out.errors).toEqual([]);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM sea_batches WHERE id = ?', batchId)).toMatchObject({
      status: 'opened',
    });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM transfers')!.n).toBe(1);
  });

  it('截止前 24h 提醒一次（reminded_at 抢占，只发还有标的队）', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    fx.sqlite.exec(`UPDATE sea_batches SET deadline_at = '${hoursFromNow(12)}' WHERE id = ${batchId}`);

    const first = await runExpiryTick(fx.env, 'cron_tick');
    expect(first.reminded).toBe(1);
    const reminder = notices(fx, 'sea_sealed_deadline', CLUB_A);
    expect(reminder.length).toBeGreaterThan(0);
    expect(JSON.parse(reminder[0].payload).text).toContain('1 份');
    expect(notices(fx, 'sea_sealed_deadline', CLUB_B)).toEqual([]); // 没出标的队不打扰

    const second = await runExpiryTick(fx.env, 'cron_tick');
    expect(second.reminded).toBe(0);
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'sea_sealed_deadline'")!.n,
    ).toBe(1); // 一次提醒只落一条（没绑平台账号的队只有 web 通道），且不会因为再跳一拍而重复
  });

  it('sea_enabled 关掉：整批作废 + 解冻（回滚不静默留冻结）', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    setSeaEnabled(fx, false);

    await runExpiryTick(fx.env, 'cron_tick');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM sea_batches WHERE id = ?', batchId)).toMatchObject({
      status: 'cancelled',
    });
    expect(bidRow(fx, 24, CLUB_A)).toMatchObject({ status: 'void', void_reason: '海捞两阶段已关闭，本批标作废' });
    expect(heldTotal(fx, CLUB_A)).toBe(0);
  });
});

describe('明标段衔接与迁移守卫', () => {
  it('收标中常规海捞被硬拦；取消批次后本窗恢复常规海捞', async () => {
    const { fx } = await seedSealed();
    const blocked = await post('/api/transfers/free-agent', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()) as { code: string }).toMatchObject({ code: 'sea_sealed_phase' });

    expect((await post('/api/admin/sea-sealed/cancel', {}, 'tok-admin', fx.env)).status).toBe(200);
    const ok = await post('/api/transfers/free-agent', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    expect(ok.status).toBe(201);
  });

  it('触发器和索引就位：冻结守卫拦非收标中的批次，唯一索引兜并发双开标', async () => {
    const { fx, batchId } = await seedSealed();
    const bid = (await (
      await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env)
    ).json()) as { bidId: number };
    const names = sqlAll<{ name: string }>(
      fx.sqlite,
      "SELECT name FROM sqlite_master WHERE type IN ('index', 'trigger') AND name IN ('fund_holds_sea_sealed_guard', 'transfers_sea_sealed_release', 'idx_transfers_sealed_bid', 'idx_sea_sealed_bids_pair')",
    ).map((r) => r.name);
    expect(names.sort()).toEqual(
      ['fund_holds_sea_sealed_guard', 'idx_sea_sealed_bids_pair', 'idx_transfers_sealed_bid', 'transfers_sea_sealed_release'].sort(),
    );

    // ① 冻结守卫：批次已开标 ⇒ 再往 sea_sealed 上挂冻结直接 ABORT
    fx.sqlite.exec(`UPDATE sea_batches SET status = 'opened' WHERE id = ${batchId}`);
    expect(() =>
      fx.sqlite
        .prepare(
          `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
           VALUES (?, 3, 'held', 'sea_sealed', ?, '2026-07-01T00:00:00Z')`,
        )
        .run(CLUB_A, bid.bidId),
    ).toThrow(/WHL_SEA_REJECT_CLOSED/);

    // ② 金额守卫：冻结额必须等于标价 × 30%
    fx.sqlite.exec(`UPDATE sea_batches SET status = 'sealed' WHERE id = ${batchId}`);
    expect(() =>
      fx.sqlite
        .prepare(
          `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
           VALUES (?, 4, 'held', 'sea_sealed', ?, '2026-07-01T00:00:00Z')`,
        )
        .run(CLUB_A, bid.bidId),
    ).toThrow(/WHL_SEA_REJECT_AMOUNT/);

    // ③ 一份标最多一张单
    fx.sqlite.exec(`UPDATE sea_sealed_bids SET status = 'won' WHERE id = ${bid.bidId}`);
    fx.sqlite.exec(
      `INSERT INTO transfers (id, type, player_id, to_club_id, fee, status, season, window_seq, sealed_bid_id, created_at)
       VALUES (950, 'free_agent', 24, ${CLUB_A}, 10, 'pending_review', 4, 1, ${bid.bidId}, '2026-07-02T00:00:00Z')`,
    );
    expect(() =>
      fx.sqlite.exec(
        `INSERT INTO transfers (id, type, player_id, to_club_id, fee, status, season, window_seq, sealed_bid_id, created_at)
         VALUES (951, 'free_agent', 24, ${CLUB_A}, 10, 'pending_review', 4, 1, ${bid.bidId}, '2026-07-02T00:00:00Z')`,
      ),
    ).toThrow(/UNIQUE/);
  });
});

describe('结算链：审核 → 谈判（签入费与冻结的对齐）', () => {
  it('审核通过：签入费扣收 + 密封冻结销毁 + 进工资谈判', async () => {
    const { fx } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const taskId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM review_tasks WHERE type = 'transfer_confirm'")!.id;
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);

    const signFee = freeAgentFee(20);
    expect(
      sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', CLUB_A),
    ).toMatchObject({ balance: 100 - signFee });
    expect(
      sqlGet<{ amount: number; kind: string }>(
        fx.sqlite,
        "SELECT amount, kind FROM ledger_entries WHERE kind = 'free_agent_fee'",
      ),
    ).toMatchObject({ amount: -signFee, kind: 'free_agent_fee' });
    // 冻结在同一次扣费里销毁（等于「这笔费已收」），否则谈判期内可用额被双重扣减
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_A)!.hold_id)).toBe('settled');
    expect(heldTotal(fx, CLUB_A)).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers')).toMatchObject({ status: 'signing' });
  });

  it('审核驳回：冻结解冻 + 标作废（单据未成约），可用额回满', async () => {
    const { fx } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const taskId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM review_tasks WHERE type = 'transfer_confirm'")!.id;
    const reject = await post(`/api/admin/reviews/${taskId}/reject`, { note: '材料不全' }, 'tok-admin', fx.env);
    expect(reject.status).toBe(200);

    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers')).toMatchObject({ status: 'rejected' });
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_A)!.hold_id)).toBe('released');
    expect(bidRow(fx, 24, CLUB_A)).toMatchObject({ status: 'void', void_reason: '单据未成约' });
    expect(heldTotal(fx, CLUB_A)).toBe(0);
    expect(
      sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', CLUB_A),
    ).toMatchObject({ balance: 100 }); // 驳回未收费
  });
});

// v6.57.0 预期收入额度：chargeBypassFee 的批内守卫必须与 availableBalance 同源（含额度）。
// 预检按「余额 − 冻结 + 额度」放行而批内守卫按现金式判，会让靠额度刚好够的单据在扣费那一批
// 409「资金刚被其他操作占用」，且重试永远不过（审核死锁）。两处一旦漂移，下面两个用例必红。
describe('结算链：附加费批内守卫（预期收入额度）', () => {
  /** 给俱乐部挂一笔在途成交单当额度来源：球员无合同 ⇒ 全额落 40% 档，净额 = fee × 0.6 */
  function seedSellCredit(fx: Fixture, clubId: number, fee: number): number {
    fx.sqlite.exec(`
      INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, created_at)
        VALUES ('transfer', 991, ${clubId}, ${CLUB_B}, ${fee}, 'pending_review', 4, 1, '2026-07-01T00:00:00Z');
    `);
    return sqlGet<{ id: number }>(fx.sqlite, 'SELECT MAX(id) AS id FROM transfers')!.id;
  }

  /**
   * 竞态注入：把 env.DB 包一层，在「扣费那一批」（含 ledgerMovement 的账户 upsert）真正执行前改库，
   * 模拟预检读完之后、批内守卫之前资金被并发动用 —— 只有批内守卫能拦下。
   */
  function raceBeforeFeeBatch(fx: Fixture, mutate: () => void): void {
    const real = fx.env.DB;
    let prepared: string[] = [];
    let fired = false;
    fx.env.DB = {
      prepare(sql: string) {
        prepared.push(sql);
        return real.prepare(sql);
      },
      batch(stmts: unknown[]) {
        const hit = !fired && prepared.some((sql) => sql.includes('INSERT INTO ledger_accounts'));
        prepared = [];
        if (hit) {
          fired = true;
          mutate();
        }
        return real.batch(stmts as never);
      },
    } as unknown as D1Database;
  }

  it('预检含额度放行、批内守卫同源放行（不 409 死锁）：余额 0 只用额度付签入费', async () => {
    const { fx } = await seedSealed();
    seedSellCredit(fx, CLUB_A, 100); // 净 60
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 0 WHERE club_id = ${CLUB_A}`);
    // 出标即冻结 6m —— 余额 0，这笔冻结本身就靠额度过闸
    expect((await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env)).status).toBe(201);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const taskId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM review_tasks WHERE type = 'transfer_confirm'")!.id;
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);

    const signFee = freeAgentFee(20);
    expect(
      sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', CLUB_A),
    ).toMatchObject({ balance: -signFee }); // 从 0 扣成负数（负=欠款）
    expect(
      sqlGet<{ amount: number; kind: string }>(fx.sqlite, "SELECT amount, kind FROM ledger_entries WHERE kind = 'free_agent_fee'"),
    ).toMatchObject({ amount: -signFee, kind: 'free_agent_fee' });
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_A)!.hold_id)).toBe('settled');
    expect(heldTotal(fx, CLUB_A)).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE sealed_bid_id IS NOT NULL')).toMatchObject({
      status: 'signing',
    });
  });

  it('批内守卫不过：显式 409，且冻结不白 settled、费用不扣、附加费不写、单据仍在待审', async () => {
    const { fx } = await seedSealed();
    const creditId = seedSellCredit(fx, CLUB_A, 100);
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 0 WHERE club_id = ${CLUB_A}`);
    expect((await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env)).status).toBe(201);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const taskId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM review_tasks WHERE type = 'transfer_confirm'")!.id;
    // 预检读完、扣费批执行前：额度来源被驳回（生产里是并发的审核驳回 / 撤单）
    raceBeforeFeeBatch(fx, () => fx.sqlite.exec(`UPDATE transfers SET status = 'rejected' WHERE id = ${creditId}`));
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as { error: string }).error).toContain('资金刚被其他操作占用');

    const signFee = freeAgentFee(20);
    expect(
      sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', CLUB_A),
    ).toMatchObject({ balance: 0 });
    expect(sqlAll(fx.sqlite, "SELECT id FROM ledger_entries WHERE kind = 'free_agent_fee'")).toEqual([]);
    // 冻结仍是 held（两条守卫 UPDATE 都挂守卫：不会再出现「钱没扣、冻结白 settled」）
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_A)!.hold_id)).toBe('held');
    expect(heldTotal(fx, CLUB_A)).toBe(signFee);
    expect(
      sqlGet<{ status: string; extra_fee: number | null }>(
        fx.sqlite,
        'SELECT status, extra_fee FROM transfers WHERE sealed_bid_id IS NOT NULL',
      ),
    ).toMatchObject({ status: 'pending_review', extra_fee: null });
  });

  // TC-B-021②：判别形态「settled 改行而 extra_fee 0 行（extra_fee 已预填）」——
  // 解约/续约链路的单据在建单时就预填 extra_fee（bypass.ts:476），海捞链路正常为 null；
  // 该形态在扣费批里 extra_fee UPDATE 恒 0 行，扣没扣只能由 settled 或流水判定，
  // 不能把「已扣费的成功」误判成失败（ Charged 判别吃两条守卫 UPDATE 的并集）。
  it('extra_fee 已预填的密封单：扣费一次、冻结 settled、不 409、预填值不被覆盖', async () => {
    const { fx } = await seedSealed();
    expect((await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, A, fx.env)).status).toBe(201);
    await post('/api/admin/sea-sealed/open', {}, 'tok-admin', fx.env);
    const signFee = freeAgentFee(20);
    // 直插预填形态（生产对应解约链路的建单预填；海捞链路本身 null，这里只造判别形态）
    fx.sqlite.exec('UPDATE transfers SET extra_fee = 6 WHERE sealed_bid_id IS NOT NULL');
    const taskId = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM review_tasks WHERE type = 'transfer_confirm'")!.id;
    const approve = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);

    // 费用恰好扣一次、冻结 settled、预填值不被二次改写
    expect(
      sqlAll<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'free_agent_fee'"),
    ).toEqual([{ amount: -signFee }]);
    expect(
      sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', CLUB_A),
    ).toMatchObject({ balance: 100 - signFee });
    expect(holdStatus(fx, bidRow(fx, 24, CLUB_A)!.hold_id)).toBe('settled');
    expect(heldTotal(fx, CLUB_A)).toBe(0);
    expect(
      sqlGet<{ status: string; extra_fee: number | null }>(
        fx.sqlite,
        'SELECT status, extra_fee FROM transfers WHERE sealed_bid_id IS NOT NULL',
      ),
    ).toMatchObject({ status: 'signing', extra_fee: signFee });
  });
});

describe('管理端：明账 + 立即开标 / 延长 / 取消', () => {
  it('明账：金额与冻结状态全可见，汇总按球员/标数/队数/最高价', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 20 }, B, fx.env);
    await post('/api/transfers/sea-sealed', { playerId: 25, newReleaseFee: 5 }, A, fx.env);

    const view = await loadSeaAdminView(fx.env);
    expect(view.enabled).toBe(true);
    expect(view.batch).toMatchObject({ id: batchId, status: 'sealed' });
    expect(view.bids.map((b) => [b.playerId, b.clubId, b.newReleaseFee, b.status, b.holdStatus])).toEqual([
      [24, CLUB_B, 20, 'sealed', 'held'],
      [24, CLUB_A, 10, 'sealed', 'held'],
      [25, CLUB_A, 5, 'sealed', 'held'],
    ]);
    expect(view.summary).toEqual({ players: 2, bids: 3, clubs: 2, top: 20 });
    // 管理端点同一份视图
    const res = await get('/api/admin/sea-sealed', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: object }).summary).toEqual(view.summary);
    // 非管理组不可读
    expect((await get('/api/admin/sea-sealed', A, fx.env)).status).toBe(403);
  });

  it('延长：批次与时刻表那一行同改，提醒位复位', async () => {
    const { fx, batchId } = await seedSealed();
    fx.sqlite.exec(`UPDATE sea_batches SET reminded_at = '2026-07-02T00:00:00.000Z' WHERE id = ${batchId}`);
    const next = hoursFromNow(48);
    const res = await post('/api/admin/sea-sealed/extend', { deadlineAt: next }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ ok: true, batch: { id: batchId, status: 'sealed', deadlineAt: next } });

    const batch = sqlGet<{ deadline_at: string; reminded_at: string; note: string }>(
      fx.sqlite,
      'SELECT deadline_at, reminded_at, note FROM sea_batches WHERE id = ?',
      batchId,
    )!;
    expect(batch.deadline_at).toBe(next);
    expect(batch.reminded_at).toBe('');
    expect(batch.note).toContain('截止延长');
    // 时刻表那一行被同步（否则到期引擎会按旧终点先一步开标）
    const row = sqlGet<{ end_anchor: string; end_at: string }>(
      fx.sqlite,
      "SELECT end_anchor, end_at FROM ops_schedule WHERE op_key = 'transfer_sea_sealed'",
    )!;
    expect(row).toMatchObject({ end_anchor: 'absolute', end_at: next });
    // 过去的截止时间不接受
    expect((await post('/api/admin/sea-sealed/extend', { deadlineAt: hoursFromNow(-1) }, 'tok-admin', fx.env)).status).toBe(400);
  });

  it('取消：全批作废 + 解冻 + 通知出标方', async () => {
    const { fx, batchId } = await seedSealed();
    await post('/api/transfers/sea-sealed', { playerId: 24, newReleaseFee: 10 }, A, fx.env);
    await post('/api/transfers/sea-sealed', { playerId: 25, newReleaseFee: 10 }, B, fx.env);
    const res = await post('/api/admin/sea-sealed/cancel', { note: '本窗改走常规海捞' }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ ok: true, voided: 2 });

    expect(bidRow(fx, 24, CLUB_A)).toMatchObject({ status: 'void', void_reason: '本窗改走常规海捞' });
    expect(bidRow(fx, 25, CLUB_B)).toMatchObject({ status: 'void', void_reason: '本窗改走常规海捞' });
    expect(heldTotal(fx, CLUB_A)).toBe(0);
    expect(heldTotal(fx, CLUB_B)).toBe(0);
    expect(notices(fx, 'sea_sealed_lost', CLUB_A).length).toBeGreaterThan(0);
    expect(sqlGet<{ status: string; note: string }>(fx.sqlite, 'SELECT status, note FROM sea_batches WHERE id = ?', batchId)).toMatchObject({
      status: 'cancelled',
      note: '本窗改走常规海捞',
    });
    expect((await findBatch(fx.env.DB, 4, 1))!.status).toBe('cancelled');
    // 取消后教练侧回到常规，不再显示暗标段
    expect((await loadSeaPhaseView(fx.env, CLUB_A)).state).toBe('none');
  });
});
