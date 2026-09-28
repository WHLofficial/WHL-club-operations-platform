// 随机事件管理（v6.10.0，D 块）：触发 + 池只读启停 + 流水。
// 计划裁决：不做自定义事件编辑 / 改 JSON（池只允许启停），触发是管理端驱动的（没有玩家自助入口）。
// 事件不绑窗口：触发时把当前所处的 (赛季, 窗) 归档进 occurrence，缺省取开着的窗口，
// 两窗之间（赛季进行中）取可见赛季 + 窗号 0。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { getOpenWindow, getVisibleSeason } from '../../seasons.ts';
import { triggerEventBatch } from '../../event-ops.ts';
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

export default app;
