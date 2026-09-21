// 姓名折叠表达式的延迟实测台（筛选左栏增量步骤 1）。
//
// 为什么要有这个脚本：姓名搜索改成「库侧折叠 + LIKE」后，折叠链是对**每一行**求值的
// 内联 SQL 表达式（D1 不能注册自定义函数），所以它的成本必须实测，不能凭感觉估。
// 本地 node:sqlite 与 D1 是同一个 SQLite 引擎，绝对值有差但量级可信。
//
// 用法：node scripts/bench-name-fold.mjs [行数] [含变音行数]
//   默认 18301 行 / 3048 行含变音（= 2026-09-21 生产 players 实测值）。
//
// 2026-09-21 实测结论（本机，18301 行）：
//   裸 LIKE（改造前）            1.0 ms/次
//   折链全量 253 项（无守卫）      483 ms/次
//   折链裁到生产 87 项（无守卫）   181 ms/次
//   GLOB 守卫生效 + 全量 253 项   98 ms/次   ← 采用
//   GLOB 守卫生效 + 裁到 87 项    40 ms/次   ← 备用（生产嫌慢时）
// 三路语义比对（守卫版 == 不守卫版 == JS foldName 过滤）见脚本末尾与
// tests/name-fold.test.ts。若要在生产上换用「裁表」方案：把 src/core/name-fold.ts 的
// NAME_FOLD 过滤成「生产实测出现过的字符」即可，其余代码不用动。
import { DatabaseSync } from 'node:sqlite';
import { NAME_FOLD, foldName, foldNamePattern } from '../src/core/name-fold.ts';

const ROWS = Number(process.argv[2] ?? 18301);
const ACCENTED = Number(process.argv[3] ?? 3048);

// 2026-09-21 生产全库姓名扫描实测出的非 ASCII 字符（与 tests/name-fold.test.ts 基线同源）
const PROD_CODEPOINTS = [
  0x00ad, 0x00c0, 0x00c1, 0x00c2, 0x00c5, 0x00c7, 0x00c9, 0x00cd, 0x00d3, 0x00d6, 0x00d8, 0x00dc, 0x00de,
  0x00df, 0x00e0, 0x00e1, 0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb,
  0x00ed, 0x00ee, 0x00ef, 0x00f0, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f8, 0x00f9, 0x00fa,
  0x00fc, 0x00fd, 0x00fe, 0x0103, 0x0105, 0x0106, 0x0107, 0x010b, 0x010c, 0x010d, 0x010e, 0x0110, 0x0119,
  0x011b, 0x011f, 0x0130, 0x0131, 0x0137, 0x013d, 0x013e, 0x0141, 0x0142, 0x0144, 0x0146, 0x0148, 0x0151,
  0x0159, 0x015a, 0x015b, 0x015e, 0x015f, 0x0160, 0x0161, 0x0163, 0x0165, 0x016f, 0x0171, 0x017a, 0x017b,
  0x017c, 0x017d, 0x017e, 0x0218, 0x0219, 0x021a, 0x021b, 0x0301, 0x0308,
];
const PROD_CHARS = PROD_CODEPOINTS.map((cp) => String.fromCodePoint(cp));
const PROD_SET = new Set(PROD_CHARS);
const LETTERS = PROD_CHARS.filter((ch) => /\p{L}/u.test(ch));

const SYL = ['sen', 'var', 'mil', 'dor', 'kal', 'ber', 'jan', 'ros', 'tan', 'we', 'del', 'mar', 'kon', 'lu', 'ra', 'fi'];

function makeName(i) {
  const a = SYL[i % SYL.length];
  const b = SYL[(i * 7 + 3) % SYL.length];
  let name = `${a}${b}`;
  if (i % 6 === 0) name += ` ${SYL[(i * 3) % SYL.length]}`;
  if (i < ACCENTED) {
    const ch = LETTERS[i % LETTERS.length];
    const at = i % name.length;
    name = name.slice(0, at) + ch + name.slice(at);
  }
  return name;
}

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const chainOf = (pairs, expr) => pairs.reduce((acc, [k, v]) => `REPLACE(${acc}, ${lit(k)}, ${lit(v)})`, expr);
const foldAll = (pairs, expr) => `lower(${chainOf(pairs, expr)})`;
const foldGuarded = (pairs, expr) =>
  `CASE WHEN ${expr} GLOB '*[^ -~]*' THEN lower(${chainOf(pairs, expr)}) ELSE lower(${expr}) END`;

function bench(sqlite, label, expr, arg, times = 5) {
  const stmt = sqlite.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${expr} LIKE ?`);
  stmt.get(arg);
  const t0 = performance.now();
  for (let i = 0; i < times; i++) stmt.get(arg);
  const ms = (performance.now() - t0) / times;
  console.log(`${label.padEnd(32)} ${ms.toFixed(1).padStart(8)} ms/次`);
  return ms;
}

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
const ins = sqlite.prepare('INSERT INTO players (id, name) VALUES (?, ?)');
sqlite.exec('BEGIN');
for (let i = 1; i <= ROWS; i++) ins.run(i, makeName(i));
sqlite.exec('COMMIT');

const trimmed = NAME_FOLD.filter(([k]) => PROD_SET.has(k));
console.log(`行数 ${ROWS}（含变音 ${ACCENTED}）｜表项 全量 ${NAME_FOLD.length} / 生产清单 ${trimmed.length}`);
const word = foldNamePattern('sen');
bench(sqlite, '裸 LIKE（改造前）', 'name', word);
bench(sqlite, '折链全量（无守卫）', foldAll(NAME_FOLD, 'name'), word);
bench(sqlite, '折链生产清单（无守卫）', foldAll(trimmed, 'name'), word);
bench(sqlite, 'GLOB 守卫 + 全量', foldGuarded(NAME_FOLD, 'name'), word);
bench(sqlite, 'GLOB 守卫 + 生产清单', foldGuarded(trimmed, 'name'), word);
bench(sqlite, 'GLOB 守卫 + 全量（无命中词）', foldGuarded(NAME_FOLD, 'name'), foldNamePattern('zzzz'));

// 三路一致性：守卫版、不守卫版、JS foldName 过滤，命中集必须逐位相同
let bad = 0;
const rows = sqlite.prepare('SELECT id, name FROM players ORDER BY id').all();
for (const probe of ['sen', 'SEN', 'š', 'ø', 'zzzz']) {
  const pat = foldNamePattern(probe);
  const ids = (expr) =>
    sqlite
      .prepare(`SELECT id FROM players WHERE ${expr} LIKE ? ORDER BY id`)
      .all(pat)
      .map((r) => r.id);
  const plain = ids(foldAll(NAME_FOLD, 'name'));
  const guarded = ids(foldGuarded(NAME_FOLD, 'name'));
  const js = rows.filter((r) => foldName(r.name).includes(foldName(probe))).map((r) => r.id);
  const ok = JSON.stringify(plain) === JSON.stringify(guarded) && JSON.stringify(plain) === JSON.stringify(js);
  if (!ok) bad++;
  console.log(`一致性「${probe}」：${ok ? 'OK' : '不一致！'}（命中 ${plain.length} 行）`);
}
console.log(bad === 0 ? '三路一致性全部通过' : `一致性失败 ${bad} 项`);
process.exitCode = bad === 0 ? 0 : 1;
