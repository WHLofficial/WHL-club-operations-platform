// PlayStyle 发放与合并口径（v6.63.0 自 fc26.ts 迁入并收口）：
//   · 发放明细行形状与来源值域（'external' 是 shop-ops 历史写法，一并进值域）
//   · 可逆抑制（Q8/Q9 定案）：同基础发放金存在时，FC 银槽在清单/计数/筛选/meta 四口径消失，
//     金行消失即自动回归 —— 抑制是读侧派生，game_attrs 原貌永保留、零写面
//   · 合并清单（带来源）：FC 槽 + 发放明细，按 (段, 基础 ID) 去重、FC 源为准、被抑制银不产出
//   · 全量计数（用户裁决：🥇×2 🥈×1 与上限都按「FC 自带 + 发放」总和）：= 合并清单段内数量
//   · 跨段发放规则 + 位置资格（Q10 单向：外场拿不到 GK 项，GK 可见全部）
//   · 全量计数的 SQL 同源表达式（backfill 与测试锁共用；运行时计数走 JS，排序/筛选走台账列）
// 发放校验 planPlaystylePicks 也在这里：原版只做同段判重（银 24 与金 124 互不查 —— 247/557 的根因），
// 现按语境分岔跨段规则并记替换清单。
import {
  PS_GOLD_BASE,
  basePlaystyleId,
  isGoldPlaystyleId,
  isGrantablePlaystyleId,
  nextFreePlaystyleSlot,
  playstyleAllowedForPosition,
  playstyleIdOf,
  playstyleKindOf,
  playstyleSlotRange,
  type PlaystyleKind,
  type PlaystyleSlot,
} from './fc26.ts';

// ---- 发放明细行（player_playstyles 投影，source 列值域）----

export type PlaystyleSource = 'growth' | 'china' | 'shop' | 'external' | 'manual';

export interface GrantedPlaystyleRow {
  slot: number;
  kind: PlaystyleKind;
  /** 基础 ID（1-99）：金徽的 +100 由 kind 表示 */
  psid: number;
  source: PlaystyleSource;
}

// ---- 可逆抑制与合并清单 ----

/** 被发放金抑制的基础 ID 集（只抑制 FC 银槽；金对金同段判重挡并存，无需抑制） */
export function suppressedBaseIds(granted: readonly GrantedPlaystyleRow[]): Set<number> {
  return new Set(granted.filter((g) => g.kind === 'gold').map((g) => g.psid));
}

export type MergedPlaystyleSource = 'fc' | PlaystyleSource;

export interface MergedPlaystyleItem {
  slot: number;
  /** 存库 ID（银 1-99 / 金 101-199） */
  psid: number;
  gold: boolean;
  source: MergedPlaystyleSource;
}

/**
 * 合并清单（v6.63.0 全口径）：FC 槽 + 发放明细。
 *   · 被发放金抑制的 FC 银槽不产出（Q11：筛选也不命中 —— 消费方都从这份清单出发）
 *   · 同 (段, 基础 ID) 撞车以 FC 源为准（大换版折算残余；正常流程发放判重挡了，防御式兜底）
 *   · 按 slot 升序
 */
export function mergedPlaystyleList(
  fc: readonly PlaystyleSlot[],
  granted: readonly GrantedPlaystyleRow[],
): MergedPlaystyleItem[] {
  const suppressed = suppressedBaseIds(granted);
  const out: MergedPlaystyleItem[] = [];
  const seen = new Set<string>();
  for (const s of fc) {
    const base = basePlaystyleId(s.psid);
    if (!s.gold && suppressed.has(base)) continue; // 被发放金顶掉的 FC 银：四口径消失
    const key = `${s.gold ? 'gold' : 'silver'}:${base}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slot: s.slot, psid: s.psid, gold: s.gold, source: 'fc' });
  }
  for (const g of granted) {
    const key = `${g.kind}:${g.psid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slot: g.slot, psid: playstyleIdOf(g.psid, g.kind), gold: g.kind === 'gold', source: g.source });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export interface PlaystyleFullCounts {
  silver: number;
  gold: number;
}

/** 全量计数 = 合并清单段内数量（FC 槽数减被抑制 + 发放明细行数）。台账 backfill/重算同此口径。 */
export function fullPlaystyleCounts(
  fc: readonly PlaystyleSlot[],
  granted: readonly GrantedPlaystyleRow[],
): PlaystyleFullCounts {
  let silver = 0;
  let gold = 0;
  for (const item of mergedPlaystyleList(fc, granted)) {
    if (item.gold) gold += 1;
    else silver += 1;
  }
  return { silver, gold };
}

// ---- 跨段发放规则（Q8/Q9 定案）----

export type PlaystylePickContext = 'growth' | 'china' | 'shop';

/** 成长语境择金遇银时，同批要删行的发放银（FC 银不在此列 —— 交派生抑制，无存储动作） */
export interface SupersedeTarget {
  kind: 'silver';
  /** 基础 ID */
  psid: number;
}

export type PlaystylePickFailureCode =
  | 'not_grantable'
  | 'same_kind_twice'
  | 'cross_kind_batch'
  | 'already_owned'
  | 'silver_blocked_by_gold'
  | 'gold_blocked_by_silver'
  | 'position_denied'
  | 'count_mismatch'
  | 'slot_full';

export type PlaystylePickOutcome =
  | { ok: true; slots: PlaystyleSlot[]; superseded: SupersedeTarget[] }
  | { ok: false; code: PlaystylePickFailureCode; message: string };

export interface PlaystylePickPlan {
  /** 本次要发放的银 / 金数量（来自升级方案或中国计划） */
  silverCount: number;
  goldCount: number;
  /** 球员已拥有的 PlayStyle（存库形式）：FC 源槽 + 既有发放明细 */
  ownedPsids: readonly number[];
  /** 球员已占用的槽位号：FC 源槽 + 既有发放明细（被抑制的 FC 银槽仍算占用 —— 物理槽被 FC 数据占着） */
  usedSlots: readonly number[];
  /** 跨段规则语境：growth 自动替换银；china/shop 择金遇银一律挡 */
  context: PlaystylePickContext;
  /** 位置资格（Q10 单向）：非门将拿不到 GK 项（基础 ID 51-56） */
  position: string | null;
  /** 发放明细行：区分「发放银」（可删行）与 FC 银（派生抑制） */
  grantedRows: readonly GrantedPlaystyleRow[];
}

// picks 校验与落槽（纯函数，写库前先把话说清楚）：picks 用存库形式（银 1-99 / 金 101-199），
// kind 由 ID 自己决定，所以调用方不必额外声明哪几个是金的。
//
// 跨段规则（v6.63.0）：
//   · 择银遇金 → 三语境同挡（任何来源的金：FC 槽金或发放金）
//   · 择金遇银 → growth 自动「去银留金」：发放银记入 superseded（调用方同批删行）、
//     FC 银无动作（派生抑制接管，金行消失时自动回归）；china/shop 挡（shop 文案引导走「银升金」）
//   · 同一次 picks 里同一个基础 ID 的银、金版互斥（成长语境会出现「发银又删它」的荒谬组合，挡）
export function planPlaystylePicks(picks: readonly number[], plan: PlaystylePickPlan): PlaystylePickOutcome {
  const silver: number[] = [];
  const gold: number[] = [];
  const grantedSilverBases = new Set(plan.grantedRows.filter((g) => g.kind === 'silver').map((g) => g.psid));
  // 金的「已拥有」两处来源并集：ownedPsids（调用方合并 FC 槽 + 明细的存库形）与 grantedRows 的金行 ——
  // 就算调用方漏把明细并进 ownedPsids，跨段挡银也不出洞
  const ownedGoldBases = new Set([
    ...plan.ownedPsids.filter(isGoldPlaystyleId).map(basePlaystyleId),
    ...plan.grantedRows.filter((g) => g.kind === 'gold').map((g) => g.psid),
  ]);
  const ownedSilverBases = new Set(plan.ownedPsids.filter((p) => p > 0 && p <= PS_GOLD_BASE));
  const batchBases = new Set<number>();
  const superseded: SupersedeTarget[] = [];
  for (const psid of picks) {
    if (!isGrantablePlaystyleId(psid)) {
      return { ok: false, code: 'not_grantable', message: `PlayStyle ${psid} 不在可发放清单里` };
    }
    const base = basePlaystyleId(psid);
    if (!playstyleAllowedForPosition(base, plan.position)) {
      return {
        ok: false,
        code: 'position_denied',
        message: `PlayStyle ${base} 是门将专属（GK），不能发给非门将`,
      };
    }
    if (playstyleKindOf(psid) === 'gold') {
      if (ownedGoldBases.has(base)) {
        return { ok: false, code: 'already_owned', message: `PlayStyle ${psid} 已经在这名球员身上了` };
      }
      if (ownedSilverBases.has(base) || grantedSilverBases.has(base)) {
        if (plan.context !== 'growth') {
          return {
            ok: false,
            code: 'gold_blocked_by_silver',
            message: `他已经有银版（${base}），金版请走「银升金」`,
          };
        }
        if (grantedSilverBases.has(base)) superseded.push({ kind: 'silver', psid: base });
        // FC 银：不删槽、不清 game_attrs —— 派生抑制让它在四口径消失，金行消失时自动回归
      }
      if (gold.includes(psid)) {
        return { ok: false, code: 'same_kind_twice', message: '同一个 PlayStyle 不能在同一段里选两次' };
      }
      if (batchBases.has(base)) {
        return { ok: false, code: 'cross_kind_batch', message: '同一个 PlayStyle 的银、金版不能选在同一次里' };
      }
      gold.push(psid);
      batchBases.add(base);
    } else {
      if (ownedGoldBases.has(base)) {
        return {
          ok: false,
          code: 'silver_blocked_by_gold',
          message: `他已经有金版（${base}），不能再发银版`,
        };
      }
      if (ownedSilverBases.has(base) || grantedSilverBases.has(base)) {
        return { ok: false, code: 'already_owned', message: `PlayStyle ${psid} 已经在这名球员身上了` };
      }
      if (silver.includes(psid)) {
        return { ok: false, code: 'same_kind_twice', message: '同一个 PlayStyle 不能在同一段里选两次' };
      }
      if (batchBases.has(base)) {
        return { ok: false, code: 'cross_kind_batch', message: '同一个 PlayStyle 的银、金版不能选在同一次里' };
      }
      silver.push(psid);
      batchBases.add(base);
    }
  }
  if (silver.length !== plan.silverCount) {
    return {
      ok: false,
      code: 'count_mismatch',
      message: `本次要发 ${plan.silverCount} 个银 PlayStyle，收到 ${silver.length} 个`,
    };
  }
  if (gold.length !== plan.goldCount) {
    return {
      ok: false,
      code: 'count_mismatch',
      message: `本次要发 ${plan.goldCount} 个金 PlayStyle，收到 ${gold.length} 个`,
    };
  }
  const usedSlots = [...plan.usedSlots];
  const slots: PlaystyleSlot[] = [];
  const assign = (kind: PlaystyleKind, ids: readonly number[]): string | null => {
    for (const psid of ids) {
      const slot = nextFreePlaystyleSlot(kind, usedSlots);
      if (slot === null) {
        const total = playstyleSlotRange(kind).max - playstyleSlotRange(kind).min + 1;
        return `${kind === 'gold' ? '金' : '银'}槽已满（${total} 个）`;
      }
      usedSlots.push(slot);
      slots.push({ slot, psid, gold: kind === 'gold' });
    }
    return null;
  };
  const silverIssue = assign('silver', silver);
  if (silverIssue !== null) return { ok: false, code: 'slot_full', message: silverIssue };
  const goldIssue = assign('gold', gold);
  if (goldIssue !== null) return { ok: false, code: 'slot_full', message: goldIssue };
  return { ok: true, slots, superseded };
}

// ---- 全量计数的 SQL 同源表达式（backfill 与测试锁共用）----
// 台账 = 全量计数（派生值）：运行时写路径用 JS 算（fullPlaystyleCounts），排序/筛选直接读台账列；
// 这两条表达式只出现在迁移 backfill 里，与 JS 口径靠 tests/playstyles-rules.test.ts 的逐字锁同源。
// 银槽的 NOT EXISTS 只在槽值 > 0 时求值（SQLite AND 短路）—— 全表绝大多数球员无发放金行。
export function fullCountSql(kind: PlaystyleKind): string {
  const { min, max } = playstyleSlotRange(kind);
  const slotTerms: string[] = [];
  for (let slot = min; slot <= max; slot += 1) {
    const ex = `CAST(json_extract(players.game_attrs, '$.PSID${slot}') AS INTEGER)`;
    const cond =
      kind === 'gold'
        ? `${ex} > ${PS_GOLD_BASE}`
        : `${ex} > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = ${ex})`;
    slotTerms.push(`CASE WHEN ${cond} THEN 1 ELSE 0 END`);
  }
  return `(${slotTerms.join(' + ')} + (SELECT COUNT(*) FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = '${kind}'))`;
}
