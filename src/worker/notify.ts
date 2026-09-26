// bot 通知（TECH_DESIGN §12）：notifications 表排队 → HMAC 签名 POST 到 AstrBot 接收插件
// → 200 标 sent，否则留 pending 下轮 cron 重试（惰性重试，无退避表）。协议照抄竞猜系统
// docs/astrbot-sync-api.md：X-Timestamp/X-Sign = HMAC-SHA256(SYNC_SECRET, `method|path|ts|body`)，
// 时间窗 ±300s；文本在平台侧用纯代码模板渲染好，插件只负责发 QQ。
import type { Env } from './env.ts';
import { hmacHex } from '../lib/hmac.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const DISPATCH_LIMIT = 50; // 每轮 cron 最多投递条数（§17 硬 LIMIT 纪律）
const NOTIFY_TIMEOUT_MS = 10_000;

/** 带签名的投递调用（竞猜 signAndFetch 同款规范串）。 */
async function signAndPost(env: Env, path: string, body: unknown): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const raw = JSON.stringify(body);
  const canonical = `POST|${path}|${ts}|${raw}`;
  const sign = await hmacHex(env.SYNC_SECRET ?? '', canonical);
  return fetch(`${env.SYNC_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Timestamp': ts, 'X-Sign': sign },
    body: raw,
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
}

// ---- 模板渲染（纯代码，无 LLM；§12）----

export function renderNotification(template: string, data: Record<string, unknown>): string {
  switch (template) {
    case 'result_confirmed':
      return `📋 赛果已确认：${data.home} ${data.score} ${data.away}（S${data.season}·窗${data.windowSeq}${data.competition ? ` · ${data.competition}` : ''}）。`;
    case 'levelup':
      return `🎉 ${data.player} 升级完成：+${data.ca} CA${data.silver ? `，银徽章 +${data.silver}` : ''}${data.gold ? `，金徽章 +${data.gold}` : ''}。`;
    // 报价 / 议价（v6.3.0，设计 §5）：金额单位 m，均带 offerId 供跳转
    case 'offer_received':
      return `📩 收到报价：${data.amount} m 报 ${data.player}（对方已冻结资金），去谈判桌处理。`;
    case 'offer_countered':
      return `🔄 ${data.by}还价：${data.player} 报价抬到 ${data.amount} m，轮到你表态。`;
    case 'offer_accepted':
      return `🤝 报价已被同意：${data.player} 以 ${data.amount} m 达成协议，已自动挂牌并锁定你的出价为领先。`;
    case 'offer_rejected':
      return `🚫 报价被拒：${data.player} ${data.amount != null ? `的 ${data.amount} m 报价` : '的报价'}被卖家拒绝${data.reason === 'not_for_sale' ? '（球员被设为非卖品）' : ''}，冻结已退回。`;
    case 'offer_withdrawn':
      return `↩️ 报价撤回：对方撤回了对 ${data.player} 的 ${data.amount} m 报价。`;
    case 'offer_expired':
      return `⌛ 报价过期：${data.player} 的报价已失效${data.reason === 'sold' ? '（球员已被卖家挂牌，报价通道关闭，冻结已退回）' : '（转会窗已关或球员状态已变）'}，冻结已退回。`;
    case 'offer_auto_accepted':
      return `🤝 自动同意：${data.player} 的 ${data.amount} m 报价达到最低报价线，已自动同意并挂牌。`;
    case 'offer_auto_rejected':
      return `🚫 自动拒：${data.player} 的 ${data.amount} m 报价低于最低报价线（${data.min} m），直接被拒，冻结已退回。`;
    // 激活通知证据制（v6.4.0 改动 4）：激活必附 QQ 通知截图，被激活方可举报（举报不冻结匹配窗）
    case 'activation_notice':
      return `📣 激活通知：你的球员 ${data.player} 被「${data.activatorName}」按激活转会激活（金额 ${data.fee} m）。对方已提交 QQ 通知截图（管理端可查），如未收到 QQ 通知请到该球员页举报。`;
    case 'activation_reported':
      return `⚠️ 举报：对方俱乐部举报未收到激活的 QQ 通知（挂牌 #${data.listingId}），管理组将核查你提交的截图。`;
    case 'activation_matched':
      return `🛡 匹配：#${data.listingId} 的激活被对方匹配留队（新违约金 ${data.newReleaseFee} m > 你的出价 ${data.previousBid} m），资金已解冻。`;
    case 'activation_passed':
      return `✅ 放行：#${data.listingId} 的激活被对方放行，按激活价成交进审核。`;
    case 'activation_match_expired':
      return `⌛ 匹配窗结束：#${data.listingId} 的激活匹配窗到期未匹配，按激活价成交进审核。`;
    default:
      return String(data.text ?? '');
  }
}

/**
 * 给一个俱乐部排通知（尽力而为：排队失败不抛——通知绝不阻塞主流程，§12-2）。
 * 双通道（v2.4.0 站内信）：web 行按绑定账号逐人写（status='sent' 免投递，收件篮读）；
 * QQ 行照旧只写给 qq_links 命中的账号。绑定真源在 auth 库（v1.0.0）：先按 club_id 从
 * AUTH_DB 取绑定账号，再查本地 qq_links；AUTH_DB 未配置回落本地休眠表（回滚通道）。
 */
export async function queueClubNotification(
  env: Env,
  clubId: number | null,
  template: string,
  data: Record<string, unknown>,
): Promise<number> {
  if (clubId === null) return 0;
  const db = env.DB;
  try {
    let accountIds: number[];
    if (env.AUTH_DB) {
      const bound = await env.AUTH_DB.prepare(
        `SELECT b.account_id AS user_id FROM team_binding b JOIN team t ON t.id = b.team_id
         WHERE t.club_id = ? ORDER BY b.account_id LIMIT 5`,
      )
        .bind(clubId)
        .all<{ user_id: number }>();
      accountIds = bound.results.map((r) => r.user_id);
    } else {
      const bound = await db.prepare('SELECT user_id FROM club_bindings WHERE club_id = ? ORDER BY user_id LIMIT 5')
        .bind(clubId)
        .all<{ user_id: number }>();
      accountIds = bound.results.map((r) => r.user_id);
    }
    if (accountIds.length === 0) return 0;
    const placeholders = accountIds.map(() => '?').join(', ');
    const qqs = await db
      .prepare(`SELECT user_id, qq FROM qq_links WHERE user_id IN (${placeholders}) ORDER BY user_id LIMIT 5`)
      .bind(...accountIds)
      .all<{ user_id: number; qq: string }>();
    const text = renderNotification(template, data);
    // 每个绑定账号都有一条 web 行（收件篮，status='sent' 免投递）；绑了 QQ 的账号另有一条
    // QQ 投递行（status='pending'，cron 投递），两通道互不挤占
    await db.batch([
      ...accountIds.map((userId) =>
        db
          .prepare(
            `INSERT INTO notifications (club_id, user_id, channel, template, payload, status, created_at)
             VALUES (?, ?, 'web', ?, ?, 'sent', ${nowSql()})`,
          )
          .bind(clubId, userId, template, JSON.stringify({ text })),
      ),
      ...qqs.results.map((r) =>
        db
          .prepare(
            `INSERT INTO notifications (club_id, user_id, channel, template, payload, status, created_at)
             VALUES (?, ?, 'qq', ?, ?, 'pending', ${nowSql()})`,
          )
          .bind(clubId, r.user_id, template, JSON.stringify({ qq: r.qq, text })),
      ),
    ]);
    return accountIds.length + qqs.results.length;
  } catch {
    return 0;
  }
}

/**
 * 投递一轮 pending（cron 与手动 tick 共用）。200 → sent；超时/非 200 → 留 pending 下轮再试。
 * 未配置 SYNC_BASE_URL/SYNC_SECRET 时跳过（本地联调友好）。
 */
export async function dispatchPendingNotifications(env: Env): Promise<{
  checked: number;
  sent: number;
  failed: number;
  skipped: string;
}> {
  if (!env.SYNC_BASE_URL || !env.SYNC_SECRET) {
    return { checked: 0, sent: 0, failed: 0, skipped: 'unconfigured' };
  }
  const rows = await env.DB.prepare(
    `SELECT id, template, payload FROM notifications WHERE status = 'pending' AND channel = 'qq' ORDER BY id LIMIT ${DISPATCH_LIMIT}`,
  ).all<{ id: number; template: string; payload: string }>();

  let sent = 0;
  let failed = 0;
  for (const row of rows.results) {
    let body: { qq?: string; text?: string };
    try {
      body = JSON.parse(row.payload);
    } catch {
      // 坏 payload 永远发不出去，标 failed 防止每轮空转
      await env.DB.prepare(`UPDATE notifications SET status = 'failed', sent_at = ${nowSql()} WHERE id = ?`).bind(row.id).run();
      failed++;
      continue;
    }
    try {
      const res = await signAndPost(env, '/notify', { qq: body.qq, template: row.template, text: body.text });
      if (res.ok) {
        await env.DB.prepare(`UPDATE notifications SET status = 'sent', sent_at = ${nowSql()} WHERE id = ?`).bind(row.id).run();
        sent++;
      } else {
        failed++;
      }
    } catch {
      failed++; // 超时/网络错误：留 pending，下轮 cron 重试（§12）
    }
  }
  return { checked: rows.results.length, sent, failed, skipped: '' };
}
