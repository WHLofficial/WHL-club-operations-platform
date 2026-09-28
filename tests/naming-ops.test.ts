// 冠名市场（v2.6.0）：底价公式与三套餐、签约快照与双签闸、解约赔金、窗末收租/对赌奖金、路由冒烟
// v6.8.0 冠名活化：品牌池落库（报价×行业系数）、续约（剩 1 窗重算）、热度动态（近 3 场全胜/全败）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  namingBaseFee, buildPackages, signNaming, terminateNaming, renewNaming, windowNamingStatements,
  quoteBrands, loadIndustryFactors, industryFactor, brandHeatDelta, windowBrandHeatStatement,
} from '../src/worker/naming-ops.ts';
import type { NamingParams, HeatRules } from '../src/worker/naming-ops.ts';

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
  };
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
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

  it('品牌池：迁移种子 7 家落库、重跑幂等、热度覆盖 0.7-1.3', () => {
    const fx = freshEnv();
    const rows = sqlAll<{ brand: string; heat: number; status: string }>(fx.sqlite, 'SELECT brand, heat, status FROM brand_pool ORDER BY id');
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.brand)).toContain('亚马逊');
    expect(rows.map((r) => r.heat)).toEqual([1.2, 1.1, 1.3, 1.0, 0.9, 0.8, 0.7]);
    expect(rows.every((r) => r.status === 'adopted')).toBe(true);
    // 种子语句幂等：同一条 INSERT OR IGNORE 再跑不重复（迁移文件整体重跑会撞 CREATE TABLE，故只重跑种子句）
    fx.sqlite.exec(
      `INSERT OR IGNORE INTO brand_pool (brand, heat, source, status, industry, created_at)
       VALUES ('亚马逊', 1.3, 'builtin', 'adopted', '科技', 'x')`,
    );
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM brand_pool')?.n).toBe(7);
  });

  it('行业系数：报价 = 底价×行业系数；未登记行业回 1.0；非法配置剔除', async () => {
    const fx = freshEnv();
    const factors = await loadIndustryFactors(fx.env.DB);
    expect(factors).toMatchObject({ 医疗: 1.2, 科技: 1.3, 饮食: 1.0 });
    expect(industryFactor(factors, '不存在行业')).toBe(1.0);
    // 亚马逊（科技 1.3）：namingBaseFee 1.711 × 1.3 = 2.2243 → 2.224
    const pool = [
      { id: 1, brand: '亚马逊', heat: 1.3, source: 'builtin', status: 'adopted', industry: '科技', tier: '头部', tier_locked: 0, created_at: 'x' },
    ];
    const quotes = quoteBrands(PARAMS, pool, 20000, 18000, factors);
    expect(quotes[0]!.baseFee).toBe(2.224);
    expect(quotes[0]!.packages.map((p) => p.feePerWindow)).toEqual([1.89, 2.78, 1.557]); // ×0.85 / ×1.25 / ×0.7
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
      base_fee: 2.224, // (0.5+0.6+0.216)×1.3=1.711 → ×行业系数(科技)1.3 = 2.224
      package_no: 3,
      pkg_name: '对赌',
      fee_per_window: 1.557, // 2.224×0.7
      windows_total: 4,
      windows_remaining: 4,
      bonus_amount: 1.09, // 1.557×0.7
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

  it('闸：弃用品牌签约 400（品牌池 status 过滤，不只看名字存在）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    fx.sqlite.exec("UPDATE brand_pool SET status = 'discarded' WHERE brand = '阿迪达斯'");
    await expect(signNaming(fx.env, 1, '阿迪达斯', 1)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('不在品牌池'),
    });
    // 恢复后同一品牌即可签
    fx.sqlite.exec("UPDATE brand_pool SET status = 'adopted' WHERE brand = '阿迪达斯'");
    await expect(signNaming(fx.env, 1, '阿迪达斯', 1)).resolves.toMatchObject({ brand: '阿迪达斯' });
  });

  it('提前解约：赔剩余窗口费用 30%（remaining−1），账本记 naming_penalty；无赔金只改状态', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    await signNaming(fx.env, 1, '可口可乐', 1); // fee = 0.5×0.85=0.425×... 实算 (0.5+0.6+0.216)×1.0=1.316 → 1.316? heat 1.0 → 1.316
    const out = await terminateNaming(fx.env, 1, 1);
    // 稳健 fee = 1.316×0.85 = 1.119；赔 (6−1)×1.119×0.3 = 1.6785 → 1.678
    expect(out).toEqual({ brand: '可口可乐', penalty: 1.678, windowsRemaining: 6 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM naming_contracts WHERE club_id = 1')).toMatchObject({ status: 'terminated' });
    const entries = sqlAll<{ kind: string; amount: number }>(fx.sqlite, "SELECT kind, amount FROM ledger_entries WHERE kind = 'naming_penalty'");
    expect(entries).toEqual([{ kind: 'naming_penalty', amount: -1.678 }]);
    // 留痕：操作人 + 状态变更 + 赔款口径（既赔了几窗、赔了多少）
    const audit = sqlGet<{ actor: number | null; target_type: string; target_id: number; before: string; after: string }>(
      fx.sqlite,
      "SELECT actor, target_type, target_id, before, after FROM audit_log WHERE action = 'naming_terminate'",
    )!;
    expect(audit).toMatchObject({ actor: 1, target_type: 'naming_contract' });
    expect(JSON.parse(audit.before)).toEqual({ status: 'active', windowsRemaining: 6 });
    expect(JSON.parse(audit.after)).toEqual({ status: 'terminated', windowsRemaining: 6, penalty: 1.678, remainingWindowsCharged: 5 });

    await expect(terminateNaming(fx.env, 1, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('剩最后 1 窗退约：赔金 0，不产生流水', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 1 });
    const out = await terminateNaming(fx.env, 1, 1);
    expect(out.penalty).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'naming_penalty'")?.n).toBe(0);
    // 赔金为 0 也留痕：状态变更本身要可追溯
    const audit = sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'naming_terminate'")!;
    expect(JSON.parse(audit.after)).toMatchObject({ status: 'terminated', penalty: 0, remainingWindowsCharged: 0 });
  });
});

function seedContract(sqlite: DatabaseSync, opts: { windowsRemaining?: number; packageNo?: number; fee?: number; brand?: string } = {}) {
  const fee = opts.fee ?? 1.5;
  const pkgNo = opts.packageNo ?? 3;
  const brand = opts.brand ?? '可口可乐';
  sqlite.exec(`
    INSERT INTO naming_contracts
      (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
       windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status,
       started_season, started_window, created_at, updated_at)
    VALUES (1, '${brand}', 1.0, 1.5, ${pkgNo}, '对赌', ${fee},
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

// 近 3 场赛果夹具（本队 tour 队 id 恒 9001，对手 9002；match_id 递增保持 id 序 = 时间序）
function seedResults(sqlite: DatabaseSync, scores: [number, number][]) {
  scores.forEach(([h, a], i) => {
    sqlite.exec(`INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id, score_home, score_away)
      VALUES (1, 1, 1, ${100 + i}, 9001, 9002, ${h}, ${a})`);
  });
}

describe('续约（v6.8.0：剩最后 1 窗按当期队况重算，插件 renew 口径）', () => {
  it('剩 1 窗可续：按品牌现热度重算费用条款，剩余窗数重置、签约窗随之更新', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 1, packageNo: 3, fee: 1.5, brand: '可口可乐' });
    fx.sqlite.exec("UPDATE brand_pool SET heat = 1.5 WHERE brand = '可口可乐'");
    const row = await renewNaming(fx.env, 1, 1, 1); // 稳健
    // 可口可乐 heat 1.5：(0.5+0.6+0.216)×1.5 = 1.974 → 行业(饮食)1.0 → 稳健 ×0.85 = 1.6779 → 1.678
    expect(row).toMatchObject({
      brand: '可口可乐', brand_heat: 1.5, base_fee: 1.974, package_no: 1, pkg_name: '稳健',
      fee_per_window: 1.678, windows_total: 6, windows_remaining: 6, bonus_amount: 0, status: 'active',
    });
    const audit = sqlGet<{ before: string; after: string }>(fx.sqlite, "SELECT before, after FROM audit_log WHERE action = 'naming_renew'")!;
    expect(JSON.parse(audit.before)).toMatchObject({ feePerWindow: 1.5, packageNo: 3 });
    expect(JSON.parse(audit.after)).toMatchObject({ feePerWindow: 1.678, packageNo: 1, windowsTotal: 6 });
  });

  it('闸：非最后 1 窗 400 / 套餐号非法 400 / 无合同 404', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 2 });
    await expect(renewNaming(fx.env, 1, 1, 1)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('最后 1 窗') });
    await expect(renewNaming(fx.env, 1, 9, 1)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('套餐号') });
    const bare = freshEnv();
    seedClub(bare.sqlite);
    await expect(renewNaming(bare.env, 1, 1, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('闸：窗口没开 409 / 品牌已弃用 409', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { windowsRemaining: 1 });
    fx.sqlite.exec("UPDATE brand_pool SET status = 'discarded' WHERE brand = '可口可乐'");
    await expect(renewNaming(fx.env, 1, 1, 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('不在池中') });

    const fx2 = freshEnv();
    seedClub(fx2.sqlite);
    seedContract(fx2.sqlite, { windowsRemaining: 1 });
    fx2.sqlite.exec("UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1");
    await expect(renewNaming(fx2.env, 1, 1, 1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('窗口没开') });
  });
});

describe('品牌热度动态（近 3 场全胜/全败，v6.8.0）', () => {
  const RULES: HeatRules = { winStreak: 0.03, slump: 0.02, clampLow: 0.5, clampHigh: 1.5, champion: 0.1 };
  const r = (h: number | null, a: number | null, extra: Record<string, unknown> = {}) => ({
    home_team_id: 9001, away_team_id: 9002, score_home: h, score_away: a, walkover_side: null, ...extra,
  });

  it('三胜 +winStreak、三负 −slump、两胜一平不动、不足 3 场不动', () => {
    expect(brandHeatDelta([r(1, 0), r(2, 1), r(3, 0)], 9001, RULES)).toBe(0.03);
    expect(brandHeatDelta([r(0, 1), r(1, 2), r(0, 3)], 9001, RULES)).toBe(-0.02);
    expect(brandHeatDelta([r(1, 0), r(2, 0), r(1, 1)], 9001, RULES)).toBeNull();
    expect(brandHeatDelta([r(1, 0), r(2, 0)], 9001, RULES)).toBeNull();
  });

  it('点球决胜按平计；弃权按 winner 记；无效行不计名额', () => {
    // 两胜 + 一场点球（1:1 点球 4:3 胜）→ 出现平 → 不动
    expect(brandHeatDelta([r(1, 0), r(2, 0), r(1, 1, { pen_home: 4, pen_away: 3 })], 9001, RULES)).toBeNull();
    // 弃权：walkover_side 记的是**取胜方**（仓库既有口径，见 home.ts formPtsOf）——home 弃权记法=主队胜
    expect(brandHeatDelta([r(0, 0, { walkover_side: 'home' }), r(1, 0), r(2, 0)], 9001, RULES)).toBe(0.03);
    expect(brandHeatDelta([r(0, 0, { walkover_side: 'away' }), r(1, 0), r(2, 0)], 9001, RULES)).toBeNull(); // 主队判负 → 两胜一负
    // 无比分行跳过（不计名额）
    expect(brandHeatDelta([r(null, null), r(1, 0), r(2, 0), r(3, 0)], 9001, RULES)).toBe(0.03);
    // 本队是客队的记法（away_team_id = 9001）
    expect(
      brandHeatDelta([{ home_team_id: 9002, away_team_id: 9001, score_home: 0, score_away: 1, walkover_side: null }], 9001, RULES),
    ).toBeNull(); // 不足 3 场
  });

  it('SQL 侧钳制累加两端：1.49+0.03→1.5、0.51−0.02→0.5；弃用品牌不调', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { brand: '可口可乐' });
    seedResults(fx.sqlite, [[2, 0], [1, 0], [3, 1]]);
    const row = sqlGet<never>(fx.sqlite, "SELECT * FROM naming_contracts WHERE club_id = 1")!;
    fx.sqlite.exec("UPDATE brand_pool SET heat = 1.49 WHERE brand = '可口可乐'");
    await fx.env.DB.batch([(await windowBrandHeatStatement(fx.env, row, 9001))!]);
    expect(sqlGet<{ heat: number }>(fx.sqlite, "SELECT heat FROM brand_pool WHERE brand = '可口可乐'")?.heat).toBe(1.5);
    expect(sqlGet<{ heat: number }>(fx.sqlite, "SELECT heat FROM brand_pool WHERE brand = '可口可乐'")?.heat).toBe(1.5);

    fx.sqlite.exec("DELETE FROM result_confirmations");
    seedResults(fx.sqlite, [[0, 1], [1, 2], [0, 3]]);
    fx.sqlite.exec("UPDATE brand_pool SET heat = 0.51 WHERE brand = '可口可乐'");
    await fx.env.DB.batch([(await windowBrandHeatStatement(fx.env, row, 9001))!]);
    expect(sqlGet<{ heat: number }>(fx.sqlite, "SELECT heat FROM brand_pool WHERE brand = '可口可乐'")?.heat).toBe(0.5);

    // 弃用后热度不再演化（status 守卫）
    fx.sqlite.exec("DELETE FROM result_confirmations; UPDATE brand_pool SET status = 'discarded', heat = 1.0 WHERE brand = '可口可乐'");
    seedResults(fx.sqlite, [[2, 0], [1, 0], [3, 1]]);
    await fx.env.DB.batch([(await windowBrandHeatStatement(fx.env, row, 9001))!]);
    expect(sqlGet<{ heat: number }>(fx.sqlite, "SELECT heat FROM brand_pool WHERE brand = '可口可乐'")?.heat).toBe(1.0);
  });

  it('不足 3 场不出语句（null）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite);
    seedResults(fx.sqlite, [[2, 0]]);
    const row = sqlGet<never>(fx.sqlite, 'SELECT * FROM naming_contracts WHERE club_id = 1')!;
    expect(await windowBrandHeatStatement(fx.env, row, 9001)).toBeNull();
  });
});

describe('品牌池管理路由（v6.8.0）', () => {
  const getAs = (path: string, env: Env, cookie: string) => app.request(path, { headers: { Cookie: cookie } }, env);
  const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-admin') =>
    app.request(path, { method, headers: { 'content-type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

  it('GET 列表带 active_contracts；POST 新增自定义品牌；重名 409、热度越界 400、空名 400', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { brand: '可口可乐' });
    const list = await getAs('/api/admin/brands', fx.env, 'whl_session=tok-admin');
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { brands: { brand: string; active_contracts: number }[] };
    expect(rows.brands).toHaveLength(7);
    expect(rows.brands.find((b) => b.brand === '可口可乐')?.active_contracts).toBe(1);

    const add = await send('POST', '/api/admin/brands', fx.env, { brand: '某新品牌', heat: 1.4, industry: '科技' });
    expect(add.status).toBe(201);
    expect((await send('POST', '/api/admin/brands', fx.env, { brand: '某新品牌', heat: 1.0 })).status).toBe(409);
    expect((await send('POST', '/api/admin/brands', fx.env, { brand: '越界牌', heat: 1.9 })).status).toBe(400);
    expect((await send('POST', '/api/admin/brands', fx.env, { brand: '冷牌', heat: 0.4 })).status).toBe(400);
    expect((await send('POST', '/api/admin/brands', fx.env, { brand: '   ', heat: 1.0 })).status).toBe(400);
  });

  it('PATCH 改热度/行业；弃用有合同的品牌 409；无合同可弃用并即刻退出报价池；教练 403 / 匿名 401', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    seedContract(fx.sqlite, { brand: '可口可乐' });
    const id = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM brand_pool WHERE brand = '可口可乐'")!.id;
    const ok = await send('PATCH', `/api/admin/brands/${id}`, fx.env, { heat: 1.1, industry: '饮食' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { brand: { heat: number } }).brand.heat).toBe(1.1);
    expect((await send('PATCH', `/api/admin/brands/${id}`, fx.env, { status: 'discarded' })).status).toBe(409);

    const id2 = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM brand_pool WHERE brand = '海底捞'")!.id;
    expect((await send('PATCH', `/api/admin/brands/${id2}`, fx.env, { status: 'discarded' })).status).toBe(200);

    expect((await send('PATCH', '/api/admin/brands/9999', fx.env, { heat: 1.0 })).status).toBe(404);
    // 空 body / 只带无关字段：400，不落空转 UPDATE 与审计
    expect((await send('PATCH', `/api/admin/brands/${id2}`, fx.env, {})).status).toBe(400);
    expect((await send('PATCH', `/api/admin/brands/${id2}`, fx.env, { brand: '改名' })).status).toBe(400);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'brand_update'")!.n).toBe(2);
    expect((await getAs('/api/admin/brands', fx.env, 'whl_session=tok-coach')).status).toBe(403);
    expect((await getAs('/api/admin/brands', fx.env, 'whl_session=none')).status).toBe(401);
  });

  it('弃用品牌退出报价池（quote 只出 adopted）；续约路由：剩 1 窗 201，续后非最后窗 400', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite);
    const id2 = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM brand_pool WHERE brand = '海底捞'")!.id;
    await send('PATCH', `/api/admin/brands/${id2}`, fx.env, { status: 'discarded' });
    const quote = await getAs('/api/club/naming/quote', fx.env, 'whl_session=tok-coach');
    const qb = (await quote.json()) as { brands: { brand: string }[] };
    expect(qb.brands).toHaveLength(6);
    expect(qb.brands.map((b) => b.brand)).not.toContain('海底捞');

    seedContract(fx.sqlite, { windowsRemaining: 1 });
    const renew = await send('POST', '/api/club/naming/renew', fx.env, { packageNo: 2 }, 'whl_session=tok-coach');
    expect(renew.status).toBe(201);
    expect(((await renew.json()) as { contract: { windowsRemaining: number } }).contract.windowsRemaining).toBe(2);
    // 续约后剩 2 窗（进取套餐），再续被门槛拦
    expect((await send('POST', '/api/club/naming/renew', fx.env, { packageNo: 2 }, 'whl_session=tok-coach')).status).toBe(400);
  });
});

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
