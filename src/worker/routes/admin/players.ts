// 管理端 · 球员修正与批量维护 + 导入管线两段式（§5.4：通道 A/B 球员，通道 C 名单合同模板；
// 原 admin.ts 球员域，增量 15 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement } from '../../../lib/audit.ts';
import { confirmImport, previewImport } from '../../players-import.ts';
import { confirmContractsImport, previewContractsImport } from '../../contracts-import.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

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

export default app;
