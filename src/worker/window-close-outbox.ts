// 关窗通知 outbox 核心（v6.88.1 B3）：三类关窗通知（promotion_forced / home 段四模板
// naming_* / squad_audit_failed）在各段收口批里落库（stageCloseNotificationStatements，
// INSERT OR IGNORE 与段批同批原子），post_close 与管理端重试端点统一投递
// （deliverCloseNotifications / retryCloseNotifications）。段内落库与段批接线的编排归
// window-machine.ts，本文件只提供落库语句构造、行读取与投递三件原语。
//
// 语义要点：
//   · at-least-once，非 exactly-once：崩在「notifications 双通道行已写、outbox 行未标 sent」
//     之间 → 重投会重复一条（站内信 / QQ 各多一条），如实登记不做签名去重（超范围）；
//   · 投递只走 queueClubNotificationEx（严格返回 ok/count/error）：ok=false 标 failed +
//     last_error + attempt+1（不写 sent_at），ok=true（含无收件人 count=0 的完成态——没有
//     收件人不是可重试故障）标 sent + sent_at；已 sent 的行不进投递查询、不重投；
//   · 坏 payload（解析失败 / 非对象）直接标 failed（dispatchPendingNotifications 先例，
//     notify.ts 同款），防每轮重试空转；
//   · 每行独立 try/catch：单行 UPDATE 抛错算该行 failed、状态留原样可重投，不中断其余行；
//     函数整体的查询异常上抛，由调用方处置（post_close 走 warn 机制、重试端点给管理员看真错误）。
import type { Env } from './env.ts';
import { queueClubNotificationEx } from './notify.ts';

// 时间格式与全仓一致（window-close-runs.ts NOW_SQL / notify.ts nowSql 同款）：UTC ISO，可字符串比较
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * 待落库的关窗通知（生成点构造）。dedup_key 三族见迁移 0097 注释：
 * promotion:{sessionId} / home:{clubId}:{template}:{序号} / squad:{clubId}——
 * run 本身 UNIQUE(season, window_seq)，run_id 已隐含窗位，键不重复带 season/windowSeq。
 */
export interface CloseNotificationItem {
  clubId: number;
  template: string;
  dedupKey: string;
  /** 生成点 data 原文（投递时才渲染）；必须可 JSON 序列化 */
  data: Record<string, unknown>;
}

/**
 * 段内落库语句构造器：把通知行并入所在段收口批（preflight / home / squad_audit 的 step done
 * 批），与该段业务语句同批原子——段批回滚则行不落，段提交成功则行必在（崩溃不丢）。
 * INSERT OR IGNORE 吃段级重放：同 (run_id, dedup_key) 撞键静默吞（重复 close、失败重试均
 * 不重复落行）。
 */
export function stageCloseNotificationStatements(
  db: D1Database,
  runId: number,
  items: readonly CloseNotificationItem[],
): D1PreparedStatement[] {
  return items.map((item) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO window_close_notifications
           (run_id, club_id, template, payload, dedup_key, status, attempt, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ${NOW_SQL})`,
      )
      .bind(runId, item.clubId, item.template, JSON.stringify(item.data), item.dedupKey),
  );
}

/** window_close_notifications 行（camelCase 映射，DTO 口径同 CloseRunRow / CloseStepRow） */
export interface CloseNotificationRow {
  runId: number;
  clubId: number;
  template: string;
  /** 生成点 data 原文（JSON 字符串；投递时解析 + 渲染） */
  payload: string;
  dedupKey: string;
  /** pending/sent/failed（迁移 0097 DDL CHECK 紧枚举口径；列本身是 TEXT，异常值原样透传） */
  status: string;
  attempt: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface CloseNotificationDbRow {
  run_id: number;
  club_id: number;
  template: string;
  payload: string;
  dedup_key: string;
  status: string;
  attempt: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

const CLOSE_NOTIFICATION_COLUMNS =
  'run_id, club_id, template, payload, dedup_key, status, attempt, last_error, created_at, sent_at';

function toCloseNotificationRow(row: CloseNotificationDbRow): CloseNotificationRow {
  return {
    runId: row.run_id,
    clubId: row.club_id,
    template: row.template,
    payload: row.payload,
    dedupKey: row.dedup_key,
    status: row.status,
    attempt: row.attempt,
    lastError: row.last_error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

/** 按 run 读全部通知行（ORDER BY dedup_key 升序；状态端点 / 测试断言共用此读取口径） */
export async function listCloseNotifications(db: D1Database, runId: number): Promise<CloseNotificationRow[]> {
  const result = await db
    .prepare(
      `SELECT ${CLOSE_NOTIFICATION_COLUMNS}
       FROM window_close_notifications WHERE run_id = ? ORDER BY dedup_key`,
    )
    .bind(runId)
    .all<CloseNotificationDbRow>();
  return result.results.map(toCloseNotificationRow);
}

/** deliver / retry 的返回（口径同契约型 WindowCloseNotifyRetryResult：delivered/failed/skipped） */
export interface CloseNotificationDeliverResult {
  delivered: number;
  failed: number;
  skipped: number;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ok=true 的收口：sent + sent_at + attempt+1 + last_error 清空 */
async function markNotificationSent(db: D1Database, runId: number, dedupKey: string): Promise<void> {
  await db
    .prepare(
      `UPDATE window_close_notifications
       SET status = 'sent', sent_at = ${NOW_SQL}, last_error = NULL, attempt = attempt + 1
       WHERE run_id = ? AND dedup_key = ?`,
    )
    .bind(runId, dedupKey)
    .run();
}

/** ok=false / 坏 payload 的收口：failed + last_error + attempt+1（不写 sent_at） */
async function markNotificationFailed(db: D1Database, runId: number, dedupKey: string, error: string): Promise<void> {
  await db
    .prepare(
      `UPDATE window_close_notifications
       SET status = 'failed', last_error = ?, attempt = attempt + 1
       WHERE run_id = ? AND dedup_key = ?`,
    )
    .bind(error, runId, dedupKey)
    .run();
}

/**
 * 投递一个 run 的待发通知（post_close 与重试端点共用）：捞 pending/failed 行逐行投递，
 * 已 sent 的行不进查询、不重投。失败不抛（只统计）：调用方按 failed 数自行处置——
 * post_close 侧失败仅 step 标 failed + warnings，不阻断关窗（run 保持 completed）。
 */
export async function deliverCloseNotifications(env: Env, runId: number): Promise<CloseNotificationDeliverResult> {
  const db = env.DB;
  const rows = await db
    .prepare(
      `SELECT club_id, template, payload, dedup_key
       FROM window_close_notifications
       WHERE run_id = ? AND status IN ('pending', 'failed')
       ORDER BY dedup_key`,
    )
    .bind(runId)
    .all<{ club_id: number; template: string; payload: string; dedup_key: string }>();

  let delivered = 0;
  let failed = 0;
  for (const row of rows.results) {
    // 坏 payload（解析失败 / 非对象）照 dispatchPendingNotifications 先例直接标 failed，防每轮重试空转
    let data: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (isRecordObject(parsed)) data = parsed;
    } catch {
      // 解析失败：data 保持 null，走下方坏 payload 收口
    }
    if (data === null) {
      try {
        await markNotificationFailed(db, runId, row.dedup_key, 'payload 无法解析');
      } catch {
        // 收口失败：状态留原样，可再次重投
      }
      failed++;
      continue;
    }
    try {
      const r = await queueClubNotificationEx(env, row.club_id, row.template, data);
      if (r.ok) {
        await markNotificationSent(db, runId, row.dedup_key);
        delivered++;
      } else {
        await markNotificationFailed(db, runId, row.dedup_key, r.error ?? '未知');
        failed++;
      }
    } catch {
      // 单行投递/收口异常算该行 failed：状态留原样可重投，不中断其余行
      failed++;
    }
  }
  // skipped 为防御值：本查询只取 pending/failed，取到的每行必归入 delivered 或 failed ⇒ 恒 0
  //（已 sent 的行不进查询、不重投）；坏 payload 也计 failed，不走 skipped。
  return { delivered, failed, skipped: rows.results.length - delivered - failed };
}

/**
 * 重投一个 run 的失败/待发通知：与 deliverCloseNotifications 完全同义（同一查询、同一行级
 * 语义——ok 才标 sent），独立命名供管理端重试端点调用；已 sent 的行天然不进查询、不重投。
 */
export async function retryCloseNotifications(env: Env, runId: number): Promise<CloseNotificationDeliverResult> {
  return deliverCloseNotifications(env, runId);
}
