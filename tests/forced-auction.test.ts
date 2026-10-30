// 强制拍卖测试（规则 4.4.5）：v6.51.0 起人选不限（门将 / 前六之外 / 缺 CA 都能挂），
// 队内非门将 CA 前六只作为参考值随响应回报；挂牌价可指定（默认 1m）、正常竞价链成交、
// 整单税 50%、管理组取消。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
import { bidDeadline } from '../src/core/market-rules.ts';
import { loadMarketContext } from '../src/worker/market-context.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';
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

// 被拍卖队（8 人：CA 90..76 非门将 7 人 + 门将；并列 CA84 两名）+ 竞买队（50m）
// + 豪门队（7 名高 CA 非门将）：若按联盟口径，受罚队第六（CA 82）会被压出前六——201 断言据此钉死队内语义
async function seedAuction(): Promise<Fixture & { club: number; buyer: number; rich: number }> {
  const fx = freshEnv();
  const club = await createClub(fx, '受罚队');
  const buyer = await createClub(fx, '接盘队');
  const rich = await createClub(fx, '豪门队');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [club, 'tok-coach'],
    [buyer, 'tok-coach2'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    expect((await post('/api/clubs/bind', { code }, token, fx.env)).status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${club}, 60, '2026-07-01T00:00:00Z'), (${buyer}, 50, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${club}, 'opening_import', 60, 60, '期初', '2026-07-01T00:00:00Z'),
       (${buyer}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
       (40, 'fc40', '头牌', ${club}, 'ST', 26, 90, 90, 'normal'),
       (41, 'fc41', '二牌', ${club}, 'CM', 26, 88, 88, 'normal'),
       (42, 'fc42', '三牌', ${club}, 'CB', 27, 86, 86, 'normal'),
       (43, 'fc43', '并列甲', ${club}, 'CM', 25, 84, 84, 'normal'),
       (44, 'fc44', '并列乙', ${club}, 'RB', 25, 84, 84, 'normal'),
       (45, 'fc45', '第六', ${club}, 'LM', 24, 82, 82, 'normal'),
       (46, 'fc46', '第七', ${club}, 'RM', 24, 80, 80, 'normal'),
       (47, 'fc47', '门神', ${club}, 'GK', 28, 91, 91, 'normal'),
       (50, 'fc50', '豪门一', ${rich}, 'ST', 26, 95, 95, 'normal'),
       (51, 'fc51', '豪门二', ${rich}, 'CM', 26, 93, 93, 'normal'),
       (52, 'fc52', '豪门三', ${rich}, 'CB', 27, 92, 92, 'normal'),
       (53, 'fc53', '豪门四', ${rich}, 'CM', 25, 91, 91, 'normal'),
       (54, 'fc54', '豪门五', ${rich}, 'RB', 25, 90, 90, 'normal'),
       (55, 'fc55', '豪门六', ${rich}, 'LM', 24, 89, 89, 'normal'),
       (56, 'fc56', '豪门七', ${rich}, 'RM', 24, 88, 88, 'normal'),
       (57, 'fc57', '豪门门神', ${rich}, 'GK', 28, 96, 96, 'normal');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 45, ${club}, 20, 2, 'formal', 1, '2026-06-01'),
       (2, 46, ${club}, 20, 2, 'formal', 1, '2026-06-01'),
       (3, 47, ${club}, 20, 2, 'formal', 1, '2026-06-01');`,
  );
  return { ...fx, club, buyer, rich };
}

async function openReviewTaskId(fx: Fixture): Promise<number> {
  const queue = await get('/api/admin/reviews', 'tok-admin', fx.env);
  const reviews = ((await queue.json()) as { reviews: { id: number }[] }).reviews;
  expect(reviews.length).toBeGreaterThan(0);
  return reviews[0].id;
}

describe('强制拍卖（4.4.5）', () => {
  it('v6.51.0 人选不限：第七、门将、缺 CA 都能挂，队内非门将 CA 前六只作参考值回报', async () => {
    const fx = await seedAuction();
    type Resp = { askPrice: number; listingId: number; reference: Record<string, unknown> };
    const cancel = (id: number) => post(`/api/admin/forced-auctions/${id}/cancel`, {}, 'tok-admin', fx.env);

    // 第七（CA 80，队内非门将第 7）⇒ 201，参考值标出「不在前六」并给出前六线 CA 82
    const seventh = await post('/api/admin/forced-auctions', { playerId: 46 }, 'tok-admin', fx.env);
    expect(seventh.status).toBe(201);
    const seventhBody = (await seventh.json()) as Resp;
    expect(seventhBody.askPrice).toBe(1);
    expect(seventhBody.reference).toMatchObject({
      playerId: 46,
      playerName: '第七',
      clubName: '受罚队',
      caRank: 7,
      inTopSix: false,
      topSixLine: 82,
      isGk: false,
      nonGkWithCa: 7,
    });
    expect((await cancel(seventhBody.listingId)).status).toBe(200);

    // 门将（CA 91）⇒ 201：前六参考口径不含门将，参考值不可算（isGk 立起）
    const gk = await post('/api/admin/forced-auctions', { playerId: 47 }, 'tok-admin', fx.env);
    expect(gk.status).toBe(201);
    const gkBody = (await gk.json()) as Resp;
    expect(gkBody.reference).toMatchObject({ isGk: true, caRank: null, inTopSix: null });
    expect((await cancel(gkBody.listingId)).status).toBe(200);

    // 前六（含并列）照旧可挂：CA 82 是队内非门将第六（84 并列占四、五）⇒ 参考 inTopSix=true
    const sixth = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(sixth.status).toBe(201);
    const sixthBody = (await sixth.json()) as Resp;
    expect(sixthBody.reference).toMatchObject({ caRank: 6, inTopSix: true, topSixLine: 82 });
    expect((await cancel(sixthBody.listingId)).status).toBe(200);

    // 豪门队 CA 88 是队内非门将第七 ⇒ 同样能挂（参考值按本队口径算：前六线 CA 89）
    const richSeventh = await post('/api/admin/forced-auctions', { playerId: 56 }, 'tok-admin', fx.env);
    expect(richSeventh.status).toBe(201);
    const richBody = (await richSeventh.json()) as Resp;
    expect(richBody.reference).toMatchObject({ caRank: 7, inTopSix: false, topSixLine: 89 });
    expect((await cancel(richBody.listingId)).status).toBe(200);

    // 缺 CA：参考值不可算，但照样能挂（2026 之前只认「有 CA」的硬闸已去）
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status)
       VALUES (58, 'fc58', '没数据', ${fx.club}, 'CM', 24, NULL, NULL, 'normal');`,
    );
    const noCa = await post('/api/admin/forced-auctions', { playerId: 58 }, 'tok-admin', fx.env);
    expect(noCa.status).toBe(201);
    expect(((await noCa.json()) as Resp).reference).toMatchObject({ ca: null, caRank: null, inTopSix: null, isGk: false });
  });

  it('v6.51.0 preview：参考值 + 闸门原因（开窗可挂 / 无窗报 no_window / 404 / 需管理员）', async () => {
    const fx = await seedAuction();
    const preview = await get('/api/admin/forced-auctions/preview?playerId=46', 'tok-admin', fx.env);
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as {
      reference: Record<string, unknown>;
      blockers: { status: number; message: string; errCode?: string }[];
    };
    expect(body.blockers).toEqual([]);
    expect(body.reference).toMatchObject({ playerId: 46, playerName: '第七', clubName: '受罚队', caRank: 7, inTopSix: false, topSixLine: 82 });

    // 关窗 ⇒ 预检只报原因（不改任何状态），建单仍 409 —— 同一句口径
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed', closed_at = '2026-07-02T00:00:00Z' WHERE season = 1 AND window_seq = 1`);
    const closed = await get('/api/admin/forced-auctions/preview?playerId=46', 'tok-admin', fx.env);
    const closedBody = (await closed.json()) as { blockers: { errCode?: string; message: string }[] };
    expect(closedBody.blockers.map((b) => b.errCode)).toEqual(['no_window']);
    const created = await post('/api/admin/forced-auctions', { playerId: 46 }, 'tok-admin', fx.env);
    expect(created.status).toBe(409);
    expect(((await created.json()) as { error: string }).error).toBe(closedBody.blockers[0].message);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM listings WHERE player_id = 46`)?.n).toBe(0);

    // 球员不存在：预检与建单同源 404
    expect((await get('/api/admin/forced-auctions/preview?playerId=999', 'tok-admin', fx.env)).status).toBe(404);
    // 仍是管理端点：匿名 401
    expect((await get('/api/admin/forced-auctions/preview?playerId=46', undefined, fx.env)).status).toBe(401);
  });

  it('v6.60.5 管理端支持 FC ID：预检/建单都认；自由身也可挂；强拍截止 X 挂 X+2', async () => {
    const fx = await seedAuction();
    // 生产口径：球员页给的是 fc_id（如 237383），平台 id 是另一套；管理端两种都收
    fx.sqlite.exec(`
      UPDATE players SET fc_id = 237383 WHERE id = 43;
      INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, fc_id)
      VALUES (59, 'fc59', '自由身甲', NULL, 'CM', 26, 80, 80, 'free', 990001);
    `);

    const preview = await get('/api/admin/forced-auctions/preview?playerId=237383', 'tok-admin', fx.env);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      reference: Record<string, unknown>;
      blockers: { message: string }[];
    };
    expect(previewBody.blockers).toEqual([]);
    expect(previewBody.reference).toMatchObject({ playerId: 43, fcId: 237383, playerName: '并列甲', clubName: '受罚队' });

    const created = await post('/api/admin/forced-auctions', { playerId: 237383 }, 'tok-admin', fx.env);
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { listingId: number; reference: Record<string, unknown> };
    expect(createdBody.reference).toMatchObject({ playerId: 43, fcId: 237383 });
    const listingId = createdBody.listingId;

    // 期限：强制拍卖 X 日挂牌、最早 X+2 日判定；普通挂牌仍是 X+1
    const ctx = await loadMarketContext(fx.env.DB);
    const row = sqlGet<{ listed_day: string; deadline_at: string | null; last_bid_at: string | null }>(
      fx.sqlite,
      'SELECT listed_day, deadline_at, last_bid_at FROM listings WHERE id = ?',
      listingId,
    );
    expect(row?.listed_day).toBeTruthy();
    const expected = bidDeadline({
      lastBidAt: null,
      listedDay: row!.listed_day,
      now: new Date(),
      deadlineHours: ctx.deadlineHours,
      silenceHours: ctx.silenceHours,
      calendar: ctx.calendar,
      minOffsetDays: 2,
    });
    const normal = bidDeadline({
      lastBidAt: null,
      listedDay: row!.listed_day,
      now: new Date(),
      deadlineHours: ctx.deadlineHours,
      silenceHours: ctx.silenceHours,
      calendar: ctx.calendar,
    });
    expect(row?.deadline_at).toBe(expected.deadlineAt);
    expect(expected.deadlineDay).not.toBe(normal.deadlineDay);

    // 出价后重新算截止：强制拍卖仍按 minOffset=2，不因竞价退回普通挂牌的 X+1
    expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 1 }, 'tok-coach2', fx.env)).status).toBe(201);
    const after = sqlGet<{ deadline_at: string | null; last_bid_at: string | null }>(
      fx.sqlite,
      'SELECT deadline_at, last_bid_at FROM listings WHERE id = ?',
      listingId,
    );
    const expectedAfter = bidDeadline({
      lastBidAt: after!.last_bid_at,
      listedDay: row!.listed_day,
      now: new Date(),
      deadlineHours: ctx.deadlineHours,
      silenceHours: ctx.silenceHours,
      calendar: ctx.calendar,
      minOffsetDays: 2,
    });
    const normalAfter = bidDeadline({
      lastBidAt: after!.last_bid_at,
      listedDay: row!.listed_day,
      now: new Date(),
      deadlineHours: ctx.deadlineHours,
      silenceHours: ctx.silenceHours,
      calendar: ctx.calendar,
    });
    expect(after?.deadline_at).toBe(expectedAfter.deadlineAt);
    expect(expectedAfter.deadlineAt).not.toBe(normalAfter.deadlineAt);

    // 自由身：也能挂；seller_club_id 留空，成交款没有收款人（completeTransfer 销毁）
    const freePreview = await get('/api/admin/forced-auctions/preview?playerId=990001', 'tok-admin', fx.env);
    expect(freePreview.status).toBe(200);
    const freePreviewBody = (await freePreview.json()) as {
      reference: Record<string, unknown>;
      blockers: { message: string }[];
    };
    expect(freePreviewBody.blockers).toEqual([]);
    expect(freePreviewBody.reference).toMatchObject({
      playerId: 59,
      fcId: 990001,
      playerName: '自由身甲',
      clubId: null,
      clubName: null,
      caRank: null,
      inTopSix: null,
      nonGkWithCa: 0,
    });

    const freeCreate = await post('/api/admin/forced-auctions', { playerId: 990001, askPrice: 3 }, 'tok-admin', fx.env);
    expect(freeCreate.status).toBe(201);
    const freeListingId = ((await freeCreate.json()) as { listingId: number }).listingId;
    expect(
      sqlGet<{ seller_club_id: number | null; type: string }>(
        fx.sqlite,
        'SELECT seller_club_id, type FROM listings WHERE id = ?',
        freeListingId,
      ),
    ).toEqual({ seller_club_id: null, type: 'forced' });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 59')?.status).toBe('listed');

    // 市场列表/详情：自由身挂牌照常出现，卖方展示为「自由身」
    const freeList = await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    const freeRow = ((await freeList.json()) as {
      listings: { id: number; sellerClub: { id: number | null; name: string } }[];
    }).listings.find((l) => l.id === freeListingId);
    expect(freeRow?.sellerClub).toEqual({ id: null, name: '自由身' });

    // 取消：球员回到 free（不是 normal），挂牌下架
    expect((await post(`/api/admin/forced-auctions/${freeListingId}/cancel`, {}, 'tok-admin', fx.env)).status).toBe(200);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', freeListingId)?.status).toBe('delisted');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 59')?.status).toBe('free');
  });

  it('v6.51.0 preview：CPU 队可强拍 / 已在流程里 —— 预检报原因，建单同一句 400', async () => {
    const fx = await seedAuction();
    fx.sqlite.exec(
      `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (131681, 'AC米兰(CPU)', 'premier', 'active', 1);
       INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (60, 'fc60', '米兰头牌', 131681, 'ST', 26, 95, 95, 'normal');`,
    );
    const cpuPreview = await get('/api/admin/forced-auctions/preview?playerId=60', 'tok-admin', fx.env);
    const cpuBody = (await cpuPreview.json()) as {
      blockers: { status: number; message: string }[];
      reference: { clubId: number | null; clubName: string | null };
    };
    expect(cpuBody.blockers).toEqual([]);
    expect(cpuBody.reference).toMatchObject({ clubId: 131681, clubName: 'AC米兰(CPU)' });

    // 已在挂牌流程里（player 45 先挂出）⇒ 预检与建单都挡住
    expect((await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env)).status).toBe(201);
    const busyPreview = await get('/api/admin/forced-auctions/preview?playerId=45', 'tok-admin', fx.env);
    const busyBody = (await busyPreview.json()) as { blockers: { status: number; message: string }[] };
    expect(busyBody.blockers).toHaveLength(1);
    expect(busyBody.blockers[0]).toMatchObject({ status: 400, message: '这名球员已经在挂牌流程里了' });
    const again = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe(busyBody.blockers[0].message);
  });

  it('v6.60.7：CPU 队球员可强拍，成交款销毁且 CPU 无流水，按成交价新签合同', async () => {
    const fx = await seedAuction();
    fx.sqlite.exec(
      `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (131681, 'AC米兰(CPU)', 'premier', 'active', 1);
       INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (60, 'fc60', '米兰头牌', 131681, 'ST', 26, 95, 95, 'normal');`,
    );
    const create = await post('/api/admin/forced-auctions', { playerId: 60, askPrice: 6 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    expect(
      sqlGet<{ seller_club_id: number | null }>(fx.sqlite, 'SELECT seller_club_id FROM listings WHERE id = ?', listingId),
    ).toEqual({ seller_club_id: 131681 });

    expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 6 }, 'tok-coach2', fx.env)).status).toBe(201);
    fx.sqlite.exec(
      `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                            listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = ${listingId}`,
    );
    await get('/api/market/listings?status=all', 'tok-coach2', fx.env);
    const transferRow = sqlGet<{ id: number; type: string; status: string; fee: number; from_club_id: number | null }>(
      fx.sqlite,
      'SELECT id, type, status, fee, from_club_id FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transferRow).toMatchObject({ type: 'forced_auction', status: 'pending_review', fee: 6, from_club_id: 131681 });

    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    // CPU 卖方没有平台合同可谈 RC，按成交价固定 F，直接谈工资
    const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
    const session = ((await mine.json()) as {
      sessions: { id: number; transferId: number; releaseFee: number | null; expectedWage: number | null }[];
    }).sessions.find((s) => s.transferId === transferRow!.id);
    expect(session).toMatchObject({ releaseFee: 6 });
    expect(session?.expectedWage).toBeGreaterThan(0);
    expect(
      (await post(`/api/negotiations/${session!.id}/offer`, { wage: session!.expectedWage }, 'tok-coach2', fx.env)).status,
    ).toBe(200);

    expect(
      sqlGet<{ status: string; tax: number; fee: number; from_club_id: number | null }>(
        fx.sqlite,
        'SELECT status, tax, fee, from_club_id FROM transfers WHERE id = ?',
        transferRow!.id,
      ),
    ).toMatchObject({ status: 'completed', tax: 0, fee: 6, from_club_id: 131681 });
    expect(
      sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE club_id = ${fx.buyer} AND kind = 'transfer_in'`)
        ?.amount,
    ).toBe(-6);
    // CPU 队一律不入账：没有卖方收入、没有税，也没有任何流水
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind IN ('transfer_out','transfer_tax')")?.n,
    ).toBe(0);
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM ledger_entries WHERE club_id = 131681')?.n).toBe(0);
    expect(sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 60')).toEqual({
      club_id: fx.buyer,
      status: 'normal',
    });
    expect(
      sqlGet<{ club_id: number; release_fee: number; is_active: number }>(
        fx.sqlite,
        'SELECT club_id, release_fee, is_active FROM contracts WHERE player_id = 60',
      ),
    ).toEqual({ club_id: fx.buyer, release_fee: 6, is_active: 1 });
  });

  it('v6.60.7：CPU 队强拍无人出价 → 不收下架费、不造解约单，球员留在 CPU 队', async () => {
    const fx = await seedAuction();
    fx.sqlite.exec(
      `INSERT INTO clubs (id, name, league_tier, status, is_cpu) VALUES (131681, 'AC米兰(CPU)', 'premier', 'active', 1);
       INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status) VALUES
         (60, 'fc60', '米兰头牌', 131681, 'ST', 26, 95, 95, 'normal');`,
    );
    const create = await post('/api/admin/forced-auctions', { playerId: 60, askPrice: 4 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    fx.sqlite.exec(`UPDATE listings SET deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') WHERE id = ${listingId}`);
    await get('/api/market/listings?status=all', 'tok-admin', fx.env);

    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', listingId)?.status).toBe('delisted');
    expect(sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 60')).toEqual({
      club_id: 131681,
      status: 'normal',
    });
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'delist_fee'")?.n).toBe(0);
    expect(
      sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM transfers WHERE idempotency_key = ?', `forced_no_bid:${listingId}`)?.n,
    ).toBe(0);
  });

  it('v6.51.0 挂牌价可指定：缺省 1m / 指定则落库并抬高首价门槛 / 两位小数 / 非正数 400', async () => {
    const fx = await seedAuction();
    const askPriceOf = (listingId: number) =>
      sqlGet<{ ask_price: number }>(fx.sqlite, 'SELECT ask_price FROM listings WHERE id = ?', listingId)?.ask_price;

    // 缺省 = 1m（4.4.5 原口径，老调用方不带 askPrice 行为不变）
    const dflt = await post('/api/admin/forced-auctions', { playerId: 46 }, 'tok-admin', fx.env);
    expect(dflt.status).toBe(201);
    const dfltBody = (await dflt.json()) as { listingId: number; askPrice: number };
    expect(dfltBody.askPrice).toBe(1);
    expect(askPriceOf(dfltBody.listingId)).toBe(1);
    expect((await post(`/api/admin/forced-auctions/${dfltBody.listingId}/cancel`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 指定 5m：落库 + 响应回报，且首价门槛同步抬高（4 被拒、5 通过）
    const five = await post('/api/admin/forced-auctions', { playerId: 41, askPrice: 5 }, 'tok-admin', fx.env);
    expect(five.status).toBe(201);
    const fiveBody = (await five.json()) as { listingId: number; askPrice: number };
    expect(fiveBody.askPrice).toBe(5);
    expect(askPriceOf(fiveBody.listingId)).toBe(5);
    const low = await post(`/api/market/listings/${fiveBody.listingId}/bids`, { amount: 4 }, 'tok-coach2', fx.env);
    expect(low.status).toBe(400);
    expect(((await low.json()) as { error: string }).error).toBe('首笔出价不得低于挂牌价 5 m');
    expect((await post(`/api/market/listings/${fiveBody.listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env)).status).toBe(201);
    expect((await post(`/api/admin/forced-auctions/${fiveBody.listingId}/cancel`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 两位小数（round2 沿普通挂牌价口径）
    const frac = await post('/api/admin/forced-auctions', { playerId: 42, askPrice: 3.456 }, 'tok-admin', fx.env);
    expect(frac.status).toBe(201);
    const fracBody = (await frac.json()) as { listingId: number; askPrice: number };
    expect(fracBody.askPrice).toBe(3.46);
    expect(askPriceOf(fracBody.listingId)).toBe(3.46);
    expect((await post(`/api/admin/forced-auctions/${fracBody.listingId}/cancel`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 下架费随挂牌价走（10% × 挂牌价）：6m 挂牌、窗尾无人出价 ⇒ 收 0.6m
    const six = await post('/api/admin/forced-auctions', { playerId: 44, askPrice: 6 }, 'tok-admin', fx.env);
    expect(six.status).toBe(201);
    const sixId = ((await six.json()) as { listingId: number }).listingId;
    fx.sqlite.exec(`UPDATE listings SET deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') WHERE id = ${sixId}`);
    await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', sixId)?.status).toBe('delisted');
    expect(
      sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND club_id = ${fx.club}`)?.amount,
    ).toBe(-0.6);

    // 非正数 / 非数字 ⇒ 400（与普通挂牌同文案），整单不落库
    for (const bad of [0, -1, 'abc']) {
      const res = await post('/api/admin/forced-auctions', { playerId: 43, askPrice: bad }, 'tok-admin', fx.env);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('挂牌价须为正数（单位 m）');
    }
    expect(sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM listings WHERE player_id = 43')?.n).toBe(0);
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 43')?.status).toBe('normal');
  });

  it('成交链：1m 挂牌 → 竞价 → 待审 → 批准进谈判 → 成约按整单 50% 税过户', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;

    expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env)).status).toBe(201);
    // 拨到过去触发截止（4.4.7 静默判定；deadline_at 清空 = 模拟落库列之前的存量行）
    fx.sqlite.exec(
      `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                            listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = ${listingId}`,
    );
    await get('/api/market/listings?status=all', 'tok-coach2', fx.env);
    const transferRow = sqlGet<{ id: number; type: string; status: string; fee: number }>(
      fx.sqlite,
      'SELECT id, type, status, fee FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transferRow).toMatchObject({ type: 'forced_auction', status: 'pending_review', fee: 5 });

    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    // 买方谈新 RC（卖方 RC20 → ±10 区间内取 15）
    const feeRes = await post(`/api/negotiations/${transferRow!.id}/release-fee`, { fee: 15 }, 'tok-coach2', fx.env);
    expect(feeRes.status).toBe(200);
    const e = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    expect((await post(`/api/negotiations/${transferRow!.id}/offer`, { wage: e }, 'tok-coach2', fx.env)).status).toBe(200);

    const done = sqlGet<{ status: string; tax: number; fee: number }>(
      fx.sqlite,
      'SELECT status, tax, fee FROM transfers WHERE id = ?',
      transferRow!.id,
    );
    expect(done).toMatchObject({ status: 'completed', tax: 2.5, fee: 5 }); // 整单 50%
    const buyerEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE club_id = ${fx.buyer} AND kind = 'transfer_in'`,
    );
    expect(buyerEntry?.amount).toBe(-5);
    const sellerEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE club_id = ${fx.club} AND kind = 'transfer_out'`,
    );
    expect(sellerEntry?.amount).toBe(5);
    const taxEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE club_id = ${fx.club} AND kind = 'transfer_tax'`,
    );
    expect(taxEntry?.amount).toBe(-2.5);
    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 45');
    expect(player).toEqual({ club_id: fx.buyer, status: 'normal' });
  });

  it('v6.24.1：创建即按 bidDeadline 首算落 deadline_at，列表回传落库列（与普通挂牌同轨）', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    const row = sqlGet<{ deadline_at: string | null }>(fx.sqlite, 'SELECT deadline_at FROM listings WHERE id = ?', listingId);
    expect(row?.deadline_at).not.toBeNull();
    const list = await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { listings: { id: number; deadlineAt: string | null }[] };
    // 回传的是落库列本身，不是实时另算的幻影
    expect(body.listings.find((r) => r.id === listingId)?.deadlineAt).toBe(row?.deadline_at);
  });

  it('v6.58.0：forced listed 到期无人出价 → 下架 + 10% 下架费，球员按解约处置变自由身且本窗不可捞', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    // 列优先口径：把落库截止拨到过去（模拟到期），不动 listed_day / last_bid_at
    fx.sqlite.exec(
      `UPDATE listings SET deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') WHERE id = ${listingId}`,
    );
    const list = await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    expect(list.status).toBe(200);
    expect(sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', listingId)).toMatchObject({
      status: 'delisted',
      deadline_note: '截止时刻无人出价',
    });
    // 解约处置：去归属变自由身 + 解约单留档（transfers 行是海捞禁签闸的事实来源）
    const released = sqlGet<{ status: string; club_id: number | null }>(fx.sqlite, 'SELECT status, club_id FROM players WHERE id = 45');
    expect(released).toMatchObject({ status: 'free', club_id: null });
    const term = sqlGet<{ id: number; status: string; season: number }>(
      fx.sqlite,
      `SELECT id, status, season FROM transfers WHERE idempotency_key = 'forced_no_bid:${listingId}'`,
    );
    expect(term).toMatchObject({ status: 'completed', season: 1 });
    expect(sqlGet<{ is_active: number }>(fx.sqlite, 'SELECT is_active FROM contracts WHERE player_id = 45 AND is_active = 1')).toBeUndefined();
    expect(
      sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND club_id = ${fx.club}`)?.amount,
    ).toBe(-0.1);
    // 本窗不可捞起：走真实端点整条守卫链（窗口 → 归属 → 状态 → 本窗禁签）
    const sign = await post('/api/transfers/free-agent', { playerId: 45, newReleaseFee: 10 }, 'tok-coach2', fx.env);
    expect(sign.status).toBe(409);
    expect(((await sign.json()) as { error: string }).error).toContain('本窗口被解约过');
    // 幂等：再次结算不改球员、不重复建解约单
    await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM transfers WHERE idempotency_key = 'forced_no_bid:" + listingId + "'")?.n).toBe(1);
  });

  it('v6.60.5：自由身强制拍卖到期无人出价 → 不收下架费、不建解约单，球员保持自由身', async () => {
    const fx = await seedAuction();
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, fc_id)
       VALUES (62, 'fc62', '自由身丙', NULL, 'CB', 27, 84, 84, 'free', 990003);`,
    );
    const create = await post('/api/admin/forced-auctions', { playerId: 990003, askPrice: 4 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    fx.sqlite.exec(`UPDATE listings SET deadline_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour') WHERE id = ${listingId}`);
    await get('/api/market/listings?status=all', 'tok-admin', fx.env);

    expect(sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', listingId)).toMatchObject({
      status: 'delisted',
      deadline_note: '截止时刻无人出价',
    });
    expect(sqlGet<{ status: string; club_id: number | null }>(fx.sqlite, 'SELECT status, club_id FROM players WHERE id = 62')).toEqual({
      status: 'free',
      club_id: null,
    });
    // 无卖方可收下架费；无现行合同可解，不造 forced_no_bid 解约单
    expect(sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'delist_fee'")?.n).toBe(0);
    expect(
      sqlGet<{ n: number }>(fx.sqlite, 'SELECT COUNT(*) AS n FROM transfers WHERE idempotency_key = ?', `forced_no_bid:${listingId}`)?.n,
    ).toBe(0);
  });

  it('窗尾无人出价 → 下架收 10% 挂牌费（0.1m），球员同样按解约下海（v6.58.0）', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    // 关窗触发窗尾收口
    fx.sqlite.exec(`UPDATE season_windows SET status = 'closed' WHERE season = 1 AND window_seq = 1`);
    await get('/api/market/listings?status=all', 'tok-admin', fx.env);
    const listing = sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', ((await create.json()) as { listingId: number }).listingId);
    expect(listing?.status).toBe('delisted');
    // 窗尾收口同样按解约处置（无人出价的强制拍卖没有「留队」出口）
    expect(sqlGet<{ status: string; club_id: number | null }>(fx.sqlite, 'SELECT status, club_id FROM players WHERE id = 45')).toMatchObject({
      status: 'free',
      club_id: null,
    });
    const feeEntry = sqlGet<{ amount: number }>(
      fx.sqlite,
      `SELECT amount FROM ledger_entries WHERE kind = 'delist_fee' AND club_id = ${fx.club}`,
    );
    expect(feeEntry?.amount).toBe(-0.1);
  });

  it('v6.60.2：取消强制拍卖要求球员仍有归属，无归属时 409 且不改球员状态', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    // 模拟 bypass 解约：球员去归属变自由身，拍卖单还挂在市场里
    fx.sqlite.exec(`UPDATE players SET club_id = NULL, status = 'free' WHERE id = 45`);

    const res = await post(`/api/admin/forced-auctions/${listingId}/cancel`, {}, 'tok-admin', fx.env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('球员已无归属或已不在原俱乐部');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', listingId)?.status).toBe('listed');
    expect(sqlGet<{ status: string; club_id: number | null }>(fx.sqlite, 'SELECT status, club_id FROM players WHERE id = 45')).toEqual({
      status: 'free',
      club_id: null,
    });
  });

  it('v6.60.2：无归属球员强制拍卖成交，买方付钱但卖方无入账（成交款销毁）', async () => {
    const fx = await seedAuction();
    const create = await post('/api/admin/forced-auctions', { playerId: 45 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env)).status).toBe(201);

    // 模拟 bypass 解约：球员已无归属，但合同行还在（谈判/成约要读现行 RC）
    fx.sqlite.exec(`UPDATE players SET club_id = NULL, status = 'free' WHERE id = 45`);
    fx.sqlite.exec(
      `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                            listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = ${listingId}`,
    );
    await get('/api/market/listings?status=all', 'tok-coach2', fx.env);

    const transferRow = sqlGet<{ id: number; type: string; status: string; fee: number; from_club_id: number | null }>(
      fx.sqlite,
      'SELECT id, type, status, fee, from_club_id FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transferRow).toMatchObject({ type: 'forced_auction', status: 'pending_review', fee: 5, from_club_id: null });

    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);
    const feeRes = await post(`/api/negotiations/${transferRow!.id}/release-fee`, { fee: 15 }, 'tok-coach2', fx.env);
    expect(feeRes.status).toBe(200);
    const e = ((await feeRes.json()) as { expectedWage: number }).expectedWage;
    expect((await post(`/api/negotiations/${transferRow!.id}/offer`, { wage: e }, 'tok-coach2', fx.env)).status).toBe(200);

    expect(
      sqlGet<{ status: string; tax: number; fee: number; from_club_id: number | null }>(
        fx.sqlite,
        'SELECT status, tax, fee, from_club_id FROM transfers WHERE id = ?',
        transferRow!.id,
      ),
    ).toMatchObject({ status: 'completed', tax: 0, fee: 5, from_club_id: null });
    // 买方照付，卖方没有任何 transfer_out / transfer_tax 入账
    expect(
      sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE club_id = ${fx.buyer} AND kind = 'transfer_in'`)
        ?.amount,
    ).toBe(-5);
    expect(
      sqlGet<{ n: number }>(
        fx.sqlite,
        `SELECT COUNT(*) AS n FROM ledger_entries WHERE club_id = ${fx.club} AND kind IN ('transfer_out','transfer_tax')`,
      )?.n,
    ).toBe(0);
    expect(sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 45')).toEqual({
      club_id: fx.buyer,
      status: 'normal',
    });
    expect(
      sqlGet<{ club_id: number; is_active: number }>(
        fx.sqlite,
        'SELECT club_id, is_active FROM contracts WHERE player_id = 45',
      ),
    ).toEqual({ club_id: fx.buyer, is_active: 1 });
  });

  it('v6.60.5：自由身强制拍卖成交，买方付款、卖方无收款人（成交款销毁），按成交价新签合同', async () => {
    const fx = await seedAuction();
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, status, fc_id)
       VALUES (61, 'fc61', '自由身乙', NULL, 'ST', 26, 88, 88, 'free', 990002);`,
    );

    const create = await post('/api/admin/forced-auctions', { playerId: 990002, askPrice: 5 }, 'tok-admin', fx.env);
    expect(create.status).toBe(201);
    const listingId = ((await create.json()) as { listingId: number }).listingId;
    expect(
      sqlGet<{ seller_club_id: number | null; ask_price: number }>(
        fx.sqlite,
        'SELECT seller_club_id, ask_price FROM listings WHERE id = ?',
        listingId,
      ),
    ).toEqual({ seller_club_id: null, ask_price: 5 });
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 61')?.status).toBe('listed');

    expect((await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env)).status).toBe(201);
    fx.sqlite.exec(
      `UPDATE listings SET last_bid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-11 days'),
                            listed_day = strftime('%Y-%m-%d', 'now', '-12 days'), deadline_at = NULL WHERE id = ${listingId}`,
    );
    await get('/api/market/listings?status=all', 'tok-coach2', fx.env);

    const transferRow = sqlGet<{ id: number; type: string; status: string; fee: number; from_club_id: number | null }>(
      fx.sqlite,
      'SELECT id, type, status, fee, from_club_id FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transferRow).toMatchObject({ type: 'forced_auction', status: 'pending_review', fee: 5, from_club_id: null });

    const taskId = await openReviewTaskId(fx);
    expect((await post(`/api/admin/reviews/${taskId}/approve`, {}, 'tok-admin', fx.env)).status).toBe(200);

    // 自由身没有现行合同：开会时按成交价固定 F（没有 release-fee 第一步），直接谈工资
    const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
    const session = ((await mine.json()) as {
      sessions: { id: number; transferId: number; releaseFee: number | null; expectedWage: number | null }[];
    }).sessions.find((s) => s.transferId === transferRow!.id);
    expect(session).toMatchObject({ releaseFee: 5 });
    expect(session?.expectedWage).toBeGreaterThan(0);
    expect(
      (await post(`/api/negotiations/${session!.id}/offer`, { wage: session!.expectedWage }, 'tok-coach2', fx.env)).status,
    ).toBe(200);

    expect(
      sqlGet<{ status: string; tax: number; fee: number; from_club_id: number | null }>(
        fx.sqlite,
        'SELECT status, tax, fee, from_club_id FROM transfers WHERE id = ?',
        transferRow!.id,
      ),
    ).toMatchObject({ status: 'completed', tax: 0, fee: 5, from_club_id: null });
    // 买方照付；全场没有任何卖方入账（成交款销毁）
    expect(
      sqlGet<{ amount: number }>(fx.sqlite, `SELECT amount FROM ledger_entries WHERE club_id = ${fx.buyer} AND kind = 'transfer_in'`)
        ?.amount,
    ).toBe(-5);
    expect(
      sqlGet<{ n: number }>(fx.sqlite, "SELECT COUNT(*) AS n FROM ledger_entries WHERE kind IN ('transfer_out','transfer_tax')")?.n,
    ).toBe(0);
    expect(sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 61')).toEqual({
      club_id: fx.buyer,
      status: 'normal',
    });
    expect(
      sqlGet<{ club_id: number; release_fee: number; is_active: number }>(
        fx.sqlite,
        'SELECT club_id, release_fee, is_active FROM contracts WHERE player_id = 61',
      ),
    ).toEqual({ club_id: fx.buyer, release_fee: 5, is_active: 1 });
  });
});
