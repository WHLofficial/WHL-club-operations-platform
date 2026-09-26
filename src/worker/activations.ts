// 激活 + 匹配服务（TECH_DESIGN §6.2，规则 4.4.2）：对别队球员按激活金额强制挂牌。
// 训练营球员固定 5m（4.4.2.3(3)）；普通球员保护期内 RC≤20→2 倍、>20→1.5 倍、保护期外 1 倍。
// 流程：激活挂牌 → 激活方 5 分钟内落首价（他队出价无效）→ 训练营合同直接进待审
//（固定条款无匹配可言）；正式合同进 matched_pending（被激活方 24h 匹配窗）：
// 匹配 = 新 RC > 首价 + 付差额（销毁，每名球员生涯限一次），放行/到期 = 按激活价成交。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { activationFee, matchDiff } from '../core/bypass-rules.ts';
import { TRAINEE_ACTIVATION_FEE, round2, shanghaiDateStr } from '../core/market-rules.ts';
import { availableBalance } from './ledger.ts';
import { getOpenWindow } from './seasons.ts';
import { closedRegularTicks } from './contract-ticks.ts';
import { loadMarketContext } from './market-context.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { rollbackRcChangeForPlayer } from './bypass.ts';
import { settleListingForReview } from './market-settle.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface ActivationResult {
  ok: true;
  listingId: number;
  askPrice: number;
  kind: 'trainee' | 'normal';
  firstBidDeadline: string;
}

// 激活挂牌：训练营与普通球员统一入口（附录 A POST /api/transfers/activation）
export async function createActivation(
  env: Env,
  clubId: number,
  actor: number,
  playerIdInput: unknown,
): Promise<ActivationResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能激活', 'no_window');

  const player = await db
    .prepare('SELECT id, name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; name: string; club_id: number | null; status: string }>();
  if (!player || player.club_id === null) throw new HttpError(404, '球员不存在或没有归属');
  if (player.club_id === clubId) throw new HttpError(400, '不能激活自己队里的球员');
  if (player.status !== 'normal' && player.status !== 'trainee') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员已经在挂牌流程里了' : '当前状态不能被激活');
  }

  const contract = await db
    .prepare('SELECT release_fee, contract_type, service_ticks, protection_ticks FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; contract_type: string; service_ticks: number; protection_ticks: number | null }>();
  if (!contract) throw new HttpError(400, '找不到这名球员的现行合同，先让管理组核对合同');
  const isTrainee = contract.contract_type === 'trainee';
  // 效力与保护期按转会窗刻度（v3.0.0）：当前已关常规窗数 − 签约基数；训练营合同无保护期
  const currentTicks = await closedRegularTicks(db);
  const askPrice = isTrainee
    ? TRAINEE_ACTIVATION_FEE
    : activationFee(contract.release_fee ?? 0, contract.protection_ticks, currentTicks);

  // 效力校验（4.4.2.3(3)）：效力为 0（刚签约、还没经历常规窗关窗）的球员不可被激活
  if (currentTicks <= (contract.service_ticks ?? 0)) {
    throw new HttpError(409, '刚签约的球员不可被激活（效力为 0，等常规窗关窗后才行）');
  }

  // 一窗一次（4.4.2.1）：失效激活也占额（§6.2 假设口径）
  const prior = await db
    .prepare(`SELECT id FROM listings WHERE player_id = ? AND type = 'activation' AND season = ? AND window_seq = ? LIMIT 1`)
    .bind(playerId, win.season, win.windowSeq)
    .first<{ id: number }>();
  if (prior) throw new HttpError(409, '这名球员本窗口已经被激活过了');

  // 激活方须在出价窗内落价，否则激活作废还占一窗一次额度——创建时就挡掉明显付不起的
  const available = await availableBalance(db, clubId);
  if (round2(available) < askPrice) {
    throw new HttpError(400, `可用资金不足：激活后要在出价窗内出价 ${round2(askPrice)} m，当前可支配 ${round2(available)} m`);
  }

  const ctx = await loadMarketContext(db);
  const listedAt = new Date();
  const deadline = new Date(listedAt.getTime() + ctx.activationWindowMin * 60_000);
  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status IN ('normal', 'trainee')`)
      .bind(playerId, player.club_id),
    db
      .prepare(
        `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, activated_by, activation_deadline, season, window_seq)
         VALUES (?, ?, 'activation', ?, 'listed', ${nowSql()}, ?, ?, ?, ?, ?)`,
      )
      .bind(
        playerId,
        player.club_id,
        askPrice,
        shanghaiDateStr(listedAt.getTime()),
        clubId,
        deadline.toISOString(),
        win.season,
        win.windowSeq,
      ),
    audit({
      actor,
      action: 'activation_create',
      targetType: 'listing',
      targetId: null,
      origin: 'user',
      after: {
        playerId,
        sellerClubId: player.club_id,
        byClubId: clubId,
        fee: askPrice,
        kind: isTrainee ? 'trainee' : 'normal',
        season: win.season,
        windowSeq: win.windowSeq,
      },
    }),
  ];
  let results: { meta: { changes: number; last_row_id: number } }[];
  try {
    results = await db.batch(statements);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      throw new HttpError(409, '这名球员刚好被别人抢先激活了');
    }
    throw err;
  }
  if ((results[0].meta.changes ?? 0) === 0 || (results[1].meta.changes ?? 0) === 0) {
    throw new HttpError(409, '激活没落库，球员状态可能刚被改过，刷新再试');
  }
  const listingId = Number(results[1].meta.last_row_id);

  // 4.4.10：激活挂牌提交即触发本窗续约回滚（触发 ref = 转会区挂牌记录）
  await rollbackRcChangeForPlayer(env, playerId, actor, { refType: 'listing', refId: listingId });

  return { ok: true, listingId, askPrice, kind: isTrainee ? 'trainee' : 'normal', firstBidDeadline: deadline.toISOString() };
}

export interface MatchResult {
  ok: true;
  decision: 'match' | 'pass';
  newReleaseFee?: number;
  diff?: number;
}

/**
 * 被激活方的匹配决定（24h 窗内）：newReleaseFee 缺省 = 放行（按激活价成交）。
 * 匹配：新 RC 必须高于当前首价（整数 m，不受 4.4.6 幅度约束——差额本身是代价），
 * 生涯只能被匹配一次；差额在审核通过时销毁（这里预检资金）。单批原子：
 * match 单 + 审核任务 + 挂牌收口 + 首价出价作废解冻 + 球员还原。
 */
export async function submitMatch(
  env: Env,
  sellerClubId: number,
  actor: number,
  listingIdInput: unknown,
  newFeeInput: unknown,
): Promise<MatchResult> {
  const db = env.DB;
  const listingId = Number(listingIdInput);
  if (!Number.isInteger(listingId) || listingId <= 0) throw new HttpError(400, 'listingId 应为挂牌 ID');

  const listing = await db
    .prepare(`SELECT id, player_id, seller_club_id, status, season, window_seq FROM listings WHERE id = ?`)
    .bind(listingId)
    .first<{ id: number; player_id: number; seller_club_id: number; status: string; season: number | null; window_seq: number | null }>();
  if (!listing) throw new HttpError(404, '挂牌不存在');
  if (listing.seller_club_id !== sellerClubId) throw new HttpError(403, '只有被激活方可以决定是否匹配');
  if (listing.status !== 'matched_pending') throw new HttpError(409, '这单激活不在匹配等待期');

  const bid = await db
    .prepare(`SELECT id, club_id, amount FROM bids WHERE listing_id = ? AND status = 'active' ORDER BY amount DESC, id DESC LIMIT 1`)
    .bind(listingId)
    .first<{ id: number; club_id: number; amount: number }>();
  if (!bid) throw new HttpError(409, '找不到激活方的出价，数据不完整');

  if (newFeeInput === undefined || newFeeInput === null || newFeeInput === 'pass') {
    // 放行：按激活价成交，转待审
    await settleListingForReview(db, { id: listing.id, player_id: listing.player_id, seller_club_id: listing.seller_club_id, ask_price: bid.amount, season: listing.season, window_seq: listing.window_seq }, actor, 'user', 'matched_pending');
    return { ok: true, decision: 'pass' };
  }

  const newFee = Number(newFeeInput);
  if (!Number.isInteger(newFee) || newFee <= 0) throw new HttpError(400, '匹配新违约金须为正整数（单位 m）');
  if (newFee <= bid.amount) throw new HttpError(400, `匹配新违约金必须高于当前竞价最高价（${round2(bid.amount)} m）`);
  const contract = await db
    .prepare('SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(listing.player_id)
    .first<{ release_fee: number | null }>();
  const oldRc = contract?.release_fee ?? 0;
  const diff = matchDiff(oldRc, newFee);

  // 每名球员最多被匹配一次（4.4.2.4，生涯口径：已完成的匹配单即占）
  const matched = await db
    .prepare(`SELECT id FROM transfers WHERE player_id = ? AND type = 'match' AND status = 'completed' LIMIT 1`)
    .bind(listing.player_id)
    .first<{ id: number }>();
  if (matched) throw new HttpError(409, '这名球员已经被匹配过一次了');

  const available = await availableBalance(db, sellerClubId);
  if (round2(available) < diff) {
    throw new HttpError(400, `可用资金不足：匹配要付新旧违约金差额（${diff} m，销毁），当前可支配 ${round2(available)} m`);
  }

  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(
        `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, matched, season, window_seq, idempotency_key, evidence, created_at)
         VALUES ('match', ?, ?, ?, ?, 'pending_review', 1, ?, ?, ?, ?, ${nowSql()})`,
      )
      .bind(
        listing.player_id,
        sellerClubId,
        sellerClubId,
        newFee,
        listing.season,
        listing.window_seq,
        `match:${listing.id}`,
        JSON.stringify({ oldReleaseFee: oldRc, previousBid: bid.amount, listingId }),
      ),
    db
      .prepare(
        `INSERT INTO review_tasks (type, ref_id, payload, status)
         SELECT 'transfer_confirm', last_insert_rowid(), ?, 'open'`,
      )
      .bind(
        JSON.stringify({
          kind: 'match',
          playerId: listing.player_id,
          sellerClubId,
          listingId,
          previousBid: bid.amount,
          newReleaseFee: newFee,
          diff,
          season: listing.season,
          windowSeq: listing.window_seq,
        }),
      ),
    // 挂牌落终态（「一球员一活跃挂牌」唯一索引随之释放；成约走 match 单，不再有这单 sale）
    db
      .prepare(`UPDATE listings SET status = 'delisted', deadline_note = '被匹配，球员留队' WHERE id = ? AND status = 'matched_pending'`)
      .bind(listing.id),
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`).bind(listing.id),
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'`)
      .bind(listing.id),
    db
      .prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'listed'`)
      .bind(listing.player_id),
  ];
  const results = await db.batch(statements);
  if ((results[2]?.meta.changes ?? 0) === 0) throw new HttpError(409, '匹配没落库，这单激活状态刚变过，刷新再试');

  await db.batch([
    db
      .prepare(
        `UPDATE transfers SET review_task_id = (SELECT MAX(id) FROM review_tasks WHERE ref_id = ? AND type = 'transfer_confirm') WHERE id = ?`,
      )
      .bind(Number(results[0].meta.last_row_id), Number(results[0].meta.last_row_id)),
    audit({
      actor,
      action: 'match_submit',
      targetType: 'transfer',
      targetId: Number(results[0].meta.last_row_id),
      origin: 'user',
      after: { listingId, playerId: listing.player_id, newReleaseFee: newFee, diff },
    }),
  ]);

  // 匹配后若之前同窗有续约单……匹配不是挂牌/解约，不触发 4.4.10 回滚（规则仅列三类）

  return { ok: true, decision: 'match', newReleaseFee: newFee, diff };
}
