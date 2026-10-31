// 转会单据执行（TECH_DESIGN §6.4 不变式 2）：过户单点执行——只有 completed 的 transfer 单
// 触发过户（球员归属、合同、账本三方变更），幂等键 = transfer_id，失败可安全重试。
// 进入路径：① 解约类审核批准直接过户（§6.7 解约无谈判）；② 签约谈判成约时携带新合同
// 条款过户（成约即过户）。守卫覆盖 pending_review/signing 两态。
//
// 类型分支（§6.3）：
// - 归属变更（transfer/activation/forced_auction）：fee=成交价（货币），交易税按梯度
//   （强制拍卖整单 50% 特例），新合同带保护期（v3.0.0 窗刻度：3 个常规窗关窗）。
// - 本队留人（rc_change 续约/match 匹配）：fee=新违约金（非货币，附加费已在审核通过时收），
//   无划款无税，合同只改 RC/工资/成约方式并把保护期收口到当下（4.4.6/4.4.2.4，效力基数不动）。
// - 海捞（free_agent）：fee=新违约金（非货币），球员无现行合同 → 新合同 INSERT，
//   签入费已在审核通过时收。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { transferTax } from '../core/tax.ts';
import { protectionTicksFor, promotionSurcharge } from '../core/bypass-rules.ts';
import { closedRegularTicks } from './contract-ticks.ts';
import { round2 } from '../core/market-rules.ts';
import { ledgerMovement } from './ledger.ts';
import { loadMarketContext } from './market-context.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { growthResetStatements, recountBadgeStatements } from './growth.ts';
import { hookTierRecompute } from './growth-tier.ts';
import { voidDemandStatements } from './demand-ops.ts';
import { queueAllUserClubsNotification } from './notify.ts';
import { notifyShortlistWatchers } from './shortlist.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface ReviewDecision {
  taskId: number;
  decidedBy: number;
  decision: 'approved' | 'rejected';
  note?: string;
}

// 谈判成约携带的新合同条款（§6.7：wage=结算工资、releaseFee=新 RC、
// source=negotiation/forced/direct/trainee、contractType=正式或训练营）
export interface ContractTerms {
  wage: number;
  releaseFee: number;
  source: string;
  contractType: 'formal' | 'trainee';
}

export interface TransferRow {
  id: number;
  type: string;
  player_id: number;
  from_club_id: number | null;
  to_club_id: number | null;
  fee: number | null;
  extra_fee: number | null;
  status: string;
  season: number | null;
  window_seq: number | null;
  evidence: string | null;
  idempotency_key: string | null;
}

export async function loadTransfer(db: D1Database, transferId: number): Promise<TransferRow | null> {
  return db
    .prepare(
      `SELECT id, type, player_id, from_club_id, to_club_id, fee, extra_fee, status, season, window_seq, evidence, idempotency_key
       FROM transfers WHERE id = ?`,
    )
    .bind(transferId)
    .first<TransferRow>();
}

// 单据 evidence 列的 JSON 载荷（旁路单在提交时写入提交快照）
export function transferEvidence<T>(transfer: TransferRow): T | null {
  if (!transfer.evidence) return null;
  try {
    return JSON.parse(transfer.evidence) as T;
  } catch {
    return null;
  }
}

// listing:{id} 形态的幂等键反查挂牌（审核类 transfer 在截止结算时创建）
export function listingIdFromTransfer(transfer: TransferRow): number | null {
  const m = /^listing:(\d+)$/.exec(transfer.idempotency_key ?? '');
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// §5.4「回原队」判定（v6.54.0 步骤 5）：当作人没走过
// ---------------------------------------------------------------------------

/** 离开原队那次 transfer 行上留的合同三列（0079 新增；NULL = 该列当时无值，如无保护期） */
export interface ReturnClubSnapshot {
  serviceTicks: number | null;
  protectionTicks: number | null;
  signedAt: string | null;
}

export interface ReturnClubContext {
  /** 买方是球员历史效力并离开过的俱乐部（transfers 里存在「从该队离开」的已完成非留队单） */
  isReturn: boolean;
  /** 离开时点的合同快照（物理面延续的取值来源） */
  snapshot: ReturnClubSnapshot | null;
  /** 快照可用：src_service_ticks 非 NULL。0079 apply 之前的存量离开行三列全 NULL，无法恢复 ⇒ 回退常规重锚 */
  snapshotUsable: boolean;
  /** 本窗该球员对该队的 demand 行（任意状态）= A 分支判据；无行 = B 无纠葛买回 */
  sameWindowDemand: { id: number; status: string; resolution: string | null } | null;
}

/**
 * 买回原队判定（§5.4 回原队）：
 * - `isReturn` 的判据是「有从买方离开的记录」，不是「曾经入队过」——初始导入的归属没有入队
 *   transfer 行，靠 from_club_id 才覆盖得到；rc_change/match 是留队续约/匹配，不算离开。
 * - `sameWindowDemand` 决定分支：有行 = A（本窗额度已耗尽，跳过谈判纯回归）；无行 = B（可谈判、
 *   按续约基准、占本窗额度）。判据只看「本窗该队」，与 UNIQUE(player, season, window) 的
 *   全局一窗一条不冲突：全局唯一键保证同窗不会有第二行。
 */
export async function loadReturnClubContext(
  db: D1Database,
  playerId: number,
  toClubId: number | null,
  season: number | null | undefined,
  windowSeq: number | null | undefined,
  excludeTransferId?: number,
): Promise<ReturnClubContext> {
  const empty: ReturnClubContext = { isReturn: false, snapshot: null, snapshotUsable: false, sameWindowDemand: null };
  if (toClubId === null) return empty;
  const departure = await db
    .prepare(
      `SELECT src_service_ticks, src_protection_ticks, src_signed_at
       FROM transfers
       WHERE player_id = ? AND from_club_id = ? AND status = 'completed'
         AND type NOT IN ('rc_change','match')${excludeTransferId === undefined ? '' : ' AND id <> ?'}
       ORDER BY completed_at DESC, id DESC LIMIT 1`,
    )
    .bind(...(excludeTransferId === undefined ? [playerId, toClubId] : [playerId, toClubId, excludeTransferId]))
    .first<{ src_service_ticks: number | null; src_protection_ticks: number | null; src_signed_at: string | null }>();
  const sameWindowDemand =
    season !== null && season !== undefined && windowSeq !== null && windowSeq !== undefined
      ? await db
          .prepare(
            `SELECT id, status, resolution FROM contract_demands
             WHERE player_id = ? AND club_id = ? AND season = ? AND window_seq = ? LIMIT 1`,
          )
          .bind(playerId, toClubId, season, windowSeq)
          .first<{ id: number; status: string; resolution: string | null }>()
      : null;
  if (!departure) return { ...empty, sameWindowDemand };
  return {
    isReturn: true,
    snapshot: {
      serviceTicks: departure.src_service_ticks,
      protectionTicks: departure.src_protection_ticks,
      signedAt: departure.src_signed_at,
    },
    snapshotUsable: departure.src_service_ticks !== null,
    sameWindowDemand,
  };
}

/** 轻量判定（签约谈判侧只要一个是/否：买回前东家的 E 走续约基准） */
export async function isReturnToFormerClub(db: D1Database, playerId: number, toClubId: number | null): Promise<boolean> {
  if (toClubId === null) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM transfers
       WHERE player_id = ? AND from_club_id = ? AND status = 'completed'
         AND type NOT IN ('rc_change','match') LIMIT 1`,
    )
    .bind(playerId, toClubId)
    .first();
  return row !== null;
}

/**
 * 过户单点：按 transfer.type 分支（见文件头），transfer → completed、审核表记、审计，
 * 全部在一个 batch 里。每条挂「transfer 仍处 pending_review/signing」守卫，流水另有
 * (kind, ref=transferId) 幂等闸，重复调用整批空转（幂等，可安全重试）。
 */
export async function completeTransfer(
  env: Env,
  transferId: number,
  actor: number | null,
  origin: AuditOrigin,
  review?: ReviewDecision,
  terms?: ContractTerms,
): Promise<{ status: 'completed' | 'already' }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'completed') return { status: 'already' };
  if (transfer.status !== 'pending_review' && transfer.status !== 'signing') {
    throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能过户`);
  }
  if (transfer.to_club_id === null) throw new HttpError(409, '转会单缺签入方，数据不完整');

  // 本队留人（本队 = from = to）：续约 / 匹配 / 上调——不动归属、不记账本，合同按条款改写
  const amendment = transfer.type === 'rc_change' || transfer.type === 'match' || transfer.type === 'promotion';
  const freeAgent = transfer.type === 'free_agent';
  const ownership = !amendment && !freeAgent;
  if (ownership && transfer.fee === null) throw new HttpError(409, '转会单缺成交价，数据不完整');
  const listingId = listingIdFromTransfer(transfer);
  // 窗刻度（v3.0.0）：当下已关常规窗数 = 新合同的效力基数；保护期 = 基数 + 3 个常规窗
  const baseTicks = await closedRegularTicks(db);

  const ctx = await loadMarketContext(db);
  const contract = await db
    .prepare(
      'SELECT release_fee, wage, contract_type, service_ticks, protection_ticks, signed_at FROM contracts WHERE player_id = ? AND is_active = 1',
    )
    .bind(transfer.player_id)
    .first<{
      release_fee: number | null;
      wage: number | null;
      contract_type: string;
      service_ticks: number | null;
      protection_ticks: number | null;
      signed_at: string | null;
    }>();
  const rc = contract?.release_fee ?? 0;
  // 强制拍卖的卖方必须仍持有球员；若球员已被 bypass 解约（club_id NULL），本次成交仍可落到买方，
  // 但没有收款人，成交款全额销毁（不记 transfer_out / transfer_tax）。归属变成别队则直接拒绝，
  // 避免把别人的球员卖出去。v6.60.7：CPU 队球员按「无收款人」处理——CPU 一律不入账，
  // 球员仍从原 CPU 队摘出落到买方。
  const ownerRow = await db
    .prepare(
      `SELECT p.club_id, COALESCE(c.is_cpu, 0) AS owner_is_cpu
         FROM players p LEFT JOIN clubs c ON c.id = p.club_id
        WHERE p.id = ?`,
    )
    .bind(transfer.player_id)
    .first<{ club_id: number | null; owner_is_cpu: number }>();
  const sellerOwnsPlayer = transfer.from_club_id !== null && ownerRow?.club_id === transfer.from_club_id;
  const forcedUnowned = transfer.type === 'forced_auction' && ownerRow?.club_id === null;
  const forcedCpuSeller = transfer.type === 'forced_auction' && sellerOwnsPlayer && (ownerRow?.owner_is_cpu ?? 0) === 1;
  if (transfer.type === 'forced_auction' && !sellerOwnsPlayer && !forcedUnowned) {
    throw new HttpError(409, '球员归属已变更，强制拍卖单不能过户');
  }
  const saleFromClubId = sellerOwnsPlayer && !forcedCpuSeller ? transfer.from_club_id : null;
  // 球员实际从哪支球队摘出：CPU 卖方虽无收款，也要把球员从 CPU 队挪走。
  const moveFromClubId = saleFromClubId !== null ? saleFromClubId : forcedCpuSeller ? ownerRow?.club_id ?? null : null;
  const fee = ownership ? (transfer.fee as number) : 0;
  const tax = ownership && saleFromClubId !== null
    ? transfer.type === 'forced_auction'
      ? round2(fee * ctx.auctionTaxRate)
      : transferTax(fee, rc, ctx.taxRates)
    : 0;
  // 球员落位：带条款过户按新合同类型；不带条款（桥接）按现行合同类型还原；
  // 本队留人（续约/匹配）不动球员归属与状态；A 分支（见下）忽略 terms，按现行合同类型算。
  // §5.4 回原队（v6.54.0 步骤 5）：买回判据 + 离开时点快照 + 本窗 demand 行（A/B 分支）。
  // 海捞/训练营不适用（设计明列）：海捞是自由身重新签入（from_club_id 为空、无「离开某队」的
  // 快照语义），训练营走 0.75m / 5m 固定条款——两者都按常规通道，不沿用旧队效力/保护期。
  const contractTrainee = contract?.contract_type === 'trainee';
  const rawReturn =
    !amendment && !freeAgent && saleFromClubId !== null && !contractTrainee
      ? await loadReturnClubContext(db, transfer.player_id, transfer.to_club_id, transfer.season, transfer.window_seq, transferId)
      : null;
  const returnDemand = rawReturn?.sameWindowDemand ?? null;
  /** A 分支：本窗已闹过（demand 行存在）⇒ 跳过签约谈判、纯回归；terms（若有）一律忽略 */
  const pureReturn = returnDemand !== null;
  /** 实际生效的成约条款：A 分支吞掉 terms（工资/RC/类型按合同行现值带回） */
  const dealTerms = pureReturn ? undefined : terms;
  const returnCtx = dealTerms?.contractType === 'trainee' ? null : rawReturn;
  /** A 分支的非直拒终局（谈崩/低还价/过期）：买回要计一次 expired 入新段（§5.4 第 2 条） */
  const returnCountFinal =
    pureReturn && returnDemand !== null && returnDemand.resolution !== 'direct' && (returnDemand.status === 'rejected' || returnDemand.status === 'expired');
  const playerStatus = dealTerms
    ? dealTerms.contractType === 'trainee'
      ? 'trainee'
      : 'normal'
    : contract?.contract_type === 'trainee'
      ? 'trainee'
      : 'normal';

  const guard = { sql: `(SELECT status FROM transfers WHERE id = ?) IN ('pending_review', 'signing')`, params: [transferId] };
  const audit = createAuditStatement(db);
  // 离队要回收的中国计划徽章数（在 batch 外先读，批内只做减法）。
  // 只有「真的离开某支球队」才回收：转出方为空的海捞是签入（自由身球员无队可离），
  // 从 CPU 队摘人转出方不为空、照旧回收。留队续约/匹配（amendment）不动。
  const chinaPlaystyleCount =
    amendment || moveFromClubId === null
      ? 0
      : ((await db
          .prepare(`SELECT COUNT(*) AS n FROM player_playstyles WHERE player_id = ? AND source = 'china'`)
          .bind(transfer.player_id)
          .first<{ n: number }>())?.n ?? 0);
  const statements: D1PreparedStatement[] = [];
  if (ownership && listingId !== null) {
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
  if (ownership) {
    statements.push(
      ...ledgerMovement(db, {
        clubId: transfer.to_club_id,
        delta: -fee,
        kind: 'transfer_in',
        refType: 'transfer',
        refId: transferId,
        memo: '转会买人付款',
        guardSql: guard.sql,
        guardParams: guard.params,
      }),
    );
    if (saleFromClubId !== null) {
      statements.push(
        ...ledgerMovement(db, {
          clubId: saleFromClubId,
          delta: fee,
          kind: 'transfer_out',
          refType: 'transfer',
          refId: transferId,
          memo: '转会卖人收入',
          guardSql: guard.sql,
          guardParams: guard.params,
        }),
        ...(tax > 0
          ? ledgerMovement(db, {
              clubId: saleFromClubId,
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
  }
  if (!amendment) {
    // 球员归属变更（普通/激活/拍卖/海捞）；本队留人不动 players。
    // 号码随归属清空（v4.0.0）：球衣号是俱乐部的东西，换队后新东家重新定号，
    // 留着旧号会让「同队不重复」在两个队之间打架、也会把旧号带进新队的阵容表。
    // v6.64.2：旧东家的报价设置（转会名单 / 标价 / 最低报价 / 名单戳）一并清掉——换队后这些
    // 都属于上一家俱乐部，留着会让广告板把旧标价挂到新东家名下。
    statements.push(
      db
        .prepare(
          `UPDATE players SET club_id = ?, status = ?, number = NULL,
             transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
             not_for_sale = 0, transfer_listed_at = NULL,
             updated_at = ${nowSql()}
           WHERE id = ? AND (club_id IS ? OR club_id = ?)`,
        )
        .bind(transfer.to_club_id, playerStatus, transfer.player_id, moveFromClubId, moveFromClubId),
    );
    // 中国计划徽章随离队失效（§10）：明细行回收，台账按全量公式重算（v6.63.0：计数是派生值，
    // 不再增量减 —— 被这些行抑制的 FC 银槽同步回归）。重放时已无 china 行可删、DELETE 空转，整批仍然幂等。
    if (chinaPlaystyleCount > 0) {
      statements.push(
        db.prepare(`DELETE FROM player_playstyles WHERE player_id = ? AND source = 'china'`).bind(transfer.player_id),
        recountBadgeStatements(db, transfer.player_id),
      );
    }
    // 离开某队时把**被覆盖前**的合同三列快照进 transfer 行（§5.4 物理面延续，迁移 0079）。
    // 契约值是 completeTransfer 进城时读到的合同行现值：若该窗回滚/重放，整批按状态守卫空转，
    // 不会把改过的值再快照一次。快照只对真正离开（from 非空、非留队单）写——海捞 from 为空。
    if (moveFromClubId !== null) {
      statements.push(
        db
          .prepare(
            `UPDATE transfers SET src_service_ticks = ?, src_protection_ticks = ?, src_signed_at = ?
             WHERE id = ? AND ${guard.sql}`,
          )
          .bind(
            contract?.service_ticks ?? null,
            contract?.protection_ticks ?? null,
            contract?.signed_at ?? null,
            transferId,
            ...guard.params,
          ),
      );
    }
    // 离队作废（§5.4/§5.7）：demand → void、在途 pending → void、转会申请（含「不满」徽章）→ resolved。
    // 只对**真的离开某队**生效（from 非空）——海捞是自由身签入，没有队可离。
    // 必须排在 A 分支「重挂徽章」语句之前——否则同一批里的收口 UPDATE 会立刻把它 resolved。
    if (moveFromClubId !== null) {
      const voided = await voidDemandStatements(env, transfer.player_id, 'left_club');
      statements.push(...voided.statements);
    }
  }
  if (dealTerms && freeAgent) {
    // 海捞：落新合同（保护期按窗刻度，训练营无保护期）。contracts.player_id 全局唯一
    //（解约只是 is_active=0），复签走 ON CONFLICT UPSERT 把旧合同行整体翻新。
    // 免费续约机会（§5.6）：excluded 取 INSERT 默认 0——旧合同行（可能已用掉机会）撞车
    // 翻新时必须归 0，否则残留旧值。
    statements.push(
      db
        .prepare(
          `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from,
                                  service_ticks, protection_ticks, signed_season, signed_window_seq, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ${nowSql()}, strftime('%Y-%m-%d', 'now'), ?, ?, ?, ?, 1)
           ON CONFLICT(player_id) DO UPDATE SET
             club_id = excluded.club_id, release_fee = excluded.release_fee, wage = excluded.wage,
             contract_type = excluded.contract_type, source = excluded.source,
             signed_at = excluded.signed_at, effective_from = excluded.effective_from,
             service_ticks = excluded.service_ticks, protection_ticks = excluded.protection_ticks,
             signed_season = excluded.signed_season, signed_window_seq = excluded.signed_window_seq,
             free_rc_change_used = excluded.free_rc_change_used, is_active = 1`,
        )
        .bind(
          transfer.player_id,
          transfer.to_club_id,
          dealTerms.releaseFee,
          dealTerms.wage,
          dealTerms.contractType,
          dealTerms.source,
          baseTicks,
          protectionTicksFor(baseTicks, dealTerms.contractType),
          transfer.season,
          transfer.window_seq,
        ),
    );
  } else if (dealTerms && amendment && transfer.type === 'rc_change') {
    // 普通续约（rc_change）改关窗生效（v6.54.0 §5.7「所有合同变更（闹涨薪接受、普通续约改 RC）
    // 只写 contract_pending_changes」，既有行为变更①）：
    // ① contracts 在窗口关闭前**一字不动**——成约只写 pending，关窗批的
    //    applyPendingContractChanges 才把 wage/release_fee/protection_ticks 落库；
    // ② 4.4.6 收口语义保留、时点迁移：非免费续约 protection_ticks_new = baseTicks（当下窗数，
    //    判定恒不成立），**不得写 NULL**（写 NULL 会把「保护期直接结束」静默移除）；
    //    免费续约是唯一例外（§5.6 rev22）：evidence 未显式 false（true 或缺字段=0085 前在途单，
    //    上线后裁决按免费兜底）时写 NULL = 保护期该项不变
    //    （apply 侧 COALESCE 接住），apply 成功同批消耗 free_rc_change_used；
    // ③ 30% 续约费仍按既有 4.4.6 时点在审核通过时已收（bypass.chargeBypassFee，幂等闸 + 流水 + 审计；
    //    免费单审核侧跳过、extra_fee 为 NULL）——这里只把「已扣金额」记进 pending 的 rc_fee 供对账；
    //    rc_fee_charged_at 直接取那笔流水的 created_at（真实扣款时刻，不拿成约时刻冒充）；
    //    apply 不再扣款（§5.7 第 3 步）；
    // ④ 一球员同时最多 1 条 pending（0079 的部分唯一索引兜底）；createRcChange 已前置 409，
    //    这里再带 NOT EXISTS 守卫，并发/迟到行下宁可续约不落 pending 也不撞索引把整批弄崩。
    // 匹配（match）不在 §5.7 的枚举内，沿用 4.3.3 既有即时落库（见下面的 else 分支）。
    const rcFree = transferEvidence<{ freeRcChange?: boolean }>(transfer)?.freeRcChange !== false;
    statements.push(
      db
        .prepare(
          `INSERT INTO contract_pending_changes
             (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new,
              rc_fee, rc_fee_charged_at, free_rc_change, status, effective_window_seq)
           SELECT ?, ?, 'renewal', NULL, ?, ?, ?, ?,
                  (SELECT created_at FROM ledger_entries
                    WHERE kind = 'rc_change_fee' AND ref_type IS 'transfer' AND ref_id = ?),
                  ?, 'pending', ?
           WHERE ${guard.sql}
             AND NOT EXISTS (SELECT 1 FROM contract_pending_changes WHERE player_id = ? AND status = 'pending')`,
        )
        .bind(
          transfer.player_id,
          transfer.to_club_id,
          dealTerms.wage,
          dealTerms.releaseFee,
          rcFree ? null : baseTicks,
          transfer.extra_fee ?? 0,
          transferId,
          rcFree ? 1 : 0,
          transfer.window_seq ?? 0,
          ...guard.params,
          transfer.player_id,
        ),
      // source（成约方式）不属于 §5.7「关窗前不变」的三列（wage/release_fee/protection_ticks），
      // 保持既有即时更新：合同卡「来源」在谈成当下就该反映 negotiation，不必等关窗。
      db
        .prepare(`UPDATE contracts SET source = ? WHERE player_id = ? AND is_active = 1 AND club_id = ? AND ${guard.sql}`)
        .bind(dealTerms.source, transfer.player_id, transfer.to_club_id, ...guard.params),
    );
  } else if (dealTerms && amendment && transfer.type === 'promotion') {
    // 上调（v6.64.4）：训练营合同 → 正式合同即时落库（与 match 同口径，不进 §5.7 关窗生效）。
    // RC/工资按谈判结果；合同类型翻 formal、保护期按新签重锚（protectionTicksFor）、效力累计保留
    //（service_ticks 不动）、免费续约机会随新签刷新；球员随类型回一线队。
    // 附加费（F>15 的 (F−15)×0.3）在这里销毁——上调无审核步，成约即唯一扣费点；
    // 提交时已预检，成约时不做余额硬闸（与解约费同口径，不足扣成负 = 欠款）。
    const surcharge = promotionSurcharge(dealTerms.releaseFee);
    statements.push(
      db
        .prepare(
          `UPDATE contracts SET wage = ?, release_fee = ?, source = ?, contract_type = 'formal',
             protection_ticks = ?, free_rc_change_used = 0
           WHERE player_id = ? AND is_active = 1 AND club_id = ?`,
        )
        .bind(
          dealTerms.wage,
          dealTerms.releaseFee,
          dealTerms.source,
          protectionTicksFor(baseTicks, dealTerms.contractType),
          transfer.player_id,
          transfer.to_club_id,
        ),
      db
        .prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'trainee'`)
        .bind(transfer.player_id),
      db
        .prepare(`UPDATE transfers SET extra_fee = ? WHERE id = ? AND ${guard.sql}`)
        .bind(surcharge, transferId, ...guard.params),
      ...(surcharge > 0
        ? ledgerMovement(db, {
            clubId: transfer.to_club_id,
            delta: -surcharge,
            kind: 'promotion_fee',
            refType: 'transfer',
            refId: transferId,
            memo: `上调附加费（违约金 ${dealTerms.releaseFee}m 超 15m 部分 × 0.3，销毁）`,
            guardSql: guard.sql,
            guardParams: guard.params,
          })
        : []),
    );
  } else if (dealTerms && amendment) {
    // 匹配（match）：不在 §5.7 的枚举内（闹涨薪接受 / 普通续约改 RC），沿用既有即时落库——
    // 只改 RC/工资/成约方式，保护期到当下收口（4.4.6「保护期直接结束」），效力基数 service_ticks 不动。
    // v6.64.4：合同类型跟条款走、球员状态随类型翻——v6.64.3 起训练营合同也能被匹配留队
    //（「匹配之后为正式合同」），原实现只改数值不翻类型，成约后仍是 trainee 类型/trainee 态。
    statements.push(
      db
        .prepare(
          `UPDATE contracts SET wage = ?, release_fee = ?, source = ?, protection_ticks = ?, contract_type = ?
           WHERE player_id = ? AND is_active = 1 AND club_id = ?`,
        )
        .bind(
          dealTerms.wage,
          dealTerms.releaseFee,
          dealTerms.source,
          baseTicks,
          dealTerms.contractType,
          transfer.player_id,
          transfer.to_club_id,
        ),
    );
    statements.push(
      db
        .prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND status = 'trainee'`)
        .bind(transfer.player_id),
    );
  } else if (pureReturn && returnCtx !== null) {
    // A 分支（本窗已闹过涨薪）：跳过签约谈判、纯回归——工资 / RC / 合同类型按合同行**现值**带回
    //（别队期间涨幅对球员有效，买方没有压价口子），只恢复归属与物理面快照。
    // 快照可用时 signed_at 回到离开时点（「签约时刻一并回到离开时点」，§5.4 第 3 条）。
    const sets = ['club_id = ?'];
    const params: unknown[] = [transfer.to_club_id];
    if (returnCtx.snapshotUsable && returnCtx.snapshot !== null) {
      sets.push('service_ticks = ?', 'protection_ticks = ?', 'signed_at = ?');
      params.push(returnCtx.snapshot.serviceTicks ?? 0, returnCtx.snapshot.protectionTicks, returnCtx.snapshot.signedAt);
    }
    statements.push(
      db
        .prepare(`UPDATE contracts SET ${sets.join(', ')} WHERE player_id = ? AND is_active = 1 AND club_id IS ?`)
        .bind(...params, transfer.player_id, saleFromClubId),
    );
  } else if (dealTerms && saleFromClubId === null) {
    // 无归属球员（被 bypass 解约后仍在强制拍卖里成交）：没有可延续的现行合同，
    // 按谈判结果新签一份；成交款已在上面因 saleFromClubId=null 而不入任何俱乐部账，等同销毁。
    // 免费机会随新签归 0（同海捞 upsert 的 excluded 兜底，防旧行残留）。
    const protection = protectionTicksFor(baseTicks, dealTerms.contractType);
    statements.push(
      db
        .prepare(
          `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from,
                                  service_ticks, protection_ticks, signed_season, signed_window_seq, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ${nowSql()}, strftime('%Y-%m-%d', 'now'), ?, ?, ?, ?, 1)
           ON CONFLICT(player_id) DO UPDATE SET
             club_id = excluded.club_id, release_fee = excluded.release_fee, wage = excluded.wage,
             contract_type = excluded.contract_type, source = excluded.source,
             signed_at = excluded.signed_at, effective_from = excluded.effective_from,
             service_ticks = excluded.service_ticks, protection_ticks = excluded.protection_ticks,
             signed_season = excluded.signed_season, signed_window_seq = excluded.signed_window_seq,
             free_rc_change_used = excluded.free_rc_change_used, is_active = 1`,
        )
        .bind(
          transfer.player_id,
          transfer.to_club_id,
          dealTerms.releaseFee,
          dealTerms.wage,
          dealTerms.contractType,
          dealTerms.source,
          baseTicks,
          protection,
          transfer.season,
          transfer.window_seq,
        ),
    );
  } else if (dealTerms) {
    // 换队（含买回 B 分支）⇒ 合同按谈判结果写。物理面延续（§5.4 第 3 条）：效力基数/保护期取
    // 离开时点的快照，signed_at = now（B 分支是真新签，覆盖快照签约时刻）；非买回仍按窗刻度重锚。
    // 免费续约机会随换队刷新（§5.6 rev22「转会后刷新」）：UPDATE 不像 INSERT 有 DEFAULT 兜底，
    // 必须显式归 0，否则用过机会的球员换队后免费被旧合同行偷走（普通换队与 B 买回都走这条）。
    const serviceTicks = returnCtx?.snapshotUsable ? (returnCtx.snapshot?.serviceTicks ?? 0) : baseTicks;
    const protection = returnCtx?.snapshotUsable
      ? (returnCtx.snapshot?.protectionTicks ?? null)
      : protectionTicksFor(baseTicks, dealTerms.contractType);
    statements.push(
      db
        .prepare(
          `UPDATE contracts SET club_id = ?, wage = ?, release_fee = ?, source = ?, contract_type = ?,
             signed_at = ${nowSql()}, effective_from = strftime('%Y-%m-%d', 'now'),
             service_ticks = ?, protection_ticks = ?, signed_season = ?, signed_window_seq = ?,
             free_rc_change_used = 0
           WHERE player_id = ? AND is_active = 1 AND club_id IS ?`,
        )
        .bind(
          transfer.to_club_id,
          dealTerms.wage,
          dealTerms.releaseFee,
          dealTerms.source,
          dealTerms.contractType,
          serviceTicks,
          protection,
          transfer.season,
          transfer.window_seq,
          transfer.player_id,
          saleFromClubId,
        ),
    );
  } else if (!amendment) {
    if (returnCtx?.snapshotUsable) {
      // 无条款的买回桥接（直接调过户、成交不带新合同）：只换归属 + 恢复快照（不重锚）。
      // 免费机会不进快照（不是资产）、但换队即刷新（§5.6）——归 0 与带条款换队同口径。
      statements.push(
        db
          .prepare(
            `UPDATE contracts SET club_id = ?, service_ticks = ?, protection_ticks = ?, signed_at = ?,
               free_rc_change_used = 0
             WHERE player_id = ? AND is_active = 1 AND club_id IS ?`,
          )
          .bind(
            transfer.to_club_id,
            returnCtx.snapshot?.serviceTicks ?? 0,
            returnCtx.snapshot?.protectionTicks ?? null,
            returnCtx.snapshot?.signedAt ?? null,
            transfer.player_id,
            saleFromClubId,
          ),
      );
    } else {
      statements.push(
        db
          .prepare(
            `UPDATE contracts SET club_id = ?, free_rc_change_used = 0 WHERE player_id = ? AND is_active = 1 AND club_id IS ?`,
          )
          .bind(
            transfer.to_club_id,
            transfer.player_id,
            saleFromClubId,
          ),
      );
    }
  }
  // 回原队的后果与额度（§5.4「回原队」第 1/2 条）
  if (returnCtx?.isReturn && transfer.to_club_id !== null) {
    if (returnDemand !== null && returnDemand.resolution === 'direct') {
      // A 分支 · 原直拒 → 恢复直拒分支：徽章重挂（ON CONFLICT 把离队时 resolved 的行翻回 released）
      // + 保护期立即失效（v6.60.4 用户裁决：放行当场结束，不再写 rejection pending 等关窗）。
      // 价格两列按现行值 = 不动价格（防返潮断言 TC-RD-34 #1）。
      // **两条都挂 transfer 状态守卫**（与同批快照/账本/状态 UPDATE 同谓词，文件头「重复调用整批
      // 空转」的幂等契约）：并发重入/重试时，第一张单已 completed 的第二批会把其间被离队作废或
      // 关窗 apply 掉的状态翻回来——徽章变幽灵 released；保护期 UPDATE 也随守卫空转。
      statements.push(
        db
          .prepare(
            `INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status)
             SELECT ?, ?, ?, 'direct', 'released'
             WHERE ${guard.sql}
             ON CONFLICT(player_id, club_id, demand_id) DO UPDATE SET status = 'released', resolved_at = NULL`,
          )
          .bind(transfer.player_id, transfer.to_club_id, returnDemand.id, ...guard.params),
        db
          .prepare(
            `UPDATE contracts SET protection_ticks = 0
             WHERE player_id = ? AND is_active = 1 AND club_id = ? AND ${guard.sql}`,
          )
          .bind(transfer.player_id, transfer.to_club_id, ...guard.params),
      );
    } else if (returnDemand === null && transfer.season !== null && transfer.window_seq !== null) {
      // B 分支占用本窗额度（§5.4 第 1 条「此后本窗不能再闹涨薪/续约」）：本窗该球员在这一队
      // 没有 demand 行 ⇒ 放一条 void 占位行。载体只能是 contract_demands——同窗一次的两道守卫
      //（createRcChange 查本窗任意状态行；生成批的 UNIQUE(player, season, window) 幂等闸）都只认
      // 这张表。void 不参与段计数，也不进收件箱（listClubDemands 只查 pending/accepted/recent），
      // 对界面零可见；下一窗/下次换队自会换段。
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO contract_demands
               (player_id, club_id, season, window_seq, status, current_wage, expected_wage, target_wage,
                floor_wage, raise_pct, rc_current, rc_floor, rc_fee, round, expires_at, seed, void_reason)
             VALUES (?, ?, ?, ?, 'void', ?, ?, ?, ?, 0, ?, 0, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 0, 'return')`,
          )
          .bind(
            transfer.player_id,
            transfer.to_club_id,
            transfer.season,
            transfer.window_seq,
            contract?.wage ?? 0,
            contract?.wage ?? 0,
            contract?.wage ?? 0,
            contract?.wage ?? 0,
            contract?.release_fee ?? 0,
          ),
      );
    }
  }
  const statusStmtIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE transfers SET status = 'completed', tax = ?, completed_at = ${nowSql()} WHERE id = ? AND status IN ('pending_review', 'signing')`,
      )
      .bind(tax, transferId),
  );
  // A 分支 · 非直拒终局（谈崩/低还价/过期）→ 买回计一次 expired 入**新段**（§5.4 第 2 条）。
  // UNIQUE(player_id, season, window_seq) 不允许同窗第二行，故就地把原行重锚成 expired：
  // resolved_at 取本单 completed_at（必须排在状态 UPDATE 之后读同一批写好的值；段计数是
  // `at >= 段锚`，早一毫秒都不算）；void_reason 清空（挂牌驱赶的「不计终局」只管当时的挂牌，
  // 「被卖又被买回」这次折腾要计）。旧段计数不延续 = 段锚换成新 join 后旧终局自然落在锚前。
  if (returnCountFinal && returnDemand !== null) {
    statements.push(
      db
        .prepare(
          `UPDATE contract_demands SET status = 'expired', resolution = 'expired', resolved_by = 'system:return',
                  resolved_at = (SELECT completed_at FROM transfers WHERE id = ?), void_reason = NULL
           WHERE id = ? AND status IN ('rejected','expired')`,
        )
        .bind(transferId, returnDemand.id),
    );
  }
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
      origin,
      after: {
        fee: transfer.fee,
        tax,
        playerId: transfer.player_id,
        fromClubId: saleFromClubId,
        toClubId: transfer.to_club_id,
        ...(transfer.type === 'forced_auction' && saleFromClubId === null ? { proceedsDestroyed: true } : {}),
        ...(dealTerms ? { settleSource: dealTerms.source, contractType: dealTerms.contractType } : {}),
        ...(returnCtx?.isReturn
          ? {
              returnToFormerClub: true,
              returnBranch: pureReturn ? 'A' : 'B',
              returnDirectRestored: pureReturn && returnDemand?.resolution === 'direct',
              returnCountedFinal: returnCountFinal,
            }
          : {}),
      },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
  // A 分支 · 直拒恢复：全联盟通告重发（三件套之一）。批提交成功后才发——批回滚不留假通告；
  // 通告是尽力而为（queueAllUserClubsNotification 内部吞错），不会把已完成的过户报成失败。
  if (statusChange > 0 && pureReturn && returnDemand?.resolution === 'direct' && transfer.to_club_id !== null) {
    const [playerRow, clubRow] = await Promise.all([
      db.prepare('SELECT name FROM players WHERE id = ?').bind(transfer.player_id).first<{ name: string | null }>(),
      db.prepare('SELECT name FROM clubs WHERE id = ?').bind(transfer.to_club_id).first<{ name: string | null }>(),
    ]);
    await queueAllUserClubsNotification(env, 'demand_rejected_public', {
      demandId: returnDemand.id,
      playerId: transfer.player_id,
      player: playerRow?.name ?? `球员${transfer.player_id}`,
      club: clubRow?.name ?? `俱乐部${transfer.to_club_id}`,
      rc: rc > 0 ? rc : null,
    });
  }
  // 归属变更后重算档位（v6.48.0 §10.3）：c1（来源球队 = 队壳）与 c2（会籍 = 队壳国家）都锚在
  // club_id 上，换队即可能升/降。续约/匹配（amendment）不动归属，跳过；重放（statusChange = 0）不重算。
  if (statusChange > 0 && !amendment) {
    await hookTierRecompute(db, { kind: 'players', playerIds: [transfer.player_id] }, { actor, origin });
    // 候选名单「被签走」（v6.58.0）：五条成交路径全部收敛到本函数，故只挂这一处。
    // 买方 = 操作方；收藏者就是买方时不发（助手内排除）。
    await notifyShortlistWatchers(env, transfer.player_id, {
      type: 'sold',
      operatorClubId: transfer.to_club_id,
      fee: transfer.fee,
    });
  }
  return { status: statusChange > 0 ? 'completed' : 'already' };
}

/**
 * 解约过户（§6.3：解约无工资谈判，审核批准即 completed）：解约费销毁、球员去归属
 * （club_id=NULL/status=free）且属性恢复原始（CA 回 base_ca）、现行合同失效。
 * 整 batch 幂等：重放时各语句按守卫/状态空转。
 */
export async function completeTermination(
  env: Env,
  transferId: number,
  actor: number | null,
  origin: AuditOrigin,
  review?: ReviewDecision,
): Promise<{ status: 'completed' | 'already' }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.type !== 'termination') throw new HttpError(409, '这不是解约单');
  if (transfer.status === 'completed') return { status: 'already' };
  if (transfer.status !== 'pending_review' && transfer.status !== 'signing') {
    throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能过户`);
  }
  if (transfer.from_club_id === null) throw new HttpError(409, '解约单缺原属俱乐部，数据不完整');

  const fee = transfer.extra_fee ?? 0;
  const guard = { sql: `(SELECT status FROM transfers WHERE id = ?) IN ('pending_review', 'signing')`, params: [transferId] };
  const audit = createAuditStatement(db);
  // 解约也是离队（§5.4/§5.7、TC-RD-45 #4）：demand/在途 pending 作废、转会申请与「不满」徽章收口。
  // 与转会分支同一锚点——离队即段结束，pending 不再 apply。
  const voided = await voidDemandStatements(env, transfer.player_id, 'left_club');
  const statements: D1PreparedStatement[] = [
    ...voided.statements,
    // v6.64.4 解约冻结：提交时已冻结（fund_holds ref_type='termination'），这里消费冻结——
    // hold → settled 与扣款同批（守卫同谓词）；存量无 hold 的在途单（0088 前提交）照旧直接扣。
    ...(fee > 0
      ? [
          db
            .prepare(`UPDATE fund_holds SET status = 'settled' WHERE ref_type = 'termination' AND ref_id = ? AND status = 'held'`)
            .bind(transferId),
          ...ledgerMovement(db, {
            clubId: transfer.from_club_id,
            delta: -fee,
            kind: 'termination_fee',
            refType: 'transfer',
            refId: transferId,
            memo: '解约费（销毁）',
            guardSql: guard.sql,
            guardParams: guard.params,
          }),
        ]
      : []),
    // 属性恢复初始（4.4.4）：CA 回 base_ca；成长所得数值归零（XP/已消费级数）——
    // 解约即回初始态，重签后从零重新成长。历史留档：合同行只置 is_active=0、growth_events 一行不删，
    // 另写一条 reset 划断事件（见 growthResetStatements）供里程碑统计从解约后重新累计。
    // 重放安全：players UPDATE 有 club_id 闸，reset 事件靠 UNIQUE(player_id, match_ref, event_type) 去重。
    // v6.63.0：台账不再是「归零」——徽章明细全删后按全量公式重算，FC 自带的 PlayStyle 槽
    //（含被发放金抑制的银槽，金行随明细删除而回归）全额计入台账；只有发放所得清零。
    // v6.64.2：解约即离队，旧东家的挂牌设置一并清掉——transfer_listed 留着不清，广告板就会
    // 捞出「无东家的名单行」（clubName 为空，前端 TeamLogo 拿到 null 直接抛错白屏）。
    db
      .prepare(
        `UPDATE players SET club_id = NULL, status = 'free', number = NULL, ca = COALESCE(base_ca, ca),
           growth_xp = 0, levels_applied = 0,
           transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
           not_for_sale = 0, transfer_listed_at = NULL,
           updated_at = ${nowSql()}
         WHERE id = ? AND club_id = ?`,
      )
      .bind(transfer.player_id, transfer.from_club_id),
    db.prepare(`UPDATE contracts SET is_active = 0 WHERE player_id = ? AND is_active = 1`).bind(transfer.player_id),
    // 徽章明细一并归零（v3.3.0），台账随后按 FC 槽重算（v6.63.0：台账 = 派生值）
    db.prepare(`DELETE FROM player_playstyles WHERE player_id = ?`).bind(transfer.player_id),
    recountBadgeStatements(db, transfer.player_id),
    ...growthResetStatements(db, transfer.player_id, `termination:${transferId}`, transfer.season, transfer.window_seq),
  ];
  const statusStmtIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE transfers SET status = 'completed', tax = 0, completed_at = ${nowSql()} WHERE id = ? AND status IN ('pending_review', 'signing')`,
      )
      .bind(transferId),
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
      origin,
      after: { type: 'termination', fee, playerId: transfer.player_id, fromClubId: transfer.from_club_id },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
  // 去归属后重算档位（v6.48.0 §10.3）：club_id 归 NULL ⇒ c1/c2 记假（缺数据不猜），
  // 档位落到 1 + c3/c4/c5。重放（statusChange = 0）不重算。
  if (statusChange > 0) {
    await hookTierRecompute(db, { kind: 'players', playerIds: [transfer.player_id] }, { actor, origin });
    // 候选名单「解约变自由身」（v6.58.0）：操作方 = 原俱乐部；收藏者就是它时不发
    await notifyShortlistWatchers(env, transfer.player_id, { type: 'released', operatorClubId: transfer.from_club_id });
  }
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
  origin: AuditOrigin,
  review: ReviewDecision,
): Promise<{ status: 'rejected' | 'already' }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'rejected') return { status: 'already' };
  if (transfer.status !== 'pending_review') throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能驳回`);
  const listingId = listingIdFromTransfer(transfer);
  // 球员还原状态按合同类型：激活挂牌还原回训练营，普通挂牌还原回一线队
  const contract = await db
    .prepare('SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(transfer.player_id)
    .first<{ contract_type: string }>();
  const playerStatus = contract?.contract_type === 'trainee' ? 'trainee' : 'normal';

  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id IS ? AND status = 'held'`)
      .bind(listingId),
    // v6.64.4 解约冻结解冻：驳回时释放提交时冻结的解约费（其他单据类型没有这种 hold，空转）
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'termination' AND ref_id IS ? AND status = 'held'`)
      .bind(transferId),
    db
      .prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`)
      .bind(listingId),
    db
      .prepare(`UPDATE listings SET status = 'delisted', deadline_note = '审核驳回' WHERE id = ? AND status = 'pending_review'`)
      .bind(listingId),
    db
      .prepare(`UPDATE players SET status = ?, updated_at = ${nowSql()} WHERE id = ? AND status = 'listed'`)
      .bind(playerStatus, transfer.player_id),
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
      origin,
      after: { note: review.note ?? null, playerId: transfer.player_id },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
  return { status: statusChange > 0 ? 'rejected' : 'already' };
}
