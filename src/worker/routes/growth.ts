// 成长公开/教练端点（附录 A〔6〕，§10）：成长史查询（🌐）与升级方案二选一（👤 本队教练或管理组）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireUser } from '../../lib/session.ts';
import { getBoundClub } from '../binding.ts';
import { createConfigService } from '../../core/config.ts';
import { applyLevelUp, getUpgradePlans, DEFAULT_UPGRADE_PLANS } from '../growth.ts';

const app = new Hono<{ Bindings: Env }>();

// 成长史（🌐 公开）：档案卡成长页数据源——XP 进度、徽章、待升级次数、事件时间线
app.get('/players/:id/growth', async (c) => {
  const playerId = Number(c.req.param('id'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const player = await c.env.DB.prepare(
    `SELECT id, name, ca, growth_tier, growth_xp, levels_applied, badges_silver, badges_gold, growable, status
     FROM players WHERE id = ?`,
  )
    .bind(playerId)
    .first<{
      id: number;
      name: string;
      ca: number;
      growth_tier: number;
      growth_xp: number;
      levels_applied: number;
      badges_silver: number;
      badges_gold: number;
      growable: number;
      status: string;
    }>();
  if (!player) throw new HttpError(404, '找不到这名球员');

  const config = createConfigService(c.env.DB);
  const xpPerLevel = (await config.getNumber('xp_per_level')) ?? 10;
  const pending = Math.max(0, Math.floor(player.growth_xp / xpPerLevel) - player.levels_applied);
  const plans = (await getUpgradePlans(c.env.DB))[player.growth_tier] ?? DEFAULT_UPGRADE_PLANS[player.growth_tier] ?? [];

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
      name: player.name,
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
    },
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

// 升级方案二选一（§10.2）：本队教练或管理组，逐次消费待办
app.post('/growth/levelup/:playerId', async (c) => {
  const user = await requireUser(c.env, c.req.raw);
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
  const body = (await c.req.raw.json().catch(() => null)) as { planIndex?: unknown } | null;

  const player = await c.env.DB.prepare('SELECT id, club_id FROM players WHERE id = ?').bind(playerId).first<{ id: number; club_id: number | null }>();
  if (!player) throw new HttpError(404, '找不到这名球员');
  if (user.role !== 'admin') {
    const club = await getBoundClub(c.env, user.id);
    if (!club || club.id !== player.club_id) throw new HttpError(403, '只有本队教练（或管理组）能选升级方案');
  }
  const out = await applyLevelUp(c.env, user.id, playerId, body?.planIndex);
  return c.json(out);
});

export default app;
