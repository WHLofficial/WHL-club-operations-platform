// v6.43.0 成长录入截图识别 · core 纯函数测试（解析 / 认人 / 草稿 / 交叉校验）。
// 测试计划：docs/test-plans/v6.43.0-growth-ocr.md（TC-OCR / TC-MATCH / TC-DRAFT / TC-XCHK）。
import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../src/lib/llm.ts';
import {
  buildOcrEntries,
  matchRosterPlayer,
  ocrCrossChecks,
  parseOcrVision,
  type OcrRosterPlayer,
  type OcrVision,
} from '../src/core/growth-ocr.ts';

// 花名册：覆盖四层阶梯 + 两类歧义（同 official 同名、归一化后撞名）
const roster: OcrRosterPlayer[] = [
  { id: 10, officialName: 'K. Zhang', displayName: '张三', position: 'GK' },
  { id: 11, officialName: 'L. Li', displayName: 'L. Li', position: 'ST' },
  { id: 12, officialName: 'M. Wáng', displayName: 'M. Wáng', position: 'CM' }, // 带重音，归一化后才命中
  { id: 13, officialName: 'O. Sun', displayName: 'P. Wü', position: 'CM' }, // 官方名认不出、显示名归一化命中
  { id: 15, officialName: 'A. Ha', displayName: 'A. Ha', position: 'LB' },
  { id: 16, officialName: 'A. Ha', displayName: 'A. Ha #2', position: 'RB' }, // 与 15 同 official 名 → 歧义
  { id: 17, officialName: 'B. Ho', displayName: 'B. Ho', position: 'CB' },
  { id: 18, officialName: 'B. Hó', displayName: 'B. Hó', position: 'CB' }, // 与 17 归一化后撞名
];

const summaryRaw = {
  team: '海港联',
  tab: 'Summary',
  rows: [
    { pos: 'GK', name: 'K. Zhang', rating: '5.1', goals: 0, assists: 0 },
    { pos: 'ST', name: 'L. Li', rating: '9.2', goals: 2, assists: 1 },
    { pos: 'SUB', name: 'X. Bench', rating: 'N/A', goals: 0, assists: 0 },
  ],
  selected: { name: 'L. Li', rating: '9.2', goals: 2, assists: 1, possessionWon: 3, minutes: 94 },
  gk: null,
  notes: '',
};

const gkRaw = {
  team: '海港联',
  tab: 'Goalkeeping',
  rows: [{ pos: 'GK', name: 'K. Zhang', rating: '5.1', goals: 0, assists: 0 }],
  selected: null,
  gk: { name: 'K. Zhang', gkRating: '4.0', shotsAgainst: 10, shotsOnTarget: 7, saves: 3, goalsConceded: 4 },
};

describe('TC-OCR 识别回包解析', () => {
  it('TC-OCR-01 合法 summary：数字字符串收数字、N/A 收 null、页签归一小写', () => {
    const { ocr, errors } = parseOcrVision(summaryRaw);
    expect(errors).toEqual([]);
    expect(ocr).not.toBeNull();
    expect(ocr!.tab).toBe('summary');
    expect(ocr!.team).toBe('海港联');
    expect(ocr!.rows).toHaveLength(3);
    expect(ocr!.rows[0]).toMatchObject({ pos: 'GK', name: 'K. Zhang', rating: 5.1, goals: 0 });
    expect(ocr!.rows[1]).toMatchObject({ name: 'L. Li', rating: 9.2, goals: 2, assists: 1 });
    expect(ocr!.rows[2]).toMatchObject({ name: 'X. Bench', rating: null });
    expect(ocr!.selected).toMatchObject({ name: 'L. Li', rating: 9.2, possessionWon: 3, minutes: 94 });
    expect(ocr!.gk).toBeNull();
  });

  it('TC-OCR-02 答非所问：非对象回包收敛为 ocr=null + errors，不抛', () => {
    for (const garbage of ['我不能输出 JSON', 42, null, ['not', 'an', 'object']]) {
      const { ocr, errors } = parseOcrVision(garbage);
      expect(ocr).toBeNull();
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('TC-OCR-03 字段钳制：评分越界丢值、负数次数钳 0、数字字符串收整数', () => {
    const { ocr } = parseOcrVision({
      tab: 'summary',
      rows: [
        { pos: 'ST', name: '甲', rating: 12.5, goals: -3, assists: '7' },
        { pos: 'ST', name: '乙', rating: -1, goals: 2.4, assists: true },
      ],
    });
    expect(ocr!.rows[0]).toMatchObject({ rating: null, goals: 0, assists: 7 });
    expect(ocr!.rows[1]).toMatchObject({ rating: null, goals: 2, assists: 0 });
  });

  it('TC-OCR-04 坏行丢弃留痕：非对象行 / 无名行丢，rows 非数组报错，好行存活', () => {
    const { ocr, errors } = parseOcrVision({
      tab: 'summary',
      rows: [null, { pos: 'ST', rating: 8 }, 'x', { pos: 'LB', name: '好行', rating: '7.0', goals: 0, assists: 0 }],
    });
    expect(ocr!.rows).toHaveLength(1);
    expect(ocr!.rows[0].name).toBe('好行');
    expect(errors).toHaveLength(3);
  });

  it('TC-OCR-02b extractJsonObject：围栏 + 前后闲话里捞 JSON；捞不出回 null', () => {
    const fenced = '好的，结果如下：\n```json\n' + JSON.stringify(summaryRaw) + '\n```\n以上就是全部内容。';
    expect(extractJsonObject(fenced)).toEqual(summaryRaw);
    expect(extractJsonObject('绝对没有对象')).toBeNull();
  });
});

describe('TC-MATCH 花名册认人阶梯', () => {
  it('TC-MATCH-01 四层阶梯逐层命中且标注层级', () => {
    expect(matchRosterPlayer('L. Li', roster)).toEqual({ player: roster[1], matched: 'official' });
    expect(matchRosterPlayer('M. Wang', roster)).toEqual({ player: roster[2], matched: 'official-folded' }); // é 去重音后命中
    expect(matchRosterPlayer('张三', roster)).toEqual({ player: roster[0], matched: 'display' });
    expect(matchRosterPlayer('P. Wu', roster)).toEqual({ player: roster[3], matched: 'display-folded' }); // 查询词无重音、库内 Wü 折叠命中
  });

  it('TC-MATCH-02 同层多命中 = 歧义放弃，绝不猜一个', () => {
    expect(matchRosterPlayer('A. Ha', roster)).toBeNull(); // 15/16 同 official 名
    expect(matchRosterPlayer('B. HO', roster)).toBeNull(); // 17/18 归一化后同键（HO 折成 ho 撞 Hó）
  });

  it('TC-MATCH-03 完全认不出回 null；空花名册全 null', () => {
    expect(matchRosterPlayer('查无此人', roster)).toBeNull();
    expect(matchRosterPlayer('L. Li', [])).toBeNull();
  });
});

describe('TC-DRAFT 识别结果 → 预填草稿', () => {
  it('TC-DRAFT-01 summary：≥7 预填出场+评分；<7 只出场带警告；N/A 行整体跳过', () => {
    const { ocr } = parseOcrVision(summaryRaw);
    const built = buildOcrEntries(ocr as OcrVision, roster);
    const byId = new Map(built.entries.map((e) => [e.playerId, e]));
    expect(byId.get(10)!.draft).toEqual({ appearance: true }); // 5.1 → 只出场
    expect(byId.get(11)!.draft).toEqual({ appearance: true, rating: 9.2 });
    expect(byId.has(15)).toBe(false); // X. Bench 没上场：不进 entries 也不进 unmatched
    expect(built.unmatched).toEqual([]);
    expect(built.warnings).toContain('「K. Zhang」评分 5.1 低于 7.0，只预填出场（7.0 以下不给 XP）');
  });

  it('TC-DRAFT-02 goalkeeping：门将出场 + 扑救（>0 才填）+ 失球 0 勾零封', () => {
    const ocr4 = parseOcrVision(gkRaw).ocr!;
    const built4 = buildOcrEntries(ocr4, roster);
    expect(built4.entries).toHaveLength(1);
    expect(built4.entries[0]).toMatchObject({ playerId: 10, matched: 'official' });
    expect(built4.entries[0].draft).toEqual({ appearance: true, saves: 3 }); // 失球 4 → 无零封

    const ocr0 = parseOcrVision({ ...gkRaw, gk: { ...gkRaw.gk, goalsConceded: 0, saves: 7, shotsOnTarget: 7 } }).ocr!;
    const built0 = buildOcrEntries(ocr0, roster);
    expect(built0.entries[0].draft).toEqual({ appearance: true, saves: 7, cleanSheet: true });

    const ocrNoGk = parseOcrVision({ ...gkRaw, gk: null }).ocr!;
    const builtNoGk = buildOcrEntries(ocrNoGk, roster);
    expect(builtNoGk.entries).toEqual([]);
    expect(builtNoGk.warnings).toContain('截图里没有门将详情（Goalkeeping 面板），扑救与零封无法预填');
  });

  it('TC-DRAFT-03 认不出的行进 unmatched；夺回球权永不进草稿（裁决锁）', () => {
    const { ocr } = parseOcrVision({
      ...summaryRaw,
      rows: [
        { pos: 'ST', name: '查无此人', rating: '8.0', goals: 0, assists: 0 },
        { pos: 'CM', name: 'L. Li', rating: '8.0', goals: 0, assists: 0 },
      ],
    });
    const built = buildOcrEntries(ocr as OcrVision, roster);
    expect(built.unmatched).toEqual([{ name: '查无此人', pos: 'ST' }]);
    expect(built.entries).toHaveLength(1);
    // OcrEntryDraft 类型上没有 duelsWon；运行时也不许出现
    for (const e of built.entries) expect('duelsWon' in e.draft).toBe(false);
  });

  it('TC-DRAFT-04 同一人两处命中合并草稿（rows + gk 不会，但同一行重复时合并）', () => {
    const { ocr } = parseOcrVision({
      ...summaryRaw,
      rows: [
        { pos: 'GK', name: 'K. Zhang', rating: '8.0', goals: 0, assists: 0 },
        { pos: 'GK', name: 'K. Zhang', rating: '8.0', goals: 0, assists: 0 },
      ],
    });
    const built = buildOcrEntries(ocr as OcrVision, roster);
    expect(built.entries).toHaveLength(1);
    expect(built.entries[0].draft).toEqual({ appearance: true, rating: 8 });
  });
});

describe('TC-XCHK 识别结果 × 比分交叉校验', () => {
  const base: OcrVision = {
    team: '海港联',
    tab: 'summary',
    rows: [
      { pos: 'ST', name: '甲', rating: 9, goals: 2, assists: 0 },
      { pos: 'RW', name: '乙', rating: 8, goals: 1, assists: 0 },
    ],
    selected: null,
    gk: null,
  };

  it('TC-XCHK-01 行内进球和超本队比分 → 警告；不超过 → 无警告', () => {
    expect(ocrCrossChecks(base, { side: 'home', scoreHome: 2, scoreAway: 4 })).toHaveLength(1);
    expect(ocrCrossChecks(base, { side: 'home', scoreHome: 3, scoreAway: 1 })).toHaveLength(0);
  });

  it('TC-XCHK-02 GK 失球双向比对不上 → 警告；扑救+失球≠射正 → 警告', () => {
    const gk = (saves: number | null, conceded: number | null, onTarget: number | null): OcrVision => ({
      ...base,
      tab: 'goalkeeping',
      rows: [],
      gk: { name: 'K. Zhang', gkRating: 4, shotsAgainst: 10, shotsOnTarget: onTarget, saves, goalsConceded: conceded },
    });
    // 失球 5 > 对方比分 4 → 「超过对方比分」
    expect(ocrCrossChecks(gk(2, 5, 7), { side: 'home', scoreHome: 2, scoreAway: 4 })).toContainEqual(expect.stringContaining('超过对方比分'));
    // 失球 3 < 对方比分 4 → 「少于对方比分」
    expect(ocrCrossChecks(gk(4, 3, 7), { side: 'home', scoreHome: 2, scoreAway: 4 })).toContainEqual(expect.stringContaining('少于对方比分'));
    // 内部一致（3+4=7）→ 无内部不一致警告；不一致（3+4≠8）→ 有
    expect(ocrCrossChecks(gk(3, 4, 7), { side: 'home', scoreHome: 2, scoreAway: 4 })).toHaveLength(0);
    expect(ocrCrossChecks(gk(3, 4, 8), { side: 'home', scoreHome: 2, scoreAway: 4 })).toContainEqual(expect.stringContaining('内部不一致'));
  });
});
