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
import { abilityLevel, releaseFeeBounds, TRAINEE_RELEASE_FEE, TRAINEE_WAGE } from '../core/negotiation-rules.ts';
import { AGENT_TIER_LABELS } from '../core/negotiation-rules.ts';
import { attemptExpected, directFail, expectedWage, satisfactionText, successRate } from './negotiation-secret.ts';
import { loadNegotiationContext, type AgentTierParams } from './negotiation-context.ts';
import { completeTransfer, loadTransfer, type ReviewDecision, type TransferRow } from './transfers.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { sqlDisplayName } from '../core/player-name.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

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

export async function openNegotiationSession(
  env: Env,
  transferId: number,
  actor: number | null,
  review?: ReviewDecision,
  opts: OpenSessionOptions = {},
): Promise<{ status: 'signing' | 'already'; expectedWage?: number }> {
  const db = env.DB;
  const transfer = await loadTransfer(db, transferId);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  if (transfer.status === 'signing') return { status: 'already' };
  if (transfer.status !== 'pending_review') throw new HttpError(409, `转会单当前状态是 ${transfer.status}，不能进入签约谈判`);
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
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE transfers SET status = 'signing' WHERE id = ? AND status = 'pending_review'`).bind(transferId),
    db
      .prepare(
        `INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, release_fee, expected_wage, attempt_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 'active', ${nowSql()})`,
      )
      .bind(transferId, transfer.player_id, transfer.to_club_id, opts.fixedReleaseFee ?? null, seededE),
  ];
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
      origin: 'user',
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
    return { status: statusChange > 0 ? 'signing' : 'already', expectedWage: seededE ?? undefined };
  } catch (err) {
    if (String(err).includes('UNIQUE')) return { status: 'already' };
    throw err;
  }
}

// 会话已结算但过户未跟上（两 batch 之间崩溃）→ 按会话快照重放过户（幂等）
export async function healSettlement(env: Env, session: SessionRow, actor: number | null, origin: AuditOrigin): Promise<void> {
  if (session.status !== 'settled' || !session.settle_source) return;
  const transfer = await loadTransfer(env.DB, session.transfer_id);
  if (!transfer || transfer.status !== 'signing') return;
  await completeTransfer(env, session.transfer_id, actor, origin, undefined, {
    wage: session.settled_wage ?? TRAINEE_WAGE,
    releaseFee: session.release_fee ?? TRAINEE_RELEASE_FEE,
    source: session.settle_source,
    contractType: session.settle_source === 'trainee' ? 'trainee' : 'formal',
  });
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
  if (transfer.status === 'completed' && session.status === 'active') {
    // 反向自愈：过户已到而会话未记（理论不可达，防御性收口）
    await db
      .prepare(`UPDATE negotiation_sessions SET status = 'settled', settled_at = ${nowSql()} WHERE id = ? AND status = 'active'`)
      .bind(session.id)
      .run();
    session.status = 'settled';
  }
  await healSettlement(env, session, actor, 'user');
  if (session.status !== 'active') throw new HttpError(409, '这场谈判已经结束了');
  if (transfer.status !== 'signing') throw new HttpError(409, '这单转会不在签约阶段');
  return { session, transfer };
}

// F 在提交时已定死的成约路径（续约/匹配/海捞）：附加费按 F 收，谈判中不得再改
export const FIXED_FEE_TYPES: ReadonlySet<string> = new Set(['rc_change', 'match', 'free_agent']);

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
  if (transfer.status === 'completed') throw new HttpError(409, '这单转会已经完成了');
  if (transfer.status !== 'signing') throw new HttpError(409, '这单转会还没进入签约谈判');
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
  const contract = await db
    .prepare('SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(transfer.player_id)
    .first<{ release_fee: number | null }>();
  if (!contract) throw new HttpError(409, '球员没有现行合同，数据不完整');
  const [low, high] = releaseFeeBounds(contract.release_fee ?? 0);
  if (fee < low || fee > high) throw new HttpError(400, `新违约金需在 ${low}~${high} 之间（整数 m）`);

  const player = await loadPlayerFacts(db, transfer.player_id);
  if (!player || player.ca === null || player.pa === null || player.age === null) {
    throw new HttpError(409, '球员能力数据不完整，无法计算预期工资');
  }
  const ctx = await loadNegotiationContext(db);
  const level = abilityLevel(player.ca, player.pa, player.age, ctx.youngBlendAge);
  const e = expectedWage(level, fee, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);

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
  const eff = attemptExpected(e, attemptNo, ctx.attemptDecay);
  const p = successRate(wage, eff, ctx.sigmoidSlope, ctx.sigmoidMid);
  const player = await loadPlayerFacts(db, session.player_id);
  const tier = tierParamsOf(ctx, player?.agent_tier ?? 2);
  const risk = p < tier.threshold;
  const satisfaction = satisfactionText(p, ...ctx.satisfaction) + (risk ? '（报价过低，有谈崩风险）' : '');

  if (directFail(p, tier.threshold, tier.probability, roll())) {
    const settleWage = attemptNo >= ctx.maxAttempts ? e : eff;
    await settleActiveSession(env, session, settleWage, 'direct', actor, { attemptNo, wage, eff, result: 'direct_fail' });
    return { result: 'direct', attemptNo, remaining: 0, wage: settleWage, message: settleMessage('direct') };
  }

  const success = roll() < p;
  if (success) {
    await settleActiveSession(env, session, wage, 'negotiation', actor, { attemptNo, wage, eff, result: 'success' });
    return { result: 'success', attemptNo, remaining: 0, wage, message: settleMessage('negotiation') };
  }
  if (attemptNo >= ctx.maxAttempts) {
    await settleActiveSession(env, session, e, 'forced', actor, { attemptNo, wage, eff, result: 'fail' });
    return { result: 'forced', attemptNo, remaining: 0, wage: e, message: settleMessage('forced') };
  }
  await settleActiveSession(env, session, null, 'record', actor, { attemptNo, wage, eff, result: 'fail' });
  return { result: 'fail', attemptNo, remaining: ctx.maxAttempts - attemptNo, satisfaction, risk };
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
  if (transfer.type === 'rc_change' || transfer.type === 'match') {
    throw new HttpError(400, '续约和匹配是留人操作，球员本来就在队里，不能转进训练营');
  }
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
  attempt: { attemptNo: number; wage: number; eff: number; result: string } | null,
): Promise<Record<string, never>> {
  const db = env.DB;
  const audit = createAuditStatement(db);
  const statements: D1PreparedStatement[] = [];
  if (attempt) {
    statements.push(
      db
        .prepare(
          `INSERT INTO negotiation_attempts (session_id, attempt_no, offered_wage, eff_expected, result, created_at)
           VALUES (?, ?, ?, ?, ?, ${nowSql()})`,
        )
        .bind(session.id, attempt.attemptNo, attempt.wage, attempt.eff, attempt.result),
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
    await completeTransfer(env, session.transfer_id, actor, 'user', undefined, {
      wage: settleWage ?? TRAINEE_WAGE,
      releaseFee: settleSource === 'trainee' ? TRAINEE_RELEASE_FEE : session.release_fee ?? TRAINEE_RELEASE_FEE,
      source: settleSource,
      contractType: settleSource === 'trainee' ? 'trainee' : 'formal',
    });
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

// 我的谈判列表（§6.10-2：只出 结局/剩余次数/满意度文案/风险布尔/E 数值；eff/p/阈值不出服务端）
export async function listMySessions(env: Env, clubId: number): Promise<unknown[]> {
  const db = env.DB;
  const ctx = await loadNegotiationContext(db);
  const rows = await db
    .prepare(
      `SELECT s.id, s.transfer_id, s.status, s.release_fee, s.expected_wage, s.attempt_count, s.settled_wage, s.settle_source,
              t.type AS transfer_type, t.status AS transfer_status, t.fee,
              cf.name AS from_name, ct.name AS to_name, c_cur.release_fee AS current_rc,
              p.id AS player_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name, p.position, p.age, p.ca, p.pa, p.agent_tier
       FROM negotiation_sessions s
       JOIN transfers t ON t.id = s.transfer_id
       JOIN players p ON p.id = s.player_id
       LEFT JOIN clubs cf ON cf.id = t.from_club_id
       LEFT JOIN clubs ct ON ct.id = t.to_club_id
       LEFT JOIN contracts c_cur ON c_cur.player_id = s.player_id AND c_cur.is_active = 1
       WHERE s.club_id = ? ORDER BY s.id DESC LIMIT 50`,
    )
    .bind(clubId)
    .all<{
      id: number;
      transfer_id: number;
      status: string;
      release_fee: number | null;
      expected_wage: number | null;
      attempt_count: number;
      settled_wage: number | null;
      settle_source: string | null;
      transfer_type: string;
      transfer_status: string;
      fee: number | null;
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
    }>();

  // 自愈扫描：会话已结算但过户未跟上的，先重放过户再返回
  for (const row of rows.results) {
    if (row.status === 'settled' && row.settle_source && row.transfer_status === 'signing') {
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
    }
  }

  const ids = rows.results.map((r) => r.id);
  const attemptRows: { session_id: number; attempt_no: number; offered_wage: number; eff_expected: number; result: string }[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    if (slice.length === 0) continue;
    const placeholders = slice.map(() => '?').join(', ');
    const batch = await db
      .prepare(`SELECT session_id, attempt_no, offered_wage, eff_expected, result FROM negotiation_attempts WHERE session_id IN (${placeholders}) ORDER BY session_id, attempt_no`)
      .bind(...slice)
      .all<{ session_id: number; attempt_no: number; offered_wage: number; eff_expected: number; result: string }>();
    attemptRows.push(...batch.results);
  }
  const bySession = new Map<number, { attempt_no: number; offered_wage: number; eff_expected: number; result: string }[]>();
  for (const a of attemptRows) {
    const list = bySession.get(a.session_id) ?? [];
    list.push(a);
    bySession.set(a.session_id, list);
  }

  return rows.results.map((r) => {
    const attempts = bySession.get(r.id) ?? [];
    const last = attempts[attempts.length - 1] ?? null;
    let lastSatisfaction: string | null = null;
    let lastRisk = false;
    if (r.status === 'active' && last && last.result === 'fail') {
      const p = successRate(last.offered_wage, last.eff_expected, ctx.sigmoidSlope, ctx.sigmoidMid);
      const tier = tierParamsOf(ctx, r.agent_tier);
      lastRisk = p < tier.threshold;
      lastSatisfaction = satisfactionText(p, ...ctx.satisfaction) + (lastRisk ? '（报价过低，有谈崩风险）' : '');
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
      // 新 RC 合法区间是公开规则（4.3.1 ±10/±50%），给前端做表单提示
      rcBounds: r.current_rc !== null && r.status === 'active' ? releaseFeeBounds(r.current_rc) : null,
      expectedWage: r.expected_wage,
      attemptsUsed: r.attempt_count,
      remaining: Math.max(0, ctx.maxAttempts - r.attempt_count),
      lastSatisfaction,
      lastRisk,
      attempts: attempts.map((a) => ({ attemptNo: a.attempt_no, offeredWage: a.offered_wage, result: a.result })),
      settled: r.status === 'settled' && r.settle_source
        ? { wage: r.settled_wage, source: r.settle_source, message: settleMessage(r.settle_source) }
        : null,
    };
  });
}
