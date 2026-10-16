// 停赛判定（俱乐部平台侧镜像）：只读 TOUR_DB，回答一个问题——
// 「某一场比赛，某些球员是否正在服停赛、起因是什么、本场是第几场」。
//
// 为什么是复算而不是直读：赛事仓（WHL-tournament-management-system）的停赛引擎是删除/改判/
// 补录后每次重算的纯派生实现，结果不落库（worker/lib/suspension.ts），跨库也没有可读的停赛表。
// 本文件逐条镜像那份实现的规则与 SQL 顺序，两处必须同步改：
//   · 直红停 redBan 场；两黄变一红停 red2yBan 场；累积 yellowThreshold 张黄牌停 1 场并清零；
//     红牌与黄牌停赛并行叠加；
//   · pending 场不消耗停赛（live/finished 消耗）；轮空场不进比赛序；弃权场弃权方不消耗
//     （walkover_side='both' 双方都不消耗）；
//   · 有 yellowResetAt 清零锚点时按 created_at 拆两段重放（锚点前段完整重放，锚点后段黄牌
//     从零重计、接力 ban 不重复消耗）；
//   · 比赛序 ORDER BY stage.sort_order, round, slot, leg, id；事件按球员 p.team_id 收窄、
//     entry 取自事件自身的 me.entry_id；配置存 tournament.config_json.suspension（clamp 回退默认）。
export const DEFAULT_SUSPENSION = { redBan: 2, red2yBan: 1, yellowThreshold: 3, yellowResetAt: null } as const;

// 赛事仓 shared/matchNotes.ts：轮空场标注，这类比赛不进比赛序列（没打的比赛不消耗停赛）
const BYE_NOTE = '轮空';

export type SuspensionReason = 'yellow' | 'red' | 'red_2y';

export interface MatchSuspension {
  reason: SuspensionReason;
  /** 本次停赛总场数 */
  total: number;
  /** 本场是第几场（1-based） */
  serving: number;
}

const REASON_LABEL: Record<SuspensionReason, string> = { red: '直红', red_2y: '两黄变一红', yellow: '累积黄牌' };

/** 面板徽标与端点错误文案共用的一行说明：「直红 · 停 2 场」 */
export function suspensionLabel(s: MatchSuspension): string {
  return `${REASON_LABEL[s.reason]} · 停 ${s.total} 场`;
}

interface SuspensionConfig {
  redBan: number;
  red2yBan: number;
  yellowThreshold: number;
  yellowResetAt: string | null;
}

interface SeqRow {
  id: number;
  home_entry_id: number | null;
  away_entry_id: number | null;
  status: string;
  note: string | null;
  walkover_side: string | null;
}

interface CardRow {
  match_id: number;
  entry_id: number | null;
  player_id: number;
  type: SuspensionReason;
  created_at: string | null;
}

interface Ban {
  from: number; // 生效起点 = 触发场在比赛序列中的下一场下标
  remaining: number;
  fresh: boolean; // 本次重放新触发的 ban（接力的旧 ban 不再消耗，避免双遍重复扣减）
  source: SuspensionReason;
  total: number;
}

interface PlayerCards {
  entryId: number | null;
  byMatch: Map<number, CardRow[]>;
}

const clampBan = (v: unknown, fallback: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : fallback;
};

/** config_json → 停赛配置（缺省/坏值一律回退默认），与赛事仓 parseSuspensionConfig 同口径 */
export function parseSuspensionConfig(configJson: string | null | undefined): SuspensionConfig {
  const fallback = { ...DEFAULT_SUSPENSION };
  let cfg: { suspension?: Partial<SuspensionConfig> } = {};
  try {
    cfg = (JSON.parse(configJson || '{}') ?? {}) as { suspension?: Partial<SuspensionConfig> };
  } catch {
    return fallback;
  }
  const s = cfg.suspension ?? {};
  return {
    redBan: clampBan(s.redBan, DEFAULT_SUSPENSION.redBan),
    red2yBan: clampBan(s.red2yBan, DEFAULT_SUSPENSION.red2yBan),
    yellowThreshold: clampBan(s.yellowThreshold, DEFAULT_SUSPENSION.yellowThreshold),
    yellowResetAt: typeof s.yellowResetAt === 'string' ? s.yellowResetAt : null,
  };
}

/**
 * 单遍重放（赛事仓 replay 的移植）：按比赛序处理 pass 选中的纪律事件，bansIn 接力既有处罚；
 * consumeIn=false 时接力 ban 不参与消耗（锚点前段已扣完），只消耗本次新触发的。
 * 差异只在一处：本函数不产出「当前剩余」，而是在 captureAt 那一场（若该场对这名球员可消耗）
 * 把正在服刑的 ban 记下来，回答「这场他是不是在停赛」。
 */
function replayCapture(
  info: PlayerCards,
  seq: SeqRow[],
  bansIn: Ban[],
  consumeIn: boolean,
  pass: (ev: CardRow) => boolean,
  cfg: SuspensionConfig,
  captureAt: number,
): { hit: MatchSuspension | null; bans: Ban[] } {
  const bans: Ban[] = bansIn.map((b) => ({ ...b, fresh: false }));
  let yellowCount = 0;
  let hit: MatchSuspension | null = null;
  for (let i = 0; i < seq.length; i++) {
    const m = seq[i];
    // 先消耗后触发：同一场既可以是旧处罚的消耗场，也可以是新处罚的触发场。
    // 弃权场：弃权方不消耗停赛（双弃权双方都不消耗），非弃权方照常消耗。
    const wo = m.walkover_side || '';
    const isWoSide = wo === 'both' || wo === (info.entryId === m.home_entry_id ? 'home' : 'away');
    if (m.status !== 'pending' && !isWoSide) {
      for (const b of bans) {
        // b.from <= i 在本次循环次序下恒真（消耗块在推入块之前），保留以与赛事仓逐字一致：
        // 「先消耗后触发」由语句顺序保证，不靠这个条件
        if ((b.fresh || consumeIn) && b.from <= i && b.remaining > 0) {
          // 消耗前捕获：这一刻 remaining 还是「还剩几场（含本场）」
          if (i === captureAt && hit === null) hit = { reason: b.source, total: b.total, serving: b.total - b.remaining + 1 };
          b.remaining -= 1;
        }
      }
    }
    const evs = info.byMatch.get(m.id);
    if (!evs) continue;
    // 两黄变一红同场的黄牌不计入停赛累积（该球员该场只记 1 红）
    const sentOff2y = evs.some((x) => x.type === 'red_2y');
    for (const ev of evs) {
      if (!pass(ev)) continue;
      if (ev.type === 'yellow') {
        if (sentOff2y) continue;
        yellowCount += 1;
        if (cfg.yellowThreshold > 0 && yellowCount >= cfg.yellowThreshold) {
          bans.push({ from: i + 1, remaining: 1, fresh: true, source: 'yellow', total: 1 });
          yellowCount = 0;
        }
      } else if (ev.type === 'red') {
        bans.push({ from: i + 1, remaining: cfg.redBan, fresh: true, source: 'red', total: cfg.redBan });
      } else {
        bans.push({ from: i + 1, remaining: cfg.red2yBan, fresh: true, source: 'red_2y', total: cfg.red2yBan });
      }
    }
  }
  return { hit, bans };
}

/** 一队的比赛序列（跳轮空）与红黄牌事件，按赛事仓的收窄口径读入 */
async function loadTeamDiscipline(
  tourDb: D1Database,
  tournamentId: number,
  teamId: number,
  entryIds: number[],
): Promise<{ byEntry: Map<number, SeqRow[]>; byPlayer: Map<number, PlayerCards> }> {
  const entryIdSet = new Set(entryIds);
  const byEntry = new Map<number, SeqRow[]>();
  if (entryIdSet.size === 0) return { byEntry, byPlayer: new Map() };
  const ids = [...entryIdSet];

  // v6.51.9：比赛序与红黄牌事件互不依赖 ⇒ 并发取（原来是两条串行 await）。同时不再自己查
  // 「本队有哪些 entry」——调用方已持有本场两侧的 entry，直接传进来（原来那条
  // SELECT id FROM entry WHERE team_id = ? 与调用方的 entry 查询是重复的一趟）。
  const [seq, events] = await Promise.all([
    tourDb
      .prepare(
        `SELECT m.id, m.home_entry_id, m.away_entry_id, m.status, m.note, m.walkover_side
       FROM match m
       JOIN stage s ON s.id = m.stage_id
       WHERE s.tournament_id = ?
         AND (m.home_entry_id IN (${ids.map(() => '?').join(', ')})
              OR m.away_entry_id IN (${ids.map(() => '?').join(', ')}))
       ORDER BY s.sort_order, m.round, m.slot, m.leg, m.id`,
      )
      .bind(tournamentId, ...ids, ...ids)
      .all<SeqRow>(),
    tourDb
      .prepare(
        `SELECT me.match_id, me.entry_id, me.player_id, me.type, me.created_at
       FROM match_event me
       JOIN match m ON m.id = me.match_id
       JOIN stage s ON s.id = m.stage_id
       JOIN entry e ON e.id = me.entry_id
       JOIN player p ON p.id = me.player_id
       WHERE s.tournament_id = ? AND me.player_id IS NOT NULL
         AND me.type IN ('yellow', 'red', 'red_2y') AND p.team_id = ?
       ORDER BY me.id`,
      )
      .bind(tournamentId, teamId)
      .all<CardRow>(),
  ]);
  for (const m of seq.results) {
    if (m.note === BYE_NOTE) continue;
    for (const eid of [m.home_entry_id, m.away_entry_id]) {
      if (eid == null || !entryIdSet.has(eid)) continue;
      const list = byEntry.get(eid);
      if (list) list.push(m);
      else byEntry.set(eid, [m]);
    }
  }

  const byPlayer = new Map<number, PlayerCards>();
  for (const ev of events.results) {
    let info = byPlayer.get(ev.player_id);
    if (!info) {
      info = { entryId: ev.entry_id, byMatch: new Map() };
      byPlayer.set(ev.player_id, info);
    }
    const list = info.byMatch.get(ev.match_id);
    if (list) list.push(ev);
    else info.byMatch.set(ev.match_id, [ev]);
  }
  return { byEntry, byPlayer };
}

/**
 * 这一场有哪些球员正在服停赛（返回值 key = 赛事系统 player.id，等于本库 players.fc_id）。
 * 只在「本场对该球员可消耗」时才算服刑——pending/弃权方的场次不消耗停赛，赛事仓同样不会
 * 把这类场次算作刑期，二者判定保持一致。
 */
export async function suspendedPlayersAtMatch(
  tourDb: D1Database,
  matchId: number,
): Promise<Map<number, MatchSuspension>> {
  const target = await tourDb
    .prepare(
      `SELECT m.id, m.home_entry_id, m.away_entry_id, s.tournament_id
       FROM match m JOIN stage s ON s.id = m.stage_id
       WHERE m.id = ?`,
    )
    .bind(matchId)
    .first<{ id: number; home_entry_id: number | null; away_entry_id: number | null; tournament_id: number }>();
  if (!target) return new Map();
  const entryIds = [target.home_entry_id, target.away_entry_id].filter((v): v is number => v !== null);
  if (entryIds.length === 0) return new Map();

  // v6.51.9：配置与两侧 entry 互不依赖 ⇒ 一次并发取（原来两趟串行）
  const [cfgRow, entryRows] = await Promise.all([
    tourDb
      .prepare('SELECT config_json FROM tournament WHERE id = ?')
      .bind(target.tournament_id)
      .first<{ config_json: string | null }>(),
    tourDb
      .prepare(`SELECT id, team_id FROM entry WHERE id IN (${entryIds.map(() => '?').join(', ')})`)
      .bind(...entryIds)
      .all<{ id: number; team_id: number }>(),
  ]);
  const cfg = parseSuspensionConfig(cfgRow?.config_json);
  const hasAnchor = cfg.yellowResetAt !== null;
  const resetAt = cfg.yellowResetAt ?? '';

  // v6.51.9：两侧队伍的纪律数据并发取（原来串行两支）。entry 用调用方刚取到的本场这一支即可——
  // 本队别的 entry 的序列只有「事件记在别的 entry 上」的球员会用到，而那些球员在这里
  // findIndex(matchId) 恒为 -1（本场不属于那支 entry），原实现同样整人跳过，结论不变。
  const out = new Map<number, MatchSuspension>();
  const sides = await Promise.all(
    entryRows.results.map((entry) => loadTeamDiscipline(tourDb, target.tournament_id, entry.team_id, [entry.id])),
  );
  for (const { byEntry, byPlayer } of sides) {
    for (const [playerId, info] of byPlayer) {
      const seq = byEntry.get(info.entryId ?? -1);
      if (!seq) continue;
      const captureAt = seq.findIndex((m) => m.id === matchId);
      if (captureAt < 0) continue;
      // 锚点前段：完整重放历史触发，清零前已生效的停赛接力进后段继续执行
      const pass1 = replayCapture(info, seq, [], true, (ev) => !hasAnchor || (ev.created_at ?? '') <= resetAt, cfg, captureAt);
      // 锚点后段：黄牌从零重计（锚点后没有新事件时自然为 0），接力 bans 不重复消耗
      const hit =
        pass1.hit ??
        (hasAnchor ? replayCapture(info, seq, pass1.bans, false, (ev) => (ev.created_at ?? '') > resetAt, cfg, captureAt).hit : null);
      if (hit) out.set(playerId, hit);
    }
  }
  return out;
}
