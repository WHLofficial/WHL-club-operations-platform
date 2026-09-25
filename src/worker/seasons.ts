// 赛季解析（§11：preparing → running → settled）。赛季管理端点属v0.7.0，
// 注册增量只读 seasons 表：提交锁备赛期，查看放行备赛期/进行中。

// 可提交注册的赛季：备赛期（preparing）
export async function getRegistrableSeason(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT season FROM seasons WHERE status = 'preparing' ORDER BY season DESC LIMIT 1")
    .first<{ season: number }>();
  return row?.season ?? null;
}

// 页面展示用赛季：进行中优先，否则备赛期
export async function getVisibleSeason(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT season FROM seasons WHERE status IN ('preparing', 'running')
       ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, season DESC LIMIT 1`,
    )
    .first<{ season: number }>();
  return row?.season ?? null;
}

export interface OpenWindow {
  season: number;
  windowSeq: number;
}

// 当前开放的转会窗口（§6.4-3 窗口校验在入口：窗外只读）
export async function getOpenWindow(db: D1Database): Promise<OpenWindow | null> {
  const row = await db
    .prepare(
      `SELECT season, window_seq FROM season_windows WHERE status = 'open'
       ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<{ season: number; window_seq: number }>();
  return row ? { season: row.season, windowSeq: row.window_seq } : null;
}

// 指定窗口是否开放（出价按挂牌所属窗口校验，避免跨窗操作）
export async function isWindowOpen(db: D1Database, season: number | null, windowSeq: number | null): Promise<boolean> {
  if (season === null || windowSeq === null) return false;
  const row = await db
    .prepare(`SELECT status FROM season_windows WHERE season = ? AND window_seq = ?`)
    .bind(season, windowSeq)
    .first<{ status: string }>();
  return row?.status === 'open';
}
