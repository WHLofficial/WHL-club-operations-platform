// TC-C-005 · fit 全量快照对拍（docs/test-plans/v6.56.0-attr-head-relayout.md）：
// web/src/lib/fit/fit-dual-run.fixture.json 是 tour 仓引擎（tactics-v5.10-v5.11@244d49d…，
// 见 _meta.tourRef）对本仓 web/src/lib/fit/fitScore.ts 的逐字移植源件、对固定夹具算出的
// fitProfileAll 全 49 槽输出快照；本文件用本仓引擎对同一夹具**现算**并逐槽逐字段对拍——
// 本仓任一权重/加分/百分位/档位口径改动即红，第一处 diff 点名夹具、槽位与字段。
//
// 为什么是快照不是活体双跑（v6.56.0 首版教训）：活体双跑要求 vitest 运行时跨仓解析
// tour 仓源码（写死本机绝对路径），路径不存在 ⇒ 整组 describe.skip 恒跳过，parity 从无
// 执行证据。快照把 tour 侧输出冻结进仓，闸门在任何机器常开；tour 引擎升级时
// 重跑 `node scripts/fit-dual-run-gen.mjs` 再对拍（tour 仓在场时；见脚本头注释）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitPosGroup, fitProfileAll, fitTile, type FitSlotScore } from './fitScore.ts';
import { ROLE_FIT } from './roleFit.ts';
import type { PlayerMeta } from './types.ts';

interface SlotView {
  base: number;
  badge: number;
  score: number;
  rankRaw: number;
  rankShown: number;
  attr: [string, number, number][];
  badgeHits: number[];
  posHit: boolean;
  roleHit: 0 | 1 | 2;
  tile: number | null;
}
interface FixtureSnapshot {
  name: string;
  meta: PlayerMeta;
}
interface ExpectedFixture {
  group: 'GK' | 'OUT';
  profile: Record<string, SlotView | null> | null;
}
interface FixtureFile {
  _meta: { generatedAt: string; command: string; tourRef: string };
  fixtures: FixtureSnapshot[];
  expected: Record<string, ExpectedFixture>;
}

const snapshot = JSON.parse(
  readFileSync(new URL('./fit-dual-run.fixture.json', import.meta.url), 'utf8'),
) as FixtureFile;

/** 本仓引擎对一名球员的完整视图：位置群 + 逐槽全字段 + fitTile（键序与生成器一致 = 槽位排序） */
function localView(meta: PlayerMeta): ExpectedFixture {
  const profile = fitProfileAll(meta);
  const group = fitPosGroup(meta);
  if (profile === null) return { group, profile: null };
  const slots: Record<string, SlotView | null> = {};
  for (const slot of [...profile.keys()].sort()) {
    const score: FitSlotScore | null = profile.get(slot) ?? null;
    slots[slot] =
      score === null
        ? null
        : {
            base: score.base,
            badge: score.badge,
            score: score.score,
            rankRaw: score.rankRaw,
            rankShown: score.rankShown,
            attr: score.breakdown.attr.map(([k, v, c]) => [k, v, c] as [string, number, number]),
            badgeHits: [...score.breakdown.badgeHits],
            posHit: score.breakdown.posHit,
            roleHit: score.breakdown.roleHit,
            tile: fitTile(profile, slot, group),
          };
  }
  return { group, profile: slots };
}

describe('TC-C-005 fit 全量快照对拍（快照 = tour 仓引擎产出，常开不 skip）', () => {
  it('快照元信息与夹具集齐备（GK/ST/30 键全铺 + 两个空数据边界）', () => {
    expect(snapshot._meta.command).toContain('fit-dual-run-gen');
    expect(snapshot._meta.tourRef).toMatch(/^tactics-v5\.10-v5\.11@[0-9a-f]{40}$/);
    expect(snapshot._meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.fixtures.map((f) => f.name)).toEqual([
      'GK_META',
      'ST_META',
      'OUT_FULL',
      'EMPTY',
      'OUTSIDE_ONLY',
    ]);
    // 快照槽位键集 = 本仓 ROLE_FIT 键集（49 槽）：两侧冻结表也在同一闸内
    const slots = Object.keys(ROLE_FIT).sort();
    expect(slots).toHaveLength(49);
    for (const f of snapshot.fixtures) {
      const expected = snapshot.expected[f.name];
      if (expected.profile === null) continue;
      expect(Object.keys(expected.profile).sort(), `夹具 ${f.name} 快照键集`).toEqual(slots);
    }
  });

  it('空数据边界：无引擎可读键 → 整表 null（缺数据 ≠ 0 分，两侧同口径）', () => {
    for (const name of ['EMPTY', 'OUTSIDE_ONLY']) {
      const meta = snapshot.fixtures.find((f) => f.name === name)!.meta;
      expect(fitProfileAll(meta), `夹具 ${name} 本仓现算`).toBeNull();
      expect(snapshot.expected[name].profile).toBeNull();
    }
  });

  for (const fixture of snapshot.fixtures) {
    if (snapshot.expected[fixture.name].profile === null) continue; // 空数据边界在上一条锁
    it(`夹具 ${fixture.name}：本仓现算与 tour 快照全 49 槽逐字段一致`, () => {
      const ours = localView(fixture.meta);
      const theirs = snapshot.expected[fixture.name];
      expect(ours.group, `夹具 ${fixture.name} 位置群`).toBe(theirs.group);
      const slots = Object.keys(ROLE_FIT).sort();
      for (const slot of slots) {
        const mine = ours.profile![slot];
        const ref = theirs.profile![slot];
        if (mine === null || ref === null) {
          expect(mine, `夹具 ${fixture.name}#${slot} 整槽位形态（null ≠ 0 分）`).toEqual(ref);
          continue;
        }
        // 逐字段对拍：第一处漂移点名字段，不给出整槽大对象
        expect(mine.base, `${fixture.name}#${slot}.base`).toBe(ref.base);
        expect(mine.badge, `${fixture.name}#${slot}.badge`).toBe(ref.badge);
        expect(mine.score, `${fixture.name}#${slot}.score`).toBe(ref.score);
        expect(mine.rankRaw, `${fixture.name}#${slot}.rankRaw`).toBe(ref.rankRaw);
        expect(mine.rankShown, `${fixture.name}#${slot}.rankShown`).toBe(ref.rankShown);
        expect(mine.attr, `${fixture.name}#${slot}.attr`).toEqual(ref.attr);
        expect(mine.badgeHits, `${fixture.name}#${slot}.badgeHits`).toEqual(ref.badgeHits);
        expect(mine.posHit, `${fixture.name}#${slot}.posHit`).toBe(ref.posHit);
        expect(mine.roleHit, `${fixture.name}#${slot}.roleHit`).toBe(ref.roleHit);
        expect(mine.tile, `${fixture.name}#${slot}.tile（个人内契合档）`).toBe(ref.tile);
      }
    });
  }
});
