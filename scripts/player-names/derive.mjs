#!/usr/bin/env node
/**
 * 球员显示名与球衣号派生（增量 32 · 步骤 2；增量 34 评审改为 s901 存档表取号）
 *
 * 输入（本机只读，路径写死在 SOURCES 里）
 *   base_players.csv  playerid + firstnameid / lastnameid / commonnameid（四个文本列全空，只能走字典）
 *   playernames.txt   nameid → 人名（UTF-16LE TSV）
 *   cards.csv         playerid → 完整人名（字典缺号 / 缺栏时的兜底）
 *   s901/splitted/    FC Editor 导出的存档球员表，一队一份（文件名「<club_id> - <队名>.xlsx」），
 *                     表体两列：球衣号 + 球员全名。这是本仓球衣号的唯一真源
 *                     —— 增量 33 起赛事系统的名册改从本仓拉取，不能再反向去读它的号码。
 *
 * 远端只读查询（结果缓存在 data/*.json，--refresh 重拉；全部是 SELECT，不写任何数据）
 *   whl-club players（fc_id / name / club_id）
 *
 * 派生规则（与 s901 存档表 570 人对齐，实测 565 例逐字 + 5 例同人异名）
 *   commonname 原样
 *   || 「名 姓」（两栏都能在字典里查到）
 *   || cards.csv 的完整人名（字典缺号、缺栏时兜底；同 playerid 多行名字矛盾则弃用）
 *   || 空 —— 显示处 COALESCE(display_name, players.name) 回落到 FC26db 缩写名
 *
 * 球衣号归属（写库只按 fc_id，名字只用来把 s901 的行认到 fc_id 上）
 *   同队（club_id）内依次按 ① 显示名逐字相同 ② 归一化后相同（大小写 / 变音符号 / 标点）
 *   ③ 同姓唯一 ④ 全队两侧各只剩一人（词序、昵称差异）配对；同级出现多解就落到下一级。
 *   四级都认不下来、或某队两侧人数不等，非零退出，不猜。
 *
 * 产出（out/，不进版本库）
 *   display_name.sql   first_name / last_name / common_name / display_name 批量 UPDATE
 *   number.sql         球衣号 UPDATE（按 fc_id）
 *   display-names.csv  逐人审计表（含 s901 姓名与号码两列）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const OUT = path.join(HERE, 'out');
const SOURCES = {
  basePlayers: 'E:/FC26 LE v26.3.5/player_presets/base_players.csv',
  cards: 'E:/FC26 LE v26.3.5/player_presets/cards.csv',
  dict: 'E:/FST存档修改器编辑器v1.2.0/config/playernames.txt',
  s901Dir: 'E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901/splitted',
};
// 每批 400 行 ≈ 22KB 一条语句：load.mjs 走 --command（同步 /query 端点），语句得塞进
// Windows 命令行（上限约 32KB）。原来是 1000 行，那是为了配 --file，而 D1 的 import
// 端点在实测中会对完全合法的 SQL 报假错，已弃用（见 load.mjs 里 runStatement 的注释）。
const BATCH = 400;

const refresh = process.argv.includes('--refresh');

// ---------------------------------------------------------------- 远端只读查询

// 直接跑 wrangler 的 JS 入口，不经 npx：Node 24 在 Windows 上拒收 spawnSync('npx.cmd')
//（.cmd/.bat 现在必须带 shell，带 shell 又得自己处理引号），与 load.mjs 同一处理。
const WRANGLER = path.join(HERE, '..', '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const REMOTE = {
  players: {
    db: 'whl-club',
    sql: 'SELECT fc_id, name, club_id FROM players ORDER BY fc_id',
  },
};

function remote(name) {
  const file = path.join(DATA, `${name}.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const { db, sql } = REMOTE[name];
  if (!fs.existsSync(WRANGLER)) {
    console.error(`找不到 wrangler 入口 ${WRANGLER}，先在仓库根目录跑 npm install。`);
    process.exit(2);
  }
  const raw = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', db, '--remote', '--json', '--command', sql],
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

// ---------------------------------------------------------------- s901 存档表（球衣号真源）

// 一队一份 xlsx，文件名「<club_id> - <队名>」，表体两列：球衣号 + 球员全名。
// 这里只做形状校验；把行认到 fc_id 上（认人）在主流程里做。
function readS901() {
  const dir = SOURCES.s901Dir;
  if (!fs.existsSync(dir)) {
    console.error(`找不到 s901 存档表目录 ${dir}（球衣号真源，缺了派生不出号码）。`);
    process.exit(2);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.xlsx'))
    .sort();
  const out = [];
  for (const f of files) {
    const m = f.match(/^(\d+) - (.+)\.xlsx$/);
    if (!m) {
      console.error(`s901 文件名不合契约「<club_id> - <队名>.xlsx」：${f}`);
      process.exit(2);
    }
    const wb = XLSX.readFile(path.join(dir, f));
    const sheet = wb.Sheets[wb.SheetNames[0]];
    for (const row of XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })) {
      const name = row?.[1] == null ? '' : String(row[1]).trim();
      if (!name) continue;
      const number = row[0] == null ? '' : String(row[0]).trim();
      if (!number) {
        console.error(`s901 ${f}：「${name}」没有球衣号，存档表不完整。`);
        process.exit(2);
      }
      out.push({ club: Number(m[1]), clubName: m[2], name, number });
    }
  }
  console.log(`  s901/splitted: ${files.length} 队 / ${out.length} 人`);
  return out;
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

console.log('读 s901 存档表并认人');
const s901 = readS901();

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const lastWord = (s) => {
  const t = normalize(s).split(' ');
  return t[t.length - 1];
};

const s901ByClub = new Map();
for (const s of s901) {
  if (!s901ByClub.has(s.club)) s901ByClub.set(s.club, []);
  s901ByClub.get(s.club).push(s);
}
const oursByClub = new Map();
for (const r of rows) {
  if (r.club == null) continue;
  if (!oursByClub.has(r.club)) oursByClub.set(r.club, []);
  oursByClub.get(r.club).push(r);
}

const numberRows = [];
const aliasPairs = [];
const claimed = new Set();
let todo = s901.slice();
const STAGES = [
  ['逐字相同', (o, s) => o.display === s.name],
  ['归一化相同', (o, s) => normalize(o.display) === normalize(s.name)],
  ['同队同姓唯一', (o, s) => lastWord(o.display) === lastWord(s.name)],
];
for (const [how, eq] of STAGES) {
  const rest = [];
  for (const s of todo) {
    const hit = (oursByClub.get(s.club) ?? []).filter((o) => !claimed.has(o.fc) && eq(o, s));
    if (hit.length !== 1) {
      rest.push(s);
      continue;
    }
    claimed.add(hit[0].fc);
    numberRows.push({ fc: hit[0].fc, num: s.number, our: hit[0].our, s901: s.name, how });
    if (how !== '逐字相同') {
      aliasPairs.push({
        club: s.club,
        s901: s.name,
        num: s.number,
        our: hit[0].our,
        display: hit[0].display,
        how,
      });
    }
  }
  todo = rest;
}

// 三级都对不上时只剩一种安全情形：这一队两侧各剩一人（词序 / 昵称差异），配成一对并留痕
const unmatched = [];
let clubCountMismatch = 0;
for (const club of [...new Set([...s901ByClub.keys(), ...oursByClub.keys()])].sort((a, b) => a - b)) {
  const s = todo.filter((x) => x.club === club);
  const o = (oursByClub.get(club) ?? []).filter((x) => !claimed.has(x.fc));
  if (s.length === 0 && o.length === 0) continue;
  if (s.length === 1 && o.length === 1) {
    claimed.add(o[0].fc);
    numberRows.push({ fc: o[0].fc, num: s[0].number, our: o[0].our, s901: s[0].name, how: '队内唯一余量' });
    aliasPairs.push({
      club,
      s901: s[0].name,
      num: s[0].number,
      our: o[0].our,
      display: o[0].display,
      how: '队内唯一余量',
    });
    continue;
  }
  unmatched.push({
    club,
    s901: s.map((x) => `${x.name}=${x.number}`).join(', '),
    ours: o.map((x) => `${x.fc}:${x.display}`).join(', '),
  });
}
for (const [club, list] of s901ByClub) {
  const ours = (oursByClub.get(club) ?? []).length;
  if (ours !== list.length) {
    console.error(`    ✗ club ${club} 人数不等：s901 ${list.length} ／本库 ${ours}`);
    clubCountMismatch++;
  }
}

const byHow = {};
for (const r of numberRows) byHow[r.how] = (byHow[r.how] ?? 0) + 1;
console.log(
  `  s901 ${s901.length} 人 → 球衣号 ${numberRows.length} 条（${Object.entries(byHow)
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ')}）`,
);
console.log(`  同人异名 ${aliasPairs.length} 例（只影响姓名口径，号码照写）：`);
for (const a of aliasPairs) {
  console.log(`    · club ${a.club} s901「${a.s901}」#${a.num} ↔ 本库「${a.our}」（派生「${a.display}」，${a.how}）`);
}
for (const u of unmatched) console.error(`    ✗ club ${u.club} 认不下来：s901 [${u.s901}] ／本库 [${u.ours}]`);

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
  '-- 由 scripts/player-names/derive.mjs 生成，请勿手改。\n-- 球衣号来自 FC Editor s901 存档表的球队球员表（一队一份 xlsx），经队内认人后按 fc_id 归属。',
  {
    cols: 'fc,num',
    sql: `UPDATE players SET number = v.num FROM v WHERE players.fc_id = v.fc;`,
  },
  numberValues,
);

const s901ByFc = new Map(numberRows.map((r) => [r.fc, r]));
const csv = [
  'fc_id,our_name,club_id,display_name,source,first_name,last_name,common_name,s901_name,s901_number',
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
      s901ByFc.get(r.fc)?.s901 ?? '',
      s901ByFc.get(r.fc)?.num ?? '',
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
if (numberRows.length !== s901.length) {
  console.error(`✗ s901 ${s901.length} 人里只认到 ${numberRows.length} 个本库 fc_id`);
  process.exitCode = 1;
}
if (clubCountMismatch > 0 || unmatched.length > 0) process.exitCode = 1;
