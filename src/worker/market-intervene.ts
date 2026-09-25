// 管理介入扩权（v1.3.0，PRD 4.8「管理介入」）：管理组对市场单据的强制处置。
// 与审核队列同一套资金纪律：撤/作废一律解冻全部资金、球员按合同类型还原、动作+理由进审计。
// 每个函数幂等（状态迁移带守卫 WHERE），并发重复调用返回 already。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { loadTransfer, listingIdFromTransfer } from './transfers.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { settleListingForReview, type ListingCore } from './market-settle.ts';
import { forceSettleAtExpected } from './negotiations.ts';

async function loadListingCore(db: Env['DB'], listingId: number): Promise<ListingCore | null> {
  return db
    .prepare('SELECT id, player_id, seller_club_id, type, ask_price, season, window_seq FROM listings WHERE id = ?')
    .bind(listingId)
    .first<ListingCore>();
}

export async function requireReason(body: unknown): Promise<string> {
  const text = typeof (body as { reason?: unknown } | null)?.reason === 'string' ? ((body as { reason: string }).reason as string).trim() : '';
  if (text.length < 2) throw new HttpError(400, '请填写处置原因（至少 2 个字，会进审计）');
  return text;
}

function playerRestoreSql(db: Env['DB'], playerId: number) {
  // 球员还原按合同类型：激活挂牌还原回训练营，普通挂牌还原回一线队（与审核驳回同口径）
  return db
    .prepare(
      `UPDATE players SET status = CASE WHEN (
         SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1
       ) = 'trainee' THEN 'trainee' ELSE 'normal' END, updated_at = ${nowSql()}
       WHERE id = ? AND status = 'listed'`,
    )
    .bind(playerId, playerId);
}

function nowSql(): string {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

// 撤销活跃出价：解冻该买方对本挂牌的资金（同挂牌同队只持一份 hold）、出价置 withdrawn。
// 若撤的是当前最高价，后续成交以结算时点的活跃最高价为准；无更高价时走送审/作废。
export async function adminVoidBid(env: Env, bidId: number, actor: number, reason: string): Promise<'done' | 'already'> {
  const db = env.DB;
  const bid = await db
    .prepare('SELECT id, listing_id, club_id, amount, status FROM bids WHERE id = ?')
    .bind(bidId)
    .first<{ id: number; listing_id: number; club_id: number; amount: number; status: string }>();
  if (!bid) throw new HttpError(404, '出价不存在');
  if (bid.status !== 'active') throw new HttpError(409, '这笔出价已不是活跃状态，不能撤销');
  const listing = await db.prepare('SELECT status FROM listings WHERE id = ?').bind(bid.listing_id).first<{ status: string }>();
  if (!listing) throw new HttpError(404, '所属挂牌不存在');
  if (listing.status !== 'bidding') throw new HttpError(409, '挂牌已离开竞价阶段，处置请走审核队列');
  const audit = createAuditStatement(db);
  await db.batch([
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE id = ? AND status = 'active'`).bind(bidId),
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id = ? AND club_id = ? AND status = 'held'`)
      .bind(bid.listing_id, bid.club_id),
    // 撤空活跃出价时把挂牌送回 listed（否则静默到期结算时会卡成无单据的 pending_review）
    db
      .prepare(
        `UPDATE listings SET status = 'listed', last_bid_at = NULL WHERE id = ? AND status = 'bidding'
         AND NOT EXISTS (SELECT 1 FROM bids WHERE listing_id = ? AND status = 'active')`,
      )
      .bind(bid.listing_id, bid.listing_id),
    audit({
      actor,
      action: 'admin_bid_void',
      targetType: 'bid',
      targetId: bidId,
      after: { reason, listingId: bid.listing_id, clubId: bid.club_id, amount: bid.amount },
    }),
  ]);
  return 'done';
}

// 强制送审：卡在竞价/匹配窗的挂牌直接推进审核队列（管理组裁定「该卖就卖」）；单据与资金不动
export async function adminForceSettle(env: Env, listingId: number, actor: number, reason: string): Promise<'settled' | 'already'> {
  const listing = await loadListingCore(env.DB, listingId);
  if (!listing) throw new HttpError(404, '挂牌不存在');
  const status = await env.DB.prepare('SELECT status FROM listings WHERE id = ?').bind(listingId).first<{ status: string }>();
  if (!status) throw new HttpError(404, '挂牌不存在');
  if (status.status !== 'bidding' && status.status !== 'matched_pending') {
    throw new HttpError(409, `挂牌当前状态是 ${status.status}，不能强制送审（待审单据请直接在审核队列处理）`);
  }
  const result = await settleListingForReview(env.DB, listing, actor, status.status === 'matched_pending' ? 'matched_pending' : 'bidding');
  if (result === 'settled') {
    const audit = createAuditStatement(env.DB);
    await env.DB.batch([
      audit({ actor, action: 'admin_force_settle', targetType: 'listing', targetId: listingId, after: { reason } }),
    ]);
  }
  return result;
}

// 强制作废：listed（激活方未落价）/ matched_pending（卖家未匹配）→ 下架不收费、解冻全部出价资金、球员还原
export async function adminForceVoid(env: Env, listingId: number, actor: number, reason: string): Promise<'done' | 'already'> {
  const db = env.DB;
  const listing = await loadListingCore(db, listingId);
  if (!listing) throw new HttpError(404, '挂牌不存在');
  const status = await db.prepare('SELECT status FROM listings WHERE id = ?').bind(listingId).first<{ status: string }>();
  if (status?.status !== 'listed' && status?.status !== 'matched_pending') {
    throw new HttpError(409, `挂牌当前状态是 ${status?.status ?? '未知'}，不能作废（已送审的单据请走审核队列驳回）`);
  }
  const audit = createAuditStatement(db);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE listings SET status = 'delisted', deadline_note = ?, activation_deadline = NULL, match_deadline = NULL
         WHERE id = ? AND status IN ('listed', 'matched_pending')`,
      )
      .bind(`管理组作废：${reason}`, listingId),
    db.prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'`).bind(listingId),
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`).bind(listingId),
    playerRestoreSql(db, listing.player_id),
    audit({ actor, action: 'admin_force_void', targetType: 'listing', targetId: listingId, after: { reason, playerId: listing.player_id } }),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0 ? 'done' : 'already';
}

// 签约谈判强制成交：按预期工资 E 直接成约（窗口强结的单点版本）
export async function adminForceSign(env: Env, sessionId: number, actor: number, reason: string): Promise<'done' | 'already'> {
  const db = env.DB;
  const session = await db
    .prepare('SELECT id, transfer_id, status, expected_wage FROM negotiation_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ id: number; transfer_id: number; status: string; expected_wage: number | null }>();
  if (!session) throw new HttpError(404, '谈判会话不存在');
  if (session.status !== 'active') throw new HttpError(409, '这条谈判已经结束');
  if (session.expected_wage === null) throw new HttpError(409, '买方还没提交新违约金，没有预期工资可按——等提交后再强制，或改用作废');
  const ok = await forceSettleAtExpected(env, sessionId, actor);
  if (ok) {
    const audit = createAuditStatement(db);
    await db.batch([
      audit({ actor, action: 'admin_force_sign', targetType: 'negotiation', targetId: sessionId, after: { reason, transferId: session.transfer_id, wage: session.expected_wage } }),
    ]);
  }
  return ok ? 'done' : 'already';
}

// 作废签约谈判（交易破裂处置）：会话关闭、转会单驳回、资金解冻、球员还原、挂牌下架
export async function adminCancelSigning(env: Env, sessionId: number, actor: number, reason: string): Promise<'done' | 'already'> {
  const db = env.DB;
  const session = await db
    .prepare('SELECT id, transfer_id, status FROM negotiation_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ id: number; transfer_id: number; status: string }>();
  if (!session) throw new HttpError(404, '谈判会话不存在');
  if (session.status !== 'active') throw new HttpError(409, '这条谈判已经结束');
  const transfer = await loadTransfer(db, session.transfer_id);
  if (!transfer || transfer.status !== 'signing') throw new HttpError(409, '转会单不在签约阶段，不能作废谈判');
  const listingId = listingIdFromTransfer(transfer);
  const audit = createAuditStatement(db);
  await db.batch([
    db.prepare(`UPDATE negotiation_sessions SET status = 'cancelled', settled_at = ${nowSql()} WHERE id = ? AND status = 'active'`).bind(sessionId),
    db.prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id IS ? AND status = 'held'`).bind(listingId),
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`).bind(listingId),
    db.prepare(`UPDATE listings SET status = 'delisted', deadline_note = ? WHERE id = ? AND status = 'pending_review'`).bind(`管理组作废：${reason}`, listingId),
    playerRestoreSql(db, transfer.player_id),
    db.prepare(`UPDATE transfers SET status = 'rejected' WHERE id = ? AND status = 'signing'`).bind(transfer.id),
    audit({
      actor,
      action: 'admin_negotiation_void',
      targetType: 'negotiation',
      targetId: sessionId,
      after: { reason, transferId: transfer.id, playerId: transfer.player_id },
    }),
  ]);
  return 'done';
}
