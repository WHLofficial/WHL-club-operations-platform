// v3.2.0 步骤 4：排序表达式索引必须与查询表达式同源——用真实路由抓下来的 SQL 跑 EXPLAIN QUERY PLAN 锁死。
// 表达式索引只有在表达式树逐字相等时才生效：排序表达式一改，索引就静默失效（退回全表扫 + 临时排序，
// 读量涨约 1000 倍），而功能测试全绿、接口返回一模一样。所以这里不看结果，看执行计划。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { sqlFold } from '../src/core/name-fold.ts';
import { PS_SLOT_COUNT } from '../src/core/fc26.ts';
import { applyMigrations, createTestD1, createTestKV } from './d1.ts';

// [排序键, 索引名, 额外查询参数, 等值筛选参数]：0027 四条（ca/pa/age/market_value）+ 0029 三条（prestige/club/status）
// + 0033 一条（name，v4.0.0 把排序键从折叠的官方缩写名换成折叠的显示名时一并补上）
// + 0034 三条（uid / ps / view=initial 下的 ca，遗留项第 5 节 D1 读量治理的下一批次）
// + 0035 两条（position / growable，两条常驻列）+ 0036 三条（badges / base_ca / foot）
// + 0038 两条（growth_tier / future_star）。等值筛选用哪种写法（同键裸列 / 异键同源）由下面 v6.4.1 的
// describe 单独锁 —— 本列表只管排序表达式与索引同源这一件事。
const INDEXED_SORTS: ReadonlyArray<readonly [sort: string, index: string, extra?: string]> = [
  ['ca', 'idx_players_sort_ca'],
  ['pa', 'idx_players_sort_pa'],
  ['age', 'idx_players_sort_age'],
  ['market_value', 'idx_players_sort_market_value'],
  ['prestige', 'idx_players_sort_prestige'],
  ['club', 'idx_players_sort_club'],
  ['status', 'idx_players_sort_status'],
  ['name', 'idx_players_sort_name'],
  ['uid', 'idx_players_sort_uid'],
  ['ps', 'idx_players_sort_ps'],
  // 初始视图把 ca 换成 COALESCE(base_ca, ca)，与 0027 的 COALESCE(ca, 0) 是两个表达式 ⇒ 单独一条索引
  ['ca', 'idx_players_sort_initial_ca', '&view=initial'],
  // 0035 两条常驻列（FIXED_COLUMNS —— 永远在表头，用户不必打开列面板就能点到）
  ['position', 'idx_players_sort_position'],
  ['growable', 'idx_players_sort_growable'],
  // 0036 可选列面板里表达式最安全的三条；growth_gap 因与 view=initial 口径耦合，留到与 pa 变体同轮
  ['badges', 'idx_players_sort_badges'],
  ['base_ca', 'idx_players_sort_base_ca'],
  ['foot', 'idx_players_sort_foot'],
  // 0038 两条天赋维度（筛选侧写法由 v6.4.1 的用例覆盖）
  ['growth_tier', 'idx_players_sort_growth_tier'],
  ['future_star', 'idx_players_sort_future_star'],
];

let shared: DatabaseSync | null = null;

// 灌足量行：优化器在小表上可能不选索引，而线上是 18,301 行
function baseSqlite(): DatabaseSync {
  if (shared) return shared;
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const ins = sqlite.prepare(
    `INSERT INTO players (uid, name, club_id, position, ca, pa, age, market_value, prestige, status, game_attrs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
  );
  const statuses = ['normal', 'listed', 'trainee', 'free', 'retired'];
  sqlite.exec('BEGIN');
  for (let i = 1; i <= 400; i += 1) {
    ins.run(
      `fc${i}`,
      `球员${i}`,
      i % 11 === 0 ? null : (i % 5) + 1,
      'ST',
      40 + (i % 60),
      50 + (i % 50),
      16 + (i % 25),
      1_000_000 + i * 1000,
      i % 40,
      statuses[i % statuses.length],
    );
  }
  sqlite.exec('COMMIT');
  shared = sqlite;
  return sqlite;
}

// 记录型 D1 包装：把路由实际执行的 SQL 收下来，再原样交给测试库
function recorder(): { sqlite: DatabaseSync; env: Env; captured: string[] } {
  const sqlite = baseSqlite();
  const inner = createTestD1(sqlite);
  const captured: string[] = [];
  const DB = {
    prepare(sql: string) {
      captured.push(sql);
      return inner.prepare(sql);
    },
    batch: inner.batch,
  } as unknown as D1Database;
  const env = {
    DB,
    TOUR_DB: DB,
    SESSION_KV: createTestKV() as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    // 显式旁路缓存：否则第二次同 URL 请求命中 L1，抓不到 SQL
    PUBLIC_CACHE_TTL_MS: '0',
  } as unknown as Env;
  return { sqlite, env, captured };
}

// 抓一次真实路由执行的列表主查询（占位符不绑定：SQLite 把未绑定的参数当 NULL，执行计划不受值影响）
async function mainQuery(sort: string, extra = ''): Promise<{ sql: string; sqlite: DatabaseSync }> {
  resetGuards();
  const { sqlite, env, captured } = recorder();
  const res = await app.request(`http://localhost/api/players?sort=${sort}&limit=1${extra}`, {}, env);
  expect(res.status).toBe(200);
  const sql = captured.find((s) => s.includes('LEFT JOIN clubs cc'));
  expect(sql, '列表必须走主查询（含 clubs 左连接）').toBeDefined();
  return { sql: sql!, sqlite };
}

async function queryPlan(sort: string, extra = ''): Promise<string> {
  const { sql, sqlite } = await mainQuery(sort, extra);
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
  return rows.map((r) => r.detail).join(' | ');
}

describe('排序表达式索引与查询表达式同源（v3.2.0）', () => {
  for (const [sort, index, extra = ''] of INDEXED_SORTS) {
    const label = `sort=${sort}${extra}`;
    it(`${label} 走 ${index}，不退回全表扫 + 临时排序`, async () => {
      const plan = await queryPlan(sort, extra);
      expect(plan).toContain(`USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });

    it(`${label} 带游标翻页同样走 ${index}`, async () => {
      const plan = await queryPlan(sort, `&cursor=5~7${extra}`);
      expect(plan).toContain(`USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });

    // 升降两个方向都要能用同一条索引（索引尾列是 id，反向扫描合法）
    it(`${label}&order=asc 同样走 ${index}`, async () => {
      const plan = await queryPlan(sort, `&order=asc${extra}`);
      expect(plan).toContain(`USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });

  }

  it('十八条排序索引都在 schema 里，且尾列带 id（keyset 游标是 (排序键, id) 双列比较）', () => {
    const sqlite = baseSqlite();
    const names = INDEXED_SORTS.map(([, index]) => `'${index}'`).join(', ');
    const rows = sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN (${names}) ORDER BY name`)
      .all() as { name: string; sql: string }[];
    expect(rows.map((r) => r.name)).toEqual([...INDEXED_SORTS.map(([, index]) => index)].sort());
    for (const row of rows) expect(row.sql.replace(/\s+/g, ' ')).toMatch(/,\s*id\s*\)\s*;?\s*$/);
  });

  // 折叠表达式含 5 个不可见字符（00ad 软连字符、0301/0308 组合记号，见 src/core/name-fold.ts 的码位表），
  // 手写进 SQL 迁移时极易被编辑器/工具静默吃掉 —— 少一个字符索引就建得出来、但永远匹配不上查询表达式，
  // 于是退回全表扫而功能测试全绿。所以这里把迁移里那行表达式锁到 core 的 sqlFold 输出上。
  // 索引侧写非限定列名是 SQLite 的硬要求（限定名报 `the "." operator prohibited in index expressions`），
  // 而查询侧写限定名；两者被优化器认作同一表达式这件事由上面三条 EXPLAIN 用例证明。
  it('姓名索引的折叠表达式与 core 同源（SQLite 禁止索引表达式里的限定列名，故索引侧写非限定名）', () => {
    const sqlite = baseSqlite();
    const row = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_sort_name'`)
      .get() as { sql: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.sql).toContain(sqlFold('COALESCE(display_name, name)'));
  });

  // 0034 的两条表达式同样手抄不得：ps 是 15 个近乎相同的项相加（漏一个、括号错一层，索引照样建得出来
  // 但匹配不上查询），initial-ca 是嵌套 COALESCE（只建内层 COALESCE(base_ca, ca) 会静默失配，
  // 0027 的 COALESCE(ca, 0) 就是这么漏掉初始视图的）。
  it('PS 排序索引的槽计数表达式与 core 同源（PS_SLOT_COUNT 项，每项自带括号）', () => {
    const sqlite = baseSqlite();
    const row = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_sort_ps'`)
      .get() as { sql: string } | undefined;
    expect(row).toBeDefined();
    const expr = `(${Array.from(
      { length: PS_SLOT_COUNT },
      (_, i) => `(json_extract(game_attrs, '$.PSID${i + 1}') IS NOT NULL)`,
    ).join(' + ')})`;
    expect(row!.sql.replace(/\s+/g, ' ')).toContain(expr);
  });

  it('初始视图的 ca 索引建在完整排序键上（内层 COALESCE(base_ca, ca) 之外还有一层 COALESCE(…, 0)）', () => {
    const sqlite = baseSqlite();
    const row = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_sort_initial_ca'`)
      .get() as { sql: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.sql.replace(/\s+/g, ' ')).toContain('COALESCE(COALESCE(base_ca, ca), 0)');
  });
});

// v6.4.1：筛选侧与排序表达式索引同源。区间条件一律写 src（RANGE_PARAMS 的同源表达式）+ `col IS NOT NULL`
// 守卫；等值条件按「筛选键是否就是排序键」择优选写法（同键裸列、异键同源）。两种写法筛出的人相同，
// 所以功能测试全绿而读量差两个数量级、方向还相反 —— 这里锁执行计划形状与 SQL 文本，不锁结果。
describe('筛选侧与排序表达式索引同源（v6.4.1）', () => {
  // 区间 + 同键排序：同源表达式让优化器 seek 进命中区间，且索引序即请求序（无临时排序）。
  // 退回裸列时优化器只能「拿索引出顺序」把全部行走一遍 ⇒ 计划是 SCAN 而不是 SEARCH
  // （生产 18,301 行/次：ca>=100 → 1、prestige>=5 → 15、base_ca>=100 → 1）。
  const RANGES: ReadonlyArray<readonly [sort: string, index: string, filter: string]> = [
    ['ca', 'idx_players_sort_ca', 'ca_min=100'],
    ['pa', 'idx_players_sort_pa', 'pa_max=200'],
    ['age', 'idx_players_sort_age', 'age_min=20'],
    ['prestige', 'idx_players_sort_prestige', 'prestige_min=5'],
    ['market_value', 'idx_players_sort_market_value', 'market_value_max=500'],
  ];
  for (const [sort, index, filter] of RANGES) {
    it(`区间筛选 ${filter}（sort=${sort}）seek 进 ${index}，不整索引扫`, async () => {
      const plan = await queryPlan(sort, `&${filter}`);
      expect(plan).toContain(`SEARCH players USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });
  }

  // 等值 + 同键排序：这一格必须**不**同源。索引首列被等值钉死后只剩 id 升序，要按同一列的另一方向排
  // 就得整组读完再临时排序（生产实测 growable=1 21 → 20,948 行、growth_tier=1 21 → 36,602 行 = 2 × 组大小）；
  // 裸列写法顺着索引走、凑满 LIMIT 即停。这是 batch 6 无条件同源引入的条件性回归锁。
  // 注意 is_future_star 的参数名与排序键名不同（future_star），同键判定要认排序键名。
  const SAME_KEY_EQ: ReadonlyArray<readonly [sort: string, col: string, param: string]> = [
    ['growable', 'players.growable', 'growable'],
    ['foot', 'players.foot', 'foot'],
    ['growth_tier', 'players.growth_tier', 'growth_tier'],
    ['future_star', 'players.is_future_star', 'is_future_star'],
  ];
  for (const [sort, col, param] of SAME_KEY_EQ) {
    it(`等值筛选与排序键相同（sort=${sort}&${param}=1）写裸列、不临时排序`, async () => {
      const { sql } = await mainQuery(sort, `&${param}=1`);
      expect(sql).toContain(`${col} = ?`);
      expect(sql).not.toContain(`COALESCE(${col}, 0) = ?`);
      expect(await queryPlan(sort, `&${param}=1`)).not.toContain('TEMP B-TREE');
    });
  }

  // 异键（sort=id）时反过来：必须同源，否则命中集再小也得全表扫（生产 growth_tier=3 18,301 → 0、
  // is_future_star=1 924 → 21）。同一格再补 0 值守卫：`= 0` 不加 IS NOT NULL 会把「未设置」算成 0。
  it('等值筛选与排序键不同时（sort=id）写同源表达式，0 值另带 IS NOT NULL 守卫', async () => {
    const { sql: nonzero } = await mainQuery('id', '&growable=1');
    expect(nonzero).toContain('COALESCE(players.growable, 0) = ?');
    expect(nonzero).not.toContain('players.growable IS NOT NULL');

    const { sql: zero } = await mainQuery('id', '&growable=0');
    expect(zero).toContain('COALESCE(players.growable, 0) = ?');
    expect(zero).toContain('players.growable IS NOT NULL');

    // 异键时才是「同源赢」的形状：优化器 seek 进命中子集，而不是顺着索引把全部行走一遍
    // （生产 growth_tier=3：18,301 → 0 行读；is_future_star=1：924 → 21）
    expect(await queryPlan('id', '&growth_tier=3')).toContain('SEARCH players USING INDEX idx_players_sort_growth_tier');
  });

  it('区间筛选一律带 IS NOT NULL 守卫（COALESCE 把 NULL 当 0 会凭空放进 NULL 行）', async () => {
    const { sql } = await mainQuery('id', '&market_value_max=500');
    expect(sql).toContain('COALESCE(players.market_value, 0) <= ?');
    expect(sql).toContain('players.market_value IS NOT NULL');

    // 初始视图口径的 base_ca 走嵌套表达式，索引侧是迁移 0034 的 initial-ca
    const { sql: base } = await mainQuery('id', '&base_ca_min=100');
    expect(base).toContain('COALESCE(COALESCE(players.base_ca, players.ca), 0) >= ?');
    expect(base).toContain('COALESCE(players.base_ca, players.ca) IS NOT NULL');
  });

  // 守卫的端到端版：夹具两行 market_value 为 NULL、一行 100。`market_value_max=500` 在两种排序键下都
  // 必须看不到 NULL 行（它们是「没录过」不是「0 元」）；下界 0 同理 —— 少了守卫这三行会一起冒出来
  // （生产 market_value 全表 NULL ⇒ 从「0 行」变成「全表 18,301 行」）。
  it('NULL 身价不得被当成 0（sort=id / sort=market_value 两种口径结果一致）', async () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const ins = sqlite.prepare(`INSERT INTO players (uid, name, ca, pa, market_value) VALUES (?, ?, ?, ?, ?)`);
    ins.run('fc-null-1', '没录身价甲', 100, 120, null);
    ins.run('fc-null-2', '没录身价乙', 100, 120, null);
    ins.run('fc-low', '身价一百', 100, 120, 100);
    const db = createTestD1(sqlite);
    const env = {
      DB: db,
      TOUR_DB: db,
      SESSION_KV: createTestKV() as unknown as KVNamespace,
      MEDIA: {} as never,
      ASSETS: {} as never,
      PUBLIC_CACHE_TTL_MS: '0',
    } as unknown as Env;
    const names = async (qs: string): Promise<string[]> => {
      resetGuards();
      const res = await app.request(`http://localhost/api/players?limit=20&${qs}`, {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { players: { name: string }[] };
      return body.players.map((p) => p.name);
    };
    // 上限 500 只放过「100 那行」：两行 NULL 若被当成 0 会一起冒出来（这正是生产 market_value 全表
    // NULL 时的形态 —— 从「0 行」变成「全表」）
    expect(await names('sort=id&market_value_max=500')).toEqual(['身价一百']);
    expect(await names('sort=market_value&market_value_max=500')).toEqual(['身价一百']);
    expect(await names('sort=id&market_value_min=0')).toEqual(['身价一百']);
    expect(await names('sort=market_value&market_value_min=0')).toEqual(['身价一百']);
  });
});
