// v6.28.0 C 段：离线重算引擎（scripts/prod-20261004-influence-recalc/engine.mjs）与运行期逐位交叉验证闸。
// 为什么必须有这个文件：engine.mjs 是 home.ts 公式的"离线副本"，重算生产历史数据时用它算上座/收入/死忠；
// 一旦副本与运行期漂移，写回库里的数字就会与线上口径不一致（且线上已入账、重记替换代价极高）。
// 所以这里把两边在同一批输入上逐值对拍：常量镜像、纯函数矩阵、钩子④落库值、关窗收尾值。
//
// engine.mjs 是 .mjs 且不在任何 tsconfig 的 include 内 ⇒ 用运行时动态 import 取；
// 说明符走变量 + @vite-ignore，让 tsc/vite 都不去静态解析它（TS 对非字面量说明符不报"找不到模块"）。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam } from './d1.ts';
import type { Env } from '../src/worker/env.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { CONFIG_DEFAULTS } from '../src/core/config.ts';
import {
  abilityTier,
  playerAbilityLevel,
  playerInfluenceSum,
  teamInfluence,
  rollWeather,
  formPtsOf,
  diehardTarget,
  evolveFans,
  influenceTierCoef,
  loadAttendanceModel,
  loadTierTable,
  loadInfluenceTierCoefs,
  uniform,
  asRange,
  matchAttendanceStatements,
  windowHomeStatements,
  type AttendanceModel,
} from '../src/worker/home.ts';

const ENGINE_URL = new URL('../scripts/prod-20261004-influence-recalc/engine.mjs', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any;
beforeAll(async () => {
  engine = await import(/* @vite-ignore */ ENGINE_URL);
});

beforeEach(() => resetConfigCache());

// ───────────────────────── 夹具（与 tests/home.test.ts 同形，只留本文件需要的） ─────────────────────────

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
      home_entry_id INTEGER, away_entry_id INTEGER, winner_entry_id,
      score_home REAL, score_away REAL, pen_home REAL, pen_away REAL,
      walkover_side TEXT, status TEXT, finished_at TEXT);
  `);
}

function seedClubWithTeam(auth: DatabaseSync, sqlite: DatabaseSync, clubId: number, tourTeamId: number) {
  sqlite.prepare(`INSERT INTO clubs (id, name, status) VALUES (?, ?, 'active')`).run(clubId, `俱乐部${clubId}`);
  sqlite.prepare(`INSERT INTO ledger_accounts (club_id, balance) VALUES (?, 0)`).run(clubId);
  authRegisterClubTeam(auth, tourTeamId, clubId, `队${tourTeamId}`);
}

function insertMatch(
  tour: DatabaseSync,
  f: { matchId: number; tournamentId: number; stageId: number; homeTeamId: number; awayTeamId: number; scoreHome?: number; scoreAway?: number },
) {
  tour.prepare('INSERT OR IGNORE INTO tournament (id, name, status) VALUES (?, ?, ?)').run(f.tournamentId, `赛事${f.tournamentId}`, 'active');
  tour
    .prepare('INSERT OR IGNORE INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (?, ?, ?, 1, NULL, ?)')
    .run(f.stageId, f.tournamentId, 'round_robin', '{}');
  const homeEntry = f.matchId * 2;
  const awayEntry = f.matchId * 2 + 1;
  tour.prepare('INSERT INTO entry (id, tournament_id, team_id) VALUES (?, ?, ?), (?, ?, ?)').run(homeEntry, f.tournamentId, f.homeTeamId, awayEntry, f.tournamentId, f.awayTeamId);
  tour
    .prepare(
      `INSERT INTO match (id, stage_id, round, home_entry_id, away_entry_id, winner_entry_id,
         score_home, score_away, pen_home, pen_away, walkover_side, status, finished_at)
       VALUES (?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL, NULL, 'finished', '2026-09-16T00:00:00Z')`,
    )
    .run(f.matchId, f.stageId, homeEntry, awayEntry, f.scoreHome ?? null, f.scoreAway ?? null);
}

function insertBinding(sqlite: DatabaseSync, season: number, tournamentId: number, competitionType: string) {
  sqlite
    .prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, '2026-09-16T00:00:00Z')`)
    .run(season, tournamentId, competitionType);
}

function seedStadium(
  sqlite: DatabaseSync,
  clubId: number,
  opts: { capacity?: number; tier?: number; shell?: number; bonus?: number; fans?: number; nextWeather?: string } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, next_weather, created_at, updated_at)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(clubId, opts.capacity ?? 20000, opts.tier ?? 0, opts.shell ?? 0, opts.bonus ?? 0, opts.fans ?? 1800, opts.nextWeather ?? '');
}

function seedPlayer(
  sqlite: DatabaseSync,
  id: number,
  clubId: number,
  opts: { ca?: number | null; pa?: number | null; prestige?: number | null; growable?: number },
) {
  sqlite
    .prepare(`INSERT INTO players (id, uid, name, club_id, age, ca, pa, prestige, growable, growth_tier) VALUES (?, ?, ?, ?, 24, ?, ?, ?, ?, 1)`)
    .run(
      id,
      `p${id}`,
      `球员${id}`,
      clubId,
      opts.ca === undefined ? 70 : opts.ca,
      opts.pa === undefined ? 70 : opts.pa,
      opts.prestige === undefined ? 0 : opts.prestige,
      opts.growable ?? 0,
    );
  sqlite
    .prepare(`INSERT INTO contracts (id, player_id, club_id, release_fee, wage, effective_from, is_active) VALUES (?, ?, ?, 100, 1, '2026-01-01T00:00:00Z', 1)`)
    .run(id, id, clubId);
}

/** 本队近 N 场（tour 队 id）赛果行；用于 form 因子。 */
function seedFormRows(sqlite: DatabaseSync, tourTeamId: number, rows: { win: boolean | null; draw?: boolean }[]) {
  const ins = sqlite.prepare(
    `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id, score_home, score_away, confirmed_at)
     VALUES (1, 1, 5, ?, ?, ?, ?, ?, '2026-09-16T00:00:00Z')`,
  );
  rows.forEach((r, i) => {
    const matchId = 900 + i;
    if (r.win === null) ins.run(matchId, tourTeamId, 999, null, null); // 未打完（分数 null）→ 不占名额
    else if (r.draw) ins.run(matchId, tourTeamId, 12, 1, 1);
    else if (r.win) ins.run(matchId, tourTeamId, 12, 2, 0);
    else ins.run(matchId, tourTeamId, 12, 0, 2);
  });
}

/** 引擎侧需要的球员行（与 home.ts playerInfluenceSum 的 SQL 同列同序）。 */
function playerRows(sqlite: DatabaseSync, clubId: number) {
  return sqlite
    .prepare(
      `SELECT p.prestige AS prestige, p.ca AS ca, p.pa AS pa, p.growable AS growable
         FROM players p JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
        WHERE ct.club_id = ?`,
    )
    .all(clubId) as { prestige: number | null; ca: number | null; pa: number | null; growable: number }[];
}

function facilityLevels(sqlite: DatabaseSync, clubId: number) {
  const rows = sqlite.prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ?').all(clubId) as {
    facility_key: string;
    level: number;
  }[];
  const level = (key: string) => rows.find((r) => r.facility_key === key)?.level ?? 0;
  return { commercial: level('commercial'), broadcast: level('broadcast'), youth: level('youth') };
}

// ───────────────────────── ① 常量镜像 ─────────────────────────

describe('v6.28.0 C 段：engine.mjs 与运行期常量逐键相等', () => {
  it('attendance_model 镜像齐全（键集合双向相等，防新因子漏搬）', async () => {
    const fx = freshEnv();
    const model = await loadAttendanceModel(fx.env.DB);
    // 双向：engine 不多键（多键=白写）、不少键（少键=漏搬因子）
    expect(Object.keys(engine.MODEL_DEFAULTS).sort()).toEqual(Object.keys(model).sort());
    for (const k of Object.keys(model)) expect(engine.MODEL_DEFAULTS[k]).toEqual(model[k as keyof AttendanceModel]);
  });

  it('tier_table / influence_tier_coefs / per-match 系数镜像相等', async () => {
    const fx = freshEnv();
    expect(engine.TIER_TABLE_DEFAULTS).toEqual(await loadTierTable(fx.env.DB));
    expect(engine.INFLUENCE_TIER_COEF_DEFAULTS).toEqual(await loadInfluenceTierCoefs(fx.env.DB));
    // per-match 是 config 文本键（初值 0.2 = 窗系数 0.5 × 0.4），engine 里存数字
    expect(engine.PER_MATCH_DEFAULTS.fans_grow_rate_per_match).toBe(Number(CONFIG_DEFAULTS.fans_grow_rate_per_match));
    expect(engine.PER_MATCH_DEFAULTS.fans_drop_rate_per_match).toBe(Number(CONFIG_DEFAULTS.fans_drop_rate_per_match));
  });
});

// ───────────────────────── ② 纯函数矩阵对拍 ─────────────────────────

describe('v6.28.0 C 段：纯函数逐位对拍（engine vs home.ts）', () => {
  it('abilityTier / playerAbilityLevel：边界与 null 全覆盖', () => {
    for (const v of [null, 0, 1, 59, 60, 64, 65, 69, 70, 74, 75, 79, 80, 83, 84, 86, 87, 89, 90, 92, 93, 99, 120]) {
      expect(engine.abilityTier(v), `abilityTier(${v})`).toBe(abilityTier(v));
    }
    for (const growable of [0, 1]) {
      for (const ca of [null, 58, 70, 86, 93]) {
        for (const pa of [null, 65, 88, 95]) {
          expect(engine.playerAbilityLevel(ca, pa, growable), `pal(${ca},${pa},${growable})`).toBe(playerAbilityLevel(ca, pa, growable));
        }
      }
    }
  });

  it('playerInfluenceSum / teamInfluence / influenceTierCoef：与库内实算逐位相等', async () => {
    const fx = freshEnv();
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedPlayer(fx.sqlite, 1, 1, { ca: 93, pa: 95, prestige: 3, growable: 1 });
    seedPlayer(fx.sqlite, 2, 1, { ca: 70, pa: 70, prestige: 2.5, growable: 0 });
    seedPlayer(fx.sqlite, 3, 1, { ca: null, pa: null, prestige: null, growable: 0 });
    const model = await loadAttendanceModel(fx.env.DB);
    const sum = await playerInfluenceSum(fx.env, 1, model);
    expect(engine.playerInfluenceSum(playerRows(fx.sqlite, 1), model)).toBe(sum);
    // 影响力：三档级别系数 × 无级别（null）全对拍
    for (const tier of ['premier', 'second', null] as const) {
      const coef = influenceTierCoef(await loadInfluenceTierCoefs(fx.env.DB), tier);
      expect(engine.influenceTierCoef(engine.INFLUENCE_TIER_COEF_DEFAULTS, tier)).toBe(coef);
      expect(engine.teamInfluence({ shell_influence: 55.51, bonus_points: 70 }, sum, coef)).toBe(
        teamInfluence({ shell_influence: 55.51, bonus_points: 70 }, sum, coef),
      );
    }
    // 未知档位/系数缺档 → 运行期兜底 1
    expect(engine.influenceTierCoef(null, 'premier')).toBe(influenceTierCoef(null, 'premier'));
    expect(engine.influenceTierCoef({ second: 1 }, 'premier')).toBe(influenceTierCoef({ second: 1 }, 'premier'));
  });

  it('diehardTarget：0..600 全扫（含阶梯边界 120/160/200）', async () => {
    const model = await loadAttendanceModel(freshEnv().env.DB);
    for (let i = 0; i <= 600; i += 5) {
      expect(engine.diehardTarget(model, i), `diehardTarget(${i})`).toBe(diehardTarget(model, i));
    }
    for (const i of [119.999, 120, 120.001, 159, 160, 199.5, 200, 200.5]) {
      expect(engine.diehardTarget(model, i), `diehardTarget(${i})`).toBe(diehardTarget(model, i));
    }
  });

  it('evolveFans：涨/掉两侧 × 上座率 × 战绩 × 青训 × 冠名 buff × 每场/窗系数 × 钳位', async () => {
    const model = await loadAttendanceModel(freshEnv().env.DB);
    let n = 0;
    for (const fans of [0, 100, 1800, 5000, 9999.5, 10000]) {
      for (const target of [0, 500, 2000, 5000, 12000]) {
        for (const attendRate of [0, 0.25, 0.5, 1]) {
          for (const formPts of [0, 1, 3, 4, 6, 7, 9]) {
            for (const youth of [0, 3]) {
              for (const buff of [0, 0.005]) {
                for (const rates of [{}, { growRate: 0.2, dropRate: 0.2 }, { growRate: 0.9, dropRate: 0.1 }]) {
                  const a = engine.evolveFans(model, fans, target, attendRate, formPts, youth, buff, rates);
                  const b = evolveFans(model, fans, target, attendRate, formPts, youth, buff, rates);
                  expect(a, `evolveFans(${fans},${target},${attendRate},${formPts},${youth},${buff},${JSON.stringify(rates)})`).toBe(b);
                  n++;
                }
              }
            }
          }
        }
      }
    }
    expect(n).toBe(6 * 5 * 4 * 7 * 2 * 2 * 3);
    // 钳位显式锚点：目标极大 → 上限；掉粉系数 1.0（coef 1.8 > 1）才会算穿 0，必须钳回 0
    expect(engine.evolveFans(model, 9000, 100000, 1, 9, 5, 1)).toBe(10000);
    expect(engine.evolveFans(model, 100, 0, 0, 4, 0, 0, { dropRate: 1 })).toBe(0);
  });

  it('formPtsOf / rollWeather / uniform / asRange：与运行期同值', async () => {
    const model = await loadAttendanceModel(freshEnv().env.DB);
    // formPtsOf：null 分数跳过、弃权按胜负计、和局 1 分、胜 3 分、只数最近 3 场（不足 3 场 → 中性 4）
    type FormRow = {
      home_team_id: number | null;
      away_team_id: number | null;
      score_home: number | null;
      score_away: number | null;
      pen_home: number | null;
      pen_away: number | null;
      walkover_side: string | null;
    };
    const rows: FormRow[] = [
      { home_team_id: 11, away_team_id: 12, score_home: 2, score_away: 0, pen_home: null, pen_away: null, walkover_side: null }, // ① 胜 → 3
      { home_team_id: 13, away_team_id: 11, score_home: 1, score_away: 1, pen_home: null, pen_away: null, walkover_side: null }, // ② 平 → 1
      { home_team_id: 11, away_team_id: 14, score_home: null, score_away: null, pen_home: null, pen_away: null, walkover_side: 'away' }, // ③ 主队弃权 → 11 负 → 0
      { home_team_id: 11, away_team_id: 15, score_home: null, score_away: null, pen_home: null, pen_away: null, walkover_side: null }, // 未打完 → 不占名额
      { home_team_id: 16, away_team_id: 11, score_home: 3, score_away: 2, pen_home: null, pen_away: null, walkover_side: null }, // 第 4 场，名额已满不计
    ];
    expect(engine.formPtsOf(rows, 11)).toBe(formPtsOf(rows, 11));
    // 运行期 native 实算值：①②③ 三场占满名额 = 3 + 1 + 0 = 4（第 4 场起不再计入）
    expect(formPtsOf(rows, 11)).toBe(4);
    // 少于 3 场有效结果 → 中性 4（与"一场未打"同分，口径：样本不足不奖励也不惩罚）
    expect(engine.formPtsOf(rows.slice(3), 11)).toBe(formPtsOf(rows.slice(3), 11));
    expect(formPtsOf(rows.slice(3), 11)).toBe(4);
    // rollWeather：概率累加边界（晴 0.4 / 多云 0.3 / 雨 0.2 / 雪 0.1）
    for (const r of [0, 0.05, 0.39, 0.4, 0.69, 0.7, 0.89, 0.9, 0.99, 1]) {
      expect(engine.rollWeather(() => r, model.weather_probabilities), `rollWeather(${r})`).toBe(rollWeather(() => r, model.weather_probabilities));
    }
    for (const [lo, hi] of [[0.9, 1.04], [0.97, 1.03], [0.985, 0.999]] as [number, number][]) {
      // 重演口径：midpoint 必须是 uniform(rng=0.5, lo, hi) 本身（不是算术均值，浮点尾不同）
      expect(engine.midpoint(lo, hi)).toBe(uniform(() => 0.5, lo, hi));
    }
    expect(engine.asRange([1, 2])).toEqual(asRange([1, 2]));
    expect(engine.asRange('x')).toEqual(asRange('x'));
    expect(engine.asRange(null)).toEqual(asRange(null));
  });
});

// ───────────────────────── ③ 钩子④落库值对拍 ─────────────────────────

interface Scenario {
  name: string;
  competition: string;
  weather: string;
  capacity: number;
  tier: number;
  shell: number;
  bonus: number;
  fans: number;
  growth: { win: boolean | null; draw?: boolean }[];
  youth: number;
  naming?: boolean;
  players?: { ca: number | null; pa: number | null; prestige: number | null; growable: number }[];
}

const SCENARIOS: Scenario[] = [
  // 级别 premier + 晴 + 近 3 场全胜（form 9 → ×1.25）
  { name: 'A 晴/premier/3胜/无青训/1800', competition: 'league_premier', weather: '晴', capacity: 20000, tier: 0, shell: 90, bonus: 0, fans: 1800, growth: [{ win: true }, { win: true }, { win: true }], youth: 0 },
  // 级别 second + 雨 + 近 3 场全败（form 0 → ×0.7）+ 青训 3（涨粉 ×1.09）
  { name: 'B 雨/second/3败/青训3', competition: 'league_second', weather: '雨', capacity: 20000, tier: 1, shell: 60, bonus: 10, fans: 1800, growth: [{ win: false }, { win: false }, { win: false }], youth: 3 },
  // 雪 + 中性（不足 3 场 → 4）+ 冠名口碑 buff 0.005 + 有球员（影响力含球员项）
  {
    name: 'C 雪/premier/中性/冠名口碑/带球员',
    competition: 'league_premier',
    weather: '雪',
    capacity: 35000,
    tier: 2,
    shell: 40,
    bonus: 5,
    fans: 1800,
    growth: [],
    youth: 0,
    naming: true,
    players: [
      { ca: 93, pa: 95, prestige: 3, growable: 1 },
      { ca: 70, pa: 70, prestige: 2.5, growable: 0 },
    ],
  },
  // 容量爆仓（需求 ≥ 容量 → floor(capacity × fill)）+ 多云
  { name: 'D 多云/premier/容量 3000 爆仓', competition: 'league_premier', weather: '多云', capacity: 3000, tier: 0, shell: 90, bonus: 0, fans: 1800, growth: [{ win: null }, { win: true }], youth: 0 },
  // 掉粉侧：影响力 0（无壳无球员 → 目标 0）+ fans 高 → 走掉粉公式
  { name: 'E 多云/second/掉粉侧', competition: 'league_second', weather: '多云', capacity: 20000, tier: 1, shell: 0, bonus: 0, fans: 5000, growth: [{ win: false }, { win: false }], youth: 0 },
];

describe('v6.28.0 C 段：钩子④上座/收入/死忠与 engine.replayMatch 逐位相等', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, async () => {
      const fx = freshEnv();
      seedTourSchema(fx.tour);
      seedClubWithTeam(fx.auth, fx.sqlite, 1, 11); // 主队 club 1 ↔ tour 11
      seedClubWithTeam(fx.auth, fx.sqlite, 2, 12); // 客队（有映射但无球场行 → 默认影响力 90）
      seedStadium(fx.sqlite, 1, { capacity: sc.capacity, tier: sc.tier, shell: sc.shell, bonus: sc.bonus, fans: sc.fans, nextWeather: sc.weather });
      for (let i = 0; i < (sc.players?.length ?? 0); i++) seedPlayer(fx.sqlite, 100 + i, 1, sc.players![i]);
      fx.sqlite
        .prepare(
          `INSERT INTO club_facilities (club_id, facility_key, level) VALUES (1, 'youth', ?), (1, 'commercial', 3), (1, 'broadcast', 2)`,
        )
        .run(sc.youth);
      if (sc.naming) {
        // 星海通讯 = 口碑档（fansBuff 0.005）；minimal active 合同
        fx.sqlite
          .prepare(
            `INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
               windows_total, windows_remaining, bonus_amount, status, started_season, started_window, created_at, updated_at)
             VALUES (1, '星海通讯', 0.8, 10, 1, '标准包', 1, 2, 2, 0, 'active', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
          )
          .run();
      }
      seedFormRows(fx.sqlite, 11, sc.growth);
      insertMatch(fx.tour, { matchId: 1, tournamentId: sc.competition === 'league_premier' ? 5 : 6, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 2, scoreAway: 0 });
      insertBinding(fx.sqlite, 1, sc.competition === 'league_premier' ? 5 : 6, sc.competition);
      // 本场 RC 行先落库（生产顺序：results.ts 先 INSERT result_confirmations，再跑钩子④）——
      // 引擎侧用它的 id 切"那一刻"的战绩视图
      fx.sqlite
        .prepare(
          `INSERT INTO result_confirmations (id, season, window_seq, tournament_id, match_id, home_team_id, away_team_id, score_home, score_away, confirmed_at)
           VALUES (999, 1, 1, ?, 1, 11, 12, 2, 0, '2026-09-16T00:00:00Z')`,
        )
        .run(sc.competition === 'league_premier' ? 5 : 6);

      const { statements, detail } = await matchAttendanceStatements(fx.env, { matchId: 1, season: 1, windowSeq: 1, homeTeamId: 11, awayTeamId: 12 });
      expect(detail).not.toBeNull();
      await fx.env.DB.batch(statements);
      const att = fx.sqlite.prepare('SELECT weather, attendance, ticket, commercial, broadcast FROM match_attendance WHERE match_id = 1').get() as {
        weather: string;
        attendance: number;
        ticket: number;
        commercial: number;
        broadcast: number;
      };
      const fansAfter = (fx.sqlite.prepare('SELECT fans FROM stadiums WHERE club_id = 1').get() as { fans: number }).fans;
      const ledger = fx.sqlite.prepare("SELECT amount FROM ledger_entries WHERE kind = 'revenue' AND ref_type = 'match' AND ref_id = 1").get() as {
        amount: number;
      };

      // ── 引擎侧：同样的库内事实（球迷/球员/设施/战绩/天气/影响力）喂 replayMatch ──
      const model = await loadAttendanceModel(fx.env.DB);
      const tierTable = await loadTierTable(fx.env.DB);
      const coefs = await loadInfluenceTierCoefs(fx.env.DB);
      const tier = sc.competition === 'league_premier' ? 'premier' : 'second';
      const homeInfluence = engine.teamInfluence(
        { shell_influence: sc.shell, bonus_points: sc.bonus },
        engine.playerInfluenceSum(playerRows(fx.sqlite, 1), model),
        engine.influenceTierCoef(coefs, tier),
      );
      // 库内实算的影响力必须与引擎一致（同一球员行/同一系数）
      expect(homeInfluence).toBe(teamInfluence({ shell_influence: sc.shell, bonus_points: sc.bonus }, await playerInfluenceSum(fx.env, 1, model), influenceTierCoef(coefs, tier)));
      const rcRows = fx.sqlite.prepare('SELECT id, home_team_id, away_team_id, score_home, score_away, walkover_side FROM result_confirmations ORDER BY id DESC').all() as {
        id: number;
        home_team_id: number;
        away_team_id: number;
        score_home: number | null;
        score_away: number | null;
        walkover_side: string | null;
      }[];
      const formPts = engine.formPtsBefore(rcRows, 999, 11);
      const levels = facilityLevels(fx.sqlite, 1);
      const out = engine.replayMatch({
        model,
        tierTable,
        weather: att.weather,
        wxOverride: null,
        formPts,
        fans: sc.fans,
        capacity: sc.capacity,
        tier: sc.tier,
        nextAttendanceMod: 1,
        homeInfluence,
        awayInfluence: model.default_influence, // 客队有映射但无球场行 → 默认 90
        facilityLevels: { commercial: levels.commercial, broadcast: levels.broadcast },
        youthLevel: levels.youth,
        fansBuff: sc.naming ? 0.005 : 0,
        growRate: Number(CONFIG_DEFAULTS.fans_grow_rate_per_match),
        dropRate: Number(CONFIG_DEFAULTS.fans_drop_rate_per_match),
      });

      expect(out.form).toBe(model.form_coef_table[String(Math.min(Math.max(formPts, 0), 9))]);
      expect(out.attendance).toBe(att.attendance);
      expect(out.revenue.ticket).toBe(att.ticket);
      expect(out.revenue.commercial).toBe(att.commercial);
      expect(out.revenue.broadcast).toBe(att.broadcast);
      expect(out.revenue.total).toBe(ledger.amount);
      expect(out.nextFans).toBe(fansAfter);
      // 天气预置是一次性消费：钩子写回 next_weather=''
      expect((fx.sqlite.prepare('SELECT next_weather FROM stadiums WHERE club_id = 1').get() as { next_weather: string }).next_weather).toBe('');
    });
  }

  it('容量 0 的退化队：上座 0、上座率取 1（进钩子不炸）', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 12);
    seedStadium(fx.sqlite, 1, { capacity: 0, fans: 1800 });
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12, scoreHome: 1, scoreAway: 0 });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');
    const { statements, detail } = await matchAttendanceStatements(fx.env, { matchId: 1, season: 1, windowSeq: 1, homeTeamId: 11, awayTeamId: 12 });
    expect(detail?.attendance).toBe(0);
    await fx.env.DB.batch(statements);
    const model = await loadAttendanceModel(fx.env.DB);
    const out = engine.advanceFans({
      model,
      fans: 1800,
      capacity: 0,
      attendance: 0,
      formPts: 4,
      homeInfluence: 0,
      youthLevel: 0,
      fansBuff: 0,
      growRate: Number(CONFIG_DEFAULTS.fans_grow_rate_per_match), // 每场系数 0.2（关窗兜底才用 0.5）
      dropRate: Number(CONFIG_DEFAULTS.fans_drop_rate_per_match),
    });
    expect(out.attendRate).toBe(1);
    expect(out.nextFans).toBe((fx.sqlite.prepare('SELECT fans FROM stadiums WHERE club_id = 1').get() as { fans: number }).fans);
  });
});

describe('v6.28.0 C 段：form 的"本场确认那一刻"视图（replay 必需，运行期天然满足）', () => {
  it('formPtsBefore 只数 RC id 更小的赛果（晚确认的场次不会倒灌到早场的上座）', () => {
    const rows = [
      { id: 5, home_team_id: 11, away_team_id: 12, score_home: 2, score_away: 0, walkover_side: null }, // 更早：胜
      { id: 6, home_team_id: 13, away_team_id: 11, score_home: 0, score_away: 3, walkover_side: null }, // 更早：胜（客场）
      { id: 7, home_team_id: 11, away_team_id: 14, score_home: 1, score_away: 1, walkover_side: null }, // 更早：平
      { id: 8, home_team_id: 11, away_team_id: 15, score_home: 0, score_away: 2, walkover_side: null }, // 本场
      { id: 9, home_team_id: 11, away_team_id: 16, score_home: 5, score_away: 0, walkover_side: null }, // 更晚：不得计入
    ];
    // id<8 的三场 = 3 + 3 + 1 = 7 → ≥7 档（form_coef_table['7']=1.19）
    expect(engine.formPtsOf(rows, 11)).toBe(7); // 直接喂全部行 = 5+3+1+0 的高分（说明必须切视图）
    expect(engine.formPtsBefore(rows, 8, 11)).toBe(7);
    expect(engine.formPtsBefore(rows, 5, 11)).toBe(4); // 本场之前没有任何赛果 → 中性
  });
});

// ───────────────────────── ④ 关窗收尾（B 段）对拍 ─────────────────────────

describe('v6.28.0 C 段：关窗收尾 fans / fans_window_start 与 engine.windowCloseFans 逐位相等', () => {
  it('本窗有主场：关窗不再演化（防双记账），fans 与 fans_window_start 都写窗末值', async () => {
    const fx = freshEnv();
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedStadium(fx.sqlite, 1, { shell: 90, fans: 2400 });
    // 本窗（S1 W1）已有一场主场入账 → 走"有主场不演化"分支
    fx.sqlite
      .prepare(
        `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
         VALUES (1, 1, 1, 1, '晴', 10000, 1.5, 0, 0, '2026-09-16T00:00:00Z')`,
      )
      .run();
    const { statements } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: false });
    await fx.env.DB.batch(statements);
    const s = fx.sqlite.prepare('SELECT fans, fans_window_start FROM stadiums WHERE club_id = 1').get() as {
      fans: number;
      fans_window_start: number;
    };
    const model = await loadAttendanceModel(fx.env.DB);
    const closed = engine.windowCloseFans(model, { fans: 2400, influence: 108, attendRate: 10000 / 20000, formPts: 4, played: 1 });
    expect(closed.nextFans).toBe(2400);
    expect(s.fans).toBe(closed.nextFans);
    expect(s.fans_window_start).toBe(closed.nextFans);
  });

  it('本窗无主场：按窗系数兜底演化一次（上座率 1），engine 同值', async () => {
    const fx = freshEnv();
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11);
    seedStadium(fx.sqlite, 1, { shell: 90, fans: 1800 });
    const { statements } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: false });
    await fx.env.DB.batch(statements);
    const s = fx.sqlite.prepare('SELECT fans, fans_window_start FROM stadiums WHERE club_id = 1').get() as {
      fans: number;
      fans_window_start: number;
    };
    const model = await loadAttendanceModel(fx.env.DB);
    // 无级别赛事绑定 → 级别系数 1.0 → 影响力 90 → 目标 2340；窗系数 0.5 ×(0.6+0.4×1) → 1800+540×0.5
    const closed = engine.windowCloseFans(model, { fans: 1800, influence: 90, attendRate: 1, formPts: 4, played: 0 });
    expect(closed.nextFans).toBe(2070);
    expect(s.fans).toBe(closed.nextFans);
    expect(s.fans_window_start).toBe(closed.nextFans);
  });

  it('窗级信号（fan_mood）在演化之后按 % 修正并钳上限（engine 与 home.ts:624 同式）', async () => {
    const model = await loadAttendanceModel(freshEnv().env.DB);
    const base = engine.windowCloseFans(model, { fans: 1800, influence: 90, attendRate: 1, formPts: 4, played: 0 });
    const withMood = engine.windowCloseFans(model, { fans: 1800, influence: 90, attendRate: 1, formPts: 4, played: 0, mood: 10 });
    expect(base.nextFans).toBe(2070);
    expect(withMood.nextFans).toBeCloseTo(2070 * 1.1, 10);
    expect(engine.windowCloseFans(model, { fans: 9900, influence: 1000, attendRate: 1, formPts: 9, played: 0, mood: 50 }).nextFans).toBe(10000);
  });
});

// ───────────────────────── ⑤ 链式推进（重演的核心） ─────────────────────────

describe('v6.28.0 C 段：链式推进——下一场的死忠初值必须是上一场的演化结果', () => {
  // 为什么单独立这条：重演 78 场历史时，第 N 场的 fans 初值必须是第 N-1 场的演化产物。
  // 若引擎退回「窗初值 / 库内现值 / 定值」当每场初值，单场对拍（③）仍会全绿——只有把两场串起来
  // 才能发现「链没接上」，这正是把历史数据算错的最隐蔽方式（TC-DB-04 的核心断言）。
  it('engine 两场链 == 运行期钩子两场链（含 fans 递推；fans_window_start 不参与每场演化）', async () => {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClubWithTeam(fx.auth, fx.sqlite, 1, 11); // 主队 club 1 ↔ tour 11
    seedClubWithTeam(fx.auth, fx.sqlite, 2, 12); // 客队（无球场行 → 默认影响力 90）
    seedStadium(fx.sqlite, 1, { capacity: 20000, tier: 0, shell: 90, fans: 1800, nextWeather: '晴' });
    insertMatch(fx.tour, { matchId: 1, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12 });
    insertMatch(fx.tour, { matchId: 2, tournamentId: 5, stageId: 50, homeTeamId: 11, awayTeamId: 12 });
    insertBinding(fx.sqlite, 1, 5, 'league_premier');

    // 运行期：两场依次确认（无赛果行 → form 中性 4；天气第一场走事件预置、第二场现掷，夹具 rng 恒 0.5）
    const runtimeFans: number[] = [];
    const runtimeWeather: string[] = [];
    for (const matchId of [1, 2]) {
      const { statements, detail } = await matchAttendanceStatements(fx.env, { matchId, season: 1, windowSeq: 1, homeTeamId: 11, awayTeamId: 12 });
      expect(detail).not.toBeNull();
      await fx.env.DB.batch(statements);
      runtimeFans.push((fx.sqlite.prepare('SELECT fans FROM stadiums WHERE club_id = 1').get() as { fans: number }).fans);
      runtimeWeather.push(detail!.weather);
    }
    // 两场都真的动了 fans（否则下面的链式断言等于没测）
    expect(runtimeFans[0]).not.toBe(1800);
    expect(runtimeFans[1]).not.toBe(runtimeFans[0]);

    // 引擎侧：同一批库内事实，逐场链式喂 fans（第一场 1800 = 窗初值）
    const model = await loadAttendanceModel(fx.env.DB);
    const tierTable = await loadTierTable(fx.env.DB);
    const coefs = await loadInfluenceTierCoefs(fx.env.DB);
    const homeInfluence = engine.teamInfluence(
      { shell_influence: 90, bonus_points: 0 },
      engine.playerInfluenceSum(playerRows(fx.sqlite, 1), model),
      engine.influenceTierCoef(coefs, 'premier'),
    );
    // 库内实算的影响力必须与引擎一致（同一球员行 / 同一系数）
    const runtimeInfluence = await (async () =>
      teamInfluence({ shell_influence: 90, bonus_points: 0 }, await playerInfluenceSum(fx.env, 1, model), influenceTierCoef(coefs, 'premier')))();
    expect(homeInfluence).toBe(runtimeInfluence);
    const levels = facilityLevels(fx.sqlite, 1);
    const ctxOf = (weather: string, fans: number) => ({
      model,
      tierTable,
      weather,
      wxOverride: null,
      formPts: 4,
      fans,
      capacity: 20000,
      tier: 0,
      nextAttendanceMod: 1,
      homeInfluence,
      awayInfluence: model.default_influence,
      facilityLevels: { commercial: levels.commercial, broadcast: levels.broadcast },
      youthLevel: levels.youth,
      fansBuff: 0,
      growRate: Number(CONFIG_DEFAULTS.fans_grow_rate_per_match),
      dropRate: Number(CONFIG_DEFAULTS.fans_drop_rate_per_match),
    });
    const out1 = engine.replayMatch(ctxOf(runtimeWeather[0], 1800));
    expect(out1.nextFans).toBe(runtimeFans[0]);
    const out2 = engine.replayMatch(ctxOf(runtimeWeather[1], out1.nextFans));
    expect(out2.nextFans).toBe(runtimeFans[1]);
    // 反证：第二场初值若当窗初值（链没接上）会得到别的数——这条差值存在，上一条断言才有意义
    expect(engine.replayMatch(ctxOf(runtimeWeather[1], 1800)).nextFans).not.toBe(runtimeFans[1]);
  });
});

// ───────────────────────── ⑥ 账本链重放 ─────────────────────────

describe('v6.28.0 C 段：账本链重放 replayBalanceChain（收入重记后必须整体改写 balance_after）', () => {
  it('按应用顺序累加重算；金额变了链就变、金额不变链逐字不变；不取整（运行期同口径）', () => {
    const before = [
      { id: 1, amount: 100, balance_after: 100 },
      { id: 2, amount: 5.55, balance_after: 105.55 },
      { id: 3, amount: -20, balance_after: 85.55 },
    ];
    // 不改金额：链逐字不变（幂等重放；也说明函数不是「另算一套数」）
    expect(engine.replayBalanceChain(before)).toEqual(before);
    // 比赛收入重记（id 1：100 → 120）：后续每一行的 balance_after 都必须跟着改——
    // 「只改金额不重放链」是 M14 变异，这条断言就是它的闸
    const after = engine.replayBalanceChain([{ ...before[0], amount: 120 }, before[1], before[2]]);
    let running = 0;
    const expected = [120, 5.55, -20].map((a) => (running = running + a));
    const balances = (rows: { balance_after: number }[]) => rows.map((e) => e.balance_after);
    expect(balances(after)).toEqual(expected);
    expect(balances(after)).not.toEqual(balances(before));
    // 运行期口径是不取整的 binary64 直接相加（生产现存链上就有 31.759999999999998 这类尾数），
    // 重演若自作主张 round 两位，verify 的逐行断言会全红
    const floaty = engine.replayBalanceChain([
      { id: 1, amount: 0.1, balance_after: 0 },
      { id: 2, amount: 0.2, balance_after: 0 },
    ]);
    expect(floaty[1].balance_after).toBe(0.1 + 0.2);
    expect(floaty[1].balance_after).not.toBe(0.3);
  });
});
