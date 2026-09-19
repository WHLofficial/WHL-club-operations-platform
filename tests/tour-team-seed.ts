// 增量 17 建队改口径后，凡是走 POST /api/admin/clubs 的测试 fixture 都要给 TOUR_DB 备好 team 目录
// （建队会校验 tour team 存在并以 gameTeamId 指定 clubs.id）。9001-9100 号段避开 fixture 里直接插的小 id。
export const TOUR_TEAM_SEED_SQL = `
CREATE TABLE IF NOT EXISTS team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
INSERT INTO team (id, org_id, name) VALUES
  ${Array.from({ length: 100 }, (_, i) => `(${9001 + i}, 1, '测试队${9001 + i}')`).join(',\n  ')};
`.trim();
