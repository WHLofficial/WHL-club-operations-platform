// 窗口状态机（TECH_DESIGN §11/§6.4-6）：season_windows open → closed。
// 开窗（= 推进进入新窗）：前置校验无在开窗口，全球员按 agent_change_probability 三档等概率
// 重掷经纪人档位（§6.8）；关窗：先跑惰性结算（截止判定/激活失效/匹配到期），再校验
// ——活跃谈判会话（force 且 window_force_settle=true 时按 E 强制成约）、匹配等待单、
// 待审队列全空——然后落 closed 并做窗尾收口（无人出价下架收费、竞价转待审）。
import type { Env } from './env.ts';
import type { PayrollSummary } from './window-payroll.ts';
import { HttpError } from '../lib/http.ts';
import { createConfigService } from '../core/config.ts';
import { createAuditStatement } from '../lib/audit.ts';
import { getOpenWindow } from './seasons.ts';
import { settleOverdue } from './market-settle.ts';
import { forceSettleAtExpected } from './negotiations.ts';
import { windowPayrollStatements } from './window-payroll.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

function defaultRng(): number {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return new DataView(buf.buffer).getUint32(0) / 2 ** 32;
}

export interface WindowRow {
  season: number;
  windowSeq: number;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
}

export async function listWindows(db: D1Database): Promise<{ seasons: { season: number; status: string }[]; windows: WindowRow[] }> {
  const seasons = await db
    .prepare('SELECT season, status FROM seasons ORDER BY season DESC LIMIT 50')
    .all<{ season: number; status: string }>();
  const windows = await db
    .prepare('SELECT season, window_seq, status, opened_at, closed_at FROM season_windows ORDER BY season DESC, window_seq DESC LIMIT 100')
    .all<{ season: number; window_seq: number; status: string; opened_at: string | null; closed_at: string | null }>();
  // DTO 冻结 camelCase（附录 A），在此层统一映射
  return {
    seasons: seasons.results,
    windows: windows.results.map((r) => ({
      season: r.season,
      windowSeq: r.window_seq,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    })),
  };
}

/**
 * 开窗：无在开窗口（一次只有一个窗）；season 缺省取最新赛季、windowSeq 缺省顺延；
 * 赛季行不存在时自动按 running 建档（完整赛季管理随增量 6）。
 * 全球员经纪人档位重掷：roll < prob → 三档等概率（会话存续期档位恒定，E 已快照）。
 */
export async function openWindow(
  env: Env,
  actor: number,
  seasonInput: unknown,
  windowSeqInput: unknown,
): Promise<{ ok: true; season: number; windowSeq: number; rerolled: number }> {
  const db = env.DB;
  const config = createConfigService(db);

  const openCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM season_windows WHERE status = 'open'`)
    .first<{ n: number }>();
  if ((openCount?.n ?? 0) > 0) throw new HttpError(409, '还有一个窗口开着，先关闭它再开新窗');

  let season: number;
  if (seasonInput === undefined || seasonInput === null || seasonInput === '') {
    const latest = await db.prepare('SELECT MAX(season) AS s FROM seasons').first<{ s: number | null }>();
    season = latest?.s ?? 1;
  } else {
    season = Number(seasonInput);
    if (!Number.isInteger(season) || season <= 0) throw new HttpError(400, 'season 应为正整数');
  }
  let windowSeq: number;
  if (windowSeqInput === undefined || windowSeqInput === null || windowSeqInput === '') {
    const latest = await db
      .prepare('SELECT MAX(window_seq) AS w FROM season_windows WHERE season = ?')
      .bind(season)
      .first<{ w: number | null }>();
    windowSeq = (latest?.w ?? 0) + 1;
  } else {
    windowSeq = Number(windowSeqInput);
    if (!Number.isInteger(windowSeq) || windowSeq <= 0) throw new HttpError(400, 'windowSeq 应为正整数');
  }

  // 经纪人档位重掷（§6.8）：窗口推进事务内全球员 0.3 概率三档等概率
  const prob = await config.getNumber('agent_reroll_prob');
  const roll = env.rng ?? defaultRng;
  const rerolls = new Map<number, number[]>();
  let scanned = 0;
  let lastId = 0;
  for (;;) {
    const rows = await db
      .prepare('SELECT id, agent_tier FROM players WHERE id > ? ORDER BY id LIMIT 500')
      .bind(lastId)
      .all<{ id: number; agent_tier: number }>();
    if (rows.results.length === 0) break;
    for (const r of rows.results) {
      lastId = r.id;
      scanned++;
      if (roll() < (prob ?? 0.3)) {
        const tier = 1 + Math.floor(roll() * 3);
        const list = rerolls.get(tier) ?? [];
        list.push(r.id);
        rerolls.set(tier, list);
      }
    }
    if (rows.results.length < 500) break;
  }
  const statements: D1PreparedStatement[] = [];
  for (const [tier, ids] of rerolls) {
    for (let i = 0; i < ids.length; i += 90) {
      const slice = ids.slice(i, i + 90);
      statements.push(
        db
          .prepare(`UPDATE players SET agent_tier = ?, updated_at = ${nowSql()} WHERE id IN (${slice.map(() => '?').join(', ')})`)
          .bind(tier, ...slice),
      );
    }
  }
  if (statements.length > 0) await db.batch(statements);

  const audit = createAuditStatement(db);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO seasons (season, status, created_at) VALUES (?, 'running', ${nowSql()})
           ON CONFLICT(season) DO NOTHING`,
        )
        .bind(season),
      // 赛季生命周期（§11）：备赛期开窗即进入进行中
      db.prepare(`UPDATE seasons SET status = 'running' WHERE season = ? AND status = 'preparing'`).bind(season),
      db
        .prepare(
          `INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (?, ?, 'open', ${nowSql()})`,
        )
        .bind(season, windowSeq),
      audit({
        actor,
        action: 'window_open',
        targetType: 'season_window',
        targetId: null,
        after: { season, windowSeq, playersScanned: scanned, rerolled: [...rerolls.values()].reduce((n, l) => n + l.length, 0) },
      }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, '这个窗口已经存在');
    throw err;
  }
  return { ok: true, season, windowSeq, rerolled: [...rerolls.values()].reduce((n, l) => n + l.length, 0) };
}

/**
 * 关窗：惰性结算 → 前置校验（活跃谈判会话/匹配等待/待审队列）→ closed → 窗尾收口。
 * force=true 且 window_force_settle=true 时，活跃会话按 E 强制成约（成约即过户）；
 * 没提交过新 RC（无 E）的会话无法强结，仍会挡住关窗。
 */
export async function closeWindow(
  env: Env,
  actor: number,
  forceInput: unknown,
): Promise<{ ok: true; season: number; windowSeq: number; forceSettled: number; payroll: PayrollSummary }> {
  const db = env.DB;
  const win = await getOpenWindow(db);
  if (!win) throw new HttpError(409, '当前没有开着的窗口');

  // 截止判定/激活失效/匹配到期先收一遍，让该进待审的进待审
  await settleOverdue(env, { actor });

  const matched = await db
    .prepare(`SELECT COUNT(*) AS n FROM listings WHERE status = 'matched_pending'`)
    .first<{ n: number }>();
  if ((matched?.n ?? 0) > 0) throw new HttpError(409, `还有 ${matched?.n} 单激活在匹配等待期，等匹配窗结束（或被激活方决定）再关窗`);

  const pending = await db
    .prepare(`SELECT COUNT(*) AS n FROM transfers WHERE status = 'pending_review'`)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) > 0) throw new HttpError(409, `审核队列还有 ${pending?.n} 张单没处理，先处理完再关窗`);

  const sessions = await db
    .prepare(
      `SELECT s.id, s.expected_wage FROM negotiation_sessions s
       JOIN transfers t ON t.id = s.transfer_id
       WHERE s.status = 'active' AND t.status = 'signing' ORDER BY s.id LIMIT 200`,
    )
    .all<{ id: number; expected_wage: number | null }>();
  let forceSettled = 0;
  if (sessions.results.length > 0) {
    const config = createConfigService(db);
    const forceAllowed = (await config.get('window_force_settle')) === 'true';
    const force = forceInput === true;
    if (!force || !forceAllowed) {
      throw new HttpError(409, `还有 ${sessions.results.length} 场签约谈判没结束，先谈完，或在开启 window_force_settle 后带 force 强制按 E 结算`);
    }
    const noE = sessions.results.filter((s) => s.expected_wage === null);
    if (noE.length > 0) throw new HttpError(409, `${noE.length} 场谈判还没提交新违约金（没有 E 快照），无法强制结算`);
    for (const s of sessions.results) {
      if (await forceSettleAtExpected(env, s.id, actor)) forceSettled++;
    }
  }

  const audit = createAuditStatement(db);
  // 窗末扣款（增量 11）：工资+富人税并入关窗批（窗口状态 UPDATE 行数=原子闸；失败整批回滚含关窗）
  const payroll = await windowPayrollStatements(env, win.season, win.windowSeq);
  const results = await db.batch([
    db
      .prepare(`UPDATE season_windows SET status = 'closed', closed_at = ${nowSql()} WHERE season = ? AND window_seq = ? AND status = 'open'`)
      .bind(win.season, win.windowSeq),
    audit({
      actor,
      action: 'window_close',
      targetType: 'season_window',
      targetId: null,
      after: { season: win.season, windowSeq: win.windowSeq, forceSettled },
    }),
    ...payroll.statements,
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '窗口刚被关过了');
  // 窗尾收口（4.4.7）：无人出价下架收费、仍在竞价的强制进待审
  await settleOverdue(env, { actor });
  return { ok: true, season: win.season, windowSeq: win.windowSeq, forceSettled, payroll: payroll.summary };
}
