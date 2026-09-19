// 站内信收件篮（增量 18，UI_DESIGN「通知中心」）：web 通道通知的列表 / 未读数 / 标已读（👤 登录即本人收件篮）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireUser } from '../../lib/session.ts';

const app = new Hono<{ Bindings: Env }>();

const PAGE_SIZE = 30; // §17 硬 LIMIT 纪律

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

// 我的收件篮：channel='web' 且 user_id=本人，id 倒序游标分页
app.get('/notifications', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const raw = c.req.query('cursor');
  let cursorId: number | undefined;
  if (raw !== undefined) {
    cursorId = Number(raw);
    if (!Number.isInteger(cursorId) || cursorId < 0) throw new HttpError(400, 'cursor 不对');
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, template, payload, created_at, read_at FROM notifications
     WHERE channel = 'web' AND user_id = ? ${cursorId !== undefined ? 'AND id < ?' : ''}
     ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`,
  )
    .bind(...(cursorId !== undefined ? [user.id, cursorId] : [user.id]))
    .all<{ id: number; template: string; payload: string; created_at: string; read_at: string | null }>();
  const page = rows.results.slice(0, PAGE_SIZE);
  const unread = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications WHERE channel = 'web' AND user_id = ? AND read_at IS NULL`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  return c.json({
    items: page.map((r) => {
      let text = '';
      try {
        text = String(JSON.parse(r.payload).text ?? '');
      } catch {
        // 坏 payload 显示为空，不炸整个列表
      }
      return { id: r.id, template: r.template, text, createdAt: r.created_at, readAt: r.read_at };
    }),
    nextCursor: page.length === PAGE_SIZE && rows.results.length > PAGE_SIZE ? page[page.length - 1].id : null,
    unread: unread?.n ?? 0,
  });
});

// 未读数（顶栏小蓝点）
app.get('/notifications/unread-count', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications WHERE channel = 'web' AND user_id = ? AND read_at IS NULL`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  return c.json({ unread: row?.n ?? 0 });
});

// 标已读：单条/多条（ids）或全部（all）；只动本人 web 行，幂等（read_at 非空不覆盖）
app.post('/notifications/read', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const body = (await c.req.raw.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((v): v is number => Number.isInteger(v) && v > 0) : [];
  if (!body?.all && ids.length === 0) throw new HttpError(400, '没有要标已读的通知');
  const conds = [`channel = 'web'`, `user_id = ?`, `read_at IS NULL`];
  const args: unknown[] = [user.id];
  if (!body?.all) {
    conds.push(`id IN (${ids.map(() => '?').join(', ')})`);
    args.push(...ids);
  }
  const out = await c.env.DB.prepare(`UPDATE notifications SET read_at = ${nowSql()} WHERE ${conds.join(' AND ')}`)
    .bind(...args)
    .run();
  return c.json({ marked: out.meta.changes ?? 0 });
});

export default app;
