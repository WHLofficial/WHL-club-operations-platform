// 转会广告板测试（v6.31.0）：GET /api/market/transfer-board 的名单口径、排序（付费档 + 普通档时间桶轮换）、
// limit 与行字段。fixture 自建：甲队 1 / 乙队 2 + 八名球员，覆盖在名单/不在名单、有/无现行合同、
// 现行最高档着重度 / 过期着重度 / 越界 tier、存量无戳（NULL）与不同上架时刻。
// 着重度时间用固定远期/过期文本（2099 / 2020）；轮换用例把 Date.now 钉死（桶号可复现），
// 不冻结时钟的用例只断「集合与付费档前缀」，不断普通档顺序。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { TRANSFER_BOARD_ROTATE_MS, shuffleWithSeed, transferBoardBucket } from '../src/core/ad-board.ts';

// 限流桶 / L1 缓存 / 代际键记忆逐用例清零（PUBLIC_CACHE_TTL_MS = '0' 已旁路缓存，读库即真相）
beforeEach(() => {
  resetGuards();
});

// 轮换用例把时钟钉死：桶号 = floor(now / 5min)，冻结后洗牌结果可写成字面量（跨机器可复现）
const FIXED_NOW = Date.parse('2026-10-05T00:00:00.000Z'); // → 桶 5970528
function freezeNow(ms = FIXED_NOW) {
  return vi.spyOn(Date, 'now').mockReturnValue(ms);
}

afterEach(() => {
  vi.restoreAllMocks();
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
  logoKey: string | null;
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
    INSERT INTO clubs (id, name, league_tier, status, logo_key) VALUES (1, '甲队', 'premier', 'active', 'logo/c1.png'), (2, '乙队', 'premier', 'active', NULL);
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
    freezeNow(); // 普通档顺序依赖桶号，这里一并钉死时钟
    const out = await board(fx);
    expect(out.total).toBe(7);
    expect(out.players.map((p) => p.id)).toEqual([6, 7, 2, 1, 3, 5, 8]);
    expect(out.players.some((p) => p.id === 4)).toBe(false);
  });

  it('排序：付费档按着重度 → 挂出时间 → id；普通档按时间桶轮换（锁死时钟取字面量）', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    freezeNow(); // 2026-10-05T00:00:00Z → 桶 5970528
    const out = await board(fx);
    // 付费档：6（emphasis 2）→ 7（emphasis 1）
    expect(out.players.slice(0, 2).map((p) => [p.id, p.emphasis, p.listedAt])).toEqual([
      [6, 2, '2026-01-15T00:00:00.000Z'],
      [7, 1, '2026-01-20T00:00:00.000Z'],
    ]);
    // 普通档：同一批人（挂出时间序 [2,8,1,5,3]），桶 5970528 洗成 [2,1,3,5,8]。
    // 字面量同时锁住算法、种子与桶长——去掉轮换 / 改洗牌 / 改桶长都会红。
    expect(out.players.slice(2).map((p) => [p.id, p.listedAt])).toEqual([
      [2, '2026-02-01T00:00:00.000Z'],
      [1, '2026-01-01T00:00:00.000Z'],
      [3, null],
      [5, '2025-12-31T00:00:00.000Z'],
      [8, '2026-01-01T00:00:00.000Z'],
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

  it('行字段：显示名 / 位置去重去空（NULL 槽位不当 GK）/ clubName / logoKey / releaseFee / 数值门槛', async () => {
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
      // v6.32.0：队徽 key 随 clubs JOIN 下发（R2 图），无徽队回落 null
      logoKey: 'logo/c1.png',
      minOfferPrice: 40,
      releaseFee: 50,
      listedAt: '2026-01-01T00:00:00.000Z',
      status: 'normal',
      notForSale: false,
      transferPriced: true,
    });
    // 2：只有失效合同 → releaseFee null（防 JOIN 漏 is_active 条件）；无 display_name → 回落 name
    expect(byId.get(2)).toMatchObject({ name: '球员乙', releaseFee: null, minOfferPrice: 55, transferPriced: true });
    // 3：position NULL + PosID1 = 0（GK）→ ['GK']；min_offer_price NULL → transferPriced false；乙队无徽 → logoKey null
    expect(byId.get(3)).toMatchObject({ positions: ['GK'], minOfferPrice: null, transferPriced: false, clubName: '乙队', logoKey: null });
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

describe('广告板轮换：时间桶 + 付费档免疫（v6.31.0）', () => {
  it('同一时间桶内普通档顺序固定（种子化洗牌，多个 isolate 算同一缓存键结果一致）', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const nowSpy = freezeNow();
    // 桶 5970528：普通档 [2,8,1,5,3] 洗成 [2,1,3,5,8]；两次请求必须同序（不能每次 Math.random）
    expect((await board(fx)).players.map((p) => p.id)).toEqual([6, 7, 2, 1, 3, 5, 8]);
    expect((await board(fx)).players.map((p) => p.id)).toEqual([6, 7, 2, 1, 3, 5, 8]);

    // 进下一个桶 ⇒ 普通档换一批（付费档前缀不动，见下一条用例）
    nowSpy.mockReturnValue(FIXED_NOW + TRANSFER_BOARD_ROTATE_MS);
    expect((await board(fx)).players.map((p) => p.id)).toEqual([6, 7, 8, 5, 3, 2, 1]);
  });

  it('换桶只换顺序、不重读库：桶号不进缓存键（进键会把该端点重读放大 12 倍）', async () => {
    const fx = freshEnv('3600000'); // 1h 缓存：5 分钟的桶边界远在 TTL 之内，不会触发 SWR 刷新
    seedBoard(fx);
    const nowSpy = freezeNow();
    expect((await board(fx)).players.map((p) => p.id)).toEqual([6, 7, 2, 1, 3, 5, 8]);

    // 绕过写路径直接改库（不清缓存）：把普通档 8 从名单里摘掉。若下一次请求重读库，8 会消失
    fx.sqlite.exec('UPDATE players SET transfer_listed = 0 WHERE id = 8');

    nowSpy.mockReturnValue(FIXED_NOW + TRANSFER_BOARD_ROTATE_MS);
    // 顺序换了 ⇒ 洗牌确实用了「当前」桶号（洗牌在缓存之外做，不靠换键失效）；
    // 8 仍在 ⇒ 这一批人还是缓存里那一批，这次请求没有重读库
    expect((await board(fx)).players.map((p) => p.id)).toEqual([6, 7, 8, 5, 3, 2, 1]);
  });

  it('付费档免疫：置顶 / 推荐的位置与顺序两桶都不动，只有 emphasis = 0 那一段换', async () => {
    const fx = freshEnv();
    seedBoard(fx);
    const nowSpy = freezeNow();
    const a = await board(fx);
    expect(a.players.filter((p) => p.emphasis !== 0).map((p) => [p.id, p.emphasis])).toEqual([
      [6, 2],
      [7, 1],
    ]);
    expect(a.players.slice(2).map((p) => p.id)).toEqual([2, 1, 3, 5, 8]);

    nowSpy.mockReturnValue(FIXED_NOW + TRANSFER_BOARD_ROTATE_MS);
    const b = await board(fx);
    expect(b.players.filter((p) => p.emphasis !== 0).map((p) => [p.id, p.emphasis])).toEqual([
      [6, 2],
      [7, 1],
    ]);
    expect(b.players.slice(2).map((p) => p.id)).toEqual([8, 5, 3, 2, 1]);

    // 反证：把整份名单（含付费档）交给同一个种子洗牌，结果与线上顺序不同 ⇒
    // 「洗了付费档」这种实现会被这条逮住（[6,8,7,5,1,3,2] ≠ [6,7,2,1,3,5,8]）
    expect(shuffleWithSeed(a.players.map((p) => p.id), transferBoardBucket(FIXED_NOW))).not.toEqual([
      6, 7, 2, 1, 3, 5, 8,
    ]);
  });
});

describe('core/ad-board：时间桶与种子化洗牌（v6.31.0）', () => {
  it('桶号：5 分钟一档，桶内任意时刻同桶、跨档 +1', () => {
    expect(TRANSFER_BOARD_ROTATE_MS).toBe(300_000);
    expect(transferBoardBucket(FIXED_NOW)).toBe(5970528);
    expect(transferBoardBucket(FIXED_NOW + TRANSFER_BOARD_ROTATE_MS - 1)).toBe(5970528);
    expect(transferBoardBucket(FIXED_NOW + TRANSFER_BOARD_ROTATE_MS)).toBe(5970529);
    expect(transferBoardBucket(0)).toBe(0);
  });

  it('shuffleWithSeed：同种子同结果（跨 isolate 一致）、字面量锁算法、不改原数组', () => {
    const src = [1, 2, 3, 4];
    expect(shuffleWithSeed(src, 1)).toEqual([4, 2, 1, 3]);
    expect(shuffleWithSeed(src, 42)).toEqual([1, 4, 2, 3]);
    expect(shuffleWithSeed(src, 1)).toEqual(shuffleWithSeed(src, 1));
    expect(src).toEqual([1, 2, 3, 4]);
    expect(shuffleWithSeed([], 7)).toEqual([]);
    expect(shuffleWithSeed([9], 7)).toEqual([9]);
  });
});
