// v6.58.0 管理组发券（TC-G-001）：批量入账 / 审计 / requestId 幂等 / 权限与参数校验 / 对账
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

function freshEnv() {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status) VALUES (1, 'A 队', 'premier', 'active'), (2, 'B 队', 'premier', 'active');`);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
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
  return { env, sqlite };
}

function post(env: Env, token: string, body: unknown) {
  return app.request(
    '/api/admin/vouchers/grant',
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${token}` }, body: JSON.stringify(body) },
    env,
  );
}

const vouchersOf = (sqlite: DatabaseSync, clubId: number) =>
  sqlGet<{ vouchers: number }>(sqlite, 'SELECT vouchers FROM ledger_accounts WHERE club_id = ?', clubId)?.vouchers ?? 0;

describe('TC-G-001 管理组发券', () => {
  it('批量发放入账 + 审计；同 requestId 重发只入账一次；无 requestId 可重复发放', async () => {
    const { env, sqlite } = freshEnv();
    const res = await post(env, 'tok-admin', { clubIds: [1, 2], amount: 3.5, note: '补偿', requestId: 'req-1' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ granted: 2, replayed: 0, amount: 3.5, total: 7 });
    expect(vouchersOf(sqlite, 1)).toBe(3.5);
    expect(vouchersOf(sqlite, 2)).toBe(3.5);
    expect(sqlAll<{ club_id: number; amount: number }>(sqlite, "SELECT club_id, amount FROM voucher_entries WHERE kind='admin_grant' ORDER BY club_id")).toEqual([
      { club_id: 1, amount: 3.5 },
      { club_id: 2, amount: 3.5 },
    ]);
    // 评审修复：审计逐个俱乐部落（不再只留一条「末家 changes 兜底」），且 after 带 clubId
    const audit = sqlAll<{ actor: number; origin: string; after: string }>(sqlite, "SELECT actor, origin, after FROM audit_log WHERE action='voucher_grant' ORDER BY id");
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actor: 1, origin: 'user' });
    expect(JSON.parse(audit[0]!.after)).toMatchObject({ clubId: 1, amount: 3.5, requestId: 'req-1' });
    expect(JSON.parse(audit[1]!.after)).toMatchObject({ clubId: 2 });

    // 同一个 requestId 重放：券余额与流水不变，也不再留第二条审计
    const replay = await post(env, 'tok-admin', { clubIds: [1, 2], amount: 3.5, note: '补偿', requestId: 'req-1' });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ granted: 0, replayed: 2, total: 0 });
    expect(vouchersOf(sqlite, 1)).toBe(3.5);
    expect(sqlAll(sqlite, "SELECT id FROM voucher_entries WHERE kind='admin_grant'")).toHaveLength(2);
    expect(sqlAll(sqlite, "SELECT id FROM audit_log WHERE action='voucher_grant'")).toHaveLength(2);

    // 不带 requestId：管理员主动重复发放允许（每次一条审计）
    await post(env, 'tok-admin', { clubIds: [1], amount: 1, note: '二次' });
    await post(env, 'tok-admin', { clubIds: [1], amount: 1, note: '二次' });
    expect(vouchersOf(sqlite, 1)).toBe(5.5);
    expect(sqlAll(sqlite, "SELECT id FROM audit_log WHERE action='voucher_grant'")).toHaveLength(4);

    // 对账不变量
    for (const row of sqlAll<{ club_id: number; vouchers: number }>(sqlite, 'SELECT club_id, vouchers FROM ledger_accounts')) {
      const sum = sqlGet<{ s: number }>(sqlite, 'SELECT COALESCE(SUM(amount), 0) AS s FROM voucher_entries WHERE club_id = ?', row.club_id);
      expect(row.vouchers).toBeCloseTo(sum?.s ?? 0, 6);
    }
  });

  it('all=true 只发真实俱乐部（跳过 CPU 队）；参数/权限/不存在俱乐部各自被拒', async () => {
    const { env, sqlite } = freshEnv();
    sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (3, '机器人队 (CPU)', 'premier', 'active', 1);`);
    expect(await post(env, 'tok-admin', { all: true, amount: 2, note: '全联盟' })).toHaveProperty('status', 201);
    expect(vouchersOf(sqlite, 1)).toBe(2);
    expect(vouchersOf(sqlite, 2)).toBe(2);
    expect(vouchersOf(sqlite, 3)).toBe(0);

    const bad = [
      { clubIds: [1], amount: 0, note: 'x' },
      { clubIds: [1], amount: -1, note: 'x' },
      { clubIds: [1], amount: 1, note: '   ' },
      { clubIds: [], amount: 1, note: 'x' },
      { clubIds: [999], amount: 1, note: 'x' },
      { clubIds: [1], amount: 1, note: 'x', requestId: 'bad id!' },
    ];
    for (const body of bad) {
      const res = await post(env, 'tok-admin', body);
      expect(res.status).toBeGreaterThanOrEqual(400);
      await res.json();
    }
    expect((await post(env, 'tok-coach', { clubIds: [1], amount: 1, note: 'x' })).status).toBe(403);
  });

  it('TC-G-002 同 requestId 换俱乐部集合：只给没发过的入账，返回 granted/replayed 如实计数', async () => {
    const { env, sqlite } = freshEnv();
    expect(await (await post(env, 'tok-admin', { clubIds: [1], amount: 2, note: '部分', requestId: 'req-part' })).json()).toMatchObject({
      granted: 1,
      replayed: 0,
    });
    // 同一个 requestId 再带上 club2：club1 幂等跳过、club2 真实入账
    const res = await post(env, 'tok-admin', { clubIds: [1, 2], amount: 2, note: '部分', requestId: 'req-part' });
    expect(await res.json()).toMatchObject({ granted: 1, replayed: 1, amount: 2, total: 2 });
    expect(vouchersOf(sqlite, 1)).toBe(2);
    expect(vouchersOf(sqlite, 2)).toBe(2);
    // 审计只给真实入账的两家各一条
    expect(sqlAll(sqlite, "SELECT id FROM audit_log WHERE action='voucher_grant'")).toHaveLength(2);
  });
});
