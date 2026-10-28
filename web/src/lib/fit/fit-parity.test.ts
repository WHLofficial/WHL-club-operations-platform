// TC-C-005 · fit 全量快照双跑（docs/test-plans/v6.56.0-attr-head-relayout.md）：
// 本仓 web/src/lib/fit/fitScore.ts 是 tour 仓 shared/fitScore.ts 的逐字移植件（见该文件头注释）。
// 本文件在「tour 仓源码在场」的机器上把两侧引擎对同一批 fixture 的输出逐字段比对，钉住移植漂移——
// 本仓任一权重/加分/百分位/档位口径改动即红。
//
// 约定：
// - tour 仓源码不在场（绝大多数机器）⇒ 整个 describe.skip：本仓测试不依赖他人仓库存在。
// - fixture 用固定种子的确定性伪随机生成（splitmix32，绝不用 Math.random）——快照漂移会假红。
// - 动态 import 用 node:url 的 pathToFileURL 造地址：vite-node 的 normalizeRequestId 会把 file://
//   转回文件路径再进 Vite 解析；tour 那侧 fitScore 的 ./roleFit 导入无 .ts 后缀，Node 直跑必
//   ERR_MODULE_NOT_FOUND（测试计划 TC-C-004 实证），只能经 Vite 的分辨率。
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fitPosGroup, fitProfileAll, fitTile, type FitSlotScore } from './fitScore.ts';
import { FC26_POS_BY_ID, FC26_ROLE_BY_ID, FIT_ATTR_KEYS, ROLE_FIT } from './roleFit.ts';
import type { PlayerMeta } from './types.ts';

/** tour 仓引擎源（本机检出路径；不在场 ⇒ 整个 describe.skip） */
const TOUR_FIT_SOURCE = 'C:/Users/bhdjb/whlProgram/WHL-tournament-management-system/shared/fitScore.ts';
const tourReady = existsSync(TOUR_FIT_SOURCE);
const tourDescribe = tourReady ? describe : describe.skip;
if (!tourReady) {
  // 让「为什么跳过」在测试输出里可见（describe.skip 的用例体不会执行，提示只能挂在这里）
  console.warn(`[TC-C-005] tour 仓 fit 引擎不在场（${TOUR_FIT_SOURCE}），fit 全量双跑整体跳过`);
}

/** 本仓引擎模块类型（tour 侧结构相同；动态 import 返回 any，按此类型使用） */
type FitEngine = typeof import('./fitScore.ts');
/** 双跑用到的三个函数（viewOf 只依赖它们） */
type EngineFns = Pick<FitEngine, 'fitProfileAll' | 'fitPosGroup' | 'fitTile'>;

let tourEngine: Promise<FitEngine> | null = null;

function loadTourEngine(): Promise<FitEngine> {
  // 每次用例共享同一次 import（file:// 地址，见文件头注记）
  tourEngine ??= import(pathToFileURL(TOUR_FIT_SOURCE).href) as Promise<FitEngine>;
  return tourEngine;
}

// ---- 确定性 fixture：6 类 × 10 名 + 3 个空数据边界（≥50 名）----

/** splitmix32：同 seed 在任何机器产出同一序列（Math.random 会让「移植一致」的断言假红） */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

const OUT_POS_IDS = Object.keys(FC26_POS_BY_ID)
  .map(Number)
  .filter((id) => {
    const code = FC26_POS_BY_ID[id];
    return code !== '-' && code !== 'GK';
  });
const GK_POS_IDS = Object.keys(FC26_POS_BY_ID)
  .map(Number)
  .filter((id) => FC26_POS_BY_ID[id] === 'GK');
const ALL_POS_IDS = [...OUT_POS_IDS, ...GK_POS_IDS];
const ALL_ROLE_IDS = Object.keys(FC26_ROLE_BY_ID).map(Number);
const ROLE_SLOTS = Object.keys(ROLE_FIT);

type FixtureKind = 'gk' | 'out' | 'sparse' | 'nopos' | 'gold' | 'capamix';
const KINDS: readonly FixtureKind[] = ['gk', 'out', 'sparse', 'nopos', 'gold', 'capamix'];

const randInt = (rnd: () => number, n: number): number => Math.floor(rnd() * n);
const pick = <T>(rnd: () => number, arr: readonly T[]): T => arr[randInt(rnd, arr.length)];

function shuffle<T>(rnd: () => number, arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(rnd, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildFixture(kind: FixtureKind, seed: number): PlayerMeta {
  const rnd = seeded(seed);
  const attrs: Record<string, number> = {};
  // 0..99：档位边界（0 与 99）也在场
  const val = (): number => randInt(rnd, 100);

  if (kind === 'sparse') {
    // 部分缺键：只给 6–12 个随机键（有些角色 6 键全缺 ⇒ 该槽位 null；已有键按权重归一）
    for (const k of shuffle(rnd, FIT_ATTR_KEYS).slice(0, 6 + randInt(rnd, 7))) attrs[k] = val();
  } else {
    for (const k of FIT_ATTR_KEYS) attrs[k] = val();
  }

  const playstyles: number[] = [];
  if (kind === 'gk') {
    // 纯 GK：PosID1=0（门将群判据），RoleID 随机落在 GK 族与场上族之间（熟悉档加分照算）
    attrs.PosID1 = pick(rnd, GK_POS_IDS);
    for (let i = 1; i <= 5; i += 1) if (rnd() < 0.5) attrs[`RoleID${i}`] = pick(rnd, ALL_ROLE_IDS);
  } else if (kind === 'out') {
    // 场上球员：主/副位置都在场上族
    attrs.PosID1 = pick(rnd, OUT_POS_IDS);
    attrs.PosID2 = pick(rnd, OUT_POS_IDS);
    for (let i = 1; i <= 5; i += 1) if (rnd() < 0.5) attrs[`RoleID${i}`] = pick(rnd, ALL_ROLE_IDS);
  } else if (kind === 'nopos') {
    // 无 PosID：位置群按场上兜底（fitPosGroup = OUT），只带 RoleID
    for (let i = 1; i <= 3; i += 1) if (rnd() < 0.6) attrs[`RoleID${i}`] = pick(rnd, ALL_ROLE_IDS);
  } else if (kind === 'gold') {
    // 多金徽：随机 8 个角色槽的徽章基 id 以金徽（+100）塞入 ⇒ 触发封顶 3 与 badgeHits 不截断
    attrs.PosID1 = pick(rnd, ALL_POS_IDS);
    for (let i = 1; i <= 5; i += 1) attrs[`RoleID${i}`] = pick(rnd, ALL_ROLE_IDS);
    for (let i = 0; i < 8; i += 1) {
      playstyles.push(pick(rnd, ROLE_FIT[pick(rnd, ROLE_SLOTS)].badges) + 100);
    }
  } else if (kind === 'capamix') {
    // CA/PA 混入键：引擎不读 CA/PA，输出不得因此变化（两侧同夹具双跑即锁）
    attrs.CA = val();
    attrs.PA = val();
    attrs.PosID1 = pick(rnd, OUT_POS_IDS);
    for (let i = 1; i <= 2; i += 1) if (rnd() < 0.5) attrs[`RoleID${i}`] = pick(rnd, ALL_ROLE_IDS);
  }
  if (kind === 'out' || kind === 'nopos' || kind === 'sparse') {
    // 少量银徽：命中 +0.5 分支（同槽多枚也只有一枚计入）
    for (let i = 0; i < 3; i += 1) playstyles.push(pick(rnd, ROLE_FIT[pick(rnd, ROLE_SLOTS)].badges));
  }
  return { attrs, playstyles: [...new Set(playstyles)] };
}

const CASES: PlayerMeta[] = [
  ...KINDS.flatMap((kind, ki) =>
    Array.from({ length: 10 }, (_, i) => buildFixture(kind, 0x5eed0000 + ki * 1000 + i)),
  ),
  // 空数据边界：三例都必须回 null（缺数据 ≠ 0 分）——两侧引擎同口径
  {},
  { attrs: { CA: 88, PA: 95, freekickaccuracy: 80, penalties: 70, RoleID1: 142, PosID1: 25 } },
  { playstyles: [101, 1] },
];

// ---- 逐字段归一：只留语义字段并固定顺序，JSON.stringify 后两侧必须逐字一致 ----

interface NormalizedSlot {
  base: number;
  badge: number;
  score: number;
  rankRaw: number;
  rankShown: number;
  attr: [string, number, number][];
  badgeHits: number[];
  posHit: boolean;
  roleHit: 0 | 1 | 2;
}

function normSlot(slot: FitSlotScore | null): NormalizedSlot | null {
  if (slot === null) return null;
  const { breakdown } = slot;
  return {
    base: slot.base,
    badge: slot.badge,
    score: slot.score,
    rankRaw: slot.rankRaw,
    rankShown: slot.rankShown,
    attr: breakdown.attr.map(([k, v, c]) => [k, v, c]),
    badgeHits: [...breakdown.badgeHits],
    posHit: breakdown.posHit,
    roleHit: breakdown.roleHit,
  };
}

/** 一侧引擎的完整视图：位置群 + 槽位键集（排序）+ 逐槽全字段 + 逐槽 fitTile 档位 */
function viewOf(engine: EngineFns, meta: PlayerMeta): string {
  const profile = engine.fitProfileAll(meta);
  const group = engine.fitPosGroup(meta);
  const slots = profile === null ? [] : [...profile.keys()].sort();
  return JSON.stringify({
    group,
    slots,
    profile: profile === null ? null : slots.map((slot) => [slot, normSlot(profile.get(slot) ?? null)]),
    tiles: slots.map((slot) => [slot, engine.fitTile(profile, slot, group)]),
  });
}

tourDescribe('TC-C-005 fit 全量快照双跑（tour 仓源码在场时生效，否则整组跳过）', () => {
  it('fixture 规模与覆盖：≥50 名，六类形态与空数据边界齐全', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    const hasGkPos = CASES.some((m) => {
      const a = m.attrs ?? {};
      return [1, 2, 3, 4].some((i) => FC26_POS_BY_ID[a[`PosID${i}`] as number] === 'GK');
    });
    const hasNoPos = CASES.some((m) => {
      const a = m.attrs ?? {};
      return !['PosID1', 'PosID2', 'PosID3', 'PosID4'].some(
        (k) => typeof a[k] === 'number' && Number.isInteger(a[k]),
      );
    });
    const hasSparse = CASES.some((m) => {
      const keys = Object.keys(m.attrs ?? {}).filter((k) => FIT_ATTR_KEYS.includes(k));
      return keys.length > 0 && keys.length < FIT_ATTR_KEYS.length;
    });
    const hasMultiGold = CASES.some((m) => (m.playstyles ?? []).filter((ps) => ps > 100).length >= 4);
    const hasCapaMix = CASES.some((m) => {
      const a = m.attrs ?? {};
      return typeof a.CA === 'number' && typeof a.PA === 'number';
    });
    const hasNullProfile = CASES.some((m) => fitProfileAll(m) === null);
    expect({ hasGkPos, hasNoPos, hasSparse, hasMultiGold, hasCapaMix, hasNullProfile }).toEqual({
      hasGkPos: true,
      hasNoPos: true,
      hasSparse: true,
      hasMultiGold: true,
      hasCapaMix: true,
      hasNullProfile: true,
    });
  });

  it('49 槽键集：两侧 fitProfileAll 键集与 ROLE_FIT 完全一致', async () => {
    const tour = await loadTourEngine();
    const slots = Object.keys(ROLE_FIT).sort();
    expect(slots).toHaveLength(49);
    for (const [i, meta] of CASES.entries()) {
      const ours = fitProfileAll(meta);
      if (ours === null) continue;
      expect([...ours.keys()].sort(), `fixture#${i} 本仓键集`).toEqual(slots);
      const theirs = tour.fitProfileAll(meta);
      expect(theirs === null ? null : [...theirs.keys()].sort(), `fixture#${i} tour 键集`).toEqual(slots);
    }
  });

  it('全 49 槽 × 全字段 + fitTile + fitPosGroup：逐 fixture 与本仓引擎完全一致', async () => {
    const tour = await loadTourEngine();
    for (const [i, meta] of CASES.entries()) {
      const ours = viewOf({ fitProfileAll, fitPosGroup, fitTile }, meta);
      const theirs = viewOf(tour, meta);
      expect(theirs, `fixture#${i} 两侧引擎输出不一致（改本仓权重/加分/百分位/档位口径即红）`).toBe(ours);
    }
  });
});
