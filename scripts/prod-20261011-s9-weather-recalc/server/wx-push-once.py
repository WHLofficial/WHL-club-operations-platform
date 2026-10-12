#!/usr/bin/env python3
"""天气推送一次性触发器（插件 v2.12.0）——给「没有 QQ 发消息能力」的执行者用。

为什么需要它
------------
插件侧的正式入口是 QQ 群管理员指令 `/主场天气推送 [预览]`。执行本批的 AI 助手不在
群内、也无法代发群消息，因此本脚本用与插件 `main.py:initialize()` **完全相同**的方式
装配服务栈（同一个 DatabaseManager / StadiumDAO / StadiumService / FixtureService），
直接调用 `FixtureService.sync_weather()`：

    补抽系数（UPDATE matches SET wx_coef WHERE id=? AND wx_coef IS NULL，幂等）
      → 推送平台 /api/internal/weather-sync（HMAC-SHA256，规范串 POST|path|ts|body）
      → 已结算且系数为空的场次冲正旧账（apply_weather_correction 单事务，守卫+锚去重）

与 QQ 指令的唯一差别是不经过 handler 的文案包装，业务路径逐行相同。

安全默认
--------
默认 **预览**（`sync_weather(preview=True)`：只算不写不推）。要真正落库+推送必须显式
`--commit`。预览模式下 `_settlement_inputs(create_missing=False)`，不会新建球场行。

用法（服务器上，用 AstrBot 自己的 Python，使 astrbot.* 可导入）
---------------------------------------------------------------
    python wx-push-once.py \
        --plugin-dir  <astrbot>/data/plugins/astrbot_plugin_whleague_revenue_system \
        --db          <astrbot>/data/plugin_data/astrbot_plugin_whleague_revenue_system/revenue_system.db \
        --config-json <astrbot>/data/config/astrbot_plugin_whleague_revenue_system_config.json \
        --set club_sync_url=https://club.whleague.win \
        --set club_sync_secret=<WEATHER_SYNC_SECRET> \
        [--use-db-config] [--commit] [--out result.json]

建议先跑不带 `--commit` 的预览，核对轮次/场次数/订正明细，再跑 `--commit`。
执行期间最好先停掉 AstrBot（同一 SQLite 文件避免写锁竞争）；脚本自身会跑 init_schema，
因此即使 AstrBot 没启动过 v2.12.0，schema 也会在本次自动迁到 v13。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="触发插件 weather sync（预览默认，--commit 才落库推送）")
    p.add_argument("--plugin-dir", required=True, help="插件包目录（含 main.py 的那一层）")
    p.add_argument("--db", default="", help="插件 SQLite 全路径；省略则用 astrbot 插件数据目录的默认库")
    p.add_argument("--config-json", default="", help="AstrBot 托管配置（<plugin_dir_name>_config.json）")
    p.add_argument("--use-db-config", action="store_true", help="再叠加 plugin_config 表里的持久化配置")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="单键覆盖，可重复")
    p.add_argument("--commit", action="store_true", help="真正落库 + 推送（默认只做预览）")
    p.add_argument("--out", default="", help="把结果 JSON 写到文件")
    return p.parse_args()


def _load_config_file(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    # AstrBotConfig 落盘的就是该插件自己的配置字典；兼容被整体包裹的情形
    node = raw.get("astrbot_plugin_whleague_revenue_system")
    return node if isinstance(node, dict) else raw


async def _run() -> int:
    args = _parse_args()

    plugin_dir = os.path.abspath(args.plugin_dir)
    pkg_name = os.path.basename(plugin_dir)
    sys.path.insert(0, os.path.dirname(plugin_dir))

    import importlib

    pkg = importlib.import_module(pkg_name)
    defaults = importlib.import_module(f"{pkg_name}.config.defaults")
    conn_mod = importlib.import_module(f"{pkg_name}.db.connection")
    dao_mod = importlib.import_module(f"{pkg_name}.db.dao")
    schema_mod = importlib.import_module(f"{pkg_name}.db.schema")
    fixture_mod = importlib.import_module(f"{pkg_name}.services.fixture_service")
    bridge_mod = importlib.import_module(f"{pkg_name}.services.negotiation_bridge")
    stadium_mod = importlib.import_module(f"{pkg_name}.services.stadium_service")

    # ── 配置：DEFAULT_CONFIG → AstrBot 托管配置 → plugin_config 表 → 命令行覆盖
    cfg = dict(defaults.DEFAULT_CONFIG)
    for key in defaults._LIST_KEYS:
        cfg[key] = defaults.parse_group_list(cfg[key])
    if args.config_json:
        for key, value in _load_config_file(args.config_json).items():
            if key in defaults.DEFAULT_CONFIG:
                cfg[key] = value

    db = conn_mod.DatabaseManager(args.db or None)
    await db.init()
    dao = dao_mod.StadiumDAO(db)
    await schema_mod.init_schema(db)

    if args.use_db_config:
        for row in await dao.get_all_config():
            key = row["key"]
            if key in defaults.DEFAULT_CONFIG and key != "schema_version":
                try:
                    cfg[key] = defaults.validate_and_cast(key, row["value"])
                except ValueError:
                    continue

    for item in args.set:
        key, _, value = item.partition("=")
        cfg[key] = value

    print(f"[cfg] db={args.db or '(astrbot 默认)'} version={pkg.__name__} "
          f"club_sync_url={cfg.get('club_sync_url')!r} "
          f"club_sync_secret={'<set,len=%d>' % len(cfg.get('club_sync_secret') or '')}")

    service = fixture_mod.FixtureService(
        db, dao, cfg, stadium_mod.StadiumService(db, dao, cfg, bridge_mod.NegotiationBridge(cfg))
    )
    try:
        result = await service.sync_weather(preview=not args.commit)
    finally:
        await db.close()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)
        print(f"[out] {args.out}")
    return 0


def main() -> int:
    try:
        return asyncio.run(_run())
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # 业务异常（FixtureError 等）打印人话后非零退出
        print(f"[error] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
