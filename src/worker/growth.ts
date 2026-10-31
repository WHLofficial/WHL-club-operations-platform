// 成长引擎（TECH_DESIGN §10）：XP 事件（赛果确认钩子自动 + 管理组补录）、赛季结算
// （里程碑/训练营/中国计划）、升级方案二选一、档位核定。去重锚 = UNIQUE(player_id, match_ref, event_type)，
// 所有入账先 ON CONFLICT DO NOTHING，实际插入的行再累计 growth_xp（meta.changes 判定）。
import { HttpError } from '../lib/http.ts';
import { createAuditStatement, type AuditEntry } from '../lib/audit.ts';
import { createConfigService } from '../core/config.ts';
import {
  basePlaystyleId,
  playstyleIdOf,
  playstyleSlotsOf,
  type PlaystyleKind,
  type PlaystyleSlot,
} from '../core/fc26.ts';
import {
  fullCountSql,
  planPlaystylePicks,
  type GrantedPlaystyleRow,
  type PlaystylePickContext,
  type PlaystyleSource,
  type SupersedeTarget,
} from '../core/playstyle-rules.ts';
import { queueClubNotification } from './notify.ts';
import { rowDisplayName } from '../core/player-name.ts';
import type { Env } from './env.ts';

// §10.1 事件类型（growth_events.event_type）
export const GROWTH_EVENT_TYPES = [
  'appearance', // 出场
  'rating', // 评分（补录）
  'goal', // 进球
  'assist', // 助攻
  'clean_sheet', // 零封
  'duels_won', // 夺回球权（补录）
  'saves', // 扑救（补录）
  'milestone', // 进+攻里程碑
  'trainee_season', // 训练营赛季结算
  'china_plan', // 中国球员计划
  'reset', // 解约清零标记（不是 XP 事件：里程碑只累计它之后的事件）
] as const;

export type GrowthEventType = (typeof GROWTH_EVENT_TYPES)[number] | 'levelup';

// §10.1：出场 1；评分 7.0-7.9→1/8.0-8.9→2/9.0-9.9→3/10.0→4；进球/助攻各 0.5；零封 0.5；
// 夺回球权每 12 次 1；扑救每 8 次 1 且单场 >8 额外 1。
// 后两项是跨场累计（v6.42.0 用户裁决）：base = 该球员该类型的历史累计次数，单场只入账
// 跨档差值 floor((base+value)/K) − floor(base/K)；扑救的「单场 >8 额外 1」独立叠加、与跨档无关。
// 其余类型不累计，base 无效；base 缺省 0 时公式退回按单场值整算（自动通道与旧测试兼容）。
export function xpForEvent(eventType: GrowthEventType, value: number, base = 0): number {
  switch (eventType) {
    case 'appearance':
      return 1;
    case 'rating':
      if (value >= 10) return 4;
      if (value >= 9) return 3;
      if (value >= 8) return 2;
      if (value >= 7) return 1;
      return 0;
    case 'goal':
    case 'assist':
    case 'clean_sheet':
      return 0.5;
    case 'duels_won':
      return Math.floor((base + value) / 12) - Math.floor(base / 12);
    case 'saves':
      return Math.floor((base + value) / 8) - Math.floor(base / 8) + (value > 8 ? 1 : 0);
    default:
      return 0;
  }
}

// 里程碑：进+攻累计 5→+1；10→+2；15→+3；20→+4；之后每 +5→+4（§10.1）
export function milestoneThresholds(total: number): number[] {
  const thresholds: number[] = [];
  const base: [number, number][] = [
    [5, 1],
    [10, 2],
    [15, 3],
    [20, 4],
  ];
  for (const [t] of base) if (total >= t) thresholds.push(t);
  for (let t = 25; total >= t; t += 5) thresholds.push(t);
  return thresholds;
}

export function milestoneXp(threshold: number): number {
  if (threshold <= 5) return 1;
  if (threshold <= 10) return 2;
  if (threshold <= 15) return 3;
  return 4;
}

// §10.2 升级方案表（档1-5；config upgrade_plans 可覆盖）
export interface UpgradePlan {
  ca: number;
  silver: number;
  gold: number;
}

export const DEFAULT_UPGRADE_PLANS: Record<number, UpgradePlan[]> = {
  1: [{ ca: 1, silver: 0, gold: 0 }],
  2: [{ ca: 2, silver: 0, gold: 0 }],
  3: [
    { ca: 3, silver: 0, gold: 0 },
    { ca: 2, silver: 1, gold: 0 },
  ],
  4: [
    { ca: 4, silver: 0, gold: 0 },
    { ca: 2, silver: 2, gold: 0 },
    { ca: 3, silver: 1, gold: 0 },
  ],
  5: [
    { ca: 5, silver: 0, gold: 0 },
    { ca: 3, silver: 0, gold: 1 },
    { ca: 3, silver: 2, gold: 0 },
  ],
};

export async function getUpgradePlans(db: D1Database): Promise<Record<number, UpgradePlan[]>> {
  const config = createConfigService(db);
  const raw = await config.getJson<Record<number, UpgradePlan[]>>('upgrade_plans');
  return raw ?? DEFAULT_UPGRADE_PLANS;
}

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export interface GrowthEventInput {
  playerId: number;
  matchRef: string | null;
  season: number | null;
  windowSeq: number | null;
  eventType: GrowthEventType;
  value: number;
  xp: number;
  source: 'auto' | 'manual';
  recordedBy?: number | null;
}

/**
 * 记一条成长事件并把 XP 加到球员（幂等）。
 * 两条语句同批、顺序敏感：必须先 UPDATE 后 INSERT——XP 累计的 NOT EXISTS 查重闸
 * 要赶在本事件入表之前判断（若先插后查，同批刚插的行会让闸永远不放行）。
 * 重放时 UPDATE 0 行、INSERT 撞 UNIQUE 跳过，growth_xp 不会重复加；
 * meta.changes：偶数位=XP 是否已加，奇数位=事件是否新入账（批量计数用奇数位）。
 *
 * v6.52.0 非成长球员（COALESCE(growable,0) = 1 才算可成长）：事件行与 value 照写
 * （球员比赛 tab / 成长史 / 基数汇总都要用），只把 XP 归零 —— XP 语句不累加、
 * 事件行的 xp 栏存 0，两者口径一致（不会出现「行 +20 但总数没动」）。
 * 因此偶数位 0 现在也可能是「非成长」而不只是「重放」。
 */
export function recordGrowthEventStatements(db: D1Database, e: GrowthEventInput): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE players SET growth_xp = growth_xp + ?, updated_at = ${nowSql()}
         WHERE id = ?
           AND COALESCE(growable, 0) = 1
           AND NOT EXISTS (SELECT 1 FROM growth_events WHERE player_id = ? AND match_ref IS ? AND event_type IS ?)`,
      )
      .bind(e.xp, e.playerId, e.playerId, e.matchRef, e.eventType),
    db
      .prepare(
        `INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, CASE WHEN COALESCE((SELECT growable FROM players WHERE id = ?), 0) = 1 THEN ? ELSE 0 END, ?, ?, ${nowSql()})
         ON CONFLICT (player_id, match_ref, event_type) DO NOTHING`,
      )
      .bind(e.playerId, e.matchRef, e.season, e.windowSeq, e.eventType, e.value, e.playerId, e.xp, e.source, e.recordedBy ?? null),
  ];
}

/**
 * 单条便捷封装（补录路径用），返回事件是否实际入账。
 * v6.52.0 起按事件 INSERT（results[1]）判定：非成长球员的 XP 语句恒 0 行，
 * 仍看 results[0] 会把「新事件已入库」误报成 duplicate（200 而非 201）。
 */
export async function recordGrowthEvent(db: D1Database, e: GrowthEventInput): Promise<boolean> {
  const results = await db.batch(recordGrowthEventStatements(db, e));
  return (results[1]?.meta.changes ?? 0) === 1;
}

/**
 * 解约清零的划断标记（与数值清零同一批写入）：值/XP 都是 0，只是给里程碑统计画一条线
 * ——里程碑只累计最后一次 reset 之后的进球/助攻事件，解约后回来的球员重新攒、重新补发。
 * 事件行本身留档，成长史里作为「解约重置」展示（历史不清空）。
 */
export function growthResetStatements(db: D1Database, playerId: number, ref: string, season: number | null, windowSeq: number | null): D1PreparedStatement[] {
  return recordGrowthEventStatements(db, {
    playerId,
    matchRef: ref,
    season,
    windowSeq,
    eventType: 'reset',
    value: 0,
    xp: 0,
    source: 'auto',
    recordedBy: null,
  });
}

// ---- 成长期（用户规则 2026-09-18）----
// 一个赛季可以有多个成长期，通常夹在两个窗口之间（半赛季），但可能临时改变，所以不与窗口绑定：
// 由管理端手动宣告，或在开窗时勾选复选框自动宣告。里程碑只算当前成长期内的进+攻。

export interface GrowthPeriod {
  id: number;
  startEventId: number;
}

/** 当前成长期 = id 最大的一行；没有行时返回 { id: 0, startEventId: 0 }（全生涯口径，等于成长期功能上线前的行为） */
export async function loadGrowthPeriod(db: D1Database): Promise<GrowthPeriod> {
  const row = await db
    .prepare('SELECT id, start_event_id FROM growth_periods ORDER BY id DESC LIMIT 1')
    .first<{ id: number; start_event_id: number }>();
  return row ? { id: row.id, startEventId: row.start_event_id } : { id: 0, startEventId: 0 };
}

/** 成长期记录行（管理端展示用；DTO 冻结 camelCase） */
export interface GrowthPeriodRow {
  id: number;
  season: number | null;
  startEventId: number;
  source: string;
  note: string | null;
  declaredBy: number | null;
  declaredAt: string | null;
}

/** 成长期列表（倒序）+ 当前期；管理端面板与结算提示用 */
export async function listGrowthPeriods(db: D1Database, limit = 20): Promise<{ current: GrowthPeriodRow | null; periods: GrowthPeriodRow[] }> {
  const rows = await db
    .prepare(
      `SELECT id, season, start_event_id, source, note, declared_by, declared_at
       FROM growth_periods ORDER BY id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; season: number | null; start_event_id: number; source: string; note: string | null; declared_by: number | null; declared_at: string | null }>();
  const periods: GrowthPeriodRow[] = rows.results.map((r) => ({
    id: r.id,
    season: r.season,
    startEventId: r.start_event_id,
    source: r.source,
    note: r.note,
    declaredBy: r.declared_by,
    declaredAt: r.declared_at,
  }));
  return { current: periods[0] ?? null, periods };
}

/** 宣告新成长期：界取宣告时点的事件序号（子查询与 INSERT 同批执行，不用先读一次） */
export function growthPeriodStatements(
  db: D1Database,
  input: { season: number | null; source: 'manual' | 'window_open'; note?: string | null; declaredBy: number | null },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO growth_periods (season, start_event_id, source, note, declared_by, declared_at)
         VALUES (?, (SELECT COALESCE(MAX(id), 0) FROM growth_events), ?, ?, ?, ${nowSql()})`,
      )
      .bind(input.season, input.source, input.note ?? null, input.declaredBy),
  ];
}

// ---- 防守位置判定（§10.1 零封/夺权：CDM/LB/CB/RB/GK；无 CDM 则 CM、无边卫则 LM/RM）----

const BASE_DEFENSIVE = new Set(['GK', 'CB', 'LB', 'RB', 'CDM']);

export async function defensivePositionsForClub(db: D1Database, clubId: number): Promise<Set<string>> {
  const positions = await db
    .prepare('SELECT DISTINCT position FROM players WHERE club_id = ? AND position IS NOT NULL')
    .bind(clubId)
    .all<{ position: string }>();
  const set = new Set(positions.results.map((r) => r.position));
  const defensive = new Set(BASE_DEFENSIVE);
  if (![...set].some((p) => p === 'CDM')) {
    defensive.add('CM');
  }
  if (![...set].some((p) => p === 'LB' || p === 'RB')) {
    defensive.add('LM');
    defensive.add('RM');
  }
  return defensive;
}

// ---- CPU 队判定（用户规则 2026-09-18，队籍口径修订 v2.0.0）----

/**
 * 比赛系统里队名以半角「(CPU)」结尾的队 = CPU 队。严格匹配，不做全角括号/大小写/空格容错：
 * 队名即口径，改名即重新判定。CPU 队在平台有 clubs 行，其球员带 club_id（可被海捞、可被认领），
 * 但代表 CPU 队出场的比赛不计成长（results.ts 整队跳过），CPU 队也不入账（奖金/主场收入/拍卖）。
 */
export function isCpuTeam(teamName: string | null | undefined): boolean {
  return typeof teamName === 'string' && teamName.endsWith('(CPU)');
}

// CPU 判定列化（v2.8.0，迁移 0026）：clubs.is_cpu 由迁移按队名口径回填（substr(name,-5)='(CPU)'），
// 之后新增 CPU 队走管理端建 clubs 行时置列；队名后缀只活在 tour 库侧的 isCpuTeam。
const CPU_CLUB_NAME_MATCH = 'is_cpu = 1';

/** 同上的 SQL 谓词形态——在 WHERE 子句里当集合用（如 club_id IN (SELECT ...)）。 */
export const CPU_CLUB_IDS_SQL = `(SELECT id FROM clubs WHERE ${CPU_CLUB_NAME_MATCH})`;

/** CPU 队的俱乐部 id 集合（队名带 (CPU) 后缀）——入账与落位前的白名单判定用（v2.0.0）。 */
export async function cpuClubIds(db: D1Database): Promise<Set<number>> {
  const rows = await db.prepare(`SELECT id FROM clubs WHERE ${CPU_CLUB_NAME_MATCH}`).all<{ id: number }>();
  return new Set(rows.results.map((r) => r.id));
}

// ---- 赛季结算（§10.1 结算行 + 里程碑；生成升级待办）----

export interface SettlementSummary {
  season: number;
  half: boolean;
  growthPeriodId: number; // 本次结算所依据的成长期（0 = 还没宣告过，全生涯口径）
  traineeXp: number;
  traineeCount: number;
  chinaCount: number;
  milestonesGranted: number;
  pendingLevelUps: { playerId: number; name: string; growthTier: number; pending: number }[];
}

export async function runGrowthSettlement(env: Env, actor: number, seasonInput: unknown, halfInput: unknown): Promise<SettlementSummary> {
  const db = env.DB;
  const season = Number(seasonInput);
  if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  const half = halfInput === true;
  const config = createConfigService(db);
  const traineeXp = (await config.getNumber(half ? 'trainee_xp_half' : 'trainee_xp_full')) ?? (half ? 15 : 40);
  const chinaXp = (await config.getNumber('china_xp_bonus')) ?? 20;
  const xpPerLevel = (await config.getNumber('xp_per_level')) ?? 10;

  const statements: D1PreparedStatement[] = [];

  // 训练营球员的赛季结算那份固定 XP（§10.1）；锚在 season 上天然幂等。
  // v6.45.0 起这份与逐场 XP 并行累加（训练营球员按场次照记出场/评分/进球/助攻/零封）
  // v6.52.0：非成长球员不产生这类纯 XP 合成事件（查询层过滤，连事件行都不写）
  const trainees = await scanRows<{ id: number }>(
    db,
    `SELECT t.id FROM players t JOIN contracts c ON c.player_id = t.id AND c.is_active = 1
     WHERE c.contract_type = 'trainee'
       AND COALESCE(t.growable, 0) = 1`,
    't.id',
    [],
  );
  for (const t of trainees) {
    statements.push(
      ...recordGrowthEventStatements(db, {
        playerId: t.id,
        matchRef: `trainee:${season}`,
        season,
        windowSeq: null,
        eventType: 'trainee_season',
        value: 1,
        xp: traineeXp,
        source: 'auto',
        recordedBy: actor,
      }),
    );
  }

  // 中国球员计划：每赛季额外 XP（china_plan=1）
  // 中国球员计划：只看在玩家队的中国球员——必须有现行合同（用户规则 2026-09-18：只有在玩家队的
  // 球员才有成长；CPU 队名单在比赛系统侧、自由身/无归属球员没有平台合同，不再每季白拿 20 XP）
  // v6.52.0：非成长球员不产生这类纯 XP 合成事件
  const china = await scanRows<{ id: number }>(
    db,
    `SELECT t.id FROM players t JOIN contracts c ON c.player_id = t.id AND c.is_active = 1
     WHERE t.china_plan = 1
       AND COALESCE(t.growable, 0) = 1`,
    't.id',
    [],
  );
  for (const p of china) {
    statements.push(
      ...recordGrowthEventStatements(db, {
        playerId: p.id,
        matchRef: `china:${season}`,
        season,
        windowSeq: null,
        eventType: 'china_plan',
        value: 1,
        xp: chinaXp,
        source: 'auto',
        recordedBy: actor,
      }),
    );
  }

  // 里程碑：只累计当前成长期内的进+攻（进球/助攻事件 value 合计），结算时补发已到达而未发的档。
  // 边界取两者较晚的一个：成长期的 start_event_id（见 loadGrowthPeriod），与这名球员最后一次
  // 解约清零的 reset 划断（见 growthResetStatements）。
  // 去重锚带上期号与划断序号：换新成长期 / 解约后重新攒够，都要能再补发（否则老行会一直挡住）。
  const period = await loadGrowthPeriod(db);
  // 同样必须外层套一层：聚合查询的游标列要落在最外层（且 GROUP BY 不能缺——漏掉就只剩一行，
  // 只有一名球员能拿到自己的划断序号，别的球员会退回 0 而补发不出新里程碑）
  const resets = await scanRows<{ id: number; reset_id: number | null }>(
    db,
    `SELECT x.id AS id, x.reset_id AS reset_id FROM (
       SELECT player_id AS id, MAX(id) AS reset_id FROM growth_events
       WHERE event_type = 'reset' GROUP BY player_id
     ) x WHERE x.id > 0`,
    'x.id',
    [],
  );
  const resetIds = new Map(resets.map((r) => [r.id, r.reset_id ?? 0]));
  // 外层再套一层 SELECT：scanRows 的游标条件是拼在 baseSql 末尾的 AND，必须落在最外层 WHERE 上
  // （直接拼在 GROUP BY 后面会被解析成分组表达式——曾把全表折成一组，且游标来回跳）
  const totals = await scanRows<{ id: number; total: number }>(
    db,
    `SELECT x.id AS id, x.total AS total FROM (
       SELECT ge.player_id AS id, SUM(ge.value) AS total FROM growth_events ge
       JOIN players p ON p.id = ge.player_id AND COALESCE(p.growable, 0) = 1
       WHERE ge.event_type IN ('goal', 'assist')
         AND ge.id > ?
         AND ge.id > COALESCE((SELECT MAX(r.id) FROM growth_events r WHERE r.player_id = ge.player_id AND r.event_type = 'reset'), 0)
       GROUP BY ge.player_id
     ) x WHERE x.id > 0`,
    'x.id',
    [period.startEventId],
  );
  let milestonesGranted = 0;
  const milestoneStatements: D1PreparedStatement[] = [];
  for (const row of totals) {
    const generation = resetIds.get(row.id) ?? 0;
    for (const t of milestoneThresholds(row.total)) {
      milestoneStatements.push(
        ...recordGrowthEventStatements(db, {
          playerId: row.id,
          matchRef: `milestone:${period.id}:${generation}:${t}`,
          season,
          windowSeq: null,
          eventType: 'milestone',
          value: t,
          xp: milestoneXp(t),
          source: 'auto',
          recordedBy: actor,
        }),
      );
    }
  }
  // 先入事件，再按实际插入数汇总（changes 判定，重放不重复计 XP）
  const firstBatch = [...statements, ...milestoneStatements];
  if (firstBatch.length > 0) {
    const results = await db.batch(firstBatch);
    // 每条事件两条语句（先 UPDATE 后 INSERT），奇数位 changes=1 表示新入账
    for (let i = 0; i < milestoneStatements.length; i += 2) {
      if ((results[statements.length + i + 1]?.meta.changes ?? 0) === 1) milestonesGranted++;
    }
  }

  // 升级待办清单（待办数 = floor(xp/10) − 已消费；发放走 /api/growth/levelup/:playerId）
  // v6.52.0：非成长球员不可消费升级，不列进待办表。赛季重判（season-settle 的 growableStatement）
  // 把可成长翻成非成长时只改 growable、不清 growth_xp ⇒ 「有 XP 但不可消费」会长期存在，
  // 这里必须按 growable 收窄（否则管理端待办表永远挂着点下去必 409 的球员）。
  const pending = await db
    .prepare(
      `SELECT id, name, display_name, growth_tier, CAST(growth_xp / ? AS INTEGER) - levels_applied AS pending
       FROM players
       WHERE CAST(growth_xp / ? AS INTEGER) - levels_applied > 0
         AND COALESCE(growable, 0) = 1
       ORDER BY id LIMIT 200`,
    )
    .bind(xpPerLevel, xpPerLevel)
    .all<{ id: number; name: string; display_name: string | null; growth_tier: number; pending: number }>();

  await writeAudit(db, {
    actor,
    action: 'growth_settlement',
    targetType: 'season',
    targetId: season,
    origin: 'user',
    after: { half, growthPeriodId: period.id, traineeCount: trainees.length, chinaCount: china.length, milestonesGranted },
  });

  return {
    season,
    half,
    growthPeriodId: period.id,
    traineeXp,
    traineeCount: trainees.length,
    chinaCount: china.length,
    milestonesGranted,
    pendingLevelUps: pending.results.map((r) => ({ playerId: r.id, name: rowDisplayName(r), growthTier: r.growth_tier, pending: r.pending })),
  };
}

async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await createAuditStatement(db)(entry).run();
}

// id 分页扫描（§17：游标 + 硬 LIMIT，避免一次性大结果集）；baseSql 须自带 WHERE
async function scanRows<T>(db: D1Database, baseSql: string, cursorCol: string, params: unknown[]): Promise<T[]> {
  const out: T[] = [];
  let lastId = 0;
  for (;;) {
    const rows = await db
      .prepare(`${baseSql} AND ${cursorCol} > ? ORDER BY ${cursorCol} LIMIT 500`)
      .bind(...params, lastId)
      .all<T>();
    if (rows.results.length === 0) break;
    out.push(...rows.results);
    lastId = (rows.results[rows.results.length - 1] as { id: number }).id;
    if (rows.results.length < 500) break;
  }
  return out;
}

// ---- PlayStyle 发放明细（v3.3.0：徽章与 PlayStyle 合并；v6.63.0 台账改全量派生）----
// 台账计数（players.badges_silver / badges_gold）= 合并清单段内数量（FC 槽数减被发放金抑制的银槽
// + 发放明细行数），明细表（player_playstyles）说「发了哪几个、落在哪个槽、谁发的、什么来源」。
// 台账是派生值：每次明细变更后同批重算（recountBadgeStatements），不再增量加减 —— 大换版折算、
// 抑制的出现与回归都不需要维护第二套算术。source 值域在 src/core/playstyle-rules.ts。

export interface GrantedPlaystyle extends GrantedPlaystyleRow {
  createdAt: string | null;
}

/** 球员的发放明细（属性页清单与成长页签共用），按槽号升序 */
export async function listPlayerPlaystyles(db: D1Database, playerId: number): Promise<GrantedPlaystyle[]> {
  const rows = await db
    .prepare('SELECT slot, kind, psid, source, created_at FROM player_playstyles WHERE player_id = ? ORDER BY slot')
    .bind(playerId)
    .all<{ slot: number; kind: PlaystyleKind; psid: number; source: PlaystyleSource; created_at: string | null }>();
  return rows.results.map((r) => ({ slot: r.slot, kind: r.kind, psid: r.psid, source: r.source, createdAt: r.created_at }));
}

/** FC 源数据的 PlayStyle 槽位（game_attrs 里 PSID1-15 那一份，导入即整列覆盖） */
async function fcPlaystyleSlots(db: D1Database, playerId: number): Promise<PlaystyleSlot[]> {
  const row = await db.prepare('SELECT game_attrs FROM players WHERE id = ?').bind(playerId).first<{ game_attrs: string | null }>();
  if (!row?.game_attrs) return [];
  try {
    return playstyleSlotsOf(JSON.parse(row.game_attrs) as Record<string, unknown>);
  } catch {
    return []; // 脏 JSON 当没有：发放校验少一条占用总比整条链路 500 好
  }
}

/** 发放校验要的三份现状：FC 源槽 + 既有发放明细 + 位置（Q10 位置资格），三次读并发 */
async function playstylePickPlan(
  db: D1Database,
  playerId: number,
): Promise<{ fc: PlaystyleSlot[]; granted: GrantedPlaystyle[]; position: string | null }> {
  const [fcRes, granted, posRow] = await Promise.all([
    fcPlaystyleSlots(db, playerId),
    listPlayerPlaystyles(db, playerId),
    db.prepare('SELECT position FROM players WHERE id = ?').bind(playerId).first<{ position: string | null }>(),
  ]);
  return { fc: fcRes, granted, position: posRow?.position ?? null };
}

/** picks 入参归一：非数组当空（planPlaystylePicks 会按数量不匹配给出人话报错） */
function normalizePlaystylePicks(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input.map((v) => Number(v));
}

/** 发放明细的 INSERT 语句（与台账计数同批写入）；psid 落库前换算成基础 ID */
function insertPlaystyleStatements(
  db: D1Database,
  playerId: number,
  slots: readonly PlaystyleSlot[],
  source: PlaystyleSource,
  actor: number,
): D1PreparedStatement[] {
  return slots.map((s) =>
    db
      .prepare(
        `INSERT INTO player_playstyles (player_id, slot, kind, psid, source, granted_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ${nowSql()})`,
      )
      .bind(playerId, s.slot, s.gold ? 'gold' : 'silver', basePlaystyleId(s.psid), source, actor),
  );
}

/** 发放校验（v6.63.0：跨段规则 + 位置资格在 core planPlaystylePicks；growth 语境返回替换清单） */
function resolvePlaystylePicks(
  picksInput: unknown,
  plan: { silverCount: number; goldCount: number },
  state: { fc: PlaystyleSlot[]; granted: GrantedPlaystyle[]; position: string | null },
  context: PlaystylePickContext,
): { slots: PlaystyleSlot[]; superseded: SupersedeTarget[] } {
  if (plan.silverCount <= 0 && plan.goldCount <= 0) return { slots: [], superseded: [] };
  const outcome = planPlaystylePicks(normalizePlaystylePicks(picksInput), {
    silverCount: plan.silverCount,
    goldCount: plan.goldCount,
    ownedPsids: [
      ...state.fc.map((s) => s.psid),
      ...state.granted.map((g) => playstyleIdOf(g.psid, g.kind)),
    ],
    usedSlots: [...state.fc.map((s) => s.slot), ...state.granted.map((g) => g.slot)],
    context,
    position: state.position,
    grantedRows: state.granted,
  });
  if (!outcome.ok) throw new HttpError(400, outcome.message);
  return { slots: outcome.slots, superseded: outcome.superseded };
}

/** 明细变更后的台账重算（v6.63.0 全量口径：= FC 槽数减被发放金抑制的银槽 + 发放明细行数）。
 *  用 SQL 公式在执行时实时算（fullCountSql 与迁移 backfill 同源），同批里排在删行/插行之后，
 *  天然消除「计划-执行」窗口内明细再变的竞态；growth/shop 两条链路共用。 */
export function recountBadgeStatements(db: D1Database, playerId: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE players SET badges_silver = ${fullCountSql('silver')}, badges_gold = ${fullCountSql('gold')}, updated_at = ${nowSql()} WHERE id = ?`,
    )
    .bind(playerId);
}

/** 替换清单的删行语句（成长择金遇银：发放银真实删除；FC 银走派生抑制不在此列） */
function supersedeDeleteStatements(db: D1Database, playerId: number, superseded: readonly SupersedeTarget[]): D1PreparedStatement[] {
  return superseded.map((s) =>
    db
      .prepare(`DELETE FROM player_playstyles WHERE player_id = ? AND kind = 'silver' AND psid = ?`)
      .bind(playerId, s.psid),
  );
}

// ---- 升级方案二选一（§10.2）：消费一次待办，写入 CA 与徽章计数 ----

export async function applyLevelUp(
  env: Env,
  actor: number,
  playerId: number,
  planIndexInput: unknown,
  picksInput?: unknown,
): Promise<{
  ok: true;
  plan: UpgradePlan;
  levelsApplied: number;
  pendingLeft: number;
  playstyles: PlaystyleSlot[];
}> {
  const db = env.DB;
  const player = await db
    .prepare(
      'SELECT id, name, display_name, club_id, growable, growth_tier, growth_xp, levels_applied, ca, pa, position FROM players WHERE id = ?',
    )
    .bind(playerId)
    .first<{
      id: number;
      name: string;
      display_name: string | null;
      club_id: number | null;
      growable: number | null;
      growth_tier: number;
      growth_xp: number;
      levels_applied: number;
      ca: number | null;
      pa: number | null;
      position: string | null;
    }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

  // v6.52.0 兜底闸门：非成长球员不能消费升级。必须排在 pending 判定之前——迁移 0077 清零后
  // 非成长球员 pending 本来为 0，先判 pending 会永远命中「没有待处理的升级」，新文案不可观测。
  if (player.growable !== 1) throw new HttpError(409, '非成长球员不能消费升级');

  const config = createConfigService(db);
  const xpPerLevel = (await config.getNumber('xp_per_level')) ?? 10;
  const pending = Math.floor(player.growth_xp / xpPerLevel) - player.levels_applied;
  if (pending <= 0) throw new HttpError(409, '这名球员没有待处理的升级');

  const plans = (await getUpgradePlans(db))[player.growth_tier] ?? DEFAULT_UPGRADE_PLANS[player.growth_tier] ?? [];
  const planIndex = Number(planIndexInput);
  if (!Number.isInteger(planIndex) || planIndex < 0 || planIndex >= plans.length) {
    throw new HttpError(400, `方案序号不对，档 ${player.growth_tier} 有 ${plans.length} 个可选方案`);
  }
  const plan = plans[planIndex]!;
  // v6.60.3 用户裁决：CA 永远不能超过 PA。方案增量按剩余潜力截断（CA 已到顶时增量为 0，
  // 徽章/级数照常结算）；PA 缺失（长尾导入）不做封顶，避免把未定的潜力当 0。
  const caGain =
    player.pa === null || player.ca === null ? plan.ca : Math.max(0, Math.min(plan.ca, player.pa - player.ca));
  const appliedPlan = { ...plan, ca: caGain };
  const nextLevelNo = player.levels_applied + 1;
  // 带徽章的方案要先选好发哪几个 PlayStyle：明细与台账重算必须同一次写入（v6.63.0 全量口径），
  // 跨段替换（金顶银）的删行也在同一批 —— 顺序：删被顶发放银 → 插新行 → 台账重算
  const state = await playstylePickPlan(db, playerId);
  const { slots: grants, superseded } = resolvePlaystylePicks(picksInput, { silverCount: plan.silver, goldCount: plan.gold }, state, 'growth');

  await db.batch([
    db
      .prepare(
        `UPDATE players SET ca = MIN(COALESCE(pa, ca + ?), ca + ?), levels_applied = levels_applied + 1, updated_at = ${nowSql()} WHERE id = ?`,
      )
      .bind(caGain, caGain, playerId),
    ...supersedeDeleteStatements(db, playerId, superseded),
    ...insertPlaystyleStatements(db, playerId, grants, 'growth', actor),
    recountBadgeStatements(db, playerId),
    ...recordGrowthEventStatements(db, {
      playerId,
      matchRef: `levelup:${nextLevelNo}`,
      season: null,
      windowSeq: null,
      eventType: 'levelup',
      value: planIndex,
      xp: 0,
      source: 'auto',
      recordedBy: actor,
    }),
  ]);
  await writeAudit(db, {
    actor,
    action: 'growth_levelup',
    targetType: 'player',
    targetId: playerId,
    origin: 'user',
    after: { tier: player.growth_tier, planIndex, plan: appliedPlan, requestedCa: plan.ca, playstyles: grants, superseded },
  });
  // 通知教练（§12；尽力而为，没绑 QQ 静默跳过）
  await queueClubNotification(env, player.club_id, 'levelup', {
    player: rowDisplayName(player),
    playerId,
    ca: caGain,
    silver: plan.silver,
    gold: plan.gold,
  });
  return { ok: true, plan: appliedPlan, levelsApplied: nextLevelNo, pendingLeft: pending - 1, playstyles: grants };
}

// ---- 中国球员计划自选银徽章（§10：config.china_badges 落地）----
// 离队失效：source='china' 的行在转会成交时回收、解约时随明细一起删（transfers.ts）。
// 名额 = china_badges（默认 3）− 已发的 source='china' 行数，所以这个端点可以分几次调，
// 每次把剩下的名额选完为止。
export async function grantChinaPlaystyles(
  env: Env,
  actor: number,
  playerId: number,
  picksInput: unknown,
): Promise<{ ok: true; playstyles: PlaystyleSlot[]; granted: number; left: number }> {
  const db = env.DB;
  const config = createConfigService(db);
  const quota = (await config.getNumber('china_badges')) ?? 3;
  const state = await playstylePickPlan(db, playerId);
  const already = state.granted.filter((g) => g.source === 'china').length;
  const need = quota - already;
  if (need <= 0) throw new HttpError(409, `中国计划徽章已经发完（${quota} 个）`);

  // china 只发银（goldCount 恒 0）；跨段规则下择银遇金三语境同挡，不会有替换清单
  const { slots: grants, superseded } = resolvePlaystylePicks(picksInput, { silverCount: need, goldCount: 0 }, state, 'china');

  await db.batch([
    ...supersedeDeleteStatements(db, playerId, superseded),
    ...insertPlaystyleStatements(db, playerId, grants, 'china', actor),
    recountBadgeStatements(db, playerId),
  ]);
  await writeAudit(db, {
    actor,
    action: 'growth_china_playstyles',
    targetType: 'player',
    targetId: playerId,
    origin: 'user',
    after: { quota, playstyles: grants, superseded },
  });
  return { ok: true, playstyles: grants, granted: grants.length, left: need - grants.length };
}
