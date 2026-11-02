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
import { getVisibleSeason } from './seasons.ts';

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

/** 逐队体检（内存态）：看板与关窗存档共用，避免两套口径。 */
async function computeAudit(env: Env, season: number | null): Promise<
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
    const wageCap = ctx?.wageCap ?? null;
    // CPU 队不走规则、恒判通过（D11 / Q16）；stats 照实给，看板灰显。
    let pass = true;
    let issues: { rule: string; message: string }[] = [];
    if (!isCpu) {
      if (ctx !== null) {
        const result = checkSquad(view.firstTeam.map(toSquadPlayer), view.trainee.map(toSquadPlayer), ctx);
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
      wageCap,
      overspend: wageCap === null ? 0 : Math.max(0, round2(wageNow - wageCap)),
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
  const { audits } = await computeAudit(env, season);
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
  const { views, audits } = await computeAudit(env, season);
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
            wageCap: audit.wageCap,
            overspend: audit.overspend,
            isCpu: audit.isCpu,
          }),
        ),
    );
  }
  return { statements, audits };
}
