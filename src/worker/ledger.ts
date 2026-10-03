// 账本原语（TECH_DESIGN §7.4，仿 revenue 插件 claim_* 模式）：
// 余额变更 = 账户 upsert（批首，幂等闸 + guardSql 对批前状态求值）+ 流水（以账户 changes()>0 为闸，
// balance_after 读同批更新后的余额）。两条语句必须进同一个 D1 batch 才是原子的。
// 流水自带幂等闸：同一 (club, kind, ref) 只记一次，并发重放时账户的 NOT EXISTS 闸不通过、
// changes()=0，流水整段不落（完成过户/下架费等自动路径靠它防重复记账）。
export interface MovementInput {
  clubId: number;
  /** 正=入账 负=出账（m） */
  delta: number;
  kind: string;
  refType: string | null;
  refId: number | null;
  memo: string;
  /**
   * 幂等闸：默认按 (club_id, kind, ref_type, ref_id) 查重，已有流水则整段跳过。
   * 人工记账等允许重复的类型传 false。闸必须带 club 维度：窗末结算多队共用
   * 同一 (kind, 'window', refId)，全局查重会把第 2 队起的流水全部闸掉。
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
    guardParts.push('NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = ? AND ref_type IS ? AND ref_id IS ? AND club_id = ?)');
    guardParams.push(input.kind, input.refType, input.refId, input.clubId);
  }
  if (input.guardSql) {
    guardParts.push(`(${input.guardSql})`);
    guardParams.push(...(input.guardParams ?? []));
  }
  const where = guardParts.join(' AND ');

  return [
    // 1) 账户差额 upsert（批首）：幂等闸 + guardSql 都在这里对**批前状态**求值——余额类守卫
    //    （如消费扣费）必须在这一条上判断，否则流水语句会读到本批扣完的余额（v6.26.0 教训）。
    //    守卫在语句里出现两次，占位符也按两次绑定（node:sqlite/D1 缺位绑定会静默落 NULL）。
    db
      .prepare(
        `INSERT INTO ledger_accounts (club_id, balance, updated_at)
         SELECT ?, ?, ${nowSql()} WHERE ${where}
         ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
         WHERE ${where}`,
      )
      .bind(input.clubId, input.delta, ...guardParams, ...guardParams),
    // 2) 流水：以「账户语句真的动了账（changes() > 0）」为闸——幂等重放 / 守卫没过时账户
    //    changes=0，流水整段不落，两段始终同生共死。balance_after 读同批更新后的余额（§7.4 防错账）。
    db
      .prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
         SELECT ?, ?, ?, (SELECT balance FROM ledger_accounts WHERE club_id = ?), ?, ?, ?, ${nowSql()} WHERE changes() > 0`,
      )
      .bind(input.clubId, input.kind, input.delta, input.clubId, input.refType, input.refId, input.memo),
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
