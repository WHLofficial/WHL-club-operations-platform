// 球员查询（附录 A〔1〕，🌐 公开：跳过会话检查，§17.3-5）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';

const app = new Hono<{ Bindings: Env }>();

const PLAYER_STATUS = ['normal', 'listed', 'trainee', 'free', 'retired'] as const;

// GET /api/players?club_id=&status=&cursor=&limit=
app.get('/players', async (c) => {
  const conditions: string[] = [];
  const args: unknown[] = [];

  const clubId = c.req.query('club_id');
  if (clubId !== undefined) {
    const n = Number(clubId);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'club_id 不对');
    conditions.push('club_id = ?');
    args.push(n);
  }
  const status = c.req.query('status');
  if (status !== undefined) {
    if (!(PLAYER_STATUS as readonly string[]).includes(status)) {
      throw new HttpError(400, 'status 只能是 normal / listed / trainee / free / retired');
    }
    conditions.push('status = ?');
    args.push(status);
  }
  const cursor = c.req.query('cursor');
  if (cursor !== undefined) {
    const n = Number(cursor);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'cursor 不对');
    conditions.push('id > ?');
    args.push(n);
  }
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT id, uid, name, club_id, position, age, ca, pa, prestige, market_value, status,
            growth_tier, is_future_star, china_plan, agent_tier, badges_silver, badges_gold
     FROM players ${where} ORDER BY id LIMIT ?`,
  )
    .bind(...args, limit + 1)
    .all<{
      id: number;
      uid: string;
      name: string;
      club_id: number | null;
      position: string | null;
      age: number | null;
      ca: number;
      pa: number;
      prestige: number | null;
      market_value: number | null;
      status: string;
      growth_tier: number;
      is_future_star: number;
      china_plan: number;
      agent_tier: number;
      badges_silver: number;
      badges_gold: number;
    }>();

  const players = rows.results.slice(0, limit).map((r) => ({
    id: r.id,
    uid: r.uid,
    name: r.name,
    clubId: r.club_id,
    position: r.position,
    age: r.age,
    ca: r.ca,
    pa: r.pa,
    prestige: r.prestige,
    marketValue: r.market_value,
    status: r.status,
    growthTier: r.growth_tier,
    isFutureStar: r.is_future_star === 1,
    chinaPlan: r.china_plan === 1,
    agentTier: r.agent_tier,
    badgesSilver: r.badges_silver,
    badgesGold: r.badges_gold,
  }));
  return c.json({
    players,
    nextCursor: rows.results.length > limit ? players[players.length - 1].id : null,
  });
});

// GET /api/players/:id —— 档案卡数据（球员 + 俱乐部 + 现行合同 + FC 存档）
app.get('/players/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '球员 ID 不对');

  const p = await c.env.DB.prepare(
    `SELECT id, uid, name, club_id, position, foot, age, ca, pa, growable, prestige, market_value,
            status, growth_tier, growth_xp, is_future_star, china_plan, agent_tier,
            badges_silver, badges_gold, game_attrs, created_at, updated_at
     FROM players WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      uid: string;
      name: string;
      club_id: number | null;
      position: string | null;
      foot: number;
      age: number | null;
      ca: number;
      pa: number;
      growable: number;
      prestige: number | null;
      market_value: number | null;
      status: string;
      growth_tier: number;
      growth_xp: number;
      is_future_star: number;
      china_plan: number;
      agent_tier: number;
      badges_silver: number;
      badges_gold: number;
      game_attrs: string | null;
      created_at: string;
      updated_at: string;
    }>();
  if (!p) throw new HttpError(404, '球员不存在');

  const [club, contract] = await Promise.all([
    p.club_id
      ? c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(p.club_id).first<{ id: number; name: string }>()
      : Promise.resolve(null),
    c.env.DB.prepare(
      `SELECT id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, protected_until
       FROM contracts WHERE player_id = ? AND is_active = 1`,
    )
      .bind(id)
      .first<{
        id: number;
        club_id: number | null;
        release_fee: number | null;
        wage: number | null;
        contract_type: string;
        source: string | null;
        signed_at: string | null;
        effective_from: string | null;
        protected_until: string | null;
      }>(),
  ]);

  let gameAttrs: Record<string, unknown> | null = null;
  if (p.game_attrs) {
    try {
      gameAttrs = JSON.parse(p.game_attrs) as Record<string, unknown>;
    } catch {
      gameAttrs = null;
    }
  }

  return c.json({
    player: {
      id: p.id,
      uid: p.uid,
      name: p.name,
      clubId: p.club_id,
      position: p.position,
      foot: p.foot,
      age: p.age,
      ca: p.ca,
      pa: p.pa,
      growable: p.growable === 1,
      prestige: p.prestige,
      marketValue: p.market_value,
      status: p.status,
      growthTier: p.growth_tier,
      growthXp: p.growth_xp,
      isFutureStar: p.is_future_star === 1,
      chinaPlan: p.china_plan === 1,
      agentTier: p.agent_tier,
      badgesSilver: p.badges_silver,
      badgesGold: p.badges_gold,
      gameAttrs,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    },
    club,
    contract: contract
      ? {
          id: contract.id,
          clubId: contract.club_id,
          releaseFee: contract.release_fee,
          wage: contract.wage,
          contractType: contract.contract_type,
          source: contract.source,
          signedAt: contract.signed_at,
          effectiveFrom: contract.effective_from,
          protectedUntil: contract.protected_until,
        }
      : null,
  });
});

export default app;
