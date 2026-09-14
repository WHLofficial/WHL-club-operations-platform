// 球员查询（附录 A〔1〕，🌐 公开：跳过会话检查，§17.3-5）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';

const app = new Hono<{ Bindings: Env }>();

const PLAYER_STATUS = ['normal', 'listed', 'trainee', 'free', 'retired'] as const;

// 球员库排序键（增量 6.1 d6）：id 沿旧整数游标 ASC（既有调用兼容）；数值键走 COALESCE 双向 keyset，NULL 当 0 排尾
// view=initial（增量 6.1 d7）：初始球员库=导入时数据——归属打 initial_club_id、CA=base_ca、PA=导入 json 值
const SORT_KEYS = { id: 'id', ca: 'ca', pa: 'pa', age: 'age', market_value: 'market_value' } as const;
type SortKey = keyof typeof SORT_KEYS;

// 编 cursor 用的行内字段：排序表达式在 SELECT 里以 sort_ca/sort_pa 别名带出
const SORT_FIELD = { id: 'id', ca: 'sort_ca', pa: 'sort_pa', age: 'age', market_value: 'market_value' } as const;

const RANGE_PARAMS = {
  ca_min: { col: 'ca', op: '>=' },
  ca_max: { col: 'ca', op: '<=' },
  pa_min: { col: 'pa', op: '>=' },
  pa_max: { col: 'pa', op: '<=' },
  age_min: { col: 'age', op: '>=' },
  age_max: { col: 'age', op: '<=' },
} as const;

function decodeNumericCursor(raw: string): { v: number; id: number } {
  const sep = raw.lastIndexOf('~');
  if (sep <= 0) throw new HttpError(400, 'cursor 不对');
  const v = Number(raw.slice(0, sep));
  const id = Number(raw.slice(sep + 1));
  if (!Number.isFinite(v) || !Number.isInteger(id) || id < 0) throw new HttpError(400, 'cursor 不对');
  return { v, id };
}

// GET /api/players?view=&club_id=&status=&position=&name=&growable=&ca_min=&ca_max=&pa_min=&pa_max=&age_min=&age_max=&sort=&order=&cursor=&limit=
app.get('/players', async (c) => {
  const viewRaw = c.req.query('view');
  if (viewRaw !== undefined && viewRaw !== 'initial') throw new HttpError(400, 'view 只能是 initial');
  const initial = viewRaw === 'initial';
  const clubCol = initial ? 'initial_club_id' : 'club_id';
  const caExpr = initial ? 'COALESCE(base_ca, ca)' : 'ca';
  const paExpr = initial ? "COALESCE(json_extract(game_attrs, '$.PA'), pa)" : 'pa';
  // keyset 比较表达式（WHERE/ORDER BY 同源，保证全序一致）
  const SORT_EXPRS: Record<SortKey, string> = initial
    ? {
        id: 'id',
        ca: 'COALESCE(base_ca, 0)',
        pa: "COALESCE(json_extract(game_attrs, '$.PA'), 0)",
        age: 'COALESCE(age, 0)',
        market_value: 'COALESCE(market_value, 0)',
      }
    : {
        id: 'id',
        ca: 'COALESCE(ca, 0)',
        pa: 'COALESCE(pa, 0)',
        age: 'COALESCE(age, 0)',
        market_value: 'COALESCE(market_value, 0)',
      };

  const conditions: string[] = [];
  const args: unknown[] = [];

  const clubId = c.req.query('club_id');
  if (clubId !== undefined) {
    const n = Number(clubId);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'club_id 不对');
    conditions.push(`${clubCol} = ?`);
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
  const position = c.req.query('position');
  if (position !== undefined) {
    const p = position.trim();
    if (p === '') throw new HttpError(400, 'position 不能为空');
    conditions.push('position = ?');
    args.push(p);
  }
  const name = c.req.query('name');
  if (name !== undefined) {
    const q = name.trim();
    if (q === '') throw new HttpError(400, 'name 不能为空');
    conditions.push(`name LIKE ? ESCAPE '\\'`);
    args.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  const growable = c.req.query('growable');
  if (growable !== undefined) {
    if (growable !== '1' && growable !== '0') throw new HttpError(400, 'growable 只能是 1 或 0');
    conditions.push('growable = ?');
    args.push(Number(growable));
  }
  for (const [param, spec] of Object.entries(RANGE_PARAMS)) {
    const raw = c.req.query(param);
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${param} 应为非负数`);
    conditions.push(`${spec.col} ${spec.op} ?`);
    args.push(n);
  }

  const sortRaw = c.req.query('sort') ?? 'id';
  if (!(sortRaw in SORT_KEYS)) throw new HttpError(400, 'sort 只能是 id / ca / pa / age / market_value');
  const sort = sortRaw as SortKey;
  const order = sort === 'id' || c.req.query('order') === 'asc' ? 'asc' : 'desc';

  let orderBy: string;
  if (sort === 'id') {
    const cursor = c.req.query('cursor');
    if (cursor !== undefined) {
      const n = Number(cursor);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'cursor 不对');
      conditions.push('id > ?');
      args.push(n);
    }
    orderBy = 'ORDER BY id ASC';
  } else {
    const keyExpr = SORT_EXPRS[sort];
    const cursor = c.req.query('cursor');
    if (cursor !== undefined) {
      const { v, id } = decodeNumericCursor(cursor);
      if (order === 'desc') {
        conditions.push(`(${keyExpr} < ? OR (${keyExpr} = ? AND id < ?))`);
      } else {
        conditions.push(`(${keyExpr} > ? OR (${keyExpr} = ? AND id > ?))`);
      }
      args.push(v, v, id);
    }
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    orderBy = `ORDER BY ${keyExpr} ${dir}, id ${dir}`;
  }
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 50, 1), 100);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT id, uid, name, ${clubCol} AS club_id, position, age, ${caExpr} AS ca, ${paExpr} AS pa, prestige, market_value, status,
            growth_tier, growable, is_future_star, china_plan, agent_tier, badges_silver, badges_gold,
            ${caExpr} AS sort_ca, ${paExpr} AS sort_pa
     FROM players ${where} ${orderBy} LIMIT ?`,
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
      growable: number;
      is_future_star: number;
      china_plan: number;
      agent_tier: number;
      badges_silver: number;
      badges_gold: number;
      sort_ca: number;
      sort_pa: number;
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
    growable: r.growable === 1,
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

  let nextCursor: string | null = null;
  if (rows.results.length > limit) {
    const last = rows.results[limit - 1]!;
    nextCursor = sort === 'id' ? String(last.id) : `${Number(last[SORT_FIELD[sort]] ?? 0)}~${last.id}`;
  }
  return c.json({ players, nextCursor });
});

// GET /api/players/:id —— 档案卡数据（球员 + 俱乐部 + 现行合同 + FC 存档）
app.get('/players/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '球员 ID 不对');

  const p = await c.env.DB.prepare(
    `SELECT id, uid, name, club_id, initial_club_id, position, foot, age, ca, pa, growable, prestige, market_value,
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
      initial_club_id: number | null;
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

  const [club, initialClub, contract] = await Promise.all([
    p.club_id
      ? c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(p.club_id).first<{ id: number; name: string }>()
      : Promise.resolve(null),
    p.initial_club_id
      ? c.env.DB.prepare('SELECT id, name FROM clubs WHERE id = ?').bind(p.initial_club_id).first<{ id: number; name: string }>()
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
      initialClubId: p.initial_club_id,
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
    initialClub,
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
