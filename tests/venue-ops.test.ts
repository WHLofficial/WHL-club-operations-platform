// 球场档期（v6.9.0）：档位预订（bookSlot）、确定性伪随机结算（seededUnit/activityIncome）、
// 窗末收入与草皮损坏入账（bookingSettlement/windowActivityStatements）与教练端点
// 口径源：revenue 插件 activity_config + services/formula.py:497 activity_income
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  activityIncome,
  bookSlot,
  bookingSettlement,
  listBookings,
  loadActivityCatalog,
  seededUnit,
  windowActivityStatements,
} from '../src/worker/venue-ops.ts';
import type { ActivityCatalog } from '../src/worker/venue-ops.ts';
import { windowHomeStatements } from '../src/worker/home.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
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
  };
  return { env, sqlite, tour, kv };
}

/** 默认球场：容量 20000、档位 0（维护费基础 2.0）、余额 50；默认同时开 S1W1 */
function seedClub(sqlite: DatabaseSync, opts: { clubId?: number; balance?: number; openWindow?: boolean } = {}) {
  const id = opts.clubId ?? 1;
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (${id}, '俱乐部${id}', 'premier', 'active');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${id}, 1, '2026-01-01T00:00:00Z');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (${id}, '主场${id}', 20000, 0, 1800);
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (${id}, ${opts.balance ?? 50}, '2026-01-01T00:00:00Z');
  `);
  if (opts.openWindow !== false) {
    if (id === 1) {
      sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z')`);
    } else {
      sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (${id}, 1, 'open', '2026-07-01T00:00:00Z')`);
    }
  }
}

function seedBooking(
  sqlite: DatabaseSync,
  slotNo: number,
  activityType: string,
  opts: { clubId?: number; season?: number; windowSeq?: number } = {},
): number {
  sqlite
    .prepare(
      `INSERT INTO venue_bookings (club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)
       VALUES (?, ?, ?, ?, ?, '1', '2026-07-01T00:00:00Z')`,
    )
    .run(opts.clubId ?? 1, opts.season ?? 1, opts.windowSeq ?? 1, slotNo, activityType);
  return sqlGet<{ id: number }>(sqlite, 'SELECT MAX(id) AS id FROM venue_bookings')!.id;
}

const RANGE_MAX: { income: number; damage: number; damageRoll: number } = { income: 1, damage: 1, damageRoll: 1 };
const RANGE_MIN: { income: number; damage: number; damageRoll: number } = { income: 0, damage: 0, damageRoll: 0 };

/** 把活动目录换成「演唱会有收入 + 概率 1 必损坏」，让损坏流水用例不靠种子运气 */
function forceConcertDamage(sqlite: DatabaseSync) {
  const cfg = {
    concert: { name: '演唱会', income_min: 3, income_max: 8, pitch_damage_prob: 1, damage_min: 2, damage_max: 5 },
    idle: { name: '空置', income: 0 },
  };
  sqlite
    .prepare(`INSERT INTO config (key, value, updated_at) VALUES ('activity_config', ?, '2026-07-01T00:00:00Z')`)
    .run(JSON.stringify(cfg));
  resetConfigCache();
}

describe('确定性伪随机（seededUnit）：同种子逐字一致、不同档位/抽取互不相同', () => {
  it('同 seed + draw 恒定、落在 [0,1)、档位与抽取维度都参与', () => {
    expect(seededUnit([1, 1, 1, 1], 0)).toBe(seededUnit([1, 1, 1, 1], 0));
    expect(seededUnit([1, 1, 1, 1], 0)).not.toBe(seededUnit([1, 1, 1, 2], 0)); // 换档位
    expect(seededUnit([1, 1, 1, 1], 0)).not.toBe(seededUnit([1, 1, 2, 1], 0)); // 换窗口
    expect(seededUnit([1, 1, 1, 1], 0)).not.toBe(seededUnit([1, 1, 1, 1], 2)); // 换抽取
    for (const slot of [1, 2, 3, 7]) {
      for (const draw of [0, 1, 2]) {
        const v = seededUnit([1, 1, 1, slot], draw);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('活动结算口径（activityIncome，插件 formula.activity_income）', () => {
  async function catalog(fx: Fixture): Promise<ActivityCatalog> {
    return loadActivityCatalog(fx.env.DB);
  }

  it('区间型收入取两端；固定收入活动不受随机数影响', async () => {
    const fx = freshEnv();
    const cat = await catalog(fx);
    const concert = cat.types['concert']!;
    expect(activityIncome(concert, 'concert', 0, 0, RANGE_MIN).income).toBe(3);
    expect(activityIncome(concert, 'concert', 0, 0, RANGE_MAX).income).toBe(8);
    const openDay = cat.types['open_day']!;
    expect(activityIncome(openDay, 'open_day', 0, 0, RANGE_MIN).income).toBe(0.5);
    expect(activityIncome(openDay, 'open_day', 4, 4, RANGE_MAX).income).toBe(0.5);
  });

  it('演唱会收入 ×(1+0.1×草皮级)，且加成在损坏判定之后（判定仍用未加成概率）', async () => {
    const fx = freshEnv();
    const concert = (await catalog(fx)).types['concert']!;
    // 草皮 3 级：3 × 1.3 = 3.9；damageRoll=1 不触发损坏
    expect(activityIncome(concert, 'concert', 3, 0, { income: 0, damage: 0, damageRoll: 1 })).toEqual({ income: 3.9, extraMaintenance: 0 });
    // 损坏额 = damage_min + roll×(max−min) = 2 + 0×3 = 2，收入不因损坏变化
    expect(activityIncome(concert, 'concert', 0, 0, RANGE_MIN)).toEqual({ income: 3, extraMaintenance: 2 });
    // 草皮 4 级 → 概率 0.15×(1−0.6)=0.06：damageRoll 0.1 落在概率外，不损坏；收入仍加成 3×1.4
    expect(activityIncome(concert, 'concert', 4, 0, { income: 0, damage: 1, damageRoll: 0.1 })).toEqual({ income: 4.2, extraMaintenance: 0 });
    // 草皮 0 级同 roll 必损坏 → 说明上面确实是「等级把概率压下去了」
    expect(activityIncome(concert, 'concert', 0, 0, { income: 0, damage: 1, damageRoll: 0.1 }).extraMaintenance).toBe(5);
  });

  it('青训夏令营 ×(1 + 系数×青训级)；空置 0 收入', async () => {
    const fx = freshEnv();
    const cat = await catalog(fx);
    expect(activityIncome(cat.types['youth_camp']!, 'youth_camp', 0, 5, RANGE_MIN).income).toBe(1.5); // 1 × (1+0.1×5)
    expect(activityIncome(cat.types['idle']!, 'idle', 2, 2, RANGE_MAX).income).toBe(0);
  });

  it('损坏额也在上下界内且三位小数', async () => {
    const fx = freshEnv();
    const concert = (await catalog(fx)).types['concert']!;
    const mid = activityIncome(concert, 'concert', 0, 0, { income: 0.5, damage: 0.5, damageRoll: 0 });
    expect(mid.income).toBe(5.5);
    expect(mid.extraMaintenance).toBe(3.5);
  });
});

describe('档位预订（bookSlot）', () => {
  it('越界档位 400、未知活动 400、窗口没开 409', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const input = { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: 'concert', actor: 1 };
    await expect(bookSlot(fx.env, { ...input, slotNo: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(bookSlot(fx.env, { ...input, slotNo: 3 })).rejects.toThrow(/档位序号应在 1-2 之间/);
    await expect(bookSlot(fx.env, { ...input, activityType: 'opera' })).rejects.toThrow(/没有「opera」这种活动/);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    await expect(bookSlot(fx.env, input)).rejects.toThrow(/这一窗已经关了/);
    // 历史窗（未开的那一窗）同样拒
    await expect(bookSlot(fx.env, { ...input, windowSeq: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it('activity_slots 配置改了立刻生效（1 时 2 号档位越界）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    fx.sqlite.exec(`INSERT INTO config (key, value, updated_at) VALUES ('activity_slots', '1', '2026-07-01T00:00:00Z')`);
    resetConfigCache();
    expect((await loadActivityCatalog(fx.env.DB)).slots).toBe(1);
    await expect(
      bookSlot(fx.env, { clubId: 1, season: 1, windowSeq: 1, slotNo: 2, activityType: 'concert', actor: 1 }),
    ).rejects.toThrow(/档位序号应在 1-1 之间/);
  });

  it('同槽位改订覆盖：返回被取代的活动，库里只剩一条', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const input = { clubId: 1, season: 1, windowSeq: 1, slotNo: 1, activityType: 'concert', actor: 1 };
    const first = await bookSlot(fx.env, input);
    expect(first.previous).toBeNull();
    const second = await bookSlot(fx.env, { ...input, activityType: 'esports' });
    expect(second.previous?.activity_type).toBe('concert');
    expect(second.booking.activity_type).toBe('esports');
    const rows = await listBookings(fx.env.DB, 1, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slot_no).toBe(1);
  });
});

describe('窗末结算与账本闸（bookingSettlement / windowActivityStatements）', () => {
  it('收入进 kind=activity、草皮损坏进 kind=maintenance，都挂 ref_type=booking + 档位 id', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    forceConcertDamage(fx.sqlite); // 概率 1：损坏流水必然出现，用例不靠种子运气
    const bookingId = seedBooking(fx.sqlite, 1, 'concert');
    const cat = await loadActivityCatalog(fx.env.DB);
    const out = await windowActivityStatements(fx.env, 1, 1, 1, cat, { pitch: 0, youth: 0 });
    await fx.env.DB.batch(out.statements);

    const activity = sqlAll<{ kind: string; amount: number; ref_type: string; ref_id: number; memo: string }>(
      fx.sqlite,
      `SELECT kind, amount, ref_type, ref_id, memo FROM ledger_entries WHERE kind = 'activity'`,
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]!.ref_type).toBe('booking');
    expect(activity[0]!.ref_id).toBe(bookingId);
    expect(activity[0]!.amount).toBeCloseTo(out.income, 3);
    expect(activity[0]!.memo).toContain('演唱会（S1 第 1 窗 1 号档期）');

    const damage = sqlAll<{ amount: number; ref_type: string; ref_id: number; memo: string }>(
      fx.sqlite,
      `SELECT amount, ref_type, ref_id, memo FROM ledger_entries WHERE kind = 'maintenance'`,
    );
    expect(damage).toHaveLength(1);
    expect(damage[0]!.ref_type).toBe('booking');
    expect(damage[0]!.ref_id).toBe(bookingId);
    expect(damage[0]!.amount).toBeCloseTo(-out.extraMaintenance, 3);
    expect(damage[0]!.memo).toContain('草皮损坏');
  });

  it('同窗重跑幂等：同种子同额、账本不重复；空置档位不产生流水', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    forceConcertDamage(fx.sqlite);
    seedBooking(fx.sqlite, 1, 'concert');
    const id2 = seedBooking(fx.sqlite, 2, 'idle');
    const cat = await loadActivityCatalog(fx.env.DB);
    const first = await windowActivityStatements(fx.env, 1, 1, 1, cat, { pitch: 0, youth: 0 });
    await fx.env.DB.batch(first.statements);
    const again = await windowActivityStatements(fx.env, 1, 1, 1, cat, { pitch: 0, youth: 0 });
    await fx.env.DB.batch(again.statements);
    expect(again.income).toBe(first.income);
    expect(again.extraMaintenance).toBe(first.extraMaintenance);
    expect(again.slots).toBe(2);
    const bookings = await listBookings(fx.env.DB, 1, 1, 1);
    expect(bookings.map((b) => b.id)).toContain(id2);
    // 只有演唱会有流水（收入 + 损坏各一条），空置档位不产生；重放被闸拦下
    const counts = sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'booking'`)!;
    expect(counts.n).toBe(2);
  });

  it('关窗批把档期结算并进汇总，且不与基础维护费的 (maintenance, window) 闸相撞', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    forceConcertDamage(fx.sqlite);
    seedBooking(fx.sqlite, 1, 'concert');
    const { statements, summary } = await windowHomeStatements(fx.env, 1, 1, { chargeNaming: false });
    await fx.env.DB.batch(statements);
    expect(summary.activityClubs).toBe(1);
    expect(summary.maintenanceClubs).toBe(1);
    // 基础维护费 2.0（档位 0、本窗 0 场主场）仍独立入账
    expect(summary.maintenanceTotal).toBe(2);
    const rows = sqlAll<{ kind: string; ref_type: string }>(
      fx.sqlite,
      `SELECT kind, ref_type FROM ledger_entries ORDER BY id`,
    );
    expect(rows.filter((r) => r.ref_type === 'window')).toHaveLength(1);
    expect(rows.filter((r) => r.ref_type === 'booking')).toHaveLength(2);
    // 汇总口径 = 活动收入 − 草皮损坏
    const activityTotal = sqlGet<{ sum: number }>(fx.sqlite, `SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger_entries WHERE kind = 'activity'`)!.sum;
    const damageTotal = sqlGet<{ sum: number }>(fx.sqlite, `SELECT COALESCE(SUM(amount), 0) AS sum FROM ledger_entries WHERE kind = 'maintenance' AND ref_type = 'booking'`)!.sum;
    expect(summary.activityTotal).toBeCloseTo(Math.round((activityTotal + damageTotal) * 100) / 100, 2);
  });

  it('未知活动类型的档位不结算（配置里删掉某活动后旧订单安静跳过）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedBooking(fx.sqlite, 1, 'opera');
    const cat = await loadActivityCatalog(fx.env.DB);
    expect(cat.types['opera']).toBeUndefined();
    const [row] = await listBookings(fx.env.DB, 1, 1, 1);
    const out = await bookingSettlement(fx.env, row!, cat, 0, 0);
    expect(out).toEqual({ statements: [], income: 0, extraMaintenance: 0 });
  });
});

describe('教练端档期路由（/api/club/bookings）', () => {
  const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-coach') =>
    app.request(path, { method, headers: { 'content-type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

  it('GET 回档位/目录/已排；POST 201 排上，改排带 previous；越界 400', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const empty = await send('GET', '/api/club/bookings', fx.env);
    expect(empty.status).toBe(200);
    const shape = (await empty.json()) as { open: boolean; season: number; windowSeq: number; slots: number; catalog: { key: string; name: string; incomeMin: number; incomeMax: number }[]; bookings: unknown[] };
    expect(shape).toMatchObject({ open: true, season: 1, windowSeq: 1, slots: 2 });
    expect(shape.catalog.map((c) => c.key)).toEqual(['concert', 'esports', 'open_day', 'youth_camp', 'idle']);
    expect(shape.catalog[0]).toMatchObject({ name: '演唱会', incomeMin: 3, incomeMax: 8 });
    expect(shape.bookings).toHaveLength(0);

    const first = await send('POST', '/api/club/bookings', fx.env, { slotNo: 1, activityType: 'concert' });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { booking: { slotNo: number; activityName: string }; previous: unknown };
    expect(firstBody.booking).toMatchObject({ slotNo: 1, activityName: '演唱会' });
    expect(firstBody.previous).toBeNull();

    const rebook = await send('POST', '/api/club/bookings', fx.env, { slotNo: 1, activityType: 'esports' });
    expect(rebook.status).toBe(201);
    const rebookBody = (await rebook.json()) as { booking: { activityName: string }; previous: { activityName: string } };
    expect(rebookBody.booking.activityName).toBe('电竞赛事');
    expect(rebookBody.previous.activityName).toBe('演唱会');

    expect((await send('POST', '/api/club/bookings', fx.env, { slotNo: 5, activityType: 'concert' })).status).toBe(400);
    expect((await send('POST', '/api/club/bookings', fx.env, { slotNo: 1 })).status).toBe(400);
    expect((await send('POST', '/api/club/bookings', fx.env, { slotNo: 1, activityType: 'concert', windowSeq: 2 })).status).toBe(409);
    // 查历史档期：season/windowSeq 必须成对且是整数，给错报错不静默换窗
    expect((await send('GET', '/api/club/bookings?season=1', fx.env)).status).toBe(400);
    expect((await send('GET', '/api/club/bookings?season=1&windowSeq=abc', fx.env)).status).toBe(400);
    const history = await send('GET', '/api/club/bookings?season=1&windowSeq=1', fx.env);
    expect(history.status).toBe(200);
    expect((await history.json()) as { open: boolean }).toMatchObject({ open: true });
  });

  it('没有开窗 409、没绑俱乐部 403、匿名 401', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    expect((await send('POST', '/api/club/bookings', fx.env, { slotNo: 1, activityType: 'concert' })).status).toBe(409);
    expect((await send('GET', '/api/club/bookings', fx.env)).status).toBe(200);

    const fx2 = freshEnv();
    fx2.sqlite.exec(`
      INSERT INTO clubs (id, name, status) VALUES (1, '没绑定', 'active');
      INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    `);
    expect((await send('GET', '/api/club/bookings', fx2.env)).status).toBe(403);
    expect((await send('POST', '/api/club/bookings', fx2.env, { slotNo: 1, activityType: 'concert' })).status).toBe(403);

    expect((await app.request('/api/club/bookings', {}, fx.env)).status).toBe(401);
    expect((await app.request('/api/club/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slotNo: 1, activityType: 'concert' }) }, fx.env)).status).toBe(401);
  });
});
