// S9 第 1 窗工资触底订正批（prod-20261006-s9-wage-floor-fix）离线 SQL 生成器
//
// 缘起：用户 2026-10-06 两条令——
//   ①「上次扣工资时忽略了一点：顶级联赛未达 53、次级联赛未达 43 工资的球队，扣工资时按 53/43 扣除，
//      这个数字是对应级别工资帽 −15」；
//   ② 追问口径时拍板「直接把上次的扣款记录改改」（不补补偿分录）+「待会和成一批做」。
//   规则层（帽值 68/58 按级别、下限 = 帽 − 15、CPU 队不入账）已随 v6.39.0 落到 worker
//   （src/core/squad-rules.ts 的 DEFAULT_WAGE_CAP_BY_TIER / WAGE_FLOOR_GAP、src/worker/window-payroll.ts）；
//   本批只做**历史订正**：把 S9 第 1 窗（ref_id = 901）已扣的三队工资行改成触底额度。
//
// 口径（源码依据）：
//   · 下限 = 对应级别工资帽 − 15 ⇒ 顶级 68 − 15 = 53、次级 58 − 15 = 43。
//   · 级别真源：S9 定级赛事 season_tournaments（5 切尔西 / 449 皇家贝蒂斯 = league_premier，
//     280 奥林匹亚科斯 = league_second），与 src/worker/tier.ts 的 TIER_BY_TYPE 同源。
//   · 触底对象（Σ 现行合同工资 < 下限，见 sql/01-precheck.sql 的 D 段复核：
//     5 切尔西 49.23 → 53（再扣 3.77）、449 皇家贝蒂斯 33.37 → 53（再扣 19.63）、
//     280 奥林匹亚科斯 37.62 → 43（再扣 5.38），合计再扣 28.78 m）。
//   · 记账形状与 worker 同款：仍是同一行（kind = 'wage' / ref_type = 'window' / ref_id = 901），
//     只改 amount / balance_after / memo —— 用户口径「直接把上次的扣款记录改改」，不新增分录。
//   · memo 尾注与 src/worker/window-payroll.ts 的 floorNote 逐字一致：
//     「；未达<顶级|次级>下限 <floor> m，按下限扣」。
//
// 幂等与崩溃恢复（每条语句自带守卫 ⇒ 整批重放 changes = 0）：
//   · 标记 = 工资行的 (amount, memo 尾)。OLD 态 = amount 原值 且 memo 尾「 人现行合同）」；
//     NEW 态 = amount 触底值 且 memo 含「，按下限扣）」。
//   · 每队三条语句、顺序固定：①顺移工资行之后的流水 ②工资行触底 ③账户对账。
//     ②把标记 OLD → NEW，且放在 ① 之后 ⇒ 重放时 ①② 的守卫全为假。
//   · ③ 是「账户余额 := 该队最新一条流水的 balance_after」（守卫：两者不等才写）：天然幂等，
//     同时把 ①② 造成的余额变化对齐回账户行（预检 B 段已证明该不变式成立）。
//   · ① 除标记外还锚一条「工资行的下一行仍首尾相接」（nextChainIntact）：顺移一旦发生这条等式即假，
//     所以「① 已跑、② 未跑」的中途状态重跑整件时 ① 空跑、② 翻标记、③ 对账 ⇒ 收敛到订正态（自愈）。
//     工资行是最后一行（无后续流水）时 ① 恒空跑——本来也无行可移。
//
// 通道纪律（scripts/README.md 第 66 行）：ledger_* 含外键/需原子性 ⇒ 走 --command（exec-shards.mjs），
//   不走 --file；exec-shards 会拒收含 " % & | < > 的语句（--command 经 shell，cmd.exe 会把 > 当重定向）
//   ⇒ 本生成器全程不用这几个字符：行窗用 BETWEEN（`id > X` 改写为 `id BETWEEN X + 1 AND 2147483647`）、
//   memo 判据用 substr 相等与 `instr(…) != 0`（不用 LIKE/通配）、拼接一律走 REPLACE（不用 `||`）。
//   生成后可用 `node exec-shards.mjs <file> --local --dry` 自查（含元字符会 exit 3）。
//
// 用法：node gen-wage-floor-fix.mjs
//   ⇒ 生成 sql/{01-precheck,02-wage-floor-fix,03-verify,04-cpu-refund-optional}.sql、
//           rollback/{01-wage-floor,02-cpu-refund-optional}.sql、sql/manifest.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
/** 批标记时间：所有写入的 updated_at 都用它（离线批无真实事件时间）。 */
const BATCH_TS = new Date().toISOString();
/** S9 第 1 窗的窗口引用（src/worker/window-payroll.ts: refId = season * 100 + windowSeq = 9 * 100 + 1）。 */
const REF_ID = 901;

/** 触底订正队（old = S9 第 1 窗实际扣款额，来自 prod-20261006-s9-opening-align/sql/manifest.json 的 wages 段）。 */
const CLUBS = [
  { id: 5, name: '切尔西', tier: 'premier', cap: 68, floor: 53, old: 49.23, n: 31 },
  { id: 280, name: '奥林匹亚科斯', tier: 'second', cap: 58, floor: 43, old: 37.62, n: 30 },
  { id: 449, name: '皇家贝蒂斯', tier: 'premier', cap: 68, floor: 53, old: 33.37, n: 25 },
];

/** CPU 队（可选分片，默认不执行）：S9 第 1 窗按当时口径「财政导入排除、工资照扣」扣了工资，
 *  用户 2026-10-06 新令「cpu 也不扣工资」是否追溯回冲尚未裁决 ⇒ 单独出件、单独回滚件。 */
const CPU_CLUBS = [
  { id: 241, name: '巴塞罗那(CPU)', tier: 'premier', old: 61.48, n: 29 },
  { id: 112172, name: 'RB莱比锡(CPU)', tier: 'second', old: 57.69, n: 26 },
];

const TIER_LABEL = { premier: '顶级', second: '次级' };
/** S9 第 1 窗 memo 的尾片段（prod-20261006-s9-opening-align 的 buildWages 文案）。 */
const TAIL_OLD = ' 人现行合同）';
const floorNote = (tier, floor) => `；未达${TIER_LABEL[tier]}下限 ${floor} m，按下限扣）`;
const NOTE_TAIL = '，按下限扣）';

// ------------------------------------------------------------------ 工具

const round2 = (v) => Math.round(v * 100) / 100;
/** 定点小数字面量（不带科学计数法）。 */
const num = (v) => {
  const r = round2(v);
  return Object.is(r, -0) ? '0' : String(r);
};
/** SQL 字符串字面量：单引号包裹、内部单引号翻倍 ⇒ 语句里不出现双引号（exec-shards 的 shell 闸）。 */
const lit = (v) => `'${v.replace(/'/g, "''")}'`;
/** 字符数（用展开取码点，避免 UTF-16 长度与 SQLite 的字符口径不一致；本批全是 BMP 字符）。 */
const chars = (s) => [...s].length;
/** 「工资行之后」的行窗条件。故意不用 `id > (…)`：`>` 会被 exec-shards.mjs 的 shell 元字符闸拒收，
 *  写成 BETWEEN（无元字符）等价；工资行不存在时子查询为 NULL ⇒ BETWEEN 求值为 NULL ⇒ 匹配 0 行。 */
const afterWageRow = (id) =>
  `id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = ${id} AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = ${REF_ID}) AND 2147483647`;
/** 标记守卫片段：OLD 态 / NEW 态（取工资行现值，用于「同一队只写一次」）。 */
const markerOld = (id, old) =>
  `EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = ${id} AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = ${REF_ID} AND ROUND(x.amount, 2) = ${num(-old)} AND substr(x.memo, -${chars(TAIL_OLD)}) = ${lit(TAIL_OLD)})`;
/** NEW 态：命中判据用 `instr(…) != 0`（instr 未命中返回 0）——同样为了绕开 `>`。 */
const markerNew = (id, floor) =>
  `EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = ${id} AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = ${REF_ID} AND ROUND(x.amount, 2) = ${num(-floor)} AND instr(x.memo, ${lit(NOTE_TAIL)}) != 0)`;
/** ① 的崩溃恢复锚：工资行的**下一行**仍与工资行首尾相接（`n.balance_after = w.balance_after + n.amount`）。
 *  顺移一旦发生（① 只动后续行、不动工资行），这条等式立刻不成立 ⇒ 重放 ① 自动空跑，
 *  「① 已跑、② 未跑」的中途状态重跑整个正向件即可收敛（② 翻标记、③ 对账），不必手工修数。
 *  工资行是最后一行时 EXISTS 为假 ⇒ ① 空跑（本来也无行可顺移）。 */
const nextChainIntact = (id) =>
  `EXISTS (SELECT 1 FROM ledger_entries n JOIN ledger_entries w2 ON w2.id + 1 = n.id WHERE n.club_id = ${id} AND w2.club_id = ${id} AND w2.kind = 'wage' AND w2.ref_type = 'window' AND w2.ref_id = ${REF_ID} AND ROUND(n.balance_after, 2) = ROUND(w2.balance_after + n.amount, 2))`;

/** ③ 账户对账：账户余额 := 该队最新一条流水的 balance_after（守卫：不相等才写）。 */
function reconcileAccount(c, tag) {
  const tail = `(SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = ${c.id} ORDER BY e.id DESC LIMIT 1)`;
  return [
    `-- club ${c.id} ${c.name}：${tag}——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）`,
    `UPDATE ledger_accounts`,
    `SET balance = ${tail},`,
    `    updated_at = ${lit(BATCH_TS)}`,
    `WHERE club_id = ${c.id}`,
    `  AND ${tail} IS NOT NULL`,
    `  AND ROUND(balance, 2) != ROUND(${tail}, 2);`,
  ].join('\n');
}

// ------------------------------------------------------------------ 正向：工资触底订正

function forwardWageFloor() {
  const out = [
    '-- 02 工资触底订正：S9 第 1 窗（ref_id = 901）三队工资行改成级别下限额度',
    '-- 订单：顶级 5 切尔西 49.23 → 53（+3.77）/ 449 皇家贝蒂斯 33.37 → 53（+19.63）/ 次级 280 奥林匹亚科斯 37.62 → 43（+5.38）',
    '-- 合计再扣 28.78 m；每队三条语句（顺移后续流水 → 工资行触底 → 账户对账），顺序不得调换',
    '',
  ];
  for (const c of CLUBS) {
    const extra = round2(c.floor - c.old);
    const memoNew = ` 人现行合同${floorNote(c.tier, c.floor)}`;
    out.push(
      `-- club ${c.id} ${c.name}（${TIER_LABEL[c.tier]}，帽 ${c.cap}、下限 ${c.floor}、S9 第 1 窗实扣 ${num(c.old)}）`,
      `-- ① 该队工资行之后的流水 balance_after 整体 −${num(extra)}（只动 balance_after，不动金额）`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after - ${num(extra)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${nextChainIntact(c.id)}`,
      `  AND ${markerOld(c.id, c.old)};`,
      '',
      `-- ② 工资行触底：amount → ${num(-c.floor)}、balance_after −${num(extra)}、memo 补下限尾注（与 worker floorNote 逐字一致）`,
      `UPDATE ledger_entries`,
      `SET amount = ${num(-c.floor)},`,
      `    balance_after = ROUND(balance_after - ${num(extra)}, 2),`,
      `    memo = REPLACE(memo, ${lit(TAIL_OLD)}, ${lit(memoNew)})`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = ${num(-c.old)} AND substr(memo, -${chars(TAIL_OLD)}) = ${lit(TAIL_OLD)};`,
      '',
      reconcileAccount(c, `② 之后余额比最新流水少 ${num(extra)}`),
      '',
    );
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ 可选：CPU 队工资回冲

function forwardCpuRefund() {
  const out = [
    '-- 04（可选，默认不执行）CPU 队工资回冲：241 巴塞罗那 −61.48 / 112172 RB莱比锡 −57.69',
    '-- 用户 2026-10-06 令「cpu也不扣工资」，但 S9 第 1 窗是当时明确口径「财政导入排除、工资照扣」⇒ 是否追溯未裁决',
    '-- 采用「直接改上次记录」的同款形状：amount → 0（保留行与 ref 供审计）、余额与后续 balance_after 还原、memo 记原因',
    '-- 若用户改口径为「补一笔 manual_adjust 补偿分录」，则不要用本件，另出补偿分录件',
    '',
  ];
  for (const c of CPU_CLUBS) {
    const back = round2(c.old);
    const memoNew = ` 人现行合同；CPU 队不入账（用户令 2026-10-06），已冲正）`;
    out.push(
      `-- club ${c.id} ${c.name}（CPU，S9 第 1 窗实扣 ${num(c.old)}）`,
      `-- ① 该队工资行之后的流水 balance_after 整体 +${num(back)}`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after + ${num(back)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${nextChainIntact(c.id)}`,
      `  AND ${markerOld(c.id, c.old)};`,
      '',
      `-- ② 工资行冲正：amount → 0、balance_after +${num(back)}、memo 记原因`,
      `UPDATE ledger_entries`,
      `SET amount = 0,`,
      `    balance_after = ROUND(balance_after + ${num(back)}, 2),`,
      `    memo = REPLACE(memo, ${lit(TAIL_OLD)}, ${lit(memoNew)})`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = ${num(-c.old)} AND substr(memo, -${chars(TAIL_OLD)}) = ${lit(TAIL_OLD)};`,
      '',
      reconcileAccount(c, `② 之后余额比最新流水多 ${num(back)}`),
      '',
    );
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ 回滚

function rollbackWageFloor() {
  const out = [
    '-- 01 回滚工资触底订正：把 S9 第 1 窗三队工资行还原成原扣款额（逐条带守卫 ⇒ 重放 changes = 0）',
    '-- 顺序与正向相反：①后续流水 balance_after 还原 → ②工资行还原 → ③账户对账',
    '-- 守卫是 NEW 态标记（amount = 触底值 且 memo 含下限尾注）；②把标记翻回 OLD 态，故 ①② 必须在 ②之前',
    '',
  ];
  for (const c of CLUBS) {
    const extra = round2(c.floor - c.old);
    out.push(
      `-- club ${c.id} ${c.name}：还原 ${num(-c.floor)} → ${num(-c.old)}（后续流水 balance_after +${num(extra)}）`,
      `-- ① 该队工资行之后的流水 balance_after 整体 +${num(extra)}`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after + ${num(extra)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${nextChainIntact(c.id)}`,
      `  AND ${markerNew(c.id, c.floor)};`,
      '',
      `-- ② 工资行还原：amount → ${num(-c.old)}、balance_after +${num(extra)}、memo 去掉下限尾注`,
      `UPDATE ledger_entries`,
      `SET amount = ${num(-c.old)},`,
      `    balance_after = ROUND(balance_after + ${num(extra)}, 2),`,
      `    memo = REPLACE(memo, ${lit(floorNote(c.tier, c.floor))}, '）')`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = ${num(-c.floor)} AND instr(memo, ${lit(NOTE_TAIL)}) != 0;`,
      '',
      reconcileAccount(c, `② 之后余额比最新流水多 ${num(extra)}`),
      '',
    );
  }
  return out.join('\n');
}

function rollbackCpuRefund() {
  const out = [
    '-- 02（可选件的回滚）CPU 队工资回冲还原：把两行退回 S9 第 1 窗实扣额',
    '-- 只在执行过 sql/04-cpu-refund-optional.sql 之后才需要；逐条带守卫 ⇒ 重放 changes = 0',
    '',
  ];
  for (const c of CPU_CLUBS) {
    const back = round2(c.old);
    out.push(
      `-- club ${c.id} ${c.name}：还原 0 → ${num(-c.old)}（后续流水 balance_after −${num(back)}）`,
      `-- ① 该队工资行之后的流水 balance_after 整体 −${num(back)}`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after - ${num(back)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${nextChainIntact(c.id)}`,
      `  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = ${c.id} AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = ${REF_ID} AND ROUND(x.amount, 2) = 0 AND instr(x.memo, '已冲正') != 0);`,
      '',
      `-- ② 工资行还原：amount → ${num(-c.old)}、balance_after −${num(back)}、memo 去掉冲正说明`,
      `UPDATE ledger_entries`,
      `SET amount = ${num(-c.old)},`,
      `    balance_after = ROUND(balance_after - ${num(back)}, 2),`,
      `    memo = REPLACE(memo, '；CPU 队不入账（用户令 2026-10-06），已冲正）', '）')`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = 0 AND instr(memo, '已冲正') != 0;`,
      '',
      reconcileAccount(c, `② 之后余额比最新流水多 ${num(back)}`),
      '',
    );
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ 预检 / 复查

const PRECHECK = [
  {
    label: 'A',
    purpose: '三条工资行现状：amount 应为 −49.23 / −37.62 / −33.37、memo 尾为「 人现行合同）」',
    sql: `SELECT club_id, id, ROUND(amount, 2) AS amount, balance_after, memo, created_at
FROM ledger_entries
WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND club_id IN (5, 280, 449)
ORDER BY club_id;`,
  },
  {
    label: 'B',
    purpose: '三队账户余额与最新一条流水：invariant 必须全为 consistent（③ 对账语句的不变式前提）',
    sql: `SELECT a.club_id,
       ROUND(a.balance, 2) AS account_balance,
       a.updated_at,
       (SELECT e.id FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS tail_id,
       (SELECT ROUND(e.balance_after, 2) FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS tail_balance,
       CASE WHEN ROUND(a.balance, 2) = ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1), 2) THEN 'consistent' ELSE 'DRIFT' END AS invariant
FROM ledger_accounts a
WHERE a.club_id IN (5, 280, 449)
ORDER BY a.club_id;`,
  },
  {
    label: 'C',
    purpose: '工资行之后的流水（本批要顺移 balance_after 的行）：期望 0 行；有行时逐行核对影响面',
    sql: `SELECT e.club_id, e.id, e.kind, ROUND(e.amount, 2) AS amount, e.balance_after, e.created_at
FROM ledger_entries e
WHERE e.club_id IN (5, 280, 449)
  AND e.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = e.club_id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = ${REF_ID}) AND 2147483647
ORDER BY e.club_id, e.id;`,
  },
  {
    label: 'D',
    purpose: 'Σ 现行合同工资与人数（触底判据）：期望 5→49.23/31 人、280→37.62/30 人、449→33.37/25 人',
    sql: `SELECT ct.club_id, c.name, ROUND(SUM(ct.wage), 2) AS wage_sum, COUNT(*) AS n
FROM contracts ct JOIN clubs c ON c.id = ct.club_id
WHERE ct.is_active = 1 AND ct.club_id IS NOT NULL AND ct.wage IS NOT NULL AND ct.club_id IN (5, 280, 449)
GROUP BY ct.club_id, c.name
ORDER BY ct.club_id;`,
  },
  {
    label: 'E',
    purpose: 'CPU 旗标：5 / 280 / 449 必须 is_cpu = 0（CPU 队不进本批的触底订正）',
    sql: `SELECT id, name, is_cpu FROM clubs WHERE id IN (5, 241, 280, 449, 112172) ORDER BY id;`,
  },
  {
    label: 'F',
    purpose: '级别证据：S9 定级赛事（league_premier / league_second）——5/449 顶级、280 次级',
    sql: `SELECT id, season, tournament_id, competition_type
FROM season_tournaments
WHERE season = 9 AND competition_type IN ('league_premier', 'league_second')
ORDER BY competition_type;`,
  },
  {
    label: 'G',
    purpose: '已修检测：期望 0 行（>0 说明本批已跑过，先看 03-verify.sql 再决定）',
    sql: `SELECT club_id, ROUND(amount, 2) AS amount, memo
FROM ledger_entries
WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND club_id IN (5, 280, 449)
  AND instr(memo, ${lit(NOTE_TAIL)}) != 0
ORDER BY club_id;`,
  },
];

function verifyShard() {
  return [
    '-- 03 复查（只读，可在 --file 或 --command 通道跑）：期望每条 probe 的 hits 与 expected 相等',
    '',
    `-- v1 三队工资行已触底且带下限尾注（期望 3/3）`,
    `SELECT 'v1 三队工资行触底 + 尾注' AS probe,`,
    `  (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND ROUND(amount, 2) = -53 AND instr(memo, ${lit(NOTE_TAIL)}) != 0)`,
    `+ (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND ROUND(amount, 2) = -43 AND instr(memo, ${lit(NOTE_TAIL)}) != 0)`,
    `+ (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND ROUND(amount, 2) = -53 AND instr(memo, ${lit(NOTE_TAIL)}) != 0) AS hits,`,
    `  3 AS expected;`,
    '',
    `-- v2 三队账户与最新流水一致（期望 3 行全 consistent）`,
    `SELECT a.club_id, ROUND(a.balance, 2) AS account_balance,`,
    `       (SELECT ROUND(e.balance_after, 2) FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1) AS tail_balance,`,
    `       CASE WHEN ROUND(a.balance, 2) = ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = a.club_id ORDER BY e.id DESC LIMIT 1), 2) THEN 'consistent' ELSE 'DRIFT' END AS invariant`,
    `FROM ledger_accounts a WHERE a.club_id IN (5, 280, 449) ORDER BY a.club_id;`,
    '',
    `-- v3 三队工资行合计（期望 -149.00：53 + 43 + 53；旧值 -120.22，差额 -28.78）`,
    `SELECT 'v3 三队工资行合计' AS probe, ROUND(SUM(amount), 2) AS sum_now, COUNT(*) AS rows_now, -149.0 AS expected_sum`,
    `FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND club_id IN (5, 280, 449);`,
    '',
    `-- v4 其余 15 队工资行（期望 n = 15、合计 -902.46：本批零波及）`,
    `SELECT 'v4 其余 15 队零波及' AS probe, COUNT(*) AS n, ROUND(SUM(amount), 2) AS sum_others, -902.46 AS expected_sum, 15 AS expected_n`,
    `FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND club_id NOT IN (5, 280, 449);`,
    '',
    `-- v5 CPU 两行现状（参考，本批不动；执行可选件 04 后再看这里）`,
    `SELECT club_id, ROUND(amount, 2) AS amount, balance_after, memo`,
    `FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND club_id IN (241, 112172) ORDER BY club_id;`,
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ 主流程

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RB_DIR, { recursive: true });

const extraTotal = round2(CLUBS.reduce((s, c) => s + (c.floor - c.old), 0));
const oldTotal = round2(CLUBS.reduce((s, c) => s + c.old, 0));
const newTotal = round2(CLUBS.reduce((s, c) => s + c.floor, 0));

const files = [
  { path: join(OUT_DIR, '01-precheck.sql'), body: `${['-- 01 预检（只读）：A–G 七段，逐段核对后再跑正向件', '-- 抓取：node capture-snapshot.mjs（默认 --remote，只跑 SELECT）', '', ...PRECHECK.map((p) => `-- ${p.label} · ${p.purpose}\n${p.sql}\n`)].join('\n')}` },
  { path: join(OUT_DIR, '02-wage-floor-fix.sql'), body: forwardWageFloor() },
  { path: join(OUT_DIR, '03-verify.sql'), body: verifyShard() },
  { path: join(OUT_DIR, '04-cpu-refund-optional.sql'), body: forwardCpuRefund() },
  { path: join(RB_DIR, '01-wage-floor.sql'), body: rollbackWageFloor() },
  { path: join(RB_DIR, '02-cpu-refund-optional.sql'), body: rollbackCpuRefund() },
];
for (const f of files) writeFileSync(f.path, f.body);

const statementsOf = (body) => body.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('--') && l.trim().endsWith(';')).length;

const manifest = {
  batch: 'prod-20261006-s9-wage-floor-fix',
  generatedAt: BATCH_TS,
  rule: {
    order: '顶级联赛未达 53、次级联赛未达 43 工资的球队，扣工资时按 53/43 扣除（= 对应级别工资帽 − 15）',
    wageCapByTier: { premier: 68, second: 58 },
    floorGap: 15,
    floorByTier: { premier: 53, second: 43 },
    source: 'src/core/squad-rules.ts（DEFAULT_WAGE_CAP_BY_TIER / WAGE_FLOOR_GAP）+ src/worker/window-payroll.ts（v6.39.0）',
    refId: REF_ID,
    refIdMeaning: 'season * 100 + windowSeq = S9 第 1 窗',
  },
  clubs: CLUBS.map((c) => ({
    clubId: c.id,
    clubName: c.name,
    tier: c.tier,
    cap: c.cap,
    floor: c.floor,
    oldAmount: -c.old,
    newAmount: -c.floor,
    extra: round2(c.floor - c.old),
    contracts: c.n,
  })),
  totals: { oldAmount: -oldTotal, newAmount: -newTotal, extra: -extraTotal, other15ClubsSum: -902.46, grandTotalAfter: -1051.46 },
  cpuOptional: {
    approved: false,
    note: '用户 2026-10-06 令「cpu也不扣工资」，但 S9 第 1 窗按当时口径「财政导入排除、工资照扣」已扣；是否追溯回冲待裁决 ⇒ 件已备，默认不执行',
    clubs: CPU_CLUBS.map((c) => ({ clubId: c.id, clubName: c.name, tier: c.tier, chargedAmount: -c.old, refundTo: 0 })),
  },
  precheck: PRECHECK.map((p) => ({ label: p.label, purpose: p.purpose })),
  files: files.map((f) => ({ path: f.path.replace(HERE, '').replace(/\\/g, '/'), statements: statementsOf(f.body) })),
};

writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`批：${manifest.batch}（generatedAt ${BATCH_TS}）`);
for (const f of manifest.files) console.log(`  ${f.path.padEnd(42)} ${String(f.statements).padStart(3)} 条语句`);
console.log(`触底订正：${CLUBS.length} 队，${num(-oldTotal)} → ${num(-newTotal)} m，再扣 ${num(extraTotal)} m`);
for (const c of manifest.clubs) {
  console.log(`  · club ${c.clubId} ${c.clubName}（${TIER_LABEL[c.tier]} ${c.cap}−15=${c.floor}）：${num(c.oldAmount)} → ${num(c.newAmount)}（${num(-c.extra)}）`);
}
console.log(`可选件（默认不执行，待裁决）：CPU ${CPU_CLUBS.map((c) => `${c.id} ${num(-c.old)}`).join(' / ')}`);
