// 球员在途状态读模型（v6.80.0；GLOSSARY「球员在途」词条）。在途 = 活跃挂牌（listings 四态）、
// 待审单据（transfers pending_review）、未结束签约谈判（active 会话）——任一成立即在途。
// 本模块是「这名球员现在能不能动」判定的唯一读源（计划裁决 1 只收读，零写路径）：
// - flowState：批量一等（单查 = 长度 1），每人 { listing, pendingReview, signing } 三个布尔 kind；
// - seaVerdicts：海捞资格七关链（原 bypass.ts checkSeaSignEligible 整体迁入，顺序与文案逐字不变）；
// - ensureNotInFlight：续约 / 解约 / 上调等写路径的一票否决（三档文案逐字不变）。
// 挂牌 dup（routes/market.ts:265 的三态检查）、激活上调锁（activations.ts）、demand 排除集
//（demand-ops.ts）是第二批消费方；routes/market.ts 的 sea-lookup 批量快照副本已于 v6.80.0 第二步
// 退役，端点改吃本模块，「两处口径必须同步改」注释协议与跨实现一致性用例锁一并消灭。
import { HttpError } from '../lib/http.ts';
import { ACTIVE_SESSION_SQL } from './negotiation-guard.ts';
import { cpuClubIds } from './growth.ts';
import type { OpenWindow } from './seasons.ts';

// D1 每查询绑定参数上限 100：分片 ≤98（v6.79.1 惯例，先例 src/worker/routes/players.ts 的
// bindBatchMax），留余量给 season/window 等非 IN 参数。
const SHARD_SIZE = 98;

// —— 谓词双形态并存（计划 v6.80.0 裁决 8：「宁可带兜底，不可破坏判级」）——
// 步骤 0 只读核查（本地 + 生产 `t.status='signing' AND s.status='active'`）：存量 本地 1 / 生产 0，
// 两条谓词只在这类行上分叉，故不能合一：
// ① signing（海捞口径，flowState.signing）= 任意 active 会话，s.player_id 直查、不看单据状态
//    （v6.66.0 起换队单在开谈那一刻已 completed，只有会话能表达「海捞单在签约谈判」）。
// ② negotiation（ensureNotInFlight 的 negotiation kind）= active 会话 JOIN transfers 且
//    t.status <> 'signing'（bypass.ts 旧兜底原样迁入：signing 单据 × 会话开着 = 上调谈判在途，
//    让位给各调用点专门的 findActivePromotionSession 闸；这里只为「单据已结算、条款还没谈定」
//    那一步兜底——否则球员过户后在买方是 normal，全仓没有闸挡住他再挂牌/再激活）。
// ③ seaVerdicts 的 signing 关在 ① 之外保留 transfers.status='signing' 的单据残留兜底
//    （原 findNegotiationInFlight 的后半句：会话还没建出来的历史残留也要拦，判级敏感——
//    tests/market-intel.test.ts 矩阵 610 与测试计划 TC-SV-07 都钉「仍拦在 signing 关」）。

/** 按 SHARD_SIZE 切 id 列表；空数组得 []。 */
function shards(ids: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += SHARD_SIZE) out.push(ids.slice(i, i + SHARD_SIZE));
  return out;
}

export interface PlayerFlowState {
  /** 活跃挂牌：listings.status IN ('listed','bidding','matched_pending','pending_review') 四态之一 */
  listing: boolean;
  /** 待审单据：transfers.status = 'pending_review' */
  pendingReview: boolean;
  /** 签约谈判在途（海捞口径①）：任意 active 会话（s.player_id 直查，不看单据状态） */
  signing: boolean;
}

// 内部装载器：三查按分片批量，每分片 3 条 IN 查询。transfers 一条查询同时取 'pending_review'
//（pendingReview kind）与 'signing'（③ 的单据残留集）——残留不进 flowState 公开 Map，只有
// seaVerdicts 的 signing 关消费。
interface FlowLoad {
  state: Map<number, PlayerFlowState>;
  signingDocs: Set<number>;
}

async function loadFlow(db: D1Database, playerIds: number[]): Promise<FlowLoad> {
  const state = new Map<number, PlayerFlowState>();
  for (const id of playerIds) state.set(id, { listing: false, pendingReview: false, signing: false });
  const signingDocs = new Set<number>();
  for (const part of shards(playerIds)) {
    const ph = part.map(() => '?').join(', ');
    const listed = await db
      .prepare(
        `SELECT player_id FROM listings
         WHERE status IN ('listed', 'bidding', 'matched_pending', 'pending_review') AND player_id IN (${ph})`,
      )
      .bind(...part)
      .all<{ player_id: number }>();
    for (const r of listed.results) {
      const s = state.get(r.player_id);
      if (s) s.listing = true;
    }
    const docs = await db
      .prepare(
        `SELECT player_id, status FROM transfers
         WHERE status IN ('pending_review', 'signing') AND player_id IN (${ph})`,
      )
      .bind(...part)
      .all<{ player_id: number; status: string }>();
    for (const r of docs.results) {
      const s = state.get(r.player_id);
      if (!s) continue;
      if (r.status === 'pending_review') s.pendingReview = true;
      else signingDocs.add(r.player_id);
    }
    const sessions = await db
      .prepare(
        `SELECT s.player_id AS player_id FROM negotiation_sessions s
         WHERE ${ACTIVE_SESSION_SQL} AND s.player_id IN (${ph})`,
      )
      .bind(...part)
      .all<{ player_id: number }>();
    for (const r of sessions.results) {
      const s = state.get(r.player_id);
      if (s) s.signing = true;
    }
  }
  return { state, signingDocs };
}

/**
 * 批量在途三查（v6.80.0 底层）。请求的每个 id 都有键（查无此人三 false）；空数组回空 Map、零查询。
 * 只回布尔 kind、不带行 id；批量消费方（海捞速查 / 未来第二批的挂牌 dup、demand 排除集）复用本函数，
 * 不要再手写四态枚举。
 */
export async function flowState(db: D1Database, playerIds: number[]): Promise<Map<number, PlayerFlowState>> {
  return (await loadFlow(db, playerIds)).state;
}

export type SeaSignStage = 'window' | 'ownership' | 'status' | 'banned' | 'listing' | 'pending' | 'signing' | 'ok';

export interface SeaSignVerdict {
  stage: SeaSignStage;
  ok: boolean;
  /** ok=false 时调用方应抛的 HttpError 状态码 */
  status: number;
  /** ok=false 时给用户看的中文原因 */
  reason: string;
  errCode?: string;
}

/** seaVerdicts 的入参形状（调用方自查 players 行后传入；单人场景传长度 1）。 */
export interface SeaSignPlayer {
  id: number;
  club_id: number | null;
  status: string;
}

/**
 * 海捞资格批量裁定（v6.80.0；原 bypass.ts checkSeaSignEligible 整体迁入改批量）。
 * 七关顺序不得调整：用户看到的拦截原因取决于第一道亮红灯的关——
 * window → ownership → status → banned → listing → pending → signing。
 * CPU 队例外（v2.0.0 用户裁决）：club_id 非空且不在 CPU 集才算有东家；例外只豁免归属关，
 * 后续关照吃。单人场景传长度 1（详情 seaSign / createFreeAgent / 暗标开标同款）。
 */
export async function seaVerdicts(
  db: D1Database,
  players: SeaSignPlayer[],
  win: OpenWindow | null,
): Promise<Map<number, SeaSignVerdict>> {
  const verdicts = new Map<number, SeaSignVerdict>();
  // 关 1 window：全员同判；窗关着时与原单条链一样一条查询都不发
  if (!win) {
    for (const p of players) {
      verdicts.set(p.id, {
        stage: 'window',
        ok: false,
        status: 409,
        reason: '转会窗口没开，现在不能海捞',
        errCode: 'no_window',
      });
    }
    return verdicts;
  }
  const ids = players.map((p) => p.id);
  const cpuIds = await cpuClubIds(db);
  const loaded = await loadFlow(db, ids);
  // 关 4 的禁签集（4.4.4：本转会窗被解约的球员，所有球队本窗都无法签入）——按分片 IN，与原点查同谓词
  const banned = new Set<number>();
  for (const part of shards(ids)) {
    const ph = part.map(() => '?').join(', ');
    const rows = await db
      .prepare(
        `SELECT player_id FROM transfers WHERE type = 'termination' AND status = 'completed'
           AND season = ? AND window_seq = ? AND player_id IN (${ph})`,
      )
      .bind(win.season, win.windowSeq, ...part)
      .all<{ player_id: number }>();
    for (const r of rows.results) banned.add(r.player_id);
  }
  for (const p of players) verdicts.set(p.id, judgeSeaSign(p, cpuIds, banned, loaded));
  return verdicts;
}

// 逐人过七关（关 2 起才逐人判定；取数已批量装好，判定纯内存、检查顺序即契约，文案逐字即判级）
function judgeSeaSign(p: SeaSignPlayer, cpuIds: Set<number>, banned: Set<number>, loaded: FlowLoad): SeaSignVerdict {
  // 海捞 = 签无归属的球员（4.4.4）。CPU 队球员带 club_id 但仍是海里人（v2.0.0）：
  // 出账与落位都按「从 CPU 队签走」处理，不给 CPU 队记任何账。
  if (p.club_id !== null && !cpuIds.has(p.club_id)) {
    return { stage: 'ownership', ok: false, status: 400, reason: '海捞只能签无归属的球员（这名球员有东家）' };
  }
  if (p.status === 'retired' || p.status === 'listed') {
    return { stage: 'status', ok: false, status: 400, reason: '当前状态不能海捞' };
  }
  if (banned.has(p.id)) {
    return { stage: 'banned', ok: false, status: 409, reason: '这名球员本窗口被解约过，本窗口所有球队都不能签他' };
  }
  const fs = loaded.state.get(p.id);
  if (fs?.listing) {
    return { stage: 'listing', ok: false, status: 400, reason: '这名球员已经有一单在市场流程里了，等它结束再操作' };
  }
  if (fs?.pendingReview) {
    return { stage: 'pending', ok: false, status: 400, reason: '这名球员有一张单据正在等管理组审核，先等审核结果' };
  }
  // 关 7 signing：① 任意 active 会话 + ③ signing 单据残留（见顶部谓词说明③）
  if (fs?.signing || loaded.signingDocs.has(p.id)) {
    return {
      stage: 'signing',
      ok: false,
      status: 400,
      reason: '这名球员的海捞单已经进入签约谈判，等它成约或作废再操作',
      errCode: 'sea_signing',
    };
  }
  return { stage: 'ok', ok: true, status: 200, reason: '' };
}

/**
 * 写路径一票否决（原 bypass.ts ensureNotInFlight 迁入，三档文案逐字不变）：按 listing >
 * pending > negotiation 优先序，第一档命中即抛 HttpError 400。negotiation 档用旧连接谓词②
 *（不走 flowState.signing——见顶部谓词说明②，signing 单据 × 会话开着不上这道闸）。
 */
export async function ensureNotInFlight(db: D1Database, playerId: number): Promise<void> {
  const state = await flowState(db, [playerId]);
  const fs = state.get(playerId);
  if (fs?.listing) throw new HttpError(400, '这名球员已经有一单在市场流程里了，等它结束再操作');
  if (fs?.pendingReview) throw new HttpError(400, '这名球员有一张单据正在等管理组审核，先等审核结果');
  // 前两档都过才查旧连接谓词——与原 findInFlight 的短路顺序一致（listing/pending 命中时不发这条查询）
  const negotiation = await db
    .prepare(
      `SELECT s.id FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
        WHERE t.player_id = ? AND ${ACTIVE_SESSION_SQL} AND t.status <> 'signing' LIMIT 1`,
    )
    .bind(playerId)
    .first<{ id: number }>();
  if (negotiation) throw new HttpError(400, '这名球员已经成交，还有一场签约谈判没结束，等它结束再操作');
}
