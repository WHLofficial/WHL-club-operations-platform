// 全平台一线队名册（🌐 公开，v5.0.0）：给赛事系统拉取同步用的只读面。
//
// 为什么要有这个端点：球衣号与球员名的**真源搬到了俱乐部平台**（v4.0.0：显示名由 FC26 存档
// 派生、号码由所属俱乐部在球员卡上设定），赛事系统的 player 表从「手工录入」变成「本端点的镜像」。
// 赛事系统那条 cron 只认这一个端点，所以这里的口径就是两库之间唯一的契约。
//
// 口径（与球员库、球队页共用同一套）：
// - 一线队 = `club_id IS NOT NULL AND status IN ('normal','listed')`（训练营 trainee 不算一线队）；
// - 姓名一律走 `sqlDisplayName()`（派生显示名，空则回落官方缩写名）——赛事系统原来存的是手工
//   完整人名，同步后会被改写成派生名，这是本次改造的目的；
// - `fcId` 是跨系统的球员身份（赛事系统的 `player.id` 就是它，两库早前一起 rekey 过），
//   **赛事系统以它为主键写库**，所以 `fc_id` 为空的行同步不了，直接不出（生产 18,301 行全覆盖，
//   这条过滤是防御性守卫，不是常态）。
//
// 省 D1 额度：一条 JOIN 出全部 20 队 570 人（`club_id IS NOT NULL` 被 SQLite 改写成范围扫，
// 天然跳过 1.7 万条 NULL），在 JS 里按 club 分组，不做 N+1、不做第二趟查询。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { assertPublicRate, cachedJson, waitUntilOf } from '../../lib/guard.ts';
import { ttlForScope } from '../../lib/cache-policy.ts';
import { sqlDisplayName } from '../../core/player-name.ts';

const app = new Hono<{ Bindings: Env }>();

interface SquadRow {
  club_id: number;
  club_name: string;
  fc_id: number;
  name: string;
  number: string | null;
}

app.get('/squads', async (c) => {
  assertPublicRate(c, 'squads');
  const data = await cachedJson(
    'squads:all',
    // roster scope：固定键、写路径代际 purge 精确失效，所以 TTL 取 24h 只是「漏 purge 时的自愈上限」。
    // 不能因为「同步一天一次」就把它当低频端点——公开面无鉴权，谁都能刷。
    ttlForScope('roster', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const rows = await c.env.DB.prepare(
        `SELECT p.club_id, c.name AS club_name, p.fc_id, ${sqlDisplayName('p')} AS name, p.number
         FROM players p
         JOIN clubs c ON c.id = p.club_id
         WHERE p.club_id IS NOT NULL AND p.status IN ('normal', 'listed') AND p.fc_id IS NOT NULL
         ORDER BY c.name, p.fc_id`,
      ).all<SquadRow>();

      // 按 club 分组：SQL 已按队名排好序，这里只做一次线性归并，不引入额外查询
      const squads: {
        clubId: number;
        clubName: string;
        players: { fcId: number; name: string; number: string | null }[];
      }[] = [];
      for (const r of rows.results) {
        let squad = squads[squads.length - 1];
        if (!squad || squad.clubId !== r.club_id) {
          squad = { clubId: r.club_id, clubName: r.club_name, players: [] };
          squads.push(squad);
        }
        squad.players.push({ fcId: r.fc_id, name: r.name, number: r.number });
      }
      return { squads };
    },
    { scope: 'roster', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
});

export default app;
