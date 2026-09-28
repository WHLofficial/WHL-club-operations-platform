// v6.7.0（B 块可见性）：近期主场战报 /api/club/home-matches + 窗口财务汇总 /api/club/finance-summary。
// 最坏情况口径：边界（created_at 恰等于窗端点、同刻多笔、乱序插入）与最大组（跨季 attendance 混入）为主。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';

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
       (2, '教练乙', 'coach', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
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
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
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

async function bindCoach(fx: Fixture): Promise<number> {
  const auth = attachAuthChannel(fx.env);
  const res = await post('/api/admin/clubs', { name: '阿森纳', leagueTier: 'premier', gameTeamId: 9001 }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const { club } = (await res.json()) as { club: { id: number } };
  authRegisterClubTeam(auth, club.id, club.id, '阿森纳');
  const codeRes = await post(`/api/admin/clubs/${club.id}/bindcode`, {}, 'tok-admin', fx.env);
  const { code } = (await codeRes.json()) as { code: string };
  const bind = await post('/api/clubs/bind', { code }, 'tok-coach', fx.env);
  expect(bind.status).toBe(201);
  return club.id;
}

function seedStadium(sqlite: DatabaseSync, clubId: number, capacity: number) {
  sqlite
    .prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at)
       VALUES (?, '主场', ?, 1, 0, 0, 1800, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(clubId, capacity);
}

interface AttendanceSeed {
  matchId: number;
  season: number;
  windowSeq: number;
  weather: string;
  attendance: number;
  ticket: number;
  commercial: number;
  broadcast: number;
  createdAt: string;
}

function seedAttendance(sqlite: DatabaseSync, clubId: number, rows: AttendanceSeed[]) {
  for (const r of rows) {
    sqlite
      .prepare(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.matchId, clubId, r.season, r.windowSeq, r.weather, r.attendance, r.ticket, r.commercial, r.broadcast, r.createdAt);
  }
}

interface ResultSeed {
  matchId: number;
  homeTeamId: number;
  awayTeamId: number;
  awayTeam: string;
  scoreHome?: number;
  scoreAway?: number;
  penHome?: number;
  penAway?: number;
  walkoverSide?: string;
}

function seedResults(sqlite: DatabaseSync, rows: ResultSeed[]) {
  for (const r of rows) {
    sqlite
      .prepare(
        `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id,
            away_team, score_home, score_away, pen_home, pen_away, walkover_side)
         VALUES (2026, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.matchId, r.homeTeamId, r.awayTeamId, r.awayTeam, r.scoreHome ?? null, r.scoreAway ?? null, r.penHome ?? null, r.penAway ?? null, r.walkoverSide ?? null);
  }
}

interface EntrySeed {
  kind: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
  refType?: string | null;
  refId?: number | null;
}

/** 按数组顺序插入（id 递增）——「后插的反而时间早」这条乱序用例靠顺序本身构造 */
function seedEntries(sqlite: DatabaseSync, clubId: number, rows: EntrySeed[]) {
  for (const r of rows) {
    sqlite
      .prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '种子流水', ?)`,
      )
      .run(clubId, r.kind, r.amount, r.balanceAfter, r.refType ?? null, r.refId ?? null, r.createdAt);
  }
}

function seedWindowsAndSeason(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO seasons (season, status, created_at) VALUES (2026, 'running', '2026-01-01T00:00:00Z');
    -- 两窗边界刻意留 1 秒缝隙（01-31T23:59:59Z 关、02-01T00:00:00Z 开），端点归属无歧义
    INSERT INTO season_windows (season, window_seq, status, opened_at, closed_at) VALUES
      (2026, 1, 'closed', '2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z'),
      (2026, 2, 'open',   '2026-02-01T00:00:00Z', NULL);
  `);
}

describe('GET /api/club/home-matches（v6.7.0 B1 近期主场战报）', () => {
  it('未绑定俱乐部：空档形状', async () => {
    const fx = freshEnv();
    const res = await get('/api/club/home-matches', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({ club: null, matches: [] });
  });

  it('胜/平/负/点球/弃权/无赛果六态 + 上座率 + 收入合计 + 快照对手名', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    seedStadium(fx.sqlite, clubId, 20000);
    seedResults(fx.sqlite, [
      { matchId: 1, homeTeamId: clubId, awayTeamId: 11, awayTeam: '客队甲', scoreHome: 2, scoreAway: 1 },
      { matchId: 2, homeTeamId: clubId, awayTeamId: 12, awayTeam: '客队乙', scoreHome: 0, scoreAway: 3 },
      { matchId: 3, homeTeamId: clubId, awayTeamId: 13, awayTeam: '客队丙', scoreHome: 1, scoreAway: 1 },
      { matchId: 4, homeTeamId: clubId, awayTeamId: 14, awayTeam: '客队丁', scoreHome: 1, scoreAway: 1, penHome: 4, penAway: 5 },
      { matchId: 5, homeTeamId: clubId, awayTeamId: 15, awayTeam: '客队戊', walkoverSide: 'home' },
      // match 6 没有 result_confirmations 行（理论上不该发生，防御性展示「待定」）
    ]);
    seedAttendance(fx.sqlite, clubId, [
      { matchId: 1, season: 2026, windowSeq: 1, weather: '晴', attendance: 15000, ticket: 2.25, commercial: 0.15, broadcast: 0.3, createdAt: '2026-01-10T00:00:00Z' },
      { matchId: 2, season: 2026, windowSeq: 1, weather: '雨', attendance: 12000, ticket: 1.8, commercial: 0.12, broadcast: 0.3, createdAt: '2026-01-12T00:00:00Z' },
      { matchId: 3, season: 2026, windowSeq: 1, weather: '多云', attendance: 20000, ticket: 3, commercial: 0.2, broadcast: 0.3, createdAt: '2026-01-14T00:00:00Z' },
      { matchId: 4, season: 2026, windowSeq: 1, weather: '雪', attendance: 9000, ticket: 1.35, commercial: 0.09, broadcast: 0.3, createdAt: '2026-01-16T00:00:00Z' },
      { matchId: 5, season: 2026, windowSeq: 1, weather: '晴', attendance: 18000, ticket: 2.7, commercial: 0.18, broadcast: 0.3, createdAt: '2026-01-18T00:00:00Z' },
      { matchId: 6, season: 2026, windowSeq: 1, weather: '晴', attendance: 17000, ticket: 2.55, commercial: 0.17, broadcast: 0.3, createdAt: '2026-01-20T00:00:00Z' },
    ]);

    const res = await get('/api/club/home-matches', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { club: { id: number; name: string }; matches: { matchId: number; opponentName: string | null; scoreText: string | null; result: string | null; weather: string | null; attendance: number; attendanceRate: number | null; total: number }[] };
    expect(body.club).toEqual({ id: clubId, name: '阿森纳' });
    expect(body.matches).toHaveLength(6);
    // created_at 倒序：最新一场在最前
    expect(body.matches.map((m) => m.matchId)).toEqual([6, 5, 4, 3, 2, 1]);
    const byId = new Map(body.matches.map((m) => [m.matchId, m]));
    expect(byId.get(1)).toMatchObject({ opponentName: '客队甲', scoreText: '2:1', result: '胜', weather: '晴', attendanceRate: 0.75, total: 2.7 });
    expect(byId.get(2)).toMatchObject({ result: '负' });
    expect(byId.get(3)).toMatchObject({ scoreText: '1:1', result: '平' });
    expect(byId.get(4)).toMatchObject({ scoreText: '1:1', result: '点球负' });
    expect(byId.get(5)).toMatchObject({ scoreText: null, result: '弃权胜' });
    expect(byId.get(6)).toMatchObject({ opponentName: null, scoreText: null, result: null });
  });

  it('超过 10 场只回最近 10 场（created_at 倒序截断）', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    seedStadium(fx.sqlite, clubId, 20000);
    seedAttendance(
      fx.sqlite,
      clubId,
      Array.from({ length: 12 }, (_, i) => ({
        matchId: i + 1,
        season: 2026,
        windowSeq: 1,
        weather: '晴',
        attendance: 10000,
        ticket: 1.5,
        commercial: 0.1,
        broadcast: 0.3,
        createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      })),
    );
    const res = await get('/api/club/home-matches', 'tok-coach', fx.env);
    const body = (await res.json()) as { matches: { matchId: number }[] };
    expect(body.matches).toHaveLength(10);
    expect(body.matches[0]!.matchId).toBe(12); // 最新
    expect(body.matches[9]!.matchId).toBe(3); // 第 11、12 早的被截掉
  });

  it('没有球场档案也不炸（capacity 缺 → 上座率 null）', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    seedAttendance(fx.sqlite, clubId, [
      { matchId: 1, season: 2026, windowSeq: 1, weather: '晴', attendance: 10000, ticket: 1.5, commercial: 0.1, broadcast: 0.3, createdAt: '2026-01-10T00:00:00Z' },
    ]);
    const res = await get('/api/club/home-matches', 'tok-coach', fx.env);
    const body = (await res.json()) as { matches: { attendanceRate: number | null }[] };
    expect(body.matches[0]!.attendanceRate).toBeNull();
  });
});

describe('GET /api/club/finance-summary（v6.7.0 B2 窗口财务汇总）', () => {
  it('未绑定俱乐部：空档形状', async () => {
    const fx = freshEnv();
    const res = await get('/api/club/finance-summary', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({ club: null, season: null, windows: [], outside: null, totals: null });
  });

  it('season 参数不合法回 400', async () => {
    const fx = freshEnv();
    await bindCoach(fx);
    const res = await get('/api/club/finance-summary?season=abc', 'tok-coach', fx.env);
    expect(res.status).toBe(400);
    await res.json();
  });

  it('归窗边界：恰等于 opened_at / closed_at 各一笔都在窗内；在开窗口吃掉其后全部；窗外流水进 outside；乱序插入不动 closingBalance', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    seedWindowsAndSeason(fx.sqlite);
    // 插入顺序 = id 顺序。注意：01-31T23:59:59Z 的维护费之后又插了一笔 created_at 更早（01-10）的流水，
    // 用来钉死 closingBalance 按 (created_at, id) 取而不是按 id 取——按 id 取会把 80.4 当成窗 1 期末余额。
    seedEntries(fx.sqlite, clubId, [
      { kind: 'opening_import', amount: 100, balanceAfter: 100, createdAt: '2025-12-01T00:00:00Z' }, // → outside（季前）
      { kind: 'manual_adjust', amount: 10, balanceAfter: 110, createdAt: '2026-01-01T00:00:00Z' }, // 恰等 opened_at → 窗 1
      { kind: 'wage', amount: -20, balanceAfter: 90, createdAt: '2026-01-15T00:00:00Z' },
      { kind: 'maintenance', amount: -3.6, balanceAfter: 86.4, createdAt: '2026-01-31T23:59:59Z' }, // 恰等 closed_at → 窗 1（期末余额 86.4）
      { kind: 'transfer_out', amount: -6, balanceAfter: 80.4, createdAt: '2026-01-10T00:00:00Z' }, // 后插但时间早，仍归窗 1
      { kind: 'naming_fee', amount: 2, balanceAfter: 82.4, createdAt: '2026-02-05T00:00:00Z' }, // → 窗 2
      { kind: 'transfer_in', amount: 5, balanceAfter: 87.4, createdAt: '2026-03-01T00:00:00Z' }, // 在开窗口（closed_at NULL）
    ]);
    seedAttendance(fx.sqlite, clubId, [
      { matchId: 1, season: 2026, windowSeq: 1, weather: '晴', attendance: 15000, ticket: 5, commercial: 1, broadcast: 1, createdAt: '2026-01-10T00:00:00Z' },
      { matchId: 2, season: 2026, windowSeq: 1, weather: '雨', attendance: 16000, ticket: 6, commercial: 1, broadcast: 1, createdAt: '2026-01-20T00:00:00Z' },
      { matchId: 3, season: 2026, windowSeq: 2, weather: '晴', attendance: 17000, ticket: 7, commercial: 1, broadcast: 1, createdAt: '2026-02-10T00:00:00Z' },
      { matchId: 9, season: 2025, windowSeq: 1, weather: '晴', attendance: 99000, ticket: 99, commercial: 9, broadcast: 9, createdAt: '2025-12-01T00:00:00Z' }, // 跨季混入，必须不计
    ]);

    const res = await get('/api/club/finance-summary', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      season: number | null;
      windows: { windowSeq: number; status: string; isTemporary: boolean; matchday: { matches: number; attendance: number; ticket: number; total: number }; byKind: Record<string, number>; net: number; closingBalance: number | null }[];
      outside: { byKind: Record<string, number>; net: number; total: number } | null;
      totals: { matchday: { matches: number; attendance: number; total: number }; net: number; closingBalance: number | null } | null;
    };
    expect(body.season).toBe(2026); // seasons 表 running 行 → 缺省取当前赛季
    expect(body.windows).toHaveLength(2);

    const w1 = body.windows[0]!;
    expect(w1.status).toBe('closed');
    expect(w1.isTemporary).toBe(false);
    expect(w1.matchday).toMatchObject({ matches: 2, attendance: 31000, ticket: 11, total: 15 }); // 2025 的 99 不计
    expect(w1.byKind).toEqual({ manual_adjust: 10, wage: -20, maintenance: -3.6, transfer_out: -6 });
    expect(w1.net).toBeCloseTo(-19.6, 6);
    expect(w1.closingBalance).toBeCloseTo(86.4, 6); // 按 created_at 取末笔（01-31T23:59:59Z），不是后插的 80.4

    const w2 = body.windows[1]!;
    expect(w2.status).toBe('open');
    expect(w2.matchday).toMatchObject({ matches: 1, attendance: 17000, total: 9 });
    expect(w2.byKind).toEqual({ naming_fee: 2, transfer_in: 5 });
    expect(w2.net).toBe(7);
    expect(w2.closingBalance).toBeCloseTo(87.4, 6);

    expect(body.outside).not.toBeNull();
    expect(body.outside!.byKind).toEqual({ opening_import: 100 });
    expect(body.outside!.total).toBe(100);

    expect(body.totals!.matchday).toMatchObject({ matches: 3, attendance: 48000, total: 24 });
    expect(body.totals!.net).toBeCloseTo(-12.6, 6);
    expect(body.totals!.closingBalance).toBeCloseTo(87.4, 6);
  });

  it('显式 season 参数只聚合该季；该季没窗口时 windows 空、流水全进 outside', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    seedWindowsAndSeason(fx.sqlite);
    seedEntries(fx.sqlite, clubId, [
      { kind: 'manual_adjust', amount: 3, balanceAfter: 3, createdAt: '2026-02-02T00:00:00Z' },
    ]);
    const res = await get('/api/club/finance-summary?season=2027', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { season: number; windows: unknown[]; outside: { total: number } | null; totals: unknown };
    expect(body.season).toBe(2027);
    expect(body.windows).toEqual([]);
    expect(body.outside!.total).toBe(3);
    expect(body.totals).toBeNull();
  });

  it('赛季期末余额回退到最后一笔有流水的窗口；金额求和收两位小数尾差', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    seedWindowsAndSeason(fx.sqlite);
    seedEntries(fx.sqlite, clubId, [
      // 0.1 + 0.2 的浮点尾差必须被收口（window.net 与 totals.net 都要 0.3 而不是 0.30000000000000004）
      { kind: 'manual_adjust', amount: 0.1, balanceAfter: 0.1, createdAt: '2026-01-05T00:00:00Z' },
      { kind: 'manual_adjust', amount: 0.2, balanceAfter: 0.3, createdAt: '2026-01-06T00:00:00Z' },
    ]);
    const res = await get('/api/club/finance-summary', 'tok-coach', fx.env);
    const body = (await res.json()) as { windows: { net: number; closingBalance: number | null }[]; totals: { net: number; closingBalance: number | null } | null };
    expect(body.windows).toHaveLength(2);
    expect(body.windows[0]!.net).toBe(0.3);
    expect(body.windows[0]!.closingBalance).toBeCloseTo(0.3, 6);
    // 窗 2 全季无流水：closingBalance null，但赛季合计要回退到窗 1 的 0.3，不是 null
    expect(body.windows[1]!.closingBalance).toBeNull();
    expect(body.totals!.net).toBe(0.3);
    expect(body.totals!.closingBalance).toBeCloseTo(0.3, 6);
  });

  it('赛季不存在（无 seasons 行且无 season 参数）→ season null 空档', async () => {
    const fx = freshEnv();
    await bindCoach(fx);
    const res = await get('/api/club/finance-summary', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { season: number | null; windows: unknown[]; totals: unknown };
    expect(body.season).toBeNull();
    expect(body.windows).toEqual([]);
    expect(body.totals).toBeNull();
  });
});
