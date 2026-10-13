// 生成 sql/manifest.json：逐件记录字节数、语句数、sha256 与期望 changes（house style，与 prod-* 各批一致）。
// 用法：node scripts/prod-20261013-t0-economy-patch/gen-manifest.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const batchTs = '2026-10-13T15:00:00Z'; // 本批定稿时点（执行时以 03-verify 回读为准）

/** 语句数：去掉 -- 注释与空行后按 ';' 结尾计数。 */
function countStatements(sql) {
  return sql
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

const files = [
  ['sql/01-precheck.sql', '前置只读体检', '只读', '6 条只读，用于执行前基线（config / 忠诚流水 / 窗口 / 球场档位 / 工资流水 / 审计）'],
  ['sql/02-config-patch.sql', '主件（写入）', '6 句（3 审计 + 3 键 upsert）', '三键：loyalty_tiers 排程固化 / wage_floor_gap=0 取消穷鬼线 / stadium_max_open_tier=2 开放 2 档'],
  ['sql/03-verify.sql', '执行后复查（只读）', '只读', 'config_rows 应 8 → 11、三键命中目标值、审计多 3 条、账本与窗口零改动'],
  ['rollback/01-remove-t0-keys.sql', '回滚', '6 句（3 审计 + 3 删行）', '三键删行回代码默认；stadium_max_open_tier 是唯一真实行为回滚点（关回 2 档）'],
];

const shards = {};
let totalBytes = 0;
let totalStmts = 0;
for (const [rel, note, expectChanges, detail] of files) {
  const buf = readFileSync(join(dir, rel));
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const stmts = countStatements(buf.toString('utf8'));
  totalBytes += buf.byteLength;
  totalStmts += stmts;
  shards[rel] = { bytes: buf.byteLength, stmts, sha256, note, expectChanges, detail };
}

const manifest = {
  batch: 'prod-20261013-t0-economy-patch',
  batchTs,
  db: 'whl-club',
  databaseId: '73154873-d5ae-42b0-a630-25f5ef60053d',
  order: [
    '1) 发版批 0 上线（push ⇒ CF 自动构建完成，Version 回读变化）——否则 ① 忠诚排程会在旧代码下反向发钱',
    '2) sql/01-precheck.sql（只读基线）',
    '3) sql/02-config-patch.sql（写入，期望 changes 6）',
    '4) sql/03-verify.sql（回读验收）',
  ],
  shards,
  totals: { files: files.length, bytes: totalBytes, stmts: totalStmts },
};

writeFileSync(join(dir, 'sql', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`manifest.json 已生成：${files.length} 件 / ${totalStmts} 语句 / ${totalBytes} 字节`);
for (const [rel, v] of Object.entries(shards)) console.log(`  ${rel}: ${v.stmts} 语句 / ${v.bytes}B / ${v.sha256.slice(0, 12)}…`);
