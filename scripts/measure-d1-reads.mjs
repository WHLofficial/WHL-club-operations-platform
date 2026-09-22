// 球员库读量定标台（增量 28 步骤 1）：把真实查询打到生产 D1，读 meta.rows_read。
//
// 为什么不用手抄 SQL：读量的形状完全由路由拼出来的表达式决定（sqlFold 的 87 项链、
// PS_COUNT_EXPR 的 15 槽计数、29 个排序表达式、各种 COALESCE/CAST/CASE），手抄一份必然与线上漂移，
// 而且漂移是静默的 —— 数字看着合理，其实测的是另一个查询。所以这里**直接调真实路由**：
// Hono 的 app.request() 在 Node 里可跑，注入一个只记录不执行的假 D1，把路由实际执行的 SQL
// 与绑定参数抓下来，再把参数内联成字面量交给 `wrangler d1 execute --remote`。
// 副作用（好的那个）：路由改了 SQL，重跑本脚本测到的就是新形状 —— 增量 28 步骤 7 的复测直接复用本脚本。
//
// 用法：
//   node scripts/measure-d1-reads.mjs                  # 全量形状打生产
//   node scripts/measure-d1-reads.mjs --only=default   # 只跑一个形状
//   node scripts/measure-d1-reads.mjs --dump           # 只打印抓到的 SQL，不执行（不花读量）
//   node scripts/measure-d1-reads.mjs --local          # 打本地 D1（本地只有 9 行夹具，仅用于验证脚本本身）
//   node scripts/measure-d1-reads.mjs --json-out=scripts/d1-read-audit/measurements.json
//
// 两个平台坑（都会静默给出错误数字）：
// 1) `%` 不能原样进命令行：Windows 下 execSync 走 cmd.exe，`'%sesko%'` 会被当变量展开成 `''`，
//    LIKE 变成匹配全库的另一种形状。故字面量里的 % 一律拼成 char(37)（SQLite 语义等价，优化器同样折叠）。
// 2) 多行 SQL 折成单行、空白折叠必须跳过字符串字面量内部（'a  b' 里的两个空格是语义的一部分）。
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const LOCAL = flag('local');
const DUMP = flag('dump');
const ONLY = opt('only');
const JSON_OUT = opt('json-out');

const ROOT = new URL('..', import.meta.url);
if (DUMP && JSON_OUT) {
  console.error('--dump 与 --json-out 不能同时用：dump 的条目里没有测量数据，写进 JSON 会把真数据覆盖成空壳');
  process.exit(2);
}
const playersApp = (await import(new URL('src/worker/routes/players.ts', ROOT))).default;

// ---- 假 D1：只记录 SQL 与绑定参数 ------------------------------------------------------------
// first() 的行为要能撑住路由的分支：
// - 配置查询（FROM config）返回 { value } —— 生产没有 attendance_model 行，所以通常是 { value: null }，
//   路由于是走 0.25/0.13 兜底（与线上一致）；
// - 其它查询（详情路由的球员行、列表路由的 COUNT 行）返回一个「什么字段都读得出值」的代理行，
//   否则详情路由会在 `if (!p) throw 404` 处提前退出，抓不到后面三条语句（club_id 给 1 是为了让它继续走 clubs 分支）。
function captureDb(sink, configValue) {
  const benignRow = new Proxy(
    {},
    {
      get: (_t, key) => (key === 'id' ? 1 : key === 'club_id' ? 1 : null),
      has: () => true,
    },
  );
  return {
    prepare(sql) {
      const rec = { sql, args: [] };
      sink.push(rec);
      const isConfig = /FROM\s+config/i.test(sql);
      const stmt = {
        bind(...args) {
          rec.args = args;
          return stmt;
        },
        all: async () => ({ results: [], success: true, meta: {} }),
        first: async () => (isConfig ? { value: configValue } : benignRow),
        run: async () => ({ success: true, meta: {} }),
        raw: async () => [],
      };
      return stmt;
    },
  };
}

async function capture(url, configValue) {
  const sink = [];
  // PUBLIC_CACHE_TTL_MS=0 让公开读缓存全部旁路（增量 28 起 ttlForScope 把 0 当「显式旁路」，
  // 对 players / roster / clubs 三个 scope 一律生效）⇒ 每次请求都真跑 loader、抓得到 SQL。
  const res = await playersApp.request(new URL(url, 'http://capture.local'), {}, { DB: captureDb(sink, configValue), PUBLIC_CACHE_TTL_MS: '0' });
  if (res.status >= 400) {
    const body = await res.text();
    throw new Error(`路由返回 ${res.status}：${body.slice(0, 200)}`);
  }
  return sink;
}

// ---- 参数内联（扫描器，不能正则：要跳过字符串字面量） -----------------------------------------
function quoteLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`数值参数不是有限数：${v}`);
    return String(v);
  }
  const s = String(v);
  if (s.includes('"')) throw new Error(`字面量含双引号，cmd.exe 下不安全：${s}`);
  if (!s.includes('%')) return `'${s.replace(/'/g, "''")}'`;
  const parts = [];
  s.split('%').forEach((piece, idx) => {
    if (idx > 0) parts.push('char(37)');
    if (piece !== '') parts.push(`'${piece.replace(/'/g, "''")}'`);
  });
  return parts.join(' || ');
}

function inlineParams(sql, args) {
  let out = '';
  let i = 0;
  let ai = 0;
  let inStr = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        inStr = false;
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += quoteLiteral(args[ai]);
      ai += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      while (i < sql.length && /\s/.test(sql[i])) i += 1;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  if (inStr) throw new Error('SQL 字符串字面量未闭合');
  if (ai !== args.length) throw new Error(`绑定参数个数不符：SQL 用掉 ${ai} 个，路由给了 ${args.length} 个`);
  return out.trim();
}

// ---- 打生产 D1 读 meta ---------------------------------------------------------------------
function runWrangler(sql) {
  const target = LOCAL ? '--local' : '--remote';
  const cmd = `npx wrangler d1 execute whl-club ${target} --json --command "${sql}"`;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out.slice(out.indexOf('[')));
      return parsed.map((s) => ({
        rows_read: s.meta?.rows_read ?? null,
        rows_written: s.meta?.rows_written ?? null,
        duration_ms: s.meta?.duration ?? null,
      }));
    } catch (e) {
      lastErr = e;
      // 已知的 Windows 偶发：exit 3221226505 + libuv 断言，重跑即过
      const msg = String(e.stderr ?? e.message ?? '');
      if (!/3221226505|UV_HANDLE_CLOSING|ETIMEDOUT|ECONNRESET/.test(msg) || attempt === 3) throw e;
      console.error(`   [retry ${attempt}] wrangler 偶发失败，重跑`);
    }
  }
  throw lastErr;
}

// ---- 形状清单 ------------------------------------------------------------------------------
// 每个形状 = 一个真实 URL。路由自己会跑多条语句（配置探测 + 列表主查询；增量 28 步骤 2 之前的版本还带一条 COUNT），
// 全部按序记录并逐条报读量。语句归类用 SQL 文本判断（见 printTable），不按「第几条」——路由增删语句时序号会漂。
const SHAPES = [
  { id: 'default', label: '默认浏览（第 1 页，limit 20）', url: '/players?limit=20' },
  { id: 'page5', label: '第 5 页（cursor=100）', url: '/players?limit=20&cursor=100' },
  { id: 'view-initial', label: '初始视图（base_ca / json PA）', url: '/players?limit=20&view=initial' },
  { id: 'sort-id', label: 'sort=id（PK）', url: '/players?limit=20&sort=id' },
  { id: 'sort-ca', label: 'sort=ca（0027 表达式索引）', url: '/players?limit=20&sort=ca' },
  { id: 'sort-pa', label: 'sort=pa（0027 表达式索引）', url: '/players?limit=20&sort=pa' },
  { id: 'sort-age', label: 'sort=age（0027 表达式索引）', url: '/players?limit=20&sort=age' },
  { id: 'sort-market-value', label: 'sort=market_value（0027 表达式索引）', url: '/players?limit=20&sort=market_value' },
  { id: 'sort-ca-initial', label: 'view=initial + sort=ca（口径变了，0027 索引是否还命中）', url: '/players?limit=20&view=initial&sort=ca' },
  { id: 'sort-club', label: 'sort=club（clubs.id 权重；0029 表达式索引）', url: '/players?limit=20&sort=club' },
  { id: 'sort-status', label: 'sort=status（CASE 权重；0029 表达式索引）', url: '/players?limit=20&sort=status' },
  { id: 'sort-wage', label: 'sort=wage（contracts 表，无法静态索引）', url: '/players?limit=20&sort=wage' },
  { id: 'sort-prestige', label: 'sort=prestige（0029 表达式索引）', url: '/players?limit=20&sort=prestige' },
  { id: 'sort-name', label: 'sort=name（无索引 + 折叠表达式）', url: '/players?limit=20&sort=name' },
  { id: 'sort-ps', label: 'sort=ps（15 槽计数表达式）', url: '/players?limit=20&sort=ps' },
  { id: 'sort-influence', label: 'sort=influence（CASE + ROUND 表达式）', url: '/players?limit=20&sort=influence' },
  { id: 'sort-uid', label: 'sort=uid（CAST/SUBSTR 表达式）', url: '/players?limit=20&sort=uid' },
  { id: 'sort-years', label: 'sort=years（含窗刻度子查询）', url: '/players?limit=20&sort=years' },
  { id: 'sort-protected', label: 'sort=protected（含窗刻度子查询）', url: '/players?limit=20&sort=protected' },
  { id: 'filter-club', label: 'club_id=5（有索引）', url: '/players?limit=20&club_id=5' },
  { id: 'filter-club-free', label: 'club_id=free（club_id IS NULL，17,731 名自由身）', url: '/players?limit=20&club_id=free' },
  { id: 'filter-status', label: 'status=normal（有索引）', url: '/players?limit=20&status=normal' },
  { id: 'filter-growable', label: 'growable=1（无索引）', url: '/players?limit=20&growable=1' },
  { id: 'filter-position', label: 'position=ST（主列 + PosID2-4 槽 OR）', url: '/players?limit=20&position=ST' },
  { id: 'filter-ps', label: 'ps=25（12 个银槽 OR）', url: '/players?limit=20&ps=25' },
  { id: 'filter-attr', label: 'attr=sprintspeed & attr_min=80', url: '/players?limit=20&attr=sprintspeed&attr_min=80' },
  { id: 'filter-ca', label: 'ca_min=80（不匹配 0027 表达式索引）', url: '/players?limit=20&ca_min=80' },
  { id: 'filter-name', label: 'name=sesko（折叠 LIKE）', url: '/players?limit=20&name=sesko' },
  { id: 'roster', label: '名册端点（固定键，group_concat 全表）', url: '/players/roster' },
  { id: 'detail', label: '球员详情（4 条窄查询）', url: '/players/1' },
];

// ---- 设计探针（手写 SQL，不是路由形状） ------------------------------------------------------
// 用途：给步骤 4 的「物化建索引 vs 改查询结构」提供证据。实测结论（2026-09-22）：
// - 无索引排序的主查询读 37,635 行，而「只选 id、不 join 的全表扫 + 排序」就已 36,602 行
//   ⇒ 成本几乎全在全表扫本身，join 探针只占 ~1,000 行；
// - 于是「两段式（先选 21 个 id 再 join 补字段）」实测 36,654 行，只省 2.6%，假设不成立；
// - 全表扫**不带排序**只要 18,301 行（1 行/行），带排序是 36,602 行（2 行/行）；
// - 能提前停下的路径（rowid 序、0027 表达式索引）是 21–64 行。
// 结论：全表扫形状的唯一出路是「让它能走索引提前停下」，写配额因此成为步骤 4 的硬约束。
const PROBES = [
  {
    id: 'probe-inner-only',
    label: '探针：全表扫 + 排序，只选 id 不 join',
    sql: ['SELECT COUNT(*) AS n FROM (SELECT players.id FROM players ORDER BY COALESCE(players.prestige, 0) DESC, players.id DESC LIMIT 21)'],
  },
  {
    id: 'probe-two-phase',
    label: '探针：两段式（21 个 id 先选出，再 join 补字段）——实测只省 2.6%',
    sql: [
      `WITH page AS (SELECT players.id FROM players ORDER BY COALESCE(players.prestige, 0) DESC, players.id DESC LIMIT 21)
       SELECT players.id, players.name, cc.name AS club_name, ct.wage AS ct_wage
       FROM page JOIN players ON players.id = page.id
       LEFT JOIN clubs cc ON cc.id = players.club_id
       LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1`,
    ],
  },
  {
    id: 'probe-scan-nosort',
    label: '探针：全表扫、不排序（growable=1）',
    sql: ['SELECT COUNT(*) AS n FROM (SELECT id FROM players WHERE growable = 1)'],
  },
  {
    id: 'probe-early-stop',
    label: '探针：能提前停下的路径（rowid 序 LIMIT 21）',
    sql: ['SELECT COUNT(*) AS n FROM (SELECT id FROM players ORDER BY id LIMIT 21)'],
  },
  {
    id: 'probe-join-only',
    label: '探针：同扫描基数与排序，只加两个 LEFT JOIN（隔离 join 成本）',
    sql: [
      `SELECT COUNT(*) AS n FROM (
         SELECT players.id FROM players
         LEFT JOIN clubs cc ON cc.id = players.club_id
         LEFT JOIN contracts ct ON ct.player_id = players.id AND ct.is_active = 1
         ORDER BY COALESCE(players.prestige, 0) DESC, players.id DESC LIMIT 21)`,
    ],
  },
  {
    id: 'probe-count-nojoin',
    label: '探针：COUNT 去掉 LEFT JOIN（无筛选）',
    sql: ['SELECT COUNT(*) AS n FROM players'],
  },
];

// ---- 主流程 --------------------------------------------------------------------------------
console.error('读取生产配置 attendance_model（只为让排序表达式里的系数与线上一致）…');
let configValue = null;
try {
  const out = execSync(`npx wrangler d1 execute whl-club ${LOCAL ? '--local' : '--remote'} --json --command "SELECT value FROM config WHERE key = 'attendance_model'"`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  configValue = parsed[0]?.results?.[0]?.value ?? null;
} catch {
  console.error('  取不到（不致命：influenceCoefs 会退回 0.25/0.13 兜底，形状与线上一致）');
}
console.error(`  attendance_model = ${configValue ? `${configValue.slice(0, 60)}…` : '（空）'}`);

const work = flag('probes') ? PROBES : SHAPES;
const results = [];
for (const shape of work) {
  if (ONLY && shape.id !== ONLY) continue;
  let inlined;
  if (shape.sql) {
    // 手写探针：不经路由捕获，但照样过一遍内联器 —— 它同时负责折叠空白（多行 SQL 进 --command
    // 会偶发失败）并断言没有漏掉的 ? 占位符
    inlined = shape.sql.map((s) => inlineParams(s, []));
  } else {
    let statements;
    try {
      statements = await capture(shape.url, configValue);
    } catch (e) {
      results.push({ ...shape, error: String(e.message ?? e) });
      console.error(`✗ ${shape.id}：抓取 SQL 失败 —— ${e.message ?? e}`);
      continue;
    }
    inlined = statements.map((s) => inlineParams(s.sql, s.args));
  }
  const where = shape.url ?? '（手写 SQL）';
  if (DUMP) {
    console.log(`\n=== ${shape.id} · ${shape.label} · ${where} · ${inlined.length} 条语句`);
    inlined.forEach((sql, i) => console.log(`--- [${i}] ${sql}`));
    results.push({ ...shape, statements: inlined.length, sql: inlined });
    continue;
  }
  const metas = [];
  for (const sql of inlined) {
    try {
      const m = runWrangler(sql);
      // 一条命令里多条语句时 meta 按序返回；只取一条语句的形状就是单元素
      metas.push(...m);
    } catch (e) {
      metas.push({ error: String(e.stderr ?? e.message ?? e).slice(0, 300) });
    }
  }
  const total = metas.reduce((acc, m) => acc + (typeof m.rows_read === 'number' ? m.rows_read : 0), 0);
  const dur = metas.reduce((acc, m) => acc + (typeof m.duration_ms === 'number' ? m.duration_ms : 0), 0);
  // 语句归类按 SQL 文本、不按序号：列表主查询内联了 CURRENT_TICKS_SQL（自带 COUNT(*)），
  // 用 /COUNT\(\*\)/ 会把它当成计数语句 ⇒ 计数判据必须锚在语句开头。
  const rowsOf = (re) =>
    inlined.reduce((acc, sql, i) => acc + (re.test(sql) && typeof metas[i]?.rows_read === 'number' ? metas[i].rows_read : 0), 0);
  const listRows = rowsOf(/LEFT JOIN clubs cc/);
  const countRows = rowsOf(/^\s*SELECT COUNT\(\*\) AS n FROM players/);
  results.push({
    ...shape,
    statements: inlined.length,
    metas,
    rows_read_total: total,
    duration_ms_total: Number(dur.toFixed(1)),
    list_rows: listRows,
    count_rows: countRows,
  });
  const per = metas.map((m) => (m.error ? `ERR(${m.error.slice(0, 60)})` : `${m.rows_read}`)).join(' + ');
  console.error(`✓ ${shape.id.padEnd(18)} ${String(total).padStart(8)} 行  [${per}]  ${dur.toFixed(0)}ms  · ${shape.label}`);
}

if (DUMP) {
  console.error(`\n（--dump：只打印 SQL，未执行。共 ${results.length} 个形状）`);
} else {
  const grand = results.reduce((acc, r) => acc + (r.rows_read_total ?? 0), 0);
  console.error(`\n合计读量：${grand.toLocaleString('en-US')} 行（本次测量消耗；免费档 5,000,000 行/日）`);
  console.log('\n| 形状 | URL | 语句数 | 单次读量（行） | 列表 | 计数 | 其它 | 耗时 ms |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const cell = r.url ? `\`${r.url}\`` : '（手写）';
    if (r.error) {
      console.log(`| ${r.label} | ${cell} | — | 失败：${r.error} | — | — | — | — |`);
      continue;
    }
    // 归类在采集时算好（见 rowsOf）；旧 JSON 条目没有这两个字段时按 0 处理
    const listRows = r.list_rows ?? 0;
    const countRows = r.count_rows ?? 0;
    const other = r.rows_read_total - listRows - countRows;
    console.log(
      `| ${r.label} | ${cell} | ${r.statements} | ${r.rows_read_total} | ${listRows} | ${countRows} | ${other} | ${r.duration_ms_total} |`,
    );
  }
}

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  // 增量合并：形状与探针分两次跑（--only / --probes）时，后跑的结果按 id 覆盖前一次的同名条目，
  // 免得为了补一个形状重跑全套（重跑一次全套 ≈ 65 万行读）。
  let prev = { results: [] };
  try {
    prev = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    // 首次运行没有旧文件
  }
  const merged = new Map((prev.results ?? []).map((r) => [r.id, r]));
  for (const r of results) {
    const before = merged.get(r.id);
    // 别让「没测到数」的结果覆盖上一次的真实测量：报错的条目只有 error、--dump 的条目没有 metas
    if (before && before.metas && !r.metas) continue;
    merged.set(r.id, r);
  }
  writeFileSync(JSON_OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), target: LOCAL ? 'local' : 'remote', results: [...merged.values()] }, null, 2)}\n`);
  console.error(`已写出 ${JSON_OUT}（累计 ${merged.size} 条）`);
}
