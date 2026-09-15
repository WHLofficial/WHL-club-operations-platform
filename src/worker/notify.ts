// bot 通知（TECH_DESIGN §12）：notifications 表排队 → HMAC 签名 POST 到 AstrBot 接收插件
// → 200 标 sent，否则留 pending 下轮 cron 重试（惰性重试，无退避表）。协议照抄竞猜系统
// docs/astrbot-sync-api.md：X-Timestamp/X-Sign = HMAC-SHA256(SYNC_SECRET, `method|path|ts|body`)，
// 时间窗 ±300s；文本在平台侧用纯代码模板渲染好，插件只负责发 QQ。
import type { Env } from './env.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const DISPATCH_LIMIT = 50; // 每轮 cron 最多投递条数（§17 硬 LIMIT 纪律）
const NOTIFY_TIMEOUT_MS = 10_000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
    default:
      return String(data.text ?? '');
  }
}

/**
 * 给一个俱乐部排通知（尽力而为：俱乐部没绑教练/教练没绑 QQ 就静默跳过，§12-2）。
 * 排队失败不抛——通知绝不阻塞主流程（确认/升级先行）。
 * 绑定真源在 auth 库（增量 7）：先按 club_id 从 AUTH_DB 取绑定账号，再查本地 qq_links；
 * AUTH_DB 未配置回落本地休眠表（回滚通道）。
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
      .prepare(`SELECT qq FROM qq_links WHERE user_id IN (${placeholders}) ORDER BY user_id LIMIT 5`)
      .bind(...accountIds)
      .all<{ qq: string }>();
    if (qqs.results.length === 0) return 0;
    const text = renderNotification(template, data);
    await db.batch(
      qqs.results.map((r) =>
        db
          .prepare(
            `INSERT INTO notifications (club_id, channel, template, payload, status, created_at)
             VALUES (?, 'qq', ?, ?, 'pending', ${nowSql()})`,
          )
          .bind(clubId, template, JSON.stringify({ qq: r.qq, text })),
      ),
    );
    return qqs.results.length;
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
    `SELECT id, template, payload FROM notifications WHERE status = 'pending' ORDER BY id LIMIT ${DISPATCH_LIMIT}`,
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
