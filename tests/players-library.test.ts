// 球员库列表（v0.7.1 d6）：筛选（position/name/growable/CA·PA·年龄区间）、数值键 keyset 排序翻页、参数校验
// + view=initial 的导入时口径（CA=base_ca、PA=导入值）；initial_club_id 已在v2.0.0 裁决 4 删除
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, runMigration } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { foldName } from '../src/core/name-fold.ts';

// 本文件密集打 /api/players，每个用例先清进程内限流计数（v2.8.1 守护）
beforeEach(() => resetGuards());

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
    // v3.2.0：未配 = 走分级 TTL（生产口径），这里显式旁路，让断言看到每次改库的结果
    PUBLIC_CACHE_TTL_MS: '0',
  };
  return { env, sqlite };
}

function get(path: string, env: Env) {
  return app.request(path, { method: 'GET' }, env);
}

interface ListBody {
  players: {
    id: number;
    name: string;
    position: string | null;
    age: number | null;
    ca: number;
    pa: number;
    growable: boolean;
    marketValue: number | null;
    clubName: string | null;
  }[];
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
    INSERT INTO clubs (id, name, league_tier, status) VALUES
      (1, '老东家 FC', 'premier', 'active'),
      (2, '蓝月亮', 'premier', 'active'),
      (3, '雾都联', 'second', 'active');
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

describe('球员库列表（v0.7.1 d6）', () => {
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
    // v3.1.0：折叠改写后三个元字符的语义都没变，% 之外再钉 _ 与反斜杠
    expect((await list('/api/players?name=_', fx.env)).players).toEqual([]);
    expect((await list('/api/players?name=%5C', fx.env)).players).toEqual([]);
    expect((await list('/api/players?name=a%5Cb', fx.env)).players).toEqual([]);
  });

  it('列表回俱乐部名（d8）：两种视图都打现行归属名，无归属显示 null', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    // 给 1 号挂一条归属变更：老东家 1 → 蓝月亮 2
    fx.sqlite.exec(
      `INSERT INTO transfers (player_id, type, from_club_id, to_club_id, created_at) VALUES (1, 'transfer', 1, 2, '2026-01-01T00:00:00Z')`,
    );
    fx.sqlite.exec(`UPDATE players SET club_id = 2 WHERE id = 1`);

    const current = await list('/api/players?club_id=2', fx.env);
    // 3、4 号种子现属就是蓝月亮；1 号转会后也归 2
    expect(current.players.map((p) => p.id)).toEqual([1, 3, 4]);
    expect(current.players[0]!.clubName).toBe('蓝月亮');

    const elsewhere = await list('/api/players?club_id=3', fx.env);
    expect(elsewhere.players.map((p) => p.id)).toEqual([8]);
    expect(elsewhere.players[0]!.clubName).toBe('雾都联');

    const unowned = await list('/api/players?name=狐步舞', fx.env);
    expect(unowned.players[0]!.clubName).toBeNull();

    // 初始视图只改 CA/PA 口径，归属仍看 players.club_id（v2.0.0 裁决 4 删掉 initial_club_id）
    const initial = await list('/api/players?view=initial&club_id=1', fx.env);
    expect(initial.players.map((p) => p.id)).toEqual([2, 7]);
    expect(initial.players[0]!.clubName).toBe('老东家 FC');
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
    // v3.1.0：uid 变成合法排序键（表头可点），这里改用真的不存在的键
    expect((await get('/api/players?sort=没有这个键', fx.env)).status).toBe(400);
    expect((await get('/api/players?growable=yes', fx.env)).status).toBe(400);
    expect((await get('/api/players?sort=ca&cursor=oops', fx.env)).status).toBe(400);
    expect((await get('/api/players?ca_min=-1', fx.env)).status).toBe(400);
    expect((await get('/api/players?name=', fx.env)).status).toBe(400);
  });
});

describe('初始归属字段的兴废（v0.7.1 d7 加、v2.0.0 裁决 4 删）', () => {
  // 0015 回填测存量：先建到 0014 → 造历史归属数据 → 补跑 0015
  function freshEnvWithHistory(): Fixture {
    resetConfigCache();
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0014_season_tournaments.sql');
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
      PUBLIC_CACHE_TTL_MS: '0',
    };
    return { env, sqlite };
  }

  it('0015 回填：最早变更的 from_club_id / 只海捞过留 NULL / 没转过会=现属', async () => {
    const fx = freshEnvWithHistory();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id) VALUES
        (10, 'h1', '转了两队', 2),
        (11, 'h2', '海捞的', 2),
        (12, 'h3', '原地不动', 3),
        (13, 'h4', '无归属', NULL),
        (14, 'h5', '解约离队', 1);
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id) VALUES
        (1, 'transfer', 10, 3, 2),      -- 最早一条：initial 应取 from=3（不是这条 1）
        (2, 'transfer', 10, 1, 3),
        (3, 'free_agent', 11, NULL, 2),
        (4, 'termination', 14, 4, NULL);
    `);
    runMigration(fx.sqlite, '0015_initial_club.sql');

    const rows = (
      fx.sqlite.prepare(`SELECT id, initial_club_id FROM players WHERE id >= 10 ORDER BY id`).all() as {
        id: number;
        initial_club_id: number | null;
      }[]
    ).map((r) => [r.id, r.initial_club_id]);
    expect(rows).toEqual([
      [10, 3],
      [11, null],
      [12, 3],
      [13, null],
      [14, 4],
    ]);
  });

  it('0020 删列：列里有值也能删掉，删后 players 不再有 initial_club_id', async () => {
    const fx = freshEnvWithHistory();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id) VALUES (10, 'h1', '转了两队', 2);
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id) VALUES (1, 'transfer', 10, 3, 2);
    `);
    runMigration(fx.sqlite, '0015_initial_club.sql');
    const filled = fx.sqlite.prepare(`SELECT initial_club_id FROM players WHERE id = 10`).get() as {
      initial_club_id: number | null;
    };
    expect(filled.initial_club_id).toBe(3);

    runMigration(fx.sqlite, '0020_drop_initial_club.sql');
    const cols = (fx.sqlite.prepare(`PRAGMA table_info(players)`).all() as { name: string }[]).map((r) => r.name);
    expect(cols).not.toContain('initial_club_id');
  });

  it('view=initial：CA/PA 显示导入时口径，club_id 筛选与 ca 排序都打现值', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (1, '老东家'), (2, '新东家');
      INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, base_ca, market_value, game_attrs, growable) VALUES
        (20, 'i1', '甲', 1, 'ST', 24, 88, 90, 61, 99, '{"PA":80}', 1),
        (21, 'i2', '乙', 2, 'CM', 27, 84, 86, 70, 88, '{"PA":72}', 0);
    `);

    const body = await list('/api/players?view=initial&sort=ca', fx.env);
    expect(body.players).toEqual([
      expect.objectContaining({ id: 21, clubId: 2, ca: 70, pa: 72 }),
      expect.objectContaining({ id: 20, clubId: 1, ca: 61, pa: 80 }),
    ]);

    // 归属没有「初始」维度了：club_id 在两种视图下都按 players.club_id 过滤
    const oldTeamOnly = await list('/api/players?view=initial&club_id=1', fx.env);
    expect(oldTeamOnly.players.map((p) => p.id)).toEqual([20]);
    expect(oldTeamOnly.players[0]!.clubName).toBe('老东家');
    const currentView = await list('/api/players?club_id=1', fx.env);
    expect(currentView.players.map((p) => p.id)).toEqual([20]);
  });

  it('详情只回现行归属：不再有 initialClubId / initialClub；view 参数非法 400', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (1, '老东家'), (2, '新东家');
      INSERT INTO players (id, uid, name, club_id) VALUES (30, 'd1', '丙', 2);
    `);

    const res = await get('/api/players/30', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      player: Record<string, unknown> & { clubId: number | null };
      club: { id: number; name: string } | null;
    } & Record<string, unknown>;
    expect(body.player.clubId).toBe(2);
    expect(body.club?.name).toBe('新东家');
    expect('initialClubId' in body.player).toBe(false);
    expect('initialClub' in body).toBe(false);

    expect((await get('/api/players?view=nope', fx.env)).status).toBe(400);
  });
});

// ---- v2.3.0：计数、影响力、多位置、属性/徽章/合同维度筛选 ----

interface ListBody17 {
  players: {
    id: number;
    positions: string[];
    influence: number;
    wage: number | null;
    releaseFee: number | null;
    contractType: string | null;
    serviceSeasons: number | null;
    protected: boolean;
    psIds?: (number | null)[];
    /** 带 attr 筛选/排序时随行带回的属性值（前端自动加列显示用） */
    attrValue?: number | null;
  }[];
  nextCursor: string | null;
}

async function list17(path: string, env: Env): Promise<ListBody17> {
  const res = await get(path, env);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody17;
}

// v3.2.0：公开列表不再回 total（每条整表 COUNT = 18,763 行，占单页读量 99.7%），
// 「这个筛法下有多少人」改由内部计数端点提供 —— 计数用例全走这里。
// 端点未配 CRON_KEY 就 403（fail-closed），所以这里必须带密钥头。
async function count17(query: string, env: Env): Promise<number> {
  const res = await app.request(
    `/api/cron/players-count${query}`,
    { method: 'GET', headers: { 'X-Cron-Key': 'test-cron-key' } },
    { ...env, CRON_KEY: 'test-cron-key' },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { count: number }).count;
}

// 影响力手算依据（规则 4.1.2 十档 + 4.1.3 系数 0.25/0.13）：
//   tier: >=93→10 >=90→9 >=87→8 >=84→7 >=80→6 >=75→5 >=70→4 >=65→3 >=60→2 else 1
//   可成长=(CA档+PA档)/2×0.25×声望；非成长=CA档×0.13×声望
describe('球员库 计数与新筛选（v2.3.0）', () => {
  it('内部计数端点返回筛选后的总数，不随 cursor / limit 变', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    expect(await count17('', fx.env)).toBe(8);
    expect(await count17('?position=GK', fx.env)).toBe(2);
    // 分页参数对计数无意义：cursor 不参与 filters，limit 只影响列表返回行数
    expect(await count17('?limit=3', fx.env)).toBe(8);
    expect(await count17('?limit=3&cursor=999', fx.env)).toBe(8);
    // 列表本身已不带 total（前端改用 nextCursor 判「还有更多」）
    const paged = await list17('/api/players?limit=3', fx.env);
    expect(paged.players.length).toBe(3);
    expect('total' in paged).toBe(false);
    const next = await list17(`/api/players?limit=3&cursor=${paged.nextCursor}`, fx.env);
    expect(next.players.length).toBe(3);
    expect('total' in next).toBe(false);
  });

  it('内部计数端点：CRON_KEY 配了就守（无密钥 403、带密钥 200）', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    const guarded: Env = { ...fx.env, CRON_KEY: 'secret-key' };
    expect((await get('/api/cron/players-count', guarded)).status).toBe(403);
    expect((await get('/api/cron/players-count?key=wrong', guarded)).status).toBe(403);
    // 这个端点只认 X-Cron-Key 头：GET 带 ?key= 会把密钥写进访问日志，连对的也不收
    expect((await get('/api/cron/players-count?key=secret-key', guarded)).status).toBe(403);
    const viaHeader = await app.request(
      '/api/cron/players-count',
      { method: 'GET', headers: { 'X-Cron-Key': 'secret-key' } },
      guarded,
    );
    expect(viaHeader.status).toBe(200);
    expect(((await viaHeader.json()) as { count: number }).count).toBe(8);
  });

  it('内部计数端点：未配 CRON_KEY 时拒绝（fail-closed，每次调用都是整表 COUNT）', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    // 生产 whl-club 实测没配 CRON_KEY（2026-09-22 `wrangler secret list` 只有 AUTH_BIND_SECRET），
    // 放行等于公开一个 18,763 行/次的读放大器 —— 这里锁死「未配就 403」。
    expect((await get('/api/cron/players-count', fx.env)).status).toBe(403);
  });

  it('影响力：可成长=(CA档+PA档)/2×0.25×声望、非成长=CA档×0.13×声望，响应值与手算一致', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, ca, pa, growable, prestige) VALUES
        (21, 'if1', '可成长高双围', 85, 93, 1, 2),
        (22, 'if2', '可成长中围',   70, 90, 1, 3),
        (23, 'if3', '非成长顶CA',   93, 95, 0, 1),
        (24, 'if4', '可成长低围',   65, 80, 1, 2),
        (25, 'if5', '非成长中CA',   78, 78, 0, 4);
    `);
    const body = await list17('/api/players?sort=influence', fx.env);
    expect(body.players.map((p) => [p.id, p.influence])).toEqual([
      [22, 4.88], // (4档+9档)/2=6.5 ×0.25×3 = 4.875 → 4.88
      [21, 4.25], // (7+10)/2=8.5 ×0.25×2 = 4.25
      [25, 2.6], // 5档 ×0.13×4 = 2.6
      [24, 2.25], // (3+6)/2=4.5 ×0.25×2 = 2.25
      [23, 1.3], // 10档 ×0.13×1 = 1.3
    ]);
  });

  it('sort=influence keyset 翻页不重不漏；influence 区间过滤', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, ca, pa, growable, prestige) VALUES
        (21, 'i1', '甲', 85, 93, 1, 2),
        (22, 'i2', '乙', 70, 90, 1, 3),
        (23, 'i3', '丙', 93, 95, 0, 1),
        (24, 'i4', '丁', 65, 80, 1, 2),
        (25, 'i5', '戊', 78, 78, 0, 4);
    `);
    const page1 = await list17('/api/players?sort=influence&limit=2', fx.env);
    expect(page1.players.map((p) => p.id)).toEqual([22, 21]);
    const page2 = await list17(`/api/players?sort=influence&limit=2&cursor=${page1.nextCursor}`, fx.env);
    expect(page2.players.map((p) => p.id)).toEqual([25, 24]);
    const page3 = await list17(`/api/players?sort=influence&limit=2&cursor=${page2.nextCursor}`, fx.env);
    expect(page3.players.map((p) => p.id)).toEqual([23]);
    expect(page3.nextCursor).toBeNull();

    const gated = await list17('/api/players?influence_min=2.6', fx.env);
    expect(gated.players.map((p) => p.id)).toEqual([21, 22, 25]); // 默认 sort=id 升序
    expect(await count17('?influence_min=2.6', fx.env)).toBe(3);
  });

  it('多位置：positions 按槽位序去重；position 多值筛含 PosID2-4 槽', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, position, game_attrs) VALUES
        (26, 'p1', '登贝型', 'ST', '{"PosID1":25,"PosID2":23,"PosID3":18}'),
        (27, 'p2', '纯中卫', 'CB', '{"PosID1":5}');
    `);
    const body = await list17('/api/players?name=登贝型', fx.env);
    expect(body.players[0]!.positions).toEqual(['ST', 'RW', 'CAM']);

    const stOnly = await list17('/api/players?position=ST', fx.env);
    expect(stOnly.players.map((p) => p.id)).toEqual([26]);
    const multi = await list17('/api/players?position=RW,CAM', fx.env);
    expect(multi.players.map((p) => p.id)).toEqual([26]);
    const cbOnly = await list17('/api/players?position=CB', fx.env);
    expect(cbOnly.players.map((p) => p.id)).toEqual([27]);

    expect((await get('/api/players?position=ZZ', fx.env)).status).toBe(400);
  });

  it('细分属性区间：白名单键走 json_extract，黑名单键 400', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, game_attrs) VALUES
        (28, 'a1', '射手', '{"finishing":88,"vision":70}'),
        (29, 'a2', '中场', '{"finishing":62,"vision":91}'),
        (30, 'a3', '无该属性', '{"vision":99}');
    `);
    const finishers = await list17('/api/players?attr=finishing&attr_min=80', fx.env);
    expect(finishers.players.map((p) => p.id)).toEqual([28]);
    expect(await count17('?attr=finishing&attr_min=80', fx.env)).toBe(1);
    const vision = await list17('/api/players?attr=vision&attr_max=80', fx.env);
    expect(vision.players.map((p) => p.id)).toEqual([28]);
    expect((await get('/api/players?attr=nosuchkey&attr_min=1', fx.env)).status).toBe(400);
    expect((await get('/api/players?attr=nosuchkey', fx.env)).status).toBe(400);
    // attr 单独给合法：不过滤，只把该属性的值带回响应（前端「选一个属性」这个动作只发 attr）
    const justAttr = await list17('/api/players?attr=finishing', fx.env);
    expect(await count17('?attr=finishing', fx.env)).toBe(3);
    expect(justAttr.players.map((p) => p.attrValue)).toEqual([88, 62, null]);
    // 空串等同没给（前端清空属性键时 URL 上会留 attr=）
    expect(await count17('?attr=&attr_min=80', fx.env)).toBe(3);
    // 区间值给空串也等同没给：缺该属性的那行（json_extract → NULL）不能被 Number('') = 0 悄悄滤掉
    const emptyMin = await list17('/api/players?attr=finishing&attr_min=', fx.env);
    expect(await count17('?attr=finishing&attr_min=', fx.env)).toBe(3);
    expect(emptyMin.players.map((p) => p.id)).toEqual([28, 29, 30]);
  });

  it('徽章/惯用脚/fc_id 筛选', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, foot, badges_silver, badges_gold, fc_id) VALUES
        (31, 'b1', '金徽右脚', 1, 5, 2, 9001),
        (32, 'b2', '无徽左脚', 0, 0, 0, 9002);
    `);
    expect((await list17('/api/players?badges_gold_min=1', fx.env)).players.map((p) => p.id)).toEqual([31]);
    expect((await list17('/api/players?badges_none=1', fx.env)).players.map((p) => p.id)).toEqual([32]);
    expect((await list17('/api/players?foot=0', fx.env)).players.map((p) => p.id)).toEqual([32]);
    expect((await list17('/api/players?fc_id=9001', fx.env)).players.map((p) => p.id)).toEqual([31]);
    expect((await get('/api/players?badges_gold_min=9', fx.env)).status).toBe(400);
  });

  it('合同维度：has_contract / 工资 / 无RC / 类型 / 成约方式 / 保护期 / 效力年限', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (1, '老东家');
      INSERT INTO players (id, uid, name, club_id) VALUES
        (41, 'c1', '有合同', 1),
        (42, 'c2', '无合同', 1),
        (43, 'c3', '训练营', 1);
      INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, service_ticks, protection_ticks, signed_season, signed_window_seq, is_active) VALUES
        -- 效力基数 4 → 已关常规窗数 6 时效力 1.0 赛季；保护期 4+3=7 > 6 → 保护中
        (41, 1, NULL, 5.5, 'formal', 'negotiation', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z', 4, 7, 2, 1, 1),
        -- 训练营：无保护期；效力基数 0 → 3.0 赛季
        (43, 1, 10, 0.75, 'trainee', 'import', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', 0, NULL, 3, 1, 1);
      INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
        (1, 1, 'closed', 0, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        (1, 2, 'closed', 0, '2026-02-02T00:00:00Z', '2026-03-01T00:00:00Z'),
        (2, 1, 'closed', 0, '2026-03-02T00:00:00Z', '2026-04-01T00:00:00Z'),
        (2, 2, 'closed', 0, '2026-04-02T00:00:00Z', '2026-05-01T00:00:00Z'),
        (3, 1, 'closed', 0, '2026-05-02T00:00:00Z', '2026-06-01T00:00:00Z'),
        (3, 2, 'closed', 0, '2026-06-02T00:00:00Z', '2026-07-01T00:00:00Z');
    `);
    expect((await list17('/api/players?has_contract=1', fx.env)).players.map((p) => p.id)).toEqual([41, 43]);
    expect((await list17('/api/players?has_contract=0', fx.env)).players.map((p) => p.id)).toEqual([42]);
    expect((await list17('/api/players?wage_min=5', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?release_fee_none=1', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?contract_type=trainee', fx.env)).players.map((p) => p.id)).toEqual([43]);
    expect((await list17('/api/players?source=negotiation', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?protected=in', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?protected=out', fx.env)).players.map((p) => p.id)).toEqual([42, 43]);
    // 效力时长按赛季：41 = 1.0，43 = 3.0
    expect((await list17('/api/players?effective_years_max=1', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?effective_years_min=3', fx.env)).players.map((p) => p.id)).toEqual([43]);
    // 响应带现行合同速览
    const withContract = await list17('/api/players?name=有合同', fx.env);
    expect(withContract.players[0]!.wage).toBe(5.5);
    expect(withContract.players[0]!.releaseFee).toBeNull();
    expect(withContract.players[0]!.contractType).toBe('formal');
    expect(withContract.players[0]!.serviceSeasons).toBe(1);
    expect(withContract.players[0]!.protected).toBe(true);
  });

  it('PlayStyle 多选：银徽只命中银槽、金徽（ID+100）只命中金槽；非法值 400', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, game_attrs) VALUES
        (51, 's1', '银槽搓射', '{"PSID1":1,"PSID2":5}'),
        (52, 's2', '金槽吊射', '{"PSID13":102}'),
        (53, 's3', '无徽', NULL);
    `);
    expect((await list17('/api/players?ps=1', fx.env)).players.map((p) => p.id)).toEqual([51]);
    // v3.1.1 步骤 4 改语义：2 是银徽章 ID，52 号只有金槽的 102（=2+100），不再算命中
    expect((await list17('/api/players?ps=2', fx.env)).players.map((p) => p.id)).toEqual([]);
    const gold = await list17('/api/players?ps=102', fx.env);
    expect(gold.players.map((p) => p.id)).toEqual([52]);
    // 银金混选：一段一命中，各查各的槽
    expect((await list17('/api/players?ps=1,102', fx.env)).players.map((p) => p.id)).toEqual([51, 52]);
    // psIds 与槽位对齐：52 号只有金槽 13（下标 12）有值，前面 12 个槽是 null
    const goldRow = gold.players.find((p) => p.id === 52)!;
    expect(goldRow.psIds).toHaveLength(15);
    expect(goldRow.psIds!.slice(0, 12)).toEqual(Array.from({ length: 12 }, () => null));
    expect(goldRow.psIds![12]).toBe(102);
    expect((await list17('/api/players?ps=1,5', fx.env)).players.map((p) => p.id)).toEqual([51]);
    expect((await list17('/api/players?ps=9', fx.env)).players.map((p) => p.id)).toEqual([]);
    expect((await get('/api/players?ps=0', fx.env)).status).toBe(400);
    expect((await get('/api/players?ps=abc', fx.env)).status).toBe(400);
    // 100 夹在银段与金段之间（银 1-99 / 金 101-199），200 越界，都是非法值
    expect((await get('/api/players?ps=100', fx.env)).status).toBe(400);
    expect((await get('/api/players?ps=200', fx.env)).status).toBe(400);
    // 金值不会去碰银槽：给银槽塞个 102（脏数据）也不该被 ps=102 捞出来
    fx.sqlite.exec(`UPDATE players SET game_attrs = '{"PSID1":102}' WHERE id = 51;`);
    expect((await list17('/api/players?ps=102', fx.env)).players.map((p) => p.id)).toEqual([52]);
    // 反方向也对称：银值落在金槽（脏数据）同样不被银段值捞出来 —— 银金各查各的槽
    fx.sqlite.exec(`UPDATE players SET game_attrs = '{"PSID13":2}' WHERE id = 53;`);
    expect((await list17('/api/players?ps=2', fx.env)).players.map((p) => p.id)).toEqual([]);
    // 重复值去重后语义不变
    fx.sqlite.exec(`UPDATE players SET game_attrs = '{"PSID1":2}' WHERE id = 53;`);
    expect((await list17('/api/players?ps=2,2,2', fx.env)).players.map((p) => p.id)).toEqual([53]);
    // 每个值要铺 12-15 个槽位条件，超量直接 400（地址栏手改能塞进任意长的清单）
    expect((await get(`/api/players?ps=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`, fx.env)).status).toBe(400);
  });

  it('club_id=free 筛无归属球员；market_value 区间', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    expect((await list17('/api/players?club_id=free', fx.env)).players.map((p) => p.id)).toEqual([5, 6]);
    expect((await get('/api/players?club_id=0', fx.env)).status).toBe(400);
    const mv = await list17('/api/players?market_value_min=50&market_value_max=100', fx.env);
    expect(mv.players.map((p) => p.id)).toEqual([3, 4, 5]); // 6 号 NULL 身价不命中
    expect((await get('/api/players?market_value_min=-1', fx.env)).status).toBe(400);
  });

  it('参数校验：foot / growth_tier / agent_tier / has_contract / protected 400', async () => {
    const fx = freshEnv();
    expect((await get('/api/players?foot=2', fx.env)).status).toBe(400);
    expect((await get('/api/players?growth_tier=9', fx.env)).status).toBe(400);
    expect((await get('/api/players?agent_tier=7', fx.env)).status).toBe(400);
    expect((await get('/api/players?has_contract=yes', fx.env)).status).toBe(400);
    expect((await get('/api/players?protected=maybe', fx.env)).status).toBe(400);
    // v3.1.0：uid 变成合法排序键（表头可点），这里改用真的不存在的键
    expect((await get('/api/players?sort=没有这个键', fx.env)).status).toBe(400);
  });
});

// v3.1.0：去变音搜索（name 走 core/name-fold 折叠）+ 轻量名册端点
describe('姓名去变音搜索与轻量名册（v3.1.0）', () => {
  // 库内是 FC 拉丁名：预合成、分解、软连字符混着来，另有中文名作回归
  // （分解用 char() 拼——把组合记号直接写进源码是审阅灾难，也是 name-fold 用码位建表的同一理由；
  //   这里用 U+0301，它是 2026-09-21 生产扫描实测存在的两个组合记号之一，表内收着）
  function seedAccents(sqlite: DatabaseSync): void {
    sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '利物浦', 'premier', 'active');
      INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status) VALUES
        (101, 'a1', 'Šeško',              1, 'ST', 22, 78, 88, 1, 'normal'),
        (102, 'a2', 'Ødegaard',           NULL, 'CAM', 27, 86, 88, 0, 'normal'),
        (103, 'a3', 'Çalhanoğlu',         1, 'CM', 31, 84, 84, 0, 'normal'),
        (104, 'a4', 'S' || char(769) || 'eško',   NULL, 'ST', 20, 70, 90, 1, 'normal'),
        (105, 'a5', 'M' || char(173) || 'uller',  1, 'ST', 25, 80, 82, 0, 'normal'),
        (106, 'a6', '阿尔法三世',         NULL, 'CB', 19, 60, 85, 1, 'normal');
    `);
  }

  it('name 折叠：sesko 搜得到 Šeško（预合成、分解、软连字符三种写法都算）', async () => {
    const fx = freshEnv();
    seedAccents(fx.sqlite);

    const ids = async (q: string) => (await list(`/api/players?name=${encodeURIComponent(q)}&limit=100`, fx.env)).players.map((p) => p.id);

    expect(await ids('sesko')).toEqual([101, 104]); // 101 预合成、104 分解形式
    expect(await ids('SESKO')).toEqual([101, 104]); // 大小写无关
    expect(await ids('Šeško')).toEqual([101, 104]); // 打原字也命中
    expect(await ids('odegaard')).toEqual([102]); // Ø → o
    expect(await ids('calhanoglu')).toEqual([103]); // Ç/ğ
    expect(await ids('muller')).toEqual([105]); // 软连字符 U+00AD 被吃掉 → Muller
    expect(await ids('阿尔法')).toEqual([106]); // 中文子串回归：折叠对 CJK 是恒等
    expect(await ids('zzzz')).toEqual([]);
  });

  // 判空必须在折叠之后：软连字符 trim() 不走、但表里把它折成空串；按原串判空会拼出 `%%`，
  // 于是「搜了个不可见字符」从空结果变成列出全库。
  // ZWSP（U+200B）不在这张表里（生产姓名里没有它），所以它现在是字面字符——按字面搜、命中不了什么。
  it('name 折完为空时按空串拒（400），不退化成列出全库', async () => {
    const fx = freshEnv();
    seedAccents(fx.sqlite);

    for (const q of ['\u00ad', '\u00ad\u00ad', '\u00ad ']) {
      const res = await get(`/api/players?name=${encodeURIComponent(q)}`, fx.env);
      expect(res.status, `查询词 ${JSON.stringify(q)}`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('name 不能为空');
    }
    expect((await get('/api/players?name=%20', fx.env)).status).toBe(400); // 纯空格仍是 400

    const zwsp = await get(`/api/players?name=${encodeURIComponent('\u200b')}`, fx.env);
    expect(zwsp.status).toBe(200);
    expect(((await zwsp.json()) as { players: unknown[] }).players).toEqual([]); // 字面搜，不是全库
  });

  it('名册端点：姓名里的 | 与换行不撑坏行格式，行序按 id 确定', async () => {
    const fx = freshEnv();
    seedAccents(fx.sqlite);
    fx.sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (2, '拜仁慕尼黑', 'premier', 'active');
      INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status) VALUES
        (107, 'a7', 'A|B',                          1, 'ST', 24, 75, 80, 0, 'normal'),
        (108, 'a8', 'C' || char(10) || 'D',        NULL, 'ST', 23, 74, 79, 0, 'normal'),
        (109, 'a9', 'E' || char(13) || 'F',           2, 'ST', 22, 73, 78, 0, 'normal');
    `);

    const body = (await (await get('/api/players/roster', fx.env)).json()) as { roster: string; count: number };
    const lines = body.roster.split('\n');
    // 姓名带 \n 的球员若不在 SQL 里换成空格，这里会多出一行、与 count 对不上
    expect(lines).toHaveLength(body.count);
    expect(body.count).toBe(9);

    const parse = (line: string) => {
      const i = line.lastIndexOf('|');
      const id = Number(line.slice(i + 1));
      const rest = line.slice(0, i);
      const j = rest.lastIndexOf('|');
      return { id, clubId: j < 0 ? null : Number(rest.slice(j + 1)), name: j < 0 ? rest : rest.slice(0, j) };
    };
    const rows = lines.map(parse);
    // 载荷顺序确定（SQL 里 ORDER BY players.id）⇒ 不必在测试里再排一遍
    expect(rows.map((r) => r.id)).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(rows[6]).toEqual({ id: 107, clubId: 1, name: 'A|B' }); // 姓名含分隔符：从行尾反向切分仍正确
    expect(rows[7]).toEqual({ id: 108, clubId: null, name: 'C D' }); // \n 换空格
    expect(rows[8]).toEqual({ id: 109, clubId: 2, name: 'E F' }); // \r 换空格
    expect(body.roster).not.toContain('\r');
  });

  // 折叠只做「查表 + ASCII 小写」两件 SQL 也做得到的事，所以非拉丁名两侧都不动：
  // 原样照打必须命中（曾经 JS 侧多做一层整段 toLowerCase，把 'Шевченко' 折成 'шевченко' ⇒ 0 命中）
  it('非拉丁姓名：原样照打命中，另一种大小写不命中（两侧行为一致）', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status)
       VALUES (201, 'b1', 'Шевченко', NULL, 'CB', 30, 80, 82, 0, 'normal')`,
    );
    const ids = async (q: string) => (await list(`/api/players?name=${encodeURIComponent(q)}&limit=100`, fx.env)).players.map((p) => p.id);

    expect(await ids('Шевченко')).toEqual([201]);
    expect(await ids('евчен')).toEqual([201]); // 子串
    expect(await ids('шевченко')).toEqual([]); // 另一大小写：库里原样、SQLite 只折 ASCII ⇒ 不命中
  });

  it('名册端点：行格式=姓名|俱乐部|ID，俱乐部空则省略；与 /players/:id 不冲突', async () => {
    const fx = freshEnv();
    seedAccents(fx.sqlite);

    const res = await get('/api/players/roster', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roster: string; count: number };
    expect(body.count).toBe(6);

    const lines = body.roster.split('\n');
    expect(lines).toHaveLength(6);
    // 从行尾反向切分：最后一段是球员 ID，倒数第二段（若存在）是俱乐部 ID，其余是姓名
    const parse = (line: string) => {
      const i = line.lastIndexOf('|');
      const id = Number(line.slice(i + 1));
      const rest = line.slice(0, i);
      const j = rest.lastIndexOf('|');
      return { id, clubId: j < 0 ? null : Number(rest.slice(j + 1)), name: j < 0 ? rest : rest.slice(0, j) };
    };
    const rows = lines.map(parse).sort((a, b) => a.id - b.id);
    expect(rows).toEqual([
      { id: 101, clubId: 1, name: 'Šeško' },
      { id: 102, clubId: null, name: 'Ødegaard' },
      { id: 103, clubId: 1, name: 'Çalhanoğlu' },
      { id: 104, clubId: null, name: 'S\u0301eško' },
      { id: 105, clubId: 1, name: 'M\u00ADuller' },
      { id: 106, clubId: null, name: '阿尔法三世' },
    ]);

    // 路由不冲突：「roster」不能被 /players/:id 抢走
    const detail = await get('/api/players/101', fx.env);
    expect(detail.status).toBe(200);
    const card = (await detail.json()) as { player: { id: number; name: string } };
    expect(card.player).toEqual(expect.objectContaining({ id: 101, name: 'Šeško' }));

    // 空库：不报错、count 0、roster 空串（group_concat 无行时是 NULL）
    // 名册缓存有自己的 5 分钟下限、不跟随公开 TTL（见路由注释），所以同一进程里换库要先清缓存
    resetGuards();
    const empty = freshEnv();
    const emptyBody = (await (await get('/api/players/roster', empty.env)).json()) as { roster: string; count: number };
    expect(emptyBody).toEqual({ roster: '', count: 0 });
  });
});

// ---- v4.0.0：显示名（FC26 派生的「常叫人名」）贯通各面 + 球员页按 fc_id 寻址 ----
//
// 口径（src/core/player-name.ts）：显示名 = COALESCE(display_name, name)。display_name 是导入侧
// 从 FC26 存档派生的（commonname 原样 → 名+姓 → 卡片全名兜底，见 scripts/player-names/），
// 而 players.name 仍是 FC26db 的官方缩写名（导入对齐键 fc_id 的伴生语义），语义没变、只是不再当显示名用。
// 搜索必须**两列都打**：几百人的显示名是 FC26 单词常用名（Ederson / Isaac），只看显示名按姓搜不到；
// 只看官方缩写名则「Erling Haaland」这种全名搜不到。
describe('显示名与 fc_id 寻址（v4.0.0）', () => {
  function seedDisplay(sqlite: DatabaseSync): void {
    sqlite.exec(`
      INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '曼城', 'premier', 'active');
      INSERT INTO players (id, uid, name, display_name, fc_id, club_id, position, age, ca, pa, growable, status) VALUES
        (301, 'n1', 'E. Haaland',              'Erling Haaland', 239085, 1,    'ST',  25, 91, 93, 0, 'normal'),
        (302, 'n2', 'Ederson Santana de Moraes', 'Ederson',      212602, 1,    'GK',  32, 87, 87, 0, 'normal'),
        (303, 'n3', 'M. Ødegaard',              NULL,             NULL,   NULL, 'CAM', 27, 86, 88, 0, 'normal');
    `);
  }

  it('列表：name 出显示名、officialName 出官方缩写名；没派生过的两人相同', async () => {
    const fx = freshEnv();
    seedDisplay(fx.sqlite);

    const body = await list('/api/players?limit=100', fx.env);
    const byId = new Map(body.players.map((p) => [p.id, p]));
    expect(byId.get(301)).toMatchObject({ name: 'Erling Haaland', officialName: 'E. Haaland' });
    expect(byId.get(302)).toMatchObject({ name: 'Ederson', officialName: 'Ederson Santana de Moraes' });
    // 没派生（display_name 为 NULL）回落官方缩写名，officialName 与 name 相同 ⇒ 前端不显示小字
    expect(byId.get(303)).toMatchObject({ name: 'M. Ødegaard', officialName: 'M. Ødegaard' });
  });

  it('搜索两列都命中：显示名搜得到、官方全名里独有的姓也搜得到', async () => {
    const fx = freshEnv();
    seedDisplay(fx.sqlite);
    const ids = async (q: string) =>
      (await list(`/api/players?name=${encodeURIComponent(q)}&limit=100`, fx.env)).players.map((p) => p.id);

    expect(await ids('ederson')).toEqual([302]); // 显示名（FC26 单词常用名）
    expect(await ids('santana')).toEqual([302]); // 只在官方缩写名里 ⇒ 第二个 OR 分支
    expect(await ids('haaland')).toEqual([301]); // 两列都有
    expect(await ids('erling')).toEqual([301]); // 只在显示名里 ⇒ 第一个 OR 分支
    expect(await ids('odegaard')).toEqual([303]); // 折叠后搜：Ø → o
    expect(await ids('zzzz')).toEqual([]);
  });

  // 显示名序与官方名序刻意相反：显示名序 [302('ederson'), 301('erling haaland'), 303('m. odegaard')]，
  // 官方名序 [301('e. haaland'), 302('ederson …'), 303] ⇒ 这个用例能分辨实现用的是哪一列
  it('sort=name 按显示名排（不是官方缩写名），升降两向与游标翻页都对', async () => {
    const fx = freshEnv();
    seedDisplay(fx.sqlite);

    // 默认降序（除 id 外所有键都是 desc 优先）
    const desc = await list('/api/players?sort=name&limit=100', fx.env);
    expect(desc.players.map((p) => p.id)).toEqual([303, 301, 302]);
    expect(desc.nextCursor).toBeNull();

    const asc = await list('/api/players?sort=name&order=asc&limit=100', fx.env);
    expect(asc.players.map((p) => p.id)).toEqual([302, 301, 303]);

    const paged = await list('/api/players?sort=name&limit=1', fx.env);
    expect(paged.players.map((p) => p.id)).toEqual([303]);
    expect(paged.nextCursor).not.toBeNull();
    const second = await list(`/api/players?sort=name&limit=1&cursor=${encodeURIComponent(paged.nextCursor!)}`, fx.env);
    expect(second.players.map((p) => p.id)).toEqual([301]);
  });

  it('名册端点第三段用 fc_id（没有 fc_id 才回落内部 id）', async () => {
    const fx = freshEnv();
    seedDisplay(fx.sqlite);

    const body = (await (await get('/api/players/roster', fx.env)).json()) as { roster: string; count: number };
    expect(body.count).toBe(3);
    // 行序 = ORDER BY players.id；俱乐部为空则省略中间段
    expect(body.roster.split('\n')).toEqual(['Erling Haaland|1|239085', 'Ederson|1|212602', 'M. Ødegaard|303']);
  });

  it('详情按 fc_id 解析：回内部 id 与 fcId，老链接的内部 id 仍能用，查不到 404', async () => {
    const fx = freshEnv();
    seedDisplay(fx.sqlite);
    const card = async (ref: string) => {
      const res = await get(`/api/players/${ref}`, fx.env);
      return { status: res.status, body: (await res.json()) as { player: { id: number; fcId: number | null; name: string; officialName: string } } };
    };

    const byFcId = await card('239085');
    expect(byFcId.status).toBe(200);
    expect(byFcId.body.player).toMatchObject({ id: 301, fcId: 239085, name: 'Erling Haaland', officialName: 'E. Haaland' });

    // 老分享链接/前端缓存里可能还是内部 id：回落分支必须还在，且指向同一个人
    const byId = await card('301');
    expect(byId.status).toBe(200);
    expect(byId.body.player.id).toBe(301);

    expect((await card('999999')).status).toBe(404);
  });

  it('转会记录与成长史两个子端点同样按 fc_id 解析（内部 id 也能用）', async () => {
    const fx = freshEnv();
    seedDisplay(fx.sqlite);
    const status = async (path: string) => (await get(path, fx.env)).status;

    expect(await status('/api/players/239085/transfers')).toBe(200);
    expect(await status('/api/players/301/transfers')).toBe(200);
    expect(await status('/api/players/999999/transfers')).toBe(404);

    const growth = await get('/api/players/239085/growth', fx.env);
    expect(growth.status).toBe(200);
    const growthBody = (await growth.json()) as { player: { id: number; name: string } };
    // 成长史按内部 id 读表，但名字同样出显示名
    expect(growthBody.player).toMatchObject({ id: 301, name: 'Erling Haaland' });
    expect(await status('/api/players/999999/growth')).toBe(404);
  });
});

// ---- v3.1.0：表头每一列可点（排序键扩到 28 个）+ 文本键游标 ----

// 期望顺序在 JS 侧独立重算：镜像的只有「权重表 + NULL 当 0」这两条口径，SQL 表达式不复用，
// 否则测试会跟着实现一起错。8 名球员刻意在多数维度上打平，逼出 (值, id) 复合序的平局分支。
const TICKS = 1; // 下面种了 1 个已关常规窗（另有 1 个临时窗不该被数）
const POSITION_WEIGHT: Record<string, number> = {
  GK: 1,
  RB: 2,
  CB: 2,
  LB: 2,
  CDM: 3,
  RM: 3,
  CM: 3,
  LM: 3,
  CAM: 3,
  RW: 4,
  ST: 4,
  LW: 4,
};
const STATUS_WEIGHT: Record<string, number> = { normal: 1, listed: 2, trainee: 3, free: 4, retired: 5 };

interface SortRow {
  id: number;
  uid: string;
  name: string;
  clubId: number | null;
  position: string | null;
  age: number | null;
  ca: number;
  pa: number;
  baseCa: number | null;
  growable: number;
  mv: number | null;
  status: string;
  badgeSilver: number;
  badgeGold: number;
  prestige: number | null;
  foot: number | null;
  growthTier: number;
  futureStar: number;
  chinaPlan: number;
  agentTier: number;
  fcId: number | null;
  psCount: number;
  wage: number | null;
  releaseFee: number | null;
  contractType: string | null;
  source: string | null;
  serviceTicks: number | null; // null = 无现行合同
  protectionTicks: number | null;
}

const SORT_VALUE: Record<string, (r: SortRow) => number | string> = {
  uid: (r) => Number(r.uid.replace(/^fc/, '')),
  name: (r) => foldName(r.name),
  club: (r) => r.clubId ?? 0,
  position: (r) => POSITION_WEIGHT[r.position ?? ''] ?? 0,
  age: (r) => r.age ?? 0,
  ca: (r) => r.ca,
  pa: (r) => r.pa,
  growable: (r) => r.growable,
  status: (r) => STATUS_WEIGHT[r.status] ?? 0,
  market_value: (r) => r.mv ?? 0,
  badges: (r) => r.badgeSilver + r.badgeGold,
  prestige: (r) => r.prestige ?? 0,
  base_ca: (r) => r.baseCa ?? 0,
  growth_gap: (r) => r.pa - r.ca,
  foot: (r) => r.foot ?? 0,
  growth_tier: (r) => r.growthTier,
  future_star: (r) => r.futureStar,
  china_plan: (r) => r.chinaPlan,
  agent_tier: (r) => r.agentTier,
  ps: (r) => r.psCount,
  fc_id: (r) => r.fcId ?? 0,
  wage: (r) => r.wage ?? 0,
  release_fee: (r) => r.releaseFee ?? 0,
  contract_type: (r) => r.contractType ?? '',
  source: (r) => r.source ?? '',
  protected: (r) => (r.protectionTicks !== null && TICKS < r.protectionTicks ? 1 : 0),
  years: (r) => (r.serviceTicks === null ? 0 : (TICKS - r.serviceTicks) * 0.5),
};

function seedSortRows(sqlite: DatabaseSync): SortRow[] {
  sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES
      (1, '老东家 FC', 'premier', 'active'),
      (2, '蓝月亮', 'premier', 'active'),
      (3, '雾都联', 'second', 'active');
    INSERT INTO season_windows (id, season, window_seq, status, opened_at, closed_at, is_temporary) VALUES
      (1, 9, 1, 'closed', '2026-09-18T01:00:00.000Z', '2026-09-18T01:01:00.000Z', 0),
      (2, 9, 2, 'closed', '2026-09-20T01:00:00.000Z', '2026-09-20T01:01:00.000Z', 1);
    INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, base_ca, growable, market_value, status,
                         badges_silver, badges_gold, prestige, foot, growth_tier, is_future_star, china_plan,
                         agent_tier, fc_id, game_attrs) VALUES
      (1, 'fc901',  'Šeško',    2,    'ST',  24, 70, 88, 60, 1, 50,   'normal',
       2, 1, 2, 2, 3, 1, 0, 1, 901,  '{"PSID1":5,"PSID3":7,"PSID15":101}'),
      (2, 'fc900',  'Ødegaard', NULL, 'CAM', 27, 85, 86, 80, 0, NULL, 'listed',
       0, 0, 4, 1, 1, 0, 1, 3, 900,  NULL),
      (3, 'fc1000', 'Alpha',    1,    'GK',  33, 60, 60, 60, 0, 10,   'free',
       0, 0, 1, 1, 1, 0, 0, 2, 1000, '{"PSID2":9}'),
      (4, 'fc902',  'A~B',      1,    'LB',  21, 66, 90, 66, 1, 20,   'trainee',
       3, 0, 1, 2, 2, 1, 0, 1, 902,  '{"PSID1":5,"PSID2":6}'),
      (5, 'fc903',  '阿尔法',   3,    'CDM', 19, 72, 95, 50, 1, 120,  'normal',
       1, 2, 3, 1, 4, 1, 1, 3, 903,  NULL),
      (6, 'fc904',  'Müller',   3,    'RW',  25, 88, 88, 88, 0, 200,  'normal',
       0, 0, 5, 1, 1, 0, 0, 2, 904,  '{"PSID5":11}'),
      (7, 'fc905',  'zeta',     2,    'CM',  30, 80, 85, 70, 1, 30,   'normal',
       2, 0, 2, 2, 3, 0, 1, 1, 905,
       '{"PSID1":1,"PSID2":2,"PSID3":3,"PSID4":4,"PSID5":5,"PSID6":6,"PSID7":7,"PSID8":8,"PSID9":9,"PSID10":10,"PSID11":11,"PSID12":12,"PSID13":113,"PSID14":114,"PSID15":115}'),
      (8, 'fc906',  'ŠEŠKO',    NULL, 'CB',  22, 90, 90, 90, 0, 300,  'retired',
       0, 3, 4, 1, 1, 0, 0, 2, 906,  NULL);
    INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, source, is_active,
                           signed_at, effective_from, service_ticks, protection_ticks) VALUES
      (1, 1, 2,    5,  2,    'formal',  'import',      1, '2026-09-21T01:46:58.647Z', '2026-09-18', 1,  4),
      (2, 2, NULL, 30, 0.75, 'trainee', 'direct',      1, '2026-09-21T01:46:58.647Z', '2026-09-18', 2,  NULL),
      (3, 7, 2,    80, 8,    'formal',  'negotiation', 1, '2026-09-21T01:46:58.647Z', '2026-09-18', -1, 2),
      (4, 8, NULL, 10, 1.5,  'formal',  'forced',      1, '2026-09-21T01:46:58.647Z', '2026-09-18', 1,  4);
  `);
  return [
    { id: 1, uid: 'fc901', name: 'Šeško', clubId: 2, position: 'ST', age: 24, ca: 70, pa: 88, baseCa: 60, growable: 1, mv: 50, status: 'normal', badgeSilver: 2, badgeGold: 1, prestige: 2, foot: 2, growthTier: 3, futureStar: 1, chinaPlan: 0, agentTier: 1, fcId: 901, psCount: 3, wage: 2, releaseFee: 5, contractType: 'formal', source: 'import', serviceTicks: 1, protectionTicks: 4 },
    { id: 2, uid: 'fc900', name: 'Ødegaard', clubId: null, position: 'CAM', age: 27, ca: 85, pa: 86, baseCa: 80, growable: 0, mv: null, status: 'listed', badgeSilver: 0, badgeGold: 0, prestige: 4, foot: 1, growthTier: 1, futureStar: 0, chinaPlan: 1, agentTier: 3, fcId: 900, psCount: 0, wage: 0.75, releaseFee: 30, contractType: 'trainee', source: 'direct', serviceTicks: 2, protectionTicks: null },
    { id: 3, uid: 'fc1000', name: 'Alpha', clubId: 1, position: 'GK', age: 33, ca: 60, pa: 60, baseCa: 60, growable: 0, mv: 10, status: 'free', badgeSilver: 0, badgeGold: 0, prestige: 1, foot: 1, growthTier: 1, futureStar: 0, chinaPlan: 0, agentTier: 2, fcId: 1000, psCount: 1, wage: null, releaseFee: null, contractType: null, source: null, serviceTicks: null, protectionTicks: null },
    { id: 4, uid: 'fc902', name: 'A~B', clubId: 1, position: 'LB', age: 21, ca: 66, pa: 90, baseCa: 66, growable: 1, mv: 20, status: 'trainee', badgeSilver: 3, badgeGold: 0, prestige: 1, foot: 2, growthTier: 2, futureStar: 1, chinaPlan: 0, agentTier: 1, fcId: 902, psCount: 2, wage: null, releaseFee: null, contractType: null, source: null, serviceTicks: null, protectionTicks: null },
    { id: 5, uid: 'fc903', name: '阿尔法', clubId: 3, position: 'CDM', age: 19, ca: 72, pa: 95, baseCa: 50, growable: 1, mv: 120, status: 'normal', badgeSilver: 1, badgeGold: 2, prestige: 3, foot: 1, growthTier: 4, futureStar: 1, chinaPlan: 1, agentTier: 3, fcId: 903, psCount: 0, wage: null, releaseFee: null, contractType: null, source: null, serviceTicks: null, protectionTicks: null },
    { id: 6, uid: 'fc904', name: 'Müller', clubId: 3, position: 'RW', age: 25, ca: 88, pa: 88, baseCa: 88, growable: 0, mv: 200, status: 'normal', badgeSilver: 0, badgeGold: 0, prestige: 5, foot: 1, growthTier: 1, futureStar: 0, chinaPlan: 0, agentTier: 2, fcId: 904, psCount: 1, wage: null, releaseFee: null, contractType: null, source: null, serviceTicks: null, protectionTicks: null },
    { id: 7, uid: 'fc905', name: 'zeta', clubId: 2, position: 'CM', age: 30, ca: 80, pa: 85, baseCa: 70, growable: 1, mv: 30, status: 'normal', badgeSilver: 2, badgeGold: 0, prestige: 2, foot: 2, growthTier: 3, futureStar: 0, chinaPlan: 1, agentTier: 1, fcId: 905, psCount: 15, wage: 8, releaseFee: 80, contractType: 'formal', source: 'negotiation', serviceTicks: -1, protectionTicks: 2 },
    { id: 8, uid: 'fc906', name: 'ŠEŠKO', clubId: null, position: 'CB', age: 22, ca: 90, pa: 90, baseCa: 90, growable: 0, mv: 300, status: 'retired', badgeSilver: 0, badgeGold: 3, prestige: 4, foot: 1, growthTier: 1, futureStar: 0, chinaPlan: 0, agentTier: 2, fcId: 906, psCount: 0, wage: 1.5, releaseFee: 10, contractType: 'formal', source: 'forced', serviceTicks: 1, protectionTicks: 4 },
  ];
}

function expectedOrder(rows: SortRow[], key: string, dir: 'asc' | 'desc'): number[] {
  const value = SORT_VALUE[key]!;
  return [...rows]
    .sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      let cmp = 0;
      if (typeof av === 'string' || typeof bv === 'string') {
        cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
      } else {
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      return dir === 'asc' ? a.id - b.id : b.id - a.id; // 平局按 id，方向与主键一致（与 SQL 的 ORDER BY … , players.id 同）
    })
    .map((r) => r.id);
}

async function pageAll(key: string, dir: 'asc' | 'desc', env: Env, size: number): Promise<{ ids: number[]; pages: number }> {
  const ids: number[] = [];
  let cursor: string | null = null;
  for (let pages = 1; pages <= 20; pages++) {
    const cursorQs = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const body = await list(`/api/players?sort=${key}&order=${dir}&limit=${size}${cursorQs}`, env);
    ids.push(...body.players.map((p) => p.id));
    cursor = body.nextCursor;
    if (cursor === null) return { ids, pages };
  }
  throw new Error(`排序键 ${key} 的游标翻页没有终止（疑似漏行/死循环）`);
}

describe('球员库排序键（v3.1.0）', () => {
  it('除 id 外的 27 个键 × 升降两向：翻页不重不漏，顺序与 JS 侧独立重算一致', async () => {
    const fx = freshEnv();
    const rows = seedSortRows(fx.sqlite);
    const keys = Object.keys(SORT_VALUE);
    expect(keys.length).toBe(27); // id 走旧的整数游标，另有既有用例覆盖

    for (const key of keys) {
      for (const dir of ['asc', 'desc'] as const) {
        // 公开 GET 限流是 60 请求/60 秒/IP（guard.ts），27 键 × 两向 × 3 页远超额度；
        // 这里清进程内计数而不是放宽额度——限流本身另有守护用例
        resetGuards();
        const actual = await pageAll(key, dir, fx.env, 3);
        // 8 人 / 每页 3 条 ⇒ 3 页，确保真的经过了游标（而不是一页拿完）
        expect({ key, dir, ...actual }).toEqual({ key, dir, ids: expectedOrder(rows, key, dir), pages: 3 });
      }
    }
  });

  it('属性列排序：attr:<属性键> 过白名单、走数值游标、翻页不重不漏', async () => {
    const fx = freshEnv();
    seedSortRows(fx.sqlite);
    // 只给 6 行塞属性值，另 2 行没有这个键（NULL 当 0，与其它数值键同口径）
    for (const [id, v] of [
      [1, 80],
      [4, 80],
      [2, 50],
      [5, 50],
      [3, 65],
      [6, 65],
    ] as const) {
      fx.sqlite.exec(`UPDATE players SET game_attrs = json_set(COALESCE(game_attrs, '{}'), '$.sprintspeed', ${v}) WHERE id = ${id}`);
    }

    // 同一档位按 id 定序，方向与主键一致（ORDER BY keyExpr dir, players.id dir）
    resetGuards();
    expect(await pageAll('attr:sprintspeed', 'desc', fx.env, 3)).toEqual({ ids: [4, 1, 6, 3, 5, 2, 8, 7], pages: 3 });
    resetGuards();
    expect(await pageAll('attr:sprintspeed', 'asc', fx.env, 100)).toEqual({ ids: [7, 8, 2, 5, 3, 6, 1, 4], pages: 1 });

    // 白名单外的属性键（含塞注入串）必须拒掉；固定键不受影响
    resetGuards();
    expect((await get('/api/players?sort=attr:nope', fx.env)).status).toBe(400);
    expect((await get(`/api/players?sort=attr:${encodeURIComponent("x') OR 1=1--")}`, fx.env)).status).toBe(400);
    expect((await get('/api/players?sort=uid&limit=1', fx.env)).status).toBe(200);
  });

  it('文本键游标：值里带 ~ 时从最后一个 ~ 切；文本/数值键的游标互不串', async () => {
    const fx = freshEnv();
    seedSortRows(fx.sqlite);
    // 折名序列（升）：alpha(3) < a~b(4) < muller(6) < odegaard(2) < sesko(1) < sesko(8) < zeta(7) < 阿尔法(5)
    const after = await list(`/api/players?sort=name&order=asc&limit=1&cursor=${encodeURIComponent('a~b~4')}`, fx.env);
    expect(after.players.map((p) => p.id)).toEqual([6]);

    // 折名相同的两条（1/8）靠 id 定序：降序时 8 在前
    const dupes = await list('/api/players?sort=name&order=desc&limit=2', fx.env);
    expect(dupes.players.map((p) => p.id)).toEqual([5, 7]);

    // 超长文本值、没有 ~、数值键吃文本值——都按坏游标拒掉
    expect((await get(`/api/players?sort=name&cursor=${encodeURIComponent(`${'a'.repeat(200)}~4`)}`, fx.env)).status).toBe(400);
    expect((await get('/api/players?sort=name&cursor=没有波浪号', fx.env)).status).toBe(400);
    expect((await get(`/api/players?sort=ca&cursor=${encodeURIComponent('sesko~7')}`, fx.env)).status).toBe(400);
  });

  it('view=initial 下 ca / growth_gap 换成初始口径（base_ca 与 $.PA）', async () => {
    const fx = freshEnv();
    const rows = seedSortRows(fx.sqlite);
    const idsOf = (path: string) =>
      list(path, fx.env).then((body) => body.players.map((p) => p.id));
    const byInitialCa = await idsOf('/api/players?view=initial&sort=ca&order=asc&limit=100');
    const initialCa = [...rows].sort((a, b) => (a.baseCa ?? 0) - (b.baseCa ?? 0) || a.id - b.id).map((r) => r.id);
    // 现值口径下 CA 升序是 [3,4,1,5,7,2,6,8]，初始口径是 base_ca 升序，两者必须不同才说明切了口径
    const currentCa = await idsOf('/api/players?sort=ca&order=asc&limit=100');
    expect(currentCa).toEqual([...rows].sort((a, b) => a.ca - b.ca || a.id - b.id).map((r) => r.id));
    expect(currentCa).not.toEqual(initialCa);
    expect(byInitialCa).toEqual(initialCa);

    const initGap = await idsOf('/api/players?view=initial&sort=growth_gap&order=asc&limit=100');
    const expectedGap = [...rows]
      .sort((a, b) => a.pa - (a.baseCa ?? 0) - (b.pa - (b.baseCa ?? 0)) || a.id - b.id)
      .map((r) => r.id);
    expect(initGap).toEqual(expectedGap);
  });
});

