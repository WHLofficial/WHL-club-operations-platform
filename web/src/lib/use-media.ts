// 增量 26：窄屏断点在这里订阅（当前只有筛选抽屉用，将来任何「桌面 / 窄屏」分支都走这里）。
//
// 用 matchMedia 而不是 window.innerWidth + resize 监听：前者只在真正跨过断点时触发一次；
// 后者在移动端会被滚动手势带着响（地址栏收起/展开会改高度与布局），白抖一堆重渲染。
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    // query 变化时立刻对齐一次，别等下一次跨断点
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
