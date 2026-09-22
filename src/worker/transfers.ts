// 转会单据执行（TECH_DESIGN §6.4 不变式 2）：过户单点执行——只有 completed 的 transfer 单
// 触发过户（球员归属、合同、账本三方变更），幂等键 = transfer_id，失败可安全重试。
// 进入路径：① 解约类审核批准直接过户（§6.7 解约无谈判）；② 签约谈判成约时携带新合同
// 条款过户（成约即过户）。守卫覆盖 pending_review/signing 两态。
//
// 类型分支（§6.3）：
// - 归属变更（transfer/activation/forced_auction）：fee=成交价（货币），交易税按梯度
//   （强制拍卖整单 50% 特例），新合同带保护期（增量 25 窗刻度：3 个常规窗关窗）。
// - 本队留人（rc_change 续约/match 匹配）：fee=新违约金（非货币，附加费已在审核通过时收），
//   无划款无税，合同只改 RC/工资/成约方式并把保护期收口到当下（4.4.6/4.4.2.4，效力基数不动）。
// - 海捞（free_agent）：fee=新违约金（非货币），球员无现行合同 → 新合同 INSERT，
//   签入费已在审核通过时收。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { transferTax } from '../core/tax.ts';
import { protectionTicksFor } from '../core/bypass-rules.ts';
import { closedRegularTicks } from './contract-ticks.ts';
import { round2 } from '../core/market-rules.ts';
import { ledgerMovement } from './ledger.ts';
import { loadMarketContext } from './market-context.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { growthResetStatements } from './growth.ts';

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

/**
 * 过户单点：按 transfer.type 分支（见文件头），transfer → completed、审核表记、审计，
 * 全部在一个 batch 里。每条挂「transfer 仍处 pending_review/signing」守卫，流水另有
 * (kind, ref=transferId) 幂等闸，重复调用整批空转（幂等，可安全重试）。
 */
export async function completeTransfer(
  env: Env,
  transferId: number,
  actor: number | null,
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

  const amendment = transfer.type === 'rc_change' || transfer.type === 'match';
  const freeAgent = transfer.type === 'free_agent';
  const ownership = !amendment && !freeAgent;
  if (ownership && transfer.fee === null) throw new HttpError(409, '转会单缺成交价，数据不完整');
  const listingId = listingIdFromTransfer(transfer);
  // 窗刻度（增量 25）：当下已关常规窗数 = 新合同的效力基数；保护期 = 基数 + 3 个常规窗
  const baseTicks = await closedRegularTicks(db);

  const ctx = await loadMarketContext(db);
  const contract = await db
    .prepare('SELECT release_fee, contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(transfer.player_id)
    .first<{ release_fee: number | null; contract_type: string }>();
  const rc = contract?.release_fee ?? 0;
  const fee = ownership ? (transfer.fee as number) : 0;
  const tax = ownership
    ? transfer.type === 'forced_auction'
      ? round2(fee * ctx.auctionTaxRate)
      : transferTax(fee, rc, ctx.taxRates)
    : 0;
  // 球员落位：带条款过户按新合同类型；不带条款（桥接）按现行合同类型还原；
  // 本队留人（续约/匹配）不动球员归属与状态。
  const playerStatus = terms
    ? terms.contractType === 'trainee'
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
    amendment || transfer.from_club_id === null
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
    if (transfer.from_club_id !== null) {
      statements.push(
        ...ledgerMovement(db, {
          clubId: transfer.from_club_id,
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
  }
  if (!amendment) {
    // 球员归属变更（普通/激活/拍卖/海捞）；本队留人不动 players
    statements.push(
      db
        .prepare(
          `UPDATE players SET club_id = ?, status = ?, updated_at = ${nowSql()}
           WHERE id = ? AND (club_id IS ? OR club_id = ?)`,
        )
        .bind(transfer.to_club_id, playerStatus, transfer.player_id, transfer.from_club_id, transfer.from_club_id),
    );
    // 中国计划徽章随离队失效（§10）：明细行回收，台账计数同步减。计数在 batch 外先读出来，
    // 免得依赖批内语句顺序；重放时已无 china 行可减、DELETE 空转，整批仍然幂等。
    if (chinaPlaystyleCount > 0) {
      statements.push(
        db
          .prepare(`UPDATE players SET badges_silver = MAX(0, badges_silver - ?), updated_at = ${nowSql()} WHERE id = ?`)
          .bind(chinaPlaystyleCount, transfer.player_id),
        db.prepare(`DELETE FROM player_playstyles WHERE player_id = ? AND source = 'china'`).bind(transfer.player_id),
      );
    }
  }
  if (terms && freeAgent) {
    // 海捞：落新合同（保护期按窗刻度，训练营无保护期）。contracts.player_id 全局唯一
    //（解约只是 is_active=0），复签走 ON CONFLICT UPSERT 把旧合同行整体翻新
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
             signed_season = excluded.signed_season, signed_window_seq = excluded.signed_window_seq, is_active = 1`,
        )
        .bind(
          transfer.player_id,
          transfer.to_club_id,
          terms.releaseFee,
          terms.wage,
          terms.contractType,
          terms.source,
          baseTicks,
          protectionTicksFor(baseTicks, terms.contractType),
          transfer.season,
          transfer.window_seq,
        ),
    );
  } else if (terms && amendment) {
    // 续约/匹配：只改 RC/工资/成约方式，保护期到当下收口（4.4.6「保护期直接结束」）——
    // 把 protection_ticks 设为当前窗数，判定恒不成立；效力基数 service_ticks 不动
    statements.push(
      db
        .prepare(
          `UPDATE contracts SET wage = ?, release_fee = ?, source = ?, protection_ticks = ?
           WHERE player_id = ? AND is_active = 1 AND club_id = ?`,
        )
        .bind(terms.wage, terms.releaseFee, terms.source, baseTicks, transfer.player_id, transfer.to_club_id),
    );
  } else if (terms) {
    statements.push(
      db
        .prepare(
          `UPDATE contracts SET club_id = ?, wage = ?, release_fee = ?, source = ?, contract_type = ?,
             signed_at = ${nowSql()}, effective_from = strftime('%Y-%m-%d', 'now'),
             service_ticks = ?, protection_ticks = ?, signed_season = ?, signed_window_seq = ?
           WHERE player_id = ? AND is_active = 1 AND club_id IS ?`,
        )
        .bind(
          transfer.to_club_id,
          terms.wage,
          terms.releaseFee,
          terms.source,
          terms.contractType,
          baseTicks,
          protectionTicksFor(baseTicks, terms.contractType),
          transfer.season,
          transfer.window_seq,
          transfer.player_id,
          transfer.from_club_id,
        ),
    );
  } else if (!amendment) {
    statements.push(
      db.prepare(`UPDATE contracts SET club_id = ? WHERE player_id = ? AND is_active = 1 AND club_id IS ?`).bind(
        transfer.to_club_id,
        transfer.player_id,
        transfer.from_club_id,
      ),
    );
  }
  const statusStmtIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE transfers SET status = 'completed', tax = ?, completed_at = ${nowSql()} WHERE id = ? AND status IN ('pending_review', 'signing')`,
      )
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
      after: {
        fee: transfer.fee,
        tax,
        playerId: transfer.player_id,
        fromClubId: transfer.from_club_id,
        toClubId: transfer.to_club_id,
        ...(terms ? { settleSource: terms.source, contractType: terms.contractType } : {}),
      },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
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
  const statements: D1PreparedStatement[] = [
    ...(fee > 0
      ? ledgerMovement(db, {
          clubId: transfer.from_club_id,
          delta: -fee,
          kind: 'termination_fee',
          refType: 'transfer',
          refId: transferId,
          memo: '解约费（销毁）',
          guardSql: guard.sql,
          guardParams: guard.params,
        })
      : []),
    // 属性恢复初始（4.4.4）：CA 回 base_ca；成长所得同时数值归零（XP/已消费级数/徽章）——
    // 解约即回初始态，重签后从零重新成长。历史留档：合同行只置 is_active=0、growth_events 一行不删，
    // 另写一条 reset 划断事件（见 growthResetStatements）供里程碑统计从解约后重新累计。
    // 重放安全：players UPDATE 有 club_id 闸，reset 事件靠 UNIQUE(player_id, match_ref, event_type) 去重。
    db
      .prepare(
        `UPDATE players SET club_id = NULL, status = 'free', ca = COALESCE(base_ca, ca),
           growth_xp = 0, levels_applied = 0, badges_silver = 0, badges_gold = 0, updated_at = ${nowSql()}
         WHERE id = ? AND club_id = ?`,
      )
      .bind(transfer.player_id, transfer.from_club_id),
    db.prepare(`UPDATE contracts SET is_active = 0 WHERE player_id = ? AND is_active = 1`).bind(transfer.player_id),
    // 徽章明细一并归零（增量 30：台账在上一句已清零，明细表不能留残行，否则重签后又漂回两个口径）
    db.prepare(`DELETE FROM player_playstyles WHERE player_id = ?`).bind(transfer.player_id),
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
      after: { type: 'termination', fee, playerId: transfer.player_id, fromClubId: transfer.from_club_id },
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
      after: { note: review.note ?? null, playerId: transfer.player_id },
    }),
  );
  const results = await db.batch(statements);
  const statusChange = results[statusStmtIndex]?.meta.changes ?? 0;
  return { status: statusChange > 0 ? 'rejected' : 'already' };
}
