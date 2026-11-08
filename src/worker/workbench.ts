// 审核工作台的在途数据（v6.68.2 期 C，设计文档 §6.3 / Q8 裁决）。
//
// 一个端点把五张在途表一次取全：工作台要的是「现在卡在哪儿」，分成五个请求只会让页面
// 出现五段各自的加载态，运营还得自己对时间——一次往返够用，且四张表都走同一条 CPU 过滤。
//
// 与公开在售 feed 的关系：`GET /api/market/listings` 是匿名热路径（带限速 + 惰性结算 +
// 卡柜投影），工作台要的是管理员视角（凭证、CPU 标记、截止优先级、不做结算）。两边的
// 过滤条件与投影都不同，硬抽一个公共查询函数会把 8 个可选参数塞进去，反而更难改；
// 这里保持独立 SQL，字段语义由 `tests/workbench.test.ts` 锁住，公开 feed 的改动不受本文件影响。
import type { Env } from './env.ts';
import { sqlDisplayName } from '../core/player-name.ts';
// 契约类型锚点（v6.82.0 第 1 批）：本模块下发的两个顶层响应以 src/contract/batch1.ts 为真源
// 锁装配（甄别 naming 别名：worker 内部名 WorkbenchListing*/SearchHit 不动，见各接口注释）。
import type {
  WorkbenchInFlight as WorkbenchInFlightDto,
  WorkbenchSearchHit as WorkbenchSearchHitDto,
} from '../contract/batch1.ts';

export interface WorkbenchListing {
  id: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  sellerClubId: number | null;
  sellerClubName: string;
  type: string;
  status: string;
  askPrice: number;
  highestBid: number | null;
  bidCount: number;
  bidPaused: boolean;
  deadlineAt: string | null;
  hasProof: boolean;
}

export interface WorkbenchBid {
  id: number;
  listingId: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  clubId: number;
  clubName: string;
  amount: number;
  createdAt: string;
}

export interface WorkbenchSession {
  id: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  clubId: number;
  clubName: string;
  transferId: number;
  releaseFee: number | null;
  expectedWage: number | null;
  attemptCount: number;
  expiryAnchorAt: string | null;
}

export interface WorkbenchTransfer {
  id: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  fromClubId: number | null;
  fromName: string;
  toClubId: number | null;
  toName: string;
  type: string;
  status: string;
  fee: number | null;
  createdAt: string;
}

export interface WorkbenchForced {
  listingId: number;
  playerId: number;
  playerFcId: number | null;
  playerName: string;
  sellerClubId: number | null;
  sellerClubName: string;
  status: string;
  askPrice: number;
  highestBid: number | null;
  bidPaused: boolean;
  deadlineAt: string | null;
}

export interface WorkbenchInFlight {
  listings: WorkbenchListing[];
  bids: WorkbenchBid[];
  sessions: WorkbenchSession[];
  transfers: WorkbenchTransfer[];
  forced: WorkbenchForced[];
  counts: { listings: number; bids: number; sessions: number; transfers: number; forced: number };
  /** 默认隐藏 CPU 时，四张转会类表各被藏掉多少条（强拍表不过滤，所以不在内） */
  hidden: { listings: number; bids: number; sessions: number; transfers: number };
}

// 每表上限：与公开 feed 的 50 一致。超出的表由前端显示「50+」，不在这里分页——
// 工作台的用法是「一眼看完再处置」，真要翻页说明该先批量处理积压。
const LIMIT = 50;

// CPU 过滤（Q2 裁决）：四张转会类表默认隐藏 CPU 参与方，强拍表不过滤——
// 强拍本身就是运营发起的动作，把 CPU 卖方藏掉反而看不见在跑什么。
function cpuClause(column: string, hide: boolean): string {
  return hide ? `AND COALESCE(${column}, 0) = 0` : '';
}

export async function loadInFlight(env: Env, opts: { includeCpu: boolean }): Promise<WorkbenchInFlightDto> {
  const hide = !opts.includeCpu;
  const db = env.DB;

  const listingsSql = `
    SELECT l.id, l.player_id, l.seller_club_id, l.type, l.status, l.ask_price, l.bid_paused,
           l.deadline_at, l.activation_deadline, l.match_deadline,
           CASE WHEN l.activation_proof IS NOT NULL THEN 1 ELSE 0 END AS has_proof,
           p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
           cl.name AS seller_name,
           (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS highest_bid,
           (SELECT COUNT(*) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS bid_count
    FROM listings l
    JOIN players p ON p.id = l.player_id
    LEFT JOIN clubs cl ON cl.id = l.seller_club_id
    WHERE l.status IN ('listed', 'bidding', 'matched_pending') AND l.type <> 'forced'
      ${cpuClause('cl.is_cpu', hide)}
    ORDER BY COALESCE(l.deadline_at, l.match_deadline, l.activation_deadline, l.listed_at) ASC, l.id ASC
    LIMIT ${LIMIT}`;

  const bidsSql = `
    SELECT b.id, b.listing_id, b.club_id, b.amount, b.created_at,
           l.player_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
           COALESCE(cl.name, '自由身') AS club_name
    FROM bids b
    JOIN listings l ON l.id = b.listing_id
    JOIN players p ON p.id = l.player_id
    LEFT JOIN clubs cl ON cl.id = b.club_id
    WHERE b.status = 'active'
      ${cpuClause('cl.is_cpu', hide)}
    ORDER BY b.created_at ASC, b.id ASC
    LIMIT ${LIMIT}`;

  const sessionsSql = `
    SELECT s.id, s.player_id, s.club_id, s.transfer_id, s.release_fee, s.expected_wage,
           s.attempt_count, s.expiry_anchor_at,
           p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
           COALESCE(cl.name, '自由身') AS club_name
    FROM negotiation_sessions s
    JOIN players p ON p.id = s.player_id
    LEFT JOIN clubs cl ON cl.id = s.club_id
    WHERE s.status = 'active'
      ${cpuClause('cl.is_cpu', hide)}
    ORDER BY COALESCE(s.expiry_anchor_at, s.created_at) ASC, s.id ASC
    LIMIT ${LIMIT}`;

  const transfersSql = `
    SELECT t.id, t.player_id, t.from_club_id, t.to_club_id, t.type, t.status, t.fee, t.created_at,
           p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
           fc.name AS from_name, tc.name AS to_name
    FROM transfers t
    JOIN players p ON p.id = t.player_id
    LEFT JOIN clubs fc ON fc.id = t.from_club_id
    LEFT JOIN clubs tc ON tc.id = t.to_club_id
    WHERE t.status IN ('pending_review', 'signing')
      -- 只看卖方：CPU 队不会发起转会/买人，它只会当卖方（强拍/挂牌成交），
      -- 把买方也过一遍 CPU 过滤会连带藏掉「真人买 CPU 球员」这种正需要审核的单
      ${hide ? 'AND COALESCE(fc.is_cpu, 0) = 0' : ''}
    ORDER BY t.created_at ASC, t.id ASC
    LIMIT ${LIMIT}`;

  const forcedSql = `
    SELECT l.id, l.player_id, l.seller_club_id, l.status, l.ask_price, l.bid_paused,
           l.deadline_at, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name,
           COALESCE(cl.name, '自由身') AS seller_name,
           (SELECT MAX(b.amount) FROM bids b WHERE b.listing_id = l.id AND b.status = 'active') AS highest_bid
    FROM listings l
    JOIN players p ON p.id = l.player_id
    LEFT JOIN clubs cl ON cl.id = l.seller_club_id
    WHERE l.type = 'forced' AND l.status IN ('listed', 'bidding', 'pending_review')
    ORDER BY COALESCE(l.deadline_at, l.listed_at) ASC, l.id ASC
    LIMIT ${LIMIT}`;

  // 五条语句互不依赖，并行一趟（D1 每次 prepare/run 各自往返，串行会白付四趟延迟）
  const [listingsRes, bidsRes, sessionsRes, transfersRes, forcedRes] = await Promise.all([
    db.prepare(listingsSql).all<{
      id: number;
      player_id: number;
      seller_club_id: number | null;
      type: string;
      status: string;
      ask_price: number;
      bid_paused: number | null;
      deadline_at: string | null;
      activation_deadline: string | null;
      match_deadline: string | null;
      has_proof: number;
      player_fc_id: number | null;
      player_name: string;
      seller_name: string | null;
      highest_bid: number | null;
      bid_count: number;
    }>(),
    db.prepare(bidsSql).all<{
      id: number;
      listing_id: number;
      club_id: number;
      amount: number;
      created_at: string;
      player_id: number;
      player_fc_id: number | null;
      player_name: string;
      club_name: string;
    }>(),
    db.prepare(sessionsSql).all<{
      id: number;
      player_id: number;
      club_id: number;
      transfer_id: number;
      release_fee: number | null;
      expected_wage: number | null;
      attempt_count: number;
      expiry_anchor_at: string | null;
      player_fc_id: number | null;
      player_name: string;
      club_name: string;
    }>(),
    db.prepare(transfersSql).all<{
      id: number;
      player_id: number;
      from_club_id: number | null;
      to_club_id: number | null;
      type: string;
      status: string;
      fee: number | null;
      created_at: string;
      player_fc_id: number | null;
      player_name: string;
      from_name: string | null;
      to_name: string | null;
    }>(),
    db.prepare(forcedSql).all<{
      id: number;
      player_id: number;
      seller_club_id: number | null;
      status: string;
      ask_price: number;
      bid_paused: number | null;
      deadline_at: string | null;
      player_fc_id: number | null;
      player_name: string;
      seller_name: string | null;
      highest_bid: number | null;
    }>(),
  ]);

  const listings = listingsRes.results.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    playerFcId: r.player_fc_id,
    playerName: r.player_name,
    sellerClubId: r.seller_club_id,
    sellerClubName: r.seller_name ?? '自由身',
    type: r.type,
    status: r.status,
    askPrice: r.ask_price,
    highestBid: r.highest_bid ?? null,
    bidCount: r.bid_count ?? 0,
    bidPaused: r.bid_paused === 1,
    deadlineAt: r.deadline_at ?? r.match_deadline ?? r.activation_deadline,
    hasProof: r.has_proof === 1,
  }));

  const bids = bidsRes.results.map((r) => ({
    id: r.id,
    listingId: r.listing_id,
    playerId: r.player_id,
    playerFcId: r.player_fc_id,
    playerName: r.player_name,
    clubId: r.club_id,
    clubName: r.club_name,
    amount: r.amount,
    createdAt: r.created_at,
  }));

  const sessions = sessionsRes.results.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    playerFcId: r.player_fc_id,
    playerName: r.player_name,
    clubId: r.club_id,
    clubName: r.club_name,
    transferId: r.transfer_id,
    releaseFee: r.release_fee,
    expectedWage: r.expected_wage,
    attemptCount: r.attempt_count,
    expiryAnchorAt: r.expiry_anchor_at,
  }));

  const transfers = transfersRes.results.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    playerFcId: r.player_fc_id,
    playerName: r.player_name,
    fromClubId: r.from_club_id,
    fromName: r.from_name ?? '自由身',
    toClubId: r.to_club_id,
    toName: r.to_name ?? '自由身',
    type: r.type,
    status: r.status,
    fee: r.fee,
    createdAt: r.created_at,
  }));

  const forced = forcedRes.results.map((r) => ({
    listingId: r.id,
    playerId: r.player_id,
    playerFcId: r.player_fc_id,
    playerName: r.player_name,
    sellerClubId: r.seller_club_id,
    sellerClubName: r.seller_name ?? '自由身',
    status: r.status,
    askPrice: r.ask_price,
    highestBid: r.highest_bid ?? null,
    bidPaused: r.bid_paused === 1,
    deadlineAt: r.deadline_at,
  }));

  // 「已隐藏 N 条」：默认隐藏时再取一次含 CPU 的视图做差。多一轮五条查询，但每表 50 行的量级，
  // 比复制四份 COUNT SQL 更不容易和主查询走样（口径只有一处）。
  let hidden = { listings: 0, bids: 0, sessions: 0, transfers: 0 };
  if (hide) {
    const all = await loadInFlight(env, { includeCpu: true });
    hidden = {
      listings: all.listings.length - listings.length,
      bids: all.bids.length - bids.length,
      sessions: all.sessions.length - sessions.length,
      transfers: all.transfers.length - transfers.length,
    };
  }

  return {
    listings,
    bids,
    sessions,
    transfers,
    forced,
    counts: {
      listings: listings.length,
      bids: bids.length,
      sessions: sessions.length,
      transfers: transfers.length,
      forced: forced.length,
    },
    hidden,
  };
}

export type SearchKind = 'player' | 'club' | 'listing' | 'bid' | 'negotiation' | 'transfer';

export interface SearchHit {
  kind: SearchKind;
  id: number;
  label: string;
  sublabel?: string;
}

// 搜索（§6.2）：纯数字按「这一个数字可能是谁」并行探一遍七种 id；非数字查球员/俱乐部名字。
// 只回候选、不回详情——选中后由前端跳到对应表并展开（避免第二个详情端点）。
export async function searchWorkbench(env: Env, q: string): Promise<WorkbenchSearchHitDto[]> {
  const db = env.DB;
  const hits: SearchHit[] = [];
  const trimmed = q.trim();
  if (trimmed === '') return hits;

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const [playerById, playerByFc, clubById, listingById, bidById, sessionById, transferById] = await Promise.all([
      db.prepare(`SELECT id, ${sqlDisplayName('p')} AS name FROM players p WHERE id = ?`).bind(n).first<{ id: number; name: string }>(),
      db.prepare(`SELECT id, ${sqlDisplayName('p')} AS name FROM players p WHERE fc_id = ? LIMIT 1`).bind(n).first<{ id: number; name: string }>(),
      db.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(n).first<{ id: number; name: string }>(),
      db.prepare(`SELECT l.id, ${sqlDisplayName('p')} AS player_name, l.status FROM listings l JOIN players p ON p.id = l.player_id WHERE l.id = ?`)
        .bind(n)
        .first<{ id: number; player_name: string; status: string }>(),
      db.prepare('SELECT b.id, b.listing_id, b.amount, b.status FROM bids b WHERE b.id = ?').bind(n).first<{ id: number; listing_id: number; amount: number; status: string }>(),
      db.prepare(`SELECT s.id, s.status, ${sqlDisplayName('p')} AS player_name FROM negotiation_sessions s JOIN players p ON p.id = s.player_id WHERE s.id = ?`)
        .bind(n)
        .first<{ id: number; status: string; player_name: string }>(),
      db.prepare(`SELECT t.id, t.status, t.type, ${sqlDisplayName('p')} AS player_name FROM transfers t JOIN players p ON p.id = t.player_id WHERE t.id = ?`)
        .bind(n)
        .first<{ id: number; status: string; type: string; player_name: string }>(),
    ]);
    if (playerByFc) hits.push({ kind: 'player', id: playerByFc.id, label: playerByFc.name, sublabel: `FC id ${n}` });
    if (playerById && playerById.id !== playerByFc?.id) hits.push({ kind: 'player', id: playerById.id, label: playerById.name, sublabel: '球员 id' });
    if (clubById) hits.push({ kind: 'club', id: clubById.id, label: clubById.name, sublabel: '俱乐部 id' });
    if (listingById) hits.push({ kind: 'listing', id: listingById.id, label: listingById.player_name, sublabel: `挂牌 · ${listingById.status}` });
    if (bidById) hits.push({ kind: 'bid', id: bidById.id, label: `${bidById.amount}m 的出价`, sublabel: `出价 · 挂牌 #${bidById.listing_id} · ${bidById.status}` });
    if (sessionById) hits.push({ kind: 'negotiation', id: sessionById.id, label: sessionById.player_name, sublabel: `谈判会话 · ${sessionById.status}` });
    if (transferById) hits.push({ kind: 'transfer', id: transferById.id, label: transferById.player_name, sublabel: `转会 · ${transferById.type} · ${transferById.status}` });
    return hits;
  }

  // 名字搜索：球员（英文名 / 中文名）与俱乐部，各取前 10；LIKE 大小写不敏感由 SQLite 默认行为保证
  const like = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const [players, clubs] = await Promise.all([
    db.prepare(
      `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name FROM players p
       WHERE p.name LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\'
       ORDER BY p.id ASC LIMIT 10`,
    )
      .bind(like, like)
      .all<{ id: number; fc_id: number | null; name: string }>(),
    db.prepare(`SELECT id, name FROM clubs WHERE name LIKE ? ESCAPE '\\' ORDER BY id ASC LIMIT 10`)
      .bind(like)
      .all<{ id: number; name: string }>(),
  ]);
  for (const p of players.results) hits.push({ kind: 'player', id: p.id, label: p.name, sublabel: p.fc_id !== null ? `FC id ${p.fc_id}` : '球员' });
  for (const cl of clubs.results) hits.push({ kind: 'club', id: cl.id, label: cl.name, sublabel: '俱乐部' });
  return hits;
}
