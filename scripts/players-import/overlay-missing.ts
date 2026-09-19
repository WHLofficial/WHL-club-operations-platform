// 30 行缺字段球员的增量补录（增量13 任务 B 尾巴）：Base 源行 naID/FootID 为 #N/A、Not Found，
// 校验拦下；人工/外部补齐这两列后，用本脚本按同一份端上归一化代码产增量 upsert SQL（幂等）。
// 用法：node scripts/players-import/overlay-missing.ts [xlsx路径] [补值CSV]
//   默认 xlsx = E:/Downloads/FC26db20251217_fixed.xlsx
//   默认 CSV  = scripts/players-import/missing-fields-30.csv（表头 ID,naID,FootID；naID/FootID 留空的行跳过）
// 只补 naID 与 FootID：源行其余字段齐全（PosID1 可空，归一化本就允许）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { normalizeImportBatch } from '../../src/core/import.ts';
import type { NormalizedPlayer } from '../../src/core/import.ts';
import { upsertStatement } from '../../src/worker/players-import.ts';

const SRC = process.argv[2] ?? 'E:/Downloads/FC26db20251217_fixed.xlsx';
const OVERLAY = process.argv[3] ?? new URL('./missing-fields-30.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT_DIR = new URL('./sql/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const wb = XLSX.read(readFileSync(SRC), { type: 'buffer' });
const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Base'], { defval: null });
const growth = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Growth+'], { defval: null });
const futureStarIds = new Set<number>(
  growth.map((g) => Number(g['ID'])).filter((n) => Number.isInteger(n) && n > 0),
);

const seenId = new Set<number>();
const rows: Record<string, unknown>[] = [];
for (const r of rawRows) {
  const id = Number(r['ID']);
  if (seenId.has(id)) continue;
  seenId.add(id);
  rows.push(r);
}
const byId = new Map<number, Record<string, unknown>>(rows.map((r) => [Number(r['ID']), r]));

// 补值表：按表头名取列，大小写不敏感
const csvLines = readFileSync(OVERLAY, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
const head = csvLines[0].split(',').map((h) => h.trim().toLowerCase());
const col = (name: string) => head.indexOf(name);
const [cId, cNa, cFoot] = [col('id'), col('naid'), col('footid')];
if (cId < 0 || cNa < 0 || cFoot < 0) throw new Error(`补值表表头需含 ID,naID,FootID：${OVERLAY}`);

const skipped: { id: unknown; name: unknown; why: string }[] = [];
const bad: { id: unknown; name: unknown; why: string }[] = [];
const patched: Record<string, unknown>[] = [];
for (const line of csvLines.slice(1)) {
  const c = line.split(',');
  const id = Number(c[cId]);
  const src = byId.get(id);
  if (!src) { skipped.push({ id: c[cId], name: c[2], why: 'Base 表里找不到该 ID' }); continue; }
  const naText = (c[cNa] ?? '').trim();
  const footText = (c[cFoot] ?? '').trim();
  if (naText === '' || footText === '') { skipped.push({ id, name: src['Name'], why: 'naID 或 FootID 仍为空' }); continue; }
  const naId = Number(naText);
  const footId = Number(footText);
  if (!Number.isInteger(naId) || naId < 1 || naId > 218) { bad.push({ id, name: src['Name'], why: `naID 越界：${naText}` }); continue; }
  if (footId !== 1 && footId !== 2) { bad.push({ id, name: src['Name'], why: `FootID 只能是 1 或 2：${footText}` }); continue; }
  patched.push({ ...src, naID: naId, FootID: footId });
}

const out = patched.length ? normalizeImportBatch('A', patched, futureStarIds) : { players: [] as NormalizedPlayer[], errors: [] };
const players = out.players;
const errors = out.errors.map((e) => ({ id: patched[e.row - 1]?.['ID'], name: patched[e.row - 1]?.['Name'], field: e.field, message: e.message }));

const str = (v: unknown): string => `'${String(v ?? '').replace(/'/g, "''")}'`;
// 与 generate-sql.ts 同法：喂假 DB 捕获 upsertStatement 的 SQL 文本与绑定值，渲染成字面量
function upsertSql(p: NormalizedPlayer): string {
  const capture = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          let i = 0;
          return sql.replace(/\?/g, () => {
            const v = params[i++];
            return typeof v === 'number' ? String(v) : v === null || v === undefined ? 'NULL' : str(v);
          });
        },
      };
    },
  } as unknown as Parameters<typeof upsertStatement>[0];
  const sql = upsertStatement(capture, p) as unknown as string;
  if (sql.includes('?')) throw new Error(`占位符未全部替换（fc_id=${p.fcId}）`);
  return `${sql};`;
}

const report: string[] = [
  '# 缺字段球员增量补录报告',
  '',
  `源：\`${SRC}\`｜表 \`Base\`（去重后 ${rows.length} 行）`,
  `补值表：\`${OVERLAY}\``,
  `本次补录：**${players.length}** 行｜待填未补：${skipped.length}｜补值不合法：${bad.length}｜归一化报错：${errors.length}`,
  '',
];
if (players.length) {
  mkdirSync(OUT_DIR, { recursive: true });
  const text =
    `-- 缺字段球员增量补录（生成：scripts/players-import/overlay-missing.ts；勿手改）\n` +
    `-- 源：${SRC} → Base 表；补值表：${OVERLAY}；本片 ${players.length} 行\n` +
    `-- 执行：npx wrangler d1 execute whl-club --remote --file scripts/players-import/sql/players-import-overlay.sql\n` +
    `-- ON CONFLICT(fc_id) DO UPDATE，重跑幂等\n` +
    players.map(upsertSql).join('\n') + '\n';
  writeFileSync(join(OUT_DIR, 'players-import-overlay.sql'), text, 'utf8');
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  report.push(
    '## 产出',
    '',
    '| 文件 | 行数 | 字节 | sha256 |',
    '| --- | --- | --- | --- |',
    `| sql/players-import-overlay.sql | ${players.length} | ${Buffer.byteLength(text, 'utf8')} | \`${sha}\` |`,
    '',
  );
}
if (bad.length) {
  report.push('## 补值不合法', '', '| ID | 姓名 | 原因 |', '| --- | --- | --- |');
  for (const b of bad) report.push(`| ${b.id} | ${b.name} | ${b.why} |`);
  report.push('');
}
if (errors.length) {
  report.push('## 归一化仍报错', '', '| ID | 姓名 | 字段 | 原因 |', '| --- | --- | --- | --- |');
  for (const e of errors) report.push(`| ${e.id} | ${e.name} | ${e.field} | ${e.message} |`);
  report.push('');
}
if (skipped.length) {
  report.push('## 待填（未补）', '', '| ID | 姓名 | 原因 |', '| --- | --- | --- |');
  for (const s of skipped) report.push(`| ${s.id} | ${s.name} | ${s.why} |`);
  report.push('');
}
writeFileSync(join(OUT_DIR, '..', 'players-import-overlay-report.md'), report.join('\n') + '\n', 'utf8');

console.log(`补录 ${players.length} 行｜待填 ${skipped.length}｜补值不合法 ${bad.length}｜归一化报错 ${errors.length}`);
console.log(`报告：scripts/players-import/players-import-overlay-report.md`);
