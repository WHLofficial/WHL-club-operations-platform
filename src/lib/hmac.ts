// 机器通道签名（v6.1.0）：tour ↔ club 球队建档双向同步共用一把 TEAM_SYNC_SECRET。
// 规范串与 auth machine.ts / 本仓 notify.ts / 赛事仓 clubSync.ts 逐字一致：
// X-Sign = hex(HMAC-SHA256(secret, `POST|path|ts|raw`))，X-Timestamp 秒级，窗口 ±300s。
//
// 为什么入站 fail-closed：这是**写**端点。cron 那类守卫（guard.ts 的 assertCronKey）未配密钥时
// 默认放行，代价只是本地联调时多算一次；放行一个能 INSERT clubs 行的端点是另一回事——未配密钥就拒。
export const TEAM_SYNC_CLOCK_SKEW_S = 300;

export async function hmacHex(secret: string, message: string): Promise<string> {
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

/** 定长 hex 比较：长度不同直接 false，逐字符异或累积，不短路。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = 'ok' | 'unconfigured' | 'reject';

/**
 * 校验一次入站机器调用。
 * rawBody 必须是**请求原文**：签名吃的是字节，重新 JSON.stringify 会改掉键序/空白而验签失败。
 * path 用不带查询串的路径（与签名侧一致）。
 */
export async function verifyTeamSync(
  secret: string | undefined,
  path: string,
  rawBody: string,
  tsHeader: string | null,
  signHeader: string | null,
): Promise<VerifyResult> {
  if (!secret) return 'unconfigured';
  if (!tsHeader || !signHeader) return 'reject';
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return 'reject';
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TEAM_SYNC_CLOCK_SKEW_S) return 'reject';
  const expected = await hmacHex(secret, `POST|${path}|${tsHeader}|${rawBody}`);
  return timingSafeEqual(expected, signHeader) ? 'ok' : 'reject';
}
