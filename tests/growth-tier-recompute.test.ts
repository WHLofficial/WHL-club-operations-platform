// §10.3 档位重算引擎（v6.48.0）：只写差异、锁定跳过、审计同批、分片与截断。
// 引擎是「自动核定」的唯一写入口——预览与执行读同一套 SQL，写之前再读一次，
// 所以这里的重点是「不该写的绝不写」（锁定行、无差异行、被并发改过的行）。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createTestDb, sqlAll, sqlGet } from './d1.ts';
import { applyTierRecompute, clubsWithoutCountry, hookTierRecompute, recomputeGrowthTiers } from '../src/worker/growth-tier.ts';

interface Fixture {
  sqlite: DatabaseSync;
  db: D1Database;
}

/** 一名球员的最小可行描述：TeamID 与队壳一致 + 会籍与队壳国家一致 ⇒ 自动档 3 */
interface P {
  id: number;
  clubId: number | null;
  teamId?: number | null;
  nationId?: number | null;
  age?: number | null;
  chinaPlan?: 0 | 1;
  futureStar?: 0 | 1;
  tier?: number;
  locked?: 0 | 1;
  fcId?: number;
}

function seed(players: P[], clubs: { id: number; name: string; country: number | null }[] = [
  { id: 1, name: '英格兰队壳', country: 14 },
  { id: 2, name: '没设国家的队壳', country: null },
]): Fixture {
  const { sqlite, db } = createTestDb();
  sqlite.exec(
    `INSERT INTO clubs (id, name, country, status) VALUES ${clubs
      .map((c) => `(${c.id}, '${c.name}', ${c.country === null ? 'NULL' : c.country}, 'active')`)
      .join(', ')};`,
  );
  for (const p of players) {
    const attrs = JSON.stringify({ TeamID: p.teamId ?? null, naID: p.nationId ?? null });
    sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, fc_id, age, china_plan, is_future_star, growth_tier, growth_tier_locked, game_attrs)
       VALUES (${p.id}, 'fc${p.id}', '球员${p.id}', ${p.clubId === null ? 'NULL' : p.clubId}, ${p.fcId ?? p.id},
               ${p.age === null || p.age === undefined ? 'NULL' : p.age}, ${p.chinaPlan ?? 0}, ${p.futureStar ?? 0},
               ${p.tier ?? 1}, ${p.locked ?? 0}, '${attrs}');`,
    );
  }
  return { sqlite, db };
}

const tierOf = (sqlite: DatabaseSync, id: number) =>
  sqlGet<{ growth_tier: number; growth_tier_locked: number }>(sqlite, `SELECT growth_tier, growth_tier_locked FROM players WHERE id = ${id}`);

const audits = (sqlite: DatabaseSync) =>
  sqlAll<{ action: string; target_type: string; target_id: number | null; origin: string; actor: number | null; before: string | null; after: string | null }>(
    sqlite,
    `SELECT action, target_type, target_id, origin, actor, before, after FROM audit_log ORDER BY id`,
  );

describe('§10.3 重算引擎：预览（v6.48.0）', () => {
  it('预览不写库：计数与明细都对，applied=false / batches=0', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14 }, // 自动 3，当前 1 → 升
      { id: 2, clubId: 1, teamId: 10, nationId: 155, chinaPlan: 1, tier: 2 }, // 自动 2 = 当前 → 不变
      { id: 3, clubId: 2, teamId: 2, nationId: 14, tier: 5 }, // 自动 2（country 缺，c2 不命中）→ 降
    ]);
    const summary = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: false, actor: 9, origin: 'user' });
    expect(summary).toMatchObject({ scope: 'all', scanned: 3, locked: 0, up: 1, down: 1, unchanged: 1, applied: false, batches: 0, truncated: false });
    expect(summary.rows.map((r) => [r.playerId, r.currentTier, r.nextTier])).toEqual([
      [1, 1, 3],
      [3, 5, 2],
    ]);
    expect(summary.rows[0].conditions).toEqual({ c1: true, c2: true, c3: false, c4: false, c5: false });
    // 一行都没动，也没有审计
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(1);
    expect(tierOf(fx.sqlite, 3)?.growth_tier).toBe(5);
    expect(audits(fx.sqlite)).toEqual([]);
  });

  it('锁定行计入 locked、不进明细（人工核定值不被自动值盖掉）', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14, tier: 5, locked: 1 },
      { id: 2, clubId: 1, teamId: 1, nationId: 14 },
    ]);
    const summary = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: false, actor: null, origin: 'user' });
    expect(summary).toMatchObject({ scanned: 2, locked: 1, up: 1, down: 0, unchanged: 0 });
    expect(summary.rows.map((r) => r.playerId)).toEqual([2]);
  });

  it('scope 分三类：单批球员 / 某队 / 全量（范围外的人不动）', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14 },
      { id: 2, clubId: 1, teamId: 1, nationId: 14 },
      { id: 3, clubId: 2, teamId: 2, nationId: 14 },
    ]);
    const one = await recomputeGrowthTiers(fx.db, { kind: 'players', playerIds: [2] }, { apply: false, actor: null, origin: 'user' });
    expect(one.scope).toBe('players');
    expect(one.rows.map((r) => r.playerId)).toEqual([2]);
    const byClub = await recomputeGrowthTiers(fx.db, { kind: 'clubs', clubIds: [1] }, { apply: false, actor: null, origin: 'user' });
    expect(byClub.scope).toBe('clubs');
    expect(byClub.rows.map((r) => r.playerId)).toEqual([1, 2]);
    const byFc = await recomputeGrowthTiers(fx.db, { kind: 'fcIds', fcIds: [3] }, { apply: false, actor: null, origin: 'user' });
    expect(byFc.rows.map((r) => r.playerId)).toEqual([3]);
    // 空集合 = 空范围（不误伤全库）
    const none = await recomputeGrowthTiers(fx.db, { kind: 'players', playerIds: [] }, { apply: false, actor: null, origin: 'user' });
    expect(none).toMatchObject({ scanned: 0, up: 0, down: 0, rows: [] });
  });
});

describe('§10.3 重算引擎：执行（v6.48.0）', () => {
  it('写差异 + 每条审计 + 一条批次汇总；无差异的行不写审计', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14 }, // 1 → 3
      { id: 2, clubId: 1, teamId: 10, nationId: 155, chinaPlan: 1, tier: 2 }, // 不变
      { id: 3, clubId: 2, teamId: 2, nationId: 14, tier: 5 }, // 5 → 2
    ]);
    const summary = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: true, actor: 7, origin: 'user' });
    expect(summary).toMatchObject({ up: 1, down: 1, unchanged: 1, applied: true, batches: 1 });
    expect(tierOf(fx.sqlite, 1)?.growth_tier).toBe(3);
    expect(tierOf(fx.sqlite, 3)?.growth_tier).toBe(2);
    expect(tierOf(fx.sqlite, 2)?.growth_tier).toBe(2);

    const log = audits(fx.sqlite);
    const sets = log.filter((a) => a.action === 'growth_tier_set');
    expect(sets.map((a) => [a.target_id, a.target_type, a.actor, a.origin])).toEqual([
      [1, 'player', 7, 'user'],
      [3, 'player', 7, 'user'],
    ]);
    expect(JSON.parse(sets[0].before!)).toEqual({ tier: 1 });
    expect(JSON.parse(sets[0].after!)).toMatchObject({ tier: 3, auto: true });
    expect(JSON.parse(sets[0].after!).conditions).toEqual({ c1: true, c2: true, c3: false, c4: false, c5: false });

    const batch = log.filter((a) => a.action === 'growth_tier_recompute');
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ target_type: 'growth_tier', target_id: null, actor: 7, origin: 'user' });
    expect(JSON.parse(batch[0].after!)).toEqual({ scope: 'all', scopeIds: null, up: 1, down: 1, locked: 0, batches: 1 });
  });

  it('锁定行：既不改值也不留审计', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14, tier: 5, locked: 1 },
      { id: 2, clubId: 1, teamId: 1, nationId: 14 },
    ]);
    const summary = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: true, actor: 1, origin: 'user' });
    expect(summary).toMatchObject({ up: 1, locked: 1 });
    expect(tierOf(fx.sqlite, 1)).toEqual({ growth_tier: 5, growth_tier_locked: 1 });
    expect(audits(fx.sqlite).filter((a) => a.target_id === 1)).toEqual([]);
  });

  it('预览之后被人工改过（或锁上）的行：执行时以当下状态为准，不按旧快照盲写', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14 }, // 预览说 1 → 3
      { id: 2, clubId: 1, teamId: 1, nationId: 14 }, // 预览说 1 → 3
    ]);
    const preview = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: false, actor: 1, origin: 'user' });
    expect(preview.rows).toHaveLength(2);
    // 期间：1 号被管理组核定成 3 并锁定；2 号被改成别的值
    fx.sqlite.exec(`UPDATE players SET growth_tier = 3, growth_tier_locked = 1 WHERE id = 1`);
    fx.sqlite.exec(`UPDATE players SET growth_tier = 2 WHERE id = 2`);

    const applied = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: true, actor: 1, origin: 'user' });
    expect(applied).toMatchObject({ up: 1, locked: 1 });
    expect(tierOf(fx.sqlite, 1)).toEqual({ growth_tier: 3, growth_tier_locked: 1 });
    expect(tierOf(fx.sqlite, 2)?.growth_tier).toBe(3);
    // 2 号的审计记的是「当时读到的旧值 2 → 3」，不是预览时的 1 → 3
    const set2 = audits(fx.sqlite).find((a) => a.action === 'growth_tier_set' && a.target_id === 2)!;
    expect(JSON.parse(set2.before!)).toEqual({ tier: 2 });
  });

  it('机器通道 origin 透传、actor 留空（审计契约：机器一律 actor=null）', async () => {
    const fx = seed([{ id: 1, clubId: 1, teamId: 1, nationId: 14 }]);
    await hookTierRecompute(fx.db, { kind: 'players', playerIds: [1] }, { actor: null, origin: 'machine' });
    const set = audits(fx.sqlite)[0];
    expect(set).toMatchObject({ action: 'growth_tier_set', actor: null, origin: 'machine' });
  });

  it('hookTierRecompute：只回报升降计数（不写批次汇总审计）', async () => {
    const fx = seed([
      { id: 1, clubId: 1, teamId: 1, nationId: 14 },
      { id: 2, clubId: 2, teamId: 2, nationId: 14, tier: 4 },
    ]);
    const r = await hookTierRecompute(fx.db, { kind: 'all' }, { actor: 1, origin: 'user' });
    expect(r).toEqual({ up: 1, down: 1 });
    expect(audits(fx.sqlite).filter((a) => a.action === 'growth_tier_recompute')).toEqual([]);
  });
});

describe('§10.3 重算引擎：分片与截断（v6.48.0）', () => {
  it('超过 CHUNK(100) 的变更行按批写：每批 100 条，批次数如实回报', async () => {
    const players: P[] = [];
    for (let i = 1; i <= 130; i += 1) players.push({ id: i, clubId: 1, teamId: 1, nationId: 14 });
    const fx = seed(players);
    const summary = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: true, actor: 1, origin: 'user' });
    expect(summary).toMatchObject({ up: 130, batches: 2, truncated: false });
    expect(summary.rows).toHaveLength(130);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM players WHERE growth_tier = 3`)?.n).toBe(130);
  });

  it('明细超过 200 行截断（truncated=true，写入不受影响）', async () => {
    const players: P[] = [];
    for (let i = 1; i <= 205; i += 1) players.push({ id: i, clubId: 1, teamId: 1, nationId: 14 });
    const fx = seed(players);
    const summary = await recomputeGrowthTiers(fx.db, { kind: 'all' }, { apply: true, actor: 1, origin: 'user' });
    expect(summary).toMatchObject({ up: 205, truncated: true });
    expect(summary.rows).toHaveLength(200);
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM players WHERE growth_tier = 3`)?.n).toBe(205);
  });

  it('IN (...) 绑定参数按 90 分片：91 个球员 id → 两个分片都写到了', async () => {
    const players: P[] = [];
    for (let i = 1; i <= 91; i += 1) players.push({ id: i, clubId: 1, teamId: 1, nationId: 14 });
    const fx = seed(players);
    const ids = players.map((p) => p.id);
    const r = await applyTierRecompute(fx.db, { kind: 'players', playerIds: ids }, { actor: 1, origin: 'user' });
    expect(r).toMatchObject({ up: 91, batches: 2 });
    expect(sqlGet<{ n: number }>(fx.sqlite, `SELECT COUNT(*) AS n FROM players WHERE growth_tier = 3`)?.n).toBe(91);
    // 第 91 名（落在第二片）也写到了
    expect(tierOf(fx.sqlite, 91)?.growth_tier).toBe(3);
  });
});

describe('§10.3 未设国家的队（v6.48.0）', () => {
  it('只列 country IS NULL 的队，按队内球员数倒序（提示补录用）', async () => {
    const fx = seed(
      [
        { id: 1, clubId: 1, teamId: 1, nationId: 14 },
        { id: 2, clubId: 2, teamId: 2, nationId: 14 },
        { id: 3, clubId: 2, teamId: 2, nationId: 14 },
      ],
      [
        { id: 1, name: '英格兰队壳', country: 14 },
        { id: 2, name: '没设国家的队壳', country: null },
        { id: 3, name: '空队没设国家', country: null },
      ],
    );
    const rows = await clubsWithoutCountry(fx.db);
    expect(rows).toEqual([
      { id: 2, name: '没设国家的队壳', players: 2 },
      { id: 3, name: '空队没设国家', players: 0 },
    ]);
  });
});
