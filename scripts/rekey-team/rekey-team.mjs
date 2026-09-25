#!/usr/bin/env node
// 换队号 rekey 预演工具（v2.3.0）：给定旧/新游戏队号，对三库做只读预演核查，
// 产出米兰口径的分步 SQL 工件 + 执行 README。工具本身不做任何写操作，
// 真正执行用 README 里印好的 wrangler d1 execute 命令（生产执行等管理组明确下令）。
//
// 用法：
//   node scripts/rekey-team/rekey-team.mjs --old 47 --new 131681 \
//     [--guard 'AC米兰(CPU)'] [--touch-club] [--remote] [--out DIR]
//
//   --old / --new   旧、新游戏队号（正整数，必填）
//   --guard         auth UPDATE 的 name 守卫（建议总是带上，防新号将来被别的队占用时误改）
//   --touch-club    换壳模式：clubs.id 也要从 old 搬到 new（club 库子表一起生成 03 工件）；
//                   默认收口模式（米兰口径）：平台 clubs.id 已是新号，只动 tour 与 auth
//   --remote        预演查生产（默认 --local，用本地 miniflare 状态演练）
//   --out           工件输出目录（默认 scripts/prod-<日期>-rekey-<old>-to-<new>）
//
// 覆盖面（按列名发现，逐表计数）：
//   tour (whl)      ：所有 *_team_id 列 + team.id 父行
//   auth (whl-auth) ：team.tour_team_id、team.club_id
//   club (whl-club) ：所有 *_club_id 列 + home_team_id/away_team_id/winner_team + clubs.id 父行
//   只报数不改的撞号列：audit_log.target_id 等任意 *_target_id / *_user_id（撞号高发，永远不生成 UPDATE）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const OLD = Number(flag('old'));
const NEW = Number(flag('new'));
const GUARD = typeof flag('guard') === 'string' ? flag('guard') : undefined;
const TOUCH_CLUB = flag('touch-club') !== undefined;
const REMOTE = flag('remote') !== undefined;
const OUT = typeof flag('out') === 'string' ? flag('out') : `scripts/prod-${new Date().toISOString().slice(0, 10)}-rekey-${OLD}-to-${NEW}`;

if (!Number.isInteger(OLD) || OLD <= 0 || !Number.isInteger(NEW) || NEW <= 0) {
  console.error('用法：node rekey-team.mjs --old <旧队号> --new <新队号> [--guard 队名] [--touch-club] [--remote] [--out DIR]');
  process.exit(1);
}

// 三库的 wrangler d1 数据库名与执行目录（auth 在 auth 仓执行是米兰口径的既有习惯；
// --auth-cwd 可覆盖）。本地演练一律在 club 仓根目录跑。
const DBS = {
  // checkCol：该库里「游戏队号」落在哪一列——auth 的 team.id 是内部序号（1..20），
  // 唯一性约束在 tour_team_id（register upsert 的冲突键）与 club_id 上，不能查 id
  tour: { name: 'whl', cwd: process.cwd(), parent: 'team', checkCol: 'id' },
  // auth 的执行目录：生产（--remote）在 auth 仓跑（米兰口径）；本地演练在 club 仓跑——
  // miniflare 本地状态按项目存放，只有 club 仓的 .wrangler/state 里有 whl-auth 的本地副本
  auth: {
    name: 'whl-auth',
    cwd: REMOTE ? resolve(process.cwd(), flag('auth-cwd') ?? '../WHL-auth-service') : process.cwd(),
    parent: 'team',
    checkCol: 'tour_team_id',
  },
  club: { name: 'whl-club', cwd: process.cwd(), parent: 'clubs', checkCol: 'id' },
};

/** 跑一条只读 SQL，返回行数组（wrangler --json 的输出是 [{results, success}]） */
function query(db, sql, attempt = 1) {
  // 不走 npx/cmd 壳：Windows 上 shell:true 会把带空格的 SQL 打碎，shell:false 又拒跑 .cmd——
  // 直接用 node 执行 wrangler 的 JS 入口（两仓各自 node_modules 里都有，任选存在的那个）
  const wranglerJs = ['node_modules/wrangler/bin/wrangler.js', '../WHL-auth-service/node_modules/wrangler/bin/wrangler.js']
    .map((p) => resolve(process.cwd(), p))
    .find((p) => existsSync(p));
  try {
    const out = execFileSync(
      process.execPath,
      [wranglerJs, 'd1', 'execute', db.name, REMOTE ? '--remote' : '--local', '--json', '--command', sql],
      { cwd: db.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed.flatMap((r) => r.results ?? []) : (parsed[0]?.results ?? []);
  } catch (e) {
    // wrangler 本地起 workerd 偶发 "fetch failed"（Windows 实测），退 2 秒重试，最多三次
    if (attempt < 3 && /fetch failed|ECONNRESET/i.test(String(e.output ?? e))) {
      execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)']);
      return query(db, sql, attempt + 1);
    }
    throw e;
  }
}

function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`可疑标识符：${name}`);
  return name;
}

/** 从 CREATE TABLE 里抠列名（首个 token），跳过表级约束行；
 *  按括号深度切逗号——PRIMARY KEY (a, b) 里的逗号不是列分隔符（实测 registrations 撞过） */
function columnsOf(createSql) {
  const inner = createSql.slice(createSql.indexOf('(') + 1, createSql.lastIndexOf(')'));
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    cur += ch;
    if (ch === ',' && depth === 0) {
      parts.push(cur.slice(0, -1));
      cur = '';
    }
  }
  parts.push(cur);
  return parts
    .map((line) => line.trim().split(/\s+/)[0]?.replace(/^["`[]|["`\]]$/g, ''))
    .filter((c) => c && !/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(c));
}

const teamIdCol = (c) => c === 'team_id' || c === 'home_team_id' || c === 'away_team_id' || c === 'winner_team';
const clubIdCol = (c) => c === 'club_id' || c === 'home_club_id' || c === 'away_club_id';

// ---------- 逐库预演 ----------
const report = [];
const plan = {}; // plan[dbKey] = { parentRow, updates: [{table, col, rows}], blocked: [...] }

for (const [key, db] of Object.entries(DBS)) {
  if (key === 'club' && !TOUCH_CLUB) {
    report.push(`\n【club 库（whl-club）】收口模式跳过（--touch-club 可开启换壳模式）`);
    continue;
  }
  const tables = query(db, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  const triggers = query(db, "SELECT name FROM sqlite_master WHERE type IN ('trigger','view')");
  const cols = new Map(tables.map((t) => [ident(t.name), columnsOf(t.sql ?? '')]));

  // 父行现状：old/new 是否存在、是否撞号（auth 按 tour_team_id 查，tour/club 按主键 id 查）
  const parent = db.parent;
  const checkCol = db.checkCol;
  const parentRows = query(
    db,
    `SELECT ${ident(checkCol)} AS id FROM ${ident(parent)} WHERE ${ident(checkCol)} IN (${OLD}, ${NEW})`,
  );
  const oldRow = parentRows.find((r) => Number(r.id) === OLD);
  const newRow = parentRows.find((r) => Number(r.id) === NEW);

  // 引用列清单：tour=*_team_id、club=*(_)club_id/赛果三列；auth 特殊处理
  let refTargets; // [{table, col}]
  if (key === 'auth') {
    refTargets = [{ table: 'team', col: 'tour_team_id' }, ...(TOUCH_CLUB ? [{ table: 'team', col: 'club_id' }] : [])];
  } else {
    refTargets = [];
    for (const [table, cs] of cols) {
      for (const c of cs) {
        if (table === parent && c === 'id') continue;
        if (key === 'tour' && teamIdCol(c)) refTargets.push({ table, col: c });
        if (key === 'club' && (clubIdCol(c) || c === 'winner_team')) refTargets.push({ table, col: c });
      }
    }
  }
  // 撞号高发列（target_id 之类）只报数
  const blockedTargets = [];
  for (const [table, cs] of cols) {
    for (const c of cs) {
      if (/_target_id$/.test(c) || c === 'target_id') blockedTargets.push({ table, col: c });
    }
  }

  // 计数探针：D1 的 UNION ALL 复合查询上限极低（实测 8 条就拒），改用标量子查询并列——
  // 表.列 编进列别名，一条语句最多 100 个探针，分批
  const probes = [...refTargets, ...blockedTargets];
  const counts = new Map();
  for (let i = 0; i < probes.length; i += 100) {
    const batch = probes.slice(i, i + 100);
    const row = query(
      db,
      `SELECT ${batch.map(({ table, col }) => `(SELECT COUNT(*) FROM ${ident(table)} WHERE ${ident(col)} = ${OLD}) AS '${ident(table)}.${ident(col)}'`).join(', ')}`,
    )[0] ?? {};
    for (const { table, col } of batch) counts.set(`${table}.${col}`, Number(row[`${table}.${col}`] ?? 0));
  }

  const updates = refTargets.map(({ table, col }) => ({ table, col, rows: counts.get(`${table}.${col}`) ?? 0 }));
  plan[key] = { db, parent, oldRow, newRow, updates, blocked: blockedTargets.map(({ table, col }) => ({ table, col, rows: counts.get(`${table}.${col}`) ?? 0 })) };

  report.push(`\n【${key} 库（${db.name}${REMOTE ? '，生产' : '，本地演练'}）】`);
  report.push(`  触发器/视图：${triggers.length ? triggers.map((t) => t.name).join(', ') + '（生成 SQL 前需人工确认）' : '无'}`);
  report.push(`  ${parent}.${checkCol}：${OLD} ${oldRow ? '存在' : '不存在'}；${NEW} ${newRow ? `已被占用——冲突！` : '未被占用'}`);
  for (const u of updates) report.push(`  ${u.table}.${u.col}：${u.rows} 行${u.rows ? ' → 生成 UPDATE' : ''}`);
  for (const b of plan[key].blocked) if (b.rows) report.push(`  ⚠ ${b.table}.${b.col}：${b.rows} 行——撞号高发列，只报数不生成 SQL`);
}

// ---------- 核查硬闸 ----------
const errors = [];
for (const [key, p] of Object.entries(plan)) {
  if (!p) continue;
  if (!p.oldRow) errors.push(`${key} 库：${p.parent} 里没有 ${OLD} 这一行（按 ${p.db.checkCol} 查），无需/无法重键`);
  if (p.newRow) errors.push(`${key} 库：目标 ${NEW} 已被占用（${p.parent}.${p.db.checkCol}），先解决冲突`);
}
if (errors.length) {
  console.error('\n=== 预演未通过，不产出工件 ===');
  for (const e of errors) console.error('✗ ' + e);
  console.error(report.join('\n'));
  process.exit(2);
}
// 换壳模式附加闸：auth 的 club_id 也有 UNIQUE——tour_team_id 空闲但 club_id 被别的行占着，
// 执行期才会炸，必须在预演就拦下
if (TOUCH_CLUB && plan.auth?.oldRow) {
  const clash = query(plan.auth.db, `SELECT id FROM ${ident(plan.auth.db.parent)} WHERE club_id = ${NEW} AND tour_team_id <> ${OLD}`);
  if (clash.length) {
    console.error(`\n=== 预演未通过，不产出工件 ===\n✗ auth 库：club_id=${NEW} 已被别的行占用（换壳模式撞 UNIQUE），先解决冲突`);
    process.exit(2);
  }
}

// ---------- 生成 SQL 工件（米兰口径：tour 先子后父 + defer；auth 单行带守卫；club 同 tour） ----------
const guardSql = GUARD ? ` AND name = '${GUARD.replaceAll("'", "''")}'` : '';
function childUpdates(key, p) {
  // tour/club 的子表即使 0 行也写上（幂等保障，米兰口径）；auth 本就只有 team 两行
  return p.updates
    .filter((u) => u.rows > 0 || key !== 'auth')
    .map((u) => `UPDATE ${ident(u.table)} SET ${ident(u.col)} = ${NEW} WHERE ${ident(u.col)} = ${OLD};`)
    .join('\n');
}

const files = {};
if (plan.tour) {
  files['01-tour-rekey-team-id.sql'] = `-- tour 库（${DBS.tour.name}）队号统一：${OLD} → ${NEW}
-- 由 scripts/rekey-team/rekey-team.mjs 预演生成（${REMOTE ? '生产' : '本地'}核查通过），人工复核后再执行。
-- 期望 changes：${['team 1 行', ...plan.tour.updates.map((u) => `${u.table} ${u.rows} 行`)].join('；')}。
-- 回滚：同结构反向 UPDATE（${NEW} → ${OLD}），同样必须带 PRAGMA defer_foreign_keys = ON 走 --command。

PRAGMA defer_foreign_keys = ON;
${childUpdates('tour', plan.tour)}
UPDATE ${DBS.tour.parent} SET id = ${NEW} WHERE id = ${OLD};`;
}
if (plan.auth) {
  files['02-auth-tour-team-id.sql'] = `-- auth 库（${DBS.auth.name}）team.tour_team_id ${OLD} → ${NEW}${TOUCH_CLUB ? '，club_id 同步' : ''}
-- 由 scripts/rekey-team/rekey-team.mjs 预演生成。tour_team_id 是「赛事系统队 → 平台俱乐部」的桥。
-- 期望 changes：${TOUCH_CLUB ? '2 行（tour_team_id 1 行 + club_id 1 行）' : '1 行'}。
-- 回滚：UPDATE team SET tour_team_id = ${OLD} WHERE tour_team_id = ${NEW}${guardSql};${TOUCH_CLUB ? `\n--        UPDATE team SET club_id = ${OLD} WHERE club_id = ${NEW}${guardSql};` : ''}

UPDATE team SET tour_team_id = ${NEW} WHERE tour_team_id = ${OLD}${guardSql};${TOUCH_CLUB ? `\nUPDATE team SET club_id = ${NEW} WHERE club_id = ${OLD}${guardSql};` : ''}`;
}
if (plan.club) {
  files['03-club-rekey-clubs-id.sql'] = `-- club 库（${DBS.club.name}）换壳：clubs.id ${OLD} → ${NEW}，子表一并搬运（--touch-club 模式）
-- 由 scripts/rekey-team/rekey-team.mjs 预演生成。必须走 --command（defer_foreign_keys 只在该通道生效）。
-- 期望 changes：${['clubs 1 行', ...plan.club.updates.filter((u) => u.rows > 0).map((u) => `${u.table} ${u.rows} 行`)].join('；')}。
-- 回滚：同结构反向 UPDATE（${NEW} → ${OLD}），同样带 PRAGMA defer_foreign_keys = ON。

PRAGMA defer_foreign_keys = ON;
${childUpdates('club', plan.club)}
UPDATE ${DBS.club.parent} SET id = ${NEW} WHERE id = ${OLD};`;
}

// ---------- 落盘 ----------
mkdirSync(OUT, { recursive: true });
for (const [name, sql] of Object.entries(files)) writeFileSync(join(OUT, name), sql + '\n');
const execLines = [];
if (files['01-tour-rekey-team-id.sql']) {
  execLines.push(`| tour 重键 | \`npx wrangler d1 execute whl ${REMOTE ? '--remote' : '--local'} --command "<01 文件去掉注释后的语句序列>"\` | 待执行 |`);
}
if (files['02-auth-tour-team-id.sql']) {
  execLines.push(`| auth 重键 | \`npx wrangler d1 execute whl-auth ${REMOTE ? '--remote' : '--local'} --file ${resolve(OUT, '02-auth-tour-team-id.sql')}\`（在 ${DBS.auth.cwd}） | 待执行 |`);
}
if (files['03-club-rekey-clubs-id.sql']) {
  execLines.push(`| club 换壳 | \`npx wrangler d1 execute whl-club ${REMOTE ? '--remote' : '--local'} --command "<03 文件去掉注释后的语句序列>"\` | 待执行 |`);
}
writeFileSync(
  join(OUT, 'README.md'),
  `# 队号重键 ${OLD} → ${NEW}（${new Date().toISOString().slice(0, 10)}，${REMOTE ? '生产' : '本地演练'}工件）

由 \`scripts/rekey-team/rekey-team.mjs\` 预演生成，口径同 \`scripts/prod-20260919-milan-rekey\`。

## 预演核查结果

\`\`\`
${report.join('\n')}
\`\`\`

## 执行方式（${REMOTE ? '生产：执行需管理组明确下令' : '本地演练'}）

硬约束：D1 的 \`PRAGMA defer_foreign_keys = ON\` 只在 \`--command\` / REST \`/query\` 通道生效，\`--file\` 通道会 FK 失败整批回滚。auth 侧单行 UPDATE 无 defer 需求，\`--file\` 也可以。

| 步骤 | 命令 | 实测 |
|---|---|---|
${execLines.join('\n')}

## 回滚

各 SQL 文件头注释带反向语句；auth 反向 UPDATE 带 name 守卫（${GUARD ?? '未设守卫——建议补 --guard 重新生成'}）。
`,
);
console.log(report.join('\n'));
console.log(`\n=== 预演通过，工件已写入 ${OUT}/ ===`);
console.log(Object.keys(files).map((f) => '  ' + f).join('\n'));
