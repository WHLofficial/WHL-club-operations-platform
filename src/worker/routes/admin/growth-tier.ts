// 管理端 · 成长档位（TECH_DESIGN §10.3，v6.48.0 自动核定）：
// 规则真源 src/core/growth-tier.ts，重算器 src/worker/growth-tier.ts，本文件只管端点。
//
//   GET  /growth/tier-recompute             全量预览（计数 + 明细前 200 行，不写库）
//   POST /growth/tier-recompute             重算落库（可选 { clubId } 收窄到该队；写差异 + 审计）
//   GET  /growth/tier-changes               变更清单（读 audit_log 的 growth_tier* 行）
//   GET  /growth/tier-clubs-without-country 未设国家的队（c2 会被静默记假的兜底提示）
//   GET  /growth/:playerId/tier             单人明细（当前档/锁定/五条件/自动档）
//   POST /growth/:playerId/tier             人工核定（写值 + 置锁，不重算）
//   POST /growth/:playerId/tier/unlock      解除锁定（立即重算回自动值）
//
// 语义（用户口径 m08967）：自动核定 + 人工覆盖；覆盖即锁定（自动重算跳过），可解除；
// 回落按当前状态（m08970）——转会/换壳/年满 19/摘牌都如实升降，不回溯已发升级。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement } from '../../../lib/audit.ts';
import {
  GROWTH_TIER_CONDITIONS,
  GROWTH_TIER_MAX,
  GROWTH_TIER_MISSING_SELECT,
  GROWTH_TIER_SELECT,
  tierConditionDetails,
  type GrowthTierConditionKey,
} from '../../../core/growth-tier.ts';
import { nationName } from '../../../core/nations.ts';
import { clubsWithoutCountry, hookTierRecompute, recomputeGrowthTiers, type TierScope } from '../../growth-tier.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

/** 单人明细的取列（条件命中 + 缺失标记 + 队壳国家） */
const TIER_DETAIL_SELECT = `SELECT p.id AS player_id, p.name, p.display_name, ${GROWTH_TIER_SELECT}, ${GROWTH_TIER_MISSING_SELECT}
   FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?`;

interface TierDetailRow {
  player_id: number;
  name: string;
  display_name: string | null;
  current_tier: number;
  locked: number;
  club_country: number | null;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
  next_tier: number;
  miss_c1: number;
  miss_c2: number;
}

/** 明细行 → 端点响应（条件三态：命中 / 数据缺失 / 未命中） */
function detailOf(row: TierDetailRow) {
  const hits: Record<GrowthTierConditionKey, boolean> = {
    c1: row.c1 === 1,
    c2: row.c2 === 1,
    c3: row.c3 === 1,
    c4: row.c4 === 1,
    c5: row.c5 === 1,
  };
  const missing: GrowthTierConditionKey[] = [];
  if (row.miss_c1 === 1) missing.push('c1');
  if (row.miss_c2 === 1) missing.push('c2');
  return {
    playerId: row.player_id,
    name: row.display_name ?? row.name,
    currentTier: row.current_tier,
    locked: row.locked === 1,
    autoTier: row.next_tier,
    clubCountry: row.club_country,
    clubCountryName: nationName(row.club_country),
    conditions: tierConditionDetails(hits, missing),
  };
}

async function loadTierDetail(db: D1Database, playerId: number): Promise<TierDetailRow | null> {
  return db.prepare(TIER_DETAIL_SELECT).bind(playerId).first<TierDetailRow>();
}

// ---- 批量：预览 / 落库 / 清单 / 未设国家 ----

// 预览：不写库，计数 + 明细前 200 行（前端计数条与明细表一次拿全）
app.get('/growth/tier-recompute', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const summary = await recomputeGrowthTiers(c.env.DB, { kind: 'all' }, { apply: false, actor: user.id, origin: 'user' });
  return c.json({ ok: true, ...summary, conditions: GROWTH_TIER_CONDITIONS });
});

// 落库：默认全量；body { clubId } 收窄到该队（换壳/改国家后的收尾重算，rekey README 的检查清单用）
app.post('/growth/tier-recompute', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { clubId?: unknown } | null;
  let scope: TierScope = { kind: 'all' };
  if (body?.clubId !== undefined && body?.clubId !== null) {
    const clubId = Number(body.clubId);
    if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, 'clubId 应为正整数');
    scope = { kind: 'clubs', clubIds: [clubId] };
  }
  const summary = await recomputeGrowthTiers(c.env.DB, scope, { apply: true, actor: user.id, origin: 'user' });
  return c.json({ ok: true, ...summary });
});

// 变更清单：读审计（自动核定与人工核定共用 action 'growth_tier_set'，after.auto 区分来源；
// 另有批次汇总 'growth_tier_recompute' 与解除锁定 'growth_tier_unlock'）
app.get('/growth/tier-changes', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 50;
  const rows = await c.env.DB.prepare(
    `SELECT id, actor, action, target_type, target_id, origin, before, after, at
     FROM audit_log WHERE action LIKE 'growth_tier%' ORDER BY id DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: number;
      actor: number | null;
      action: string;
      target_type: string;
      target_id: number | null;
      origin: string | null;
      before: string | null;
      after: string | null;
      at: string;
    }>();
  return c.json({
    entries: rows.results.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      origin: r.origin,
      before: r.before === null ? null : (JSON.parse(r.before) as unknown),
      after: r.after === null ? null : (JSON.parse(r.after) as unknown),
      at: r.at,
    })),
  });
});

// 未设国家的队：这些队里所有球员的 c2 一律记假（缺数据不猜），提示管理组补录
app.get('/growth/tier-clubs-without-country', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const clubs = await clubsWithoutCountry(c.env.DB);
  return c.json({ clubs: clubs.map((club) => ({ ...club, countryName: null })) });
});

// ---- 单人：明细 / 核定（置锁）/ 解除锁定 ----

app.get('/growth/:playerId/tier', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const row = await loadTierDetail(c.env.DB, playerId);
  if (!row) throw new HttpError(404, '找不到这名球员');
  return c.json(detailOf(row));
});

// 人工核定：写值 + 置锁（§10.3 条件叠加由管理组按现实资料判断，覆盖后自动重算不再动它）
app.post('/growth/:playerId/tier', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await readJson(c)) as { tier?: unknown } | null;
  const tier = Number(body?.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > GROWTH_TIER_MAX) throw new HttpError(400, '档位只能是 1-5');
  const current = await c.env.DB.prepare('SELECT growth_tier, growth_tier_locked FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ growth_tier: number; growth_tier_locked: number }>();
  if (!current) throw new HttpError(404, '找不到这名球员');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE players SET growth_tier = ?, growth_tier_locked = 1, updated_at = ${nowSql()} WHERE id = ?`).bind(
      tier,
      playerId,
    ),
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_tier_set',
      targetType: 'player',
      targetId: playerId,
      origin: 'user',
      before: { tier: current.growth_tier, locked: current.growth_tier_locked === 1 },
      after: { tier, auto: false, locked: true },
    }),
  ]);
  return c.json({ ok: true, tier, locked: true });
});

// 解除锁定：清标记 → 立即重算回自动值（回落按当前状态）。重算只写差异，
// 人工值恰好等于自动值时档位不动，所以先清标记再重算，最后读回实际档位写解除审计。
app.post('/growth/:playerId/tier/unlock', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const row = await loadTierDetail(c.env.DB, playerId);
  if (!row) throw new HttpError(404, '找不到这名球员');
  if (row.locked !== 1) throw new HttpError(400, '这名球员没有被锁定');
  await c.env.DB.prepare(`UPDATE players SET growth_tier_locked = 0, updated_at = ${nowSql()} WHERE id = ?`)
    .bind(playerId)
    .run();
  const { up, down } = await hookTierRecompute(c.env.DB, { kind: 'players', playerIds: [playerId] }, { actor: user.id, origin: 'user' });
  const after = await c.env.DB.prepare('SELECT growth_tier FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ growth_tier: number }>();
  await createAuditStatement(c.env.DB)({
    actor: user.id,
    action: 'growth_tier_unlock',
    targetType: 'player',
    targetId: playerId,
    origin: 'user',
    before: { tier: row.current_tier, locked: true },
    after: { tier: after?.growth_tier ?? row.next_tier, locked: false, auto: true },
  }).run();
  return c.json({ ok: true, tier: after?.growth_tier ?? row.next_tier, changed: up + down > 0 });
});

export default app;
