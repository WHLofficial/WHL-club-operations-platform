// 闹涨薪引擎（v6.54.0 步骤 3，设计文档
// docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md rev20）：
//   §5.1/§8  triggerDemandBatch —— 常规开窗生成：本地门槛（normal/formal/wage>0/gap≥8%）→
//            近 10 场 + 排名 + 工资中位数的倾向分 → 概率 p（通胀再提恒 1.0）→ 确定性闸
//            roll = seededUnit([season, window, player], 20) → PPS 加权无放回抽样收口
//            6 条/队（§5.1 硬上限，owner 拍板 #7，通胀球员以 p=1.0 参与同批 PPS——key 除数
//            更小、天然优先占槽，但上限仍绝对）；幂等闸 = UNIQUE(player_id, season, window_seq)
//            + INSERT OR IGNORE，重跑零新增。通胀与升档参数在生成时落行：target/floor/rc_floor
//            按通胀公式算死（行上不存 mode 列，raise_pct/rc_floor 即形态）。
//   §5.3     counterDemand —— 还价 POST 同请求即时判定（judgeCounter，判定种子钉
//            seededUnit([demand_id, round], 21)）；「谈判中」不落持久 countered 态——
//            status 保持 pending、round 推进（呈现层按 round>0 显示「第 N/3 轮」）。
//   §5.3/§5.7 acceptDemand —— 接受写 contract_pending_changes(source='demand', rc_fee=0)，
//            contracts 关窗前一字不动；同批摘除存续「不满」徽章 / 关闭未挂牌申请（重签语义）。
//   §5.4     rejectDemand —— 直拒三件套：rejection pending（protection_ticks 置已过=0、
//            价格两列原样不动）+ demand_rejected_public 全联盟通告 + transfer_requests
//            released「不满」徽章；同批原子。
//   §8/§11.1 expireDemands —— cron 兜底：TTL 到点置 expired（不生成申请）；24h 截止提醒
//            reminded_at 一次性闸（同 0050 事件域模式）；段内第 2 次终局（含 expired，
//            挂牌驱赶的不计——载体 void_reason='listing'）升档走直拒三件套。
//   §5.4/§5.7 voidDemandStatements —— 离队作废：只**返回语句**给调用方并进 completeTransfer
//            同批（设计 §5.4「作废语句挂 completeTransfer 批内、只对 !amendment 生效」），
//            本模块不自行提交。
// 成熟模式照搬 event-ops（v6.11.0 教训）：效果语句全部带「demand 仍 pending/countered」守卫
// （INSERT…SELECT…WHERE），终局 claim UPDATE 放批末并以 meta.changes 判 409——并发抢行时
// 输家整批成为 no-op（守卫在本批求值时读到的已是赢家提交后的状态），不产生半套后果。
import type { Env } from './env.ts';
import { HttpError } from '../lib/http.ts';
import { createAuditStatement, type AuditOrigin } from '../lib/audit.ts';
import { createConfigService } from '../core/config.ts';
import { queueAllUserClubsNotification, queueClubNotification } from './notify.ts';
import { loadNegotiationContext, type NegotiationContext } from './negotiation-context.ts';
import { expectedWage, previewForecast, successRate } from './negotiation-secret.ts';
import { abilityLevel } from '../core/negotiation-rules.ts';
import { POSITION_GROUP_BY_POSITION } from '../core/fc26.ts';
import { fmtBeijingMinute } from '../core/ops-schedule.ts';
import { round2 } from '../core/market-rules.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { DEFAULT_WAGE_CAP_BY_TIER } from '../core/squad-rules.ts';
import { deriveClubTier, tierCache, type Tier } from './tier.ts';
import { getOpenWindow, getVisibleSeason } from './seasons.ts';
import {
  DEMAND_MAX_ROUNDS,
  DEMANDS_PER_CLUB,
  computeDemandAmounts,
  computeRcFloor,
  demandExpiresAt,
  demandFires,
  demandGateRoll,
  demandScore,
  escalatesToDirect,
  judgeCounter,
  meetsDemandGate,
  ppsPickDemands,
  segmentFinals,
  type DemandFinalKind,
  type DemandFinalRecord,
  type DemandRaiseMode,
  type DemandScoreInput,
} from '../core/demand-rules.ts';

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

/** demand 仍可操作的状态守卫：效果语句与审计共用的幂等/并发闸（claim UPDATE 在批末）。 */
const DEMAND_OPEN_GUARD = `(SELECT status FROM contract_demands WHERE id = ?) IN ('pending','countered')`;

// ---------------------------------------------------------------------------
// §5.1/§8 生成批
// ---------------------------------------------------------------------------

export interface TriggerDemandInput {
  season: number;
  windowSeq: number;
  /** 注入当前时刻（epoch ms，测试用）；缺省 Date.now()。expires_at 与 created_at 的基准。 */
  nowMs?: number;
  /** 审计通道：开窗批/cron 幂等补跑走 cron_tick，管理端手动补生成走 user。缺省 cron_tick。 */
  origin?: AuditOrigin;
  actor?: number | null;
}

export interface TriggerDemandResult {
  season: number;
  windowSeq: number;
  /** 新生成条数（同窗幂等重跑 = 0） */
  created: number;
  perClub: Array<{ clubId: number; created: number }>;
}

/** 名册行（一次 JOIN 出合同 + 球员 + 本季注册位） */
interface RosterRow {
  pid: number;
  name: string;
  ca: number | null;
  pa: number | null;
  age: number | null;
  position: string | null;
  status: string | null;
  is_future_star: number | null;
  agent_tier: number | null;
  wage: number | null;
  release_fee: number | null;
  contract_type: string | null;
  squad: string | null;
}

/** 生成候选（PPS 抽样的载体；字段名对齐 core 的 ppsPickDemands 约束） */
interface DemandCandidate {
  playerId: number;
  p: number;
  wage: number;
  rc: number;
  expected: number;
  mode: DemandRaiseMode;
  score: number;
  name: string;
}

/** 本地门槛（§5.1）：不碰库的部分；返回算好的预期工资。 */
function localGate(row: RosterRow, ctx: NegotiationContext): { wage: number; rc: number; expected: number } | null {
  if (row.status !== 'normal') return null; // 挂牌中/自由身/退役/训练营状态整体排除
  if (row.contract_type !== 'formal') return null;
  const wage = row.wage;
  if (wage === null || !(wage > 0)) return null;
  if (row.ca === null || row.pa === null || row.age === null) return null;
  const rc = row.release_fee ?? 0;
  // 无 RC 合同按系统 RC 下限 1m 作为预期锚（规则 4.3.1 下限；expectedWage(rc=0)=0 会把
  // wage-only 球员整体挡死，违背 TC-RD-01 #2「资格不因无 RC 被排除，只退化为不提 floor」）
  const anchorRc = rc > 0 ? rc : 1;
  const level = abilityLevel(row.ca, row.pa, row.age, ctx.youngBlendAge);
  const expected = expectedWage(level, anchorRc, ctx.wageParamA, ctx.wageParamB, ctx.wageParamC);
  if (!meetsDemandGate(wage, expected)) return null;
  return { wage, rc, expected };
}

/** 工资中位数（本队 active 合同；无数据回 null → core 落 valueScore 0.5） */
function medianWage(wages: number[]): number | null {
  if (wages.length === 0) return null;
  const sorted = [...wages].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * 常规开窗生成批（§8 伪代码的落地）。窗口必须存在、open、非临时窗，否则静默返回 0 条
 * （调用方在 openWindow 成功后 / scheduledTick 幂等补跑时调用，失败不该阻塞开窗）。
 */
export async function triggerDemandBatch(env: Env, input: TriggerDemandInput): Promise<TriggerDemandResult> {
  const db = env.DB;
  const season = input.season;
  const windowSeq = input.windowSeq;
  const result: TriggerDemandResult = { season, windowSeq, created: 0, perClub: [] };

  const win = await db
    .prepare('SELECT season, window_seq, status, is_temporary, opened_at FROM season_windows WHERE season = ? AND window_seq = ?')
    .bind(season, windowSeq)
    .first<{ status: string; is_temporary: number | null; opened_at: string | null }>();
  // 临时窗不生成（关窗不扣工资，免费涨薪会破坏经济，§5.1）；窗未开同理
  if (win === null || win.status !== 'open' || (win.is_temporary ?? 0) === 1) return result;

  // 关窗时刻 = opened_at + window_length_hours（venue-reminders 同口径的估算；开着的窗没有
  // 落库的 closed_at）。opened_at 脏行不猜关窗时刻，expires_at 退化为纯 3 日 TTL。
  const openedMs = win.opened_at === null ? Number.NaN : Date.parse(win.opened_at);
  const hours = (await createConfigService(db).getNumber('window_length_hours')) ?? 168;
  const windowCloseMs = Number.isFinite(openedMs) ? openedMs + hours * 3600_000 : Number.POSITIVE_INFINITY;

  const nowMs = input.nowMs ?? Date.now();
  const origin: AuditOrigin = input.origin ?? 'cron_tick';
  const audit = createAuditStatement(db);
  const ctx = await loadNegotiationContext(db);

  // 只生成真人俱乐部的（CPU 队 P0 不生成，§14.1 #5）
  const clubs = await db
    .prepare(`SELECT id FROM clubs WHERE is_cpu = 0 AND status = 'active' ORDER BY id`)
    .all<{ id: number }>();
  if (clubs.results.length === 0) return result;

  // 全局排除集（一次查全量，逐队内存过滤，避免 N+1）：
  //  ① 在途 pending 合同变更（ensure 幂等补跑可能在窗中途执行，需排除，§5.1 硬门槛）
  const pendingChanges = new Set(
    (await db.prepare(`SELECT DISTINCT player_id FROM contract_pending_changes WHERE status = 'pending'`).all<{ player_id: number }>()).results.map(
      (r) => r.player_id,
    ),
  );
  //  ② 未终局签约谈判 session（active + signing，与关窗检查同口径 window-machine.ts:331）
  const signingSessions = new Set(
    (
      await db
        .prepare(
          `SELECT s.player_id AS pid FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id
           WHERE s.status = 'active' AND t.status = 'signing'`,
        )
        .all<{ pid: number }>()
    ).results.map((r) => r.pid),
  );
  //  ③ 在途转会（待审/谈判中）——挂牌中由 players.status='normal' 排除
  const inflightTransfers = new Set(
    (
      await db.prepare(`SELECT DISTINCT player_id FROM transfers WHERE status IN ('pending_review','signing')`).all<{ player_id: number }>()
    ).results.map((r) => r.player_id),
  );
  //  ④ 存续转会申请（pending/listed）期间不再生成（§14.1 #7）；released（直拒档）例外——
  //     徽章挂着但下窗仍必再提（TC-RD-34 #8b「direct 终局 released 存续仍生成」）
  const openRequests = (
    await db.prepare(`SELECT player_id, club_id FROM transfer_requests WHERE status IN ('pending','listed')`).all<{
      player_id: number;
      club_id: number;
    }>()
  ).results;
  const hasOpenRequest = (playerId: number, clubId: number) =>
    openRequests.some((r) => r.player_id === playerId && r.club_id === clubId);

  //  ⑤ 买回额度占位行（status='void'、void_reason='return'，见 transfers.ts 的 B 分支）不再参与
  //     本窗生成：这类行只是 UNIQUE 额度载体，若留在候选池里会白吃一个 6 条/队的 PPS 槽位。
  //     **只排除占位行**——正常 demand（pending/accepted/expired…）必须继续留在候选池里，
  //     否则同窗 ensure 幂等重跑时候选集会收缩、当初落选的球员反而被选中（二次生成），
  //     那正是 UNIQUE + INSERT OR IGNORE 要防的「重跑零新增」被破坏。
  const returnQuotaPlayers = new Set(
    (
      await db
        .prepare(
          `SELECT player_id FROM contract_demands
           WHERE season = ? AND window_seq = ? AND status = 'void' AND void_reason = 'return'`,
        )
        .bind(season, windowSeq)
        .all<{ player_id: number }>()
    ).results.map((r) => r.player_id),
  );
  //  ⑥ 入队时刻（段锚）：一次 GROUP BY 捞全量（transfers 量级千行、生成批只跑一次，免逐球员 N+1）。
  //     排除 amendment 两型（rc_change/match 是留队续约/匹配，不产生入队事件 ⇒ 段不重锚，
  //     同队续约不清零）；free_agent/transfer/activation/forced_auction 都是入队 ⇒ 重锚。
  const joinedAtMap = new Map<string, number>(
    (
      await db
        .prepare(
          `SELECT player_id, to_club_id, MAX(completed_at) AS joined_at FROM transfers
           WHERE status = 'completed' AND type NOT IN ('rc_change','match') AND to_club_id IS NOT NULL
           GROUP BY player_id, to_club_id`,
        )
        .all<{ player_id: number; to_club_id: number; joined_at: string }>()
    ).results.map((r) => [`${r.player_id}:${r.to_club_id}`, Date.parse(r.joined_at)]),
  );
  const joinedMsOf = (playerId: number, clubId: number): number | null => {
    const ms = joinedAtMap.get(`${playerId}:${clubId}`);
    return ms !== undefined && Number.isFinite(ms) ? ms : null;
  };
  //  ⑥ 历史终局（通胀必再提的输入）：rejected 任意档 + expired；挂牌驱赶的过期带
  //     void_reason='listing'（§11.2 挂牌自动过期不计终局；载体见本文件头注）
  const priorFinalRows = (
    await db
      .prepare(
        `SELECT player_id, club_id, status, resolution, void_reason, resolved_at FROM contract_demands
         WHERE status IN ('rejected','expired') AND resolved_at IS NOT NULL`,
      )
      .all<{ player_id: number; club_id: number; status: string; resolution: string | null; void_reason: string | null; resolved_at: string }>()
  ).results;

  /**
   * 球员×俱乐部的段内可计数终局。段锚 = joinedMs（最近一次「入队该俱乐部」的完成时刻）；
   * joinedMs = null（该俱乐部从无 completeTransfer 入队行 ⇒ 只能是导入初始归属且从未离开）
   * 传 null 给 segmentFinals——全历史就是一段，只按 clubId 圈定。锚绝不能用现行合同
   * signed_at（core/demand-rules.ts 的警告）：amendment 分支也刷 signed_at（跨窗续约会洗掉
   * 计数）、买回 A 分支恢复快照旧值（旧段终局混进新段），两个洞 signed_at 兜底都堵不住。
   */
  const segmentCount = (playerId: number, clubId: number, joinedMs: number | null): number => {
    const records: DemandFinalRecord[] = priorFinalRows
      .filter((r) => r.player_id === playerId)
      .map((r) => ({
        kind: (r.status === 'expired'
          ? 'expired'
          : r.resolution === 'direct' || r.resolution === 'lowball'
            ? r.resolution
            : 'collapse') as DemandFinalKind, // 历史行 resolution 只可能是 direct/collapse/lowball；异常值按 collapse 计（同为可计数档）
        clubId: r.club_id,
        at: Date.parse(r.resolved_at),
        byListing: r.void_reason === 'listing',
      }));
    return segmentFinals(records, clubId, joinedMs !== null && Number.isFinite(joinedMs) ? joinedMs : null).length;
  };

  for (const club of clubs.results) {
    const clubId = club.id;
    const roster = (
      await db
        .prepare(
          `SELECT p.id AS pid, p.name, p.ca, p.pa, p.age, p.position, p.status, p.is_future_star, p.agent_tier,
                  c.wage, c.release_fee, c.contract_type, r.squad
           FROM contracts c
           JOIN players p ON p.id = c.player_id
           LEFT JOIN registrations r ON r.player_id = p.id AND r.season = ? AND r.club_id = c.club_id
           WHERE c.is_active = 1 AND c.club_id = ?`,
        )
        .bind(season, clubId)
        .all<RosterRow>()
    ).results;

    // 工资中位数口径 = 本队全部 active 合同（不先过其他门槛，§5.1「本队 active 合同工资中位数」）
    const wages = roster.map((r) => r.wage).filter((w): w is number => w !== null && w > 0);
    const clubWageMedian = medianWage(wages);

    // 第一遍：本地门槛 + 库侧排除 → 分出通胀（必再提）与普通两路
    const inflation: DemandCandidate[] = [];
    const normalRows: Array<{ row: RosterRow; wage: number; rc: number; expected: number }> = [];
    for (const row of roster) {
      const gated = localGate(row, ctx);
      if (gated === null) continue;
      if (pendingChanges.has(row.pid)) continue;
      if (signingSessions.has(row.pid)) continue;
      if (inflightTransfers.has(row.pid)) continue;
      if (hasOpenRequest(row.pid, clubId)) continue;
      if (returnQuotaPlayers.has(row.pid)) continue;
      if (segmentCount(row.pid, clubId, joinedMsOf(row.pid, clubId)) > 0) {
        // 段内已有终局 → 下窗必再提（p=1.0 绕过概率闸与倾向分，§11.1），按通胀公式开价
        inflation.push({ playerId: row.pid, p: 1, wage: gated.wage, rc: gated.rc, expected: gated.expected, mode: 'inflation', score: 0, name: row.name });
      } else {
        normalRows.push({ row, ...gated });
      }
    }

    // 普通路：近 10 场表现（last 10 场 = 最近 10 条 appearance 事件，配对同场 rating 补录值）
    const formMap = new Map<number, { avgRating10: number; apps10: number }>();
    if (normalRows.length > 0) {
      const pids = normalRows.map((r) => r.row.pid);
      const formRows = (
        await db
          .prepare(
            `SELECT pid, COUNT(*) AS apps, AVG(rating) AS avg_rating FROM (
               SELECT ge.player_id AS pid, ge.match_ref,
                      ROW_NUMBER() OVER (PARTITION BY ge.player_id ORDER BY ge.id DESC) AS rn,
                      (SELECT r.value FROM growth_events r WHERE r.player_id = ge.player_id
                         AND r.match_ref = ge.match_ref AND r.event_type = 'rating' LIMIT 1) AS rating
               FROM growth_events ge
               WHERE ge.event_type = 'appearance' AND ge.player_id IN (${pids.map(() => '?').join(',')})
             )
             WHERE rn <= 10
             GROUP BY pid`,
          )
          .bind(...pids)
          .all<{ pid: number; apps: number; avg_rating: number | null }>()
      ).results;
      for (const f of formRows) {
        // 有出场但整段无评分 → 评分取中性 6.0（表现分只剩出场项；不把补录缺失当 0 分罚）
        formMap.set(f.pid, { avgRating10: f.avg_rating ?? 6.0, apps10: f.apps });
      }
    }

    // 排名 / 位置组（只数 first_team；位置四档用 fc26 的 GK/DF/MF/FW——设计稿写 DEF/MID/FWD，
    // 本仓既有四档口径同义，沿用代码现状）
    const firstTeam = normalRows.filter((r) => r.row.squad === 'first_team' && r.row.ca !== null);
    const caOrder = [...firstTeam].sort((a, b) => (b.row.ca ?? 0) - (a.row.ca ?? 0));
    const caRank = new Map(caOrder.map((r, i) => [r.row.pid, i + 1]));
    const posRank = new Map<number, number>();
    const posCount = new Map<string, number>();
    for (const key of new Set(firstTeam.map((r) => POSITION_GROUP_BY_POSITION[r.row.position ?? ''] ?? 'MF'))) {
      const group = firstTeam.filter((r) => (POSITION_GROUP_BY_POSITION[r.row.position ?? ''] ?? 'MF') === key);
      posCount.set(key, group.length);
      [...group]
        .sort((a, b) => (b.row.ca ?? 0) - (a.row.ca ?? 0))
        .forEach((r, i) => posRank.set(r.row.pid, i + 1));
    }

    const normal: DemandCandidate[] = [];
    for (const { row, wage, rc, expected } of normalRows) {
      const recent = formMap.get(row.pid) ?? null; // 无近 10 场 → core 落中性 0.4/0.3（§5.1）
      const isFT = row.squad === 'first_team';
      const group = POSITION_GROUP_BY_POSITION[row.position ?? ''] ?? 'MF';
      const scoreInput: DemandScoreInput = {
        wage,
        expected,
        ca: row.ca ?? 0,
        pa: row.pa ?? 0,
        age: row.age ?? 0,
        isFutureStar: (row.is_future_star ?? 0) === 1,
        agentTier: Math.min(3, Math.max(1, Math.round(row.agent_tier ?? 2))) as 1 | 2 | 3,
        firstTeam: isFT,
        recent,
        caRankInClub: caRank.get(row.pid) ?? 1,
        nFirstTeam: Math.max(firstTeam.length, 1),
        caRankInPosition: posRank.get(row.pid) ?? 1,
        nPosition: Math.max(posCount.get(group) ?? 1, 1),
        clubWageMedian,
      };
      const breakdown = demandScore(scoreInput);
      normal.push({ playerId: row.pid, p: breakdown.p, wage, rc, expected, mode: 'normal', score: breakdown.score, name: row.name });
    }

    // 确定性闸（通胀 p=1.0 恒过）→ PPS 加权无放回抽样收口 6 条/队
    const candidates = [...inflation, ...normal].filter((c) => demandFires(season, windowSeq, c.playerId, c.p));
    const picks = ppsPickDemands(candidates, season, windowSeq, DEMANDS_PER_CLUB);

    let created = 0;
    const audits: D1PreparedStatement[] = [];
    const notices: Array<{ demandId: number; playerId: number; name: string; target: number; wage: number; rcFrom: number; rcTo: number | null; deadline: string }> = [];
    for (const pick of picks) {
      // 金额与 floor 在生成时按形态（普通/通胀）算死落行；target ≤ wage 的保险丝不应触发
      // （本地门槛已保证 gap ≥ 8%），坏数据宁可跳过也不落一条倒挂的要求
      const amounts = computeDemandAmounts({ wage: pick.wage, expected: pick.expected, mode: pick.mode, wageMax: ctx.wageMax });
      if (amounts === null) continue;
      const rcFloor = computeRcFloor({ currentRc: pick.rc, score: pick.score, mode: pick.mode });
      const expiresIso = new Date(demandExpiresAt(nowMs, windowCloseMs)).toISOString();
      // seed 落生成闸 roll 的整数快照（列是 INTEGER；闸本身可由 (season, window, player) 重算，
      // 这里只作审计留痕），还价判定与它无关——那是 seededUnit([demand_id, round], 21)
      const seed = Math.round(demandGateRoll(season, windowSeq, pick.playerId) * 1e9);
      const inserted = await db
        .prepare(
          `INSERT OR IGNORE INTO contract_demands
             (player_id, club_id, season, window_seq, status, current_wage, expected_wage, target_wage,
              floor_wage, raise_pct, rc_current, rc_floor, rc_fee, round, expires_at, seed)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        )
        .bind(
          pick.playerId,
          clubId,
          season,
          windowSeq,
          pick.wage,
          pick.expected,
          amounts.target,
          amounts.floorWage,
          amounts.raisePct,
          pick.rc,
          rcFloor,
          expiresIso,
          seed,
        )
        .run();
      if ((inserted.meta.changes ?? 0) === 0) continue; // 同窗唯一键幂等：重跑/并发零新增
      const demandId = Number(inserted.meta.last_row_id ?? 0);
      created++;
      audits.push(
        audit({
          actor: input.actor ?? null,
          action: 'demand_create',
          targetType: 'contract_demand',
          targetId: demandId,
          origin,
          after: {
            playerId: pick.playerId,
            clubId,
            season,
            windowSeq,
            mode: pick.mode,
            p: pick.p,
            score: pick.score,
            gateRoll: seed / 1e9,
            target: amounts.target,
            floorWage: amounts.floorWage,
            rcCurrent: pick.rc,
            rcFloor,
            rcFee: 0,
            expiresAt: expiresIso,
          },
        }),
      );
      notices.push({
        demandId,
        playerId: pick.playerId,
        name: pick.name,
        target: amounts.target,
        wage: pick.wage,
        rcFrom: pick.rc,
        rcTo: rcFloor > 0 ? rcFloor : null,
        deadline: fmtBeijingMinute(expiresIso),
      });
    }
    if (audits.length > 0) await db.batch(audits);
    // 通知尽力而为（queueClubNotification 自吞错）：生成不因通知失败回滚。
    // data.demandId 进 payload（深链 /market/desk?tab=negotiations&demand=<id>，设计 §10.1）
    for (const n of notices) {
      await queueClubNotification(env, clubId, 'demand_created', {
        demandId: n.demandId,
        playerId: n.playerId,
        player: n.name,
        target: n.target,
        wage: n.wage,
        rcFrom: n.rcFrom,
        rcTo: n.rcTo,
        deadline: n.deadline,
      });
    }
    if (created > 0) result.perClub.push({ clubId, created });
    result.created += created;
  }

  return result;
}// ---------------------------------------------------------------------------
// 公共装载与守卫（谈判 / 终局共用）
// ---------------------------------------------------------------------------

interface DemandOpRow {
  id: number;
  player_id: number;
  club_id: number;
  season: number;
  window_seq: number;
  status: string;
  current_wage: number;
  expected_wage: number;
  target_wage: number;
  floor_wage: number;
  rc_current: number;
  rc_floor: number;
  round: number;
  expires_at: string;
  player_name: string | null;
  club_name: string | null;
  agent_tier: number | null;
  contract_wage: number | null;
  contract_rc: number | null;
  contract_club_id: number | null;
  contract_active: number | null;
}

async function loadDemandRow(db: D1Database, demandId: number): Promise<DemandOpRow | null> {
  return db
    .prepare(
      `SELECT d.id, d.player_id, d.club_id, d.season, d.window_seq, d.status,
              d.current_wage, d.expected_wage, d.target_wage, d.floor_wage, d.rc_current, d.rc_floor,
              d.round, d.expires_at,
              p.name AS player_name, cl.name AS club_name, p.agent_tier AS agent_tier,
              c.wage AS contract_wage, c.release_fee AS contract_rc,
              c.club_id AS contract_club_id, c.is_active AS contract_active
       FROM contract_demands d
       LEFT JOIN players p ON p.id = d.player_id
       LEFT JOIN clubs cl ON cl.id = d.club_id
       LEFT JOIN contracts c ON c.player_id = d.player_id
       WHERE d.id = ?`,
    )
    .bind(demandId)
    .first<DemandOpRow>();
}

async function windowStatusOf(db: D1Database, season: number, windowSeq: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT status FROM season_windows WHERE season = ? AND window_seq = ?')
    .bind(season, windowSeq)
    .first<{ status: string }>();
  return row?.status ?? null;
}

/** 操作前置守卫：归属 / 终局 / 开窗 / 到期 / 合同在册且仍属本俱乐部（§11.2 最坏情况表）。 */
function assertOpen(row: DemandOpRow, clubId: number, nowIso: string, winStatus: string | null): void {
  if (row.club_id !== clubId) throw new HttpError(403, '这条要求不属于你的俱乐部');
  if (row.status !== 'pending' && row.status !== 'countered') throw new HttpError(409, '这条要求已经处理过了');
  // 窗口关闭与操作并发：以窗口状态为准（§11.2）
  if (winStatus !== 'open') throw new HttpError(409, '转会窗口已关闭，合同变更要等关窗结算');
  if (!(Date.parse(row.expires_at) > Date.parse(nowIso))) throw new HttpError(409, '这条要求已经到期');
  if (row.contract_active !== 1) throw new HttpError(409, '他的合同已不在册，这条要求失效了');
  // 合同行俱乐部与 demand 归属一致：换队后合同行 club_id 已是新东家，demand 不能再按旧
  // 东家口径操作（voidDemandStatements 接线前这是唯一防线；接线后离队即置 void）
  if (row.contract_club_id !== null && row.contract_club_id !== row.club_id) {
    throw new HttpError(409, '他的合同已不在册，这条要求失效了');
  }
}

/** 合同漂移守卫（§11.2「接受时工资/RC 已被另一流程改动」）：谈判锚与现行合同逐值比对。 */
function assertContractUnchanged(row: DemandOpRow): void {
  if (row.contract_wage === null || row.contract_wage !== row.current_wage || (row.contract_rc ?? 0) !== row.rc_current) {
    throw new HttpError(409, '他的合同条款已变动，这条要求失效了');
  }
}

/**
 * 批内合同漂移守卫（§11.2 的 SQL 侧落地）：读预检（assertContractUnchanged）与批执行之间有
 * TOCTOU 窗口，条件拼进批内语句——现行合同 wage/RC 与谈判锚逐值相等才执行。
 * ⚠️ 机制认知（v6.54.0 评审订正）：**D1 batch 不因「UPDATE 改 0 行」回滚**——条件不满足的
 * UPDATE 是正常执行（changes=0）而非语句失败，批内已执行语句的效果保留。因此「半套后果」
 * 的防线不是 claim 本身，而是**全批写语句挂同一个谓词**（见 demandClaimGuard）：任一条件
 * 不成立时所有语句同时 no-op，claim 读到 0 行 → 409，不产生孤儿行。
 * SQL 侧用子查询逐值比对（contracts.player_id 唯一，无 fan-out）；合同行被删 ⇒ 子查询为
 * NULL ⇒ 条件不成立 ⇒ 同样 no-op（宁拒不放）。
 */
function demandOpGuard(row: DemandOpRow): { sql: string; params: unknown[] } {
  return {
    sql:
      `${DEMAND_OPEN_GUARD} AND (SELECT round FROM contract_demands WHERE id = ?) = ?` +
      ` AND (SELECT wage FROM contracts WHERE player_id = ?) = ?` +
      ` AND (SELECT IFNULL(release_fee, 0) FROM contracts WHERE player_id = ?) = ?`,
    params: [row.id, row.id, row.round, row.player_id, row.current_wage, row.player_id, row.rc_current],
  };
}

/**
 * counter/accept 批的统一写守卫 = 末位 claim 的完整谓词（OPEN + round 未动 + 未过期 + 合同
 * 未漂移）。批内**每条**写语句（审计/逐轮/待生效/申请摘除/三件套/claim）都挂它——
 * 「三件套只挂 OPEN 守卫、claim 挂全守卫」的旧写法在漂移/刚过期时会让三件套 INSERT 先行
 * 生效而 claim no-op，留下孤儿 transfer_requests 行（后续终局撞 UNIQUE → 500 / cron 永久
 * skipped，v6.54.0 评审修）。
 */
function demandClaimGuard(row: DemandOpRow, nowIso: string): { sql: string; params: unknown[] } {
  const drift = demandOpGuard(row);
  return {
    sql:
      `${DEMAND_OPEN_GUARD} AND (SELECT round FROM contract_demands WHERE id = ?) = ?` +
      ` AND (SELECT expires_at FROM contract_demands WHERE id = ?) > ? AND ${drift.sql}`,
    params: [row.id, row.id, row.round, row.id, nowIso, ...drift.params],
  };
}

async function assertNoPendingChange(db: D1Database, playerId: number): Promise<void> {
  const existing = await db
    .prepare(`SELECT id FROM contract_pending_changes WHERE player_id = ? AND status = 'pending' LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (existing !== null) throw new HttpError(409, '先了结在途的合同变更，再处理这条要求');
}

/**
 * 段内已计数终局（不含本次——本次还是 pending，不在查询范围）。段锚 = 最近一次「入队该
 * 俱乐部」的完成时刻（单球员点查，idx_transfers_player 命中；排除 amendment 两型）；
 * 无入队行传 null——全历史一段只按 clubId 圈定。锚不能用 signed_at 的原因见
 * triggerDemandBatch.segmentCount 注释。
 */
async function countSegmentFinals(db: D1Database, playerId: number, clubId: number): Promise<number> {
  const joined = await db
    .prepare(
      `SELECT MAX(completed_at) AS joined_at FROM transfers
       WHERE player_id = ? AND to_club_id = ? AND status = 'completed' AND type NOT IN ('rc_change','match')`,
    )
    .bind(playerId, clubId)
    .first<{ joined_at: string | null }>();
  const rows = (
    await db
      .prepare(
        `SELECT club_id, status, resolution, void_reason, resolved_at FROM contract_demands
         WHERE player_id = ? AND status IN ('rejected','expired') AND resolved_at IS NOT NULL`,
      )
      .bind(playerId)
      .all<{ club_id: number; status: string; resolution: string | null; void_reason: string | null; resolved_at: string }>()
  ).results;
  const records: DemandFinalRecord[] = rows.map((r) => ({
    kind: (r.status === 'expired'
      ? 'expired'
      : r.resolution === 'direct' || r.resolution === 'lowball'
        ? r.resolution
        : 'collapse') as DemandFinalKind,
    clubId: r.club_id,
    at: Date.parse(r.resolved_at),
    byListing: r.void_reason === 'listing',
  }));
  const joinedMs = joined?.joined_at !== null && joined?.joined_at !== undefined && Number.isFinite(Date.parse(joined.joined_at)) ? Date.parse(joined.joined_at) : null;
  return segmentFinals(records, clubId, joinedMs).length;
}

/** 直拒三件套两个库内件所需的行字段（expire 路径的行是瘦查询，只取这几列） */
interface TrioRow {
  id: number;
  player_id: number;
  club_id: number;
  window_seq: number;
  current_wage: number;
  contract_wage: number | null;
}

/**
 * 直拒三件套的两个库内件（「不满」徽章申请 + rejection pending）；通告在批成功后发。
 * requestStatus：direct 档与升档终局走 'released'（存续即「不满」徽章）；
 * 未升档的谈崩/低还价走 'pending'（申请挂起，无三件套）。
 * guard = 调用方批的统一写守卫（与末位 claim 同谓词，见 demandClaimGuard / reject / expire
 * 各自的构造）：三件套 INSERT 是 UNIQUE(player_id, club_id, demand_id) 的唯一写入点，守卫
 * 不齐会让输家批留下孤儿申请行，之后任何终局重试都撞 UNIQUE（v6.54.0 评审修）。
 */
function directTrioStatements(
  db: D1Database,
  row: TrioRow,
  requestSource: 'direct' | 'collapse' | 'lowball',
  requestStatus: 'pending' | 'released',
  guard: { sql: string; params: unknown[] },
): D1PreparedStatement[] {
  return [
    // 「不满」徽章：released 存续即标记（升档终局走直拒三件套，status 表达后果档，
    // 真实终局仍看 contract_demands.resolution）
    db
      .prepare(
        `INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status)
         SELECT ?, ?, ?, ?, ? WHERE ${guard.sql}`,
      )
      .bind(row.player_id, row.club_id, row.id, requestSource, requestStatus, ...guard.params),
    // 保护期失效：protection_ticks 置已过（写 0）；价格两列原样不动（wage_new 必填故带现行值、
    // release_fee_new NULL=不变）——防返潮断言：直拒不动任何价格（TC-RD-34 #1）
    db
      .prepare(
        `INSERT INTO contract_pending_changes
           (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new, rc_fee, status, effective_window_seq)
         SELECT ?, ?, 'rejection', ?, ?, NULL, 0, 0, 'pending', ? WHERE ${guard.sql}`,
      )
      .bind(row.player_id, row.club_id, row.id, row.contract_wage ?? row.current_wage, row.window_seq, ...guard.params),
  ];
}

// ---------------------------------------------------------------------------
// §5.3 还价（POST 同请求即时判定）
// ---------------------------------------------------------------------------

export interface CounterDemandInput {
  demandId: number;
  /** 归属校验（路由层已 requireCoach + 绑定；引擎再拦一次 403） */
  clubId: number;
  /** 经理本轮还价 c */
  wage: number;
  actor: number | null;
  origin: AuditOrigin;
}

export interface CounterDemandResult {
  demandId: number;
  verdict: 'accepted' | 'negotiating' | 'rejected';
  /** rejected 终局的档位（collapse=3 轮谈崩 / lowball=低于底线）；其余 null */
  source: 'collapse' | 'lowball' | null;
  acceptedWage: number | null;
  /** 本轮轮次（1 起） */
  round: number;
  /** 本轮衰减后的球员期望 */
  eff: number;
  /** 本轮判定所用成功率 */
  p: number;
  /** 段内第 2 次终局升档（谈崩/低还价也走直拒三件套，§5.4.4） */
  escalated: boolean;
}

/**
 * 一轮还价的即时判定与落库（§5.3 状态机）。判定纯函数在 core（种子钉 seededUnit([demand_id,
 * round], 21)，同请求返回）；本函数负责：守卫 → 判定 → 同批落 attempts / 终局后果 / claim。
 * 判定接受也只写 pending 变更（成交值 c），contracts 关窗前不动（§5.7）。
 */
export async function counterDemand(env: Env, input: CounterDemandInput): Promise<CounterDemandResult> {
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const row = await loadDemandRow(db, input.demandId);
  if (row === null) throw new HttpError(404, '没有这条涨薪要求');
  const winStatus = await windowStatusOf(db, row.season, row.window_seq);
  assertOpen(row, input.clubId, nowIso, winStatus);
  // 在途 pending 预检（§11.2）：成交分支要写 contract_pending_changes，先给干净 409——
  // 不预检则撞 idx_pending_one_per_player 抛 UNIQUE → 路由 500，违背 §7 错误契约。
  // 预检与批之间仍有毫秒竞态（另一写者先落），届时批抛 UNIQUE 整批回滚、无半套后果。
  await assertNoPendingChange(db, row.player_id);
  if (row.contract_wage === null || !(input.wage > 0) || !Number.isFinite(input.wage)) {
    throw new HttpError(400, '还价金额不合法');
  }
  const ctx = await loadNegotiationContext(db);
  if (input.wage > ctx.wageMax) throw new HttpError(400, `还价不能超过工资上限 ${ctx.wageMax} m`);
  const round = row.round + 1;
  if (round > DEMAND_MAX_ROUNDS) throw new HttpError(409, '还价轮次已用完（最多 3 轮）');

  // 即时判定（确定性：同 (demand, round) 恒同果；c 与 target/floor 全部来自服务端行）
  const judged = judgeCounter({
    demandId: row.id,
    round,
    counter: input.wage,
    targetWage: row.target_wage,
    floorWage: row.floor_wage,
  });

  // 升档预判只在谈崩/低还价终局需要（段内已计数终局 ≥ 1 → 本次也走直拒三件套）
  const escalated =
    judged.verdict === 'collapse' || judged.verdict === 'lowball'
      ? escalatesToDirect(await countSegmentFinals(db, row.player_id, row.club_id))
      : false;

  const audit = createAuditStatement(db);
  // counter 批内统一守卫 = 末位 claim 的完整谓词（demand 可操作 + 轮次未动 + 未过期 + 现行
  // 合同 wage/RC 与谈判锚逐值相等，§11.2 漂移）——判 409 的锚是末位 claim，但「整批 no-op」
  // 靠的是每条语句挂同一谓词（D1 batch 不因 UPDATE 改 0 行回滚，见 demandClaimGuard 注释）。
  const guard = demandClaimGuard(row, nowIso);
  const statements: D1PreparedStatement[] = [
    audit({
      actor: input.actor,
      action: 'demand_counter',
      targetType: 'contract_demand',
      targetId: row.id,
      origin: input.origin,
      before: { status: row.status, round: row.round },
      after: {
        counterWage: input.wage,
        round,
        verdict: judged.verdict,
        eff: judged.eff,
        p: judged.p,
        acceptedWage: judged.acceptedWage,
        escalated,
      },
      guardSql: guard.sql,
      guardParams: guard.params,
    }),
    // 逐轮记录（每轮一行，accepted 落值；UNIQUE(demand_id, round) + 守卫双保险）
    db
      .prepare(
        `INSERT INTO contract_demand_attempts (demand_id, round, wage, accepted)
         SELECT ?, ?, ?, ? WHERE ${guard.sql}`,
      )
      .bind(row.id, round, input.wage, judged.verdict === 'accepted' ? 1 : 0, ...guard.params),
  ];

  if (judged.verdict === 'accepted') {
    // 成交值 = c；rc_floor 固定不随还价（§5.5）；无 RC 的 wage-only 行 release_fee_new=NULL=不变
    statements.push(
      db
        .prepare(
          `INSERT INTO contract_pending_changes
             (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new, rc_fee, status, effective_window_seq)
           SELECT ?, ?, 'demand', ?, ?, ?, NULL, 0, 'pending', ? WHERE ${guard.sql}`,
        )
        .bind(
          row.player_id,
          row.club_id,
          row.id,
          judged.acceptedWage ?? row.target_wage,
          row.rc_floor > 0 ? row.rc_floor : null,
          row.window_seq,
          ...guard.params,
        ),
      // 重签语义：接受即摘「不满」徽章（released → resolved）、关闭未挂牌的申请；
      // listed 留给挂牌成交链路收口（挂牌中接受不影响在挂单，§10.2）
      db
        .prepare(
          `UPDATE transfer_requests SET status = 'resolved', resolved_at = ${nowSql()}
           WHERE player_id = ? AND club_id = ? AND status IN ('pending','released') AND ${guard.sql}`,
        )
        .bind(row.player_id, row.club_id, ...guard.params),
    );
  }
  if (judged.verdict === 'collapse' || judged.verdict === 'lowball') {
    // 非升档：申请挂起（pending 态，无三件套）；升档：申请转 released + rejection pending 一起落。
    // 三件套挂与 claim 同谓词的统一守卫——漂移/刚过期时 INSERT 同 no-op，claim 0 行 → 409，
    // 不留孤儿申请行（v6.54.0 评审修：旧写法只挂 OPEN 守卫，输家批留下撞 UNIQUE 的死局行）。
    const [requestStmt, pendingStmt] = directTrioStatements(db, row, judged.verdict, escalated ? 'released' : 'pending', guard);
    statements.push(requestStmt);
    if (escalated) statements.push(pendingStmt);
  }

  // claim 放批末：与本批其他语句逐字同守卫（并发闸 = round 相等，两个并发还价只有一个能推进；
  // 漂移/过期在守卫里一并判 no-op → 409）。
  // negotiating 只推进 round（status 保持 pending——「谈判中」不是持久态，§5.3）；
  // 终局才写 status/resolution/resolved_by。
  statements.push(
    judged.verdict === 'negotiating'
      ? db
          .prepare(`UPDATE contract_demands SET round = ? WHERE id = ? AND ${guard.sql}`)
          .bind(round, row.id, ...guard.params)
      : db
          .prepare(
            `UPDATE contract_demands SET
               status = ?, resolution = ?, round = ?, resolved_by = ?, resolved_at = ${nowSql()}
             WHERE id = ? AND ${guard.sql}`,
          )
          .bind(
            judged.verdict === 'accepted' ? 'accepted' : 'rejected',
            judged.verdict === 'accepted' ? 'accepted' : judged.verdict,
            round,
            input.actor === null ? 'system' : String(input.actor),
            row.id,
            ...guard.params,
          ),
  );

  const results = await db.batch(statements);
  const claimed = Number(results[results.length - 1]?.meta?.changes ?? 0);
  if (claimed === 0) throw new HttpError(409, '这条要求刚被并发处理，请刷新');

  if (judged.verdict === 'accepted') {
    await queueClubNotification(env, row.club_id, 'demand_resolved', {
      demandId: row.id,
      playerId: row.player_id,
      player: row.player_name ?? `球员${row.player_id}`,
      outcome: 'accepted',
      wage: judged.acceptedWage ?? row.target_wage,
      rc: row.rc_floor > 0 ? row.rc_floor : null,
    });
  } else if (judged.verdict === 'collapse' || judged.verdict === 'lowball') {
    await queueClubNotification(env, row.club_id, 'demand_resolved', {
      demandId: row.id,
      playerId: row.player_id,
      player: row.player_name ?? `球员${row.player_id}`,
      outcome: 'rejected',
      source: judged.verdict,
      escalated,
      rc: row.rc_floor > 0 ? row.rc_floor : null,
    });
    if (escalated) {
      // 升档的谈崩/低还价同直拒档全联盟通告（三件套之一，§5.4.4）；激活价 = 现行合同违约金
      await queueAllUserClubsNotification(env, 'demand_rejected_public', {
        demandId: row.id,
        playerId: row.player_id,
        player: row.player_name ?? `球员${row.player_id}`,
        club: row.club_name ?? `俱乐部${row.club_id}`,
        rc: row.contract_rc !== null && row.contract_rc > 0 ? row.contract_rc : null,
      });
    }
  }
  // negotiating 不发通知：还价人是经理本人，回执进对话流（GET 即见）

  return {
    demandId: row.id,
    verdict: judged.verdict === 'collapse' || judged.verdict === 'lowball' ? 'rejected' : judged.verdict,
    source: judged.verdict === 'collapse' || judged.verdict === 'lowball' ? judged.verdict : null,
    acceptedWage: judged.acceptedWage,
    round,
    eff: judged.eff,
    p: judged.p,
    escalated,
  };
}

// ---------------------------------------------------------------------------
// §5.3/§5.7 接受
// ---------------------------------------------------------------------------

export interface AcceptDemandInput {
  demandId: number;
  clubId: number;
  actor: number | null;
  origin: AuditOrigin;
}

export interface AcceptDemandResult {
  demandId: number;
  /** 成交工资 = 开场要价 target（§5.3「经理接受 target」） */
  wage: number;
  /** 待生效违约金（wage-only 行为 null=不变） */
  releaseFee: number | null;
}

/** 接受 target + rc_floor：写 pending 变更（source='demand'、rc_fee=0），不收费、不走同队转会。 */
export async function acceptDemand(env: Env, input: AcceptDemandInput): Promise<AcceptDemandResult> {
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const row = await loadDemandRow(db, input.demandId);
  if (row === null) throw new HttpError(404, '没有这条涨薪要求');
  const winStatus = await windowStatusOf(db, row.season, row.window_seq);
  assertOpen(row, input.clubId, nowIso, winStatus);
  assertContractUnchanged(row);
  await assertNoPendingChange(db, row.player_id);

  const wage = row.target_wage;
  const releaseFeeNew = row.rc_floor > 0 ? row.rc_floor : null;
  const audit = createAuditStatement(db);
  // accept 批内统一守卫 = 末位 claim 的完整谓词（demand 可操作 + 轮次未动 + 未过期 + 现行
  // 合同 wage/RC 与谈判锚逐值相等——读预检 assertContractUnchanged 与批之间有 TOCTOU 窗口，
  // §11.2）；全批语句同一谓词 ⇒ claim 0 行时整批 no-op（机制见 demandClaimGuard 注释）。
  const guard = demandClaimGuard(row, nowIso);
  const results = await db.batch([
    audit({
      actor: input.actor,
      action: 'demand_accept',
      targetType: 'contract_demand',
      targetId: row.id,
      origin: input.origin,
      before: { wage: row.current_wage, releaseFee: row.rc_current },
      after: { wageNew: wage, releaseFeeNew, rcFee: 0, effectiveWindowSeq: row.window_seq },
      guardSql: guard.sql,
      guardParams: guard.params,
    }),
    // contracts 不动；唯一 pending 由部分唯一索引兜底（accept 前已预检给干净 409）
    db
      .prepare(
        `INSERT INTO contract_pending_changes
           (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new, rc_fee, status, effective_window_seq)
         SELECT ?, ?, 'demand', ?, ?, ?, NULL, 0, 'pending', ? WHERE ${guard.sql}`,
      )
      .bind(row.player_id, row.club_id, row.id, wage, releaseFeeNew, row.window_seq, ...guard.params),
    // 重签语义同还价成交：摘「不满」徽章 / 关闭未挂牌申请
    db
      .prepare(
        `UPDATE transfer_requests SET status = 'resolved', resolved_at = ${nowSql()}
         WHERE player_id = ? AND club_id = ? AND status IN ('pending','released') AND ${guard.sql}`,
      )
      .bind(row.player_id, row.club_id, ...guard.params),
    db
      .prepare(
        `UPDATE contract_demands SET status = 'accepted', resolution = 'accepted',
                resolved_by = ?, resolved_at = ${nowSql()}
         WHERE id = ? AND ${guard.sql}`,
      )
      .bind(input.actor === null ? 'system' : String(input.actor), row.id, ...guard.params),
  ]);
  const claimed = Number(results[results.length - 1]?.meta?.changes ?? 0);
  if (claimed === 0) throw new HttpError(409, '这条要求刚被并发处理，请刷新');

  await queueClubNotification(env, row.club_id, 'demand_resolved', {
    demandId: row.id,
    playerId: row.player_id,
    player: row.player_name ?? `球员${row.player_id}`,
    outcome: 'accepted',
    wage,
    rc: releaseFeeNew,
  });
  return { demandId: row.id, wage, releaseFee: releaseFeeNew };
}

// ---------------------------------------------------------------------------
// §5.4 直拒（明确放人）
// ---------------------------------------------------------------------------

export interface RejectDemandInput {
  demandId: number;
  clubId: number;
  actor: number | null;
  origin: AuditOrigin;
}

/**
 * 经理点「明确放人」：rejected(source='direct') + 直拒三件套（rejection pending 保护期置已过、
 * 全联盟通告、「不满」徽章 released）——不动任何价格、不动成长、不动资金（rev20 定稿）。
 * 直拒本身就是最硬档，段内累计计数不改变它的后果。
 */
export async function rejectDemand(env: Env, input: RejectDemandInput): Promise<{ demandId: number }> {
  const db = env.DB;
  const nowIso = new Date().toISOString();
  const row = await loadDemandRow(db, input.demandId);
  if (row === null) throw new HttpError(404, '没有这条涨薪要求');
  const winStatus = await windowStatusOf(db, row.season, row.window_seq);
  assertOpen(row, input.clubId, nowIso, winStatus);
  // 直拒写 rejection pending 时已有其他 pending → 409（§11.2；理论不可达，守卫仍要有）
  await assertNoPendingChange(db, row.player_id);

  const audit = createAuditStatement(db);
  // 直拒批统一守卫 = 末位 claim 的完整谓词（OPEN + round 未动 + 未过期）；三件套与审计同挂，
  // claim 0 行时全批 no-op（D1 batch 不因 UPDATE 改 0 行回滚，见 demandClaimGuard 注释）。
  const guard = {
    sql: `${DEMAND_OPEN_GUARD} AND (SELECT round FROM contract_demands WHERE id = ?) = ? AND (SELECT expires_at FROM contract_demands WHERE id = ?) > ?`,
    params: [row.id, row.id, row.round, row.id, nowIso],
  };
  const [requestStmt, pendingStmt] = directTrioStatements(db, row, 'direct', 'released', guard);
  const results = await db.batch([
    audit({
      actor: input.actor,
      action: 'demand_reject',
      targetType: 'contract_demand',
      targetId: row.id,
      origin: input.origin,
      before: { status: row.status, round: row.round },
      after: { source: 'direct', wageNew: row.contract_wage ?? row.current_wage, releaseFeeNew: null, protectionTicksNew: 0, rcFee: 0 },
      guardSql: guard.sql,
      guardParams: guard.params,
    }),
    requestStmt,
    pendingStmt,
    db
      .prepare(
        `UPDATE contract_demands SET status = 'rejected', resolution = 'direct',
                resolved_by = ?, resolved_at = ${nowSql()}
         WHERE id = ? AND ${guard.sql}`,
      )
      .bind(input.actor === null ? 'system' : String(input.actor), row.id, ...guard.params),
  ]);
  const claimed = Number(results[results.length - 1]?.meta?.changes ?? 0);
  if (claimed === 0) throw new HttpError(409, '这条要求刚被并发处理，请刷新');

  // 本队回执 + 全联盟通告（三件套之二；「不满」徽章是三件套之三，已在批内落 released）。
  // 通告里的激活价 = 现行合同违约金（保护期失效后按 RC 原价激活；rc_floor 关窗前未生效，不是激活价）
  await queueClubNotification(env, row.club_id, 'demand_resolved', {
    demandId: row.id,
    playerId: row.player_id,
    player: row.player_name ?? `球员${row.player_id}`,
    outcome: 'rejected',
    source: 'direct',
    escalated: false,
    rc: row.rc_floor > 0 ? row.rc_floor : null,
  });
  await queueAllUserClubsNotification(env, 'demand_rejected_public', {
    demandId: row.id,
    playerId: row.player_id,
    player: row.player_name ?? `球员${row.player_id}`,
    club: row.club_name ?? `俱乐部${row.club_id}`,
    rc: row.contract_rc !== null && row.contract_rc > 0 ? row.contract_rc : null,
  });
  return { demandId: row.id };
}

// ---------------------------------------------------------------------------
// §8/§11.1 cron 兜底：TTL 过期 + 24h 提醒
// ---------------------------------------------------------------------------

export interface DemandTickResult {
  /** 到点置 expired 的条数（含升档） */
  expired: number;
  /** 其中升档走直拒三件套的条数（段内第 2 次终局，§5.4.4） */
  escalated: number;
  /** 首次发出「距截止 24h」提醒的条数 */
  reminded: number;
  /** 扫到但结不了的条数（在途 pending 挡住升档件 / 并发已处理） */
  skipped: number;
}

const DEMAND_TICK_LIMIT = 200;

/**
 * 到期兜底（cron 与开窗清理共用入口）：status 仍 pending/countered 且 expires_at ≤ now →
 * expired（不生成转会申请；自然过期计一次终局——放任过期也算，rev20）。
 * 段内第 2 次终局升档：即使过期也走直拒三件套（「被无视两次 ≈ 被放人」）。
 * 挂牌驱赶的自动过期由挂牌链路落 void_reason='listing'（计数时被 segmentFinals 过滤），
 * 本函数经手的都是自然 TTL 到期，恒计数。
 */
export async function expireDemands(env: Env, nowIso?: string): Promise<DemandTickResult> {
  const db = env.DB;
  const now = nowIso ?? new Date().toISOString();
  const result: DemandTickResult = { expired: 0, escalated: 0, reminded: 0, skipped: 0 };

  const due = (
    await db
      .prepare(
        `SELECT d.id, d.player_id, d.club_id, d.season, d.window_seq, d.status, d.current_wage, d.round,
                p.name AS player_name, cl.name AS club_name,
                c.wage AS contract_wage, c.release_fee AS contract_rc
         FROM contract_demands d
         LEFT JOIN players p ON p.id = d.player_id
         LEFT JOIN clubs cl ON cl.id = d.club_id
         LEFT JOIN contracts c ON c.player_id = d.player_id
         WHERE d.status IN ('pending','countered') AND d.expires_at <= ?
         ORDER BY d.id LIMIT ?`,
      )
      .bind(now, DEMAND_TICK_LIMIT)
      .all<{
        id: number;
        player_id: number;
        club_id: number;
        season: number;
        window_seq: number;
        status: string;
        current_wage: number;
        round: number;
        player_name: string | null;
        club_name: string | null;
        contract_wage: number | null;
        contract_rc: number | null;
      }>()
  ).results;

  for (const row of due) {
    const escalated = escalatesToDirect(await countSegmentFinals(db, row.player_id, row.club_id));
    if (escalated) {
      // 升档过期 = 一次「被放人」：三件套与状态更新同批（守卫 + claim 批末，模式同 rejectDemand）
      const inFlight = await db
        .prepare(`SELECT id FROM contract_pending_changes WHERE player_id = ? AND status = 'pending' LIMIT 1`)
        .bind(row.player_id)
        .first<{ id: number }>();
      if (inFlight !== null) {
        // 理论不可达（申请/续约存续期不生成、demand 在途时续约被同窗守卫拦）；宁可下个 tick 重试
        result.skipped++;
        continue;
      }
      const audit = createAuditStatement(db);
      // 升档批统一守卫 = 末位 claim 的完整谓词（OPEN + 已到期）；三件套/审计同挂，
      // claim 0 行（并发已处理）时全批 no-op，不留孤儿申请行（v6.54.0 评审修）。
      const guard = {
        sql: `${DEMAND_OPEN_GUARD} AND (SELECT expires_at FROM contract_demands WHERE id = ?) <= ?`,
        params: [row.id, row.id, now],
      };
      const [requestStmt, pendingStmt] = directTrioStatements(db, row, 'direct', 'released', guard);
      let results: D1Result[];
      try {
        results = await db.batch([
          audit({
            actor: null,
            action: 'demand_expire',
            targetType: 'contract_demand',
            targetId: row.id,
            origin: 'cron_tick',
            before: { status: row.status },
            after: { escalated: true, source: 'direct', wageNew: row.contract_wage ?? row.current_wage, protectionTicksNew: 0, rcFee: 0 },
            guardSql: guard.sql,
            guardParams: guard.params,
          }),
          requestStmt,
          pendingStmt,
          db
            .prepare(
              `UPDATE contract_demands SET status = 'expired', resolution = 'expired', resolved_by = 'auto',
                      resolved_at = ${nowSql()}
               WHERE id = ? AND ${guard.sql}`,
            )
            .bind(row.id, ...guard.params),
        ]);
      } catch {
        // inFlight 预检与批之间的毫秒竞态撞 idx_pending_one_per_player、或 D1 瞬断：行未消费，
        // 下个 tick 重试。逐行吞错保证同轮后续行与 24h 提醒段不被堵停摆（v6.11.0 评审批过的
        // 「积满 LIMIT 挤停摆」同型防御——撞行 id 靠前时不能再让整个 cron 每轮全停）。
        result.skipped++;
        continue;
      }
      const claimed = Number(results[results.length - 1]?.meta?.changes ?? 0);
      if (claimed === 0) {
        result.skipped++;
        continue;
      }
      result.expired++;
      result.escalated++;
      // 升档过期的通告/回执同直拒档；激活价 = 现行合同违约金
      const rcNow = row.contract_rc !== null && row.contract_rc > 0 ? row.contract_rc : null;
      await queueClubNotification(env, row.club_id, 'demand_resolved', {
        demandId: row.id,
        playerId: row.player_id,
        player: row.player_name ?? `球员${row.player_id}`,
        outcome: 'rejected',
        source: 'direct',
        escalated: true,
        rc: rcNow,
      });
      await queueAllUserClubsNotification(env, 'demand_rejected_public', {
        demandId: row.id,
        playerId: row.player_id,
        player: row.player_name ?? `球员${row.player_id}`,
        club: row.club_name ?? `俱乐部${row.club_id}`,
        rc: rcNow,
      });
    } else {
      // 普通过期：单句 claim（行自身终态即留痕，不另写审计）；瞬断逐行吞错计 skipped，不停摆
      let claimed: D1Result;
      try {
        claimed = await db
          .prepare(
            `UPDATE contract_demands SET status = 'expired', resolution = 'expired', resolved_by = 'auto',
                    resolved_at = ${nowSql()}
             WHERE id = ? AND status IN ('pending','countered') AND expires_at <= ?`,
          )
          .bind(row.id, now)
          .run();
      } catch {
        result.skipped++;
        continue;
      }
      if ((claimed.meta.changes ?? 0) === 0) {
        result.skipped++;
        continue;
      }
      result.expired++;
    }
  }

  // 距截止不足 24h 提醒：reminded_at 一次性闸（同 0050 事件域模式；并发/重放只发一次）。
  // 上界之外还要 `> now`：不给已经过期的行推「还有不到 24 小时」（v6.11.0 event_deadline 教训）
  const soon = new Date(Date.parse(now) + 24 * 3600_000).toISOString();
  const remindable = (
    await db
      .prepare(
        `SELECT d.id, d.club_id, d.player_id, d.expires_at, p.name AS player_name, c.name AS club_name
         FROM contract_demands d
         LEFT JOIN players p ON p.id = d.player_id
         LEFT JOIN clubs c ON c.id = d.club_id
         WHERE d.status IN ('pending','countered') AND d.reminded_at = ''
           AND d.expires_at <= ? AND d.expires_at > ?
         ORDER BY d.id LIMIT ?`,
      )
      .bind(soon, now, DEMAND_TICK_LIMIT)
      .all<{ id: number; club_id: number; player_id: number; expires_at: string; player_name: string | null; club_name: string | null }>()
  ).results;
  for (const row of remindable) {
    const claimed = await db
      .prepare(`UPDATE contract_demands SET reminded_at = ? WHERE id = ? AND status IN ('pending','countered') AND reminded_at = ''`)
      .bind(now, row.id)
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue;
    result.reminded++;
    await queueClubNotification(env, row.club_id, 'demand_deadline', {
      demandId: row.id,
      playerId: row.player_id,
      player: row.player_name ?? `球员${row.player_id}`,
      club: row.club_name ?? `俱乐部${row.club_id}`,
      deadline: fmtBeijingMinute(row.expires_at),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// §5.7/§11.2 离队作废（语句返回给 completeTransfer 同批，不自行提交）
// ---------------------------------------------------------------------------

export interface VoidDemandPlan {
  /** 并进调用方（completeTransfer 换队/解约分支）批次的语句；调用方负责事务与审计 */
  statements: D1PreparedStatement[];
  /** 被作废的 demand id（pending/countered/accepted） */
  demandIds: number[];
  /** 被作废的 pending 变更 id */
  pendingIds: number[];
}

/**
 * 离队作废：demand → void（void_reason 落因）、在途 pending 变更 → void、
 * 转会申请（含「不满」徽章 released）→ resolved（徽章摘除，§5.4「重签或离队后摘除」）。
 * 设计锚：作废语句挂 completeTransfer 批内合同处理段（§5.4「段与作废锚点」），因此本函数
 * 只读现状、返回语句，写入时机与事务归调用方；「球员本人收作废通知」也由调用方发（§5.7）。
 */
export async function voidDemandStatements(env: Env, playerId: number, reason: string): Promise<VoidDemandPlan> {
  const db = env.DB;
  const demands = (
    await db
      .prepare(`SELECT id FROM contract_demands WHERE player_id = ? AND status IN ('pending','countered','accepted')`)
      .bind(playerId)
      .all<{ id: number }>()
  ).results;
  const pendings = (
    await db
      .prepare(`SELECT id FROM contract_pending_changes WHERE player_id = ? AND status = 'pending'`)
      .bind(playerId)
      .all<{ id: number }>()
  ).results;

  const statements: D1PreparedStatement[] = [];
  if (demands.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE contract_demands SET status = 'void', void_reason = ?,
                  resolved_at = COALESCE(resolved_at, ${nowSql()})
           WHERE player_id = ? AND status IN ('pending','countered','accepted')`,
        )
        .bind(reason, playerId),
    );
  }
  if (pendings.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE contract_pending_changes SET status = 'void', void_reason = ?
           WHERE player_id = ? AND status = 'pending'`,
        )
        .bind(reason, playerId),
    );
  }
  // 申请与徽章随离队终局：pending/listed/released 一并 resolved（badge 不随人走，TC-RD-45）
  statements.push(
    db
      .prepare(
        `UPDATE transfer_requests SET status = 'resolved', resolved_at = ${nowSql()}
         WHERE player_id = ? AND status IN ('pending','listed','released')`,
      )
      .bind(playerId),
  );
  return { statements, demandIds: demands.map((r) => r.id), pendingIds: pendings.map((r) => r.id) };
}

// ---------------------------------------------------------------------------
// §5.7 关窗生效：统一 apply / void 段（由 home.ts 的关窗批并入，交易结算之后）
// ---------------------------------------------------------------------------

export interface PendingApplySummary {
  /** 本批计划 apply 的条数（仍在本队；批内语句挂 status='pending' 闸，重放空转） */
  applied: number;
  /** 本批视作离队而作废的条数 */
  voided: number;
}

interface PendingApplyRow {
  id: number;
  player_id: number;
  club_id: number;
  demand_id: number | null;
  wage_new: number;
  release_fee_new: number | null;
  protection_ticks_new: number | null;
  still_at_club: number;
}

/**
 * §5.7 关窗结算第 3/4 步：对仍在原队、且该窗没有完成转会的 pending 逐条 apply；对已离队的
 * 置 void。三类来源（demand 闹涨薪 / renewal 普通续约 / rejection 直拒保护期失效）共用同一条
 * 路径——差别只在列值（renewal 的 protection_ticks_new = 4.4.6 收口的 baseTicks、rejection 的
 * = 0），所以不做 source 分支。
 *
 * 调用位置（closeWindow）保证时序：本窗工资已按旧 wage 结算（payroll 段在前）、本窗交易已按
 * 原 release_fee 完成（settleOverdue 在关窗批之前）——pending 对 transfer/activation 不可见。
 * 本函数只返回语句、由关窗批提交（与 home.ts 的维护费/冠名/档期同批原子）；
 * **先作废离队者、再 apply 留队者**（顺序对结果无影响，但按 §5.7 的第 3→4 步口径写清）。
 *
 * 幂等：apply 的合同 UPDATE 与 claim、demand 标记都挂 `status='pending'`；重放空转。
 * 迟到 apply：`effective_window_seq <= windowSeq` 一并收口——上次关窗批失败留下的行不能永久悬空。
 * （表里只有窗口序号、没有赛季列；跨赛季同序号只会让迟到行更早 apply，不会提前。）
 */
export async function applyPendingContractChanges(
  env: Env,
  windowSeq: number,
): Promise<{ statements: D1PreparedStatement[]; summary: PendingApplySummary }> {
  const db = env.DB;
  const rows = (
    await db
      .prepare(
        `SELECT pc.id, pc.player_id, pc.club_id, pc.demand_id,
                pc.wage_new, pc.release_fee_new, pc.protection_ticks_new,
                CASE WHEN c.club_id = pc.club_id THEN 1 ELSE 0 END AS still_at_club
         FROM contract_pending_changes pc
         LEFT JOIN contracts c ON c.player_id = pc.player_id AND c.is_active = 1
         WHERE pc.status = 'pending' AND pc.effective_window_seq <= ?
         ORDER BY pc.id`,
      )
      .bind(windowSeq)
      .all<PendingApplyRow>()
  ).results;

  const statements: D1PreparedStatement[] = [];
  const summary: PendingApplySummary = { applied: 0, voided: 0 };

  // ① 已离队者 → void（§5.7 第 4 步）：pending 不生效、demand 作废、转会申请与「不满」徽章收口。
  // 正常离队路径已在 completeTransfer/completeTermination 当批 void；这里是兜底（历史行、
  // 那两处批失败、或途中有其他写路径改归属）。只圈本 pending 的俱乐部——别队的申请不连带。
  for (const row of rows) {
    if (row.still_at_club === 1) continue;
    statements.push(
      db
        .prepare(
          `UPDATE contract_pending_changes SET status = 'void', void_reason = 'left_club'
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(row.id),
      db
        .prepare(
          `UPDATE contract_demands SET status = 'void', void_reason = 'left_club',
                  resolved_at = COALESCE(resolved_at, ${nowSql()})
           WHERE player_id = ? AND club_id = ? AND status IN ('pending','countered','accepted')`,
        )
        .bind(row.player_id, row.club_id),
      db
        .prepare(
          `UPDATE transfer_requests SET status = 'resolved', resolved_at = ${nowSql()}
           WHERE player_id = ? AND club_id = ? AND status IN ('pending','listed','released')`,
        )
        .bind(row.player_id, row.club_id),
    );
    summary.voided++;
  }

  // ② 仍在原队者 → apply（§5.7 第 3 步）：写新 wage / release_fee / 保护期，**不再扣款**
  //（非免费普通续约的 30% 在接受时已即时扣并写 rc_fee_charged_at；闹涨薪 rc_fee 恒 0）。
  for (const row of rows) {
    if (row.still_at_club !== 1) continue;
    statements.push(
      db
        .prepare(
          `UPDATE contracts SET wage = ?, release_fee = COALESCE(?, release_fee),
                  protection_ticks = COALESCE(?, protection_ticks)
           WHERE player_id = ? AND is_active = 1 AND club_id = ?`,
        )
        .bind(row.wage_new, row.release_fee_new, row.protection_ticks_new, row.player_id, row.club_id),
      // claim 挂「合同仍在原队」存在性子查询：读预检与批之间有极小 TOCTOU 窗口，
      // 归属已变时合同行不被本句覆盖、pending 也保持 pending 等下轮收口（宁可迟到不写错队）。
      db
        .prepare(
          `UPDATE contract_pending_changes SET status = 'applied', applied_at = ${nowSql()}
           WHERE id = ? AND status = 'pending'
             AND EXISTS (SELECT 1 FROM contracts WHERE player_id = ? AND is_active = 1 AND club_id = ?)`,
        )
        .bind(row.id, row.player_id, row.club_id),
    );
    if (row.demand_id !== null) {
      // demands 表没有 'applied' 状态（0048 的 CHECK 六态）——生效以 applied_at 落值表达（§5.7 状态机）
      statements.push(
        db
          .prepare(`UPDATE contract_demands SET applied_at = ${nowSql()} WHERE id = ? AND status = 'accepted'`)
          .bind(row.demand_id),
      );
    }
    summary.applied++;
  }

  // season 不进签名：contract_pending_changes 只有窗口序号、没有赛季列，收口判据只用 windowSeq
  return { statements, summary };
}

// ---------------------------------------------------------------------------
// §7 教练端读面（收件箱 / 还价预览 / 转会申请）——路由 src/worker/routes/contract-demands.ts 的引擎侧
// ---------------------------------------------------------------------------

/** 最近终局截尾条数（「最近 expired/rejected」，§7；卡数天然受 6 条/队/窗约束，仅防长尾堆积） */
const DEMAND_INBOX_RECENT_LIMIT = 10;
/** 已接受待生效组上限（正常每窗 ≤6 条；防「关窗批长期未跑」的极端堆积把 attempts 的 IN 撑大） */
const DEMAND_INBOX_ACCEPTED_LIMIT = 50;
/** attempts 分批的 id 数（D1 单查询绑定参数上限 100，留余量；v6.54.0 评审修） */
const ATTEMPT_ID_CHUNK = 90;
/** 收件箱三组共用的列集（别名固定：d=contract_demands，p=players） */
const DEMAND_LIST_SELECT = `SELECT d.id, d.player_id, d.season, d.window_seq, d.status, d.resolution,
       d.current_wage, d.target_wage, d.floor_wage, d.raise_pct, d.rc_current, d.rc_floor,
       d.round, d.expires_at, d.created_at, d.resolved_at, d.applied_at,
       p.name AS player_name, p.position, p.age, p.ca
FROM contract_demands d
LEFT JOIN players p ON p.id = d.player_id`;

/** 逐轮记录（卡内对话流的「你的每次还价 + 他的当场回应」；wage=经理本轮还价，accepted=球员判定） */
export interface DemandAttemptView {
  round: number;
  wage: number;
  accepted: boolean;
  at: string;
}

/** 收件箱卡（§10.1 对话流卡的字段契约；金额单位 m）。expected_wage 刻意不出——
 * 界面口径是「市场价」不显示精确值（§2.1），floor 出（本队教练可见，还价防呆需要，§7）。 */
export interface DemandCard {
  id: number;
  playerId: number;
  playerName: string | null;
  position: string | null;
  age: number | null;
  ca: number | null;
  season: number;
  windowSeq: number;
  status: string;
  /** 终局来源：direct=明确放人 / collapse=3 轮谈崩 / lowball=低于底线 / expired=过期；非终局 null */
  resolution: string | null;
  currentWage: number;
  targetWage: number;
  floorWage: number;
  raisePct: number;
  rcCurrent: number;
  /** 待生效违约金 floor；0 = 无 RC（wage-only，还价不涉及违约金行） */
  rcFloor: number;
  round: number;
  maxRounds: number;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  /** 已接受行关窗 apply 后置值；NULL=待生效 */
  appliedAt: string | null;
  attempts: DemandAttemptView[];
}

/** wageContext（§7）：接受确认弹窗超帽警示的三个输入（§10.1 分组头 pill 同源） */
export interface WageContext {
  /** 当前窗 Σ active 合同工资（m/窗） */
  currentTotal: number | null;
  /** 已接受未生效增量 Σ(pending.wage_new − 现行 wage)——闹涨薪与普通续约的 pending 一并计入（§10.5 同口径） */
  pendingDelta: number | null;
  /** 工资帽（按级别派生，squad-context 同口径）；未定级/无可用赛季/派生异常为 null——前端不画帽线 */
  wageCap: number | null;
}

export interface ClubDemandInbox {
  /** 当前开窗的待处理（新/谈判中），按剩余时间升序（§10.1 排序）；无开窗 = 空组（窗外不可操作） */
  active: DemandCard[];
  /** 已接受待生效（关窗 apply 前，applied_at 为空） */
  accepted: DemandCard[];
  /** 最近终局（expired/rejected，供对话流收口与后果态渲染），resolved_at 降序截尾 */
  recent: DemandCard[];
  wageContext: WageContext;
}

interface DemandListRow {
  id: number;
  player_id: number;
  season: number;
  window_seq: number;
  status: string;
  resolution: string | null;
  current_wage: number;
  target_wage: number;
  floor_wage: number;
  raise_pct: number;
  rc_current: number;
  rc_floor: number;
  round: number;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  applied_at: string | null;
  player_name: string | null;
  position: string | null;
  age: number | null;
  ca: number | null;
}

/** 工资帽（squad-context.loadSquadContext 的 null 安全变体）：config wage_cap 按级别覆盖、缺省 68/58；
 * 分级派不到（未报名/杯赛未定级/多座定级冲突抛 500）一律回 null——帽线是增强面，不挡收件箱。 */
async function wageCapOf(env: Env, clubId: number): Promise<number | null> {
  try {
    const db = env.DB;
    const season = (await getOpenWindow(db))?.season ?? (await getVisibleSeason(db));
    if (season === null) return null;
    const tier: Tier | null = await deriveClubTier(env, season, clubId, tierCache());
    if (tier === null) return null;
    const capJson = await createConfigService(db).getJson<Partial<Record<Tier, number>>>('wage_cap');
    return capJson?.[tier] ?? DEFAULT_WAGE_CAP_BY_TIER[tier];
  } catch {
    return null;
  }
}

/**
 * 收件箱三组 + wageContext（§7 GET）。只读本俱乐部（club_id 圈定，不跨俱乐部）；
 * void（离队作废）不出本表——作废发生在球员离队之后，教练经站内信与审计面看（§10.4 的澄清）。
 */
export async function listClubDemands(env: Env, clubId: number): Promise<ClubDemandInbox> {
  const db = env.DB;
  const win = await getOpenWindow(db);

  // 三组各查各的（v6.54.0 评审修）：此前一条无 status 过滤的全历史查询 + attempts 把**全部**
  // 历史行 id 拼进 IN (?,...)——终局行永不删，单队 ≈6 条/窗 × 每季多窗，约 1.5–2 个赛季就破
  // D1「单查询绑定参数上限 100」（官方 limits）；node:sqlite 上限 32766，本地测试测不出而
  // 生产会渐进必现 500。收口后 attempts 的 id 集 ≤ active(当前窗) + accepted(≤50) + recent(10)，
  // 且仍按 90 一批分块，双保险不再随历史增长。
  const activeRows =
    win === null
      ? []
      : (
          await db
            .prepare(
              `${DEMAND_LIST_SELECT}
               WHERE d.club_id = ? AND d.status IN ('pending','countered') AND d.season = ? AND d.window_seq = ?
               ORDER BY d.expires_at ASC, d.id ASC`,
            )
            .bind(clubId, win.season, win.windowSeq)
            .all<DemandListRow>()
        ).results;
  const acceptedRows = (
    await db
      .prepare(
        `${DEMAND_LIST_SELECT}
         WHERE d.club_id = ? AND d.status = 'accepted' AND d.applied_at IS NULL
         ORDER BY d.id ASC LIMIT ?`,
      )
      .bind(clubId, DEMAND_INBOX_ACCEPTED_LIMIT)
      .all<DemandListRow>()
  ).results;
  const recentRows = (
    await db
      .prepare(
        `${DEMAND_LIST_SELECT}
         WHERE d.club_id = ? AND d.status IN ('expired','rejected')
         ORDER BY d.resolved_at DESC, d.created_at DESC, d.id DESC LIMIT ?`,
      )
      .bind(clubId, DEMAND_INBOX_RECENT_LIMIT)
      .all<DemandListRow>()
  ).results;

  // 逐轮记录分块批量装（UNIQUE(demand_id, round) 索引点查；无 N+1）
  const allIds = [...activeRows, ...acceptedRows, ...recentRows].map((r) => r.id);
  const attemptsByDemand = new Map<number, DemandAttemptView[]>();
  for (let i = 0; i < allIds.length; i += ATTEMPT_ID_CHUNK) {
    const chunk = allIds.slice(i, i + ATTEMPT_ID_CHUNK);
    const attemptRows = (
      await db
        .prepare(
          `SELECT demand_id, round, wage, accepted, created_at FROM contract_demand_attempts
           WHERE demand_id IN (${chunk.map(() => '?').join(',')}) ORDER BY demand_id, round`,
        )
        .bind(...chunk)
        .all<{ demand_id: number; round: number; wage: number; accepted: number; created_at: string }>()
    ).results;
    for (const a of attemptRows) {
      const list = attemptsByDemand.get(a.demand_id) ?? [];
      list.push({ round: a.round, wage: a.wage, accepted: a.accepted === 1, at: a.created_at });
      attemptsByDemand.set(a.demand_id, list);
    }
  }

  const toCard = (r: DemandListRow): DemandCard => ({
    id: r.id,
    playerId: r.player_id,
    playerName: r.player_name,
    position: r.position,
    age: r.age,
    ca: r.ca,
    season: r.season,
    windowSeq: r.window_seq,
    status: r.status,
    resolution: r.resolution,
    currentWage: r.current_wage,
    targetWage: r.target_wage,
    floorWage: r.floor_wage,
    raisePct: r.raise_pct,
    rcCurrent: r.rc_current,
    rcFloor: r.rc_floor,
    round: r.round,
    maxRounds: DEMAND_MAX_ROUNDS,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    appliedAt: r.applied_at,
    attempts: attemptsByDemand.get(r.id) ?? [],
  });

  // 三组的筛选与排序已在各自 SQL 里收口（active 按当前开窗 + 剩余时间升序；accepted 按 id；
  // recent 按 resolved_at 降序截尾）。void（离队作废）不出本表——见函数头注。
  const active = activeRows.map(toCard);
  const accepted = acceptedRows.map(toCard);
  const recent = recentRows.map(toCard);

  const [totals, deltas] = await Promise.all([
    db
      .prepare(`SELECT SUM(wage) AS total FROM contracts WHERE club_id = ? AND is_active = 1`)
      .bind(clubId)
      .first<{ total: number | null }>(),
    // pending 变更对现行工资的差（contracts.player_id 唯一，无 fan-out）；rejection 行 wage_new=现行值 ⇒ 差 0
    db
      .prepare(
        `SELECT SUM(pc.wage_new - c.wage) AS delta
         FROM contract_pending_changes pc
         JOIN contracts c ON c.player_id = pc.player_id AND c.is_active = 1
         WHERE pc.club_id = ? AND pc.status = 'pending'`,
      )
      .bind(clubId)
      .first<{ delta: number | null }>(),
  ]);

  return {
    active,
    accepted,
    recent,
    wageContext: {
      currentTotal: totals?.total != null ? round2(totals.total) : null,
      pendingDelta: deltas?.delta != null ? round2(deltas.delta) : null,
      wageCap: await wageCapOf(env, clubId),
    },
  };
}

export interface DemandPreviewResult {
  /** 四档档位（与 v6.40.0 签约谈判 preview 同词同界 0.2/0.5/0.8，§7；同一真源 negotiation-secret.previewForecast） */
  forecast: string;
  /** 危险后缀开关（p < 经纪人档位阈值，evaluateWage 同式）——UI 拼接「（报价过低，有谈崩风险）」同词 */
  risk: boolean;
}

/**
 * 还价档位预览（§7）：零副作用——不落库、不耗轮次、不写审计（previewWage 同纪律）。
 * 判定式与 judgeCounter 同源同参：eff 按下一轮衰减（round>1 乘 attemptDecay）、
 * successRate(−9, 0.8)；c ≥ target 恒成、c < floor 恒 lowball（档位分别 1/0）。
 * 预览与真实提交只差判定 roll 那一下——预览说一套、提交落地另一套是禁手（§6.10-2 同源纪律）。
 */
export async function previewDemand(env: Env, demandId: number, clubId: number, wageInput: unknown): Promise<DemandPreviewResult> {
  const db = env.DB;
  const row = await loadDemandRow(db, demandId);
  if (row === null) throw new HttpError(404, '没有这条涨薪要求');
  // 只读动作不做窗口/到期/合同漂移守卫（最坏情况是对失效锚多看一眼档位）；归属与终局照拦
  if (row.club_id !== clubId) throw new HttpError(403, '这条要求不属于你的俱乐部');
  if (row.status !== 'pending' && row.status !== 'countered') throw new HttpError(409, '这条要求已经处理过了');
  const ctx = await loadNegotiationContext(db);
  const wage = Math.round(Number(wageInput) * 100) / 100;
  if (!Number.isFinite(wage) || !(wage > 0) || wage > ctx.wageMax) {
    throw new HttpError(400, `还价需在 0~${ctx.wageMax} 之间（m/半赛季）`);
  }
  const round = row.round + 1;
  if (round > DEMAND_MAX_ROUNDS) throw new HttpError(409, '还价轮次已用完（最多 3 轮）');
  const eff = round > 1 ? Math.round(row.target_wage * ctx.attemptDecay * 100) / 100 : row.target_wage;
  const p = wage >= row.target_wage ? 1 : wage < row.floor_wage ? 0 : successRate(wage, eff, ctx.sigmoidSlope, ctx.sigmoidMid);
  // 危险后缀阈值随经纪人档位（evaluateWage 同式；tierParamsOf 的两行钳制内联——
  // 反向 import negotiations.ts 会经 transfers.ts 成环，见 negotiation-secret.ts 挪动注释）
  const tierParams = ctx.agentTiers[Math.min(3, Math.max(1, Math.round(row.agent_tier ?? 2))) - 1] ?? ctx.agentTiers[1];
  return { forecast: previewForecast(p), risk: p < (tierParams?.threshold ?? 0.25) };
}

export interface TransferRequestCard {
  id: number;
  playerId: number;
  playerName: string | null;
  demandId: number | null;
  /** 终局来源：direct=明确放人 / collapse=3 轮谈崩 / lowball=低于底线（§5.4 梯度输入） */
  source: string;
  /** pending=申请挂起 / listed=已挂牌 / released=「不满」徽章存续（直拒档后果载体） */
  status: string;
  listingId: number | null;
  lastListingWindowSeq: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ClubTransferRequestList {
  requests: TransferRequestCard[];
}

// ---------------------------------------------------------------------------
// §10.4/§10.5 前端投影读面（v6.54.0 步骤 7）
// ---------------------------------------------------------------------------
// 待生效合同变更的**唯一读口径**：`contract_pending_changes` 里 pending 行 + 现行 contracts
// 的旧值一次 JOIN 出来。只给「本队教练」看（调用方负责归属校验）——公开面/他队永远拿不到
// pending 的工资与违约金，这是 §10.4「权限」硬要求。
// 注意：`contract_pending_changes.release_fee_new` / `protection_ticks_new` 的 NULL 语义是
// 「该项不变」（0079 注释），不是「没值」；前端据此决定哪一行算变化行。

export interface PendingContractView {
  playerId: number;
  playerName: string | null;
  /** demand=闹涨薪接受 / renewal=普通续约 / rejection=直拒保护期失效 */
  source: 'demand' | 'renewal' | 'rejection';
  /** 来源要求行（只有 demand/rejection 有） */
  demandId: number | null;
  /** 现行合同旧值（对比列左侧） */
  wageCurrent: number;
  releaseFeeCurrent: number | null;
  protectionTicksCurrent: number | null;
  /** 关窗后的新值；releaseFee/protectionTicks 为 null = 该项不变 */
  wage: number;
  releaseFee: number | null;
  protectionTicks: number | null;
  /** 该 pending 在哪一窗关闭时生效（表里只有窗序号，没有赛季列） */
  effectiveWindowSeq: number;
  rcFee: number;
  freeRcChange: boolean;
}

const PENDING_VIEW_SELECT = `SELECT pc.player_id, ${sqlDisplayName('p')} AS player_name,
       pc.source, pc.demand_id, pc.wage_new, pc.release_fee_new, pc.protection_ticks_new,
       pc.effective_window_seq, pc.rc_fee, pc.free_rc_change,
       c.wage AS wage_current, c.release_fee AS release_fee_current,
       c.protection_ticks AS protection_ticks_current
FROM contract_pending_changes pc
JOIN contracts c ON c.player_id = pc.player_id AND c.is_active = 1
JOIN players p ON p.id = pc.player_id`;

interface PendingViewRow {
  player_id: number;
  player_name: string | null;
  source: string;
  demand_id: number | null;
  wage_new: number;
  release_fee_new: number | null;
  protection_ticks_new: number | null;
  effective_window_seq: number;
  rc_fee: number;
  free_rc_change: number;
  wage_current: number | null;
  release_fee_current: number | null;
  protection_ticks_current: number | null;
}

function toPendingView(r: PendingViewRow): PendingContractView {
  return {
    playerId: r.player_id,
    playerName: r.player_name,
    source: r.source as PendingContractView['source'],
    demandId: r.demand_id,
    wageCurrent: r.wage_current ?? 0,
    releaseFeeCurrent: r.release_fee_current,
    protectionTicksCurrent: r.protection_ticks_current,
    wage: r.wage_new,
    releaseFee: r.release_fee_new,
    protectionTicks: r.protection_ticks_new,
    effectiveWindowSeq: r.effective_window_seq,
    rcFee: r.rc_fee,
    freeRcChange: r.free_rc_change === 1,
  };
}

/**
 * 本俱乐部的全部待生效合同变更（阵容页小字 / 注册工作台第二行与投影段）。
 * 一条查询、按 player_id 归并；`pending` 每球员最多 1 条（部分唯一索引）。
 */
export async function loadClubPendingChanges(env: Env, clubId: number): Promise<PendingContractView[]> {
  const rows = (
    await env.DB.prepare(`${PENDING_VIEW_SELECT}
       WHERE pc.club_id = ? AND pc.status = 'pending'
       ORDER BY pc.id`).bind(clubId).all<PendingViewRow>()
  ).results;
  return rows.map(toPendingView);
}

/** 单个球员的待生效变更（球员页双版本合同卡） */
export async function loadPlayerPendingChange(
  env: Env,
  playerId: number,
  clubId: number,
): Promise<PendingContractView | null> {
  const row = await env.DB.prepare(`${PENDING_VIEW_SELECT}
       WHERE pc.player_id = ? AND pc.club_id = ? AND pc.status = 'pending'`)
    .bind(playerId, clubId)
    .first<PendingViewRow>();
  return row ? toPendingView(row) : null;
}

/** 已生效待通知态（§10.4「已生效态」：生效后首个窗口内顶部一行小字，下一窗消失） */
export interface AppliedContractView {
  source: PendingContractView['source'];
  appliedAt: string;
  /** 只在 demand 来源有（contract_demands.current_wage 存了提要求时的旧工资）；
   *  renewal 走审批单、表里不存旧值 ⇒ null，前端退回不带旧值的文案 */
  oldWage: number | null;
}

/** 本窗球员要求状态（SideOps 四态块 + 续约禁用矩阵的判据） */
export interface PlayerDemandView {
  id: number;
  status: string;
  resolution: string | null;
  currentWage: number;
  targetWage: number;
  floorWage: number;
  rcCurrent: number;
  rcFloor: number;
  round: number;
  maxRounds: number;
  expiresAt: string;
  appliedAt: string | null;
  /** 最近一轮还价（SideOps「上轮你出 X 未成」）；没有还价记录 null */
  lastCounterWage: number | null;
}

export interface PlayerTransferRequestView {
  id: number;
  status: string;
  source: string;
  listingId: number | null;
}

export interface PlayerContractState {
  pending: PendingContractView | null;
  applied: AppliedContractView | null;
  /** 当前开窗窗口；无开窗 null */
  window: { season: number; windowSeq: number } | null;
  /** 当前窗的要求行（void 不返回——B 分支占位行没有可展示的面） */
  demand: PlayerDemandView | null;
  /** 本窗**任意状态**（含 expired / void 占位）是否存在要求行：续约禁用的硬判据 */
  demandThisWindow: boolean;
  transferRequest: PlayerTransferRequestView | null;
}

/**
 * 球员页/球队页的合同投影（§10.4 数据契约）。只由本队教练路径调用——
 * 归属校验在路由层（`player.club_id === 绑定俱乐部`）。
 *
 * 「已生效」小字的判据：该球员最近一条 applied 行，且其后**没有更晚关闭的窗口**
 * （= 正处在生效后的第一个窗口）。各查各的、无 N+1；无 pending/applied 时只有两条轻查询。
 */
export async function loadPlayerContractState(env: Env, playerId: number, clubId: number): Promise<PlayerContractState> {
  const db = env.DB;
  const win = await getOpenWindow(db);
  const [pending, demandRow, requestRow, appliedRow] = await Promise.all([
    loadPlayerPendingChange(env, playerId, clubId),
    win === null
      ? Promise.resolve(null)
      : db
          .prepare(
            `SELECT id, status, resolution, current_wage, target_wage, floor_wage, rc_current, rc_floor,
                    round, expires_at, applied_at,
                    (SELECT wage FROM contract_demand_attempts a
                     WHERE a.demand_id = contract_demands.id ORDER BY a.round DESC LIMIT 1) AS last_counter_wage
             FROM contract_demands
             WHERE player_id = ? AND club_id = ? AND season = ? AND window_seq = ?`,
          )
          .bind(playerId, clubId, win.season, win.windowSeq)
          .first<{
            id: number;
            status: string;
            resolution: string | null;
            current_wage: number;
            target_wage: number;
            floor_wage: number;
            rc_current: number;
            rc_floor: number;
            round: number;
            expires_at: string;
            applied_at: string | null;
            last_counter_wage: number | null;
          }>(),
    db
      .prepare(
        `SELECT id, status, source, listing_id FROM transfer_requests
         WHERE player_id = ? AND club_id = ? AND status IN ('pending','listed','released')
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(playerId, clubId)
      .first<{ id: number; status: string; source: string; listing_id: number | null }>(),
    db
      .prepare(
        `SELECT pc.source, pc.applied_at, d.current_wage AS old_wage
         FROM contract_pending_changes pc
         LEFT JOIN contract_demands d ON d.id = pc.demand_id
         WHERE pc.player_id = ? AND pc.club_id = ? AND pc.status = 'applied'
         ORDER BY pc.applied_at DESC, pc.id DESC LIMIT 1`,
      )
      .bind(playerId, clubId)
      .first<{ source: string; applied_at: string | null; old_wage: number | null }>(),
  ]);

  // 已生效小字只活一个窗口：生效后再关过窗（closed_at 晚于 applied_at）就不再提。
  // 直拒档（rejection）工资没变，不产生这条提示；renewal 缺旧值也照出（文案退化为不带旧值）。
  let applied: AppliedContractView | null = null;
  if (appliedRow?.applied_at != null && appliedRow.source !== 'rejection' && win !== null) {
    const later = await db
      .prepare(`SELECT COUNT(*) AS n FROM season_windows WHERE status = 'closed' AND closed_at > ?`)
      .bind(appliedRow.applied_at)
      .first<{ n: number }>();
    if ((later?.n ?? 0) === 0) {
      applied = {
        source: appliedRow.source as AppliedContractView['source'],
        appliedAt: appliedRow.applied_at,
        oldWage: appliedRow.source === 'demand' ? (appliedRow.old_wage ?? null) : null,
      };
    }
  }

  return {
    pending,
    applied,
    window: win === null ? null : { season: win.season, windowSeq: win.windowSeq },
    demand:
      demandRow && demandRow.status !== 'void'
        ? {
            id: demandRow.id,
            status: demandRow.status,
            resolution: demandRow.resolution,
            currentWage: demandRow.current_wage,
            targetWage: demandRow.target_wage,
            floorWage: demandRow.floor_wage,
            rcCurrent: demandRow.rc_current,
            rcFloor: demandRow.rc_floor,
            round: demandRow.round,
            maxRounds: DEMAND_MAX_ROUNDS,
            expiresAt: demandRow.expires_at,
            appliedAt: demandRow.applied_at,
            lastCounterWage: demandRow.last_counter_wage,
          }
        : null,
    demandThisWindow: demandRow !== null,
    transferRequest: requestRow
      ? { id: requestRow.id, status: requestRow.status, source: requestRow.source, listingId: requestRow.listing_id }
      : null,
  };
}

/**
 * 本俱乐部的存续转会申请（§7）。released 一并返回：直拒档的「不满」徽章以它为载体
 * （存续直到重签/离队，§5.4），教练必须能看到它挂着；resolved=已关闭（重签/离队/成交收口）不进列表。
 */
export async function listClubTransferRequests(env: Env, clubId: number): Promise<ClubTransferRequestList> {
  const rows = (
    await env.DB
      .prepare(
        `SELECT tr.id, tr.player_id, tr.demand_id, tr.source, tr.status, tr.listing_id,
                tr.last_listing_window_seq, tr.created_at, tr.resolved_at, p.name AS player_name
         FROM transfer_requests tr
         LEFT JOIN players p ON p.id = tr.player_id
         WHERE tr.club_id = ? AND tr.status IN ('pending','listed','released')
         ORDER BY tr.id DESC`,
      )
      .bind(clubId)
      .all<{
        id: number;
        player_id: number;
        demand_id: number | null;
        source: string;
        status: string;
        listing_id: number | null;
        last_listing_window_seq: number | null;
        created_at: string;
        resolved_at: string | null;
        player_name: string | null;
      }>()
  ).results;
  return {
    requests: rows.map((r) => ({
      id: r.id,
      playerId: r.player_id,
      playerName: r.player_name,
      demandId: r.demand_id,
      source: r.source,
      status: r.status,
      listingId: r.listing_id,
      lastListingWindowSeq: r.last_listing_window_seq,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    })),
  };
}
