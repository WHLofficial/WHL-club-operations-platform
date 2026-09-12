// 路由层测试（§16：内存 D1 跑迁移与断言）——绑定流程、球员查询、导入幂等、期初余额、注册合规。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll } from './d1.ts';
import { TRAINEE_WAGE } from '../src/core/squad-rules.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache(); // config 服务是 module 级缓存，跨用例必须清场
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '丙丙', 'user', 0, 0),
       (4, '教练丁', 'coach', 1, 0),
       (5, '教练戊', 'coach', 0, 0);`,
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
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-viewer'],
    [4, 'tok-locked'],
    [5, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(
    path,
    { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} },
    env,
  );
}

function post(path: string, body: unknown, token: string | undefined, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

function patch(path: string, body: unknown, token: string | undefined, env: Env) {
  return app.request(
    path,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function createClub(fx: Fixture, name: string, leagueTier = 'premier'): Promise<number> {
  const res = await post('/api/admin/clubs', { name, leagueTier }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { club: { id: number } };
  return body.club.id;
}

async function issueCode(fx: Fixture, clubId: number): Promise<string> {
  const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { code: string };
  return body.code;
}

describe('建队与认证码绑定（§3.2）', () => {
  it('管理组建俱乐部，重名被拒', async () => {
    const fx = freshEnv();
    const res = await post('/api/admin/clubs', { name: '阿森纳', leagueTier: 'premier' }, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const dup = await post('/api/admin/clubs', { name: '阿森纳', leagueTier: 'second' }, 'tok-admin', fx.env);
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe('俱乐部名字已存在');
  });

  it('绑队走通：建队→发码→绑定→概览，明码只出现一次', async () => {
    const fx = freshEnv();
    const clubId = await createClub(fx, '阿森纳');
    // 绑定前概览为空
    const empty = await get('/api/me/club', 'tok-coach', fx.env);
    expect(((await empty.json()) as { club: null }).club).toBeNull();

    const code = await issueCode(fx, clubId);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);

    const bind = await post('/api/clubs/bind', { code }, 'tok-coach', fx.env);
    expect(bind.status).toBe(201);
    expect(((await bind.json()) as { clubId: number }).clubId).toBe(clubId);

    // 同码二次使用被拒（一次性，换账号也一样）
    const reuse = await post('/api/clubs/bind', { code }, 'tok-coach2', fx.env);
    expect(reuse.status).toBe(400);

    const overview = await get('/api/me/club', 'tok-coach', fx.env);
    const body = (await overview.json()) as { club: { id: number; name: string }; balance: number; squadCount: number; window: null };
    expect(body.club).toMatchObject({ id: clubId, name: '阿森纳' });
    expect(body.balance).toBe(0);
    expect(body.squadCount).toBe(0);
    expect(body.window).toBeNull();
  });

  it('一账号一队：已绑定的账号再绑被拒且不烧码', async () => {
    const fx = freshEnv();
    const c1 = await createClub(fx, '阿森纳');
    const c2 = await createClub(fx, '曼城');
    const code1 = await issueCode(fx, c1);
    expect((await post('/api/clubs/bind', { code: code1 }, 'tok-coach', fx.env)).status).toBe(201);
    const code2 = await issueCode(fx, c2);
    const again = await post('/api/clubs/bind', { code: code2 }, 'tok-coach', fx.env);
    expect(again.status).toBe(409);
    // 码没被烧掉：换账号仍能用
    expect((await post('/api/clubs/bind', { code: code2 }, 'tok-coach2', fx.env)).status).toBe(201);
  });

  it('格式错误与无效码', async () => {
    const fx = freshEnv();
    expect((await post('/api/clubs/bind', { code: 'ABC' }, 'tok-coach', fx.env)).status).toBe(400);
    expect((await post('/api/clubs/bind', { code: 'ZZZZZZZZ' }, 'tok-coach', fx.env)).status).toBe(400);
  });

  it('观众号（locked=1 映射 viewer）不能绑队', async () => {
    const fx = freshEnv();
    const clubId = await createClub(fx, '阿森纳');
    const code = await issueCode(fx, clubId);
    const res = await post('/api/clubs/bind', { code }, 'tok-locked', fx.env);
    expect(res.status).toBe(403);
    // 码未被消耗
    expect((await post('/api/clubs/bind', { code }, 'tok-coach', fx.env)).status).toBe(201);
  });

  it('连续失败触发限流（5 次/10 分钟）', async () => {
    const fx = freshEnv();
    for (let i = 0; i < 5; i++) {
      await post('/api/clubs/bind', { code: 'WRONGWRG' }, 'tok-coach', fx.env);
    }
    const res = await post('/api/clubs/bind', { code: 'WRONGWRG' }, 'tok-coach', fx.env);
    expect(res.status).toBe(429);
  });

  it('管理端解绑后可重绑', async () => {
    const fx = freshEnv();
    const clubId = await createClub(fx, '阿森纳');
    const code = await issueCode(fx, clubId);
    await post('/api/clubs/bind', { code }, 'tok-coach', fx.env);
    const unbind = await post('/api/admin/bindings/unbind', { userId: 2 }, 'tok-admin', fx.env);
    expect(unbind.status).toBe(200);
    const code2 = await issueCode(fx, clubId);
    expect((await post('/api/clubs/bind', { code: code2 }, 'tok-coach', fx.env)).status).toBe(201);
    const audit = sqlAll<{ action: string }>(
      fx.sqlite,
      "SELECT action FROM audit_log WHERE action IN ('club_bind','club_unbind') ORDER BY id",
    );
    expect(audit.map((r) => r.action)).toEqual(['club_bind', 'club_unbind', 'club_bind']);
  });

  it('管理端俱乐部列表带绑定状态与人名', async () => {
    const fx = freshEnv();
    const clubId = await createClub(fx, '阿森纳');
    const code = await issueCode(fx, clubId);
    await post('/api/clubs/bind', { code }, 'tok-coach', fx.env);
    const res = await get('/api/admin/clubs', 'tok-admin', fx.env);
    const body = (await res.json()) as { clubs: { id: number; binding: { userId: number; userName: string | null } | null; latestCode: { usedBy: number | null } | null }[] };
    const club = body.clubs.find((c) => c.id === clubId)!;
    expect(club.binding).toMatchObject({ userId: 2, userName: '教练乙' });
    expect(club.latestCode?.usedBy).toBe(2);
  });
});

describe('球员查询（附录 A〔1〕）', () => {
  async function seedPlayers(fx: Fixture) {
    fx.sqlite
      .exec(
        "INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '曼城', 'premier', 'active')",
      );
    const stmt = fx.sqlite.prepare(
      "INSERT INTO players (uid, name, club_id, position, ca, pa, fc_id, status, market_value) VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', ?)",
    );
    stmt.run('fc1', '球员一', 1, 'ST', 88, 92, 1, 12.5);
    stmt.run('fc2', '球员二', 1, 'GK', 84, 86, 2, null);
    stmt.run('fc3', '球员三', 2, 'CB', 75, 80, 3, null);
  }

  it('公开列表：过滤、分页游标', async () => {
    const fx = freshEnv();
    seedPlayers(fx);
    const res = await get('/api/players?club_id=1&limit=1', undefined, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { players: { id: number; name: string }[]; nextCursor: number | null };
    expect(body.players).toHaveLength(1);
    expect(body.players[0].name).toBe('球员一');
    expect(body.nextCursor).toBe(body.players[0].id);
    const page2 = await get(`/api/players?club_id=1&limit=1&cursor=${body.nextCursor}`, undefined, fx.env);
    const body2 = (await page2.json()) as { players: { name: string }[]; nextCursor: number | null };
    expect(body2.players[0].name).toBe('球员二');
    expect(body2.nextCursor).toBeNull();
  });

  it('档案卡：球员 + 俱乐部 + 合同，game_attrs 解析', async () => {
    const fx = freshEnv();
    seedPlayers(fx);
    fx.sqlite
      .prepare(
        "INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, is_active) VALUES (1, 1, 50, 2.4, 'formal', 'import', 1)",
      )
      .run();
    fx.sqlite
      .prepare("UPDATE players SET game_attrs = ? WHERE id = 1")
      .run(JSON.stringify({ ID: 1, naID: 155, PSID1: 1, finishing: 88 }));
    const res = await get('/api/players/1', undefined, fx.env);
    const body = (await res.json()) as {
      player: { name: string; chinaPlan: boolean; gameAttrs: Record<string, unknown> };
      club: { name: string } | null;
      contract: { releaseFee: number; source: string } | null;
    };
    expect(body.player.name).toBe('球员一');
    expect(body.player.chinaPlan).toBe(false);
    expect(body.player.gameAttrs).toMatchObject({ naID: 155, finishing: 88 });
    expect(body.club).toMatchObject({ name: '阿森纳' });
    expect(body.contract).toMatchObject({ releaseFee: 50, source: 'import' });
  });

  it('不存在的球员 404', async () => {
    const fx = freshEnv();
    expect((await get('/api/players/999', undefined, fx.env)).status).toBe(404);
  });

  it('status 过滤与非法值拒绝', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(
      "INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active')",
    );
    const stmt = fx.sqlite.prepare(
      "INSERT INTO players (uid, name, club_id, ca, pa, fc_id, status) VALUES (?, ?, 1, 80, 85, ?, ?)",
    );
    stmt.run('fc1', '甲', 1, 'normal');
    stmt.run('fc2', '乙', 2, 'trainee');
    const res = await get('/api/players?status=trainee', undefined, fx.env);
    const body = (await res.json()) as { players: { name: string }[] };
    expect(body.players.map((p) => p.name)).toEqual(['乙']);
    expect((await get('/api/players?status=oops', undefined, fx.env)).status).toBe(400);
  });
});

describe('球员管理 PATCH（审计留痕）', () => {
  async function seedOne(fx: Fixture) {
    fx.sqlite
      .prepare("INSERT INTO players (uid, name, ca, pa, fc_id) VALUES ('fc1', '球员一', 80, 90, 1)")
      .run();
  }

  it('改身价与状态，before/after 进审计', async () => {
    const fx = freshEnv();
    await seedOne(fx);
    const res = await patch('/api/admin/players/1', { marketValue: 30.5, status: 'trainee' }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const row = sqlGet<{ market_value: number; status: string }>(fx.sqlite, 'SELECT market_value, status FROM players WHERE id = 1');
    expect(row).toMatchObject({ market_value: 30.5, status: 'trainee' });
    const audit = sqlGet<{ before: string; after: string }>(
      fx.sqlite,
      "SELECT before, after FROM audit_log WHERE action = 'player_patch'",
    );
    expect(JSON.parse(audit!.before)).toEqual({ market_value: null, status: 'normal' });
    expect(JSON.parse(audit!.after)).toEqual({ market_value: 30.5, status: 'trainee' });
  });

  it('越界值与未知字段被拒', async () => {
    const fx = freshEnv();
    await seedOne(fx);
    expect((await patch('/api/admin/players/1', { growthTier: 9 }, 'tok-admin', fx.env)).status).toBe(400);
    expect((await patch('/api/admin/players/1', { badgesSilver: 16 }, 'tok-admin', fx.env)).status).toBe(400);
    expect((await patch('/api/admin/players/1', { hack: 1 }, 'tok-admin', fx.env)).status).toBe(400);
    expect((await patch('/api/admin/players/1', {}, 'tok-admin', fx.env)).status).toBe(400);
  });

  it('教练不能改球员', async () => {
    const fx = freshEnv();
    await seedOne(fx);
    expect((await patch('/api/admin/players/1', { marketValue: 1 }, 'tok-coach', fx.env)).status).toBe(403);
  });
});

// 通道 A 样例行（对照 FC26db Base 真实表头）
function channelARow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: 277225,
    Name: 'Jon Martín',
    FootID: 1,
    Age: 19,
    CA: 76,
    PA: 84,
    height: 185,
    weight: 83,
    skillmoves: 2,
    weakfoot: 3,
    hashighqualityhead: 0,
    internationalrep: 2,
    TeamID: 1,
    naID: 45,
    PosID1: 5,
    PosID2: null,
    PosID3: null,
    PosID4: null,
    RoleID1: 141,
    RoleID2: null,
    RoleID3: null,
    RoleID4: null,
    RoleID5: null,
    PSID1: 1,
    PSID2: null,
    PSID3: null,
    NumofPS: 1,
    finishing: 74,
    gkreflexes: 12,
    ...overrides,
  };
}

describe('导入管线（§5.4）', () => {
  it('预览：归一化统计与错误明细', async () => {
    const fx = freshEnv();
    const rows = [
      channelARow(),
      channelARow({ ID: 277226, Name: 'China Player', naID: 155, FootID: 2, PosID1: 0 }),
      channelARow({ ID: 277227, CA: 120 }), // 越界
    ];
    const res = await post('/api/admin/players/import/preview', { channel: 'A', rows }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: { total: number; valid: number; error: number; insertEstimate: number };
      errors: { row: number; field: string }[];
      samples: { chinaPlan: boolean; foot: number; position: string | null }[];
    };
    expect(body.stats).toMatchObject({ total: 3, valid: 2, error: 1, insertEstimate: 2 });
    expect(body.errors[0]).toMatchObject({ row: 3, field: 'CA' });
    expect(body.samples[1]).toMatchObject({ chinaPlan: true, foot: 0, position: 'GK' });
  });

  it('确认落库 → 运营列不被覆盖 → 重跑幂等', async () => {
    const fx = freshEnv();
    const rows = [channelARow(), channelARow({ ID: 277226, Name: 'China Player', naID: 155, FootID: 2, PosID1: 0 })];
    const first = await post(
      '/api/admin/players/import/confirm',
      { channel: 'A', rows, futureStarIds: [277225] },
      'tok-admin',
      fx.env,
    );
    expect(first.status).toBe(200);
    expect(((await first.json()) as { written: number }).written).toBe(2);

    const p1 = sqlGet<{
      uid: string;
      ca: number;
      is_future_star: number;
      china_plan: number;
      status: string;
      club_id: number | null;
      game_attrs: string;
    }>(fx.sqlite, 'SELECT uid, ca, is_future_star, china_plan, status, club_id, game_attrs FROM players WHERE fc_id = 277225');
    expect(p1).toMatchObject({ uid: 'fc277225', ca: 76, is_future_star: 1, china_plan: 0, status: 'normal', club_id: null });
    expect(JSON.parse(p1!.game_attrs)).toMatchObject({ PosID1: 5, finishing: 74 });
    expect(JSON.parse(p1!.game_attrs)).not.toHaveProperty('Name');
    expect(JSON.parse(p1!.game_attrs)).not.toHaveProperty('FootID');

    // 运营列赋值后重导：FC 源列更新，运营列原样
    fx.sqlite
      .prepare("UPDATE players SET market_value = 55, status = 'listed', badges_gold = 2, growth_tier = 3 WHERE fc_id = 277225")
      .run();
    const second = await post(
      '/api/admin/players/import/confirm',
      { channel: 'A', rows: [channelARow({ CA: 78 })] },
      'tok-admin',
      fx.env,
    );
    expect(second.status).toBe(200);
    expect(((await second.json()) as { updatedEstimate: number }).updatedEstimate).toBe(1);
    const p2 = sqlGet<{ ca: number; market_value: number; status: string; badges_gold: number; growth_tier: number }>(
      fx.sqlite,
      'SELECT ca, market_value, status, badges_gold, growth_tier FROM players WHERE fc_id = 277225',
    );
    expect(p2).toMatchObject({ ca: 78, market_value: 55, status: 'listed', badges_gold: 2, growth_tier: 3 });
  });

  it('通道 B：队壳名单归一化（姓名/出生日期/惯用脚/位置文本）', async () => {
    const fx = freshEnv();
    const year = new Date().getUTCFullYear();
    const rows = [
      {
        playerid: 300001,
        firstname: 'Jon',
        lastname: 'Martín',
        commonname: '',
        Position: 'CB',
        Position2: 'None',
        teamid: 1,
        overallrating: 76,
        potential: 84,
        birthdate: '01/01/2000',
        nationality: 155,
        preferredfoot: 'Left',
        role1: 'CB Stopper +',
        Playstyles: 'Aerial Fortress',
        finishing: 21,
      },
    ];
    const res = await post('/api/admin/players/import/preview', { channel: 'B', rows }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { samples: { name: string; age: number; foot: number; position: string; chinaPlan: boolean }[] };
    expect(body.samples[0]).toMatchObject({ name: 'Jon Martín', foot: 0, position: 'CB', chinaPlan: true });
    expect(body.samples[0].age).toBe(year - 2000);
  });

  it('缺必需列整批拒绝；带错确认 422', async () => {
    const fx = freshEnv();
    const res = await post(
      '/api/admin/players/import/preview',
      { channel: 'A', rows: [{ ID: 1, Name: 'x' }] },
      'tok-admin',
      fx.env,
    );
    expect(res.status).toBe(400);
    const bad = await post(
      '/api/admin/players/import/confirm',
      { channel: 'A', rows: [channelARow({ CA: 0 })] },
      'tok-admin',
      fx.env,
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe('import_invalid');
  });

  it('每批次写审计（批次号/通道/统计）', async () => {
    const fx = freshEnv();
    const rows = Array.from({ length: 250 }, (_, i) => channelARow({ ID: 900000 + i, Name: `球员${i}` }));
    const res = await post('/api/admin/players/import/confirm', { channel: 'A', rows }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const audits = sqlAll<{ after: string }>(
      fx.sqlite,
      "SELECT after FROM audit_log WHERE action = 'players_import' ORDER BY id",
    );
    expect(audits).toHaveLength(2); // 200 + 50
    const second = JSON.parse(audits[1].after) as { batchNo: number; rows: number };
    expect(second).toMatchObject({ batchNo: 2, rows: 50 });
  });
});

describe('期初余额导入（§14.1）', () => {
  it('写入账户与 opening_import 流水 + 审计；重跑跳过已导入', async () => {
    const fx = freshEnv();
    const clubId = await createClub(fx, '阿森纳');
    const res = await post('/api/admin/ledger/opening-import', { rows: [{ clubId, balance: 120.5 }] }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { written: number }).toMatchObject({ written: 1 });
    const account = sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', clubId);
    expect(account?.balance).toBe(120.5);
    const entry = sqlGet<{ amount: number; balance_after: number; memo: string }>(
      fx.sqlite,
      "SELECT amount, balance_after, memo FROM ledger_entries WHERE club_id = ? AND kind = 'opening_import'",
      clubId,
    );
    expect(entry).toMatchObject({ amount: 120.5, balance_after: 120.5 });
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ledger_opening_import'")!.n,
    ).toBe(1);

    const rerun = await post('/api/admin/ledger/opening-import', { rows: [{ clubId, balance: 999 }] }, 'tok-admin', fx.env);
    expect(((await rerun.json()) as { written: number; skipped: number })).toMatchObject({ written: 0, skipped: 1 });
    expect(sqlGet<{ balance: number }>(fx.sqlite, 'SELECT balance FROM ledger_accounts WHERE club_id = ?', clubId)!.balance).toBe(120.5);
  });

  it('俱乐部不存在 / 同批重复 / 负数被拒', async () => {
    const fx = freshEnv();
    expect(
      (await post('/api/admin/ledger/opening-import', { rows: [{ clubId: 999, balance: 1 }] }, 'tok-admin', fx.env)).status,
    ).toBe(400);
    const clubId = await createClub(fx, '阿森纳');
    expect(
      (
        await post(
          '/api/admin/ledger/opening-import',
          { rows: [{ clubId, balance: 1 }, { clubId, balance: 2 }] },
          'tok-admin',
          fx.env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await post('/api/admin/ledger/opening-import', { rows: [{ clubId, balance: -1 }] }, 'tok-admin', fx.env)).status,
    ).toBe(400);
  });
});

describe('config 管理端点（§13）', () => {
  it('涉密键掩码、非管理组 403', async () => {
    const fx = freshEnv();
    const res = await get('/api/admin/config', 'tok-admin', fx.env);
    const body = (await res.json()) as { config: { key: string; value: string | null; secret: boolean }[] };
    const slope = body.config.find((r) => r.key === 'sigmoid_slope')!;
    expect(slope.secret).toBe(true);
    expect(slope.value).not.toBe('-9');
    const coach = await get('/api/admin/config', 'tok-coach', fx.env);
    expect(coach.status).toBe(403);
  });
});

/* ---------- 增量 2：通道 C 合同导入 ---------- */

describe('通道 C · 名单合同模板导入（§5.4）', () => {
  async function seedContractWorld(fx: Fixture) {
    fx.sqlite.exec(
      "INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active'), (2, '曼城', 'premier', 'active')",
    );
    const stmt = fx.sqlite.prepare(
      "INSERT INTO players (uid, name, club_id, position, ca, pa, fc_id) VALUES (?, ?, ?, 'CM', 80, 85, ?)",
    );
    stmt.run('fc1', '球员一', 1, 1);
    stmt.run('fc2', '球员二', null, 2);
    stmt.run('fc3', '球员三', 2, 3);
  }

  it('预览分类：create/claim/归属冲突/无球员/训练营工资', async () => {
    const fx = freshEnv();
    await seedContractWorld(fx);
    const rows = [
      { uid: 'fc1', releaseFee: 40, wage: 2, effectiveFrom: '2026-07-01', contractType: 'formal' },
      { uid: 'fc2', releaseFee: 30, wage: 1.5, effectiveFrom: '2026-07-01', contractType: 'formal' },
      { uid: 'fc3', releaseFee: 30, wage: 1.5, effectiveFrom: '2026-07-01', contractType: 'formal' },
      { uid: 'fc999', releaseFee: 30, wage: 1.5, effectiveFrom: '2026-07-01', contractType: 'formal' },
      { uid: 'fc4', releaseFee: 30, wage: 2, effectiveFrom: '2026-07-01', contractType: 'trainee' },
    ];
    const res = await post('/api/admin/players/import/preview', { channel: 'C', clubId: 1, rows }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      channel: string;
      stats: { total: number; valid: number; error: number; insertEstimate: number };
      errors: { row: number; message: string }[];
      samples: { playerName: string; outcome: string }[];
    };
    expect(body.channel).toBe('C');
    expect(body.stats).toMatchObject({ total: 5, valid: 2, error: 3, insertEstimate: 2 });
    expect(body.errors.map((e) => e.message)).toEqual([
      '球员「球员三」已归属 曼城',
      'uid 没有对应的球员（先跑球员导入）：fc999',
      '训练营合同工资固定为 0.75 m/半赛季',
    ]);
    expect(body.samples.map((s) => s.outcome)).toEqual(['create', 'claim']);
  });

  it('确认落库：合同写入 + 无归属认领 + 审计；重跑幂等', async () => {
    const fx = freshEnv();
    await seedContractWorld(fx);
    const rows = [
      { uid: 'fc1', releaseFee: 40, wage: 2, effectiveFrom: '2026-07-01', contractType: 'formal' },
      { uid: 'fc2', releaseFee: 30, wage: 1.5, effectiveFrom: '2026-07-01', contractType: 'formal' },
    ];
    const res = await post('/api/admin/players/import/confirm', { channel: 'C', clubId: 1, rows }, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { written: number; insertedEstimate: number }).toMatchObject({ written: 2, insertedEstimate: 2 });

    const claimed = sqlGet<{ club_id: number | null }>(fx.sqlite, 'SELECT club_id FROM players WHERE fc_id = 2');
    expect(claimed?.club_id).toBe(1);
    const contracts = sqlAll<{ player_id: number; release_fee: number; source: string; is_active: number }>(
      fx.sqlite,
      'SELECT player_id, release_fee, source, is_active FROM contracts ORDER BY player_id',
    );
    expect(contracts).toHaveLength(2);
    expect(contracts[1]).toMatchObject({ player_id: 2, release_fee: 30, source: 'import', is_active: 1 });
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'contracts_import'")!.n,
    ).toBe(1);

    const rerun = await post('/api/admin/players/import/confirm', { channel: 'C', clubId: 1, rows }, 'tok-admin', fx.env);
    expect((await rerun.json()) as { updatedEstimate: number }).toMatchObject({ updatedEstimate: 2 });
    expect(sqlAll(fx.sqlite, 'SELECT id FROM contracts').length).toBe(2); // UNIQUE(player_id)，无重复行
  });

  it('带错确认 422；归属冲突的球员不会被改队', async () => {
    const fx = freshEnv();
    await seedContractWorld(fx);
    const bad = await post(
      '/api/admin/players/import/confirm',
      { channel: 'C', clubId: 1, rows: [{ uid: 'fc3', releaseFee: 30, wage: 1.5, effectiveFrom: '2026-07-01', contractType: 'formal' }] },
      'tok-admin',
      fx.env,
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe('contract_import_invalid');
    expect(sqlGet<{ club_id: number }>(fx.sqlite, 'SELECT club_id FROM players WHERE fc_id = 3')?.club_id).toBe(2);
    expect(
      (await post('/api/admin/players/import/confirm', { channel: 'C', clubId: 1, rows: [] }, 'tok-admin', fx.env)).status,
    ).toBe(400);
    expect(
      (await post('/api/admin/players/import/confirm', { channel: 'C', clubId: 1, rows: [{ uid: 'fc1' }] }, 'tok-coach', fx.env))
        .status,
    ).toBe(403);
  });
});

/* ---------- 增量 2：阵容注册与合规（规则 4.2） ---------- */

function regBody(firstTeam: number[], trainee: number[]) {
  return { firstTeam, trainee };
}

// 一支默认合规的顶级联赛球队：一线 20 人（1 号是门将）、训练营 3 人，全员有合同
async function seedRegistrationWorld(fx: Fixture, seasonStatus = 'preparing') {
  fx.sqlite.exec("INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active')");
  fx.sqlite.prepare('INSERT INTO seasons (season, status) VALUES (1, ?)').run(seasonStatus);
  const player = fx.sqlite.prepare(
    "INSERT INTO players (id, uid, name, club_id, position, ca, pa, growable, status, fc_id) VALUES (?, ?, ?, 1, ?, ?, ?, 1, 'normal', ?)",
  );
  const contract = fx.sqlite.prepare(
    "INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES (?, 1, 50, ?, ?, 'import', '2026-07-01', 1)",
  );
  for (let i = 1; i <= 20; i++) {
    player.run(i, `fc${i}`, `一线${i}`, i === 1 ? 'GK' : 'CM', 80, 85, i);
    contract.run(i, 1, 'formal');
  }
  for (let i = 101; i <= 103; i++) {
    player.run(i, `fc${i}`, `青训${i - 100}`, 'CM', 60, 75, i);
    contract.run(i, TRAINEE_WAGE, 'trainee');
  }
  fx.sqlite.exec("INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00Z')");
}

const FULL_FIRST = Array.from({ length: 20 }, (_, i) => i + 1);
const FULL_TRAINEE = [101, 102, 103];

describe('注册名单提交与校验（附录 A〔2〕）', () => {
  it('合规名单提交成功：快照/状态/审计齐全，重复提交替换快照', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    const res = await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { season: number; firstTeam: number; trainee: number; wageTotal: number }).toMatchObject({
      ok: true,
      season: 1,
      firstTeam: 20,
      trainee: 3,
      wageTotal: 20 + 3 * TRAINEE_WAGE,
    });

    const squads = sqlAll<{ player_id: number; squad: string }>(
      fx.sqlite,
      'SELECT player_id, squad FROM registrations ORDER BY player_id',
    );
    expect(squads.filter((r) => r.squad === 'first_team')).toHaveLength(20);
    expect(squads.filter((r) => r.squad === 'trainee').map((r) => r.player_id)).toEqual(FULL_TRAINEE);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 101')?.status).toBe('trainee');
    expect(
      sqlGet<{ after: string }>(fx.sqlite, "SELECT after FROM audit_log WHERE action = 'registration_submit'")!.after,
    ).toContain('"season":1');

    // 重提交：101 转一线队，102/103 移出 → 状态回 normal；快照整体替换无重复
    const again = await post('/api/club/registrations', regBody([...FULL_FIRST, 101], []), 'tok-coach', fx.env);
    expect(again.status).toBe(200);
    const statuses = sqlAll<{ id: number; status: string }>(
      fx.sqlite,
      'SELECT id, status FROM players WHERE id IN (101, 102, 103) ORDER BY id',
    );
    expect(statuses).toEqual([
      { id: 101, status: 'normal' },
      { id: 102, status: 'normal' },
      { id: 103, status: 'normal' },
    ]);
    expect(sqlAll(fx.sqlite, 'SELECT player_id FROM registrations').length).toBe(21);
    expect(sqlAll(fx.sqlite, "SELECT id FROM audit_log WHERE action = 'registration_submit'").length).toBe(2);
  });

  it('三种违规名单各被拒且报错可读，快照不落库', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);

    // 违规一：人数不足（19 人）
    const few = await post('/api/club/registrations', regBody(FULL_FIRST.slice(1), FULL_TRAINEE), 'tok-coach', fx.env);
    expect(few.status).toBe(422);
    const fewBody = (await few.json()) as { code: string; issues: { rule: string; message: string }[] };
    expect(fewBody.code).toBe('squad_invalid');
    expect(fewBody.issues[0]).toMatchObject({ rule: 'squad_size', message: '一线队注册人数须在 20-30 人之间，当前 19 人' });

    // 违规二：没有门将（补一个非门将球员凑满 20）
    fx.sqlite
      .prepare(
        "INSERT INTO players (id, uid, name, club_id, position, ca, pa, growable, status, fc_id) VALUES (21, 'fc21', '一线21', 1, 'CM', 80, 85, 1, 'normal', 21)",
      )
      .run();
    fx.sqlite
      .prepare(
        "INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES (21, 1, 50, 1, 'formal', 'import', '2026-07-01', 1)",
      )
      .run();
    const noGk = await post('/api/club/registrations', regBody(Array.from({ length: 20 }, (_, i) => i + 2), []), 'tok-coach', fx.env);
    expect(noGk.status).toBe(422);
    expect(((await noGk.json()) as { issues: { rule: string; message: string }[] }).issues[0]).toMatchObject({
      rule: 'gk',
      message: '一线队须至少注册 1 名门将，当前 0 名',
    });

    // 违规三：CA≥90 超过 1 名
    fx.sqlite.prepare('UPDATE players SET ca = 91 WHERE id = 2').run();
    fx.sqlite.prepare('UPDATE players SET ca = 90 WHERE id = 3').run();
    const stars = await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    expect(stars.status).toBe(422);
    const starBody = (await stars.json()) as { issues: { rule: string; message: string }[] };
    expect(starBody.issues.some((i) => i.rule === 'ca_pa' && i.message.includes('CA≥90 的球员最多 1 名，当前 2 名'))).toBe(true);

    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM registrations')!.n).toBe(0);
  });

  it('训练营可成长与缺合同也会被点名', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    fx.sqlite.prepare('UPDATE players SET pa = 60 WHERE id = 103').run(); // PA−CA = 0
    fx.sqlite.prepare('DELETE FROM contracts WHERE player_id = 5').run();
    const res = await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { rule: string; message: string }[] };
    expect(body.issues.find((i) => i.rule === 'trainee_growth')?.message).toContain('青训3');
    expect(body.issues.find((i) => i.rule === 'contract')?.message).toContain('一线5');
  });

  it('工资帽配置后超限被拒（P1 占位，未配置时跳过）', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    fx.sqlite.prepare("INSERT INTO config (key, value, updated_at) VALUES ('wage_cap', '20', '2026-01-01T00:00:00Z')").run();
    const res = await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { rule: string; message: string }[] };
    expect(body.issues[0].rule).toBe('wage_cap');
    expect(body.issues[0].message).toContain('超出工资帽 20 m');
  });

  it('请求形状校验：非本队球员/退役/跨名单重复/格式', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    const foreign = await post('/api/club/registrations', regBody([1, 999], []), 'tok-coach', fx.env);
    expect((await foreign.json()) as { error: string }).toEqual({ error: '这些球员不在你的队里：999' });
    fx.sqlite.prepare("UPDATE players SET status = 'retired' WHERE id = 7").run();
    const retired = await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    expect(retired.status).toBe(400);
    expect(((await retired.json()) as { error: string }).error).toContain('退役球员不能注册');
    const overlap = await post('/api/club/registrations', regBody([1, 2], [2]), 'tok-coach', fx.env);
    expect(((await overlap.json()) as { error: string }).error).toContain('同一球员不能同时进一线队和训练营：2');
    const dupe = await post('/api/club/registrations', regBody([1, 1], []), 'tok-coach', fx.env);
    expect(((await dupe.json()) as { error: string }).error).toContain('一线队名单里出现了重复球员：1');
    expect((await post('/api/club/registrations', regBody([1, 'x'], []), 'tok-coach', fx.env)).status).toBe(400);
  });

  it('无备赛期赛季 409 no_season；赛季开跑后不能再提交', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx, 'running');
    const res = await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    expect(res.status).toBe(409);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'no_season' });
  });

  it('GET /club/squad：未绑返回空壳；绑后带名单/规则回显/快照体检', async () => {
    const fxE = freshEnv();
    expect(((await (await get('/api/club/squad', 'tok-coach2', fxE.env)).json()) as { club: null }).club).toBeNull();

    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    const empty = (await (await get('/api/club/squad', 'tok-coach', fx.env)).json()) as {
      season: number;
      players: unknown[];
      registration: null;
      compliance: null;
      rules: { squadMin: number; wageCap: number | null };
    };
    expect(empty.season).toBe(1);
    expect(empty.players).toHaveLength(23);
    expect(empty.registration).toBeNull();
    expect(empty.compliance).toBeNull();
    expect(empty.rules).toMatchObject({ squadMin: 20, wageCap: null });

    await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    const filled = (await (await get('/api/club/squad', 'tok-coach', fx.env)).json()) as {
      registration: { firstTeam: number[]; trainee: number[] };
      compliance: { pass: boolean };
      players: { id: number; squad: string | null; wage: number | null; contractType: string | null }[];
    };
    expect(filled.registration?.firstTeam).toHaveLength(20);
    expect(filled.compliance?.pass).toBe(true);
    const p1 = filled.players.find((p) => p.id === 1)!;
    expect(p1).toMatchObject({ squad: 'first_team', wage: 1, contractType: 'formal' });
  });

  it('观众号不能提交注册', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    expect((await post('/api/club/registrations', regBody(FULL_FIRST, []), 'tok-viewer', fx.env)).status).toBe(403);
  });
});

describe('注册快照与准入体检（管理端）', () => {
  it('快照按俱乐部分组；缺省取最新赛季；教练 403', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    const res = await get('/api/admin/registrations', 'tok-admin', fx.env);
    const body = (await res.json()) as {
      season: number | null;
      clubs: { clubId: number; clubName: string; firstTeam: number; trainee: number; wageTotal: number; players: { playerId: number; squad: string }[] }[];
    };
    expect(body.season).toBe(1);
    expect(body.clubs).toHaveLength(1);
    expect(body.clubs[0]).toMatchObject({
      clubId: 1,
      clubName: '阿森纳',
      firstTeam: 20,
      trainee: 3,
      wageTotal: 20 + 3 * TRAINEE_WAGE,
    });
    expect((await get('/api/admin/registrations', 'tok-coach', fx.env)).status).toBe(403);
    const empty = (await (await get('/api/admin/registrations?season=9', 'tok-admin', fx.env)).json()) as {
      season: number;
      clubs: unknown[];
    };
    expect(empty).toMatchObject({ season: 9, clubs: [] });
  });

  it('体检：合规通过；CA 漂移后失败；未注册俱乐部被点名', async () => {
    const fx = freshEnv();
    await seedRegistrationWorld(fx);
    await post('/api/club/registrations', regBody(FULL_FIRST, FULL_TRAINEE), 'tok-coach', fx.env);
    // 注册后属性漂移：又长出两位 CA≥90（原上限 1 名）
    fx.sqlite.prepare('UPDATE players SET ca = 91 WHERE id = 2').run();
    fx.sqlite.prepare('UPDATE players SET ca = 92 WHERE id = 3').run();
    const res = await get('/api/admin/compliance', 'tok-admin', fx.env);
    const body = (await res.json()) as {
      season: number;
      clubs: { clubId: number; pass: boolean; issues: { rule: string; message: string }[] }[];
    };
    expect(body.season).toBe(1);
    const mine = body.clubs.find((c) => c.clubId === 1)!;
    expect(mine.pass).toBe(false);
    expect(mine.issues[0].message).toContain('CA≥90 的球员最多 1 名，当前 2 名');

    // 未注册的第二家俱乐部
    fx.sqlite.exec("INSERT INTO clubs (id, name, league_tier, status) VALUES (2, '曼城', 'second', 'active')");
    const res2 = await get('/api/admin/compliance', 'tok-admin', fx.env);
    const body2 = (await res2.json()) as { clubs: { clubId: number; pass: boolean; issues: { rule: string; message: string }[] }[] };
    expect(body2.clubs.find((c) => c.clubId === 2)!.issues[0]).toMatchObject({
      rule: 'not_registered',
      message: '本赛季还没提交注册名单',
    });
  });
});

