// bot 通知（§12）：排队（俱乐部→绑定教练→qq）、HMAC 投递（X-Sign 验签 + 200 标 sent）、
// cron 重试（失败留 pending）、赛果确认/升级两个写入点的端到端。
import { describe, expect, it, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

const SECRET = 'testsecret';
const BASE = 'http://plugin.test';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0);`,
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
    SYNC_BASE_URL: BASE,
    SYNC_SECRET: SECRET,
  };
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  return { env, sqlite, tour, kv };
}

function post(path: string, body: unknown, token: string, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` },
      body: JSON.stringify(body),
    },
    env,
  );
}

interface FetchCall {
  url: string;
  ts: string;
  sign: string;
  body: string;
}

function mockFetch(status: number, calls: FetchCall[] = []): void {
  const impl = async (url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      ts: headers['X-Timestamp'] ?? '',
      sign: headers['X-Sign'] ?? '',
      body: String(init?.body ?? ''),
    });
    return new Response(JSON.stringify({ ok: true }), { status });
  };
  (globalThis as { fetch: unknown }).fetch = impl;
}

afterEach(() => {
  // vitest 环境每用例隔离，但显式还原防泄漏
  (globalThis as { fetch: unknown }).fetch = undefined;
});

describe('通知排队（§12）', () => {
  it('俱乐部绑了 QQ 的教练各排一条 pending；没绑 QQ 的静默跳过', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '曼城', 'premier', 'active');
      INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 11, '2026-01-01T00:00:00Z'), (2, 22, '2026-01-01T00:00:00Z');
      INSERT INTO qq_links (user_id, qq, verified_at) VALUES (11, '10001', '2026-01-01T00:00:00Z');
      -- user 22（曼城教练）没绑 QQ
    `);
    const { queueClubNotification } = await import('../src/worker/notify.ts');
    const n1 = await queueClubNotification(fx.env.DB, 1, 'result_confirmed', {
      season: 3,
      windowSeq: 1,
      competition: 'league_premier',
      score: '2:1',
      home: '阿森纳',
      away: '曼城',
    });
    expect(n1).toBe(1);
    const n2 = await queueClubNotification(fx.env.DB, 2, 'result_confirmed', { season: 3, windowSeq: 1, score: '0:0' });
    expect(n2).toBe(0);

    const rows = sqlAll<{ template: string; payload: string; status: string }>(
      fx.sqlite,
      'SELECT template, payload, status FROM notifications ORDER BY id',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ template: 'result_confirmed', status: 'pending' });
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({
      qq: '10001',
      text: '📋 赛果已确认：阿森纳 2:1 曼城（S3·窗1 · league_premier）。',
    });
  });
});

describe('通知投递（HMAC §12-1）', () => {
  it('200 标 sent 且签名可验；非 200 留 pending 下轮再投', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO notifications (id, channel, template, payload, status, created_at) VALUES
        (1, 'qq', 'result_confirmed', '{"qq":"10001","text":"第一条"}', 'pending', '2026-01-01T00:00:00Z'),
        (2, 'qq', 'result_confirmed', '{"qq":"10002","text":"第二条"}', 'pending', '2026-01-01T00:00:00Z');
    `);

    const calls: FetchCall[] = [];
    mockFetch(200, calls);
    const { dispatchPendingNotifications } = await import('../src/worker/notify.ts');
    const r1 = await dispatchPendingNotifications(fx.env);
    expect(r1).toMatchObject({ checked: 2, sent: 2, failed: 0 });

    // 验签：规范串 POST|/notify|{ts}|{body}，密钥 SYNC_SECRET
    expect(calls).toHaveLength(2);
    const expected = createHmac('sha256', SECRET)
      .update(`POST|/notify|${calls[0]!.ts}|${calls[0]!.body}`)
      .digest('hex');
    expect(calls[0]!.sign).toBe(expected);
    expect(calls[0]!.url).toBe(`${BASE}/notify`);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ qq: '10001', template: 'result_confirmed', text: '第一条' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM notifications WHERE id = 1')?.status).toBe('sent');

    // 再排一条：首次投递 500 留 pending，下轮 200 补上
    fx.sqlite.exec(
      `INSERT INTO notifications (id, channel, template, payload, status, created_at) VALUES
        (3, 'qq', 'result_confirmed', '{"qq":"10003","text":"第三条"}', 'pending', '2026-01-01T00:00:00Z')`,
    );
    let failNext = true;
    (globalThis as { fetch: unknown }).fetch = async () =>
      new Response(failNext ? 'boom' : JSON.stringify({ ok: true }), { status: failNext ? 500 : 200 });
    const r2 = await dispatchPendingNotifications(fx.env);
    expect(r2).toMatchObject({ checked: 1, sent: 0, failed: 1 });
    failNext = false;
    const r3 = await dispatchPendingNotifications(fx.env);
    expect(r3).toMatchObject({ checked: 1, sent: 1 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM notifications WHERE id = 3')?.status).toBe('sent');
  });

  it('坏 payload 标 failed 防空转；未配置 SYNC_* 直接跳过', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(
      `INSERT INTO notifications (id, channel, template, payload, status, created_at) VALUES
        (1, 'qq', 'x', 'not-json', 'pending', '2026-01-01T00:00:00Z')`,
    );
    const calls: FetchCall[] = [];
    mockFetch(200, calls);
    const { dispatchPendingNotifications } = await import('../src/worker/notify.ts');
    const r1 = await dispatchPendingNotifications(fx.env);
    expect(r1).toMatchObject({ checked: 1, sent: 0, failed: 1 });
    expect(calls).toHaveLength(0); // 坏 payload 不出网
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM notifications WHERE id = 1')?.status).toBe('failed');

    const bare = freshEnv();
    delete (bare.env as { SYNC_BASE_URL?: string }).SYNC_BASE_URL;
    const r2 = await dispatchPendingNotifications(bare.env);
    expect(r2).toMatchObject({ checked: 0, sent: 0, skipped: 'unconfigured' });
  });
});

describe('写入点端到端（§11 确认钩子② + §10.2 升级）', () => {
  it('确认赛果 → 双方教练各排一条；cron tick 投递 sent', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '曼城', 'premier', 'active');
      INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 11, '2026-01-01T00:00:00Z'), (2, 22, '2026-01-01T00:00:00Z');
      INSERT INTO qq_links (user_id, qq, verified_at) VALUES (11, '10001', '2026-01-01T00:00:00Z'), (22, '20002', '2026-01-01T00:00:00Z');
    `);
    fx.tour.exec(`
      CREATE TABLE tournament (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
      CREATE TABLE stage (id INTEGER PRIMARY KEY, tournament_id INTEGER, kind TEXT, sort_order INTEGER, name TEXT);
      CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER, team_id INTEGER, seed INTEGER);
      CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE player (id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT, number INTEGER);
      CREATE TABLE match_event (id INTEGER PRIMARY KEY, match_id INTEGER, player_id INTEGER, assist_player_id INTEGER, type TEXT, minute INTEGER);
      CREATE TABLE match (
        id INTEGER PRIMARY KEY, stage_id INTEGER, round INTEGER, slot INTEGER,
        home_entry_id INTEGER, away_entry_id INTEGER,
        score_home INTEGER, score_away INTEGER, pen_home INTEGER, pen_away INTEGER,
        status TEXT, winner_entry_id INTEGER, finished_at TEXT, walkover_side TEXT DEFAULT ''
      );
      INSERT INTO tournament (id, name, status) VALUES (5, 'S3 顶级联赛', 'running');
      INSERT INTO stage (id, tournament_id, kind, sort_order, name) VALUES (50, 5, 'round_robin', 1, '常规赛');
      INSERT INTO team (id, name) VALUES (1, '阿森纳'), (2, '曼城');
      INSERT INTO entry (id, tournament_id, team_id, seed) VALUES (11, 5, 1, 1), (12, 5, 2, 2);
      INSERT INTO match (id, stage_id, round, slot, home_entry_id, away_entry_id, score_home, score_away, status, winner_entry_id, finished_at)
        VALUES (900, 50, 1, 1, 11, 12, 2, 1, 'finished', 11, '2026-07-03T21:00:00Z');
    `);
    await post('/api/admin/seasons', { season: 3 }, 'tok-admin', fx.env);
    await post('/api/admin/windows/open', { season: 3, windowSeq: 1 }, 'tok-admin', fx.env);
    await post(
      '/api/admin/seasons/3/bind-tournament',
      { windowSeq: 1, tournamentId: 5, competitionType: 'league_premier' },
      'tok-admin',
      fx.env,
    );

    const confirm = await post('/api/admin/results/900/confirm', {}, 'tok-admin', fx.env);
    expect(confirm.status).toBe(201);
    const rows = sqlAll<{ template: string; payload: string; status: string }>(
      fx.sqlite,
      'SELECT template, payload, status FROM notifications ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    const texts = rows.map((r) => (JSON.parse(r.payload) as { qq: string; text: string }).text);
    expect(texts[0]).toBe('📋 赛果已确认：阿森纳 2:1 曼城（S3·窗1 · league_premier）。');
    expect(texts[1]).toBe(texts[0]);
    expect(new Set(rows.map((r) => (JSON.parse(r.payload) as { qq: string }).qq))).toEqual(new Set(['10001', '20002']));

    const calls: FetchCall[] = [];
    mockFetch(200, calls);
    const tick = await post('/api/cron/tick', {}, 'tok-admin', fx.env);
    expect(tick.status).toBe(200);
    expect(((await tick.json()) as { notify: { sent: number } }).notify.sent).toBe(2);
    expect(calls).toHaveLength(2);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE status = 'sent'")?.n).toBe(2);
  });

  it('升级 → 教练收升级通知', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
      INSERT INTO players (id, uid, name, club_id, position, status, growth_tier, growth_xp, ca) VALUES (10, 'p10', '张三', 1, 'ST', 'normal', 1, 10, 80);
      INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 11, '2026-01-01T00:00:00Z');
      INSERT INTO qq_links (user_id, qq, verified_at) VALUES (11, '10001', '2026-01-01T00:00:00Z');
    `);
    fx.tour.exec(`
      INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (2, '教练乙', 'coach', 0, 0);
    `);
    fx.sqlite.exec(`
      INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z');
      INSERT INTO qq_links (user_id, qq, verified_at) VALUES (2, '30003', '2026-01-01T00:00:00Z');
    `);
    const lv = await post('/api/growth/levelup/10', { planIndex: 0 }, 'tok-admin', fx.env);
    expect(lv.status).toBe(200);
    const rows = sqlAll<{ payload: string; status: string }>(fx.sqlite, 'SELECT payload, status FROM notifications');
    expect(rows).toHaveLength(2); // 两个绑定账号各一条
    const texts = rows.map((r) => (JSON.parse(r.payload) as { text: string }).text);
    expect(texts.every((t) => t === '🎉 张三 升级完成：+1 CA。')).toBe(true);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });
});
