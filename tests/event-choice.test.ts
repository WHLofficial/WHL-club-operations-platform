// v6.11.0 选择型事件（D2）：选项解析 / 选项内加权 roll / 净额最差兜底 / 触发挂待选（不落效果）/
// 玩家选定结算 / cron 超时与 24h 提醒 / 教练端两端点。
// 口径对齐参考插件 services/event_engine.py 的 _trigger_choice / _roll_option / _worst_option / _resolve_choice
// （差异：插件在关窗时结算选项，本仓改为「选项自带时限 + cron 兜底」，见 event-ops.ts 头注释）。
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  describeEffect,
  describeEffects,
  expirePendingEvents,
  listClubEvents,
  parseEventOptions,
  renderChoiceText,
  resolveEvent,
  rollOptionOutcome,
  triggerEventBatch,
  worstOption,
  type EventClubContext,
  type EventOption,
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
  // 教练端 requireCoach 与 boundClubId 都读 TOUR_DB 的 user / AUTH_DB 的 team_binding
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

function seedClub(auth: DatabaseSync, sqlite: DatabaseSync, clubId: number, tourTeamId: number) {
  sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`).run(clubId, `俱乐部${clubId}`);
  sqlite
    .prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, 50, '2026-01-01T00:00:00Z')`)
    .run(clubId);
  sqlite
    .prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, next_attendance_mod, next_weather, created_at, updated_at)
       VALUES (?, '', 20000, 0, 0, 0, 1800, 0, 1, '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(clubId);
  authRegisterClubTeam(auth, tourTeamId, clubId, `队${tourTeamId}`);
}

/** 把教练账号（userId）绑到 clubId：既让 getBoundClub 认得，也让通知落得下来 */
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

/** 停用全部种子事件，只留本用例的自定义事件 */
function onlyCustom(sqlite: DatabaseSync) {
  sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
}

function openWindow(sqlite: DatabaseSync) {
  sqlite.prepare(`INSERT INTO seasons (season, status, created_at) VALUES (1, 'running', '2026-07-01T00:00:00Z')`).run();
  sqlite
    .prepare(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z')`)
    .run();
}

function overrideConfig(sqlite: DatabaseSync, key: string, value: unknown) {
  sqlite.prepare(`INSERT INTO config (key, value, updated_at) VALUES (?, ?, '2026-07-01T00:00:00Z')`).run(key, JSON.stringify(value));
  resetConfigCache();
}

/** 插一条自定义选择型事件 */
function addChoiceEvent(
  sqlite: DatabaseSync,
  eventId: string,
  options: unknown[],
  opts: { name?: string; weight?: number; status?: string; conditions?: Record<string, unknown> } = {},
) {
  sqlite
    .prepare(
      `INSERT INTO event_pool (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
                               soft_conditions, template, source, status, created_at)
       VALUES (?, ?, '测试', ?, 'choice', ?, '{}', ?, 0, '{team} 遇到选择题。', 'custom', ?, '2026-01-01T00:00:00Z')`,
    )
    .run(
      eventId,
      opts.name ?? `事件${eventId}`,
      opts.weight ?? 10,
      JSON.stringify(opts.conditions ?? {}),
      JSON.stringify(options),
      opts.status ?? 'adopted',
    );
}

interface OccurrenceSeed {
  clubId?: number;
  season?: number;
  windowSeq?: number;
  eventId: string;
  eventName?: string;
  eventType?: string;
  status?: string;
  deadlineAt?: string | null;
  text?: string;
}

/** 直插一条 occurrence（造超时/残留行用），返回 id */
function seedOccurrence(sqlite: DatabaseSync, opts: OccurrenceSeed): number {
  const r = sqlite
    .prepare(
      `INSERT INTO event_occurrences (club_id, season, window_seq, event_id, event_name, event_type, status,
                                      effects_json, notes_json, choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', '[]', NULL, '{}', ?, '', NULL, ?, '2026-07-01T00:00:00Z')`,
    )
    .run(
      opts.clubId ?? 1,
      opts.season ?? 1,
      opts.windowSeq ?? 1,
      opts.eventId,
      opts.eventName ?? `事件${opts.eventId}`,
      opts.eventType ?? 'choice',
      opts.status ?? 'pending',
      opts.deadlineAt ?? null,
      opts.text ?? '',
    );
  return Number(r.lastInsertRowid);
}

function occurrenceRow(sqlite: DatabaseSync, id: number) {
  return sqlGet<{
    status: string;
    choice_no: number | null;
    outcome_json: string;
    effects_json: string;
    notes_json: string;
    resolved_by: string;
    resolved_at: string | null;
    text: string;
    deadline_at: string | null;
    reminded_at: string;
  }>(sqlite, `SELECT status, choice_no, outcome_json, effects_json, notes_json, resolved_by, resolved_at, text, deadline_at, reminded_at
              FROM event_occurrences WHERE id = ${id}`);
}

/**
 * 包一层 DB，只把 resolveEvent 读 occurrence 的那条 SELECT 换成一份「过期快照」（status 仍是 pending），
 * 其余查询照走真库——用来在不引并发的前提下复现「SELECT 与 batch 之间被别人抢先结算」。
 */
function staleOccurrenceRead(db: D1Database, snapshot: Record<string, unknown>): D1Database {
  const wrapper = {
    prepare(sql: string) {
      if (sql.includes('o.event_type, o.status') && sql.includes('WHERE o.id = ?')) {
        return {
          bind: () => ({ first: async () => ({ ...snapshot, status: 'pending' }) }),
        } as unknown as D1PreparedStatement;
      }
      return db.prepare(sql);
    },
    batch: (statements: D1PreparedStatement[]) => db.batch(statements),
    exec: (query: string) => db.exec(query),
  };
  return wrapper as unknown as D1Database;
}

/** 纯上下文（广播文案用） */
function ctxOf(patch: Partial<EventClubContext> = {}): EventClubContext {
  return {
    clubId: 1,
    name: '俱乐部1',
    stadium: {
      club_id: 1,
      name: '星海球场',
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

/** 二选一夹具：1 号全面维修（净额 −5，最差）、2 号局部修补（+3） */
const REPAIR_OPTIONS = [
  { no: 1, name: '全面维修', desc: '花大钱', outcomes: [{ w: 1, effects: { money: -5 } }] },
  { no: 2, name: '局部修补', desc: '省钱', outcomes: [{ w: 1, effects: { money: 3 } }] },
];

beforeEach(() => resetConfigCache());

describe('选项解析 parseEventOptions', () => {
  it('坏条目整条剔除、缺 no 丢弃、权重非正按 1、effects 非对象按空表', () => {
    const raw = JSON.stringify([
      null,
      3,
      { name: '缺 no 丢掉' },
      { no: 2, name: '补一补', desc: '省钱', outcomes: [{ w: 0, effects: { money: 2 } }, { w: 'x', effects: 'nope' }, { effects: { money: 3 } }] },
    ]);
    const options = parseEventOptions(raw);
    expect(options).toHaveLength(1);
    expect(options[0]!.no).toBe(2);
    expect(options[0]!.name).toBe('补一补');
    expect(options[0]!.outcomes.map((o) => o.w)).toEqual([1, 1, 1]);
    expect(options[0]!.outcomes.map((o) => o.effects)).toEqual([{ money: 2 }, {}, { money: 3 }]);
  });

  it('null / 空串 / 坏 JSON / 非数组 → 空表；选项缺 name 回落「选项N」', () => {
    expect(parseEventOptions(null)).toEqual([]);
    expect(parseEventOptions('')).toEqual([]);
    expect(parseEventOptions('{')).toEqual([]);
    expect(parseEventOptions('{"no":1}')).toEqual([]);
    const options = parseEventOptions(JSON.stringify([{ no: 4, outcomes: [] }]));
    expect(options[0]!.name).toBe('选项4');
    expect(options[0]!.desc).toBe('');
    expect(options[0]!.outcomes).toEqual([]);
  });

  it('重复 no 丢后者（路由按 find 取第一个同号选项，留着会让按钮与结算对不上）', () => {
    const options = parseEventOptions(
      JSON.stringify([
        { no: 1, name: '先到', desc: '', outcomes: [{ w: 1, effects: { money: 1 } }] },
        { no: 1, name: '后到', desc: '', outcomes: [{ w: 1, effects: { money: 9 } }] },
        { no: 2, name: '另一个', desc: '', outcomes: [] },
      ]),
    );
    expect(options.map((o) => o.no)).toEqual([1, 2]);
    expect(options[0]!.name).toBe('先到');
  });
});

describe('选项内加权 roll rollOptionOutcome（抽取钉在 occurrenceId + choiceNo 上）', () => {
  const two: EventOption = {
    no: 1,
    name: '二选一',
    desc: '',
    outcomes: [
      { w: 1, effects: { money: 1 } },
      { w: 99, effects: { money: 99 } },
    ],
  };

  it('同一条事件同一个选项恒定得到同一结果（可重放）', () => {
    const a = rollOptionOutcome(two, 7, 2);
    const b = rollOptionOutcome(two, 7, 2);
    expect(a).toBe(b);
    expect(two.outcomes).toContain(a);
  });

  it('换 occurrenceId / 换 choiceNo 会换结果（不是常量）', () => {
    const even: EventOption = {
      no: 1,
      name: '对半',
      desc: '',
      outcomes: [
        { w: 1, effects: { money: 1 } },
        { w: 1, effects: { money: 2 } },
      ],
    };
    const seen = new Set<unknown>();
    for (let id = 1; id <= 60; id++) {
      seen.add(rollOptionOutcome(even, id, 1));
      seen.add(rollOptionOutcome(even, id, 2));
    }
    expect(seen.size).toBe(2);
  });

  it('权重生效：w=[1,3] 偏向重的一条；w=[1,99] 几乎总是重的一条', () => {
    let heavy = 0;
    let light = 0;
    const skewed: EventOption = {
      no: 1,
      name: '三比一',
      desc: '',
      outcomes: [
        { w: 1, effects: { money: 1 } },
        { w: 3, effects: { money: 2 } },
      ],
    };
    for (let id = 1; id <= 200; id++) {
      const out = rollOptionOutcome(skewed, id, 1);
      if (out === skewed.outcomes[1]) heavy++;
      else if (out === skewed.outcomes[0]) light++;
    }
    expect(heavy + light).toBe(200);
    expect(heavy).toBeGreaterThanOrEqual(110); // 权重被忽略时会退化成 ~100/100，这里挂掉
    expect(light).toBeGreaterThanOrEqual(10);

    let veryHeavy = 0;
    for (let id = 1; id <= 200; id++) if (rollOptionOutcome(two, id, 1) === two.outcomes[1]) veryHeavy++;
    expect(veryHeavy).toBeGreaterThanOrEqual(180);
  });

  it('单个结果恒定返回；无结果返回 null；w 小数按 trunc 且下限 1', () => {
    const one: EventOption = { no: 1, name: 'x', desc: '', outcomes: [{ w: 5, effects: { money: 1 } }] };
    expect(rollOptionOutcome(one, 3, 1)).toBe(one.outcomes[0]);
    const none: EventOption = { no: 1, name: 'x', desc: '', outcomes: [] };
    expect(rollOptionOutcome(none, 3, 1)).toBeNull();
    // w = 0.5 → trunc 0 → 抬到 1；w = 2.9 → trunc 2 ⇒ 两条权重 1:2
    const odd: EventOption = {
      no: 1,
      name: 'x',
      desc: '',
      outcomes: [
        { w: 0.5, effects: { money: 1 } },
        { w: 2.9, effects: { money: 2 } },
      ],
    };
    let first = 0;
    for (let id = 1; id <= 300; id++) if (rollOptionOutcome(odd, id, 1) === odd.outcomes[0]) first++;
    expect(first).toBeGreaterThan(40);
    expect(first).toBeLessThan(160);
  });
});

describe('净额最差兜底 worstOption（money − maintenance，平局取低选项号再低结果序号）', () => {
  it('维护费参与净额：{money:0,maintenance:5} 比 {money:-2} 更差', () => {
    const options: EventOption[] = [
      { no: 1, name: '赔钱了事', desc: '', outcomes: [{ w: 1, effects: { money: -2 } }] },
      { no: 2, name: '自己修', desc: '', outcomes: [{ w: 1, effects: { money: 0, maintenance: 5 } }] },
    ];
    const worst = worstOption(options);
    expect(worst?.option.no).toBe(2);
    expect(worst?.outcome.effects).toEqual({ money: 0, maintenance: 5 });
  });

  it('无结果的选项不参与；全无结果 → null', () => {
    const options: EventOption[] = [
      { no: 1, name: '空壳', desc: '', outcomes: [] },
      { no: 2, name: '有结果', desc: '', outcomes: [{ w: 1, effects: { money: -1 } }] },
    ];
    expect(worstOption(options)?.option.no).toBe(2);
    expect(worstOption([{ no: 1, name: '空壳', desc: '', outcomes: [] }])).toBeNull();
    expect(worstOption([])).toBeNull();
  });

  it('平局：同净额取低选项号，同选项内取低结果序号', () => {
    const options: EventOption[] = [
      { no: 3, name: '后', desc: '', outcomes: [{ w: 1, effects: { money: -3 } }] },
      { no: 1, name: '先', desc: '', outcomes: [{ w: 1, effects: { money: -3 } }] },
    ];
    expect(worstOption(options)?.option.no).toBe(1);
    const same: EventOption = {
      no: 1,
      name: 'x',
      desc: '',
      outcomes: [
        { w: 1, effects: { money: -3 } },
        { w: 1, effects: { money: -3 } },
      ],
    };
    expect(worstOption([same])?.outcome).toBe(same.outcomes[0]);
  });
});

describe('广播文案 renderChoiceText / 效果描述 describeEffects', () => {
  it('头行 + 叙述 + 选项概率表（含序号圈码与效果描述）', () => {
    const event = { name: '草皮病害', category: '场地故障', template: '' } as Parameters<typeof renderChoiceText>[0];
    const text = renderChoiceText(event, ctxOf(), parseEventOptions(JSON.stringify(REPAIR_OPTIONS)), 12);
    const lines = text.split('\n');
    expect(lines[0]).toBe('🎲 事件「草皮病害」（场地故障）@ 俱乐部1·星海球场');
    expect(lines[2]).toBe('请在 12 小时内任选一项操作：');
    expect(lines[3]).toBe('① 全面维修（花大钱）：100% 资金 -5.0 m');
    expect(lines[4]).toBe('② 局部修补（省钱）：100% 资金 +3.0 m');
  });

  it('不设时限（0 小时）改文案；球队没球场名时用「X主场」；第 5 号以后用「N.」', () => {
    const event = { name: 'E', category: 'C', template: '' } as Parameters<typeof renderChoiceText>[0];
    const text = renderChoiceText(event, ctxOf({ stadium: { ...ctxOf().stadium, name: '' } }), [
      { no: 5, name: '五号方案', desc: '', outcomes: [{ w: 1, effects: { fans_pct: 0.05 } }] },
    ], 0);
    const lines = text.split('\n');
    expect(lines[0]).toContain('俱乐部1·俱乐部1主场');
    expect(lines[2]).toBe('请任选一项操作：');
    expect(lines[3]).toBe('5. 五号方案：100% 死忠 +5.0%');
  });

  it('概率按权重归一（不是把原始 w 当百分数）；依赖 C3 的 offer_spawn 带「（C3 生效）」标注', () => {
    const event = { name: 'E', category: 'C', template: '' } as Parameters<typeof renderChoiceText>[0];
    const options = parseEventOptions(
      JSON.stringify([
        {
          no: 1,
          name: '含糊其辞',
          desc: '',
          outcomes: [
            { w: 3, effects: { money: -1 } },
            { w: 1, effects: { money: -2, satisfaction: 0.15 } },
          ],
        },
      ]),
    );
    const lines = renderChoiceText(event, ctxOf(), options, 12).split('\n');
    // v6.12.0（D3）起 satisfaction 真落库，不再带待生效标注
    expect(lines[3]).toBe('① 含糊其辞：75% 资金 -1.0 m / 25% 资金 -2.0 m、品牌方情绪 +0.15');
    // v6.14.0（C3）起 offer_spawn 真落库，全部效果键不再有待生效标注
    expect(describeEffect('satisfaction', 0.15, true)).toBe('品牌方情绪 +0.15');
    expect(describeEffect('offer_spawn', { pkg: 1 }, true)).toBe('品牌上门递价（挂当前招商轮）');
    expect(describeEffects({ satisfaction: 0.15 })).toBe('品牌方情绪 +0.15');
  });

  it('describeEffect 逐键；describeEffects 空表 → 无变化、未知键不出现', () => {
    expect(describeEffect('maintenance', 3)).toBe('草皮维护 -3.0 m');
    expect(describeEffect('brand_heat', 0.05)).toBe('品牌热度 +0.05');
    expect(describeEffect('weather_set', { weather: '雨' })).toBe('下一场天气 → 雨');
    expect(describeEffect('facility', { key: 'youth', delta: 1 })).toBe('设施 youth +1 级');
    expect(describeEffect('booking_cancel', { count: 2 })).toBe('撤档 2 个');
    expect(describeEffect('booking_gift', { type: 'concert' })).toBe('赠档 concert');
    expect(describeEffect('神奇键', 1)).toBe('');
    expect(describeEffects({})).toBe('无变化');
    expect(describeEffects({ money: 2, 神奇键: 1 })).toBe('资金 +2.0 m');
  });
});

describe('触发选择型：只挂待选，不落任何效果', () => {
  it('点名触发写 pending + deadline + 广播文案，账本零流水', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    bindAccount(fx, 1, 1, '12345');
    openWindow(fx.sqlite);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS, { name: '草皮病害' });

    const res = await triggerEventBatch(fx.env, {
      season: 1,
      windowSeq: 1,
      actor: 2,
      origin: 'user',
      clubIds: [1],
      eventId: 'pick_me',
      rng: () => 0,
    });
    expect(res.triggered).toBe(1);
    const ev = res.events[0]!;
    expect(ev.eventType).toBe('choice');
    expect(ev.deadlineAt).not.toBeNull();
    expect(ev.effects).toEqual({});
    expect(ev.text).toContain('① 全面维修');
    expect(ev.notes).toEqual([]); // 选择型不落效果 ⇒ notes 空，「待你选择」只进通知文案

    const row = sqlGet<{ id: number; status: string; event_type: string; choice_no: number | null; deadline_at: string | null; text: string }>(
      fx.sqlite,
      `SELECT id, status, event_type, choice_no, deadline_at, text FROM event_occurrences WHERE event_id = 'pick_me'`,
    )!;
    expect(row.status).toBe('pending');
    expect(row.event_type).toBe('choice');
    expect(row.choice_no).toBeNull();
    expect(row.deadline_at).not.toBeNull();
    expect(row.text).toContain('请在 72 小时内任选一项操作：');
    // 选择型触发不落账（效果等选定/兜底时才落）
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(0);
    // 审计仍记一条 event_trigger，after 里带 eventType/deadlineAt
    const audit = sqlGet<{ after: string; origin: string }>(fx.sqlite, `SELECT after, origin FROM audit_log WHERE action = 'event_trigger'`)!;
    expect(JSON.parse(audit.after)).toMatchObject({ eventType: 'choice', clubId: 1, eventId: 'pick_me' });
    expect(audit.origin).toBe('user');
    // 广播通知：web 行 + QQ 行（待投递）
    const notices = sqlAll<{ channel: string; payload: string }>(fx.sqlite, `SELECT channel, payload FROM notifications ORDER BY channel`);
    expect(notices.map((n) => n.channel)).toEqual(['qq', 'web']);
    expect(JSON.parse(notices[0]!.payload).text).toContain('待你选择');
  });

  it('按概率抽取路径也吃选择型（D1 的只抽即发型已放开）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    openWindow(fx.sqlite);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'rand_choice', REPAIR_OPTIONS);
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: null, origin: 'cron_tick', rng: () => 0 });
    expect(res.triggered).toBe(1);
    expect(res.events[0]!.eventType).toBe('choice');
  });

  it('choiceDeadlineHours = 0 → deadlineAt 为 null（不设时限、不会自动兜底）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    openWindow(fx.sqlite);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'no_deadline', REPAIR_OPTIONS);
    overrideConfig(fx.sqlite, 'event_rules', { hitProbability: 0.4, maxPerClub: 1, maxOccurrences: 2, softConditionFactor: 0.25, choiceDeadlineHours: 0 });
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1], eventId: 'no_deadline', rng: () => 0 });
    expect(res.events[0]!.deadlineAt).toBeNull();
    expect(res.events[0]!.notes).toEqual([]);
    expect(
      sqlGet<{ deadline_at: string | null }>(fx.sqlite, `SELECT deadline_at FROM event_occurrences WHERE event_id = 'no_deadline'`)!.deadline_at,
    ).toBeNull();
  });
});

describe('玩家选定结算 resolveEvent', () => {
  it('选 2 局部修补：落 +3 流水 + 备注 + outcome_json + 审计 + 通知', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    bindAccount(fx, 1, 1);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS, { name: '草皮病害' });
    const id = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害' });

    const out = await resolveEvent(fx.env, { occurrenceId: id, choiceNo: 2, actor: 1, origin: 'user' });
    expect(out).toMatchObject({ occurrenceId: id, clubId: 1, clubName: '俱乐部1', eventId: 'pick_me', optionNo: 2, optionName: '局部修补', auto: false, skipped: false, how: '选2 局部修补' });
    expect(out.notes).toEqual(['资金 +3.0 m']);
    expect(out.text).toBe('草皮病害·局部修补：选2 局部修补（资金 +3.0 m）');

    const row = occurrenceRow(fx.sqlite, id)!;
    expect(row.status).toBe('resolved');
    expect(row.choice_no).toBe(2);
    expect(row.resolved_by).toBe('1');
    expect(row.resolved_at).not.toBeNull();
    expect(JSON.parse(row.outcome_json)).toEqual({ option: 2, option_name: '局部修补', auto: false, effects: { money: 3 } });
    expect(JSON.parse(row.notes_json)).toEqual(['资金 +3.0 m']);

    const entry = sqlGet<{ kind: string; ref_type: string; ref_id: number; amount: number; memo: string }>(
      fx.sqlite,
      `SELECT kind, ref_type, ref_id, amount, memo FROM ledger_entries`,
    )!;
    expect(entry).toMatchObject({ kind: 'event', ref_type: 'event', ref_id: id, amount: 3 });
    expect(entry.memo).toBe('草皮病害·局部修补：资金 +3.0 m');

    const audit = sqlGet<{ action: string; origin: string; target_id: number }>(fx.sqlite, `SELECT action, origin, target_id FROM audit_log ORDER BY id DESC LIMIT 1`)!;
    expect(audit).toMatchObject({ action: 'event_resolve', origin: 'user', target_id: id });
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM notifications WHERE template = 'event_resolved'`)!.n).toBe(1);
  });

  it('超时兜底（choiceNo 缺省）：按净额最差选 1 号，resolved_by=auto、审计 origin=cron_tick', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS, { name: '草皮病害' });
    const id = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害' });

    const out = await resolveEvent(fx.env, { occurrenceId: id, choiceNo: null, actor: null, origin: 'cron_tick', auto: true });
    expect(out).toMatchObject({ optionNo: 1, optionName: '全面维修', auto: true, how: '自动最差（未收到选择）' });
    expect(sqlGet<{ resolved_by: string }>(fx.sqlite, `SELECT resolved_by FROM event_occurrences WHERE id = ${id}`)!.resolved_by).toBe('auto');
    expect(sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries`)!.amount).toBe(-5);
    expect(sqlGet<{ origin: string }>(fx.sqlite, `SELECT origin FROM audit_log WHERE action = 'event_resolve'`)!.origin).toBe('cron_tick');
  });

  it('选项号无效：引擎按最差兜底、口径写「选项号无效」（路由层会先拦 400）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    const id = seedOccurrence(fx.sqlite, { eventId: 'pick_me' });
    const out = await resolveEvent(fx.env, { occurrenceId: id, choiceNo: 9, actor: 1, origin: 'user' });
    expect(out).toMatchObject({ optionNo: 1, auto: true, how: '自动最差（选项号无效）' });
  });

  it('选中的选项没有结果配置：按无效果结算（不跳过）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(
      fx.sqlite,
      'empty_opt',
      [
        { no: 1, name: '有结果', outcomes: [{ w: 1, effects: { money: -1 } }] },
        { no: 2, name: '空选项', outcomes: [] },
      ],
      { name: '空选项事件' },
    );
    const id = seedOccurrence(fx.sqlite, { eventId: 'empty_opt', eventName: '空选项事件' });
    const out = await resolveEvent(fx.env, { occurrenceId: id, choiceNo: 2, actor: 1, origin: 'user' });
    expect(out).toMatchObject({ optionNo: 2, skipped: false, auto: false, how: '选2 空选项', effects: {} });
    expect(out.notes).toEqual(['选项无结果配置，按无效果结算']);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(0);
    expect(out.text).toBe('空选项事件·空选项：选2 空选项（选项无结果配置，按无效果结算）');
  });

  it('全部选项无结果 + 超时 → skipped；options_json 空 → 无选项信息，跳过', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'none_out', [{ no: 1, name: '空壳', outcomes: [] }], { name: '空壳事件' });
    addChoiceEvent(fx.sqlite, 'no_opts', [], { name: '无选项事件' });
    const a = seedOccurrence(fx.sqlite, { eventId: 'none_out', eventName: '空壳事件' });
    const b = seedOccurrence(fx.sqlite, { eventId: 'no_opts', eventName: '无选项事件' });

    const outA = await resolveEvent(fx.env, { occurrenceId: a, choiceNo: null, actor: null, origin: 'cron_tick', auto: true });
    expect(outA).toMatchObject({ optionNo: null, optionName: '', skipped: true, how: '选项均无结果，跳过' });
    expect(outA.text).toBe('「空壳事件」选项均无结果，跳过');
    expect(JSON.parse(occurrenceRow(fx.sqlite, a)!.outcome_json)).toEqual({ skipped: true });

    const outB = await resolveEvent(fx.env, { occurrenceId: b, choiceNo: null, actor: null, origin: 'cron_tick', auto: true });
    expect(outB).toMatchObject({ skipped: true, how: '无选项信息，跳过' });
  });

  it('404 不存在 / 409 已结算 / 409 即发型 / 409 俱乐部不在册', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    const id = seedOccurrence(fx.sqlite, { eventId: 'pick_me' });
    const instant = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventType: 'instant' });
    const ghost = seedOccurrence(fx.sqlite, { eventId: 'pick_me', clubId: 999 });

    await expect(resolveEvent(fx.env, { occurrenceId: 99999, choiceNo: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 404 });
    await expect(resolveEvent(fx.env, { occurrenceId: instant, choiceNo: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409, message: '即发型事件没有可选项' });
    await expect(resolveEvent(fx.env, { occurrenceId: ghost, choiceNo: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409, message: '这个俱乐部已经不在册，事件无法结算' });

    await resolveEvent(fx.env, { occurrenceId: id, choiceNo: 1, actor: 1, origin: 'user' });
    await expect(resolveEvent(fx.env, { occurrenceId: id, choiceNo: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409, message: '这条事件已经结算过了' });
    // 重复结算不双记
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'event_resolve'`)!.n).toBe(1);
  });

  it('结算写 effects_json（选中分支的实际生效效果；跳过写空表）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    addChoiceEvent(fx.sqlite, 'no_opts', []);
    const picked = seedOccurrence(fx.sqlite, { eventId: 'pick_me' });
    const empty = seedOccurrence(fx.sqlite, { eventId: 'no_opts' });

    await resolveEvent(fx.env, { occurrenceId: picked, choiceNo: 2, actor: 1, origin: 'user' });
    expect(occurrenceRow(fx.sqlite, picked)!.effects_json).toBe('{"money":3}');

    await resolveEvent(fx.env, { occurrenceId: empty, choiceNo: null, actor: null, origin: 'cron_tick', auto: true });
    expect(occurrenceRow(fx.sqlite, empty)!.effects_json).toBe('{}');
  });

  it('并发抢输的一方不留审计（审计挂 PENDING_GUARD，与账本同生共死）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    const id = seedOccurrence(fx.sqlite, { eventId: 'pick_me' });
    await resolveEvent(fx.env, { occurrenceId: id, choiceNo: 2, actor: 1, origin: 'user' });
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'event_resolve'`)!.n).toBe(1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(1);

    // 模拟并发：这条请求读到的是过期快照（status 仍是 pending），真表其实已经 resolved。
    // 没有守卫时它会写下一条 after 快照并未生效的审计；有守卫时审计与 UPDATE 一起被挡下。
    const snapshot = sqlGet<Record<string, unknown>>(
      fx.sqlite,
      `SELECT id, club_id, season, window_seq, event_id, event_name, event_type, deadline_at
         FROM event_occurrences WHERE id = ${id}`,
    )!;
    const stale = { ...fx.env, DB: staleOccurrenceRead(fx.env.DB, snapshot) } as unknown as Env;
    await expect(
      resolveEvent(stale, { occurrenceId: id, choiceNo: 1, actor: 9, origin: 'user' }),
    ).rejects.toMatchObject({ status: 409, message: '这条事件刚被并发结算，请刷新' });
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'event_resolve'`)!.n).toBe(1);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries`)!.n).toBe(1);
    expect(occurrenceRow(fx.sqlite, id)!.choice_no).toBe(2); // 赢家那份没被覆盖
  });
});

describe('cron 兜底 expirePendingEvents（只挑 deadline_at IS NOT NULL 的到期行）', () => {
  const NOW = '2026-07-01T12:00:00Z';

  it('到期选择型按最差兜底；未到期不动；即发型残留行（deadline 为 NULL）永不兜底', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    const due = seedOccurrence(fx.sqlite, { eventId: 'pick_me', deadlineAt: '2026-07-01T01:00:00Z' });
    const future = seedOccurrence(fx.sqlite, { eventId: 'pick_me', deadlineAt: '2026-07-05T00:00:00Z' });
    // D1 遗留形态：即发型进程中断留下的 pending 行（没有 deadline）
    const leftover = seedOccurrence(fx.sqlite, { eventId: 'storm_buzz', eventType: 'instant' });

    const tick = await expirePendingEvents(fx.env, NOW);
    expect(tick).toMatchObject({ expired: 1, reminded: 0, skipped: 0 }); // 到期行被结算后不再走 24h 提醒
    expect(occurrenceRow(fx.sqlite, due)!.status).toBe('expired'); // D3 起超时兜底记 expired 终态（0048 注释原义）
    expect(occurrenceRow(fx.sqlite, due)!.resolved_by).toBe('auto');
    expect(occurrenceRow(fx.sqlite, future)!.status).toBe('pending');
    expect(occurrenceRow(fx.sqlite, leftover)!.status).toBe('pending');
    expect(occurrenceRow(fx.sqlite, leftover)!.reminded_at).toBe('');

    // 重跑：已结的不会再结、已提醒的不会再提醒
    expect(await expirePendingEvents(fx.env, NOW)).toMatchObject({ expired: 0, reminded: 0 });
  });

  it('距时限 24h 内提醒一次（reminded_at 当闸），且超 24h 不提醒', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    bindAccount(fx, 1, 1);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS, { name: '草皮病害' });
    const soon = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害', deadlineAt: '2026-07-02T11:00:00Z' }); // 23h
    const later = seedOccurrence(fx.sqlite, { eventId: 'pick_me', deadlineAt: '2026-07-02T13:00:00Z' }); // 25h

    expect(await expirePendingEvents(fx.env, NOW)).toMatchObject({ expired: 0, reminded: 1 });
    expect(occurrenceRow(fx.sqlite, soon)!.reminded_at).toBe(NOW);
    expect(occurrenceRow(fx.sqlite, later)!.reminded_at).toBe('');
    const notice = sqlGet<{ template: string; payload: string }>(fx.sqlite, `SELECT template, payload FROM notifications LIMIT 1`)!;
    expect(notice.template).toBe('event_deadline');
    expect(JSON.parse(notice.payload).text).toContain('还有不到 24 小时可选');

    // 同一跳再跑不复发；24h 之外的到点后才提醒（此时 23h 那条已过期，被兜底吃掉）
    expect(await expirePendingEvents(fx.env, NOW)).toMatchObject({ expired: 0, reminded: 0 });
    expect(await expirePendingEvents(fx.env, '2026-07-02T12:30:00Z')).toMatchObject({ expired: 1, reminded: 1 });
    expect(occurrenceRow(fx.sqlite, later)!.reminded_at).toBe('2026-07-02T12:30:00Z');
  });

  it('结算不掉的（俱乐部已不在册）计 skipped 且不抛；已过期的行不推 24h 提醒；7 天前的残行不再扫', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    const fresh = seedOccurrence(fx.sqlite, { eventId: 'pick_me', clubId: 999, deadlineAt: '2026-07-01T01:00:00Z' });
    // 7 天下界之外的残行：不再进扫描窗口，否则积够 50 条会把整个超时兜底挤停摆
    const ancient = seedOccurrence(fx.sqlite, { eventId: 'pick_me', clubId: 999, deadlineAt: '2026-06-20T01:00:00Z' });

    const tick = await expirePendingEvents(fx.env, NOW);
    expect(tick).toMatchObject({ expired: 0, skipped: 1, reminded: 0 });
    expect(occurrenceRow(fx.sqlite, fresh)!.status).toBe('pending');
    expect(occurrenceRow(fx.sqlite, ancient)!.status).toBe('pending');
    expect(occurrenceRow(fx.sqlite, fresh)!.reminded_at).toBe('');
    // 已过期的行不该收到「还有不到 24 小时可选」（上界 `<= soon` 之外还要 `> now`）
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM notifications WHERE template = 'event_deadline'`)!.n).toBe(0);
  });

  it('到期行按 id 顺序受上限 50 约束（一跳最多结 50 条）', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS);
    for (let i = 0; i < 55; i++) seedOccurrence(fx.sqlite, { eventId: 'pick_me', deadlineAt: '2026-07-01T01:00:00Z' });
    expect(await expirePendingEvents(fx.env, NOW)).toMatchObject({ expired: 50 });
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM event_occurrences WHERE status = 'pending'`)!.n).toBe(5);
  });
});

describe('教练端事件视图 listClubEvents', () => {
  it('pending 只列选择型待选；recent 含已结的即发型与选择型', async () => {
    const fx = freshEnv();
    seedClub(fx.auth, fx.sqlite, 1, 11);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS, { name: '草皮病害' });
    const pendingChoice = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害', deadlineAt: '2026-07-02T00:00:00Z', text: '文案' });
    const pendingInstantLeftover = seedOccurrence(fx.sqlite, { eventId: 'storm_buzz', eventType: 'instant' });
    const doneInstant = seedOccurrence(fx.sqlite, { eventId: 'storm_buzz', eventType: 'instant', status: 'resolved' });
    fx.sqlite.exec(`UPDATE event_occurrences SET notes_json = '["下一场上座 ×0.85"]', text = '暴雨滂沱' WHERE id = ${doneInstant}`);
    const doneChoice = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害', status: 'resolved' });
    fx.sqlite.exec(
      `UPDATE event_occurrences SET choice_no = 2, outcome_json = '{"option":2,"option_name":"局部修补","auto":false,"effects":{"money":3}}',
              notes_json = '["资金 +3.0 m"]', resolved_by = 'auto', resolved_at = '2026-07-01T01:00:00Z', text = '草皮病害·局部修补：选2 局部修补' WHERE id = ${doneChoice}`,
    );

    const view = await listClubEvents(fx.env, 1);
    expect(view.pending.map((p) => p.id)).toEqual([pendingChoice]);
    expect(view.pending[0]!.options).toHaveLength(2);
    expect(view.pending[0]!.options[1]).toMatchObject({ no: 2, name: '局部修补', desc: '省钱' });
    expect(view.pending[0]!.deadlineAt).toBe('2026-07-02T00:00:00Z');

    // 倒序（id 大在前）
    expect(view.recent.map((r) => r.id)).toEqual([doneChoice, doneInstant]);
    expect(view.recent[0]).toMatchObject({ eventName: '草皮病害', choiceNo: 2, optionName: '局部修补', auto: false, skipped: false, resolvedBy: 'auto', effects: { money: 3 }, notes: ['资金 +3.0 m'] });
    expect(view.recent[1]).toMatchObject({ eventId: 'storm_buzz', choiceNo: null, optionName: '', auto: false, skipped: false, notes: ['下一场上座 ×0.85'] });
    // 即发型残留的 pending 行既不在 pending 也不在 recent（只是脏数据）
    expect([...view.pending, ...view.recent].some((r) => r.id === pendingInstantLeftover)).toBe(false);
  });
});

describe('教练端路由（v6.11.0）', () => {
  const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-coach') =>
    app.request(
      path,
      { method, headers: { 'content-type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  const getAs = (path: string, env: Env, cookie = 'whl_session=tok-coach') => app.request(path, { headers: { Cookie: cookie } }, env);

  function seedPickable(fx: Fixture) {
    seedClub(fx.auth, fx.sqlite, 1, 11);
    bindAccount(fx, 1, 1);
    onlyCustom(fx.sqlite);
    addChoiceEvent(fx.sqlite, 'pick_me', REPAIR_OPTIONS, { name: '草皮病害' });
    return seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害', deadlineAt: '2026-07-02T00:00:00Z' });
  }

  it('GET /club/events 形状；未绑定 403；匿名 401', async () => {
    const fx = freshEnv();
    const id = seedPickable(fx);
    seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害', clubId: 2 });

    const res = await getAs('/api/club/events', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clubId: number; pending: { id: number }[]; recent: unknown[] };
    expect(body.clubId).toBe(1);
    expect(body.pending.map((p) => p.id)).toEqual([id]); // 别队的待选不出现在本队视图
    expect(body.recent).toEqual([]);

    // 没绑俱乐部的账号（userId 2 未绑定）→ 403
    expect((await getAs('/api/club/events', fx.env, 'whl_session=tok-admin')).status).toBe(403);
    expect((await getAs('/api/club/events', fx.env, '')).status).toBe(401);
  });

  it('POST /club/events/:id/choose 选定即结算，之后 pending 清空、重复选 409', async () => {
    const fx = freshEnv();
    const id = seedPickable(fx);

    const ok = await send('POST', `/api/club/events/${id}/choose`, fx.env, { choiceNo: 2 });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { event: { optionNo: number; optionName: string; effects: Record<string, unknown>; notes: string[]; auto: boolean; text: string } };
    expect(body.event).toMatchObject({ optionNo: 2, optionName: '局部修补', effects: { money: 3 }, auto: false });
    expect(body.event.notes).toEqual(['资金 +3.0 m']);
    expect(body.event.text).toContain('局部修补');

    const after = (await (await getAs('/api/club/events', fx.env)).json()) as { pending: unknown[]; recent: { choiceNo: number | null }[] };
    expect(after.pending).toEqual([]);
    expect(after.recent[0]!.choiceNo).toBe(2);

    expect((await send('POST', `/api/club/events/${id}/choose`, fx.env, { choiceNo: 1 })).status).toBe(409);
  });

  it('参数与归属校验：400 选项号越界/缺号/id 非法、403 别队、404 不存在、401 匿名', async () => {
    const fx = freshEnv();
    const id = seedPickable(fx);
    const other = seedOccurrence(fx.sqlite, { eventId: 'pick_me', eventName: '草皮病害', clubId: 2 });

    const bad3 = await send('POST', `/api/club/events/${id}/choose`, fx.env, { choiceNo: 3 });
    expect(bad3.status).toBe(400);
    expect(((await bad3.json()) as { error: string }).error).toContain('没有「3」号选项');
    expect((await send('POST', `/api/club/events/${id}/choose`, fx.env, {})).status).toBe(400);
    expect((await send('POST', `/api/club/events/${id}/choose`, fx.env, { choiceNo: 'abc' })).status).toBe(400);
    expect((await send('POST', `/api/club/events/abc/choose`, fx.env, { choiceNo: 1 })).status).toBe(400);
    expect((await send('POST', `/api/club/events/99999/choose`, fx.env, { choiceNo: 1 })).status).toBe(404);
    expect((await send('POST', `/api/club/events/${other}/choose`, fx.env, { choiceNo: 1 })).status).toBe(403);
    expect((await send('POST', `/api/club/events/${id}/choose`, fx.env, { choiceNo: 1 }, '')).status).toBe(401);
    // 一路 400/403/404/401 之后原事件仍是待选
    expect(occurrenceRow(fx.sqlite, id)!.status).toBe('pending');
  });

  it('即发型 pending 残留行选不了（409）', async () => {
    const fx = freshEnv();
    seedPickable(fx);
    const leftover = seedOccurrence(fx.sqlite, { eventId: 'storm_buzz', eventType: 'instant' });
    const res = await send('POST', `/api/club/events/${leftover}/choose`, fx.env, { choiceNo: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('即发型事件没有可选项');
  });
});
