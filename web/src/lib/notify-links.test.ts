// 落点解析矩阵（v6.40.0）：30 个模板逐条断言 + 箱位规则 + 健壮性（TC-LINK-01–04）
import { describe, expect, it } from 'vitest';
import { NOTIFY_META, type NotifyRef } from '../../../src/core/notify-meta.ts';
import { notificationLink, offerBoxOf } from './notify-links.ts';

const player: NotifyRef = { type: 'player', id: 6 };
const order: NotifyRef = { type: 'shop_order', id: 12 };
const offer = (id = 7): NotifyRef => ({ type: 'offer', id });

describe('notificationLink：ref 精确落点', () => {
  it('报价单：有 ref 时把 offer 参数带上，箱位按模板定（TC-LINK-01）', () => {
    expect(notificationLink({ template: 'offer_received', clubId: 5, ref: offer() })).toBe(
      '/market/desk?tab=offers&box=in&offer=7',
    );
    expect(notificationLink({ template: 'offer_countered', clubId: 5, ref: offer(31) })).toBe(
      '/market/desk?tab=offers&box=in&offer=31',
    );
    expect(notificationLink({ template: 'offer_accepted', clubId: 5, ref: offer(42) })).toBe(
      '/market/desk?tab=offers&box=in&offer=42',
    );
    // 收件方确定为买方（发起方）的两枚：单子在我「送出的」箱里
    expect(notificationLink({ template: 'offer_rejected', clubId: 5, ref: offer() })).toBe(
      '/market/desk?tab=offers&box=out&offer=7',
    );
    expect(notificationLink({ template: 'offer_auto_rejected', clubId: 5, ref: offer() })).toBe(
      '/market/desk?tab=offers&box=out&offer=7',
    );
    // 双收件方/卖方收件的：走 in（错箱只是少一次点击）
    expect(notificationLink({ template: 'offer_expired', clubId: 5, ref: offer() })).toBe(
      '/market/desk?tab=offers&box=in&offer=7',
    );
    expect(notificationLink({ template: 'offer_withdrawn', clubId: 5, ref: offer() })).toBe(
      '/market/desk?tab=offers&box=in&offer=7',
    );
  });

  it('议价四枚：即使带 ref 也去谈判桌页签，不带 box/offer', () => {
    for (const t of ['offer_intent_created', 'offer_intent_window_open', 'offer_intent_confirmed', 'offer_intent_closed']) {
      expect(notificationLink({ template: t, clubId: 5, ref: offer() })).toBe('/market/desk?tab=nego');
    }
  });

  it('球员 ref 与工单 ref：落到实体页（球员页 / 商城工单展开）', () => {
    expect(notificationLink({ template: 'levelup', clubId: 5, ref: player })).toBe('/players/6');
    expect(notificationLink({ template: 'activation_notice', clubId: 5, ref: player })).toBe('/players/6');
    expect(notificationLink({ template: 'activation_matched', clubId: 5, ref: player })).toBe('/players/6');
    expect(notificationLink({ template: 'shop_order_approved', clubId: 5, ref: order })).toBe('/shop?order=12');
    expect(notificationLink({ template: 'shop_order_rejected', clubId: 5, ref: order })).toBe('/shop?order=12');
  });
});

describe('notificationLink：类目固定落点（无 ref）', () => {
  it('商城 / 成长 / 激活 / 报价（TC-LINK-02）', () => {
    expect(notificationLink({ template: 'shop_order_approved', clubId: 5, ref: null })).toBe('/shop');
    expect(notificationLink({ template: 'levelup', clubId: 5, ref: null })).toBe('/club');
    expect(notificationLink({ template: 'activation_passed', clubId: 5, ref: null })).toBe('/market/activation');
    expect(notificationLink({ template: 'activation_reported', clubId: 5, ref: null })).toBe('/market/activation');
    expect(notificationLink({ template: 'offer_received', clubId: 5, ref: null })).toBe('/market/desk?tab=offers&box=in');
    expect(notificationLink({ template: 'offer_rejected', clubId: 5, ref: null })).toBe('/market/desk?tab=offers&box=out');
    expect(notificationLink({ template: 'offer_intent_closed', clubId: 5, ref: null })).toBe('/market/desk?tab=nego');
  });

  it('需要 clubId 的四类：有 clubId 给实体页签，没 clubId 返 null（TC-LINK-03）', () => {
    for (const [t, tab] of [
      ['result_confirmed', 'results'],
      ['event_triggered', 'desk'],
      ['event_resolved', 'desk'],
      ['event_deadline', 'desk'],
      ['window_signals', 'desk'],
      ['naming_mood', 'venue'],
      ['naming_terminated', 'venue'],
      ['naming_champion', 'venue'],
      ['naming_offer', 'venue'],
      ['naming_offer_activated', 'venue'],
    ] as const) {
      expect(notificationLink({ template: t, clubId: 7, ref: null })).toBe(`/clubs/7?tab=${tab}`);
      expect(notificationLink({ template: t, clubId: null, ref: null })).toBeNull();
    }
  });

  it('ref 存在也不依赖 clubId 的三型（offer/player/shop_order）', () => {
    expect(notificationLink({ template: 'offer_received', clubId: null, ref: offer() })).toBe(
      '/market/desk?tab=offers&box=in&offer=7',
    );
    expect(notificationLink({ template: 'levelup', clubId: null, ref: player })).toBe('/players/6');
    expect(notificationLink({ template: 'shop_order_approved', clubId: null, ref: order })).toBe('/shop?order=12');
  });
});

describe('notificationLink：健壮性与全覆盖', () => {
  it('未知模板恒 null（徽章也只显示原文）（TC-LINK-04）', () => {
    expect(notificationLink({ template: 'legacy_unknown', clubId: 5, ref: null })).toBeNull();
    expect(notificationLink({ template: 'legacy_unknown', clubId: 5, ref: offer() })).toBeNull();
  });

  it('异常 ref 不抛错：类型不认识 ⇒ 退类目落点', () => {
    const weird = { type: 'listing', id: 3 } as unknown as NotifyRef;
    expect(notificationLink({ template: 'offer_received', clubId: 5, ref: weird })).toBe('/market/desk?tab=offers&box=in');
    expect(notificationLink({ template: 'result_confirmed', clubId: 5, ref: weird })).toBe('/clubs/5?tab=results');
    expect(notificationLink({ template: 'result_confirmed', clubId: null, ref: weird })).toBeNull();
  });

  it('三十个模板逐条有确定落点：八个类目各自兜底，无一为 undefined', () => {
    const seen = new Set<string>();
    for (const [template, meta] of Object.entries(NOTIFY_META)) {
      const linked = notificationLink({ template, clubId: 9, ref: null });
      expect(typeof linked, `${template} 应有 string|null`).toBe('string');
      expect(linked!.length).toBeGreaterThan(0);
      seen.add(meta.category);
    }
    expect([...seen].sort()).toEqual(['activation', 'event', 'growth', 'naming', 'offer', 'result', 'shop', 'window']);
  });

  it('offerBoxOf 只认两枚「买方单收」模板', () => {
    expect(offerBoxOf('offer_rejected')).toBe('out');
    expect(offerBoxOf('offer_auto_rejected')).toBe('out');
    expect(offerBoxOf('offer_received')).toBe('in');
    expect(offerBoxOf('offer_expired')).toBe('in');
    expect(offerBoxOf('result_confirmed')).toBe('in');
  });
});
