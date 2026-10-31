// 上调 / 下放（v6.64.4，规则 4.3.4 名单段 × 合同类型双向挂钩）：
// 下放 = 正式合同一线队球员即时转训练营条款（5m / 0.75m），每窗每队 2 个名额（4.3.4(3) 首个实现消费者）；
// 上调 = 训练营球员开签约谈判谈正式合同（type='promotion'，from=to=本队、无转会费无审核），
//   F ∈ [1,15] 免费、超出部分付 (F−15)×0.3 销毁（提交预检、成约收取）；练满达成自动开/预约。
// 名单与合同类型的双向校验在 core/squad-rules.ts（注册提交硬拦）；本模块负责即时转换动作。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { TRAINEE_WAGE, TRAINEE_RC } from '../core/squad-rules.ts';
import { getOpenWindow } from './seasons.ts';
import { assertOpOpen } from './ops-schedule.ts';
import { ensureNotInFlight } from './bypass.ts';
import { createAuditStatement } from '../lib/audit.ts';

function nowSql() {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
}

// 每窗每队下放名额（规则 4.3.4(3)）。载体 = transfers type='demote' 的 completed 行（club+窗计数），
// 兼作球员「转会记录」履历，无需新表。
export const DEMOTE_QUOTA_PER_WINDOW = 2;

// 上调违约金免费上限：F ≤ 15 免费，超出部分付 (F−15)×0.3 销毁（用户裁决 2026-10-31）
export const PROMOTION_FREE_RC = 15;
export const PROMOTION_SURCHARGE_RATE = 0.3;

export function promotionSurcharge(fee: number): number {
  if (fee <= PROMOTION_FREE_RC) return 0;
  return Math.round((fee - PROMOTION_FREE_RC) * PROMOTION_SURCHARGE_RATE * 100) / 100;
}

interface OwnPlayerRow {
  id: number;
  name: string;
  display_name: string | null;
  club_id: number | null;
  status: string;
  ca: number | null;
  pa: number | null;
  growable: number | null;
}

// 该球员有没有进行中的签约谈判（active 会话 + signing 单据）。下调/解约/激活都必须躲开
// 上调谈判期（合同正在被改写），与 createRcChange 的同款检查同口径。
async function rejectIfNegotiating(db: Env['DB'], playerId: number): Promise<void> {
  const open = await db
    .prepare(
      `SELECT s.id FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
       WHERE s.player_id = ? AND s.status = 'active' AND t.status = 'signing' LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
  if (open) throw new HttpError(409, '他还有一场签约谈判没结束，先等它了结再操作');
}

// ---- 下放：正式合同 → 训练营条款（即时生效，无审核无谈判） ----

export interface DemoteResult {
  ok: true;
  playerId: number;
  transferId: number;
  releaseFee: number;
  wage: number;
}

export async function demotePlayer(env: Env, clubId: number, actor: number, playerIdInput: unknown): Promise<DemoteResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能下放', 'no_window');
  // v6.64.4 运营时刻表：上调/下放自己的时段（默认随窗全窗）
  await assertOpOpen(db, 'transfer_promotion');

  const player = await db
    .prepare('SELECT id, name, display_name, club_id, status, ca, pa, growable FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== clubId) throw new HttpError(400, '只能下放自己队里的球员');
  if (player.status !== 'normal') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员在挂牌流程里，不能下放' : '当前状态不能下放');
  }
  const contract = await db
    .prepare('SELECT release_fee, contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; contract_type: string }>();
  if (!contract || contract.release_fee === null || contract.release_fee <= 0) {
    throw new HttpError(409, '球员没有含违约金的现行合同，先让管理组补合同');
  }
  if (contract.contract_type === 'trainee') {
    throw new HttpError(400, '训练营合同的球员已经在训练营了');
  }
  // 训练营名单资格对称（trainee_growth 同口径）：练满 / 非成长球员不可下放——下放后既进不了
  // 训练营名单也回不去一线队名单（S10 注册双向校验会硬拦），宁可在入口拦。
  if (player.growable !== 1 || player.pa === null || player.ca === null || player.pa - player.ca <= 0) {
    throw new HttpError(400, '练满球员不能下放：训练营只收可成长（PA−CA＞0）的球员');
  }
  // 本窗经匹配留队的球员当窗不可下放（事件判据：transfers type='match' completed 落本窗；次窗恢复）
  const matchedThisWindow = await db
    .prepare(
      `SELECT id FROM transfers WHERE player_id = ? AND type = 'match' AND status = 'completed'
         AND season = ? AND window_seq = ? LIMIT 1`,
    )
    .bind(playerId, win.season, win.windowSeq)
    .first<{ id: number }>();
  if (matchedThisWindow) throw new HttpError(409, '本窗刚经匹配留队的球员不能下放，下窗再操作');
  // 名额（4.3.4(3)：每窗 2 名，含已被再上调走的——名额按事件计不退）
  const used = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM transfers
       WHERE type = 'demote' AND from_club_id = ? AND season = ? AND window_seq = ? AND status = 'completed'`,
    )
    .bind(clubId, win.season, win.windowSeq)
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= DEMOTE_QUOTA_PER_WINDOW) {
    throw new HttpError(409, `本窗下放名额（${DEMOTE_QUOTA_PER_WINDOW} 名）已用完，下窗再操作`);
  }
  await ensureNotInFlight(db, playerId);
  await rejectIfNegotiating(db, playerId);

  const audit = createAuditStatement(db);
  // 全批挂「仍是一线队 normal」同一谓词：并发下先到者赢，后到者整批空转（INSERT 0 行 → 409）。
  const guard = `(SELECT status FROM players WHERE id = ${playerId}) = 'normal' AND (SELECT club_id FROM players WHERE id = ${playerId}) = ${clubId}`;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, tax, extra_fee, status, season, window_seq, idempotency_key, evidence, created_at, completed_at)
         SELECT 'demote', ?, ?, ?, 0, 0, 0, 'completed', ?, ?, ?, ?, ${nowSql()}, ${nowSql()}
         WHERE ${guard}`,
      )
      .bind(
        playerId,
        clubId,
        clubId,
        win.season,
        win.windowSeq,
        `demote:${playerId}:${win.season}:${win.windowSeq}`,
        JSON.stringify({ oldReleaseFee: contract.release_fee, servicePreserved: true, windowKey: `${win.season}:${win.windowSeq}` }),
      ),
    audit({
      actor,
      action: 'player_demote',
      targetType: 'player',
      targetId: playerId,
      origin: 'user',
      after: { clubId, oldReleaseFee: contract.release_fee, releaseFee: TRAINEE_RC, wage: TRAINEE_WAGE, season: win.season, windowSeq: win.windowSeq },
      guardSql: guard,
    }),
    db
      .prepare(
        `UPDATE contracts SET contract_type = 'trainee', release_fee = ?, wage = ?, source = 'demote',
            protection_ticks = NULL, free_rc_change_used = 0
         WHERE player_id = ? AND is_active = 1 AND club_id = ? AND contract_type != 'trainee'`,
      )
      .bind(TRAINEE_RC, TRAINEE_WAGE, playerId, clubId),
    db
      .prepare(`UPDATE players SET status = 'trainee', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`)
      .bind(playerId, clubId),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw new HttpError(409, '球员状态刚发生变化，下放没有生效，请刷新后重试');
  }
  return { ok: true, playerId, transferId: Number(results[2].meta.last_row_id), releaseFee: TRAINEE_RC, wage: TRAINEE_WAGE };
}
