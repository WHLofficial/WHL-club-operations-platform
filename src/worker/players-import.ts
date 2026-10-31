// 导入管线落库层（TECH_DESIGN §5.4）：预览与确认共用校验；确认按 chunk 批次
// upsert + 每批一条审计（批次号/通道/新增/覆盖）。失败重跑幂等（同 fc_id 覆盖为同结果）。
import { HttpError } from '../lib/http.ts';
import type { Env } from './env.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { createConfigService } from '../core/config.ts';
import { IMPORT_ROW_LIMIT, normalizeImportBatch, type ImportChannel, type NormalizedPlayer } from '../core/import.ts';
import { fetchPurchases, replayStatements } from './shop-ops.ts';
import { hookTierRecompute } from './growth-tier.ts';
import { fullCountSql } from '../core/playstyle-rules.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export type ImportMode = 'minor' | 'major';

export interface ImportPayload {
  channel: ImportChannel;
  rows: Record<string, unknown>[];
  futureStarIds: Set<number>;
  mode: ImportMode;
}

const CHUNK_ROWS = 200; // 每 db.batch 一个事务批次（§5.4 单批 ≤5000 行，超量分批）

function parseMode(v: unknown): ImportMode {
  if (v === undefined || v === null) return 'minor'; // 缺省小换版：名单版本更新的常规语义
  if (v === 'minor' || v === 'major') return v;
  throw new HttpError(400, 'mode 只能是 minor（小换版，成长全保留）或 major（大换版，经验清零、CA/徽章各保留 1/3）');
}

function parseFutureStarIds(v: unknown): Set<number> {
  if (v === undefined || v === null) return new Set();
  if (!Array.isArray(v)) throw new HttpError(400, 'futureStarIds 应为 ID 数组');
  const out = new Set<number>();
  for (const x of v) {
    const n = Number(x);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'futureStarIds 里混进了不是正整数的值');
    out.add(n);
  }
  return out;
}

export function parseImportPayload(body: unknown): ImportPayload {
  const b = body as { channel?: unknown; rows?: unknown; futureStarIds?: unknown; mode?: unknown } | null;
  if (!b || (b.channel !== 'A' && b.channel !== 'B')) {
    throw new HttpError(400, 'channel 只能是 A（FC26db 当季主源）或 B（FC Editor 队壳）');
  }
  if (!Array.isArray(b.rows)) throw new HttpError(400, 'rows 应为数组');
  if (b.rows.length > IMPORT_ROW_LIMIT) {
    throw new HttpError(400, `单次请求最多 ${IMPORT_ROW_LIMIT} 行，请分批提交`);
  }
  return {
    channel: b.channel,
    rows: b.rows as Record<string, unknown>[],
    futureStarIds: parseFutureStarIds(b.futureStarIds),
    mode: parseMode(b.mode),
  };
}

function runNormalize(payload: ImportPayload) {
  try {
    return normalizeImportBatch(payload.channel, payload.rows, payload.futureStarIds);
  } catch (err) {
    if (err instanceof RangeError) throw new HttpError(400, err.message);
    throw err;
  }
}

// 库内现状（IN ≤90 一批，§17.2-1）——预览的换版统计与确认的插入/覆盖预估共用。
// id / pa 供消费台账重放用（v6.26.0）：upsert 整列覆盖 pa / game_attrs 后按台账把已购属性加回去。
interface ExistingRow {
  id: number;
  fc_id: number;
  ca: number | null;
  base_ca: number | null;
  growth_xp: number;
}

async function fetchExisting(db: D1Database, fcIds: number[]): Promise<ExistingRow[]> {
  const out: ExistingRow[] = [];
  for (let i = 0; i < fcIds.length; i += 90) {
    const slice = fcIds.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db
      .prepare(`SELECT id, fc_id, ca, base_ca, growth_xp FROM players WHERE fc_id IN (${placeholders})`)
      .bind(...slice)
      .all<ExistingRow>();
    out.push(...rows.results);
  }
  return out;
}

// 换版影响统计（v2.8.0 I1）：成长增量 δ = ca − base_ca，δ>0 的行才是被换版规则触及的球员
function swapStats(existing: ExistingRow[], mode: ImportMode) {
  const growth = existing.filter((r) => (r.ca ?? 0) - (r.base_ca ?? 0) > 0);
  return {
    growthPlayers: growth.length,
    xpToWipe: mode === 'major' ? Math.round(existing.reduce((s, r) => s + (r.growth_xp > 0 ? r.growth_xp : 0), 0) * 100) / 100 : 0,
  };
}

function sampleView(p: NormalizedPlayer) {
  return {
    fcId: p.fcId,
    uid: p.uid,
    name: p.name,
    ca: p.ca,
    pa: p.pa,
    age: p.age,
    foot: p.foot,
    position: p.position,
    prestige: p.prestige,
    chinaPlan: p.chinaPlan === 1,
    futureStar: p.futureStarSuggestion,
  };
}

export async function previewImport(env: Env, body: unknown) {
  const payload = parseImportPayload(body);
  const outcome = runNormalize(payload);
  const existing = await fetchExisting(env.DB, outcome.players.map((p) => p.fcId));
  return {
    channel: payload.channel,
    mode: payload.mode,
    stats: {
      total: payload.rows.length,
      valid: outcome.players.length,
      error: outcome.errors.length,
      warning: outcome.warnings.length,
      insertEstimate: outcome.players.length - existing.length,
      updateEstimate: existing.length,
      ...swapStats(existing, payload.mode),
    },
    errors: outcome.errors.slice(0, 50),
    warnings: outcome.warnings.slice(0, 50),
    samples: outcome.players.slice(0, 5).map(sampleView),
  };
}

// 导出供 scripts/players-import/generate-sql.ts 复用：离线导入脚本靠它取到与网页导入逐字相同的
// SQL 文本与参数顺序，避免手抄一份 SQL 后与生产口径漂移。
//
// 换版模式（v2.8.0 I1，规则 §5.4 / TECH_DESIGN §10.4）。成长增量 δ = ca − base_ca（负值按 0）：
// - minor 小换版：成长全保留，CA 增量平移 → ca = excluded.ca + δ；base_ca 刷到新源值。
// - major 大换版：经验清零、成长 CA/徽章各保留 1/3（向上取整；SQLite 整数除法是 floor，
//   (δ+2)/3 即 ceil(δ/3)），levels_applied 归零，base_ca 刷到新源值；徽章计数化，银/金各自折算。
// ON CONFLICT(fc_id) 只写 FC 源列；is_future_star（管理组终审）、growable（赛季结算重判）冲突时不更新。
// club_id 只在新插入时写（CPU 队球员的队籍，v2.0.0）；冲突时不更新，免得覆盖认领/解约后的归属。
export function upsertStatement(db: D1Database, p: NormalizedPlayer, mode: ImportMode = 'minor'): D1PreparedStatement {
  // v6.63.0：major 模式不再折算台账计数（badges_silver/gold 那两项已删）—— 台账是派生值，
  // 由折算/删重后的明细行 + 新版 FC 槽在 recountImportedBadgesStatements 里按全量公式重算。
  const growthUpdate =
    mode === 'major'
      ? `ca = excluded.ca + (max(players.ca - players.base_ca, 0) + 2) / 3,
         base_ca = excluded.ca, growth_xp = 0, levels_applied = 0,`
      : `ca = excluded.ca + max(players.ca - players.base_ca, 0), base_ca = excluded.ca,`;
  return db
    .prepare(
      `INSERT INTO players
         (uid, name, ca, pa, age, foot, position, club_id, prestige, china_plan, is_future_star, fc_id, base_ca, growable, game_attrs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(fc_id) DO UPDATE SET
         uid = excluded.uid, name = excluded.name, ${growthUpdate}
         pa = excluded.pa, age = excluded.age,
         foot = excluded.foot, position = excluded.position, prestige = excluded.prestige,
         china_plan = excluded.china_plan, game_attrs = excluded.game_attrs, updated_at = excluded.updated_at`,
    )
    .bind(
      p.uid,
      p.name,
      p.ca,
      p.pa,
      p.age,
      p.foot,
      p.position,
      p.clubId,
      p.prestige,
      p.chinaPlan,
      p.futureStarSuggestion ? 1 : 0,
      p.fcId,
      p.ca,
      p.growableSuggestion ? 1 : 0,
      JSON.stringify(p.gameAttrs),
    );
}

// 大换版折算（四步序之②）：发放明细每段（银/金）保留最早的 ceil(n/3) 行。
// 「最早」按槽号排（发放总是落在最小空槽，槽号顺序即发放顺序）。
// 用窗口函数先在 CTE 里把排名与总数算完再删，避免 DELETE 的 WHERE 自引用本表 —— 那会踩
// SQLite「边扫边删」的执行策略，计数随删除变化时结果不可预期。整表一次跑、幂等（删完 rank ≤ keep）。
export const FOLD_PLAYSTYLES_SQL = `WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY player_id, kind ORDER BY slot) AS rn,
         COUNT(*) OVER (PARTITION BY player_id, kind) AS total
  FROM player_playstyles
)
DELETE FROM player_playstyles WHERE id IN (SELECT id FROM ranked WHERE rn > (total + 2) / 3)`;

// 大换版同段删重（四步序之③，v6.63.0）：明细行撞新版 FC 槽（同段同基础）则删行 —— FC 源为准，
// 撞的那份跟着版本走；被发放金顶掉的 FC 银不在删重之列（金顶银是可逆抑制，不是删除）。
// 金段比较用「FC 槽存库形 = 明细基础 ID + 100」。整表一次跑、幂等（删完无匹配）。
export const DEDUPE_PLAYSTYLES_SQL = `DELETE FROM player_playstyles WHERE id IN (
  SELECT pp.id FROM player_playstyles pp
  JOIN players p ON p.id = pp.player_id
  JOIN json_each(p.game_attrs) je ON CAST(substr(je.key, 5) AS INTEGER) BETWEEN 1 AND 15
  WHERE (pp.kind = 'silver' AND CAST(substr(je.key, 5) AS INTEGER) BETWEEN 1 AND 12 AND CAST(je.value AS INTEGER) = pp.psid)
     OR (pp.kind = 'gold' AND CAST(substr(je.key, 5) AS INTEGER) BETWEEN 13 AND 15 AND CAST(je.value AS INTEGER) = pp.psid + 100)
)`;

export function foldPlaystylesStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(FOLD_PLAYSTYLES_SQL);
}

export function dedupePlaystylesStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(DEDUPE_PLAYSTYLES_SQL);
}

// 四步序之④（v6.63.0）：game_attrs 整列覆盖后，按全量公式重算本批导入球员的台账
// （FC 槽数减被发放金抑制的银槽 + 折算/删重后留存的明细行数）。major 与 minor 都要跑 ——
// 两种模式都整列覆盖 game_attrs，FC 槽变了台账跟着变。按 fc_id 定位、每片 ≤50 人分批。
export function recountImportedBadgesStatements(db: D1Database, fcIds: readonly number[]): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < fcIds.length; i += 50) {
    const slice = fcIds.slice(i, i + 50);
    out.push(
      db
        .prepare(
          `UPDATE players SET badges_silver = ${fullCountSql('silver')}, badges_gold = ${fullCountSql('gold')}, updated_at = ${nowSql()}
           WHERE fc_id IN (${slice.map(() => '?').join(', ')})`,
        )
        .bind(...slice),
    );
  }
  return out;
}

export async function confirmImport(env: Env, actor: number, body: unknown) {
  const payload = parseImportPayload(body);
  const outcome = runNormalize(payload);
  if (outcome.errors.length > 0) {
    throw new HttpError(422, `导入还有 ${outcome.errors.length} 处校验错误，请先看预览报告`, 'import_invalid');
  }

  const audit = createAuditStatement(env.DB);
  // 消费台账重放（v6.26.0）：upsert 整列覆盖 pa / game_attrs，已购的 PA 点 / 角色 / 位置热区
  // 按台账在每 chunk 批内加回去（与 upsert 同批 ⇒ 「导入 + 重放」整体幂等）。徽章是独立
  // 明细表（player_playstyles），不受整列覆盖影响，无需重放。
  const paCap = (await createConfigService(env.DB).getNumber('fc26_pa_cap')) ?? 95;
  let written = 0;
  let inserted = 0;
  let growthPlayers = 0;
  let replayed = 0;
  const batchCount = Math.ceil(outcome.players.length / CHUNK_ROWS);
  for (let i = 0; i < outcome.players.length; i += CHUNK_ROWS) {
    const slice = outcome.players.slice(i, i + CHUNK_ROWS);
    const existing = await fetchExisting(env.DB, slice.map((p) => p.fcId));
    inserted += slice.length - existing.length;
    growthPlayers += swapStats(existing, payload.mode).growthPlayers;
    const statements = slice.map((p) => upsertStatement(env.DB, p, payload.mode));
    // 重放只对「库里已存在且有台账」的行有意义：新插入的球员不可能有已购属性
    const purchases = await fetchPurchases(env.DB, existing.map((r) => r.id));
    if (purchases.length > 0) {
      replayed += new Set(purchases.map((r) => r.player_id)).size;
      statements.push(...replayStatements(env.DB, purchases, paCap));
    }
    statements.push(
      audit({
        actor,
        action: 'players_import',
        targetType: 'players',
        origin: 'user',
        after: {
          channel: payload.channel,
          mode: payload.mode,
          batchNo: i / CHUNK_ROWS + 1,
          rows: slice.length,
          insertEstimate: slice.length - existing.length,
          updateEstimate: existing.length,
          growthPlayers: swapStats(existing, payload.mode).growthPlayers,
          replayedPurchases: purchases.length,
        },
      }),
    );
    await env.DB.batch(statements);
    written += slice.length;
  }
  // 大换版四步序之②③：台账计数折算已废（upsert 不再写 badges 列），明细表先折（每段留最早
  // ceil(n/3)）再删与新版 FC 槽同段撞车的行（FC 源为准）；两步都整表一次、幂等。
  if (payload.mode === 'major') {
    await foldPlaystylesStatement(env.DB).run();
    await dedupePlaystylesStatement(env.DB).run();
  }
  // 四步序之④：game_attrs 整列覆盖后按全量公式重算本批球员的台账（major/minor 都要 ——
  // FC 槽变了台账跟着变）。在档位重算之前，与 hookTierRecompute 的写入面互不相交。
  if (outcome.players.length > 0) {
    const stmts = recountImportedBadgesStatements(env.DB, outcome.players.map((p) => p.fcId));
    for (const s of stmts) await s.run();
  }
  // 导入收尾重算档位（v6.48.0 §10.3）：导入覆盖 age / china_plan / game_attrs（含 naID、TeamID）
  // 与 is_future_star，五个条件里除 c1/c2 的队壳基准外都可能变。按 fc_id 定位（导入行只有 fc_id，
  // 免得再查一遍本地 id）；只写差异——重导入没动档位时零写入。
  if (outcome.players.length > 0) {
    await hookTierRecompute(env.DB, { kind: 'fcIds', fcIds: outcome.players.map((p) => p.fcId) }, { actor, origin: 'user' });
  }
  return {
    written,
    insertedEstimate: inserted,
    updatedEstimate: written - inserted,
    batches: batchCount,
    channel: payload.channel,
    mode: payload.mode,
    growthPlayers,
    replayed,
  };
}
