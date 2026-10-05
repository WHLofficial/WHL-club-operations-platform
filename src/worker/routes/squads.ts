// 全平台一线队名册（🌐 公开，v5.0.0）：给赛事系统拉取同步用的只读面。
//
// 为什么要有这个端点：球衣号与球员名的**真源搬到了俱乐部平台**（v4.0.0：显示名由 FC26 存档
// 派生、号码由所属俱乐部在球员卡上设定），赛事系统的 player 表从「手工录入」变成「本端点的镜像」。
// 赛事系统那条 cron 只认这一个端点，所以这里的口径就是两库之间唯一的契约。
//
// 口径（与球员库、球队页共用同一套）：
// - 一线队 = `club_id IS NOT NULL AND status IN ('normal','listed')`（训练营 trainee 不算一线队）；
//   v6.33.1 特例期开关 `squads_include_trainee`（config 表，默认 'false'）：置 'true' 时 status 集合
//   加 'trainee'——规则 4.2 原文「一线队与训练营两条注册线都能出战」，此前只发一线队是平台旧口径，
//   而赛事侧拿不到训练营球员就写不进阵容。同时每行附 `squad`（first_team/trainee）供赛事侧将来自判
//   （那边解析只挑 fcId/name/number，未知字段忽略，加字段安全）。这是**对外契约开关**：翻转走
//   /api/admin/config，且开关值已并进缓存键（`squads:all:${includeTrainee}`）——所以翻转后只要
//   config 的 isolate 记忆化过期（≤60s，见 src/core/config.ts），键就不同、必然重算，最坏陈旧
//   = 记忆化窗口；写路径代际 purge 仍可让其立刻换键；24h TTL 只是键不变时的兜底。默认 false = 平常口径。
// - 姓名一律走 `sqlDisplayName()`（派生显示名，空则回落官方缩写名）——赛事系统原来存的是手工
//   完整人名，同步后会被改写成派生名，这是本次改造的目的；
// - `fcId` 是跨系统的球员身份（赛事系统的 `player.id` 就是它，两库早前一起 rekey 过），
//   **赛事系统以它为主键写库**，所以 `fc_id` 为空的行同步不了，直接不出（生产 18,301 行全覆盖，
//   这条过滤是防御性守卫，不是常态）。
//
// 省 D1 额度：一条 JOIN 出全部 20 队（`club_id IS NOT NULL` 被 SQLite 改写成范围扫，
// 天然跳过 1.7 万条 NULL），在 JS 里按 club 分组，不做 N+1、不做第二趟查询。
// 另外每请求多读一个 config 键（开关）——isolate 内 60s 记忆化，命中 KV 缓存时连 DB 都不进。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { assertPublicRate, cachedJson, waitUntilOf } from '../../lib/guard.ts';
import { ttlForScope } from '../../lib/cache-policy.ts';
import { sqlDisplayName } from '../../core/player-name.ts';
import { createConfigService } from '../../core/config.ts';

const app = new Hono<{ Bindings: Env }>();

interface SquadRow {
  club_id: number;
  club_name: string;
  fc_id: number;
  name: string;
  number: string | null;
  squad: 'first_team' | 'trainee';
}

app.get('/squads', async (c) => {
  assertPublicRate(c, 'squads');
  // 特例期开关（默认关闭）：在 cachedJson 之外读，并把取值并进缓存键——翻转后 config 记忆化
  // 过期（≤60s）键即不同、必重算；若留在键外，记忆化尚新 + epoch 已 bump 的窗口会把旧口径
  // 载荷写进新代际的键、后续 24h 一直伺服旧口径（本修复即为此，见文件头）
  const includeTrainee = (await createConfigService(c.env.DB).get('squads_include_trainee')) === 'true';
  // 状态集合是内部常量拼的（不含用户输入）；用字面量而非绑定参数，EXPLAIN 计划与测试锁定的形状不变
  const statusList = includeTrainee ? `'normal', 'listed', 'trainee'` : `'normal', 'listed'`;
  const data = await cachedJson(
    // 开关值并进缓存键（见文件头）：翻转后 config 记忆化一过期即换键重算，不再有「旧口径写进新代际键」的窗口
    `squads:all:${includeTrainee}`,
    // roster scope：键只随开关取值、写路径代际 purge 精确失效，所以 TTL 取 24h 只是「键不变时的自愈上限」。
    // 不能因为「同步一天一次」就把它当低频端点——公开面无鉴权，谁都能刷。
    ttlForScope('roster', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const rows = await c.env.DB.prepare(
        `SELECT p.club_id, c.name AS club_name, p.fc_id, ${sqlDisplayName('p')} AS name, p.number,
                CASE WHEN p.status = 'trainee' THEN 'trainee' ELSE 'first_team' END AS squad
         FROM players p
         JOIN clubs c ON c.id = p.club_id
         WHERE p.club_id IS NOT NULL AND p.status IN (${statusList}) AND p.fc_id IS NOT NULL
         ORDER BY c.name, p.fc_id`,
      ).all<SquadRow>();

      // 按 club 分组：SQL 已按队名排好序，这里只做一次线性归并，不引入额外查询
      const squads: {
        clubId: number;
        clubName: string;
        players: { fcId: number; name: string; number: string | null; squad: 'first_team' | 'trainee' }[];
      }[] = [];
      for (const r of rows.results) {
        let squad = squads[squads.length - 1];
        if (!squad || squad.clubId !== r.club_id) {
          squad = { clubId: r.club_id, clubName: r.club_name, players: [] };
          squads.push(squad);
        }
        squad.players.push({ fcId: r.fc_id, name: r.name, number: r.number, squad: r.squad });
      }
      return { squads };
    },
    { scope: 'roster', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
});

export default app;
