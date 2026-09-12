// 旁路操作服务（TECH_DESIGN §6.3，规则 4.4.3/4.4.4/4.4.6）：不走竞价的直接单据入口。
// 提交（教练）→ transfer 单 pending_review + 审核任务；审核通过 → approveTransferDeal 分流：
// 解约直接过户；续约/匹配/海捞先收附加费（幂等闸 + 守卫，重试不重复扣）再自动开签约谈判。
// 窗内回滚（4.4.10）：续约完成后同窗被挂牌/激活/解约 → 违约金更改无效回滚（RC 与保护期还原、费用退还）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { releaseFeeBounds } from '../core/negotiation-rules.ts';
import { rcChangeFee, terminationFee, freeAgentFee, matchDiff, FORCED_AUCTION_PRICE } from '../core/bypass-rules.ts';
import { round2, shanghaiDateStr } from '../core/market-rules.ts';
import { availableBalance, ledgerMovement } from './ledger.ts';
import { getOpenWindow } from './seasons.ts';
import { createAuditStatement } from '../lib/audit.ts';
import {
  completeTermination,
  loadTransfer,
  transferEvidence,
  type ReviewDecision,
} from './transfers.ts';
import { openNegotiationSession } from './negotiations.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface RcChangeEvidence {
  oldReleaseFee: number;
  oldProtectedUntil: string | null;
}

interface OwnPlayerRow {
  id: number;
  name: string;
  club_id: number | null;
  status: string;
}

// 球员已在市场/审核流程里的一票否决（4.4.10「正在被挂牌、解约的球员不可更改违约金」同源）
async function ensureNotInFlight(db: D1Database, playerId: number): Promise<void> {
  const listing = await db
    .prepare(
      `SELECT id FROM listings WHERE player_id = ? AND status IN ('listed', 'bidding', 'matched_pending', 'pending_review') LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
  if (listing) throw new HttpError(400, '这名球员已经有一单在市场流程里了，等它结束再操作');
  const pending = await db
    .prepare(`SELECT id FROM transfers WHERE player_id = ? AND status = 'pending_review' LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (pending) throw new HttpError(400, '这名球员有一张单据正在等管理组审核，先等审核结果');
}

// 旁路附加费扣收：流水幂等闸（kind+ref 只记一次）+ 单据守卫 + 批内可用余额守卫
//（预检与扣费之间的并发动用由批内守卫兜底），审核重试不会重复扣费
async function chargeBypassFee(
  env: Env,
  transferId: number,
  clubId: number,
  amount: number,
  kind: string,
  memo: string,
): Promise<void> {
  const db = env.DB;
  const available = await availableBalance(db, clubId);
  if (round2(available) < amount) {
    throw new HttpError(409, `俱乐部可用资金不足：这笔费用要 ${round2(amount)} m，当前可支配 ${round2(available)} m`);
  }
  const results = await db.batch([
    ...ledgerMovement(db, {
      clubId,
      delta: -amount,
      kind,
      refType: 'transfer',
      refId: transferId,
      memo,
      guardSql:
        `(SELECT status FROM transfers WHERE id = ?) = 'pending_review'` +
        ` AND COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0)` +
        ` - COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0) >= ?`,
      guardParams: [transferId, clubId, clubId, amount],
    }),
    db
      .prepare(`UPDATE transfers SET extra_fee = ? WHERE id = ? AND status = 'pending_review' AND extra_fee IS NULL`)
      .bind(amount, transferId),
  ]);
  // 流水没落：要么这笔已收过（幂等重试，静默返回），要么批内余额/状态守卫没过（资金刚被并发动用）
  if ((results[1]?.meta.changes ?? 0) === 0) {
    const already = await db
      .prepare(`SELECT id FROM ledger_entries WHERE kind = ? AND ref_type IS 'transfer' AND ref_id IS ?`)
      .bind(kind, transferId)
      .first<{ id: number }>();
    if (!already) throw new HttpError(409, '资金刚被其他操作占用，费用没收上，稍后重试审核');
  }
}

// 旁路单建单批：transfer + 审核任务一个 batch（审核任务 ref_id 用 last_insert_rowid()
// 指回同批前一句刚插入的 transfer）；回链与审计在拿到 transferId 后补一个小批。
async function createBypassTransfer(
  env: Env,
  opts: {
    actor: number;
    type: string;
    playerId: number;
    fromClubId: number | null;
    toClubId: number | null;
    fee: number;
    extraFee: number | null;
    season: number;
    windowSeq: number;
    evidence: Record<string, unknown>;
    payload: Record<string, unknown>;
    action: string;
  },
): Promise<{ transferId: number }> {
  const db = env.DB;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, extra_fee, status, season, window_seq, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ${nowSql()})`,
      )
      .bind(
        opts.type,
        opts.playerId,
        opts.fromClubId,
        opts.toClubId,
        opts.fee,
        opts.extraFee,
        opts.season,
        opts.windowSeq,
        JSON.stringify(opts.evidence),
      ),
    db
      .prepare(
        `INSERT INTO review_tasks (type, ref_id, payload, status)
         SELECT 'transfer_confirm', last_insert_rowid(), ?, 'open'`,
      )
      .bind(JSON.stringify(opts.payload)),
  ]);
  const transferId = Number(results[0].meta.last_row_id);
  const audit = createAuditStatement(db);
  await db.batch([
    db
      .prepare(
        `UPDATE transfers SET review_task_id = (SELECT MAX(id) FROM review_tasks WHERE ref_id = ? AND type = 'transfer_confirm')
         WHERE id = ?`,
      )
      .bind(transferId, transferId),
    audit({
      actor: opts.actor,
      action: opts.action,
      targetType: 'transfer',
      targetId: transferId,
      after: { ...opts.payload },
    }),
  ]);
  return { transferId };
}

// ---- 续约（规则 4.4.6 合同期内更改违约金；平台展示名「续约」） ----

export interface RcChangeResult {
  ok: true;
  transferId: number;
  oldReleaseFee: number;
  newReleaseFee: number;
  changeFee: number;
}

export async function createRcChange(
  env: Env,
  clubId: number,
  actor: number,
  playerIdInput: unknown,
  newFeeInput: unknown,
): Promise<RcChangeResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  const newFee = Number(newFeeInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isInteger(newFee) || newFee <= 0) throw new HttpError(400, '新违约金须为正整数（单位 m）');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能续约', 'no_window');

  const player = await db
    .prepare('SELECT id, name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== clubId) throw new HttpError(400, '只能续约自己队里的球员');
  if (player.status !== 'normal') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员在挂牌流程里，不能续约' : '当前状态不能续约');
  }
  const contract = await db
    .prepare('SELECT release_fee, contract_type, protected_until FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; contract_type: string; protected_until: string | null }>();
  if (!contract || contract.release_fee === null || contract.release_fee <= 0) {
    throw new HttpError(409, '球员没有含违约金的现行合同，先让管理组补合同');
  }
  if (contract.contract_type === 'trainee') {
    throw new HttpError(400, '训练营合同是固定条款（0.75m / 5m），不能改违约金');
  }
  await ensureNotInFlight(db, playerId);

  const oldRc = contract.release_fee;
  const [low, high] = releaseFeeBounds(oldRc);
  if (newFee < low || newFee > high) {
    throw new HttpError(400, `新违约金需在 ${low}~${high} 之间（整数 m，原违约金 ${oldRc} m）`);
  }
  const changeFee = rcChangeFee(oldRc, newFee);
  if (changeFee > 0) {
    const available = await availableBalance(db, clubId);
    if (round2(available) < changeFee) {
      throw new HttpError(400, `可用资金不足：提高违约金要付差额 30%（${changeFee} m），当前可支配 ${round2(available)} m`);
    }
  }

  const { transferId } = await createBypassTransfer(env, {
    actor,
    type: 'rc_change',
    playerId,
    fromClubId: clubId,
    toClubId: clubId,
    fee: newFee,
    extraFee: null,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { oldReleaseFee: oldRc, oldProtectedUntil: contract.protected_until },
    payload: {
      kind: 'rc_change',
      playerId,
      playerName: player.name,
      clubId,
      oldReleaseFee: oldRc,
      newReleaseFee: newFee,
      changeFee,
      season: win.season,
      windowSeq: win.windowSeq,
    },
    action: 'bypass_rc_change',
  });
  return { ok: true, transferId, oldReleaseFee: oldRc, newReleaseFee: newFee, changeFee };
}

// ---- 解约（规则 4.4.4） ----

export interface TerminationResult {
  ok: true;
  transferId: number;
  terminationFee: number;
}

export async function createTermination(
  env: Env,
  clubId: number,
  actor: number,
  playerIdInput: unknown,
): Promise<TerminationResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能解约', 'no_window');

  const player = await db
    .prepare('SELECT id, name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== clubId) throw new HttpError(400, '只能解约自己队里的球员');
  if (player.status !== 'normal' && player.status !== 'trainee') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员在挂牌流程里，不能解约' : '当前状态不能解约');
  }
  const contract = await db
    .prepare('SELECT release_fee, effective_from FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; effective_from: string | null }>();
  if (!contract || contract.release_fee === null || contract.release_fee <= 0) {
    throw new HttpError(409, '球员没有含违约金的现行合同，先让管理组补合同');
  }
  if (contract.effective_from === null) {
    throw new HttpError(409, '合同缺效力起点，算不了解约费，先让管理组补合同数据');
  }
  await ensureNotInFlight(db, playerId);

  const fee = terminationFee(contract.release_fee, contract.effective_from, Date.now());
  if (fee === null) throw new HttpError(409, '合同缺效力起点，算不了解约费，先让管理组补合同数据');
  if (fee > 0) {
    const available = await availableBalance(db, clubId);
    if (round2(available) < fee) {
      throw new HttpError(400, `可用资金不足：解约费要 ${fee} m（审核通过时销毁），当前可支配 ${round2(available)} m`);
    }
  }

  const { transferId } = await createBypassTransfer(env, {
    actor,
    type: 'termination',
    playerId,
    fromClubId: clubId,
    toClubId: null,
    fee: 0,
    extraFee: fee,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { oldReleaseFee: contract.release_fee, effectiveFrom: contract.effective_from },
    payload: {
      kind: 'termination',
      playerId,
      playerName: player.name,
      clubId,
      terminationFee: fee,
      season: win.season,
      windowSeq: win.windowSeq,
    },
    action: 'bypass_termination',
  });
  // 4.4.10：解约提交即触发本窗续约回滚（触发 ref = 解约单）
  await rollbackRcChangeForPlayer(env, playerId, actor, { refType: 'transfer', refId: transferId });
  return { ok: true, transferId, terminationFee: fee };
}

// ---- 海捞（规则 4.4.3：签入自由球员，签入费 = 新违约金 × 30%，新 RC 不设上下限） ----

export interface FreeAgentResult {
  ok: true;
  transferId: number;
  newReleaseFee: number;
  signFee: number;
}

export async function createFreeAgent(
  env: Env,
  clubId: number,
  actor: number,
  playerIdInput: unknown,
  newFeeInput: unknown,
): Promise<FreeAgentResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  const newFee = Number(newFeeInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isInteger(newFee) || newFee <= 0) throw new HttpError(400, '新违约金须为正整数（单位 m，海捞不设上下限）');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能海捞', 'no_window');

  const player = await db
    .prepare('SELECT id, name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== null) throw new HttpError(400, '海捞只能签无归属的球员（这名球员有东家）');
  if (player.status === 'retired' || player.status === 'listed') throw new HttpError(400, '当前状态不能海捞');
  // 4.4.4：本转会窗被解约的球员，所有球队本窗都无法签入
  const banned = await db
    .prepare(
      `SELECT id FROM transfers WHERE player_id = ? AND type = 'termination' AND status = 'completed'
         AND season = ? AND window_seq = ? LIMIT 1`,
    )
    .bind(playerId, win.season, win.windowSeq)
    .first<{ id: number }>();
  if (banned) throw new HttpError(409, '这名球员本窗口被解约过，本窗口所有球队都不能签他');
  await ensureNotInFlight(db, playerId);

  const signFee = freeAgentFee(newFee);
  const available = await availableBalance(db, clubId);
  if (round2(available) < signFee) {
    throw new HttpError(400, `可用资金不足：海捞签入费是新违约金的 30%（${signFee} m），当前可支配 ${round2(available)} m`);
  }

  const { transferId } = await createBypassTransfer(env, {
    actor,
    type: 'free_agent',
    playerId,
    fromClubId: null,
    toClubId: clubId,
    fee: newFee,
    extraFee: null,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { signFee },
    payload: {
      kind: 'free_agent',
      playerId,
      playerName: player.name,
      clubId,
      newReleaseFee: newFee,
      signFee,
      season: win.season,
      windowSeq: win.windowSeq,
    },
    action: 'bypass_free_agent',
  });
  return { ok: true, transferId, newReleaseFee: newFee, signFee };
}

// ---- 强制拍卖（规则 4.4.5）：准入失败触发，管理方以 1m 挂牌，整单税 50% ----

export interface ForcedAuctionResult {
  ok: true;
  listingId: number;
  askPrice: number;
}

/**
 * 管理方建强制拍卖：人选必须是该俱乐部阵容 CA 前六（含并列、不含门将）的正式球员；
 * 挂牌价固定 1m，之后走普通挂牌链（首价 ≥1m、正常竞价、成交税整单 50%）。
 */
export async function createForcedAuction(
  env: Env,
  actor: number,
  playerIdInput: unknown,
): Promise<ForcedAuctionResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能发起强制拍卖', 'no_window');

  const player = await db
    .prepare('SELECT id, name, club_id, status, position, ca FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; name: string; club_id: number | null; status: string; position: string | null; ca: number | null }>();
  if (!player || player.club_id === null) throw new HttpError(404, '球员不存在或没有归属');
  if (player.position === 'GK') throw new HttpError(400, '强制拍卖人选不含门将（4.4.5）');
  if (player.ca === null) throw new HttpError(409, '球员缺 CA 数据，无法核验前六资格');
  if (player.status !== 'normal') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员已经在挂牌流程里了' : '当前状态不能强制拍卖');
  }

  // CA 前六（含并列）：严格高于其 CA 的非门将队友数 < 6
  const rankRow = await db
    .prepare(
      `SELECT COUNT(*) + 1 AS rank FROM players
       WHERE club_id = ? AND position != 'GK' AND ca > ?`,
    )
    .bind(player.club_id, player.ca)
    .first<{ rank: number }>();
  if ((rankRow?.rank ?? 99) > 6) {
    throw new HttpError(409, '拍卖人选必须是阵容 CA 前六（含并列、不含门将）');
  }
  await ensureNotInFlight(db, playerId);

  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`)
      .bind(playerId, player.club_id),
    db
      .prepare(
        `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, season, window_seq)
         VALUES (?, ?, 'forced', ?, 'listed', ${nowSql()}, ?, ?, ?)`,
      )
      .bind(playerId, player.club_id, FORCED_AUCTION_PRICE, shanghaiDateStr(Date.now()), win.season, win.windowSeq),
    audit({
      actor,
      action: 'forced_auction_create',
      targetType: 'listing',
      targetId: null,
      after: { playerId, sellerClubId: player.club_id, askPrice: FORCED_AUCTION_PRICE, season: win.season, windowSeq: win.windowSeq },
    }),
  ];
  const results = await db.batch(statements);
  if ((results[0].meta.changes ?? 0) === 0 || (results[1].meta.changes ?? 0) === 0) {
    throw new HttpError(409, '拍卖单没落库，球员状态可能刚被改过，刷新再试');
  }
  const listingId = Number(results[1].meta.last_row_id);

  // 4.4.10：强制拍卖属挂牌，提交即触发本窗续约回滚
  await rollbackRcChangeForPlayer(env, playerId, actor, { refType: 'listing', refId: listingId });

  return { ok: true, listingId, askPrice: FORCED_AUCTION_PRICE };
}

// 管理方取消强制拍卖（未成交前）：解冻出价、球员还原，不收下架费
export async function cancelForcedAuction(env: Env, actor: number, listingIdInput: unknown): Promise<{ ok: true }> {
  const db = env.DB;
  const listingId = Number(listingIdInput);
  if (!Number.isInteger(listingId) || listingId <= 0) throw new HttpError(400, 'listingId 应为挂牌 ID');
  const listing = await db
    .prepare('SELECT id, player_id, status, type FROM listings WHERE id = ?')
    .bind(listingId)
    .first<{ id: number; player_id: number; status: string; type: string }>();
  if (!listing || listing.type !== 'forced') throw new HttpError(404, '强制拍卖单不存在');
  if (listing.status !== 'listed' && listing.status !== 'bidding') {
    throw new HttpError(409, '这单拍卖已经截止进审核，走审核驳回流程');
  }

  const audit = createAuditStatement(db);
  await db.batch([
    db
      .prepare(`UPDATE listings SET status = 'delisted', deadline_note = '管理组取消强制拍卖' WHERE id = ? AND type = 'forced' AND status IN ('listed', 'bidding')`)
      .bind(listingId),
    db
      .prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'listed'`)
      .bind(listing.player_id),
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`).bind(listingId),
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'`)
      .bind(listingId),
    audit({
      actor,
      action: 'forced_auction_cancel',
      targetType: 'listing',
      targetId: listingId,
      after: { playerId: listing.player_id },
    }),
  ]);
  return { ok: true };
}

// ---- 审核通过分流（approve → 按单据类型走各自成约路径） ----

export async function approveTransferDeal(
  env: Env,
  transferId: number,
  actor: number | null,
  review: ReviewDecision,
): Promise<{ status: string }> {
  const transfer = await loadTransfer(env.DB, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  switch (transfer.type) {
    case 'termination':
      return completeTermination(env, transferId, actor, review);
    case 'rc_change': {
      const ev = transferEvidence<RcChangeEvidence>(transfer);
      const fee = rcChangeFee(ev?.oldReleaseFee ?? 0, transfer.fee ?? 0);
      if (fee > 0 && transfer.to_club_id !== null) {
        await chargeBypassFee(
          env,
          transferId,
          transfer.to_club_id,
          fee,
          'rc_change_fee',
          `续约费（违约金 ${ev?.oldReleaseFee ?? '?'}m → ${transfer.fee}m 差额 30%，销毁）`,
        );
      }
      // F 提交时已定死：开会即快照 E（× 续约加薪区间，规则 4.3.3）
      const opened = await openNegotiationSession(env, transferId, actor, review, {
        fixedReleaseFee: transfer.fee ?? undefined,
        renewalRaise: true,
      });
      return { status: opened.status };
    }
    case 'free_agent': {
      const f = transfer.fee ?? 0;
      if (f > 0 && transfer.to_club_id !== null) {
        await chargeBypassFee(env, transferId, transfer.to_club_id, freeAgentFee(f), 'free_agent_fee', `海捞签入费（新违约金 ${f}m × 30%，销毁）`);
      }
      // F 提交时已定死：开会即快照 E（不乘续约加薪）
      const opened = await openNegotiationSession(env, transferId, actor, review, { fixedReleaseFee: f || undefined });
      return { status: opened.status };
    }
    case 'match': {
      interface MatchEvidence {
        oldReleaseFee: number;
        previousBid: number;
      }
      const ev = transferEvidence<MatchEvidence>(transfer);
      const f = transfer.fee ?? 0;
      const diff = matchDiff(ev?.oldReleaseFee ?? 0, f);
      if (transfer.to_club_id !== null) {
        await chargeBypassFee(env, transferId, transfer.to_club_id, diff, 'match_diff_burn', `匹配差额（违约金 ${ev?.oldReleaseFee ?? '?'}m → ${f}m，销毁）`);
      }
      // F 提交时已定死：开会即快照 E（匹配不乘续约加薪）
      const opened = await openNegotiationSession(env, transferId, actor, review, { fixedReleaseFee: f || undefined });
      return { status: opened.status };
    }
    default:
      return openNegotiationSession(env, transferId, actor, review);
  }
}

// ---- 窗内回滚（4.4.10）：续约完成后同窗被挂牌/激活/解约 → 更改无效 ----

export interface RollbackTrigger {
  refType: string;
  refId: number;
}

/**
 * 回滚该球员本窗全部已完成的续约单：RC 与保护期还原到本窗第一张续约单之前，
 * 已收续约费逐单退还（退款流水 ref = 续约单本身，幂等闸使任何触发序列下每单只退一次——
 * 同窗可能被多个触发单先后命中回滚）。仅当球员仍归属原续约俱乐部时回滚合同与退款
 * （若同窗已被卖掉，新合同是新东家谈判的产物，回滚只留审计不留改）。
 * 工资不回滚（假设口径见 TECH_DESIGN 假设表）。
 */
export async function rollbackRcChangeForPlayer(
  env: Env,
  playerId: number,
  actor: number | null,
  trigger: RollbackTrigger,
): Promise<boolean> {
  const db = env.DB;
  const win = await getOpenWindow(db);
  if (!win) return false;
  const rows = await db
    .prepare(
      `SELECT id, extra_fee FROM transfers
       WHERE player_id = ? AND type = 'rc_change' AND status = 'completed' AND season = ? AND window_seq = ?
       ORDER BY id ASC`,
    )
    .bind(playerId, win.season, win.windowSeq)
    .all<{ id: number; extra_fee: number | null }>();
  if (rows.results.length === 0) return false;

  const first = await loadTransfer(db, rows.results[0].id);
  const ev = first ? transferEvidence<RcChangeEvidence>(first) : null;
  if (!first || !ev || !Number.isFinite(ev.oldReleaseFee)) return false;
  const clubId = first.from_club_id;

  const contract = await db
    .prepare('SELECT club_id FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ club_id: number | null }>();
  const stillOwned = contract !== null && contract.club_id === clubId;

  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  const refundable = stillOwned && clubId !== null ? rows.results.filter((r) => (r.extra_fee ?? 0) > 0) : [];
  if (stillOwned) {
    statements.push(
      db
        .prepare(`UPDATE contracts SET release_fee = ?, protected_until = ? WHERE player_id = ? AND is_active = 1`)
        .bind(ev.oldReleaseFee, ev.oldProtectedUntil, playerId),
    );
  }
  for (const r of refundable) {
    statements.push(
      ...ledgerMovement(db, {
        clubId: clubId as number,
        delta: r.extra_fee as number,
        kind: 'rc_change_refund',
        refType: 'transfer',
        refId: r.id,
        memo: `窗内更改违约金回滚退款（4.4.10，续约单 #${r.id}）`,
      }),
    );
  }
  statements.push(
    audit({
      actor,
      action: 'rc_change_rollback',
      targetType: 'player',
      targetId: playerId,
      after: {
        restoredReleaseFee: stillOwned ? ev.oldReleaseFee : null,
        restoredProtectedUntil: stillOwned ? ev.oldProtectedUntil : null,
        refund: refundable.reduce((s, r) => s + (r.extra_fee ?? 0), 0),
        refundedTransfers: refundable.map((r) => r.id),
        stillOwned,
        trigger: trigger.refType,
        rcChangeTransfers: rows.results.map((r) => r.id),
      },
    }),
  );
  await db.batch(statements);
  return true;
}
