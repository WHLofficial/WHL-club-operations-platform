// 超帽确认弹窗（v6.54.0 步骤 8，设计 §10.5「超帽确认弹窗」/ 测试计划 TC-RD-38）。
//
// 触发条件由调用方（注册工作台）判定：**当前窗合规、只有关窗后的 projected 工资越帽**。
// 它是「知道后果仍提交」的显式选择，不阻止提交（当前窗本身没超帽）；硬规则失败不走这里。
//
// 五件套（顺序即读数顺序，屏幕阅读器同序）：
//   ① 标题「关窗后将超过工资帽」+ 副行「当前窗合规；问题出在待生效合同」
//   ② 数字行「当前 66.60 → 关窗后 68.10 / 帽 68.00 · 超 0.10」（超额 danger 红）
//   ③ 驱动明细：把 projected 顶过帽的待生效合同（球员 · +Δ · 来源），最多 3 条 + 查看全部
//   ④ 后果句「关窗时必须强制拍卖球员降到帽下…」
//   ⑤ 动作：「去处理」= 主路径（关弹窗、滚到待生效明细）+「仍要提交」= danger 两段式
//
// 形态：桌面居中 .mkt-ov；≤760 底部抽屉（复用 useOverlayShell 的焦点陷阱 / 锁滚 / Esc）；
// ≤640 铺成全屏 bottom sheet、按钮上下堆叠且触控目标 ≥44px（样式在 styles.css 的 oc- 段）。
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useOverlayShell } from '../../lib/use-overlay-shell.ts';
import { CapBar } from './CapBar.tsx';
import { delta2, fmt2 } from '../../lib/contract-view.ts';
import { playerPath } from '../../lib/player-link.ts';

export interface OverCapDriver {
  id: number;
  fcId: number | null;
  name: string;
  /** 关窗后相对当前的工资增量（正数；调用方已按增量过滤） */
  delta: number;
  /** 来源文案（球员要求 / 普通续约 / 保护期调整） */
  source: string;
}

const MAX_VISIBLE_DRIVERS = 3;

export function OverCapDialog({
  current,
  projected,
  cap,
  drivers,
  onProcess,
  onConfirm,
  onCancel,
}: {
  current: number;
  projected: number;
  cap: number;
  /** 驱动明细（调用方按增量降序；组件只负责截断与展开） */
  drivers: readonly OverCapDriver[];
  /** 主路径：关弹窗并滚到待生效明细 */
  onProcess: () => void;
  /** 二次确认后的提交（调用方负责真正的 POST） */
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { narrow, panelRef, onCloseRef } = useOverlayShell(onCancel, closeRef);
  // 「仍要提交」两段式：第一次只是把按钮变红并改文案，第二次才真的提交（语义同 ConfirmButton 的二次击）
  const [armed, setArmed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const over = Math.max(0, projected - cap);
  const visible = showAll ? drivers : drivers.slice(0, MAX_VISIBLE_DRIVERS);

  return createPortal(
    <div
      className={narrow ? 'mkt-ov mkt-ov-drawer oc-ov' : 'mkt-ov oc-ov'}
      role="presentation"
      onClick={() => onCloseRef.current()}
    >
      <div
        className="mkt-ov-panel oc-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oc-title"
        aria-describedby="oc-sub"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        {narrow && <div className="mkt-ov-grab" aria-hidden="true" />}
        <div className="oc-head">
          <div className="oc-head-text">
            <h3 className="oc-title" id="oc-title">
              关窗后将超过工资帽
            </h3>
            <p className="oc-sub" id="oc-sub">
              当前窗合规；问题出在待生效合同
            </p>
          </div>
          {/* 关闭按钮：≤640 的 44px 触控目标由 CSS 给（oc-x） */}
          <button type="button" className="mkt-ov-x oc-x" aria-label="关闭" ref={closeRef} onClick={onCancel}>
            ✕
          </button>
        </div>

        {/* ② 数字行（超额 danger 红）；数字口径与工作台 cap bar 同源 */}
        <p className="oc-nums">
          <span>
            当前 <b>{fmt2(current)}</b>
          </span>
          <span className="oc-arrow" aria-hidden="true">
            →
          </span>
          <span>
            关窗后 <b>{fmt2(projected)}</b>
          </span>
          <span className="oc-sep" aria-hidden="true">
            /
          </span>
          <span>
            帽 <b>{fmt2(cap)}</b>
          </span>
          <span className="oc-sep" aria-hidden="true">
            ·
          </span>
          <span className="oc-over">超 {fmt2(over)}</span>
        </p>
        <CapBar
          current={current}
          projected={projected}
          cap={cap}
          title={`当前 ${fmt2(current)}m/窗，关窗后 ${fmt2(projected)}m/窗，工资帽 ${fmt2(cap)}m`}
        />

        {/* ③ 驱动明细：球员 · +Δ · 来源；≤3 条，其余展开 */}
        <ul className="oc-list" aria-label="把关窗后工资顶过帽的待生效合同">
          {visible.map((d) => (
            <li key={d.id}>
              <span className="oc-driver">
                <Link to={playerPath(d)}>{d.name}</Link>
                <span className="oc-src">{d.source}</span>
              </span>
              <b className="oc-delta">{delta2(d.delta)}</b>
            </li>
          ))}
        </ul>
        {drivers.length > MAX_VISIBLE_DRIVERS && (
          <button type="button" className="oc-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? '收起' : `查看全部 ${drivers.length} 条`}
          </button>
        )}

        {/* ④ 后果句（不是可选项：关窗时会强制拍卖） */}
        <p className="oc-effect">关窗时必须强制拍卖球员降到帽下；拍卖收入与降幅由系统按现行规则处理。</p>

        {/* ⑤ 动作：去处理 = 主路径；仍要提交 = 两段式 danger */}
        <div className="oc-btns">
          <button type="button" className="btn oc-btn" onClick={onProcess}>
            去处理（看待生效明细）
          </button>
          <button
            type="button"
            className={`btn btn-danger oc-btn${armed ? ' btn-armed' : ''}`}
            aria-live="polite"
            onClick={() => {
              if (armed) onConfirm();
              else setArmed(true);
            }}
          >
            {armed ? '再点一次确认提交' : '仍要提交'}
          </button>
        </div>
        <p className="oc-foot">提交的是当前窗合规的名单；超帽留给关窗处理。</p>
      </div>
    </div>,
    document.body,
  );
}
