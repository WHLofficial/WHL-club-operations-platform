// 读量定标台共用机件（v3.2.0 步骤 1 建、步骤 6 抽出成共享模块）。
//
// 为什么抽出来：步骤 6 要把球员库以外的读面（通知、市场、教练侧、管理端）也量一遍，
// 而那些端点全在鉴权后面。机件（假 D1 / 参数内联 / 打 wrangler）与球员库脚本逐字相同，
// 复制一份必然分叉（内联器的字符串字面量处理、% 的 cmd.exe 坑、Windows 偶发退出码都在细节里）。
//
// 三个平台坑（都会静默给出错误数字）：
// 1) `%` 不能原样进命令行：Windows 下 execSync 走 cmd.exe，`'%sesko%'` 会被当变量展开成 `''`，
//    LIKE 变成匹配全库的另一种形状。故字面量里的 % 一律拼成 char(37)。
// 2) 多行 SQL 折成单行、空白折叠必须跳过字符串字面量内部（'a  b' 里的两个空格是语义的一部分）。
// 3) 写语句绝不能拿去打生产：捕获的是「路由会执行什么」，而 GET 里也可能藏 UPDATE
//    （`/api/market/*` 每次请求前先 settleOverdue）。调用方必须用 selectOnly() 过滤后再测量。
import { execSync } from 'node:child_process';

// ---- 参数内联（扫描器，不能正则：要跳过字符串字面量） -----------------------------------------
export function quoteLiteral(v) {
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

export function inlineParams(sql, args) {
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

// 只留 SELECT：GET 处理器里也可能有写语句（市场端点先跑 settleOverdue），拿去打生产就是真写。
export function selectOnly(statements) {
  const keep = [];
  const skipped = [];
  for (const s of statements) {
    // 只放行纯读：SELECT，或**不含写动词**的 CTE（`WITH … DELETE/UPDATE/INSERT` 是合法的 SQLite
    // 写法，放行它等于把一条写语句送上生产）。测量工具宁可少测一条，也不冒写生产的风险。
    const reads =
      /^\s*SELECT\b/i.test(s.sql) ||
      (/^\s*WITH\b/i.test(s.sql) && !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s.sql));
    if (reads) keep.push(s);
    else skipped.push(s.sql.replace(/\s+/g, ' ').slice(0, 90));
  }
  return { keep, skipped };
}

// ---- 打生产 D1 读 meta ---------------------------------------------------------------------
export function runWrangler(sql, { local = false } = {}) {
  const target = local ? '--local' : '--remote';
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

// 生产 config 表全量（11 条左右的覆盖值）。为什么要全量而不是只取一个键：路由的分支取决于配置
// （市场结算的费率与窗口、`results_auto_confirm` 是否开启、`attendance_model` 的系数），
// 假 D1 若一律回 null，捕到的就是「配置全空」那条分支，读量形状与线上不符。
// 取不到就回空 Map —— 配置项全走 src/core/config.ts 的 CONFIG_DEFAULTS 兜底，与生产未覆盖时一致。
export function fetchConfigMap({ local = false } = {}) {
  const map = new Map();
  try {
    const out = execSync(
      `npx wrangler d1 execute whl-club ${local ? '--local' : '--remote'} --json --command "SELECT key, value FROM config"`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const parsed = JSON.parse(out.slice(out.indexOf('[')));
    for (const row of parsed[0]?.results ?? []) map.set(row.key, row.value);
  } catch {
    console.error('  取不到 config 表（不致命：全部走 CONFIG_DEFAULTS 兜底）');
  }
  return map;
}

// ---- 假 D1：只记录 SQL 与绑定参数 ------------------------------------------------------------
// first() 的行为要能撑住路由的分支：
// - 会话查询（FROM oidc_session）返回一份管理员 claims ⇒ 鉴权通过（步骤 6 新增：否则
//   requireAdmin/requireUser 会在 401 处提前退出，一条业务 SQL 都抓不到）；
// - 配置查询（FROM config）返回 { value }；
// - 其它查询返回「什么字段都读得出值」的代理行，否则详情类路由会在 `if (!row) throw 404`
//   处提前退出（club_id 给 1 是为了让它继续走 clubs 分支）。
export const PROBE_CLAIMS = {
  name: '读量探针',
  locked: false,
  must_change_pw: false,
  roles: ['admin'],
  permissions: [
    'club.clubs.manage',
    'club.bindings.unbind',
    'club.players.import',
    'club.ledger.manage',
    'club.registrations.manage',
    'club.compliance.view',
    'club.squad.manage',
    'club.registrations.submit',
  ],
};

export function makeCaptureDb(sink, { config = new Map() } = {}) {
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
      const isSession = /FROM\s+oidc_session/i.test(sql);
      const stmt = {
        bind(...args) {
          rec.args = args;
          return stmt;
        },
        all: async () => {
          // 管理端配置视图读全表（SELECT key, value FROM config）
          if (isConfig && rec.args.length === 0) {
            return { results: [...config].map(([key, value]) => ({ key, value })), success: true, meta: {} };
          }
          return { results: [], success: true, meta: {} };
        },
        first: async () => {
          if (isSession) return { sub: '1', claims: JSON.stringify(PROBE_CLAIMS) };
          // 按 key 回生产覆盖值；没有该行则回 null ⇒ 代码走 CONFIG_DEFAULTS（与生产一致）
          if (isConfig) return { value: config.get(rec.args[0]) ?? null };
          return benignRow;
        },
        run: async () => ({ success: true, meta: {} }),
        raw: async () => [],
      };
      return stmt;
    },
  };
}

const fakeKv = { get: async () => null, put: async () => undefined, delete: async () => undefined };

// 直调非 URL 入口（cron tick 的三段）时用的假 env：与 captureSurface 的 env 逐字一致。
export function makeFakeEnv(sink, { config = new Map() } = {}) {
  return {
    DB: makeCaptureDb(sink, { config }),
    TOUR_DB: makeCaptureDb(sink, { config }),
    AUTH_DB: makeCaptureDb(sink, { config }),
    SESSION_KV: fakeKv,
    AUTH_MODE: 'oidc',
    OIDC_ISSUER: 'https://auth.whleague.invalid',
    OIDC_CLIENT_ID: 'club',
    PUBLIC_CACHE_TTL_MS: '0',
  };
}

// ---- 调真实路由抓 SQL -----------------------------------------------------------------------
// module 必须是「被 index.ts 挂载的那个 app」；mount 是挂载前缀（index.ts 里 app.route(...) 的第一个参数）。
// 路径与线上逐字一致（路由模块内部写的是 /players、/club/squad 这类相对路径）。
export async function loadApp(rootUrl, module) {
  const mod = await import(new URL(module, rootUrl));
  return mod.default;
}

export async function captureSurface({ app, url, method = 'GET', body, config = new Map() }) {
  const sink = [];
  const env = makeFakeEnv(sink, { config });
  const init = {
    method,
    headers: {
      // OIDC 模式的会话 cookie：假 D1 对 oidc_session 的查询回一份管理员 claims
      cookie: '__Host-club_session=probe-token',
      'content-type': 'application/json',
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(new URL(url, 'http://capture.local'), init, env);
  if (res.status >= 400) {
    const text = await res.text();
    throw new Error(`路由返回 ${res.status}：${text.slice(0, 200)}`);
  }
  return sink;
}

// 把模块挂到 mount 前缀上（与 src/worker/index.ts 的挂法一致），返回可直接 request 的 app。
export async function mountApp(rootUrl, module, mount) {
  const { Hono } = await import('hono');
  const mod = await loadApp(rootUrl, module);
  const app = new Hono();
  app.route(mount, mod);
  return app;
}
