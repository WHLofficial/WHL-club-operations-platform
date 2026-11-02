// 关窗核验与看板（v6.69.0 期三，设计稿 §3.4 / D5 / D6 / D10 / D11）：
//   1. 看板逐队全列（含 CPU），不通过置顶、按超帽降序；
//   2. 关窗批把名单存进 registrations、体检结果存进 squad_audits（CPU 也写、pass=1）；
//   3. 不通过的队发一条站内信（只给金额与规则名，不含球员姓名）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations, attachAuthChannel } from './d1.ts';
import { loadWindowOverview, squadAuditStatements } from '../src/worker/squad-audit.ts';
import { openWindow, closeWindow } from '../src/worker/window-machine.ts';
import { deriveClubTier } from '../src/worker/tier.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { TOUR_TEAM_SEED_SQL } from './tour-team-seed.ts';

function fixture(): { env: Env; sqlite: DatabaseSync; auth: DatabaseSync; tour: DatabaseSync } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const tour = new DatabaseSync(':memory:');
  tour.exec(TOUR_TEAM_SEED_SQL);
  tour.exec('CREATE TABLE entry (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL, team_id INTEGER NOT NULL, UNIQUE(tournament_id, team_id))');
  const env = {
    DB: createTestD1(sqlite),
    TOUR_DB: createTestD1(tour),
    KV: new Map<string, string>(),
  } as unknown as Env;
  const auth = attachAuthChannel(env);
  return { env, sqlite, auth, tour };
}

// 1 级赛事报名（90 → 甲队 / 91 → 空队），让 deriveClubTier 三跳命中 premier（帽 68）
function seedTier(fx: { sqlite: DatabaseSync; auth: DatabaseSync; tour: DatabaseSync }) {
  fx.sqlite.exec("INSERT INTO seasons (season, status) VALUES (1, 'running')");
  fx.sqlite.exec("INSERT INTO season_tournaments (season, tournament_id, competition_type) VALUES (1, 101, 'league_premier')");
  fx.auth.exec(
    "INSERT INTO team (tour_team_id, club_id, name, created_at) VALUES (90, 1, '甲队', '2026-01-01'), (91, 3, '空队', '2026-01-01'), (92, 2, '电脑队', '2026-01-01')",
  );
  fx.tour.exec('INSERT INTO entry (tournament_id, team_id) VALUES (101, 90), (101, 91), (101, 92)');
  // 绑定收件人：甲队 → 账号 2、空队 → 账号 3（queueClubNotification 在 AUTH_DB 存在时走 team_binding）
  fx.auth.exec(
    `INSERT INTO team_binding (account_id, team_id, bound_via, bound_at) VALUES
       (2, (SELECT id FROM team WHERE club_id = 1), 'club', '2026-01-01'),
       (3, (SELECT id FROM team WHERE club_id = 3), 'club', '2026-01-01')`,
  );
}

function seed(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO clubs (id, name, status, is_cpu) VALUES (1, '甲队', 'active', 0), (2, '电脑队', 'active', 1), (3, '空队', 'active', 0);
    INSERT INTO club_bindings (club_id, user_id) VALUES (1, 11), (3, 13);
    INSERT INTO players (id, uid, name, club_id, position, ca, pa, status) VALUES
      (11, 'p11', '甲一', 1, 'GK', 80, 90, 'normal'),
      (12, 'p12', '甲二', 1, 'ST', 80, 90, 'normal'),
      (21, 'p21', '电脑一', 2, 'ST', 70, 80, 'normal');
    INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, is_active) VALUES
      (11, 1, 40, 20, 'formal', 1),
      (12, 1, 40, 20, 'formal', 1),
      (21, 2, 10, 5, 'formal', 1);
  `);
}

describe('关窗核验与看板', () => {
  it('看板：不通过置顶、按超帽降序，CPU 也列且判通过', async () => {
    const fx = fixture();
    const { env, sqlite } = fx;
    seed(sqlite);
    seedTier(fx);
    expect(await deriveClubTier(env, 1, 1)).toBe('premier');
    const rows = await loadWindowOverview(env);
    expect(rows.map((r) => r.clubId)).toEqual([1, 3, 2]);
    const first = rows[0];
    expect(first.pass).toBe(false);
    expect(first.wageNow).toBe(80);
    expect(first.overspend).toBe(12); // 80 - 68
    expect(first.issues.some((i) => i.rule === 'wage_cap')).toBe(true);
    const cpu = rows.find((r) => r.clubId === 2)!;
    expect(cpu.isCpu).toBe(true);
    expect(cpu.pass).toBe(true);
    expect(cpu.issues).toEqual([]);
  });

  it('关窗批：写 registrations 存档 + squad_audits（CPU 也写），并给不通过的真人队发信', async () => {
    const fx = fixture();
    const { env, sqlite } = fx;
    seed(sqlite);
    seedTier(fx);
    await openWindow(env, 1, 1, 1);
    const res = await closeWindow(env, 1, false);
    expect(res.ok).toBe(true);

    const regs = sqlite.prepare('SELECT club_id, player_id, squad FROM registrations ORDER BY club_id, player_id').all() as {
      club_id: number;
      player_id: number;
      squad: string;
    }[];
    expect(regs).toEqual([
      { club_id: 1, player_id: 11, squad: 'first_team' },
      { club_id: 1, player_id: 12, squad: 'first_team' },
      { club_id: 2, player_id: 21, squad: 'first_team' },
    ]);

    const audits = sqlite
      .prepare('SELECT club_id, pass, issues_json FROM squad_audits WHERE season = 1 AND window_seq = 1 ORDER BY club_id')
      .all() as { club_id: number; pass: number; issues_json: string }[];
    expect(audits.map((a) => [a.club_id, a.pass])).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
    ]);
    expect(audits[1].issues_json).toBe('[]'); // CPU 免检

    const notes = sqlite
      .prepare(`SELECT club_id, template, payload FROM notifications WHERE template = 'squad_audit_failed' ORDER BY club_id`)
      .all() as { club_id: number; template: string; payload: string }[];
    expect(notes.map((n) => n.club_id)).toEqual([1, 3]);
    expect(notes[0].payload).toContain('工资帽');
    // 不点球员姓名（D10）
    expect(notes[0].payload).not.toContain('甲一');
  });

  it('squadAuditStatements 可单独取批（同一口径，不依赖关窗）', async () => {
    const fx = fixture();
    const { env, sqlite } = fx;
    seed(sqlite);
    seedTier(fx);
    const { statements, audits } = await squadAuditStatements(env, 1, 2);
    await env.DB.batch(statements);
    expect(audits.find((a) => a.clubId === 3)!.pass).toBe(false);
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM registrations').get() as { n: number };
    expect(row.n).toBe(3);
  });
});
