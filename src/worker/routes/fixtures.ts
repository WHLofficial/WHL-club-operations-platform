// 场次天气 / 球场 / 上座公开只读面（v6.15.0，🌐 公开）：预留向赛事平台（tour）展示的契约接口。
//
// tour 侧自己持有赛程与比分，这里只补它没有的三块：天气（预报/实际）、球场（名/容量/档位）、
// 上座与三分收入。weather 取值：已确认取 match_attendance.weather（实际），否则 match_weather
// 预报值，都无 → null——公开面**绝不现掷**（掷了就把赛前预报变成赛后随机，TC-PUB-04）。
// 只出主队可解析为平台俱乐部且有球场行的场次（与预报/消费端同口径，CPU 队主场不出）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { assertPublicRate, cachedJson, waitUntilOf } from '../../lib/guard.ts';
import { ttlForScope } from '../../lib/cache-policy.ts';
import { buildRoundView } from '../weather-ops.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/fixtures', async (c) => {
  assertPublicRate(c, 'fixtures');
  const tournamentId = Number(c.req.query('tournament_id'));
  const round = Number(c.req.query('round'));
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournament_id 应为正整数');
  if (!Number.isInteger(round) || round < 0) throw new HttpError(400, 'round 应为非负整数');

  const data = await cachedJson(
    `fixtures:${tournamentId}:${round}`,
    // fixtures scope：固定键（轮次枚举有限），写路径 purge 已覆盖 /api/admin（预报）与确认路径；
    // 1h 只是「漏 purge 时的自愈上限」，与 players 档同级——赛前情报不宜 24h。
    ttlForScope('fixtures', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const view = await buildRoundView(c.env, tournamentId, round);
      const matches = view
        .filter((v) => v.homeClubId !== null && v.stadium !== null)
        .map((v) => ({
          matchId: v.matchId,
          tournamentId,
          round,
          homeClub: { id: v.homeClubId, name: v.homeClubName },
          awayTeamName: v.awayTeamName,
          stageName: v.stageName,
          finished: v.finished,
          stadium: v.stadium,
          weather: v.confirmedWeather ?? v.weather,
          attendance: v.attendance,
          ticket: v.ticket,
          commercial: v.commercial,
          broadcast: v.broadcast,
        }));
      return { tournamentId, round, matches };
    },
    { scope: 'fixtures', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json(data);
});

export default app;
