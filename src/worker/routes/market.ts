// 转会市场路由（附录 A〔3〕）：转会区（公开）、挂牌/出价（教练）、我的出价、单据详情。
// 惰性结算（§6.5）在列表与出价入口先跑；挂牌校验全在 core/market-rules，
// 出价的资金/步长闸由 0005 触发器在同一事务兜底，路由层做可读的前置校验。
// v6.18.0（市场信息架构改版）：公开情报改为 /market/rumors（传闻流）+ /market/deals（最近成交），
// 教练侧情报台改为 /market/sea-lookup（按 ID/名字速查可捞性）+ /market/activatable（可激活球员）；
// 退役 /market/sea-signs、/market/cpu-board、/market/trainees 三端点。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { assertPublicRate, cachedJson, waitUntilOf } from '../../lib/guard.ts';
import { ttlForScope } from '../../lib/cache-policy.ts';
import { createAuditStatement } from '../../lib/audit.ts';
import {
  bidDeadline,
  listingPriceBounds,
  shanghaiDateStr,
  validateBidAmount,
  round2,
  TRAINEE_ACTIVATION_FEE,
} from '../../core/market-rules.ts';
import { getOpenWindow, isWindowOpen } from '../seasons.ts';
import { activationFee } from '../../core/bypass-rules.ts';
import { foldNameQuery, likeContains, sqlFold } from '../../core/name-fold.ts';
import { CURRENT_TICKS_SQL } from '../contract-ticks.ts';
import { buildRumors, resolveRumorWindow } from '../rumors.ts';
import { cpuClubIds } from '../growth.ts';
import { firstPlayerByRef } from '../player-ref.ts';
import { loadMarketContext } from '../market-context.ts';
import { createConfigService } from '../../core/config.ts';
import { availableBalance } from '../ledger.ts';
import { POSITION_BY_ID } from '../../core/fc26.ts';
import { shuffleWithSeed, transferBoardBucket } from '../../core/ad-board.ts';
import { rowDisplayName, sqlDisplayName } from '../../core/player-name.ts';
import { settleOverdue } from '../market-settle.ts';
import { rollbackRcChangeForPlayer } from '../bypass.ts';
import { createActivation } from '../activations.ts';
import { queueClubNotification } from '../notify.ts';
import { getBoundClub, assertTradable } from '../binding.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

const LISTING_STATUSES = ['listed', 'bidding', 'matched_pending', 'pending_review', 'delisted'] as const;

interface ListingRow {
  id: number;
  player_id: number;
  player_fc_id: number | null;
  seller_club_id: number;
  type: string;
  ask_price: number;
  status: string;
  listed_at: string;
  last_bid_at: string | null;
  listed_day: string | null;
  deadline_at: string | null;
  deadline_note: string | null;
  season: number | null;
  window_seq: number | null;
  activated_by: number | null;
  activation_deadline: string | null;
  match_deadline: string | null;
  bid_paused?: number;
  activator_name?: string | null;
  player_name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  seller_name: string;
}

function statusFilter(raw: string | undefined): string[] {
  switch (raw) {
    case undefined:
    case '':
    case 'active':
      return ['listed', 'bidding', 'matched_pending'];
    case 'pending_review':
      return ['pending_review'];
    case 'ended':
      return ['delisted'];
    case 'all':
      return [...LISTING_STATUSES];
    default:
      throw new HttpError(400, 'status 只能是 active / pending_review / ended / all');
  }
}

// GET /api/market/listings?status=&cursor=&player_id= —— 转会区（卡柜）
// player_id（v6.4.0 改动 6）：按球员查现行挂牌（球员页左栏出价途径用），与 status 过滤叠加。
app.get('/market/listings', async (c) => {
  await settleOverdue(c.env, { origin: 'lazy_settle' });
  const statuses = statusFilter(c.req.query('status'));
  const cursorRaw = c.req.query('cursor');
  let cursor: number | null = null;
  if (cursorRaw !== undefined) {
    const n = Number(cursorRaw);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'cursor 不对');
    cursor = n;
  }
  let playerId: number | null = null;
  if (c.req.query('player_id') !== undefined) {
    const n = Number(c.req.query('player_id'));
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'player_id 应为球员 ID');
    playerId = n;
  }
  const ph = statuses.map(() => '?').join(', ');
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_at, l.last_bid_at,
            l.listed_day, l.deadline_at, l.deadline_note, l.season, l.window_seq, l.activated_by, l.activation_deadline, l.match_deadline, l.bid_paused,
            ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id, p.position, p.age, p.ca, p.pa,
            cl.name AS seller_name
     FROM listings l
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
     WHERE l.status IN (${ph}) ${cursor !== null ? 'AND l.id < ?' : ''} ${playerId !== null ? 'AND l.player_id = ?' : ''}
     ORDER BY l.id DESC LIMIT 50`,
  )
    .bind(...statuses, ...(cursor !== null ? [cursor] : []), ...(playerId !== null ? [playerId] : []))
    .all<ListingRow>();

  // 出价聚合（最高价 + 出价次数 + 领先出价方，改动 5），IN 分块 ≤90（§17）。
  // 领先出价方 = active 出价（每单至多一条：新出价落库即把旧 active 全部 superseded）。
  const ids = rows.results.map((r) => r.id);
  const agg = new Map<number, { highest: number; count: number }>();
  const leader = new Map<number, { id: number; name: string }>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const ph2 = slice.map(() => '?').join(', ');
    const bidRows = await c.env.DB.prepare(
      `SELECT listing_id, MAX(amount) AS highest, COUNT(*) AS count FROM bids WHERE listing_id IN (${ph2}) GROUP BY listing_id`,
    )
      .bind(...slice)
      .all<{ listing_id: number; highest: number; count: number }>();
    for (const b of bidRows.results) agg.set(b.listing_id, { highest: b.highest, count: b.count });
    const activeRows = await c.env.DB.prepare(
      `SELECT b.listing_id, b.club_id, cl.name AS club_name
       FROM bids b JOIN clubs cl ON cl.id = b.club_id
       WHERE b.listing_id IN (${ph2}) AND b.status = 'active'`,
    )
      .bind(...slice)
      .all<{ listing_id: number; club_id: number; club_name: string }>();
    for (const b of activeRows.results) leader.set(b.listing_id, { id: b.club_id, name: b.club_name });
  }

  const ctx = await loadMarketContext(c.env.DB);
  const now = new Date();
  return c.json({
    listings: rows.results.map((r) => {
      const a = agg.get(r.id) ?? null;
      let deadlineAt: string | null = null;
      // 截止绝对时刻化（v6.4.0）：优先读落库列（出价时按 bidDeadline 算定），存量行 NULL 回落实时算。
      // v6.24.0：挂牌即落 deadline_at，listed 的普通挂牌也回截止时刻（卡片倒计时锚点）；
      // v6.24.1：强制拍卖创建即落列，与普通挂牌同轨回传；
      // 激活挂牌的首价窗看 activationDeadline，不进本判定（唯一豁免）
      if ((r.status === 'bidding' || (r.status === 'listed' && r.type !== 'activation')) && r.listed_day !== null) {
        deadlineAt =
          r.deadline_at ??
          bidDeadline({
            lastBidAt: r.last_bid_at,
            listedDay: r.listed_day,
            now,
            deadlineHours: ctx.deadlineHours,
            silenceHours: ctx.silenceHours,
            calendar: ctx.calendar,
          }).deadlineAt;
      }
      return {
        id: r.id,
        player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, age: r.age, ca: r.ca, pa: r.pa },
        sellerClub: { id: r.seller_club_id, name: r.seller_name },
        type: r.type,
        askPrice: r.ask_price,
        status: r.status,
        listedAt: r.listed_at,
        lastBidAt: r.last_bid_at,
        bidPaused: r.bid_paused === 1,
        highestBid: a?.highest ?? null,
        highestBidder: leader.get(r.id) ?? null,
        bidCount: a?.count ?? 0,
        activatedBy: r.activated_by,
        activationDeadline: r.activation_deadline,
        matchDeadline: r.match_deadline,
        matchPhase:
          r.type === 'activation'
            ? r.status === 'listed'
              ? 'first_bid'
              : r.status === 'matched_pending'
                ? 'matching'
                : null
            : null,
        firstBidPending: r.type === 'activation' && (a?.count ?? 0) === 0 && r.activated_by !== null,
        deadlineAt,
        deadlineNote: r.deadline_note,
      };
    }),
    cursor: rows.results.length === 50 ? rows.results[rows.results.length - 1].id : null,
  });
});

// POST /api/market/listings —— 挂牌（价格校验 4.4.1.1）
app.post('/market/listings', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);

  const body = (await c.req.raw.json().catch(() => null)) as { playerId?: unknown; askPrice?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const playerId = Number(body.playerId);
  const askPrice = Number(body.askPrice);
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, 'playerId 应为球员 ID');
  if (!Number.isFinite(askPrice) || askPrice <= 0) throw new HttpError(400, '挂牌价须为正数（单位 m）');

  const win = await getOpenWindow(c.env.DB);
  if (!win) throw new HttpError(409, '转会窗口没开，现在不能挂牌', 'no_window');

  const player = await c.env.DB.prepare('SELECT id, name, club_id, status, market_value FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; name: string; club_id: number | null; status: string; market_value: number | null }>();
  if (!player) throw new HttpError(404, '球员不存在');
  if (player.club_id !== club.id) throw new HttpError(400, '只能挂牌自己队里的球员');
  if (player.status !== 'normal') {
    throw new HttpError(
      400,
      player.status === 'listed'
        ? '这名球员已经在挂牌流程里了'
        : player.status === 'trainee'
          ? '训练营球员不挂牌：只能被其他球队按激活转会带走（固定 5m）'
          : '当前状态不能挂牌',
    );
  }

  // 意向单硬锁（v6.29.0）：同球员有 status='intent' 的单子时不能再挂牌——先了结意向单
  // （等开窗由卖方确认挂牌，或任一方撤回/放弃），否则同一球员会同时有挂牌与意向单两条成交通道。
  // idx_offers_player (player_id, status) 上的一次索引查询，不改变挂牌其余流程。
  const intent = await c.env.DB.prepare(`SELECT id FROM offers WHERE player_id = ? AND status = 'intent' LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (intent) throw new HttpError(409, '这名球员已经有一条意向单在等开窗，先了结它再挂牌', 'intent_exists');

  const dup = await c.env.DB.prepare(`SELECT id FROM listings WHERE player_id = ? AND status IN ('listed', 'bidding', 'pending_review') LIMIT 1`)
    .bind(playerId)
    .first<{ id: number }>();
  if (dup) throw new HttpError(400, '这名球员已经有一单在市场里了，等它结束再挂');

  // 训练营球员不可自行挂牌（4.3.4 合同固定、4.4.2 只走激活转会），唯一出口是激活挂牌
  const trainee = await c.env.DB.prepare(`SELECT contract_type FROM contracts WHERE player_id = ? AND is_active = 1`)
    .bind(playerId)
    .first<{ contract_type: string }>();
  if (trainee?.contract_type === 'trainee') {
    throw new HttpError(400, '训练营球员不挂牌：只能被其他球队按激活转会带走（固定 5m）');
  }

  const contract = await c.env.DB.prepare('SELECT release_fee FROM contracts WHERE player_id = ? AND is_active = 1')
    .bind(playerId)
    .first<{ release_fee: number | null }>();
  const rc = contract?.release_fee ?? null;
  if (rc === null || rc <= 0) throw new HttpError(400, '球员没有含违约金的现行合同，先让管理组补合同');

  const bounds = listingPriceBounds(rc, player.market_value);
  if (!bounds) throw new HttpError(400, '违约金太低，挂不出符合规则的价格（上限不足 1m）');
  if (askPrice < bounds.min) {
    throw new HttpError(400, `挂牌价不能低于 ${bounds.min} m（下限：违约金/身价五折取低，且不低于 1m）`);
  }
  if (askPrice > bounds.max) {
    throw new HttpError(400, `挂牌价不能超过 ${bounds.max} m（违约金 1.5 倍上限）`);
  }

  const audit = createAuditStatement(c.env.DB);
  const listedAt = new Date().toISOString();
  const listedDay = shanghaiDateStr(Date.parse(listedAt));
  // v6.24.0：挂牌即落绝对截止时刻（无人出价同样计静默，到点由惰性结算下架）
  const ctx = await loadMarketContext(c.env.DB);
  const firstDeadline = bidDeadline({
    lastBidAt: null,
    listedDay,
    now: new Date(listedAt),
    deadlineHours: ctx.deadlineHours,
    silenceHours: ctx.silenceHours,
    calendar: ctx.calendar,
  }).deadlineAt;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO listings (player_id, seller_club_id, type, ask_price, status, listed_at, listed_day, deadline_at, season, window_seq)
       VALUES (?, ?, 'normal', ?, 'listed', ${nowSql()}, ?, ?, ?, ?)`,
    ).bind(playerId, club.id, round2(askPrice), listedDay, firstDeadline, win.season, win.windowSeq),
    c.env.DB.prepare(`UPDATE players SET status = 'listed', updated_at = ${nowSql()} WHERE id = ? AND club_id = ? AND status = 'normal'`).bind(
      playerId,
      club.id,
    ),
    audit({
      actor: user.id,
      action: 'listing_create',
      targetType: 'listing',
      targetId: null,
      origin: 'user',
      after: { playerId, clubId: club.id, askPrice, season: win.season, windowSeq: win.windowSeq },
    }),
  ];
  const results = await c.env.DB.batch(statements);
  const inserted = results[0].meta.changes > 0;
  if (!inserted) throw new HttpError(409, '挂牌没落库，球员状态可能刚被改过，刷新再试');
  const listingId = Number(results[0].meta.last_row_id);

  // 4.4.10：挂牌提交即触发本窗续约回滚（触发 ref = 转会区挂牌记录）
  await rollbackRcChangeForPlayer(c.env, playerId, user.id, { refType: 'listing', refId: listingId });

  return c.json({ ok: true, listingId, min: bounds.min, max: bounds.max }, 201);
});

// GET /api/market/rumors —— 传闻流（v6.18.0 公开情报）：窗口种子固定的真/假混排传闻（6~8 条）。
// 种子 = resolveRumorWindow（开窗取开窗；两窗之间取可见赛季 + windowSeq 0），同窗载荷恒定 ⇒ 键含种子。
// 市场写路径（/api/market、/api/admin）的 purge 挂钩负责写后失效，1h TTL 只是兜底自愈上限。
app.get('/market/rumors', async (c) => {
  assertPublicRate(c, 'market');
  const win = await resolveRumorWindow(c.env.DB);
  const data = await cachedJson(
    `market-rumors:${win.season}:${win.windowSeq}`,
    ttlForScope('market', c.env.PUBLIC_CACHE_TTL_MS),
    () => buildRumors(c.env.DB, win),
    { scope: 'market', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json({ rumors: data });
});

// GET /api/market/deals —— 最近成交（v6.18.0 公开情报）：已完成单据最近 50 条。
// 走 0058 的 idx_transfers_status_time 早停（≈50 行索引条目 + 50 次 players 点查）。
// 金额语义按 type 不同：transfer/activation/forced_auction 的 fee = 成交价；free_agent/rc_change/match
// 的 fee = 新违约金；termination 的 fee = 0；extra_fee = 审核销毁的附加费（解约费/续约费/海捞费/匹配差额）。
// 中文标签由前端 TRANSFER_TYPE_LABEL 负责。to_club 侧必须 LEFT JOIN：termination 行 to_club_id 为 NULL，
// INNER JOIN 会把解约单整行丢掉。
app.get('/market/deals', async (c) => {
  assertPublicRate(c, 'market');
  const data = await cachedJson(
    'market-deals',
    ttlForScope('market', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const rows = await c.env.DB.prepare(
        `SELECT t.id, t.type, t.player_id, t.fee, t.extra_fee, t.season, t.window_seq, t.completed_at,
                ${sqlDisplayName('p')} AS player_name,
                cf.name AS from_club_name, ct.name AS to_club_name
         FROM transfers t
         JOIN players p ON p.id = t.player_id
         LEFT JOIN clubs cf ON cf.id = t.from_club_id
         LEFT JOIN clubs ct ON ct.id = t.to_club_id
         WHERE t.status = 'completed'
         ORDER BY t.completed_at DESC, t.id DESC
         LIMIT 50`,
      ).all<{
        id: number;
        type: string;
        player_id: number;
        fee: number | null;
        extra_fee: number | null;
        season: number | null;
        window_seq: number | null;
        completed_at: string | null;
        player_name: string;
        from_club_name: string | null;
        to_club_name: string | null;
      }>();
      return rows.results.map((r) => ({
        id: r.id,
        type: r.type,
        playerId: r.player_id,
        playerName: r.player_name,
        fromClubName: r.from_club_name,
        toClubName: r.to_club_name,
        fee: r.fee,
        extraFee: r.extra_fee,
        season: r.season,
        windowSeq: r.window_seq,
        completedAt: r.completed_at,
      }));
    },
    { scope: 'market', env: c.env, ctx: waitUntilOf(c) },
  );
  return c.json({ deals: data });
});

interface TransferBoardDbRow {
  id: number;
  uid: string;
  fc_id: number | null;
  name: string;
  display_name: string | null;
  club_id: number | null;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  list_price: number | null;
  transfer_listed_at: string | null;
  status: string;
  not_for_sale: number;
  pos1: number | null;
  pos2: number | null;
  pos3: number | null;
  pos4: number | null;
  club_name: string | null;
  release_fee: number | null;
  emphasis: number | null;
  emphasis_until: string | null;
  total_count: number;
}

// GET /api/market/transfer-board?limit= —— 转会广告板（v6.31.0）：各队「列入转会名单」的球员公开面。
// 只收 players.transfer_listed = 1；emphasis 取 player_promotions 现行最高档（0 普通 / 1 推荐 / 2 置顶），
// 该表本版只有读路径（付费写流程未实现，接口预留给「列入转会名单时的有偿选项」）。
// 公开数值只下发标价 list_price（/api/players 列表仍只下发布尔位，v6.30.0 口径不变）。
// 顺序：付费档（1/2）按着重度 → 挂出时间 → id；没有付费加权的（emphasis = 0）按「时间桶」轮换
// （5 分钟一桶，种子化洗牌 ⇒ 同一桶内所有访客同一份乱序、跨 isolate 同序）——见 core/ad-board.ts。
// 洗牌在缓存**之外**做（缓存键只有 limit）：桶号进键会把本端点重读放大 12 倍，而洗牌本身是纯函数。
// 用户还能在页面上手动「换一批」，那是纯前端本地重排，不再打端点。
// 新鲜度：改报价设置走 PUT /api/players/:id/offer-settings，/api/players 前缀命中 WRITE_SCOPE_PREFIXES
// ⇒ 自动 purge 全部公开 scope（含 market）；1h TTL 只是兜底。total = LIMIT 前的名单总人数（截断提示用）。
app.get('/market/transfer-board', async (c) => {
  assertPublicRate(c, 'market');
  // limit 默认 200、上限 200；非整数 / 非数字 / ≤0 / 空串回落默认（空串不走 Number('')=0 的坑；
  // 整数口径与 /market/sea-lookup 的 limit 解析一致）
  const raw = c.req.query('limit');
  const parsed = Number(raw);
  const limit = raw !== undefined && raw.trim() !== '' && Number.isInteger(parsed) && parsed > 0 ? Math.min(200, parsed) : 200;
  // 缓存只存 SQL 序（键 = limit）：**轮换不写进键**。桶长 5 分钟若进键，等于把本端点的重读从
  // 86400÷1h = 24 次/天/形状/colo 抬到 86400÷5min = 288 次（12 倍，见 docs/test-plans §7.4 读量核算）。
  // 洗牌放在缓存之外做：纯函数（种子 = 当前桶号）⇒ 同桶内任意 isolate 仍产出同一排列，
  // 而每次请求只花 O(名单人数) 的 CPU。
  const data = await cachedJson(
    `market-transfer-board:${limit}`,
    ttlForScope('market', c.env.PUBLIC_CACHE_TTL_MS),
    async () => {
      const rows = await c.env.DB.prepare(
        `SELECT p.id, p.uid, p.fc_id, p.name, p.display_name, p.club_id, p.position, p.age, p.ca, p.pa,
                p.list_price, p.transfer_listed_at, p.status, p.not_for_sale,
                json_extract(p.game_attrs, '$.PosID1') AS pos1,
                json_extract(p.game_attrs, '$.PosID2') AS pos2,
                json_extract(p.game_attrs, '$.PosID3') AS pos3,
                json_extract(p.game_attrs, '$.PosID4') AS pos4,
                cl.name AS club_name,
                ct.release_fee,
                pm.tier AS emphasis, pm.ends_at AS emphasis_until,
                COUNT(*) OVER () AS total_count
         FROM players p
         LEFT JOIN clubs cl ON cl.id = p.club_id
         LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
         LEFT JOIN (
           SELECT player_id, tier, ends_at FROM (
             SELECT player_id, tier, ends_at,
                    ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY tier DESC, ends_at DESC, id DESC) AS rn
             FROM player_promotions WHERE ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           ) WHERE rn = 1
         ) pm ON pm.player_id = p.id
         WHERE p.transfer_listed = 1
         ORDER BY CASE WHEN pm.tier IN (1, 2) THEN pm.tier ELSE 0 END DESC,
                  p.transfer_listed_at IS NULL, p.transfer_listed_at DESC, p.id DESC
         LIMIT ?`,
      )
        .bind(limit)
        .all<TransferBoardDbRow>();

      const slotNames = (v: unknown): string | null => {
        // 槽位缺失（NULL）不能走 Number() 归零：PositionID 0 是 GK，会把空槽错译成门将
        if (v === null || v === undefined) return null;
        const num = Number(v);
        return Number.isFinite(num) ? (POSITION_BY_ID[num] ?? null) : null;
      };
      // 队徽真源在比赛系统（v6.32.0）：本平台 clubs.logo_key 全仓无人写（写侧在 tour），生产全 NULL；
      // 照 routes/clubs.ts:95-105 的口径从 TOUR_DB team.logo_key 补齐（R2 键，/api/media 镜像下发）。
      // 在 cachedJson 计算体内做 ⇒ 缓存载荷自带 logoKey；对 tour 库只读、按本页名单内 club_id 点查。
      const clubIds = [...new Set(rows.results.map((r) => r.club_id).filter((x): x is number => x !== null))];
      const logoMap = new Map<number, string>();
      if (clubIds.length > 0) {
        const ph = clubIds.map(() => '?').join(',');
        const logoRows = await c.env.TOUR_DB.prepare(`SELECT id, logo_key FROM team WHERE id IN (${ph})`)
          .bind(...clubIds)
          .all<{ id: number; logo_key: string | null }>();
        for (const r of logoRows.results) if (r.logo_key) logoMap.set(r.id, r.logo_key);
      }
      const players = rows.results.map((r) => ({
          id: r.id,
          uid: r.uid,
          fcId: r.fc_id,
          name: rowDisplayName(r),
          positions: [r.position ?? slotNames(r.pos1), slotNames(r.pos2), slotNames(r.pos3), slotNames(r.pos4)]
            .filter((p): p is string => p !== null)
            .filter((p, i, arr) => arr.indexOf(p) === i),
          age: r.age,
          ca: r.ca,
          pa: r.pa,
          clubId: r.club_id,
          clubName: r.club_name,
          // 队徽走 R2（v6.32.0，真源 = tour 库 team.logo_key）：无徽由前端 TeamLogo 回落队名哈希色块
          logoKey: r.club_id !== null ? (logoMap.get(r.club_id) ?? null) : null,
          // 广告板只下发公开标价 list_price（v6.33.0：私密最低报价任何公开端点都不出）；releaseFee 无现行合同为 null
          listPrice: r.list_price,
          releaseFee: r.release_fee,
          listedAt: r.transfer_listed_at,
          // tier 只存 1/2，读取钳 0..2、越界按 0（普通）处理
          emphasis: r.emphasis === 1 || r.emphasis === 2 ? r.emphasis : 0,
          emphasisUntil: r.emphasis_until,
          // 与 /api/players 列表行同名字段，供前端复用 transferStatusOf
          status: r.status,
          notForSale: r.not_for_sale === 1,
          transferPriced: r.list_price !== null,
        }));
      return {
        players,
        total: rows.results[0]?.total_count ?? 0,
      };
    },
    { scope: 'market', env: c.env, ctx: waitUntilOf(c) },
  );
  // 轮换只动 emphasis = 0（没有付费加权）那一段：付费档（1 推荐 / 2 置顶）保持 SQL 序，
  // 排在前面的顺序就是「钱买到的东西」，不能被随机打散。数据来自缓存，所以这里不能原地改
  const paid = data.players.filter((p) => p.emphasis !== 0);
  const unpinned = data.players.filter((p) => p.emphasis === 0);
  return c.json({ players: [...paid, ...shuffleWithSeed(unpinned, transferBoardBucket(Date.now()))], total: data.total });
});

interface SeaLookupRow {
  id: number;
  fc_id: number | null;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  club_id: number | null;
  status: string;
  club_name: string | null;
}

// GET /api/market/sea-lookup —— 海捞速查（v6.18.0 教练情报台）：按球员 ID（fc_id 优先、内部 id 兜底）
// 或名字查 ≤8 名候选，各带可捞判定。⚠️ 本批量判定是 bypass.ts checkSeaSignEligible（单条真源：
// 球员详情 seaSign + createFreeAgent 提交链）的情报台快照副本：守卫顺序与文案逐字对齐，
// 两处口径必须同步改（tests 有跨实现一致性用例锁）。守卫链摊成 4 条批量查询：cpuClubIds / 本窗禁签 /
// 挂牌在途 / 审核在途。
app.get('/market/sea-lookup', async (c) => {
  await requireCoach(c.env, c.req.raw, 'club.squad.manage');

  const q = (c.req.query('q') ?? '').trim();
  if (q === '') throw new HttpError(400, '请输入球员 ID 或名字');

  const win = await getOpenWindow(c.env.DB);
  const rowSql = `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name, p.position, p.age, p.ca, p.pa,
            p.club_id, p.status, cl.name AS club_name
     FROM players p LEFT JOIN clubs cl ON cl.id = p.club_id`;
  let candidates: SeaLookupRow[] = [];
  if (/^\d+$/.test(q)) {
    const hit = await firstPlayerByRef<{ id: number }>(c.env.DB, 'id', Number(q));
    if (hit) {
      const row = await c.env.DB.prepare(`${rowSql} WHERE p.id = ?`).bind(hit.id).first<SeaLookupRow>();
      if (row) candidates = [row];
    }
  } else {
    const pattern = likeContains(foldNameQuery(q));
    const rows = await c.env.DB.prepare(
      `${rowSql}
       WHERE (${sqlFold(sqlDisplayName('p'))} LIKE ? ESCAPE '\\' OR ${sqlFold('p.name')} LIKE ? ESCAPE '\\')
       ORDER BY p.ca DESC, p.id LIMIT 8`,
    )
      .bind(pattern, pattern)
      .all<SeaLookupRow>();
    candidates = rows.results;
  }
  if (candidates.length === 0) return c.json({ results: [] });

  const ids = candidates.map((r) => r.id);
  const ph = ids.map(() => '?').join(', ');
  const cpuIds = await cpuClubIds(c.env.DB);
  const banned = new Set<number>();
  if (win) {
    const rows = await c.env.DB.prepare(
      `SELECT player_id FROM transfers WHERE type = 'termination' AND status = 'completed'
         AND season = ? AND window_seq = ? AND player_id IN (${ph})`,
    )
      .bind(win.season, win.windowSeq, ...ids)
      .all<{ player_id: number }>();
    for (const r of rows.results) banned.add(r.player_id);
  }
  const listed = new Set<number>();
  const usedListings = await c.env.DB.prepare(
    `SELECT player_id FROM listings WHERE status IN ('listed', 'bidding', 'matched_pending', 'pending_review')
       AND player_id IN (${ph})`,
  )
    .bind(...ids)
    .all<{ player_id: number }>();
  for (const r of usedListings.results) listed.add(r.player_id);
  const pending = new Set<number>();
  const usedPending = await c.env.DB.prepare(
    `SELECT player_id FROM transfers WHERE status = 'pending_review' AND player_id IN (${ph})`,
  )
    .bind(...ids)
    .all<{ player_id: number }>();
  for (const r of usedPending.results) pending.add(r.player_id);

  return c.json({
    results: candidates.map((r) => {
      // 阶段顺序与 checkSeaSignEligible 一致：window → ownership → status → banned → listing → pending
      let reason: string | null = null;
      if (!win) reason = '转会窗口没开，现在不能海捞';
      else if (r.club_id !== null && !cpuIds.has(r.club_id)) reason = '海捞只能签无归属的球员（这名球员有东家）';
      else if (r.status === 'retired' || r.status === 'listed') reason = '当前状态不能海捞';
      else if (banned.has(r.id)) reason = '这名球员本窗口被解约过，本窗口所有球队都不能签他';
      else if (listed.has(r.id)) reason = '这名球员已经有一单在市场流程里了，等它结束再操作';
      else if (pending.has(r.id)) reason = '这名球员有一张单据正在等管理组审核，先等审核结果';
      return {
        id: r.id,
        fcId: r.fc_id,
        name: r.name,
        position: r.position,
        age: r.age,
        ca: r.ca,
        pa: r.pa,
        clubName: r.club_name,
        seaSign: { eligible: reason === null, reason },
      };
    }),
  });
});

// GET /api/market/activatable —— 可激活球员（v6.18.0，替换退役的 /market/trainees）：教练侧列出
// 自己队以外的 normal/trainee 球员（?mode=trainee 只看训练营），附激活费与状态标记。
// activationFee 口径 = activations.ts 的 askPrice（训练营固定 5m；正式合同按保护期倍数，4.4.2.3）；
// justSigned 口径 = activations.ts「刚签约不可激活」409 前置（效力为 0）；activatedThisWindow 口径 =
// 4.4.2.1 一窗一次（失效激活也占额，批量化查询照搬退役 trainees 实现）。
app.get('/market/activatable', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, players: [] });

  const mode = c.req.query('mode');
  const statusSql = mode === 'trainee' ? `'trainee'` : `'normal', 'trainee'`;
  // 空串按没给算（Number('')===0 会把 ?limit= 钳成 1 行，v6.18.0 评审 P3）
  const limitRaw = c.req.query('limit');
  const limit = limitRaw !== undefined && limitRaw.trim() !== '' && Number.isInteger(Number(limitRaw))
    ? Math.min(100, Math.max(1, Number(limitRaw)))
    : 100;

  const filters = [`p.club_id IS NOT NULL`, `p.club_id != ?`, `p.status IN (${statusSql})`];
  const args: (number | string)[] = [club.id];
  const q = (c.req.query('q') ?? '').trim();
  if (q !== '') {
    const pattern = likeContains(foldNameQuery(q));
    filters.push(`(${sqlFold(sqlDisplayName('p'))} LIKE ? ESCAPE '\\' OR ${sqlFold('p.name')} LIKE ? ESCAPE '\\')`);
    args.push(pattern, pattern);
  }

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.fc_id, ${sqlDisplayName('p')} AS name, p.position, p.age, p.ca, p.pa,
            p.status, cl.id AS club_id, cl.name AS club_name,
            ct.contract_type, ct.release_fee, ct.protection_ticks, ct.service_ticks
     FROM players p
     JOIN clubs cl ON cl.id = p.club_id
     JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1
     WHERE ${filters.join(' AND ')}
     ORDER BY p.ca DESC, p.id
     LIMIT ?`,
  )
    .bind(...args, limit)
    .all<{
      id: number;
      fc_id: number | null;
      name: string;
      position: string | null;
      age: number | null;
      ca: number | null;
      pa: number | null;
      status: string;
      club_id: number;
      club_name: string;
      contract_type: string;
      release_fee: number | null;
      protection_ticks: number | null;
      service_ticks: number | null;
    }>();

  // 窗刻度（v3.0.0）：保护期倍数与 justSigned 都要它；SQL 片段口径与 closedRegularTicks 一致
  const ticks = await c.env.DB.prepare(`SELECT ${CURRENT_TICKS_SQL} AS n`).first<{ n: number }>();
  const currentTicks = ticks?.n ?? 0;

  // 本窗口已被激活过的标记（4.4.2.1 一窗一次；失效激活也占额）
  const win = await getOpenWindow(c.env.DB);
  const activated = new Set<number>();
  if (win) {
    const used = await c.env.DB.prepare(
      `SELECT player_id FROM listings WHERE type = 'activation' AND season = ? AND window_seq = ? AND player_id IN (${rows.results.map(() => '?').join(', ') || 'NULL'})`,
    )
      .bind(win.season, win.windowSeq, ...rows.results.map((r) => r.id))
      .all<{ player_id: number }>();
    for (const r of used.results) activated.add(r.player_id);
  }

  return c.json({
    club: { id: club.id, name: club.name },
    players: rows.results.map((r) => ({
      id: r.id,
      fcId: r.fc_id,
      name: r.name,
      position: r.position,
      age: r.age,
      ca: r.ca,
      pa: r.pa,
      status: r.status,
      club: { id: r.club_id, name: r.club_name },
      contractType: r.contract_type,
      // 正式合同缺违约金（release_fee NULL/0）→ 费用 null：行级兜底，不许整页 500
      //（v6.18.0 测试轮实测过：一名这样的球员曾让名单打不开）；提交端另有同口径 409 兜底
      activationFee:
        r.contract_type === 'trainee'
          ? TRAINEE_ACTIVATION_FEE
          : r.release_fee != null && r.release_fee > 0
            ? activationFee(r.release_fee, r.protection_ticks, currentTicks)
            : null,
      activatedThisWindow: activated.has(r.id),
      justSigned: currentTicks <= (r.service_ticks ?? 0),
    })),
  });
});

// POST /api/market/activations —— 激活挂牌（4.4.2）：训练营球员固定 5m、普通球员按保护期
// 倍数价；激活方须在出价窗内落首价（期间他队出价无效），否则激活无效。
// 与 POST /api/transfers/activation 同源（见 activations.ts）。
app.post('/market/activations', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);

  const body = (await c.req.raw.json().catch(() => null)) as { playerId?: unknown; proofMediaKey?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  return c.json(await createActivation(c.env, club.id, user.id, body.playerId, body.proofMediaKey), 201);
});

// POST /api/market/listings/:id/activation-report —— 激活通知举报（v6.4.0 改动 4，仅被激活方）
// 用户裁决：被激活方可以举报「没在 QQ 收到激活通知」。举报只建管理核查任务 + 通知激活方，
// 不改挂牌状态、不冻结匹配窗（匹配与到期照常走）；是否影响成交由管理组裁量（不自动改数据）。
app.post('/market/listings/:id/activation-report', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');

  const listing = await c.env.DB.prepare(
    `SELECT id, player_id, seller_club_id, activated_by, status, activation_proof FROM listings WHERE id = ? AND type = 'activation'`,
  )
    .bind(id)
    .first<{ id: number; player_id: number; seller_club_id: number; activated_by: number | null; status: string; activation_proof: string | null }>();
  if (!listing) throw new HttpError(404, '这单激活挂牌不存在');
  if (listing.seller_club_id !== club.id) throw new HttpError(403, '只有被激活方可以举报这份激活通知');
  if (listing.activated_by === null || !['listed', 'bidding', 'matched_pending'].includes(listing.status)) {
    throw new HttpError(409, '这单激活已经结束，不用再举报了');
  }
  const dup = await c.env.DB
    .prepare(`SELECT id FROM review_tasks WHERE type = 'activation_report' AND ref_id = ? AND status = 'open' LIMIT 1`)
    .bind(id)
    .first<{ id: number }>();
  if (dup) throw new HttpError(409, '这单激活已经有人在核查了，等管理组处理');

  const audit = createAuditStatement(c.env.DB);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO review_tasks (type, ref_id, payload, status) VALUES ('activation_report', ?, ?, 'open')`,
    ).bind(
      id,
      JSON.stringify({ listingId: id, playerId: listing.player_id, activatorClubId: listing.activated_by, sellerClubId: listing.seller_club_id, proofKey: listing.activation_proof }),
    ),
    audit({
      actor: user.id,
      action: 'activation_report',
      targetType: 'listing',
      targetId: id,
      origin: 'user',
      after: { playerId: listing.player_id, activatorClubId: listing.activated_by, byClubId: club.id },
    }),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) throw new HttpError(409, '举报没落库，刷新再试');
  await queueClubNotification(c.env, listing.activated_by, 'activation_reported', { listingId: id });
  return c.json({ ok: true }, 201);
});

// GET /api/market/listings/:id —— 详情 + 出价历史
app.get('/market/listings/:id', async (c) => {
  await settleOverdue(c.env, { origin: 'lazy_settle' });
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
  const listing = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_at, l.last_bid_at,
            l.listed_day, l.deadline_at, l.deadline_note, l.season, l.window_seq, l.activated_by, l.activation_deadline, l.match_deadline, l.bid_paused,
            ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id, p.position, p.age, p.ca, p.pa,
            cl.name AS seller_name, ca2.name AS activator_name
     FROM listings l
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
     LEFT JOIN clubs ca2 ON ca2.id = l.activated_by
     WHERE l.id = ?`,
  )
    .bind(id)
    .first<ListingRow>();
  if (!listing) throw new HttpError(404, '这单挂牌不存在（或还没产生）');

  const [contract, bids, ctx, windowOpen] = await Promise.all([
    c.env.DB.prepare('SELECT release_fee, wage, contract_type FROM contracts WHERE player_id = ? AND is_active = 1')
      .bind(listing.player_id)
      .first<{ release_fee: number | null; wage: number | null; contract_type: string }>(),
    c.env.DB.prepare(
      `SELECT b.id, b.club_id, b.amount, b.created_at, b.status, cl.name AS club_name
       FROM bids b JOIN clubs cl ON cl.id = b.club_id
       WHERE b.listing_id = ? ORDER BY b.id DESC LIMIT 50`,
    )
      .bind(id)
      .all<{ id: number; club_id: number; amount: number; created_at: string; status: string; club_name: string }>(),
    loadMarketContext(c.env.DB),
    isWindowOpen(c.env.DB, listing.season, listing.window_seq),
  ]);

  let deadlineAt: string | null = null;
  // v6.24.0：listed 的普通挂牌也回截止时刻（挂牌即落 deadline_at）；激活首价窗看 activationDeadline
  // v6.24.1：与列表口径一致——强制拍卖创建即落列，listed 同轨回传（激活仍豁免，看首价窗列）
  if ((listing.status === 'bidding' || (listing.status === 'listed' && listing.type !== 'activation')) && listing.listed_day !== null) {
    // 优先读落库列（v6.4.0 改动 A），存量行 NULL 回落实时算
    deadlineAt =
      listing.deadline_at ??
      bidDeadline({
        lastBidAt: listing.last_bid_at,
        listedDay: listing.listed_day,
        now: new Date(),
        deadlineHours: ctx.deadlineHours,
        silenceHours: ctx.silenceHours,
        calendar: ctx.calendar,
      }).deadlineAt;
  }
  const highestActive = await c.env.DB
    .prepare(`SELECT MAX(amount) AS highest FROM bids WHERE listing_id = ? AND status = 'active'`)
    .bind(id)
    .first<{ highest: number | null }>();
  // 评审修复（P2-②）：出价必须为整数，最低可出价向上取整——ceil(最高价+步长) / ceil(挂牌价)，
  // 与 validateBidAmount（整数准入）和表单预填口径一致，避免前端预填一个提交必被拒的小数
  const nextMinBid =
    highestActive?.highest !== null && highestActive?.highest !== undefined
      ? Math.ceil(highestActive.highest + ctx.bidStepMin)
      : Math.ceil(listing.ask_price);

  return c.json({
    marketBidPaused: (await createConfigService(c.env.DB).get('market_bid_paused')) === 'true',
    listing: {
      id: listing.id,
      player: { id: listing.player_id, fcId: listing.player_fc_id, name: listing.player_name, position: listing.position, age: listing.age, ca: listing.ca, pa: listing.pa },
      sellerClub: { id: listing.seller_club_id, name: listing.seller_name },
      type: listing.type,
      askPrice: listing.ask_price,
      status: listing.status,
      listedAt: listing.listed_at,
      lastBidAt: listing.last_bid_at,
      bidPaused: listing.bid_paused === 1,
      releaseFee: contract?.release_fee ?? null,
      deadlineAt,
      deadlineNote: listing.deadline_note,
      windowOpen,
      nextMinBid,
      bidStepMin: ctx.bidStepMin,
      activatedBy: listing.activated_by,
      activatorName: listing.activator_name ?? null,
      activationDeadline: listing.activation_deadline,
      matchDeadline: listing.match_deadline,
      matchPhase:
        listing.type === 'activation'
          ? listing.status === 'listed'
            ? 'first_bid'
            : listing.status === 'matched_pending'
              ? 'matching'
              : null
          : null,
      firstBidPending: listing.type === 'activation' && bids.results.length === 0 && listing.activated_by !== null,
    },
    bids: bids.results.map((b) => ({
      id: b.id,
      clubId: b.club_id,
      clubName: b.club_name,
      amount: b.amount,
      createdAt: b.created_at,
      status: b.status,
    })),
  });
});

// POST /api/market/listings/:id/bids —— 出价（资金冻结先行，§6.4-1）
app.post('/market/listings/:id/bids', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  assertTradable(club);

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '挂牌 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { amount?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '出价金额须为正数（单位 m）');

  // 惰性结算先跑：可能这单刚好截止，出价要被拒
  await settleOverdue(c.env, { origin: 'lazy_settle' });

  // 全局暂停出价（管理端干预开关；已出的价与到期结算不受影响）
  if ((await createConfigService(c.env.DB).get('market_bid_paused')) === 'true') {
    throw new HttpError(423, '全市场出价已暂停（管理组干预中），恢复后再来', 'bid_paused');
  }

  const listing = await c.env.DB.prepare(
    `SELECT l.id, l.player_id, l.seller_club_id, l.type, l.ask_price, l.status, l.listed_day, l.deadline_at, l.activated_by, l.activation_deadline, l.season, l.window_seq, l.bid_paused,
            ct.contract_type AS player_contract_type
     FROM listings l
     LEFT JOIN contracts ct ON ct.player_id = l.player_id AND ct.is_active = 1
     WHERE l.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      player_id: number;
      seller_club_id: number;
      type: string;
      ask_price: number;
      status: string;
      listed_day: string | null;
      deadline_at: string | null;
      activated_by: number | null;
      activation_deadline: string | null;
      season: number | null;
      window_seq: number | null;
      bid_paused: number;
      player_contract_type: string | null;
    }>();
  if (!listing) throw new HttpError(404, '这单挂牌不存在');
  if (listing.bid_paused === 1) throw new HttpError(423, '这单被管理组暂停出价，恢复后再来', 'listing_bid_paused');
  // 截止绝对时刻化（v6.4.0）：过线可读拒绝（触发器 fund_holds_bid_deadline_guard 在事务内兜底）
  if (listing.deadline_at !== null && listing.deadline_at <= new Date().toISOString()) {
    throw new HttpError(409, '这单竞价已截止，等结算进审核', 'bid_deadline_passed');
  }
  // v6.24.0：激活首价窗内 deadline_at 为 NULL，过线判定改看 activation_deadline（触发器 0059 兜底）；
  // 出价窗已过则该单会被惰性结算 void，这里先给可读 409
  if (listing.activation_deadline !== null && listing.activation_deadline <= new Date().toISOString()) {
    throw new HttpError(409, '激活出价窗已过，这单不再接受出价', 'bid_deadline_passed');
  }
  if (listing.seller_club_id === club.id) throw new HttpError(403, '不能对自己俱乐部的挂牌出价');
  if (listing.type === 'activation' && listing.status === 'matched_pending') {
    throw new HttpError(409, '竞价已截止，被激活方正在考虑是否匹配，这单已停止接受出价');
  }
  if (listing.status !== 'listed' && listing.status !== 'bidding') {
    throw new HttpError(409, listing.status === 'pending_review' ? '这单已经截止，正在等管理组审核' : '这单已经结束，不能再出价');
  }
  if (!(await isWindowOpen(c.env.DB, listing.season, listing.window_seq))) {
    throw new HttpError(409, '这单所属的转会窗口已经关了');
  }

  const isActivation = listing.type === 'activation';
  // 评审修复（P2-③）：highest/total 只认 active 出价——与冻结触发器（0005）、结算分流
  // （market-settle 的 active 计数）口径一致；撤销/被覆盖的历史出价不再影响首价判定与最低抬价
  const bidStats = await c.env.DB
    .prepare(
      `SELECT MAX(CASE WHEN status = 'active' THEN amount END) AS highest,
              COUNT(CASE WHEN status = 'active' THEN 1 END) AS total
       FROM bids WHERE listing_id = ?`,
    )
    .bind(id)
    .first<{ highest: number | null; total: number }>();
  const highest = bidStats?.highest ?? null;
  // v6.24.0：首价窗 = 激活挂牌还没人落首价；激活方落首价后照常公开竞价（首价即起拍价）
  const firstBidPending = isActivation && (bidStats?.total ?? 0) === 0;
  if (firstBidPending) {
    // 4.4.2.2：出价窗内只有激活方能落首价，他队出价无效；出价窗已过则该单已被惰性结算作废
    if (listing.activated_by !== club.id) {
      throw new HttpError(403, '激活挂牌的首价窗内只有激活方可以出价，等激活方出价后再看结果');
    }
    // 评审修复（P0-1）：首价 = 激活价，而激活价本身可能是非整数（保护期 releaseFee>20 → 1.5 倍
    // 如 31.5；导入通道不要求整数）。首价路径不能过 validateBidAmount 的整数准入，
    // 否则非整数激活单永远落不了首价：窗到期作废、额度白耗、文案冤枉激活方。
    // 「有限且为正」已在上方统一校验，这里只做等值判定；抬价路径（已有 active 出价）仍走整数校验
    if (amount !== listing.ask_price) {
      throw new HttpError(400, '激活方首价固定为激活价');
    }
  } else {
    const bidError = validateBidAmount(amount, highest, listing.ask_price);
    if (bidError) throw new HttpError(400, bidError);
  }

  // 可用余额预检（触发器 0005 在事务内兜底同一公式，这里给可读报错）
  const myHold = await c.env.DB
    .prepare(`SELECT amount FROM fund_holds WHERE club_id = ? AND ref_type = 'listing' AND ref_id = ? AND status = 'held' LIMIT 1`)
    .bind(club.id, id)
    .first<{ amount: number }>();
  const available = await availableBalance(c.env.DB, club.id);
  const effectiveAvailable = available + (myHold?.amount ?? 0);
  if (amount > round2(effectiveAvailable + Number.EPSILON)) {
    throw new HttpError(400, `可用资金不足：可支配 ${round2(effectiveAvailable)} m，出价需要 ${round2(amount)} m（出价即冻结）`);
  }

  const audit = createAuditStatement(c.env.DB);
  const mctx = await loadMarketContext(c.env.DB);
  const nowIso = new Date().toISOString();
  // 出价成功即把新一段静默期的绝对截止时刻落库（静默起点 = 本次出价；v6.24.0 起激活首价同样如此）。
  // 此后展示与结算都读列，不再各自实时计算（5 分钟漂移归零）
  let nextDeadlineIso: string | null = null;
  if (listing.listed_day !== null) {
    nextDeadlineIso = bidDeadline({
      lastBidAt: nowIso,
      listedDay: listing.listed_day,
      now: new Date(),
      deadlineHours: mctx.deadlineHours,
      silenceHours: mctx.silenceHours,
      calendar: mctx.calendar,
    }).deadlineAt;
  }
  // 出价推进带过线守卫（竞价 deadline_at 或激活首价窗 activation_deadline 已过 = 拒绝刷新；
  // 触发器 WHL_BID_REJECT_DEADLINE（0059 版）在冻结语句上先行拦截）
  const listingAdvance = `UPDATE listings SET status = 'bidding', last_bid_at = ${nowSql()}, activation_deadline = NULL, deadline_at = ?
     WHERE id = ? AND status IN ('listed', 'bidding')
       AND (deadline_at IS NULL OR deadline_at > ${nowSql()})
       AND (activation_deadline IS NULL OR activation_deadline > ${nowSql()})`;
  const statements = [
    // 1) 冻结：触发器校验挂牌在竞价/金额达步长/可用资金，任一不满足 ABORT 回滚整批
    c.env.DB.prepare(
      `INSERT INTO fund_holds (club_id, amount, status, ref_type, ref_id, created_at)
       VALUES (?, ?, 'held', 'listing', ?, ${nowSql()})`,
    ).bind(club.id, round2(amount), id),
    // 2) 出价落库，hold_id 指回刚建的冻结（同事务可见；金额+挂牌唯一确定）
    c.env.DB.prepare(
      `INSERT INTO bids (listing_id, club_id, amount, created_at, status, hold_id)
       SELECT ?, ?, ?, ${nowSql()}, 'active',
              (SELECT id FROM fund_holds WHERE club_id = ? AND ref_type = 'listing' AND ref_id = ? AND status = 'held' AND amount = ? ORDER BY id DESC LIMIT 1)`,
    ).bind(id, club.id, round2(amount), club.id, id, round2(amount)),
    // 3) 之前的活跃出价全部作废（含自己旧价）
    c.env.DB.prepare(`UPDATE bids SET status = 'superseded' WHERE listing_id = ? AND status = 'active' AND id != last_insert_rowid()`).bind(id),
    // 4) 落选出价的冻结解冻
    c.env.DB.prepare(
      `UPDATE fund_holds SET status = 'released'
       WHERE ref_type = 'listing' AND ref_id = ? AND status = 'held'
         AND id NOT IN (SELECT hold_id FROM bids WHERE listing_id = ? AND status = 'active' AND hold_id IS NOT NULL)`,
    ).bind(id, id),
    // 5) 挂牌推进：一律转入公开竞价并落新截止时刻（激活首价落定同样进竞价）
    c.env.DB.prepare(listingAdvance).bind(nextDeadlineIso, id),
    audit({
      actor: user.id,
      action: 'bid_place',
      targetType: 'listing',
      targetId: id,
      origin: 'user',
      after: { clubId: club.id, amount: round2(amount) },
    }),
  ];
  try {
    const results = await c.env.DB.batch(statements);
    if ((results[1].meta.changes ?? 0) !== 1) throw new HttpError(409, '出价没落库，行情刚变过，刷新再试');
    // 评审修复（P2-①）：推进挂牌（results[4]）必须恰好改到 1 行——守卫漂移（将来谁放宽了那段
    // SQL）时显式报 'already'，不留「冻结/出价已落库但挂牌没推进」的静默半笔。真正的并发竞态
    // 由触发器 0005/0059 在事务内先整批拦下（那一步才是原子回滚），这里是最后一层可读断言
    if ((results[4].meta.changes ?? 0) !== 1) {
      throw new HttpError(400, '出价没落库：这单刚被结算或作废，刷新再试', 'already');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('WHL_BID_REJECT_FUNDS')) throw new HttpError(400, '可用资金不足：出价即冻结，冻结没过账这单就不算数');
    if (msg.includes('WHL_BID_REJECT_AMOUNT')) throw new HttpError(409, '出价没赶上：刚有人出了更高的价，或金额没达到当前最低要求');
    if (msg.includes('WHL_BID_REJECT_DEADLINE')) throw new HttpError(409, '这单竞价刚好截止，出价没赶上，等结算进审核', 'bid_deadline_passed');
    if (msg.includes('WHL_BID_REJECT_CLOSED')) throw new HttpError(409, '这单刚好不在竞价状态了，刷新看看');
    throw err;
  }

  const bid = await c.env.DB
    .prepare(`SELECT id, amount, created_at FROM bids WHERE listing_id = ? AND club_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(id, club.id)
    .first<{ id: number; amount: number; created_at: string }>();

  // v6.24.0：激活方落首价不再当场收口——转入公开竞价，截止后由惰性结算按合同类型分流
  return c.json({ ok: true, bid, deadlineAt: nextDeadlineIso, ...(isActivation ? { matchPhase: 'bidding' } : {}) }, 201);
});

// GET /api/me/bids —— 我的出价（含冻结状态章）
app.get('/me/bids', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id);
  if (!club) return c.json({ club: null, bids: [] });
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.listing_id, b.amount, b.created_at, b.status AS bid_status,
            f.status AS hold_status, l.status AS listing_status, l.ask_price,
            p.id AS player_id, p.fc_id AS player_fc_id, ${sqlDisplayName('p')} AS player_name, p.position, p.ca, p.pa,
            cl.name AS seller_name
     FROM bids b
     JOIN listings l ON l.id = b.listing_id
     JOIN players p ON p.id = l.player_id
     JOIN clubs cl ON cl.id = l.seller_club_id
     LEFT JOIN fund_holds f ON f.id = b.hold_id
     WHERE b.club_id = ?
     ORDER BY b.id DESC LIMIT 100`,
  )
    .bind(club.id)
    .all<{
      id: number;
      listing_id: number;
      amount: number;
      created_at: string;
      bid_status: string;
      hold_status: string | null;
      listing_status: string;
      ask_price: number;
      player_id: number;
      player_fc_id: number | null;
      player_name: string;
      position: string | null;
      ca: number | null;
      pa: number | null;
      seller_name: string;
    }>();
  return c.json({
    club: { id: club.id, name: club.name },
    bids: rows.results.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      amount: r.amount,
      createdAt: r.created_at,
      status: r.bid_status,
      holdStatus: r.hold_status,
      listingStatus: r.listing_status,
      askPrice: r.ask_price,
      player: { id: r.player_id, fcId: r.player_fc_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
      sellerClubName: r.seller_name,
    })),
  });
});

// GET /api/transfers/:id —— 单据详情（公开）
app.get('/transfers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '单据 ID 不对');
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.type, t.player_id, t.from_club_id, t.to_club_id, t.fee, t.tax, t.extra_fee, t.matched,
            t.status, t.season, t.window_seq, t.created_at, t.completed_at,
            ${sqlDisplayName('p')} AS player_name, p.fc_id AS player_fc_id,
            cf.name AS from_name, ct.name AS to_name
     FROM transfers t
     JOIN players p ON p.id = t.player_id
     LEFT JOIN clubs cf ON cf.id = t.from_club_id
     LEFT JOIN clubs ct ON ct.id = t.to_club_id
     WHERE t.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      type: string;
      player_id: number;
      from_club_id: number | null;
      to_club_id: number | null;
      fee: number | null;
      tax: number | null;
      extra_fee: number | null;
      matched: number;
      status: string;
      season: number | null;
      window_seq: number | null;
      created_at: string | null;
      completed_at: string | null;
      player_name: string;
      player_fc_id: number | null;
      from_name: string | null;
      to_name: string | null;
    }>();
  if (!t) throw new HttpError(404, '单据不存在');
  return c.json({
    transfer: {
      id: t.id,
      type: t.type,
      status: t.status,
      player: { id: t.player_id, fcId: t.player_fc_id, name: t.player_name },
      fromClub: t.from_club_id === null ? null : { id: t.from_club_id, name: t.from_name },
      toClub: t.to_club_id === null ? null : { id: t.to_club_id, name: t.to_name },
      fee: t.fee,
      tax: t.tax,
      extraFee: t.extra_fee,
      matched: t.matched === 1,
      season: t.season,
      windowSeq: t.window_seq,
      createdAt: t.created_at,
      completedAt: t.completed_at,
    },
  });
});

export default app;
