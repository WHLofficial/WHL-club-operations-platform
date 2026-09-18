// 成长引擎（TECH_DESIGN §10）：XP 事件（赛果确认钩子自动 + 管理组补录）、赛季结算
// （里程碑/训练营/中国计划）、升级方案二选一、档位核定。去重锚 = UNIQUE(player_id, match_ref, event_type)，
// 所有入账先 ON CONFLICT DO NOTHING，实际插入的行再累计 growth_xp（meta.changes 判定）。
import { HttpError } from '../lib/http.ts';
import { createAuditStatement, type AuditEntry } from '../lib/audit.ts';
import { createConfigService } from '../core/config.ts';
import { queueClubNotification } from './notify.ts';
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
// 夺回球权每 12 次 1；扑救每 8 次 1 且单场 >8 额外 1
export function xpForEvent(eventType: GrowthEventType, value: number): number {
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
      return Math.floor(value / 12);
    case 'saves':
      return Math.floor(value / 8) + (value > 8 ? 1 : 0);
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
 */
export function recordGrowthEventStatements(db: D1Database, e: GrowthEventInput): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE players SET growth_xp = growth_xp + ?, updated_at = ${nowSql()}
         WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM growth_events WHERE player_id = ? AND match_ref IS ? AND event_type IS ?)`,
      )
      .bind(e.xp, e.playerId, e.playerId, e.matchRef, e.eventType),
    db
      .prepare(
        `INSERT INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql()})
         ON CONFLICT (player_id, match_ref, event_type) DO NOTHING`,
      )
      .bind(e.playerId, e.matchRef, e.season, e.windowSeq, e.eventType, e.value, e.xp, e.source, e.recordedBy ?? null),
  ];
}

/** 单条便捷封装（补录路径用），返回是否实际入账 */
export async function recordGrowthEvent(db: D1Database, e: GrowthEventInput): Promise<boolean> {
  const results = await db.batch(recordGrowthEventStatements(db, e));
  return (results[0]?.meta.changes ?? 0) === 1;
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

/** 成长期档案行（管理端展示用；DTO 冻结 camelCase） */
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

// ---- CPU 队判定（用户规则 2026-09-18，队籍口径修订 增量 14）----

/**
 * 比赛系统里队名以半角「(CPU)」结尾的队 = CPU 队。严格匹配，不做全角括号/大小写/空格容错：
 * 队名即口径，改名即重新判定。CPU 队在平台有 clubs 行，其球员带 club_id（可被海捞、可被认领），
 * 但代表 CPU 队出场的比赛不计成长（results.ts 整队跳过），CPU 队也不入账（奖金/主场收入/拍卖）。
 */
export function isCpuTeam(teamName: string | null | undefined): boolean {
  return typeof teamName === 'string' && teamName.endsWith('(CPU)');
}

// 与 isCpuTeam 逐字对齐：严格取末 5 字符（LIKE 在 SQLite 里对 ASCII 不区分大小写，会与队名口径分叉）
const CPU_CLUB_NAME_MATCH = "substr(name, -5) = '(CPU)'";

/** 同上的 SQL 谓词形态——在 WHERE 子句里当集合用（如 club_id IN (SELECT ...)）。 */
export const CPU_CLUB_IDS_SQL = `(SELECT id FROM clubs WHERE ${CPU_CLUB_NAME_MATCH})`;

/** CPU 队的俱乐部 id 集合（队名带 (CPU) 后缀）——入账与落位前的白名单判定用（增量 14）。 */
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

  // 训练营球员：固定 XP/赛季，不按场次（§10.1）；锚在 season 上天然幂等
  const trainees = await scanRows<{ id: number }>(
    db,
    `SELECT t.id FROM players t JOIN contracts c ON c.player_id = t.id AND c.is_active = 1
     WHERE c.contract_type = 'trainee'`,
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
  const china = await scanRows<{ id: number }>(
    db,
    `SELECT t.id FROM players t JOIN contracts c ON c.player_id = t.id AND c.is_active = 1
     WHERE t.china_plan = 1`,
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
  const pending = await db
    .prepare(
      `SELECT id, name, growth_tier, CAST(growth_xp / ? AS INTEGER) - levels_applied AS pending
       FROM players WHERE CAST(growth_xp / ? AS INTEGER) - levels_applied > 0 ORDER BY id LIMIT 200`,
    )
    .bind(xpPerLevel, xpPerLevel)
    .all<{ id: number; name: string; growth_tier: number; pending: number }>();

  await writeAudit(db, {
    actor,
    action: 'growth_settlement',
    targetType: 'season',
    targetId: season,
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
    pendingLevelUps: pending.results.map((r) => ({ playerId: r.id, name: r.name, growthTier: r.growth_tier, pending: r.pending })),
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

// ---- 升级方案二选一（§10.2）：消费一次待办，写入 CA 与徽章计数 ----

export async function applyLevelUp(env: Env, actor: number, playerId: number, planIndexInput: unknown): Promise<{
  ok: true;
  plan: UpgradePlan;
  levelsApplied: number;
  pendingLeft: number;
}> {
  const db = env.DB;
  const player = await db
    .prepare('SELECT id, name, club_id, growth_tier, growth_xp, levels_applied, badges_silver, badges_gold FROM players WHERE id = ?')
    .bind(playerId)
    .first<{
      id: number;
      name: string;
      club_id: number | null;
      growth_tier: number;
      growth_xp: number;
      levels_applied: number;
      badges_silver: number;
      badges_gold: number;
    }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

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
  const capSilver = (await config.getNumber('badge_cap_silver')) ?? 15;
  const capGold = (await config.getNumber('badge_cap_gold')) ?? 3;
  const nextLevelNo = player.levels_applied + 1;

  await db.batch([
    db
      .prepare(
        `UPDATE players SET ca = ca + ?, badges_silver = MIN(?, badges_silver + ?), badges_gold = MIN(?, badges_gold + ?),
           levels_applied = levels_applied + 1, updated_at = ${nowSql()} WHERE id = ?`,
      )
      .bind(plan.ca, capSilver, plan.silver, capGold, plan.gold, playerId),
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
    after: { tier: player.growth_tier, planIndex, plan },
  });
  // 通知教练（§12；尽力而为，没绑 QQ 静默跳过）
  await queueClubNotification(env, player.club_id, 'levelup', {
    player: player.name,
    ca: plan.ca,
    silver: plan.silver,
    gold: plan.gold,
  });
  return { ok: true, plan, levelsApplied: nextLevelNo, pendingLeft: pending - 1 };
}
