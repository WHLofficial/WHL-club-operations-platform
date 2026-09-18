// 球员库导入本地试算（只读，不碰网络/生产）：读 FC26db Base 表 → 跑 normalizeImportBatch
// → 输出校验结果、批次计划、队籍覆盖。用法：node scripts/players-import/dry-run.ts [xlsx路径]
// 目的：确认端 422「先看预览报告」的失败面在导入前就暴露，而不是提交时才发现。
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { normalizeImportBatch, IMPORT_ROW_LIMIT } from '../../src/core/import.ts';

const SRC = process.argv[2] ?? 'E:/Downloads/FC26db20251217_fixed.xlsx';

// 平台待导入的 16 个俱乐部（EA team id，与生产 clubs.id 一致）
const LEAGUE_CLUB_IDS = [110374, 5, 9, 280, 45, 73, 33, 21, 11, 449, 243, 13, 14, 66, 2, 1];

const wb = XLSX.read(readFileSync(SRC), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Base'], { defval: null });
const growth = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Growth+'], { defval: null });
const futureStarIds = new Set<number>(
  growth.map((g) => Number(g['ID'])).filter((n) => Number.isInteger(n) && n > 0),
);

console.log(`源文件：${SRC}`);
console.log(`Base 行数：${rows.length}｜Growth+ 名单：${futureStarIds.size} 人｜列数：${Object.keys(rows[0] ?? {}).length}`);

// 端上单批 ≤IMPORT_ROW_LIMIT（前端切片同口径），这里按同一切法逐批校验后汇总
const players: ReturnType<typeof normalizeImportBatch>['players'] = [];
const errors: ReturnType<typeof normalizeImportBatch>['errors'] = [];
const batchCount = Math.ceil(rows.length / IMPORT_ROW_LIMIT);
for (let i = 0; i < rows.length; i += IMPORT_ROW_LIMIT) {
  const slice = rows.slice(i, i + IMPORT_ROW_LIMIT);
  const out = normalizeImportBatch('A', slice, futureStarIds);
  players.push(...out.players);
  errors.push(...out.errors.map((e) => ({ ...e, row: e.row + i })));
}

console.log(`\n校验（${batchCount} 批）：可入库 ${players.length}｜报错 ${errors.length}`);
if (errors.length > 0) {
  const buckets = new Map<string, { n: number; rows: number[] }>();
  for (const e of errors) {
    const k = `${e.field}: ${e.message}`;
    const b = buckets.get(k) ?? { n: 0, rows: [] };
    b.n += 1;
    if (b.rows.length < 5) b.rows.push(e.row);
    buckets.set(k, b);
  }
  console.log(`报错分类（共 ${buckets.size} 类，按条数降序）：`);
  for (const [k, v] of [...buckets].sort((a, b) => b[1].n - a[1].n)) {
    const ids = v.rows.map((r) => rows[r - 1]?.['ID']).join(', ');
    console.log(`  ${v.n} 条｜${k}｜样例行 ${v.rows.join('/')}（ID ${ids}）`);
  }
}

const effective = errors.length > 0 ? 0 : players.length;
console.log(`\n批次计划（单批 ≤${IMPORT_ROW_LIMIT} 行）：${Math.ceil(effective / IMPORT_ROW_LIMIT)} 批`);

const teamCount = new Map<number, number>();
let leagueRelated = 0;
let freeAgent = 0;
for (const r of rows) {
  const t = Number(r['TeamID']);
  if (t === 0 || r['TeamID'] === null) freeAgent += 1;
  else teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
  if (LEAGUE_CLUB_IDS.includes(t)) leagueRelated += 1;
}
console.log(`\n队籍覆盖：联盟 16 队共 ${leagueRelated} 人｜自由身(TeamID=0) ${freeAgent} 人｜其余 ${rows.length - leagueRelated - freeAgent} 人`);
const top = [...teamCount].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(`人数最多的队：${top.map(([id, n]) => `${id}:${n}`).join(' ')}`);

const rep = new Map<number, number>();
for (const r of rows) {
  const v = Number(r['internationalrep']);
  rep.set(v, (rep.get(v) ?? 0) + 1);
}
console.log(`prestige 分布（internationalrep）：${[...rep].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}→${n}人`).join(' ')}`);

const noPos = rows.filter((r) => Number(r['PosID1']) === -1).length;
const caGtPa = rows.filter((r) => Number(r['CA']) > Number(r['PA'])).length;
console.log(`PosID1=-1（无位置）：${noPos} 人｜CA>PA：${caGtPa} 人`);
