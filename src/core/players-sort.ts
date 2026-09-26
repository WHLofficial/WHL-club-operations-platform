// 球员库的排序键白名单（v3.1.0 步骤 9 复审从 src/worker/routes/players.ts 提到 core）。
// 提到这里的原因：前端 web/src/lib/players-library.ts 也要同一份表做 URL 校验，
// 原先两边各写一份字面量，测试比对的其实是硬编码副本 —— 后端加键、前端漏加不会有人发现。
// 与 src/core/fc26.ts 同样保持零 import：它会被打进前端 bundle。
//
// 语义（后端 src/worker/routes/players.ts 的 buildSortExprs 是权威实现）：
// - id 沿旧整数游标 ASC（既有调用兼容）；
// - 数值键走 COALESCE 双向 keyset，NULL 当 0（ASC 排首、DESC 排尾）；
// - 文本键（TEXT_SORT_KEYS）走文本游标，比较是 BINARY 码位序，靠表达式里的 lower() 拿 ASCII 大小写不敏感；
// - 非数值列不按字母序而按后端手写权重表：球队=clubs.id（筛选下拉里的队序）、位置=门将→后卫→中场→前锋、
//   状态=在队→挂牌→训练营→自由身→退役。这些列用户是按业务顺序找人的，字母序对它们没意义。
export const SORT_KEY_NAMES = [
  'id',
  'uid',
  'name',
  'club',
  'position',
  'age',
  'ca',
  'pa',
  'growable',
  'influence',
  'status',
  'market_value',
  'badges',
  'prestige',
  'base_ca',
  'marker',
  'growth_gap',
  'foot',
  'growth_tier',
  'future_star',
  'china_plan',
  'agent_tier',
  'ps',
  'fc_id',
  'wage',
  'release_fee',
  'contract_type',
  'source',
  'protected',
  'years',
] as const;

export type SortKeyName = (typeof SORT_KEY_NAMES)[number];

// 文本键：游标里带的是字符串而不是数字（其余键一律按数值比大小）
export const TEXT_SORT_KEYS: ReadonlySet<string> = new Set<string>(['name', 'contract_type', 'source']);
