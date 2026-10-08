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
//   · 每队三条语句、顺序固定：②工资行触底 → ①顺移工资行之后的流水 → ③账户对账。
//     ② 先跑 ⇒ ① 的守卫（NEW 态 且 链断）首跑成立、重放不成立。
//   · ① 的锚是「该队工资行的下一条**本队**流水仍与工资行首尾相接」的反面（nextChainBroken）：
//     顺移一旦发生这条等式即假。取行用 `MIN(m.id)`，**不假设 id 相邻**——旧版写 `w2.id + 1 = n.id`
//     在生产栽了：各队流水 id 交错（如 club 5 工资行 id 229、下一条 club 5 流水 id 277），
//     相邻锚恒假 ⇒ ① 空跑，只改了工资行、没顺移下游（2026-10-08 部分收敛事故，见 report.md）。
//   · 四态自愈：P 都没跑 / ② 只跑了② / N 都跑了（链相连）/ X 只跑了①——任一态跑一次 ②①③ 都到 N，
//     再跑一次全空跑。回滚件同构（②' 还原工资行 → ①' 把下游加回 → ③' 对账）。
//   · ③ 是「账户余额 := 该队最新一条流水的 balance_after」（守卫：两者不等才写）：天然幂等，
//     同时把 ①② 造成的余额变化对齐回账户行（预检 B 段已证明该不变式成立）。
//   · 工资行是最后一行（无后续流水）时 ① 的窗口为空 ⇒ changes = 0（本来也无行可移）。
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

/** CPU 期工资冲正队（用户 2026-10-08 令「CPU财政回溯」⇒ 本件转为**必跑**，件名保留 -optional 以防引用失效）：
 *  S9 第 1 窗（2026-10-06 03:08）扣款时两队仍是 CPU 队（当时口径「财政导入排除、工资照扣」）；
 *  两队随后于 2026-10-06 04:43/04:44 被真人接队（流水有「接队资金」+30），故 clubs.is_cpu 现为 0 是正确的，
 *  本件只回冲 CPU 期那笔工资，不涉其余入账。 */
const CPU_CLUBS = [
  { id: 241, name: '巴塞罗那', tier: 'premier', old: 61.48, n: 29 },
  { id: 112172, name: 'RB莱比锡', tier: 'second', old: 57.69, n: 26 },
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
 *  写成 BETWEEN（无元字符）等价；工资行不存在时子查询为 NULL ⇒ BETWEEN 求值为 NULL ⇒ 匹配 0 行。
 *  col 传 'id'（UPDATE 的 WHERE，裸列）或 'm.id'（子查询里带前缀，避免与别的表歧义）。 */
const afterWageRowOn = (col, id) =>
  `${col} BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = ${id} AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = ${REF_ID}) AND 2147483647`;
const afterWageRow = (id) => afterWageRowOn('id', id);
/** 工资行现值的标量子查询（同队同窗只应有一行）；无工资行时为 NULL。 */
const wageField = (id, col) =>
  `(SELECT x.${col} FROM ledger_entries x WHERE x.club_id = ${id} AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = ${REF_ID})`;
/** 该队工资行的下一条**本队**流水 id（无后续流水时为 NULL）。 */
const nextRowId = (id) =>
  `(SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = ${id} AND ${afterWageRowOn('m.id', id)})`;
/** 标记守卫片段：OLD 态 / NEW 态（取工资行现值，用于「同一队只写一次」）。 */
const markerOld = (id, old) =>
  `EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = ${id} AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = ${REF_ID} AND ROUND(x.amount, 2) = ${num(-old)} AND substr(x.memo, -${chars(TAIL_OLD)}) = ${lit(TAIL_OLD)})`;
/** NEW 态：命中判据用 `instr(…) != 0`（instr 未命中返回 0）——同样为了绕开 `>`。
 *  target = 目标 amount（工资触底件传 −floor，CPU 冲正件传 0）。 */
const markerNew = (id, target, note = NOTE_TAIL) =>
  `EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = ${id} AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = ${REF_ID} AND ROUND(x.amount, 2) = ${num(target)} AND instr(x.memo, ${lit(note)}) != 0)`;
/** ① 的崩溃恢复锚：该队工资行的下一条本队流水**不再**与工资行首尾相接（链断）。
 *  顺移一旦发生（① 只动后续行、不动工资行）这条等式立刻不成立 ⇒ 重放 ① 自动空跑。
 *  取行用 MIN(id) 而非 id + 1：生产各队流水 id 交错，相邻假设不成立（事故根因）。
 *  工资行是最后一行时 nextRowId 为 NULL ⇒ NOT EXISTS 为真 ⇒ ① 仍会执行但窗口为空（changes = 0），无害。
 *  已知假设：下一条流水的 amount ≠ 0（否则可能巧合相等而被误判成「已顺移」；本批涉及的候选行金额全非 0）。 */
const nextChainBroken = (id) =>
  `NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = ${id} AND n.id = ${nextRowId(id)} AND ROUND(n.balance_after, 2) = ROUND(${wageField(id, 'balance_after')} + n.amount, 2))`;
const CPU_NOTE = '已冲正';
/** CPU 冲正件的 memo 尾注（正向件与回滚件同源；回滚时整段删掉还原成「 人现行合同）」）。 */
const CPU_MEMO_NOTE = `；CPU 队不入账（用户令 2026-10-06），${CPU_NOTE}）`;

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
    '-- 合计再扣 28.78 m；每队三条语句（工资行触底 → 顺移后续流水 → 账户对账），顺序不得调换',
    '',
  ];
  for (const c of CLUBS) {
    const extra = round2(c.floor - c.old);
    const memoNew = ` 人现行合同${floorNote(c.tier, c.floor)}`;
    out.push(
      `-- club ${c.id} ${c.name}（${TIER_LABEL[c.tier]}，帽 ${c.cap}、下限 ${c.floor}、S9 第 1 窗实扣 ${num(c.old)}）`,
      `-- ② 工资行触底：amount → ${num(-c.floor)}、balance_after −${num(extra)}、memo 补下限尾注（与 worker floorNote 逐字一致）`,
      `UPDATE ledger_entries`,
      `SET amount = ${num(-c.floor)},`,
      `    balance_after = ROUND(balance_after - ${num(extra)}, 2),`,
      `    memo = REPLACE(memo, ${lit(TAIL_OLD)}, ${lit(memoNew)})`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = ${num(-c.old)} AND substr(memo, -${chars(TAIL_OLD)}) = ${lit(TAIL_OLD)};`,
      '',
      `-- ① 该队工资行之后的流水 balance_after 整体 −${num(extra)}（只动 balance_after，不动金额）`,
      `-- 守卫：工资行已在触底态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after - ${num(extra)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${markerNew(c.id, -c.floor)}`,
      `  AND ${nextChainBroken(c.id)};`,
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
    '-- 04 CPU 期工资冲正：241 巴塞罗那 −61.48 / 112172 RB莱比锡 −57.69（用户 2026-10-08 令「CPU财政回溯」）',
    '-- 采用「直接改上次记录」的同款形状：amount → 0（保留行与 ref 供审计）、余额与后续 balance_after 还原、memo 记原因',
    '-- 若用户改口径为「补一笔 manual_adjust 补偿分录」，则不要用本件，另出补偿分录件',
    '',
  ];
  for (const c of CPU_CLUBS) {
    const back = round2(c.old);
    const memoNew = ` 人现行合同${CPU_MEMO_NOTE}`;
    out.push(
      `-- club ${c.id} ${c.name}（CPU 期，S9 第 1 窗实扣 ${num(c.old)}）`,
      `-- ② 工资行冲正：amount → 0（保留行与 ref 供审计）、balance_after +${num(back)}、memo 记原因`,
      `UPDATE ledger_entries`,
      `SET amount = 0,`,
      `    balance_after = ROUND(balance_after + ${num(back)}, 2),`,
      `    memo = REPLACE(memo, ${lit(TAIL_OLD)}, ${lit(memoNew)})`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = ${num(-c.old)} AND substr(memo, -${chars(TAIL_OLD)}) = ${lit(TAIL_OLD)};`,
      '',
      `-- ① 该队工资行之后的流水 balance_after 整体 +${num(back)}（含接队后的奖金/接队资金等 5–10 行）`,
      `-- 守卫：工资行已在冲正态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after + ${num(back)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${markerNew(c.id, 0, CPU_NOTE)}`,
      `  AND ${nextChainBroken(c.id)};`,
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
    '-- 顺序：② 工资行还原 → ① 后续流水 balance_after 还原 → ③ 账户对账',
    '-- ② 的守卫是 NEW 态标记（amount = 触底值 且 memo 含下限尾注），跑完翻回 OLD 态',
    '-- ① 的守卫 = OLD 态 且 下一条本队流水与工资行不相接 ⇒ 只在「② 已还原、下游仍被顺移」时执行',
    '',
  ];
  for (const c of CLUBS) {
    const extra = round2(c.floor - c.old);
    out.push(
      `-- club ${c.id} ${c.name}：还原 ${num(-c.floor)} → ${num(-c.old)}（后续流水 balance_after +${num(extra)}）`,
      `-- ②' 工资行还原：amount → ${num(-c.old)}、balance_after +${num(extra)}、memo 去掉下限尾注`,
      `UPDATE ledger_entries`,
      `SET amount = ${num(-c.old)},`,
      `    balance_after = ROUND(balance_after + ${num(extra)}, 2),`,
      `    memo = REPLACE(memo, ${lit(floorNote(c.tier, c.floor))}, '）')`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = ${num(-c.floor)} AND instr(memo, ${lit(NOTE_TAIL)}) != 0;`,
      '',
      `-- ①' 该队工资行之后的流水 balance_after 整体 +${num(extra)}（把 ① 的顺移加回）`,
      `-- 守卫：工资行已还原成原值 且 下一条本队流水与工资行不相接（= ②' 已跑而 ①' 未跑的中途态）`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after + ${num(extra)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${markerOld(c.id, c.old)}`,
      `  AND ${nextChainBroken(c.id)};`,
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
      `-- ②' 工资行还原：amount → ${num(-c.old)}、balance_after −${num(back)}、memo 去掉冲正说明`,
      `UPDATE ledger_entries`,
      `SET amount = ${num(-c.old)},`,
      `    balance_after = ROUND(balance_after - ${num(back)}, 2),`,
      `    memo = REPLACE(memo, '${CPU_MEMO_NOTE}', '）')`,
      `WHERE club_id = ${c.id} AND kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID}`,
      `  AND ROUND(amount, 2) = 0 AND instr(memo, ${lit(CPU_NOTE)}) != 0;`,
      '',
      `-- ①' 该队工资行之后的流水 balance_after 整体 −${num(back)}（把 ① 的顺移加回）`,
      `-- 守卫：工资行已还原成原值 且 下一条本队流水与工资行不相接（= ②' 已跑而 ①' 未跑的中途态）`,
      `UPDATE ledger_entries`,
      `SET balance_after = ROUND(balance_after - ${num(back)}, 2)`,
      `WHERE club_id = ${c.id}`,
      `  AND ${afterWageRow(c.id)}`,
      `  AND ${markerOld(c.id, c.old)}`,
      `  AND ${nextChainBroken(c.id)};`,
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
    purpose: '工资行之后的流水（本批要顺移 balance_after 的行）：生产实况 7 行（club 5 一行 id 277、club 449 六行 id 245–254）——旧版以为 0 行',
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
    purpose: 'CPU 旗标：5 / 280 / 449 必须 is_cpu = 0；241 / 112172 现为 0 是**正确的**（2026-10-06 04:43 起被真人接队，见 H 段的「接队资金」行）',
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
    purpose: '已修检测：三队期望 0 行（>0 说明触底件已跑过，先看 03-verify.sql 再决定）',
    sql: `SELECT club_id, ROUND(amount, 2) AS amount, memo
FROM ledger_entries
WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = ${REF_ID} AND club_id IN (5, 280, 449)
  AND instr(memo, ${lit(NOTE_TAIL)}) != 0
ORDER BY club_id;`,
  },
  {
    label: 'H',
    purpose: 'CPU 期工资冲正目标（04 件）：241 / 112172 的工资行 + 之后全部流水（含「接队资金」「CPU 期补发」）+ 账户',
    sql: `SELECT e.club_id, e.id, e.kind, ROUND(e.amount, 2) AS amount, ROUND(e.balance_after, 2) AS bal, e.created_at, e.memo
FROM ledger_entries e
WHERE e.club_id IN (241, 112172)
ORDER BY e.club_id, e.id;`,
  },
  {
    label: 'I',
    purpose: '链相连诊断（正向 ① 的守卫依据）：下一条本队流水是否与工资行首尾相接——linked / broken / no-downstream（工资行是末行）三态，跑前 5/280/449 应为 linked（生产事故后 5 与 449 曾为 broken），顺移后仍全 linked',
    sql: `SELECT c.id AS club_id, c.name,
  (SELECT w.id FROM ledger_entries w WHERE w.club_id = c.id AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = ${REF_ID}) AS wage_id,
  ${nextRowId('c.id')} AS next_id,
  ${wageField('c.id', 'balance_after')} AS wage_bal,
  (SELECT n.balance_after FROM ledger_entries n WHERE n.club_id = c.id AND n.id = ${nextRowId('c.id')}) AS next_bal,
  CASE WHEN ${nextRowId('c.id')} IS NULL THEN 'no-downstream' WHEN ROUND((SELECT n.balance_after FROM ledger_entries n WHERE n.club_id = c.id AND n.id = ${nextRowId('c.id')}), 2) = ROUND(${wageField('c.id', 'balance_after')} + (SELECT n.amount FROM ledger_entries n WHERE n.club_id = c.id AND n.id = ${nextRowId('c.id')}), 2) THEN 'linked' ELSE 'broken' END AS chain
FROM clubs c WHERE c.id IN (5, 280, 449, 241, 112172) ORDER BY c.id;`,
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
  { path: join(OUT_DIR, '01-precheck.sql'), body: `${['-- 01 预检（只读）：A–I 九段，逐段核对后再跑正向件', '-- 抓取：node capture-snapshot.mjs（默认 --remote，只跑 SELECT）', '', ...PRECHECK.map((p) => `-- ${p.label} · ${p.purpose}\n${p.sql}\n`)].join('\n')}` },
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
    approved: true,
    approvedOn: '2026-10-08',
    note: '用户 2026-10-08 令「CPU财政回溯」⇒ 04 件转为必跑（件名保留 -optional 以防既有引用失效）。两队在 S9 第 1 窗扣款时仍是 CPU 队（2026-10-06 04:43/04:44 才被真人接队，流水有「接队资金」+30），故只回冲 CPU 期那笔工资：amount → 0、余额与后续 balance_after 还原、memo 记原因',
    clubs: CPU_CLUBS.map((c) => ({ clubId: c.id, clubName: c.name, tier: c.tier, chargedAmount: -c.old, refundTo: 0, memoNote: CPU_MEMO_NOTE })),
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
console.log(`CPU 期工资冲正（用户令 2026-10-08，必跑）：${CPU_CLUBS.map((c) => `${c.id} ${num(-c.old)}`).join(' / ')} ⇒ amount → 0，余额还原`);
