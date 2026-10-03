// v6.14.0 C3 招商轮（market_rounds / market_offers）：清盘与开轮、定向递价、签约/接班/换签、上门事件递价、配置与路由
// 计划：docs/test-plans/v6.14.0-c3.md
//   覆盖 TC-ROUND-01..09 / TC-OFFER-01..11 / TC-ACCEPT-01..15（含 09B/09C 评审加固）/ TC-QUEUED-01..08 / TC-SPAWN-01..11 / TC-CFG-01..03 / TC-ROUTE-01..07
//   （TC-ACCEPT-16 与 TC-UI-01..04 为人工/e2e，不在本文件）
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, runMigration, sqlAll, sqlGet } from './d1.ts';
import { CONFIG_KEYS, resetConfigCache } from '../src/core/config.ts';
import {
  acceptOffer,
  activateQueuedStatements,
  buildRoundStatements,
  getOpenRound,
  listClubOffers,
  loadRoundRules,
  packageNoForTier,
  pickTargetsForBrand,
  spawnVisitOffer,
} from '../src/worker/market-ops.ts';
import {
  getActiveNaming,
  loadHeatRules,
  windowNamingStatements,
} from '../src/worker/naming-ops.ts';
import type { NamingContractRow } from '../src/worker/naming-ops.ts';
import { windowHomeStatements } from '../src/worker/home.ts';
import { renderNotification } from '../src/worker/notify.ts';
import { seededUnit } from '../src/worker/venue-ops.ts';
import { ledgerMovement } from '../src/worker/ledger.ts';
import {
  conditionOk,
  describeEffect,
  EVENT_RULES_DEFAULT,
  pickEvent,
  type EventClubContext,
  type EventRow,
} from '../src/worker/event-ops.ts';
import { seedOffer, seedOpenRound, signViaOffer } from './market-helpers.ts';

// ---- 夹具（与 naming-ops.test.ts 同构） ----

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(opts: { rng?: () => number } = {}): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0), (2, '管理组甲', 'admin', 0, 0);`,
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
    SYNC_BASE_URL: undefined,
    SYNC_SECRET: undefined,
    rng: opts.rng,
  };
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, kv };
}

/** 默认球场：容量 20000、死忠 18000 ⇒ 底价 = 1.316 × 热度 × 行业系数 */
function seedClub(sqlite: DatabaseSync, clubId = 1, opts: { capacity?: number; fans?: number; balance?: number } = {}) {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (${clubId}, '俱乐部${clubId}', 'premier', 'active');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (${clubId}, '球场${clubId}', ${opts.capacity ?? 20000}, 0, ${opts.fans ?? 18000});
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (${clubId}, ${opts.balance ?? 50}, '2026-01-01T00:00:00Z');
  `);
}

function seedClubs(sqlite: DatabaseSync, n: number, opts: { capacity?: number; fans?: number } = {}) {
  for (let id = 1; id <= n; id += 1) seedClub(sqlite, id, opts);
}

function openWindow(sqlite: DatabaseSync, season = 1, windowSeq = 1) {
  sqlite.exec(
    `INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (${season}, ${windowSeq}, 'open', '2026-07-01T00:00:00Z');`,
  );
}

function bindCoach(sqlite: DatabaseSync, clubId = 1, userId = 1) {
  sqlite.exec(`INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${clubId}, ${userId}, '2026-01-01T00:00:00Z');`);
}

function setConfig(sqlite: DatabaseSync, key: string, value: unknown) {
  sqlite
    .prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, '2026-07-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(key, JSON.stringify(value));
  resetConfigCache();
}

/** 开轮（清盘旧轮 + 开新轮 + 定向递价），返回 build 结果 */
async function openRound(env: Env, season = 1, windowSeq = 1) {
  const build = await buildRoundStatements(env, season, windowSeq);
  await env.DB.batch([...build.settleStatements, ...build.openStatements]);
  return build;
}

interface OfferRow {
  id: number;
  round_id: number;
  brand_id: number;
  club_id: number;
  package_no: number;
  amount: number;
  windows: number;
  package_json: string;
  status: string;
  created_at: string;
  expire_at: string;
}

function offerRows(sqlite: DatabaseSync, where = '', ...params: (string | number | null)[]): OfferRow[] {
  return sqlAll<OfferRow>(sqlite, `SELECT * FROM market_offers ${where} ORDER BY id`, ...params);
}

function offerRow(sqlite: DatabaseSync, id: number): OfferRow {
  return sqlGet<OfferRow>(sqlite, 'SELECT * FROM market_offers WHERE id = ?', id)!;
}

/** 某品牌在该轮出手的俱乐部 id（升序） */
function clubsOfferedFor(sqlite: DatabaseSync, brand: string, roundId: number): number[] {
  return sqlAll<{ club_id: number }>(
    sqlite,
    `SELECT o.club_id FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id
      WHERE b.brand = ? AND o.round_id = ? ORDER BY o.club_id`,
    brand,
    roundId,
  ).map((r) => r.club_id);
}

function brandHeat(sqlite: DatabaseSync, brand: string): number {
  return sqlGet<{ heat: number }>(sqlite, 'SELECT heat FROM brand_pool WHERE brand = ?', brand)!.heat;
}

function brandId(sqlite: DatabaseSync, brand: string): number {
  return sqlGet<{ id: number }>(sqlite, 'SELECT id FROM brand_pool WHERE brand = ?', brand)!.id;
}

function countOf(sqlite: DatabaseSync, sql: string, ...params: (string | number | null)[]): number {
  return sqlGet<{ n: number }>(sqlite, sql, ...params)!.n;
}

/** 断言 Promise 抛 HttpError（status + 文案逐字） */
async function rejectsHttp(p: Promise<unknown>, status: number, message: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { status?: number; message?: string },
  );
  expect(err, '应抛 HttpError').not.toBeNull();
  expect(err?.status).toBe(status);
  expect(err?.message).toBe(message);
}

/**
 * 竞态复现夹具（评审 P0-1 测试用）：第 1 次 batch 提交前先跑 inject——
 * 模拟「预检已过、批提交前被并发抢先落库」这一窗口，不依赖调度时序。只包 batch，其余直通
 * （测试 D1 替身的方法闭包持 sqlite、不依赖 this，Reflect.get 直取安全）。
 */
function racingEnv(fx: Fixture, inject: () => void): Env {
  const real = fx.env.DB;
  let armed = true;
  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'batch') {
        return async (statements: ReturnType<Env['DB']['prepare']>[]) => {
          if (armed) {
            armed = false;
            inject();
          }
          return target.batch(statements);
        };
      }
      return Reflect.get(target, prop) as unknown;
    },
  }) as Env['DB'];
  return { ...fx.env, DB: db };
}

/** 源码顺序锁：各片段必须依次出现（用于批序/语句顺序这类只能靠源码表达的契约） */
function orderInSource(src: string, ...parts: string[]) {
  let prev = -1;
  for (const part of parts) {
    const at = src.indexOf(part);
    expect(at, `源码里找不到片段：${part}`).toBeGreaterThan(-1);
    expect(at, `片段顺序不对：${part}`).toBeGreaterThan(prev);
    prev = at;
  }
}

const MARKET_SRC = 'src/worker/market-ops.ts';
const HOME_SRC = 'src/worker/home.ts';
const EVENT_SRC = 'src/worker/event-ops.ts';
const MACHINE_SRC = 'src/worker/window-machine.ts';

/** 报告期事件 occurrence 守卫（与 event-ops.ts 的 PENDING_GUARD 同字面量） */
const PENDING_GUARD = "(SELECT status FROM event_occurrences WHERE id = ?) = 'pending'";

/** 插一条 pending occurrence（spawnVisitOffer 的幂等闸靠它），返回 id */
function seedOccurrence(sqlite: DatabaseSync, clubId = 1, season = 1, windowSeq = 1, eventId = 'brand_visit'): number {
  const out = sqlite
    .prepare(
      `INSERT INTO event_occurrences (club_id, season, window_seq, event_id, event_name, event_type, status, effects_json,
        notes_json, choice_no, outcome_json, deadline_at, resolved_by, resolved_at, text, created_at)
       VALUES (?, ?, ?, ?, '品牌上门', 'instant', 'pending', '{}', '[]', NULL, '{}', NULL, '', NULL, '', '2026-07-01T00:00:00Z')`,
    )
    .run(clubId, season, windowSeq, eventId);
  return Number(out.lastInsertRowid);
}

function ctxOf(patch: Partial<EventClubContext> = {}): EventClubContext {
  return {
    clubId: 1,
    name: '俱乐部1',
    stadium: {
      club_id: 1,
      name: '球场1',
      capacity: 20000,
      tier: 0,
      shell_influence: 0,
      bonus_points: 0,
      fans: 18000,
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
    tourTeamId: null,
    ...patch,
  };
}

function eventRowOf(patch: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    event_id: 'brand_visit',
    name: '品牌上门',
    category: '招商',
    weight: 5,
    event_type: 'instant',
    conditions_json: '{"requires_no_naming":true}',
    effects_json: '{"offer_spawn":1}',
    options_json: '[]',
    soft_conditions: 0,
    template: '{team} 引来品牌侧注意。',
    source: 'builtin',
    status: 'adopted',
    created_at: '2026-07-01T00:00:00Z',
    ...patch,
  };
}

beforeEach(() => {
  resetConfigCache();
});

// ================= TC-ROUND：清盘与开轮 =================

describe('招商轮清盘与开轮（TC-ROUND）', () => {
  it('TC-ROUND-01 清盘：旧轮 pending 一律 expired、settled_at 落时间、hadOpenRound=true', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const round1 = await seedOpenRound(fx.env);
    const keep = await seedOffer(fx.env, 1, '麒麟生物', 1);
    await seedOffer(fx.env, 1, '亚马逊', 2);

    const build = await buildRoundStatements(fx.env, 1, 2);
    expect(build.hadOpenRound).toBe(true);
    expect(build.settleStatements).toHaveLength(3);
    expect(build.offerCount).toBe(7); // 7 家品牌各 1 队（头部 min(2,3)=2 但只有 1 队可选）

    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);

    expect(offerRows(fx.sqlite, 'WHERE round_id = ?', round1).map((o) => o.status)).toEqual(['expired', 'expired']);
    expect(offerRow(fx.sqlite, keep).status).toBe('expired');
    const old = sqlGet<{ status: string; settled_at: string | null }>(
      fx.sqlite,
      'SELECT status, settled_at FROM market_rounds WHERE id = ?',
      round1,
    )!;
    expect(old.status).toBe('settled');
    expect(old.settled_at).not.toBeNull();
    expect(await getOpenRound(fx.env.DB)).not.toBeNull();
  });

  it('TC-ROUND-02 无 open 轮：settle 段为空、hadOpenRound=false', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const build = await buildRoundStatements(fx.env, 1, 1);
    expect(build.hadOpenRound).toBe(false);
    expect(build.settleStatements).toHaveLength(0);
    expect(build.offerCount).toBe(7);
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM market_rounds')).toBe(0);
  });

  it('TC-ROUND-03 唯一约束 uq_market_round_open：第二条 open 轮直插即撞', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    expect(() =>
      fx.sqlite
        .prepare("INSERT INTO market_rounds (opened_season, opened_window, status, opened_at) VALUES (1, 2, 'open', '2026-08-01T00:00:00Z')")
        .run(),
    ).toThrow(/UNIQUE/i);
    // 迁移里确实建了这个部分唯一索引（防双开轮的最后一道闸）
    const sql = readFileSync('src/db/migrations/0055_market_rounds.sql', 'utf8');
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_market_round_open ON market_rounds (status) WHERE status = 'open';");
  });

  it('TC-ROUND-04 新报价 round_id 绑本批刚开的新轮（标量子查询不得取到旧轮）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const round1 = await seedOpenRound(fx.env);
    const build = await buildRoundStatements(fx.env, 1, 1);
    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);
    const round2 = (await getOpenRound(fx.env.DB))!;
    expect(round2.id).not.toBe(round1);
    const fresh = offerRows(fx.sqlite, 'WHERE round_id = ?', round2.id);
    expect(fresh).toHaveLength(build.offerCount);
    expect(offerRows(fx.sqlite, 'WHERE round_id = ?', round1)).toHaveLength(0);
  });

  it('TC-ROUND-05 连续两轮各自清盘：每轮 pending 都被自己那轮清掉', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await openRound(fx.env, 1, 1);
    const round1 = (await getOpenRound(fx.env.DB))!;
    await openRound(fx.env, 1, 2);
    const round2 = (await getOpenRound(fx.env.DB))!;
    expect(offerRows(fx.sqlite, 'WHERE round_id = ? AND status = \'pending\'', round1.id)).toHaveLength(0);
    await openRound(fx.env, 1, 3);
    expect(offerRows(fx.sqlite, 'WHERE round_id = ? AND status = \'pending\'', round2.id)).toHaveLength(0);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM market_rounds WHERE status = 'settled'")).toBe(2);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM market_rounds WHERE status = 'open'")).toBe(1);
  });

  it('TC-ROUND-06 批内必败语句整批回滚（含清盘段），重放同终态零副作用', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const round1 = await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '麒麟生物', 1);
    const build = await buildRoundStatements(fx.env, 1, 2);
    // 批内必败语句（NOT NULL 违约）⇒ 整批回滚：清盘也不得生效
    const bomb = fx.env.DB.prepare(
      "INSERT INTO market_rounds (opened_season, opened_window, status, opened_at) VALUES (NULL, 2, 'open', '2026-08-01T00:00:00Z')",
    );
    await expect(fx.env.DB.batch([...build.settleStatements, bomb])).rejects.toThrow(/NOT NULL/i);
    expect(offerRow(fx.sqlite, offerId).status).toBe('pending');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM market_rounds WHERE id = ?', round1)!.status).toBe('open');

    // 重放同一批（去掉必败语句）：走到终态
    await fx.env.DB.batch(build.settleStatements);
    expect(offerRow(fx.sqlite, offerId).status).toBe('expired');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM market_rounds WHERE id = ?', round1)!.status).toBe('settled');

    // 再重放一次：已无 open 轮 ⇒ settle 段为空，整批零改行
    const replay = await buildRoundStatements(fx.env, 1, 2);
    expect(replay.hadOpenRound).toBe(false);
    expect(replay.settleStatements).toHaveLength(0);
    await fx.env.DB.batch(replay.settleStatements);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM market_rounds WHERE id = ?', round1)!.status).toBe('settled');
    expect(offerRow(fx.sqlite, offerId).status).toBe('expired');
  });

  it('TC-ROUND-07A 整轮无人签：品牌热度 −ignored（未出手的品牌不动）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await seedOffer(fx.env, 1, '麒麟生物', 1);
    await seedOffer(fx.env, 1, '亚马逊', 2);
    await seedOffer(fx.env, 1, '星海通讯', 1);
    await openRound(fx.env, 1, 2);
    expect(brandHeat(fx.sqlite, '麒麟生物')).toBe(1.17); // 1.2 − 0.03
    expect(brandHeat(fx.sqlite, '亚马逊')).toBe(1.27); // 1.3 − 0.03
    expect(brandHeat(fx.sqlite, '星海通讯')).toBe(0.77); // 0.8 − 0.03
    expect(brandHeat(fx.sqlite, '阿迪达斯')).toBe(1.1); // 没出手 ⇒ 不动
  });

  it('TC-ROUND-07B 热度惩罚钳底不破（SQL 侧 MAX 兜住下钳）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    fx.sqlite.exec("UPDATE brand_pool SET heat = 0.52 WHERE brand = '星海通讯'");
    await seedOpenRound(fx.env);
    await seedOffer(fx.env, 1, '星海通讯', 1);
    await openRound(fx.env, 1, 2);
    expect(brandHeat(fx.sqlite, '星海通讯')).toBe(0.5); // 0.49 → 钳到 0.5
  });

  it('TC-ROUND-07D 弃用品牌（status=discarded）不参与冷落惩罚，在池品牌照扣', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await seedOffer(fx.env, 1, '星海通讯', 1); // 报价先落，再把品牌弃用
    await seedOffer(fx.env, 1, '阿迪达斯', 1); // 对照组：在池且整轮无人签
    fx.sqlite.exec("UPDATE brand_pool SET status = 'discarded' WHERE brand = '星海通讯'");
    await openRound(fx.env, 1, 2);
    expect(brandHeat(fx.sqlite, '星海通讯')).toBe(0.8); // 弃用 ⇒ WHERE status='adopted' 挡住
    expect(brandHeat(fx.sqlite, '阿迪达斯')).toBe(1.07); // 1.1 − 0.03
  });

  it('TC-ROUND-07C 已 accepted / queued 的品牌不扣热度（且自此不再出手）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    // 队 1 签下可口可乐（新兴，名额 2）⇒ 热度 +deal
    await signViaOffer(fx.env, 1, '可口可乐', 1);
    // 队 2 有 active（星海通讯）⇒ 可排队接班可口可乐
    await signViaOffer(fx.env, 2, '星海通讯', 1);
    const queuedOffer = await seedOffer(fx.env, 2, '可口可乐', 1);
    const out = await acceptOffer(fx.env, queuedOffer, 2, 'queued', null);
    expect(out.result).toBe('queued');
    expect(brandHeat(fx.sqlite, '可口可乐')).toBe(1.02); // 签约 deal +0.02

    const build = await buildRoundStatements(fx.env, 1, 2);
    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);
    // 清盘不得把已签/已排队的品牌按「被冷落」再扣一次
    expect(brandHeat(fx.sqlite, '可口可乐')).toBe(1.02);
    // 「名额合并计数 ⇒ 本轮不再出手」由 TC-OFFER-07B 专测（此处不重复断言，避免变异归因串台）
    expect(packageNoForTier('新兴')).toBe(1);
  });

  it('TC-ROUND-08 批序：清盘 < 档位校准 < 收租 < 开轮+转正（源码锁）', () => {
    const home = readFileSync(HOME_SRC, 'utf8');
    orderInSource(
      home,
      'statements.push(...round.settleStatements);',
      'const recal = await recalibrateTierStatements(env.DB);',
      'windowNamingStatements(env, naming, season, windowSeq,',
      'statements.push(...round.openStatements, ...activation.statements);',
    );
    expect(home).toContain('const round = opts.chargeNaming ? await buildRoundStatements(env, season, windowSeq) : null;');
    expect(home).toContain('const activation = await activateQueuedStatements(env, season, windowSeq, \'user\', opts.actor ?? null);');
    // 临时窗不带 market 段（chargeNaming=false 由关窗机传）
    const machine = readFileSync(MACHINE_SRC, 'utf8');
    expect(machine).toContain('chargeNaming: !isTemporary');
  });

  it('TC-ROUND-09 临时窗全跳过：marketOffers/activatedClubs=0、无通知、不动报价', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const queuedOffer = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, queuedOffer, 1, 'queued', null);
    const pending = await seedOffer(fx.env, 1, '亚马逊', 1);
    const roundsBefore = countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM market_rounds');

    const { summary, notifications } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: false });

    expect(summary.marketOffers).toBe(0);
    expect(summary.activatedClubs).toBe(0);
    expect(notifications).toHaveLength(0);
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM market_rounds')).toBe(roundsBefore);
    expect(offerRow(fx.sqlite, pending).status).toBe('pending');
    expect(offerRow(fx.sqlite, queuedOffer).status).toBe('queued');
    expect((await getActiveNaming(fx.env.DB, 1))!.brand).toBe('星海通讯');
  });
});

// ================= TC-OFFER：定向递价 =================

describe('定向递价（TC-OFFER）', () => {
  it('TC-OFFER-01 头部 min(2, perBrand)：估值前二，perBrand 再大也只给 2 队', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1, { capacity: 40000 });
    seedClub(fx.sqlite, 2, { capacity: 20000 });
    seedClub(fx.sqlite, 3, { capacity: 30000 });
    seedClub(fx.sqlite, 4, { capacity: 10000 });
    openWindow(fx.sqlite);
    const build = await openRound(fx.env, 1, 1);
    const round = (await getOpenRound(fx.env.DB))!;
    expect(build.offersPerClub.length).toBeGreaterThan(0);
    expect(clubsOfferedFor(fx.sqlite, '亚马逊', round.id)).toEqual([1, 3]);
    expect(clubsOfferedFor(fx.sqlite, '麒麟生物', round.id)).toEqual([1, 3]);
    // perBrand=1 ⇒ 头部只给第一
    expect(pickTargetsForBrand('头部', [{ clubId: 9 }, { clubId: 8 }, { clubId: 7 }], 1, new Set())).toEqual([9]);
    expect(packageNoForTier('头部')).toBe(2);
  });

  it('TC-OFFER-02 新兴中游：mid=floor(n/2)、start=max(0,mid−1)，取 perBrand 个', () => {
    const vals = [1, 2, 3, 4, 5, 6].map((clubId) => ({ clubId }));
    expect(pickTargetsForBrand('新兴', vals, 3, new Set())).toEqual([3, 4, 5]);
    expect(pickTargetsForBrand('新兴', vals, 2, new Set())).toEqual([3, 4]);
    expect(pickTargetsForBrand('新兴', [1, 2].map((clubId) => ({ clubId })), 3, new Set())).toEqual([1, 2]);
    expect(pickTargetsForBrand('新兴', [{ clubId: 1 }], 3, new Set())).toEqual([1]);
  });

  it('TC-OFFER-02b 新兴落地：6 队等值 ⇒ 可口可乐/海底捞都给 [3,4,5]', async () => {
    const fx = freshEnv();
    seedClubs(fx.sqlite, 6);
    openWindow(fx.sqlite);
    await openRound(fx.env, 1, 1);
    const round = (await getOpenRound(fx.env.DB))!;
    expect(clubsOfferedFor(fx.sqlite, '可口可乐', round.id)).toEqual([3, 4, 5]);
    expect(clubsOfferedFor(fx.sqlite, '海底捞', round.id)).toEqual([3, 4, 5]);
    expect(packageNoForTier('新兴')).toBe(1);
  });

  it('TC-OFFER-03 口碑：零报价队优先补位，轮内累积不重复', () => {
    const vals = [1, 2, 3, 4].map((clubId) => ({ clubId }));
    expect(pickTargetsForBrand('口碑', vals, 3, new Set([1, 2]))).toEqual([3, 4, 1]);
    expect(pickTargetsForBrand('口碑', vals, 3, new Set([1, 2, 3, 4]))).toEqual([1, 2, 3]);
    expect(packageNoForTier('口碑')).toBe(1);
  });

  it('TC-OFFER-03b 口碑落地：5 队时星海通讯先给零报价的第 5 队，CVS 复用第 1-3 队', async () => {
    const fx = freshEnv();
    seedClubs(fx.sqlite, 5);
    openWindow(fx.sqlite);
    await openRound(fx.env, 1, 1);
    const round = (await getOpenRound(fx.env.DB))!;
    // 头部 {1,2}、新兴 [2,3,4] 已占 1-4 ⇒ 星海通讯 zero=[5] 优先
    expect(clubsOfferedFor(fx.sqlite, '星海通讯', round.id)).toEqual([1, 2, 5]);
    expect(clubsOfferedFor(fx.sqlite, 'CVS Health', round.id)).toEqual([1, 2, 3]);
    const star = offerRows(fx.sqlite, "WHERE round_id = ? AND brand_id = ?", round.id, brandId(fx.sqlite, '星海通讯'));
    expect(new Set(star.map((o) => o.club_id)).size).toBe(star.length);
  });

  it('TC-OFFER-04 空估值不炸：无球场档案的队不参与（也不影响其他品牌）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    fx.sqlite.exec("INSERT INTO clubs (id, name, league_tier, status) VALUES (2, '无球场队', 'premier', 'active')");
    openWindow(fx.sqlite);
    const build = await openRound(fx.env, 1, 1);
    expect(build.offerCount).toBe(7); // 7 家品牌 × 唯一可估值的队 1
    expect(offerRows(fx.sqlite, 'WHERE club_id = 2')).toHaveLength(0);
    expect(pickTargetsForBrand('口碑', [], 3, new Set())).toEqual([]);
    expect(pickTargetsForBrand('头部', [], 3, new Set())).toEqual([]);
  });

  it('TC-OFFER-05 套餐：头部递进取(pkg2)、其余稳健(pkg1)，amount=估值套餐价', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await openRound(fx.env, 1, 1);
    const byBrand = (brand: string) =>
      sqlGet<{ package_no: number; windows: number; amount: number; package_json: string }>(
        fx.sqlite,
        `SELECT o.package_no, o.windows, o.amount, o.package_json FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id WHERE b.brand = ?`,
        brand,
      )!;
    const amazon = byBrand('亚马逊');
    expect(amazon.package_no).toBe(2);
    expect(amazon.windows).toBe(2);
    expect(amazon.amount).toBe(2.78); // round3(round3(1.316×1.3×1.3) × 1.25)
    expect((JSON.parse(amazon.package_json) as { pkgName: string }).pkgName).toBe('进取');
    const coke = byBrand('可口可乐');
    expect([coke.package_no, coke.windows, coke.amount]).toEqual([1, 6, 1.119]);
    expect((JSON.parse(coke.package_json) as { pkgName: string }).pkgName).toBe('稳健');
    const qilin = byBrand('麒麟生物'); // 头部 ⇒ 同样递进取
    expect([qilin.package_no, qilin.windows, qilin.amount]).toEqual([2, 2, 2.369]); // round3(1.895 × 1.25)
  });

  it('TC-OFFER-06 package_json 是发放时快照：开轮后改热度不影响合同', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await openRound(fx.env, 1, 1);
    const amazon = sqlGet<OfferRow>(
      fx.sqlite,
      `SELECT o.* FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id WHERE b.brand = '亚马逊'`,
    )!;
    fx.sqlite.exec("UPDATE brand_pool SET heat = 1.4 WHERE brand = '亚马逊'");
    const out = await acceptOffer(fx.env, amazon.id, 1, undefined, null);
    const contract = out.contract!;
    expect(contract.base_fee).toBe(2.224); // 快照底价（旧热度 1.3）
    expect(contract.brand_heat).toBe(1.3);
    expect(contract.fee_per_window).toBe(2.78);
    expect(contract.package_no).toBe(2);
    expect(contract.windows_total).toBe(2);
    expect(contract.windows_remaining).toBe(2);
    // 热度按签约当刻的现值再 +deal（合同是快照，热度不是）；1.4 + 0.02，未到上钳
    expect(brandHeat(fx.sqlite, '亚马逊')).toBe(1.42);
  });

  it('TC-OFFER-07A 名额过滤：头部已有 active ⇒ 整轮不出手', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '亚马逊', 2);
    const build = await buildRoundStatements(fx.env, 2, 1);
    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);
    const round = (await getOpenRound(fx.env.DB))!;
    expect(clubsOfferedFor(fx.sqlite, '亚马逊', round.id)).toEqual([]);
    expect(build.offerCount).toBe(12); // 6 家出手 × 2 队（头部剩 2 家 ×2 + 新兴 ×2 + 口碑 ×2）
  });

  it('TC-OFFER-07B 名额过滤：queued 与 active 合并计数；口碑不限额照出', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '可口可乐', 1); // 新兴 active 1
    await signViaOffer(fx.env, 2, '星海通讯', 1); // 队 2 有约 ⇒ 才能排队
    const queuedOffer = await seedOffer(fx.env, 2, '可口可乐', 1);
    await acceptOffer(fx.env, queuedOffer, 2, 'queued', null); // 新兴 queued 1 ⇒ 满 2
    const build = await buildRoundStatements(fx.env, 2, 1);
    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);
    const round = (await getOpenRound(fx.env.DB))!;
    expect(clubsOfferedFor(fx.sqlite, '可口可乐', round.id)).toEqual([]);
    expect(clubsOfferedFor(fx.sqlite, '海底捞', round.id)).toEqual([1, 2]); // 新兴另一家没满
    expect(clubsOfferedFor(fx.sqlite, '星海通讯', round.id)).toEqual([1, 2]); // 口碑有 active 照出
  });

  it('TC-OFFER-08 口碑（quota=null）恒出手：已有 active + 另有 queued 也不拦', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1); // 口碑 active 1
    await signViaOffer(fx.env, 2, '海底捞', 1); // 队 2 有约 ⇒ 才能排队
    const queuedOffer = await seedOffer(fx.env, 2, '星海通讯', 1);
    expect((await acceptOffer(fx.env, queuedOffer, 2, 'queued', null)).result).toBe('queued'); // 口碑不限额 ⇒ 排得进
    const build = await buildRoundStatements(fx.env, 2, 1);
    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);
    const round = (await getOpenRound(fx.env.DB))!;
    // 口碑 quota=null 恒参与：active 1 + queued 1 都拦不住，也不能被「按 0 算」的错误守卫静默跳过
    expect(clubsOfferedFor(fx.sqlite, '星海通讯', round.id)).toEqual([1, 2]);
  });

  it('TC-OFFER-09 expire_at：默认 72h 后；ttl=0 ⇒ 不设时限哨兵值', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const t0 = Date.now();
    await openRound(fx.env, 1, 1);
    const row = offerRows(fx.sqlite)[0]!;
    const delta = new Date(row.expire_at).getTime() - t0;
    expect(Math.abs(delta - 72 * 3600_000)).toBeLessThan(120_000);

    setConfig(fx.sqlite, 'market_round_rules', { offersPerBrand: 3, offerTtlHours: 0 });
    await openRound(fx.env, 1, 2);
    const round2 = (await getOpenRound(fx.env.DB))!;
    const rows = offerRows(fx.sqlite, 'WHERE round_id = ?', round2.id);
    expect(rows[0]!.expire_at).toBe('9999-12-31T00:00:00.000Z');
  });

  it('TC-OFFER-10 listClubOffers 口径：pending 只在 open 轮算，queued 恒算，accepted 不列', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await openRound(fx.env, 1, 1);
    await openRound(fx.env, 1, 2);
    const round2 = (await getOpenRound(fx.env.DB))!;
    const listed = await listClubOffers(fx.env.DB, 1);
    expect(listed).toHaveLength(7);
    expect(listed.every((o) => o.round_status === 'open')).toBe(true);
    expect(listed.map((o) => o.id)).toEqual([...listed.map((o) => o.id)].sort((a, b) => b - a)); // id DESC

    const star = listed.find((o) => o.brand === '星海通讯')!;
    const cvs = listed.find((o) => o.brand === 'CVS Health')!;
    await acceptOffer(fx.env, star.id, 1, undefined, null); // 签掉 ⇒ accepted 不再列
    await acceptOffer(fx.env, cvs.id, 1, 'queued', null);
    const after = await listClubOffers(fx.env.DB, 1);
    expect(after).toHaveLength(6); // 7 − 已签 1 + 排队 1 仍在列
    expect(after.map((o) => o.id)).toContain(cvs.id);
    expect(after.map((o) => o.id)).not.toContain(star.id);

    // 关轮（清盘 pending）⇒ 旧轮 pending 全变 expired 不再列；新轮 7 条 pending 照列，queued 恒列
    await openRound(fx.env, 1, 3);
    const settled = await listClubOffers(fx.env.DB, 1);
    expect(settled).toHaveLength(8);
    expect(settled.filter((o) => o.status === 'queued').map((o) => o.id)).toEqual([cvs.id]);
    expect(settled.filter((o) => o.status === 'pending')).toHaveLength(7);
    expect(settled.some((o) => o.id === star.id)).toBe(false);
    expect(round2.id).toBeLessThan((await getOpenRound(fx.env.DB))!.id);
  });

  it('TC-OFFER-11 已有冠名的队照收报价（合同不影响被投递）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const build = await buildRoundStatements(fx.env, 2, 1);
    await fx.env.DB.batch([...build.settleStatements, ...build.openStatements]);
    expect(build.offersPerClub.some((p) => p.clubId === 1)).toBe(true);
    const round = (await getOpenRound(fx.env.DB))!;
    expect(clubsOfferedFor(fx.sqlite, '亚马逊', round.id)).toEqual([1]);
    expect(clubsOfferedFor(fx.sqlite, 'CVS Health', round.id)).toEqual([1]);
  });
});

// ================= TC-ACCEPT：签约 / 接班 / 换签 =================

describe('签约与接班 acceptOffer（TC-ACCEPT）', () => {
  it('TC-ACCEPT-01 无约+开窗：全链路 signed，合同落库、热度 +deal、审计 naming_offer_accept', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);

    const out = await acceptOffer(fx.env, offerId, 1, undefined, null);
    expect(out.result).toBe('signed');
    expect(out.penalty).toBe(0);
    const contract = out.contract!;
    expect(contract.club_id).toBe(1);
    expect(contract.brand).toBe('可口可乐');
    expect(contract.status).toBe('active');
    expect(contract.started_season).toBe(1);
    expect(contract.started_window).toBe(1);
    expect(offerRow(fx.sqlite, offerId).status).toBe('accepted');
    expect(brandHeat(fx.sqlite, '可口可乐')).toBe(1.02);
    const audit = sqlGet<{ action: string; target_type: string; target_id: number; actor: number | null }>(
      fx.sqlite,
      'SELECT action, target_type, target_id, actor FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1',
      'naming_offer_accept',
    )!;
    expect(audit.target_type).toBe('market_offer');
    expect(audit.target_id).toBe(offerId);
    expect(audit.actor).toBeNull(); // 机器通道 actor=null（人类请求由 actor 传值）
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE club_id = 1 AND status = 'active'")).toBe(1);
  });

  it('TC-ACCEPT-02 报价不存在 404 / 不是给你们的 403', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    await rejectsHttp(acceptOffer(fx.env, 99999, 1, undefined, null), 404, '报价不存在');
    await rejectsHttp(acceptOffer(fx.env, offerId, 2, undefined, null), 403, '这份报价不是递给你们队的');
  });

  it('TC-ACCEPT-03 已过期 409 / 已处理 409（accepted、queued 同文案）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    fx.sqlite.exec(`UPDATE market_offers SET status = 'expired' WHERE id = ${offerId}`);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '报价已过期');
    fx.sqlite.exec(`UPDATE market_offers SET status = 'accepted' WHERE id = ${offerId}`);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '这份报价已处理过');
    fx.sqlite.exec(`UPDATE market_offers SET status = 'queued' WHERE id = ${offerId}`);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '这份报价已处理过');
  });

  it('TC-ACCEPT-04 TTL 过期：惰性置 expired 再 409，重读状态已落库', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    fx.sqlite.exec(`UPDATE market_offers SET expire_at = '2020-01-01T00:00:00.000Z' WHERE id = ${offerId}`);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '报价已过有效期');
    expect(offerRow(fx.sqlite, offerId).status).toBe('expired');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM naming_contracts')).toBe(0);
  });

  it('TC-ACCEPT-05 轮已关闭 409（报价仍 pending，不清状态不改库）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const roundId = await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    fx.sqlite.exec(`UPDATE market_rounds SET status = 'settled', settled_at = '2026-08-01T00:00:00Z' WHERE id = ${roundId}`);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '招商轮已关闭，签不了这份报价');
    expect(offerRow(fx.sqlite, offerId).status).toBe('pending');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM naming_contracts')).toBe(0);
  });

  it('TC-ACCEPT-06 无约且窗口没开 409', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    await seedOpenRound(fx.env); // 轮开着但没有窗口
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '转会窗口没开，签不了冠名合同');
  });

  it('TC-ACCEPT-07 已有生效冠名：mode 缺省/非法一律 400（文案逐字）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, '亚马逊', 2);
    const msg = '已有生效冠名：签新报价请选择「到期后自动接替」或「解约当前并签新」';
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 400, msg);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, 'bogus', null), 400, msg);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, null, null), 400, msg);
    expect(offerRow(fx.sqlite, offerId).status).toBe('pending');
  });

  it('TC-ACCEPT-08 接班分支：result=queued、contract=null、不落合同', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    const out = await acceptOffer(fx.env, offerId, 1, 'queued', null);
    expect(out.result).toBe('queued');
    expect(out.contract).toBeNull();
    expect(out.penalty).toBe(0);
    expect(offerRow(fx.sqlite, offerId).status).toBe('queued');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM naming_contracts')).toBe(1);
    const audit = sqlGet<{ action: string; after: string }>(
      fx.sqlite,
      'SELECT action, after FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1',
      'naming_offer_accept',
    )!;
    expect((JSON.parse(audit.after) as { queued: boolean }).queued).toBe(true);
  });

  it('TC-ACCEPT-09 并发抢锁三层：抢赢见合同、抢输 409 且零改行（热度不双加）', async () => {
    const src = readFileSync(MARKET_SRC, 'utf8');
    // ① 抢锁句本身（pending → accepted，顺带写批内归属令牌）；② 下游语句一律挂同一个 claim 守卫
    expect(src).toContain("UPDATE market_offers SET status = 'accepted', claim_token = ?");
    expect(src).toContain("WHERE id = ? AND status = 'pending'");
    expect(src).toContain('const claimGuard = `(SELECT claim_token FROM market_offers WHERE id = ?) = ?`;');
    // ② 合同 INSERT 守卫＝claim（terminate 分支再叠加 无 active + quotaGuard 尾；signed 把它上提到抢锁句）
    expect(src).toContain('WHERE ${claimGuard}${');
    expect(src).toContain(" AND NOT EXISTS (SELECT 1 FROM naming_contracts WHERE club_id = ? AND status = 'active')${quotaGuard}");
    expect(src).toContain("WHERE id = ? AND status = 'active' AND ${claimGuard}");
    expect(src).toContain("WHERE id = ? AND status = 'adopted' AND ${claimGuard}");
    expect(src).toContain('guardSql: claimGuard,');
    // 批后判定只剩抢锁一处（旧的「报价刚被处理过，请刷新」已退役）
    expect(src).toContain("throw new HttpError(409, '报价已被处理或条件已变化，请刷新后重试')");
    expect(src).not.toContain('报价刚被处理过，请刷新');

    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    const first = await acceptOffer(fx.env, offerId, 1, undefined, null);
    expect(first.result).toBe('signed');
    expect(brandHeat(fx.sqlite, '可口可乐')).toBe(1.02);
    const auditsAfterWin = countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'naming_offer_accept'");

    // 输方：pre-check 就撞 accepted；库里不得多一行合同、热度不得二次 +deal
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, undefined, null), 409, '这份报价已处理过');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM naming_contracts')).toBe(1);
    expect(brandHeat(fx.sqlite, '可口可乐')).toBe(1.02);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'naming_offer_accept'")).toBe(auditsAfterWin);
  });

  it('TC-ACCEPT-09B 抢锁守卫假 ⇒ 整批零落：批前冒出 active，合同/热度/审计一行不落', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    const heat0 = brandHeat(fx.sqlite, '可口可乐');
    // 预检已过、批提交前被抢先落下一纸 active：抢锁句守卫假 ⇒ claim 未写入 ⇒ 下游语句全挂同一令牌，整批零改行
    const env = racingEnv(fx, () => {
      fx.sqlite.exec(`INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name,
        fee_per_window, windows_total, windows_remaining, status, started_season, started_window, created_at, updated_at)
        VALUES (1, '海底捞', 0.9, 1.0, 1, '稳健', 0.85, 6, 6, 'active', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
    });
    await rejectsHttp(acceptOffer(env, offerId, 1, undefined, null), 409, '报价已被处理或条件已变化，请刷新后重试');
    expect(offerRow(fx.sqlite, offerId).status).toBe('pending');
    expect(sqlGet<{ claim_token: string }>(fx.sqlite, 'SELECT claim_token FROM market_offers WHERE id = ?', offerId)!.claim_token).toBe('');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM naming_contracts')).toBe(1); // 只有抢先那纸
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE brand = '可口可乐'")).toBe(0);
    expect(brandHeat(fx.sqlite, '可口可乐')).toBe(heat0); // 热度不 +deal
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'naming_offer_accept'")).toBe(0);
  });

  it('TC-ACCEPT-10 换签 terminate：解约赔款 = (剩窗−1)×窗费×0.3，账本 kind=naming_penalty', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const old = await signViaOffer(fx.env, 1, '星海通讯', 1);
    expect(old.windows_remaining).toBe(6);
    expect(old.fee_per_window).toBe(1.164); // round3(1.369×0.85)
    const offerId = await seedOffer(fx.env, 1, '亚马逊', 2);

    const out = await acceptOffer(fx.env, offerId, 1, 'terminate', 1);
    expect(out.result).toBe('terminated');
    expect(out.penalty).toBe(1.746); // round3(5 × 1.164 × 0.3)
    expect(out.contract!.brand).toBe('亚马逊');
    const terminated = sqlGet<{ status: string; ended_season: number; ended_window: number }>(
      fx.sqlite,
      'SELECT status, ended_season, ended_window FROM naming_contracts WHERE id = ?',
      old.id,
    )!;
    expect([terminated.status, terminated.ended_season, terminated.ended_window]).toEqual(['terminated', 1, 1]);
    const entry = sqlGet<{ kind: string; amount: number; ref_type: string; ref_id: number }>(
      fx.sqlite,
      "SELECT kind, amount, ref_type, ref_id FROM ledger_entries WHERE kind = 'naming_penalty'",
    )!;
    expect(entry.amount).toBe(-1.746);
    expect(entry.ref_type).toBe('offer'); // 幂等键＝本报价（重放不再赔）
    expect(entry.ref_id).toBe(offerId);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')!.balance).toBe(48.254);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE club_id = 1 AND status = 'active'")).toBe(1);
    // 审计 after 带 penalty（有赔款才带）
    const after = JSON.parse(
      sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'naming_offer_accept' ORDER BY id DESC LIMIT 1")!.after,
    ) as { penalty?: number };
    expect(after.penalty).toBe(1.746);
  });

  it('TC-ACCEPT-11 零赔款边界：只剩 1 窗 ⇒ penalty=0、不落账本', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const old = await signViaOffer(fx.env, 1, '星海通讯', 1);
    fx.sqlite.exec(`UPDATE naming_contracts SET windows_remaining = 1 WHERE id = ${old.id}`);
    const offerId = await seedOffer(fx.env, 1, '亚马逊', 2);
    const out = await acceptOffer(fx.env, offerId, 1, 'terminate', null);
    expect(out.result).toBe('terminated');
    expect(out.penalty).toBe(0);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_penalty'")).toBe(0);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')!.balance).toBe(50);
    const after = JSON.parse(
      sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'naming_offer_accept' ORDER BY id DESC LIMIT 1")!.after,
    ) as { penalty?: number };
    expect(after.penalty).toBeUndefined();
  });

  it('TC-ACCEPT-12 名额预检 409：文案带品牌、档位与上限', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '亚马逊', 2); // 头部名额 1 用满
    const offerId = await seedOffer(fx.env, 2, '亚马逊', 2);
    await rejectsHttp(acceptOffer(fx.env, offerId, 2, undefined, null), 409, '品牌「亚马逊」档位名额已满（头部档限 1 队）');
    expect(offerRow(fx.sqlite, offerId).status).toBe('pending');
  });

  it('TC-ACCEPT-13 quotaGuard：源码锁（含口碑不拼守卫的 bind 0 陷阱）+ 口碑可多队签', async () => {
    const src = readFileSync(MARKET_SRC, 'utf8');
    expect(src).toContain("const quotaParams = quota === null ? [] : [offer.brand_id, offer.brand_id, quota];");
    expect(src).toContain(
      " AND (SELECT COUNT(*) FROM naming_contracts WHERE brand = (SELECT brand FROM brand_pool WHERE id = ?) AND status = 'active')\n            + (SELECT COUNT(*) FROM market_offers WHERE brand_id = ? AND status = 'queued') < ?",
    );
    const idx = src.indexOf('const quotaGuard =');
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx, idx + 400);
    expect(tail).toContain('quota === null');
    expect(tail).toContain("? ''");

    // 口碑（quota=null）不得被拼上守卫：否则 bind 0 会让 COUNT < 0 恒假，第二队永远签不成
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 2, '星海通讯', 1);
    const out = await acceptOffer(fx.env, offerId, 2, undefined, null);
    expect(out.result).toBe('signed');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE brand = '星海通讯' AND status = 'active'")).toBe(2);
  });

  it('TC-ACCEPT-14 换签竞态不重复赔款：同一条报价再签只 409，赔款流水仍 1 条', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, '亚马逊', 2);
    const first = await acceptOffer(fx.env, offerId, 1, 'terminate', null);
    expect(first.penalty).toBe(1.746);
    await rejectsHttp(acceptOffer(fx.env, offerId, 1, 'terminate', null), 409, '这份报价已处理过');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_penalty'")).toBe(1);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')!.balance).toBe(48.254);
  });

  it('TC-ACCEPT-15 弃用品牌仍可签（存量报价兑现），但热度不再加', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '亚马逊', 2);
    fx.sqlite.exec("UPDATE brand_pool SET status = 'discarded' WHERE brand = '亚马逊'");
    const out = await acceptOffer(fx.env, offerId, 1, undefined, null);
    expect(out.result).toBe('signed');
    expect(out.contract!.brand).toBe('亚马逊');
    expect(brandHeat(fx.sqlite, '亚马逊')).toBe(1.3); // WHERE status = 'adopted' 挡住 deal
  });

  it('TC-ACCEPT-09C 换签赔款守卫与幂等：claim 挂账本闸、幂等键＝本报价（同键重放不双赔）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, '亚马逊', 2);
    const out = await acceptOffer(fx.env, offerId, 1, 'terminate', null);
    expect(out.penalty).toBe(1.746);
    const src = readFileSync(MARKET_SRC, 'utf8');
    // 赔款流水：幂等键＝本报价 + claim 守卫（抢锁输方本批不入账）
    expect(src).toContain("refType: 'offer',");
    expect(src).toContain('idempotent: true,');
    expect(src).toContain('guardSql: claimGuard,');
    const entry = sqlGet<{ ref_type: string; ref_id: number }>(
      fx.sqlite,
      "SELECT ref_type, ref_id FROM ledger_entries WHERE kind = 'naming_penalty'",
    )!;
    expect([entry.ref_type, entry.ref_id]).toEqual(['offer', offerId]);
    // 同键重放（同批重放/重复提交）：按同 (kind, ref_type, ref_id, club_id) 再走一遍 ledgerMovement，整段不动
    const before = sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')!.balance;
    const replay = await fx.env.DB.batch(
      ledgerMovement(fx.env.DB, {
        clubId: 1,
        delta: -1.746,
        kind: 'naming_penalty',
        refType: 'offer',
        refId: offerId,
        memo: '换签解约赔款（同键重放）',
      }),
    );
    expect(replay.map((o) => o.meta.changes)).toEqual([0, 0]);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')!.balance).toBe(before);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_penalty'")).toBe(1);
  });
});

// ================= TC-QUEUED：接班转正 =================

describe('接班转正 activateQueuedStatements（TC-QUEUED）', () => {
  it('TC-QUEUED-01 转正全链路：按 package_json 快照入合同、offer 置 accepted、审计 naming_activated', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const old = await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, offerId, 1, 'queued', null);

    // 旧约到期（收租批已把它 expire）
    fx.sqlite.exec(`UPDATE naming_contracts SET status = 'expired' WHERE id = ${old.id}`);
    const activation = await activateQueuedStatements(fx.env, 2, 1, 'user', null);
    expect(activation.activated).toHaveLength(1);
    await fx.env.DB.batch(activation.statements);

    const contract = (await getActiveNaming(fx.env.DB, 1))!;
    expect(contract.brand).toBe('CVS Health');
    expect(contract.base_fee).toBe(1.105); // 快照底价：CVS heat 0.7 × 医疗系数 1.2
    expect(contract.fee_per_window).toBe(0.939); // 口碑档稳健 = round3(1.105 × 0.85)，取自报价 amount
    expect(contract.brand_heat).toBe(0.7);
    expect(contract.pkg_name).toBe('稳健');
    expect(contract.windows_total).toBe(6);
    expect(contract.windows_remaining).toBe(6);
    expect(contract.started_season).toBe(2);
    expect(activation.activated[0]).toMatchObject({ clubId: 1, offerId, brand: 'CVS Health', windows: 6, pkgName: '稳健' });
    // 缺陷 A 已修（2026-09-29）：批内顺序改为 offer 占坑（queued→accepted）→ 合同 INSERT（守卫 offer='accepted'）→ 审计
    expect(offerRow(fx.sqlite, offerId).status).toBe('accepted');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'naming_activated'")).toBe(1);
  });

  it('TC-QUEUED-02 仍有 active 的队跳过（语句照生成、执行期零改行、留在 queued）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, offerId, 1, 'queued', null);
    const activation = await activateQueuedStatements(fx.env, 1, 2, 'user', null);
    // 评审 P1-3：语句一律生成（3 条：占坑 / 合同 / 审计），落不落由执行期「本队无 active」守卫决定
    expect(activation.statements).toHaveLength(3);
    expect(activation.activated).toHaveLength(0);
    const outs = await fx.env.DB.batch(activation.statements);
    expect(outs.map((o) => o.meta.changes)).toEqual([0, 0, 0]);
    expect(offerRow(fx.sqlite, offerId).status).toBe('queued');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE brand = 'CVS Health'")).toBe(0);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'naming_activated'")).toBe(0);
    expect((await getActiveNaming(fx.env.DB, 1))!.brand).toBe('星海通讯');
  });

  it('TC-QUEUED-03 同队双接班：预检给可读 409（uq_market_offer_queued 仍是竞态最终防线）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerA = await seedOffer(fx.env, 1, 'CVS Health', 1);
    const offerB = await seedOffer(fx.env, 1, '亚马逊', 2);
    await acceptOffer(fx.env, offerA, 1, 'queued', null);
    // 口碑不限额 ⇒ 名额守卫过得去，闸门是「同队已有 queued」；评审 P1-1：直撞唯一索引是 500，先预检给 409
    await rejectsHttp(acceptOffer(fx.env, offerB, 1, 'queued', null), 409, '已有一份待接替报价，先处理它再排新的');
    expect(offerRow(fx.sqlite, offerB).status).toBe('pending');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM market_offers WHERE club_id = 1 AND status = 'queued'")).toBe(1);
    const sql = readFileSync('src/db/migrations/0055_market_rounds.sql', 'utf8');
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_market_offer_queued ON market_offers (club_id) WHERE status = 'queued';");
    const src = readFileSync(MARKET_SRC, 'utf8');
    expect(src).toContain("SELECT 1 AS n FROM market_offers WHERE club_id = ? AND status = 'queued' AND id <> ? LIMIT 1");
    expect(src).toContain("throw new HttpError(409, '已有一份待接替报价，先处理它再排新的')");
  });

  it('TC-QUEUED-04 转正不超卖：active+queued 总数守恒、绝不同时两纸 active', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const old = await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, offerId, 1, 'queued', null);
    fx.sqlite.exec(`UPDATE naming_contracts SET status = 'expired' WHERE id = ${old.id}`);
    const before =
      countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE club_id = 1 AND status = 'active'") +
      countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM market_offers WHERE club_id = 1 AND status = 'queued'");
    expect(before).toBe(1);
    const activation = await activateQueuedStatements(fx.env, 1, 2, 'user', null);
    await fx.env.DB.batch(activation.statements);
    const after =
      countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE club_id = 1 AND status = 'active'") +
      countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM market_offers WHERE club_id = 1 AND status = 'queued'");
    // 转正后 queued 位释放：合并计数守恒（active 1 + queued 0 = 转正前 1），任何时刻至多一纸 active
    expect(after).toBe(1);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE club_id = 1 AND status = 'active'")).toBe(1);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM market_offers WHERE club_id = 1 AND status = 'queued'")).toBe(0);
    expect(
      countOf(
        fx.sqlite,
        "SELECT COUNT(*) AS n FROM (SELECT club_id FROM naming_contracts WHERE status = 'active' GROUP BY club_id HAVING COUNT(*) > 1)",
      ),
    ).toBe(0);
  });

  it('TC-QUEUED-05 单队范围：clubIds=[1] 不碰别队的排队位；全量调用才转正', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const a1 = await signViaOffer(fx.env, 1, '星海通讯', 1);
    const a2 = await signViaOffer(fx.env, 2, '星海通讯', 1);
    const q1 = await seedOffer(fx.env, 1, 'CVS Health', 1);
    const q2 = await seedOffer(fx.env, 2, 'CVS Health', 1);
    await acceptOffer(fx.env, q1, 1, 'queued', null);
    await acceptOffer(fx.env, q2, 2, 'queued', null);
    fx.sqlite.exec(`UPDATE naming_contracts SET status = 'expired' WHERE id IN (${a1.id}, ${a2.id})`);

    const scoped = await activateQueuedStatements(fx.env, 1, 2, 'user', 1, [1]);
    expect(scoped.activated.map((a) => a.clubId)).toEqual([1]);
    await fx.env.DB.batch(scoped.statements);
    expect((await getActiveNaming(fx.env.DB, 1))!.brand).toBe('CVS Health'); // 只有队 1 转正
    expect(await getActiveNaming(fx.env.DB, 2)).toBeNull(); // 别队不受影响
    expect(offerRow(fx.sqlite, q2).status).toBe('queued');

    const all = await activateQueuedStatements(fx.env, 1, 2, 'user', null);
    expect(all.activated.map((a) => a.clubId)).toEqual([2]);
    await fx.env.DB.batch(all.statements);
    expect((await getActiveNaming(fx.env.DB, 2))!.brand).toBe('CVS Health');
    expect(offerRow(fx.sqlite, q1).status).toBe('accepted');
    expect(offerRow(fx.sqlite, q2).status).toBe('accepted');
    const src = readFileSync(MARKET_SRC, 'utf8');
    expect(src).toContain("` AND o.club_id IN (${clubIds.map(() => '?').join(',')})`");
  });

  it('TC-QUEUED-06 批尾时点：同批刚到期者本批即转正（语句无条件生成、执行期守卫放行）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const old = await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, offerId, 1, 'queued', null);
    fx.sqlite.exec(`UPDATE naming_contracts SET windows_remaining = 1 WHERE id = ${old.id}`);
    const contract = sqlGet<NamingContractRow>(fx.sqlite, 'SELECT * FROM naming_contracts WHERE id = ?', old.id)!;

    // 评审 P1-3：转正语句不再按构建期 active 过滤——语句一律生成（3 条），批内顺序
    // 「收租 expire 旧约在前、转正语句在后」⇒ 同一批里刚到期的队当批即转正
    const sameBatch = await activateQueuedStatements(fx.env, 1, 1, 'user', null);
    expect(sameBatch.statements).toHaveLength(3);
    // 构建期仍读到 active ⇒ 不进通知列表（通知只喂「已腾清」的队，避免假通知）
    expect(sameBatch.activated).toHaveLength(0);
    const rent = await windowNamingStatements(fx.env, contract, 1, 1, 0.9, 0.01);
    await fx.env.DB.batch([...rent, ...sameBatch.statements]);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM naming_contracts WHERE id = ?', old.id)!.status).toBe('expired');
    expect(offerRow(fx.sqlite, offerId).status).toBe('accepted');
    expect((await getActiveNaming(fx.env.DB, 1))!.brand).toBe('CVS Health');
  });

  it('TC-QUEUED-07 并发守卫：批前冒出 active ⇒ 合同不落、offer 不转正、审计不落', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, offerId, 1, 'queued', null);
    // 转正语句构建时把 old 置 expired ⇒ 拿到语句
    const old = (await getActiveNaming(fx.env.DB, 1))!;
    fx.sqlite.exec(`UPDATE naming_contracts SET status = 'expired' WHERE id = ${old.id}`);
    const activation = await activateQueuedStatements(fx.env, 1, 2, 'user', null);
    expect(activation.statements).toHaveLength(3);
    // 构建之后、提交之前：并发又插了一纸 active（模拟退约路径/另一次关窗批抢先）
    const winner = await seedOffer(fx.env, 1, '海底捞', 1);
    await acceptOffer(fx.env, winner, 1, undefined, null);

    await fx.env.DB.batch(activation.statements);
    expect((await getActiveNaming(fx.env.DB, 1))!.brand).toBe('海底捞');
    expect(offerRow(fx.sqlite, offerId).status).toBe('queued');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM naming_contracts WHERE brand = 'CVS Health'")).toBe(0);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'naming_activated'")).toBe(0);
    const src = readFileSync(MARKET_SRC, 'utf8');
    expect(src).toContain('WHERE NOT EXISTS (SELECT 1 FROM naming_contracts WHERE club_id = ? AND status = \'active\')');
    expect(src).toContain("AND (SELECT status FROM market_offers WHERE id = ?) = 'accepted'");
  });

  it('TC-QUEUED-08 parsePkgJson 兜底：坏 JSON/缺字段逐字段回退（pkgName 按 package_no、baseFee 按 amount）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    seedClub(fx.sqlite, 3);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    // 先有约才能排队；三队旧约品牌互不相同（口碑档不限额，避开头部/新兴 quota）
    const cases = [
      {
        club: 1,
        oldBrand: '海底捞',
        queued: '星海通讯',
        pkgNo: 1,
        amount: 1.111,
        broken: 'not-json',
        wantPkg: '稳健',
        wantBase: 1.111,
      },
      {
        club: 2,
        oldBrand: '可口可乐',
        queued: 'CVS Health',
        pkgNo: 2,
        amount: 2.222,
        broken: '{"baseFee": 2.5}',
        wantPkg: '进取',
        wantBase: 2.5,
      },
      {
        club: 3,
        oldBrand: '星海通讯',
        queued: '亚马逊',
        pkgNo: 3,
        amount: 3.333,
        broken: '{"brandHeat": "x", "bonusAmount": null}',
        wantPkg: '对赌',
        wantBase: 3.333,
      },
    ];
    for (const c of cases) {
      await signViaOffer(fx.env, c.club, c.oldBrand, 1);
      const id = await seedOffer(fx.env, c.club, c.queued, c.pkgNo);
      await acceptOffer(fx.env, id, c.club, 'queued', null);
      fx.sqlite.exec(
        `UPDATE market_offers SET package_json = '${c.broken}', amount = ${c.amount}, windows = 4 WHERE id = ${id}`,
      );
    }
    // 三队旧约一起退掉，让 queued 全部转正
    fx.sqlite.exec("UPDATE naming_contracts SET status = 'expired' WHERE status = 'active'");
    const activation = await activateQueuedStatements(fx.env, 3, 1, 'user', null);
    expect(activation.activated).toHaveLength(3);
    await fx.env.DB.batch(activation.statements);

    for (const c of cases) {
      const contract = (await getActiveNaming(fx.env.DB, c.club))!;
      expect(contract.brand).toBe(c.queued);
      expect(contract.pkg_name).toBe(c.wantPkg); // pkgName 缺失/非字符串 ⇒ 按 package_no 兜底
      expect(contract.fee_per_window).toBe(c.amount); // 窗口费恒取报价 amount（不走快照）
      expect(contract.base_fee).toBe(c.wantBase); // baseFee 缺失/非数 ⇒ amount 兜底
      expect(contract.bonus_amount).toBe(0);
      expect(contract.bet_attend).toBeNull();
      expect(contract.bet_fans).toBeNull();
      expect(contract.brand_heat).toBe(1); // brandHeat 缺失/非数 ⇒ 1
      expect(contract.windows_total).toBe(4);
    }
  });
});

// ================= TC-SPAWN：品牌上门递价 =================

describe('品牌上门递价 spawnVisitOffer（TC-SPAWN）', () => {
  it('TC-SPAWN-01 成功递价：稳健套餐、金额=底价×行业系数、notes 文案', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const occ = seedOccurrence(fx.sqlite);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied).toEqual({ brand: '麒麟生物', amount: 1.611, windows: 6 });
    expect(spawn.notes).toEqual(['品牌「麒麟生物」上门递价：1.611M/窗 × 6 窗（稳健），冠名市场可签']);
    expect(spawn.statements).toHaveLength(0); // 独立执行，不进 occurrence 批
    const row = sqlGet<OfferRow>(
      fx.sqlite,
      `SELECT o.* FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id WHERE b.brand = '麒麟生物'`,
    )!;
    expect([row.status, row.package_no, row.windows, row.amount]).toEqual(['pending', 1, 6, 1.611]);
    const snap = JSON.parse(row.package_json) as { pkgName: string; baseFee: number; brandHeat: number };
    expect(snap).toMatchObject({ pkgName: '稳健', baseFee: 1.895, brandHeat: 1.2 });
    expect(row.expire_at).not.toBe('9999-12-31T00:00:00.000Z'); // 默认 72h
  });

  it('TC-SPAWN-02 无 open 轮：落空且不写库', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const occ = seedOccurrence(fx.sqlite);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied).toBeNull();
    expect(spawn.notes).toEqual(['当前无开放招商轮次，品牌上门落空']);
    expect(offerRows(fx.sqlite)).toHaveLength(0);
  });

  it('TC-SPAWN-03 候选空：品牌池没有可上门品牌', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    fx.sqlite.exec("UPDATE brand_pool SET status = 'discarded'");
    const occ = seedOccurrence(fx.sqlite);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied).toBeNull();
    expect(spawn.notes).toEqual(['品牌池里没有可上门的品牌，本次落空']);
  });

  it('TC-SPAWN-04 唯一键去重：同轮同队同品牌已有报价（pending/queued 皆然）⇒ 落空不抛', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await seedOffer(fx.env, 1, '麒麟生物', 1);
    const occ = seedOccurrence(fx.sqlite);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied).toBeNull();
    expect(spawn.notes).toEqual(['品牌「麒麟生物」已有待处理的上门报价，本次落空']);
    expect(offerRows(fx.sqlite)).toHaveLength(1);

    // 评审 P1-2：去重子查询去掉 status 谓词后与 idx_market_offers_round 同口径——
    // 旧行已是 queued/accepted 也照样落空（否则重发会直撞唯一索引报 500）
    const fx2 = freshEnv({ rng: () => 0 });
    seedClub(fx2.sqlite);
    openWindow(fx2.sqlite);
    await seedOpenRound(fx2.env);
    await signViaOffer(fx2.env, 1, '海底捞', 1); // 有约才能排接班；海底捞有 active ⇒ 不在候选池
    const queuedId = await seedOffer(fx2.env, 1, '麒麟生物', 1);
    await acceptOffer(fx2.env, queuedId, 1, 'queued', null);
    const occ2 = seedOccurrence(fx2.sqlite);
    const spawn2 = await spawnVisitOffer(fx2.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ2, PENDING_GUARD);
    expect(spawn2.applied).toBeNull();
    expect(spawn2.notes).toEqual(['品牌「麒麟生物」已有待处理的上门报价，本次落空']);
    expect(offerRows(fx2.sqlite)).toHaveLength(2); // 海底捞 + 麒麟生物排队报价，没有新行
    const src = readFileSync(MARKET_SRC, 'utf8');
    expect(src).toContain('SELECT 1 FROM market_offers WHERE round_id = ? AND brand_id = ? AND club_id = ?');
  });

  it('TC-SPAWN-05 热度 0 的品牌权重 0（env.rng 注入决定抽签，不落 Math.random）', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    fx.sqlite.exec("UPDATE brand_pool SET heat = 0 WHERE brand = '麒麟生物'");
    const occ = seedOccurrence(fx.sqlite);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied?.brand).toBe('阿迪达斯'); // 权重 0 被跳过（首个正权重品牌）
    const src = readFileSync(MARKET_SRC, 'utf8');
    expect(src).toContain('const rng = env.rng ?? Math.random;');
    expect(src).toContain('const total = candidates.reduce((s, b) => s + Math.max(b.heat, 0), 0);');
  });

  it('TC-SPAWN-06 requires_no_naming 条件层：有冠名的队不候选，无冠名才过', () => {
    expect(conditionOk(ctxOf(), { requires_no_naming: true })).toBe(true);
    expect(conditionOk(ctxOf({ brand: '可口可乐' }), { requires_no_naming: true })).toBe(false);
    // 计数型条件不受影响（回归：别把 no_naming 写成反向恒真）
    expect(conditionOk(ctxOf({ brand: '可口可乐' }), { requires_naming: true })).toBe(true);
    // 池里只有 brand_visit 时，抽签结果完全由条件层决定
    const pool = [eventRowOf()];
    expect(pickEvent(pool, ctxOf({ brand: '可口可乐' }), EVENT_RULES_DEFAULT, () => 0, {})).toBeNull();
    expect(pickEvent(pool, ctxOf(), EVENT_RULES_DEFAULT, () => 0, {})?.event_id).toBe('brand_visit');
    const src = readFileSync(EVENT_SRC, 'utf8');
    expect(src).toContain('if (cond.requires_no_naming === true && ctx.brand !== null) return false;');
  });

  it('TC-SPAWN-07 弃用品牌不候选 + 已有 active 冠名的品牌不候选', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    fx.sqlite.exec("UPDATE brand_pool SET status = 'discarded' WHERE brand IN ('麒麟生物', '亚马逊', '可口可乐', '海底捞')");
    await signViaOffer(fx.env, 2, '阿迪达斯', 1); // 队 2 有 active 阿迪达斯
    const occ = seedOccurrence(fx.sqlite);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied?.brand).toBe('星海通讯'); // 阿迪达斯被 active 挡住，弃用的不候选
  });

  it('TC-SPAWN-08 occurrence PENDING_GUARD：occurrence 非 pending ⇒ 不写库', async () => {
    const fx = freshEnv({ rng: () => 0 });
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const occ = seedOccurrence(fx.sqlite);
    fx.sqlite.exec(`UPDATE event_occurrences SET status = 'resolved' WHERE id = ${occ}`);
    const spawn = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, occ, PENDING_GUARD);
    expect(spawn.applied).toBeNull();
    expect(spawn.notes[0]).toContain('已有待处理的上门报价'); // 0 改行与去重同一条回执
    expect(offerRows(fx.sqlite)).toHaveLength(0);
    expect(readFileSync(EVENT_SRC, 'utf8')).toContain(
      "const PENDING_GUARD = `(SELECT status FROM event_occurrences WHERE id = ?) = 'pending'`;",
    );
  });

  it('TC-SPAWN-09 0056 种子入池：brand_visit 权重 5、即发型、条件/效果就位；重放幂等', async () => {
    const fx = freshEnv();
    const row = sqlGet<EventRow>(
      fx.sqlite,
      'SELECT * FROM event_pool WHERE event_id = ?',
      'brand_visit',
    )!;
    expect(row.weight).toBe(5);
    expect(row.event_type).toBe('instant');
    expect(row.conditions_json).toBe('{"requires_no_naming":true}');
    expect(row.effects_json).toBe('{"offer_spawn":1}');
    expect(row.source).toBe('builtin');
    expect(row.status).toBe('adopted');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM event_pool')).toBe(31);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM event_pool WHERE event_type = 'instant'")).toBe(9);

    runMigration(fx.sqlite, '0056_event_seed_brand_visit.sql');
    expect(countOf(fx.sqlite, 'SELECT COUNT(*) AS n FROM event_pool')).toBe(31);
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM event_pool WHERE event_id = 'brand_visit'")).toBe(1);
  });

  it('TC-SPAWN-10 seededUnit 确定性：同种子同结果、取值落在 [0,1)', () => {
    const a = seededUnit([1, 1], 0);
    expect(a).toBe(seededUnit([1, 1], 0));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(seededUnit([2, 1], 0)).not.toBe(a);
    expect(seededUnit([1, 1], 1)).not.toBe(a);
    // 调用点也必须用种子抽签：纯函数断言测不出调用点被换成 Math.random（变异验证 M16 首轮空转后补强）
    expect(readFileSync(EVENT_SRC, 'utf8')).toContain('let x = seededUnit([occurrenceId, choiceNo], 0) * total;');
  });

  it('TC-SPAWN-11 PENDING_EFFECT_KEYS 只含 none：offer_spawn 不标「尚未生效」', () => {
    expect(describeEffect('offer_spawn', 1, true)).toBe('品牌上门递价（挂当前招商轮）');
    const src = readFileSync(EVENT_SRC, 'utf8');
    expect(src).toContain("const PENDING_EFFECT_KEYS = new Set<string>(['none']);");
  });
});

// ================= TC-CFG：配置 =================

describe('招商轮配置（TC-CFG）', () => {
  it('TC-CFG-01 CONFIG_KEYS 共 75 项，两个 market 键在册；默认值就位', async () => {
    expect(CONFIG_KEYS).toHaveLength(75);
    expect(CONFIG_KEYS).toContain('market_round_rules');
    expect(CONFIG_KEYS).toContain('market_heat_rules');
    const fx = freshEnv();
    expect(await loadRoundRules(fx.env.DB)).toEqual({ offersPerBrand: 3, offerTtlHours: 72 });
    const heat = await loadHeatRules(fx.env.DB);
    expect([heat.deal, heat.ignored, heat.clampLow, heat.clampHigh]).toEqual([0.02, -0.03, 0.5, 1.5]);
  });

  it('TC-CFG-02 loadRoundRules 逐字段兜底：非法/越界回默认，合法小数截断', async () => {
    const fx = freshEnv();
    setConfig(fx.sqlite, 'market_round_rules', { offersPerBrand: 0, offerTtlHours: -5 });
    expect(await loadRoundRules(fx.env.DB)).toEqual({ offersPerBrand: 3, offerTtlHours: 72 });
    setConfig(fx.sqlite, 'market_round_rules', { offersPerBrand: 2.9, offerTtlHours: 12.5 });
    expect(await loadRoundRules(fx.env.DB)).toEqual({ offersPerBrand: 2, offerTtlHours: 12.5 });
    setConfig(fx.sqlite, 'market_round_rules', { offersPerBrand: 'abc', offerTtlHours: 'abc' });
    expect(await loadRoundRules(fx.env.DB)).toEqual({ offersPerBrand: 3, offerTtlHours: 72 });
    // 边界（实现如此）：null 经 Number() 变 0 ⇒ 落到「0 = 不设时限」，不是回默认
    setConfig(fx.sqlite, 'market_round_rules', { offersPerBrand: 'abc', offerTtlHours: null });
    expect(await loadRoundRules(fx.env.DB)).toEqual({ offersPerBrand: 3, offerTtlHours: 0 });
    setConfig(fx.sqlite, 'market_round_rules', { offersPerBrand: 1, offerTtlHours: 0 });
    expect(await loadRoundRules(fx.env.DB)).toEqual({ offersPerBrand: 1, offerTtlHours: 0 });
  });

  it('TC-CFG-03 deal/ignored 都在 SQL 侧钳 [0.5,1.5] 且 round3', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    fx.sqlite.exec("UPDATE brand_pool SET heat = 1.49 WHERE brand = '亚马逊'");
    const amazon = await seedOffer(fx.env, 1, '亚马逊', 2);
    await acceptOffer(fx.env, amazon, 1, undefined, null);
    expect(brandHeat(fx.sqlite, '亚马逊')).toBe(1.5); // 1.51 → 上钳

    fx.sqlite.exec("UPDATE brand_pool SET heat = 1.0045 WHERE brand = '阿迪达斯'");
    await seedOffer(fx.env, 1, '阿迪达斯', 1);
    await openRound(fx.env, 1, 2);
    expect(brandHeat(fx.sqlite, '阿迪达斯')).toBe(0.974); // ROUND(1.0045−0.03, 3)：浮点 0.9745 → 0.974
    // 「已签 ⇒ 清盘不扣」的豁免归 TC-ROUND-07C 专测（此处不重复断言，避免变异归因串台）
  });
});

// ================= TC-ROUTE：路由冒烟 =================

describe('冠名市场与招商轮路由（TC-ROUTE）', () => {
  const getAs = (path: string, env: Env, cookie = 'whl_session=tok-coach') =>
    app.request(path, { headers: { Cookie: cookie } }, env);
  const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-coach') =>
    app.request(
      path,
      {
        method,
        headers: { 'content-type': 'application/json', Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  it('TC-ROUTE-01 GET /club/naming/quote：有约带 contract/renewal/offers，无约只带 offers，未绑队 403', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindCoach(fx.sqlite, 1);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const bare = await getAs('/api/club/naming/quote', fx.env);
    expect(bare.status).toBe(200);
    const bareBody = (await bare.json()) as { contract?: unknown; offers: unknown[] };
    expect(bareBody.contract).toBeUndefined();
    expect(bareBody.offers).toEqual([]);

    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const offerId = await seedOffer(fx.env, 1, 'CVS Health', 1);
    const withContract = await getAs('/api/club/naming/quote', fx.env);
    const body = (await withContract.json()) as {
      contract: { brand: string; tier: string; satisfyFloor: number; windowsRemaining: number };
      renewal: unknown;
      offers: { id: number; brand: string; tier: string; amount: number; status: string }[];
    };
    expect(body.contract.brand).toBe('星海通讯');
    expect(body.contract.tier).toBe('口碑');
    expect(body.contract.satisfyFloor).toBeGreaterThan(0);
    expect(body.renewal).not.toBeNull();
    expect(body.offers.map((o) => o.id)).toContain(offerId);
    expect(body.offers[0]!.tier).toBe('口碑');

    const unbound = await getAs('/api/club/naming/quote', fx.env, 'whl_session=tok-admin');
    expect(unbound.status).toBe(403);
    expect(((await unbound.json()) as { error: string }).error).toBe('先绑定俱乐部再谈冠名');
    expect((await getAs('/api/club/naming/quote', fx.env, 'whl_session=none')).status).toBe(401);
  });

  it('TC-ROUTE-02 POST accept：权限、id 非法 400、成功 201 返回 result/penalty/contract', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindCoach(fx.sqlite, 1);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    const offerId = await seedOffer(fx.env, 1, '可口可乐', 1);
    expect((await send('POST', '/api/club/naming/offers/abc/accept', fx.env, {})).status).toBe(400);
    expect(
      (((await (await send('POST', '/api/club/naming/offers/0/accept', fx.env, {})).json()) as { error: string }).error),
    ).toBe('报价 id 不合法');
    expect((await send('POST', `/api/club/naming/offers/${offerId}/accept`, fx.env, {}, 'whl_session=none')).status).toBe(401);
    expect((await send('POST', `/api/club/naming/offers/${offerId}/accept`, fx.env, {}, 'whl_session=tok-admin')).status).toBe(403);

    const ok = await send('POST', `/api/club/naming/offers/${offerId}/accept`, fx.env, {});
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { result: string; penalty: number; contract: { brand: string; status: string } };
    expect(body.result).toBe('signed');
    expect(body.penalty).toBe(0);
    expect(body.contract.brand).toBe('可口可乐');
    expect(body.contract.status).toBe('active');
    // 已处理过 ⇒ 409 文案透传
    const again = await send('POST', `/api/club/naming/offers/${offerId}/accept`, fx.env, {});
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe('这份报价已处理过');
  });

  it('TC-ROUTE-03 旧直签端点 /club/naming/sign 已下线（404）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindCoach(fx.sqlite, 1);
    openWindow(fx.sqlite);
    const res = await send('POST', '/api/club/naming/sign', fx.env, { brand: '可口可乐', packageNo: 1 });
    expect(res.status).toBe(404);
  });

  it('TC-ROUTE-04 GET /admin/brands/market-round：open 优先、offers 全状态流水；权限校验', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    seedClub(fx.sqlite, 2);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const q = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, q, 1, 'queued', null);
    const pending = await seedOffer(fx.env, 1, '亚马逊', 2);

    const res = await getAs('/api/admin/brands/market-round', fx.env, 'whl_session=tok-admin');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      round: { id: number; status: string };
      offers: { id: number; status: string; brand: string; club_name: string | null }[];
    };
    expect(body.round.status).toBe('open');
    expect(body.round.id).toBe((await getOpenRound(fx.env.DB))!.id);
    expect(body.offers.map((o) => o.id)).toEqual(expect.arrayContaining([q, pending]));
    expect(new Set(body.offers.map((o) => o.status))).toEqual(new Set(['accepted', 'queued', 'pending']));
    expect(body.offers.find((o) => o.id === pending)!.club_name).toBe('俱乐部1');
    expect((await getAs('/api/admin/brands/market-round', fx.env)).status).toBe(403);
    expect((await getAs('/api/admin/brands/market-round', fx.env, 'whl_session=none')).status).toBe(401);
  });

  it('TC-ROUTE-05 POST reopen：批=清盘+开轮+审计；无窗 409', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    openWindow(fx.sqlite);
    const round1 = await seedOpenRound(fx.env);
    const pending = await seedOffer(fx.env, 1, '麒麟生物', 1);
    const noWindow = await send('POST', '/api/admin/brands/market-round/reopen', fx.env, {}, 'whl_session=tok-admin');
    expect(noWindow.status).toBe(200);
    const body = (await noWindow.json()) as { ok: boolean; hadOpenRound: boolean; offerCount: number };
    expect(body.ok).toBe(true);
    expect(body.hadOpenRound).toBe(true);
    expect(body.offerCount).toBe(7);
    expect(offerRow(fx.sqlite, pending).status).toBe('expired');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM market_rounds WHERE id = ?', round1)!.status).toBe('settled');
    expect(countOf(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'market_round_reopen'")).toBe(1);

    // 关掉窗口再开 ⇒ 409
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1");
    const closed = await send('POST', '/api/admin/brands/market-round/reopen', fx.env, {}, 'whl_session=tok-admin');
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { error: string }).error).toBe('当前没有开着的窗口，开不了招商轮');
  });

  it('TC-ROUTE-06 POST /club/naming/terminate：退约后该队 queued 立即转正并发通知', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    bindCoach(fx.sqlite, 1);
    openWindow(fx.sqlite);
    await seedOpenRound(fx.env);
    await signViaOffer(fx.env, 1, '星海通讯', 1);
    const queuedOffer = await seedOffer(fx.env, 1, 'CVS Health', 1);
    await acceptOffer(fx.env, queuedOffer, 1, 'queued', null);

    const res = await send('POST', '/api/club/naming/terminate', fx.env, {});
    expect(res.status).toBe(201);
    expect((await getActiveNaming(fx.env.DB, 1))!.brand).toBe('CVS Health');
    expect(offerRow(fx.sqlite, queuedOffer).status).toBe('accepted');
    const notification = sqlGet<{ template: string; payload: string; user_id: number }>(
      fx.sqlite,
      "SELECT template, payload, user_id FROM notifications WHERE template = 'naming_offer_activated' ORDER BY id DESC LIMIT 1",
    )!;
    expect(notification.user_id).toBe(1);
    expect((JSON.parse(notification.payload) as { text: string }).text).toBe(
      '✅ 品牌接替生效：「CVS Health」冠名 俱乐部1 正式生效（稳健套餐，0.939M/窗 × 6 窗）。',
    );
  });

  it('TC-ROUTE-07 通知文案逐字；关窗批回滚不发假通知（源码锁）', () => {
    expect(renderNotification('naming_offer', { club: '阿森纳', count: 2, brands: '亚马逊、麒麟生物' })).toBe(
      '📣 招商期开启：阿森纳 收到 2 份品牌报价（亚马逊、麒麟生物），去「冠名市场」查看签约。',
    );
    expect(
      renderNotification('naming_offer_activated', {
        club: '阿森纳',
        brand: '亚马逊',
        pkgName: '进取',
        feePerWindow: 2.78,
        windows: 2,
      }),
    ).toBe('✅ 品牌接替生效：「亚马逊」冠名 阿森纳 正式生效（进取套餐，2.78M/窗 × 2 窗）。');
    orderInSource(
      readFileSync(MACHINE_SRC, 'utf8'),
      "if ((results[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '窗口刚被关过了');",
      'for (const n of home.notifications) {',
      'await queueClubNotification(env, n.clubId, n.template, n.data);',
    );
    expect(readFileSync(HOME_SRC, 'utf8')).toContain("template: 'naming_offer_activated',");
  });
});
