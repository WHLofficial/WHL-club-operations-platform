// 教练侧运营时刻表闸门（v6.49.0）：把 GET /api/ops-schedule 的行翻成「能不能点 + 还差多久 / 为什么不能点」。
// 真闸在服务端（assertOpOpen 返回 409 op_not_started / op_closed）——这里只做置灰与提示，避免教练白填一遍表单。
// 状态与解析时间的唯一真源仍是 src/core/ops-schedule.ts（worker 解析好下发），前端不自己算窗口。
//
// 取数用模块级单例（同 web/src/lib/use-countdown.ts 的路子），不走 react-query：
// 这些闸门挂在散落各处的小组件上（出价表单、工单卡、谈判步骤），组件测试里不会都套 QueryClientProvider；
// 单例还能把「全站一份、60s 一次」做实，避免每个按钮各发一次请求。
import { useSyncExternalStore } from 'react';
import { api, type OpsScheduleView, type OpsStatusRow } from './api.ts';

const TTL_MS = 60_000;
let cache: OpsScheduleView | null = null;
let at = 0;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();

function emit(): void {
  for (const fn of subs) fn();
}

/** 只读快照（useSyncExternalStore 用；对象身份只在刷新时变） */
export function opsScheduleSnapshot(): OpsScheduleView | null {
  return cache;
}

/** 拉一次（TTL 内直接返回）；失败静默——取不到就当未加载，按钮不禁用，硬闸仍在服务端 */
export function refreshOpsSchedule(force = false): Promise<void> {
  if (!force && cache !== null && Date.now() - at < TTL_MS) return Promise.resolve();
  if (inflight !== null) return inflight;
  inflight = api<OpsScheduleView>('/api/ops-schedule')
    .then((view) => {
      cache = view;
      at = Date.now();
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 测试与时刻表保存后手动失效用 */
export function resetOpsSchedule(): void {
  cache = null;
  at = 0;
  inflight = null;
  emit();
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  void refreshOpsSchedule();
  return () => {
    subs.delete(fn);
  };
}

export interface OpsGate {
  key: string;
  label: string;
  state: OpsStatusRow['state'];
  blocked: boolean;
  /** 挡住时的原因（未开始 / 已结束），可直接展示 */
  hint: string;
  /** 进行中且有具体终点 ⇒ 读秒锚；随关窗止 / 不限制时为 null */
  deadlineAt: string | null;
}

/** 从整表视图里取某一项的闸门；视图还没加载出来时返回 null（调用方按「未加载」处理，不禁用） */
export function opsGateOf(view: OpsScheduleView | null | undefined, key: string): OpsGate | null {
  const row = view?.rows.find((r) => r.key === key);
  if (!row) return null;
  const blocked = row.state === 'not_started' || row.state === 'closed';
  const hint =
    row.state === 'not_started'
      ? `${row.label}还没开始`
      : row.state === 'closed'
        ? row.requiresWindow && row.endIsWindowClose
          ? `${row.label}已结束（转会窗口已关）`
          : `${row.label}已结束`
        : '';
  return { key, label: row.label, state: row.state, blocked, hint, deadlineAt: row.resolvedEndAt };
}

/** 全站共享的时刻表视图（60s 一次请求；没有窗口/未加载时返回 null） */
export function useOpsScheduleView(): OpsScheduleView | null {
  return useSyncExternalStore(subscribe, opsScheduleSnapshot, opsScheduleSnapshot);
}

/** 组合式取用：`const gate = useOpsGate('transfer_listing')` */
export function useOpsGate(key: string): OpsGate | null {
  return opsGateOf(useOpsScheduleView(), key);
}
