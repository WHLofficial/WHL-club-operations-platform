// 增量 28 步骤 4：排序表达式索引必须与查询表达式同源——用真实路由抓下来的 SQL 跑 EXPLAIN QUERY PLAN 锁死。
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

// [排序键, 索引名, 额外查询参数]：0027 四条（ca/pa/age/market_value）+ 0029 三条（prestige/club/status）
// + 0033 一条（name，增量 32 把排序键从折叠的官方缩写名换成折叠的显示名时一并补上）
// + 0034 三条（uid / ps / view=initial 下的 ca，遗留项第 5 节 D1 读量治理的下一批次）
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

async function queryPlan(sort: string, extra = ''): Promise<string> {
  resetGuards();
  const { sqlite, env, captured } = recorder();
  const res = await app.request(`http://localhost/api/players?sort=${sort}&limit=1${extra}`, {}, env);
  expect(res.status).toBe(200);
  const main = captured.find((sql) => sql.includes('LEFT JOIN clubs cc'));
  expect(main, '列表必须走主查询（含 clubs 左连接）').toBeDefined();
  // 占位符不绑定：SQLite 把未绑定的参数当 NULL，执行计划不受值影响
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${main}`).all() as { detail: string }[];
  return rows.map((r) => r.detail).join(' | ');
}

describe('排序表达式索引与查询表达式同源（增量 28）', () => {
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

  it('十一条排序索引都在 schema 里，且尾列带 id（keyset 游标是 (排序键, id) 双列比较）', () => {
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
