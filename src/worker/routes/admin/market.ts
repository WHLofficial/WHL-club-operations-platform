// 管理端 · 市场干预（v1.3.0 扩权工具）/ 窗口状态机（§11/§6.4-6，v0.6.0）/ 强制拍卖（规则 4.4.5）
// （原 admin.ts 市场域，v2.1.0 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { HttpError } from '../../../lib/http.ts';
import { createConfigService } from '../../../core/config.ts';
import { adminVoidBid, adminForceSettle, adminForceVoid, adminForceSign, adminRevertDeal, requireReason } from '../../market-intervene.ts';
import { backfillOfferBetTerms } from '../../market-ops.ts';
// 契约类型锚点（v6.82.0 第 4 批）：窗口三端点与看板的 c.json 泛型以 src/contract/batch4.ts 为真源
// （开/关窗回执由 window-machine 的 return 标注互锁，这里泛型是第二道编译期锁）。
// v6.88.1 B3：关窗状态面板与通知重投回执两型同真源（loadWindowCloseStatus return 标注双锁）。
import type {
  CloseWindowResult,
  OpenWindowResult,
  WindowCloseNotifyRetryResult,
  WindowCloseStatus,
  WindowOverviewRow,
  WindowsResponse,
} from '../../../contract/batch4.ts';
// 契约类型锚点（v6.82.0 第 6 批）：强拍三端点（preview / create / cancel）的 c.json 泛型以
// src/contract/batch6.ts 为真源（写侧编译期锁；preview 的 inspectForcedAuction 返回 worker 内部名
// ForcedAuctionInspection，与契约 ForcedAuctionPreview 结构全同、可赋值）。
import type { ForcedAuctionCancelResult, ForcedAuctionPreview, ForcedAuctionResult } from '../../../contract/batch6.ts';
import { listWindows, openWindow, closeWindow } from '../../window-machine.ts';
import { loadWindowOverview } from '../../squad-audit.ts';
// 关窗通知 outbox（v6.88.1 B3）：重投原语 + run/step 行读取（window-close-runs.ts 的 camel 映射复用）
import { retryCloseNotifications } from '../../window-close-outbox.ts';
import { loadCloseRun, loadCloseSteps, type CloseRunRow } from '../../window-close-runs.ts';
import { createForcedAuction, cancelForcedAuction, inspectForcedAuction } from '../../bypass.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// ---- 市场干预（v1.3.0：管理介入扩权，撤/关/裁定工具） ----

// 存量对赌报价补抽（v6.84.4 一次性运维）：只补 package_json.betTerms，不动金额/球队/合同。
app.post('/market/backfill-bet-terms', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  await requireReason(body);
  const result = await backfillOfferBetTerms(c.env, user.id);
  return c.json({ ok: true, ...result });
});

app.post('/market/bids/:id/void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminVoidBid(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/market/listings/:id/force-settle', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceSettle(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/market/listings/:id/force-void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceVoid(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/negotiations/:id/force-sign', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminForceSign(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

app.post('/negotiations/:id/void', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const reason = await requireReason(body);
  const status = await adminRevertDeal(c.env, Number(c.req.param('id')), user.id, reason);
  return c.json({ ok: true, status });
});

// ---- 暂停出价（v2.1.0：全局开关 + 单挂牌冻结；只挡新出价，不改变结算时刻） ----

// GET /api/admin/market/pause-bids —— 全局暂停状态
app.get('/market/pause-bids', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const service = createConfigService(c.env.DB);
  return c.json({ paused: (await service.get('market_bid_paused')) === 'true' });
});

// POST /api/admin/market/pause-bids —— 全局开关（body {paused}；普通 admin 可操作，审计 market_bid_pause）
app.post('/market/pause-bids', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { paused?: unknown } | null;
  if (typeof body?.paused !== 'boolean') throw new HttpError(400, 'paused 须为布尔值');
  const service = createConfigService(c.env.DB);
  const before = (await service.get('market_bid_paused')) === 'true';
  if (before !== body.paused) {
    await service.set('market_bid_paused', body.paused ? 'true' : 'false');
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'market_bid_pause',
      targetType: 'market',
      origin: 'user',
      before: { paused: before },
      after: { paused: body.paused },
    });
  }
  return c.json({ ok: true, paused: body.paused });
});

// POST /api/admin/market/listings/:id/pause-bid | resume-bid —— 单挂牌冻结（只挡新出价）
for (const [suffix, paused] of [
  ['/pause-bid', true],
  ['/resume-bid', false],
] as const) {
  app.post(`/market/listings/:id${suffix}`, async (c) => {
    const user = await requireAdmin(c.env, c.req.raw);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
    const res = await c.env.DB.prepare(`UPDATE listings SET bid_paused = ? WHERE id = ? AND status IN ('listed', 'bidding')`)
      .bind(paused ? 1 : 0, id)
      .run();
    if (res.meta.changes === 0) {
      const exists = await c.env.DB.prepare('SELECT status FROM listings WHERE id = ?').bind(id).first<{ status: string }>();
      if (!exists) throw new HttpError(404, '这单挂牌不存在');
      throw new HttpError(409, `这单状态是 ${exists.status}，不在竞价期，无需${paused ? '暂停' : '恢复'}出价`);
    }
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'market_listing_bid_pause',
      targetType: 'listing',
      targetId: id,
      origin: 'user',
      after: { bidPaused: paused },
    });
    return c.json({ ok: true, bidPaused: paused });
  });
}

// ---- 窗口状态机（§11/§6.4-6，v0.6.0） ----

// GET /api/admin/windows —— 赛季与窗口列表
app.get('/windows', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  return c.json<WindowsResponse>(await listWindows(c.env.DB));
});

// POST /api/admin/windows/open —— 开新窗（前置：无在开窗口；全球员经纪人性格重掷）
// declareGrowthPeriod=true 时同批宣告新成长期（勾选框；成长期本身不与窗口绑定）
// temporary=true 开临时窗（不推进效力/不扣忠诚支出/不扣工资与冠名租金）；同赛季常规窗最多 2 个
app.post('/windows/open', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as
    | { season?: unknown; windowSeq?: unknown; declareGrowthPeriod?: unknown; temporary?: unknown }
    | null;
  return c.json<OpenWindowResult>(await openWindow(c.env, user.id, body?.season, body?.windowSeq, body?.declareGrowthPeriod, body?.temporary), 201);
});

// GET /api/admin/windows/overview —— 关窗页实时看板（v6.69.0 期三）：逐队名单/工资/体检，CPU 也列
app.get('/windows/overview', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json<{ clubs: WindowOverviewRow[] }>({ clubs: await loadWindowOverview(c.env) });
});

// POST /api/admin/windows/close —— 关窗（前置校验；force 需 window_force_settle=true）
app.post('/windows/close', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const body = (await readJson(c)) as { force?: unknown } | null;
  return c.json<CloseWindowResult>(await closeWindow(c.env, user.id, body?.force));
});

// GET /api/admin/windows/close/status —— 关窗进度状态（v6.88.1 B3）：最近一次关窗 run 的
// 七段进度 / warnings / outbox 通知计数，供管理端进度面板消费。window 与 run 恒同窗配对
// （有 run 取该 run 的窗口行——窗口可能已 closed，重试通知要能看到最近 run 的失败通知；
// 无任何 run 取最新窗口行），契约形状见 WindowCloseStatus 型注。权限取严口径随 GET /windows
// （club.registrations.manage），不随 GET /windows/overview 的无键口径。
app.get('/windows/close/status', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  return c.json<WindowCloseStatus>(await loadWindowCloseStatus(c.env.DB));
});

// POST /api/admin/windows/close/notifications/retry —— 重投最近一次关窗的待发/失败通知
//(outbox pending/failed 行；已 sent 的行不进投递查询、不重投，at-least-once 口径见 outbox 注)。
// run 未完成（running/failed）时拒——post_close 投递语义未到，先走 POST /windows/close 续跑段。
// 语义较立项 ask 的字面（「对最近 completed run 的行重投」）刻意收紧：只认最新 run 且非
// completed 即 409，不回落更早的 completed run——避免管理员对还在推进中的未收口 run 抢跑重投
// （与 post_close 投递并发的重复面见 outbox 头注②）。TC-B3-10 锁 409 行为。
// 每次重投写审计 window_close_notify_retry 供对账（delivered/failed/skipped 落 after）。
app.post('/windows/close/notifications/retry', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
  const run = await loadLatestCloseRun(c.env.DB);
  if (run === null) throw new HttpError(404, '还没有关窗记录');
  if (run.status !== 'completed') throw new HttpError(409, '最近一次关窗尚未完成，先重试关窗');
  const result = await retryCloseNotifications(c.env, run.id);
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'window_close_notify_retry',
    targetType: 'window_close_run',
    targetId: run.id,
    origin: 'user',
    after: { delivered: result.delivered, failed: result.failed, skipped: result.skipped },
  });
  return c.json<WindowCloseNotifyRetryResult>(result);
});

// ---- 关窗状态装配（v6.88.1 B3，两个 close/status 路由共用） ----

/** 最近一次关窗 run（id 降序——claim 批与窗口行同批建立 ⇒ id 序即窗序；status / retry 端点
 *  同口径）。无任何 run 回 null。 */
async function loadLatestCloseRun(db: D1Database): Promise<CloseRunRow | null> {
  const row = await db.prepare('SELECT id FROM window_close_runs ORDER BY id DESC LIMIT 1').first<{ id: number }>();
  return row ? loadCloseRun(db, row.id) : null;
}

/** run.summary_json 里拆 warnings（window-close-runs.ts parseSummaryWarnings 同款口径：坏 JSON /
 *  非对象 / 缺键 / 非数组一律空数组，数组内只留字符串）——summaryJson 全文不外发（契约型注）。 */
function parseRunWarnings(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecordObject(parsed)) return [];
  const rawWarnings = parsed.warnings;
  return Array.isArray(rawWarnings) ? rawWarnings.filter((w): w is string => typeof w === 'string') : [];
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 关窗状态装配（GET /windows/close/status 的载荷）：run/window 恒同窗配对（WindowCloseStatus
 *  型注）；steps 按 seq 升序投影 7 字段（runId/summaryJson 不进管理面）；通知计数按 status
 *  分组（迁移 0097 注释预告的状态端点口径，CHECK 外异常值不计入）。 */
async function loadWindowCloseStatus(db: D1Database): Promise<WindowCloseStatus> {
  const run = await loadLatestCloseRun(db);
  const WINDOW_COLUMNS = 'season, window_seq, status, is_temporary, opened_at, closed_at';
  interface WindowDbRow {
    season: number;
    window_seq: number;
    status: string;
    is_temporary: number | null;
    opened_at: string | null;
    closed_at: string | null;
  }
  const win = run
    ? await db
        .prepare(`SELECT ${WINDOW_COLUMNS} FROM season_windows WHERE season = ? AND window_seq = ?`)
        .bind(run.season, run.windowSeq)
        .first<WindowDbRow>()
    : await db
        .prepare(`SELECT ${WINDOW_COLUMNS} FROM season_windows ORDER BY season DESC, window_seq DESC LIMIT 1`)
        .first<WindowDbRow>();
  const steps = run ? await loadCloseSteps(db, run.id) : [];
  const notifications = { pending: 0, sent: 0, failed: 0 };
  if (run) {
    const counts = await db
      .prepare('SELECT status, COUNT(*) AS n FROM window_close_notifications WHERE run_id = ? GROUP BY status')
      .bind(run.id)
      .all<{ status: string; n: number }>();
    for (const row of counts.results) {
      if (row.status === 'pending') notifications.pending = row.n;
      else if (row.status === 'sent') notifications.sent = row.n;
      else if (row.status === 'failed') notifications.failed = row.n;
    }
  }
  return {
    window: win
      ? {
          season: win.season,
          windowSeq: win.window_seq,
          status: win.status,
          isTemporary: (win.is_temporary ?? 0) === 1,
          openedAt: win.opened_at,
          closedAt: win.closed_at,
        }
      : null,
    run: run
      ? {
          id: run.id,
          season: run.season,
          windowSeq: run.windowSeq,
          status: run.status,
          currentStep: run.currentStep,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          error: run.error,
          warnings: parseRunWarnings(run.summaryJson),
        }
      : null,
    steps: steps.map((s) => ({
      step: s.step,
      seq: s.seq,
      status: s.status,
      attempt: s.attempt,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      error: s.error,
    })),
    notifications,
  };
}

// ---- 强制拍卖（规则 4.4.5，附录 A〔5〕；v6.51.0 起人选不限——前六仅作参考值） ----

// GET /api/admin/forced-auctions/preview?playerId=N —— 人选参考（队内非门将 CA 排名/前六线）+ 闸门预检
app.get('/forced-auctions/preview', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  return c.json<ForcedAuctionPreview>(await inspectForcedAuction(c.env, c.req.query('playerId')));
});

// POST /api/admin/forced-auctions —— 建强制拍卖（挂牌价可指定、默认 1m；人选不限；整单税 50%）
app.post('/forced-auctions', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { playerId?: unknown; askPrice?: unknown } | null;
  const result = await createForcedAuction(c.env, user.id, body?.playerId, body?.askPrice);
  // 契约锚点（v6.82.0 第 6 批）：bypass.ts createForcedAuction 的 return 标注已指向契约类型
  return c.json<ForcedAuctionResult>(result, 201);
});

// POST /api/admin/forced-auctions/:id/cancel —— 取消（未成交前）
app.post('/forced-auctions/:id/cancel', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const result = await cancelForcedAuction(c.env, user.id, c.req.param('id'));
  // 契约锚点（v6.82.0 第 6 批）：取消回执补具名（甄别 notes P2，web MarketPage.tsx 内联不动）
  return c.json<ForcedAuctionCancelResult>(result);
});

export default app;
