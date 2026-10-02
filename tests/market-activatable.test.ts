// 激活名单测试（v6.18.0）：GET /api/market/activatable —— 默认两 mode 的行集、?mode=trainee、
// 本队排除、未绑定空态、q 搜索、CA 排序与 limit 钳制、激活费两口径、justSigned、
// activatedThisWindow、行内字段与边界。用例名与 docs/test-plans/v6.18.0-market-ia.md 的
// TC-ACT-01..10 一一对应。
//
// fixture 自建：甲队 101（教练 tok-coach=user2 绑定）/ 乙队 102 / AC米兰(CPU) 131681；
// 两个已关常规窗 + S4W1 开窗 ⇒ currentTicks=2（保护期倍数与 justSigned 的基准），
// 需要其它刻度时在用例内再补关窗。激活名单只认「他队 + 生效合同 + 状态在 mode 内」三条过滤，
// 因此夹具里每个边界球员都配一份合同，确保被排除的原因唯一。
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { applyMigrations, createTestD1 } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { resetGuards } from '../src/lib/guard.ts';

const CLUB_A = 101; // 甲队：tok-coach 绑定队（本队球员一律不出现在名单里）
const CLUB_B = 102; // 乙队：默认的「他队」
const CPU_CLUB = 131681; // AC米兰(CPU)

// 限流桶 / L1 缓存 / 代际键记忆逐用例清零（同一个 test 文件共享模块状态）
beforeEach(() => {
  resetGuards();
});

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  tour: DatabaseSync;
  kv: Map<string, string>;
}

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
       (3, '教练丙', 'coach', 0, 0),
       (9, '观众', 'user', 0, 0);`,
  );
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
    [9, 'tok-viewer'],
  ] as const) {
    kv.set(`sess:${token}`, JSON.stringify({ userId: uid }));
  }
  return { env, sqlite, tour, kv };
}

function get(path: string, token: string | undefined, env: Env) {
  return app.request(path, { method: 'GET', headers: token ? { Cookie: `whl_session=${token}` } : {} }, env);
}

interface PlayerSeed {
  id: number;
  name: string;
  clubId?: number | null;
  status?: string;
  ca?: number | null;
  position?: string;
  age?: number;
  displayName?: string;
}

function addPlayer(fx: Fixture, p: PlayerSeed): number {
  fx.sqlite
    .prepare(
      `INSERT INTO players (id, uid, name, display_name, club_id, position, age, ca, pa, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id,
      `fc${p.id}`,
      p.name,
      p.displayName ?? null,
      p.clubId ?? null,
      p.position ?? 'ST',
      p.age ?? 26,
      p.ca ?? 70,
      p.ca ?? 70,
      p.status ?? 'normal',
    );
  return p.id;
}

interface ContractSeed {
  playerId: number;
  clubId?: number;
  releaseFee?: number | null;
  contractType?: string;
  protectionTicks?: number | null;
  serviceTicks?: number;
  isActive?: number;
}

/** contracts.player_id 是 UNIQUE：一球员一份现行合同，is_active=0 也算「有合同但不生效」 */
function addContract(fx: Fixture, c: ContractSeed): void {
  fx.sqlite
    .prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, contract_type, protection_ticks, service_ticks, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.playerId,
      c.clubId ?? CLUB_B,
      c.releaseFee ?? null,
      c.contractType ?? 'formal',
      c.protectionTicks ?? null,
      c.serviceTicks ?? 0,
      c.isActive ?? 1,
    );
}

interface ListingSeed {
  playerId: number;
  type?: string;
  status?: string;
  season?: number;
  windowSeq?: number;
}

function addListing(fx: Fixture, l: ListingSeed): void {
  fx.sqlite
    .prepare(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, season, window_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      l.playerId,
      CLUB_B,
      l.type ?? 'normal',
      10,
      l.status ?? 'listed',
      l.season ?? 4,
      l.windowSeq ?? 1,
    );
}

/**
 * 基准夹具：甲队（tok-coach 绑定）+ 乙队 + CPU 队；已关窗 (3,1)/(3,2) ⇒ currentTicks=2；
 * S4W1 开窗（activatedThisWindow 的比对窗）。
 */
function seedActivatable(): Fixture {
  const fx = freshEnv();
  fx.sqlite.exec(
    `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES
       (${CLUB_A}, '甲队', 'premier', 'active', 0),
       (${CLUB_B}, '乙队', 'premier', 'active', 0),
       (${CPU_CLUB}, 'AC米兰(CPU)', 'premier', 'active', 1);
     INSERT INTO club_bindings (club_id, user_id, bound_at) VALUES (${CLUB_A}, 2, '2026-01-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (3, 'settled'), (4, 'running');
     INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at) VALUES
       (3, 1, 'closed', 0, '2026-01-05T00:00:00Z', '2026-02-05T00:00:00Z'),
       (3, 2, 'closed', 0, '2026-03-05T00:00:00Z', '2026-04-05T00:00:00Z'),
       (4, 1, 'open', 0, '2026-07-01T00:00:00Z', NULL);`,
  );
  return fx;
}

function closeOpenWindow(fx: Fixture): void {
  fx.sqlite.exec(
    `UPDATE season_windows SET status = 'closed', closed_at = '2026-07-08T00:00:00Z' WHERE season = 4 AND window_seq = 1`,
  );
}

interface ActivatableRow {
  id: number;
  fcId: number | null;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  status: string;
  club: { id: number; name: string };
  contractType: string;
  activationFee: number;
  activatedThisWindow: boolean;
  justSigned: boolean;
}

interface ActivatableBody {
  club: { id: number; name: string } | null;
  players: ActivatableRow[];
}

async function activatable(
  fx: Fixture,
  token: string | undefined = 'tok-coach',
  query = '',
): Promise<ActivatableBody> {
  const res = await get(`/api/market/activatable${query}`, token, fx.env);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ActivatableBody;
}

/** 夹具里的「标准他队正式球员」：乙队 + 生效合同 + release_fee 10（保护期内 ⇒ 20m） */
function seedFormalPlayer(fx: Fixture, id: number, name: string, ca: number): void {
  addPlayer(fx, { id, name, clubId: CLUB_B, ca });
  addContract(fx, { playerId: id, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
}

describe('TC-ACT 激活名单（GET /api/market/activatable）', () => {
  it('TC-ACT-01 默认两个 mode 的行集', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 20, '正式甲', 80);
    addPlayer(fx, { id: 21, name: '青训乙', clubId: CLUB_B, status: 'trainee', ca: 70 });
    addContract(fx, { playerId: 21, clubId: CLUB_B, releaseFee: 5, contractType: 'trainee' });

    const body = await activatable(fx);
    expect(body.club).toEqual({ id: CLUB_A, name: '甲队' });
    // 默认 mode 覆盖 normal + trainee，按 CA 降序
    expect(body.players.map((r) => r.id)).toEqual([20, 21]);
    expect(body.players.map((r) => r.status)).toEqual(['normal', 'trainee']);
    expect(body.players.map((r) => r.contractType)).toEqual(['formal', 'trainee']);
    for (const r of body.players) expect(r.club).toEqual({ id: CLUB_B, name: '乙队' });
  });

  it('TC-ACT-02 ?mode=trainee 只出青训', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 20, '正式甲', 80);
    addPlayer(fx, { id: 21, name: '青训乙', clubId: CLUB_B, status: 'trainee', ca: 70 });
    addContract(fx, { playerId: 21, clubId: CLUB_B, releaseFee: 5, contractType: 'trainee' });
    // 青训身份但没有合同：两 mode 都不该出现（合同是硬前置）
    addPlayer(fx, { id: 22, name: '青训无合同', clubId: CLUB_B, status: 'trainee', ca: 90 });

    const all = await activatable(fx);
    expect(all.players.map((r) => r.id)).toEqual([20, 21]);

    const trainees = await activatable(fx, 'tok-coach', '?mode=trainee');
    expect(trainees.players.map((r) => r.id)).toEqual([21]);
    expect(trainees.players[0].status).toBe('trainee');
    expect(trainees.players[0].contractType).toBe('trainee');
    // 同一个 club 头，只有行集收窄
    expect(trainees.club).toEqual(all.club);
  });

  it('TC-ACT-03 本队球员不出现', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 20, '他队甲', 80);
    // 本队球员：除了所属队，其它条件（状态、合同）都满足
    addPlayer(fx, { id: 30, name: '本队乙', clubId: CLUB_A, ca: 99 });
    addContract(fx, { playerId: 30, clubId: CLUB_A, releaseFee: 10, protectionTicks: 5 });

    const body = await activatable(fx);
    expect(body.players.map((r) => r.id)).toEqual([20]);

    // 排除原因只能是 club_id 过滤：该球员确实在库、状态 normal、合同生效
    const row = fx.sqlite
      .prepare(
        `SELECT p.club_id AS clubId, p.status AS status, c.is_active AS isActive
           FROM players p JOIN contracts c ON c.player_id = p.id WHERE p.id = 30`,
      )
      .get() as { clubId: number; status: string; isActive: number };
    expect(row).toEqual({ clubId: CLUB_A, status: 'normal', isActive: 1 });

    // 换一名未绑定教练：连 club 头都没有，整份名单为空
    expect((await activatable(fx, 'tok-coach2')).players).toEqual([]);
  });

  it('TC-ACT-04 未绑定教练空态逐字', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 20, '他队甲', 80);

    const res = await get('/api/market/activatable', 'tok-coach2', fx.env);
    expect(res.status).toBe(200);
    // 逐字：club 为 null、players 空数组，键序固定（前端按此分支渲染空态）
    expect(await res.text()).toBe('{"club":null,"players":[]}');

    // 同一夹具下绑定教练看得到人 ⇒ 空态来自「未绑定」，不是「没人可激活」
    const bound = await activatable(fx);
    expect(bound.players.map((r) => r.id)).toEqual([20]);

    // 端点仅教练可读：匿名 401、观众 403（admin 过角色关，但没绑定队 ⇒ 同样是空态）
    const anon = await get('/api/market/activatable', undefined, fx.env);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: '未登录' });
    const viewer = await get('/api/market/activatable', 'tok-viewer', fx.env);
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ error: '没有权限进行此操作' });
    expect((await activatable(fx, 'tok-admin')).club).toBeNull();
  });

  it('TC-ACT-05 q 搜索', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 40, '风之子', 70);
    addPlayer(fx, { id: 41, name: '尘', displayName: '风尘', clubId: CLUB_B, ca: 60 });
    addContract(fx, { playerId: 41, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
    seedFormalPlayer(fx, 42, '雨人', 50);
    // 本队同名球员：q 也必须叠在本队排除之上
    addPlayer(fx, { id: 43, name: '风队内', clubId: CLUB_A, ca: 99 });
    addContract(fx, { playerId: 43, clubId: CLUB_A, releaseFee: 10, protectionTicks: 5 });

    const hit = await activatable(fx, 'tok-coach', '?q=风');
    expect(hit.players.map((r) => r.id)).toEqual([40, 41]);
    // display_name 命中：行内 name 取 display_name 优先
    expect(hit.players.map((r) => r.name)).toEqual(['风之子', '风尘']);

    // 前后空白被 trim，两次结果逐字相同
    const padded = await activatable(fx, 'tok-coach', `?q=${encodeURIComponent('  风  ')}`);
    expect(JSON.stringify(padded)).toBe(JSON.stringify(hit));

    expect((await activatable(fx, 'tok-coach', '?q=雨')).players.map((r) => r.id)).toEqual([42]);
    expect((await activatable(fx, 'tok-coach', '?q=没有这个人')).players).toEqual([]);
  });

  it('TC-ACT-06 CA 排序与 limit 钳制', async () => {
    const fx = seedActivatable();
    // 105 名合格球员：两名并列最高 CA=112（id 2000 < 2001），其余 CA 111..9 各自唯一
    for (let j = 0; j < 105; j += 1) {
      const ca = j < 2 ? 112 : 111 - (j - 2);
      addPlayer(fx, { id: 2000 + j, name: `名单${j}`, clubId: CLUB_B, ca });
      addContract(fx, { playerId: 2000 + j, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
    }

    const two = await activatable(fx, 'tok-coach', '?limit=2');
    expect(two.players.map((r) => r.id)).toEqual([2000, 2001]);
    expect(two.players.map((r) => r.ca)).toEqual([112, 112]);

    // 钳制：<=0 → 1；非整数/超上限/缺省 → 100
    expect((await activatable(fx, 'tok-coach', '?limit=0')).players).toHaveLength(1);
    expect((await activatable(fx, 'tok-coach', '?limit=-5')).players).toHaveLength(1);
    expect((await activatable(fx, 'tok-coach', '?limit=abc')).players).toHaveLength(100);
    expect((await activatable(fx, 'tok-coach', '?limit=2.5')).players).toHaveLength(100);
    expect((await activatable(fx, 'tok-coach', '?limit=101')).players).toHaveLength(100);
    expect((await activatable(fx)).players).toHaveLength(100);

    // 页首 100 名就是 CA 降序的前 100 名（并列两名按 id 升序）
    const page = await activatable(fx, 'tok-coach', '?limit=100');
    expect(page.players.map((r) => r.id)).toEqual(Array.from({ length: 100 }, (_, i) => 2000 + i));
  });

  it('TC-ACT-07 激活费两口径（青训固定 / 正式按保护期）', async () => {
    const fx = seedActivatable(); // currentTicks = 2
    // 保护期内（protection_ticks=5 > 2）：RC<=20 → ×2，>20 → ×1.5
    addPlayer(fx, { id: 50, name: '低价保护', clubId: CLUB_B, ca: 80 });
    addContract(fx, { playerId: 50, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
    addPlayer(fx, { id: 51, name: '高价保护', clubId: CLUB_B, ca: 79 });
    addContract(fx, { playerId: 51, clubId: CLUB_B, releaseFee: 30, protectionTicks: 5 });
    // 保护期外（protection_ticks=1 <= 2）：固定 1 倍
    addPlayer(fx, { id: 52, name: '保护期外', clubId: CLUB_B, ca: 78 });
    addContract(fx, { playerId: 52, clubId: CLUB_B, releaseFee: 30, protectionTicks: 1 });
    // 训练营：固定 5m，RC 多高都不看
    addPlayer(fx, { id: 53, name: '青训贵货', clubId: CLUB_B, status: 'trainee', ca: 77 });
    addContract(fx, { playerId: 53, clubId: CLUB_B, releaseFee: 99, contractType: 'trainee' });

    const rows = (await activatable(fx)).players;
    expect(rows.map((r) => [r.id, r.activationFee])).toEqual([
      [50, 20],
      [51, 45],
      [52, 30],
      [53, 5],
    ]);
  });

  it('TC-ACT-08 justSigned', async () => {
    const fx = seedActivatable(); // currentTicks = 2
    // 同队同 CA：两行一定同页（默认 limit=100），比较的是同一页内的口径
    addPlayer(fx, { id: 60, name: '刚签约', clubId: CLUB_B, ca: 80 });
    addContract(fx, { playerId: 60, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5, serviceTicks: 2 });
    addPlayer(fx, { id: 61, name: '老合同', clubId: CLUB_B, ca: 80 });
    addContract(fx, { playerId: 61, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5, serviceTicks: 0 });

    const rows = (await activatable(fx)).players;
    expect(rows.map((r) => [r.id, r.justSigned])).toEqual([
      [60, true], // service_ticks=2 = currentTicks ⇒ 刚签（≤ 而非 <）
      [61, false],
    ]);

    // 再关一窗 ⇒ currentTicks=3，同一份合同不再算「刚签」
    fx.sqlite.exec(
      `INSERT INTO season_windows (season, window_seq, status, is_temporary, opened_at, closed_at)
       VALUES (4, 2, 'closed', 0, '2026-07-09T00:00:00Z', '2026-08-09T00:00:00Z')`,
    );
    const later = (await activatable(fx)).players;
    expect(later.map((r) => [r.id, r.justSigned])).toEqual([
      [60, false],
      [61, false],
    ]);
  });

  it('TC-ACT-09 activatedThisWindow（本窗已激活标记）', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 70, '本窗已激活', 80);
    seedFormalPlayer(fx, 71, '他窗激活', 79);
    seedFormalPlayer(fx, 72, '没激活过', 78);
    // 标记只看 type/season/window_seq，不看挂牌状态（失效激活也占额）
    addListing(fx, { playerId: 70, type: 'activation', status: 'matched_pending', season: 4, windowSeq: 1 });
    addListing(fx, { playerId: 71, type: 'activation', status: 'listed', season: 4, windowSeq: 2 });
    // 同窗但普通挂牌：不算激活
    addListing(fx, { playerId: 72, type: 'normal', status: 'listed', season: 4, windowSeq: 1 });

    const rows = (await activatable(fx)).players;
    expect(rows.map((r) => [r.id, r.activatedThisWindow])).toEqual([
      [70, true],
      [71, false],
      [72, false],
    ]);

    // 关窗后没有「本窗」可比 ⇒ 全员 false
    closeOpenWindow(fx);
    const closed = (await activatable(fx)).players;
    expect(closed.map((r) => r.activatedThisWindow)).toEqual([false, false, false]);
  });

  it('TC-ACT-10 行内字段与 page 边界（无合同 / 无归属 / 状态不符者不出现）', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 80, '合格甲', 80);
    // 边界：无合同 / 无归属 / is_active=0 / retired / listed / free —— 各配一份能配的合同
    addPlayer(fx, { id: 81, name: '无合同', clubId: CLUB_B, ca: 79 });
    addPlayer(fx, { id: 82, name: '无归属', clubId: null, ca: 78 });
    addContract(fx, { playerId: 82, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
    addPlayer(fx, { id: 83, name: '合同停用', clubId: CLUB_B, ca: 77 });
    addContract(fx, { playerId: 83, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5, isActive: 0 });
    addPlayer(fx, { id: 84, name: '已退役', clubId: CLUB_B, status: 'retired', ca: 76 });
    addContract(fx, { playerId: 84, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
    addPlayer(fx, { id: 85, name: '在售中', clubId: CLUB_B, status: 'listed', ca: 75 });
    addContract(fx, { playerId: 85, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });
    addPlayer(fx, { id: 86, name: '自由身', clubId: CLUB_B, status: 'free', ca: 74 });
    addContract(fx, { playerId: 86, clubId: CLUB_B, releaseFee: 10, protectionTicks: 5 });

    const body = await activatable(fx);
    expect(body.players.map((r) => r.id)).toEqual([80]);

    // 行内键序即契约：13 个键，club 是球员所属队（不是请求方球队）
    const row = body.players[0];
    expect(Object.keys(row)).toEqual([
      'id',
      'fcId',
      'name',
      'position',
      'age',
      'ca',
      'pa',
      'status',
      'club',
      'contractType',
      'activationFee',
      'activatedThisWindow',
      'justSigned',
    ]);
    expect(row).toEqual({
      id: 80,
      fcId: null,
      name: '合格甲',
      position: 'ST',
      age: 26,
      ca: 80,
      pa: 80,
      status: 'normal',
      club: { id: CLUB_B, name: '乙队' },
      contractType: 'formal',
      activationFee: 20,
      activatedThisWindow: false,
      justSigned: false,
    });
  });

  it('TC-ACT-11 正式合同缺违约金（release_fee NULL）→ 行保留、费用 null，整页不 500', async () => {
    const fx = seedActivatable();
    seedFormalPlayer(fx, 90, '正常', 80);
    // 一名 release_fee=NULL 的正式球员：activationFee 对非正数抛 RangeError，
    // 行级兜底前曾让整个名单 500（v6.18.0 测试轮发现）
    addPlayer(fx, { id: 91, name: '缺违约金', clubId: CLUB_B, ca: 79 });
    addContract(fx, { playerId: 91, clubId: CLUB_B, releaseFee: null, protectionTicks: 5 });

    const body = await activatable(fx);
    expect(body.players.map((r) => r.id)).toEqual([90, 91]);
    expect(body.players[1]).toMatchObject({ id: 91, contractType: 'formal', activationFee: null });
    expect(body.players[0]).toMatchObject({ id: 90, activationFee: 20 });
  });
});
