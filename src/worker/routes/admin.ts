// 管理端路由（附录 A〔1〕，🛡=requireAdmin 全覆盖）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireAdmin } from '../../lib/session.ts';
import { createAuditStatement, writeAudit } from '../../lib/audit.ts';
import { authIssueTeamCode, authUnbindTeam, AuthApiError } from '../authClient.ts';
import { getBoundClub } from '../binding.ts';
import { createConfigService } from '../../core/config.ts';
import { confirmImport, previewImport } from '../players-import.ts';
import { confirmContractsImport, previewContractsImport } from '../contracts-import.ts';
import { checkSquad, type SquadPlayer } from '../../core/squad-rules.ts';
import { getVisibleSeason } from '../seasons.ts';
import { adminVoidBid, adminForceSettle, adminForceVoid, adminForceSign, adminCancelSigning, requireReason } from '../market-intervene.ts';
import { ledgerMovement } from '../ledger.ts';
import { loadSquadContext } from '../squad-context.ts';
import { loadTransfer, rejectTransfer } from '../transfers.ts';
import { approveTransferDeal, createForcedAuction, cancelForcedAuction } from '../bypass.ts';
import { listWindows, openWindow, closeWindow } from '../window-machine.ts';
import { queueResults, confirmResult } from '../results.ts';
import { xpForEvent, recordGrowthEvent, runGrowthSettlement, type GrowthEventType } from '../growth.ts';
import { deriveClubTier, tierCache } from '../tier.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

async function readJson(c: { req: { raw: Request } }): Promise<unknown> {
  return c.req.raw.json().catch(() => null);
}

// ---- 建队与认证码（§3.2） ----

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

// ---- config 键注册表（§13，涉密键掩码） ----

app.get('/config', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const service = createConfigService(c.env.DB);
  return c.json({ config: await service.listMasked() });
});

// ---- 球员管理（PATCH 白名单字段，审计留痕） ----

const PLAYER_STATUS = ['normal', 'listed', 'trainee', 'free', 'retired'] as const;

const PLAYER_PATCH_FIELDS = [
  'marketValue',
  'status',
  'growthTier',
  'isFutureStar',
  'growable',
  'prestige',
  'badgesSilver',
  'badgesGold',
  'ca',
  'baseCa',
  'pa',
] as const;

// PATCH /players/:id 与 /players/batch 共用的字段校验（增量 10 批量维护）
function parsePlayerUpdates(body: Record<string, unknown>): { updates: Record<string, unknown>; errors: string[] } {
  const updates: Record<string, unknown> = {};
  const errors: string[] = [];
  if ('marketValue' in body) {
    const v = body.marketValue;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) errors.push('身价须为非负数值');
    else updates.market_value = v;
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !(PLAYER_STATUS as readonly string[]).includes(body.status)) {
      errors.push('状态只能是 normal / listed / trainee / free / retired');
    } else updates.status = body.status;
  }
  if ('growthTier' in body) {
    const v = Number(body.growthTier);
    if (!Number.isInteger(v) || v < 1 || v > 5) errors.push('成长档位须在 1-5 之间');
    else updates.growth_tier = v;
  }
  if ('isFutureStar' in body) {
    const v = Number(body.isFutureStar);
    if (v !== 0 && v !== 1) errors.push('未来之星只能是 0 或 1');
    else updates.is_future_star = v;
  }
  if ('ca' in body) {
    const v = body.ca;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 99)) errors.push('CA 须在 1-99 之间');
    else updates.ca = v;
  }
  if ('baseCa' in body) {
    const v = body.baseCa;
    // 初始CA（规则 4.2.2 限额口径）：导入时定格，管理端修正走这里（留审计）
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 99)) errors.push('初始CA 须在 1-99 之间');
    else updates.base_ca = v;
  }
  if ('pa' in body) {
    const v = body.pa;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 99)) errors.push('PA 须在 1-99 之间');
    else updates.pa = v;
  }
  if ('growable' in body) {
    const v = Number(body.growable);
    if (v !== 0 && v !== 1) errors.push('可成长标记只能是 0 或 1');
    else updates.growable = v;
  }
  if ('prestige' in body) {
    const v = body.prestige;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5)) errors.push('国际声望须在 1-5 之间');
    else updates.prestige = v;
  }
  if ('badgesSilver' in body) {
    const v = Number(body.badgesSilver);
    if (!Number.isInteger(v) || v < 0 || v > 15) errors.push('银徽章数须在 0-15 之间');
    else updates.badges_silver = v;
  }
  if ('badgesGold' in body) {
    const v = Number(body.badgesGold);
    if (!Number.isInteger(v) || v < 0 || v > 3) errors.push('金徽章数须在 0-3 之间');
    else updates.badges_gold = v;
  }
  const unknown = Object.keys(body).filter((k) => !(PLAYER_PATCH_FIELDS as readonly string[]).includes(k));
  if (unknown.length > 0) errors.push(`不支持的字段：${unknown.join('、')}`);
  return { updates, errors };
}

const PLAYER_BATCH_MAX = 200;

app.patch('/players/:id', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.players.import');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '球员 ID 不对');
  const body = (await readJson(c)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求格式不对');

  const { updates, errors } = parsePlayerUpdates(body);
  if (errors.length > 0) throw new HttpError(400, errors[0]);
  if (Object.keys(updates).length === 0) throw new HttpError(400, '没有可更新的字段');

  const current = await c.env.DB.prepare(
    'SELECT id, market_value, status, growth_tier, is_future_star, growable, prestige, badges_silver, badges_gold, ca, base_ca, pa FROM players WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: number;
      market_value: number | null;
      status: string;
      growth_tier: number;
      is_future_star: number;
      growable: number;
      prestige: number | null;
      badges_silver: number;
      badges_gold: number;
      ca: number | null;
      base_ca: number | null;
      pa: number | null;
    }>();
  if (!current) throw new HttpError(404, '球员不存在');

  const cols = Object.keys(updates);
  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE players SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ${nowSql()} WHERE id = ?`,
    ).bind(...cols.map((k) => updates[k]), id),
    audit({
      actor: user.id,
      action: 'player_patch',
      targetType: 'player',
      targetId: id,
      before: Object.fromEntries(cols.map((k) => [k, current[k as keyof typeof current]])),
      after: updates,
    }),
  ]);
  return c.json({ ok: true });
});

// 批量维护（PRD 4.8）：一次原子批改多球员的任意 PATCH 白名单字段；任一项出错则整批不落库
app.post('/players/batch', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.players.import');
  const body = (await readJson(c)) as { items?: unknown } | null;
  if (!body || !Array.isArray(body.items)) throw new HttpError(400, '请求格式不对：需要 items 数组');
  if (body.items.length === 0) throw new HttpError(400, 'items 不能为空');
  if (body.items.length > PLAYER_BATCH_MAX) throw new HttpError(400, `单批最多 ${PLAYER_BATCH_MAX} 名球员`);

  const items = body.items as { id?: unknown }[];
  const updatesList: { id: number; updates: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = Number(item?.id);
    if (!Number.isInteger(id) || id <= 0) {
      errors.push(`第 ${i + 1} 项：球员 ID 不对`);
      continue;
    }
    const { id: _ignored, ...fields } = item as Record<string, unknown>;
    const { updates, errors: itemErrors } = parsePlayerUpdates(fields);
    if (itemErrors.length > 0) errors.push(`第 ${i + 1} 项：${itemErrors[0]}`);
    else if (Object.keys(updates).length === 0) errors.push(`第 ${i + 1} 项：没有可更新的字段`);
    else updatesList.push({ id, updates });
  }
  if (errors.length > 0) throw new HttpError(400, errors.join('；'));

  const ids = updatesList.map((u) => u.id);
  const placeholders = ids.map(() => '?').join(',');
  type PlayerCurrent = {
    id: number;
    market_value: number | null;
    status: string;
    growth_tier: number;
    is_future_star: number;
    growable: number;
    prestige: number | null;
    badges_silver: number;
    badges_gold: number;
    ca: number | null;
    base_ca: number | null;
    pa: number | null;
  };
  const { results } = await c.env.DB.prepare(
    `SELECT id, market_value, status, growth_tier, is_future_star, growable, prestige, badges_silver, badges_gold, ca, base_ca, pa FROM players WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<PlayerCurrent>();
  const currentById = new Map(results.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !currentById.has(id));
  if (missing.length > 0) throw new HttpError(400, `球员不存在：${missing.join('、')}`);

  const audit = createAuditStatement(c.env.DB);
  const statements = updatesList.map((u) => {
    const cur = currentById.get(u.id)!;
    const cols = Object.keys(u.updates);
    return [
      c.env.DB.prepare(
        `UPDATE players SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ${nowSql()} WHERE id = ?`,
      ).bind(...cols.map((k) => u.updates[k]), u.id),
      audit({
        actor: user.id,
        action: 'player_batch',
        targetType: 'player',
        targetId: u.id,
        before: Object.fromEntries(cols.map((k) => [k, cur[k as keyof PlayerCurrent]])),
        after: u.updates,
      }),
    ];
  });
  await c.env.DB.batch(statements.flat());
  return c.json({ ok: true, updated: updatesList.length });
});

// ---- 导入管线两段式（§5.4：通道 A/B 球员，通道 C 名单合同模板） ----

app.post('/players/import/preview', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.players.import');
  const body = await readJson(c);
  if ((body as { channel?: unknown } | null)?.channel === 'C') {
    return c.json(await previewContractsImport(c.env, body));
  }
  return c.json(await previewImport(c.env, body));
});

app.post('/players/import/confirm', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.players.import');
  const body = await readJson(c);
  if ((body as { channel?: unknown } | null)?.channel === 'C') {
    return c.json(await confirmContractsImport(c.env, user.id, body));
  }
  return c.json(await confirmImport(c.env, user.id, body));
});

// ---- 期初余额导入（§14.1，kind=opening_import；幂等：已导入的俱乐部跳过） ----

app.post('/ledger/opening-import', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await readJson(c)) as { rows?: unknown } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'rows 应为非空数组');
  if (rows.length > 500) throw new HttpError(400, '单次最多 500 行');

  const parsed = rows.map((r, i) => {
    const item = r as { clubId?: unknown; balance?: unknown } | null;
    const clubId = Number(item?.clubId);
    const balance = Number(item?.balance);
    if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, `第 ${i + 1} 行：俱乐部 ID 不对`);
    if (!Number.isFinite(balance) || balance < 0) throw new HttpError(400, `第 ${i + 1} 行：余额须为非负数值`);
    if (balance > 1e9) throw new HttpError(400, `第 ${i + 1} 行：余额超出合理范围`);
    return { clubId, balance };
  });
  const seen = new Set<number>();
  for (const r of parsed) {
    if (seen.has(r.clubId)) throw new HttpError(400, '同一俱乐部在一批里出现了多次');
    seen.add(r.clubId);
  }

  const ids = [...seen];
  const found = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rowsFound = await c.env.DB.prepare(`SELECT id FROM clubs WHERE id IN (${placeholders})`)
      .bind(...slice)
      .all<{ id: number }>();
    for (const f of rowsFound.results) found.add(f.id);
  }
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(400, `这些俱乐部还不存在：${missing.join('、')}`);

  const imported = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rowsDone = await c.env.DB.prepare(
      `SELECT DISTINCT club_id FROM ledger_entries WHERE kind = 'opening_import' AND club_id IN (${placeholders})`,
    )
      .bind(...slice)
      .all<{ club_id: number }>();
    for (const r of rowsDone.results) imported.add(r.club_id);
  }
  const todo = parsed.filter((r) => !imported.has(r.clubId));
  const audit = createAuditStatement(c.env.DB);
  if (todo.length > 0) {
    const statements = todo.flatMap((r) => [
      c.env.DB.prepare(
        `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, ?, ${nowSql()})
         ON CONFLICT(club_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
      ).bind(r.clubId, r.balance),
      c.env.DB.prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at)
         VALUES (?, 'opening_import', ?, ?, '期初余额导入', ${nowSql()})`,
      ).bind(r.clubId, r.balance, r.balance),
    ]);
    statements.push(
      audit({
        actor: user.id,
        action: 'ledger_opening_import',
        targetType: 'ledger',
        after: { written: todo.length, skipped: parsed.length - todo.length },
      }),
    );
    await c.env.DB.batch(statements); // 流水 + 余额 + 审计一个 batch 提交（§7.4-1）
  }
  return c.json({ written: todo.length, skipped: parsed.length - todo.length });
});

// ---- 手动记账兜底（§7.1 manual_adjust / prize_*，P0 奖金模板入口；§9.1） ----

const MANUAL_KIND_RE = /^(manual_adjust|prize_[a-z_]+)$/;

app.post('/ledger/manual', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await readJson(c)) as { clubId?: unknown; kind?: unknown; amount?: unknown; memo?: unknown } | null;
  const clubId = Number(body?.clubId);
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, '俱乐部 ID 不对');
  const kind = typeof body?.kind === 'string' ? body.kind.trim() : '';
  if (!MANUAL_KIND_RE.test(kind)) throw new HttpError(400, '流水类型只能是 manual_adjust 或 prize_*');
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, '金额要是不为 0 的数字（正入账负出账）');
  if (kind !== 'manual_adjust' && amount < 0) {
    throw new HttpError(400, '奖金只能入账，要冲账请选「手动调整」走负数');
  }
  const memo = typeof body?.memo === 'string' ? body.memo.trim() : '';
  if (!memo) throw new HttpError(400, '备注要写清楚这笔钱的来由，方便以后对账');
  if (memo.length > 200) throw new HttpError(400, '备注最多 200 字');

  const club = await c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '找不到这支俱乐部');

  // manual 允许重复记（兜底工具，审计逐笔留痕），不走 (kind, ref) 幂等闸
  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    ...ledgerMovement(c.env.DB, {
      clubId,
      delta: amount,
      kind,
      refType: 'manual',
      refId: null,
      memo,
      idempotent: false,
    }),
    audit({
      actor: user.id,
      action: 'ledger_manual',
      targetType: 'club',
      targetId: clubId,
      after: { kind, amount, memo },
    }),
  ]);
  const acct = await c.env.DB.prepare('SELECT balance FROM ledger_accounts WHERE club_id = ?')
    .bind(clubId)
    .first<{ balance: number }>();
  return c.json({ ok: true, balance: acct?.balance ?? 0 }, 201);
});

// ---- 赛季管理与赛果确认（附录 A〔6〕，§11） ----

const COMPETITION_TYPES = ['league_premier', 'league_second', 'champions_cup', 'super_cup', 'qualifying'] as const;

app.post('/seasons', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { season?: unknown } | null;
  const season = Number(body?.season);
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const audit = createAuditStatement(c.env.DB);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO seasons (season, status, created_at) VALUES (?, 'preparing', ${nowSql()})`).bind(season),
      audit({ actor: user.id, action: 'season_create', targetType: 'season', targetId: season }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这个赛季已经存在');
    throw err;
  }
  return c.json({ ok: true, season }, 201);
});

app.get('/seasons', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const rows = await c.env.DB.prepare('SELECT season, status FROM seasons ORDER BY season DESC').all<{
    season: number;
    status: string;
  }>();
  return c.json({ seasons: rows.results });
});

// 绑定赛事到赛季（增量 6.1 层级修订：赛季是上级，赛事与窗口并列——赛事绑赛季、窗口只管转会准入）。
// 一座赛事只进一个赛季（库上唯一约束，防同一场比赛双份进赛果队列）；赛季已结算后不得再绑
app.post('/seasons/:id/bind-tournament', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const body = (await readJson(c)) as { tournamentId?: unknown; competitionType?: unknown } | null;
  const tournamentId = Number(body?.tournamentId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournamentId 应为正整数');
  const competitionType = body?.competitionType;
  if (typeof competitionType !== 'string' || !(COMPETITION_TYPES as readonly string[]).includes(competitionType)) {
    throw new HttpError(400, '竞赛类型只能是 league_premier / league_second / champions_cup / super_cup / qualifying');
  }

  const tournament = await c.env.TOUR_DB.prepare('SELECT id, name FROM tournament WHERE id = ?')
    .bind(tournamentId)
    .first<{ id: number; name: string }>();
  if (!tournament) throw new HttpError(404, '比赛系统里找不到这座赛事');

  const seasonRow = await c.env.DB.prepare('SELECT status FROM seasons WHERE season = ?').bind(season).first<{ status: string }>();
  if (!seasonRow) throw new HttpError(404, '赛季不存在，先建档再绑赛事');
  if (seasonRow.status === 'settled') throw new HttpError(409, '这个赛季已经结算，不能再绑赛事');

  const audit = createAuditStatement(c.env.DB);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO season_tournaments (season, tournament_id, competition_type, created_at) VALUES (?, ?, ?, ${nowSql()})`,
      ).bind(season, tournamentId, competitionType),
      audit({
        actor: user.id,
        action: 'season_bind_tournament',
        targetType: 'season',
        targetId: season,
        after: { season, tournamentId, competitionType },
      }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这座赛事已经绑过赛季了（一座赛事只进一个赛季）');
    throw err;
  }
  return c.json({ ok: true, tournament: { id: tournament.id, name: tournament.name } });
});

// 某赛季的赛事绑定列表（管理端「赛季与赛事绑定」用；赛事名前端经 /tournaments 下拉映射）
app.get('/seasons/:id/tournaments', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const rows = await c.env.DB.prepare(
    'SELECT id, tournament_id, competition_type FROM season_tournaments WHERE season = ? ORDER BY id',
  )
    .bind(season)
    .all<{ id: number; tournament_id: number; competition_type: string | null }>();
  return c.json({
    bindings: rows.results.map((r) => ({ id: r.id, tournamentId: r.tournament_id, competitionType: r.competition_type })),
  });
});

// 解绑：该赛事还没有任何确认入档赛果时才允许（防结算后改账）
app.post('/seasons/:id/unbind-tournament', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const season = Number(c.req.param('id'));
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const body = (await readJson(c)) as { tournamentId?: unknown } | null;
  const tournamentId = Number(body?.tournamentId);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) throw new HttpError(400, 'tournamentId 应为正整数');

  const binding = await c.env.DB.prepare('SELECT id FROM season_tournaments WHERE season = ? AND tournament_id = ?')
    .bind(season, tournamentId)
    .first<{ id: number }>();
  if (!binding) throw new HttpError(404, '这座赛事没有绑在这个赛季上');
  const confirmed = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM result_confirmations WHERE tournament_id = ?')
    .bind(tournamentId)
    .first<{ n: number }>();
  if ((confirmed?.n ?? 0) > 0) throw new HttpError(409, '这座赛事已经有确认入档的赛果，不能解绑');

  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM season_tournaments WHERE id = ?').bind(binding.id),
    audit({
      actor: user.id,
      action: 'season_unbind_tournament',
      targetType: 'season',
      targetId: season,
      after: { season, tournamentId },
    }),
  ]);
  return c.json({ ok: true });
});

// 赛事下拉：比赛系统赛事列表（只读跨库）
app.get('/tournaments', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const rows = await c.env.TOUR_DB.prepare('SELECT id, name, status FROM tournament ORDER BY id DESC LIMIT 100').all<{
    id: number;
    name: string;
    status: string;
  }>();
  return c.json({ tournaments: rows.results });
});

app.get('/results/queue', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json(await queueResults(c.env));
});

app.post('/results/:id/confirm', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const { result, xp } = await confirmResult(c.env, user.id, c.req.param('id'));
  return c.json({ ok: true, result, xp }, 201);
});

// ---- 成长引擎管理端（附录 A〔6〕，§10；公开端点在 routes/growth.ts） ----

// 补录：评分/扑救/夺回球权等比赛系统没有的数据；XP 由服务端按 §10.1 计算
app.post('/growth/events', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown; matchRef?: unknown; eventType?: unknown; value?: unknown } | null;
  const playerId = Number(body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

  const eventType = body?.eventType;
  const MANUAL_TYPES = ['appearance', 'rating', 'clean_sheet', 'duels_won', 'saves'] as const;
  if (typeof eventType !== 'string' || !(MANUAL_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpError(400, 'event_type 只能是 appearance / rating / clean_sheet / duels_won / saves');
  }
  let value = body?.value === undefined || body?.value === null ? 1 : Number(body?.value);
  if (eventType === 'rating') {
    if (!Number.isFinite(value) || value < 7 || value > 10) throw new HttpError(400, '评分要在 7.0-10.0 之间，7.0 以下不给 XP');
    value = Math.round(value * 10) / 10;
  } else if (eventType === 'duels_won' || eventType === 'saves') {
    if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, '次数要是正整数');
  }
  const xp = xpForEvent(eventType as GrowthEventType, value);
  if (xp <= 0) throw new HttpError(400, '这个数值达不到记 XP 的标准');

  const matchRef = typeof body?.matchRef === 'string' && body.matchRef.trim() !== '' ? body.matchRef.trim().slice(0, 40) : `manual:${Date.now()}`;
  const recorded = await recordGrowthEvent(c.env.DB, {
    playerId,
    matchRef,
    season: await getVisibleSeason(c.env.DB),
    windowSeq: null,
    eventType: eventType as GrowthEventType,
    value,
    xp,
    source: 'manual',
    recordedBy: user.id,
  });
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'growth_manual_event',
    targetType: 'player',
    targetId: playerId,
    after: { eventType, value, xp, matchRef, duplicate: !recorded },
  });
  return c.json({ ok: true, xp, duplicate: !recorded }, recorded ? 201 : 200);
});

app.post('/growth/settlement/run', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { season?: unknown; half?: unknown } | null;
  const summary = await runGrowthSettlement(c.env, user.id, body?.season, body?.half);
  return c.json({ ok: true, ...summary });
});

// 档位核定（§10.3）：条件叠加由管理组按现实资料判断，平台只落核定结果与审计
app.post('/growth/:playerId/tier', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await readJson(c)) as { tier?: unknown } | null;
  const tier = Number(body?.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new HttpError(400, '档位只能是 1-5');
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE players SET growth_tier = ?, updated_at = ${nowSql()} WHERE id = ?`).bind(tier, playerId),
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_tier_set',
      targetType: 'player',
      targetId: playerId,
      after: { tier },
    }),
  ]);
  return c.json({ ok: true, tier });
});

// ---- M0 货币监控（PRD：M0 = Σ俱乐部余额报表，观察通胀；附录 A〔6〕🛡） ----

app.get('/m0', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const [m0, held, kinds, clubs] = await Promise.all([
    c.env.DB.prepare('SELECT COALESCE(SUM(balance), 0) AS m0 FROM ledger_accounts').first<{ m0: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS held FROM fund_holds WHERE status = 'held'").first<{ held: number }>(),
    c.env.DB.prepare('SELECT kind, SUM(amount) AS total, COUNT(*) AS n FROM ledger_entries GROUP BY kind ORDER BY total LIMIT 30').all<{
      kind: string;
      total: number;
      n: number;
    }>(),
    c.env.DB.prepare(
      `SELECT c.id, c.name, COALESCE(a.balance, 0) AS balance
       FROM clubs c LEFT JOIN ledger_accounts a ON a.club_id = c.id
       ORDER BY a.balance DESC, c.id LIMIT 200`,
    ).all<{ id: number; name: string; balance: number }>(),
  ]);
  return c.json({
    m0: m0?.m0 ?? 0,
    held: held?.held ?? 0,
    available: (m0?.m0 ?? 0) - (held?.held ?? 0),
    byKind: kinds.results,
    byClub: clubs.results,
  });
});

// ---- 注册快照与准入体检（附录 A〔2〕） ----

// GET /api/admin/registrations?season= —— 注册快照按俱乐部分组；season 缺省取最新有快照的赛季
app.get('/registrations', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const seasonParam = c.req.query('season');
  let season: number | null = null;
  if (seasonParam !== undefined) {
    const n = Number(seasonParam);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'season 应为正整数');
    season = n;
  } else {
    const latest = await c.env.DB.prepare('SELECT MAX(season) AS s FROM registrations').first<{ s: number | null }>();
    season = latest?.s ?? null;
  }
  if (season === null) return c.json({ season: null, clubs: [] });

  const rows = await c.env.DB.prepare(
    `SELECT r.club_id, r.player_id, r.squad, p.name AS player_name,
            c.name AS club_name, ct.wage
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     JOIN clubs c ON c.id = r.club_id
     LEFT JOIN contracts ct ON ct.player_id = r.player_id AND ct.is_active = 1 AND ct.club_id = r.club_id
     WHERE r.season = ? ORDER BY r.club_id, r.squad, p.name LIMIT 2000`,
  )
    .bind(season)
    .all<{
      club_id: number;
      player_id: number;
      squad: string;
      player_name: string;
      club_name: string;
      wage: number | null;
    }>();

  // 增量 9：级别改报名派生，不再读 clubs.league_tier 休眠列
  const cache = tierCache();
  const tiers = new Map<number, 'premier' | 'second' | null>();
  for (const r of rows.results) {
    if (!tiers.has(r.club_id)) tiers.set(r.club_id, await deriveClubTier(c.env, season, r.club_id, cache));
  }

  const byClub = new Map<number, { clubId: number; clubName: string; leagueTier: string | null; players: { playerId: number; name: string; squad: string }[]; wageTotal: number }>();
  for (const r of rows.results) {
    let club = byClub.get(r.club_id);
    if (!club) {
      club = { clubId: r.club_id, clubName: r.club_name, leagueTier: tiers.get(r.club_id) ?? null, players: [], wageTotal: 0 };
      byClub.set(r.club_id, club);
    }
    club.players.push({ playerId: r.player_id, name: r.player_name, squad: r.squad });
    club.wageTotal += r.wage ?? 0;
  }
  const clubs = [...byClub.values()].map((club) => ({
    clubId: club.clubId,
    clubName: club.clubName,
    leagueTier: club.leagueTier,
    firstTeam: club.players.filter((p) => p.squad === 'first_team').length,
    trainee: club.players.filter((p) => p.squad === 'trainee').length,
    wageTotal: Math.round(club.wageTotal * 100) / 100,
    players: club.players.map((p) => ({ playerId: p.playerId, name: p.name, squad: p.squad })),
  }));
  return c.json({ season, clubs });
});

// GET /api/admin/compliance?season= —— 准入体检报告（P1 首版：只报告，不触发强制拍卖）
// 用当前 CA/PA/合同对快照重跑合规引擎，抓「注册后属性/合同漂移」导致的违规。
app.get('/compliance', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.compliance.view');
  const seasonParam = c.req.query('season');
  let season: number | null;
  if (seasonParam !== undefined) {
    const n = Number(seasonParam);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'season 应为正整数');
    season = n;
  } else {
    season = await getVisibleSeason(c.env.DB);
  }
  if (season === null) return c.json({ season: null, clubs: [] });

  const clubs = await c.env.DB.prepare('SELECT id, name FROM clubs ORDER BY id LIMIT 200').all<{
    id: number;
    name: string;
  }>();
  const regRows = await c.env.DB.prepare(
    `SELECT r.club_id, r.player_id, r.squad, p.name, p.position, p.ca, p.pa, p.base_ca, p.growable,
            ct.player_id AS contract_player_id, ct.wage
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     LEFT JOIN contracts ct ON ct.player_id = r.player_id AND ct.is_active = 1 AND ct.club_id = r.club_id
     WHERE r.season = ? ORDER BY r.club_id LIMIT 2000`,
  )
    .bind(season)
    .all<{
      club_id: number;
      player_id: number;
      squad: string;
      name: string;
      position: string | null;
      ca: number | null;
      pa: number | null;
      base_ca: number | null;
      growable: number;
      contract_player_id: number | null;
      wage: number | null;
    }>();

  const cache = tierCache();
  const report = await Promise.all(
    clubs.results.map(async (club) => {
      const mine = regRows.results.filter((r) => r.club_id === club.id);
      // 增量 9：级别报名派生；派生不到（未报名定级赛事）标 tier_missing，不再静默当 premier
      const tier = await deriveClubTier(c.env, season, club.id, cache);
      if (mine.length === 0) {
        return {
          clubId: club.id,
          clubName: club.name,
          leagueTier: tier,
          pass: false,
          issues: [{ rule: 'not_registered', message: '本赛季还没提交注册名单', playerIds: [] }],
          stats: null,
        };
      }
      if (tier === null) {
        return {
          clubId: club.id,
          clubName: club.name,
          leagueTier: null,
          pass: false,
          issues: [{ rule: 'tier_missing', message: '未定级：本赛季没有报名任何定级赛事（顶级/次级联赛）', playerIds: [] }],
          stats: null,
        };
      }
      const toSp = (r: (typeof mine)[number]): SquadPlayer => ({
        playerId: r.player_id,
        name: r.name,
        position: r.position,
        ca: r.ca,
        pa: r.pa,
        initialCa: r.base_ca ?? r.ca,
        growable: r.growable === 1,
        hasContract: r.contract_player_id !== null,
        wage: r.contract_player_id !== null ? r.wage ?? 0 : null,
      });
      const firstTeam = mine.filter((r) => r.squad === 'first_team').map(toSp);
      const trainee = mine.filter((r) => r.squad === 'trainee').map(toSp);
      const rules = await loadSquadContext(c.env.DB, tier);
      const result = checkSquad(firstTeam, trainee, rules);
      return {
        clubId: club.id,
        clubName: club.name,
        leagueTier: tier,
        pass: result.pass,
        issues: result.issues,
        stats: result.stats,
      };
    }),
  );
  return c.json({ season, clubs: report });
});

// ---- 审核队列（附录 A〔3〕：转会成交确认；关键节点人工审） ----

interface ReviewTaskRow {
  id: number;
  status: string;
  payload: string | null;
  decided_by: number | null;
  decided_at: string | null;
  note: string | null;
  transfer_id: number;
  transfer_status: string;
  transfer_type: string;
  fee: number | null;
  tax: number | null;
  extra_fee: number | null;
  player_id: number;
  player_name: string;
  position: string | null;
  ca: number | null;
  pa: number | null;
  from_name: string | null;
  to_name: string | null;
}

// GET /api/admin/reviews?status=open —— 成交确认队列
app.get('/reviews', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const status = c.req.query('status') ?? 'open';
  if (!['open', 'approved', 'rejected', 'all'].includes(status)) throw new HttpError(400, 'status 只能是 open / approved / rejected / all');
  const where = status === 'all' ? "rt.type = 'transfer_confirm'" : `rt.type = 'transfer_confirm' AND rt.status = ?`;
  const rows = await c.env.DB.prepare(
    `SELECT rt.id, rt.status, rt.payload, rt.decided_by, rt.decided_at, rt.note,
            t.id AS transfer_id, t.status AS transfer_status, t.type AS transfer_type, t.fee, t.tax, t.extra_fee,
            t.player_id, p.name AS player_name, p.position, p.ca, p.pa,
            cf.name AS from_name, ct.name AS to_name
     FROM review_tasks rt
     JOIN transfers t ON t.id = rt.ref_id
     JOIN players p ON p.id = t.player_id
     LEFT JOIN clubs cf ON cf.id = t.from_club_id
     LEFT JOIN clubs ct ON ct.id = t.to_club_id
     WHERE ${where}
     ORDER BY rt.id DESC LIMIT 100`,
  )
    .bind(...(status === 'all' ? [] : [status]))
    .all<ReviewTaskRow>();
  return c.json({
    reviews: rows.results.map((r) => ({
      id: r.id,
      status: r.status,
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
      note: r.note,
      decidedAt: r.decided_at,
      transfer: {
        id: r.transfer_id,
        type: r.transfer_type,
        status: r.transfer_status,
        fee: r.fee,
        tax: r.tax,
        extraFee: r.extra_fee,
        player: { id: r.player_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
        fromClubName: r.from_name,
        toClubName: r.to_name,
      },
    })),
  });
});

async function loadOpenReviewTask(db: D1Database, taskId: number) {
  const task = await db
    .prepare(`SELECT id, ref_id, status FROM review_tasks WHERE id = ? AND type = 'transfer_confirm'`)
    .bind(taskId)
    .first<{ id: number; ref_id: number; status: string }>();
  if (!task) throw new HttpError(404, '审核任务不存在');
  if (task.status !== 'open') throw new HttpError(409, '这条审核已经处理过了');
  return task;
}

// POST /api/admin/reviews/:id/approve —— 批准成交（§6.3/§6.7）
// 解约：无工资谈判，批准即过户；续约/匹配/海捞：先收附加费再进签约谈判（F 已定死）；
// 普通成交/激活成交：进入签约谈判，由签入方谈成合同条款后成约过户（成约即过户）。
// 增量 10 裁定扩权：普通成交/激活成交可在批准时改成交价（body.fee），税在过户时按新价重算，留审计。
app.post('/reviews/:id/approve', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const taskId = Number(c.req.param('id'));
  if (!Number.isInteger(taskId)) throw new HttpError(400, '审核任务 ID 不对');
  const body = (await readJson(c)) as { note?: unknown; fee?: unknown } | null;
  const note = typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
  const task = await loadOpenReviewTask(c.env.DB, taskId);
  const transfer = await loadTransfer(c.env.DB, task.ref_id);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  let feeAdjusted: number | null = null;
  if (body?.fee !== undefined) {
    if (transfer.type !== 'transfer' && transfer.type !== 'activation') {
      throw new HttpError(400, '改价裁定只适用于普通成交与激活成交单');
    }
    const fee = Number(body.fee);
    if (!Number.isFinite(fee) || fee <= 0) throw new HttpError(400, '成交价须为正数（单位 m）');
    const result = await c.env.DB
      .prepare(`UPDATE transfers SET fee = ? WHERE id = ? AND status = 'pending_review'`)
      .bind(fee, task.ref_id)
      .run();
    if ((result.meta.changes ?? 0) !== 1) throw new HttpError(409, '转会单不在待审状态，改价失败');
    feeAdjusted = fee;
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'admin_fee_adjust',
      targetType: 'transfer',
      targetId: task.ref_id,
      after: { reason: note, oldFee: transfer.fee, newFee: fee },
    });
  }
  const result = await approveTransferDeal(c.env, task.ref_id, user.id, {
    taskId,
    decidedBy: user.id,
    decision: 'approved',
    note: feeAdjusted !== null ? `${note ?? ''}（管理组裁定成交价 ${transfer.fee} → ${feeAdjusted} m）`.trim() : note ?? undefined,
  });
  return c.json({ ok: true, ...result });
});

// POST /api/admin/reviews/:id/reject —— 驳回（解冻资金，挂牌下架不收费）
app.post('/reviews/:id/reject', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const taskId = Number(c.req.param('id'));
  if (!Number.isInteger(taskId)) throw new HttpError(400, '审核任务 ID 不对');
  const body = (await readJson(c)) as { note?: unknown } | null;
  const note = typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
  const task = await loadOpenReviewTask(c.env.DB, taskId);
  const result = await rejectTransfer(c.env, task.ref_id, user.id, {
    taskId,
    decidedBy: user.id,
    decision: 'rejected',
    note: note ?? undefined,
  });
  return c.json({ ok: true, ...result });
});

// ---- 市场干预（增量 10：管理介入扩权，撤/关/裁定工具） ----

app.post('/market/bids/:id/void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminVoidBid(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/market/listings/:id/force-settle', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceSettle(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/market/listings/:id/force-void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceVoid(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/negotiations/:id/force-sign', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceSign(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/negotiations/:id/void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminCancelSigning(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

// ---- 窗口状态机（§11/§6.4-6，增量 5） ----

// GET /api/admin/windows —— 赛季与窗口列表
app.get('/windows', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  return c.json(await listWindows(c.env.DB));
});

// POST /api/admin/windows/open —— 开新窗（前置：无在开窗口；全球员经纪人档位重掷）
app.post('/windows/open', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { season?: unknown; windowSeq?: unknown } | null;
  return c.json(await openWindow(c.env, user.id, body?.season, body?.windowSeq), 201);
});

// POST /api/admin/windows/close —— 关窗（前置校验；force 需 window_force_settle=true）
app.post('/windows/close', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { force?: unknown } | null;
  return c.json(await closeWindow(c.env, user.id, body?.force));
});

// ---- 强制拍卖（规则 4.4.5，附录 A〔5〕） ----

// POST /api/admin/forced-auctions —— 建强制拍卖（1m 挂牌，CA 前六不含门将，整单税 50%）
app.post('/forced-auctions', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown } | null;
  const result = await createForcedAuction(c.env, user.id, body?.playerId);
  return c.json(result, 201);
});

// POST /api/admin/forced-auctions/:id/cancel —— 取消（未成交前）
app.post('/forced-auctions/:id/cancel', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const result = await cancelForcedAuction(c.env, user.id, c.req.param('id'));
  return c.json(result);
});

export default app;
