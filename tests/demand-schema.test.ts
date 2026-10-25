// v6.54.0 闹涨薪 · 迁移 0079 的定向验收（设计文档 §6 数据模型 / §5.7 生效时点）
// 覆盖：四张新表存在与关键列、CHECK 枚举、默认值、UNIQUE(player_id, season, window_seq)、
// 两条 demand 索引、部分唯一索引 idx_pending_one_per_player 语义、transfers 三列快照可空。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMigrations, sqlAll, sqlGet } from './d1.ts';

const MIGRATION = '0079_renewal_demand.sql';
const MIGRATIONS_DIR = new URL('../src/db/migrations/', import.meta.url);
const SOURCE = readFileSync(fileURLToPath(new URL(MIGRATION, MIGRATIONS_DIR).href), 'utf8');

function columnInfo(sqlite: DatabaseSync, table: string) {
  const rows = sqlAll<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
    sqlite,
    `PRAGMA table_info(${table})`,
  );
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

// contract_demands 的最小合法行（未给的列要么有默认要么可空）
function insertDemand(sqlite: DatabaseSync, over: Record<string, string | number> = {}): number {
  const cols: Record<string, string | number> = {
    player_id: 1,
    club_id: 1,
    season: 9,
    window_seq: 3,
    current_wage: 10,
    expected_wage: 14,
    target_wage: 15,
    floor_wage: 13,
    raise_pct: 0.5,
    expires_at: '2026-10-28T00:00:00Z',
    seed: 12345,
    ...over,
  };
  const keys = Object.keys(cols);
  const info = sqlite
    .prepare(`INSERT INTO contract_demands (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...Object.values(cols));
  return Number(info.lastInsertRowid);
}

function insertPending(sqlite: DatabaseSync, over: Record<string, string | number> = {}): number {
  const cols: Record<string, string | number> = {
    player_id: 1,
    club_id: 1,
    source: 'demand',
    wage_new: 15,
    effective_window_seq: 4,
    ...over,
  };
  const keys = Object.keys(cols);
  const info = sqlite
    .prepare(`INSERT INTO contract_pending_changes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...Object.values(cols));
  return Number(info.lastInsertRowid);
}

describe('0079 · 表与关键列', () => {
  it('空库全量迁移不抛；四张新表存在；登记与迁移目录不脱节且本迁移已登记', () => {
    const sqlite = new DatabaseSync(':memory:');
    expect(() => applyMigrations(sqlite)).not.toThrow();

    const tables = sqlAll<{ name: string }>(
      sqlite,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN " +
        "('contract_demands','contract_pending_changes','contract_demand_attempts','transfer_requests')",
    ).map((row) => row.name);
    expect(tables).toHaveLength(4);

    const latest = readdirSync(fileURLToPath(MIGRATIONS_DIR.href))
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .at(-1);
    const registry = readFileSync(fileURLToPath(new URL('./d1.ts', import.meta.url).href), 'utf8');
    const listed = [...registry.matchAll(/'(\d{4}_[^']+\.sql)'/g)].map((match) => match[1]);
    expect(listed.at(-1)).toBe(latest);
    expect(listed).toContain(MIGRATION);
  });

  it('迁移文件不含 BEGIN/COMMIT（执行器自带事务）', () => {
    const sql = SOURCE.split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/\bBEGIN\b/i);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
  });

  it('contract_demands 关键列：NOT NULL / 默认值 / 可空面正确，实插一行读回默认', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    const cols = columnInfo(sqlite, 'contract_demands');
    for (const name of ['player_id', 'club_id', 'season', 'window_seq']) {
      expect(cols[name]).toMatchObject({ type: 'INTEGER', notnull: 1 });
    }
    for (const name of ['current_wage', 'expected_wage', 'target_wage', 'floor_wage', 'raise_pct']) {
      expect(cols[name]).toMatchObject({ type: 'REAL', notnull: 1 });
    }
    expect(cols.status).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'pending'" });
    expect(cols.rc_current).toMatchObject({ type: 'REAL', notnull: 1, dflt_value: '0' });
    expect(cols.rc_floor).toMatchObject({ type: 'REAL', notnull: 1, dflt_value: '0' });
    expect(cols.rc_fee).toMatchObject({ type: 'REAL', notnull: 1, dflt_value: '0' });
    expect(cols.round).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(cols.reminded_at).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" });
    expect(cols.seed).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(cols.expires_at).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: null });
    // 结果与生命周期列可空
    for (const name of ['resolution', 'resolved_by', 'resolved_at', 'applied_at', 'void_reason']) {
      expect(cols[name]).toMatchObject({ notnull: 0, dflt_value: null });
    }

    const id = insertDemand(sqlite);
    expect(
      sqlGet<{
        status: string;
        round: number;
        rc_current: number;
        rc_floor: number;
        rc_fee: number;
        reminded_at: string;
        resolution: string | null;
        created_at: string;
      }>(sqlite, 'SELECT status, round, rc_current, rc_floor, rc_fee, reminded_at, resolution, created_at FROM contract_demands WHERE id = ?', id),
    ).toMatchObject({
      status: 'pending',
      round: 0,
      rc_current: 0,
      rc_floor: 0,
      rc_fee: 0,
      reminded_at: '',
      resolution: null,
    });
  });

  it('contract_pending_changes 关键列：rc/free_rc_change 默认 0、NULL=不变的三个可空列、默认读回', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    const cols = columnInfo(sqlite, 'contract_pending_changes');
    expect(cols.source).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(cols.demand_id).toMatchObject({ type: 'INTEGER', notnull: 0 });
    expect(cols.wage_new).toMatchObject({ type: 'REAL', notnull: 1 });
    expect(cols.release_fee_new).toMatchObject({ type: 'REAL', notnull: 0 });
    expect(cols.protection_ticks_new).toMatchObject({ type: 'INTEGER', notnull: 0 });
    expect(cols.rc_fee).toMatchObject({ type: 'REAL', notnull: 1, dflt_value: '0' });
    expect(cols.free_rc_change).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(cols.status).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'pending'" });
    expect(cols.effective_window_seq).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(cols.rc_fee_charged_at).toMatchObject({ notnull: 0 });
    expect(cols.applied_at).toMatchObject({ notnull: 0 });

    const id = insertPending(sqlite);
    expect(
      sqlGet<{ status: string; rc_fee: number; free_rc_change: number; release_fee_new: number | null; created_at: string }>(
        sqlite,
        'SELECT status, rc_fee, free_rc_change, release_fee_new, created_at FROM contract_pending_changes WHERE id = ?',
        id,
      ),
    ).toMatchObject({ status: 'pending', rc_fee: 0, free_rc_change: 0, release_fee_new: null });
  });

  it('contract_demand_attempts 与 transfer_requests 关键列与默认读回', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    const attempts = columnInfo(sqlite, 'contract_demand_attempts');
    expect(attempts.demand_id).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(attempts.round).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(attempts.wage).toMatchObject({ type: 'REAL', notnull: 1 });
    expect(attempts.accepted).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });

    const req = columnInfo(sqlite, 'transfer_requests');
    expect(req.player_id).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(req.club_id).toMatchObject({ type: 'INTEGER', notnull: 1 });
    expect(req.demand_id).toMatchObject({ notnull: 0 });
    expect(req.source).toMatchObject({ type: 'TEXT', notnull: 1 });
    expect(req.listing_id).toMatchObject({ notnull: 0 });
    expect(req.last_listing_window_seq).toMatchObject({ notnull: 0 });
    expect(req.status).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'pending'" });
    expect(req.resolved_at).toMatchObject({ notnull: 0 });

    const demandId = insertDemand(sqlite);
    sqlite
      .prepare('INSERT INTO contract_demand_attempts (demand_id, round, wage) VALUES (?, 0, 12)')
      .run(demandId);
    sqlite.prepare("INSERT INTO transfer_requests (player_id, club_id, demand_id, source) VALUES (1, 1, ?, 'collapse')").run(demandId);

    expect(
      sqlGet<{ accepted: number }>(sqlite, 'SELECT accepted FROM contract_demand_attempts WHERE demand_id = ?', demandId),
    ).toEqual({ accepted: 0 });
    expect(
      sqlGet<{ status: string; listing_id: number | null }>(
        sqlite,
        'SELECT status, listing_id FROM transfer_requests WHERE demand_id = ?',
        demandId,
      ),
    ).toEqual({ status: 'pending', listing_id: null });
  });

  it('transfers 三列快照存在、均可空、无默认；实插一行读回 NULL', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    const cols = columnInfo(sqlite, 'transfers');
    expect(cols.src_service_ticks).toMatchObject({ type: 'INTEGER', notnull: 0, dflt_value: null });
    expect(cols.src_protection_ticks).toMatchObject({ type: 'INTEGER', notnull: 0, dflt_value: null });
    expect(cols.src_signed_at).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });

    sqlite.prepare("INSERT INTO transfers (id, type, status) VALUES (1, 'transfer', 'completed')").run();
    expect(
      sqlGet<{ src_service_ticks: number | null; src_protection_ticks: number | null; src_signed_at: string | null }>(
        sqlite,
        'SELECT src_service_ticks, src_protection_ticks, src_signed_at FROM transfers WHERE id = 1',
      ),
    ).toEqual({ src_service_ticks: null, src_protection_ticks: null, src_signed_at: null });

    // 快照分支可正常写（类型对齐 contracts：service_ticks 整数 / signed_at 文本时刻）
    sqlite
      .prepare("UPDATE transfers SET src_service_ticks = 4, src_protection_ticks = 7, src_signed_at = '2026-10-25T00:00:00Z' WHERE id = 1")
      .run();
    expect(
      sqlGet<{ src_service_ticks: number; src_protection_ticks: number; src_signed_at: string }>(
        sqlite,
        'SELECT src_service_ticks, src_protection_ticks, src_signed_at FROM transfers WHERE id = 1',
      ),
    ).toEqual({ src_service_ticks: 4, src_protection_ticks: 7, src_signed_at: '2026-10-25T00:00:00Z' });
  });
});

describe('0079 · CHECK 枚举', () => {
  it('contract_demands.status 六态可写、非法值抛；合法值不受误伤', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    let n = 0;
    const run = (status: string) => () => {
      n += 1;
      insertDemand(sqlite, { player_id: n, status });
    };

    for (const status of ['pending', 'countered', 'accepted', 'rejected', 'expired', 'void']) {
      expect(run(status)).not.toThrow();
    }
    expect(run('done')).toThrow(/CHECK constraint failed/);
    expect(run('PENDING')).toThrow(/CHECK constraint failed/);
  });

  it('contract_pending_changes.source / status 三态各自可写、非法值抛', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    let n = 0;
    const run = (over: Record<string, string>) => () => {
      n += 1;
      insertPending(sqlite, { player_id: n, ...over });
    };

    for (const source of ['demand', 'renewal', 'rejection']) {
      expect(run({ source })).not.toThrow();
    }
    expect(run({ source: 'renew' })).toThrow(/CHECK constraint failed/);

    // status 换到同一行上验：pending 已是默认；applied / void 可写；非法值抛
    const id = insertPending(sqlite, { player_id: 900 });
    const setStatus = (status: string) => () =>
      sqlite.prepare('UPDATE contract_pending_changes SET status = ? WHERE id = ?').run(status, id);
    expect(setStatus('applied')).not.toThrow();
    expect(setStatus('void')).not.toThrow();
    expect(setStatus('done')).toThrow(/CHECK constraint failed/);
  });

  it('transfer_requests.source / status 枚举可写、非法值抛', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    let n = 0;
    const insert = (source: string) => () => {
      n += 1;
      sqlite
        .prepare('INSERT INTO transfer_requests (player_id, club_id, source) VALUES (?, 1, ?)')
        .run(n, source);
    };

    for (const source of ['direct', 'collapse', 'lowball']) {
      expect(insert(source)).not.toThrow();
    }
    expect(insert('release')).toThrow(/CHECK constraint failed/);

    const id = sqlGet<{ id: number }>(sqlite, 'SELECT id FROM transfer_requests LIMIT 1')!.id;
    const setStatus = (status: string) => () =>
      sqlite.prepare('UPDATE transfer_requests SET status = ? WHERE id = ?').run(status, id);
    for (const status of ['pending', 'listed', 'released', 'resolved']) {
      expect(setStatus(status)).not.toThrow();
    }
    expect(setStatus('void')).toThrow(/CHECK constraint failed/);
  });
});

describe('0079 · 唯一约束', () => {
  it('contract_demands UNIQUE (player_id, season, window_seq)：同窗第二条抛，跨窗/换人放行', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    insertDemand(sqlite, { player_id: 1, season: 9, window_seq: 3 });

    expect(() => insertDemand(sqlite, { player_id: 1, season: 9, window_seq: 3 })).toThrow(
      /UNIQUE constraint failed: contract_demands\.player_id/,
    );
    expect(() => insertDemand(sqlite, { player_id: 1, season: 9, window_seq: 4 })).not.toThrow();
    expect(() => insertDemand(sqlite, { player_id: 2, season: 9, window_seq: 3 })).not.toThrow();
  });

  it('contract_demand_attempts UNIQUE (demand_id, round) 与 transfer_requests UNIQUE (player_id, club_id, demand_id)', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const demandId = insertDemand(sqlite);

    const insertAttempt = () =>
      sqlite.prepare('INSERT INTO contract_demand_attempts (demand_id, round, wage) VALUES (?, 0, 12)').run(demandId);
    expect(insertAttempt).not.toThrow();
    expect(insertAttempt).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      sqlite.prepare('INSERT INTO contract_demand_attempts (demand_id, round, wage) VALUES (?, 1, 13)').run(demandId),
    ).not.toThrow();

    const insertRequest = () =>
      sqlite
        .prepare("INSERT INTO transfer_requests (player_id, club_id, demand_id, source) VALUES (5, 2, ?, 'direct')")
        .run(demandId);
    expect(insertRequest).not.toThrow();
    expect(insertRequest).toThrow(/UNIQUE constraint failed/);
  });
});

describe('0079 · 索引', () => {
  it('两条 demand 索引与 idx_pending_club_status 在场，列序与设计一致', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    const indexes = sqlAll<{ name: string; tbl_name: string; sql: string }>(
      sqlite,
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name IN " +
        "('idx_contract_demands_club_status','idx_contract_demands_player','idx_pending_one_per_player','idx_pending_club_status')",
    );
    expect(indexes).toHaveLength(4);

    const clubStatus = indexes.find((row) => row.name === 'idx_contract_demands_club_status')!;
    expect(clubStatus.tbl_name).toBe('contract_demands');
    expect(clubStatus.sql).toContain('(club_id, status, expires_at)');
    const player = indexes.find((row) => row.name === 'idx_contract_demands_player')!;
    expect(player.tbl_name).toBe('contract_demands');
    expect(player.sql).toContain('(player_id, season, window_seq)');
    const pendingClub = indexes.find((row) => row.name === 'idx_pending_club_status')!;
    expect(pendingClub.tbl_name).toBe('contract_pending_changes');
    expect(pendingClub.sql).toContain('(club_id, status, effective_window_seq)');
  });

  it('部分唯一索引：同球员第二条 pending 违反约束；他人放行；resolved 后可再挂新 pending；非 pending 行不受限', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    const index = sqlGet<{ sql: string }>(
      sqlite,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_pending_one_per_player'",
    );
    expect(index?.sql).toContain("WHERE status='pending'");

    insertPending(sqlite, { player_id: 7, source: 'demand', wage_new: 15 });
    // 闹涨薪已接受（pending 在挂）又提普通续约 → 第二条 pending 必须在库层被拦
    expect(() => insertPending(sqlite, { player_id: 7, source: 'renewal', wage_new: 14 })).toThrow(
      /UNIQUE constraint failed/,
    );
    // 别的球员不受影响
    expect(() => insertPending(sqlite, { player_id: 8, source: 'demand', wage_new: 9 })).not.toThrow();

    // 同球员两条非 pending 行不冲突（applied/void 是历史事实，允许并存）
    sqlite.prepare("UPDATE contract_pending_changes SET status = 'applied' WHERE player_id = 7").run();
    expect(() => insertPending(sqlite, { player_id: 7, source: 'demand', wage_new: 15 })).not.toThrow();
    expect(() => insertPending(sqlite, { player_id: 7, status: 'void', source: 'renewal', wage_new: 14 })).not.toThrow();

    // 第一条已 applied（不再 pending）→ 新 pending 放行
    expect(sqlAll(sqlite, "SELECT 1 FROM contract_pending_changes WHERE player_id = 7 AND status = 'pending'")).toHaveLength(1);
  });
});
