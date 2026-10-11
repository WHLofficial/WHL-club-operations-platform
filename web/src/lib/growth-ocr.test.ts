// v6.43.0 成长录入截图识别 · 前端合并纯函数测试。
// 测试计划：docs/test-plans/v6.43.0-growth-ocr.md（TC-FE）。
import { describe, expect, it } from 'vitest';
import { mergeOcrEntries, sideConcededOf, type OcrMergeRow } from './growth-ocr.ts';
import type { MatchOcrEntry } from './api.ts';

function row(playerId: number, over: Partial<OcrMergeRow> = {}): OcrMergeRow {
  return {
    playerId,
    position: null,
    trainee: false,
    appearance: { checked: false, locked: false },
    rating: { value: '', locked: false },
    cleanSheet: { checked: false, locked: false },
    duelsWon: { value: '', locked: false },
    saves: { value: '', locked: false },
    ...over,
  };
}

function entry(playerId: number, name: string, draft: MatchOcrEntry['draft']): MatchOcrEntry {
  return { playerId, name, position: null, draft, matched: 'official' };
}

describe('TC-FE 识别条目 → 行草稿合并', () => {
  it('TC-FE-01 正常合并写未锁定格子：评分转字符串、夺回球权永不写、原数组不动', () => {
    const original = [row(1), row(2, { position: 'GK' })];
    const snapshot = JSON.stringify(original);
    const res = mergeOcrEntries(original, [entry(1, '甲', { appearance: true, rating: 7.8, saves: 3 })], 4);
    expect(res.rows[0].appearance.checked).toBe(true);
    expect(res.rows[0].rating).toEqual({ value: '7.8', locked: false });
    expect(res.rows[0].saves).toEqual({ value: '3', locked: false });
    expect(res.rows[0].duelsWon.value).toBe(''); // 裁决：夺回球权不识别不预填
    expect(res.applied).toBe(3);
    expect(JSON.stringify(original)).toBe(snapshot); // 原数组不动
  });

  it('TC-FE-02 已录锁定的格子逐格跳过并给原因；训练营整行跳过', () => {
    const rows = [
      row(1, { rating: { value: '8.0', locked: true }, appearance: { checked: true, locked: true } }),
      row(2, { trainee: true }),
    ];
    const res = mergeOcrEntries(
      rows,
      [entry(1, '甲', { appearance: true, rating: 9 }), entry(2, '乙', { appearance: true, rating: 8 })],
      4,
    );
    expect(res.rows[0].rating.value).toBe('8.0'); // 锁定值不被覆盖
    expect(res.applied).toBe(0);
    expect(res.skipped).toContainEqual({ playerId: 1, name: '甲', reason: '出场、评分格已录入锁定' });
    expect(res.skipped).toContainEqual({ playerId: 2, name: '乙', reason: '训练营球员不按场次计' });
  });

  it('TC-FE-03 零封联动：失球 0 → 未锁门将自动勾并计数；失球>0 不动；已勾/已锁不重复计', () => {
    const gkFree = row(10, { position: 'GK' });
    const gkChecked = row(11, { position: 'GK', cleanSheet: { checked: true, locked: false } });
    const gkLocked = row(12, { position: 'GK', cleanSheet: { checked: false, locked: true } });
    const outfield = row(13, { position: 'ST' });

    const zero = mergeOcrEntries([gkFree, gkChecked, gkLocked, outfield], [], 0);
    expect(zero.cleanSheetSide).toBe(true);
    expect(zero.rows[0].cleanSheet.checked).toBe(true);
    expect(zero.rows[1].cleanSheet.checked).toBe(true);
    expect(zero.rows[2].cleanSheet.checked).toBe(false); // 锁定不动
    expect(zero.rows[3].cleanSheet.checked).toBe(false); // 外场不联动（防守球员认定靠手填夺回球权）
    expect(zero.gkAuto).toBe(1);

    const conceded = mergeOcrEntries([row(10, { position: 'GK' })], [], 2);
    expect(conceded.rows[0].cleanSheet.checked).toBe(false);
    expect(conceded.gkAuto).toBe(0);
    expect(conceded.cleanSheetSide).toBe(false);
  });

  it('TC-FE-04 sideConcededOf：主队失球 = 客队得分，反之亦然', () => {
    const match = { scoreHome: 2, scoreAway: 4 };
    expect(sideConcededOf(match, 'home')).toBe(4);
    expect(sideConcededOf(match, 'away')).toBe(2);
  });

  it('TC-FE-05 多选上传去重：第二张同值不重写、计 deduped、不出跳过', () => {
    const original = [row(1), row(2, { position: 'GK' })];
    const first = mergeOcrEntries(original, [entry(1, '甲', { appearance: true, rating: 7.8, saves: 3 })], 4);
    expect(first.applied).toBe(3);
    const second = mergeOcrEntries(first.rows, [entry(1, '甲', { appearance: true, rating: 7.8, saves: 3 })], 4);
    expect(second.applied).toBe(0);
    expect(second.deduped).toBe(3);
    expect(second.skipped).toEqual([]);
    expect(second.rows[0].rating.value).toBe('7.8'); // 值原样
    expect(second.rows[0].saves.value).toBe('3');
  });

  it('TC-FE-06 冲突保留先填值：异值出跳过并带双方值，新格照写', () => {
    const original = [row(1)];
    const first = mergeOcrEntries(original, [entry(1, '甲', { appearance: true, rating: 7.8 })], 4);
    const second = mergeOcrEntries(first.rows, [entry(1, '甲', { appearance: true, rating: 8.5, saves: 2 })], 4);
    expect(second.rows[0].rating.value).toBe('7.8'); // 先填的不被覆盖
    expect(second.applied).toBe(1); // saves 是新格照写
    expect(second.deduped).toBe(1); // appearance 同值去重
    expect(second.skipped).toContainEqual({
      playerId: 1,
      name: '甲',
      reason: '评分识别 8.5 与已填 7.8 冲突，保留已填值',
    });
  });
});
