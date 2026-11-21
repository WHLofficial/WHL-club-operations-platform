// v6.88.1 B3 关窗通知 outbox 测试（docs/test-plans/v6.88.1-window-close-b3.md 的 TC-B3-01…TC-B3-12 执行层）。
// 被测面：迁移 0097 表结构（CHECK 紧枚举 / (run_id, dedup_key) 复合主键即 UNIQUE / (run_id, status) 索引）、
// 三段 staging 与各自 step done 同批原子（preflight / home / squad_audit，触发器反证 = 独立第二局）、
// 崩溃后 pending 可重投（at-least-once 诚实锁）+ 坏 payload 直接 failed、
// 重复 close 不重复 / resume 跳过 done 段仍投递（局 A1 409 + 局 A2 completed 回放 + 局 B 真丢通知窗口）、
// 严格投递失败语义（failed + last_error + attempt，不阻断关窗）、无绑定 count=0 = 终态 sent、
// 管理端 GET /windows/close/status 与 POST /windows/close/notifications/retry、
// 旧 API 兼容回归（queueClubNotification 薄壳）、stageCloseNotificationStatements 单元面（多条同键不互吞）。
//
// 夹具照抄 tests/window-close-runs.test.ts 的 freshEnv / seedWindow（口径同源）；
// naming_mood 造数法照测试计划 §1.1 七步（前置闸单测先证明演化造数不空转，再进关窗链路）；
// squad_audit 不通过队用「无合同球员」（computeAudit 的 unsigned 分支，不依赖 AUTH 定级）。
// 故障注入全部用真触发器 / 真夹具（RAISE(ABORT)），不 mock DB。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import {
  createTestD1,
  createTestDb,
  applyMigrations,
  sqlGet,
  sqlAll,
  attachAuthChannel,
  authRegisterClubTeam,
} from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { deliverCloseNotifications, stageCloseNotificationStatements } from '../src/worker/window-close-outbox.ts';
import { queueClubNotification, queueClubNotificationEx } from '../src/worker/notify.ts';
import {
  evolveSatisfactionForClub,
  getActiveNaming,
  loadSatisfyConfig,
  loadTierProfiles,
} from '../src/worker/naming-ops.ts';

// ---------- 夹具基建（照抄 tests/window-close-runs.test.ts，不改既有断言） ----------

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

type Seeded = Fixture & { clubA: number; clubB: number };

function freshEnv(): Fixture {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT, locked INTEGER DEFAULT 0, must_change_pw INTEGER DEFAULT 0);
     INSERT INTO user (id, name, role, locked, must_change_pw) VALUES
       (1, '管理组甲', 'admin', 0, 0),
       (2, '教练乙', 'coach', 0, 0),
       (3, '教练丙', 'coach', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
  tour.exec('ALTER TABLE team ADD COLUMN logo_key TEXT');
  const kv = new Map<string, string>();
  const env: Env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    SESSION_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    MEDIA: {} as never,
    ASSETS: {} as never,
  };
  for (const [uid, token] of [
    [1, 'tok-admin'],
    [2, 'tok-coach'],
    [3, 'tok-coach2'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
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

let clubSeq = 9000;
async function createClub(fx: Fixture, name: string): Promise<number> {
  clubSeq += 1;
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId: clubSeq, country: 14 }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const payload: { club: { id: number } } = await res.json();
  return payload.club.id;
}

/** 绑定段（seedWindow 的 AUTH team 行 + bindcode 换码 + 教练绑定；B3-08 补绑复用） */
async function bindClub(fx: Fixture, clubId: number, auth: DatabaseSync, token: string): Promise<void> {
  authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
  const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
  const payload: { code: string } = await res.json();
  expect((await post('/api/clubs/bind', { code: payload.code }, token, fx.env)).status).toBe(201);
}

/** 基础局：两 club、球员+合同、窗口 1 开着（opts.bind=false 跳过绑定段——TC-B3-08 无绑定局） */
async function seedWindow(opts: { bind?: boolean } = {}): Promise<Seeded> {
  const fx = freshEnv();
  const clubA = await createClub(fx, '甲队');
  const clubB = await createClub(fx, '乙队');
  if (opts.bind !== false) {
    const auth = attachAuthChannel(fx.env);
    await bindClub(fx, clubA, auth, 'tok-coach');
    await bindClub(fx, clubB, auth, 'tok-coach2');
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${clubA}, 100, '2026-07-01T00:00:00Z'), (${clubB}, 100, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${clubA}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${clubB}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (50, 'fc50', '甲核心', ${clubA}, 'ST', 26, 85, 88, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 50, ${clubA}, 20, 2, 'formal', 1, '2026-06-01');`,
  );
  return { ...fx, clubA, clubB };
}

/** TC-B3-02 造 promotion 会话（真链路照 T05b：trainee 球员 + 上调单，E 快照开会时已落） */
async function seedPromotionSession(fx: Seeded, playerId: number, uid: string, clubId: number, token: string, contractId: number): Promise<void> {
  fx.sqlite.exec(
    `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, growth_tier) VALUES
       (${playerId}, '${uid}', '青训${playerId}', ${clubId}, 'ST', 18, 62, 80, 'trainee', 1);
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (${contractId}, ${playerId}, ${clubId}, 5, 0.75, 'trainee', 1, '2026-06-01');`,
  );
  expect((await post('/api/transfers/promotion', { playerId, newReleaseFee: 10 }, token, fx.env)).status).toBe(201);
}

/** TC-B3-03 / TC-B3-06 局 B / TC-B3-07 / TC-B3-09 局① / TC-B3-10 共用：naming_mood 造数（计划 §1.1）
 *  ① 常规窗关窗（本夹具窗口恒非临时）② active 冠名合同 windows_remaining=3 > 1
 *  ③ profile / satisfyCfg 由 DEFAULT 兜底（freshEnv config 无行恒真，无需造行）
 *  ④ tourTeamId 有映射（seedWindow 绑定段 AUTH team 行 tour_team_id = clubId）
 *  ⑤ 本库 result_confirmations 两行全胜（胜率 1.0 ≥ 0.5+lineBuffer → sResult=1）
 *  ⑥ delta = resultWeight×lineBuffer > 0 → to ≠ from → home.notifications 推 naming_mood
 *  （第 7 步前置闸单测见 TC-B3-01 describe 内的独立用例；确定性收口照 parity 夹具——brand_pool 全部
 *  置 discarded 把招商轮的递价机器挡在夹具之外，否则常规窗自动开轮会给 clubA 递 28 份报价、
 *  多出一条 naming_offer outbox 行，与被测的 naming_mood 混在一起） */
function seedNamingMoodInputs(fx: Seeded, windowSeq: number): void {
  fx.sqlite.exec(
    `UPDATE brand_pool SET status = 'discarded';
     INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, fans_window_start, created_at, updated_at) VALUES
       (${fx.clubA}, '甲球场', 20000, 0, 0, 0, 1800, 1800, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
     INSERT INTO naming_contracts
       (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window, windows_total, windows_remaining,
        bonus_amount, bet_attend, bet_fans, status, started_season, started_window, ended_season, ended_window,
        satisfaction, created_at, updated_at)
     VALUES (${fx.clubA}, '麒麟生物', 1.2, 3, 1, '基础', 3, 4, 3, 0, NULL, NULL, 'active', 1, 1, NULL, NULL, 1.0,
       '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');`,
  );
  seedNamingMoodResultsOnly(fx, windowSeq);
}

/** 指定窗号的全胜赛果行（第二局按新窗号重造——演化按 season+window_seq 查） */
function seedNamingMoodResultsOnly(fx: Seeded, windowSeq: number): void {
  for (const matchId of [windowSeq * 100 + 1, windowSeq * 100 + 2]) {
    fx.sqlite
      .prepare(
        `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, home_team_id, away_team_id,
            away_team, score_home, score_away, pen_home, pen_away, walkover_side)
         VALUES (1, ?, 1, ?, ?, ?, '客队', 2, 0, NULL, NULL, '')`,
      )
      .run(windowSeq, matchId, fx.clubA, fx.clubB);
  }
}

/** TC-B3-04 / TC-B3-06 局 B / TC-B3-08 / TC-B3-10 共用：无合同在队球员（unsigned → 体检不通过，
 *  不依赖 AUTH 定级——computeAudit 的 unsigned 分支独立于 ctx） */
function seedUnsignedPlayer(fx: Fixture, playerId: number, uid: string, clubId: number): void {
  fx.sqlite.exec(
    `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (${playerId}, '${uid}', '散兵${playerId}', ${clubId}, 'ST', 24, 70, 75, 'normal');`,
  );
}

/** TC-B3-04 CPU 队反例：is_cpu=1 的 active 俱乐部（体检恒通过、通知不发）。id 用 9900 号段避开
 *  createClub 的 clubSeq 自增（9001 起，本文件用例最多二三十队，9900 不会撞）。 */
function seedCpuClubWithUnsigned(fx: Fixture, playerId: number, uid: string): void {
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (9900, 'CPU队', 'premier', 'active', 1);
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (${playerId}, '${uid}', 'CPU散兵', 9900, 'ST', 24, 70, 75, 'normal');`,
  );
}

// ---------- 本文件专用 helper ----------

interface OutboxRow {
  run_id: number;
  club_id: number;
  template: string;
  payload: string;
  dedup_key: string;
  status: string;
  attempt: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

function outboxOf(sqlite: DatabaseSync, season: number, windowSeq: number): OutboxRow[] {
  return sqlAll<OutboxRow>(
    sqlite,
    `SELECT n.run_id, n.club_id, n.template, n.payload, n.dedup_key, n.status, n.attempt, n.last_error, n.created_at, n.sent_at
     FROM window_close_notifications n JOIN window_close_runs r ON r.id = n.run_id
     WHERE r.season = ? AND r.window_seq = ? ORDER BY n.dedup_key`,
    season,
    windowSeq,
  );
}

function runIdOf(sqlite: DatabaseSync, season: number, windowSeq: number): number {
  return sqlGet<{ id: number }>(sqlite, 'SELECT id FROM window_close_runs WHERE season = ? AND window_seq = ?', season, windowSeq)?.id ?? 0;
}

interface StepRow {
  step: string;
  seq: number;
  status: string;
  attempt: number;
  error: string | null;
}

function stepsOf(fx: Fixture, runId: number): StepRow[] {
  return sqlAll<StepRow>(fx.sqlite, 'SELECT step, seq, status, attempt, error FROM window_close_steps WHERE run_id = ? ORDER BY seq', runId);
}

/** promotion 会话 id（dedup_key 的动态锚——不硬编码自增值，防夹具顺序变化） */
function promotionSessionId(sqlite: DatabaseSync): number | null {
  return sqlGet<{ id: number }>(
    sqlite,
    "SELECT s.id AS id FROM negotiation_sessions s JOIN transfers t ON t.id = s.transfer_id WHERE t.type = 'promotion'",
  )?.id ?? null;
}

// ---------- TC-B3-01 表结构锁 ----------

describe('v6.88.1 B3 outbox · TC-B3-01 表结构锁', () => {
  it('TC-B3-01 0097 表与索引在场；CHECK 紧枚举拒 bogus；(run_id, dedup_key) 复合主键即 UNIQUE；MIGRATION_FILES 末条', async () => {
    const { sqlite, db } = createTestDb();
    // 断言 1：表与索引各恰 1 行、索引 SQL 逐字
    expect(sqlGet<{ n: number }>(sqlite, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'window_close_notifications'")).toMatchObject({ n: 1 });
    expect(
      sqlGet<{ sql: string }>(sqlite, "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_window_close_notifications_run_status'")?.sql,
    ).toBe('CREATE INDEX idx_window_close_notifications_run_status ON window_close_notifications(run_id, status)');
    // FK 供体：手工 run 行（claim 批在真实链路里建，这里单测直造）
    sqlite.exec(
      `INSERT INTO window_close_runs (season, window_seq, status, current_step, started_at, updated_at)
       VALUES (1, 1, 'running', 'preflight', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
    );
    // 断言 2：status CHECK 紧枚举（pending/sent/failed 三值），bogus 被拒
    expect(() =>
      sqlite.exec(
        `INSERT INTO window_close_notifications (run_id, club_id, template, payload, dedup_key, status, created_at)
         VALUES (1, 1, 't', '{}', 'k', 'bogus', '2026-07-01T00:00:00Z')`,
      ),
    ).toThrow(/CHECK/);
    // 断言 3：同 (run_id, dedup_key) 第二条 INSERT OR IGNORE → changes=0、行数仍 1（复合主键即 UNIQUE，
    // 语句走生产同源构造器 stageCloseNotificationStatements）
    const item = { clubId: 1, template: 'squad_audit_failed', dedupKey: 'k', data: { text: 'x' } };
    const first = await db.batch(stageCloseNotificationStatements(db, 1, [item]));
    expect(first.map((r) => r.meta.changes ?? 0)).toEqual([1]);
    const replay = await db.batch(stageCloseNotificationStatements(db, 1, [item]));
    expect(replay.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')).toMatchObject({ n: 1 });
    // 断言 4：tests/d1.ts MIGRATION_FILES 末条 === 0097（照 TC-MIG-03 口径的源码文本断言）
    const d1Src = readFileSync('tests/d1.ts', 'utf8');
    const filesBody = /const MIGRATION_FILES = \[([\s\S]*?)\];/.exec(d1Src)?.[1] ?? '';
    const files = [...filesBody.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(files.at(-1)).toBe('0097_window_close_notifications.sql');
  });

  it('B3 前置闸 · evolveSatisfactionForClub 造数口径不空转（计划 §1.1 第 7 步：delta>0 且 to≠from）', async () => {
    const fx = await seedWindow();
    seedNamingMoodInputs(fx, 1);
    const naming = await getActiveNaming(fx.env.DB, fx.clubA);
    if (naming === null) throw new Error('naming_contracts 种子行缺失（造数自检失败）');
    const cfg = await loadSatisfyConfig(fx.env.DB);
    const profiles = await loadTierProfiles(fx.env.DB);
    const rep = await evolveSatisfactionForClub(fx.env, naming, fx.clubA, 1, 1, 0, profiles['口碑'], cfg, 0);
    expect(rep.report.delta).toBeGreaterThan(0);
    expect(rep.report.to).not.toBe(rep.report.from);
    expect(rep.report.terminated).toBe(false);
  });
});

// ---------- TC-B3-02 preflight 段落库与原子性 ----------

describe('v6.88.1 B3 outbox · TC-B3-02 preflight 段', () => {
  it('TC-B3-02 promotion_forced 随 preflight 收口批落库并投递；批回滚则行不落（原子性反证 = 独立第二局）', async () => {
    const fx = await seedWindow();
    // 主局：promotion 会话 + 关窗（无需 force——强约不挡关窗）
    await seedPromotionSession(fx, 60, 'fc60', fx.clubA, 'tok-coach', 2);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const sessionId = promotionSessionId(fx.sqlite);
    expect(sessionId).not.toBeNull();
    // 断言 1：outbox 恰 1 行，dedup_key = promotion:{sessionId}、sent（closeWindow 内 deliverCloseNotifications 已投）
    const rows = outboxOf(fx.sqlite, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      club_id: fx.clubA,
      template: 'promotion_forced',
      dedup_key: `promotion:${sessionId}`,
      status: 'sent',
      attempt: 1,
      last_error: null,
    });
    expect(rows[0]?.sent_at).not.toBeNull();
    // 断言 2：payload 落 data 原文（含 player 键、不含渲染 text 键——渲染推迟到投递）
    const payload: unknown = JSON.parse(rows[0]?.payload ?? 'null');
    expect(payload).toMatchObject({ player: '青训60' });
    expect(payload).not.toHaveProperty('text');
    // 断言 3：notifications 表出现对应 web 行（seedWindow 只绑 web 账号、无 qq_links → 恰 1 行）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced' AND channel = 'web'")).toMatchObject({ n: 1 });

    // 断言 4 原子性反证 = 独立第二局：新窗 + 重造数据源 + 关窗前装触发器（照 T05 先例顺序）。
    // 上调单只在窗口开着时可发起（promotion API 有开窗闸）——先开窗再造 promotion 会话
    expect((await post('/api/admin/windows/open', {}, 'tok-admin', fx.env)).status).toBe(201);
    await seedPromotionSession(fx, 61, 'fc61', fx.clubB, 'tok-coach2', 3);
    fx.sqlite.exec(
      `CREATE TRIGGER fail_b3_preflight BEFORE INSERT ON window_close_notifications
       WHEN NEW.dedup_key LIKE 'promotion:%' BEGIN SELECT RAISE(ABORT, 'boom-b3'); END;`,
    );
    const res2 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(500);
    // 整批回滚证明 outbox 与 step done 同批原子：第二局 outbox 0 行、preflight step failed、run failed
    const run2Id = runIdOf(fx.sqlite, 1, 2);
    expect(run2Id).not.toBe(runIdOf(fx.sqlite, 1, 1));
    expect(outboxOf(fx.sqlite, 1, 2)).toHaveLength(0);
    expect(outboxOf(fx.sqlite, 1, 1)).toHaveLength(1); // 主局行不受波及
    const steps2 = stepsOf(fx, run2Id);
    expect(steps2[0]).toMatchObject({ step: 'preflight', status: 'failed', attempt: 1 });
    expect(steps2[0]?.error).toContain('boom-b3');
    expect(steps2.slice(1).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);
    expect(sqlGet<{ status: string; current_step: string; error: string }>(fx.sqlite, 'SELECT status, current_step, error FROM window_close_runs WHERE id = ?', run2Id)).toMatchObject({
      status: 'failed',
      current_step: 'preflight',
    });
    // 批外强约已发生（不回滚）但通知只随批落库：第二局强约没有产生第二行通知
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 1 });

    // 断言 5 resume 恢复投递（v6.88.1 评审修复钉死；对称 TC-B3-06 局 B 的 home 路径）：
    // DROP 触发器 → 再 close（同 run resume）→ 批外已强约的会话经「窗位内已成约反查」重新攒
    // 通知随收口批落库、post_close 投出。修复前此路径 promoSessions 只查 active——已结会话不再
    // 出现 ⇒ outbox 永不落行、notifications 恒 1（通知永久丢失，断言 5 必红）
    fx.sqlite.exec('DROP TRIGGER fail_b3_preflight');
    const res3 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res3.status).toBe(200);
    const session2 = sqlGet<{ id: number }>(
      fx.sqlite,
      "SELECT s.id AS id FROM negotiation_sessions s JOIN players p ON p.id = s.player_id WHERE p.uid = 'fc61'",
    )?.id ?? null;
    expect(session2).not.toBeNull();
    // preflight step 第二轮 attempt=2 转 done（resume 只前进）
    expect(stepsOf(fx, run2Id)[0]).toMatchObject({ step: 'preflight', status: 'done', attempt: 2 });
    // outbox：run2 恰 1 行、resume 反查重建（dedup 锚仍是 promotion:{sessionId2}）且已投出
    const rows3 = outboxOf(fx.sqlite, 1, 2);
    expect(rows3).toHaveLength(1);
    expect(rows3[0]).toMatchObject({
      club_id: fx.clubB,
      template: 'promotion_forced',
      dedup_key: `promotion:${session2}`,
      status: 'sent',
      attempt: 1,
    });
    // notifications：主局 1 行 + resume 投出 1 行 = 恰 2（无重复投递）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 2 });
    // resume 走完全部段收口
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM window_close_runs WHERE id = ?', run2Id)).toMatchObject({ status: 'completed' });
  });
});

// ---------- TC-B3-03 home 段落库与原子性 ----------

describe('v6.88.1 B3 outbox · TC-B3-03 home 段', () => {
  it('TC-B3-03 naming_mood 随 home 段批落库并投递（dedup = home:{clubId}:{template}:{序号}）；批回滚则行不落', async () => {
    const fx = await seedWindow();
    seedNamingMoodInputs(fx, 1);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    // 断言 1：outbox 行 dedup_key = home:{clubA}:naming_mood:0（序号 0 起）、payload 含 data 原文键、无渲染 text 键
    const rows = outboxOf(fx.sqlite, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ club_id: fx.clubA, template: 'naming_mood', dedup_key: `home:${fx.clubA}:naming_mood:0`, status: 'sent', attempt: 1 });
    const payload: Record<string, unknown> = JSON.parse(rows[0]?.payload ?? '{}');
    for (const key of ['club', 'brand', 'from', 'to', 'reason']) expect(payload, `payload.${key}`).toHaveProperty(key);
    expect(payload).not.toHaveProperty('text');
    // 断言 2：投递终态 + 对应 naming_mood web 行出现在 notifications
    expect(rows[0]?.sent_at).not.toBeNull();
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'naming_mood' AND channel = 'web'")).toMatchObject({ n: 1 });

    // 断言 3 原子性反证 = 独立第二局：新窗（合同 windows_remaining 收租后 3→2 仍 >1 可复用）+
    // result_confirmations 按新窗号重造（演化按 season+window_seq 查）→ 关窗前装 home:% 触发器
    expect(sqlGet<{ windows_remaining: number }>(fx.sqlite, 'SELECT windows_remaining FROM naming_contracts WHERE club_id = ?', fx.clubA)).toMatchObject({ windows_remaining: 2 });
    fx.sqlite.exec(`INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 2, 'open', 0, '2026-07-15T00:00:00Z');`);
    seedNamingMoodResultsOnly(fx, 2);
    fx.sqlite.exec(
      `CREATE TRIGGER fail_b3_home BEFORE INSERT ON window_close_notifications
       WHEN NEW.dedup_key LIKE 'home:%' BEGIN SELECT RAISE(ABORT, 'boom-b3'); END;`,
    );
    const res2 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(500);
    const run2Id = runIdOf(fx.sqlite, 1, 2);
    expect(outboxOf(fx.sqlite, 1, 2)).toHaveLength(0);
    expect(outboxOf(fx.sqlite, 1, 1)).toHaveLength(1); // 主局行不受波及
    const steps2 = stepsOf(fx, run2Id);
    expect(steps2[0]).toMatchObject({ step: 'preflight', status: 'done', attempt: 1 });
    expect(steps2[1]).toMatchObject({ step: 'payroll', status: 'done', attempt: 1 });
    expect(steps2[2]).toMatchObject({ step: 'home', status: 'failed', attempt: 1 });
    expect(steps2[2]?.error).toContain('boom-b3');
    expect(steps2.slice(3).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);
    // home 段整批回滚：naming_mood 通知 0 行新增（全库仍只有主局那 1 行）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'naming_mood'")).toMatchObject({ n: 1 });
  });
});

// ---------- TC-B3-04 squad_audit 段落库与原子性 ----------

describe('v6.88.1 B3 outbox · TC-B3-04 squad_audit 段', () => {
  it('TC-B3-04 squad_audit_failed 只给不通过队（dedup = squad:{clubId}、payload 五键）；CPU 队与通过队无行；临时窗无行；批回滚则行不落', async () => {
    const fx = await seedWindow();
    // 造不通过队（clubB 无合同球员）+ CPU 队反例（CPU 体检恒通过）
    seedUnsignedPlayer(fx, 62, 'fc62', fx.clubB);
    seedCpuClubWithUnsigned(fx, 63, 'fc63');
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    // 断言 1：不通过队恰 1 行 squad:{clubB}，payload 含 text/season/windowSeq/overspend/rules 五键
    //（锁「payload 可查 season/windowSeq」修复——旧 notifications.payload 只落 {text,...}）
    const rows = outboxOf(fx.sqlite, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ club_id: fx.clubB, template: 'squad_audit_failed', dedup_key: `squad:${fx.clubB}`, status: 'sent', attempt: 1 });
    const payload: Record<string, unknown> = JSON.parse(rows[0]?.payload ?? '{}');
    expect(Object.keys(payload).sort()).toEqual(['overspend', 'rules', 'season', 'text', 'windowSeq']);
    expect(payload).toMatchObject({ season: 1, windowSeq: 1, overspend: 0, rules: '无合同' });
    // 断言 2：通过队（clubA）与 CPU 队（9900）无行
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications WHERE club_id = ?', fx.clubA)).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications WHERE club_id = 9900')).toMatchObject({ n: 0 });
    // 投递终态 + web 行
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'squad_audit_failed' AND channel = 'web'")).toMatchObject({ n: 1 });

    // 断言 3：临时窗（temporary=true）squadAudit=null 走空批记账，无 squad outbox 行（分支回归锁）
    expect((await post('/api/admin/windows/open', { temporary: true }, 'tok-admin', fx.env)).status).toBe(201);
    const res2 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(200);
    expect(outboxOf(fx.sqlite, 1, 2)).toHaveLength(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM window_close_notifications WHERE dedup_key LIKE 'squad:%'")).toMatchObject({ n: 1 });

    // 断言 4 原子性反证 = 独立第三局（常规窗）：新窗 + 重造数据源（clubA 空合同球员）→
    // 关窗前装 squad:% 触发器 → closeWindow 500 → 第三局 outbox 0 行 + squad_audit step 未 done
    expect((await post('/api/admin/windows/open', {}, 'tok-admin', fx.env)).status).toBe(201);
    seedUnsignedPlayer(fx, 64, 'fc64', fx.clubA);
    fx.sqlite.exec(
      `CREATE TRIGGER fail_b3_squad BEFORE INSERT ON window_close_notifications
       WHEN NEW.dedup_key LIKE 'squad:%' BEGIN SELECT RAISE(ABORT, 'boom-b3'); END;`,
    );
    const res3 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res3.status).toBe(500);
    const run3Id = runIdOf(fx.sqlite, 1, 3);
    expect(outboxOf(fx.sqlite, 1, 3)).toHaveLength(0);
    const steps3 = stepsOf(fx, run3Id);
    expect(steps3[4]).toMatchObject({ step: 'squad_audit', status: 'failed', attempt: 1 });
    expect(steps3[4]?.error).toContain('boom-b3');
    expect(steps3.slice(5).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);
  });
});

// ---------- TC-B3-05 崩溃后 pending 可重投 + 坏 payload ----------

describe('v6.88.1 B3 outbox · TC-B3-05 崩溃后 pending 可重投（at-least-once）与坏 payload', () => {
  it('TC-B3-05 崩在已发未标：行回 pending 后重投 → sent + attempt+1 + 通知多 1 行（诚实锁重复）；坏 payload 直接 failed 不空转', async () => {
    const fx = await seedWindow();
    await seedPromotionSession(fx, 60, 'fc60', fx.clubA, 'tok-coach', 2);
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const runId = runIdOf(fx.sqlite, 1, 1);
    const sessionId = promotionSessionId(fx.sqlite);
    expect(sessionId).not.toBeNull();
    const dedup = `promotion:${sessionId}`;
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 1 });

    // 操作 A（崩在已发未标）：手动把行拨回 pending，直接调 deliverCloseNotifications
    fx.sqlite.prepare(`UPDATE window_close_notifications SET status = 'pending', sent_at = NULL WHERE run_id = ? AND dedup_key = ?`).run(runId, dedup);
    const delivered = await deliverCloseNotifications(fx.env, runId);
    expect(delivered).toEqual({ delivered: 1, failed: 0, skipped: 0 });
    // 断言 A1：该行回 sent、attempt+1、sent_at 非空
    const row = sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, dedup);
    expect(row).toMatchObject({ status: 'sent', attempt: 2, last_error: null });
    expect(row?.sent_at).not.toBeNull();
    // 断言 A2：notifications 对应模板行数 +1（at-least-once：多 1 行而非 0 行，不谎称去重）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 2 });

    // 操作 B（坏 payload）：另一行 payload 不可解析 → 一次调用直接终态 failed（不卡 pending 每轮重试）
    fx.sqlite
      .prepare(
        `INSERT INTO window_close_notifications (run_id, club_id, template, payload, dedup_key, status, attempt, created_at)
         VALUES (?, ?, 'squad_audit_failed', 'not-json', 'squad:bad', 'pending', 0, '2026-07-01T00:00:00Z')`,
      )
      .run(runId, fx.clubB);
    const delivered2 = await deliverCloseNotifications(fx.env, runId);
    expect(delivered2).toEqual({ delivered: 0, failed: 1, skipped: 0 });
    const badRow = sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, 'squad:bad');
    expect(badRow).toMatchObject({ status: 'failed', attempt: 1, last_error: 'payload 无法解析', sent_at: null });
    // 断言 3：其余行状态不变（单行独立，单行重投不搅全局）
    expect(sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, dedup)).toMatchObject({ status: 'sent', attempt: 2 });
    // 再投一轮：failed 行按 failed 语义重算（仍坏仍 failed、attempt 再 +1），已 sent 行不进查询不重投
    const delivered3 = await deliverCloseNotifications(fx.env, runId);
    expect(delivered3).toEqual({ delivered: 0, failed: 1, skipped: 0 });
    expect(sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, 'squad:bad')).toMatchObject({ status: 'failed', attempt: 2 });
    expect(sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, dedup)).toMatchObject({ status: 'sent', attempt: 2 });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'promotion_forced'")).toMatchObject({ n: 2 });
  });
});

// ---------- TC-B3-06 重复 close 不重复 + resume 跳过 done 段仍投递 ----------

describe('v6.88.1 B3 outbox · TC-B3-06 重复 close 与 resume', () => {
  it('TC-B3-06 局 A1：completed 后重调 = 409 + outbox/notifications/ledger/audit 四计数零新行', async () => {
    const fx = await seedWindow();
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const before = {
      outbox: sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')?.n ?? -1,
      notifications: sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')?.n ?? -1,
      ledger: sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM ledger_entries')?.n ?? -1,
      audit: sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM audit_log')?.n ?? -1,
    };
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    const body: { error: string } = await res.json();
    expect(body.error).toBe('当前没有开着的窗口');
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')?.n).toBe(before.outbox);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')?.n).toBe(before.notifications);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM ledger_entries')?.n).toBe(before.ledger);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM audit_log')?.n).toBe(before.audit);
  });

  it('TC-B3-06 局 A2：completed+closing 异常态真走回放——200 返回既有摘要、outbox 零新行', async () => {
    const fx = await seedWindow();
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const runId = runIdOf(fx.sqlite, 1, 1);
    const outboxBefore = sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')?.n ?? -1;
    const notifBefore = sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')?.n ?? -1;
    // 手工把窗口行拨回 closing（run 保持 completed）——completed 回放路径正常流不可达的唯一构造
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closing' WHERE season = 1 AND window_seq = 1`);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: Record<string, unknown> = await res.json();
    const stored: unknown = JSON.parse(sqlGet<{ summary_json: string }>(fx.sqlite, 'SELECT summary_json FROM window_close_runs WHERE id = ?', runId)?.summary_json ?? 'null');
    expect(body).toEqual(stored); // 逐字段 = 既有摘要（回放路径对 outbox 零副作用）
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')?.n).toBe(outboxBefore);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')?.n).toBe(notifBefore);
  });

  it('TC-B3-06 局 B：squad 段炸保 home 段落库 → resume 跳过 home 段仍从 outbox 投出（B2 丢通知窗口关死）', async () => {
    const fx = await seedWindow();
    seedNamingMoodInputs(fx, 1);
    seedUnsignedPlayer(fx, 62, 'fc62', fx.clubB);
    fx.sqlite.exec(`CREATE TRIGGER fail_b3_squad BEFORE INSERT ON squad_audits BEGIN SELECT RAISE(ABORT, 'boom-squad'); END;`);
    const res1 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res1.status).toBe(500);
    // 第一次 500 后的基线：四段 done、squad_audit failed、finalize/post_close 未跑；
    // home outbox 行已在场（pending——home 段批提交成功、post_close 未投）；squad outbox 0 行；notifications 0 行
    const runId = runIdOf(fx.sqlite, 1, 1);
    const steps1 = stepsOf(fx, runId);
    expect(steps1.slice(0, 4).every((s) => s.status === 'done' && s.attempt === 1)).toBe(true);
    expect(steps1[4]).toMatchObject({ step: 'squad_audit', status: 'failed', attempt: 1 });
    expect(steps1.slice(5).every((s) => s.status === 'pending' && s.attempt === 0)).toBe(true);
    const homeRows = outboxOf(fx.sqlite, 1, 1).filter((r) => r.dedup_key === `home:${fx.clubA}:naming_mood:0`);
    expect(homeRows).toHaveLength(1);
    expect(homeRows[0]).toMatchObject({ status: 'pending', attempt: 0, sent_at: null });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM window_close_notifications WHERE dedup_key LIKE 'squad:%'")).toMatchObject({ n: 0 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')).toMatchObject({ n: 0 });

    // resume：DROP 触发器 → 再调 close（无需 force）→ home 段 done 被跳过（builder 不重建），
    // 但 home 通知从 outbox 行投出——B3 立项诉求「崩在 home done 与 post_close 之间丢通知」关死
    fx.sqlite.exec('DROP TRIGGER fail_b3_squad');
    const res2 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(200);
    // 断言 1：home 通知仍投出（naming_mood web 行恰一套）——B2 现状此断言红（resume 时 home=null 直发跳过）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'naming_mood' AND channel = 'web'")).toMatchObject({ n: 1 });
    // 断言 2：outbox 同键行数不增——home 段 done 跳过无重建路径；squad 段重建后首插恰 1 行
    const rows = outboxOf(fx.sqlite, 1, 1);
    expect(rows.filter((r) => r.dedup_key === `home:${fx.clubA}:naming_mood:0`)).toHaveLength(1);
    expect(rows.filter((r) => r.dedup_key === `squad:${fx.clubB}`)).toHaveLength(1);
    expect(rows).toHaveLength(2);
    // 断言 3：notifications 恰一套（home 一行 + squad 一行，无重复行）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'squad_audit_failed' AND channel = 'web'")).toMatchObject({ n: 1 });
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')).toMatchObject({ n: 2 });
    // 全部行终态 sent
    expect(rows.every((r) => r.status === 'sent' && r.sent_at !== null)).toBe(true);
  });
});

// ---------- TC-B3-07 严格失败语义 + 通知失败不阻断关窗 ----------

describe('v6.88.1 B3 outbox · TC-B3-07 严格投递失败语义', () => {
  it('TC-B3-07 投递失败标 failed + last_error、post_close step failed、warnings、run 仍 completed、HTTP 响应与对照局零变化', async () => {
    // 对照局：同夹具无触发器（锁硬禁「不动算法与响应文案」的响应面）
    const clean = await seedWindow();
    seedNamingMoodInputs(clean, 1);
    const cleanRes = await post('/api/admin/windows/close', {}, 'tok-admin', clean.env);
    expect(cleanRes.status).toBe(200);
    const cleanBody: Record<string, unknown> = await cleanRes.json();

    // 故障局：触发器炸 naming_mood 的 notifications INSERT → Ex ok:false → 行 failed
    const fx = await seedWindow();
    seedNamingMoodInputs(fx, 1);
    fx.sqlite.exec(
      `CREATE TRIGGER fail_b3_notif BEFORE INSERT ON notifications
       WHEN NEW.template = 'naming_mood' BEGIN SELECT RAISE(ABORT, 'boom-notif'); END;`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200); // 通知失败不阻断关窗
    const body: Record<string, unknown> = await res.json();
    // 断言 5：closeWindow HTTP 响应摘要与对照局同形同值（ok/season/windowSeq/isTemporary/forceSettled/payroll/home/loyalty 逐字段）
    expect(body).toEqual(cleanBody);

    const runId = runIdOf(fx.sqlite, 1, 1);
    const rows = outboxOf(fx.sqlite, 1, 1);
    // 断言 1：outbox 行 failed + last_error 非空 + attempt=1 + sent_at IS NULL（ok 才 sent 的反例面）
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ club_id: fx.clubA, template: 'naming_mood', dedup_key: `home:${fx.clubA}:naming_mood:0`, status: 'failed', attempt: 1, sent_at: null });
    expect(rows[0]?.last_error).toContain('boom-notif');
    // 断言 2：post_close step failed（attempt=1），业务六段仍 done
    const steps = stepsOf(fx, runId);
    expect(steps.slice(0, 6).every((s) => s.status === 'done' && s.attempt === 1)).toBe(true);
    expect(steps[6]).toMatchObject({ step: 'post_close', status: 'failed', attempt: 1 });
    expect(steps[6]?.error).toContain('关窗通知投递失败');
    // 断言 3：run.summary_json 的 warnings 含「关窗通知投递失败」
    const stored: Record<string, unknown> = JSON.parse(sqlGet<{ summary_json: string }>(fx.sqlite, 'SELECT summary_json FROM window_close_runs WHERE id = ?', runId)?.summary_json ?? '{}');
    expect(Array.isArray(stored.warnings)).toBe(true);
    expect(JSON.stringify(stored.warnings)).toContain('关窗通知投递失败');
    // 断言 4：run.status 仍 completed（markCloseStepFailed 的 run 语句带 status <> 'completed' 守卫）
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM window_close_runs WHERE id = ?', runId)).toMatchObject({ status: 'completed' });
    // 窗口已关、演化照常落库（mood 通知失败不影响业务面）
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM season_windows WHERE season = 1 AND window_seq = 1')).toMatchObject({ status: 'closed' });
  });
});

// ---------- TC-B3-08 无绑定 count=0 = 终态 sent ----------

describe('v6.88.1 B3 outbox · TC-B3-08 无绑定', () => {
  it('TC-B3-08 无收件人 Ex 返 {ok:true,count:0}；closeWindow 后行 sent、notifications 0 行；补绑不补发', async () => {
    const fx = await seedWindow({ bind: false });
    const auth = attachAuthChannel(fx.env); // AUTH_DB 挂了但 team_binding/team 目录为空 → 回落路径双向空
    seedUnsignedPlayer(fx, 62, 'fc62', fx.clubB); // 保证有 squad outbox 行
    // 断言 1：Ex 无收件人是完成态不是失败
    const r = await queueClubNotificationEx(fx.env, fx.clubB, 'squad_audit_failed', { text: 'x' });
    expect(r).toMatchObject({ ok: true, count: 0 });
    expect(r.error).toBeUndefined();

    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    // 断言 2：outbox 行 sent 终态（count=0 不留 pending）、notifications 0 行
    const rows = outboxOf(fx.sqlite, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ club_id: fx.clubB, template: 'squad_audit_failed', dedup_key: `squad:${fx.clubB}`, status: 'sent' });
    expect(rows[0]?.sent_at).not.toBeNull();
    expect(rows[0]?.attempt).toBeGreaterThanOrEqual(1);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')).toMatchObject({ n: 0 });

    // 断言 3：补绑不补发——重调 closeWindow 409（closed 窗到不了 claim）、retry 重投也 0 行
    await bindClub(fx, fx.clubB, auth, 'tok-coach2');
    const res2 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(409);
    const body2: { error: string } = await res2.json();
    expect(body2.error).toBe('当前没有开着的窗口');
    const retry = await post('/api/admin/windows/close/notifications/retry', {}, 'tok-admin', fx.env);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ delivered: 0, failed: 0, skipped: 0 }); // rows=0：sent 行不在重投范围
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM notifications')).toMatchObject({ n: 0 });
  });
});

// ---------- TC-B3-09 状态端点 ----------

describe('v6.88.1 B3 outbox · TC-B3-09 GET /api/admin/windows/close/status', () => {
  it('TC-B3-09 局① 有 run（warnings 构造 + retry 收口）：window/run/steps/notifications 逐字段', async () => {
    // 局①：TC-B3-07 场景跑一次（触发器炸 → warnings 落库 + post_close step failed）→
    // DROP 触发器 → retry 把 failed 行投成 sent ⇒ 终态 = completed + warnings 非空 + 全 sent + post_close 仍 failed
    const fx = await seedWindow();
    seedNamingMoodInputs(fx, 1);
    fx.sqlite.exec(
      `CREATE TRIGGER fail_b3_notif BEFORE INSERT ON notifications
       WHEN NEW.template = 'naming_mood' BEGIN SELECT RAISE(ABORT, 'boom-notif'); END;`,
    );
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    // failed 通知计数（施工表 B3-11）：retry 前 status 端点照实透出 failed=1——投递失败不阻断关窗、计数不撒谎
    const failedStatusRes = await get('/api/admin/windows/close/status', 'tok-admin', fx.env);
    expect(failedStatusRes.status).toBe(200);
    const failedStatusBody: { notifications: { pending: number; sent: number; failed: number } } = await failedStatusRes.json();
    expect(failedStatusBody.notifications).toEqual({ pending: 0, sent: 0, failed: 1 });
    fx.sqlite.exec('DROP TRIGGER fail_b3_notif');
    const runId = runIdOf(fx.sqlite, 1, 1);
    expect((await post('/api/admin/windows/close/notifications/retry', {}, 'tok-admin', fx.env)).status).toBe(200);

    const res = await get('/api/admin/windows/close/status', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: {
      window: { season: number; windowSeq: number; status: string; isTemporary: boolean; openedAt: string; closedAt: string | null } | null;
      run: { id: number; season: number; windowSeq: number; status: string; currentStep: string; startedAt: string | null; updatedAt: string | null; completedAt: string | null; error: string | null; warnings: string[] } | null;
      steps: { step: string; seq: number; status: string; attempt: number; startedAt: string | null; finishedAt: string | null; error: string | null }[];
      notifications: { pending: number; sent: number; failed: number };
    } = await res.json();
    expect(body.window).toMatchObject({ season: 1, windowSeq: 1, status: 'closed', isTemporary: false, openedAt: '2026-07-01T00:00:00Z' });
    expect(body.window?.closedAt).not.toBeNull();
    // run 全字段 + warnings 数组（不透传 summaryJson 全文）
    expect(body.run).toMatchObject({
      id: runId,
      season: 1,
      windowSeq: 1,
      status: 'completed',
      currentStep: 'post_close',
      error: null,
    });
    expect(body.run?.startedAt).not.toBeNull();
    expect(body.run?.updatedAt).not.toBeNull();
    expect(body.run?.completedAt).not.toBeNull();
    expect(body.run?.warnings).toHaveLength(1);
    expect(body.run?.warnings[0]).toContain('关窗通知投递失败');
    // steps 恰 7 行按 seq 升序、每行 7 字段投影；post_close 照实透传 failed；startedAt 现状无人写恒 null
    expect(body.steps).toHaveLength(7);
    expect(body.steps.map((s) => s.step)).toEqual(['preflight', 'payroll', 'home', 'loyalty', 'squad_audit', 'finalize', 'post_close']);
    expect(body.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(body.steps.slice(0, 6).every((s) => s.status === 'done' && s.attempt === 1 && s.startedAt === null && s.error === null)).toBe(true);
    expect(body.steps[6]).toMatchObject({ step: 'post_close', status: 'failed', attempt: 1 });
    expect(body.steps[6]?.finishedAt).not.toBeNull();
    expect(body.steps[6]?.error).toContain('关窗通知投递失败');
    // notifications 计数与库逐值一致
    expect(body.notifications).toEqual({ pending: 0, sent: 1, failed: 0 });
    expect(
      sqlAll<{ status: string; n: number }>(fx.sqlite, 'SELECT status, COUNT(*) AS n FROM window_close_notifications WHERE run_id = ? GROUP BY status', runId),
    ).toEqual([{ status: 'sent', n: 1 }]);
    expect(outboxOf(fx.sqlite, 1, 1).every((r) => r.status === 'sent')).toBe(true);

    // 全绿对照局：无故障关窗 → warnings === []（解析空数组路径）
    const cleanClosed = await seedWindow();
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', cleanClosed.env)).status).toBe(200);
    const cleanStatus: { run: { warnings: string[] } | null } = await (await get('/api/admin/windows/close/status', 'tok-admin', cleanClosed.env)).json();
    expect(cleanStatus.run?.warnings).toEqual([]);
  });

  it('TC-B3-09 局② 未关窗：window 在而 run=null、steps=[]、计数全 0', async () => {
    const fx = await seedWindow();
    const res = await get('/api/admin/windows/close/status', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: { window: Record<string, unknown> | null; run: unknown; steps: unknown[]; notifications: { pending: number; sent: number; failed: number } } = await res.json();
    expect(body.window).toMatchObject({ season: 1, windowSeq: 1, status: 'open', isTemporary: false });
    expect(body.run).toBeNull();
    expect(body.steps).toEqual([]);
    expect(body.notifications).toEqual({ pending: 0, sent: 0, failed: 0 });
  });

  it('TC-B3-09 局③ 无任何窗口行：window=null（run/steps/计数同②）', async () => {
    const fx = freshEnv(); // 不 seedWindow ⇒ 无 season_windows 行
    const res = await get('/api/admin/windows/close/status', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: { window: unknown; run: unknown; steps: unknown[]; notifications: { pending: number; sent: number; failed: number } } = await res.json();
    expect(body.window).toBeNull();
    expect(body.run).toBeNull();
    expect(body.steps).toEqual([]);
    expect(body.notifications).toEqual({ pending: 0, sent: 0, failed: 0 });
  });

  it('TC-B3-09 权限：无 token 401「未登录」、coach 403「没有权限进行此操作」（取严口径随 GET /windows）', async () => {
    const fx = await seedWindow();
    const noToken = await get('/api/admin/windows/close/status', undefined, fx.env);
    expect(noToken.status).toBe(401);
    expect(((await noToken.json()) as { error: string }).error).toBe('未登录');
    const coach = await get('/api/admin/windows/close/status', 'tok-coach', fx.env);
    expect(coach.status).toBe(403);
    expect(((await coach.json()) as { error: string }).error).toBe('没有权限进行此操作');
  });

  it('TC-B3-09 run.error 透传：failed run 的 error 原样出现在 run 块，window 与 run 同窗配对', async () => {
    const fx = await seedWindow();
    seedUnsignedPlayer(fx, 62, 'fc62', fx.clubB);
    fx.sqlite.exec(`CREATE TRIGGER fail_b3_squad BEFORE INSERT ON squad_audits BEGIN SELECT RAISE(ABORT, 'boom-squad'); END;`);
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(500);
    fx.sqlite.exec('DROP TRIGGER fail_b3_squad');
    const res = await get('/api/admin/windows/close/status', 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const body: { run: { status: string; currentStep: string; error: string | null; warnings: string[] } | null; window: { status: string } | null } = await res.json();
    expect(body.run).toMatchObject({ status: 'failed', currentStep: 'squad_audit' });
    expect(body.run?.error).toContain('boom-squad');
    expect(body.run?.warnings).toEqual([]); // 段级失败不产生 post_close warnings
    expect(body.window).toMatchObject({ status: 'closing' }); // window 与 run 恒同窗配对
  });
});

// ---------- TC-B3-10 retry 端点 ----------

describe('v6.88.1 B3 outbox · TC-B3-10 POST /api/admin/windows/close/notifications/retry', () => {
  it('TC-B3-10 触发器在场重投仍 failed；拆后重投 delivered 对账；行终态 sent；审计 window_close_notify_retry', async () => {
    const fx = await seedWindow();
    seedNamingMoodInputs(fx, 1);
    fx.sqlite.exec(
      `CREATE TRIGGER fail_b3_notif BEFORE INSERT ON notifications
       WHEN NEW.template = 'naming_mood' BEGIN SELECT RAISE(ABORT, 'boom-notif'); END;`,
    );
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const runId = runIdOf(fx.sqlite, 1, 1);
    const pendingFailedCount = () =>
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM window_close_notifications WHERE run_id = ? AND status IN ('pending', 'failed')", runId)?.n ?? 0;

    // 第一次 retry（触发器在场，投递仍炸）：delivered===0、failed===N、skipped===0（重投也吃同样失败语义）
    expect(pendingFailedCount()).toBe(1);
    const res1 = await post('/api/admin/windows/close/notifications/retry', {}, 'tok-admin', fx.env);
    expect(res1.status).toBe(200);
    const body1: { delivered: number; failed: number; skipped: number } = await res1.json();
    expect(body1).toEqual({ delivered: 0, failed: 1, skipped: 0 });
    expect(body1.delivered + body1.failed + body1.skipped).toBe(1); // 对账锁：delivered+failed+skipped === rows
    expect(sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, `home:${fx.clubA}:naming_mood:0`)).toMatchObject({
      status: 'failed',
      attempt: 2,
    });

    // 第二次 retry（拆触发器后）：delivered===N、行 sent、attempt+1、last_error 清空、sent_at 非空
    fx.sqlite.exec('DROP TRIGGER fail_b3_notif');
    expect(pendingFailedCount()).toBe(1);
    const res2 = await post('/api/admin/windows/close/notifications/retry', {}, 'tok-admin', fx.env);
    expect(res2.status).toBe(200);
    const body2: { delivered: number; failed: number; skipped: number } = await res2.json();
    expect(body2).toEqual({ delivered: 1, failed: 0, skipped: 0 });
    expect(body2.delivered + body2.failed + body2.skipped).toBe(1);
    const row = sqlGet<OutboxRow>(fx.sqlite, 'SELECT * FROM window_close_notifications WHERE run_id = ? AND dedup_key = ?', runId, `home:${fx.clubA}:naming_mood:0`);
    expect(row).toMatchObject({ status: 'sent', attempt: 3, last_error: null });
    expect(row?.sent_at).not.toBeNull();
    expect(pendingFailedCount()).toBe(0);

    // 断言 6：审计恰 2 行（origin='user'、target 锚 run.id、after 三计数）
    const audits = sqlAll<{ actor: number | null; target_type: string; target_id: number | null; origin: string; after: string }>(
      fx.sqlite,
      "SELECT actor, target_type, target_id, origin, after FROM audit_log WHERE action = 'window_close_notify_retry' ORDER BY id",
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ actor: 1, target_type: 'window_close_run', target_id: runId, origin: 'user' });
    expect(JSON.parse(audits[0]?.after ?? '{}')).toEqual({ delivered: 0, failed: 1, skipped: 0 });
    expect(JSON.parse(audits[1]?.after ?? '{}')).toEqual({ delivered: 1, failed: 0, skipped: 0 });
  });

  it('TC-B3-10 无 run → 404「还没有关窗记录」；run 未完成 → 409「最近一次关窗尚未完成，先重试关窗」（两者不写审计）', async () => {
    // 404：freshEnv 无任何 run
    const fxEmpty = freshEnv();
    const res404 = await post('/api/admin/windows/close/notifications/retry', {}, 'tok-admin', fxEmpty.env);
    expect(res404.status).toBe(404);
    expect(((await res404.json()) as { error: string }).error).toBe('还没有关窗记录');
    expect(sqlGet<{ n: number }>(fxEmpty.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close_notify_retry'")).toMatchObject({ n: 0 });

    // 409：真链路造 failed run（squad 段触发器炸出 failed run）
    const fx = await seedWindow();
    seedUnsignedPlayer(fx, 62, 'fc62', fx.clubB);
    fx.sqlite.exec(`CREATE TRIGGER fail_b3_squad BEFORE INSERT ON squad_audits BEGIN SELECT RAISE(ABORT, 'boom-squad'); END;`);
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(500);
    fx.sqlite.exec('DROP TRIGGER fail_b3_squad');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM window_close_runs WHERE season = 1 AND window_seq = 1')).toMatchObject({ status: 'failed' });
    const res409 = await post('/api/admin/windows/close/notifications/retry', {}, 'tok-admin', fx.env);
    expect(res409.status).toBe(409);
    expect(((await res409.json()) as { error: string }).error).toBe('最近一次关窗尚未完成，先重试关窗');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'window_close_notify_retry'")).toMatchObject({ n: 0 });
  });

  it('TC-B3-10 retry 端点权限：无 token 401、coach 403（与 status 同口径）', async () => {
    const fx = await seedWindow();
    const noToken = await post('/api/admin/windows/close/notifications/retry', {}, undefined, fx.env);
    expect(noToken.status).toBe(401);
    expect(((await noToken.json()) as { error: string }).error).toBe('未登录');
    const coach = await post('/api/admin/windows/close/notifications/retry', {}, 'tok-coach', fx.env);
    expect(coach.status).toBe(403);
    expect(((await coach.json()) as { error: string }).error).toBe('没有权限进行此操作');
  });
});

// ---------- TC-B3-11 旧 API 兼容回归 ----------

describe('v6.88.1 B3 outbox · TC-B3-11 queueClubNotification 薄壳回归', () => {
  it('TC-B3-11 Ex ok:false 时旧壳返 0 不抛；正常态返账号+QQ 数；clubId null 返 0', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(`INSERT INTO qq_links (user_id, qq, verified_at) VALUES (2, '10001', '2026-01-01T00:00:00Z');`);
    // ① Ex ok:false（触发器炸 notifications INSERT）→ 旧壳吞错返 0 且不抛（notify.ts 旧行为逐字保留）
    fx.sqlite.exec(`CREATE TRIGGER fail_b3_notif BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'boom-notif'); END;`);
    const rFail = await queueClubNotificationEx(fx.env, fx.clubA, 'squad_audit_failed', { text: 'x' });
    expect(rFail).toMatchObject({ ok: false, count: 0 });
    expect(rFail.error).toContain('boom-notif');
    const queuedFail = await queueClubNotification(fx.env, fx.clubA, 'squad_audit_failed', { text: 'x' });
    expect(queuedFail).toBe(0);
    fx.sqlite.exec('DROP TRIGGER fail_b3_notif');
    // ② 正常态：1 绑定账号 web 行 + 1 qq 行 = 2
    const queuedOk = await queueClubNotification(fx.env, fx.clubA, 'squad_audit_failed', { text: 'x' });
    expect(queuedOk).toBe(2);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'squad_audit_failed'")).toMatchObject({ n: 2 });
    // ③ clubId === null → 返 0 不抛
    const queuedNull = await queueClubNotification(fx.env, null, 'squad_audit_failed', { text: 'x' });
    expect(queuedNull).toBe(0);
  });
});

// ---------- TC-B3-12 多条同键不互吞（单元面） ----------

describe('v6.88.1 B3 outbox · TC-B3-12 stageCloseNotificationStatements 单元面', () => {
  it('TC-B3-12 同 (clubId, template) 序号不同两行都在；同 dedup_key 重放恰 1 行；created_at 由语句构造器注入 UTC ISO', async () => {
    const { sqlite, db } = createTestDb();
    sqlite.exec(
      `INSERT INTO window_close_runs (season, window_seq, status, current_step, started_at, updated_at)
       VALUES (1, 1, 'running', 'preflight', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
    );
    const item0 = { clubId: 1, template: 'naming_offer_activated', dedupKey: 'home:1:naming_offer_activated:0', data: { club: '甲队' } };
    const item1 = { clubId: 1, template: 'naming_offer_activated', dedupKey: 'home:1:naming_offer_activated:1', data: { club: '甲队' } };
    // 断言 1：序号不同 → 两行都在（naming_offer_activated 逐合同多条场景）
    await db.batch(stageCloseNotificationStatements(db, 1, [item0, item1]));
    const rows = sqlAll<{ dedup_key: string; template: string; club_id: number }>(
      sqlite,
      'SELECT dedup_key, template, club_id FROM window_close_notifications WHERE run_id = 1 ORDER BY dedup_key',
    );
    expect(rows.map((r) => r.dedup_key)).toEqual(['home:1:naming_offer_activated:0', 'home:1:naming_offer_activated:1']);
    expect(rows.every((r) => r.template === 'naming_offer_activated' && r.club_id === 1)).toBe(true);
    // 断言 2：同 dedup_key 重放 → 恰 1 行（changes=0）
    const replay = await db.batch(stageCloseNotificationStatements(db, 1, [item0]));
    expect(replay.map((r) => r.meta.changes ?? 0)).toEqual([0]);
    expect(sqlGet<{ n: number }>(sqlite, 'SELECT COUNT(*) AS n FROM window_close_notifications')).toMatchObject({ n: 2 });
    // 断言 3：created_at 由语句构造器注入（UTC ISO 可字符串比较口径，不落 DDL DEFAULT）
    const created = sqlGet<{ created_at: string }>(sqlite, 'SELECT created_at FROM window_close_notifications WHERE dedup_key = ?', 'home:1:naming_offer_activated:0')?.created_at;
    expect(created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
