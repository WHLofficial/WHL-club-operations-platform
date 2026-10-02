# v6.22.0 窄屏整治第三批：公开阅读页设计（spec）

日期：2026-10-02 · 批次：窄屏整治第三批（v6.20 骨架横扫 → v6.21 编辑面板 → 本批公开阅读页） · 前置：v6.20.0+v6.21.0 已上线（Version `1d357c2c`），发布记录回写 docs 枚 `928834c`。

## §0 探查事实（2026-10-02，Explore agent 盘点）

- 严格公开路由仅 6 条：`/`、`/players`（v6.19.0 已卡片化）、`/players/:id`、`/clubs`、`/market`、`/market/intel`；`/clubs/:id` 与 `/bind` 挂 RequireUser。无独立赛程/积分榜路由。
- **Player.tsx（994 行，公开阅读重点）**：`.dossier` 双栏 `280px 1fr`（styles.css:837）只在 ≤640 塌单列（styles.css:1274-1276）→ 641–900 中屏主区被压到 ~420px。页签 `.seg.dossier-tabs`（Player.tsx:480）inline-flex 不折行（styles.css:1165-1171）。转会表 6 列（完成时间|类型|转出|转入|费用|赛季，:617-664，`.transfer-table` 全格 nowrap styles.css:1054-1057）与成长事件表 5 列（时间|事件|数值|XP|来源，GrowthBlock :961-991）均纯横滚无粘性——两表都是**事件型**数据。
- **MarketIntelPage**（131 行）：传闻 `.form-list` wrap 友好；已达成交易表 7 列（:89-122）纯横滚，公开页最宽表。
- **MarketBoardPage**（396 行）：`.market-grid` ≤640 塌单列（styles.css:1532-1536）基本可用；出价历史表 4 列（:365-393）横滚。
- **ClubDetail**（544 行，登录内）：阵容名单表 8 列（:394-429）横滚。
- 全局：`th{white-space:nowrap}`（styles.css:596-603）；顶栏页签渐隐 mask 只在 ≤640（styles.css:715-741）；toast z-index 100 盖 fixed 汇总条 z-15（v6.21 登记 P3）。

## §1 用户操作流线（本批核心承诺）

1. 球迷 375px 打开 `/players/:id` → 档案头部立即可读：`.dossier` 单列断点 640→**900**，641–900 中屏同样舒展；
2. 四页签 ≤760 可横滑（active 可达），不再被 inline-flex 撑破；
3. 「转会」页签 → 每条转会一张**事件卡**（卡头完成时间+类型徽标 / 转出→转入 / 费用 / 赛季），零横滑；「成长」页签事件同样卡片化（卡头时间+事件 / 数值 / 来源 / 金徽标 +X XP）；
4. 1280 桌面 DOM 逐字节零变化（两表表格分支原样保留含 nowrap）；
5. `/market/intel` 成交表 ≤760 粘住**前两列**（时间/类型），横滑看费用与双方时上下文不丢；
6. `/market` 出价历史表 ≤760 同样粘前两列；
7. `/clubs/:id` 阵容表 ≤760 粘「号码/球员」两列，横滑看年龄/CA/PA/工资时知道在看谁；
8. 641–1024 中屏顶栏页签溢出时贴边渐隐提示可滑（现只在 ≤640）；
9. toast 弹出不再遮挡/吞掉底部常驻汇总条的点击（pointer-events 穿透 + 必要时位置让位）。

## §2 范围与关键裁决

- 对象五处：Player.tsx、MarketIntelPage、MarketBoardPage、ClubDetail、TopBar 渐隐 + toast。Clubs/Home/PlayersLibrary 零改动。
- **表格策略二分**（v6.21 裁决延续）：事件型（Player 转会 6 列 / 成长 5 列）→ 窄屏卡片化（useMediaQuery 分支，两端 DOM 互斥）；参考型宽表（intel 7 列 / 出价 4 列 / 阵容 8 列）→ CSS-only 粘性前两列，零 TSX 状态。
- **粘性类名泛化**：新增 `.table-sticky-2`（≤760 生效，前两列 th+td sticky），规则内容照抄 `.coach-sticky` ≤640 块（显式底色三态防透底、z-index 分层、右缘描边）；**coach-sticky 原块不动**（CoachPanel.tsx 零改动、TC-SWP-05 不破）。统一前两列口径（含出价历史表）。
- `.dossier` 900 档：PlayersLibrary 已确立 900 为阅读布局档，属既有档位非扩散（v6.21「900 档不扩散」指卡片化分支，本批是布局重排）。
- 零迁移零生产写；纯前端 + e2e + 静态闸门。

## §3 类名契约

- 事件卡：`.event-cards` / `.event-card` / `.event-card-head` / `.event-card-grid` / `.event-card-foot`（铭牌语言 #fffdf7 底/#e6dcc8 描边/12px 圆角/焦橙 focus-visible，字号随 .lib-card）。Player 窄屏常量 `PLAYER_CARDS_QUERY='(max-width: 760px)'`。
- 粘性表：`.table-sticky-2`（≤760）。
- 事件卡数据语义（照抄表格版逐条）：转会卡 = 完成时间 `slice(0,10)` / `TRANSFER_TYPE_LABEL[t.type] ?? t.type` / `fromClubName ?? '自由身'` → `toClubName ?? '自由身'` / `fee===null?'—':fee.toFixed(2)+' m'` + extraFee 后缀 / `S{season} 第 {windowSeq} 窗`；成长卡 = `createdAt.slice(0,10)` / `GROWTH_EVENT_LABEL[e.eventType] ?? e.eventType`（milestone 附 `（进+攻 {value}）`） / value / `+{xp}` 金徽标 / `e.source==='manual'?'管理组补录':'赛果同步'`。

## §4 e2e ⑯ 与静态闸门（主会话自留）

- **⑯ 公开阅读几何**：375 下 `/players/:id`（id 取自 `/api/players?limit=1`）`.dossier` 单列 + `.dossier-tabs` 横滑规则真生效（computed `overflow-x:auto + flex-wrap:nowrap`，评审 P1-1 补：375 实测页签内容 ~245px 不溢出，几何断言不成立，钉 computed 才拦得住删块/挪块）+ `.event-cards` 在场/`.transfer-table` 不在场 + 卡 fit ±1px + 页签无文档级溢出；768 同断言（900 档覆盖）；1280 双栏 280px+1fr + 表格分支在场 + event-cards count 0；375 `/market/intel` 成交表横滑后**第二列**留视口（强于首列 left=0：粘性失效时第二列必被滚走）+ 首列/第二列无缝 |th1.right−th2.left|≤1px（评审 P2-2 补：:has 认表与 --stky-c1 错位时红）+ computed sticky + 1280 static。
- **静态闸门**（tests/mobile-baseline.test.ts 增例）：`.table-sticky-2` 规则级断言（≤760 块）+ `.coach-sticky` 原块仍在；event-cards 类名 token 正则 + narrow/桌面互斥 + `PLAYER_CARDS_QUERY` 字面；≤1024 渐隐 mask 规则在场 + 全局 `.nav-links` 可横滑规则级红线（评审 P3）；**媒体块归属**：② 页签横滑 / ③ 事件卡五类名 / ④ sticky-2 规则必须钉在各自的 ≤760 块内（评审 P1-1/P2-1 补，V4 类挪块变异只有归属断言能拦）；既有白名单双向核对不回归。

## §5 验收

typecheck 三份清；vitest ≥69 文件全绿（基线 69/1219 + 新静态例）；build 成功；e2e 16/16；code-review-skill 独立评审修登分明；桌面 1280 Player/market 三页 DOM 零变化；测试计划落地率 100%（静态可固化项）+ iOS 真机手动抽验清单交付（v3.1.0 遗留锁滚销项 + safe-area/粘性/触控）。收口 bump 6.22.0 三件套，push 等令。

## §6 已知不改（登记）

MarketIntel 卡片化（粘性足够，留第四批评估）；`.hint` 长文阅读密度；ClubDetail 移出 RequireUser（产品决策非本批）；Player 280px 左栏桌面语义不变；`.dossier-table`（2 列合同卷宗）不动。
