// 管理端 · 成长引擎管理端（附录 A〔6〕，§10；公开端点在 routes/growth.ts；
// 原 admin.ts 成长域，v2.1.0 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement, writeAudit } from '../../../lib/audit.ts';
import { getVisibleSeason } from '../../seasons.ts';
import {
  xpForEvent,
  recordGrowthEvent,
  recordGrowthEventStatements,
  isCpuTeam,
  runGrowthSettlement,
  listGrowthPeriods,
  loadGrowthPeriod,
  growthPeriodStatements,
  type GrowthEventType,
} from '../../growth.ts';
import { rowDisplayName } from '../../../core/player-name.ts';
import { parseOcrVision, buildOcrEntries, matchOcrTeamSide, fc26TeamIdOfName, ocrCrossChecks, type OcrRosterPlayer } from '../../../core/growth-ocr.ts';
import { llmVisionJson } from '../../../lib/llm.ts';
import { sha256Hex } from '../../../lib/crypto.ts';
import { suspendedPlayersAtMatch, suspensionLabel } from '../../tour-suspension.ts';
import { loadTournamentNames, tournamentNameOf } from '../../tournament-names.ts';
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// 补录口径（单人与批量共用一份，防止两处漂移）：rating 0.0-10.0 且四舍五入到 0.1；
// duels_won 非负整数（0 行合法，v6.42.0：它是「防守球员人工确认」的载体——手填了，哪怕是 0，
// 就认定该场为防守球员）、saves 正整数；XP 一律服务端按 §10.1 算，夺回球权/扑救两项按
// 跨场累计折算（base = 历史累计次数，只入账跨档差值），单场不足一档就是 0 XP，合法落台账。
// v6.46.0：评分放宽到 0.0 起步（低于 7.0 只记录、0 XP——「录了但没打好」也要能进均分）；
// xpOn=false 用于不计 XP 的场次（杯赛淘汰赛/超级杯/资格赛），值照录、XP 归零。
function manualEventOf(eventType: GrowthEventType, raw: unknown, base = 0, xpOn = true): { value: number; xp: number } {
  let value = raw === undefined || raw === null ? 1 : Number(raw);
  if (eventType === 'rating') {
    if (!Number.isFinite(value) || value < 0 || value > 10) throw new HttpError(400, '评分要在 0.0-10.0 之间（7.0 以下不给 XP）');
    value = Math.round(value * 10) / 10;
  } else if (eventType === 'duels_won') {
    if (!Number.isInteger(value) || value < 0) throw new HttpError(400, '夺回球权要是非负整数（填 0 = 确认防守球员）');
  } else if (eventType === 'saves') {
    if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, '次数要是正整数');
  }
  return { value, xp: xpOn ? xpForEvent(eventType, value, base) : 0 };
}

// 累计项（duels_won/saves）的跨场基数：该球员该类型历史行 SUM(value)。含本场已有行——
// 本场行已存在时该锚整项是 duplicate 不重复入账，基数差只影响响应里的 xp 展示值，库里恒正确。
async function loadCumulativeBases(db: D1Database, playerIds: number[]): Promise<Map<string, number>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .prepare(
      `SELECT player_id, event_type, SUM(value) AS total FROM growth_events
       WHERE event_type IN ('duels_won', 'saves') AND player_id IN (${playerIds.map(() => '?').join(', ')})
       GROUP BY player_id, event_type`,
    )
    .bind(...playerIds)
    .all<{ player_id: number; event_type: string; total: number }>();
  return new Map(rows.results.map((r) => [`${r.player_id}|${r.event_type}`, r.total] as const));
}

/** 事件类型的中文名（拒改文案与审计 detail 用） */
const EVENT_TYPE_LABELS: Record<string, string> = {
  appearance: '出场',
  rating: '评分',
  clean_sheet: '零封',
  duels_won: '夺回球权',
  saves: '扑救',
  goal: '进球',
  assist: '助攻',
};

interface ExistingEventRow {
  id: number;
  player_id: number;
  event_type: string;
  value: number;
  xp: number;
  source: string;
}

/** 改值重放结果：被改行的新 XP、链上其他受影响的行、该球员这次的总 XP 差额 */
interface ChainReplay {
  xp: number;
  extra: { id: number; xp: number }[];
  delta: number;
}

/**
 * 改一条已录事件的值后，重放该球员该类型事件的 XP 链（v6.45.1）。
 * 写入时的算法是「基数 = 那一刻该球员该类型已录值之和」（v6.42.0 起跨场累计），
 * 录入顺序 = created_at, id 序，所以按同一顺序重放即可精确复现：
 * 每个事件 xp = xpForEvent(type, value, 此前值之和)。非累计类型（rating 的值定档）重放后
 * 只有被改行会变——链上其余行不受影响，这份通用实现也顺带把它们校正回同式。
 * 返回 null 表示这条行不在了（库里没有删除通道，理论上到不了这里），调用方按 no-op 处理。
 */
async function replayEventChain(
  db: D1Database,
  playerId: number,
  eventType: GrowthEventType,
  change: { id: number; value: number },
): Promise<ChainReplay | null> {
  const rows = await db
    .prepare('SELECT id, value, xp FROM growth_events WHERE player_id = ? AND event_type = ? ORDER BY created_at, id')
    .bind(playerId, eventType)
    .all<{ id: number; value: number; xp: number }>();
  let base = 0;
  let delta = 0;
  let xp: number | null = null;
  const extra: { id: number; xp: number }[] = [];
  for (const r of rows.results) {
    const value = r.id === change.id ? change.value : r.value;
    const next = xpForEvent(eventType, value, base);
    if (r.id === change.id) xp = next;
    if (next !== r.xp) {
      delta += next - r.xp;
      if (r.id !== change.id) extra.push({ id: r.id, xp: next });
    }
    base += value;
  }
  return xp === null ? null : { xp, extra, delta };
}

// 补录：评分/扑救/夺回球权等比赛系统没有的数据；XP 由服务端按 §10.1 计算
app.post('/growth/events', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown; matchRef?: unknown; eventType?: unknown; value?: unknown } | null;
  const playerId = Number(body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const player = await c.env.DB.prepare('SELECT id, name, display_name, fc_id, growable FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; name: string; display_name: string | null; fc_id: number | null; growable: number | null }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

  const eventType = body?.eventType;
  const MANUAL_TYPES = ['appearance', 'rating', 'clean_sheet', 'duels_won', 'saves'] as const;
  if (typeof eventType !== 'string' || !(MANUAL_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpError(400, 'event_type 只能是 appearance / rating / clean_sheet / duels_won / saves');
  }
  const matchRef = typeof body?.matchRef === 'string' && body.matchRef.trim() !== '' ? body.matchRef.trim().slice(0, 40) : `manual:${Date.now()}`;
  // v6.46.0：锚是赛事系统比赛号时按那场赛事判是否计 XP（口径同批量端点）。查不到的场次号按「不计 XP」
  // 处理——宁可少给，也不给不该给的赛事发 XP；`manual:` 这类自定义锚无从判，沿用旧行为（照常计 XP）。
  let xpEligible = true;
  if (/^\d+$/.test(matchRef)) {
    const conf = await c.env.DB.prepare('SELECT competition_type, stage_kind FROM result_confirmations WHERE match_id = ?')
      .bind(Number(matchRef))
      .first<{ competition_type: string | null; stage_kind: string | null }>();
    xpEligible = conf !== null && xpEligibleOf(conf);
  }
  if (!xpEligible && eventType !== 'appearance' && eventType !== 'rating') {
    throw new HttpError(400, `这场比赛不计成长 XP，${EVENT_TYPE_LABELS[eventType as GrowthEventType] ?? eventType}录不了，只能录出场与评分`);
  }
  const { value, xp } = manualEventOf(
    eventType as GrowthEventType,
    body?.value,
    eventType === 'duels_won' || eventType === 'saves' ? (await loadCumulativeBases(c.env.DB, [playerId])).get(`${playerId}|${eventType}`) ?? 0 : 0,
    xpEligible,
  );
  // v6.52.0：非成长球员（growable !== 1）事件照收、XP 归零。三处（入账 / 审计 / 响应）必须共用
  // 同一个局部量——只改传给 recordGrowthEvent 的话，响应与审计会回一个并没有入账的 XP 值。
  const creditedXp = player.growable === 1 ? xp : 0;
  // v6.45.0：锚是赛事系统比赛号时按同场停赛拦（停赛球员不能录成长）；`manual:` 这类自定义锚无从判，放行
  if (/^\d+$/.test(matchRef) && player.fc_id !== null) {
    const s = (await suspendedPlayersAtMatch(c.env.TOUR_DB, Number(matchRef))).get(player.fc_id);
    if (s) throw new HttpError(400, `${rowDisplayName(player)} 本场停赛（${suspensionLabel(s)}），不能录成长`);
  }
  // recorded = 事件是否新入账（v6.52.0 起由 core 按事件 INSERT 判定，不再看 XP 语句的 changes——
  // 非成长球员的 XP 语句恒 0 行，若仍看它会把这个新事件误报成 duplicate）
  const recorded = await recordGrowthEvent(c.env.DB, {
    playerId,
    matchRef,
    season: await getVisibleSeason(c.env.DB),
    windowSeq: null,
    eventType: eventType as GrowthEventType,
    value,
    xp: creditedXp,
    source: 'manual',
    recordedBy: user.id,
  });
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'growth_manual_event',
    targetType: 'player',
    targetId: playerId,
    origin: 'user',
    after: { eventType, value, xp: creditedXp, matchRef, duplicate: !recorded },
  });
  return c.json({ ok: true, xp: creditedXp, duplicate: !recorded }, recorded ? 201 : 200);
});

app.post('/growth/settlement/run', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { season?: unknown; half?: unknown } | null;
  const summary = await runGrowthSettlement(c.env, user.id, body?.season, body?.half);
  return c.json({ ok: true, ...summary });
});

// 成长期宣告（用户规则 2026-09-18）：里程碑只累计当前成长期内的进+攻。
// 与窗口解耦：管理端随时可以宣告新一期；开窗时也能勾选自动宣告（window-machine.ts 的 declareGrowthPeriod）。
// 宣告只是画一条线（界 = 当前事件序号），不改任何球员数据，因此可反复宣告、可连续宣告。
app.get('/growth/periods', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json(await listGrowthPeriods(c.env.DB));
});

app.post('/growth/periods', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { season?: unknown; note?: unknown } | null;
  let season: number | null;
  if (body?.season === undefined || body?.season === null || body?.season === '') {
    season = await getVisibleSeason(c.env.DB);
  } else {
    season = Number(body.season);
    if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  }
  const note = typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim().slice(0, 60) : null;
  await c.env.DB.batch([
    ...growthPeriodStatements(c.env.DB, { season, source: 'manual', note, declaredBy: user.id }),
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_period_declared',
      targetType: 'growth_period',
      targetId: null,
      origin: 'user',
      after: { season, note, source: 'manual' },
    }),
  ]);
  return c.json({ ok: true, ...(await loadGrowthPeriod(c.env.DB)) }, 201);
});

// 档位核定（§10.3）自 v6.48.0 起搬到 routes/admin/growth-tier.ts（自动核定 + 人工覆盖/锁定），
// 路径不变：GET|POST /growth/:playerId/tier 与 POST /growth/:playerId/tier/unlock。

// ---- v6.16.0：按场次的花名册批量补录台（管理端三个端点）----
// v6.46.0 起「能录」与「计 XP」解耦：
//   能录 = 全部已确认的非弃权场次（杯赛淘汰赛、超级杯、资格赛也要能录出场与评分——球员页「比赛」
//          页签的出场/均分来自补录，赛事系统侧只保证有事件的人不缺，替补登场与差评分只有补录才有）；
//   计 XP = 与自动钩子（results.ts recordAutoXpForMatch）同源口径：顶级/次级联赛全阶段、冠军杯小组赛。
// 三条 SQL 片段（列表/面板/批量）共用同一个 WHERE，改口径只改这一行；计 XP 的判定见 xpEligibleOf。
const MATCH_ENTRY_WHERE = `(rc.walkover_side IS NULL OR rc.walkover_side = '')`;

/** 本场是否计成长 XP：与自动钩子同源（联赛顶级/次级全阶段 + 冠军杯小组赛）；其余赛事值照录、XP 归零 */
function xpEligibleOf(row: { competition_type: string | null; stage_kind: string | null }): boolean {
  return (
    row.competition_type === 'league_premier' ||
    row.competition_type === 'league_second' ||
    (row.competition_type === 'champions_cup' && row.stage_kind === 'group')
  );
}

const MATCH_ENTRY_COLUMNS = `rc.match_id, rc.season, rc.window_seq, rc.competition_type, rc.stage_name, rc.stage_kind, rc.round,
     rc.home_team, rc.away_team, rc.score_home, rc.score_away, rc.finished_at, rc.confirmed_at, rc.tournament_id`;

// 面板花名册的稳定序：位置权重（门将→后卫→中场→前锋，与 routes/players.ts 的 POSITION_SORT_CASE 同序）→ id
const ROSTER_POSITION_CASE = `CASE players.position
  WHEN 'GK' THEN 1
  WHEN 'RB' THEN 2 WHEN 'CB' THEN 2 WHEN 'LB' THEN 2
  WHEN 'CDM' THEN 3 WHEN 'RM' THEN 3 WHEN 'CM' THEN 3 WHEN 'LM' THEN 3 WHEN 'CAM' THEN 3
  WHEN 'RW' THEN 4 WHEN 'ST' THEN 4 WHEN 'LW' THEN 4
  ELSE 0 END`;

// 批量行的五个可录项（与单人补录的 MANUAL_TYPES 同集合，只是字段名走 camelCase）
const BATCH_ENTRY_FIELDS = ['appearance', 'rating', 'cleanSheet', 'duelsWon', 'saves'] as const;

interface MatchEntryRow {
  match_id: number;
  season: number;
  window_seq: number;
  competition_type: string | null;
  stage_name: string | null;
  stage_kind: string | null;
  round: number | null;
  home_team: string | null;
  away_team: string | null;
  score_home: number | null;
  score_away: number | null;
  finished_at: string | null;
  confirmed_at: string | null;
  tournament_id: number | null;
  recorded?: number;
}

interface EntryPlayerRow {
  id: number;
  name: string;
  display_name: string | null;
  club_id: number | null;
  position: string | null;
  status: string;
  fc_id?: number | null;
  /** v6.52.0：非成长球员（COALESCE(growable,0) = 0）录入照收、XP 归零；比较一律 `=== 1` */
  growable: number | null;
}

// 一侧的归属解析结果：clubId 解析不到（含 CPU 队）为 null，isCpu 单独标出
interface EntrySide {
  clubId: number | null;
  isCpu: boolean;
}

/** 单场可录行：必须已确认且满足可计 XP 口径，否则 null（端点按 404 处理） */
async function loadEntryMatch(db: D1Database, matchId: number): Promise<MatchEntryRow | null> {
  return db
    .prepare(`SELECT ${MATCH_ENTRY_COLUMNS} FROM result_confirmations rc WHERE rc.match_id = ? AND ${MATCH_ENTRY_WHERE}`)
    .bind(matchId)
    .first<MatchEntryRow>();
}

/** 队名 → 俱乐部：与自动钩子同口径（队名=clubs.name，同名缓存）；CPU 队整队无归属，不进 clubs 查询 */
async function resolveEntrySide(db: D1Database, teamName: string | null, cache: Map<string, number | null>): Promise<EntrySide> {
  if (isCpuTeam(teamName)) return { clubId: null, isCpu: true };
  if (!teamName) return { clubId: null, isCpu: false };
  let clubId = cache.get(teamName);
  if (clubId === undefined) {
    const row = await db.prepare('SELECT id FROM clubs WHERE name = ?').bind(teamName).first<{ id: number }>();
    clubId = row?.id ?? null;
    cache.set(teamName, clubId);
  }
  return { clubId, isCpu: false };
}

// v6.51.9 提速（列表/面板）：clubs 全表就 20 行级，一次取回建表，队名解析全走内存——
// 原来是「按场次逐队 SELECT id FROM clubs WHERE name = ?」（列表 20 场就 20+ 趟往返）。
// 保留 resolveEntrySide 给单场调用方（OCR 端点按需查一次）；列表/面板改用下面这两个。
const clubIdMapOf = (rows: { id: number; name: string }[]): Map<string, number> => new Map(rows.map((r) => [r.name, r.id] as const));

/** 归属解析（内存表版）：CPU 队/空名短路与 resolveEntrySide 同口径，查不到留 null */
function entrySideOf(teamName: string | null, clubIds: Map<string, number>): EntrySide {
  if (isCpuTeam(teamName)) return { clubId: null, isCpu: true };
  if (!teamName) return { clubId: null, isCpu: false };
  return { clubId: clubIds.get(teamName) ?? null, isCpu: false };
}

// 列表行与面板 match 块共用同一份 DTO（面板就是列表行 + 两侧花名册 + 已录事件）
// v6.45.0：tournamentName 供录入台按赛事分组（名字在赛事库，第二趟查，见 loadTournamentNames）
function entryMatchItem(row: MatchEntryRow, home: EntrySide, away: EntrySide, recorded: number, tournamentName: string | null) {
  return {
    matchId: row.match_id,
    season: row.season,
    windowSeq: row.window_seq,
    competitionType: row.competition_type,
    stageName: row.stage_name,
    stageKind: row.stage_kind,
    round: row.round,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    scoreHome: row.score_home,
    scoreAway: row.score_away,
    finishedAt: row.finished_at,
    confirmedAt: row.confirmed_at,
    tournamentId: row.tournament_id,
    tournamentName,
    /** v6.46.0：本场是否计 XP（前端据此提示「只能录出场与评分」） */
    xpEligible: xpEligibleOf(row),
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    homeIsCpu: home.isCpu,
    awayIsCpu: away.isCpu,
    recorded,
  };
}

// 赛事名（跨库取名）v6.46.0 抽到 src/worker/tournament-names.ts —— 录入台按赛事分组与球员页「比赛」页签共用一份

// 可补录比赛列表：全部可计 XP 的已确认场次（确认时间倒序），每场带已录事件数。
// v6.45.1：去掉 v6.45.0 的 LIMIT 50——线上可录场次已到 100 场，截断会让老场次彻底看不见（前端按赛事/轮次分组展示）。
// v6.51.9：主查询与 clubs 全表互不依赖 ⇒ 并发取，队名解析改内存查表（原为逐场逐队 SELECT）；
// 赛事名（跨库）仍要等主查询拿到 tournament_id，故单独一趟。SQL 与排序逐字未改。
app.get('/growth/match-entry', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const [rows, clubRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${MATCH_ENTRY_COLUMNS},
              (SELECT COUNT(*) FROM growth_events ge WHERE ge.match_ref = CAST(rc.match_id AS TEXT)) AS recorded
       FROM result_confirmations rc
       WHERE ${MATCH_ENTRY_WHERE}
       ORDER BY rc.confirmed_at DESC, rc.match_id DESC`,
    ).all<MatchEntryRow>(),
    c.env.DB.prepare('SELECT id, name FROM clubs').all<{ id: number; name: string }>(),
  ]);
  const clubIds = clubIdMapOf(clubRows.results);
  const names = await loadTournamentNames(c.env, rows.results.map((r) => r.tournament_id));
  const matches = rows.results.map((row) =>
    entryMatchItem(
      row,
      entrySideOf(row.home_team, clubIds),
      entrySideOf(row.away_team, clubIds),
      row.recorded ?? 0,
      tournamentNameOf(names, row.tournament_id),
    ),
  );
  return c.json({ matches });
});

// 单场面板：两侧花名册（在册口径 = normal/listed/trainee；free 已离队不出）+ 该场已录事件预填
app.get('/growth/match-entry/:matchId', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const matchId = Number(c.req.param('matchId'));
  if (!Number.isInteger(matchId) || matchId <= 0) throw new HttpError(404, '这场比赛不在可补录名单里（未确认或弃权场次）');

  // v6.51.9 提速：原实现八段串行（场次行 → 两队归属 → 赛事名 → 停赛复算 → 已录事件 → 主队花名册 →
  // 客队花名册 → 累计基数，线上实测约 17 趟往返），现按依赖并成三段：
  //   ① 场次行 ∥ clubs 全表 ∥ 已录事件 ∥ 停赛复算（赛事库，内部也已并行）
  //   ② 赛事名 ∥ 两侧花名册（一次 batch）  ③ 累计基数（依赖花名册 id）
  // SQL 逐字未改（含 ROSTER_POSITION_CASE 排序与在册口径），只有取的顺序变了。
  const [row, recorded, clubRows, suspended] = await Promise.all([
    loadEntryMatch(c.env.DB, matchId),
    c.env.DB.prepare('SELECT player_id, event_type, value, xp, source FROM growth_events WHERE match_ref = ? ORDER BY player_id, id')
      .bind(String(matchId))
      .all<{ player_id: number; event_type: string; value: number; xp: number; source: string }>(),
    c.env.DB.prepare('SELECT id, name FROM clubs').all<{ id: number; name: string }>(),
    // v6.45.0：本场停赛（只读 TOUR_DB 按赛事仓同口径复算，见 tour-suspension.ts）→ 面板标红禁行、
    // 写端点整行拒收。判不了停赛的球员（本库 fc_id 为空）不锁。
    suspendedPlayersAtMatch(c.env.TOUR_DB, matchId),
  ]);
  if (!row) throw new HttpError(404, '这场比赛不在可补录名单里（未确认或弃权场次）');

  const clubIds = clubIdMapOf(clubRows.results);
  const home = entrySideOf(row.home_team, clubIds);
  const away = entrySideOf(row.away_team, clubIds);

  // 两侧花名册一次 batch 取回：CPU 侧（clubId=null）绑 -1 走索引空集，与原来「不查、回空表」等价，
  // 换来语句位置恒定（结果按 [主, 客] 下标对齐，不用另算游标）
  const rosterStmt = (clubId: number | null) =>
    c.env.DB.prepare(
      `SELECT id, name, display_name, position, status, fc_id, growable FROM players
       WHERE club_id = ? AND status IN ('normal', 'listed', 'trainee')
       ORDER BY ${ROSTER_POSITION_CASE}, players.id`,
    ).bind(clubId ?? -1);
  const [names, rosters] = await Promise.all([
    loadTournamentNames(c.env, [row.tournament_id]),
    c.env.DB.batch([rosterStmt(home.clubId), rosterStmt(away.clubId)]),
  ]);
  const rosterRows = (run: { results?: unknown[] } | undefined) =>
    ((run?.results ?? []) as EntryPlayerRow[]).map((p) => ({
      id: p.id,
      name: rowDisplayName(p),
      officialName: p.name,
      position: p.position,
      status: p.status,
      // v6.52.0：面板据此标「非成长 · 不计 XP」；漏这个字段会让整队被前端当非成长（undefined ⇒ false）
      growable: p.growable === 1,
      suspended: p.fc_id == null ? null : suspended.get(p.fc_id) ?? null,
    }));

  // 每人当前累计（duels/saves 跨场累计的基数）：前端预填与「本场 XP」实时跨档预览用
  const homePlayers = rosterRows(rosters[0]);
  const awayPlayers = rosterRows(rosters[1]);
  const totals = await loadCumulativeBases(c.env.DB, [...homePlayers, ...awayPlayers].map((p) => p.id));
  const withTotals = <T extends { id: number }>(players: T[]) =>
    players.map((p) => ({ ...p, duelsTotal: totals.get(`${p.id}|duels_won`) ?? 0, savesTotal: totals.get(`${p.id}|saves`) ?? 0 }));

  return c.json({
    match: entryMatchItem(row, home, away, recorded.results.length, tournamentNameOf(names, row.tournament_id)),
    sides: {
      home: { clubId: home.clubId, isCpu: home.isCpu, players: withTotals(homePlayers) },
      away: { clubId: away.clubId, isCpu: away.isCpu, players: withTotals(awayPlayers) },
    },
    recorded: recorded.results.map((r) => ({ playerId: r.player_id, eventType: r.event_type, value: r.value, xp: r.xp, source: r.source })),
  });
});

// v6.43.0：赛后截图识别（零 DB 写，管理端手动触发）。一张图一次调用：
// 视觉模型 → parseOcrVision → 队名对侧 → 花名册认人 → 预填草稿 + 交叉校验警告。
// 失败可重试、可完全绕过（识别是增强不是依赖，预填后仍走下方批量端点人工确认入库）。
// v6.51.13：解析按图片内容哈希缓存 10 分钟 ⇒ 同一张图（选边续跑、重复上传）只调一次视觉模型。
const OCR_PROMPT = `你是 FC26 赛后「Player Performance」截图识别引擎。只输出一个 JSON 对象：禁止 markdown 代码块、禁止任何解释文字；图中没有或看不清的字段输出 null，绝不编造、绝不推算。

界面固定布局：左侧球员表格，列依次为 POS（位置缩写）、Name、RR（评分，N/A=替补没上场）、G（进球）、AST（助攻）；右侧选中球员详情区，页签 Summary / Possession / Shooting / Passing / Defending / Goalkeeping；画面顶部的 FPS/CPU/GPU 监控条是录屏软件干扰，一律忽略。

左表在两个业务页签下都会出现：Summary 页签下往往显示不完整个队（带滚动条）；Goalkeeping 页签下通常列出更多球员（含 Summary 页没露出的后卫与替补）。无论当前是哪个页签，rows 都要转录左表可见的全部行，一行不许丢；门将本人也在左表里，他的 RR 就是评分。

输出结构（键名逐字一致；下面的示例值就是应输出的类型——数字字段输出 JSON number，禁止加引号变字符串）：
{
  "team": "切尔西",
  "teamRaw": "CHELSEA",
  "tab": "summary",
  "rows": [
    { "pos": "ST", "name": "H. Kane", "rating": 7.8, "goals": 2, "assists": 0 },
    { "pos": "SUB", "name": "D. Alaba", "rating": null, "goals": 0, "assists": 0 }
  ],
  "selected": {
    "name": "H. Kane",
    "rating": 7.8,
    "goals": 2, "assists": 2,
    "possessionWon": 3, "minutes": 94
  },
  "gk": {
    "name": "M. Maignan",
    "gkRating": 4.0, "shotsAgainst": 10, "shotsOnTarget": 7,
    "saves": 3, "goalsConceded": 4
  },
  "notes": ""
}
team 字段写该队的中文名（CHELSEA → 切尔西、FIORENTINA → 佛罗伦萨、FC BAYERN MÜNCHEN → 拜仁慕尼黑、RB LEIPZIG → RB莱比锡、REAL BETIS → 皇家贝蒂斯）；没有通行中文译名时才照抄截图上的原文。
teamRaw 字段照抄截图上该队队名的原文（逐字复制，不翻译、不改大小写；看不清就填 null）——它只用来给用户核对传图对不对，别拿它替换 team。

规则：
1. rows 输出左表可见的行，按图内顺序；表格带滚动条时，滚动条外的行绝不编造。
2. 每行必须包含全部五个键：替补（SUB）行 rating 填 null，goals/assists 填 0。
3. tab=summary 时填 selected、gk 置 null；tab=goalkeeping 时填 gk、selected 置 null；其它页签两者都置 null。rows 与页签无关，任何页签都要完整输出。
4. 详情区每个指标都有两列数字：左列是球员本人，右列是全队平均；一律取左列。
5. rating/gkRating 是一位小数（如 7.8）；goals/assists 及 gk 各项是整数；数字字段一律输出 JSON number（7.8 而不是 "7.8"），只有 pos/name/team/teamRaw/tab/notes 是字符串。
6. 所有数字严格按图，不做任何推算。
7. 自检：goalkeeping 页签必须满足 Saves + Goals Conceded = Shots On Target；读到的数若不满足，先重读一遍图；重读后仍不满足就照实输出并在 notes 说明——绝不为了凑等式改数字。`;

const OCR_MAX_BYTES = 5 * 1024 * 1024; // 与媒体上传同一口径

/** base64 → 规范化 base64 + 嗅探魔数；只认 PNG/JPEG（防 MIME 伪装），超 5MB 拒。 */
function decodeOcrImage(b64: string): { mime: 'image/png' | 'image/jpeg'; base64: string } {
  const compact = b64.replace(/^data:(image\/(?:png|jpeg));base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) throw new HttpError(400, 'image 不是合法 base64');
  const buffer = Uint8Array.from(atob(compact), (ch) => ch.charCodeAt(0));
  if (buffer.byteLength === 0) throw new HttpError(400, 'image 解码后是空的');
  if (buffer.byteLength > OCR_MAX_BYTES) throw new HttpError(400, '图片超过 5MB 上限');
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  if (!png && !jpeg) throw new HttpError(400, '只支持 PNG 或 JPEG 截图');
  return { mime: png ? 'image/png' : 'image/jpeg', base64: compact };
}

// v6.51.13：解析缓存 —— 治「选边 = 再调一次视觉模型」（选边续跑与同图重传都命中同一份）。
// 键 = 图片内容（规范化 base64）的哈希，值 = 模型的**原始解析**；队侧、花名册与预填每次现算，
// 所以换边、甚至换一场比赛复用同一份解析都安全（缓存里绝不放 entries，避免 playerId 被固化）。
// 只缓存「页签合法」的结果：坏结果不缓存，用户重试仍会重新打模型（保住今天的重试语义）。
const OCR_CACHE_TTL_SEC = 600; // 10 分钟：够用户点按钮或刷新一次，过夜自动清

async function readOcrCache(env: Env, key: string): Promise<unknown | null> {
  try {
    const raw = await env.SESSION_KV.get(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null; // 缓存是增强不是依赖：读失败/坏 JSON 一律当未命中
  }
}

async function writeOcrCache(env: Env, key: string, parsed: unknown): Promise<void> {
  try {
    await env.SESSION_KV.put(key, JSON.stringify(parsed), { expirationTtl: OCR_CACHE_TTL_SEC });
  } catch {
    /* 写失败退化成「每次都调模型」的旧行为，不影响本次响应 */
  }
}

app.post('/growth/match-entry/:matchId/ocr', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const matchId = Number(c.req.param('matchId'));
  const row = Number.isInteger(matchId) && matchId > 0 ? await loadEntryMatch(c.env.DB, matchId) : null;
  if (!row) throw new HttpError(404, '这场比赛不在可补录名单里（未确认或弃权场次）');

  const body = (await readJson(c)) as { image?: unknown; side?: unknown } | null;
  if (typeof body?.image !== 'string' || body.image === '') throw new HttpError(400, '缺 image（截图的 base64）');
  // v6.51.3：歧义时前端从提示里带 side 重发同一张图 —— 用户直接指定主客，不再走队名匹配
  if (body.side !== undefined && body.side !== 'home' && body.side !== 'away')
    throw new HttpError(400, 'side 只能是 home 或 away（省略则按截图队名自动判断）');
  const forcedSide: 'home' | 'away' | null = body.side === 'home' || body.side === 'away' ? body.side : null;
  const image = decodeOcrImage(body.image);

  // v6.51.13：同一张图的解析只发生一次 —— 歧义/对不上时前端带 side 重发同一张图（v6.51.3/v6.51.8），
  // 以及用户重复上传同一张图，都命中缓存，不再重复调视觉模型。
  const cacheKey = `ocr:${await sha256Hex(image.base64)}`;
  const cachedParsed = await readOcrCache(c.env, cacheKey);
  // 视觉调用（未配置 503 / 失败 502 都由 llmVisionJson 抛）
  const parsed =
    cachedParsed !== null ? (cachedParsed as { notes?: unknown }) : await llmVisionJson<{ notes?: unknown }>(c.env, image, OCR_PROMPT);
  const { ocr, errors } = parseOcrVision(parsed);
  // 页签由模型识别结果决定（前端一个入口多选上传，不再由请求指定）；只认两张业务页签
  if (!ocr || (ocr.tab !== 'summary' && ocr.tab !== 'goalkeeping')) {
    throw new HttpError(502, `识别结果${ocr?.tab ? `是 ${ocr.tab} 页签，只认外场 Summary 与门将 Goalkeeping` : '不可解析'}，请重试${errors.length ? `（${errors[0]}）` : ''}`);
  }
  if (cachedParsed === null) await writeOcrCache(c.env, cacheKey, parsed);
  const kind: 'summary' | 'goalkeeping' = ocr.tab;

  // 截图队名 → 本场两侧（v6.51.3：提示词要求模型给中文队名；比对见 core/growth-ocr 的 matchOcrTeamSide，
  // 归一化等值/包含之外还容忍俱乐部前后缀与 CPU 尾标的漂移）；CPU 队名一样能对上（认人靠花名册，CPU 侧花名册为空）
  // v6.51.3 起两侧一样像（同城同名片段，如「慕尼黑」对拜仁慕尼黑与慕尼黑1860）判歧义、不默认主队：
  // 回 code=ocr_team_ambiguous，前端拿这条文案（里面有 teamRaw 原文）显示提示 + 主队/客队/取消三颗按钮。
  // v6.51.8：**对不上（含模型给英文名，如 OLYMPIACOS FC 对 奥林匹亚科斯）同样回可选的 code**——
  // 队名认不出不代表这张图的评分不能用，让用户点按钮选边即可；两条路的按钮与续跑方式完全一样。
  // 提示优先给模型照抄的截图原文，中文识别结果括注在后 —— 英文原文才是用户核对「传错图没」的锚点
  const shownTeam = ocr.teamRaw ?? ocr.team ?? '未识别';
  const shownZh = ocr.teamRaw && ocr.team && ocr.team !== ocr.teamRaw ? `（识别为「${ocr.team}」）` : '';
  // 英文兜底的分侧依据（v6.51.8）：本场两侧的俱乐部号只查这一次，下面选边/取花名册共用同一份缓存
  const clubCache = new Map<string, number | null>();
  const homeClub = await resolveEntrySide(c.env.DB, row.home_team, clubCache);
  const awayClub = await resolveEntrySide(c.env.DB, row.away_team, clubCache);
  let matched = forcedSide ?? matchOcrTeamSide(ocr.team, row.home_team, row.away_team);
  // v6.51.8 英文兜底：模型没给中文译名（照抄截图英文，OLYMPIACOS FC 这类冷门队最明显）时，
  // 用英文原文查 FC26 队号（core/growth-ocr 的 fc26TeamIdOfName），再与本场两侧 clubId（= FC26 队号）对齐；
  // 只在中文比对落空/歧义时兜底（中文命中优先，免得两个来源互相打架），两边都不中就照旧让用户点按钮
  if (matched === null || matched === 'ambiguous') {
    const refId = fc26TeamIdOfName(ocr.teamRaw ?? ocr.team);
    if (refId !== null && refId === homeClub.clubId) matched = 'home';
    else if (refId !== null && refId === awayClub.clubId) matched = 'away';
  }
  if (matched === 'ambiguous') {
    throw new HttpError(
      400,
      `截图队名「${shownTeam}」${shownZh}这场两侧都像（${row.home_team ?? '?'} vs ${row.away_team ?? '?'}），分不清主客——请点按钮选边，或换一张队名更完整的截图`,
      'ocr_team_ambiguous',
    );
  }
  if (!matched)
    throw new HttpError(
      400,
      `截图队名「${shownTeam}」${shownZh}对不上这场比赛（${row.home_team ?? '?'} vs ${row.away_team ?? '?'}）——确实是这张图的队名，就点按钮选边；传错图请点取消`,
      'ocr_team_unmatched',
    );
  const side: 'home' | 'away' = matched;

  const resolved = side === 'home' ? homeClub : awayClub;
  const roster: OcrRosterPlayer[] =
    resolved.clubId === null
      ? []
      : (
          await c.env.DB.prepare(
            `SELECT id, name, display_name, position FROM players WHERE club_id = ? AND status IN ('normal', 'listed', 'trainee')`,
          )
            .bind(resolved.clubId)
            .all<{ id: number; name: string; display_name: string | null; position: string | null }>()
        ).results.map((p) => ({ id: p.id, officialName: p.name, displayName: rowDisplayName(p), position: p.position }));

  const built = buildOcrEntries(ocr, roster);
  const crossWarnings =
    row.score_home === null || row.score_away === null ? [] : ocrCrossChecks(ocr, { side, scoreHome: row.score_home, scoreAway: row.score_away });
  const warnings = [...errors, ...built.warnings, ...crossWarnings];
  if (typeof parsed.notes === 'string' && parsed.notes.trim() !== '') warnings.push(`模型备注：${parsed.notes.trim()}`);

  return c.json({
    team: ocr.team,
    side,
    kind,
    entries: built.entries,
    unmatched: built.unmatched,
    warnings,
  });
});

// 批量补录：entries 展开成事件流（每项一条），全部校验前置，事件 + 恰好一条审计进同一个 batch。
// 同锚（球员 × 赛事 × 事件类型）已存在时的三种走法（v6.45.1）：
//  · 值相同 → no-op；
//  · 来源 manual → 改值：更新原行 + 重放该球员该类型的 XP 链，差额一次加进 players.growth_xp；
//  · 来源 auto（赛果同步）→ 值不同即 400（整批零写入），赛果定的值录入台不许改。
// 新值走 growth_events 的 UNIQUE(player_id, match_ref, event_type) + recordGrowthEventStatements 的
// NOT EXISTS 闸（幂等不进账），XP 不会重复加。
app.post('/growth/match-entry/:matchId', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const matchId = Number(c.req.param('matchId'));
  const row = Number.isInteger(matchId) && matchId > 0 ? await loadEntryMatch(c.env.DB, matchId) : null;
  if (!row) throw new HttpError(404, '这场比赛不在可补录名单里（未确认或弃权场次）');

  const body = (await readJson(c)) as { entries?: unknown } | null;
  const entries = body?.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new HttpError(400, 'entries 要是非空数组');
  // 上限 50 行（一侧花名册 ~25 人绰绰有余）：既保 IN 点查绑参数量在 D1 每查 100 参数之内，
  // 也把单批语句量（行数×5 项×2 条 + 审计）钉在安全区间。
  if (entries.length > 50) throw new HttpError(400, '一次最多补录 50 行，分两侧提交');

  const cache = new Map<string, number | null>();
  const home = await resolveEntrySide(c.env.DB, row.home_team, cache);
  const away = await resolveEntrySide(c.env.DB, row.away_team, cache);
  const clubIds = [home.clubId, away.clubId].filter((v): v is number => v !== null);
  if (clubIds.length === 0) throw new HttpError(400, '这场比赛两队都没在平台建档，先建档再补录');

  // ---- 全量校验（任何一条不过整批 400，零写入零审计）----
  const parsed = entries.map((raw) => {
    if (typeof raw !== 'object' || raw === null) throw new HttpError(400, '每一行要是对象');
    const entry = raw as Record<string, unknown>;
    if (!BATCH_ENTRY_FIELDS.some((f) => entry[f] !== undefined && entry[f] !== null)) throw new HttpError(400, '每一行至少要填一项');
    const playerId = Number(entry.playerId);
    if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
    return { playerId, entry };
  });
  const ids = [...new Set(parsed.map((p) => p.playerId))];
  const rows = await c.env.DB.prepare(
    `SELECT id, name, display_name, club_id, position, status, fc_id, growable FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
  )
    .bind(...ids)
    .all<EntryPlayerRow>();
  const players = new Map<number, EntryPlayerRow>(rows.results.map((r) => [r.id, r] as const));
  // v6.45.0：本场停赛球员不能录成长（同场判定见 tour-suspension.ts）——整行拒绝而不是静默跳过，
  // 静默跳过会让管理组以为录上了。判不了停赛的球员（本库 fc_id 为空）放行。
  const suspended = await suspendedPlayersAtMatch(c.env.TOUR_DB, matchId);
  for (const { playerId } of parsed) {
    const p = players.get(playerId);
    if (!p || p.club_id === null || !clubIds.includes(p.club_id)) throw new HttpError(400, '这名球员不属于该场两队');
    const s = p.fc_id == null ? undefined : suspended.get(p.fc_id);
    if (s) throw new HttpError(400, `${rowDisplayName(p)} 本场停赛（${suspensionLabel(s)}），不能录成长`);
  }

  // v6.46.0：本场不计 XP（杯赛淘汰赛 / 超级杯 / 资格赛）时只收「出场 + 评分」——零封、夺回球权、
  // 扑救是纯 XP 计数器（补录台之外没有展示价值），收下只会把 XP 灌进不该给 XP 的赛事，
  // 还会顶起 duels_won / saves 的跨场累计档位。整批一次判，任何一行越界即整批 400（零写入）。
  const xpEligible = xpEligibleOf(row);
  if (!xpEligible) {
    for (const { playerId, entry } of parsed) {
      const bad =
        entry.cleanSheet === true
          ? '零封'
          : entry.duelsWon !== undefined && entry.duelsWon !== null
            ? '夺回球权'
            : entry.saves !== undefined && entry.saves !== null
              ? '扑救'
              : null;
      if (bad === null) continue;
      const name = rowDisplayName(players.get(playerId) as EntryPlayerRow);
      throw new HttpError(400, `本场不计成长 XP，${name} 的${bad}录不了，只能录出场与评分`);
    }
  }

  // 展开事件流：字段顺序固定，方便前端按事件类型锁定格子；非 XP 场次一律 xp=0（值照录）。
  // v6.52.0：非成长球员（growable !== 1）同样事件照写、XP 归零——必须在构造 events 时就归零，
  // 响应 totalXp / 逐行 xp 与审计 detail 都取构造值（只在 SQL 里归零会虚报入账）。
  const events: { playerId: number; eventType: GrowthEventType; value: number; xp: number }[] = [];
  const bases = await loadCumulativeBases(c.env.DB, ids);
  for (const { playerId, entry } of parsed) {
    const xpOn = xpEligible && players.get(playerId)?.growable === 1;
    if (entry.appearance) events.push({ playerId, eventType: 'appearance', value: 1, xp: xpOn ? xpForEvent('appearance', 1) : 0 });
    if (entry.cleanSheet) events.push({ playerId, eventType: 'clean_sheet', value: 1, xp: xpOn ? xpForEvent('clean_sheet', 1) : 0 });
    if (entry.rating !== undefined && entry.rating !== null) events.push({ playerId, eventType: 'rating', ...manualEventOf('rating', entry.rating, 0, xpOn) });
    if (entry.duelsWon !== undefined && entry.duelsWon !== null)
      events.push({ playerId, eventType: 'duels_won', ...manualEventOf('duels_won', entry.duelsWon, bases.get(`${playerId}|duels_won`) ?? 0, xpOn) });
    if (entry.saves !== undefined && entry.saves !== null)
      events.push({ playerId, eventType: 'saves', ...manualEventOf('saves', entry.saves, bases.get(`${playerId}|saves`) ?? 0, xpOn) });
  }
  if (events.length === 0) throw new HttpError(400, '每一行都没有勾上要记的项目');

  const matchRef = String(matchId);
  const season = await getVisibleSeason(c.env.DB);

  // 审计的 after 要在一批里写死，所以先读一次本场已有的行（去重锚 = 球员 × 赛事 × 事件类型，
  // 另带 id/value/xp/source 供改值判定用）；同一批里同锚出现两次时，第二次也算 duplicate。
  // 已知边界：锚预读与 batch 执行之间若另一请求插了同锚，after 的计数会比实际多计一格
  // （响应里的 written/updated/duplicates 用批后 meta.changes 实数，不受影响；库里状态恒正确）。
  const existing = await c.env.DB.prepare('SELECT id, player_id, event_type, value, xp, source FROM growth_events WHERE match_ref = ?')
    .bind(matchRef)
    .all<ExistingEventRow>();
  const existingByAnchor = new Map<string, ExistingEventRow>(existing.results.map((r) => [`${r.player_id}|${r.event_type}`, r]));

  // 赛果同步的值不许在录入台改：值不同即整批 400（与停赛拦截同风格——静默跳过会让管理组
  // 以为改上了）。值相同（例如重复提交同一场零封）不算越界，照旧按 no-op 走。
  for (const e of events) {
    const found = existingByAnchor.get(`${e.playerId}|${e.eventType}`);
    if (!found || found.source === 'manual' || found.value === e.value) continue;
    const name = rowDisplayName(players.get(e.playerId) as EntryPlayerRow);
    throw new HttpError(400, `${name} 的${EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}由赛果确定，不能在录入台修改`);
  }

  const statements: D1PreparedStatement[] = [];
  const detail: {
    playerId: number;
    name: string;
    eventType: string;
    value: number;
    xp: number;
    kind: 'insert' | 'update' | 'noop';
    previousValue?: number;
  }[] = [];
  // 每个事件对应的「信号语句」在 batch 里的下标：insert = 那条 INSERT、update = 那条改值 UPDATE、
  // noop = -1；deltaXp = 这次实际进账的 XP（改小累计值会回收，可为负）。计数一律看批后 changes。
  const signals: { kind: 'insert' | 'update' | 'noop'; index: number; deltaXp: number }[] = [];
  let expectedWritten = 0;
  let expectedUpdated = 0;
  const planned = new Set<string>();
  for (const e of events) {
    const anchor = `${e.playerId}|${e.eventType}`;
    const name = rowDisplayName(players.get(e.playerId) as EntryPlayerRow);
    const found = existingByAnchor.get(anchor);
    const line = { playerId: e.playerId, name, eventType: e.eventType, value: e.value, xp: e.xp };
    if (planned.has(anchor)) {
      signals.push({ kind: 'noop', index: -1, deltaXp: 0 });
      detail.push({ ...line, kind: 'noop' });
      continue;
    }
    planned.add(anchor);
    if (found !== undefined && (found.value === e.value || found.source !== 'manual')) {
      signals.push({ kind: 'noop', index: -1, deltaXp: 0 });
      detail.push({ ...line, kind: 'noop', previousValue: found.value });
      continue;
    }
    if (!found) {
      expectedWritten += 1;
      const at = statements.length;
      statements.push(
        ...recordGrowthEventStatements(c.env.DB, {
          playerId: e.playerId,
          matchRef,
          season,
          windowSeq: null,
          eventType: e.eventType,
          value: e.value,
          xp: e.xp,
          source: 'manual',
          recordedBy: user.id,
        }),
      );
      signals.push({ kind: 'insert', index: at + 1, deltaXp: e.xp });
      detail.push({ ...line, kind: 'insert' });
      continue;
    }
    // 改值：原行换值换 XP（recorded_by 记这次是谁改的），并把该球员该类型的 XP 链按录入顺序重放，
    // 链上其他行受影响的 XP 一并改，差额一次加进 players.growth_xp。
    // v6.52.0：当前非成长球员跳过重放——只改 value / recorded_by，被改行保持它现有的 xp
    // （原本 0 的仍为 0；成长期录下的历史 XP 不抹掉），链上其他行不动、growth_xp 不变（delta=0）。
    if (players.get(e.playerId)?.growable !== 1) {
      expectedUpdated += 1;
      const at = statements.length;
      statements.push(c.env.DB.prepare('UPDATE growth_events SET value = ?, recorded_by = ? WHERE id = ?').bind(e.value, user.id, found.id));
      signals.push({ kind: 'update', index: at, deltaXp: 0 });
      detail.push({ ...line, xp: found.xp, kind: 'update', previousValue: found.value });
      continue;
    }
    const replay = await replayEventChain(c.env.DB, e.playerId, e.eventType, { id: found.id, value: e.value });
    if (replay === null) {
      signals.push({ kind: 'noop', index: -1, deltaXp: 0 });
      detail.push({ ...line, kind: 'noop', previousValue: found.value });
      continue;
    }
    expectedUpdated += 1;
    const at = statements.length;
    statements.push(c.env.DB.prepare('UPDATE growth_events SET value = ?, xp = ?, recorded_by = ? WHERE id = ?').bind(e.value, replay.xp, user.id, found.id));
    for (const x of replay.extra) statements.push(c.env.DB.prepare('UPDATE growth_events SET xp = ? WHERE id = ?').bind(x.xp, x.id));
    if (replay.delta !== 0) {
      // 兜底：与主闸同口径——目标球员在批执行前被改成非成长时不改 XP
      statements.push(
        c.env.DB.prepare(`UPDATE players SET growth_xp = growth_xp + ?, updated_at = ${nowSql()} WHERE id = ? AND COALESCE(growable, 0) = 1`).bind(
          replay.delta,
          e.playerId,
        ),
      );
    }
    signals.push({ kind: 'update', index: at, deltaXp: replay.delta });
    detail.push({ ...line, xp: replay.xp, kind: 'update', previousValue: found.value });
  }
  const results = await c.env.DB.batch([
    ...statements,
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_manual_event_batch',
      targetType: 'match',
      targetId: matchId,
      origin: 'user',
      after: {
        matchId,
        written: expectedWritten,
        updated: expectedUpdated,
        duplicates: detail.length - expectedWritten - expectedUpdated,
        entries: detail,
      },
    }),
  ]);

  // 计数以实际 changes 为准（信号语句命中才算落库）
  const perPlayerMap = new Map<number, { playerId: number; name: string; xp: number; written: number; updated: number; duplicates: number }>();
  let written = 0;
  let updated = 0;
  let duplicates = 0;
  let totalXp = 0;
  events.forEach((e, i) => {
    const sig = signals[i];
    const applied = sig.index >= 0 && (results[sig.index]?.meta.changes ?? 0) === 1;
    const bucket = perPlayerMap.get(e.playerId) ?? {
      playerId: e.playerId,
      name: rowDisplayName(players.get(e.playerId) as EntryPlayerRow),
      xp: 0,
      written: 0,
      updated: 0,
      duplicates: 0,
    };
    if (applied && sig.kind === 'insert') {
      written += 1;
      totalXp += e.xp;
      bucket.written += 1;
      bucket.xp += e.xp;
    } else if (applied && sig.kind === 'update') {
      updated += 1;
      totalXp += sig.deltaXp;
      bucket.updated += 1;
      bucket.xp += sig.deltaXp;
    } else {
      duplicates += 1;
      bucket.duplicates += 1;
    }
    perPlayerMap.set(e.playerId, bucket);
  });
  return c.json(
    { ok: true, written, updated, duplicates, totalXp, perPlayer: [...perPlayerMap.values()] },
    written > 0 || updated > 0 ? 201 : 200,
  );
});

export default app;
