// v6.10.0 随机事件域（D1）：事件池种子 / 规则与钳幅配置 / 条件判定 / 加权单抽 / 触发批 /
// 11 键效果与钳幅 / occurrence 状态闸重放幂等 / 关窗批消费预置上座乘数·天气 / 管理端路由。
// 口径对齐参考插件 services/event_engine.py + event_effects.py（差异见 event-ops.ts 头注释）。
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { confirmResult } from '../src/worker/results.ts';
import {
  ATTENDANCE_MOD_MAX,
  ATTENDANCE_MOD_MIN,
  EVENT_CLAMPS_DEFAULT,
  EVENT_RULES_DEFAULT,
  EVENT_SIGNALS_DEFAULT,
  applyEventEffects,
  cleanSignals,
  collectWindowSignals,
  conditionOk,
  lastResultOf,
  loadEventClamps,
  loadEventContexts,
  loadEventPool,
  loadEventSignals,
  loadEventRules,
  pickEvent,
  renderEventText,
  triggerEventBatch,
  type EventClubContext,
  type EventRow,
} from '../src/worker/event-ops.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  // 管理端 requireAdmin 读 TOUR_DB 的 user 表（与 naming-ops.test.ts 同）
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0), (2, '管理组甲', 'admin', 0, 0);`,
  );
  const { sqlite: authSqlite, d1: authD1 } = createAuthDb();
  const kv = new Map<string, string>();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: authD1,
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    rng: () => 0.5,
  } as unknown as Env;
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, auth: authSqlite, kv };
}

interface ClubOpts {
  capacity?: number;
  tier?: number;
  fans?: number;
  balance?: number;
  shell?: number;
  buildCredit?: number;
  nextMod?: number;
  nextWeather?: string;
  stadiumName?: string;
  /** false = 不建球场行（上座用例里客队要走「无球场行 → 默认影响力」分支） */
  stadium?: boolean;
}

function seedClub(auth: DatabaseSync, sqlite: DatabaseSync, clubId: number, tourTeamId: number, opts: ClubOpts = {}) {
  sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`).run(clubId, `俱乐部${clubId}`);
  sqlite
    .prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`)
    .run(clubId, opts.balance ?? 50);
  if (opts.stadium === false) {
    authRegisterClubTeam(auth, tourTeamId, clubId, `队${tourTeamId}`);
    return;
  }
  sqlite
    .prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, next_attendance_mod, next_weather, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(
      clubId,
      opts.stadiumName ?? '',
      opts.capacity ?? 20000,
      opts.tier ?? 0,
      opts.shell ?? 0,
      opts.fans ?? 1800,
      opts.buildCredit ?? 0,
      opts.nextMod ?? 1,
      opts.nextWeather ?? '',
    );
  authRegisterClubTeam(auth, tourTeamId, clubId, `队${tourTeamId}`);
}

/** 停用全部种子事件，只留本用例的自定义事件（抽取确定性用） */
function onlyCustom(sqlite: DatabaseSync) {
  sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
}

/** 开放 S1W1（事件效果里档期类要开窗才生效）+ 建 S1 赛季行（occurrences 端点默认取可见赛季） */
function openWindow(sqlite: DatabaseSync) {
  sqlite.prepare(`INSERT INTO seasons (season, status, created_at) VALUES (1, 'running', '2026-07-01T00:00:00Z')`).run();
  sqlite
    .prepare(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z')`)
    .run();
}

/** 把教练账号（userId）绑到 clubId：让通知落得下来（AUTH_DB team_binding → 本地 qq_links） */
function bindAccount(fx: Fixture, clubId: number, userId: number, qq = '') {
  const team = fx.auth.prepare('SELECT id FROM team WHERE club_id = ?').get(clubId) as { id: number } | undefined;
  if (!team) throw new Error(`club ${clubId} 没有 auth team 行`);
  fx.auth
    .prepare(`INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (?, ?, 'web', '2026-01-01T00:00:00Z')`)
    .run(userId, team.id);
  if (qq !== '') {
    fx.sqlite.prepare(`INSERT INTO qq_links (user_id, qq, verified_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`).run(userId, qq);
  }
}

/** 插一条自定义即发型事件（source='custom'，便于逐键验证效果） */
function addEvent(
  sqlite: DatabaseSync,
  eventId: string,
  effects: Record<string, unknown>,
  opts: { name?: string; eventType?: string; conditions?: Record<string, unknown>; weight?: number; status?: string; soft?: number; template?: string } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO event_pool (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
                               soft_conditions, template, source, status, created_at)
       VALUES (?, ?, '测试', ?, ?, ?, ?, '[]', ?, ?, 'custom', ?, '2026-01-01T00:00:00Z')`,
    )
    .run(
      eventId,
      opts.name ?? `事件${eventId}`,
      opts.weight ?? 10,
      opts.eventType ?? 'instant',
      JSON.stringify(opts.conditions ?? {}),
      JSON.stringify(effects),
      opts.soft ?? 0,
      opts.template ?? '{team} 在 {stadium} 出了事。',
      opts.status ?? 'adopted',
    );
}

function overrideConfig(sqlite: DatabaseSync, key: string, value: unknown) {
  sqlite.prepare(`INSERT INTO config (key, value, updated_at) VALUES (?, ?, '2026-07-01T00:00:00Z')`).run(key, JSON.stringify(value));
  resetConfigCache();
}

/** 纯上下文（条件判定用），默认：容量 20000 / 0 级 / 死忠 1800 / 余额 50 / 无冠名无档期无战绩 */
function ctxOf(patch: Partial<EventClubContext> = {}): EventClubContext {
  return {
    clubId: 1,
    name: '俱乐部1',
    stadium: {
      club_id: 1,
      name: '',
      capacity: 20000,
      tier: 0,
      shell_influence: 0,
      bonus_points: 0,
      fans: 1800,
      build_credit: 0,
      next_attendance_mod: 1,
      next_weather: '',
    },
    balance: 50,
    facilities: new Map<string, number>(),
    brand: null,
    namingId: null,
    satisfaction: null,
    activities: [],
    lastResult: null,
    tourTeamId: 11,
    ...patch,
  };
}

/** 点名触发一条事件（绕过概率与条件），返回第一条触发结果 */
async function fireNamed(fx: Fixture, eventId: string, effects: Record<string, unknown>, clubId = 1, extra: Parameters<typeof addEvent>[3] = {}) {
  addEvent(fx.sqlite, eventId, effects, extra);
  const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [clubId], eventId, rng: () => 0 });
  return { res, event: res.events[0]! };
}

beforeEach(() => resetConfigCache());

describe('事件池种子（迁移 0047，插件 DEFAULT_EVENTS 逐字同）', () => {
  it('30 条 = 8 即发型 + 22 选择型（0047 的 24 + 0052 新种子 6）；即发型名单与 storm_buzz 效果一致', async () => {
    const fx = freshEnv();
    const pool = await loadEventPool(fx.env.DB);
    expect(pool).toHaveLength(30);
    const instant = pool.filter((r) => r.event_type === 'instant');
    expect(instant.map((r) => r.event_id)).toEqual([
      'storm_buzz', 'tifo_viral', 'bad_press', 'relic_found', 'subsidy', 'security_break', 'legend_visit', 'sponsor_audit',
    ]);
    expect(JSON.parse(instant[0]!.effects_json)).toEqual({ attendance_mod: 0.85 });
    expect(instant.every((r) => r.source === 'builtin' && r.status === 'adopted' && r.soft_conditions === 0)).toBe(true);
    // 选择型带选项表，且 requires_naming / requires_activity 条件落在冠名/档期联动那几条上
    const choice = pool.filter((r) => r.event_type === 'choice');
    expect(choice).toHaveLength(22);
    expect(choice.every((r) => (JSON.parse(r.options_json) as unknown[]).length >= 2)).toBe(true);
    expect(JSON.parse(choice.find((r) => r.event_id === 'brand_crisis')!.conditions_json)).toEqual({ requires_naming: true });
    expect(JSON.parse(choice.find((r) => r.event_id === 'guest_ghost')!.conditions_json)).toEqual({ requires_activity: 'concert' });
    // v6.12.0（D3）：新种子覆盖 satisfaction / signals；0047 存量补丁也带上了（未 apply 前的直接编辑）
    expect(choice.find((r) => r.event_id === 'adboard_row')!.options_json).toContain('satisfaction');
    expect(choice.find((r) => r.event_id === 'brand_crisis')!.options_json).toContain('satisfaction');
    expect(choice.find((r) => r.event_id === 'brand_anniv')!.options_json).toContain('satisfaction');
    const withSignals = pool.filter((r) => r.effects_json.includes('signals') || r.options_json.includes('signals'));
    expect(withSignals.map((r) => r.event_id)).toEqual(
      expect.arrayContaining(['legend_visit', 'sponsor_audit', 'tifo_viral', 'bad_press', 'new_wave', 'merch_hit', 'scalper_raid', 'food_fest', 'derby_buzz']),
    );
  });

  it('种子句重跑幂等（INSERT OR IGNORE 不重复）', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(
      `INSERT OR IGNORE INTO event_pool (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
         soft_conditions, template, source, status, created_at)
       VALUES ('storm_buzz', '暴雨滂沱', '天气衍生', 8, 'instant', '{}', '{"attendance_mod":0.85}', '[]', 0, 'x', 'builtin', 'adopted', '2026-01-01T00:00:00Z')`,
    );
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM event_pool`)!.n).toBe(30);
  });
});

describe('规则与钳幅配置（config event_rules / event_clamps / event_signals）', () => {
  it('缺行回默认；非法/越界字段逐字段回落并按界钳制', async () => {
    const fx = freshEnv();
    expect(await loadEventRules(fx.env.DB)).toEqual(EVENT_RULES_DEFAULT);
    expect(await loadEventClamps(fx.env.DB)).toEqual(EVENT_CLAMPS_DEFAULT);

    overrideConfig(fx.sqlite, 'event_rules', { hitProbability: 2, maxPerClub: 0, maxOccurrences: 99, softConditionFactor: -1, choiceDeadlineHours: 'abc' });
    expect(await loadEventRules(fx.env.DB)).toEqual({
      hitProbability: 1, // 越界钳到 1
      maxPerClub: 1, // 越界钳到 1
      maxOccurrences: 20, // 越界钳到 20
      softConditionFactor: 0, // 越界钳到 0
      choiceDeadlineHours: EVENT_RULES_DEFAULT.choiceDeadlineHours, // 非数字回落默认
      maxPending: EVENT_RULES_DEFAULT.maxPending, // 缺字段回落默认
    });

    // 钳幅一律取绝对值（负值抬 0 由效果侧处理）
    overrideConfig(fx.sqlite, 'event_clamps', { money: -9, fansPct: 0.02 });
    const clamps = await loadEventClamps(fx.env.DB);
    expect(clamps.money).toBe(9);
    expect(clamps.fansPct).toBe(0.02);
    expect(clamps.maintenance).toBe(EVENT_CLAMPS_DEFAULT.maintenance);
    expect(clamps.satisfaction).toBe(EVENT_CLAMPS_DEFAULT.satisfaction);
  });

  it('maxPending 可覆盖（0 = 不限）；event_signals 定义可覆盖 label 与钳幅', async () => {
    const fx = freshEnv();
    overrideConfig(fx.sqlite, 'event_rules', { maxPending: 0 });
    expect((await loadEventRules(fx.env.DB)).maxPending).toBe(0);
    overrideConfig(fx.sqlite, 'event_signals', { fan_mood: { label: '舆情', type: 'step', clamp: 1 } });
    const defs = await loadEventSignals(fx.env.DB);
    expect(defs.fan_mood).toEqual({ label: '舆情', type: 'step', clamp: 1 });
    expect(defs.upkeep).toEqual(EVENT_SIGNALS_DEFAULT.upkeep); // 未覆盖键回落默认
  });
});

describe('条件判定 conditionOk（硬条件 AND）', () => {
  it('空条件恒真；档位/容量/死忠/余额上下界', () => {
    const ctx = ctxOf({ stadium: { ...ctxOf().stadium, tier: 2, capacity: 20000, fans: 1800 }, balance: 50 });
    expect(conditionOk(ctx, {})).toBe(true);
    expect(conditionOk(ctx, { min_tier: 2, max_tier: 2 })).toBe(true);
    expect(conditionOk(ctx, { min_tier: 3 })).toBe(false);
    expect(conditionOk(ctx, { max_tier: 1 })).toBe(false);
    expect(conditionOk(ctx, { min_capacity: 20000 })).toBe(true);
    expect(conditionOk(ctx, { min_capacity: 25000 })).toBe(false);
    expect(conditionOk(ctx, { max_capacity: 15000 })).toBe(false);
    expect(conditionOk(ctx, { min_fans: 1800, max_fans: 1800 })).toBe(true);
    expect(conditionOk(ctx, { min_fans: 1801 })).toBe(false);
    expect(conditionOk(ctx, { max_fans: 1799 })).toBe(false);
    expect(conditionOk(ctx, { min_balance: 50, max_balance: 50 })).toBe(true);
    expect(conditionOk(ctx, { min_balance: 50.1 })).toBe(false);
    expect(conditionOk(ctx, { max_balance: 49.9 })).toBe(false);
  });

  it('设施等级：达标才过；未知设施键忽略（插件同样不校验）', () => {
    const ctx = ctxOf({ facilities: new Map([['youth', 2]]) });
    expect(conditionOk(ctx, { facility_min: { youth: 2 } })).toBe(true);
    expect(conditionOk(ctx, { facility_min: { youth: 3 } })).toBe(false);
    expect(conditionOk(ctx, { facility_min: { medical: 1 } })).toBe(false);
    expect(conditionOk(ctx, { facility_min: { 不存在的设施: 9 } })).toBe(true);
  });

  it('weather_is 读预置的下一场天气（没预置=不满足）；last_result 支持 win/w/loss 别名', () => {
    expect(conditionOk(ctxOf(), { weather_is: '雨' })).toBe(false);
    const rainy = ctxOf({ stadium: { ...ctxOf().stadium, next_weather: '雨' } });
    expect(conditionOk(rainy, { weather_is: '雨' })).toBe(true);
    expect(conditionOk(rainy, { weather_is: '晴' })).toBe(false);

    const won = ctxOf({ lastResult: 'W' });
    expect(conditionOk(won, { last_result: 'win' })).toBe(true);
    expect(conditionOk(won, { last_result: 'W' })).toBe(true);
    expect(conditionOk(won, { last_result: 'loss' })).toBe(false);
    expect(conditionOk(ctxOf(), { last_result: 'draw' })).toBe(false);
    expect(conditionOk(won, { last_result: '莫名其妙' })).toBe(false);
  });

  it('requires_naming / requires_activity', () => {
    expect(conditionOk(ctxOf(), { requires_naming: true })).toBe(false);
    expect(conditionOk(ctxOf({ brand: '可口可乐' }), { requires_naming: true })).toBe(true);
    expect(conditionOk(ctxOf(), { requires_activity: 'concert' })).toBe(false);
    expect(conditionOk(ctxOf({ activities: ['open_day', 'concert'] }), { requires_activity: 'concert' })).toBe(true);
  });
});

describe('最近一场战绩口径 lastResultOf（弃权按取胜方、点球决胜按平）', () => {
  const row = (
    patch: Partial<{
      home_team_id: number | null;
      away_team_id: number | null;
      score_home: number | null;
      score_away: number | null;
      pen_home: number | null;
      pen_away: number | null;
      walkover_side: string | null;
    }>,
  ) => ({
    home_team_id: 11,
    away_team_id: 12,
    score_home: 2,
    score_away: 0,
    pen_home: null,
    pen_away: null,
    walkover_side: null,
    ...patch,
  });

  it('胜/平/负与点球按平', () => {
    expect(lastResultOf([row({})], 11)).toBe('W');
    expect(lastResultOf([row({})], 12)).toBe('L');
    expect(lastResultOf([row({ score_home: 1, score_away: 1 })], 11)).toBe('D');
    // 点球决胜：正赛平 → 记平（与 home.ts formPtsOf 同口径）
    expect(lastResultOf([row({ score_home: 1, score_away: 1, pen_home: 4, pen_away: 3 })], 11)).toBe('D');
  });

  it('弃权记的是取胜方：walkover_side=home → 主队胜', () => {
    expect(lastResultOf([row({ walkover_side: 'home', score_home: null, score_away: null })], 11)).toBe('W');
    expect(lastResultOf([row({ walkover_side: 'home', score_home: null, score_away: null })], 12)).toBe('L');
    expect(lastResultOf([row({ walkover_side: 'away', score_home: null, score_away: null })], 11)).toBe('L');
  });

  it('按 id DESC 取第一条涉及该队的；无关行与脏行跳过', () => {
    const rows = [row({ home_team_id: 21, away_team_id: 22 }), row({ walkover_side: 'away', score_home: null, score_away: null })];
    expect(lastResultOf(rows, 11)).toBe('L');
    expect(lastResultOf([row({ home_team_id: null, away_team_id: null })], 11)).toBeNull();
    expect(lastResultOf([], 11)).toBeNull();
  });
});

describe('加权单抽 pickEvent', () => {
  it('硬条件不满足的剔除；status=discarded 剔除；已达 maxOccurrences 剔除', async () => {
    const fx = freshEnv();
    onlyCustom(fx.sqlite);
    addEvent(fx.sqlite, 'a_ok', { money: 1 });
    addEvent(fx.sqlite, 'b_blocked', { money: 1 }, { conditions: { min_tier: 5 } });
    addEvent(fx.sqlite, 'c_off', { money: 1 }, { status: 'discarded' });
    const pool = await loadEventPool(fx.env.DB);
    const ctx = ctxOf();
    const rules = EVENT_RULES_DEFAULT;

    const picked = pickEvent(pool, ctx, rules, () => 0, {});
    expect(picked!.event_id).toBe('a_ok');
    // a_ok 已达上限（maxOccurrences=2 → 用 2 次即剔）后只剩被条件挡住的 → null
    expect(pickEvent(pool, ctx, rules, () => 0, { a_ok: 2 })).toBeNull();
  });

  it('soft_conditions=1 的条件不满足行按 权重×softConditionFactor 衰减参与（不是硬剔除）', async () => {
    const fx = freshEnv();
    onlyCustom(fx.sqlite);
    // 顺序：软条件行在前（权重 10→2.5），硬通过行在后（权重 1）→ 总权重 3.5
    addEvent(fx.sqlite, 'soft_row', { money: 1 }, { conditions: { min_tier: 9 }, soft: 1 });
    addEvent(fx.sqlite, 'ok_row', { money: 1 }, { weight: 1 });
    const pool = await loadEventPool(fx.env.DB);
    const ctx = ctxOf();
    const rules = EVENT_RULES_DEFAULT;
    // rng 0.1 → x=0.35 落在软条件行（2.5）里；若软条件行被硬剔除，这里会抽到 ok_row
    expect(pickEvent(pool, ctx, rules, () => 0.1, {})!.event_id).toBe('soft_row');
    // rng 0.95 → x=3.325 → 减 2.5 后剩 0.825 → 落在 ok_row
    expect(pickEvent(pool, ctx, rules, () => 0.95, {})!.event_id).toBe('ok_row');
    // softConditionFactor=0 时软条件行权重归零 → 只剩 ok_row
    expect(pickEvent(pool, ctx, { ...rules, softConditionFactor: 0 }, () => 0.1, {})!.event_id).toBe('ok_row');
  });

  it('renderEventText 替换 {team}/{stadium}，无球场名回落到「X主场」', () => {
    const ev = { template: '{team} 的主场 {stadium} 出事' } as EventRow;
    expect(renderEventText(ev, ctxOf())).toBe('俱乐部1 的主场 俱乐部1主场 出事');
    expect(renderEventText(ev, ctxOf({ stadium: { ...ctxOf().stadium, name: '酋长球场' } }))).toBe('俱乐部1 的主场 酋长球场 出事');
  });
});

describe('触发批 triggerEventBatch', () => {
  it('命中概率：0 不触发、1 必触发；maxPerClub 限制每队次数；occurrence 落 resolved 行 + 审计', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addEvent(fx.sqlite, 'only_one', { money: 1 });

    // 默认 hitProbability=0.4，rng=0.9 → 不命中
    const miss = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], rng: () => 0.9 });
    expect(miss).toMatchObject({ clubs: 1, triggered: 0, capped: 0 });

    const hit = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], rng: () => 0 });
    expect(hit.triggered).toBe(1);
    expect(hit.events[0]!.eventId).toBe('only_one');

    const occ = sqlGet<{ status: string; event_type: string; resolved_by: string; text: string; notes_json: string; effects_json: string }>(
      fx.sqlite,
      `SELECT status, event_type, resolved_by, text, notes_json, effects_json FROM event_occurrences WHERE id = ${hit.events[0]!.occurrenceId}`,
    )!;
    expect(occ.status).toBe('resolved');
    expect(occ.event_type).toBe('instant');
    expect(occ.resolved_by).toBe('2');
    expect(occ.text).toBe('俱乐部1 在 俱乐部1主场 出了事。');
    expect(JSON.parse(occ.notes_json)).toEqual(['资金 +1.0 m']);

    const audits = sqlAll<{ actor: number; action: string; target_type: string; origin: string; after: string }>(
      fx.sqlite,
      `SELECT actor, action, target_type, origin, after FROM audit_log WHERE action = 'event_trigger'`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: 2, action: 'event_trigger', target_type: 'event_occurrence', origin: 'user' });
    expect(JSON.parse(audits[0]!.after)).toMatchObject({ clubId: 1, eventId: 'only_one', eventName: '事件only_one', notes: ['资金 +1.0 m'] });
  });

  it('maxOccurrences：同一事件最多被 N 队抽中（默认 2），第 3 队改抽下一条', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    seedClub(fx.auth, fx.sqlite, 2, 12);
    seedClub(fx.auth, fx.sqlite, 3, 13);
    // 只留两条自定义事件参与：把 24 条种子全停用
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx.sqlite, 'cap_a', { money: 1 }, { weight: 10 });
    addEvent(fx.sqlite, 'cap_b', { money: 1 }, { weight: 10 });

    // rng=0：先命中、再在加权里取第一条候选（x=0 → 第一个）
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1, 2, 3], rng: () => 0 });
    expect(res.triggered).toBe(3);
    expect(res.events.map((e) => e.eventId)).toEqual(['cap_a', 'cap_a', 'cap_b']);

    // maxOccurrences=1 → 第 2 队就换下一条
    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11);
    seedClub(fx2.auth, fx2.sqlite, 2, 12);
    fx2.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx2.sqlite, 'cap_a', { money: 1 });
    addEvent(fx2.sqlite, 'cap_b', { money: 1 });
    overrideConfig(fx2.sqlite, 'event_rules', { maxOccurrences: 1 });
    const res2 = await triggerEventBatch(fx2.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1, 2], rng: () => 0 });
    expect(res2.events.map((e) => e.eventId)).toEqual(['cap_a', 'cap_b']);
  });

  it('掷中但无候选 → 计入 capped；选择型自 v6.11.0 起也参与随机抽取', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx.sqlite, 'blocked', { money: 1 }, { conditions: { min_tier: 9 } });
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], rng: () => 0 });
    expect(res).toMatchObject({ clubs: 1, triggered: 0, capped: 1 });

    // 池里只有选择型 → v6.11.0（D2）起也抽，抽中只挂待选（不落效果）
    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11);
    fx2.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx2.sqlite, 'choice_only', {}, { eventType: 'choice' });
    const res2 = await triggerEventBatch(fx2.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], rng: () => 0 });
    expect(res2).toMatchObject({ triggered: 1, capped: 0 });
    expect(res2.events[0]!.eventType).toBe('choice');
  });

  it('点名触发绕过命中概率与条件；不存在 404、停用 400、选择型自 v6.11.0 起可点名', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    // 条件不满足（tier 9）也照演
    addEvent(fx.sqlite, 'named_force', { money: 2 }, { conditions: { min_tier: 9 } });
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'named_force', rng: () => 0.99 });
    expect(res.triggered).toBe(1);
    expect(res.events[0]!.eventId).toBe('named_force');

    await expect(
      triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: '没有这个' }),
    ).rejects.toThrow('没有「没有这个」这个事件');

    addEvent(fx.sqlite, 'off_one', { money: 1 }, { status: 'discarded' });
    await expect(
      triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'off_one' }),
    ).rejects.toThrow('已停用，先启用再触发');

    addEvent(fx.sqlite, 'choice_one', {}, { eventType: 'choice' });
    const namedChoice = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'choice_one' });
    expect(namedChoice.triggered).toBe(1);
    expect(namedChoice.events[0]!.eventType).toBe('choice');
  });

  it('cron_tick 触发：审计 origin 走 cron 通道（actor 为 null 时 resolved_by 记 system）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx.sqlite, 'tick_ev', { money: 1 });
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: null, origin: 'cron_tick', clubIds: [1], eventId: 'tick_ev' });
    expect(res.triggered).toBe(1);
    expect(sqlGet<{ resolved_by: string; origin: string }>(
      fx.sqlite,
      `SELECT resolved_by, (SELECT origin FROM audit_log WHERE target_id = event_occurrences.id AND action = 'event_trigger') AS origin
         FROM event_occurrences WHERE id = ${res.events[0]!.occurrenceId}`,
    )).toEqual({ resolved_by: 'system', origin: 'cron_tick' });
  });

  it('无俱乐部（空表）返回全零', async () => {
    const fx = freshEnv();
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user' });
    expect(res).toEqual({ clubs: 0, triggered: 0, capped: 0, events: [] });
  });
});

describe('队况上下文 loadEventContexts', () => {
  it('批量装：球场列/余额/设施/生效冠名/本窗档期/最近战绩；缺球场行的队全零兜底不跳过', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11, { tier: 2, fans: 3000, balance: 88, buildCredit: 4, nextWeather: '雨', stadiumName: '酋长球场' });
    // 2 号队：只有 clubs 行（无球场/无余额行）
    fx.sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (2, '俱乐部2', 'premier', 'active')`).run();
    fx.sqlite.prepare(`INSERT INTO club_facilities (club_id, facility_key, level, updated_at) VALUES (1, 'youth', 3, '2026-01-01T00:00:00Z')`).run();
    fx.sqlite
      .prepare(
        `INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window, windows_total,
           windows_remaining, status, started_season, started_window, created_at, updated_at)
         VALUES (1, '可口可乐', 1.0, 1.0, 1, '稳健', 0.85, 6, 6, 'active', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run();
    fx.sqlite
      .prepare(
        `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
         VALUES (1, 1, 1, 1, 'concert', '', '2026-01-01T00:00:00Z')`,
      )
      .run();
    fx.sqlite
      .prepare(
        `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id, score_home, score_away,
           home_team, away_team, confirmed_at)
         VALUES (1, 1, 5, 1, 11, 12, 3, 0, '队11', '队12', '2026-01-01T00:00:00Z')`,
      )
      .run();

    const ctxs = await loadEventContexts(fx.env, [1, 2], 1, 1);
    const c1 = ctxs.get(1)!;
    expect(c1.name).toBe('俱乐部1');
    expect(c1.stadium).toMatchObject({ capacity: 20000, tier: 2, fans: 3000, build_credit: 4, next_weather: '雨', name: '酋长球场' });
    expect(c1.balance).toBe(88);
    expect(c1.facilities.get('youth')).toBe(3);
    expect(c1.brand).toBe('可口可乐');
    expect(c1.activities).toEqual(['concert']);
    expect(c1.lastResult).toBe('W');
    expect(c1.tourTeamId).toBe(11);

    const c2 = ctxs.get(2)!;
    expect(c2.stadium).toMatchObject({ capacity: 0, tier: 0, fans: 0, next_attendance_mod: 1, next_weather: '' });
    expect(c2.balance).toBe(0);
    expect(c2.brand).toBeNull();
    expect(c2.activities).toEqual([]);
    expect(c2.lastResult).toBeNull();
  });

  it('clubs 表里没有的 id 不装上下文（点名叫错 id 不留幽灵 occurrence）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const ctxs = await loadEventContexts(fx.env, [1, 999], 1, 1);
    expect([...ctxs.keys()]).toEqual([1]);
  });
});

describe('11 键效果与钳幅（点名触发逐键验证）', () => {
  it('money：kind=event、ref 锚回 occurrence、钳 ±clamps.money', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const { event } = await fireNamed(fx, 'money_ev', { money: 6 });
    const row = sqlGet<{ kind: string; amount: number; ref_type: string; ref_id: number; memo: string }>(
      fx.sqlite,
      `SELECT kind, amount, ref_type, ref_id, memo FROM ledger_entries WHERE kind = 'event'`,
    )!;
    expect(row).toEqual({ kind: 'event', amount: 6, ref_type: 'event', ref_id: event.occurrenceId, memo: '事件money_ev：资金 +6.0 m' });
    expect(event.notes).toEqual(['资金 +6.0 m']);

    // 越界钳到 ±8（含负值出账）
    const up = await fireNamed(fx, 'money_big', { money: 99 });
    expect(up.event.effects.money).toBe(EVENT_CLAMPS_DEFAULT.money);
    const down = await fireNamed(fx, 'money_neg', { money: -99 });
    expect(down.event.effects.money).toBe(-EVENT_CLAMPS_DEFAULT.money);
  });

  it('maintenance：改记 kind=maintenance（独立闸）、只钳正向、负值抬 0 不落账', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const { event } = await fireNamed(fx, 'maint_ev', { maintenance: 3 });
    const row = sqlGet<{ kind: string; amount: number; ref_type: string; ref_id: number }>(
      fx.sqlite,
      `SELECT kind, amount, ref_type, ref_id FROM ledger_entries WHERE kind = 'maintenance'`,
    )!;
    expect(row).toEqual({ kind: 'maintenance', amount: -3, ref_type: 'event', ref_id: event.occurrenceId });
    expect(event.notes).toEqual(['草皮维护 -3.0 m']);

    const big = await fireNamed(fx, 'maint_big', { maintenance: 99 });
    expect(big.event.effects.maintenance).toBe(EVENT_CLAMPS_DEFAULT.maintenance);
    const neg = await fireNamed(fx, 'maint_neg', { maintenance: -3 });
    expect(neg.event.effects.maintenance).toBeUndefined();
    expect(neg.event.notes).toEqual([]);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'maintenance'`)!.n).toBe(2);
  });

  it('fans_pct：fans×(1+v) 钳 ±clamps.fansPct、上限 capacity', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11, { fans: 1800, capacity: 20000 });
    await fireNamed(fx, 'fans_up', { fans_pct: 0.5 });
    expect(sqlGet<{ fans: number }>(fx.sqlite, `SELECT fans FROM stadiums WHERE club_id = 1`)!.fans).toBe(1890); // 钳到 +0.05

    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11, { fans: 1800 });
    await fireNamed(fx2, 'fans_down', { fans_pct: -1 });
    expect(sqlGet<{ fans: number }>(fx2.sqlite, `SELECT fans FROM stadiums WHERE club_id = 1`)!.fans).toBe(1710); // 钳到 -0.05

    const fx3 = freshEnv();
    seedClub(fx3.auth, fx3.sqlite, 1, 11, { fans: 19900, capacity: 20000 });
    await fireNamed(fx3, 'fans_cap', { fans_pct: 0.05 });
    expect(sqlGet<{ fans: number }>(fx3.sqlite, `SELECT fans FROM stadiums WHERE club_id = 1`)!.fans).toBe(20000);
  });

  it('attendance_mod：与现值相乘叠加、钳 [0.5, 2.0]、非正数落空', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    await fireNamed(fx, 'att_ev', { attendance_mod: 0.85 });
    expect(sqlGet<{ next_attendance_mod: number }>(fx.sqlite, `SELECT next_attendance_mod FROM stadiums WHERE club_id = 1`)!.next_attendance_mod).toBe(0.85);

    // 预置 1.5 × 2.0 = 3.0 → 钳到 2.0
    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11, { nextMod: 1.5 });
    await fireNamed(fx2, 'att_hi', { attendance_mod: 2 });
    expect(sqlGet<{ next_attendance_mod: number }>(fx2.sqlite, `SELECT next_attendance_mod FROM stadiums WHERE club_id = 1`)!.next_attendance_mod).toBe(ATTENDANCE_MOD_MAX);

    // 预置 0.6 × 0.5 = 0.3 → 钳到 0.5
    const fx3 = freshEnv();
    seedClub(fx3.auth, fx3.sqlite, 1, 11, { nextMod: 0.6 });
    await fireNamed(fx3, 'att_lo', { attendance_mod: 0.5 });
    expect(sqlGet<{ next_attendance_mod: number }>(fx3.sqlite, `SELECT next_attendance_mod FROM stadiums WHERE club_id = 1`)!.next_attendance_mod).toBe(ATTENDANCE_MOD_MIN);

    const fx4 = freshEnv();
    seedClub(fx4.auth, fx4.sqlite, 1, 11, { nextMod: 1.5 });
    const zero = await fireNamed(fx4, 'att_zero', { attendance_mod: 0 });
    expect(zero.event.effects.attendance_mod).toBeUndefined();
    expect(sqlGet<{ next_attendance_mod: number }>(fx4.sqlite, `SELECT next_attendance_mod FROM stadiums WHERE club_id = 1`)!.next_attendance_mod).toBe(1.5);
  });

  it('weather_set：写预置天气；不在天气表里的键落空（不抛）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const ok = await fireNamed(fx, 'weather_ok', { weather_set: { weather: '雨' } });
    expect(ok.event.notes).toEqual(['下一场天气 → 雨']);
    expect(sqlGet<{ next_weather: string }>(fx.sqlite, `SELECT next_weather FROM stadiums WHERE club_id = 1`)!.next_weather).toBe('雨');

    const bad = await fireNamed(fx, 'weather_bad', { weather_set: { weather: '台风' } });
    expect(bad.event.effects.weather_set).toBeUndefined();
    expect(bad.event.notes).toEqual(['天气「台风」不在天气表里，落空']);
    expect(sqlGet<{ next_weather: string }>(fx.sqlite, `SELECT next_weather FROM stadiums WHERE club_id = 1`)!.next_weather).toBe('雨');
  });

  it('build_credit / influence：直改列、钳 ±5 / ±10，influence 底 0', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11, { buildCredit: 2, shell: 5 });
    await fireNamed(fx, 'credit_ev', { build_credit: 3, influence: 7 });
    expect(sqlGet<{ build_credit: number; shell_influence: number }>(fx.sqlite, `SELECT build_credit, shell_influence FROM stadiums WHERE club_id = 1`)).toEqual({
      build_credit: 5,
      shell_influence: 12,
    });

    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11, { buildCredit: 2, shell: 5 });
    await fireNamed(fx2, 'credit_big', { build_credit: 99, influence: -99 });
    expect(sqlGet<{ build_credit: number; shell_influence: number }>(fx2.sqlite, `SELECT build_credit, shell_influence FROM stadiums WHERE club_id = 1`)).toEqual({
      build_credit: 7, // 钳到 +5
      shell_influence: 0, // 钳到 -10 后再抬 0
    });
  });

  it('facility：delta 收敛 ±1、钳 0-5、行缺失同批补 0 级行；未知设施键/已到界落空', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.prepare(`INSERT INTO club_facilities (club_id, facility_key, level, updated_at) VALUES (1, 'youth', 2, '2026-01-01T00:00:00Z')`).run();
    const up = await fireNamed(fx, 'fac_up', { facility: { key: 'youth', delta: 5 } }); // delta 收敛 +1
    expect(up.event.effects.facility).toEqual({ key: 'youth', delta: 1 });
    expect(up.event.notes).toEqual(['设施 youth 2→3 级']);

    // 行缺失：先补 0 级再置 1
    const born = await fireNamed(fx, 'fac_born', { facility: { key: 'medical', delta: 1 } });
    expect(born.event.notes).toEqual(['设施 medical 0→1 级']);
    expect(sqlGet<{ level: number }>(fx.sqlite, `SELECT level FROM club_facilities WHERE club_id = 1 AND facility_key = 'medical'`)!.level).toBe(1);

    // 已到 5 级 → 落空；未知键 → 落空
    fx.sqlite.prepare(`UPDATE club_facilities SET level = 5 WHERE club_id = 1 AND facility_key = 'youth'`).run();
    const maxed = await fireNamed(fx, 'fac_max', { facility: { key: 'youth', delta: 1 } });
    expect(maxed.event.effects.facility).toBeUndefined();
    expect(maxed.event.notes).toEqual(['设施 youth 已在 5 级，落空']);
    const unknown = await fireNamed(fx, 'fac_unknown', { facility: { key: 'casino', delta: 1 } });
    expect(unknown.event.notes).toEqual(['设施「casino」不在设施表里，落空']);
  });

  it('brand_heat：取生效冠名品牌、钳 [0.5,1.5]；无冠名落空', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite
      .prepare(
        `INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window, windows_total,
           windows_remaining, status, started_season, started_window, created_at, updated_at)
         VALUES (1, '可口可乐', 1.0, 1.0, 1, '稳健', 0.85, 6, 6, 'active', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      )
      .run();
    const up = await fireNamed(fx, 'heat_up', { brand_heat: 0.05 });
    expect(up.event.notes).toEqual(['品牌热度 +0.05（可口可乐）']);
    expect(sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '可口可乐'`)!.heat).toBe(1.05);

    // 钳上限：+0.3 → 1.35；再 +0.3 → 1.5 封顶
    await fireNamed(fx, 'heat_big', { brand_heat: 99 });
    expect(sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '可口可乐'`)!.heat).toBe(1.35);
    await fireNamed(fx, 'heat_big2', { brand_heat: 99 });
    expect(sqlGet<{ heat: number }>(fx.sqlite, `SELECT heat FROM brand_pool WHERE brand = '可口可乐'`)!.heat).toBe(1.5);

    // 无冠名的队落空
    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11);
    const none = await fireNamed(fx2, 'heat_none', { brand_heat: 0.05 });
    expect(none.event.effects.brand_heat).toBeUndefined();
    expect(none.event.notes).toEqual(['品牌热度 +0.05（本队没有生效冠名，落空）']);
  });

  it('booking_cancel：按 slot_no 降序撤 n 个；无开窗/无档期落空', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    openWindow(fx.sqlite);
    fx.sqlite.exec(`
      INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
      VALUES (1, 1, 1, 1, 'concert', '', '2026-01-01T00:00:00Z'),
             (1, 1, 1, 2, 'esports', '', '2026-01-01T00:00:00Z'),
             (1, 1, 1, 3, 'open_day', '', '2026-01-01T00:00:00Z');
    `);
    const res = await fireNamed(fx, 'cancel_ev', { booking_cancel: { count: 2 } });
    expect(res.event.effects.booking_cancel).toEqual([3, 2]); // 降序撤
    expect(res.event.notes).toEqual(['撤档 档3 球迷开放日、档2 电竞赛事']);
    expect(sqlAll<{ slot_no: number }>(fx.sqlite, `SELECT slot_no FROM venue_bookings WHERE club_id = 1 ORDER BY slot_no`)).toEqual([{ slot_no: 1 }]);

    // 没有开窗 → 落空
    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11);
    const noWin = await fireNamed(fx2, 'cancel_nowin', { booking_cancel: { count: 1 } });
    expect(noWin.event.notes).toEqual(['撤档 1 个（现在没有开着的窗口，落空）']);

    // 开窗但没档期 → 落空
    const fx3 = freshEnv();
    seedClub(fx3.auth, fx3.sqlite, 1, 11);
    openWindow(fx3.sqlite);
    const empty = await fireNamed(fx3, 'cancel_empty', { booking_cancel: { count: 1 } });
    expect(empty.event.notes).toEqual(['撤档 1 个（本窗没有已排档期，落空）']);
  });

  it('booking_gift：找首个空槽插入（booked_by=事件）；档位满/未知活动/无开窗落空', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    openWindow(fx.sqlite);
    fx.sqlite
      .prepare(`INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at) VALUES (1, 1, 1, 1, 'idle', '', '2026-01-01T00:00:00Z')`)
      .run();
    const res = await fireNamed(fx, 'gift_ev', { booking_gift: { type: 'concert' } });
    expect(res.event.effects.booking_gift).toEqual({ slot: 2, type: 'concert' });
    expect(res.event.notes).toEqual(['赠档 档2 演唱会']);
    const row = sqlGet<{ slot_no: number; activity_type: string; booked_by: string }>(
      fx.sqlite,
      `SELECT slot_no, activity_type, booked_by FROM venue_bookings WHERE club_id = 1 AND slot_no = 2`,
    )!;
    expect(row).toEqual({ slot_no: 2, activity_type: 'concert', booked_by: '事件' });

    // 未知活动类型
    const badType = await fireNamed(fx, 'gift_bad', { booking_gift: { type: 'opera' } });
    expect(badType.event.notes).toEqual(['赠档（没有「opera」这种活动，落空）']);

    // 档位满：activity_slots=1 且 1 号已占
    overrideConfig(fx.sqlite, 'activity_slots', 1);
    const full = await fireNamed(fx, 'gift_full', { booking_gift: { type: 'concert' } });
    expect(full.event.notes).toEqual(['赠档 演唱会（档位已满，落空）']);

    // 无开窗
    const fx2 = freshEnv();
    seedClub(fx2.auth, fx2.sqlite, 1, 11);
    const noWin = await fireNamed(fx2, 'gift_nowin', { booking_gift: { type: 'concert' } });
    expect(noWin.event.notes).toEqual(['赠档 演唱会（现在没有开着的窗口，落空）']);
  });

  it('satisfaction：落 naming_contracts（钳 ±0.5、[0,2]、PENDING_GUARD），无冠名落空', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    // 无冠名：播报落空，不写库
    const none = await fireNamed(fx, 'sat_none', { satisfaction: -0.4 });
    expect(none.event.notes).toEqual(['品牌方情绪 -0.40（本队没有生效冠名，落空）']);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM naming_contracts`)!.n).toBe(0);

    // 有生效冠名：累加进 satisfaction，钳 [0,2]
    fx.sqlite.exec(
      `INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
         windows_total, windows_remaining, status, started_season, started_window, created_at, updated_at, satisfaction)
       VALUES (1, '可口可乐', 1.0, 2.0, 1, '稳健', 2.0, 6, 6, 'active', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1.8)`,
    );
    const up = await fireNamed(fx, 'sat_up', { satisfaction: 0.5 });
    expect(up.event.notes).toEqual(['品牌方情绪 +0.50']);
    expect(up.event.effects).toEqual({ satisfaction: 0.5 });
    expect(sqlGet<{ satisfaction: number }>(fx.sqlite, `SELECT satisfaction FROM naming_contracts WHERE club_id = 1`)!.satisfaction).toBeCloseTo(2.0, 6); // 1.8+0.5 钳到 2

    const down = await fireNamed(fx, 'sat_down', { satisfaction: -0.3 });
    expect(sqlGet<{ satisfaction: number }>(fx.sqlite, `SELECT satisfaction FROM naming_contracts WHERE club_id = 1`)!.satisfaction).toBeCloseTo(1.7, 6);
    void down;
  });

  it('signals：按 event_signals 清洗（未知名丢弃、step 对称钳、mult 区间钳、0 丢弃）后入 effects_json', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const res = await fireNamed(fx, 'sig_ev', {
      signals: { upkeep: 1.5, fan_mood: 9, fee_mod: 0.2, 未知信号: 3, bad_key: 0 },
      offer_spawn: { count: 2 },
    });
    expect(res.event.effects).toEqual({ signals: { upkeep: 1.5, fan_mood: 2, fee_mod: 0.5 } });
    expect(res.event.notes).toEqual(['经营信号 维护负担 ×1.5、粉丝情绪 +2.00、冠名费 ×0.5', '当前无开放招商轮次，品牌上门落空']);
    // 全部不可识别 → 落空
    const empty = await fireNamed(fx, 'sig_empty', { signals: { 未知: 1 } });
    expect(empty.event.notes).toEqual(['经营信号（没有可识别的信号键，落空）']);
  });

  it('cleanSignals 纯函数：mult 钳区间、step 钳对称、空表回 null', () => {
    expect(cleanSignals({ fan_mood: -9, upkeep: 0.1, fee_mod: 5 }, EVENT_SIGNALS_DEFAULT)).toEqual({
      fan_mood: -2,
      upkeep: 0.5,
      fee_mod: 2,
    });
    expect(cleanSignals({}, EVENT_SIGNALS_DEFAULT)).toBeNull();
    expect(cleanSignals('bad', EVENT_SIGNALS_DEFAULT)).toBeNull();
  });

  it('未知效果键只记备注，不影响同批其它键', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const res = await fireNamed(fx, 'unknown_ev', { money: 1, 神奇键: true });
    expect(res.event.notes).toEqual(['资金 +1.0 m', '未知效果键「神奇键」，跳过']);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'event'`)!.n).toBe(1);
  });
});

describe('occurrence 状态闸：整批重放安全', () => {
  it('occurrence 已 resolved 后重放效果语句：账本与状态列都不再变', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11, { buildCredit: 1 });
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx.sqlite, 'replay_ev', { money: 5, fans_pct: 0.03, build_credit: 2, attendance_mod: 0.9 });
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'replay_ev', rng: () => 0 });
    const occurrenceId = res.events[0]!.occurrenceId;

    const before = {
      ledger: sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n,
      stadium: sqlGet<{ fans: number; build_credit: number; next_attendance_mod: number }>(
        fx.sqlite,
        `SELECT fans, build_credit, next_attendance_mod FROM stadiums WHERE club_id = 1`,
      )!,
    };
    expect(before.ledger).toBe(1);

    // 手工重放同一批效果（模拟并发/重复调度）：所有语句都带 pending 守卫 → 全部空转
    const ctx = (await loadEventContexts(fx.env, [1], 1, 1)).get(1)!;
    const run = await applyEventEffects(
      fx.env,
      ctx,
      { id: occurrenceId, season: 1, windowSeq: 1, name: 'replay_ev' },
      { money: 5, fans_pct: 0.03, build_credit: 2, attendance_mod: 0.9 },
      {
        clamps: EVENT_CLAMPS_DEFAULT,
        heatRules: { winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5 },
        weatherKeys: new Set(['晴', '多云', '雨', '雪']),
        catalog: null,
        openWindow: { season: 1, windowSeq: 1 },
        signalDefs: EVENT_SIGNALS_DEFAULT,
      },
    );
    await fx.env.DB.batch(run.statements);

    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(before.ledger);
    expect(
      sqlGet<{ fans: number; build_credit: number; next_attendance_mod: number }>(
        fx.sqlite,
        `SELECT fans, build_credit, next_attendance_mod FROM stadiums WHERE club_id = 1`,
      ),
    ).toEqual(before.stadium);
    expect(sqlGet<{ status: string }>(fx.sqlite, `SELECT status FROM event_occurrences WHERE id = ${occurrenceId}`)!.status).toBe('resolved');
  });

  it('账本自带闸：同 occurrence 的第二条 money 流水不落（kind+ref_type+ref_id+club 四元组）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const { event } = await fireNamed(fx, 'gate_ev', { money: 4 });
    const again = await applyEventEffects(
      fx.env,
      (await loadEventContexts(fx.env, [1], 1, 1)).get(1)!,
      { id: event.occurrenceId, season: 1, windowSeq: 1, name: 'gate_ev' },
      { money: 4 },
      {
        clamps: EVENT_CLAMPS_DEFAULT,
        heatRules: { winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5 },
        weatherKeys: new Set(['晴', '多云', '雨', '雪']),
        catalog: null,
        openWindow: null,
        signalDefs: EVENT_SIGNALS_DEFAULT,
      },
    );
    await fx.env.DB.batch(again.statements);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'event'`)!.n).toBe(1);
  });
});

describe('关窗批消费预置上座乘数 / 天气（home.ts matchAttendanceStatements）', () => {
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

  function insertMatch(tour: DatabaseSync, matchId: number, homeTeamId: number, awayTeamId: number) {
    tour.prepare('INSERT OR IGNORE INTO tournament (id, name, status) VALUES (5, ?, ?)').run('赛事5', 'active');
    tour.prepare(`INSERT OR IGNORE INTO stage (id, tournament_id, kind, sort_order, name, config_json) VALUES (50, 5, 'round_robin', 1, NULL, '{}')`).run();
    const homeEntry = matchId * 2;
    const awayEntry = matchId * 2 + 1;
    tour.prepare('INSERT INTO entry (id, tournament_id, team_id) VALUES (?, 5, ?), (?, 5, ?)').run(homeEntry, homeTeamId, awayEntry, awayTeamId);
    tour
      .prepare(
        `INSERT INTO match (id, stage_id, round, home_entry_id, away_entry_id, winner_entry_id,
           score_home, score_away, pen_home, pen_away, walkover_side, status, finished_at)
         VALUES (?, 50, 0, ?, ?, NULL, 2, 0, NULL, NULL, NULL, 'finished', '2026-09-16T00:00:00Z')`,
      )
      .run(matchId, homeEntry, awayEntry);
  }

  /** 主队球场（影响力 90 → 对手系数 1.05）+ 商业/转播设施，客队无球场行 */
  function seedMatchFixture(opts: { nextMod?: number; nextWeather?: string } = {}) {
    const fx = freshEnv();
    seedTourSchema(fx.tour);
    seedClub(fx.auth, fx.sqlite, 1, 11, { shell: 90, ...opts });
    // 客队不建球场行 → 对手影响力走 default_influence 90（系数 1.05），与 home.test.ts 基线同
    seedClub(fx.auth, fx.sqlite, 2, 12, { stadium: false });
    fx.sqlite.prepare(`INSERT INTO club_facilities (club_id, facility_key, level) VALUES (1, 'commercial', 2), (1, 'broadcast', 3)`).run();
    insertMatch(fx.tour, 1, 11, 12);
    fx.sqlite
      .prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (1, 5, 'league_premier', '2026-09-16T00:00:00Z')`)
      .run();
    return fx;
  }

  it('无预置：rng=0.5 现掷多云，上座 7333（基线）', async () => {
    const fx = seedMatchFixture();
    await confirmResult(fx.env, 1, 1, 'user');
    const att = sqlGet<{ weather: string; attendance: number; memo: string }>(
      fx.sqlite,
      `SELECT a.weather, a.attendance, (SELECT memo FROM ledger_entries WHERE kind = 'revenue') AS memo FROM match_attendance a WHERE a.match_id = 1`,
    )!;
    expect(att.weather).toBe('多云');
    expect(att.attendance).toBe(7333);
    expect(att.memo).not.toContain('事件预置');
  });

  it('预置 next_attendance_mod=1.5 乘进需求（7333×1.5→10999），并在同批清零', async () => {
    const fx = seedMatchFixture({ nextMod: 1.5, nextWeather: '多云' });
    await confirmResult(fx.env, 1, 1, 'user');
    const att = sqlGet<{ weather: string; attendance: number; memo: string }>(
      fx.sqlite,
      `SELECT a.weather, a.attendance, (SELECT memo FROM ledger_entries WHERE kind = 'revenue') AS memo FROM match_attendance a WHERE a.match_id = 1`,
    )!;
    expect(att.weather).toBe('多云');
    expect(att.attendance).toBe(10999);
    expect(att.memo).toContain('（事件预置）');
    // 一次性：用完即清
    expect(sqlGet<{ next_attendance_mod: number; next_weather: string }>(fx.sqlite, `SELECT next_attendance_mod, next_weather FROM stadiums WHERE club_id = 1`)).toEqual({
      next_attendance_mod: 1,
      next_weather: '',
    });
  });

  it('预置 next_weather=雨 替代现掷天气（wx 0.845 → 上座 6388）', async () => {
    const fx = seedMatchFixture({ nextWeather: '雨' });
    await confirmResult(fx.env, 1, 1, 'user');
    const att = sqlGet<{ weather: string; attendance: number }>(fx.sqlite, `SELECT weather, attendance FROM match_attendance WHERE match_id = 1`)!;
    expect(att.weather).toBe('雨');
    expect(att.attendance).toBe(6388);
    expect(sqlGet<{ next_weather: string }>(fx.sqlite, `SELECT next_weather FROM stadiums WHERE club_id = 1`)!.next_weather).toBe('');
  });

  it('预置天气不在天气表里 → 当作没预置（现掷）', async () => {
    const fx = seedMatchFixture({ nextWeather: '台风' });
    await confirmResult(fx.env, 1, 1, 'user');
    const att = sqlGet<{ weather: string; attendance: number }>(fx.sqlite, `SELECT weather, attendance FROM match_attendance WHERE match_id = 1`)!;
    expect(att.weather).toBe('多云');
    expect(att.attendance).toBe(7333);
  });
});

describe('管理端事件路由（v6.10.0）', () => {
  const getAs = (path: string, env: Env, cookie: string) => app.request(path, { headers: { Cookie: cookie } }, env);
  const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-admin') =>
    app.request(
      path,
      { method, headers: { 'content-type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );

  it('GET /events/pool 列全池；PATCH 启停（非法 status 400 / 不存在 404）', async () => {
    const fx = freshEnv();
    const list = await getAs('/api/admin/events/pool', fx.env, 'whl_session=tok-admin');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { events: { id: number; event_id: string; status: string }[] };
    expect(body.events).toHaveLength(30);

    const id = body.events.find((e) => e.event_id === 'storm_buzz')!.id;
    const off = await send('PATCH', `/api/admin/events/pool/${id}`, fx.env, { status: 'discarded' });
    expect(off.status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, `SELECT status FROM event_pool WHERE id = ${id}`)!.status).toBe('discarded');
    expect(sqlGet<{ action: string }>(fx.sqlite, `SELECT action FROM audit_log`)!.action).toBe('event_pool_update');

    expect((await send('PATCH', `/api/admin/events/pool/${id}`, fx.env, { status: '不合法' })).status).toBe(400);
    expect((await send('PATCH', `/api/admin/events/pool/99999`, fx.env, { status: 'adopted' })).status).toBe(404);
  });

  it('POST /events/trigger：缺省用开窗；无可见赛季 409；参数校验 400', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx.sqlite, 'route_ev', { money: 1 });

    // 没有 season_windows 行 → 无可见赛季
    expect((await send('POST', '/api/admin/events/trigger', fx.env, {})).status).toBe(409);

    openWindow(fx.sqlite);
    const ok = await send('POST', '/api/admin/events/trigger', fx.env, { clubIds: [1], eventId: 'route_ev' });
    expect(ok.status).toBe(200);
    const res = (await ok.json()) as { season: number; windowSeq: number; triggered: number; events: { clubName: string }[] };
    expect(res).toMatchObject({ season: 1, windowSeq: 1, triggered: 1 });
    expect(res.events[0]!.clubName).toBe('俱乐部1');

    // 点名的 clubIds 里有不存在的俱乐部：只给存在的队演，不留幽灵行
    const ghost = await send('POST', '/api/admin/events/trigger', fx.env, { clubIds: [1, 999], eventId: 'route_ev' });
    expect(ghost.status).toBe(200);
    expect((await ghost.json()) as { clubs: number; triggered: number }).toMatchObject({ clubs: 1, triggered: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM event_occurrences WHERE club_id = 999`)!.n).toBe(0);

    expect((await send('POST', '/api/admin/events/trigger', fx.env, { season: 'x' })).status).toBe(400);
    expect((await send('POST', '/api/admin/events/trigger', fx.env, { windowSeq: 1.5 })).status).toBe(400);
    expect((await send('POST', '/api/admin/events/trigger', fx.env, { clubIds: 'all' })).status).toBe(400);
    expect((await send('POST', '/api/admin/events/trigger', fx.env, { clubIds: ['x'] })).status).toBe(400);
    expect((await send('POST', '/api/admin/events/trigger', fx.env, { eventId: '' })).status).toBe(400);
    expect((await send('POST', '/api/admin/events/trigger', fx.env, { clubIds: [1], eventId: '不存在' })).status).toBe(404);
  });

  it('GET /events/occurrences：按赛季倒序取、limit 钳制、season 非整数 400', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    openWindow(fx.sqlite);
    fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
    addEvent(fx.sqlite, 'occ_ev', { money: 1 });
    await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'occ_ev', rng: () => 0 });

    const res = await getAs('/api/admin/events/occurrences', fx.env, 'whl_session=tok-admin');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { season: number | null; occurrences: { club_name: string; event_name: string; status: string; notes_json: string }[] };
    expect(body.season).toBe(1);
    expect(body.occurrences).toHaveLength(1);
    expect(body.occurrences[0]).toMatchObject({ club_name: '俱乐部1', event_name: '事件occ_ev', status: 'resolved' });
    expect(JSON.parse(body.occurrences[0]!.notes_json)).toEqual(['资金 +1.0 m']);

    expect((await getAs('/api/admin/events/occurrences?season=abc', fx.env, 'whl_session=tok-admin')).status).toBe(400);
    const lim = (await (await getAs('/api/admin/events/occurrences?limit=0', fx.env, 'whl_session=tok-admin')).json()) as { occurrences: unknown[] };
    expect(lim.occurrences).toHaveLength(1);

    // 空串参数按没给算：?season= 回落可见赛季、?limit= 回落 50（而不是 0 → 1 条）
    await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'occ_ev', rng: () => 0 });
    const emptySeason = await getAs('/api/admin/events/occurrences?season=', fx.env, 'whl_session=tok-admin');
    expect(emptySeason.status).toBe(200);
    const emptySeasonBody = (await emptySeason.json()) as { season: number | null; occurrences: unknown[] };
    expect(emptySeasonBody).toMatchObject({ season: 1 });
    expect(emptySeasonBody.occurrences).toHaveLength(2);
    const emptyLimit = (await (await getAs('/api/admin/events/occurrences?limit=', fx.env, 'whl_session=tok-admin')).json()) as { occurrences: unknown[] };
    expect(emptyLimit.occurrences).toHaveLength(2);
    const oneLimit = (await (await getAs('/api/admin/events/occurrences?limit=1', fx.env, 'whl_session=tok-admin')).json()) as { occurrences: unknown[] };
    expect(oneLimit.occurrences).toHaveLength(1);
  });

  it('权限：教练 403、匿名 401', async () => {
    const fx = freshEnv();
    expect((await getAs('/api/admin/events/pool', fx.env, 'whl_session=tok-coach')).status).toBe(403);
    expect((await send('POST', '/api/admin/events/trigger', fx.env, {}, 'whl_session=tok-coach')).status).toBe(403);
    expect((await getAs('/api/admin/events/pool', fx.env, '')).status).toBe(401);
    expect((await getAs('/api/admin/events/occurrences', fx.env, '')).status).toBe(401);
  });
});

// ---- v6.12.0（D3）：待选上限 / expired 终态 / 经营信号收集 ----

describe('D3 同队待选上限（maxPending，默认 3）', () => {
  function addChoice(sqlite: DatabaseSync, eventId: string) {
    sqlite
      .prepare(
        `INSERT INTO event_pool (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
                                 soft_conditions, template, source, status, created_at)
         VALUES (?, ?, '测试', 10, 'choice', '{}', '{}', '[{"no":1,"name":"a","desc":"","outcomes":[{"w":1,"effects":{"money":1}}]},{"no":2,"name":"b","desc":"","outcomes":[{"w":1,"effects":{"money":-1}}]}]', 0, 'x', 'custom', 'adopted', '2026-01-01T00:00:00Z')`,
      )
      .run(eventId, `事件${eventId}`);
  }

  it('点名触发：待选已满回 409；未满可继续，触发后计数 +1', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    addChoice(fx.sqlite, 'cap_ev');
    // 预置 3 条待选（上限 3）
    for (let i = 0; i < 3; i++) {
      fx.sqlite
        .prepare(
          `INSERT INTO event_occurrences (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json, notes_json, choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
           VALUES (1, 1, 1, 'cap_ev', '事件', 'choice', 'pending', '{}', '[]', NULL, '{}', '2026-07-01T00:00:00Z', '', NULL, 'x', '2026-01-01T00:00:00Z')`,
        )
        .run();
    }
    await expect(
      triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'cap_ev' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('随机抽取：达上限的队跳过（计 capped），即发型不受影响', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoice(fx.sqlite, 'cap_choice');
    addEvent(fx.sqlite, 'cap_instant', { money: 1 });
    for (let i = 0; i < 3; i++) {
      fx.sqlite
        .prepare(
          `INSERT INTO event_occurrences (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json, notes_json, choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
           VALUES (1, 1, 1, 'cap_choice', '事件', 'choice', 'pending', '{}', '[]', NULL, '{}', '2026-07-01T00:00:00Z', '', NULL, 'x', '2026-01-01T00:00:00Z')`,
        )
        .run();
    }
    // rng 恒 0.1 < 0.4 命中，pickEvent 单候选时选 choice → 达上限跳过
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: undefined, rng: () => 0.1 });
    expect(res.triggered).toBe(0);
    expect(res.capped).toBe(1);
  });
});

describe('D3 经营信号收集与关窗消费', () => {
  it('collectWindowSignals：step 求和、mult 连乘后终钳，只认 resolved/expired 的归档窗', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    const insert = (status: string, season: number, windowSeq: number, effects: Record<string, unknown>) =>
      fx.sqlite
        .prepare(
          `INSERT INTO event_occurrences (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json, notes_json, choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
           VALUES (1, ?, ?, 'sig_ev', '事件', 'instant', ?, ?, '[]', NULL, '{}', NULL, '', NULL, 'x', '2026-01-01T00:00:00Z')`,
        )
        .run(season, windowSeq, status, JSON.stringify(effects));
    insert('resolved', 1, 1, { signals: { fan_mood: 2, upkeep: 1.5 } });
    insert('expired', 1, 1, { signals: { fan_mood: 1.5, upkeep: 1.5, fee_mod: 0.4 } });
    insert('resolved', 1, 2, { signals: { fan_mood: 9 } }); // 别的窗
    insert('pending', 1, 1, { signals: { fan_mood: 9 } }); // 未结算不算

    const map = await collectWindowSignals(fx.env.DB, 1, 1);
    const sig = map.get(1)!;
    expect(sig.steps.fan_mood).toBe(3.5);
    expect(sig.mults.upkeep).toBe(2); // 1.5×1.5=2.25 终钳 [0.5,2]
    expect(sig.mults.fee_mod).toBe(0.5); // 0.4 终钳下界
  });

  it('关窗批消费：维护费 ×upkeep（memo 带注记）、死忠 ×(1+mood/100)、冠名费 ×fee_mod（memo 带注记）+ 通知', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    bindAccount(fx, 1, 1);
    openWindow(fx.sqlite);
    fx.sqlite
      .prepare(
        `INSERT INTO event_occurrences (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json, notes_json, choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
         VALUES (1, 1, 1, 'sig_ev', '事件', 'instant', 'resolved', ?, '[]', NULL, '{}', NULL, '', NULL, 'x', '2026-01-01T00:00:00Z')`,
      )
      .run(JSON.stringify({ signals: { fan_mood: 2, upkeep: 1.5, fee_mod: 0.8 } }));
    fx.sqlite.exec(
      `INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
         windows_total, windows_remaining, status, started_season, started_window, created_at, updated_at)
       VALUES (1, '可口可乐', 1.0, 2.0, 1, '稳健', 2.0, 6, 6, 'active', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    // 抬高影响力让死忠朝目标增长（默认 0 影响力是流失方向，mood 乘数方向不好断言）
    fx.sqlite.exec(`UPDATE stadiums SET shell_influence = 400 WHERE club_id = 1`);
    // 死忠 = evolveFans(...) ×(1+2/100)：先取演化前的输入，跑完关窗批后与纯函数逐位对账
    const home = await import('../src/worker/home.ts');
    const model = await home.loadAttendanceModel(fx.env.DB);
    const stadium = sqlGet<{ shell_influence: number; fans: number }>(fx.sqlite, `SELECT shell_influence, fans FROM stadiums WHERE club_id = 1`)!;

    const { statements } = await home.windowHomeStatements(fx.env, 1, 1, { chargeNaming: true });
    await fx.env.DB.batch(statements);

    const maint = sqlGet<{ memo: string }>(
      fx.sqlite,
      `SELECT memo FROM ledger_entries WHERE kind = 'maintenance' AND ref_type = 'window'`,
    )!;
    expect(maint.memo).toContain('经营信号：维护负担 ×1.5');
    const naming = sqlGet<{ memo: string; amount: number }>(
      fx.sqlite,
      `SELECT memo, amount FROM ledger_entries WHERE kind = 'naming_fee'`,
    )!;
    expect(naming.memo).toContain('经营信号：冠名费 ×0.8');
    expect(naming.amount).toBeCloseTo(1.6, 3); // 2.0 × 0.8

    const base = home.evolveFans(model, stadium.fans, home.diehardTarget(model, stadium.shell_influence), 1, 4, 0);
    const fansAfter = sqlGet<{ fans: number }>(fx.sqlite, `SELECT fans FROM stadiums WHERE club_id = 1`)!.fans;
    expect(fansAfter).toBeCloseTo(Math.min(base * 1.02, model.fans_cap), 6);

    const notice = sqlGet<{ template: string; payload: string }>(
      fx.sqlite,
      `SELECT template, payload FROM notifications WHERE template = 'window_signals'`,
    )!;
    expect(JSON.parse(notice.payload).text).toContain('粉丝情绪 +2.00');
  });
});
