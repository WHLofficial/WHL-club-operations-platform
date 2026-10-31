// 守卫：站内信模板 ↔ 徽章表双向相等（v6.40.0）。
// renderNotification 每加一个 case 就必须在 NOTIFY_META 补一枚徽章，反之亦然 ——
// 两侧任一漂移都当场红，避免「新模板在收件篮变成裸模板名」这类静默退化。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NOTIFY_CATEGORIES,
  NOTIFY_META,
  categoryOf,
  notificationRefOf,
  templatesOf,
  type NotifyCategoryId,
} from './notify-meta.ts';

// 只切 renderNotification 函数体：notify.ts 其它位置将来若有别的 switch，
// 不该被本守卫误抓（那种情况要改的是判据，不是徽章表）。
const NOTIFY_SRC = readFileSync('src/worker/notify.ts', 'utf8');
const RENDER_START = NOTIFY_SRC.indexOf('export function renderNotification(');
const RENDER_END = NOTIFY_SRC.indexOf('\nexport ', RENDER_START + 1);
const RENDER_BODY = NOTIFY_SRC.slice(RENDER_START, RENDER_END);

function renderTemplates(): string[] {
  return [...RENDER_BODY.matchAll(/case '([^']+)':/g)].map((m) => m[1]);
}

describe('NOTIFY_META 与 worker 模板表', () => {
  it('切片判据本身成立（renderNotification 与下一个 export 都找到了）', () => {
    expect(RENDER_START).toBeGreaterThan(0);
    expect(RENDER_END).toBeGreaterThan(RENDER_START);
  });

  it('模板集合双向相等（50 条，无重复）', () => {
    // 32→33 是 v6.49.0 到期引擎（offer_deadline 等三模板）；33→37 是 v6.50.0 海捞暗标段四模板；
    // 37→39 是 v6.53.0 场馆档期两模板（venue_window_open / venue_slot_reminder）；
    // 39→43 是 v6.54.0 闹涨薪四模板（demand_created / demand_deadline / demand_resolved /
    // demand_rejected_public，设计文档 §7）；43→44 是 v6.55.0 意向单落选通知（offer_intent_lost）；
    // 44→47 是 v6.58.0 候选名单跟踪三模板（shortlist_listed / sold / released）；
    // 47→50 是 v6.64.4 上调三模板（promotion_opened / reserved / forced）
    const templates = renderTemplates();
    expect(templates).toHaveLength(50);
    expect(new Set(templates).size).toBe(templates.length);
    expect(templates.slice().sort()).toEqual(Object.keys(NOTIFY_META).sort());
  });

  it('每条徽章文案非空、唯一、≤6 字', () => {
    const labels = Object.values(NOTIFY_META).map((m) => m.label);
    expect(labels).toHaveLength(50);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(6);
    }
  });

  it('八类类目齐全、配色类一一对应且真实存在于 styles.css', () => {
    expect(NOTIFY_CATEGORIES).toHaveLength(8);
    const ids = NOTIFY_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(8);
    const tones = NOTIFY_CATEGORIES.map((c) => c.tone);
    expect(new Set(tones).size).toBe(8);
    // 类目顺序与配色是产品决定：按字面量锁，换色 / 挪类目都要显式改这一行
    expect(ids).toEqual(['result', 'growth', 'offer', 'activation', 'event', 'naming', 'shop', 'window']);
    expect(tones).toEqual(['green', 'gold', 'blue', 'sky', 'orange', 'purple', 'red', 'gray']);
    const css = readFileSync('web/src/styles.css', 'utf8');
    for (const tone of tones) {
      expect(new RegExp(`\\.badge\\.${tone}\\s*\\{`).test(css), `styles.css 缺 .badge.${tone}`).toBe(true);
    }
  });

  it('类目成员表按字面量锁死（哪个模板归哪类，挪错即红）', () => {
    const expected: Record<string, string[]> = {
      result: ['result_confirmed'],
      growth: ['levelup'],
      offer: [
        'offer_received',
        'offer_countered',
        'offer_accepted',
        'offer_rejected',
        'offer_withdrawn',
        'offer_expired',
        'offer_auto_accepted',
        'offer_auto_rejected',
        'offer_intent_created',
        'offer_intent_window_open',
        'offer_intent_confirmed',
        'offer_intent_closed',
        // v6.55.0 意向单多笔并存：落选方（买方）的通知
        'offer_intent_lost',
        // v6.49.0 到期引擎：报价临近 / 谈判超时 / 谈判临近
        'offer_deadline',
        'negotiation_timeout',
        'negotiation_deadline',
        // v6.54.0 闹涨薪：要求生成 / 24h 截止提醒 / 终局回执 / 直拒档全联盟通告（合同谈判域归 offer）
        'demand_created',
        'demand_deadline',
        'demand_resolved',
        'demand_rejected_public',
      ],
      activation: [
        'activation_notice',
        'activation_reported',
        'activation_matched',
        'activation_passed',
        'activation_match_expired',
      ],
      event: ['event_triggered', 'event_resolved', 'event_deadline'],
      naming: ['naming_mood', 'naming_terminated', 'naming_champion', 'naming_offer', 'naming_offer_activated'],
      shop: ['shop_order_approved', 'shop_order_rejected'],
      // v6.50.0 海捞暗标段四模板归 window（海捞不是 offer 实体，notificationRefOf 取不到可跳转的 id）
      // v6.53.0 场馆档期两模板归 window（开窗通知 / 关窗前档位提醒，落点 /venue）
      window: [
        'window_signals',
        'sea_sealed_lead',
        'sea_sealed_lost',
        'sea_batch_open',
        'sea_sealed_deadline',
        'venue_window_open',
        'venue_slot_reminder',
        // v6.58.0 候选名单跟踪：挂牌 / 签走 / 解约（转会窗口域；notificationRefOf 特意给 player 深链）
        'shortlist_listed',
        'shortlist_sold',
        'shortlist_released',
        // v6.64.4 上调/下放：练满自动开 / 预约 / 窗关强约（转会窗口域）
        'promotion_opened',
        'promotion_reserved',
        'promotion_forced',
      ],
    };
    const members = Object.values(expected).flat();
    expect(members).toHaveLength(50);
    expect(new Set(members).size).toBe(50);
    for (const [cat, list] of Object.entries(expected)) {
      expect(templatesOf(cat as NotifyCategoryId).slice().sort(), `类目 ${cat} 的成员不符`).toEqual(list.slice().sort());
    }
  });

  it('每个模板都能定位到类目，且 templatesOf 与 categoryOf 互逆', () => {
    for (const template of Object.keys(NOTIFY_META)) {
      const cat = categoryOf(template);
      expect(cat).not.toBeNull();
      expect(templatesOf(cat!)).toContain(template);
    }
    expect(categoryOf('brand_new_template')).toBeNull();
  });
});

describe('notificationRefOf：只抽 UI 真能定位的三型', () => {
  it('报价类带 offerId ⇒ offer', () => {
    expect(notificationRefOf('offer_received', { offerId: 7 })).toEqual({ type: 'offer', id: 7 });
    expect(notificationRefOf('offer_intent_window_open', { offerId: 7 })).toEqual({ type: 'offer', id: 7 });
  });

  it('成长 / 激活类带 playerId ⇒ player', () => {
    expect(notificationRefOf('levelup', { player: '甲', playerId: 6 })).toEqual({ type: 'player', id: 6 });
    expect(notificationRefOf('activation_matched', { listingId: 3, playerId: 6 })).toEqual({
      type: 'player',
      id: 6,
    });
  });

  it('候选名单三模板带 playerId ⇒ player（window 类目的定向例外）', () => {
    expect(notificationRefOf('shortlist_listed', { playerId: 6 })).toEqual({ type: 'player', id: 6 });
    expect(notificationRefOf('shortlist_sold', { playerId: 6 })).toEqual({ type: 'player', id: 6 });
    expect(notificationRefOf('shortlist_released', { playerId: 6 })).toEqual({ type: 'player', id: 6 });
    expect(notificationRefOf('shortlist_listed', {})).toBeNull();
  });

  it('商城工单带 orderId ⇒ shop_order', () => {
    expect(notificationRefOf('shop_order_approved', { summary: 'x', orderId: 12 })).toEqual({
      type: 'shop_order',
      id: 12,
    });
  });

  it('无实体或字段缺失 ⇒ null（不造 ref）', () => {
    expect(notificationRefOf('event_triggered', { club: '甲', name: 'x' })).toBeNull();
    expect(notificationRefOf('naming_mood', { brand: 'b' })).toBeNull();
    expect(notificationRefOf('window_signals', { club: '甲' })).toBeNull();
    // v6.50.0 暗标四模板：即便带上 playerId 也不造 ref（窗类目没有可跳转实体，前端靠海捞页横幅定位）
    expect(notificationRefOf('sea_sealed_lead', { playerId: 6, amount: 3 })).toBeNull();
    expect(notificationRefOf('sea_sealed_lost', { playerId: 6 })).toBeNull();
    expect(notificationRefOf('sea_batch_open', { playerId: 6, won: 1 })).toBeNull();
    expect(notificationRefOf('sea_sealed_deadline', { deadline: '2026-10-20 20:00' })).toBeNull();
    expect(notificationRefOf('result_confirmed', { home: 'a' })).toBeNull();
    expect(notificationRefOf('offer_received', { player: '甲', amount: 3 })).toBeNull();
    expect(notificationRefOf('levelup', { player: '甲' })).toBeNull();
    expect(notificationRefOf('shop_order_rejected', { summary: 'x' })).toBeNull();
  });

  it('id 非正整数 ⇒ null', () => {
    expect(notificationRefOf('offer_received', { offerId: 0 })).toBeNull();
    expect(notificationRefOf('offer_received', { offerId: -1 })).toBeNull();
    expect(notificationRefOf('offer_received', { offerId: 1.5 })).toBeNull();
    expect(notificationRefOf('offer_received', { offerId: '7' })).toBeNull();
    expect(notificationRefOf('levelup', { playerId: null })).toBeNull();
  });

  it('未知模板 ⇒ null', () => {
    expect(notificationRefOf('brand_new_template', { offerId: 7 })).toBeNull();
  });
});
