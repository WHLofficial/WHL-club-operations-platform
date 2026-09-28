// 随机事件管理（v6.10.0，D 块）：触发 + 池只读启停 + 流水。
// 计划裁决：不做自定义事件编辑 / 改 JSON（池只允许启停），触发是管理端驱动的（没有玩家自助入口）。
// 事件不绑窗口：触发时把当前所处的 (赛季, 窗) 归档进 occurrence，缺省取开着的窗口，
// 两窗之间（赛季进行中）取可见赛季 + 窗号 0。
// v6.12.0（D3）：LLM 草稿工坊（管理端 only）——生成文案/结构草稿 → 独立草稿表审校 →
// 采纳才进 event_pool；LLM 只碰文案与创意，数值效果由 clampEventDraft 钳制（不进玩家请求路径）。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { llmChat, llmChatJson, llmConfigured } from '../../../lib/llm.ts';
import { getOpenWindow, getVisibleSeason } from '../../seasons.ts';
import { clampEventDraft, loadEventById, loadEventClamps, loadEventRules, loadEventSignals, loadWeatherKeys, triggerEventBatch, type EventDraftStruct } from '../../event-ops.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

const POOL_COLUMNS = `id, event_id, name, category, weight, event_type, conditions_json, effects_json,
                      options_json, soft_conditions, template, source, status, created_at`;

app.get('/events/pool', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const rows = (await c.env.DB.prepare(`SELECT ${POOL_COLUMNS} FROM event_pool ORDER BY id`).all()).results;
  return c.json({ events: rows });
});

// 只允许启停（池内容随版本走，管理端不改 JSON）
app.patch('/events/pool/:id', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '事件 id 不对');
  const body = (await readJson(c)) as { status?: unknown } | null;
  if (body?.status !== 'adopted' && body?.status !== 'discarded') throw new HttpError(400, 'status 只能是 adopted 或 discarded');
  const row = await c.env.DB
    .prepare('SELECT id, event_id, name, status FROM event_pool WHERE id = ?')
    .bind(id)
    .first<{ id: number; event_id: string; name: string; status: string }>();
  if (!row) throw new HttpError(404, '没有这个事件');
  await c.env.DB.prepare('UPDATE event_pool SET status = ? WHERE id = ?').bind(body.status, id).run();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'event_pool_update',
    targetType: 'event_pool',
    targetId: id,
    origin: 'user',
    before: { status: row.status },
    after: { status: body.status },
  });
  return c.json({ id, event_id: row.event_id, status: body.status });
});

/**
 * 触发一批随机事件。body 全空 = 按命中概率给所有队各掷一次；
 * clubIds / eventId 点名触发（绕过概率与条件）。season/windowSeq 缺省取当前开窗。
 */
app.post('/events/trigger', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const body = (await readJson(c)) as { clubIds?: unknown; eventId?: unknown; season?: unknown; windowSeq?: unknown } | null;

  const open = await getOpenWindow(c.env.DB);
  let season: number | null = open?.season ?? (await getVisibleSeason(c.env.DB));
  let windowSeq = open?.windowSeq ?? 0;
  if (body?.season !== undefined) {
    if (!Number.isInteger(body.season)) throw new HttpError(400, 'season 必须是整数');
    season = body.season as number;
  }
  if (body?.windowSeq !== undefined) {
    if (!Number.isInteger(body.windowSeq)) throw new HttpError(400, 'windowSeq 必须是整数');
    windowSeq = body.windowSeq as number;
  }
  if (season === null) throw new HttpError(409, '没有可见赛季，先开赛季再触发事件');

  let clubIds: number[] | undefined;
  if (body?.clubIds !== undefined) {
    if (!Array.isArray(body.clubIds)) throw new HttpError(400, 'clubIds 要给数组');
    clubIds = body.clubIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
    if (clubIds.length === 0) throw new HttpError(400, 'clubIds 里没有有效的俱乐部 id');
  }
  let eventId: string | undefined;
  if (body?.eventId !== undefined) {
    if (typeof body.eventId !== 'string' || body.eventId.trim() === '') throw new HttpError(400, 'eventId 要给事件标识');
    eventId = body.eventId.trim();
  }

  const result = await triggerEventBatch(c.env, { season, windowSeq, actor: user.id, origin: 'user', clubIds, eventId });
  return c.json({ season, windowSeq, ...result });
});

app.get('/events/occurrences', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const seasonRaw = c.req.query('season');
  let season: number | null;
  if (seasonRaw === undefined || seasonRaw === '') {
    season = await getVisibleSeason(c.env.DB);
  } else {
    const n = Number(seasonRaw);
    if (!Number.isInteger(n)) throw new HttpError(400, 'season 必须是整数');
    season = n;
  }
  // 空串（?limit=）按没给算，否则 Number('') = 0 会被钳成 1 条
  const limitParam = c.req.query('limit');
  const limitNum = limitParam === undefined || limitParam === '' ? 50 : Number(limitParam);
  const limit = Number.isInteger(limitNum) ? Math.min(200, Math.max(1, limitNum)) : 50;
  if (season === null) return c.json({ season: null, occurrences: [] });
  const rows = (
    await c.env.DB
      .prepare(
        `SELECT o.id, o.club_id, cl.name AS club_name, o.season, o.window_seq, o.event_id, o.event_name, o.event_type,
                o.status, o.effects_json, o.notes_json, o.choice_no, o.deadline_at, o.resolved_by, o.resolved_at, o.text, o.created_at
         FROM event_occurrences o LEFT JOIN clubs cl ON cl.id = o.club_id
         WHERE o.season = ? ORDER BY o.id DESC LIMIT ?`,
      )
      .bind(season, limit)
      .all()
  ).results;
  return c.json({ season, occurrences: rows });
});

// ---- LLM 草稿工坊（v6.12.0，D3；管理端 only）----

interface DraftRow {
  id: number;
  kind: string;
  payload_json: string;
  source_event_id: string | null;
  note: string;
  status: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

function draftView(row: DraftRow) {
  return { ...row, payload: JSON.parse(row.payload_json) as unknown };
}

/** LLM 生成事件文案 / 结构草稿，落 event_drafts（status=draft）；采纳前不进 event_pool。 */
app.post('/events/llm-draft', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const body = (await readJson(c)) as { kind?: unknown; eventId?: unknown; hint?: unknown } | null;
  if (body?.kind !== 'text' && body?.kind !== 'struct') throw new HttpError(400, 'kind 只能是 text（改文案）或 struct（新事件草稿）');
  const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, 500) : '';

  if (body.kind === 'text') {
    if (typeof body.eventId !== 'string' || body.eventId.trim() === '') throw new HttpError(400, 'text 草稿要给 eventId（改写对象）');
    const event = await loadEventById(c.env.DB, body.eventId.trim());
    if (event === null) throw new HttpError(404, '没有这个事件');
    const text = await llmChat(c.env, {
      system:
        '你是足球俱乐部经营游戏的文案写手。改写事件的播报文案：一两句话、不超过 80 字、有画面感。' +
        '禁止出现任何数字、金额、百分比（数值由系统另行结算公布）；可用 {team} 与 {stadium} 两个占位符。',
      user: `事件「${event.name}」（${event.category}）。现有文案：${event.template || '（无）'}。${hint ? `要求：${hint}` : '请给出一份新的改写。'}`,
      maxTokens: 300,
    });
    const payload = { template: text.slice(0, 120) };
    const res = await c.env.DB
      .prepare(
        `INSERT INTO event_drafts (kind, payload_json, source_event_id, note, status, created_by, created_at, updated_at)
         VALUES ('text', ?, ?, ?, 'draft', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .bind(JSON.stringify(payload), event.event_id, hint, user.id)
      .run();
    return c.json({ id: Number(res.meta.last_row_id ?? 0), kind: 'text', payload, adjustments: [] }, 201);
  }

  // struct：让模型按 schema 出 JSON，再过 clampEventDraft 钳制（LLM 的数字不可信，钳完才算数）
  const [rules, clamps, signalDefs, weatherKeys] = await Promise.all([
    loadEventRules(c.env.DB),
    loadEventClamps(c.env.DB),
    loadEventSignals(c.env.DB),
    loadWeatherKeys(c.env.DB),
  ]);
  const struct = await llmChatJson<unknown>(c.env, {
    system:
      '你是足球俱乐部经营游戏的事件策划。产出一条新事件的 JSON 草稿，字段：' +
      'event_id（小写蛇形）、name（≤20字）、category、weight(1-10)、event_type("instant"|"choice")、' +
      'conditions（可含 min_tier/max_tier/requires_naming/requires_activity 等）、' +
      'instant 型给 effects（money 单位 m，±8；maintenance 0-5；fans_pct ±0.05；attendance_mod 0.5-2；satisfaction ±0.5；signals 的 fan_mood ±2、upkeep/fee_mod 0.5-2）；' +
      'choice 型给 options（2-4 个，每个 no/name/desc/outcomes:[{w,effects}]，outcomes 1-4 个）；' +
      'template（≤120字，可用 {team}/{stadium}，禁数字）。只回 JSON。',
    user: hint !== '' ? hint : '设计一条球迷舆情或商业机会类的球场经营事件。',
    maxTokens: 1200,
  });
  const clamped = clampEventDraft(struct, { clamps, signalDefs, weatherKeys });
  void rules;
  const payload = clamped.event;
  const noteParts = [hint, ...clamped.adjustments].filter((s) => s !== '').join('；');
  const res = await c.env.DB
    .prepare(
      `INSERT INTO event_drafts (kind, payload_json, source_event_id, note, status, created_by, created_at, updated_at)
       VALUES ('struct', ?, NULL, ?, 'draft', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    )
    .bind(JSON.stringify(payload), noteParts, user.id)
    .run();
  return c.json({ id: Number(res.meta.last_row_id ?? 0), kind: 'struct', payload, adjustments: clamped.adjustments }, 201);
});

app.get('/events/drafts', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const statusParam = c.req.query('status');
  const status = statusParam === 'draft' || statusParam === 'adopted' || statusParam === 'discarded' ? statusParam : null;
  const rows = (
    await c.env.DB
      .prepare(
        `SELECT id, kind, payload_json, source_event_id, note, status, created_by, created_at, updated_at
         FROM event_drafts ${status !== null ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 50`,
      )
      .bind(...(status !== null ? [status] : []))
      .all<DraftRow>()
  ).results;
  return c.json({ drafts: rows.map(draftView) });
});

/** 草稿修订（采纳前）：text 改 template、struct 重过 clampEventDraft 再入库。 */
app.patch('/events/drafts/:id', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '草稿 id 不对');
  const row = await c.env.DB.prepare('SELECT id, kind, payload_json, note, status FROM event_drafts WHERE id = ?')
    .bind(id)
    .first<DraftRow>();
  if (!row) throw new HttpError(404, '没有这条草稿');
  if (row.status !== 'draft') throw new HttpError(409, '已处理的草稿不能再改');
  const body = (await readJson(c)) as { payload?: unknown } | null;
  if (body === null || body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    throw new HttpError(400, '要给 payload 对象');
  }

  let payload: unknown;
  if (row.kind === 'text') {
    const p = body.payload as { template?: unknown };
    if (typeof p.template !== 'string' || p.template.trim() === '') throw new HttpError(400, 'template 要给非空文案');
    payload = { template: p.template.trim().slice(0, 120) };
  } else {
    const [clamps, signalDefs, weatherKeys] = await Promise.all([
      loadEventClamps(c.env.DB),
      loadEventSignals(c.env.DB),
      loadWeatherKeys(c.env.DB),
    ]);
    let clamped;
    try {
      clamped = clampEventDraft(body.payload, { clamps, signalDefs, weatherKeys });
    } catch (err) {
      // 人工修订的 JSON 往往半成品：把钳制器的报错透传成 400，让前端提示哪不合格
      throw new HttpError(400, err instanceof Error ? err.message : '草稿结构不合格');
    }
    payload = clamped.event;
    const extra = clamped.adjustments.filter((s) => !(row.note ?? '').includes(s));
    if (extra.length > 0) {
      await c.env.DB.prepare('UPDATE event_drafts SET note = ? WHERE id = ?')
        .bind([row.note, ...extra].filter((s) => s !== '').join('；'), id)
        .run();
    }
  }
  await c.env.DB
    .prepare(`UPDATE event_drafts SET payload_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .bind(JSON.stringify(payload), id)
    .run();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'event_draft_update',
    targetType: 'event_draft',
    targetId: id,
    origin: 'user',
    after: { kind: row.kind },
  });
  return c.json({ id, kind: row.kind, payload });
});

/** 采纳草稿：text 改写 event_pool.template；struct INSERT event_pool（event_id 撞车 409）。 */
app.post('/events/drafts/:id/adopt', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '草稿 id 不对');
  const row = await c.env.DB.prepare(`SELECT id, kind, payload_json, source_event_id, status FROM event_drafts WHERE id = ?`)
    .bind(id)
    .first<DraftRow>();
  if (!row) throw new HttpError(404, '没有这条草稿');
  if (row.status !== 'draft') throw new HttpError(409, '这条草稿已经处理过了');

  let targetId: string;
  if (row.kind === 'text') {
    const payload = JSON.parse(row.payload_json) as { template?: unknown };
    if (typeof payload.template !== 'string' || payload.template.trim() === '') throw new HttpError(400, '草稿里没有文案');
    const event = row.source_event_id !== null ? await loadEventById(c.env.DB, row.source_event_id) : null;
    if (event === null) throw new HttpError(404, '草稿指向的原事件已不存在');
    await c.env.DB.prepare(`UPDATE event_pool SET template = ? WHERE event_id = ?`)
      .bind(payload.template.trim().slice(0, 120), event.event_id)
      .run();
    targetId = event.event_id;
  } else {
    const event = JSON.parse(row.payload_json) as EventDraftStruct;
    const clash = await c.env.DB.prepare('SELECT id FROM event_pool WHERE event_id = ?').bind(event.event_id).first();
    if (clash) throw new HttpError(409, `事件标识「${event.event_id}」已在池里，换个 event_id`);
    await c.env.DB
      .prepare(
        `INSERT INTO event_pool (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json,
                                 soft_conditions, template, source, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'custom', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      )
      .bind(
        event.event_id,
        event.name,
        event.category,
        event.weight,
        event.event_type,
        JSON.stringify(event.conditions),
        JSON.stringify(event.effects),
        JSON.stringify(event.options),
        event.template,
      )
      .run();
    targetId = event.event_id;
  }
  await c.env.DB.prepare(`UPDATE event_drafts SET status = 'adopted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(id).run();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'event_draft_adopt',
    targetType: 'event_draft',
    targetId: id,
    origin: 'user',
    after: { kind: row.kind, target: targetId },
  });
  return c.json({ id, kind: row.kind, target: targetId });
});

app.post('/events/drafts/:id/discard', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '草稿 id 不对');
  const row = await c.env.DB.prepare(`SELECT id, status FROM event_drafts WHERE id = ?`).bind(id).first<DraftRow>();
  if (!row) throw new HttpError(404, '没有这条草稿');
  if (row.status !== 'draft') throw new HttpError(409, '这条草稿已经处理过了');
  await c.env.DB.prepare(`UPDATE event_drafts SET status = 'discarded', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(id).run();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'event_draft_discard',
    targetType: 'event_draft',
    targetId: id,
    origin: 'user',
    after: { status: 'discarded' },
  });
  return c.json({ id, status: 'discarded' });
});

/** 生成入口的可用性探针：前端用它决定「生成」按钮是可点还是置灰提示。 */
app.get('/events/llm-status', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  return c.json({ configured: llmConfigured(c.env) });
});

export default app;
