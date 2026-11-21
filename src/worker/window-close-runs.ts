// 关窗持久化阶段机·持久化原语（B1 骨架 + B2 七段）：把关窗从「一次 db.batch 全有全无」
// 改造成「持久化阶段机」——窗口状态 open → closing → closed，失败停在 closing，重试只前进、
// 不回滚已提交阶段。本文件提供认领 / 租约 / 步骤失败收口 / 运行完成收口 / run 读取，以及 B2
// 拆步原语：7 个 step 常量 + loadCloseSteps / completeCloseStep / setCloseCurrentStep /
// stepDone / nextPendingStep（claim 批按 CLOSE_STEPS 插 7 行 step）。业务编排在
// window-machine.ts，按 CLOSE_STEPS 顺序逐段构建、逐段提交；preflight 与 post_close 的外部
// 动作在各自段内独立收口。
//
// 关键陷阱（本文件成立的前提）：D1 batch 里某条 UPDATE meta.changes=0 **不会**中止后续语句
// ——所以 claim 批只含「窗口 open→closing + INSERT run + INSERT steps」三条语句，绝不把
// 业务语句塞进 claim 批，业务批里也不得再依赖「某条 UPDATE changes=0」挡并发。并发互斥
// 由两级承担：claim 的 status='open' 写闸（后到者 changes=0，读已有 run 不重建）+
// 每段提交前的租约（acquireCloseLease）。
//
// 防死锁：全部业务校验在 claim 批之前、status='open' 下完成（matched_pending / pending_review /
// 活跃谈判 / force 配置 / 无 E 检查）。claim 之后窗口冻结全部俱乐部写——若把校验放在 claim 后，
// 管理员将无法处理这些单，窗口永久卡 closing，硬禁。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createConfigService } from '../core/config.ts';
import { ACTIVE_SESSION_SQL } from './negotiation-guard.ts';
import { loadCloseWindow } from './window-guard.ts';

// 时间格式与全仓一致（window-machine.ts nowSql 同款）：UTC ISO，可与其他 ISO 串直接字符串比较
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** 租约 TTL 建议值（语义卡：5 分钟）；调用方可自行传 ttlMs 覆盖 */
export const CLOSE_LEASE_TTL_MS = 5 * 60 * 1000;

// —— B2 拆步：7 个持久化 step（顺序固定；CLOSE_STEPS 数组序即 seq，下标 i 的 seq = i + 1）——
export const CLOSE_STEP_PREFLIGHT = 'preflight';
export const CLOSE_STEP_PAYROLL = 'payroll';
export const CLOSE_STEP_HOME = 'home';
export const CLOSE_STEP_LOYALTY = 'loyalty';
export const CLOSE_STEP_SQUAD_AUDIT = 'squad_audit';
export const CLOSE_STEP_FINALIZE = 'finalize';
export const CLOSE_STEP_POST_CLOSE = 'post_close';

/** 按 seq 固定顺序的 7 个关窗步骤名（claim 批按此数组一次插 7 行 pending） */
export const CLOSE_STEPS: readonly string[] = [
  CLOSE_STEP_PREFLIGHT,
  CLOSE_STEP_PAYROLL,
  CLOSE_STEP_HOME,
  CLOSE_STEP_LOYALTY,
  CLOSE_STEP_SQUAD_AUDIT,
  CLOSE_STEP_FINALIZE,
  CLOSE_STEP_POST_CLOSE,
];

/** window_close_runs 行（camelCase 映射，DTO 口径同 listWindows） */
export interface CloseRunRow {
  id: number;
  season: number;
  windowSeq: number;
  /** running/failed/completed（迁移 0096 注释口径；列本身是 TEXT，异常值原样透传） */
  status: string;
  currentStep: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  /** completed 时的关窗摘要 JSON 原文（调用方按原文回响应即可，不必再解析） */
  summaryJson: string | null;
}

/**
 * claim 结果：
 *   · claimed   = 本次请求把窗口从 open 翻成 closing 并新建 run——调用方接着 acquire 租约、跑 close_all；
 *   · resumed   = run 已存在（running/failed）——重试只前进，同样接着 acquire 租约、跑 close_all；
 *   · completed = 既有 run 已完成——直接返回既有摘要（run.summaryJson），不再执行任何业务。
 */
export type CloseRunClaim =
  | { kind: 'claimed'; run: CloseRunRow }
  | { kind: 'resumed'; run: CloseRunRow }
  | { kind: 'completed'; run: CloseRunRow };

interface CloseRunDbRow {
  id: number;
  season: number;
  window_seq: number;
  status: string;
  current_step: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  error: string | null;
  summary_json: string | null;
}

const CLOSE_RUN_COLUMNS =
  'id, season, window_seq, status, current_step, lease_owner, lease_expires_at, started_at, updated_at, completed_at, error, summary_json';

function toCloseRunRow(row: CloseRunDbRow): CloseRunRow {
  return {
    id: row.id,
    season: row.season,
    windowSeq: row.window_seq,
    status: row.status,
    currentStep: row.current_step,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    error: row.error,
    summaryJson: row.summary_json,
  };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从 summary_json 里读出既有 warnings（键不存在 / 坏 JSON / 非对象一律按空处理） */
function parseSummaryWarnings(raw: string | null): { base: Record<string, unknown>; warnings: string[] } {
  if (!raw) return { base: {}, warnings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { base: {}, warnings: [] };
  }
  if (!isRecordObject(parsed)) return { base: {}, warnings: [] };
  const rawWarnings = parsed.warnings;
  const warnings = Array.isArray(rawWarnings)
    ? rawWarnings.filter((w): w is string => typeof w === 'string')
    : [];
  return { base: parsed, warnings };
}

/** 按 (season, window_seq) 读 run（claim 的批后读与幂等重入共用） */
export async function loadCloseRunByWindow(
  db: D1Database,
  season: number,
  windowSeq: number,
): Promise<CloseRunRow | null> {
  const row = await db
    .prepare(`SELECT ${CLOSE_RUN_COLUMNS} FROM window_close_runs WHERE season = ? AND window_seq = ?`)
    .bind(season, windowSeq)
    .first<CloseRunDbRow>();
  return row ? toCloseRunRow(row) : null;
}

/** 按 id 读 run */
export async function loadCloseRun(db: D1Database, runId: number): Promise<CloseRunRow | null> {
  const row = await db
    .prepare(`SELECT ${CLOSE_RUN_COLUMNS} FROM window_close_runs WHERE id = ?`)
    .bind(runId)
    .first<CloseRunDbRow>();
  return row ? toCloseRunRow(row) : null;
}

/**
 * 窗口已不在 open 时（closing/closed/缺行）的接续梯（语义卡第 3/4 条）：
 *   · completed run → 直接返回既有摘要（幂等重入，优先于「窗口已关」的 409）；
 *   · closing + running/failed run → resume；
 *   · closed 且无 completed run → 409「窗口刚被关过了」（沿用 closeWindow 的 changes=0 文案）；
 *   · 缺行 / 其他状态 → 409「当前没有开着的窗口」。
 * closing 而无 run 行按构造不可达（run INSERT 与窗口翻 closing 同批原子），防御分支报 500。
 */
async function resolveExistingRun(
  db: D1Database,
  season: number,
  windowSeq: number,
  status: string | null,
): Promise<CloseRunClaim> {
  const run = await loadCloseRunByWindow(db, season, windowSeq);
  if (run && run.status === 'completed') return { kind: 'completed', run };
  if (status === 'closing') {
    if (run && (run.status === 'running' || run.status === 'failed')) return { kind: 'resumed', run };
    throw new HttpError(500, '关窗执行记录缺失');
  }
  if (status === 'closed') throw new HttpError(409, '窗口刚被关过了');
  throw new HttpError(409, '当前没有开着的窗口');
}

/**
 * claim 批的三条语句（导出给测试直跑：锁 D1 的 INSERT…SELECT…WHERE EXISTS…ON CONFLICT 语法，
 * 也保证测试执行的就是生产同一份 SQL——不在测试里复制粘贴，防「测试绿、生产漂」）。
 * B2 拆步后语句③按 CLOSE_STEPS 一次插 7 行 step（seq 1-7、初始 pending；UNION ALL 派生表，
 * 名字/序号与数组同源）：首跑 meta.changes = [1, 1, 7]、重放 [0, 0, 0]；claim 批仍只含
 * open→closing + INSERT run + INSERT steps，业务语句绝不进 claim 批。
 */
export function claimCloseStatements(db: D1Database, season: number, windowSeq: number): D1PreparedStatement[] {
  const stepArms = CLOSE_STEPS.map(() => 'SELECT ? AS step, ? AS seq').join(' UNION ALL ');
  return [
    db
      .prepare(`UPDATE season_windows SET status = 'closing' WHERE season = ? AND window_seq = ? AND status = 'open'`)
      .bind(season, windowSeq),
    db
      .prepare(
        `INSERT INTO window_close_runs (season, window_seq, status, current_step, started_at, updated_at)
         SELECT ?, ?, ?, ?, ${NOW_SQL}, ${NOW_SQL}
         WHERE EXISTS (SELECT 1 FROM season_windows WHERE season = ? AND window_seq = ? AND status = 'closing')
         ON CONFLICT (season, window_seq) DO NOTHING`,
      )
      .bind(season, windowSeq, 'running', CLOSE_STEP_PREFLIGHT, season, windowSeq),
    db
      .prepare(
        `INSERT INTO window_close_steps (run_id, step, seq, status, attempt)
         SELECT r.id, s.step, s.seq, 'pending', 0
         FROM window_close_runs r, (${stepArms}) s
         WHERE r.season = ? AND r.window_seq = ?
         ON CONFLICT (run_id, step) DO NOTHING`,
      )
      .bind(
        ...CLOSE_STEPS.flatMap((step, index) => [step, index + 1]),
        season,
        windowSeq,
      ),
  ];
}

/**
 * 认领关窗（只认领不做业务）。
 *
 * 流程：读窗口行 → open 才做业务校验（全只读；失败直接 409，不进入 closing）→ claim 批
 * （三条语句原子：UPDATE open→closing + INSERT run + INSERT steps）→ 批后读 run 分派。
 * claim 批后到者（changes=0）读已有 run，不重新建。
 *
 * @param force 语义卡「活跃谈判 / force 配置 / 无 E 检查」三项校验的入参——与 closeWindow 的
 *              forceInput 同义（调用方传 `body?.force === true`）；force=false 时活跃谈判直接 409
 */
export async function claimCloseRun(
  env: Env,
  // claim 批只含三条语句、不写审计（语义卡硬口径）；actor 由调用方在 finalize 批的
  // window_close 审计里使用，本签名按语义卡保留占位
  _actor: number,
  season: number,
  windowSeq: number,
  force = false,
): Promise<CloseRunClaim> {
  const db = env.DB;
  const win = await loadCloseWindow(db, season, windowSeq);
  if (!win) throw new HttpError(409, '当前没有开着的窗口');
  if (win.status !== 'open') return resolveExistingRun(db, season, windowSeq, win.status);

  // —— 业务校验（全部只读，必须在 claim 批之前完成，防死锁）——
  // 校验口径与文案逐字同 closeWindow（window-machine.ts）现行实现
  const matched = await db
    .prepare(`SELECT COUNT(*) AS n FROM listings WHERE status = 'matched_pending'`)
    .first<{ n: number }>();
  if ((matched?.n ?? 0) > 0) {
    throw new HttpError(409, `还有 ${matched?.n} 单激活在匹配等待期，等匹配窗结束（或被激活方决定）再关窗`);
  }

  // v6.64.4：pending_review 的 promotion 单跨窗携带、不挡关窗（与 closeWindow 同口径）
  const pending = await db
    .prepare(`SELECT COUNT(*) AS n FROM transfers WHERE status = 'pending_review' AND type != 'promotion'`)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) {
    throw new HttpError(409, `审核队列还有 ${pending?.n} 张单没处理，先处理完再关窗`);
  }

  // 活跃普通谈判：不带 force 直接 409；带 force 还要过 window_force_settle 配置与「无 E」两道
  // （promotion 会话无条件由 close_all 强约，不是校验项）
  const sessions = await db
    .prepare(
      `SELECT s.id, s.expected_wage FROM negotiation_sessions s
       JOIN transfers t ON t.id = s.transfer_id
       WHERE ${ACTIVE_SESSION_SQL} AND t.type != 'promotion' ORDER BY s.id LIMIT 200`,
    )
    .all<{ id: number; expected_wage: number | null }>();
  if (sessions.results.length > 0) {
    const blocked = new HttpError(
      409,
      `还有 ${sessions.results.length} 场签约谈判没结束，先谈完，或在开启 window_force_settle 后带 force 强制按 E 结算`,
    );
    if (!force) throw blocked;
    const config = createConfigService(db);
    if ((await config.get('window_force_settle')) !== 'true') throw blocked;
    const noE = sessions.results.filter((s) => s.expected_wage === null);
    if (noE.length > 0) {
      throw new HttpError(409, `${noE.length} 场谈判还没提交新违约金（没有 E 快照），无法强制结算`);
    }
  }

  // —— claim 批（只认领不做业务，三条语句原子）——
  // run INSERT 的 WHERE EXISTS：只有本批把窗口翻成 closing 才落行；后到者（窗口早已 closing/closed）
  // 天然不落行，ON CONFLICT 再兜一层（同窗 run 永不复建）
  const results = await db.batch(claimCloseStatements(db, season, windowSeq));
  if ((results[0]?.meta.changes ?? 0) === 1) {
    const run = await loadCloseRunByWindow(db, season, windowSeq);
    // run INSERT 与窗口翻 closing 同批；读到 completed 只在 ON CONFLICT 兜到既有完成 run 的
    // 异常场景，按幂等重入处理最安全
    if (run && run.status === 'completed') return { kind: 'completed', run };
    if (run) return { kind: 'claimed', run };
    throw new HttpError(500, '关窗执行记录缺失');
  }
  // claim 失败（后到者）：窗口已被并发请求翻走——读已有 run，不重新建（语义卡第 4 条）
  const winAfter = await loadCloseWindow(db, season, windowSeq);
  return resolveExistingRun(db, season, windowSeq, winAfter?.status ?? null);
}

/**
 * 取租约（close_all 开始前调用；语义卡：status='running' 且租约空闲/过期才能拿，TTL 建议五分钟）。
 * ⚠️ 条件在语义卡字面 `status='running'` 上放宽为 `IN ('running','failed')`：failed run 必须能被
 * 接续重试（「重试只前进」），否则失败后窗口永久卡 closing；acquire 成功即把 failed 翻回 running。
 * 拿不到抛 409「关窗正在处理」。租约过期接管的全套故障矩阵归 B4，本原语只保证 acquire 可用。
 *
 * @returns 本这次租约的到期时刻（UTC ISO，即写入 lease_expires_at 的值）
 */
export async function acquireCloseLease(db: D1Database, runId: number, owner: string, ttlMs: number): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const result = await db
    .prepare(
      `UPDATE window_close_runs
       SET lease_owner = ?, lease_expires_at = ?, status = 'running', updated_at = ${NOW_SQL}
       WHERE id = ? AND status IN ('running', 'failed')
         AND (lease_expires_at IS NULL OR lease_expires_at < ${NOW_SQL})`,
    )
    .bind(owner, expiresAt, runId)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new HttpError(409, '关窗正在处理');
  return expiresAt;
}

/**
 * 任一段批失败后的收口（单独 batch，窗口保持 closing）：step 标 failed（attempt+1）+
 * run 标 failed 并清租约（清掉才能让下一次重试立即 acquire，不必干等 TTL 过期）。
 * 幂等：step 已 done 不改；run 已 completed 不改。
 */
export async function markCloseStepFailed(db: D1Database, runId: number, step: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.batch([
    db
      .prepare(
        `UPDATE window_close_steps SET status = 'failed', attempt = attempt + 1, finished_at = ${NOW_SQL}, error = ?
         WHERE run_id = ? AND step = ? AND status <> 'done'`,
      )
      .bind(message, runId, step),
    db
      .prepare(
        `UPDATE window_close_runs SET status = 'failed', error = ?, updated_at = ${NOW_SQL},
           lease_owner = NULL, lease_expires_at = NULL
           WHERE id = ? AND status <> 'completed'`,
      )
      .bind(message, runId),
  ]);
}

/**
 * finalize 批成功后的收口语句（追加进同一个 db.batch 的末尾，与业务同批原子）：
 * step 标 done（attempt+1）+ run 标 completed / completed_at / summary_json（清 error 与租约）。
 * 批内任何语句报错 = 整批回滚，run 不会停在「业务已提交、run 未标完」的半截态。
 *
 * @param summary 完成摘要原文（closeWindow 回执同形对象；调用方必须传可 JSON 序列化值，
 *                completed 重入路径靠它原样返回既有摘要）
 */
export function completeCloseRun(db: D1Database, runId: number, step: string, summary: unknown): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE window_close_steps SET status = 'done', attempt = attempt + 1, finished_at = ${NOW_SQL}, error = NULL
         WHERE run_id = ? AND step = ?`,
      )
      .bind(runId, step),
    db
      .prepare(
        `UPDATE window_close_runs SET status = 'completed', completed_at = ${NOW_SQL}, updated_at = ${NOW_SQL},
           summary_json = ?, error = NULL, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ?`,
      )
      .bind(JSON.stringify(summary), runId),
  ];
}

/**
 * 批后 post actions 的 warning 归档（B2 过渡语义：二次 settleOverdue / 海捞开标 / 现有通知发送
 * 保持 best-effort，失败只记 warning、不把 run 改回 failed；通知 outbox 是 B3）。
 * 只往 summary_json 的 warnings 数组追加，不碰其余键、不改 run 状态。
 */
export async function appendCloseRunWarnings(db: D1Database, runId: number, warnings: string[]): Promise<void> {
  if (warnings.length === 0) return;
  const row = await db
    .prepare('SELECT summary_json FROM window_close_runs WHERE id = ?')
    .bind(runId)
    .first<{ summary_json: string | null }>();
  const { base, warnings: existing } = parseSummaryWarnings(row?.summary_json ?? null);
  const merged = { ...base, warnings: [...existing, ...warnings] };
  await db
    .prepare(`UPDATE window_close_runs SET summary_json = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
    .bind(JSON.stringify(merged), runId)
    .run();
}

// —— B2 拆步原语（7 step 段推进 / resume 分派 / 测试直跑共用） ——

/** window_close_steps 行（camelCase 映射；loadCloseSteps 返回值、stepDone / nextPendingStep 入参） */
export interface CloseStepRow {
  runId: number;
  step: string;
  seq: number;
  /** pending/done/failed（迁移 0096 DDL CHECK 紧枚举口径） */
  status: string;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  summaryJson: string | null;
  error: string | null;
}

interface CloseStepDbRow {
  run_id: number;
  step: string;
  seq: number;
  status: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  summary_json: string | null;
  error: string | null;
}

function toCloseStepRow(row: CloseStepDbRow): CloseStepRow {
  return {
    runId: row.run_id,
    step: row.step,
    seq: row.seq,
    status: row.status,
    attempt: row.attempt,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summaryJson: row.summary_json,
    error: row.error,
  };
}

/** 按 run 读全部步骤行（ORDER BY seq 升序；resume 分派与「从最小 seq 继续」共用此读取口径） */
export async function loadCloseSteps(db: D1Database, runId: number): Promise<CloseStepRow[]> {
  const result = await db
    .prepare(
      `SELECT run_id, step, seq, status, attempt, started_at, finished_at, summary_json, error
       FROM window_close_steps WHERE run_id = ? ORDER BY seq`,
    )
    .bind(runId)
    .all<CloseStepDbRow>();
  return result.results.map(toCloseStepRow);
}

/** 指名步骤是否已 done（未插行 / 非 done 一律 false） */
export function stepDone(steps: CloseStepRow[], name: string): boolean {
  return steps.some((s) => s.step === name && s.status === 'done');
}

/**
 * 下一个待推进段：done 段跳过，pending/failed 按 seq 取最小者（resume「done 的跳过、
 * pending/failed 从最小 seq 继续」口径）；全部 done 回 null。入参顺序无关（内部先按 seq 排）。
 */
export function nextPendingStep(steps: CloseStepRow[]): CloseStepRow | null {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  for (const s of ordered) {
    if (s.status !== 'done') return s;
  }
  return null;
}

/**
 * 段成功收口语句（追加进该段提交批的末尾，与该段业务语句同批原子）：step 标 done（attempt+1、
 * finished_at、error 清空）；带 summary 时同句写入 step 自己的 summary_json（不传 = 不动该列，
 * finalize 段的完成摘要只落 run.summary_json）。批内任何语句报错 = 整批回滚，step 不会停在
 * 「业务已提交、step 未标完」的半截态。不带 status<>'done' 守卫（D1 batch changes=0 不中止是
 * 前提；「不重跑 done 段」由上层纪律与测试锁，不在 SQL 层挡）。
 */
export function completeCloseStep(db: D1Database, runId: number, step: string, summary?: unknown): D1PreparedStatement[] {
  if (summary === undefined) {
    return [
      db
        .prepare(
          `UPDATE window_close_steps SET status = 'done', attempt = attempt + 1, finished_at = ${NOW_SQL}, error = NULL
           WHERE run_id = ? AND step = ?`,
        )
        .bind(runId, step),
    ];
  }
  return [
    db
      .prepare(
        `UPDATE window_close_steps SET status = 'done', attempt = attempt + 1, finished_at = ${NOW_SQL}, error = NULL, summary_json = ?
         WHERE run_id = ? AND step = ?`,
      )
      .bind(JSON.stringify(summary), runId, step),
  ];
}

/**
 * run.current_step 推进语句（单条，调用方自行并入所在批）：把 current_step 置为指名段。
 * 推进时点（每段开始前置为该段 / 段提交批尾推进到下一段）由接线批选择，本原语不约束；
 * 只改 current_step 与 updated_at，不碰 run.status / 租约 / summary_json / error。
 */
export function setCloseCurrentStep(db: D1Database, runId: number, step: string): D1PreparedStatement {
  return db
    .prepare(`UPDATE window_close_runs SET current_step = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
    .bind(step, runId);
}
