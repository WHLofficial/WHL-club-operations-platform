// 窗刻度助手（v3.0.0，src/worker/contract-ticks.ts）：效力/保护期的唯一计数源。
// 口径：刻度 = 已关常规窗数（season_windows.is_temporary = 0），临时窗关窗不推进；
// 季初/中期不落库，按同赛季非临时窗顺序派生（第 1 个 = 季初、第 2 个 = 中期）。
import { describe, expect, it } from 'vitest';
import { createTestDb, sqlGet } from './d1.ts';
import { closedRegularTicks, currentWindow, regularWindowOrdinal, windowBaseTicks } from '../src/worker/contract-ticks.ts';

interface WindowSeed {
  season: number;
  windowSeq: number;
  status: 'open' | 'closed';
  isTemporary?: 0 | 1;
  closedAt?: string | null;
}

function seedWindows(db: D1Database, rows: WindowSeed[]): void {
  for (const r of rows) {
    db.prepare(
      `INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at)
       VALUES (?, ?, ?, ?, '2026-09-01T00:00:00.000Z', ?)`,
    )
      .bind(r.season, r.windowSeq, r.status, r.isTemporary ?? 0, r.closedAt ?? null)
      .run();
  }
}

describe('closedRegularTicks（效力推进计数）', () => {
  it('只数已关的常规窗：开放窗与临时窗都不计', async () => {
    const { db } = createTestDb();
    seedWindows(db, [
      { season: 1, windowSeq: 1, status: 'closed', closedAt: '2026-09-10T00:00:00.000Z' },
      { season: 1, windowSeq: 2, status: 'closed', closedAt: '2026-09-20T00:00:00.000Z' },
      { season: 2, windowSeq: 1, status: 'closed', isTemporary: 1, closedAt: '2026-09-25T00:00:00.000Z' },
      { season: 2, windowSeq: 2, status: 'open' },
    ]);
    await expect(closedRegularTicks(db)).resolves.toBe(2);
  });

  it('按签约时点截断：closed_at 晚于该时点的窗不计（含当日已关窗——日期串比较更小）', async () => {
    const { db } = createTestDb();
    seedWindows(db, [
      { season: 1, windowSeq: 1, status: 'closed', closedAt: '2026-09-10T00:00:00.000Z' },
      { season: 1, windowSeq: 2, status: 'closed', closedAt: '2026-09-20T12:00:00.000Z' },
    ]);
    await expect(closedRegularTicks(db, '2026-09-15T00:00:00.000Z')).resolves.toBe(1);
    await expect(closedRegularTicks(db, '2026-09-20')).resolves.toBe(1); // 仅日期的起点不把当日 12:00 的关窗算进来
    await expect(closedRegularTicks(db, '2026-09-30')).resolves.toBe(2);
  });
});

describe('windowBaseTicks（签约基数）', () => {
  it('无签约时点 → 取当下计数；有时点 → 按该时点截断', async () => {
    const { db } = createTestDb();
    seedWindows(db, [
      { season: 1, windowSeq: 1, status: 'closed', closedAt: '2026-09-10T00:00:00.000Z' },
      { season: 1, windowSeq: 2, status: 'closed', closedAt: '2026-09-20T12:00:00.000Z' },
    ]);
    await expect(windowBaseTicks(db, null)).resolves.toBe(2);
    await expect(windowBaseTicks(db, '2026-09-10T00:00:00.000Z')).resolves.toBe(1);
  });
});

describe('currentWindow / regularWindowOrdinal', () => {
  it('currentWindow 返回在开窗（取最新一个）并带临时窗标记；仅已关窗时为 null', async () => {
    const { db } = createTestDb();
    seedWindows(db, [
      { season: 1, windowSeq: 1, status: 'closed', closedAt: '2026-09-10T00:00:00.000Z' },
      { season: 1, windowSeq: 2, status: 'open', isTemporary: 1 },
    ]);
    await expect(currentWindow(db)).resolves.toEqual({ season: 1, windowSeq: 2, isTemporary: 1 });
    db.prepare(`UPDATE season_windows SET status = 'closed', closed_at = '2026-09-15T00:00:00.000Z'`).run();
    await expect(currentWindow(db)).resolves.toBeNull();
  });

  it('regularWindowOrdinal 数同赛季 window_seq ≤ 本窗的非临时窗（季初 1 / 中期 2；临时窗返回其之前已开的常规窗数）', async () => {
    const { db } = createTestDb();
    seedWindows(db, [
      { season: 2, windowSeq: 1, status: 'closed', closedAt: '2026-09-10T00:00:00.000Z' },
      { season: 1, windowSeq: 1, status: 'closed', closedAt: '2026-08-10T00:00:00.000Z' },
      { season: 2, windowSeq: 2, status: 'open' },
      { season: 2, windowSeq: 3, status: 'open', isTemporary: 1 },
    ]);
    await expect(regularWindowOrdinal(db, 2, 1)).resolves.toBe(1);
    await expect(regularWindowOrdinal(db, 2, 2)).resolves.toBe(2);
    await expect(regularWindowOrdinal(db, 2, 3)).resolves.toBe(2); // 临时窗本身不算，返回其之前已开的常规窗数
    await expect(regularWindowOrdinal(db, 1, 1)).resolves.toBe(1);
    await expect(regularWindowOrdinal(db, 9, 1)).resolves.toBe(0);
  });
});

describe('迁移 0028 的默认值', () => {
  it('contracts 新列：service_ticks 默认 0、protection_ticks 默认 NULL；season_windows.is_temporary 默认 0', () => {
    const { sqlite } = createTestDb();
    sqlite
      .prepare(
        `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status)
         VALUES (1, 'fc1', '甲', 1, 'GK', 20, 60, 80, 5, 'normal')`,
      )
      .run();
    sqlite
      .prepare(`INSERT INTO contracts (player_id, release_fee, wage) VALUES (1, 10, 1)`)
      .run();
    const ct = sqlGet<{ service_ticks: number; protection_ticks: number | null }>(
      sqlite,
      `SELECT service_ticks, protection_ticks FROM contracts WHERE player_id = 1`,
    );
    expect(ct).toEqual({ service_ticks: 0, protection_ticks: null });
    sqlite
      .prepare(`INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (5, 1, 'open', 'x')`)
      .run();
    expect(
      sqlGet<{ is_temporary: number }>(sqlite, `SELECT is_temporary FROM season_windows WHERE season = 5`)?.is_temporary,
    ).toBe(0);
  });
});
