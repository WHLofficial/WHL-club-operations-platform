// 窗口状态机测试（§11/§6.4-6）：开窗重掷、关窗前置校验（活跃会话/匹配等待/待审队列）、
// 强制结算开关、窗尾收口。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { createConfigService } from '../src/core/config.ts';

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
       (3, '教练丙', 'coach', 0, 0);`,
  );
  tour.exec(TOUR_TEAM_SEED_SQL);
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
  return ((await res.json()) as { club: { id: number } }).club.id;
}

// 基础局：两 club、球员+合同、窗口 1 开着
async function seedWindow(): Promise<Fixture & { clubA: number; clubB: number }> {
  const fx = freshEnv();
  const clubA = await createClub(fx, '甲队');
  const clubB = await createClub(fx, '乙队');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [clubA, 'tok-coach'],
    [clubB, 'tok-coach2'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
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

// 窗 1 内走完一次普通转会挂牌（bidding 态、未截止）
async function seedLiveBidding(fx: Fixture): Promise<void> {
  expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
  expect((await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env)).status).toBe(201);
}

describe('开窗', () => {
  it('无在开窗口时开新窗顺延 windowSeq，自动建赛季档；重掷按 rng 走', async () => {
    const fx = await seedWindow();
    // rng 序列：第 1 次 0.1（<0.3 重掷）→ 第 2 次 0.99 → 档位 3；其余 0.99 不掷
    let call = 0;
    fx.env.rng = () => (call++ === 0 ? 0.1 : 0.99);
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1`);
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { season: number; windowSeq: number; rerolled: number };
    expect(body.season).toBe(1);
    expect(body.windowSeq).toBe(2);
    expect(body.rerolled).toBe(1);
    const tier = sqlGet<{ agent_tier: number }>(fx.sqlite, 'SELECT agent_tier FROM players WHERE id = 50');
    expect(tier?.agent_tier).toBe(3); // 0.99 → 1 + floor(2.97) = 3
  });

  it('还有窗口开着时不能开新窗', async () => {
    const fx = await seedWindow();
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
  });

  it('开窗提醒等开窗的意向单：双方各排一条 offer_intent_window_open（v6.29.0）', async () => {
    const fx = await seedWindow();
    // 先关掉窗 1，再走「关窗期报价 → 卖方同意 → 意向单」
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1");
    const offerRes = await post('/api/offers', { playerId: 50, amount: 15 }, 'tok-coach2', fx.env);
    expect(offerRes.status).toBe(201);
    const offerId = ((await offerRes.json()) as { offerId: number }).offerId;
    const intentRes = await post(`/api/offers/${offerId}/accept`, {}, 'tok-coach', fx.env);
    expect(intentRes.status).toBe(200);
    expect(((await intentRes.json()) as { status: string }).status).toBe('intent');

    fx.env.rng = () => 0.99; // 不重掷，稳定开窗
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    // 卖方（去确认）与买方（知道窗口开了）各一条，模板文案落在 payload.text 里
    const notices = sqlAll<{ club_id: number; payload: string }>(
      fx.sqlite,
      "SELECT club_id, payload FROM notifications WHERE template = 'offer_intent_window_open' ORDER BY club_id",
    );
    expect(notices.map((n) => n.club_id)).toEqual([fx.clubA, fx.clubB].sort((a, b) => a - b));
    expect(notices[0].payload).toContain('意向单');
    // 提醒只是提醒：意向单还挂着，等卖方点确认
    expect(sqlGet(fx.sqlite, 'SELECT status FROM offers WHERE id = ?', offerId)).toMatchObject({ status: 'intent' });
  });

  // v6.55.0 意向单多笔并存：开窗提醒按 (player_id) 聚合——卖方每球员一条（N 家求购择一确认），
  // 买方各带自己单 id 一条（N 家竞争提示）；N=1 保持原文案（上一用例）。
  it('开窗提醒多买方聚合：卖方合并成一条择一确认，买方各收竞争提示', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1");
    // clubB 走正常链路落一条意向单
    const offerRes = await post('/api/offers', { playerId: 50, amount: 15 }, 'tok-coach2', fx.env);
    expect(offerRes.status).toBe(201);
    const offerId = ((await offerRes.json()) as { offerId: number }).offerId;
    const intentRes = await post(`/api/offers/${offerId}/accept`, {}, 'tok-coach', fx.env);
    expect(((await intentRes.json()) as { status: string }).status).toBe('intent');
    // 第三队（clubC）直插同球员第二条意向单 + 授权库绑定（通知要落到真人收件篮）。
    // D1 的 run() 不吃参数，一律先 bind 再 run（夹具的 node:sqlite 直写才允许 run(...args)）
    const clubC = await createClub(fx, '丙队');
    const authDb = fx.env.AUTH_DB;
    expect(authDb).toBeDefined();
    await authDb!
      .prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(clubC, clubC, '丙队', '2026-01-01T00:00:00Z')
      .run();
    const teamId = (await authDb!.prepare('SELECT id FROM team WHERE club_id = ?').bind(clubC).first<{ id: number }>())!.id;
    await authDb!
      .prepare("INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (4, ?, 'club', '2026-01-01T00:00:00Z')")
      .bind(teamId)
      .run();
    fx.sqlite
      .prepare(
        `INSERT INTO offers (player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at)
         VALUES (50, ?, ?, 18, 18, 0, 'intent', 'seller', NULL, NULL, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
      )
      .run(clubC, fx.clubA);

    fx.env.rng = () => 0.99; // 不重掷，稳定开窗
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    // 卖方 1 条（N=2 择一确认，不再按单各发一条），两家买方各 1 条 → 共 3 条
    const notices = sqlAll<{ club_id: number; payload: string }>(
      fx.sqlite,
      "SELECT club_id, payload FROM notifications WHERE template = 'offer_intent_window_open' ORDER BY club_id",
    );
    expect(notices).toHaveLength(3);
    const seller = notices.find((n) => n.club_id === fx.clubA)!;
    expect(seller.payload).toContain('2 家求购');
    expect(seller.payload).toContain('择一确认');
    const buyerNotices = notices.filter((n) => n.club_id !== fx.clubA);
    expect(buyerNotices).toHaveLength(2);
    for (const n of buyerNotices) {
      expect(n.payload).toContain('2 家意向竞争');
      expect(n.payload).toContain('撤回解冻');
    }
  });

  // 第三轮终验：开窗提醒原单轮 LIMIT 200 在 >200 条时静默丢提醒——翻页取全后 205 条全部送达
  it('开窗提醒翻页取全：205 条意向单全部收到提醒（单轮 LIMIT 200 只会出 400 条）', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1");
    const insertPlayer = fx.sqlite.prepare(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES (?, ?, ?, ?, 'ST', 26, 85, 88, 'normal')`,
    );
    const insertIntent = fx.sqlite.prepare(
      `INSERT INTO offers (player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at)
       VALUES (?, ?, ?, 15, 15, 0, 'intent', 'seller', NULL, NULL, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
    );
    for (let i = 0; i < 205; i++) {
      const pid = 1000 + i;
      insertPlayer.run(pid, `u${pid}`, `球员${pid}`, fx.clubA);
      insertIntent.run(pid, fx.clubB, fx.clubA);
    }
    fx.env.rng = () => 0.99;
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    // 205 球员 ×（卖方 1 + 买方 1）= 410 条；单轮 LIMIT 200 的旧实现只会出 400 条
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_window_open'")?.n).toBe(410);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_window_open' AND club_id = ?", fx.clubA)?.n).toBe(205);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_window_open' AND club_id = ?", fx.clubB)?.n).toBe(205);
  });

  // TC-A-027：聚合折叠跨翻页边界——同球员 205 个买方，翻页取全后卖方仍只折叠成 1 条；
  // 单轮 LIMIT 200 的新写法只会出 201（卖方 1 + 前 200 个买方），翻页写回单轮变异必红。
  it('TC-A-027 同球员 205 买方跨翻页聚合：卖方 1 条 + 买方 205 条，无一丢', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1");
    const authDb = fx.env.AUTH_DB;
    expect(authDb).toBeDefined();
    const insertClub = fx.sqlite.prepare(`INSERT INTO clubs (id, name, league_tier, status) VALUES (?, ?, 'premier', 'active')`);
    const insertIntent = fx.sqlite.prepare(
      `INSERT INTO offers (player_id, buyer_club_id, seller_club_id, amount, init_amount, round, status, turn, season, window_seq, created_at, updated_at)
       VALUES (50, ?, ?, 15, 15, 0, 'intent', 'seller', NULL, NULL, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
    );
    const insertTeam = authDb!.prepare('INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (?, ?, ?, ?)');
    const insertBinding = authDb!.prepare("INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES (?, ?, 'club', '2026-01-01T00:00:00Z')");
    for (let i = 0; i < 205; i++) {
      const clubId = 2000 + i;
      insertClub.run(clubId, `买方${clubId}`);
      insertIntent.run(clubId, fx.clubA);
      // 每个买方 club 必须在 AUTH_DB 有真人绑定（team_binding JOIN team）：无绑定的 club 被
      // queueClubNotification 直接跳过（accountIds.length===0 即 return 0，不落通知行），断言不可达
      // （测试 D1 桩是 bind-only：参数走 .bind(...)，run() 不收参）
      await insertTeam.bind(clubId, clubId, `买方${clubId}`, '2026-01-01T00:00:00Z').run();
      const teamId = (await authDb!.prepare('SELECT id FROM team WHERE club_id = ?').bind(clubId).first<{ id: number }>())!.id;
      await insertBinding.bind(1000 + i, teamId).run();
    }
    fx.env.rng = () => 0.99;
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);

    // 206 = 卖方聚合 1（205 家求购择一确认）+ 买方 205（各带自己单 id）
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_window_open'")?.n).toBe(206);
    const sellerRows = sqlAll<{ payload: string }>(
      fx.sqlite,
      "SELECT payload FROM notifications WHERE template = 'offer_intent_window_open' AND club_id = ?",
      fx.clubA,
    );
    expect(sellerRows).toHaveLength(1);
    expect(sellerRows[0].payload).toContain('205 家求购');
    expect(sellerRows[0].payload).toContain('确认一条后其余自动失效');
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM notifications WHERE template = 'offer_intent_window_open' AND club_id BETWEEN 2000 AND 2204")?.n,
    ).toBe(205);
    expect(
      sqlGet<{ payload: string }>(fx.sqlite, "SELECT payload FROM notifications WHERE template = 'offer_intent_window_open' AND club_id = 2000")?.payload,
    ).toContain('205 家意向竞争');
  });

  // v6.54.0 §8「放在 openWindow 成功后调用」：开窗返回值带本窗新生成的球员要求条数。
  // 这里只锁「接线真的在」——生成资格/概率的确定性口径由 tests/demand-ops.test.ts 的固定种子用例锁；
  // 本用例靠 120 名明显够格球员的批量把「一个都没中」的概率压到可忽略，并逐值对账 DB 行数。
  it('开窗成功后跑闹涨薪生成批：demandsCreated = 本窗 demand 行数', async () => {
    const fx = await seedWindow();
    fx.env.rng = () => 0.99;
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1`);
    const insertPlayer = fx.sqlite.prepare(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, agent_tier)
       VALUES (?, ?, ?, ?, 'ST', 20, 90, 92, 'normal', 3)`,
    );
    const insertContract = fx.sqlite.prepare(
      `INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, is_active, service_ticks, protection_ticks)
       VALUES (?, ?, 20, 0.5, 'formal', 'import', 1, 4, 8)`,
    );
    for (let i = 0; i < 120; i++) {
      const pid = 1000 + i;
      insertPlayer.run(pid, `u${pid}`, `球员${pid}`, fx.clubA);
      insertContract.run(pid, fx.clubA);
    }
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { season: number; windowSeq: number; demandsCreated: number };
    expect(body.season).toBe(1);
    expect(body.windowSeq).toBe(2);
    expect(body.demandsCreated).toBeGreaterThan(0);
    const rows = sqlGet<{ n: number }>(
      fx.sqlite,
      'SELECT COUNT(*) AS n FROM contract_demands WHERE season = 1 AND window_seq = 2',
    );
    expect(rows?.n).toBe(body.demandsCreated);
  });

  it('生成批抛错不阻塞开窗（TC-RD-18 #4）：demandsCreated=0、窗口照常 open', async () => {
    const fx = await seedWindow();
    fx.env.rng = () => 0.99;
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE season = 1 AND window_seq = 1`);
    // 让生成批的第一条 contract_demands 查询抛错（模拟迁移未 apply / D1 瞬时故障）
    const real = fx.env.DB;
    fx.env.DB = new Proxy(real, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (String(sql).includes('contract_demands')) throw new Error('boom');
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as typeof real;
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { demandsCreated: number; season: number; windowSeq: number };
    expect(body.demandsCreated).toBe(0);
    expect(
      sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM season_windows WHERE season = 1 AND window_seq = 2'),
    ).toMatchObject({ status: 'open' });
  });
});

describe('关窗', () => {
  it('关窗成功：窗尾收口把竞价单转待审（新待审留给下一窗处理）', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    const close1 = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(close1.status).toBe(200);
    const win = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM season_windows WHERE season = 1 AND window_seq = 1');
    expect(win?.status).toBe('closed');
    const listing = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1');
    expect(listing?.status).toBe('pending_review');

    // 关窗审计（v6.2.1）：actor = 操作的管理员，且逐类汇总与同批实际落库的流水对得上
    const audit = sqlGet<{ actor: number | null; target_type: string; target_id: number | null; after: string }>(
      fx.sqlite,
      "SELECT actor, target_type, target_id, after FROM audit_log WHERE action = 'window_close'",
    )!;
    expect(audit).toMatchObject({ actor: 1, target_type: 'season_window', target_id: null });
    const after = JSON.parse(audit.after) as {
      season: number;
      windowSeq: number;
      isTemporary: boolean;
      forceSettled: number;
      loyaltyCount: number;
      loyaltyTotal: number;
      payroll: Record<string, number>;
      home: Record<string, number>;
    };
    expect(after).toMatchObject({ season: 1, windowSeq: 1, isTemporary: false, forceSettled: 0, loyaltyCount: 0, loyaltyTotal: 0 });
    // 汇总口径 = 本批该窗（ref_type 'window' / ref_id = season×100+window_seq）的流水合计
    const windowLedger = (kind: string) =>
      sqlGet<{ n: number; total: number }>(
        fx.sqlite,
        `SELECT COUNT(*) AS n, COALESCE(ROUND(-SUM(amount), 2), 0) AS total FROM ledger_entries
          WHERE ref_type = 'window' AND ref_id = 101 AND kind = '${kind}'`,
      )!;
    const wage = windowLedger('wage');
    const tax = windowLedger('luxury_tax');
    const maintenance = windowLedger('maintenance');
    const namingFee = windowLedger('naming_fee');
    expect(after.payroll).toMatchObject({ wageClubs: wage.n, taxClubs: tax.n });
    expect(after.payroll.wageTotal).toBeCloseTo(wage.total, 2);
    expect(after.payroll.taxTotal).toBeCloseTo(tax.total, 2);
    expect(after.home).toMatchObject({ maintenanceClubs: maintenance.n, namingClubs: namingFee.n });
    expect(after.home.maintenanceTotal).toBeCloseTo(maintenance.total, 2);
    expect(after.home.namingTotal).toBeCloseTo(namingFee.total, 2);
  });

  it('已有关键节点未决（活跃谈判会话）挡关窗；force + window_force_settle=true 时按 E 强结并完成过户', async () => {
    const fx = await seedWindow();
    await seedLiveBidding(fx);
    // 关窗（窗尾收口转待审）→ 批准成交进签约谈判
    expect((await post('/api/admin/windows/close', {}, 'tok-admin', fx.env)).status).toBe(200);
    const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
    const taskId = ((await queue.json()) as { reviews: { id: number }[] }).reviews[0].id;
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 窗口已关，再关 → 409 无窗口
    const close2 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(close2.status).toBe(409);
    expect(((await close2.json()) as { error: string }).error).toContain('没有开着的窗口');

    // 开窗 2 → 关窗被活跃会话挡
    fx.env.rng = () => 0.99;
    expect((await post('/api/admin/windows/open', {}, 'tok-admin', fx.env)).status).toBe(201);
    const close3 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(close3.status).toBe(409);
    expect(((await close3.json()) as { error: string }).error).toContain('1 场签约谈判没结束');

    // 打开强制结算开关；会话先提交新 RC（E 快照）→ force 关窗成功，会话按 E 强约、过户完成
    const config = createConfigService(fx.env.DB);
    await config.set('window_force_settle', 'true');
    const feeRes = await post('/api/negotiations/1/release-fee', { fee: 15 }, 'tok-coach2', fx.env);
    expect(feeRes.status).toBe(200);
    fx.env.rng = () => 0.99;
    const close4 = await post('/api/admin/windows/close', { force: true }, 'tok-admin', fx.env);
    expect(close4.status).toBe(200);
    expect(((await close4.json()) as { forceSettled: number }).forceSettled).toBe(1);
    const transfer = sqlGet<{ status: string }>(fx.sqlite, "SELECT status FROM transfers WHERE idempotency_key = 'listing:1'");
    expect(transfer?.status).toBe('completed');
    const session = sqlGet<{ status: string; settle_source: string }>(
      fx.sqlite,
      "SELECT status, settle_source FROM negotiation_sessions WHERE transfer_id = (SELECT id FROM transfers WHERE idempotency_key = 'listing:1')",
    );
    expect(session).toMatchObject({ status: 'settled', settle_source: 'forced' });
  });

  it('匹配等待单挡关窗', async () => {
    const fx = await seedWindow();
    fx.sqlite.exec(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, activated_by, activation_deadline, match_deadline, season, window_seq)
       VALUES (50, ${fx.clubA}, 'activation', 40, 'matched_pending', '2026-07-01T02:00:00Z', '2026-07-01', ${fx.clubB}, NULL, '2027-01-01T00:00:00Z', 1, 1)`,
    );
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('匹配等待期');
  });

  it('无活跃事项时正常关窗，窗尾无人出价的挂牌收下架费', async () => {
    const fx = await seedWindow();
    // 只挂牌未出价
    expect((await post('/api/market/listings', { playerId: 50, askPrice: 15 }, 'tok-coach', fx.env)).status).toBe(201);
    const res = await post('/api/admin/windows/close', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(200);
    const win = sqlGet<{ status: string; closed_at: string | null }>(fx.sqlite, 'SELECT status, closed_at FROM season_windows WHERE season = 1 AND window_seq = 1');
    expect(win?.status).toBe('closed');
    expect(win?.closed_at).not.toBeNull();
    const listing = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1');
    expect(listing?.status).toBe('delisted');
    const fee = sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND club_id = ${fx.clubA}`);
    expect(fee?.amount).toBe(-1.5); // 15 × 10%
  });
});

describe('v6.53.0 开窗：首窗清零 + 场馆通知 + 开窗原子性', () => {
  /** 直接改状态关窗：本组只测开窗侧，不想要关窗结算的副作用 */
  function closeAllWindows(fx: Fixture) {
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-08-01T00:00:00Z' WHERE status = 'open'`);
  }

  function venueOf(fx: Fixture, clubId: number) {
    return sqlGet<{ next_attendance_mod: number; attendance_mod_matches: number }>(
      fx.sqlite,
      'SELECT next_attendance_mod, attendance_mod_matches FROM stadiums WHERE club_id = ?',
      clubId,
    );
  }

  function openCount(fx: Fixture) {
    return sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM season_windows WHERE status = 'open'");
  }

  /** 管理端建队不建球场：乘数/容量相关断言要自己补一行（容量决定本窗档位数） */
  function seedStadium(fx: Fixture, clubId: number, capacity = 20000) {
    fx.sqlite.exec(
      `INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at)
       VALUES (${clubId}, '', ${capacity}, 0, 0, 0, 1800, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
    );
  }

  it('本赛季首窗前清零（1 / 0），同赛季第二窗不动上一窗留下的乘数', async () => {
    const fx = await seedWindow(); // S1 窗 1 开着
    seedStadium(fx, fx.clubA);
    seedStadium(fx, fx.clubB);
    closeAllWindows(fx);
    fx.sqlite.exec('UPDATE stadiums SET next_attendance_mod = 0.95, attendance_mod_matches = 5');
    fx.env.rng = () => 0.99; // 不重掷，稳定开窗
    const res = await post('/api/admin/windows/open', { season: 2 }, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { season: number; windowSeq: number; venueReset: boolean };
    expect(body).toMatchObject({ season: 2, windowSeq: 1, venueReset: true });
    expect(venueOf(fx, fx.clubA)).toEqual({ next_attendance_mod: 1, attendance_mod_matches: 0 });
    expect(venueOf(fx, fx.clubB)).toEqual({ next_attendance_mod: 1, attendance_mod_matches: 0 });

    // 同赛季第二窗：赛季里已经有窗行 ⇒ 不再清零
    closeAllWindows(fx);
    fx.sqlite.exec('UPDATE stadiums SET next_attendance_mod = 0.9, attendance_mod_matches = 3');
    const res2 = await post('/api/admin/windows/open', { season: 2 }, 'tok-admin', fx.env);
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { windowSeq: number; venueReset: boolean };
    expect(body2).toMatchObject({ windowSeq: 2, venueReset: false });
    expect(venueOf(fx, fx.clubA)).toEqual({ next_attendance_mod: 0.9, attendance_mod_matches: 3 });
  });

  it('开窗给每个活跃队排一条场馆开窗提醒（档位数按容量派生：20000 ⇒ 3，12000 ⇒ 2）', async () => {
    const fx = await seedWindow();
    seedStadium(fx, fx.clubA, 20000);
    seedStadium(fx, fx.clubB, 12000);
    closeAllWindows(fx);
    fx.env.rng = () => 0.99;
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { venueNotified: number };
    expect(body.venueNotified).toBe(2); // clubA / clubB 各一个绑定账号
    const rows = sqlAll<{ club_id: number; payload: string }>(
      fx.sqlite,
      "SELECT club_id, payload FROM notifications WHERE template = 'venue_window_open' ORDER BY club_id",
    );
    expect(rows.map((r) => r.club_id)).toEqual([fx.clubA, fx.clubB].sort((a, b) => a - b));
    const byClub = new Map(rows.map((r) => [r.club_id, r.payload]));
    expect(byClub.get(fx.clubA)).toContain('【场馆开窗】');
    expect(byClub.get(fx.clubA)).toContain('本窗有 3 个档位可排');
    expect(byClub.get(fx.clubB)).toContain('本窗有 2 个档位可排');
  });

  it('开窗通知失败只是提醒丢了：仍返回 ok，窗照样开着（通知绝不阻塞主流程）', async () => {
    const fx = await seedWindow();
    closeAllWindows(fx);
    fx.sqlite.exec('DROP TABLE notifications'); // 排通知必抛 → queueClubNotification 内部吞掉返回 0
    fx.env.rng = () => 0.99;
    const res = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; venueNotified: number };
    expect(body.ok).toBe(true);
    expect(body.venueNotified).toBe(0);
    expect(openCount(fx)).toEqual({ n: 1 });
  });

  it('P0 ⑧ 原子性：开窗被 DB 中止 ⇒ 经纪人重掷一起回滚，重跑才生效', async () => {
    const fx = await seedWindow();
    closeAllWindows(fx);
    fx.sqlite.exec('UPDATE players SET agent_tier = 1 WHERE id = 50');
    let call = 0;
    fx.env.rng = () => (call++ === 0 ? 0.1 : 0.99); // 首个 player 命中重掷 → 0.99 落档 3
    fx.sqlite.exec(`CREATE TRIGGER fail_open BEFORE INSERT ON season_windows BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    const failed = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(failed.status).toBe(500);
    // 重掷语句在批首、INSERT 在批尾：INSERT 中止 ⇒ 整批回滚，档位不能被改
    expect(sqlGet<{ agent_tier: number }>(fx.sqlite, 'SELECT agent_tier FROM players WHERE id = 50')).toEqual({ agent_tier: 1 });
    expect(openCount(fx)).toEqual({ n: 0 });

    fx.sqlite.exec('DROP TRIGGER fail_open');
    let call2 = 0;
    fx.env.rng = () => (call2++ === 0 ? 0.1 : 0.99); // 重跑：rng 序列从头再来，同样命中一次重掷
    const ok = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { rerolled: number };
    expect(body.rerolled).toBe(1);
    expect(sqlGet<{ agent_tier: number }>(fx.sqlite, 'SELECT agent_tier FROM players WHERE id = 50')).toEqual({ agent_tier: 3 });
  });

  it('串行第二次开窗被 409 拦住：open 窗只剩一个，失败那条不改经纪人档位（P0 ⑦ 的应用层闸）', async () => {
    const fx = await seedWindow();
    closeAllWindows(fx);
    fx.sqlite.exec('UPDATE players SET agent_tier = 1 WHERE id = 50');
    let call = 0;
    fx.env.rng = () => (call++ === 0 ? 0.1 : 0.99);
    const first = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(first.status).toBe(201);
    expect(sqlGet<{ agent_tier: number }>(fx.sqlite, 'SELECT agent_tier FROM players WHERE id = 50')).toEqual({ agent_tier: 3 });

    // 第二次：若跑到重掷会把档位改回 3 以外的值（这里恒 0.1 → 档 1），断言它根本没到那一步
    fx.env.rng = () => 0.1;
    const second = await post('/api/admin/windows/open', {}, 'tok-admin', fx.env);
    expect(second.status).toBe(409);
    expect(openCount(fx)).toEqual({ n: 1 });
    expect(sqlGet<{ agent_tier: number }>(fx.sqlite, 'SELECT agent_tier FROM players WHERE id = 50')).toEqual({ agent_tier: 3 });
  });
});
