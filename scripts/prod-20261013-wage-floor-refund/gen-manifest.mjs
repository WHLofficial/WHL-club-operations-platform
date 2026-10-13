// 生成 sql/manifest.json：逐件记录字节数、语句数、sha256 与期望 changes（house style，与 prod-* 各批一致）。
// 用法：node scripts/prod-20261013-wage-floor-refund/gen-manifest.mjs
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
  ['sql/01-precheck.sql', '前置只读体检', '只读', '7 条只读：三队 wage 行现值 / Σ现行合同 / 顺移规模（期望 6·6·12）/ 账户对账 / 全账本账链 / 其余 15 队基线 / 三队冻结'],
  ['sql/02-refund.sql', '主件（写入）', '期望 changes 30（3 + 24 + 3）', '三队各 3 语句：① wage 行改回 Σ现行合同 + memo 尾注改写 ② 顺移本队后续流水 balance_after ③ 账户对齐；全部带幂等守卫'],
  ['sql/03-verify.sql', '执行后复查（只读）', '只读', '三队 wage 新值（−49.23/−37.62/−33.37）/ 账户（27.87/54.44/55.34）/ 全账本账链 0 断点 / 其余 15 队零波及 / 三队现金合计 137.65'],
  ['rollback/01-restore-floor.sql', '回滚', '期望 changes 30', '逐语句反做：wage 行改回 −53/−43/−53 与旧 memo、后续流水反向顺移、账户余额反向对齐（回到 24.10/49.06/35.71）'],
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
  batch: 'prod-20261013-wage-floor-refund',
  batchTs,
  db: 'whl-club',
  databaseId: '73154873-d5ae-42b0-a630-25f5ef60053d',
  order: [
    '1) sql/01-precheck.sql（只读基线：三队 wage 行应为 −53/−43/−53 且账链 0 断点）',
    '2) sql/02-refund.sql（写入，期望 changes 30 = 3 改行 + 24 顺移 + 3 账户）',
    '3) sql/03-verify.sql（回读验收：账户 27.87/54.44/55.34、账链 0 断点、其余 15 队零波及）',
    '本批与 prod-20261013-t0-economy-patch 相互独立，可先跑；两批都跑完后 Σ工资口 = −1022.68/窗',
  ],
  shards,
  totals: { files: files.length, bytes: totalBytes, stmts: totalStmts },
};

writeFileSync(join(dir, 'sql', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`manifest.json 已生成：${files.length} 件 / ${totalStmts} 语句 / ${totalBytes} 字节`);
for (const [rel, v] of Object.entries(shards)) console.log(`  ${rel}: ${v.stmts} 语句 / ${v.bytes}B / ${v.sha256.slice(0, 12)}…`);
