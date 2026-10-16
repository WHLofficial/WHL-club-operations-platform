// v6.43.0 成长录入截图识别 · 前端合并纯函数测试。
// 测试计划：docs/test-plans/v6.43.0-growth-ocr.md（TC-FE）。
import { describe, expect, it } from 'vitest';
import { mergeOcrEntries, sideConcededOf, type OcrMergeRow } from './growth-ocr.ts';
import type { MatchOcrEntry } from './api.ts';

function row(playerId: number, over: Partial<OcrMergeRow> = {}): OcrMergeRow {
  return {
    playerId,
    position: null,
    suspended: null,
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

  it('TC-FE-02 已录锁定的格子逐格跳过并给原因；停赛整行跳过（训练营不再跳过）', () => {
    const rows = [
      row(1, { rating: { value: '8.0', locked: true }, appearance: { checked: true, locked: true } }),
      row(2, { suspended: { reason: 'red', total: 2, serving: 1 } }),
      row(3), // 训练营球员 v6.45.0 起照常预填
    ];
    const res = mergeOcrEntries(
      rows,
      [entry(1, '甲', { appearance: true, rating: 9 }), entry(2, '乙', { appearance: true, rating: 8 }), entry(3, '丙', { appearance: true, rating: 8 })],
      4,
    );
    expect(res.rows[0].rating.value).toBe('8.0'); // 锁定值不被覆盖
    expect(res.applied).toBe(2); // 只写丙的出场 + 评分
    expect(res.skipped).toContainEqual({ playerId: 1, name: '甲', reason: '出场、评分格已录入锁定' });
    expect(res.skipped).toContainEqual({ playerId: 2, name: '乙', reason: '本场停赛' });
    expect(res.rows[2].appearance.checked).toBe(true);
  });

  it('TC-FE-03 v6.51.7 零封联动只看图里的门将：图里识别到且失球 0 ⇒ 勾；没出现在图里/已勾/已锁/停赛都不动', () => {
    const rows = [
      row(10, { position: 'GK' }), // 这张图识别到 ⇒ 勾
      row(11, { position: 'GK' }), // 替补门将：没出现在图里 ⇒ 不猜（v6.51.7 收口）
      row(12, { position: 'GK', cleanSheet: { checked: true, locked: false } }), // 已勾不重复计
      row(13, { position: 'GK', cleanSheet: { checked: false, locked: true } }), // 已录锁定不动
      row(14, { position: 'GK', suspended: { reason: 'red', total: 2, serving: 1 } }),
      row(15, { position: 'ST' }),
    ];
    const entries = [
      entry(10, '甲', { appearance: true, rating: 5.1 }),
      entry(12, '丙', { appearance: true, rating: 6 }),
      entry(13, '丁', { appearance: true, rating: 5 }),
      entry(14, '戊', { appearance: true, rating: 4 }),
      entry(15, '己', { appearance: true, rating: 7 }),
    ];

    const zero = mergeOcrEntries(rows, entries, 0);
    expect(zero.cleanSheetSide).toBe(true);
    expect(zero.rows[0].cleanSheet.checked).toBe(true);
    expect(zero.rows[1].cleanSheet.checked).toBe(false); // 替补门将不猜
    expect(zero.rows[2].cleanSheet.checked).toBe(true);
    expect(zero.rows[3].cleanSheet.checked).toBe(false); // 锁定不动
    expect(zero.rows[4].cleanSheet.checked).toBe(false); // 停赛不动
    expect(zero.rows[5].cleanSheet.checked).toBe(false); // 外场不联动（防守球员认定靠手填夺回球权）
    expect(zero.gkAuto).toBe(1); // 只数新勾的 10

    const conceded = mergeOcrEntries(
      [row(10, { position: 'GK' })],
      [entry(10, '甲', { appearance: true, rating: 5.1 })],
      2,
    );
    expect(conceded.rows[0].cleanSheet.checked).toBe(false); // 失球>0 不动
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

  it('TC-FE-07 v6.46.0 非 XP 场次（allowCounters=false）：出场与评分照预填，零封/扑救不预填也不联动', () => {
    // 冠军杯淘汰赛/超级杯/资格赛只收出场与评分（纯 XP 计数器写进去服务端整批 400）
    const rows = [row(1, { position: 'GK' }), row(2)];
    const res = mergeOcrEntries(
      rows,
      [
        entry(1, '甲', { appearance: true, rating: 6.4, saves: 5, cleanSheet: true }),
        entry(2, '乙', { appearance: true, rating: 7.9 }),
      ],
      0, // 本侧失球 0：正常场次会联动门将勾零封，这里必须不联动
      false,
    );
    expect(res.rows[0].appearance.checked).toBe(true); // 出场照预填
    expect(res.rows[0].rating.value).toBe('6.4'); // 差评照预填（v6.46.0 起 0–10 全收）
    expect(res.rows[0].saves.value).toBe(''); // 扑救不预填
    expect(res.rows[0].cleanSheet.checked).toBe(false); // 零封不预填
    expect(res.rows[1].appearance.checked).toBe(true);
    expect(res.rows[1].rating.value).toBe('7.9');
    expect(res.gkAuto).toBe(0); // 门将零封联动停用（cleanSheetSide 只是「本侧失球 0」的描述，不受开关影响）
    expect(res.skipped).toContainEqual({
      playerId: 1,
      name: '甲',
      reason: '本场不计成长 XP，零封与扑救不预填',
    });
  });
});
