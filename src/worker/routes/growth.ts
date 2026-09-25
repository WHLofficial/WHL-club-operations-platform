// 成长公开/教练端点（附录 A〔6〕，§10）：成长史查询（🌐）、升级方案二选一与中国计划徽章
// （👤 本队教练或管理组）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireUser } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';
import { createConfigService } from '../../core/config.ts';
import { applyLevelUp, getUpgradePlans, grantChinaPlaystyles, listPlayerPlaystyles, DEFAULT_UPGRADE_PLANS } from '../growth.ts';
import { rowDisplayName } from '../../core/player-name.ts';
import { firstPlayerByRef } from '../player-ref.ts';

const app = new Hono<{ Bindings: Env }>();

// 成长史（🌐 公开）：球员卡成长页数据源——XP 进度、徽章、待升级次数、事件时间线
// `:id` 是 fc_id（兼容内部 id，见 src/worker/player-ref.ts）——球员页 URL 就是这个编号
app.get('/players/:id/growth', async (c) => {
  const ref = Number(c.req.param('id'));
  if (!Number.isInteger(ref) || ref <= 0) throw new HttpError(400, '球员 ID 不对');
  const player = await firstPlayerByRef<{
    id: number;
    name: string;
    display_name: string | null;
    ca: number;
    growth_tier: number;
    growth_xp: number;
    levels_applied: number;
    badges_silver: number;
    badges_gold: number;
    growable: number;
    status: string;
  }>(
    c.env.DB,
    'id, name, display_name, ca, growth_tier, growth_xp, levels_applied, badges_silver, badges_gold, growable, status',
    ref,
  );
  if (!player) throw new HttpError(404, '找不到这名球员');
  const playerId = player.id;

  const config = createConfigService(c.env.DB);
  const xpPerLevel = (await config.getNumber('xp_per_level')) ?? 10;
  const pending = Math.max(0, Math.floor(player.growth_xp / xpPerLevel) - player.levels_applied);
  const plans = (await getUpgradePlans(c.env.DB))[player.growth_tier] ?? DEFAULT_UPGRADE_PLANS[player.growth_tier] ?? [];
  // 发放明细（v3.3.0）：属性页清单 = FC 源槽 + 这一份，去重后展示；中国计划名额也靠它算
  const playstyleDetails = await listPlayerPlaystyles(c.env.DB, playerId);
  const chinaQuota = (await config.getNumber('china_badges')) ?? 3;
  const chinaGranted = playstyleDetails.filter((d) => d.source === 'china').length;

  const events = await c.env.DB.prepare(
    `SELECT id, match_ref, season, window_seq, event_type, value, xp, source, created_at
     FROM growth_events WHERE player_id = ? ORDER BY id DESC LIMIT 50`,
  )
    .bind(playerId)
    .all<{
      id: number;
      match_ref: string | null;
      season: number | null;
      window_seq: number | null;
      event_type: string;
      value: number;
      xp: number;
      source: string;
      created_at: string;
    }>();

  return c.json({
    player: {
      id: player.id,
      name: rowDisplayName(player),
      ca: player.ca,
      growthTier: player.growth_tier,
      growthXp: player.growth_xp,
      levelsApplied: player.levels_applied,
      badgesSilver: player.badges_silver,
      badgesGold: player.badges_gold,
      growable: player.growable === 1,
      status: player.status,
      xpPerLevel,
      pendingLevelUps: pending,
      upgradePlans: plans,
      // 中国计划自选银徽章名额（config.china_badges）：不在计划里就不给前端口子
      chinaPlaystyles: { quota: chinaQuota, granted: chinaGranted, left: Math.max(0, chinaQuota - chinaGranted) },
    },
    // 发放明细：psid 是基础 ID（1-99），金徽由 kind 表示；前端换算成存库 ID 后与 FC 源槽合并
    playstyleDetails: playstyleDetails.map((d) => ({
      slot: d.slot,
      kind: d.kind,
      psid: d.psid,
      source: d.source,
      createdAt: d.createdAt,
    })),
    events: events.results.map((e) => ({
      id: e.id,
      matchRef: e.match_ref,
      season: e.season,
      windowSeq: e.window_seq,
      eventType: e.event_type,
      value: e.value,
      xp: e.xp,
      source: e.source,
      createdAt: e.created_at,
    })),
  });
});

// 升级方案二选一（§10.2）：本队教练或管理组，逐次消费待办；带徽章的方案要一起交 picks
app.post('/growth/levelup/:playerId', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { planIndex?: unknown; picks?: unknown } | null;

  const player = await c.env.DB.prepare('SELECT id, club_id FROM players WHERE id = ?').bind(playerId).first<{ id: number; club_id: number | null }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  if (user.role !== 'admin') {
    const club = await getBoundClub(c.env, user.id);
    if (!club || club.id !== player.club_id) throw new HttpError(403, '只有本队教练（或管理组）能选升级方案');
  }
  const out = await applyLevelUp(c.env, user.id, playerId, body?.planIndex, body?.picks);
  return c.json(out);
});

// 中国球员计划自选银徽章（§10）：本队教练或管理组，名额 = config.china_badges − 已发数
app.post('/growth/china-playstyles/:playerId', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { picks?: unknown } | null;

  const player = await c.env.DB.prepare('SELECT id, club_id, china_plan FROM players WHERE id = ?')
    .bind(playerId)
    .first<{ id: number; club_id: number | null; china_plan: number }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  if (player.china_plan !== 1) throw new HttpError(409, '这名球员不在中国球员计划里');
  if (user.role !== 'admin') {
    const club = await getBoundClub(c.env, user.id);
    if (!club || club.id !== player.club_id) throw new HttpError(403, '只有本队教练（或管理组）能发中国计划徽章');
  }
  const out = await grantChinaPlaystyles(c.env, user.id, playerId, body?.picks);
  return c.json(out);
});

export default app;
