// v6.54.0 闹涨薪教练端路由（步骤 4）集成测试：设计文档
// docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md rev20 的 §7 API 表与
// §5.4「同窗一次不变量」。HTTP 层（真 app + 兼容模式会话）锁：401/403/409 矩阵、跨俱乐部
// 403、preview 零副作用（库无新行、轮次不变、与谈判 preview 同词同界）、counter 超轮 409、
// 同窗守卫正反两例（含「续约单 signing 中可再提第二张」既有缺口的关闭）。
// 引擎语义（判定种子/三件套/升档）已在 tests/demand-ops.test.ts 锁死，这里只锁路由面。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import { createRcChange } from '../src/worker/bypass.ts';
import { previewForecast } from '../src/worker/negotiations.ts';
import { successRate } from '../src/worker/negotiation-secret.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  auth: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

const SEASON = 9;
const WINDOW = 3;
const OPENED_AT = '2026-10-25T00:00:00Z';

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const { sqlite: auth, d1: authD1 } = createAuthDb();
  // 兼容模式会话：KV sess:{token} → TOUR_DB user 表（requireCoach 按角色判）
  const tour = new DatabaseSync(':memory:');
  tour.exec(`CREATE TABLE entry (team_id INTEGER, tournament_id INTEGER);`);
  tour.exec(`
    CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
    INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
      (1, '管理组甲', 'admin', 0, 0),
      (2, '教练乙', 'coach', 0, 0),
      (3, '教练丙', 'coach', 0, 0),
      (9, '观众', 'user', 0, 0);`);
  const kv = new Map<string, string>();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    AUTH_DB: authD1,
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  } as unknown as Env;
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
    [9, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, auth, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

function post(path: string, body: unknown, token: string | undefined, env: Env) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Cookie: `whl_session=${token}` } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

/** 俱乐部 + 认证绑定（绑定真源在 auth 库 team_binding → team.club_id） */
function seedClub(fx: Fixture, clubId: number): void {
  fx.sqlite
    .prepare(`INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (?, ?, 'premier', 'active', 0)`)
    .run(clubId, `俱乐部${clubId}`);
  authRegisterClubTeam(fx.auth, 100 + clubId, clubId, `队${clubId}`);
  fx.auth
    .prepare(
      `INSERT INTO team_binding (account_id, team_id, bound_via, bound_at)
       SELECT ?, id, 'web', '2026-01-01T00:00:00Z' FROM team WHERE club_id = ?`,
    )
    .run(clubId === 1 ? 2 : 3, clubId); // 教练乙绑 club 1，教练丙绑 club 2
}

function addPlayer(
  fx: Fixture,
  id: number,
  over: Partial<{ clubId: number; ca: number; pa: number; age: number; position: string; status: string; agentTier: number; name: string }> = {},
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, agent_tier, is_future_star)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      id,
      `u${id}`,
      over.name ?? `球员${id}`,
      over.clubId ?? null,
      over.position ?? 'ST',
      over.age ?? 24,
      over.ca ?? 85,
      over.pa ?? 90,
      over.status ?? 'normal',
      over.agentTier ?? 3,
    );
}

function addContract(
  fx: Fixture,
  playerId: number,
  clubId: number,
  over: Partial<{ wage: number; rc: number; type: string; active: number }> = {},
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, is_active, service_ticks, protection_ticks)
       VALUES (?, ?, ?, ?, ?, 'import', '2026-07-01T00:00:00Z', ?, 4, 8)`,
    )
    .run(playerId, clubId, over.rc ?? 20, over.wage ?? 2.5, over.type ?? 'formal', over.active ?? 1);
}

function openWindow(fx: Fixture): void {
  fx.sqlite.prepare(`INSERT INTO seasons (season, status, created_at) VALUES (?, 'running', '2026-07-01T00:00:00Z')`).run(SEASON);
  fx.sqlite
    .prepare(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (?, ?, 'open', 0, ?)`)
    .run(SEASON, WINDOW, OPENED_AT);
}

interface DemandSeed {
  id?: number;
  playerId?: number;
  clubId?: number;
  season?: number;
  windowSeq?: number;
  status?: string;
  round?: number;
  expiresAt?: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  wage?: number;
  target?: number;
  floor?: number;
}

/** 直插一条 demand（默认待处理、target 3.70 / floor 3.33 / RC 20→25），返回 id */
function seedDemand(fx: Fixture, over: DemandSeed = {}): number {
  const cols: Record<string, string | number | null> = {
    player_id: over.playerId ?? 1,
    club_id: over.clubId ?? 1,
    season: over.season ?? SEASON,
    window_seq: over.windowSeq ?? WINDOW,
    status: over.status ?? 'pending',
    current_wage: over.wage ?? 2.5,
    expected_wage: 6.12,
    target_wage: over.target ?? 3.7,
    floor_wage: over.floor ?? 3.33,
    raise_pct: 0.48,
    rc_current: 20,
    rc_floor: 25,
    rc_fee: 0,
    round: over.round ?? 0,
    expires_at: over.expiresAt ?? '2027-01-01T00:00:00Z',
    resolution: over.resolution ?? null,
    reminded_at: '',
    void_reason: null,
    applied_at: null,
    resolved_at: over.resolvedAt ?? null,
    seed: 0,
  };
  if (over.id !== undefined) cols.id = over.id;
  const keys = Object.keys(cols);
  const info = fx.sqlite
    .prepare(`INSERT INTO contract_demands (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => cols[k]));
  return Number(info.lastInsertRowid);
}

/** demand 归属球员的合同在册（assertOpen 要看合同行） */
function seedDemandOwner(fx: Fixture, playerId: number): void {
  addPlayer(fx, playerId, { clubId: 1 });
  addContract(fx, playerId, 1);
}

const DEMAND_PATH = '/api/club/contract-demands';

// ---------------------------------------------------------------------------
// 鉴权与归属（401 / 403 矩阵；跨俱乐部 403）
// ---------------------------------------------------------------------------

describe('鉴权与归属', () => {
  it('401：无 token 六端点全拦；403：观众号与未绑定的管理组', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedDemand(fx);

    expect((await get(DEMAND_PATH, undefined, fx.env)).status).toBe(401);
    expect((await get('/api/club/transfer-requests', undefined, fx.env)).status).toBe(401);
    for (const action of ['accept', 'counter', 'preview', 'reject']) {
      expect((await post(`${DEMAND_PATH}/${id}/${action}`, { wage: 3.7 }, undefined, fx.env)).status).toBe(401);
    }
    // 观众号（role user → viewer）：requireCoach 挡
    expect((await get(DEMAND_PATH, 'tok-viewer', fx.env)).status).toBe(403);
    expect((await post(`${DEMAND_PATH}/${id}/accept`, {}, 'tok-viewer', fx.env)).status).toBe(403);
    // 管理组但未绑定俱乐部：getBoundClub 空 → 403
    expect((await get(DEMAND_PATH, 'tok-admin', fx.env)).status).toBe(403);
    expect((await get('/api/club/transfer-requests', 'tok-admin', fx.env)).status).toBe(403);
    // 非法 id → 400
    expect((await post(`${DEMAND_PATH}/abc/accept`, {}, 'tok-coach', fx.env)).status).toBe(400);
  });

  it('403：跨俱乐部对他人 demand 的四个写动作全拦；GET 只回本俱乐部', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedDemand(fx, { clubId: 1 });

    for (const [action, body] of [
      ['accept', {}],
      ['counter', { wage: 3.7 }],
      ['preview', { wage: 3.5 }],
      ['reject', {}],
    ] as const) {
      const res = await post(`${DEMAND_PATH}/${id}/${action}`, body, 'tok-coach2', fx.env);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain('不属于你的俱乐部');
    }
    // coach2 的 GET 只见 club 2（空），看不到 club 1 的任何行
    const theirs = (await (await get(DEMAND_PATH, 'tok-coach2', fx.env)).json()) as { active: unknown[] };
    expect(theirs.active).toHaveLength(0);
    // demand 未被跨俱乐部动过
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id)!.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// GET 收件箱三组 + wageContext
// ---------------------------------------------------------------------------

describe('GET /api/club/contract-demands', () => {
  it('三组归位（当前窗待处理/已接受待生效/最近终局）、逐轮记录、wageContext 双合计与未定级帽', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    // p1：当前窗待处理，第 1 轮还价未成
    addPlayer(fx, 1, { clubId: 1, name: '张三', position: 'ST', age: 24, ca: 85 });
    addContract(fx, 1, 1);
    const activeId = seedDemand(fx, { playerId: 1, wage: 2.5 });
    fx.sqlite
      .prepare(`INSERT INTO contract_demand_attempts (demand_id, round, wage, accepted) VALUES (?, 1, 3.4, 0)`)
      .run(activeId);
    // p2：已接受待生效（pending 变更在途）
    addPlayer(fx, 2, { clubId: 1, name: '李四' });
    addContract(fx, 2, 1, { wage: 3.0 });
    const acceptedId = seedDemand(fx, { playerId: 2, status: 'accepted', resolution: 'accepted', wage: 3.0, target: 3.7 });
    fx.sqlite
      .prepare(
        `INSERT INTO contract_pending_changes (player_id, club_id, source, demand_id, wage_new, release_fee_new, rc_fee, status, effective_window_seq)
         VALUES (2, 1, 'demand', ?, 3.7, 25, 0, 'pending', 3)`,
      )
      .run(acceptedId);
    // p5：普通续约的 pending 也计入 pendingDelta（§10.5 同口径）
    addPlayer(fx, 5, { clubId: 1 });
    addContract(fx, 5, 1, { wage: 6.0 });
    fx.sqlite
      .prepare(
        `INSERT INTO contract_pending_changes (player_id, club_id, source, wage_new, status, effective_window_seq)
         VALUES (5, 1, 'renewal', 6.6, 'pending', 3)`,
      )
      .run();
    // p3 / p4：最近终局（rejected direct / expired）
    addPlayer(fx, 3, { clubId: 1, name: '王五' });
    addContract(fx, 3, 1, { wage: 4.0 });
    seedDemand(fx, { playerId: 3, status: 'rejected', resolution: 'direct', resolvedAt: '2026-10-24T00:00:00Z' });
    addPlayer(fx, 4, { clubId: 1 });
    addContract(fx, 4, 1, { wage: 5.0 });
    seedDemand(fx, { playerId: 4, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-25T12:00:00Z' });
    // 上一窗残留 pending（cron 未及到期）不进 active——「当前窗待处理」按字面收口
    seedDemand(fx, { playerId: 3, windowSeq: 2, status: 'pending' });

    const res = await get(DEMAND_PATH, 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      active: Array<Record<string, unknown>>;
      accepted: Array<Record<string, unknown>>;
      recent: Array<Record<string, unknown>>;
      wageContext: { currentTotal: number | null; pendingDelta: number | null; wageCap: number | null };
    };

    expect(body.active).toHaveLength(1);
    const card = body.active[0]!;
    expect(card).toMatchObject({
      id: activeId,
      playerId: 1,
      playerName: '张三',
      position: 'ST',
      age: 24,
      ca: 85,
      status: 'pending',
      currentWage: 2.5,
      targetWage: 3.7,
      floorWage: 3.33,
      rcCurrent: 20,
      rcFloor: 25,
      round: 0,
      maxRounds: 3,
    });
    // 市场预期不出响应（界面口径「市场价」不给精确值，§2.1）；判定参数同收敛
    for (const forbidden of ['expectedWage', 'eff', 'p', 'roll', 'threshold']) {
      expect(card).not.toHaveProperty(forbidden);
    }
    expect(card.attempts).toEqual([{ round: 1, wage: 3.4, accepted: false, at: expect.any(String) }]);

    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0]).toMatchObject({ id: acceptedId, playerId: 2, status: 'accepted', appliedAt: null });

    // 最近终局 resolved_at 降序：expired（10-25）在前，rejected（10-24）在后
    expect(body.recent.map((r) => r.status)).toEqual(['expired', 'rejected']);
    expect(body.recent[1]).toMatchObject({ playerId: 3, resolution: 'direct' });

    // wageContext：Σ active wage = 2.5+3+6+4+5；待生效增量 = (3.7−3.0)+(6.6−6.0)；未定级帽为 null
    expect(body.wageContext).toEqual({ currentTotal: 20.5, pendingDelta: 1.3, wageCap: null });
  });

  it('wageCap 分级派生：报了定级赛事 → 按级别取帽（默认 68），config 覆盖生效；无报名回 null', async () => {
    const fx = freshEnv();
    seedClub(fx, 1); // authRegisterClubTeam 已把 team.tour_team_id 写成 101
    openWindow(fx);
    seedDemandOwner(fx, 1);
    seedDemand(fx);
    // 本季定级赛事 + 赛事系统报名行（tier 派生链：auth team → season_tournaments → TOUR_DB entry）
    fx.sqlite
      .prepare(`INSERT INTO season_tournaments (season, tournament_id, competition_type) VALUES (?, 501, 'league_premier')`)
      .run(SEASON);
    fx.tour.prepare(`INSERT INTO entry (team_id, tournament_id) VALUES (?, 501)`).run(101);

    const first = (await (await get(DEMAND_PATH, 'tok-coach', fx.env)).json()) as { wageContext: { wageCap: number | null } };
    expect(first.wageContext.wageCap).toBe(68); // DEFAULT_WAGE_CAP_BY_TIER.premier

    fx.sqlite
      .prepare(`INSERT INTO config (key, value, updated_at) VALUES ('wage_cap', '{"premier":70}', '2026-01-01T00:00:00Z')`)
      .run();
    resetConfigCache();
    const second = (await (await get(DEMAND_PATH, 'tok-coach', fx.env)).json()) as { wageContext: { wageCap: number | null } };
    expect(second.wageContext.wageCap).toBe(70);

    // 未报名定级赛事的俱乐部：帽线降级为 null，不挡收件箱
    seedClub(fx, 2);
    const theirs = (await (await get('/api/club/contract-demands', 'tok-coach2', fx.env)).json()) as { wageContext: { wageCap: number | null } };
    expect(theirs.wageContext.wageCap).toBeNull();
  });

  it('历史长尾不撑爆收件箱：120 条历史终局仍 200、recent 恰 10 条（D1 绑定参数上限 100 的收口）', async () => {
    // 生产约束（评审修）：D1 单查询绑定参数上限 100，而终局行永不删——旧实现把该俱乐部
    // 全历史 demand id 拼进 attempts 的 IN (?,...)，约 1.5–2 个赛季就破百必 500。
    // 本地 node:sqlite 上限 32766 复现不了这个失败，此用例锁的是收口后的**行为契约**：
    // 历史再长，端点照常 200 且 recent 恒截 10 条。
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1 });
    addContract(fx, 1, 1);
    seedDemand(fx, { playerId: 1 }); // 当前窗待处理
    for (let i = 0; i < 120; i++) {
      seedDemand(fx, {
        playerId: 100 + i, // 各行球员互异 ⇒ UNIQUE(player_id, season, window_seq) 无冲突
        season: 8 + Math.floor(i / 60),
        windowSeq: (i % 3) + 1,
        status: i % 2 === 0 ? 'expired' : 'rejected',
        resolution: i % 2 === 0 ? 'expired' : 'direct',
        resolvedAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 3600_000).toISOString(),
      });
    }

    const res = await get(DEMAND_PATH, 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: unknown[]; recent: Array<Record<string, unknown>> };
    expect(body.active).toHaveLength(1);
    expect(body.recent).toHaveLength(10);
    // 最近一条 = i=119（rejected / direct，01-01 + 119h）
    expect(body.recent[0]).toMatchObject({ playerId: 219, status: 'rejected', resolution: 'direct' });
  });
});

// ---------------------------------------------------------------------------
// preview 零副作用（不落库 / 不耗轮次 / 不审计；与谈判 preview 同词同界）
// ---------------------------------------------------------------------------

describe('POST /:id/preview 零副作用', () => {
  it('四档档位与真实判定式同源（successRate + 0.2/0.5/0.8 界），确定性两端不靠 roll', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedDemand(fx, { floor: 2.5 }); // 放低底线让中段档位可达

    const cases: Array<[number, string]> = [
      [3.7, '成功率很高'], // c ≥ target 恒成（不看 roll）
      [2.0, '成功率很低'], // c < floor 恒 lowball（不看 roll）
    ];
    // 中段三档与谈判 preview 同词同界：期望值用同一把 successRate 现算（同源锁）
    for (const wage of [3.06, 2.86, 2.59]) {
      cases.push([wage, previewForecast(successRate(wage, 3.7, -9, 0.8))]);
    }
    for (const [wage, expected] of cases) {
      const res = await post(`${DEMAND_PATH}/${id}/preview`, { wage }, 'tok-coach', fx.env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { forecast: string; risk: boolean };
      expect(body.forecast).toBe(expected);
      expect(Object.keys(body).sort()).toEqual(['forecast', 'risk']);
    }
    // 危险后缀开关随经纪人档位阈值（tier 3 = 0.35）：p≈0.095 < 0.35 → true；p=1 → false
    expect(((await (await post(`${DEMAND_PATH}/${id}/preview`, { wage: 2.59 }, 'tok-coach', fx.env)).json()) as { risk: boolean }).risk).toBe(true);
    expect(((await (await post(`${DEMAND_PATH}/${id}/preview`, { wage: 3.7 }, 'tok-coach', fx.env)).json()) as { risk: boolean }).risk).toBe(false);
  });

  it('重复调用零副作用：attempts/审计/pending 无新行、轮次不变、收件箱逐字不变；衰减按下一轮算', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedDemand(fx, { floor: 3.0 });

    const snapshot = () =>
      JSON.stringify({
        attempts: sqlAll(fx.sqlite, 'SELECT * FROM contract_demand_attempts'),
        audits: sqlAll(fx.sqlite, 'SELECT * FROM audit_log'),
        pendings: sqlAll(fx.sqlite, 'SELECT * FROM contract_pending_changes'),
        demand: sqlGet(fx.sqlite, 'SELECT status, round FROM contract_demands WHERE id = ?', id),
        inbox: sqlAll(fx.sqlite, 'SELECT * FROM contract_demands'),
      });
    const before = snapshot();
    const inboxBefore = await (await get(DEMAND_PATH, 'tok-coach', fx.env)).text();

    for (let i = 0; i < 3; i++) {
      const res = await post(`${DEMAND_PATH}/${id}/preview`, { wage: 3.5 }, 'tok-coach', fx.env);
      expect(res.status).toBe(200);
    }
    expect(snapshot()).toBe(before);
    expect(await (await get(DEMAND_PATH, 'tok-coach', fx.env)).text()).toBe(inboxBefore);

    // 衰减锁：round=1 的行下一轮 eff = round2(target×0.95) = 3.52——wage 3.10 对 3.7 是「过半」、
    // 对 3.52 是「很高」；响应取后者证明衰减真按 judgeCounter 同式生效
    addPlayer(fx, 2, { clubId: 1 });
    addContract(fx, 2, 1);
    const id2 = seedDemand(fx, { playerId: 2, round: 1, floor: 3.0 });
    const decayed = (await (await post(`${DEMAND_PATH}/${id2}/preview`, { wage: 3.1 }, 'tok-coach', fx.env)).json()) as { forecast: string };
    expect(decayed.forecast).toBe('成功率很高');
    expect(decayed.forecast).not.toBe(previewForecast(successRate(3.1, 3.7, -9, 0.8)));
    expect(decayed.forecast).toBe(previewForecast(successRate(3.1, Math.round(3.7 * 0.95 * 100) / 100, -9, 0.8)));
    expect(sqlGet<{ round: number }>(fx.sqlite, 'SELECT round FROM contract_demands WHERE id = ?', id2)!.round).toBe(1);
  });

  it('守卫：终局行 409 / 轮次用尽 409 / 坏金额 400', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedDemand(fx);

    for (const wage of [0, -1, 21, 'abc']) {
      expect((await post(`${DEMAND_PATH}/${id}/preview`, { wage }, 'tok-coach', fx.env)).status).toBe(400);
    }
    // 终局行没有「下一轮」可预览
    fx.sqlite.prepare(`UPDATE contract_demands SET status = 'rejected', resolution = 'direct' WHERE id = ?`).run(id);
    expect((await post(`${DEMAND_PATH}/${id}/preview`, { wage: 3.5 }, 'tok-coach', fx.env)).status).toBe(409);
    // 轮次已用尽（round=3 的待处理行是构造态；真实流第 3 轮必终局）
    fx.sqlite.prepare(`UPDATE contract_demands SET status = 'pending', resolution = NULL, round = 3 WHERE id = ?`).run(id);
    const res = await post(`${DEMAND_PATH}/${id}/preview`, { wage: 3.5 }, 'tok-coach', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('轮次');
  });
});

// ---------------------------------------------------------------------------
// counter 即时判定（HTTP 面）与超轮 409；客户端只传 wage
// ---------------------------------------------------------------------------

describe('POST /:id/counter', () => {
  it('还价即时判定返回：c ≥ target 成交写 pending；谈判中推进轮次并进收件箱逐轮记录', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    seedDemandOwner(fx, 2);
    // id 1：counterRoll(1,1)=0.5324 ≥ p(2.6 贴 floor)≈0.101 → 判拒、未到 3 轮 → negotiating
    const idA = seedDemand(fx, { id: 1, playerId: 1, floor: 2.6 });
    // id 2：c = target 全额接受
    const idB = seedDemand(fx, { id: 2, playerId: 2 });

    const resA = await post(`${DEMAND_PATH}/${idA}/counter`, { wage: 2.6 }, 'tok-coach', fx.env);
    expect(resA.status).toBe(200);
    expect((await resA.json()) as Record<string, unknown>).toMatchObject({ verdict: 'negotiating', round: 1, acceptedWage: null });
    expect(sqlGet<{ status: string; round: number }>(fx.sqlite, 'SELECT status, round FROM contract_demands WHERE id = ?', idA)!).toMatchObject({
      status: 'pending', // 「谈判中」不是持久 countered 态（§5.3）
      round: 1,
    });
    const inbox = (await (await get(DEMAND_PATH, 'tok-coach', fx.env)).json()) as { active: Array<{ id: number; attempts: unknown[] }> };
    expect(inbox.active.find((c) => c.id === idA)!.attempts).toHaveLength(1);

    const resB = await post(`${DEMAND_PATH}/${idB}/counter`, { wage: 3.7 }, 'tok-coach', fx.env);
    expect((await resB.json()) as Record<string, unknown>).toMatchObject({ verdict: 'accepted', acceptedWage: 3.7, round: 1 });
    // 成交写 pending 变更、contracts 关窗前一字不动
    expect(
      sqlGet<{ source: string; wage_new: number; release_fee_new: number; rc_fee: number; status: string }>(
        fx.sqlite,
        'SELECT * FROM contract_pending_changes WHERE demand_id = ?',
        idB,
      ),
    ).toMatchObject({ source: 'demand', wage_new: 3.7, release_fee_new: 25, rc_fee: 0, status: 'pending' });
    expect(sqlGet<{ wage: number }>(fx.sqlite, 'SELECT wage FROM contracts WHERE player_id = 2')!.wage).toBe(2.5);
  });

  it('超轮 409；客户端混传 playerId/targetWage 被忽略（金额与归属全取服务端行）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    seedDemandOwner(fx, 2);
    const idFull = seedDemand(fx, { playerId: 1, round: 3 }); // 构造态：三轮已用尽仍 pending
    const res = await post(`${DEMAND_PATH}/${idFull}/counter`, { wage: 3.7 }, 'tok-coach', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('轮次');
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_demand_attempts WHERE demand_id = ?', idFull)).toHaveLength(0);

    // 混传无效字段：targetWage=99 / playerId=999 都不影响——成交值仍是要价 3.7、
    // pending 变更仍落在 demand 行的球员 2 名下
    const id = seedDemand(fx, { playerId: 2 });
    const ok = await post(`${DEMAND_PATH}/${id}/counter`, { wage: 3.7, playerId: 999, targetWage: 99 }, 'tok-coach', fx.env);
    expect((await ok.json()) as Record<string, unknown>).toMatchObject({ verdict: 'accepted', acceptedWage: 3.7 });
    expect(sqlGet<{ player_id: number; wage_new: number }>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE demand_id = ?', id)).toMatchObject({
      player_id: 2,
      wage_new: 3.7,
    });
  });
});

// ---------------------------------------------------------------------------
// 409 矩阵（已处理 / 窗口已关 / 已到期）
// ---------------------------------------------------------------------------

describe('终局与窗口 409 矩阵', () => {
  it('accept 双击第二条 409；counter/preview/reject 对已终局行全 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedDemand(fx);

    expect((await post(`${DEMAND_PATH}/${id}/accept`, {}, 'tok-coach', fx.env)).status).toBe(200);
    const again = await post(`${DEMAND_PATH}/${id}/accept`, {}, 'tok-coach', fx.env);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain('已经处理');
    expect((await post(`${DEMAND_PATH}/${id}/counter`, { wage: 3.7 }, 'tok-coach', fx.env)).status).toBe(409);
    expect((await post(`${DEMAND_PATH}/${id}/preview`, { wage: 3.7 }, 'tok-coach', fx.env)).status).toBe(409);
    expect((await post(`${DEMAND_PATH}/${id}/reject`, {}, 'tok-coach', fx.env)).status).toBe(409);
    // pending 变更恰一条（唯一索引兜底未被触发）
    expect(sqlAll(fx.sqlite, `SELECT * FROM contract_pending_changes WHERE status = 'pending'`)).toHaveLength(1);
  });

  it('直拒后 accept/counter 全 409；窗口关闭与到期各自 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    seedDemandOwner(fx, 2);
    seedDemandOwner(fx, 3);
    const idRejected = seedDemand(fx, { playerId: 1 });
    expect((await post(`${DEMAND_PATH}/${idRejected}/reject`, {}, 'tok-coach', fx.env)).status).toBe(200);
    expect((await post(`${DEMAND_PATH}/${idRejected}/accept`, {}, 'tok-coach', fx.env)).status).toBe(409);
    expect((await post(`${DEMAND_PATH}/${idRejected}/counter`, { wage: 3.7 }, 'tok-coach', fx.env)).status).toBe(409);

    // 窗口关闭（以窗口状态为准，§11.2）
    const idClosed = seedDemand(fx, { playerId: 2 });
    fx.sqlite.prepare(`UPDATE season_windows SET status = 'closed' WHERE season = ? AND window_seq = ?`).run(SEASON, WINDOW);
    expect((await post(`${DEMAND_PATH}/${idClosed}/counter`, { wage: 3.7 }, 'tok-coach', fx.env)).status).toBe(409);
    expect((await post(`${DEMAND_PATH}/${idClosed}/accept`, {}, 'tok-coach', fx.env)).status).toBe(409);
    fx.sqlite.prepare(`UPDATE season_windows SET status = 'open' WHERE season = ? AND window_seq = ?`).run(SEASON, WINDOW);

    // 已到期
    const idExpired = seedDemand(fx, { playerId: 3, expiresAt: '2020-01-01T00:00:00Z' });
    expect((await post(`${DEMAND_PATH}/${idExpired}/accept`, {}, 'tok-coach', fx.env)).status).toBe(409);
    expect((await post(`${DEMAND_PATH}/${idExpired}/counter`, { wage: 3.7 }, 'tok-coach', fx.env)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /api/club/transfer-requests
// ---------------------------------------------------------------------------

describe('GET /api/club/transfer-requests', () => {
  it('存续三态全回（pending/listed/released 徽章）、resolved 与他队不回', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const d1 = seedDemand(fx, { playerId: 1, status: 'rejected', resolution: 'collapse', resolvedAt: '2026-10-20T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'collapse', 'pending')`)
      .run(d1);
    const d2 = seedDemand(fx, { playerId: 1, windowSeq: 2, status: 'rejected', resolution: 'lowball', resolvedAt: '2026-10-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'lowball', 'listed')`)
      .run(d2);
    const d3 = seedDemand(fx, { playerId: 1, windowSeq: 1, status: 'rejected', resolution: 'direct', resolvedAt: '2026-09-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'direct', 'released')`)
      .run(d3);
    // resolved（已关闭）不进列表；club 2 的行不进 coach 的列表
    const d4 = seedDemand(fx, { playerId: 1, season: 8, status: 'rejected', resolution: 'direct', resolvedAt: '2026-08-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'direct', 'resolved')`)
      .run(d4);
    const dOther = seedDemand(fx, { playerId: 9, clubId: 2, status: 'rejected', resolution: 'collapse', resolvedAt: '2026-10-20T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (9, 2, ?, 'collapse', 'pending')`)
      .run(dOther);

    const res = await get('/api/club/transfer-requests', 'tok-coach', fx.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requests: Array<Record<string, unknown>> };
    expect(body.requests).toHaveLength(3);
    // ORDER BY id DESC：后插入的 released（直拒档）在前
    expect(body.requests.map((r) => r.status)).toEqual(['released', 'listed', 'pending']);
    expect(body.requests[0]).toMatchObject({ playerId: 1, source: 'direct', demandId: d3 });
    for (const forbidden of ['expectedWage', 'p']) expect(body.requests[0]).not.toHaveProperty(forbidden);

    const theirs = (await (await get('/api/club/transfer-requests', 'tok-coach2', fx.env)).json()) as { requests: unknown[] };
    expect(theirs.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 同窗一次不变量（§5.4）：createRcChange 同窗守卫正反两例 + 顺带堵续约单 signing 缺口
// ---------------------------------------------------------------------------

describe('同窗守卫（createRcChange）', () => {
  it('正例：本窗存在该球员任意状态 demand 行（含 expired）→ 续约 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1 });
    addContract(fx, 1, 1);
    // expired 也占本窗额度（堵「故意过期后同窗便宜续约安抚」）
    seedDemand(fx, { playerId: 1, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-26T00:00:00Z' });

    await expect(createRcChange(fx.env, 1, 2, 1, 15)).rejects.toMatchObject({
      status: 409,
      message: '本窗他的合同谈判机会已经用过，下窗再谈',
    });
    expect(sqlAll(fx.sqlite, 'SELECT * FROM transfers')).toHaveLength(0);
  });

  it('反例：本窗无 demand 行 → 普通续约既有流程零变化（落 pending_review 单）；跨窗 demand 不拦', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1 });
    addContract(fx, 1, 1);
    // demand 在上一窗（window 2）：本窗额度未被占，续约照常
    seedDemand(fx, { playerId: 1, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });

    const result = await createRcChange(fx.env, 1, 2, 1, 15);
    expect(result.ok).toBe(true);
    const transfer = sqlGet<{ type: string; status: string }>(fx.sqlite, 'SELECT type, status FROM transfers WHERE id = ?', result.transferId)!;
    expect(transfer).toEqual({ type: 'rc_change', status: 'pending_review' });
  });

  it('顺带堵既有缺口：续约单进 signing 且 session active → 再提第二张续约单 409；session 终局后放行', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1 });
    addContract(fx, 1, 1);

    // 第一张续约单 → pending_review（ensureNotInFlight 在此之前拦重复提单）
    const first = await createRcChange(fx.env, 1, 2, 1, 15);
    expect(first.ok).toBe(true);
    // 管理组批准 → signing + 开谈判 session（此处直写库模拟审核通过后的状态）
    fx.sqlite.prepare(`UPDATE transfers SET status = 'signing' WHERE id = ?`).run(first.transferId);
    fx.sqlite
      .prepare(`INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, status, created_at) VALUES (?, 1, 1, 'active', '2026-10-25T00:00:00Z')`)
      .run(first.transferId);

    // 修复前：ensureNotInFlight 只查 listings 活跃与 transfers 待审 → 第二张单能提进来；
    // 现在未终局 session 一并 409
    await expect(createRcChange(fx.env, 1, 2, 1, 15)).rejects.toMatchObject({ status: 409 });

    // session 了结（settled）→ 放行
    fx.sqlite.prepare(`UPDATE negotiation_sessions SET status = 'settled' WHERE transfer_id = ?`).run(first.transferId);
    const second = await createRcChange(fx.env, 1, 2, 1, 16);
    expect(second.ok).toBe(true);
  });
});
