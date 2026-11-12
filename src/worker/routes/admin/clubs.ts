// 管理端 · 建队与认证码（§3.2；原 admin.ts 建队域，v2.1.0 拆分，行为零变化）
// 契约类型锚点（v6.82.0 第 4 批）：俱乐部列表 / 球场档案 / CPU 接管向导四回执的 c.json 泛型以
// src/contract/batch4.ts 为真源——transferBanned 按 workerReality 去可选等处置见契约型注。
// v6.84.0 反向转换（玩家队 → CPU 队）五步：GET /clubs/:id/to-cpu（预检/复核）、
// POST /clubs/:id/to-cpu/rename-tour | rename-local | unbind-all，文件尾有独立分区。
import { Hono } from 'hono';
import type {
  AdminClubRow,
  CpuConvertState,
  CpuDetachBlocker,
  CpuDetachRenameLocalResult,
  CpuDetachRenameTourResult,
  CpuDetachState,
  CpuDetachUnbindResult,
  CpuRenameLocalResult,
  CpuRenameTourResult,
  CpuSeedOpsResult,
  StadiumAdmin,
} from '../../../contract/batch4.ts';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement, createAuditStatementWithAfterSql, writeAudit, type AuditOrigin } from '../../../lib/audit.ts';
import { authIssueTeamCode, authRegisterTeam, authUnbindTeam, AuthApiError } from '../../authClient.ts';
import { pushTeamToTour, pushTeamRename } from '../../tourClient.ts';
import { getBoundClub } from '../../binding.ts';
import { getVisibleSeason } from '../../seasons.ts';
import { ACTIVE_LISTING_STATES_SQL } from '../../player-flow-state.ts';
import { ledgerReclaimAll } from '../../ledger.ts';
import { voucherReclaimAll } from '../../voucher.ts';
import { loadAttendanceModel, loadTierTable, playerInfluenceSum, teamInfluence, diehardTarget, influenceTierCoef, loadInfluenceTierCoefs } from '../../home.ts';
import { deriveClubTier, tierCache } from '../../tier.ts';
import { FACILITY_KEYS } from '../../stadium-ops.ts';
import { hookTierRecompute } from '../../growth-tier.ts';
import { nationName } from '../../../core/nations.ts';
import { CPU_SUFFIX_RE, cpuSuffixName } from '../../../core/cpu-name.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

/** 队壳国家（FC NationID 空间）：查不到国家名即视为无效 id（不猜、不落库） */
function parseCountry(v: unknown): number {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isInteger(n) || nationName(n) === null) {
    throw new HttpError(400, '必须选择队壳国家（FC 国家编号，如 14 = 英格兰）');
  }
  return n;
}

export interface CreatedClub {
  club: { id: number; name: string; leagueTier: string | null; country: number | null; status: string; createdAt: string };
  authLinked: boolean | null;
}

// v6.27.0 CPU 接管向导：四支 CPU 队的预填种子（来源「v6.27.0 用户表格图」）。
// 级别 1 → premier、级别 2 → second；RB 莱比锡奖励分空按 0 记；表外的队给 null/0，由管理端手填。
const CPU_SEED_PRESETS: Record<number, { leagueTier: 'premier' | 'second'; shellInfluence: number; bonusPoints: number }> = {
  10: { leagueTier: 'second', shellInfluence: 65.75, bonusPoints: 15 },
  241: { leagueTier: 'premier', shellInfluence: 38.65, bonusPoints: 30 },
  112172: { leagueTier: 'second', shellInfluence: 25.57, bonusPoints: 0 },
  131681: { leagueTier: 'premier', shellInfluence: 52.95, bonusPoints: 10 },
};

// 建俱乐部核心（v6.1.0 抽出，三个入口共用）：管理端手填游戏球队 ID、管理端自动在赛事系统建队后、
// 赛事系统建队后经机器通道推过来（routes/internal.ts）。**只管本仓建档**——「tour 里有没有这支队」
// 的判定留在调用方：两个管理端入口先保证 tour 有队，机器通道入口是 tour 刚建完才推来的。
export async function createClubFromTourTeam(
  env: Env,
  {
    gameTeamId,
    name,
    leagueTier,
    country,
    operator,
    origin,
  }: {
    gameTeamId: number;
    name: string;
    leagueTier?: unknown;
    /** 队壳国家（FC NationID）：手动建档必填（路由校验后传入）；批量同步/机器通道没有现实资料可填，留空 */
    country?: unknown;
    operator: number | null;
    origin: AuditOrigin;
  },
): Promise<CreatedClub> {
  if (!name) throw new HttpError(400, '俱乐部名字不能为空');
  if (name.length > 40) throw new HttpError(400, '俱乐部名字最多 40 个字');
  // v1.2.0：级别由赛事报名派生（worker/tier.ts），建队不再定级； AUTH_DB 未配置的
  // 回滚通道下仍接受显式定级写休眠列（与旧行为一致），派生通道忽略该参数。
  if (leagueTier !== undefined && leagueTier !== null && leagueTier !== 'premier' && leagueTier !== 'second') {
    throw new HttpError(400, '联赛级别只能是 premier（顶级）或 second（次级）');
  }
  const writeTier = env.AUTH_DB ? null : (leagueTier ?? null);
  // 队壳国家（v6.48.0 §10.3）：c2「会籍与队壳国家一致」的比对基准，是现实事实、只能人工录。
  // 留空不猜——这些队会进管理端「未设国家的队」提示，球员 c2 记假（不是当命中）。
  const writeCountry = country === undefined || country === null || country === '' ? null : parseCountry(country);
  // id 撞号先查（插入冲突会被名字冲突的 catch 混淆，给不出准话）
  const idTaken = await env.DB.prepare('SELECT id FROM clubs WHERE id = ?').bind(gameTeamId).first<{ id: number }>();
  if (idTaken) throw new HttpError(409, `球队 ID #${gameTeamId} 已被登记册占用`);
  const club = await env.DB.prepare(
    `INSERT INTO clubs (id, name, league_tier, country, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ${nowSql()})
     RETURNING id, name, league_tier, country, status, created_at`,
  )
    .bind(gameTeamId, name, writeTier, writeCountry)
    .first<{ id: number; name: string; league_tier: string | null; country: number | null; status: string; created_at: string }>()
    .catch(() => null);
  if (!club) throw new HttpError(409, '俱乐部名字已存在');
  // actor 可空（audit_log.actor 允许 NULL）：机器通道推来的建档没有本仓管理员身份，
  // 留 NULL 比伪造一个 actor 诚实；是哪条入口推来的由 origin 记。
  await writeAudit(env.DB, {
    actor: operator,
    action: 'club_create',
    targetType: 'club',
    targetId: club.id,
    origin,
    after: { name, gameTeamId, leagueTier: writeTier, country: writeCountry },
  });
  // auth 目录自动建档（v2.3.0）：register upsert 幂等；失败不回滚 clubs 行，留「重新登记」重试
  let authLinked: boolean | null = null;
  if (env.AUTH_DB) {
    try {
      await authRegisterTeam(env, { tourTeamId: gameTeamId, name, clubId: club.id });
      authLinked = true;
    } catch {
      authLinked = false;
    }
  }
  return {
    club: {
      id: club.id,
      name: club.name,
      leagueTier: club.league_tier,
      country: club.country,
      status: club.status,
      createdAt: club.created_at,
    },
    authLinked,
  };
}

app.post('/clubs', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const body = (await readJson(c)) as { name?: unknown; leagueTier?: unknown; gameTeamId?: unknown; country?: unknown } | null;
  // v2.3.0：游戏球队 ID 必填——四个 id 空间一致（tour team.id = auth team.tour_team_id = auth club_id = clubs.id），
  // 建队即指定 id，不再让 D1 自增产生第四套号
  const gameTeamId = Number(body?.gameTeamId);
  if (body?.gameTeamId === undefined || body?.gameTeamId === null || body?.gameTeamId === '') {
    throw new HttpError(400, '必须提供游戏球队 ID（与游戏内球队编号一致）');
  }
  if (!Number.isInteger(gameTeamId) || gameTeamId <= 0) throw new HttpError(400, '游戏球队 ID 应为正整数');
  const bodyName = typeof body?.name === 'string' ? body.name.trim() : '';
  if (bodyName.length > 40) throw new HttpError(400, '俱乐部名字最多 40 个字');
  // tour 校验 + 队名预填：tour 里有这支队就照旧取它的队名；没有则**先推过去建队**（v6.1.0
  // 双向同步的 club → tour 方向）。队名是推得动的先决条件——tour 没队又没填名字时无从建队，
  // 直接挡下（不再要求先去赛事系统手工建队）。
  const tourTeam = await c.env.TOUR_DB.prepare('SELECT id, name FROM team WHERE id = ?')
    .bind(gameTeamId)
    .first<{ id: number; name: string }>();
  const name = bodyName || tourTeam?.name.trim() || '';
  if (!name) throw new HttpError(400, '赛事系统里没有这支球队，请填俱乐部名字（会自动在赛事系统建队）');
  let pushedToTour = false;
  if (!tourTeam) {
    const push = await pushTeamToTour(c.env, { id: gameTeamId, name });
    // 推不过去就不建档：两侧 id 空间一致，单边建档会留下「有俱乐部没球队」的错位
    if (!push.ok) throw new HttpError(502, `赛事系统建队失败：${push.message}`);
    pushedToTour = true;
  }
  const created = await createClubFromTourTeam(c.env, {
    gameTeamId,
    name,
    leagueTier: body?.leagueTier,
    // 手动建档必填（v6.48.0 §10.3）：队壳国家是 c2 的比对基准，缺了这队球员的会籍条件永远判不出
    country: parseCountry(body?.country),
    operator: user.id,
    origin: 'user',
  });
  return c.json({ ...created, pushedToTour }, 201);
});

// 建队时队名预填（v2.3.0）：按游戏球队 ID 查赛事系统队名
app.get('/clubs/tour-team', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const teamId = Number(c.req.query('teamId'));
  if (!Number.isInteger(teamId) || teamId <= 0) throw new HttpError(400, 'teamId 应为正整数');
  const row = await c.env.TOUR_DB.prepare('SELECT id, name FROM team WHERE id = ?')
    .bind(teamId)
    .first<{ id: number; name: string }>();
  if (!row) throw new HttpError(404, '赛事系统里没有这支球队');
  return c.json({ team: { id: row.id, name: row.name } });
});

// 建队后 auth 目录登记重试（v2.3.0）：register upsert 幂等，失败即可重按
app.post('/clubs/:id/register-auth', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(id).first<{ id: number; name: string }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  if (!c.env.AUTH_DB) throw new HttpError(400, '当前未接入认证中心（回滚通道），无需登记');
  try {
    await authRegisterTeam(c.env, { tourTeamId: club.id, name: club.name, clubId: club.id });
  } catch (e) {
    if (e instanceof AuthApiError) throw new HttpError(502, `认证中心登记失败：${e.message}`);
    throw e;
  }
  return c.json({ ok: true });
});

app.get('/clubs', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubs = await c.env.DB.prepare(
    'SELECT id, name, league_tier, country, status, transfer_banned, is_cpu, created_at FROM clubs ORDER BY id LIMIT 200',
  ).all<{ id: number; name: string; league_tier: string; country: number | null; status: string; transfer_banned: number; is_cpu: number; created_at: string }>();
  // 绑定与认证码真源在 auth 库（v1.0.0）；AUTH_DB 未配置回落本地休眠表（回滚通道）。
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

  // v2.3.0：多教练同队——一个俱乐部可挂多个绑定行，全部返回（前端逐个可解绑）
  const byClub = new Map<number, { userId: number; userName: string | null; boundAt: string }[]>();
  for (const b of bindings.results) {
    const list = byClub.get(b.club_id) ?? [];
    list.push({ userId: b.user_id, userName: b.user_name, boundAt: b.bound_at });
    byClub.set(b.club_id, list);
  }
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
  // v1.2.0：级别改报名派生（按当前可见赛季），休眠列不再回显
  const season = await getVisibleSeason(c.env.DB);
  const cache = tierCache();
  return c.json<{ clubs: AdminClubRow[] }>({
      clubs: await Promise.all(
        clubs.results.map(async (r) => ({
          id: r.id,
          name: r.name,
          leagueTier: await deriveClubTier(c.env, season, r.id, cache),
          // v6.48.0：队壳国家（档位 c2 的比对基准）——null = 未设，前端标「未设国家」提示补录
          country: r.country,
          countryName: nationName(r.country),
          status: r.status,
          transferBanned: r.transfer_banned === 1,
          isCpu: r.is_cpu === 1,
          createdAt: r.created_at,
          bindings: byClub.get(r.id) ?? [],
          latestCode: latestCode.get(r.id) ?? null,
        })),
      ),
  });
});

// 队壳国家（v6.48.0 §10.3）：c2「会籍与队壳国家一致」的比对基准，是现实事实、只能人工录。
// 建档时必填，建错/换壳后在这里改；改一次即重算该队球员档位（只写差异，人工锁定行不动）。
app.post('/clubs/:id/country', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const body = (await readJson(c)) as { country?: unknown } | null;
  const country = parseCountry(body?.country);
  const club = await c.env.DB.prepare('SELECT id, country FROM clubs WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; country: number | null }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  await c.env.DB.prepare('UPDATE clubs SET country = ? WHERE id = ?').bind(country, clubId).run();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_country_set',
    targetType: 'club',
    targetId: clubId,
    origin: 'user',
    before: { country: club.country },
    after: { country, countryName: nationName(country) },
  });
  const tier = await hookTierRecompute(c.env.DB, { kind: 'clubs', clubIds: [clubId] }, { actor: user.id, origin: 'user' });
  return c.json({ ok: true, country, countryName: nationName(country), tier });
});

// 转会禁令（v1.3.0）：冻结/解冻俱乐部转会权限。只拦新动作，既有市场单据走审核面板处置
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
    origin: 'user',
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
    origin: 'user',
  });
  return c.json({ ok: true });
});

// 主场域管理（v1.5.0）：球场档案查看 + 队壳影响力/奖励分/容量/档位维护（球员影响力按规则公式即时算，不落库）
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
  // v6.28.0 A 段：级别按报名派生（CPU 队/未报名 → null → 系数 1.0，与运行时同口径）
  const tierCoef = influenceTierCoef(await loadInfluenceTierCoefs(c.env.DB), await deriveClubTier(c.env, await getVisibleSeason(c.env.DB), clubId));
  const facilities = await c.env.DB
    .prepare('SELECT facility_key, level FROM club_facilities WHERE club_id = ? ORDER BY facility_key')
    .bind(clubId)
    .all<{ facility_key: string; level: number }>();
  const tierTable = await loadTierTable(c.env.DB);
  return c.json<StadiumAdmin>({
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
    influence: {
      players: playerSum,
      shell: stadium.shell_influence,
      bonus: stadium.bonus_points,
      tierCoef,
      total: teamInfluence(stadium, playerSum, tierCoef),
    },
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
    origin: 'user',
    after: body as Record<string, unknown>,
  });
  return c.json({ ok: true });
});

// ---- v6.27.0 CPU 接管向导（管理端四步：读现状 → 改 tour 侧队名 → 改本仓队名 → 铺主场基建）----

// ① 只读聚合：接管前把队况 / tour 侧队 / 基建现状 / 绑定人 / 预填建议一次给全
app.get('/clubs/:id/cpu-convert', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id, name, is_cpu, league_tier, status FROM clubs WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; name: string; is_cpu: number; league_tier: string | null; status: string }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  const tourTeam = await c.env.TOUR_DB.prepare('SELECT id, name FROM team WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; name: string }>();
  const stadium = await c.env.DB.prepare('SELECT club_id FROM stadiums WHERE club_id = ?').bind(clubId).first();
  const ledger = await c.env.DB.prepare('SELECT club_id FROM ledger_accounts WHERE club_id = ?').bind(clubId).first();
  const facilities = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM club_facilities WHERE club_id = ?')
    .bind(clubId)
    .first<{ n: number }>();
  // 绑定人单队版（与 GET /clubs 同口径：AUTH_DB 优先，未配置回落本地休眠表）
  const binding = c.env.AUTH_DB
    ? await c.env.AUTH_DB.prepare(
        `SELECT b.account_id AS user_id, a.name AS user_name, b.bound_at
         FROM team_binding b JOIN team t ON t.id = b.team_id JOIN account a ON a.id = b.account_id
         WHERE t.club_id = ? ORDER BY b.account_id LIMIT 1`,
      )
        .bind(clubId)
        .first<{ user_id: number; user_name: string | null; bound_at: string }>()
    : await c.env.DB.prepare('SELECT user_id, user_name, bound_at FROM club_bindings WHERE club_id = ? LIMIT 1')
        .bind(clubId)
        .first<{ user_id: number; user_name: string | null; bound_at: string }>();
  // 建议新队名：去掉结尾「(CPU)」后缀；整名都被剥空就退回原名
  const stripped = club.name.replace(/\s*\(CPU\)\s*$/, '');
  const preset = CPU_SEED_PRESETS[clubId] ?? null;
  const shellInfluence = preset?.shellInfluence ?? 0;
  const bonusPoints = preset?.bonusPoints ?? 0;
  const model = await loadAttendanceModel(c.env.DB);
  const playerSum = await playerInfluenceSum(c.env, clubId, model);
  // v6.28.0 A 段：预览与 seed-ops 用同一套系数——级别按报名派生（CPU 队未报名定级赛事 → null → 1.0），
  // 不拿向导预填的 preset.leagueTier：那份只是给人填表看的建议值，运行时（上座/关窗）也按派生级别算。
  const tierCoef = influenceTierCoef(await loadInfluenceTierCoefs(c.env.DB), await deriveClubTier(c.env, await getVisibleSeason(c.env.DB), clubId));
  return c.json<CpuConvertState>({
    club: { id: club.id, name: club.name, isCpu: club.is_cpu === 1, leagueTier: club.league_tier, status: club.status },
    tour: tourTeam ? { id: tourTeam.id, name: tourTeam.name } : null,
    infra: { stadium: !!stadium, ledger: !!ledger, facilities: facilities?.n ?? 0 },
    binding: binding
      ? { bound: true, userId: binding.user_id, userName: binding.user_name, boundAt: binding.bound_at }
      : { bound: false, userId: null, userName: null, boundAt: null },
    suggest: {
      newName: stripped || club.name,
      shellInfluence,
      bonusPoints,
      leagueTier: preset?.leagueTier ?? null,
      diehardTarget: diehardTarget(
        model,
        teamInfluence({ shell_influence: shellInfluence, bonus_points: bonusPoints }, playerSum, tierCoef),
      ),
    },
  });
});

// ② 改 tour 侧队名：失败本仓零改动、无审计（可重试）
app.post('/clubs/:id/rename-tour', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id, is_cpu FROM clubs WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; is_cpu: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  if (club.is_cpu !== 1) return c.json({ error: 'not_cpu', message: '该俱乐部不是 CPU 队，无需接管' }, 409);
  const body = (await readJson(c)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, '队名不能为空');
  if (name.length > 40) throw new HttpError(400, '队名最多 40 个字');
  const push = await pushTeamRename(c.env, { id: clubId, name });
  if (!push.ok) {
    return c.json({ error: 'tour_sync_failed', message: push.message || '对手方改名失败，请稍后重试' }, 502);
  }
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_cpu_rename_tour',
    targetType: 'club',
    targetId: clubId,
    origin: 'user',
    after: { name },
  });
  return c.json<CpuRenameTourResult>({ ok: true, renamed: push.renamed, name: push.name ?? name });
});

// ③ 改本仓队名并摘掉 CPU 标记：幂等（重放返回 changed:false），撞 clubs.name UNIQUE 给 409
app.post('/clubs/:id/rename-local', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  const body = (await readJson(c)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, '队名不能为空');
  if (name.length > 40) throw new HttpError(400, '队名最多 40 个字');
  let changed = false;
  try {
    const res = await c.env.DB.prepare('UPDATE clubs SET name = ?, is_cpu = 0 WHERE id = ? AND is_cpu = 1')
      .bind(name, clubId)
      .run();
    changed = (res.meta.changes ?? 0) > 0;
  } catch (e) {
    // 撞名给可判别的 409；别的 SQL 错误照旧冒泡 500
    if (/UNIQUE/i.test(String((e as Error)?.message ?? ''))) {
      return c.json({ error: 'name_taken', message: '已有俱乐部使用该名字' }, 409);
    }
    throw e;
  }
  if (!changed) return c.json<CpuRenameLocalResult>({ ok: true, changed: false });
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_cpu_rename_local',
    targetType: 'club',
    targetId: clubId,
    origin: 'user',
    after: { name },
  });
  return c.json<CpuRenameLocalResult>({ ok: true, changed: true, name });
});

// ④ 铺主场基建：球场 + 账本 + 五类设施 + 联赛级别，一次 batch 全幂等。
// 只建不改：已有行一律 DO NOTHING（重放零写入、updated_at 不变）；改值走主场/设施既有入口。
app.post('/clubs/:id/seed-ops', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  const body = (await readJson(c)) as {
    stadiumName?: unknown;
    shellInfluence?: unknown;
    bonusPoints?: unknown;
    leagueTier?: unknown;
  } | null;
  const stadiumName = typeof body?.stadiumName === 'string' ? body.stadiumName.trim() : '';
  if (!stadiumName) throw new HttpError(400, '球场名字不能为空');
  if (stadiumName.length > 60) throw new HttpError(400, '球场名字最多 60 个字');
  const shellInfluence = Number(body?.shellInfluence);
  if (!Number.isFinite(shellInfluence) || shellInfluence < 0 || shellInfluence > 10000) {
    throw new HttpError(400, '队壳影响力应为 0-10000 的数值');
  }
  const bonusPoints = Number(body?.bonusPoints);
  if (!Number.isFinite(bonusPoints) || bonusPoints < 0 || bonusPoints > 10000) {
    throw new HttpError(400, '奖励分应为 0-10000 的数值');
  }
  const leagueTier = body?.leagueTier === 'premier' ? 'premier' : body?.leagueTier === 'second' ? 'second' : null;
  if (!leagueTier) throw new HttpError(400, '联赛级别只能是 premier（顶级）或 second（次级）');
  const model = await loadAttendanceModel(c.env.DB);
  const playerSum = await playerInfluenceSum(c.env, clubId, model);
  // v6.28.0 A 段：与 cpu-convert 预览必须同一套系数（否则向导预填的 diehardTarget 与实际写入不一致）
  const tierCoef = influenceTierCoef(await loadInfluenceTierCoefs(c.env.DB), await deriveClubTier(c.env, await getVisibleSeason(c.env.DB), clubId));
  const fans = diehardTarget(
    model,
    teamInfluence({ shell_influence: shellInfluence, bonus_points: bonusPoints }, playerSum, tierCoef),
  );
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at)
       VALUES (?, ?, 12000, 0, ?, ?, ?, ${nowSql()}, ${nowSql()}) ON CONFLICT(club_id) DO NOTHING`,
    ).bind(clubId, stadiumName, shellInfluence, bonusPoints, fans),
    c.env.DB.prepare(
      `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, 0, ${nowSql()}) ON CONFLICT(club_id) DO NOTHING`,
    ).bind(clubId),
    ...FACILITY_KEYS.map((key) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO club_facilities (club_id, facility_key, level, updated_at) VALUES (?, ?, 0, ${nowSql()})`,
      ).bind(clubId, key),
    ),
    c.env.DB.prepare('UPDATE clubs SET league_tier = ? WHERE id = ?').bind(leagueTier, clubId),
  ];
  const results = await c.env.DB.batch(stmts);
  const created = {
    stadium: (results[0]?.meta.changes ?? 0) > 0,
    ledger: (results[1]?.meta.changes ?? 0) > 0,
    facilities: results.slice(2, 2 + FACILITY_KEYS.length).filter((r) => (r?.meta.changes ?? 0) > 0).length,
  };
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_cpu_seed_ops',
    targetType: 'club',
    targetId: clubId,
    origin: 'user',
    // stadiumCreated=false 表示球场行本就存在、上面的壳/奖励/fans 没落库（只建不改）；
    // 联赛级别那条是无条件 UPDATE，永远生效。
    after: { shellInfluence, bonusPoints, leagueTier, fans, stadiumCreated: created.stadium },
  });
  return c.json<CpuSeedOpsResult>({ ok: true, created, leagueTier });
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
  // 发码走 auth 机器 API（v1.0.0 中央码表 team_bind_code，按 club_id 解析目录行）
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
    origin: 'user',
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
    origin: 'user',
    before: { userId },
  });
  return c.json({ ok: true });
});

// ==================== v6.84.0 玩家队 → CPU 队反向转换（五步向导） ====================
// 转换 = 改队名 + is_cpu=1 + transfer_banned=0 + 现金/券退出流通；阵容、合同、球场、级别、status 全不动。
// 步①预检与步⑤复核共用 GET /to-cpu：checks 是复核六项，blockers 是硬阻断、warnings 只提示。

/** 半角 (CPU) 结尾（容忍尾随空格：赛事系统队名可能带空格）——实现已移至 src/core/cpu-name.ts */
export { cpuSuffixName };

/** 队名问题的统一判定（预检的 suggest.nameError 用；两个改名端点各自抛 400） */
function detachNameError(name: string, taken: boolean): string | null {
  if (name.length > 40) return '队名最多 40 个字';
  if (taken) return '已有俱乐部使用该名字';
  return null;
}

interface DetachCheck {
  key: string;
  label: string;
  /** 命中时的说明（n > 0 才调用） */
  detail: (n: number) => string;
  /** 唯一计数口径：只返回单行单列 COUNT。预检的计数与写侧 NOT EXISTS 都由它生成，两处永不漂移 */
  countSql: (clubId: number) => { sql: string; params: unknown[] };
}

const CPU_DETACH_CHECKS: DetachCheck[] = [
  {
    key: 'negotiation',
    label: '进行中的转会谈判',
    detail: (n) => `${n} 笔转会谈判仍在进行，先谈完或取消`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM negotiation_sessions WHERE club_id = ? AND status = 'active'`,
      params: [id],
    }),
  },
  {
    key: 'listing',
    label: '未终态的挂牌',
    detail: (n) => `${n} 条挂牌仍在挂牌/竞价/待审，先撤单或走完流程`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM listings WHERE seller_club_id = ? AND status IN ${ACTIVE_LISTING_STATES_SQL}`,
      params: [id],
    }),
  },
  {
    key: 'offer',
    label: '未决报价',
    detail: (n) => `${n} 条报价还在等买卖双方处理`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM offers WHERE (buyer_club_id = ? OR seller_club_id = ?) AND status IN ('pending', 'intent')`,
      params: [id, id],
    }),
  },
  {
    key: 'transfer',
    label: '在途过户',
    detail: (n) => `${n} 笔过户处于待审或签约中`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM transfers WHERE (from_club_id = ? OR to_club_id = ?) AND status IN ('pending_review', 'signing')`,
      params: [id, id],
    }),
  },
  {
    key: 'contract_demand',
    label: '未决合同诉求',
    detail: (n) => `${n} 条球员合同诉求未终结（待回应/已还价/待签）`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM contract_demands WHERE club_id = ? AND status IN ('pending', 'countered', 'accepted')`,
      params: [id],
    }),
  },
  {
    key: 'fund_hold',
    label: '冻结中的资金',
    detail: (n) => `${n} 笔资金仍被冻结，先等冻结结算或释放`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM fund_holds WHERE club_id = ? AND status = 'held'`,
      params: [id],
    }),
  },
  {
    key: 'review',
    label: '未处理的审核任务',
    detail: (n) => `${n} 条与本队相关的审核任务未处理`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM review_tasks rt
            WHERE rt.status = 'open' AND (
              (rt.type = 'transfer_confirm' AND EXISTS (
                SELECT 1 FROM transfers t WHERE t.id = rt.ref_id AND (t.from_club_id = ? OR t.to_club_id = ?)))
              OR (rt.type = 'activation_report' AND EXISTS (
                SELECT 1 FROM listings l WHERE l.id = rt.ref_id AND l.seller_club_id = ?))
            )`,
      params: [id, id, id],
    }),
  },
  {
    key: 'naming',
    label: '生效中的冠名合同',
    detail: (n) => `${n} 份冠名合同仍生效，先解约或等合同结束`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM naming_contracts WHERE club_id = ? AND status = 'active'`,
      params: [id],
    }),
  },
  {
    key: 'venue',
    label: '当前窗口的档期预订',
    detail: (n) => `当前开放窗内还有 ${n} 条档期预订，先把档期改回空置`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM venue_bookings b
            JOIN season_windows w ON w.season = b.season AND w.window_seq = b.window_seq
            WHERE b.club_id = ? AND w.status = 'open'`,
      params: [id],
    }),
  },
  {
    key: 'event',
    label: '未结算的随机事件',
    detail: (n) => `${n} 个随机事件仍待结算`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM event_occurrences WHERE club_id = ? AND status = 'pending'`,
      params: [id],
    }),
  },
  {
    key: 'shop_order',
    label: '待审的消费工单',
    detail: (n) => `${n} 笔消费工单待审，先审完或拒绝退款`,
    countSql: (id) => ({
      sql: `SELECT COUNT(*) FROM shop_orders WHERE club_id = ? AND status = 'pending'`,
      params: [id],
    }),
  },
];

function detachCountQueries(clubId: number): { check: DetachCheck; query: { sql: string; params: unknown[] } }[] {
  return CPU_DETACH_CHECKS.map((check) => ({ check, query: check.countSql(clubId) }));
}

/** 一次查询拿全部阻断计数（列名 c0..cN，顺序同 CPU_DETACH_CHECKS） */
async function readDetachCounts(db: D1Database, clubId: number): Promise<Map<string, number>> {
  const queries = detachCountQueries(clubId);
  const sql = `SELECT ${queries.map(({ query }, i) => `(${query.sql}) AS c${i}`).join(', ')}`;
  const row = await db
    .prepare(sql)
    .bind(...queries.flatMap(({ query }) => query.params))
    .first<Record<string, number>>();
  return new Map(queries.map(({ check }, i) => [check.key, Number(row?.[`c${i}`] ?? 0)]));
}

/** rename-local 的 NOT EXISTS 组：与预检计数同源（每项 0 条才算干净） */
function detachGuard(clubId: number): { sql: string; params: unknown[] } {
  const queries = detachCountQueries(clubId);
  return {
    sql: queries.map(({ query }) => `(${query.sql}) = 0`).join(' AND '),
    params: queries.flatMap(({ query }) => query.params),
  };
}

function blockersFromCounts(counts: Map<string, number>): CpuDetachBlocker[] {
  const out: CpuDetachBlocker[] = [];
  for (const check of CPU_DETACH_CHECKS) {
    const n = counts.get(check.key) ?? 0;
    if (n > 0) out.push({ key: check.key, label: check.label, detail: check.detail(n) });
  }
  return out;
}

/** 该队全部绑定（AUTH_DB 优先，未配置回落本地休眠表；与 GET /clubs 同口径） */
async function readDetachBindings(
  env: Env,
  clubId: number,
): Promise<{ userId: number; userName: string | null; boundAt: string }[]> {
  const rows = env.AUTH_DB
    ? await env.AUTH_DB.prepare(
        `SELECT b.account_id AS user_id, a.name AS user_name, b.bound_at
         FROM team_binding b JOIN team t ON t.id = b.team_id JOIN account a ON a.id = b.account_id
         WHERE t.club_id = ? ORDER BY b.account_id`,
      )
        .bind(clubId)
        .all<{ user_id: number; user_name: string | null; bound_at: string }>()
    : await env.DB.prepare(
        `SELECT user_id, user_name, bound_at FROM club_bindings WHERE club_id = ? ORDER BY user_id`,
      )
        .bind(clubId)
        .all<{ user_id: number; user_name: string | null; bound_at: string }>();
  return rows.results.map((r) => ({ userId: r.user_id, userName: r.user_name, boundAt: r.bound_at }));
}

/** 未使用且未过期的绑定码（仅提示：解绑后请在发码入口确认作废） */
async function readDetachCodes(
  env: Env,
  clubId: number,
): Promise<{ expiresAt: string | null; createdAt: string }[]> {
  const rows = env.AUTH_DB
    ? await env.AUTH_DB.prepare(
        `SELECT bc.expires_at, bc.created_at FROM team_bind_code bc JOIN team t ON t.id = bc.team_id
         WHERE t.club_id = ? AND bc.used_at IS NULL AND (bc.expires_at IS NULL OR bc.expires_at > ${nowSql()})
         ORDER BY bc.id DESC`,
      )
        .bind(clubId)
        .all<{ expires_at: string | null; created_at: string }>()
    : await env.DB.prepare(
        `SELECT expires_at, created_at FROM club_bind_code
         WHERE club_id = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ${nowSql()})
         ORDER BY id DESC`,
      )
        .bind(clubId)
        .all<{ expires_at: string | null; created_at: string }>();
  return rows.results.map((r) => ({ expiresAt: r.expires_at, createdAt: r.created_at }));
}

// ① 预检 / ⑤ 复核：同一端点。bindings 全量、contracts/players/balance 只做展示，阻断口径与写侧同源。
app.get('/clubs/:id/to-cpu', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id, name, is_cpu, league_tier, status FROM clubs WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; name: string; is_cpu: number; league_tier: string | null; status: string }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');

  const tourTeam = await c.env.TOUR_DB.prepare('SELECT id, name FROM team WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; name: string }>();
  const bindings = await readDetachBindings(c.env, clubId);
  const warnings: CpuDetachBlocker[] = [];
  let codes: { expiresAt: string | null; createdAt: string }[] = [];
  let codesReadable = true;
  try {
    codes = await readDetachCodes(c.env, clubId);
  } catch {
    // 码表口径变了也不能把预检打成 500：降级成「看不到码」并提示
    codesReadable = false;
    warnings.push({
      key: 'codes_unavailable',
      label: '暂时读不到绑定码',
      detail: '无法确认是否还有未使用的绑定码；解绑后请到发码入口人工确认。',
    });
  }

  const contractRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active FROM contracts WHERE club_id = ?',
  )
    .bind(clubId)
    .first<{ total: number; active: number }>();
  const playerRow = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE club_id = ?')
    .bind(clubId)
    .first<{ n: number }>();
  const funds = await c.env.DB.prepare(
    'SELECT COALESCE(balance, 0) AS balance, COALESCE(vouchers, 0) AS vouchers FROM ledger_accounts WHERE club_id = ?',
  )
    .bind(clubId)
    .first<{ balance: number; vouchers: number }>();
  const balance = Number(funds?.balance ?? 0);
  const vouchers = Number(funds?.vouchers ?? 0);

  const counts = await readDetachCounts(c.env.DB, clubId);
  const blockers = blockersFromCounts(counts);

  const suggestName = cpuSuffixName(club.name);
  const taken = await c.env.DB.prepare('SELECT id FROM clubs WHERE name = ? AND id <> ?')
    .bind(suggestName, clubId)
    .first<{ id: number }>();
  const nameError = detachNameError(suggestName, !!taken);

  if (!tourTeam) {
    warnings.push({
      key: 'tour_missing',
      label: '赛事系统还没有该队',
      detail: '本仓改名不受影响；对手方改名会失败，可稍后在赛事系统补建球队再重试。',
    });
  }
  if (codes.length > 0) {
    warnings.push({
      key: 'unused_codes',
      label: '还有未使用的绑定码',
      detail: `${codes.length} 个绑定码未使用；转换后请到发码入口确认作废，避免再被绑回该队。`,
    });
  }
  // 招商轮（C3）只提示不阻断：轮次本身不锁定俱乐部资产，但转换后不会有人跟进。
  // 轮次 settled 后的 queued 同样要提示——它们仍可能被关窗批转成 active 冠名。
  const market = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM market_offers o JOIN market_rounds r ON r.id = o.round_id
     WHERE o.club_id = ? AND o.status IN ('pending', 'queued') AND r.status IN ('open', 'settled')`,
  )
    .bind(clubId)
    .first<{ n: number }>();
  if ((market?.n ?? 0) > 0) {
    warnings.push({
      key: 'market_queue',
      label: '招商轮仍有排队意向',
      detail: `有 ${market?.n ?? 0} 条招商意向在开放轮次中排队，转成 CPU 后不会有人跟进。`,
    });
  }

  const checks = {
    isCpu: club.is_cpu === 1,
    tourName: !tourTeam || CPU_SUFFIX_RE.test(tourTeam.name),
    localName: CPU_SUFFIX_RE.test(club.name),
    bindings: bindings.length === 0,
    codes: !codesReadable || codes.length === 0,
    funds: balance === 0 && vouchers === 0,
  };
  // codes 属软性（只提示），ready 只看硬性 checks + 硬阻断；资金必须已清零
  const ready =
    checks.isCpu && checks.tourName && checks.localName && checks.bindings && checks.funds && blockers.length === 0;

  return c.json<CpuDetachState>({
    club: { id: club.id, name: club.name, isCpu: club.is_cpu === 1, leagueTier: club.league_tier, status: club.status },
    tour: tourTeam ? { id: tourTeam.id, name: tourTeam.name } : null,
    bindings,
    unusedCodes: codes,
    contracts: { active: contractRow?.active ?? 0, total: contractRow?.total ?? 0 },
    players: playerRow?.n ?? 0,
    balance,
    vouchers,
    suggest: { newName: suggestName, nameError },
    blockers,
    warnings,
    checks,
    ready,
  });
});

// ② 改 tour 侧队名：失败本仓零改动、无审计（可重试）；同名时 renamed=false 也零写入
app.post('/clubs/:id/to-cpu/rename-tour', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  const body = (await readJson(c)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, '队名不能为空');
  if (!name.endsWith('(CPU)')) throw new HttpError(400, 'CPU 队名须以半角 (CPU) 结尾');
  if (name.length > 40) throw new HttpError(400, '队名最多 40 个字');
  const before = await c.env.TOUR_DB.prepare('SELECT id, name FROM team WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; name: string }>();
  const push = await pushTeamRename(c.env, { id: clubId, name });
  if (!push.ok) {
    // 对手方失败：本仓、账本、审计都不动
    return c.json({ error: 'tour_sync_failed', message: push.message || '对手方改名失败，请稍后重试' }, 502);
  }
  const finalName = push.name ?? name;
  if (push.renamed) {
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'club_cpu_detach_tour',
      targetType: 'club',
      targetId: clubId,
      origin: 'user',
      after: { from: before?.name ?? null, to: finalName },
    });
  }
  return c.json<CpuDetachRenameTourResult>({ ok: true, renamed: push.renamed, name: finalName });
});

// ③ 本仓改名 + 翻 CPU + 现金/券退出流通（同一 D1 batch，守卫与预检同源）
app.post('/clubs/:id/to-cpu/rename-local', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id, name, is_cpu, transfer_banned FROM clubs WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; name: string; is_cpu: number; transfer_banned: number | null }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  const body = (await readJson(c)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, '队名不能为空');
  if (!name.endsWith('(CPU)')) throw new HttpError(400, 'CPU 队名须以半角 (CPU) 结尾');
  if (name.length > 40) throw new HttpError(400, '队名最多 40 个字');

  // 重放：已是 CPU 且名字一致 → 零写入（预检 ready 后重复点「转换」）
  if (club.is_cpu === 1 && club.name === name) {
    return c.json<CpuDetachRenameLocalResult>({ ok: true, changed: false, flipped: false, name: club.name });
  }
  const blockers = blockersFromCounts(await readDetachCounts(c.env.DB, clubId));
  if (blockers.length > 0) {
    return c.json({ error: 'blocked', message: '还有未了结的事项，先处理完再做转换', blockers }, 409);
  }
  // 修复场景：已经是 CPU、只是名字不对（例如后缀拼错）——同样过阻断，但只改名、不再回收
  const repair = club.is_cpu === 1;

  const guard = detachGuard(clubId);
  const updateSql = repair
    ? `UPDATE clubs SET name = ? WHERE id = ? AND is_cpu = 1 AND ${guard.sql}`
    : `UPDATE clubs SET name = ?, is_cpu = 1, transfer_banned = 0 WHERE id = ? AND is_cpu = 0 AND ${guard.sql}`;
  // 审计与 UPDATE 同生共死：名字落库且 is_cpu/transfer_banned 已是目标值才留痕
  const updateGuard = repair
    ? '(SELECT name FROM clubs WHERE id = ?) = ? AND (SELECT is_cpu FROM clubs WHERE id = ?) = 1'
    : '(SELECT name FROM clubs WHERE id = ?) = ? AND (SELECT is_cpu FROM clubs WHERE id = ?) = 1 AND (SELECT transfer_banned FROM clubs WHERE id = ?) = 0';
  const updateGuardParams = repair ? [clubId, name, clubId] : [clubId, name, clubId, clubId];

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(updateSql).bind(name, clubId, ...guard.params),
  ];
  if (!repair) {
    // 金额由 SQL 读当前余额，不再用 batch 前的快照：并发扣款/加款时也能一次清零，
    // 且流水金额与审计金额都取实际值。
    stmts.push(
      ...ledgerReclaimAll(c.env.DB, {
        clubId,
        kind: 'cpu_detach_reclaim',
        refType: 'club_cpu_detach',
        refId: clubId,
        memo: '玩家队转 CPU：现金余额退出流通',
        guardSql: updateGuard,
        guardParams: updateGuardParams,
      }),
    );
    stmts.push(
      ...voucherReclaimAll(c.env.DB, {
        clubId,
        kind: 'cpu_detach_reclaim',
        refType: 'club_cpu_detach',
        refId: clubId,
        memo: '玩家队转 CPU：消费券退出流通',
        guardSql: updateGuard,
        guardParams: updateGuardParams,
      }),
    );
  }
  const before = { name: club.name, isCpu: club.is_cpu === 1, transferBanned: club.transfer_banned === 1 };
  if (repair) {
    stmts.push(
      createAuditStatement(c.env.DB)({
        actor: user.id,
        action: 'club_cpu_detach_local',
        targetType: 'club',
        targetId: clubId,
        origin: 'user',
        before,
        after: { from: club.name, to: name, isCpu: true, transferBanned: false, repair },
        guardSql: updateGuard,
        guardParams: updateGuardParams,
      }),
    );
  } else {
    // 回收金额在 batch 内取实际流水合计；审计守卫同时要求账户已清零，避免 finding 2 的残额/谎报。
    const auditAfterSql = `json_object(
      'from', ?, 'to', ?, 'isCpu', json('true'), 'transferBanned', json('false'),
      'balanceBefore', COALESCE(-(SELECT SUM(amount) FROM ledger_entries WHERE club_id = ? AND kind = 'cpu_detach_reclaim' AND ref_type = 'club_cpu_detach' AND ref_id = ?), 0),
      'balanceReclaimed', COALESCE(-(SELECT SUM(amount) FROM ledger_entries WHERE club_id = ? AND kind = 'cpu_detach_reclaim' AND ref_type = 'club_cpu_detach' AND ref_id = ?), 0),
      'vouchersBefore', COALESCE(-(SELECT SUM(amount) FROM voucher_entries WHERE club_id = ? AND kind = 'cpu_detach_reclaim' AND ref_type = 'club_cpu_detach' AND ref_id = ?), 0),
      'vouchersReclaimed', COALESCE(-(SELECT SUM(amount) FROM voucher_entries WHERE club_id = ? AND kind = 'cpu_detach_reclaim' AND ref_type = 'club_cpu_detach' AND ref_id = ?), 0)
    )`;
    const auditGuard = `${updateGuard} AND COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0) = 0 AND COALESCE((SELECT vouchers FROM ledger_accounts WHERE club_id = ?), 0) = 0`;
    stmts.push(
      createAuditStatementWithAfterSql(
        c.env.DB,
        {
          actor: user.id,
          action: 'club_cpu_detach_local',
          targetType: 'club',
          targetId: clubId,
          origin: 'user',
          before,
          guardSql: auditGuard,
          guardParams: [...updateGuardParams, clubId, clubId],
        },
        auditAfterSql,
        [club.name, name, clubId, clubId, clubId, clubId, clubId, clubId, clubId, clubId],
      ),
    );
  }

  let flipped = false;
  try {
    const results = await c.env.DB.batch(stmts);
    flipped = (results[0]?.meta.changes ?? 0) > 0;
  } catch (e) {
    // 撞名给可判别的 409（整批已回滚，本仓零改动）；别的 SQL 错误照旧冒泡 500
    if (/UNIQUE/i.test(String((e as Error)?.message ?? ''))) {
      return c.json({ error: 'name_taken', message: '已有俱乐部使用该名字' }, 409);
    }
    throw e;
  }
  if (!flipped) {
    // 并发/状态变了：重查一次，能确认「已是 CPU 且同名」就按幂等返回，否则把当前阻断回给前端
    const now = await c.env.DB.prepare('SELECT name, is_cpu FROM clubs WHERE id = ?')
      .bind(clubId)
      .first<{ name: string; is_cpu: number }>();
    if (now && now.is_cpu === 1 && now.name === name) {
      return c.json<CpuDetachRenameLocalResult>({ ok: true, changed: false, flipped: false, name: now.name });
    }
    const current = blockersFromCounts(await readDetachCounts(c.env.DB, clubId));
    return c.json(
      {
        error: 'blocked',
        message: '转换条件已变化，请刷新预检后重试',
        blockers:
          current.length > 0
            ? current
            : [{ key: 'state_changed', label: '俱乐部状态已变化', detail: '请刷新预检后重试' }],
      },
      409,
    );
  }
  return c.json<CpuDetachRenameLocalResult>({ ok: true, changed: true, flipped: !repair, name });
});

// ④ 解绑全部账号：执行时重查真源，逐个解绑；not_bound 视为已解绑，其他失败收集后继续（不回滚、可重试）
app.post('/clubs/:id/to-cpu/unbind-all', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.bindings.unbind');
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id, is_cpu FROM clubs WHERE id = ?')
    .bind(clubId)
    .first<{ id: number; is_cpu: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');
  if (club.is_cpu !== 1) throw new HttpError(409, '该队还不是 CPU 队，请先完成第③步');
  const bindings = await readDetachBindings(c.env, clubId);
  const unbound: number[] = [];
  const alreadyUnbound: number[] = [];
  const failed: CpuDetachUnbindResult['failed'] = [];
  for (const binding of bindings) {
    try {
      await authUnbindTeam(c.env, binding.userId);
      unbound.push(binding.userId);
      await writeAudit(c.env.DB, {
        actor: user.id,
        action: 'club_cpu_detach_unbind',
        targetType: 'club',
        targetId: clubId,
        origin: 'user',
        before: { userId: binding.userId },
      });
    } catch (e) {
      if (e instanceof AuthApiError) {
        if (e.code === 'not_bound') {
          alreadyUnbound.push(binding.userId); // 另一入口已解绑：不算失败
          continue;
        }
        failed.push({ userId: binding.userId, code: e.code, message: e.message });
        continue;
      }
      throw e;
    }
  }
  return c.json<CpuDetachUnbindResult>({ ok: failed.length === 0, unbound, alreadyUnbound, failed });
});

export default app;
