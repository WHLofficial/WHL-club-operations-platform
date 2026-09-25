// 管理端 · 总览轻计数（v2.1.0 commit 6 新增）：待审/赛果队列/活跃挂牌/俱乐部/球员一眼扫，
// isolate 级 60s 缓存挡 D1 读配额（players COUNT 1.8 万行）；?fresh=1 强制绕过缓存
// v3.2.0 步骤 6：players 那条 COUNT 改用 countAllPlayers —— 走 players 作用域的两级缓存
// （isolate 级这层 60s 挡不住多 isolate，边缘缓存才是真正的护栏；写路径 purge 保证新鲜度）。
// ⚠️ ?fresh=1 只绕过上面这层 isolate 缓存，players 数字仍由两级缓存供（要强制重算就等 purge）。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { queueResults } from '../../results.ts';
import { countAllPlayers } from '../players.ts';

const app = new Hono<{ Bindings: Env }>();

const OVERVIEW_TTL_MS = 60_000;

export interface AdminOverview {
  openReviews: number;
  resultQueue: number;
  activeListings: number;
  clubs: number;
  players: number;
  at: string;
}

// module 级 = isolate 级；resetOverviewCache 供测试隔离
let cache: { at: number; data: AdminOverview } | null = null;
export function resetOverviewCache(): void {
  cache = null;
}

app.get('/overview', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const fresh = c.req.query('fresh') === '1';
  const now = Date.now();
  if (!cache || fresh || now - cache.at >= OVERVIEW_TTL_MS) {
    const [openReviews, activeListings, clubs, players, results] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM review_tasks WHERE type = 'transfer_confirm' AND status = 'open'`).first<{ n: number }>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM listings WHERE status IN ('listed', 'bidding', 'matched_pending')`).first<{ n: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM clubs').first<{ n: number }>(),
      countAllPlayers(c),
      queueResults(c.env),
    ]);
    cache = {
      at: now,
      data: {
        openReviews: openReviews?.n ?? 0,
        activeListings: activeListings?.n ?? 0,
        clubs: clubs?.n ?? 0,
        players,
        resultQueue: results.queue.length,
        at: new Date().toISOString(),
      },
    };
  }
  return c.json(cache.data);
});

export default app;
