// 球队同步对账（v6.1.0）：tour 的 team 与 club 的 clubs 按 id 对齐后看三类差异。
// 为什么对账放在 club 侧：club 同时能读 TOUR_DB 和本库，diff 零成本；tour 读不到 club 库，
// 反向拉不出「club 有 tour 无」。这也是**推送失败的兜底入口**——实时推送会因为未配密钥、
// 对端不可达、队名撞车而失败，差异会在这里显形，一键补齐。
//
// 边界：只补「建档」，不补改名。名字不一致只报出来（改名不联动，两侧各自在对应管理端改）。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { pushTeamToTour } from '../../tourClient.ts';
import { createClubFromTourTeam } from './clubs.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// 两侧各最多看 500 行（§17 硬 LIMIT 纪律）；超了就报 truncated，不静默截断当全量
const ROW_LIMIT = 500;

export interface TeamSyncDiff {
  /** 赛事系统有球队、登记册里没有俱乐部 → 可一键建俱乐部 */
  onlyTour: { id: number; name: string }[];
  /** 登记册有俱乐部、赛事系统里没有球队 → 可一键推过去建队 */
  onlyClub: { id: number; name: string }[];
  /** 两侧都有但名字不一致 → 只展示，不自动改（改名不联动） */
  nameDiffers: { id: number; tourName: string; clubName: string }[];
  truncated: boolean;
}

/** 纯函数：两侧按 id 对齐后分类（id 空间一致是v2.3.0 起的前提，不需要映射列）。 */
export function computeTeamSyncDiff(
  tourRows: { id: number; name: string }[],
  clubRows: { id: number; name: string }[],
): Omit<TeamSyncDiff, 'truncated'> {
  const clubById = new Map(clubRows.map((r) => [r.id, r.name]));
  const tourById = new Map(tourRows.map((r) => [r.id, r.name]));
  const onlyTour: TeamSyncDiff['onlyTour'] = [];
  const nameDiffers: TeamSyncDiff['nameDiffers'] = [];
  for (const t of tourRows) {
    const clubName = clubById.get(t.id);
    if (clubName === undefined) onlyTour.push({ id: t.id, name: t.name });
    else if (clubName !== t.name) nameDiffers.push({ id: t.id, tourName: t.name, clubName });
  }
  const onlyClub: TeamSyncDiff['onlyClub'] = [];
  for (const cl of clubRows) {
    if (!tourById.has(cl.id)) onlyClub.push({ id: cl.id, name: cl.name });
  }
  return { onlyTour, onlyClub, nameDiffers };
}

async function loadDiff(env: Env): Promise<TeamSyncDiff> {
  const [tourRows, clubRows] = await Promise.all([
    env.TOUR_DB.prepare('SELECT id, name FROM team ORDER BY id LIMIT ?')
      .bind(ROW_LIMIT)
      .all<{ id: number; name: string }>(),
    env.DB.prepare('SELECT id, name FROM clubs ORDER BY id LIMIT ?')
      .bind(ROW_LIMIT)
      .all<{ id: number; name: string }>(),
  ]);
  return {
    ...computeTeamSyncDiff(tourRows.results, clubRows.results),
    truncated: tourRows.results.length >= ROW_LIMIT || clubRows.results.length >= ROW_LIMIT,
  };
}

app.get('/team-sync', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  return c.json(await loadDiff(c.env));
});

app.post('/team-sync/apply', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const body = (await readJson(c)) as { id?: unknown; action?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '游戏球队 ID 应为正整数');
  const action = body?.action;
  if (action !== 'create-club' && action !== 'create-tour') {
    throw new HttpError(400, '动作只能是 create-club 或 create-tour');
  }
  // 每次重算差异再动手：页面上的清单可能是几分钟前的，照单盲写会把已经补齐的又建一遍
  const diff = await loadDiff(c.env);
  if (action === 'create-club') {
    const row = diff.onlyTour.find((r) => r.id === id);
    if (!row) throw new HttpError(409, '这支队在赛事系统与登记册里已对齐，无需补齐');
    const created = await createClubFromTourTeam(c.env, { gameTeamId: id, name: row.name, operator: user.id, origin: 'user' });
    return c.json({ ok: true, ...created }, 201);
  }
  const row = diff.onlyClub.find((r) => r.id === id);
  if (!row) throw new HttpError(409, '这号在登记册与赛事系统里已对齐，无需补齐');
  const push = await pushTeamToTour(c.env, { id, name: row.name });
  if (!push.ok) throw new HttpError(502, `赛事系统建队失败：${push.message}`);
  return c.json({ ok: true });
});

export default app;
