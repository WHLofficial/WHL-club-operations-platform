// 教练侧注册（附录 A〔2〕）：名单查看 + 提交校验。合规判定全在 core/squad-rules（规则 4.2），
// 路由层只做身份/归属/请求形状校验与落库；提交整体一个 batch（快照替换 + 状态同步 + 审计）。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { HttpError } from '../../lib/http.ts';
import { requireCoach } from '../../lib/session.ts';
import { checkSquad, markerOf } from '../../core/squad-rules.ts';
import { loadSquadView, loadSquadWages, projectLoyaltyExpense, toSquadPlayer as viewToSquadPlayer } from '../squad-view.ts';
import { serviceSeasons } from '../../core/bypass-rules.ts';
import { PS_SLOT_COUNT } from '../../core/fc26.ts';
import { CURRENT_TICKS_SQL, closedRegularTicks } from '../contract-ticks.ts';
import { getOpenWindow, getVisibleSeason } from '../seasons.ts';
import { loadSquadContext } from '../squad-context.ts';
import { getBoundClub } from '../binding.ts';
import { deriveClubTier, tierCache } from '../tier.ts';
import { rowDisplayName } from '../../core/player-name.ts';
import { influenceCoefs, influenceOf } from '../influence.ts';
import { createAuditStatement } from '../../lib/audit.ts';
import { loadClubPendingChanges } from '../demand-ops.ts';

const app = new Hono<{ Bindings: Env }>();

function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

interface OwnedPlayerRow {
  id: number;
  fc_id: number | null;
  name: string;
  display_name: string | null;
  number: string | null;
  position: string | null;
  age: number | null;
  ca: number | null;
  pa: number | null;
  base_ca: number | null;
  growable: number;
  is_future_star: number;
  china_plan: number;
  status: string;
  market_value: number | null;
  // v6.30.0 C 段：注册工作台的可选列要用的原始列（口径同 routes/players.ts 的列表行）
  uid: string;
  prestige: number | null;
  foot: number | null;
  growth_tier: number;
  agent_tier: number;
  badges_silver: number;
  badges_gold: number;
}

// v6.30.0 C 段：PlayStyle 15 槽（口径同 routes/players.ts:482 的 psSlots —— 那边只在 ps 筛选时才取，
// 注册工作台的可选列随时可能被勾出来，所以这里无条件带上，15 个 json_extract 对 ≤500 行可以忽略）
const PS_SLOT_SELECTS = Array.from(
  { length: PS_SLOT_COUNT },
  (_, i) => `, json_extract(game_attrs, '$.PSID${i + 1}') AS ps${i + 1}`,
).join('');

async function loadOwnedPlayers(env: Env, clubId: number): Promise<OwnedPlayerRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, fc_id, name, display_name, number, position, age, ca, pa, base_ca, growable, is_future_star, china_plan, status,
            market_value, uid, prestige, foot, growth_tier, agent_tier, badges_silver, badges_gold${PS_SLOT_SELECTS}
     FROM players WHERE club_id = ? ORDER BY id LIMIT 500`,
  )
    .bind(clubId)
    .all<OwnedPlayerRow>();
  return rows.results;
}

interface ContractInfo {
  wage: number;
  releaseFee: number | null;
  contractType: string;
  // v6.30.0 C 段：可选列要用的合同侧字段
  source: string | null;
  serviceSeasons: number | null;
  protected: boolean;
  // v6.62.0 §5.6：免费续约机会还没用（0 = 下一张续约单自动免费）
  freeRcUsed: number;
}

async function loadContractMap(env: Env, clubId: number): Promise<Map<number, ContractInfo>> {
  const rows = await env.DB.prepare(
    `SELECT player_id, wage, release_fee, contract_type, source, service_ticks, protection_ticks, free_rc_change_used,
            ${CURRENT_TICKS_SQL} AS current_ticks
     FROM contracts WHERE club_id = ? AND is_active = 1 LIMIT 500`,
  )
    .bind(clubId)
    .all<{
      player_id: number;
      wage: number | null;
      release_fee: number | null;
      contract_type: string;
      source: string | null;
      service_ticks: number | null;
      protection_ticks: number | null;
      free_rc_change_used: number;
      current_ticks: number;
    }>();
  return new Map(
    rows.results.map((r) => [
      r.player_id,
      {
        wage: r.wage ?? 0,
        releaseFee: r.release_fee,
        contractType: r.contract_type,
        source: r.source,
        // 效力时长（赛季）与保护期口径同 routes/players.ts:799-800
        serviceSeasons: serviceSeasons(r.service_ticks ?? 0, r.current_ticks),
        protected: r.protection_ticks !== null && r.current_ticks < r.protection_ticks,
        freeRcUsed: r.free_rc_change_used,
      },
    ]),
  );
}

// GET /api/club/squad —— 注册工作台数据：全队名单 + 现行合同 + 当前快照 + 快照体检
app.get('/club/squad', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.registrations.submit');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) {
    return c.json({
      club: null,
      season: null,
      players: [],
      registration: null,
      compliance: null,
      rules: null,
      pendingSummary: { count: 0, wageDelta: 0 },
    });
  }
  const season = await getVisibleSeason(c.env.DB);
  const cache = tierCache();
  const tier = await deriveClubTier(c.env, season, club.id, cache);
  // v6.67.0 期一（D1）：名单由合同推导，不再读 registrations 快照
  const [players, contractMap, view, rules, inflCoefs, pendingChanges, loyalty, openWindow] = await Promise.all([
    loadOwnedPlayers(c.env, club.id),
    loadContractMap(c.env, club.id),
    loadSquadView(c.env.DB, club.id),
    // v1.2.0：未报名定级赛事时 rules 置空，前端挂红色「未报名」状态条
    tier !== null ? loadSquadContext(c.env.DB, tier) : Promise.resolve(null),
    // v6.37.0：名单卡的市场视图要下发影响力（与 /api/players 同源系数与 JS 镜像）
    influenceCoefs(c.env.DB),
    // v6.54.0 步骤 7（§10.5）：注册工作台的「待生效」第二行与 projected 双预检的数据源。
    // 本端点已 requireCoach + 本俱乐部绑定，pending 只出现在这里、不进公开列表缓存。
    loadClubPendingChanges(c.env, club.id),
    // 预计忠诚支出（规则 4.3.2）：只在中期末窗关窗时扣，工作台按现行合同预演一次供教练排预算
    closedRegularTicks(c.env.DB).then((n) => projectLoyaltyExpense(c.env.DB, club.id, n + 1)),
    getOpenWindow(c.env.DB),
  ]);
  const pendingByPlayer = new Map(pendingChanges.map((pc) => [pc.playerId, pc]));

  const squadByPlayer = new Map<number, 'first_team' | 'trainee'>();
  for (const r of view.firstTeam) squadByPlayer.set(r.playerId, 'first_team');
  for (const r of view.trainee) squadByPlayer.set(r.playerId, 'trainee');
  // 未签约的人不进体检（D2）：他们只出现在「未签约」区，红字靠 contract 规则点名
  const compliance =
    tier !== null && rules !== null
      ? checkSquad(view.firstTeam.map(viewToSquadPlayer), view.trainee.map(viewToSquadPlayer), rules)
      : null;
  const unsignedIds = players.filter((p) => !squadByPlayer.has(p.id)).map((p) => p.id);
  if (unsignedIds.length > 0 && compliance !== null) {
    compliance.issues.push({
      rule: 'contract',
      message: `有 ${unsignedIds.length} 名球员没有在队合同（不占人数、不计工资，但上不了场）`,
      playerIds: unsignedIds,
    });
    compliance.pass = false;
  }
  // 待生效工资增量（全队口径；前端 cap bar 只按「已分配球员」再算一遍，两个口径分开不混用）
  let pendingWageDelta = 0;
  for (const pc of pendingChanges) {
    const current = contractMap.get(pc.playerId);
    if (current) pendingWageDelta += pc.wage - current.wage;
  }

  // v6.69.0 期二（§3.3）：薪资三段。now 与窗末扣费同源（全部 active 合同），
  // baseline 缺失就退两段（D12），不拿 0 冒充窗初。
  const wages = await loadSquadWages(c.env.DB, club.id, {
    cap: rules?.wageCap ?? null,
    pendingDelta: Math.round(pendingWageDelta * 100) / 100,
    season: openWindow?.season ?? null,
    windowSeq: openWindow?.windowSeq ?? null,
  });

  return c.json({
    club: { id: club.id, name: club.name, leagueTier: tier },
    season,
    // 报名状态探测（v1.2.0）：registeredInTournament=已报定级赛事（tier 非 null）
    registeredInTournament: tier !== null,
    players: players.map((p) => {
      const contract = contractMap.get(p.id) ?? null;
      const pending = pendingByPlayer.get(p.id) ?? null;
      return {
        id: p.id,
        fcId: p.fc_id,
        uid: p.uid,
        name: rowDisplayName(p),
        number: p.number,
        position: p.position,
        age: p.age,
        ca: p.ca,
        pa: p.pa,
        baseCa: p.base_ca,
        // 标记（v6.30.0 C 段）：纯函数与 /api/players 同一口径（初始 CA 缺省回现值）
        marker: markerOf(p.base_ca ?? p.ca, p.pa, p.growable === 1, p.ca),
        growable: p.growable === 1,
        isFutureStar: p.is_future_star === 1,
        chinaPlan: p.china_plan === 1,
        prestige: p.prestige,
        // 影响力（v6.37.0）：与 /api/players 同源（influenceOf 镜像，现值 CA/PA 口径）
        influence: influenceOf(inflCoefs, p.ca, p.pa, p.growable === 1, p.prestige),
        status: p.status,
        marketValue: p.market_value,
        foot: p.foot,
        growthTier: p.growth_tier,
        agentTier: p.agent_tier,
        badgesSilver: p.badges_silver,
        badgesGold: p.badges_gold,
        wage: contract?.wage ?? null,
        releaseFee: contract?.releaseFee ?? null,
        contractType: contract?.contractType ?? null,
        source: contract?.source ?? null,
        serviceSeasons: contract?.serviceSeasons ?? null,
        protected: contract?.protected ?? false,
        // 槽位对齐：保留 15 长度、缺槽为 null（前端金徽判定要按真实槽位，口径同 routes/players.ts:802-808）
        psIds: Array.from({ length: PS_SLOT_COUNT }, (_, i) => {
          const v = (p as unknown as Record<string, unknown>)[`ps${i + 1}`];
          return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
        }),
        hasContract: contract !== null,
        squad: squadByPlayer.get(p.id) ?? null,
        // 待生效（v6.54.0 步骤 7，§10.5）：工资/违约金新值 + 来源；releaseFee 为 null = RC 不变，
        // 前端据此只给工资加第二行。本端点只服务本队教练，不会外泄给访客。
        hasPending: pending !== null,
        pendingWage: pending?.wage ?? null,
        pendingReleaseFee: pending?.releaseFee ?? null,
        pendingSource: pending?.source ?? null,
        pendingProtectionTicks: pending?.protectionTicks ?? null,
        pendingEffectiveWindowSeq: pending?.effectiveWindowSeq ?? null,
        // 免费续约机会（v6.62.0 §5.6）：只有本队教练可见，控制续约入口的「本次免费」提示
        freeRcAvailable: contract !== null && contract.freeRcUsed === 0,
      };
    }),
    pendingSummary: { count: pendingChanges.length, wageDelta: Math.round(pendingWageDelta * 100) / 100 },
    compliance,
    /** 未签约球员 ID（D2：单开一区，不占人数、不计工资） */
    unsigned: unsignedIds,
    loyalty,
    wages,
    rules: rules === null
      ? null
      : {
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

// 球衣号（v4.0.0；v6.76.0 批量分配）：号码属于俱乐部，换队/解约时由 transfers.ts 清空。
// v6.2.0 起归转会窗管（用户裁决：改号也是转会期操作）——关窗一律 409 no_window。
// 批量端点是「最终态」提交：只传变动项，整单全有或全无；同队唯一性由 0092 的部分唯一索引兜底。
interface NumberAssignment {
  playerId: number;
  number: string | null;
}

interface NumberConflict {
  number: string;
  playerId: number;
  playerName: string;
}

interface OwnedNumberRow {
  id: number;
  name: string;
  display_name: string | null;
  number: string | null;
}

function normalizeNumber(raw: unknown): string | null {
  // 清号（null / 空串）是正常操作：刚签下的球员可以先跳过，号码换人也得先把旧的摘掉
  if (raw === null || raw === undefined || raw === '') return null;
  // 只收 true 数字或十进制字符串，避免 true→1、'0x10'→16 这类隐式转换写进号码
  if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d{1,2}$/.test(raw))) {
    throw new HttpError(400, '球衣号要填 1–99 的整数');
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new HttpError(400, '球衣号要填 1–99 的整数');
  return String(n);
}

async function resolveNumberAssignments(
  db: D1Database,
  clubId: number,
  assignments: NumberAssignment[],
): Promise<{ applied: { playerId: number; before: string | null; after: string | null }[]; conflicts: NumberConflict[] }> {
  const rows = await db
    .prepare('SELECT id, name, display_name, number FROM players WHERE club_id = ?')
    .bind(clubId)
    .all<OwnedNumberRow>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  for (const a of assignments) {
    if (!byId.has(a.playerId)) throw new HttpError(404, '这名球员不在你的队里');
  }

  // 同一份 payload 里不能出现两个相同的目标号；换号/对调靠「每人一条 assignment」表达。
  const submittedNumbers = new Map<string, number>();
  for (const a of assignments) {
    if (a.number === null) continue;
    const prev = submittedNumbers.get(a.number);
    if (prev !== undefined) throw new HttpError(400, `名单里 ${a.number} 号出现了两次`);
    submittedNumbers.set(a.number, a.playerId);
  }

  // 先把所有人的最终号码算出来，再找仍被别人占着的号；这样 A↔B 对调、链式换号都不会误报。
  const final = new Map<number, string | null>();
  for (const row of rows.results) final.set(row.id, row.number);
  for (const a of assignments) final.set(a.playerId, a.number);
  const holders = new Map<string, number[]>();
  for (const [id, number] of final) {
    if (number === null) continue;
    const list = holders.get(number);
    if (list) list.push(id);
    else holders.set(number, [id]);
  }
  const submitted = new Set(assignments.map((a) => a.playerId));
  const conflicts: NumberConflict[] = [];
  for (const [number, ids] of holders) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      // 两个提交项撞同一个号已在上面按 400 拒绝；这里只剩「没提交的队友还占着这个号」。
      if (submitted.has(id)) continue;
      const row = byId.get(id);
      if (row) conflicts.push({ number, playerId: id, playerName: rowDisplayName(row) });
    }
  }
  conflicts.sort((a, b) => Number(a.number) - Number(b.number));

  const applied = assignments
    .map((a) => ({ playerId: a.playerId, before: byId.get(a.playerId)?.number ?? null, after: a.number }))
    .filter((a) => a.before !== a.after);
  return { applied, conflicts };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 一条 batch 内先全部置 NULL、再写最终值：对调/链式换号不会撞 0092 的唯一索引。
// 100 人才是上限，所以按 D1 的 100 个绑定参数/语句切块；审计逐人走 lib/audit.ts。
async function writeNumberAssignments(
  env: Env,
  userId: number,
  clubId: number,
  applied: { playerId: number; before: string | null; after: string | null }[],
): Promise<void> {
  if (applied.length === 0) return;
  const db = env.DB;
  const stmts: D1PreparedStatement[] = [];

  for (const part of chunks(applied.map((a) => a.playerId), 90)) {
    stmts.push(
      db
        .prepare(
          `UPDATE players SET number = NULL, updated_at = ${nowSql()}
            WHERE club_id = ? AND id IN (${part.map(() => '?').join(',')})`,
        )
        .bind(clubId, ...part),
    );
  }

  const finals = applied.filter((a) => a.after !== null);
  for (const part of chunks(finals, 30)) {
    const caseSql = part.map(() => 'WHEN ? THEN ?').join(' ');
    stmts.push(
      db
        .prepare(
          `UPDATE players SET number = CASE id ${caseSql} END, updated_at = ${nowSql()}
            WHERE club_id = ? AND id IN (${part.map(() => '?').join(',')})`,
        )
        .bind(...part.flatMap((a) => [a.playerId, a.after as string]), clubId, ...part.map((a) => a.playerId)),
    );
  }

  // 审计统一走 lib/audit.ts（ledger-audit-lock 只允许那里手写 audit_log INSERT）
  const audit = createAuditStatement(db);
  for (const a of applied) {
    stmts.push(
      audit({
        actor: userId,
        action: 'player_number',
        targetType: 'player',
        targetId: a.playerId,
        origin: 'user',
        before: { number: a.before },
        after: { number: a.after },
      }),
    );
  }

  try {
    await db.batch(stmts);
  } catch (err) {
    // 应用层已先查一遍；这里只兜并发窗口（另一个请求刚抢走号码），整批回滚后让用户重试。
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      throw new HttpError(409, '有号码刚被其他操作占用，请重试');
    }
    throw err;
  }
}

// PUT /api/club/squad/numbers —— 一线队号码批量分配（v6.76.0）
// body: { assignments: [{ playerId, number: 1–99 | null }] }，最多 100 人，只传变动项。
app.put('/club/squad/numbers', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  if (!(await getOpenWindow(c.env.DB))) throw new HttpError(409, '转会窗口没开，现在改不了号码', 'no_window');

  const body = (await c.req.raw.json().catch(() => null)) as { assignments?: unknown } | null;
  if (!body || !Array.isArray(body.assignments)) throw new HttpError(400, '请求格式不对');
  if (body.assignments.length > 100) throw new HttpError(400, '一次最多改 100 名球员');

  const assignments: NumberAssignment[] = [];
  const seenPlayers = new Set<number>();
  for (const item of body.assignments) {
    if (item === null || typeof item !== 'object') throw new HttpError(400, '请求格式不对');
    const raw = item as { playerId?: unknown; number?: unknown };
    // 批量端点漏传 number 不能当成清号：字段名写错会一次清掉 100 人的号码。
    if (!('number' in raw)) throw new HttpError(400, '请求格式不对');
    const playerId = Number(raw.playerId);
    if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');
    if (seenPlayers.has(playerId)) throw new HttpError(400, '同一名球员不能出现两次');
    seenPlayers.add(playerId);
    assignments.push({ playerId, number: normalizeNumber(raw.number) });
  }

  const { applied, conflicts } = await resolveNumberAssignments(c.env.DB, club.id, assignments);
  if (conflicts.length > 0) {
    // 结构化冲突给前端就地标红；整单不落库，草稿保留。
    return c.json({ error: '有号码和队友冲突，先处理标红的号码', code: 'number_conflict', conflicts }, 409);
  }
  await writeNumberAssignments(c.env, user.id, club.id, applied);
  return c.json({ ok: true, applied });
});

// POST /api/club/players/:id/number —— 单条改号（保留给球员页；与批量共用同一校验/写入核心）
app.post('/club/players/:id/number', async (c) => {
  const user = await requireCoach(c.env, c.req.raw, 'club.squad.manage');
  const club = await getBoundClub(c.env, user.id, c.req.raw);
  if (!club) throw new HttpError(404, '你的账号还没绑定俱乐部，先到「球队登记」完成归属');
  if (!(await getOpenWindow(c.env.DB))) throw new HttpError(409, '转会窗口没开，现在改不了号码', 'no_window');
  const playerId = Number(c.req.param('id'));
  if (!Number.isInteger(playerId) || playerId <= 0) throw new HttpError(400, '球员 ID 不对');

  const body = (await c.req.raw.json().catch(() => null)) as { number?: unknown } | null;
  if (!body) throw new HttpError(400, '请求格式不对');
  const assignment = { playerId, number: normalizeNumber(body.number) };

  const { applied, conflicts } = await resolveNumberAssignments(c.env.DB, club.id, [assignment]);
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    throw new HttpError(409, `${conflict.number} 号已经给 ${conflict.playerName} 了，先给他换个号`);
  }
  await writeNumberAssignments(c.env, user.id, club.id, applied);

  return c.json({ ok: true, id: playerId, number: assignment.number });
});

export default app;
