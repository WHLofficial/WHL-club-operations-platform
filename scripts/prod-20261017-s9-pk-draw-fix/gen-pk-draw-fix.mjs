// 生成「点球决胜按平局」订正批的 SQL 工件（生产库 whl-club）
//
// 用户令（2026-10-17 原文）：「点球决胜按平局重新发」
// 规则：小组赛/联赛平比分 + 点球分胜负 ⇒ 按**平局**发奖（双方各 2.5）；点球只作用于淘汰赛口径（晋级与晋级奖金）。
// 代码修正：src/worker/prizes.ts outcome()（发放）+ src/worker/season-settle.ts aggregateRecords()（小组赛剩余池 paid 口径）。
//
// 本批只订正 S9 冠军杯小组赛 4 场「平比分 + 点球分胜负」：
//   收回原按胜场错发的 7.00M（3 笔；#16 胜方是 CPU 队本就没发）→ 按平局给双方各补 2.50M（7 笔）
//   净变化 −3.50M。每笔两句（账户按差额增减 + 反向/正向流水），NOT EXISTS 守卫 ⇒ 重放 changes=0。
//
// 用法：node gen-pk-draw-fix.mjs [--check]
//   --check：只跑自检并把将要写入的行打印出来（不落盘）
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TS = process.env.PK_TS ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const BATCH_ID = 20261017;

// S9 冠军杯小组赛「平比分 + 点球分胜负」全量（全库仅这 4 场，联赛 0 场）
// pen = 点球胜方；ledgerId = 原错发 7.00M 的流水 id（#16 胜方是 CPU 队 ⇒ 未发，null）
const MATCHES = [
  { id: 10, home: [11, '曼联'], away: [280, '奥林匹亚科斯'], pen: 'away', ledgerId: 83 },
  { id: 16, home: [131681, 'AC米兰(CPU)'], away: [21, '拜仁慕尼黑'], pen: 'home', ledgerId: null },
  { id: 18, home: [241, '巴塞罗那'], away: [45, '尤文图斯'], pen: 'home', ledgerId: 256 },
  { id: 22, home: [2, '阿斯顿维拉'], away: [112172, 'RB莱比锡'], pen: 'away', ledgerId: 264 },
];
const WIN_PRIZE = 7.0; // champions_group.win
const DRAW_PRIZE = 2.5; // champions_group.draw
// CPU 队不入账（clubs.is_cpu=1 ⇒ 即时发奖与结算 paid 都排除该侧，v2.0.0 裁决 6）
const CPU_CLUBS = new Set([10, 131681]);

const sideOf = (m, key) => (key === 'home' ? { clubId: m.home[0], name: m.home[1], refType: 'match_home' } : { clubId: m.away[0], name: m.away[1], refType: 'match_away' });
const pairLabel = (m) => `${m.home[1]} vs ${m.away[1]}`;

/** 每笔 = { kind:'claw'|'topup', clubId, amount, refType, refId, memo, label } */
const rows = [];
for (const m of MATCHES) {
  const winner = sideOf(m, m.pen);
  const loser = sideOf(m, m.pen === 'home' ? 'away' : 'home');
  if (m.ledgerId !== null) {
    rows.push({
      kind: 'claw',
      clubId: winner.clubId,
      amount: -WIN_PRIZE,
      refType: 'pk_rollback_prize',
      refId: m.id,
      memo: `点球决胜改按平局·收回胜场奖金（比赛 #${m.id} ${pairLabel(m)}，${m.pen === 'home' ? '主' : '客'}队点球胜；原流水 id=${m.ledgerId}，-${WIN_PRIZE.toFixed(2)}M）`,
      label: `收回 club ${winner.clubId}（${winner.name}）比赛 #${m.id} 胜场奖金 ${WIN_PRIZE.toFixed(2)}M`,
    });
  }
  // CPU 队一侧不补发（平台队打 CPU 队只发平台侧）
  if (!CPU_CLUBS.has(winner.clubId)) {
    rows.push({
      kind: 'topup',
      clubId: winner.clubId,
      amount: DRAW_PRIZE,
      refType: `${winner.refType}_fix`,
      refId: m.id,
      memo: `冠军杯小组赛平局奖金（比赛 #${m.id} ${pairLabel(m)}，点球决胜改按平局补发）`,
      label: `补发 club ${winner.clubId}（${winner.name}）比赛 #${m.id}（${m.pen}）平局奖金 ${DRAW_PRIZE.toFixed(2)}M`,
    });
  }
  if (!CPU_CLUBS.has(loser.clubId)) {
    rows.push({
      kind: 'topup',
      clubId: loser.clubId,
      amount: DRAW_PRIZE,
      refType: loser.refType,
      refId: m.id,
      memo: `冠军杯小组赛平局奖金（比赛 #${m.id} ${pairLabel(m)}，点球决胜改按平局）`,
      label: `补发 club ${loser.clubId}（${loser.name}）比赛 #${m.id}（${m.pen === 'home' ? 'away' : 'home'}）平局奖金 ${DRAW_PRIZE.toFixed(2)}M`,
    });
  }
}

/** 每笔两句：账户（按差额，绝不 SET 绝对值）+ 流水 */
function statementsFor(r) {
  const kind = r.kind === 'claw' ? 'manual_adjust' : 'prize';
  const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${r.clubId} AND kind = '${kind}' AND ref_type = '${r.refType}' AND ref_id = ${r.refId})`;
  const amt = r.amount.toFixed(2);
  return [
    `INSERT INTO ledger_accounts (club_id, balance, updated_at)\nSELECT ${r.clubId}, ${amt}, '${TS}'\n WHERE ${guard}\n ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at\n WHERE ${guard};`,
    `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)\nSELECT ${r.clubId}, '${kind}', ${amt}, (SELECT balance FROM ledger_accounts WHERE club_id = ${r.clubId}), '${r.refType}', ${r.refId}, '${r.memo}', '${TS}'\n WHERE ${guard};`,
  ];
}

/** 回滚：每笔反向一条 manual_adjust（ref_type='batch_rollback_pk'、ref_id=批次号、memo 区分行） */
function rollbackStatements() {
  return rows.map((r) => {
    const memo = `回滚点球决胜订正（比赛 #${r.refId}，club ${r.clubId}，${r.amount > 0 ? '+' : ''}${r.amount.toFixed(2)}M）`;
    const guard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${r.clubId} AND kind = 'manual_adjust' AND ref_type = 'batch_rollback_pk' AND ref_id = ${BATCH_ID} AND memo = '${memo}')`;
    const amt = (-r.amount).toFixed(2);
    return [
      `INSERT INTO ledger_accounts (club_id, balance, updated_at)\nSELECT ${r.clubId}, ${amt}, '${TS}'\n WHERE ${guard}\n ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at\n WHERE ${guard};`,
      `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)\nSELECT ${r.clubId}, 'manual_adjust', ${amt}, (SELECT balance FROM ledger_accounts WHERE club_id = ${r.clubId}), 'batch_rollback_pk', ${BATCH_ID}, '${memo}', '${TS}'\n WHERE ${guard};`,
    ].join('\n');
  });
}

// ── 自检 ──────────────────────────────────────────────────────────────────────
const problems = [];
const net = rows.reduce((s, r) => s + r.amount, 0);
if (Math.round(net * 100) / 100 !== -3.5) problems.push(`净变化 ${net} ≠ -3.50`);
const byClub = new Map();
for (const r of rows) byClub.set(r.clubId, Math.round(((byClub.get(r.clubId) ?? 0) + r.amount) * 100) / 100);
const expectByClub = new Map([[280, -4.5], [11, 2.5], [241, -4.5], [45, 2.5], [112172, -4.5], [2, 2.5], [21, 2.5]]);
for (const [club, want] of expectByClub) if (byClub.get(club) !== want) problems.push(`club ${club} 净变化 ${byClub.get(club)} ≠ ${want}`);
for (const [club, got] of byClub) if (!expectByClub.has(club)) problems.push(`club ${club} 不在预期名单（净 ${got}）`);
const perMatch = new Map();
for (const r of rows) perMatch.set(r.refId, Math.round(((perMatch.get(r.refId) ?? 0) + r.amount) * 100) / 100);
if (perMatch.get(10) !== -2 || perMatch.get(18) !== -2 || perMatch.get(22) !== -2 || perMatch.get(16) !== 2.5) problems.push(`逐场净变化异常：${JSON.stringify([...perMatch])}`);
const clawN = rows.filter((r) => r.kind === 'claw').length;
const topupN = rows.filter((r) => r.kind === 'topup').length;
if (clawN !== 3 || topupN !== 7) problems.push(`笔数 收回 ${clawN} / 补发 ${topupN} ≠ 3 / 7`);
const keys = new Set(rows.map((r) => `${r.kind}|${r.clubId}|${r.refType}|${r.refId}`));
if (keys.size !== rows.length) problems.push('键有重复（同一 club+refType+refId 出现两次）');
const allStatements = [...rows.flatMap(statementsFor), ...rollbackStatements().flatMap((s) => s.split(';\n'))];
const RISKY = /["%&|<>]/;
for (const s of allStatements) {
  if (RISKY.test(s)) problems.push(`语句含 shell 元字符：${s.slice(0, 80)}`);
  if (Buffer.byteLength(s, 'utf8') > 4000) problems.push(`语句超 4000 字节：${s.slice(0, 60)}`);
}
// 补发（canonical 键）必须落在「空键」上；胜者侧被原 7.00M 占用 ⇒ 必须走 _fix 键
for (const r of rows) {
  if (r.kind !== 'topup') continue;
  const isFix = r.refType.endsWith('_fix');
  const winnerFix = MATCHES.some((m) => m.ledgerId !== null && sideOf(m, m.pen).clubId === r.clubId && m.id === r.refId);
  if (winnerFix !== isFix) problems.push(`club ${r.clubId} 比赛 #${r.refId} 的键选择不对（应 ${winnerFix ? '_fix' : 'canonical'}，实际 ${r.refType}）`);
}

const header = (title, extra) => `-- ${title}\n--\n-- 生成时间：${TS}\n-- 执行：node exec-shards.mjs sql/<本文件> --remote --chunk=20\n${extra}\n`;

const sqlClaw = header(`收回：点球决胜错发的胜场奖金（补偿分录 kind=manual_adjust，保留原流水）`, `-- 共 ${clawN} 笔 / ${Math.abs(rows.filter((r) => r.kind === 'claw').reduce((s, r) => s + r.amount, 0)).toFixed(2)}M\n-- memo 指回原流水 id；重放 changes=0`)
  + '\n' + rows.filter((r) => r.kind === 'claw').map((r) => `-- ${r.label}\n${statementsFor(r).join('\n')}`).join('\n');
const sqlTopup = header(`补发：按平局给双方各 2.50M（canonical 键优先，胜者侧已被原 7.00M 占用故走 _fix 键）`, `-- 共 ${topupN} 笔 / ${rows.filter((r) => r.kind === 'topup').reduce((s, r) => s + r.amount, 0).toFixed(2)}M\n-- 日后代码修订后重放该场不会双发（键与平台发奖同构）`)
  + '\n' + rows.filter((r) => r.kind === 'topup').map((r) => `-- ${r.label}\n${statementsFor(r).join('\n')}`).join('\n');

const clubs = [...expectByClub.keys()];
const sqlPrecheck = `-- 执行前预检（只读）。执行：npx wrangler d1 execute whl-club --remote --file=sql/01-precheck.sql
-- 期望：A 4 行（全为冠军杯小组赛 stage_kind=group）/ B 3 笔 prize 7.00M（#10→280、#18→241、#22→112172；#16 无）/
--       C 7 队余额 / D 守恒 0 / E 本批键全 0 且「对手侧 canonical 键」全空。

-- A 4 场点球决胜（tour 侧 winner 记点球胜方）
SELECT match_id, competition_type, stage_kind, home_team, away_team, score_home, score_away, pen_home, pen_away, winner_team
  FROM result_confirmations WHERE match_id IN (10,16,18,22) ORDER BY match_id;

-- B 这些场次上的全部流水（应只有 3 笔 prize 7.00M；wx_fix 属天气订正批，与本批无关）
SELECT id, club_id, kind, amount, ref_type, ref_id, memo FROM ledger_entries
 WHERE ref_id IN (10,16,18,22) AND kind IN ('prize','manual_adjust') ORDER BY id;

-- C 受影响 7 队余额（执行前基线）
SELECT club_id, ROUND(balance, 2) AS bal FROM ledger_accounts
 WHERE club_id IN (${clubs.join(',')}) ORDER BY club_id;

-- D 守恒基线（Σ余额 − Σ流水，应恒为 0）
SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2) AS conserve;

-- E 键占用（本批键应全 0；对手侧 canonical 键应为空，胜者侧被原 7.00M 占用）
SELECT
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize') AS pk_rollback_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND (ref_type LIKE 'match_home_fix' OR ref_type LIKE 'match_away_fix') AND ref_id IN (10,16,18,22)) AS pk_fix_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type IN ('match_home','match_away') AND ref_id IN (10,16,18,22)) AS canonical_prize_n;
`;

const sqlVerify = `-- 执行后复查（只读，单行多标量）
--
-- 生成时间：${TS}
-- 逐队余额应等于基线 + 净变化（见 README 表）：280 −4.50 / 11 +2.50 / 241 −4.50 / 45 +2.50 / 112172 −4.50 / 2 +2.50 / 21 +2.50
-- pk_rollback_n 应为 3；pk_fix_n 应为 3；canonical_prize_n 应为 7（原 3 笔 7.00M + 本批 4 笔对手侧 2.50M）；守恒位应恒为 0。

SELECT
${clubs.map((c) => `  (SELECT ROUND(balance, 2) FROM ledger_accounts WHERE club_id = ${c}) AS bal_${c},`).join('\n')}
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'manual_adjust' AND ref_type = 'pk_rollback_prize') AS pk_rollback_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type LIKE 'match_home_fix' AND ref_id IN (10,16,18,22)) AS fix_home_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type LIKE 'match_away_fix' AND ref_id IN (10,16,18,22)) AS fix_away_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_type IN ('match_home','match_away') AND ref_id IN (10,16,18,22)) AS canonical_prize_n,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize' AND ref_id IN (10,16,18,22) AND amount = 2.5) AS draw_2_5_n,
  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve;
`;

const sqlRollback = header(`回滚：撤销本批全部写入（补偿分录，保留本批流水）`, `-- 共 ${rows.length} 笔；ref_type='batch_rollback_pk'、ref_id=${BATCH_ID}，每笔一句 NOT EXISTS 守卫，重放 changes=0`)
  + '\n' + rollbackStatements().join('\n');

const files = {
  'sql/01-precheck.sql': sqlPrecheck,
  'sql/02-clawback.sql': sqlClaw,
  'sql/03-topup.sql': sqlTopup,
  'sql/04-verify.sql': sqlVerify,
  'rollback/01-undo.sql': sqlRollback,
};

console.log(`批次：${BATCH_ID} 点球决胜按平局订正`);
console.log(`行：收回 ${clawN} 笔（−${Math.abs(rows.filter((r) => r.kind === 'claw').reduce((s, r) => s + r.amount, 0)).toFixed(2)}M）+ 补发 ${topupN} 笔（+${rows.filter((r) => r.kind === 'topup').reduce((s, r) => s + r.amount, 0).toFixed(2)}M）⇒ 净 ${net.toFixed(2)}M`);
for (const r of rows) console.log(`  ${r.kind === 'claw' ? '收回' : '补发'} club ${String(r.clubId).padStart(6)} ${r.amount > 0 ? '+' : ''}${r.amount.toFixed(2)}  ${r.refType} #${r.refId}  ${r.label}`);
console.log(`逐队净变化：${[...byClub].sort((a, b) => a[0] - b[0]).map(([c, v]) => `${c}:${v > 0 ? '+' : ''}${v}`).join(' ')}`);
if (problems.length > 0) {
  console.error(`\n自检未通过（${problems.length} 条）：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('自检通过：净变化 / 逐队 / 逐场 / 笔数 / 键唯一性 / 键选择 / shell 元字符 / 语句字节数 全部符合预期');

if (process.argv.includes('--check')) process.exit(0);
for (const [rel, content] of Object.entries(files)) {
  const abs = join(HERE, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  const sha = createHash('sha256').update(content, 'utf8').digest('hex');
  console.log(`  写入 ${rel}（${Buffer.byteLength(content, 'utf8')} 字节，sha256 ${sha.slice(0, 16)}…）`);
}
// 幂等复跑：内容一致才算稳定
for (const [rel, content] of Object.entries(files)) {
  const abs = join(HERE, rel);
  if (!existsSync(abs) || readFileSync(abs, 'utf8') !== content) {
    console.error(`复读不一致：${rel}`);
    process.exit(1);
  }
}
console.log('落盘复读一致 ✓');
