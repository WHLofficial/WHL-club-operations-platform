// 统一到期引擎（v6.49.0）。设计见 memory/design-ops-schedule-expiry.md。
// 一类时限 = 一个适配器（close 收口 / remind 临近提醒），调度只有一处：runSettleTick 的第 5 步。
// 新增时限不改调度；每个适配器各自 try/catch，一个坏不拖垮其余（与 runSettleTick 四步同纪律）。
//
// 「时段结束收口在途」也走这里：运营时刻表某行到点且勾了 close_inflight ⇒ closeAll=true，
// 适配器忽略各自时限、把在途全部收口（理由 ops_end）。
import type { Env } from './env.ts';
import type { AuditOrigin } from '../lib/audit.ts';
import { resolveOpsRow } from '../core/ops-schedule.ts';
import { loadOpsRows, loadWindowRef } from './ops-schedule.ts';
import { expireDueOffers, remindDueOffers } from './offers.ts';
import { closeSilentSessions, remindSilentSessions } from './negotiations.ts';
import { expireDueSeaBatches, remindDueSeaBatches } from './sea-sealed.ts';

/** 单轮每个适配器最多处理的行数（与 event-ops 的 EVENT_TICK_LIMIT 同量级，防一个适配器霸占 tick）。 */
export const EXPIRY_LIMIT = 50;

/** 临近提醒的提前量：距到点不足 24h 提醒一次（reminded_at 抢占，只发一次）。 */
export const EXPIRY_REMIND_LEAD_HOURS = 24;

export interface ExpiryOpts {
  origin: AuditOrigin;
  nowIso: string;
  /** 时段已结束且勾了 close_inflight ⇒ 忽略各自时限，在途全部收口 */
  closeAll: boolean;
  limit: number;
  /** 提前提醒窗口（小时） */
  remindLeadHours: number;
}

export interface ExpiryAdapter {
  name: string;
  /** 对应运营时刻表的哪一行（决定「时段是否结束」） */
  opsKey: string;
  /** 到点收口；返回真正收口的条数（幂等：守卫 WHERE 未命中即 0） */
  close(env: Env, opts: ExpiryOpts): Promise<number>;
  /** 临近提醒；返回真正发出的条数（可选） */
  remind?(env: Env, opts: ExpiryOpts): Promise<number>;
}

const EXPIRY_ADAPTERS: ExpiryAdapter[] = [
  { name: 'offer', opsKey: 'transfer_offer', close: expireDueOffers, remind: remindDueOffers },
  { name: 'negotiation', opsKey: 'transfer_negotiation', close: closeSilentSessions, remind: remindSilentSessions },
  // v6.50.0 海捞暗标：到点开标；时刻表行提前结束（close_inflight）⇒ 不等 deadline 直接开标。
  // 两阶段关掉时（sea_enabled=false）这里顺带把还收着标的批次整批作废 + 解冻，不留悬挂冻结
  { name: 'sea_sealed', opsKey: 'transfer_sea_sealed', close: expireDueSeaBatches, remind: remindDueSeaBatches },
];

export interface ExpirySummary {
  closed: number;
  reminded: number;
  byAdapter: Record<string, number>;
  errors: string[];
}

/**
 * 跑一轮到期检查。origin 由调用方给（cron_tick / lazy_settle / user）。
 * 时段结束判定只看「终点」：endAnchor 非 none 且已到（含随关窗 = 窗口已关）。
 */
export async function runExpiryTick(env: Env, origin: AuditOrigin = 'cron_tick'): Promise<ExpirySummary> {
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const rows = await loadOpsRows(db);
  const window = await loadWindowRef(db);
  const summary: ExpirySummary = { closed: 0, reminded: 0, byAdapter: {}, errors: [] };

  for (const adapter of EXPIRY_ADAPTERS) {
    const row = rows.get(adapter.opsKey);
    let closeAll = false;
    if (row) {
      const resolved = resolveOpsRow(row, window, nowIso);
      // 时段结束 ⇒ close_inflight 决定在途是否跟着收口。
      // 「结束」含随窗关闭（end_anchor=window_close 或起点随窗但窗口已关）：这种行没有具体终点时间，
      // 但操作确实结束了，勾了就得收——否则「随关窗止」这个选项在收口上等于没生效。
      if (resolved.state === 'closed') closeAll = row.closeInflight;
    }
    const opts: ExpiryOpts = { origin, nowIso, closeAll, limit: EXPIRY_LIMIT, remindLeadHours: EXPIRY_REMIND_LEAD_HOURS };
    try {
      const closed = await adapter.close(env, opts);
      summary.closed += closed;
      summary.byAdapter[adapter.name] = closed;
      if (!closeAll && adapter.remind) summary.reminded += await adapter.remind(env, opts);
    } catch (err) {
      summary.errors.push(`${adapter.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
