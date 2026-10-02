# 系统范围手机版窄屏整治 · 设计定稿（v6.20.0 首批：两端导航骨架 + 全站保底横扫）

**状态**：设计定稿（brainstorming 三轮裁决通过），v6.20.0 实施中。
**裁决记录**：① 深度 = 全站逐页移动化（用户裁决，预计拆 2-3 版）；② 整治立 **v6.20.0**（v6.19.0 球员库卡片化已独立收口，互不纠缠）；③ 第一批 = 两端导航骨架 + 全站保底横扫，编辑页卡片化重排留批 2/3。

---

## 0. 背景与现状（探查结论，2026-10-02）

- 无 Tailwind，全站单一手写 `web/src/styles.css`（3342 行）；viewport meta 已含 `viewport-fit=cover`。
- 断点实际三档：**640**（公开内容重排，styles.css:34/:685/:1241 等 10 处）、**760**（管理壳，:2472/:2608）、**900**（球员库级重排，:2124/:2380/:2875）。`UI_DESIGN.md` 写的「单一 640px 断点」与实际不符（本批订正）。
- 全站 `<table>` 精确盘点（B 批实施时脚本穷尽核对，48 张全部已被 `.table-wrap` 包裹且包裹 div 与 `<table>` 邻接，无裸表）——探查阶段「约 9 页裸表」系误报（把行号命中当成未包裹）；窄屏撑破的真实来源是**内联固定宽**与 **styles.css 固定 min-width / 媒体块缺失**。
- 管理侧栏 ≤760 塌成 static flex-wrap 行（:2608-2617，11 项挤 3 行）；公开顶栏 ≤640 两行 + 横滑 tabs（:685-731），但导航行无滚动提示、无 active 回位。
- TSX 内联固定像素宽重灾：BrandsPage 六处、SystemPage `18rem`、OverviewPage `9rem`、CoachPanel `90px` + 硬 nowrap；styles.css 固定 min-width 八处。
- 全站唯一完整移动化样板 = 球员库（v3.1.0 抽屉 + v6.19.0 铭牌卡）。可复用基建：`useMediaQuery`（web/src/lib/use-media.ts）、抽屉 pattern（`.lib-drawer-mask`:2113 + PlayersLibrary 焦点陷阱）、smoke.mjs 零溢出 helper（:320-325）与三视口先例。

## 1. 断点体系（全站统一，不新增第四档）

| 断点 | 管辖 | 语义 |
|---|---|---|
| ≤640px | 公开端内容 | 单列重排、触控目标、顶栏两行 |
| ≤760px | 管理端壳 | 侧栏抽屉、管理页保底 |
| ≤900px | 重排级 | 球员库表格→卡片/抽屉这类整表替换 |

## 2. Pattern 清单（各批共同基准）

- **P-表格保底**：一切 `<table>` 必包 `.table-wrap`；密集阅读表窄屏 = 规范横滚（本批不做卡片化），横滚容器加两侧渐隐边缘提示。
- **P-固定宽禁令**：TSX 内联与 CSS 中强制定宽/min-width → `min(N, 100%)` 或流式；浮层/下拉面板 → `min(N, 86vw)`（`.multiselect-panel` :1878 先例）；短数字/徽章上的 nowrap 无害可留。
- **P-触控目标**：交互目标 ≥36×36（≤640/≤760 各自媒体块内保证）。
- **P-抽屉**：导航类侧栏 ≤断点 变左滑抽屉（mask + × + Esc + inert 焦点陷阱 + `overscroll-behavior:contain` 锁滚），类名契约先行（e2e 依赖）。
- **P-顶栏**：两行布局（v2.3.0 定式）保持；导航行渐隐 + active tab 自动滚入；**公开端不加汉堡**——9 个 tab 横滑快切优于抽屉。
- **P-桌面零变化铁律**：每处窄屏改动必须证明宽屏 DOM/样式零变化（v6.19.0 同款）。
- **P-验收**：e2e 全路由 375×812 扫描断言 `doc.scrollWidth ≤ doc.clientWidth + 1` + 三视口截图抽查；任何路由溢出 = 整批不通过（最坏情况口径）。

## 3. v6.20.0 交付范围（三块）

1. **管理侧栏抽屉（≤760）**：AdminLayout 加「☰ 管理导航 · 当前页名」切换钮（仅窄屏渲染）；`.admin-sidebar` 媒体块内变抽屉。类名契约：`admin-nav-toggle` / `admin-sidebar.open` / `admin-drawer-mask` / `admin-drawer-close`。
2. **公开顶栏收纳（≤640）**：渐隐边缘 + active tab `scrollIntoView({inline:'center', block:'nearest'})`。
3. **全站保底横扫**：`.table-wrap` 已 48/48 全覆盖（无需补包，见 §0 更正）；内联固定宽清除（B2 实改 9 处：BrandsPage×6、admin MarketPage 裁定价、SystemPage 18rem、OverviewPage 9rem、CoachPanel 90px，全部 `min(N,100%)`；nowrap 5 处短控件保留）；styles.css 固定宽八处逐条裁量；e2e smoke 新增检查⑫（全路由 375 零溢出）与⑬（管理抽屉开合）。扫描首跑暴露的残余破版页属本批交付范围（保底定义），全部修绿。

## 4. 批次路线图

- **v6.20.0（本批）**：骨架 + 保底横扫 → 全站「375 不破版」，管理导航可单手用。
- **v6.21.0**：编辑面板与教练端重排——成长录入 11 列花名册 → 卡片式行内编辑（沿用 v6.19.0 铭牌卡设计语言）、BrandsPage/Imports 表单重排、CoachPanel 32 列粘性首列或列分组。
- **v6.22.0**：公开阅读页收尾（Player dossier、ClubDetail、market 四页卡片化）+ iOS 真机抽验（销 v3.1.0「锁滚真机未验」遗留）。

## 5. 已知不改 / 遗留

- `.admin-shell` 760 与球员库 900 两套断点并存是既成事实，本批不统一（动存量风险 > 收益）。
- v3.1.0 遗留「aria-modal 顶栏在 `<Routes>` 外不在 inert 区」：新抽屉照抄同款范式，一并遗留，v6.22 真机轮一并看。
- 微信内观感优先（家族策略）不变：不引入新依赖、不加运行时 CSS-in-JS，全部原生 CSS + 既有 hook。
