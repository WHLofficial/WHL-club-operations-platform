// 冠名市场（增量 20）：底价公式与三套餐、签约快照与双签闸、解约赔金、窗末收租/对赌奖金、路由冒烟
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { namingBaseFee, buildPackages, signNaming, terminateNaming, windowNamingStatements, DEFAULT_BRANDS } from '../src/worker/naming-ops.ts';
import type { NamingParams } from '../src/worker/naming-ops.ts';

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

// 默认球场：容量 20000、死忠 18000；开放窗口 S1W1
function seedClub(sqlite: DatabaseSync, opts: { capacity?: number; fans?: number; balance?: number } = {}) {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 1, '2026-01-01T00:00:00Z');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (1, '酋长球场', ${opts.capacity ?? 20000}, 0, ${opts.fans ?? 18000});
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (1, ${opts.balance ?? 50}, '2026-01-01T00:00:00Z');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
  `);
}

const PARAMS: NamingParams = {
  base: 0.5,
  perCapacityWan: 0.3,
  perFansWan: 0.12,
  terminatePenalty: 0.3,
  stable: { windows: 6, factor: 0.85 },
  short: { windows: 2, factor: 1.25 },
  bet: { windows: 4, factor: 0.7, bonusRate: 0.7, attend: 0.8, fans: 0.03 },
};

describe('底价与三套餐（纯函数，formula.py:462 / build_packages 口径）', () => {
  it('底价 = (基准 + 0.3×容量万 + 0.12×死忠万) × 热度，三位小数', () => {
    // (0.5 + 0.6 + 0.216) × 1.2 = 1.5792 → 1.579
    expect(namingBaseFee(PARAMS, 20000, 18000, 1.2)).toBe(1.579);
    // 零容量零死忠：0.5 × 1.0
    expect(namingBaseFee(PARAMS, 0, 0, 1)).toBe(0.5);
  });

  it('三套餐金额 = 底价×系数，对赌奖金 = 保底×bonusRate，只有对赌带达线', () => {
    const pkgs = buildPackages(PARAMS, 1.579);
    expect(pkgs.map((p) => [p.pkgName, p.windows, p.feePerWindow, p.bonusAmount])).toEqual([
      ['稳健', 6, 1.342, 0], // 1.579×0.85
      ['进取', 2, 1.974, 0], // 1.579×1.25
      ['对赌', 4, 1.105, 0.774], // 1.579×0.7；1.105×0.7
    ]);
    expect(pkgs[0]!.betAttend).toBeNull();
    expect(pkgs[2]!.betAttend).toBe(0.8);
    expect(pkgs[2]!.betFans).toBe(0.03);
  });

  it('品牌池 7 家，热度覆盖 0.7-1.3', () => {
    expect(DEFAULT_BRANDS).toHaveLength(7);
    expect(DEFAULT_BRANDS.map((b) => b.brand)).toContain('亚马逊');
  });
});

describe('签约与解约', () => {
  it('签约：条款快照入合同（底价/套餐金额/窗口数/达线），无排他但一队一份', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const row = await signNaming(fx.env, 1, '亚马逊', 3);
    expect(row).toMatchObject({
      club_id: 1,
      brand: '亚马逊',
      brand_heat: 1.3,
      base_fee: 1.711, // (0.5+0.6+0.216)×1.3 = 1.7108
      package_no: 3,
      pkg_name: '对赌',
      fee_per_window: 1.198, // 1.711×0.7
      windows_total: 4,
      windows_remaining: 4,
      bonus_amount: 0.839, // 1.198×0.7
      status: 'active',
      started_season: 1,
      started_window: 1,
    });
  });

  it('闸：重复签约 409、品牌不在池 400、套餐号非法 400、窗口没开 409', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    await signNaming(fx.env, 1, '可口可乐', 1);
    await expect(signNaming(fx.env, 1, '阿迪达斯', 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('已有生效冠名') });
    await expect(signNaming(fx.env, 1, '某个野牌子', 1)).rejects.toMatchObject({ status: 400 });
    await expect(signNaming(fx.env, 1, '阿迪达斯', 5)).rejects.toMatchObject({ status: 400 });

    fx.sqlite.exec("UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1");
    await expect(signNaming(fx.env, 1, '阿迪达斯', 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('窗口没开') });
  });

  it('提前解约：赔剩余窗口费用 30%（remaining−1），账本记 naming_penalty；无赔金只改状态', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    await signNaming(fx.env, 1, '可口可乐', 1); // fee = 0.5×0.85=0.425×... 实算 (0.5+0.6+0.216)×1.0=1.316 → 1.316? heat 1.0 → 1.316
    const out = await terminateNaming(fx.env, 1);
    // 稳健 fee = 1.316×0.85 = 1.119；赔 (6−1)×1.119×0.3 = 1.6785 → 1.678
    expect(out).toEqual({ brand: '可口可乐', penalty: 1.678, windowsRemaining: 6 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM naming_contracts WHERE club_id = 1')).toMatchObject({ status: 'terminated' });
    const entries = sqlAll<{ kind: string; amount: number }>(fx.sqlite, "SELECT kind, amount FROM ledger_entries WHERE kind = 'naming_penalty'");
    expect(entries).toEqual([{ kind: 'naming_penalty', amount: -1.678 }]);

    await expect(terminateNaming(fx.env, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('剩最后 1 窗退约：赔金 0，不产生流水', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 1 });
    const out = await terminateNaming(fx.env, 1);
    expect(out.penalty).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_penalty'")?.n).toBe(0);
  });
});

function seedContract(sqlite: DatabaseSync, opts: { windowsRemaining?: number; packageNo?: number; fee?: number } = {}) {
  const fee = opts.fee ?? 1.5;
  const pkgNo = opts.packageNo ?? 3;
  sqlite.exec(`
    INSERT INTO naming_contracts
      (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
       windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
       started_season, started_window, created_at, updated_at)
    VALUES (1, '可口可乐', 1.0, 1.5, ${pkgNo}, '对赌', ${fee},
            4, ${opts.windowsRemaining ?? 4}, 1.0, 0.8, 0.03, 'active',
            1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
}

describe('窗末收租（windowNamingStatements，并入关窗批）', () => {
  it('对赌套餐：上座达线发奖金；窗口数递减；费用与奖金各一条流水', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 4, packageNo: 3, fee: 1.5 });
    const row = sqlGet<never>(fx.sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
    const stmts = windowNamingStatements(fx.env, row, 1, 1, 0.85, 0.0);
    await fx.env.DB.batch(stmts);

    const entries = sqlAll<{ kind: string; amount: number }>(fx.sqlite, "SELECT kind, amount FROM ledger_entries WHERE ref_type = 'window' ORDER BY kind");
    expect(entries).toEqual([
      { kind: 'naming_bonus', amount: 1.0 },
      { kind: 'naming_fee', amount: 1.5 },
    ]);
    expect(sqlGet<{ windows_remaining: number }>(fx.sqlite, 'SELECT windows_remaining FROM naming_contracts WHERE club_id = 1')).toMatchObject({ windows_remaining: 3 });
  });

  it('不达线无奖金；非对赌套餐永不发奖金；减到 0 状态转 expired', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 1, packageNo: 3, fee: 1.5 });
    const row = sqlGet<never>(fx.sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
    // 上座 0.79 < 0.8、死忠增长 0.02 < 0.03 → 无奖金
    await fx.env.DB.batch(windowNamingStatements(fx.env, row, 1, 1, 0.79, 0.02));
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_bonus'")?.n).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM naming_contracts WHERE club_id = 1')).toMatchObject({ status: 'expired' });

    seedContract2(fx.sqlite);
    const row2 = sqlGet<never>(fx.sqlite, "SELECT * FROM naming_contracts WHERE club_id = 1 AND package_no = 1")!;
    await fx.env.DB.batch(windowNamingStatements(fx.env, row2, 1, 1, 0.99, 0.5));
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_bonus'")?.n).toBe(0);
  });
});

function seedContract2(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO naming_contracts
      (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
       windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
       started_season, started_window, created_at, updated_at)
    VALUES (1, '海底捞', 0.9, 1.5, 1, '稳健', 1.2,
            6, 2, 0, NULL, NULL, 'active',
            1, 1, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
  `);
}

describe('冠名路由', () => {
  it('quote 无约回 7 品牌报价；sign 后回现约；/me/club 下发 namingBrand', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const get = (path: string) => app.request(path, { headers: { Cookie: 'whl_session=tok-coach' } }, fx.env);
    const post = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-coach' }, body: JSON.stringify(body) }, fx.env);

    const quote = await get('/api/club/naming/quote');
    expect(quote.status).toBe(200);
    const qBody = (await quote.json()) as { brands: { brand: string; baseFee: number; packages: unknown[] }[] };
    expect(qBody.brands).toHaveLength(7);
    expect(qBody.brands[0]!.packages).toHaveLength(3);

    const sign = await post('/api/club/naming/sign', { brand: '亚马逊', packageNo: 2 });
    expect(sign.status).toBe(201);
    expect(((await sign.json()) as { contract: { brand: string } }).contract.brand).toBe('亚马逊');

    const quote2 = await get('/api/club/naming/quote');
    expect(((await quote2.json()) as { contract?: { brand: string } }).contract?.brand).toBe('亚马逊');

    const me = await get('/api/me/club');
    expect(((await me.json()) as { home: { namingBrand: string | null } }).home.namingBrand).toBe('亚马逊');
  });

  it('解约路由出赔金；重复签约 409；匿名 401', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const post = (path: string, body: unknown, cookie = 'whl_session=tok-coach') =>
      app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }, fx.env);

    await post('/api/club/naming/sign', { brand: '亚马逊', packageNo: 2 });
    const again = await post('/api/club/naming/sign', { brand: '海底捞', packageNo: 1 });
    expect(again.status).toBe(409);

    const term = await post('/api/club/naming/terminate', {});
    expect(term.status).toBe(201);
    expect(((await term.json()) as { penalty: number }).penalty).toBeGreaterThan(0);

    const anon = await post('/api/club/naming/sign', { brand: '海底捞', packageNo: 1 }, 'whl_session=none');
    expect(anon.status).toBe(401);
  });
});
