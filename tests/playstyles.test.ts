// PlayStyle 发放口径（v3.3.0 起；v6.63.0 收口为全量口径 + 跨段规则 + 可逆抑制 + 位置资格）：
// 白名单/段界与前端参考表逐项一致、落槽/判重/跨段规则、合并清单与全量计数（含抑制与回归）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PS_GK_BASE_IDS,
  PS_GOLD_BASE,
  PS_GOLD_MAX,
  PS_GRANTABLE_BASE_IDS,
  PS_SILVER_SLOT_COUNT,
  PS_SLOT_COUNT,
  PS_SLOT_KEYS,
  basePlaystyleId,
  isGrantablePlaystyleId,
  isGoalkeeperPosition,
  isPlaystyleId,
  nextFreePlaystyleSlot,
  playstyleAllowedForPosition,
  playstyleIdOf,
  playstyleKindOf,
  playstyleSlotRange,
  playstyleSlotsOf,
  type PlaystyleSlot,
} from '../src/core/fc26.ts';
import {
  fullPlaystyleCounts,
  mergedPlaystyleList,
  planPlaystylePicks,
  suppressedBaseIds,
  type GrantedPlaystyleRow,
} from '../src/core/playstyle-rules.ts';

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
    // PSID8-12 曾因手抄键清单而漏读（v3.2.1），这里守住扫全 15 槽
    expect(playstyleSlotsOf({ PSID9: 4, PSID12: 7, PSID15: 3 }).map((s) => s.slot)).toEqual([9, 12, 15]);
  });
});

// ---- 位置资格（v6.63.0 Q10：单向 —— 外场拿不到 GK 项，GK 可见全部）----

describe('位置资格：外场挡 GK 项，GK 可见全部', () => {
  it('GK 专属项 = ref 表 type="Goalkeeper" 的银段（51-56），与常量逐项对齐', () => {
    const refGk = refRows.filter((r) => r.type === 'Goalkeeper' && r.id >= 1 && r.id <= 99).map((r) => r.id);
    expect([...PS_GK_BASE_IDS]).toEqual(refGk);
    expect(PS_GK_BASE_IDS).toHaveLength(6);
  });

  it('外场（含 position 未知）拿不到 51-56；GK 全部 36 项放开', () => {
    for (const base of PS_GK_BASE_IDS) {
      expect(playstyleAllowedForPosition(base, 'ST')).toBe(false);
      expect(playstyleAllowedForPosition(base, 'CM')).toBe(false);
      expect(playstyleAllowedForPosition(base, null)).toBe(false); // 未知位置保守挡
      expect(playstyleAllowedForPosition(base, 'GK')).toBe(true);
    }
    for (const base of [1, 8, 26, 45]) {
      expect(playstyleAllowedForPosition(base, 'ST')).toBe(true);
      expect(playstyleAllowedForPosition(base, null)).toBe(true);
      expect(playstyleAllowedForPosition(base, 'GK')).toBe(true);
    }
    expect(isGoalkeeperPosition('GK')).toBe(true);
    expect(isGoalkeeperPosition('gk')).toBe(false); // 位置列是大写口径，不做大小写宽容
    expect(isGoalkeeperPosition(null)).toBe(false);
  });
});

// ---- 合并清单与全量计数（v6.63.0：可逆抑制 + 来源角标）----

const fc = (slot: number, psid: number, gold: boolean): PlaystyleSlot => ({ slot, psid, gold });
const gr = (slot: number, kind: 'silver' | 'gold', psid: number, source: GrantedPlaystyleRow['source'] = 'growth'): GrantedPlaystyleRow => ({
  slot,
  kind,
  psid,
  source,
});

describe('mergedPlaystyleList：合并清单（抑制 + 来源）', () => {
  it('发放金同基础的 FC 银槽被抑制（不产出）；来源角标随行', () => {
    // 557 的终态：FC 银 #1/#31 + 发放金 1/31 → 只剩两枚金（FC 源）
    const merged = mergedPlaystyleList(
      [fc(1, 1, false), fc(2, 31, false), fc(3, 105, false)],
      [gr(13, 'gold', 1), gr(14, 'gold', 31)],
    );
    expect(merged).toEqual([
      { slot: 3, psid: 105, gold: false, source: 'fc' },
      { slot: 13, psid: 101, gold: true, source: 'growth' },
      { slot: 14, psid: 131, gold: true, source: 'growth' },
    ]);
  });

  it('金行消失 → FC 银自动回归（可逆抑制的另一半）', () => {
    const fcSlots = [fc(1, 1, false)];
    expect(mergedPlaystyleList(fcSlots, [gr(13, 'gold', 1)])).toEqual([
      { slot: 13, psid: 101, gold: true, source: 'growth' },
    ]);
    expect(mergedPlaystyleList(fcSlots, [])).toEqual([{ slot: 1, psid: 1, gold: false, source: 'fc' }]);
  });

  it('发放银不抑制 FC 银（只抑制银的是同基础发放金）；被抑制只看发放金', () => {
    const merged = mergedPlaystyleList([fc(1, 5, false)], [gr(2, 'silver', 7, 'china')]);
    expect(merged).toEqual([
      { slot: 1, psid: 5, gold: false, source: 'fc' },
      { slot: 2, psid: 7, gold: false, source: 'china' },
    ]);
    expect(suppressedBaseIds([gr(2, 'silver', 5)])).toEqual(new Set());
    expect(suppressedBaseIds([gr(13, 'gold', 5), gr(14, 'gold', 6)])).toEqual(new Set([5, 6]));
  });

  it('同 (段, 基础 ID) 撞车以 FC 源为准（折算残余防御）', () => {
    // 银段撞车与金段撞车分开构造：同基础发放金在场时 FC 银走抑制（另一个 describe 已测），不混
    expect(mergedPlaystyleList([fc(1, 3, false)], [gr(2, 'silver', 3)])).toEqual([
      { slot: 1, psid: 3, gold: false, source: 'fc' },
    ]);
    expect(mergedPlaystyleList([fc(13, 103, true)], [gr(14, 'gold', 3)])).toEqual([
      { slot: 13, psid: 103, gold: true, source: 'fc' },
    ]);
  });

  it('按槽位排序；FC 为空时就是明细本身', () => {
    expect(mergedPlaystyleList([], [gr(14, 'gold', 6, 'shop'), gr(1, 'silver', 1, 'external')])).toEqual([
      { slot: 1, psid: 1, gold: false, source: 'external' },
      { slot: 14, psid: 106, gold: true, source: 'shop' },
    ]);
  });
});

describe('fullPlaystyleCounts：全量计数（台账口径）', () => {
  it('空明细 = FC 槽数；发放各行照加', () => {
    const fcSlots = [fc(1, 3, false), fc(2, 5, false), fc(13, 103, true)];
    expect(fullPlaystyleCounts(fcSlots, [])).toEqual({ silver: 2, gold: 1 });
    expect(
      fullPlaystyleCounts(fcSlots, [gr(3, 'silver', 7, 'china'), gr(14, 'gold', 7, 'shop')]),
    ).toEqual({ silver: 3, gold: 2 });
  });

  it('发放金顶掉 FC 银：银减 1、金加 1；金行消失后回归（557 场景）', () => {
    const fcSlots = [fc(1, 1, false), fc(2, 31, false)];
    expect(fullPlaystyleCounts(fcSlots, [gr(13, 'gold', 1), gr(14, 'gold', 31)])).toEqual({ silver: 0, gold: 2 });
    expect(fullPlaystyleCounts(fcSlots, [gr(13, 'gold', 1)])).toEqual({ silver: 1, gold: 1 });
    expect(fullPlaystyleCounts(fcSlots, [])).toEqual({ silver: 2, gold: 0 });
  });

  it('247 清洗后的终态：只剩金 24（发放银行已删，FC 无槽）', () => {
    expect(fullPlaystyleCounts([], [gr(13, 'gold', 24)])).toEqual({ silver: 0, gold: 1 });
  });

  it('同段撞车不双计（FC 为准）；被抑制银不进任何一段', () => {
    expect(fullPlaystyleCounts([fc(1, 3, false)], [gr(2, 'silver', 3)])).toEqual({ silver: 1, gold: 0 });
    expect(fullPlaystyleCounts([fc(13, 103, true)], [gr(14, 'gold', 3)])).toEqual({ silver: 0, gold: 1 });
  });
});

// ---- 发放规则（v6.63.0：跨段判重 + 语境分岔 + 位置资格）----

describe('planPlaystylePicks：校验与落槽', () => {
  const empty = {
    silverCount: 0,
    goldCount: 0,
    ownedPsids: [] as number[],
    usedSlots: [] as number[],
    context: 'growth' as const,
    position: 'ST' as string | null,
    grantedRows: [] as GrantedPlaystyleRow[],
  };

  it('按段各自从最小空槽起落；银先金后', () => {
    const out = planPlaystylePicks([5, 106, 2], { ...empty, silverCount: 2, goldCount: 1, usedSlots: [1] });
    expect(out).toEqual({
      ok: true,
      superseded: [],
      slots: [
        { slot: 2, psid: 5, gold: false },
        { slot: 3, psid: 2, gold: false },
        { slot: 13, psid: 106, gold: true },
      ],
    });
  });

  it('picks 里的金徽由 ID 自己表态：数量对不上就报错', () => {
    expect(planPlaystylePicks([1, 2], { ...empty, silverCount: 1, goldCount: 0 })).toMatchObject({ ok: false, code: 'count_mismatch' });
    expect(planPlaystylePicks([101], { ...empty, silverCount: 0, goldCount: 0 })).toMatchObject({ ok: false, code: 'count_mismatch' });
    // 银段先判：给了银徽但方案不要银 → 报银的账（金段还没轮到）
    expect(planPlaystylePicks([1], { ...empty, silverCount: 0, goldCount: 1 })).toMatchObject({ ok: false, code: 'count_mismatch' });
    expect(planPlaystylePicks([1, 2], { ...empty, silverCount: 2, goldCount: 1 })).toMatchObject({ ok: false, code: 'count_mismatch' });
  });

  it('不在清单 / 同一段重复 / 已拥有各自拦下', () => {
    expect(planPlaystylePicks([9], { ...empty, silverCount: 1, goldCount: 0 })).toMatchObject({ ok: false, code: 'not_grantable' });
    expect(planPlaystylePicks([1, 1], { ...empty, silverCount: 2, goldCount: 0 })).toMatchObject({ ok: false, code: 'same_kind_twice' });
    expect(planPlaystylePicks([3], { ...empty, silverCount: 1, goldCount: 0, ownedPsids: [3] })).toMatchObject({
      ok: false,
      code: 'already_owned',
    });
    // 同段金 103 已拥有（FC 金槽存库形 103），再选 103 挡
    expect(planPlaystylePicks([103], { ...empty, silverCount: 0, goldCount: 1, ownedPsids: [103] })).toMatchObject({
      ok: false,
      code: 'already_owned',
    });
  });

  it('段满报槽位已满，且是整批失败（一条都不落）', () => {
    const fullSilver = Array.from({ length: PS_SILVER_SLOT_COUNT }, (_, i) => i + 1);
    expect(planPlaystylePicks([7], { ...empty, silverCount: 1, goldCount: 0, usedSlots: fullSilver })).toMatchObject({
      ok: false,
      code: 'slot_full',
      message: '银槽已满（12 个）',
    });
    expect(planPlaystylePicks([107], { ...empty, silverCount: 0, goldCount: 1, usedSlots: [13, 14, 15] })).toMatchObject({
      ok: false,
      code: 'slot_full',
      message: '金槽已满（3 个）',
    });
  });
});

describe('planPlaystylePicks 跨段规则（v6.63.0）', () => {
  const empty = {
    silverCount: 0,
    goldCount: 0,
    ownedPsids: [] as number[],
    usedSlots: [] as number[],
    context: 'growth' as const,
    position: 'ST' as string | null,
    grantedRows: [] as GrantedPlaystyleRow[],
  };

  it('择银遇金挡（FC 槽金）：三语境一致', () => {
    for (const context of ['growth', 'china', 'shop'] as const) {
      const out = planPlaystylePicks([24], { ...empty, context, silverCount: 1, ownedPsids: [124] });
      expect(out).toMatchObject({ ok: false, code: 'silver_blocked_by_gold' });
    }
    // 发放金同样挡（247 的根因：银 24 与金 124 互不查）
    for (const context of ['growth', 'china', 'shop'] as const) {
      const out = planPlaystylePicks([24], {
        ...empty,
        context,
        silverCount: 1,
        grantedRows: [gr(13, 'gold', 24)],
      });
      expect(out).toMatchObject({ ok: false, code: 'silver_blocked_by_gold' });
    }
  });

  it('成长择金遇银：发放银 → 自动替换（superseded 记删行清单），FC 银 → 派生抑制（无动作）', () => {
    // 247 的修复路径：金 124 替换发放银 24
    const out = planPlaystylePicks([124], {
      ...empty,
      context: 'growth',
      goldCount: 1,
      ownedPsids: [24],
      usedSlots: [5],
      grantedRows: [gr(5, 'silver', 24)],
    });
    expect(out).toEqual({
      ok: true,
      superseded: [{ kind: 'silver', psid: 24 }],
      slots: [{ slot: 13, psid: 124, gold: true }],
    });
    // 557 的规则层：FC 银 1/31 在 game_attrs 里，金 101/131 直接发 —— 银不记删行
    const out2 = planPlaystylePicks([101, 131], {
      ...empty,
      context: 'growth',
      goldCount: 2,
      ownedPsids: [1, 31],
      usedSlots: [1, 2],
      grantedRows: [],
    });
    expect(out2).toMatchObject({ ok: true, superseded: [] });
  });

  it('商店择金遇银挡（FC 银与发放银同挡），文案引导走「银升金」', () => {
    for (const grantedRows of [[], [gr(5, 'silver', 24)]]) {
      const out = planPlaystylePicks([124], {
        ...empty,
        context: 'shop',
        goldCount: 1,
        ownedPsids: [24],
        grantedRows,
      });
      expect(out).toMatchObject({ ok: false, code: 'gold_blocked_by_silver', message: '他已经有银版（24），金版请走「银升金」' });
    }
    // 中国计划语境同样不替换（现仅发银，防御式口径与商店一致）
    const out = planPlaystylePicks([124], {
      ...empty,
      context: 'china',
      goldCount: 1,
      ownedPsids: [24],
      grantedRows: [gr(5, 'silver', 24)],
    });
    expect(out).toMatchObject({ ok: false, code: 'gold_blocked_by_silver' });
  });

  it('同一次 picks 里银、金同基础互斥（两个方向都挡）', () => {
    expect(planPlaystylePicks([24, 124], { ...empty, silverCount: 1, goldCount: 1 })).toMatchObject({
      ok: false,
      code: 'cross_kind_batch',
    });
    expect(planPlaystylePicks([124, 24], { ...empty, silverCount: 1, goldCount: 1 })).toMatchObject({
      ok: false,
      code: 'cross_kind_batch',
    });
  });

  it('被抑制的 FC 银槽仍算占用：替换后银槽不因此多出空位', () => {
    // FC 银占满 12 槽（槽 12 存的是 ID 24），金 124 走成长替换：FC 银派生抑制、金落金槽
    const fullSilver = Array.from({ length: PS_SILVER_SLOT_COUNT }, (_, i) => i + 1);
    const fcIds = [31, 32, 33, 34, 35, 1, 2, 3, 4, 5, 24];
    const out = planPlaystylePicks([124], {
      ...empty,
      context: 'growth',
      goldCount: 1,
      ownedPsids: fcIds,
      usedSlots: fullSilver,
      grantedRows: [],
    });
    expect(out).toMatchObject({ ok: true, superseded: [] });
    // 替换后（无任何发放银行）再发一枚银：FC 银的 12 个物理槽仍全占（抑制不清 game_attrs）→ 槽满
    const after = planPlaystylePicks([7], {
      ...empty,
      context: 'growth',
      silverCount: 1,
      ownedPsids: fcIds.filter((id) => id !== 24),
      usedSlots: fullSilver,
      grantedRows: [],
    });
    expect(after).toMatchObject({ ok: false, code: 'slot_full', message: '银槽已满（12 个）' });
  });

  it('位置资格：外场拿不到 GK 项（银金两段同挡），GK 全放开', () => {
    expect(planPlaystylePicks([51], { ...empty, silverCount: 1, position: 'ST' })).toMatchObject({
      ok: false,
      code: 'position_denied',
    });
    expect(planPlaystylePicks([151], { ...empty, goldCount: 1, position: null })).toMatchObject({
      ok: false,
      code: 'position_denied',
    });
    const gkOut = planPlaystylePicks([51], { ...empty, silverCount: 1, position: 'GK' });
    expect(gkOut).toMatchObject({ ok: true, slots: [{ slot: 1, psid: 51, gold: false }] });
  });
});
