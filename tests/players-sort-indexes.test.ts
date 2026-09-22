// 增量 28 步骤 4：排序表达式索引必须与查询表达式同源——用真实路由抓下来的 SQL 跑 EXPLAIN QUERY PLAN 锁死。
// 表达式索引只有在表达式树逐字相等时才生效：排序表达式一改，索引就静默失效（退回全表扫 + 临时排序，
// 读量涨约 1000 倍），而功能测试全绿、接口返回一模一样。所以这里不看结果，看执行计划。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { applyMigrations, createTestD1, createTestKV } from './d1.ts';

// [排序键, 索引名]：0027 四条（ca/pa/age/market_value）+ 0029 三条（prestige/club/status）
const INDEXED_SORTS: ReadonlyArray<readonly [sort: string, index: string]> = [
  ['ca', 'idx_players_sort_ca'],
  ['pa', 'idx_players_sort_pa'],
  ['age', 'idx_players_sort_age'],
  ['market_value', 'idx_players_sort_market_value'],
  ['prestige', 'idx_players_sort_prestige'],
  ['club', 'idx_players_sort_club'],
  ['status', 'idx_players_sort_status'],
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
  for (const [sort, index] of INDEXED_SORTS) {
    it(`sort=${sort} 走 ${index}，不退回全表扫 + 临时排序`, async () => {
      const plan = await queryPlan(sort);
      expect(plan).toContain(`USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });

    it(`sort=${sort} 带游标翻页同样走 ${index}`, async () => {
      const plan = await queryPlan(sort, '&cursor=5~7');
      expect(plan).toContain(`USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });

    // 升降两个方向都要能用同一条索引（索引尾列是 id，反向扫描合法）
    it(`sort=${sort}&order=asc 同样走 ${index}`, async () => {
      const plan = await queryPlan(sort, '&order=asc');
      expect(plan).toContain(`USING INDEX ${index}`);
      expect(plan).not.toContain('TEMP B-TREE');
    });
  }

  it('七条排序索引都在 schema 里，且尾列带 id（keyset 游标是 (排序键, id) 双列比较）', () => {
    const sqlite = baseSqlite();
    const names = INDEXED_SORTS.map(([, index]) => `'${index}'`).join(', ');
    const rows = sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN (${names}) ORDER BY name`)
      .all() as { name: string; sql: string }[];
    expect(rows.map((r) => r.name)).toEqual([...INDEXED_SORTS.map(([, index]) => index)].sort());
    for (const row of rows) expect(row.sql.replace(/\s+/g, ' ')).toMatch(/,\s*id\s*\)\s*$/);
  });
});
