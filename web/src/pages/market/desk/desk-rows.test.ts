// 期 A 聚合纯函数：同球员多笔/多单只出一行，当前单与动作口径锁在这里。
import { describe, expect, it } from 'vitest';
import type { MyBidRow, NegotiationSession, OfferListItem } from '../../../lib/api.ts';
import { groupBidsByPlayer, groupNegotiationsByPlayer, groupOffersByPlayer } from './desk-rows.ts';

function bid(patch: Partial<MyBidRow> = {}): MyBidRow {
  return {
    id: 1,
    listingId: 10,
    amount: 5,
    createdAt: '2026-09-20T09:00:00Z',
    status: 'active',
    holdStatus: 'held',
    listingStatus: 'bidding',
    askPrice: 4,
    player: { id: 1, fcId: 100001, name: '球员甲', position: 'ST', ca: 55, pa: 70 },
    sellerClubName: '乙队',
    ...patch,
  };
}

function offer(patch: Partial<OfferListItem> = {}): OfferListItem {
  return {
    id: 5,
    player: { id: 1, fcId: 100001, name: '球员甲', position: 'ST', ca: 55, pa: 70, listPrice: 15 },
    counterpart: { id: 3, name: '对方俱乐部' },
    role: 'seller',
    amount: 12,
    initAmount: 10,
    round: 2,
    note: null,
    status: 'pending',
    turn: 'seller',
    myTurn: false,
    listingId: null,
    createdAt: '2026-09-20T09:00:00Z',
    updatedAt: '2026-09-21T09:00:00Z',
    ...patch,
  };
}

function nego(patch: Partial<NegotiationSession> = {}): NegotiationSession {
  return {
    id: 21,
    transferId: 31,
    status: 'active',
    transfer: { type: 'transfer', status: 'pending_review', fee: 12.5 },
    fromClubName: '甲队',
    toClubName: '乙队',
    player: { id: 1, fcId: 100001, name: '球员甲', position: 'CM', age: 24, ca: 74, pa: 82 },
    agentTier: 2,
    agentTierLabel: '二级经纪人',
    releaseFee: 9,
    rcBounds: [4, 8],
    expectedWage: 5.5,
    attemptsUsed: 1,
    remaining: 2,
    expiresAt: null,
    lastSatisfaction: null,
    lastRisk: false,
    attempts: [],
    settled: null,
    endedAt: null,
    outcome: null,
    voidReason: null,
    ...patch,
  };
}

describe('groupBidsByPlayer', () => {
  it('同球员同挂牌 3 笔出价 → 1 行，历史 3 条，金额取最新一笔', () => {
    const rows = groupBidsByPlayer([
      bid({ id: 1, amount: 5, status: 'superseded' }),
      bid({ id: 2, amount: 7, status: 'superseded' }),
      bid({ id: 3, amount: 9, status: 'active' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].current.id).toBe(3);
    expect(rows[0].amount).toBe(9);
    expect(rows[0].bidCount).toBe(3);
    expect(rows[0].bids.map((b) => b.id)).toEqual([3, 2, 1]);
    expect(rows[0].badge.label).toBe('领先中');
    expect(rows[0].action.label).toBe('查看详情');
  });

  it('同球员两个挂牌：当前单优先取仍在流程内的，即使旧单更新', () => {
    const rows = groupBidsByPlayer([
      bid({ id: 1, listingId: 10, listingStatus: 'bidding', amount: 8, status: 'superseded' }),
      bid({ id: 2, listingId: 11, listingStatus: 'delisted', amount: 12, status: 'superseded' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].currentListingId).toBe(10);
    expect(rows[0].amount).toBe(8);
    expect(rows[0].bidCount).toBe(1);
    expect(rows[0].bids).toHaveLength(2);
    expect(rows[0].action.label).toBe('加价');
  });

  it('全部挂牌已结束：取最新一笔，徽标不再写「被超出」', () => {
    const rows = groupBidsByPlayer([
      bid({ id: 1, listingId: 10, listingStatus: 'delisted', status: 'superseded' }),
      bid({ id: 2, listingId: 11, listingStatus: 'delisted', status: 'won' }),
    ]);
    expect(rows[0].current.id).toBe(2);
    expect(rows[0].badge.label).toBe('已中标');
    expect(rows[0].action.label).toBe('查看记录');
  });

  it('待审核的成交单独占紫色徽标', () => {
    const rows = groupBidsByPlayer([bid({ status: 'won', listingStatus: 'pending_review' })]);
    expect(rows[0].badge.label).toBe('待审核');
    expect(rows[0].badge.cls).toBe('purple');
  });
});

describe('groupOffersByPlayer', () => {
  it('同球员同 box 两条报价 → 1 行；轮到我回应的排最前', () => {
    const rows = groupOffersByPlayer([
      offer({ id: 1, status: 'pending', myTurn: false, updatedAt: '2026-09-22T09:00:00Z' }),
      offer({ id: 2, status: 'pending', myTurn: true, updatedAt: '2026-09-21T09:00:00Z' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].current.id).toBe(2);
    expect(rows[0].amount).toBe(12);
    expect(rows[0].action.label).toBe('回应');
    expect(rows[0].offers.map((o) => o.id)).toEqual([1, 2]);
  });

  it('pending 优先于 intent，即使 intent 更新', () => {
    const rows = groupOffersByPlayer([
      offer({ id: 1, status: 'intent', updatedAt: '2026-09-25T09:00:00Z' }),
      offer({ id: 2, status: 'pending', myTurn: false, updatedAt: '2026-09-20T09:00:00Z' }),
    ]);
    expect(rows[0].current.id).toBe(2);
    expect(rows[0].action.label).toBe('查看');
  });

  it('已了结的单只出「查看记录」', () => {
    const rows = groupOffersByPlayer([offer({ status: 'accepted' })]);
    expect(rows[0].badge.label).toBe('已接受·挂牌竞价中');
    expect(rows[0].action.label).toBe('查看记录');
  });
});

describe('groupNegotiationsByPlayer', () => {
  it('active + ended 同球员 → 1 行，当前 active，已结束不进行内', () => {
    const rows = groupNegotiationsByPlayer([
      nego({ id: 22, status: 'settled', endedAt: '2026-09-20T00:00:00Z', outcome: 'signed' }),
      nego({ id: 21, status: 'active' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].current.id).toBe(21);
    expect(rows[0].history.map((s) => s.id)).toEqual([21]);
    expect(rows[0].action.label).toBe('继续谈判');
  });

  it('没有 active 时当前取最新已结束，行内只有这一条', () => {
    const rows = groupNegotiationsByPlayer([
      nego({ id: 22, status: 'cancelled', endedAt: '2026-09-21T00:00:00Z', outcome: 'void' }),
      nego({ id: 21, status: 'settled', endedAt: '2026-09-20T00:00:00Z', outcome: 'signed' }),
    ]);
    expect(rows[0].current.id).toBe(22);
    expect(rows[0].history).toHaveLength(1);
    expect(rows[0].badge.label).toBe('已作废');
    expect(rows[0].action.label).toBe('查看');
  });

  it('强制拍卖预填 RC、工资未确认 → 徽标「定违约金」', () => {
    const rows = groupNegotiationsByPlayer([
      nego({ transfer: { type: 'forced_auction', status: 'completed', fee: 15 }, releaseFee: 15, expectedWage: null, rcBounds: null }),
    ]);
    expect(rows[0].badge.label).toBe('定违约金');
  });

  it('工资谈判中带剩余轮数', () => {
    const rows = groupNegotiationsByPlayer([nego({ releaseFee: 9, remaining: 2 })]);
    expect(rows[0].badge.label).toBe('工资谈判 · 剩 2 轮');
  });
});
