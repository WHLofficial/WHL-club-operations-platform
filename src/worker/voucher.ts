// 消费券账本原语（v6.58.0，与 src/worker/ledger.ts 同构）：
// 券余额 = ledger_accounts.vouchers（俱乐部级），流水 = voucher_entries。
// 余额变更 = 账户 upsert（批首，幂等闸 + guardSql 都在这里对**批前状态**求值）+ 流水
// （以账户语句真的动了账 changes()>0 为闸，balance_after 读同批更新后的余额）。
// 两条语句必须进同一个 D1 batch 才是原子的。
//
// 与 ledger_entries 的边界：券是「只能抵扣、不可转账兑现」的第二资金，语义不进账本 kind 枚举；
// 对账不变量：ledger_accounts.vouchers == SUM(voucher_entries.amount)（逐俱乐部），
// 逐行 balance_after 可复算（tests/voucher.test.ts 兜住）。
export type VoucherKind =
  | 'migrate' // 存量建设券搬运（迁移 0083）
  | 'build_refund' // 建设支出返还
  | 'build_use' // 建设支出抵扣
  | 'shop_use' // 消费中心工单抵扣
  | 'shop_refund' // 工单被拒退回
  | 'admin_grant' // 管理组发放
  | 'event_grant'; // 随机事件效果发券（v6.58.0 起走券账，替代直改 stadiums.build_credit）

export interface VoucherMovementInput {
  clubId: number;
  /** 正=入账 负=出账（m） */
  delta: number;
  kind: VoucherKind;
  refType: string | null;
  refId: number | null;
  memo: string;
  /**
   * 幂等闸：默认按 (club_id, kind, ref_type, ref_id) 查重，已有流水则整段跳过。
   * 玩家主动可重复的操作（建设/管理组发放）传 false——同 (kind, ref) 本来就会重复发生，
   * 开闸会把第二次真实操作也吃掉。
   */
  idempotent?: boolean;
  /** 额外守卫 SQL（布尔表达式，追加在两条语句的 WHERE 后，参数跟在 params 之后） */
  guardSql?: string;
  guardParams?: unknown[];
}

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export function voucherMovement(db: D1Database, input: VoucherMovementInput): D1PreparedStatement[] {
  const guardParts = ['1=1'];
  const guardParams: unknown[] = [];
  if (input.idempotent !== false) {
    guardParts.push(
      'NOT EXISTS (SELECT 1 FROM voucher_entries WHERE kind = ? AND ref_type IS ? AND ref_id IS ? AND club_id = ?)',
    );
    guardParams.push(input.kind, input.refType, input.refId, input.clubId);
  }
  // 券余额永不为负：负 delta 自动带上批前余额闸（调用方另加的业务闸照旧）。
  // 放在调用方 guardSql 之前，参数顺序与下发顺序一致。
  if (input.delta < 0) {
    guardParts.push('COALESCE((SELECT vouchers FROM ledger_accounts WHERE club_id = ?), 0) + ? >= 0');
    guardParams.push(input.clubId, input.delta);
  }
  if (input.guardSql) {
    guardParts.push(`(${input.guardSql})`);
    guardParams.push(...(input.guardParams ?? []));
  }
  const where = guardParts.join(' AND ');

  return [
    // 1) 账户券余额 upsert（批首）：幂等闸 + 余额守卫都在这一条上对批前状态求值。
    //    守卫在语句里出现两次，占位符也按两次绑定（node:sqlite/D1 缺位绑定会静默落 NULL）。
    //    新账户行 balance 写 0：券不会凭空造现金，现金仍只由 ledgerMovement 改。
    db
      .prepare(
        `INSERT INTO ledger_accounts (club_id, balance, vouchers, updated_at)
         SELECT ?, 0, ROUND(?, 2), ${nowSql()} WHERE ${where}
         ON CONFLICT(club_id) DO UPDATE SET vouchers = ROUND(vouchers + excluded.vouchers, 2), updated_at = excluded.updated_at
         WHERE ${where}`,
      )
      .bind(input.clubId, input.delta, ...guardParams, ...guardParams),
    // 2) 流水：以「账户语句真的动了账（changes() > 0）」为闸——幂等重放 / 守卫没过时账户
    //    changes=0，流水整段不落，两段始终同生共死。balance_after 读同批更新后的券余额。
    //    金额与余额都在写侧 ROUND 到分：REAL 减法尾差（0.4-0.1=0.30000000000000004）不进账，
    //    下游按「余额 == 期望值」做的等值比较才有意义。
    db
      .prepare(
        `INSERT INTO voucher_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
         SELECT ?, ?, ROUND(?, 2), (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = ?), ?, ?, ?, ${nowSql()} WHERE changes() > 0`,
      )
      .bind(input.clubId, input.kind, input.delta, input.clubId, input.refType, input.refId, input.memo),
  ];
}

/** 券余额（无账户行 = 0）。 */
export async function voucherBalance(db: D1Database, clubId: number): Promise<number> {
  const row = await db
    .prepare('SELECT vouchers FROM ledger_accounts WHERE club_id = ?')
    .bind(clubId)
    .first<{ vouchers: number }>();
  return row?.vouchers ?? 0;
}
