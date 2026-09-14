// 球员库列表（增量 6.1 d6）：筛选（position/name/growable/CA·PA·年龄区间）、数值键 keyset 排序翻页、参数校验
import { describe, expect, it } from 'vitest';
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
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(new DatabaseSync(':memory:')),
    SESSION_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
  return { env, sqlite };
}

function get(path: string, env: Env) {
  return app.request(path, { method: 'GET' }, env);
}

interface ListBody {
  players: { id: number; name: string; position: string | null; age: number | null; ca: number; pa: number; growable: boolean; marketValue: number | null }[];
  nextCursor: string | null;
}

async function list(path: string, env: Env): Promise<ListBody> {
  const res = await get(path, env);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

// 种子：6 名外场 + 2 名门将 + 1 名无身价球员，CA/PA/年龄/身价互相错开，保证每种排序有唯一序
function seedPlayers(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, market_value, status) VALUES
      (1, 'u1', '阿尔法',   1, 'ST',  18, 60, 92, 1, 40.5, 'normal'),
      (2, 'u2', '布拉沃',   1, 'GK',  29, 85, 86, 0, 120,  'normal'),
      (3, 'u3', '查理',     2, 'CM',  24, 74, 80, 1, 65,   'normal'),
      (4, 'u4', '三角洲',   2, 'GK',  33, 78, 78, 0, 90,   'normal'),
      (5, 'u5', '回声',     NULL, 'CB', 21, 66, 88, 1, 55,  'normal'),
      (6, 'u6', '狐步舞',   NULL, 'CM', 30, 82, 82, 0, NULL, 'normal'),
      (7, 'u7', '高尔夫',   1, 'ST',  19, 62, 90, 1, 38,   'normal'),
      (8, 'u8', '阿尔法二号', 3, 'LB', 26, 70, 76, 1, 44,  'normal');
  `);
}

describe('球员库列表（增量 6.1 d6）', () => {
  it('筛选：position / growable / name 子串 / CA·PA·年龄区间，可叠加', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);

    const gks = await list('/api/players?position=GK', fx.env);
    expect(gks.players.map((p) => p.id)).toEqual([2, 4]);

    const growable = await list('/api/players?growable=1', fx.env);
    expect(growable.players.map((p) => p.id)).toEqual([1, 3, 5, 7, 8]);

    const byName = await list('/api/players?name=阿尔法', fx.env);
    expect(byName.players.map((p) => p.id)).toEqual([1, 8]);

    const byRange = await list('/api/players?ca_min=66&ca_max=82&age_max=28', fx.env);
    expect(byRange.players.map((p) => p.id)).toEqual([3, 5, 8]);

    const stacked = await list('/api/players?position=ST&growable=1&pa_min=90', fx.env);
    expect(stacked.players.map((p) => p.id)).toEqual([1, 7]);
  });

  it('name 查询的 LIKE 通配符按字面匹配，不当日通配', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    const res = await list('/api/players?name=%25', fx.env);
    expect(res.players).toEqual([]);
  });

  it('sort=ca 默认降序 + keyset 翻页：两页拼出全量且不重不漏', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    const page1 = await list('/api/players?sort=ca&limit=3', fx.env);
    expect(page1.players.map((p) => p.id)).toEqual([2, 6, 4]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await list(`/api/players?sort=ca&limit=3&cursor=${page1.nextCursor}`, fx.env);
    expect(page2.players.map((p) => p.id)).toEqual([3, 8, 5]);
    const page3 = await list(`/api/players?sort=ca&limit=3&cursor=${page2.nextCursor}`, fx.env);
    expect(page3.players.map((p) => p.id)).toEqual([7, 1]);
    expect(page3.nextCursor).toBeNull();
  });

  it('sort=age 升序翻页；sort=market_value 降序时 NULL 身价排最后且翻页不丢', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);

    const young = await list('/api/players?sort=age&order=asc&limit=4', fx.env);
    expect(young.players.map((p) => p.age)).toEqual([18, 19, 21, 24]);
    const young2 = await list(`/api/players?sort=age&order=asc&limit=4&cursor=${young.nextCursor}`, fx.env);
    expect(young2.players.map((p) => p.age)).toEqual([26, 29, 30, 33]);
    expect(young2.nextCursor).toBeNull();

    const mv = await list('/api/players?sort=market_value&limit=100', fx.env);
    expect(mv.players.at(-1)?.id).toBe(6);
    expect(mv.players.at(-1)?.marketValue).toBeNull();
    // 从非空段游标继续翻页仍能拿到 NULL 段（COALESCE 当 0 进 keyset）
    const half = await list('/api/players?sort=market_value&limit=4', fx.env);
    const rest = await list(`/api/players?sort=market_value&limit=4&cursor=${half.nextCursor}`, fx.env);
    expect([...half.players, ...rest.players].map((p) => p.id)).toEqual(mv.players.map((p) => p.id));
  });

  it('id 排序保持旧整数游标口径（既有调用兼容）', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    const page1 = await list('/api/players?limit=3', fx.env);
    expect(page1.players.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(page1.nextCursor).toBe('3');
    const page2 = await list('/api/players?limit=3&cursor=3', fx.env);
    expect(page2.players.map((p) => p.id)).toEqual([4, 5, 6]);
  });

  it('参数校验：sort/growable/cursor/区间 400', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    expect((await get('/api/players?sort=uid', fx.env)).status).toBe(400);
    expect((await get('/api/players?growable=yes', fx.env)).status).toBe(400);
    expect((await get('/api/players?sort=ca&cursor=oops', fx.env)).status).toBe(400);
    expect((await get('/api/players?ca_min=-1', fx.env)).status).toBe(400);
    expect((await get('/api/players?name=', fx.env)).status).toBe(400);
  });
});
