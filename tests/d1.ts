// 测试基建（§16：内存 D1 跑迁移与断言）：把 node:sqlite 包成 D1 兼容接口。
// 只实现平台代码用到的面：prepare/bind/first/all/run + batch（隐式事务）。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

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
          return (sqlite.prepare(sql).get(...args) ?? null) as T | null;
        },
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          return { results: sqlite.prepare(sql).all(...args) as T[] };
        },
        async run() {
          const r = sqlite.prepare(sql).run(...args);
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

const MIGRATION_FILES = ['0001_init.sql', '0002_club_bind_code.sql'];

export function createTestDb(): { sqlite: DatabaseSync; db: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../src/db/migrations/', import.meta.url);
  for (const file of MIGRATION_FILES) {
    sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  return { sqlite, db: createTestD1(sqlite) };
}
