import { useCallback, useState } from 'react';

// 家族惯例的操作反馈：右下角 toast，3 秒自消；err=true 走红字样式
export function useToast() {
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);

  const show = useCallback((text: string, err = false) => {
    setToast({ text, err });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const node = toast ? (
    <div className={`toast${toast.err ? ' err' : ''}`} role="status">
      {toast.text}
    </div>
  ) : null;

  return { show, toastNode: node };
}
