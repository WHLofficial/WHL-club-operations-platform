// 姓名折叠（筛选左栏增量步骤 1）：去变音符号的 JS 侧与 SQL 侧必须同源同结果。
// 关键断言在「一致」一组：把 sqlFold 生成的表达式真喂进 node:sqlite，SQL 命中集必须与
// JS foldName 的过滤集逐字相等 —— 两侧漂移就是静默漏搜，只有真跑 SQL 才能发现。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  NAME_FOLD,
  describeChars,
  foldName,
  foldNamePattern,
  sqlFold,
  unmappedNameChars,
} from '../src/core/name-fold.ts';

// 2026-09-21 生产全库姓名扫描（18301 行 / 3048 行含非 ASCII）实测出的非 ASCII 字符码位表，
// 与扫描 SQL 的 unicode(ch) 输出逐位对应：拉丁字母 Latin-1 段 43 个 + Latin Extended-A 段 39 个
// + ȘșȚț（U+0218-021B）+ 软连字符 U+00AD + 组合记号 U+0301/U+0308（库里混着分解形式）。
// 它是硬闸的回归基线：表漏掉任何一个，这里就会红。
const PROD_CODEPOINTS = [
  0x00ad, 0x00c0, 0x00c1, 0x00c2, 0x00c5, 0x00c7, 0x00c9, 0x00cd,
  0x00d3, 0x00d6, 0x00d8, 0x00dc, 0x00de, 0x00df, 0x00e0, 0x00e1,
  0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9,
  0x00ea, 0x00eb, 0x00ed, 0x00ee, 0x00ef, 0x00f0, 0x00f1, 0x00f2,
  0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f8, 0x00f9, 0x00fa, 0x00fc,
  0x00fd, 0x00fe, 0x0103, 0x0105, 0x0106, 0x0107, 0x010b, 0x010c,
  0x010d, 0x010e, 0x0110, 0x0119, 0x011b, 0x011f, 0x0130, 0x0131,
  0x0137, 0x013d, 0x013e, 0x0141, 0x0142, 0x0144, 0x0146, 0x0148,
  0x0151, 0x0159, 0x015a, 0x015b, 0x015e, 0x015f, 0x0160, 0x0161,
  0x0163, 0x0165, 0x016f, 0x0171, 0x017a, 0x017b, 0x017c, 0x017d,
  0x017e, 0x0218, 0x0219, 0x021a, 0x021b, 0x0301, 0x0308,
];

describe('foldName：去变音（JS 侧）', () => {
  it('常见变音名字折成 ASCII 小写', () => {
    const cases: [string, string][] = [
      ['Šeško', 'sesko'],
      ['Ødegaard', 'odegaard'],
      ['Müller', 'muller'],
      ['Iñigo Martínez', 'inigo martinez'],
      ['Þór', 'thor'],
      ['Groß', 'gross'],
      ['Ægir', 'aegir'],
      ['Łukasz', 'lukasz'],
      ['Đorđe', 'dorde'],
      ['Ștefan', 'stefan'],
      ['Çalhanoğlu', 'calhanoglu'],
      ['Öztürk', 'ozturk'],
      ['Ångström', 'angstrom'],
      ['Ísland', 'island'],
    ];
    for (const [raw, folded] of cases) expect(foldName(raw), raw).toBe(folded);
  });

  it('点号/土耳其 i/长 s 这类同形不同码位的都归到同一个 ASCII 字母', () => {
    expect(foldName('İlkay')).toBe('ilkay');
    expect(foldName('Kılıç')).toBe('kilic');
    expect(foldName('Iİıi')).toBe('iiii');
  });

  it('库里混着分解形式（base + 组合记号）也能折', () => {
    // S + U+030C（组合抑扬）与预合成的 Š 必须折成同一个
    expect(foldName('S\u030Ceško')).toBe('sesko');
    expect(foldName('M\u00ADuller')).toBe('muller'); // 软连字符直接删
  });

  it('ASCII 原样透传，只统一大小写', () => {
    expect(foldName('Van Dijk')).toBe('van dijk');
    expect(foldName("O'Brien")).toBe("o'brien");
    expect(foldName('St. Mary')).toBe('st. mary');
    expect(foldName("D'Angelo-Smith")).toBe("d'angelo-smith");
    expect(foldName('')).toBe('');
  });

  it('中文与 CJK 不受影响（库里是拉丁名，但万一有也不该被吃掉）', () => {
    expect(foldName('阿尔法')).toBe('阿尔法');
  });

  it('折出来的模式串转义 LIKE 元字符，且折叠在前', () => {
    expect(foldNamePattern(' Šeško ')).toBe('%sesko%');
    expect(foldNamePattern('100%_ok')).toBe('%100\\%\\_ok%');
    expect(foldNamePattern('a\\b')).toBe('%a\\\\b%');
  });
});

describe('sqlFold：SQL 侧与 JS 侧同源', () => {
  // 真库样本 + 边界：预合成/分解、软连字符、点号、撇号、土耳其 i、中文
  const NAMES = [
    'Šeško',
    'S\u030Ceško',
    'Ødegaard',
    'Müller',
    'M\u00ADuller',
    'İlkay',
    'Kılıç',
    'Inigo Martínez',
    'Þór',
    'Groß',
    'Ægir',
    'Łukasz',
    'Đorđe',
    'Ștefan',
    'Van Dijk',
    "O'Brien",
    'St. Mary',
    '阿尔法',
    'Édouard',
    'Böhm',
  ];

  const QUERIES = [
    'sesko',
    'SESKO',
    'sesk',
    'odegaard',
    'muller',
    'ilkay',
    'kilic',
    'inigo',
    'thor',
    'gross',
    'aegir',
    'lukasz',
    'dorde',
    'stefan',
    'van dijk',
    "o'brien",
    'st. mary',
    '阿尔法',
    'douard',
    'bohm',
    'zzz',
  ];

  function makeTable(): DatabaseSync {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE t (name TEXT NOT NULL)');
    const ins = sqlite.prepare('INSERT INTO t (name) VALUES (?)');
    for (const n of NAMES) ins.run(n);
    return sqlite;
  }

  it('每个查询词：SQL 命中集 === JS 过滤集', () => {
    const sqlite = makeTable();
    const sql = `SELECT name FROM t WHERE ${sqlFold('t.name')} LIKE ? ESCAPE '\\'`;
    for (const q of QUERIES) {
      const sqlHits = (sqlite.prepare(sql).all(foldNamePattern(q)) as { name: string }[]).map((r) => r.name);
      const jsHits = NAMES.filter((n) => foldName(n).includes(foldName(q)));
      expect(new Set(sqlHits), q).toEqual(new Set(jsHits));
    }
  });

  it('表达式对 ASCII 大小写也一视同仁（SQLite 的 lower 只吃 ASCII，故大小写交给 lower）', () => {
    const sqlite = makeTable();
    const sql = `SELECT name FROM t WHERE ${sqlFold('t.name')} LIKE ? ESCAPE '\\' ORDER BY name`;
    const hits = (sqlite.prepare(sql).all('%sesko%') as { name: string }[]).map((r) => r.name);
    expect(hits).toEqual(['S\u030Ceško', 'Šeško']);
  });

  it('生成的是可执行的内联表达式，项数与表一致', () => {
    const expr = sqlFold('t.name');
    expect(expr.startsWith("CASE WHEN t.name GLOB '*[^ -~]*' THEN lower(REPLACE(")).toBe(true);
    expect(expr.endsWith('END')).toBe(true);
    expect(expr.split('REPLACE(').length - 1).toBe(NAME_FOLD.length);
    expect(expr).toContain('REPLACE(t.name, '); // 列表达式原样嵌进去，不被改写
    // 替换值里的撇号要成对（否则 SQL 文本会被断开）
    expect(NAME_FOLD.some(([, v]) => v === "'")).toBe(true);
    expect(expr).toContain(", '''')");
  });

  it('GLOB 守卫只跳过纯 ASCII 行：守卫版与不守卫版、与 JS 完全等价', () => {
    const sqlite = makeTable();
    // 不守卫版：直接照 NAME_FOLD 现搭一条链，独立于 sqlFold 的实现
    const chain = NAME_FOLD.reduce(
      (acc, [from, to]) => `REPLACE(${acc}, '${from.replace(/'/g, "''")}', '${to.replace(/'/g, "''")}')`,
      't.name',
    );
    const plain = `SELECT name FROM t WHERE lower(${chain}) LIKE ? ESCAPE '\\'`;
    const guarded = `SELECT name FROM t WHERE ${sqlFold('t.name')} LIKE ? ESCAPE '\\'`;
    // ASCII 名字走 ELSE 分支、变音名字走 THEN 分支，两条路都要有样本
    for (const q of ['sesko', 'odegaard', 'muller', 'stefan', 'thor']) {
      const pat = foldNamePattern(q);
      const a = (sqlite.prepare(plain).all(pat) as { name: string }[]).map((r) => r.name).sort();
      const b = (sqlite.prepare(guarded).all(pat) as { name: string }[]).map((r) => r.name).sort();
      expect(b, q).toEqual(a);
    }
  });

});

describe('硬闸与表完整性', () => {
  it('生产实测的 87 个非 ASCII 字符全在表内', () => {
    const chars = PROD_CODEPOINTS.map((cp) => String.fromCodePoint(cp));
    expect(chars.length).toBe(87);
    expect(new Set(chars).size).toBe(87); // 基线自身不重复
    const bad = unmappedNameChars(chars);
    expect(bad.length === 0 ? '' : `缺表项：${describeChars(bad)}`).toBe('');
  });

  it('表外字符会被抓出来（不静默漏搜）', () => {
    expect(unmappedNameChars(['ẞtefan'])).toEqual(['ẞ']); // U+1E9E 不在覆盖内
    expect(unmappedNameChars(['中', 'Ø', 'A'])).toEqual(['中']); // ASCII 与表内字符都不算
    expect(unmappedNameChars(['plain ascii'])).toEqual([]);
  });

  it('describeChars 输出码位便于补表', () => {
    expect(describeChars(['中', 'Ø'])).toBe('U+4E2D「中」 U+00D8「Ø」');
  });

  it('表项不重复、键非 ASCII、值只含 ASCII 小写与空格/撇号/引号/连字符', () => {
    const keys = NAME_FOLD.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [key, value] of NAME_FOLD) {
      expect(key.codePointAt(0)! >= 0x80, key).toBe(true);
      // 值若含非 ASCII，或含大写，SQL 侧就会与 JS 侧漂移
      expect(/^[a-z'" -]*$/.test(value), `${key} → ${value}`).toBe(true);
    }
  });

  it('表按码位升序（生成物可 diff，链式替换顺序稳定）', () => {
    const codes = NAME_FOLD.map(([k]) => k.codePointAt(0)!);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });
});
