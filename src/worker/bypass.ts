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
import { availableBalance, ledgerMovement } from './ledger.ts';
import { getOpenWindow, type OpenWindow } from './seasons.ts';
import { assertOpOpen, opBlockReason } from './ops-schedule.ts';
import { closedRegularTicks } from './contract-ticks.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import {
  completeTermination,
  loadTransfer,
  transferEvidence,
  type ReviewDecision,
} from './transfers.ts';
import { openNegotiationSession } from './negotiations.ts';
import { cpuClubIds } from './growth.ts';
import { rowDisplayName } from '../core/player-name.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface RcChangeEvidence {
  oldReleaseFee: number;
  oldProtectionTicks: number | null;
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

async function ensureNotInFlight(db: D1Database, playerId: number): Promise<void> {
  const kind = await findInFlight(db, playerId);
  if (kind === 'listing') throw new HttpError(400, '这名球员已经有一单在市场流程里了，等它结束再操作');
  if (kind === 'pending') throw new HttpError(400, '这名球员有一张单据正在等管理组审核，先等审核结果');
}

export type SeaSignStage = 'window' | 'ownership' | 'status' | 'banned' | 'listing' | 'pending' | 'ok';

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
  const guardSql =
    `(SELECT status FROM transfers WHERE id = ?) = 'pending_review'` +
    ` AND COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0)` +
    ` - COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0)` +
    (sealedHold ? ` + COALESCE((SELECT amount FROM fund_holds WHERE id = ? AND status = 'held'), 0)` : '') +
    ` >= ?`;
  const guardParams = [transferId, clubId, clubId, ...(sealedHold ? [sealedHold.id] : []), amount];
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
  const statements = [
    auditStmt,
    ...ledger,
    ...(sealedHold
      ? [db.prepare(`UPDATE fund_holds SET status = 'settled' WHERE id = ? AND status = 'held'`).bind(sealedHold.id)]
      : []),
    db
      .prepare(`UPDATE transfers SET extra_fee = ? WHERE id = ? AND status = 'pending_review' AND extra_fee IS NULL`)
      .bind(amount, transferId),
  ];
  const results = await db.batch(statements);
  // 流水没落：要么这笔已收过（幂等重试，静默返回），要么批内余额/状态守卫没过（资金刚被并发动用）
  if ((results[statements.length - 1]?.meta.changes ?? 0) === 0) {
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
    .prepare('SELECT release_fee, contract_type, protection_ticks FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null; contract_type: string; protection_ticks: number | null }>();
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
  // 两道都过 ⇒ 普通续约既有流程零变化（无 demand 行、无 active session 时不新增任何写路径）。
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
    origin: 'user',
    type: 'rc_change',
    playerId,
    fromClubId: clubId,
    toClubId: clubId,
    fee: newFee,
    extraFee: null,
    season: win.season,
    windowSeq: win.windowSeq,
    evidence: { oldReleaseFee: oldRc, oldProtectionTicks: contract.protection_ticks },
    payload: {
      kind: 'rc_change',
      playerId,
      playerName: rowDisplayName(player),
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

  const player = await db
    .prepare(
      `SELECT p.id, p.name, p.club_id, p.status, p.position, p.ca, c.name AS club_name
       FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?`,
    )
    .bind(playerId)
    .first<{
      id: number;
      name: string;
      club_id: number | null;
      status: string;
      position: string | null;
      ca: number | null;
      club_name: string | null;
    }>();
  if (!player || player.club_id === null) throw new HttpError(404, '球员不存在或没有归属');

  const isGk = player.position === 'GK';
  let caRank: number | null = null;
  let topSixLine: number | null = null;
  const stats = await db
    .prepare(`SELECT COUNT(*) AS n FROM players WHERE club_id = ? AND position != 'GK' AND ca IS NOT NULL`)
    .bind(player.club_id)
    .first<{ n: number }>();
  const nonGkWithCa = stats?.n ?? 0;
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
  const reference: ForcedAuctionReference = {
    playerId: player.id,
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
  // CPU 队不入账（v2.0.0，用户裁决）：CPU 队球员即整队都是「海里的」，不参与强制拍卖
  // （否则拍卖成交会把成交价记到 CPU 队头上）
  if ((await cpuClubIds(db)).has(player.club_id)) {
    blockers.push({ status: 400, message: 'CPU 队球员不参与强制拍卖（CPU 队不入账）' });
  }
  if (player.status !== 'normal') {
    blockers.push({
      status: 400,
      message: player.status === 'listed' ? '这名球员已经在挂牌流程里了' : '当前状态不能强制拍卖',
    });
  } else if ((await findInFlight(db, playerId)) === 'listing') {
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
  if (clubId === null) throw new HttpError(404, '球员不存在或没有归属'); // 预检已拦，仅类型收窄
  const win = await getOpenWindow(db); // 预检已确认在开，这里取 season/windowSeq 落库
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能发起强制拍卖', 'no_window');
  await ensureNotInFlight(db, playerId); // 预检后有单据刚进流程的兜底

  const audit = createAuditStatement(db);
  // v6.24.1：强制拍并入统一截止规则——创建即按 bidDeadline 首算落 deadline_at（无人出价同计静默），
  // 与普通挂牌同轨：卡片读秒、到期提前下架收费；出口仍保留窗尾收口与管理方取消
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
  }).deadlineAt;
  const statements = [
    db
      .prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`)
      .bind(playerId, clubId),
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
      origin: 'user',
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
      return completeTermination(env, transferId, actor, 'user', review);
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
        .prepare(`UPDATE contracts SET release_fee = ?, protection_ticks = ? WHERE player_id = ? AND is_active = 1`)
        .bind(ev.oldReleaseFee, ev.oldProtectionTicks, playerId),
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
        restoredReleaseFee: stillOwned ? ev.oldReleaseFee : null,
        restoredProtectionTicks: stillOwned ? ev.oldProtectionTicks : null,
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
