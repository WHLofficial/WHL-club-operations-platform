// 教练侧时刻表提示条（v6.49.0）：未开始 / 已结束 ⇒ 红字说明；进行中且有具体终点 ⇒ 读秒。
// 只做展示，不做拦截判断——按钮的 disabled 由调用方按 gate.blocked 决定。
import { fmtClock, useCountdown } from '../lib/use-countdown.ts';
import type { OpsGate } from '../lib/ops-gate.ts';

export default function OpsGateNote({ gate, className = '' }: { gate: OpsGate | null; className?: string }) {
  const left = useCountdown(gate?.blocked ? null : (gate?.deadlineAt ?? null));
  if (!gate) return null;
  if (gate.blocked) {
    return <p className={`ops-gate ops-gate-blocked ${className}`.trim()}>{gate.hint}，现在不能提交。</p>;
  }
  if (left === null) return null;
  return (
    <p className={`ops-gate ${className}`.trim()}>
      {gate.label}进行中 · 还剩 {fmtClock(left)}
    </p>
  );
}
