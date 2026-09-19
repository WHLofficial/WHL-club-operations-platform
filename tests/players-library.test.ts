// 球员库列表（增量 6.1 d6）：筛选（position/name/growable/CA·PA·年龄区间）、数值键 keyset 排序翻页、参数校验
// + view=initial 的导入时口径（CA=base_ca、PA=导入值）；initial_club_id 已在增量 14 裁决 4 删除
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, runMigration } from './d1.ts';
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

    // 初始视图只改 CA/PA 口径，归属仍看 players.club_id（增量 14 裁决 4 删掉 initial_club_id）
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
    expect((await get('/api/players?sort=uid', fx.env)).status).toBe(400);
    expect((await get('/api/players?growable=yes', fx.env)).status).toBe(400);
    expect((await get('/api/players?sort=ca&cursor=oops', fx.env)).status).toBe(400);
    expect((await get('/api/players?ca_min=-1', fx.env)).status).toBe(400);
    expect((await get('/api/players?name=', fx.env)).status).toBe(400);
  });
});

describe('初始归属字段的兴废（增量 6.1 d7 加、增量 14 裁决 4 删）', () => {
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

// ---- 增量 17：total 计数、影响力、多位置、属性/徽章/合同维度筛选 ----

interface ListBody17 {
  players: {
    id: number;
    positions: string[];
    influence: number;
    wage: number | null;
    releaseFee: number | null;
    contractType: string | null;
  }[];
  total: number;
  nextCursor: string | null;
}

async function list17(path: string, env: Env): Promise<ListBody17> {
  const res = await get(path, env);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody17;
}

// 影响力手算依据（规则 4.1.2 十档 + 4.1.3 系数 0.25/0.13）：
//   tier: >=93→10 >=90→9 >=87→8 >=84→7 >=80→6 >=75→5 >=70→4 >=65→3 >=60→2 else 1
//   可成长=(CA档+PA档)/2×0.25×声望；非成长=CA档×0.13×声望
describe('球员库 total 与新筛选（增量 17）', () => {
  it('total 返回筛选后的总数，不随 cursor 变', async () => {
    const fx = freshEnv();
    seedPlayers(fx.sqlite);
    expect((await list17('/api/players', fx.env)).total).toBe(8);
    expect((await list17('/api/players?position=GK', fx.env)).total).toBe(2);
    const paged = await list17('/api/players?limit=3', fx.env);
    expect(paged.total).toBe(8);
    expect(paged.players.length).toBe(3);
    const next = await list17(`/api/players?limit=3&cursor=${paged.nextCursor}`, fx.env);
    expect(next.total).toBe(8);
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
    expect(gated.total).toBe(3);
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
        (29, 'a2', '中场', '{"finishing":62,"vision":91}');
    `);
    const finishers = await list17('/api/players?attr=finishing&attr_min=80', fx.env);
    expect(finishers.players.map((p) => p.id)).toEqual([28]);
    expect(finishers.total).toBe(1);
    const vision = await list17('/api/players?attr=vision&attr_max=80', fx.env);
    expect(vision.players.map((p) => p.id)).toEqual([28]);
    expect((await get('/api/players?attr=nosuchkey&attr_min=1', fx.env)).status).toBe(400);
    expect((await get('/api/players?attr=finishing', fx.env)).status).toBe(400);
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
      INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, protected_until, is_active) VALUES
        (41, 1, NULL, 5.5, 'formal', 'negotiation', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z', '2027-06-30T00:00:00Z', 1),
        (43, 1, 10, 0.75, 'trainee', 'import', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', NULL, 1);
    `);
    expect((await list17('/api/players?has_contract=1', fx.env)).players.map((p) => p.id)).toEqual([41, 43]);
    expect((await list17('/api/players?has_contract=0', fx.env)).players.map((p) => p.id)).toEqual([42]);
    expect((await list17('/api/players?wage_min=5', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?release_fee_none=1', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?contract_type=trainee', fx.env)).players.map((p) => p.id)).toEqual([43]);
    expect((await list17('/api/players?source=negotiation', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?protected=in', fx.env)).players.map((p) => p.id)).toEqual([41]);
    expect((await list17('/api/players?protected=out', fx.env)).players.map((p) => p.id)).toEqual([42, 43]);
    expect((await list17('/api/players?effective_years_min=3', fx.env)).players.map((p) => p.id)).toEqual([41]);
    // 响应带现行合同速览
    const withContract = await list17('/api/players?name=有合同', fx.env);
    expect(withContract.players[0]!.wage).toBe(5.5);
    expect(withContract.players[0]!.releaseFee).toBeNull();
    expect(withContract.players[0]!.contractType).toBe('formal');
  });

  it('PlayStyle 多选：银槽基础 ID 与金槽 ID+100 都命中；非法值 400', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`
      INSERT INTO players (id, uid, name, game_attrs) VALUES
        (51, 's1', '银槽搓射', '{"PSID1":1,"PSID2":5}'),
        (52, 's2', '金槽吊射', '{"PSID13":102}'),
        (53, 's3', '无徽', NULL);
    `);
    expect((await list17('/api/players?ps=1', fx.env)).players.map((p) => p.id)).toEqual([51]);
    expect((await list17('/api/players?ps=2', fx.env)).players.map((p) => p.id)).toEqual([52]); // 102=2+100
    expect((await list17('/api/players?ps=1,5', fx.env)).players.map((p) => p.id)).toEqual([51]);
    expect((await list17('/api/players?ps=9', fx.env)).players.map((p) => p.id)).toEqual([]);
    expect((await get('/api/players?ps=0', fx.env)).status).toBe(400);
    expect((await get('/api/players?ps=abc', fx.env)).status).toBe(400);
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
    expect((await get('/api/players?sort=uid', fx.env)).status).toBe(400);
  });
});
