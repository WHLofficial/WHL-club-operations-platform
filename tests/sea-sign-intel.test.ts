// 海捞详情面测试（v6.17.0 建立，v6.18.0 收口）：详情可签判定 seaSign 与成交参照 seaComps
// （GET /players/:id 公开面）+ 回归锚点（TC-REG：海捞提交链、激活名单）。
// v6.18.0 市场改版后 /market/sea-signs 与 /market/cpu-board 已退役：原 TC-SEA / TC-BOARD 用例
// 换成 tests/market-intel.test.ts 的 TC-REG-01（退役三端点 404）与 TC-LOOKUP-*（海捞速查），
// 端点级行为不再在本文件断言。用例名与 docs/test-plans/v6.18.0-market-ia.md 的 TC 编号一一对应。
// fixture 自建：两队 + 教练绑甲队（100m）+ 赛季 1-3 已结算 / 4 进行中 + S4 第 1 窗开放；
// 不预置任何成交单据与 CPU 队，让「参照空态」这类断言从零基数出发。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

const CLUB_A = 101; // 甲队（教练乙 tok-coach 绑定，余额 100m）
const CLUB_B = 102; // 乙队（教练丙 tok-coach2 未绑定，余额 50m）
const CPU_CLUB = 131681; // AC米兰(CPU)：CPU 队判定只看 clubs.is_cpu，不看队名

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
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
  };
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
    [9, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

function post(path: string, body: unknown, token: string | undefined, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

function seedIntel(): Fixture {
  const fx = freshEnv();
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES
       (${CLUB_A}, '甲队', 'premier', 'active', 0),
       (${CLUB_B}, '乙队', 'premier', 'active', 0);
     INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${CLUB_A}, 2, '2026-01-01T00:00:00Z');
     INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${CLUB_A}, 100, '2026-07-01T00:00:00Z'), (${CLUB_B}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${CLUB_A}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${CLUB_B}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'settled'), (2, 'settled'), (3, 'settled'), (4, 'running');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
       (3, 1, 'closed', 0, '2026-05-01T00:00:00Z', '2026-05-05T00:00:00Z'),
       (3, 2, 'closed', 0, '2026-06-01T00:00:00Z', '2026-06-05T00:00:00Z'),
       (4, 1, 'open', 0, '2026-07-01T00:00:00Z', NULL),
       (4, 2, 'closed', 0, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, base_ca, market_value, status) VALUES
       (20, 'fc20', '乡贤', ${CLUB_A}, 'ST', 26, 80, 82, 72, 15, 'normal');`,
  );
  return fx;
}

// 关掉当前开放窗（S4W1）：验证「窗口没开」这一关的文案
function closeWindow(fx: Fixture): void {
  fx.sqlite.exec(
    `UPDATE season_windows SET status = 'closed', closed_at = '2026-07-06T00:00:00Z' WHERE season = 4 AND window_seq = 1`,
  );
}

function addCpuClub(fx: Fixture): number {
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (${CPU_CLUB}, 'AC米兰(CPU)', 'premier', 'active', 1)`,
  );
  return CPU_CLUB;
}

interface PlayerSeed {
  id: number;
  name: string;
  clubId?: number | null;
  status?: string;
  ca?: number | null;
  pa?: number | null;
  position?: string;
  age?: number;
  displayName?: string;
  fcId?: number | null;
}

function addPlayer(fx: Fixture, p: PlayerSeed): number {
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, display_name, fc_id, club_id, position, age, ca, pa, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id,
      `fc${p.id}`,
      p.name,
      p.displayName ?? null,
      p.fcId ?? null,
      p.clubId ?? null,
      p.position ?? 'ST',
      p.age ?? 26,
      p.ca ?? 70,
      p.pa ?? p.ca ?? 70,
      p.status ?? 'normal',
    );
  return p.id;
}

interface SignSeed {
  playerId: number;
  fromClubId?: number | null;
  toClubId?: number;
  fee?: number | null;
  season?: number;
  windowSeq?: number;
  completedAt?: string;
  status?: string;
  type?: string;
}

function addTransfer(fx: Fixture, s: SignSeed): number {
  const at = s.completedAt ?? '2026-07-02T00:00:00Z';
  const info = fx.sqlite
    .prepare(
      `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      s.type ?? 'free_agent',
      s.playerId,
      s.fromClubId ?? null,
      s.toClubId ?? CLUB_A,
      s.fee ?? null,
      s.status ?? 'completed',
      s.season ?? 4,
      s.windowSeq ?? 1,
      at,
      at,
    );
  return Number(info.lastInsertRowid);
}

function addListing(fx: Fixture, playerId: number, status: string, type = 'normal', season = 4, windowSeq = 1): void {
  fx.sqlite
    .prepare(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, season, window_seq)
       VALUES (?, ?, ?, 10, ?, ?, ?)`,
    )
    .run(playerId, CLUB_A, type, status, season, windowSeq);
}

interface CompsRow {
  playerId: number;
  playerName: string;
  playerCa: number | null;
  fromClubName: string | null;
  toClubName: string | null;
  newReleaseFee: number | null;
  signFee: number | null;
  season: number | null;
  windowSeq: number | null;
  completedAt: string | null;
}

async function detail(
  fx: Fixture,
  playerId: number,
  token?: string,
): Promise<{ seaSign: { eligible: boolean; reason: string | null }; seaComps: { scope: string; rows: CompsRow[] } }> {
  const res = await get(`/api/players/${playerId}`, token, fx.env);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    seaSign: { eligible: boolean; reason: string | null };
    seaComps: { scope: string; rows: CompsRow[] };
  };
}

describe('TC-JUDGE 详情可签判定 seaSign（GET /players/:id，公开只读）', () => {
  it('TC-JUDGE-01 窗口没开', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 40, name: '浪人甲' });
    closeWindow(fx);
    expect((await detail(fx, 40)).seaSign).toEqual({ eligible: false, reason: '转会窗口没开，现在不能海捞' });
  });

  it('TC-JUDGE-02 有东家且非 CPU 队', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 41, name: '有主', clubId: CLUB_A });
    expect((await detail(fx, 41)).seaSign).toEqual({
      eligible: false,
      reason: '海捞只能签无归属的球员（这名球员有东家）',
    });
  });

  it('TC-JUDGE-03 状态 retired / listed 不能海捞', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 42, name: '老退', status: 'retired' });
    addPlayer(fx, { id: 43, name: '已挂', status: 'listed' });
    expect((await detail(fx, 42)).seaSign).toEqual({ eligible: false, reason: '当前状态不能海捞' });
    expect((await detail(fx, 43)).seaSign).toEqual({ eligible: false, reason: '当前状态不能海捞' });
  });

  it('TC-JUDGE-04 本窗被解约：全联盟禁签（同 season + window_seq 的 termination）', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 44, name: '旧将' });
    addTransfer(fx, { playerId: 44, type: 'termination', fee: 0, season: 4, windowSeq: 1, completedAt: '2026-07-02T00:00:00Z' });
    expect((await detail(fx, 44)).seaSign).toEqual({
      eligible: false,
      reason: '这名球员本窗口被解约过，本窗口所有球队都不能签他',
    });
    // 提交侧同一条守卫：判定的 status/errCode 由 createFreeAgent 直接抛出
    const res = await post('/api/transfers/free-agent', { playerId: 44, newReleaseFee: 5 }, 'tok-coach', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('这名球员本窗口被解约过，本窗口所有球队都不能签他');
  });

  it('TC-JUDGE-05 在途单据：listings 活跃态与 transfers pending_review', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 45, name: '挂牌中' });
    addListing(fx, 45, 'listed');
    addPlayer(fx, { id: 46, name: '竞价中' });
    addListing(fx, 46, 'bidding');
    addPlayer(fx, { id: 47, name: '匹配中' });
    addListing(fx, 47, 'matched_pending');
    addPlayer(fx, { id: 48, name: '待审核' });
    addTransfer(fx, { playerId: 48, status: 'pending_review', fee: 5 });
    addPlayer(fx, { id: 49, name: '已取消' });
    addListing(fx, 49, 'cancelled');
    const listingReason = '这名球员已经有一单在市场流程里了，等它结束再操作';
    expect((await detail(fx, 45)).seaSign).toEqual({ eligible: false, reason: listingReason });
    expect((await detail(fx, 46)).seaSign).toEqual({ eligible: false, reason: listingReason });
    expect((await detail(fx, 47)).seaSign).toEqual({ eligible: false, reason: listingReason });
    expect((await detail(fx, 48)).seaSign).toEqual({
      eligible: false,
      reason: '这名球员有一张单据正在等管理组审核，先等审核结果',
    });
    expect((await detail(fx, 49)).seaSign).toEqual({ eligible: true, reason: null }); // 已取消不算在途
  });

  it('TC-JUDGE-06 守卫顺序：ownership 先于 status，listing 先于 pending', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 50, name: '有主又退', clubId: CLUB_A, status: 'retired' });
    addPlayer(fx, { id: 51, name: '双在途' });
    addListing(fx, 51, 'listed');
    addTransfer(fx, { playerId: 51, status: 'pending_review', fee: 5 });
    expect((await detail(fx, 50)).seaSign).toEqual({
      eligible: false,
      reason: '海捞只能签无归属的球员（这名球员有东家）',
    });
    expect((await detail(fx, 51)).seaSign).toEqual({
      eligible: false,
      reason: '这名球员已经有一单在市场流程里了，等它结束再操作',
    });
  });

  it('TC-JUDGE-07 可签面：无归属 / CPU 队 / 上窗解约过都不拦', async () => {
    const fx = seedIntel();
    addCpuClub(fx);
    addPlayer(fx, { id: 52, name: '真自由身' });
    addPlayer(fx, { id: 53, name: '米兰人', clubId: CPU_CLUB }); // 有东家但 CPU 队例外
    addPlayer(fx, { id: 54, name: '上窗旧将' });
    addTransfer(fx, { playerId: 54, type: 'termination', fee: 0, season: 4, windowSeq: 2, completedAt: '2026-08-02T00:00:00Z' });
    expect((await detail(fx, 52)).seaSign).toEqual({ eligible: true, reason: null });
    expect((await detail(fx, 53)).seaSign).toEqual({ eligible: true, reason: null });
    expect((await detail(fx, 54)).seaSign).toEqual({ eligible: true, reason: null }); // 禁签只锁本窗
  });

  it('TC-JUDGE-08 详情判定与提交同源：文案逐字一致（含窗口关闭）', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 55, name: '有主', clubId: CLUB_A });
    addPlayer(fx, { id: 56, name: '在途' });
    addListing(fx, 56, 'listed');
    addPlayer(fx, { id: 57, name: '旧将' });
    addTransfer(fx, { playerId: 57, type: 'termination', fee: 0, season: 4, windowSeq: 1 });
    const pairs = [
      [55, 400, '海捞只能签无归属的球员（这名球员有东家）'],
      [56, 400, '这名球员已经有一单在市场流程里了，等它结束再操作'],
      [57, 409, '这名球员本窗口被解约过，本窗口所有球队都不能签他'],
    ] as const;
    for (const [playerId, status, reason] of pairs) {
      expect((await detail(fx, playerId)).seaSign).toEqual({ eligible: false, reason });
      const res = await post('/api/transfers/free-agent', { playerId, newReleaseFee: 5 }, 'tok-coach', fx.env);
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: string }).error).toBe(reason);
    }
    addPlayer(fx, { id: 58, name: '待窗' });
    closeWindow(fx);
    expect((await detail(fx, 58)).seaSign).toEqual({ eligible: false, reason: '转会窗口没开，现在不能海捞' });
    const late = await post('/api/transfers/free-agent', { playerId: 58, newReleaseFee: 5 }, 'tok-coach', fx.env);
    expect(late.status).toBe(409);
    const lateBody = (await late.json()) as { error: string; code: string };
    expect(lateBody.error).toBe('转会窗口没开，现在不能海捞');
    expect(lateBody.code).toBe('no_window');
  });

  it('TC-JUDGE-09 详情公开只读：匿名也带 seaSign / seaComps', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 59, name: '浪人乙' });
    const body = await detail(fx, 59); // 无 Cookie
    expect(typeof body.seaSign.eligible).toBe('boolean');
    expect(body.seaSign.reason).toBeNull();
    expect(['same_tier', 'global', 'none']).toContain(body.seaComps.scope);
    expect(Array.isArray(body.seaComps.rows)).toBe(true);
  });
});

describe('TC-COMPS 成交参照 seaComps（GET /players/:id）', () => {
  // 参照球员 CA 集中在 75–85 一档，靠 id 与 completed_at 区分新旧
  function seedComps(fx: Fixture, ca: number, pendingId: number): void {
    for (let i = 0; i < 7; i += 1) {
      const pid = 200 + i;
      addPlayer(fx, { id: pid, name: `参照${i}`, ca: 75 + i });
      addTransfer(fx, {
        playerId: pid,
        fee: 6,
        completedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      });
    }
    addPlayer(fx, { id: pendingId, name: '待判', ca });
  }

  it('TC-COMPS-01 同档：现值 CA ±5 内最近 ≤5 笔', async () => {
    const fx = seedIntel();
    seedComps(fx, 80, 210);
    addPlayer(fx, { id: 300, name: '过老', ca: 60 });
    addTransfer(fx, { playerId: 300, fee: 9, completedAt: '2026-06-30T00:00:00Z' });
    addPlayer(fx, { id: 301, name: '过强', ca: 95 });
    addTransfer(fx, { playerId: 301, fee: 9, completedAt: '2026-07-05T00:00:00Z' });
    const comps = (await detail(fx, 210)).seaComps;
    expect(comps.scope).toBe('same_tier');
    expect(comps.rows.length).toBe(5);
    // 最近 5 笔 = CA 77..81（后插的 5 笔），超界两笔与更旧的同档笔都不在
    expect(comps.rows.map((r) => r.playerCa)).toEqual([81, 80, 79, 78, 77]);
  });

  it('TC-COMPS-02 ±5 边界：恰差 5 含、差 6 不含（上下同口径）', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 400, name: '待判', ca: 80 });
    addPlayer(fx, { id: 401, name: '差五上', ca: 85 });
    addTransfer(fx, { playerId: 401, fee: 6, completedAt: '2026-06-10T00:00:00Z' });
    addPlayer(fx, { id: 402, name: '差六上', ca: 86 });
    addTransfer(fx, { playerId: 402, fee: 6, completedAt: '2026-06-11T00:00:00Z' });
    addPlayer(fx, { id: 403, name: '差六下', ca: 74 });
    addTransfer(fx, { playerId: 403, fee: 6, completedAt: '2026-06-12T00:00:00Z' });
    const first = (await detail(fx, 400)).seaComps;
    expect(first.scope).toBe('same_tier');
    expect(first.rows.map((r) => r.playerId)).toEqual([401]); // 只含差 5 那笔
    expect(first.rows[0].newReleaseFee).toBe(6);
    // 把边界那笔推成差 6：同档空 → 回落 global（差 6 两侧都不算同档）
    fx.sqlite.exec(`UPDATE players SET ca = 86 WHERE id = 401`);
    const second = (await detail(fx, 400)).seaComps;
    expect(second.scope).toBe('global');
  });

  it('TC-COMPS-03 同档空 → global 最近 3 笔 → 全空 none', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 500, name: '待判', ca: 80 });
    for (let i = 0; i < 5; i += 1) {
      const pid = 501 + i;
      addPlayer(fx, { id: pid, name: `远档${i}`, ca: 60 + i });
      addTransfer(fx, { playerId: pid, fee: 6, completedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00Z` });
    }
    const global = (await detail(fx, 500)).seaComps;
    expect(global.scope).toBe('global');
    expect(global.rows.length).toBe(3);
    expect(global.rows.map((r) => r.playerId)).toEqual([505, 504, 503]);
    fx.sqlite.exec(`DELETE FROM transfers`);
    const empty = (await detail(fx, 500)).seaComps;
    expect(empty).toEqual({ scope: 'none', rows: [] });
  });

  it('TC-COMPS-04 待判球员现值 CA 为空 → 直接 global', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 600, name: '无测值', ca: null });
    addPlayer(fx, { id: 601, name: '远档甲', ca: 60 });
    addTransfer(fx, { playerId: 601, fee: 6, completedAt: '2026-06-10T00:00:00Z' });
    addPlayer(fx, { id: 602, name: '远档乙', ca: 61 });
    addTransfer(fx, { playerId: 602, fee: 6, completedAt: '2026-06-11T00:00:00Z' });
    const comps = (await detail(fx, 600)).seaComps;
    expect(comps.scope).toBe('global');
    expect(comps.rows.map((r) => r.playerId)).toEqual([602, 601]);
  });

  it('TC-COMPS-05 跳过口径：守卫链未全过（非 ok）一律不给参照，前端只在可签面板消费', async () => {
    const fx = seedIntel();
    for (let i = 0; i < 3; i += 1) {
      const pid = 700 + i;
      addPlayer(fx, { id: pid, name: `参照${i}`, ca: 80 });
      addTransfer(fx, { playerId: pid, fee: 6, completedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00Z` });
    }
    addPlayer(fx, { id: 710, name: '有主', clubId: CLUB_A, ca: 80 });
    addPlayer(fx, { id: 711, name: '老退', status: 'retired', ca: 80 });
    addPlayer(fx, { id: 712, name: '本窗解约', ca: 80 });
    addTransfer(fx, { playerId: 712, type: 'termination', fee: 0, season: 4, windowSeq: 1 });
    addPlayer(fx, { id: 713, name: '在途', ca: 80 });
    addListing(fx, 713, 'listed');
    addPlayer(fx, { id: 714, name: '待窗', ca: 80 });
    // 全部被拦的关：详情公开面不白算参照（评审 P1：参照只服务可签面板）
    for (const pid of [710, 711, 712, 713]) {
      expect((await detail(fx, pid)).seaComps).toEqual({ scope: 'none', rows: [] });
    }
    // 唯一给参照的口径 = verdict.ok
    addPlayer(fx, { id: 715, name: '可签', ca: 80 });
    expect((await detail(fx, 715)).seaComps.scope).toBe('same_tier');
    closeWindow(fx);
    expect((await detail(fx, 714)).seaComps).toEqual({ scope: 'none', rows: [] });
    expect((await detail(fx, 714)).seaSign.reason).toBe('转会窗口没开，现在不能海捞');
  });

  it('TC-COMPS-06 参照行字段与 signFee 口径（真自由身 / CPU 原东家 / 显示名）', async () => {
    const fx = seedIntel();
    addCpuClub(fx);
    addPlayer(fx, { id: 800, name: '待判', ca: 80 });
    addPlayer(fx, { id: 801, name: '浪人', displayName: '浪人·显', ca: 79 });
    addTransfer(fx, { playerId: 801, toClubId: CLUB_B, fee: 6, completedAt: '2026-06-10T00:00:00Z' });
    addPlayer(fx, { id: 802, name: '米兰人', ca: 81, clubId: CPU_CLUB });
    addTransfer(fx, { playerId: 802, fromClubId: CPU_CLUB, toClubId: CLUB_A, fee: 7, completedAt: '2026-06-11T00:00:00Z' });
    const rows = (await detail(fx, 800)).seaComps.rows;
    expect(rows[0]).toEqual({
      playerId: 802,
      playerName: '米兰人',
      playerCa: 81,
      fromClubName: 'AC米兰(CPU)',
      toClubName: '甲队',
      newReleaseFee: 7,
      signFee: 2.1,
      season: 4,
      windowSeq: 1,
      completedAt: '2026-06-11T00:00:00Z',
    });
    expect(rows[1]).toEqual({
      playerId: 801,
      playerName: '浪人·显',
      playerCa: 79,
      fromClubName: null,
      toClubName: '乙队',
      newReleaseFee: 6,
      signFee: 1.8,
      season: 4,
      windowSeq: 1,
      completedAt: '2026-06-10T00:00:00Z',
    });
  });
});

describe('TC-REG 回归（海捞提交链与训练营通道）', () => {
  it('TC-REG-01 createFreeAgent 参数校验、404 与资金预检文案不变', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 900, name: '真自由身' });
    const bad = async (body: unknown) => {
      const res = await post('/api/transfers/free-agent', body, 'tok-coach', fx.env);
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await bad({ playerId: 0, newReleaseFee: 5 })).toBe('playerId 应为球员 ID');
    expect(await bad({ playerId: -1, newReleaseFee: 5 })).toBe('playerId 应为球员 ID');
    expect(await bad({ playerId: 1.5, newReleaseFee: 5 })).toBe('playerId 应为球员 ID');
    expect(await bad({ playerId: 'abc', newReleaseFee: 5 })).toBe('playerId 应为球员 ID');
    const feeMsg = '新违约金须为正整数（单位 m，海捞不设上下限）';
    expect(await bad({ playerId: 900, newReleaseFee: 0 })).toBe(feeMsg);
    expect(await bad({ playerId: 900, newReleaseFee: -3 })).toBe(feeMsg);
    expect(await bad({ playerId: 900, newReleaseFee: 2.5 })).toBe(feeMsg);
    const missing = await post('/api/transfers/free-agent', { playerId: 999999, newReleaseFee: 5 }, 'tok-coach', fx.env);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe('球员不存在');
    const poor = await post('/api/transfers/free-agent', { playerId: 900, newReleaseFee: 999 }, 'tok-coach', fx.env);
    expect(poor.status).toBe(400);
    expect(((await poor.json()) as { error: string }).error).toContain('海捞签入费是新违约金的 30%');
    const ok = await post('/api/transfers/free-agent', { playerId: 900, newReleaseFee: 7 }, 'tok-coach', fx.env);
    expect(ok.status).toBe(201);
    expect((await ok.json()) as { signFee: number }).toMatchObject({ newReleaseFee: 7, signFee: 2.1 });
  });

  it('TC-REG-02 青训名单等价迁移（Activatable 版）', async () => {
    const fx = seedIntel();
    addPlayer(fx, { id: 960, name: '他队苗', clubId: CLUB_B, status: 'trainee' });
    addPlayer(fx, { id: 961, name: '本队苗', clubId: CLUB_A, status: 'trainee' });
    addPlayer(fx, { id: 962, name: '已激活苗', clubId: CLUB_B, status: 'trainee' });
    // v6.18.0 的 activatable 以「生效合同」为硬前置（退役的 /market/trainees 不看合同）
    const addTraineeContract = (playerId: number, clubId: number) => {
      fx.sqlite
        .prepare(
          `INSERT INTO contracts (player_id, club_id, release_fee, contract_type, service_ticks, is_active)
           VALUES (?, ?, 5, 'trainee', 0, 1)`,
        )
        .run(playerId, clubId);
    };
    addTraineeContract(960, CLUB_B);
    addTraineeContract(962, CLUB_B);
    addListing(fx, 962, 'listed', 'activation', 4, 1);
    const res = await get('/api/market/activatable?mode=trainee', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      club: { id: number; name: string } | null;
      players: { id: number; club: { id: number; name: string }; activationFee: number; activatedThisWindow: boolean }[];
    };
    // 等价迁移口径：club 由字符串升为 {id,name}、键名 trainees → players，行集与标记不变
    expect(body.club).toEqual({ id: CLUB_A, name: '甲队' });
    expect(body.players.map((p) => [p.id, p.activatedThisWindow])).toEqual([
      [960, false],
      [962, true],
    ]);
    expect(body.players.map((p) => p.club)).toEqual([
      { id: CLUB_B, name: '乙队' },
      { id: CLUB_B, name: '乙队' },
    ]);
    expect(typeof body.players[0].activationFee).toBe('number');
    const unbound = await get('/api/market/activatable?mode=trainee', 'tok-coach2', fx.env);
    expect(unbound.status).toBe(200);
    expect(await unbound.json()).toEqual({ club: null, players: [] });
  });
});
