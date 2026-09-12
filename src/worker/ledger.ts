// 账本原语（TECH_DESIGN §7.4，仿 revenue 插件 claim_* 模式）：
// 余额变更 = 账户 upsert（按差额）+ 流水（balance_after 在同一 batch 内读更新后余额），
// 两条语句必须进同一个 D1 batch 才是原子的。流水自带幂等闸：同一 (kind, ref) 只记一次，
// 并发重放时第二条的 NOT EXISTS 闸不通过，整段不落账（完成过户/下架费等自动路径靠它防重复记账）。
export interface MovementInput {
  clubId: number;
  /** 正=入账 负=出账（m） */
  delta: number;
  kind: string;
  refType: string | null;
  refId: number | null;
  memo: string;
  /**
   * 幂等闸：默认按 (kind, ref_type, ref_id) 查重，已有流水则整段跳过。
   * 人工记账等允许重复的类型传 false。
   */
  idempotent?: boolean;
  /** 额外守卫 SQL（布尔表达式，追加在两条语句的 WHERE 后，参数跟在 params 之后） */
  guardSql?: string;
  guardParams?: unknown[];
}

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export function ledgerMovement(db: D1Database, input: MovementInput): D1PreparedStatement[] {
  const guardParts = ['1=1'];
  const guardParams: unknown[] = [];
  if (input.idempotent !== false) {
    guardParts.push('NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = ? AND ref_type IS ? AND ref_id IS ?)');
    guardParams.push(input.kind, input.refType, input.refId);
  }
  if (input.guardSql) {
    guardParts.push(`(${input.guardSql})`);
    guardParams.push(...(input.guardParams ?? []));
  }
  const where = guardParts.join(' AND ');

  return [
    // 1) 账户差额 upsert：INSERT 分支与 UPDATE 分支都挂幂等闸，重放时整段不动。
    //    守卫在语句里出现两次，占位符也按两次绑定（node:sqlite/D1 缺位绑定会静默落 NULL）。
    db
      .prepare(
        `INSERT INTO ledger_accounts (club_id, balance, updated_at)
         SELECT ?, ?, ${nowSql()} WHERE ${where}
         ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
         WHERE ${where}`,
      )
      .bind(input.clubId, input.delta, ...guardParams, ...guardParams),
    // 2) 流水：balance_after 读同事务内更新后的余额，防错账（§7.4）
    db
      .prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
         SELECT ?, ?, ?, (SELECT balance FROM ledger_accounts WHERE club_id = ?), ?, ?, ?, ${nowSql()}
         WHERE ${where}`,
      )
      .bind(input.clubId, input.kind, input.delta, input.clubId, input.refType, input.refId, input.memo, ...guardParams),
  ];
}

// 可用余额 = 余额 − 全部现行冻结（出价校验口径；触发器 0005 在事务内兜底同一公式）
export async function availableBalance(db: D1Database, clubId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = ?)
              - (SELECT COALESCE(SUM(amount), 0) FROM fund_holds WHERE club_id = ? AND status = 'held') AS available`,
    )
    .bind(clubId, clubId)
    .first<{ available: number }>();
  return row?.available ?? 0;
}
