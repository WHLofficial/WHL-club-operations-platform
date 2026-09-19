// 财政流水账与手动记账（附录 A〔6〕，§7.4）：余额口径、翻页、类型筛选、兜底记账校验与审计
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';

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
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
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
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${token}` } }, env);
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

async function bindCoach(fx: Fixture): Promise<number> {
  const auth = attachAuthChannel(fx.env);
  const res = await post('/api/admin/clubs', { name: '阿森纳', leagueTier: 'premier', gameTeamId: 9001 }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const { club } = (await res.json()) as { club: { id: number } };
  authRegisterClubTeam(auth, club.id, club.id, '阿森纳');
  const codeRes = await post(`/api/admin/clubs/${club.id}/bindcode`, {}, 'tok-admin', fx.env);
  const { code } = (await codeRes.json()) as { code: string };
  const bind = await post('/api/clubs/bind', { code }, 'tok-coach', fx.env);
  expect(bind.status).toBe(201);
  return club.id;
}

async function seedOpening(fx: Fixture, clubId: number, balance: number): Promise<void> {
  const res = await post('/api/admin/ledger/opening-import', { rows: [{ clubId, balance }] }, 'tok-admin', fx.env);
  expect(res.status).toBe(200);
}

describe('财政余额与流水账（附录 A〔6〕）', () => {
  it('未绑定俱乐部：余额与流水返回空档', async () => {
    const fx = freshEnv();
    const bal = await get('/api/club/balance', 'tok-coach', fx.env);
    expect(bal.status).toBe(200);
    expect((await bal.json()) as Record<string, unknown>).toEqual({ club: null, balance: null, held: null, available: null });
    const ledger = await get('/api/club/ledger', 'tok-coach', fx.env);
    expect(ledger.status).toBe(200);
    expect((await ledger.json()) as Record<string, unknown>).toEqual({ club: null, entries: [], nextCursor: null });
  });

  it('余额口径 = 余额 − 冻结（held），与出价校验一致', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    await seedOpening(fx, clubId, 100);
    fx.sqlite.exec(
      `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
       VALUES (${clubId}, 12.5, 'held', 'listing', 9, '2026-07-01T00:00:00Z'),
              (${clubId}, 3, 'released', 'listing', 8, '2026-07-01T00:00:00Z');`,
    );
    const res = await get('/api/club/balance', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { club: { id: number }; balance: number; held: number; available: number };
    expect(body).toEqual({ club: { id: clubId, name: '阿森纳' }, balance: 100, held: 12.5, available: 87.5 });
  });

  it('流水新→旧倒序，DTO camelCase；翻页 cursor 取上一页末条，35 条分两页', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    await seedOpening(fx, clubId, 100);
    // SQL 直种 34 条凑 35 条流水，页大小 30 → 第一页 30 条带 cursor，第二页 5 条到头
    const values: string[] = [];
    for (let i = 1; i <= 34; i++) {
      values.push(`(${clubId}, 'manual_adjust', 1, ${100 + i}, 'manual', NULL, '种子流水 #${i}', '2026-07-01T00:00:00Z')`);
    }
    fx.sqlite.exec(`INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at) VALUES ${values.join(', ')};`);

    const p1 = await get('/api/club/ledger', 'tok-coach', fx.env);
    const b1 = (await p1.json()) as { club: { id: number }; entries: { id: number; kind: string; amount: number; balanceAfter: number; memo: string }[]; nextCursor: number | null };
    expect(b1.club).toEqual({ id: clubId, name: '阿森纳' });
    expect(b1.entries).toHaveLength(30);
    // 最新一条在最前（种子的最后一条 balance_after=134）
    expect(b1.entries[0]).toMatchObject({ kind: 'manual_adjust', amount: 1, balanceAfter: 134, memo: '种子流水 #34' });
    expect(b1.nextCursor).toBe(b1.entries[29]!.id);

    const p2 = await get(`/api/club/ledger?cursor=${b1.nextCursor}`, 'tok-coach', fx.env);
    const b2 = (await p2.json()) as { entries: { id: number; memo: string }[]; nextCursor: number | null };
    expect(b2.entries).toHaveLength(5);
    expect(b2.entries[0]!.memo).toBe('种子流水 #4');
    expect(b2.entries[4]).toMatchObject({ kind: 'opening_import', balanceAfter: 100 });
    expect(b2.nextCursor).toBeNull();
  });

  it('类型筛选：只出该 kind 的流水，cursor 串联合法', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    await seedOpening(fx, clubId, 100);
    await post('/api/admin/ledger/manual', { clubId, kind: 'prize_premier_win', amount: 8.5, memo: '第 1 轮胜' }, 'tok-admin', fx.env);
    const res = await get('/api/club/ledger?kind=prize_premier_win', 'tok-coach', fx.env);
    const body = (await res.json()) as { entries: { kind: string }[]; nextCursor: number | null };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.kind).toBe('prize_premier_win');
    expect(body.nextCursor).toBeNull();

    const bad = await get('/api/club/ledger?kind=DROP%20TABLE', 'tok-coach', fx.env);
    expect(bad.status).toBe(400);
  });
});

describe('手动记账兜底（§7.1 manual_adjust / prize_*，§9.1）', () => {
  it('冲账与奖金模板入账：余额、balance_after、审计逐笔留痕；允许重复记', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    await seedOpening(fx, clubId, 50);

    const adj = await post(
      '/api/admin/ledger/manual',
      { clubId, kind: 'manual_adjust', amount: -5, memo: '冲正重复记的转会税' },
      'tok-admin',
      fx.env,
    );
    expect(adj.status).toBe(201);
    expect(((await adj.json()) as { balance: number }).balance).toBe(45);

    const prize = await post(
      '/api/admin/ledger/manual',
      { clubId, kind: 'prize_premier_win', amount: 8.5, memo: '第 1 轮胜' },
      'tok-admin',
      fx.env,
    );
    expect(prize.status).toBe(201);

    // 兜底工具允许重复记（不走 (kind, ref) 幂等闸），审计逐笔可查
    const again = await post(
      '/api/admin/ledger/manual',
      { clubId, kind: 'prize_premier_win', amount: 8.5, memo: '第 2 轮胜' },
      'tok-admin',
      fx.env,
    );
    expect(again.status).toBe(201);
    const rows = sqlAll<{ kind: string; amount: number; balance_after: number; ref_type: string }>(
      fx.sqlite,
      'SELECT kind, amount, balance_after, ref_type FROM ledger_entries ORDER BY id',
    );
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ kind: 'prize_premier_win', amount: 8.5, balance_after: 53.5, ref_type: 'manual' });
    expect(rows[3]).toMatchObject({ balance_after: 62 });
    const audits = sqlAll<{ action: string }>(fx.sqlite, "SELECT action FROM audit_log WHERE action = 'ledger_manual'");
    expect(audits).toHaveLength(3);
  });

  it('校验：非法 kind / 奖金负数 / 空 memo / 金额 0 / 不存在的俱乐部 / 教练无权', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    const cases: { body: Record<string, unknown>; status: number; msg?: string }[] = [
      { body: { clubId, kind: 'transfer_in', amount: 1, memo: 'x' }, status: 400 },
      { body: { clubId, kind: 'prize_premier_win', amount: -1, memo: 'x' }, status: 400 },
      { body: { clubId, kind: 'manual_adjust', amount: 1, memo: '  ' }, status: 400 },
      { body: { clubId, kind: 'manual_adjust', amount: 0, memo: 'x' }, status: 400 },
      { body: { clubId: 999, kind: 'manual_adjust', amount: 1, memo: 'x' }, status: 404 },
      { body: { clubId: 'abc', kind: 'manual_adjust', amount: 1, memo: 'x' }, status: 400 },
    ];
    for (const tc of cases) {
      const res = await post('/api/admin/ledger/manual', tc.body, 'tok-admin', fx.env);
      expect(res.status).toBe(tc.status);
      await res.json();
    }
    const forbidden = await post(
      '/api/admin/ledger/manual',
      { clubId, kind: 'manual_adjust', amount: 1, memo: 'x' },
      'tok-coach',
      fx.env,
    );
    expect(forbidden.status).toBe(403);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM ledger_entries')?.n).toBe(0);
  });
});

describe('M0 货币监控（PRD：Σ俱乐部余额报表）', () => {
  it('总量=Σ俱乐部余额，冻结单列，kind 分解与俱乐部明细；教练 403', async () => {
    const fx = freshEnv();
    const clubId = await bindCoach(fx);
    await seedOpening(fx, clubId, 100);

    // 出账 12.5 进冻结（held），再解冻 3 → 余额不变、held=9.5
    const hold = await post(`/api/club/ledger/hold`, {}, 'tok-coach', fx.env);
    expect(hold.status).toBe(404); // 平台没有直接 hold 端点：冻结经出价产生，这里只校验报表口径
    await fx.sqlite.exec(
      `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
       VALUES (${clubId}, 9.5, 'held', 'bid', 1, '2026-01-01T00:00:00Z')`,
    );
    // 手动记账出账 5 → M0 相应减少
    await post('/api/admin/ledger/manual', { clubId, kind: 'manual_adjust', amount: -5, memo: '校准扣减' }, 'tok-admin', fx.env);

    const res = await get('/api/admin/m0', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const report = (await res.json()) as {
      m0: number;
      held: number;
      available: number;
      byKind: { kind: string; total: number; n: number }[];
      byClub: { id: number; name: string; balance: number }[];
    };
    expect(report.m0).toBeCloseTo(95, 6); // 100 − 5
    expect(report.held).toBeCloseTo(9.5, 6);
    expect(report.available).toBeCloseTo(85.5, 6);
    expect(report.byClub).toHaveLength(1);
    expect(report.byClub[0]).toMatchObject({ id: clubId, name: '阿森纳', balance: 95 });
    const kinds = Object.fromEntries(report.byKind.map((k) => [k.kind, k]));
    expect(kinds.opening_import?.total).toBeCloseTo(100, 6);
    expect(kinds.manual_adjust?.total).toBeCloseTo(-5, 6);

    const forbidden = await get('/api/admin/m0', 'tok-coach', fx.env);
    expect(forbidden.status).toBe(403);
  });

  it('空库：M0=0，明细为空', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/m0', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const report = (await res.json()) as { m0: number; byKind: unknown[]; byClub: unknown[] };
    expect(report.m0).toBe(0);
    expect(report.byKind).toEqual([]);
    expect(report.byClub).toEqual([]);
  });
});
