// S9 合同导入（巴塞罗那 / RB 莱比锡两支 CPU 队）离线 SQL 生成器
//
// 缘起：用户 2026-10-05 指令「按 E:\Downloads\一线队-S9.csv 导入巴塞罗那和莱比锡队合同信息」。
// 这两队是 2026-09-20 人控 16 队批（scripts/prod-20260920-s9-contracts）时按「用户只提 16 队」跳过的
// 4 支 CPU 队中的两支（另两支：曼城 10 / AC米兰 131681 仍不在本批）。
//
// 通道与口径与该批逐条同源（该批 README §4/§5 的规则，未做任何新拍板）：
//   为什么不走端上通道 C（/api/admin/contracts/import/confirm）：它只吃 5 个字段，表达不了 CSV 的
//     **效力年**（col27）——那是解约费（src/core/bypass-rules.ts 满 3 赛季免费）与保护期的唯一输入。
//   刻度（v3.0.0 / 迁移 0028；src/worker/contract-ticks.ts）：
//     效力（赛季）= 0.5 × (当前已关常规窗数 − service_ticks) ⇒ service_ticks = 当前刻度 − 2 × 效力年
//     保护期 protection_ticks = service_ticks + PROTECTION_TICKS(3)；训练营（trainee）无保护期 = NULL
//   映射：col5 ID → players.fc_id；col19 违约金 → release_fee；col20 工资 → wage；col27 效力年 → service_ticks。
//     含「训练营」的 6 行（均在巴萨）→ contract_type='trainee' 且硬约束 release_fee=TRAINEE_RC / wage=TRAINEE_WAGE。
//     effective_from 统一 2026-09-18（S9 季初锚点，仅展示：金额判定只读刻度列）；signed_at 用生成时点作批标记（回滚按它删）。
//   守卫：INSERT ... SELECT ... WHERE p.fc_id=? AND p.club_id=? AND p.id=? AND NOT EXISTS(contracts)
//     ⇒ 队籍未对齐或已有合同则 changes=0，重放安全（--retry 可开）。
//
// 通道纪律（scripts/README.md 第 66 行）：contracts 含外键（club_id REFERENCES clubs），必须走 --command
//   （或 D1 REST /query），不能走 --file。执行：node exec-shards.mjs sql/02-contracts.sql --remote
//
// 用法：
//   node gen-cpu-contracts-sql.ts [CSV 路径]        生成 sql/ + rollback/ + 报告（默认读远端只读核对）
//   node gen-cpu-contracts-sql.ts --verify          只读复核：重算期望与库内合同逐列比对，期望「残留差异 0」
//   node gen-cpu-contracts-sql.ts --local           读本地 D1（本地演练用；默认读远端）

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TRAINEE_RC, TRAINEE_WAGE } from '../../src/core/squad-rules.ts';
import { PROTECTION_TICKS } from '../../src/core/bypass-rules.ts';

const RC_MAX = 1000; // 违约金须 (0, 1000]（与 src/core/import.ts 的归一化区间同源）
const WAGE_MAX = 100; // 工资须 [0, 100]

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const VERIFY = FLAGS.has('--verify');
const LOCAL = FLAGS.has('--local');
const TICKS_FLAG = [...FLAGS].find((f) => f.startsWith('--ticks='));

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const SRC = POSITIONAL[0] ?? 'E:/Downloads/一线队-S9.csv';
const DB = 'whl-club';
const TS = new Date().toISOString();
const EFFECTIVE_FROM = '2026-09-18'; // S9 季初（季初常规窗 opened_at 的日期部分）

/** CSV 队名 → clubs.id：本批范围（用户指令点名两队）。 */
const CLUBS: Record<string, number> = { 巴塞罗那: 241, RB莱比锡: 112172 };
/** 本批跳过的其余 CSV 队名（含 3 支无平台 clubs 行的队与 2 支未点名的 CPU 队）。 */
const OTHER_CLUBS = [
  '在解约', '布鲁日', '国际米兰', '牛津联', '曼城', 'AC米兰',
  '阿森纳', '阿斯顿维拉', '切尔西', '利物浦', '曼联', '纽卡斯尔联', '诺丁汉森林',
  '拜仁慕尼黑', '慕尼黑1860', '尤文图斯', '里昂', '巴黎圣日耳曼', '皇家马德里',
  '奥林匹亚科斯', '皇家贝蒂斯', '佛罗伦萨',
];
/** 期望行数（CSV 换版即报错，防静默漏导）。 */
const EXPECTED: Record<string, { rows: number; trainee: number }> = {
  巴塞罗那: { rows: 29, trainee: 6 },
  RB莱比锡: { rows: 26, trainee: 0 },
};
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

function cell(c: string[], i: number): string {
  return (c[i] ?? '').trim();
}

function num(text: string): number | null {
  const m = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
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

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 只读查询：wrangler d1 execute --json（生产偶发子进程崩溃 ⇒ 重试 2 次）。 */
function d1(sql: string): Record<string, unknown>[] {
  const scope = LOCAL ? '--local' : '--remote';
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = spawnSync(`npx wrangler d1 execute ${DB} ${scope} --json --command "${sql}"`, {
      shell: true,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
    if (res.status === 0) {
      const m = /^\[/m.exec(res.stdout ?? '');
      if (m?.index != null) {
        const parsed = JSON.parse((res.stdout ?? '').slice(m.index));
        return parsed[0]?.results ?? [];
      }
      last = '输出里没有行首 [ 的 JSON';
    } else last = (res.stderr || res.stdout || '').slice(0, 300);
  }
  throw new Error(`D1 查询失败：${sql}\n${last}`);
}

// ---------------------------------------------------------------- CSV

type Row = {
  club: string;
  clubId: number;
  fcId: number;
  name: string;
  trainee: boolean;
  releaseFee: number;
  wage: number;
  serviceYears: number;
  line: number;
};

function readCsv(path: string): { rows: Row[]; skipped: Record<string, number> } {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  const skipped: Record<string, number> = {};
  const seen = new Set<number>();
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    const c = splitCsvLine(raw);
    const idText = cell(c, 5);
    if (!/^\d{5,6}$/.test(idText)) continue; // 「球队列表」区等非球员行
    const club = cell(c, 2);
    if (!(club in CLUBS)) {
      if (!OTHER_CLUBS.includes(club)) errors.push(`第 ${i + 1} 行出现未知队名「${club}」——CSV 可能换版，先核对`);
      skipped[club] = (skipped[club] ?? 0) + 1;
      continue;
    }
    const fcId = Number(idText);
    if (seen.has(fcId)) errors.push(`第 ${i + 1} 行 fc_id ${fcId} 重复`);
    seen.add(fcId);
    const rcRaw = cell(c, 19);
    const wageRaw = cell(c, 20);
    const trainee = /训练营/.test(rcRaw) || /训练营/.test(wageRaw);
    const releaseFee = trainee ? TRAINEE_RC : num(rcRaw);
    const wage = trainee ? TRAINEE_WAGE : num(wageRaw);
    const serviceYears = num(cell(c, 27)) ?? 0;
    if (releaseFee === null || releaseFee <= 0 || releaseFee > RC_MAX) errors.push(`第 ${i + 1} 行违约金越界：${rcRaw} → ${releaseFee}`);
    if (wage === null || wage < 0 || wage > WAGE_MAX) errors.push(`第 ${i + 1} 行工资越界：${wageRaw} → ${wage}`);
    if (!SERVICE_YEARS_ALLOWED.includes(serviceYears)) errors.push(`第 ${i + 1} 行效力年不在允许集：${cell(c, 27)} → ${serviceYears}`);
    if (releaseFee === null || wage === null) continue;
    rows.push({
      club,
      clubId: CLUBS[club]!,
      fcId,
      name: cell(c, 6),
      trainee,
      releaseFee,
      wage,
      serviceYears,
      line: i + 1,
    });
  }
  if (errors.length) {
    console.error('CSV 校验未过：');
    for (const e of errors) console.error(`  ${e}`);
    process.exit(3);
  }
  for (const [club, exp] of Object.entries(EXPECTED)) {
    const mine = rows.filter((r) => r.club === club);
    const trainee = mine.filter((r) => r.trainee).length;
    if (mine.length !== exp.rows || trainee !== exp.trainee) {
      console.error(`行数与期望不符：${club} 实得 ${mine.length} 行（训练营 ${trainee}），期望 ${exp.rows} 行（训练营 ${exp.trainee}）`);
      process.exit(3);
    }
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------- 库侧

function loadTicks(): number {
  if (TICKS_FLAG) return Number(TICKS_FLAG.slice('--ticks='.length));
  const open = d1(`SELECT COUNT(*) AS n FROM season_windows WHERE status = 'open'`);
  const openN = Number(open[0]?.n ?? 0);
  const closed = d1(`SELECT COUNT(*) AS n FROM season_windows WHERE status = 'closed' AND is_temporary = 0`);
  const closedN = Number(closed[0]?.n ?? 0);
  if (openN > 0) {
    console.error(`库里有 ${openN} 个未关闭的常规窗，刻度无法推断——请显式给 --ticks=N`);
    process.exit(4);
  }
  return closedN;
}

type Player = { id: number; fc_id: number; club_id: number; name: string };

function loadPlayers(fcIds: number[]): Map<number, Player> {
  const list = fcIds.join(',');
  const rows = d1(`SELECT id, fc_id, club_id, name FROM players WHERE fc_id IN (${list})`);
  return new Map(rows.map((r) => [Number(r.fc_id), r as unknown as Player]));
}

function loadExisting(playerIds: number[]): Record<string, unknown>[] {
  const list = playerIds.join(',');
  return d1(`SELECT player_id, club_id, contract_type, release_fee, wage, service_ticks, protection_ticks, source FROM contracts WHERE player_id IN (${list})`);
}

// ---------------------------------------------------------------- 工件

type Planned = Row & { playerId: number; serviceTicks: number; protectionTicks: number | null };

function buildInsert(p: Planned): string {
  const cols =
    'INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, service_ticks, protection_ticks, is_active)';
  const type = p.trainee ? 'trainee' : 'normal';
  return (
    `${cols} SELECT p.id, ${p.clubId}, ${lit(p.releaseFee)}, ${lit(p.wage)}, '${type}', 'import', '${TS}', '${EFFECTIVE_FROM}', ` +
    `${p.serviceTicks}, ${lit(p.protectionTicks)}, 1 FROM players p ` +
    `WHERE p.fc_id = ${p.fcId} AND p.club_id = ${p.clubId} AND p.id = ${p.playerId} ` +
    `AND NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = p.id);`
  );
}

function main(): void {
  const { rows, skipped } = readCsv(SRC);
  const ticks = loadTicks();
  const players = loadPlayers(rows.map((r) => r.fcId));

  const missing = rows.filter((r) => !players.get(r.fcId));
  if (missing.length) {
    console.error(`CSV 有 ${missing.length} 名球员在库内找不到（fc_id 未导入）：`);
    for (const m of missing) console.error(`  ${m.club} fc_id ${m.fcId} ${m.name}`);
    process.exit(5);
  }
  const wrongClub = rows.filter((r) => players.get(r.fcId)!.club_id !== r.clubId);
  if (wrongClub.length) {
    console.error(`队籍不符 ${wrongClub.length} 行（期望 club_id 与 CSV 一致）：`);
    for (const w of wrongClub) console.error(`  fc_id ${w.fcId} 库内 club_id ${players.get(w.fcId)!.club_id}，期望 ${w.clubId}`);
    process.exit(5);
  }

  const planned: Planned[] = rows.map((r) => {
    const serviceTicks = ticks - 2 * r.serviceYears;
    if (!Number.isInteger(serviceTicks)) throw new Error(`效力年 ${r.serviceYears} 与刻度 ${ticks} 算不出整数 service_ticks`);
    return {
      ...r,
      playerId: players.get(r.fcId)!.id,
      serviceTicks,
      protectionTicks: r.trainee ? null : serviceTicks + PROTECTION_TICKS,
    };
  });

  if (VERIFY) {
    const existing = loadExisting(planned.map((p) => p.playerId));
    const byPlayer = new Map(existing.map((c) => [Number(c.player_id), c]));
    const diffs: string[] = [];
    for (const p of planned) {
      const c = byPlayer.get(p.playerId);
      if (!c) {
        diffs.push(`fc_id ${p.fcId} ${p.name}：库内无合同`);
        continue;
      }
      const want: Record<string, unknown> = {
        club_id: p.clubId,
        contract_type: p.trainee ? 'trainee' : 'normal',
        release_fee: p.releaseFee,
        wage: p.wage,
        service_ticks: p.serviceTicks,
        protection_ticks: p.protectionTicks,
        source: 'import',
      };
      for (const [k, v] of Object.entries(want)) {
        const got = c[k] ?? null;
        const a = typeof v === 'number' ? Number(got) : got;
        if (a !== v) diffs.push(`fc_id ${p.fcId} ${p.name}：${k} 库内 ${JSON.stringify(got)} ≠ 期望 ${JSON.stringify(v)}`);
      }
    }
    console.log(`--verify（${LOCAL ? '本地' : '生产'} D1）：期望 ${planned.length} 行，库内匹配 ${planned.length - diffs.length} 行，残留差异 ${diffs.length}`);
    for (const d of diffs) console.log(`  ${d}`);
    process.exit(diffs.length ? 1 : 0);
  }

  const existing = loadExisting(planned.map((p) => p.playerId));
  if (existing.length) {
    console.error(`这 ${existing.length} 名球员已有合同（本批不覆盖，守卫会让重放 changes=0）：`);
    for (const c of existing) console.error(`  player_id ${c.player_id}（fc_id ${planned.find((p) => p.playerId === Number(c.player_id))?.fcId}）`);
    process.exit(6);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RB_DIR, { recursive: true });

  const stmts = planned.map(buildInsert);
  const precheckSql =
    [
      '-- 预检（只读）：本批 55 行的前置状态。期望：players_in_scope=55 / existing_contracts=0 / open_windows=0',
      `SELECT COUNT(*) AS players_in_scope FROM players WHERE fc_id IN (${planned.map((p) => p.fcId).join(',')});`,
      `SELECT COUNT(*) AS existing_contracts FROM contracts WHERE player_id IN (${planned.map((p) => p.playerId).join(',')});`,
      "SELECT COUNT(*) AS closed_regular_windows FROM season_windows WHERE status = 'closed' AND is_temporary = 0;",
      "SELECT COUNT(*) AS open_windows FROM season_windows WHERE status = 'open';",
    ].join('\n') + '\n';
  const playerIds = planned.map((p) => p.playerId).join(',');
  const verifySql =
    [
      '-- 验收（只读）：期望 contracts_now=55 / trainee_rows=6 / normal_without_protection=0 / trainee_with_protection=0',
      `SELECT COUNT(*) AS contracts_now FROM contracts WHERE player_id IN (${playerIds});`,
      `SELECT COUNT(*) AS trainee_rows FROM contracts WHERE player_id IN (${playerIds}) AND contract_type = 'trainee';`,
      `SELECT COUNT(*) AS normal_without_protection FROM contracts WHERE player_id IN (${playerIds}) AND contract_type <> 'trainee' AND protection_ticks IS NULL;`,
      `SELECT COUNT(*) AS trainee_with_protection FROM contracts WHERE player_id IN (${playerIds}) AND contract_type = 'trainee' AND protection_ticks IS NOT NULL;`,
      `SELECT MIN(service_ticks) AS min_service, MAX(service_ticks) AS max_service, MIN(protection_ticks) AS min_prot, MAX(protection_ticks) AS max_prot FROM contracts WHERE player_id IN (${playerIds});`,
      `SELECT club_id, COUNT(*) AS n FROM contracts WHERE player_id IN (${playerIds}) GROUP BY club_id ORDER BY club_id;`,
    ].join('\n') + '\n';
  const contractsSql =
    '-- 落库：55 行（巴萨 23 正式 + 6 训练营；莱比锡 26 正式）。守卫：fc_id/club_id/id 三重匹配 + 已有合同不写。\n' +
    stmts.join('\n') +
    '\n';
  const rollbackSql =
    `-- 回滚：按本批 signed_at 精确删（只删本批写入的行）\n` +
    `DELETE FROM contracts WHERE source = 'import' AND signed_at = '${TS}' AND player_id IN (${playerIds});\n`;

  writeFileSync(join(OUT_DIR, '01-precheck.sql'), precheckSql);
  writeFileSync(join(OUT_DIR, '02-contracts.sql'), contractsSql);
  writeFileSync(join(OUT_DIR, '03-verify.sql'), verifySql);
  writeFileSync(join(RB_DIR, '01-rollback.sql'), rollbackSql);

  const manifest = {
    ts: TS,
    csv: SRC,
    ticks,
    effectiveFrom: EFFECTIVE_FROM,
    statements: stmts.length,
    files: {
      'sql/01-precheck.sql': sha256(precheckSql),
      'sql/02-contracts.sql': sha256(contractsSql),
      'sql/03-verify.sql': sha256(verifySql),
      'rollback/01-rollback.sql': sha256(rollbackSql),
    },
    rows: planned.map((p) => ({
      club: p.club,
      fcId: p.fcId,
      playerId: p.playerId,
      name: p.name,
      type: p.trainee ? 'trainee' : 'normal',
      releaseFee: p.releaseFee,
      wage: p.wage,
      serviceYears: p.serviceYears,
      serviceTicks: p.serviceTicks,
      protectionTicks: p.protectionTicks,
    })),
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const table = planned
    .map(
      (p) =>
        `| ${p.club} | ${p.fcId} | ${p.playerId} | ${p.name} | ${p.trainee ? '训练营' : '正式'} | ${p.releaseFee} | ${p.wage} | ${p.serviceYears} | ${p.serviceTicks} | ${p.protectionTicks ?? '—'} |`,
    )
    .join('\n');
  const report =
    `# S9 合同导入报告（巴塞罗那 / RB 莱比锡）\n\n` +
    `生成时点：${TS}（该时点即 contracts.signed_at 的批次标记，回滚按它精确删）\n` +
    `源 CSV：${SRC}\n` +
    `当前刻度：ticks=${ticks}（已关常规窗数）⇒ service_ticks = ${ticks} − 2 × 效力年；protection_ticks = service_ticks + ${PROTECTION_TICKS}（训练营 NULL）\n` +
    `语句数：${stmts.length}（巴萨 ${planned.filter((p) => p.club === '巴塞罗那').length} 行 / 莱比锡 ${planned.filter((p) => p.club === 'RB莱比锡').length} 行；训练营 ${planned.filter((p) => p.trainee).length} 行）\n\n` +
    `## 执行\n\n` +
    '```\n' +
    `node exec-shards.mjs sql/01-precheck.sql --remote          # 期望 55 / 0 / 1 / 0\n` +
    `node exec-shards.mjs sql/02-contracts.sql --remote --retry=3  # 期望 55 条 → changes 合计 55\n` +
    `node exec-shards.mjs sql/03-verify.sql --remote            # 期望 55 / 6 / 0 / 0\n` +
    `node gen-cpu-contracts-sql.ts --verify                     # 逐列复核，期望「残留差异 0」\n` +
    '```\n' +
    `回滚：\`node exec-shards.mjs rollback/01-rollback.sql --remote\`（按 signed_at=${TS} 精确删）\n\n` +
    `## 逐行明细（${planned.length} 行）\n\n` +
    `| 队 | fc_id | player_id | 球员 | 类型 | 违约金 | 工资 | 效力年 | service_ticks | protection_ticks |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${table}\n\n` +
    `## 工件摘要\n\n` +
    Object.entries(manifest.files)
      .map(([f, h]) => `- \`${f}\` sha256 \`${h}\``)
      .join('\n') +
    '\n\n本批跳过的 CSV 队行：' +
    Object.entries(skipped)
      .map(([c, n]) => `${c} ${n}`)
      .join('、') +
    '\n';
  writeFileSync(join(HERE, 'contracts-report.md'), report);

  console.log(`生成完毕：${stmts.length} 条 INSERT、ticks=${ticks}、训练营 ${planned.filter((p) => p.trainee).length} 行`);
  console.log(`sql/01-precheck.sql  sql/02-contracts.sql  sql/03-verify.sql  rollback/01-rollback.sql  sql/manifest.json  contracts-report.md`);
}

main();
