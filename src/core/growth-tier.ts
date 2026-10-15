// §10.3 成长档位规则（v6.48.0 自动核定）：唯一真源。
//
// 口径（TECH_DESIGN §10.3）：档位初始 1、上限 5，条件叠加——
//   c1 现实效力与队壳一致 +1（「现实效力」按来源球队 = game_attrs.TeamID，用户口径 2026-10-14）
//   c2 会籍与队壳国家一致 +1（会籍 = game_attrs.naID；队壳国家 = clubs.country，人工录入的现实事实）
//   c3 中国国籍（大陆）+1（china_plan = 1，只认 naID 155 China PR；港澳台是独立 id 不算）
//   c4 未来之星 +2（is_future_star = 1）
//   c5 ≤18 岁 +1（age，导入时由 birthdate 算一次，本版不做年龄滚动）
//   tier = MIN(1 + c1 + c2 + c3 + 2·c4 + c5, 5)
//
// 缺数据不猜：club_id / TeamID / naID / clubs.country 缺任一，对应条件记 false（不是当命中）。
// 本模块两种形态同口径：GROWTH_TIER_SQL_* 是生产真源（重算/明细查询都走 SQL），
// evaluateGrowthTier 是 TS 镜像（端点文案与单测用；tests/growth-tier.test.ts 断言两者在
// 同一组 fixture 上结果一致）。

export const GROWTH_TIER_MIN = 1;
export const GROWTH_TIER_MAX = 5;

/** 条件键（c1..c5） */
export type GrowthTierConditionKey = 'c1' | 'c2' | 'c3' | 'c4' | 'c5';

export interface GrowthTierConditionMeta {
  key: GrowthTierConditionKey;
  label: string;
  points: number;
  hint: string;
}

/** 条件元数据（顺序即展示序；points 是叠加分值） */
export const GROWTH_TIER_CONDITIONS: readonly GrowthTierConditionMeta[] = [
  { key: 'c1', label: '现实效力与队壳一致', points: 1, hint: '来源球队 = 队壳' },
  { key: 'c2', label: '会籍与队壳国家一致', points: 1, hint: '会籍（naID）= 队壳国家' },
  { key: 'c3', label: '中国国籍（大陆）', points: 1, hint: 'naID 155 China PR' },
  { key: 'c4', label: '未来之星', points: 2, hint: '管理组名单（Growth+）' },
  { key: 'c5', label: '≤18 岁', points: 1, hint: '导入时年龄 ≤18' },
] as const;

// ---- SQL 形态（生产真源；别名约定：p = players，c = clubs（LEFT JOIN c.id = p.club_id））----

/** 单条件 SQL 片段（布尔表达式，供 SELECT 取 0/1 或直接当谓词用） */
export const TIER_CONDITION_SQL: Record<GrowthTierConditionKey, string> = {
  // 坏 JSON 兜底必须写成 CASE + COALESCE：实测（node:sqlite / D1 同源）`json_valid(x) AND json_extract(x, …)`
  // 在 SELECT 投影里会抛 "malformed JSON"——AND 两侧不保证短路，优化器会先把 json_extract 求出来。
  // CASE 的分支顺序求值，json_valid 不通过就绝不下探；比较结果用 COALESCE(…, 0) 收成 0，
  // 否则 NULL 会顺着 1 + (c1) + … 把整条档位表达式污染成 NULL（MIN(NULL, 5) = NULL）。
  c1: `(p.club_id IS NOT NULL AND COALESCE(CASE WHEN json_valid(p.game_attrs) THEN CAST(json_extract(p.game_attrs, '$.TeamID') AS INTEGER) END = p.club_id, 0))`,
  c2: `(p.club_id IS NOT NULL AND c.country IS NOT NULL AND COALESCE(CASE WHEN json_valid(p.game_attrs) THEN CAST(json_extract(p.game_attrs, '$.naID') AS INTEGER) END = c.country, 0))`,
  c3: `(p.china_plan = 1)`,
  c4: `(p.is_future_star = 1)`,
  c5: `(p.age IS NOT NULL AND p.age <= 18)`,
};

/** 档位 SQL 表达式（1 + 叠加，上限截断） */
export const GROWTH_TIER_SQL = `MIN(${GROWTH_TIER_MIN} + (${TIER_CONDITION_SQL.c1}) + (${TIER_CONDITION_SQL.c2}) + (${TIER_CONDITION_SQL.c3}) + 2 * (${TIER_CONDITION_SQL.c4}) + (${TIER_CONDITION_SQL.c5}), ${GROWTH_TIER_MAX})`;

/**
 * 数据缺失 SQL（缺数据不猜：对应条件恒不命中，且端点标注「数据缺失」）。
 * 用 CASE 保证求值顺序——坏 JSON 上绝不走到 json_extract（那会抛错）。
 * 口径与 evaluateGrowthTier 的 missing 一致：
 *   c1 有队壳但来源球队（TeamID）缺；c2 有队壳但会籍（naID）或队壳国家缺。
 */
export const TIER_MISSING_SQL: Record<'c1' | 'c2', string> = {
  c1: `(p.club_id IS NOT NULL AND CASE WHEN p.game_attrs IS NULL THEN 1 WHEN json_valid(p.game_attrs) = 0 THEN 1 WHEN json_extract(p.game_attrs, '$.TeamID') IS NULL THEN 1 ELSE 0 END = 1)`,
  c2: `(p.club_id IS NOT NULL AND (c.country IS NULL OR CASE WHEN p.game_attrs IS NULL THEN 1 WHEN json_valid(p.game_attrs) = 0 THEN 1 WHEN json_extract(p.game_attrs, '$.naID') IS NULL THEN 1 ELSE 0 END = 1))`,
};

/** 缺失标记取列（与 GROWTH_TIER_SELECT 同别名约定） */
export const GROWTH_TIER_MISSING_SELECT = `CASE WHEN ${TIER_MISSING_SQL.c1} THEN 1 ELSE 0 END AS miss_c1, CASE WHEN ${TIER_MISSING_SQL.c2} THEN 1 ELSE 0 END AS miss_c2`;

/** 明细查询的取列清单（档位判定所需的最小集）：当前档/锁定/队壳国家/五条件命中/自动档位 */
export const GROWTH_TIER_SELECT = [
  'p.growth_tier AS current_tier',
  'p.growth_tier_locked AS locked',
  'c.country AS club_country',
  ...GROWTH_TIER_CONDITIONS.map((cond) => `CASE WHEN ${TIER_CONDITION_SQL[cond.key]} THEN 1 ELSE 0 END AS ${cond.key}`),
  `${GROWTH_TIER_SQL} AS next_tier`,
].join(', ');

// ---- TS 镜像 ----

export interface GrowthTierInput {
  clubId: number | null;
  /** 来源球队（game_attrs.TeamID）；缺失 = null */
  teamId: number | null;
  /** 会籍（game_attrs.naID）；缺失 = null */
  nationId: number | null;
  /** 队壳国家（clubs.country）；未设 = null */
  clubCountry: number | null;
  chinaPlan: boolean;
  isFutureStar: boolean;
  age: number | null;
}

export interface GrowthTierEvaluation {
  tier: number;
  hits: Record<GrowthTierConditionKey, boolean>;
  /** 数据缺失导致无法判定的条件（缺数据不猜：这些条件 hits 恒 false） */
  missing: GrowthTierConditionKey[];
}

export function evaluateGrowthTier(input: GrowthTierInput): GrowthTierEvaluation {
  const hasClub = input.clubId !== null;
  const c1 = hasClub && input.teamId !== null && input.teamId === input.clubId;
  const c2 = hasClub && input.clubCountry !== null && input.nationId !== null && input.nationId === input.clubCountry;
  const c3 = input.chinaPlan;
  const c4 = input.isFutureStar;
  const c5 = input.age !== null && input.age <= 18;
  const hits: Record<GrowthTierConditionKey, boolean> = { c1, c2, c3, c4, c5 };
  const score = GROWTH_TIER_MIN + (c1 ? 1 : 0) + (c2 ? 1 : 0) + (c3 ? 1 : 0) + 2 * (c4 ? 1 : 0) + (c5 ? 1 : 0);
  const missing: GrowthTierConditionKey[] = [];
  if (hasClub && input.teamId === null) missing.push('c1');
  if (hasClub && (input.nationId === null || input.clubCountry === null)) missing.push('c2');
  return { tier: Math.min(score, GROWTH_TIER_MAX), hits, missing };
}

/** 从 game_attrs JSON（TEXT 或已解析对象）取整数属性；取不到回 null（与 SQL CAST 同宽容度） */
export function gameAttrInt(attrs: unknown, key: string): number | null {
  let obj: unknown = attrs;
  if (typeof attrs === 'string') {
    try {
      obj = JSON.parse(attrs);
    } catch {
      return null;
    }
  }
  if (obj === null || typeof obj !== 'object') return null;
  const raw = (obj as Record<string, unknown>)[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export interface TierConditionDetail extends GrowthTierConditionMeta {
  hit: boolean;
  /** 该条件因数据缺失无法判定（缺数据不猜） */
  missing: boolean;
}

/** 条件明细（端点下发用）：命中 / 数据缺失 / 未命中三态 */
export function tierConditionDetails(hits: Record<GrowthTierConditionKey, boolean>, missing: GrowthTierConditionKey[] = []): TierConditionDetail[] {
  return GROWTH_TIER_CONDITIONS.map((cond) => ({
    ...cond,
    hit: hits[cond.key] === true,
    missing: missing.includes(cond.key),
  }));
}
