// 设施经营（v2.5.0）：扩建/升级/建设券拆分与返还、门槛闸（座位区间/开放进度/满级/余额）与路由
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { splitPayment, creditRefund, expandStadium, upgradeStadiumTier, upgradeFacilityLevel } from '../src/worker/stadium-ops.ts';
import { sqlAll, sqlGet } from './d1.ts';

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
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  return { env, sqlite, tour, kv };
}

// 默认球场：档位 0（1.2-2.5 万座），容量 20000，建设券 0.4，余额 5
function seedClub(sqlite: DatabaseSync, opts: { capacity?: number; tier?: number; credit?: number; balance?: number } = {}) {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 1, '2026-01-01T00:00:00Z');
    INSERT INTO stadiums (club_id, name, capacity, tier, build_credit) VALUES (1, '酋长球场', ${opts.capacity ?? 20000}, ${opts.tier ?? 0}, ${opts.credit ?? 0.4});
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, ${opts.balance ?? 5}, '2026-01-01T00:00:00Z');
  `);
}

function stadiumRow(sqlite: DatabaseSync) {
  return sqlGet<{ capacity: number; tier: number; build_credit: number }>(sqlite, 'SELECT capacity, tier, build_credit FROM stadiums WHERE club_id = 1')!;
}

describe('建设券拆分与返还（纯函数）', () => {
  it('先券后钱：券足额全抵、券不足补现金、负券按 0', () => {
    expect(splitPayment(1.0, 0.4)).toEqual({ creditUsed: 0.4, cash: 0.6 });
    expect(splitPayment(1.0, 5)).toEqual({ creditUsed: 1, cash: 0 });
    expect(splitPayment(1.0, 0)).toEqual({ creditUsed: 0, cash: 1 });
    expect(splitPayment(0.3, 0.1)).toEqual({ creditUsed: 0.1, cash: 0.2 });
  });

  it('返还=支出全额×比例，四舍五入到分', () => {
    expect(creditRefund(1, 0.25)).toBe(0.25);
    expect(creditRefund(3, 0.25)).toBe(0.75);
    expect(creditRefund(0.1, 0.25)).toBe(0.03); // 0.025 → 0.03
  });
});

describe('球场扩建', () => {
  it('券抵部分现金、返 25% 入券；账本记现金部分；可连续扩建', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const r1 = await expandStadium(fx.env, 1, 1000);
    expect(r1).toEqual({ cost: 1, creditUsed: 0.4, cash: 0.6, refund: 0.25, capacity: 21000 });
    expect(stadiumRow(fx.sqlite)).toEqual({ capacity: 21000, tier: 0, build_credit: 0.25 });
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 1')?.balance).toBe(4.4);
    const entry = sqlGet<{ kind: string; amount: number; memo: string }>(fx.sqlite, "SELECT kind, amount, memo FROM ledger_entries WHERE kind='stadium_expand'");
    expect(entry).toMatchObject({ kind: 'stadium_expand', amount: -0.6 });

    // 第二次扩建（0 券余 → 全现金 + 返券），幂等闸不得拦
    const r2 = await expandStadium(fx.env, 1, 100);
    expect(r2).toEqual({ cost: 0.1, creditUsed: 0.1, cash: 0, refund: 0.03, capacity: 21100 });
    expect(stadiumRow(fx.sqlite).build_credit).toBeCloseTo(0.18, 5);
    expect(sqlAll(fx.sqlite, "SELECT id FROM ledger_entries WHERE kind='stadium_expand'").length).toBe(2);
  });

  it('非 100 倍数 / 超档位座位上限 / 余额不足（券也不够）各被拒', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    await expect(expandStadium(fx.env, 1, 150)).rejects.toMatchObject({ status: 400 });
    await expect(expandStadium(fx.env, 1, 6000)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('座位上限') });
    await expect(expandStadium(fx.env, 1, 0)).rejects.toMatchObject({ status: 400 });

    const broke = freshEnv();
    seedClub(broke.sqlite, { credit: 0, balance: 0.05 });
    await expect(expandStadium(broke.env, 1, 100)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('资金不够') });
  });
});

describe('球场升级', () => {
  it('容量达标 + 档位开放 → 扣当前档升级费，tier+1；开放进度闸拦二次升级', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { credit: 1 });
    const r = await upgradeStadiumTier(fx.env, 1);
    expect(r).toEqual({ cost: 3, creditUsed: 1, cash: 2, refund: 0.75, tier: 1 });
    expect(stadiumRow(fx.sqlite)).toEqual({ capacity: 20000, tier: 1, build_credit: 0.75 });

    // 默认 max_open_tier=1：再升第 2 档被开放进度拦
    await expect(upgradeStadiumTier(fx.env, 1)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('暂未开放') });
  });

  it('容量不足升新档被拒；最高档再升被拒', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { capacity: 12000 });
    await expect(upgradeStadiumTier(fx.env, 1)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('容量不足') });

    const top = freshEnv();
    seedClub(top.sqlite, { tier: 4, capacity: 60000 });
    await expect(upgradeStadiumTier(top.env, 1)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('最高档位') });
  });
});

describe('子设施升级', () => {
  it('无行从 0 级起升（费用 3M），逐级抬价；满级被拒；非法 key 被拒', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, { credit: 2, balance: 10 });
    const r1 = await upgradeFacilityLevel(fx.env, 1, 'commercial');
    expect(r1).toEqual({ cost: 3, creditUsed: 2, cash: 1, refund: 0.75, level: 1 });
    expect(sqlGet<{ level: number }>(fx.sqlite, "SELECT level FROM club_facilities WHERE club_id=1 AND facility_key='commercial'")?.level).toBe(1);
    // 券余额 = 种子 2M − 抵扣 2M + 返还 0.75M（费用 3M × 0.25）
    expect(sqlGet<{ build_credit: number }>(fx.sqlite, 'SELECT build_credit FROM stadiums WHERE club_id=1')?.build_credit).toBeCloseTo(0.75, 5);

    const r2 = await upgradeFacilityLevel(fx.env, 1, 'commercial');
    expect(r2.cost).toBe(5); // 1→2 级费用
    expect(sqlGet<{ level: number }>(fx.sqlite, "SELECT level FROM club_facilities WHERE club_id=1 AND facility_key='commercial'")?.level).toBe(2);

    fx.sqlite.exec("UPDATE club_facilities SET level = 5 WHERE club_id=1 AND facility_key='commercial'");
    await expect(upgradeFacilityLevel(fx.env, 1, 'commercial')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('满级') });
    await expect(upgradeFacilityLevel(fx.env, 1, 'casino')).rejects.toMatchObject({ status: 400 });
  });
});

describe('路由（requireCoach + getBoundClub + build-info）', () => {
  it('build-info 拉全预览；expand 201；未绑定 403', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const get = (path: string, token = 'tok-coach') =>
      app.request(path, { headers: { Cookie: `whl_session=${token}` } }, fx.env);
    const info = await get('/api/club/stadium/build-info');
    expect(info.status).toBe(200);
    const body = (await info.json()) as {
      credit: number;
      expansionPer100: number;
      maxOpenTier: number;
      tier: { level: number; name: string; maxSeats: number };
      nextTier: { name: string; minSeats: number; upgradeCost: number; open: boolean; capacityOk: boolean } | null;
      facilities: { key: string; level: number; nextCost: number | null }[];
    };
    expect(body.credit).toBe(0.4);
    expect(body.expansionPer100).toBe(0.1);
    expect(body.tier).toMatchObject({ level: 0, name: '社区级', maxSeats: 25000 });
    expect(body.nextTier).toMatchObject({ name: '地区级', minSeats: 20000, upgradeCost: 3, open: true, capacityOk: true });
    expect(body.facilities).toHaveLength(5);
    expect(body.facilities[0]).toMatchObject({ key: 'commercial', level: 0, nextCost: 3 });

    const expand = await app.request(
      '/api/club/stadium/expand',
      { method: 'POST', headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-coach' }, body: JSON.stringify({ seats: 500 }) },
      fx.env,
    );
    expect(expand.status).toBe(201);
    expect(((await expand.json()) as { capacity: number }).capacity).toBe(20500);

    const anon = await get('/api/club/stadium/build-info', 'tok-none');
    expect(anon.status).toBe(401);
  });
});
