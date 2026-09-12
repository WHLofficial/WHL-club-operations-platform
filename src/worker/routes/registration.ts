// 教练侧注册（附录 A〔2〕）：名单查看 + 提交校验。合规判定全在 core/squad-rules（规则 4.2），
// 路由层只做身份/归属/请求形状校验与落库；提交整体一个 batch（快照替换 + 状态同步 + 审计）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { createAuditStatement } from '../../lib/audit.ts';
import { checkSquad, type SquadPlayer } from '../../core/squad-rules.ts';
import { getRegistrableSeason, getVisibleSeason } from '../seasons.ts';
import { loadSquadContext } from '../squad-context.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface BoundClub {
  id: number;
  name: string;
  league_tier: string | null;
}

async function getBoundClub(env: Env, userId: number): Promise<BoundClub | null> {
  return env.DB.prepare(
    `SELECT c.id, c.name, c.league_tier FROM club_bindings b JOIN clubs c ON c.id = b.club_id WHERE b.user_id = ?`,
  )
    .bind(userId)
    .first<BoundClub>();
}

interface OwnedPlayerRow {
  id: number;
  name: string;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  base_ca: number | null;
  growable: number;
  is_future_star: number;
  china_plan: number;
  status: string;
}

async function loadOwnedPlayers(env: Env, clubId: number): Promise<OwnedPlayerRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, name, position, age, ca, pa, base_ca, growable, is_future_star, china_plan, status
     FROM players WHERE club_id = ? ORDER BY id LIMIT 500`,
  )
    .bind(clubId)
    .all<OwnedPlayerRow>();
  return rows.results;
}

interface ContractInfo {
  wage: number;
  contractType: string;
}

async function loadContractMap(env: Env, clubId: number): Promise<Map<number, ContractInfo>> {
  const rows = await env.DB.prepare(
    `SELECT player_id, wage, contract_type FROM contracts WHERE club_id = ? AND is_active = 1 LIMIT 500`,
  )
    .bind(clubId)
    .all<{ player_id: number; wage: number | null; contract_type: string }>();
  return new Map(rows.results.map((r) => [r.player_id, { wage: r.wage ?? 0, contractType: r.contract_type }]));
}

function toSquadPlayer(p: OwnedPlayerRow, contract: ContractInfo | null): SquadPlayer {
  return {
    playerId: p.id,
    name: p.name,
    position: p.position,
    ca: p.ca,
    pa: p.pa,
    initialCa: p.base_ca ?? p.ca,
    growable: p.growable === 1,
    hasContract: contract !== null,
    wage: contract?.wage ?? null,
  };
}

// GET /api/club/squad —— 注册工作台数据：全队名单 + 现行合同 + 当前快照 + 快照体检
app.get('/club/squad', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) {
    return c.json({ club: null, season: null, players: [], registration: null, compliance: null, rules: null });
  }
  const season = await getVisibleSeason(c.env.DB);
  const [players, contractMap, regRows, rules] = await Promise.all([
    loadOwnedPlayers(c.env, club.id),
    loadContractMap(c.env, club.id),
    season
      ? c.env.DB.prepare('SELECT player_id, squad FROM registrations WHERE season = ? AND club_id = ?')
          .bind(season, club.id)
          .all<{ player_id: number; squad: string }>()
      : Promise.resolve({ results: [] as { player_id: number; squad: string }[] }),
    loadSquadContext(c.env.DB, club.league_tier),
  ]);

  const squadByPlayer = new Map(regRows.results.map((r) => [r.player_id, r.squad]));
  const firstTeam: SquadPlayer[] = [];
  const trainee: SquadPlayer[] = [];
  for (const p of players) {
    const squad = squadByPlayer.get(p.id) ?? null;
    const sp = toSquadPlayer(p, contractMap.get(p.id) ?? null);
    if (squad === 'first_team') firstTeam.push(sp);
    else if (squad === 'trainee') trainee.push(sp);
  }
  const compliance = regRows.results.length > 0 ? checkSquad(firstTeam, trainee, rules) : null;

  return c.json({
    club: { id: club.id, name: club.name, leagueTier: club.league_tier },
    season,
    players: players.map((p) => {
      const contract = contractMap.get(p.id) ?? null;
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        age: p.age,
        ca: p.ca,
        pa: p.pa,
        growable: p.growable === 1,
        isFutureStar: p.is_future_star === 1,
        chinaPlan: p.china_plan === 1,
        status: p.status,
        wage: contract?.wage ?? null,
        contractType: contract?.contractType ?? null,
        hasContract: contract !== null,
        squad: squadByPlayer.get(p.id) ?? null,
      };
    }),
    registration: regRows.results.length > 0
      ? {
          firstTeam: regRows.results.filter((r) => r.squad === 'first_team').map((r) => r.player_id),
          trainee: regRows.results.filter((r) => r.squad === 'trainee').map((r) => r.player_id),
        }
      : null,
    compliance,
    rules: {
      squadMin: rules.squadMin,
      squadMax: rules.squadMax,
      gkMin: rules.gkMin,
      traineeMax: rules.traineeMax,
      wageCap: rules.wageCap,
      limits: rules.limits,
      tier: rules.tier,
    },
  });
});

function parseIdList(raw: unknown, label: string): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, `${label} 应为球员 ID 数组`);
  const ids: number[] = [];
  for (const x of raw) {
    const n = Number(x);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label}里有不合法的球员 ID`);
    ids.push(n);
  }
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length > 0) throw new HttpError(400, `${label}里出现了重复球员：${dupes.join('、')}`);
  return ids;
}

// POST /api/club/registrations —— 提交注册名单（快照整体替换，重复提交安全）
app.post('/club/registrations', async (c) => {
  const user = await requireCoach(c.env, c.req.raw);
  const club = await getBoundClub(c.env, user.id);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');

  const body = (await c.req.raw.json().catch(() => null)) as { firstTeam?: unknown; trainee?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const firstTeamIds = parseIdList(body.firstTeam, '一线队名单');
  const traineeIds = parseIdList(body.trainee, '训练营名单');

  const overlap = firstTeamIds.filter((id) => traineeIds.includes(id));
  if (overlap.length > 0) throw new HttpError(400, `同一球员不能同时进一线队和训练营：${overlap.join('、')}`);

  const season = await getRegistrableSeason(c.env.DB);
  if (season === null) {
    throw new HttpError(409, '当前没有开放注册的赛季（只有备赛期能提交名单）', 'no_season');
  }

  const [players, contractMap, rules] = await Promise.all([
    loadOwnedPlayers(c.env, club.id),
    loadContractMap(c.env, club.id),
    loadSquadContext(c.env.DB, club.league_tier),
  ]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const allRequested = [...firstTeamIds, ...traineeIds];
  const notOwned = allRequested.filter((id) => !byId.has(id));
  if (notOwned.length > 0) throw new HttpError(400, `这些球员不在你的队里：${notOwned.join('、')}`);
  const retired = allRequested.filter((id) => byId.get(id)!.status === 'retired');
  if (retired.length > 0) {
    throw new HttpError(400, `退役球员不能注册：${retired.map((id) => byId.get(id)!.name).join('、')}`);
  }

  const firstTeam = firstTeamIds.map((id) => toSquadPlayer(byId.get(id)!, contractMap.get(id) ?? null));
  const trainee = traineeIds.map((id) => toSquadPlayer(byId.get(id)!, contractMap.get(id) ?? null));

  const result = checkSquad(firstTeam, trainee, rules);
  if (!result.pass) {
    return c.json({ error: '名单没过注册校验', code: 'squad_invalid', issues: result.issues, stats: result.stats }, 422);
  }

  const prev = await c.env.DB.prepare('SELECT player_id, squad FROM registrations WHERE season = ? AND club_id = ?')
    .bind(season, club.id)
    .all<{ player_id: number; squad: string }>();
  const prevTrainee = prev.results.filter((r) => r.squad === 'trainee').map((r) => r.player_id);
  const newTraineeSet = new Set(traineeIds);
  const demoted = prevTrainee.filter((id) => !newTraineeSet.has(id));

  const audit = createAuditStatement(c.env.DB);
  const statements = [
    c.env.DB.prepare('DELETE FROM registrations WHERE season = ? AND club_id = ?').bind(season, club.id),
    ...firstTeamIds.map((id) =>
      c.env.DB.prepare('INSERT INTO registrations (season, club_id, player_id, squad) VALUES (?, ?, ?, ?)')
        .bind(season, club.id, id, 'first_team'),
    ),
    ...traineeIds.map((id) =>
      c.env.DB.prepare('INSERT INTO registrations (season, club_id, player_id, squad) VALUES (?, ?, ?, ?)')
        .bind(season, club.id, id, 'trainee'),
    ),
  ];
  if (traineeIds.length > 0) {
    const ph = traineeIds.map(() => '?').join(', ');
    statements.push(
      c.env.DB.prepare(`UPDATE players SET status = 'trainee', updated_at = ${nowSql()} WHERE id IN (${ph})`).bind(...traineeIds),
    );
  }
  if (demoted.length > 0) {
    const ph = demoted.map(() => '?').join(', ');
    statements.push(
      c.env.DB.prepare(`UPDATE players SET status = 'normal', updated_at = ${nowSql()} WHERE id IN (${ph}) AND status = 'trainee'`).bind(...demoted),
    );
  }
  statements.push(
    audit({
      actor: user.id,
      action: 'registration_submit',
      targetType: 'club',
      targetId: club.id,
      after: { season, firstTeam: firstTeamIds.length, trainee: traineeIds.length },
    }),
  );
  await c.env.DB.batch(statements);

  return c.json({
    ok: true,
    season,
    firstTeam: firstTeamIds.length,
    trainee: traineeIds.length,
    wageTotal: result.stats.wageTotal,
  });
});

export default app;
