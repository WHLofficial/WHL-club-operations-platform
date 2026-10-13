# 服务器侧运行手册 · 插件 v2.12.0 部署 + 全量天气推送

> 状态：**待执行**（阻塞在服务器 SSH 凭据；平台侧已完成并上线）
> 对象：AstrBot 服务器 `111.229.8.143`（SSH 22 / AstrBot 面板 6185 / 宝塔 27082）
> 目标：把插件从 v2.11.7 升到 v2.12.0（schema v13 + 天气推送），然后触发一次全量天气推送
> —— 推送即把插件侧「轮前掷定」的天气系数写成平台侧权威记录，供订正批使用。

## 0. 为什么需要 `wx-push-once.py`

插件侧正式入口是 QQ 群管理员指令 `/主场天气推送 [预览]`。执行本批的是 AI 助手，不在群内、
也无法代发群消息，因此用 `wx-push-once.py` 以**与 `main.py:initialize()` 相同的方式**装配
服务栈后直接调用 `FixtureService.sync_weather()`：同一个 DAO、同一套补抽/冲正 SQL、同一份
HMAC 签名实现。唯一差别是不经过 handler 的文案包装。

默认**预览**（只算不写不推），真正落库+推送必须显式 `--commit`。

## 1. 平台侧前置（已完成，2026-10-12）

- 平台 v6.44.0 已 push 并部署：CF Workers Builds **Version `1daf0aaf-924f-4f6f-960a-1975d9dd11c9`**
  @2026-10-12T04:40:07Z；站点资产 `assets/index-Bq3_6zyQ.js`（版本串 6.44.0）。
- `WEATHER_SYNC_SECRET` 已用 `wrangler secret put` 装入 Worker `whl-club`（Version
  `313aa3c6-92d5-4dc3-9e81-b6905098629b` @04:38:52Z）。密钥值见本仓 `scratch/weather-sync-secret.txt`
  （gitignore，仅本地保存）。
- 端点活体验证（全部用会被拒的请求，零写入）：

  | 请求 | 响应 |
  | --- | --- |
  | 无签名 | `403 {"error":"bad_signature","message":"签名校验失败"}` |
  | 坏签名 | `403` 同上 |
  | 好签名 + `{}` | `400 {"error":"bad_season","message":"season 应为正整数（收到 undefined）"}` |
  | 好签名 + 未知竞赛 | `400 {"error":"unknown_competition",…}` |

## 2. 服务器步骤（按序）

用 AstrBot 自己的 Python（使 `astrbot.*` 可导入）；`<AB>` = AstrBot 根目录。

```bash
# ① 备份（先停服务再复制，避免 WAL 撕裂）
systemctl stop astrbot            # 或宝塔「进程守护」里停；具体服务名以服务器为准
tar czf /root/backup-plugin-$(date +%Y%m%d%H%M).tgz \
  <AB>/data/plugins/astrbot_plugin_whleague_revenue_system \
  <AB>/data/plugin_data/astrbot_plugin_whleague_revenue_system/revenue_system.db*

# ② 上传 v2.12.0 源文件（11 个，其余测试/文档不必上服务器）
#    main.py / metadata.yaml / _conf_schema.json / requirements.txt
#    config/defaults.py / db/schema.py / db/dao.py
#    services/formula.py / services/fixture_service.py / services/club_sync.py（新）
#    handlers/admin.py

# ③ 依赖
<AB>/venv/bin/pip install "aiohttp>=3.9,<4"        # 或 pip install -r requirements.txt

# ④ 配置：写进 AstrBot 托管配置（WebUI 同一份）
#    <AB>/data/config/astrbot_plugin_whleague_revenue_system_config.json
#    加 "club_sync_url": "https://club.whleague.win"、"club_sync_secret": "<WEATHER_SYNC_SECRET>"

# ⑤ 取证（只读，七段：schema/轮次/天气分布/league_state/账本/队名拼写/已结算明细）
sqlite3 <AB>/data/plugin_data/astrbot_plugin_whleague_revenue_system/revenue_system.db \
  < 00-plugin-forensics.sql

# ⑥ 预览（只算不写不推）——核对轮次、场次数、订正明细
<AB>/venv/bin/python wx-push-once.py \
  --plugin-dir <AB>/data/plugins/astrbot_plugin_whleague_revenue_system \
  --db <AB>/data/plugin_data/astrbot_plugin_whleague_revenue_system/revenue_system.db \
  --config-json <AB>/data/config/astrbot_plugin_whleague_revenue_system_config.json \
  --out /root/wx-preview.json

# ⑦ 正式推送 + 旧账冲正（同一 SQLite 文件，执行期间保持 AstrBot 停止）
<AB>/venv/bin/python wx-push-once.py ...同上... --commit --out /root/wx-push-result.json

# ⑧ 起服务
systemctl start astrbot
```

脚本自身会跑 `init_schema`，因此即使 AstrBot 尚未以 v2.12.0 启动过，schema 也会在本次自动迁到 v13。

## 3. 回执口径

`--commit` 的结果 JSON 里逐轮给出 `matches / fixed / corrected / skipped / push`：

- `fixed` = 本次固化系数的场次（`wx_coef IS NULL` → 写入）；
- `corrected` = 本次冲正的旧账场次（`attendance` 旧→新 + `delta` 金额），与插件账本流水同源；
- `push.status` = `ok` / `bypass` / `error`，`ok` 时附平台响应（`summary.pushed` 落库场次、
  `settled` 已结算场次、`unmatched` / `skipped_no_stadium` / `bad_weather` 计数）。

QQ 指令的回执把同样的数字折算成「平台落库 N/M 场」+「其中 M 场已结算」。

## 4. 之后（平台侧，本机执行）

```bash
node scripts/prod-20261011-s9-weather-recalc/capture-authoritative.mjs   # 抓 forecast_by='revenue-plugin'
node scripts/prod-20261011-s9-weather-recalc/gen-recalc-sql.ts --ts=<ISO> # 出 02*/02a/03*/rollback/report
```

生成的订正 SQL **已于 2026-10-13T01:32Z 执行完毕**（237/237 句、账本 78 行 +0.63、守恒 0.00、收敛 81/81；见该目录 `README.md` §4 与 `report.md` §10）。
