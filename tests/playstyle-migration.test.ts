// 迁移 0086 行为验证（v6.63.0）：台账 backfill 在真 SQLite 引擎上的语义（含可逆抑制的 SQL 侧）、
// 幂等重跑、247 清洗与退役对象。表达式与 core 的逐字同源锁在 tests/playstyles.test.ts。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyMigrations, sqlGet } from './d1.ts';

const migrationSql = readFileSync(
  fileURLToPath(new URL('../src/db/migrations/0086_playstyle_full_count.sql', import.meta.url).href),
  'utf8',
);

describe('0086_playstyle_full_count 行为', () => {
  it('backfill：台账 = FC 槽数（减被发放金抑制的银槽）+ 发放明细行数；247 清洗生效', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0085_contracts_free_rc_change.sql');
    sqlite.exec(`
      INSERT INTO players (id, uid, name, fc_id, ca, game_attrs, badges_silver, badges_gold) VALUES
        (1, 'p1', '抑制甲', 1, 80,
         '{"PosID1":25,"PSID1":1,"PSID2":31,"PSID13":105}', 12, 3),
        (247, 'p247', '违规乙', 247, 80, '{"PosID1":25,"PSID13":124}', 0, 0);
      INSERT INTO player_playstyles (player_id, slot, kind, psid, source, created_at) VALUES
        -- 球员 1：发放金 1/31（顶掉 FC 银 1/31 的抑制源；金落 14/15，13 被 FC 金 105 占）
        -- + 发放银 7（落银槽 3）
        (1, 14, 'gold', 1, 'growth', '2026-01-01T00:00:00Z'),
        (1, 15, 'gold', 31, 'growth', '2026-01-01T00:00:00Z'),
        (1, 3, 'silver', 7, 'shop', '2026-01-01T00:00:00Z'),
        -- 球员 247 的违规对：银 24（删）+ 金 24（保；金落 14，13 被 FC 金 124 占）
        (247, 5, 'silver', 24, 'growth', '2026-01-01T00:00:00Z'),
        (247, 14, 'gold', 24, 'growth', '2026-01-02T00:00:00Z');
    `);

    sqlite.exec(migrationSql);

    // 球员 1：银 = FC 1/2（两枚都被抑制）+ 明细 1 = 1；金 = FC 105 一枚 + 明细 2 = 3（槽位物理上限内）
    expect(sqlGet<{ s: number; g: number }>(sqlite, 'SELECT badges_silver AS s, badges_gold AS g FROM players WHERE id = 1')).toEqual({ s: 1, g: 3 });
    // 球员 247：发放银 24 已删 → 银 0；金 = FC 金槽 124 + 发放金 24 = 2（删银保金）
    expect(sqlGet<{ s: number; g: number }>(sqlite, 'SELECT badges_silver AS s, badges_gold AS g FROM players WHERE id = 247')).toEqual({ s: 0, g: 2 });
    expect(sqlGet<{ n: number }>(sqlite, "SELECT COUNT(*) AS n FROM player_playstyles WHERE player_id = 247 AND kind = 'silver'")?.n).toBe(0);
  });

  it('幂等重跑：再执行一遍 UPDATE/DELETE 结果不变；DROP INDEX 与 config 清键只此一次', () => {
    const sqlite = new DatabaseSync(':memory:');
    applyMigrations(sqlite, '0085_contracts_free_rc_change.sql');
    sqlite.exec(`
      INSERT INTO players (id, uid, name, fc_id, ca, game_attrs, badges_silver, badges_gold) VALUES
        (1, 'p1', '甲', 1, 80, '{"PSID1":3,"PSID13":105}', 12, 3);
      INSERT INTO player_playstyles (player_id, slot, kind, psid, source, created_at) VALUES
        (1, 2, 'silver', 7, 'growth', '2026-01-01T00:00:00Z');
    `);

    sqlite.exec(migrationSql);
    const first = sqlGet<{ s: number; g: number }>(sqlite, 'SELECT badges_silver AS s, badges_gold AS g FROM players WHERE id = 1');
    expect(first).toEqual({ s: 2, g: 1 }); // FC 银 3 + 明细银 7；FC 金 105

    sqlite.exec(migrationSql); // 整个文件重放
    expect(sqlGet<{ s: number; g: number }>(sqlite, 'SELECT badges_silver AS s, badges_gold AS g FROM players WHERE id = 1')).toEqual(first);

    expect(sqlGet<{ n: number }>(sqlite, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_players_sort_ps'")?.n).toBe(0);
    expect(sqlGet<{ n: number }>(sqlite, "SELECT COUNT(*) AS n FROM config WHERE key IN ('badge_cap_silver','badge_cap_gold')")?.n).toBe(0);
  });
});
