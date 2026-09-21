// 姓名折叠（筛选左栏增量步骤 1）：去变音符号的 JS 侧与 SQL 侧必须同源同结果。
// 关键断言在「一致」一组：把 sqlFold 生成的表达式真喂进 node:sqlite，SQL 命中集必须与
// JS foldName 的过滤集逐字相等 —— 两侧漂移就是静默漏搜，只有真跑 SQL 才能发现。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  NAME_FOLD,
  SQL_FOLD_DEPTH_LIMIT,
  SQL_FOLD_ENTRY_BUDGET,
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
      ['ægir', 'aegir'],
      ['Łukasz', 'lukasz'],
      ['Đoković', 'dokovic'],
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

  it('表里没有的字形不折，但两侧都不折（覆盖度问题，不是漂移）', () => {
    // 生产实测只有小写 æ（23 次）、没有大写 Æ ⇒ 表里没有 Æ。库里真出现大写 Æ 时导入硬闸会报出来。
    expect(foldName('Ægir')).toBe('Ægir');
    expect(unmappedNameChars(['Ægir'])).toEqual(['Æ']);
    // 组合抑扬 U+030C 同理：生产只有 U+0301/U+0308 两个组合记号，预算内收不下其余组合记号
    expect(foldName('S\u030Ceško')).toBe('s\u030cesko');
  });

  it('库里混着分解形式（生产实测的 U+0301/U+0308）也能折', () => {
    // 生产扫描到的两个组合记号在表内：分解形式与预合成形式必须折成同一个
    expect(foldName('So\u0301n')).toBe('son');
    expect(foldName('Mu\u0308ller')).toBe('muller');
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
  // 真库样本 + 边界：预合成/分解、软连字符、点号、撇号、土耳其 i、中文。
  // 其中 'S\u030Ceško'（组合抑扬 U+030C）、'Ægir'（大写 Æ）、'Đorđe'（小写 đ）在生产里都没有出现，
  // 故不在表内 —— 它们是「表里没有的字形两侧都不折」这条路径的样本，不是漏收。
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
    // 非拉丁：折叠对它们必须是「两侧都不动」，否则就是静默漏搜（见下「不漂移」用例）
    'Шевченко',
    'Παπαδόπουλος',
    '가나다',
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
    'Шевченко',
    'шевченко',
    'Παπαδόπουλος',
    '가나',
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
    // 只有预合成的 Š 命中：语料里那条 S+U+030C 是生产里没有的组合记号，表里没收（见下「覆盖度」用例）
    expect(hits).toEqual(['Šeško']);
  });

  it('生成的是可执行的内联表达式，项数与表一致', () => {
    const expr = sqlFold('t.name');
    expect(expr.startsWith("CASE WHEN t.name GLOB '*[^ -~]*' THEN lower(REPLACE(")).toBe(true);
    expect(expr.endsWith('END')).toBe(true);
    expect(expr.split('REPLACE(').length - 1).toBe(NAME_FOLD.length);
    expect(expr).toContain('REPLACE(t.name, '); // 列表达式原样嵌进去，不被改写
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

  it('表外字符会被抓出来（不静默漏搜），但与折叠无关的汉字不报', () => {
    expect(unmappedNameChars(['ẞtefan'])).toEqual(['ẞ']); // U+1E9E 不在覆盖内
    expect(unmappedNameChars(['中', 'Ø', 'A'])).toEqual([]); // 汉字折叠前后一样，报了是狼来了
    expect(unmappedNameChars(['İbra'])).toEqual([]); // 表内字符不算
    expect(unmappedNameChars(['Ḑevi'])).toEqual(['Ḑ']); // 拉丁脚本 ⇒ 第一条判据就命中
    expect(unmappedNameChars(['plain ascii'])).toEqual([]);
  });

  // 不漂移是这一步的关键：foldName 只做「查表替换 + ASCII 小写」，SQL 侧恰好也是这两件。
  // 曾经 JS 侧多做一层整段 Unicode 的 toLowerCase，于是库里的 'Шевченко' 原样照打反而 0 命中
  //（JS 折成 'шевченко'、SQLite 只折 ASCII 不折），是比「搜不到变音」更糟的回归。
  it('非拉丁不受影响：两侧都不动，原样照打仍命中', () => {
    expect(foldName('Шевченко')).toBe('Шевченко');
    expect(foldName('Παπαδόπουλος')).toBe('Παπαδόπουλος');
    expect(foldName('가나다')).toBe('가나다'); // 韩文音节 NFD 会散成字母，但 JS 侧不再做 NFD
    expect(foldName('阿尔法')).toBe('阿尔法');
  });

  it('非拉丁的大写字母要报（按另一种大小写搜它搜不到）', () => {
    expect(unmappedNameChars(['Шевченко', 'Мбаппе', '中'])).toEqual(['М', 'Ш']);
    expect(unmappedNameChars(['Παπαδόπουλος'])).toEqual(['Π']); // 小写 ο 无对照形，不报
    expect(unmappedNameChars(['가나다'])).toEqual([]); // 无对照形、两侧都原地不动
  });

  // 这类字符大小写不变、也不是拉丁脚本，曾经被判据漏掉、永不报警；而它们恰恰最可能从网页/手机键盘粘进来，
  // 一旦进库就是「用户按键盘上那个键搜不到」，比变音字母更该提醒
  it('刻意不收的形状变体要报（弯引号/花式空格/不可见字符）', () => {
    expect(unmappedNameChars(['O’Brien'])).toEqual(['’']); // U+2019
    expect(unmappedNameChars(['Jean‑Pierre'])).toEqual(['‑']); // U+2011 不断行连字符
    expect(unmappedNameChars(['A\u00a0B'])).toEqual(['\u00a0']); // 不换行空格
    expect(unmappedNameChars(['A\u200bB'])).toEqual(['\u200b']); // 零宽空格
    expect(unmappedNameChars(['A\u200eB'])).toEqual(['\u200e']); // 从左至右标记
    expect(unmappedNameChars(['M\u00aduller'])).toEqual([]); // 软连字符在表内（折叠即删除）
  });

  it('describeChars 输出码位便于补表', () => {
    expect(describeChars(['中', 'Ø'])).toBe('U+4E2D「中」 U+00D8「Ø」');
  });

  it('表项不重复、键非 ASCII、值只含 ASCII 小写', () => {
    const keys = NAME_FOLD.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [key, value] of NAME_FOLD) {
      expect(key.codePointAt(0)! >= 0x80, key).toBe(true);
      // 值若含非 ASCII、大写或空格，SQL 侧就会与 JS 侧漂移；空格值还会被 FOLD_SPEC 的 /\s+/ 切碎
      expect(/^[a-z]*$/.test(value), `${key} → ${value}`).toBe(true);
    }
  });

  // 折叠链的嵌套深度 = 表项数，D1 的表达式树深度上限 100（node:sqlite 是 1000 ⇒ 单测测不出，
  // 真引擎会直接 500）。这一步曾因此把表从 253 项裁到生产实测的 87 项。
  it('表项数留在 D1 表达式树深度预算内', () => {
    expect(NAME_FOLD.length).toBeLessThanOrEqual(SQL_FOLD_ENTRY_BUDGET);
    expect(SQL_FOLD_ENTRY_BUDGET + 4).toBeLessThan(SQL_FOLD_DEPTH_LIMIT); // 链外还有 CASE/GLOB/lower 约 4 层
  });

  it('表按码位升序（生成物可 diff，链式替换顺序稳定）', () => {
    const codes = NAME_FOLD.map(([k]) => k.codePointAt(0)!);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });
});
