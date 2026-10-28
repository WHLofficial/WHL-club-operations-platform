// 海捞两阶段·暗标段（v6.50.0）。设计见 memory/design-sea-two-phase.md。
// 段制：一个转会窗最多一个批次（sea_batches，UNIQUE(season, window_seq)）。暗标段内自由身池整体进批次，
// 统一截止、价高者得；金额与出标方保密（只有出标方自己与管理组可见）；提交即冻结 30% × 新违约金
//（= 签入费额，freeAgentFee 同口径，故 SQL 触发器直接 ROUND(x*0.3, 2)），截止前可改（替换刷新冻结）可撤（解冻）。
// 开标（到点 / 关窗 / 管理端立即）逐球员取最高标 → 重跑资格链 → 胜出者建海捞单（复用现有审核 → 工资谈判 → 过户链），
// 其余解冻并通知。明标段零新增机制：仍是 POST /api/transfers/free-agent（闸 transfer_sea_open）。
//
// 状态机（批次）：sealed 收标中 → settling 开标中（claim 防并发）→ opened 已开标；cancelled 已取消。
// 收标中的唯一真源是批次状态：关窗即开标、到点即开标都会把批次推出 sealed，写入口只看批次状态 + deadline。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { freeAgentFee } from '../core/bypass-rules.ts';
import { round2 } from '../core/market-rules.ts';
import { fmtBeijingMinute, resolveOpsRow } from '../core/ops-schedule.ts';
import { sqlDisplayName, rowDisplayName } from '../core/player-name.ts';
import { createConfigService } from '../core/config.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { balanceSnapshot } from './ledger.ts';
import { getOpenWindow, type OpenWindow } from './seasons.ts';
import { checkSeaSignEligible, createBypassTransfer } from './bypass.ts';
import { loadOpsRows, loadWindowRef, saveOpsRow } from './ops-schedule.ts';
import { queueClubNotification } from './notify.ts';
import type { ExpiryOpts } from './expiry-ops.ts';

export type SeaBatchStatus = 'sealed' | 'settling' | 'opened' | 'cancelled';
export type SeaBidStatus = 'sealed' | 'won' | 'lost' | 'void' | 'withdrawn';

export interface SeaBatchRow {
  id: number;
  season: number;
  window_seq: number;
  status: SeaBatchStatus;
  sealed_at: string | null;
  deadline_at: string;
  reminded_at: string;
  opened_at: string | null;
  opened_by: number | null;
  note: string;
  created_at: string | null;
}

export interface SeaBidRow {
  id: number;
  batch_id: number;
  player_id: number;
  club_id: number;
  new_release_fee: number;
  hold_id: number | null;
  status: SeaBidStatus;
  submitted_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
  void_reason: string;
}

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/** 解锁/销毁冻结：密封标的冻结一律以本表 id 为 ref_id 记账。 */
function releaseHoldStatement(db: D1Database, bidId: number): D1PreparedStatement {
  return db
    .prepare(`UPDATE fund_holds SET status = 'released' WHERE status = 'held' AND ref_type = 'sea_sealed' AND ref_id = ?`)
    .bind(bidId);
}

export async function seaEnabled(db: D1Database): Promise<boolean> {
  return (await createConfigService(db).get('sea_enabled')) === 'true';
}

// ---- 批次（惰性创建） ----

/**
 * 暗标段现在是什么状态？enabled=false ⇒ 整条链不生效（无批次、入口关闭）。
 * 只有「时刻表 transfer_sea_sealed 行进行中且填了具体终点」才会建批次——统一截止是暗标段的前提，
 * 端点锚 window_close 拿不到统一截止，那种配置下暗标段不开（明标段照旧）。
 */
export interface SeaPhaseInfo {
  enabled: boolean;
  /** open = 时段内；not_started / closed / unrestricted = 不在暗标段 */
  state: 'unrestricted' | 'not_started' | 'open' | 'closed';
  deadlineAt: string | null;
  window: OpenWindow | null;
}

export async function loadSeaPhase(env: Env): Promise<SeaPhaseInfo> {
  const db = env.DB;
  if (!(await seaEnabled(db))) {
    return { enabled: false, state: 'unrestricted', deadlineAt: null, window: null };
  }
  const window = await getOpenWindow(db);
  const row = (await loadOpsRows(db)).get('transfer_sea_sealed');
  if (!row) return { enabled: true, state: 'unrestricted', deadlineAt: null, window };
  const windowRef = await loadWindowRef(db);
  const resolved = resolveOpsRow(row, windowRef, new Date().toISOString());
  return { enabled: true, state: resolved.state, deadlineAt: resolved.endAt, window };
}

/**
 * 取本窗批次；暗标段进行中且还没批次时惰性建一个（INSERT OR IGNORE = 并发安全）。
 * 已取消/已开标的批次原样返回——不重建（重启暗标是时刻表的事，不是批次状态的事）。
 */
export async function ensureSeaBatch(env: Env, win: OpenWindow, deadlineAt: string): Promise<SeaBatchRow | null> {
  const db = env.DB;
  const existing = await findBatch(db, win.season, win.windowSeq);
  if (existing) return existing;
  await db
    .prepare(
      `INSERT OR IGNORE INTO sea_batches (season, window_seq, status, sealed_at, deadline_at, created_at)
       VALUES (?, ?, 'sealed', ${nowSql()}, ?, ${nowSql()})`,
    )
    .bind(win.season, win.windowSeq, deadlineAt)
    .run();
  return findBatch(db, win.season, win.windowSeq);
}

export async function findBatch(db: D1Database, season: number, windowSeq: number): Promise<SeaBatchRow | null> {
  return db
    .prepare(`SELECT * FROM sea_batches WHERE season = ? AND window_seq = ? ORDER BY id DESC LIMIT 1`)
    .bind(season, windowSeq)
    .first<SeaBatchRow>();
}

// ---- 教练侧读接口（阶段 + 我的标 + 公示） ----

export interface SeaBidDto {
  playerId: number;
  playerName: string;
  /** 保密：只有出标方自己看得到金额；开标胜出后随公示公开 */
  newReleaseFee: number;
  status: SeaBidStatus;
  voidReason: string;
  updatedAt: string | null;
}

export interface SeaWinnerDto {
  playerId: number;
  playerName: string;
  clubId: number;
  clubName: string;
  amount: number;
}

export interface SeaPhaseView {
  enabled: boolean;
  /** off = 未启用；none = 不在暗标段；sealed = 收标中；closing = 已截止等开标；open = 已开标（看公示，明标段走常规海捞） */
  state: 'off' | 'none' | 'sealed' | 'closing' | 'open';
  batch: {
    id: number;
    season: number;
    windowSeq: number;
    status: SeaBatchStatus;
    sealedAt: string | null;
    deadlineAt: string;
    openedAt: string | null;
  } | null;
  /** 我在本批次的标（只有自己可见） */
  myBids: SeaBidDto[];
  /** 最近一次开标的公示（谁以多少胜出） */
  results: SeaWinnerDto[];
}

export async function loadSeaPhaseView(env: Env, clubId: number): Promise<SeaPhaseView> {
  const db = env.DB;
  const phase = await loadSeaPhase(env);
  if (!phase.enabled) {
    return { enabled: false, state: 'off', batch: null, myBids: [], results: [] };
  }
  // 暗标段进行中：把批次按需建出来（前端因此能先看到倒计时，教练还没出标也有批次）
  let batch: SeaBatchRow | null = null;
  if (phase.window && phase.state === 'open' && phase.deadlineAt) {
    batch = await ensureSeaBatch(env, phase.window, phase.deadlineAt);
  } else if (phase.window) {
    batch = await findBatch(db, phase.window.season, phase.window.windowSeq);
  }
  const results = await loadResults(db, phase.window);
  const myBids = batch
    ? (
        await db
          .prepare(
            `SELECT b.player_id, ${sqlDisplayName('p')} AS player_name, b.new_release_fee, b.status, b.void_reason, b.updated_at
             FROM sea_sealed_bids b JOIN players p ON p.id = b.player_id
             WHERE b.batch_id = ? AND b.club_id = ? ORDER BY b.player_id`,
          )
          .bind(batch.id, clubId)
          .all<{
            player_id: number;
            player_name: string;
            new_release_fee: number;
            status: SeaBidStatus;
            void_reason: string;
            updated_at: string | null;
          }>()
      ).results.map((r) => ({
        playerId: r.player_id,
        playerName: r.player_name,
        newReleaseFee: r.new_release_fee,
        status: r.status,
        voidReason: r.void_reason,
        updatedAt: r.updated_at,
      }))
    : [];
  return {
    enabled: true,
    state: batchState(batch),
    batch: batch
      ? {
          id: batch.id,
          season: batch.season,
          windowSeq: batch.window_seq,
          status: batch.status,
          sealedAt: batch.sealed_at,
          deadlineAt: batch.deadline_at,
          openedAt: batch.opened_at,
        }
      : null,
    myBids,
    results,
  };
}

function batchState(batch: SeaBatchRow | null): SeaPhaseView['state'] {
  if (!batch) return 'none';
  if (batch.status === 'sealed') return Date.now() > Date.parse(batch.deadline_at) ? 'closing' : 'sealed';
  if (batch.status === 'settling') return 'closing';
  if (batch.status === 'opened') return 'open';
  return 'none'; // cancelled：本窗回到常规流程
}

/** 公示：本窗批次已开标则看本窗，否则看最近一次开标的批次（跨窗关窗后仍可回看）。 */
async function loadResults(db: D1Database, window: OpenWindow | null): Promise<SeaWinnerDto[]> {
  const scope = window
    ? `(SELECT id FROM sea_batches WHERE season = ? AND window_seq = ? AND status = 'opened' ORDER BY id DESC LIMIT 1)`
    : `(SELECT id FROM sea_batches WHERE status = 'opened' ORDER BY id DESC LIMIT 1)`;
  const stmt = db.prepare(
    `SELECT s.player_id, ${sqlDisplayName('p')} AS player_name, s.club_id, COALESCE(c.name, '—') AS club_name, s.new_release_fee
       FROM sea_sealed_bids s
       JOIN players p ON p.id = s.player_id
       LEFT JOIN clubs c ON c.id = s.club_id
      WHERE s.status = 'won' AND s.batch_id = ${scope}
      ORDER BY s.new_release_fee DESC, s.id ASC`,
  );
  const res = window
    ? await stmt.bind(window.season, window.windowSeq).all<{
        player_id: number;
        player_name: string;
        club_id: number;
        club_name: string;
        new_release_fee: number;
      }>()
    : await stmt.all<{ player_id: number; player_name: string; club_id: number; club_name: string; new_release_fee: number }>();
  return res.results.map((r) => ({
    playerId: r.player_id,
    playerName: r.player_name,
    clubId: r.club_id,
    clubName: r.club_name,
    amount: r.new_release_fee,
  }));
}

// ---- 提交 / 改标 / 撤回 ----

export interface SeaSubmitResult {
  ok: true;
  bidId: number;
  playerId: number;
  newReleaseFee: number;
  signFee: number;
  /** 本次是改标（原冻结已刷新）还是首标 */
  updated: boolean;
}

async function requireOpenBatch(env: Env): Promise<{ batch: SeaBatchRow; win: OpenWindow }> {
  const phase = await loadSeaPhase(env);
  if (!phase.enabled) throw new HttpError(409, '海捞暗标段没有开启', 'sea_disabled');
  if (!phase.window) throw new HttpError(409, '转会窗口没开，现在不能出标', 'no_window');
  let batch = await findBatch(env.DB, phase.window.season, phase.window.windowSeq);
  if (!batch && phase.state === 'open' && phase.deadlineAt) batch = await ensureSeaBatch(env, phase.window, phase.deadlineAt);
  if (!batch) {
    throw new HttpError(
      409,
      phase.state === 'not_started' ? '海捞暗标段还没开始' : '现在不在海捞暗标段（常规海捞走球员档案里的海捞入口）',
      'sea_not_sealed',
    );
  }
  if (batch.status !== 'sealed') throw new HttpError(409, '本窗暗标已经开标了，不能出标', 'sea_batch_resolved');
  if (Date.now() > Date.parse(batch.deadline_at)) throw new HttpError(409, '暗标段已截止，等统一开标', 'sea_deadline_passed');
  return { batch, win: { season: batch.season, windowSeq: batch.window_seq } };
}

export async function submitSealedBid(
  env: Env,
  clubId: number,
  actor: number,
  playerIdInput: unknown,
  newFeeInput: unknown,
): Promise<SeaSubmitResult> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  const newFee = Number(newFeeInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isInteger(newFee) || newFee <= 0) {
    throw new HttpError(400, '新违约金须为正整数（单位 m，暗标与明标同口径，不设上下限）');
  }
  const { batch, win } = await requireOpenBatch(env);

  const player = await db
    .prepare('SELECT id, name, display_name, club_id, status FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; name: string; display_name: string | null; club_id: number | null; status: string }>();
  if (!player) throw new HttpError(404, '球员不存在');
  const verdict = await checkSeaSignEligible(db, player, win);
  if (!verdict.ok) throw new HttpError(verdict.status, verdict.reason, verdict.errCode);

  const signFee = freeAgentFee(newFee);
  const existing = await db
    .prepare(`SELECT * FROM sea_sealed_bids WHERE batch_id = ? AND player_id = ? AND club_id = ?`)
    .bind(batch.id, playerId, clubId)
    .first<SeaBidRow>();
  if (existing && existing.status !== 'sealed') {
    throw new HttpError(409, `你对这名球员的上一份标已定局（${existing.status}），不能重出`, 'sea_bid_resolved');
  }

  // 可用余额预检（触发器是同一事务里的兜底）：改标时自己那份旧冻结可以顶上来
  const snap = await balanceSnapshot(db, clubId);
  const available = round2(snap.available);
  const ownHold =
    existing?.hold_id !== null && existing?.hold_id !== undefined
      ? ((
          await db
            .prepare(`SELECT amount FROM fund_holds WHERE id = ? AND status = 'held'`)
            .bind(existing.hold_id)
            .first<{ amount: number }>()
        )?.amount ?? 0)
      : 0;
  if (round2(available + ownHold) < signFee) {
    throw new HttpError(
      400,
      `可用资金不足：出标即冻结签入费（新违约金的 30% = ${signFee} m），当前可支配 ${available} m（已含预期收入 ${round2(snap.creditLine)} m）`,
      'sea_no_funds',
    );
  }

  const audit = createAuditStatement(db);
  let bidId: number;
  const updated = !!existing;
  if (existing) {
    // 改标：标价与冻结必须在同一批里换——触发器按「标上的价 × 30%」校验冻结额，
    // 分两批落库会出现「价已改、冻结没换」的中间态（重试还会被触发器拦下来）
    bidId = existing.id;
    try {
      await db.batch([
        db
          .prepare(`UPDATE sea_sealed_bids SET new_release_fee = ?, updated_at = ${nowSql()} WHERE id = ? AND status = 'sealed'`)
          .bind(newFee, bidId),
        releaseHoldStatement(db, bidId),
        db
          .prepare(
            `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
             VALUES (?, ?, 'held', 'sea_sealed', ?, ${nowSql()})`,
          )
          .bind(clubId, signFee, bidId),
      ]);
    } catch (err) {
      throw mapSealedTriggerError(err);
    }
  } else {
    try {
      const res = await db.batch([
        db
          .prepare(
            `INSERT INTO sea_sealed_bids (batch_id, player_id, club_id, new_release_fee, status, submitted_at, updated_at)
             VALUES (?, ?, ?, ?, 'sealed', ${nowSql()}, ${nowSql()})`,
          )
          .bind(batch.id, playerId, clubId, newFee),
        // 新标：标的 id 就是这一批里刚插进去的那一行（与 createBypassTransfer 的审核任务同手法）
        db
          .prepare(
            `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
             VALUES (?, ?, 'held', 'sea_sealed', last_insert_rowid(), ${nowSql()})`,
          )
          .bind(clubId, signFee),
      ]);
      bidId = Number(res[0]?.meta.last_row_id);
    } catch (err) {
      throw mapSealedTriggerError(err);
    }
  }
  const hold = await db
    .prepare(`SELECT id FROM fund_holds WHERE ref_type = 'sea_sealed' AND ref_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`)
    .bind(bidId)
    .first<{ id: number }>();
  if (!hold) {
    throw new HttpError(409, '冻结没落账，这一手不算数（资金刚被其他操作占用），刷新再试', 'sea_no_funds');
  }
  await db.batch([
    db.prepare(`UPDATE sea_sealed_bids SET hold_id = ? WHERE id = ?`).bind(hold.id, bidId),
    audit({
      actor,
      action: updated ? 'sea_sealed_rebid' : 'sea_sealed_bid',
      targetType: 'sea_batch',
      targetId: batch.id,
      origin: 'user',
      after: { playerId, playerName: rowDisplayName(player), clubId, newReleaseFee: newFee, signFee, bidId, updated },
    }),
  ]);
  return { ok: true, bidId, playerId, newReleaseFee: newFee, signFee, updated };
}

/** 触发器兜底从 D1 裸错转可读 HttpError（与 offers.ts / routes/market.ts 同手法）。 */
function mapSealedTriggerError(err: unknown): HttpError {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('WHL_SEA_REJECT_FUNDS')) {
    return new HttpError(400, '可用资金不足：出标即冻结，冻结没过账这标就不算数，刷新再试', 'sea_no_funds');
  }
  if (msg.includes('WHL_SEA_REJECT_CLOSED')) return new HttpError(409, '本窗暗标刚开标，不能出标了', 'sea_batch_resolved');
  if (msg.includes('WHL_SEA_REJECT_AMOUNT')) return new HttpError(409, '出标金额刚被改过，刷新再试');
  return new HttpError(409, `出标没成功：${msg}`);
}

export async function withdrawSealedBid(env: Env, clubId: number, actor: number, playerIdInput: unknown): Promise<{ ok: true }> {
  const db = env.DB;
  const playerId = Number(playerIdInput);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  const { batch } = await requireOpenBatch(env);
  const bid = await db
    .prepare(`SELECT * FROM sea_sealed_bids WHERE batch_id = ? AND player_id = ? AND club_id = ?`)
    .bind(batch.id, playerId, clubId)
    .first<SeaBidRow>();
  if (!bid || bid.status !== 'sealed') throw new HttpError(404, '你没有这名球员的密封标');
  const player = await db.prepare('SELECT name, display_name FROM players WHERE id = ?').bind(playerId).first<{ name: string; display_name: string | null }>();
  const audit = createAuditStatement(db);
  const res = await db.batch([
    db
      .prepare(
        `UPDATE sea_sealed_bids SET status = 'withdrawn', void_reason = '出标方撤回', resolved_at = ${nowSql()}
          WHERE id = ? AND status = 'sealed'`,
      )
      .bind(bid.id),
    releaseHoldStatement(db, bid.id),
    audit({
      actor,
      action: 'sea_sealed_withdraw',
      targetType: 'sea_batch',
      targetId: batch.id,
      origin: 'user',
      after: { playerId, playerName: player ? rowDisplayName(player) : String(playerId), clubId, bidId: bid.id },
    }),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '这份标刚被定局了，刷新看看');
  return { ok: true };
}

// ---- 开标（到点 / 关窗 / 管理端立即） ----

export interface SeaOpenSummary {
  ok: true;
  batchId: number;
  already: boolean;
  won: number;
  lost: number;
  voided: number;
}

interface BidWithPlayer extends SeaBidRow {
  player_name: string;
  player_club_id: number | null;
  player_status: string;
}

/**
 * 开标：逐球员「最高标胜出（同额取最早）」→ 重跑资格链（此时窗口可能已关，故用批次自己的
 * season/window_seq 当窗口引用——被解约禁签与在途判定都看本窗）→ 胜出者建海捞单，其余解冻。
 * claim = status sealed → settling（并发下只有一个执行者）；force 用于收拾崩在半路的 settling。
 */
export async function openSeaBatch(
  env: Env,
  batchId: number,
  actor: number | null,
  origin: AuditOrigin,
  opts: { reason: 'deadline' | 'window_close' | 'manual' | 'ops_end'; force?: boolean },
): Promise<SeaOpenSummary> {
  const db = env.DB;
  const claim = await db
    .prepare(
      opts.force
        ? `UPDATE sea_batches SET status = 'settling' WHERE id = ? AND status IN ('sealed', 'settling')`
        : `UPDATE sea_batches SET status = 'settling' WHERE id = ? AND status = 'sealed'`,
    )
    .bind(batchId)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return { ok: true, batchId, already: true, won: 0, lost: 0, voided: 0 };

  const batch = await db.prepare(`SELECT * FROM sea_batches WHERE id = ?`).bind(batchId).first<SeaBatchRow>();
  if (!batch) throw new HttpError(404, '暗标批次不存在');
  const win: OpenWindow = { season: batch.season, windowSeq: batch.window_seq };
  const bidsRes = await db
    .prepare(
      `SELECT s.*, ${sqlDisplayName('p')} AS player_name, p.club_id AS player_club_id, p.status AS player_status
         FROM sea_sealed_bids s JOIN players p ON p.id = s.player_id
        WHERE s.batch_id = ? AND s.status = 'sealed'
        ORDER BY s.player_id ASC, s.new_release_fee DESC, s.submitted_at ASC, s.id ASC`,
    )
    .bind(batchId)
    .all<BidWithPlayer>();
  const groups = new Map<number, BidWithPlayer[]>();
  for (const b of bidsRes.results) {
    const list = groups.get(b.player_id);
    if (list) list.push(b);
    else groups.set(b.player_id, [b]);
  }

  let won = 0;
  let lost = 0;
  let voided = 0;
  const participants = new Set<number>();
  const winners = new Set<number>();
  for (const group of groups.values()) {
    const first = group[0];
    for (const b of group) participants.add(b.club_id);
    const verdict = await checkSeaSignEligible(
      db,
      { id: first.player_id, club_id: first.player_club_id, status: first.player_status },
      win,
    );
    if (!verdict.ok) {
      // 该球员在收标期间被挂牌 / 易主 / 已有在途单 / 本窗被解约 ⇒ 整组标作废并解冻
      for (const b of group) {
        if (await resolveBid(env, b.id, 'void', verdict.reason)) {
          voided++;
          await queueClubNotification(env, b.club_id, 'sea_sealed_lost', {
            player: first.player_name,
            reason: 'the_void',
            voidReason: verdict.reason,
          });
        }
      }
      continue;
    }
    let champion: BidWithPlayer | null = null;
    for (const b of group) {
      const hold = b.hold_id
        ? await db.prepare(`SELECT id FROM fund_holds WHERE id = ? AND status = 'held'`).bind(b.hold_id).first<{ id: number }>()
        : null;
      if (!hold) {
        // 冻结不在位（异常路径）：这一标作废，顺位让给下一份
        if (await resolveBid(env, b.id, 'void', '冻结已失效，该标作废')) {
          voided++;
          await queueClubNotification(env, b.club_id, 'sea_sealed_lost', {
            player: first.player_name,
            reason: 'the_void',
            voidReason: '冻结已失效，该标作废',
          });
        }
        continue;
      }
      if (!champion) {
        champion = b;
        continue;
      }
      if (await resolveBid(env, b.id, 'lost', '')) {
        lost++;
        await queueClubNotification(env, b.club_id, 'sea_sealed_lost', { player: first.player_name, reason: 'outbid' });
      }
    }
    if (!champion) continue;
    const signFee = freeAgentFee(champion.new_release_fee);
    // 建单在前、标定局在后（同 reason 重放能自愈：已有 sealed_bid_id 的单直接复用，不再重复建单）
    const existingTransfer = await db
      .prepare(`SELECT id FROM transfers WHERE sealed_bid_id = ? LIMIT 1`)
      .bind(champion.id)
      .first<{ id: number }>();
    if (!existingTransfer) {
      await createBypassTransfer(env, {
        actor,
        origin,
        type: 'free_agent',
        playerId: champion.player_id,
        fromClubId: champion.player_club_id,
        toClubId: champion.club_id,
        fee: champion.new_release_fee,
        extraFee: null,
        season: batch.season,
        windowSeq: batch.window_seq,
        evidence: { signFee, seaSealed: { batchId: batch.id, bidId: champion.id } },
        payload: {
          kind: 'free_agent',
          playerId: champion.player_id,
          playerName: champion.player_name,
          clubId: champion.club_id,
          newReleaseFee: champion.new_release_fee,
          signFee,
          season: batch.season,
          windowSeq: batch.window_seq,
          seaSealed: { batchId: batch.id, bidId: champion.id },
        },
        action: 'bypass_sea_sealed_win',
        sealedBidId: champion.id,
      });
    }
    const marked = await db
      .prepare(`UPDATE sea_sealed_bids SET status = 'won', resolved_at = ${nowSql()} WHERE id = ? AND status = 'sealed'`)
      .bind(champion.id)
      .run();
    if ((marked.meta.changes ?? 0) > 0) {
      won++;
      winners.add(champion.club_id);
      await queueClubNotification(env, champion.club_id, 'sea_sealed_lead', {
        player: champion.player_name,
        amount: champion.new_release_fee,
        signFee,
        batchId: batch.id,
      });
    }
  }

  const audit = createAuditStatement(db);
  await db.batch([
    db
      .prepare(`UPDATE sea_batches SET status = 'opened', opened_at = ${nowSql()}, opened_by = ? WHERE id = ? AND status = 'settling'`)
      .bind(actor, batchId),
    audit({
      actor,
      action: 'sea_batch_open',
      targetType: 'sea_batch',
      targetId: batchId,
      origin,
      after: {
        season: batch.season,
        windowSeq: batch.window_seq,
        reason: opts.reason,
        deadlineAt: batch.deadline_at,
        won,
        lost,
        voided,
        clubs: participants.size,
      },
    }),
  ]);
  // 开标公告：给参与但没有胜出的球队各一条（胜出方已收 lead 私信，不重复打扰）
  for (const clubId of participants) {
    if (winners.has(clubId)) continue;
    await queueClubNotification(env, clubId, 'sea_batch_open', {
      batchId,
      won,
      clubs: participants.size,
    });
  }
  return { ok: true, batchId, already: false, won, lost, voided };
}

async function resolveBid(env: Env, bidId: number, status: 'lost' | 'void' | 'withdrawn', reason: string): Promise<boolean> {
  const db = env.DB;
  const res = await db.batch([
    db
      .prepare(`UPDATE sea_sealed_bids SET status = ?, void_reason = ?, resolved_at = ${nowSql()} WHERE id = ? AND status = 'sealed'`)
      .bind(status, status === 'lost' ? '' : reason, bidId),
    releaseHoldStatement(db, bidId),
  ]);
  return (res[0]?.meta.changes ?? 0) > 0;
}

/** 关窗钩子：本窗批次还收着标 ⇒ 立即开标（不阻塞关窗；窗口状态此刻已落 closed）。 */
export async function openSealedBatchOnWindowClose(env: Env, actor: number, season: number, windowSeq: number): Promise<number> {
  const db = env.DB;
  if (!(await seaEnabled(db))) return 0;
  const batch = await db
    .prepare(`SELECT id FROM sea_batches WHERE season = ? AND window_seq = ? AND status = 'sealed'`)
    .bind(season, windowSeq)
    .first<{ id: number }>();
  if (!batch) return 0;
  const summary = await openSeaBatch(env, batch.id, actor, 'user', { reason: 'window_close' });
  return summary.already ? 0 : 1;
}

// ---- 到期引擎适配器（到点开标 + 截止前提醒） ----

/**
 * 到点开标：收标中的批次（deadline 已过）逐个开标。closeAll（时刻表行已结束）⇒ 不等 deadline 直接开
 *（运营把暗标段提前收掉，在途标不该继续吊着）。
 * sea_enabled=false 的兜底：两阶段被关掉时，还收着标的批次整批作废并解冻（回到明标，冻结不长期占用）。
 */
export async function expireDueSeaBatches(env: Env, opts: ExpiryOpts): Promise<number> {
  const db = env.DB;
  if (!(await seaEnabled(db))) return await cancelSealedBatches(env, 'sea_disabled', '海捞两阶段已关闭，本批标作废');
  const where = opts.closeAll ? `status = 'sealed'` : `status = 'sealed' AND deadline_at <= ?`;
  const stmt = db.prepare(`SELECT id FROM sea_batches WHERE ${where} ORDER BY id LIMIT ?`);
  const res = opts.closeAll
    ? await stmt.bind(opts.limit).all<{ id: number }>()
    : await stmt.bind(opts.nowIso, opts.limit).all<{ id: number }>();
  let opened = 0;
  for (const row of res.results) {
    const summary = await openSeaBatch(env, row.id, null, opts.origin, { reason: opts.closeAll ? 'ops_end' : 'deadline' });
    if (!summary.already) opened++;
  }
  return opened;
}

/** 关闭两阶段时的收尾：把还收着标的批次全批作废 + 解冻（不静默留下冻结）。 */
async function cancelSealedBatches(env: Env, note: string, reason: string): Promise<number> {
  const db = env.DB;
  const res = await db.prepare(`SELECT id FROM sea_batches WHERE status = 'sealed' LIMIT 20`).all<{ id: number }>();
  for (const row of res.results) await cancelSeaBatch(env, row.id, null, 'machine', note, reason);
  return 0;
}

/** 截止前提醒：还有标在收的球队各提醒一次（批次级 reminded_at 抢占）。 */
export async function remindDueSeaBatches(env: Env, opts: ExpiryOpts): Promise<number> {
  const db = env.DB;
  if (!(await seaEnabled(db)) || opts.remindLeadHours <= 0) return 0;
  const leadTo = new Date(Date.parse(opts.nowIso) + opts.remindLeadHours * 3600_000).toISOString();
  const res = await db
    .prepare(
      `SELECT id, deadline_at FROM sea_batches
        WHERE status = 'sealed' AND reminded_at = '' AND deadline_at > ? AND deadline_at <= ?
        ORDER BY id LIMIT ?`,
    )
    .bind(opts.nowIso, leadTo, opts.limit)
    .all<{ id: number; deadline_at: string }>();
  let sent = 0;
  for (const row of res.results) {
    const claimed = await db
      .prepare(`UPDATE sea_batches SET reminded_at = ? WHERE id = ? AND status = 'sealed' AND reminded_at = ''`)
      .bind(opts.nowIso, row.id)
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue;
    const clubs = await db
      .prepare(`SELECT club_id, COUNT(*) AS n FROM sea_sealed_bids WHERE batch_id = ? AND status = 'sealed' GROUP BY club_id`)
      .bind(row.id)
      .all<{ club_id: number; n: number }>();
    const deadline = fmtBeijingMinute(row.deadline_at);
    for (const c of clubs.results) {
      await queueClubNotification(env, c.club_id, 'sea_sealed_deadline', { deadline, count: c.n, batchId: row.id });
    }
    if (clubs.results.length > 0) sent++;
  }
  return sent;
}

// ---- 管理端（立即开标 / 延长 / 取消 + 逐标明账） ----

export interface SeaAdminBidRow {
  bidId: number;
  playerId: number;
  playerName: string;
  clubId: number;
  clubName: string;
  newReleaseFee: number;
  status: SeaBidStatus;
  holdStatus: string | null;
  voidReason: string;
  submittedAt: string | null;
  updatedAt: string | null;
}

export interface SeaAdminView {
  enabled: boolean;
  batch: (SeaPhaseView['batch'] & { note: string; remindedAt: string }) | null;
  bids: SeaAdminBidRow[];
  summary: { players: number; bids: number; clubs: number; top: number };
}

export async function loadSeaAdminView(env: Env): Promise<SeaAdminView> {
  const db = env.DB;
  const enabled = await seaEnabled(db);
  const window = await getOpenWindow(db);
  const batch = window ? await findBatch(db, window.season, window.windowSeq) : null;
  if (!batch) return { enabled, batch: null, bids: [], summary: { players: 0, bids: 0, clubs: 0, top: 0 } };
  const res = await db
    .prepare(
      `SELECT s.id, s.player_id, ${sqlDisplayName('p')} AS player_name, s.club_id, COALESCE(c.name, '—') AS club_name,
              s.new_release_fee, s.status, s.void_reason, s.submitted_at, s.updated_at, h.status AS hold_status
         FROM sea_sealed_bids s
         JOIN players p ON p.id = s.player_id
         LEFT JOIN clubs c ON c.id = s.club_id
         LEFT JOIN fund_holds h ON h.id = s.hold_id
        WHERE s.batch_id = ?
        ORDER BY s.player_id ASC, s.new_release_fee DESC, s.id ASC`,
    )
    .bind(batch.id)
    .all<{
      id: number;
      player_id: number;
      player_name: string;
      club_id: number;
      club_name: string;
      new_release_fee: number;
      status: SeaBidStatus;
      void_reason: string;
      submitted_at: string | null;
      updated_at: string | null;
      hold_status: string | null;
    }>();
  const bids: SeaAdminBidRow[] = res.results.map((r) => ({
    bidId: r.id,
    playerId: r.player_id,
    playerName: r.player_name,
    clubId: r.club_id,
    clubName: r.club_name,
    newReleaseFee: r.new_release_fee,
    status: r.status,
    holdStatus: r.hold_status,
    voidReason: r.void_reason,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
  }));
  return {
    enabled,
    batch: {
      id: batch.id,
      season: batch.season,
      windowSeq: batch.window_seq,
      status: batch.status,
      sealedAt: batch.sealed_at,
      deadlineAt: batch.deadline_at,
      openedAt: batch.opened_at,
      note: batch.note,
      remindedAt: batch.reminded_at,
    },
    bids,
    summary: {
      players: new Set(bids.map((b) => b.playerId)).size,
      bids: bids.length,
      clubs: new Set(bids.map((b) => b.clubId)).size,
      top: bids.reduce((max, b) => (b.newReleaseFee > max ? b.newReleaseFee : max), 0),
    },
  };
}

/** 管理端立即开标（force=true 收正在 open 途中的批次）。 */
export async function openNow(
  env: Env,
  actor: number | null,
  batchIdInput?: unknown,
  reason: 'manual' | 'ops_end' = 'manual',
): Promise<SeaOpenSummary> {
  const batch = await requireBatchForAdmin(env, batchIdInput);
  return openSeaBatch(env, batch.id, actor, 'user', { reason, force: true });
}

/**
 * 延长暗标段：批次的 deadline 与时刻表那一行是同一把尺子，两处一起推——
 * 只改批次会被时刻表「到点结束 + 收口在途」先一步开标，延长期望落空。
 */
export async function extendSeaBatch(
  env: Env,
  actor: number | null,
  deadlineInput: unknown,
  batchIdInput?: unknown,
): Promise<SeaBatchRow> {
  const db = env.DB;
  const deadline = typeof deadlineInput === 'string' ? deadlineInput : '';
  const ms = Date.parse(deadline);
  if (!deadline || Number.isNaN(ms)) throw new HttpError(400, '新截止时间要填 ISO 字符串');
  if (ms <= Date.now()) throw new HttpError(400, '新截止时间要晚于现在');
  const batch = await requireBatchForAdmin(env, batchIdInput);
  if (batch.status !== 'sealed') throw new HttpError(409, '只有收标中的批次能延长');
  const row = (await loadOpsRows(db)).get('transfer_sea_sealed');
  if (row && row.endAnchor === 'absolute') {
    // 校验先做（saveOpsRow 也会校验，这里提前抛能避免「批次已改、时刻表没改」的半截状态）
    if (row.startAnchor === 'absolute' && row.startAt && ms <= Date.parse(row.startAt)) {
      throw new HttpError(400, '新截止时间要晚于暗标段起点');
    }
    await saveOpsRow(
      env,
      'transfer_sea_sealed',
      {
        startAnchor: row.startAnchor,
        startAt: row.startAt,
        endAnchor: 'absolute',
        endAt: deadline,
        requiresWindow: row.requiresWindow,
        closeInflight: row.closeInflight,
        note: row.note,
      },
      actor,
    );
  }
  const audit = createAuditStatement(db);
  const res = await db.batch([
    db
      .prepare(`UPDATE sea_batches SET deadline_at = ?, reminded_at = '', note = ? WHERE id = ? AND status = 'sealed'`)
      .bind(deadline, `截止延长到 ${fmtBeijingMinute(deadline)}`, batch.id),
    audit({
      actor,
      action: 'sea_batch_extend',
      targetType: 'sea_batch',
      targetId: batch.id,
      origin: 'user',
      before: { deadlineAt: batch.deadline_at },
      after: { deadlineAt: deadline, opsRowSynced: !!(row && row.endAnchor === 'absolute') },
    }),
  ]);
  if ((res[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, '批次刚被开标，延长没落下');
  const next = await db.prepare(`SELECT * FROM sea_batches WHERE id = ?`).bind(batch.id).first<SeaBatchRow>();
  return next!;
}

/**
 * 取消本窗批次：全部标作废 + 全部冻结解冻 + 通知出标方；之后本窗回到常规流程
 *（sea_enabled 仍是 true，但本窗不再重建批次——重启暗标是时刻表的事）。
 */
export async function cancelSeaBatch(
  env: Env,
  batchId: number,
  actor: number | null,
  origin: AuditOrigin,
  note: string,
  reason = '批次已被管理组取消',
): Promise<{ ok: true; voided: number }> {
  const db = env.DB;
  const claim = await db
    .prepare(`UPDATE sea_batches SET status = 'cancelled', note = ?, opened_by = ?, opened_at = ${nowSql()} WHERE id = ? AND status = 'sealed'`)
    .bind(note, actor, batchId)
    .run();
  if ((claim.meta.changes ?? 0) === 0) throw new HttpError(409, '批次不在收标中，取消没落下');
  const bids = await db
    .prepare(
      `SELECT s.id, s.club_id, ${sqlDisplayName('p')} AS player_name
         FROM sea_sealed_bids s JOIN players p ON p.id = s.player_id
        WHERE s.batch_id = ? AND s.status = 'sealed'`,
    )
    .bind(batchId)
    .all<{ id: number; club_id: number; player_name: string }>();
  let voided = 0;
  for (const b of bids.results) {
    if (!(await resolveBid(env, b.id, 'void', reason))) continue;
    voided++;
    await queueClubNotification(env, b.club_id, 'sea_sealed_lost', {
      player: b.player_name,
      reason: 'the_void',
      voidReason: reason,
    });
  }
  const audit = createAuditStatement(db);
  await db.batch([
    audit({
      actor,
      action: 'sea_batch_cancel',
      targetType: 'sea_batch',
      targetId: batchId,
      origin,
      after: { voided, note },
    }),
  ]);
  return { ok: true, voided };
}

export async function cancelCurrentBatch(
  env: Env,
  actor: number | null,
  batchIdInput?: unknown,
  noteInput?: unknown,
): Promise<{ ok: true; voided: number }> {
  const batch = await requireBatchForAdmin(env, batchIdInput);
  const note = typeof noteInput === 'string' && noteInput.trim() !== '' ? noteInput.trim().slice(0, 200) : '管理组取消本窗暗标批次';
  // 管理组写的说明同时当「标作废的原因」发给出标方——教练看到的是人话，不是内部代号
  return cancelSeaBatch(env, batch.id, actor, 'user', note, note);
}

async function requireBatchForAdmin(env: Env, batchIdInput?: unknown): Promise<SeaBatchRow> {
  const db = env.DB;
  const batchId = Number(batchIdInput);
  if (Number.isInteger(batchId) && batchId > 0) {
    const row = await db.prepare(`SELECT * FROM sea_batches WHERE id = ?`).bind(batchId).first<SeaBatchRow>();
    if (!row) throw new HttpError(404, '暗标批次不存在');
    return row;
  }
  const window = await getOpenWindow(db);
  if (!window) throw new HttpError(409, '当前没有开着的转会窗，也没有进行中的暗标批次');
  const row = await findBatch(db, window.season, window.windowSeq);
  if (!row) throw new HttpError(404, '本窗还没有暗标批次');
  return row;
}
