// 审核队列「俱乐部」列的取义纯函数（2026-11-04 设计稿 §3/§5）。
// 只读 r.report 与 r.transfer（type + from/to 队名与 id），绝不碰 payload——
// 摘要口径（bypassSummary）与队名口径解耦，各管各的；也不做任何 IO。
import type { AdminReviewRow } from '../../lib/api.ts';

/** 俱乐部的一端：name 空串或 id 为 null 都算「空端」，渲染层只出 —、不挂 IdTag。 */
export interface ReviewClubPart {
  name: string;
  id: number | null;
}

/** reviewClubDisplay 的产物：main 是主行（普通单两端、方式单一端），arrow 只在普通单为 true。 */
export interface ReviewClubDisplay {
  main: ReviewClubPart[];
  arrow: boolean;
  role: string | null;
  origin: ReviewClubPart | null;
}

function part(name: string | null, id: number | null): ReviewClubPart {
  // 设计稿 §4：旧后端响应可能整条缺 id 键（undefined），统一收敛成 null，避免 IdTag 渲染 #undefined
  return { name: name ?? '', id: id ?? null };
}

/** 按单据类型取「哪家俱乐部做的」：
 *  - 激活举报：只有激活方（l.activated_by），transfer 语义不适用；
 *  - 海捞：签入方为主，原队（真自由身则无 / CPU 原队则有）落第二行；
 *  - 解约/续约/匹配留队：操作方即 from 端（续约与留队的 from = to）；
 *  - 其余（普通 / 激活成交 / 强拍）：from → to 两端都保留，空端由渲染层出 —，箭头不消失。 */
export function reviewClubDisplay(r: AdminReviewRow): ReviewClubDisplay {
  if (r.report !== null) {
    return {
      main: [part(r.report.activatorClubName, r.report.activatorClubId)],
      arrow: false,
      role: '激活方',
      origin: null,
    };
  }
  const t = r.transfer;
  switch (t.type) {
    case 'free_agent':
      return {
        main: [part(t.toClubName, t.toClubId)],
        arrow: false,
        role: '签入',
        origin: t.fromClubName !== null || t.fromClubId !== null ? part(t.fromClubName, t.fromClubId) : null,
      };
    case 'termination':
      return { main: [part(t.fromClubName, t.fromClubId)], arrow: false, role: '解约', origin: null };
    case 'rc_change':
      return { main: [part(t.fromClubName, t.fromClubId)], arrow: false, role: '续约', origin: null };
    case 'match':
      return { main: [part(t.fromClubName, t.fromClubId)], arrow: false, role: '留队', origin: null };
    default:
      return {
        main: [part(t.fromClubName, t.fromClubId), part(t.toClubName, t.toClubId)],
        arrow: true,
        role: null,
        origin: null,
      };
  }
}
