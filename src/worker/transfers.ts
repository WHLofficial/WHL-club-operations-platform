// 转会单据执行（TECH_DESIGN §6.4 不变式 2）：过户单点执行——只有 completed 的 transfer 单
// 触发过户（球员归属、合同、账本三方变更），幂等键 = transfer_id，失败可安全重试。
// 增量 3 桥接：审核批准 → 直接 completeTransfer（划款+税+过户）；增量 4 起批准改为开启
// 签约谈判会话，completed 改由谈判成约时到达（成约即过户），本文件函数保持不变。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { transferTax } from '../core/tax.ts';
import { ledgerMovement } from './ledger.ts';
import { loadMarketContext } from './market-context.ts';
import { createAuditStatement } from '../lib/audit.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface ReviewDecision {
  taskId: number;
  decidedBy: number;
  decision: 'approved' | 'rejected';
  note?: string;
}

export interface TransferRow {
  id: number;
  type: string;
  player_id: number;
  from_club_id: number | null;
  to_club_id: number | null;
  fee: number | null;
  status: string;
  idempotency_key: string | null;
}

export async function loadTransfer(db: D1Database, transferId: number): Promise<TransferRow | null> {
  return db
    .prepare('SELECT id, type, player_id, from_club_id, to_club_id, fee, status, idempotency_key FROM transfers WHERE id = ?')
    .bind(transferId)
    .first<TransferRow>();
}

// listing:{id} 形态的幂等键反查挂牌（审核类 transfer 在截止结算时创建）
export function listingIdFromTransfer(transfer: TransferRow): number | null {
  const m = /^listing:(\d+)$/.exec(transfer.idempotency_key ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * 过户单点：划款（买方付款、卖方收入 + 税销毁）、成交冻结结算、球员与合同过户、
 * transfer → completed、审核表记、审计，全部在一个 batch 里。每条语句挂
 * 「transfer 仍处 pending_review」守卫，流水另有 (kind, ref=transferId) 幂等闸，
 * 重复调用整批空转（幂等，可安全重试）。
 */
export async function completeTransfer(
  env: Env,
  transferId: number,
  actor: number | null,
  review?: ReviewDecision,
): Promise<{ status: 'completed' | 'already' }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'completed') return { status: 'already' };
  if (transfer.status !== 'pending_review') throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能过户`);
  if (transfer.to_club_id === null || transfer.fee === null) throw new HttpError(409, '转会单缺买方或成交价，数据不完整');
  const listingId = listingIdFromTransfer(transfer);

  const ctx = await loadMarketContext(db);
  const contract = await db
    .prepare('SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(transfer.player_id)
    .first<{ release_fee: number | null }>();
  const rc = contract?.release_fee ?? 0;
  const tax = transferTax(transfer.fee, rc, ctx.taxRates);

  const guard = { sql: `(SELECT status FROM transfers WHERE id = ?) = 'pending_review'`, params: [transferId] };
  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  let statusStmtIndex = -1;
  if (listingId !== null) {
    // 成交出价 → won；其冻结 → settled（落选冻结早已在抬价时释放）
    statements.push(
      db
        .prepare(
          `UPDATE fund_holds SET status = 'settled'
           WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'
             AND id IN (SELECT hold_id FROM bids WHERE listing_id = ? AND status = 'active')`,
        )
        .bind(listingId, listingId),
      db
        .prepare(`UPDATE bids SET status = 'won' WHERE listing_id = ? AND status = 'active'`)
        .bind(listingId),
    );
  }
  statements.push(
    ...ledgerMovement(db, {
      clubId: transfer.to_club_id,
      delta: -transfer.fee,
      kind: 'transfer_in',
      refType: 'transfer',
      refId: transferId,
      memo: '转会买人付款',
      guardSql: guard.sql,
      guardParams: guard.params,
    }),
  );
  if (transfer.from_club_id !== null) {
    statements.push(
      ...ledgerMovement(db, {
        clubId: transfer.from_club_id,
        delta: transfer.fee,
        kind: 'transfer_out',
        refType: 'transfer',
        refId: transferId,
        memo: '转会卖人收入',
        guardSql: guard.sql,
        guardParams: guard.params,
      }),
      ...(tax > 0
        ? ledgerMovement(db, {
            clubId: transfer.from_club_id,
            delta: -tax,
            kind: 'transfer_tax',
            refType: 'transfer',
            refId: transferId,
            memo: '交易税（销毁）',
            guardSql: guard.sql,
            guardParams: guard.params,
          })
        : []),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE players SET club_id = ?, status = 'normal', updated_at = ${nowSql()}
         WHERE id = ? AND (club_id IS ? OR club_id = ?)`,
      )
      .bind(transfer.to_club_id, transfer.player_id, transfer.from_club_id, transfer.from_club_id),
    db
      .prepare(`UPDATE contracts SET club_id = ? WHERE player_id = ? AND is_active = 1 AND club_id IS ?`)
      .bind(transfer.to_club_id, transfer.player_id, transfer.from_club_id),
  );
  statusStmtIndex = statements.length;
  statements.push(
    db
      .prepare(`UPDATE transfers SET status = 'completed', tax = ?, completed_at = ${nowSql()} WHERE id = ? AND status = 'pending_review'`)
      .bind(tax, transferId),
  );
  if (review) {
    statements.push(
      db
        .prepare(
          `UPDATE review_tasks SET status = ?, decided_by = ?, decided_at = ${nowSql()}, note = ? WHERE id = ? AND status = 'open'`,
        )
        .bind(review.decision, review.decidedBy, review.note ?? null, review.taskId),
    );
  }
  statements.push(
    audit({
      actor,
      action: 'transfer_complete',
      targetType: 'transfer',
      targetId: transferId,
      after: { fee: transfer.fee, tax, playerId: transfer.player_id, fromClubId: transfer.from_club_id, toClubId: transfer.to_club_id },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
  return { status: statusChange > 0 ? 'completed' : 'already' };
}

/**
 * 审核驳回：解冻全部冻结、撤销成交出价、listing → delisted（不收下架费）、transfer → rejected。
 * 同样整 batch 守卫 pending_review，幂等。
 */
export async function rejectTransfer(
  env: Env,
  transferId: number,
  actor: number | null,
  review: ReviewDecision,
): Promise<{ status: 'rejected' | 'already' }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'rejected') return { status: 'already' };
  if (transfer.status !== 'pending_review') throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能驳回`);
  const listingId = listingIdFromTransfer(transfer);

  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id IS ? AND status = 'held'`)
      .bind(listingId),
    db
      .prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`)
      .bind(listingId),
    db
      .prepare(`UPDATE listings SET status = 'delisted', deadline_note = '审核驳回' WHERE id = ? AND status = 'pending_review'`)
      .bind(listingId),
    db
      .prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'listed'`)
      .bind(transfer.player_id),
  ];
  const statusStmtIndex = statements.length;
  statements.push(
    db.prepare(`UPDATE transfers SET status = 'rejected' WHERE id = ? AND status = 'pending_review'`).bind(transferId),
    db
      .prepare(
        `UPDATE review_tasks SET status = ?, decided_by = ?, decided_at = ${nowSql()}, note = ? WHERE id = ? AND status = 'open'`,
      )
      .bind(review.decision, review.decidedBy, review.note ?? null, review.taskId),
    audit({
      actor,
      action: 'transfer_reject',
      targetType: 'transfer',
      targetId: transferId,
      after: { note: review.note ?? null, playerId: transfer.player_id },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
  return { status: statusChange > 0 ? 'rejected' : 'already' };
}
