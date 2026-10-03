// 读秒倒计时（v6.24.0 在售市场卡片 / 浮层）：模块级单例 1Hz tick——N 张卡共用一个 interval，
// 首个订阅开表、最后一个退订停表（长列表不塌性能，TC-B01 的停表断言）。
// 锚定时（deadlineAt 变化时重锚）只读一次本地 Date 求初始剩余，之后每一拍都用 performance.now
// 差值回推剩余——本地系统校时回拨不会让读秒跳变（TC-B02）。
import { useEffect, useState } from 'react';

type Tick = () => void;

const subs = new Set<Tick>();
let timer: ReturnType<typeof setInterval> | null = null;

function start(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    for (const tick of subs) tick();
  }, 1000);
}

function stop(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** 剩余整秒（向上取整，最小 0）；deadlineAt 为 null / 非法时返回 null（调用方显示占位）。 */
export function useCountdown(deadlineAt: string | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (deadlineAt === null) {
      setRemaining(null);
      return;
    }
    const endMs = Date.parse(deadlineAt);
    if (Number.isNaN(endMs)) {
      setRemaining(null);
      return;
    }
    // 锚点：初始剩余（本地 Date 只在这里读一次）+ 单调时钟起点
    const anchor = { remainMs: endMs - Date.now(), at: performance.now() };
    const compute = () => Math.max(0, Math.ceil((anchor.remainMs - (performance.now() - anchor.at)) / 1000));
    // 订阅者必须是「写状态」的函数：模块 tick 只负责调用，不接管返回值
    const tick = () => setRemaining(compute());
    setRemaining(compute());
    subs.add(tick);
    start();
    return () => {
      subs.delete(tick);
      if (subs.size === 0) stop();
    };
  }, [deadlineAt]);

  return remaining;
}

/** hh:mm:ss；超 24h 前缀「d天 」（定稿稿口径）。 */
export function fmtClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const d = Math.floor(sec / 86400);
  const rest = sec % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmmss = `${pad(Math.floor(rest / 3600))}:${pad(Math.floor((rest % 3600) / 60))}:${pad(rest % 60)}`;
  return d > 0 ? `${d}天 ${hhmmss}` : hhmmss;
}
