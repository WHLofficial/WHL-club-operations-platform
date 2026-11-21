// 窗口状态机（TECH_DESIGN §11/§6.4-6）：season_windows open → closed。
// 开窗（= 推进进入新窗）：前置校验无在开窗口，全球员按 agent_change_probability 三档等概率
// 重掷经纪人性格（§6.8）；关窗：先跑惰性结算（截止判定/激活失效/匹配到期），再校验
// ——活跃谈判会话（force 且 window_force_settle=true 时按 E 强制成约）、匹配等待单、
// 待审队列全空——然后落 closed 并做窗尾收口（无人出价下架收费、竞价转待审）。
// 契约类型锚点（v6.82.0 第 4 批）：窗口列表 / 开关窗回执的形状以 src/contract/batch4.ts 为唯一
// 真源——本地 WindowRow 接口删除改 import 契约（全仓无外部 import，无需 re-export），开/关窗
// return 的内联类型改契约引用（venueReset/venueNotified/demandsCreated/payroll/home 四处
// workerExtra 补抄的处置见契约型注；payroll/home 的形状真源仍 PayrollSummary / HomeWindowSummary，
// 与契约内部辅助型逐字段同形，typecheck 互锁）。
import type { CloseWindowResult, OpenWindowResult, WindowsResponse } from '../contract/batch4.ts';
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createConfigService } from '../core/config.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { closedRegularTicks, regularWindowOrdinal } from './contract-ticks.ts';
import { settleOverdue } from './market-settle.ts';
import { forceSettleAtExpected } from './negotiations.ts';
import { windowPayrollStatements } from './window-payroll.ts';
import type { PayrollSummary } from './window-payroll.ts';
import { loyaltyMovements } from './season-settle.ts';
import { growthPeriodStatements } from './growth.ts';
import { windowHomeStatements } from './home.ts';
import type { HomeWindowSummary, PendingClubNotification } from './home.ts';
import { queueClubNotification } from './notify.ts';
import { SQUAD_RULE_LABEL, squadAuditStatements } from './squad-audit.ts';
import type { SquadAuditRow } from './squad-audit.ts';
import { openSealedBatchOnWindowClose } from './sea-sealed.ts';
import { triggerDemandBatch } from './demand-ops.ts';
import { ACTIVE_SESSION_SQL } from './negotiation-guard.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { slotsForCapacity } from '../core/venue.ts';
// 关窗通知 outbox（v6.88.1 B3）：三类关窗通知段内落库语句构造 + post_close / 管理端重试统一投递
import {
  deliverCloseNotifications,
  stageCloseNotificationStatements,
  type CloseNotificationItem,
} from './window-close-outbox.ts';
// 关窗持久化阶段机（v6.88.0 B2 七段接线）：认领 / 租约 / 七段 step 原语 + closing 行读取
import {
  acquireCloseLease,
  appendCloseRunWarnings,
  claimCloseRun,
  CLOSE_LEASE_TTL_MS,
  CLOSE_STEP_FINALIZE,
  CLOSE_STEP_HOME,
  CLOSE_STEP_LOYALTY,
  CLOSE_STEP_PAYROLL,
  CLOSE_STEP_POST_CLOSE,
  CLOSE_STEP_PREFLIGHT,
  CLOSE_STEP_SQUAD_AUDIT,
  completeCloseRun,
  completeCloseStep,
  loadCloseRun,
  loadCloseSteps,
  markCloseStepFailed,
  nextPendingStep,
  setCloseCurrentStep,
  stepDone,
  type CloseRunRow,
  type CloseStepRow,
} from './window-close-runs.ts';
import { loadCloseWindow } from './window-guard.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

function defaultRng(): number {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return new DataView(buf.buffer).getUint32(0) / 2 ** 32;
}

// WindowRow / WindowsResponse 已并源契约 batch4.ts（v6.82.0 第 4 批，文件头 import）：本地接口删除。

export async function listWindows(db: D1Database): Promise<WindowsResponse> {
  const seasons = await db
    .prepare('SELECT season, status FROM seasons ORDER BY season DESC LIMIT 50')
    .all<{ season: number; status: string }>();
  const windows = await db
    .prepare(
      'SELECT season, window_seq, status, is_temporary, opened_at, closed_at FROM season_windows ORDER BY season DESC, window_seq DESC LIMIT 100',
    )
    .all<{ season: number; window_seq: number; status: string; is_temporary: number | null; opened_at: string | null; closed_at: string | null }>();
  // DTO 冻结 camelCase（附录 A），在此层统一映射
  return {
    seasons: seasons.results,
    windows: windows.results.map((r) => ({
      season: r.season,
      windowSeq: r.window_seq,
      status: r.status,
      isTemporary: (r.is_temporary ?? 0) === 1,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    })),
  };
}

/**
 * 开窗：无在开窗口（一次只有一个窗）；season 缺省取最新赛季、windowSeq 缺省顺延；
 * 赛季行不存在时自动按 running 建档（完整赛季管理随v0.7.0）。
 * 全球员经纪人性格重掷：roll < prob → 三档等概率（会话存续期性格恒定，E 已快照）。
 * declareGrowthPeriod=true（管理端勾选复选框）时同批宣告新成长期——不再与窗口绑定，
 * 只是把「开窗」当成一个常用时点；管理端也可以随时手动宣告（见 routes/admin/growth.ts 的 /growth/periods）。
 */
export async function openWindow(
  env: Env,
  actor: number,
  seasonInput: unknown,
  windowSeqInput: unknown,
  declareGrowthPeriodInput?: unknown,
  temporaryInput?: unknown,
): Promise<OpenWindowResult> {
  const db = env.DB;
  const config = createConfigService(db);

  // v6.88.0：closing 也算「没关完」——关窗阶段机里窗口停在 closing（run failed 待重试）时
  // 不能开新窗（部分索引焊死 open / closing 各至多一行，IN 两者即「一次只有一个窗」的完整口径）
  const openCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM season_windows WHERE status IN ('open', 'closing')`)
    .first<{ n: number }>();
  if ((openCount?.n ?? 0) > 0) throw new HttpError(409, '还有一个窗口开着，先关闭它再开新窗');

  let season: number;
  if (seasonInput === undefined || seasonInput === null || seasonInput === '') {
    const latest = await db.prepare('SELECT MAX(season) AS s FROM seasons').first<{ s: number | null }>();
    season = latest?.s ?? 1;
  } else {
    season = Number(seasonInput);
    if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  }
  let windowSeq: number;
  if (windowSeqInput === undefined || windowSeqInput === null || windowSeqInput === '') {
    const latest = await db
      .prepare('SELECT MAX(window_seq) AS w FROM season_windows WHERE season = ?')
      .bind(season)
      .first<{ w: number | null }>();
    windowSeq = (latest?.w ?? 0) + 1;
  } else {
    windowSeq = Number(windowSeqInput);
    if (!Number.isInteger(windowSeq) || windowSeq <= 0) throw new HttpError(400, 'windowSeq 应为正整数');
  }

  // 窗类型（v3.0.0）：临时窗由管理端复选框指定；同赛季常规窗最多 2 个（季初 + 中期），
  // 第 3 个非临时窗硬拦（要开就勾临时窗）；季初/中期不落库，按同赛季非临时窗顺序派生
  const isTemporary = temporaryInput === true;
  if (!isTemporary) {
    const regularCount = await db
      .prepare(`SELECT COUNT(*) AS n FROM season_windows WHERE season = ? AND is_temporary = 0`)
      .bind(season)
      .first<{ n: number }>();
    if ((regularCount?.n ?? 0) >= 2) {
      throw new HttpError(409, 'S' + season + ' 已经开过 2 个常规窗（季初 + 中期），再开请勾选「临时窗」');
    }
  }

  // 经纪人性格重掷（§6.8）：窗口推进事务内全球员 0.3 概率三档等概率
  const prob = await config.getNumber('agent_reroll_prob');
  const roll = env.rng ?? defaultRng;
  const rerolls = new Map<number, number[]>();
  let scanned = 0;
  let lastId = 0;
  for (;;) {
    const rows = await db
      .prepare('SELECT id, agent_tier FROM players WHERE id > ? ORDER BY id LIMIT 500')
      .bind(lastId)
      .all<{ id: number; agent_tier: number }>();
    if (rows.results.length === 0) break;
    for (const r of rows.results) {
      lastId = r.id;
      scanned++;
      if (roll() < (prob ?? 0.3)) {
        const tier = 1 + Math.floor(roll() * 3);
        const list = rerolls.get(tier) ?? [];
        list.push(r.id);
        rerolls.set(tier, list);
      }
    }
    if (rows.results.length < 500) break;
  }
  const statements: D1PreparedStatement[] = [];
  for (const [tier, ids] of rerolls) {
    for (let i = 0; i < ids.length; i += 90) {
      const slice = ids.slice(i, i + 90);
      statements.push(
        db
          .prepare(`UPDATE players SET agent_tier = ?, updated_at = ${nowSql()} WHERE id IN (${slice.map(() => '?').join(', ')})`)
          .bind(tier, ...slice),
      );
    }
  }
  // 经纪人重掷语句不单独提交（P0 ⑧）：并入下面的 openBatch 最前面，
  // 这样开窗因并发 UNIQUE 失败时重掷一起回滚——不会出现「窗没开、经纪人却被重掷」。

  const audit = createAuditStatement(db);
  const declarePeriod = declareGrowthPeriodInput === true;
  // 新季首窗清零（v6.53.0）：本赛季还没有任何窗行 ⇒ 上一季遗留的上座乘数/剩余场次一律归零。
  // 判定与清零都在同一批里，失败整批回滚，不会出现「窗没开但乘数被清」。
  const seasonWindows = await db
    .prepare('SELECT COUNT(*) AS n FROM season_windows WHERE season = ?')
    .bind(season)
    .first<{ n: number }>();
  const venueReset = (seasonWindows?.n ?? 0) === 0;
  // v6.75.0：窗口外发起的强拍在关窗期成交/解约 → season/window_seq 落 NULL。
  // 下一窗开窗时统一归到本窗；先数一遍，批里再改，0 行不写审计。
  const backfill = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM transfers
           WHERE season IS NULL AND (type = 'forced_auction' OR idempotency_key LIKE 'forced_no_bid:%')) AS transfers,
         (SELECT COUNT(*) FROM contracts
           WHERE is_active = 1 AND signed_season IS NULL AND COALESCE(source, '') <> 'import'
             AND player_id IN (SELECT player_id FROM transfers WHERE season IS NULL AND type = 'forced_auction')) AS contracts`,
    )
    .first<{ transfers: number; contracts: number }>();
  const backfillCount = backfill?.transfers ?? 0;
  const contractBackfillCount = backfill?.contracts ?? 0;
  const openBatch: D1PreparedStatement[] = [
    ...statements,
    db
      .prepare(
        `INSERT INTO seasons (season, status, created_at) VALUES (?, 'running', ${nowSql()})
           ON CONFLICT(season) DO NOTHING`,
      )
      .bind(season),
    // 赛季生命周期（§11）：备赛期开窗即进入进行中
    db.prepare(`UPDATE seasons SET status = 'running' WHERE season = ? AND status = 'preparing'`).bind(season),
    db
      .prepare(
        `INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (?, ?, 'open', ?, ${nowSql()})`,
      )
      .bind(season, windowSeq, isTemporary ? 1 : 0),
  ];
  // v6.69.0 期二（D12）：开窗瞬间给每支非 CPU 球队记一行工资基线，供工作台算「窗初 → 现在」。
  // 与 window-payroll 的扣费口径同源（全部 active 合同），只是这里留一份窗初快照。
  openBatch.push(
    db
      .prepare(
        `INSERT OR REPLACE INTO club_wage_baselines (season, window_seq, club_id, wage_total, player_count)
         SELECT ?, ?, ct.club_id, COALESCE(SUM(ct.wage), 0), COUNT(*)
         FROM contracts ct JOIN clubs c ON c.id = ct.club_id
         WHERE ct.is_active = 1 AND ct.club_id IS NOT NULL AND ct.wage IS NOT NULL AND COALESCE(c.is_cpu, 0) = 0
         GROUP BY ct.club_id`,
      )
      .bind(season, windowSeq),
  );
  if (venueReset) {
    openBatch.push(
      db
        .prepare(
          `UPDATE stadiums SET next_attendance_mod = 1, attendance_mod_matches = 0, updated_at = ${nowSql()}
           WHERE next_attendance_mod <> 1 OR attendance_mod_matches <> 0`,
        ),
    );
  }
  // v6.75.0：关窗期成交的强拍归到本窗。合同先改——它按 transfers 里仍为 NULL 的行定位球员；
  // 随后 transfers 本身再落窗。两句同批，失败一起回滚。
  if (backfillCount > 0) {
    openBatch.push(
      db
        .prepare(
          `UPDATE contracts SET signed_season = ?, signed_window_seq = ?
           WHERE is_active = 1 AND signed_season IS NULL AND COALESCE(source, '') <> 'import'
             AND player_id IN (SELECT player_id FROM transfers WHERE season IS NULL AND type = 'forced_auction')`,
        )
        .bind(season, windowSeq),
      db
        .prepare(
          `UPDATE transfers SET season = ?, window_seq = ?
           WHERE season IS NULL AND (type = 'forced_auction' OR idempotency_key LIKE 'forced_no_bid:%')`,
        )
        .bind(season, windowSeq),
      audit({
        actor,
        action: 'transfer_season_backfill',
        targetType: 'season_window',
        targetId: null,
        origin: 'user',
        after: { season, windowSeq, transfers: backfillCount, contracts: contractBackfillCount },
      }),
    );
  }
  if (declarePeriod) {
    openBatch.push(
      ...growthPeriodStatements(db, {
        season,
        source: 'window_open',
        note: `S${season} 第 ${windowSeq} 窗开窗时勾选自动宣告`,
        declaredBy: actor,
      }),
    );
  }
  openBatch.push(
    audit({
      actor,
      action: 'window_open',
      targetType: 'season_window',
      targetId: null,
      origin: 'user',
      after: {
        season,
        windowSeq,
        isTemporary,
        growthPeriodDeclared: declarePeriod,
        playersScanned: scanned,
        rerolled: [...rerolls.values()].reduce((n, l) => n + l.length, 0),
        venueReset,
      },
    }),
  );
  try {
    await db.batch(openBatch);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这个窗口已经存在');
    throw err;
  }
  // 开窗给意向单双方排提醒（v6.29.0）：提交成功后才排队，与 closeWindow 的通知口径一致。
  // 这里是刻意吞掉的尽力而为——此刻窗口已提交，通知失败不该让调用方以为开窗失败；
  // 失败只影响提醒（不回溯、不重试），排查靠通知表缺行，业务异常在下面各语句里都已各自报错。
  try {
    // v6.55.0 意向单多笔并存：翻页取全（第三轮终验：单轮 LIMIT 200 在 >200 条时静默丢提醒），
    // 再按 (player_id) 聚合——卖方每球员一条（N 家求购择一确认，offerId 取首条），
    // 买方各带自己单 id 一条（N 家竞争提示）。
    const intents: { id: number; amount: number; buyer_club_id: number; seller_club_id: number; player_id: number; player_name: string }[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await db
        .prepare(
          `SELECT o.id, o.amount, o.buyer_club_id, o.seller_club_id, o.player_id, ${sqlDisplayName('p')} AS player_name
           FROM offers o JOIN players p ON p.id = o.player_id
           WHERE o.status = 'intent' ORDER BY o.id LIMIT 200 OFFSET ?`,
        )
        .bind(offset)
        .all<{ id: number; amount: number; buyer_club_id: number; seller_club_id: number; player_id: number; player_name: string }>();
      intents.push(...page.results);
      if (page.results.length < 200) break;
    }
    const byPlayer = new Map<number, typeof intents>();
    for (const it of intents) {
      const list = byPlayer.get(it.player_id) ?? [];
      list.push(it);
      byPlayer.set(it.player_id, list);
    }
    for (const rows of byPlayer.values()) {
      const data = {
        player: rows[0].player_name,
        amount: rows[0].amount,
        offerId: rows[0].id,
        season,
        windowSeq,
        role: 'seller',
        buyers: rows.length,
      };
      await queueClubNotification(env, rows[0].seller_club_id, 'offer_intent_window_open', data);
      for (const it of rows) {
        await queueClubNotification(env, it.buyer_club_id, 'offer_intent_window_open', {
          player: it.player_name,
          amount: it.amount,
          offerId: it.id,
          season,
          windowSeq,
          role: 'buyer',
          buyers: rows.length,
        });
      }
    }
  } catch {
    // 见上：仅提醒，吞掉
  }
  // 开窗站内信（v6.53.0 §6.1）：与上面的意向单提醒同口径——批成功后尽力而为，失败不影响开窗。
  // 每个活跃队本窗能排几个档位由容量派生，slotCap 取 activity_slots（缺省 4）。
  let venueNotified = 0;
  try {
    const slotCap = (await config.getNumber('activity_slots')) ?? 4;
    const stadiums = await db
      .prepare(
        `SELECT c.id AS club_id, COALESCE(s.capacity, 0) AS capacity
         FROM clubs c LEFT JOIN stadiums s ON s.club_id = c.id
         WHERE c.status = 'active' ORDER BY c.id`,
      )
      .all<{ club_id: number; capacity: number }>();
    for (const row of stadiums.results) {
      const slots = slotsForCapacity(row.capacity, slotCap);
      // activity_slots=0 等于关闭功能：不发「本窗有 0 个档位」的信（与提醒侧同口径）
      if (slots <= 0) continue;
      venueNotified += await queueClubNotification(env, row.club_id, 'venue_window_open', {
        season,
        windowSeq,
        slots,
      });
    }
  } catch {
    // 见上：仅提醒，吞掉
  }
  // 球员涨薪要求生成（v6.54.0 §8「放在 openWindow 成功后调用」）：常规窗开窗成功后跑一次生成批。
  // 与上面两段提醒同纪律——窗口已提交，生成失败不阻塞开窗（TC-RD-18 #4）；失败时本窗没有 demand 行，
  // scheduledTick 的 ensureCurrentWindowDemands 会在下一个 tick 幂等补跑。临时窗由生成批自己短路。
  let demandsCreated = 0;
  try {
    const batch = await triggerDemandBatch(env, { season, windowSeq, actor, origin: 'user' });
    demandsCreated = batch.created;
  } catch {
    // 仅生成失败：本窗收件箱为空，补跑入口见 demand-ops.ensureCurrentWindowDemands
  }
  return {
    ok: true,
    season,
    windowSeq,
    rerolled: [...rerolls.values()].reduce((n, l) => n + l.length, 0),
    growthPeriodDeclared: declarePeriod,
    isTemporary,
    venueReset,
    venueNotified,
    demandsCreated,
  };
}

// —— completed run 摘要回放（B1 幂等重入）——
// appendCloseRunWarnings 会往摘要对象追加 warnings 键；这里只挑契约字段校验后重建回执，
// 多余键忽略。正常路径写入的就是关窗回执对象，形状不对只可能是 DB 被手工改过（防御分支回 null）。
const CLOSE_PAYROLL_KEYS: readonly string[] = ['wageClubs', 'wageTotal', 'taxClubs', 'taxTotal', 'wageFloorClubs'];
const CLOSE_HOME_KEYS: readonly string[] = [
  'maintenanceClubs', 'maintenanceTotal', 'fansClubs', 'namingClubs', 'namingTotal',
  'activityClubs', 'activityTotal', 'activityOpsCost', 'moodClubs', 'terminatedClubs',
  'marketOffers', 'activatedClubs', 'pendingApplied', 'pendingVoided',
];

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 逐键取有限数字；任一键不是数字返回 null（返回值键序与 keys 一一对应） */
function summaryNumbers(rec: Record<string, unknown>, keys: readonly string[]): number[] | null {
  const out: number[] = [];
  for (const key of keys) {
    const v = rec[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/** completed run 的 summary_json → 关窗回执（CloseWindowResult）。形状不对返回 null。 */
function parseCloseSummary(raw: string): CloseWindowResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecordObject(parsed)) return null;
  const payroll = parsed.payroll;
  const home = parsed.home;
  const loyalty = parsed.loyalty;
  if (!isRecordObject(payroll) || !isRecordObject(home) || !isRecordObject(loyalty)) return null;
  const season = parsed.season;
  const windowSeq = parsed.windowSeq;
  const isTemporary = parsed.isTemporary;
  const forceSettled = parsed.forceSettled;
  const loyaltyCount = loyalty.count;
  const loyaltyTotal = loyalty.total;
  const payrollNums = summaryNumbers(payroll, CLOSE_PAYROLL_KEYS);
  const homeNums = summaryNumbers(home, CLOSE_HOME_KEYS);
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (
    parsed.ok !== true ||
    !isNum(season) || !isNum(windowSeq) || typeof isTemporary !== 'boolean' || !isNum(forceSettled) ||
    !isNum(loyaltyCount) || !isNum(loyaltyTotal) ||
    payrollNums === null || homeNums === null
  ) {
    return null;
  }
  const [wageClubs, wageTotal, taxClubs, taxTotal, wageFloorClubs] = payrollNums;
  const [maintenanceClubs, maintenanceTotal, fansClubs, namingClubs, namingTotal, activityClubs, activityTotal, activityOpsCost, moodClubs, terminatedClubs, marketOffers, activatedClubs, pendingApplied, pendingVoided] = homeNums;
  return {
    ok: true,
    season,
    windowSeq,
    isTemporary,
    forceSettled,
    payroll: { wageClubs, wageTotal, taxClubs, taxTotal, wageFloorClubs },
    home: {
      maintenanceClubs, maintenanceTotal, fansClubs, namingClubs, namingTotal,
      activityClubs, activityTotal, activityOpsCost, moodClubs, terminatedClubs,
      marketOffers, activatedClubs, pendingApplied, pendingVoided,
    },
    loyalty: { count: loyaltyCount, total: loyaltyTotal },
  };
}

// —— B2 段摘要回读（resume：本调用未重建的 done 段从 step.summary_json 取回 finalize 汇总输入）——
// 各业务段（含 preflight 的强约计数）提交批用 completeCloseStep 的 summary 参数把摘要与 step done
// 同批原子落库，回读值与该段原建批一致（不是按已提交状态重算）；对象键序与 builder 内存摘要一致，
// summary_json 序列化逐字节同形。缺失/损坏只可能是库被手工改过——防御 500，正常路径不可达。

function parseStepSummaryObject(steps: CloseStepRow[], name: string): Record<string, unknown> | null {
  const row = steps.find((s) => s.step === name);
  if (!row || row.summaryJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.summaryJson);
  } catch {
    return null;
  }
  return isRecordObject(parsed) ? parsed : null;
}

function requirePreflightCounts(steps: CloseStepRow[]): { forceSettled: number; promotionForceSettled: number } {
  const rec = parseStepSummaryObject(steps, CLOSE_STEP_PREFLIGHT);
  const nums = rec === null ? null : summaryNumbers(rec, ['forceSettled', 'promotionForceSettled']);
  if (nums === null) throw new HttpError(500, '关窗步骤摘要缺失或损坏，无法收口');
  const [forceSettled, promotionForceSettled] = nums;
  return { forceSettled, promotionForceSettled };
}

function requirePayrollSummary(steps: CloseStepRow[]): PayrollSummary {
  const rec = parseStepSummaryObject(steps, CLOSE_STEP_PAYROLL);
  const nums = rec === null ? null : summaryNumbers(rec, CLOSE_PAYROLL_KEYS);
  if (nums === null) throw new HttpError(500, '关窗步骤摘要缺失或损坏，无法收口');
  const [wageClubs, wageTotal, taxClubs, taxTotal, wageFloorClubs] = nums;
  return { wageClubs, wageTotal, taxClubs, taxTotal, wageFloorClubs };
}

function requireHomeSummary(steps: CloseStepRow[]): HomeWindowSummary {
  const rec = parseStepSummaryObject(steps, CLOSE_STEP_HOME);
  const nums = rec === null ? null : summaryNumbers(rec, CLOSE_HOME_KEYS);
  if (nums === null) throw new HttpError(500, '关窗步骤摘要缺失或损坏，无法收口');
  const [maintenanceClubs, maintenanceTotal, fansClubs, namingClubs, namingTotal, activityClubs, activityTotal, activityOpsCost, moodClubs, terminatedClubs, marketOffers, activatedClubs, pendingApplied, pendingVoided] = nums;
  return {
    maintenanceClubs, maintenanceTotal, fansClubs, namingClubs, namingTotal,
    activityClubs, activityTotal, activityOpsCost, moodClubs, terminatedClubs,
    marketOffers, activatedClubs, pendingApplied, pendingVoided,
  };
}

function requireLoyaltySummary(steps: CloseStepRow[]): { count: number; total: number } {
  const rec = parseStepSummaryObject(steps, CLOSE_STEP_LOYALTY);
  const nums = rec === null ? null : summaryNumbers(rec, ['count', 'total']);
  if (nums === null) throw new HttpError(500, '关窗步骤摘要缺失或损坏，无法收口');
  const [count, total] = nums;
  return { count, total };
}

/**
 * home 段批后通知 → outbox 行（v6.88.1 B3）：dedup_key = home:{clubId}:{template}:{序号}，
 * 序号按 (clubId, template) 组合在数组内的出现次序 0 起计——现状每队每模板至多一条（恒 0），
 * 位次是防御性消歧（naming_offer_activated 同队可多条：同键序号不同 → 两行都在，
 * 同键同序号重放 → INSERT OR IGNORE 吞，不撞 (run_id, dedup_key) 复合主键）。
 */
function homeNotificationItems(notifications: readonly PendingClubNotification[]): CloseNotificationItem[] {
  const seen = new Map<string, number>();
  return notifications.map((n) => {
    const group = `${n.clubId}:${n.template}`;
    const ordinal = seen.get(group) ?? 0;
    seen.set(group, ordinal + 1);
    return {
      clubId: n.clubId,
      template: n.template,
      dedupKey: `home:${n.clubId}:${n.template}:${ordinal}`,
      data: n.data,
    };
  });
}

/**
 * 体检未通过通知 → outbox 行（v6.88.1 B3；v6.69.0 D10 文案与数据键自 post_close 原样搬移——
 * 只给金额与规则名、不点球员姓名，球员页才是明细入口）。payload 落 data 原文（含
 * season/windowSeq，修复原 notifications LIKE 查重恒不命中），dedup_key = squad:{clubId}
 * （一队一体检一封），CPU 队与通过队不发。
 */
function squadAuditNotificationItems(
  audits: readonly SquadAuditRow[],
  season: number,
  windowSeq: number,
): CloseNotificationItem[] {
  const items: CloseNotificationItem[] = [];
  for (const a of audits) {
    if (a.isCpu || a.pass) continue;
    const rules = [...new Set(a.issues.map((i) => SQUAD_RULE_LABEL[i.rule] ?? i.rule))].join('、');
    const text =
      `⚠️ S${season} 第 ${windowSeq} 窗关窗体检：阵容不通过（涉及规则：${rules || '无'}）。` +
      (a.overspend > 0 ? `工资 ${a.wageAfter.toFixed(2)}m，超出帽值 ${a.overspend.toFixed(2)}m。` : `工资 ${a.wageAfter.toFixed(2)}m。`) +
      `本次不处置，下窗关闭前请按教练页红字清单调整。`;
    items.push({
      clubId: a.clubId,
      template: 'squad_audit_failed',
      dedupKey: `squad:${a.clubId}`,
      data: { text, season, windowSeq, overspend: a.overspend, rules },
    });
  }
  return items;
}

/**
 * 关窗（v6.88.0 B2 七段持久化阶段机）：全部业务校验在 claim 之前的 open 状态下完成（失败直接 409，
 * 不进入 closing——防死锁，claim 后教练写被冻结闸挡住）→ claim（open→closing + INSERT run + INSERT
 * 7 行 step 小批，只认领不做业务）→ acquire 租约 → 复核窗口/租约 → 读 steps 按 seq 找第一个未
 * done 的段，七段固定顺序推进：
 *   1 preflight    第二次惰性结算（显式 season/windowSeq）+ promotion 强约 + 普通谈判强约
 *                  （外部动作幂等；开始前置 current_step，完成后小批标 done + 推进 current_step）；
 *   2-5 业务段     payroll/home/loyalty/squad_audit——四个 builder 在任何业务段提交之前全部构建完
 *                  （parity 硬口径，调用顺序与参数保持 B1），再按 step 顺序逐段提交：每批只含本段
 *                  业务语句 + 本段 step done（段摘要同句落 step 行）+ current_step 推进下一段，
 *                  批内任何报错整段回滚并 markCloseStepFailed（run failed、窗口留 closing、后段仍
 *                  pending、已提交前段不回滚）；
 *   6 finalize     closing→closed + 审计 + finalize done + run completed + summary_json 同批原子；
 *   7 post_close   三类关窗通知统一投递（preflight/home/squad_audit 段已随各自收口批落库
 *                  outbox：promotion:{sessionId} / home:{clubId}:{template}:{序号} /
 *                  squad:{clubId}，本段按 run 捞 pending/failed 严格投递）+ 窗尾收口结算 +
 *                  海捞开标——finalize 成功即关窗成功（已裁决），本段失败只把 step 标 failed +
 *                  warnings 追加进 run.summary_json，不把 run 改回 failed、不改成功响应
 *                  （通知 at-least-once：崩在已发未标之间允许重复一条；v6.88.1 B3 起 outbox）。
 *
 * resume：completed run 直接回放既有摘要；running/failed 继续推进——done 段跳过（已提交不回滚、
 * 已 done 段不重跑），pending/failed 从最小 seq 继续。resume 跳过段的汇总输入从 step.summary_json
 * 回读（各段提交批同批落库）；重建的后段会读到已提交状态，属 B4 恢复 parity 范围（本批登记在案），
 * 正常路径批前读 parity 与 B1 逐字段一致。
 *
 * 并发与重试口径：claim 批的 status='open' 写闸是唯一认领闸（后到者读已有 run，不重建）；
 * 段推进前再过租约（acquireCloseLease，TTL 5 分钟）；批内不依赖「UPDATE changes=0」挡并发。
 */
export async function closeWindow(
  env: Env,
  actor: number,
  forceInput: unknown,
): Promise<CloseWindowResult> {
  const db = env.DB;
  // 关窗目标窗：open 或 closing。currentWindow 只认 open（普通业务口径：closing 拿不到窗口，
  // 写请求被冻结闸自然拒绝），关窗要能接续上次中断在 closing 的窗，所以这里单独查
  // （open / closing 各至多一行，IN 两者即「有待关/待续的窗」全集）
  const win = await db
    .prepare(
      `SELECT season, window_seq, status, is_temporary FROM season_windows
       WHERE status IN ('open', 'closing') ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<{ season: number; window_seq: number; status: string; is_temporary: number | null }>();
  if (!win) throw new HttpError(409, '当前没有开着的窗口');
  const isTemporary = (win.is_temporary ?? 0) === 1;

  // preflight（语义卡第 5 条）：open 状态下先跑一次惰性结算，它制造的 matched_pending /
  // pending_review 必须能挡住关窗（与旧实现 window-machine.ts:399→411 的先后语义一致）。
  // 必须在 claim 之前：claim 后窗口已 closing，俱乐部写被冻结闸挡住，这些单再也处理不了。
  // claim 之后再跑一次（close_all 步骤 1）是窗尾收口：那次新造的 blocker 不再挡关窗（已在
  // closing，由批后窗尾收口统一处理）——与现状「校验到批之间」的间隙语义一致。
  if (win.status === 'open') {
    await settleOverdue(env, { actor, origin: 'user' });
  }

  // claim（window-close-runs.ts）：open 时先做全部业务校验（matched_pending / pending_review /
  // 活跃谈判 / force 配置 / 无 E 检查，文案与旧实现逐字一致），通过才翻 closing 建 run；
  // closing 时按 run 状态分派（completed → 回放摘要 / running,failed → resume）
  const claim = await claimCloseRun(env, actor, win.season, win.window_seq, forceInput === true);
  if (claim.kind === 'completed') {
    const replay = parseCloseSummary(claim.run.summaryJson ?? '');
    if (replay !== null) return replay;
    throw new HttpError(500, '关窗完成记录损坏，无法回放摘要');
  }
  const run: CloseRunRow = claim.run;

  // 租约：run 可接续（running/failed）且租约空闲/过期才拿得到；拿不到 = 另一次关窗正在执行
  const owner = `window-close:${run.id}:${crypto.randomUUID()}`;
  await acquireCloseLease(db, run.id, owner, CLOSE_LEASE_TTL_MS);
  // close_all 开始前复核（语义卡）：租约仍在本手 + 窗口仍 closing。间隙里并发对手已完成关窗
  // 则回放其摘要，窗口已关而无完成 run 按「刚被关过」拒；其余按「正在处理」拒（防御分支）
  const winNow = await loadCloseWindow(db, win.season, win.window_seq);
  const runNow = await loadCloseRun(db, run.id);
  if (!winNow || winNow.status !== 'closing' || runNow === null || runNow.leaseOwner !== owner) {
    if (runNow !== null && runNow.status === 'completed') {
      const replay = parseCloseSummary(runNow.summaryJson ?? '');
      if (replay !== null) return replay;
    }
    throw new HttpError(409, winNow !== null && winNow.status === 'closed' ? '窗口刚被关过了' : '关窗正在处理');
  }

  // —— B2 七段接线：读 steps，按 seq 找到第一个未 done 的段（done 段跳过，pending/failed
  //    从最小 seq 继续）。全部 step done 而 run 未收口正常流程不可达（finalize 批 = finalize
  //    done + run completed 同批原子，post_close done 只在其后写入），防御分支报 500 ——
  const steps = await loadCloseSteps(db, run.id);
  const first = nextPendingStep(steps);
  if (first === null) {
    throw new HttpError(500, '关窗步骤已全部完成但运行记录未收口');
  }
  // 非业务段的执行闸按 step 行判 done（「已 done 段不重跑」硬口径；行缺失按未 done 处理——
  // 旧 B1 run 只有一行 close_all 时七段全跑，与「重试只前进」兼容）
  const ranPreflight = !stepDone(steps, CLOSE_STEP_PREFLIGHT);
  const ranFinalize = !stepDone(steps, CLOSE_STEP_FINALIZE);
  const ranPostClose = !stepDone(steps, CLOSE_STEP_POST_CLOSE);
  // 正在推进的段（失败收口 markCloseStepFailed 按它点名；进入新段前前移）
  let currentStep = first.step;

  try {
    // —— 段 1 preflight（外部动作段，动作幂等；业务语句不进本段，收口是小批 step 记账）——
    let forceSettled = 0;
    let promotionForceSettled = 0;
    if (ranPreflight) {
      currentStep = CLOSE_STEP_PREFLIGHT;
      // 每段开始前把 run.current_step 置为该段（施工表首动作；claim 已写 preflight，此处幂等
      // 重申——外部动作不可进批，单独小批）
      await db.batch([setCloseCurrentStep(db, run.id, CLOSE_STEP_PREFLIGHT)]);

      // 1) 惰性结算（close_all 前的第二次；第一次 preflight 已在 claim 之前的 open 状态下跑过）：
      //    此刻窗口 closing——缺 listing 归属（season/window_seq 为 NULL）的结算用显式窗口回退
      //    （v6.88.0：closing 下 status='open' 的旧回退落不到窗）。
      //    origin='user'：这次惰性结算由管理员的关窗请求触发（actor 是管理员），不是定时任务
      await settleOverdue(env, { actor, origin: 'user', season: win.season, windowSeq: win.window_seq });

      // 2) promotion 强约（v6.64.4）：会话**无条件**按 E 快照成约（F 定死 ⇒ E 恒在），
      //    不走 force 配置口径、也不挡关窗（用户裁决「窗关强约成约」）。
      //    v6.88.1 B3：通知不直发——攒成 outbox 行随下方 preflight 收口批原子落库
      //    （崩溃/段批回滚与 step 记账同进退），post_close 统一投递；
      //    dedup_key = promotion:{sessionId}（段级重放 / 重复 close 不重复落行）
      const promoSessions = await db
        .prepare(
          `SELECT s.id, s.club_id, ${sqlDisplayName('p')} AS player_name
           FROM negotiation_sessions s
           JOIN transfers t ON t.id = s.transfer_id
           JOIN players p ON p.id = s.player_id
           WHERE ${ACTIVE_SESSION_SQL} AND t.type = 'promotion' ORDER BY s.id LIMIT 200`,
        )
        .all<{ id: number; club_id: number; player_name: string }>();
      const promoNotices: CloseNotificationItem[] = [];
      for (const s of promoSessions.results) {
        if (await forceSettleAtExpected(env, s.id, actor)) {
          promotionForceSettled++;
          promoNotices.push({
            clubId: s.club_id,
            template: 'promotion_forced',
            dedupKey: `promotion:${s.id}`,
            data: { player: s.player_name },
          });
        }
      }

      // 3) 普通谈判强约：force 配置 / 无 E 检查已在 claim 校验（防死锁），这里只按 E 执行——
      //    claim 后教练写被冻结闸挡住，活跃会话只会减少不会新增
      const sessions = await db
        .prepare(
          `SELECT s.id FROM negotiation_sessions s
           JOIN transfers t ON t.id = s.transfer_id
           WHERE ${ACTIVE_SESSION_SQL} AND t.type != 'promotion' ORDER BY s.id LIMIT 200`,
        )
        .all<{ id: number }>();
      for (const s of sessions.results) {
        if (await forceSettleAtExpected(env, s.id, actor)) forceSettled++;
      }

      // 标 preflight done：强约计数落 step 自己的 summary_json（resume 收口回读用），同批把
      // current_step 推进到 payroll——段收口小批原子。v6.88.1 B3：本批强约产生的通知
      // （promoNotices）以 INSERT OR IGNORE 随同批原子落库 outbox，批回滚则行不落
      await db.batch([
        ...stageCloseNotificationStatements(db, run.id, promoNotices),
        ...completeCloseStep(db, run.id, CLOSE_STEP_PREFLIGHT, { forceSettled, promotionForceSettled }),
        setCloseCurrentStep(db, run.id, CLOSE_STEP_PAYROLL),
      ]);
    }

    // —— parity 硬口径：四个 builder 在任何业务段提交之前全部构建完（payroll → home → loyalty →
    //     squad_audit，调用顺序与参数保持 B1）。resume 时已提交段不重建（重建的后段会读到已提交
    //     状态，属 B4 恢复 parity 范围，本批登记在案）；跳过段的摘要由 finalize 从 step 行回读。——
    // 窗末扣款（v1.4.0；v3.0.0 按窗类型分支）：常规窗 = 富人税 → 工资 → 维护费 → 冠名收租；
    // 临时窗 = 富人税 → 维护费（工资不扣、冠名不收不减）
    currentStep = CLOSE_STEP_PAYROLL;
    let payroll: Awaited<ReturnType<typeof windowPayrollStatements>> | null = stepDone(steps, CLOSE_STEP_PAYROLL)
      ? null
      : await windowPayrollStatements(env, win.season, win.window_seq, { chargeWages: !isTemporary });
    // 窗末主场结算（v1.5.0）：维护费+死忠演化+冠名收租并入同批（幂等闸/原子语义与工资一致）
    currentStep = CLOSE_STEP_HOME;
    let home: Awaited<ReturnType<typeof windowHomeStatements>> | null = stepDone(steps, CLOSE_STEP_HOME)
      ? null
      : await windowHomeStatements(env, win.season, win.window_seq, { chargeNaming: !isTemporary, actor });
    currentStep = CLOSE_STEP_LOYALTY;
    // 忠诚支出（规则 4.3.2；v6.47.0 用户令 2026-10-13 定为俱乐部支出）：只在常规窗且同赛季第 2 个
    // （中期）关窗时扣，效力按关窗后窗刻度算（本窗 +0.5 已计入），逐队汇总，幂等 ref = window/season*100+windowSeq
    // summary.total = 扣款金额绝对值（正数），余额不足时扣成负 = 欠款
    let loyalty: {
      statements: ReturnType<Env['DB']['prepare']>[];
      summary: { count: number; total: number };
    } | null = null;
    if (!stepDone(steps, CLOSE_STEP_LOYALTY)) {
      loyalty = { statements: [], summary: { count: 0, total: 0 } };
      if (!isTemporary) {
        const ordinal = await regularWindowOrdinal(db, win.season, win.window_seq);
        if (ordinal === 2) {
          loyalty = await loyaltyMovements(db, actor, win.season, win.window_seq, (await closedRegularTicks(db)) + 1);
        }
      }
    }
    currentStep = CLOSE_STEP_SQUAD_AUDIT;
    // v6.69.0 期三（§3.4 / D3 / D6）：关窗同一原子步里写名单存档与体检结果。
    // 临时窗不动赛季存档（它不推进效力、也不改变阵容语义），只做常规窗。
    const squadAudit =
      stepDone(steps, CLOSE_STEP_SQUAD_AUDIT) || isTemporary
        ? null
        : await squadAuditStatements(env, win.season, win.window_seq);

    // —— 段 2-5 按 step 顺序提交：每批只含本段业务语句 + 本段 step done（段摘要同句落 step 行，
    //     resume 收口回读用）+ current_step 推进下一段。批内任何语句报错 = 整批回滚（D1 batch
    //     原子），由外层 catch markCloseStepFailed 收口：run failed、窗口留 closing、后段仍 pending、
    //     已提交前段不回滚；批内不依赖 changes=0 挡并发（互斥由 claim 写闸 + 租约两级承担）——
    if (payroll !== null) {
      currentStep = CLOSE_STEP_PAYROLL;
      await db.batch([
        ...payroll.statements,
        ...completeCloseStep(db, run.id, CLOSE_STEP_PAYROLL, payroll.summary),
        setCloseCurrentStep(db, run.id, CLOSE_STEP_HOME),
      ]);
    }
    if (home !== null) {
      currentStep = CLOSE_STEP_HOME;
      // v6.88.1 B3：home.notifications（情绪变化 / 品牌解约 / 招商轮四模板）不再留到 post_close
      // 直发——随本段批 INSERT OR IGNORE 原子落库 outbox（dedup_key = home:{clubId}:{template}:{序号}），
      // 崩在 home done 与 post_close 之间行已持久，resume 投递不丢
      await db.batch([
        ...home.statements,
        ...stageCloseNotificationStatements(db, run.id, homeNotificationItems(home.notifications)),
        ...completeCloseStep(db, run.id, CLOSE_STEP_HOME, home.summary),
        setCloseCurrentStep(db, run.id, CLOSE_STEP_LOYALTY),
      ]);
    }
    if (loyalty !== null) {
      currentStep = CLOSE_STEP_LOYALTY;
      await db.batch([
        ...loyalty.statements,
        ...completeCloseStep(db, run.id, CLOSE_STEP_LOYALTY, loyalty.summary),
        setCloseCurrentStep(db, run.id, CLOSE_STEP_SQUAD_AUDIT),
      ]);
    }
    // squad_audit 段：临时窗无业务语句也要标 done（施工表明文），提交闸按段 done 判而非按
    // builder 产物判——临时窗 squadAudit 为 null（无存档语义）仍要走 step 记账批。
    // v6.88.1 B3：体检未通过通知（文案/数据键自 post_close 原样搬移）随本段批原子落库
    // outbox（dedup_key = squad:{clubId}，CPU 队与通过队无行），post_close 统一投递
    if (!stepDone(steps, CLOSE_STEP_SQUAD_AUDIT)) {
      currentStep = CLOSE_STEP_SQUAD_AUDIT;
      const squadNotices = squadAudit === null ? [] : squadAuditNotificationItems(squadAudit.audits, win.season, win.window_seq);
      await db.batch([
        ...(squadAudit?.statements ?? []),
        ...stageCloseNotificationStatements(db, run.id, squadNotices),
        ...completeCloseStep(db, run.id, CLOSE_STEP_SQUAD_AUDIT),
        setCloseCurrentStep(db, run.id, CLOSE_STEP_FINALIZE),
      ]);
    }

    // —— 段 6 finalize 批：closing→closed + 审计 + finalize done + run completed + summary_json +
    //     current_step 推进 post_close，同批原子——整批回滚则 run 不会停在「业务已提交、run 未标完」
    //     的半截态 ——
    currentStep = CLOSE_STEP_FINALIZE;
    // finalize 汇总输入：本调用重建过的段用内存摘要；resume 跳过的 done 段从 step.summary_json
    // 回读（各段提交批同批落库，回读值与该段原建批一致），包回 bundle 形状（statements 弃用不用），
    // 让关窗摘要与审计继续以 payroll.summary / home.summary 同源引用（财政留痕源码锁口径）；
    // 回读缺失/损坏只可能是库被手工改过——防御 500
    const preflightCounts = ranPreflight
      ? { forceSettled, promotionForceSettled }
      : requirePreflightCounts(steps);
    payroll = payroll ?? { statements: [], summary: requirePayrollSummary(steps) };
    home = home ?? { statements: [], summary: requireHomeSummary(steps), notifications: [] };
    loyalty = loyalty ?? { statements: [], summary: requireLoyaltySummary(steps) };
    const summary: CloseWindowResult = {
      ok: true,
      season: win.season,
      windowSeq: win.window_seq,
      isTemporary,
      forceSettled: preflightCounts.forceSettled,
      payroll: payroll.summary,
      home: home.summary,
      loyalty: loyalty.summary,
    };
    const audit = createAuditStatement(db);
    if (ranFinalize) {
      await db.batch([
        db
          .prepare(`UPDATE season_windows SET status = 'closed', closed_at = ${nowSql()} WHERE season = ? AND window_seq = ? AND status = 'closing'`)
          .bind(win.season, win.window_seq),
        audit({
          actor,
          action: 'window_close',
          targetType: 'season_window',
          targetId: null,
          origin: 'user',
          after: {
            season: win.season,
            windowSeq: win.window_seq,
            isTemporary,
            forceSettled: preflightCounts.forceSettled,
            promotionForceSettled: preflightCounts.promotionForceSettled,
            loyaltyCount: loyalty.summary.count,
            loyaltyTotal: loyalty.summary.total, // 扣款金额绝对值（正数；余额可扣成负 = 欠款）
            // 同批扣款的逐类汇总：逐笔流水已各自带 memo/ref，此处补「这次关窗一共扣了多少」的可核对口径
            payroll: payroll.summary,
            home: home.summary,
          },
        }),
        // step 标 done + run 标 completed / completed_at / summary_json（与业务同批原子）
        ...completeCloseRun(db, run.id, CLOSE_STEP_FINALIZE, summary),
        setCloseCurrentStep(db, run.id, CLOSE_STEP_POST_CLOSE),
      ]);
    }

    // —— 段 7 post_close（后置动作段）：finalize 成功即关窗成功、run 已 completed（已裁决）——
    //     本段任何失败只把 step 标 failed + warnings 追加进 run.summary_json，不把 run 改回 failed、
    //     不改成功响应；通知 at-least-once（崩在「notifications 双通道行已写、outbox 行未标 sent」
    //     之间重投会重复一条，v6.88.1 B3 起 outbox 承载，不谎称 exactly-once）。
    //     resume 不再丢通知：三类通知已随各自段批持久化在 outbox，本段按 run_id 捞 pending/failed
    //     行投递，与本调用重建了哪些段无关。 ——
    currentStep = CLOSE_STEP_POST_CLOSE;
    const warnings: string[] = [];
    const warn = (label: string, err: unknown) =>
      warnings.push(`${label}：${err instanceof Error ? err.message : String(err)}`);

    if (ranPostClose) {
      // 三类关窗通知统一投递（v6.88.1 B3）：preflight/home/squad_audit 段已随各自收口批把通知
      // 落库 outbox（与段批同批原子），这里按 run 捞 pending/failed 严格投递——已 sent 不重投。
      // 失败只计不抛：failed>0 记 warning（段收口时 step 标 failed、run 保持 completed），管理端可重投
      try {
        const delivered = await deliverCloseNotifications(env, run.id);
        if (delivered.failed > 0) {
          warnings.push(`关窗通知投递失败 ${delivered.failed} 条（已投 ${delivered.delivered} 条），可在管理端重试`);
        }
      } catch (err) {
        warn('关窗通知投递失败', err);
      }
      // 窗尾收口（4.4.7）：无人出价下架收费、仍在竞价的强制进待审——此刻窗口已落 closed，
      // 窗口归属单据的 window_status 才会读到 closed（旧实现同口径：收口在批后跑结算）。
      // origin='user'：管理员关窗触发的惰性结算（actor 就是这位管理员）
      try {
        await settleOverdue(env, { actor, origin: 'user', season: win.season, windowSeq: win.window_seq });
      } catch (err) {
        warn('窗尾收口结算失败', err);
      }
      // 海捞暗标（v6.50.0）：关窗时批次还收着标 ⇒ 立即开标；失败批次留在 sealed，由下一轮 tick 兜底
      // （到点或时刻表行结束都会开），不再吞掉「窗已关」这个事实——失败只记 warning
      try {
        await openSealedBatchOnWindowClose(env, actor, win.season, win.window_seq);
      } catch (err) {
        warn('海捞开标失败', err);
      }
      // 段收口：有失败 → step 标 failed（markCloseStepFailed 的 run 语句按 status<>'completed'
      // 守卫不改 run——run 保持 completed）+ warnings 追加进 run.summary_json；全部成功 → 标 done。
      // 收口自身失败不再外抛：run 已 completed、事实不回滚，下次 closeWindow 走 completed 回放。
      try {
        if (warnings.length > 0) {
          await markCloseStepFailed(db, run.id, CLOSE_STEP_POST_CLOSE, warnings.join('；'));
          await appendCloseRunWarnings(db, run.id, warnings);
        } else {
          await db.batch([...completeCloseStep(db, run.id, CLOSE_STEP_POST_CLOSE)]);
        }
      } catch {
        // 段收口失败不影响关窗结果本身（run 已 completed；step 停留原状，B2 已知后果登记在案）
      }
    }

    return summary;
  } catch (err) {
    // 段失败收口（preflight 外部动作 / builders / 任一段批）：单独 batch 标当前段 failed +
    // run failed + error，窗口保持 closing；重试只前进——已提交段不回滚、已 done 段不重跑
    try {
      await markCloseStepFailed(db, run.id, currentStep, err);
    } catch {
      // 收口失败不掩盖原始错误：run 留在 running，租约 TTL 到期后可重新 acquire
    }
    throw err;
  }
}
