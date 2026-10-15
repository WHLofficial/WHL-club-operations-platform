// §10.3 成长档位重算引擎（v6.48.0）：自动核定 + 人工锁定跳过 + 只写差异 + 审计同批。
//
// 规则真源在 src/core/growth-tier.ts（SQL 表达式），本模块只负责「读 → 比 → 写」：
//   - 只写差异行（growth_tier <> 自动值），锁定行（growth_tier_locked = 1）一律跳过；
//   - 每条 UPDATE 带 (id, 旧档, 未锁定) 守卫，审计与写入同闸——并发下不留失实快照；
//   - 每批 CHUNK 条（每条 = UPDATE + 审计两语句），避免 D1 大事务与 100 绑定参数上限。
//
// 三种 scope：单批球员 id / 某队（改队壳国家后）/ 全量（一键重算与首次回填）。
// 触发点挂钩（球员导入、合同导入、转会、解约、改国家、解除锁定…）走 applyTierRecompute，
// 预览（管理端确认前）走 recomputeGrowthTiers(apply=false)。
import type { AuditOrigin } from '../lib/audit.ts';
import { createAuditStatement } from '../lib/audit.ts';
import {
  GROWTH_TIER_CONDITIONS,
  GROWTH_TIER_SELECT,
  GROWTH_TIER_SQL,
  type GrowthTierConditionKey,
} from '../core/growth-tier.ts';
import { rowDisplayName } from '../core/player-name.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/** 每批写入条数（每条 2 个语句：UPDATE + 审计） */
const CHUNK = 100;
/** 明细行上限（预览与执行结果同限；截断只影响展示，不影响写入） */
const DETAIL_LIMIT = 200;
/** IN (...) 绑定参数分片：D1 单语句绑定参数上限 100，留余量 */
const PARAM_CHUNK = 90;

export type TierScope =
  | { kind: 'players'; playerIds: number[] }
  /** 按 FC 源 id 定位（导入收尾用：导入行只有 fc_id，免得再查一遍本地 id） */
  | { kind: 'fcIds'; fcIds: number[] }
  | { kind: 'clubs'; clubIds: number[] }
  | { kind: 'all' };

export interface TierDiffRow {
  playerId: number;
  name: string;
  clubId: number | null;
  clubName: string | null;
  currentTier: number;
  nextTier: number;
  conditions: Record<GrowthTierConditionKey, boolean>;
}

export interface TierRecomputeSummary {
  scope: TierScope['kind'];
  /** 范围内球员总数 */
  scanned: number;
  /** 范围内被锁定跳过的行数 */
  locked: number;
  up: number;
  down: number;
  unchanged: number;
  applied: boolean;
  /** 实际写批次数（预览恒 0） */
  batches: number;
  rows: TierDiffRow[];
  /** 明细被截断（真实变更行数 > rows.length） */
  truncated: boolean;
}

interface TierRow {
  player_id: number;
  name: string;
  display_name: string | null;
  club_id: number | null;
  club_name: string | null;
  current_tier: number;
  club_country: number | null;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
  next_tier: number;
}

function scopeSql(scope: TierScope): { sql: string; params: number[] } {
  if (scope.kind === 'players') {
    if (scope.playerIds.length === 0) return { sql: '1 = 0', params: [] };
    return { sql: `p.id IN (${scope.playerIds.map(() => '?').join(', ')})`, params: scope.playerIds };
  }
  if (scope.kind === 'fcIds') {
    if (scope.fcIds.length === 0) return { sql: '1 = 0', params: [] };
    return { sql: `p.fc_id IN (${scope.fcIds.map(() => '?').join(', ')})`, params: scope.fcIds };
  }
  if (scope.kind === 'clubs') {
    if (scope.clubIds.length === 0) return { sql: '1 = 0', params: [] };
    return { sql: `p.club_id IN (${scope.clubIds.map(() => '?').join(', ')})`, params: scope.clubIds };
  }
  return { sql: '1 = 1', params: [] };
}

function toDiffRow(row: TierRow): TierDiffRow {
  return {
    playerId: row.player_id,
    name: rowDisplayName(row),
    clubId: row.club_id,
    clubName: row.club_name,
    currentTier: row.current_tier,
    nextTier: row.next_tier,
    conditions: {
      c1: row.c1 === 1,
      c2: row.c2 === 1,
      c3: row.c3 === 1,
      c4: row.c4 === 1,
      c5: row.c5 === 1,
    },
  };
}

/** 范围统计（scanned/locked/升/降）——一条聚合查询，不取明细 */
async function loadCounts(db: D1Database, scope: TierScope): Promise<{ scanned: number; locked: number; up: number; down: number }> {
  const s = scopeSql(scope);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS scanned,
              COALESCE(SUM(CASE WHEN p.growth_tier_locked = 1 THEN 1 ELSE 0 END), 0) AS locked,
              COALESCE(SUM(CASE WHEN p.growth_tier_locked = 0 AND (${GROWTH_TIER_SQL}) > p.growth_tier THEN 1 ELSE 0 END), 0) AS up,
              COALESCE(SUM(CASE WHEN p.growth_tier_locked = 0 AND (${GROWTH_TIER_SQL}) < p.growth_tier THEN 1 ELSE 0 END), 0) AS down
       FROM players p LEFT JOIN clubs c ON c.id = p.club_id
       WHERE ${s.sql}`,
    )
    .bind(...s.params)
    .first<{ scanned: number; locked: number; up: number; down: number }>();
  return row ?? { scanned: 0, locked: 0, up: 0, down: 0 };
}

/** 变更行（keyset 分页：id > afterId；锁定与无差异的不取） */
async function loadChangedRows(db: D1Database, scope: TierScope, limit: number, afterId = 0): Promise<TierDiffRow[]> {
  const s = scopeSql(scope);
  const rows = await db
    .prepare(
      `SELECT p.id AS player_id, p.name, p.display_name, p.club_id, c.name AS club_name,
              ${GROWTH_TIER_SELECT}
       FROM players p LEFT JOIN clubs c ON c.id = p.club_id
       WHERE ${s.sql} AND p.growth_tier_locked = 0 AND p.growth_tier <> (${GROWTH_TIER_SQL})
         ${afterId > 0 ? 'AND p.id > ?' : ''}
       ORDER BY p.id LIMIT ?`,
    )
    .bind(...s.params, ...(afterId > 0 ? [afterId] : []), limit)
    .all<TierRow>();
  return rows.results.map(toDiffRow);
}

/** 单行写入语句（UPDATE + 审计，同闸） */
function tierWriteStatements(
  db: D1Database,
  row: TierDiffRow,
  ctx: { actor: number | null; origin: AuditOrigin },
): D1PreparedStatement[] {
  return [
    // 守卫对**批前状态**求值：这条改的必须还是我们读到的那一行、且没被锁上
    db
      .prepare(
        `UPDATE players SET growth_tier = ?, updated_at = ${nowSql()}
         WHERE id = ? AND growth_tier = ? AND growth_tier_locked = 0`,
      )
      .bind(row.nextTier, row.playerId, row.currentTier),
    // 审计以「上一条真的动了行（changes() > 0）」为闸（与 ledgerMovement 同形）：守卫没过 / 并发下
    // 被抢先改掉时 UPDATE 空转，审计整条不落——留痕与写入始终同生共死。
    // 注意不能把 (id, 旧档, 未锁定) 直接当这里的守卫：UPDATE 先执行，旧档在审计求值时已经变了，
    // 那样写出来的审计恒为空（v6.48.0 测试闸门抓到的正是这一处）。
    createAuditStatement(db)({
      actor: ctx.actor,
      action: 'growth_tier_set',
      targetType: 'player',
      targetId: row.playerId,
      origin: ctx.origin,
      before: { tier: row.currentTier },
      after: { tier: row.nextTier, auto: true, conditions: row.conditions },
      guardSql: 'changes() > 0',
    }),
  ];
}

export interface TierApplyResult {
  up: number;
  down: number;
  batches: number;
  rows: TierDiffRow[];
  truncated: boolean;
}

/**
 * 执行重算（只写差异行）。scope 为球员 id 集时按 PARAM_CHUNK 分片（D1 绑定参数上限）。
 * 返回写入明细（前 DETAIL_LIMIT 行，仅供展示）。
 */
export async function applyTierRecompute(
  db: D1Database,
  scope: TierScope,
  ctx: { actor: number | null; origin: AuditOrigin },
): Promise<TierApplyResult> {
  const out: TierApplyResult = { up: 0, down: 0, batches: 0, rows: [], truncated: false };
  for (const part of scopeParts(scope)) {
    let afterId = 0;
    for (;;) {
      const rows = await loadChangedRows(db, part, CHUNK, afterId);
      if (rows.length === 0) break;
      await db.batch(rows.flatMap((row) => tierWriteStatements(db, row, ctx)));
      for (const row of rows) {
        if (row.nextTier > row.currentTier) out.up += 1;
        else out.down += 1;
        if (out.rows.length < DETAIL_LIMIT) out.rows.push(row);
        else out.truncated = true;
      }
      out.batches += 1;
      afterId = rows[rows.length - 1].playerId;
      if (rows.length < CHUNK) break;
    }
  }
  return out;
}

/** 绑定参数分片（D1 单语句绑定参数上限 100）：按 scope 种类切片，分片间互不重叠 */
function scopeParts(scope: TierScope): TierScope[] {
  if (scope.kind === 'all') return [scope];
  const ids = scope.kind === 'players' ? scope.playerIds : scope.kind === 'fcIds' ? scope.fcIds : scope.clubIds;
  if (ids.length <= PARAM_CHUNK) return [scope];
  const parts: TierScope[] = [];
  for (let i = 0; i < ids.length; i += PARAM_CHUNK) {
    const slice = ids.slice(i, i + PARAM_CHUNK);
    parts.push(
      scope.kind === 'players'
        ? { kind: 'players', playerIds: slice }
        : scope.kind === 'fcIds'
          ? { kind: 'fcIds', fcIds: slice }
          : { kind: 'clubs', clubIds: slice },
    );
  }
  return parts;
}

/**
 * 重算（管理端入口）：apply=false 只预览（计数 + 明细，不写库）；
 * apply=true 执行（写差异 + 每条审计 + 一条批次汇总审计）。
 */
export async function recomputeGrowthTiers(
  db: D1Database,
  scope: TierScope,
  opts: { apply: boolean; actor: number | null; origin: AuditOrigin },
): Promise<TierRecomputeSummary> {
  const counts = await loadCounts(db, scope);
  if (!opts.apply) {
    const rows = await loadChangedRows(db, scope, DETAIL_LIMIT);
    return {
      scope: scope.kind,
      scanned: counts.scanned,
      locked: counts.locked,
      up: counts.up,
      down: counts.down,
      unchanged: counts.scanned - counts.locked - counts.up - counts.down,
      applied: false,
      batches: 0,
      rows,
      truncated: counts.up + counts.down > rows.length,
    };
  }
  const result = await applyTierRecompute(db, scope, opts);
  await createAuditStatement(db)({
    actor: opts.actor,
    action: 'growth_tier_recompute',
    targetType: 'growth_tier',
    targetId: null,
    origin: opts.origin,
    after: {
      scope: scope.kind,
      scopeIds:
        scope.kind === 'players'
          ? scope.playerIds.slice(0, 20)
          : scope.kind === 'fcIds'
            ? scope.fcIds.slice(0, 20)
            : scope.kind === 'clubs'
              ? scope.clubIds.slice(0, 20)
              : null,
      up: result.up,
      down: result.down,
      locked: counts.locked,
      batches: result.batches,
    },
  }).run();
  return {
    scope: scope.kind,
    scanned: counts.scanned,
    locked: counts.locked,
    up: result.up,
    down: result.down,
    unchanged: counts.scanned - counts.locked - result.up - result.down,
    applied: true,
    batches: result.batches,
    rows: result.rows,
    truncated: result.truncated,
  };
}

/** 轻量挂钩（触发点用）：只算差异并写入，不做计数聚合（少一条全范围聚合查询） */
export async function hookTierRecompute(
  db: D1Database,
  scope: TierScope,
  ctx: { actor: number | null; origin: AuditOrigin },
): Promise<{ up: number; down: number }> {
  const result = await applyTierRecompute(db, scope, ctx);
  return { up: result.up, down: result.down };
}

/** 未设国家的队（管理端提示用：这些队里的球员 c2 一律记假，「会籍本可命中」被静默吞掉） */
export async function clubsWithoutCountry(
  db: D1Database,
): Promise<{ id: number; name: string; players: number }[]> {
  const rows = await db
    .prepare(
      `SELECT c.id, c.name, COUNT(p.id) AS players
       FROM clubs c LEFT JOIN players p ON p.club_id = c.id
       WHERE c.country IS NULL
       GROUP BY c.id, c.name
       ORDER BY players DESC, c.id`,
    )
    .all<{ id: number; name: string; players: number }>();
  return rows.results;
}

/** 条件元数据（管理端/球员页文案共用一份，防止两端漂移） */
export const TIER_CONDITION_META = GROWTH_TIER_CONDITIONS;
