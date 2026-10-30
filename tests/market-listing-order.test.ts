// 卡柜排序回归锁（v6.60.10）：强制拍卖单（type='forced'，管理端介入挂出的强拍）在转会区恒排最前，
// 其余按挂牌先后倒序（id DESC）。口径来自用户：「强制挂牌在转会区始终排在最前」。
// 只锁后端排序——前端卡头那枚「强拍」徽标由 web/src/pages/market/MarketCard.test.tsx 兜。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1 } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(new DatabaseSync(':memory:')),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    PUBLIC_CACHE_TTL_MS: '0',
  };
  return { env, sqlite };
}

const now = new Date().toISOString();
const today = now.slice(0, 10);

// 挂牌世界：一支卖方球队 + 九名球员（用例里的挂牌 id 直接当 player_id 用），一间窗开的赛季（结算器读 seasons/windows）
function seedWorld(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
    INSERT INTO seasons (season, status) VALUES (1, 'running');
    INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '${now}');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status, fc_id) VALUES
      (1, 'uid1', '球员甲', 1, 'ST', 80, 85, 'listed', 11),
      (2, 'uid2', '球员乙', 1, 'CM', 75, 82, 'listed', 12),
      (3, 'uid3', '球员丙', 1, 'LB', 72, 80, 'listed', 13),
      (4, 'uid4', '球员丁', 1, 'GK', 70, 78, 'listed', 14),
      (5, 'uid5', '球员戊', 1, 'CB', 78, 84, 'listed', 15),
      (6, 'uid6', '球员己', 1, 'RB', 74, 81, 'listed', 16),
      (7, 'uid7', '球员庚', 1, 'LW', 76, 83, 'listed', 17),
      (8, 'uid8', '球员辛', 1, 'RW', 77, 83, 'listed', 18),
      (9, 'uid9', '球员壬', 1, 'DM', 79, 85, 'listed', 19);
  `);
}

// 一条在售挂牌：listed_day 用今天，避免惰性结算把它判成过期下架
function seedListing(fx: Fixture, opts: { id: number; type: string }): void {
  fx.sqlite.exec(`
    INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, last_bid_at, deadline_note, window_seq, season)
      VALUES (${opts.id}, ${opts.id}, 1, '${opts.type}', 10, 'listed', '${now}', '${today}', '${now}', '', 1, 1);
  `);
}

async function boardIds(fx: Fixture, query = ''): Promise<number[]> {
  const res = await app.request(`/api/market/listings${query}`, { method: 'GET' }, fx.env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { listings: { id: number }[] };
  return body.listings.map((l) => l.id);
}

describe('转会区排序：强制拍卖单恒排最前（v6.60.10）', () => {
  it('两条强拍 + 两条普通：强拍在前，档内各自按 id 倒序', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedListing(fx, { id: 1, type: 'normal' });
    seedListing(fx, { id: 2, type: 'forced' });
    seedListing(fx, { id: 3, type: 'normal' });
    seedListing(fx, { id: 4, type: 'forced' });

    // 只按 id 倒序会是 [4,3,2,1]；强拍置顶后第三、四位要换成两条普通单
    expect(await boardIds(fx)).toEqual([4, 2, 3, 1]);
  });

  it('强拍比普通单更早挂出时仍排最前（顺序不靠 id 大小）', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedListing(fx, { id: 1, type: 'forced' });
    seedListing(fx, { id: 5, type: 'normal' });
    seedListing(fx, { id: 9, type: 'normal' });

    expect(await boardIds(fx)).toEqual([1, 9, 5]);
  });

  it('status=all 与 status=active 口径一致', async () => {
    const fx = freshEnv();
    seedWorld(fx);
    seedListing(fx, { id: 1, type: 'normal' });
    seedListing(fx, { id: 2, type: 'forced' });

    expect(await boardIds(fx, '?status=all')).toEqual([2, 1]);
    expect(await boardIds(fx, '?status=active')).toEqual([2, 1]);
  });
});
