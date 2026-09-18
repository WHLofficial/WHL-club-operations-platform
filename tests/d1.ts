// 测试基建（§16：内存 D1 跑迁移与断言）：把 node:sqlite 包成 D1 兼容接口。
// 只实现平台代码用到的面：prepare/bind/first/all/run + batch（隐式事务）。
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateCode } from '../src/lib/crypto.ts';

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
  '0010_growth.sql',
  '0011_oidc_session.sql',
  '0012_oidc_claims.sql',
  '0013_binding_user_name.sql',
  '0014_season_tournaments.sql',
  '0015_initial_club.sql',
  '0016_transfer_ban.sql',
  '0017_season_settle.sql',
  '0018_home.sql',
  '0019_growth_periods.sql',
];

export function applyMigrations(sqlite: DatabaseSync, upTo?: string): void {
  const dir = new URL('../src/db/migrations/', import.meta.url);
  for (const file of MIGRATION_FILES) {
    sqlite.exec(readFileSync(fileURLToPath(new URL(file, dir).href), 'utf8'));
    if (file === upTo) return;
  }
}

// 单独补跑某个迁移（测存量回填时：先 applyMigrations(sqlite, 前一个文件) → 造存量数据 → 再跑这个）
export function runMigration(sqlite: DatabaseSync, file: string): void {
  const dir = new URL('../src/db/migrations/', import.meta.url);
  sqlite.exec(readFileSync(fileURLToPath(new URL(file, dir).href), 'utf8'));
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

// 增量 7：auth 库测试镜像（auth 仓 0001 account + 0008 team/team_bind_code/team_binding
// 的最小列集）；机器端点仿真直接 SQL 读写，派生读路径用 createTestD1 包出来
export function createAuthDb(): { sqlite: DatabaseSync; d1: D1Database } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE account (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      email TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
      must_change_pw INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE team (
      id INTEGER PRIMARY KEY,
      tour_team_id INTEGER UNIQUE,
      club_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_team_club ON team(club_id);
    CREATE TABLE team_bind_code (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      via TEXT NOT NULL,
      expires_at TEXT,
      used_by INTEGER,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_team_bind_code_team ON team_bind_code(team_id, id DESC);
    CREATE TABLE team_binding (
      account_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      bound_via TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      PRIMARY KEY (account_id, team_id)
    );
    CREATE UNIQUE INDEX idx_team_binding_account ON team_binding(account_id);
    CREATE INDEX idx_team_binding_team ON team_binding(team_id);
  `);
  return { sqlite, d1: createTestD1(sqlite) };
}

// ---- 增量 7：auth 机器通道测试台（绑定类测试文件共用） ----
// 与 routes.test.ts 的 withAuth 同构：挂 AUTH_DB 镜像 + 配置（只配 OIDC_ISSUER 作机器 API
// 基地址，不配 CLIENT_ID 保持兼容模式）+ fetch 端点仿真（HMAC 契约断言）。
export const AUTH_TEST_SECRET = 'test-bind-secret';
export const AUTH_TEST_BASE = 'http://auth.test';

export function stubAuthMachine(auth: DatabaseSync, secret = AUTH_TEST_SECRET, base = AUTH_TEST_BASE): void {
  const impl = async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
    const u = String(url);
    if (!u.startsWith(`${base}/api/team/`)) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    }
    const path = u.slice(base.length);
    const raw = init?.body ?? '';
    const ts = init?.headers?.['x-timestamp'] ?? '';
    const sign = createHmac('sha256', secret).update(`POST|${path}|${ts}|${raw}`).digest('hex');
    if (init?.headers?.['x-sign'] !== sign) {
      return new Response(JSON.stringify({ error: 'bad_signature' }), { status: 401 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const now = new Date().toISOString();
    if (path === '/api/team/bindcode') {
      const team = auth.prepare('SELECT id FROM team WHERE club_id = ?').get(Number(body.club_id)) as
        | { id: number }
        | undefined;
      if (!team) return new Response(JSON.stringify({ error: 'team_not_found' }), { status: 404 });
      const code = generateCode(8);
      const expiresAt = new Date(Date.now() + Number(body.ttl_hours ?? 24) * 3600_000).toISOString();
      auth
        .prepare("INSERT INTO team_bind_code (team_id, code_hash, via, expires_at, created_at) VALUES (?, ?, 'club', ?, ?)")
        .run(team.id, createHash('sha256').update(code).digest('hex'), expiresAt, now);
      return new Response(JSON.stringify({ ok: true, code, expires_at: expiresAt }), { status: 200 });
    }
    if (path === '/api/team/bind') {
      const code = String(body.code ?? '').trim().toUpperCase();
      const row = auth.prepare('SELECT id, team_id, expires_at, used_by FROM team_bind_code WHERE code_hash = ?')
        .get(createHash('sha256').update(code).digest('hex')) as
        | { id: number; team_id: number; expires_at: string | null; used_by: number | null }
        | undefined;
      if (!row || row.used_by !== null || (row.expires_at !== null && row.expires_at <= now)) {
        return new Response(JSON.stringify({ error: 'invalid_code' }), { status: 400 });
      }
      const accountId = Number(body.account_id);
      if (auth.prepare('SELECT team_id FROM team_binding WHERE account_id = ?').get(accountId)) {
        return new Response(JSON.stringify({ error: 'already_bound' }), { status: 409 });
      }
      auth.prepare("INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (?, ?, 'club', ?)")
        .run(accountId, row.team_id, now);
      auth.prepare('UPDATE team_bind_code SET used_by = ?, used_at = ? WHERE id = ?').run(accountId, now, row.id);
      return new Response(JSON.stringify({ ok: true, teamId: row.team_id }), { status: 200 });
    }
    if (path === '/api/team/unbind') {
      const accountId = Number(body.account_id);
      const row = auth.prepare('SELECT team_id FROM team_binding WHERE account_id = ?').get(accountId) as
        | { team_id: number }
        | undefined;
      if (!row) return new Response(JSON.stringify({ error: 'not_bound' }), { status: 404 });
      auth.prepare('DELETE FROM team_binding WHERE account_id = ?').run(accountId);
      return new Response(JSON.stringify({ ok: true, teamId: row.team_id }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  };
  (globalThis as { fetch: unknown }).fetch = impl;
}

// 发码前目录登记（生产端点 team_not_found → 引导先登记；测试里显式建行）
export function authRegisterClubTeam(auth: DatabaseSync, tourTeamId: number, clubId: number, name: string): void {
  auth.prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(tourTeamId, clubId, name, '2026-01-01T00:00:00Z');
}

// 一步挂好机器通道；返回 auth sqlite 供目录登记与断言
export function attachAuthChannel(env: import('../src/worker/env.ts').Env): DatabaseSync {
  const { sqlite: auth, d1 } = createAuthDb();
  auth.exec(`INSERT INTO account (id, name, created_at) VALUES
    (1, '管理组甲', '2026-01-01T00:00:00Z'), (2, '教练乙', '2026-01-01T00:00:00Z'),
    (3, '丙丙', '2026-01-01T00:00:00Z'), (4, '教练丁', '2026-01-01T00:00:00Z'),
    (5, '教练戊', '2026-01-01T00:00:00Z');`);
  env.AUTH_DB = d1;
  env.AUTH_BIND_SECRET = AUTH_TEST_SECRET;
  env.OIDC_ISSUER = AUTH_TEST_BASE;
  stubAuthMachine(auth);
  return auth;
}
