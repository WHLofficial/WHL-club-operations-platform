#!/usr/bin/env python3
"""revenue 插件存量 → 平台主场域导出（增量 12，d4 人工执行模式）。

用法：
  python scripts/revenue-import/export_revenue.py "E:/Downloads/revenue_system (2).db"
产出（同目录）：
  - stadium-import.sql     平台 D1 执行的 INSERT SQL（按 clubs.name 精确匹配俱乐部 id）
  - stadium-import-report.md  迁移报告（匹配成功/冲突清单）

只迁：stadiums（容量/档位/死忠/球场名）、club_facilities（五类设施等级，原库多为 0 行）。
不迁：influence 旧单值（新口径=球员影响力按规则公式+队壳/奖励分，主规则 §5.1）；
      club_balance 余额（平台账本已有期初口径，不双写）。
"""
import os
import sqlite3
import sys

FACILITY_KEYS = ['commercial', 'broadcast', 'pitch', 'youth', 'medical']

SQL_HEAD = """-- revenue 插件存量导入（增量 12；由 scripts/revenue-import/export_revenue.py 生成）
-- 执行方式：D1 REST /query 或 wrangler d1 execute 人工执行（先确认 clubs 表俱乐部名匹配）。
"""
STADIUM_HEAD = """INSERT INTO stadiums (club_id, name, capacity, tier, shell_influence, bonus_points, fans, created_at, updated_at) VALUES
"""
FACILITY_HEAD = """INSERT INTO club_facilities (club_id, facility_key, level, updated_at) VALUES
"""


def main(db_path: str) -> None:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))

    stadiums = db.execute(
        'SELECT team_name, name, capacity, tier, influence, fans_diehards FROM stadium ORDER BY team_name'
    ).fetchall()
    facilities = db.execute(
        'SELECT team_name, facility_key, level FROM stadium_facilities'
    ).fetchall()
    fac_map: dict[str, dict[str, int]] = {}
    for r in facilities:
        fac_map.setdefault(r['team_name'], {})[r['facility_key']] = int(r['level'])

    stadium_lines = []
    facility_lines = []
    for s in stadiums:
        team = s['team_name']
        # 俱乐部名匹配：优先去后缀（revenue 里存的是球队全名，平台 clubs.name 同源）；对不上的进冲突清单
        stadium_lines.append(
            f"  ((SELECT id FROM clubs WHERE name = '{team}'), "
            f"'{str(s['name'] or '').replace(chr(39), chr(39) * 2)}', {int(s['capacity'])}, {int(s['tier'])}, 0, 0, {float(s['fans_diehards'])}, "
            "strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),"
        )
        for key in FACILITY_KEYS:
            level = fac_map.get(team, {}).get(key, 0)
            facility_lines.append(
                f"  ((SELECT id FROM clubs WHERE name = '{team}'), '{key}', {level}, "
                "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),"
            )

    sql_path = os.path.join(out_dir, 'stadium-import.sql')
    with open(sql_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(SQL_HEAD)
        f.write(STADIUM_HEAD)
        f.write('\n'.join(stadium_lines))
        f.write('\n\n')
        f.write(FACILITY_HEAD)
        f.write('\n'.join(facility_lines))
        f.write('\n')

    report_path = os.path.join(out_dir, 'stadium-import-report.md')
    with open(report_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('# revenue 存量导入报告（增量 12）\n\n')
        f.write(f'源库：`{db_path}`\n\n')
        f.write('| 球队 | 容量 | 档位 | 死忠 | 旧影响力（不迁，仅供人工校准队壳） |\n|---|---|---|---|---|\n')
        for s in stadiums:
            f.write(f"| {s['team_name']} | {int(s['capacity'])} | {int(s['tier'])} | {float(s['fans_diehards']):.0f} | {s['influence']} |\n")
        f.write('\n说明：\n')
        f.write('- SQL 按 `clubs.name = 球队名` 精确匹配写 club_id；执行前先核对平台俱乐部名与上表一致，对不上的行人工改名后执行。\n')
        f.write('- 队壳影响力（shell_influence）与奖励分（bonus_points）统一置 0，由管理组按主规则 §5.1 后台维护。\n')
        f.write('- 旧单值 influence 仅列于本报告供校准参考，不写入平台（新口径=Σ球员影响力+队壳+奖励分）。\n')

    print(f'written: {sql_path}')
    print(f'written: {report_path}')
    print(f'stadiums: {len(stadiums)}; facility rows: {len(stadiums) * len(FACILITY_KEYS)}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
