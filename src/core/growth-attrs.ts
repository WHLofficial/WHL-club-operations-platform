// 属性成长加成（v6.61.0）：34 项细分属性统一按「初始属性 + CA 成长点数」展示。
//
// 口径（ROADMAP 既定「涨幅」delta，不另造字段）：
//   delta    = max(0, ca − COALESCE(base_ca, ca))   // base_ca 缺省回 ca ⇒ delta 0
//   显示属性 = min(99, game_attrs 键值 + delta)      // 撞 99 封顶，溢出丢弃
//
// 三条消费链共用这一个文件，不许各抄一份系数：
//   - 后端列表/筛选/排序：attrValueSql / growthDeltaSql（SQL 表达式生成，见 players.ts）
//   - 后端详情与 /players/meta：buffedAttrs（整包 JSON 加成）
//   - 导出脚本 scripts/prod-20261011-s10-export-squad：buffedValue（单值）
// 前端零逻辑改动：详情响应的 gameAttrs 由后端加成后下发，前端直读。
import { FC26_GAME_ATTR_COLUMNS } from './fc26.ts';

/** 34 项细分属性白名单（29 外场 + 5 门将 gk*），与 web/src/lib/players-library.ts 的 ATTR_KEYS 同一个切法。 */
export const ATTR_KEYS: readonly string[] = FC26_GAME_ATTR_COLUMNS.slice(
  FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed'),
);

/** 开关语义：growth_attr_bonus 配置 0 = 关 ⇒ 三处 delta 全按 0（等于回源值）。 */
export function attrBonusEnabled(value: number | null | undefined): boolean {
  return value !== 0;
}

/**
 * 成长点数 = max(0, ca − COALESCE(base_ca, ca))。
 * ca / base_ca 非有限数值、或开关关闭 ⇒ 0（只加不减，负差归零）。
 */
export function growthDelta(
  ca: number | null | undefined,
  baseCa: number | null | undefined,
  enabled?: boolean,
): number {
  if (enabled === false) return 0;
  if (typeof ca !== 'number' || !Number.isFinite(ca)) return 0;
  const base = typeof baseCa === 'number' && Number.isFinite(baseCa) ? baseCa : ca;
  return Math.max(0, ca - base);
}

/**
 * 单值加成：null / 非有限数值原样返回 null（缺键透传，不凭空造值）；
 * 数字与数字字符串（与 SQL 侧 `+ 0` 的算术转换同口径）取 min(99, 值 + delta)。
 * 已知分歧（数据不可达，按导入/成长机器只写 1-99 整数对待）：非数字字符串 SQL 侧当 0、JS 侧 null；
 * boolean SQL 侧当 1、JS 侧 null；delta=0 时 SQL/导出仍钳 min(99,·)、JS 整包早退不钳。
 */
export function buffedValue(raw: unknown, delta: number): number | null {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(99, n + delta);
}

/**
 * 整包加成：只改 ATTR_KEYS 命中的键，其余键（CA/PA/身高/PSID…）原样保留；缺键不补。
 * delta = 0 时返回浅拷贝（值不变，调用方可放心改写）。
 */
export function buffedAttrs(
  attrs: Record<string, unknown>,
  delta: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...attrs };
  if (!(delta > 0)) return out;
  for (const key of ATTR_KEYS) {
    if (key in out) out[key] = buffedValue(out[key], delta);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL 表达式（列表取值 / 区间筛选 / 属性排序共用同一个生成器，不许手抄）
// ---------------------------------------------------------------------------

/**
 * 成长点数的 SQL 片段：MAX(0, COALESCE(<caExpr>, 0) − COALESCE(base_ca, ca, 0))。
 * 两侧各套 COALESCE：ca 为 NULL 的行（夹具/理论形态）`NULL − x` 还是 NULL，MAX(0, NULL) 也返 NULL，
 * 会把整条取值表达式拖成 NULL —— 与 JS 侧 growthDelta(ca=null) = 0 对齐，delta 按 0。
 * view=initial 时 caExpr = COALESCE(base_ca, ca) ⇒ delta 自然归 0，不需要额外分支。
 * 开关关闭时调用方直接传 '0'，表达式退化成纯钳制（缺键仍返 NULL，不会凭空造值）。
 */
export function growthDeltaSql(caExpr: string): string {
  return `MAX(0, COALESCE(${caExpr}, 0) - COALESCE(players.base_ca, players.ca, 0))`;
}

/**
 * 加成后的属性取值表达式（g = players.game_attrs）：
 *   MIN(99, json_extract(g,'$.k') + 0 + <delta>)
 * 缺键 / 键值为 JSON null 时 json_extract 返回 NULL，标量 min() 任一参数为 NULL 即返回 NULL
 * ⇒ 缺键透传（响应 null），不会像旧写法 COALESCE(...+0, 0) 那样把缺键当 0 再加出 delta。
 * 键值若是数字字符串，`+ 0` 拉回数值域（与游标侧 Number() 同口径）。
 * 键必须先过 ATTR_KEYS 白名单（调用方负责），否则存在任意键注入。
 */
export function attrValueSql(key: string, deltaSql: string): string {
  return `MIN(99, json_extract(players.game_attrs, '$.${key}') + 0 + ${deltaSql})`;
}
