// 运营时刻表读库 + 闸门 + 保存（v6.49.0）。设计见 memory/design-ops-schedule-expiry.md。
// 60s 内存缓存（与 src/core/config.ts 同口径：管理端改后 ≤60s 生效）；保存后本 isolate 立即失效。
// 闸门是「同步」的一半：写路径进来先问一句「这个操作现在开着吗」；另一半是到期引擎（expiry-ops.ts）。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement } from '../lib/audit.ts';
import {
  fmtBeijingMinute,
  opsKeyMeta,
  opsLabelOf,
  OPS_KEYS,
  opsStateLabel,
  resolveOpsRow,
  validateOpsInput,
  type OpsEndAnchor,
  type OpsInput,
  type OpsRow,
  type OpsStartAnchor,
  type OpsState,
  type OpsWindowRef,
} from '../core/ops-schedule.ts';

const OPS_TTL_MS = 60_000;
const NOTE_MAX = 200;

interface OpsDbRow {
  op_key: string;
  start_anchor: string;
  start_at: string | null;
  end_anchor: string;
  end_at: string | null;
  requires_window: number;
  close_inflight: number;
  note: string;
}

let cache: { at: number; rows: Map<string, OpsRow> } | null = null;

/** 测试用：清缓存（管理端保存后本函数也会被调）。 */
export function resetOpsScheduleCache(): void {
  cache = null;
}

export async function loadOpsRows(db: D1Database): Promise<Map<string, OpsRow>> {
  const at = Date.now();
  if (cache && at - cache.at < OPS_TTL_MS) return cache.rows;
  const res = await db
    .prepare(`SELECT op_key, start_anchor, start_at, end_anchor, end_at, requires_window, close_inflight, note FROM ops_schedule`)
    .all<OpsDbRow>();
  const rows = new Map<string, OpsRow>();
  for (const r of res.results) {
    rows.set(r.op_key, {
      opKey: r.op_key,
      startAnchor: r.start_anchor as OpsStartAnchor,
      startAt: r.start_at,
      endAnchor: r.end_anchor as OpsEndAnchor,
      endAt: r.end_at,
      requiresWindow: r.requires_window === 1,
      closeInflight: r.close_inflight === 1,
      note: r.note,
    });
  }
  cache = { at, rows };
  return rows;
}

/** 当前开放窗口的 opened_at/closed_at（随开窗锚的唯一来源；无开放窗口回 null）。 */
export async function loadWindowRef(db: D1Database): Promise<OpsWindowRef | null> {
  const row = await db
    .prepare(
      `SELECT opened_at, closed_at FROM season_windows WHERE status = 'open'
       ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<{ opened_at: string | null; closed_at: string | null }>();
  if (!row) return null;
  return { openedAt: row.opened_at ?? '', closedAt: row.closed_at };
}

// ---- 闸门（写路径调用）----

/**
 * 该操作现在是否开着？未登记 / 全 none（现状）= 放行（零行为变化，且不查窗口表）。
 * 到点未开 → 409 op_not_started；已结束 → 409 op_closed。服务器时钟唯一权威（v6.24.0）。
 */
export async function assertOpOpen(db: D1Database, opKey: string): Promise<void> {
  const row = (await loadOpsRows(db)).get(opKey);
  if (!row || (row.startAnchor === 'none' && row.endAnchor === 'none')) return;
  const window = await loadWindowRef(db);
  const resolved = resolveOpsRow(row, window, new Date().toISOString());
  const label = opsLabelOf(opKey);
  if (resolved.state === 'not_started') {
    throw new HttpError(409, `${label}还没开始（北京时间 ${fmtBeijingMinute(resolved.startAt!)} 起）`, 'op_not_started');
  }
  if (resolved.state === 'closed') {
    const tail = resolved.endAt ? `（北京时间 ${fmtBeijingMinute(resolved.endAt)} 止）` : '（转会窗口已关）';
    throw new HttpError(409, `${label}已结束${tail}`, 'op_closed');
  }
}

// ---- 读接口（教练侧 + 管理端共用）----

export interface OpsStatusRow {
  key: string;
  label: string;
  group: string;
  desc: string;
  startAnchor: OpsStartAnchor;
  startAt: string | null;
  endAnchor: OpsEndAnchor;
  endAt: string | null;
  requiresWindow: boolean;
  closeInflight: boolean;
  note: string;
  state: OpsState;
  stateLabel: string;
  resolvedStartAt: string | null;
  resolvedEndAt: string | null;
  endIsWindowClose: boolean;
}

export interface OpsScheduleView {
  now: string;
  window: OpsWindowRef | null;
  rows: OpsStatusRow[];
}

export async function opsScheduleView(db: D1Database, nowIso?: string): Promise<OpsScheduleView> {
  const rows = await loadOpsRows(db);
  const window = await loadWindowRef(db);
  const now = nowIso ?? new Date().toISOString();
  const out: OpsStatusRow[] = [];
  for (const [key, row] of rows) {
    const meta = opsKeyMeta(key);
    const resolved = resolveOpsRow(row, window, now);
    out.push({
      key,
      label: meta?.label ?? key,
      group: meta?.group ?? '',
      desc: meta?.desc ?? '',
      startAnchor: row.startAnchor,
      startAt: row.startAt,
      endAnchor: row.endAnchor,
      endAt: row.endAt,
      requiresWindow: row.requiresWindow,
      closeInflight: row.closeInflight,
      note: row.note,
      state: resolved.state,
      stateLabel: opsStateLabel(resolved.state),
      resolvedStartAt: resolved.startAt,
      resolvedEndAt: resolved.endAt,
      endIsWindowClose: resolved.endIsWindowClose,
    });
  }
  // 固定顺序：按 core 里的键序（OPS_KEYS 的顺序即管理端表单顺序；表序对运营无意义）
  out.sort((a, b) => opsKeyOrder(a.key) - opsKeyOrder(b.key));
  return { now, window, rows: out };
}

function opsKeyOrder(key: string): number {
  const idx = OPS_KEYS.findIndex((m) => m.key === key);
  return idx < 0 ? 999 : idx;
}

// ---- 管理端保存 ----

export interface OpsSaveInput extends OpsInput {
  note?: string | null;
  closeInflight?: boolean;
}

/** 保存一行（管理端）：校验 → 更新 → 审计 ops_schedule_set。返回保存后的状态行。 */
export async function saveOpsRow(env: Env, opKey: string, input: OpsSaveInput, actor: number | null): Promise<OpsStatusRow> {
  const db = env.DB;
  const meta = opsKeyMeta(opKey);
  if (!meta) throw new HttpError(404, `没有这个操作键：${opKey}`, 'unknown_op_key');
  const err = validateOpsInput(input);
  if (err) throw new HttpError(400, err, 'invalid_schedule');
  const note = (input.note ?? '').trim().slice(0, NOTE_MAX);
  const before = (await loadOpsRows(db)).get(opKey) ?? null;
  const after: OpsRow = {
    opKey,
    startAnchor: input.startAnchor as OpsStartAnchor,
    startAt: input.startAnchor === 'absolute' ? input.startAt : null,
    endAnchor: input.endAnchor as OpsEndAnchor,
    endAt: input.endAnchor === 'absolute' ? input.endAt : null,
    requiresWindow: input.requiresWindow,
    closeInflight: input.closeInflight ?? before?.closeInflight ?? true,
    note,
  };
  const audit = createAuditStatement(db);
  await db.batch([
    db
      .prepare(
        `UPDATE ops_schedule SET start_anchor = ?, start_at = ?, end_anchor = ?, end_at = ?, requires_window = ?,
                close_inflight = ?, note = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE op_key = ?`,
      )
      .bind(
        after.startAnchor,
        after.startAt,
        after.endAnchor,
        after.endAt,
        after.requiresWindow ? 1 : 0,
        after.closeInflight ? 1 : 0,
        after.note,
        actor,
        opKey,
      ),
    audit({
      actor,
      action: 'ops_schedule_set',
      targetType: 'ops_schedule',
      targetId: null,
      origin: 'user',
      before,
      after,
      guardSql: 'changes() > 0',
    }),
  ]);
  resetOpsScheduleCache();
  const view = await opsScheduleView(db);
  const saved = view.rows.find((r) => r.key === opKey);
  if (!saved) throw new HttpError(500, '保存后读回失败', 'ops_schedule_readback');
  return saved;
}
