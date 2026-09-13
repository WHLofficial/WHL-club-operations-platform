# WHL 俱乐部运营平台 · bot 通知接收插件

AstrBot 侧接收插件（TECH_DESIGN §12）：收平台 HMAC 签名 POST `/notify`，验签后发 QQ 私信。
协议照抄竞猜系统 `docs/astrbot-sync-api.md` 的签名契约，与赛事/竞猜的对接插件相互独立。

## 安装

1. 把本目录整体拷到 AstrBot `data/plugins/astrbot_plugin_whl_club_notify/`；
2. 重载插件，配置项：
   | 配置 | 说明 |
   |---|---|
   | `notify_enabled` | 总开关（默认关） |
   | `sync_secret` | 与平台 `SYNC_SECRET`（wrangler secret）一致的共享密钥 |
   | `notify_listen_host` / `notify_listen_port` | HTTP 监听（默认 127.0.0.1:9992） |
   | `notify_platform_id` | 发消息用的平台实例 id（留空自动用第一个） |
3. 平台侧 `SYNC_BASE_URL` 指向本机穿透后的公网入口（Cloudflare Tunnel 等）；
4. 用户先在平台网页绑定 QQ（qq_links，QQ 桥增量交付后由 `/绑定` 命令写入），没绑的不发。

## 事件与模板

| template | 触发 | 文案示例 |
|---|---|---|
| `result_confirmed` | 管理组确认赛果 | 📋 赛果已确认：阿森纳 2:1 曼城（S3·窗1 · league_premier）。 |
| `levelup` | 球员升级 | 🎉 张三 升级完成：+1 CA。 |

文本由平台侧渲染好直接发（`text` 字段），插件不按 template 分支处理。

## 联调

平台侧本地跑 `SYNC_BASE_URL=http://127.0.0.1:9992 SYNC_SECRET=<同插件> npm run dev`，
管理组确认一场赛果 → 看插件日志与 QQ 私信；`POST /api/cron/tick` 可手动触发重投。
