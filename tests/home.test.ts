// v1.5.0：主场收入域——影响力公式（规则 4.1.2/4.1.3）、上座三分收入、确认钩子④、窗末维护费+死忠演化、管理端点
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam } from './d1.ts';
import type { Env } from '../src/worker/env.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { confirmResult } from '../src/worker/results.ts';
import {
  abilityTier,
  playerAbilityLevel,
  playerInfluenceSum,
  teamInfluence,
  rollWeather,
  formPtsOf,
  diehardTarget,
  evolveFans,
  loadAttendanceModel,
  windowHomeStatements,
} from '../src/worker/home.ts';
import { app } from '../src/worker/index.ts';
import { clubIdByTourTeam } from '../src/worker/prizes.ts';

function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const tour = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const { sqlite: authSqlite, d1: authD1 } = createAuthDb();
  const env = {
    DB: createTestD1(sqlite),
    AUTH_DB: authD1,
    TOUR_DB: createTestD1(tour),
    rng: () => 0.5,
  } as unknown as Env;
  return { env, sqlite, auth: authSqlite, tour };
}

function seedTourSchema(tour: DatabaseSync) {
  tour.exec(`
    CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
    CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT, config_json TEXT DEFAULT '{}');
    CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER);
    CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE player (id INTEGER PRIMARY KEY, name TEXT, team_id INTEGER);
    CREATE TABLE match_event (id INTEGER PRIMARY KEY, match_id INTEGER, type TEXT, player_id INTEGER, assist_player_id INTEGER);
    CREATE TABLE match (id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER,
      home_entry_id INTEGER, away_entry_id INTEGER, winner_entry_id INTEGER,
      score_home REAL, score_away REAL, pen_home REAL, pen_away REAL,
      walkover_side TEXT, status TEXT, finished_at TEXT);
  `);
}

function seedClubWithTeam(auth: DatabaseSync, sqlite: DatabaseSync, clubId: number, tourTeamId: number) {
  sqlite.prepare(`INSERT INTO clubs (id, name, status) VALUES (?, ?, 'active')`).run(clubId, `俱乐部${clubId}`);
  sqlite.prepare(`INSERT INTO ledger_accounts (club_id, balance) VALUES (?, 0)`).run(clubId);
  authRegisterClubTeam(auth, tourTeamId, clubId, `队${tourTeamId}`);
}

interface MatchFixture {
  matchId: number;
  tournamentId: number;
  stageId: number;
  homeTeamId: number;
  awayTeamId: number;
  scoreHome?: number;
  scoreAway?: number;
  penHome?: number;
  penAway?: number;
  stageKind: string;
}

function insertMatch(tour: DatabaseSync, f: MatchFixture) {
  tour.prepare('INSERT OR IGNORE INTO tournament (id, name, status) VALUES (?, ?, ?)').run(f.tournamentId, `赛事${f.tournamentId}`, 'active');
  tour
    .prepare('INSERT OR IGNORE INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (?, ?, ?, 1, NULL, ?)')
    .run(f.stageId, f.tournamentId, f.stageKind, '{}');
  const homeEntry = f.matchId * 2;
  const awayEntry = f.matchId * 2 + 1;
  tour.prepare('INSERT INTO entry (id, tournament_id, team_id) VALUES (?, ?, ?), (?, ?, ?)').run(homeEntry, f.tournamentId, f.homeTeamId, awayEntry, f.tournamentId, f.awayTeamId);
  tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, home_entry_id, away_entry_id, winner_entry_id,
         score_home, score_away, pen_home, pen_away, walkover_side, status, finished_at)
       VALUES (?, ?, 0, ?, ?, NULL, ?, ?, ?, ?, NULL, 'finished', '2026-09-16T00:00:00Z')`,
    )
    .run(f.matchId, f.stageId, homeEntry, awayEntry, f.scoreHome ?? null, f.scoreAway ?? null, f.penHome ?? null, f.penAway ?? null);
}

function insertBinding(sqlite: DatabaseSync, season: number, tournamentId: number, competitionType: string) {
  sqlite.prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, '2026-09-16T00:00:00Z')`).run(season, tournamentId, competitionType);
}

function seedStadium(
  sqlite: DatabaseSync,
  clubId: number,
  opts: { capacity?: number; tier?: number; shell?: number; bonus?: number; fans?: number; name?: string } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(clubId, opts.name ?? '', opts.capacity ?? 20000, opts.tier ?? 0, opts.shell ?? 0, opts.bonus ?? 0, opts.fans ?? 1800);
}

function seedPlayer(sqlite: DatabaseSync, id: number, clubId: number, opts: { ca?: number; pa?: number; prestige?: number; growable?: number }) {
  sqlite
    .prepare(`INSERT INTO players (id, uid, name, club_id, age, ca, pa, prestige, growable, growth_tier) VALUES (?, ?, ?, ?, 24, ?, ?, ?, ?, 1)`)
    .run(id, `p${id}`, `球员${id}`, clubId, opts.ca ?? 70, opts.pa ?? 70, opts.prestige ?? 0, opts.growable ?? 0);
  sqlite
    .prepare(`INSERT INTO contracts (id, player_id, club_id, release_fee, wage, effective_from, is_active) VALUES (?, ?, ?, 100, 1, '2026-01-01T00:00:00Z', 1)`)
    .run(id, id, clubId);
}

beforeEach(() => resetConfigCache());

describe('影响力公式（规则 v5.2 4.1.2/4.1.3）', () => {
  it('能力等级十档表边界：可成长=(CA档+PA档)/2、非成长=CA档', () => {
    expect(abilityTier(93)).toBe(10);
    expect(abilityTier(92)).toBe(9);
    expect(abilityTier(87)).toBe(8);
    expect(abilityTier(84)).toBe(7);
    expect(abilityTier(80)).toBe(6);
    expect(abilityTier(79)).toBe(5);
    expect(abilityTier(60)).toBe(2);
    expect(abilityTier(59)).toBe(1);
    expect(abilityTier(null)).toBe(1);
    expect(playerAbilityLevel(80, 92, 1)).toBe(7.5); // (6+9)/2
    expect(playerAbilityLevel(93, 95, 0)).toBe(10);
    expect(playerAbilityLevel(null, 95, 1)).toBe(1);
  });

  it('球员影响力总和：可成长 0.25/非成长 0.13 × 等级 × 声望；球队影响力=Σ球员+队壳+奖励分', async () => {
    const fx = freshEnv();
    fx.sqlite.prepare(`INSERT INTO clubs (id, name, status) VALUES (1, '甲', 'active')`).run();
    seedPlayer(fx.sqlite, 1, 1, { ca: 80, pa: 92, prestige: 4, growable: 1 }); // 0.25×7.5×4=7.5
    seedPlayer(fx.sqlite, 2, 1, { ca: 93, pa: 95, prestige: 5, growable: 0 }); // 0.13×10×5=6.5
    const model = await loadAttendanceModel(fx.env.DB);
    expect(await playerInfluenceSum(fx.env, 1, model)).toBeCloseTo(14);
    const s = { shell_influence: 30, bonus_points: 10 };
    expect(teamInfluence(s, 14)).toBe(54);
  });
});

describe('纯函数：天气/战绩/死忠', () => {
  it('天气按概率表掷出（rng 序列 0.1/0.5/0.75/0.95 → 晴/多云/雨/雪）', () => {
    const probs = { 晴: 0.4, 多云: 0.3, 雨: 0.2, 雪: 0.1 };
    expect(rollWeather(() => 0.1, probs)).toBe('晴');
    expect(rollWeather(() => 0.5, probs)).toBe('多云');
    expect(rollWeather(() => 0.75, probs)).toBe('雨');
    expect(rollWeather(() => 0.95, probs)).toBe('雪');
  });

  it('近3场战绩：胜3平1负0；点球决胜按平局计（用户裁决）；弃权按 winner；不足3场中性 4 分', () => {
    const row = (over: Partial<Parameters<typeof formPtsOf>[0][number]>) => ({
      home_team_id: 1,
      away_team_id: 2,
      score_home: null,
      score_away: null,
      pen_home: null,
      pen_away: null,
      walkover_side: null,
      ...over,
    });
    const rows = [
      row({ score_home: 2, score_away: 1 }), // 胜
      row({ score_home: 1, score_away: 1, pen_home: 4, pen_away: 5 }), // 点球决胜=平（1分）
      row({ score_home: 0, score_away: 3 }), // 负
      row({ walkover_side: 'home' }), // 名额已满不取
    ];
    expect(formPtsOf(rows, 1)).toBe(4);
    expect(formPtsOf(rows.slice(0, 3), 1)).toBe(4);
    // 弃权胜 + 真胜 + 平 = 7
    const rows2 = [
      row({ walkover_side: 'home' }),
      row({ score_home: 3, score_away: 0 }),
      row({ score_home: 1, score_away: 1, pen_home: 5, pen_away: 3 }),
    ];
    expect(formPtsOf(rows2, 1)).toBe(7);
  });

  it('死忠目标阶梯逐带累计；演化涨粉/掉粉方向与钳帽', async () => {
    const fx = freshEnv();
    const model = await loadAttendanceModel(fx.env.DB);
    expect(diehardTarget(model, 100)).toBe(2600);
    expect(diehardTarget(model, 140)).toBe(3560); // 120×26 + 20×22
    expect(diehardTarget(model, 240)).toBe(5080); // +40×15 +40×12（开放段）
    // 涨粉：coef=0.5×(0.6+0.4×1)=0.5 → 1800+1760×0.5=2680；战绩 ≥7 ×1.05
    expect(evolveFans(model, 1800, 3560, 1, 4)).toBeCloseTo(2680);
    expect(evolveFans(model, 1800, 3560, 1, 8)).toBeCloseTo(2814);
    // 掉粉：diff=-320，coef=0.5×(1+0.8×(1-1))=0.5 → 3000-160=2840
    expect(evolveFans(model, 3000, 2680, 1, 4)).toBeCloseTo(2840);
    // 低上座掉粉加速：coef=0.5×(1+0.8×0.5)=0.7 → 3000-224
    expect(evolveFans(model, 3000, 2680, 0.5, 4)).toBeCloseTo(2776);
  });
});

describe('确认钩子④：三分收入即时入账（v1.5.0）', () => {
  it('主场确认→比赛日收入 ledger + 上座快照（rng=0.5 确定值）；无球场行跳过', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 12);
    // 主队球场：队壳 90 → 影响力 90（无球员）→ 对手系数 1+0.05×90/90=1.05
    seedStadium(fx.sqlite, 1, { shell: 90 });
    fx.sqlite.prepare(`INSERT INTO club_facilities (club_id, facility_key, level) VALUES (1, 'commercial', 2), (1, 'broadcast', 3)`).run();
    // 客队无球场行 → 客队影响力走默认 90
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 2, scoreAway: 0, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    const res = await confirmResult(fx.env, 1, 1, 'user');
    expect(res.revenueError).toBeNull();
    expect(res.prizeError).toBeNull();

    // rng=0.5：天气多云（0.5 落在 0.4-0.7 段）、wx=0.97、扰动=1.0；战中性 4→系数 1.0；
    // 对手系数 = 1+0.05×(90/90)=1.05；需求 = 1800×4.0×1×0.97×1.05 = 7333.2 → 上座 7333
    const att = fx.sqlite.prepare('SELECT * FROM match_attendance WHERE match_id = 1').get() as {
      club_id: number;
      weather: string;
      attendance: number;
      ticket: number;
      commercial: number;
      broadcast: number;
    };
    expect(att.club_id).toBe(1);
    expect(att.weather).toBe('多云');
    expect(att.attendance).toBe(7333);
    expect(att.ticket).toBeCloseTo(1.1, 2);
    expect(att.commercial).toBeCloseTo(0.15, 2);
    expect(att.broadcast).toBeCloseTo(0.9, 2);
    const rev = fx.sqlite.prepare("SELECT club_id, amount, ref_type, ref_id FROM ledger_entries WHERE kind = 'revenue'").get() as {
      club_id: number;
      amount: number;
      ref_type: string;
      ref_id: number;
    };
    expect(rev).toEqual({ club_id: 1, amount: 2.15, ref_type: 'match', ref_id: 1 });

    // 重复确认 409（result_confirmations UNIQUE），上座快照不重复
    await expect(confirmResult(fx.env, 1, 1, 'user')).rejects.toThrow();

    // 反向：无球场行的俱乐部作主场 → 跳过（无 revenue 流水）
    const fx2 = freshEnv();
    seedTourSchema(fx2.tour);
    seedClubWithTeam(fx2.auth, fx2.sqlite, 3, 13);
    seedClubWithTeam(fx2.auth, fx2.sqlite, 4, 12);
    insertMatch(fx2.tour, { matchId: 9, tournamentId: 5, stageId: 50, homeTeamId: 12, awayTeamId: 11, scoreHome: 1, scoreAway: 0, stageKind: 'round_robin' });
    insertBinding(fx2.sqlite, 1, 5, 'league_premier');
    const res2 = await confirmResult(fx2.env, 1, 9, 'user');
    expect(res2.revenueError).toBeNull();
    expect(fx2.sqlite.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'revenue'").get()).toEqual({ n: 0 });
  });
});

describe('窗末主场结算：维护费+死忠演化（v1.5.0）', () => {
  it('维护费=基础+每万座费率×容量万×主场场次；死忠向上座率与影响力目标靠拢', async () => {
    const fx = freshEnv();
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedPlayer(fx.sqlite, 1, 1, { ca: 80, pa: 92, prestige: 4, growable: 1 }); // 影响力 7.5
    seedStadium(fx.sqlite, 1, { shell: 90, fans: 1800 }); // 总影响力 97.5 → 目标 97.5×26=2535
    // 本窗 1 场主场：上座 7333 → 上座率 0.36665
    fx.sqlite
      .prepare(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
         VALUES (1, 1, 1, 1, '多云', 7333, 1, 0, 0, '2026-09-16T00:00:00Z')`,
      )
      .run();
    const { statements, summary } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: true });
    // 维护费：tier0 = 2.0 + 0.8 × 2万 × 1 场 = 3.6
    expect(summary.maintenanceClubs).toBe(1);
    expect(summary.maintenanceTotal).toBeCloseTo(3.6, 2);
    expect(summary.fansClubs).toBe(1);
    await fx.env.DB.batch(statements);
    const led = fx.sqlite.prepare("SELECT club_id, amount, ref_type, ref_id FROM ledger_entries WHERE kind = 'maintenance'").get() as {
      club_id: number;
      amount: number;
      ref_type: string;
      ref_id: number;
    };
    expect(led).toEqual({ club_id: 1, amount: -3.6, ref_type: 'window', ref_id: 101 });
    // 演化：diff=2535-1800=735，coef=0.5×(0.6+0.4×0.36665)=0.37333 → 1800+735×0.37333≈2074.4（战绩 4 不修正）
    const fans = fx.sqlite.prepare('SELECT fans FROM stadiums WHERE club_id = 1').get() as { fans: number };
    expect(fans.fans).toBeCloseTo(2074.4, 1);
    // 幂等：同窗重放维护费不双扣（ledger 闸）
    const again = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: true });
    await fx.env.DB.batch(again.statements);
    expect(fx.sqlite.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'maintenance'").get()).toEqual({ n: 1 });
  });
});

describe('管理端主场域端点（v1.5.0）', () => {
  function kvEnv() {
    resetConfigCache();
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const tour = new DatabaseSync(':memory:');
    tour.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
               INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0);`);
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
    } as unknown as Env;
    kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
    return { env, sqlite };
  }

  function get(path: string, token: string, env: Env) {
    return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
  }
  function post(path: string, body: unknown, token: string, env: Env) {
    return app.request(
      path,
      { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` }, body: JSON.stringify(body) },
      env,
    );
  }

  it('GET 展示影响力构成；POST 改队壳/奖励分/档位；非法参数 400；审计留痕', async () => {
    const fx = kvEnv();
    fx.sqlite.prepare(`INSERT INTO clubs (id, name, status) VALUES (1, '甲', 'active')`).run();
    seedStadium(fx.sqlite, 1, { shell: 40, bonus: 5, fans: 2000, tier: 1 });
    seedPlayer(fx.sqlite, 1, 1, { ca: 93, pa: 95, prestige: 5, growable: 0 }); // 0.13×10×5=6.5

    const got = await get('/api/admin/clubs/1/stadium', 'tok-admin', fx.env);
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      stadium: { shellInfluence: number; bonusPoints: number; fans: number; tier: number };
      influence: { players: number; total: number };
      tier: { name: string } | null;
      facilities: { key: string; level: number }[];
    };
    expect(body.stadium.fans).toBe(2000);
    expect(body.influence.players).toBeCloseTo(6.5, 5);
    expect(body.influence.total).toBeCloseTo(51.5, 5);
    expect(body.tier?.name).toBe('地区级');

    const put = await post('/api/admin/clubs/1/stadium', { shellInfluence: 60, bonusPoints: 15, capacity: 25000, tier: 1 }, 'tok-admin', fx.env);
    expect(put.status).toBe(200);
    const after = fx.sqlite.prepare('SELECT shell_influence, bonus_points, capacity, tier FROM stadiums WHERE club_id = 1').get() as {
      shell_influence: number;
      bonus_points: number;
      capacity: number;
      tier: number;
    };
    expect(after).toEqual({ shell_influence: 60, bonus_points: 15, capacity: 25000, tier: 1 });
    const auditRow = fx.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stadium_update'").get() as { n: number };
    expect(auditRow.n).toBe(1);

    const bad1 = await post('/api/admin/clubs/1/stadium', { capacity: 3 }, 'tok-admin', fx.env);
    expect(bad1.status).toBe(400);
    const bad2 = await post('/api/admin/clubs/1/stadium', { tier: 9 }, 'tok-admin', fx.env);
    expect(bad2.status).toBe(400);
    const bad3 = await post('/api/admin/clubs/2/stadium', { shellInfluence: 1 }, 'tok-admin', fx.env);
    expect(bad3.status).toBe(404);
  });
});

describe('CPU 队不入账（v2.0.0 裁决 6）', () => {
  it('目录里 club_id 照样补上，但 clubIdByTourTeam 不返回 CPU 队（奖金/主场收入都发不出）', async () => {
    const fx = freshEnv();
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 7);
    fx.sqlite.prepare(`INSERT INTO clubs (id, name, status, is_cpu) VALUES (241, '巴塞罗那(CPU)', 'active', 1)`).run();
    authRegisterClubTeam(fx.auth, 6, 241, '巴塞罗那(CPU)');

    const map = await clubIdByTourTeam(fx.env, [6, 7]);
    expect(map.size).toBe(1);
    expect(map.get(7)).toBe(1);
    expect(map.has(6)).toBe(false);
  });
});
