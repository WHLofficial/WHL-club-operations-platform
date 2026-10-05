// 转会广告板测试（v6.31.0）：GET /api/market/transfer-board 的名单口径、排序、limit 与行字段。
// fixture 自建：甲队 1 / 乙队 2 + 八名球员，覆盖在名单/不在名单、有/无现行合同、
// 现行最高档着重度 / 过期着重度 / 越界 tier、存量无戳（NULL）与不同上架时刻。
// 着重度时间用固定远期/过期文本（2099 / 2020），不依赖机器时钟。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';

// 限流桶 / L1 缓存 / 代际键记忆逐用例清零（PUBLIC_CACHE_TTL_MS = '0' 已旁路缓存，读库即真相）
beforeEach(() => {
  resetGuards();
});

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

/** ttl 默认 '0'（PUBLIC_CACHE_TTL_MS 旁路缓存，读库即真相）；缓存用例显式传 '60000' */
function freshEnv(ttl = '0'): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (2, '教练乙', 'coach', 0, 0);`,
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
    PUBLIC_CACHE_TTL_MS: ttl,
  };
  kv.set('sess:tok-coach', JSON.stringify({ userId: 2 }));
  return { env, sqlite };
}

interface BoardPlayer {
  id: number;
  uid: string;
  fcId: number | null;
  name: string;
  positions: string[];
  age: number | null;
  ca: number | null;
  pa: number | null;
  clubId: number | null;
  clubName: string | null;
  minOfferPrice: number | null;
  releaseFee: number | null;
  listedAt: string | null;
  emphasis: number;
  emphasisUntil: string | null;
  status: string;
  notForSale: boolean;
  transferPriced: boolean;
}

interface BoardOut {
  players: BoardPlayer[];
  total: number;
}

async function board(fx: Fixture, query = ''): Promise<BoardOut> {
  const res = await app.request(`/api/market/transfer-board${query}`, { method: 'GET' }, fx.env);
  expect(res.status).toBe(200);
  return (await res.json()) as BoardOut;
}

// 名单：1/2/3/5/6/7/8 在名单，4 不在；着重度行 6 = 最高档 + 同档最晚到期、5 过期、8 越界
function seedBoard(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '甲队', 'premier', 'active'), (2, '乙队', 'premier', 'active');
    INSERT INTO players (id, uid, name, display_name, club_id, position, age, ca, pa, status, fc_id, transfer_listed, min_offer_price, transfer_listed_at, game_attrs) VALUES
      (1, 'uid1', '球员甲', '铁闸甲', 1, 'CM', 24, 80, 88, 'normal', 11, 1, 40, '2026-01-01T00:00:00.000Z', '{"PosID1":25,"PosID2":25,"PosID3":15}'),
      (2, 'uid2', '球员乙', NULL, 1, 'ST', 22, 75, 84, 'normal', 12, 1, 55, '2026-02-01T00:00:00.000Z', NULL),
      (3, 'uid3', '球员丙', NULL, 2, NULL, 21, 70, 80, 'normal', 13, 1, NULL, NULL, '{"PosID1":0}'),
      (4, 'uid4', '球员丁', NULL, 1, 'CB', 26, 78, 78, 'normal', 14, 0, NULL, NULL, NULL),
      (5, 'uid5', '球员戊', NULL, 2, 'GK', 30, 72, 72, 'normal', 15, 1, 30, '2025-12-31T00:00:00.000Z', NULL),
      (6, 'uid6', '球员己', NULL, 1, 'LW', 23, 77, 86, 'normal', 16, 1, 66, '2026-01-15T00:00:00.000Z', NULL),
      (7, 'uid7', '球员庚', NULL, 2, 'RM', 27, 74, 74, 'normal', 17, 1, 44, '2026-01-20T00:00:00.000Z', NULL),
      (8, 'uid8', '球员辛', NULL, 2, 'LM', 25, 73, 73, 'normal', 18, 1, NULL, '2026-01-01T00:00:00.000Z', NULL);
    -- 现行合同只在 1 上（2 只有失效的旧合同 → releaseFee 仍须 null；3 无合同；4 有合同但人不在名单）
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1, 1, 50, 2, 'formal', 'import', '2026-07-01', 1),
      (2, 1, 999, 2, 'formal', 'import', '2025-07-01', 0),
      (4, 1, 80, 2, 'formal', 'import', '2026-07-01', 1);
    INSERT INTO player_promotions (player_id, club_id, tier, cost, starts_at, ends_at, created_at) VALUES
      (6, 1, 1, 0, '2026-01-01T00:00:00.000Z', '2099-09-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (6, 1, 2, 0, '2026-01-01T00:00:00.000Z', '2099-06-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (6, 1, 2, 0, '2026-01-01T00:00:00.000Z', '2099-06-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (4, 1, 2, 0, '2026-01-01T00:00:00.000Z', '2099-05-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (5, 2, 2, 0, '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
      (7, 2, 1, 0, '2026-01-01T00:00:00.000Z', '2099-03-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      (8, 2, 3, 0, '2026-01-01T00:00:00.000Z', '2099-07-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
}

describe('转会广告板（GET /api/market/transfer-board）', () => {
  it('名单口径：只收 transfer_listed = 1；不在名单球员的着重度行不外泄', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const out = await board(fx);
    expect(out.total).toBe(7);
    expect(out.players.map((p) => p.id)).toEqual([6, 7, 2, 8, 1, 5, 3]);
    expect(out.players.some((p) => p.id === 4)).toBe(false);
  });

  it('排序：emphasis DESC → listedAt DESC（NULL 当最旧）→ id DESC', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const out = await board(fx);
    // emphasis 2 → 6；emphasis 1 → 7；emphasis 0 内部：2026-02-01(2) → 2026-01-01(8,1 同戳按 id 倒序)
    // → 2025-12-31(5) → NULL(3)
    expect(out.players.map((p) => [p.id, p.emphasis, p.listedAt])).toEqual([
      [6, 2, '2026-01-15T00:00:00.000Z'],
      [7, 1, '2026-01-20T00:00:00.000Z'],
      [2, 0, '2026-02-01T00:00:00.000Z'],
      [8, 0, '2026-01-01T00:00:00.000Z'],
      [1, 0, '2026-01-01T00:00:00.000Z'],
      [5, 0, '2025-12-31T00:00:00.000Z'],
      [3, 0, null],
    ]);
  });

  it('emphasis：取现行最高档（同档取最晚到期）；过期与越界 tier 都不算', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const out = await board(fx);
    const byId = new Map(out.players.map((p) => [p.id, p]));
    // 6：tier 1 到期更晚（2099-09-01）也不顶替 tier 2；同为 tier 2 取 ends_at 更晚的 2099-06-02
    expect(byId.get(6)).toMatchObject({ emphasis: 2, emphasisUntil: '2099-06-02T00:00:00.000Z' });
    expect(byId.get(7)).toMatchObject({ emphasis: 1, emphasisUntil: '2099-03-01T00:00:00.000Z' });
    // 5：唯一的着重度行已过期（ends_at <= now）→ 普通
    expect(byId.get(5)).toMatchObject({ emphasis: 0, emphasisUntil: null });
    // 3：从无着重度行 → 普通
    expect(byId.get(3)).toMatchObject({ emphasis: 0, emphasisUntil: null });
    // 8：越界 tier 3 → 读取按 0（普通）处理
    expect(byId.get(8)).toMatchObject({ emphasis: 0 });
  });

  it('行字段：显示名 / 位置去重去空（NULL 槽位不当 GK）/ clubName / releaseFee / 数值门槛', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const out = await board(fx);
    const byId = new Map(out.players.map((p) => [p.id, p]));
    // 1：display_name 优先；position CM + PosID1 ST（PosID2 重复、PosID3 非法码、PosID4 缺失）
    expect(byId.get(1)).toMatchObject({
      id: 1,
      uid: 'uid1',
      fcId: 11,
      name: '铁闸甲',
      positions: ['CM', 'ST'],
      age: 24,
      ca: 80,
      pa: 88,
      clubId: 1,
      clubName: '甲队',
      minOfferPrice: 40,
      releaseFee: 50,
      listedAt: '2026-01-01T00:00:00.000Z',
      status: 'normal',
      notForSale: false,
      transferPriced: true,
    });
    // 2：只有失效合同 → releaseFee null（防 JOIN 漏 is_active 条件）；无 display_name → 回落 name
    expect(byId.get(2)).toMatchObject({ name: '球员乙', releaseFee: null, minOfferPrice: 55, transferPriced: true });
    // 3：position NULL + PosID1 = 0（GK）→ ['GK']；min_offer_price NULL → transferPriced false
    expect(byId.get(3)).toMatchObject({ positions: ['GK'], minOfferPrice: null, transferPriced: false, clubName: '乙队' });
  });

  it('limit：正常值截断（players 变短、total 不变）；缺省回落 200', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const capped = await board(fx, '?limit=2');
    expect(capped.players.map((p) => p.id)).toEqual([6, 7]);
    expect(capped.players).toHaveLength(2);
    expect(capped.total).toBe(7);
    const plain = await board(fx);
    expect(plain.players).toHaveLength(7);
    expect(plain.total).toBe(7);
  });

  it('limit：上限 200 钳住；非整数 / 非法值 / ≤0 / 空串回落默认', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '甲队', 'premier', 'active');`);
    const values = Array.from(
      { length: 205 },
      (_, i) => `(${100 + i}, 'u${100 + i}', '球员${100 + i}', 1, 'ST', 20, 60, 70, 1, ${1000 + i}, 10, '2026-01-01T00:00:00.000Z')`,
    ).join(',');
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, transfer_listed, fc_id, min_offer_price, transfer_listed_at) VALUES ${values};`,
    );
    for (const query of ['', '?limit=999', '?limit=201', '?limit=abc', '?limit=0', '?limit=-5', '?limit=', '?limit=2.5']) {
      const out = await board(fx, query);
      expect(out.total).toBe(205);
      expect(out.players).toHaveLength(200);
    }
    const small = await board(fx, '?limit=3');
    expect(small.players).toHaveLength(3);
    expect(small.total).toBe(205);
  });

  it('空库：无在名单球员 → { players: [], total: 0 }', async () => {
    const fx = freshEnv();
    const out = await board(fx);
    expect(out.players).toEqual([]);
    expect(out.total).toBe(0);
  });
});

// 缓存与新鲜度（TC-ADB-13 / 14）：TTL 走 PUBLIC_CACHE_TTL_MS（生产 1h），
// 所以「玩家进出名单后广告板立刻更新」只能靠写路径 purge 兜住，这里双向取数。
describe('转会广告板缓存与写后新鲜度（v6.31.0）', () => {
  it('缓存生效且键含 limit：同 limit 命中旧值、换 limit 立即读库', async () => {
    const fx = freshEnv('60000');
    seedBoard(fx);
    const first = await board(fx, '?limit=3');
    expect(first.total).toBe(7);
    expect(first.players.map((p) => p.id)).toEqual([6, 7, 2]);

    // 绕过写路径直接改库（不清缓存）：同 limit 仍拿旧值 ⇒ 证明缓存在生效（否则这条断言就是摆设）
    fx.sqlite.exec('UPDATE players SET transfer_listed = 0 WHERE id = 6');
    const again = await board(fx, '?limit=3');
    expect(again.total).toBe(7);
    expect(again.players.map((p) => p.id)).toEqual([6, 7, 2]);

    // 换 limit = 换缓存键 ⇒ 立刻反映库改动（也证明 limit 进了键：不然会复用上面那份 3 条）
    const other = await board(fx, '?limit=7');
    expect(other.total).toBe(6);
    expect(other.players.some((p) => p.id === 6)).toBe(false);
  });

  it('写路径（PUT /api/players/:id/offer-settings）后立即清缓存，不陈旧到 TTL', async () => {
    const fx = freshEnv('60000');
    seedBoard(fx);
    fx.sqlite.exec("INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 2, '2026-01-01T00:00:00.000Z')");
    expect((await board(fx, '?limit=3')).total).toBe(7);

    // 真写一次：把 1 号拉出转会名单（守卫要求同时清最低价）
    const res = await app.request(
      '/api/players/1/offer-settings',
      {
        method: 'PUT',
        headers: { Cookie: 'whl_session=tok-coach', 'content-type': 'application/json' },
        body: JSON.stringify({ transferListed: false, minOfferPrice: null, notForSale: false }),
      },
      fx.env,
    );
    expect(res.status).toBe(200);
    expect(sqlGet(fx.sqlite, 'SELECT transfer_listed FROM players WHERE id = 1')).toMatchObject({ transfer_listed: 0 });

    // /api/players 命中写前缀 ⇒ 中间件 purge 公开缓存，广告板必须立刻见新（TTL 1h 不许兜底）
    expect((await board(fx, '?limit=3')).total).toBe(6);
  });
});
