// 参考表与后端白名单的一致性（v3.1.1 步骤 2）：属性中文名表从 pages/Player.tsx 提到 ref.ts 后，
// 筛选面板的「属性」下拉改用它分组渲染 —— 一旦与 ATTR_KEYS 错位，下拉里就会缺项或露出英文键，
// 而这类漂移在界面上只是「少了一个选项」，不会报错、不会红测试，所以在这里钉死。
import { describe, expect, it } from 'vitest';
import { ATTR_GROUPS, ATTR_LABELS, playstyleBadges } from './ref.ts';
import { ATTR_KEYS } from './players-library.ts';
import { FC26_GAME_ATTR_COLUMNS, PS_SLOT_COUNT, PS_SLOT_KEYS } from '../../../src/core/fc26.ts';

describe('属性中文名表', () => {
  it('键与后端 ATTR_KEYS 逐序全等（不多、不少、不换序）', () => {
    expect(Object.keys(ATTR_LABELS)).toEqual([...ATTR_KEYS]);
  });

  it('七组分组恰好按列顺序覆盖全部属性，且无重复', () => {
    const grouped = ATTR_GROUPS.flatMap((g) => [...g.keys]);
    // 分组顺序 = 列顺序：这样下载七组小标题就是 ATTR_KEYS 的切分，不是另一份需要单独维护的表
    expect(grouped).toEqual([...ATTR_KEYS]);
    expect(new Set(grouped).size).toBe(ATTR_KEYS.length);
  });

  it('每一项都有中文名（下拉里不会落回英文键）', () => {
    const missing = [...ATTR_KEYS].filter((k) => !ATTR_LABELS[k]);
    expect(missing).toEqual([]);
  });
});

// 属性页原先手抄了 PSID1-7 + PSID13-15（模块顶部的槽位键清单当时还没导出），落在 PSID8-12 的
// 银徽章因此「可筛不可见」：列表按台账列 badges_silver 显示 8 银，属性页只列得出 7 个。
// 这里钉死「扫全 15 槽」，免得以后有人为了「只显示常见槽」再把手抄清单写回页面。
describe('属性页徽章清单 playstyleBadges', () => {
  it('扫全 15 槽：落在 PSID8-12 的银徽章也进清单', () => {
    expect(playstyleBadges({ PSID8: 25, PSID12: 7 })).toEqual([
      { psid: 25, slot: 8, gold: false },
      { psid: 7, slot: 12, gold: false },
    ]);
  });

  it('金/银判定：槽位 13-15 判金，槽位 1-12 判银；金段 ID 落在银槽同样判金', () => {
    const slots = playstyleBadges({ PSID1: 1, PSID12: 12, PSID13: 113, PSID15: 156, PSID2: 125 });
    expect(slots.map((b) => [b.slot, b.gold])).toEqual([
      [1, false],
      [2, true],
      [12, false],
      [13, true],
      [15, true],
    ]);
  });

  it('空槽不产出：0 / null / 缺键 / 非数字都不进清单（不铺「未设置」占位）', () => {
    expect(playstyleBadges({})).toEqual([]);
    expect(playstyleBadges({ PSID1: 0, PSID2: null, PSID3: undefined, PSID4: 'abc' })).toEqual([]);
  });

  it('槽位键与 core 同源：15 个键、首尾与银/金分界的写法不变、全在 game_attrs 白名单里', () => {
    expect(PS_SLOT_KEYS.length).toBe(PS_SLOT_COUNT);
    expect(PS_SLOT_KEYS[0]).toBe('PSID1');
    expect(PS_SLOT_KEYS[PS_SLOT_COUNT - 1]).toBe('PSID15');
    expect(PS_SLOT_KEYS.filter((k) => !FC26_GAME_ATTR_COLUMNS.includes(k))).toEqual([]);
  });
});
