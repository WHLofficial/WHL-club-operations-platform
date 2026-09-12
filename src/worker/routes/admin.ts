// 管理端路由（附录 A〔1〕，🛡=requireAdmin 全覆盖）
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireAdmin } from '../../lib/session.ts';
import { generateCode, sha256Hex } from '../../lib/crypto.ts';
import { createAuditStatement, writeAudit } from '../../lib/audit.ts';
import { createConfigService } from '../../core/config.ts';
import { confirmImport, previewImport } from '../players-import.ts';
import { confirmContractsImport, previewContractsImport } from '../contracts-import.ts';
import { checkSquad, type SquadPlayer } from '../../core/squad-rules.ts';
import { getVisibleSeason } from '../seasons.ts';
import { loadSquadContext } from '../squad-context.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

async function readJson(c: { req: { raw: Request } }): Promise<unknown> {
  return c.req.raw.json().catch(() => null);
}

// ---- 建队与认证码（§3.2） ----

app.post('/clubs', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { name?: unknown; leagueTier?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const leagueTier = body?.leagueTier;
  if (!name) throw new HttpError(400, '俱乐部名字不能为空');
  if (name.length > 40) throw new HttpError(400, '俱乐部名字最多 40 个字');
  if (leagueTier !== 'premier' && leagueTier !== 'second') {
    throw new HttpError(400, '联赛级别只能是 premier（顶级）或 second（次级）');
  }
  const club = await c.env.DB.prepare(
    `INSERT INTO clubs (name, league_tier, status, created_at)
     VALUES (?, ?, 'active', ${nowSql()})
     RETURNING id, name, league_tier, status, created_at`,
  )
    .bind(name, leagueTier)
    .first<{ id: number; name: string; league_tier: string; status: string; created_at: string }>()
    .catch(() => null);
  if (!club) throw new HttpError(409, '俱乐部名字已存在');
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_create',
    targetType: 'club',
    targetId: club.id,
    after: { name, leagueTier },
  });
  return c.json(
    {
      club: {
        id: club.id,
        name: club.name,
        leagueTier: club.league_tier,
        status: club.status,
        createdAt: club.created_at,
      },
    },
    201,
  );
});

app.get('/clubs', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const clubs = await c.env.DB.prepare(
    'SELECT id, name, league_tier, status, created_at FROM clubs ORDER BY id LIMIT 200',
  ).all<{ id: number; name: string; league_tier: string; status: string; created_at: string }>();
  const bindings = await c.env.DB.prepare(
    'SELECT club_id, user_id, bound_at FROM club_bindings LIMIT 200',
  ).all<{ club_id: number; user_id: number; bound_at: string }>();
  const codes = await c.env.DB.prepare(
    'SELECT club_id, expires_at, used_by, used_at, created_at FROM club_bind_code ORDER BY id DESC LIMIT 200',
  ).all<{ club_id: number; expires_at: string | null; used_by: number | null; used_at: string | null; created_at: string }>();

  const byClub = new Map<number, { userId: number; boundAt: string }>();
  for (const b of bindings.results) byClub.set(b.club_id, { userId: b.user_id, boundAt: b.bound_at });
  const latestCode = new Map<number, { expiresAt: string | null; usedBy: number | null; usedAt: string | null; createdAt: string }>();
  for (const code of codes.results) {
    if (!latestCode.has(code.club_id)) {
      latestCode.set(code.club_id, {
        expiresAt: code.expires_at,
        usedBy: code.used_by,
        usedAt: code.used_at,
        createdAt: code.created_at,
      });
    }
  }
  // 绑定人名字来自赛事系统 user 表（跨绑定只读，§4）
  const userIds = [...new Set(bindings.results.map((b) => b.user_id))];
  const userNames = new Map<number, string>();
  for (let i = 0; i < userIds.length; i += 90) {
    const slice = userIds.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const users = await c.env.TOUR_DB.prepare(`SELECT id, name FROM user WHERE id IN (${placeholders})`)
      .bind(...slice)
      .all<{ id: number; name: string }>();
    for (const u of users.results) userNames.set(u.id, u.name);
  }

  return c.json({
    clubs: clubs.results.map((r) => {
      const binding = byClub.get(r.id) ?? null;
      return {
        id: r.id,
        name: r.name,
        leagueTier: r.league_tier,
        status: r.status,
        createdAt: r.created_at,
        binding: binding ? { userId: binding.userId, userName: userNames.get(binding.userId) ?? null, boundAt: binding.boundAt } : null,
        latestCode: latestCode.get(r.id) ?? null,
      };
    }),
  });
});

app.post('/clubs/:id/bindcode', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const clubId = Number(c.req.param('id'));
  if (!Number.isInteger(clubId)) throw new HttpError(400, '俱乐部 ID 不对');
  const club = await c.env.DB.prepare('SELECT id FROM clubs WHERE id = ?').bind(clubId).first<{ id: number }>();
  if (!club) throw new HttpError(404, '俱乐部不存在');

  const body = (await readJson(c)) as { expiresInHours?: unknown } | null;
  const hours = body?.expiresInHours === undefined ? 24 : Number(body.expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    throw new HttpError(400, '有效时长须在 1 小时到 30 天之间');
  }
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
  const code = generateCode(8);
  await c.env.DB.prepare(
    `INSERT INTO club_bind_code (club_id, code_hash, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ${nowSql()})`,
  )
    .bind(clubId, await sha256Hex(code), expiresAt, user.id)
    .run();
  // 明码只在这一次响应里出现，审计只记事实不记码
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'club_bindcode_create',
    targetType: 'club',
    targetId: clubId,
    after: { expiresAt },
  });
  return c.json({ code, expiresAt }, 201);
});

app.post('/bindings/unbind', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { userId?: unknown } | null;
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(400, '要解绑的用户 ID 不对');
  const row = await c.env.DB.prepare('SELECT club_id FROM club_bindings WHERE user_id = ?')
    .bind(userId)
    .first<{ club_id: number }>();
  if (!row) throw new HttpError(404, '该账号没有绑定俱乐部');
  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM club_bindings WHERE user_id = ?').bind(userId),
    audit({
      actor: user.id,
      action: 'club_unbind',
      targetType: 'club',
      targetId: row.club_id,
      before: { userId },
    }),
  ]);
  return c.json({ ok: true });
});

// ---- config 键注册表（§13，涉密键掩码） ----

app.get('/config', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const service = createConfigService(c.env.DB);
  return c.json({ config: await service.listMasked() });
});

// ---- 球员管理（PATCH 白名单字段，审计留痕） ----

const PLAYER_STATUS = ['normal', 'listed', 'trainee', 'free', 'retired'] as const;

app.patch('/players/:id', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HttpError(400, '球员 ID 不对');
  const body = (await readJson(c)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求格式不对');

  const updates: Record<string, unknown> = {};
  const errors: string[] = [];
  if ('marketValue' in body) {
    const v = body.marketValue;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) errors.push('身价须为非负数值');
    else updates.market_value = v;
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !(PLAYER_STATUS as readonly string[]).includes(body.status)) {
      errors.push('状态只能是 normal / listed / trainee / free / retired');
    } else updates.status = body.status;
  }
  if ('growthTier' in body) {
    const v = Number(body.growthTier);
    if (!Number.isInteger(v) || v < 1 || v > 5) errors.push('成长档位须在 1-5 之间');
    else updates.growth_tier = v;
  }
  if ('isFutureStar' in body) {
    const v = Number(body.isFutureStar);
    if (v !== 0 && v !== 1) errors.push('未来之星只能是 0 或 1');
    else updates.is_future_star = v;
  }
  if ('growable' in body) {
    const v = Number(body.growable);
    if (v !== 0 && v !== 1) errors.push('可成长标记只能是 0 或 1');
    else updates.growable = v;
  }
  if ('prestige' in body) {
    const v = body.prestige;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5)) errors.push('国际声望须在 1-5 之间');
    else updates.prestige = v;
  }
  if ('badgesSilver' in body) {
    const v = Number(body.badgesSilver);
    if (!Number.isInteger(v) || v < 0 || v > 15) errors.push('银徽章数须在 0-15 之间');
    else updates.badges_silver = v;
  }
  if ('badgesGold' in body) {
    const v = Number(body.badgesGold);
    if (!Number.isInteger(v) || v < 0 || v > 3) errors.push('金徽章数须在 0-3 之间');
    else updates.badges_gold = v;
  }
  const known = [
    'marketValue',
    'status',
    'growthTier',
    'isFutureStar',
    'growable',
    'prestige',
    'badgesSilver',
    'badgesGold',
  ];
  const unknown = Object.keys(body).filter((k) => !known.includes(k));
  if (unknown.length > 0) errors.push(`不支持的字段：${unknown.join('、')}`);
  if (errors.length > 0) throw new HttpError(400, errors[0]);
  if (Object.keys(updates).length === 0) throw new HttpError(400, '没有可更新的字段');

  const current = await c.env.DB.prepare(
    'SELECT id, market_value, status, growth_tier, is_future_star, growable, prestige, badges_silver, badges_gold FROM players WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: number;
      market_value: number | null;
      status: string;
      growth_tier: number;
      is_future_star: number;
      growable: number;
      prestige: number | null;
      badges_silver: number;
      badges_gold: number;
    }>();
  if (!current) throw new HttpError(404, '球员不存在');

  const cols = Object.keys(updates);
  const audit = createAuditStatement(c.env.DB);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE players SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ${nowSql()} WHERE id = ?`,
    ).bind(...cols.map((k) => updates[k]), id),
    audit({
      actor: user.id,
      action: 'player_patch',
      targetType: 'player',
      targetId: id,
      before: Object.fromEntries(cols.map((k) => [k, current[k as keyof typeof current]])),
      after: updates,
    }),
  ]);
  return c.json({ ok: true });
});

// ---- 导入管线两段式（§5.4：通道 A/B 球员，通道 C 名单合同模板） ----

app.post('/players/import/preview', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const body = await readJson(c);
  if ((body as { channel?: unknown } | null)?.channel === 'C') {
    return c.json(await previewContractsImport(c.env, body));
  }
  return c.json(await previewImport(c.env, body));
});

app.post('/players/import/confirm', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = await readJson(c);
  if ((body as { channel?: unknown } | null)?.channel === 'C') {
    return c.json(await confirmContractsImport(c.env, user.id, body));
  }
  return c.json(await confirmImport(c.env, user.id, body));
});

// ---- 期初余额导入（§14.1，kind=opening_import；幂等：已导入的俱乐部跳过） ----

app.post('/ledger/opening-import', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { rows?: unknown } | null;
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(400, 'rows 应为非空数组');
  if (rows.length > 500) throw new HttpError(400, '单次最多 500 行');

  const parsed = rows.map((r, i) => {
    const item = r as { clubId?: unknown; balance?: unknown } | null;
    const clubId = Number(item?.clubId);
    const balance = Number(item?.balance);
    if (!Number.isInteger(clubId) || clubId <= 0) throw new HttpError(400, `第 ${i + 1} 行：俱乐部 ID 不对`);
    if (!Number.isFinite(balance) || balance < 0) throw new HttpError(400, `第 ${i + 1} 行：余额须为非负数值`);
    if (balance > 1e9) throw new HttpError(400, `第 ${i + 1} 行：余额超出合理范围`);
    return { clubId, balance };
  });
  const seen = new Set<number>();
  for (const r of parsed) {
    if (seen.has(r.clubId)) throw new HttpError(400, '同一俱乐部在一批里出现了多次');
    seen.add(r.clubId);
  }

  const ids = [...seen];
  const found = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rowsFound = await c.env.DB.prepare(`SELECT id FROM clubs WHERE id IN (${placeholders})`)
      .bind(...slice)
      .all<{ id: number }>();
    for (const f of rowsFound.results) found.add(f.id);
  }
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw new HttpError(400, `这些俱乐部还不存在：${missing.join('、')}`);

  const imported = new Set<number>();
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const placeholders = slice.map(() => '?').join(', ');
    const rowsDone = await c.env.DB.prepare(
      `SELECT DISTINCT club_id FROM ledger_entries WHERE kind = 'opening_import' AND club_id IN (${placeholders})`,
    )
      .bind(...slice)
      .all<{ club_id: number }>();
    for (const r of rowsDone.results) imported.add(r.club_id);
  }
  const todo = parsed.filter((r) => !imported.has(r.clubId));
  const audit = createAuditStatement(c.env.DB);
  if (todo.length > 0) {
    const statements = todo.flatMap((r) => [
      c.env.DB.prepare(
        `INSERT INTO ledger_accounts (club_id, balance, updated_at) VALUES (?, ?, ${nowSql()})
         ON CONFLICT(club_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
      ).bind(r.clubId, r.balance),
      c.env.DB.prepare(
        `INSERT INTO ledger_entries (club_id, kind, amount, balance_after, memo, created_at)
         VALUES (?, 'opening_import', ?, ?, '期初余额导入', ${nowSql()})`,
      ).bind(r.clubId, r.balance, r.balance),
    ]);
    statements.push(
      audit({
        actor: user.id,
        action: 'ledger_opening_import',
        targetType: 'ledger',
        after: { written: todo.length, skipped: parsed.length - todo.length },
      }),
    );
    await c.env.DB.batch(statements); // 流水 + 余额 + 审计一个 batch 提交（§7.4-1）
  }
  return c.json({ written: todo.length, skipped: parsed.length - todo.length });
});

// ---- 注册快照与准入体检（附录 A〔2〕） ----

// GET /api/admin/registrations?season= —— 注册快照按俱乐部分组；season 缺省取最新有快照的赛季
app.get('/registrations', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const seasonParam = c.req.query('season');
  let season: number | null = null;
  if (seasonParam !== undefined) {
    const n = Number(seasonParam);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'season 应为正整数');
    season = n;
  } else {
    const latest = await c.env.DB.prepare('SELECT MAX(season) AS s FROM registrations').first<{ s: number | null }>();
    season = latest?.s ?? null;
  }
  if (season === null) return c.json({ season: null, clubs: [] });

  const rows = await c.env.DB.prepare(
    `SELECT r.club_id, r.player_id, r.squad, p.name AS player_name,
            c.name AS club_name, c.league_tier, ct.wage
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     JOIN clubs c ON c.id = r.club_id
     LEFT JOIN contracts ct ON ct.player_id = r.player_id AND ct.is_active = 1 AND ct.club_id = r.club_id
     WHERE r.season = ? ORDER BY r.club_id, r.squad, p.name LIMIT 2000`,
  )
    .bind(season)
    .all<{
      club_id: number;
      player_id: number;
      squad: string;
      player_name: string;
      club_name: string;
      league_tier: string | null;
      wage: number | null;
    }>();

  const byClub = new Map<number, { clubId: number; clubName: string; leagueTier: string | null; players: { playerId: number; name: string; squad: string }[]; wageTotal: number }>();
  for (const r of rows.results) {
    let club = byClub.get(r.club_id);
    if (!club) {
      club = { clubId: r.club_id, clubName: r.club_name, leagueTier: r.league_tier, players: [], wageTotal: 0 };
      byClub.set(r.club_id, club);
    }
    club.players.push({ playerId: r.player_id, name: r.player_name, squad: r.squad });
    club.wageTotal += r.wage ?? 0;
  }
  const clubs = [...byClub.values()].map((club) => ({
    clubId: club.clubId,
    clubName: club.clubName,
    leagueTier: club.leagueTier,
    firstTeam: club.players.filter((p) => p.squad === 'first_team').length,
    trainee: club.players.filter((p) => p.squad === 'trainee').length,
    wageTotal: Math.round(club.wageTotal * 100) / 100,
    players: club.players.map((p) => ({ playerId: p.playerId, name: p.name, squad: p.squad })),
  }));
  return c.json({ season, clubs });
});

// GET /api/admin/compliance?season= —— 准入体检报告（P1 首版：只报告，不触发强制拍卖）
// 用当前 CA/PA/合同对快照重跑合规引擎，抓「注册后属性/合同漂移」导致的违规。
app.get('/compliance', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const seasonParam = c.req.query('season');
  let season: number | null;
  if (seasonParam !== undefined) {
    const n = Number(seasonParam);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'season 应为正整数');
    season = n;
  } else {
    season = await getVisibleSeason(c.env.DB);
  }
  if (season === null) return c.json({ season: null, clubs: [] });

  const clubs = await c.env.DB.prepare('SELECT id, name, league_tier FROM clubs ORDER BY id LIMIT 200').all<{
    id: number;
    name: string;
    league_tier: string | null;
  }>();
  const regRows = await c.env.DB.prepare(
    `SELECT r.club_id, r.player_id, r.squad, p.name, p.position, p.ca, p.pa, p.growable,
            ct.player_id AS contract_player_id, ct.wage
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     LEFT JOIN contracts ct ON ct.player_id = r.player_id AND ct.is_active = 1 AND ct.club_id = r.club_id
     WHERE r.season = ? ORDER BY r.club_id LIMIT 2000`,
  )
    .bind(season)
    .all<{
      club_id: number;
      player_id: number;
      squad: string;
      name: string;
      position: string | null;
      ca: number | null;
      pa: number | null;
      growable: number;
      contract_player_id: number | null;
      wage: number | null;
    }>();

  const report = await Promise.all(
    clubs.results.map(async (club) => {
      const mine = regRows.results.filter((r) => r.club_id === club.id);
      if (mine.length === 0) {
        return {
          clubId: club.id,
          clubName: club.name,
          leagueTier: club.league_tier,
          pass: false,
          issues: [{ rule: 'not_registered', message: '本赛季还没提交注册名单', playerIds: [] }],
          stats: null,
        };
      }
      const toSp = (r: (typeof mine)[number]): SquadPlayer => ({
        playerId: r.player_id,
        name: r.name,
        position: r.position,
        ca: r.ca,
        pa: r.pa,
        growable: r.growable === 1,
        hasContract: r.contract_player_id !== null,
        wage: r.contract_player_id !== null ? r.wage ?? 0 : null,
      });
      const firstTeam = mine.filter((r) => r.squad === 'first_team').map(toSp);
      const trainee = mine.filter((r) => r.squad === 'trainee').map(toSp);
      const rules = await loadSquadContext(c.env.DB, club.league_tier);
      const result = checkSquad(firstTeam, trainee, rules);
      return {
        clubId: club.id,
        clubName: club.name,
        leagueTier: club.league_tier,
        pass: result.pass,
        issues: result.issues,
        stats: result.stats,
      };
    }),
  );
  return c.json({ season, clubs: report });
});

export default app;
