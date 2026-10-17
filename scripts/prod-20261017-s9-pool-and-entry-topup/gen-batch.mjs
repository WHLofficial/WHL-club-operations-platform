// 生成「S9 冠军杯小组赛池下调 + 次级入场奖金差额补发」生产批的 SQL 工件（生产库 whl-club）
//
// 用户令（2026-10-17 原文）：
//   ①「降低奖金池到192.5」+「即本赛季不再留冠军杯小组赛奖池里的剩余部分进行分配」
//   ②「将次级入场奖金补发到顶级水平」
//
// ① 冠军杯小组赛池：config 键 prize_table.champions_group.pool 200 → 192.5。
//    结算口径（src/worker/season-settle.ts:148）remaining = round(pool − paid, 2)；S9 小组赛实测
//    paid = 192.5（25 胜 × 7.0 + 7 平 × 2.5，CPU 侧不计）⇒ remaining = 0 ⇒「remaining > 0」不成立
//    ⇒ 本赛季不再按胜场占比分配剩余池。零现金即时效果、无代码依赖（prize_table 由既有代码读取，
//    不像 T0 批那样要求「先发版再落库」）。生产现值 = 无行（代码默认 pool 200，src/core/config.ts:141）。
// ② 次级入场奖金差额补发：联赛 2 级 7 家（非 CPU）各 12.50 = 顶级 20 − 次级基础 7.5，合计 87.50M。
//    结算（season-settle.ts:122-124）仍按 prize_table.league_second.entry = 7.5 发基础额
//    ⇒ 次级球队本赛季入场奖金合计 20 = 顶级水平。本批只补差额、**不改 league_second.entry**
//    （S10 的联盟版权池 300 将取代入场奖金，设计 §L1）。
//
// 通道约束：本批走 exec-shards.mjs（`--command "…"` 单行通道），语句里不能出现 " % & | < > ——
//   故 ① 的 JSON 用 SQL 侧 json_object() 构造（不写字面双引号），时间戳由生成器内联为字面量
//   （不用 strftime 的 % 格式串）。exec-shards 会在执行前再挡一次。
//
// 用法：node gen-batch.mjs [--check]
//   --check：只跑自检并打印将写入的文件清单（不落盘）

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TS = process.env.BATCH_TS ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const CHECK_ONLY = process.argv.includes('--check');

const SEASON = 9;
const BATCH_ID = 20261017;
const REF_TYPE = 'entry_topup';
const ROLLBACK_REF_TYPE = 'batch_rollback_entry_topup';
const MEMO = '联赛入场奖金差额补发（S9，次级补至顶级水平）';

// 数值（用户令 + prize_table 现状）
const PREMIER_ENTRY = 20; // prize_table.league_premier.entry
const SECOND_ENTRY = 7.5; // prize_table.league_second.entry（结算仍按此发基础额）
const PER_CLUB = PREMIER_ENTRY - SECOND_ENTRY; // 12.5 差额
const TARGET_POOL = 192.5; // 用户令：池降到 S9 小组赛实付额 ⇒ remaining = 0
const PRIZE_TABLE_DEFAULT_POOL = 200; // src/core/config.ts 现值（生产无 config 行）

// S9 次级联赛（tournament_id=2）全部 8 队（生产实测：result_confirmations 去重）
// 其中 10 曼城 是 CPU 队 ⇒ 不入账（clubs.is_cpu=1；v2.0.0 裁决 6：CPU 队奖金与主场收入都不发）
const SECOND_TIER = [
  [1, '阿森纳'],
  [2, '阿斯顿维拉'],
  [10, '曼城(CPU)'],
  [14, '诺丁汉森林'],
  [21, '拜仁慕尼黑'],
  [243, '皇家马德里'],
  [280, '奥林匹亚科斯'],
  [112172, 'RB莱比锡'],
];
const CPU_CLUBS = new Set([10, 131681]); // 曼城(CPU) / AC米兰(CPU)
const clubs = SECOND_TIER.filter(([id]) => !CPU_CLUBS.has(id)).map(([id, name]) => ({ id, name }));

const total = clubs.length * PER_CLUB;
const pad2 = (n) => String(n).padStart(2, '0');
const money = (n) => n.toFixed(2);

// ---------- ① prize_table（JSON 在 SQL 侧用 json_object 构造） ----------
const jObject = (pairs) => `json_object(${pairs.map(([k, v]) => `'${k}', ${v}`).join(', ')})`;
const championsGroup = (pool) => jObject([['entry', 15], ['pool', pool], ['win', 7.0], ['draw', 2.5]]);
const prizeTableExpr = (pool) =>
  jObject([
    ['league_premier', jObject([['entry', PREMIER_ENTRY], ['win', 8.5], ['draw', 6.6], ['loss', 4.7]])],
    ['league_second', jObject([['entry', SECOND_ENTRY], ['win', 6.7], ['draw', 4.8], ['loss', 2.9]])],
    ['qualifying', jObject([['fallback', 7.5]])],
    ['champions_group', championsGroup(pool)],
    ['champions_ko', jObject([['quarterfinal', 7.5], ['semifinal', 10], ['final', 12.5], ['champion', 5]])],
    ['super_cup', jObject([['win', 4.0], ['loss', 2.0]])],
  ]);

const configPatch = `-- 生产批 prod-20261017-s9-pool-and-entry-topup · 02 主件：冠军杯小组赛池 200 → ${TARGET_POOL}（2 条语句，期望 changes 2）
--
-- 用户令（2026-10-17）：「降低奖金池到192.5」+「即本赛季不再留冠军杯小组赛奖池里的剩余部分进行分配」。
-- 语义：season-settle.ts:148 remaining = round(pool − paid, 2)；S9 小组赛 paid = 192.5（25 胜 × 7.0 + 7 平 × 2.5，
--       CPU 侧不计）⇒ remaining = 0 ⇒ 本赛季小组赛不再按胜场占比分配剩余池（池成为精确上限）。
-- 现值：生产 config 无 prize_table 行 ⇒ 生效值 = 代码默认（src/core/config.ts:141，pool 200）。
-- 生效时点：S9 冠军杯小组赛结算（season_tournaments.stage_settled_at 目前全 null，尚未结算）。
-- 无代码依赖：prize_table 由既有代码读取，本批不要求先发版（与 T0 批的「先发版再落库」不同）。
-- 幂等：两条语句共用「现值 ≠ 目标值」守卫（写成 NOT(... = ...)，避免 <> 撞 --command 的 shell 重定向符），重放 changes 均为 0。
-- 通道：JSON 用 json_object() 构造（避免字面双引号撞 --command 的 shell 解释），时间戳内联为字面量。
-- 回滚：rollback/02-undo-config-pool.sql（删行 ⇒ 回代码默认 200）。

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'prize_table', 'value', (SELECT value FROM config WHERE key = 'prize_table')),
       json_object('key', 'prize_table', 'value', ${prizeTableExpr(TARGET_POOL)}),
       '${TS}'
 WHERE NOT (COALESCE((SELECT value FROM config WHERE key = 'prize_table'), '') = ${prizeTableExpr(TARGET_POOL)});

INSERT INTO config (key, value, updated_at)
SELECT 'prize_table', ${prizeTableExpr(TARGET_POOL)}, '${TS}'
 WHERE NOT (COALESCE((SELECT value FROM config WHERE key = 'prize_table'), '') = ${prizeTableExpr(TARGET_POOL)})
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
`;

const configRollback = `-- 回滚 ②：撤销 prize_table 行（删行 ⇒ 生效值回代码默认 pool ${PRIZE_TABLE_DEFAULT_POOL}）——2 条语句
--
-- 生成时间：${TS}
-- 执行：node exec-shards.mjs rollback/02-undo-config-pool.sql --remote --chunk=20
-- 先写审计（before = 当前行值，after = null）再删行；重放时行已不存在 ⇒ 审计与删行 changes 均为 0。

INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL, 'config_set', 'config', NULL, 'machine',
       json_object('key', 'prize_table', 'value', (SELECT value FROM config WHERE key = 'prize_table')),
       json_object('key', 'prize_table', 'value', NULL),
       '${TS}'
 WHERE EXISTS (SELECT 1 FROM config WHERE key = 'prize_table');

DELETE FROM config WHERE key = 'prize_table';
`;

// ---------- ② 次级入场奖金差额补发 ----------
const guard = (clubId) =>
  `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${clubId} AND kind = 'prize' AND ref_type = '${REF_TYPE}' AND ref_id = ${SEASON})`;

const topupLines = [];
for (const c of clubs) {
  topupLines.push(`-- 补发 club ${c.id}（${c.name}）联赛入场奖金差额 ${money(PER_CLUB)}M（次级 ${SECOND_ENTRY} → 顶级 ${PREMIER_ENTRY}）`);
  topupLines.push(`INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT ${c.id}, ${money(PER_CLUB)}, '${TS}'
 WHERE ${guard(c.id)}
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE ${guard(c.id)};`);
  topupLines.push(`INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT ${c.id}, 'prize', ${money(PER_CLUB)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${c.id}), '${REF_TYPE}', ${SEASON}, '${MEMO}', '${TS}'
 WHERE ${guard(c.id)};`);
}

const topup = `-- 补发：联赛 2 级 7 家俱乐部各 ${money(PER_CLUB)}M（入场奖金 次级 ${SECOND_ENTRY} → 顶级 ${PREMIER_ENTRY} 的差额）
--
-- 生成时间：${TS}
-- 执行：node exec-shards.mjs sql/03-entry-topup.sql --remote --chunk=20
-- 共 ${clubs.length} 笔 / ${money(total)}M（CPU 队 10 曼城 不在内：不入账）
-- 与结算的关系：season-settle.ts:122-124 仍按 prize_table.league_second.entry = ${SECOND_ENTRY} 发基础额
--   ⇒ 次级球队本赛季入场奖金合计 ${PREMIER_ENTRY} = 顶级水平；本批**不改** league_second.entry（S10 版权池 300 将取代入场奖金）
-- 键 = (club_id, kind='prize', ref_type='${REF_TYPE}', ref_id=${SEASON})：重放 changes 0；与平台发奖键（match_*/stage）不重叠

${topupLines.join('\n')}
`;

const topupRollbackLines = [];
for (const c of clubs) {
  const memo = `回滚次级入场奖金差额补发（S9，club ${c.id}，-${money(PER_CLUB)}M）`;
  const rguard = `NOT EXISTS (SELECT 1 FROM ledger_entries WHERE club_id = ${c.id} AND kind = 'manual_adjust' AND ref_type = '${ROLLBACK_REF_TYPE}' AND ref_id = ${BATCH_ID} AND memo = '${memo}')`;
  topupRollbackLines.push(`INSERT INTO ledger_accounts (club_id, balance, updated_at)
SELECT ${c.id}, -${money(PER_CLUB)}, '${TS}'
 WHERE ${rguard}
 ON CONFLICT(club_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at
 WHERE ${rguard};`);
  topupRollbackLines.push(`INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT ${c.id}, 'manual_adjust', -${money(PER_CLUB)}, (SELECT balance FROM ledger_accounts WHERE club_id = ${c.id}), '${ROLLBACK_REF_TYPE}', ${BATCH_ID}, '${memo}', '${TS}'
 WHERE ${rguard};`);
}

const topupRollback = `-- 回滚 ①：撤销 ${clubs.length} 笔次级入场奖金差额补发（补偿分录，保留本批流水）
--
-- 生成时间：${TS}
-- 执行：node exec-shards.mjs rollback/01-undo-entry-topup.sql --remote --chunk=20
-- 共 ${clubs.length} 笔；ref_type='${ROLLBACK_REF_TYPE}'、ref_id=${BATCH_ID}，每笔一句 NOT EXISTS 守卫，重放 changes=0

${topupRollbackLines.join('\n')}
`;

// ---------- 自检 ----------
const files = [
  ['sql/02-config-pool-patch.sql', configPatch],
  ['sql/03-entry-topup.sql', topup],
  ['rollback/01-undo-entry-topup.sql', topupRollback],
  ['rollback/02-undo-config-pool.sql', configRollback],
];

const errors = [];
const say = (s) => console.log(s);

function selfCheck() {
  // 名单
  if (clubs.length !== 7) errors.push(`非 CPU 次级球队应为 7 家，实为 ${clubs.length}`);
  if (new Set(clubs.map((c) => c.id)).size !== clubs.length) errors.push('club id 有重复');
  for (const c of clubs) {
    if (CPU_CLUBS.has(c.id)) errors.push(`CPU 队 ${c.id} 不应在补发名单`);
    if (!SECOND_TIER.some(([id]) => id === c.id)) errors.push(`club ${c.id} 不在 S9 次级名单`);
  }
  for (const [id] of SECOND_TIER) {
    if (!CPU_CLUBS.has(id) && !clubs.some((c) => c.id === id)) errors.push(`次级非 CPU 队 ${id} 漏在补发名单`);
  }
  // 金额
  if (money(PER_CLUB) !== '12.50') errors.push(`差额应为 12.50，实为 ${money(PER_CLUB)}`);
  if (money(total) !== '87.50') errors.push(`合计应为 87.50，实为 ${money(total)}`);

  // ② 语句结构：每家两句、守卫逐字相同（账户语句按既有惯例守卫出现 2 次：SELECT 的 WHERE + ON CONFLICT 的 WHERE）
  for (const c of clubs) {
    const g = guard(c.id);
    const hits = topup.split(g).length - 1;
    if (hits !== 3) errors.push(`club ${c.id} 守卫出现 ${hits} 次（应为 3：账户 SELECT / 账户 ON CONFLICT / 流水）`);
    if (!topup.includes(`SELECT ${c.id}, ${money(PER_CLUB)},`)) errors.push(`club ${c.id} 账户语句缺失`);
    if (!topup.includes(`SELECT ${c.id}, 'prize', ${money(PER_CLUB)},`)) errors.push(`club ${c.id} 流水语句缺失`);
  }
  const stmtCount = (text) => (text.match(/;\s*$/gm) ?? []).length;
  if (stmtCount(topup) !== clubs.length * 2) errors.push(`03 语句数应为 ${clubs.length * 2}，实为 ${stmtCount(topup)}`);
  if (stmtCount(topupRollback) !== clubs.length * 2) errors.push(`回滚 01 语句数应为 ${clubs.length * 2}，实为 ${stmtCount(topupRollback)}`);
  if (stmtCount(configPatch) !== 2) errors.push(`02 语句数应为 2，实为 ${stmtCount(configPatch)}`);
  if (stmtCount(configRollback) !== 2) errors.push(`回滚 02 语句数应为 2，实为 ${stmtCount(configRollback)}`);

  // ① 池数值：其余字段必须与 src/core/config.ts 的代码默认逐字一致（防手误改到别的奖金）
  const cfgSrc = readFileSync(join(HERE, '..', '..', 'src', 'core', 'config.ts'), 'utf8');
  const block = cfgSrc.slice(cfgSrc.indexOf('prize_table: JSON.stringify({'));
  const blockEnd = block.indexOf('}),');
  const prizeBlock = block.slice(0, blockEnd);
  const pairs = [
    ['league_premier', 'entry', 20],
    ['league_premier', 'win', 8.5],
    ['league_premier', 'draw', 6.6],
    ['league_premier', 'loss', 4.7],
    ['league_second', 'entry', 7.5],
    ['league_second', 'win', 6.7],
    ['league_second', 'draw', 4.8],
    ['league_second', 'loss', 2.9],
    ['qualifying', 'fallback', 7.5],
    ['champions_group', 'entry', 15],
    ['champions_group', 'pool', PRIZE_TABLE_DEFAULT_POOL],
    ['champions_group', 'win', 7.0],
    ['champions_group', 'draw', 2.5],
    ['champions_ko', 'quarterfinal', 7.5],
    ['champions_ko', 'semifinal', 10],
    ['champions_ko', 'final', 12.5],
    ['champions_ko', 'champion', 5],
    ['super_cup', 'win', 4.0],
    ['super_cup', 'loss', 2.0],
  ];
  for (const [, key, value] of pairs) {
    if (!new RegExp(`${key}:\\s*${String(value).replace('.', '\\.')}(\\D|$)`).test(prizeBlock)) {
      errors.push(`代码默认 prize_table 里找不到 ${key}: ${value}（写死值可能已漂移，需人工核对）`);
    }
  }
  if (!configPatch.includes(`'pool', ${TARGET_POOL}`)) errors.push(`02 未写入目标池 ${TARGET_POOL}`);
  if (configPatch.includes(`'pool', ${PRIZE_TABLE_DEFAULT_POOL}`)) errors.push('02 里出现了旧池值 200');
  if (!configRollback.includes('DELETE FROM config WHERE key = ')) errors.push('回滚 02 未删行');

  // 通道：语句里不得有 shell 元字符（exec-shards 会再挡一次）
  for (const [name, text] of files) {
    for (const stmt of text.split(/;\s*\n/)) {
      const body = stmt.split('\n').filter((l) => !l.trim().startsWith('--')).join(' ');
      if (/["%&|<>]/.test(body)) errors.push(`${name} 有语句含 shell 元字符："${body.slice(0, 120)}…"`);
    }
  }
  // 单条语句字节数（--command 上限 4000）
  for (const [name, text] of files) {
    const stmts = text
      .split(/\n/)
      .filter((l) => !l.trim().startsWith('--') && l.trim() !== '')
      .join('\n')
      .split(/;/)
      .map((s) => s.trim())
      .filter((s) => s !== '');
    const worst = Math.max(...stmts.map((s) => Buffer.byteLength(s, 'utf8')));
    if (worst > 4000) errors.push(`${name} 单条最长 ${worst} 字节 > 4000`);
    say(`  ${name}：${stmts.length} 条，单条最长 ${worst} 字节`);
  }
}

say(`批：prod-20261017-s9-pool-and-entry-topup  时间戳 ${TS}`);
say(`① 池 ${PRIZE_TABLE_DEFAULT_POOL} → ${TARGET_POOL}（remaining = 0 ⇒ 不再分配剩余池）`);
say(`② 补发 ${clubs.length} 家 × ${money(PER_CLUB)} = ${money(total)}M：${clubs.map((c) => `${c.id} ${c.name}`).join(' / ')}`);
selfCheck();
if (errors.length > 0) {
  console.error('\n自检失败：');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
say('自检：全绿');
if (CHECK_ONLY) {
  say('（--check：不落盘）');
  process.exit(0);
}
for (const [rel, text] of files) {
  const path = join(HERE, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  say(`写入 ${rel}（${Buffer.byteLength(text, 'utf8')} 字节，sha256 ${createHash('sha256').update(text).digest('hex')}）`);
}
