// 导入管线落库层（TECH_DESIGN §5.4）：预览与确认共用校验；确认按 chunk 批次
// upsert + 每批一条审计（批次号/通道/新增/覆盖）。失败重跑幂等（同 fc_id 覆盖为同结果）。
import { HttpError } from '../lib/http.ts';
import type { Env } from './env.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { IMPORT_ROW_LIMIT, normalizeImportBatch, type ImportChannel, type NormalizedPlayer } from '../core/import.ts';

export interface ImportPayload {
  channel: ImportChannel;
  rows: Record<string, unknown>[];
  futureStarIds: Set<number>;
}

const CHUNK_ROWS = 200; // 每 db.batch 一个事务批次（§5.4 单批 ≤5000 行，超量分批）

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
  const b = body as { channel?: unknown; rows?: unknown; futureStarIds?: unknown } | null;
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

// fc_id 已存在数（IN ≤90 一批，§17.2-1）——预览给出新增/覆盖预估，确认按 chunk 记审计
async function countExisting(db: D1Database, fcIds: number[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < fcIds.length; i += 90) {
    const slice = fcIds.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rows = await db
      .prepare(`SELECT fc_id FROM players WHERE fc_id IN (${placeholders})`)
      .bind(...slice)
      .all<{ fc_id: number }>();
    count += rows.results.length;
  }
  return count;
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
  const existing = await countExisting(env.DB, outcome.players.map((p) => p.fcId));
  return {
    channel: payload.channel,
    stats: {
      total: payload.rows.length,
      valid: outcome.players.length,
      error: outcome.errors.length,
      insertEstimate: outcome.players.length - existing,
      updateEstimate: existing,
    },
    errors: outcome.errors.slice(0, 50),
    samples: outcome.players.slice(0, 5).map(sampleView),
  };
}

// 导出供 scripts/players-import/generate-sql.ts 复用：离线导入脚本靠它取到与网页导入逐字相同的
// SQL 文本与参数顺序，避免手抄一份 SQL 后与生产口径漂移。
export function upsertStatement(db: D1Database, p: NormalizedPlayer): D1PreparedStatement {
  // ON CONFLICT(fc_id) 只写 FC 源列；is_future_star（管理组终审）、growable（赛季结算重判）冲突时不更新。
  // base_ca = 非平台成长所得 CA（§10.4）：随每次导入刷新到源文件值，平台成长不加在它上面。
  return db
    .prepare(
      `INSERT INTO players
         (uid, name, ca, pa, age, foot, position, prestige, china_plan, is_future_star, fc_id, base_ca, growable, game_attrs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(fc_id) DO UPDATE SET
         uid = excluded.uid, name = excluded.name, ca = excluded.ca, pa = excluded.pa, age = excluded.age,
         foot = excluded.foot, position = excluded.position, prestige = excluded.prestige,
         china_plan = excluded.china_plan, base_ca = excluded.ca, game_attrs = excluded.game_attrs, updated_at = excluded.updated_at`,
    )
    .bind(
      p.uid,
      p.name,
      p.ca,
      p.pa,
      p.age,
      p.foot,
      p.position,
      p.prestige,
      p.chinaPlan,
      p.futureStarSuggestion ? 1 : 0,
      p.fcId,
      p.ca,
      p.growableSuggestion ? 1 : 0,
      JSON.stringify(p.gameAttrs),
    );
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
  const batchCount = Math.ceil(outcome.players.length / CHUNK_ROWS);
  for (let i = 0; i < outcome.players.length; i += CHUNK_ROWS) {
    const slice = outcome.players.slice(i, i + CHUNK_ROWS);
    const existing = await countExisting(env.DB, slice.map((p) => p.fcId));
    inserted += slice.length - existing;
    const statements = slice.map((p) => upsertStatement(env.DB, p));
    statements.push(
      audit({
        actor,
        action: 'players_import',
        targetType: 'players',
        after: {
          channel: payload.channel,
          batchNo: i / CHUNK_ROWS + 1,
          rows: slice.length,
          insertEstimate: slice.length - existing,
          updateEstimate: existing,
        },
      }),
    );
    await env.DB.batch(statements);
    written += slice.length;
  }
  return { written, insertedEstimate: inserted, updatedEstimate: written - inserted, batches: batchCount, channel: payload.channel };
}
