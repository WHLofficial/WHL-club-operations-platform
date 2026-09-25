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
import { CPU_CLUB_IDS_SQL, cpuClubIds } from './growth.ts';
import { protectionTicksFor } from '../core/bypass-rules.ts';
import { windowBaseTicks } from './contract-ticks.ts';
import { rowDisplayName } from '../core/player-name.ts';

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

// 目标俱乐部必须真实存在（v2.8.0 缺陷修复）：预览/确认都查，坏 clubId 原本会静默放行、
// 落库才撞 contracts.club_id 外键炸 500
async function requireClubExists(db: D1Database, clubId: number): Promise<void> {
  const club = await db.prepare('SELECT id FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '目标俱乐部不存在，先到「俱乐部」里建队', 'club_not_found');
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
  // CPU 队球员带 club_id 但照旧可被认领（v2.0.0，用户裁决）：认领 = 从 CPU 队转入本队
  const cpuIds = await cpuClubIds(db);
  const idRows = await lookupIn<{ id: number; fc_id: number; club_id: number | null; name: string; display_name: string | null }>(
    db,
    contracts.map((c) => c.fcId),
    (ph) => `SELECT id, fc_id, club_id, name, display_name FROM players WHERE fc_id IN (${ph})`,
  );
  const byId = new Map<number, PlayerRow>();
  const fcToId = new Map<number, number>();
  for (const r of idRows) {
    byId.set(r.id, { id: r.id, club_id: r.club_id, name: rowDisplayName(r) });
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
      idRows
        .filter((p) => p.club_id !== null && p.club_id !== clubId && !cpuIds.has(p.club_id as number))
        .map((p) => p.club_id as number),
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
    if (player.club_id !== null && player.club_id !== clubId && !cpuIds.has(player.club_id)) {
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
    } else if (player.club_id === null || cpuIds.has(player.club_id)) {
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
  await requireClubExists(env.DB, payload.clubId);
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

function upsertContractStatement(
  db: D1Database,
  clubId: number,
  c: Classified,
  baseTicks: number,
): D1PreparedStatement {
  // 冲突时保 signed_at 原值；窗刻度（v3.0.0）：效力基数取该合同效力起点当年已关常规窗数，
  // 保护期 = 基数 + 3 个常规窗（训练营无保护期）；导入不落 signed_season/signed_window_seq
  return db
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from,
                              service_ticks, protection_ticks, is_active)
       VALUES (?, ?, ?, ?, ?, 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, 1)
       ON CONFLICT(player_id) DO UPDATE SET
         club_id = excluded.club_id, release_fee = excluded.release_fee, wage = excluded.wage,
         contract_type = excluded.contract_type, effective_from = excluded.effective_from,
         service_ticks = excluded.service_ticks, protection_ticks = excluded.protection_ticks, is_active = 1`,
    )
    .bind(
      c.playerId,
      clubId,
      c.contract.releaseFee,
      c.contract.wage,
      c.contract.contractType,
      c.contract.effectiveFrom,
      baseTicks,
      protectionTicksFor(baseTicks, c.contract.contractType),
    );
}

export async function confirmContractsImport(env: Env, actor: number, body: unknown) {
  const payload = parseContractPayload(body);
  await requireClubExists(env.DB, payload.clubId);
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
  // 效力基数按「效力起点」当日已关常规窗数算（同一日期只查一次）
  const baseTicksCache = new Map<string, number>();
  const baseTicksFor = async (effectiveFrom: string): Promise<number> => {
    const cached = baseTicksCache.get(effectiveFrom);
    if (cached !== undefined) return cached;
    const value = await windowBaseTicks(env.DB, effectiveFrom);
    baseTicksCache.set(effectiveFrom, value);
    return value;
  };
  for (let i = 0; i < classified.ok.length; i += CHUNK_ROWS) {
    const slice = classified.ok.slice(i, i + CHUNK_ROWS);
    const insertCount = slice.filter((c) => c.outcome !== 'update').length;
    const claimIds = slice.filter((c) => c.outcome === 'claim').map((c) => c.playerId);
    const statements: D1PreparedStatement[] = [];
    for (const c of slice) {
      statements.push(upsertContractStatement(env.DB, payload.clubId, c, await baseTicksFor(c.contract.effectiveFrom)));
    }
    if (claimIds.length > 0) {
      const ph = claimIds.map(() => '?').join(', ');
      statements.push(
        // 认领只作用于仍无归属、或仍挂 CPU 队的行：分类与落库之间被人抢走也不会错绑。
        // 号码一并清空（v4.0.0）：换队即失效，新东家自己定号
        env.DB.prepare(
          `UPDATE players SET club_id = ?, number = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id IN (${ph}) AND (club_id IS NULL OR club_id IN ${CPU_CLUB_IDS_SQL})`,
        ).bind(payload.clubId, ...claimIds),
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
