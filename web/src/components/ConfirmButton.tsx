// 管理端两段式确认按钮（增量 15 commit 4）：第一次点进入 armed 高亮态，再点才执行。
// 失焦自动解除；disarmKey 变化（如表单输入）也解除，对齐原各 section 的 resetArm 习惯。
import { useEffect, useState } from 'react';

interface ConfirmButtonProps {
  label: string; // 平时文案
  confirmLabel: string; // armed 文案（含「再点一次」）
  busyLabel?: string; // busy 文案（可带进度）；缺省沿用 armed/平时文案
  className?: string; // 额外类：btn-danger / btn-sm 等
  disabled?: boolean; // 校验不过时禁用
  busy?: boolean;
  onConfirm: () => void;
  disarmKey?: unknown; // 变化时自动解除 armed
}

export default function ConfirmButton({
  label,
  confirmLabel,
  busyLabel,
  className = '',
  disabled = false,
  busy = false,
  onConfirm,
  disarmKey,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
  }, [disarmKey]);

  const dead = busy || disabled;
  return (
    <button
      className={`btn${armed ? ' btn-armed' : ''}${className ? ` ${className}` : ''}`}
      type="button"
      disabled={dead}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {busy && busyLabel !== undefined ? busyLabel : armed ? confirmLabel : label}
    </button>
  );
}
