// 窗口期薪资三段（v6.69.0 期二，设计稿 §3.3）：
//   1. now 与 window-payroll 的扣费基数同源（全部 active 合同，含训练营 0.75）；
//   2. 窗开时写基线（非 CPU 队），工作台据此算 delta / 本窗进出人数；
//   3. 没有基线行时 delta = null（D12：不拿 0 冒充窗初）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { loadSquadWages } from '../src/worker/squad-view.ts';
import { openWindow } from '../src/worker/window-machine.ts';
import { resetConfigCache } from '../src/core/config.ts';

function fixture(): { env: Env; sqlite: DatabaseSync } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const env = { DB: createTestD1(sqlite), KV: new Map<string, string>() } as unknown as Env;
  return { env, sqlite };
}

function seed(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO clubs (id, name) VALUES (1, '甲队'), (2, '乙队');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa) VALUES
      (11, 'p11', '甲一', 1, 'ST', 80, 90),
      (12, 'p12', '甲二', 1, 'CB', 80, 90),
      (21, 'p21', '乙一', 2, 'GK', 80, 90);
    INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, is_active)
      VALUES (11, 1, 5, 20, 'formal', 1),
             (12, 1, 0.75, 5, 'trainee', 1),
             (21, 2, 4, 16, 'formal', 1);
  `);
}

describe('窗口期薪资三段', () => {
  it('now = Σ 全部 active 合同（含训练营），cap/overspend 按帽值算', async () => {
    const { env, sqlite } = fixture();
    seed(sqlite);
    const w = await loadSquadWages(env.DB, 1, { cap: 68, pendingDelta: 0, season: null, windowSeq: null });
    expect(w.now).toBe(5.75);
    expect(w.projected).toBe(5.75);
    expect(w.overspend).toBe(0);
    expect(w.baseline).toBeNull();
    expect(w.delta).toBeNull();
    expect(w.inCount).toBe(0);
  });

  it('超帽时 overspend = now - cap，projected 含待生效增量', async () => {
    const { env, sqlite } = fixture();
    seed(sqlite);
    const w = await loadSquadWages(env.DB, 1, { cap: 5, pendingDelta: 1.5, season: 1, windowSeq: 1 });
    expect(w.now).toBe(5.75);
    expect(w.projected).toBe(7.25);
    expect(w.overspend).toBe(0.75);
  });

  it('窗开时写基线（非 CPU 队），有基线后 delta = now - baseline，本窗进出按 completed 单计数', async () => {
    const { env, sqlite } = fixture();
    seed(sqlite);
    await openWindow(env, 1, 1, 1);
    const rows = sqlite.prepare('SELECT club_id, wage_total FROM club_wage_baselines ORDER BY club_id').all() as {
      club_id: number;
      wage_total: number;
    }[];
    expect(rows).toEqual([
      { club_id: 1, wage_total: 5.75 },
      { club_id: 2, wage_total: 4 },
    ]);

    // 本窗买进一人（+2 工资），卖出一人：换队类计入，rc_change/match 不计（D13）
    sqlite.exec(`
      INSERT INTO players (id, uid, name, club_id, position, ca, pa) VALUES (31, 'p31', '甲三', 1, 'CM', 75, 80);
      INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, is_active) VALUES (31, 1, 2, 10, 'formal', 1);
      INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, status, season, window_seq, completed_at)
        VALUES (901, 'transfer', 31, 2, 1, 'completed', 1, 1, '2026-11-03T00:00:00Z'),
               (902, 'rc_change', 11, 1, 1, 'completed', 1, 1, '2026-11-03T00:00:00Z'),
               (903, 'termination', 21, 2, NULL, 'completed', 1, 1, '2026-11-03T00:00:00Z');
    `);
    const w = await loadSquadWages(env.DB, 1, { cap: 68, pendingDelta: 0, season: 1, windowSeq: 1 });
    expect(w.baseline).toBe(5.75);
    expect(w.now).toBe(7.75);
    expect(w.delta).toBe(2);
    expect(w.inCount).toBe(1); // rc_change 不算转入
    expect(w.outCount).toBe(0); // rc_change 不算转出

    // 乙队：卖出一人（transfer）+ 被解约一人（termination）⇒ outCount = 2（D13）
    const other = await loadSquadWages(env.DB, 2, { cap: 68, pendingDelta: 0, season: 1, windowSeq: 1 });
    expect(other.outCount).toBe(2);
    expect(other.inCount).toBe(0);
  });
});
