#!/usr/bin/env node
// 生成 S9 弃权场奖金订正批的 SQL 工件（收回 + 补发）。
//
// 口径（用户 2026-10-06 三问拍板）：
//   ① 弃权场胜方照发胜场奖金、弃权方一分不发（连败方出场补贴也没有）；
//   ② 全库对齐——除巴塞罗那/莱比锡外，其他被误按败方发过补贴的真胜者也补差额；
//   ③ 弃权场的比赛日收入（kind='revenue'）一并收回。
//
// 缺陷依据：tour 库 `match.walkover_side` 标记的是**弃权方**（判负方），
//   `WHL-tournament-management-system/migrations/0013_walkover.sql` 原文：
//   「'' = 普通场；'home' / 'away' = 单方弃权（比分记 0:3，弃权方 0）」，
//   生产 10 场弃权场的 `note` 也逐场写着「主队弃权」/「客队弃权」、`winner` 一律是对手。
//   平台 `src/worker/prizes.ts:94-95` 却把 walkover_side 当胜方读 ⇒ 弃权方拿了胜场奖金、
//   真胜者拿了败方出场补贴（已发流水与代码读法一致，故方向整片反）。
//
// 本批只动生产数据；代码层修订另枚（v6.36.0，见 README「遗留」）。
//
// CLI：node gen-walkover-fix.ts [--verify] [--ts=<ISO>]
//   无参      → 生成 sql/ 与 sql/manifest.json
//   --verify  → 只读复核（逐队余额、逐键在位、守恒），不打工件
//   --ts=…    → 指定工件时间戳（默认当下）。补生成后续分片时要传回已执行批的时间戳，
//               否则 02-05 分片里的 created_at 会变、与已执行的 SQL 不再逐字一致

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BATCH_TS = ((): string => {
  const arg = process.argv.find((a) => a.startsWith('--ts='));
  return arg ? arg.slice('--ts='.length) : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
})();
const BATCH_REF_ID = 20261006;
const DB = 'whl-club';

// ---------------------------------------------------------------- 输入表

type Comp = 'league_premier' | 'league_second' | 'champions_cup';

/** 全库 10 场弃权场（tour 库 `match` 实测：note + winner 逐场核对）。 */
interface WoMatch {
  id: number;
  comp: Comp;
  homeTeam: number;
  awayTeam: number;
  /** 弃权方（= 判负方） */
  forfeit: 'home' | 'away';
  label: string;
}

const WO_MATCHES: WoMatch[] = [
  { id: 2, comp: 'champions_cup', homeTeam: 449, awayTeam: 112172, forfeit: 'away', label: '皇家贝蒂斯 vs RB莱比锡（客队弃权）' },
  { id: 31, comp: 'league_premier', homeTeam: 449, awayTeam: 241, forfeit: 'home', label: '皇家贝蒂斯 vs 巴塞罗那（主队弃权）' },
  { id: 38, comp: 'league_premier', homeTeam: 110374, awayTeam: 449, forfeit: 'away', label: '佛罗伦萨 vs 皇家贝蒂斯（客队弃权）' },
  { id: 48, comp: 'league_premier', homeTeam: 131681, awayTeam: 449, forfeit: 'away', label: 'AC米兰 vs 皇家贝蒂斯（客队弃权）' },
  { id: 165, comp: 'league_second', homeTeam: 21, awayTeam: 10, forfeit: 'home', label: '拜仁慕尼黑 vs 曼城（主队弃权）' },
  { id: 166, comp: 'league_second', homeTeam: 112172, awayTeam: 1, forfeit: 'home', label: 'RB莱比锡 vs 阿森纳（主队弃权）' },
  { id: 169, comp: 'league_second', homeTeam: 112172, awayTeam: 21, forfeit: 'home', label: 'RB莱比锡 vs 拜仁慕尼黑（主队弃权）' },
  { id: 172, comp: 'league_second', homeTeam: 2, awayTeam: 112172, forfeit: 'away', label: '阿斯顿维拉 vs RB莱比锡（客队弃权）' },
  { id: 176, comp: 'league_second', homeTeam: 112172, awayTeam: 14, forfeit: 'home', label: 'RB莱比锡 vs 诺丁汉森林（主队弃权）' },
  { id: 182, comp: 'league_second', homeTeam: 10, awayTeam: 112172, forfeit: 'away', label: '曼城 vs RB莱比锡（客队弃权）' },
];

const CLUB_NAME: Record<number, string> = {
  1: '阿森纳',
  2: '阿斯顿维拉',
  10: '曼城(CPU)',
  14: '诺丁汉森林',
  21: '拜仁慕尼黑',
  241: '巴塞罗那',
  449: '皇家贝蒂斯',
  110374: '佛罗伦萨',
  112172: 'RB莱比锡',
  131681: 'AC米兰(CPU)',
};

/** 奖金表（生产 config 无 prize_table 覆盖 ⇒ src/core/config.ts 的 CONFIG_DEFAULTS）。 */
const WIN: Record<Comp, number> = { league_premier: 8.5, league_second: 6.7, champions_cup: 7.0 };

/** 已发流水（生产 ledger_entries 实测，2026-10-06 快照）。 */
interface Paid {
  entryId: number;
  clubId: number;
  kind: 'prize' | 'revenue';
  amount: number;
  refType: string;
  refId: number;
  memo: string;
}

const PAID: Paid[] = [
  { entryId: 23, clubId: 449, kind: 'prize', amount: 8.5, refType: 'match_home', refId: 31, memo: '联赛胜场奖金（比赛 #31）' },
  { entryId: 40, clubId: 449, kind: 'prize', amount: 8.5, refType: 'match_away', refId: 38, memo: '联赛胜场奖金（比赛 #38）' },
  { entryId: 60, clubId: 449, kind: 'prize', amount: 8.5, refType: 'match_away', refId: 48, memo: '联赛胜场奖金（比赛 #48）' },
  { entryId: 31, clubId: 21, kind: 'prize', amount: 6.7, refType: 'match_home', refId: 165, memo: '联赛胜场奖金（比赛 #165）' },
  { entryId: 97, clubId: 449, kind: 'revenue', amount: 1.36, refType: 'match', refId: 2, memo: '比赛日收入（比赛 #2，上座 9081/17000，雨；票 1.36/商 0/播 0）' },
  { entryId: 24, clubId: 449, kind: 'revenue', amount: 1.08, refType: 'match', refId: 31, memo: '比赛日收入（比赛 #31，上座 7202/17000，多云；票 1.08/商 0/播 0）' },
  { entryId: 42, clubId: 110374, kind: 'revenue', amount: 1.91, refType: 'match', refId: 38, memo: '比赛日收入（比赛 #38，上座 12735/22000，晴；票 1.91/商 0/播 0）' },
  { entryId: 32, clubId: 21, kind: 'revenue', amount: 1.9, refType: 'match', refId: 165, memo: '比赛日收入（比赛 #165，上座 12699/35000，晴；票 1.9/商 0/播 0）' },
  { entryId: 63, clubId: 2, kind: 'revenue', amount: 1.29, refType: 'match', refId: 172, memo: '比赛日收入（比赛 #172，上座 8575/12000，多云；票 1.29/商 0/播 0）' },
];

/** 被平台按 CPU 跳过、按赛果应当补发的非弃权场（两队各场实测）。 */
interface Skipped {
  matchId: number;
  clubId: number;
  comp: Comp;
  side: 'home' | 'away';
  result: 'win' | 'loss' | 'draw';
  amount: number;
}

const SKIPPED: Skipped[] = [
  { matchId: 18, clubId: 241, comp: 'champions_cup', side: 'home', result: 'win', amount: 7.0 },
  { matchId: 27, clubId: 241, comp: 'champions_cup', side: 'away', result: 'win', amount: 7.0 },
  { matchId: 37, clubId: 241, comp: 'league_premier', side: 'home', result: 'loss', amount: 4.7 },
  { matchId: 44, clubId: 241, comp: 'league_premier', side: 'away', result: 'loss', amount: 4.7 },
  { matchId: 51, clubId: 241, comp: 'league_premier', side: 'away', result: 'loss', amount: 4.7 },
  { matchId: 57, clubId: 241, comp: 'league_premier', side: 'away', result: 'loss', amount: 4.7 },
  { matchId: 61, clubId: 241, comp: 'league_premier', side: 'home', result: 'win', amount: 8.5 },
  { matchId: 70, clubId: 241, comp: 'league_premier', side: 'away', result: 'draw', amount: 6.6 },
  { matchId: 22, clubId: 112172, comp: 'champions_cup', side: 'away', result: 'win', amount: 7.0 },
  { matchId: 183, clubId: 112172, comp: 'league_second', side: 'away', result: 'draw', amount: 4.8 },
];

/** 真胜者被误按败方发过出场补贴的场次（补差额，原流水保留 + memo 指回）。 */
interface Delta {
  matchId: number;
  clubId: number;
  side: 'home' | 'away';
  paidAmount: number;
  owedAmount: number;
  paidEntryId: number;
}

const DELTAS: Delta[] = [
  { matchId: 38, clubId: 110374, side: 'home', paidAmount: 4.7, owedAmount: 8.5, paidEntryId: 41 },
  { matchId: 166, clubId: 1, side: 'away', paidAmount: 2.9, owedAmount: 6.7, paidEntryId: 33 },
  { matchId: 169, clubId: 21, side: 'away', paidAmount: 2.9, owedAmount: 6.7, paidEntryId: 64 },
  { matchId: 172, clubId: 2, side: 'home', paidAmount: 2.9, owedAmount: 6.7, paidEntryId: 62 },
  { matchId: 176, clubId: 14, side: 'away', paidAmount: 2.9, owedAmount: 6.7, paidEntryId: 108 },
];

/** 执行前余额基线（2026-10-06 实测；--verify 用它核对净变化）。 */
const BASELINE: Record<number, number> = {
  1: 35.53,
  2: 16.41,
  14: 88.62,
  21: 55.93,
  241: -61.48,
  449: 69.92,
  110374: 27.25,
  112172: -57.69,
};

/** 弃权场的上座行（生产 match_attendance 实测 2026-10-06；10 场弃权场里只有这 5 场有行，
 *  与批里收回的 5 笔 revenue 一一对应）。收入四件套要清零：账本已收回，但球队页「比赛日收入」
 *  与财政页窗口聚合都从这张表读，不清零就会出现「钱已收回、界面还显示」的错位。
 *  行本身保留 —— 它同时是收入幂等闸（src/worker/home.ts:327）与主场战报的挂载点（弃权负/弃权胜仍要显示），
 *  weather 也保留（src/worker/routes/fixtures.ts 的「已确认取实际天气」）。 */
interface AttRow {
  matchId: number;
  clubId: number;
  attendance: number;
  ticket: number;
  commercial: number;
  broadcast: number;
}

const ATT_ROWS: AttRow[] = [
  { matchId: 2, clubId: 449, attendance: 9081, ticket: 1.36, commercial: 0, broadcast: 0 },
  { matchId: 31, clubId: 449, attendance: 7202, ticket: 1.08, commercial: 0, broadcast: 0 },
  { matchId: 38, clubId: 110374, attendance: 12735, ticket: 1.91, commercial: 0, broadcast: 0 },
  { matchId: 165, clubId: 21, attendance: 12699, ticket: 1.9, commercial: 0, broadcast: 0 },
  { matchId: 172, clubId: 2, attendance: 8575, ticket: 1.29, commercial: 0, broadcast: 0 },
];

// ---------------------------------------------------------------- 计划推导

/** 批后第三方写入（不是本批）：巴塞罗那 241 与 RB 莱比锡 112172 各 +30.00 —— 管理员「接队资金」
 *  手动入账（ledger_entries id 271 / 272，kind='manual_adjust'、ref_type='manual'、
 *  created_at 2026-10-06T04:43:58Z / 04:44:11Z）。核对时计入期望值，免得把别人的写入记成本批差异。 */
const POST_BATCH: Record<number, number> = { 241: 30, 112172: 30 };

const r2 = (v: number): number => Math.round(v * 100) / 100;
const money = (v: number): string => v.toFixed(2);
const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

interface Clawback {
  clubId: number;
  kind: 'prize' | 'revenue';
  amount: number;
  matchId: number;
  originalEntryId: number;
  memo: string;
}

/** 收回：弃权方拿到的胜场奖金 + 弃权场的比赛日收入。 */
const CLAWBACKS: Clawback[] = [
  ...PAID.filter((p) => p.kind === 'prize').map((p) => {
    const m = WO_MATCHES.find((w) => w.id === p.refId)!;
    const forfeiter = m.forfeit === 'home' ? m.homeTeam : m.awayTeam;
    if (p.clubId !== forfeiter) throw new Error(`流水 #${p.entryId} 的 club 不是弃权方，检查输入表`);
    return {
      clubId: p.clubId,
      kind: 'prize' as const,
      amount: p.amount,
      matchId: p.refId,
      originalEntryId: p.entryId,
      memo: `弃权场奖金回收（比赛 #${p.refId} ${m.label}；原流水 id=${p.entryId}，-${money(p.amount)}M）`,
    };
  }),
  ...PAID.filter((p) => p.kind === 'revenue').map((p) => {
    const m = WO_MATCHES.find((w) => w.id === p.refId)!;
    return {
      clubId: p.clubId,
      kind: 'revenue' as const,
      amount: p.amount,
      matchId: p.refId,
      originalEntryId: p.entryId,
      memo: `弃权场比赛日收入回收（比赛 #${p.refId} ${m.label}；原流水 id=${p.entryId}，-${money(p.amount)}M）`,
    };
  }),
];

interface Topup {
  clubId: number;
  side: 'home' | 'away';
  matchId: number;
  amount: number;
  refType: 'match_home' | 'match_away';
  memo: string;
}

/** 补发（缺项，走 canonical 键 kind='prize' + ref_type='match_home'/'match_away' + ref_id=matchId）。
 *  两条过滤：
 *    - CPU 队不发（`prizes.ts:67-71` 的既有闸；生产 is_cpu=1 = 曼城 10 / AC米兰 131681）；
 *    - 已被误发过流水、由 DELTAS 补差额的场次不再整笔重发（否则同场双发）。 */
const CPU_CLUBS = new Set([10, 131681]);
const DELTA_KEYS = new Set(DELTAS.map((d) => `${d.clubId}|${d.matchId}`));

const TOPUPS: Topup[] = [
  ...WO_MATCHES.map((m) => {
    const winnerTeam = m.forfeit === 'home' ? m.awayTeam : m.homeTeam;
    const winnerSide: 'home' | 'away' = m.forfeit === 'home' ? 'away' : 'home';
    return {
      clubId: winnerTeam,
      side: winnerSide,
      matchId: m.id,
      amount: WIN[m.comp],
      refType: (winnerSide === 'home' ? 'match_home' : 'match_away') as 'match_home' | 'match_away',
      memo: `弃权场胜场奖金（比赛 #${m.id} ${m.label}；原读法把弃权方当胜方，本次订正）`,
    };
  })
    .filter((t) => !CPU_CLUBS.has(t.clubId) && !DELTA_KEYS.has(`${t.clubId}|${t.matchId}`)),
  ...SKIPPED.map((s) => ({
    clubId: s.clubId,
    side: s.side,
    matchId: s.matchId,
    amount: s.amount,
    refType: (s.side === 'home' ? 'match_home' : 'match_away') as 'match_home' | 'match_away',
    memo: s.result === 'win'
      ? `联赛胜场奖金（比赛 #${s.matchId}，CPU 期补发）`
      : s.result === 'draw'
        ? `联赛平局奖金（比赛 #${s.matchId}，CPU 期补发）`
        : `联赛出场补贴（比赛 #${s.matchId}，CPU 期补发）`,
  })),
];

/** 差额补发（原键已被误发流水占用 ⇒ 另立 `_fix` 键，避免与重放冲突）。 */
const DELTA_TOPUPS = DELTAS.map((d) => ({
  clubId: d.clubId,
  side: d.side,
  matchId: d.matchId,
  amount: r2(d.owedAmount - d.paidAmount),
  refType: (d.side === 'home' ? 'match_home_fix' : 'match_away_fix') as 'match_home_fix' | 'match_away_fix',
  memo: `弃权场胜负订正差额（比赛 #${d.matchId}：出场补贴 ${money(d.paidAmount)} → 胜场奖金 ${money(d.owedAmount)}，原流水 id=${d.paidEntryId}）`,
}));

const netOf = (clubId: number): number =>
  r2(
    TOPUPS.filter((t) => t.clubId === clubId).reduce((a, t) => a + t.amount, 0)
    + DELTA_TOPUPS.filter((t) => t.clubId === clubId).reduce((a, t) => a + t.amount, 0)
    - CLAWBACKS.filter((c) => c.clubId === clubId).reduce((a, c) => a + c.amount, 0),
  );

// ---------------------------------------------------------------- SQL 生成

/** ledger 一笔 = 账户 UPDATE + 流水 INSERT 两条；流水闸 = 同键 NOT EXISTS（离线批可能被通道拆批，
 *  故不用 changes()>0 作闸，语义与 ledgerMovement 的幂等键一致）。 */
function ledgerPair(opts: {
  clubId: number;
  kind: string;
  amount: number;
  refType: string;
  refId: number;
  memo: string;
  guardSql: string;
}): string[] {
  const { clubId, kind, amount, refType, refId, memo, guardSql } = opts;
  const account = [
    'INSERT INTO ledger_accounts (club_id, balance, updated_at)',
    `SELECT ${clubId}, ${amount.toFixed(2)}, ${sqlStr(BATCH_TS)}`,
    ` WHERE ${guardSql}`,
    ' ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at',
    ` WHERE ${guardSql};`,
  ].join('\n');
  const entry = [
    'INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)',
    `SELECT ${clubId}, ${sqlStr(kind)}, ${amount.toFixed(2)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${clubId}), ${sqlStr(refType)}, ${refId}, ${sqlStr(memo)}, ${sqlStr(BATCH_TS)}`,
    ` WHERE ${guardSql};`,
  ].join('\n');
  return [account, entry];
}

function guardClause(clubId: number, kind: string, refType: string, refId: number): string {
  return `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${clubId} AND kind = ${sqlStr(kind)} AND ref_type = ${sqlStr(refType)} AND ref_id = ${refId})`;
}

const HEADER = (title: string, lines: string[]): string =>
  [`-- ${title}`, '--', `-- 生成时间：${BATCH_TS}`, `-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20`, ...lines.map((l) => `-- ${l}`), ''].join('\n');

function buildClawback(): string {
  const out = [HEADER('收回：弃权方错发的胜场奖金 + 弃权场比赛日收入（补偿分录，保留原流水）', [
    `共 ${CLAWBACKS.length} 笔 / ${CLAWBACKS.reduce((a, c) => a + c.amount, 0).toFixed(2)}M`,
    'kind=manual_adjust（前端「手动调整」标签已收录），ref_type 区分奖金/收入，memo 指回原流水 id',
    '每笔两句：账户按差额扣减（绝不 SET 绝对值）+ 反向流水；重放 changes=0',
  ])];
  for (const c of CLAWBACKS) {
    const refType = c.kind === 'prize' ? 'wo_rollback_prize' : 'wo_rollback_revenue';
    const guard = guardClause(c.clubId, 'manual_adjust', refType, c.matchId);
    out.push(`-- 收回 club ${c.clubId}（${CLUB_NAME[c.clubId]}）比赛 #${c.matchId} 的${c.kind === 'prize' ? '奖金' : '比赛日收入'} ${money(c.amount)}M`);
    out.push(...ledgerPair({ clubId: c.clubId, kind: 'manual_adjust', amount: -c.amount, refType, refId: c.matchId, memo: c.memo, guardSql: guard }));
  }
  return out.join('\n');
}

function buildTopups(): string {
  const out = [HEADER('补发：弃权场胜方奖金 + CPU 期被跳过的赛果奖金（canonical 键，重放安全）', [
    `共 ${TOPUPS.length} 笔 / ${TOPUPS.reduce((a, t) => a + t.amount, 0).toFixed(2)}M`,
    "kind='prize' 且 ref_type/ref_id 与平台发奖同键 ⇒ 日后代码修订后重放该场仍不会双发",
  ])];
  for (const t of TOPUPS) {
    const guard = guardClause(t.clubId, 'prize', t.refType, t.matchId);
    out.push(`-- 补发 club ${t.clubId}（${CLUB_NAME[t.clubId]}）比赛 #${t.matchId}（${t.side}）${money(t.amount)}M`);
    out.push(...ledgerPair({ clubId: t.clubId, kind: 'prize', amount: t.amount, refType: t.refType, refId: t.matchId, memo: t.memo, guardSql: guard }));
  }
  return out.join('\n');
}

function buildDeltas(): string {
  const out = [HEADER('补差额：真胜者被误按败方发过出场补贴的场次', [
    `共 ${DELTA_TOPUPS.length} 笔 / ${DELTA_TOPUPS.reduce((a, t) => a + t.amount, 0).toFixed(2)}M`,
    "原键（kind='prize' + match_home/match_away）已被误发流水占用 ⇒ 另立 `_fix` 键；",
    '原流水保留，本笔 memo 写明「出场补贴 x → 胜场奖金 y」与原流水 id',
  ])];
  for (const t of DELTA_TOPUPS) {
    const guard = guardClause(t.clubId, 'prize', t.refType, t.matchId);
    out.push(`-- 补差额 club ${t.clubId}（${CLUB_NAME[t.clubId]}）比赛 #${t.matchId}（${t.side}）+${money(t.amount)}M`);
    out.push(...ledgerPair({ clubId: t.clubId, kind: 'prize', amount: t.amount, refType: t.refType, refId: t.matchId, memo: t.memo, guardSql: guard }));
  }
  return out.join('\n');
}

function buildVerify(): string {
  const clubIds = [...new Set([...CLAWBACKS.map((c) => c.clubId), ...TOPUPS.map((t) => t.clubId), ...DELTA_TOPUPS.map((t) => t.clubId)])].sort((a, b) => a - b);
  const selects = clubIds.map(
    (id) => `  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = ${id}) AS bal_${id},`,
  );
  return [
    HEADER('执行后复查（只读，单行多标量）', [
      '逐队余额应等于 BASELINE + 净变化（见 README 表）；',
      'wo_rollback_* / _fix 计数应分别为 9 / 5；守恒位 conserve 应恒为 0。',
    ]),
    'SELECT',
    ...selects,
    '  (SELECT COUNT(*) FROM ledger_entries WHERE kind = \'manual_adjust\' AND ref_type LIKE \'wo_rollback%\') AS wo_rollback_n,',
    '  (SELECT COUNT(*) FROM ledger_entries WHERE kind = \'prize\' AND (ref_type = \'match_home_fix\' OR ref_type = \'match_away_fix\')) AS fix_n,',
    '  (SELECT COUNT(*) FROM ledger_entries WHERE kind = \'prize\' AND ref_type IN (\'match_home\', \'match_away\') AND ref_id IN (2,18,22,27,31,37,38,44,48,51,57,61,70,165,166,169,172,176,182,183) AND club_id IN (1,2,14,21,241,449,110374,112172)) AS wo_prize_n,',
    '  (SELECT COUNT(*) FROM match_attendance a JOIN result_confirmations rc ON rc.match_id = a.match_id WHERE rc.walkover_side IS NOT NULL AND rc.walkover_side != \'\') AS wo_att_n,',
    '  (SELECT COUNT(*) FROM match_attendance a JOIN result_confirmations rc ON rc.match_id = a.match_id WHERE rc.walkover_side IS NOT NULL AND rc.walkover_side != \'\' AND (a.attendance != 0 OR a.ticket != 0 OR a.commercial != 0 OR a.broadcast != 0)) AS wo_att_dirty_n,',
    '  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 回滚

function buildAttendanceCleanup(): string {
  const out = [HEADER('弃权场上座行清零：收入四件套（上座/门票/商业/转播）置 0，行与 weather 保留', [
    `共 ${ATT_ROWS.length} 行（比赛 ${ATT_ROWS.map((r) => '#' + r.matchId).join(' / ')}）`,
    '理由：账本里的比赛日收入已按用户裁决收回（02 分片），这张表是球队页与财政页窗口聚合的数据源；',
    '  不清零就会出现「钱已收回、界面仍显示收入」。行本身保留：它是收入幂等闸（src/worker/home.ts:327）',
    '  与主场战报挂载点，weather 供「已确认取实际天气」（src/worker/routes/fixtures.ts）。',
    '守卫：只在四列仍为原值时命中（重放 / 人工改过都不覆盖），重放 changes=0。',
  ])];
  for (const r of ATT_ROWS) {
    const guard = `match_id = ${r.matchId} AND club_id = ${r.clubId} AND attendance = ${r.attendance} AND ticket = ${money(r.ticket)} AND commercial = ${money(r.commercial)} AND broadcast = ${money(r.broadcast)}`;
    out.push(`-- 清零 club ${r.clubId}（${CLUB_NAME[r.clubId]}）比赛 #${r.matchId}：上座 ${r.attendance} → 0，门票 ${money(r.ticket)}M → 0`);
    out.push(`UPDATE match_attendance SET attendance = 0, ticket = 0, commercial = 0, broadcast = 0 WHERE ${guard};`);
  }
  return out.join('\n');
}

function buildRollback(): string {
  const out = [HEADER('回滚：撤销本批全部写入（补偿分录，保留本批流水）', [
    '顺序与本批相反：先撤差额、再撤补发、最后撤收回；',
    `ref_type='batch_rollback_wo'、ref_id=${BATCH_REF_ID}，每笔一句 NOT EXISTS 守卫，重放 changes=0`,
  ])];
  const push = (clubId: number, amount: number, memo: string, tag: string): void => {
    const guard = guardClause(clubId, 'manual_adjust', 'batch_rollback_wo', BATCH_REF_ID + (tag ? 0 : 0));
    void guard;
    const g = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${clubId} AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_wo' AND ref_id = ${BATCH_REF_ID} AND memo = ${sqlStr(memo)})`;
    out.push(...ledgerPair({ clubId, kind: 'manual_adjust', amount, refType: 'batch_rollback_wo', refId: BATCH_REF_ID, memo, guardSql: g }));
  };
  for (const t of DELTA_TOPUPS) push(t.clubId, -t.amount, `回滚弃权场胜负订正差额（比赛 #${t.matchId}）`, 'd');
  for (const t of TOPUPS) push(t.clubId, -t.amount, `回滚弃权场补发（比赛 #${t.matchId}，${money(t.amount)}M）`, 't');
  for (const c of CLAWBACKS) push(c.clubId, c.amount, `回滚弃权场回收（比赛 #${c.matchId}，原流水 id=${c.originalEntryId}，+${money(c.amount)}M）`, 'c');
  return out.join('\n');
}

function buildAttendanceRestore(): string {
  const out = [HEADER('回滚：还原弃权场上座行（收入四件套写回原值）', [
    `共 ${ATT_ROWS.length} 行，与 sql/06-attendance-cleanup.sql 一一对应`,
    '守卫：只在四列全为 0 时命中（即只撤本批的清零），重放 changes=0',
  ])];
  for (const r of ATT_ROWS) {
    out.push(`-- 还原 club ${r.clubId}（${CLUB_NAME[r.clubId]}）比赛 #${r.matchId}：上座 ${r.attendance}、门票 ${money(r.ticket)}M`);
    out.push(
      `UPDATE match_attendance SET attendance = ${r.attendance}, ticket = ${money(r.ticket)}, commercial = ${money(r.commercial)}, broadcast = ${money(r.broadcast)} WHERE match_id = ${r.matchId} AND club_id = ${r.clubId} AND attendance = 0 AND ticket = 0 AND commercial = 0 AND broadcast = 0;`,
    );
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- 工具

function queryRemote(sql: string): Record<string, unknown>[] {
  const oneLine = sql.replace(/\s+/g, ' ').trim(); // Windows 的 shell 会截断多行参数
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', DB, '--remote', '--json', `--command=${oneLine}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`查询失败（exit ${r.status}）：${r.stderr || r.stdout}`);
  const start = r.stdout.indexOf('[');
  const parsed = JSON.parse(r.stdout.slice(start)) as { results: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function write(rel: string, text: string): { file: string; bytes: number; sha256: string; statements: number } {
  const full = join(HERE, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, 'utf8');
  const statements = text.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--')).filter((l) => l.trimEnd().endsWith(';')).length;
  return { file: rel, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text), statements };
}

// ---------------------------------------------------------------- verify

function runVerify(): void {
  const clubIds = Object.keys(BASELINE).map(Number).sort((a, b) => a - b);
  const balances = queryRemote('SELECT club_id, ROUND(balance, 2) AS bal FROM ledger_accounts ORDER BY club_id');
  const live = new Map(balances.map((r) => [Number(r.club_id), Number(r.bal)]));
  // 三类键一起查：收回（manual_adjust + wo_rollback*）、差额（prize + *_fix）、
  // 补发（prize + canonical match_home/match_away —— 与平台发奖同键，故按 ref_id 圈到本批场次）
  const topupIds = [...new Set(TOPUPS.map((t) => t.matchId))].join(',');
  const keys = queryRemote(
    `SELECT club_id, kind, ref_type, ref_id, COUNT(*) AS n FROM ledger_entries WHERE (kind = 'manual_adjust' AND ref_type LIKE 'wo_rollback%') OR (kind = 'prize' AND (ref_type = 'match_home_fix' OR ref_type = 'match_away_fix' OR (ref_type IN ('match_home', 'match_away') AND ref_id IN (${topupIds})))) GROUP BY club_id, kind, ref_type, ref_id`,
  );
  const keyCount = new Map(keys.map((r) => [`${r.club_id}|${r.kind}|${r.ref_type}|${r.ref_id}`, Number(r.n)]));

  let bad = 0;
  console.log('逐队余额：');
  for (const id of clubIds) {
    const before = BASELINE[id];
    const net = netOf(id);
    const post = POST_BATCH[id] ?? 0;
    const expect = r2(before + net + post);
    const actual = live.get(id);
    const ok = actual !== undefined && Math.abs(actual - expect) < 0.011;
    if (!ok) bad += 1;
    console.log(`  club ${String(id).padStart(6)} ${CLUB_NAME[id].padEnd(8)} ${String(before).padStart(8)} + ${String(net).padStart(7)}${post ? ` + ${String(post).padStart(5)}（批后接队资金）` : ''} = ${String(expect).padStart(8)}  实际 ${String(actual).padStart(8)}  ${ok ? '✓' : '✗'}`);
  }
  console.log('弃权场上座行（应全为 0，行本身保留）：');
  const att = queryRemote(
    `SELECT a.match_id, a.club_id, a.attendance, a.ticket, a.commercial, a.broadcast FROM match_attendance a JOIN result_confirmations rc ON rc.match_id = a.match_id WHERE rc.walkover_side IS NOT NULL AND rc.walkover_side != '' ORDER BY a.match_id`,
  );
  for (const r of ATT_ROWS) {
    const row = att.find((x) => Number(x.match_id) === r.matchId && Number(x.club_id) === r.clubId);
    const zeroed = row !== undefined && Number(row.attendance) === 0 && Number(row.ticket) === 0 && Number(row.commercial) === 0 && Number(row.broadcast) === 0;
    if (!zeroed) bad += 1;
    console.log(`  比赛 #${r.matchId} club ${r.clubId}：${row ? `上座 ${row.attendance} / 门票 ${row.ticket}` : '行不存在'}  ${zeroed ? '✓' : '✗'}`);
  }
  const extra = att.filter((x) => !ATT_ROWS.some((r) => r.matchId === Number(x.match_id) && r.clubId === Number(x.club_id)));
  if (extra.length > 0) {
    bad += extra.length;
    console.log(`  另有 ${extra.length} 行弃权场上座行不在本批清单里 ✗：${extra.map((x) => `#${x.match_id}/club ${x.club_id}`).join(' ')}`);
  }
  console.log('逐键在位：');
  for (const c of CLAWBACKS) {
    const refType = c.kind === 'prize' ? 'wo_rollback_prize' : 'wo_rollback_revenue';
    const n = keyCount.get(`${c.clubId}|manual_adjust|${refType}|${c.matchId}`) ?? 0;
    if (n !== 1) bad += 1;
    console.log(`  收回 club ${c.clubId} #${c.matchId} ${refType}：${n} ${n === 1 ? '✓' : '✗'}`);
  }
  for (const t of TOPUPS) {
    const n = keyCount.get(`${t.clubId}|prize|${t.refType}|${t.matchId}`) ?? 0;
    if (n !== 1) bad += 1;
    console.log(`  补发 club ${t.clubId} #${t.matchId} ${t.refType}：${n} ${n === 1 ? '✓' : '✗'}`);
  }
  for (const t of DELTA_TOPUPS) {
    const n = keyCount.get(`${t.clubId}|prize|${t.refType}|${t.matchId}`) ?? 0;
    if (n !== 1) bad += 1;
    console.log(`  差额 club ${t.clubId} #${t.matchId} ${t.refType}：${n} ${n === 1 ? '✓' : '✗'}`);
  }
  const conserve = queryRemote('SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2) AS conserve');
  console.log(`守恒（Σ余额 − Σ流水）：${conserve[0]?.conserve}`);
  console.log(bad === 0 ? '只读复核：差异 0 ✓' : `只读复核：${bad} 处差异 ✗`);
  process.exit(bad === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- 自检

/** 自检：键不重复、不给弃权方补发、不与已发流水同场整笔双发、总额与手算一致。 */
function selfCheck(): { clawback: number; topup: number; delta: number; net: number } {
  const seen = new Set<string>();
  for (const t of [...TOPUPS, ...DELTA_TOPUPS]) {
    const k = `${t.clubId}|${t.refType}|${t.matchId}`;
    if (seen.has(k)) throw new Error(`补发键重复：${k}`);
    seen.add(k);
  }
  for (const p of PAID.filter((x) => x.kind === 'prize')) {
    const dup = TOPUPS.find((t) => t.clubId === p.clubId && t.matchId === p.refId);
    if (dup) throw new Error(`同场整笔双发：club ${p.clubId} 比赛 #${p.refId} 已有流水 #${p.entryId}`);
  }
  for (const m of WO_MATCHES) {
    const forfeiter = m.forfeit === 'home' ? m.homeTeam : m.awayTeam;
    if (TOPUPS.some((t) => t.clubId === forfeiter && t.matchId === m.id)) throw new Error(`补发表出现弃权方：club ${forfeiter} 比赛 #${m.id}`);
  }
  const clawback = r2(CLAWBACKS.reduce((a, c) => a + c.amount, 0));
  const topup = r2(TOPUPS.reduce((a, t) => a + t.amount, 0));
  const delta = r2(DELTA_TOPUPS.reduce((a, t) => a + t.amount, 0));
  const net = r2(topup + delta - clawback);
  const want = { clawback: 39.74, topup: 75.2, delta: 19.0, net: 54.46 };
  if (clawback !== want.clawback || topup !== want.topup || delta !== want.delta || net !== want.net) {
    throw new Error(`总额与手算不符：得 ${JSON.stringify({ clawback, topup, delta, net })}，应 ${JSON.stringify(want)}`);
  }
  // 上座行与「比赛日收入」收回必须一一对应：同场同队、金额相同
  const seenAtt = new Set<number>();
  for (const r of ATT_ROWS) {
    if (seenAtt.has(r.matchId)) throw new Error(`上座行比赛号重复：${r.matchId}`);
    seenAtt.add(r.matchId);
    const rev = CLAWBACKS.find((c) => c.kind === 'revenue' && c.matchId === r.matchId && c.clubId === r.clubId);
    if (!rev) throw new Error(`上座行没有对应的比赛日收入收回：比赛 #${r.matchId} club ${r.clubId}`);
    if (r2(r.ticket + r.commercial + r.broadcast) !== rev.amount) {
      throw new Error(`上座行收入与收回金额不符：比赛 #${r.matchId} 表 ${r2(r.ticket + r.commercial + r.broadcast)} vs 收回 ${rev.amount}`);
    }
  }
  const revClawbacks = CLAWBACKS.filter((c) => c.kind === 'revenue');
  if (ATT_ROWS.length !== revClawbacks.length) {
    throw new Error(`上座行数（${ATT_ROWS.length}）与比赛日收入收回笔数（${revClawbacks.length}）不符`);
  }
  const attTicket = r2(ATT_ROWS.reduce((a, r) => a + r.ticket, 0));
  if (attTicket !== 7.54) throw new Error(`上座行门票合计应为 7.54M，得 ${attTicket}`);
  return { clawback, topup, delta, net };
}

// ---------------------------------------------------------------- main

function main(): void {
  if (process.argv.includes('--verify')) {
    runVerify();
    return;
  }
  const totals = selfCheck();
  const { clawback: clawbackTotal, topup: topupTotal, delta: deltaTotal } = totals;

  const files = [
    write('sql/02-clawback.sql', buildClawback()),
    write('sql/03-topup-missing.sql', buildTopups()),
    write('sql/04-topup-delta.sql', buildDeltas()),
    write('sql/05-verify.sql', buildVerify()),
    write('sql/06-attendance-cleanup.sql', buildAttendanceCleanup()),
    write('rollback/01-undo.sql', buildRollback()),
    write('rollback/05-attendance-restore.sql', buildAttendanceRestore()),
  ];
  const manifest = {
    generatedAt: BATCH_TS,
    batchRefId: BATCH_REF_ID,
    totals: { clawback: clawbackTotal, topup: topupTotal, delta: deltaTotal, net: r2(topupTotal + deltaTotal - clawbackTotal) },
    perClub: Object.keys(BASELINE).map(Number).sort((a, b) => a - b).map((id) => ({ clubId: id, name: CLUB_NAME[id], baseline: BASELINE[id], net: netOf(id), expected: r2(BASELINE[id] + netOf(id)) })),
    woMatches: WO_MATCHES,
    clawbacks: CLAWBACKS,
    topups: TOPUPS,
    deltaTopups: DELTA_TOPUPS,
    attendanceCleanup: ATT_ROWS,
    files,
  };
  write('sql/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`生成完毕（${BATCH_TS}）`);
  console.log(`  收回 ${CLAWBACKS.length} 笔 = ${clawbackTotal.toFixed(2)}M`);
  console.log(`  补发 ${TOPUPS.length} 笔 = ${topupTotal.toFixed(2)}M`);
  console.log(`  差额 ${DELTA_TOPUPS.length} 笔 = ${deltaTotal.toFixed(2)}M`);
  console.log(`  上座清零 ${ATT_ROWS.length} 行 = ${r2(ATT_ROWS.reduce((a, r) => a + r.ticket, 0)).toFixed(2)}M（与比赛日收入收回对应）`);
  console.log(`  净变化 = ${manifest.totals.net.toFixed(2)}M`);
  for (const f of files) console.log(`  ${f.file}  ${f.bytes} B  ${f.statements} 语句  sha256 ${f.sha256.slice(0, 12)}…`);
}

main();
