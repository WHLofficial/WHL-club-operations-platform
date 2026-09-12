// 赛季解析（§11：preparing → running → settled）。赛季管理端点属增量 6，
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
