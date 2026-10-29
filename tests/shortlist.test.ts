// v6.58.0 候选名单：CRUD/上限/隔离/筛选（TC-S）+ 三事件通知与操作方排除（TC-N）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { completeTermination, completeTransfer } from '../src/worker/transfers.ts';
import { fmtBeijingMinute } from '../src/core/ops-schedule.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  // 1 = 卖方/教练甲，2 = 买方/教练乙，3 = 只收藏不操作（教练丙）
  const ids = Array.from({ length: 30 }, (_, i) => 100 + i);
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES
      (1, '卖队', 'premier', 'active'), (2, '买队', 'premier', 'active'), (3, '看客队', 'premier', 'active');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES
      (1, 1, '2026-01-01T00:00:00Z'), (2, 2, '2026-01-01T00:00:00Z'), (3, 5, '2026-01-01T00:00:00Z');
    INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
      (1, 100, '2026-01-01T00:00:00Z'), (2, 100, '2026-01-01T00:00:00Z'), (3, 100, '2026-01-01T00:00:00Z');
    INSERT INTO stadiums (club_id, name, capacity, tier) VALUES (1, '场', 20000, 0), (2, '场', 20000, 0), (3, '场', 20000, 0);
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
    INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status, fc_id) VALUES
      (1, 'fc1', '一号', 1, 'ST', 24, 80, 88, 30, 'normal', 501),
      (2, 'fc2', '二号', 1, 'CM', 25, 78, 85, 20, 'normal', 502),
      (3, 'fc3', '三号', NULL, 'GK', 22, 70, 80, 10, 'free', 503);
    INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from)
      VALUES (1, 1, 1, 20, 2, 'formal', 1, '2026-07-01'),
             (2, 2, 1, 16, 2, 'formal', 1, '2026-07-01');
    INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status, fc_id)
      VALUES ${ids.map((id, i) => `(${id}, 'cap${id}', '候选${i}', NULL, 'CM', 24, 70, 80, 5, 'free', ${1000 + i})`).join(', ')};
  `);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '教练甲', 'coach', 0, 0), (2, '教练乙', 'coach', 0, 0), (5, '教练丙', 'coach', 0, 0), (99, '观众', 'user', 0, 0);`,
  );
  const kv = new Map<string, string>();
  for (const [uid, token] of [
    [1, 'tok-c1'],
    [2, 'tok-c2'],
    [5, 'tok-c3'],
    [99, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  } as unknown as Env;
  return { env, sqlite, kv };
}

function req(fx: Fixture, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, token: string | null, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    fx.env,
  );
}

const add = (fx: Fixture, token: string | null, playerId: number, note?: string) =>
  req(fx, 'POST', '/api/club/shortlist', token, { playerId, note });
const list = (fx: Fixture, token: string | null = 'tok-c1') => req(fx, 'GET', '/api/club/shortlist', token);
const ids = (fx: Fixture, token: string | null = 'tok-c1') => req(fx, 'GET', '/api/club/shortlist/ids', token);
const notifs = (fx: Fixture, clubId: number) =>
  sqlAll<{ template: string; payload: string }>(fx.sqlite, 'SELECT template, payload FROM notifications WHERE club_id = ? AND channel = ? ORDER BY id', clubId, 'web');

describe('TC-S 候选名单 CRUD / 上限 / 隔离 / 筛选', () => {
  it('TC-S-001 加入三种状态球员 → 名单/备注/移除；重复 409；cap=30 时第 31 人 409', async () => {
    const fx = freshEnv();
    for (const [pid, note] of [
      [1, '本队前锋'],
      [3, '自由身门将'],
    ] as const) {
      expect((await add(fx, 'tok-c1', pid, note)).status).toBe(201);
    }
    expect((await add(fx, 'tok-c1', 1)).status).toBe(409); // 重复
    const body = (await (await list(fx)).json()) as {
      cap: number;
      items: {
        id: number;
        playerId: number;
        note: string | null;
        player: { name: string; clubName: string | null; status: string; ca: number | null; fcId: number | null };
      }[];
    };
    expect(body.cap).toBe(30);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ playerId: 3, note: '自由身门将', player: { name: '三号', clubName: null, status: 'free', fcId: 503 } });
    expect(body.items[1]).toMatchObject({ playerId: 1, note: '本队前锋', player: { clubName: '卖队', ca: 80, fcId: 501 } });

    // 备注修改 / 移除
    const rowId = body.items[1]!.id;
    expect((await req(fx, 'PATCH', `/api/club/shortlist/${rowId}`, 'tok-c1', { note: '改备注' })).status).toBe(200);
    const after = (await (await list(fx)).json()) as { items: { id: number; note: string | null }[] };
    expect(after.items.find((i) => i.id === rowId)?.note).toBe('改备注');
    expect((await req(fx, 'DELETE', `/api/club/shortlist/${rowId}`, 'tok-c1')).status).toBe(200);
    expect((await (await list(fx)).json()) as { items: unknown[] }).toMatchObject({ items: [{ playerId: 3 }] });

    // 上限：club2 加满 30（自由身球员 100..129），第 31 个被 409 拦
    for (let i = 0; i < 30; i++) {
      expect((await add(fx, 'tok-c2', 100 + i)).status).toBe(201);
    }
    const over = await add(fx, 'tok-c2', 3);
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toContain('最多 30 人');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM player_shortlist WHERE club_id = 2')?.n).toBe(30);
  });

  it('TC-S-002 跨俱乐部隔离；匿名 401；未绑定 403；/ids 匿名 401；cap=0 关闭功能', async () => {
    const fx = freshEnv();
    const created = (await (await add(fx, 'tok-c1', 1)).json()) as { item: { id: number } };
    const rowId = created.item.id;
    expect((await req(fx, 'PATCH', `/api/club/shortlist/${rowId}`, 'tok-c2', { note: '偷改' })).status).toBe(404);
    expect((await req(fx, 'DELETE', `/api/club/shortlist/${rowId}`, 'tok-c2')).status).toBe(404);
    expect(sqlGet<{ note: string | null }>(fx.sqlite, 'SELECT note FROM player_shortlist WHERE id = ?', rowId)?.note).toBeNull();

    for (const r of [await list(fx, null), await ids(fx, null), await add(fx, null, 2)]) {
      expect(r.status).toBe(401);
      await r.json();
    }
    expect((await list(fx, 'tok-viewer')).status).toBe(403);
    expect((await add(fx, 'tok-viewer', 2)).status).toBe(403);

    // cap=0：功能关闭，任何加入都 409（读名单仍可用）
    fx.sqlite.prepare("INSERT INTO config (key, value, updated_at) VALUES ('shortlist_cap', '0', '2026-01-01T00:00:00Z')").run();
    resetConfigCache();
    const off = await add(fx, 'tok-c2', 2);
    expect(off.status).toBe(409);
    expect(((await off.json()) as { error: string }).error).toContain('功能未开启');
  });

  it('TC-S-002b ids 端点同时回 playerIds 与行 id（球员页移出要用行 id）', async () => {
    const fx = freshEnv();
    await add(fx, 'tok-c1', 1);
    await add(fx, 'tok-c1', 3);
    const body = (await (await ids(fx, 'tok-c1')).json()) as {
      playerIds: number[];
      entries: { id: number; playerId: number }[];
    };
    expect(body.playerIds.sort()).toEqual([1, 3]);
    expect(body.entries.map((e) => e.playerId).sort()).toEqual([1, 3]);
    for (const e of body.entries) expect(e.id).toBeGreaterThan(0);
  });

  it('TC-S-003 ?shortlist=1 只出本队名单；匿名 401；未绑定空；公开列表不含星标字段', async () => {
    const fx = freshEnv();
    await add(fx, 'tok-c1', 1);
    await add(fx, 'tok-c1', 3);
    await add(fx, 'tok-c2', 2);

    const r1 = (await (await req(fx, 'GET', '/api/players?shortlist=1', 'tok-c1')).json()) as { players: { id: number }[] };
    expect(r1.players.map((p) => p.id).sort()).toEqual([1, 3]);
    const r2 = (await (await req(fx, 'GET', '/api/players?shortlist=1', 'tok-c2')).json()) as { players: { id: number }[] };
    expect(r2.players.map((p) => p.id)).toEqual([2]);

    const anon = await req(fx, 'GET', '/api/players?shortlist=1', null);
    expect(anon.status).toBe(401);
    await anon.json();
    const unbound = (await (await req(fx, 'GET', '/api/players?shortlist=1', 'tok-viewer')).json()) as { players: unknown[] };
    expect(unbound.players).toEqual([]);

    // 公开列表不混 per-user 字段（缓存不能污染）
    const pub = await req(fx, 'GET', '/api/players?limit=5', null);
    expect(pub.status).toBe(200);
    expect(await pub.text()).not.toContain('shortlist');
  });
});

describe('TC-N 候选名单三事件通知与操作方排除', () => {
  it('TC-N-001 被挂牌：收藏者收通知（挂牌价 + 预计截止），操作方自己不发', async () => {
    const fx = freshEnv();
    await add(fx, 'tok-c3', 1); // 看客队收藏
    await add(fx, 'tok-c1', 1); // 卖方自己也收藏（操作方，不发）
    const res = await req(fx, 'POST', '/api/market/listings', 'tok-c1', { playerId: 1, askPrice: 15 });
    expect(res.status).toBe(201);

    const watcher = notifs(fx, 3);
    expect(watcher).toHaveLength(1);
    expect(watcher[0]!.template).toBe('shortlist_listed');
    expect(watcher[0]!.payload).toContain('挂牌价 15 m');
    expect(watcher[0]!.payload).toContain('一号');
    // 截止时刻必须是真值（v6.58.0 变异验证补强）：只断言标签会放过 data.deadline 丢失，
    // 模板会把 undefined 原样印进正文。
    const listing = sqlGet<{ deadline_at: string | null; activation_deadline: string | null }>(
      fx.sqlite,
      'SELECT deadline_at, activation_deadline FROM listings WHERE player_id = 1',
    );
    const deadline = listing?.deadline_at ?? listing?.activation_deadline ?? null;
    expect(deadline).toBeTruthy();
    expect(watcher[0]!.payload).toContain(`预计竞价截止 ${fmtBeijingMinute(deadline!)}`);
    expect(watcher[0]!.payload).not.toContain('undefined');
    expect(JSON.parse(watcher[0]!.payload).ref).toEqual({ type: 'player', id: 1 });
    expect(notifs(fx, 1)).toHaveLength(0);
  });

  it('TC-N-002 被签走（completeTransfer 单点）：买家自己收藏时不发，其他收藏者带成交价+买方名', async () => {
    const fx = freshEnv();
    await add(fx, 'tok-c3', 1);
    await add(fx, 'tok-c2', 1); // 买方收藏（操作方，不发）
    fx.sqlite.exec(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq)
       VALUES (1, 'transfer', 1, 1, 2, 10, 'pending_review', 1, 1)`,
    );
    const out = await completeTransfer(fx.env, 1, 1, 'user');
    expect(out.status).toBe('completed');

    const watcher = notifs(fx, 3);
    expect(watcher).toHaveLength(1);
    expect(watcher[0]!.template).toBe('shortlist_sold');
    expect(watcher[0]!.payload).toContain('成交价 10 m');
    expect(watcher[0]!.payload).toContain('买队');
    expect(notifs(fx, 2)).toHaveLength(0);

    // 重放不重复通知
    await completeTransfer(fx.env, 1, 1, 'user');
    expect(notifs(fx, 3)).toHaveLength(1);
  });

  it('TC-N-003 解约变自由身：收藏者收通知，操作方自己不发；重放不重复', async () => {
    const fx = freshEnv();
    await add(fx, 'tok-c3', 2);
    await add(fx, 'tok-c1', 2);
    fx.sqlite.exec(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, extra_fee, status, season, window_seq)
       VALUES (2, 'termination', 2, 1, NULL, 0, 'pending_review', 1, 1)`,
    );
    expect((await completeTermination(fx.env, 2, 1, 'user')).status).toBe('completed');
    const watcher = notifs(fx, 3);
    expect(watcher).toHaveLength(1);
    expect(watcher[0]!.template).toBe('shortlist_released');
    expect(watcher[0]!.payload).toContain('解约');
    expect(notifs(fx, 1)).toHaveLength(0);
    await completeTermination(fx.env, 2, 1, 'user');
    expect(notifs(fx, 3)).toHaveLength(1);
  });
});
