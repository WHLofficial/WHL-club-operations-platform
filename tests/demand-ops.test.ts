// v6.54.0 闹涨薪引擎（步骤 3）集成测试：设计文档
// docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md rev20 的 §5.1/§8 生成、
// §5.3 多轮还价即时判定、§5.4 直拒三件套与累计升档、§5.7 接受 pending、§8/§11 过期与提醒、
// §11.2 离队作废。判定种子确定性 = 引擎与 core 纯函数同源对表（demand-rules.test.ts 已锁公式，
// 这里锁「引擎真的按同一 roll 走」）；上限与门槛互斥 = 6 条/队硬上限 × 各排除门槛同批验证。
// 夹具要点：窗口 9/3 下生成闸 roll = seededUnit([9,3,pid], 20)——pid 42/49 的 roll < 0.04
//（概率下限 0.04），任何合格球员都必然过闸；pid 17 的 roll 0.963 > 概率上限 0.60，正常路径
// 永不 firing、只有通胀 p=1.0 会 firing——这几个 id 是确定性的锚。还价判定的全判拒链用
// counterRoll(1, 1..3) ≥ p(c=2.60) 的 id 1（node 预扫描确认）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, createAuthDb, authRegisterClubTeam, sqlGet, sqlAll } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import {
  acceptDemand,
  counterDemand,
  expireDemands,
  rejectDemand,
  triggerDemandBatch,
  voidDemandStatements,
} from '../src/worker/demand-ops.ts';
import { queueAllUserClubsNotification, renderNotification } from '../src/worker/notify.ts';
import { expectedWage, successRate } from '../src/worker/negotiation-secret.ts';
import { abilityLevel } from '../src/core/negotiation-rules.ts';
import {
  computeDemandAmounts,
  counterRoll,
  demandGateRoll,
  demandScore,
  ppsPickDemands,
} from '../src/core/demand-rules.ts';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  auth: DatabaseSync;
}

const SEASON = 9;
const WINDOW = 3;
const OPENED_AT = '2026-10-25T00:00:00Z';
const NOW_MS = Date.parse(OPENED_AT);

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const { sqlite: auth, d1: authD1 } = createAuthDb();
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(new DatabaseSync(':memory:')),
    AUTH_DB: authD1,
    SESSION_KV: {} as never,
    MEDIA: {} as never,
    ASSETS: {} as never,
    rng: () => 0.5,
  } as unknown as Env;
  return { env, sqlite, auth };
}

/** 俱乐部 + 认证绑定（通知落 web 行的前提）；CPU 队不绑账号 */
function seedClub(fx: Fixture, clubId: number, isCpu = false): void {
  fx.sqlite
    .prepare(`INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (?, ?, 'premier', 'active', ?)`)
    .run(clubId, `${isCpu ? 'CPU' : '俱乐部'}${clubId}`, isCpu ? 1 : 0);
  if (!isCpu) {
    authRegisterClubTeam(fx.auth, clubId, clubId, `队${clubId}`);
    fx.auth
      .prepare(`INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (?, ?, 'web', '2026-01-01T00:00:00Z')`)
      .run(clubId, clubId);
  }
}

function addPlayer(
  fx: Fixture,
  id: number,
  over: Partial<{ clubId: number; ca: number; pa: number; age: number; position: string; status: string; agentTier: number; star: number; name: string }> = {},
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, agent_tier, is_future_star)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `u${id}`,
      over.name ?? `球员${id}`,
      over.clubId ?? null,
      over.position ?? 'ST',
      over.age ?? 20,
      over.ca ?? 99,
      over.pa ?? 99,
      over.status ?? 'normal',
      over.agentTier ?? 3,
      over.star ?? 0,
    );
}

function addContract(
  fx: Fixture,
  playerId: number,
  clubId: number,
  over: Partial<{ wage: number; rc: number; type: string; active: number; signedAt: string | null; protection: number | null }> = {},
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, is_active, service_ticks, protection_ticks)
       VALUES (?, ?, ?, ?, ?, 'import', ?, ?, 4, ?)`,
    )
    .run(
      playerId,
      clubId,
      over.rc ?? 20,
      over.wage ?? 2.5,
      over.type ?? 'formal',
      over.signedAt === undefined ? '2026-07-01T00:00:00Z' : over.signedAt,
      over.active ?? 1,
      over.protection === undefined ? 8 : over.protection,
    );
}

function addReg(fx: Fixture, clubId: number, playerId: number): void {
  fx.sqlite
    .prepare(`INSERT INTO registrations (season, club_id, player_id, squad) VALUES (?, ?, ?, 'first_team')`)
    .run(SEASON, clubId, playerId);
}

function openWindow(fx: Fixture, over: Partial<{ temporary: boolean; status: string; openedAt: string }> = {}): void {
  fx.sqlite.prepare(`INSERT INTO seasons (season, status, created_at) VALUES (?, 'running', '2026-07-01T00:00:00Z')`).run(SEASON);
  fx.sqlite
    .prepare(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (?, ?, ?, ?, ?)`)
    .run(SEASON, WINDOW, over.status ?? 'open', over.temporary ? 1 : 0, over.openedAt ?? OPENED_AT);
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
  voidReason?: string | null;
  resolvedAt?: string | null;
  wage?: number;
  target?: number;
  floor?: number;
  rc?: number;
  rcFloor?: number;
}

/** 直插一条 demand（造历史终局 / 待处理行用）；返回 id */
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
    rc_current: over.rc ?? 20,
    rc_floor: over.rcFloor ?? 25,
    rc_fee: 0,
    round: over.round ?? 0,
    expires_at: over.expiresAt ?? '2027-01-01T00:00:00Z',
    resolution: over.resolution ?? null,
    reminded_at: '',
    void_reason: over.voidReason ?? null,
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

const runTrigger = (fx: Fixture) => triggerDemandBatch(fx.env, { season: SEASON, windowSeq: WINDOW, nowMs: NOW_MS });

const demandRows = (fx: Fixture, where = ''): Array<Record<string, unknown>> =>
  sqlAll(fx.sqlite, `SELECT * FROM contract_demands ${where}`);

const notificationsOf = (fx: Fixture, template: string): Array<Record<string, unknown>> =>
  sqlAll(fx.sqlite, `SELECT * FROM notifications WHERE template = ? ORDER BY id`, template);

// 窗 9/3 的生成闸 roll（测试内重算，与引擎同源）
const roll93 = (pid: number) => demandGateRoll(SEASON, WINDOW, pid);

/** 合格球员 = 满配 profile + 正式合同 + first_team 注册（over 分发给球员/合同两侧） */
function addEligible(fx: Fixture, clubId: number, pid: number, over: Record<string, unknown> = {}): void {
  addPlayer(fx, pid, { clubId, ...(over as Parameters<typeof addPlayer>[2]) });
  addContract(fx, pid, clubId, over as Parameters<typeof addContract>[3]);
  addReg(fx, clubId, pid);
}

/** 造一条待处理 demand（默认 target 3.70 / floor 3.33 / RC 20→25），返回 id */
function seedPendingDemand(fx: Fixture, over: DemandSeed = {}): number {
  return seedDemand(fx, { playerId: 1, clubId: 1, ...over });
}

/** 待处理 demand 的归属球员与合同（assertOpen 要看合同在册） */
function seedDemandOwner(fx: Fixture, playerId: number): void {
  addPlayer(fx, playerId, { clubId: 1 });
  addContract(fx, playerId, 1);
}

const counterInput = (demandId: number, wage: number, clubId = 1) => ({
  demandId,
  clubId,
  wage,
  actor: 1 as number | null,
  origin: 'user' as const,
});

// ---------------------------------------------------------------------------
// §5.1/§8 生成：资格门槛（TC-RD-01 负例矩阵）
// ---------------------------------------------------------------------------

describe('triggerDemandBatch · 资格门槛与 CPU/窗口形态', () => {
  it('合格基线生成；负例逐条不生成；released（直拒档）不阻塞再提', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);

    addEligible(fx, 1, 42); // 基线：roll 0.026 < 概率下限 0.04，必 firing
    addEligible(fx, 1, 43, { status: 'listed' }); // 挂牌中
    addEligible(fx, 1, 44, { status: 'free' }); // 自由身
    addEligible(fx, 1, 45, { status: 'retired' }); // 退役
    addEligible(fx, 1, 46, { type: 'trainee' }); // 训练营合同
    addEligible(fx, 1, 47, { wage: 0 }); // wage=0
    addEligible(fx, 1, 48, { wage: 12 }); // expected(6.12) < wage → gap<0
    addEligible(fx, 1, 49, { wage: 5.8 }); // gap 5.5% < 8% 门槛
    // 在途 pending 合同变更（pid 50 必 firing 但被排除）
    addEligible(fx, 1, 50);
    fx.sqlite
      .prepare(
        `INSERT INTO contract_pending_changes (player_id, club_id, source, wage_new, status, effective_window_seq)
         VALUES (50, 1, 'renewal', 3, 'pending', 3)`,
      )
      .run();
    // 未终局签约谈判 session（active + signing）
    addEligible(fx, 1, 51);
    fx.sqlite
      .prepare(`INSERT INTO transfers (id, type, status, player_id, from_club_id, to_club_id, fee) VALUES (1, 'transfer', 'signing', 51, 2, 1, 5)`)
      .run();
    fx.sqlite
      .prepare(`INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, status, created_at) VALUES (1, 51, 1, 'active', '2026-10-20T00:00:00Z')`)
      .run();
    // 转会待审
    addEligible(fx, 1, 52);
    fx.sqlite
      .prepare(`INSERT INTO transfers (id, type, status, player_id, from_club_id, to_club_id, fee) VALUES (2, 'transfer', 'pending_review', 52, 1, 2, 5)`)
      .run();
    // 存续转会申请（pending）
    addEligible(fx, 1, 53);
    const d53 = seedDemand(fx, { playerId: 53, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'collapse', resolvedAt: '2026-10-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (53, 1, ?, 'collapse', 'pending')`)
      .run(d53);
    // 存续转会申请（listed）
    addEligible(fx, 1, 54);
    const d54 = seedDemand(fx, { playerId: 54, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'lowball', resolvedAt: '2026-10-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (54, 1, ?, 'lowball', 'listed')`)
      .run(d54);
    // released（直拒档）不阻塞：pid 55 有前科 → 通胀 p=1.0 必 firing
    addEligible(fx, 1, 55);
    const d55 = seedDemand(fx, { playerId: 55, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'direct', resolvedAt: '2026-10-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (55, 1, ?, 'direct', 'released')`)
      .run(d55);
    // 无 RC + 低 wage：pid 57（roll 0.764 > 任何可达 p）——本用例只占位，不断言

    const result = await runTrigger(fx);

    // 只看本窗（window_seq = 3）生成行——历史终局行（窗 2）也在表里，不混入断言
    const generated = demandRows(fx, 'WHERE window_seq = 3').map((r) => Number(r.player_id)).sort((a, b) => a - b);
    // 基线 + released 档生成；其余全部被状态/门槛/存续申请排除
    expect(generated).toEqual([42, 55]);
    expect(result.created).toBe(2);
    expect(result.perClub).toEqual([{ clubId: 1, created: 2 }]);

    // 基线行形状：rc_fee 恒 0、expires = min(+3d, 关窗估算)、24h 提醒闸未占
    const base = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_demands WHERE player_id = 42')!;
    expect(base.status).toBe('pending');
    expect(base.current_wage).toBe(2.5);
    expect(base.round).toBe(0);
    expect(base.rc_fee).toBe(0);
    expect(base.reminded_at).toBe('');
    expect(base.expires_at).toBe('2026-10-28T00:00:00.000Z'); // opened + 3d < opened + 168h
  });

  it('无 RC 合同（release_fee NULL）仍生成：rc_floor=0、rc_fee=0，target 锚 RC 下限 1m 的预期', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addPlayer(fx, 42, { clubId: 1 });
    addContract(fx, 42, 1, { wage: 1.0, rc: 0 });
    fx.sqlite.prepare(`UPDATE contracts SET release_fee = NULL WHERE player_id = 42`).run();
    addReg(fx, 1, 42);

    const result = await runTrigger(fx);
    expect(result.created).toBe(1);
    const row = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_demands WHERE player_id = 42')!;
    expect(row.rc_current).toBe(0);
    expect(row.rc_floor).toBe(0);
    expect(row.rc_fee).toBe(0);
    expect(Number(row.target_wage)).toBeGreaterThan(1.0);
    expect(Number(row.expected_wage)).toBeGreaterThan(1.0);
  });

  it('CPU 队不生成；临时窗不生成；窗未开/不存在不生成', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 9, true); // CPU
    openWindow(fx);
    addEligible(fx, 1, 42);
    addEligible(fx, 9, 43); // CPU 队的合格球员

    const normal = await runTrigger(fx);
    expect(normal.created).toBe(1);
    expect(demandRows(fx).every((r) => Number(r.club_id) === 1)).toBe(true);

    const fx2 = freshEnv();
    seedClub(fx2, 1);
    openWindow(fx2, { temporary: true });
    addEligible(fx2, 1, 42);
    expect((await runTrigger(fx2)).created).toBe(0);

    const fx3 = freshEnv();
    seedClub(fx3, 1);
    openWindow(fx3, { status: 'closed' });
    addEligible(fx3, 1, 42);
    expect((await runTrigger(fx3)).created).toBe(0);

    const fx4 = freshEnv();
    seedClub(fx4, 1);
    addEligible(fx4, 1, 42);
    expect((await runTrigger(fx4)).created).toBe(0);
  });

  it('expires_at 取 min(+3d, 关窗估算)：window_length_hours=24 时关窗更早', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    fx.sqlite
      .prepare(`INSERT INTO config (key, value, updated_at) VALUES ('window_length_hours', '24', '2026-01-01T00:00:00Z')`)
      .run();
    resetConfigCache();
    addEligible(fx, 1, 42);
    await runTrigger(fx);
    const row = sqlGet<{ expires_at: string }>(fx.sqlite, 'SELECT expires_at FROM contract_demands WHERE player_id = 42')!;
    expect(row.expires_at).toBe('2026-10-26T00:00:00.000Z'); // opened + 24h < opened + 3d
  });

  it('生成审计含 seed/门槛要素；demand_created 通知按绑定账号落库', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addEligible(fx, 1, 42, { name: '张三' });
    await runTrigger(fx);

    const audit = sqlGet<Record<string, unknown>>(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_create'`)!;
    expect(audit).toBeTruthy();
    const after = JSON.parse(String(audit.after)) as Record<string, unknown>;
    expect(after.playerId).toBe(42);
    expect(after.season).toBe(SEASON);
    expect(after.windowSeq).toBe(WINDOW);
    expect(after.rcFee).toBe(0);
    expect(typeof after.p).toBe('number');
    expect(after.gateRoll).toBeCloseTo(roll93(42), 9); // seed 落库经 1e9 整数化，9 位小数内对表

    const notes = notificationsOf(fx, 'demand_created');
    expect(notes).toHaveLength(1);
    expect(Number(notes[0]!.club_id)).toBe(1);
    expect(String(notes[0]!.payload)).toContain('张三');
    // 深链来源（评审修）：payload.demandId = demand 行 id，收件篮据此拼
    // /market/desk?tab=negotiations&demand=<id>（设计 §10.1）
    const demandRow = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM contract_demands WHERE player_id = 42')!;
    expect(JSON.parse(String(notes[0]!.payload)).demandId).toBe(demandRow.id);
  });
});

// ---------------------------------------------------------------------------
// §5.1 上限与 PPS（TC-RD-03）：与 core 纯函数同源对表
// ---------------------------------------------------------------------------

describe('triggerDemandBatch · 硬上限 6/队 与 PPS 抽样', () => {
  const CAP_PIDS = [1, 4, 5, 6, 7, 14, 15, 18];
  const CAP_CAS = [97, 96, 95, 94, 93, 92, 91, 90]; // ca 互异 → 队内排名 = 数组序，可算死

  function seedEight(fx: Fixture): void {
    seedClub(fx, 1);
    openWindow(fx);
    CAP_PIDS.forEach((pid, i) => addEligible(fx, 1, pid, { ca: CAP_CAS[i], pa: CAP_CAS[i] }));
  }

  /** 与引擎同口径算第 rank 名（ca 升序排名 1 起）的 p：全部输入在测试里显式给出 */
  function expectedP(ca: number, rank1based: number, nFirstTeam: number): number {
    const breakdown = demandScore({
      wage: 2.5,
      expected: expectedWage(abilityLevel(ca, ca, 20, 25), 20, 0.02, 1.9, 0.45),
      ca,
      pa: ca,
      age: 20,
      isFutureStar: false,
      agentTier: 3,
      firstTeam: true,
      recent: null,
      caRankInClub: rank1based,
      nFirstTeam,
      caRankInPosition: rank1based,
      nPosition: nFirstTeam,
      clubWageMedian: 2.5,
    });
    return breakdown.p;
  }

  it('8 名合格 → 恰 6 条；入选集 = PPS 加权抽样结果（非 top-6 硬切）；重复 ensure 幂等零新增', async () => {
    const fx = freshEnv();
    seedEight(fx);

    // 测试内重算每人的 p 与 firing 集（roll < p），再算 PPS 应选的 6 人——引擎必须逐人一致
    const fired = CAP_PIDS.map((pid, i) => ({ pid, p: expectedP(CAP_CAS[i]!, i + 1, CAP_PIDS.length) })).filter(
      (c) => roll93(c.pid) < c.p,
    );
    expect(fired).toHaveLength(8); // 夹具自检：8 人全过闸，cap 才真的起作用
    const expectedPicks = ppsPickDemands(
      fired.map((c) => ({ playerId: c.pid, p: c.p })),
      SEASON,
      WINDOW,
      6,
    ).map((c) => c.playerId);
    expect(expectedPicks).toHaveLength(6);
    // 「非 top-6 硬切」在 core 已锁；这里锁引擎把同一批候选交给了同一把 PPS
    expect([...expectedPicks].sort((a, b) => a - b)).not.toEqual([...CAP_PIDS].sort((a, b) => a - b).slice(0, 6));

    const result = await runTrigger(fx);
    expect(result.created).toBe(6);
    expect(result.perClub).toEqual([{ clubId: 1, created: 6 }]);
    expect(demandRows(fx).map((r) => Number(r.player_id)).sort((a, b) => a - b)).toEqual([...expectedPicks].sort((a, b) => a - b));

    // 幂等：同窗重跑零新增（UNIQUE + INSERT OR IGNORE）
    const again = await runTrigger(fx);
    expect(again.created).toBe(0);
    expect(demandRows(fx)).toHaveLength(6);
  });

  it('合格 ≤ 6 全取（4 人夹具 4 条）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    for (const pid of [42, 49, 30, 28]) addEligible(fx, 1, pid); // roll 全部 < 0.13，必 firing
    const result = await runTrigger(fx);
    expect(result.created).toBe(4);
    expect(demandRows(fx)).toHaveLength(4);
  });

  it('通胀必再提：段内有终局的球员 p=1.0 绕过概率闸，金额按通胀公式落行', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    // pid 17：roll 0.963 > 概率上限 0.60——正常路径永不 firing；有前科后必 firing
    addEligible(fx, 1, 17);
    seedDemand(fx, { playerId: 17, clubId: 1, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });

    // 对照：无前科时同窗不生成
    const fx0 = freshEnv();
    seedClub(fx0, 1);
    openWindow(fx0);
    addEligible(fx0, 1, 17);
    expect((await runTrigger(fx0)).created).toBe(0);

    const result = await runTrigger(fx);
    expect(result.created).toBe(1);
    // 只看本窗生成行（player 17 的窗 2 历史行也在表里）
    const row = sqlGet<Record<string, unknown>>(
      fx.sqlite,
      'SELECT * FROM contract_demands WHERE player_id = 17 AND window_seq = 3',
    )!;
    // 满配 profile：expected = 0.02·10^1.9·20^0.45 = 6.12 → gap 145% → 通胀 r 顶 0.6
    expect(row.expected_wage).toBe(6.12);
    expect(row.target_wage).toBe(4.0); // round2(2.5×1.6)，仍压在 expected 之下
    expect(row.raise_pct).toBe(0.6);
    expect(row.floor_wage).toBe(3.6); // max(4×0.9, 2.5×1.05)
    expect(row.rc_floor).toBe(25); // 通胀 rc_raise 顶格 0.25 → raw 25 → 取整链 25
    expect(row.rc_current).toBe(20);
    expect(row.current_wage).toBe(2.5);
  });

  it('段计数隔离：前科在别俱乐部不触发通胀；申请存续（pending/listed）不生成、released 仍生成', async () => {
    // 段隔离：pid 17 的前科挂在 club 2 → 本队（club 1）按普通概率，roll 0.963 ≥ p 不生成
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    addEligible(fx, 1, 17);
    seedDemand(fx, { playerId: 17, clubId: 2, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });
    expect((await runTrigger(fx)).created).toBe(0);

    // 申请存续阻塞：pid 42（有前科 → 通胀 p=1.0 必 firing）+ pending 申请 → 不生成
    const fx2 = freshEnv();
    seedClub(fx2, 1);
    openWindow(fx2);
    addEligible(fx2, 1, 42);
    const d42 = seedDemand(fx2, { playerId: 42, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'collapse', resolvedAt: '2026-10-01T00:00:00Z' });
    fx2.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (42, 1, ?, 'collapse', 'pending')`)
      .run(d42);
    expect((await runTrigger(fx2)).created).toBe(0);

    // listed 同样阻塞
    fx2.sqlite.prepare(`UPDATE transfer_requests SET status = 'listed' WHERE player_id = 42`).run();
    expect((await runTrigger(fx2)).created).toBe(0);

    // released（直拒档）不阻塞：徽章挂着仍必再提（TC-RD-34 #8b）
    fx2.sqlite.prepare(`UPDATE transfer_requests SET status = 'released' WHERE player_id = 42`).run();
    expect((await runTrigger(fx2)).created).toBe(1);
  });

  it('普通形态金额自洽：target/floor/raise_pct 与 core 公式逐值一致，rc_floor ≥ 现行 RC', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addEligible(fx, 1, 42);
    await runTrigger(fx);
    const row = sqlGet<{
      current_wage: number;
      expected_wage: number;
      target_wage: number;
      floor_wage: number;
      raise_pct: number;
      rc_current: number;
      rc_floor: number;
    }>(fx.sqlite, 'SELECT * FROM contract_demands WHERE player_id = 42')!;
    const amounts = computeDemandAmounts({ wage: row.current_wage, expected: row.expected_wage, mode: 'normal', wageMax: 20 });
    expect(amounts).not.toBeNull();
    expect(row.target_wage).toBe(amounts!.target);
    expect(row.floor_wage).toBe(amounts!.floorWage);
    expect(row.raise_pct).toBe(amounts!.raisePct);
    expect(row.target_wage).toBeGreaterThan(row.current_wage);
    expect(row.rc_floor).toBeGreaterThanOrEqual(row.rc_current);
  });
});

// ---------------------------------------------------------------------------
// §5.3 还价（TC-RD-06）与 §5.3/§5.7 接受（TC-RD-07）
// ---------------------------------------------------------------------------

describe('counterDemand · 即时判定（判定种子确定性）', () => {
  it('c ≥ target 直接成交：按 c 写 pending 变更，contracts 一字不动，rc_fee=0', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);

    const res = await counterDemand(fx.env, counterInput(id, 3.7));
    expect(res).toMatchObject({ verdict: 'accepted', acceptedWage: 3.7, round: 1, escalated: false });

    const demand = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_demands WHERE id = ?', id)!;
    expect(demand.status).toBe('accepted');
    expect(demand.resolution).toBe('accepted');
    expect(demand.applied_at).toBeNull();
    expect(demand.round).toBe(1);

    const pending = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_pending_changes WHERE demand_id = ?', id)!;
    expect(pending).toMatchObject({
      source: 'demand',
      wage_new: 3.7,
      release_fee_new: 25,
      protection_ticks_new: null,
      rc_fee: 0,
      status: 'pending',
      effective_window_seq: WINDOW,
    });
    // contracts 不动（关窗才生效，§5.7）
    const contract = sqlGet<{ wage: number; release_fee: number; protection_ticks: number }>(
      fx.sqlite,
      'SELECT wage, release_fee, protection_ticks FROM contracts WHERE player_id = 1',
    )!;
    expect(contract).toEqual({ wage: 2.5, release_fee: 20, protection_ticks: 8 });

    // 逐轮记录 + 审计
    const attempt = sqlGet<Record<string, unknown>>(fx.sqlite, 'SELECT * FROM contract_demand_attempts WHERE demand_id = ?', id)!;
    expect(attempt).toMatchObject({ round: 1, wage: 3.7, accepted: 1 });
    const audit = sqlGet<Record<string, unknown>>(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_counter'`)!;
    expect(JSON.parse(String(audit.after))).toMatchObject({ verdict: 'accepted', acceptedWage: 3.7 });

    // 成交回执
    expect(notificationsOf(fx, 'demand_resolved')).toHaveLength(1);
  });

  it('区间还价走确定性种子：引擎判定与 core 同源对表；谈判中只推进 round、不落持久 countered 态', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    seedDemandOwner(fx, 2);
    const id = seedPendingDemand(fx); // id 1：roll(1,1)=0.5324 < p(3.40,3.70)=0.9356 → 必成交

    const res1 = await counterDemand(fx.env, counterInput(id, 3.4));
    expect(res1.verdict).toBe('accepted');
    expect(res1.acceptedWage).toBe(3.4);
    expect(res1.p).toBe(successRate(3.4, 3.7, -9, 0.8));
    expect(res1.eff).toBe(3.7);

    // 第二条 demand：c = floor 3.33，p = 0.9047——判定按 roll(id,1) 分叉，引擎与 core 对表
    const id2 = seedPendingDemand(fx, { playerId: 2 });
    const roll = counterRoll(id2, 1);
    const pAtFloor = successRate(3.33, 3.7, -9, 0.8);
    const res2 = await counterDemand(fx.env, counterInput(id2, 3.33));
    if (roll < pAtFloor) {
      expect(res2.verdict).toBe('accepted');
      expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id2)!.status).toBe('accepted');
    } else {
      expect(res2.verdict).toBe('negotiating');
      const demand = sqlGet<{ status: string; round: number }>(fx.sqlite, 'SELECT status, round FROM contract_demands WHERE id = ?', id2)!;
      expect(demand.status).toBe('pending'); // 「谈判中」不是持久 countered 态（§5.3）
      expect(demand.round).toBe(1);
      expect(sqlGet<{ accepted: number }>(fx.sqlite, 'SELECT accepted FROM contract_demand_attempts WHERE demand_id = ?', id2)!.accepted).toBe(0);
      // negotiating 不发通知：回执进对话流（此刻只有第一条的成交回执）
      expect(notificationsOf(fx, 'demand_resolved')).toHaveLength(1);
    }
  });

  it('3 轮判拒 → collapse 终局 + 转会申请挂起（无三件套）；低还价 → lowball 终局', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    // id 1：counterRoll(1,1..3) 全部 ≥ p（c=2.60 贴 floor：p1≈0.101 / p2,3≈0.201）→ 三轮全判拒
    const id = seedPendingDemand(fx, { id: 1, floor: 2.6 });
    expect(counterRoll(1, 1)).toBeGreaterThanOrEqual(successRate(2.6, 3.7, -9, 0.8));
    expect(counterRoll(1, 2)).toBeGreaterThanOrEqual(successRate(2.6, 3.52, -9, 0.8));
    expect(counterRoll(1, 3)).toBeGreaterThanOrEqual(successRate(2.6, 3.52, -9, 0.8));

    expect((await counterDemand(fx.env, counterInput(id, 2.6))).verdict).toBe('negotiating');
    expect((await counterDemand(fx.env, counterInput(id, 2.6))).verdict).toBe('negotiating');
    const r3 = await counterDemand(fx.env, counterInput(id, 2.6));
    expect(r3).toMatchObject({ verdict: 'rejected', source: 'collapse', escalated: false });

    const demand = sqlGet<{ status: string; resolution: string; round: number }>(fx.sqlite, 'SELECT * FROM contract_demands WHERE id = 1')!;
    expect(demand).toMatchObject({ status: 'rejected', resolution: 'collapse', round: 3 });
    // 谈崩档：申请挂起（pending），无 rejection pending、无全联盟通告
    const request = sqlGet<{ status: string; source: string; demand_id: number }>(fx.sqlite, 'SELECT * FROM transfer_requests')!;
    expect(request).toMatchObject({ status: 'pending', source: 'collapse', demand_id: 1 });
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_pending_changes')).toHaveLength(0);
    expect(notificationsOf(fx, 'demand_rejected_public')).toHaveLength(0);
    expect(notificationsOf(fx, 'demand_resolved')).toHaveLength(1); // 谈崩回执
    // 三轮各一行 attempts
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_demand_attempts WHERE demand_id = 1')).toHaveLength(3);

    // lowball：另一条 demand，c < floor → 视为拒绝整条（不看 roll、不耗判定）
    seedDemandOwner(fx, 2);
    const id2 = seedPendingDemand(fx, { playerId: 2 });
    const r = await counterDemand(fx.env, counterInput(id2, 2.0));
    expect(r).toMatchObject({ verdict: 'rejected', source: 'lowball' });
    expect(sqlGet<{ resolution: string }>(fx.sqlite, 'SELECT resolution FROM contract_demands WHERE id = ?', id2)!.resolution).toBe('lowball');
    expect(sqlAll(fx.sqlite, 'SELECT * FROM transfer_requests WHERE demand_id = ?', id2)).toHaveLength(1);
  });

  it('守卫矩阵：坏金额 400 / 他队 403 / 已终局 409 / 窗口关闭 409 / 已到期 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);

    await expect(counterDemand(fx.env, counterInput(id, 0))).rejects.toMatchObject({ status: 400 });
    await expect(counterDemand(fx.env, counterInput(id, 21))).rejects.toMatchObject({ status: 400 });
    await expect(counterDemand(fx.env, counterInput(id, 3.7, 2))).rejects.toMatchObject({ status: 403 });
    await expect(acceptDemand(fx.env, { demandId: id, clubId: 2, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 403 });

    // 已终局
    await acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' });
    await expect(counterDemand(fx.env, counterInput(id, 3.7))).rejects.toMatchObject({ status: 409 });
    await expect(acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });

    // 窗口关闭（以窗口状态为准，§11.2）
    seedDemandOwner(fx, 2);
    const id2 = seedPendingDemand(fx, { playerId: 2 });
    fx.sqlite.prepare(`UPDATE season_windows SET status = 'closed' WHERE season = ? AND window_seq = ?`).run(SEASON, WINDOW);
    await expect(counterDemand(fx.env, counterInput(id2, 3.7))).rejects.toMatchObject({ status: 409 });
    await expect(acceptDemand(fx.env, { demandId: id2, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });

    // 已到期
    fx.sqlite.prepare(`UPDATE season_windows SET status = 'open' WHERE season = ? AND window_seq = ?`).run(SEASON, WINDOW);
    seedDemandOwner(fx, 3);
    const id3 = seedPendingDemand(fx, { playerId: 3, expiresAt: '2020-01-01T00:00:00Z' });
    await expect(counterDemand(fx.env, counterInput(id3, 3.7))).rejects.toMatchObject({ status: 409 });
    await expect(acceptDemand(fx.env, { demandId: id3, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });

    // 在途 pending（评审修）：counter 任何分支都先拦——成交分支要写 contract_pending_changes，
    // 不预检则撞 idx_pending_one_per_player 抛 UNIQUE → 路由 500，违背 §7「404/403/409」契约
    seedDemandOwner(fx, 4);
    const id4 = seedPendingDemand(fx, { playerId: 4 });
    fx.sqlite
      .prepare(
        `INSERT INTO contract_pending_changes (player_id, club_id, source, wage_new, status, effective_window_seq)
         VALUES (4, 1, 'renewal', 3, 'pending', 3)`,
      )
      .run();
    await expect(counterDemand(fx.env, counterInput(id4, 3.7))).rejects.toMatchObject({ status: 409 });
  });
});

describe('acceptDemand', () => {
  it('在途 pending 挡接受（409）；双 accept 只成一条；接受摘「不满」徽章；审计 rc_fee=0', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);

    // 在途 pending（普通续约）→ 409
    fx.sqlite
      .prepare(
        `INSERT INTO contract_pending_changes (player_id, club_id, source, wage_new, status, effective_window_seq)
         VALUES (1, 1, 'renewal', 3, 'pending', 3)`,
      )
      .run();
    await expect(acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });
    fx.sqlite.prepare(`DELETE FROM contract_pending_changes`).run();

    // 挂着「不满」徽章（此前直拒）→ 接受即重签：released → resolved
    const oldId = seedDemand(fx, { playerId: 1, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'direct', resolvedAt: '2026-10-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'direct', 'released')`)
      .run(oldId);

    const res = await acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' });
    expect(res).toEqual({ demandId: id, wage: 3.7, releaseFee: 25 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfer_requests WHERE demand_id = ?', oldId)!.status).toBe('resolved');

    // 双 accept：第二条 409，pending 表仍恰 1 行
    await expect(acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });
    expect(sqlAll(fx.sqlite, `SELECT * FROM contract_pending_changes WHERE status = 'pending'`)).toHaveLength(1);

    // 接受审计带 rc_fee=0
    const audit = sqlGet<Record<string, unknown>>(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_accept'`)!;
    expect(JSON.parse(String(audit.after))).toMatchObject({ wageNew: 3.7, releaseFeeNew: 25, rcFee: 0 });
  });
});

// ---------------------------------------------------------------------------
// §5.4 直拒三件套（TC-RD-34）
// ---------------------------------------------------------------------------

describe('rejectDemand · 直拒三件套（原子）', () => {
  it('direct：rejection pending（价格两列不动、保护期置已过）+ released 徽章 + 全联盟通告；contracts 全字段不变', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    seedClub(fx, 9, true); // CPU 队：不收通告
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1, name: '张三' });
    addContract(fx, 1, 1);
    const id = seedPendingDemand(fx);

    await rejectDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' });

    const demand = sqlGet<{ status: string; resolution: string }>(fx.sqlite, 'SELECT * FROM contract_demands WHERE id = ?', id)!;
    expect(demand).toMatchObject({ status: 'rejected', resolution: 'direct' });

    // 三件套之一：rejection pending——保护期置已过写 0，价格两列原样（否决方案防返潮断言）
    const pending = sqlGet<Record<string, unknown>>(fx.sqlite, `SELECT * FROM contract_pending_changes WHERE source = 'rejection'`)!;
    expect(pending).toMatchObject({
      player_id: 1,
      club_id: 1,
      demand_id: id,
      wage_new: 2.5,
      release_fee_new: null,
      protection_ticks_new: 0,
      rc_fee: 0,
      status: 'pending',
    });
    // 三件套之三：「不满」徽章 released 存续（不待关窗）
    const request = sqlGet<{ status: string; source: string; demand_id: number }>(fx.sqlite, 'SELECT * FROM transfer_requests')!;
    expect(request).toMatchObject({ status: 'released', source: 'direct', demand_id: id });
    // contracts 全字段不变（保护期不由 reject 立即改——由 pending 承载、关窗才落）
    const contract = sqlGet<{ wage: number; release_fee: number; protection_ticks: number }>(
      fx.sqlite,
      'SELECT wage, release_fee, protection_ticks FROM contracts WHERE player_id = 1',
    )!;
    expect(contract).toEqual({ wage: 2.5, release_fee: 20, protection_ticks: 8 });

    // 三件套之二：全联盟通告 = 两个真人俱乐部各一落，CPU 队零落；本队另有回执
    const publicNotes = notificationsOf(fx, 'demand_rejected_public');
    expect(publicNotes.map((n) => Number(n.club_id)).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(notificationsOf(fx, 'demand_resolved').map((n) => Number(n.club_id))).toEqual([1]);

    // 拒绝审计
    const audit = sqlGet<Record<string, unknown>>(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_reject'`)!;
    expect(audit.actor).toBe(1);
    expect(JSON.parse(String(audit.after))).toMatchObject({ source: 'direct', protectionTicksNew: 0, rcFee: 0 });
  });

  it('三件套原子性：批内撞唯一约束 → 整批回滚，无半套后果、无审计、无通告', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);
    // 预埋同 (player, club, demand) 的申请行 → reject 批内 transfer_requests INSERT 必撞 UNIQUE
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'direct', 'released')`)
      .run(id);

    await expect(rejectDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toThrow(/UNIQUE constraint failed/);

    // 原子性：demand 仍 pending、无 rejection pending、无新审计、无任何通知
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id)!.status).toBe('pending');
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_pending_changes')).toHaveLength(0);
    expect(sqlAll(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_reject'`)).toHaveLength(0);
    expect(notificationsOf(fx, 'demand_rejected_public')).toHaveLength(0);
    expect(notificationsOf(fx, 'demand_resolved')).toHaveLength(0);
  });

  it('直拒时已有在途 pending → 409「先了结在途的合同变更」；已终局再拒 → 409', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);
    fx.sqlite
      .prepare(
        `INSERT INTO contract_pending_changes (player_id, club_id, source, wage_new, status, effective_window_seq)
         VALUES (1, 1, 'renewal', 3, 'pending', 3)`,
      )
      .run();
    await expect(rejectDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });

    fx.sqlite.prepare(`DELETE FROM contract_pending_changes`).run();
    await rejectDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' });
    await expect(rejectDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });
  });
});

// ---------------------------------------------------------------------------
// §5.4.4 累计升档与 §8/§11 过期
// ---------------------------------------------------------------------------

describe('expireDemands · 过期与累计升档', () => {
  it('两次自然过期 → 第二次升档走直拒三件套（expired 计入累计）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1, name: '张三' });
    addContract(fx, 1, 1);
    // 第一次终局：窗 2 自然过期（同段：resolved_at 晚于合同 signed_at）
    seedDemand(fx, { playerId: 1, clubId: 1, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });
    // 第二次：窗 3 的 demand 到期
    const id = seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    const tick = await expireDemands(fx.env, '2026-10-26T00:00:01Z');
    expect(tick).toMatchObject({ expired: 1, escalated: 1, reminded: 0 });

    const demand = sqlGet<{ status: string; resolution: string; resolved_by: string }>(fx.sqlite, 'SELECT * FROM contract_demands WHERE id = ?', id)!;
    expect(demand).toMatchObject({ status: 'expired', resolution: 'expired', resolved_by: 'auto' });
    // 升档三件套齐活
    expect(sqlGet<Record<string, unknown>>(fx.sqlite, `SELECT * FROM contract_pending_changes WHERE source = 'rejection'`)).toBeTruthy();
    expect(sqlGet<{ status: string; source: string }>(fx.sqlite, 'SELECT * FROM transfer_requests')!).toMatchObject({
      status: 'released',
      source: 'direct',
    });
    expect(notificationsOf(fx, 'demand_rejected_public').map((n) => Number(n.club_id)).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('第一次自然过期不升档：只置 expired，不生成申请 / 不写 rejection pending / 不通告', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    const tick = await expireDemands(fx.env, '2026-10-26T00:00:01Z');
    expect(tick).toMatchObject({ expired: 1, escalated: 0, reminded: 0 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id)!.status).toBe('expired');
    expect(sqlAll(fx.sqlite, 'SELECT * FROM transfer_requests')).toHaveLength(0);
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_pending_changes')).toHaveLength(0);
    expect(notificationsOf(fx, 'demand_rejected_public')).toHaveLength(0);

    // 已终局再扫：claim 不再命中
    const again = await expireDemands(fx.env, '2026-10-27T00:00:00Z');
    expect(again.expired).toBe(0);
  });

  it('挂牌驱赶的过期不计数（void_reason=listing 被段计数过滤）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    // 前科 = 挂牌驱赶（byListing）→ 不计入；本次自然过期是段内第 1 次 → 不升档
    seedDemand(fx, {
      playerId: 1,
      clubId: 1,
      windowSeq: 2,
      status: 'expired',
      resolution: 'expired',
      voidReason: 'listing',
      resolvedAt: '2026-10-01T00:00:00Z',
    });
    const id = seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    const tick = await expireDemands(fx.env, '2026-10-26T00:00:01Z');
    expect(tick).toMatchObject({ expired: 1, escalated: 0 });
    expect(sqlAll(fx.sqlite, 'SELECT * FROM transfer_requests')).toHaveLength(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id)!.status).toBe('expired');
  });

  it('段隔离：前科在别俱乐部（clubId 圈定）→ 本队首次过期不升档', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1 });
    addContract(fx, 1, 1, { signedAt: '2026-10-10T00:00:00Z' }); // 无入队行 ⇒ 锚 null、全历史一段，隔离靠 clubId 过滤
    seedDemand(fx, { playerId: 1, clubId: 2, windowSeq: 2, status: 'rejected', resolution: 'collapse', resolvedAt: '2026-10-05T00:00:00Z' });
    const id = seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    const tick = await expireDemands(fx.env, '2026-10-26T00:00:01Z');
    expect(tick).toMatchObject({ expired: 1, escalated: 0 });
    expect(sqlAll(fx.sqlite, 'SELECT * FROM transfer_requests')).toHaveLength(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id)!.status).toBe('expired');
  });

  it('段锚 = 最近入队时刻：同队续约（rc_change）不清零、买回（transfer 买入）清零', async () => {
    // 同队续约：amendment 过户把 signed_at 刷到续约时刻（transfers.ts 真实行为）——
    // 锚若错取 signed_at 或 rc_change 行，前科会被过滤、计数被洗掉（设计 §5.4.4 明令堵死）
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    addPlayer(fx, 1, { clubId: 1, name: '张三' });
    addContract(fx, 1, 1, { signedAt: '2026-10-20T00:00:00Z' }); // 续约刷新后的 signed_at（晚于前科）
    fx.sqlite
      .prepare(
        `INSERT INTO transfers (id, type, status, player_id, from_club_id, to_club_id, fee, completed_at)
         VALUES (1, 'rc_change', 'completed', 1, 1, 1, 0, '2026-10-20T00:00:00Z')`,
      )
      .run();
    seedDemand(fx, { playerId: 1, clubId: 1, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });
    seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    // 前科延续计数 → 本次过期是段内第 2 次 → 升档三件套
    const tick = await expireDemands(fx.env, '2026-10-26T00:00:01Z');
    expect(tick).toMatchObject({ expired: 1, escalated: 1 });

    // 买回重锚：transfer 买入完成（晚于前科）→ 新段从零 → 同样的第二次过期不升档
    const fx2 = freshEnv();
    seedClub(fx2, 1);
    seedClub(fx2, 2);
    openWindow(fx2);
    addPlayer(fx2, 1, { clubId: 1 });
    addContract(fx2, 1, 1); // signed_at 2026-07-01（早于前科——锚若错取 signed_at 前科会混入）
    fx2.sqlite
      .prepare(
        `INSERT INTO transfers (id, type, status, player_id, from_club_id, to_club_id, fee, completed_at)
         VALUES (1, 'transfer', 'completed', 1, 2, 1, 5, '2026-10-20T00:00:00Z')`,
      )
      .run();
    seedDemand(fx2, { playerId: 1, clubId: 1, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });
    seedPendingDemand(fx2, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    const tick2 = await expireDemands(fx2.env, '2026-10-26T00:00:01Z');
    expect(tick2).toMatchObject({ expired: 1, escalated: 0 });
    expect(sqlAll(fx2.sqlite, 'SELECT * FROM transfer_requests')).toHaveLength(0);
  });

  it('段锚联动生成侧：续约后下窗仍通胀必再提；买回后新段走普通概率（pid 17 恒不 firing）', async () => {
    // pid 17 的生成闸 roll 0.963 > 概率上限 0.60——只有通胀 p=1.0 会 firing，是干净信号
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    addEligible(fx, 1, 17);
    fx.sqlite.prepare(`UPDATE contracts SET signed_at = '2026-10-20T00:00:00Z' WHERE player_id = 17`).run();
    fx.sqlite
      .prepare(
        `INSERT INTO transfers (id, type, status, player_id, from_club_id, to_club_id, fee, completed_at)
         VALUES (1, 'rc_change', 'completed', 17, 1, 1, 0, '2026-10-20T00:00:00Z')`,
      )
      .run();
    seedDemand(fx, { playerId: 17, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'direct', resolvedAt: '2026-10-01T00:00:00Z' });
    expect((await runTrigger(fx)).created).toBe(1); // 同队续约不清零 → 通胀必再提

    // 对照：买回重锚 → 新段无前科 → 普通概率路径，pid 17 永不 firing
    const fx2 = freshEnv();
    seedClub(fx2, 1);
    openWindow(fx2);
    addEligible(fx2, 1, 17);
    fx2.sqlite
      .prepare(
        `INSERT INTO transfers (id, type, status, player_id, from_club_id, to_club_id, fee, completed_at)
         VALUES (1, 'transfer', 'completed', 17, 2, 1, 5, '2026-10-20T00:00:00Z')`,
      )
      .run();
    seedDemand(fx2, { playerId: 17, clubId: 1, windowSeq: 2, status: 'rejected', resolution: 'direct', resolvedAt: '2026-10-01T00:00:00Z' });
    expect((await runTrigger(fx2)).created).toBe(0);
  });

  it('升档分支批内抛错逐行吞错（计 skipped）：同轮后续行与 24h 提醒段照常（评审修停摆）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    // 球员 1：有前科 → 到期升档；预埋同 (player, club, demand) 的申请行 ⇒ 升档批内
    // transfer_requests INSERT 撞 UNIQUE 抛错（等价于 inFlight 预检与批之间的竞态窗口）
    addPlayer(fx, 1, { clubId: 1, name: '张三' });
    addContract(fx, 1, 1);
    seedDemand(fx, { playerId: 1, clubId: 1, windowSeq: 2, status: 'expired', resolution: 'expired', resolvedAt: '2026-10-01T00:00:00Z' });
    const stuck = seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-25T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'direct', 'released')`)
      .run(stuck);
    // 球员 2：无前科 → 普通过期（撞错行的下一个 due 行）
    seedDemandOwner(fx, 2);
    seedPendingDemand(fx, { playerId: 2, clubId: 1, expiresAt: '2026-10-25T00:00:00Z' });
    // 球员 3：还剩 4h → 走提醒段
    seedDemandOwner(fx, 3);
    seedPendingDemand(fx, { playerId: 3, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    // 不抛（旧实现整个冒出、后续行与提醒段全停）：skipped 1 + expired 1 + reminded 1
    const tick = await expireDemands(fx.env, '2026-10-25T20:00:00Z');
    expect(tick).toEqual({ expired: 1, escalated: 0, reminded: 1, skipped: 1 });
    // 撞错行未消费（下个 tick 重试），后续行正常终局
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', stuck)!.status).toBe('pending');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE player_id = 2')!.status).toBe('expired');
    expect(notificationsOf(fx, 'demand_deadline')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §7/§11 24h 截止提醒（reminded_at 一次性闸）
// ---------------------------------------------------------------------------

describe('expireDemands · 24h 提醒只发一次', () => {
  it('剩不足 24h 发一条 demand_deadline；重跑不重发；已过期行不发；超过 24h 不发', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' }); // 剩 4h
    seedDemandOwner(fx, 2);
    const expiredId = seedPendingDemand(fx, { playerId: 2, clubId: 1, expiresAt: '2026-10-25T00:00:00Z' }); // 已过期
    seedDemandOwner(fx, 3);
    seedPendingDemand(fx, { playerId: 3, clubId: 1, expiresAt: '2026-11-05T00:00:00Z' }); // 还剩 11 天

    const tick = await expireDemands(fx.env, '2026-10-25T20:00:00Z');
    expect(tick).toEqual({ expired: 1, escalated: 0, reminded: 1, skipped: 0 });

    const notes = notificationsOf(fx, 'demand_deadline');
    expect(notes).toHaveLength(1);
    expect(Number(notes[0]!.club_id)).toBe(1);
    expect(sqlGet<{ reminded_at: string }>(fx.sqlite, 'SELECT reminded_at FROM contract_demands WHERE id = ?', id)!.reminded_at).toBe('2026-10-25T20:00:00Z');
    // 已过期的那条走 expired 路径，不推「还剩不到 24 小时」
    expect(sqlGet<{ reminded_at: string }>(fx.sqlite, 'SELECT reminded_at FROM contract_demands WHERE id = ?', expiredId)!.reminded_at).toBe('');

    // 重跑：闸已占（reminded_at 非空）→ 不重发；过期路径也不再命中
    const again = await expireDemands(fx.env, '2026-10-25T21:00:00Z');
    expect(again).toEqual({ expired: 0, escalated: 0, reminded: 0, skipped: 0 });
    expect(notificationsOf(fx, 'demand_deadline')).toHaveLength(1);
  });

  it('并发/重放只发一次：抢先占闸的 tick 赢，后到的 claim 改 0 行不发信', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    seedPendingDemand(fx, { playerId: 1, clubId: 1, expiresAt: '2026-10-26T00:00:00Z' });

    // 模拟并发：先手工占闸（等价于另一个 tick 已 claim），再跑 → reminded 不增
    fx.sqlite.prepare(`UPDATE contract_demands SET reminded_at = '2026-10-25T19:00:00Z' WHERE player_id = 1`).run();
    const tick = await expireDemands(fx.env, '2026-10-25T20:00:00Z');
    expect(tick.reminded).toBe(0);
    expect(notificationsOf(fx, 'demand_deadline')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §11.2 离队作废（语句返回给 completeTransfer 同批）
// ---------------------------------------------------------------------------

describe('voidDemandStatements · 离队作废', () => {
  it('pending/accepted 的 demand 与在途 pending 变更置 void；申请与「不满」徽章 resolved（不随人走）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);

    const acceptedId = seedPendingDemand(fx, { playerId: 1 });
    await acceptDemand(fx.env, { demandId: acceptedId, clubId: 1, actor: 1, origin: 'user' });
    const pendingId = seedPendingDemand(fx, { playerId: 1, windowSeq: 2 }); // 另一条 pending（跨窗残留）
    // 直拒徽章挂着
    const oldId = seedDemand(fx, { playerId: 1, clubId: 1, windowSeq: 1, status: 'rejected', resolution: 'direct', resolvedAt: '2026-09-01T00:00:00Z' });
    fx.sqlite
      .prepare(`INSERT INTO transfer_requests (player_id, club_id, demand_id, source, status) VALUES (1, 1, ?, 'direct', 'released')`)
      .run(oldId);

    const plan = await voidDemandStatements(fx.env, 1, 'transferred');
    expect([...plan.demandIds].sort((a, b) => a - b)).toEqual([acceptedId, pendingId].sort((a, b) => a - b));
    expect(plan.pendingIds).toHaveLength(1);
    // 调用方（completeTransfer）把它并进自己的批次——这里单独批执行验证语义
    await fx.env.DB.batch(plan.statements);

    expect(sqlGet<{ status: string; void_reason: string }>(fx.sqlite, 'SELECT status, void_reason FROM contract_demands WHERE id = ?', acceptedId)!).toMatchObject({
      status: 'void',
      void_reason: 'transferred',
    });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', pendingId)!.status).toBe('void');
    expect(
      sqlGet<{ status: string; void_reason: string }>(fx.sqlite, 'SELECT status, void_reason FROM contract_pending_changes WHERE demand_id = ?', acceptedId)!,
    ).toMatchObject({ status: 'void', void_reason: 'transferred' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfer_requests WHERE demand_id = ?', oldId)!.status).toBe('resolved');

    // 无关球员不受影响
    seedDemandOwner(fx, 9);
    const other = seedPendingDemand(fx, { playerId: 9 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', other)!.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// §11.2 合同漂移与归属守卫（SQL 侧等值）+ cron 扫描索引（0080）
// ---------------------------------------------------------------------------

describe('合同漂移与归属守卫（评审修）', () => {
  it('合同 wage 被另一流程改动 → counter 409（批内等值守卫 no-op）+ accept 409（读预检），无半套后果', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);

    // counter 无读侧漂移预检——409 必然来自批内 demandOpGuard 的等值条件（TOCTOU 防线的锁）
    fx.sqlite.prepare(`UPDATE contracts SET wage = 3.0 WHERE player_id = 1`).run();
    await expect(counterDemand(fx.env, counterInput(id, 3.7))).rejects.toMatchObject({ status: 409 });
    // 整批回滚：无 attempts 行、无 pending 变更、demand 仍 pending、无审计
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_demand_attempts')).toHaveLength(0);
    expect(sqlAll(fx.sqlite, 'SELECT * FROM contract_pending_changes')).toHaveLength(0);
    expect(sqlGet<{ status: string; round: number }>(fx.sqlite, 'SELECT status, round FROM contract_demands WHERE id = ?', id)!).toMatchObject({
      status: 'pending',
      round: 0,
    });
    expect(sqlAll(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_counter'`)).toHaveLength(0);

    // accept 走读预检（assertContractUnchanged）给出同码 409
    await expect(acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });
    expect(sqlAll(fx.sqlite, `SELECT * FROM audit_log WHERE action = 'demand_accept'`)).toHaveLength(0);
  });

  it('合同行换队（club_id 已是新东家）→ counter/accept/reject 一律 409（assertOpen 归属校验）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    openWindow(fx);
    seedDemandOwner(fx, 1);
    const id = seedPendingDemand(fx);
    fx.sqlite.prepare(`UPDATE contracts SET club_id = 2 WHERE player_id = 1`).run();

    await expect(counterDemand(fx.env, counterInput(id, 3.7))).rejects.toMatchObject({ status: 409 });
    await expect(acceptDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });
    await expect(rejectDemand(fx.env, { demandId: id, clubId: 1, actor: 1, origin: 'user' })).rejects.toMatchObject({ status: 409 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM contract_demands WHERE id = ?', id)!.status).toBe('pending');
  });
});

describe('cron 扫描索引（0080，评审修 D1 读量）', () => {
  it('expireDemands 两条扫描命中 idx_contract_demands_status_expires，不再 SCAN 全表', () => {
    const fx = freshEnv();
    openWindow(fx);
    seedPendingDemand(fx);

    // due 扫描（expireDemands 的 SELECT 形状）：status IN + expires_at 区间
    const duePlan = sqlAll<{ detail: string }>(
      fx.sqlite,
      `EXPLAIN QUERY PLAN SELECT d.id FROM contract_demands d
       WHERE d.status IN ('pending','countered') AND d.expires_at <= '2026-10-26T00:00:00Z'
       ORDER BY d.id LIMIT 200`,
    ).map((r) => r.detail);
    expect(duePlan.some((detail) => detail.includes('idx_contract_demands_status_expires'))).toBe(true);
    expect(duePlan.some((detail) => detail.startsWith('SCAN d'))).toBe(false);

    // remindable 扫描：同索引复用（reminded_at 选择性差、走回表过滤，不进索引键）
    const remindPlan = sqlAll<{ detail: string }>(
      fx.sqlite,
      `EXPLAIN QUERY PLAN SELECT d.id FROM contract_demands d
       WHERE d.status IN ('pending','countered') AND d.reminded_at = ''
         AND d.expires_at <= '2026-10-26T20:00:00Z' AND d.expires_at > '2026-10-26T00:00:00Z'
       ORDER BY d.id LIMIT 200`,
    ).map((r) => r.detail);
    expect(remindPlan.some((detail) => detail.includes('idx_contract_demands_status_expires'))).toBe(true);
    expect(remindPlan.some((detail) => detail.startsWith('SCAN d'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §7 通知模板（渲染层；注册/徽章双向守卫在 src/core/notify-meta.test.ts）
// ---------------------------------------------------------------------------

describe('闹涨薪通知模板渲染', () => {
  it('四模板各自成文，字段缺失不出 "undefined"', () => {
    expect(renderNotification('demand_created', { player: '张三', target: 3.7, wage: 2.5, rcFrom: 20, rcTo: 25, deadline: '2026-10-28 08:00' })).toContain('张三');
    expect(renderNotification('demand_created', { player: '张三', target: 3.7, wage: 2.5, rcFrom: 0, rcTo: null, deadline: '2026-10-28 08:00' })).not.toContain('违约金');
    expect(renderNotification('demand_deadline', { player: '张三', deadline: '2026-10-26 08:00' })).toContain('24 小时');
    const accepted = renderNotification('demand_resolved', { player: '张三', outcome: 'accepted', wage: 3.4, rc: 25 });
    expect(accepted).toContain('已接受');
    expect(accepted).toContain('0');
    expect(renderNotification('demand_resolved', { player: '张三', outcome: 'rejected', source: 'direct' })).toContain('不满');
    expect(renderNotification('demand_resolved', { player: '张三', outcome: 'rejected', source: 'collapse', escalated: false })).toContain('转会申请');
    expect(renderNotification('demand_resolved', { player: '张三', outcome: 'rejected', source: 'lowball', escalated: true })).toContain('不满');
    expect(renderNotification('demand_rejected_public', { player: '张三', club: '俱乐部1', rc: 20 })).toContain('20 m');
    for (const text of [
      renderNotification('demand_created', { player: '张三', target: 3.7, wage: 2.5, rcFrom: 20, rcTo: 25, deadline: 'x' }),
      renderNotification('demand_deadline', { player: '张三', deadline: 'x' }),
      renderNotification('demand_resolved', { player: '张三', outcome: 'accepted', wage: 3.4, rc: null }),
      renderNotification('demand_rejected_public', { player: '张三', club: '俱乐部1', rc: null }),
    ]) {
      expect(text).not.toContain('undefined');
    }
  });

  it('全联盟通告只发真人俱乐部（CPU 队零落）', async () => {
    const fx = freshEnv();
    seedClub(fx, 1);
    seedClub(fx, 2);
    seedClub(fx, 9, true);
    const queued = await queueAllUserClubsNotification(fx.env, 'demand_rejected_public', { player: '张三', club: '俱乐部1', rc: 25 });
    expect(queued).toBe(2);
    expect(notificationsOf(fx, 'demand_rejected_public').map((n) => Number(n.club_id)).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
