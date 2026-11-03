// 签约谈判会话（TECH_DESIGN §6.7）：审核通过自动开会话（transfer → signing）；
// 签约方提交新违约金 F（±10/±50% 校验，快照 E）→ ≤3 轮工资报价 → 成约
// （negotiation/forced/direct）→ completeTransfer 过户（成约即过户）；解约无谈判。
// 需求方裁决（2026-09）：激活成交与普通成交一样走谈判；所有谈判会话均可直接选择
// 签训练营合同（0.75/5 双固定，不占规则 4.3.4(3) 每窗 2 名下放名额）。
// 崩溃自愈：结算与过户分两个 batch——会话先落 settled_wage/settle_source，随后过户；
// 任一时刻崩溃，下次触碰（GET/offer/trainee）检测「会话已结算但 transfer 仍 signing」
// 即按会话快照重放 completeTransfer（过户单点本身幂等，见 transfers.ts）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { abilityLevel, releaseFeeBounds, TRAINEE_RELEASE_FEE, TRAINEE_WAGE, voidReasonText } from '../core/negotiation-rules.ts';
import { AGENT_TIER_LABELS } from '../core/negotiation-rules.ts';
import { attemptExpected, directFail, expectedWage, previewForecast, satisfactionText, successRate } from './negotiation-secret.ts';
import { loadNegotiationContext, type AgentTierParams, type NegotiationContext } from './negotiation-context.ts';
import {
  applyContractTerms,
  completeTransfer,
  isReturnToFormerClub,
  loadTransfer,
  listingIdFromTransfer,
  parsePreSettleSnapshot,
  type ReviewDecision,
  type TransferRow,
} from './transfers.ts';
import { seededUnit } from '../core/seeded.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { createConfigService } from '../core/config.ts';
import { fmtBeijingMinute } from '../core/ops-schedule.ts';
import { queueClubNotification } from './notify.ts';
import type { ExpiryOpts } from './expiry-ops.ts';
import { assertOpOpen } from './ops-schedule.ts';
import { freeAgentFee, freeAgentFeeGap } from '../core/bypass-rules.ts';
import { availableBalance, creditLineGuard, ledgerMovement } from './ledger.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/** 买回前东家的续约基准加薪因子 draw 位（v6.54.0；与闹涨薪域 20/21 区分，core/seeded 统一随机源） */
const RETURN_RAISE_DRAW = 22;

// §6.10-6：判定随机数走 crypto.getRandomValues
function defaultRng(): number {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return new DataView(buf.buffer).getUint32(0) / 2 ** 32;
}

export interface SessionRow {
  id: number;
  transfer_id: number;
  player_id: number;
  club_id: number;
  expected_wage: number | null;
  release_fee: number | null;
  attempt_count: number;
  status: string;
  settled_wage: number | null;
  settle_source: string | null;
}

export function settleMessage(source: string): string {
  switch (source) {
    case 'negotiation':
      return '报价被经纪人接受，按你的报价签约';
    case 'direct':
      return '❌ 报价过低，谈判直接失败，已按该次预期工资结算';
    case 'forced':
      return '已按预期工资强制成约（3 轮未谈拢）';
    case 'trainee':
      return `已按训练营合同签入（工资 ${TRAINEE_WAGE}m/半赛季、违约金 ${TRAINEE_RELEASE_FEE}m，不占本窗下放名额）`;
    default:
      return '谈判已结束';
  }
}

async function loadSession(db: D1Database, sessionId: number): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, transfer_id, player_id, club_id, expected_wage, release_fee, attempt_count, status, settled_wage, settle_source
       FROM negotiation_sessions WHERE id = ?`,
    )
    .bind(sessionId)
    .first<SessionRow>();
}

async function loadSessionByTransfer(db: D1Database, transferId: number): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, transfer_id, player_id, club_id, expected_wage, release_fee, attempt_count, status, settled_wage, settle_source
       FROM negotiation_sessions WHERE transfer_id = ?`,
    )
    .bind(transferId)
    .first<SessionRow>();
}

interface PlayerFactsRow {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  agent_tier: number;
}

function loadPlayerFacts(db: D1Database, playerId: number): Promise<PlayerFactsRow | null> {
  return db
    .prepare('SELECT id, name, position, age, ca, pa, agent_tier FROM players WHERE id = ?')
    .bind(playerId)
    .first<PlayerFactsRow>();
}
export { loadPlayerFacts };
export type { PlayerFactsRow };

function tierParamsOf(ctx: { agentTiers: [AgentTierParams, AgentTierParams, AgentTierParams] }, tier: number): AgentTierParams {
  return ctx.agentTiers[tier - 1] ?? ctx.agentTiers[1];
}

// 审核通过 → 开会话：transfer → signing + 会话 + 审核表 + 审计，一个 batch；
// transfer_id UNIQUE 兜底重复开会（竞态/重放），整批回滚后按「已开过」处理。
// fixedReleaseFee：F 在提交时已定死（续约/匹配/海捞——附加费按它收），开会即快照 E，
// 之后 submitReleaseFee 拒绝改 F；renewalRaise：续约单 E × U(加薪区间)（规则 4.3.3）。
export interface OpenSessionOptions {
  fixedReleaseFee?: number;
  renewalRaise?: boolean;
}

/**
 * 开会话前的预检（v6.66.0 第 3 期）：审核通过时先过户再开谈，若「E 算不出来」这类 409 发生在
 * 结算之后，就会留下「钱已付、人已走、无谈判」的死单。调用方在结算之前先调本函数。
 */
export async function assertExpectedWageReady(
  db: D1Database,
  transfer: TransferRow,
  opts: OpenSessionOptions,
): Promise<void> {
  if (opts.fixedReleaseFee === undefined) return;
  const player = await loadPlayerFacts(db, transfer.player_id);
  if (!player || player.ca === null || player.pa === null || player.age === null) {
    throw new HttpError(409, '球员能力数据不完整，无法计算预期工资');
  }
}

export async function openNegotiationSession(
  env: Env,
  transferId: number,
  actor: number | null,
  review?: ReviewDecision,
  opts: OpenSessionOptions = {},
  origin: AuditOrigin = 'user',
): Promise<{ status: 'completed' | 'signing' | 'already'; expectedWage?: number }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'signing') return { status: 'already' };
  // v6.66.0：换队类单据在审核通过时已 completed（钱已付、人已走），会话挂在已结算的单上；
  // 上调（无审核步、附加费依赖谈成的 RC）仍从 pending_review 开谈，保持「成约才结算」。
  const settled = transfer.status === 'completed';
  if (!settled && transfer.status !== 'pending_review') {
    throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能进入签约谈判`);
  }
  if (transfer.to_club_id === null) throw new HttpError(409, '转会单缺签入方，数据不完整');

  let seededE: number | null = null;
  if (opts.fixedReleaseFee !== undefined) {
    const player = await loadPlayerFacts(db, transfer.player_id);
    if (!player || player.ca === null || player.pa === null || player.age === null) {
      throw new HttpError(409, '球员能力数据不完整，无法计算预期工资');
    }
    const ctx = await loadNegotiationContext(db);
    const level = abilityLevel(player.ca, player.pa, player.age, ctx.youngBlendAge);
    let e = expectedWage(level, opts.fixedReleaseFee, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
    if (opts.renewalRaise) {
      const [lo, hi] = ctx.renewalRaise;
      const roll = env.rng ?? defaultRng;
      e = Math.round(e * (1 + lo + (hi - lo) * roll()) * 100) / 100;
    }
    seededE = e;
  }

  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  if (!settled) {
    statements.push(
      db.prepare(`UPDATE transfers SET status = 'signing' WHERE id = ? AND status = 'pending_review'`).bind(transferId),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, release_fee, expected_wage, attempt_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 'active', ${nowSql()})`,
      )
      .bind(transferId, transfer.player_id, transfer.to_club_id, opts.fixedReleaseFee ?? null, seededE),
  );
  if (review) {
    statements.push(
      db
        .prepare(`UPDATE review_tasks SET status = ?, decided_by = ?, decided_at = ${nowSql()}, note = ? WHERE id = ? AND status = 'open'`)
        .bind(review.decision, review.decidedBy, review.note ?? null, review.taskId),
    );
  }
  statements.push(
    audit({
      actor,
      action: 'negotiation_open',
      targetType: 'negotiation',
      targetId: transferId,
      origin,
      after: {
        playerId: transfer.player_id,
        clubId: transfer.to_club_id,
        ...(opts.fixedReleaseFee !== undefined ? { fixedReleaseFee: opts.fixedReleaseFee, expectedWage: seededE } : {}),
      },
    }),
  );
  try {
    const results = await db.batch(statements);
    const statusChange = results[0]?.meta.changes ?? 0;
    // settled（换队类）：单据在审核通过时已经 completed，会话 INSERT 成功即算「已开谈」
    const opened = statusChange > 0;
    return { status: settled ? (opened ? 'completed' : 'already') : opened ? 'signing' : 'already', expectedWage: seededE ?? undefined };
  } catch (err) {
    if (String(err).includes('UNIQUE')) return { status: 'already' };
    throw err;
  }
}

// 会话已结算但后续两步没跟上（两 batch 之间崩溃）→ 按会话快照重放（幂等）：
// v6.66.0 起换队类单据在开会话之前就已过户，所以这里只补「条款落地」；
// 上调（仍走「成约才结算」）补的是整张过户单。
export async function healSettlement(env: Env, session: SessionRow, actor: number | null, origin: AuditOrigin): Promise<void> {
  if (session.status !== 'settled' || !session.settle_source) return;
  const transfer = await loadTransfer(env.DB, session.transfer_id);
  if (!transfer) return;
  const terms = {
    wage: session.settled_wage ?? TRAINEE_WAGE,
    // v6.71.0：训练营会话的 RC 固定 5。过去这里直接取 session.release_fee（报价时的值，可能 < 5），
    // 自愈重放会把合同里已经落好的 5 覆写成 1（生产 Virgili 2026-11-01 就是这样被写坏的）。
    releaseFee: session.settle_source === 'trainee' ? TRAINEE_RELEASE_FEE : (session.release_fee ?? TRAINEE_RELEASE_FEE),
    source: session.settle_source,
    contractType: (session.settle_source === 'trainee' ? 'trainee' : 'formal') as 'trainee' | 'formal',
  };
  if (transfer.status === 'completed') {
    await applyContractTerms(env, session.transfer_id, terms, actor, origin);
    return;
  }
  if (transfer.status !== 'signing') return;
  await completeTransfer(env, session.transfer_id, actor, origin, undefined, terms);
}

async function requireMyActiveSession(
  db: D1Database,
  env: Env,
  sessionId: number,
  clubId: number,
  actor: number | null,
): Promise<{ session: SessionRow; transfer: TransferRow }> {
  const session = await loadSession(db, sessionId);
  if (!session) throw new HttpError(404, '谈判会话不存在');
  if (session.club_id !== clubId) throw new HttpError(403, '只有签约方可以操作这次谈判');
  const transfer = await loadTransfer(db, session.transfer_id);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  // v6.66.0：单据 completed + 会话 active 现在是**正常态**（审核通过即过户，条款还在谈）。
  // 旧版的「反向自愈」在这里会把每一场正常谈判当场判死，已删。
  await healSettlement(env, session, actor, 'user');
  if (session.status !== 'active') throw new HttpError(409, '这场谈判已经结束了');
  if (transfer.status !== 'signing' && transfer.status !== 'completed') {
    throw new HttpError(409, '这单转会不在签约阶段');
  }
  return { session, transfer };
}

// F 在提交时已定死的成约路径（续约/匹配/海捞）：附加费按 F 收，谈判中不得再改
export const FIXED_FEE_TYPES: ReadonlySet<string> = new Set(['rc_change', 'match', 'free_agent', 'promotion']);

/**
 * 新违约金上下限的基准（v6.67.0）：**过户前**那份合同，不是现行合同。
 *
 * 换队类单据在审核通过时就过户了，此时现行合同已经是买方那一份；自由身/无合同成交还会先落一份
 * `release_fee = 0` 的占位合同（transfers.ts 的桥接分支），拿它算区间会把「本来没有旧合同」的单
 * 错卡在 1~10m。所以一律读 `pre_settle_snapshot.contract`；快照缺失（0088 之前的在途单）才回落
 * 现行合同行——那时还没过户，现行合同仍是卖方那份。两者都没有 ⇒ null = 可自由定（下限 1、上限不设）。
 */
export function rcBoundsFor(
  transfer: Pick<TransferRow, 'pre_settle_snapshot'>,
  liveReleaseFee: number | null,
): [number, number] | null {
  const snap = parsePreSettleSnapshot(transfer);
  const base = snap ? (snap.contract?.release_fee ?? null) : liveReleaseFee;
  return base === null ? null : releaseFeeBounds(base);
}

// 提交新违约金（整数 m）：±10/±50% 区间按球员现行 RC 校验；重算并快照 E（重设允许）
export async function submitReleaseFee(
  env: Env,
  transferId: number,
  clubId: number,
  actor: number | null,
  feeInput: unknown,
): Promise<{ ok: true; releaseFee: number; expectedWage: number }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  // v6.66.0：换队类在审核通过时已 completed（钱付了、人走了），条款还在谈，
  // 所以「已完成」正是提交新违约金的常态；只有还没进谈判的单才拒。
  if (transfer.status !== 'signing' && transfer.status !== 'completed') {
    throw new HttpError(409, '这单转会还没进入签约谈判');
  }
  // v6.49.0 运营时刻表：签约谈判自己的时段（提交违约金 = 谈判的第一步动作）
  await assertOpOpen(db, 'transfer_negotiation');
  if (FIXED_FEE_TYPES.has(transfer.type)) {
    throw new HttpError(400, '这单的新违约金在提交时已经定死了（附加费按它结算），直接报价即可');
  }
  const session = await loadSessionByTransfer(db, transferId);
  if (!session) throw new HttpError(404, '谈判会话不存在');
  if (session.club_id !== clubId) throw new HttpError(403, '只有签约方可以操作这次谈判');
  if (session.status !== 'active') {
    // 崩溃窗口（会话已结算、过户未跟上）也要在这里补过户，不留僵死单
    await healSettlement(env, session, actor, 'user');
    throw new HttpError(409, '这场谈判已经结束了');
  }

  const fee = Number(feeInput);
  if (!Number.isInteger(fee) || fee <= 0) throw new HttpError(400, '新违约金须为正整数（单位 m）');
  // v6.67.0：上下限以过户前合同为基准；没有过户前合同（自由身/CPU 强拍）⇒ 可自由定。
  // 现行合同行只给 0088 之前的在途单兜底（那时还没过户，现行合同仍是卖方那份）。
  const live = await db
    .prepare('SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(transfer.player_id)
    .first<{ release_fee: number | null }>();
  const bounds = rcBoundsFor(transfer, live?.release_fee ?? null);
  if (bounds) {
    const [low, high] = bounds;
    if (fee < low || fee > high) throw new HttpError(400, `新违约金需在 ${low}~${high} 之间（整数 m）`);
  }

  const player = await loadPlayerFacts(db, transfer.player_id);
  if (!player || player.ca === null || player.pa === null || player.age === null) {
    throw new HttpError(409, '球员能力数据不完整，无法计算预期工资');
  }
  const ctx = await loadNegotiationContext(db);
  const level = abilityLevel(player.ca, player.pa, player.age, ctx.youngBlendAge);
  let e = expectedWage(level, fee, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
  // §5.4 回原队 B 分支（v6.54.0 步骤 5）：买回前东家的签约谈判按续约基准（E × U(renewalRaise)，
  // 规则 4.3.3 同款区间）。普通转会/激活/拍卖在此处算 E（固定 F 的三型在开会时已快照），
  // 因子用确定性种子钉在 transfer 上——本函数允许重设 F，不能让买家反复重摇挑低 E。
  if (await isReturnToFormerClub(db, transfer.player_id, transfer.to_club_id)) {
    const [lo, hi] = ctx.renewalRaise;
    e = Math.round(e * (1 + lo + (hi - lo) * seededUnit([transferId], RETURN_RAISE_DRAW)) * 100) / 100;
  }

  const audit = createAuditStatement(db);
  const results = await db.batch([
    db
      .prepare(`UPDATE negotiation_sessions SET release_fee = ?, expected_wage = ? WHERE id = ? AND status = 'active'`)
      .bind(fee, e, session.id),
    audit({
      actor,
      action: 'negotiation_fee',
      targetType: 'negotiation',
      targetId: session.id,
      origin: 'user',
      after: { releaseFee: fee },
    }),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '这场谈判已经结束了');
  return { ok: true, releaseFee: fee, expectedWage: e };
}

export interface OfferOutcome {
  result: 'success' | 'fail' | 'direct' | 'forced';
  attemptNo: number;
  remaining: number;
  wage?: number;
  satisfaction?: string;
  risk?: boolean;
  message?: string;
}

interface AttemptRow {
  attempt_no: number;
  offered_wage: number;
  eff_expected: number;
  result: string;
}

interface AttemptListRow extends AttemptRow {
  session_id: number;
  feedback: string | null;
  created_at: string;
}

// 同一个 p 源（§6.10-2：eff / 成功率 / 阈值不出服务端）：提交报价、实时预览、列表读时现算三处共用，
// 免得「预览说一套、提交落地另一套」。feedback 是事后反应句（满意度 + 可选风险后缀），
// 与预览档位（previewForecast 的预测词）各表各的，两套阈值本就不同位。
function evaluateWage(
  ctx: NegotiationContext,
  e: number,
  attemptNo: number,
  wage: number,
  agentTier: number,
): { attemptNo: number; eff: number; p: number; tier: AgentTierParams; risk: boolean; feedback: string } {
  const eff = attemptExpected(e, attemptNo, ctx.attemptDecay);
  const p = successRate(wage, eff, ctx.sigmoidSlope, ctx.sigmoidMid);
  const tier = tierParamsOf(ctx, agentTier);
  const risk = p < tier.threshold;
  return {
    attemptNo,
    eff,
    p,
    tier,
    risk,
    feedback: satisfactionText(p, ...ctx.satisfaction) + (risk ? '（报价过低，有谈崩风险）' : ''),
  };
}

// 单次工资报价（事务内顺序固定，§6.7）：单调性（不耗次数）→ eff 衰减 → 直败 →
// 成功率 roll → 末轮强约。响应只含 结局/剩余次数/满意度文案/风险布尔/结算工资（§6.10-2）。
export async function offerWage(
  env: Env,
  sessionId: number,
  clubId: number,
  actor: number | null,
  wageInput: unknown,
): Promise<OfferOutcome> {
  const db = env.DB;
  const { session } = await requireMyActiveSession(db, env, sessionId, clubId, actor);
  // v6.49.0 运营时刻表：签约谈判自己的时段（报工资 = 谈判的推进动作）
  await assertOpOpen(db, 'transfer_negotiation');
  const ctx = await loadNegotiationContext(db);
  const roll = env.rng ?? defaultRng;

  const wage = Math.round(Number(wageInput) * 100) / 100;
  if (!Number.isFinite(wage) || wage < ctx.wageMin || wage > ctx.wageMax) {
    throw new HttpError(400, `报价需在 ${ctx.wageMin}~${ctx.wageMax} 之间（m/半赛季）`);
  }
  const e = session.expected_wage;
  if (e === null || session.release_fee === null) throw new HttpError(400, '请先提交新违约金，再开始报价');

  const attempts = await db
    .prepare('SELECT attempt_no, offered_wage, eff_expected, result FROM negotiation_attempts WHERE session_id = ? ORDER BY attempt_no')
    .bind(session.id)
    .all<AttemptRow>();
  const count = attempts.results.length;
  const last = attempts.results[count - 1] ?? null;

  // 幂等自愈（沿插件）：次数已满但会话未结算 → 补强约结算
  if (count >= ctx.maxAttempts) {
    await settleActiveSession(env, session, e, 'forced', actor, null);
    return { result: 'forced', attemptNo: count, remaining: 0, wage: e, message: settleMessage('forced') };
  }
  if (last && wage <= last.offered_wage) throw new HttpError(400, '报价必须高于上一次报价');

  const attemptNo = count + 1;
  const player = await loadPlayerFacts(db, session.player_id);
  const { eff, p, tier, risk, feedback: satisfaction } = evaluateWage(ctx, e, attemptNo, wage, player?.agent_tier ?? 2);

  if (directFail(p, tier.threshold, tier.probability, roll())) {
    const settleWage = attemptNo >= ctx.maxAttempts ? e : eff;
    await settleActiveSession(env, session, settleWage, 'direct', actor, { attemptNo, wage, eff, result: 'direct_fail', feedback: satisfaction, risk });
    return { result: 'direct', attemptNo, remaining: 0, wage: settleWage, message: settleMessage('direct') };
  }

  const success = roll() < p;
  if (success) {
    await settleActiveSession(env, session, wage, 'negotiation', actor, { attemptNo, wage, eff, result: 'success', feedback: satisfaction, risk });
    return { result: 'success', attemptNo, remaining: 0, wage, message: settleMessage('negotiation') };
  }
  if (attemptNo >= ctx.maxAttempts) {
    await settleActiveSession(env, session, e, 'forced', actor, { attemptNo, wage, eff, result: 'fail', feedback: satisfaction, risk });
    return { result: 'forced', attemptNo, remaining: 0, wage: e, message: settleMessage('forced') };
  }
  await settleActiveSession(env, session, null, 'record', actor, { attemptNo, wage, eff, result: 'fail', feedback: satisfaction, risk });
  return { result: 'fail', attemptNo, remaining: ctx.maxAttempts - attemptNo, satisfaction, risk };
}

export interface WageForecast {
  forecast: string;
  risk: boolean;
}

// 四档档位文案与 0.2/0.5/0.8 边界已挪到 negotiation-secret.ts（v6.54.0：闹涨薪的还价预览
// 要与这里「同一套词」，档位必须只有一份真源；本模块再导出保持既有 import 不动）。
export { previewForecast };

// 工资报价预览：输入即给档位，让盲赌变有据。零副作用——不落库、不耗轮次、不写审计、不触发强约。
// 鉴权与 GET 我的会话同级（无 assertTradable）：转会禁令只拦「谈」，不拦「看」。
export async function previewWage(
  env: Env,
  sessionId: number,
  clubId: number,
  actor: number | null,
  wageInput: unknown,
): Promise<WageForecast> {
  const db = env.DB;
  const { session } = await requireMyActiveSession(db, env, sessionId, clubId, actor);
  const ctx = await loadNegotiationContext(db);

  const wage = Math.round(Number(wageInput) * 100) / 100;
  if (!Number.isFinite(wage) || wage < ctx.wageMin || wage > ctx.wageMax) {
    throw new HttpError(400, `报价需在 ${ctx.wageMin}~${ctx.wageMax} 之间（m/半赛季）`);
  }
  const e = session.expected_wage;
  if (e === null || session.release_fee === null) throw new HttpError(400, '请先提交新违约金，再开始报价');

  const attempts = await db
    .prepare('SELECT attempt_no, offered_wage, eff_expected, result FROM negotiation_attempts WHERE session_id = ? ORDER BY attempt_no')
    .bind(session.id)
    .all<AttemptRow>();
  const count = attempts.results.length;
  // 次数已满按已了结回 409，但绝不在这里补强约结算：预览是只读动作，不替玩家做决定
  if (count >= ctx.maxAttempts) throw new HttpError(409, '这场谈判已经结束了');
  const last = attempts.results[count - 1] ?? null;
  if (last && wage <= last.offered_wage) throw new HttpError(400, '报价必须高于上一次报价');

  const player = await loadPlayerFacts(db, session.player_id);
  const evaluation = evaluateWage(ctx, e, count + 1, wage, player?.agent_tier ?? 2);
  return { forecast: previewForecast(evaluation.p), risk: evaluation.risk };
}

// v6.63.2：海捞的签入费在审核通过时按「提交的违约金 × 30%」收；直签训练营会把违约金落回
// 固定的 5m（规则 4.3.4(1)）——提交价低于 5m 时那笔费收少了要补收（否则等于拿 2m 违约金
// 花 0.6m 白拿一份 5m 的训练营合同），高于 5m 时多收的要退。钱都走同一本账，销毁侧记流水。
async function adjustTraineeSignFee(env: Env, transfer: TransferRow, clubId: number, actor: number | null): Promise<void> {
  if (transfer.type !== 'free_agent') return;
  const gap = freeAgentFeeGap(transfer.extra_fee ?? 0, TRAINEE_RELEASE_FEE);
  if (gap === 0) return;
  const db = env.DB;
  const required = freeAgentFee(TRAINEE_RELEASE_FEE);
  const collecting = gap > 0;
  const amount = Math.abs(gap);
  if (collecting) {
    const available = Math.round((await availableBalance(db, clubId)) * 100) / 100;
    if (available < amount) {
      throw new HttpError(
        409,
        `这单海捞提交的违约金低于训练营固定的 ${TRAINEE_RELEASE_FEE} m，签入费要补收 ${amount} m；俱乐部可支配 ${available} m 不够，先补足资金再签进训练营`,
      );
    }
  }
  // 补收时守卫与 availableBalance 同公式（含预期收入额度），并在批内对**批前**资金状态求值：
  // 预检过了但并发把余额占掉时，账本与附加费两条都不落。退款是入账，只守单据阶段。
  const credit = creditLineGuard(clubId);
  const guardSql = collecting
    ? `(SELECT status FROM transfers WHERE id = ?) IN ('signing', 'completed')` +
      ` AND COALESCE((SELECT balance FROM ledger_accounts WHERE club_id = ?), 0)` +
      ` - COALESCE((SELECT SUM(amount) FROM fund_holds WHERE club_id = ? AND status = 'held'), 0)` +
      ` + ${credit.sql}` +
      ` >= ?`
    : `(SELECT status FROM transfers WHERE id = ?) IN ('signing', 'completed')`;
  const guardParams = collecting ? [transfer.id, clubId, clubId, ...credit.params, amount] : [transfer.id];
  const results = await db.batch([
    ...ledgerMovement(db, {
      clubId,
      delta: collecting ? -amount : amount,
      kind: collecting ? 'free_agent_fee_topup' : 'free_agent_fee_refund',
      refType: 'transfer',
      refId: transfer.id,
      memo: collecting
        ? `海捞签入费补差（合同违约金按训练营 ${TRAINEE_RELEASE_FEE}m 计，合计 ${required}m，销毁）`
        : `海捞签入费退还（合同违约金按训练营 ${TRAINEE_RELEASE_FEE}m 计，合计 ${required}m）`,
      guardSql,
      guardParams,
    }),
    db
      .prepare(`UPDATE transfers SET extra_fee = ? WHERE id = ? AND status IN ('signing', 'completed') AND ${guardSql}`)
      .bind(required, transfer.id, ...guardParams),
    createAuditStatement(db)({
      actor,
      action: collecting ? 'bypass_fee_topup' : 'bypass_fee_refund',
      targetType: 'transfer',
      targetId: transfer.id,
      origin: 'user',
      before: { fee: transfer.fee, extraFee: transfer.extra_fee },
      after: { gap, extraFee: required, reason: 'trainee_rc_floor' },
    }),
  ]);
  // 账本那句的闸没过（并发动用）就查不到这笔流水——补收没落账不许白过成约。
  if ((results[1]?.meta.changes ?? 0) === 0) {
    throw new HttpError(409, collecting ? '补收签入费时资金刚被其他操作占用，稍后再试' : '退还签入费没落账，稍后再试');
  }
}

// 直签训练营：固定条款立即成约（需求方裁决，不占 4.3.4(3) 下放名额）。
// 续约/匹配是本队留人操作，不存在「签入」，不能借道把自家球员转进训练营（下放名额闸不被绕过）。
export async function chooseTrainee(
  env: Env,
  sessionId: number,
  clubId: number,
  actor: number | null,
): Promise<{ ok: true; result: 'trainee'; wage: number; message: string }> {
  const db = env.DB;
  const { session, transfer } = await requireMyActiveSession(db, env, sessionId, clubId, actor);
  // v6.49.0 运营时刻表：签约谈判自己的时段（选训练营合同 = 谈判的推进动作）
  await assertOpOpen(db, 'transfer_negotiation');
  if (transfer.type === 'rc_change' || transfer.type === 'match' || transfer.type === 'promotion') {
    throw new HttpError(400, '上调、续约和匹配都是留队操作，球员本来就在队里，不能转进训练营');
  }
  await adjustTraineeSignFee(env, transfer, clubId, actor);
  await settleActiveSession(env, session, TRAINEE_WAGE, 'trainee', actor, null);
  return { ok: true, result: 'trainee', wage: TRAINEE_WAGE, message: settleMessage('trainee') };
}

// 结算批次 1（会话侧）：optional attempt 流水 + attempt_count + 会话 settled 快照；
// settleSource='record' 只记报价不结算（内部用）。结算批次 2 = completeTransfer（幂等单点）。
async function settleActiveSession(
  env: Env,
  session: SessionRow,
  settleWage: number | null,
  settleSource: string,
  actor: number | null,
  attempt: { attemptNo: number; wage: number; eff: number; result: string; feedback: string; risk: boolean } | null,
): Promise<Record<string, never>> {
  const db = env.DB;
  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  if (attempt) {
    statements.push(
      db
        .prepare(
          `INSERT INTO negotiation_attempts (session_id, attempt_no, offered_wage, eff_expected, result, feedback, risk, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${nowSql()})`,
        )
        .bind(session.id, attempt.attemptNo, attempt.wage, attempt.eff, attempt.result, attempt.feedback, attempt.risk ? 1 : 0),
      db.prepare(`UPDATE negotiation_sessions SET attempt_count = ? WHERE id = ?`).bind(attempt.attemptNo, session.id),
    );
  }
  if (settleSource !== 'record') {
    statements.push(
      db
        .prepare(
          `UPDATE negotiation_sessions SET status = 'settled', settled_wage = ?, settle_source = ?, settled_at = ${nowSql()}
           WHERE id = ? AND status = 'active'`,
        )
        .bind(settleWage, settleSource, session.id),
    );
  }
  statements.push(
    audit({
      actor,
      action: attempt ? 'negotiation_offer' : settleSource === 'trainee' ? 'negotiation_trainee' : 'negotiation_settle',
      targetType: 'negotiation',
      targetId: session.id,
      origin: 'user',
      after: attempt ? { attemptNo: attempt.attemptNo, result: attempt.result } : { settleSource },
    }),
  );
  try {
    const results = await db.batch(statements);
    if (settleSource !== 'record' && (results[attempt ? 2 : 0]?.meta.changes ?? 0) === 0) {
      throw new HttpError(409, '这场谈判已经结束了');
    }
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '操作太快了，请稍后再试');
    throw err;
  }
  if (settleSource !== 'record') {
    const terms = {
      wage: settleWage ?? TRAINEE_WAGE,
      releaseFee: settleSource === 'trainee' ? TRAINEE_RELEASE_FEE : session.release_fee ?? TRAINEE_RELEASE_FEE,
      source: settleSource,
      contractType: (settleSource === 'trainee' ? 'trainee' : 'formal') as 'trainee' | 'formal',
    };
    // 批次 2：换队类单据已 completed（钱与归属在审核通过时就落定）⇒ 只落条款；
    // 上调是唯一「成约才结算」的类型，仍走整张过户。
    const transfer = await loadTransfer(db, session.transfer_id);
    if (transfer?.status === 'completed') {
      await applyContractTerms(env, session.transfer_id, terms, actor, 'user');
    } else {
      await completeTransfer(env, session.transfer_id, actor, 'user', undefined, terms);
    }
  }
  return {};
}

// 窗口推进强制结算（§6.4-6）：把活跃会话按 E 快照强约成约（成约即过户）。
// 没提交过新 RC（E 为 null）的会话返回 false，由调用方挡下关窗。
export async function forceSettleAtExpected(env: Env, sessionId: number, actor: number | null): Promise<boolean> {
  const session = await loadSession(env.DB, sessionId);
  if (!session || session.status !== 'active' || session.expected_wage === null) return false;
  await settleActiveSession(env, session, session.expected_wage, 'forced', actor, null);
  return true;
}

// v6.64.4 上调强约（到期引擎适配器 + 关窗批共用）：promotion 会话按 E 快照无条件成约。
// E 在开会时已快照（F 定死），false 只可能是会话已终局的竞态。closeAll=false（闸开着）不动作。
export async function forceSettlePromotionSessions(env: Env, opts: ExpiryOpts): Promise<number> {
  if (!opts.closeAll) return 0;
  const db = env.DB;
  const res = await db
    .prepare(
      `SELECT s.id, s.club_id, ${sqlDisplayName('p')} AS player_name
       FROM negotiation_sessions s
       JOIN transfers t ON t.id = s.transfer_id
       JOIN players p ON p.id = s.player_id
       WHERE s.status = 'active' AND t.status = 'signing' AND t.type = 'promotion' ORDER BY s.id LIMIT ?`,
    )
    .bind(opts.limit)
    .all<{ id: number; club_id: number; player_name: string }>();
  let settled = 0;
  for (const row of res.results) {
    if (!(await forceSettleAtExpected(env, row.id, null))) continue;
    settled++;
    await queueClubNotification(env, row.club_id, 'promotion_forced', { player: row.player_name });
  }
  return settled;
}

// 我的谈判列表（§6.10-2：只出 结局/剩余次数/满意度文案/风险布尔/E 数值；eff/p/阈值不出服务端）
// v6.65.4：进行中与已结束拆两条查询——历史不再挤占 active 的 50 行上限，已结束按 settled_at 倒序分页。
export interface MySessionsOpts {
  /** 已结束区的游标：只取 id < endedBefore 的行（null = 第一页） */
  endedBefore?: number | null;
  /** 已结束区每页条数，调用方已夹到 1..50 */
  endedLimit?: number;
}

export interface MySessionsResult {
  sessions: unknown[];
  ended: unknown[];
  /** 还有更早的已结束会话时给下一页的游标，否则 null */
  endedNextBefore: number | null;
}

// 静默截止的锚点：到期引擎与列表倒计时共用这一个表达式（v6.65.2 起上移到列表常量之前）
const SILENT_ANCHOR_SQL = `MAX(COALESCE(s.expiry_anchor_at, ''), COALESCE(s.created_at, ''),
             COALESCE((SELECT MAX(a.created_at) FROM negotiation_attempts a WHERE a.session_id = s.id), ''))`;

const SESSION_COLS = `SELECT s.id, s.transfer_id, s.status, s.release_fee, s.expected_wage, s.attempt_count, s.settled_wage, s.settle_source, s.settled_at,
              t.type AS transfer_type, t.status AS transfer_status, t.fee, t.pre_settle_snapshot AS transfer_snapshot,
              cf.name AS from_name, ct.name AS to_name, c_cur.release_fee AS current_rc,
              p.id AS player_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name, p.position, p.age, p.ca, p.pa, p.agent_tier,
              ${SILENT_ANCHOR_SQL} AS silent_anchor`;

const SESSION_JOINS = `FROM negotiation_sessions s
       JOIN transfers t ON t.id = s.transfer_id
       JOIN players p ON p.id = s.player_id
       LEFT JOIN clubs cf ON cf.id = t.from_club_id
       LEFT JOIN clubs ct ON ct.id = t.to_club_id
       LEFT JOIN contracts c_cur ON c_cur.player_id = s.player_id AND c_cur.is_active = 1`;

interface SessionListRow {
  id: number;
  transfer_id: number;
  status: string;
  release_fee: number | null;
  expected_wage: number | null;
  attempt_count: number;
  settled_wage: number | null;
  settle_source: string | null;
  settled_at: string | null;
  transfer_type: string;
  transfer_status: string;
  fee: number | null;
  transfer_snapshot: string | null;
  from_name: string | null;
  to_name: string | null;
  current_rc: number | null;
  player_id: number;
  player_fc_id: number | null;
  player_name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  agent_tier: number;
  silent_anchor: string;
}

export async function listMySessions(env: Env, clubId: number, opts: MySessionsOpts = {}): Promise<MySessionsResult> {
  const db = env.DB;
  const ctx = await loadNegotiationContext(db);
  const endedLimit = opts.endedLimit ?? 10;
  const endedBefore = opts.endedBefore ?? null;

  const active = await db
    .prepare(`${SESSION_COLS} ${SESSION_JOINS} WHERE s.club_id = ? AND s.status = 'active' ORDER BY s.id DESC`)
    .bind(clubId)
    .all<SessionListRow>();
  const endedPage = await db
    .prepare(
      `${SESSION_COLS} ${SESSION_JOINS}
       WHERE s.club_id = ? AND s.status IN ('settled', 'cancelled') AND (? IS NULL OR s.id < ?)
       ORDER BY COALESCE(s.settled_at, '') DESC, s.id DESC LIMIT ?`,
    )
    .bind(clubId, endedBefore, endedBefore, endedLimit)
    .all<SessionListRow>();

  // v6.65.2：静默截止时刻给前端做倒计时，口径与到期引擎同一个 anchor（SILENT_ANCHOR_SQL）
  const silenceH = await silenceHours(db);

  // 自愈扫描：会话已结算但过户未跟上的，先重放过户再返回（已结束区里才可能出现这种行）
  for (const row of endedPage.results) {
    // v6.66.0：换队类单据在成约前就已 completed，自愈扫描要看两种形态（applyContractTerms 自带幂等闸）
    if (row.status === 'settled' && row.settle_source && (row.transfer_status === 'signing' || row.transfer_status === 'completed')) {
      // v6.73.0：已成品（completed）的上调单在成约那一步就结算完了，快照里没有「还没落的条款」，
      // 重放只会撞 applyContractTerms 的上调拦截。生产 club 66 2026-11-03 就是这条把整张
      // GET /api/negotiations?mine=1 打成 409，签约谈判页签整个空掉（两笔在谈上调单看不到）。
      if (row.transfer_type === 'promotion' && row.transfer_status === 'completed') continue;
      try {
        await healSettlement(
          env,
          {
            id: row.id,
            transfer_id: row.transfer_id,
            player_id: row.player_id,
            club_id: clubId,
            expected_wage: row.expected_wage,
            release_fee: row.release_fee,
            attempt_count: row.attempt_count,
            status: row.status,
            settled_wage: row.settled_wage,
            settle_source: row.settle_source,
          },
          null,
          // GET 顺手自愈：不是人类主动触发，记惰性结算
          'lazy_settle',
        );
      } catch (err) {
        // 读路径不允许被单行自愈拖死：任何一行失败只留痕，列表照常返回
        console.warn('lazy healSettlement failed', row.id, err);
      }
    }
  }

  // 对话流只给进行中的会话（v6.65.4：已结束区不返 attempts，避免历史页一次拉几百条）
  const ids = active.results.map((r) => r.id);
  const attemptRows: AttemptListRow[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    if (slice.length === 0) continue;
    const placeholders = slice.map(() => '?').join(', ');
    const batch = await db
      .prepare(`SELECT session_id, attempt_no, offered_wage, eff_expected, result, feedback, created_at FROM negotiation_attempts WHERE session_id IN (${placeholders}) ORDER BY session_id, attempt_no`)
      .bind(...slice)
      .all<AttemptListRow>();
    attemptRows.push(...batch.results);
  }
  const bySession = new Map<number, AttemptListRow[]>();
  for (const a of attemptRows) {
    const list = bySession.get(a.session_id) ?? [];
    list.push(a);
    bySession.set(a.session_id, list);
  }

  // 作废原因只对 cancelled 的走一次批量审计查询
  const voidReasons = await loadVoidReasons(
    db,
    endedPage.results.filter((r) => r.status === 'cancelled').map((r) => r.id),
  );

  const toDto = (r: SessionListRow, attempts: AttemptListRow[], voidReason: string | null) => {
    const last = attempts[attempts.length - 1] ?? null;
    let lastSatisfaction: string | null = null;
    let lastRisk = false;
    if (r.status === 'active' && last && last.result === 'fail') {
      // 新行直接读落库的反馈；0066 之前的老行 feedback 为 NULL，按同一 p 源现算兜底
      const evaluation = evaluateWage(ctx, r.expected_wage ?? last.eff_expected, last.attempt_no, last.offered_wage, r.agent_tier);
      lastRisk = evaluation.risk;
      lastSatisfaction = last.feedback ?? evaluation.feedback;
    }
    return {
      id: r.id,
      transferId: r.transfer_id,
      status: r.status,
      transfer: { type: r.transfer_type, status: r.transfer_status, fee: r.fee },
      fromClubName: r.from_name,
      toClubName: r.to_name,
      player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, age: r.age, ca: r.ca, pa: r.pa },
      agentTier: r.agent_tier,
      agentTierLabel: AGENT_TIER_LABELS[r.agent_tier] ?? '普通',
      releaseFee: r.release_fee,
      // 新 RC 合法区间是公开规则（4.3.1 ±10/±50%），给前端做表单提示；
      // v6.67.0：基准是过户前合同，没有基准 ⇒ null（前端提示「可自由定」）
      rcBounds: r.status === 'active' ? rcBoundsFor({ pre_settle_snapshot: r.transfer_snapshot }, r.current_rc) : null,
      expectedWage: r.expected_wage,
      attemptsUsed: r.attempt_count,
      remaining: Math.max(0, ctx.maxAttempts - r.attempt_count),
      // 静默截止时刻（锚 + 配置小时数）；存量行为空串时给 null，前端不做倒计时
      expiresAt: r.silent_anchor ? new Date(Date.parse(r.silent_anchor) + silenceH * 3600_000).toISOString() : null,
      lastSatisfaction,
      lastRisk,
      attempts: attempts.map((a) => ({ attemptNo: a.attempt_no, offeredWage: a.offered_wage, result: a.result, at: a.created_at, feedback: a.feedback })),
      settled: r.status === 'settled' && r.settle_source
        ? { wage: r.settled_wage, source: r.settle_source, message: settleMessage(r.settle_source) }
        : null,
      // v6.65.4 已结束区：结束时间 / 结局 / 作废原因（进行中的会话三项都是 null）
      endedAt: r.status === 'active' ? null : r.settled_at,
      outcome: r.status === 'active' ? null : r.status === 'settled' ? ('signed' as const) : ('void' as const),
      voidReason,
    };
  };

  return {
    sessions: active.results.map((r) => toDto(r, bySession.get(r.id) ?? [], null)),
    ended: endedPage.results.map((r) => toDto(r, [], voidReasons.get(r.id) ?? null)),
    endedNextBefore: endedPage.results.length === endedLimit ? endedPage.results[endedPage.results.length - 1].id : null,
  };
}

/**
 * 已作废会话的作废原因（v6.65.4，零迁移）：从 audit_log 批量取最近一条作废审计，
 * 把 `action` + `after.reason` 交给纯映射函数转人话。
 */
async function loadVoidReasons(db: Env['DB'], sessionIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ACTIONS = ['negotiation_timeout', 'transfer_self_cancel', 'admin_negotiation_void'];
  for (let i = 0; i < sessionIds.length; i += 90) {
    const slice = sessionIds.slice(i, i + 90);
    if (slice.length === 0) continue;
    const placeholders = slice.map(() => '?').join(', ');
    const batch = await db
      .prepare(
        `SELECT target_id, action, after FROM audit_log
         WHERE target_type = 'negotiation' AND target_id IN (${placeholders})
           AND action IN (${ACTIONS.map(() => '?').join(', ')})
         ORDER BY target_id, id DESC`,
      )
      .bind(...slice, ...ACTIONS)
      .all<{ target_id: number; action: string | null; after: string | null }>();
    for (const row of batch.results) {
      if (out.has(row.target_id)) continue; // DESC 排序：每个会话取第一条（最近一次）
      let reason: string | null = null;
      if (row.after) {
        try {
          const parsed = JSON.parse(row.after) as { reason?: unknown };
          reason = typeof parsed.reason === 'string' ? parsed.reason : null;
        } catch {
          reason = null;
        }
      }
      out.set(row.target_id, voidReasonText(row.action, reason));
    }
  }
  return out;
}

// ---- 作废签约谈判的收口（v6.49.0：管理介入与到期引擎共用一处） ----

// 球员还原按合同类型：激活挂牌还原回训练营，普通挂牌还原回一线队（与审核驳回同口径）
export function playerRestoreSql(db: Env['DB'], playerId: number) {
  return db
    .prepare(
      `UPDATE players SET status = CASE WHEN (
         SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1
       ) = 'trainee' THEN 'trainee' ELSE 'normal' END, updated_at = ${nowSql()}
       WHERE id = ? AND status = 'listed'`,
    )
    .bind(playerId, playerId);
}

export interface VoidSigningOpts {
  actor: number | null;
  origin: AuditOrigin;
  /** 审计动作名（管理介入 = admin_negotiation_void；超时 = negotiation_timeout） */
  action: string;
  /** 挂牌 deadline_note 上的话术 */
  deadlineNote: string;
  /** 审计 after.reason */
  reason: string;
}

/**
 * 签约谈判作废收口：会话关闭 + 解冻挂牌冻结 + 撤活跃出价 + 挂牌下架 + 球员还原 + 转会单驳回，
 * 一个 batch，每条守卫 WHERE 幂等。守卫未命中返回 'already'（超时路径静默跳过，不抛错）。
 */
export async function voidSigningCore(env: Env, sessionId: number, opts: VoidSigningOpts): Promise<'done' | 'already'> {
  const db = env.DB;
  const session = await db
    .prepare('SELECT id, transfer_id, status FROM negotiation_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ id: number; transfer_id: number; status: string }>();
  if (!session || session.status !== 'active') return 'already';
  const transfer = await loadTransfer(db, session.transfer_id);
  if (!transfer || transfer.status !== 'signing') return 'already';
  const listingId = listingIdFromTransfer(transfer);
  const audit = createAuditStatement(db);
  const results = await db.batch([
    db.prepare(`UPDATE negotiation_sessions SET status = 'cancelled', settled_at = ${nowSql()} WHERE id = ? AND status = 'active'`).bind(sessionId),
    db.prepare(`UPDATE fund_holds SET status = 'released' WHERE ref_type = 'listing' AND ref_id IS ? AND status = 'held'`).bind(listingId),
    db.prepare(`UPDATE bids SET status = 'withdrawn' WHERE listing_id = ? AND status = 'active'`).bind(listingId),
    db.prepare(`UPDATE listings SET status = 'delisted', deadline_note = ? WHERE id = ? AND status = 'pending_review'`).bind(opts.deadlineNote, listingId),
    playerRestoreSql(db, transfer.player_id),
    db.prepare(`UPDATE transfers SET status = 'rejected' WHERE id = ? AND status = 'signing'`).bind(transfer.id),
    audit({
      actor: opts.actor,
      action: opts.action,
      targetType: 'negotiation',
      targetId: sessionId,
      origin: opts.origin,
      after: { reason: opts.reason, transferId: transfer.id, playerId: transfer.player_id },
    }),
  ]);
  return (results[0].meta.changes ?? 0) > 0 ? 'done' : 'already';
}

// ---- 到期引擎适配器（v6.49.0）：签约谈判静默超时 ----
// 锚 = MAX(expiry_anchor_at, created_at, 最后一次工资报价)：每一轮报价都刷新静默时钟。
// 存量宽限同报价：expiry_anchor_at 为空的行首次扫描按 now 打标，避免上线首 tick 批量误杀。

const NEGOTIATION_SILENCE_HOURS_DEFAULT = 72;

function isoMinusHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) - hours * 3600_000).toISOString();
}

async function silenceHours(db: D1Database): Promise<number> {
  const hours = await createConfigService(db).getNumber('negotiation_silence_hours');
  return hours && hours > 0 ? hours : NEGOTIATION_SILENCE_HOURS_DEFAULT;
}

interface SilentSessionRow {
  id: number;
  transfer_id: number;
  club_id: number;
  anchor: string;
  player_name: string;
}

const SILENT_SESSION_SELECT = `
  SELECT s.id, s.transfer_id, s.club_id, t.type AS transfer_type, ${SILENT_ANCHOR_SQL} AS anchor,
         ${sqlDisplayName('p')} AS player_name
  FROM negotiation_sessions s
  JOIN transfers t ON t.id = s.transfer_id
  JOIN players p ON p.id = s.player_id`;

/**
 * 已完成单据的超时兜底（v6.66.0 D3）：签约方一直没交新违约金、E 出不来时，按球员**现行合同**
 * 的工资收口。取的是他原本的条款，不凭空造新价；会话照常 settled + settle_source='forced'，
 * 不留悬空会话，也不动归属（人已经在买方队里了）。
 */
async function settleAtBaseTerms(env: Env, row: SilentSessionRow): Promise<boolean> {
  const db = env.DB;
  const session = await loadSession(db, row.id);
  if (!session || session.status !== 'active') return false;
  // v6.67.0：强拍单放开后可能停在「RC 未定、E 未出」就被静默/关通道收口（E 有值时走
  // forceSettleAtExpected，不会到这里）。这时不能按现行合同兜底：自由身 / CPU 球员过户时落的是
  // 占位合同（wage 0、signed_at NULL），按它强约会签出工资 0 的合同。默认口径 = 成交价当违约金
  //（会话里已有预填就沿用预填，生产三单就是这种形态）、工资取该违约金的预期值——与本版之前
  //「定死成成交价 + 开会即快照 E」的结果一致。
  if (session.expected_wage === null) {
    const transfer = await loadTransfer(db, session.transfer_id);
    if (transfer?.type === 'forced_auction' && transfer.fee !== null && transfer.fee > 0) {
      const rc = session.release_fee ?? transfer.fee;
      const player = await loadPlayerFacts(db, session.player_id);
      if (player && player.ca !== null && player.pa !== null && player.age !== null) {
        const ctx = await loadNegotiationContext(db);
        const level = abilityLevel(player.ca, player.pa, player.age, ctx.youngBlendAge);
        const e = expectedWage(level, rc, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
        await settleActiveSession(env, { ...session, release_fee: rc }, e, 'forced', null, null);
        return true;
      }
    }
  }
  const contract = await db
    .prepare(`SELECT wage FROM contracts WHERE player_id = ? AND is_active = 1`)
    .bind(session.player_id)
    .first<{ wage: number | null }>();
  await settleActiveSession(env, session, contract?.wage ?? 0, 'forced', null, null);
  return true;
}

export async function closeSilentSessions(env: Env, opts: ExpiryOpts): Promise<number> {
  const db = env.DB;
  const hours = await silenceHours(db);
  const cutoff = isoMinusHours(opts.nowIso, hours);
  let rows: SilentSessionRow[];
  if (opts.closeAll) {
    // v6.64.4：上调谈判不随 transfer_negotiation 行收口作废——它的终局是 成约/谈崩/自取消/关窗强约
    //（promotion 适配器与关窗批负责强约），混进这里会被静默作废语义误伤。
    const res = await db
      .prepare(`${SILENT_SESSION_SELECT} WHERE s.status = 'active' AND t.type != 'promotion' ORDER BY s.id LIMIT ?`)
      .bind(opts.limit)
      .all<SilentSessionRow>();
    rows = res.results;
  } else {
    await db
      .prepare(`UPDATE negotiation_sessions SET expiry_anchor_at = ? WHERE status = 'active' AND expiry_anchor_at = ''`)
      .bind(opts.nowIso)
      .run();
    const res = await db
      .prepare(`${SILENT_SESSION_SELECT} WHERE s.status = 'active' AND t.type != 'promotion' AND s.expiry_anchor_at != '' AND ${SILENT_ANCHOR_SQL} <= ? ORDER BY s.id LIMIT ?`)
      .bind(cutoff, opts.limit)
      .all<SilentSessionRow>();
    rows = res.results;
  }
  let closed = 0;
  for (const row of rows) {
    const reasonText = opts.closeAll ? '签约谈判通道已结束' : `超过 ${hours} 小时没有动作`;
    // v6.66.0（D3）：换队类单据在审核通过时就 completed —— 人已经到买方、钱已经划走，
    // 「超时作废」在这个形态下等于把球员从买方手里抢走（D2 明确不留退回原队的出口）。
    // 所以已完成单的超时收口改成「按 E 强约，E 未出则按球员现行条款强约」，settle_source 仍记 forced。
    const transfer = await loadTransfer(db, row.transfer_id);
    if (transfer?.status === 'completed') {
      const forced = (await forceSettleAtExpected(env, row.id, null)) || (await settleAtBaseTerms(env, row));
      if (!forced) continue;
      closed++;
      await queueClubNotification(env, row.club_id, 'negotiation_timeout', { player: row.player_name, hours, reason: reasonText });
      const sellerDone = await sellerClubOf(db, row.transfer_id);
      if (sellerDone !== null && sellerDone !== row.club_id) {
        await queueClubNotification(env, sellerDone, 'negotiation_timeout', { player: row.player_name, hours, reason: reasonText });
      }
      continue;
    }
    const result = await voidSigningCore(env, row.id, {
      actor: null,
      origin: opts.origin,
      action: 'negotiation_timeout',
      deadlineNote: `${reasonText}，自动作废`,
      reason: opts.closeAll ? 'ops_end' : 'silence_timeout',
    });
    if (result !== 'done') continue;
    closed++;
    await queueClubNotification(env, row.club_id, 'negotiation_timeout', { player: row.player_name, hours, reason: reasonText });
    const seller = await sellerClubOf(db, row.transfer_id);
    if (seller !== null && seller !== row.club_id) {
      await queueClubNotification(env, seller, 'negotiation_timeout', { player: row.player_name, hours, reason: reasonText });
    }
  }
  return closed;
}

/** 临近提醒：距静默超时不足 remindLeadHours 提醒一次（reminded_at 抢占），只发签约方。 */
export async function remindSilentSessions(env: Env, opts: ExpiryOpts): Promise<number> {
  const db = env.DB;
  const hours = await silenceHours(db);
  if (opts.remindLeadHours <= 0 || hours <= opts.remindLeadHours) return 0;
  const cutoff = isoMinusHours(opts.nowIso, hours);
  const remindFrom = isoMinusHours(opts.nowIso, hours - opts.remindLeadHours);
  const res = await db
    .prepare(
      `${SILENT_SESSION_SELECT}
       WHERE s.status = 'active' AND t.type != 'promotion' AND s.expiry_anchor_at != '' AND s.reminded_at = ''
         AND ${SILENT_ANCHOR_SQL} <= ? AND ${SILENT_ANCHOR_SQL} > ?
       ORDER BY s.id LIMIT ?`,
    )
    .bind(remindFrom, cutoff, opts.limit)
    .all<SilentSessionRow>();
  let sent = 0;
  for (const row of res.results) {
    const deadline = fmtBeijingMinute(new Date(Date.parse(row.anchor) + hours * 3600_000).toISOString());
    const claimed = await db
      .prepare(`UPDATE negotiation_sessions SET reminded_at = ? WHERE id = ? AND status = 'active' AND reminded_at = ''`)
      .bind(opts.nowIso, row.id)
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue;
    await queueClubNotification(env, row.club_id, 'negotiation_deadline', { player: row.player_name, deadline, hours });
    sent++;
  }
  return sent;
}

/** 挂牌方（原俱乐部）：签约破裂后他们要知道球员回到自己手里、挂牌已下架。 */
async function sellerClubOf(db: D1Database, transferId: number): Promise<number | null> {
  const transfer = await loadTransfer(db, transferId);
  const listingId = transfer ? listingIdFromTransfer(transfer) : null;
  if (listingId === null) return null;
  const row = await db.prepare(`SELECT seller_club_id FROM listings WHERE id = ?`).bind(listingId).first<{ seller_club_id: number | null }>();
  return row?.seller_club_id ?? null;
}
