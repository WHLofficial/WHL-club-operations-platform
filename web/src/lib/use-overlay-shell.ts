// 浮层壳（v6.40.0 对话式改造 D4-乙）：把「桌面居中 / ≤760px 底部抽屉 + 锁背景滚动 + Esc 关闭 +
// Tab 循环留在面板内 + 打开时移焦 + 关闭后焦点归位」收成仓库唯一出处。
// 原先有第三份副本（ComparePickerOverlay 顶部注释自认）；现在 MarketListingOverlay / ComparePickerOverlay /
// 报价谈判浮层共用本 hook，CSS 仍各用各的类（.mkt-ov / .cmp-picker-ov / .nego-ov）。
import { useEffect, useRef } from 'react';
import { useMediaQuery } from './use-media.ts';

/** 只看浏览器默认能 Tab 到的元素（照 PlayersLibrary / AdminLayout 抽屉口径） */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface OverlayShell {
  /** ≤760px 判定（仓库既有浮层统一断点） */
  narrow: boolean;
  /** 面板节点：Tab 循环的范围，也是打开时默认移焦的容器 */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** 收进 ref 的关闭回调：父组件传内联箭头不会让副作用重跑 */
  onCloseRef: React.RefObject<() => void>;
}

/**
 * 挂载即打开（调用方负责开合渲染）。`initialFocus` 给「关掉按钮要立刻可用」的浮层指定落点，
 * 不给就移到面板内第一个可聚焦元素。
 */
export function useOverlayShell(onClose: () => void, initialFocus?: React.RefObject<HTMLElement | null>): OverlayShell {
  const narrow = useMediaQuery('(max-width: 760px)');
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef(initialFocus);
  const restoreRef = useRef<HTMLElement | null>(null);

  // 焦点归位：关闭（含确认后导航）交还给入口按钮
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => restoreRef.current?.focus();
  }, []);

  // 锁背景滚动 + 移焦 + Esc 关闭 + Tab 循环
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target = initialFocusRef.current?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    target?.focus();
    const onKey = (e: KeyboardEvent) => {
      // 内层组件已经消化过的 Esc 不再二次响应
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
        if (el.offsetParent === null) return false;
        const closed = el.closest('details:not([open])');
        return !closed || closed.querySelector(':scope > summary') === el;
      });
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = !!active && panel.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return { narrow, panelRef, onCloseRef };
}
