// v1.2.0：分级派生测试——级别真源=赛季定级赛事报名（auth 目录 → season_tournaments → TOUR_DB entry）。
// 覆盖：三跳命中 premier/second、未报名 400 文案、杯赛报名不干扰、双定级 500、
// second 梯度（ge87=3）端到端、建队端点双模（派生忽略/回滚写休眠列）、compliance tier_missing。
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, attachAuthChannel, sqlGet } from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL, team_id INTEGER NOT NULL, UNIQUE(tournament_id, team_id));
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0);`,
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
  for (const [uid, token] of [[1, 'tok-admin'], [2, 'tok-coach']] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  const auth = attachAuthChannel(env);
  return { env, sqlite, tour, auth };
}

function post(path: string, body: unknown, token: string, env: Env) {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` }, body: JSON.stringify(body) },
    env,
  );
}

function get(path: string, token: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
}

// 目录登记（auth team：tour_team_id=90 ↔ club_id=1）+ 账号 2 的绑定行（getBoundClub 读 AUTH_DB）
function linkClubTeam(fx: Fixture): void {
  fx.sqlite.exec("INSERT INTO clubs (id, name, status) VALUES (1, '阿森纳', 'active')");
  fx.auth.prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (90, 1, ?, ?)').run('阿森纳', '2026-01-01T00:00:00Z');
  const teamId = fx.auth.prepare('SELECT id FROM team WHERE club_id = 1').get() as { id: number };
  fx.auth.prepare("INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (2, ?, 'club', '2026-01-01T00:00:00Z')").run(teamId.id);
}

// 赛季 + 定级赛事绑定（101=顶级 / 102=次级 / 103=杯赛）
function bindSeason(fx: Fixture): void {
  fx.sqlite.exec("INSERT INTO seasons (season, status) VALUES (1, 'preparing')");
  fx.sqlite.exec(
    `INSERT INTO season_tournaments (season, tournament_id, competition_type) VALUES
       (1, 101, 'league_premier'), (1, 102, 'league_second'), (1, 103, 'champions_cup')`,
  );
}

function enter(fx: Fixture, tournamentId: number, teamId = 90): void {
  fx.tour.prepare('INSERT INTO entry (tournament_id, team_id) VALUES (?, ?)').run(tournamentId, teamId);
}

// 一支合规的顶级球队：一线 20 人（1 号门将）、训练营 3 人，全员有合同
function seedPlayers(fx: Fixture): { fullFirst: number[]; fullTrainee: number[] } {
  const player = fx.sqlite.prepare(
    "INSERT INTO players (id, uid, name, club_id, position, ca, pa, growable, status, fc_id) VALUES (?, ?, ?, 1, ?, ?, ?, 1, 'normal', ?)",
  );
  const contract = fx.sqlite.prepare(
    "INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES (?, 1, 50, ?, ?, 'import', '2026-07-01', 1)",
  );
  for (let i = 1; i <= 20; i++) {
    player.run(i, `fc${i}`, `一线${i}`, i === 1 ? 'GK' : 'CM', 80, 85, i);
    contract.run(i, 1, 'formal');
  }
  for (let i = 101; i <= 103; i++) {
    player.run(i, `fc${i}`, `青训${i - 100}`, 'CM', 60, 75, i);
    contract.run(i, 0.4, 'trainee');
  }
  return { fullFirst: Array.from({ length: 20 }, (_, i) => i + 1), fullTrainee: [101, 102, 103] };
}

const regBody = (firstTeam: number[], trainee: number[]) => ({ firstTeam, trainee });

beforeEach(() => {
  resetConfigCache();
});

describe('分级派生（v1.2.0：报名定级）', () => {
  it('报名顶级联赛 → 派生 premier，注册全链通过，探测字段与徽章数据齐', async () => {
    const fx = freshEnv();
    linkClubTeam(fx);
    bindSeason(fx);
    enter(fx, 101);
    enter(fx, 103, 90); // 杯赛也报了——不应干扰定级
    const { fullFirst, fullTrainee } = seedPlayers(fx);

    const overview = (await (await get('/api/club/squad', 'tok-coach', fx.env)).json()) as {
      club: { leagueTier: string | null };
      registeredInTournament: boolean;
      rules: { tier: string; limits: { ge87: number } } | null;
    };
    expect(overview.club.leagueTier).toBe('premier');
    expect(overview.registeredInTournament).toBe(true);
    expect(overview.rules?.tier).toBe('premier');

    const res = await post('/api/club/registrations', regBody(fullFirst, fullTrainee), 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM registrations')!.n).toBe(23);
  });

  it('报名次级联赛 → second 梯度生效（CA≥87 最多 3 名，第 4 名被点名）', async () => {
    const fx = freshEnv();
    linkClubTeam(fx);
    bindSeason(fx);
    enter(fx, 102);
    seedPlayers(fx);
    fx.sqlite.exec("UPDATE players SET ca = 90 WHERE id = 2; UPDATE players SET ca = 88 WHERE id = 3; UPDATE players SET ca = 87 WHERE id = 4; UPDATE players SET ca = 87 WHERE id = 5");
    const res = await post(
      '/api/club/registrations',
      regBody([1, 2, 3, 4, ...Array.from({ length: 16 }, (_, i) => i + 5)], []),
      'tok-coach',
      fx.env,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { rule: string; message: string }[] };
    expect(
      body.issues.some(
        (i) => i.rule === 'ca_pa' && i.message.includes('CA≥87 的球员最多 3 名') && i.message.includes('当前 4 名'),
      ),
    ).toBe(true);
  });

  it('没报定级赛事：探测 false + rules 空，提交 400 拦下且审计不落库', async () => {
    const fx = freshEnv();
    linkClubTeam(fx);
    bindSeason(fx); // 定级赛事绑了，但这队没报名
    seedPlayers(fx);

    const overview = (await (await get('/api/club/squad', 'tok-coach', fx.env)).json()) as {
      registeredInTournament: boolean;
      rules: unknown;
    };
    expect(overview.registeredInTournament).toBe(false);
    expect(overview.rules).toBeNull();

    const res = await post('/api/club/registrations', regBody([1], []), 'tok-coach', fx.env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('tier_pending');
    expect(body.error).toBe('尚未在赛事平台报名，请等待赛事平台管理员确认报名');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action='registration_submit'")!.n).toBe(0);
  });

  it('只报杯赛也算未报名（杯赛不参与定级）', async () => {
    const fx = freshEnv();
    linkClubTeam(fx);
    bindSeason(fx);
    enter(fx, 103);
    seedPlayers(fx);
    const res = await post('/api/club/registrations', regBody([1], []), 'tok-coach', fx.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('尚未在赛事平台报名');
  });

  it('双定级报名是数据异常：500 冲突提示', async () => {
    const fx = freshEnv();
    linkClubTeam(fx);
    bindSeason(fx);
    enter(fx, 101);
    enter(fx, 102);
    seedPlayers(fx);
    const res = await post('/api/club/registrations', regBody([1], []), 'tok-coach', fx.env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('分级数据冲突');
  });

  it('建队双模：派生模式忽略 leagueTier（列 NULL）；回滚模式写休眠列', async () => {
    const fx = freshEnv();
    const created = await post('/api/admin/clubs', { name: '里昂', leagueTier: 'premier', gameTeamId: 9001 }, 'tok-admin', fx.env);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { club: { id: number; leagueTier: string | null } };
    expect(body.club.leagueTier).toBeNull();
    expect(sqlGet<{ t: string | null }>(fx.sqlite, 'SELECT league_tier AS t FROM clubs WHERE id = ?', body.club.id)!.t).toBeNull();

    // 回滚通道：摘掉 AUTH_DB 即读休眠列，建队写列、派生回读
    fx.env.AUTH_DB = undefined;
    const legacy = await post('/api/admin/clubs', { name: '波尔多', leagueTier: 'second', gameTeamId: 9002 }, 'tok-admin', fx.env);
    expect(legacy.status).toBe(201);
    const legacyBody = (await legacy.json()) as { club: { id: number; leagueTier: string | null } };
    expect(legacyBody.club.leagueTier).toBe('second');
    expect(sqlGet<{ t: string | null }>(fx.sqlite, 'SELECT league_tier AS t FROM clubs WHERE id = ?', legacyBody.club.id)!.t).toBe('second');
  });

  it('管理端列表与 compliance 显示派生级别；注册未报名标 tier_missing', async () => {
    const fx = freshEnv();
    linkClubTeam(fx);
    bindSeason(fx);
    enter(fx, 101);
    fx.sqlite.exec(
      "INSERT INTO clubs (id, name, status) VALUES (2, '波尔多', 'active')", // 没登记目录、没报名
    );
    fx.sqlite.exec("INSERT INTO registrations (season, club_id, player_id, squad) VALUES (1, 2, 1, 'first_team')");
    fx.sqlite.exec("INSERT INTO players (id, uid, name, club_id, position, ca, pa, growable, status, fc_id) VALUES (1, 'fc1', '一线1', 2, 'GK', 80, 85, 1, 'normal', 1)");

    const clubs = (await (await get('/api/admin/clubs', 'tok-admin', fx.env)).json()) as {
      clubs: { id: number; leagueTier: string | null }[];
    };
    expect(clubs.clubs.find((c) => c.id === 1)?.leagueTier).toBe('premier');
    expect(clubs.clubs.find((c) => c.id === 2)?.leagueTier).toBeNull();

    const compliance = (await (await get('/api/admin/compliance', 'tok-admin', fx.env)).json()) as {
      clubs: { clubId: number; leagueTier: string | null; issues: { rule: string }[] }[];
    };
    const ok = compliance.clubs.find((c) => c.clubId === 1)!;
    const pending = compliance.clubs.find((c) => c.clubId === 2)!;
    expect(ok.leagueTier).toBe('premier');
    expect(pending.leagueTier).toBeNull();
    expect(pending.issues.some((i) => i.rule === 'tier_missing')).toBe(true);
  });
});
