// v6.84.0 转 CPU 不入账：关窗批（home.ts）与事件触发批（event-ops.ts）的 CPU 豁免。
// 口径见 docs/superpowers/specs/2026-11-11-player-to-cpu-detach-design.md §6.7：
// CPU 队只推进 fans_window_start，不生成维护费/冠名收租/档期结算/涨粉演化语句，也不计入 summary；
// 事件默认/显式/混合目标集都不跑 CPU，显式全为 CPU 时返回 0（不静默改选其他队）。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { applyMigrations, authRegisterClubTeam, createAuthDb, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { windowHomeStatements } from '../src/worker/home.ts';
import { triggerEventBatch } from '../src/worker/event-ops.ts';

function freshEnv() {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  const { sqlite: authSqlite, d1: authD1 } = createAuthDb();
  const env = {
    DB: createTestD1(sqlite),
    AUTH_DB: authD1,
    TOUR_DB: createTestD1(tour),
    rng: () => 0.5,
  } as unknown as Env;
  return { env, sqlite, auth: authSqlite, tour };
}

type Fixture = ReturnType<typeof freshEnv>;

function seedClub(fx: Fixture, clubId: number, opts: { isCpu?: boolean } = {}) {
  fx.sqlite
    .prepare(`INSERT INTO clubs (id, name, status, is_cpu) VALUES (?, ?, 'active', ?)`)
    .run(clubId, `俱乐部${clubId}`, opts.isCpu ? 1 : 0);
  fx.sqlite.prepare(`INSERT INTO ledger_accounts (club_id, balance) VALUES (?, 0)`).run(clubId);
  authRegisterClubTeam(fx.auth, 10 + clubId, clubId, `队${10 + clubId}`);
}

function seedStadium(
  fx: Fixture,
  clubId: number,
  opts: { capacity?: number; tier?: number; shell?: number; fans?: number } = {},
) {
  fx.sqlite
    .prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(clubId, '', opts.capacity ?? 20000, opts.tier ?? 0, opts.shell ?? 0, opts.fans ?? 1800);
}

/** 生效冠名（标准套餐 3 窗 × 每窗 5）：未豁免时关窗批会收租并递减剩余窗数 */
function seedNaming(fx: Fixture, clubId: number, fee = 5) {
  fx.sqlite
    .prepare(
      `INSERT OR IGNORE INTO brand_pool (brand, heat, source, status, industry, created_at, tier)
       VALUES ('测试品牌', 1.0, 'custom', 'adopted', '通用', '2026-01-01T00:00:00Z', '口碑')`,
    )
    .run();
  fx.sqlite
    .prepare(
      `INSERT INTO naming_contracts (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
                                     windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
                                     started_season, started_window, created_at, updated_at)
       VALUES (?, '测试品牌', 1.0, 1, 1, '标准', ?, 3, 2, 0, NULL, NULL, 'active', 1, 1,
               '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(clubId, fee);
}

function insertBooking(fx: Fixture, clubId: number, activityType = 'concert') {
  fx.sqlite
    .prepare(
      `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, created_at)
       VALUES (?, 1, 1, 1, ?, '2026-07-01T00:00:00Z')`,
    )
    .run(clubId, activityType);
}

/** 本窗一条主场记录：未豁免时维护费按 tier 基础值 + 场次计费，必然 >0 */
function insertHomeMatch(fx: Fixture, clubId: number, matchId = 1) {
  fx.sqlite
    .prepare(
      `INSERT INTO match_attendance (match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at)
       VALUES (?, ?, 1, 1, '多云', 7000, 1, 0, 0, '2026-09-16T00:00:00Z')`,
    )
    .run(matchId, clubId);
}

beforeEach(() => resetConfigCache());

describe('关窗批 CPU 不入账（windowHomeStatements）', () => {
  it('CPU 队有球场/主场/冠名/档期：三类入账均为 0，fans_window_start 仍推进到窗末现值', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, { isCpu: true });
    seedStadium(fx, 1, { shell: 90, fans: 1800 });
    fx.sqlite.prepare('UPDATE stadiums SET fans_window_start = 1500 WHERE club_id = 1').run();
    insertHomeMatch(fx, 1);
    seedNaming(fx, 1);
    insertBooking(fx, 1);

    const { statements, summary } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: true });
    await fx.env.DB.batch(statements);

    // 三类入账与涨粉演化都不生成，summary 也不计该队
    expect(summary.maintenanceClubs).toBe(0);
    expect(summary.maintenanceTotal).toBe(0);
    expect(summary.namingClubs).toBe(0);
    expect(summary.namingTotal).toBe(0);
    expect(summary.activityClubs).toBe(0);
    expect(summary.activityTotal).toBe(0);
    expect(summary.activityOpsCost).toBe(0);
    expect(summary.fansClubs).toBe(0);
    // 账本零流水、冠名窗数不递减、档期结算不落行
    expect(sqlAll(fx.sqlite, `SELECT * FROM ledger_entries`)).toEqual([]);
    expect(sqlGet<{ windows_remaining: number }>(fx.sqlite, `SELECT windows_remaining FROM naming_contracts WHERE club_id = 1`)).toEqual({
      windows_remaining: 2,
    });
    expect(sqlAll(fx.sqlite, `SELECT * FROM venue_window_settlements`)).toEqual([]);
    // fans 不演化，但窗初快照要推进到窗末现值（否则下一窗 fansGrowth 基准越算越偏）
    expect(sqlGet<{ fans: number; fans_window_start: number }>(fx.sqlite, `SELECT fans, fans_window_start FROM stadiums WHERE club_id = 1`)).toEqual({
      fans: 1800,
      fans_window_start: 1800,
    });
  });

  it('同批人类队照常入账：豁免只针对 CPU 队', async () => {
    const fx = freshEnv();
    seedClub(fx, 1, { isCpu: true });
    seedClub(fx, 2, { isCpu: false });
    for (const clubId of [1, 2]) {
      seedStadium(fx, clubId, { shell: 90, fans: 1800 });
      fx.sqlite.prepare('UPDATE stadiums SET fans_window_start = 1500 WHERE club_id = ?').run(clubId);
      insertHomeMatch(fx, clubId, clubId);
      seedNaming(fx, clubId);
      insertBooking(fx, clubId);
    }

    const { statements, summary } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: true });
    await fx.env.DB.batch(statements);

    expect(summary.maintenanceClubs).toBe(1);
    expect(summary.namingClubs).toBe(1);
    expect(summary.activityClubs).toBe(1);
    // 关窗维护费走 ref_type='window'（档期结算的草皮损坏/运营成本也记 kind='maintenance'，别混进来）
    const maint = sqlAll<{ club_id: number }>(
      fx.sqlite,
      `SELECT club_id FROM ledger_entries WHERE kind = 'maintenance' AND ref_type = 'window'`,
    );
    expect(maint.map((r) => r.club_id)).toEqual([2]);
    const settlements = sqlAll<{ club_id: number }>(fx.sqlite, `SELECT club_id FROM venue_window_settlements`);
    expect(settlements.map((r) => r.club_id)).toEqual([2]);
  });
});

/** 停用全部种子事件，只留本用例的自定义事件（抽取确定性用） */
function onlyCustomEvent(fx: Fixture, eventId = 'cpu_ev') {
  fx.sqlite.exec(`UPDATE event_pool SET status = 'discarded'`);
  fx.sqlite
    .prepare(
      `INSERT INTO event_pool (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
                               soft_conditions, template, source, status, created_at)
       VALUES (?, ?, '测试', 10, 'instant', '{}', '{"money":1}', '[]', 0, '{team} 出了事。', 'custom', 'adopted', '2026-01-01T00:00:00Z')`,
    )
    .run(eventId, `事件${eventId}`);
}

function seedEventFixture() {
  const fx = freshEnv();
  seedClub(fx, 1, { isCpu: false });
  seedClub(fx, 2, { isCpu: true });
  onlyCustomEvent(fx);
  return fx;
}

describe('事件触发批 CPU 豁免（triggerEventBatch）', () => {
  it('默认目标集只含人类队，CPU 队不落 occurrence', async () => {
    const fx = seedEventFixture();
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', rng: () => 0 });
    expect(res).toMatchObject({ clubs: 1, triggered: 1 });
    expect(res.events.map((e) => e.clubId)).toEqual([1]);
    expect(sqlAll<{ club_id: number }>(fx.sqlite, `SELECT club_id FROM event_occurrences`)).toEqual([{ club_id: 1 }]);
  });

  it('显式 clubIds 全为 CPU：返回 clubs:0/triggered:0，不静默改选人类队', async () => {
    const fx = seedEventFixture();
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [2], rng: () => 0 });
    expect(res).toEqual({ clubs: 0, triggered: 0, capped: 0, events: [] });
    expect(sqlAll(fx.sqlite, `SELECT * FROM event_occurrences`)).toEqual([]);
  });

  it('混合 clubIds：只跑人类队，CPU 队被过滤', async () => {
    const fx = seedEventFixture();
    const res = await triggerEventBatch(fx.env, { season: 1, windowSeq: 1, actor: 2, origin: 'user', clubIds: [1, 2], rng: () => 0 });
    expect(res).toMatchObject({ clubs: 1, triggered: 1 });
    expect(res.events.map((e) => e.clubId)).toEqual([1]);
    expect(sqlAll<{ club_id: number }>(fx.sqlite, `SELECT club_id FROM event_occurrences`)).toEqual([{ club_id: 1 }]);
  });

  it('点名 eventId 同样不落到 CPU 队：显式全 CPU 返回 0，混合只演人类队', async () => {
    const fx = seedEventFixture();
    const cpuOnly = await triggerEventBatch(fx.env, {
      season: 1,
      windowSeq: 1,
      actor: 2,
      origin: 'user',
      clubIds: [2],
      eventId: 'cpu_ev',
    });
    expect(cpuOnly).toEqual({ clubs: 0, triggered: 0, capped: 0, events: [] });
    expect(sqlAll(fx.sqlite, `SELECT * FROM event_occurrences`)).toEqual([]);

    const mixed = await triggerEventBatch(fx.env, {
      season: 1,
      windowSeq: 1,
      actor: 2,
      origin: 'user',
      clubIds: [1, 2],
      eventId: 'cpu_ev',
      rng: () => 0.99,
    });
    expect(mixed).toMatchObject({ clubs: 1, triggered: 1 });
    expect(mixed.events.map((e) => e.clubId)).toEqual([1]);
  });
});
