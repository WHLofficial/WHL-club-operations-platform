// 管理端 · 注册快照与准入体检（附录 A〔2〕）+ 成交审核队列（附录 A〔3〕：转会成交确认，关键节点人工审）
// （原 admin.ts 注册/审核域，v2.1.0 拆分，行为零变化）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { checkSquad, type SquadPlayer } from '../../../core/squad-rules.ts';
import { getVisibleSeason } from '../../seasons.ts';
import { loadSquadContext } from '../../squad-context.ts';
import { loadTransfer, rejectTransfer } from '../../transfers.ts';
import { approveTransferDeal } from '../../bypass.ts';
import { deriveClubTier, tierCache } from '../../tier.ts';
import { sqlDisplayName } from '../../../core/player-name.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// ---- 注册快照与准入体检（附录 A〔2〕） ----

// GET /api/admin/registrations?season= —— 注册快照按俱乐部分组；season 缺省取最新有快照的赛季
app.get('/registrations', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.registrations.manage');
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
    `SELECT r.club_id, r.player_id, r.squad, ${sqlDisplayName('p')} AS player_name,
            c.name AS club_name, ct.wage
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     JOIN clubs c ON c.id = r.club_id
     LEFT JOIN contracts ct ON ct.player_id = r.player_id AND ct.is_active = 1 AND ct.club_id = r.club_id
     WHERE r.season = ? ORDER BY r.club_id, r.squad, ${sqlDisplayName('p')} LIMIT 2000`,
  )
    .bind(season)
    .all<{
      club_id: number;
      player_id: number;
      squad: string;
      player_name: string;
      club_name: string;
      wage: number | null;
    }>();

  // v1.2.0：级别改报名派生，不再读 clubs.league_tier 休眠列
  const cache = tierCache();
  const tiers = new Map<number, 'premier' | 'second' | null>();
  for (const r of rows.results) {
    if (!tiers.has(r.club_id)) tiers.set(r.club_id, await deriveClubTier(c.env, season, r.club_id, cache));
  }

  const byClub = new Map<number, { clubId: number; clubName: string; leagueTier: string | null; players: { playerId: number; name: string; squad: string }[]; wageTotal: number }>();
  for (const r of rows.results) {
    let club = byClub.get(r.club_id);
    if (!club) {
      club = { clubId: r.club_id, clubName: r.club_name, leagueTier: tiers.get(r.club_id) ?? null, players: [], wageTotal: 0 };
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
  await requireAdmin(c.env, c.req.raw, 'club.compliance.view');
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

  const clubs = await c.env.DB.prepare('SELECT id, name FROM clubs ORDER BY id LIMIT 200').all<{
    id: number;
    name: string;
  }>();
  const regRows = await c.env.DB.prepare(
    `SELECT r.club_id, r.player_id, r.squad, ${sqlDisplayName('p')} AS name, p.position, p.ca, p.pa, p.base_ca, p.growable,
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
      base_ca: number | null;
      growable: number;
      contract_player_id: number | null;
      wage: number | null;
    }>();

  const cache = tierCache();
  const report = await Promise.all(
    clubs.results.map(async (club) => {
      const mine = regRows.results.filter((r) => r.club_id === club.id);
      // v1.2.0：级别报名派生；派生不到（未报名定级赛事）标 tier_missing，不再静默当 premier
      const tier = await deriveClubTier(c.env, season, club.id, cache);
      if (mine.length === 0) {
        return {
          clubId: club.id,
          clubName: club.name,
          leagueTier: tier,
          pass: false,
          issues: [{ rule: 'not_registered', message: '本赛季还没提交注册名单', playerIds: [] }],
          stats: null,
        };
      }
      if (tier === null) {
        return {
          clubId: club.id,
          clubName: club.name,
          leagueTier: null,
          pass: false,
          issues: [{ rule: 'tier_missing', message: '未定级：本赛季没有报名任何定级赛事（顶级/次级联赛）', playerIds: [] }],
          stats: null,
        };
      }
      const toSp = (r: (typeof mine)[number]): SquadPlayer => ({
        playerId: r.player_id,
        name: r.name,
        position: r.position,
        ca: r.ca,
        pa: r.pa,
        initialCa: r.base_ca ?? r.ca,
        growable: r.growable === 1,
        hasContract: r.contract_player_id !== null,
        wage: r.contract_player_id !== null ? r.wage ?? 0 : null,
      });
      const firstTeam = mine.filter((r) => r.squad === 'first_team').map(toSp);
      const trainee = mine.filter((r) => r.squad === 'trainee').map(toSp);
      const rules = await loadSquadContext(c.env.DB, tier);
      const result = checkSquad(firstTeam, trainee, rules);
      return {
        clubId: club.id,
        clubName: club.name,
        leagueTier: tier,
        pass: result.pass,
        issues: result.issues,
        stats: result.stats,
      };
    }),
  );
  return c.json({ season, clubs: report });
});

// ---- 审核队列（附录 A〔3〕：转会成交确认；关键节点人工审） ----

interface ReviewTaskRow {
  id: number;
  status: string;
  payload: string | null;
  decided_by: number | null;
  decided_at: string | null;
  note: string | null;
  transfer_id: number;
  transfer_status: string;
  transfer_type: string;
  fee: number | null;
  tax: number | null;
  extra_fee: number | null;
  player_id: number;
  player_name: string;
  position: string | null;
  ca: number | null;
  pa: number | null;
  from_name: string | null;
  to_name: string | null;
}

// GET /api/admin/reviews?status=open —— 成交确认队列
app.get('/reviews', async (c) => {
  await requireAdmin(c.env, c.req.raw);
  const status = c.req.query('status') ?? 'open';
  if (!['open', 'approved', 'rejected', 'all'].includes(status)) throw new HttpError(400, 'status 只能是 open / approved / rejected / all');
  const where = status === 'all' ? "rt.type = 'transfer_confirm'" : `rt.type = 'transfer_confirm' AND rt.status = ?`;
  const rows = await c.env.DB.prepare(
    `SELECT rt.id, rt.status, rt.payload, rt.decided_by, rt.decided_at, rt.note,
            t.id AS transfer_id, t.status AS transfer_status, t.type AS transfer_type, t.fee, t.tax, t.extra_fee,
            t.player_id, ${sqlDisplayName('p')} AS player_name, p.position, p.ca, p.pa,
            cf.name AS from_name, ct.name AS to_name
     FROM review_tasks rt
     JOIN transfers t ON t.id = rt.ref_id
     JOIN players p ON p.id = t.player_id
     LEFT JOIN clubs cf ON cf.id = t.from_club_id
     LEFT JOIN clubs ct ON ct.id = t.to_club_id
     WHERE ${where}
     ORDER BY rt.id DESC LIMIT 100`,
  )
    .bind(...(status === 'all' ? [] : [status]))
    .all<ReviewTaskRow>();
  return c.json({
    reviews: rows.results.map((r) => ({
      id: r.id,
      status: r.status,
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
      note: r.note,
      decidedAt: r.decided_at,
      transfer: {
        id: r.transfer_id,
        type: r.transfer_type,
        status: r.transfer_status,
        fee: r.fee,
        tax: r.tax,
        extraFee: r.extra_fee,
        player: { id: r.player_id, name: r.player_name, position: r.position, ca: r.ca, pa: r.pa },
        fromClubName: r.from_name,
        toClubName: r.to_name,
      },
    })),
  });
});

async function loadOpenReviewTask(db: D1Database, taskId: number) {
  const task = await db
    .prepare(`SELECT id, ref_id, status FROM review_tasks WHERE id = ? AND type = 'transfer_confirm'`)
    .bind(taskId)
    .first<{ id: number; ref_id: number; status: string }>();
  if (!task) throw new HttpError(404, '审核任务不存在');
  if (task.status !== 'open') throw new HttpError(409, '这条审核已经处理过了');
  return task;
}

// POST /api/admin/reviews/:id/approve —— 批准成交（§6.3/§6.7）
// 解约：无工资谈判，批准即过户；续约/匹配/海捞：先收附加费再进签约谈判（F 已定死）；
// 普通成交/激活成交：进入签约谈判，由签入方谈成合同条款后成约过户（成约即过户）。
// v1.3.0 裁定扩权：普通成交/激活成交可在批准时改成交价（body.fee），税在过户时按新价重算，留审计。
app.post('/reviews/:id/approve', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const taskId = Number(c.req.param('id'));
  if (!Number.isInteger(taskId)) throw new HttpError(400, '审核任务 ID 不对');
  const body = (await readJson(c)) as { note?: unknown; fee?: unknown } | null;
  const note = typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
  const task = await loadOpenReviewTask(c.env.DB, taskId);
  const transfer = await loadTransfer(c.env.DB, task.ref_id);
  if (!transfer) throw new HttpError(404, '转会单不存在');
  let feeAdjusted: number | null = null;
  if (body?.fee !== undefined) {
    if (transfer.type !== 'transfer' && transfer.type !== 'activation') {
      throw new HttpError(400, '改价裁定只适用于普通成交与激活成交单');
    }
    const fee = Number(body.fee);
    if (!Number.isFinite(fee) || fee <= 0) throw new HttpError(400, '成交价须为正数（单位 m）');
    const result = await c.env.DB
      .prepare(`UPDATE transfers SET fee = ? WHERE id = ? AND status = 'pending_review'`)
      .bind(fee, task.ref_id)
      .run();
    if ((result.meta.changes ?? 0) !== 1) throw new HttpError(409, '转会单不在待审状态，改价失败');
    feeAdjusted = fee;
    await writeAudit(c.env.DB, {
      actor: user.id,
      action: 'admin_fee_adjust',
      targetType: 'transfer',
      targetId: task.ref_id,
      after: { reason: note, oldFee: transfer.fee, newFee: fee },
    });
  }
  const result = await approveTransferDeal(c.env, task.ref_id, user.id, {
    taskId,
    decidedBy: user.id,
    decision: 'approved',
    note: feeAdjusted !== null ? `${note ?? ''}（管理组裁定成交价 ${transfer.fee} → ${feeAdjusted} m）`.trim() : note ?? undefined,
  });
  return c.json({ ok: true, ...result });
});

// POST /api/admin/reviews/:id/reject —— 驳回（解冻资金，挂牌下架不收费）
app.post('/reviews/:id/reject', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const taskId = Number(c.req.param('id'));
  if (!Number.isInteger(taskId)) throw new HttpError(400, '审核任务 ID 不对');
  const body = (await readJson(c)) as { note?: unknown } | null;
  const note = typeof body?.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
  const task = await loadOpenReviewTask(c.env.DB, taskId);
  const result = await rejectTransfer(c.env, task.ref_id, user.id, {
    taskId,
    decidedBy: user.id,
    decision: 'rejected',
    note: note ?? undefined,
  });
  return c.json({ ok: true, ...result });
});

export default app;
