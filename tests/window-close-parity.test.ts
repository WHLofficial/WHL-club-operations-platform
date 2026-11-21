// v6.88.0 B2 前置：closeWindow parity 金样（gold sample）。
//
// 目的：在把 B1 的 close_all 单批拆成 7 个持久化 step 之前，用固定夹具把 closeWindow 的
// 关键表结果逐格钉死——业务表快照逐字断言，B2 重构后逐表比对必须原样通过；任何业务漂移
// （金额、流水顺序、balance_after、通知内容、审计顺序）都会在这里变红。
//
// 断言分两层，更新协议不同：
//   · 业务层（金样主体，B2 不得改动）：ledger_accounts / ledger_entries / contracts /
//     notifications / audit_log / registrations / squad_audits / naming_contracts / stadiums /
//     market_rounds / season_windows 的确定性列 + 关窗摘要（CloseWindowResult）。
//   · 形态层（B1 现状，B2 计划内变更）：window_close_runs / window_close_steps 的行形状
//     （B1 = 单 step close_all、seq 1）。B2 拆 7 步后【有意】更新这两张表的期望
//     （7 个 step 的 seq/名称/初始 pending），属计划内变更不算漂移；更新时业务层断言必须原样保留。
//
// 确定性口径：凡 NOW_SQL / crypto.randomUUID / 运行时钟产物（closed_at、started_at、updated_at、
// completed_at、finished_at、created_at、lease_owner、signed_at、effective_from）不进逐字断言，
// 改用「非空 / 为空」断言钉语义。夹具侧固定值（window 1 的 closed_at、opened_at、naming 的
// created_at）除外——它们是夹具自己写的，进逐字断言。
//
// 夹具（三局，覆盖语义卡点名的三情形）：
//   ① 常规窗 S1W1：工资 + 维护费 + 冠名收租 + promotion 强约 + 普通谈判强约（force）+
//      挂牌竞价（窗尾收口转待审）——preflight 与批后动作全链路。
//   ② 临时窗 S1W2：不扣工资、不收冠名（naming_contracts 原样）、无忠诚、无体检存档、无招商轮。
//   ③ 中期窗 S1W2（同赛季第 2 个常规窗）：忠诚支出（loyalty）+ 工资 + 维护费。
//
// 确定性收口手段（防夹具噪声）：
//   · brand_pool 全部置 discarded —— 招商轮照开（round 行仍在）但零报价，把 market-ops 的
//     递价机器挡在金样之外（那是 B2 不会碰的域）；冠名收租 / 情绪演化 / 档位校准不依赖品牌在池。
//   · club id 用 9001/9002（TOUR team 目录 9001–9100 号段），每局重置，与用例运行顺序无关。
//   · listing / promotion 走 API（沿用 tests/window-machine.test.ts 的成熟链路），其余直插 SQL。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import {
  createTestD1,
  applyMigrations,
  sqlGet,
  sqlAll,
  attachAuthChannel,
  authRegisterClubTeam,
} from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache, createConfigService } from '../src/core/config.ts';
import { closeWindow } from '../src/worker/window-machine.ts';

// ---------- 夹具基建（照抄 tests/window-machine.test.ts 的 freshEnv 口径） ----------

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  clubA: number;
  clubB: number;
}

function freshEnv(): { env: Env; sqlite: DatabaseSync } {
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
  return { env, sqlite };
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

async function createClub(fx: { env: Env }, name: string, gameTeamId: number): Promise<number> {
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId, country: 14 }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  const payload: { club: { id: number } } = await res.json();
  return payload.club.id;
}

/** 两队 + 绑定 + 期初账 + 赛季 + 球员 50/51 + 合同 1/2 + 球场 + 品牌全弃用（三局共用底座） */
async function seedClubsAndSquad(): Promise<Fixture> {
  const base = freshEnv();
  // club id 固定 9001/9002（TOUR team 目录 9001–9100 号段；每局重置与运行顺序无关）
  const clubA = await createClub(base, '甲队', 9001);
  const clubB = await createClub(base, '乙队', 9002);
  const auth = attachAuthChannel(base.env);
  for (const [clubId, token] of [
    [clubA, 'tok-coach'],
    [clubB, 'tok-coach2'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', base.env);
    const payload: { code: string } = await res.json();
    expect((await post('/api/clubs/bind', { code: payload.code }, token, base.env)).status).toBe(201);
  }
  base.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${clubA}, 100, '2026-07-01T00:00:00Z'), (${clubB}, 100, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${clubA}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${clubB}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (50, 'fc50', '甲核心', ${clubA}, 'ST', 26, 85, 88, 'normal'),
       (51, 'fc51', '乙铁卫', ${clubB}, 'CB', 27, 80, 84, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 50, ${clubA}, 20, 2, 'formal', 1, '2026-06-01'),
       (2, 51, ${clubB}, 18, 1.5, 'formal', 1, '2026-06-01');
     INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, fans_window_start, created_at, updated_at) VALUES
       (${clubA}, '甲球场', 20000, 0, 0, 0, 1800, 1800, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
       (${clubB}, '乙球场', 12000, 0, 0, 0, 1200, 1200, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
     UPDATE brand_pool SET status = 'discarded';`,
  );
  return { ...base, clubA, clubB };
}

/** 冠名合同（临时窗 / 常规窗共用：临时窗用它证「不收租不递减」，常规窗用它证「收租+递减+情绪演化」） */
function namingContractSql(clubA: number): string {
  return `INSERT INTO naming_contracts
       (club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window, windows_total, windows_remaining,
        bonus_amount, bet_attend, bet_fans, status, started_season, started_window, ended_season, ended_window,
        satisfaction, created_at, updated_at)
     VALUES (${clubA}, '麒麟生物', 1.2, 3, 1, '基础', 3, 4, 3, 0, NULL, NULL, 'active', 1, 1, NULL, NULL, 1.0,
       '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');`;
}

/** ① 常规窗 S1W1：全链路夹具（青训球员 + 挂牌竞价 + promotion 会话 + 普通谈判会话 + force 配置） */
async function seedRegular(): Promise<Fixture> {
  const fx = await seedClubsAndSquad();
  fx.sqlite.exec(
    `INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 1, 'open', 0, '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, growth_tier) VALUES
       (60, 'fc60', '甲青训', ${fx.clubA}, 'ST', 18, 62, 80, 'trainee', 1);
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (3, 60, ${fx.clubA}, 5, 0.75, 'trainee', 1, '2026-06-01');
     ${namingContractSql(fx.clubA)}
     INSERT INTO transfers (type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, idempotency_key, created_at)
       VALUES ('transfer', 51, ${fx.clubB}, ${fx.clubA}, 10, 'signing', 1, 1, 'parity-nego', '2026-07-01T00:00:00Z');
     INSERT INTO negotiation_sessions (transfer_id, player_id, club_id, expected_wage, release_fee, status, created_at)
       VALUES ((SELECT id FROM transfers WHERE idempotency_key = 'parity-nego'), 51, ${fx.clubA}, 1.5, 18, 'active', '2026-07-01T00:00:00Z');`,
  );
  // 挂牌 + 出价（走 API：与 tests/window-machine.test.ts 的 seedLiveBidding 同链路；deadline 在未来 ⇒
  // preflight 不收口，关窗后的窗尾收口把它转 pending_review）
  expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
  expect((await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env)).status).toBe(201);
  // promotion 会话（E 快照在开会时已落；closeWindow 无条件强约）
  expect((await post('/api/transfers/promotion', { playerId: 60, newReleaseFee: 10 }, 'tok-coach', fx.env)).status).toBe(201);
  // 普通谈判强约需要 force 配置
  const config = createConfigService(fx.env.DB);
  await config.set('window_force_settle', 'true');
  return fx;
}

/** ② 临时窗 S1W2：窗 1 已关（常规），窗 2 临时开着；冠名在场但临时窗不收租 */
async function seedTemp(): Promise<Fixture> {
  const fx = await seedClubsAndSquad();
  fx.sqlite.exec(
    `INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
       (1, 1, 'closed', 0, '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 2, 'open', 1, '2026-07-15T00:00:00Z');
     ${namingContractSql(fx.clubA)}`,
  );
  return fx;
}

/** ③ 中期窗 S1W2：窗 1 已关（常规），窗 2 常规开着 ⇒ ordinal=2 触发忠诚支出；无冠名 */
async function seedMid(): Promise<Fixture> {
  const fx = await seedClubsAndSquad();
  fx.sqlite.exec(
    `INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
       (1, 1, 'closed', 0, '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at) VALUES (1, 2, 'open', 0, '2026-07-15T00:00:00Z');`,
  );
  return fx;
}

// ---------- 快照（关键表确定性列，按 id / 主键排序） ----------

interface WindowRow {
  season: number;
  window_seq: number;
  status: string;
  is_temporary: number;
  opened_at: string;
}
interface RunRow {
  id: number;
  season: number;
  window_seq: number;
  status: string;
  current_step: string;
  error: string | null;
  summary_json: string | null;
}
interface StepRow {
  run_id: number;
  step: string;
  seq: number;
  status: string;
  attempt: number;
  error: string | null;
}
interface AccountRow {
  club_id: number;
  balance: number;
}
interface EntryRow {
  id: number;
  club_id: number;
  kind: string;
  amount: number;
  balance_after: number;
  ref_type: string | null;
  ref_id: number | null;
  memo: string;
}
interface ContractRow {
  id: number;
  player_id: number;
  club_id: number | null;
  release_fee: number | null;
  wage: number | null;
  contract_type: string | null;
  source: string | null;
  is_active: number;
  service_ticks: number;
  protection_ticks: number | null;
  signed_season: number | null;
  signed_window_seq: number | null;
  protected_until: string | null;
  free_rc_change_used: number | null;
}
interface NotificationRow {
  id: number;
  club_id: number | null;
  user_id: number | null;
  channel: string | null;
  template: string | null;
  payload: string | null;
  status: string | null;
}
interface AuditRow {
  id: number;
  actor: number | null;
  action: string;
  target_type: string;
  target_id: number | null;
  origin: string;
  before: string | null;
  after: string | null;
}
interface RegistrationRow {
  season: number;
  club_id: number;
  player_id: number;
  squad: string;
}
interface SquadAuditRow {
  season: number;
  window_seq: number;
  club_id: number;
  pass: number;
  issues_json: string;
  stats_json: string;
}
interface NamingRow {
  id: number;
  club_id: number;
  brand: string;
  brand_heat: number;
  base_fee: number;
  package_no: number;
  pkg_name: string;
  fee_per_window: number;
  windows_total: number;
  windows_remaining: number;
  bonus_amount: number;
  bet_attend: number | null;
  bet_fans: number | null;
  status: string;
  started_season: number;
  started_window: number;
  ended_season: number | null;
  ended_window: number | null;
  satisfaction: number;
}
interface StadiumRow {
  club_id: number;
  capacity: number;
  tier: number;
  fans: number;
  fans_window_start: number;
}
interface RoundRow {
  id: number;
  opened_season: number;
  opened_window: number;
  status: string;
}

interface ParitySnapshot {
  windows: WindowRow[];
  runs: RunRow[];
  steps: StepRow[];
  accounts: AccountRow[];
  entries: EntryRow[];
  contracts: ContractRow[];
  notifications: NotificationRow[];
  auditLog: AuditRow[];
  registrations: RegistrationRow[];
  squadAudits: SquadAuditRow[];
  naming: NamingRow[];
  stadiums: StadiumRow[];
  rounds: RoundRow[];
}

function takeSnapshot(sqlite: DatabaseSync): ParitySnapshot {
  return {
    windows: sqlAll<WindowRow>(
      sqlite,
      'SELECT season, window_seq, status, is_temporary, opened_at FROM season_windows ORDER BY season, window_seq',
    ),
    runs: sqlAll<RunRow>(
      sqlite,
      'SELECT id, season, window_seq, status, current_step, error, summary_json FROM window_close_runs ORDER BY id',
    ),
    steps: sqlAll<StepRow>(
      sqlite,
      'SELECT run_id, step, seq, status, attempt, error FROM window_close_steps ORDER BY run_id, seq',
    ),
    accounts: sqlAll<AccountRow>(sqlite, 'SELECT club_id, balance FROM ledger_accounts ORDER BY club_id'),
    entries: sqlAll<EntryRow>(
      sqlite,
      'SELECT id, club_id, kind, amount, balance_after, ref_type, ref_id, memo FROM ledger_entries ORDER BY id',
    ),
    contracts: sqlAll<ContractRow>(
      sqlite,
      `SELECT id, player_id, club_id, release_fee, wage, contract_type, source, is_active, service_ticks,
              protection_ticks, signed_season, signed_window_seq, protected_until, free_rc_change_used
       FROM contracts ORDER BY id`,
    ),
    notifications: sqlAll<NotificationRow>(
      sqlite,
      'SELECT id, club_id, user_id, channel, template, payload, status FROM notifications ORDER BY id',
    ),
    auditLog: sqlAll<AuditRow>(
      sqlite,
      // 排除 club_bindcode_create：夹具发码动作，after.expiresAt = 发码时刻 + TTL（运行时钟产物）。
      // 其余夹具审计行（club_create / club_bind / listing_create / bid_place / promotion_open /
      // negotiation_open）逐字确定，与 closeWindow 产出的行一起按 id 排序钉死。
      `SELECT id, actor, action, target_type, target_id, origin, before, after FROM audit_log
       WHERE action <> 'club_bindcode_create' ORDER BY id`,
    ),
    registrations: sqlAll<RegistrationRow>(
      sqlite,
      'SELECT season, club_id, player_id, squad FROM registrations ORDER BY season, club_id, player_id',
    ),
    squadAudits: sqlAll<SquadAuditRow>(
      sqlite,
      'SELECT season, window_seq, club_id, pass, issues_json, stats_json FROM squad_audits ORDER BY season, window_seq, club_id',
    ),
    naming: sqlAll<NamingRow>(
      sqlite,
      `SELECT id, club_id, brand, brand_heat, base_fee, package_no, pkg_name, fee_per_window, windows_total,
              windows_remaining, bonus_amount, bet_attend, bet_fans, status, started_season, started_window,
              ended_season, ended_window, satisfaction
       FROM naming_contracts ORDER BY id`,
    ),
    stadiums: sqlAll<StadiumRow>(
      sqlite,
      'SELECT club_id, capacity, tier, fans, fans_window_start FROM stadiums ORDER BY club_id',
    ),
    rounds: sqlAll<RoundRow>(
      sqlite,
      'SELECT id, opened_season, opened_window, status FROM market_rounds ORDER BY id',
    ),
  };
}

/** 挥发列语义（NOW_SQL / UUID 产物）：不逐字断言，只钉「非空 / 为空」 */
function expectVolatileColumns(sqlite: DatabaseSync, season: number, windowSeq: number): void {
  const win = sqlGet<{ closed_at: string | null }>(
    sqlite,
    'SELECT closed_at FROM season_windows WHERE season = ? AND window_seq = ?',
    season,
    windowSeq,
  );
  expect(win?.closed_at, 'closed_at 已落').not.toBeNull();
  const run = sqlGet<{
    started_at: string | null;
    updated_at: string | null;
    completed_at: string | null;
    lease_owner: string | null;
    lease_expires_at: string | null;
  }>(
    sqlite,
    'SELECT started_at, updated_at, completed_at, lease_owner, lease_expires_at FROM window_close_runs WHERE season = ? AND window_seq = ?',
    season,
    windowSeq,
  );
  expect(run?.started_at, 'run.started_at 已落').not.toBeNull();
  expect(run?.updated_at, 'run.updated_at 已落').not.toBeNull();
  expect(run?.completed_at, 'run.completed_at 已落').not.toBeNull();
  expect(run, '完成清租').toMatchObject({ lease_owner: null, lease_expires_at: null });
  const steps = sqlAll<{ status: string; finished_at: string | null }>(
    sqlite,
    'SELECT status, finished_at FROM window_close_steps ORDER BY run_id, seq',
  );
  for (const s of steps) {
    expect(s.finished_at, `step(${s.status}) finished_at 已落`).not.toBeNull();
  }
}

function countOf(sqlite: DatabaseSync, table: string): number {
  return sqlGet<{ n: number }>(sqlite, `SELECT COUNT(*) AS n FROM ${table}`)?.n ?? -1;
}

// ---------- 金样（B1 基线逐字快照） ----------

interface GoldSet {
  snap: ParitySnapshot;
  summary: Record<string, unknown>;
}

type GoldMode = 'regular' | 'temp' | 'mid';

// —— 金样字面量（2026-11-21 在 B1 基线上捕获，来源 tests/window-close-parity.test.ts 直跑 closeWindow）——
// 三局摘要：summary_json 与 window_close 审计 after 的 payroll/home 都复用同一对象，
// JSON.stringify 后必须与库内字符串逐字节一致（键序 = 写入时的插入序，改动键序即变红）。
const GOLD_REGULAR_SUMMARY = {
  ok: true,
  season: 1,
  windowSeq: 1,
  isTemporary: false,
  forceSettled: 1,
  payroll: { wageClubs: 1, wageTotal: 4.29, taxClubs: 0, taxTotal: 0, wageFloorClubs: 0 },
  home: {
    maintenanceClubs: 2,
    maintenanceTotal: 4,
    fansClubs: 2,
    namingClubs: 1,
    namingTotal: 3,
    activityClubs: 0,
    activityTotal: 0,
    activityOpsCost: 0,
    moodClubs: 0,
    terminatedClubs: 0,
    marketOffers: 0,
    activatedClubs: 0,
    pendingApplied: 0,
    pendingVoided: 0,
  },
  loyalty: { count: 0, total: 0 },
};

const GOLD_TEMP_SUMMARY = {
  ok: true,
  season: 1,
  windowSeq: 2,
  isTemporary: true,
  forceSettled: 0,
  payroll: { wageClubs: 0, wageTotal: 0, taxClubs: 0, taxTotal: 0, wageFloorClubs: 0 },
  home: {
    maintenanceClubs: 2,
    maintenanceTotal: 4,
    fansClubs: 2,
    namingClubs: 0,
    namingTotal: 0,
    activityClubs: 0,
    activityTotal: 0,
    activityOpsCost: 0,
    moodClubs: 0,
    terminatedClubs: 0,
    marketOffers: 0,
    activatedClubs: 0,
    pendingApplied: 0,
    pendingVoided: 0,
  },
  loyalty: { count: 0, total: 0 },
};

const GOLD_MID_SUMMARY = {
  ok: true,
  season: 1,
  windowSeq: 2,
  isTemporary: false,
  forceSettled: 0,
  payroll: { wageClubs: 2, wageTotal: 3.5, taxClubs: 0, taxTotal: 0, wageFloorClubs: 0 },
  home: {
    maintenanceClubs: 2,
    maintenanceTotal: 4,
    fansClubs: 2,
    namingClubs: 0,
    namingTotal: 0,
    activityClubs: 0,
    activityTotal: 0,
    activityOpsCost: 0,
    moodClubs: 0,
    terminatedClubs: 0,
    marketOffers: 0,
    activatedClubs: 0,
    pendingApplied: 0,
    pendingVoided: 0,
  },
  loyalty: { count: 2, total: 1.9 },
};

/** window_close 审计 after 的组合原文（键序 = window-machine.ts 写入序；payroll/home 与摘要同源） */
function closeAuditAfter(
  summary: { payroll: object; home: object },
  o: {
    season: number;
    windowSeq: number;
    isTemporary: boolean;
    forceSettled: number;
    promotionForceSettled: number;
    loyaltyCount: number;
    loyaltyTotal: number;
  },
): string {
  return JSON.stringify({ ...o, payroll: summary.payroll, home: summary.home });
}

const GOLD: Record<GoldMode, GoldSet> = {
  regular: {
    summary: GOLD_REGULAR_SUMMARY,
    snap: {
      windows: [{ season: 1, window_seq: 1, status: 'closed', is_temporary: 0, opened_at: '2026-07-01T00:00:00Z' }],
      runs: [
        {
          id: 1,
          season: 1,
          window_seq: 1,
          status: 'completed',
          current_step: 'close_all',
          error: null,
          summary_json: JSON.stringify(GOLD_REGULAR_SUMMARY),
        },
      ],
      steps: [{ run_id: 1, step: 'close_all', seq: 1, status: 'done', attempt: 1, error: null }],
      accounts: [
        { club_id: 9001, balance: 86.71 },
        { club_id: 9002, balance: 107 },
      ],
      entries: [
        { id: 1, club_id: 9001, kind: 'opening_import', amount: 100, balance_after: 100, ref_type: null, ref_id: null, memo: '期初' },
        { id: 2, club_id: 9002, kind: 'opening_import', amount: 100, balance_after: 100, ref_type: null, ref_id: null, memo: '期初' },
        { id: 3, club_id: 9001, kind: 'transfer_in', amount: -10, balance_after: 90, ref_type: 'transfer', ref_id: 1, memo: '转会买人付款' },
        { id: 4, club_id: 9002, kind: 'transfer_out', amount: 10, balance_after: 110, ref_type: 'transfer', ref_id: 1, memo: '转会卖人收入' },
        { id: 5, club_id: 9002, kind: 'transfer_tax', amount: -1, balance_after: 109, ref_type: 'transfer', ref_id: 1, memo: '交易税（销毁）' },
        { id: 6, club_id: 9001, kind: 'wage', amount: -4.29, balance_after: 85.71, ref_type: 'window', ref_id: 101, memo: '球员工资（S1 第 1 窗，3 人现行合同）' },
        { id: 7, club_id: 9001, kind: 'maintenance', amount: -2, balance_after: 83.71, ref_type: 'window', ref_id: 101, memo: '球场维护（S1 第 1 窗，0 场主场）' },
        { id: 8, club_id: 9001, kind: 'naming_fee', amount: 3, balance_after: 86.71, ref_type: 'window', ref_id: 101, memo: '麒麟生物 冠名费（基础套餐，剩 3 窗）' },
        { id: 9, club_id: 9002, kind: 'maintenance', amount: -2, balance_after: 107, ref_type: 'window', ref_id: 101, memo: '球场维护（S1 第 1 窗，0 场主场）' },
      ],
      contracts: [
        { id: 1, player_id: 50, club_id: 9001, release_fee: 20, wage: 2, contract_type: 'formal', source: null, is_active: 1, service_ticks: 0, protection_ticks: null, signed_season: null, signed_window_seq: null, protected_until: null, free_rc_change_used: 0 },
        { id: 2, player_id: 51, club_id: 9001, release_fee: 18, wage: 1.5, contract_type: 'formal', source: 'forced', is_active: 1, service_ticks: 0, protection_ticks: 3, signed_season: 1, signed_window_seq: 1, protected_until: null, free_rc_change_used: 0 },
        { id: 3, player_id: 60, club_id: 9001, release_fee: 10, wage: 0.79, contract_type: 'formal', source: 'forced', is_active: 1, service_ticks: 0, protection_ticks: 3, signed_season: null, signed_window_seq: null, protected_until: null, free_rc_change_used: 0 },
      ],
      notifications: [
        { id: 1, club_id: 9001, user_id: 2, channel: 'web', template: 'promotion_forced', payload: '{"text":"⏫ 关窗强约：甲青训 的上调谈判按预期工资成约，合同转正式，球员回一线队。"}', status: 'sent' },
      ],
      auditLog: [
        { id: 1, actor: 1, action: 'club_create', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"name":"甲队","gameTeamId":9001,"leagueTier":"premier","country":14}' },
        { id: 2, actor: 1, action: 'club_create', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"name":"乙队","gameTeamId":9002,"leagueTier":"premier","country":14}' },
        { id: 4, actor: 2, action: 'club_bind', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"userId":2}' },
        { id: 6, actor: 3, action: 'club_bind', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"userId":3}' },
        { id: 7, actor: 2, action: 'listing_create', target_type: 'listing', target_id: null, origin: 'user', before: null, after: '{"playerId":50,"clubId":9001,"askPrice":15,"season":1,"windowSeq":1}' },
        { id: 8, actor: 3, action: 'bid_place', target_type: 'listing', target_id: 1, origin: 'user', before: null, after: '{"clubId":9002,"amount":15}' },
        { id: 9, actor: 2, action: 'promotion_open', target_type: 'transfer', target_id: 2, origin: 'user', before: null, after: '{"playerId":60,"clubId":9001,"releaseFee":10,"surcharge":0,"auto":false}' },
        { id: 10, actor: 2, action: 'negotiation_open', target_type: 'negotiation', target_id: 2, origin: 'user', before: null, after: '{"playerId":60,"clubId":9001,"fixedReleaseFee":10,"expectedWage":0.79}' },
        { id: 11, actor: 1, action: 'negotiation_settle', target_type: 'negotiation', target_id: 2, origin: 'user', before: null, after: '{"settleSource":"forced"}' },
        { id: 12, actor: 1, action: 'transfer_complete', target_type: 'transfer', target_id: 2, origin: 'user', before: null, after: '{"fee":0,"tax":0,"playerId":60,"fromClubId":9001,"toClubId":9001,"settleSource":"forced","contractType":"formal"}' },
        { id: 13, actor: 1, action: 'negotiation_settle', target_type: 'negotiation', target_id: 1, origin: 'user', before: null, after: '{"settleSource":"forced"}' },
        { id: 14, actor: 1, action: 'transfer_complete', target_type: 'transfer', target_id: 1, origin: 'user', before: null, after: '{"fee":10,"tax":1,"playerId":51,"fromClubId":9002,"toClubId":9001,"settleSource":"forced","contractType":"formal"}' },
        {
          id: 15,
          actor: 1,
          action: 'window_close',
          target_type: 'season_window',
          target_id: null,
          origin: 'user',
          before: null,
          after: closeAuditAfter(GOLD_REGULAR_SUMMARY, {
            season: 1,
            windowSeq: 1,
            isTemporary: false,
            forceSettled: 1,
            promotionForceSettled: 1,
            loyaltyCount: 0,
            loyaltyTotal: 0,
          }),
        },
        { id: 16, actor: 1, action: 'listing_settle', target_type: 'listing', target_id: 1, origin: 'user', before: null, after: '{"playerId":50,"season":1,"windowSeq":1}' },
      ],
      registrations: [
        { season: 1, club_id: 9001, player_id: 50, squad: 'first_team' },
        { season: 1, club_id: 9001, player_id: 51, squad: 'first_team' },
        { season: 1, club_id: 9001, player_id: 60, squad: 'first_team' },
      ],
      squadAudits: [
        { season: 1, window_seq: 1, club_id: 9001, pass: 1, issues_json: '[]', stats_json: '{"firstTeam":3,"trainee":0,"unsigned":0,"wageNow":4.29,"wageAfter":4.29,"wageCap":null,"overspend":0,"isCpu":false}' },
        { season: 1, window_seq: 1, club_id: 9002, pass: 1, issues_json: '[]', stats_json: '{"firstTeam":0,"trainee":0,"unsigned":0,"wageNow":0,"wageAfter":0,"wageCap":null,"overspend":0,"isCpu":false}' },
      ],
      naming: [
        { id: 1, club_id: 9001, brand: '麒麟生物', brand_heat: 1.2, base_fee: 3, package_no: 1, pkg_name: '基础', fee_per_window: 3, windows_total: 4, windows_remaining: 2, bonus_amount: 0, bet_attend: null, bet_fans: null, status: 'active', started_season: 1, started_window: 1, ended_season: null, ended_window: null, satisfaction: 1 },
      ],
      stadiums: [
        { club_id: 9001, capacity: 20000, tier: 0, fans: 900, fans_window_start: 900 },
        { club_id: 9002, capacity: 12000, tier: 0, fans: 600, fans_window_start: 600 },
      ],
      rounds: [{ id: 1, opened_season: 1, opened_window: 1, status: 'open' }],
    },
  },
  temp: {
    summary: GOLD_TEMP_SUMMARY,
    snap: {
      windows: [
        { season: 1, window_seq: 1, status: 'closed', is_temporary: 0, opened_at: '2026-07-01T00:00:00Z' },
        { season: 1, window_seq: 2, status: 'closed', is_temporary: 1, opened_at: '2026-07-15T00:00:00Z' },
      ],
      runs: [
        {
          id: 1,
          season: 1,
          window_seq: 2,
          status: 'completed',
          current_step: 'close_all',
          error: null,
          summary_json: JSON.stringify(GOLD_TEMP_SUMMARY),
        },
      ],
      steps: [{ run_id: 1, step: 'close_all', seq: 1, status: 'done', attempt: 1, error: null }],
      accounts: [
        { club_id: 9001, balance: 98 },
        { club_id: 9002, balance: 98 },
      ],
      entries: [
        { id: 1, club_id: 9001, kind: 'opening_import', amount: 100, balance_after: 100, ref_type: null, ref_id: null, memo: '期初' },
        { id: 2, club_id: 9002, kind: 'opening_import', amount: 100, balance_after: 100, ref_type: null, ref_id: null, memo: '期初' },
        { id: 3, club_id: 9001, kind: 'maintenance', amount: -2, balance_after: 98, ref_type: 'window', ref_id: 102, memo: '球场维护（S1 第 2 窗，0 场主场）' },
        { id: 4, club_id: 9002, kind: 'maintenance', amount: -2, balance_after: 98, ref_type: 'window', ref_id: 102, memo: '球场维护（S1 第 2 窗，0 场主场）' },
      ],
      contracts: [
        { id: 1, player_id: 50, club_id: 9001, release_fee: 20, wage: 2, contract_type: 'formal', source: null, is_active: 1, service_ticks: 0, protection_ticks: null, signed_season: null, signed_window_seq: null, protected_until: null, free_rc_change_used: 0 },
        { id: 2, player_id: 51, club_id: 9002, release_fee: 18, wage: 1.5, contract_type: 'formal', source: null, is_active: 1, service_ticks: 0, protection_ticks: null, signed_season: null, signed_window_seq: null, protected_until: null, free_rc_change_used: 0 },
      ],
      notifications: [],
      auditLog: [
        { id: 1, actor: 1, action: 'club_create', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"name":"甲队","gameTeamId":9001,"leagueTier":"premier","country":14}' },
        { id: 2, actor: 1, action: 'club_create', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"name":"乙队","gameTeamId":9002,"leagueTier":"premier","country":14}' },
        { id: 4, actor: 2, action: 'club_bind', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"userId":2}' },
        { id: 6, actor: 3, action: 'club_bind', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"userId":3}' },
        {
          id: 7,
          actor: 1,
          action: 'window_close',
          target_type: 'season_window',
          target_id: null,
          origin: 'user',
          before: null,
          after: closeAuditAfter(GOLD_TEMP_SUMMARY, {
            season: 1,
            windowSeq: 2,
            isTemporary: true,
            forceSettled: 0,
            promotionForceSettled: 0,
            loyaltyCount: 0,
            loyaltyTotal: 0,
          }),
        },
      ],
      registrations: [],
      squadAudits: [],
      naming: [
        { id: 1, club_id: 9001, brand: '麒麟生物', brand_heat: 1.2, base_fee: 3, package_no: 1, pkg_name: '基础', fee_per_window: 3, windows_total: 4, windows_remaining: 3, bonus_amount: 0, bet_attend: null, bet_fans: null, status: 'active', started_season: 1, started_window: 1, ended_season: null, ended_window: null, satisfaction: 1 },
      ],
      stadiums: [
        { club_id: 9001, capacity: 20000, tier: 0, fans: 900, fans_window_start: 900 },
        { club_id: 9002, capacity: 12000, tier: 0, fans: 600, fans_window_start: 600 },
      ],
      rounds: [],
    },
  },
  mid: {
    summary: GOLD_MID_SUMMARY,
    snap: {
      windows: [
        { season: 1, window_seq: 1, status: 'closed', is_temporary: 0, opened_at: '2026-07-01T00:00:00Z' },
        { season: 1, window_seq: 2, status: 'closed', is_temporary: 0, opened_at: '2026-07-15T00:00:00Z' },
      ],
      runs: [
        {
          id: 1,
          season: 1,
          window_seq: 2,
          status: 'completed',
          current_step: 'close_all',
          error: null,
          summary_json: JSON.stringify(GOLD_MID_SUMMARY),
        },
      ],
      steps: [{ run_id: 1, step: 'close_all', seq: 1, status: 'done', attempt: 1, error: null }],
      accounts: [
        { club_id: 9001, balance: 95 },
        { club_id: 9002, balance: 95.6 },
      ],
      entries: [
        { id: 1, club_id: 9001, kind: 'opening_import', amount: 100, balance_after: 100, ref_type: null, ref_id: null, memo: '期初' },
        { id: 2, club_id: 9002, kind: 'opening_import', amount: 100, balance_after: 100, ref_type: null, ref_id: null, memo: '期初' },
        { id: 3, club_id: 9001, kind: 'wage', amount: -2, balance_after: 98, ref_type: 'window', ref_id: 102, memo: '球员工资（S1 第 2 窗，1 人现行合同）' },
        { id: 4, club_id: 9002, kind: 'wage', amount: -1.5, balance_after: 98.5, ref_type: 'window', ref_id: 102, memo: '球员工资（S1 第 2 窗，1 人现行合同）' },
        { id: 5, club_id: 9001, kind: 'maintenance', amount: -2, balance_after: 96, ref_type: 'window', ref_id: 102, memo: '球场维护（S1 第 2 窗，0 场主场）' },
        { id: 6, club_id: 9002, kind: 'maintenance', amount: -2, balance_after: 96.5, ref_type: 'window', ref_id: 102, memo: '球场维护（S1 第 2 窗，0 场主场）' },
        { id: 7, club_id: 9001, kind: 'loyalty', amount: -1, balance_after: 95, ref_type: 'window', ref_id: 102, memo: '忠诚支出（S1 第 2 窗，1 人现行合同）' },
        { id: 8, club_id: 9002, kind: 'loyalty', amount: -0.9, balance_after: 95.6, ref_type: 'window', ref_id: 102, memo: '忠诚支出（S1 第 2 窗，1 人现行合同）' },
      ],
      contracts: [
        { id: 1, player_id: 50, club_id: 9001, release_fee: 20, wage: 2, contract_type: 'formal', source: null, is_active: 1, service_ticks: 0, protection_ticks: null, signed_season: null, signed_window_seq: null, protected_until: null, free_rc_change_used: 0 },
        { id: 2, player_id: 51, club_id: 9002, release_fee: 18, wage: 1.5, contract_type: 'formal', source: null, is_active: 1, service_ticks: 0, protection_ticks: null, signed_season: null, signed_window_seq: null, protected_until: null, free_rc_change_used: 0 },
      ],
      notifications: [],
      auditLog: [
        { id: 1, actor: 1, action: 'club_create', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"name":"甲队","gameTeamId":9001,"leagueTier":"premier","country":14}' },
        { id: 2, actor: 1, action: 'club_create', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"name":"乙队","gameTeamId":9002,"leagueTier":"premier","country":14}' },
        { id: 4, actor: 2, action: 'club_bind', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"userId":2}' },
        { id: 6, actor: 3, action: 'club_bind', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"userId":3}' },
        // B2 分段提交：loyalty 段先于 finalize 段落库，审计 id/顺序随提交顺序平移；内容不变
        { id: 7, actor: 1, action: 'loyalty_charge', target_type: 'club', target_id: 9001, origin: 'user', before: null, after: '{"season":1,"windowSeq":2,"contracts":1,"amount":1}' },
        { id: 8, actor: 1, action: 'loyalty_charge', target_type: 'club', target_id: 9002, origin: 'user', before: null, after: '{"season":1,"windowSeq":2,"contracts":1,"amount":0.9}' },
        {
          id: 9,
          actor: 1,
          action: 'window_close',
          target_type: 'season_window',
          target_id: null,
          origin: 'user',
          before: null,
          after: closeAuditAfter(GOLD_MID_SUMMARY, {
            season: 1,
            windowSeq: 2,
            isTemporary: false,
            forceSettled: 0,
            promotionForceSettled: 0,
            loyaltyCount: 2,
            loyaltyTotal: 1.9,
          }),
        },
      ],
      registrations: [
        { season: 1, club_id: 9001, player_id: 50, squad: 'first_team' },
        { season: 1, club_id: 9002, player_id: 51, squad: 'first_team' },
      ],
      squadAudits: [
        { season: 1, window_seq: 2, club_id: 9001, pass: 1, issues_json: '[]', stats_json: '{"firstTeam":1,"trainee":0,"unsigned":0,"wageNow":2,"wageAfter":2,"wageCap":null,"overspend":0,"isCpu":false}' },
        { season: 1, window_seq: 2, club_id: 9002, pass: 1, issues_json: '[]', stats_json: '{"firstTeam":1,"trainee":0,"unsigned":0,"wageNow":1.5,"wageAfter":1.5,"wageCap":null,"overspend":0,"isCpu":false}' },
      ],
      naming: [],
      stadiums: [
        { club_id: 9001, capacity: 20000, tier: 0, fans: 900, fans_window_start: 900 },
        { club_id: 9002, capacity: 12000, tier: 0, fans: 600, fans_window_start: 600 },
      ],
      rounds: [{ id: 1, opened_season: 1, opened_window: 2, status: 'open' }],
    },
  },
};

/** 金样比对（逐表 toEqual，label 定位漂移面） */
function expectGold(received: unknown, gold: unknown, label: string): void {
  expect(received, label).toEqual(gold);
}

const B2_STEPS = ['preflight', 'payroll', 'home', 'loyalty', 'squad_audit', 'finalize', 'post_close'];

/** 结构层断言：B2 有意把 B1 的单 step close_all 拆成 7 段，不能拿 B1 结构当 parity 金样 */
function expectB2Structure(snap: ParitySnapshot): void {
  expect(snap.runs, 'run completed').toMatchObject([{ status: 'completed', current_step: 'post_close', error: null }]);
  expect(snap.steps.map((s) => s.step), '7 段 step').toEqual(B2_STEPS);
  expect(snap.steps.map((s) => s.seq), 'step seq 1-7').toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(snap.steps.every((s) => s.status === 'done' && s.attempt === 1 && s.error === null), '7 段全 done').toBe(true);
}

/** 共同尾断言：完成态语义 + completed 后重放 409 且零新行 */
async function expectCompletedAndNoReplay(fx: Fixture, season: number, windowSeq: number): Promise<void> {
  expectVolatileColumns(fx.sqlite, season, windowSeq);
  const entryCount = countOf(fx.sqlite, 'ledger_entries');
  const notifCount = countOf(fx.sqlite, 'notifications');
  const auditCount = countOf(fx.sqlite, 'audit_log');
  await expect(closeWindow(fx.env, 1, false)).rejects.toMatchObject({
    status: 409,
    message: '当前没有开着的窗口',
  });
  expect(countOf(fx.sqlite, 'ledger_entries'), '重放零新流水').toBe(entryCount);
  expect(countOf(fx.sqlite, 'notifications'), '重放零新通知').toBe(notifCount);
  expect(countOf(fx.sqlite, 'audit_log'), '重放零新审计').toBe(auditCount);
}

// ---------- 金样用例 ----------

describe('v6.88.0 closeWindow parity 金样（B1 基线）', () => {
  it('① 常规窗 S1W1：工资+维护+冠名+promotion/谈判强约+窗尾收口，全表逐字', async () => {
    const fx = await seedRegular();
    const result = await closeWindow(fx.env, 1, true);
    const snap = takeSnapshot(fx.sqlite);
    const gold = GOLD.regular;
    // 响应与 summary_json 同源（completed 重放靠它，回执必须逐字段一致）
    const stored: Record<string, unknown> = JSON.parse(snap.runs[0]?.summary_json ?? 'null');
    expect(result).toEqual(stored);
    expectB2Structure(snap);
    expectGold(result, gold.summary, 'regular.summary');
    expectGold(snap.windows, gold.snap.windows, 'regular.windows');
    // runs/steps 结构由 expectB2Structure 断言；金样只锁业务表（B1 的结构不是 parity 对象）
    expectGold(snap.accounts, gold.snap.accounts, 'regular.accounts');
    expectGold(snap.entries, gold.snap.entries, 'regular.entries');
    expectGold(snap.contracts, gold.snap.contracts, 'regular.contracts');
    expectGold(snap.notifications, gold.snap.notifications, 'regular.notifications');
    expectGold(snap.auditLog, gold.snap.auditLog, 'regular.auditLog');
    expectGold(snap.registrations, gold.snap.registrations, 'regular.registrations');
    expectGold(snap.squadAudits, gold.snap.squadAudits, 'regular.squadAudits');
    expectGold(snap.naming, gold.snap.naming, 'regular.naming');
    expectGold(snap.stadiums, gold.snap.stadiums, 'regular.stadiums');
    expectGold(snap.rounds, gold.snap.rounds, 'regular.rounds');
    await expectCompletedAndNoReplay(fx, 1, 1);
  });

  it('② 临时窗 S1W2：不扣工资、不收冠名、无忠诚、无体检存档、无招商轮', async () => {
    const fx = await seedTemp();
    const result = await closeWindow(fx.env, 1, false);
    const snap = takeSnapshot(fx.sqlite);
    const gold = GOLD.temp;
    const stored: Record<string, unknown> = JSON.parse(snap.runs[0]?.summary_json ?? 'null');
    expect(result).toEqual(stored);
    expectB2Structure(snap);
    expectGold(result, gold.summary, 'temp.summary');
    expectGold(snap.windows, gold.snap.windows, 'temp.windows');
    // runs/steps 结构由 expectB2Structure 断言；金样只锁业务表（B1 的结构不是 parity 对象）
    expectGold(snap.accounts, gold.snap.accounts, 'temp.accounts');
    expectGold(snap.entries, gold.snap.entries, 'temp.entries');
    expectGold(snap.contracts, gold.snap.contracts, 'temp.contracts');
    expectGold(snap.notifications, gold.snap.notifications, 'temp.notifications');
    expectGold(snap.auditLog, gold.snap.auditLog, 'temp.auditLog');
    expectGold(snap.registrations, gold.snap.registrations, 'temp.registrations');
    expectGold(snap.squadAudits, gold.snap.squadAudits, 'temp.squadAudits');
    expectGold(snap.naming, gold.snap.naming, 'temp.naming');
    expectGold(snap.stadiums, gold.snap.stadiums, 'temp.stadiums');
    expectGold(snap.rounds, gold.snap.rounds, 'temp.rounds');
    await expectCompletedAndNoReplay(fx, 1, 2);
  });

  it('③ 中期窗 S1W2：忠诚支出+工资+维护，全表逐字', async () => {
    const fx = await seedMid();
    const result = await closeWindow(fx.env, 1, false);
    const snap = takeSnapshot(fx.sqlite);
    const gold = GOLD.mid;
    const stored: Record<string, unknown> = JSON.parse(snap.runs[0]?.summary_json ?? 'null');
    expect(result).toEqual(stored);
    expectB2Structure(snap);
    expectGold(result, gold.summary, 'mid.summary');
    expectGold(snap.windows, gold.snap.windows, 'mid.windows');
    // runs/steps 结构由 expectB2Structure 断言；金样只锁业务表（B1 的结构不是 parity 对象）
    expectGold(snap.accounts, gold.snap.accounts, 'mid.accounts');
    expectGold(snap.entries, gold.snap.entries, 'mid.entries');
    expectGold(snap.contracts, gold.snap.contracts, 'mid.contracts');
    expectGold(snap.notifications, gold.snap.notifications, 'mid.notifications');
    expectGold(snap.auditLog, gold.snap.auditLog, 'mid.auditLog');
    expectGold(snap.registrations, gold.snap.registrations, 'mid.registrations');
    expectGold(snap.squadAudits, gold.snap.squadAudits, 'mid.squadAudits');
    expectGold(snap.naming, gold.snap.naming, 'mid.naming');
    expectGold(snap.stadiums, gold.snap.stadiums, 'mid.stadiums');
    expectGold(snap.rounds, gold.snap.rounds, 'mid.rounds');
    await expectCompletedAndNoReplay(fx, 1, 2);
  });
});
