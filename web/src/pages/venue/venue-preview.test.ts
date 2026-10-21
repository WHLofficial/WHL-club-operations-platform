// v6.53.0 场馆经营 P0：档期页的草稿纯函数层（不碰 DOM、不碰网络）。
// 这层的语义边界只有两条：预览要「全部槽」，保存只发「改动槽」；否则会出现
// 只改一槽却把别的槽按旧口径重算、或者一槽没改却被当成改动而卡住保存按钮。
import { describe, expect, it } from 'vitest';
import type { VenueSlotDto } from '../../lib/api.ts';
import * as preview from './venue-preview.ts';
import { diffDraft, draftToPicks, effectivePick, samePicks } from './venue-preview.ts';

function slot(slotNo: number, booked: string | null): VenueSlotDto {
  return { slotNo, saturation: 1, booked, quote: null, options: [] };
}

/** 三档：1 已排演唱会、2 空着、3 已排青训营 */
const SLOTS: VenueSlotDto[] = [slot(1, 'concert'), slot(2, null), slot(3, 'youth_camp')];

describe('v6.53.0 档期草稿：effectivePick / draftToPicks', () => {
  it('没写过的槽沿用已保存值，写过 null 的明确清空', () => {
    expect(effectivePick(SLOTS[0], {})).toBe('concert');
    expect(effectivePick(SLOTS[1], {})).toBe(null);
    expect(effectivePick(SLOTS[0], { 1: null })).toBe(null);
    expect(effectivePick(SLOTS[1], { 2: 'community' })).toBe('community');
  });

  it('select 的空字符串等同于「暂不排」', () => {
    expect(effectivePick(SLOTS[2], { 3: '' })).toBe(null);
  });

  it('draftToPicks 返回全部槽（按槽号升序），未改的还原成 slot.booked', () => {
    const picks = draftToPicks(SLOTS, { 2: 'community' });
    expect(picks).toEqual([
      { slotNo: 1, activity: 'concert' },
      { slotNo: 2, activity: 'community' },
      { slotNo: 3, activity: 'youth_camp' },
    ]);
  });

  it('draftToPicks 尊重显式清空', () => {
    expect(draftToPicks(SLOTS, { 1: null })).toEqual([
      { slotNo: 1, activity: null },
      { slotNo: 2, activity: null },
      { slotNo: 3, activity: 'youth_camp' },
    ]);
  });
});

describe('v6.53.0 档期草稿：diffDraft 只出改动槽', () => {
  it('只发真正改过的槽', () => {
    expect(diffDraft(SLOTS, { 2: 'community' })).toEqual([{ slotNo: 2, activity: 'community' }]);
    expect(diffDraft(SLOTS, { 1: null, 3: 'concert' })).toEqual([
      { slotNo: 1, activity: null },
      { slotNo: 3, activity: 'concert' },
    ]);
  });

  it('改成与已保存相同的值不算改动（否则保存按钮会被误点亮）', () => {
    expect(diffDraft(SLOTS, { 1: 'concert' })).toEqual([]);
    expect(diffDraft(SLOTS, {})).toEqual([]);
  });

  it('空槽写回 null 不算改动，已排槽选「暂不排」才是改动', () => {
    expect(diffDraft(SLOTS, { 2: null })).toEqual([]);
    expect(diffDraft(SLOTS, { 1: '' })).toEqual([{ slotNo: 1, activity: null }]);
  });
});

describe('v6.53.0 档期草稿：samePicks（方针卡「已按此排布」）', () => {
  const PICKS = [
    { slotNo: 1, activity: 'concert' },
    { slotNo: 2, activity: 'community' },
  ];

  it('草稿恰好等于该方针的排布 ⇒ true', () => {
    expect(samePicks({ 1: 'concert', 2: 'community' }, PICKS)).toBe(true);
  });

  it('恢复原值后仍算命中（顺序与写法无关）', () => {
    expect(samePicks({ 2: 'community', 1: 'concert' }, PICKS)).toBe(true);
  });

  it('草稿少写一槽 ⇒ false（只填了一半不是「已按此排布」）', () => {
    expect(samePicks({ 1: 'concert' }, PICKS)).toBe(false);
  });

  it('草稿里出现 picks 之外的活动 ⇒ false（方针 + 手改是混合方案）', () => {
    expect(samePicks({ 1: 'concert', 2: 'community', 3: 'friendly' }, PICKS)).toBe(false);
  });

  it('picks 为空时永不命中', () => {
    expect(samePicks({}, [])).toBe(false);
    expect(samePicks({ 1: 'concert' }, [])).toBe(false);
  });
});

describe('v6.53.0 档期草稿：页面不自己加总', () => {
  it('模块不再导出 composeTotals（合计一律取服务端口径）', () => {
    expect('composeTotals' in preview).toBe(false);
  });
});
