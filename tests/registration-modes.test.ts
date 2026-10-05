// v6.33.1 特例期：注册校验放行档 registration_check_mode 的路由级三态。
// 口径（src/worker/routes/registration.ts）：
//   enforce（默认；缺值/脏值也回落它）→ 不合规 422 squad_invalid，且拦在落库之前；
//   warn → 放行落库，checkMode 与 issues 照常回显，审计 after 记下当时档位；
//   off  → 放行落库，工作台 GET /api/club/squad 也回 checkMode='off'。
// fixture 照 stadium-ops.test.ts 的「路由（requireCoach + getBoundClub）」段；刻意不设
// env.AUTH_DB —— deriveClubTier 回落休眠列 clubs.league_tier（回滚通道），tier='premier'。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { applyMigrations, createTestD1, createTestKV, sqlAll, sqlGet } from './d1.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
}

function freshEnv(): Fixture {
  // config 服务是模块级记忆化（60s），跨用例必须清场；守卫状态同理
  resetConfigCache();
  resetGuards();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES (1, '教练甲', 'coach', 0, 0);`,
  );
  const kv = new Map<string, string>();
  kv.set('sess:tok-coach', JSON.stringify({ userId: 1 }));
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: createTestKV(kv) as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
    SYNC_BASE_URL: undefined,
    SYNC_SECRET: undefined,
  };
  return { env, sqlite };
}

// 1 队 3 人：门将 1 + 中场 2（一线队候选，均带现行合同）+ 青训 101（可成长、PA−CA＞0）。
// 报名单刻意只报 2 人一线队 —— 唯一不合规点就是人数 < squad_min=20，便于断言「是哪档放的行」。
function seed(fx: Fixture): void {
  fx.sqlite.exec(`
    INSERT INTO clubs (id, name, league_tier, status) VALUES (1, '阿森纳', 'premier', 'active');
    INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (1, 1, '2026-01-01T00:00:00Z');
    INSERT INTO seasons (season, status) VALUES (9, 'preparing');
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, base_ca, growable, status, fc_id) VALUES
      (1,   'u1',   '门将甲', 1, 'GK', 80, 85, 80, 1, 'normal', 101),
      (2,   'u2',   '中场乙', 1, 'CM', 80, 85, 80, 1, 'normal', 102),
      (101, 'u101', '青训丙', 1, 'CM', 60, 75, 60, 1, 'normal', 201);
    INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from, is_active) VALUES
      (1,   1, 50, 1,    'formal',  'import', '2026-07-01', 1),
      (2,   1, 50, 1,    'formal',  'import', '2026-07-01', 1),
      (101, 1, 5,  0.75, 'trainee', 'import', '2026-07-01', 1);
  `);
}

/** 写放行档。必须在任何请求之前落库：config 服务 isolate 内 60s 记忆化，第一读之后再改无效
 *  （用例中途改档要配 resetConfigCache()——本文件一律「先写 config，后发请求」） */
function setCheckMode(fx: Fixture, value: string): void {
  fx.sqlite
    .prepare("INSERT INTO config (key, value, updated_at) VALUES ('registration_check_mode', ?, '2026-01-01T00:00:00Z')")
    .run(value);
}

// 2 人一线队 + 1 名训练营：人数不够 20-30 区间，是唯一不合规点
const BAD_BODY = { firstTeam: [1, 2], trainee: [101] };
const HEADERS = { Cookie: 'whl_session=tok-coach' };

async function submit(fx: Fixture, body: unknown): Promise<Response> {
  return await app.request(
    '/api/club/registrations',
    { method: 'POST', headers: { 'content-type': 'application/json', ...HEADERS }, body: JSON.stringify(body) },
    fx.env,
  );
}

async function getSquad(fx: Fixture): Promise<Response> {
  return await app.request('/api/club/squad', { headers: HEADERS }, fx.env);
}

describe('注册校验放行档 registration_check_mode（v6.33.1）', () => {
  it('enforce（默认）：不合规 422 squad_invalid，拦在落库之前', async () => {
    const fx = freshEnv();
    seed(fx);
    const res = await submit(fx, BAD_BODY);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      code: string;
      issues: { rule: string }[];
      stats: { firstTeam: number; trainee: number };
    };
    expect(body.code).toBe('squad_invalid');
    expect(body.stats).toMatchObject({ firstTeam: 2, trainee: 1 });
    // 唯一不合规点是人数（门将 ≥1、训练营可成长、合同齐全都合规）
    expect(body.issues.map((i) => i.rule)).toEqual(['squad_size']);
    // 拦在落库之前：快照没写、训练营状态没动、审计没留
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM registrations')!.n).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 101')!.status).toBe('normal');
    expect(sqlAll(fx.sqlite, "SELECT 1 FROM audit_log WHERE action = 'registration_submit'")).toHaveLength(0);
  });

  it('warn：放行落库并回显 issues，训练营状态同步，审计记下档位', async () => {
    const fx = freshEnv();
    seed(fx);
    setCheckMode(fx, 'warn');
    const res = await submit(fx, BAD_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checkMode: string;
      issues: { rule: string }[];
      firstTeam: number;
      trainee: number;
    };
    expect(body.checkMode).toBe('warn');
    expect(body.firstTeam).toBe(2);
    expect(body.trainee).toBe(1);
    // 放行不等于把问题藏起来：issues 原样回给前端当提示
    expect(body.issues.map((i) => i.rule)).toEqual(['squad_size']);
    // 快照整体替换：一线队 2 行 + 训练营 1 行
    expect(
      sqlAll<{ player_id: number; squad: string }>(fx.sqlite, 'SELECT player_id, squad FROM registrations ORDER BY player_id'),
    ).toEqual([
      { player_id: 1, squad: 'first_team' },
      { player_id: 2, squad: 'first_team' },
      { player_id: 101, squad: 'trainee' },
    ]);
    // 训练营状态同步：进营即 status='trainee'
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 101')!.status).toBe('trainee');
    // 审计 after 记下「当时是哪一档放的行」，事后可追
    const audit = sqlGet<{ actor: number | null; origin: string; after: string }>(
      fx.sqlite,
      "SELECT actor, origin, after FROM audit_log WHERE action = 'registration_submit'",
    )!;
    expect(audit.actor).toBe(1);
    expect(audit.origin).toBe('user');
    // after 除档位外还记「放行了哪几条规则」（只规则名、去重定序，供特例期事后追溯）
    expect(JSON.parse(audit.after)).toMatchObject({
      season: 9,
      firstTeam: 2,
      trainee: 1,
      checkMode: 'warn',
      issues: ['squad_size'],
    });
  });

  it('off：提交放行落库，工作台 GET /api/club/squad 同步回 checkMode=off', async () => {
    const fx = freshEnv();
    seed(fx);
    setCheckMode(fx, 'off');
    const res = await submit(fx, BAD_BODY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { checkMode: string }).checkMode).toBe('off');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM registrations')!.n).toBe(3);

    const squad = await getSquad(fx);
    expect(squad.status).toBe(200);
    const body = (await squad.json()) as {
      checkMode: string;
      registration: { firstTeam: number[]; trainee: number[] } | null;
    };
    expect(body.checkMode).toBe('off');
    // 工作台照旧能还原刚提交的快照
    expect(body.registration).toEqual({ firstTeam: [1, 2], trainee: [101] });
  });

  it('未绑队：GET /api/club/squad 的早退响应也带 checkMode（放行档先于绑队判定读取）', async () => {
    const fx = freshEnv();
    seed(fx);
    setCheckMode(fx, 'off');
    // 模拟未绑队：休眠表里没有绑定行，getBoundClub 回 null ⇒ 走早退分支
    fx.sqlite.exec('DELETE FROM club_bindings');

    const squad = await getSquad(fx);
    expect(squad.status).toBe(200);
    const body = (await squad.json()) as { club: null; checkMode: string };
    expect(body.club).toBeNull();
    // 前端靠这个字段决定挂不挂红字，未绑队也不能丢
    expect(body.checkMode).toBe('off');
  });

  it('配置写脏值「乱写」：解析回落 enforce，工作台与提交都按拦（422）', async () => {
    const fx = freshEnv();
    seed(fx);
    setCheckMode(fx, '乱写');
    // 工作台先请求：脏值经白名单解析后回 enforce（坏值绝不意外放行）
    const squad = await getSquad(fx);
    expect(((await squad.json()) as { checkMode: string }).checkMode).toBe('enforce');
    const res = await submit(fx, BAD_BODY);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('squad_invalid');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM registrations')!.n).toBe(0);
  });
});
