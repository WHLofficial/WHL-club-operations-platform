// 关窗核验与关窗页看板（v6.69.0 期三，设计稿 §3.4 / D5 / D6 / D10 / D11）
//
// 一条口径贯穿三处：名单 = 合同推导（squad-view），体检 = checkSquad，结果只记录不阻断。
// - `loadWindowOverview` 给关窗页实时看板（逐队全列，包括 CPU）；
// - `squadAuditStatements` 把关窗瞬间的名单与体检结果存成 registrations 存档 + squad_audits；
// - 核验不通过的队由调用方在批末发站内信（只给金额与规则名，不含球员姓名）。
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env } from './env.ts';
import { deriveClubTiers } from './tier.ts';
import { loadSquadContext } from './squad-context.ts';
import { loadSquadViews, toSquadPlayer } from './squad-view.ts';
import { checkSquad } from '../core/squad-rules.ts';
import type { SquadIssue, SquadRuleContext } from '../core/squad-rules.ts';
import { getOpenWindow, getVisibleSeason } from './seasons.ts';

/** 规则名 → 中文（通知与看板 badge 共用；D10：只给金额与规则名，不点球员） */
export const SQUAD_RULE_LABEL: Record<string, string> = {
  squad_size: '人数',
  gk: '门将',
  trainee: '训练营',
  wage_cap: '工资帽',
  ca_pa: 'CA/PA',
  contract: '无合同',
  tier_missing: '未报名',
};

export interface SquadAuditRow {
  clubId: number;
  name: string;
  isCpu: boolean;
  tier: string | null;
  firstTeam: number;
  trainee: number;
  unsigned: number;
  wageNow: number;
  /** 关窗后工资（v6.72.3）：现行合同 + 本窗到期的待生效变更，口径与 applyPendingContractChanges 一致 */
  wageAfter: number;
  wageCap: number | null;
  overspend: number;
  pass: boolean;
  issues: { rule: string; message: string }[];
  pendingTransfers: number;
  activeSessions: number;
}

interface ClubRow {
  id: number;
  name: string;
  is_cpu: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * 本窗关窗时会落地的工资（v6.72.3）：`contract_pending_changes` 里 `effective_window_seq <= windowSeq`
 * 的 pending 行，关窗批会把 `wage_new` 写进 contracts（demand-ops.ts `applyPendingContractChanges`）。
 *
 * 判据与 apply 段完全一致：只算「合同仍在 pending 所属俱乐部」的行——球员本窗已转会/解约时
 * apply 会把这些行 void 掉（`left_club`），它们的工资不该预先计入。
 * 看板、关窗体检、站内信与存档共用这一份口径，否则关窗那一刻数字会突然变脸。
 */
async function loadPendingWages(
  env: Env,
  windowSeq: number | null,
): Promise<{ wageByPlayer: Map<number, number>; deltaByClub: Map<number, number> }> {
  const wageByPlayer = new Map<number, number>();
  const deltaByClub = new Map<number, number>();
  if (windowSeq === null) return { wageByPlayer, deltaByClub };
  const rows = (
    await env.DB.prepare(
      `SELECT pc.player_id, pc.club_id, pc.wage_new, c.wage AS wage_now
       FROM contract_pending_changes pc
       JOIN contracts c ON c.player_id = pc.player_id AND c.is_active = 1 AND c.club_id = pc.club_id
       WHERE pc.status = 'pending' AND pc.effective_window_seq <= ?`,
    )
      .bind(windowSeq)
      .all<{ player_id: number; club_id: number; wage_new: number; wage_now: number | null }>()
  ).results;
  for (const r of rows) {
    wageByPlayer.set(r.player_id, r.wage_new);
    deltaByClub.set(r.club_id, (deltaByClub.get(r.club_id) ?? 0) + (r.wage_new - (r.wage_now ?? 0)));
  }
  return { wageByPlayer, deltaByClub };
}

/** 逐队体检（内存态）：看板与关窗存档共用，避免两套口径。 */
async function computeAudit(env: Env, season: number | null, windowSeq: number | null): Promise<
  { clubs: ClubRow[]; views: Awaited<ReturnType<typeof loadSquadViews>>; contexts: Map<number, SquadRuleContext | null>; audits: SquadAuditRow[] }
> {
  const db = env.DB;
  const clubs = (
    await db
      .prepare(`SELECT id, name, COALESCE(is_cpu, 0) AS is_cpu FROM clubs WHERE status = 'active' ORDER BY name`)
      .all<ClubRow>()
  ).results;
  const ids = clubs.map((c) => c.id);
  const [views, tiers] = await Promise.all([loadSquadViews(db, ids), deriveClubTiers(env, season, ids)]);
  const contexts = new Map<number, SquadRuleContext | null>();
  for (const id of ids) {
    const tier = tiers.get(id) ?? null;
    contexts.set(id, tier === null ? null : await loadSquadContext(db, tier));
  }

  const wages = new Map<number, number>();
  for (const r of (
    await db
      .prepare(
        `SELECT club_id, COALESCE(SUM(wage), 0) AS total FROM contracts
         WHERE is_active = 1 AND club_id IS NOT NULL AND wage IS NOT NULL GROUP BY club_id`,
      )
      .all<{ club_id: number; total: number }>()
  ).results) {
    wages.set(r.club_id, round2(r.total));
  }

  // 本窗到期、关窗即落地的待生效工资（v6.72.3）：看板 / 体检 / 站内信 / 存档统一按关窗后口径
  const { wageByPlayer, deltaByClub } = await loadPendingWages(env, windowSeq);

  const pending = new Map<number, number>();
  for (const r of (
    await db
      .prepare(
        `SELECT club_id, COUNT(*) AS n FROM (
           SELECT from_club_id AS club_id FROM transfers WHERE status IN ('pending_review', 'signing') AND from_club_id IS NOT NULL
           UNION ALL
           SELECT to_club_id AS club_id FROM transfers WHERE status IN ('pending_review', 'signing') AND to_club_id IS NOT NULL
         ) GROUP BY club_id`,
      )
      .all<{ club_id: number; n: number }>()
  ).results) {
    pending.set(r.club_id, r.n);
  }

  const sessions = new Map<number, number>();
  for (const r of (
    await db
      .prepare(
        `SELECT p.club_id, COUNT(*) AS n FROM negotiation_sessions s
         JOIN transfers t ON t.id = s.transfer_id
         JOIN players p ON p.id = s.player_id
         WHERE s.status = 'active' AND p.club_id IS NOT NULL GROUP BY p.club_id`,
      )
      .all<{ club_id: number; n: number }>()
  ).results) {
    sessions.set(r.club_id, r.n);
  }

  const audits = clubs.map((club) => {
    const view = views.get(club.id) ?? { firstTeam: [], trainee: [], unsigned: [] };
    const ctx = contexts.get(club.id) ?? null;
    const isCpu = club.is_cpu === 1;
    const wageNow = wages.get(club.id) ?? 0;
    // 关窗后工资：把本窗到期的续约 / 涨薪换进去，体检的 wage 规则与超帽同源
    const wageAfter = round2(wageNow + (deltaByClub.get(club.id) ?? 0));
    const wageCap = ctx?.wageCap ?? null;
    const withPendingWage = (rows: typeof view.firstTeam): typeof rows =>
      wageByPlayer.size === 0 ? rows : rows.map((r) => (wageByPlayer.has(r.playerId) ? { ...r, wage: wageByPlayer.get(r.playerId)! } : r));
    // CPU 队不走规则、恒判通过（D11 / Q16）；stats 照实给，看板灰显。
    let pass = true;
    let issues: { rule: string; message: string }[] = [];
    if (!isCpu) {
      if (ctx !== null) {
        const result = checkSquad(
          withPendingWage(view.firstTeam).map(toSquadPlayer),
          withPendingWage(view.trainee).map(toSquadPlayer),
          ctx,
        );
        pass = result.pass;
        issues = result.issues.map((i: SquadIssue) => ({ rule: i.rule, message: i.message }));
      }
      if (view.unsigned.length > 0) {
        pass = false;
        issues.push({
          rule: 'contract',
          message: `有 ${view.unsigned.length} 名球员没有在队合同（不占人数、不计工资，但上不了场）`,
        });
      }
    }
    return {
      clubId: club.id,
      name: club.name,
      isCpu,
      tier: ctx?.tier ?? null,
      firstTeam: view.firstTeam.length,
      trainee: view.trainee.length,
      unsigned: view.unsigned.length,
      wageNow,
      wageAfter,
      wageCap,
      overspend: wageCap === null ? 0 : Math.max(0, round2(wageAfter - wageCap)),
      pass,
      issues,
      pendingTransfers: pending.get(club.id) ?? 0,
      activeSessions: sessions.get(club.id) ?? 0,
    };
  });
  return { clubs, views, contexts, audits };
}

/**
 * 关窗页实时看板（D9 / D11 / Q10 / Q17）：
 * 不通过的置顶、其后按超帽金额降序；CPU 队也列出来（前端灰显），便于对齐「为什么它在花钱」。
 */
export async function loadWindowOverview(env: Env): Promise<SquadAuditRow[]> {
  const season = await getVisibleSeason(env.DB);
  // 看板按「即将关闭的那个窗」算待生效：开着窗就是它，没开窗则没有会落地的变更
  const win = await getOpenWindow(env.DB);
  const { audits } = await computeAudit(env, season, win?.windowSeq ?? null);
  return audits.sort((a, b) => {
    if (a.pass !== b.pass) return a.pass ? 1 : -1;
    if (b.overspend !== a.overspend) return b.overspend - a.overspend;
    return a.clubId - b.clubId;
  });
}

/**
 * 关窗批的存档语句（D3 / D6 / D11 / Q6）：registrations 快照 + squad_audits 一行。
 * 只增不改，不阻断关窗；调用方把返回的语句并进关窗批，保证「窗口关闭」与「存档」同一原子步。
 */
export async function squadAuditStatements(
  env: Env,
  season: number,
  windowSeq: number,
): Promise<{ statements: D1PreparedStatement[]; audits: SquadAuditRow[] }> {
  const db = env.DB;
  const { views, audits } = await computeAudit(env, season, windowSeq);
  const statements: D1PreparedStatement[] = [];
  for (const audit of audits) {
    const view = views.get(audit.clubId) ?? { firstTeam: [], trainee: [], unsigned: [] };
    statements.push(db.prepare(`DELETE FROM registrations WHERE season = ? AND club_id = ?`).bind(season, audit.clubId));
    for (const row of view.firstTeam) {
      statements.push(
        db.prepare(`INSERT OR REPLACE INTO registrations (season, club_id, player_id, squad) VALUES (?, ?, ?, 'first_team')`).bind(season, audit.clubId, row.playerId),
      );
    }
    for (const row of view.trainee) {
      statements.push(
        db.prepare(`INSERT OR REPLACE INTO registrations (season, club_id, player_id, squad) VALUES (?, ?, ?, 'trainee')`).bind(season, audit.clubId, row.playerId),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO squad_audits (season, window_seq, club_id, pass, issues_json, stats_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          season,
          windowSeq,
          audit.clubId,
          audit.pass ? 1 : 0,
          JSON.stringify(audit.issues),
          JSON.stringify({
            firstTeam: audit.firstTeam,
            trainee: audit.trainee,
            unsigned: audit.unsigned,
            wageNow: audit.wageNow,
            wageAfter: audit.wageAfter,
            wageCap: audit.wageCap,
            overspend: audit.overspend,
            isCpu: audit.isCpu,
          }),
        ),
    );
  }
  return { statements, audits };
}
