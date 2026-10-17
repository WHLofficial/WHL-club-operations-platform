// v6.51.10：growth_events 的 match_ref 索引（迁移 0076）。
// 钉住两件事，都是「不写测试就会悄悄回退」的：
//   1) 索引在，且列序是 (match_ref, player_id)；
//   2) 三条真实查询的执行计划真走它，且面板那条带 ORDER BY 的查询不落 TEMP B-TREE。
// 第二列 player_id 就是为第 2 条加的：非唯一索引的末键是 rowid ⇒ match_ref 等值段内天然按
// (player_id, id) 有序，面板的 ORDER BY player_id, id 白拿（只建 (match_ref) 时每次都要排一次）。
// 只断言「索引存在」会漏掉「建了但计划不走」，所以这里看计划不看结果（照 players-sort-indexes.test.ts 先例）。
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb, sqlAll, sqlGet } from './d1.ts';

// 三条查询与 src/worker/routes/admin/growth.ts 同形：
// 列表的 recorded 计数子查询（:368）/ 面板已录事件（:402）/ 保存前查已录（:694）
const LIST_COUNT = "SELECT COUNT(*) FROM growth_events ge WHERE ge.match_ref = CAST(12 AS TEXT)";
const PANEL_ROWS =
  'SELECT player_id, event_type, value, xp, source FROM growth_events WHERE match_ref = ? ORDER BY player_id, id';
const SAVE_CHECK = 'SELECT id, player_id, event_type, value, xp, source FROM growth_events WHERE match_ref = ?';
// 反向护栏：球员维度的读取（src/worker/player-matches.ts:62）要继续吃 UNIQUE 的隐式索引，
// 新索引不能把它抢走（那条查询没有 match_ref 等值，抢走就是整表扫）
const PLAYER_ROWS = 'SELECT match_ref, event_type, value FROM growth_events WHERE player_id = ? AND match_ref IS NOT NULL';

function planOf(sqlite: DatabaseSync, sql: string): string {
  return (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
}

/** 造点数据再问计划：空表上的计划器判断不足，索引可能被当成无用（照 players-sort-indexes 先例） */
function seeded(): DatabaseSync {
  const { sqlite } = createTestDb();
  const ins = sqlite.prepare(
    'INSERT INTO growth_events (player_id, match_ref, event_type, value, xp, source) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (let match = 1; match <= 3; match += 1) {
    for (let player = 1; player <= 40; player += 1) ins.run(player, String(match), 'rating', 7, 2, 'manual');
  }
  return sqlite;
}

describe('TC-IDX 迁移 0076：growth_events(match_ref, player_id)（v6.51.10）', () => {
  it('TC-IDX-01 索引就位且列序正确', () => {
    const { sqlite } = createTestDb();
    const row = sqlGet<{ sql: string }>(
      sqlite,
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_growth_events_match_ref'",
    );
    expect(row?.sql).toContain('growth_events');
    expect(row?.sql).toContain('(match_ref, player_id)');
  });

  it('TC-IDX-02 列表计数按 match_ref seek 且覆盖（不读表）', () => {
    const plan = planOf(seeded(), LIST_COUNT);
    expect(plan).toContain('USING COVERING INDEX idx_growth_events_match_ref');
    expect(plan).not.toContain('SCAN growth_events');
  });

  it('TC-IDX-03 面板已录事件走索引且 ORDER BY 不落临时排序', () => {
    const plan = planOf(seeded(), PANEL_ROWS);
    expect(plan).toContain('USING INDEX idx_growth_events_match_ref');
    expect(plan).not.toContain('TEMP B-TREE');
  });

  it('TC-IDX-04 保存前查已录走索引', () => {
    const plan = planOf(seeded(), SAVE_CHECK);
    expect(plan).toContain('USING INDEX idx_growth_events_match_ref');
  });

  it('TC-IDX-05 球员维度读取仍吃 UNIQUE 的隐式索引（新索引不抢道）', () => {
    const { sqlite } = createTestDb();
    const auto = sqlAll<{ name: string }>(
      sqlite,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'sqlite_autoindex_growth_events_1'",
    );
    expect(auto).toHaveLength(1);
    expect(planOf(seeded(), PLAYER_ROWS)).toContain('sqlite_autoindex_growth_events_1');
  });
});
