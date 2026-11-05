// v6.77.0：AstrBot 联赛顾问身份通道（POST /api/internal/bot/bindings）。
// 契约：HMAC `POST|path|ts|raw`、±300s；QQ → account_id 主源是 AUTH_DB.identity
// （provider='qq'），identity 未命中才回落本地 qq_links；只回请求里出现的 QQ；
// 不返回 account_id/财务。2026-11-05 生产只读实测：本地 qq_links / club_bindings 均
// 0 行，identity provider='qq' 11 行、其中 10 行有 team_binding。
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createAuthDb, createTestD1 } from './d1.ts';
import { BOT_BINDINGS_MAX_QQS, BOT_BINDINGS_PATH } from '../src/worker/bot-bindings.ts';

const SECRET = 'test-bot-identity-secret';
const NOW = '2026-11-05T00:00:00Z';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  auth?: DatabaseSync;
}

function freshEnv(opts: { auth?: boolean; secret?: boolean } = {}): Fixture {
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const env = {
    DB: createTestD1(sqlite),
    MEDIA: {} as never,
    ASSETS: {} as never,
    ...(opts.secret === false ? {} : { BOT_IDENTITY_SECRET: SECRET }),
  } as unknown as Env;
  let auth: DatabaseSync | undefined;
  if (opts.auth) {
    const created = createAuthDb();
    auth = created.sqlite;
    // identity 表在生产 AUTH_DB 存在（provider='qq' 11 行），但不在 createAuthDb 的 auth
    // 镜像里——按生产列集在夹具补建。不改 tests/d1.ts：那是共享基建，别为单测加表。
    auth.exec(`
      CREATE TABLE IF NOT EXISTS identity (
        id INTEGER PRIMARY KEY,
        account_id INTEGER,
        provider TEXT,
        provider_uid TEXT,
        verified_at TEXT,
        bound_at TEXT,
        UNIQUE(provider, provider_uid)
      );
    `);
    env.AUTH_DB = created.d1;
  }
  return { env, sqlite, auth };
}

/** 本地表种子：三家具乐部（含 CPU 队）+ identity 兜底源 qq_links。 */
function seedLocal(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO clubs (id, name, status, created_at, is_cpu) VALUES
      (11, '曼联', 'active', '${NOW}', 0),
      (12, '恒星 FC', 'active', '${NOW}', 1),
      (13, '夜航', 'active', '${NOW}', 0);
    INSERT INTO qq_links (user_id, qq, verified_at) VALUES
      (105, '111000005', '${NOW}'),
      (106, '111000006', '${NOW}'),
      (107, '111000007', '${NOW}'),
      (108, '111000008', '${NOW}');
  `);
}

/**
 * AUTH_DB 种子（列集 = auth 仓镜像 + 夹具补建的 identity）。team_binding.account_id 在
 * 镜像里无外键，所以 qq_links 兜底用的 105/106/107 不需要 account 行。
 * 刻意让 auth team.name 与本地 clubs.name 不同（如 '曼联 FC' vs '曼联'），
 * 以便断言两个名字各归各源、没有互相冒充。
 */
function seedAuth(auth: DatabaseSync): void {
  auth.exec(`
    INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES
      (1, 500, 11, '曼联 FC', '${NOW}'),
      (2, 501, 12, '恒星队', '${NOW}'),
      (3, 502, NULL, '无俱乐部队', '${NOW}'),
      (4, 503, 13, '夜航 FC', '${NOW}'),
      (5, 504, 99, '幽灵队', '${NOW}');
    INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES
      (201, 1, 'code', '${NOW}'),   -- identity 主源：club 11
      (202, 2, 'code', '${NOW}'),   -- identity 主源：club 12（CPU 队）
      (204, 3, 'code', '${NOW}'),   -- 绑定存在但 club_id 为 NULL
      (209, 5, 'code', '${NOW}'),   -- club_id 99 指向本地不存在的队
      (105, 4, 'code', '${NOW}'),   -- identity 未命中、qq_links 兜底命中：club 13
      (106, 1, 'code', '${NOW}'),   -- 兜底账号有绑定，但 identity 命中 206 无绑定 ⇒ 不许用兜底
      (107, 1, 'code', '${NOW}'),   -- 兜底指向 club 11，identity 207 指向 club 12 ⇒ identity 优先
      (207, 2, 'code', '${NOW}');
    INSERT INTO identity (id, account_id, provider, provider_uid, verified_at, bound_at) VALUES
      (1, 201, 'qq', '111000001', '${NOW}', '${NOW}'),
      (2, 202, 'qq', '111000002', '${NOW}', '${NOW}'),
      (3, 203, 'qq', '111000003', '${NOW}', '${NOW}'),
      (4, 204, 'qq', '111000004', '${NOW}', '${NOW}'),
      (5, 206, 'qq', '111000006', '${NOW}', '${NOW}'),
      (6, 207, 'qq', '111000007', '${NOW}', '${NOW}'),
      (7, 209, 'qq', '111000009', '${NOW}', '${NOW}');
  `);
}

function inbound(
  env: Env,
  body: unknown,
  o: { secret?: string | null; ts?: string; sign?: string; omitSign?: boolean; raw?: string } = {},
) {
  const raw = o.raw ?? JSON.stringify(body);
  const ts = o.ts ?? String(Math.floor(Date.now() / 1000));
  const secret = o.secret === undefined ? SECRET : o.secret;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-timestamp': ts };
  if (!o.omitSign) {
    headers['x-sign'] =
      o.sign ?? createHmac('sha256', secret ?? '').update(`POST|${BOT_BINDINGS_PATH}|${ts}|${raw}`).digest('hex');
  }
  return app.request(BOT_BINDINGS_PATH, { method: 'POST', headers, body: raw }, env);
}

async function jsonOf(res: Response): Promise<{ ok: boolean; bindings: Record<string, unknown>[] }> {
  return (await res.json()) as { ok: boolean; bindings: Record<string, unknown>[] };
}

describe('POST /api/internal/bot/bindings（v6.77.0）', () => {
  it('identity 主源命中且有绑定：clubName/isCpu 正确，isCpu 跟随 clubs.is_cpu', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    const res = await inbound(fx.env, { groupId: '742357373', qqs: ['111000001', '111000002'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    // clubName 来自本地 clubs（'曼联'），teamName 来自 AUTH_DB team（'曼联 FC'）——各归各源
    expect(body.bindings).toEqual([
      { qq: '111000001', bound: true, clubId: 11, clubName: '曼联', teamName: '曼联 FC', isCpu: false },
      { qq: '111000002', bound: true, clubId: 12, clubName: '恒星 FC', teamName: '恒星队', isCpu: true },
    ]);
  });

  it('identity 命中但没有 team_binding → bound:false（恰好两个键）', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000003'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toEqual([{ qq: '111000003', bound: false }]);
  });

  it('有绑定但 club_id 为 NULL：bound:true、clubId null、teamName 有值', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000004'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toEqual([
      { qq: '111000004', bound: true, clubId: null, clubName: null, teamName: '无俱乐部队', isCpu: null },
    ]);
  });

  it('club_id 指向本地不存在的队：clubName/isCpu 为 null，不拿 teamName 冒充', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000009'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toEqual([
      { qq: '111000009', bound: true, clubId: 99, clubName: null, teamName: '幽灵队', isCpu: null },
    ]);
  });

  it('identity 未命中：qq_links 兜底（user_id 当 account_id），兜底命中但无绑定 → bound:false', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    // 111000005 不在 identity，qq_links → 105 → team_binding → club 13；
    // 111000008 走 qq_links → 108，但 108 没有 team_binding 行
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000005', '111000008'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toEqual([
      { qq: '111000005', bound: true, clubId: 13, clubName: '夜航', teamName: '夜航 FC', isCpu: false },
      { qq: '111000008', bound: false },
    ]);
  });

  it('identity 行 account_id 为 NULL：当没命中，落 qq_links 兜底', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    // identity 有 111000005 这行但 account_id 是 NULL（夹具列可空，生产是否可空未复验）：
    // 不能当成命中，必须继续查 qq_links → 105 → team_binding → club 13。
    fx.auth!.exec(
      `INSERT INTO identity (id, account_id, provider, provider_uid, verified_at, bound_at) VALUES (8, NULL, 'qq', '111000005', '${NOW}', '${NOW}')`,
    );
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000005'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toEqual([
      { qq: '111000005', bound: true, clubId: 13, clubName: '夜航', teamName: '夜航 FC', isCpu: false },
    ]);
  });

  it('两源 account 冲突：identity 优先，不拿兜底账号再试一次', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    // 111000007：identity → 207 → club 12；qq_links 兜底是 107 → club 11。必须回 club 12。
    // 111000006：identity → 206（无绑定）；qq_links 兜底 106 有绑定（club 11）。identity
    // 优先 ⇒ 不许再试兜底账号，回 bound:false。
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000007', '111000006'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toEqual([
      { qq: '111000007', bound: true, clubId: 12, clubName: '恒星 FC', teamName: '恒星队', isCpu: true },
      { qq: '111000006', bound: false },
    ]);
  });

  it('只回请求里的 QQ：去重保序，库里有但没请求的不出现', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    const res = await inbound(fx.env, {
      groupId: 'g',
      qqs: ['111000002', '111000001', '111000002', '999999999'],
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    // 重复 QQ 去重且保持第一次出现的顺序
    expect(body.bindings.map((b) => b.qq)).toEqual(['111000002', '111000001', '999999999']);
    // 库里有身份/绑定的 QQ（111000003–111000009）一个都不许出现
    for (const qq of ['111000003', '111000004', '111000005', '111000006', '111000007', '111000008', '111000009']) {
      expect(body.bindings.some((b) => b.qq === qq)).toBe(false);
    }
    expect(body.bindings[2]).toEqual({ qq: '999999999', bound: false });
  });

  it('形状校验：坏 JSON / 非对象 / groupId / qqs / 非数字 / 超长 / 超上限 → 400', async () => {
    const fx = freshEnv();
    const post = (body: unknown, opts?: { raw?: string }) => inbound(fx.env, body, opts);
    expect((await post({}, { raw: '{不是 JSON' })).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({ qqs: [] })).status).toBe(400); // groupId 缺失
    expect((await post({ groupId: '', qqs: [] })).status).toBe(400);
    expect((await post({ groupId: 'x'.repeat(65), qqs: [] })).status).toBe(400);
    expect((await post({ groupId: 'g', qqs: '123' })).status).toBe(400); // qqs 非数组
    expect((await post({ groupId: 'g', qqs: [123] })).status).toBe(400); // 非字符串
    expect((await post({ groupId: 'g', qqs: ['abc'] })).status).toBe(400); // 非数字
    expect((await post({ groupId: 'g', qqs: ['１２３'] })).status).toBe(400); // 全角数字
    expect((await post({ groupId: 'g', qqs: ['9'.repeat(21)] })).status).toBe(400); // 超 20 位
    expect(
      (await post({ groupId: 'g', qqs: Array.from({ length: BOT_BINDINGS_MAX_QQS + 1 }, (_, i) => String(100000000 + i)) }))
        .status,
    ).toBe(400); // 201 个
  });

  it('签名矩阵：错签/缺签/过期/未来超窗/非数字时间戳/换密钥 → 403', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    const payload = { groupId: 'g', qqs: ['111000001'] };
    expect((await inbound(fx.env, payload, { sign: 'f'.repeat(64) })).status).toBe(403);
    expect((await inbound(fx.env, payload, { omitSign: true })).status).toBe(403);
    expect((await inbound(fx.env, payload, { ts: String(Math.floor(Date.now() / 1000) - 400) })).status).toBe(403);
    // 未来方向也拒：hmac.ts 用 Math.abs 判窗，但端点级要自己钉住，不靠单元测试代言
    expect((await inbound(fx.env, payload, { ts: String(Math.floor(Date.now() / 1000) + 400) })).status).toBe(403);
    expect((await inbound(fx.env, payload, { ts: 'not-a-number' })).status).toBe(403);
    expect((await inbound(fx.env, payload, { secret: '别的密钥' })).status).toBe(403);
  });

  it('未配 BOT_IDENTITY_SECRET → 503（身份通道 fail-closed）', async () => {
    const fx = freshEnv({ secret: false });
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000001'] });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'unconfigured' });
  });

  it('响应键集合精确：bound:false 恰两键、bound:true 恰六键；任何响应不含 account_id', async () => {
    const fx = freshEnv({ auth: true });
    seedLocal(fx.sqlite);
    seedAuth(fx.auth!);
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000001', '999999999'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(Object.keys(body.bindings[0])).toEqual(['qq', 'bound', 'clubId', 'clubName', 'teamName', 'isCpu']);
    expect(Object.keys(body.bindings[1])).toEqual(['qq', 'bound']);
    expect(JSON.stringify(body)).not.toContain('account_id');
  });

  it('AUTH_DB 未配置：qq_links + 本地 club_bindings 回落，teamName 恒 null', async () => {
    const fx = freshEnv();
    seedLocal(fx.sqlite);
    fx.sqlite.exec(`INSERT INTO club_bindings (user_id, club_id, bound_at) VALUES (105, 11, '${NOW}')`);
    const res = await inbound(fx.env, { groupId: 'g', qqs: ['111000005', '111000001'] });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    // 回滚通道按 qq_links.user_id 查 club_bindings；teamName 恒 null（没有 AUTH_DB 可查）
    expect(body.bindings).toEqual([
      { qq: '111000005', bound: true, clubId: 11, clubName: '曼联', teamName: null, isCpu: false },
      { qq: '111000001', bound: false },
    ]);
  });

  it('200 个 QQ 按 50 一切块：块边界上的命中不丢（identity 与 qq_links 兜底都跨块）', async () => {
    const fx = freshEnv({ auth: true });
    fx.sqlite.exec(
      `INSERT INTO clubs (id, name, status, created_at, is_cpu) VALUES (11, '曼联', 'active', '${NOW}', 0);
       INSERT INTO qq_links (user_id, qq, verified_at) VALUES (110, '200000100', '${NOW}');`,
    );
    fx.auth!.exec(`
      INSERT INTO team (id, tour_team_id, club_id, name, created_at) VALUES (1, 500, 11, '曼联 FC', '${NOW}');
      -- 110 是 qq_links 兜底账号（200000100 不在 identity），其余是 identity 命中账号
      INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES
        (301, 1, 'code', '${NOW}'), (350, 1, 'code', '${NOW}'), (351, 1, 'code', '${NOW}'),
        (352, 1, 'code', '${NOW}'), (400, 1, 'code', '${NOW}'), (110, 1, 'code', '${NOW}');
      -- 命中点铺在四个块的块首/块尾：0(块1首) 49(块1尾) 50(块2首) 51(块2第2) 100(块3首) 199(块4尾)
      INSERT INTO identity (id, account_id, provider, provider_uid, verified_at, bound_at) VALUES
        (1, 301, 'qq', '200000000', '${NOW}', '${NOW}'),
        (2, 350, 'qq', '200000049', '${NOW}', '${NOW}'),
        (3, 351, 'qq', '200000050', '${NOW}', '${NOW}'),
        (4, 352, 'qq', '200000051', '${NOW}', '${NOW}'),
        (5, 400, 'qq', '200000199', '${NOW}', '${NOW}');
    `);
    const qqs = Array.from({ length: BOT_BINDINGS_MAX_QQS }, (_, i) => String(200000000 + i));
    const res = await inbound(fx.env, { groupId: 'g', qqs });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.bindings).toHaveLength(BOT_BINDINGS_MAX_QQS);
    expect(new Set(body.bindings.map((b) => b.qq)).size).toBe(BOT_BINDINGS_MAX_QQS);
    const byQq = new Map(body.bindings.map((b) => [b.qq, b]));
    for (const qq of ['200000000', '200000049', '200000050', '200000051', '200000100', '200000199']) {
      expect(byQq.get(qq)).toEqual({ qq, bound: true, clubId: 11, clubName: '曼联', teamName: '曼联 FC', isCpu: false });
    }
    expect(byQq.get('200000001')).toEqual({ qq: '200000001', bound: false });
  });

  it('空 qqs 是合法请求：返回空数组', async () => {
    const fx = freshEnv();
    const res = await inbound(fx.env, { groupId: 'g', qqs: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bindings: [] });
  });

  it('groupId 不校验成员关系（只做日志审计，任意字符串都放行）', async () => {
    const fx = freshEnv();
    const res = await inbound(fx.env, { groupId: 'any-group-42', qqs: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, bindings: [] });
  });
});
