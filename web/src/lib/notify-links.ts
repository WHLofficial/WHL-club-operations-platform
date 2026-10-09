// 站内信落点解析（v6.40.0）：ref 精确 → 类目固定落点 → null（不可点）。
// 纯函数，不读路由/不读身份——身份相关的降级（如访客看不到 venue 页签）由目标页自己兜底。
import { categoryOf, type NotifyRef } from '../../../src/core/notify-meta.ts';

/** 收件方确定为「发起方（买方）」的报价模板：单子在「我送出的」箱子里，其余默认「我收到的」。 */
const OUTBOX_OFFER_TEMPLATES = new Set(['offer_rejected', 'offer_auto_rejected']);

/** 议价类模板：走谈判桌页签，不放 box / offer（议价单不在报价箱列表里）。 */
const NEGO_TEMPLATES = new Set([
  'offer_intent_created',
  'offer_intent_window_open',
  'offer_intent_confirmed',
  'offer_intent_closed',
]);

export interface NotifyLinkItem {
  template: string;
  clubId: number | null;
  ref: NotifyRef | null;
}

/** 报价类的箱位（in 我收到的 / out 我送出的）。 */
export function offerBoxOf(template: string): 'in' | 'out' {
  return OUTBOX_OFFER_TEMPLATES.has(template) ? 'out' : 'in';
}

function offerListLink(template: string): string {
  const box = offerBoxOf(template);
  return `/market/desk?tab=offers&box=${box}`;
}

/**
 * 一条站内信点下去该去哪；null = 没有可靠落点（行渲染为不可点）。
 * 需要 clubId 的类目（赛果/事件/窗口/命名）在 item 没带 clubId 时返 null——宁不可点，不猜队。
 */
export function notificationLink(item: NotifyLinkItem): string | null {
  const { template, clubId, ref } = item;
  const cat = categoryOf(template);
  if (!cat) return null; // 未知模板：前端不认，不可点（徽章也只显示原文）

  if (ref) {
    switch (ref.type) {
      case 'player':
        return `/players/${ref.id}`;
      case 'shop_order':
        return `/shop?order=${ref.id}`;
      case 'offer':
        return NEGO_TEMPLATES.has(template)
          ? '/market/desk?tab=nego'
          : `${offerListLink(template)}&offer=${ref.id}`;
    }
  }

  switch (cat) {
    case 'offer':
      return NEGO_TEMPLATES.has(template) ? '/market/desk?tab=nego' : offerListLink(template);
    case 'shop':
      return '/shop';
    case 'growth':
      return '/club'; // 新信带 playerId 时上面已走 /players/:id
    case 'activation':
      return '/market/activation';
    case 'result':
      return clubId !== null ? `/clubs/${clubId}?tab=results` : null;
    case 'event':
    case 'window':
      return clubId !== null ? `/clubs/${clubId}?tab=desk` : null;
    case 'naming':
      // 冠名页签对访客不可见时由俱乐部页自己退回默认页签
      return clubId !== null ? `/clubs/${clubId}?tab=venue` : null;
  }
}
