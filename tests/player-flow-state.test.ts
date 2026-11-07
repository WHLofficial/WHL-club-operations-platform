// 球员在途状态读模型（v6.80.0）：flowState 三 kind / seaVerdicts 七关链 / ensureNotInFlight 三档。
// 判级 patch 的表驱动锁：七关与三档文案逐字、谓词双形态并存（计划裁决 8「宁可带兜底」）、
// 98 分片跨片合并不丢不串；TC-LK-02 批内查询计数锁（=5，含无 bind 的 cpuIds）；TC-RET-01/02/03
// 源码锁（bypass 无转发导出 / 协议注释清零 / 全 src import 收口 + ACTIVE_SESSION_SQL 不复制）。
// 端点级用例（sea-lookup TC-LK-01 金样）在 tests/market-intel.test.ts，蓝图见
// docs/test-plans/v6.80.0-player-flow-state.md。
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb } from './d1.ts';
import { HttpError } from '../src/lib/http.ts';
import { ensureNotInFlight, flowState, seaVerdicts, type SeaSignVerdict } from '../src/worker/player-flow-state.ts';

const S4W1 = { season: 4, windowSeq: 1 };
const AT = '2026-07-02T00:00:00Z';

const CPU_CLUB = 901;
const CLUB_B = 902;

function fixture() {
  return createTestDb();
}

function seedClub(sqlite: DatabaseSync, id: number, name: string, isCpu = false) {
  sqlite.prepare('INSERT INTO clubs (id, name, is_cpu) VALUES (?, ?, ?)').run(id, name, isCpu ? 1 : 0);
}

function seedPlayer(sqlite: DatabaseSync, id: number, opts: { clubId?: number | null; status?: string } = {}) {
  sqlite
    .prepare('INSERT INTO players (id, uid, name, club_id, status) VALUES (?, ?, ?, ?, ?)')
    .run(id, `p${id}`, `球员${id}`, opts.clubId ?? null, opts.status ?? 'normal');
}

function seedListing(sqlite: DatabaseSync, id: number, playerId: number, status: string) {
  sqlite
    .prepare(
      `INSERT INTO listings (id, player_id, seller_club_id, type, ask_price, status, listed_at)
       VALUES (?, ?, NULL, 'normal', 5, ?, ?)`,
    )
    .run(id, playerId, status, AT);
}

function seedTransfer(
  sqlite: DatabaseSync,
  id: number,
  playerId: number,
  opts: { type?: string; status: string; season?: number; windowSeq?: number },
) {
  sqlite
    .prepare(
      `INSERT INTO transfers (id, type, player_id, from_club_id, to_club_id, fee, status, season, window_seq, created_at)
       VALUES (?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?)`,
    )
    .run(id, opts.type ?? 'transfer', playerId, opts.status, opts.season ?? S4W1.season, opts.windowSeq ?? S4W1.windowSeq, AT);
}

function seedSession(sqlite: DatabaseSync, id: number, playerId: number, transferId: number | null, status = 'active') {
  sqlite
    .prepare(
      `INSERT INTO negotiation_sessions (id, transfer_id, player_id, club_id, expected_wage, status, created_at)
       VALUES (?, ?, ?, 1, 5, ?, ?)`,
    )
    .run(id, transferId, playerId, status, AT);
}

// 语句计数包装：记每条 prepare 的 SQL 与 bind 参数个数（tests/d1.ts:50 暴露 sqlText 的同型先例）。
// prepare 时即计数——无 bind 参数的查询（如 cpuClubIds 的 prepare(SQL).all()）也必须计入，
// 否则 seaVerdicts 批内 5 条只数到 4（评审第 1 轮条 2）。
function counting(db: D1Database) {
  const calls: { sql: string; binds: number }[] = [];
  const wrapped = {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      const call = { sql, binds: 0 };
      calls.push(call);
      return {
        sqlText: sql,
        bind(...args: unknown[]) {
          call.binds = args.length;
          return stmt.bind(...(args as never[]));
        },
        first: stmt.first.bind(stmt),
        all: stmt.all.bind(stmt),
        run: stmt.run.bind(stmt),
      };
    },
    batch: db.batch.bind(db),
  } as unknown as D1Database;
  return { db: wrapped, calls };
}

// 七关文案单处定义（逐字锁：模块侧任何一关改动一个字符这里就红）
const VERDICT_BY_STAGE: Record<SeaSignVerdict['stage'], SeaSignVerdict> = {
  window: { stage: 'window', ok: false, status: 409, reason: '转会窗口没开，现在不能海捞', errCode: 'no_window' },
  ownership: { stage: 'ownership', ok: false, status: 400, reason: '海捞只能签无归属的球员（这名球员有东家）' },
  status: { stage: 'status', ok: false, status: 400, reason: '当前状态不能海捞' },
  banned: { stage: 'banned', ok: false, status: 409, reason: '这名球员本窗口被解约过，本窗口所有球队都不能签他' },
  listing: { stage: 'listing', ok: false, status: 400, reason: '这名球员已经有一单在市场流程里了，等它结束再操作' },
  pending: { stage: 'pending', ok: false, status: 400, reason: '这名球员有一张单据正在等管理组审核，先等审核结果' },
  signing: {
    stage: 'signing',
    ok: false,
    status: 400,
    reason: '这名球员的海捞单已经进入签约谈判，等它成约或作废再操作',
    errCode: 'sea_signing',
  },
  ok: { stage: 'ok', ok: true, status: 200, reason: '' },
};

interface MatrixRow {
  id: number;
  label: string;
  clubId: number | null;
  status: string;
  stage: SeaSignVerdict['stage'];
  /** 只踩本关、不踩更早关的附加数据形状 */
  extra?: 'term-this' | 'term-last' | 'listing' | 'pending' | 'completed+session' | 'signing-doc' | 'rejected';
}

/** 十二名球员覆盖七关每一关与三个不误伤形状（tests/market-intel.test.ts seedLookupMatrix 同思路、自建） */
const MATRIX: MatrixRow[] = [
  { id: 601, label: 'P1 自由身', clubId: null, status: 'free', stage: 'ok' },
  { id: 602, label: 'P2 CPU 队', clubId: CPU_CLUB, status: 'normal', stage: 'ok' },
  { id: 603, label: 'P3 有东家', clubId: CLUB_B, status: 'normal', stage: 'ownership' },
  { id: 604, label: 'P4 退役', clubId: null, status: 'retired', stage: 'status' },
  { id: 605, label: 'P5 挂牌态', clubId: null, status: 'listed', stage: 'status' },
  { id: 606, label: 'P6 本窗解约', clubId: null, status: 'free', stage: 'banned', extra: 'term-this' },
  { id: 607, label: 'P7 上窗解约', clubId: null, status: 'free', stage: 'ok', extra: 'term-last' },
  { id: 608, label: 'P8 在途挂牌', clubId: null, status: 'free', stage: 'listing', extra: 'listing' },
  { id: 609, label: 'P9 审核在途', clubId: null, status: 'free', stage: 'pending', extra: 'pending' },
  { id: 610, label: 'P10 会话在途', clubId: null, status: 'free', stage: 'signing', extra: 'completed+session' },
  { id: 611, label: 'P11 signing 残留', clubId: null, status: 'free', stage: 'signing', extra: 'signing-doc' },
  { id: 612, label: 'P12 单据已废', clubId: null, status: 'free', stage: 'ok', extra: 'rejected' },
];

let seedSeq = 0;
function seedMatrix(sqlite: DatabaseSync) {
  seedSeq = 0;
  seedClub(sqlite, CPU_CLUB, '曼城(CPU)', true);
  seedClub(sqlite, CLUB_B, '乙队');
  for (const row of MATRIX) {
    seedPlayer(sqlite, row.id, { clubId: row.clubId, status: row.status });
    const nid = () => ++seedSeq + 6000;
    switch (row.extra) {
      case 'term-this':
        seedTransfer(sqlite, nid(), row.id, { type: 'termination', status: 'completed' });
        break;
      case 'term-last':
        seedTransfer(sqlite, nid(), row.id, { type: 'termination', status: 'completed', windowSeq: 2 });
        break;
      case 'listing':
        seedListing(sqlite, nid(), row.id, 'listed');
        break;
      case 'pending':
        seedTransfer(sqlite, nid(), row.id, { status: 'pending_review' });
        break;
      case 'completed+session': {
        const tid = nid();
        seedTransfer(sqlite, tid, row.id, { status: 'completed' });
        seedSession(sqlite, nid(), row.id, tid);
        break;
      }
      case 'signing-doc':
        seedTransfer(sqlite, nid(), row.id, { status: 'signing' });
        break;
      case 'rejected':
        seedTransfer(sqlite, nid(), row.id, { status: 'rejected' });
        break;
    }
  }
}

describe('flowState 批量在途三查', () => {
  it('TC-FLS-01 每键恰好三布尔、各 kind 各自命中（不带行 id）', async () => {
    const { sqlite, db } = fixture();
    for (const id of [1, 2, 3]) seedPlayer(sqlite, id);
    seedListing(sqlite, 11, 1, 'listed');
    seedTransfer(sqlite, 12, 2, { status: 'pending_review' });
    seedSession(sqlite, 13, 3, null);

    const map = await flowState(db, [1, 2, 3]);
    expect(map.size).toBe(3);
    expect(map.get(1)).toEqual({ listing: true, pendingReview: false, signing: false });
    expect(map.get(2)).toEqual({ listing: false, pendingReview: true, signing: false });
    expect(map.get(3)).toEqual({ listing: false, pendingReview: false, signing: true });
    for (const v of map.values()) expect(Object.keys(v).sort()).toEqual(['listing', 'pendingReview', 'signing']);
  });

  it('TC-FLS-02 listings 四态全算在途（三态漂移金丝雀），cancelled/delisted 不误伤', async () => {
    const { sqlite, db } = fixture();
    const states = ['listed', 'bidding', 'matched_pending', 'pending_review', 'cancelled', 'delisted'];
    states.forEach((s, i) => {
      seedPlayer(sqlite, 10 + i);
      seedListing(sqlite, 20 + i, 10 + i, s);
    });

    const map = await flowState(db, states.map((_, i) => 10 + i));
    expect(map.get(10)?.listing).toBe(true);
    expect(map.get(11)?.listing).toBe(true);
    expect(map.get(12)?.listing).toBe(true);
    // listings.pending_review 也算挂牌在途——routes/market.ts:265 三态 dup 的漂移金丝雀（第二批收口）
    expect(map.get(13)?.listing).toBe(true);
    expect(map.get(14)).toEqual({ listing: false, pendingReview: false, signing: false });
    expect(map.get(15)).toEqual({ listing: false, pendingReview: false, signing: false });
  });

  it('TC-FLS-03 transfers 只认 pending_review；signing 单据不误伤（残留兜底只在 seaVerdicts 消费）', async () => {
    const { sqlite, db } = fixture();
    const states = ['pending_review', 'completed', 'rejected', 'signing'];
    states.forEach((s, i) => {
      seedPlayer(sqlite, 20 + i);
      seedTransfer(sqlite, 30 + i, 20 + i, { status: s });
    });

    const map = await flowState(db, states.map((_, i) => 20 + i));
    expect(map.get(20)).toEqual({ listing: false, pendingReview: true, signing: false });
    expect(map.get(21)).toEqual({ listing: false, pendingReview: false, signing: false });
    expect(map.get(22)).toEqual({ listing: false, pendingReview: false, signing: false });
    // signing 单 × 无会话：flowState.signing 不亮（海捞口径 = 任意 active 会话，见模块注释①③）
    expect(map.get(23)).toEqual({ listing: false, pendingReview: false, signing: false });
  });

  it('TC-FLS-04 signing 看会话不看单据：active 会话无单据/挂 completed/signing 单都算，settled/cancelled 不算', async () => {
    const { sqlite, db } = fixture();
    for (const id of [30, 31, 32, 33]) seedPlayer(sqlite, id);
    // ① active 会话无单据（transfer_id NULL）
    seedSession(sqlite, 41, 30, null);
    // ② active 会话挂 completed 单（v6.66.0 翻转后的常态）
    seedTransfer(sqlite, 42, 31, { status: 'completed' });
    seedSession(sqlite, 43, 31, 42);
    // ③ active 会话挂 signing 单（步骤 0 存量形状：本地 1 / 生产 0）
    seedTransfer(sqlite, 44, 32, { status: 'signing' });
    seedSession(sqlite, 45, 32, 44);
    // ④ settled + cancelled 会话
    seedTransfer(sqlite, 46, 33, { status: 'completed' });
    seedSession(sqlite, 47, 33, 46, 'settled');
    seedSession(sqlite, 48, 33, null, 'cancelled');

    const map = await flowState(db, [30, 31, 32, 33]);
    expect(map.get(30)).toEqual({ listing: false, pendingReview: false, signing: true });
    expect(map.get(31)).toEqual({ listing: false, pendingReview: false, signing: true });
    expect(map.get(32)).toEqual({ listing: false, pendingReview: false, signing: true });
    expect(map.get(33)).toEqual({ listing: false, pendingReview: false, signing: false });
  });

  it('TC-FLS-05 混合在途 + 不存在 id 三 false；空数组回空 Map 不抛', async () => {
    const { sqlite, db } = fixture();
    for (const id of [40, 41, 42, 43, 44]) seedPlayer(sqlite, id);
    seedListing(sqlite, 51, 40, 'listed');
    seedTransfer(sqlite, 52, 41, { status: 'pending_review' });
    seedSession(sqlite, 53, 42, null);
    seedListing(sqlite, 54, 43, 'matched_pending');
    seedTransfer(sqlite, 55, 44, { status: 'pending_review' });

    const map = await flowState(db, [40, 41, 42, 43, 44, 998, 999]);
    expect(map.size).toBe(7);
    expect(map.get(40)?.listing).toBe(true);
    expect(map.get(41)?.pendingReview).toBe(true);
    expect(map.get(42)?.signing).toBe(true);
    expect(map.get(43)?.listing).toBe(true);
    expect(map.get(44)?.pendingReview).toBe(true);
    expect(map.get(998)).toEqual({ listing: false, pendingReview: false, signing: false });
    expect(map.get(999)).toEqual({ listing: false, pendingReview: false, signing: false });
    expect(await flowState(db, [])).toEqual(new Map());
  });

  it('TC-FLS-06/07 197 人三分片：跨片合并不丢不串，绑定 ≤98、语句 ≤3×⌈n/98⌉', async () => {
    const { sqlite, db } = fixture();
    const ids = Array.from({ length: 197 }, (_, i) => i + 1);
    const values = ids.map((id) => `(${id}, 'p${id}', '球员${id}', NULL, 'free')`).join(', ');
    sqlite.exec(`INSERT INTO players (id, uid, name, club_id, status) VALUES ${values};`);
    // 分片边界埋点：首片头(1) 挂牌 / 首片尾(98) 待审 / 次片头(99) 会话 / 末片尾(197) 三 kind 叠满
    seedListing(sqlite, 901, 1, 'listed');
    seedTransfer(sqlite, 902, 98, { status: 'pending_review' });
    seedSession(sqlite, 903, 99, null);
    seedListing(sqlite, 904, 197, 'matched_pending');
    seedTransfer(sqlite, 905, 197, { status: 'pending_review' });
    seedSession(sqlite, 906, 197, null);

    const { db: counted, calls } = counting(db);
    const map = await flowState(counted, ids);
    expect(map.size).toBe(197);
    expect(map.get(1)).toEqual({ listing: true, pendingReview: false, signing: false });
    expect(map.get(98)).toEqual({ listing: false, pendingReview: true, signing: false });
    expect(map.get(99)).toEqual({ listing: false, pendingReview: false, signing: true });
    expect(map.get(197)).toEqual({ listing: true, pendingReview: true, signing: true });
    expect(map.get(50)).toEqual({ listing: false, pendingReview: false, signing: false });
    expect(map.get(150)).toEqual({ listing: false, pendingReview: false, signing: false });
    // 分片量化锁：⌈197/98⌉ = 3 分片 × 3 查询 = 9 条；每条绑定参数 ≤98（D1 上限 100 留余量）
    expect(calls.length).toBeLessThanOrEqual(9);
    for (const call of calls) expect(call.binds).toBeLessThanOrEqual(98);
  });
});

describe('seaVerdicts 七关链', () => {
  it('TC-SV-01 未开窗全员拦在 window 关（含本可 ok 的人），errCode no_window', async () => {
    const { sqlite, db } = fixture();
    seedMatrix(sqlite);
    const players = MATRIX.map((r) => ({ id: r.id, club_id: r.clubId, status: r.status }));
    const verdicts = await seaVerdicts(db, players, null);
    expect(verdicts.size).toBe(MATRIX.length);
    for (const row of MATRIX) expect(verdicts.get(row.id), row.label).toStrictEqual(VERDICT_BY_STAGE.window);
  });

  it('TC-SV-02 七关矩阵：逐人（长度 1）stage/status/reason 逐字一致', async () => {
    const { sqlite, db } = fixture();
    seedMatrix(sqlite);
    for (const row of MATRIX) {
      const p = { id: row.id, club_id: row.clubId, status: row.status };
      const verdict = (await seaVerdicts(db, [p], S4W1)).get(row.id)!;
      expect(verdict, row.label).toStrictEqual(VERDICT_BY_STAGE[row.stage]);
    }
  });

  it('TC-SV-02b 批量一次算 12 人与逐人同判（收编的意义）', async () => {
    const { sqlite, db } = fixture();
    seedMatrix(sqlite);
    const players = MATRIX.map((r) => ({ id: r.id, club_id: r.clubId, status: r.status }));
    const batch = await seaVerdicts(db, players, S4W1);
    expect(batch.size).toBe(MATRIX.length);
    for (const row of MATRIX) {
      expect(batch.get(row.id), row.label).toStrictEqual(VERDICT_BY_STAGE[row.stage]);
    }
  });

  it('TC-SV-03 顺序契约：叠满球员逐级拆除，第一道亮红灯的关决定 verdict', async () => {
    const { sqlite, db } = fixture();
    seedClub(sqlite, CLUB_B, '乙队');
    seedPlayer(sqlite, 700, { clubId: CLUB_B, status: 'retired' });
    seedListing(sqlite, 701, 700, 'listed');
    seedTransfer(sqlite, 702, 700, { type: 'termination', status: 'completed' }); // 本窗禁签
    seedTransfer(sqlite, 703, 700, { status: 'pending_review' }); // 待审在途
    seedTransfer(sqlite, 704, 700, { status: 'completed' });
    seedSession(sqlite, 705, 700, 704); // 会话在途
    const p = () =>
      sqlite.prepare('SELECT id, club_id, status FROM players WHERE id = 700').get() as {
        id: number;
        club_id: number | null;
        status: string;
      };

    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.ownership);
    sqlite.exec(`UPDATE players SET club_id = NULL WHERE id = 700`);
    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.status);
    sqlite.exec(`UPDATE players SET status = 'free' WHERE id = 700`);
    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.banned);
    // 拆禁签：把解约单挪出本窗（window_seq 2 的 completed termination 不构成禁签）
    sqlite.exec(`UPDATE transfers SET window_seq = 2 WHERE id = 702`);
    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.listing);
    sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE id = 701`);
    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.pending);
    sqlite.exec(`UPDATE transfers SET status = 'rejected' WHERE id = 703`);
    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.signing);
    sqlite.exec(`UPDATE negotiation_sessions SET status = 'cancelled' WHERE id = 705`);
    expect((await seaVerdicts(db, [p()], S4W1)).get(700)).toStrictEqual(VERDICT_BY_STAGE.ok);
  });

  it('TC-SV-04 CPU 例外：只豁免归属关，后续关照吃', async () => {
    const { sqlite, db } = fixture();
    seedClub(sqlite, CPU_CLUB, '曼城(CPU)', true);
    seedClub(sqlite, CLUB_B, '乙队');
    seedPlayer(sqlite, 710);
    seedPlayer(sqlite, 711, { clubId: CPU_CLUB });
    seedPlayer(sqlite, 712, { clubId: CLUB_B });
    seedPlayer(sqlite, 713, { clubId: CPU_CLUB, status: 'free' });
    seedTransfer(sqlite, 714, 713, { type: 'termination', status: 'completed' });

    const v = async (id: number, clubId: number | null, status = 'normal') =>
      (await seaVerdicts(db, [{ id, club_id: clubId, status }], S4W1)).get(id)!;
    expect(await v(710, null)).toStrictEqual(VERDICT_BY_STAGE.ok);
    expect(await v(711, CPU_CLUB)).toStrictEqual(VERDICT_BY_STAGE.ok);
    expect(await v(712, CLUB_B)).toStrictEqual(VERDICT_BY_STAGE.ownership);
    // CPU 队球员本窗被解约：照吃 banned——例外只豁免归属关
    expect(await v(713, CPU_CLUB, 'free')).toStrictEqual(VERDICT_BY_STAGE.banned);
  });

  it('TC-SV-05 禁签只认「本窗 × termination × completed」', async () => {
    const { sqlite, db } = fixture();
    for (const id of [720, 721, 722, 723]) seedPlayer(sqlite, id, { status: 'free' });
    seedTransfer(sqlite, 724, 720, { type: 'termination', status: 'completed' });
    seedTransfer(sqlite, 725, 721, { type: 'termination', status: 'completed', windowSeq: 2 });
    seedTransfer(sqlite, 726, 722, { type: 'termination', status: 'rejected' });
    seedTransfer(sqlite, 727, 723, { type: 'transfer', status: 'completed' });

    const v = async (id: number) =>
      (await seaVerdicts(db, [{ id, club_id: null, status: 'free' }], S4W1)).get(id)!;
    expect(await v(720)).toStrictEqual(VERDICT_BY_STAGE.banned);
    expect(await v(721)).toStrictEqual(VERDICT_BY_STAGE.ok);
    expect(await v(722)).toStrictEqual(VERDICT_BY_STAGE.ok);
    expect(await v(723)).toStrictEqual(VERDICT_BY_STAGE.ok);
  });

  it('TC-SV-06 errCode 只在 window / signing 两关出现（createFreeAgent 直接透传，形状漂移会改错误码契约）', async () => {
    const { sqlite, db } = fixture();
    seedClub(sqlite, CLUB_B, '乙队');
    seedPlayer(sqlite, 730);
    seedPlayer(sqlite, 731, { clubId: CLUB_B });
    seedPlayer(sqlite, 732, { status: 'free' });
    seedTransfer(sqlite, 733, 732, { status: 'completed' });
    seedSession(sqlite, 734, 732, 733);

    const win = (await seaVerdicts(db, [{ id: 730, club_id: null, status: 'normal' }], null)).get(730)!;
    expect(win.errCode).toBe('no_window');
    const signing = (await seaVerdicts(db, [{ id: 732, club_id: null, status: 'free' }], S4W1)).get(732)!;
    expect(signing.errCode).toBe('sea_signing');
    const ownership = (await seaVerdicts(db, [{ id: 731, club_id: CLUB_B, status: 'normal' }], S4W1)).get(731)!;
    expect(Object.prototype.hasOwnProperty.call(ownership, 'errCode')).toBe(false);
  });

  it('TC-SV-07 signing 单据 × 无 active 会话：仍拦在 signing 关（单据残留兜底，判级不变）', async () => {
    const { sqlite, db } = fixture();
    seedPlayer(sqlite, 740, { status: 'free' });
    seedTransfer(sqlite, 741, 740, { status: 'signing' });

    const verdict = (await seaVerdicts(db, [{ id: 740, club_id: null, status: 'free' }], S4W1)).get(740)!;
    expect(verdict).toStrictEqual(VERDICT_BY_STAGE.signing);
  });

  it('TC-LK-02 seaVerdicts 批内查询 ≤5 条与改前端点副本持平（cpuIds/挂牌/单据/会话/禁签），未开窗零查询', async () => {
    const { sqlite, db } = fixture();
    seedMatrix(sqlite);
    const players = MATRIX.map((r) => ({ id: r.id, club_id: r.clubId, status: r.status }));

    const { db: counted, calls } = counting(db);
    await seaVerdicts(counted, players, S4W1);
    // 与改前端点副本持平的精确口径：cpuIds / 挂牌 / 单据 / 会话 / 禁签各 1 条（cpuIds 无 bind 也要计入）
    expect(calls.length).toBe(5);
    for (const call of calls) expect(call.binds).toBeLessThanOrEqual(98);

    const noWindow = counting(db);
    await seaVerdicts(noWindow.db, players, null);
    expect(noWindow.calls.length).toBe(0);
  });
});

describe('ensureNotInFlight', () => {
  it('TC-EIF-01 三档文案逐字（均 HttpError 400）', async () => {
    const { sqlite, db } = fixture();
    for (const id of [801, 802, 803]) seedPlayer(sqlite, id);
    seedListing(sqlite, 811, 801, 'listed');
    seedTransfer(sqlite, 812, 802, { status: 'pending_review' });
    seedTransfer(sqlite, 813, 803, { status: 'completed' });
    seedSession(sqlite, 814, 803, 813);

    await expect(ensureNotInFlight(db, 801)).rejects.toThrow('这名球员已经有一单在市场流程里了，等它结束再操作');
    await expect(ensureNotInFlight(db, 802)).rejects.toThrow('这名球员有一张单据正在等管理组审核，先等审核结果');
    await expect(ensureNotInFlight(db, 803)).rejects.toThrow('这名球员已经成交，还有一场签约谈判没结束，等它结束再操作');
    let status: number | undefined;
    await ensureNotInFlight(db, 801).catch((e) => {
      status = (e as HttpError).status;
    });
    expect(status).toBe(400);
  });

  it('TC-EIF-02 优先序 listing > pending > negotiation：逐级拆除依序命中', async () => {
    const { sqlite, db } = fixture();
    seedPlayer(sqlite, 820);
    seedListing(sqlite, 821, 820, 'listed');
    seedTransfer(sqlite, 822, 820, { status: 'pending_review' });
    seedTransfer(sqlite, 823, 820, { status: 'completed' });
    seedSession(sqlite, 824, 820, 823);

    await expect(ensureNotInFlight(db, 820)).rejects.toThrow('这名球员已经有一单在市场流程里了，等它结束再操作');
    sqlite.exec(`UPDATE listings SET status = 'delisted' WHERE id = 821`);
    await expect(ensureNotInFlight(db, 820)).rejects.toThrow('这名球员有一张单据正在等管理组审核，先等审核结果');
    sqlite.exec(`UPDATE transfers SET status = 'rejected' WHERE id = 822`);
    await expect(ensureNotInFlight(db, 820)).rejects.toThrow('这名球员已经成交，还有一场签约谈判没结束，等它结束再操作');
  });

  it('TC-EIF-03 谓词双形态并存：signing 单 × 会话开着放行（旧连接谓词），completed × 会话开着拦', async () => {
    const { sqlite, db } = fixture();
    for (const id of [830, 831]) seedPlayer(sqlite, id);
    // 甲：signing 单据 × active 会话（步骤 0 本地存量 1 行的形状）→ negotiation 档不上闸
    seedTransfer(sqlite, 832, 830, { status: 'signing' });
    seedSession(sqlite, 833, 830, 832);
    // 乙：completed 单据 × active 会话 → 「已经成交…」拦
    seedTransfer(sqlite, 834, 831, { status: 'completed' });
    seedSession(sqlite, 835, 831, 834);

    // 裁决 8 双谓词并存的行为锁：拆掉 `<> 'signing'` 甲变红，删旧连接谓词乙变红
    await expect(ensureNotInFlight(db, 830)).resolves.toBeUndefined();
    await expect(ensureNotInFlight(db, 831)).rejects.toThrow('这名球员已经成交，还有一场签约谈判没结束，等它结束再操作');
  });
});

// ---- TC-RET 源码锁（测试计划 §3.5；domains.test.ts 全仓扫描先例）：----
// 迁移后的干净状态（bypass 无转发导出 / 协议注释清零 / import 全收口）没有任何运行时信号，
// 改回去不会有编译或测试失败，所以在这里用文本扫描锁死。

function workerSrc(rel: string): string {
  // .href 传 string——workers-types 全局 URL 与 node:url 的 URL 类型冲突（tests/d1.ts:186 同款绕法）
  return readFileSync(fileURLToPath(new URL(`../src/worker/${rel}`, import.meta.url).href), 'utf8');
}

/** 递归列出目录下全部 .ts（不含 .d.ts），返回相对 tests/ 的路径 */
function listTs(relDir: string): string[] {
  const out: string[] = [];
  const dir = fileURLToPath(new URL(relDir, import.meta.url).href);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listTs(rel));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

describe('TC-RET 源码锁（v6.80.0 迁移收口）', () => {
  it('TC-RET-01 bypass.ts 不留转发导出：四者唯一来源 = player-flow-state.ts', () => {
    const bypass = workerSrc('bypass.ts');
    for (const name of ['ensureNotInFlight', 'checkSeaSignEligible', 'findInFlight', 'SeaSignVerdict']) {
      // 覆盖 `export function/type/const NAME` 与 `export { NAME } from ...`（含多行花括号）两种转发形态
      const reExport = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b|export[^;\\n]*\\b${name}\\b`);
      expect(bypass, `bypass.ts 不得再 export ${name}`).not.toMatch(reExport);
    }
    const flow = workerSrc('player-flow-state.ts');
    expect(flow).toContain('export async function flowState');
    expect(flow).toContain('export async function seaVerdicts');
    expect(flow).toContain('export async function ensureNotInFlight');
    expect(flow).toContain('export type SeaSignStage');
    expect(flow).toContain('export interface SeaSignVerdict');
  });

  it('TC-RET-02 「两处口径必须同步改」注释协议已消灭（bypass.ts + routes/market.ts）', () => {
    expect(workerSrc('bypass.ts')).not.toContain('两处口径必须同步改');
    expect(workerSrc('routes/market.ts')).not.toContain('两处口径必须同步改');
  });

  it('TC-RET-03 迁出符号的 import 全部来自 player-flow-state.ts；ACTIVE_SESSION_SQL 只 import 不复制', () => {
    // src/ 与 tests/ 全部 .ts 的命名 import 块（[^}]* 跨行）逐一核对来源
    const names = ['ensureNotInFlight', 'seaVerdicts', 'SeaSignVerdict', 'SeaSignStage', 'flowState'];
    const namedImport = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    for (const rel of [...listTs('../src'), ...listTs('../tests')]) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');
      for (const match of src.matchAll(namedImport)) {
        const imported = match[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, ''));
        const from = match[2]!;
        for (const name of names) {
          if (imported.includes(name)) {
            expect(from, `${rel} 的 ${name} import 来源`).toMatch(/player-flow-state\.ts$/);
          }
        }
      }
    }
    // 裁决 7：v6.66.0 单行真源只在 negotiation-guard.ts，本模块不得字面复制
    expect(workerSrc('player-flow-state.ts')).not.toMatch(/ACTIVE_SESSION_SQL\s*=/);
  });
});
