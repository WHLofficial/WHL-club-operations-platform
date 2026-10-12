// 球员页「比赛」页签（v6.46.0）：把四个来源归并成「按赛季分赛事汇总 + 逐场流水」的展示载荷。
//   ① 成长记录（growth_events.match_ref 命中：出场/评分/进球/助攻/零封/扑救）
//   ② 赛事系统事件（match_event：进球/点球未进/乌龙/黄红牌/伤退/助攻）
//   ③ 赛前真实提交的首发（tactic_submission.slots_json，11 人首发且含该球员）
//   ④ 伤病停赛名单（injury_miss）
// 出场 = ①②③ 并集；④ 只进「缺阵」列。弃权场（walkover_side 非空）整体排除。
//
// 这里只有纯计算（无 IO，便于测）：取数在 src/worker/player-matches.ts，端点挂在 routes/players.ts。
// 口径细节：黄牌不含同场两黄变一红那张（与赛事系统榜单 worker/lib/topstats.ts 同一口径：
// 同场同球员有 red_2y 时该场黄牌不计，红牌照含 red/red_2y）；乌龙不计个人进球；
// 零封/失球走已确认比分快照（不用成长库 clean_sheet —— 它只对进攻方净吞 0 蛋时有事件者写入，太稀疏）。

/** 赛事类型中文标签（与 web/src/lib/api.ts 的 COMPETITION_TYPE_LABEL 同一份口径，§11） */
export const COMPETITION_LABEL: Record<string, string> = {
  league_premier: '顶级联赛',
  league_second: '次级联赛',
  champions_cup: '冠军杯',
  super_cup: '超级杯',
  qualifying: '资格赛',
};

/** 汇总表里赛事固定顺序（联赛 → 杯赛 → 资格赛）；未知类型排最后，按 id 稳定排序 */
const COMP_ORDER = ['league_premier', 'league_second', 'champions_cup', 'super_cup', 'qualifying'];

/** 出场来源代码：成长记录 / 赛事事件 / 赛前名单 */
export type AppearanceSource = 'growth' | 'event' | 'lineup';

export interface PlayerMatchesInput {
  /** 球员位置（门将才有零封/失球/扑救的流水文案） */
  position: string | null;
  growth: { matchRef: string; eventType: string; value: number }[];
  confirmations: {
    matchId: number;
    season: number;
    competitionType: string | null;
    tournamentId: number | null;
    stageName: string | null;
    round: number | null;
    homeTeam: string | null;
    awayTeam: string | null;
    scoreHome: number | null;
    scoreAway: number | null;
    walkoverSide: string | null;
    finishedAt: string | null;
  }[];
  /** 赛事系统事件：own = player_id 命中（本人），否则是 assist_player_id 命中（助攻） */
  tourEvents: { matchId: number; type: string; minute: number | null; own: boolean; entryTeamId: number | null }[];
  /** 赛前真实提交的首发（已解析且恰好 11 人） */
  lineups: { matchId: number; teamId: number }[];
  /** 伤病停赛名单命中的场次 */
  missed: number[];
  /** 该球员效力过的 tour 队号 → 队名（判主客与对手名） */
  teamNameById: Map<number, string>;
  tournamentNameById: Map<number, string>;
}

export interface CompStat {
  competitionType: string;
  competitionName: string;
  tournamentId: number | null;
  tournamentName: string | null;
  appearances: number;
  ratingCount: number;
  avgRating: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  penMiss: number;
  ownGoal: number;
  injuryOut: number;
  missed: number;
  cleanSheets: number;
  conceded: number;
  saves: number;
}

export interface SeasonStats {
  season: number;
  comps: CompStat[];
  total: CompStat;
}

export interface PlayerMatchItem {
  matchId: number;
  season: number;
  competitionType: string;
  competitionName: string;
  tournamentId: number | null;
  tournamentName: string | null;
  stageName: string | null;
  round: number | null;
  /** 「顶级联赛 · 循环赛 · 第 12 轮」；缺哪段就省哪段 */
  stageLabel: string;
  date: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  opponent: string | null;
  side: 'home' | 'away' | null;
  scoreHome: number | null;
  scoreAway: number | null;
  rating: number | null;
  saves: number;
  conceded: number | null;
  cleanSheet: boolean;
  events: string[];
  missed: boolean;
  appeared: boolean;
  sources: AppearanceSource[];
}

export interface PlayerMatchesResult {
  seasons: SeasonStats[];
  matches: PlayerMatchItem[];
}

/** 该场这一行的临时事实（内部用） */
interface MatchFacts {
  confirm: PlayerMatchesInput['confirmations'][number];
  teamId: number | null;
  growthTypes: Set<string>;
  rating: number | null;
  saves: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  penMiss: number;
  ownGoal: number;
  injuryOut: number;
  events: { minute: number | null; text: string }[];
  missed: boolean;
  sources: Set<AppearanceSource>;
}

const EVENT_TEXT: Record<string, string> = {
  goal: '进球',
  pen_goal: '点球进球',
  pen_miss: '点球未进',
  own_goal: '乌龙',
  yellow: '黄牌',
  red: '红牌',
  red_2y: '红牌（两黄）',
  injury_minor: '伤退',
  injury_major: '伤退',
  assist: '助攻',
};

function emptyComp(competitionType: string, tournamentId: number | null, tournamentName: string | null): CompStat {
  return {
    competitionType,
    competitionName: COMPETITION_LABEL[competitionType] ?? competitionType,
    tournamentId,
    tournamentName,
    appearances: 0,
    ratingCount: 0,
    avgRating: null,
    goals: 0,
    assists: 0,
    yellow: 0,
    red: 0,
    penMiss: 0,
    ownGoal: 0,
    injuryOut: 0,
    missed: 0,
    cleanSheets: 0,
    conceded: 0,
    saves: 0,
  };
}

/** 均分保留两位小数（展示口径；合计行用全部评分场次加权，先累加原始和再除） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 日期取到「天」：result_confirmations.finished_at 形如 '2026-09-20 21:00:00' 或 ISO（带 T） */
function dateOf(finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const head = finishedAt.trim().split(/[T ]/)[0] ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

function stageLabelOf(competitionName: string, stageName: string | null, round: number | null): string {
  return [competitionName, stageName, round === null ? null : `第 ${round} 轮`].filter((x): x is string => !!x).join(' · ');
}

/** 归并四个来源 → 逐场事实表 */
function buildFacts(input: PlayerMatchesInput): Map<number, MatchFacts> {
  const facts = new Map<number, MatchFacts>();

  // 弃权场与未确认场次直接排除：不在 map 里的场次后面一律被丢弃
  const confirmById = new Map<number, PlayerMatchesInput['confirmations'][number]>();
  for (const row of input.confirmations) {
    if (row.walkoverSide !== null && row.walkoverSide !== '') continue;
    confirmById.set(row.matchId, row);
  }

  const ensure = (matchId: number): MatchFacts | null => {
    const existed = facts.get(matchId);
    if (existed) return existed;
    const confirm = confirmById.get(matchId);
    if (!confirm) return null;
    const created: MatchFacts = {
      confirm,
      teamId: null,
      growthTypes: new Set(),
      rating: null,
      saves: 0,
      goals: 0,
      assists: 0,
      yellow: 0,
      red: 0,
      penMiss: 0,
      ownGoal: 0,
      injuryOut: 0,
      events: [],
      missed: false,
      sources: new Set(),
    };
    facts.set(matchId, created);
    return created;
  };

  // ① 成长记录：任一记录即算该场有成长记录（= 出场来源之一）
  for (const row of input.growth) {
    const matchId = Number(row.matchRef);
    if (!Number.isInteger(matchId) || matchId <= 0) continue;
    const f = ensure(matchId);
    if (!f) continue;
    f.growthTypes.add(row.eventType);
    f.sources.add('growth');
    if (row.eventType === 'rating' && Number.isFinite(row.value)) f.rating = round2(row.value);
    if (row.eventType === 'saves' && Number.isFinite(row.value)) f.saves = Math.round(row.value);
  }

  // ② 赛事系统事件
  for (const ev of input.tourEvents) {
    const f = ensure(ev.matchId);
    if (!f) continue;
    f.sources.add('event');
    if (ev.entryTeamId !== null) f.teamId = ev.entryTeamId;
    const text = EVENT_TEXT[ev.own ? ev.type : 'assist'];
    if (text) f.events.push({ minute: ev.minute, text });
    if (!ev.own) {
      f.assists += 1;
      continue;
    }
    if (ev.type === 'goal' || ev.type === 'pen_goal') f.goals += 1;
    else if (ev.type === 'yellow') f.yellow += 1;
    else if (ev.type === 'red' || ev.type === 'red_2y') f.red += 1;
    else if (ev.type === 'pen_miss') f.penMiss += 1;
    else if (ev.type === 'own_goal') f.ownGoal += 1;
    else if (ev.type === 'injury_minor' || ev.type === 'injury_major') f.injuryOut += 1;
  }

  // ③ 赛前真实提交的首发
  for (const row of input.lineups) {
    const f = ensure(row.matchId);
    if (!f) continue;
    f.sources.add('lineup');
    f.teamId = row.teamId;
  }

  // ④ 伤病停赛名单
  for (const matchId of input.missed) {
    const f = ensure(matchId);
    if (f) f.missed = true;
  }

  // 两黄变一红：同场该球员有 red_2y → 该场黄牌不计（红牌已在上面照计）
  for (const f of facts.values()) {
    if (f.events.some((e) => e.text === EVENT_TEXT.red_2y)) f.yellow = 0;
    // 伤退按「场次」计：同场多条伤病事件只算 1
    if (f.injuryOut > 1) f.injuryOut = 1;
  }

  return facts;
}

/**
 * 归并结果 → 汇总 + 流水。`playerPosition` 为 GK 时，流水事件串会带上「零封 / 失球 N」前缀。
 */
export function aggregatePlayerMatches(input: PlayerMatchesInput): PlayerMatchesResult {
  const facts = buildFacts(input);
  const isGk = input.position === 'GK';
  const myNames = new Set(input.teamNameById.values());

  // 每场的主客与对手：先用该场队号对应的队名判，再用「我方队名集合」兜底
  const sideOf = (f: MatchFacts): 'home' | 'away' | null => {
    const { homeTeam, awayTeam } = f.confirm;
    const teamName = f.teamId === null ? null : (input.teamNameById.get(f.teamId) ?? null);
    if (teamName !== null) {
      if (teamName === homeTeam && teamName !== awayTeam) return 'home';
      if (teamName === awayTeam && teamName !== homeTeam) return 'away';
    }
    const home = homeTeam !== null && myNames.has(homeTeam);
    const away = awayTeam !== null && myNames.has(awayTeam);
    if (home && !away) return 'home';
    if (away && !home) return 'away';
    return null;
  };

  const items: PlayerMatchItem[] = [];
  const compAgg = new Map<string, CompStat>(); // key = season|comp|tournamentId
  const seasonRating = new Map<number, { sum: number; count: number }>();
  const compRating = new Map<string, { sum: number; count: number }>();

  for (const f of facts.values()) {
    const { confirm } = f;
    const competitionType = confirm.competitionType ?? '';
    const appeared = f.growthTypes.size > 0 || f.sources.has('event') || f.sources.has('lineup');
    const side = sideOf(f);
    const opponent = side === 'home' ? confirm.awayTeam : side === 'away' ? confirm.homeTeam : null;
    const conceded =
      appeared && side !== null && confirm.scoreHome !== null && confirm.scoreAway !== null
        ? side === 'home'
          ? confirm.scoreAway
          : confirm.scoreHome
        : null;
    const cleanSheet = conceded === 0;
    const competitionName = COMPETITION_LABEL[competitionType] ?? competitionType;
    const tournamentName =
      confirm.tournamentId === null ? null : (input.tournamentNameById.get(confirm.tournamentId) ?? null);

    // 流水事件串：门将带「零封 / 失球 N」，分钟事件按分钟升序，无分钟的排最后，扑救收尾
    const events: string[] = [];
    if (isGk && appeared) {
      if (cleanSheet) events.push('零封');
      else if (conceded !== null) events.push(`失球 ${conceded}`);
    }
    events.push(
      ...f.events
        .slice()
        .sort((a, b) => (a.minute ?? Number.MAX_SAFE_INTEGER) - (b.minute ?? Number.MAX_SAFE_INTEGER))
        .map((e) => (e.minute === null ? e.text : `${e.text} ${e.minute}′`)),
    );
    if (f.saves > 0) events.push(`扑救 ${f.saves}`);

    items.push({
      matchId: confirm.matchId,
      season: confirm.season,
      competitionType,
      competitionName,
      tournamentId: confirm.tournamentId,
      tournamentName,
      stageName: confirm.stageName,
      round: confirm.round,
      stageLabel: stageLabelOf(competitionName, confirm.stageName, confirm.round),
      date: dateOf(confirm.finishedAt),
      homeTeam: confirm.homeTeam,
      awayTeam: confirm.awayTeam,
      opponent,
      side,
      scoreHome: confirm.scoreHome,
      scoreAway: confirm.scoreAway,
      rating: f.rating,
      saves: f.saves,
      conceded,
      cleanSheet,
      events,
      missed: f.missed,
      appeared,
      sources: (['growth', 'event', 'lineup'] as AppearanceSource[]).filter((s) => f.sources.has(s)),
    });

    // 汇总：出场/评分/各项计数按赛事累加
    const key = `${confirm.season}|${competitionType}|${confirm.tournamentId ?? ''}`;
    let agg = compAgg.get(key);
    if (!agg) {
      agg = emptyComp(competitionType, confirm.tournamentId, tournamentName);
      compAgg.set(key, agg);
    }
    if (appeared) {
      agg.appearances += 1;
      if (conceded !== null) agg.conceded += conceded;
      if (cleanSheet) agg.cleanSheets += 1;
    }
    if (f.rating !== null) {
      agg.ratingCount += 1;
      const cr = compRating.get(key) ?? { sum: 0, count: 0 };
      cr.sum += f.rating;
      cr.count += 1;
      compRating.set(key, cr);
      const sr = seasonRating.get(confirm.season) ?? { sum: 0, count: 0 };
      sr.sum += f.rating;
      sr.count += 1;
      seasonRating.set(confirm.season, sr);
    }
    agg.goals += f.goals;
    agg.assists += f.assists;
    agg.yellow += f.yellow;
    agg.red += f.red;
    agg.penMiss += f.penMiss;
    agg.ownGoal += f.ownGoal;
    agg.injuryOut += f.injuryOut;
    agg.missed += f.missed ? 1 : 0;
    agg.saves += f.saves;
  }

  // 按赛季分组：赛季倒序，赛事按固定顺序
  const bySeason = new Map<number, CompStat[]>();
  for (const [key, agg] of compAgg) {
    const season = Number(key.split('|')[0]);
    const list = bySeason.get(season) ?? [];
    list.push(agg);
    bySeason.set(season, list);
  }

  const seasons: SeasonStats[] = [];
  for (const [season, comps] of [...bySeason].sort((a, b) => b[0] - a[0])) {
    comps.sort((a, b) => {
      const ai = COMP_ORDER.indexOf(a.competitionType);
      const bi = COMP_ORDER.indexOf(b.competitionType);
      const ao = ai < 0 ? COMP_ORDER.length : ai;
      const bo = bi < 0 ? COMP_ORDER.length : bi;
      if (ao !== bo) return ao - bo;
      if (a.competitionType !== b.competitionType) return a.competitionType < b.competitionType ? -1 : 1;
      return (a.tournamentId ?? 0) - (b.tournamentId ?? 0);
    });
    for (const c of comps) {
      const r = compRating.get(`${season}|${c.competitionType}|${c.tournamentId ?? ''}`);
      c.avgRating = r && r.count > 0 ? round2(r.sum / r.count) : null;
    }
    const total = emptyComp('', null, null);
    for (const c of comps) {
      total.appearances += c.appearances;
      total.ratingCount += c.ratingCount;
      total.goals += c.goals;
      total.assists += c.assists;
      total.yellow += c.yellow;
      total.red += c.red;
      total.penMiss += c.penMiss;
      total.ownGoal += c.ownGoal;
      total.injuryOut += c.injuryOut;
      total.missed += c.missed;
      total.cleanSheets += c.cleanSheets;
      total.conceded += c.conceded;
      total.saves += c.saves;
    }
    total.competitionName = '合计';
    const sr = seasonRating.get(season);
    total.avgRating = sr && sr.count > 0 ? round2(sr.sum / sr.count) : null;
    seasons.push({ season, comps, total });
  }

  // 逐场流水：完赛时间倒序（没有时间的排最后），同时间按 match id 倒序
  items.sort((a, b) => {
    const at = a.date ?? '';
    const bt = b.date ?? '';
    if (at !== bt) return at < bt ? 1 : -1;
    return b.matchId - a.matchId;
  });

  return { seasons, matches: items };
}
