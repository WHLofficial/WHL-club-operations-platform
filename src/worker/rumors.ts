// 转会传闻生成器（v6.18.0 市场情报）：系统自动派生、只涉猎转会域、真真假假（用户裁决）。
// 无落库：种子钉 [season, windowSeq]，seededUnit 确定性抽签——同窗内 8 条逐字稳定、
// 刷新不变、下窗自动换血；与事件域（event-ops）/ 档期域（venue-ops）同一确定性伪随机纪律。
//
// 真假对用户绝不可见：响应不下发任何真/假标记。真传闻 = 真实事实套不确定语气（在售池 /
// 近期成交池派生）；假传闻 = 无真实关联的球员×球队组合。玩家点球员名链接自行查证——
// 真传闻查有实据、假传闻查无此事，这就是玩法。
//
// 读量：事实池共 4 条查询（在售 50 行 / 成交池走 idx_transfers_status_time 早停 30 行 /
// 假料球员主键 IN 点查 / clubs 全读 ~25 行），且端点挂 cachedJson 1h——loader 每 colo
// 每小时至多跑一次。
import { seededUnit } from './venue-ops.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { getOpenWindow, getVisibleSeason } from './seasons.ts';

export interface RumorSeedWindow {
  season: number;
  windowSeq: number;
}

/** 传闻种子窗口：开窗取开窗；两窗之间取可见赛季 + 窗号 0（对齐 triggerEventBatch 缺省口径） */
export async function resolveRumorWindow(db: D1Database): Promise<RumorSeedWindow> {
  const open = await getOpenWindow(db);
  if (open) return { season: open.season, windowSeq: open.windowSeq };
  const season = await getVisibleSeason(db);
  return { season: season ?? 0, windowSeq: 0 };
}

export interface RumorItem {
  /** 稳定 id（种子派生）：r{season}-{window}-{slot} */
  id: string;
  text: string;
  /** 内嵌链接目标：玩家点过去自行查证真假 */
  playerId: number;
  playerName: string;
  clubName: string;
}

const RUMOR_COUNT = 8;
const FAKE_PLAYER_POOL = 16;
const FAKE_MAX_ROUNDS = 3;
/** players.id 导入后 1..18301 稠密；上界放宽到 20000 容忍将来扩容（约 8.5% 抽签 miss，
 * 靠多轮重抽兜底）——扩库或重导时记得同步这个上界，miss 率高会削减假料池 */
const FAKE_ID_RANGE = 20_000;

// 真传闻模板按事实方向分两族（评审 P1-2：在售事实的 {club} 是卖家=现东家、成交事实的
// {club} 是新东家——混用一套买方视角模板会输出「甲队考察自家球员」这类错句）。
// 在售族（{club}=现东家，卖方语气；5 条——真料槽最多 5 个，同批轮转不重复）：
const TRUTH_SALE_TEMPLATES = [
  '据队内消息，{club} 已把 {player} 放进可谈名单，报价到位即放人。',
  '经纪圈盛传 {club} 愿意倾听对 {player} 的报价，要价不会低。',
  '{club} 更衣室都在讨论 {player} 的去留，据悉只要价格合适就谈。',
  '据悉 {club} 给 {player} 标了价，只等一个合适的下家接盘。',
  '更衣室消息：{club} 已经在物色 {player} 的替代者，出售只是时间问题。',
];
// 成交族（{club}=新东家，回顾式语气——传闻与已达成事实不矛盾；5 条同上理由）：
const TRUTH_DEAL_TEMPLATES = [
  '{player} 的名字频繁出现在 {club} 的球探报告里，据说考察已持续数周——如今看来早有伏笔。',
  '有消息人士早就透露过，{club} 对 {player} 的兴趣是认真的——现在大家信了。',
  '{player} 与 {club} 的绯闻传了数周，如今尘埃落定，知情者表示并不意外。',
  '早在窗口开启前，{club} 就被曝在接触 {player} 的经纪人——现在看绝非空穴来风。',
  '{player} 的转会是 {club} 早就布局好的一步棋，据说谈判比外界知道的早得多。',
];

// 假传闻模板：无真实关联的球员×球队组合
const FAKE_TEMPLATES = [
  '更衣室流传 {player} 对 {club} 的项目很心动，下个窗口可能有故事。',
  '某不愿具名的经纪人透露，{club} 正在为 {player} 准备一份「难以拒绝」的报价。',
  '多名球探被目击出现在 {club} 的看台，考察对象据说正是 {player}。',
  '{player} 的经纪人与 {club} 高层被拍到同进同出一家餐厅，谈话内容不详。',
  '{club} 内部已为 {player} 预留了预算空间，就等窗口敲开。',
  '据悉 {player} 已婉拒其他邀约，只为等待 {club} 的正式报价。',
];

interface SaleFact {
  playerId: number;
  playerName: string;
  /** 卖家（=球员现东家） */
  clubId: number;
  clubName: string;
}

interface DealFact {
  playerId: number;
  playerName: string;
  toClubId: number | null;
  toClubName: string | null;
  fromClubId: number | null;
  fromClubName: string | null;
}

interface FakePlayer {
  id: number;
  name: string;
  clubId: number | null;
}

interface ClubFact {
  id: number;
  name: string;
}

interface FactPool {
  sales: SaleFact[];
  deals: DealFact[];
  fakePlayers: FakePlayer[];
  clubs: ClubFact[];
}

function fill(tpl: string, playerName: string, clubName: string): string {
  return tpl.replaceAll('{player}', playerName).replaceAll('{club}', clubName);
}

/** 种子洗牌：同种子同序，确定性 */
function seededShuffle<T>(items: T[], seed: number[], draw: number): T[] {
  return items
    .map((v, i) => ({ v, k: seededUnit([...seed, i], draw) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

async function loadFactPool(db: D1Database, seed: number[]): Promise<FactPool> {
  // 真实在售池（对齐挂牌板 active 口径，market.ts:65-79）
  const salesRows = await db
    .prepare(
      // v6.18.0 修复：列名一律 AS 成接口里的 camelCase 键——D1 按 SQL 列名给键，
      // 不别名时 SaleFact.playerId 读出来是 undefined（真料文本会直接渲染 "undefined"）
      `SELECT l.player_id AS playerId, l.seller_club_id AS clubId, cl.name AS clubName, ${sqlDisplayName('p')} AS playerName
       FROM listings l
       JOIN players p ON p.id = l.player_id
       JOIN clubs cl ON cl.id = l.seller_club_id
       WHERE l.status IN ('listed', 'bidding', 'matched_pending')
       ORDER BY l.id DESC LIMIT 50`,
    )
    .all<SaleFact>();

  // 真实近期成交（走 idx_transfers_status_time 早停；只取市场类四 type）
  const dealRows = await db
    .prepare(
      `SELECT t.player_id AS playerId, t.to_club_id AS toClubId, t.from_club_id AS fromClubId,
              tc.name AS toClubName, fc.name AS fromClubName,
              ${sqlDisplayName('p')} AS playerName
       FROM transfers t
       JOIN players p ON p.id = t.player_id
       LEFT JOIN clubs tc ON tc.id = t.to_club_id
       LEFT JOIN clubs fc ON fc.id = t.from_club_id
       WHERE t.status = 'completed' AND t.type IN ('transfer', 'activation', 'forced_auction', 'free_agent')
       ORDER BY t.completed_at DESC, t.id DESC LIMIT 30`,
    )
    .all<DealFact>();

  // 假料球员：seededUnit 生成随机 id 主键点查（退役球员不做传闻对象），miss 忽略重抽
  const fakePlayers: FakePlayer[] = [];
  outer: for (let round = 0; round < FAKE_MAX_ROUNDS; round += 1) {
    const ids: number[] = [];
    for (let j = 0; j < FAKE_PLAYER_POOL; j += 1) {
      ids.push(1 + Math.floor(seededUnit([...seed, round, j], 9) * FAKE_ID_RANGE));
    }
    const rows = await db
      .prepare(
        `SELECT p.id, p.club_id AS clubId, ${sqlDisplayName('p')} AS name
         FROM players p WHERE p.id IN (${ids.map(() => '?').join(', ')}) AND p.status != 'retired'
         ORDER BY p.id`,
      )
      .bind(...ids)
      .all<FakePlayer>();
    const seen = new Set(fakePlayers.map((p) => p.id));
    for (const r of rows.results) {
      if (!seen.has(r.id)) {
        fakePlayers.push(r);
        seen.add(r.id);
      }
    }
    if (fakePlayers.length >= FAKE_PLAYER_POOL) break outer;
  }

  const clubRows = await db.prepare('SELECT id, name FROM clubs ORDER BY id').all<ClubFact>();

  return { sales: salesRows.results, deals: dealRows.results, fakePlayers, clubs: clubRows.results };
}

/**
 * 生成一批传闻（同种子结果逐字一致）。
 * 守卫：假料组合不得与真实关系重合（在售的卖家+球员、成交的双方），且不指向球员现效力队。
 */
export async function buildRumors(db: D1Database, win: RumorSeedWindow): Promise<RumorItem[]> {
  const seed = [win.season, win.windowSeq];
  const pool = await loadFactPool(db, seed);
  const saleTemplates = seededShuffle(TRUTH_SALE_TEMPLATES, seed, 1);
  const dealTemplates = seededShuffle(TRUTH_DEAL_TEMPLATES, seed, 3);
  const fakeTemplates = seededShuffle(FAKE_TEMPLATES, seed, 2);

  const rumors: RumorItem[] = [];
  let saleIdx = 0;
  let dealIdx = 0;
  let fakeIdx = 0;

  for (let slot = 0; slot < RUMOR_COUNT; slot += 1) {
    const id = `r${win.season}-${win.windowSeq}-${slot}`;
    const isTruth = seededUnit([...seed, slot], 0) < 0.5;

    if (isTruth && (pool.sales.length > 0 || pool.deals.length > 0)) {
      // 真传闻：在售池优先（「可谈名单」语义贴切），成交池兜底；模板按事实方向各用一族
      const useSale = pool.sales.length > 0;
      if (useSale) {
        const fact = pool.sales[Math.floor(seededUnit([...seed, slot], 4) * pool.sales.length)];
        rumors.push({
          id,
          text: fill(saleTemplates[saleIdx++ % saleTemplates.length], fact.playerName, fact.clubName),
          playerId: fact.playerId,
          playerName: fact.playerName,
          clubName: fact.clubName,
        });
      } else {
        const fact = pool.deals[Math.floor(seededUnit([...seed, slot], 4) * pool.deals.length)];
        const clubName = fact.toClubName ?? fact.fromClubName ?? '';
        if (clubName === '') continue;
        rumors.push({
          id,
          text: fill(dealTemplates[dealIdx++ % dealTemplates.length], fact.playerName, clubName),
          playerId: fact.playerId,
          playerName: fact.playerName,
          clubName,
        });
      }
      continue;
    }

    // 假料：球员×球队随机组合，撞真实关系或现效力队则换组合重试
    let placed = false;
    for (let round = 0; round < FAKE_MAX_ROUNDS && !placed; round += 1) {
      const player = pool.fakePlayers[Math.floor(seededUnit([...seed, slot, round], 5) * pool.fakePlayers.length)];
      const club = pool.clubs[Math.floor(seededUnit([...seed, slot, round], 6) * pool.clubs.length)];
      if (!player || !club) continue;
      if (player.clubId === club.id) continue;
      // 假料守卫只覆盖两池抽样面（在售 top50 + 近成交 30）：进行中的报价/谈判、更早的成交
      // 与合同类单据不在比对范围内——这是已登记的口径边界，不是遗漏；改守卫面须同步 TC-RUMOR-05
      const clashes =
        pool.sales.some((s) => s.playerId === player.id && s.clubId === club.id) ||
        pool.deals.some(
          (d) =>
            (d.playerId === player.id && (d.toClubId === club.id || d.fromClubId === club.id)),
        );
      if (clashes) continue;
      const tpl = fakeTemplates[fakeIdx++ % fakeTemplates.length];
      rumors.push({
        id,
        text: fill(tpl, player.name, club.name),
        playerId: player.id,
        playerName: player.name,
        clubName: club.name,
      });
      placed = true;
    }
    // 三轮都撞真实关系 → 跳过该 slot（条数 0-8 可变：事实池与守卫都可能削减，前端有空态）
  }

  return rumors;
}
