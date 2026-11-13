// v6.84.0 玩家队 → CPU 队反向转换（管理端五步：预检 → tour 改名 → 本仓改名/回收 → 解绑 → 复核）。
// 覆盖：预检阻断/干净队、建议名纯函数、tour 侧失败零改动、撞名 409、重放 changed=false、
// 余额/券回收同批、修复场景只改名、解绑 0/1/2 与部分失败、复核五项。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import type {
  CpuDetachRenameLocalResult,
  CpuDetachRenameTourResult,
  CpuDetachState,
  CpuDetachUnbindResult,
} from '../src/contract/batch4.ts';
import { applyMigrations, attachAuthChannel, createTestD1, sqlAll, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { cpuSuffixName } from '../src/worker/routes/admin/clubs.ts';

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
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0), (2, '教练乙', 'coach', 0, 0);
     CREATE TABLE team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
     INSERT INTO team (id, org_id, name) VALUES (10, 1, '蓝月亮(CPU)'), (20, 1, '待转队(CPU)'), (40, 1, '修复队(CPU)'), (50, 1, '重放队(CPU)');`,
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
    TOUR_API_BASE: 'http://tour.test',
    TEAM_SYNC_SECRET: 'test-team-sync-secret',
  };
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, kv };
}

function get(path: string, env: Env, cookie = 'tok-admin') {
  return app.request(path, { method: 'GET', headers: { Cookie: `whl_session=${cookie}` } }, env);
}

function post(path: string, body: unknown, env: Env, cookie = 'tok-admin') {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `whl_session=${cookie}` }, body: JSON.stringify(body) },
    env,
  );
}

function seedClub(fx: Fixture, id: number, name: string, isCpu = 0, transferBanned = 0): void {
  fx.sqlite
    .prepare('INSERT INTO clubs (id, name, league_tier, status, created_at, is_cpu, transfer_banned) VALUES (?, ?, NULL, ?, ?, ?, ?)')
    .run(id, name, 'active', '2026-01-01T00:00:00Z', isCpu, transferBanned);
}

function seedFunds(fx: Fixture, clubId: number, balance: number, vouchers: number): void {
  fx.sqlite
    .prepare('INSERT INTO ledger_accounts (club_id, balance, vouchers, updated_at) VALUES (?, ?, ?, ?)')
    .run(clubId, balance, vouchers, '2026-01-01T00:00:00Z');
}

function audits(fx: Fixture, action: string) {
  return sqlAll<{ id: number; action: string; target_id: number; before: string | null; after: string | null }>(
    fx.sqlite,
    'SELECT id, action, target_id, before, after FROM audit_log WHERE action = ? ORDER BY id',
    action,
  );
}

/** tour 侧机器通道桩：按路径回脚本化响应（pushTeamRename 永不抛，失败要落成 502） */
function stubTourFetch(handler: (path: string, body: string) => { status: number; json: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const reply = handler(new URL(String(url)).pathname, String(init?.body ?? ''));
      return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }),
  );
}

/** auth 解绑桩：failIds 回 500（模拟认证中心不可用），missingIds 回 not_bound（模拟并发已解绑） */
function stubUnbindFetch(auth: DatabaseSync, failIds: number[], missingIds: number[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (!u.endsWith('/api/team/unbind')) {
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }
      const accountId = Number((JSON.parse(String(init?.body ?? '{}')) as { account_id?: number }).account_id);
      if (failIds.includes(accountId)) return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
      const row = auth.prepare('SELECT team_id FROM team_binding WHERE account_id = ?').get(accountId) as
        | { team_id: number }
        | undefined;
      if (!row || missingIds.includes(accountId)) {
        return new Response(JSON.stringify({ error: 'not_bound' }), { status: 404 });
      }
      auth.prepare('DELETE FROM team_binding WHERE account_id = ?').run(accountId);
      return new Response(JSON.stringify({ ok: true, teamId: row.team_id }), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cpuSuffixName 纯函数', () => {
  it('无后缀时追加半角(CPU)，已有后缀不重复叠加且不留空格', () => {
    expect(cpuSuffixName('蓝月亮')).toBe('蓝月亮(CPU)');
    expect(cpuSuffixName('蓝月亮(CPU)')).toBe('蓝月亮(CPU)');
    expect(cpuSuffixName('蓝月亮 (CPU)')).toBe('蓝月亮(CPU)');
    expect(cpuSuffixName('蓝月亮（CPU）')).toBe('蓝月亮（CPU）(CPU)');
    expect(cpuSuffixName('蓝月亮(CPU)   ')).toBe('蓝月亮(CPU)');
  });

  it('全角括号不算后缀（只认半角），空名退回裸后缀', () => {
    expect(cpuSuffixName('蓝月亮（CPU）')).toBe('蓝月亮（CPU）(CPU)');
    expect(cpuSuffixName('   ')).toBe('(CPU)');
  });

  it('40 字边界：追加后可能超长，交给 nameError 判定', () => {
    const name = cpuSuffixName('甲'.repeat(40));
    expect(name.length).toBe(45);
    expect(name.endsWith('(CPU)')).toBe(true);
    expect(cpuSuffixName('甲'.repeat(35)).length).toBe(40);
  });
});

describe('GET /clubs/:id/to-cpu 预检', () => {
  it('干净队伍：建议名 + 阻断为空 + 未转换不 ready', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, 0, 0);
    const res = await get('/api/admin/clubs/20/to-cpu', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CpuDetachState;
    expect(body.club).toMatchObject({ id: 20, name: '待转队', isCpu: false, status: 'active' });
    expect(body.tour).toEqual({ id: 20, name: '待转队(CPU)' });
    expect(body.suggest).toEqual({ newName: '待转队(CPU)', nameError: null });
    expect(body.blockers).toEqual([]);
    expect(body.warnings).toEqual([]);
    expect(body.checks).toEqual({ isCpu: false, tourName: true, localName: false, bindings: true, codes: true, funds: true });
    expect(body.ready).toBe(false);
    expect(body.balance).toBe(0);
    expect(body.vouchers).toBe(0);
    expect(body.contracts).toEqual({ active: 0, total: 0 });
    expect(body.players).toBe(0);
  });

  it('阻断项按稳定 key 汇总（并展示余额/合同/球员）', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, 1500, 3);
    fx.sqlite.prepare("INSERT INTO negotiation_sessions (id, club_id, status) VALUES (1, 20, 'active')").run();
    fx.sqlite
      .prepare("INSERT INTO fund_holds (club_id, amount, status) VALUES (20, 100, 'held')")
      .run();
    fx.sqlite.prepare("INSERT INTO players (id, uid, name, club_id) VALUES (1, 'p1', '球员甲', 20), (2, 'p2', '球员乙', 20)").run();
    fx.sqlite
      .prepare("INSERT INTO contracts (id, club_id, player_id, is_active) VALUES (1, 20, 1, 1), (2, 20, 2, 0)")
      .run();
    const body = (await (await get('/api/admin/clubs/20/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.blockers.map((b) => b.key)).toEqual(['negotiation', 'fund_hold']);
    expect(body.blockers[0].detail).toContain('1 笔');
    expect(body.balance).toBe(1500);
    expect(body.contracts).toEqual({ active: 1, total: 2 });
    expect(body.players).toBe(2);
    expect(body.ready).toBe(false);
  });

  it('已生效的 accepted 诉求不再阻断；未生效的 accepted 仍阻断', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    fx.sqlite.prepare("INSERT INTO players (id, uid, name, club_id) VALUES (1, 'p1', '球员甲', 20)").run();
    fx.sqlite
      .prepare(
        `INSERT INTO contract_demands
          (id, player_id, club_id, season, window_seq, status, current_wage, expected_wage,
           target_wage, floor_wage, raise_pct, rc_current, rc_floor, rc_fee, round, expires_at, seed, applied_at)
         VALUES (1, 1, 20, 9, 2, 'accepted', 1, 2, 2, 1.5, 0.5, 0, 0, 0, 0, '2026-11-30T00:00:00Z', 1, NULL)`,
      )
      .run();

    let body = (await (await get('/api/admin/clubs/20/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.blockers.map((b) => b.key)).toContain('contract_demand');

    fx.sqlite.prepare("UPDATE contract_demands SET applied_at = '2026-11-20T00:00:00Z' WHERE id = 1").run();
    body = (await (await get('/api/admin/clubs/20/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.blockers.map((b) => b.key)).not.toContain('contract_demand');
  });

  it('绑定与未使用码从 auth 库读；未使用码只进 warning', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮');
    const auth = attachAuthChannel(fx.env);
    auth.exec(
      `INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z');
       INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (2, 1, 'code', '2026-01-03T00:00:00Z');
       INSERT INTO team_bind_code (team_id, code_hash, via, expires_at, created_at) VALUES (1, 'h1', 'club', '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         (1, 'h2', 'club', '2026-01-01T00:00:00Z', '2025-12-01T00:00:00Z');`,
    );
    const body = (await (await get('/api/admin/clubs/10/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.bindings).toEqual([{ userId: 2, userName: '教练乙', boundAt: '2026-01-03T00:00:00Z' }]);
    expect(body.unusedCodes).toHaveLength(1); // 过期那条不算
    expect(body.checks.bindings).toBe(false);
    expect(body.checks.codes).toBe(false);
    expect(body.warnings.map((w) => w.key)).toContain('unused_codes');
    expect(body.ready).toBe(false);
  });

  it('建议名超过 40 字 / 撞现有队名时 nameError 有值', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '甲'.repeat(40));
    let body = (await (await get('/api/admin/clubs/20/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.suggest.nameError).toBe('队名最多 40 个字');

    seedClub(fx, 21, '撞名队');
    seedClub(fx, 22, '撞名队(CPU)');
    body = (await (await get('/api/admin/clubs/21/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.suggest).toEqual({ newName: '撞名队(CPU)', nameError: '已有俱乐部使用该名字' });
  });

  it('tour 缺队只给 warning（对手方改名失败但不影响本仓）', async () => {
    const fx = freshEnv();
    seedClub(fx, 30, '无对手队');
    const body = (await (await get('/api/admin/clubs/30/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.tour).toBeNull();
    expect(body.checks.tourName).toBe(true);
    expect(body.warnings.map((w) => w.key)).toContain('tour_missing');
  });

  it('教练无权预检（403/401），管理员权限走 club.clubs.manage', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    const res = await get('/api/admin/clubs/20/to-cpu', fx.env, 'tok-coach');
    expect([401, 403]).toContain(res.status);
  });
});

describe('POST /clubs/:id/to-cpu/rename-tour', () => {
  it('服务端强制半角(CPU) 结尾与 40 字上限', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    expect((await post('/api/admin/clubs/20/to-cpu/rename-tour', { name: '待转队' }, fx.env)).status).toBe(400);
    expect((await post('/api/admin/clubs/20/to-cpu/rename-tour', { name: `${'甲'.repeat(40)}(CPU)` }, fx.env)).status).toBe(400);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM audit_log')?.n).toBe(0);
  });

  it('tour 失败回 502：本仓零改动、无审计', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    stubTourFetch(() => ({ status: 500, json: { error: 'boom' } }));
    const res = await post('/api/admin/clubs/20/to-cpu/rename-tour', { name: '待转队(CPU)' }, fx.env);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('tour_sync_failed');
    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 20')?.name).toBe('待转队');
    expect(audits(fx, 'club_cpu_detach_tour')).toHaveLength(0);
  });

  it('成功改名写 club_cpu_detach_tour；对手方已同名则 renamed=false 且不留审计', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    stubTourFetch(() => ({ status: 200, json: { ok: true, renamed: true, name: '待转队(CPU)' } }));
    let body = (await (await post('/api/admin/clubs/20/to-cpu/rename-tour', { name: '待转队(CPU)' }, fx.env)).json()) as CpuDetachRenameTourResult;
    expect(body).toEqual({ ok: true, renamed: true, name: '待转队(CPU)' });
    const rows = audits(fx, 'club_cpu_detach_tour');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].after ?? '{}')).toEqual({ from: '待转队(CPU)', to: '待转队(CPU)' });

    stubTourFetch(() => ({ status: 200, json: { ok: true, renamed: false, name: '待转队(CPU)' } }));
    body = (await (await post('/api/admin/clubs/20/to-cpu/rename-tour', { name: '待转队(CPU)' }, fx.env)).json()) as CpuDetachRenameTourResult;
    expect(body.renamed).toBe(false);
    expect(audits(fx, 'club_cpu_detach_tour')).toHaveLength(1);
  });
});

describe('POST /clubs/:id/to-cpu/rename-local', () => {
  it('一个 batch 落：改名 + is_cpu=1 + transfer_banned=0 + 余额/券回收 + 审计', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队', 0, 1);
    seedFunds(fx, 20, 1500, 3);
    const res = await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队(CPU)' }, fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as CpuDetachRenameLocalResult).toEqual({
      ok: true,
      changed: true,
      flipped: true,
      name: '待转队(CPU)',
    });
    const club = sqlGet<{ name: string; is_cpu: number; transfer_banned: number }>(
      fx.sqlite,
      'SELECT name, is_cpu, transfer_banned FROM clubs WHERE id = 20',
    );
    expect(club).toEqual({ name: '待转队(CPU)', is_cpu: 1, transfer_banned: 0 });
    const account = sqlGet<{ balance: number; vouchers: number }>(
      fx.sqlite,
      'SELECT balance, vouchers FROM ledger_accounts WHERE club_id = 20',
    );
    expect(account).toEqual({ balance: 0, vouchers: 0 });
    const cash = sqlAll<{ amount: number; kind: string; ref_type: string; ref_id: number; balance_after: number }>(
      fx.sqlite,
      'SELECT amount, kind, ref_type, ref_id, balance_after FROM ledger_entries WHERE club_id = 20',
    );
    expect(cash).toEqual([{ amount: -1500, kind: 'cpu_detach_reclaim', ref_type: 'club_cpu_detach', ref_id: 20, balance_after: 0 }]);
    const vouchers = sqlAll<{ amount: number; kind: string }>(
      fx.sqlite,
      'SELECT amount, kind FROM voucher_entries WHERE club_id = 20',
    );
    expect(vouchers).toEqual([{ amount: -3, kind: 'cpu_detach_reclaim' }]);
    const rows = audits(fx, 'club_cpu_detach_local');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].after ?? '{}')).toMatchObject({
      from: '待转队',
      to: '待转队(CPU)',
      isCpu: true,
      transferBanned: false,
      balanceBefore: 1500,
      balanceReclaimed: 1500,
      vouchersBefore: 3,
      vouchersReclaimed: 3,
    });
  });

  it('余额/券为 0 时不写回收流水', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, 0, 0);
    expect((await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队(CPU)' }, fx.env)).status).toBe(200);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM ledger_entries')?.n).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM voucher_entries')?.n).toBe(0);
  });

  it('批前余额变动后仍按实际余额清零（不再用预检快照）', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, 1500, 3);
    // 模拟预检后教练又花掉 100 现金、1 张券：回收金额必须取实际值
    fx.sqlite.exec('UPDATE ledger_accounts SET balance = 1400, vouchers = 2 WHERE club_id = 20');

    expect((await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队(CPU)' }, fx.env)).status).toBe(200);
    expect(sqlGet<{ balance: number; vouchers: number }>(fx.sqlite, 'SELECT balance, vouchers FROM ledger_accounts WHERE club_id = 20')).toEqual({
      balance: 0,
      vouchers: 0,
    });
    expect(
      sqlAll<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE club_id = 20 AND kind = 'cpu_detach_reclaim'"),
    ).toEqual([{ amount: -1400 }]);
    const after = JSON.parse(audits(fx, 'club_cpu_detach_local')[0].after ?? '{}');
    expect(after).toMatchObject({ balanceBefore: 1400, balanceReclaimed: 1400, vouchersBefore: 2, vouchersReclaimed: 2 });
  });

  it('负余额也清零：写正数流水把债务归零', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, -250, 0);

    expect((await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队(CPU)' }, fx.env)).status).toBe(200);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 20')?.balance).toBe(0);
    expect(
      sqlAll<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE club_id = 20 AND kind = 'cpu_detach_reclaim'"),
    ).toEqual([{ amount: 250 }]);
    const after = JSON.parse(audits(fx, 'club_cpu_detach_local')[0].after ?? '{}');
    expect(after).toMatchObject({ balanceBefore: -250, balanceReclaimed: -250, vouchersBefore: 0, vouchersReclaimed: 0 });
  });

  it('有阻断时 409 blocked：本仓零改动、不扣钱', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, 800, 0);
    fx.sqlite.prepare("INSERT INTO listings (id, player_id, seller_club_id, status) VALUES (1, 1, 20, 'listed')").run();
    const res = await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队(CPU)' }, fx.env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; blockers: { key: string }[] };
    expect(body.error).toBe('blocked');
    expect(body.blockers.map((b) => b.key)).toEqual(['listing']);
    expect(sqlGet<{ is_cpu: number }>(fx.sqlite, 'SELECT is_cpu FROM clubs WHERE id = 20')?.is_cpu).toBe(0);
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 20')?.balance).toBe(800);
  });

  it('撞 clubs.name UNIQUE 回 409 name_taken（整批回滚）', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    seedFunds(fx, 20, 100, 0);
    seedClub(fx, 30, '待转队(CPU)');
    const res = await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队(CPU)' }, fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('name_taken');
    expect(sqlGet<{ name: string; is_cpu: number }>(fx.sqlite, 'SELECT name, is_cpu FROM clubs WHERE id = 20')).toEqual({
      name: '待转队',
      is_cpu: 0,
    });
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = 20')?.balance).toBe(100);
  });

  it('重放 changed=false：已转换且同名时零写入、不重复审计', async () => {
    const fx = freshEnv();
    seedClub(fx, 50, '重放队(CPU)', 1, 0);
    seedFunds(fx, 50, 0, 0);
    const res = await post('/api/admin/clubs/50/to-cpu/rename-local', { name: '重放队(CPU)' }, fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as CpuDetachRenameLocalResult).toEqual({
      ok: true,
      changed: false,
      flipped: false,
      name: '重放队(CPU)',
    });
    expect(audits(fx, 'club_cpu_detach_local')).toHaveLength(0);
  });

  it('修复场景：已是 CPU 只改名不重复回收（flipped=false），同样受阻断约束', async () => {
    const fx = freshEnv();
    seedClub(fx, 40, '修复队CPU', 1, 0);
    seedFunds(fx, 40, 500, 2);
    const res = await post('/api/admin/clubs/40/to-cpu/rename-local', { name: '修复队(CPU)' }, fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as CpuDetachRenameLocalResult).toEqual({
      ok: true,
      changed: true,
      flipped: false,
      name: '修复队(CPU)',
    });
    expect(sqlGet<{ balance: number; vouchers: number }>(fx.sqlite, 'SELECT balance, vouchers FROM ledger_accounts WHERE club_id = 40')).toEqual({
      balance: 500,
      vouchers: 2,
    });
    const rows = audits(fx, 'club_cpu_detach_local');
    expect(JSON.parse(rows[0].after ?? '{}')).toMatchObject({ repair: true, isCpu: true });

    fx.sqlite.prepare("INSERT INTO negotiation_sessions (id, club_id, status) VALUES (1, 40, 'active')").run();
    const blocked = await post('/api/admin/clubs/40/to-cpu/rename-local', { name: '整队(CPU)' }, fx.env);
    expect(blocked.status).toBe(409);
  });

  it('名字不带(CPU) 后缀直接 400', async () => {
    const fx = freshEnv();
    seedClub(fx, 20, '待转队');
    expect((await post('/api/admin/clubs/20/to-cpu/rename-local', { name: '待转队' }, fx.env)).status).toBe(400);
  });
});

describe('POST /clubs/:id/to-cpu/unbind-all', () => {
  function seedBinding(auth: DatabaseSync, accountId: number): void {
    auth.exec(
      `INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (${accountId}, 1, 'code', '2026-01-03T00:00:00Z');`,
    );
  }

  it('0 个绑定：ok 且三数组为空', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮(CPU)', 1);
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    const res = await post('/api/admin/clubs/10/to-cpu/unbind-all', {}, fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as CpuDetachUnbindResult).toEqual({ ok: true, unbound: [], alreadyUnbound: [], failed: [] });
  });

  it('还没置 CPU 时拒绝解绑（必须先完成第③步）', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮');
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    seedBinding(auth, 2);
    const res = await post('/api/admin/clubs/10/to-cpu/unbind-all', {}, fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('还不是 CPU 队');
    expect(sqlGet<{ n: number }>(auth, 'SELECT COUNT(*) AS n FROM team_binding')?.n).toBe(1);
  });

  it('1 个绑定：解绑成功并写 club_cpu_detach_unbind 审计', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮(CPU)', 1);
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    seedBinding(auth, 2);
    const res = await post('/api/admin/clubs/10/to-cpu/unbind-all', {}, fx.env);
    expect((await res.json()) as CpuDetachUnbindResult).toEqual({ ok: true, unbound: [2], alreadyUnbound: [], failed: [] });
    expect(sqlGet<{ n: number }>(auth, 'SELECT COUNT(*) AS n FROM team_binding')?.n).toBe(0);
    const rows = audits(fx, 'club_cpu_detach_unbind');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].before ?? '{}')).toEqual({ userId: 2 });
  });

  it('2 个绑定：全部解绑（按账号序）', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮(CPU)', 1);
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    seedBinding(auth, 3);
    seedBinding(auth, 2);
    const res = await post('/api/admin/clubs/10/to-cpu/unbind-all', {}, fx.env);
    expect((await res.json()) as CpuDetachUnbindResult).toEqual({ ok: true, unbound: [2, 3], alreadyUnbound: [], failed: [] });
    expect(audits(fx, 'club_cpu_detach_unbind')).toHaveLength(2);
  });

  it('部分失败不回滚：成功/已解绑/失败分组，ok=false 可重试', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮(CPU)', 1);
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    seedBinding(auth, 2);
    seedBinding(auth, 3);
    seedBinding(auth, 4);
    stubUnbindFetch(auth, [3], [4]);
    const res = await post('/api/admin/clubs/10/to-cpu/unbind-all', {}, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CpuDetachUnbindResult;
    expect(body.ok).toBe(false);
    expect(body.unbound).toEqual([2]);
    expect(body.alreadyUnbound).toEqual([4]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]).toMatchObject({ userId: 3, code: 'internal' });
    // 成功的那个已落库、失败的仍在（重试还会再试一次）
    expect(sqlGet<{ n: number }>(auth, 'SELECT COUNT(*) AS n FROM team_binding WHERE account_id = 2')?.n).toBe(0);
    expect(sqlGet<{ n: number }>(auth, 'SELECT COUNT(*) AS n FROM team_binding WHERE account_id = 3')?.n).toBe(1);
    expect(audits(fx, 'club_cpu_detach_unbind')).toHaveLength(1);
  });

  it('权限走 club.bindings.unbind（教练 403/401）', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮');
    const res = await post('/api/admin/clubs/10/to-cpu/unbind-all', {}, fx.env, 'tok-coach');
    expect([401, 403]).toContain(res.status);
  });
});

describe('GET /clubs/:id/to-cpu 复核（转换后）', () => {
  it('六项全通过 → ready=true', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮(CPU)', 1);
    seedFunds(fx, 10, 0, 0);
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    const body = (await (await get('/api/admin/clubs/10/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.checks).toEqual({ isCpu: true, tourName: true, localName: true, bindings: true, codes: true, funds: true });
    expect(body.balance).toBe(0);
    expect(body.vouchers).toBe(0);
    expect(body.blockers).toEqual([]);
    expect(body.ready).toBe(true);
  });

  it('还有绑定 / 本仓名没后缀 → 对应 check 为 false、ready=false', async () => {
    const fx = freshEnv();
    seedClub(fx, 10, '蓝月亮', 1);
    seedFunds(fx, 10, 50, 1);
    const auth = attachAuthChannel(fx.env);
    auth.prepare("INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 10, 10, '蓝月亮(CPU)', '2026-01-01T00:00:00Z')").run();
    auth.exec("INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (2, 1, 'code', '2026-01-03T00:00:00Z')");
    const body = (await (await get('/api/admin/clubs/10/to-cpu', fx.env)).json()) as CpuDetachState;
    expect(body.checks.localName).toBe(false);
    expect(body.checks.bindings).toBe(false);
    expect(body.checks.funds).toBe(false);
    expect(body.balance).toBe(50);
    expect(body.vouchers).toBe(1);
    expect(body.ready).toBe(false);
  });
});
