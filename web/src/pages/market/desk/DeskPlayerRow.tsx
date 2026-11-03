// 转会台统一球员行（v6.72.0 期 A）：桌面 56px 五列 grid，≤760 点开底部抽屉。
// 行体本身不是 button（避免与主按钮/链接嵌套）；键盘与 aria 由右侧 chevron 真按钮承担。
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { playerPath } from '../../../lib/player-link.ts';
import { useMediaQuery } from '../../../lib/use-media.ts';
import { useOverlayShell } from '../../../lib/use-overlay-shell.ts';
import type { RowAction } from './desk-rows.ts';
import type { Badge } from './status.ts';

const NARROW_QUERY = '(max-width: 760px)';

export default function DeskPlayerRow({
  player,
  meta,
  amount,
  amountBadges,
  badge,
  action,
  onAction,
  onActionHover,
  expanded,
  onToggle,
  children,
  dataOfferId,
  rowClassName,
  actionExpanded,
  keepMounted,
}: {
  player: { id: number; name: string; position: string | null; ca: number | null };
  meta: ReactNode;
  amount: string;
  /** 金额后的小徽标（如报价页的「砍价」），仍属于金额格 */
  amountBadges?: ReactNode;
  badge: Badge;
  action: RowAction;
  onAction: () => void;
  /** 报价页开桌前预取详情；出价 / 谈判不需要 */
  onActionHover?: () => void;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
  /** 报价深链测试/高亮用：当前单号 */
  dataOfferId?: number;
  rowClassName?: string;
  /** 报价页的「谈判桌」是展开动作，需要 aria-expanded；出价 / 谈判的动作不是，传 undefined */
  actionExpanded?: boolean;
  /** 谈判页的表单在收起时要保留已填内容：桌面端面板常驻、用 hidden 隐藏（窄屏抽屉仍按需挂载） */
  keepMounted?: boolean;
}) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const panelId = useId();
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  function rowClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, textarea, select')) return;
    onToggle();
  }

  return (
    <div
      className={`desk-row${expanded ? ' is-open' : ''}${rowClassName ? ` ${rowClassName}` : ''}`}
      data-player-id={player.id}
      data-offer-id={dataOfferId}
    >
      <div className="desk-row-main" onClick={rowClick}>
        <div className="desk-player">
          <Link to={playerPath(player)} onClick={stop}>
            {player.name}
          </Link>
          <div className="desk-meta">{meta}</div>
        </div>
        <div className="desk-amount mono">
          {amount}
          {amountBadges}
        </div>
        <div className="desk-badge">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
        </div>
        <div className="desk-action">
          <button
            type="button"
            className="btn btn-sm"
            disabled={action.disabled}
            title={action.reason}
            aria-expanded={actionExpanded}
            onPointerEnter={onActionHover}
            onFocus={onActionHover}
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            {action.label}
          </button>
        </div>
        <button
          type="button"
          className="desk-chevron"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? '收起' : '展开'} ${player.name} 详情`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <span aria-hidden="true">▾</span>
        </button>
      </div>

      {children !== undefined &&
        (narrow ? (
          expanded ? (
            <DeskDrawer title={player.name} panelId={panelId} onClose={onToggle}>
              {children}
            </DeskDrawer>
          ) : null
        ) : keepMounted ? (
          <div className="desk-row-panel" id={panelId} hidden={!expanded}>
            {children}
          </div>
        ) : (
          expanded && (
            <div className="desk-row-panel" id={panelId}>
              {children}
            </div>
          )
        ))}
    </div>
  );
}

/** ≤760 的底部抽屉：复用全站 .mkt-ov* 外壳，Esc/锁滚/Tab 循环/焦点归位都由 useOverlayShell 管 */
function DeskDrawer({
  title,
  panelId,
  onClose,
  children,
}: {
  title: string;
  panelId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { panelRef, onCloseRef } = useOverlayShell(onClose, closeRef);
  return createPortal(
    <div className="mkt-ov mkt-ov-drawer" role="presentation" onClick={() => onCloseRef.current()}>
      <div
        className="mkt-ov-panel nego-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 转会详情`}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mkt-ov-grab" aria-hidden="true" />
        <div className="desk-drawer-head">
          <span>{title}</span>
          <button type="button" className="mkt-ov-x" aria-label="关闭" ref={closeRef} onClick={onClose}>
            ✕
          </button>
        </div>
        <div id={panelId} className="desk-drawer-body">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
