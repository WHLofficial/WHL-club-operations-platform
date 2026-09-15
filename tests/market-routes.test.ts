// 市场路由测试（§16：挂牌/出价冻结/截止结算/窗尾收口/审核过户/并发不双花）
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { resetConfigCache } from '../src/core/config.ts';

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
       (4, '教练丁', 'coach', 0, 0),
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
    [4, 'tok-coach3'],
    [9, 'tok-viewer'],
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

async function createClub(fx: Fixture, name: string): Promise<number> {
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier' }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

interface MarketFixture extends Fixture {
  sellerClub: number;
  bidderClub: number;
  poorClub: number;
}

// 三俱乐部（卖方 100m / 买方 50m / 穷队 5m）+ 开放窗口 + 球员 10（RC 20、身价 30 → 挂牌区间 [10, 30]）
async function seedMarket(fx: Fixture): Promise<MarketFixture> {
  const sellerClub = await createClub(fx, '挂牌联');
  const bidderClub = await createClub(fx, '竞标队');
  const poorClub = await createClub(fx, '穷队');
  const binds: [number, string][] = [
    [sellerClub, 'tok-coach'],
    [bidderClub, 'tok-coach2'],
    [poorClub, 'tok-coach3'],
  ];
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of binds) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    const bind = await post('/api/clubs/bind', { code }, token, fx.env);
    expect(bind.status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${sellerClub}, 100, '2026-07-01T00:00:00Z'), (${bidderClub}, 50, '2026-07-01T00:00:00Z'), (${poorClub}, 5, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${sellerClub}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${bidderClub}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z'),
       (${poorClub}, 'opening_import', 5, 5, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
       (10, 'fc10', '王牌', ${sellerClub}, 'ST', 26, 85, 88, 30, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 10, ${sellerClub}, 20, 2, 'formal', 1, '2026-07-01');`,
  );
  return { ...fx, sellerClub, bidderClub, poorClub };
}

async function seedSecondPlayer(fx: Fixture, sellerClub: number): Promise<number> {
  fx.sqlite.exec(
    `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES (11, 'fc11', '替补', ${sellerClub}, 'CM', 24, 75, 82, 20, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES (2, 11, ${sellerClub}, 10, 1, 'formal', 1, '2026-07-01');`,
  );
  return 11;
}

async function listPlayer(mf: MarketFixture, playerId: number, askPrice: number, token = 'tok-coach') {
  return post('/api/market/listings', { playerId, askPrice }, token, mf.env);
}

// 把 1 号挂牌的静默计时拨回 11 天前（远早于任何 now 的 18-23 点判定窗），再触发访问结算
async function ageListingForDeadline(fx: Fixture, listingId = 1): Promise<void> {
  fx.sqlite.exec(
    `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                          listed_day = strftime('%Y-%m-%d', 'now', '-12 days') WHERE id = ${listingId}`,
  );
  await get('/api/market/listings?status=pending_review', 'tok-viewer', fx.env);
}

describe('挂牌（价格校验 4.4.1.1）', () => {
  it('合规价挂牌成功：球员转 listed、审计留痕、区间回显', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    const res = await listPlayer(mf, 10, 15);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; listingId: number; min: number; max: number };
    expect(body.min).toBe(10); // min(0.5×20, 0.5×30) = 10
    expect(body.max).toBe(30); // 1.5×20
    const listing = sqlGet<{ status: string; season: number; window_seq: number; listed_day: string }>(
      fx.sqlite,
      'SELECT status, season, window_seq, listed_day FROM listings WHERE id = ?',
      body.listingId,
    );
    expect(listing?.status).toBe('listed');
    expect(listing?.season).toBe(1);
    expect(listing?.listed_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 10')?.status).toBe('listed');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'listing_create'")?.n).toBe(1);
  });

  it('越界价被拒：低于下限 / 高于上限 / 非正数', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    const low = await listPlayer(mf, 10, 9.9);
    expect(low.status).toBe(400);
    expect(((await low.json()) as { error: string }).error).toContain('不能低于 10 m');
    const high = await listPlayer(mf, 10, 30.01);
    expect(high.status).toBe(400);
    expect(((await high.json()) as { error: string }).error).toContain('不能超过 30 m');
    expect((await listPlayer(mf, 10, -1)).status).toBe(400);
  });

  it('违约金过低挂不出价格（上限不足 1m）', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    fx.sqlite.exec('UPDATE contracts SET release_fee = 0.5 WHERE id = 1');
    const res = await listPlayer(mf, 10, 1);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('违约金太低');
  });

  it('窗外不能挂牌；别人家的球员不能挂；重复挂牌被拒；训练营球员不开放挂牌', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed'");
    const closed = await listPlayer(mf, 10, 15);
    expect(closed.status).toBe(409);
    expect(((await closed.json()) as { code?: string }).code).toBe('no_window');
    fx.sqlite.exec("UPDATE season_windows SET status = 'open'");

    const foreign = await listPlayer(mf, 10, 15, 'tok-coach2');
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: string }).error).toBe('只能挂牌自己队里的球员');

    const first = await listPlayer(mf, 10, 15);
    expect(first.status).toBe(201);
    // 用第二号球员验证「同球员重复挂牌」分支（一号球员再挂会先撞状态守卫）
    const p2 = await seedSecondPlayer(fx, mf.sellerClub);
    expect((await listPlayer(mf, p2, 8)).status).toBe(201);
    // 重复挂牌：先撞球员状态守卫（已 listed）；挂牌表查重仅作状态异常时的防御兜底
    const dup = await listPlayer(mf, p2, 9);
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { error: string }).error).toContain('已经在挂牌流程里');

    fx.sqlite.exec("UPDATE players SET status = 'trainee' WHERE id = 11");
    const trainee = await listPlayer(mf, 11, 8);
    expect(trainee.status).toBe(400);
    expect(((await trainee.json()) as { error: string }).error).toContain('训练营球员');
  });

  it('没有违约金现行合同不能挂；观众 403', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    fx.sqlite.exec('UPDATE contracts SET is_active = 0 WHERE id = 1');
    const res = await listPlayer(mf, 10, 15);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('没有含违约金的现行合同');
    const viewer = await listPlayer(mf, 10, 15, 'tok-viewer');
    expect(viewer.status).toBe(403);
  });
});

describe('出价与资金冻结（§6.4-1 / §7.4）', () => {
  it('首价≥挂牌价；出价即冻结、挂牌进 bidding；详情给下一步最低价', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    const low = await post('/api/market/listings/1/bids', { amount: 14.9 }, 'tok-coach2', fx.env);
    expect(low.status).toBe(400);
    expect(((await low.json()) as { error: string }).error).toContain('首笔出价不得低于挂牌价 15 m');

    const ok = await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    expect(ok.status).toBe(201);
    expect(sqlGet<{ status: string; amount: number; ref_type: string }>(fx.sqlite, 'SELECT status, amount, ref_type FROM fund_holds')).toMatchObject({
      status: 'held',
      amount: 15,
      ref_type: 'listing',
    });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')?.status).toBe('bidding');

    const detail = await get('/api/market/listings/1', 'tok-coach2', fx.env);
    const d = (await detail.json()) as { listing: { status: string; nextMinBid: number; windowOpen: boolean }; bids: unknown[] };
    expect(d.listing.status).toBe('bidding');
    expect(d.listing.nextMinBid).toBe(16);
    expect(d.listing.windowOpen).toBe(true);
    expect(d.bids).toHaveLength(1);
  });

  it('抬价：旧出价 superseded、旧冻结解冻、新冻结生效；步长不足被拒', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    const poor = await post('/api/market/listings/1/bids', { amount: 16 }, 'tok-coach3', fx.env);
    expect(poor.status).toBe(400);
    expect(((await poor.json()) as { error: string }).error).toContain('可用资金不足');
    const raise = await post('/api/market/listings/1/bids', { amount: 17 }, 'tok-coach2', fx.env);
    expect(raise.status).toBe(201);
    expect(sqlAll<{ status: string; amount: number }>(fx.sqlite, 'SELECT status, amount FROM bids ORDER BY id')).toEqual([
      { status: 'superseded', amount: 15 },
      { status: 'active', amount: 17 },
    ]);
    expect(sqlAll<{ status: string; amount: number }>(fx.sqlite, 'SELECT status, amount FROM fund_holds ORDER BY id')).toEqual([
      { status: 'released', amount: 15 },
      { status: 'held', amount: 17 },
    ]);
    const small = await post('/api/market/listings/1/bids', { amount: 17.5 }, 'tok-coach2', fx.env);
    expect(small.status).toBe(400);
    expect(((await small.json()) as { error: string }).error).toContain('抬价至少要比当前最高价多 1 m');
  });

  it('卖家不能自抬价；资金只够一单时第二单被拒（不双花，§16）', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    const self = await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach', fx.env);
    expect(self.status).toBe(403);
    expect(((await self.json()) as { error: string }).error).toBe('不能对自己俱乐部的挂牌出价');

    // 第二单（替补 RC 10 → 区间 [5, 15]）；竞标队余额 50：冻 15 + 5 后可用 30。
    // 自抬价按净差额校验：旧冻结 15 可释放，最高抬到 45；46 会把总冻结顶到 51 > 50 → 拒
    const p2 = await seedSecondPlayer(fx, mf.sellerClub);
    await listPlayer(mf, p2, 5);
    const l2 = sqlGet<{ id: number }>(fx.sqlite, "SELECT id FROM listings WHERE player_id = 11");
    expect((await post(`/api/market/listings/${l2?.id}/bids`, { amount: 5 }, 'tok-coach2', fx.env)).status).toBe(201);
    const over = await post('/api/market/listings/1/bids', { amount: 46 }, 'tok-coach2', fx.env);
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: string }).error).toContain('可用资金不足');
    expect((await post('/api/market/listings/1/bids', { amount: 45 }, 'tok-coach2', fx.env)).status).toBe(201);
    expect(sqlGet<{ s: number }>(fx.sqlite, "SELECT SUM(amount) AS s FROM fund_holds WHERE status = 'held'")?.s).toBe(50);
  });

  it('待审/下架后不能再出价（触发器兜底同样拒绝）', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await ageListingForDeadline(fx);
    const res = await post('/api/market/listings/1/bids', { amount: 20 }, 'tok-coach3', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('截止');
  });
});

describe('截止惰性结算与窗尾收口（§6.5 / 4.4.7）', () => {
  it('静默满 3h → 访问时进入待审：transfer + 审核任务建好且幂等', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await ageListingForDeadline(fx);
    const body = (await (await get('/api/market/listings?status=pending_review', 'tok-viewer', fx.env)).json()) as {
      listings: { id: number; status: string }[];
    };
    expect(body.listings).toHaveLength(1);
    expect(sqlGet<{ status: string; fee: number; idempotency_key: string; to_club_id: number }>(
      fx.sqlite,
      'SELECT status, fee, idempotency_key, to_club_id FROM transfers',
    )).toMatchObject({ status: 'pending_review', fee: 15, idempotency_key: 'listing:1', to_club_id: mf.bidderClub });
    const task = sqlGet<{ type: string; status: string; payload: string }>(fx.sqlite, 'SELECT type, status, payload FROM review_tasks');
    expect(task?.type).toBe('transfer_confirm');
    expect(task?.status).toBe('open');
    expect(JSON.parse(task!.payload)).toMatchObject({ listingId: 1, amount: 15, buyerClubId: mf.bidderClub });
    await get('/api/market/listings?status=all', 'tok-viewer', fx.env);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM transfers')?.n).toBe(1);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM review_tasks')?.n).toBe(1);
  });

  it('静默未满保持 bidding，顺延提示写库', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    const body = (await (await get('/api/market/listings', 'tok-viewer', fx.env)).json()) as {
      listings: { id: number; status: string; deadlineNote: string | null }[];
    };
    expect(body.listings[0].status).toBe('bidding');
    expect(body.listings[0].deadlineNote).toContain('截止判定');
  });

  it('窗尾收口：无人出价下架收 10% 费并还原球员；仍有竞价强制待审；cron tick 幂等', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    const p2 = await seedSecondPlayer(fx, mf.sellerClub);
    await listPlayer(mf, p2, 10);
    await post('/api/market/listings/2/bids', { amount: 15 }, 'tok-coach2', fx.env);
    fx.sqlite.exec("UPDATE season_windows SET status = 'closed'");
    const tick = await post('/api/cron/tick', {}, undefined, fx.env);
    expect(tick.status).toBe(200);
    const summary = (await tick.json()) as { ok: boolean; settled: number; delisted: number };
    expect(summary).toMatchObject({ ok: true, settled: 1, delisted: 1 });
    // 1 号挂牌（王牌，无出价）下架收 10% 下架费：15 × 10% = 1.5
    expect(sqlGet<{ amount: number }>(fx.sqlite, "SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND ref_id = 1")?.amount).toBe(-1.5);
    expect(sqlGet<{ balance: number }>(fx.sqlite, `SELECT balance FROM ledger_accounts WHERE club_id = ${mf.sellerClub}`)?.balance).toBe(98.5);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 1')?.status).toBe('delisted');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 10')?.status).toBe('normal');
    // 2 号挂牌（替补）有竞价 → 强制待审
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = 2')?.status).toBe('pending_review');
    await post('/api/cron/tick', {}, undefined, fx.env);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'delist_fee'")?.n).toBe(1);
  });
});

describe('审核队列与过户单点（§6.4-2）', () => {
  it('批准 → 进签约谈判（成约才过户）：会话建立、交 RC 出 E、直败结算过户、重复处理被挡', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await ageListingForDeadline(fx);

    const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
    const q = (await queue.json()) as { reviews: { id: number; transfer: { fee: number; fromClubName: string; toClubName: string } }[] };
    expect(q.reviews).toHaveLength(1);
    expect(q.reviews[0].transfer).toMatchObject({ fee: 15, fromClubName: '挂牌联', toClubName: '竞标队' });
    const taskId = q.reviews[0].id;

    const approve = await post(`/api/admin/reviews/${taskId}/approve`, { note: '成交确认' }, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { status: string }).status).toBe('signing');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('signing');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM review_tasks WHERE id = ?', taskId)?.status).toBe('approved');
    // 谈判期间资金仍冻结、账本未动
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM fund_holds')?.status).toBe('held');
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'transfer'")?.n).toBe(0);

    // 只有签约方（买方）能动会话
    expect((await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach', fx.env)).status).toBe(403);

    // 新 RC 区间（旧 RC 20 → [10, 30]）
    expect((await post('/api/negotiations/1/release-fee', { fee: 31 }, 'tok-coach2', fx.env)).status).toBe(400);
    expect((await post('/api/negotiations/1/release-fee', { fee: 9 }, 'tok-coach2', fx.env)).status).toBe(400);
    const fee = await post('/api/negotiations/1/release-fee', { fee: 20 }, 'tok-coach2', fx.env);
    expect(fee.status).toBe(200);
    expect(((await fee.json()) as { releaseFee: number; expectedWage: number }).expectedWage).toBe(3.11); // L7·F20

    // 低报价 fail（rng=0.9 躲开直败）：满意度文案 + 风险布尔，响应无判定参数（§6.10-2）
    fx.env.rng = () => 0.9;
    const low = await post('/api/negotiations/1/offer', { wage: 0.5 }, 'tok-coach2', fx.env);
    expect(low.status).toBe(200);
    const lowBody = (await low.json()) as Record<string, unknown> & { result: string; remaining: number; risk: boolean; satisfaction: string };
    expect(lowBody.result).toBe('fail');
    expect(lowBody.remaining).toBe(2);
    expect(lowBody.risk).toBe(true);
    expect(lowBody.satisfaction).toContain('😠');
    expect(Object.keys(lowBody).sort()).toEqual(['attemptNo', 'remaining', 'result', 'risk', 'satisfaction']);

    // 单调性：低于上次被拒，不耗次数
    expect((await post('/api/negotiations/1/offer', { wage: 0.4 }, 'tok-coach2', fx.env)).status).toBe(400);
    expect(sqlGet<{ attempt_count: number }>(fx.sqlite, 'SELECT attempt_count FROM negotiation_sessions WHERE id = 1')?.attempt_count).toBe(1);

    // 第 2 次直败（rng=0.1 < 档位 2 直败概率 0.5）→ 按 eff（E×0.95）结算成约过户
    fx.env.rng = () => 0.1;
    const direct = await post('/api/negotiations/1/offer', { wage: 0.6 }, 'tok-coach2', fx.env);
    expect(direct.status).toBe(200);
    expect(((await direct.json()) as { result: string; wage: number })).toMatchObject({ result: 'direct', wage: 2.95 });

    const t = sqlGet<{ status: string; tax: number; completed_at: string | null }>(
      fx.sqlite,
      'SELECT status, tax, completed_at FROM transfers WHERE id = 1',
    );
    expect(t?.status).toBe('completed');
    expect(t?.tax).toBe(1.5); // 成交价 15 全在 RC 内：15 × 10%
    expect(t?.completed_at).not.toBeNull();
    expect(sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 10')).toMatchObject({
      club_id: mf.bidderClub,
      status: 'normal',
    });
    expect(
      sqlGet<{ wage: number; release_fee: number; source: string; contract_type: string; signed_at: string | null }>(
        fx.sqlite,
        'SELECT wage, release_fee, source, contract_type, signed_at FROM contracts WHERE player_id = 10 AND is_active = 1',
      ),
    ).toEqual({ wage: 2.95, release_fee: 20, source: 'direct', contract_type: 'formal', signed_at: expect.any(String) });
    expect(
      sqlAll<{ club_id: number; kind: string; amount: number }>(
        fx.sqlite,
        "SELECT club_id, kind, amount FROM ledger_entries WHERE ref_type = 'transfer' ORDER BY id",
      ),
    ).toEqual([
      { club_id: mf.bidderClub, kind: 'transfer_in', amount: -15 },
      { club_id: mf.sellerClub, kind: 'transfer_out', amount: 15 },
      { club_id: mf.sellerClub, kind: 'transfer_tax', amount: -1.5 },
    ]);
    expect(sqlGet<{ balance: number }>(fx.sqlite, `SELECT balance FROM ledger_accounts WHERE club_id = ${mf.bidderClub}`)?.balance).toBe(35);
    expect(sqlGet<{ balance: number }>(fx.sqlite, `SELECT balance FROM ledger_accounts WHERE club_id = ${mf.sellerClub}`)?.balance).toBe(113.5);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM fund_holds')?.status).toBe('settled');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM bids')?.status).toBe('won');
    expect(sqlGet<{ status: string; settled_wage: number; settle_source: string }>(
      fx.sqlite,
      'SELECT status, settled_wage, settle_source FROM negotiation_sessions WHERE id = 1',
    )).toEqual({ status: 'settled', settled_wage: 2.95, settle_source: 'direct' });

    const again = await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env);
    expect(again.status).toBe(409);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE ref_type = 'transfer'")?.n).toBe(3);

    const detail = await get('/api/transfers/1', undefined, fx.env);
    expect(((await detail.json()) as { transfer: { status: string; fee: number; tax: number } }).transfer).toMatchObject({
      status: 'completed',
      fee: 15,
      tax: 1.5,
    });
  });

  it('驳回 → 全部解冻、挂牌下架、球员还原、单据 rejected', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await ageListingForDeadline(fx);
    const taskId = ((await (await get('/api/admin/reviews', 'tok-admin', fx.env)).json()) as { reviews: { id: number }[] }).reviews[0].id;
    const reject = await post(`/api/admin/reviews/${taskId}/reject`, { note: '偏离球员真实价值' }, 'tok-admin', fx.env);
    expect(reject.status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM fund_holds')?.status).toBe('released');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM bids')?.status).toBe('withdrawn');
    expect(sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = 1')).toMatchObject({
      status: 'delisted',
      deadline_note: '审核驳回',
    });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 10')?.status).toBe('normal');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = 1')?.status).toBe('rejected');
    expect(sqlGet<{ balance: number }>(fx.sqlite, `SELECT balance FROM ledger_accounts WHERE club_id = ${mf.bidderClub}`)?.balance).toBe(50);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(409);
  });

  it('教练不能碰审核队列', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await ageListingForDeadline(fx);
    expect((await post('/api/admin/reviews/1/approve', {}, 'tok-coach', fx.env)).status).toBe(403);
  });
});

describe('我的出价（冻结状态章）', () => {
  it('显示出价、冻结与结果状态', async () => {
    const fx = freshEnv();
    const mf = await seedMarket(fx);
    await listPlayer(mf, 10, 15);
    await post('/api/market/listings/1/bids', { amount: 15 }, 'tok-coach2', fx.env);
    await post('/api/market/listings/1/bids', { amount: 17 }, 'tok-coach2', fx.env);
    const body = (await (await get('/api/me/bids', 'tok-coach2', fx.env)).json()) as {
      bids: { amount: number; status: string; holdStatus: string | null; player: { name: string } }[];
    };
    expect(body.bids).toHaveLength(2);
    expect(body.bids[0]).toMatchObject({ amount: 17, status: 'active', holdStatus: 'held', player: { name: '王牌' } });
    expect(body.bids[1]).toMatchObject({ amount: 15, status: 'superseded', holdStatus: 'released' });
  });
});
