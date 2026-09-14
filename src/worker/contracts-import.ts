// 通道 C 落库层（TECH_DESIGN §5.4）：名单合同模板 → contracts 初建。
// 队壳归属以平台 contracts 为准（§5.2）：无归属球员随合同认领到目标俱乐部；
// 已归属其他俱乐部的行报错不落库。预览与确认走同一分类，确认前必再校验一遍。
import { HttpError } from '../lib/http.ts';
import type { Env } from './env.ts';
import { createAuditStatement } from '../lib/audit.ts';
import {
  CONTRACT_ROW_LIMIT,
  normalizeContractBatch,
  type ImportRowError,
  type NormalizedContract,
} from '../core/import.ts';

const CHUNK_ROWS = 200; // 每 db.batch 一个事务批次

interface ContractPayload {
  clubId: number;
  rows: Record<string, unknown>[];
}

function parseContractPayload(body: unknown): ContractPayload {
  const b = body as { clubId?: unknown; rows?: unknown } | null;
  if (!b) throw new HttpError(400, '请求格式不对');
  const clubId = Number(b.clubId);
  if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, 'clubId 应为目标俱乐部 ID');
  if (!Array.isArray(b.rows)) throw new HttpError(400, 'rows 应为数组');
  if (b.rows.length === 0) throw new HttpError(400, 'rows 不能为空');
  if (b.rows.length > CONTRACT_ROW_LIMIT) throw new HttpError(400, `单次最多 ${CONTRACT_ROW_LIMIT} 行`);
  return { clubId, rows: b.rows as Record<string, unknown>[] };
}

function runNormalize(rows: Record<string, unknown>[]): ReturnType<typeof normalizeContractBatch> {
  try {
    return normalizeContractBatch(rows);
  } catch (err) {
    if (err instanceof RangeError) throw new HttpError(400, err.message);
    throw err;
  }
}

async function lookupIn<T>(db: D1Database, ids: number[], sql: (ph: string) => string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const ph = slice.map(() => '?').join(', ');
    const rows = await db.prepare(sql(ph)).bind(...slice).all<T>();
    out.push(...rows.results);
  }
  return out;
}

interface PlayerRow {
  id: number;
  club_id: number | null;
  name: string;
}

interface Classified {
  contract: NormalizedContract;
  playerId: number;
  playerName: string;
  outcome: 'create' | 'update' | 'claim';
}

interface ClassifyResult {
  ok: Classified[];
  errors: ImportRowError[];
}

// 归一化结果 → 按库内归属/现行合同分类：create=新建合同，update=覆盖本队现行合同，
// claim=新建合同并认领无归属球员。归属冲突进 errors。
async function classify(db: D1Database, clubId: number, contracts: NormalizedContract[]): Promise<ClassifyResult> {
  const idRows = await lookupIn<{ id: number; fc_id: number; club_id: number | null; name: string }>(
    db,
    contracts.map((c) => c.fcId),
    (ph) => `SELECT id, fc_id, club_id, name FROM players WHERE fc_id IN (${ph})`,
  );
  const byId = new Map<number, PlayerRow>();
  const fcToId = new Map<number, number>();
  for (const r of idRows) {
    byId.set(r.id, { id: r.id, club_id: r.club_id, name: r.name });
    fcToId.set(r.fc_id, r.id);
  }

  const playerIds = [...byId.keys()];
  const contractRows = await lookupIn<{ player_id: number; club_id: number | null }>(
    db,
    playerIds,
    (ph) => `SELECT player_id, club_id FROM contracts WHERE player_id IN (${ph}) AND is_active = 1`,
  );
  const contractByPlayer = new Map(contractRows.map((r) => [r.player_id, r]));

  const conflictClubIds = [
    ...new Set(
      idRows.filter((p) => p.club_id !== null && p.club_id !== clubId).map((p) => p.club_id as number),
    ),
  ];
  const clubNames = new Map<number, string>();
  if (conflictClubIds.length > 0) {
    const rows = await lookupIn<{ id: number; name: string }>(
      db,
      conflictClubIds,
      (ph) => `SELECT id, name FROM clubs WHERE id IN (${ph})`,
    );
    for (const r of rows) clubNames.set(r.id, r.name);
  }

  const ok: Classified[] = [];
  const errors: ImportRowError[] = [];
  for (const contract of contracts) {
    const playerId = fcToId.get(contract.fcId);
    const player = playerId !== undefined ? byId.get(playerId) : undefined;
    if (!player) {
      errors.push({ row: contract.rowNo, field: 'uid', message: `uid 没有对应的球员（先跑球员导入）：${contract.uid}` });
      continue;
    }
    if (player.club_id !== null && player.club_id !== clubId) {
      const other = clubNames.get(player.club_id) ?? `#${player.club_id}`;
      errors.push({ row: contract.rowNo, field: 'uid', message: `球员「${player.name}」已归属 ${other}` });
      continue;
    }
    const existing = contractByPlayer.get(player.id);
    let outcome: Classified['outcome'];
    if (existing && existing.club_id !== clubId) {
      const other = existing.club_id !== null ? clubNames.get(existing.club_id) ?? `#${existing.club_id}` : '其他俱乐部';
      errors.push({ row: contract.rowNo, field: 'uid', message: `球员「${player.name}」的现行合同挂在 ${other} 名下` });
      continue;
    } else if (existing) {
      outcome = 'update';
    } else if (player.club_id === null) {
      outcome = 'claim';
    } else {
      outcome = 'create';
    }
    ok.push({ contract, playerId: player.id, playerName: player.name, outcome });
  }
  return { ok, errors };
}

export async function previewContractsImport(env: Env, body: unknown) {
  const payload = parseContractPayload(body);
  const outcome = runNormalize(payload.rows);
  const classified = await classify(env.DB, payload.clubId, outcome.contracts);
  const errors = [...outcome.errors, ...classified.errors].sort((a, b) => a.row - b.row);
  const valid = classified.ok.length;
  const insertEstimate = classified.ok.filter((c) => c.outcome !== 'update').length;
  return {
    channel: 'C' as const,
    clubId: payload.clubId,
    stats: {
      total: payload.rows.length,
      valid,
      error: errors.length,
      insertEstimate,
      updateEstimate: valid - insertEstimate,
    },
    errors: errors.slice(0, 50),
    samples: classified.ok.slice(0, 5).map((c) => ({
      uid: c.contract.uid,
      playerName: c.playerName,
      releaseFee: c.contract.releaseFee,
      wage: c.contract.wage,
      contractType: c.contract.contractType,
      effectiveFrom: c.contract.effectiveFrom,
      outcome: c.outcome,
    })),
  };
}

function upsertContractStatement(db: D1Database, clubId: number, c: Classified): D1PreparedStatement {
  // 冲突时保 signed_at 原值；protected_until 留空（保护期规则在转会增量落地）
  return db
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active)
       VALUES (?, ?, ?, ?, ?, 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, 1)
       ON CONFLICT(player_id) DO UPDATE SET
         club_id = excluded.club_id, release_fee = excluded.release_fee, wage = excluded.wage,
         contract_type = excluded.contract_type, effective_from = excluded.effective_from, is_active = 1`,
    )
    .bind(c.playerId, clubId, c.contract.releaseFee, c.contract.wage, c.contract.contractType, c.contract.effectiveFrom);
}

export async function confirmContractsImport(env: Env, actor: number, body: unknown) {
  const payload = parseContractPayload(body);
  const outcome = runNormalize(payload.rows);
  const classified = await classify(env.DB, payload.clubId, outcome.contracts);
  const errors = [...outcome.errors, ...classified.errors];
  if (errors.length > 0) {
    throw new HttpError(422, `合同导入还有 ${errors.length} 处校验错误，请先看预览报告`, 'contract_import_invalid');
  }

  const audit = createAuditStatement(env.DB);
  let written = 0;
  let inserted = 0;
  const batches = Math.ceil(classified.ok.length / CHUNK_ROWS) || 0;
  for (let i = 0; i < classified.ok.length; i += CHUNK_ROWS) {
    const slice = classified.ok.slice(i, i + CHUNK_ROWS);
    const insertCount = slice.filter((c) => c.outcome !== 'update').length;
    const claimIds = slice.filter((c) => c.outcome === 'claim').map((c) => c.playerId);
    const statements = slice.map((c) => upsertContractStatement(env.DB, payload.clubId, c));
    if (claimIds.length > 0) {
      const ph = claimIds.map(() => '?').join(', ');
      statements.push(
        // 认领只作用于仍无归属的行：分类与落库之间被人抢走也不会错绑。
        // initial_club_id（增量 6.1 裁决 2）= 首次认领时的归属即导入时数据；COALESCE 保证解约重签认领不覆盖最初值
        env.DB.prepare(
          `UPDATE players SET club_id = ?, initial_club_id = COALESCE(initial_club_id, ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (${ph}) AND club_id IS NULL`,
        ).bind(payload.clubId, payload.clubId, ...claimIds),
      );
    }
    statements.push(
      audit({
        actor,
        action: 'contracts_import',
        targetType: 'club',
        targetId: payload.clubId,
        after: { batchNo: i / CHUNK_ROWS + 1, rows: slice.length, insertEstimate: insertCount, updateEstimate: slice.length - insertCount },
      }),
    );
    await env.DB.batch(statements);
    written += slice.length;
    inserted += insertCount;
  }
  return {
    written,
    insertedEstimate: inserted,
    updatedEstimate: written - inserted,
    batches,
    channel: 'C' as const,
    clubId: payload.clubId,
  };
}
