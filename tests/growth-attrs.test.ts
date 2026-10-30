// v6.61.0 属性成长加成：core 纯函数单测（口径见 src/core/growth-attrs.ts 头注）。
// 覆盖 handoff §6 清单：delta 边界、缺键透传、字符串、钳 99、门将键、开关关闭、非 34 项键不动。
import { describe, expect, it } from 'vitest';
import {
  ATTR_KEYS,
  attrBonusEnabled,
  attrValueSql,
  buffedAttrs,
  buffedValue,
  growthDelta,
  growthDeltaSql,
} from '../src/core/growth-attrs.ts';
import { FC26_GAME_ATTR_COLUMNS } from '../src/core/fc26.ts';

describe('ATTR_KEYS 白名单', () => {
  it('= FC26_GAME_ATTR_COLUMNS 从 sprintspeed 起的 34 项（含 5 项门将）', () => {
    expect(ATTR_KEYS).toHaveLength(34);
    expect(ATTR_KEYS[0]).toBe('sprintspeed');
    expect(ATTR_KEYS.filter((k) => k.startsWith('gk'))).toHaveLength(5);
    expect(ATTR_KEYS).toEqual(FC26_GAME_ATTR_COLUMNS.slice(FC26_GAME_ATTR_COLUMNS.indexOf('sprintspeed')));
    // CA / PA / 身高体重等一律不在 34 项内
    expect(ATTR_KEYS).not.toContain('CA');
    expect(ATTR_KEYS).not.toContain('height');
    expect(ATTR_KEYS).not.toContain('PSID1');
  });
});

describe('growthDelta', () => {
  it('ca > base_ca：取正差', () => {
    expect(growthDelta(80, 73)).toBe(7);
  });
  it('ca = base_ca：0', () => {
    expect(growthDelta(80, 80)).toBe(0);
  });
  it('ca < base_ca：负差归 0（只加不减）', () => {
    expect(growthDelta(70, 75)).toBe(0);
  });
  it('base_ca 缺省（null/undefined）：回 COALESCE(base_ca, ca) ⇒ 0', () => {
    expect(growthDelta(80, null)).toBe(0);
    expect(growthDelta(80, undefined)).toBe(0);
  });
  it('ca 非有限数值：0', () => {
    expect(growthDelta(null, 70)).toBe(0);
    expect(growthDelta(undefined, 70)).toBe(0);
    expect(growthDelta(Number.NaN, 70)).toBe(0);
  });
  it('开关关闭：恒 0', () => {
    expect(growthDelta(80, 73, false)).toBe(0);
    expect(growthDelta(80, null, false)).toBe(0);
    expect(growthDelta(80, 73, true)).toBe(7);
  });
});

describe('buffedValue', () => {
  it('数字 + delta', () => {
    expect(buffedValue(70, 7)).toBe(77);
  });
  it('null / 缺值透传为 null，不造值', () => {
    expect(buffedValue(null, 7)).toBe(null);
    expect(buffedValue(undefined, 7)).toBe(null);
    expect(buffedValue('', 7)).toBe(null);
    expect(buffedValue('abc', 7)).toBe(null);
    expect(buffedValue(true, 7)).toBe(null);
  });
  it('数字字符串与 SQL 侧 + 0 同口径', () => {
    expect(buffedValue('70', 7)).toBe(77);
  });
  it('撞 99 封顶：98 + 5 → 99（溢出丢弃）', () => {
    expect(buffedValue(98, 5)).toBe(99);
    expect(buffedValue(95, 99)).toBe(99);
  });
  it('delta = 0：原值（≤99 时不动）', () => {
    expect(buffedValue(80, 0)).toBe(80);
  });
});

describe('buffedAttrs', () => {
  const base = {
    sprintspeed: 70,
    finishing: 98,
    gkdiving: 60,
    // 非 34 项键
    CA: 80,
    PA: 90,
    height: 182,
    weight: '74',
    PosID1: 3,
    PSID1: 25,
    weakfoot: 3,
  };

  it('34 项键 + delta，非 34 项键逐字保留', () => {
    const out = buffedAttrs(base, 3);
    expect(out.sprintspeed).toBe(73);
    expect(out.finishing).toBe(99); // 98+3 钳 99
    expect(out.gkdiving).toBe(63); // 门将键同样加成
    expect(out.CA).toBe(80);
    expect(out.PA).toBe(90);
    expect(out.height).toBe(182);
    expect(out.weight).toBe('74');
    expect(out.PosID1).toBe(3);
    expect(out.PSID1).toBe(25);
    expect(out.weakfoot).toBe(3);
    // 不改原对象
    expect(base.sprintspeed).toBe(70);
  });

  it('缺键不补：不在 attrs 里的 34 项键不会凭空出现', () => {
    const out = buffedAttrs({ finishing: 80 }, 5);
    expect(Object.keys(out)).toEqual(['finishing']);
    expect(out.sprintspeed).toBeUndefined();
  });

  it('键值为 null：透传 null', () => {
    expect(buffedAttrs({ finishing: null }, 5).finishing).toBe(null);
  });

  it('delta = 0：值不变（仍返回新对象）', () => {
    const out = buffedAttrs(base, 0);
    expect(out).not.toBe(base);
    expect(out).toEqual(base);
  });
});

describe('attrBonusEnabled', () => {
  it('0 = 关，其余（1 / null / undefined 缺行）= 开', () => {
    expect(attrBonusEnabled(0)).toBe(false);
    expect(attrBonusEnabled(1)).toBe(true);
    expect(attrBonusEnabled(null)).toBe(true);
    expect(attrBonusEnabled(undefined)).toBe(true);
  });
});

describe('SQL 表达式生成（与 JS 侧同源的唯一一份）', () => {
  it('growthDeltaSql：两侧套 COALESCE —— ca 为 NULL 的行 delta 按 0（NULL−x 会把整条表达式拖成 NULL）', () => {
    expect(growthDeltaSql('players.ca')).toBe(
      'MAX(0, COALESCE(players.ca, 0) - COALESCE(players.base_ca, players.ca, 0))',
    );
  });

  it('attrValueSql：MIN(99, json_extract + 0 + delta)；缺键时 json_extract=NULL ⇒ min 返 NULL（透传）', () => {
    expect(attrValueSql('finishing', growthDeltaSql('players.ca'))).toBe(
      "MIN(99, json_extract(players.game_attrs, '$.finishing') + 0 + MAX(0, COALESCE(players.ca, 0) - COALESCE(players.base_ca, players.ca, 0)))",
    );
  });

  it('开关关闭时传 0：缺键仍 NULL、值退化为纯钳制，不会把缺键当 0 加出 delta', () => {
    expect(attrValueSql('finishing', '0')).toBe(
      "MIN(99, json_extract(players.game_attrs, '$.finishing') + 0 + 0)",
    );
  });
});
