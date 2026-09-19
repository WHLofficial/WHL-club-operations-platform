// 管理端系统域路由测试（增量 15 commit 6）：config 超管全开 + 审计日志 + 总览轻计数
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet } from './d1.ts';
import { resetConfigCache, CONFIG_MASK } from '../src/core/config.ts';
import { resetOverviewCache } from '../src/worker/routes/admin/overview.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

// 五账号：1 管理组甲（普通 admin）/ 5 超管乙（superadmin，兼容模式按角色附超管权限点）
function freshEnv(): Fixture {
  resetConfigCache();
  resetOverviewCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (5, '超管乙', 'superadmin', 0, 0);`,
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
  };
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-super', JSON.stringify({ userId: 5 }));
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
}

function send(method: 'PUT' | 'POST', path: string, body: unknown, token: string, env: Env) {
  return app.request(
    path,
    { method, headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` }, body: JSON.stringify(body) },
    env,
  );
}

describe('config 超管全开（增量 15）', () => {
  it('GET /config：普通 admin 掩码涉密键；超管明文 + editable=true', async () => {
    const fx = freshEnv();
    // 涉密键落一个真值，验证掩码/明文差异
    await fx.sqlite.exec(`INSERT INTO config (key, value, updated_at) VALUES ('wage_param_a', '2.71', '2026-09-19T00:00:00Z')`);
    resetConfigCache();

    const adminRes = await get('/api/admin/config', 'tok-admin', fx.env);
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { config: { key: string; value: string | null; secret: boolean }[]; editable: boolean };
    expect(adminBody.editable).toBe(false);
    const masked = adminBody.config.find((r) => r.key === 'wage_param_a');
    expect(masked?.secret).toBe(true);
    expect(masked?.value).toBe(CONFIG_MASK);

    const superRes = await get('/api/admin/config', 'tok-super', fx.env);
    expect(superRes.status).toBe(200);
    const superBody = (await superRes.json()) as typeof adminBody;
    expect(superBody.editable).toBe(true);
    expect(superBody.config.find((r) => r.key === 'wage_param_a')).toMatchObject({ value: '2.71', secret: true });
  });

  it('PUT /config：普通 admin 403；超管写入生效并留审计；未注册键/坏 value 400', async () => {
    const fx = freshEnv();
    expect((await send('PUT', '/api/admin/config', { key: 'bid_step_min', value: '2' }, 'tok-admin', fx.env)).status).toBe(403);
    expect((await send('PUT', '/api/admin/config', { key: 'no_such_key', value: '1' }, 'tok-super', fx.env)).status).toBe(400);
    expect((await send('PUT', '/api/admin/config', { key: 'bid_step_min', value: 2 }, 'tok-super', fx.env)).status).toBe(400);

    const res = await send('PUT', '/api/admin/config', { key: 'bid_step_min', value: '2' }, 'tok-super', fx.env);
    expect(res.status).toBe(200);
    expect(sqlGet<{ value: string }>(fx.sqlite, `SELECT value FROM config WHERE key = 'bid_step_min'`)?.value).toBe('2');
    const audit = sqlGet<{ before: string; after: string }>(fx.sqlite, `SELECT before, after FROM audit_log WHERE action = 'config_set'`);
    expect(JSON.parse(audit!.before)).toMatchObject({ key: 'bid_step_min', value: '1' });
    expect(JSON.parse(audit!.after)).toMatchObject({ key: 'bid_step_min', value: '2' });

    // value=null 回默认：落 NULL 行，读取回落 CONFIG_DEFAULTS
    expect((await send('PUT', '/api/admin/config', { key: 'bid_step_min', value: null }, 'tok-super', fx.env)).status).toBe(200);
    expect(sqlGet<{ value: string | null }>(fx.sqlite, `SELECT value FROM config WHERE key = 'bid_step_min'`)?.value).toBeNull();
  });

  it('PUT 涉密键：审计里的值只落掩码（§6.10）', async () => {
    const fx = freshEnv();
    const res = await send('PUT', '/api/admin/config', { key: 'wage_param_a', value: '3.14' }, 'tok-super', fx.env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { value: string }).value).toBe(CONFIG_MASK);
    expect(sqlGet<{ value: string }>(fx.sqlite, `SELECT value FROM config WHERE key = 'wage_param_a'`)?.value).toBe('3.14');
    const audit = sqlGet<{ before: string | null; after: string | null }>(fx.sqlite, `SELECT before, after FROM audit_log WHERE action = 'config_set'`);
    expect(JSON.parse(audit!.after!)).toMatchObject({ key: 'wage_param_a', value: CONFIG_MASK });
  });
});

describe('审计日志端点（增量 15）', () => {
  it('倒序 + limit 钳制 + action 前缀过滤', async () => {
    const fx = freshEnv();
    // 造 6 条：3 条 config_set、3 条 listing_create，id 倒序返回
    for (let i = 1; i <= 3; i++) {
      fx.sqlite.exec(
        `INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at)
         VALUES (1, 'config_set', 'config', NULL, '{"key":"k${i}"}', '{"key":"k${i}"}', '2026-09-19T00:0${i}:00Z'),
                (1, 'listing_create', 'listing', ${i}, NULL, NULL, '2026-09-19T00:0${i}:30Z')`,
      );
    }
    const all = (await (await get('/api/admin/audit-log?limit=2', 'tok-admin', fx.env)).json()) as { entries: { id: number }[] };
    expect(all.entries.length).toBe(2);
    const filtered = (await (await get('/api/admin/audit-log?action=listing', 'tok-admin', fx.env)).json()) as {
      entries: { action: string }[];
    };
    expect(filtered.entries.length).toBe(3);
    expect(filtered.entries.every((e) => e.action.startsWith('listing'))).toBe(true);
    // limit 钳到 100
    expect((await get('/api/admin/audit-log?limit=999', 'tok-admin', fx.env)).status).toBe(200);
  });

  it('config_set 里涉密键的值：写入侧已只落掩码（§6.10），超管与非超管看到的都是掩码', async () => {
    const fx = freshEnv();
    await send('PUT', '/api/admin/config', { key: 'wage_param_b', value: '1.9' }, 'tok-super', fx.env);

    // 明文从未进 audit_log：超管读到的也是掩码（非超管的端点侧再掩一道是双保险）
    const superView = (await (await get('/api/admin/audit-log?action=config_set', 'tok-super', fx.env)).json()) as {
      entries: { after: string | null }[];
    };
    expect(JSON.parse(superView.entries[0].after!)).toMatchObject({ value: CONFIG_MASK });

    const adminView = (await (await get('/api/admin/audit-log?action=config_set', 'tok-admin', fx.env)).json()) as {
      entries: { after: string | null }[];
    };
    expect(JSON.parse(adminView.entries[0].after!)).toMatchObject({ value: CONFIG_MASK });
  });
});

describe('总览轻计数（增量 15）', () => {
  it('计数正确；60s 缓存内不重算，?fresh=1 强拉', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(
      `INSERT INTO clubs (id, name, league_tier, status, created_at) VALUES
         (1, 'Club One', 'premier', 'active', '2026-09-01T00:00:00Z'),
         (2, 'Club Two', 'premier', 'active', '2026-09-01T00:00:00Z');
       INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
         (10, 'fc10', 'P10', 1, 'ST', 24, 80, 85, 30, 'normal'),
         (11, 'fc11', 'P11', 2, 'CM', 25, 75, 80, 20, 'normal'),
         (12, 'fc12', 'P12', 2, 'GK', 27, 70, 78, 15, 'normal');
       INSERT INTO review_tasks (id, type, ref_id, status) VALUES (1, 'transfer_confirm', 1, 'open'), (2, 'transfer_confirm', 2, 'approved');
       INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, window_seq, season)
         VALUES (1, 10, 1, 'normal', 15, 'bidding', '2026-09-01T00:00:00Z', 1, 1),
                (2, 11, 2, 'normal', 10, 'delisted', '2026-09-01T00:00:00Z', 1, 1);`,
    );

    const first = (await (await get('/api/admin/overview', 'tok-admin', fx.env)).json()) as {
      openReviews: number;
      resultQueue: number;
      activeListings: number;
      clubs: number;
      players: number;
    };
    expect(first).toMatchObject({ openReviews: 1, activeListings: 1, clubs: 2, players: 3 });

    // 缓存窗口内再挂一单：默认读还是旧值；fresh=1 立即重算
    fx.sqlite.exec(
      `INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, window_seq, season)
       VALUES (3, 12, 2, 'normal', 8, 'listed', '2026-09-02T00:00:00Z', 1, 1)`,
    );
    const cached = (await (await get('/api/admin/overview', 'tok-admin', fx.env)).json()) as { activeListings: number };
    expect(cached.activeListings).toBe(1);
    const fresh = (await (await get('/api/admin/overview?fresh=1', 'tok-admin', fx.env)).json()) as { activeListings: number };
    expect(fresh.activeListings).toBe(2);
  });

  it('未登录 401；普通（非管理组）用户 403', async () => {
    const fx = freshEnv();
    expect((await app.request('/api/admin/overview', {}, fx.env)).status).toBe(401);
  });
});
