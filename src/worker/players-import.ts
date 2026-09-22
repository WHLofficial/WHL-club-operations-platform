// 导入管线落库层（TECH_DESIGN §5.4）：预览与确认共用校验；确认按 chunk 批次
// upsert + 每批一条审计（批次号/通道/新增/覆盖）。失败重跑幂等（同 fc_id 覆盖为同结果）。
import { HttpError } from '../lib/http.ts';
import type { Env } from './env.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { IMPORT_ROW_LIMIT, normalizeImportBatch, type ImportChannel, type NormalizedPlayer } from '../core/import.ts';

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

// 库内现状（IN ≤90 一批，§17.2-1）——预览的换版统计与确认的插入/覆盖预估共用
interface ExistingRow {
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
      .prepare(`SELECT fc_id, ca, base_ca, growth_xp FROM players WHERE fc_id IN (${placeholders})`)
      .bind(...slice)
      .all<ExistingRow>();
    out.push(...rows.results);
  }
  return out;
}

// 换版影响统计（增量 22 I1）：成长增量 δ = ca − base_ca，δ>0 的行才是被换版规则触及的球员
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
// 换版模式（增量 22 I1，规则 §5.4 / TECH_DESIGN §10.4）。成长增量 δ = ca − base_ca（负值按 0）：
// - minor 小换版：成长全保留，CA 增量平移 → ca = excluded.ca + δ；base_ca 刷到新源值。
// - major 大换版：经验清零、成长 CA/徽章各保留 1/3（向上取整；SQLite 整数除法是 floor，
//   (δ+2)/3 即 ceil(δ/3)），levels_applied 归零，base_ca 刷到新源值；徽章计数化，银/金各自折算。
// ON CONFLICT(fc_id) 只写 FC 源列；is_future_star（管理组终审）、growable（赛季结算重判）冲突时不更新。
// club_id 只在新插入时写（CPU 队球员的队籍，增量 14）；冲突时不更新，免得覆盖认领/解约后的归属。
export function upsertStatement(db: D1Database, p: NormalizedPlayer, mode: ImportMode = 'minor'): D1PreparedStatement {
  const growthUpdate =
    mode === 'major'
      ? `ca = excluded.ca + (max(players.ca - players.base_ca, 0) + 2) / 3,
         base_ca = excluded.ca, growth_xp = 0, levels_applied = 0,
         badges_silver = (badges_silver + 2) / 3, badges_gold = (badges_gold + 2) / 3,`
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

// 大换版折算：发放明细每段（银/金）保留最早的 ceil(n/3) 行，与台账计数折算（(x+2)/3）同一条规则，
// 否则换版后台账说 1 个、属性页列 3 个，又漂回两个口径。
// 「最早」按槽号排（发放总是落在最小空槽，槽号顺序即发放顺序）。
// 用窗口函数先在 CTE 里把排名与总数算完再删，避免 DELETE 的 WHERE 自引用本表 —— 那会踩
// SQLite「边扫边删」的执行策略，计数随删除变化时结果不可预期。整表一次跑、幂等（删完 rank ≤ keep）。
export const FOLD_PLAYSTYLES_SQL = `WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY player_id, kind ORDER BY slot) AS rn,
         COUNT(*) OVER (PARTITION BY player_id, kind) AS total
  FROM player_playstyles
)
DELETE FROM player_playstyles WHERE id IN (SELECT id FROM ranked WHERE rn > (total + 2) / 3)`;

export function foldPlaystylesStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(FOLD_PLAYSTYLES_SQL);
}

export async function confirmImport(env: Env, actor: number, body: unknown) {
  const payload = parseImportPayload(body);
  const outcome = runNormalize(payload);
  if (outcome.errors.length > 0) {
    throw new HttpError(422, `导入还有 ${outcome.errors.length} 处校验错误，请先看预览报告`, 'import_invalid');
  }

  const audit = createAuditStatement(env.DB);
  let written = 0;
  let inserted = 0;
  let growthPlayers = 0;
  const batchCount = Math.ceil(outcome.players.length / CHUNK_ROWS);
  for (let i = 0; i < outcome.players.length; i += CHUNK_ROWS) {
    const slice = outcome.players.slice(i, i + CHUNK_ROWS);
    const existing = await fetchExisting(env.DB, slice.map((p) => p.fcId));
    inserted += slice.length - existing.length;
    growthPlayers += swapStats(existing, payload.mode).growthPlayers;
    const statements = slice.map((p) => upsertStatement(env.DB, p, payload.mode));
    statements.push(
      audit({
        actor,
        action: 'players_import',
        targetType: 'players',
        after: {
          channel: payload.channel,
          mode: payload.mode,
          batchNo: i / CHUNK_ROWS + 1,
          rows: slice.length,
          insertEstimate: slice.length - existing.length,
          updateEstimate: existing.length,
          growthPlayers: swapStats(existing, payload.mode).growthPlayers,
        },
      }),
    );
    await env.DB.batch(statements);
    written += slice.length;
  }
  // 大换版：台账计数已在 upsert 里折算，明细表跟着折（整表一次，幂等）
  if (payload.mode === 'major') await foldPlaystylesStatement(env.DB).run();
  return {
    written,
    insertedEstimate: inserted,
    updatedEstimate: written - inserted,
    batches: batchCount,
    channel: payload.channel,
    mode: payload.mode,
    growthPlayers,
  };
}
