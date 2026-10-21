// 关窗提醒 tick（v6.53.0 §6.2-6.3）：临近关窗时只给「还有空档」的活跃队发一条 remind，
// 去重靠 season_windows.venue_reminder_at；提醒本身不进 tickChanged（不白 purge 公开缓存）。
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, createAuthDb, createTestD1, sqlAll, sqlGet } from './d1.ts';
import type { Env } from '../src/worker/env.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { runVenueReminderTick } from '../src/worker/venue-reminders.ts';
import type { EventTickResult } from '../src/worker/event-ops.ts';
import type { ExpirySummary } from '../src/worker/expiry-ops.ts';
import type { XpRetrySummary } from '../src/worker/results.ts';
import type { SettleSummary } from '../src/worker/market-settle.ts';
import { tickChanged } from '../src/worker/index.ts';

const HOUR = 3600_000;
const NOW = Date.parse('2026-08-01T00:00:00.000Z');

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  auth: DatabaseSync;
}

function setConfig(fx: Fixture, key: string, value: string) {
  fx.sqlite
    .prepare(`INSERT INTO config (key, value, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value);
  resetConfigCache();
}

/** 三个活跃队：1 号容量 20000（3 档）、2 号容量 12000（2 档，已排满）、3 号无球场行（按 2 档） */
function freshEnv(opts: { openedAt?: string | null; reminderAt?: string } = {}): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const { sqlite: auth, d1: authD1 } = createAuthDb();
  const env = {
    DB: createTestD1(sqlite),
    AUTH_DB: authD1,
    TOUR_DB: createTestD1(new DatabaseSync(':memory:')),
    rng: () => 0.5,
  } as unknown as Env;
  sqlite.exec(`
    INSERT INTO clubs (id, name, status) VALUES (1, '甲队', 'active'), (2, '乙队', 'active'), (3, '丙队', 'active');
    INSERT INTO stadiums (club_id, name, capacity, created_at, updated_at) VALUES
      (1, '', 20000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      (2, '', 12000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, created_at) VALUES
      (2, 1, 1, 1, 'concert', '2026-01-01T00:00:00Z'),
      (2, 1, 1, 2, 'open_day', '2026-01-01T00:00:00Z');
  `);
  if (opts.openedAt !== null) {
    const openedAt = opts.openedAt ?? new Date(NOW - 4.5 * HOUR).toISOString();
    sqlite
      .prepare(
        `INSERT INTO season_windows (season, window_seq, status, opened_at, venue_reminder_at) VALUES (1, 1, 'open', ?, ?)`,
      )
      .run(openedAt, opts.reminderAt ?? '');
  } else if (opts.reminderAt !== undefined) {
    throw new Error('reminderAt 需要一条 open 窗');
  }
  // 三个队各绑一个账号（web 行要绑定账号才落库）
  auth.exec(`
    INSERT INTO account (id, name, created_at) VALUES (2, '教练乙', '2026-01-01T00:00:00Z'), (3, '教练丙', '2026-01-01T00:00:00Z'), (4, '教练丁', '2026-01-01T00:00:00Z');
    INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 101, 1, '队1', '2026-01-01T00:00:00Z'), (2, 102, 2, '队2', '2026-01-01T00:00:00Z'), (3, 103, 3, '队3', '2026-01-01T00:00:00Z');
    INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (2, 1, 'club', '2026-01-01T00:00:00Z'), (3, 2, 'club', '2026-01-01T00:00:00Z'), (4, 3, 'club', '2026-01-01T00:00:00Z');
  `);
  setConfig({ env, sqlite, auth }, 'window_length_hours', '6');
  return { env, sqlite, auth };
}

function reminders(sqlite: DatabaseSync) {
  return sqlAll<{ club_id: number; payload: string }>(
    sqlite,
    "SELECT club_id, payload FROM notifications WHERE template = 'venue_slot_reminder' ORDER BY club_id",
  );
}

beforeEach(() => resetConfigCache());

describe('关窗提醒 tick（v6.53.0 §6.2）', () => {
  it('窗长 6h、还剩 1.5h ⇒ 只给没排满的队发；无球场行按 2 档判；已排满不发', async () => {
    const fx = freshEnv();
    const res = await runVenueReminderTick(fx.env, NOW);
    // club1（20000 ⇒ 3 档，空 3）、club3（无球场行 ⇒ 2 档，空 2）发；club2 已排 2/2 跳过
    expect(res).toEqual({ sent: 2, skipped: 0, failed: 0 });
    const rows = reminders(fx.sqlite);
    expect(rows.map((r) => r.club_id)).toEqual([1, 3]);
    expect(rows[0]!.payload).toContain('【档期提醒】S1 第 1 窗约 2 小时后关闭，你还有 3 个档位没排（已排 0/3）。');
    expect(rows[1]!.payload).toContain('你还有 2 个档位没排（已排 0/2）。');
    expect(sqlGet<{ venue_reminder_at: string }>(fx.sqlite, 'SELECT venue_reminder_at FROM season_windows WHERE season = 1')).toEqual({
      venue_reminder_at: new Date(NOW).toISOString(),
    });
  });

  it('venue_reminder_at 写过一次就不再重发（重跑 sent=0、通知不增加）', async () => {
    const fx = freshEnv();
    expect((await runVenueReminderTick(fx.env, NOW)).sent).toBe(2);
    const again = await runVenueReminderTick(fx.env, NOW + 60_000);
    expect(again).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(reminders(fx.sqlite)).toHaveLength(2);
  });

  it('离关窗还远（剩余 5h > 窗长/3）不发，也不写已提醒标记', async () => {
    const fx = freshEnv({ openedAt: new Date(NOW - 1 * HOUR).toISOString() }); // 关窗在 5h 后
    expect(await runVenueReminderTick(fx.env, NOW)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(reminders(fx.sqlite)).toHaveLength(0);
    expect(sqlGet<{ venue_reminder_at: string }>(fx.sqlite, 'SELECT venue_reminder_at FROM season_windows WHERE season = 1')).toEqual({
      venue_reminder_at: '',
    });
  });

  it('没有开着的窗 ⇒ 直接跳过；opened_at 空的脏行也不猜关窗时刻', async () => {
    const none = freshEnv({ openedAt: null });
    expect(await runVenueReminderTick(none.env, NOW)).toEqual({ sent: 0, skipped: 1, failed: 0 });

    const dirty = freshEnv({ openedAt: '' });
    expect(await runVenueReminderTick(dirty.env, NOW)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(reminders(dirty.sqlite)).toHaveLength(0);
  });

  it('只发提醒不进 tickChanged（否则每个 tick 都会白 purge 一次公开缓存）', async () => {
    const fx = freshEnv();
    const sent = await runVenueReminderTick(fx.env, NOW);
    expect(sent.sent).toBe(2); // 这一轮确实写了 notifications + venue_reminder_at

    const summary: SettleSummary = { settled: 0, delisted: 0, voided: 0, notesUpdated: 0, healed: 0 };
    const events: EventTickResult = { expired: 0, reminded: 0, skipped: 0 };
    const expiry: ExpirySummary = { closed: 0, reminded: 0, byAdapter: {}, errors: [] };
    const xpRetry: XpRetrySummary = { scanned: 0, healed: 0, failed: 0 };
    expect(tickChanged(summary, events, expiry, xpRetry)).toBe(false);
    // 对照组：真发生市场结算时判据必须为 true
    expect(tickChanged({ ...summary, settled: 1 }, events, expiry, xpRetry)).toBe(true);
  });
});
