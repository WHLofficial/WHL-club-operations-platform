// S9 全员注册批（20 队全写：一线队 + 训练营）离线 SQL 生成器
//
// 缘起：用户 2026-10-05 令「将所有队的球员都注册完毕」。口径（计划 plan-trainee-play-allowance.md §2.2）：
//   训练营名单 = 持训练营合同（contracts.contract_type='trainee'、is_active=1）的球员；
//   同队其余全部一线队；20 队全写（CPU 两队 AC米兰 131681 / 曼城 10 无训练营合同，全部一线队）。
//
// 本生成器只做两件事：
//   ① 从**生产只读**取数（wrangler d1 execute --remote 的 SELECT；绝不发任何写语句）；
//   ② 产出 sql/（预检 / 写批 / 验收）+ rollback/ + sql/manifest.json + report.md 供人工执行。
//   真执行由 exec-shards.mjs 在人工显式 --yes 下完成（本批默认 dry-run）。
//
// 写入内容（registrations 快照整体替换 + 训练营状态）：
//   sql/02-registrations.sql  DELETE（season + 本批 20 队）清底 + 每队一条多行 INSERT OR IGNORE
//     （registrations PK = season+club_id+player_id；OR IGNORE 让整文件重跑幂等，可 --retry）
//   sql/03-status-trainee.sql UPDATE players SET status='trainee'（69 人显式 id 清单，
//     与 POST /api/club/registrations 落库段同形；带 club_id 与 status 守卫防误伤）
//   守卫口径：DELETE 限 season+club；UPDATE 带 status IN ('normal', 'listed') + club_id IN。
//
// ⚠️ 顺序铁律（见 README §2）：写批前必须先把自己侧 config 的 squads_include_trainee 置 true，
//   否则 69 人 status 改 trainee 后赛事仓下个整点同步会把他们从 tour 删掉。
//
// 通道纪律（scripts/README.md）：语句折叠成单行走 --command；语句内不得出现 shell 元字符
//   （" % & | < >）——本生成器的语句只含数字、单引号枚举与注释，已自检。
//
// 用法：
//   node gen-registrations-sql.mjs            读生产只读，生成 sql/ + rollback/ + manifest + report.md
//   node gen-registrations-sql.mjs --verify   只读复核：把生产现状与 sql/manifest.json 对比（漂移检测，无写）
//   node gen-registrations-sql.mjs --local    读本地 D1（演练用；本地夹具人数不齐会触发守卫，属正常）

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const LOCAL = FLAGS.has('--local');
const VERIFY = FLAGS.has('--verify');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SQL_DIR = join(HERE, 'sql');
const RB_DIR = join(HERE, 'rollback');
const MANIFEST_PATH = join(SQL_DIR, 'manifest.json');
const DB = 'whl-club';
const TS = new Date().toISOString();

// 计划 §2.2c 的逐队拆分（[队名, 总人数, 训练营人数]）——只用于生成时对账提示；
// 实际数据不符时以生产为准，差异写进 report.md，不阻断生成。
const PLAN_SPLIT = [
  ['阿森纳', 30, 4],
  ['阿斯顿维拉', 30, 0],
  ['奥林匹亚科斯', 30, 4],
  ['巴黎圣日耳曼', 29, 5],
  ['巴塞罗那', 29, 6],
  ['拜仁慕尼黑', 37, 7],
  ['佛罗伦萨', 31, 8],
  ['皇家贝蒂斯', 25, 5],
  ['皇家马德里', 23, 1],
  ['里昂', 31, 4],
  ['利物浦', 37, 5],
  ['曼城(CPU)', 28, 0],
  ['曼联', 25, 2],
  ['慕尼黑1860', 26, 3],
  ['纽卡斯尔联', 23, 4],
  ['诺丁汉森林', 23, 2],
  ['切尔西', 31, 5],
  ['尤文图斯', 31, 4],
  ['AC米兰(CPU)', 25, 0],
  ['RB莱比锡', 26, 0],
];
const EXPECTED_TOTAL = 570;
const EXPECTED_TRAINEE = 69;

// ---------------------------------------------------------------- 只读通道

/** 只读查询：wrangler d1 execute --json（生产偶发子进程崩溃 ⇒ 重试 3 次；绝不写）。 */
function d1(sql) {
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
      if (m?.index != null) return JSON.parse((res.stdout ?? '').slice(m.index))[0]?.results ?? [];
      last = '输出里没有行首 [ 的 JSON';
    } else last = (res.stderr || res.stdout || '').slice(0, 300);
  }
  throw new Error(`D1 只读查询失败：${sql}\n${last}`);
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------- 取数（全部只读）

function loadSeason() {
  const rows = d1("SELECT season FROM seasons WHERE status = 'preparing' ORDER BY season DESC LIMIT 1");
  if (!rows.length) {
    console.error('生产 seasons 表没有 status = preparing 的赛季，不能生成（先建赛季）。');
    process.exit(4);
  }
  return Number(rows[0].season);
}

function loadClubs() {
  return d1('SELECT id, name, is_cpu FROM clubs ORDER BY id').map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    isCpu: Number(r.is_cpu) === 1,
  }));
}

function loadRoster(clubIds) {
  return d1(
    `SELECT p.id, p.club_id, p.fc_id, p.name, p.status, p.growable, p.ca, p.pa, ct.contract_type AS ct_type ` +
      `FROM players p LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 ` +
      `WHERE p.club_id IN (${clubIds.join(', ')}) AND p.status IN ('normal', 'listed') ORDER BY p.club_id, p.id`,
  );
}

/** 活跃合同数（按 player 聚合；HAVING 里的比较放 JS，避免 SQL 出现 shell 元字符）。 */
function loadActiveCounts(clubIds) {
  const rows = d1(
    `SELECT ct.player_id AS player_id, COUNT(*) AS n FROM contracts ct WHERE ct.is_active = 1 ` +
      `AND ct.player_id IN (SELECT id FROM players WHERE club_id IN (${clubIds.join(', ')})) GROUP BY ct.player_id`,
  );
  return new Map(rows.map((r) => [Number(r.player_id), Number(r.n)]));
}

/** 本批 20 队里所有持训练营合同的球员（不管当前 status——用于核对训练营名单是否全在名册内）。 */
function loadTraineeContractIds(clubIds) {
  const rows = d1(
    `SELECT p.id AS id FROM players p JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 ` +
      `AND ct.contract_type = 'trainee' WHERE p.club_id IN (${clubIds.join(', ')})`,
  );
  return rows.map((r) => Number(r.id));
}

/** club_id 落在本批 20 队、但 status 不在 ('normal','listed') 的球员（不应参与注册；应恒为空）。 */
function loadExcluded(clubIds) {
  return d1(
    `SELECT p.id, p.club_id, p.status FROM players p WHERE p.club_id IN (${clubIds.join(', ')}) ` +
      `AND p.status NOT IN ('normal', 'listed') ORDER BY p.club_id, p.id`,
  );
}

// ---------------------------------------------------------------- 计划

function buildPlan() {
  const clubs = loadClubs();
  if (clubs.length !== 20) {
    console.error(`clubs 表应有 20 行，实际 ${clubs.length} 行——本批范围变了，先核对再生成。`);
    process.exit(3);
  }
  const clubIds = clubs.map((c) => c.id);
  const season = loadSeason();
  const raw = loadRoster(clubIds);
  const counts = loadActiveCounts(clubIds);
  const traineeContractIds = loadTraineeContractIds(clubIds);
  const excluded = loadExcluded(clubIds);

  const rows = raw.map((r) => ({
    playerId: Number(r.id),
    clubId: Number(r.club_id),
    fcId: r.fc_id == null ? null : Number(r.fc_id),
    name: String(r.name),
    status: String(r.status),
    ct: r.ct_type == null || String(r.ct_type) === '' ? null : String(r.ct_type),
    growable: Number(r.growable) === 1,
    ca: r.ca == null ? null : Number(r.ca),
    pa: r.pa == null ? null : Number(r.pa),
    squad: String(r.ct_type) === 'trainee' ? 'trainee' : 'first_team',
  }));

  if (rows.length === 0) {
    console.error('名册为空（0 行），数据源或队籍不对，停止生成。');
    process.exit(5);
  }

  // 完整性守卫：一个球员同时有多份活跃合同 ⇒ 训练营判定有歧义，先人工处理。
  const multi = rows.filter((r) => (counts.get(r.playerId) ?? 0) > 1);
  if (multi.length) {
    console.error(`有 ${multi.length} 名球员存在多份活跃合同（训练营判定有歧义），先处理：`);
    for (const m of multi) console.error(`  player_id ${m.playerId} ${m.name}（合同数 ${counts.get(m.playerId)}）`);
    process.exit(6);
  }
  // 完整性守卫：持训练营合同但不在名册内（status 非 normal/listed）⇒ 批内口径不自洽。
  const inRoster = new Set(rows.map((r) => r.playerId));
  const outside = traineeContractIds.filter((id) => !inRoster.has(id));
  if (outside.length) {
    console.error(`有 ${outside.length} 名持训练营合同的球员不在（normal/listed）名册内，先核对其 status：${outside.join(', ')}`);
    process.exit(7);
  }

  const traineeRows = rows.filter((r) => r.squad === 'trainee');
  const growthBad = traineeRows.filter((r) => !(r.growable && r.ca !== null && r.pa !== null && r.pa > r.ca));

  // 合同类型分布（对账用；'trainee' 即训练营，其余含 NULL=无合同）。
  const contractDist = {};
  for (const r of rows) {
    const k = r.ct ?? '无合同';
    contractDist[k] = (contractDist[k] ?? 0) + 1;
  }

  return { clubs, season, rows, traineeRows, excluded, growthBad, contractDist };
}

// ---------------------------------------------------------------- SQL 工件

function buildArtifacts(plan) {
  const { clubs, season, rows, traineeRows } = plan;
  const clubIds = clubs.map((c) => c.id);
  const clubIn = clubIds.join(', ');
  const traineeIds = traineeRows.map((r) => r.playerId);

  const precheckSql =
    [
      '-- 预检（只读）：期望 clubs_n=20 / roster_now=570 / trainee_contracts_now=69 / registrations_now=0 / status 全 normal',
      '-- config 段是当前开关与豁免状态：写批前 squads_include_trainee 必须已为 true（顺序铁律，见 README §2）',
      "SELECT season FROM seasons WHERE status = 'preparing' ORDER BY season DESC LIMIT 1;",
      "SELECT COUNT(*) AS preparing_n FROM seasons WHERE status = 'preparing';",
      'SELECT COUNT(*) AS clubs_n FROM clubs;',
      `SELECT COUNT(*) AS roster_now FROM players WHERE club_id IN (${clubIn}) AND status IN ('normal', 'listed');`,
      `SELECT COUNT(*) AS trainee_contracts_now FROM players p JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 AND ct.contract_type = 'trainee' WHERE p.club_id IN (${clubIn});`,
      `SELECT COUNT(*) AS registrations_now FROM registrations WHERE season = ${season} AND club_id IN (${clubIn});`,
      `SELECT COUNT(*) AS registrations_season FROM registrations WHERE season = ${season};`,
      `SELECT status, COUNT(*) AS n FROM players WHERE club_id IN (${clubIn}) GROUP BY status;`,
      "SELECT key, value FROM config WHERE key IN ('squads_include_trainee', 'squad_min', 'squad_max', 'trainee_max', 'ca_pa_limits', 'registration_check_mode') ORDER BY key;",
    ].join('\n') + '\n';

  const deleteStmt = `DELETE FROM registrations WHERE season = ${season} AND club_id IN (${clubIn});`;
  const insertStmts = clubs.map((c) => {
    const mine = rows.filter((r) => r.clubId === c.id);
    const tuples = mine.map((r) => `(${season}, ${c.id}, ${r.playerId}, '${r.squad}')`).join(', ');
    const first = mine.filter((r) => r.squad === 'first_team').length;
    return `-- 队 ${c.name}（id ${c.id}）：一线队 ${first} + 训练营 ${mine.length - first} = ${mine.length}\nINSERT OR IGNORE INTO registrations (season, club_id, player_id, squad) VALUES ${tuples};`;
  });
  const registrationsSql =
    `-- 落库：${rows.length} 行（一线队 ${rows.length - traineeIds.length} + 训练营 ${traineeIds.length}），20 队各一条多行 INSERT。\n` +
    `-- 清底 DELETE 限 season=${season} + 本批 20 队；INSERT OR IGNORE 保证整文件重跑幂等（--retry 安全）。\n` +
    `${deleteStmt}\n` +
    insertStmts.join('\n') +
    '\n';

  const statusSql =
    `-- 训练营 ${traineeIds.length} 人：players.status 改 'trainee'（与 POST /api/club/registrations 落库段同形）。\n` +
    `-- 守卫：club_id IN（本批 20 队）+ status IN ('normal', 'listed')——批前被别人改过状态的球员不会被误写。\n` +
    `UPDATE players SET status = 'trainee', updated_at = '${TS}' WHERE id IN (${traineeIds.join(', ')}) AND club_id IN (${clubIn}) AND status IN ('normal', 'listed');\n`;

  const verifySql =
    [
      '-- 验收（只读）：期望 registrations_now=570 / trainee_rows=69 / first_team_rows=501 / players：normal 501 + trainee 69 / stray_rows=0',
      `SELECT COUNT(*) AS registrations_now FROM registrations WHERE season = ${season} AND club_id IN (${clubIn});`,
      `SELECT COUNT(*) AS trainee_rows FROM registrations WHERE season = ${season} AND club_id IN (${clubIn}) AND squad = 'trainee';`,
      `SELECT COUNT(*) AS first_team_rows FROM registrations WHERE season = ${season} AND club_id IN (${clubIn}) AND squad = 'first_team';`,
      `SELECT club_id, COUNT(*) AS total, SUM(squad = 'trainee') AS trainee, SUM(squad = 'first_team') AS first_team FROM registrations WHERE season = ${season} AND club_id IN (${clubIn}) GROUP BY club_id ORDER BY club_id;`,
      `SELECT status, COUNT(*) AS n FROM players WHERE club_id IN (${clubIn}) GROUP BY status;`,
      `SELECT COUNT(*) AS stray_rows FROM registrations WHERE season != ${season} OR club_id NOT IN (${clubIn});`,
    ].join('\n') + '\n';

  const rollbackSql =
    `-- 回滚（本批专用）：① 删本批 20 队该赛季全部 registrations 行；② 本批 ${traineeIds.length} 名训练营球员 status 还原 'normal'。\n` +
    `-- 守卫：DELETE 限 season=${season}+club_id；status 还原限显式 id 清单（不用 contract_type 反查——批后状态已变）\n` +
    `-- 且要求 status='trainee'（批后又被其他流程改过的行不覆盖）。\n` +
    `DELETE FROM registrations WHERE season = ${season} AND club_id IN (${clubIn});\n` +
    `UPDATE players SET status = 'normal', updated_at = '${TS}' WHERE id IN (${traineeIds.join(', ')}) AND status = 'trainee';\n`;

  return { precheckSql, registrationsSql, statusSql, verifySql, rollbackSql, traineeIds, clubIn, season };
}

// ---------------------------------------------------------------- 对账 / 报告

function splitRowsByClub(plan) {
  return plan.clubs.map((c) => {
    const mine = plan.rows.filter((r) => r.clubId === c.id);
    const trainee = mine.filter((r) => r.squad === 'trainee').length;
    return { id: c.id, name: c.name, isCpu: c.isCpu, total: mine.length, trainee, firstTeam: mine.length - trainee };
  });
}

function compareWithPlan(perClub) {
  const planByName = new Map(PLAN_SPLIT.map(([name, total, trainee]) => [name, { total, trainee }]));
  const diffs = [];
  for (const c of perClub) {
    const want = planByName.get(c.name);
    if (!want) {
      diffs.push(`${c.name}：计划里没有这支队`);
      continue;
    }
    if (want.total !== c.total || want.trainee !== c.trainee) {
      diffs.push(`${c.name}：实际 ${c.total}（一线队 ${c.firstTeam} + 训练营 ${c.trainee}）≠ 计划 ${want.total}（训练营 ${want.trainee}）`);
    }
  }
  const planNames = new Set(PLAN_SPLIT.map(([name]) => name));
  for (const c of perClub) planNames.delete(c.name);
  for (const missing of planNames) diffs.push(`计划里的 ${missing} 在实际数据中不存在`);
  return diffs;
}

function buildReport(plan, art, artifactFiles, planDiffs) {
  const perClub = splitRowsByClub(plan);
  const totalTrainee = plan.traineeRows.length;
  const totalRows = plan.rows.length;
  const cpu = perClub.filter((c) => c.isCpu);
  const splitTable = perClub
    .map((c) => {
      const want = PLAN_SPLIT.find(([name]) => name === c.name);
      const diff = want && want[1] === c.total && want[2] === c.trainee ? '✓' : '⚠ 见下方差异清单';
      return `| ${c.name}${c.isCpu ? '（CPU）' : ''} | ${c.id} | ${c.total} | ${c.firstTeam} | ${c.trainee} | ${want ? `${want[1]}（训练营 ${want[2]}）` : '—'} | ${diff} |`;
    })
    .join('\n');
  const traineeByClub = plan.clubs
    .map((c) => {
      const mine = plan.rows.filter((r) => r.clubId === c.id && r.squad === 'trainee');
      if (!mine.length) return null;
      return `### ${c.name}（${c.id}）：${mine.length} 人\n\n` +
        `| player_id | fc_id | 姓名 |\n| --- | --- | --- |\n` +
        mine.map((r) => `| ${r.playerId} | ${r.fcId ?? '—'} | ${r.name} |`).join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
  const fileList = Object.entries(artifactFiles)
    .map(([f, h]) => `- \`${f}\` sha256 \`${h}\``)
    .join('\n');
  const contractDist = Object.entries(plan.contractDist)
    .map(([k, n]) => `${k} ${n}`)
    .join(' / ');

  return (
    `# S9 全员注册批报告（20 队全写：一线队 + 训练营）\n\n` +
    `生成时点：${TS}（同为 \`players.updated_at\` 的批标记）\n` +
    `数据源：生产 whl-club **只读**（wrangler d1 execute --remote 的 SELECT，未发任何写语句）\n` +
    `目标赛季：season=${art.season}（seasons.status='preparing' 最新一条）\n` +
    `口径：训练营 = 持训练营合同（contracts.contract_type='trainee'、is_active=1）⇒ registrations.squad='trainee'；\n` +
    `同队其余 = 'first_team'；训练营球员同时写 players.status='trainee'。\n\n` +
    `## 总计\n\n` +
    `- 20 队 **${totalRows} 行** registrations（first_team ${totalRows - totalTrainee} + trainee ${totalTrainee}）\n` +
    `- 训练营 **${totalTrainee} 人**；写 status='trainee' 的 id 清单见 \`sql/03-status-trainee.sql\`\n` +
    `- CPU 两队单列：` +
    cpu.map((c) => `${c.name} ${c.total}（全一线队，训练营 ${c.trainee}）`).join('；') +
    '\n' +
    `- 训练营球员可成长且 PA−CA＞0（trainee_growth 口径）：${totalTrainee - plan.growthBad.length}/${totalTrainee}` +
    (plan.growthBad.length ? `，⚠ 例外：${plan.growthBad.map((r) => `${r.name}(${r.playerId})`).join('、')}` : '') +
    '\n' +
    `- 合同类型分布（注册口径）：${contractDist}\n` +
    `- club_id 落在本批 20 队但 status 不在 ('normal','listed') 的球员：${plan.excluded.length} 人` +
    (plan.excluded.length ? `（${plan.excluded.map((r) => `${r.id}:${r.status}`).join('、')}）` : '') +
    '\n\n' +
    `## 逐队拆分（实际 vs 计划 §2.2c）\n\n` +
    `| 队 | club_id | 总计 | 一线队 | 训练营 | 计划（总计） | 对账 |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
    splitTable +
    '\n\n' +
    (planDiffs.length
      ? `### 与计划的差异\n\n${planDiffs.map((d) => `- ⚠ ${d}`).join('\n')}\n\n`
      : `### 与计划的差异\n\n无——逐队与计划 §2.2c 完全一致。\n\n`) +
    `## 训练营 ${totalTrainee} 人明细（按队）\n\n${traineeByClub}\n\n` +
    `## 工件与哈希\n\n${fileList}\n\n` +
    `## 执行（人工，另等令）\n\n` +
    '```\n' +
    `node exec-shards.mjs sql/01-precheck.sql --remote --yes          # 只读预检，期望 20 / 570 / 69 / 0 且 status 全 normal\n` +
    `node exec-shards.mjs sql/02-registrations.sql --remote --yes --retry=3  # 写批①：DELETE 清底 + 570 行 INSERT（changes 合计 570）\n` +
    `node exec-shards.mjs sql/03-status-trainee.sql --remote --yes --retry=3 # 写批②：${totalTrainee} 人 status='trainee'（changes ${totalTrainee}）\n` +
    `node exec-shards.mjs sql/04-verify.sql --remote --yes            # 只读验收，期望 570 / ${totalTrainee} / ${totalRows - totalTrainee} / stray 0\n` +
    `node exec-shards.mjs rollback/01-rollback.sql --remote --yes     # 回滚（如需）：删 ${totalRows} 行 + ${totalTrainee} 人 status 回 normal\n` +
    '```\n\n' +
    `注意：\`--remote\` 不带 \`--yes\` 只打印批计划（dry-run）；写批前必须先翻 \`squads_include_trainee=true\`（顺序铁律）。\n` +
    `\`--verify\` 模式可把生产现状与本 manifest 逐行比对（漂移检测，只读）。\n`
  );
}

// ---------------------------------------------------------------- main

function main() {
  const plan = buildPlan();
  const art = buildArtifacts(plan);

  if (VERIFY) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const diffs = [];
    if (manifest.season !== art.season) diffs.push(`赛季：manifest ${manifest.season} ≠ 现库 ${art.season}`);
    const want = new Map(manifest.rows.map((r) => [`${r.clubId}:${r.playerId}`, r.squad]));
    const got = new Map(plan.rows.map((r) => [`${r.clubId}:${r.playerId}`, r.squad]));
    for (const [k, v] of want) {
      if (!got.has(k)) diffs.push(`manifest 有、现库无：${k}（${v}）`);
      else if (got.get(k) !== v) diffs.push(`squad 不一致：${k} manifest=${v} 现库=${got.get(k)}`);
    }
    for (const k of got.keys()) if (!want.has(k)) diffs.push(`现库有、manifest 无：${k}`);
    const a = [...manifest.traineeIds].sort((x, y) => x - y).join(',');
    const b = [...art.traineeIds].sort((x, y) => x - y).join(',');
    if (a !== b) diffs.push('训练营 id 清单不一致');
    console.log(
      `--verify（${LOCAL ? '本地' : '生产'}只读）：manifest ${manifest.rows.length} 行 / 现库 ${plan.rows.length} 行，差异 ${diffs.length}`,
    );
    for (const d of diffs) console.log(`  ${d}`);
    process.exit(diffs.length ? 1 : 0);
  }

  mkdirSync(SQL_DIR, { recursive: true });
  mkdirSync(RB_DIR, { recursive: true });

  const files = {
    'sql/01-precheck.sql': art.precheckSql,
    'sql/02-registrations.sql': art.registrationsSql,
    'sql/03-status-trainee.sql': art.statusSql,
    'sql/04-verify.sql': art.verifySql,
    'rollback/01-rollback.sql': art.rollbackSql,
  };
  const hashes = {};
  for (const [rel, text] of Object.entries(files)) {
    writeFileSync(join(HERE, rel), text);
    hashes[rel] = sha256(text);
  }

  const perClub = splitRowsByClub(plan);
  const planDiffs = compareWithPlan(perClub);
  const manifest = {
    ts: TS,
    season: art.season,
    source: 'wrangler d1 execute whl-club --remote（只读 SELECT）',
    totals: {
      clubs: plan.clubs.length,
      players: plan.rows.length,
      firstTeam: plan.rows.length - plan.traineeRows.length,
      trainee: plan.traineeRows.length,
    },
    files: hashes,
    clubs: perClub,
    traineeIds: art.traineeIds,
    rows: plan.rows.map((r) => ({
      clubId: r.clubId,
      playerId: r.playerId,
      fcId: r.fcId,
      name: r.name,
      squad: r.squad,
      ct: r.ct,
    })),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
  writeFileSync(join(HERE, 'report.md'), buildReport(plan, art, hashes, planDiffs));

  console.log(`生成完毕：${plan.rows.length} 行 registrations（训练营 ${plan.traineeRows.length}）、season=${art.season}、TS=${TS}`);
  console.log(`与计划 §2.2c 的差异：${planDiffs.length ? planDiffs.join('；') : '无'}`);
  console.log('sql/01-precheck.sql  sql/02-registrations.sql  sql/03-status-trainee.sql  sql/04-verify.sql  rollback/01-rollback.sql  sql/manifest.json  report.md');
}

main();
