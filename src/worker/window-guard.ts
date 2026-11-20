// 关窗冻结闸（B1 骨架）：窗口进入 closing 后、落 closed 前，所有普通业务写必须被挡住——
// 否则 close_all 批在结算「窗口内」事实时，并发写仍在制造新事实（工资/主场/忠诚/体检口径漂移）。
// 已由 index.ts 在路由之前挂载：`app.use('/api/*', windowClosingGuard())`。本文件出闸门原语：
//   · isWindowClosing(db)       有没有 closing 中的窗口（部分索引点查，常数级）
//   · assertWindowWritable(db)  写端点自助闸：closing 时抛 409（响应形状与中间件一致）
//   · loadCloseWindow(db, ...)  读一行窗口（close_all 开始前复核「窗口仍 closing」用）
//   · windowClosingGuard()      Hono 中间件：非 GET/HEAD 且路径不在豁免名单 → closing 时 409
//
// 冻结面（语义卡口径）：非 GET/HEAD；豁免子树 = /api/admin、/api/internal、/api/auth、/api/media、
// /api/cron（管理员处理审核队列 / 谈判、机器回调、登录、媒体上传、cron tick 不受冻结）。
// GET/HEAD 放行。读触发的 settleOverdue 写不在 B1 冻结面（读端点照旧可触发惰性结算）——已知
// 过渡面，随 docs 登记。
import type { MiddlewareHandler } from 'hono';
import { HttpError } from '../lib/http.ts';
import type { Env } from './env.ts';

/** closing 409 文案与 code（语义卡定稿；HttpError 渲染为 { error, code: 'window_closing' }） */
export const WINDOW_CLOSING_MESSAGE = '窗口正在关闭，暂时不能修改';
export const WINDOW_CLOSING_CODE = 'window_closing';

/** closing 冻结豁免前缀：这些子树的写不冻结（管理员 / 机器回调 / 登录 / 媒体 / cron tick） */
const EXEMPT_PREFIXES = ['/api/admin', '/api/internal', '/api/auth', '/api/media', '/api/cron'];

/** 有没有处于 closing 的窗口。closing 至多一行（idx_season_windows_closing 部分索引，迁移 0096） */
export async function isWindowClosing(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS hit FROM season_windows WHERE status = 'closing' LIMIT 1`)
    .first<{ hit: number }>();
  return row !== null;
}

/** 写端点自助闸：closing 时抛 409（{ error, code: 'window_closing' }，与冻结中间件同一形状） */
export async function assertWindowWritable(db: D1Database): Promise<void> {
  if (await isWindowClosing(db)) {
    throw new HttpError(409, WINDOW_CLOSING_MESSAGE, WINDOW_CLOSING_CODE);
  }
}

/** season_windows 单行（camelCase 映射口径同 listWindows；status 含 0096 引入的 closing 中间态） */
export interface CloseWindowRow {
  season: number;
  windowSeq: number;
  /** open/closing/closed（列是 TEXT，异常值原样透传） */
  status: string;
  isTemporary: boolean;
  openedAt: string | null;
  closedAt: string | null;
}

/** 按 (season, window_seq) 读窗口行；不存在返回 null */
export async function loadCloseWindow(
  db: D1Database,
  season: number,
  windowSeq: number,
): Promise<CloseWindowRow | null> {
  const row = await db
    .prepare(
      `SELECT season, window_seq, status, is_temporary, opened_at, closed_at
       FROM season_windows WHERE season = ? AND window_seq = ?`,
    )
    .bind(season, windowSeq)
    .first<{
      season: number;
      window_seq: number;
      status: string;
      is_temporary: number | null;
      opened_at: string | null;
      closed_at: string | null;
    }>();
  if (!row) return null;
  return {
    season: row.season,
    windowSeq: row.window_seq,
    status: row.status,
    isTemporary: (row.is_temporary ?? 0) === 1,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

/** 豁免前缀按路径段精确匹配（/api/admin 不吃 /api/adminfoo） */
function isExemptPath(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}

/**
 * closing 冻结中间件：index.ts 在路由之前 `app.use('/api/*', windowClosingGuard())` 挂载。
 * 非 GET/HEAD 且路径不属于豁免子树时，查 season_windows 是否有 closing 行，是则 409
 * { error: '窗口正在关闭，暂时不能修改', code: 'window_closing' }。GET/HEAD 与豁免路径不触达 D1。
 */
export function windowClosingGuard(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD') {
      await next();
      return;
    }
    if (isExemptPath(new URL(c.req.url).pathname)) {
      await next();
      return;
    }
    await assertWindowWritable(c.env.DB);
    await next();
  };
}
