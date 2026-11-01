// 交易撤销（v6.66.0 第 3 期，design §4）。
//
// 顺序翻转之后，审核通过即完成扣款与归属变更，所以「作废签约谈判」这套动作失效了：
// 人已经在买方队里，谈崩也不能把他抢回来。取而代之的是**撤销**——管理员显式把一笔
// 已结算的交易整个回滚：买方的钱退回、卖方的钱收回、球员按过户前快照回到原处、
// 合同按快照还原、单据落 reverted。
//
// 三条硬闸（design §4.1）：
//   1) 单据必须是 completed（未结算的单仍走 voidSigningCore，不动归属）；
//   2) 必须还在窗内——关窗后工资/富人税已按最终归属结算，回滚会让账目对不上；
//   3) 该球员此后不能有新成交单（后来的交易已经建立在「他在这儿」之上，不能抽梯子）。
//
// 钱的写法与 completeTransfer 对称：买方 -fee / 卖方 +fee、-tax，撤回就是买方 +fee、
// 卖方 -fee。交易税**不退**（已销毁），所以卖方被收回的是全额 fee，税由卖方承担。
// 附加费（续约费/签入费/上调附加费）同样不退——那是已经发生的服务，不是交易本金。

import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { ledgerMovement } from './ledger.ts';
import { currentWindow } from './contract-ticks.ts';
import { loadTransfer, parsePreSettleSnapshot } from './transfers.ts';
import { hookTierRecompute } from './growth-tier.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface RevertResult {
  status: 'reverted' | 'already';
}

export async function revertDeal(
  env: Env,
  transferId: number,
  actor: number | null,
  reason: string,
): Promise<RevertResult> {
  const db = env.DB;
  const trimmed = reason.trim();
  if (trimmed === '') throw new HttpError(400, '撤销必须写明理由');

  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'reverted') return { status: 'already' };
  if (transfer.status !== 'completed') {
    throw new HttpError(409, `转会单当前状态是 ${transfer.status}，只有已结算的交易才能撤销`);
  }

  const window = await currentWindow(db);
  if (!window) throw new HttpError(409, '窗口已关闭，工资与税费已按最终归属结算，不能再撤销这笔交易');

  const later = await db
    .prepare(`SELECT id FROM transfers WHERE player_id = ? AND id > ? AND status = 'completed' LIMIT 1`)
    .bind(transfer.player_id, transfer.id)
    .first<{ id: number }>();
  if (later) throw new HttpError(409, '这名球员之后还有一笔已成交的交易，先撤销后面那笔');

  const snapshot = parsePreSettleSnapshot(transfer);
  if (!snapshot) throw new HttpError(409, '这笔交易没有过户前快照（v6.66.0 之前的历史单），无法撤销');

  const amendment = transfer.type === 'rc_change' || transfer.type === 'match' || transfer.type === 'promotion';
  const freeAgent = transfer.type === 'free_agent';
  const ownership = !amendment && !freeAgent;
  const fee = ownership ? (snapshot.fee ?? 0) : 0;
  const sellerClubId = snapshot.saleFromClubId;

  const buyerClubId = transfer.to_club_id;
  if (buyerClubId === null) throw new HttpError(409, '这笔交易没有买方，无法撤销');
  const guard = { sql: `(SELECT status FROM transfers WHERE id = ?) = 'completed'`, params: [transferId] };
  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];

  if (fee > 0) {
    statements.push(
      ...ledgerMovement(db, {
        clubId: buyerClubId,
        delta: fee,
        kind: 'transfer_refund',
        refType: 'transfer',
        refId: transferId,
        memo: '撤销交易：买人款退回',
        guardSql: guard.sql,
        guardParams: guard.params,
      }),
    );
    if (sellerClubId !== null) {
      statements.push(
        ...ledgerMovement(db, {
          clubId: sellerClubId,
          delta: -fee,
          kind: 'transfer_clawback',
          refType: 'transfer',
          refId: transferId,
          memo: '撤销交易：卖人款收回（交易税不退）',
          guardSql: guard.sql,
          guardParams: guard.params,
        }),
      );
    }
  }

  // 会话还没谈定就撤销：直接关掉，不留一个挂在已撤销单据上的活会话。
  statements.push(
    db
      .prepare(`UPDATE negotiation_sessions SET status = 'cancelled', settled_at = ${nowSql()} WHERE transfer_id = ? AND status = 'active'`)
      .bind(transferId),
  );

  // 归属一律按快照还原：换队类回卖方、自由身签入回「无东家」、留人类（续约/匹配/上调）
  // 快照里就是现东家，写上等于没动——不按 ownership 分家，免得自由身撤销把人留在买方。
  statements.push(
    db
      .prepare(`UPDATE players SET club_id = ?, status = ? WHERE id = ?`)
      .bind(snapshot.player.club_id, snapshot.player.status, transfer.player_id),
  );

  // 合同按快照还原：过户前没有合同行（真自由身签入）就把签入造出来的那行删掉。
  const c = snapshot.contract;
  if (c) {
    statements.push(
      db
        .prepare(
          `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, signed_season, signed_window_seq,
                                  service_ticks, protection_ticks, free_rc_change_used, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET
             club_id = excluded.club_id, release_fee = excluded.release_fee, wage = excluded.wage,
             contract_type = excluded.contract_type, source = excluded.source, signed_at = excluded.signed_at,
             signed_season = excluded.signed_season, signed_window_seq = excluded.signed_window_seq,
             service_ticks = excluded.service_ticks, protection_ticks = excluded.protection_ticks,
             free_rc_change_used = excluded.free_rc_change_used, is_active = excluded.is_active`,
        )
        .bind(
          transfer.player_id,
          c.club_id,
          c.release_fee,
          c.wage,
          c.contract_type,
          c.source,
          c.signed_at,
          c.signed_season,
          c.signed_window_seq,
          c.service_ticks,
          c.protection_ticks,
          c.free_rc_change_used,
          c.is_active,
        ),
    );
  } else {
    statements.push(db.prepare(`DELETE FROM contracts WHERE player_id = ?`).bind(transfer.player_id));
  }

  statements.push(
    db
      .prepare(`UPDATE transfers SET status = 'reverted', reverted_at = ${nowSql()}, revert_reason = ? WHERE id = ? AND status = 'completed'`)
      .bind(trimmed, transferId),
    audit({
      actor,
      action: 'transfer_revert',
      targetType: 'transfer',
      targetId: transferId,
      origin: 'user',
      before: { status: transfer.status, termsApplied: transfer.terms_applied, fee, tax: snapshot.tax },
      after: { status: 'reverted', reason: trimmed, playerId: transfer.player_id, toClubId: transfer.to_club_id, sellerClubId },
    }),
  );

  const results = await db.batch(statements);
  const statusChange = results[results.length - 2]?.meta.changes ?? 0;
  if (statusChange === 0) return { status: 'already' };
  // 归属回滚也动了 players.club_id：c1/c2 档位必须跟着新（旧）东家重算（§10.3 挂钩清单）。
  if (ownership || freeAgent) await hookTierRecompute(db, { kind: 'players', playerIds: [transfer.player_id] }, { actor, origin: 'user' });
  return { status: 'reverted' };
}
