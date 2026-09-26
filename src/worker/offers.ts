// 报价 / 议价业务编排（v6.3.0，设计 §2-§5）：送报价 / 还价 / 同意（含挂牌事务）/ 拒绝 / 撤回 /
// 惰性过期 / offer-settings。资金口径照 src/worker/routes/market.ts 的出价范式：
// 预检给可读报错，0005/0037 触发器在同一事务兜底（WHL_OFFER_REJECT_*）。
// 会话/归属校验在 routes/offers.ts；本层只认 clubId + actor。
// 循环依赖注意：本文件不 import market-settle（settleOverdue 反向挂 expireStaleOffers），
// 送报价等入口的惰性过期由路由层先跑一遍 settleOverdue。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import {
  autoRespondKind,
  minOfferPriceBounds,
  otherTurn,
  validateOfferAmount,
  validateStrictRaise,
  type OfferTurn,
} from '../core/offer-rules.ts';
import { round2, shanghaiDateStr } from '../core/market-rules.ts';
import { getOpenWindow, isWindowOpen } from './seasons.ts';
import { availableBalance } from './ledger.ts';
import { queueClubNotification } from './notify.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { rollbackRcChangeForPlayer } from './bypass.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const ACTIVE_LISTING_STATUSES = "('listed', 'bidding', 'matched_pending', 'pending_review')";

/**
 * 0037 触发器兜底（WHL_OFFER_REJECT_*）与 partial unique 撞车从 D1 裸错转可读 HttpError。
 * 服务层预检与落库之间有并发窗口（资金被抢 / 报价刚被对方处理 / 同买方重复），触发器拦下时
 * 若不映射，用户看到的是 500 + D1 错误文本。与 routes/market.ts 的 WHL_BID_REJECT_* 同形。
 */
function mapOfferTriggerError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('WHL_OFFER_REJECT_FUNDS')) throw new HttpError(400, '可用资金不足：报价即冻结，冻结没过账这单就不算数，刷新再试');
  if (msg.includes('WHL_OFFER_REJECT_CLOSED')) throw new HttpError(409, '这条报价刚被处理过了，刷新看看');
  if (msg.includes('WHL_OFFER_REJECT_AMOUNT')) throw new HttpError(409, '报价金额刚被改过（对方还在操作），刷新再试');
  if (msg.includes('idx_offers_active_pair')) throw new HttpError(409, '你已经有一条还在这名球员头上的报价，先撤回或等它了结');
  throw err instanceof Error ? err : new Error(String(err));
}

export interface OfferRow {
  id: number;
  player_id: number;
  buyer_club_id: number;
  seller_club_id: number;
  amount: number;
  init_amount: number;
  round: number;
  note: string | null;
  status: string;
  turn: string;
  hold_id: number | null;
  listing_id: number | null;
  season: number;
  window_seq: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const OFFER_WITH_CONTEXT = `
  SELECT o.*, p.status AS player_status, p.club_id AS player_club_id,
         p.transfer_listed, p.min_offer_price, p.not_for_sale,
         ${sqlDisplayName('p')} AS player_name, cp.is_cpu AS seller_is_cpu,
         ct.release_fee AS release_fee
  FROM offers o
  JOIN players p ON p.id = o.player_id
  LEFT JOIN clubs cp ON cp.id = o.seller_club_id
  LEFT JOIN contracts ct ON ct.player_id = o.player_id AND ct.is_active = 1`;

interface OfferContextRow extends OfferRow {
  player_status: string;
  player_club_id: number | null;
  transfer_listed: number;
  min_offer_price: number | null;
  not_for_sale: number;
  player_name: string;
  seller_is_cpu: number | null;
  release_fee: number | null;
}

async function loadOffer(db: D1Database, offerId: number): Promise<OfferContextRow> {
  const row = await db.prepare(`${OFFER_WITH_CONTEXT} WHERE o.id = ?`).bind(offerId).first<OfferContextRow>();
  if (!row) throw new HttpError(404, '这条报价不存在');
  return row;
}

/** 角色判定：买方 / 卖方 / 无关人（403） */
function roleOf(offer: { buyer_club_id: number; seller_club_id: number }, clubId: number): 'buyer' | 'seller' {
  if (clubId === offer.seller_club_id) return 'seller';
  if (clubId === offer.buyer_club_id) return 'buyer';
  throw new HttpError(403, '这不是你的报价单', 'not_your_offer');
}

// ---- 送报价（设计 §3：名单球员收到报价立即自动应答，无人工还价分支）----

export interface PlaceOfferInput {
  clubId: number;
  actor: number;
  playerId: number;
  amount: number;
  note?: string | null;
}

export async function placeOffer(
  env: Env,
  input: PlaceOfferInput,
): Promise<{ offerId: number; status: string; auto: 'auto_accept' | 'auto_reject' | null }> {
  const db = env.DB;
  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能报价', 'no_window');
  const amount = round2(input.amount);

  const p = await db
    .prepare(
      `SELECT p.id, p.club_id, p.status, p.transfer_listed, p.min_offer_price, p.offer_auto, p.not_for_sale,
              ${sqlDisplayName('p')} AS name, cp.is_cpu AS seller_is_cpu, ct.release_fee AS release_fee
       FROM players p
       LEFT JOIN clubs cp ON cp.id = p.club_id
       LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
       WHERE p.id = ?`,
    )
    .bind(input.playerId)
    .first<{
      id: number;
      club_id: number | null;
      status: string;
      transfer_listed: number;
      min_offer_price: number | null;
      offer_auto: number;
      not_for_sale: number;
      name: string;
      seller_is_cpu: number | null;
      release_fee: number | null;
    }>();
  if (!p) throw new HttpError(404, '球员不存在');
  if (p.club_id === null || p.status === 'free') throw new HttpError(400, '自由球员不走报价，直接海捞签入');
  if (p.club_id === input.clubId) throw new HttpError(400, '不能对自己队的球员报价');
  if (p.seller_is_cpu === 1) throw new HttpError(400, 'CPU 队的球员不走报价，直接海捞签入');
  if (p.status === 'listed') {
    throw new HttpError(409, '这名球员正在转会区挂牌，报价通道已关，去转会区出价', 'player_listed');
  }
  if (p.status === 'trainee') throw new HttpError(400, '训练营球员只能被激活转会（固定 5m），不走报价');
  if (p.status !== 'normal') throw new HttpError(400, '当前状态不能报价');
  if (p.not_for_sale === 1) throw new HttpError(403, '此球员为非卖品，一切报价都会被自动拒', 'not_for_sale');

  const amountError = validateOfferAmount(amount, p.release_fee);
  if (amountError) throw new HttpError(400, amountError, 'amount_out_of_bounds');

  const dup = await db
    .prepare(`SELECT id FROM offers WHERE player_id = ? AND buyer_club_id = ? AND status = 'pending' LIMIT 1`)
    .bind(input.playerId, input.clubId)
    .first<{ id: number }>();
  if (dup) throw new HttpError(409, '你已经有一条还在这名球员头上的报价，先撤回或等它了结');

  const available = await availableBalance(db, input.clubId);
  if (amount > round2(available + Number.EPSILON)) {
    throw new HttpError(400, `可用资金不足：可支配 ${round2(available)} m，报价需要 ${round2(amount)} m（报价即冻结）`);
  }

  const audit = createAuditStatement(db);
  const note = input.note?.trim() || null;
  // pending 唯一性由 partial unique 兜底；事件/冻结用「该 pending 单」子查询定位，规避 batch 内取自增 id
  const pendingRef = `(SELECT id FROM offers WHERE player_id = ? AND buyer_club_id = ? AND status = 'pending')`;
  let results: D1Result[];
  try {
    results = await db.batch([
    db
      .prepare(
        `INSERT INTO offers (player_id, buyer_club_id, seller_club_id, amount, init_amount, round, note, status, turn, season, window_seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', 'seller', ?, ?, ${nowSql()}, ${nowSql()})`,
      )
      .bind(input.playerId, input.clubId, p.club_id, amount, amount, note, win.season, win.windowSeq),
    db
      .prepare(
        `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
         VALUES (?, ?, 'held', 'offer', ${pendingRef}, ${nowSql()})`,
      )
      .bind(input.clubId, amount, input.playerId, input.clubId),
    db
      .prepare(
        `UPDATE offers SET hold_id = (SELECT id FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ${pendingRef} AND status = 'held')
         WHERE id = ${pendingRef}`,
      )
      .bind(input.playerId, input.clubId, input.playerId, input.clubId),
    db
      .prepare(
        `INSERT INTO offer_events (offer_id, actor_club_id, kind, amount, note, at)
         VALUES (${pendingRef}, ?, 'open', ?, ?, ${nowSql()})`,
      )
      .bind(input.playerId, input.clubId, input.clubId, amount, note),
    audit({
      actor: input.actor,
      action: 'offer_place',
      targetType: 'offer',
      targetId: null,
      origin: 'user',
      after: { playerId: input.playerId, buyerClubId: input.clubId, sellerClubId: p.club_id, amount },
    }),
    ]);
  } catch (err) {
    mapOfferTriggerError(err);
  }
  if ((results[1].meta.changes ?? 0) !== 1) throw new HttpError(409, '报价没落库（冻结没过账），刷新再试');
  const offerId = Number(results[0].meta.last_row_id);

  // 自动应答（v6.4.0 改动 B：只认最低报价与开关，与转会名单解耦）：auto_accept 走同一套
  // 挂牌事务；auto_reject 立即终态化（低于线一律自动拒，与开关无关）
  const auto = autoRespondKind(p.min_offer_price, p.offer_auto, amount);
  if (auto === 'auto_accept') {
    const offer = await loadOffer(db, offerId);
    await acceptOfferCore(env, offer, input.actor, 'seller', 'auto_accept');
    await queueClubNotification(env, input.clubId, 'offer_auto_accepted', {
      player: p.name,
      amount,
      sellerClubId: p.club_id,
    });
    await queueClubNotification(env, p.club_id ?? 0, 'offer_auto_accepted', { player: p.name, amount, self: true });
    return { offerId, status: 'accepted', auto };
  }
  if (auto === 'auto_reject') {
    const offer = await loadOffer(db, offerId);
    await rejectOfferCore(env, offer, p.club_id ?? 0, null, 'auto_reject', 'user');
    await queueClubNotification(env, input.clubId, 'offer_auto_rejected', { player: p.name, amount, min: p.min_offer_price });
    return { offerId, status: 'rejected', auto };
  }
  await queueClubNotification(env, p.club_id ?? 0, 'offer_received', {
    player: p.name,
    amount,
    buyerClubId: input.clubId,
    offerId,
  });
  return { offerId, status: 'pending', auto: null };
}

// ---- 还价（设计 §3：每次必须严格抬高当前 amount，轮到谁谁出价）----

export async function counterOffer(
  env: Env,
  input: { offerId: number; clubId: number; actor: number; amount: number; note?: string | null },
): Promise<{ ok: true; amount: number; turn: OfferTurn }> {
  const db = env.DB;
  const offer = await loadOffer(db, input.offerId);
  const role = roleOf(offer, input.clubId);
  if (offer.status !== 'pending') throw new HttpError(409, '这条报价已经了结，不能再还价');
  if (offer.turn !== role) throw new HttpError(409, '还没轮到你出价', 'not_your_turn');
  if (!(await isWindowOpen(db, offer.season, offer.window_seq))) {
    throw new HttpError(409, '报价所属的转会窗口已经关了', 'no_window');
  }
  if (offer.player_club_id !== offer.seller_club_id || offer.player_status !== 'normal') {
    throw new HttpError(409, '球员已不在卖家阵容里，这条报价马上会被过期收口');
  }
  if (offer.not_for_sale === 1) throw new HttpError(403, '球员刚被设为非卖品，这条报价会被自动拒', 'not_for_sale');

  const amount = round2(input.amount);
  const raiseError = validateStrictRaise(amount, offer.amount);
  if (raiseError) throw new HttpError(400, raiseError, 'amount_not_raised');
  const boundsError = validateOfferAmount(amount, offer.release_fee);
  if (boundsError) throw new HttpError(400, boundsError, 'amount_out_of_bounds');

  // 资金预检只对买方（卖方还价不出钱，买方接受时才补足冻结——见 acceptOffer）
  if (role === 'buyer') {
    const available = await availableBalance(db, input.clubId);
    const myHeld = offer.hold_id !== null ? offer.amount : 0;
    if (amount > round2(available + myHeld + Number.EPSILON)) {
      throw new HttpError(
        400,
        `可用资金不足：可支配 ${round2(available)} m${myHeld > 0 ? `（旧价冻结 ${round2(myHeld)} m 会被顶替释放）` : ''}，还价需要 ${round2(amount)} m`,
      );
    }
  }

  const audit = createAuditStatement(db);
  const note = input.note?.trim() || null;
  const turn = otherTurn(offer.turn as OfferTurn);
  let results: D1Result[];
  try {
    results = await db.batch([
    // 1) 严格抬高 + 未终结的守卫 UPDATE（并发闸；changes=0 即失败）
    db
      .prepare(
        `UPDATE offers SET amount = ?, round = round + 1, turn = ?, note = COALESCE(?, note), updated_at = ${nowSql()}
         WHERE id = ? AND status = 'pending' AND amount < ?`,
      )
      .bind(amount, turn, note, offer.id, amount),
    // 2) 旧冻结释放（买方才持有冻结；卖方还价只改数字不动资金）
    ...(role === 'buyer' && offer.hold_id !== null
      ? [db.prepare(`UPDATE fund_holds SET status = 'released' WHERE id = ? AND status = 'held'`).bind(offer.hold_id)]
      : []),
    // 3) 新冻结（触发器校验 pending + 金额一致 + 资金足额）
    ...(role === 'buyer'
      ? [
          db
            .prepare(
              `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
               VALUES (?, ?, 'held', 'offer', ?, ${nowSql()})`,
            )
            .bind(input.clubId, amount, offer.id),
          db
            .prepare(
              `UPDATE offers SET hold_id = (SELECT id FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1)
               WHERE id = ?`,
            )
            .bind(offer.id, offer.id),
        ]
      : []),
    db
      .prepare(
        `INSERT INTO offer_events (offer_id, actor_club_id, kind, amount, note, at)
         VALUES (?, ?, 'counter', ?, ?, ${nowSql()})`,
      )
      .bind(offer.id, input.clubId, amount, note),
    audit({
      actor: input.actor,
      action: 'offer_counter',
      targetType: 'offer',
      targetId: offer.id,
      origin: 'user',
      after: { amount, round: offer.round + 1, by: role },
    }),
    ]);
  } catch (err) {
    mapOfferTriggerError(err);
  }
  if ((results[0].meta.changes ?? 0) !== 1) throw new HttpError(409, '还价没落库：这条报价刚被处理过，刷新看看');

  const counterpartClubId = role === 'buyer' ? offer.seller_club_id : offer.buyer_club_id;
  await queueClubNotification(env, counterpartClubId, 'offer_countered', {
    player: offer.player_name,
    amount,
    by: role === 'buyer' ? '买方' : '卖方',
    offerId: offer.id,
  });
  return { ok: true, amount, turn };
}

// ---- 同意（含挂牌事务，设计 §4）：占用批 + 履约批，幂等可重入 ----

/**
 * 占用批：单守卫 UPDATE 把 pending 打成 accepted（turn 一起守）。
 * changes=0 ⇒ 刚被别人处理过 / 还没轮到你。成功后履约批只认
 * 「status='accepted' AND listing_id IS NULL」，并发方与自愈重跑都进不来第二条挂牌。
 * 崩溃窗口（占用成功、履约没跑）由 expireStaleOffers 的自愈分支补齐。
 */
async function acceptOfferCore(env: Env, offer: OfferContextRow, actor: number | null, byTurn: OfferTurn, eventKind: 'accept' | 'auto_accept' = 'accept'): Promise<number> {
  const db = env.DB;
  const occupy = await db
    .prepare(`UPDATE offers SET status = 'accepted', updated_at = ${nowSql()} WHERE id = ? AND status = 'pending' AND turn = ?`)
    .bind(offer.id, byTurn)
    .run();
  if ((occupy.meta.changes ?? 0) !== 1) throw new HttpError(409, '这条报价刚被处理过了，或还没轮到你同意', 'not_your_turn');

  const listingId = await fulfillAcceptedOffer(env, offer.id, actor, eventKind);
  if (listingId === null) {
    // 占用成功但履约进不去（球员状态刚坏）：占用已提交，交给自愈收口（转 expired 或补挂牌）
    throw new HttpError(409, '球员状态刚被改过，这条报价稍后会自动收口');
  }
  return listingId;
}

/**
 * 履约批（设计 §4 顺序）：挂牌 → hold 转正 → 领先出价 → 球员 listed → 兄弟单过期。幂等。
 * INSERT listings 是条件化 INSERT（守卫失败 = 0 行）。listing_id 写回与 hold 转正依赖
 * last_insert_rowid()，0 行场景下该值是本连接的陈值 ⇒ 两条语句都带「last_insert_rowid
 * 指向的挂牌确属本球员/本卖家/本价」的存在性守卫，陈值场景全批 0 行、不落脏数据。
 */
async function fulfillAcceptedOffer(env: Env, offerId: number, actor: number | null, eventKind: 'accept' | 'auto_accept' = 'accept'): Promise<number | null> {
  const db = env.DB;
  const offer = await db.prepare(`SELECT * FROM offers WHERE id = ?`).bind(offerId).first<OfferRow>();
  if (!offer) return null;
  if (offer.listing_id !== null) return offer.listing_id; // 已履约
  const listedDay = shanghaiDateStr(Date.now());
  const audit = createAuditStatement(db);
  // 履约守卫：offer 已占用且还没建挂牌；fresh listing = last_insert_rowid 确实是本次建出的那张
  const freshListing =
    `EXISTS (SELECT 1 FROM listings WHERE id = last_insert_rowid()
             AND player_id = (SELECT player_id FROM offers WHERE id = ?)
             AND seller_club_id = (SELECT seller_club_id FROM offers WHERE id = ?)
             AND ask_price = (SELECT amount FROM offers WHERE id = ?) AND status = 'listed')`;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, season, window_seq)
         SELECT player_id, seller_club_id, 'normal', amount, 'listed', ${nowSql()}, ?, season, window_seq
         FROM offers
         WHERE id = ? AND status = 'accepted' AND listing_id IS NULL
           AND EXISTS (SELECT 1 FROM players WHERE id = offers.player_id AND club_id = offers.seller_club_id AND status = 'normal')`,
      )
      .bind(listedDay, offerId),
    // players 的 listed 化必须排在 INSERT 之后：守卫要求 status='normal'，同批内先改后查必然 0 行
    db
      .prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`)
      .bind(offer.player_id, offer.seller_club_id),
    db
      .prepare(
        `UPDATE fund_holds SET ref_type = 'listing', ref_id = last_insert_rowid()
         WHERE id = (SELECT hold_id FROM offers WHERE id = ?) AND status = 'held'
           AND (${freshListing})`,
      )
      .bind(offerId, offerId, offerId, offerId),
    db
      .prepare(
        `UPDATE offers SET listing_id = last_insert_rowid(), resolved_at = ${nowSql()}
         WHERE id = ? AND status = 'accepted' AND listing_id IS NULL AND (${freshListing})`,
      )
      .bind(offerId, offerId, offerId, offerId),
    db
      .prepare(
        `INSERT INTO bids (listing_id, club_id, amount, created_at, status, hold_id)
         SELECT (SELECT listing_id FROM offers WHERE id = ?), buyer_club_id, amount, ${nowSql()}, 'active', hold_id
         FROM offers WHERE id = ? AND status = 'accepted' AND listing_id IS NOT NULL`,
      )
      .bind(offerId, offerId),
    // 同球员其余 pending 报价 → expired，冻结一并释放（设计 §3 同意即挂牌的副作用）
    db
      .prepare(
        `UPDATE offers SET status = 'expired', resolved_at = ${nowSql()}, updated_at = ${nowSql()}
         WHERE player_id = ? AND status = 'pending' AND id != ?`,
      )
      .bind(offer.player_id, offer.id),
    db
      .prepare(
        `UPDATE fund_holds SET status = 'released'
         WHERE ref_type = 'offer' AND ref_id IN (SELECT id FROM offers WHERE player_id = ? AND status = 'expired')`,
      )
      .bind(offer.player_id),
    db
      .prepare(
        `INSERT INTO offer_events (offer_id, actor_club_id, kind, amount, at)
         VALUES (?, ?, ?, ?, ${nowSql()})`,
      )
      .bind(offer.id, offer.seller_club_id, eventKind, offer.amount),
    db
      .prepare(
        `INSERT INTO offer_events (offer_id, actor_club_id, kind, amount, at)
         SELECT id, NULL, 'expire', amount, ${nowSql()} FROM offers WHERE player_id = ? AND status = 'expired' AND id != ?`,
      )
      .bind(offer.player_id, offer.id),
    audit({
      actor,
      action: 'offer_accept',
      targetType: 'offer',
      targetId: offer.id,
      origin: 'user',
      after: { playerId: offer.player_id, amount: offer.amount, season: offer.season, windowSeq: offer.window_seq },
    }),
  ]);
  // 以 changes 判定（last_row_id 在 0 行时是本连接的陈值，会假阳性）
  if ((results[1].meta.changes ?? 0) === 1) {
    const listing = Number(results[1].meta.last_row_id);
    // 挂牌提交即触发本窗续约回滚（与 market.ts 挂牌同口径；履约成功才触发）
    await rollbackRcChangeForPlayer(env, offer.player_id, actor, { refType: 'listing', refId: listing });
    return listing;
  }
  // 0 行：守卫失败（球员状态坏）。listing_id 仍 NULL → 调用方走自愈/报错
  return null;
}

/** 路由层入口：会话校验后的同意（买卖双方都走这里，轮到谁谁同意） */
export async function acceptOffer(env: Env, input: { offerId: number; clubId: number; actor: number }): Promise<{ ok: true; listingId: number }> {
  const db = env.DB;
  const offer = await loadOffer(db, input.offerId);
  const role = roleOf(offer, input.clubId);
  if (offer.status !== 'pending') throw new HttpError(409, '这条报价已经了结，不能再同意');
  if (offer.turn !== role) throw new HttpError(409, '还没轮到你，轮到对方处理', 'not_your_turn');
  if (!(await isWindowOpen(db, offer.season, offer.window_seq))) {
    throw new HttpError(409, '报价所属的转会窗口已经关了', 'no_window');
  }
  if (offer.not_for_sale === 1) throw new HttpError(403, '球员刚被设为非卖品，这条报价会被自动拒', 'not_for_sale');
  if (offer.player_club_id !== offer.seller_club_id || offer.player_status !== 'normal') {
    throw new HttpError(409, '球员已不在卖家阵容里，这条报价马上会被过期收口');
  }
  if (offer.hold_id === null) throw new HttpError(409, '这条报价的资金冻结缺失，不能同意');

  // 卖方还价抬高过 → 买方的冻结还停在旧额：接受前先补足到当前报价额（触发器校验 pending + 金额一致 + 资金）。
  // 必须在占用批之前做——触发器只放行 pending 单，占用后 INSERT 会被 WHL_OFFER_REJECT_CLOSED 拦。
  if (role === 'buyer') {
    const holdRow = await db.prepare('SELECT amount FROM fund_holds WHERE id = ? AND status = \'held\'').bind(offer.hold_id).first<{ amount: number }>();
    if (holdRow && round2(holdRow.amount) !== round2(offer.amount)) {
      const available = await availableBalance(db, input.clubId);
      if (offer.amount > round2(available + holdRow.amount + Number.EPSILON)) {
        throw new HttpError(
          400,
          `可用资金不足：接受这个还价需要 ${round2(offer.amount)} m（可支配 ${round2(available + holdRow.amount)} m，旧价冻结 ${round2(holdRow.amount)} m 会被顶替）`,
        );
      }
      try {
        await db.batch([
          db.prepare(`UPDATE fund_holds SET status = 'released' WHERE id = ? AND status = 'held'`).bind(offer.hold_id),
          db
            .prepare(
              `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
               VALUES (?, ?, 'held', 'offer', ?, ${nowSql()})`,
            )
            .bind(input.clubId, offer.amount, offer.id),
          db
            .prepare(
              `UPDATE offers SET hold_id = (SELECT id FROM fund_holds WHERE ref_type = 'offer' AND ref_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1)
               WHERE id = ?`,
            )
            .bind(offer.id, offer.id),
        ]);
      } catch (err) {
        mapOfferTriggerError(err);
      }
    }
  }

  // 本次同意会把这些 pending 兄弟单转 expired（设计 §3 同意即挂牌的副作用）：先记下买方，
  // 同意后只通知他们——历史 expired 单（窗关等早已过期）不该再收到「球员已被卖家挂牌」。
  const siblingBuyers = await db
    .prepare(`SELECT DISTINCT buyer_club_id FROM offers WHERE player_id = ? AND status = 'pending' AND id != ?`)
    .bind(offer.player_id, offer.id)
    .all<{ buyer_club_id: number }>();

  const listingId = await acceptOfferCore(env, offer, input.actor, role);

  await queueClubNotification(env, offer.buyer_club_id, 'offer_accepted', { player: offer.player_name, amount: offer.amount, listingId });
  await queueClubNotification(env, offer.seller_club_id, 'offer_accepted', { player: offer.player_name, amount: offer.amount, listingId });
  // 兄弟单买方通知「球员已挂牌」（同意即挂牌，成交走审核过户——v6.4.0 文案收口）
  for (const row of siblingBuyers.results) {
    if (row.buyer_club_id !== offer.buyer_club_id) {
      await queueClubNotification(env, row.buyer_club_id, 'offer_expired', { player: offer.player_name, reason: 'sold' });
    }
  }
  return { ok: true, listingId };
}

// ---- 拒绝 / 撤回（终态化 + 释放冻结，同一形状）----

async function finalizeOffer(
  env: Env,
  offer: OfferRow,
  opts: {
    status: 'rejected' | 'withdrawn' | 'expired';
    actorClubId: number | null;
    actor: number | null;
    origin: AuditOrigin;
    kind: 'reject' | 'withdraw' | 'auto_reject' | 'expire';
    note?: string | null;
  },
): Promise<boolean> {
  const db = env.DB;
  const audit = createAuditStatement(db);
  const results = await db.batch([
    db
      .prepare(`UPDATE offers SET status = ?, resolved_at = ${nowSql()}, updated_at = ${nowSql()} WHERE id = ? AND status = 'pending'`)
      .bind(opts.status, offer.id),
    db.prepare(`UPDATE fund_holds SET status = 'released' WHERE id = (SELECT hold_id FROM offers WHERE id = ?) AND status = 'held'`).bind(offer.id),
    db
      .prepare(
        `INSERT INTO offer_events (offer_id, actor_club_id, kind, amount, note, at) VALUES (?, ?, ?, ?, ?, ${nowSql()})`,
      )
      .bind(offer.id, opts.actorClubId, opts.kind, offer.amount, opts.note ?? null),
    audit({
      actor: opts.actor,
      action: `offer_${opts.kind}`,
      targetType: 'offer',
      targetId: offer.id,
      origin: opts.origin,
      after: { status: opts.status, amount: offer.amount, actorClubId: opts.actorClubId },
    }),
  ]);
  return (results[0].meta.changes ?? 0) > 0;
}

/** 卖方拒绝（任意轮次都能拒，设计 §3） */
export async function rejectOffer(env: Env, input: { offerId: number; clubId: number; actor: number }): Promise<{ ok: true }> {
  const db = env.DB;
  const offer = await loadOffer(db, input.offerId);
  const role = roleOf(offer, input.clubId);
  if (offer.status !== 'pending') throw new HttpError(409, '这条报价已经了结');
  if (role !== 'seller') throw new HttpError(403, '只有卖方能拒绝；买方要终止请用撤回', 'not_seller');
  const changed = await finalizeOffer(env, offer, { status: 'rejected', actorClubId: input.clubId, actor: input.actor, origin: 'user', kind: 'reject' });
  if (!changed) throw new HttpError(409, '这条报价刚被处理过了，刷新看看');
  await queueClubNotification(env, offer.buyer_club_id, 'offer_rejected', { player: offer.player_name, amount: offer.amount });
  return { ok: true };
}

/** 买方撤回（pending 期间随时可撤，设计 §3） */
export async function withdrawOffer(env: Env, input: { offerId: number; clubId: number; actor: number }): Promise<{ ok: true }> {
  const db = env.DB;
  const offer = await loadOffer(db, input.offerId);
  const role = roleOf(offer, input.clubId);
  if (offer.status !== 'pending') throw new HttpError(409, '这条报价已经了结');
  if (role !== 'buyer') throw new HttpError(403, '只有买方能撤回报价', 'not_seller');
  const changed = await finalizeOffer(env, offer, { status: 'withdrawn', actorClubId: input.clubId, actor: input.actor, origin: 'user', kind: 'withdraw' });
  if (!changed) throw new HttpError(409, '这条报价刚被处理过了，刷新看看');
  await queueClubNotification(env, offer.seller_club_id, 'offer_withdrawn', { player: offer.player_name, amount: offer.amount });
  return { ok: true };
}

/** 名单自动拒绝（设计 §2.3：系统应答，actor_club_id = NULL） */
async function rejectOfferCore(
  env: Env,
  offer: OfferRow,
  _sellerClubId: number,
  actor: number | null,
  kind: 'auto_reject',
  origin: AuditOrigin,
): Promise<void> {
  await finalizeOffer(env, offer, { status: 'rejected', actorClubId: null, actor, origin, kind });
}

// ---- 惰性过期（设计 §3）+ 自愈：挂进 settleOverdue（cron / 窗开关 / 读路径共用）----

export interface ExpireSummary {
  expired: number;
  fulfilled: number;
}

// origin 必填：这条惰性过期是哪条入口触发的（cron tick 或某次市场请求的惰性结算）。
export async function expireStaleOffers(env: Env, opts: { origin: AuditOrigin; actor?: number | null }): Promise<ExpireSummary> {
  const db = env.DB;
  const actor = opts.actor ?? null;
  const origin = opts.origin;
  const summary: ExpireSummary = { expired: 0, fulfilled: 0 };

  // 自愈：同意占用成功但履约没跑完（accepted 且无挂牌）→ 补履约；补不动（球员状态坏）转 expired
  const orphanRows = await db
    .prepare(`SELECT id FROM offers WHERE status = 'accepted' AND listing_id IS NULL ORDER BY id LIMIT 50`)
    .all<{ id: number }>();
  for (const row of orphanRows.results) {
    const listingId = await fulfillAcceptedOffer(env, row.id, actor);
    if (listingId !== null) {
      summary.fulfilled++;
    } else {
      const offer = await db.prepare(`SELECT * FROM offers WHERE id = ?`).bind(row.id).first<OfferRow>();
      if (offer && (await finalizeOffer(env, offer, { status: 'expired', actorClubId: null, actor, origin, kind: 'expire', note: '球员状态已变，无法成约' }))) {
        summary.expired++;
      }
    }
  }

  // 过期三因（设计 §3）：窗已关 / 球员不在卖方或非 normal / 同球员已有生效挂牌
  const candidates = await db
    .prepare(
      `SELECT o.id, o.player_id, o.amount, o.buyer_club_id, o.seller_club_id, p.status AS player_status, p.club_id AS player_club_id,
              sw.status AS window_status,
              (SELECT l.id FROM listings l WHERE l.player_id = o.player_id AND l.status IN ${ACTIVE_LISTING_STATUSES} LIMIT 1) AS active_listing_id,
              ${sqlDisplayName('p')} AS player_name
       FROM offers o
       JOIN players p ON p.id = o.player_id
       LEFT JOIN season_windows sw ON sw.season = o.season AND sw.window_seq = o.window_seq
       WHERE o.status = 'pending'
       ORDER BY o.id LIMIT 200`,
    )
    .all<{
      id: number;
      player_id: number;
      amount: number;
      buyer_club_id: number;
      seller_club_id: number;
      player_status: string;
      player_club_id: number | null;
      window_status: string | null;
      active_listing_id: number | null;
      player_name: string;
    }>();
  for (const row of candidates.results) {
    const stale =
      row.window_status !== 'open' ||
      row.player_club_id !== row.seller_club_id ||
      row.player_status !== 'normal' ||
      row.active_listing_id !== null;
    if (!stale) continue;
    const offer = await db.prepare(`SELECT * FROM offers WHERE id = ? AND status = 'pending'`).bind(row.id).first<OfferRow>();
    if (!offer) continue;
    if (await finalizeOffer(env, offer, { status: 'expired', actorClubId: null, actor, origin, kind: 'expire' })) {
      summary.expired++;
      await queueClubNotification(env, offer.buyer_club_id, 'offer_expired', { player: row.player_name, reason: 'window' });
      await queueClubNotification(env, offer.seller_club_id, 'offer_expired', { player: row.player_name, reason: 'window' });
    }
  }
  return summary;
}

// ---- 报价设置（v6.4.0 改动 B：最低报价 / 自动应答开关与转会名单解耦）----
// 用户裁决：没进转会名单也可以设最低报价与自动应答；低于线一律自动拒（与开关无关），
// 开关只控达线是否自动同意；进转会名单仍必须给最低报价。非卖品照旧压一切（线与开关被清）。

export async function setOfferSettings(
  env: Env,
  input: {
    clubId: number;
    actor: number;
    playerId: number;
    transferListed: boolean;
    minOfferPrice: number | null;
    offerAuto: boolean;
    notForSale: boolean;
  },
): Promise<{ ok: true; transferListed: boolean; minOfferPrice: number | null; offerAuto: boolean; notForSale: boolean }> {
  const db = env.DB;
  const p = await db
    .prepare(`SELECT p.id, p.club_id, p.status, p.transfer_listed, p.not_for_sale, ${sqlDisplayName('p')} AS name FROM players p WHERE p.id = ?`)
    .bind(input.playerId)
    .first<{ id: number; club_id: number | null; status: string; transfer_listed: number; not_for_sale: number; name: string }>();
  if (!p || p.club_id !== input.clubId) throw new HttpError(404, '球员不存在或不在你的队里');
  if (p.status === 'listed') throw new HttpError(409, '这名球员在转会区挂牌中，报价设置先锁定，下架后再改');
  if (p.status !== 'normal') throw new HttpError(400, '当前状态改不了报价设置');
  if (input.transferListed && input.notForSale) throw new HttpError(400, '非卖品和转会名单互斥，二选一');

  let minOfferPrice: number | null = null;
  if (input.minOfferPrice !== null && Number.isFinite(input.minOfferPrice)) {
    const bounds = minOfferPriceBounds(
      (
        await db
          .prepare(`SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1`)
          .bind(input.playerId)
          .first<{ release_fee: number | null }>()
      )?.release_fee ?? null,
    );
    if (!bounds) throw new HttpError(400, '球员没有含违约金的现行合同，定不了最低报价');
    minOfferPrice = round2(input.minOfferPrice);
    if (minOfferPrice < bounds.min) throw new HttpError(400, `最低报价至少 ${bounds.min} m`);
    if (minOfferPrice > bounds.max) throw new HttpError(400, `最低报价 ${minOfferPrice} m 高于本球员的报价上限 ${bounds.max} m`);
  }
  if (input.transferListed && minOfferPrice === null) {
    throw new HttpError(400, '进转会名单必须给一条最低报价（达线自动同意，低于自动拒）');
  }

  // 非卖品 = 一切报价自动拒（设计 §2.1）：最低报价与开关被压掉；没线的开关存了也无效
  const effectiveMin = input.notForSale ? null : minOfferPrice;
  const effectiveAuto = input.notForSale || effectiveMin === null ? false : input.offerAuto;

  // 置非卖品 = 一切报价自动拒：把既有 pending 一并自动拒 + 释放冻结
  const wasNotForSale = p.not_for_sale === 1;
  const pendingBuyers = !wasNotForSale && input.notForSale
    ? await db
        .prepare(`SELECT DISTINCT buyer_club_id FROM offers WHERE player_id = ? AND status = 'pending'`)
        .bind(input.playerId)
        .all<{ buyer_club_id: number }>()
    : { results: [] as { buyer_club_id: number }[] };

  const audit = createAuditStatement(db);
  const statements = [
    db
      .prepare(
        `UPDATE players SET transfer_listed = ?, min_offer_price = ?, offer_auto = ?, not_for_sale = ?, updated_at = ${nowSql()}
         WHERE id = ? AND club_id = ? AND status = 'normal'`,
      )
      .bind(input.transferListed ? 1 : 0, effectiveMin, effectiveAuto ? 1 : 0, input.notForSale ? 1 : 0, input.playerId, input.clubId),
    audit({
      actor: input.actor,
      action: 'offer_settings',
      targetType: 'player',
      targetId: input.playerId,
      origin: 'user',
      after: {
        transferListed: input.transferListed,
        minOfferPrice: effectiveMin,
        offerAuto: effectiveAuto,
        notForSale: input.notForSale,
      },
    }),
  ];
  if (!wasNotForSale && input.notForSale) {
    statements.push(
      db
        .prepare(
          `UPDATE offers SET status = 'rejected', resolved_at = ${nowSql()}, updated_at = ${nowSql()} WHERE player_id = ? AND status = 'pending'`,
        )
        .bind(input.playerId),
      db
        .prepare(
          `UPDATE fund_holds SET status = 'released'
           WHERE ref_type = 'offer' AND ref_id IN (SELECT id FROM offers WHERE player_id = ? AND status = 'rejected')`,
        )
        .bind(input.playerId),
      db
        .prepare(
          `INSERT INTO offer_events (offer_id, actor_club_id, kind, amount, note, at)
           SELECT id, seller_club_id, 'reject', amount, '球员被设为非卖品', ${nowSql()}
           FROM offers WHERE player_id = ? AND status = 'rejected'`,
        )
        .bind(input.playerId),
    );
  }
  const results = await db.batch(statements);
  if ((results[0].meta.changes ?? 0) !== 1) throw new HttpError(409, '设置没落库：球员状态刚被改过，刷新再试');

  for (const row of pendingBuyers.results) {
    await queueClubNotification(env, row.buyer_club_id, 'offer_rejected', {
      player: p.name,
      amount: null,
      reason: 'not_for_sale',
    });
  }
  return { ok: true, transferListed: input.transferListed, minOfferPrice: effectiveMin, offerAuto: effectiveAuto, notForSale: input.notForSale };
}
