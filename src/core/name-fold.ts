// 姓名折叠（增量 26 d1）：把拉丁字母姓名归一到 ASCII 小写，让「sesko」能搜到「Šeško」。
//
// 为什么是「映射表 + 内联 SQL 表达式」而不是物化列：D1 不能注册自定义 SQL 函数
//（@cloudflare/workers-types 的 D1Database 只有 prepare/batch/exec/withSession/dump），
// SQL 侧的折叠只能是 REPLACE 链文本。两侧规则必须同源，否则「折了一侧、另一侧没折」会静默漏搜，
// 所以本文件是唯一的表来源：foldName 用它折查询词，sqlFold 用它生成库侧表达式。
//
// 覆盖范围不是猜的：2026-09-21 生产全库扫描（18301 行姓名 / 3048 行含非 ASCII / 91 种非字母数字字符，
// 其中非 ASCII 87 个）逐字符核对后建表；unmappedNameChars() 是配套硬闸——库里出现表外字符即报错，
// 逼着补表。表本身按拉丁字母的完整区块覆盖（Latin-1 + Latin Extended-A），不是只照抄清单，
// 免得下个赛季新球员带来一个没进清单的字母就漏搜。
//
// 两侧唯一的能力差异（有意保留，不会造成漏搜）：JS 侧先做 NFD 分解去组合记号，SQL 侧没有这个能力。
// 多出来的 NFD 只作用于**查询词**；库里凡是表外字符都会被硬闸拦下，所以不存在「JS 折了、SQL 没折」的组合。
//
// 表项格式：4 位十六进制码位 = 替换文本（空格分隔；替换文本为空表示删除该字符）。
// 用码位而非字面字符写表：软连字符、组合记号这类字符直接写进源码是审阅灾难。

const FOLD_SPEC = `
00c0=a 00c1=a 00c2=a 00c3=a 00c4=a 00c5=a 00c6=ae 00c7=c 00c8=e 00c9=e 00ca=e 00cb=e
00cc=i 00cd=i 00ce=i 00cf=i 00d0=d 00d1=n 00d2=o 00d3=o 00d4=o 00d5=o 00d6=o 00d8=o
00d9=u 00da=u 00db=u 00dc=u 00dd=y 00de=th 00df=ss
00e0=a 00e1=a 00e2=a 00e3=a 00e4=a 00e5=a 00e6=ae 00e7=c 00e8=e 00e9=e 00ea=e 00eb=e
00ec=i 00ed=i 00ee=i 00ef=i 00f0=d 00f1=n 00f2=o 00f3=o 00f4=o 00f5=o 00f6=o 00f8=o
00f9=u 00fa=u 00fb=u 00fc=u 00fd=y 00fe=th 00ff=y
0100=a 0101=a 0102=a 0103=a 0104=a 0105=a
0106=c 0107=c 0108=c 0109=c 010a=c 010b=c 010c=c 010d=c
010e=d 010f=d 0110=d 0111=d
0112=e 0113=e 0114=e 0115=e 0116=e 0117=e 0118=e 0119=e 011a=e 011b=e
011c=g 011d=g 011e=g 011f=g 0120=g 0121=g 0122=g 0123=g
0124=h 0125=h 0126=h 0127=h
0128=i 0129=i 012a=i 012b=i 012c=i 012d=i 012e=i 012f=i 0130=i 0131=i
0132=ij 0133=ij 0134=j 0135=j 0136=k 0137=k 0138=k
0139=l 013a=l 013b=l 013c=l 013d=l 013e=l 013f=l 0140=l 0141=l 0142=l
0143=n 0144=n 0145=n 0146=n 0147=n 0148=n 0149=n 014a=n 014b=n
014c=o 014d=o 014e=o 014f=o 0150=o 0151=o 0152=oe 0153=oe
0154=r 0155=r 0156=r 0157=r 0158=r 0159=r
015a=s 015b=s 015c=s 015d=s 015e=s 015f=s 0160=s 0161=s
0162=t 0163=t 0164=t 0165=t 0166=th 0167=th
0168=u 0169=u 016a=u 016b=u 016c=u 016d=u 016e=u 016f=u 0170=u 0171=u 0172=u 0173=u
0174=w 0175=w 0176=y 0177=y 0178=y
0179=z 017a=z 017b=z 017c=z 017d=z 017e=z 017f=s
0218=s 0219=s 021a=t 021b=t
0300= 0301= 0302= 0303= 0304= 0305= 0306= 0307= 0308= 0309= 030a= 030b= 030c=
031b= 0323= 0324= 0325= 0326= 0327= 0328= 032d= 0331= 0332= 0344=
00a0=\u0020 00ad= 2000=\u0020 2001=\u0020 2002=\u0020 2003=\u0020 2004=\u0020 2005=\u0020
2006=\u0020 2007=\u0020 2008=\u0020 2009=\u0020 200a=\u0020 200b= 200c= 200d=
2028=\u0020 2029=\u0020 202f=\u0020 205f=\u0020 3000=\u0020 2060= feff=
2010=- 2011=- 2012=- 2013=- 2014=- 2015=- 2212=-
02bc=' 2018=' 2019=' 201c=" 201d="
`.trim();

const FOLD_MAP = new Map<string, string>();
for (const token of FOLD_SPEC.split(/\s+/)) {
  const eq = token.indexOf('=');
  if (eq !== 4) throw new Error(`name-fold: 表项应为「4 位十六进制=替换文本」，得到「${token}」`);
  FOLD_MAP.set(String.fromCodePoint(Number.parseInt(token.slice(0, 4), 16)), token.slice(5));
}

// 按码位排序导出：sqlFold 的 REPLACE 链顺序、单测与审计输出都依赖这个稳定顺序
export const NAME_FOLD: ReadonlyArray<readonly [string, string]> = [...FOLD_MAP.entries()].sort(
  ([a], [b]) => a.codePointAt(0)! - b.codePointAt(0)!,
);

const COMBINING = /\p{M}+/gu;

// 折查询词与折库内姓名共用同一张表；NFD 只在这里用（见文件头说明）
export function foldName(raw: string): string {
  let out = '';
  for (const ch of raw.normalize('NFD').replace(COMBINING, '')) out += FOLD_MAP.get(ch) ?? ch;
  return out.toLowerCase();
}

function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// 「含非 ASCII 字符」的 GLOB（0x80 以上都算；SQLite 的 GLOB 逐字符按码位匹配）
const NON_ASCII_GLOB = '*[^ -~]*';

// 库侧折叠表达式：把 expr 折成 ASCII 小写，供 LIKE 匹配。
// 表项键都是非 ASCII、替换文本都是 ASCII，所以链内不存在「前面的替换造出后面的键」的干扰。
//
// 外面套一层 GLOB 守卫，是实测逼出来的：链子对每行都要跑 ${NAME_FOLD.length} 次 REPLACE
// （20 字符的名字 ≈ 5000 次字符串分配），18301 行实测 483 ms/次；而姓名里绝大多数是纯 ASCII，
// 折叠对它们只等价于小写化（表键全非 ASCII ⇒ 不会有任何一次替换命中）。先 GLOB 筛出含非 ASCII
// 的行、只对它们跑链，实测降到 93 ms/次，语义与不守卫完全一致（tests/name-fold.test.ts 与
// scripts/bench-name-fold.mjs 都做三路比对）。若生产仍嫌慢，把 NAME_FOLD 裁到「生产实测清单」
// （87 项）即降到 ~35 ms/次 —— 一行过滤，其余代码不用动。
export function sqlFold(expr: string): string {
  let out = expr;
  for (const [from, to] of NAME_FOLD) out = `REPLACE(${out}, ${sqlLit(from)}, ${sqlLit(to)})`;
  return `CASE WHEN ${expr} GLOB ${sqlLit(NON_ASCII_GLOB)} THEN lower(${out}) ELSE lower(${expr}) END`;
}

// 硬闸：列出既不在表内、又非 ASCII 的字符（有输出即说明该补表，而不是静默漏搜）。
// 按原始字符查表（不先做 NFD）：库里要过 SQL 那一侧，而 SQL 只有这张表。
export function unmappedNameChars(names: Iterable<string>): string[] {
  const bad = new Set<string>();
  for (const name of names) {
    for (const ch of name) {
      if (ch.codePointAt(0)! < 0x80) continue;
      if (!FOLD_MAP.has(ch)) bad.add(ch);
    }
  }
  return [...bad].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}

export function describeChars(chars: readonly string[]): string {
  return chars.map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}「${ch}」`).join(' ');
}

// LIKE 模式串：折查询词 + 转义 LIKE 元字符。路由与单测共用这一处，免得两边各写一遍转义。
// 折叠在前（表里没有 \ % _ 这些 ASCII 元字符），所以转义只需处理折叠后的串。
export function foldNamePattern(query: string): string {
  return `%${foldName(query.trim()).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
