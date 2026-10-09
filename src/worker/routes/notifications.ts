// 站内信收件篮（v2.4.0，UI_DESIGN「通知中心」）：web 通道通知的列表 / 未读数 / 标已读（👤 登录即本人收件篮）
// v6.40.0：列表行带 clubId 与 payload.ref（前端整行跳转用）、?category= 类目筛选、
// unread-count?by=category 类目计数、read{all:true,category} 本类全部已读。类目→模板表来自
// src/core/notify-meta.ts（唯一真源，不在本文件手抄第二份）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireUser } from '../../lib/session.ts';
import { categoryOf, notifyCategory, templatesOf, type NotifyCategoryId, type NotifyRefType } from '../../core/notify-meta.ts';

const app = new Hono<{ Bindings: Env }>();

const PAGE_SIZE = 30; // §17 硬 LIMIT 纪律
const REF_TYPES: readonly NotifyRefType[] = ['offer', 'player', 'shop_order'];

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/** 类目参数：缺省 undefined，非法当场 400（宁缺勿错，不静默退全量）。 */
function categoryParam(raw: string | undefined): NotifyCategoryId | undefined {
  if (raw === undefined || raw === '') return undefined;
  const cat = notifyCategory(raw);
  if (!cat) throw new HttpError(400, '类目不对');
  return cat.id;
}

/** 类目 → `template IN (?, ?, …)` 片段与绑定值。 */
function categoryCond(cat: NotifyCategoryId): { sql: string; binds: string[] } {
  const templates = templatesOf(cat);
  return { sql: `template IN (${templates.map(() => '?').join(', ')})`, binds: templates };
}

/** 老行 payload 只有 {text} ⇒ ref 为 null（前端走类目固定落点）。 */
function parseRef(payload: string): { type: NotifyRefType; id: number } | null {
  try {
    const ref = (JSON.parse(payload) as { ref?: { type?: unknown; id?: unknown } }).ref;
    if (!ref || typeof ref !== 'object') return null;
    if (!REF_TYPES.includes(ref.type as NotifyRefType)) return null;
    if (!Number.isInteger(ref.id) || (ref.id as number) <= 0) return null;
    return { type: ref.type as NotifyRefType, id: ref.id as number };
  } catch {
    return null;
  }
}

// 我的收件篮：channel='web' 且 user_id=本人，id 倒序游标分页；?category= 只筛模板（游标语义不变）
app.get('/notifications', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const raw = c.req.query('cursor');
  let cursorId: number | undefined;
  if (raw !== undefined) {
    cursorId = Number(raw);
    if (!Number.isInteger(cursorId) || cursorId < 0) throw new HttpError(400, 'cursor 不对');
  }
  const cat = categoryParam(c.req.query('category'));
  const cond = cat ? categoryCond(cat) : null;
  const conds = [`channel = 'web'`, `user_id = ?`];
  if (cond) conds.push(cond.sql);
  if (cursorId !== undefined) conds.push('id < ?');
  const binds: (string | number)[] = [user.id, ...(cond?.binds ?? []), ...(cursorId !== undefined ? [cursorId] : [])];
  const rows = await c.env.DB.prepare(
    `SELECT id, club_id, template, payload, created_at, read_at FROM notifications
     WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`,
  )
    .bind(...binds)
    .all<{
      id: number;
      club_id: number | null;
      template: string;
      payload: string;
      created_at: string;
      read_at: string | null;
    }>();
  const page = rows.results.slice(0, PAGE_SIZE);
  // 未读数恒为全量口径（顶栏红点/页头同源，向后兼容）；类目计数走 unread-count?by=category
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
      return {
        id: r.id,
        clubId: r.club_id,
        template: r.template,
        text,
        ref: parseRef(r.payload),
        createdAt: r.created_at,
        readAt: r.read_at,
      };
    }),
    nextCursor: page.length === PAGE_SIZE && rows.results.length > PAGE_SIZE ? page[page.length - 1].id : null,
    unread: unread?.n ?? 0,
  });
});

// 未读数（顶栏小蓝点）；?by=category 另给各类目计数（只含 >0 的类目，未知模板不进任何类目）
app.get('/notifications/unread-count', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM notifications WHERE channel = 'web' AND user_id = ? AND read_at IS NULL`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  const unread = row?.n ?? 0;
  if (c.req.query('by') !== 'category') return c.json({ unread });
  const grouped = await c.env.DB.prepare(
    `SELECT template, COUNT(*) AS n FROM notifications
     WHERE channel = 'web' AND user_id = ? AND read_at IS NULL GROUP BY template`,
  )
    .bind(user.id)
    .all<{ template: string; n: number }>();
  const byCategory: Record<string, number> = {};
  for (const r of grouped.results) {
    const catId = categoryOf(r.template);
    if (!catId || r.n <= 0) continue;
    byCategory[catId] = (byCategory[catId] ?? 0) + r.n;
  }
  return c.json({ unread, byCategory });
});

// 标已读：单条/多条（ids）或全部（all，可带 category 只清本类）；只动本人 web 行，幂等（read_at 非空不覆盖）
app.post('/notifications/read', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const body = (await c.req.raw.json().catch(() => null)) as
    | { ids?: unknown; all?: unknown; category?: unknown }
    | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((v): v is number => Number.isInteger(v) && v > 0) : [];
  const catRaw = typeof body?.category === 'string' ? body.category : undefined;
  const cat = body?.all ? categoryParam(catRaw) : undefined;
  if (catRaw !== undefined && !body?.all) throw new HttpError(400, '类目筛选要与 all 一起用');
  if (!body?.all && ids.length === 0) throw new HttpError(400, '没有要标已读的通知');
  const cond = cat ? categoryCond(cat) : null;
  const baseConds = [`channel = 'web'`, `user_id = ?`, `read_at IS NULL`];
  if (body?.all) {
    const conds = [...baseConds, ...(cond ? [cond.sql] : [])];
    const out = await c.env.DB.prepare(`UPDATE notifications SET read_at = ${nowSql()} WHERE ${conds.join(' AND ')}`)
      .bind(user.id, ...(cond?.binds ?? []))
      .run();
    return c.json({ marked: out.meta.changes ?? 0 });
  }
  // D1 单查询绑定参数上限 100：ids 分块进 batch，一块失败整体回滚
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const stmts = chunks.map((chunk) =>
    c.env.DB.prepare(
      `UPDATE notifications SET read_at = ${nowSql()} WHERE ${[...baseConds, `id IN (${chunk.map(() => '?').join(', ')} )`].join(' AND ')}`,
    ).bind(user.id, ...chunk),
  );
  const outs = await c.env.DB.batch(stmts);
  return c.json({ marked: outs.reduce((sum, o) => sum + (o.meta.changes ?? 0), 0) });
});

export default app;
