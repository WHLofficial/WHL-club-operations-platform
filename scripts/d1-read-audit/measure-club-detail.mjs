// 增量 31 步骤 6：球队详情两条端点（`GET /api/clubs/:id`、`GET /api/clubs/:id/standing`）的读量量化。
//
// 为什么不是手抄 SQL 去量：详情端点的语句形状取决于分支（有没有比赛系统映射、有没有可见赛季、
// 当季报了几座定级赛事、有没有转会记录）。手抄一份就等于把路由复制一遍，日后必然分叉。
// 这里改成**调真实路由**：假 D1 记录路由真正执行了什么，再逐条内联参数打生产量 rows_read。
//
// 假 D1 的回值必须与生产同形，否则路由会走降级分支、少抓几条语句：
//   clubs 单行（active）→ seasons 可见赛季 9 → AUTH_DB team 映射 tid=73 →
//   season_tournaments 两座定级赛事 → TOUR_DB entry 报 1 座 ⇒ tournamentId 落定。
//
// 三个库分别对应：DB=whl-club、AUTH_DB=whl-auth、TOUR_DB=whl。
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { inlineParams, selectOnly, mountApp } from './harness.mjs';

const ROOT = new URL('../../', import.meta.url);
const q = (s) => s.replace(/\s+/g, ' ').trim();

const DB_NAME = { DB: 'whl-club', AUTH_DB: 'whl-auth', TOUR_DB: 'whl' };

// ---- 假 D1：记录 SQL + 回生产同形的值 ---------------------------------------------------------
const CLAIMS = {
  name: '读量探针',
  locked: false,
  must_change_pw: false,
  roles: ['club.admin'],
  permissions: ['club.clubs.manage', 'club.squad.manage', 'club.ledger.manage'],
};

function makeDb(which, sink) {
  const one = (sql) => {
    if (/FROM\s+oidc_session/i.test(sql)) return { sub: '1', claims: JSON.stringify(CLAIMS) };
    if (/FROM\s+seasons/i.test(sql)) return { season: 9 };
    if (/FROM\s+season_windows/i.test(sql)) return { n: 12 };
    if (/FROM\s+clubs/i.test(sql)) {
      return { id: 1, name: '阿森纳', is_cpu: 0, league_tier: 'premier', status: 'active' };
    }
    if (which === 'AUTH_DB' && /FROM\s+team/i.test(sql)) return { tid: 73 };
    if (which === 'TOUR_DB' && /FROM\s+team/i.test(sql)) return { name: '阿森纳' };
    return null;
  };
  const many = (sql) => {
    if (/FROM\s+season_tournaments/i.test(sql)) {
      return [
        { tid: 1, ct: 'league_premier' },
        { tid: 2, ct: 'league_second' },
      ];
    }
    if (/FROM\s+entry/i.test(sql)) return [{ team: 73, tid: 1 }];
    if (/FROM\s+team/i.test(sql)) return [{ id: 73, logo_key: 'team/73/1.png' }];
    return [];
  };
  return {
    prepare(sql) {
      const rec = { sql, args: [] };
      sink.push(rec);
      const stmt = {
        bind(...args) {
          rec.args = args;
          return stmt;
        },
        all: async () => ({ results: many(rec.sql), success: true, meta: {} }),
        first: async () => one(rec.sql),
        run: async () => ({ success: true, meta: {} }),
        raw: async () => [],
      };
      return stmt;
    },
  };
}

const fakeKv = { get: async () => null, put: async () => undefined, delete: async () => undefined };

// 排名代理要打比赛系统：本沙箱出不了外网，桩掉 fetch 只为让路由走完整条路（形状与线上一致）。
const STANDINGS_BODY = {
  standings: [
    {
      stageId: 1,
      kind: 'round_robin',
      name: '常规赛',
      sortOrder: 1,
      groups: [
        {
          groupId: 1,
          name: 'A 组',
          rows: [
            { entryId: 11, teamName: '曼城', played: 5, won: 4, drawn: 1, lost: 0, goalsFor: 12, goalsAgainst: 4, pts: 13, pointsDeducted: 0, rank: 0 },
            { entryId: 12, teamName: '阿森纳', played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 10, goalsAgainst: 6, pts: 10, pointsDeducted: 0, rank: 0 },
          ],
        },
      ],
    },
  ],
  rankZones: [],
};

async function capture(path) {
  const sinks = { DB: [], AUTH_DB: [], TOUR_DB: [] };
  const env = {
    DB: makeDb('DB', sinks.DB),
    AUTH_DB: makeDb('AUTH_DB', sinks.AUTH_DB),
    TOUR_DB: makeDb('TOUR_DB', sinks.TOUR_DB),
    SESSION_KV: fakeKv,
    MEDIA: {},
    ASSETS: {},
    AUTH_MODE: 'oidc',
    OIDC_ISSUER: 'https://auth.whleague.invalid',
    OIDC_CLIENT_ID: 'club',
    TOUR_API_BASE: 'https://tour.test',
    PUBLIC_CACHE_TTL_MS: '0',
  };
  const app = await mountApp(ROOT, './src/worker/routes/clubs.ts', '/api');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(STANDINGS_BODY), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await app.request(
      new URL(path, 'http://capture.local'),
      { headers: { cookie: '__Host-club_session=probe-token', accept: 'application/json' } },
      env,
    );
    if (res.status >= 400) throw new Error(`${path} 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  } finally {
    globalThis.fetch = realFetch;
  }
  const out = [];
  for (const which of Object.keys(sinks)) {
    for (const rec of sinks[which]) out.push({ db: which, sql: rec.sql, args: rec.args });
  }
  return out;
}

// ---- 打生产量 -------------------------------------------------------------------------------
function measure(sql) {
  const cmd = `npx wrangler d1 execute whl-club --remote --json --command "${sql}"`;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out.slice(out.indexOf('[')));
      return { rows_read: parsed[0]?.meta?.rows_read ?? null, duration_ms: parsed[0]?.meta?.duration ?? null };
    } catch (e) {
      lastErr = e;
      const msg = String(e.stderr ?? e.message ?? '');
      if (!/3221226505|UV_HANDLE_CLOSING|ETIMEDOUT|ECONNRESET/.test(msg) || attempt === 3) throw e;
      console.error(`   [retry ${attempt}] wrangler 偶发失败，重跑`);
    }
  }
  throw lastErr;
}

// 跨库形状：把 db 名换掉再打（harness 的 runWrangler 硬编码 whl-club，故这里自带一份）。
function measureOn(dbName, sql) {
  if (dbName === 'whl-club') return measure(sql);
  const cmd = `npx wrangler d1 execute ${dbName} --remote --json --command "${sql}"`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed = JSON.parse(out.slice(out.indexOf('[')));
      return { rows_read: parsed[0]?.meta?.rows_read ?? null, duration_ms: parsed[0]?.meta?.duration ?? null };
    } catch (e) {
      const msg = String(e.stderr ?? e.message ?? '');
      if (!/3221226505|UV_HANDLE_CLOSING|ETIMEDOUT|ECONNRESET/.test(msg) || attempt === 3) throw e;
      console.error(`   [retry ${attempt}] ${dbName} 偶发失败，重跑`);
    }
  }
}

const label = (rec) => {
  const s = q(rec.sql);
  if (/FROM\s+oidc_session/i.test(s)) return '鉴权：会话行';
  if (/FROM\s+clubs/i.test(s)) return rec.db === 'DB' ? '球队单行' : '球队单行';
  if (/FROM\s+seasons/i.test(s)) return '可见赛季';
  if (/FROM\s+season_windows/i.test(s)) return '已闭合常规窗口数（刻度）';
  if (/FROM\s+season_tournaments/i.test(s)) return '当季定级赛事清单';
  if (rec.db === 'AUTH_DB' && /FROM\s+team/i.test(s)) return '俱乐部→比赛系统球队映射';
  if (rec.db === 'TOUR_DB' && /FROM\s+entry/i.test(s)) return '定级赛事报名行';
  if (rec.db === 'TOUR_DB' && /FROM\s+team/i.test(s)) return /WHERE\s+id\s+IN/i.test(s) ? '队徽（比赛系统 team）' : '认队名（比赛系统 team）';
  if (/FROM\s+players/i.test(s)) return '阵容结构（单队全部行）';
  if (/FROM\s+transfers/i.test(s)) return '转会往来（转入/转出各一条）';
  if (/FROM\s+result_confirmations/i.test(s)) return '近期战绩';
  return '其它';
};

// 默认量两队：club 1（常规样本）与 club 9（生产阵容最大的队，37 人）——验收看的是最坏情况。
// 命令行给 id 则只量给的那些。
const CLUB_IDS = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (CLUB_IDS.length === 0) CLUB_IDS.push(1, 9);

const run = async () => {
  const rows = [];
  const perClub = [];
  for (const clubId of CLUB_IDS) {
    const detail = await capture(`/api/clubs/${clubId}`);
    const standing = await capture(`/api/clubs/${clubId}/standing`);

    const measureOne = (rec, endpoint) => {
      const { keep } = selectOnly([rec]);
      if (keep.length === 0) {
        rows.push({ club: clubId, endpoint, db: DB_NAME[rec.db], label: label(rec), sql: q(rec.sql), rows_read: null, skipped: '写语句，不测' });
        return;
      }
      const inlined = inlineParams(rec.sql, rec.args);
      const m = measureOn(DB_NAME[rec.db], inlined);
      rows.push({ club: clubId, endpoint, db: DB_NAME[rec.db], label: label(rec), sql: q(inlined), ...m });
    };
    for (const rec of detail) measureOne(rec, 'GET /api/clubs/:id');
    for (const rec of standing) measureOne(rec, 'GET /api/clubs/:id/standing');

    const pick = (endpoint) => rows.filter((r) => r.club === clubId && r.endpoint === endpoint);
    const sum = (endpoint) => pick(endpoint).reduce((a, r) => a + (r.rows_read ?? 0), 0);
    perClub.push({
      club: clubId,
      endpoints: [
        { endpoint: 'GET /api/clubs/:id', statements: pick('GET /api/clubs/:id').length, rows_read_total: sum('GET /api/clubs/:id') },
        { endpoint: 'GET /api/clubs/:id/standing', statements: pick('GET /api/clubs/:id/standing').length, rows_read_total: sum('GET /api/clubs/:id/standing') },
      ],
    });
  }

  const out = {
    measured_at: new Date().toISOString(),
    note: '调真实路由抓 SQL 后逐条内联参数打生产；鉴权行也算在内（线上真实请求同样要付）。验收线：详情 ≤500 行',
    clubs: perClub,
    statements: rows,
  };
  writeFileSync(new URL('./club-detail-measurements.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);

  for (const c of perClub) {
    for (const e of c.endpoints) console.log(`club ${c.club}  ${e.endpoint}  ${e.statements} 条语句  合计 ${e.rows_read_total} 行`);
  }
  for (const r of rows) {
    console.log(`  club ${r.club}  ${String(r.rows_read ?? '-').padStart(7)} 行  [${r.db}] ${r.label}  ${r.sql.slice(0, 100)}`);
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
