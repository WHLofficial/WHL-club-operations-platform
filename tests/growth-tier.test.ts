// §10.3 成长档位规则（v6.48.0）：SQL 真源与 TS 镜像同口径 + 边界（缺数据不猜、上限截断、坏 JSON）。
// 这是本版最容易悄悄走偏的一层——生产走 SQL、文案与单测走 TS，两边一旦漂移，
// 管理端预览的数字和真正写进库的档位就会对不上。
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  GROWTH_TIER_CONDITIONS,
  GROWTH_TIER_MAX,
  GROWTH_TIER_MIN,
  GROWTH_TIER_MISSING_SELECT,
  GROWTH_TIER_SELECT,
  GROWTH_TIER_SQL,
  TIER_CONDITION_SQL,
  evaluateGrowthTier,
  gameAttrInt,
  tierConditionDetails,
  type GrowthTierConditionKey,
  type GrowthTierInput,
} from '../src/core/growth-tier.ts';
import { createTestDb } from './d1.ts';

interface Fixture {
  sqlite: DatabaseSync;
  db: D1Database;
}

/** 一条 fixture 行：既描述库里写了什么，也描述 TS 镜像该看到什么 */
interface Case {
  id: number;
  label: string;
  clubId: number | null;
  teamId?: number | null;
  nationId?: number | null;
  attrs?: string | null;
  chinaPlan?: 0 | 1;
  futureStar?: 0 | 1;
  age?: number | null;
  expectTier: number;
  expectHits: GrowthTierConditionKey[];
  expectMissing: GrowthTierConditionKey[];
}

// 队壳：1 = 英格兰(14)，2 = 未设国家，3 = 意大利(27)
const CLUBS: { id: number; name: string; country: number | null }[] = [
  { id: 1, name: '英格兰队壳', country: 14 },
  { id: 2, name: '没设国家的队壳', country: null },
  { id: 3, name: '意大利队壳', country: 27 },
];

function attrs(o: { TeamID?: number | null; naID?: number | null } | null): string | null {
  if (o === null) return null;
  const out: Record<string, unknown> = {};
  if (o.TeamID !== undefined && o.TeamID !== null) out.TeamID = o.TeamID;
  if (o.naID !== undefined && o.naID !== null) out.naID = o.naID;
  return JSON.stringify(out);
}

const CASES: Case[] = [
  {
    id: 1,
    label: '效力一致 + 会籍一致（英格兰）→ 档 3',
    clubId: 1,
    teamId: 1,
    nationId: 14,
    expectTier: 3,
    expectHits: ['c1', 'c2'],
    expectMissing: [],
  },
  {
    id: 2,
    label: '效力不一致 + 中国籍 → 档 2',
    clubId: 1,
    teamId: 10,
    nationId: 155,
    chinaPlan: 1,
    expectTier: 2,
    expectHits: ['c3'],
    expectMissing: [],
  },
  {
    id: 3,
    label: '五条全中 1+1+1+2+1 = 6 → 上限截到 5',
    clubId: 1,
    teamId: 1,
    nationId: 14,
    chinaPlan: 1,
    futureStar: 1,
    age: 18,
    expectTier: 5,
    expectHits: ['c1', 'c2', 'c3', 'c4', 'c5'],
    expectMissing: [],
  },
  {
    id: 4,
    label: '队壳未设国家 → c2 记数据缺失（不是命中也不是普通未命中）',
    clubId: 2,
    teamId: 2,
    nationId: 14,
    age: 19,
    expectTier: 2,
    expectHits: ['c1'],
    expectMissing: ['c2'],
  },
  {
    id: 5,
    label: '自由身（club_id NULL）→ c1/c2 都不命中，且不算数据缺失',
    clubId: null,
    teamId: 5,
    nationId: 155,
    chinaPlan: 1,
    expectTier: 2,
    expectHits: ['c3'],
    expectMissing: [],
  },
  {
    id: 6,
    label: '有队壳但 game_attrs 为 NULL → c1/c2 都记数据缺失',
    clubId: 1,
    attrs: null,
    expectTier: 1,
    expectHits: [],
    expectMissing: ['c1', 'c2'],
  },
  {
    id: 7,
    label: 'game_attrs 是空对象（有队壳、两个键都缺）→ c1/c2 都记缺失',
    clubId: 1,
    attrs: '{}',
    expectTier: 1,
    expectHits: [],
    expectMissing: ['c1', 'c2'],
  },
  {
    id: 8,
    label: '港澳台不算中国籍（naID 158 香港）→ c3 不命中',
    clubId: 1,
    teamId: 1,
    nationId: 158,
    age: 18,
    expectTier: 3,
    expectHits: ['c1', 'c5'],
    expectMissing: [],
  },
  {
    id: 9,
    label: 'game_attrs 里缺 TeamID → c1 缺失、c2 照判',
    clubId: 1,
    attrs: attrs({ naID: 14 }),
    expectTier: 2,
    expectHits: ['c2'],
    expectMissing: ['c1'],
  },
  {
    id: 10,
    label: '年龄 19 岁不命中 c5；age 为 NULL 也不命中（不算缺失）',
    clubId: 1,
    teamId: 1,
    nationId: 14,
    age: 19,
    expectTier: 3,
    expectHits: ['c1', 'c2'],
    expectMissing: [],
  },
  {
    id: 11,
    label: 'age NULL：c5 不命中但不算数据缺失',
    clubId: 1,
    teamId: 1,
    nationId: 14,
    age: null,
    expectTier: 3,
    expectHits: ['c1', 'c2'],
    expectMissing: [],
  },
  {
    id: 12,
    label: '18 岁边界命中（≤18 含 18）',
    clubId: 3,
    teamId: 3,
    nationId: 27,
    age: 18,
    expectTier: 4,
    expectHits: ['c1', 'c2', 'c5'],
    expectMissing: [],
  },
];

function freshDb(): Fixture {
  const { sqlite, db } = createTestDb();
  sqlite.exec(
    `INSERT INTO clubs (id, name, country, status) VALUES ${CLUBS.map(
      (c) => `(${c.id}, '${c.name}', ${c.country === null ? 'NULL' : c.country}, 'active')`,
    ).join(', ')};`,
  );
  for (const c of CASES) {
    const gameAttrs =
      c.attrs !== undefined
        ? c.attrs
        : c.clubId === null
          ? attrs({ TeamID: c.teamId ?? null, naID: c.nationId ?? null })
          : attrs({ TeamID: c.teamId ?? null, naID: c.nationId ?? null });
    sqlite.exec(
      `INSERT INTO players (id, uid, name, club_id, age, china_plan, is_future_star, growth_tier, game_attrs)
       VALUES (${c.id}, 'fc${c.id}', '球员${c.id}', ${c.clubId === null ? 'NULL' : c.clubId},
               ${c.age === null || c.age === undefined ? 'NULL' : c.age}, ${c.chinaPlan ?? 0}, ${c.futureStar ?? 0}, 1,
               ${gameAttrs === null ? 'NULL' : `'${gameAttrs.replace(/'/g, "''")}'`});`,
    );
  }
  return { sqlite, db };
}

function tsInput(c: Case): GrowthTierInput {
  // 直接给了 game_attrs 的 fixture（缺失/坏数据那几条）从 JSON 里读，跟 SQL 真源同一份输入
  const fromAttrs = c.attrs !== undefined;
  return {
    clubId: c.clubId,
    teamId: fromAttrs ? gameAttrInt(c.attrs ?? null, 'TeamID') : (c.teamId ?? null),
    nationId: fromAttrs ? gameAttrInt(c.attrs ?? null, 'naID') : (c.nationId ?? null),
    clubCountry: CLUBS.find((x) => x.id === c.clubId)?.country ?? null,
    chinaPlan: (c.chinaPlan ?? 0) === 1,
    isFutureStar: (c.futureStar ?? 0) === 1,
    age: c.age ?? null,
  };
}

describe('§10.3 规则层：SQL 真源与 TS 镜像同口径（v6.48.0）', () => {
  it('条件元数据：键序 c1..c5、分值 1/1/1/2/1、上限 5', () => {
    expect(GROWTH_TIER_CONDITIONS.map((c) => c.key)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(GROWTH_TIER_CONDITIONS.map((c) => c.points)).toEqual([1, 1, 1, 2, 1]);
    expect(GROWTH_TIER_MIN).toBe(1);
    expect(GROWTH_TIER_MAX).toBe(5);
    expect(GROWTH_TIER_SQL).toContain('MIN(');
    expect(GROWTH_TIER_SQL).toContain('2 * ');
  });

  it('每个 fixture：SQL 取出的档位/命中/缺失与 evaluateGrowthTier 完全一致', async () => {
    const { db } = freshDb();
    const rows = await db
      .prepare(
        `SELECT p.id, ${GROWTH_TIER_SELECT}, ${GROWTH_TIER_MISSING_SELECT}
         FROM players p LEFT JOIN clubs c ON c.id = p.club_id ORDER BY p.id`,
      )
      .all<Record<string, number | null>>();
    expect(rows.results).toHaveLength(CASES.length);

    for (const row of rows.results) {
      const c = CASES.find((x) => x.id === Number(row.id))!;
      const ts = evaluateGrowthTier(tsInput(c));
      const sqlHits = (['c1', 'c2', 'c3', 'c4', 'c5'] as GrowthTierConditionKey[]).filter((k) => row[k] === 1);
      const sqlMissing: GrowthTierConditionKey[] = [];
      if (row.miss_c1 === 1) sqlMissing.push('c1');
      if (row.miss_c2 === 1) sqlMissing.push('c2');

      expect({ id: c.id, tier: row.next_tier, hits: sqlHits, missing: sqlMissing }, c.label).toEqual({
        id: c.id,
        tier: c.expectTier,
        hits: c.expectHits,
        missing: c.expectMissing,
      });
      expect(ts.tier, c.label).toBe(c.expectTier);
      expect([...sqlHits].sort(), c.label).toEqual(
        (['c1', 'c2', 'c3', 'c4', 'c5'] as GrowthTierConditionKey[]).filter((k) => ts.hits[k]).sort(),
      );
      expect([...sqlMissing].sort(), c.label).toEqual([...ts.missing].sort());
    }
  });

  it('坏 JSON 不抛错（json_valid 兜底）：表达式在裸表上只当条件不命中 + 记缺失', async () => {
    // 为什么用裸表：players 上有 idx_players_sort_ps 这类表达式索引（json_extract(game_attrs…)），
    // 往真表里写坏 JSON 在 INSERT/UPDATE 那一刻就抛 "malformed JSON"——坏数据只可能来自历史路径。
    // 规则层仍要兜住它（真源 SQL 会被用在任何后续读上），这里就验这一层。
    const { sqlite, db } = createTestDb();
    sqlite.exec(`
      CREATE TABLE scratch_players (id INTEGER PRIMARY KEY, club_id INTEGER, game_attrs TEXT, china_plan INTEGER, is_future_star INTEGER, age INTEGER);
      CREATE TABLE scratch_clubs (id INTEGER PRIMARY KEY, country INTEGER);
      INSERT INTO scratch_clubs (id, country) VALUES (1, 14);
      INSERT INTO scratch_players (id, club_id, game_attrs, china_plan, is_future_star, age) VALUES
        (1, 1, '{坏掉的 json', 0, 0, 24),
        (2, 1, NULL, 0, 0, 24),
        (3, 1, '{"TeamID": 1, "naID": 14}', 0, 0, 24);
    `);
    const rows = await db
      .prepare(
        `SELECT p.id, ${GROWTH_TIER_SQL} AS next_tier, ${GROWTH_TIER_MISSING_SELECT}
         FROM scratch_players p LEFT JOIN scratch_clubs c ON c.id = p.club_id ORDER BY p.id`,
      )
      .all<{ id: number; next_tier: number; miss_c1: number; miss_c2: number }>();
    expect(rows.results).toEqual([
      { id: 1, next_tier: 1, miss_c1: 1, miss_c2: 1 },
      { id: 2, next_tier: 1, miss_c1: 1, miss_c2: 1 },
      { id: 3, next_tier: 3, miss_c1: 0, miss_c2: 0 },
    ]);
  });

  it('c1/c2 的条件 SQL 都带 json_valid 兜底与 club_id 前置判断', () => {
    expect(TIER_CONDITION_SQL.c1).toContain('json_valid');
    expect(TIER_CONDITION_SQL.c1).toContain('p.club_id IS NOT NULL');
    expect(TIER_CONDITION_SQL.c2).toContain('c.country IS NOT NULL');
    expect(TIER_CONDITION_SQL.c2).toContain('json_valid');
    // c3 只认 china_plan 列（港澳台在导入侧就不置 1，规则层不重复判断）
    expect(TIER_CONDITION_SQL.c3).toContain('p.china_plan = 1');
    expect(TIER_CONDITION_SQL.c4).toContain('p.is_future_star = 1');
    expect(TIER_CONDITION_SQL.c5).toContain('p.age IS NOT NULL');
  });
});

describe('§10.3 TS 镜像：单点边界（v6.48.0）', () => {
  const base: GrowthTierInput = {
    clubId: 1,
    teamId: 1,
    nationId: 14,
    clubCountry: 14,
    chinaPlan: false,
    isFutureStar: false,
    age: 24,
  };

  it('效力与队壳一致要求 TeamID 与 club_id 相等（不是「有队就算」）', () => {
    expect(evaluateGrowthTier(base).hits.c1).toBe(true);
    expect(evaluateGrowthTier({ ...base, teamId: 2 }).hits.c1).toBe(false);
    expect(evaluateGrowthTier({ ...base, teamId: null }).missing).toContain('c1');
  });

  it('会籍与队壳国家一致：naID 比 clubs.country，缺任一侧都记 c2 缺失', () => {
    expect(evaluateGrowthTier(base).hits.c2).toBe(true);
    expect(evaluateGrowthTier({ ...base, nationId: 155 }).hits.c2).toBe(false);
    expect(evaluateGrowthTier({ ...base, nationId: null }).missing).toContain('c2');
    expect(evaluateGrowthTier({ ...base, clubCountry: null }).missing).toContain('c2');
    expect(evaluateGrowthTier({ ...base, clubCountry: null }).hits.c2).toBe(false);
  });

  it('自由身（club_id NULL）：c1/c2 恒不命中且不算缺失（缺的是队，不是数据）', () => {
    const ev = evaluateGrowthTier({ ...base, clubId: null });
    expect(ev.hits.c1).toBe(false);
    expect(ev.hits.c2).toBe(false);
    expect(ev.missing).toEqual([]);
  });

  it('上限截断：全中 = 6 → 5', () => {
    const ev = evaluateGrowthTier({ ...base, chinaPlan: true, isFutureStar: true, age: 18 });
    expect(ev.tier).toBe(5);
  });

  it('未来之星单独 +2（干净起点：其余条件都不命中）', () => {
    const clean: GrowthTierInput = {
      clubId: null,
      teamId: null,
      nationId: null,
      clubCountry: null,
      chinaPlan: false,
      isFutureStar: true,
      age: null,
    };
    expect(evaluateGrowthTier(clean).tier).toBe(3);
    expect(evaluateGrowthTier({ ...clean, isFutureStar: false }).tier).toBe(1);
    // 叠加在已有条件上：c1+c2 命中(3) + 未来之星(2) → 5
    expect(evaluateGrowthTier({ ...base, isFutureStar: true }).tier).toBe(5);
  });

  it('条件明细三态：命中 / 数据缺失 / 未命中', () => {
    const ev = evaluateGrowthTier({ ...base, teamId: null, clubCountry: null });
    const details = tierConditionDetails(ev.hits, ev.missing);
    const byKey = Object.fromEntries(details.map((d) => [d.key, d]));
    expect(byKey.c1).toMatchObject({ hit: false, missing: true });
    expect(byKey.c2).toMatchObject({ hit: false, missing: true });
    expect(byKey.c3).toMatchObject({ hit: false, missing: false });
    expect(details.map((d) => d.points)).toEqual([1, 1, 1, 2, 1]);
    expect(details[0].label).toBe('现实效力与队壳一致');
  });
});

describe('§10.3 gameAttrInt：game_attrs 取值宽容度（v6.48.0）', () => {
  it('字符串 JSON / 已解析对象 / 数值字符串都能取到整数', () => {
    expect(gameAttrInt('{"TeamID": 12}', 'TeamID')).toBe(12);
    expect(gameAttrInt({ TeamID: 12 }, 'TeamID')).toBe(12);
    expect(gameAttrInt('{"naID": "155"}', 'naID')).toBe(155);
    expect(gameAttrInt('{"naID": 155.9}', 'naID')).toBe(155);
  });

  it('坏 JSON / 缺键 / 空串 / 非数值都回 null（不抛错）', () => {
    expect(gameAttrInt('{坏', 'TeamID')).toBeNull();
    expect(gameAttrInt(null, 'TeamID')).toBeNull();
    expect(gameAttrInt('{"Other": 1}', 'TeamID')).toBeNull();
    expect(gameAttrInt('{"TeamID": ""}', 'TeamID')).toBeNull();
    expect(gameAttrInt('{"TeamID": "abc"}', 'TeamID')).toBeNull();
    expect(gameAttrInt(123, 'TeamID')).toBeNull();
  });
});
