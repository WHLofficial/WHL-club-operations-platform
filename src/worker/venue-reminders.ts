// 关窗提醒（v6.53.0 §6.2）：唯一 open 窗临近估算关窗时刻（opened_at + window_length_hours）时，
// 给「本窗还有档位没排」的活跃队各发一条 venue_slot_reminder。
// 去重靠 season_windows.venue_reminder_at（§6.3）：写一次就不再重发；不并入 tickChanged。
import type { Env } from './env.ts';
import { createConfigService } from '../core/config.ts';
import { slotsForCapacity } from '../core/venue.ts';
import { queueClubNotification } from './notify.ts';

export interface VenueReminderSummary {
  /** 实际发出提醒的队数 */
  sent: number;
  /** 本次跳过（无窗 / 窗脏 / 未到提醒窗口 / 已被别的 tick 标记 / changes()=0） */
  skipped: number;
  /** queueClubNotification 抛错的队数 */
  failed: number;
}

const HOUR_MS = 3600_000;
/** 提醒阈值上限：最多提前 24h 提醒（窗长 168h 时 = 窗长的 1/7） */
const MAX_LEAD_MS = 24 * HOUR_MS;

interface VenueWindowRow {
  season: number;
  window_seq: number;
  opened_at: string | null;
  venue_reminder_at: string | null;
}

/**
 * 关窗提醒 tick。返回 { sent, skipped, failed }，**不抛错**（调用点仍包 try/catch 兜底）。
 * now 可注入，便于单测造「2 小时后关窗」。
 */
export async function runVenueReminderTick(env: Env, now: number = Date.now()): Promise<VenueReminderSummary> {
  const db = env.DB;
  const summary: VenueReminderSummary = { sent: 0, skipped: 0, failed: 0 };
  // 唯一 open 窗（0078 的 idx_season_windows_open 保证至多一条）；不改 getOpenWindow（它被十几处调用）
  // 临时窗（is_temporary=1）由管理端随时关闭，没有可靠的「关窗时刻」，不发提醒（开窗信已覆盖）。
  const win = await db
    .prepare(
      `SELECT season, window_seq, opened_at, venue_reminder_at
       FROM season_windows WHERE status = 'open' AND is_temporary = 0
       ORDER BY season DESC, window_seq DESC LIMIT 1`,
    )
    .first<VenueWindowRow>();
  if (!win) {
    summary.skipped++;
    return summary;
  }
  const openedAtMs = win.opened_at ? Date.parse(win.opened_at) : Number.NaN;
  if (!Number.isFinite(openedAtMs)) {
    // 存量脏行（opened_at 为空/不可解析）：关窗时刻未知，不猜
    summary.skipped++;
    return summary;
  }
  if ((win.venue_reminder_at ?? '') !== '') {
    summary.skipped++;
    return summary;
  }
  const config = createConfigService(db);
  const hours = (await config.getNumber('window_length_hours')) ?? 168;
  const closeAtMs = openedAtMs + hours * HOUR_MS;
  const threshold = Math.min(MAX_LEAD_MS, (closeAtMs - openedAtMs) / 3);
  const remaining = closeAtMs - now;
  if (!(remaining > 0) || remaining > threshold) {
    summary.skipped++;
    return summary;
  }
  const slotCap = (await config.getNumber('activity_slots')) ?? 4;
  const hoursLeft = Math.max(1, Math.round(remaining / HOUR_MS));
  // 先抢占本窗的提醒标记（并发 tick 只有一个能改到行）：changes()=0 ⇒ 别的 tick 已发过，直接跳过。
  // 抢占后再发信：发送失败也保留标记（宁可漏一条，也不每 5 分钟重发；失败数进 summary.failed）。
  const claimed = await db
    .prepare(`UPDATE season_windows SET venue_reminder_at = ? WHERE season = ? AND window_seq = ? AND venue_reminder_at = ''`)
    .bind(new Date(now).toISOString(), win.season, win.window_seq)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) {
    summary.skipped++;
    return summary;
  }
  const rows = await db
    .prepare(
      `SELECT c.id AS club_id, COALESCE(s.capacity, 0) AS capacity, COUNT(b.id) AS booked
       FROM clubs c
       LEFT JOIN stadiums s ON s.club_id = c.id
       LEFT JOIN venue_bookings b ON b.club_id = c.id AND b.season = ? AND b.window_seq = ?
       WHERE c.status = 'active'
       GROUP BY c.id, s.capacity
       ORDER BY c.id`,
    )
    .bind(win.season, win.window_seq)
    .all<{ club_id: number; capacity: number; booked: number }>();
  for (const row of rows.results) {
    // 无 stadium 行的队按 2 槽判断（slotsForCapacity(0, slotCap) = 2）
    const slots = slotsForCapacity(row.capacity, slotCap);
    const booked = row.booked ?? 0;
    if (slots <= 0 || booked >= slots) continue;
    try {
      // 返回值是「排了几条通道」（0 也可能是这个队没有绑定账号），照发不重试
      await queueClubNotification(env, row.club_id, 'venue_slot_reminder', {
        season: win.season,
        windowSeq: win.window_seq,
        slots,
        booked,
        hoursLeft,
        remain: slots - booked,
      });
      summary.sent++;
    } catch {
      // 单队失败不连坐其余队；已提醒标记已在上面抢占，不因个别失败回滚
      summary.failed++;
    }
  }
  return summary;
}
