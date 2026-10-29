// 管理端 · 消费券发放（v6.58.0）：按俱乐部批量发券，逐笔进券账 + 一条发放审计。
// 与「建设支出返还」共用同一本券账（voucherMovement），券只能抵扣、不可转账兑现。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement } from '../../../lib/audit.ts';
import { voucherMovement } from '../../voucher.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 批量发券：body `{ clubIds?: number[], all?: boolean, amount: number, note: string, requestId?: string }`。
 * - clubIds 与 all 二选一；all = 全部俱乐部（上限天然 = 俱乐部总数）。
 * - amount > 0（round2 到分）；note 必填（发放入口无备注等于无凭据）。
 * - requestId 可选（≤64 字符）：同一 requestId 重发只入账一次（前端每次提交生成新 id，
 *   网络重试复用同一 id）；不带 requestId 时按「管理员主动发放」处理，允许重复发放。
 * - 每次真实入账各留一条 voucher_grant 审计。
 */
app.post('/vouchers/grant', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.ledger.manage');
  const body = (await readJson(c)) as
    | { clubIds?: unknown; all?: unknown; amount?: unknown; note?: unknown; requestId?: unknown }
    | null;
  if (!body) throw new HttpError(400, '缺请求体');
  const amountRaw = Number(body.amount);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) throw new HttpError(400, 'amount 必须是大于 0 的数');
  const amount = round2(amountRaw);
  if (amount <= 0) throw new HttpError(400, 'amount 太小小到四舍五入后为 0');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) throw new HttpError(400, 'note 必填');
  const requestIdRaw = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (requestIdRaw !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(requestIdRaw)) {
    throw new HttpError(400, 'requestId 只能由字母/数字/下划线/短横组成（≤64）');
  }
  const requestId = requestIdRaw === '' ? null : requestIdRaw;

  let clubIds: number[];
  if (body.all === true) {
    const rows = await c.env.DB.prepare('SELECT id FROM clubs ORDER BY id').all<{ id: number }>();
    clubIds = rows.results.map((r) => r.id);
  } else {
    if (!Array.isArray(body.clubIds) || body.clubIds.length === 0) throw new HttpError(400, 'clubIds 必须是非空数组（或传 all: true）');
    const ids = body.clubIds.map((v) => Number(v));
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, 'clubIds 里有非法俱乐部 id');
    clubIds = [...new Set(ids)];
  }
  if (clubIds.length === 0) throw new HttpError(400, '没有可发放的俱乐部');
  const placeholders = clubIds.map(() => '?').join(', ');
  const existing = await c.env.DB.prepare(`SELECT id FROM clubs WHERE id IN (${placeholders})`).bind(...clubIds).all<{ id: number }>();
  const found = new Set(existing.results.map((r) => r.id));
  const missing = clubIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(404, `俱乐部不存在：${missing.join(', ')}`);

  const statements = clubIds.flatMap((clubId) =>
    voucherMovement(c.env.DB, {
      clubId,
      delta: amount,
      kind: 'admin_grant',
      refType: requestId === null ? 'admin' : `admin:${requestId}`,
      refId: user.id,
      memo: `管理组发放消费券：${note}`,
      idempotent: requestId === null ? false : true,
    }),
  );
  statements.push(
    createAuditStatement(c.env.DB)({
      actor: user.id,
      action: 'voucher_grant',
      targetType: 'voucher',
      targetId: null,
      origin: 'user',
      after: { clubIds, amount, note, requestId },
      // 幂等重放（同 requestId）时不落第二条审计：最后一条券流水没动就不留痕
      guardSql: 'changes() > 0',
    }),
  );
  await c.env.DB.batch(statements);
  return c.json({ granted: clubIds.length, amount, total: round2(amount * clubIds.length) }, 201);
});

export default app;
