// v6.26.0 消费中心（D1）：六类商品提交校验矩阵 / 相邻判定 / 扣费退款原子性 / 审批重校验与
// 状态闸 / 外部工单两步流 / json_set 空槽语义 / 导入台账重放幂等 / 相邻表与 ref 同值锁。
// 用例编号对应 docs/test-plans/v6.26.0-shop.md（TC-A/B/C）。
import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { POSITION_ADJACENCY, ROLE_POSITION_BY_ID, ROLE_BASE_NAMES, SHOP_PS_NAMES } from '../src/core/shop.ts';
import { confirmImport } from '../src/worker/players-import.ts';
import { prepareShopPlan } from '../src/worker/shop-ops.ts';
import roleRef from '../web/assets/ref/role.json';
import playstyleRef from '../web/assets/ref/playstyle.json';
import positionRef from '../web/assets/ref/position.json';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
  kv: Map<string, string>;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0), (2, '管理组甲', 'admin', 0, 0);`,
  );
  const { sqlite: authSqlite, d1: authD1 } = createAuthDb();
  const kv = new Map<string, string>();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: authD1,
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    rng: () => 0.5,
  } as unknown as Env;
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  kv.set('sess:tok-admin', JSON.stringify({ userId: 2 }));
  return { env, sqlite, tour, auth: authSqlite, kv };
}

const COACH = 'whl_session=tok-coach';
const ADMIN = 'whl_session=tok-admin';

function seedClub(fx: Fixture, clubId: number, balance = 50, bindCoach = true) {
  fx.sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`).run(clubId, `俱乐部${clubId}`);
  fx.sqlite
    .prepare(`INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`)
    .run(clubId, balance);
  authRegisterClubTeam(fx.auth, clubId, clubId, `队${clubId}`);
  // 教练（userId 1）绑到该俱乐部（getBoundClub 走 AUTH_DB team_binding；account_id 唯一，别队用例传 false）
  if (!bindCoach) return;
  const team = fx.auth.prepare('SELECT id FROM team WHERE club_id = ?').get(clubId) as { id: number };
  fx.auth
    .prepare(`INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (?, ?, 'web', '2026-01-01T00:00:00Z')`)
    .run(1, team.id);
}

interface PlayerOpts {
  clubId?: number | null;
  growable?: number;
  pa?: number;
  position?: string;
  gameAttrs?: Record<string, unknown>;
  status?: string;
}

function seedPlayer(fx: Fixture, id: number, opts: PlayerOpts = {}) {
  fx.sqlite
    .prepare(
      `INSERT INTO players (uid, name, ca, pa, age, foot, position, club_id, growable, status, fc_id, base_ca, game_attrs, created_at, updated_at)
       VALUES (?, ?, 80, ?, 24, 1, ?, ?, ?, ?, ?, 80, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run(
      `u${id}`,
      `球员${id}`,
      opts.pa ?? 88,
      opts.position ?? 'ST',
      opts.clubId === undefined ? 101 : opts.clubId,
      opts.growable ?? 1,
      opts.status ?? 'normal',
      id,
      JSON.stringify(opts.gameAttrs ?? { PosID1: 25 }),
    );
}

async function coachPost(fx: Fixture, body: unknown, cookie = COACH) {
  return app.request(
    '/api/shop/orders',
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) },
    fx.env,
  );
}

async function approve(fx: Fixture, orderId: number, body?: unknown) {
  return app.request(
    `/api/admin/shop/orders/${orderId}/approve`,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: ADMIN }, body: JSON.stringify(body ?? {}) },
    fx.env,
  );
}

async function reject(fx: Fixture, orderId: number, reason: string) {
  return app.request(
    `/api/admin/shop/orders/${orderId}/reject`,
    { method: 'POST', headers: { 'content-type': 'application/json', Cookie: ADMIN }, body: JSON.stringify({ reason }) },
    fx.env,
  );
}

function balanceOf(fx: Fixture, clubId: number): number {
  return (fx.sqlite.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?').get(clubId) as { balance: number }).balance;
}

function gameAttrsOf(fx: Fixture, playerId: number): Record<string, unknown> {
  const raw = (fx.sqlite.prepare('SELECT game_attrs FROM players WHERE id = ?').get(playerId) as { game_attrs: string }).game_attrs;
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  resetConfigCache();
});

// ---------------------------------------------------------------------------
// TC-A：提交校验矩阵

describe('TC-A 买 PA：校验、扣费与守卫', () => {
  it('TC-A01 合法提交：扣费 + pending 单 + 金额=点数×单价', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, growable: 1, pa: 88 });
    const res = await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 2 } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { order: { status: string; amount: number }; summary: string };
    expect(body.order.status).toBe('pending');
    expect(body.order.amount).toBe(30);
    expect(balanceOf(fx, 101)).toBe(20);
    const kinds = fx.sqlite.prepare("SELECT amount FROM ledger_entries WHERE kind = 'shop_purchase'").all() as { amount: number }[];
    expect(kinds).toHaveLength(1);
    expect(kinds[0].amount).toBe(-30);
  });

  it('TC-A02 非可成长 400；PA 超版本上限 400', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, growable: 0 });
    seedPlayer(fx, 2, { clubId: 101, growable: 1, pa: 94 });
    expect((await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 1 } })).status).toBe(400);
    expect((await coachPost(fx, { category: 'pa', payload: { playerId: 2, points: 2 } })).status).toBe(400);
    // 边界：94 + 1 = 95 = 上限，合法
    expect((await coachPost(fx, { category: 'pa', payload: { playerId: 2, points: 1 } })).status).toBe(201);
  });

  it('TC-A03 别队球员 400；不存在 404', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedClub(fx, 102, 50, false);
    seedPlayer(fx, 1, { clubId: 102 });
    expect((await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 1 } })).status).toBe(400);
    expect((await coachPost(fx, { category: 'pa', payload: { playerId: 99, points: 1 } })).status).toBe(404);
  });

  it('TC-A04 余额不足 400，且工单行被删除', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 5);
    seedPlayer(fx, 1, { clubId: 101 });
    const res = await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 1 } });
    expect(res.status).toBe(400);
    const n = (fx.sqlite.prepare('SELECT COUNT(*) AS n FROM shop_orders').get() as { n: number }).n;
    expect(n).toBe(0);
    expect(balanceOf(fx, 101)).toBe(5);
  });
});

describe('TC-A 徽章：白名单 / 重复 / 槽满', () => {
  it('TC-A05 FC 源已有该银徽 400；白名单外 400；合法购买落最小空槽并涨台账', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    // FC 源银槽 1 = psid 1（存库金段才 +100，银段原样）
    seedPlayer(fx, 1, { clubId: 101, gameAttrs: { PosID1: 25, PSID1: 1 } });
    expect((await coachPost(fx, { category: 'badge', payload: { playerId: 1, kind: 'silver', psid: 1 } })).status).toBe(400);
    expect((await coachPost(fx, { category: 'badge', payload: { playerId: 1, kind: 'silver', psid: 99 } })).status).toBe(400);
    const res = await coachPost(fx, { category: 'badge', payload: { playerId: 1, kind: 'silver', psid: 2 } });
    expect(res.status).toBe(201);
    const orderId = ((await res.json()) as { order: { id: number } }).order.id;
    expect((await approve(fx, orderId)).status).toBe(200);
    const row = fx.sqlite
      .prepare("SELECT slot, kind, psid, source FROM player_playstyles WHERE player_id = 1")
      .get() as { slot: number; kind: string; psid: number; source: string };
    // FC 源占了银槽 1，发放落最小空槽 2
    expect(row).toEqual({ slot: 2, kind: 'silver', psid: 2, source: 'shop' });
    const counts = fx.sqlite.prepare('SELECT badges_silver AS s, badges_gold AS g FROM players WHERE id = 1').get() as { s: number; g: number };
    expect(counts.s).toBe(1);
    expect(counts.g).toBe(0);
  });

  it('TC-A05b 银槽满 12 拒', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    const attrs: Record<string, unknown> = { PosID1: 25 };
    for (let i = 1; i <= 12; i += 1) attrs[`PSID${i}`] = i;
    seedPlayer(fx, 1, { clubId: 101, gameAttrs: attrs });
    expect((await coachPost(fx, { category: 'badge', payload: { playerId: 1, kind: 'silver', psid: 31 } })).status).toBe(400);
  });

  it('TC-A06 银升金：无银徽 400、金槽满 400、合法升级换段换槽', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, gameAttrs: { PosID1: 25 } });
    expect((await coachPost(fx, { category: 'badge_upgrade', payload: { playerId: 1, psid: 3 } })).status).toBe(400);
    // 发放一银徽（slot 1）
    fx.sqlite
      .prepare(`INSERT INTO player_playstyles (player_id, slot, kind, psid, source, created_at) VALUES (1, 1, 'silver', 3, 'manual', '2026-01-01T00:00:00Z')`)
      .run();
    // 金段塞满（FC 源金槽 13-15）
    fx.sqlite
      .prepare(`UPDATE players SET game_attrs = json_set(game_attrs, '$.PSID13', 101, '$.PSID14', 102, '$.PSID15', 103) WHERE id = 1`)
      .run();
    expect((await coachPost(fx, { category: 'badge_upgrade', payload: { playerId: 1, psid: 3 } })).status).toBe(400);
    fx.sqlite.prepare(`UPDATE players SET game_attrs = json_set(game_attrs, '$.PSID15', json('null')) WHERE id = 1`).run();
    const res = await coachPost(fx, { category: 'badge_upgrade', payload: { playerId: 1, psid: 3 } });
    expect(res.status).toBe(201);
    const orderId = ((await res.json()) as { order: { id: number } }).order.id;
    expect((await approve(fx, orderId)).status).toBe(200);
    const row = fx.sqlite.prepare('SELECT slot, kind, psid FROM player_playstyles WHERE player_id = 1').get() as { slot: number; kind: string; psid: number };
    expect(row).toEqual({ slot: 15, kind: 'gold', psid: 3 });
    const counts = fx.sqlite.prepare('SELECT badges_silver AS s, badges_gold AS g FROM players WHERE id = 1').get() as { s: number; g: number };
    expect(counts.s).toBe(0);
    expect(counts.g).toBe(1);
  });
});

describe('TC-A 角色：热区归属 / 重复 / 槽位', () => {
  function seedRolePlayer(fx: Fixture) {
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, {
      clubId: 101,
      gameAttrs: { PosID1: 25, PosID2: 18, RoleID1: 41 }, // 热区 ST/CAM，已有 ST 突前前锋 +
    });
  }

  it('TC-A07 归属位置不在热区 400；同角色重复 400；GK 角色不可达；+/++ 价目区分', async () => {
    const fx = freshEnv();
    seedRolePlayer(fx);
    // CM 角色（18 全能中场）不在 ST/CAM 热区
    expect((await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 18 } })).status).toBe(400);
    // ST 的 ++（141）：基础段 41 已存在 → 重复
    expect((await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 141 } })).status).toBe(400);
    // GK 角色（1 门将）：热区永远不含 GK
    expect((await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 1 } })).status).toBe(400);
    // CAM 单加号 5m
    const plus = await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 31 } });
    expect(plus.status).toBe(201);
    expect(((await plus.json()) as { order: { amount: number } }).order.amount).toBe(5);
    // CAM 双加号 12m（另起一库）
    const fx2 = freshEnv();
    seedRolePlayer(fx2);
    const plusPlus = await coachPost(fx2, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 131 } });
    expect(((await plusPlus.json()) as { order: { amount: number } }).order.amount).toBe(12);
  });

  it('TC-A07b 五槽满 400', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, {
      clubId: 101,
      gameAttrs: { PosID1: 25, PosID2: 18, RoleID1: 41, RoleID2: 31, RoleID3: 42, RoleID4: 32, RoleID5: 43 },
    });
    expect((await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 33 } })).status).toBe(400);
  });

  it('TC-A08 upgrade：++ 槽 400；remove 空槽 400；合法 upgrade 单→双', async () => {
    const fx = freshEnv();
    seedRolePlayer(fx);
    fx.sqlite.prepare(`UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID2', 131) WHERE id = 1`).run();
    // 槽 2 已是双加号
    expect((await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'upgrade', slot: 2 } })).status).toBe(400);
    // 槽 3 空
    expect((await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'remove', slot: 3 } })).status).toBe(400);
    const res = await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'upgrade', slot: 1 } });
    expect(res.status).toBe(201);
    const orderId = ((await res.json()) as { order: { id: number } }).order.id;
    expect((await approve(fx, orderId)).status).toBe(200);
    expect(gameAttrsOf(fx, 1).RoleID1).toBe(141);
  });
});

describe('TC-A 位置热区：GK 锁 / 相邻判定 / 连带清角色', () => {
  it('TC-A09 主位 GK 全拒；slot=1 拒；GK 不可被新增', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, position: 'GK', gameAttrs: { PosID1: 0 } });
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 3 } })).status).toBe(400);
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'remove', slot: 2 } })).status).toBe(400);
    const fx2 = freshEnv();
    seedClub(fx2, 101, 50);
    seedPlayer(fx2, 1, { clubId: 101, gameAttrs: { PosID1: 25 } });
    expect((await coachPost(fx2, { category: 'position', payload: { playerId: 1, action: 'add', slot: 1, posId: 3 } })).status).toBe(400);
    expect((await coachPost(fx2, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 0 } })).status).toBe(400);
  });

  it('TC-A09b2 GK 锁是唯一拦截者：主位 GK + 槽 2 已有位置时 remove 仍 400', async () => {
    // 其余守卫（空槽 / 相邻判定 / GK 不可新增）都拦不住这条路径，删掉 GK 锁该用例必红（变异 M5）
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, position: 'GK', gameAttrs: { PosID1: 0, PosID2: 5 } });
    const res = await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'remove', slot: 2 } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('门将');
  });

  it('TC-A09b 相邻判定：重复 400；LM↛RW 400；LB→CDM / LW→CAM 错位相邻合法', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, gameAttrs: { PosID1: 16 } }); // 主位 LM
    // 已有（重复：新增 LM）
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 16 } })).status).toBe(400);
    // LM 的邻表是 LW/CAM/CM/CDM/LB —— RW 不相邻
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 23 } })).status).toBe(400);
    // LB 相邻（错位边）
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 7 } })).status).toBe(201);
    const fx2 = freshEnv();
    seedClub(fx2, 101, 50);
    seedPlayer(fx2, 1, { clubId: 101, gameAttrs: { PosID1: 27 } }); // 主位 LW
    // LW-CAM 是错位相邻边
    expect((await coachPost(fx2, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 18 } })).status).toBe(201);
    // LB 主位 + CDM：错位相邻
    const fx3 = freshEnv();
    seedClub(fx3, 101, 50);
    seedPlayer(fx3, 1, { clubId: 101, gameAttrs: { PosID1: 7 } });
    expect((await coachPost(fx3, { category: 'position', payload: { playerId: 1, action: 'add', slot: 2, posId: 10 } })).status).toBe(201);
  });

  it('TC-A10 replace：同位置 400；替换后重复 400；不相邻 400', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    // 主位 ST + 槽 2 CAM；把槽 2 换成 ST（=主位重复）400
    seedPlayer(fx, 1, { clubId: 101, gameAttrs: { PosID1: 25, PosID2: 18 } });
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'replace', slot: 2, posId: 25 } })).status).toBe(400);
    // 把槽 2 换成 RM：ST/RM 不相邻 400
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'replace', slot: 2, posId: 12 } })).status).toBe(400);
    // 把槽 2 换成 RW（ST-RW 相邻）合法
    expect((await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'replace', slot: 2, posId: 23 } })).status).toBe(201);
  });

  it('TC-A11 remove 连带清该位置上的角色（C01：空槽写 JSON null）', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, {
      clubId: 101,
      gameAttrs: { PosID1: 25, PosID2: 18, RoleID1: 41, RoleID2: 31 }, // CAM 角色挂在槽 2
    });
    const res = await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'remove', slot: 2 } });
    expect(res.status).toBe(201);
    const orderId = ((await res.json()) as { order: { id: number } }).order.id;
    expect((await approve(fx, orderId)).status).toBe(200);
    const attrs = gameAttrsOf(fx, 1);
    expect(attrs.PosID2).toBeNull();
    expect(attrs.RoleID2).toBeNull(); // CAM 角色连带去除
    expect(attrs.RoleID1).toBe(41); // ST 角色不动
    // 台账行记录了清除
    const purchase = fx.sqlite.prepare(`SELECT value_json FROM player_purchases WHERE order_id = ?`).get(orderId) as { value_json: string };
    expect(JSON.parse(purchase.value_json)).toMatchObject({ slot: 2, posId: null, prevPosId: 18, clearedRoleSlots: [2] });
  });
});

describe('TC-A 队壳申请', () => {
  it('TC-A12 豪门 403；pending 上限 409；合法提交与通过（壳名备注）', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    // 正常提交两张 → 第二张 409
    const first = await coachPost(fx, { category: 'club_shell', payload: { note: '想要个上游队壳' } });
    expect(first.status).toBe(201);
    expect((await coachPost(fx, { category: 'club_shell', payload: {} })).status).toBe(409);
    // 通过带壳名备注
    const orderId = ((await first.json()) as { order: { id: number } }).order.id;
    const ap = await approve(fx, orderId, { note: '交付壳：AC 米兰二队' });
    expect(ap.status).toBe(200);
    const note = (fx.sqlite.prepare('SELECT note FROM shop_orders WHERE id = ?').get(orderId) as { note: string | null }).note;
    expect(note).toBe('交付壳：AC 米兰二队');
    // 豪门拦截：101 进 shop_hpremium_clubs 后再提交 → 403
    fx.sqlite.prepare(`UPDATE config SET value = '[101]' WHERE key = 'shop_hpremium_clubs'`).run();
    resetConfigCache();
    expect((await coachPost(fx, { category: 'club_shell', payload: {} })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// TC-B：审批 / 拒绝 / 并发 / 外部两步流

describe('TC-B 审批与拒绝', () => {
  it('TC-B02 已处理单再审批 / 再拒绝 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101 });
    const orderId = ((await (await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 1 } })).json() as { order: { id: number } }).order.id);
    expect((await approve(fx, orderId)).status).toBe(200);
    expect((await approve(fx, orderId)).status).toBe(409);
    expect((await reject(fx, orderId, '晚了')).status).toBe(409);
  });

  it('TC-B03 拒绝退款（幂等：重复拒绝只退一次）', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101 });
    const orderId = ((await (await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 3 } })).json() as { order: { id: number } }).order.id);
    expect(balanceOf(fx, 101)).toBe(5);
    expect((await reject(fx, orderId, '价格不合适')).status).toBe(200);
    expect(balanceOf(fx, 101)).toBe(50);
    const refunds = fx.sqlite
      .prepare("SELECT amount FROM ledger_entries WHERE kind = 'shop_purchase' AND ref_type = 'shop_refund'")
      .all() as { amount: number }[];
    expect(refunds).toEqual([{ amount: 45 }]);
    // 再拒 409，余额不变
    expect((await reject(fx, orderId, '再拒一次')).status).toBe(409);
    expect(balanceOf(fx, 101)).toBe(50);
  });

  it('TC-B04 审批重校验：球员离队后 409 shop_order_stale，不静默转拒', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101 });
    const orderId = ((await (await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 1 } })).json() as { order: { id: number } }).order.id);
    // 球员离队
    fx.sqlite.prepare(`UPDATE players SET club_id = NULL, status = 'free' WHERE id = 1`).run();
    const res = await approve(fx, orderId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('shop_order_stale');
    // 工单仍是 pending、PA 没动
    const row = fx.sqlite.prepare('SELECT status FROM shop_orders WHERE id = ?').get(orderId) as { status: string };
    expect(row.status).toBe('pending');
    expect((fx.sqlite.prepare('SELECT pa FROM players WHERE id = 1').get() as { pa: number }).pa).toBe(88);
  });

  it('TC-B05 状态闸：status 已非 pending 时效果守卫不再执行（无重复 PA）', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, pa: 88 });
    const settings = { paCap: 95 };
    // 引擎级：拿效果语句但状态已被并发赢家改成 approved → 同一批语句重放必须 no-op
    const payload = { playerId: 1, points: 1 };
    const plan = await prepareShopPlan(fx.env.DB, 101, 'pa', payload, settings);
    fx.sqlite.prepare(`INSERT INTO shop_orders (id, source, club_id, ordered_by, category, payload_json, amount, status, created_at)
                       VALUES (77, 'club', 101, 1, 'pa', '{}', 15, 'approved', '2026-01-01T00:00:00Z')`).run();
    await fx.env.DB.batch(plan.buildEffects(fx.env.DB, 77, 'club', 2));
    expect((fx.sqlite.prepare('SELECT pa FROM players WHERE id = 1').get() as { pa: number }).pa).toBe(88);
  });

  it('TC-B06 external：创建不扣费不生效；确认执行才生效；作废无退款', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, pa: 88 });
    const res = await app.request(
      '/api/admin/shop/orders',
      { method: 'POST', headers: { 'content-type': 'application/json', Cookie: ADMIN }, body: JSON.stringify({ clubId: 101, category: 'pa', payload: { playerId: 1, points: 2 } }) },
      fx.env,
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { order: { id: number; amount: number | null; status: string } };
    expect(created.order.amount).toBeNull();
    expect(created.order.status).toBe('pending');
    expect(balanceOf(fx, 101)).toBe(50);
    // 确认执行 → PA 生效
    expect((await approve(fx, created.order.id)).status).toBe(200);
    expect((fx.sqlite.prepare('SELECT pa FROM players WHERE id = 1').get() as { pa: number }).pa).toBe(90);
    // 再录一张然后作废：无退款
    const res2 = await app.request(
      '/api/admin/shop/orders',
      { method: 'POST', headers: { 'content-type': 'application/json', Cookie: ADMIN }, body: JSON.stringify({ clubId: 101, category: 'pa', payload: { playerId: 1, points: 1 } }) },
      fx.env,
    );
    const id2 = ((await res2.json()) as { order: { id: number } }).order.id;
    expect((await reject(fx, id2, '来源材料不全')).status).toBe(200);
    expect(balanceOf(fx, 101)).toBe(50);
  });

  it('TC-B07 端点契约：匿名 401、非管理 403、未绑定 403、列表筛选', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101 });
    expect((await app.request('/api/shop/catalog', {}, fx.env)).status).toBe(401);
    // 未绑定的教练：身份能过但没俱乐部 → 403
    const unbound = freshEnv();
    seedClub(unbound, 101, 50, false);
    expect((await app.request('/api/shop/orders', { headers: { Cookie: COACH } }, unbound.env)).status).toBe(403);
    // 教练打管理端 403
    expect((await app.request('/api/admin/shop/orders', { headers: { Cookie: COACH } }, fx.env)).status).toBe(403);
    // 绑定后：catalog / squad-state / orders 通
    await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 1 } });
    const list = await app.request('/api/shop/orders', { headers: { Cookie: COACH } }, fx.env);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { orders: unknown[] }).orders).toHaveLength(1);
    const adminList = await app.request('/api/admin/shop/orders?status=pending&source=club', { headers: { Cookie: ADMIN } }, fx.env);
    expect(((await adminList.json()) as { orders: unknown[] }).orders).toHaveLength(1);
    const none = await app.request('/api/admin/shop/orders?status=rejected', { headers: { Cookie: ADMIN } }, fx.env);
    expect(((await none.json()) as { orders: unknown[] }).orders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-C：数据语义与保护

describe('TC-C 数据语义与同值锁', () => {
  it('TC-C02 导入重放：PA/角色/位置按台账恢复，重跑幂等', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    // 球员：主位 ST + 槽 2 CAM + RoleID1=41，fc_id=9001
    seedPlayer(fx, 1, { clubId: 101, pa: 88, gameAttrs: { PosID1: 25, PosID2: 18, RoleID1: 41 } });
    fx.sqlite.prepare(`UPDATE players SET fc_id = 9001 WHERE id = 1`).run();
    // 买：2 点 PA + 新增角色（CAM 单加号 31 落槽 3）+ 新增位置 RW（slot 3；RW-ST 相邻）
    const o1 = ((await (await coachPost(fx, { category: 'pa', payload: { playerId: 1, points: 2 } })).json()) as { order: { id: number } }).order.id;
    await approve(fx, o1);
    const o2 = ((await (await coachPost(fx, { category: 'role', payload: { playerId: 1, action: 'add', roleId: 31 } })).json()) as { order: { id: number } }).order.id;
    await approve(fx, o2);
    const o3 = ((await (await coachPost(fx, { category: 'position', payload: { playerId: 1, action: 'add', slot: 3, posId: 23 } })).json()) as { order: { id: number } }).order.id;
    await approve(fx, o3);
    // 此时：pa 90、CAM 角色落在首个空槽（槽 2）、PosID3=23
    expect(gameAttrsOf(fx, 1)).toMatchObject({ PosID1: 25, PosID2: 18, PosID3: 23, RoleID1: 41, RoleID2: 31 });

    // 重导：源 PA=90、game_attrs 只有主位（角色/位置/PA 全被源覆盖）
    const row = { ID: 9001, Name: '球员1', Age: 24, CA: 80, PA: 90, naID: 44, PosID1: 25, FootID: 1 };
    const importBody = { channel: 'A', rows: [row], mode: 'minor' };
    const first = await confirmImport(fx.env, 2, importBody);
    expect(first.replayed).toBe(1);
    // 重放后：PA = 90 + 2（≤95）、台账槽位恢复；非台账的原始槽位（PosID2/RoleID1）按源数据覆盖为 null —— 预期行为
    expect((fx.sqlite.prepare('SELECT pa FROM players WHERE id = 1').get() as { pa: number }).pa).toBe(92);
    expect(gameAttrsOf(fx, 1)).toMatchObject({ PosID1: 25, PosID2: null, PosID3: 23, RoleID1: null, RoleID2: 31 });
    // 重跑导入：结果不变（整体幂等）
    const second = await confirmImport(fx.env, 2, importBody);
    expect(second.replayed).toBe(1);
    expect((fx.sqlite.prepare('SELECT pa FROM players WHERE id = 1').get() as { pa: number }).pa).toBe(92);
    expect(gameAttrsOf(fx, 1)).toMatchObject({ PosID2: null, PosID3: 23, RoleID2: 31 });
  });

  it('TC-C03 重导后 shop 徽章仍在（独立明细表不受整列覆盖影响）', async () => {
    const fx = freshEnv();
    seedClub(fx, 101, 50);
    seedPlayer(fx, 1, { clubId: 101, gameAttrs: { PosID1: 25 } });
    fx.sqlite.prepare(`UPDATE players SET fc_id = 9001 WHERE id = 1`).run();
    const orderId = ((await (await coachPost(fx, { category: 'badge', payload: { playerId: 1, kind: 'gold', psid: 5 } })).json()) as { order: { id: number } }).order.id;
    await approve(fx, orderId);
    await confirmImport(fx.env, 2, { channel: 'A', rows: [{ ID: 9001, Name: '球员1', Age: 24, CA: 80, PA: 88, naID: 44, PosID1: 25, FootID: 1 }], mode: 'minor' });
    const row = fx.sqlite.prepare("SELECT kind, psid, source FROM player_playstyles WHERE player_id = 1 AND source = 'shop'").get() as { kind: string; psid: number; source: string } | undefined;
    expect(row).toEqual({ kind: 'gold', psid: 5, source: 'shop' });
  });

  it('TC-C04 相邻表：与定稿字面量同值、自反对称、名称域与 position.json 一致', () => {
    const golden: Record<string, string[]> = {
      LW: ['ST', 'CAM', 'LM'],
      ST: ['LW', 'RW', 'CAM'],
      RW: ['ST', 'CAM', 'RM'],
      CAM: ['ST', 'LW', 'RW', 'LM', 'RM', 'CM'],
      CM: ['CAM', 'LM', 'RM', 'CDM'],
      CDM: ['CM', 'LM', 'RM', 'LB', 'RB', 'CB'],
      LM: ['LW', 'CAM', 'CM', 'CDM', 'LB'],
      RM: ['RW', 'CAM', 'CM', 'CDM', 'RB'],
      LB: ['LM', 'CDM', 'CB'],
      CB: ['CDM', 'LB', 'RB'],
      RB: ['RM', 'CDM', 'CB'],
    };
    expect(POSITION_ADJACENCY).toEqual(golden);
    // 22 条边（逐边计数）+ 自反对称
    const edges = new Set<string>();
    for (const [a, list] of Object.entries(POSITION_ADJACENCY)) {
      for (const b of list) {
        edges.add([a, b].sort().join('|'));
        expect(POSITION_ADJACENCY[b]).toContain(a);
        expect(golden[b]).toContain(a);
      }
    }
    expect(edges.size).toBe(22);
    // 名称域：相邻表里出现的名称都是 position.json 的合法位置（且不是 GK）
    const names = new Set(positionRef.map((p) => p.name as string));
    for (const key of Object.keys(POSITION_ADJACENCY)) {
      expect(names.has(key)).toBe(true);
      expect(key).not.toBe('GK');
    }
  });

  it('TC-C05 角色归属与名称与 role.json 同源；PlayStyle 名称与 playstyle.json 同源', () => {
    const roles = roleRef as { id: number; chs: string }[];
    const baseRoles = roles.filter((r) => r.id >= 1 && r.id <= 49);
    expect(baseRoles).toHaveLength(49);
    for (const r of baseRoles) {
      const pos = r.chs.split(' ')[0];
      expect(ROLE_POSITION_BY_ID[r.id]).toBe(pos);
      expect(ROLE_BASE_NAMES[r.id]).toBe(r.chs.replace(/ \+$/, ''));
    }
    // 双加号段（101-149）逐条折回基础段
    for (const r of roles.filter((x) => x.id >= 101 && x.id <= 149)) {
      expect(ROLE_POSITION_BY_ID[r.id - 100]).toBe(r.chs.split(' ')[0]);
    }
    const psMap = new Map((playstyleRef as { id: number; chs: string }[]).map((p) => [p.id, p.chs]));
    expect(Object.keys(SHOP_PS_NAMES)).toHaveLength(36);
    for (const [id, name] of Object.entries(SHOP_PS_NAMES)) {
      expect(psMap.get(Number(id))).toBe(name);
    }
  });
});
