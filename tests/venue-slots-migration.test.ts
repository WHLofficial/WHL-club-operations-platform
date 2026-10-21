// v6.53.0 球场档期 P0 · 迁移 0078 的定向验收（计划 §2 / §7.2）
// 覆盖：四列与默认值、CHECK 四边、存量 one-shot 不被延长、open 窗唯一索引、
// ops_schedule.consumption 的窗口闸与 absolute 不被覆盖、失败路径无半状态、登记与空库。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMigrations, runMigration, sqlAll, sqlGet } from './d1.ts';

const MIGRATION = '0078_venue_slots_p0.sql';
const PREVIOUS = '0077_growth_nongrowable_reset.sql';
const MIGRATIONS_DIR = new URL('../src/db/migrations/', import.meta.url);
const SOURCE = readFileSync(fileURLToPath(new URL(MIGRATION, MIGRATIONS_DIR).href), 'utf8');

// 停在 0077 的「旧库」：用于造存量数据后再补跑 0078
function legacyDb(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite, PREVIOUS);
  return sqlite;
}

// 从迁移源码里切出某一条 DDL（去掉 -- 注释行），用来验证「重跑 0 行」与「不覆盖手工配置」
function statementBetween(startMarker: string, endMarker?: string): string {
  const start = SOURCE.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endMarker ? SOURCE.indexOf(endMarker, start + startMarker.length) : SOURCE.length;
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

function seedClub(sqlite: DatabaseSync, id: number): void {
  sqlite.prepare('INSERT INTO clubs (id, name) VALUES (?, ?)').run(id, `测试队${id}`);
  sqlite.prepare('INSERT INTO stadiums (club_id) VALUES (?)').run(id);
}

function columnInfo(sqlite: DatabaseSync, table: string) {
  const rows = sqlAll<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
    sqlite,
    `PRAGMA table_info(${table})`,
  );
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

describe('0078 · 列与默认值', () => {
  it('四列存在，NOT NULL / 默认值 / city 可空均正确', () => {
    const sqlite = new DatabaseSync(':memory:');
    expect(() => applyMigrations(sqlite)).not.toThrow();

    const windows = columnInfo(sqlite, 'season_windows');
    expect(windows.venue_reminder_at).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" });

    const stadiums = columnInfo(sqlite, 'stadiums');
    expect(stadiums.venue_reputation).toMatchObject({ type: 'REAL', notnull: 1, dflt_value: '0' });
    expect(stadiums.attendance_mod_matches).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });

    const clubs = columnInfo(sqlite, 'clubs');
    expect(clubs.venue_policy).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" });
    expect(clubs.city).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });

    // 实插一行读回默认值（PRAGMA 的 dflt_value 只是 DDL 文本，不证明写入行为）
    sqlite.prepare("INSERT INTO season_windows (season, window_seq, status) VALUES (1, 1, 'closed')").run();
    expect(sqlGet<{ venue_reminder_at: string }>(sqlite, 'SELECT venue_reminder_at FROM season_windows'))
      .toEqual({ venue_reminder_at: '' });

    seedClub(sqlite, 1);
    expect(
      sqlGet<{ venue_reputation: number; attendance_mod_matches: number }>(
        sqlite,
        'SELECT venue_reputation, attendance_mod_matches FROM stadiums WHERE club_id = 1',
      ),
    ).toEqual({ venue_reputation: 0, attendance_mod_matches: 0 });
    expect(sqlGet<{ venue_policy: string; city: string | null }>(sqlite, 'SELECT venue_policy, city FROM clubs WHERE id = 1'))
      .toEqual({ venue_policy: '', city: null });
  });

  it('CHECK 四类非法值都抛；边界值与合法枚举可写；K 不被锁进 CHECK', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    seedClub(sqlite, 1);
    const run = (sql: string, ...params: (string | number)[]) => () => sqlite.prepare(sql).run(...params);

    expect(run('UPDATE stadiums SET venue_reputation = 100.1')).toThrow(/CHECK constraint failed/);
    expect(run('UPDATE stadiums SET venue_reputation = -0.1')).toThrow(/CHECK constraint failed/);
    expect(run('UPDATE stadiums SET attendance_mod_matches = -1')).toThrow(/CHECK constraint failed/);
    expect(run("UPDATE clubs SET venue_policy = 'attack'")).toThrow(/CHECK constraint failed/);

    // 边界（0 与 100）与四个合法枚举都不得误伤
    expect(run('UPDATE stadiums SET venue_reputation = 0, attendance_mod_matches = 0')).not.toThrow();
    expect(run('UPDATE stadiums SET venue_reputation = 100')).not.toThrow();
    for (const policy of ['', 'money', 'fans', 'reputation']) {
      expect(run('UPDATE clubs SET venue_policy = ?', policy)).not.toThrow();
    }
    // K 是代码常量（固定 5），DDL 不得把它锁死 —— 改 K 不该要重建表
    expect(run('UPDATE stadiums SET attendance_mod_matches = 9')).not.toThrow();
  });
});

describe('0078 · 存量 one-shot 不被延长（设计 Q12）', () => {
  it('next_attendance_mod <> 1 的存量行迁移后 K 仍为 0，预置值原样保留', () => {
    const sqlite = legacyDb();
    seedClub(sqlite, 1);
    seedClub(sqlite, 2);
    sqlite.prepare('UPDATE stadiums SET next_attendance_mod = 1.5 WHERE club_id = 1').run();
    sqlite.prepare('UPDATE stadiums SET next_attendance_mod = 0.95 WHERE club_id = 2').run();

    runMigration(sqlite, MIGRATION);

    expect(
      sqlAll<{ club_id: number; next_attendance_mod: number; attendance_mod_matches: number }>(
        sqlite,
        'SELECT club_id, next_attendance_mod, attendance_mod_matches FROM stadiums ORDER BY club_id',
      ),
    ).toEqual([
      { club_id: 1, next_attendance_mod: 1.5, attendance_mod_matches: 0 },
      { club_id: 2, next_attendance_mod: 0.95, attendance_mod_matches: 0 },
    ]);

    // 第 ⑤ 条重跑：存量行 K 已是 0 ⇒ 写 0 行（D1 写额度口径）
    expect(sqlite.prepare(statementBetween('-- ⑤', '-- ⑥')).run().changes).toBe(0);
  });

  it('判定条件两半都成立才归零：手工置过 K 且 next_mod<>1 才写，next_mod=1 的行不动', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    seedClub(sqlite, 1);
    seedClub(sqlite, 2);
    sqlite.prepare('UPDATE stadiums SET next_attendance_mod = 1.5, attendance_mod_matches = 3 WHERE club_id = 1').run();
    sqlite.prepare('UPDATE stadiums SET next_attendance_mod = 1, attendance_mod_matches = 2 WHERE club_id = 2').run();

    expect(sqlite.prepare(statementBetween('-- ⑤', '-- ⑥')).run().changes).toBe(1);
    expect(
      sqlAll<{ club_id: number; attendance_mod_matches: number }>(
        sqlite,
        'SELECT club_id, attendance_mod_matches FROM stadiums ORDER BY club_id',
      ),
    ).toEqual([
      { club_id: 1, attendance_mod_matches: 0 },
      { club_id: 2, attendance_mod_matches: 2 },
    ]);
  });
});

describe('0078 · idx_season_windows_open', () => {
  it('拒绝第 2 个 open 窗；多个 closed 与 status IS NULL 的历史行不受限', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const insert = sqlite.prepare('INSERT INTO season_windows (season, window_seq, status) VALUES (?, ?, ?)');

    insert.run(1, 1, 'closed');
    insert.run(1, 2, 'closed');
    insert.run(2, 1, 'open');
    expect(() => insert.run(2, 2, 'open')).toThrow(/UNIQUE constraint failed: season_windows\.status/);
    // 部分索引只覆盖 'open'：NULL 与 closed 可多条
    insert.run(3, 1, null);
    insert.run(3, 2, null);
    insert.run(4, 1, 'closed');

    const index = sqlGet<{ sql: string }>(
      sqlite,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_season_windows_open'",
    );
    expect(index?.sql).toContain("WHERE status = 'open'");
  });

  it('存量已有两个 open 窗时在第 1 条失败，四列一列未加且无结算表（无半状态）', () => {
    const sqlite = legacyDb();
    sqlite.prepare("INSERT INTO season_windows (season, window_seq, status) VALUES (1, 1, 'open')").run();
    sqlite.prepare("INSERT INTO season_windows (season, window_seq, status) VALUES (2, 1, 'open')").run();

    expect(() => runMigration(sqlite, MIGRATION)).toThrow(/UNIQUE constraint failed: season_windows\.status/);

    const windowNames = sqlAll<{ name: string }>(sqlite, 'PRAGMA table_info(season_windows)').map((row) => row.name);
    const stadiumNames = sqlAll<{ name: string }>(sqlite, 'PRAGMA table_info(stadiums)').map((row) => row.name);
    const clubNames = sqlAll<{ name: string }>(sqlite, 'PRAGMA table_info(clubs)').map((row) => row.name);
    expect(windowNames).not.toContain('venue_reminder_at');
    expect(stadiumNames).not.toContain('venue_reputation');
    expect(stadiumNames).not.toContain('attendance_mod_matches');
    expect(clubNames).not.toContain('venue_policy');
    expect(clubNames).not.toContain('city');
    expect(sqlGet(sqlite, "SELECT name FROM sqlite_master WHERE name = 'venue_window_settlements'")).toBeUndefined();
  });
});

describe('0078 · ops_schedule.consumption 的窗口闸', () => {
  it('迁移后锚到 window_open / window_close，requires_window = 1；其余 10 行保持双 none', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);

    expect(
      sqlGet<{
        start_anchor: string;
        start_at: string | null;
        end_anchor: string;
        end_at: string | null;
        requires_window: number;
      }>(
        sqlite,
        "SELECT start_anchor, start_at, end_anchor, end_at, requires_window FROM ops_schedule WHERE op_key = 'consumption'",
      ),
    ).toEqual({
      start_anchor: 'window_open',
      start_at: null,
      end_anchor: 'window_close',
      end_at: null,
      requires_window: 1,
    });

    const others = sqlAll<{ op_key: string }>(
      sqlite,
      "SELECT op_key FROM ops_schedule WHERE op_key <> 'consumption' AND start_anchor = 'none' AND end_anchor = 'none' ORDER BY op_key",
    );
    expect(others).toHaveLength(10);
  });

  it('运营先改成 absolute 再跑迁移：锚点与时间都不被覆盖，第 ⑨ 条重跑 0 行', () => {
    const sqlite = legacyDb();
    sqlite
      .prepare(
        `UPDATE ops_schedule
            SET start_anchor = 'absolute', start_at = '2026-01-01T00:00:00.000Z',
                end_anchor = 'absolute', end_at = '2026-01-02T00:00:00.000Z'
          WHERE op_key = 'consumption'`,
      )
      .run();

    runMigration(sqlite, MIGRATION);

    expect(
      sqlGet<{ start_anchor: string; start_at: string | null; end_anchor: string; end_at: string | null }>(
        sqlite,
        "SELECT start_anchor, start_at, end_anchor, end_at FROM ops_schedule WHERE op_key = 'consumption'",
      ),
    ).toEqual({
      start_anchor: 'absolute',
      start_at: '2026-01-01T00:00:00.000Z',
      end_anchor: 'absolute',
      end_at: '2026-01-02T00:00:00.000Z',
    });

    expect(sqlite.prepare(statementBetween('-- ⑨')).run().changes).toBe(0);
  });
});

describe('0078 · 结算台账、登记与空库', () => {
  it('venue_window_settlements 以 (club_id, season, window_seq) 为幂等主键', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite);
    const insert = sqlite.prepare(
      "INSERT INTO venue_window_settlements (club_id, season, window_seq, created_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')",
    );

    insert.run(1, 2, 3);
    expect(() => insert.run(1, 2, 3)).toThrow(/UNIQUE constraint failed: venue_window_settlements\.club_id/);
    insert.run(1, 2, 4);
    expect(
      sqlGet<{ reputation_gain: number; attend_mod: number; bookings: number }>(
        sqlite,
        'SELECT reputation_gain, attend_mod, bookings FROM venue_window_settlements WHERE club_id = 1 AND window_seq = 3',
      ),
    ).toEqual({ reputation_gain: 0, attend_mod: 1, bookings: 0 });
  });

  it('空库全量迁移不抛', () => {
    const sqlite = new DatabaseSync(':memory:');
    expect(() => applyMigrations(sqlite)).not.toThrow();
  });

  it('tests/d1.ts 的登记末项与迁移目录按名排序的最新一枚一致', () => {
    const latest = readdirSync(fileURLToPath(MIGRATIONS_DIR.href))
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .at(-1);
    expect(latest).toBe(MIGRATION);

    const registry = readFileSync(fileURLToPath(new URL('./d1.ts', import.meta.url).href), 'utf8');
    const listed = [...registry.matchAll(/'(\d{4}_[^']+\.sql)'/g)].map((match) => match[1]);
    expect(listed.at(-1)).toBe(MIGRATION);
  });

  it('迁移文件不含 BEGIN/COMMIT（执行器自带事务）', () => {
    const sql = SOURCE.split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/\bBEGIN\b/i);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
  });
});
