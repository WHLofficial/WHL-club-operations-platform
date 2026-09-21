// S9 合同导入（E:\Downloads\一线队-S9.csv → 生产 contracts）离线 SQL 生成器
//
// 为什么不走端上导入：通道 C（`/api/admin/contracts/import/confirm`）只吃 5 个字段
// （uid / releaseFee / wage / effectiveFrom / contractType，web/src/lib/imports.ts:8），表达不了 CSV 的
// **效力年**（col27）——那是解约费（src/core/bypass-rules.ts:52-57 满 3 赛季免费）与保护期的唯一输入。
// 走通道 C 只能落 `service_ticks = closedRegularTicks(effective_from)`（本批数据下恒为 0 或 1），
// 399 名「效力 ≥1.5 赛季」的球员解约成本会被大幅高估。故本批走离线 SQL，显式写刻度列。
//
// 刻度口径（增量 25 / 迁移 0028；src/worker/contract-ticks.ts:24-51）：
//   效力（赛季）= 0.5 × (当前已关常规窗数 − service_ticks) ⇒ service_ticks = 当前刻度 − 2 × 效力年
//   保护期结束点 protection_ticks = service_ticks + PROTECTION_TICKS(3)；训练营（trainee）无保护期 = NULL
//   本批当前刻度 = 1（季初常规窗 2026-09-18T01:01Z 已关，其余季窗在库内不存在）
//
// 映射（CSV → contracts，逐列见 README §4）：
//   col5 ID → players.fc_id；col19 违约金 → release_fee；col20 工资 → wage；
//   含「训练营」字样的 63 行 → contract_type='trainee' 且硬约束 wage=TRAINEE_WAGE / release_fee=TRAINEE_RC
//   （src/core/squad-rules.ts:6-7）；col27 效力年 → service_ticks（空按 0）。
//   effective_from 统一落 S9 季初锚点 2026-09-18（CSV 第 2 行注记「效力年更至季初」），仅展示用：
//   金额判定只读刻度列（src/core/bypass-rules.ts:23-57）。
//
// 守卫：每条 INSERT 都带 `p.fc_id = ? AND p.club_id = 队` （队籍未对齐即不写）与
//   `NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = p.id)`（已有合同不覆盖）⇒ 重放 changes = 0。
//   contract 语句形状与 src/worker/contracts-import.ts:185-213 的 upsertContractStatement 同源。
//
// 通道纪律（scripts/README.md 第 66 行）：contracts 含外键（club_id REFERENCES clubs），
//   必须走 `--command`（或 D1 REST /query），不能走 `--file`。分片由 exec-shards.mjs 折叠成单行执行。
//
// 用法：
//   node gen-contracts-sql.ts [CSV 路径] [每片语句数]   生成分片 + 回滚 + 预检/验收 + 报告
//   node gen-contracts-sql.ts --verify                  只读复核：重算期望与库内合同逐列比对，期望「残留差异 0」
//   node gen-contracts-sql.ts --local                   读本地 D1（本地演练用，默认读远端）
//   node gen-contracts-sql.ts --ticks=N                 覆盖当前刻度（默认从库内 season_windows 读，期望 1）

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TRAINEE_RC, TRAINEE_WAGE } from '../../src/core/squad-rules.ts';
import { PROTECTION_TICKS, SEASONS_PER_TICK } from '../../src/core/bypass-rules.ts';
import { CONTRACT_ROW_LIMIT } from '../../src/core/import.ts';

// 归一化区间与 src/core/import.ts:294-299 同源（那里是字面量、未导出常量，故此处复刻并标注行号）
const RC_MAX = 1000; // 违约金须 (0, 1000]
const WAGE_MAX = 100; // 工资须 [0, 100]

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const SRC = POSITIONAL[0] ?? 'E:/Downloads/一线队-S9.csv';
const PER_FILE = Number(POSITIONAL[1] ?? 50);
const DB = 'whl-club';
const TS = new Date().toISOString();
const TICKS_FLAG = [...FLAGS].find((f) => f.startsWith('--ticks='));
const EFFECTIVE_FROM = '2026-09-18'; // S9 季初（季初常规窗 opened_at 的日期部分）

/** CSV 队名 → 平台 clubs.id：只取 16 支人控队（4 支 CPU 队不在本批范围，README §6-①）。 */
const CLUBS: Record<string, number> = {
  阿森纳: 1,
  阿斯顿维拉: 2,
  切尔西: 5,
  利物浦: 9,
  曼联: 11,
  纽卡斯尔联: 13,
  诺丁汉森林: 14,
  拜仁慕尼黑: 21,
  慕尼黑1860: 33,
  尤文图斯: 45,
  里昂: 66,
  巴黎圣日耳曼: 73,
  皇家马德里: 243,
  奥林匹亚科斯: 280,
  皇家贝蒂斯: 449,
  佛罗伦萨: 110374,
};
/** 无平台 clubs 行的队名（本批跳过，README §6-③）：布鲁日 / 国际米兰 / 牛津联 / 在解约池。 */
const NO_CLUB = ['布鲁日', '国际米兰', '牛津联', '在解约'];
/** 4 支 CPU 队：平台有 clubs 行，但用户指令只提 16 支人控队（README §6-①）。 */
const CPU_CLUBS: Record<string, number> = { 曼城: 10, 巴塞罗那: 241, RB莱比锡: 112172, AC米兰: 131681 };

const SERVICE_YEARS_ALLOWED = [0, 0.5, 1, 1.5, 2, 2.5];

// ---------------------------------------------------------------- 工具

function lit(v: string | number | null): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`非法数值 ${v}`);
    return String(v);
  }
  return `'${v.replace(/'/g, "''")}'`;
}

/** 半角空格去尾 + 下标越界给空串（CSV 有 5,523 处尾随空格）。 */
function cell(c: string[], i: number): string {
  return (c[i] ?? '').trim();
}

/** 只取数字：CSV 有 1 处畸形 `*2.10`（慕尼黑1860 id 204525 Iñigo Martínez），前导杂字剥掉。 */
function num(text: string): number | null {
  const m = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 带引号的最小 CSV 切分（本文件无引号，但球员名可能含逗号；不引号感知的切分会串列）。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------- 源（CSV）

type CsvRow = {
  line: number; // 1 基行号（便于对账）
  clubName: string;
  clubId: number;
  fcId: number;
  name: string;
  rcRaw: string;
  wageRaw: string;
  yearsRaw: string;
  trainee: boolean;
  releaseFee: number;
  wage: number;
  serviceYears: number;
  serviceTicks: number;
  protectionTicks: number | null;
};

type SkipRow = { line: number; clubName: string; fcId: number; name: string; why: string };

function readCsv(path: string): { rows: CsvRow[]; skipped: SkipRow[]; csvRows: number; emptyYears: number } {
  if (!existsSync(path)) throw new Error(`CSV 不存在：${path}`);
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const rows: CsvRow[] = [];
  const skipped: SkipRow[] = [];
  const bad: string[] = [];
  const dupes = new Map<number, number>();
  let csvRows = 0;
  let emptyYears = 0;

  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    if (!/^\d{5,6}$/.test(cell(c, 5))) continue; // 有效球员行判定（第 5 列为 5–6 位纯数字）
    csvRows++;
    const clubName = cell(c, 2);
    const fcId = Number(cell(c, 5));
    const name = cell(c, 7) || cell(c, 6);
    dupes.set(fcId, (dupes.get(fcId) ?? 0) + 1);
    const clubId = CLUBS[clubName];
    if (clubId == null) {
      skipped.push({
        line: i + 1,
        clubName,
        fcId,
        name,
        why: NO_CLUB.includes(clubName)
          ? '无平台 clubs 行（README §6-③）'
          : CPU_CLUBS[clubName] != null
            ? 'CPU 队，本批范围外（README §6-①）'
            : `未映射队名（${clubName}）`,
      });
      continue;
    }

    const rcRaw = cell(c, 19);
    const wageRaw = cell(c, 20);
    const yearsRaw = cell(c, 27);
    // 训练营行：违约金列或工资列含「训练营」（63 行在 16 队内；7 行只有工资列写「海捞训练营」）
    const trainee = /训练营/.test(rcRaw) || /训练营/.test(wageRaw);
    const releaseFee = trainee ? TRAINEE_RC : num(rcRaw);
    const wage = trainee ? TRAINEE_WAGE : num(wageRaw);

    if (releaseFee == null || !(releaseFee > 0 && releaseFee <= RC_MAX)) {
      bad.push(`行 ${i + 1} ${clubName} fc ${fcId} ${name}：违约金 ${JSON.stringify(rcRaw)} → ${releaseFee}（须 (0, ${RC_MAX}]）`);
      continue;
    }
    if (wage == null || !(wage >= 0 && wage <= WAGE_MAX)) {
      bad.push(`行 ${i + 1} ${clubName} fc ${fcId} ${name}：工资 ${JSON.stringify(wageRaw)} → ${wage}（须 [0, ${WAGE_MAX}]）`);
      continue;
    }
    if (yearsRaw === '') emptyYears++;
    const serviceYears = yearsRaw === '' ? 0 : num(yearsRaw);
    if (serviceYears == null || !SERVICE_YEARS_ALLOWED.includes(serviceYears)) {
      bad.push(`行 ${i + 1} ${clubName} fc ${fcId} ${name}：效力年 ${JSON.stringify(yearsRaw)} → ${serviceYears}（须 ∈ ${SERVICE_YEARS_ALLOWED.join('/')}）`);
      continue;
    }

    rows.push({
      line: i + 1,
      clubName,
      clubId,
      fcId,
      name,
      rcRaw,
      wageRaw,
      yearsRaw,
      trainee,
      releaseFee,
      wage,
      serviceYears,
      serviceTicks: 0, // 主流程按当前刻度填
      protectionTicks: null,
    });
  }

  const dup = [...dupes.entries()].filter(([, n]) => n > 1);
  if (dup.length > 0) throw new Error(`CSV 有重复 fc_id：${dup.slice(0, 5).map(([k, n]) => `${k}×${n}`).join('，')}`);
  if (bad.length > 0) {
    console.error(`中止：${bad.length} 行归一化后仍不合平台规则（src/core/import.ts 的区间与枚举同源）。`);
    for (const b of bad.slice(0, 20)) console.error(`  ${b}`);
    process.exit(3);
  }
  if (rows.length > CONTRACT_ROW_LIMIT) {
    console.error(`中止：${rows.length} 行 > 通道上限 CONTRACT_ROW_LIMIT=${CONTRACT_ROW_LIMIT}。`);
    process.exit(3);
  }
  return { rows, skipped, csvRows, emptyYears };
}

// ---------------------------------------------------------------- 库（只读）

function d1Rows(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  const cmd = `npx wrangler d1 execute ${DB} ${scope} --json --command "${sql}"`;
  const res = spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`wrangler 读取失败（exit ${res.status}）：\n${res.stderr || res.stdout}`);
  }
  const at = res.stdout.indexOf('[');
  if (at < 0) throw new Error(`wrangler 输出不是 JSON：\n${res.stdout.slice(0, 400)}`);
  const parsed = JSON.parse(res.stdout.slice(at)) as Array<{ results?: Record<string, unknown>[] }>;
  return parsed[0]?.results ?? [];
}

type PlayerRow = { id: number; fcId: number; clubId: number | null; status: string | null };

function loadPlayers(fcIds: number[]): Map<number, PlayerRow> {
  const out = new Map<number, PlayerRow>();
  for (let i = 0; i < fcIds.length; i += 90) {
    const chunk = fcIds.slice(i, i + 90);
    const rows = d1Rows(`SELECT id, fc_id, club_id, status FROM players WHERE fc_id IN (${chunk.join(',')})`);
    for (const r of rows) {
      out.set(Number(r['fc_id']), {
        id: Number(r['id']),
        fcId: Number(r['fc_id']),
        clubId: r['club_id'] == null ? null : Number(r['club_id']),
        status: r['status'] == null ? null : String(r['status']),
      });
    }
  }
  return out;
}

/** 已有合同（只选 player_id：0028 未 apply 时也能读）。 */
function loadExistingContracts(playerIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < playerIds.length; i += 90) {
    const chunk = playerIds.slice(i, i + 90);
    const rows = d1Rows(`SELECT player_id FROM contracts WHERE player_id IN (${chunk.join(',')})`);
    for (const r of rows) out.set(Number(r['player_id']), Number(r['player_id']));
  }
  return out;
}

function loadTicks(): number {
  if (TICKS_FLAG) {
    const n = Number(TICKS_FLAG.slice('--ticks='.length));
    if (!Number.isFinite(n)) throw new Error(`--ticks= 不是数字：${TICKS_FLAG}`);
    return n;
  }
  // 0028 未 apply 时不能引用 is_temporary（列还不存在）；0028 之前不存在临时窗，故 closed 数即常规窗数
  const rows = d1Rows('SELECT COUNT(*) AS n, SUM(CASE WHEN closed_at IS NOT NULL THEN 1 ELSE 0 END) AS closed FROM season_windows');
  const total = Number(rows[0]?.['n'] ?? 0);
  const closed = Number(rows[0]?.['closed'] ?? 0);
  if (total !== closed) {
    throw new Error(`season_windows 有 ${total - closed} 条未关窗，无法判定当前刻度；请用 --ticks=N 显式指定。`);
  }
  return closed;
}

// ---------------------------------------------------------------- SQL 生成

function buildInsert(r: CsvRow, playerId: number): string {
  return (
    'INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, service_ticks, protection_ticks, is_active)\n' +
    `SELECT p.id, ${r.clubId}, ${lit(r.releaseFee)}, ${lit(r.wage)}, ${lit(r.trainee ? 'trainee' : 'formal')}, 'import', ${lit(TS)}, ${lit(EFFECTIVE_FROM)}, ${lit(r.serviceTicks)}, ${lit(r.protectionTicks)}, 1\n` +
    `FROM players p WHERE p.fc_id = ${r.fcId} AND p.club_id = ${r.clubId} AND p.id = ${playerId}\n` +
    '  AND NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = p.id);'
  );
}

function shards<T>(list: T[], size: number): { no: string; from: number; to: number; items: T[] }[] {
  const out: { no: string; from: number; to: number; items: T[] }[] = [];
  for (let i = 0; i < list.length; i += size) {
    const items = list.slice(i, i + size);
    out.push({ no: String(out.length + 1).padStart(2, '0'), from: i + 1, to: i + items.length, items });
  }
  return out;
}

/** 先清掉上一次生成的分片：行数会随库内状态变化，留旧片会让人误以为还有第 N+1 片。 */
function clearShards(dir: string, prefix: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(prefix) && name.endsWith('.sql')) unlinkSync(join(dir, name));
  }
}

function writeShards(
  dir: string,
  prefix: string,
  rows: CsvRow[],
  playerIds: Map<number, number>,
  manifest: string[],
): { files: number; maxBytes: number } {
  mkdirSync(dir, { recursive: true });
  clearShards(dir, prefix);
  let files = 0;
  let maxBytes = 0;
  for (const part of shards(rows, PER_FILE)) {
    const name = `${prefix}-${part.no}.sql`;
    const head = [
      `-- S9 合同导入分片 ${part.no}（16 支人控队，共 ${rows.length} 条）`,
      `-- 生成器 scripts/prod-20260920-s9-contracts/gen-contracts-sql.ts；生成时点 ${TS}`,
      `-- 覆盖第 ${part.from}-${part.to} 条（${part.items[0]?.clubName} … ${part.items[part.items.length - 1]?.clubName}）`,
      `-- 源 ${SRC}`,
      '-- 守卫：p.fc_id = ? AND p.club_id = 队 AND NOT EXISTS(同球员合同) ⇒ 重放或队籍未对齐时 changes = 0',
      '-- 通道：含外键，必须 --command（exec-shards.mjs 会把本文件折成单行执行），不能 --file',
      '',
    ].join('\n');
    const body = part.items
      .map((r) => `-- fc ${r.fcId} ${r.clubName} ${r.name} ${r.trainee ? 'trainee' : 'formal'} 效力${r.serviceYears}赛季\n${buildInsert(r, playerIds.get(r.fcId) ?? 0)}`)
      .join('\n');
    const text = `${head}${body}\n`;
    writeFileSync(join(dir, name), text, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    const sha = createHash('sha256').update(text, 'utf8').digest('hex');
    manifest.push(`| sql/${name} | ${part.from}-${part.to} | ${part.items.length} | ${bytes} | \`${sha}\` |`);
    maxBytes = Math.max(maxBytes, bytes);
    files++;
  }
  return { files, maxBytes };
}

function buildRollback(rows: CsvRow[]): string {
  return [
    '-- 回滚：删掉本批导入的合同（按批次标记 source+生成时点精确圈定，不误伤其他来源的合同）',
    `-- 生成时点 ${TS}；本批 ${rows.length} 条；执行：node ../exec-shards.mjs rollback/contracts-rollback.sql --remote`,
    '-- 队籍无需回滚：本批 462 行全部是 create（队籍对齐批已把球员放进目标队），生成器未产出任何 players 更新。',
    '',
    `DELETE FROM contracts WHERE source = 'import' AND signed_at = ${lit(TS)};`,
    '',
    '-- 回滚后自查（期望 0）：',
    `SELECT COUNT(*) AS left_rows FROM contracts WHERE source = 'import' AND signed_at = ${lit(TS)};`,
    '',
  ].join('\n');
}

function buildPrecheck(rows: CsvRow[], ticks: number): string {
  return [
    '-- 只读预检：执行前跑一次（node scratch/run-verify.mjs 本文件，或 --file 单行版本）',
    `-- 生成时点 ${TS}；期望 contracts_rows=0、tick_cols=4、tick_cols_window=1、closed_windows=${ticks}`,
    '-- 若 tick_cols < 4 ⇒ 迁移 0028 未 apply（必须先 apply，否则 INSERT 报 no such column）。',
    '',
    'SELECT',
    '  (SELECT COUNT(*) FROM contracts) AS contracts_rows,',
    "  (SELECT COUNT(*) FROM pragma_table_info('contracts') WHERE name IN ('service_ticks','protection_ticks','signed_season','signed_window_seq')) AS tick_cols,",
    "  (SELECT COUNT(*) FROM pragma_table_info('season_windows') WHERE name = 'is_temporary') AS tick_cols_window,",
    '  (SELECT COUNT(*) FROM season_windows WHERE closed_at IS NOT NULL) AS closed_windows,',
    '  (SELECT COUNT(*) FROM clubs) AS clubs_rows,',
    `  (SELECT COUNT(*) FROM players WHERE fc_id IN (${rows.map((r) => r.fcId).join(',')})) AS players_found;`,
    '',
  ].join('\n');
}

function buildVerify(rows: CsvRow[], ticks: number): string {
  const perClub = [...new Set(rows.map((r) => r.clubId))].sort((a, b) => a - b);
  const tickDist = [...rows.reduce((m, r) => m.set(r.serviceYears, (m.get(r.serviceYears) ?? 0) + 1), new Map<number, number>())]
    .sort((a, b) => a[0] - b[0])
    .map(([y, n]) => `${y} 赛季 ${n}`)
    .join('、');
  return [
    '-- 只读验收：执行后跑一次（node scratch/run-verify.mjs 本文件）',
    `-- 批次标记口径：本批全部语句写 signed_at = '${TS}'，该时刻全库唯一 ⇒ 范围收窄为「本批落库的行」。`,
    `-- 预期：rows_total = rows_import = ${rows.length}、formal = ${rows.filter((r) => !r.trainee).length}、trainee = ${rows.filter((r) => r.trainee).length}，`,
    '--       其余 bad_* / null_* / off_grid 全为 0（formal 行 protection_ticks 必须 = service_ticks + 3；',
    '--       trainee 行 wage = 0.75 / release_fee = 5 / protection_ticks IS NULL；刻度跨度 1 − service_ticks 必须 ∈ 0…5 的整数）。',
    `-- 效力年分布期望：${tickDist}。`,
    '',
    'SELECT',
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}') AS rows_total,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND source = 'import') AS rows_import,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND contract_type = 'formal') AS formal,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND contract_type = 'trainee') AS trainee,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND contract_type NOT IN ('formal','trainee')) AS bad_type,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND service_ticks IS NULL) AS null_service_ticks,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND contract_type = 'formal' AND protection_ticks <> service_ticks + ${PROTECTION_TICKS}) AS bad_protection,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND contract_type = 'trainee' AND (wage <> ${lit(TRAINEE_WAGE)} OR release_fee <> ${lit(TRAINEE_RC)} OR protection_ticks IS NOT NULL)) AS bad_trainee,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND (release_fee <= 0 OR release_fee > ${RC_MAX} OR wage < 0 OR wage > ${WAGE_MAX})) AS bad_money,`,
    `  (SELECT COUNT(*) FROM contracts WHERE signed_at = '${TS}' AND (${ticks} - service_ticks) NOT IN (0,1,2,3,4,5)) AS off_grid,`,
    `  (SELECT COUNT(*) FROM contracts c LEFT JOIN players p ON p.id = c.player_id WHERE c.signed_at = '${TS}' AND (p.id IS NULL OR p.club_id <> c.club_id)) AS club_mismatch;`,
    '',
    '-- 逐队条数（期望与报告 §2 的「可导行」列一致）：',
    `SELECT c.club_id, COUNT(*) AS n FROM contracts c WHERE c.signed_at = '${TS}' GROUP BY c.club_id ORDER BY c.club_id;`,
    '',
    '-- 效力年分布（期望与报告 §2 合计行的分布一致）：',
    `SELECT (${ticks} - service_ticks) AS tick_span, ROUND((${ticks} - service_ticks) * ${lit(SEASONS_PER_TICK)}, 1) AS seasons, COUNT(*) AS n`,
    `FROM contracts WHERE signed_at = '${TS}' GROUP BY service_ticks ORDER BY service_ticks DESC;`,
    '',
    `-- 落在 16 支目标队之外的合同（期望空集）：合计 ${rows.length} 条分布在 ${perClub.length} 支队`,
    `SELECT c.club_id, COUNT(*) AS n FROM contracts c WHERE c.signed_at = '${TS}' AND c.club_id NOT IN (${perClub.join(',')}) GROUP BY c.club_id;`,
    '',
  ].join('\n');
}

/** 逐行复核：重算期望并与库内合同逐列比对（--verify 用）。 */
function compareWithDb(rows: CsvRow[], playerIds: Map<number, number>): { diffs: string[]; hit: number } {
  const diffs: string[] = [];
  let hit = 0;
  const byPlayer = new Map<number, Record<string, unknown>>();
  const ids = rows.map((r) => playerIds.get(r.fcId) ?? -1).filter((v) => v > 0);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const res = d1Rows(
      `SELECT player_id, club_id, release_fee, wage, contract_type, source, signed_at, service_ticks, protection_ticks FROM contracts WHERE player_id IN (${chunk.join(',')})`,
    );
    for (const r of res) byPlayer.set(Number(r['player_id']), r);
  }
  const eq = (a: unknown, b: unknown) => (a == null && b == null) || Number(a) === Number(b) || String(a) === String(b);
  for (const r of rows) {
    const pid = playerIds.get(r.fcId);
    const got = pid == null ? undefined : byPlayer.get(pid);
    if (!got) {
      diffs.push(`fc ${r.fcId} ${r.name}：库内无合同（期望 club ${r.clubId} / rc ${r.releaseFee} / wage ${r.wage}）`);
      continue;
    }
    const checks: [string, unknown, unknown][] = [
      ['club_id', got['club_id'], r.clubId],
      ['release_fee', got['release_fee'], r.releaseFee],
      ['wage', got['wage'], r.wage],
      ['contract_type', got['contract_type'], r.trainee ? 'trainee' : 'formal'],
      ['source', got['source'], 'import'],
      ['service_ticks', got['service_ticks'], r.serviceTicks],
      ['protection_ticks', got['protection_ticks'], r.protectionTicks],
    ];
    const bad = checks.filter(([, a, b]) => !eq(a, b));
    if (bad.length === 0) hit++;
    else diffs.push(`fc ${r.fcId} ${r.name}：${bad.map(([k, a, b]) => `${k} 库=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`).join('，')}`);
  }
  return { diffs, hit };
}

// ---------------------------------------------------------------- 主流程

const { rows, skipped, csvRows, emptyYears } = readCsv(SRC);
const ticks = loadTicks();
for (const r of rows) {
  // 效力（赛季）= 0.5 × (刻度 − service_ticks) ⇒ service_ticks = 刻度 − 2 × 效力年
  r.serviceTicks = ticks - 2 * r.serviceYears;
  if (!Number.isInteger(r.serviceTicks)) throw new Error(`fc ${r.fcId} 的 service_ticks 非整数：${r.serviceTicks}`);
  r.protectionTicks = r.trainee ? null : r.serviceTicks + PROTECTION_TICKS;
}

const players = loadPlayers(rows.map((r) => r.fcId));
const missing = rows.filter((r) => !players.has(r.fcId));
if (missing.length > 0) {
  console.error(`中止：${missing.length} 名球员在库内按 fc_id 找不到。`);
  for (const r of missing.slice(0, 10)) console.error(`  行 ${r.line} fc ${r.fcId} ${r.clubName} ${r.name}`);
  process.exit(4);
}
const playerIds = new Map(rows.map((r) => [r.fcId, players.get(r.fcId)!.id] as const));

if (VERIFY) {
  const { diffs, hit } = compareWithDb(rows, playerIds);
  console.log(`[verify] 源行 ${rows.length} / 命中 ${hit} / 仍有差异的行 ${diffs.length}`);
  for (const d of diffs.slice(0, 5)) console.log(`    ${d}`);
  process.exit(diffs.length === 0 ? 0 : 4);
}

const misaligned = rows.filter((r) => players.get(r.fcId)!.clubId !== r.clubId);
if (misaligned.length > 0) {
  console.error(`中止：${misaligned.length}/${rows.length} 行队籍与目标队不一致（队籍对齐批未跑或被打回）。`);
  for (const r of misaligned.slice(0, 10)) {
    console.error(`  fc ${r.fcId} ${r.name}：现属 ${players.get(r.fcId)!.clubId ?? '自由身'}，CSV 目标 ${r.clubId}（${r.clubName}）`);
  }
  process.exit(5);
}

const existing = loadExistingContracts([...playerIds.values()]);
if (existing.size > 0) {
  console.error(`中止：${existing.size} 名目标球员已有合同行（contracts 非空）。`);
  console.error('  先去生产查清楚这些合同是谁写的，再决定「更新」还是「跳过」——本批只做创建，不覆盖已有合同。');
  process.exit(6);
}

const manifest: string[] = [];
const { files, maxBytes } = writeShards(OUT_DIR, 'contracts-insert', rows, playerIds, manifest);
writeFileSync(join(HERE, '01-precheck.sql'), buildPrecheck(rows, ticks), 'utf8');
writeFileSync(join(HERE, '02-verify.sql'), buildVerify(rows, ticks), 'utf8');
mkdirSync(RB_DIR, { recursive: true });
writeFileSync(join(RB_DIR, 'contracts-rollback.sql'), buildRollback(rows), 'utf8');

// 逐队统计
type ClubStat = { name: string; csv: number; trainee: number; years: Map<number, number>; rc: number; wage: number };
const byClub = new Map<number, ClubStat>();
for (const r of rows) {
  const e = byClub.get(r.clubId) ?? { name: r.clubName, csv: 0, trainee: 0, years: new Map(), rc: 0, wage: 0 };
  e.csv++;
  if (r.trainee) e.trainee++;
  e.years.set(r.serviceYears, (e.years.get(r.serviceYears) ?? 0) + 1);
  e.rc += r.releaseFee;
  e.wage += r.wage;
  byClub.set(r.clubId, e);
}
const tickDist = new Map<number, number>();
for (const r of rows) tickDist.set(r.serviceYears, (tickDist.get(r.serviceYears) ?? 0) + 1);

const L: string[] = [];
L.push('# S9 合同导入（一线队-S9.csv → 生产 contracts）生成报告');
L.push('');
L.push(`- 生成时点：${TS}`);
L.push(`- 源：\`${SRC}\`（球员行 ${csvRows}，其中 16 支人控队 ${rows.length} 行，跳过 ${skipped.length} 行）`);
L.push(`- 当前刻度（已关常规窗数）：**${ticks}**（season_windows 已关 ${ticks} 条，库内无临时窗）`);
L.push(`- 落库语句：${rows.length} 条 → ${files} 片（每片 ${PER_FILE} 条，最大 ${maxBytes} 字节）；回滚 1 条（\`rollback/\`）`);
L.push('- 刻度口径：`service_ticks = 当前刻度 − 2 × 效力年`；`protection_ticks = service_ticks + 3`（训练营 NULL）');
L.push(`- 合同类型：formal ${rows.length - rows.filter((r) => r.trainee).length} / trainee ${rows.filter((r) => r.trainee).length}；` +
  `` + '训练营硬约束 `wage = ' + TRAINEE_WAGE + '`、`release_fee = ' + TRAINEE_RC + '`');
L.push(`- \`effective_from\` = \`${EFFECTIVE_FROM}\`（全批同一值，S9 季初锚点，仅展示用）；\`signed_at\` = 生成时点（批次标记）`);
L.push('- 生成物**不可逐字节复现**：球员 id、刻度与守卫取自生成时的库；重跑只会在合同到位后中止（exit 6）');
L.push('');
L.push('## 1. 裁决点落定（README §6）');
L.push('');
L.push('| 点 | 落定 | 依据 |');
L.push('| --- | --- | --- |');
L.push(`| ① 导入范围 | 16 支人控队 ${rows.length} 行（CPU 队 108 行不导） | 用户指令只提 16 队 |`);
L.push('| ② 异队冲突 | 已由队籍对齐批消除（本批实测 0 行不一致） | 对齐后 classify 全走 create |');
L.push(`| ③ 无目标队 | 本批不导 ${skipped.length} 行（布鲁日 / 国际米兰 / 牛津联 / 在解约） | 平台无这些 clubs 行 |`);
L.push('| ④ 效力年 | generator 直接算刻度，不吃通道 C 的 `effective_from` 推导 | 金额判定只读刻度列（`src/core/bypass-rules.ts:23-57`） |');
L.push('| ⑤ 执行通道 | 离线 SQL 分片，走 `--command` | contracts 含外键（`scripts/README.md` 第 66 行） |');
L.push('| ⑥ audit_log | 不写；留痕靠本报告与 `scripts/README.md` | PROD 批惯例 |');
L.push('');
L.push('## 2. 逐队统计');
L.push('');
L.push('| club_id | 队名 | 可导行 | trainee | 效力年分布 | 违约金合计 | 工资合计 |');
L.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const [clubId, e] of [...byClub.entries()].sort((a, b) => a[0] - b[0])) {
  const dist = [...e.years.entries()].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}×${n}`).join(' ');
  L.push(`| ${clubId} | ${e.name} | ${e.csv} | ${e.trainee} | ${dist} | ${e.rc.toFixed(2)} | ${e.wage.toFixed(2)} |`);
}
L.push(`| — | **合计** | **${rows.length}** | **${rows.filter((r) => r.trainee).length}** | ${[...tickDist.entries()].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}×${n}`).join(' ')} | ${rows.reduce((n, r) => n + r.releaseFee, 0).toFixed(2)} | ${rows.reduce((n, r) => n + r.wage, 0).toFixed(2)} |`);
L.push('');
L.push('## 3. 跳过的行（不在本批范围）');
L.push('');
L.push('| 队名 | 行数 | 说明 |');
L.push('| --- | --- | --- |');
for (const club of [...new Set(skipped.map((s) => s.clubName))]) {
  const n = skipped.filter((s) => s.clubName === club).length;
  L.push(
    `| ${club} | ${n} | ${
      NO_CLUB.includes(club) ? '平台无该俱乐部行' : CPU_CLUBS[club] != null ? 'CPU 队（本批范围外）' : '未映射队名'
    } |`,
  );
}
L.push('');
L.push('## 4. 逐行明细（可逐条与 CSV 对账）');
L.push('');
L.push('| 行 | club_id | fc_id | 球员 | 类型 | 违约金 | 工资 | 效力年 | service_ticks | protection_ticks | effective_from |');
L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  L.push(`| ${r.line} | ${r.clubId} | ${r.fcId} | ${r.name} | ${r.trainee ? 'trainee' : 'formal'} | ${r.releaseFee} | ${r.wage} | ${r.serviceYears} | ${r.serviceTicks} | ${r.protectionTicks ?? 'NULL'} | ${EFFECTIVE_FROM} |`);
}
L.push('');
L.push(`效力年列的空值是 \`0\` 处理：本批范围内 ${emptyYears} 行。`);
L.push('');
L.push('## 5. 分片 sha256');
L.push('');
L.push('| 文件 | 覆盖 | 语句数 | 字节 | sha256 |');
L.push('| --- | --- | --- | --- | --- |');
for (const m of manifest) L.push(m);
L.push('');
L.push('## 6. 执行步骤');
L.push('');
L.push('1. **前置**：`npx wrangler d1 migrations list whl-club --remote` 确认只剩 0028；apply 0028。');
L.push('   ```');
L.push('   npx wrangler d1 migrations apply whl-club --remote');
L.push('   ```');
L.push('   （0028 未 apply 时 INSERT 会报 `no such column: service_ticks`。本批**不需要**先部署增量 25 的 worker：');
L.push('   刻度列由本批 SQL 直接写；残余风险是 apply 后、部署前若有人从网页面板创建合同，旧 worker 会落默认刻度。）');
L.push('2. **预检**（只读）：`node scratch/run-verify.mjs scripts/prod-20260920-s9-contracts/01-precheck.sql`');
L.push('   期望 `contracts_rows=0`、`tick_cols=4`、`tick_cols_window=1`、`closed_windows=1`、`clubs_rows=20`、`players_found=462`。');
L.push('3. **执行**（逐片，含外键 ⇒ 必须 `--command`）：');
L.push('   ```');
L.push(`   node scripts/prod-20260920-s9-contracts/exec-shards.mjs scripts/prod-20260920-s9-contracts/sql/contracts-insert-01.sql --remote`);
L.push('   # …02.sql … 直至最后一片');
L.push('   ```');
L.push('   每片回 `changes` 合计 = 该片语句数（守卫全中时）；重放 changes = 0。');
L.push('4. **验收**（只读）：`node scratch/run-verify.mjs scripts/prod-20260920-s9-contracts/02-verify.sql`');
L.push('   另跑 `node scripts/prod-20260920-s9-contracts/gen-contracts-sql.ts --verify`（逐行重算，期望「仍有差异的行 0」）。');
L.push('5. **回滚**（如需要）：`node scripts/prod-20260920-s9-contracts/exec-shards.mjs scripts/prod-20260920-s9-contracts/rollback/contracts-rollback.sql --remote`');
L.push('');
L.push('## 7. 风险与已知背离');
L.push('');
L.push('- **刻度无法从窗口表反推**：`windowBaseTicks(effective_from)` 只数库内已关常规窗（本库只有 S9 季初 1 条），');
L.push('  故按 `effective_from` 重算只会得到 0 或 1 tick，恢复不了 CSV 的效力年。本批刻度的唯一权威是 `service_ticks` 列。');
L.push('  任何将来的「按历史重算刻度」逻辑都必须以 `service_ticks` 为准。');
L.push('- **`effective_from` 只是展示值**：全批同一值（S9 季初）。`src/worker/routes/players.ts:690` 把它发给前端；金额判定不读它。');
L.push('- **保护期语义**：效力 ≥1.5 赛季的 formal 球员 `protection_ticks ≤ 1`（当前刻度 1）⇒ 保护期已结束，符合规则 4.3.1。');
L.push('- **工资/违约金口径**：CSV 工资列另有 1 处畸形 `*2.10`（慕尼黑1860 fc 204525），已按 2.10 解析；');
L.push('  训练营 63 行按平台硬约束改写为 0.75 / 5（README §4）。');
L.push('- **注册体检**：导入后 16 队人数不变（本批不写 `players.club_id`），但合同数从 0 变 462，建议跑一次报名合规体检。');

writeFileSync(join(HERE, 'contracts-report.md'), `${L.join('\n')}\n`, 'utf8');

console.log(`[gen] 源行 ${csvRows} → 可导 ${rows.length}（跳过 ${skipped.length}）`);
console.log(`[gen] trainee ${rows.filter((r) => r.trainee).length} / formal ${rows.length - rows.filter((r) => r.trainee).length}`);
console.log(`[gen] 当前刻度 ${ticks}；service_ticks 范围 ${Math.min(...rows.map((r) => r.serviceTicks))} … ${Math.max(...rows.map((r) => r.serviceTicks))}`);
console.log(`[gen] 分片 ${files} 个写入 sql/（每片 ≤${PER_FILE} 条，最大 ${maxBytes} 字节）+ 01-precheck.sql / 02-verify.sql / rollback/contracts-rollback.sql / contracts-report.md`);
