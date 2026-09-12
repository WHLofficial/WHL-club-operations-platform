// KV 固定窗口限流（照抄比赛系统 worker/lib/ratelimit.ts）。
// KV 是最终一致，窗口边界少量超发对朋友局场景可接受。
export async function rateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const cur = Number((await kv.get(k)) ?? 0);
  if (cur >= limit) return false;
  await kv.put(k, String(cur + 1), { expirationTtl: windowSec });
  return true;
}
