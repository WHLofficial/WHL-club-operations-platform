// 测试基建（§16：内存 D1 跑迁移与断言）：把 node:sqlite 包成 D1 兼容接口。
// 只实现平台代码用到的面：prepare/bind/first/all/run + batch（隐式事务）。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface TestKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createTestKV(seed: Map<string, string> = new Map()): TestKV {
  return {
    async get(key) {
      return seed.get(key) ?? null;
    },
    async put(key, value) {
      seed.set(key, value);
    },
    async delete(key) {
      seed.delete(key);
    },
  };
}

export function createTestD1(sqlite: DatabaseSync): D1Database {
  const d1 = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...bound: unknown[]) {
          args = bound;
          return stmt;
        },
        async first<T = Record<string, unknown>>(): Promise<T | null> {
          return (sqlite.prepare(sql).get(...(args as never[])) ?? null) as T | null;
        },
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] };
        },
        async run() {
          const r = sqlite.prepare(sql).run(...(args as never[]));
          return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return stmt;
    },
    async batch(statements: { run(): Promise<{ meta: { changes: number } }> }[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out: { meta: { changes: number } }[] = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return d1 as unknown as D1Database;
}

const MIGRATION_FILES = [
  '0001_init.sql',
  '0002_club_bind_code.sql',
  '0003_players_status_index.sql',
  '0004_backfill_base_ca.sql',
  '0005_market_bid_guard.sql',
  '0006_activation_negotiation.sql',
  '0007_negotiation_settle.sql',
  '0008_activation_match.sql',
  '0009_results.sql',
];

export function applyMigrations(sqlite: DatabaseSync): void {
  const dir = new URL('../src/db/migrations/', import.meta.url);
  for (const file of MIGRATION_FILES) {
    sqlite.exec(readFileSync(fileURLToPath(new URL(file, dir).href), 'utf8'));
  }
}

export function createTestDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  return { sqlite, db: createTestD1(sqlite) };
}

// node:sqlite StatementSync 的 get/all 不带泛型，包一层方便断言取行
type SqlParam = string | number | bigint | Uint8Array | null;

export function sqlGet<T>(sqlite: DatabaseSync, sql: string, ...params: SqlParam[]): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

export function sqlAll<T>(sqlite: DatabaseSync, sql: string, ...params: SqlParam[]): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}
