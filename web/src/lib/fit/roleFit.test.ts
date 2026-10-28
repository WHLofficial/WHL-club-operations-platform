// 角色适配权重表（./roleFit.ts）——钉住五件事：
// 【移植】自 WHL-tournament-management-system/tests/roleFit.test.ts 迁入（fit 引擎移植增量），
// 断言逐字未改，仅两处数据源换本仓：徽章参照表用 ref.ts 的 playstyleById（web/assets/ref/
// playstyle.json 真源，tour 冻结表 shared/fc26Playstyles 即自它逐字复制）、PTE26 用 ./pte26.ts
// （自 tour shared/tactics.ts 提取，raw 串逐字未改）；import 路径改本仓相对路径 + .ts 后缀。
// ① 49 个「位置|角色码」与 PTE26 的全部「位置×角色」组合一一对应（无孤儿、无缺配）；
// ② 每条恰 6 项属性、权重恰为 3/3/2/2/1/1（和 = 12）、键不重复；
// ③ 徽章 3-6 个、都是银基 psid、全部存在于 playstyle 参照表、不重复；
// ④ RoleID/PosID 冻结映射的哨兵值（142 = ST 禁区之王 ++，与本仓 web/assets/ref/role.json
//   对齐的那次人工核对）；
// ⑤ FIT_ATTR_KEYS 确实是权重表键并集（trim 放宽的口径不被手抄漂移）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playstyleById } from "../ref.ts";
import {
  FC26_POS_BY_ID,
  FC26_ROLE_BY_ID,
  FIT_ATTR_KEYS,
  ROLE_FIT,
} from "./roleFit.ts";
import { PTE26 } from "./pte26.ts";

// PTE26 的全部「位置×角色」去重（同一角色带多个重心，去重后恰 49 个）
const slotKeys = [
  ...new Set(
    Object.entries(PTE26).flatMap(([pos, list]) =>
      list.map((e) => `${pos}|${e.role}`),
    ),
  ),
];

// tour 侧用冻结表 FC26_PLAYSTYLES 过滤银基段；本仓直接用真源 ref/playstyle.json
//（playstyleById，73 条含金银段，逐字同源），口径不变：0 < id < 100 为银基段。
const silverBaseIds = new Set(
  [...playstyleById.keys()].filter((id) => id > 0 && id < 100),
);

describe("角色适配权重表", () => {
  it("49 个「位置|角色码」与 PTE26 全组合一一对应（无孤儿、无缺配）", () => {
    expect(slotKeys).toHaveLength(49);
    expect(Object.keys(ROLE_FIT)).toHaveLength(49);
    expect(new Set(Object.keys(ROLE_FIT))).toEqual(new Set(slotKeys));
  });

  it("每条恰 6 项属性，权重恰为 3/3/2/2/1/1（和 = 12），属性键不重复", () => {
    for (const [key, p] of Object.entries(ROLE_FIT)) {
      expect(p.attrs, key).toHaveLength(6);
      expect(
        p.attrs.map(([, w]) => w).sort((a, b) => a - b),
        key,
      ).toEqual([1, 1, 2, 2, 3, 3]);
      expect(
        p.attrs.reduce((s, [, w]) => s + w, 0),
        key,
      ).toBe(12);
      expect(new Set(p.attrs.map(([k]) => k)).size, key).toBe(6);
    }
  });

  it("每条 3-6 个徽章，都是银基 psid 且存在于 playstyle 参照表，不重复", () => {
    for (const [key, p] of Object.entries(ROLE_FIT)) {
      expect(p.badges.length, key).toBeGreaterThanOrEqual(3);
      expect(p.badges.length, key).toBeLessThanOrEqual(6);
      expect(new Set(p.badges).size, key).toBe(p.badges.length);
      for (const psid of p.badges) {
        expect(silverBaseIds.has(psid), `${key} 徽章 psid ${psid}`).toBe(true);
      }
    }
  });

  it("zh 中文名非空（候选面板展示用）", () => {
    for (const [key, p] of Object.entries(ROLE_FIT)) {
      expect(p.zh.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("role 级权重：左右镜像的同角色共用一份（LB/RB、LM/RM、LW/RW、四路边锋族）", () => {
    const same = (a: string, b: string) => {
      expect(ROLE_FIT[a].attrs, a).toEqual(ROLE_FIT[b].attrs);
      expect(ROLE_FIT[a].badges, a).toEqual(ROLE_FIT[b].badges);
    };
    for (const c of ["FB", "WB", "FAB", "AWB", "IWB"]) same(`LB|${c}`, `RB|${c}`);
    for (const c of ["W", "WP", "IF"]) {
      same(`LM|${c}`, `RM|${c}`);
      same(`LW|${c}`, `RW|${c}`);
      same(`LM|${c}`, `LW|${c}`);
    }
    same("LM|WM", "RM|WM");
  });

  it("FIT_ATTR_KEYS = 全部权重键的并集（去重排序，不含 CA/PA）", () => {
    const union = new Set(
      Object.values(ROLE_FIT).flatMap((p) => p.attrs.map(([k]) => k)),
    );
    expect(FIT_ATTR_KEYS).toEqual([...union].sort());
    expect(FIT_ATTR_KEYS).not.toContain("CA");
    expect(FIT_ATTR_KEYS).not.toContain("PA");
  });
});

describe("RoleID/PosID 冻结映射（scripts/freeze-fc26-refs.mjs 生成）", () => {
  it("哨兵值：142 = ST|PO tier 2（ST 禁区之王 ++），另有 1/45/148 三个跨段锚点", () => {
    expect(FC26_ROLE_BY_ID[142]).toEqual({ slot: "ST|PO", tier: 2 });
    expect(FC26_ROLE_BY_ID[1]).toEqual({ slot: "GK|GK", tier: 1 });
    expect(FC26_ROLE_BY_ID[45]).toEqual({ slot: "GK|BPK", tier: 1 });
    expect(FC26_ROLE_BY_ID[148]).toEqual({ slot: "CB|WDB", tier: 2 });
  });

  it("98 个 RoleID = 49 槽位 × +/++ 两档，slot 全部落在 ROLE_FIT 里", () => {
    expect(Object.keys(FC26_ROLE_BY_ID)).toHaveLength(98);
    const bySlot = new Map<string, number[]>();
    for (const m of Object.values(FC26_ROLE_BY_ID)) {
      expect([1, 2], m.slot).toContain(m.tier);
      expect(ROLE_FIT[m.slot], m.slot).toBeDefined();
      bySlot.set(m.slot, [...(bySlot.get(m.slot) ?? []), m.tier]);
    }
    expect(bySlot.size).toBe(49);
    for (const [slot, tiers] of bySlot) {
      expect(tiers.sort(), slot).toEqual([1, 2]);
    }
  });

  it("PosID：0=GK、27=LW、5=CB，共 13 条（含 -1 无位置占位）", () => {
    expect(FC26_POS_BY_ID[0]).toBe("GK");
    expect(FC26_POS_BY_ID[27]).toBe("LW");
    expect(FC26_POS_BY_ID[5]).toBe("CB");
    expect(FC26_POS_BY_ID[-1]).toBe("-");
    expect(Object.keys(FC26_POS_BY_ID)).toHaveLength(13);
  });
});

// TC-C-003（docs/test-plans/v6.56.0-attr-head-relayout.md）：role.json 反推跨检——
// 上游真源 web/assets/ref/role.json 与冻结表 FC26_ROLE_BY_ID 的零漂移探测器：上游改表而
// 冻结表未重冻结时本组红。定位口径（评审点名的坐标系坑）：role.json 的 chs/en 首段是
// 位置码（GK/RB/ST…单段），不是冻结表两段式 slot——禁止直读比对（直读必 98 全 bad、
// 探测器变常红，实测在案）；必须「同位置码槽位内按 zh 精确匹配」转换坐标后再比。
describe("TC-C-003 role.json 反推跨检（冻结表与上游零漂移）", () => {
  // 单行紧凑 JSON（实测 6065 字符、99 个对象 = 98 条非零 id + 1 条 id 0 占位），按对象遍历不按行读
  const roleJson = JSON.parse(
    readFileSync(new URL("../../../assets/ref/role.json", import.meta.url), "utf8"),
  ) as { id: number; en: string; chs: string }[];

  /** 尾缀档位：++ → 2、+ → 1；其余 = 数据坏（报错不静默） */
  function tierOfTail(tail: string, ctx: string): 1 | 2 {
    if (tail === "++") return 2;
    if (tail === "+") return 1;
    throw new Error(`${ctx}：尾缀「${tail}」不是 +/++（上游格式变更，需人工核对后同步冻结表）`);
  }

  it("上游 98 条（id 1-… 非 0 占位）逐条三步定位后与 FC26_ROLE_BY_ID 全对", () => {
    const entries = roleJson.filter((r) => r.id !== 0);
    expect(entries, "role.json 非零 id 条数").toHaveLength(98);
    let matched = 0;

    for (const r of entries) {
      const ctx = `role.json#${r.id}（chs=「${r.chs}」 en=「${r.en}」）`;
      // ① tier 双取交叉：id 段口径 ↔ chs/en 尾缀口径，不一致 = 数据坏
      const tierById: 1 | 2 = r.id >= 101 ? 2 : 1;
      const chsParts = r.chs.trim().split(/\s+/);
      const enParts = r.en.trim().split(/\s+/);
      expect(chsParts.length, ctx).toBeGreaterThanOrEqual(3);
      expect(enParts.length, ctx).toBeGreaterThanOrEqual(3);
      const tierChs = tierOfTail(chsParts[chsParts.length - 1], ctx);
      const tierEn = tierOfTail(enParts[enParts.length - 1], ctx);
      expect(tierChs, `${ctx} chs 尾缀档`).toBe(tierById);
      expect(tierEn, `${ctx} en 尾缀档`).toBe(tierById);
      // ② 坐标转换 + en 首段交叉：位置码两侧一致；同位置码槽位内按 zh 精确匹配定位唯一 slot
      const posCode = chsParts[0];
      const zh = chsParts.slice(1, -1).join(" ");
      expect(enParts[0], `${ctx} en 首段位置码`).toBe(posCode);
      const hits = Object.entries(ROLE_FIT).filter(
        ([slot, p]) => slot.split("|")[0] === posCode && p.zh === zh,
      );
      if (hits.length !== 1) {
        throw new Error(
          `${ctx}：位置码 ${posCode} 内按 zh「${zh}」定位到 ${hits.length} 个槽位（${hits.map(([s]) => s).join(", ") || "无"}）——上游改名/同名新角色，需人工核对`,
        );
      }
      // ③ 终比对：定位出的 slot+tier 与冻结表逐字一致
      const frozen = FC26_ROLE_BY_ID[r.id];
      expect(frozen, `${ctx} 冻结表缺行`).toBeDefined();
      expect(frozen.slot, ctx).toBe(hits[0][0]);
      expect(frozen.tier, ctx).toBe(tierById);
      matched += 1;
    }
    expect(matched).toBe(98);
  });
});
