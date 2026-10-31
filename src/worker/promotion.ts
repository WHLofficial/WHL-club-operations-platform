// 上调 / 下放（v6.64.4，规则 4.3.4 名单段 × 合同类型双向挂钩）：
// 下放 = 正式合同一线队球员即时转训练营条款（5m / 0.75m），每窗每队 2 个名额（4.3.4(3) 首个实现消费者）；
// 上调 = 训练营球员开签约谈判谈正式合同（type='promotion'，from=to=本队、无转会费无审核），
//   F ∈ [1,15] 免费、超出部分付 (F−15)×0.3 销毁（提交预检、成约收取）；练满达成自动开/预约。
// 名单与合同类型的双向校验在 core/squad-rules.ts（注册提交硬拦）；本模块负责转换与谈判动作。
import type { Env } from './env.ts';
import type { AuditOrigin } from '../lib/audit.ts';
import { HttpError } from '../lib/http.ts';
import { TRAINEE_WAGE, TRAINEE_RC } from '../core/squad-rules.ts';
import { promotionSurcharge, PROMOTION_FREE_RC } from '../core/bypass-rules.ts';
import { round2 } from '../core/market-rules.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { getOpenWindow } from './seasons.ts';
import { assertOpOpen, opBlockReason } from './ops-schedule.ts';
import { ensureNotInFlight } from './bypass.ts';
import { openNegotiationSession } from './negotiations.ts';
import { availableBalance } from './ledger.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { queueClubNotification } from './notify.ts';

function nowSql() {
  return `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
}

// 每窗每队下放名额（规则 4.3.4(3)）。载体 = transfers type='demote' 的 completed 行（club+窗计数），
// 兼作球员「转会记录」履历，无需新表。
export const DEMOTE_QUOTA_PER_WINDOW = 2;

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

// 该球员有没有进行中的签约谈判（active 会话 + signing 单据）。下放/解约/激活都必须躲开
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
  // 同窗同员二次下放拦在入口：名额载体行的幂等键 `demote:{pid}:{窗}` 是 UNIQUE——被再上调回
  // 一线队的球员当窗再下放会撞键打成 500，这里给可读 409（次窗键换段自然放行）。
  const demotedThisWindow = await db
    .prepare(
      `SELECT id FROM transfers WHERE player_id = ? AND type = 'demote' AND status = 'completed'
         AND season = ? AND window_seq = ? LIMIT 1`,
    )
    .bind(playerId, win.season, win.windowSeq)
    .first<{ id: number }>();
  if (demotedThisWindow) throw new HttpError(409, '他本窗已经下放过一次（含被再上调回的情形），下窗再操作');
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
  // 顺序硬约束（同 offers.ts 建单同款坑）：履约 INSERT 与审计必须排在两个 UPDATE 之前——
  // 同批内先改后查，守卫会读到改后状态恒假、整批空转。
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
  return { ok: true, playerId, transferId: Number(results[0].meta.last_row_id), releaseFee: TRAINEE_RC, wage: TRAINEE_WAGE };
}

// ---- 上调：训练营球员开签约谈判谈正式合同（type='promotion'） ----

export interface PromotionResult {
  ok: true;
  transferId: number;
  sessionId: number;
  releaseFee: number;
  surcharge: number;
  expectedWage?: number;
}

// 建上调单（pending_review）+ 审计；开会由调用方跟一批（崩溃孤儿由 openReservedPromotions 兜底）。
async function createPromotionTransfer(
  env: Env,
  opts: { actor: number | null; clubId: number; playerId: number; playerName: string; releaseFee: number; surcharge: number; win: { season: number; windowSeq: number }; origin: AuditOrigin; auto: boolean },
): Promise<number> {
  const db = env.DB;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, evidence, created_at)
         VALUES ('promotion', ?, ?, ?, 0, 'pending_review', ?, ?, ?, ${nowSql()})`,
      )
      .bind(
        opts.playerId,
        opts.clubId,
        opts.clubId,
        opts.win.season,
        opts.win.windowSeq,
        JSON.stringify({ releaseFee: opts.releaseFee, surcharge: opts.surcharge, auto: opts.auto, windowKey: `${opts.win.season}:${opts.win.windowSeq}` }),
      ),
  ]);
  const transferId = Number(results[0].meta.last_row_id);
  const audit = createAuditStatement(db);
  await db.batch([
    audit({
      actor: opts.actor,
      action: 'promotion_open',
      targetType: 'transfer',
      targetId: transferId,
      origin: opts.origin,
      after: { playerId: opts.playerId, clubId: opts.clubId, releaseFee: opts.releaseFee, surcharge: opts.surcharge, auto: opts.auto },
    }),
  ]);
  return transferId;
}

export async function promotePlayer(
  env: Env,
  clubId: number,
  actor: number,
  playerIdInput: unknown,
  feeInput: unknown,
): Promise<PromotionResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  const fee = Number(feeInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isInteger(fee) || fee <= 0) throw new HttpError(400, '新违约金须为正整数（单位 m）');

  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能上调', 'no_window');
  await assertOpOpen(db, 'transfer_promotion');

  const player = await db
    .prepare('SELECT id, name, display_name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== clubId) throw new HttpError(400, '只能上调自己队里的球员');
  if (player.status !== 'trainee') {
    throw new HttpError(400, player.status === 'normal' ? '这名球员已经在一线队了' : '当前状态不能上调');
  }
  const contract = await db
    .prepare('SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ contract_type: string }>();
  if (!contract || contract.contract_type !== 'trainee') {
    throw new HttpError(409, '上调只认训练营合同的球员，数据不完整先找管理组补合同');
  }
  await ensureNotInFlight(db, playerId);
  await rejectIfNegotiating(db, playerId);

  const surcharge = promotionSurcharge(fee);
  if (surcharge > 0) {
    const available = await availableBalance(db, clubId);
    if (round2(available) < surcharge) {
      throw new HttpError(
        400,
        `可用资金不足：上调附加费要 ${surcharge} m（违约金 ${fee}m 超出 15m 部分 × 0.3，成约时销毁），当前可支配 ${round2(available)} m`,
      );
    }
  }

  const transferId = await createPromotionTransfer(env, {
    actor,
    clubId,
    playerId,
    playerName: player.name,
    releaseFee: fee,
    surcharge,
    win,
    origin: 'user',
    auto: false,
  });
  const opened = await openNegotiationSession(env, transferId, actor, undefined, { fixedReleaseFee: fee });
  const session = await db
    .prepare('SELECT id, expected_wage FROM negotiation_sessions WHERE transfer_id = ?')
    .bind(transferId)
    .first<{ id: number; expected_wage: number | null }>();
  return {
    ok: true,
    transferId,
    sessionId: session?.id ?? 0,
    releaseFee: fee,
    surcharge,
    ...(opened.expectedWage !== undefined ? { expectedWage: opened.expectedWage } : session?.expected_wage != null ? { expectedWage: session.expected_wage } : {}),
  };
}

// 练满自动开/预约（Q9）：applyLevelUp 达成 ca≥pa 的训练营球员自动建上调单——
// 闸开 = 立即开会（默认按免费上限 15m 定 F，谈崩可重申调整）；闸关 = pending_review 预约，
// openReservedPromotions 在闸开后开会。尽力而为：任何异常不影响成长结算主线（孤儿由 tick 兜底）。
export async function autoOpenPromotionAtTraineeMax(env: Env, playerId: number, actor: number | null): Promise<void> {
  try {
    const db = env.DB;
    const row = await db
      .prepare(
        `SELECT p.id, p.club_id, p.status, ${sqlDisplayName('p')} AS player_name, c.contract_type
         FROM players p LEFT JOIN contracts c ON c.player_id = p.id AND c.is_active = 1
         WHERE p.id = ?`,
      )
      .bind(playerId)
      .first<{ id: number; club_id: number | null; status: string; player_name: string; contract_type: string | null }>();
    if (!row || row.club_id === null || row.status !== 'trainee' || row.contract_type !== 'trainee') return;
    const inFlight = await db
      .prepare(`SELECT id FROM transfers WHERE player_id = ? AND type = 'promotion' AND status IN ('pending_review','signing') LIMIT 1`)
      .bind(playerId)
      .first<{ id: number }>();
    if (inFlight) return;
    const win = await getOpenWindow(db);
    if (!win) return;
    const blocked = (await opBlockReason(db, 'transfer_promotion')) !== null;
    const transferId = await createPromotionTransfer(env, {
      actor,
      clubId: row.club_id,
      playerId,
      playerName: row.player_name,
      releaseFee: PROMOTION_FREE_RC,
      surcharge: 0,
      win,
      origin: 'cron_tick',
      auto: true,
    });
    if (blocked) {
      await queueClubNotification(env, row.club_id, 'promotion_reserved', { player: row.player_name, playerId, releaseFee: PROMOTION_FREE_RC });
      return;
    }
    await openNegotiationSession(env, transferId, actor, undefined, { fixedReleaseFee: PROMOTION_FREE_RC }, 'cron_tick');
    await queueClubNotification(env, row.club_id, 'promotion_opened', { player: row.player_name, playerId, releaseFee: PROMOTION_FREE_RC, auto: true });
  } catch {
    // 尽力而为：预约/开会失败留 pending_review 单，openReservedPromotions 下一轮 tick 兜底
  }
}

// 预约开会兜底（tick）：pending_review 的上调单，闸开即开会——覆盖练满预约与「建单、开会两批之间崩溃」孤儿。
// 返回真正开会的单数（幂等：openNegotiationSession 的 UNIQUE 会话闸使重放得 'already'）。
export async function openReservedPromotions(env: Env, origin: AuditOrigin): Promise<number> {
  const db = env.DB;
  if ((await opBlockReason(db, 'transfer_promotion')) !== null) return 0;
  const rows = await db
    .prepare(
      `SELECT t.id, t.player_id, t.from_club_id, t.evidence, ${sqlDisplayName('p')} AS player_name
       FROM transfers t JOIN players p ON p.id = t.player_id
       WHERE t.type = 'promotion' AND t.status = 'pending_review' ORDER BY t.id LIMIT 50`,
    )
    .all<{ id: number; player_id: number; from_club_id: number | null; evidence: string | null; player_name: string }>();
  let opened = 0;
  for (const row of rows.results) {
    let fee: number | null = null;
    try {
      const ev = JSON.parse(row.evidence ?? '{}') as { releaseFee?: unknown };
      if (Number.isInteger(ev.releaseFee) && (ev.releaseFee as number) > 0) fee = ev.releaseFee as number;
    } catch {
      fee = null;
    }
    if (fee === null) continue; // 坏行不碰，留人工处置
    const r = await openNegotiationSession(env, row.id, null, undefined, { fixedReleaseFee: fee }, origin);
    if (r.status === 'signing') {
      opened++;
      if (row.from_club_id !== null) {
        await queueClubNotification(env, row.from_club_id, 'promotion_opened', { player: row.player_name, playerId: row.player_id, releaseFee: fee });
      }
    }
  }
  return opened;
}
