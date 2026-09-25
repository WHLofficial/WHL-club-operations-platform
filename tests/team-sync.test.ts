// v6.1.0：球队建档双向同步（club 侧）——入站验签矩阵、幂等、对账 diff、出站推送、缓存失效登记。
// 出站方向与赛事仓 tests/clubTeamSync.test.ts 是同一份契约的两半：签名串 POST|path|ts|raw、±300s 窗口。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1, sqlGet } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { computeTeamSyncDiff } from '../src/worker/routes/admin/teamSync.ts';
import { TEAM_UPSERT_PATH, pushTeamToTour } from '../src/worker/tourClient.ts';
import { TEAM_SYNC_CLOCK_SKEW_S, hmacHex, verifyTeamSync } from '../src/lib/hmac.ts';
import { scopesForWritePath } from '../src/lib/cache-policy.ts';

const SYNC_SECRET = 'test-team-sync-secret';
const TOUR_BASE = 'http://tour.test';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
}

function freshEnv(opts: { auth?: boolean; noSecret?: boolean } = {}): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '管理组甲', 'admin', 0, 0);
     CREATE TABLE team (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');
     INSERT INTO team (id, org_id, name) VALUES (500, 1, '游戏里的队'), (501, 1, '两边不同名');`,
  );
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: kv as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    TOUR_API_BASE: TOUR_BASE,
    TEAM_SYNC_SECRET: opts.noSecret ? undefined : SYNC_SECRET,
  };
  if (opts.auth) {
    const authSqlite = new DatabaseSync(':memory:');
    authSqlite.exec(
      `CREATE TABLE team (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_team_id INTEGER UNIQUE NOT NULL, club_id INTEGER, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z');`,
    );
    env.AUTH_DB = createTestD1(authSqlite);
    env.OIDC_ISSUER = 'http://auth.local';
    env.AUTH_BIND_SECRET = 'test-secret';
  }
  kv.set('sess:tok-admin', JSON.stringify({ userId: 1 }));
  return { env, sqlite, tour };
}

// ---- fetch 桩：入站端点自身不发请求；出站推送与 auth 目录登记共用这一个桩 ----
let reqs: { url: string; path: string; headers: Record<string, string>; body: string }[] = [];
let reply: (path: string) => { status: number; json: Record<string, unknown> } = () => ({
  status: 200,
  json: { ok: true, teamId: 1 },
});

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const path = new URL(u).pathname;
      reqs.push({
        url: u,
        path,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ''),
      });
      const r = reply(path);
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  reqs = [];
  reply = () => ({ status: 200, json: { ok: true, teamId: 1 } });
});

/** 按赛事仓同款规范串签一次入站调用（o.secret=null 表示「没配密钥」的调用方视角）。 */
function inbound(
  env: Env,
  body: unknown,
  o: { secret?: string | null; ts?: string; sign?: string; omitSign?: boolean; raw?: string } = {},
) {
  const raw = o.raw ?? JSON.stringify(body);
  const ts = o.ts ?? String(Math.floor(Date.now() / 1000));
  const secret = o.secret === undefined ? SYNC_SECRET : o.secret;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-timestamp': ts };
  if (!o.omitSign) {
    headers['x-sign'] =
      o.sign ?? createHmac('sha256', secret ?? '').update(`POST|${TEAM_UPSERT_PATH}|${ts}|${raw}`).digest('hex');
  }
  return app.request(TEAM_UPSERT_PATH, { method: 'POST', headers, body: raw }, env);
}

function adminGet(path: string, env: Env) {
  return app.request(path, { method: 'GET', headers: { Cookie: 'whl_session=tok-admin' } }, env);
}

function adminPost(path: string, body: unknown, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: 'whl_session=tok-admin' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('入站机器端点 POST /api/internal/team-upsert（v6.1.0）', () => {
  it('正签：建档 + auth 目录登记（带 club_id）+ 审计 actor 留空', async () => {
    const fx = freshEnv({ auth: true });
    stubFetch();
    const res = await inbound(fx.env, { id: 700, name: '推来的队' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; created: boolean; authLinked: boolean | null };
    expect(body).toMatchObject({ ok: true, created: true, authLinked: true });

    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 700')).toEqual({ name: '推来的队' });
    expect(reqs.map((r) => r.path)).toEqual(['/api/team/register']);
    expect(JSON.parse(reqs[0].body)).toEqual({ tour_team_id: 700, name: '推来的队', club_id: 700 });

    const audit = sqlGet<{ actor: number | null; action: string; target_id: number }>(
      fx.sqlite,
      'SELECT actor, action, target_id FROM audit_log ORDER BY id DESC LIMIT 1',
    );
    expect(audit).toEqual({ actor: null, action: 'club_create', target_id: 700 });
  });

  it('认证中心拒绝登记（club_id 已被别的球队占了 → 400 club_taken）不阻断建档：authLinked=false，俱乐部行仍在', async () => {
    const fx = freshEnv({ auth: true });
    stubFetch();
    reply = (path) =>
      path === '/api/team/register'
        ? { status: 400, json: { error: 'club_taken', message: '该俱乐部已关联其他球队' } }
        : { status: 200, json: { ok: true } };
    const res = await inbound(fx.env, { id: 700, name: '认证中心不认也要建' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, created: true, authLinked: false });
    // 建档是主操作，目录登记是可重试的旁路——不回滚，管理端能点「重新登记」补
    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 700')).toEqual({
      name: '认证中心不认也要建',
    });
  });

  it('幂等：同号已有俱乐部 → 200 created:false，不覆写；名字不同报 nameDiffers', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES (700, '本仓的名字', 'active', '2026-01-01T00:00:00Z')`);
    const res = await inbound(fx.env, { id: 700, name: '推来的名字' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: false, name: '本仓的名字', nameDiffers: true });
    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 700')).toEqual({ name: '本仓的名字' });

    const same = await inbound(fx.env, { id: 700, name: '本仓的名字' });
    expect((await same.json()) as { nameDiffers: boolean }).toMatchObject({ nameDiffers: false });
  });

  it('签名矩阵：错签 403 / 缺签名 403 / 时间戳过期 403 / 时间戳非数字 403', async () => {
    const fx = freshEnv();
    expect((await inbound(fx.env, { id: 700, name: 'A' }, { sign: 'f'.repeat(64) })).status).toBe(403);
    expect((await inbound(fx.env, { id: 700, name: 'A' }, { omitSign: true })).status).toBe(403);
    const stale = String(Math.floor(Date.now() / 1000) - 400);
    expect((await inbound(fx.env, { id: 700, name: 'A' }, { ts: stale })).status).toBe(403);
    expect((await inbound(fx.env, { id: 700, name: 'A' }, { ts: 'not-a-number' })).status).toBe(403);
    // 都没建出行
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 700')).toBeUndefined();
  });

  it('换一把密钥签 → 403（密钥就是边界）', async () => {
    const fx = freshEnv();
    expect((await inbound(fx.env, { id: 700, name: 'A' }, { secret: '别的密钥' })).status).toBe(403);
  });

  it('未配 TEAM_SYNC_SECRET → 503（写端点 fail-closed，不像 cron 守卫那样放行）', async () => {
    const fx = freshEnv({ noSecret: true });
    const res = await inbound(fx.env, { id: 700, name: 'A' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'unconfigured' });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 700')).toBeUndefined();
  });

  it('入参校验：id 非正整数 400 / 名字为空或超 40 400 / 坏 JSON 400', async () => {
    const fx = freshEnv();
    expect((await inbound(fx.env, { id: 0, name: 'A' })).status).toBe(400);
    expect((await inbound(fx.env, { id: 'x', name: 'A' })).status).toBe(400);
    expect((await inbound(fx.env, { id: 700, name: '   ' })).status).toBe(400);
    expect((await inbound(fx.env, { id: 700, name: 'x'.repeat(41) })).status).toBe(400);
    expect((await inbound(fx.env, {}, { raw: '{不是 JSON' })).status).toBe(400);
  });

  it('名字被别的队占用 → 409，且不改动原俱乐部', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES (701, '撞名队', 'active', '2026-01-01T00:00:00Z')`);
    const res = await inbound(fx.env, { id: 702, name: '撞名队' });
    expect(res.status).toBe(409);
    expect((await res.json()) as { message: string }).toMatchObject({ message: '俱乐部名字已存在' });
    expect(sqlGet(fx.sqlite, 'SELECT name FROM clubs WHERE id = 701')).toEqual({ name: '撞名队' });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 702')).toBeUndefined();
  });
});

describe('公开缓存失效登记（v6.1.0）', () => {
  it('写路径 /api/internal 命中 PUBLIC_SCOPES——否则建了俱乐部公开目录最长陈旧 24h', () => {
    expect(scopesForWritePath('/api/internal/team-upsert')).toEqual(['players', 'roster', 'clubs']);
    expect(scopesForWritePath('/api/internal')).toEqual(['players', 'roster', 'clubs']);
    // 边界：前缀只按路径段匹配，/api/internals 不该命中
    expect(scopesForWritePath('/api/internals')).toEqual([]);
  });
});

describe('computeTeamSyncDiff 纯函数', () => {
  it('三类差异各归各类，同号同名不算差异', () => {
    const diff = computeTeamSyncDiff(
      [
        { id: 1, name: '只有球队' },
        { id: 2, name: '两边同名' },
        { id: 3, name: 'tour 侧名' },
      ],
      [
        { id: 2, name: '两边同名' },
        { id: 3, name: 'club 侧名' },
        { id: 4, name: '只有俱乐部' },
      ],
    );
    expect(diff).toEqual({
      onlyTour: [{ id: 1, name: '只有球队' }],
      onlyClub: [{ id: 4, name: '只有俱乐部' }],
      nameDiffers: [{ id: 3, tourName: 'tour 侧名', clubName: 'club 侧名' }],
    });
  });

  it('空集：两侧都空 → 无差异', () => {
    expect(computeTeamSyncDiff([], [])).toEqual({ onlyTour: [], onlyClub: [], nameDiffers: [] });
  });
});

describe('对账端点 GET /api/admin/team-sync + POST /apply（v6.1.0）', () => {
  it('未登录 → 401', async () => {
    const fx = freshEnv();
    expect((await app.request('/api/admin/team-sync', { method: 'GET' }, fx.env)).status).toBe(401);
  });

  it('GET 报出三类差异（tour 有 club 无 / club 有 tour 无 / 名字不一致）', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES
      (501, 'club 侧名', 'active', '2026-01-01T00:00:00Z'),
      (900, '孤儿俱乐部', 'active', '2026-01-01T00:00:00Z')`);
    const res = await adminGet('/api/admin/team-sync', fx.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      onlyTour: [{ id: 500, name: '游戏里的队' }],
      onlyClub: [{ id: 900, name: '孤儿俱乐部' }],
      nameDiffers: [{ id: 501, tourName: '两边不同名', clubName: 'club 侧名' }],
      truncated: false,
    });
  });

  it('apply create-club 补齐差异；再 apply 一次 → 409（每次重算，不照旧清单盲写）', async () => {
    const fx = freshEnv();
    const res = await adminPost('/api/admin/team-sync/apply', { id: 500, action: 'create-club' }, fx.env);
    expect(res.status).toBe(201);
    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 500')).toEqual({ name: '游戏里的队' });
    const again = await adminPost('/api/admin/team-sync/apply', { id: 500, action: 'create-club' }, fx.env);
    expect(again.status).toBe(409);
  });

  it('apply create-tour 推给赛事系统（断言路径 + 规范串签名）；推送失败 → 502', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES (900, '孤儿俱乐部', 'active', '2026-01-01T00:00:00Z')`);
    stubFetch();
    const res = await adminPost('/api/admin/team-sync/apply', { id: 900, action: 'create-tour' }, fx.env);
    expect(res.status).toBe(200);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].url).toBe(`${TOUR_BASE}${TEAM_UPSERT_PATH}`);
    expect(reqs[0].body).toBe(JSON.stringify({ id: 900, name: '孤儿俱乐部' }));
    const ts = reqs[0].headers['x-timestamp'];
    expect(reqs[0].headers['x-sign']).toBe(
      createHmac('sha256', SYNC_SECRET).update(`POST|${TEAM_UPSERT_PATH}|${ts}|${reqs[0].body}`).digest('hex'),
    );

    reply = () => ({ status: 409, json: { error: 'conflict', message: '球队 ID #900 已被占用' } });
    const failed = await adminPost('/api/admin/team-sync/apply', { id: 900, action: 'create-tour' }, fx.env);
    expect(failed.status).toBe(502);
    // 管理端错误体是 {error}（src/worker/index.ts onError 口径），前端 api.ts 也读 error
    expect((await failed.json()) as { error: string }).toMatchObject({
      error: '赛事系统建队失败：球队 ID #900 已被占用',
    });
  });

  it('apply 入参校验：id 非正整数 400 / 未知动作 400', async () => {
    const fx = freshEnv();
    expect((await adminPost('/api/admin/team-sync/apply', { id: 0, action: 'create-club' }, fx.env)).status).toBe(400);
    expect((await adminPost('/api/admin/team-sync/apply', { id: 500, action: 'drop' }, fx.env)).status).toBe(400);
  });
});

// 这条是本增量最要紧的一个真实风险：本地建档失败时，赛事系统那支已经建好的队撤不回来。
// 推送不可撤销 → 只能靠对账页把它列进 onlyTour 让人补，所以「错位可见」必须钉在测试里。
describe('真实风险：先推成功后本地建档失败 → 错位必须被对账页看得见（v6.1.0）', () => {
  it('本地名字撞车 409，赛事系统那边已建队 → GET /team-sync 的 onlyTour 报出它', async () => {
    const fx = freshEnv();
    fx.sqlite.exec(`INSERT INTO clubs (id, name, status, created_at) VALUES (700, '撞名俱乐部', 'active', '2026-01-01T00:00:00Z')`);
    stubFetch();

    const res = await adminPost('/api/admin/clubs', { gameTeamId: 999, name: '撞名俱乐部' }, fx.env);
    expect(res.status).toBe(409);
    // 推送已经发出去了（不可撤销），本地一行没建
    expect(reqs.map((r) => r.path)).toEqual([TEAM_UPSERT_PATH]);
    expect(JSON.parse(reqs[0].body)).toEqual({ id: 999, name: '撞名俱乐部' });
    expect(sqlGet(fx.sqlite, 'SELECT id FROM clubs WHERE id = 999')).toBeUndefined();

    // 赛事系统那边现在多了一支 club 没有的队 → 对账页必须报出来，否则这支队永远没人知道。
    // 夹具里的 TOUR_DB 是内存库、推送走的是桩 fetch，所以这里手工把「对面已建档」这一步补上
    // （真实环境里这一步由赛事仓的 /api/internal/team-upsert 完成）。
    fx.tour.exec(`INSERT INTO team (id, org_id, name) VALUES (999, 1, '撞名俱乐部')`);
    const diff = (await (await adminGet('/api/admin/team-sync', fx.env)).json()) as {
      onlyTour: { id: number; name: string }[];
    };
    expect(diff.onlyTour).toContainEqual({ id: 999, name: '撞名俱乐部' });
  });
});

describe('出站 pushTeamToTour（v6.1.0）', () => {
  it('未配 TOUR_API_BASE / TEAM_SYNC_SECRET → 只回报文案，不抛错', async () => {
    const fx = freshEnv();
    stubFetch();
    const noBase = { ...fx.env, TOUR_API_BASE: undefined };
    expect(await pushTeamToTour(noBase as Env, { id: 1, name: 'A' })).toEqual({
      ok: false,
      message: '未配置 TOUR_API_BASE，无法同步到赛事系统',
    });
    const noSecret = { ...fx.env, TEAM_SYNC_SECRET: undefined };
    expect(await pushTeamToTour(noSecret as Env, { id: 1, name: 'A' })).toEqual({
      ok: false,
      message: '未配置 TEAM_SYNC_SECRET，无法同步到赛事系统',
    });
    expect(reqs).toEqual([]);
  });

  it('对端不可达 → 文案兜底；对端非 2xx → 把 message 透传给界面', async () => {
    const fx = freshEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    expect(await pushTeamToTour(fx.env, { id: 1, name: 'A' })).toEqual({ ok: false, message: '赛事系统不可达' });

    stubFetch();
    reply = () => ({ status: 503, json: { error: 'unconfigured', message: '本仓未配置 TEAM_SYNC_SECRET，拒绝机器写入' } });
    expect(await pushTeamToTour(fx.env, { id: 1, name: 'A' })).toEqual({
      ok: false,
      message: '本仓未配置 TEAM_SYNC_SECRET，拒绝机器写入',
    });

    reply = () => ({ status: 502, json: {} });
    expect(await pushTeamToTour(fx.env, { id: 1, name: 'A' })).toEqual({
      ok: false,
      message: '赛事系统拒绝同步（HTTP 502）',
    });
  });
});

// 跨仓契约金标准：这是链接项目最该钉死的一环。期望值里最要紧的一条是**死值常量**——
// 它不是用被测代码算的，而是用 node:crypto 独立算出来写死的；所以两侧任一方偷改算法、
// 路径或签名串都会红。赛事仓 tests/clubTeamSync.test.ts 里有逐字同值的一份（同样的
// secret / ts / raw / hex），两仓的文件可以直接对读。
describe('跨仓契约金标准（v6.1.0）', () => {
  const SECRET = 'increment-37-golden-secret';
  const GOLDEN_TS = '1767225600'; // 2026-01-01T00:00:00Z
  const GOLDEN_RAW = '{"id":700,"name":"Arsenal","operator":1}';
  const GOLDEN_HEX = '1437a305e893ae6c65364c50cc953a178e1edfa38f2f2040ae961966db065d30';

  it('路径与时间窗常量逐字（两侧必须同值）', () => {
    expect(TEAM_UPSERT_PATH).toBe('/api/internal/team-upsert');
    expect(TEAM_SYNC_CLOCK_SKEW_S).toBe(300);
  });

  it('签名串逐字 POST|path|ts|raw，HMAC-SHA256 小写 hex（与 auth machine.ts / notify.ts 同一口径）', async () => {
    expect(await hmacHex(SECRET, `POST|${TEAM_UPSERT_PATH}|${GOLDEN_TS}|${GOLDEN_RAW}`)).toBe(GOLDEN_HEX);
    // 同一份输入的另一种实现必须同值（crypto.subtle vs node:crypto）
    expect(
      createHmac('sha256', SECRET).update(`POST|${TEAM_UPSERT_PATH}|${GOLDEN_TS}|${GOLDEN_RAW}`).digest('hex'),
    ).toBe(GOLDEN_HEX);
  });

  it('窗口边界：±300s 内收，超一秒即拒', async () => {
    // 冻结时钟：边界就是 ±300s，真时钟在断言之间走一秒会把「超一秒」翻成「正好 300」
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    const sign = (ts: number) => hmacHex(SECRET, `POST|${TEAM_UPSERT_PATH}|${ts}|${GOLDEN_RAW}`);
    const at = async (ts: number) =>
      verifyTeamSync(SECRET, TEAM_UPSERT_PATH, GOLDEN_RAW, String(ts), await sign(ts));
    expect(await at(now)).toBe('ok');
    expect(await at(now - 300)).toBe('ok');
    expect(await at(now - 301)).toBe('reject');
    expect(await at(now + 300)).toBe('ok');
    expect(await at(now + 301)).toBe('reject');
  });

  it('出站请求：URL 拼法、头名、体形状 {id,name}（对端就按这两个字段建档）', async () => {
    const fx = freshEnv();
    stubFetch();
    await pushTeamToTour(fx.env, { id: 7, name: 'Arsenal' });
    expect(reqs[0].url).toBe(`${TOUR_BASE}${TEAM_UPSERT_PATH}`);
    expect(reqs[0].body).toBe('{"id":7,"name":"Arsenal"}');
    expect(Object.keys(reqs[0].headers).map((k) => k.toLowerCase()).sort()).toEqual(['content-type', 'x-sign', 'x-timestamp']);
    const ts = reqs[0].headers['x-timestamp'];
    expect(reqs[0].headers['x-sign']).toBe(
      createHmac('sha256', SYNC_SECRET).update(`POST|${TEAM_UPSERT_PATH}|${ts}|${reqs[0].body}`).digest('hex'),
    );
  });

  it('尾斜杠的基址不会拼出双斜杠（两侧都做过 replace(/\\/+$/,"")）', async () => {
    const fx = freshEnv();
    fx.env.TOUR_API_BASE = `${TOUR_BASE}/`;
    stubFetch();
    await pushTeamToTour(fx.env, { id: 7, name: 'Arsenal' });
    expect(reqs[0].url).toBe(`${TOUR_BASE}${TEAM_UPSERT_PATH}`);
  });

  it('头名大小写不敏感：X-Timestamp/X-Sign（club notify.ts 的写法）同样通过', async () => {
    const fx = freshEnv();
    const raw = JSON.stringify({ id: 800, name: '大写头队' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sign = createHmac('sha256', SYNC_SECRET).update(`POST|${TEAM_UPSERT_PATH}|${ts}|${raw}`).digest('hex');
    const res = await app.request(
      TEAM_UPSERT_PATH,
      { method: 'POST', headers: { 'content-type': 'application/json', 'X-Timestamp': ts, 'X-Sign': sign }, body: raw },
      fx.env,
    );
    expect(res.status).toBe(201);
    expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 800')).toEqual({ name: '大写头队' });
  });

  it('入站接受同一份金标准签名（赛事仓那份常量可以直接发过来）', async () => {
    const fx = freshEnv();
    // 本仓默认夹具用的是 SYNC_SECRET，这里换成金标准那把，才验得出「同一份签名两侧都认」
    fx.env.TEAM_SYNC_SECRET = SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Number(GOLDEN_TS) * 1000));
    try {
      const res = await app.request(
        TEAM_UPSERT_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-timestamp': GOLDEN_TS, 'x-sign': GOLDEN_HEX },
          body: GOLDEN_RAW,
        },
        fx.env,
      );
      expect(res.status).toBe(201);
      // 赛事仓的推送体多带一个 operator（本仓忽略），两边不因此对不上
      expect(sqlGet<{ name: string }>(fx.sqlite, 'SELECT name FROM clubs WHERE id = 700')).toEqual({ name: 'Arsenal' });
    } finally {
      vi.useRealTimers();
    }
  });
});
