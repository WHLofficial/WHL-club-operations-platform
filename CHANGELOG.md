# 变更记录

本项目按「增量」推进，每次生产部署以 Cloudflare Worker 的 Version id 标记（仓库无 git tag）。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

各增量的裁决、交付清单与验收数字见 [ROADMAP.md](./ROADMAP.md)。

## [未发布]

暂无。下一批改动从增量 25 起累积。

## [已上线] · 增量 17–24 — Version 90bfd78f（2026-09-20）

2026-09-20 推送 50 个提交（`9f05116..fe60273`）→ 生产迁移 apply 0022–0027（生产迁移现到 0027）→ 部署 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`。生产回读：`/api/health` 三资源 ok；0026 的 CPU 回填核对通过（id 10 / 241 / 112172 / 131681 均 `is_cpu=1`）；增量 17–23 新增路由在生产返回 401（未登录）而非 404。

### 新增

- **球员库**：接口补 `total` 与整套筛选域（身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/细分属性区间/合同域）；页面改版为 SoFIFA 式可变列 + 更多筛选折叠面板 + URL query 持久化（增量 17）。
- **俱乐部目录工具**：新建俱乐部必填游戏队号（赛事库校验 + 队名预填 + 指定 id 建行 + 认证目录 upsert，失败可重试）；`GET /api/clubs/directory`；管理端多教练绑定逐个解绑；换队号 rekey 只读预演工具 `scripts/rekey-team/`（增量 17）。
- **站内信收件篮**：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`，未读判定用独立列 `read_at`（迁移 0022），赛果确认与升级两处写入点内部改双通道（每个绑定账号一条 web 行进收件篮，绑了 QQ 的另加一条 qq 投递行）（增量 18）。
- **设施经营**：球场扩建、档位升级、子设施升级与建设券（迁移 0023 给 `stadiums` 加 `build_credit` 列），用户端 `GET /api/club/stadium/build-info` 与 `expand` / `upgrade` / `facilities/upgrade`，管理端 `GET|POST /api/admin/clubs/:id/stadium`；建设支出按 25% 返券、券只抵后续建设支出（先券后钱），config 新增 `facility_prices` 与 `stadium_max_open_tier` 两键（增量 19）。
- **冠名市场**：品牌池报价 / 签约 / 退约 + 窗末收租（迁移 0024 `naming_contracts`，费用条款快照列化 + 部分唯一索引拦一队双签），`GET /api/club/naming/quote` 与 `sign` / `terminate`，config 新增 `naming_params`（增量 20）。
- **赛果自动化**：cron 自动确认赛果（每轮上限 20 场，actor=0 系统留痕）、通知钩子重放 `POST /api/admin/results/:id/replay-hooks`、人工复核（迁移 0025 给 `result_confirmations` 加 `needs_review` / `review_note`）与 auth 三事件审计，config 新增 `results_auto_confirm`（增量 21）。
- **换版机制**：小换版 / 大换版两种模式（CA 换算与成长清零口径），导入预览警告与合同校验（增量 22）。
- **性能与守护**：`players` 四条排序表达式索引（迁移 0027）；公开 GET 的进程内限流与 TTL + stale-while-revalidate 缓存（`src/lib/guard.ts`，`PUBLIC_CACHE_TTL_MS`）；e2e 冒烟脚本 `scripts/e2e/smoke.mjs`（8 场景）与 `npm run test:e2e`（增量 23）。

### 变更

- `clubs.is_cpu` 列化（迁移 0026，由队名后缀回填），CPU 队不再靠名称判断（增量 22）。
- 顶栏响应式重排：桌面单行，窄屏品牌/用户区与导航分两行横滑（增量 17）。
- 公开 GET 的缓存与限流都是 isolate 内 `Map`：重启即清、多 isolate 不共享；KV 方案因免费档写配额否决。

### 修复

- 赛果通知钩子重放会重复发通知：重放跳过通知钩子（增量 21 收口审查发现）。
- 确认钩子（XP / 通知 / 奖金 / 上座）原先同步执行且裸奔，任一失败会把已入档的确认炸掉并让重试撞 409：改为逐个吞错收集（增量 21）。
- 账本幂等闸原按 `(kind, ref_type, ref_id)` 全局查重，多队同窗结算只有第一队落账：改按 `(club_id, kind, ref_type, ref_id)`（增量 20 前置修复，生产未触发）。
- 收件篮「标记已读」在 ids 超过 D1 单查询绑定参数上限 100 时报 500：改按 100 分块 `db.batch`（增量 18 收口审查发现）。
- 设施升级批次漏了 `build_credit` 的 UPDATE，建设券只进提示不落库（增量 19 冒烟发现）。
- 合同导入的 `clubId` 不存在时预览放行、落库才撞外键 500：preview 与 confirm 都改 404（增量 22）。
- 换队号 rekey 在换壳模式下 `tour_team_id` 空闲但认证库 `club_id` 已被占，只在执行期才炸：预演加撞号闸（增量 17）。
- 缓存键直接用原始查询串导致 `?a=1&b=2` 与 `?b=2&a=1` 重复装载：改为 `canonicalQuery` 归一；缓存条目无上限（键外部可控）会堆内存：加 64 条上限按插入序淘汰（增量 23 收口审查发现）。
- 球员库「上一页」用 `fetchPreviousPage` 会与页码错位，改为页码状态 + 缓存回退；无限查询最后一页按钮仍亮（v5 里 `getNextPageParam` 返回 `null` 仍算有下一页）（增量 16 收口审查发现）。

### 文档

- `README.md` 重写（原先只有一行标题）：定位、文档索引、技术栈、快速开始、命令表、绑定资源与权限、迁移纪律、测试、目录结构、部署现状（增量 24）。
- 新建项目级 `AGENTS.md`（危险操作清单、开发与测试口径、代码与提交规范）与 `CHANGELOG.md`（本文件）、`scripts/README.md`（脚本性质分级 + 生产工件执行状态）（增量 24）。
- `TECH_DESIGN.md` 与代码对齐：§13 补 5 个已落地 config 键并修正 2 个「待定」键、§15 假设加分类口径与编号归位、§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写并写明「不用 KV 做 SWR」的裁决、§12 与假设 23 记 web 收件篮落地、附录 A 通知行拆分并标注冻结范围（增量 24）。
- 删除过期草稿 `handoff-20260916.md`（停在增量 12），其中仍有效的三条（球员库逐队源数据位置与字段口径、导入通道选择、`--file` 通道外键陷阱）已迁入 ROADMAP 与 `scripts/README.md`（增量 24）。

### 待办

- push 与部署已于 2026-09-20 完成（见本节开头的部署记录）；0027 的 7.3 万行写已随当日 apply 计入。
- 生产回填已于 2026-09-20 执行完毕：16 队队籍（`scripts/prod-20260919-roster-backfill/`，444 人，只写队籍不造合同），复查全库 assigned 551 = 4 支 CPU 队 107 + 本批 444、free 17750。
- `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）回填已于 2026-09-20 部署后核对通过（均 `is_cpu=1`）。
- 遗留：球员库 30 人缺字段补录未执行（源数据缺 `naID`/`FootID`，`scripts/players-import/overlay-missing.ts`）。

## [已上线] · 增量 16 用户端重构 — Version 6ed7446c（2026-09-19）

- Market 拆为三页：`/market`（挂牌板 + 详情出价，公开）、`/market/free`（海捞签入 + 训练营激活，需登录）、`/market/mine`（我的挂牌 + 我的出价，需登录）。
- 用户端登录守卫 `RequireUser`（软卡不重定向）与 `AuthContext`（`/api/me` 全站单点拉取，顶栏/首页/管理端的 props 钻透退役）。
- 用户端 8 页数据层接入 TanStack Query，写后精确 invalidate。
- 注册合规逐人标红：按球员展开行级红底 + 规则短标签。

## [已上线] · 增量 15 管理端重构 — Version 4d03eb57（2026-09-19）

- 管理端从单页拆为左侧栏壳 + 8 个子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；后端 `admin.ts` 拆为 `routes/admin/` 八域，URL 零变更。
- 新增暂停出价：全局 config 开关 `market_bid_paused` + 单挂牌列（迁移 0021 `listings.bid_paused`），只挡新出价，不改变结算时刻。
- config 超管全开（独立权限点 `club.config.manage.super`，GET 明文 / PUT 逐键编辑 + 审计 `config_set`）、`GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1`）、`GET /api/admin/audit-log`。
- 统一两段式确认按钮 `ConfirmButton`，批量维护改结构化逐行预览。

## [已上线] · 早期增量 0–14（2026-09-12 ~ 2026-09-19）

- 增量 0 地基：纯 Worker + 共享登录 + schema + SPA 壳。
- 增量 1 球队与球员主数据（管理端最小集）。
- 增量 2 阵容注册与合规。
- 增量 3 转会市场（挂牌竞价链）。
- 增量 4 签约谈判（signing）。
- 增量 5 旁路操作 + 激活匹配 + 窗口。
- 增量 6 财政、赛季与通知（MVP 收口）；6.1 走查修复与球员库（四裁决落地）。
- 增量 7 球队绑定上收认证中心（auth + tour + club 三仓，`AUTH_DB` 只读接入）。
- 增量 8 球员库统一 + FC26 ID 对齐。
- 增量 9 分级派生（报名定级，club 单仓）。
- 增量 10 异常告警 + 管理介入 + 批量维护。
- 增量 11 赛季结算域。
- 增量 12 主场收入域（存量主场数据迁移）。
- 增量 13 成长域校准（成长期 / 解约清零 / 中国计划闸门）。
- 增量 14 CPU 队与队籍口径（`clubs.is_cpu` 代码侧与球员库首灌）。

早期各次的部署 Version 记录见 `wrangler deployments list --name whl-club` 与 ROADMAP 对应章节。
