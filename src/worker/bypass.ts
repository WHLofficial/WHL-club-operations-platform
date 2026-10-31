// 旁路操作服务（TECH_DESIGN §6.3，规则 4.4.3/4.4.4/4.4.6）：不走竞价的直接单据入口。
// 提交（教练）→ transfer 单 pending_review + 审核任务；审核通过 → approveTransferDeal 分流：
// 解约直接过户；续约/匹配/海捞先收附加费（幂等闸 + 守卫，重试不重复扣）再自动开签约谈判。
// 窗内回滚（4.4.10）：续约完成后同窗被挂牌/激活/解约 → 违约金更改无效回滚（RC 与保护期还原、费用退还）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { releaseFeeBounds } from '../core/negotiation-rules.ts';
import { rcChangeFee, terminationFee, freeAgentFee, matchDiff, FORCED_AUCTION_PRICE } from '../core/bypass-rules.ts';
import { bidDeadline, round2, shanghaiDateStr } from '../core/market-rules.ts';
import { loadMarketContext } from './market-context.ts';
import { availableBalance, creditLineGuard, ledgerMovement } from './ledger.ts';
import { getOpenWindow, type OpenWindow } from './seasons.ts';
import { assertOpOpen, opBlockReason } from './ops-schedule.ts';
import { closedRegularTicks } from './contract-ticks.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import {
  completeTermination,
  completeTransfer,
  loadReturnClubContext,
  loadTransfer,
  transferEvidence,
  type ReviewDecision,
} from './transfers.ts';
import { openNegotiationSession, voidSigningCore } from './negotiations.ts';
import { listingDemandStatements } from './demand-ops.ts';
import { cpuClubIds } from './growth.ts';
import { rowDisplayName } from '../core/player-name.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface RcChangeEvidence {
  oldReleaseFee: number;
  oldProtectionTicks: number | null;
  /** rev22 §5.6：本次续约是否走免费通道（free_rc_change_used=0 自动动用）；缺字段按非免费（历史在途单兼容） */
  freeRcChange?: boolean;
}

interface OwnPlayerRow {
  id: number;
  name: string;
  display_name: string | null;
  club_id: number | null;
  status: string;
}

// 球员已在市场/审核流程里的一票否决（4.4.10「正在被挂牌、解约的球员不可更改违约金」同源）
async function findInFlight(db: D1Database, playerId: number): Promise<'listing' | 'pending' | null> {
  const listing = await db
    .prepare(
      `SELECT id FROM listings WHERE player_id = ? AND status IN ('listed', 'bidding', 'matched_pending', 'pending_review') LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
  if (listing) return 'listing';
  const pending = await db
    .prepare(`SELECT id FROM transfers WHERE player_id = ? AND status = 'pending_review' LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (pending) return 'pending';
  return null;
}

// v6.64.4 起导出给 promotion.ts（下放同样要躲开在途单据与在途谈判）
export async function ensureNotInFlight(db: D1Database, playerId: number): Promise<void> {
  const kind = await findInFlight(db, playerId);
  if (kind === 'listing') throw new HttpError(400, '这名球员已经有一单在市场流程里了，等它结束再操作');
  if (kind === 'pending') throw new HttpError(400, '这名球员有一张单据正在等管理组审核，先等审核结果');
}

export type SeaSignStage = 'window' | 'ownership' | 'status' | 'banned' | 'listing' | 'pending' | 'signing' | 'ok';

export interface SeaSignVerdict {
  stage: SeaSignStage;
  ok: boolean;
  /** ok=false 时调用方应抛的 HttpError 状态码 */
  status: number;
  /** ok=false 时给用户看的中文原因 */
  reason: string;
  errCode?: string;
}

/**
 * 海捞资格判定（v6.17.0）：与 createFreeAgent 的守卫链同源——它不是镜像，createFreeAgent
 * 直接吃这里的 verdict 抛错，判定口径永不漂移。stage 供球员详情的 seaComps 决定要不要算
 * 成交参照（被 ownership/status 两关拦下的球员没有参照意义）。守卫顺序不得调整：用户看到的
 * 拦截原因取决于第一道亮红灯的关（如先查归属再查状态）。
 * v6.18.0：routes/market.ts 的 GET /market/sea-lookup 有一份批量快照副本（同一条守卫链摊成
 * 4 条批量查询），两处口径必须同步改，tests 有跨实现一致性用例锁。
 * v6.64.1：加'在签约谈判'一关——findInFlight 只认 pending_review，海捞单审核通过进 signing
 * 后球员仍无归属，会放第二家（或原队）再提一单，撞同一名球员两张单。
 */
export async function checkSeaSignEligible(
  db: D1Database,
  player: { id: number; club_id: number | null; status: string },
  win: OpenWindow | null,
): Promise<SeaSignVerdict> {
  if (!win)
    return { stage: 'window', ok: false, status: 409, reason: '转会窗口没开，现在不能海捞', errCode: 'no_window' };
  // 海捞 = 签无归属的球员（4.4.4）。CPU 队球员带 club_id 但仍是海里人（v2.0.0，用户裁决）：
  // 出账与落位都按「从 CPU 队签走」处理，不给 CPU 队记任何账。
  const cpuIds = await cpuClubIds(db);
  if (player.club_id !== null && !cpuIds.has(player.club_id)) {
    return { stage: 'ownership', ok: false, status: 400, reason: '海捞只能签无归属的球员（这名球员有东家）' };
  }
  if (player.status === 'retired' || player.status === 'listed')
    return { stage: 'status', ok: false, status: 400, reason: '当前状态不能海捞' };
  // 4.4.4：本转会窗被解约的球员，所有球队本窗都无法签入
  const banned = await db
    .prepare(
      `SELECT id FROM transfers WHERE player_id = ? AND type = 'termination' AND status = 'completed'
         AND season = ? AND window_seq = ? LIMIT 1`,
    )
    .bind(player.id, win.season, win.windowSeq)
    .first<{ id: number }>();
  if (banned)
    return {
      stage: 'banned',
      ok: false,
      status: 409,
      reason: '这名球员本窗口被解约过，本窗口所有球队都不能签他',
    };
  const inFlight = await findInFlight(db, player.id);
  if (inFlight === 'listing')
    return { stage: 'listing', ok: false, status: 400, reason: '这名球员已经有一单在市场流程里了，等它结束再操作' };
  if (inFlight === 'pending')
    return { stage: 'pending', ok: false, status: 400, reason: '这名球员有一张单据正在等管理组审核，先等审核结果' };
  // 审核通过 → 单据进 signing（签约谈判），这时球员还没过户，归属仍是空的；不拦就会有人
  // 再提一单，等两张单都会走到 completeTransfer 抢同一名球员
  const signing = await db
    .prepare(`SELECT id FROM transfers WHERE player_id = ? AND status = 'signing' LIMIT 1`)
    .bind(player.id)
    .first<{ id: number }>();
  if (signing)
    return {
      stage: 'signing',
      ok: false,
      status: 400,
      reason: '这名球员的海捞单已经进入签约谈判，等它成约或作废再操作',
      errCode: 'sea_signing',
    };
  return { stage: 'ok', ok: true, status: 200, reason: '' };
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
  actor: number | null,
): Promise<void> {
  const db = env.DB;
  // v6.50.0 海捞暗标：胜出单的签入费在审核通过时才收，收的同时销毁这笔密封冻结。
  // 冻结本来就为这笔费做担保，故它可以把可用额顶上来（否则「余额 30 / 冻着 30」的俱乐部过不了
  // 余额预检，而放最后解冻又会让守卫重复算一遍缺口——两处都按「加回自己的那份冻结」处理）。
  const sealed = await db
    .prepare(`SELECT sealed_bid_id FROM transfers WHERE id = ?`)
    .bind(transferId)
    .first<{ sealed_bid_id: number | null }>();
  const sealedHold = sealed?.sealed_bid_id
    ? await db
        .prepare(`SELECT id, amount FROM fund_holds WHERE ref_type = 'sea_sealed' AND ref_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`)
        .bind(sealed.sealed_bid_id)
        .first<{ id: number; amount: number }>()
    : null;
  const available = round2((await availableBalance(db, clubId)) + (sealedHold?.amount ?? 0));
  if (available < amount) {
    throw new HttpError(409, `俱乐部可用资金不足：这笔费用要 ${round2(amount)} m，当前可支配 ${available} m`);
  }
  // 批内守卫必须与 availableBalance 同一公式（含预期收入额度）：预检放行而守卫按现金式判，
  // 会让「靠额度刚好够」的单据在扣费那一批 409，且重试永远不过（审核死锁）。
  const credit = creditLineGuard(clubId);
  const guardSql =
    `(SELECT status FROM transfers WHERE id = ?) = 'pending_review'` +
    ` AND COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0)` +
    ` - COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0)` +
    (sealedHold ? ` + COALESCE((SELECT amount FROM fund_holds WHERE id = ? AND status = 'held'), 0)` : '') +
    ` + ${credit.sql}` +
    ` >= ?`;
  const guardParams = [
    transferId,
    clubId,
    clubId,
    ...(sealedHold ? [sealedHold.id] : []),
    ...credit.params,
    amount,
  ];
  // 留痕与账本共用同一套守卫，且**排在账本之前**落库：两者评估的是同一份库存状态，
  // 故「是否真扣到这笔费」的判断完全一致 —— 审核重放（该 kind 已有流水）或批内余额守卫
  // 没过时都不会留下失实的 bypass_fee 行（createAuditStatement 无法表达 WHERE，此处手写）
  const auditStmt = db
    .prepare(
      `INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
       SELECT ?, 'bypass_fee', 'transfer', ?, 'user', NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE kind = ? AND ref_type IS 'transfer' AND ref_id IS ?)
          AND ${guardSql}`,
    )
    .bind(actor, transferId, JSON.stringify({ kind, amount, clubId, memo }), kind, transferId, ...guardParams);
  const ledger = ledgerMovement(db, {
    clubId,
    delta: -amount,
    kind,
    refType: 'transfer',
    refId: transferId,
    memo,
    guardSql,
    guardParams,
  });
  // 解冻封标与写附加费两条 UPDATE 都挂同一守卫：只挂其中一条时，守卫没过的那条 0 行、
  // 另一条照样落库——冻结白 settled（费用没收、流程照走）或附加费写上了而钱没扣。
  // 顺序硬约束：两条**必须排在账本之前**——守卫读的是当时的余额，排在扣款之后会把刚扣的钱
  // 又算进缺口（余额刚好够额度的单子会在这一步 0 行，账已扣、费没记、冻结没解）。
  const guarded = [
    ...(sealedHold
      ? [
          db
            .prepare(`UPDATE fund_holds SET status = 'settled' WHERE id = ? AND status = 'held' AND ${guardSql}`)
            .bind(sealedHold.id, ...guardParams),
        ]
      : []),
    db
      .prepare(`UPDATE transfers SET extra_fee = ? WHERE id = ? AND status = 'pending_review' AND extra_fee IS NULL AND ${guardSql}`)
      .bind(amount, transferId, ...guardParams),
  ];
  const statements = [auditStmt, ...guarded, ...ledger];
  const results = await db.batch(statements);
  // 这笔费到底扣没扣：看两条守卫 UPDATE 里有没有任一条真改了行（它们与账本读同一份批前资金状态）。
  // 只判末句会在「extra_fee 早被 createBypassTransfer 预填」时恒得 0，把已扣费的成功当失败；
  // 只判 settled 又会在守卫失效时漏掉未扣款。两者都没有 → 回查流水区分「幂等重放」与「真失败」。
  const charged = results.slice(1, 1 + guarded.length).some((r) => (r?.meta.changes ?? 0) > 0);
  if (!charged) {
    const already = await db
      .prepare(`SELECT id FROM ledger_entries WHERE kind = ? AND ref_type IS 'transfer' AND ref_id IS ?`)
      .bind(kind, transferId)
      .first<{ id: number }>();
    if (!already) throw new HttpError(409, '资金刚被其他操作占用，费用没收上，稍后重试审核');
  }
}

// 旁路单建单批：transfer + 审核任务一个 batch（审核任务 ref_id 用 last_insert_rowid()
// 指回同批前一句刚插入的 transfer）；回链与审计在拿到 transferId 后补一个小批。
// v6.50.0 起也被海捞暗标开标复用（sealedBidId 记「这单从哪份密封标来」）——actor 可为 null
//（tick 开标没有操作人；审计写 NULL，不用 0 当哨兵）。
export async function createBypassTransfer(
  env: Env,
  opts: {
    actor: number | null;
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
    origin: AuditOrigin;
    /** 海捞暗标开标：来源密封标 id（见 migrations/0070_sea_sealed.sql 的解冻兜底触发器） */
    sealedBidId?: number | null;
  },
): Promise<{ transferId: number }> {
  const db = env.DB;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, extra_fee, status, season, window_seq, evidence, sealed_bid_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ${nowSql()})`,
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
        opts.sealedBidId ?? null,
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
      origin: opts.origin,
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
  // v6.49.0 运营时刻表：续约自己的时段（默认「不限制」= 只剩上面那道窗口闸）
  await assertOpOpen(db, 'transfer_rc_change');

  const player = await db
    .prepare('SELECT id, name, display_name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== clubId) throw new HttpError(400, '只能续约自己队里的球员');
  if (player.status !== 'normal') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员在挂牌流程里，不能续约' : '当前状态不能续约');
  }
  const contract = await db
    .prepare('SELECT release_fee, contract_type, protection_ticks, free_rc_change_used FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; contract_type: string; protection_ticks: number | null; free_rc_change_used: number }>();
  if (!contract || contract.release_fee === null || contract.release_fee <= 0) {
    throw new HttpError(409, '球员没有含违约金的现行合同，先让管理组补合同');
  }
  if (contract.contract_type === 'trainee') {
    throw new HttpError(400, '训练营合同是固定条款（0.75m / 5m），不能改违约金');
  }
  await ensureNotInFlight(db, playerId);
  // 同窗一次不变量（v6.54.0 rev20 §5.4）：同一窗一名球员与俱乐部之间最多一条合同谈判线，
  // 闹涨薪与续约（改违约金）二选一、先到先占。① 本窗存在该球员任意状态的 contract_demands
  // 行即占额度（UNIQUE(player_id, season, window_seq) 一窗一行；expired 也算——堵「故意过期后
  // 同窗便宜续约安抚」）；② 该球员存在未终局签约谈判 session（active + signing，与生成侧排除/
  // 关窗检查同口径）→ 一并 409——顺带堵既有缺口：ensureNotInFlight 只查 listings 活跃与
  // transfers 待审，续约单批准进 signing 后同一球员还能再提第二张续约单。
  // ③ 该球员已有在途 pending（合同变更，三类来源同表）→ 409（§5.7「一球员同时最多 1 条 pending」）。
  // 三道都过 ⇒ 普通续约既有流程零变化（无 demand 行、无 active session、无 pending 时不新增写路径）。
  const sameWindowDemand = await db
    .prepare('SELECT id FROM contract_demands WHERE player_id = ? AND season = ? AND window_seq = ? LIMIT 1')
    .bind(playerId, win.season, win.windowSeq)
    .first<{ id: number }>();
  if (sameWindowDemand) throw new HttpError(409, '本窗他的合同谈判机会已经用过，下窗再谈');
  const openSession = await db
    .prepare(
      `SELECT s.id FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
       WHERE s.player_id = ? AND s.status = 'active' AND t.status = 'signing' LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
  if (openSession) throw new HttpError(409, '他还有一场签约谈判没结束，先等它了结再操作');
  // ③ 一球员同时最多 1 条待生效合同变更（§5.7）：闹涨薪接受 / 直拒保护期失效 / 上窗迟到的
  // 普通续约 pending 都占位。不前置拦住就会在成约批里撞 0079 的 idx_pending_one_per_player，
  // 把整批过户打成 500——宁可在这里给一句可读的 409。
  const inFlightPending = await db
    .prepare(`SELECT id FROM contract_pending_changes WHERE player_id = ? AND status = 'pending' LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (inFlightPending) throw new HttpError(409, '他还有一份待生效的合同变更，先等它生效或作废');

  const oldRc = contract.release_fee;
  const [low, high] = releaseFeeBounds(oldRc);
  if (newFee < low || newFee > high) {
    throw new HttpError(400, `新违约金需在 ${low}~${high} 之间（整数 m，原违约金 ${oldRc} m）`);
  }
  // 免费续约机会（§5.6 rev22）：free_rc_change_used=0 的合同下一张续约单自动走免费通道——
  // 提价免收差额 30%（审核侧凭 evidence 跳过扣款）、不收口保护期（pending 写 NULL，apply 侧
  // COALESCE 接住）；降价同样消耗。用完后一切维持现状。
  const isFree = contract.free_rc_change_used === 0;
  const changeFee = isFree ? 0 : rcChangeFee(oldRc, newFee);
  if (changeFee > 0) {
    const available = await availableBalance(db, clubId);
    if (round2(available) < changeFee) {
      throw new HttpError(400, `可用资金不足：提高违约金要付差额 30%（${changeFee} m），当前可支配 ${round2(available)} m`);
    }
  }

  const { transferId } = await createBypassTransfer(env, {
    actor,
    origin: 'user',
    type: 'rc_change',
    playerId,
    fromClubId: clubId,
    toClubId: clubId,
    fee: newFee,
    extraFee: null,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { oldReleaseFee: oldRc, oldProtectionTicks: contract.protection_ticks, freeRcChange: isFree },
    payload: {
      kind: 'rc_change',
      playerId,
      playerName: rowDisplayName(player),
      clubId,
      oldReleaseFee: oldRc,
      newReleaseFee: newFee,
      changeFee,
      freeRcChange: isFree,
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
  // v6.49.0 运营时刻表：解约自己的时段（默认「不限制」= 只剩上面那道窗口闸）
  await assertOpOpen(db, 'transfer_termination');

  const player = await db
    .prepare('SELECT id, name, display_name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== clubId) throw new HttpError(400, '只能解约自己队里的球员');
  if (player.status !== 'normal' && player.status !== 'trainee') {
    throw new HttpError(400, player.status === 'listed' ? '这名球员在挂牌流程里，不能解约' : '当前状态不能解约');
  }
  // v6.64.4 上调锁定：上调谈判期间合同正在被改写，解约会把谈判的合同改写打成幽灵完成
  const promoLock = await db
    .prepare(
      `SELECT s.id FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
       WHERE s.player_id = ? AND s.status = 'active' AND t.status = 'signing' AND t.type = 'promotion' LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
  if (promoLock) throw new HttpError(409, '他正在上调谈判中，等它成约或作废再解约');
  const contract = await db
    .prepare('SELECT release_fee, service_ticks FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; service_ticks: number }>();
  if (!contract || contract.release_fee === null || contract.release_fee <= 0) {
    throw new HttpError(409, '球员没有含违约金的现行合同，先让管理组补合同');
  }
  await ensureNotInFlight(db, playerId);

  // 解约费按窗刻度（4.4.4）：效力 = 已关常规窗数 − 签约基数（每常规窗 0.5 赛季），满 6 窗（3 赛季）免费
  const currentTicks = await closedRegularTicks(db);
  const serviceTicks = contract.service_ticks ?? 0;
  const fee = terminationFee(contract.release_fee, serviceTicks, currentTicks);
  if (fee > 0) {
    const available = await availableBalance(db, clubId);
    if (round2(available) < fee) {
      throw new HttpError(400, `可用资金不足：解约费要 ${fee} m（审核通过时销毁），当前可支配 ${round2(available)} m`);
    }
  }

  const { transferId } = await createBypassTransfer(env, {
    actor,
    origin: 'user',
    type: 'termination',
    playerId,
    fromClubId: clubId,
    toClubId: null,
    fee: 0,
    extraFee: fee,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { oldReleaseFee: contract.release_fee, serviceTicks },
    payload: {
      kind: 'termination',
      playerId,
      playerName: rowDisplayName(player),
      clubId,
      terminationFee: fee,
      season: win.season,
      windowSeq: win.windowSeq,
    },
    action: 'bypass_termination',
  });
  // v6.64.4 解约冻结（Q19）：提交时按算定金额冻结（fund_holds ref_type='termination'），
  // 审核按冻结额收不重算（completeTermination 消费 hold）、驳回/取消解冻（rejectTransfer/自助取消）。
  // 冻结失败（并发输掉余额）⇒ 补偿取消刚建的单据 + 400，不留无担保在途单。
  if (fee > 0) {
    const credit = creditLineGuard(clubId);
    const frozen = await db
      .prepare(
        `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
         SELECT ?, ?, 'held', 'termination', ?, ${nowSql()}
         WHERE (SELECT COALESCE(balance, 0) FROM ledger_accounts WHERE club_id = ?)
             - COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0)
             + ${credit.sql} >= ?`,
      )
      .bind(clubId, fee, transferId, clubId, clubId, ...credit.params, fee)
      .run();
    if ((frozen.meta.changes ?? 0) === 0) {
      await db.batch([
        db.prepare(`UPDATE transfers SET status = 'cancelled' WHERE id = ? AND status = 'pending_review'`).bind(transferId),
        db
          .prepare(
            `UPDATE review_tasks SET status = 'rejected', decided_by = ?, decided_at = ${nowSql()}, note = '解约费冻结失败，单据自动取消'
             WHERE ref_id = ? AND type = 'transfer_confirm' AND status = 'open'`,
          )
          .bind(actor, transferId),
      ]);
      throw new HttpError(400, `可用资金不足：解约费要 ${fee} m（提交即冻结，审核通过时销毁），当前可支配不足`);
    }
  }
  // 4.4.10：解约提交即触发本窗续约回滚（触发 ref = 解约单）。排在冻结成功之后：
  // 冻结失败自动取消时不该波及本窗续约。
  await rollbackRcChangeForPlayer(env, playerId, actor, { refType: 'transfer', refId: transferId });
  return { ok: true, transferId, terminationFee: fee };
}

// ---- 自助取消（v6.64.4，用户裁决 2026-10-31）：续约 / 解约 / 上调还没被审核时，教练可在球员面板一键取消 ----

const CANCELLABLE_TYPES: ReadonlySet<string> = new Set(['rc_change', 'termination', 'promotion']);

export interface CancelOwnResult {
  ok: true;
  status: 'cancelled' | 'rejected';
}

/**
 * 教练自助取消自己发起的单据：
 * - pending_review（续约单 / 解约单 / 上调预约）→ 单据 'cancelled' + 审核任务收口（note 自助取消）
 *   + 解约随单冻结解冻；审计 actor = 本人。已作废的续约 pending 不复活（4.4.10 回滚只进不退）。
 * - 上调已进谈判（signing）→ voidSigningCore 对称收口：会话作废、球员还原训练营态、单据驳回，
 *   之后可重申（谈崩可重申同口径）。
 * - 其他类型 / 别人的单据 / 已终局 → 拒绝。
 */
export async function cancelOwnTransfer(env: Env, clubId: number, actor: number, transferIdInput: unknown): Promise<CancelOwnResult> {
  const db = env.DB;
  const transferId = Number(transferIdInput);
  if (!Number.isInteger(transferId) || transferId <= 0) throw new HttpError(400, 'transferId 应为单据 ID');
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '单据不存在');
  if (!CANCELLABLE_TYPES.has(transfer.type)) throw new HttpError(400, '这类单据不支持自助取消');
  if (transfer.from_club_id !== clubId) throw new HttpError(403, '只能取消自己队发起的单据');

  if (transfer.status === 'signing') {
    if (transfer.type !== 'promotion') throw new HttpError(409, '这单已进签约谈判，等它了结');
    const session = await db
      .prepare(`SELECT id FROM negotiation_sessions WHERE transfer_id = ? AND status = 'active' LIMIT 1`)
      .bind(transferId)
      .first<{ id: number }>();
    if (!session) throw new HttpError(409, '这场谈判已经结束了');
    const done = await voidSigningCore(env, session.id, {
      actor,
      origin: 'user',
      action: 'transfer_self_cancel',
      deadlineNote: '教练自助取消',
      reason: 'self_cancel',
    });
    if (done !== 'done') throw new HttpError(409, '这场谈判已经结束了');
    return { ok: true, status: 'rejected' };
  }
  if (transfer.status !== 'pending_review') {
    throw new HttpError(409, `单据已经终局（${transfer.status}），不能取消`);
  }

  const audit = createAuditStatement(db);
  await db.batch([
    db.prepare(`UPDATE transfers SET status = 'cancelled' WHERE id = ? AND status = 'pending_review'`).bind(transferId),
    db
      .prepare(
        `UPDATE review_tasks SET status = 'rejected', decided_by = ?, decided_at = ${nowSql()}, note = '教练自助取消'
         WHERE ref_id = ? AND type = 'transfer_confirm' AND status = 'open'`,
      )
      .bind(actor, transferId),
    ...(transfer.type === 'termination'
      ? [db.prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'termination' AND ref_id = ? AND status = 'held'`).bind(transferId)]
      : []),
    audit({
      actor,
      action: 'transfer_self_cancel',
      targetType: 'transfer',
      targetId: transferId,
      origin: 'user',
      after: { type: transfer.type, playerId: transfer.player_id },
    }),
  ]);
  return { ok: true, status: 'cancelled' };
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
  // v6.49.0 运营时刻表：海捞明标段（v6.50.0 两阶段落地后，暗标段另有 transfer_sea_sealed 自己的闸）
  await assertOpOpen(db, 'transfer_sea_open');
  // v6.50.0 两阶段：收标期间自由身池走「统一截止 + 价高者得」的密封标，明标入口先关掉
  //（说的是同一批球员，放行等于两头下注；settling 只是开标在途，几十秒内就落 opened，不拦）
  const sealedBatch = await db
    .prepare(`SELECT id FROM sea_batches WHERE season = ? AND window_seq = ? AND status = 'sealed' LIMIT 1`)
    .bind(win.season, win.windowSeq)
    .first<{ id: number }>();
  if (sealedBatch) {
    throw new HttpError(
      409,
      '现在是海捞暗标段：自由身池走统一截止的密封标，常规海捞等明标段（球员档案里有密封标入口）',
      'sea_sealed_phase',
    );
  }

  const player = await db
    .prepare('SELECT id, name, display_name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<OwnPlayerRow>();
  if (!player) throw new HttpError(404, '球员不存在');
  // 守卫链（窗口 → 归属 → 状态 → 本窗禁签 → 在途）整体收进 checkSeaSignEligible，
  // 球员详情的 seaSign 前置判定吃同一个函数（v6.17.0），两边口径不会漂移
  const verdict = await checkSeaSignEligible(db, player, win);
  if (!verdict.ok) throw new HttpError(verdict.status, verdict.reason, verdict.errCode);

  const signFee = freeAgentFee(newFee);
  const available = await availableBalance(db, clubId);
  if (round2(available) < signFee) {
    throw new HttpError(400, `可用资金不足：海捞签入费是新违约金的 30%（${signFee} m），当前可支配 ${round2(available)} m`);
  }

  const { transferId } = await createBypassTransfer(env, {
    actor,
    origin: 'user',
    type: 'free_agent',
    playerId,
    fromClubId: player.club_id, // CPU 队球员记原队，过户守卫才能把球员从 CPU 队名下摘走；真无归属仍是 null
    toClubId: clubId,
    fee: newFee,
    extraFee: null,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { signFee },
    payload: {
      kind: 'free_agent',
      playerId,
      playerName: rowDisplayName(player),
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

/** 人选参考值（v6.51.0：队内非门将 CA 前六只作参考，不再是人选硬条件） */
export interface ForcedAuctionReference {
  playerId: number;
  /** EA 球员 ID（球员页 URL 上的号）；可能为空 */
  fcId: number | null;
  playerName: string;
  clubId: number | null;
  clubName: string | null;
  position: string | null;
  ca: number | null;
  /** 门将（前六参考口径不含门将） */
  isGk: boolean;
  /** 队内非门将 CA 排名（并列取并列最优名次）；门将 / 缺 CA 为 null */
  caRank: number | null;
  /** 队内非门将第六名的 CA（前六参考线）；有 CA 的非门将不足六人为 null */
  topSixLine: number | null;
  /** 是否落在队内非门将 CA 前六（参考值，不强制）；门将 / 缺 CA 为 null */
  inTopSix: boolean | null;
  /** 队内有 CA 的非门将人数 */
  nonGkWithCa: number;
}

export interface ForcedAuctionBlocker {
  status: number;
  message: string;
  errCode?: string;
}

export interface ForcedAuctionInspection {
  reference: ForcedAuctionReference;
  /** 现在挂牌会被拒的原因（按闸门顺序；空数组 = 可挂） */
  blockers: ForcedAuctionBlocker[];
}

export interface ForcedAuctionResult {
  ok: true;
  listingId: number;
  askPrice: number;
  reference: ForcedAuctionReference;
}

/**
 * 强制拍卖预检（v6.51.0）：算人选参考值 + 收集闸门原因。建单与管理端 preview 端点吃这一处口径——
 * 人选不限门将、不限 CA 前六；保留的硬闸：窗口在开、运营时刻表、非 CPU 队、球员状态可挂牌、不在市场流程里。
 */
export async function inspectForcedAuction(env: Env, playerIdInput: unknown): Promise<ForcedAuctionInspection> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');

  // 管理端输入的是球员页上的 FC ID 也认（v6.60.5）：先按平台 ID 精确查，查不到再按 fc_id 查。
  // 平台 ID 优先，避免极小概率的 id/fc_id 撞号时选错人。
  const playerSelect = `SELECT p.id, p.fc_id, p.name, p.club_id, p.status, p.position, p.ca, c.name AS club_name
       FROM players p LEFT JOIN clubs c ON c.id = p.club_id`;
  type PlayerRow = {
    id: number;
    fc_id: number | null;
    name: string;
    club_id: number | null;
    status: string;
    position: string | null;
    ca: number | null;
    club_name: string | null;
  };
  const player =
    (await db.prepare(`${playerSelect} WHERE p.id = ?`).bind(playerId).first<PlayerRow>()) ??
    (await db.prepare(`${playerSelect} WHERE p.fc_id = ?`).bind(playerId).first<PlayerRow>());
  if (!player) throw new HttpError(404, '球员不存在（平台 ID 和 FC ID 都查不到这个号）');

  const hasClub = player.club_id !== null;
  const isGk = player.position === 'GK';
  let caRank: number | null = null;
  let topSixLine: number | null = null;
  let nonGkWithCa = 0;
  if (hasClub) {
    const stats = await db
      .prepare(`SELECT COUNT(*) AS n FROM players WHERE club_id = ? AND position != 'GK' AND ca IS NOT NULL`)
      .bind(player.club_id)
      .first<{ n: number }>();
    nonGkWithCa = stats?.n ?? 0;
    if (!isGk && player.ca !== null) {
      // 前六（含并列）：严格高于其 CA 的非门将队友数 + 1
      const above = await db
        .prepare(`SELECT COUNT(*) AS n FROM players WHERE club_id = ? AND position != 'GK' AND ca > ?`)
        .bind(player.club_id, player.ca)
        .first<{ n: number }>();
      caRank = (above?.n ?? 0) + 1;
    }
    if (nonGkWithCa >= 6) {
      const line = await db
        .prepare(
          `SELECT ca FROM players WHERE club_id = ? AND position != 'GK' AND ca IS NOT NULL
         ORDER BY ca DESC LIMIT 1 OFFSET 5`,
        )
        .bind(player.club_id)
        .first<{ ca: number | null }>();
      topSixLine = line?.ca ?? null;
    }
  }
  const reference: ForcedAuctionReference = {
    playerId: player.id,
    fcId: player.fc_id,
    playerName: player.name,
    clubId: player.club_id,
    clubName: player.club_name,
    position: player.position,
    ca: player.ca,
    isGk,
    caRank,
    topSixLine,
    inTopSix: caRank === null ? null : caRank <= 6,
    nonGkWithCa,
  };

  const blockers: ForcedAuctionBlocker[] = [];
  const win = await getOpenWindow(db);
  if (!win) blockers.push({ status: 409, message: '转会窗口没开，现在不能发起强制拍卖', errCode: 'no_window' });
  const opBlock = await opBlockReason(db, 'transfer_forced_auction');
  if (opBlock) blockers.push(opBlock);
  // v6.60.7：CPU 队球员也可强制拍卖（用户裁决）。CPU 队一律不入账，成交款在
  // completeTransfer 按「无收款人」销毁；下架费/解约也按无卖方处理。
  // v6.60.5：自由身也能强拍（成交款无收款人，由 completeTransfer 销毁）。
  // 自由身要求 status='free'；有俱乐部仍要求 'normal'。
  if (player.status === 'listed') {
    blockers.push({ status: 400, message: '这名球员已经在挂牌流程里了' });
  } else if (player.club_id === null ? player.status !== 'free' : player.status !== 'normal') {
    blockers.push({ status: 400, message: '当前状态不能强制拍卖' });
  } else if ((await findInFlight(db, player.id)) === 'listing') {
    blockers.push({ status: 400, message: '这名球员已经有一单在市场流程里了，等它结束再操作' });
  }

  return { reference, blockers };
}

/**
 * 强制拍卖挂牌价（v6.51.0）：管理端可指定，缺省 1m（4.4.5 原口径）；正数、两位小数
 * （沿普通挂牌价口径）。起拍价即挂牌价，之后照常竞价（4.4.1.2）。
 */
export function parseForcedAuctionPrice(input: unknown): number {
  if (input === undefined || input === null || input === '') return FORCED_AUCTION_PRICE;
  const askPrice = Number(input);
  if (!Number.isFinite(askPrice) || askPrice <= 0) throw new HttpError(400, '挂牌价须为正数（单位 m）');
  return round2(askPrice);
}

/**
 * 管理方建强制拍卖（v6.51.0）：人选不限门将、不限 CA 前六——队内非门将 CA 排名/前六线只作为
 * 参考值随响应回报（管理端展示用）；挂牌价可指定（默认 1m），之后走普通挂牌链（首价 ≥挂牌价、
 * 正常竞价、成交税整单 50%）。
 */
export async function createForcedAuction(
  env: Env,
  actor: number,
  playerIdInput: unknown,
  askPriceInput?: unknown,
): Promise<ForcedAuctionResult> {
  const askPrice = parseForcedAuctionPrice(askPriceInput);
  const db = env.DB;
  const { reference, blockers } = await inspectForcedAuction(env, playerIdInput);
  const block = blockers[0];
  if (block) throw new HttpError(block.status, block.message, block.errCode);
  const playerId = reference.playerId;
  const clubId = reference.clubId;
  const win = await getOpenWindow(db); // 预检已确认在开，这里取 season/windowSeq 落库
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能发起强制拍卖', 'no_window');
  await ensureNotInFlight(db, playerId); // 预检后有单据刚进流程的兜底

  const audit = createAuditStatement(db);
  // v6.24.1：强制拍并入统一截止规则——创建即按 bidDeadline 首算落 deadline_at（无人出价同计静默），
  // 与普通挂牌同轨：卡片读秒、到期提前下架收费；出口仍保留窗尾收口与管理方取消。
  // v6.60.5：强制拍卖整段比普通挂牌多一天——X 日挂牌最早 X+2 日判定/预计成交。
  const listedAt = new Date();
  const listedDay = shanghaiDateStr(listedAt.getTime());
  const marketCtx = await loadMarketContext(db);
  const firstDeadline = bidDeadline({
    lastBidAt: null,
    listedDay,
    now: listedAt,
    deadlineHours: marketCtx.deadlineHours,
    silenceHours: marketCtx.silenceHours,
    calendar: marketCtx.calendar,
    minOffsetDays: 2,
  }).deadlineAt;
  // v6.60.5：自由身也能强拍——seller_club_id 留空，成交时 completeTransfer 按无收款人销毁成交款。
  const markListed =
    clubId === null
      ? db
          .prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id IS NULL AND status = 'free'`)
          .bind(playerId)
      : db
          .prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`)
          .bind(playerId, clubId);
  const statements = [
    markListed,
    db
      .prepare(
        `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, deadline_at, season, window_seq)
         VALUES (?, ?, 'forced', ?, 'listed', ${nowSql()}, ?, ?, ?, ?)`,
      )
      .bind(playerId, clubId, askPrice, listedDay, firstDeadline, win.season, win.windowSeq),
    audit({
      actor,
      action: 'forced_auction_create',
      targetType: 'listing',
      targetId: null,
      origin: 'user',
      after: { playerId, sellerClubId: clubId, askPrice, season: win.season, windowSeq: win.windowSeq },
    }),
    // 挂牌驱赶（v6.54.0 §5.4 / §11.2）：强制拍卖同为 listings 行，待处理 demand 同样置 expired
    // 且标 byListing（不计累计终局——管理动作不该算成球员前科）；存续转会申请 pending → listed。
    // 自由身没有俱乐部，不存在本队 demand / 转会申请，跳过。
    ...(clubId !== null ? listingDemandStatements(db, playerId, clubId) : []),
  ];
  const results = await db.batch(statements);
  if ((results[0].meta.changes ?? 0) === 0 || (results[1].meta.changes ?? 0) === 0) {
    throw new HttpError(409, '拍卖单没落库，球员状态可能刚被改过，刷新再试');
  }
  const listingId = Number(results[1].meta.last_row_id);

  // 4.4.10：强制拍卖属挂牌，提交即触发本窗续约回滚
  await rollbackRcChangeForPlayer(env, playerId, actor, { refType: 'listing', refId: listingId });

  return { ok: true, listingId, askPrice, reference };
}

// 管理方取消强制拍卖（未成交前）：解冻出价、球员还原，不收下架费
export async function cancelForcedAuction(env: Env, actor: number, listingIdInput: unknown): Promise<{ ok: true }> {
  const db = env.DB;
  const listingId = Number(listingIdInput);
  if (!Number.isInteger(listingId) || listingId <= 0) throw new HttpError(400, 'listingId 应为挂牌 ID');
  const listing = await db
    .prepare(
      `SELECT l.id, l.player_id, l.status, l.type, l.seller_club_id,
              p.club_id AS player_club_id, p.status AS player_status
         FROM listings l LEFT JOIN players p ON p.id = l.player_id
        WHERE l.id = ?`,
    )
    .bind(listingId)
    .first<{
      id: number;
      player_id: number;
      status: string;
      type: string;
      seller_club_id: number | null;
      player_club_id: number | null;
      player_status: string | null;
    }>();
  if (!listing || listing.type !== 'forced') throw new HttpError(404, '强制拍卖单不存在');
  // 取消是「还原挂牌」动作：球员必须仍归原卖家（自由身单则必须仍无归属），否则会把已解约/已转会的球员
  // 强行改回原状态。归属变了就不许取消，交给结算/下架收口。
  const freeAgentListing = listing.seller_club_id === null;
  if (freeAgentListing) {
    if (listing.player_club_id !== null) {
      throw new HttpError(409, '球员已不是自由身，不能取消强制拍卖');
    }
  } else if (listing.player_club_id === null || listing.player_club_id !== listing.seller_club_id) {
    throw new HttpError(409, '球员已无归属或已不在原俱乐部，不能取消强制拍卖');
  }
  if (listing.status !== 'listed' && listing.status !== 'bidding') {
    throw new HttpError(409, '这单拍卖已经截止进审核，走审核驳回流程');
  }

  const audit = createAuditStatement(db);
  const restorePlayer = freeAgentListing
    ? db
        .prepare(`UPDATE players SET status = 'free', updated_at = ${nowSql()} WHERE id = ? AND club_id IS NULL AND status = 'listed'`)
        .bind(listing.player_id)
    : db
        .prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'listed'`)
        .bind(listing.player_id, listing.seller_club_id);
  await db.batch([
    db
      .prepare(`UPDATE listings SET status = 'delisted', deadline_note = '管理组取消强制拍卖' WHERE id = ? AND type = 'forced' AND status IN ('listed', 'bidding')`)
      .bind(listingId),
    restorePlayer,
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`).bind(listingId),
    db
      .prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'`)
      .bind(listingId),
    audit({
      actor,
      action: 'forced_auction_cancel',
      targetType: 'listing',
      targetId: listingId,
      origin: 'user',
      after: { playerId: listing.player_id, sellerClubId: listing.seller_club_id },
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
      return completeTermination(env, transferId, actor, 'user', review);
    case 'rc_change': {
      const ev = transferEvidence<RcChangeEvidence>(transfer);
      // 免费续约豁免（§5.6 rev22）的真落点在审核侧：evidence 带 freeRcChange 时跳过差额 30%
      //（chargeBypassFee 不走，无流水无审计）。上线后裁决（owner）：缺字段 = 0085 上线前的在途单
      //——0085 零回填 DEFAULT 0，提交时机会必然未消耗，按免费兜底；显式 false（used=1 提交的新单）仍收费。
      const fee = ev?.freeRcChange !== false ? 0 : rcChangeFee(ev?.oldReleaseFee ?? 0, transfer.fee ?? 0);
      if (fee > 0 && transfer.to_club_id !== null) {
        await chargeBypassFee(
          env,
          transferId,
          transfer.to_club_id,
          fee,
          'rc_change_fee',
          `续约费（违约金 ${ev?.oldReleaseFee ?? '?'}m → ${transfer.fee}m 差额 30%，销毁）`,
          actor,
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
        await chargeBypassFee(
          env,
          transferId,
          transfer.to_club_id,
          freeAgentFee(f),
          'free_agent_fee',
          `海捞签入费（新违约金 ${f}m × 30%，销毁）`,
          actor,
        );
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
        await chargeBypassFee(
          env,
          transferId,
          transfer.to_club_id,
          diff,
          'match_diff_burn',
          `匹配差额（违约金 ${ev?.oldReleaseFee ?? '?'}m → ${f}m，销毁）`,
          actor,
        );
      }
      // F 提交时已定死：开会即快照 E（匹配不乘续约加薪）
      const opened = await openNegotiationSession(env, transferId, actor, review, { fixedReleaseFee: f || undefined });
      return { status: opened.status };
    }
    default:
      // v6.60.5：自由身强制拍卖没有现行合同可谈 RC——成交价在竞价时已定死，按海捞口径开会
      // （fixedReleaseFee = 成交价），买家直接谈工资；成约时 completeTransfer 的
      // saleFromClubId=null 分支新签合同，成交款销毁。
      // v6.60.7：CPU 队同理——CPU 不入账，也不按队内合同谈 RC，直接固定成交价。
      if (
        transfer.type === 'forced_auction' &&
        (transfer.from_club_id === null || (await cpuClubIds(env.DB)).has(transfer.from_club_id))
      ) {
        if (transfer.fee === null) throw new HttpError(409, '转会单缺成交价，数据不完整');
        return openNegotiationSession(env, transferId, actor, review, { fixedReleaseFee: transfer.fee });
      }
      // §5.4 回原队 A 分支（v6.54.0 步骤 5）：本窗已闹过涨薪的买回 = 跳过签约谈判、纯回归。
      // 本窗额度已耗尽（放着 demand 行），买家按合同行现值带回工资/RC/合同类型 → 直接过户；
      // 物理面（效力/保护期/签约时刻）与直拒后果由 completeTransfer 的快照恢复与回挂语句承担。
      // B 分支（无纠葛买回）续约基准（E × 1.05–1.15）在 submitReleaseFee 里按同一判定施加。
      const ret = await loadReturnClubContext(
        env.DB,
        transfer.player_id,
        transfer.to_club_id,
        transfer.season,
        transfer.window_seq,
        transferId,
      );
      if (ret.sameWindowDemand !== null) {
        return completeTransfer(env, transferId, actor, 'user', review);
      }
      return openNegotiationSession(env, transferId, actor, review);
  }
}

// ---- 窗内回滚（4.4.10）：续约完成后同窗被挂牌/激活/解约 → 更改无效 ----

export interface RollbackTrigger {
  refType: string;
  refId: number;
}

/**
 * 回滚该球员本窗全部已完成的续约单（4.4.10）：作废本窗普通续约的
 * `contract_pending_changes(source='renewal')`（关窗生效后合同三列本窗从未改过，§5.7），
 * 已收续约费逐单退还（退款流水 ref = 续约单本身，幂等闸使任何触发序列下每单只退一次——
 * 同窗可能被多个触发单先后命中回滚）。仅当球员仍归属原续约俱乐部时作废 pending 与退款
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
    // 关窗生效（v6.54.0 §5.7）：续约谈成只写 contract_pending_changes，contracts 本窗从未改过，
    // 回滚的正确动作是**作废这条 pending**（否则关窗批会把已回滚的涨幅照常 apply）。
    // 旧实现那半句 `UPDATE contracts SET release_fee/protection_ticks` 在本流程里已无事可做，
    // 留着还会在「pending 已被别的路径收口」时把合同写成旧值——删掉。
    statements.push(
      db
        .prepare(
          `UPDATE contract_pending_changes SET status = 'void', void_reason = 'rollback'
           WHERE player_id = ? AND club_id = ? AND source = 'renewal' AND status = 'pending'
             AND effective_window_seq = ?`,
        )
        .bind(playerId, clubId, win.windowSeq),
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
      origin: 'user',
      after: {
        // 合同三列本窗从未落库（§5.7），"还原"的实际动作是作废 pending；这两个字段留给
        // 运维对照「本窗第一张续约单之前的值」，不再表示发生过写合同
        priorReleaseFee: stillOwned ? ev.oldReleaseFee : null,
        priorProtectionTicks: stillOwned ? ev.oldProtectionTicks : null,
        voidedRenewalPending: stillOwned,
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
