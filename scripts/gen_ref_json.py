#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成球员卡前端参考表（TECH_DESIGN §5.4 参考表静态 JSON）。

从 FC26db 源文件抽取 NationID / PlayStyleID / PositionID / RoleID / TeamID 五张表，
写进 web/assets/ref/*.json 随 SPA 版本发布；换赛季用新源文件重跑即可。

用法：python scripts/gen_ref_json.py [FC26db xlsx 路径]
默认路径：E:\\Downloads\\FC26db20251217_fixed.xlsx
"""
import json
import sys
from pathlib import Path

import openpyxl

DEFAULT_SOURCE = r"E:\Downloads\FC26db20251217_fixed.xlsx"
OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "assets" / "ref"

# 增量 14 裁决 3：EA 未授权俱乐部在游戏里用假名 + 新 id（EAFC 26 IDs 表里 39/44/46/47 整段不存在）。
# 平台统一走「游戏真 id + 真名」，所以这儿补 4 条真名条目；老 id 条目保留不动——
# 数据库里历史 game_attrs.TeamID 还可能是它们，删了会让属性页签显示不出队名。
TEAM_NAME_OVERRIDES = {
    131681: "AC Milan",  # 游戏名 Milano FC
    131682: "Inter",  # 游戏名 Lombardia FC
    115841: "Lazio",  # 游戏名 Latium
    115845: "Atalanta",  # 游戏名 Bergamo Calcio
}


def rows_of(ws):
    it = ws.iter_rows(values_only=True)
    headers = [str(h) for h in next(it)]
    for row in it:
        yield {k: v for k, v in zip(headers, row)}


def col(row, *names):
    """按候选表头取值（NationID 的表头是 'Nation ID'/'Nation Name'，其余表是 'ID'/'Name'）"""
    for n in names:
        if n in row and row[n] is not None:
            return row[n]
    return None


def simple_rows(ws, id_keys, name_keys):
    out = []
    for r in rows_of(ws):
        rid = col(r, *id_keys)
        name = col(r, *name_keys)
        if rid is not None:
            out.append({"id": int(rid), "name": name})
    return out


def merge_team_overrides(teams):
    """把 TEAM_NAME_OVERRIDES 合进队名表（覆盖同 id，按 id 升序输出，与 team.json 既有排序一致）"""
    by_id = {t["id"]: t for t in teams}
    for tid, name in TEAM_NAME_OVERRIDES.items():
        by_id[tid] = {"id": tid, "name": name}
    return [by_id[tid] for tid in sorted(by_id)]


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE)
    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    nations = simple_rows(wb["NationID"], ("Nation ID", "ID"), ("Nation Name", "Name"))
    positions = simple_rows(wb["PositionID"], ("ID",), ("Name",))
    playstyles = [
        {
            "id": int(col(r, "ID")),
            "en": r.get("PlayStyle"),
            "chs": r.get("PlayStyle_CHS"),
            "type": r.get("Type"),
        }
        for r in rows_of(wb["PlayStyleID"])
        if col(r, "ID") is not None
    ]
    roles = [
        {"id": int(col(r, "ID")), "en": r.get("Name"), "chs": r.get("Name_CHS")}
        for r in rows_of(wb["RoleID"])
        if col(r, "ID") is not None
    ]
    teams = merge_team_overrides(simple_rows(wb["TeamID"], ("ID",), ("Name",)))

    outputs = {
        "nation.json": nations,
        "position.json": positions,
        "playstyle.json": playstyles,
        "role.json": roles,
        "team.json": teams,
    }
    for name, data in outputs.items():
        (OUT_DIR / name).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"{name}: {len(data)} 行")

    china = next(n for n in nations if n["id"] == 155)
    assert china["name"] == "China PR", f"NationID 155 应为 China PR，实际 {china['name']}"
    print(f"自检：NationID 155 = {china['name']}；金段徽章 = {[p['id'] for p in playstyles if p['id'] >= 100][:3]}...")


if __name__ == "__main__":
    main()
