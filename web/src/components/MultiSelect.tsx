// 多选下拉（v3.1.1 步骤 3）：位置 / 显示列 / PlayStyle 三处共用同一个组件。
// 面板走原生 Popover API（top layer）：窄屏筛选抽屉是 position:fixed + overflow-y:auto 的滚动容器，
// 普通绝对定位的面板会被它裁掉一截；top layer 不受任何祖先的 overflow/clip/transform 影响。
// 浏览器的 light-dismiss 不依赖：勾选之后不能自动关（多选就是要连点几项），所以开关状态自己管，
// 关的路径只有三条 —— 再点一次触发器、点面板外、按 Esc。
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MultiSelectItem {
  value: string;
  label: string;
  /** 二级小标题（属性七组、PlayStyle 六类这种）；相邻同名的合成一组 */
  group?: string;
  /** 一级段标题（PlayStyle 的「银徽章」「金徽章」）；换段即重开分组 */
  section?: string;
}

export interface MultiSelectProps {
  /** 触发器上的名字，如「位置」「显示列」 */
  label: string;
  items: MultiSelectItem[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  /** 有选中项时在面板底部出现的「清空」（不传则不显示） */
  onClear?: () => void;
  /** 面板底部右侧的自定义动作（显示列的「恢复自动」） */
  footer?: ReactNode;
}

// 把扁平 items 切成「段 → 组 → 项」：相邻同 section 同 group 的合成一块，
// 段名一变分组重开（银徽章和金徽章都有「终结」组，不能并成一块）
function toBlocks(items: MultiSelectItem[]): { section?: string; group?: string; items: MultiSelectItem[] }[] {
  const blocks: { section?: string; group?: string; items: MultiSelectItem[] }[] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (last && last.section === item.section && last.group === item.group) last.items.push(item);
    else blocks.push({ section: item.section, group: item.group, items: [item] });
  }
  return blocks;
}

const HTMLElementCtor = typeof globalThis.HTMLElement === 'function' ? globalThis.HTMLElement : null;
const HAS_POPOVER = HTMLElementCtor !== null && 'showPopover' in HTMLElementCtor.prototype;

/** 面板与触发器之间的间隙、离视口边缘的留白。 */
const PANEL_GAP = 6;
const PANEL_EDGE = 8;
/** 触发器下方留不出这么多高度就翻到上方：低于这个可用高度，面板会矮到没法用。 */
const MIN_PANEL_ROOM = 220;
/** 面板高度的兜底下限：再矮就只剩一条缝了。 */
const MIN_PANEL_HEIGHT = 160;
/**
 * 面板高度的上限：不高于 480px、也不高于视口的 70%。这对数字原先只写在 styles.css 的
 * `.multiselect-panel` 上，而 place() 每次开面板都写一遍内联 maxHeight，CSS 那条永远是死的 ——
 * 1200px 高的窗口、触发器靠上时面板会被拉到约 1100px（等于没有上限）。
 * 上限收到这里：JS 只写一个值，样式表里不再重复写数字。
 */
const PANEL_MAX_PX = 480;
const PANEL_MAX_VH = 0.7;
// 视口高 < 约 229px 时 70vh 会小于兜底 160，兜底优先（与翻转前的旧实现同样取「够得着」优先）

/**
 * 面板落位（纯函数，jsdom 里量不出布局，所以抽出来单测）。
 * 抽屉底部、窄屏底部的触发器下方没有空间（真浏览器实测：触发器贴底时面板会掉到视口外 166px，
 * 点不到也滚不到）⇒ 放不下就翻到触发器上方、贴底对齐。
 * 高度取「可用空间」与上限（480px / 70vh）的小者，再兜底到下限 160：上方不封顶的话，72 项
 * PlayStyle 面板在高窗口里会拉到接近满屏。
 * 判据用常量而不是面板实测高度：showPopover() 之前面板是 display:none，offsetHeight /
 * scrollHeight 都是 0，那时量出来的「面板想要多高」恒为 0，会永远判成放得下。
 */
export function panelPlacement(
  box: { top: number; bottom: number; left: number },
  view: { width: number; height: number },
  panelWidth: number,
): { left: number; top?: number; bottom?: number; maxHeight: number; openUp: boolean } {
  const below = view.height - box.bottom - PANEL_GAP - PANEL_EDGE;
  const above = box.top - PANEL_GAP - PANEL_EDGE;
  const openUp = below < MIN_PANEL_ROOM && above > below;
  const room = openUp ? above : below;
  const cap = Math.min(PANEL_MAX_PX, view.height * PANEL_MAX_VH);
  return {
    left: Math.max(PANEL_EDGE, Math.min(box.left, view.width - panelWidth - PANEL_EDGE)),
    top: openUp ? undefined : box.bottom + PANEL_GAP,
    bottom: openUp ? view.height - box.top + PANEL_GAP : undefined,
    maxHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(room, cap)),
    openUp,
  };
}

export default function MultiSelect({ label, items, selected, onToggle, onClear, footer }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    // top layer 里的面板脱离文档流：位置每次都得按触发器现算，滚动与缩放时跟着走
    const place = () => {
      const at = panelPlacement(
        trigger.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        panel.offsetWidth || 320,
      );
      panel.style.left = `${at.left}px`;
      panel.style.top = at.top === undefined ? 'auto' : `${at.top}px`;
      panel.style.bottom = at.bottom === undefined ? 'auto' : `${at.bottom}px`;
      panel.style.maxHeight = `${at.maxHeight}px`;
    };
    if (HAS_POPOVER) {
      try {
        panel.showPopover();
      } catch {
        // 已经在 top layer 里（连点两次开关之类的时序）就当它已经开着，不影响下面的定位
      }
    }
    // 必须等进了 top layer 再落位：之前面板是 display:none，offsetWidth 量到 0
    place();
    panel.focus({ preventScroll: true });

    // capture 监听：滚动可能发生在抽屉/侧栏这些内层容器上，不 capture 就收不到
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // 抽屉也监听 Esc：这里先拦掉，否则一次 Esc 会同时关面板和抽屉
      e.preventDefault();
      setOpen(false);
      trigger.focus();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && (panel.contains(target) || trigger.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  const selectedLabels = items.filter((it) => selected.includes(it.value)).map((it) => it.label);
  const blocks = toBlocks(items);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`multiselect${selected.length > 0 ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? listId : undefined}
        title={selectedLabels.length > 0 ? `${label}：${selectedLabels.join('、')}` : label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="multiselect-text">
          {label}
          {selected.length > 0 ? ` · ${selected.length}` : ''}
        </span>
        <span className="multiselect-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={listId}
          className="multiselect-panel"
          // popover 属性只在引擎真的实现了 Popover API 时才加：UA 样式表对
          // `[popover]:not(:popover-open)` 是 display:none，而这个选择器在**不支持**
          // showPopover 的环境（jsdom 正是如此）里永远不匹配 —— 于是面板会被判成不可见，
          // 兜底路径反而是「看得见但点不到」的死元素。没有这个属性时它就是普通元素，
          // 靠 CSS 的 position:fixed + z-index 做兜底。
          {...(HAS_POPOVER ? { popover: 'manual' as const } : {})}
          role="group"
          aria-label={label}
          tabIndex={-1}
        >
          {blocks.map((block, i) => (
            <div key={`${block.section ?? ''}/${block.group ?? ''}/${i}`}>
              {/* 段标题只在换段时出现一次：同一段里按组切成多块，段名不该每块重复一遍 */}
              {block.section && block.section !== blocks[i - 1]?.section ? (
                <div className="multiselect-section">{block.section}</div>
              ) : null}
              {block.group ? <div className="multiselect-group">{block.group}</div> : null}
              {block.items.map((item) => (
                <label key={item.value} className="multiselect-item">
                  <input type="checkbox" checked={selected.includes(item.value)} onChange={() => onToggle(item.value)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          ))}
          {onClear || footer ? (
            <div className="multiselect-foot">
              {onClear ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onClear} disabled={selected.length === 0}>
                  清空
                </button>
              ) : (
                <span />
              )}
              {footer}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
