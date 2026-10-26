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
import { expectedWage } from './negotiation-secret.ts';
import { abilityLevel } from '../core/negotiation-rules.ts';
import { POSITION_GROUP_BY_POSITION } from '../core/fc26.ts';
import { fmtBeijingMinute } from '../core/ops-schedule.ts';
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

  //  ⑤ 入队时刻（段锚）：一次 GROUP BY 捞全量（transfers 量级千行、生成批只跑一次，免逐球员 N+1）。
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
              p.name AS player_name, cl.name AS club_name,
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
 * TOCTOU 窗口，counter/accept 的每条批内语句都追加「现行合同 wage/RC 与谈判锚逐值相等」
 * 条件——漂移时整批 no-op，末位 claim 改 0 行 ⇒ 统一走 409，不产生半套后果。
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
 */
function directTrioStatements(
  db: D1Database,
  row: TrioRow,
  requestSource: 'direct' | 'collapse' | 'lowball',
  requestStatus: 'pending' | 'released',
): D1PreparedStatement[] {
  return [
    // 「不满」徽章：released 存续即标记（升档终局走直拒三件套，status 表达后果档，
    // 真实终局仍看 contract_demands.resolution）
    db
      .prepare(
        `INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status)
         SELECT ?, ?, ?, ?, ? WHERE ${DEMAND_OPEN_GUARD}`,
      )
      .bind(row.player_id, row.club_id, row.id, requestSource, requestStatus, row.id),
    // 保护期失效：protection_ticks 置已过（写 0）；价格两列原样不动（wage_new 必填故带现行值、
    // release_fee_new NULL=不变）——防返潮断言：直拒不动任何价格（TC-RD-34 #1）
    db
      .prepare(
        `INSERT INTO contract_pending_changes
           (player_id, club_id, source, demand_id, wage_new, release_fee_new, protection_ticks_new, rc_fee, status, effective_window_seq)
         SELECT ?, ?, 'rejection', ?, ?, NULL, 0, 0, 'pending', ? WHERE ${DEMAND_OPEN_GUARD}`,
      )
      .bind(row.player_id, row.club_id, row.id, row.contract_wage ?? row.current_wage, row.window_seq, row.id),
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
  // counter 批内统一守卫：demand 可操作 + 轮次未动 + 现行合同 wage/RC 与谈判锚逐值相等
  // （§11.2 漂移）——判 409 的锚是末位 claim，守卫挂每条语句保证漂移时整批 no-op。
  const guard = demandOpGuard(row);
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
    // 三件套语句只挂 OPEN 守卫（直拒后果与漂移无关）——漂移时末位 claim no-op 整批回滚兜底。
    const [requestStmt, pendingStmt] = directTrioStatements(db, row, judged.verdict, escalated ? 'released' : 'pending');
    statements.push(requestStmt);
    if (escalated) statements.push(pendingStmt);
  }

  // claim 放批末：round 相等是并发闸（两个并发还价只有一个能推进），expires 双保险，
  // 合同漂移等值守卫（§11.2）一并在此判 no-op → 409。
  // negotiating 只推进 round（status 保持 pending——「谈判中」不是持久态，§5.3）；
  // 终局才写 status/resolution/resolved_by。
  statements.push(
    judged.verdict === 'negotiating'
      ? db
          .prepare(
            `UPDATE contract_demands SET round = ?
             WHERE id = ? AND status IN ('pending','countered') AND round = ? AND expires_at > ? AND ${guard.sql}`,
          )
          .bind(round, row.id, row.round, nowIso, ...guard.params)
      : db
          .prepare(
            `UPDATE contract_demands SET
               status = ?, resolution = ?, round = ?, resolved_by = ?, resolved_at = ${nowSql()}
             WHERE id = ? AND status IN ('pending','countered') AND round = ? AND expires_at > ? AND ${guard.sql}`,
          )
          .bind(
            judged.verdict === 'accepted' ? 'accepted' : 'rejected',
            judged.verdict === 'accepted' ? 'accepted' : judged.verdict,
            round,
            input.actor === null ? 'system' : String(input.actor),
            row.id,
            row.round,
            nowIso,
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
  // accept 批内统一守卫：demand 可操作 + 轮次未动 + 现行合同 wage/RC 与谈判锚逐值相等
  // （§11.2 漂移的 SQL 侧落地——读预检 assertContractUnchanged 与批之间有 TOCTOU 窗口）；
  // 漂移时整批 no-op，末位 claim 改 0 行 ⇒ 409，不产生半套后果。
  const guard = demandOpGuard(row);
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
         WHERE id = ? AND status IN ('pending','countered') AND round = ? AND expires_at > ? AND ${guard.sql}`,
      )
      .bind(input.actor === null ? 'system' : String(input.actor), row.id, row.round, nowIso, ...guard.params),
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
  const [requestStmt, pendingStmt] = directTrioStatements(db, row, 'direct', 'released');
  const results = await db.batch([
    audit({
      actor: input.actor,
      action: 'demand_reject',
      targetType: 'contract_demand',
      targetId: row.id,
      origin: input.origin,
      before: { status: row.status, round: row.round },
      after: { source: 'direct', wageNew: row.contract_wage ?? row.current_wage, releaseFeeNew: null, protectionTicksNew: 0, rcFee: 0 },
      guardSql: `${DEMAND_OPEN_GUARD} AND (SELECT round FROM contract_demands WHERE id = ?) = ?`,
      guardParams: [row.id, row.id, row.round],
    }),
    requestStmt,
    pendingStmt,
    db
      .prepare(
        `UPDATE contract_demands SET status = 'rejected', resolution = 'direct',
                resolved_by = ?, resolved_at = ${nowSql()}
         WHERE id = ? AND status IN ('pending','countered') AND round = ? AND expires_at > ?`,
      )
      .bind(input.actor === null ? 'system' : String(input.actor), row.id, row.round, nowIso),
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
      const [requestStmt, pendingStmt] = directTrioStatements(db, row, 'direct', 'released');
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
            guardSql: DEMAND_OPEN_GUARD,
            guardParams: [row.id],
          }),
          requestStmt,
          pendingStmt,
          db
            .prepare(
              `UPDATE contract_demands SET status = 'expired', resolution = 'expired', resolved_by = 'auto',
                      resolved_at = ${nowSql()}
               WHERE id = ? AND status IN ('pending','countered') AND expires_at <= ?`,
            )
            .bind(row.id, now),
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
