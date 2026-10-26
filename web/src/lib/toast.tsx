import { useCallback, useEffect, useRef, useState } from 'react';

// 家族惯例的操作反馈：右下角 toast，3 秒自消；err=true 走红字样式
export function useToast() {
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);
  // 3 秒归零定时器必须挂 ref：卸载要清、连发要换。
  //  - 不清卸载：组件销毁后定时器仍触发 setToast——测试环境拆除后 React 读已关闭
  //    jsdom 的 window.event 直接抛错（GrowthEntryPage.test.tsx 末例弹 toast 即红）；
  //  - 不换连发：3 秒内弹第二条，第一条的定时器会把第二条提前抹掉（真 bug）。
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const show = useCallback((text: string, err = false) => {
    setToast({ text, err });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const node = toast ? (
    <div className={`toast${toast.err ? ' err' : ''}`} role="status">
      {toast.text}
    </div>
  ) : null;

  return { show, toastNode: node };
}
