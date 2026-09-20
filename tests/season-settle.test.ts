// 增量 11：奖金自动入账 + 赛事完结结算 + 窗末扣款 + 赛季结算
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam } from './d1.ts';
import type { Env } from '../src/worker/env.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { confirmResult } from '../src/worker/results.ts';
import { settleTournamentStage, settleSeason, checkSeasonSettle, rejudgeGrowable } from '../src/worker/season-settle.ts';
import { windowPayrollStatements } from '../src/worker/window-payroll.ts';

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

// 最小 tour schema（与 results.ts MATCH_SELECT 对齐，含 config_json/winner id）
function seedTourSchema(tour: DatabaseSync) {
  tour.exec(`
    CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
    CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT, config_json TEXT DEFAULT '{}');
    CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER);
    CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE match (id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER,
      home_entry_id INTEGER, away_entry_id INTEGER, winner_entry_id INTEGER,
      score_home REAL, score_away REAL, pen_home REAL, pen_away REAL,
      walkover_side TEXT, status TEXT, finished_at TEXT);
    CREATE TABLE player (id INTEGER PRIMARY KEY, name TEXT, team_id INTEGER);
    CREATE TABLE match_event (id INTEGER PRIMARY KEY, match_id INTEGER, type TEXT, player_id INTEGER, assist_player_id INTEGER);
  `);
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
  walkoverSide?: string;
  winnerTeamId?: number;
  stageKind: string;
  round?: number;
  entryCount?: number;
  status?: string;
}

function insertMatch(tour: DatabaseSync, f: MatchFixture) {
  tour.prepare('INSERT OR IGNORE INTO tournament (id, name, status) VALUES (?, ?, ?)').run(f.tournamentId, `赛事${f.tournamentId}`, 'active');
  tour
    .prepare('INSERT OR IGNORE INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (?, ?, ?, 1, NULL, ?)')
    .run(f.stageId, f.tournamentId, f.stageKind, JSON.stringify(f.entryCount ? { entry_count: f.entryCount } : {}));
  const homeEntry = f.matchId * 2;
  const awayEntry = f.matchId * 2 + 1;
  tour.prepare('INSERT INTO entry (id, tournament_id, team_id) VALUES (?, ?, ?), (?, ?, ?)').run(homeEntry, f.tournamentId, f.homeTeamId, awayEntry, f.tournamentId, f.awayTeamId);
  tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, home_entry_id, away_entry_id, winner_entry_id,
         score_home, score_away, pen_home, pen_away, walkover_side, status, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-16T00:00:00Z')`,
    )
    .run(
      f.matchId,
      f.stageId,
      f.round ?? 0,
      homeEntry,
      awayEntry,
      f.winnerTeamId != null ? (f.winnerTeamId === f.homeTeamId ? homeEntry : awayEntry) : null,
      f.scoreHome ?? null,
      f.scoreAway ?? null,
      f.penHome ?? null,
      f.penAway ?? null,
      f.walkoverSide ?? null,
      f.status ?? 'finished',
    );
}

function insertBinding(sqlite: DatabaseSync, season: number, tournamentId: number, competitionType: string) {
  sqlite.prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, '2026-09-16T00:00:00Z')`).run(season, tournamentId, competitionType);
}

function seedClubWithTeam(auth: DatabaseSync, sqlite: DatabaseSync, clubId: number, tourTeamId: number) {
  sqlite.prepare(`INSERT INTO clubs (id, name, status) VALUES (?, ?, 'active')`).run(clubId, `俱乐部${clubId}`);
  sqlite.prepare(`INSERT INTO ledger_accounts (club_id, balance) VALUES (?, 0)`).run(clubId);
  authRegisterClubTeam(auth, tourTeamId, clubId, `队${tourTeamId}`);
}

beforeEach(() => resetConfigCache());

describe('赛果确认即时入账（增量 11 §9.1）', () => {
  it('联赛主胜：主 8.5 / 客 4.7（kind=prize，ref_type 分侧幂等键）', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 101);
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 102);
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 101, awayTeamId: 102, scoreHome: 2, scoreAway: 0, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    const res = await confirmResult(fx.env, 1, 1);
    expect(res.prizeError).toBeNull();
    const rows = fx.sqlite.prepare('SELECT club_id, amount, ref_type, ref_id FROM ledger_entries WHERE kind = ? ORDER BY club_id').all('prize') as { club_id: number; amount: number; ref_type: string; ref_id: number }[];
    expect(rows).toEqual([
      { club_id: 1, amount: 8.5, ref_type: 'match_home', ref_id: 1 },
      { club_id: 2, amount: 4.7, ref_type: 'match_away', ref_id: 1 },
    ]);
    // 幂等：重放确认同场奖金不双发（confirmResult 409，但直接重放语句也安全）
    await expect(confirmResult(fx.env, 1, 1)).rejects.toThrow();
  });

  it('CPU 队一侧不入账：平台队打 CPU 队只发平台侧奖金（增量 14 裁决 6）', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 101);
    // CPU 队：clubs 行与目录 club_id 都补齐（赛程/展示要用），但奖金与主场收入不发
    fx.sqlite.prepare(`INSERT INTO clubs (id, name, status, is_cpu) VALUES (241, '巴塞罗那(CPU)', 'active', 1)`).run();
    authRegisterClubTeam(fx.auth, 6, 241, '巴塞罗那(CPU)');
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 101, awayTeamId: 6, scoreHome: 2, scoreAway: 0, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    const res = await confirmResult(fx.env, 1, 1);
    expect(res.prizeError).toBeNull();
    const rows = fx.sqlite.prepare('SELECT club_id, amount, ref_type FROM ledger_entries WHERE kind = ?').all('prize') as { club_id: number; amount: number; ref_type: string }[];
    expect(rows).toEqual([{ club_id: 1, amount: 8.5, ref_type: 'match_home' }]);
  });

  it('平局双 6.6；冠军杯小组赛每胜 7.0；淘汰赛晋级按所进轮次给（决赛胜=+5）', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 12);
    // 平局
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 1, scoreAway: 1, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_second');
    await confirmResult(fx.env, 1, 1);
    // 小组赛客胜
    insertMatch(fx.tour, { matchId: 2, tournamentId: 6, stageId: 60, homeTeamId: 11, awayTeamId: 12, scoreHome: 0, scoreAway: 3, stageKind: 'group' });
    insertBinding(fx.sqlite, 1, 6, 'champions_cup');
    await confirmResult(fx.env, 1, 2);
    // 淘汰赛决赛：entryCount=2、round=0，主胜→after=1→champion +5
    insertMatch(fx.tour, { matchId: 3, tournamentId: 6, stageId: 61, homeTeamId: 11, awayTeamId: 12, scoreHome: 1, scoreAway: 0, stageKind: 'elim', round: 0, entryCount: 2 });
    await confirmResult(fx.env, 1, 3);
    const rows = fx.sqlite.prepare('SELECT club_id, amount FROM ledger_entries WHERE kind = ? ORDER BY id').all('prize') as { club_id: number; amount: number }[];
    expect(rows).toEqual([
      { club_id: 1, amount: 4.8 }, // 次级平局
      { club_id: 2, amount: 4.8 },
      { club_id: 2, amount: 7.0 }, // 小组赛客胜
      { club_id: 1, amount: 5 }, // 夺冠
    ]);
  });

  it('AUTH_DB 未配置 → 不入账不报错（回滚通道口径）', async () => {
    const fx = freshEnv();
    (fx.env as { AUTH_DB?: unknown }).AUTH_DB = undefined;
    seedTourSchema(fx.tour);
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 1, awayTeamId: 2, scoreHome: 1, scoreAway: 0, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    const res = await confirmResult(fx.env, 1, 1);
    expect(res.prizeError).toBeNull();
    expect((fx.sqlite.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind='prize'").get() as { n: number }).n).toBe(0);
  });
});

describe('赛事完结结算（一次性项，stage_settled_at 幂等）', () => {
  it('联赛入场：每参赛队 20；二次结算 409', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 12);
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 2, scoreAway: 1, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    await confirmResult(fx.env, 1, 1);
    const res = await settleTournamentStage(fx.env, 1, 1);
    expect(res.items).toBe(2); // 两队入场各 20
    const amounts = fx.sqlite.prepare("SELECT club_id, amount FROM ledger_entries WHERE memo LIKE '联赛入场%' ORDER BY club_id").all() as { club_id: number; amount: number }[];
    expect(amounts).toEqual([
      { club_id: 1, amount: 20 },
      { club_id: 2, amount: 20 },
    ]);
    await expect(settleTournamentStage(fx.env, 1, 1)).rejects.toThrow('已完结结算过');
  });

  it('资格赛止步保底：输家 7.5，赢家不领；小组赛剩余池按胜场占比', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 12);
    // 资格赛：主队胜 → 客队止步
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 2, scoreAway: 0, stageKind: 'elim', entryCount: 4 });
    insertBinding(fx.sqlite, 1, 5, 'qualifying');
    await confirmResult(fx.env, 1, 1);
    const res = await settleTournamentStage(fx.env, 1, 1);
    expect(res.items).toBe(1);
    expect(fx.sqlite.prepare("SELECT club_id, amount FROM ledger_entries WHERE memo LIKE '冠军杯资格赛%'").get()).toMatchObject({ club_id: 2, amount: 7.5 });

    // 小组赛剩余池：总池 200，已发 7.0（一胜）→ 剩 193，单队两胜全拿
    const fx2 = freshEnv();
    seedTourSchema(fx2.tour);
    seedClubWithTeam(fx2.auth, fx2.sqlite, 1, 11);
    seedClubWithTeam(fx2.auth, fx2.sqlite, 2, 12);
    insertMatch(fx2.tour, { matchId: 1, tournamentId: 6, stageId: 60, homeTeamId: 11, awayTeamId: 12, scoreHome: 2, scoreAway: 1, stageKind: 'group' });
    insertMatch(fx2.tour, { matchId: 2, tournamentId: 6, stageId: 60, homeTeamId: 11, awayTeamId: 12, scoreHome: 3, scoreAway: 0, stageKind: 'group' });
    insertBinding(fx2.sqlite, 1, 6, 'champions_cup');
    await confirmResult(fx2.env, 1, 1);
    await confirmResult(fx2.env, 1, 2);
    const res2 = await settleTournamentStage(fx2.env, 1, 1);
    expect(res2.items).toBe(1);
    expect(fx2.sqlite.prepare("SELECT amount FROM ledger_entries WHERE memo LIKE '冠军杯小组赛剩余池%'").get()).toMatchObject({ amount: 186 });
  });
});

describe('窗末扣款（工资+富人税 §9.2）', () => {
  it('工资全额扣；富人税 = max(资金档, 价值档)；税基取扣完工资后的余额', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.prepare(`INSERT INTO players (id, uid, name, club_id, age) VALUES (1, 'p1', '甲', 1, 24)`).run();
    fx.sqlite.prepare(`INSERT INTO contracts (id, player_id, club_id, release_fee, wage, effective_from, is_active) VALUES (1, 1, 1, 500, 3, '2026-01-01T00:00:00Z', 1)`).run();
    // 余额 130：扣工资 3 后 127>125 → 税1=25.4；价值 127+500=627≤700 → 税2=0 → 25.4
    fx.sqlite.prepare(`UPDATE ledger_accounts SET balance = 130 WHERE club_id = 1`).run();
    const { statements, summary } = await windowPayrollStatements(fx.env, 1, 1);
    expect(summary).toMatchObject({ wageClubs: 1, wageTotal: 3, taxClubs: 1, taxTotal: 25.4 });
    await fx.env.DB.batch(statements);
    const rows = fx.sqlite.prepare("SELECT kind, amount FROM ledger_entries ORDER BY id").all() as { kind: string; amount: number }[];
    expect(rows.map((r) => [r.kind, r.amount])).toEqual([
      ['wage', -3],
      ['luxury_tax', -25.4],
    ]);
    // 幂等：同窗重放不双扣
    const again = await windowPayrollStatements(fx.env, 1, 1);
    await fx.env.DB.batch(again.statements);
    const wages = fx.sqlite.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind='wage'").get() as { n: number };
    expect(wages.n).toBe(1);
  });
});

describe('赛季结算（忠诚奖金+growable 重判+settled）', () => {
  it('硬阻断（开窗未关）409；忠诚分档+入俱乐部账；growable 按 age_cap 重判；重复结算 409', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.prepare(`INSERT INTO seasons (season, status, age_cap, created_at) VALUES (1, 'running', 24, '2026-01-01T00:00:00Z')`).run();
    fx.sqlite.prepare(`INSERT INTO season_windows (season, window_seq, status) VALUES (1, 1, 'open')`).run();
    const check = await checkSeasonSettle(fx.env, 1);
    expect(check.blockers.length).toBeGreaterThan(0);
    await expect(settleSeason(fx.env, 1, 1, true)).rejects.toThrow('结算前置不满足');
    fx.sqlite.prepare(`UPDATE season_windows SET status='closed' WHERE season=1`).run();
    // 三份合同：1 年前（5%）、2 年前（10%）、3 年前（20%）
    fx.sqlite.prepare(`INSERT INTO players (id, uid, name, club_id, age, ca, pa) VALUES (1, 'p1', '甲', 1, 24, 80, 90), (2, 'p2', '乙', 1, 26, 80, 90), (3, 'p3', '丙', 1, 30, 95, 95)`).run();
    fx.sqlite
      .prepare(`INSERT INTO contracts (id, player_id, club_id, release_fee, wage, effective_from, is_active) VALUES
        (1, 1, 1, 100, 3, ?, 1), (2, 2, 1, 100, 3, ?, 1), (3, 3, 1, 100, 3, ?, 1)`)
      .run(new Date(Date.now() - 365.25 * 86400_000).toISOString(), new Date(Date.now() - 2 * 365.25 * 86400_000).toISOString(), new Date(Date.now() - 3 * 365.25 * 86400_000).toISOString());
    const res = await settleSeason(fx.env, 1, 1, true);
    expect(res.loyalty).toBe(3);
    const loyalty = fx.sqlite.prepare('SELECT kind, amount FROM ledger_entries WHERE kind = ? ORDER BY amount').all('loyalty') as { amount: number }[];
    expect(loyalty.map((r) => r.amount)).toEqual([5, 10, 20]); // 1 年→5%、2 年→10%、3 年→20%
    expect((fx.sqlite.prepare('SELECT status FROM seasons WHERE season=1').get() as { status: string }).status).toBe('settled');
    await expect(settleSeason(fx.env, 1, 1, true)).rejects.toThrow('已经结算过');
  });

  it('软警示（未确认完赛果）需 acknowledged；age_cap 缺失跳过 growable 重判', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.prepare(`INSERT INTO seasons (season, status, created_at) VALUES (1, 'running', '2026-01-01T00:00:00Z')`).run(); // 无 age_cap
    insertMatch(fx.tour, { matchId: 9, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 1, scoreAway: 0, stageKind: 'round_robin' });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    await expect(settleSeason(fx.env, 1, 1, false)).rejects.toThrow('待确认提示');
    const res = await settleSeason(fx.env, 1, 1, true);
    expect(res.growable).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('rejudgeGrowable：CA<PA 且 age≤cap 才可成长（规则 4.1.1）', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    fx.sqlite
      .prepare(`INSERT INTO players (id, uid, name, club_id, age, ca, pa, growable) VALUES
        (1, 'a', '甲', 1, 24, 80, 90, 0), (2, 'b', '乙', 1, 26, 80, 90, 1), (3, 'c', '丙', 1, 24, 95, 95, 1), (4, 'd', '丁', 1, 23, 85, 92, 1)`)
      .run();
    const changed = await rejudgeGrowable(fx.env, 25);
    expect(changed).toBe(3); // 甲 0→1、乙 1→0（26>25）、丙 1→0（CA=PA）、丁保持 1
    expect((fx.sqlite.prepare('SELECT growable FROM players WHERE id=1').get() as { growable: number }).growable).toBe(1);
    expect((fx.sqlite.prepare('SELECT growable FROM players WHERE id=2').get() as { growable: number }).growable).toBe(0);
  });
});
