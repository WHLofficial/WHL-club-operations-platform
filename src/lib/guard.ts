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

// 内部端点密钥校验（增量 28 从 worker/index.ts 抽出来，供 /api/cron/* 共用）：
// X-Cron-Key 头或 ?key= 对 c.env.CRON_KEY；本地/测试未配 secret 时放行便于联调。
// 这些端点不挂公开限流与公开缓存（它们要么触发结算、要么跑整表 COUNT），守卫只有这一道。
//
// 两个开关（默认都按既有语义来，只有纯读放大的端点才收紧）：
// - `allowUnset: false` = 未配 CRON_KEY 时拒绝而不是放行。生产 whl-club 目前**没有** CRON_KEY
//   （实测 2026-09-22 `wrangler secret list` 只有 AUTH_BIND_SECRET），放行等于把一个「每次调用
//   跑整表 COUNT」的端点公开出去；
// - `queryKey: false` = 只认 X-Cron-Key 头。GET + `?key=` 会把密钥写进访问日志/Referer。
export function assertCronKey(
  c: {
    req: { header(name: string): string | undefined; query(name: string): string | undefined };
    env: { CRON_KEY?: string };
  },
  opts: { allowUnset?: boolean; queryKey?: boolean } = {},
): void {
  const expected = c.env.CRON_KEY;
  if (!expected) {
    if (opts.allowUnset ?? true) return;
    throw new HttpError(403, '未配置 CRON_KEY，该内部端点不可用');
  }
  const provided = c.req.header('X-Cron-Key') ?? ((opts.queryKey ?? true) ? c.req.query('key') : undefined);
  if (provided !== expected) throw new HttpError(403, 'cron 密钥不对');
}

type CacheEntry = { value: unknown; loadedAt: number; refreshing?: Promise<void> };
const cacheStore = new Map<string, CacheEntry>();

// 缓存条数上限：键来自请求查询串（外部可控），不设上限会长住 isolate 内存——
// 公开 GET 每换一个查询串就多一条，爬虫/构造请求能一路堆到 isolate OOM。
// 超限按插入序淘汰最旧的（正在刷新的跳过，别把在飞的刷新结果丢了）；缓存只是加速层，
// 淘汰不影响正确性。单条响应实测 4KB 量级，64 条上限下最坏也就几百 KB。
const MAX_CACHE_ENTRIES = 64;

function rememberCache(key: string, value: unknown): void {
  if (!cacheStore.has(key) && cacheStore.size >= MAX_CACHE_ENTRIES) {
    let need = cacheStore.size - MAX_CACHE_ENTRIES + 1;
    for (const [k, entry] of cacheStore) {
      if (need <= 0) break;
      if (entry.refreshing) continue;
      cacheStore.delete(k);
      need -= 1;
    }
  }
  cacheStore.set(key, { value, loadedAt: Date.now() });
}

// 查询串归一成缓存键：参数按名排序（顺序不同=同一份数据），键仍受外部输入影响，故另有条数上限兜底
export function canonicalQuery(url: string): string {
  const entries = [...new URL(url).searchParams.entries()];
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

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
    rememberCache(key, value);
    return value;
  }
  if (Date.now() - entry.loadedAt < ttlMs) return entry.value as T;
  if (!entry.refreshing) {
    const refresh = loader()
      .then((v) => {
        rememberCache(key, v);
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
