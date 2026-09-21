// 球员查询（附录 A〔1〕，🌐 公开：跳过会话检查，§17.3-5）
import { Hono, type Context } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { assertPublicRate, cachedJson, canonicalQuery, waitUntilOf } from '../../lib/guard.ts';
import { createConfigService } from '../../core/config.ts';
import { FC26_GAME_ATTR_COLUMNS, POSITION_BY_ID } from '../../core/fc26.ts';
import { serviceSeasons } from '../../core/bypass-rules.ts';
import { foldNameQuery, likeContains, sqlFold } from '../../core/name-fold.ts';
import { SORT_KEY_NAMES, TEXT_SORT_KEYS, type SortKeyName } from '../../core/players-sort.ts';
import { playerAbilityLevel } from '../home.ts';

const app = new Hono<{ Bindings: Env }>();

// 窗刻度基准（增量 25）：当前已关常规窗数——效力 = 0.5 ×(本值 − contracts.service_ticks)，
// 保护期判定 = 本值 < contracts.protection_ticks（季初/中期按同赛季非临时窗顺序派生，不入库）
const CURRENT_TICKS_SQL = `(SELECT COUNT(*) FROM season_windows swe WHERE swe.status = 'closed' AND swe.is_temporary = 0)`;

const PLAYER_STATUS = ['normal', 'listed', 'trainee', 'free', 'retired'] as const;
const CONTRACT_TYPES = ['formal', 'trainee'] as const;
const CONTRACT_SOURCES = ['negotiation', 'forced', 'direct', 'import'] as const;
// 细分属性白名单（FC26 源列尾段：sprintspeed 起共 34 项 = 29 外场 + 5 门将）；
// attr 筛选的 json_extract 键必须在此表内，拼 SQL 前拦住任意键注入
const ATTR_KEYS: readonly string[] = FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed'));
const POSITION_NAMES: readonly string[] = Object.values(POSITION_BY_ID);

// 球员库排序键（增量 6.1 d6；增量 26 扩到表头每一列）：表本身在 src/core/players-sort.ts，
// 与前端 web/src/lib/players-library.ts 共用同一份 —— 两边各写一份字面量时，后端加键前端漏加没人会发现
// 键的语义（数值 keyset / 文本游标 / 手写权重序）见那个文件，实现见下面的 buildSortExprs
// influence（增量 17）：规则 4.1.3 球员影响力=系数×能力等级×国际声望，现值口径，ROUND 2 位
// view=initial（增量 6.1 d7）：初始球员库=导入时数据——CA=base_ca、PA=导入 json 值（归属无「初始」维度，
// 增量 14 裁决 4 删掉 initial_club_id：它从不参与成长判定，只是同一件事的第二种说法）
type SortKey = SortKeyName;
// 游标里文本值的长度上限：库里最长姓名 22 字符（生产实测），拦掉塞长串游标的玩法
const TEXT_CURSOR_MAX = 120;

// 位置权重：门将 1 → 后卫 2 → 中场 3 → 前锋 4（与前端 POSITION_GROUPS 的分组同序）
const POSITION_SORT_CASE = `CASE players.position
  WHEN 'GK' THEN 1
  WHEN 'RB' THEN 2 WHEN 'CB' THEN 2 WHEN 'LB' THEN 2
  WHEN 'CDM' THEN 3 WHEN 'RM' THEN 3 WHEN 'CM' THEN 3 WHEN 'LM' THEN 3 WHEN 'CAM' THEN 3
  WHEN 'RW' THEN 4 WHEN 'ST' THEN 4 WHEN 'LW' THEN 4
  ELSE 0 END`;
// 状态权重：在队 1 → 挂牌 2 → 训练营 3 → 自由身 4 → 退役 5（与前端 STATUS_LABEL 同序；取值见 PLAYER_STATUS）
const STATUS_SORT_CASE = `CASE players.status
  WHEN 'normal' THEN 1 WHEN 'listed' THEN 2 WHEN 'trainee' THEN 3 WHEN 'free' THEN 4 WHEN 'retired' THEN 5
  ELSE 0 END`;
// PlayStyle 列按「挂了几个」排：PSID1-15 的非空槽计数（金徽存的是基础 ID+100，仍是同一个槽）。
// 每个 IS NOT NULL 必须自带括号：SQLite 里 + 的优先级高于 IS NOT NULL，不括起来会被解析成一整串比较
const PS_COUNT_EXPR = `(${Array.from(
  { length: 15 },
  (_, i) => `(json_extract(players.game_attrs, '$.PSID${i + 1}') IS NOT NULL)`,
).join(' + ')})`;

// 排序表达式：ORDER BY、SELECT 里的 sort_key、游标比较表达式三处共用同一份，保证游标值与排序值逐位一致；
// 视图口径（caExpr/paExpr）与运行时影响力系数（inflExpr）都在这儿注入
function buildSortExprs(ctx: { caExpr: string; paExpr: string; inflExpr: string }): Record<SortKey, string> {
  return {
    id: 'players.id',
    // uid = 'fc' + fcId（core/import.ts:154/218），表里显示的是去掉前缀的号，排序也按号不走字符串
    uid: "COALESCE(CAST(SUBSTR(players.uid, 3) AS INTEGER), 0)",
    name: sqlFold('players.name'),
    club: 'COALESCE(players.club_id, 0)',
    position: POSITION_SORT_CASE,
    age: 'COALESCE(players.age, 0)',
    ca: `COALESCE(${ctx.caExpr}, 0)`,
    pa: `COALESCE(${ctx.paExpr}, 0)`,
    growable: 'COALESCE(players.growable, 0)',
    influence: ctx.inflExpr,
    status: STATUS_SORT_CASE,
    market_value: 'COALESCE(players.market_value, 0)',
    badges: '(COALESCE(players.badges_silver, 0) + COALESCE(players.badges_gold, 0))',
    prestige: 'COALESCE(players.prestige, 0)',
    base_ca: 'COALESCE(players.base_ca, 0)',
    growth_gap: `(COALESCE(${ctx.paExpr}, 0) - COALESCE(${ctx.caExpr}, 0))`,
    foot: 'COALESCE(players.foot, 0)',
    growth_tier: 'COALESCE(players.growth_tier, 0)',
    future_star: 'COALESCE(players.is_future_star, 0)',
    china_plan: 'COALESCE(players.china_plan, 0)',
    agent_tier: 'COALESCE(players.agent_tier, 0)',
    ps: PS_COUNT_EXPR,
    fc_id: 'COALESCE(players.fc_id, 0)',
    // 合同维度全部取现行合同（与列表 LEFT JOIN contracts ... is_active = 1 同源）；无合同的一方按 0 / 空串
    wage: 'COALESCE(ct.wage, 0)',
    release_fee: 'COALESCE(ct.release_fee, 0)',
    contract_type: "COALESCE(ct.contract_type, '')",
    source: "COALESCE(ct.source, '')",
    // 与行映射里的 protected（增量 25）= 是否在保护期内，同一条判据
    protected: `CASE WHEN ct.protection_ticks IS NOT NULL AND (${CURRENT_TICKS_SQL}) < ct.protection_ticks THEN 1 ELSE 0 END`,
    // 效力时长（赛季）= 0.5 ×(已关常规窗数 − 签约基数)，与 effective_years_* 筛选同源；
    // 无现行合同的球员没有签约基数可比，按 0 参与排序（不能拿 NULL 当键：keyset 的 NULL 比较恒为假，会漏行）
    years: `CASE WHEN ct.player_id IS NULL THEN 0 ELSE ((${CURRENT_TICKS_SQL}) - COALESCE(ct.service_ticks, 0)) * 0.5 END`,
  };
}

// 细分属性的排序表达式（表头每个属性列都能点）：属性值存在 game_attrs 的 JSON 里，可能是数字、字符串或缺键；
// NULL 当 0 与其它数值键同口径（否则 keyset 的 NULL 比较恒为假会漏行）。键必须先在 ATTR_KEYS 白名单里过一遍
function attrSortExpr(key: string): string {
  // `+ 0`：属性值理论上是数字，但若哪天混进字符串（'80' 或 '★'），游标侧 Number() 会得 NaN / 与 TEXT
  // 比较恒假 ⇒ 翻页静默截断。算术转换把两者都拉回数值域（非数字当 0），与其它数值键同口径
  return `COALESCE(json_extract(players.game_attrs, '$.${key}') + 0, 0)`;
}

// 编 cursor 用的行内字段：非 id 排序时 SELECT 额外带出 `sort_key`（与 ORDER BY 同一表达式，保证游标值与排序值逐位一致）

const RANGE_PARAMS = {
  ca_min: { col: 'players.ca', op: '>=' },
  ca_max: { col: 'players.ca', op: '<=' },
  pa_min: { col: 'players.pa', op: '>=' },
  pa_max: { col: 'players.pa', op: '<=' },
  age_min: { col: 'players.age', op: '>=' },
  age_max: { col: 'players.age', op: '<=' },
  prestige_min: { col: 'players.prestige', op: '>=' },
  prestige_max: { col: 'players.prestige', op: '<=' },
  market_value_min: { col: 'players.market_value', op: '>=' },
  market_value_max: { col: 'players.market_value', op: '<=' },
  base_ca_min: { col: 'COALESCE(players.base_ca, players.ca)', op: '>=' },
  base_ca_max: { col: 'COALESCE(players.base_ca, players.ca)', op: '<=' },
} as const;

const CONTRACT_RANGE_PARAMS = {
  wage_min: { col: 'ct.wage', op: '>=' },
  wage_max: { col: 'ct.wage', op: '<=' },
  release_fee_min: { col: 'ct.release_fee', op: '>=' },
  release_fee_max: { col: 'ct.release_fee', op: '<=' },
} as const;

function decodeNumericCursor(raw: string): { v: number; id: number } {
  const sep = raw.lastIndexOf('~');
  if (sep <= 0) throw new HttpError(400, 'cursor 不对');
  const v = Number(raw.slice(0, sep));
  const id = Number(raw.slice(sep + 1));
  if (!Number.isFinite(v) || !Number.isInteger(id) || id < 0) throw new HttpError(400, 'cursor 不对');
  return { v, id };
}

// 文本键的游标：`<排序值>~<球员 id>`。值里可能有 ~（姓名可能出现），所以从最后一个 ~ 切；
// 排序值为空串是合法状态（无现行合同的 contract_type / source 就是 ''），所以 sep 允许为 0
function decodeTextCursor(raw: string): { v: string; id: number } {
  const sep = raw.lastIndexOf('~');
  if (sep < 0) throw new HttpError(400, 'cursor 不对');
  const v = raw.slice(0, sep);
  const id = Number(raw.slice(sep + 1));
  if (v.length > TEXT_CURSOR_MAX || !Number.isInteger(id) || id < 0) throw new HttpError(400, 'cursor 不对');
  return { v, id };
}

// 规则 4.1.2 十档表（与 home.ts abilityTier 同源的 SQL 版）：NULL 当 1 档
function tierCase(expr: string): string {
  return `(CASE WHEN ${expr} IS NULL THEN 1 WHEN ${expr} >= 93 THEN 10 WHEN ${expr} >= 90 THEN 9 WHEN ${expr} >= 87 THEN 8 WHEN ${expr} >= 84 THEN 7 WHEN ${expr} >= 80 THEN 6 WHEN ${expr} >= 75 THEN 5 WHEN ${expr} >= 70 THEN 4 WHEN ${expr} >= 65 THEN 3 WHEN ${expr} >= 60 THEN 2 ELSE 1 END)`;
}

// 规则 4.1.3 球员影响力的 SQL 版（系数内联：来自 config 的已验证数字，ROUND 2 位与 JS 镜像对齐）
function influenceExpr(coefs: { g: number; s: number }): string {
  const tierCa = tierCase('players.ca');
  const tierPa = tierCase('players.pa');
  const g = coefs.g.toFixed(6);
  const s = coefs.s.toFixed(6);
  return `(ROUND(CASE WHEN players.growable = 1 AND players.ca IS NOT NULL AND players.pa IS NOT NULL
    THEN ${g} * ((${tierCa} + ${tierPa}) / 2.0) * COALESCE(players.prestige, 0)
    ELSE ${s} * ${tierCa} * COALESCE(players.prestige, 0) END, 2))`;
}

// JS 镜像：响应里的 influence 用现值 CA/PA 算（与 SQL 表达式必须逐位一致，翻页游标两端对齐）
function influenceOf(coefs: { g: number; s: number }, ca: number | null, pa: number | null, growable: boolean, prestige: number | null): number {
  const coef = growable ? coefs.g : coefs.s;
  return Math.round(coef * playerAbilityLevel(ca, pa, growable ? 1 : 0) * (prestige ?? 0) * 100) / 100;
}

async function influenceCoefs(db: Env['DB']): Promise<{ g: number; s: number }> {
  try {
    const raw = await createConfigService(db).get('attendance_model');
    if (raw) {
      const model = JSON.parse(raw) as { influence_coef_growable?: unknown; influence_coef_static?: unknown };
      const g = Number(model.influence_coef_growable);
      const s = Number(model.influence_coef_static);
      if (Number.isFinite(g) && g >= 0 && g <= 1 && Number.isFinite(s) && s >= 0 && s <= 1) return { g, s };
    }
  } catch {
    // 配置缺失或坏 JSON：退回规则 4.1.3 原文系数
  }
  return { g: 0.25, s: 0.13 };
}

// GET /api/players —— 球员库列表
// 筛选：view / club_id / status / position（逗号分隔多值，含 PosID2-4 槽）/ name / growable / foot /
//       growth_tier / is_future_star / china_plan / agent_tier / badges_silver_min / badges_gold_min /
//       badges_none / fc_id / ca·pa·age·prestige·base_ca·market_value·成长空间·影响力·细分属性·合同维度区间 /
//       has_contract / wage·release_fee 区间 / release_fee_none / contract_type / source / protected / effective_years
// 排序（增量 26 起表头每一列都可点，键名见 SORT_KEY_NAMES，属性列用 attr:<属性键>）：sort + order（id 固定 ASC 旧整数游标；
//       name / contract_type / source 三个文本键走文本游标，其余数值键走 keyset）
// 增量 26：name 走去变音折叠（core/name-fold）——「sesko」能搜到「Šeško」
// 增量 23：公开 GET 挂进程内限流（60/min/IP）+ TTL SWR 缓存（PUBLIC_CACHE_TTL_MS，未配=旁路）；
// 缓存键用归一后的查询串（canonicalQuery），条数上限由 guard 侧兜底
app.get('/players', async (c) => {
  assertPublicRate(c, 'players');
  const ttlMs = Number(c.env.PUBLIC_CACHE_TTL_MS) || 0;
  const data = await cachedJson(
    `players:${canonicalQuery(c.req.url)}`,
    ttlMs,
    () => listPlayers(c),
    waitUntilOf(c),
  );
  return c.json(data);
});

async function listPlayers(c: Context<{ Bindings: Env }>): Promise<{
  players: unknown[];
  total: number;
  nextCursor: string | null;
}> {
  const viewRaw = c.req.query('view');
  if (viewRaw !== undefined && viewRaw !== 'initial') throw new HttpError(400, 'view 只能是 initial');
  const initial = viewRaw === 'initial';
  const caExpr = initial ? 'COALESCE(players.base_ca, players.ca)' : 'players.ca';
  const paExpr = initial ? "COALESCE(json_extract(players.game_attrs, '$.PA'), players.pa)" : 'players.pa';
  const coefs = await influenceCoefs(c.env.DB);
  const inflExpr = influenceExpr(coefs);
  const sortExprs = buildSortExprs({ caExpr, paExpr, inflExpr });

  // filters 进 COUNT；cursor 只进列表查询（总数不随翻页游标变）
  const filters: string[] = [];
  const filterArgs: unknown[] = [];
  const cursorConds: string[] = [];
  const cursorArgs: unknown[] = [];

  const clubId = c.req.query('club_id');
  if (clubId !== undefined) {
    if (clubId === 'free') {
      // 自由身：无归属（球员库「俱乐部」下拉的「自由身」项）
      filters.push('players.club_id IS NULL');
    } else {
      const n = Number(clubId);
      if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'club_id 不对');
      filters.push('players.club_id = ?');
      filterArgs.push(n);
    }
  }
  const status = c.req.query('status');
  if (status !== undefined) {
    if (!(PLAYER_STATUS as readonly string[]).includes(status)) {
      throw new HttpError(400, 'status 只能是 normal / listed / trainee / free / retired');
    }
    filters.push('players.status = ?');
    filterArgs.push(status);
  }
  const position = c.req.query('position');
  if (position !== undefined) {
    const list = position
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '');
    if (list.length === 0) throw new HttpError(400, 'position 不能为空');
    for (const p of list) {
      if (!POSITION_NAMES.includes(p)) throw new HttpError(400, `位置「${p}」不在 PositionID 表内`);
    }
    // 球员可踢位置 = 主位置列（文本名）+ PosID2-4 槽（数字 PositionID），任一命中即入册
    const nameMarks = list.map(() => '?').join(',');
    const idMarks = list.map(() => '?').join(',');
    const idByPosition = new Map(Object.entries(POSITION_BY_ID).map(([id, name]) => [name as string, Number(id)]));
    const ids = list.map((p) => idByPosition.get(p)!);
    filters.push(
      `(players.position IN (${nameMarks}) OR json_extract(players.game_attrs, '$.PosID2') IN (${idMarks})
        OR json_extract(players.game_attrs, '$.PosID3') IN (${idMarks})
        OR json_extract(players.game_attrs, '$.PosID4') IN (${idMarks}))`,
    );
    filterArgs.push(...list, ...ids, ...ids, ...ids);
  }
  const name = c.req.query('name');
  if (name !== undefined) {
    // 先折再判空：ZWSP、软连字符这类不可见字符 trim() 不走，折完才是空串；
    // 按原串判空会拼出 `%%`（匹配全库），搜索框语义被悄悄降级。
    const folded = foldNameQuery(name);
    if (folded === '') throw new HttpError(400, 'name 不能为空');
    // 去变音搜索（增量 26）：库内是 FC 拉丁名（Šeško/Ødegaard/Çalhanoğlu…），查询词与列值
    // 都经 name-fold 折叠后比对，否则 sa 搜不到 Š 这类字母。折叠规则两侧同源（见 core/name-fold.ts）：
    // 参数侧走 JS foldName，列侧走同表生成的 REPLACE 链内联表达式，两侧都只做「查表 + ASCII 小写」。
    filters.push(`${sqlFold('players.name')} LIKE ? ESCAPE '\\'`);
    filterArgs.push(likeContains(folded));
  }
  const growable = c.req.query('growable');
  if (growable !== undefined) {
    if (growable !== '1' && growable !== '0') throw new HttpError(400, 'growable 只能是 1 或 0');
    filters.push('players.growable = ?');
    filterArgs.push(Number(growable));
  }
  const foot = c.req.query('foot');
  if (foot !== undefined) {
    if (foot !== '0' && foot !== '1') throw new HttpError(400, 'foot 只能是 0（左脚）或 1（右脚）');
    filters.push('players.foot = ?');
    filterArgs.push(Number(foot));
  }
  const growthTier = c.req.query('growth_tier');
  if (growthTier !== undefined) {
    const n = Number(growthTier);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, 'growth_tier 只能是 1-5');
    filters.push('players.growth_tier = ?');
    filterArgs.push(n);
  }
  for (const [param, col] of [
    ['is_future_star', 'players.is_future_star'],
    ['china_plan', 'players.china_plan'],
  ] as const) {
    const raw = c.req.query(param);
    if (raw === undefined) continue;
    if (raw !== '0' && raw !== '1') throw new HttpError(400, `${param} 只能是 0 或 1`);
    filters.push(`${col} = ?`);
    filterArgs.push(Number(raw));
  }
  const agentTier = c.req.query('agent_tier');
  if (agentTier !== undefined) {
    const n = Number(agentTier);
    if (!Number.isInteger(n) || n < 1 || n > 3) throw new HttpError(400, 'agent_tier 只能是 1-3');
    filters.push('players.agent_tier = ?');
    filterArgs.push(n);
  }
  const badgesSilverMin = c.req.query('badges_silver_min');
  if (badgesSilverMin !== undefined) {
    const n = Number(badgesSilverMin);
    if (!Number.isInteger(n) || n < 0 || n > 15) throw new HttpError(400, 'badges_silver_min 应为 0-15');
    filters.push('players.badges_silver >= ?');
    filterArgs.push(n);
  }
  const badgesGoldMin = c.req.query('badges_gold_min');
  if (badgesGoldMin !== undefined) {
    const n = Number(badgesGoldMin);
    if (!Number.isInteger(n) || n < 0 || n > 3) throw new HttpError(400, 'badges_gold_min 应为 0-3');
    filters.push('players.badges_gold >= ?');
    filterArgs.push(n);
  }
  if (c.req.query('badges_none') === '1') {
    filters.push('(players.badges_silver = 0 AND players.badges_gold = 0)');
  } else if (c.req.query('badges_none') !== undefined) {
    throw new HttpError(400, 'badges_none 只能是 1');
  }
  const fcId = c.req.query('fc_id');
  if (fcId !== undefined) {
    const n = Number(fcId);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'fc_id 不对');
    filters.push('players.fc_id = ?');
    filterArgs.push(n);
  }
  for (const [param, spec] of Object.entries(RANGE_PARAMS)) {
    const raw = c.req.query(param);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${param} 应为非负数`);
    filters.push(`${spec.col} ${spec.op} ?`);
    filterArgs.push(n);
  }
  // 成长空间（PA−CA，随视图口径）
  for (const [suffix, op] of [
    ['min', '>='],
    ['max', '<='],
  ] as const) {
    const raw = c.req.query(`growth_gap_${suffix}`);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new HttpError(400, `growth_gap_${suffix} 应为数字`);
    filters.push(`((${paExpr}) - (${caExpr})) ${op} ?`);
    filterArgs.push(n);
  }
  // 影响力区间（现值口径）
  for (const [suffix, op] of [
    ['min', '>='],
    ['max', '<='],
  ] as const) {
    const raw = c.req.query(`influence_${suffix}`);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `influence_${suffix} 应为非负数`);
    filters.push(`${inflExpr} ${op} ?`);
    filterArgs.push(n);
  }
  // 细分属性区间：attr + attr_min/attr_max（键在白名单内才放行）；命中行的属性值随响应带回（前端自动加列用）。
  // attr 单独给（不带任何区间）也算合法：只把该属性的值带回响应、不做数值过滤。
  // 以前这里直接 400，而前端「选一个细分属性」这个动作本身就只发 attr —— 等于选一下就报一次错。
  let attrValueExpr: string | null = null;
  const attr = c.req.query('attr');
  if (attr !== undefined && attr !== '') {
    if (!(ATTR_KEYS as readonly string[]).includes(attr)) throw new HttpError(400, 'attr 不是可筛选的属性键');
    const attrExpr = `json_extract(players.game_attrs, '$.${attr}')`;
    attrValueExpr = attrExpr;
    for (const [param, op] of [
      ['attr_min', '>='],
      ['attr_max', '<='],
    ] as const) {
      const raw = c.req.query(param);
      if (raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new HttpError(400, `${param} 应为数字`);
      filters.push(`${attrExpr} ${op} ?`);
      filterArgs.push(n);
    }
  }
  // PlayStyle 多选：PSID1-15 任一槽命中即入册；金徽存基础 ID+100（§5.2），两种形态都算。
  // 命中时 15 个槽位原值随行带回（psIds），前端列联动渲染 PlayStyle 名用
  const psRaw = c.req.query('ps');
  let psSlotSelects = '';
  if (psRaw !== undefined) {
    const list = psRaw
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((p) => p !== 0);
    if (list.length === 0) throw new HttpError(400, 'ps 不能为空');
    if (list.some((n) => !Number.isInteger(n) || n < 1 || n > 99)) throw new HttpError(400, 'ps 应为基础 PlayStyle ID（1-99）');
    const marks = list.flatMap((n) => [n, n + 100]).map(() => '?').join(',');
    const psSlots = Array.from({ length: 15 }, (_, i) => `json_extract(players.game_attrs, '$.PSID${i + 1}')`);
    filters.push(`(${psSlots.map((s) => `${s} IN (${marks})`).join(' OR ')})`);
    for (let i = 0; i < psSlots.length; i++) filterArgs.push(...list.flatMap((n) => [n, n + 100]));
    psSlotSelects = psSlots.map((s, i) => `, ${s} AS ps${i + 1}`).join('');
  }
  // 合同维度（现行合同：player_id UNIQUE 不产生重复行）
  const hasContract = c.req.query('has_contract');
  if (hasContract !== undefined) {
    if (hasContract !== '0' && hasContract !== '1') throw new HttpError(400, 'has_contract 只能是 0 或 1');
    filters.push(hasContract === '1' ? 'ct.player_id IS NOT NULL' : 'ct.player_id IS NULL');
  }
  for (const [param, spec] of Object.entries(CONTRACT_RANGE_PARAMS)) {
    const raw = c.req.query(param);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${param} 应为非负数`);
    filters.push(`${spec.col} ${spec.op} ?`);
    filterArgs.push(n);
  }
  if (c.req.query('release_fee_none') === '1') {
    // 限定有现行合同：LEFT JOIN 空行的 release_fee 也 IS NULL，会把无合同球员错捞进来
    filters.push('ct.player_id IS NOT NULL AND ct.release_fee IS NULL');
  } else if (c.req.query('release_fee_none') !== undefined) {
    throw new HttpError(400, 'release_fee_none 只能是 1');
  }
  const contractType = c.req.query('contract_type');
  if (contractType !== undefined) {
    if (!(CONTRACT_TYPES as readonly string[]).includes(contractType)) throw new HttpError(400, 'contract_type 只能是 formal / trainee');
    filters.push('ct.contract_type = ?');
    filterArgs.push(contractType);
  }
  const source = c.req.query('source');
  if (source !== undefined) {
    if (!(CONTRACT_SOURCES as readonly string[]).includes(source)) throw new HttpError(400, 'source 不对');
    filters.push('ct.source = ?');
    filterArgs.push(source);
  }
  const protectedQ = c.req.query('protected');
  if (protectedQ !== undefined) {
    // 保护期按窗刻度（增量 25）：当前已关常规窗数 < protection_ticks 即在保护期内
    if (protectedQ === 'in') {
      filters.push(`(${CURRENT_TICKS_SQL}) < ct.protection_ticks`);
    } else if (protectedQ === 'out') {
      filters.push(`(ct.protection_ticks IS NULL OR (${CURRENT_TICKS_SQL}) >= ct.protection_ticks)`);
    } else {
      throw new HttpError(400, 'protected 只能是 in / out');
    }
  }
  for (const [suffix, op] of [
    ['min', '>='],
    ['max', '<='],
  ] as const) {
    const raw = c.req.query(`effective_years_${suffix}`);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `effective_years_${suffix} 应为非负数`);
    // 效力（赛季）= 0.5 × (已关常规窗数 − 签约基数)；参数名沿用 effective_years_*（1 赛季 = 1 年）
    // 无现行合同的球员没有效力可比（不能拿基数 0 当满效力）
    filters.push(`(ct.player_id IS NOT NULL AND (((${CURRENT_TICKS_SQL}) - COALESCE(ct.service_ticks, 0)) * 0.5) ${op} ?)`);
    filterArgs.push(n);
  }

  // 排序键：SORT_KEY_NAMES 里的 29 个固定键，外加 `attr:<属性键>`（表头每个属性列都可点，键同样过白名单）
  const sortRaw = c.req.query('sort') ?? 'id';
  const attrSort = sortRaw.startsWith('attr:') ? sortRaw.slice(5) : null;
  if (attrSort !== null) {
    if (!(ATTR_KEYS as readonly string[]).includes(attrSort)) throw new HttpError(400, 'sort 的 attr 键不是可排的属性键');
  } else if (!(SORT_KEY_NAMES as readonly string[]).includes(sortRaw)) {
    throw new HttpError(400, `sort 只能是 ${SORT_KEY_NAMES.join(' / ')} 或 attr:<属性键>`);
  }
  const sort = sortRaw as SortKey;
  // id 键固定 ASC（旧调用兼容），其 URL 参数由前端清掉，所以它同时也是「无排序参数」的默认态
  const order = sortRaw === 'id' || c.req.query('order') === 'asc' ? 'asc' : 'desc';
  // ORDER BY、sort_key、游标比较三处共用这一个表达式
  const sortExpr = attrSort !== null ? attrSortExpr(attrSort) : sortRaw === 'id' ? 'players.id' : sortExprs[sort];

  let orderBy: string;
  if (sortRaw === 'id') {
    const cursor = c.req.query('cursor');
    if (cursor !== undefined) {
      const n = Number(cursor);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'cursor 不对');
      cursorConds.push('players.id > ?');
      cursorArgs.push(n);
    }
    orderBy = 'ORDER BY players.id ASC';
  } else {
    const keyExpr = sortExpr;
    const text = attrSort === null && TEXT_SORT_KEYS.has(sort);
    const cursor = c.req.query('cursor');
    if (cursor !== undefined) {
      const { v, id } = text ? decodeTextCursor(cursor) : decodeNumericCursor(cursor);
      if (order === 'desc') {
        cursorConds.push(`(${keyExpr} < ? OR (${keyExpr} = ? AND players.id < ?))`);
      } else {
        cursorConds.push(`(${keyExpr} > ? OR (${keyExpr} = ? AND players.id > ?))`);
      }
      cursorArgs.push(v, v, id);
    }
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    orderBy = `ORDER BY ${keyExpr} ${dir}, players.id ${dir}`;
  }
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);

  const where = filters.length + cursorConds.length > 0 ? `WHERE ${[...filters, ...cursorConds].join(' AND ')}` : '';
  const needSortKey = sortRaw !== 'id';
  const rows = await c.env.DB.prepare(
    `SELECT players.id, players.uid, players.name, players.club_id, players.position, players.age, players.foot,
            ${caExpr} AS ca, ${paExpr} AS pa, players.ca AS cur_ca, players.pa AS cur_pa,
            players.base_ca, players.fc_id,
            players.prestige, players.market_value, players.status,
            players.growth_tier, players.growable, players.is_future_star, players.china_plan, players.agent_tier,
            players.badges_silver, players.badges_gold,
            json_extract(players.game_attrs, '$.PosID1') AS pos1,
            json_extract(players.game_attrs, '$.PosID2') AS pos2,
            json_extract(players.game_attrs, '$.PosID3') AS pos3,
            json_extract(players.game_attrs, '$.PosID4') AS pos4,
            ct.wage AS ct_wage, ct.release_fee AS ct_release_fee, ct.contract_type AS ct_contract_type,
            ct.source AS ct_source, ct.player_id AS ct_player_id,
            ct.service_ticks AS ct_service_ticks, ct.protection_ticks AS ct_protection_ticks,
            ${CURRENT_TICKS_SQL} AS current_ticks,
            cc.name AS club_name${attrValueExpr ? `, ${attrValueExpr} AS attr_value` : ''}${psSlotSelects}${needSortKey ? `, ${sortExpr} AS sort_key` : ''}
     FROM players
     LEFT JOIN clubs cc ON cc.id = players.club_id
     LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1
     ${where} ${orderBy} LIMIT ?`,
  )
    .bind(...filterArgs, ...cursorArgs, limit + 1)
    .all<{
      id: number;
      uid: string;
      name: string;
      club_id: number | null;
      position: string | null;
      age: number | null;
      foot: number;
      ca: number;
      pa: number;
      cur_ca: number | null;
      cur_pa: number | null;
      base_ca: number | null;
      fc_id: number | null;
      prestige: number | null;
      market_value: number | null;
      status: string;
      growth_tier: number;
      growable: number;
      is_future_star: number;
      china_plan: number;
      agent_tier: number;
      badges_silver: number;
      badges_gold: number;
      pos1: number | null;
      pos2: number | null;
      pos3: number | null;
      pos4: number | null;
      ct_wage: number | null;
      ct_release_fee: number | null;
      ct_contract_type: string | null;
      ct_source: string | null;
      ct_player_id: number | null;
      ct_service_ticks: number | null;
      ct_protection_ticks: number | null;
      current_ticks: number;
      club_name: string | null;
      attr_value?: number | null;
      ps1?: number | null;
      ps2?: number | null;
      ps3?: number | null;
      ps4?: number | null;
      ps5?: number | null;
      ps6?: number | null;
      ps7?: number | null;
      ps8?: number | null;
      ps9?: number | null;
      ps10?: number | null;
      ps11?: number | null;
      ps12?: number | null;
      ps13?: number | null;
      ps14?: number | null;
      ps15?: number | null;
      sort_key?: number | string | null;
    }>();

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM players
     LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1
     ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}`,
  )
    .bind(...filterArgs)
    .first<{ n: number }>();

  const slotNames = (v: unknown): string | null => {
    // 槽位缺失（NULL）不能走 Number() 归零：PositionID 0 是 GK，会把空槽错译成门将
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? (POSITION_BY_ID[n] ?? null) : null;
  };
  const players = rows.results.slice(0, limit).map((r) => ({
    id: r.id,
    uid: r.uid,
    name: r.name,
    clubId: r.club_id,
    clubName: r.club_name,
    position: r.position,
    positions: [r.position ?? slotNames(r.pos1), slotNames(r.pos2), slotNames(r.pos3), slotNames(r.pos4)]
      .filter((p): p is string => p !== null)
      .filter((p, i, arr) => arr.indexOf(p) === i),
    age: r.age,
    ca: r.ca,
    pa: r.pa,
    foot: r.foot,
    baseCa: r.base_ca,
    fcId: r.fc_id,
    growable: r.growable === 1,
    prestige: r.prestige,
    influence: influenceOf(coefs, r.cur_ca, r.cur_pa, r.growable === 1, r.prestige),
    marketValue: r.market_value,
    status: r.status,
    growthTier: r.growth_tier,
    isFutureStar: r.is_future_star === 1,
    chinaPlan: r.china_plan === 1,
    agentTier: r.agent_tier,
    badgesSilver: r.badges_silver,
    badgesGold: r.badges_gold,
    wage: r.ct_wage,
    releaseFee: r.ct_release_fee,
    contractType: r.ct_contract_type,
    source: r.ct_source,
    // 窗刻度（增量 25）：serviceSeasons = 效力时长（赛季，1 常规窗 = 0.5）；protected = 是否在保护期内
    serviceSeasons: r.ct_player_id === null ? null : serviceSeasons(r.ct_service_ticks ?? 0, r.current_ticks),
    protected: r.ct_protection_ticks !== null && r.current_ticks < r.ct_protection_ticks,
    attrValue: attrValueExpr ? (r.attr_value ?? null) : undefined,
    // 槽位对齐：保留 15 长度、缺槽为 null——前端金徽判定要按真实槽位（13+ 为金槽）
    psIds: psSlotSelects
      ? Array.from({ length: 15 }, (_, i) => {
          const v = (r as Record<string, unknown>)[`ps${i + 1}`];
          return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
        })
      : undefined,
  }));

  let nextCursor: string | null = null;
  if (rows.results.length > limit) {
    const last = rows.results[limit - 1]!;
    // 文本键原样带上排序值（前端拉下一页时按 URL 编码回传）；数值键沿用 Number 归一
    nextCursor =
      sortRaw === 'id'
        ? String(last.id)
        : attrSort === null && TEXT_SORT_KEYS.has(sort)
          ? `${String(last.sort_key ?? '')}~${last.id}`
          : `${Number(last.sort_key ?? 0)}~${last.id}`;
  }
  return { players, total: countRow?.n ?? 0, nextCursor };
}

// 名册这条走全表扫描，缓存下限给足 5 分钟（公开 TTL 只有 20s，撑不住 18301 行的重复读）。
// 注意这里是「取大」而不是「跟随公开 TTL」：未配 PUBLIC_CACHE_TTL_MS（或配 0）的环境下
// 公开 TTL 是 0，跟着走会把缓存整个旁路掉，公开端点退化成一请求一全表扫。
const ROSTER_CACHE_TTL_MS = 300_000;

// GET /api/players/roster —— 轻量名册（增量 26，球员库搜索框的本地推荐用）
// 载荷 = 单行文本，每行「姓名|俱乐部ID|球员ID」（俱乐部为空则省略该段），换行分隔：
// 姓名写在最前、两个数字在后，前端从行尾反向切分 ⇒ 姓名里出现「|」也不会串字段。
// 姓名里的换行/回车在 SQL 里换成空格，否则一个球员会被拆成两行、行数与 count 对不上。
// 顺序按 players.id（前端本地过滤自己排，但载荷必须确定，否则测试与 diff 都不稳）。
// 目的是让前端一次性拿到全量名册、之后在本地折叠过滤（打字零请求，也就绕开限流与缓存位）。
// 走全表扫描（18301 行 / 313KB raw / 150KB gzip，2026-09-21 实测），D1 免费档 5M 行/天 ⇒
// 每次加载约 0.4%，故进程内缓存给 5 分钟下限（前端另有会话级缓存）。
// 体积涨到 MB 量级（D1 单查询结果上限）时改分段加载或物化精简表——目前离得很远。
// 路由必须注册在 /players/:id 之前（否则「roster」会被当成球员 ID 落进详情分支）。
app.get('/players/roster', async (c) => {
  assertPublicRate(c, 'players');
  const ttlMs = Math.max(Number(c.env.PUBLIC_CACHE_TTL_MS) || 0, ROSTER_CACHE_TTL_MS);
  const data = await cachedJson('players:roster', ttlMs, () => loadRoster(c), waitUntilOf(c));
  return c.json(data);
});

async function loadRoster(c: Context<{ Bindings: Env }>): Promise<{ roster: string; count: number }> {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n, group_concat(line, char(10)) AS roster FROM (
       SELECT replace(replace(players.name, char(13), ' '), char(10), ' ')
              || CASE WHEN players.club_id IS NULL THEN '' ELSE '|' || players.club_id END
              || '|' || players.id AS line
       FROM players ORDER BY players.id)`,
  ).first<{ n: number; roster: string | null }>();
  return { roster: row?.roster ?? '', count: row?.n ?? 0 };
}

// GET /api/players/:id —— 档案卡数据（球员 + 俱乐部 + 现行合同 + FC 存档）
app.get('/players/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '球员 ID 不对');

  const p = await c.env.DB.prepare(
    `SELECT id, uid, name, club_id, position, foot, age, ca, pa, growable, prestige, market_value,
            status, growth_tier, growth_xp, is_future_star, china_plan, agent_tier,
            badges_silver, badges_gold, game_attrs, created_at, updated_at
     FROM players WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      uid: string;
      name: string;
      club_id: number | null;
      position: string | null;
      foot: number;
      age: number | null;
      ca: number;
      pa: number;
      growable: number;
      prestige: number | null;
      market_value: number | null;
      status: string;
      growth_tier: number;
      growth_xp: number;
      is_future_star: number;
      china_plan: number;
      agent_tier: number;
      badges_silver: number;
      badges_gold: number;
      game_attrs: string | null;
      created_at: string;
      updated_at: string;
    }>();
  if (!p) throw new HttpError(404, '球员不存在');

  const [club, contract, ticksRow] = await Promise.all([
    p.club_id
      ? c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(p.club_id).first<{ id: number; name: string }>()
      : Promise.resolve(null),
    c.env.DB.prepare(
      `SELECT id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from,
              service_ticks, protection_ticks, signed_season, signed_window_seq
       FROM contracts WHERE player_id = ? AND is_active = 1`,
    )
      .bind(id)
      .first<{
        id: number;
        club_id: number | null;
        release_fee: number | null;
        wage: number | null;
        contract_type: string;
        source: string | null;
        signed_at: string | null;
        effective_from: string | null;
        service_ticks: number | null;
        protection_ticks: number | null;
        signed_season: number | null;
        signed_window_seq: number | null;
      }>(),
    c.env.DB.prepare(`SELECT ${CURRENT_TICKS_SQL} AS n`).first<{ n: number }>(),
  ]);
  // 窗刻度（增量 25）：效力时长（赛季）= 0.5 ×(已关常规窗数 − 签约基数)；保护期 = 窗数未到 protection_ticks
  const currentTicks = ticksRow?.n ?? 0;

  let gameAttrs: Record<string, unknown> | null = null;
  if (p.game_attrs) {
    try {
      gameAttrs = JSON.parse(p.game_attrs) as Record<string, unknown>;
    } catch {
      gameAttrs = null;
    }
  }

  return c.json({
    player: {
      id: p.id,
      uid: p.uid,
      name: p.name,
      clubId: p.club_id,
      position: p.position,
      foot: p.foot,
      age: p.age,
      ca: p.ca,
      pa: p.pa,
      growable: p.growable === 1,
      prestige: p.prestige,
      marketValue: p.market_value,
      status: p.status,
      growthTier: p.growth_tier,
      growthXp: p.growth_xp,
      isFutureStar: p.is_future_star === 1,
      chinaPlan: p.china_plan === 1,
      agentTier: p.agent_tier,
      badgesSilver: p.badges_silver,
      badgesGold: p.badges_gold,
      gameAttrs,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    },
    club,
    contract: contract
      ? {
          id: contract.id,
          clubId: contract.club_id,
          releaseFee: contract.release_fee,
          wage: contract.wage,
          contractType: contract.contract_type,
          source: contract.source,
          signedAt: contract.signed_at,
          effectiveFrom: contract.effective_from,
          serviceSeasons: serviceSeasons(contract.service_ticks ?? 0, currentTicks),
          protected: contract.protection_ticks !== null && currentTicks < contract.protection_ticks,
          signedSeason: contract.signed_season,
          signedWindowSeq: contract.signed_window_seq,
        }
      : null,
  });
});

export default app;
