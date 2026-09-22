// 公开读缓存的分级策略（增量 28 裁决⑩）。
//
// 两件事必须分清：
// - **新鲜度**靠写路径 purge（见 WRITE_SCOPE_PREFIXES）——写后本 isolate 立即失效；
// - **TTL 只是 purge 失效时的自愈上限**：每天最坏重读次数 = 86400 ÷ TTL（每形状、每 colo）。
//   所以 TTL 决定的是「漏 purge / KV 抖动的代价」，不是新鲜度的来源。1h/24h 这种长兜底能成立，
//   前提正是 purge 挂钩在（否则列表会陈旧 1 小时）。
export type CacheScope = 'players' | 'roster' | 'clubs';

// 为什么分级而不是一个数：三个形状的「单次读量 × 键空间」差三个数量级。
// - players（列表）：键空间 = 筛选 × 排序 × 游标，无法枚举，只能靠代际键整体失效；单次 7~5.6 万行；
// - roster（名册）：**固定键、单次全表扫 18301 行**——300s 时每天 288 次 = 527 万行，单这一项就能
//   打爆免费档 5M/日，所以必须拉长；固定键的好处是写后能精确 cache.delete，长 TTL 也不会陈旧；
// - clubs（目录）：固定键、载荷 1KB、变更极少。
export const CACHE_TTL_MS: Record<CacheScope, number> = {
  players: 3_600_000,
  roster: 86_400_000,
  clubs: 86_400_000,
};

// 代际版本号**读失败**时，本次请求按这个短 TTL 处理：
// 把「长时间陈旧」降级为「读量短暂回升」——宁可多读几次，不可拿旧数据当新数据。
// （绑定缺失是另一回事：没有 KV 就无法 purge，只能靠 TTL，见 getCacheEpoch 的 optional chaining。）
export const EPOCH_FAIL_SHORT_MS = 60_000;

// 代际版本号的 isolate 内记忆时长。KV 读本身便宜，但每请求一次没必要；5s 意味着
// 别处 purge 后本 isolate 最多多陈旧 5s（KV 边缘缓存另有最长 60s 的传播延迟）。
export const EPOCH_MEMO_MS = 5_000;

// 公开读缓存覆盖的全部 scope（purge 时一起失效）。
export const PUBLIC_SCOPES: readonly CacheScope[] = ['players', 'roster', 'clubs'];

// 环境变量覆盖：显式给数（含 0 = 旁路）就照它，未配则用分级表。
// 生产不再配这个变量（`wrangler.jsonc` 里的 20000 已删）——分级表才是生产口径；
// 留这个开关是给测试（配 '0' 旁路，让断言不受缓存影响）和本地联调用的。
export function ttlForScope(scope: CacheScope, override?: string): number {
  const n = Number(override);
  if (Number.isFinite(n) && n >= 0) return n;
  return CACHE_TTL_MS[scope];
}

// 写路径 → 需要失效的 scope。**中心化挂钩**（worker/index.ts 的 middleware + scheduled）：
// 全仓有 27 个文件含写语句，逐个接 purge 必漏；漏接的代价是「列表最长陈旧 1h、名册/目录 24h」
// （兜底 TTL 自愈，有界但不新鲜）。宁可多 purge（一次 KV 写），不可漏 purge。
//
// 表按「这条写路径可能改到哪块公开数据」给，不给细粒度：
// 市场/转会/协商/注册都会改 contracts（→ 球员列表的合同列、名册的俱乐部归属），
// 管理端几乎什么都能改，故一律三个 scope 全失效。
// `/api/growth`（POST /api/growth/levelup/:id）单看是「球员成长」路径，但它会 UPDATE players 的
// ca/badges_silver/badges_gold（worker/growth.ts applyLevelUp）——列表的档位与影响力就吃这几个字段。
// 反例（刻意不列）：/api/notifications 只写 notifications、/api/auth 只写会话，都不在公开 scope 里。
export const WRITE_SCOPE_PREFIXES: ReadonlyArray<readonly [string, readonly CacheScope[]]> = [
  ['/api/club', PUBLIC_SCOPES],
  ['/api/admin', PUBLIC_SCOPES],
  ['/api/transfers', PUBLIC_SCOPES],
  ['/api/market', PUBLIC_SCOPES],
  ['/api/negotiations', PUBLIC_SCOPES],
  ['/api/registration', PUBLIC_SCOPES],
  ['/api/growth', PUBLIC_SCOPES],
  ['/api/cron', PUBLIC_SCOPES],
];

// 前缀按「路径段边界」匹配：`/api/club` 命中 `/api/club` 与 `/api/club/squad`，
// 不命中 `/api/clubs/directory`（那是公开只读目录，写路径不在其下）。
export function scopesForWritePath(path: string): CacheScope[] {
  for (const [prefix, scopes] of WRITE_SCOPE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return [...scopes];
  }
  return [];
}
