// 管理端 · 建队与认证码（§3.2；原 admin.ts 建队域，增量 15 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { authIssueTeamCode, authUnbindTeam, AuthApiError } from '../../authClient.ts';
import { getBoundClub } from '../../binding.ts';
import { getVisibleSeason } from '../../seasons.ts';
import { loadAttendanceModel, loadTierTable, playerInfluenceSum, teamInfluence } from '../../home.ts';
import { deriveClubTier, tierCache } from '../../tier.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

app.post('/clubs', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const body = (await readJson(c)) as { name?: unknown; leagueTier?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const leagueTier = body?.leagueTier;
  if (!name) throw new HttpError(400, '俱乐部名字不能为空');
  if (name.length > 40) throw new HttpError(400, '俱乐部名字最多 40 个字');
  // 增量 9：级别由赛事报名派生（worker/tier.ts），建队不再定级； AUTH_DB 未配置的
  // 回滚通道下仍接受显式定级写休眠列（与旧行为一致），派生通道忽略该参数。
  if (leagueTier !== undefined && leagueTier !== null && leagueTier !== 'premier' && leagueTier !== 'second') {
    throw new HttpError(400, '联赛级别只能是 premier（顶级）或 second（次级）');
  }
  const writeTier = c.env.AUTH_DB ? null : (leagueTier ?? null);
  const club = await c.env.DB.prepare(
    `INSERT INTO clubs (name, league_tier, status, created_at)
     VALUES (?, ?, 'active', ${nowSql()})
     RETURNING id, name, league_tier, status, created_at`,
  )
    .bind(name, writeTier)
    .first<{ id: number; name: string; league_tier: string; status: string; created_at: string }>()
    .catch(() => null);
  if (!club) throw new HttpError(409, '俱乐部名字已存在');
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_create',
    targetType: 'club',
    targetId: club.id,
    after: { name, leagueTier: writeTier },
  });
  return c.json(
    {
      club: {
        id: club.id,
        name: club.name,
        leagueTier: club.league_tier,
        status: club.status,
        createdAt: club.created_at,
      },
    },
    201,
  );
});

app.get('/clubs', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubs = await c.env.DB.prepare(
    'SELECT id, name, league_tier, status, transfer_banned, created_at FROM clubs ORDER BY id LIMIT 200',
  ).all<{ id: number; name: string; league_tier: string; status: string; transfer_banned: number; created_at: string }>();
  // 绑定与认证码真源在 auth 库（增量 7）；AUTH_DB 未配置回落本地休眠表（回滚通道）。
  // 绑定人名字取 auth account.name，不再回查赛事库 user 表。
  const bindings = c.env.AUTH_DB
    ? await c.env.AUTH_DB.prepare(
        `SELECT t.club_id, b.account_id AS user_id, a.name AS user_name, b.bound_at
         FROM team_binding b JOIN team t ON t.id = b.team_id JOIN account a ON a.id = b.account_id
         WHERE t.club_id IS NOT NULL ORDER BY b.account_id LIMIT 200`,
      ).all<{ club_id: number; user_id: number; user_name: string | null; bound_at: string }>()
    : await c.env.DB.prepare(
        'SELECT club_id, user_id, user_name, bound_at FROM club_bindings LIMIT 200',
      ).all<{ club_id: number; user_id: number; user_name: string | null; bound_at: string }>();
  const codes = c.env.AUTH_DB
    ? await c.env.AUTH_DB.prepare(
        `SELECT t.club_id, bc.expires_at, bc.used_by, bc.used_at, bc.created_at
         FROM team_bind_code bc JOIN team t ON t.id = bc.team_id
         WHERE t.club_id IS NOT NULL ORDER BY bc.id DESC LIMIT 200`,
      ).all<{ club_id: number; expires_at: string | null; used_by: number | null; used_at: string | null; created_at: string }>()
    : await c.env.DB.prepare(
        'SELECT club_id, expires_at, used_by, used_at, created_at FROM club_bind_code ORDER BY id DESC LIMIT 200',
      ).all<{ club_id: number; expires_at: string | null; used_by: number | null; used_at: string | null; created_at: string }>();

  const byClub = new Map<number, { userId: number; userName: string | null; boundAt: string }>();
  for (const b of bindings.results) byClub.set(b.club_id, { userId: b.user_id, userName: b.user_name, boundAt: b.bound_at });
  const latestCode = new Map<number, { expiresAt: string | null; usedBy: number | null; usedAt: string | null; createdAt: string }>();
  for (const code of codes.results) {
    if (!latestCode.has(code.club_id)) {
      latestCode.set(code.club_id, {
        expiresAt: code.expires_at,
        usedBy: code.used_by,
        usedAt: code.used_at,
        createdAt: code.created_at,
      });
    }
  }
  // 增量 9：级别改报名派生（按当前可见赛季），休眠列不再回显
  const season = await getVisibleSeason(c.env.DB);
  const cache = tierCache();
  return c.json({
    clubs: await Promise.all(
      clubs.results.map(async (r) => {
        const binding = byClub.get(r.id) ?? null;
        return {
          id: r.id,
          name: r.name,
          leagueTier: await deriveClubTier(c.env, season, r.id, cache),
          status: r.status,
          transferBanned: r.transfer_banned === 1,
          createdAt: r.created_at,
          binding: binding ? { userId: binding.userId, userName: binding.userName ?? null, boundAt: binding.boundAt } : null,
          latestCode: latestCode.get(r.id) ?? null,
        };
      }),
    ),
  });
});

// 转会禁令（增量 10）：冻结/解冻俱乐部转会权限。只拦新动作，既有市场单据走审核面板处置
app.post('/clubs/:id/transfer-ban', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId)) throw new HttpError(400, '俱乐部 ID 不对');
  const body = (await readJson(c)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 2) throw new HttpError(400, '请填写禁令原因（至少 2 个字，会进审计）');
  const result = await c.env.DB.prepare('UPDATE clubs SET transfer_banned = 1 WHERE id = ?').bind(clubId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, '俱乐部不存在');
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'transfer_ban',
    targetType: 'club',
    targetId: clubId,
    after: { reason },
  });
  return c.json({ ok: true });
});

app.delete('/clubs/:id/transfer-ban', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId)) throw new HttpError(400, '俱乐部 ID 不对');
  const result = await c.env.DB.prepare('UPDATE clubs SET transfer_banned = 0 WHERE id = ? AND transfer_banned = 1').bind(clubId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, '俱乐部不存在或本就未冻结');
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'transfer_unban',
    targetType: 'club',
    targetId: clubId,
  });
  return c.json({ ok: true });
});

// 主场域管理（增量 12）：球场档案查看 + 队壳影响力/奖励分/容量/档位维护（球员影响力按规则公式即时算，不落库）
app.get('/clubs/:id/stadium', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const stadium = await c.env.DB
    .prepare('SELECT club_id, name, capacity, tier, shell_influence, bonus_points, fans FROM stadiums WHERE club_id = ?')
    .bind(clubId)
    .first<{ club_id: number; name: string | null; capacity: number; tier: number; shell_influence: number; bonus_points: number; fans: number }>();
  if (!stadium) throw new HttpError(404, '该俱乐部还没有球场档案（存量导入后自动生成）');
  const model = await loadAttendanceModel(c.env.DB);
  const playerSum = await playerInfluenceSum(c.env, clubId, model);
  const facilities = await c.env.DB
    .prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ? ORDER BY facility_key')
    .bind(clubId)
    .all<{ facility_key: string; level: number }>();
  const tierTable = await loadTierTable(c.env.DB);
  return c.json({
    stadium: {
      clubId,
      name: stadium.name,
      capacity: stadium.capacity,
      tier: stadium.tier,
      shellInfluence: stadium.shell_influence,
      bonusPoints: stadium.bonus_points,
      fans: stadium.fans,
    },
    tier: tierTable[String(stadium.tier)] ?? null,
    facilities: facilities.results.map((f) => ({ key: f.facility_key, level: f.level })),
    influence: { players: playerSum, shell: stadium.shell_influence, bonus: stadium.bonus_points, total: teamInfluence(stadium, playerSum) },
  });
});

app.post('/clubs/:id/stadium', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const body = (await readJson(c)) as {
    name?: unknown;
    capacity?: unknown;
    tier?: unknown;
    shellInfluence?: unknown;
    bonusPoints?: unknown;
  } | null;
  const stadium = await c.env.DB.prepare('SELECT club_id FROM stadiums WHERE club_id = ?').bind(clubId).first();
  if (!stadium) throw new HttpError(404, '该俱乐部还没有球场档案');
  const updates: string[] = [];
  const params: unknown[] = [];
  if (body?.name !== undefined) {
    updates.push('name = ?');
    params.push(String(body.name).slice(0, 60));
  }
  if (body?.capacity !== undefined) {
    const cap = Number(body.capacity);
    if (!Number.isInteger(cap) || cap < 5000 || cap > 120000) throw new HttpError(400, '容量应为 5000-120000 的整数');
    updates.push('capacity = ?');
    params.push(cap);
  }
  if (body?.tier !== undefined) {
    const tier = Number(body.tier);
    if (!Number.isInteger(tier) || tier < 0 || tier > 4) throw new HttpError(400, '球场档位应为 0-4');
    const tierTable = await loadTierTable(c.env.DB);
    if (!tierTable[String(tier)]) throw new HttpError(400, '球场档位表里没有这一档');
    updates.push('tier = ?');
    params.push(tier);
  }
  if (body?.shellInfluence !== undefined) {
    const v = Number(body.shellInfluence);
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new HttpError(400, '队壳影响力应为 0-10000 的数值');
    updates.push('shell_influence = ?');
    params.push(v);
  }
  if (body?.bonusPoints !== undefined) {
    const v = Number(body.bonusPoints);
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new HttpError(400, '奖励分应为 0-10000 的数值');
    updates.push('bonus_points = ?');
    params.push(v);
  }
  if (updates.length === 0) throw new HttpError(400, '没有可更新字段（name/capacity/tier/shellInfluence/bonusPoints）');
  updates.push(`updated_at = ${nowSql()}`);
  await c.env.DB.prepare(`UPDATE stadiums SET ${updates.join(', ')} WHERE club_id = ?`).bind(...params, clubId).run();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'stadium_update',
    targetType: 'stadium',
    targetId: clubId,
    after: body as Record<string, unknown>,
  });
  return c.json({ ok: true });
});

app.post('/clubs/:id/bindcode', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId)) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');

  const body = (await readJson(c)) as { expiresInHours?: unknown } | null;
  const hours = body?.expiresInHours === undefined ? 24 : Number(body.expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    throw new HttpError(400, '有效时长须在 1 小时到 30 天之间');
  }
  // 发码走 auth 机器 API（增量 7 中央码表 team_bind_code，按 club_id 解析目录行）
  let issued: { code: string; expiresAt: string };
  try {
    issued = await authIssueTeamCode(c.env, { clubId, hours });
  } catch (e) {
    if (e instanceof AuthApiError) {
      if (e.code === 'team_not_found') {
        throw new HttpError(400, '该俱乐部没有关联的比赛球队，请先在认证中心登记目录并关联后再发码');
      }
      if (e.code === 'unconfigured') throw new HttpError(500, '认证中心通道未配置，请联系管理组');
      throw new HttpError(502, '认证中心暂不可用，请稍后再试');
    }
    throw e;
  }
  // 明码只在这一次响应里出现，审计只记事实不记码
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_bindcode_create',
    targetType: 'club',
    targetId: clubId,
    after: { expiresAt: issued.expiresAt },
  });
  return c.json({ code: issued.code, expiresAt: issued.expiresAt }, 201);
});

app.post('/bindings/unbind', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.bindings.unbind');
  const body = (await readJson(c)) as { userId?: unknown } | null;
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(400, '要解绑的用户 ID 不对');
  // 预查绑定（真源 auth 库）：既做 404 判定，也把目标俱乐部记进本地审计
  const club = await getBoundClub(c.env, userId);
  if (!club) throw new HttpError(404, '该账号没有绑定俱乐部');
  try {
    await authUnbindTeam(c.env, userId);
  } catch (e) {
    if (e instanceof AuthApiError) {
      if (e.code === 'not_bound') throw new HttpError(404, '该账号没有绑定俱乐部');
      if (e.code === 'unconfigured') throw new HttpError(500, '认证中心通道未配置，请联系管理组');
      throw new HttpError(502, '认证中心暂不可用，请稍后再试');
    }
    throw e;
  }
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_unbind',
    targetType: 'club',
    targetId: club.id,
    before: { userId },
  });
  return c.json({ ok: true });
});

export default app;
