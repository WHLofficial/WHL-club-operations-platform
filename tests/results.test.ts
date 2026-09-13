// 赛季管理、赛事绑定与赛果确认（附录 A〔6〕，§11）：TOUR_DB 只读同步、确认快照幂等、绑定唯一性
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

// 比赛系统库表（照 WHL-tournament-management-system 迁移裁剪：只含平台同步用到的列）
const TOUR_SCHEMA = `
  CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
  CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT);
  CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER, seed INTEGER);
  CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE match (
    id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER, slot INTEGER,
    home_entry_id INTEGER, away_entry_id INTEGER,
    score_home INTEGER, score_away INTEGER, pen_home INTEGER, pen_away INTEGER,
    status TEXT, winner_entry_id INTEGER, finished_at TEXT, walkover_side TEXT DEFAULT ''
  );`;

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `${TOUR_SCHEMA}
     CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0);`,
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
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
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

function seedTournament(fx: Fixture): void {
  fx.tour.exec(`
    INSERT INTO tournament (id, name, status) VALUES (5, 'S3 顶级联赛', 'running'), (6, 'S3 冠军杯', 'running');
    INSERT INTO stage (id, tournament_id, kind, sort_order, name) VALUES (50, 5, 'round_robin', 1, '常规赛'), (60, 6, 'elim', 1, NULL);
    INSERT INTO team (id, name) VALUES (1, '阿森纳'), (2, '曼城'), (3, '切尔西');
    INSERT INTO entry (id, tournament_id, team_id, seed) VALUES
      (11, 5, 1, 1), (12, 5, 2, 2), (13, 6, 3, 1);
    INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, winner_entry_id, finished_at)
      VALUES (900, 50, 1, 1, 11, 12, 2, 1, 'finished', 11, '2026-07-03T21:00:00Z'),
             (901, 50, 1, 2, 12, 11, 0, 3, 'finished', 11, '2026-07-04T21:00:00Z'),
             (902, 50, 2, 1, 11, 12, NULL, NULL, 'pending', NULL, NULL);
    INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, walkover_side, winner_entry_id, finished_at)
      VALUES (903, 60, 1, 1, 13, NULL, 0, 3, 'finished', 'home', NULL, '2026-07-05T21:00:00Z');
  `);
}

async function openWindowFor(fx: Fixture, season: number, windowSeq: number): Promise<void> {
  const res = await post('/api/admin/windows/open', { season, windowSeq }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
}

describe('赛季与赛事绑定（§11）', () => {
  it('建赛季 → 开窗 → 绑赛事 → 公开端点可见；开窗把备赛期推进到进行中', async () => {
    const fx = freshEnv();
    seedTournament(fx);
    const created = await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
    expect(created.status).toBe(201);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM seasons WHERE season = 3')?.status).toBe('preparing');

    await openWindowFor(fx, 3, 1);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM seasons WHERE season = 3')?.status).toBe('running');

    const bind = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );
    expect(bind.status).toBe(200);
    expect(((await bind.json()) as { tournament: { name: string } }).tournament.name).toBe('S3 顶级联赛');

    const current = await get('/api/seasons/current', 'tok-admin', fx.env);
    expect(current.status).toBe(200);
    const body = (await current.json()) as {
      season: { season: number; status: string } | null;
      window: { season: number; windowSeq: number; tournamentId: number; competitionType: string } | null;
    };
    expect(body.season).toEqual({ season: 3, status: 'running' });
    expect(body.window).toMatchObject({ season: 3, windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' });
  });

  it('重复建赛季 409；一座赛事绑两个窗口 409；类型/赛事/窗口非法全 400/404', async () => {
    const fx = freshEnv();
    seedTournament(fx);
    await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
    const dup = await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
    expect(dup.status).toBe(409);

    await openWindowFor(fx, 3, 1);
    const ok = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );
    expect(ok.status).toBe(200);
    // 一次只能开一个窗：关窗 1 开窗 2，再试把同一赛事绑过去
    const closed = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(closed.status).toBe(200);
    await openWindowFor(fx, 3, 2);
    const doubleBind = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 2, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );
    expect(doubleBind.status).toBe(409);

    const badType = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 2, tournamentId: 5, competitionType: 'fa_cup' },
      'tok-admin',
      fx.env,
    );
    expect(badType.status).toBe(400);
    const noTour = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 2, tournamentId: 777, competitionType: 'super_cup' },
      'tok-admin',
      fx.env,
    );
    expect(noTour.status).toBe(404);
    const noWindow = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 9, tournamentId: 5, competitionType: 'super_cup' },
      'tok-admin',
      fx.env,
    );
    expect(noWindow.status).toBe(404);
  });
});

describe('赛果只读同步与确认（附录 A〔6〕）', () => {
  it('队列只出绑定赛事的完赛场次；确认落快照+审计；重复确认 409', async () => {
    const fx = freshEnv();
    seedTournament(fx);
    await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
    await openWindowFor(fx, 3, 1);
    await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );

    const q1 = (await (await get('/api/admin/results/queue', 'tok-admin', fx.env)).json()) as {
      queue: { matchId: number; homeTeam: string; scoreHome: number | null }[];
      confirmed: unknown[];
    };
    // tournament 5 的 900/901 完赛在列，902 未完赛不在；tournament 6 未绑定不出现
    expect(q1.queue.map((r) => r.matchId).sort()).toEqual([900, 901]);
    expect(q1.confirmed).toEqual([]);

    const confirm = await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    expect(confirm.status).toBe(201);
    const snapshot = ((await confirm.json()) as { result: { homeTeam: string; scoreHome: number; scoreAway: number; season: number; windowSeq: number } }).result;
    expect(snapshot).toMatchObject({ homeTeam: '阿森纳', scoreHome: 2, scoreAway: 1, season: 3, windowSeq: 1 });

    const again = await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    expect(again.status).toBe(409);

    const q2 = (await (await get('/api/admin/results/queue', 'tok-admin', fx.env)).json()) as {
      queue: { matchId: number }[];
      confirmed: { matchId: number; winnerTeam: string | null }[];
    };
    expect(q2.queue.map((r) => r.matchId)).toEqual([901]);
    expect(q2.confirmed).toHaveLength(1);
    expect(q2.confirmed[0]).toMatchObject({ matchId: 900, winnerTeam: '阿森纳' });
    expect(sqlGet<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'result_confirm'")?.action).toBe('result_confirm');
  });

  it('未完赛不能确认；未绑定赛事不能确认；找不到比赛 404', async () => {
    const fx = freshEnv();
    seedTournament(fx);
    await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
    await openWindowFor(fx, 3, 1);
    await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );

    const pending = await post('/api/admin/results/902/confirm', {}, 'tok-admin', fx.env);
    expect(pending.status).toBe(409);
    const unbound = await post('/api/admin/results/903/confirm', {}, 'tok-admin', fx.env);
    expect(unbound.status).toBe(409);
    const missing = await post('/api/admin/results/999/confirm', {}, 'tok-admin', fx.env);
    expect(missing.status).toBe(404);
  });

  it('赛季结算后不得再绑赛事（防结算后改判入账）', async () => {
    const fx = freshEnv();
    seedTournament(fx);
    fx.sqlite.exec("INSERT INTO seasons (season, status, created_at) VALUES (3, 'settled', '2026-01-01T00:00:00Z')");
    await openWindowFor(fx, 3, 1);
    const res = await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );
    expect(res.status).toBe(409);
  });
});
