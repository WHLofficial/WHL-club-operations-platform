// PlayStyle 发放口径（增量 30）：可发放基础 ID 白名单与前端参考表逐项一致、段界/落槽/去重规则。
// 白名单是「库里没有的 ID 发不出去」的唯一闸门（段界 1-99 ∪ 101-199 拦不住它），所以拿参考表守住。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PS_GOLD_BASE,
  PS_GOLD_MAX,
  PS_GRANTABLE_BASE_IDS,
  PS_SILVER_SLOT_COUNT,
  PS_SLOT_COUNT,
  PS_SLOT_KEYS,
  basePlaystyleId,
  isGrantablePlaystyleId,
  isPlaystyleId,
  mergePlaystyleSlots,
  nextFreePlaystyleSlot,
  planPlaystylePicks,
  playstyleIdOf,
  playstyleKindOf,
  playstyleSlotRange,
  playstyleSlotsOf,
  type PlaystyleSlot,
} from '../src/core/fc26.ts';

interface RefRow {
  id: number;
  en: string;
  chs: string;
  type: string;
}

const refRows = JSON.parse(
  readFileSync(fileURLToPath(new URL('../web/assets/ref/playstyle.json', import.meta.url).href), 'utf8'),
) as RefRow[];
const refSilver = refRows.filter((r) => r.id >= 1 && r.id <= 99).map((r) => r.id);
const refGold = refRows.filter((r) => r.id >= 101 && r.id <= 199).map((r) => r.id);

describe('PlayStyle 白名单与参考表一致', () => {
  it('36 项基础 ID = 参考表银段逐项；金段严格 = 银 + 100', () => {
    expect(refSilver).toEqual([...PS_GRANTABLE_BASE_IDS]);
    expect(PS_GRANTABLE_BASE_IDS).toHaveLength(36);
    expect(refGold).toEqual(PS_GRANTABLE_BASE_IDS.map((id) => id + PS_GOLD_BASE));
    expect(refRows.filter((r) => r.id === 0).map((r) => r.chs)).toEqual(['-']); // 0 = 未设置，不在白名单
  });

  it('白名单同时管住两段：段界内但库里没有的 ID 一律不发', () => {
    for (const id of [9, 10, 17, 20, 27, 36, 46, 57, 99]) expect(isGrantablePlaystyleId(id)).toBe(false);
    for (const id of [109, 150, 199]) expect(isGrantablePlaystyleId(id)).toBe(false);
    expect(isPlaystyleId(9)).toBe(true); // 段界放行、白名单拦下 —— 两个口径不是一回事
    expect(isGrantablePlaystyleId(56)).toBe(true);
    expect(isGrantablePlaystyleId(156)).toBe(true);
    expect(isGrantablePlaystyleId(0)).toBe(false);
    expect(isGrantablePlaystyleId(100)).toBe(false); // 100 是空档
    expect(isGrantablePlaystyleId(1.5)).toBe(false);
  });
});

describe('PlayStyle 段界与 ID 换算', () => {
  it('银 1-12 / 金 13-15，槽数由常量派生', () => {
    expect(playstyleSlotRange('silver')).toEqual({ min: 1, max: PS_SILVER_SLOT_COUNT });
    expect(playstyleSlotRange('gold')).toEqual({ min: 13, max: PS_SLOT_COUNT });
    expect(PS_SLOT_KEYS).toHaveLength(PS_SLOT_COUNT);
    expect(PS_SLOT_KEYS[0]).toBe('PSID1');
    expect(PS_SLOT_KEYS[14]).toBe('PSID15');
    expect(PS_GOLD_MAX).toBe(199);
  });

  it('存库 ID ↔ 基础 ID：银原样、金 ±100；kind 由 ID 自己决定', () => {
    expect(basePlaystyleId(56)).toBe(56);
    expect(basePlaystyleId(156)).toBe(56);
    expect(playstyleIdOf(56, 'silver')).toBe(56);
    expect(playstyleIdOf(56, 'gold')).toBe(156);
    expect(playstyleKindOf(56)).toBe('silver');
    expect(playstyleKindOf(156)).toBe('gold');
    expect(playstyleKindOf(PS_GOLD_BASE + 1)).toBe('gold');
  });

  it('nextFreePlaystyleSlot 给段内最小空槽，段满给 null', () => {
    expect(nextFreePlaystyleSlot('silver', [])).toBe(1);
    expect(nextFreePlaystyleSlot('silver', [1, 2])).toBe(3);
    expect(nextFreePlaystyleSlot('silver', [1, 3])).toBe(2);
    expect(nextFreePlaystyleSlot('gold', [1, 2])).toBe(13);
    const fullSilver = Array.from({ length: PS_SILVER_SLOT_COUNT }, (_, i) => i + 1);
    expect(nextFreePlaystyleSlot('silver', fullSilver)).toBeNull();
    expect(nextFreePlaystyleSlot('gold', [13, 14, 15])).toBeNull();
  });
});

describe('playstyleSlotsOf：从 game_attrs 扫全 15 槽', () => {
  it('空槽 / 0 / 非数字都不产出条目；金徽按 ID 或金槽判', () => {
    expect(playstyleSlotsOf({})).toEqual([]);
    expect(playstyleSlotsOf({ PSID1: 0, PSID2: null, PSID3: 'abc', PSID4: -1 })).toEqual([]);
    expect(playstyleSlotsOf({ PSID1: 5 })).toEqual([{ slot: 1, psid: 5, gold: false }]);
    expect(playstyleSlotsOf({ PSID13: 105 })).toEqual([{ slot: 13, psid: 105, gold: true }]);
    // 槽号与 ID 段不一致时以任一边判金（脏数据也当金徽，免得渲染成银）
    expect(playstyleSlotsOf({ PSID13: 5 })).toEqual([{ slot: 13, psid: 5, gold: true }]);
    expect(playstyleSlotsOf({ PSID2: 102 })).toEqual([{ slot: 2, psid: 102, gold: true }]);
    // PSID8-12 曾因手抄键清单而漏读（增量 29），这里守住扫全 15 槽
    expect(playstyleSlotsOf({ PSID9: 4, PSID12: 7, PSID15: 3 }).map((s) => s.slot)).toEqual([9, 12, 15]);
  });
});

describe('mergePlaystyleSlots：FC 源槽 + 发放明细', () => {
  const fc: PlaystyleSlot[] = [
    { slot: 1, psid: 3, gold: false },
    { slot: 13, psid: 103, gold: true },
  ];

  it('明细补进空槽；同 (段, 基础 ID) 撞了以 FC 源为准', () => {
    const merged = mergePlaystyleSlots(fc, [
      { slot: 2, kind: 'silver', psid: 5 },
      { slot: 3, kind: 'silver', psid: 3 }, // 与 FC 槽 1 撞银 3 → 丢
      { slot: 14, kind: 'gold', psid: 3 }, // 与 FC 槽 13 撞金 3 → 丢
      { slot: 15, kind: 'gold', psid: 4 },
    ]);
    expect(merged).toEqual([
      { slot: 1, psid: 3, gold: false },
      { slot: 2, psid: 5, gold: false },
      { slot: 13, psid: 103, gold: true },
      { slot: 15, psid: 104, gold: true }, // 明细存基础 ID，出参还原成存库 ID
    ]);
  });

  it('按槽位排序；FC 源为空时就是明细本身', () => {
    expect(mergePlaystyleSlots([], [{ slot: 14, kind: 'gold', psid: 6 }, { slot: 1, kind: 'silver', psid: 1 }])).toEqual([
      { slot: 1, psid: 1, gold: false },
      { slot: 14, psid: 106, gold: true },
    ]);
  });
});

describe('planPlaystylePicks：校验与落槽', () => {
  const empty = { silverCount: 0, goldCount: 0, ownedPsids: [], usedSlots: [] };

  it('按段各自从最小空槽起落；银先金后', () => {
    const out = planPlaystylePicks([5, 106, 2], { ...empty, silverCount: 2, goldCount: 1, usedSlots: [1] });
    expect(out).toEqual({
      ok: true,
      slots: [
        { slot: 2, psid: 5, gold: false },
        { slot: 3, psid: 2, gold: false },
        { slot: 13, psid: 106, gold: true },
      ],
    });
  });

  it('picks 里的金徽由 ID 自己表态：数量对不上就报错', () => {
    expect(planPlaystylePicks([1, 2], { ...empty, silverCount: 1, goldCount: 0 })).toEqual({
      ok: false,
      message: '本次要发 1 个银 PlayStyle，收到 2 个',
    });
    expect(planPlaystylePicks([101], { ...empty, silverCount: 0, goldCount: 0 })).toEqual({
      ok: false,
      message: '本次要发 0 个金 PlayStyle，收到 1 个',
    });
    // 银段先判：给了银徽但方案不要银 → 报银的账（金段还没轮到）
    expect(planPlaystylePicks([1], { ...empty, silverCount: 0, goldCount: 1 })).toEqual({
      ok: false,
      message: '本次要发 0 个银 PlayStyle，收到 1 个',
    });
    // 银账对得上、金账对不上
    expect(planPlaystylePicks([1, 2], { ...empty, silverCount: 2, goldCount: 1 })).toEqual({
      ok: false,
      message: '本次要发 1 个金 PlayStyle，收到 0 个',
    });
  });

  it('不在清单 / 同一段重复 / 已拥有各自拦下', () => {
    expect(planPlaystylePicks([9], { ...empty, silverCount: 1, goldCount: 0 })).toEqual({
      ok: false,
      message: 'PlayStyle 9 不在可发放清单里',
    });
    expect(planPlaystylePicks([1, 1], { ...empty, silverCount: 2, goldCount: 0 })).toEqual({
      ok: false,
      message: '同一个 PlayStyle 不能在同一段里选两次',
    });
    expect(planPlaystylePicks([3], { ...empty, silverCount: 1, goldCount: 0, ownedPsids: [3] })).toEqual({
      ok: false,
      message: 'PlayStyle 3 已经在这名球员身上了',
    });
    // 银 3 已拥有，金 3 不算撞（两段各自记）
    expect(planPlaystylePicks([103], { ...empty, silverCount: 0, goldCount: 1, ownedPsids: [3] })).toEqual({
      ok: true,
      slots: [{ slot: 13, psid: 103, gold: true }],
    });
  });

  it('段满报槽位已满，且是整批失败（一条都不落）', () => {
    const fullSilver = Array.from({ length: PS_SILVER_SLOT_COUNT }, (_, i) => i + 1);
    expect(planPlaystylePicks([7], { ...empty, silverCount: 1, goldCount: 0, usedSlots: fullSilver })).toEqual({
      ok: false,
      message: '银槽已满（12 个）',
    });
    expect(planPlaystylePicks([107], { ...empty, silverCount: 0, goldCount: 1, usedSlots: [13, 14, 15] })).toEqual({
      ok: false,
      message: '金槽已满（3 个）',
    });
  });
});
