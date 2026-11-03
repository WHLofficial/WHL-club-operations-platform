// 球员转会浮层壳（v6.74.0 期 C，设计 §6.3）：桌面居中、≤760px 底部抽屉；
// 壳（锁滚 / Esc / Tab 循环 / 焦点归位）走共享 useOverlayShell，内容 = PlayerTransferPanel。
import { createPortal } from 'react-dom';
import { useOverlayShell } from '../../../lib/use-overlay-shell.ts';
import { PlayerTransferPanel } from './PlayerTransferPanel.tsx';

export function PlayerTransferDialog({
  playerId,
  onClose,
  onChanged,
}: {
  playerId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { narrow, panelRef, onCloseRef } = useOverlayShell(onClose);
  return createPortal(
    <div className="modal-mask" onClick={() => onCloseRef.current()}>
      <div
        className={`modal-card card transfer-dialog${narrow ? ' is-narrow' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="球员转会详情"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="transfer-dialog-head">
          <span>转会详情</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCloseRef.current()}>
            关闭
          </button>
        </div>
        <PlayerTransferPanel playerId={playerId} mode="player" onClose={onClose} onChanged={onChanged} />
      </div>
    </div>,
    document.body,
  );
}
