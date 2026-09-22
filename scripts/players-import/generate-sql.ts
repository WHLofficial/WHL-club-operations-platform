// 球员库导入 SQL 生成器（增量13 任务 B）：读 FC26db Base 表 → 复用端上 normalizeImportBatch
// → 产分片 SQL（每片 ≤ 片内语句数上限，规避单请求体积）+ 导入报告。
// 用法：node scripts/players-import/generate-sql.ts [xlsx路径] [每片语句数] [--mode minor|major]
//   --mode minor（缺省，小换版：成长全保留、CA 增量平移）| major（大换版：经验清零、CA/徽章各保留 1/3）
//
// 为什么不用端上 /players/import/confirm：该端点要管理端 OIDC 会话，脚本拿不到；
// 归一化与 upsert 语义直接 import 同一份 TS 代码，保证与网页导入逐字同口径。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { normalizeImportBatch } from '../../src/core/import.ts';
import type { NormalizedPlayer } from '../../src/core/import.ts';
import { upsertStatement, FOLD_PLAYSTYLES_SQL } from '../../src/worker/players-import.ts';
import type { ImportMode } from '../../src/worker/players-import.ts';

const SRC = process.argv[2] ?? 'E:/Downloads/FC26db20251217_fixed.xlsx';
const PER_FILE = Number(process.argv[3] ?? 1000);
const modeArg = process.argv.indexOf('--mode');
const modeRaw = modeArg !== -1 ? process.argv[modeArg + 1] : undefined;
const MODE: ImportMode = modeRaw === undefined ? 'minor' : modeRaw === 'minor' || modeRaw === 'major' ? modeRaw : (() => {
  console.error('--mode 只能是 minor 或 major');
  process.exit(2);
})();
const SLICE = 1000; // 与 web/src/pages/Admin.tsx 的 IMPORT_SLICE 同口径
const OUT_DIR = new URL('./sql/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const wb = XLSX.read(readFileSync(SRC), { type: 'buffer' });
const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Base'], { defval: null });
const growth = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Growth+'], { defval: null });
const futureStarIds = new Set<number>(
  growth.map((g) => Number(g['ID'])).filter((n) => Number.isInteger(n) && n > 0),
);

// 源侧重复 ID：整行同内容（已核）——按 ID 保留首行
const seenId = new Set<number>();
const rows: Record<string, unknown>[] = [];
const dupIds: number[] = [];
for (const r of rawRows) {
  const id = Number(r['ID']);
  if (seenId.has(id)) {
    dupIds.push(id);
    continue;
  }
  seenId.add(id);
  rows.push(r);
}

const players: NormalizedPlayer[] = [];
const dropped: { row: number; fcId: unknown; name: unknown; field: string; message: string }[] = [];
for (let i = 0; i < rows.length; i += SLICE) {
  const slice = rows.slice(i, i + SLICE);
  const out = normalizeImportBatch('A', slice, futureStarIds);
  players.push(...out.players);
  for (const e of out.errors) {
    dropped.push({ row: i + e.row, fcId: slice[e.row - 1]?.['ID'], name: slice[e.row - 1]?.['Name'], field: e.field, message: e.message });
  }
}

const str = (v: unknown): string => `'${String(v ?? '').replace(/'/g, "''")}'`;

// 直接用生产 upsertStatement 的 SQL 文本与参数顺序（喂它一个只捕获 prepare/bind 的假 DB），
// 再把绑定值渲染成字面量——SQL 口径与网页导入逐字一致，生产改了这里自动跟上。
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
  const sql = upsertStatement(capture, p, MODE) as unknown as string;
  if (sql.includes('?')) throw new Error(`占位符未全部替换（fc_id=${p.fcId}）`);
  return `${sql};`;
}

mkdirSync(OUT_DIR, { recursive: true });
const files: string[] = [];
const manifest: string[] = [];
for (let i = 0; i < players.length; i += PER_FILE) {
  const part = players.slice(i, i + PER_FILE);
  const no = String(i / PER_FILE + 1).padStart(2, '0');
  const name = `players-import-${no}.sql`;
  const head = `-- 球员库导入 分片 ${no}（生成：scripts/players-import/generate-sql.ts；勿手改）\n-- 换版模式：${MODE === 'major' ? 'major（大换版：经验清零、CA/徽章各保留 1/3）' : 'minor（小换版：成长全保留、CA 增量平移）'}\n-- 源：${SRC} → Base 表；本片 ${part.length} 行（第 ${i + 1}-${i + part.length} 行）\n`;
  // 大换版：发放明细的折算只能在全部分片写完之后跑，所以挂在最后一片尾巴上（幂等，重复执行无副作用）
  const tail =
    MODE === 'major' && i + PER_FILE >= players.length
      ? `\n-- 大换版折算：发放明细每段保留最早的 ceil(n/3) 行（与台账计数同规则；必须在本片之后执行）\n${FOLD_PLAYSTYLES_SQL};\n`
      : '';
  const text = head + part.map(upsertSql).join('\n') + '\n' + tail;
  writeFileSync(join(OUT_DIR, name), text, 'utf8');
  files.push(`${name}（${part.length} 行）`);
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  manifest.push(`| ${name} | ${i + 1}-${i + part.length} | ${part.length} | ${Buffer.byteLength(text, 'utf8')} | \`${sha}\` |`);
}

const stat = (f: (p: NormalizedPlayer) => boolean) => players.filter(f).length;
const report = [
  '# 球员库导入报告（FC26db Base → players）',
  '',
  `源文件：\`${SRC}\`｜表 \`Base\`｜数据行 ${rawRows.length}`,
  `换版模式：**${MODE === 'major' ? 'major（大换版：经验清零、成长 CA/徽章各保留 1/3 向上取整）' : 'minor（小换版：成长全保留、CA 增量平移）'}**`,
  `去重：源侧重复 ID ${dupIds.length} 个（整行同内容，保留首行）→ 唯一行 ${rows.length}`,
  `可入库：**${players.length}**｜被校验拦下：${dropped.length}`,
  `分片：${files.length} 个文件（每片 ${PER_FILE} 行），目录 \`scripts/players-import/sql/\``,
  `未来之星名单（Growth+）：${futureStarIds.size} 人｜命中导入行 ${stat((p) => p.futureStarSuggestion)} 人`,
  '',
  '## 字段口径',
  '',
  '| 列 | 来源 |',
  '| --- | --- |',
  '| uid / fc_id | `fc{ID}` / `ID`（EA 球员 id，ON CONFLICT(fc_id) upsert 幂等） |',
  '| name | `Name` |',
  '| ca / pa / base_ca | `CA` / `PA`（base_ca = 导入时 CA，§10.4 换版基准） |',
  '| age | `Age` |',
  '| foot | `FootID` 1右→1、2左→0 |',
  '| position | `PosID1` → PositionID 表（-1/未知 → NULL） |',
  '| prestige | `internationalrep` 原值（#N/A → NULL） |',
  '| china_plan | `naID`=155（China PR）置 1 |',
  '| growable | 规则 4.1.1：导入时年龄 ≤25 置 1，赛季结算再重判 |',
  '| is_future_star | Growth+ 名单建议值（管理组终审口径） |',
  '| game_attrs | FC26db 71 列 ID-only JSON（TECH_DESIGN §5.2） |',
  '',
  '`club_id` 不在导入列内（import 管线裁决：只写 FC 源列，不碰运营列）——导入后全体为未归属，绑队另行处理。',
  '',
  '## 分片清单',
  '',
  '`sha256` 是写入生产 D1 的逐字节内容（`npx wrangler d1 execute whl-club --remote --file <片>`）。',
  '生成物目录不进版本库（见 `.gitignore`），本清单即入库的审计凭据；重跑脚本可逐字节复现。',
  '',
  '| 分片 | 行区间 | 行数 | 字节 | sha256 |',
  '| --- | --- | --- | --- | --- |',
  ...manifest,
  '',
  '## 被拦下的行',
  '',
];
if (dropped.length === 0) report.push('无。');
else {
  report.push('| 源表行号 | ID | 姓名 | 字段 | 原因 |', '| --- | --- | --- | --- | --- |');
  for (const d of dropped) report.push(`| ${d.row} | ${d.fcId} | ${d.name} | ${d.field} | ${d.message} |`);
  report.push('', '说明：这些行源值缺 `naID`（`#N/A`）与 `FootID`（`Not Found`）两列，`FC26db…_backup.xlsx` 的 `Main` 表同样缺；本地与在线源 2026-09-19 已逐个排查，均无源可补（详见 README「未入库的输入」）。补齐后用 `scripts/players-import/overlay-missing.ts` 增量入账，幂等。');
}
const reportPath = join(OUT_DIR, '..', 'players-import-report.md');
writeFileSync(reportPath, report.join('\n') + '\n', 'utf8');

console.log(`数据行 ${rawRows.length}｜源侧重复 ${dupIds.length}｜唯一 ${rows.length}`);
console.log(`可入库 ${players.length}｜被拦下 ${dropped.length}（详见 players-import-report.md）`);
console.log(`分片 ${files.length} 个：${files.slice(0, 3).join(' ')} ... ${files[files.length - 1]}`);
console.log(`输出目录 ${OUT_DIR}`);
