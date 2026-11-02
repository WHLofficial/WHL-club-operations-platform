// 名单镜像（v6.67.0 期一，D1/D2/D3）：名单由合同推导，不再由教练提交。
//
// 锁三件事：
//   1. formal → 一线队、trainee → 训练营、无本队 active 合同 → 未签约区（不占人数、不计工资）；
//   2. 退役球员不进名单（与旧提交口径一致）；
//   3. 提交端点已退役 —— 任何人再把它加回来，这里先红。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/worker/env.ts';
import { createTestD1, applyMigrations } from './d1.ts';
import { loadSquadView, loadSquadViews, projectLoyaltyExpense } from '../src/worker/squad-view.ts';
import { resetConfigCache } from '../src/core/config.ts';
import { readFileSync } from 'node:fs';

function fixture(): { env: Env; sqlite: DatabaseSync } {
  resetConfigCache();
  const sqlite = new DatabaseSync(':memory:');
  applyMigrations(sqlite);
  const env = { DB: createTestD1(sqlite), KV: new Map<string, string>() } as unknown as Env;
  return { env, sqlite };
}

function seed(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO clubs (id, name) VALUES (1, '甲队'), (2, '乙队');
    INSERT INTO players (id, uid, name, club_id, status, position, age, ca, pa, growable, base_ca)
      VALUES (11, 'p11', '一线甲', 1, 'normal', 'ST', 25, 80, 90, 1, 78),
             (12, 'p12', '训练甲', 1, 'trainee', 'MF', 19, 60, 90, 1, 60),
             (13, 'p13', '未签甲', 1, 'normal', 'DF', 27, 70, 70, 0, 70),
             (14, 'p14', '退役甲', 1, 'retired', 'GK', 35, 60, 60, 0, 60),
             (21, 'p21', '一线乙', 2, 'normal', 'GK', 28, 75, 75, 0, 75);
    INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, is_active)
      VALUES (11, 1, 5, 20, 'formal', 1),
             (12, 1, 0.75, 5, 'trainee', 1),
             (21, 2, 4, 16, 'formal', 1);
  `);
}

describe('名单镜像（合同推导）', () => {
  it('formal → 一线队、trainee → 训练营、无合同 → 未签约、退役不进名单', async () => {
    const { env, sqlite } = fixture();
    seed(sqlite);
    const view = await loadSquadView(env.DB, 1);
    expect(view.firstTeam.map((r) => r.playerId)).toEqual([11]);
    expect(view.trainee.map((r) => r.playerId)).toEqual([12]);
    expect(view.unsigned.map((r) => r.playerId)).toEqual([13]);
    expect(view.firstTeam[0]).toMatchObject({ contractType: 'formal', wage: 5, releaseFee: 20, status: 'normal' });
    // 未签约不计工资
    expect(view.unsigned[0]).toMatchObject({ hasContract: false, wage: null, releaseFee: null });
  });

  it('多队一次取：按 clubId 分组，互不串队', async () => {
    const { env, sqlite } = fixture();
    seed(sqlite);
    const views = await loadSquadViews(env.DB, [1, 2, 3]);
    expect(views.get(1)!.firstTeam.map((r) => r.playerId)).toEqual([11]);
    expect(views.get(2)!.firstTeam.map((r) => r.playerId)).toEqual([21]);
    expect(views.get(3)).toEqual({ firstTeam: [], trainee: [], unsigned: [] });
  });

  it('没有本队 active 合同的人即使合同表里有他队记录，也算未签约', async () => {
    const { env, sqlite } = fixture();
    seed(sqlite);
    // 13 号在别队有合同 —— 与本队名单无关
    sqlite.exec("INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, is_active) VALUES (13, 2, 3, 9, 'formal', 1)");
    const view = await loadSquadView(env.DB, 1);
    expect(view.unsigned.map((r) => r.playerId)).toEqual([13]);
  });

  it('提交端点已退役：路由文件里不再有 POST /club/registrations', () => {
    const src = readFileSync('src/worker/routes/registration.ts', 'utf8');
    expect(src).not.toContain("app.post('/club/registrations'");
    expect(src).not.toContain('loadRegistrationCheckMode');
  });
});

describe('预计忠诚支出（规则 4.3.2 口径）', () => {
  it('按关窗后窗刻度取档：1.5 赛季 × 10%、0.5 赛季 × 5%，只算本队 active 合同', async () => {
    const { env, sqlite } = fixture();
    sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (1, '甲队'), (2, '乙队');
      INSERT INTO players (id, uid, name, club_id, status) VALUES (11, 'p11', '甲一', 1, 'normal'), (21, 'p21', '乙一', 2, 'normal');
      INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, service_ticks, is_active)
        VALUES (11, 1, 5, 40, 'formal', 2, 1),
               (21, 2, 4, 100, 'formal', 6, 1);
    `);
    // ticksAfterClose=4 → 1 个常规窗 = 0.5 赛季：service_ticks 2 → 1.0 赛季（5%）；
    // 40 × 5% = 2.00，乙队的合同不计入
    expect(await projectLoyaltyExpense(env.DB, 1, 4)).toEqual({ total: 2, count: 1 });
  });

  it('没有 active 合同 / 违约金为 0 / 档位 0% 时不计', async () => {
    const { env, sqlite } = fixture();
    sqlite.exec(`
      INSERT INTO clubs (id, name) VALUES (1, '甲队');
      INSERT INTO players (id, uid, name, club_id, status) VALUES (11, 'p11', '甲一', 1, 'normal');
      INSERT INTO contracts (player_id, club_id, wage, release_fee, contract_type, service_ticks, is_active)
        VALUES (11, 1, 5, 0, 'formal', 8, 1);
    `);
    expect(await projectLoyaltyExpense(env.DB, 1, 8)).toEqual({ total: 0, count: 0 });
  });
});
