// 一线队号码批量分配（v6.76.0）：
// PUT /api/club/squad/numbers 收「最终态」assignments，整单全有或全无；
// 覆盖对调/链式换号/清号、payload 重复、外部占用 409 + 结构化 conflicts、
// 非本队、关窗、权限、100 人上限与切块写入、每人审计、0092 唯一索引兜底。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (2, '教练乙', 'coach', 0, 0),
       (3, '教练丙', 'coach', 0, 0),
       (9, '观众', 'user', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  kv.set('sess:tok-coach3', JSON.stringify({ userId: 3 }));
  kv.set('sess:tok-viewer', JSON.stringify({ userId: 9 }));
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
  };
  sqlite.exec(
    `INSERT INTO clubs (id, name) VALUES (100, '我的队'), (200, '别队'), (300, '空号队');
     INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES
       (100, 2, '2026-01-01T00:00:00Z'), (300, 3, '2026-01-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, number, position, age, ca, pa, status) VALUES
       (10, 'fc10', '甲', 100, '7', 'GK', 25, 80, 85, 'normal'),
       (11, 'fc11', '乙', 100, '8', 'DF', 25, 79, 84, 'normal'),
       (12, 'fc12', '丙', 100, NULL, 'MF', 25, 78, 83, 'normal'),
       (13, 'fc13', '丁', 100, '9', 'FW', 25, 77, 82, 'normal'),
       (14, 'fc14', '戊', 100, '10', 'MF', 25, 76, 81, 'normal'),
       (20, 'fc20', '外', 200, '5', 'GK', 25, 75, 80, 'normal');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at)
       VALUES (1, 1, 'open', 0, '2026-01-01T00:00:00Z');`,
  );
  return { env, sqlite };
}

function call(method: 'PUT' | 'POST', path: string, token: string | undefined, env: Env, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: {
        ...(token ? { Cookie: `whl_session=${token}` } : {}),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

function putNumbers(fx: Fixture, assignments: unknown, token = 'tok-coach') {
  return call('PUT', '/api/club/squad/numbers', token, fx.env, { assignments });
}

function numbersOf(fx: Fixture): Record<number, string | null> {
  const rows = fx.sqlite.prepare('SELECT id, number FROM players WHERE club_id = 100 ORDER BY id').all() as {
    id: number;
    number: string | null;
  }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.number]));
}

beforeEach(() => resetConfigCache());

describe('PUT /api/club/squad/numbers · 最终态写入', () => {
  it('两人对调号码：一条 batch 内先清后写，不撞唯一索引', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [
      { playerId: 10, number: 8 },
      { playerId: 11, number: 7 },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; applied: { playerId: number; before: string | null; after: string | null }[] };
    expect(body.ok).toBe(true);
    expect(body.applied).toEqual([
      { playerId: 10, before: '7', after: '8' },
      { playerId: 11, before: '8', after: '7' },
    ]);
    expect(numbersOf(fx)).toEqual({ 10: '8', 11: '7', 12: null, 13: '9', 14: '10' });
  });

  it('链式换号 7→8、8→9、9→7 一次落定', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE players SET number = '7' WHERE id = 10; UPDATE players SET number = '8' WHERE id = 11; UPDATE players SET number = '9' WHERE id = 13;`);
    const res = await putNumbers(fx, [
      { playerId: 10, number: 8 },
      { playerId: 11, number: 9 },
      { playerId: 13, number: 7 },
    ]);
    expect(res.status).toBe(200);
    expect(numbersOf(fx)).toMatchObject({ 10: '8', 11: '9', 13: '7' });
  });

  it('清号：number=null 落库，审计保留 before', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [{ playerId: 10, number: null }]);
    expect(res.status).toBe(200);
    expect(numbersOf(fx)[10]).toBeNull();
    const audit = fx.sqlite
      .prepare("SELECT before, after FROM audit_log WHERE action = 'player_number' AND target_id = 10")
      .get() as { before: string; after: string };
    expect(JSON.parse(audit.before)).toEqual({ number: '7' });
    expect(JSON.parse(audit.after)).toEqual({ number: null });
  });

  it('只写变动行：同号重复提交是 no-op，不写审计', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [{ playerId: 10, number: 7 }]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applied: unknown[] };
    expect(body.applied).toEqual([]);
    const count = fx.sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'player_number'").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('每人一条审计，before/after 都是号码快照', async () => {
    const fx = freshEnv();
    await putNumbers(fx, [
      { playerId: 10, number: 8 },
      { playerId: 11, number: 7 },
    ]);
    const rows = fx.sqlite
      .prepare("SELECT target_id, actor, origin, before, after FROM audit_log WHERE action = 'player_number' ORDER BY id")
      .all() as { target_id: number; actor: number; origin: string; before: string; after: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.target_id)).toEqual([10, 11]);
    expect(rows.every((r) => r.actor === 2 && r.origin === 'user')).toBe(true);
  });
});

describe('PUT /api/club/squad/numbers · 校验与冲突', () => {
  it('payload 内目标号重复 → 400，不落库', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [
      { playerId: 10, number: 5 },
      { playerId: 11, number: 5 },
    ]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('5 号出现了两次');
    expect(numbersOf(fx)[10]).toBe('7');
  });

  it('抢未提交队友的号码 → 409 + 结构化 conflicts，整单不落库', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [{ playerId: 10, number: 9 }]);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      conflicts: { number: string; playerId: number; playerName: string }[];
    };
    expect(body.code).toBe('number_conflict');
    expect(body.conflicts).toEqual([{ number: '9', playerId: 13, playerName: '丁' }]);
    expect(numbersOf(fx)[10]).toBe('7');
  });

  it('同一名球员出现两次 → 400', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [
      { playerId: 10, number: 8 },
      { playerId: 10, number: 9 },
    ]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('同一名球员');
  });

  it('非本队球员 → 404', async () => {
    const fx = freshEnv();
    const res = await putNumbers(fx, [{ playerId: 20, number: 11 }]);
    expect(res.status).toBe(404);
    expect(numbersOf(fx)[10]).toBe('7');
  });

  it('非法号码 → 400', async () => {
    const fx = freshEnv();
    for (const number of [0, 100, 3.5, 'abc', true, '0x10']) {
      const res = await putNumbers(fx, [{ playerId: 10, number }]);
      expect(res.status).toBe(400);
    }
  });

  it('批量项漏 number 字段 → 400，不把字段写错当成清号', async () => {
    const fx = freshEnv();
    const res = await call('PUT', '/api/club/squad/numbers', 'tok-coach', fx.env, {
      assignments: [{ playerId: 10 }],
    });
    expect(res.status).toBe(400);
    expect(numbersOf(fx)[10]).toBe('7');
  });

  it('超过 100 人 → 400', async () => {
    const fx = freshEnv();
    const assignments = Array.from({ length: 101 }, (_, i) => ({ playerId: 1000 + i, number: null }));
    const res = await putNumbers(fx, assignments);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('最多改 100');
  });

  it('关窗 → 409 no_window', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1;`);
    const res = await putNumbers(fx, [{ playerId: 10, number: 8 }]);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('no_window');
  });

  it('匿名 401、非教练 403', async () => {
    const fx = freshEnv();
    expect((await putNumbers(fx, [{ playerId: 10, number: 8 }], '')).status).toBe(401);
    expect((await putNumbers(fx, [{ playerId: 10, number: 8 }], 'tok-viewer')).status).toBe(403);
  });
});

describe('PUT /api/club/squad/numbers · 上限与索引', () => {
  it('100 人清号走切块写入（含审计），一单完成', async () => {
    const fx = freshEnv();
    const insert = fx.sqlite.prepare(
      'INSERT INTO players (id, uid, name, club_id, number, position, age, ca, pa, status) VALUES (?, ?, ?, 300, ?, ?, 25, 70, 75, \'normal\')',
    );
    for (let i = 0; i < 100; i++) {
      insert.run(1000 + i, `fc${1000 + i}`, `球员${i}`, i < 99 ? String(i + 1) : null, 'MF');
    }
    const assignments = Array.from({ length: 100 }, (_, i) => ({ playerId: 1000 + i, number: null }));
    const res = await call('PUT', '/api/club/squad/numbers', 'tok-coach3', fx.env, { assignments });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applied: unknown[] };
    expect(body.applied).toHaveLength(99);
    const left = fx.sqlite.prepare('SELECT COUNT(*) AS c FROM players WHERE club_id = 300 AND number IS NOT NULL').get() as { c: number };
    expect(left.c).toBe(0);
    const audits = fx.sqlite.prepare('SELECT COUNT(*) AS c FROM audit_log WHERE action = \'player_number\'').get() as { c: number };
    expect(audits.c).toBe(99);
  });

  it('99 人一次分配 1–99：finals 走 30 人/条切块', async () => {
    const fx = freshEnv();
    const insert = fx.sqlite.prepare(
      'INSERT INTO players (id, uid, name, club_id, number, position, age, ca, pa, status) VALUES (?, ?, ?, 300, NULL, ?, 25, 70, 75, \'normal\')',
    );
    for (let i = 0; i < 100; i++) insert.run(2000 + i, `fc${2000 + i}`, `新援${i}`, i % 2 === 0 ? 'MF' : 'DF');
    const assignments = Array.from({ length: 99 }, (_, i) => ({ playerId: 2000 + i, number: i + 1 }));
    const res = await call('PUT', '/api/club/squad/numbers', 'tok-coach3', fx.env, { assignments });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: unknown[] }).applied).toHaveLength(99);
    const filled = fx.sqlite.prepare('SELECT COUNT(*) AS c FROM players WHERE club_id = 300 AND number IS NOT NULL').get() as { c: number };
    expect(filled.c).toBe(99);
    const nulls = fx.sqlite.prepare('SELECT COUNT(*) AS c FROM players WHERE club_id = 300 AND number IS NULL').get() as { c: number };
    expect(nulls.c).toBe(1);
    const audits = fx.sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'player_number'").get() as { c: number };
    expect(audits.c).toBe(99);
  });

  it('批量写入撞唯一索引 → 409，不冒 500', async () => {
    const fx = freshEnv();
    const original = fx.env.DB.batch.bind(fx.env.DB);
    fx.env.DB.batch = (async () => {
      throw new Error('UNIQUE constraint failed: players.club_id, players.number');
    }) as typeof fx.env.DB.batch;
    try {
      const res = await putNumbers(fx, [{ playerId: 10, number: 1 }]);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain('刚被其他操作占用');
    } finally {
      fx.env.DB.batch = original;
    }
  });

  it('0092 部分唯一索引存在，并兜住直接写入的重复号', async () => {
    const fx = freshEnv();
    const idx = fx.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_club_number'")
      .get() as { name: string } | null;
    expect(idx?.name).toBe('idx_players_club_number');
    expect(() => fx.sqlite.exec(`UPDATE players SET number = '7' WHERE id = 11;`)).toThrow(/UNIQUE/);
  });
});

describe('POST /api/club/players/:id/number · 单条入口', () => {
  it('单条改号仍可用，且与批量共用写入核心', async () => {
    const fx = freshEnv();
    const res = await call('POST', '/api/club/players/10/number', 'tok-coach', fx.env, { number: 11 });
    expect(res.status).toBe(200);
    expect(numbersOf(fx)[10]).toBe('11');
  });

  it('单条撞号仍按原文案 409，不做隐式对调', async () => {
    const fx = freshEnv();
    const res = await call('POST', '/api/club/players/10/number', 'tok-coach', fx.env, { number: 9 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('9 号已经给 丁 了，先给他换个号');
    expect(numbersOf(fx)[10]).toBe('7');
  });
});
