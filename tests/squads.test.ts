// v5.0.0 步骤 9：GET /api/squads 全平台一线队名册（🌐 公开）。
// 这是赛事系统拉取同步的唯一契约面，所以三条口径必须钉死：
// ① 只出一线队（`status IN ('normal','listed')`，训练营 trainee 与自由身 free 不出）；
// ② 姓名走派生显示名（`display_name` 空则回落官方缩写名）—— 赛事系统原来存手工完整人名，
//    同步后会被改写成这里的值，出错了就是把赛事系统写脏；
// ③ `fcId` 必有（赛事系统以它当 player 主键），所以 `fc_id` 为空的行不出。
// 另加两条「省 D1 额度」锁死：全平台只跑一条 JOIN（不按俱乐部 N+1）、且不走 players 全表扫。
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
  squads: { clubId: number; clubName: string; players: { fcId: number; name: string; number: string | null }[] }[];
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
      // fc_id 升序；304（trainee）不在
      { fcId: 212602, name: 'Ederson', number: null },
      { fcId: 239085, name: 'Erling Haaland', number: '9' },
    ]);

    const arsenal = body.squads[1];
    expect(arsenal.clubId).toBe(2);
    // 303 没有 display_name ⇒ 回落官方缩写名；306 没有 fc_id ⇒ 整行不出
    expect(arsenal.players).toEqual([{ fcId: 201101, name: 'M. Ødegaard', number: '8' }]);

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
    // 除这条聚合语句外不该有第二条业务查询
    expect(fx.captured).toHaveLength(1);

    const plan = fx.sqlite.prepare(`EXPLAIN QUERY PLAN ${joins[0]}`).all() as { detail: string }[];
    // 线上 18,301 行：全表扫就是 18× 浪费。优化器实测走 `idx_players_status (status=?)`
    // （一线队恰好就是那两个 status，读到约 570 行），再按 rowid 点查俱乐部名。
    const detail = plan.map((r) => r.detail).join('\n');
    expect(detail).toContain('SEARCH p');
    expect(detail).not.toContain('SCAN p');
    expect(detail).toContain('SEARCH c USING INTEGER PRIMARY KEY');
  });
});
