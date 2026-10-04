// v6.30.0 C 段：转会状态的四枚手绘 SVG 线稿图标 + 文案/图例/单元格。
// 风格照 components/TopBar.tsx 的既有图标：viewBox 0 0 24 24、16×16、fill=none、stroke=currentColor
// （单色随文字色）、线宽 2、圆线帽圆线角 —— 不引图标库。
// 四态的含义与优先级（非卖品 > 挂牌中 > 转会名单 > 已标价）在 lib/club-columns.tsx 的 transferStatusOf，
// 这里只管「长得像什么」与「读出来是什么」。
import type { ReactElement } from 'react';
import type { TransferStatusKey } from '../lib/club-columns.tsx';

// 四枚图标共用同一套线稿属性（手绘感来自圆线帽 + 只描边不填充）
const STROKE = {
  viewBox: '0 0 24 24',
  width: 16,
  height: 16,
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** 拍卖锤（挂牌中）：45° 锤头 + 锤柄 + 台面线 */
export function GavelIcon() {
  return (
    <svg {...STROKE}>
      <path d="M12.5 2.5l9 9-3.5 3.5-9-9z" />
      <path d="M13.5 10.5 7 17" />
      <path d="M4 21h9" />
    </svg>
  );
}

/** 清单（转会名单）：三行条目 + 行首小点 */
export function ListIcon() {
  return (
    <svg {...STROKE}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.5" cy="6.5" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="17.5" r="1" />
    </svg>
  );
}

/** 欧元符号（已标价）：开口向右的 C 加两道横杠 */
export function EuroIcon() {
  return (
    <svg {...STROKE}>
      <path d="M16.7 7.5A6.4 6.4 0 1 0 16.7 16.5" />
      <path d="M6.5 10h8M6.5 14h8" />
    </svg>
  );
}

/** 锁（非卖品）：锁体 + 锁梁 */
export function LockIcon() {
  return (
    <svg {...STROKE}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}

export type TransferStatusIcon = () => ReactElement;

// 状态 → 图标；数组顺序即图例顺序（拍卖锤 挂牌中 · 清单 转会名单 · 欧元 已标价 · 锁 非卖品）
export const TRANSFER_STATUS_ICON: Record<TransferStatusKey, TransferStatusIcon> = {
  listed: GavelIcon,
  transferListed: ListIcon,
  transferPriced: EuroIcon,
  notForSale: LockIcon,
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatusKey, string> = {
  listed: '挂牌中',
  transferListed: '转会名单',
  transferPriced: '已标价',
  notForSale: '非卖品',
};

/** 图例条目：线稿的人话名字（glyph）+ 它代表的状态（status） */
export const TRANSFER_STATUS_LEGEND: { status: TransferStatusKey; glyph: string }[] = [
  { status: 'listed', glyph: '拍卖锤' },
  { status: 'transferListed', glyph: '清单' },
  { status: 'transferPriced', glyph: '欧元' },
  { status: 'notForSale', glyph: '锁' },
];

/** 整张词表（表头 title 用）：拍卖锤 挂牌中 · 清单 转会名单 · 欧元 已标价 · 锁 非卖品 */
export const TRANSFER_STATUS_GLOSSARY = TRANSFER_STATUS_LEGEND.map(
  (l) => `${l.glyph} ${TRANSFER_STATUS_LABEL[l.status]}`,
).join(' · ');

/**
 * 转会状态单元格内容：只出图标不出文字 —— 全称走 title 与 aria-label 给鼠标与读屏，
 * 窄屏没有 hover，靠表格下方那一行图例解释（TransferStatusLegend）。
 */
export function TransferStatusCell({ status }: { status: TransferStatusKey | null }) {
  if (status === null) return <span className="transfer-status muted">—</span>;
  const Icon = TRANSFER_STATUS_ICON[status];
  const label = TRANSFER_STATUS_LABEL[status];
  return (
    <span className="transfer-status" title={label} aria-label={label}>
      <Icon />
    </span>
  );
}

/** 表格下方一行图例：图标 + 人话名字 + 状态词 */
export function TransferStatusLegend() {
  return (
    <p className="transfer-status-legend">
      {TRANSFER_STATUS_LEGEND.map((l) => {
        const Icon = TRANSFER_STATUS_ICON[l.status];
        return (
          <span key={l.status} className="transfer-legend-item">
            <Icon />
            <span>
              {l.glyph} {TRANSFER_STATUS_LABEL[l.status]}
            </span>
          </span>
        );
      })}
    </p>
  );
}
