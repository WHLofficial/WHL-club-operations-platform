// 激活转会切片测试（规则 4.4.2 + §6.2 激活假设口径）：训练营球员激活挂牌、
// 5 分钟首价窗、失效作废、一窗一次、成交过户（税/状态还原）与驳回还原。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { app } from '../src/worker/index.ts';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, sqlGet, sqlAll, attachAuthChannel, authRegisterClubTeam } from './d1.ts';
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
       (3, '教练丙', 'coach', 0, 0),
       (4, '教练丁', 'coach', 0, 0);`,
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
    [4, 'tok-coach3'],
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
  const res = await post('/api/admin/clubs', { name, leagueTier: 'premier', gameTeamId: clubSeq }, 'tok-admin', fx.env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { club: { id: number } }).club.id;
}

interface ActivationFixture extends Fixture {
  ownerClub: number;
  buyerClub: number;
  rivalClub: number;
  traineeId: number;
}

// 拥有训练营的球队（100m）+ 激活方（50m）+ 抬价第三队（30m）+ 开放窗口；训练营球员固定合同 0.75/5m（4.3.4）
async function seedTrainee(fx: Fixture): Promise<ActivationFixture> {
  const ownerClub = await createClub(fx, '青训营');
  const buyerClub = await createClub(fx, '激活队');
  const rivalClub = await createClub(fx, '抬价队');
  const auth = attachAuthChannel(fx.env);
  for (const [clubId, token] of [
    [ownerClub, 'tok-coach'],
    [buyerClub, 'tok-coach2'],
    [rivalClub, 'tok-coach3'],
  ] as const) {
    authRegisterClubTeam(auth, clubId, clubId, `队${clubId}`);
    const res = await post(`/api/admin/clubs/${clubId}/bindcode`, {}, 'tok-admin', fx.env);
    const code = ((await res.json()) as { code: string }).code;
    const bind = await post('/api/clubs/bind', { code }, token, fx.env);
    expect(bind.status).toBe(201);
  }
  fx.sqlite.exec(
    `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES
       (${ownerClub}, 100, '2026-07-01T00:00:00Z'), (${buyerClub}, 50, '2026-07-01T00:00:00Z'), (${rivalClub}, 30, '2026-07-01T00:00:00Z');
     INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at) VALUES
       (${ownerClub}, 'opening_import', 100, 100, '期初', '2026-07-01T00:00:00Z'),
       (${buyerClub}, 'opening_import', 50, 50, '期初', '2026-07-01T00:00:00Z'),
       (${rivalClub}, 'opening_import', 30, 30, '期初', '2026-07-01T00:00:00Z');
     INSERT INTO seasons (season, status) VALUES (1, 'running');
     INSERT INTO season_windows (season, window_seq, status, opened_at) VALUES (1, 1, 'open', '2026-07-01T00:00:00Z');
     INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
       (20, 'fc20', '小将', ${ownerClub}, 'ST', 18, 68, 86, 15, 'trainee');
     INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
       (1, 20, ${ownerClub}, 5, 0.75, 'trainee', 1, '2026-06-01');`,
  );
  return { ...fx, ownerClub, buyerClub, rivalClub, traineeId: 20 };
}

async function activateTrainee(fx: Fixture): Promise<{ status: number; body: { ok?: boolean; listingId?: number; askPrice?: number; firstBidDeadline?: string; error?: string } }> {
  const res = await post('/api/market/activations', { playerId: 20 }, 'tok-coach2', fx.env);
  return { status: res.status, body: (await res.json()) as { ok?: boolean; listingId?: number; askPrice?: number; firstBidDeadline?: string; error?: string } };
}

// 把激活出价窗拨到过去并触发一次惰性结算
async function expireActivationWindow(fx: Fixture, listingId: number): Promise<void> {
  fx.sqlite.exec(`UPDATE listings SET activation_deadline = '2026-07-01T00:00:00.000Z' WHERE id = ${listingId}`);
  const res = await get('/api/market/listings', undefined, fx.env);
  expect(res.status).toBe(200);
  await res.json();
}

describe('激活转会（规则 4.4.2：训练营球员唯一流动出口）', () => {
  it('激活挂牌走通：固定 5m、记激活方与出价窗、球员转挂牌态', async () => {
    const fx = await seedTrainee(freshEnv());

    // 激活前：可激活名单能看到这名训练营球员
    const before = await get('/api/market/trainees', 'tok-coach2', fx.env);
    const beforeRows = ((await before.json()) as { trainees: { id: number; activationFee: number; activatedThisWindow: boolean; club: { name: string } }[] }).trainees;
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0]).toMatchObject({ id: 20, activationFee: 5, activatedThisWindow: false, club: { name: '青训营' } });

    const { status, body } = await activateTrainee(fx);
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.askPrice).toBe(5);
    expect(body.firstBidDeadline).toBeTruthy();

    const listing = sqlGet<{ type: string; ask_price: number; status: string; activated_by: number; seller_club_id: number; activation_deadline: string | null }>(
      fx.sqlite,
      'SELECT type, ask_price, status, activated_by, seller_club_id, activation_deadline FROM listings WHERE id = ?',
      body.listingId!,
    );
    expect(listing).toMatchObject({ type: 'activation', ask_price: 5, status: 'listed', activated_by: fx.buyerClub, seller_club_id: fx.ownerClub });
    expect(listing!.activation_deadline).not.toBeNull();

    const player = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 20');
    expect(player!.status).toBe('listed');

    // 激活后：球员已在挂牌流程，不再出现在训练营可激活名单里
    const list = await get('/api/market/trainees', 'tok-coach2', fx.env);
    const trainees = ((await list.json()) as { trainees: { id: number }[] }).trainees;
    expect(trainees).toHaveLength(0);
  });

  it('自己队的球员不可激活；无合同的训练营球员不可激活；正式球员现在可按倍数价激活', async () => {
    const fx = await seedTrainee(freshEnv());
    const own = await post('/api/market/activations', { playerId: 20 }, 'tok-coach', fx.env);
    expect(own.status).toBe(400);

    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
         (21, 'fc21', '成年队', ${fx.ownerClub}, 'CM', 27, 82, 82, 25, 'normal');
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
         (2, 21, ${fx.ownerClub}, 20, 2, 'formal', 1, '2026-06-01');
       INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
         (22, 'fc22', '没合同', ${fx.ownerClub}, 'GK', 19, 60, 80, 8, 'trainee');`,
    );
    const noContract = await post('/api/market/activations', { playerId: 22 }, 'tok-coach2', fx.env);
    expect(noContract.status).toBe(400);
    // §6.2：正式球员同样可被激活（无 signed_at/protected_until 记录 → 保护期外 1 倍价 20m）
    const formal = await post('/api/market/activations', { playerId: 21 }, 'tok-coach2', fx.env);
    expect(formal.status).toBe(201);
    expect(((await formal.json()) as { askPrice: number }).askPrice).toBe(20);
  });

  it('本窗口刚签约（效力起点在窗口开启后）不可被激活', async () => {
    const fx = await seedTrainee(freshEnv());
    fx.sqlite.exec(`UPDATE contracts SET effective_from = '2026-07-05' WHERE player_id = 20`);
    const { status } = await activateTrainee(fx);
    expect(status).toBe(409);
  });

  it('激活方可支配资金不足 5m 时直接拒绝', async () => {
    const fx = await seedTrainee(freshEnv());
    fx.sqlite.exec(`UPDATE ledger_accounts SET balance = 3 WHERE club_id = ${fx.buyerClub}`);
    const { status, body } = await activateTrainee(fx);
    expect(status).toBe(400);
    expect((body as { error?: string }).error).toContain('可用资金不足');
  });

  it('出价窗内他队出价无效，激活方首价必须恰好 5m，落价即收口进待审（训练营无匹配）', async () => {
    const fx = await seedTrainee(freshEnv());
    const { body } = await activateTrainee(fx);
    const listingId = body.listingId!;

    const foreign = await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach', fx.env);
    expect(foreign.status).toBe(403);

    const overpay = await post(`/api/market/listings/${listingId}/bids`, { amount: 6 }, 'tok-coach2', fx.env);
    expect(overpay.status).toBe(400);
    expect(((await overpay.json()) as { error: string }).error).toContain('固定为 5 m');

    const ok = await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env);
    expect(ok.status).toBe(201);

    // 首价落定：训练营合同无匹配可言，直接收口进待审（transfer + 审核任务），出价窗清空
    const after = sqlGet<{ status: string; activation_deadline: string | null }>(
      fx.sqlite,
      'SELECT status, activation_deadline FROM listings WHERE id = ?',
      listingId,
    );
    expect(after).toEqual({ status: 'pending_review', activation_deadline: null });
    const transfer = sqlGet<{ type: string; status: string; fee: number; to_club_id: number }>(
      fx.sqlite,
      'SELECT type, status, fee, to_club_id FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transfer).toMatchObject({ type: 'activation', status: 'pending_review', fee: 5, to_club_id: fx.buyerClub });
    const hold = sqlGet<{ amount: number; status: string }>(
      fx.sqlite,
      `SELECT amount, status FROM fund_holds WHERE club_id = ? AND ref_type = 'listing' AND ref_id = ? AND status = 'held'`,
      fx.buyerClub,
      listingId,
    );
    expect(hold).toEqual({ amount: 5, status: 'held' });

    // 激活挂牌不开放后续竞价（首价即成交价）
    const outbid = await post(`/api/market/listings/${listingId}/bids`, { amount: 6 }, 'tok-coach3', fx.env);
    expect(outbid.status).toBe(409);
  });

  it('出价窗过了激活方没落价 → 激活无效：下架不收费、球员还原训练营态', async () => {
    const fx = await seedTrainee(freshEnv());
    const { body } = await activateTrainee(fx);
    await expireActivationWindow(fx, body.listingId!);

    const listing = sqlGet<{ status: string; deadline_note: string }>(fx.sqlite, 'SELECT status, deadline_note FROM listings WHERE id = ?', body.listingId!);
    expect(listing!.status).toBe('delisted');
    expect(listing!.deadline_note).toContain('激活无效');
    const player = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 20');
    expect(player!.status).toBe('trainee');

    const fees = sqlAll(fx.sqlite, `SELECT kind FROM ledger_entries WHERE kind = 'delist_fee' AND ref_id = ${body.listingId!}`);
    expect(fees).toHaveLength(0); // 卖家没挂牌，不收下架费
  });

  it('正式球员激活失效 → 还原一线队态（不得错标训练营）', async () => {
    const fx = await seedTrainee(freshEnv());
    fx.sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, position, age, ca, pa, market_value, status) VALUES
         (21, 'fc21', '成年队', ${fx.ownerClub}, 'CM', 27, 82, 82, 25, 'normal');
       INSERT INTO contracts (id, player_id, club_id, release_fee, wage, contract_type, is_active, effective_from) VALUES
         (2, 21, ${fx.ownerClub}, 20, 2, 'formal', 1, '2026-06-01');`,
    );
    const formal = await post('/api/market/activations', { playerId: 21 }, 'tok-coach2', fx.env);
    expect(formal.status).toBe(201);
    const { listingId } = (await formal.json()) as { listingId: number };
    await expireActivationWindow(fx, listingId);

    const listing = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM listings WHERE id = ?', listingId);
    expect(listing!.status).toBe('delisted');
    const player = sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM players WHERE id = 21');
    expect(player!.status).toBe('normal');
  });

  it('一窗一次（4.4.2.1）：失效激活也占额', async () => {
    const fx = await seedTrainee(freshEnv());
    const first = await activateTrainee(fx);
    expect(first.status).toBe(201);
    await expireActivationWindow(fx, first.body.listingId!);

    // 失效后球员回到训练营名单，但本窗口额度已消耗
    const list = await get('/api/market/trainees', 'tok-coach2', fx.env);
    const rows = ((await list.json()) as { trainees: { id: number; activatedThisWindow: boolean }[] }).trainees;
    expect(rows).toHaveLength(1);
    expect(rows[0].activatedThisWindow).toBe(true);

    const second = await activateTrainee(fx);
    expect(second.status).toBe(409);
    expect((second.body as { error?: string }).error).toContain('本窗口已经被激活过');
  });

  it('激活成交全链：批准进谈判、直签训练营过户、训练营态保留、税 10%', async () => {
    const fx = await seedTrainee(freshEnv());
    const { body } = await activateTrainee(fx);
    const listingId = body.listingId!;
    const bid = await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env);
    expect(bid.status).toBe(201);

    // 拨回静默时段触发截止判定
    fx.sqlite.exec(`UPDATE listings SET listed_day = '2026-07-01', last_bid_at = '2026-07-02T18:00:00.000Z' WHERE id = ${listingId}`);
    const settleRes = await get('/api/market/listings', undefined, fx.env);
    await settleRes.json();

    const transfer = sqlGet<{ id: number; type: string; status: string; to_club_id: number; fee: number }>(
      fx.sqlite,
      'SELECT id, type, status, to_club_id, fee FROM transfers WHERE idempotency_key = ?',
      `listing:${listingId}`,
    );
    expect(transfer).toMatchObject({ type: 'activation', status: 'pending_review', to_club_id: fx.buyerClub, fee: 5 });

    const task = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM review_tasks WHERE ref_id = ? AND status = ' + "'open'", transfer!.id);
    // 激活成交与普通成交一样走谈判（需求方裁决 2026-09）
    const approve = await post(`/api/admin/reviews/${task!.id}/approve`, { note: '激活成交确认' }, 'tok-admin', fx.env);
    expect(approve.status).toBe(200);
    expect(((await approve.json()) as { status: string }).status).toBe('signing');
    expect(sqlGet<{ status: string }>(fx.sqlite, 'SELECT status FROM transfers WHERE id = ?', transfer!.id)?.status).toBe('signing');

    // 会话分配给买方；卖方不可操作
    const mine = await get('/api/negotiations?mine=1', 'tok-coach2', fx.env);
    const session = ((await mine.json()) as { sessions: { id: number; status: string }[] }).sessions[0];
    expect(session.status).toBe('active');
    expect((await post(`/api/negotiations/${session.id}/trainee`, {}, 'tok-coach', fx.env)).status).toBe(403);

    // 买方直签训练营合同（双固定，不占下放名额）
    const trainee = await post(`/api/negotiations/${session.id}/trainee`, {}, 'tok-coach2', fx.env);
    expect(trainee.status).toBe(200);
    expect(((await trainee.json()) as { result: string; wage: number; message: string })).toMatchObject({ result: 'trainee', wage: 0.75 });

    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 20');
    expect(player).toEqual({ club_id: fx.buyerClub, status: 'trainee' });
    const contract = sqlGet<{ club_id: number; contract_type: string; wage: number; release_fee: number; source: string }>(
      fx.sqlite,
      'SELECT club_id, contract_type, wage, release_fee, source FROM contracts WHERE player_id = 20 AND is_active = 1',
    );
    expect(contract).toEqual({ club_id: fx.buyerClub, contract_type: 'trainee', wage: 0.75, release_fee: 5, source: 'trainee' });

    const balances = sqlAll<{ club_id: number; balance: number }>(
      fx.sqlite,
      `SELECT club_id, balance FROM ledger_accounts WHERE club_id IN (${fx.ownerClub}, ${fx.buyerClub}) ORDER BY club_id`,
    );
    expect(balances).toEqual([
      { club_id: fx.ownerClub, balance: 104.5 }, // +5 成交 −0.5 税
      { club_id: fx.buyerClub, balance: 45 }, // −5 成交价
    ]);
    const entries = sqlAll<{ club_id: number; kind: number | string; amount: number; ref_type: string }>(
      fx.sqlite,
      `SELECT club_id, kind, amount, ref_type FROM ledger_entries WHERE ref_type = 'transfer' AND ref_id = ${transfer!.id} ORDER BY id`,
    );
    expect(entries.map((e) => [e.club_id, e.kind, e.amount])).toEqual([
      [fx.buyerClub, 'transfer_in', -5],
      [fx.ownerClub, 'transfer_out', 5],
      [fx.ownerClub, 'transfer_tax', -0.5],
    ]);

    const bidRow = sqlGet<{ status: string }>(fx.sqlite, `SELECT status FROM bids WHERE listing_id = ${listingId} AND status = 'won'`);
    expect(bidRow).not.toBeUndefined();
  });

  it('驳回：冻结解冻、球员还原训练营态、不收下架费', async () => {
    const fx = await seedTrainee(freshEnv());
    const { body } = await activateTrainee(fx);
    const listingId = body.listingId!;
    await post(`/api/market/listings/${listingId}/bids`, { amount: 5 }, 'tok-coach2', fx.env);
    fx.sqlite.exec(`UPDATE listings SET listed_day = '2026-07-01', last_bid_at = '2026-07-02T18:00:00.000Z' WHERE id = ${listingId}`);
    const settleRes = await get('/api/market/listings', undefined, fx.env);
    await settleRes.json();

    const transfer = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM transfers WHERE idempotency_key = ?', `listing:${listingId}`);
    const task = sqlGet<{ id: number }>(fx.sqlite, 'SELECT id FROM review_tasks WHERE ref_id = ? AND status = ' + "'open'", transfer!.id);
    const reject = await post(`/api/admin/reviews/${task!.id}/reject`, { note: '激活程序存疑' }, 'tok-admin', fx.env);
    expect(reject.status).toBe(200);

    const player = sqlGet<{ club_id: number; status: string }>(fx.sqlite, 'SELECT club_id, status FROM players WHERE id = 20');
    expect(player).toEqual({ club_id: fx.ownerClub, status: 'trainee' });
    const hold = sqlGet<{ status: string }>(fx.sqlite, `SELECT status FROM fund_holds WHERE club_id = ${fx.buyerClub} AND ref_id = ${listingId}`);
    expect(hold!.status).toBe('released');
    const fees = sqlAll(fx.sqlite, `SELECT kind FROM ledger_entries WHERE kind = 'delist_fee' AND ref_id = ${listingId}`);
    expect(fees).toHaveLength(0);
  });

  it('普通挂牌对训练营球员的入口保持关闭', async () => {
    const fx = await seedTrainee(freshEnv());
    const res = await post('/api/market/listings', { playerId: 20, askPrice: 5 }, 'tok-coach', fx.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('训练营球员不挂牌');
  });
});
