// v3.4.0 步骤 6：GET /api/clubs/:id 球队详情 + GET /api/clubs/:id/standing 排名代理。
// 覆盖：队头（分级/队徽）、阵容结构（位置/年龄/CA 分档 + 六项均值/合计）、合同结构（保护期/效力分档）、
// 转会往来（转入转出各 10 条）、近期战绩（90 分钟口径 + 弃权判负）、未登录 401 / 不存在 404、
// 没有比赛系统映射时的降级、排名代理的三条降级路径（未配基址零查库 / 非 2xx 不写缓存 / 超时）。
// 另加两条缓存断言：详情按 clubs scope 缓存；排名成功结果也缓存（赛季中天天变，所以走自己的 300s，
// 不吃 clubs scope 的 24h）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { resetGuards } from '../src/lib/guard.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { applyMigrations, createAuthDb, createTestD1 } from './d1.ts';
import { standingTtl } from '../src/worker/routes/clubs.ts';

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  auth: DatabaseSync;
  kv: Map<string, string>;
}

const TOKEN = 'tok-coach';

function freshEnv(): Fixture {
  resetConfigCache();
  resetGuards();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(
    `CREATE TABLE team (id INTEGER PRIMARY KEY, name TEXT NOT NULL, logo_key TEXT);
     CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL, team_id INTEGER NOT NULL, UNIQUE(tournament_id, team_id));
     CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, must_change_pw INTEGER NOT NULL DEFAULT 0);
     INSERT INTO user (id, name, role) VALUES (1, '教练乙', 'coach');`,
  );
  const kv = new Map<string, string>([[`sess:${TOKEN}`, JSON.stringify({ userId: 1 })]]);
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
    // 显式旁路缓存：同 URL 第二次请求若命中 L1 就抓不到 SQL
    PUBLIC_CACHE_TTL_MS: '0',
  };
  const auth = createAuthDb();
  auth.sqlite.exec("INSERT INTO account (id, name, created_at) VALUES (1, '教练乙', '2026-01-01T00:00:00Z')");
  env.AUTH_DB = auth.d1;
  env.AUTH_BIND_SECRET = 'test-bind-secret';
  return { env, sqlite, tour, auth: auth.sqlite, kv };
}

// 赛季 + 定级赛事（101=顶级 / 102=次级）+ 4 个已关常规窗（效力刻度 = 4）+ 1 个已关临时窗（不推进）
function bindSeason(fx: Fixture): void {
  fx.sqlite.exec("INSERT INTO seasons (season, status) VALUES (1, 'running')");
  fx.sqlite.exec(
    `INSERT INTO season_tournaments (season, tournament_id, competition_type) VALUES
       (1, 101, 'league_premier'), (1, 102, 'league_second')`,
  );
  for (let seq = 1; seq <= 4; seq += 1) {
    fx.sqlite
      .prepare("INSERT INTO season_windows (season, window_seq, status, is_temporary, closed_at) VALUES (1, ?, 'closed', 0, ?)")
      .run(seq, `2026-0${seq}-01T00:00:00Z`);
  }
  fx.sqlite.exec("INSERT INTO season_windows (season, window_seq, status, is_temporary) VALUES (1, 9, 'closed', 1)");
}

function addClub(fx: Fixture, id: number, name: string, opts: { isCpu?: boolean; status?: string } = {}): void {
  fx.sqlite
    .prepare('INSERT INTO clubs (id, name, is_cpu, status) VALUES (?, ?, ?, ?)')
    .run(id, name, opts.isCpu ? 1 : 0, opts.status ?? 'active');
}

function linkTeam(fx: Fixture, clubId: number, tourTeamId: number, name: string, logoKey: string | null): void {
  fx.auth
    .prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(tourTeamId, clubId, name, '2026-01-01T00:00:00Z');
  fx.tour.prepare('INSERT INTO team (id, name, logo_key) VALUES (?, ?, ?)').run(tourTeamId, name, logoKey);
}

function enter(fx: Fixture, tournamentId: number, teamId: number): void {
  fx.tour.prepare('INSERT INTO entry (tournament_id, team_id) VALUES (?, ?)').run(tournamentId, teamId);
}

interface PlayerOpts {
  position?: string;
  ca?: number;
  pa?: number;
  age?: number;
  status?: string;
  marketValue?: number | null;
  silver?: number;
  gold?: number;
  wage?: number | null;
  serviceTicks?: number | null;
  protectionTicks?: number | null;
  withContract?: boolean;
}

let nextPlayerId = 1;
function addPlayer(fx: Fixture, clubId: number | null, opts: PlayerOpts = {}): number {
  const id = nextPlayerId++;
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, growable, status, market_value, badges_silver, badges_gold, fc_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      `fc${id}`,
      `球员${id}`,
      clubId,
      opts.position ?? 'CM',
      opts.age ?? 24,
      opts.ca ?? 80,
      opts.pa ?? 85,
      opts.status ?? 'normal',
      opts.marketValue ?? null,
      opts.silver ?? 0,
      opts.gold ?? 0,
      id,
    );
  const withContract = opts.withContract ?? opts.wage !== undefined;
  if (withContract && clubId !== null) {
    fx.sqlite
      .prepare(
        `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, effective_from,
                                service_ticks, protection_ticks, is_active)
         VALUES (?, ?, 50, ?, 'formal', 'import', '2026-07-01', ?, ?, 1)`,
      )
      .run(id, clubId, opts.wage ?? 1, opts.serviceTicks ?? 0, opts.protectionTicks ?? null);
  }
  return id;
}

function addMatch(
  fx: Fixture,
  opts: {
    matchId: number;
    home: number;
    away: number;
    scoreHome?: number | null;
    scoreAway?: number | null;
    penHome?: number | null;
    penAway?: number | null;
    walkover?: string | null;
    finishedAt: string;
  },
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO result_confirmations (season, window_seq, tournament_id, match_id, competition_type, stage_name, round,
                                         home_team, away_team, home_team_id, away_team_id,
                                         score_home, score_away, pen_home, pen_away, walkover_side, finished_at)
       VALUES (1, 1, 101, ?, 'league_premier', '第 1 轮', 1, '主队', '客队', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.matchId,
      opts.home,
      opts.away,
      opts.scoreHome ?? null,
      opts.scoreAway ?? null,
      opts.penHome ?? null,
      opts.penAway ?? null,
      opts.walkover ?? '',
      opts.finishedAt,
    );
}

function addTransfer(
  fx: Fixture,
  opts: { id: number; playerId: number | null; from: number | null; to: number | null; fee: number; status?: string; completedAt: string | null },
): void {
  fx.sqlite
    .prepare(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, extra_fee, status, season, window_seq, completed_at)
       VALUES (?, 'transfer', ?, ?, ?, ?, 1000, ?, 1, 1, ?)`,
    )
    .run(opts.id, opts.playerId, opts.from, opts.to, opts.fee, opts.status ?? 'completed', opts.completedAt);
}

async function get(path: string, env: Env, token: string | null = TOKEN): Promise<Response> {
  return app.request(
    `http://localhost${path}`,
    { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} },
    env,
  );
}

// 记录型 D1 包装：把路由实际执行的 SQL 收下来（用来证明「未配基址时一个库都不查」与缓存命中）
function recorder(env: Env): { env: Env; captured: string[] } {
  const inner = env.DB;
  const captured: string[] = [];
  const DB = {
    prepare(sql: string) {
      captured.push(sql);
      return inner.prepare(sql);
    },
    batch: inner.batch,
  } as unknown as D1Database;
  return { env: { ...env, DB } as Env, captured };
}

interface DetailBody {
  club: { id: number; name: string; isCpu: boolean; tier: string | null; logoKey: string | null };
  squad: {
    size: number;
    senior: number;
    trainee: number;
    avgCa: number | null;
    maxCa: number | null;
    avgPa: number | null;
    avgGrowth: number | null;
    totalValue: number | null;
    totalWage: number;
    avgWage: number | null;
    badgesSilver: number;
    badgesGold: number;
    byPosition: { key: string; label: string; count: number; detail: string }[];
    byAge: { key: string; count: number }[];
    byCa: { key: string; count: number }[];
  };
  contracts: {
    signed: number;
    unprotected: number;
    protectedCount: number;
    avgYears: number | null;
    byYears: { key: string; count: number }[];
  };
  transfers: {
    incoming: { id: number; playerName: string | null; fromClubName: string | null; toClubName: string | null; fee: number | null }[];
    outgoing: { id: number }[];
  };
  form: { recent: { matchId: number; result: string | null }[]; wins: number; draws: number; losses: number };
}

async function getDetail(env: Env, id = 1, token: string | null = TOKEN): Promise<DetailBody> {
  const res = await get(`/api/clubs/${id}`, env, token);
  expect(res.status).toBe(200);
  return (await res.json()) as DetailBody;
}

const countOf = (bands: { key: string; count: number }[], key: string): number =>
  bands.find((b) => b.key === key)?.count ?? -1;

// 标准盘面：阿森纳（club 1 ↔ tour 队 90，顶级联赛），3 名球员（2 一线 + 1 训练营）
function seededClub(fx: Fixture): void {
  bindSeason(fx);
  addClub(fx, 1, '阿森纳');
  linkTeam(fx, 1, 90, '阿森纳', 'team/90/1.png');
  enter(fx, 101, 90);
  addPlayer(fx, 1, { position: 'CM', ca: 80, pa: 85, age: 22, marketValue: 1_000_000, silver: 2, wage: 1.5, serviceTicks: 0, protectionTicks: 3 });
  addPlayer(fx, 1, { position: 'ST', ca: 90, pa: 90, age: 31, marketValue: 2_000_000, silver: 1, gold: 1, wage: 3, serviceTicks: 2, protectionTicks: 5 });
  // 训练营：无合同（4.3.4 无保护期），pa > ca 所以进成长空间平均
  addPlayer(fx, 1, { position: 'CM', ca: 60, pa: 75, age: 17, status: 'trainee', marketValue: null, withContract: false });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/clubs/:id 球队详情（v3.4.0 步骤 6）', () => {
  it('队头 + 阵容结构（位置/年龄/CA 分档与六项均值）+ 合同结构（保护期/效力分档）', async () => {
    const fx = freshEnv();
    seededClub(fx);

    const body = await getDetail(fx.env);

    expect(body.club).toEqual({ id: 1, name: '阿森纳', isCpu: false, tier: 'premier', logoKey: 'team/90/1.png' });

    // 阵容人数口径与列表页一致（trainee 从总人数里拆出来，不重复计入 senior）
    expect(body.squad.size).toBe(3);
    expect(body.squad.senior).toBe(2);
    expect(body.squad.trainee).toBe(1);
    expect(body.squad.avgCa).toBe(76.7); // (80+90+60)/3
    expect(body.squad.maxCa).toBe(90);
    expect(body.squad.avgPa).toBe(83.3); // (85+90+75)/3
    // 成长空间只算 pa > ca 的人：p1(85-80=5) + p3(75-60=15) ⇒ 10；p2 已到顶不进平均
    expect(body.squad.avgGrowth).toBe(10);
    expect(body.squad.totalValue).toBe(3_000_000);
    expect(body.squad.totalWage).toBe(4.5); // 1.5 + 3，训练营没有合同
    expect(body.squad.avgWage).toBe(2.3); // 4.5 / 2
    expect(body.squad.badgesSilver).toBe(3);
    expect(body.squad.badgesGold).toBe(1);

    // 位置出四档（门将/后卫/中场/前锋），0 人档也出——「0 门将」本身就是要看见的信号；
    // 档内细位按 POSITION_BY_ID 顺序给非零项
    expect(body.squad.byPosition).toEqual([
      { key: 'GK', label: '门将', count: 0, detail: '' },
      { key: 'DF', label: '后卫', count: 0, detail: '' },
      { key: 'MF', label: '中场', count: 2, detail: 'CM 2' },
      { key: 'FW', label: '前锋', count: 1, detail: 'ST 1' },
    ]);
    // 年龄六等宽箱（≤18 / 19–21 / 22–24 / 25–27 / 28–30 / ≥31）：17 / 22 / 31
    expect(body.squad.byAge.map((b) => b.key)).toEqual(['u18', '19-21', '22-24', '25-27', '28-30', '31+']);
    expect(body.squad.byAge.map((b) => b.count)).toEqual([1, 0, 1, 0, 0, 1]);
    // CA 五档由高到低（90+ / 85–89 / 80–84 / 70–79 / <70）：90 / 80 / 60
    expect(body.squad.byCa.map((b) => b.key)).toEqual(['90+', '85-89', '80-84', '70-79', 'u70']);
    expect(body.squad.byCa.map((b) => b.count)).toEqual([1, 0, 1, 0, 1]);

    // 效力刻度 = 4 个已关常规窗（临时窗不推进）
    expect(body.contracts.signed).toBe(2);
    expect(body.contracts.protectedCount).toBe(1); // protection_ticks 5 > 4
    expect(body.contracts.unprotected).toBe(1); // protection_ticks 3 ≤ 4
    expect(body.contracts.avgYears).toBe(1.5); // (4-0)*0.5=2 与 (4-2)*0.5=1
    expect(countOf(body.contracts.byYears, '1-15')).toBe(1); // 1 赛季
    expect(countOf(body.contracts.byYears, '2-25')).toBe(1); // 2 赛季
    expect(countOf(body.contracts.byYears, 'le05')).toBe(0);
  });

  it('全队都没录身价时 totalValue 是 null 而不是 0（生产 18,301 行 market_value 全 NULL）', async () => {
    const fx = freshEnv();
    seededClub(fx);

    // 与 seededClub 同样的两名一线球员，只是 market_value 全为空（生产现状）
    const plain = freshEnv();
    bindSeason(plain);
    addClub(plain, 1, '阿森纳');
    linkTeam(plain, 1, 90, '阿森纳', 'team/90/1.png');
    enter(plain, 101, 90);
    addPlayer(plain, 1, { position: 'CM', ca: 80, pa: 85, age: 22, wage: 1.5, serviceTicks: 0, protectionTicks: 3 });
    addPlayer(plain, 1, { position: 'ST', ca: 90, pa: 90, age: 31, wage: 3, serviceTicks: 2, protectionTicks: 5 });

    const body = await getDetail(plain.env);

    expect(body.squad.size).toBe(2);
    expect(body.squad.totalValue).toBeNull();
    expect(body.squad.totalWage).toBe(4.5); // 工资照常算得出来
    // 只要有人录过身价就照常求和（拿 seededClub 的 100 万 + 200 万做对照）
    const withValue = await getDetail(fx.env);
    expect(withValue.squad.totalValue).toBe(3_000_000);
  });

  it('近期战绩：90 分钟口径（点球不改判定）、弃权判负（含双弃权）、只取最近 5 场', async () => {
    const fx = freshEnv();
    seededClub(fx);
    // 第 6 场（更早）不该出现：证明 LIMIT 5 生效
    addMatch(fx, { matchId: 1, home: 90, away: 91, scoreHome: 5, scoreAway: 0, finishedAt: '2026-08-01T00:00:00Z' });
    addMatch(fx, { matchId: 2, home: 90, away: 91, scoreHome: 2, scoreAway: 1, finishedAt: '2026-09-01T00:00:00Z' }); // 胜
    addMatch(fx, { matchId: 3, home: 91, away: 90, scoreHome: 1, scoreAway: 1, finishedAt: '2026-09-08T00:00:00Z' }); // 平
    addMatch(fx, { matchId: 4, home: 90, away: 91, scoreHome: 1, scoreAway: 1, penHome: 3, penAway: 4, finishedAt: '2026-09-15T00:00:00Z' }); // 点球负 = 平
    addMatch(fx, { matchId: 5, home: 90, away: 91, walkover: 'home', finishedAt: '2026-09-20T00:00:00Z' }); // 我方弃权 = 负
    addMatch(fx, { matchId: 6, home: 90, away: 91, scoreHome: 0, scoreAway: 0, walkover: 'both', finishedAt: '2026-09-22T00:00:00Z' }); // 双弃权 = 负
    // 别的队的比赛不进战绩
    addMatch(fx, { matchId: 7, home: 91, away: 92, scoreHome: 3, scoreAway: 0, finishedAt: '2026-09-23T00:00:00Z' });

    const body = await getDetail(fx.env);

    expect(body.form.recent.map((r) => r.matchId)).toEqual([6, 5, 4, 3, 2]);
    expect(body.form.recent.map((r) => r.result)).toEqual(['loss', 'loss', 'draw', 'draw', 'win']);
    expect(body.form.wins).toBe(1);
    expect(body.form.draws).toBe(2);
    expect(body.form.losses).toBe(2);
  });

  it('转会往来：按完成时间倒序、只算已完成的、带球员名与两端队名', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    addClub(fx, 1, '阿森纳');
    addClub(fx, 3, '买方队');
    linkTeam(fx, 1, 90, '阿森纳', null);
    enter(fx, 101, 90);
    const p1 = addPlayer(fx, 1, { ca: 80, pa: 85, wage: 1.5 });
    const p2 = addPlayer(fx, 1, { ca: 90, pa: 90, wage: 3 });
    const p3 = addPlayer(fx, 3, { ca: 70, pa: 70, wage: 2 });
    addTransfer(fx, { id: 1, playerId: p1, from: 3, to: 1, fee: 1_000_000, completedAt: '2026-08-15T00:00:00Z' });
    addTransfer(fx, { id: 2, playerId: p2, from: null, to: 1, fee: 0, completedAt: '2026-08-20T00:00:00Z' }); // 自由身加盟
    addTransfer(fx, { id: 3, playerId: p3, from: 1, to: 3, fee: 500_000, completedAt: '2026-08-25T00:00:00Z' }); // 转出
    addTransfer(fx, { id: 4, playerId: p1, from: 1, to: 3, fee: 9, status: 'pending_review', completedAt: '2026-08-30T00:00:00Z' });

    const body = await getDetail(fx.env);

    expect(body.transfers.incoming.map((t) => t.id)).toEqual([2, 1]);
    expect(body.transfers.outgoing.map((t) => t.id)).toEqual([3]);
    expect(body.transfers.incoming[1].playerName).toBe(`球员${p1}`);
    expect(body.transfers.incoming[1].fromClubName).toBe('买方队');
    expect(body.transfers.incoming[1].toClubName).toBe('阿森纳');
    expect(body.transfers.incoming[1].fee).toBe(1_000_000);
    expect(body.transfers.incoming[0].fromClubName).toBeNull(); // 自由身没有来源俱乐部
  });

  it('没有转会记录时两块都是空数组（生产 transfers 表当前就是空的，前端要能出空态）', async () => {
    const fx = freshEnv();
    seededClub(fx);

    const body = await getDetail(fx.env);

    expect(body.transfers.incoming).toEqual([]);
    expect(body.transfers.outgoing).toEqual([]);
  });

  it('未登录 401；球队不存在 404；已退役的球队 404', async () => {
    const fx = freshEnv();
    seededClub(fx);
    addClub(fx, 2, '退役队', { status: 'retired' });

    const anon = await get('/api/clubs/1', fx.env, null);
    expect(anon.status).toBe(401);

    const missing = await get('/api/clubs/999', fx.env);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe('球队不存在');

    const retired = await get('/api/clubs/2', fx.env);
    expect(retired.status).toBe(404);

    const bad = await get('/api/clubs/abc', fx.env);
    expect(bad.status).toBe(400);
  });

  it('没有比赛系统映射的球队：分级/队徽为空、战绩为空，阵容与合同照常出', async () => {
    const fx = freshEnv();
    bindSeason(fx);
    addClub(fx, 7, '无映射队');
    addPlayer(fx, 7, { ca: 70, pa: 70, age: 25, wage: 2, serviceTicks: 0, protectionTicks: 0 });

    const body = await getDetail(fx.env, 7);

    expect(body.club).toEqual({ id: 7, name: '无映射队', isCpu: false, tier: null, logoKey: null });
    expect(body.squad.size).toBe(1);
    expect(body.squad.avgCa).toBe(70);
    expect(body.form.recent).toEqual([]);
    expect(body.form.wins + body.form.draws + body.form.losses).toBe(0);
  });

  it('详情按 clubs scope 缓存：TTL 配了以后第二次请求不再查库', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.PUBLIC_CACHE_TTL_MS = '600000';
    const { env, captured } = recorder(fx.env);

    await getDetail(env);
    const first = captured.length;
    expect(first).toBeGreaterThan(0);

    captured.length = 0;
    await getDetail(env);
    expect(captured, '第二次请求应命中 L1 缓存').toHaveLength(0);
  });
});

interface StandingBody {
  standing: {
    tournamentId: number;
    stageName: string | null;
    groupName: string | null;
    position: number;
    played: number | null;
    pts: number | null;
  } | null;
  note: string | null;
}

// 比赛系统积分榜真实形状：standings[].groups[].rows[]，行里**没有 team id**（只有 teamName），
// rank 字段恒为 0（排序链在比赛系统里跑完，名次只能按行序取下标）。
function standingsPayload(names: string[]): unknown {
  return {
    standings: [
      {
        stageId: 1,
        kind: 'group',
        name: '小组赛',
        sortOrder: 1,
        groups: [
          {
            groupId: 11,
            name: 'A 组',
            rows: names.map((teamName, i) => ({
              entryId: 100 + i,
              teamName,
              teamLogoUrl: null,
              seed: i + 1,
              played: 10,
              won: 10 - i,
              drawn: 0,
              lost: i,
              goalsFor: 30 - i,
              goalsAgainst: 5 + i,
              penWon: 0,
              penLost: 0,
              pts: 30 - i * 3,
              pointsDeducted: 0,
              rank: 0,
            })),
          },
        ],
      },
    ],
    rankZones: [],
  };
}

describe('GET /api/clubs/:id/standing 排名代理（v3.4.0 步骤 6）', () => {
  it('未配 TOUR_API_BASE：一个库都不查，直接降级', async () => {
    const fx = freshEnv();
    seededClub(fx);
    const { env, captured } = recorder(fx.env);

    const res = await get('/api/clubs/1/standing', env);

    expect(res.status).toBe(200);
    expect((await res.json()) as StandingBody).toEqual({ standing: null, note: '排名暂不可用' });
    expect(captured, '未配基址时不该读平台库').toHaveLength(0);
  });

  it('代理比赛系统积分榜：按比赛系统队名认队，名次取行下标（rank 字段是 0）', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.TOUR_API_BASE = 'https://tour.test';
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(standingsPayload(['别的队', '阿森纳', '第三个队'])), { status: 200 });
    });

    const res = await get('/api/clubs/1/standing', fx.env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as StandingBody;
    // 平台 clubs.name 与比赛系统 team.name 同名，但认队走的是 TOUR_DB team.name
    expect(seen).toEqual(['https://tour.test/api/public/tournaments/101/standings']);
    expect(body.standing).toEqual({
      tournamentId: 101,
      stageName: '小组赛',
      groupName: 'A 组',
      position: 2,
      played: 10,
      won: 9,
      drawn: 0,
      lost: 1,
      goalsFor: 29,
      goalsAgainst: 6,
      pts: 27,
      pointsDeducted: 0,
    });
    expect(body.note).toBeNull();
  });

  it('平台改名不影响认队：按比赛系统 team.name 匹配', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.sqlite.exec("UPDATE clubs SET name = '阿森纳（平台改名）' WHERE id = 1");
    fx.env.TOUR_API_BASE = 'https://tour.test';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(standingsPayload(['阿森纳'])), { status: 200 }));

    const body = (await (await get('/api/clubs/1/standing', fx.env)).json()) as StandingBody;

    expect(body.standing?.position).toBe(1);
  });

  it('积分榜里没有这支球队 / 没有定级赛事：降级为「本赛季暂无联赛排名」', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.TOUR_API_BASE = 'https://tour.test';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(standingsPayload(['别的队'])), { status: 200 }));

    const noTeam = (await (await get('/api/clubs/1/standing', fx.env)).json()) as StandingBody;
    expect(noTeam).toEqual({ standing: null, note: '本赛季暂无联赛排名' });

    // 没有报名定级赛事的球队：不该打比赛系统
    addClub(fx, 2, '未报名队');
    linkTeam(fx, 2, 91, '未报名队', null);
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(standingsPayload(['未报名队'])), { status: 200 });
    });
    const notEntered = (await (await get('/api/clubs/2/standing', fx.env)).json()) as StandingBody;
    expect(notEntered).toEqual({ standing: null, note: '本赛季暂无联赛排名' });
    expect(seen).toHaveLength(0);
  });

  it('非 2xx / 网络错 / 超时都降级成「排名暂不可用」，且失败不写缓存（下次会再试）', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.TOUR_API_BASE = 'https://tour.test';
    fx.env.PUBLIC_CACHE_TTL_MS = '600000'; // 缓存开着：若失败被缓存，第二次就不会再打比赛系统
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return new Response('boom', { status: 502 });
    });
    expect((await (await get('/api/clubs/1/standing', fx.env)).json()) as StandingBody).toEqual({
      standing: null,
      note: '排名暂不可用',
    });
    expect((await (await get('/api/clubs/1/standing', fx.env)).json()) as StandingBody).toEqual({
      standing: null,
      note: '排名暂不可用',
    });
    expect(calls, '失败结果不该进缓存').toBe(2);

    // 网络错 / 超时同样是降级而不是 500
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    const res = await get('/api/clubs/1/standing', fx.env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as StandingBody).note).toBe('排名暂不可用');
  });

  it('成功结果会被缓存，第二次请求不再打比赛系统', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.TOUR_API_BASE = 'https://tour.test';
    fx.env.PUBLIC_CACHE_TTL_MS = '600000';
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return new Response(JSON.stringify(standingsPayload(['阿森纳'])), { status: 200 });
    });

    await get('/api/clubs/1/standing', fx.env);
    await get('/api/clubs/1/standing', fx.env);

    expect(calls).toBe(1);
  });

  // 上面那条集成用例钉不住 TTL 本身：它设了 PUBLIC_CACHE_TTL_MS，于是 standingTtl 走的是覆盖分支，
  // 把生产分支（不配该 var ⇒ 300s，不吃 clubs scope 的 24h）改坏了照样绿。TTL 从响应里也观察不到
  // （第二次请求两种情况都不打上游），所以直接对 standingTtl 断言。
  it('standingTtl：生产不配覆盖变量时是 300s，配了就照覆盖值（含 0=旁路）', () => {
    const bare = { PUBLIC_CACHE_TTL_MS: undefined } as unknown as Env;
    expect(standingTtl(bare)).toBe(300_000);
    expect(standingTtl({ PUBLIC_CACHE_TTL_MS: '0' } as unknown as Env)).toBe(0);
    expect(standingTtl({ PUBLIC_CACHE_TTL_MS: '600000' } as unknown as Env)).toBe(600_000);
  });

  it('积分榜响应过大时降级，不落缓存（外部输入不该吃满内存）', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.TOUR_API_BASE = 'https://tour.test';
    fx.env.PUBLIC_CACHE_TTL_MS = '600000';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
      return new Response(JSON.stringify({ standings: [], pad: huge }), { status: 200 });
    });

    const body = (await (await get('/api/clubs/1/standing', fx.env)).json()) as StandingBody;
    expect(body).toEqual({ standing: null, note: '排名暂不可用' });
    await get('/api/clubs/1/standing', fx.env);
    expect(calls, '过大响应不该进缓存').toBe(2);
  });

  it('未登录 401', async () => {
    const fx = freshEnv();
    seededClub(fx);
    fx.env.TOUR_API_BASE = 'https://tour.test';

    const res = await get('/api/clubs/1/standing', fx.env, null);

    expect(res.status).toBe(401);
  });
});
