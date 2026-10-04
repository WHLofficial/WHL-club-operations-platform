import { useEffect, useRef } from 'react';

// 吸底镜像横向滚动条（v6.26.1）：渲染一条与目标容器（.table-wrap）内容同宽的镜像轨，
// position: sticky; bottom: 0 钉在视口底——表格在视野内时随时可拖，双向 scrollLeft 同步。
// 只在桌面（>900px）由调用方 gate 渲染；目标容器的 overflow/position 保持原样（e2e ⑪ 依赖）。
export default function StickyScrollbar({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = target.current;
    const bar = barRef.current;
    const inner = innerRef.current;
    if (!wrap || !bar || !inner) return;

    // 镜像轨内层宽度 = 表格真实内容宽度，运行时赋值（不走 JSX 内联字面量：TC-SWP-02/03 禁 style={{ width: 字面量 }}）
    const fit = () => {
      inner.style.width = `${wrap.scrollWidth}px`;
    };
    fit();

    // 列增减/窗口变化都会改 scrollWidth；没有 table 时仍听 wrap 自身
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    const table = wrap.querySelector('table');
    ro?.observe(table ?? wrap);

    // 双向同步：scrollLeft 赋值会再派发一次 scroll 事件，不防回环会互相追着写。
    // 进入先查标志、赋值前后置位/清位；即便异步回声漏过标志，同值赋值也不产生新事件 ⇒ 自终止。
    let syncing = false;
    const wrapToBar = () => {
      if (syncing) return;
      syncing = true;
      bar.scrollLeft = wrap.scrollLeft;
      syncing = false;
    };
    const barToWrap = () => {
      if (syncing) return;
      syncing = true;
      wrap.scrollLeft = bar.scrollLeft;
      syncing = false;
    };
    wrap.addEventListener('scroll', wrapToBar, { passive: true });
    bar.addEventListener('scroll', barToWrap, { passive: true });
    return () => {
      ro?.disconnect();
      wrap.removeEventListener('scroll', wrapToBar);
      bar.removeEventListener('scroll', barToWrap);
    };
  }, [target]);

  // 不用 aria-hidden：Chrome 会把可滚动容器变成可聚焦元素，aria-hidden 包住可聚焦内容
  // 是 aria-hidden-focus 违规；空 div 无可访问名，读屏本来就不会播报
  return (
    <div className="sticky-xbar" ref={barRef}>
      <div className="sticky-xbar-inner" ref={innerRef} />
    </div>
  );
}
