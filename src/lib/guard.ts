// 进程内守护（增量 23）：公开 GET 的固定窗口限流 + TTL SWR 缓存。
// 不用 KV：免费档写约 1k 次/天，公开 GET 每请求写计数/刷缓存会把写配额打爆；
// 进程内实现零配额成本，代价是 isolate 重启即清、多 isolate 不共享——朋友局流量可接受。
import { HttpError } from './http.ts';

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

// 固定窗口限流：true=放行，false=超限
export function memoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // Map 无界增长兜底：超量时顺手清掉已过期的桶
  if (rateBuckets.size > 10_000) {
    for (const [k, b] of rateBuckets) {
      if (now - b.windowStart >= windowMs) rateBuckets.delete(k);
    }
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

// 公开 GET 限流挂点：60 req/60s/IP（CF-Connecting-IP，本地/测试回落 'local'）
export function assertPublicRate(c: { req: { header(name: string): string | undefined } }, scope: string): void {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  if (!memoryRateLimit(`pub:${scope}:${ip}`, 60, 60_000)) {
    throw new HttpError(429, '请求太频繁，请稍后再试');
  }
}

type CacheEntry = { value: unknown; loadedAt: number; refreshing?: Promise<void> };
const cacheStore = new Map<string, CacheEntry>();

// TTL + SWR：新鲜直接回；过期回旧值并后台刷新（单飞，防击穿）；ttlMs<=0 旁路（测试环境默认旁路）。
// ctx 传 Hono executionCtx（Workers 下后台刷新活过请求结束）；拿不到就就地刷新不 waitUntil。
export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<T> {
  if (!(ttlMs > 0)) return loader();
  const entry = cacheStore.get(key);
  if (!entry) {
    const value = await loader();
    cacheStore.set(key, { value, loadedAt: Date.now() });
    return value;
  }
  if (Date.now() - entry.loadedAt < ttlMs) return entry.value as T;
  if (!entry.refreshing) {
    const refresh = loader()
      .then((v) => {
        cacheStore.set(key, { value: v, loadedAt: Date.now() });
      })
      .catch(() => {
        // 刷新失败保留旧值，下个请求再试
      });
    entry.refreshing = refresh;
    ctx?.waitUntil(refresh);
  }
  return entry.value as T;
}

// Hono executionCtx 在 Workers 里恒有；测试直接 app.request() 没有（getter 会抛），剥成可选
export function waitUntilOf(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }): {
  waitUntil(p: Promise<unknown>): void;
} | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

// 测试辅助：清空进程内状态（isolate 之间本来就不共享）
export function resetGuards(): void {
  rateBuckets.clear();
  cacheStore.clear();
}
