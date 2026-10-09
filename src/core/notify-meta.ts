// 站内信元数据（v6.40.0）：模板 → 中文徽章 + 八类类目，worker 与前端共用的唯一真源。
// 前端收件篮与 web/src/lib/notify-links.ts 都 import 本文件 ⇒ 必须零 import
// （守卫 tests/core-zero-import.test.ts 的 PURE_DATA_MODULES：一旦有依赖，env/hono 会顺进前端 bundle）。
// 模板集合与 src/worker/notify.ts 的 renderNotification case 字面量双向相等（守卫 src/core/notify-meta.test.ts）。

export type NotifyCategoryId =
  | 'result'
  | 'growth'
  | 'offer'
  | 'activation'
  | 'event'
  | 'naming'
  | 'shop'
  | 'window';

export interface NotifyCategory {
  id: NotifyCategoryId;
  /** 页签与徽章上的中文名 */
  name: string;
  /** 沿用既有 .badge 修饰色（web/src/styles.css 的 .badge.<tone>）——配色不新造 */
  tone: 'green' | 'gold' | 'blue' | 'sky' | 'orange' | 'purple' | 'red' | 'gray';
}

/** 类目顺序 = 收件篮页签顺序。 */
export const NOTIFY_CATEGORIES: readonly NotifyCategory[] = [
  { id: 'result', name: '赛果', tone: 'green' },
  { id: 'growth', name: '成长', tone: 'gold' },
  { id: 'offer', name: '报价', tone: 'blue' },
  { id: 'activation', name: '激活', tone: 'sky' },
  { id: 'event', name: '事件', tone: 'orange' },
  { id: 'naming', name: '命名', tone: 'purple' },
  { id: 'shop', name: '商城', tone: 'red' },
  { id: 'window', name: '窗口', tone: 'gray' },
];

export interface NotifyMeta {
  /** 徽章文案（4 字，同一模板恒同一枚） */
  label: string;
  category: NotifyCategoryId;
}

/** 30 个模板一一对应一枚徽章（原始模板名走徽章 title，不丢信息）。 */
export const NOTIFY_META: Record<string, NotifyMeta> = {
  result_confirmed: { label: '赛果确认', category: 'result' },
  levelup: { label: '球员成长', category: 'growth' },
  offer_received: { label: '收到报价', category: 'offer' },
  offer_countered: { label: '对方还价', category: 'offer' },
  offer_accepted: { label: '报价接受', category: 'offer' },
  offer_rejected: { label: '报价被拒', category: 'offer' },
  offer_withdrawn: { label: '报价撤回', category: 'offer' },
  offer_expired: { label: '报价过期', category: 'offer' },
  offer_auto_accepted: { label: '自动接受', category: 'offer' },
  offer_auto_rejected: { label: '自动拒绝', category: 'offer' },
  offer_intent_created: { label: '议价意向', category: 'offer' },
  offer_intent_window_open: { label: '窗口开启', category: 'offer' },
  offer_intent_confirmed: { label: '议价确认', category: 'offer' },
  offer_intent_closed: { label: '议价关闭', category: 'offer' },
  activation_notice: { label: '激活通知', category: 'activation' },
  activation_reported: { label: '激活上报', category: 'activation' },
  activation_matched: { label: '激活匹配', category: 'activation' },
  activation_passed: { label: '激活未过', category: 'activation' },
  activation_match_expired: { label: '匹配过期', category: 'activation' },
  event_triggered: { label: '事件触发', category: 'event' },
  event_resolved: { label: '事件解决', category: 'event' },
  event_deadline: { label: '临近截止', category: 'event' },
  naming_mood: { label: '冠名情绪', category: 'naming' },
  naming_terminated: { label: '冠名终止', category: 'naming' },
  naming_champion: { label: '冠名夺冠', category: 'naming' },
  naming_offer: { label: '冠名报价', category: 'naming' },
  naming_offer_activated: { label: '冠名生效', category: 'naming' },
  shop_order_approved: { label: '工单通过', category: 'shop' },
  shop_order_rejected: { label: '工单驳回', category: 'shop' },
  window_signals: { label: '窗口信号', category: 'window' },
};

/** 未知模板 ⇒ null（前端退化：无修饰色徽章 + 原始模板名 + 不可点）。 */
export function categoryOf(template: string): NotifyCategoryId | null {
  return NOTIFY_META[template]?.category ?? null;
}

export function notifyCategory(id: string): NotifyCategory | null {
  return NOTIFY_CATEGORIES.find((c) => c.id === id) ?? null;
}

/** 某类目的全部模板（服务端 ?category= 过滤用，避免在 worker 里手抄第二份清单）。 */
export function templatesOf(id: NotifyCategoryId): string[] {
  return Object.keys(NOTIFY_META).filter((t) => NOTIFY_META[t].category === id);
}

export type NotifyRefType = 'offer' | 'player' | 'shop_order';

export interface NotifyRef {
  type: NotifyRefType;
  id: number;
}

function refId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * 从生成点 data 里抽跳转用的实体 ref（落库进 payload.ref，前端精确跳转用）。
 * 只认 UI 今天真能定位的三型：报价单 / 球员 / 商城工单——赛果、事件、命名、窗口
 * 没有可用实体页，刻意返 null（宁缺勿错：猜落点比不跳更糟）。
 */
export function notificationRefOf(template: string, data: Record<string, unknown>): NotifyRef | null {
  const meta = NOTIFY_META[template];
  if (!meta) return null;
  if (meta.category === 'offer') {
    const id = refId(data.offerId);
    return id === null ? null : { type: 'offer', id };
  }
  if (meta.category === 'growth' || meta.category === 'activation') {
    const id = refId(data.playerId);
    return id === null ? null : { type: 'player', id };
  }
  if (meta.category === 'shop') {
    const id = refId(data.orderId);
    return id === null ? null : { type: 'shop_order', id };
  }
  return null;
}
