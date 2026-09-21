// 多选下拉（增量 27 步骤 3）：位置 / 显示列 / PlayStyle 三处共用同一个组件。
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
      const box = trigger.getBoundingClientRect();
      const width = panel.offsetWidth || 320;
      panel.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
      panel.style.top = `${box.bottom + 6}px`;
      panel.style.maxHeight = `${Math.max(160, window.innerHeight - box.bottom - 20)}px`;
    };
    place();
    if (HAS_POPOVER) {
      try {
        panel.showPopover();
      } catch {
        // 已经在 top layer 里（连点两次开关之类的时序）就当它已经开着，不影响下面的定位
      }
    }
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
