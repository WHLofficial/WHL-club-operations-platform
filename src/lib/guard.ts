// 进程内守护（增量 23）：公开 GET 的固定窗口限流 + TTL SWR 缓存。
// 增量 28：缓存加两层——L1 进程内（本文件）+ L2 边缘 Cache API（跨 isolate，同 colo 共享），
// 键带「代际版本号」（存 KV）以便写路径一次性整体失效。
import { HttpError } from './http.ts';
import { EPOCH_FAIL_SHORT_MS, EPOCH_MEMO_MS, type CacheScope } from './cache-policy.ts';

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
// - `allowUnset: false` = 未配 CRON_KEY 时拒绝而不是放行。生产 2026-09-22 已补配 CRON_KEY，
//   此前 fail-open 等于把一个「每次调用跑整表 COUNT」的端点公开出去；
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

// L1：进程内缓存。不用 KV 存载荷：免费档写约 1k 次/天，公开 GET 每请求写缓存会把写配额打爆；
// 进程内实现零配额成本，代价是 isolate 重启即清——这正是 L2（边缘 Cache API）存在的理由。
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

// ---- 代际版本号（增量 28）----
//
// 为什么不能按键枚举 purge：`/api/players` 的键空间 = 筛选 × 排序 × 游标（无穷），
// 而 Cache API 只有 match/put/delete、没有前缀删除；且 `cache.delete` 只作用于执行写请求的那个
// colo。所以键里带一个版本号，写路径 bump 一次 = 全局一次失效（L1 + L2 同时作废）。
//
// **公开读缓存共用一个版本号**，不按 scope 分开：`WRITE_SCOPE_PREFIXES` 里每条写路径都命中
// 全部三个 scope（写合同/归属/队名会同时改到列表、名册、目录），分开存只会让一次 purge 花
// 三次 KV 写、而三个版本号永远同步移动——KV 是**与登录会话共用**的绑定，免费档每天只有
// 1000 次写，把写配额花在同步移动的键上是拿「用户登不上去」的风险换零收益。
// 真出现「只改一块公开数据」的写路径时再拆（那时 L1 键前缀已带 scope，拆起来是局部的）。
//
// 版本号存 KV（跨 colo 唯一真源）。注意 KV 是最终一致的：边缘对同一键的读有最长 60s 缓存，
// 所以别的 colo 最多晚 60s 才看到新版本号（本 isolate purge 后立即生效）。
const EPOCH_KV_KEY = 'cache:epoch:public';

// 缓存相关的最小环境面（不依赖 workers-types：测试环境的 KV 是手写桩）
export interface CacheKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface CacheEnv {
  SESSION_KV?: CacheKV;
  PUBLIC_CACHE_TTL_MS?: string;
}

let epochMemo: { epoch: number; at: number } | null = null;

// 读当前版本号。degraded=true 表示 KV 读失败 ⇒ 调用方按短 TTL 处理。
export async function getCacheEpoch(env: CacheEnv): Promise<{ epoch: number; degraded: boolean }> {
  const now = Date.now();
  if (epochMemo && now - epochMemo.at < EPOCH_MEMO_MS) return { epoch: epochMemo.epoch, degraded: false };
  try {
    const raw = await env.SESSION_KV?.get(EPOCH_KV_KEY);
    const epoch = Number(raw) || 0;
    epochMemo = { epoch, at: now };
    return { epoch, degraded: false };
  } catch {
    // 不写 memo：下次请求重试 KV（抖动通常几秒内自愈）
    return { epoch: 0, degraded: true };
  }
}

// 写路径调用：版本号 +1 并清掉本 isolate 的 L1（版本号变了，旧键自然不可达）。
// 取「KV 现值与本地记忆的较大者 + 1」而不是「本地值 + 1」：两个 isolate 并发 purge 时，
// 后一个若基于过期记忆写回同值，会把前一个刚失效的窗口重新变成有效缓存。
// 整个函数只花一次 KV 读 + 一次 KV 写。
export async function purgePublicCaches(env: CacheEnv): Promise<void> {
  const kv = env.SESSION_KV;
  if (!kv) return;
  let current = epochMemo?.epoch ?? 0;
  try {
    current = Math.max(current, Number(await kv.get(EPOCH_KV_KEY)) || 0);
  } catch {
    // KV 读失败就用本地记忆值，至少保证版本号变化（变化本身就够用）
  }
  await kv.put(EPOCH_KV_KEY, String(current + 1));
  epochMemo = { epoch: current + 1, at: Date.now() };
  cacheStore.clear();
}

// ---- L2：边缘 Cache API ----
//
// 键用合成 URL：真实请求带 cookie/头，不能直接当缓存键；载荷存 JSON 文本。
// TTL 写在 `cache-control: max-age`（Cache API 的显式 put 按响应头算过期）。
// 全程 try/catch：L2 只是加速层，不可用（jsdom/node 里根本没有 caches）或写失败都不能影响正确性。
const L2_ORIGIN = 'https://cache.whl-club.internal/';

function l2Key(key: string): Request {
  return new Request(`${L2_ORIGIN}${encodeURIComponent(key)}`);
}

function l2Available(): boolean {
  return typeof caches !== 'undefined' && Boolean(caches) && 'default' in caches;
}

async function l2Match(key: string): Promise<unknown | undefined> {
  if (!l2Available()) return undefined;
  try {
    const hit = await caches.default.match(l2Key(key));
    if (!hit) return undefined;
    return (await hit.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function l2Put(key: string, value: unknown, ttlMs: number): Promise<void> {
  if (!l2Available()) return;
  try {
    await caches.default.put(
      l2Key(key),
      new Response(JSON.stringify(value), {
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          // Cache API 按响应头算过期；下限 60s 是它自己的粒度（max-age 太小等于不缓存）
          'cache-control': `public, max-age=${Math.max(60, Math.floor(ttlMs / 1000))}`,
        },
      }),
    );
  } catch {
    // L2 写失败只是少一次跨 isolate 复用
  }
}

export interface CachedJsonOptions {
  scope?: CacheScope;
  env?: CacheEnv;
  ctx?: { waitUntil(p: Promise<unknown>): void };
}

// TTL + SWR：新鲜直接回；过期回旧值并后台刷新（单飞，防击穿）；ttlMs<=0 旁路（测试环境默认旁路）。
// ctx 传 Hono executionCtx（Workers 下后台刷新活过请求结束）；拿不到就就地刷新不 waitUntil。
//
// 给了 scope + env 才有代际键与 L2；不给（单测直接验 TTL/SWR 语义）就是纯 L1 行为。
export async function cachedJson<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts: CachedJsonOptions = {},
): Promise<T> {
  if (!(ttlMs > 0)) return loader();
  const { scope, env, ctx } = opts;
  const epochState = scope && env ? await getCacheEpoch(env) : null;
  // 版本号读不到：本次按短 TTL（宁可多读，不可陈旧）
  const ttl = epochState?.degraded ? Math.min(ttlMs, EPOCH_FAIL_SHORT_MS) : ttlMs;
  const cacheKey = epochState ? `${scope}:v${epochState.epoch}:${key}` : key;

  const entry = cacheStore.get(cacheKey);
  if (entry) {
    if (Date.now() - entry.loadedAt < ttl) return entry.value as T;
    if (!entry.refreshing) {
      const refresh = loadAndStore(cacheKey, loader, ttl)
        .then((v) => rememberCache(cacheKey, v))
        .catch(() => {
          // 刷新失败保留旧值，下个请求再试。**必须复位 refreshing**：否则这个 entry 会永久
          // 停在「刷新中」，此后过期也再不触发刷新、一直伺服陈旧值——TTL 拉长后这就是最长 1h/24h 的陈旧
        })
        .finally(() => {
          entry.refreshing = undefined;
        });
      entry.refreshing = refresh;
      ctx?.waitUntil(refresh);
    }
    return entry.value as T;
  }

  // L1 未命中 → 问 L2（跨 isolate）。L2 命中只回填 L1，不再回写 L2（它自己的 max-age 管过期）。
  const l2Hit = await l2Match(cacheKey);
  if (l2Hit !== undefined) {
    rememberCache(cacheKey, l2Hit);
    return l2Hit as T;
  }

  const value = await loader();
  rememberCache(cacheKey, value);
  await l2Put(cacheKey, value, ttl);
  return value;
}

async function loadAndStore<T>(cacheKey: string, loader: () => Promise<T>, ttl: number): Promise<T> {
  const value = await loader();
  await l2Put(cacheKey, value, ttl);
  return value;
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
  epochMemo = null;
}
