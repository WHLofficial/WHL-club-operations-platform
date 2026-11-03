// 转会台按球员聚合（v6.72.0 期 A）：纯函数，三个页签共用。
// 组件只负责渲染；分组、选「当前单」、徽标、主按钮文案都从这里出。
// 期 A 不 import TransferPanelResponse（期 C 才有），球员页动作矩阵到期 C 再收口。
import type { MyBidRow, NegotiationSession, OfferListItem } from '../../../lib/api.ts';
import { bidBadge, isActiveListing, negoBadge, offerBadge, type Badge } from './status.ts';

export interface RowAction {
  label: string;
  disabled?: boolean;
  reason?: string;
}

export interface BidPlayerRow {
  player: MyBidRow['player'];
  /** 当前挂牌上的最新一笔出价 */
  current: MyBidRow;
  /** 该球员全部出价（新→旧），用于行内历史 */
  bids: MyBidRow[];
  currentListingId: number;
  /** 我在当前挂牌上的最新出价 */
  amount: number;
  /** 我在当前挂牌上的出价笔数 */
  bidCount: number;
  badge: Badge;
  action: RowAction;
}

export interface OfferPlayerRow {
  player: OfferListItem['player'];
  current: OfferListItem;
  /** 同一 box 内该球员全部报价（新→旧），用于行内历史 */
  offers: OfferListItem[];
  amount: number;
  badge: Badge;
  action: RowAction;
}

export interface NegoPlayerRow {
  player: NegotiationSession['player'];
  current: NegotiationSession;
  /** 当前会话；已结束的会话不放进球员行（页尾总折叠负责） */
  history: NegotiationSession[];
  badge: Badge;
  action: RowAction;
}

function newestFirst<T extends { id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.id - a.id);
}

/**
 * 出价：按球员分组；当前单优先取仍在流程内的挂牌，都已结束则取最新一笔所在挂牌。
 * 行金额只取当前单最新一笔，避免把不同挂牌的历史混成一个数。
 */
export function groupBidsByPlayer(bids: MyBidRow[]): BidPlayerRow[] {
  const groups = new Map<number, MyBidRow[]>();
  for (const b of newestFirst(bids)) {
    const list = groups.get(b.player.id);
    if (list) list.push(b);
    else groups.set(b.player.id, [b]);
  }

  const rows: BidPlayerRow[] = [];
  for (const group of groups.values()) {
    const currentListingBid = group.find((b) => isActiveListing(b.listingStatus)) ?? group[0];
    const currentBids = group.filter((b) => b.listingId === currentListingBid.listingId);
    const current = currentBids[0];
    const row: BidPlayerRow = {
      player: current.player,
      current,
      bids: group,
      currentListingId: current.listingId,
      amount: current.amount,
      bidCount: currentBids.length,
      badge: bidBadge(current),
      action: { label: '' },
    };
    row.action = bidActionOf(row);
    rows.push(row);
  }
  return rows;
}

/** 期 A 的桌行动作：只给「加价/查看」两态；能不能出价由行展开后的挂牌详情再判 */
export function bidActionOf(row: BidPlayerRow): RowAction {
  const b = row.current;
  if (b.status === 'superseded' && isActiveListing(b.listingStatus)) return { label: '加价' };
  return { label: b.status === 'active' ? '查看详情' : '查看记录' };
}

/**
 * 报价：只在同一个 box 内分组（调用方一次只传一边）；当前单优先级
 * pending && myTurn > pending > intent > 最新 updatedAt。
 */
export function groupOffersByPlayer(items: OfferListItem[]): OfferPlayerRow[] {
  const groups = new Map<number, OfferListItem[]>();
  for (const o of items) {
    const list = groups.get(o.player.id);
    if (list) list.push(o);
    else groups.set(o.player.id, [o]);
  }

  const rank = (o: OfferListItem): number => {
    if (o.status === 'pending' && o.myTurn) return 0;
    if (o.status === 'pending') return 1;
    if (o.status === 'intent') return 2;
    return 3;
  };
  const currentFirst = (a: OfferListItem, b: OfferListItem): number =>
    rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id;
  const historyFirst = (a: OfferListItem, b: OfferListItem): number =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id;

  const rows: OfferPlayerRow[] = [];
  for (const group of groups.values()) {
    const byCurrent = [...group].sort(currentFirst);
    const current = byCurrent[0];
    const row: OfferPlayerRow = {
      player: current.player,
      current,
      offers: [...group].sort(historyFirst),
      amount: current.amount,
      badge: offerBadge(current),
      action: { label: '' },
    };
    row.action = offerActionOf(row);
    rows.push(row);
  }
  // 行顺序也按当前单优先级：有待回应的球员排前面
  return rows.sort((a, b) => currentFirst(a.current, b.current));
}

export function offerActionOf(row: OfferPlayerRow): RowAction {
  const o = row.current;
  if (o.status === 'pending' && o.myTurn) return { label: '回应' };
  if (o.status === 'pending' || o.status === 'intent') return { label: '查看' };
  return { label: '查看记录' };
}

/**
 * 谈判：按球员分组；当前 = active（没有则最新已结束）。
 * 行内只放当前会话，已结束不塞进球员行——页尾「已结束的谈判 · N 场」统一折叠。
 */
export function groupNegotiationsByPlayer(sessions: NegotiationSession[]): NegoPlayerRow[] {
  const groups = new Map<number, NegotiationSession[]>();
  for (const s of newestFirst(sessions)) {
    const list = groups.get(s.player.id);
    if (list) list.push(s);
    else groups.set(s.player.id, [s]);
  }

  const rows: NegoPlayerRow[] = [];
  for (const group of groups.values()) {
    const current = group.find((s) => s.status === 'active') ?? group[0];
    const row: NegoPlayerRow = {
      player: current.player,
      current,
      history: current.status === 'active' ? group.filter((s) => s.status === 'active') : [current],
      badge: negoBadge(current),
      action: { label: '' },
    };
    row.action = negoActionOf(row);
    rows.push(row);
  }
  return rows;
}

export function negoActionOf(row: NegoPlayerRow): RowAction {
  return row.current.status === 'active' ? { label: '继续谈判' } : { label: '查看' };
}
