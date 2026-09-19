// 球员查询（附录 A〔1〕，🌐 公开：跳过会话检查，§17.3-5）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { createConfigService } from '../../core/config.ts';
import { FC26_GAME_ATTR_COLUMNS, POSITION_BY_ID } from '../../core/fc26.ts';
import { playerAbilityLevel } from '../home.ts';

const app = new Hono<{ Bindings: Env }>();

const PLAYER_STATUS = ['normal', 'listed', 'trainee', 'free', 'retired'] as const;
const CONTRACT_TYPES = ['formal', 'trainee'] as const;
const CONTRACT_SOURCES = ['negotiation', 'forced', 'direct', 'import'] as const;
// 细分属性白名单（FC26 源列尾段：sprintspeed 起，34 外场 + 6 门将）；
// attr 筛选的 json_extract 键必须在此表内，拼 SQL 前拦住任意键注入
const ATTR_KEYS: readonly string[] = FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed'));
const POSITION_NAMES: readonly string[] = Object.values(POSITION_BY_ID);

// 球员库排序键（增量 6.1 d6）：id 沿旧整数游标 ASC（既有调用兼容）；数值键走 COALESCE 双向 keyset，NULL 当 0 排尾
// influence（增量 17）：规则 4.1.3 球员影响力=系数×能力等级×国际声望，现值口径，ROUND 2 位
// view=initial（增量 6.1 d7）：初始球员库=导入时数据——CA=base_ca、PA=导入 json 值（归属无「初始」维度，
// 增量 14 裁决 4 删掉 initial_club_id：它从不参与成长判定，只是同一件事的第二种说法）
const SORT_KEYS = { id: 'id', ca: 'ca', pa: 'pa', age: 'age', market_value: 'market_value', influence: 'influence' } as const;
type SortKey = keyof typeof SORT_KEYS;

// 编 cursor 用的行内字段：数值排序时 SELECT 额外带出 `sort_key`（与 ORDER BY 同一表达式，保证游标值与排序值逐位一致）

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
// 排序：sort=id|ca|pa|age|market_value|influence + order（id 固定 ASC 旧整数游标）
app.get('/players', async (c) => {
  const viewRaw = c.req.query('view');
  if (viewRaw !== undefined && viewRaw !== 'initial') throw new HttpError(400, 'view 只能是 initial');
  const initial = viewRaw === 'initial';
  const caExpr = initial ? 'COALESCE(players.base_ca, players.ca)' : 'players.ca';
  const paExpr = initial ? "COALESCE(json_extract(players.game_attrs, '$.PA'), players.pa)" : 'players.pa';
  const coefs = await influenceCoefs(c.env.DB);
  const inflExpr = influenceExpr(coefs);
  // keyset 比较表达式（WHERE/ORDER BY 同源，保证全序一致）；influence 恒为现值口径，不随 view 切
  const SORT_EXPRS: Record<SortKey, string> = initial
    ? {
        id: 'players.id',
        ca: 'COALESCE(players.base_ca, 0)',
        pa: "COALESCE(json_extract(players.game_attrs, '$.PA'), 0)",
        age: 'COALESCE(players.age, 0)',
        market_value: 'COALESCE(players.market_value, 0)',
        influence: inflExpr,
      }
    : {
        id: 'players.id',
        ca: 'COALESCE(players.ca, 0)',
        pa: 'COALESCE(players.pa, 0)',
        age: 'COALESCE(players.age, 0)',
        market_value: 'COALESCE(players.market_value, 0)',
        influence: inflExpr,
      };

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
    const q = name.trim();
    if (q === '') throw new HttpError(400, 'name 不能为空');
    filters.push(`players.name LIKE ? ESCAPE '\\'`);
    filterArgs.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
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
  // 细分属性区间：attr + attr_min/attr_max（键在白名单内才放行）；命中行的属性值随响应带回（前端自动加列用）
  let attrValueExpr: string | null = null;
  const attr = c.req.query('attr');
  if (attr !== undefined) {
    if (!(ATTR_KEYS as readonly string[]).includes(attr)) throw new HttpError(400, 'attr 不是可筛选的属性键');
    const attrExpr = `json_extract(players.game_attrs, '$.${attr}')`;
    attrValueExpr = attrExpr;
    const minRaw = c.req.query('attr_min');
    const maxRaw = c.req.query('attr_max');
    if (minRaw === undefined && maxRaw === undefined) throw new HttpError(400, 'attr 需要搭配 attr_min / attr_max');
    for (const [param, op] of [
      ['attr_min', '>='],
      ['attr_max', '<='],
    ] as const) {
      const raw = c.req.query(param);
      if (raw === undefined) continue;
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
    const now = new Date().toISOString();
    if (protectedQ === 'in') {
      filters.push('ct.protected_until IS NOT NULL AND ct.protected_until > ?');
      filterArgs.push(now);
    } else if (protectedQ === 'out') {
      filters.push('(ct.protected_until IS NULL OR ct.protected_until <= ?)');
      filterArgs.push(now);
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
    filters.push(`(julianday(?) - julianday(COALESCE(ct.effective_from, ct.signed_at))) / 365.25 ${op} ?`);
    filterArgs.push(new Date().toISOString(), n);
  }

  const sortRaw = c.req.query('sort') ?? 'id';
  if (!(sortRaw in SORT_KEYS)) throw new HttpError(400, 'sort 只能是 id / ca / pa / age / market_value / influence');
  const sort = sortRaw as SortKey;
  const order = sort === 'id' || c.req.query('order') === 'asc' ? 'asc' : 'desc';

  let orderBy: string;
  if (sort === 'id') {
    const cursor = c.req.query('cursor');
    if (cursor !== undefined) {
      const n = Number(cursor);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'cursor 不对');
      cursorConds.push('players.id > ?');
      cursorArgs.push(n);
    }
    orderBy = 'ORDER BY players.id ASC';
  } else {
    const keyExpr = SORT_EXPRS[sort];
    const cursor = c.req.query('cursor');
    if (cursor !== undefined) {
      const { v, id } = decodeNumericCursor(cursor);
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
  const needSortKey = sort !== 'id';
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
            ct.source AS ct_source, ct.protected_until AS ct_protected_until, ct.effective_from AS ct_effective_from,
            cc.name AS club_name${attrValueExpr ? `, ${attrValueExpr} AS attr_value` : ''}${psSlotSelects}${needSortKey ? `, ${SORT_EXPRS[sort]} AS sort_key` : ''}
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
      ct_protected_until: string | null;
      ct_effective_from: string | null;
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
      sort_key?: number;
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
    protectedUntil: r.ct_protected_until,
    effectiveFrom: r.ct_effective_from,
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
    nextCursor = sort === 'id' ? String(last.id) : `${Number(last.sort_key ?? 0)}~${last.id}`;
  }
  return c.json({ players, total: countRow?.n ?? 0, nextCursor });
});

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

  const [club, contract] = await Promise.all([
    p.club_id
      ? c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(p.club_id).first<{ id: number; name: string }>()
      : Promise.resolve(null),
    c.env.DB.prepare(
      `SELECT id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, protected_until
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
        protected_until: string | null;
      }>(),
  ]);

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
          protectedUntil: contract.protected_until,
        }
      : null,
  });
});

export default app;
