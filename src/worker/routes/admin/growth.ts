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
import { nowSql, readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// 补录口径（单人与批量共用一份，防止两处漂移）：rating 7.0-10.0 且四舍五入到 0.1；
// duels_won/saves 正整数；XP 一律服务端按 §10.1 算，算出 0 XP 的项直接拒
// （duels_won 1-11、saves 1-7 都是 0 XP，同样拒）。
function manualEventOf(eventType: GrowthEventType, raw: unknown): { value: number; xp: number } {
  let value = raw === undefined || raw === null ? 1 : Number(raw);
  if (eventType === 'rating') {
    if (!Number.isFinite(value) || value < 7 || value > 10) throw new HttpError(400, '评分要在 7.0-10.0 之间，7.0 以下不给 XP');
    value = Math.round(value * 10) / 10;
  } else if (eventType === 'duels_won' || eventType === 'saves') {
    if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, '次数要是正整数');
  }
  const xp = xpForEvent(eventType, value);
  if (xp <= 0) throw new HttpError(400, '这个数值达不到记 XP 的标准');
  return { value, xp };
}

// 补录：评分/扑救/夺回球权等比赛系统没有的数据；XP 由服务端按 §10.1 计算
app.post('/growth/events', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown; matchRef?: unknown; eventType?: unknown; value?: unknown } | null;
  const playerId = Number(body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

  const eventType = body?.eventType;
  const MANUAL_TYPES = ['appearance', 'rating', 'clean_sheet', 'duels_won', 'saves'] as const;
  if (typeof eventType !== 'string' || !(MANUAL_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpError(400, 'event_type 只能是 appearance / rating / clean_sheet / duels_won / saves');
  }
  const { value, xp } = manualEventOf(eventType as GrowthEventType, body?.value);

  const matchRef = typeof body?.matchRef === 'string' && body.matchRef.trim() !== '' ? body.matchRef.trim().slice(0, 40) : `manual:${Date.now()}`;
  const recorded = await recordGrowthEvent(c.env.DB, {
    playerId,
    matchRef,
    season: await getVisibleSeason(c.env.DB),
    windowSeq: null,
    eventType: eventType as GrowthEventType,
    value,
    xp,
    source: 'manual',
    recordedBy: user.id,
  });
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'growth_manual_event',
    targetType: 'player',
    targetId: playerId,
    origin: 'user',
    after: { eventType, value, xp, matchRef, duplicate: !recorded },
  });
  return c.json({ ok: true, xp, duplicate: !recorded }, recorded ? 201 : 200);
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

// 档位核定（§10.3）：条件叠加由管理组按现实资料判断，平台只落核定结果与审计
app.post('/growth/:playerId/tier', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await readJson(c)) as { tier?: unknown } | null;
  const tier = Number(body?.tier);
  if (!Number.isInteger(tier) || tier < 1 || tier > 5) throw new HttpError(400, '档位只能是 1-5');
  const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(playerId).first<{ id: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE players SET growth_tier = ?, updated_at = ${nowSql()} WHERE id = ?`).bind(tier, playerId),
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_tier_set',
      targetType: 'player',
      targetId: playerId,
      origin: 'user',
      after: { tier },
    }),
  ]);
  return c.json({ ok: true, tier });
});

// ---- v6.16.0：按场次的花名册批量补录台（管理端三个端点）----
// 可计 XP 口径与自动钩子（results.ts recordAutoXpForMatch）同源，且刻意写成一份 SQL 片段：
// 联赛顶级/次级全阶段计 XP，冠军杯只计小组赛；弃权场不计 —— 自动通道根本没写过（甚至可以说
// 不该写），列出来补录也永远撞去重锚。列表/面板/批量三处引用同一个 WHERE，改口径只改这一行。
const MATCH_ENTRY_WHERE = `(rc.competition_type IN ('league_premier', 'league_second')
       OR (rc.competition_type = 'champions_cup' AND rc.stage_kind = 'group'))
     AND (rc.walkover_side IS NULL OR rc.walkover_side = '')`;

const MATCH_ENTRY_COLUMNS = `rc.match_id, rc.season, rc.window_seq, rc.competition_type, rc.stage_name, rc.stage_kind, rc.round,
     rc.home_team, rc.away_team, rc.score_home, rc.score_away, rc.finished_at, rc.confirmed_at`;

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
  recorded?: number;
}

interface EntryPlayerRow {
  id: number;
  name: string;
  display_name: string | null;
  club_id: number | null;
  position: string | null;
  status: string;
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

// 列表行与面板 match 块共用同一份 DTO（面板就是列表行 + 两侧花名册 + 已录事件）
function entryMatchItem(row: MatchEntryRow, home: EntrySide, away: EntrySide, recorded: number) {
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
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    homeIsCpu: home.isCpu,
    awayIsCpu: away.isCpu,
    recorded,
  };
}

// 可补录比赛列表：近 50 场（确认时间倒序），每场带已录事件数
app.get('/growth/match-entry', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const rows = await c.env.DB.prepare(
    `SELECT ${MATCH_ENTRY_COLUMNS},
            (SELECT COUNT(*) FROM growth_events ge WHERE ge.match_ref = CAST(rc.match_id AS TEXT)) AS recorded
     FROM result_confirmations rc
     WHERE ${MATCH_ENTRY_WHERE}
     ORDER BY rc.confirmed_at DESC, rc.match_id DESC
     LIMIT 50`,
  ).all<MatchEntryRow>();
  const cache = new Map<string, number | null>();
  const matches = [];
  for (const row of rows.results) {
    const home = await resolveEntrySide(c.env.DB, row.home_team, cache);
    const away = await resolveEntrySide(c.env.DB, row.away_team, cache);
    matches.push(entryMatchItem(row, home, away, row.recorded ?? 0));
  }
  return c.json({ matches });
});

// 单场面板：两侧花名册（在册口径 = normal/listed/trainee；free 已离队不出）+ 该场已录事件预填
app.get('/growth/match-entry/:matchId', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const matchId = Number(c.req.param('matchId'));
  const row = Number.isInteger(matchId) && matchId > 0 ? await loadEntryMatch(c.env.DB, matchId) : null;
  if (!row) throw new HttpError(404, '这场比赛不在可补录名单里（未确认、弃权或不是联赛/冠军杯小组赛）');

  const cache = new Map<string, number | null>();
  const home = await resolveEntrySide(c.env.DB, row.home_team, cache);
  const away = await resolveEntrySide(c.env.DB, row.away_team, cache);
  const rosterOf = async (clubId: number | null) => {
    if (clubId === null) return [];
    const rows = await c.env.DB.prepare(
      `SELECT id, name, display_name, position, status FROM players
       WHERE club_id = ? AND status IN ('normal', 'listed', 'trainee')
       ORDER BY ${ROSTER_POSITION_CASE}, players.id`,
    )
      .bind(clubId)
      .all<EntryPlayerRow>();
    return rows.results.map((p) => ({
      id: p.id,
      name: rowDisplayName(p),
      officialName: p.name,
      position: p.position,
      status: p.status,
    }));
  };
  const recorded = await c.env.DB.prepare(
    'SELECT player_id, event_type, value, xp, source FROM growth_events WHERE match_ref = ? ORDER BY player_id, id',
  )
    .bind(String(matchId))
    .all<{ player_id: number; event_type: string; value: number; xp: number; source: string }>();

  return c.json({
    match: entryMatchItem(row, home, away, recorded.results.length),
    sides: {
      home: { clubId: home.clubId, isCpu: home.isCpu, players: await rosterOf(home.clubId) },
      away: { clubId: away.clubId, isCpu: away.isCpu, players: await rosterOf(away.clubId) },
    },
    recorded: recorded.results.map((r) => ({ playerId: r.player_id, eventType: r.event_type, value: r.value, xp: r.xp, source: r.source })),
  });
});

// 批量补录：entries 展开成事件流（每项一条），全部校验前置，事件 + 恰好一条审计进同一个 batch。
// 同锚去重靠 growth_events 的 UNIQUE(player_id, match_ref, event_type) + recordGrowthEventStatements
// 的 NOT EXISTS 闸，重复提交是 no-op（written=0），XP 不会重复加。
app.post('/growth/match-entry/:matchId', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const matchId = Number(c.req.param('matchId'));
  const row = Number.isInteger(matchId) && matchId > 0 ? await loadEntryMatch(c.env.DB, matchId) : null;
  if (!row) throw new HttpError(404, '这场比赛不在可补录名单里（未确认、弃权或不是联赛/冠军杯小组赛）');

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
    `SELECT id, name, display_name, club_id, position, status FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`,
  )
    .bind(...ids)
    .all<EntryPlayerRow>();
  const players = new Map<number, EntryPlayerRow>(rows.results.map((r) => [r.id, r] as const));
  for (const { playerId } of parsed) {
    const p = players.get(playerId);
    if (!p || p.club_id === null || !clubIds.includes(p.club_id)) throw new HttpError(400, '这名球员不属于该场两队');
    // 训练营不按场次计 XP（走赛季结算）：整行拒绝而不是静默跳过——静默跳过会让管理组以为录上了
    if (p.status === 'trainee') throw new HttpError(400, `${rowDisplayName(p)} 在训练营，训练营不按场次记 XP，走赛季结算`);
  }

  // 展开事件流：字段顺序固定，方便前端按事件类型锁定格子
  const events: { playerId: number; eventType: GrowthEventType; value: number; xp: number }[] = [];
  for (const { playerId, entry } of parsed) {
    if (entry.appearance) events.push({ playerId, eventType: 'appearance', value: 1, xp: xpForEvent('appearance', 1) });
    if (entry.cleanSheet) events.push({ playerId, eventType: 'clean_sheet', value: 1, xp: xpForEvent('clean_sheet', 1) });
    if (entry.rating !== undefined && entry.rating !== null) events.push({ playerId, eventType: 'rating', ...manualEventOf('rating', entry.rating) });
    if (entry.duelsWon !== undefined && entry.duelsWon !== null) events.push({ playerId, eventType: 'duels_won', ...manualEventOf('duels_won', entry.duelsWon) });
    if (entry.saves !== undefined && entry.saves !== null) events.push({ playerId, eventType: 'saves', ...manualEventOf('saves', entry.saves) });
  }
  if (events.length === 0) throw new HttpError(400, '每一行都没有勾上要记的项目');

  const matchRef = String(matchId);
  const season = await getVisibleSeason(c.env.DB);

  // 审计的 after 要在一批里写死，所以先读一次本场已有的去重锚（同锚 = 球员 × 赛事 × 事件类型）；
  // 同一批里同锚出现两次时，第二次也是 duplicate（与批内 NOT EXISTS 闸的判定一致）。
  // 已知边界：锚预读与 batch 执行之间若另一请求插了同锚，after.written 会比实际多计一格
  // （响应里的 written/duplicates 用批后 meta.changes 实数，不受影响；库里状态恒正确）。
  const existing = await c.env.DB.prepare('SELECT player_id, event_type FROM growth_events WHERE match_ref = ?')
    .bind(matchRef)
    .all<{ player_id: number; event_type: string }>();
  const anchors = new Set(existing.results.map((r) => `${r.player_id}|${r.event_type}`));

  const statements: D1PreparedStatement[] = [];
  const detail: { playerId: number; name: string; eventType: string; value: number; xp: number; duplicate: boolean }[] = [];
  let expectedWritten = 0;
  for (const e of events) {
    const anchor = `${e.playerId}|${e.eventType}`;
    const duplicate = anchors.has(anchor);
    if (!duplicate) anchors.add(anchor);
    if (!duplicate) expectedWritten += 1;
    detail.push({
      playerId: e.playerId,
      name: rowDisplayName(players.get(e.playerId) as EntryPlayerRow),
      eventType: e.eventType,
      value: e.value,
      xp: e.xp,
      duplicate,
    });
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
  }
  const results = await c.env.DB.batch([
    ...statements,
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'growth_manual_event_batch',
      targetType: 'match',
      targetId: matchId,
      origin: 'user',
      after: { matchId, written: expectedWritten, duplicates: detail.length - expectedWritten, entries: detail },
    }),
  ]);

  // 计数以实际 changes 为准（每事件两条语句：偶数下标 = XP 是否已加、奇数下标 = 事件是否新入账）
  const perPlayerMap = new Map<number, { playerId: number; name: string; xp: number; written: number; duplicates: number }>();
  let written = 0;
  let duplicates = 0;
  let totalXp = 0;
  events.forEach((e, i) => {
    const inserted = (results[i * 2 + 1]?.meta.changes ?? 0) === 1;
    const bucket = perPlayerMap.get(e.playerId) ?? {
      playerId: e.playerId,
      name: rowDisplayName(players.get(e.playerId) as EntryPlayerRow),
      xp: 0,
      written: 0,
      duplicates: 0,
    };
    if (inserted) {
      written += 1;
      totalXp += e.xp;
      bucket.xp += e.xp;
      bucket.written += 1;
    } else {
      duplicates += 1;
      bucket.duplicates += 1;
    }
    perPlayerMap.set(e.playerId, bucket);
  });
  return c.json({ ok: true, written, duplicates, totalXp, perPlayer: [...perPlayerMap.values()] }, written > 0 ? 201 : 200);
});

export default app;
