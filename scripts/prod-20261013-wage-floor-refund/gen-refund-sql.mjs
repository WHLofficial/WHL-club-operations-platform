// 生成 prod-20261013-wage-floor-refund 的 sql/02-refund.sql 与 rollback/01-restore-floor.sql。
// 口径 = 「原地改回 wage 行 + 顺移本队后续 flow + 账户对齐」（沿用 scripts/prod-20261006-s9-wage-floor-fix 的形状）。
// 数值来源：只读探针 scratch/econ-refund.mjs → scratch/econ-refund.out.txt（2026-10-13）
//   wage 行：club 5 id=229 −53 / club 280 id=241 −43 / club 449 id=242 −53（ref_type='window'、ref_id=901）
//   Σ现行合同：49.23（31 人）/ 37.62（30 人）/ 33.37（25 人）⇒ 退回 3.77 / 5.38 / 19.63（合计 28.78）
// 用法：node scripts/prod-20261013-wage-floor-refund/gen-refund-sql.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const REF = { refType: 'window', refId: 901 }; // S9 第 1 窗
const OLD_SUFFIX = (label, floor) => `；未达${label}下限 ${floor} m，按下限扣`;
const NEW_SUFFIX = '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣';

const TEAMS = [
  { club: 5, name: '切尔西', label: '顶级', floor: 53, people: 31, oldAmount: 53, sum: 49.23 },
  { club: 280, name: '奥林匹亚科斯', label: '次级', floor: 43, people: 30, oldAmount: 43, sum: 37.62 },
  { club: 449, name: '皇家贝蒂斯', label: '顶级', floor: 53, people: 25, oldAmount: 53, sum: 33.37 },
].map((t) => ({ ...t, delta: Math.round((t.oldAmount - t.sum) * 100) / 100, newSuffix: NEW_SUFFIX }));

const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const selector = (club, amount) =>
  `club_id = ${club} AND kind = 'wage' AND ref_type = '${REF.refType}' AND ref_id = ${REF.refId} AND ROUND(amount, 2) = ${r2(amount)}`;
const lastBalance = (club) => `(SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = ${club} ORDER BY e.id DESC LIMIT 1)`;

/** 原地改回工资行：amount / balance_after / memo 三处同时改，带三重守卫（旧金额 + 旧 memo 尾注 + 队号）。 */
function restoreRow(t, inverse = false) {
  const from = inverse ? -t.sum : -t.oldAmount;
  const to = inverse ? -t.oldAmount : -t.sum;
  const shift = inverse ? -t.delta : t.delta;
  const fromSuffix = inverse ? t.newSuffix : OLD_SUFFIX(t.label, t.floor);
  const toSuffix = inverse ? OLD_SUFFIX(t.label, t.floor) : t.newSuffix;
  return `-- ${inverse ? '回滚' : '退回'}（club ${t.club} ${t.name}）：−${r2(t.oldAmount)} → −${r2(t.sum)}，退回 ${r2(t.delta)} m
UPDATE ledger_entries
   SET amount = ${r2(to)},
       balance_after = ROUND(balance_after + ${r2(shift)}, 2),
       memo = REPLACE(memo, '${fromSuffix}', '${toSuffix}')
 WHERE ${selector(t.club, from)}
   AND instr(memo, '${fromSuffix}') > 0;`;
}

/** 顺移本队后续流水的 balance_after；幂等 = 「下一条是否已与原工资行相接」检测。 */
function shiftRows(t, inverse = false) {
  const shift = inverse ? -t.delta : t.delta;
  const updated = inverse ? -t.oldAmount : -t.sum;
  const before = inverse ? -t.sum : -t.oldAmount;
  return `-- 顺移（club ${t.club}）：工资行之后的全部本队流水 balance_after ${shift > 0 ? '+' : ''}${r2(shift)}
UPDATE ledger_entries
   SET balance_after = ROUND(balance_after + ${r2(shift)}, 2)
 WHERE club_id = ${t.club}
   AND id > (SELECT w.id FROM ledger_entries w WHERE w.${selector(t.club, updated)})
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.${selector(t.club, updated)})
   AND NOT EXISTS (
         SELECT 1 FROM ledger_entries n
          WHERE n.club_id = ${t.club}
            AND n.id = (SELECT MIN(m.id) FROM ledger_entries m
                         WHERE m.club_id = ${t.club}
                           AND m.id > (SELECT w2.id FROM ledger_entries w2 WHERE w2.${selector(t.club, updated)}))
            AND ROUND(n.balance_after, 2) = ROUND((SELECT w3.balance_after FROM ledger_entries w3 WHERE w3.${selector(t.club, updated)}) + n.amount, 2)
       );`;
}

/** 账户对齐：ledger_accounts.balance := 本队最新流水 balance_after（幂等 = 已相等则 changes 0）。 */
function alignAccount(t, inverse = false) {
  const updated = inverse ? -t.oldAmount : -t.sum;
  return `-- 账户对齐（club ${t.club}）：balance := 本队最新 balance_after
UPDATE ledger_accounts
   SET balance = ${lastBalance(t.club)},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = ${t.club}
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.${selector(t.club, updated)})
   AND ${lastBalance(t.club)} IS NOT NULL
   AND ROUND(balance, 2) <> ROUND(${lastBalance(t.club)}, 2);`;
}

const totalDelta = Math.round(TEAMS.reduce((s, t) => s + t.delta, 0) * 100) / 100;
const table = TEAMS.map(
  (t) => `--   club ${String(t.club).padEnd(4)} ${t.name.padEnd(7, '　')} ${t.label}  ${t.people} 人  Σ${r2(t.sum)}  原扣 −${r2(t.oldAmount)}  ⇒ −${r2(t.sum)}  退回 +${r2(t.delta)}`,
).join('\n');

const header = (title, extra) => `-- ${title}
-- 目标库：whl-club（生产，--remote）
-- 口径：用户令「直接把上次的扣款记录改改」⇒ 原地改回（amount / balance_after / memo），不新增补偿分录
--       （与 scripts/prod-20261013-t0-economy-patch/ 的 key ② 配合：取消穷鬼线 wage_floor_gap='0'）。
-- 依据：scratch/econ-refund.mjs（只读）→ scratch/econ-refund.out.txt；三队 wage 行 ref_type='window'、ref_id=${REF.refId}（S9 第 1 窗）
${table}
-- 合计退回：+${r2(totalDelta)} m（= 3 队 × 各自多扣额）
${extra}`;

const refundSql = `${header(
  '生产批 prod-20261013-wage-floor-refund · 02 主件：退回穷鬼线多扣（9 条语句）',
  `-- 语句结构：每队 3 条 —— ① 工资行原地改回 ② 顺移本队后续流水 balance_after ③ 账户对齐。
-- 期望 changes：3（①）+ 24（②：本队工资行之后的流水条数 6/6/12）+ 3（③）= 30（当日快照；若期间有新流水，② 会随之增加）。
-- 幂等：① 三重守卫（旧金额 + 旧 memo 尾注 + 队号）、② 「下一条已相接」检测、③ 余额相等检测 ⇒ 重放 changes 0。
-- 安全边界：不动其他 15 队；不动任何非本队流水；不动赛季/窗口/合同；无不可逆点（回滚件见 rollback/01-restore-floor.sql）。
`,
)}

${TEAMS.map((t) => `${restoreRow(t)}\n\n${shiftRows(t)}\n\n${alignAccount(t)}`).join('\n\n')}
`;

const rollbackSql = `${header(
  '生产批 prod-20261013-wage-floor-refund · 回滚件：恢复穷鬼线多扣（9 条语句）',
  `-- 语义：把三队 wage 行改回 −${TEAMS.map((t) => r2(t.oldAmount)).join(' / −')}（即「按下限扣」的原状）并顺移回退。
-- 幂等：与主件同形（守卫换成新金额 + 新 memo 尾注；②③ 均为相接/相等检测）⇒ 重放 changes 0。
-- 注意：本回滚只还原账本；若同时回滚了 config 键 ②（wage_floor_gap 删行），则下一次关窗批会重新按下限扣。
`,
)}
${TEAMS.slice()
  .reverse()
  .map((t) => `${restoreRow(t, true)}\n\n${shiftRows(t, true)}\n\n${alignAccount(t, true)}`)
  .join('\n\n')}
`;

writeFileSync(join(dir, 'sql', '02-refund.sql'), refundSql, 'utf8');
writeFileSync(join(dir, 'rollback', '01-restore-floor.sql'), rollbackSql, 'utf8');
console.log(`02-refund.sql / 01-restore-floor.sql 已生成：${TEAMS.length} 队 × 3 语句；合计退回 +${r2(totalDelta)} m`);
for (const t of TEAMS) console.log(`  club ${t.club} ${t.name}：−${r2(t.oldAmount)} → −${r2(t.sum)}（+${r2(t.delta)}）`);
