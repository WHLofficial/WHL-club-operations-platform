// 姓名折叠（增量 26 步骤 1）：把拉丁字母姓名归一到 ASCII 小写，让「sesko」能搜到「Šeško」。
//
// 为什么是「映射表 + 内联 SQL 表达式」而不是物化列：D1 不能注册自定义 SQL 函数
//（@cloudflare/workers-types 的 D1Database 只有 prepare/batch/exec/withSession/dump），
// SQL 侧的折叠只能是 REPLACE 链文本。两侧规则必须同源，否则「折了一侧、另一侧没折」会静默漏搜，
// 所以本文件是唯一的表来源：foldName 用它折查询词，sqlFold 用它生成库侧表达式。
//
// **表里只有 87 项，这是硬约束不是裁剪偏好**：REPLACE 链是线性嵌套，深度随表项数增长，而 D1 的
// 表达式树深度上限是 100。2026-09-21 用真引擎实测（scripts/check-name-fold-depth.mjs，`wrangler d1
// execute --local`）：96 项通过、100 项起报 `D1_ERROR: Expression tree is too large (maximum depth
// 100)`。node:sqlite 的上限是 1000，所以本地单测**测不出**这个上限，只有真引擎会报 —— 早期版本
// 按拉丁字母完整区块建了 253 项，结果姓名搜索与 sort=name 在生产引擎上直接 500。
// 因此表只能收「库里真实存在的字」：2026-09-21 生产全库扫描（18301 行姓名 / 3048 行含非 ASCII）
// 实测出的 87 个非 ASCII 字符，逐位核对后建表；unmappedNameChars() 是配套硬闸，库里出现表外字符就报
//（导入预览里是警告，脚本扫描里可直接当退出码），逼着补表。表长撞上限的那天就换物化列
//（迁移加 name_folded + 回填全库 + 查询切列），那是一次完整的生产批，见 `ROADMAP.md` 的增量 26 节。
//
// 刻意不收的字符（都曾在这张表里，因为撞深度上限被拿掉）：库侧从未出现过、只对查询词有好处的
// 归一化 —— 弯引号 / 花式空格 / 破折号 / 不可见格式字符（U+2000–U+200A、U+2018/2019、U+201C/201D、
// U+2010–U+2015、U+00A0 等），以及 Latin-1 / Extended-A 里生产未出现的字母（Ã、Æ、Œ 这类）。
// 代价说清楚：手机上打出的弯引号「O’Brien」不会命中库里的「O'Brien」（旧裸 LIKE 也一样不命中，
// 不是回归）；库里若哪天出现这些字符，硬闸会报出来（见下面的第三类判据）。
//
// 两侧不会漂移是**按构造**成立的：foldName 只做「查表替换 + ASCII 小写」两件事，
// sqlFold 生成的 REPLACE 链 + SQLite 的 lower() 恰好就是这两件，逐一对应。
// 注意这不是「表里大小写两形都收」：表和两侧规则都是「表里有的才折」，某个字形（Æ、Ã、È 这类
// 生产未出现的大写形）不在表里时，两侧都原样留下 —— 表现是「这个词搜不到」，而不是「折了一侧」。
// 硬闸因此不是正确性的兜底，而是**覆盖度**的提醒：库里的某个字有可折叠的对照形、却还没进表
//（比如 ẞ、Ш、U+0302 这类组合记号），按对照形搜它就搜不到——该补表了。
//
// 表项格式：4 位十六进制码位 = 替换文本（空格分隔；替换文本为空表示删除该字符）。
// 替换文本只允许 ASCII 小写字母或空——**不能是空格**：表按空白切分，写不出「替换成空格」，
// 而且非 ASCII 的空格/格式字符本来就在上面的「刻意不收」清单里。

const FOLD_SPEC = `
00ad= 00c0=a 00c1=a 00c2=a 00c5=a 00c7=c 00c9=e 00cd=i 00d3=o 00d6=o 00d8=o
00dc=u 00de=th 00df=ss 00e0=a 00e1=a 00e2=a 00e3=a 00e4=a 00e5=a 00e6=ae
00e7=c 00e8=e 00e9=e 00ea=e 00eb=e 00ed=i 00ee=i 00ef=i 00f0=d 00f1=n 00f2=o
00f3=o 00f4=o 00f5=o 00f6=o 00f8=o 00f9=u 00fa=u 00fc=u 00fd=y 00fe=th 0103=a
0105=a 0106=c 0107=c 010b=c 010c=c 010d=c 010e=d 0110=d 0119=e 011b=e 011f=g
0130=i 0131=i 0137=k 013d=l 013e=l 0141=l 0142=l 0144=n 0146=n 0148=n 0151=o
0159=r 015a=s 015b=s 015e=s 015f=s 0160=s 0161=s 0163=t 0165=t 016f=u 0171=u
017a=z 017b=z 017c=z 017d=z 017e=z 0218=s 0219=s 021a=t 021b=t 0301= 0308=
`.trim();

const FOLD_MAP = new Map<string, string>();
const TOKENS = FOLD_SPEC.split(/\s+/);
for (const token of TOKENS) {
  const eq = token.indexOf('=');
  if (eq !== 4) throw new Error(`name-fold: 表项应为「4 位十六进制=替换文本」，得到「${token}」`);
  const key = String.fromCodePoint(Number.parseInt(token.slice(0, 4), 16));
  // 重复键会被 Map 静默覆盖（表里两处写同一字符、后一处胜），查起来极难，所以这里直接拦
  if (FOLD_MAP.has(key)) throw new Error(`name-fold: 表项重复，${token.slice(0, 4)} 出现两次`);
  const value = token.slice(5);
  // 值含空格/大写/非 ASCII 都会让 SQL 侧与 JS 侧、或与 lower() 的结果对不上
  if (!/^[a-z]*$/.test(value)) throw new Error(`name-fold: 替换文本只能是 ASCII 小写字母或空，得到「${value}」`);
  FOLD_MAP.set(key, value);
}

// 按码位排序导出：sqlFold 的 REPLACE 链顺序、单测与审计输出都依赖这个稳定顺序
export const NAME_FOLD: ReadonlyArray<readonly [string, string]> = [...FOLD_MAP.entries()].sort(
  ([a], [b]) => a.codePointAt(0)! - b.codePointAt(0)!,
);

// D1 的表达式树深度上限（实测报错原文里的数字）。链外还有 CASE / GLOB / lower / LIKE 约 4 层，
// 所以表项预算留出余量；tests/name-fold.test.ts 与 scripts/check-name-fold-depth.mjs 都盯着它。
export const SQL_FOLD_DEPTH_LIMIT = 100;
export const SQL_FOLD_ENTRY_BUDGET = 92;

// 折查询词与折库内姓名共用同一张表。
// 这里刻意**只做两件 SQL 也做得到的事**：查表替换 + ASCII 小写（表里 Š 与 š 各是一条表项）。
// 不做 NFD 分解、也不做整段 Unicode 的 toLowerCase —— SQLite 的 lower() 只折 ASCII、更没有 normalize，
// 多做一步就多一类「JS 折了、SQL 没折」的静默漏搜。这不是理论风险：曾实测库内 'Шевченко'，
// 查询词原样照打，旧裸 LIKE 命中、走整段 toLowerCase 的实现 0 命中。只做这两件事之后，
// 两侧可折叠的字符集合按构造相同，任意字符串都不可能漂移（tests/name-fold.test.ts 有对应用例）。
export function foldName(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const mapped = FOLD_MAP.get(ch);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    out += cp >= 0x41 && cp <= 0x5a ? String.fromCharCode(cp + 32) : ch;
  }
  return out;
}

function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// 「含非 ASCII 字符」的 GLOB（0x80 以上都算；SQLite 的 GLOB 逐字符按码位匹配）
const NON_ASCII_GLOB = '*[^ -~]*';

// 库侧折叠表达式：把 expr 折成 ASCII 小写，供 LIKE 匹配。
// 表项键都是非 ASCII、替换文本都是 ASCII 小写或空，所以链内不存在「前面的替换造出后面的键」的干扰。
// 链的嵌套深度 = 表项数（当前 87），加上外面的 CASE/GLOB/lower 约 4 层，
// 必须留在 SQL_FOLD_DEPTH_LIMIT 之内——超了不是「慢」，是真引擎直接报错 500（见文件头）。
//
// 外面套一层 GLOB 守卫，是实测逼出来的：链子对每行都要跑一遍全部表项
// （20 字符的名字 ≈ 5000 次字符串分配），18301 行实测 483 ms/次；而姓名里绝大多数是纯 ASCII，
// 折叠对它们只等价于小写化（表键全非 ASCII ⇒ 不会有任何一次替换命中）。先 GLOB 筛出含非 ASCII
// 的行、只对它们跑链，实测降到 93 ms/次，语义与不守卫完全一致（tests/name-fold.test.ts 与
// scripts/bench-name-fold.mjs 都做三路比对）。
export function sqlFold(expr: string): string {
  let out = expr;
  for (const [from, to] of NAME_FOLD) out = `REPLACE(${out}, ${sqlLit(from)}, ${sqlLit(to)})`;
  return `CASE WHEN ${expr} GLOB ${sqlLit(NON_ASCII_GLOB)} THEN lower(${out}) ELSE lower(${expr}) END`;
}

// 硬闸：列出既不在表内、又「有可折叠对照形」的非 ASCII 字符（有输出即说明该补表）。
// 按原始字符查表（不先做 NFD）：库里要过 SQL 那一侧，而 SQL 只有这张表。
// 报三类：① 拉丁脚本的字（ẞ 这类带变音的对照形，表只收生产实测清单，其余落空）；
// ② 大小写会变的字（西里尔 Ш、希腊 Π——按小写形搜它搜不到）；
// ③ 上面「刻意不收」清单里的形状变体（非 ASCII 空白 / 连字符 / 弯引号 / 不可见格式字符）——
//    库里出现一个弯引号，就意味着用户按键盘上那个键搜不到它，这正是最该提醒的一类。
// 组合记号（Mn）也报：库里若混进 U+0302 这类分解形式，SQL 侧去掉的只有表里的 0301/0308。
// 不报汉字、假名、全角标点这些：它们没有对照形，两侧都原地不动，报了只会让警告变成狼来了。
const FOLD_RELEVANT = /[\p{Script=Latin}\p{Mn}]/u;
const FOLD_SHAPED = /[\p{Z}\p{Pd}\p{Pi}\p{Pf}\p{Cf}]/u;

export function unmappedNameChars(names: Iterable<string>): string[] {
  const bad = new Set<string>();
  for (const name of names) {
    for (const ch of name) {
      if (ch.codePointAt(0)! < 0x80) continue;
      if (FOLD_MAP.has(ch)) continue;
      if (!FOLD_RELEVANT.test(ch) && ch.toLowerCase() === ch && !FOLD_SHAPED.test(ch)) continue;
      bad.add(ch);
    }
  }
  return [...bad].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}

export function describeChars(chars: readonly string[]): string {
  return chars.map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}「${ch}」`).join(' ');
}

// 查询词归一：去首尾空白 + 折叠。路由要先拿它判空——ZWSP、软连字符这类不可见字符 trim() 不走，
// 折完才是空串；不先折就判空会拼出 `%%`（匹配全库），把「搜了个不可见字符」悄悄降级成「列出所有球员」。
export function foldNameQuery(query: string): string {
  return foldName(query.trim());
}

// 归一后的词 → LIKE 包含模式（转义元字符）。折叠在前（表里没有 \ % _ 这些 ASCII 元字符），
// 所以转义只需处理折叠后的串。
export function likeContains(folded: string): string {
  return `%${folded.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// 两步合一：单测与「拿到原始查询词」的调用方用这个。
export function foldNamePattern(query: string): string {
  return likeContains(foldNameQuery(query));
}
