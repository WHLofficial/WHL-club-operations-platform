// v6.51.0 批 1/2/3 读侧与招商性格：落点名（venue_name）· 企业档案 DTO/管理端校验 ·
// 招商性格递套餐 · 偏好标签（递价排序 + 情绪加成）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  evolveSatisfactionForClub,
  loadSatisfyConfig,
  loadTierProfiles,
  parseBetTerms,
  parsePreferTags,
} from '../src/worker/naming-ops.ts';
import { buildRoundStatements, loadClubSignals, packageNoForBrand, packageNoForTier, preferHitCount, spawnVisitOffer } from '../src/worker/market-ops.ts';
import { signViaOffer } from './market-helpers.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
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
  return { env, sqlite, kv };
}

/** 俱乐部（容量 / 死忠可调）+ 球场名（落点名合成用）；bindUser 给了才写教练绑定（一 user 一俱乐部） */
function seedClub(sqlite: DatabaseSync, id: number, opts: { name?: string; capacity?: number; fans?: number; bindUser?: number } = {}): void {
  const name = opts.name ?? `球场${id}`;
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (${id}, '球队${id}', 'premier', 'active');
    INSERT INTO stadiums (club_id, name, capacity, tier, fans) VALUES (${id}, '${name}', ${opts.capacity ?? 20000}, 0, ${opts.fans ?? 18000});
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (${id}, 50, '2026-01-01T00:00:00Z');
  `);
  if (opts.bindUser !== undefined) {
    sqlite.exec(`INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${id}, ${opts.bindUser}, '2026-01-01T00:00:00Z')`);
  }
}

function openWindow(sqlite: DatabaseSync, season: number, windowSeq: number): void {
  sqlite.exec(
    `INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (${season}, ${windowSeq}, 'open', '2026-07-01T00:00:00Z')`,
  );
}

const getAs = (path: string, env: Env, cookie: string) => app.request(path, { headers: { Cookie: cookie } }, env);
const send = (method: string, path: string, env: Env, body?: unknown, cookie = 'whl_session=tok-admin') =>
  app.request(path, { method, headers: { 'content-type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

describe('招商性格递什么套餐（v6.51.0 批 3）', () => {
  it('packageNoForBrand：稳健 1 / 进取 2 / 对赌 3；未登记回落档位映射（头部 2、其余 1）', () => {
    expect(packageNoForBrand('头部', '稳健')).toBe(1); // 头部大牌但性格稳健 ⇒ 递稳健（不被档位覆盖）
    expect(packageNoForBrand('口碑', '进取')).toBe(2);
    expect(packageNoForBrand('口碑', '对赌')).toBe(3);
    expect(packageNoForBrand('头部', '')).toBe(packageNoForTier('头部')); // 未登记 → 2
    expect(packageNoForBrand('新兴', '')).toBe(packageNoForTier('新兴')); // 未登记 → 1
    expect(packageNoForBrand('口碑', '没这个词')).toBe(1); // 脏数据不抛错，回落档位
  });

  it('事件上门按性格递套餐：对赌品牌递 package_no=3，稳健品牌递 1', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    openWindow(fx.sqlite, 1, 1);
    fx.sqlite.exec(`UPDATE market_rounds SET status = 'settled' WHERE status = 'open'`);
    await fx.env.DB.prepare(
      `INSERT INTO market_rounds (opened_season, opened_window, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z')`,
    ).run();
    // 只留一家对赌品牌，行内加权随机会必然抽到它
    fx.sqlite.exec(`UPDATE brand_pool SET status = 'discarded'`);
    fx.sqlite.exec(`UPDATE brand_pool SET status = 'adopted' WHERE brand = '比特兰科技'`); // style='对赌'（tier 口碑）
    // guardSql 在生产由 event-ops 传（occurrence pending 守卫，带 1 个占位符绑 occurrenceId）
    const visit = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, 1, '? IS NOT NULL');
    expect(visit.applied).not.toBeNull();
    const offer = sqlGet<{ package_no: number; windows: number }>(
      fx.sqlite,
      `SELECT o.package_no, o.windows FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id WHERE b.brand = '比特兰科技'`,
    )!;
    expect(offer.package_no).toBe(3); // 对赌套餐（4 窗）
    expect(offer.windows).toBe(4);

    // 同轮同品牌同队已有报价 ⇒ 落空播报，不撞唯一索引
    const again = await spawnVisitOffer(fx.env, { clubId: 1, capacity: 20000, fans: 18000 }, 1, '? IS NOT NULL');
    expect(again.statements).toHaveLength(0);
    expect(again.notes.join('')).toContain('落空');
  });

  it('招商轮递价：prefer 命中的队排前（同品牌先递给它），与纯估值序不同', async () => {
    const fx = freshEnv();
    // 3 队：1 号容量/死忠最大（估值最高）、3 号最小但上赛季上座率最高（命中「高上座」）
    seedClub(fx.sqlite, 1, { name: '大场', capacity: 40000, fans: 30000 });
    seedClub(fx.sqlite, 2, { name: '中场', capacity: 20000, fans: 15000 });
    seedClub(fx.sqlite, 3, { name: '小场', capacity: 8000, fans: 6000 });
    openWindow(fx.sqlite, 2, 1);
    // 上赛季（season 1）上座：3 号 0.99、1/2 号 0.25
    fx.sqlite.exec(`
      INSERT INTO match_attendance (match_id, club_id, season, window_seq, attendance, ticket, commercial, broadcast)
      VALUES (1, 1, 1, 1, 10000, 0, 0, 0), (2, 1, 1, 2, 10000, 0, 0, 0),
             (3, 2, 1, 1, 5000, 0, 0, 0),  (4, 2, 1, 2, 5000, 0, 0, 0),
             (5, 3, 1, 1, 7900, 0, 0, 0),  (6, 3, 1, 2, 7900, 0, 0, 0);
    `);
    fx.sqlite.exec(`UPDATE brand_pool SET status = 'discarded'`);
    fx.sqlite.exec(
      `INSERT INTO brand_pool (brand, heat, source, status, industry, tier, style, prefer, created_at)
       VALUES ('偏牌一号', 1.0, 'custom', 'adopted', '科技', '头部', '', '高上座', 'x')`,
    );
    const signals = await loadClubSignals(fx.env, 2);
    expect([...signals.get(3)!]).toEqual(['高上座']);
    expect(signals.get(1)?.has('高上座') ?? false).toBe(false);
    expect(preferHitCount(parsePreferTags('高上座'), signals.get(3))).toBe(1);
    expect(preferHitCount(parsePreferTags('高上座'), signals.get(1))).toBe(0);

    const build = await buildRoundStatements(fx.env, 2, 1);
    await fx.env.DB.batch(build.settleStatements);
    await fx.env.DB.batch(build.openStatements);
    const rows = sqlAll<{ club_id: number }>(
      fx.sqlite,
      `SELECT o.club_id FROM market_offers o JOIN brand_pool b ON b.id = o.brand_id WHERE b.brand = '偏牌一号' ORDER BY o.id`,
    );
    // 头部品牌只递 2 队：prefer 命中让 3 号（估值最低）也进面 —— 纯估值序会是 [1, 2]
    expect(rows.map((r) => r.club_id)).toEqual([3, 1]);
  });
});

describe('企业档案与性格（v6.51.0 批 2/3）读侧与管理端', () => {
  it('GET /api/admin/brands 行带档案 7 列 + 性格 2 列（28 家配种齐备）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    const res = await getAs('/api/admin/brands', fx.env, 'whl_session=tok-admin');
    const body = (await res.json()) as {
      brands: { brand: string; name_en: string; color: string; slogan: string; hq: string; intro: string; origin: string; style: string; prefer: string }[];
    };
    expect(body.brands).toHaveLength(28);
    const ovien = body.brands.find((b) => b.brand === '奥维恩')!;
    expect(ovien).toMatchObject({ name_en: 'OVIEN', color: '#1E4E8C', slogan: '算力所指，皆是主场', hq: '都柏林', origin: '', style: '进取', full_name: '奥维恩科技集团' });
    expect(ovien.intro.length).toBeGreaterThan(0);
    expect(ovien.prefer).toContain('冠军相');
    expect(body.brands.find((b) => b.brand === '星海通讯')).toMatchObject({ origin: '中资', hq: '深圳' });
    expect(body.brands.find((b) => b.brand === '比特兰科技')!.style).toBe('对赌');
  });

  it('POST 新增品牌带档案；color / origin / style / prefer / 长度校验一律 400', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    const ok = await send('POST', '/api/admin/brands', fx.env, {
      brand: '档案牌',
      heat: 1.0,
      industry: '科技',
      nameEn: 'DANGAN',
      fullName: '档案牌集团',
      color: '#123ABC',
      slogan: '档案在手',
      hq: '汉堡',
      intro: '简介一行',
      origin: '中资',
      style: '对赌',
      prefer: ' 冠军相 , 大场馆 ',
    });
    expect(ok.status).toBe(201);
    const created = sqlGet<{ id: number; prefer: string; origin: string; style: string; name_en: string }>(
      fx.sqlite,
      `SELECT id, prefer, origin, style, name_en FROM brand_pool WHERE brand = '档案牌'`,
    )!;
    expect(created).toMatchObject({ prefer: '冠军相,大场馆', origin: '中资', style: '对赌', name_en: 'DANGAN' }); // prefer 去空格归一

    const bad = async (body: Record<string, unknown>) => (await send('POST', '/api/admin/brands', fx.env, { brand: `坏牌${Math.random()}`, heat: 1.0, ...body })).status;
    expect(await bad({ color: '123ABC' })).toBe(400); // 缺 # / 非 6 位
    expect(await bad({ color: '#12345G' })).toBe(400);
    expect(await bad({ origin: '外资' })).toBe(400); // 只认 '' / 中资
    expect(await bad({ style: '激进' })).toBe(400);
    expect(await bad({ prefer: '冠军相,爆款' })).toBe(400); // 标签必须在词表内
    expect(await bad({ prefer: '冠军相,高上座,死忠规模,大场馆' })).toBe(400); // 最多 3 个
    expect(await bad({ nameEn: 'X'.repeat(41) })).toBe(400);
    expect(await bad({ fullName: '公'.repeat(31) })).toBe(400);
    expect(await bad({ slogan: '口'.repeat(21) })).toBe(400);
    expect(await bad({ hq: '城'.repeat(21) })).toBe(400);
    expect(await bad({ intro: '简'.repeat(81) })).toBe(400);
    // 合法边界：正好卡在长度上限
    expect((await send('POST', '/api/admin/brands', fx.env, { brand: '卡线牌', heat: 1.0, nameEn: 'X'.repeat(40), intro: '简'.repeat(80) })).status).toBe(201);
  });

  it('PATCH 只覆盖给到的字段；档案字段进审计；非法值 400 不改库', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    const id = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM brand_pool WHERE brand = '奥维恩'")!.id;
    const ok = await send('PATCH', `/api/admin/brands/${id}`, fx.env, { slogan: '新口号', prefer: '' });
    expect(ok.status).toBe(200);
    const row = sqlGet<{ slogan: string; prefer: string; hq: string; name_en: string }>(
      fx.sqlite,
      `SELECT slogan, prefer, hq, name_en FROM brand_pool WHERE brand = '奥维恩'`,
    )!;
    expect(row).toMatchObject({ slogan: '新口号', prefer: '', hq: '都柏林', name_en: 'OVIEN' }); // 未给的字段保持原值
    const audit = sqlGet<{ before: string; after: string }>(
      fx.sqlite,
      "SELECT before, after FROM audit_log WHERE action = 'brand_update' ORDER BY id DESC LIMIT 1",
    )!;
    expect(JSON.parse(audit.before)).toMatchObject({ slogan: '算力所指，皆是主场', prefer: '冠军相,大场馆' });
    expect(JSON.parse(audit.after)).toMatchObject({ slogan: '新口号', prefer: '' });

    expect((await send('PATCH', `/api/admin/brands/${id}`, fx.env, { color: 'red' })).status).toBe(400);
    expect((await send('PATCH', `/api/admin/brands/${id}`, fx.env, { origin: '港资' })).status).toBe(400);
    expect((await send('PATCH', `/api/admin/brands/${id}`, fx.env, { style: '对赌x' })).status).toBe(400);
    expect((await send('PATCH', `/api/admin/brands/${id}`, fx.env, { prefer: '冠军相,冠军相' })).status).toBe(400); // 去重后仍要求 1–3 个互不相同
    expect(sqlGet<{ slogan: string }>(fx.sqlite, `SELECT slogan FROM brand_pool WHERE id = ${id}`)!.slogan).toBe('新口号'); // 400 不动库
  });
});

describe('偏好标签的情绪加成（v6.51.0 批 3）', () => {
  it('命中 1 个 +0.02、3 个封顶 +0.04；0 命中与现状逐字一致', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1);
    const cfg = await loadSatisfyConfig(fx.env.DB);
    expect(cfg).toMatchObject({ preferBonus: 0.02, preferBonusCap: 0.04 });
    const profiles = await loadTierProfiles(fx.env.DB);
    const profile = profiles.口碑!;
    // naming_contracts.club_id 唯一（一队一约）⇒ 同一行反复演化，每次前把情绪复位
    fx.sqlite.exec(`
      INSERT INTO naming_contracts
        (id, club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
         windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, status, satisfaction,
         started_season, started_window, created_at, updated_at)
      VALUES (9, 1, '偏牌', 1.0, 1.0, 3, '对赌', 0.7,
              4, 3, 0.5, 0.8, 0.03, 'active', 1.0, 2, 1, 'x', 'x');
    `);
    const run = async (hits: number) => {
      fx.sqlite.exec(`UPDATE naming_contracts SET satisfaction = 1.0 WHERE id = 9`);
      const contract = sqlGet<Parameters<typeof evolveSatisfactionForClub>[1]>(fx.sqlite, `SELECT * FROM naming_contracts WHERE id = 9`)!;
      const out = await evolveSatisfactionForClub(fx.env, contract, undefined, 2, 1, 0, profile, cfg, hits);
      await fx.env.DB.batch(out.statements);
      return out.report;
    };
    expect((await run(0)).to).toBe(1.0); // 无信号无命中：delta 0（与 v6.51.0 之前一致）
    expect((await run(1)).to).toBe(1.02); // 命中 1 个 +0.02
    expect((await run(9)).to).toBe(1.04); // 命中数再多也封顶 0.04
  });
});

describe('落点名（v6.51.0 批 1）：写入与读侧', () => {
  it('签约写 venue_name = 品牌·球场名；/api/me/club 与 quote 都下发落点名', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1, { name: '老特拉福德', bindUser: 1 });
    openWindow(fx.sqlite, 1, 1);
    const contract = await signViaOffer(fx.env, 1, '奥维恩', 2);
    expect(contract.venue_name).toBe('奥维恩·老特拉福德');

    const me = await getAs('/api/me/club', fx.env, 'whl_session=tok-coach');
    const home = ((await me.json()) as { home: { name: string; namingBrand: string | null; namingVenueName: string | null } }).home;
    expect(home).toMatchObject({ name: '老特拉福德', namingBrand: '奥维恩', namingVenueName: '奥维恩·老特拉福德' });

    const quote = await getAs('/api/club/naming/quote', fx.env, 'whl_session=tok-coach');
    const body = (await quote.json()) as {
      contract: { brand: string; venueName: string | null; brandProfile: { nameEn: string; hq: string; style: string } | null; betTerms: unknown };
      offers: unknown[];
    };
    expect(body.contract.venueName).toBe('奥维恩·老特拉福德');
    expect(body.contract.brandProfile).toMatchObject({ nameEn: 'OVIEN', hq: '都柏林', style: '进取' });
    expect(body.contract.betTerms).toBeNull(); // 进取套餐不抽签
    expect(body.offers).toEqual([]);
  });

  it('老合同 venue_name 为空 ⇒ 读侧按现球场名现拼（升级后不改库也显示对）', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1, { name: '酋长球场', bindUser: 1 });
    openWindow(fx.sqlite, 1, 1);
    fx.sqlite.exec(`
      INSERT INTO naming_contracts
        (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window,
         windows_total, windows_remaining, bonus_amount, bet_attend, bet_fans, venue_name, status,
         started_season, started_window, created_at, updated_at)
      VALUES (1, '维洛', 1.1, 1.0, 1, '稳健', 0.85,
              6, 5, 0, NULL, NULL, '', 'active', 1, 1, 'x', 'x');
    `);
    const me = await getAs('/api/me/club', fx.env, 'whl_session=tok-coach');
    expect(((await me.json()) as { home: { namingVenueName: string | null } }).home.namingVenueName).toBe('维洛·酋长球场');
    // 解约后落点名随约消失
    fx.sqlite.exec(`UPDATE naming_contracts SET status = 'terminated' WHERE club_id = 1`);
    const after = await getAs('/api/me/club', fx.env, 'whl_session=tok-coach');
    expect(((await after.json()) as { home: { namingVenueName: string | null } }).home.namingVenueName).toBeNull();
  });

  it('报价收件箱（listClubOffers）带落点名预告与品牌档案', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1, { name: '糖果盒', bindUser: 1 });
    openWindow(fx.sqlite, 1, 1);
    const { seedOffer } = await import('./market-helpers.ts');
    await seedOffer(fx.env, 1, '比特兰科技', 3); // style='对赌'、prefer='冠军相,大场馆'
    const quote = await getAs('/api/club/naming/quote', fx.env, 'whl_session=tok-coach');
    const offers = ((await quote.json()) as { offers: { brand: string; venueName: string; packageNo: number; brandProfile: { hq: string; style: string; slogan: string } | null }[] }).offers;
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ brand: '比特兰科技', venueName: '比特兰科技·糖果盒', packageNo: 3 });
    expect(offers[0]!.brandProfile).toMatchObject({ hq: '塔林', style: '对赌' });
    expect(offers[0]!.brandProfile!.slogan.length).toBeGreaterThan(0);
  });

  it('对赌合同签约即抽签：bet_terms 快照可解析（v2 / 两条异族），续约按当期队况重抽', async () => {
    const fx = freshEnv();
    seedClub(fx.sqlite, 1, { name: '球场甲', bindUser: 1 });
    openWindow(fx.sqlite, 1, 1);
    const contract = await signViaOffer(fx.env, 1, '比特兰科技', 3);
    const terms = parseBetTerms(contract.bet_terms)!;
    expect(terms.v).toBe(2);
    expect(terms.items.length).toBeGreaterThanOrEqual(1);
    expect(terms.seed).toEqual([1, 1, 1, terms.seed[3]]);
    expect(terms.items.every((i) => i.threshold > 0)).toBe(true);
    // 关窗批口径：结算拿得到快照（读侧 DTO 也就带出来了）
    const quote = await getAs('/api/club/naming/quote', fx.env, 'whl_session=tok-coach');
    const dto = ((await quote.json()) as { contract: { betTerms: { v: number; items: unknown[] } | null } }).contract;
    expect(dto.betTerms).toMatchObject({ v: 2 });
    expect(dto.betTerms!.items.length).toBe(terms.items.length);
  });
});
