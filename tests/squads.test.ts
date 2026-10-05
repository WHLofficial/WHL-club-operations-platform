// v5.0.0 步骤 9：GET /api/squads 全平台一线队名册（🌐 公开）。
// 这是赛事系统拉取同步的唯一契约面，所以三条口径必须钉死：
// ① 只出一线队（`status IN ('normal','listed')`，训练营 trainee 与自由身 free 不出）；
// ② 姓名走派生显示名（`display_name` 空则回落官方缩写名）—— 赛事系统原来存手工完整人名，
//    同步后会被改写成这里的值，出错了就是把赛事系统写脏；
// ③ `fcId` 必有（赛事系统以它当 player 主键），所以 `fc_id` 为空的行不出。
// 另加两条「省 D1 额度」锁死：全平台只跑一条 JOIN（不按俱乐部 N+1）、且不走 players 全表扫。
// v6.33.1 特例期：名册是否含训练营由 config `squads_include_trainee` 决定（默认 false=旧口径），
// 行内 `squad` 字段随之区分 first_team / trainee。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { applyMigrations, createTestD1, createTestKV } from './d1.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  /** 路由执行过的每条 SQL（抓 D1 语句，用来锁「一条 JOIN」与「不全表扫」） */
  captured: string[];
}

function freshEnv(): Fixture {
  resetConfigCache();
  resetGuards();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const real = createTestD1(sqlite);
  const captured: string[] = [];
  const env: Env = {
    DB: {
      prepare(sql: string) {
        captured.push(sql);
        return real.prepare(sql);
      },
      batch: real.batch.bind(real),
    } as unknown as D1Database,
    TOUR_DB: createTestD1(new DatabaseSync(':memory:')),
    SESSION_KV: createTestKV() as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    // 显式旁路缓存：同 URL 第二次请求若命中 L1 就抓不到 SQL
    PUBLIC_CACHE_TTL_MS: '0',
  };
  return { env, sqlite, captured };
}

// 20 队 / 570 人的缩样：两队各三人 + 一名训练营 + 一名自由身 + 一名无 fc_id。
//
// 行序刻意错开：两队的 id 交替（1 队 301/303，2 队夹在 302），status 也交替
// （1 队一个 listed 一个 normal，2 队夹在中间）。分组的正确性依赖 SQL 里的
// `ORDER BY c.name, p.fc_id` 把同一队排到一起（JS 侧是线性归并），行序若与期望输出一致，
// 把 ORDER BY 删掉测试照样绿 —— rowid 序与 idx_players_status 序都会给出「刚好正确」的分组。
function seed(fx: Fixture): void {
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status) VALUES
       (1, '曼城', 'premier', 'active'), (2, '阿森纳', 'premier', 'active');
     INSERT INTO players (id, uid, name, fc_id, display_name, club_id, number, status) VALUES
       (301, 'u301', 'E. Haaland',                239085, 'Erling Haaland', 1,    '9',  'listed'),
       (302, 'u302', 'M. Ødegaard',               201101, NULL,             2,    '8',  'normal'),
       (303, 'u303', 'Ederson Santana de Moraes', 212602, 'Ederson',        1,    NULL, 'normal'),
       (304, 'u304', 'J. Trainee',                900001, 'Joe Trainee',    1,    '30', 'trainee'),
       (305, 'u305', 'F. Free',                   900002, 'Free Man',       NULL, NULL, 'free'),
       (306, 'u306', 'No Fc Id',                  NULL,   'No Fc Id',       2,    '7',  'normal');`,
  );
}

interface SquadsBody {
  squads: {
    clubId: number;
    clubName: string;
    // v6.33.1：行内带名册档位；默认口径（不含训练营）下只可能全是 first_team
    players: { fcId: number; name: string; number: string | null; squad: string }[];
  }[];
}

describe('全平台一线队名册（v5.0.0）', () => {
  it('分组与口径：只出一线队、姓名走显示名回落、fc_id 为空的行不出', async () => {
    const fx = freshEnv();
    seed(fx);

    // 公开面：不带任何 cookie / 鉴权头
    const res = await app.request('/api/squads', {}, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SquadsBody;

    // 按队名 code point 排序（SQLite 默认 BINARY：曼 U+66FC < 阿 U+963F，与拼音无关）
    expect(body.squads.map((s) => s.clubName)).toEqual(['曼城', '阿森纳']);

    const city = body.squads[0];
    expect(city.clubId).toBe(1);
    expect(city.players).toEqual([
      // fc_id 升序；304（trainee）不在；默认开关下人人 first_team
      { fcId: 212602, name: 'Ederson', number: null, squad: 'first_team' },
      { fcId: 239085, name: 'Erling Haaland', number: '9', squad: 'first_team' },
    ]);

    const arsenal = body.squads[1];
    expect(arsenal.clubId).toBe(2);
    // 303 没有 display_name ⇒ 回落官方缩写名；306 没有 fc_id ⇒ 整行不出
    expect(arsenal.players).toEqual([{ fcId: 201101, name: 'M. Ødegaard', number: '8', squad: 'first_team' }]);

    // 自由身（club_id 为 NULL）永远不在任何队里
    const all = body.squads.flatMap((s) => s.players.map((p) => p.fcId));
    expect(all).not.toContain(900001);
    expect(all).not.toContain(900002);
  });

  it('省 D1 额度：全平台一条 JOIN，不按俱乐部 N+1、不走 players 全表扫', async () => {
    const fx = freshEnv();
    seed(fx);
    await app.request('/api/squads', {}, fx.env);

    const joins = fx.captured.filter((sql) => /JOIN clubs/.test(sql));
    expect(joins).toHaveLength(1);
    // 业务面除这条聚合语句外不该有第二条查询。多出来的那条是 v6.33.1 的名册开关
    // squads_include_trainee——config 点查（isolate 内 60s 记忆化），不是又跑了一趟名册；
    // 所以这里不锁「捕获总数 = 1」，只锁「业务查询（JOIN / 其余）各自恰好一条」。
    const configReads = fx.captured.filter((sql) => /FROM config/.test(sql));
    expect(configReads).toHaveLength(1);
    expect(fx.captured.filter((sql) => !/JOIN clubs/.test(sql) && !/FROM config/.test(sql))).toHaveLength(0);

    const plan = fx.sqlite.prepare(`EXPLAIN QUERY PLAN ${joins[0]}`).all() as { detail: string }[];
    // 线上 18,301 行：全表扫就是 18× 浪费。优化器实测走 `idx_players_status (status=?)`
    // （一线队恰好就是那两个 status，读到约 570 行），再按 rowid 点查俱乐部名。
    const detail = plan.map((r) => r.detail).join('\n');
    expect(detail).toContain('SEARCH p');
    expect(detail).not.toContain('SCAN p');
    expect(detail).toContain('SEARCH c USING INTEGER PRIMARY KEY');
  });

  it('特例期开关 squads_include_trainee=true：训练营球员随队下发且标 squad=trainee', async () => {
    const fx = freshEnv();
    seed(fx);
    // 开关必须在第一次请求前落库：config 服务是 isolate 记忆化，读空后 60s 不再回库。
    // （同一用例里若先请求过再改开关，必须补 resetConfigCache()，否则读到的是旧值）
    fx.sqlite.exec(
      "INSERT INTO config (key, value, updated_at) VALUES ('squads_include_trainee', 'true', '2026-01-01T00:00:00Z')",
    );

    const res = await app.request('/api/squads', {}, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SquadsBody;

    const city = body.squads[0];
    expect(city.clubId).toBe(1);
    expect(city.players).toEqual([
      // fc_id 升序：训练营 900001 从「整行不出」变为随队一行并标 trainee
      { fcId: 212602, name: 'Ederson', number: null, squad: 'first_team' },
      { fcId: 239085, name: 'Erling Haaland', number: '9', squad: 'first_team' },
      { fcId: 900001, name: 'Joe Trainee', number: '30', squad: 'trainee' },
    ]);
    // 口径变化锁在 SQL 层：status 白名单同步扩到 trainee
    expect(fx.captured.filter((sql) => /JOIN clubs/.test(sql))[0]).toContain("'trainee'");
    // 开关只放训练营：自由身、无 fc_id 的行照旧不出（阿森纳侧原样）
    const all = body.squads.flatMap((s) => s.players.map((p) => p.fcId));
    expect(all).not.toContain(900002);
    expect(body.squads[1].players).toEqual([{ fcId: 201101, name: 'M. Ødegaard', number: '8', squad: 'first_team' }]);
  });

  it('翻转回归：开关值并进缓存键 ⇒ 只让 config 记忆化过期即自愈（不等 TTL、不靠 bump 代际）', async () => {
    const fx = freshEnv();
    // 本用例刻意「不旁路缓存」：TTL 非 0，第一次请求会把旧口径载荷写进 L1
    fx.env.PUBLIC_CACHE_TTL_MS = '60000';
    seed(fx);

    const before = await app.request('/api/squads', {}, fx.env);
    const beforeBody = (await before.json()) as SquadsBody;
    expect(beforeBody.squads.flatMap((s) => s.players.map((p) => p.fcId))).not.toContain(900001);

    // 翻转开关（默认 false 时库里没有行 ⇒ INSERT），随后只让 config 记忆化过期（resetConfigCache），
    // 不 bump epoch：若缓存键不含开关值，这一请求会命中旧键、直接回旧口径载荷
    fx.sqlite.exec(
      "INSERT INTO config (key, value, updated_at) VALUES ('squads_include_trainee', 'true', '2026-01-01T00:00:00Z')",
    );
    resetConfigCache();

    const after = await app.request('/api/squads', {}, fx.env);
    const afterBody = (await after.json()) as SquadsBody;
    const city = afterBody.squads[0];
    expect(city.clubId).toBe(1);
    expect(city.players.find((p) => p.fcId === 900001)).toMatchObject({ squad: 'trainee' });
    // 载荷确实重算了（不是拿旧载荷糊弄）：第二次请求又跑了一条名册 JOIN，且状态白名单已含 trainee
    const joins = fx.captured.filter((sql) => /JOIN clubs/.test(sql));
    expect(joins).toHaveLength(2);
    expect(joins[1]).toContain("'trainee'");
  });

  it('脏值「TRUE」大写：白名单只认 `=== \'true\'`，仍按关闭口径', async () => {
    const fx = freshEnv();
    seed(fx);
    fx.sqlite.exec(
      "INSERT INTO config (key, value, updated_at) VALUES ('squads_include_trainee', 'TRUE', '2026-01-01T00:00:00Z')",
    );

    const res = await app.request('/api/squads', {}, fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SquadsBody;
    expect(body.squads.flatMap((s) => s.players.map((p) => p.fcId))).not.toContain(900001);
  });
});
