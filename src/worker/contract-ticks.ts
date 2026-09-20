// 转会窗刻度助手（增量 25）：效力与保护期以「已关常规窗数」为刻度。
// 刻度口径（规则 4.2.3 以半赛季为周期、4.3.1 保护期前 1.5 赛季、4.4.4 效力满 3 年）：
//   1 个常规窗关窗 = 0.5 赛季；常规窗 = season_windows.is_temporary = 0；
//   季初/中期按同赛季非临时窗顺序派生（第 1 个 = 季初、第 2 个 = 中期），不入库。
// 效力（赛季）= 0.5 × (closedRegularTicks − contracts.service_ticks)；临时窗关窗不推进。

export interface WindowRef {
  season: number;
  windowSeq: number;
  isTemporary: number;
}

/** 当前开放的窗（含临时窗标记）；窗外返回 null */
export async function currentWindow(db: D1Database): Promise<WindowRef | null> {
  const row = await db
    .prepare(
      `SELECT season, window_seq, is_temporary FROM season_windows WHERE status = 'open'
       ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<{ season: number; window_seq: number; is_temporary: number | null }>();
  return row ? { season: row.season, windowSeq: row.window_seq, isTemporary: row.is_temporary ?? 0 } : null;
}

/**
 * 截至指定时点（缺省 = 当下）已关的常规窗数——效力推进计数。
 * atIso 用字符串比较：closed_at 与运行期 signed_at 都是 ISO 时间戳（同格式可比）；
 * 导入的历史合同传的是日期串 YYYY-MM-DD，此时与 signed 同日关的窗不计（效力算得更年轻，
 * 即解约费偏保守、保护期偏长）。
 */
export async function closedRegularTicks(db: D1Database, atIso?: string | null): Promise<number> {
  if (atIso) {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM season_windows
         WHERE status = 'closed' AND is_temporary = 0 AND closed_at IS NOT NULL AND closed_at <= ?`,
      )
      .bind(atIso)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM season_windows WHERE status = 'closed' AND is_temporary = 0`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 签约基数：签约时点已关的常规窗数（运行期签约与导入的历史合同共用这一条公式） */
export async function windowBaseTicks(db: D1Database, signedAt: string | null): Promise<number> {
  if (!signedAt) return closedRegularTicks(db);
  return closedRegularTicks(db, signedAt);
}

/**
 * 同赛季第几个非临时窗（1 = 季初、2 = 中期）= window_seq ≤ 本窗的非临时窗数。
 * 调用方只在常规窗上用它判定（关窗时才发忠诚奖金）；对临时窗调用得到的是它之前已开的常规窗数，不是 0。
 */
export async function regularWindowOrdinal(db: D1Database, season: number, windowSeq: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM season_windows
       WHERE season = ? AND is_temporary = 0 AND window_seq <= ?`,
    )
    .bind(season, windowSeq)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
