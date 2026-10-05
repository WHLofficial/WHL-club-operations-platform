// 徽章计数（v6.35.0 统一）：金在前、零值抑制、符号与文案同源。
// 收的是台账计数（badgesGold / badgesSilver），不是属性槽里的徽章清单 —— 清单渲染走 PlaystyleBadge。
// 三种密度只是场合差异，语义同一份：
//   icon  🥇×2 🥈×1 —— 卡片头（球员卡 / 升级方案行）：emoji 自带颜色，宽度最小
//   text  2金 1银    —— 表格单元格与对比页：数字在前，窄列不抢眼
//   chip  2金 1银    —— 球员库卡片：带底色块，与「自由身」chip 同族（金/银走 --badge-* token）
// 两枚全 0 时整个组件不渲染，由调用方决定出「—」还是「不加徽章」。
import { Fragment, type ReactNode } from 'react';

export type BadgeCountDensity = 'icon' | 'text' | 'chip';
export type BadgeKind = 'gold' | 'silver';

export interface BadgeCountItem {
  kind: BadgeKind;
  n: number;
}

/** 文字场合的金/银全称（升级提示等句子里用；符号场合走 badgeCountLabel 的 🥇/🥈） */
export const BADGE_KIND_LABEL: Record<BadgeKind, string> = { gold: '金徽章', silver: '银徽章' };

/** 金在前 + 零值抑制：计数顺序的唯一出处（组件与文字摘要都从这里取，别各写一遍） */
export function badgeCountItems(silver: number, gold: number): BadgeCountItem[] {
  const items: BadgeCountItem[] = [];
  if (gold > 0) items.push({ kind: 'gold', n: gold });
  if (silver > 0) items.push({ kind: 'silver', n: silver });
  return items;
}

export function badgeCountLabel(kind: BadgeKind, n: number, density: BadgeCountDensity): string {
  if (density === 'icon') return `${kind === 'gold' ? '🥇' : '🥈'}×${n}`;
  return `${n}${kind === 'gold' ? '金' : '银'}`;
}

function itemClass(kind: BadgeKind, density: BadgeCountDensity, extra?: string): string {
  const base =
    density === 'chip'
      ? `badge-chip badge-chip-${kind}`
      : density === 'text'
        ? `badge-count badge-count-text-${kind}`
        : 'badge-count badge-count-icon';
  return extra ? `${base} ${extra}` : base;
}

export function BadgeCounts({
  silver,
  gold,
  density = 'icon',
  className,
  sep,
}: {
  silver: number;
  gold: number;
  density?: BadgeCountDensity;
  /** 附到每枚计数上的类（对比页用 .cmp-badgecnt 定宽对齐两列） */
  className?: string;
  /** 两枚之间的分隔（默认空格文本；对比页传 <span className="cmp-dt">·</span>） */
  sep?: ReactNode;
}) {
  const items = badgeCountItems(silver, gold);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={it.kind}>
          {i > 0 && (sep ?? ' ')}
          {/* title 只在符号密度挂：icon 场合读不出「金/银」，text/chip 场合文字已经写明 */}
          <span className={itemClass(it.kind, density, className)} {...(density === 'icon' ? { title: BADGE_KIND_LABEL[it.kind] } : {})}>
            {badgeCountLabel(it.kind, it.n, density)}
          </span>
        </Fragment>
      ))}
    </>
  );
}
