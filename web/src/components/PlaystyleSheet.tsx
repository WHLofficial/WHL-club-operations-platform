// PlayStyle 说明弹层（v6.69.0）：窄屏点徽章时从底部弹出，展示定位句 + 银/金两档效果。
// 桌面宽屏不走这里（原生 title 已能显示同一份文案），所以只挂在 openable 的整徽上。
// 不做焦点循环：弹层只有「关闭」一个可交互元素，Esc / 遮罩 / 关闭键三路都能退出。
import { useEffect, useRef } from 'react';
import { isGkPlaystyle, playstyleById, playstyleDescOf, playstyleEffectOf, playstyleIconUrl } from '../lib/ref.ts';

export function PlaystyleSheet({ psid, gold, onClose }: { psid: number; gold: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const row = playstyleById.get(psid);
  const desc = playstyleDescOf(psid);
  const label = row?.chs ?? row?.en ?? `PS ${psid}`;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // 弹层期间锁住页面滚动，退出时原样还原（窄屏上底下的列表跟着滚很难受）
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="ps-sheet-overlay" onClick={onClose}>
      <div
        className="ps-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${label} 说明`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ps-sheet-head">
          <img
            className={`ps-icon ${gold ? 'ps-icon-gold' : 'ps-icon-silver'}${isGkPlaystyle(psid) ? ' ps-icon-gk' : ''}`}
            src={playstyleIconUrl(psid)}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <strong>{label}</strong>
          <span className={gold ? 'ps-sheet-tier gold' : 'ps-sheet-tier'}>{gold ? '金徽' : '银徽'}</span>
          <button ref={closeRef} type="button" className="ps-sheet-close" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        {desc === null ? (
          <p className="hint">暂无说明。</p>
        ) : (
          <>
            <p className="ps-sheet-info">{desc.info}</p>
            <dl className="ps-sheet-effects">
              <div className={gold ? '' : 'on'}>
                <dt>🥈 银徽</dt>
                <dd>{desc.desc}</dd>
              </div>
              <div className={gold ? 'on' : ''}>
                <dt>🥇 金徽</dt>
                <dd>{playstyleEffectOf(psid, true)}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
