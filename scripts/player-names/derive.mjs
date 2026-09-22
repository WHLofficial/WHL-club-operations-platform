#!/usr/bin/env node
/**
 * 球员显示名派生（增量 32 · 步骤 2）
 *
 * 输入（本机只读，路径写死在 SOURCES 里）
 *   base_players.csv  playerid + firstnameid / lastnameid / commonnameid（四个文本列全空，只能走字典）
 *   playernames.txt   nameid → 人名（UTF-16LE TSV）
 *   cards.csv         playerid → 完整人名（字典缺号 / 缺栏时的兜底）
 *
 * 远端只读查询（结果缓存在 data/*.json，--refresh 重拉；全部是 SELECT，不写任何数据）
 *   whl-club players（fc_id / name / club_id）
 *   whl      player（id / name / number / team_id）—— 赛事系统的球员 id 就是本库 fc_id
 *   whl-auth team  （tour_team_id ↔ club_id）
 *
 * 派生规则（与赛事系统 570 人口径逐字对齐，实测 570/570）
 *   commonname 原样
 *   || 「名 姓」（两栏都能在字典里查到）
 *   || cards.csv 的完整人名（字典缺号、缺栏时兜底；同 playerid 多行名字矛盾则弃用）
 *   || 空 —— 显示处 COALESCE(display_name, players.name) 回落到 FC26db 缩写名
 *
 * 产出（out/，不进版本库）
 *   display_name.sql   first_name / last_name / common_name / display_name 批量 UPDATE
 *   number.sql         球衣号 UPDATE（按 fc_id，绝不按名字匹配）
 *   display-names.csv  逐人审计表
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const OUT = path.join(HERE, 'out');
const SOURCES = {
  basePlayers: 'E:/FC26 LE v26.3.5/player_presets/base_players.csv',
  cards: 'E:/FC26 LE v26.3.5/player_presets/cards.csv',
  dict: 'E:/FST存档修改器编辑器v1.2.0/config/playernames.txt',
};
const BATCH = 1000;

const refresh = process.argv.includes('--refresh');

// ---------------------------------------------------------------- 远端只读查询

const REMOTE = {
  players: {
    db: 'whl-club',
    sql: 'SELECT fc_id, name, club_id FROM players ORDER BY fc_id',
  },
  'tour-players': {
    db: 'whl',
    sql: 'SELECT id, name, number, team_id FROM player ORDER BY id',
  },
  'team-map': {
    db: 'whl-auth',
    sql: 'SELECT club_id, tour_team_id FROM team ORDER BY tour_team_id',
  },
};

function remote(name) {
  const file = path.join(DATA, `${name}.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const { db, sql } = REMOTE[name];
  const raw = execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
  const rows = parsed.flatMap((r) => r.results ?? []);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));
  console.log(`  远端 ${db} → ${name}: ${rows.length} 行`);
  return rows;
}

// ---------------------------------------------------------------- 本机数据源

function readCsv(file, wanted) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const head = lines[0].split(',');
  const idx = {};
  for (const [key, col] of Object.entries(wanted)) {
    const i = head.indexOf(col);
    if (i < 0) throw new Error(`${path.basename(file)} 缺列 ${col}`);
    idx[key] = i;
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split(',');
    const row = {};
    for (const [key, j] of Object.entries(idx)) row[key] = f[j];
    rows.push(row);
  }
  console.log(`  ${path.basename(file)}: 表头 ${head.length} 列 / ${rows.length} 行`);
  return { head, rows };
}

function readDict(file) {
  const text = fs.readFileSync(file, 'utf16le').replace(/^\ufeff/, '');
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('\t');
    if (p.length < 2) continue;
    const id = Number(p[1]);
    if (!Number.isInteger(id)) continue;
    map.set(id, p[0].trim());
  }
  console.log(`  ${path.basename(file)}: ${map.size} 条（max nameid ${Math.max(...map.keys())}）`);
  return map;
}

// ---------------------------------------------------------------- 主流程

console.log('读本机数据源');
const base = readCsv(SOURCES.basePlayers, {
  pid: 'playerid',
  first: 'firstnameid',
  last: 'lastnameid',
  common: 'commonnameid',
});
const cards = readCsv(SOURCES.cards, { pid: 'playerid', name: 'name' });
const dict = readDict(SOURCES.dict);

const nameOf = (id) => (id && Number(id) !== 0 ? dict.get(Number(id)) ?? '' : '');

const fc26 = new Map();
for (const r of base.rows) {
  fc26.set(Number(r.pid), {
    first: nameOf(r.first),
    last: nameOf(r.last),
    common: nameOf(r.common),
  });
}

const cardName = new Map();
const cardConflicts = new Set();
for (const r of cards.rows) {
  const pid = Number(r.pid);
  const name = (r.name ?? '').trim();
  if (!name) continue;
  if (cardName.has(pid) && cardName.get(pid) !== name) cardConflicts.add(pid);
  else cardName.set(pid, name);
}
for (const pid of cardConflicts) cardName.delete(pid);

function deriveName(fc) {
  const r = fc26.get(fc);
  if (!r) return { first: '', last: '', common: '', display: cardName.get(fc) ?? '', src: 'cards' };
  const { first, last, common } = r;
  if (common) return { first, last, common, display: common, src: 'common' };
  if (first && last) return { first, last, common, display: `${first} ${last}`, src: 'full' };
  const card = cardName.get(fc) ?? '';
  return { first, last, common, display: card, src: card ? 'cards' : 'empty' };
}

console.log('读远端只读数据');
const players = remote('players');
const tourPlayers = remote('tour-players');
const teamMap = remote('team-map');

console.log('派生显示名');
const rows = [];
const bySrc = { common: 0, full: 0, cards: 0, empty: 0 };
for (const p of players) {
  const d = deriveName(p.fc_id);
  bySrc[d.src]++;
  rows.push({ fc: p.fc_id, our: p.name, club: p.club_id, ...d });
}
const named = rows.length - bySrc.empty;
console.log(`  ${rows.length} 人：显示名 ${named}，回落 players.name ${bySrc.empty}`);
console.log(
  `  来源：commonname ${bySrc.common} / 名+姓 ${bySrc.full} / cards 兜底 ${bySrc.cards} / 空 ${bySrc.empty}`,
);
console.log(`  cards.csv 同 playerid 名字矛盾 ${cardConflicts.size} 个（已弃用）`);

// 与赛事系统逐字对齐 + 球衣号归属
const tourById = new Map(tourPlayers.map((t) => [t.id, t]));
const tourMismatch = [];
const numberRows = [];
const clubMismatch = [];
for (const r of rows) {
  const t = tourById.get(r.fc);
  if (t) {
    if (t.name !== r.display) tourMismatch.push({ fc: r.fc, tour: t.name, derived: r.display });
    const num = (t.number ?? '').trim();
    if (num) numberRows.push({ fc: r.fc, num, our: r.our, tour: t.name });
    if (t.team_id !== r.club) clubMismatch.push({ fc: r.fc, tour: t.team_id, club: r.club });
  }
}
const tourSeen = rows.filter((r) => tourById.has(r.fc)).length;
console.log(`  赛事系统 ${tourPlayers.length} 人：本库命中 ${tourSeen}，显示名逐字不一致 ${tourMismatch.length}`);
console.log(`  球衣号可搬 ${numberRows.length} 条；归属不一致 ${clubMismatch.length} 条`);
for (const m of tourMismatch.slice(0, 10)) console.log(`    ✗ fc ${m.fc} tour「${m.tour}」派生「${m.derived}」`);
for (const m of clubMismatch.slice(0, 10)) console.log(`    ✗ fc ${m.fc} tour team ${m.tour} ≠ club ${m.club}`);

// ---------------------------------------------------------------- 产出

const sqlLit = (s) => (s === '' || s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

// 每个产出文件都带这一行：load.mjs 逐条语句发给 D1，而 D1 不收事务控制语句
const NO_TXN = '-- 无事务控制：D1 拒收 BEGIN/COMMIT；每条语句按 fc_id 独立更新，可整体重跑。';

fs.mkdirSync(OUT, { recursive: true });

function writeBatched(file, header, target, values) {
  // 不写 BEGIN/COMMIT：D1 拒收 SQL 事务控制语句（「please use the state.storage.transaction() …
  // instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements」，本地与远端一样）。
  // 这里也不需要事务：每条语句只按 fc_id 更新自己那批行，重复执行结果相同，中断后整体重跑即可。
  const parts = [header, NO_TXN];
  for (let i = 0; i < values.length; i += BATCH) {
    const chunk = values.slice(i, i + BATCH);
    parts.push(`WITH v(${target.cols}) AS (VALUES\n${chunk.join(',\n')}\n)`);
    parts.push(target.sql);
  }
  parts.push('');
  fs.writeFileSync(file, parts.join('\n'), 'utf8');
  return fs.statSync(file).size;
}

const displayValues = rows
  .filter((r) => r.display !== '')
  .map(
    (r) =>
      `  (${r.fc},${sqlLit(r.first)},${sqlLit(r.last)},${sqlLit(r.common)},${sqlLit(r.display)})`,
  );
const displaySize = writeBatched(
  path.join(OUT, 'display_name.sql'),
  '-- 由 scripts/player-names/derive.mjs 生成，请勿手改。\n-- 只更新派生得到显示名的行；display_name 为空的行保持 NULL，显示处回落 players.name。',
  {
    cols: 'fc,fn,ln,cn,dn',
    sql: `UPDATE players SET
  first_name   = COALESCE(v.fn, players.first_name),
  last_name    = COALESCE(v.ln, players.last_name),
  common_name  = COALESCE(v.cn, players.common_name),
  display_name = COALESCE(v.dn, players.display_name)
FROM v WHERE players.fc_id = v.fc;`,
  },
  displayValues,
);

const numberValues = numberRows.map((r) => `  (${r.fc},${sqlLit(r.num)})`);
const numberSize = writeBatched(
  path.join(OUT, 'number.sql'),
  '-- 由 scripts/player-names/derive.mjs 生成，请勿手改。\n-- 球衣号来自赛事系统 player.number，按 fc_id 归属（赛事系统 player.id 即本库 fc_id）。',
  {
    cols: 'fc,num',
    sql: `UPDATE players SET number = v.num FROM v WHERE players.fc_id = v.fc;`,
  },
  numberValues,
);

const csv = [
  'fc_id,our_name,club_id,display_name,source,first_name,last_name,common_name,tour_name,tour_number',
  ...rows.map((r) =>
    [
      r.fc,
      r.our,
      r.club ?? '',
      r.display,
      r.src,
      r.first,
      r.last,
      r.common,
      tourById.get(r.fc)?.name ?? '',
      tourById.get(r.fc)?.number ?? '',
    ]
      .map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v))
      .join(','),
  ),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'display-names.csv'), csv, 'utf8');

console.log('产出');
console.log(`  out/display_name.sql  ${displayValues.length} 条 / ${displaySize} B`);
console.log(`  out/number.sql        ${numberValues.length} 条 / ${numberSize} B`);
console.log(`  out/display-names.csv ${rows.length + 1} 行`);
if (tourSeen !== tourPlayers.length) {
  console.error(`✗ 赛事系统有 ${tourPlayers.length - tourSeen} 人在本库 fc_id 里找不到`);
  process.exitCode = 1;
}
if (tourMismatch.length > 0 || clubMismatch.length > 0) process.exitCode = 1;
