# 系统范围手机版窄屏整治 · 第二批设计定稿（v6.21.0：编辑面板与教练端重排）

**状态**：设计定稿（计划经用户批准，2026-10-02），v6.21.0 实施中。
**上批**：v6.20.0（`docs/superpowers/specs/2026-10-02-mobile-remediation-design.md`，骨架 + 保底横扫，本地完成待发布）。批次路线沿用其 §4。

## 0. 范围与探查现状（2026-10-02）

四块，全部纯前端 + e2e，零迁移零生产写：

| # | 目标 | 现状 |
|---|---|---|
| ① | 成长录入花名册卡片化 | `web/src/pages/admin/GrowthEntryPage.tsx`（761 行）：entry-panel = 主/客队 seg chip + 本场合计金徽标 + 全部保存/收起 + guard() 脏检测；花名册 `entry-table` 11 列（球员\|位置\|出场\|评分\|零封\|夺回球权\|扑救\|进球\|助攻\|本场XP\|操作），样式 styles.css:1348-1380 |
| ② | BrandsPage 卡片化 | `web/src/pages/admin/BrandsPage.tsx`（338 行）：赞助表（品牌\|行业 w96\|热度 w72\|档位 select84+锁\|操作）行内编辑 + 新增表单 3 inputs + 报价阅读表（品牌\|球队\|金额\|套餐\|状态\|到期） |
| ③ | ImportsPage 表单重排 | `web/src/pages/admin/ImportsPage.tsx`（381 行）：label.field 表单为主，ImportPreviewBlock 两小表已包 table-wrap |
| ④ | CoachPanel 粘性首列 | `web/src/pages/club/CoachPanel.tsx`（1322 行）四表约 28 列：财务 10 列（窗口\|对手\|比分\|赛果\|天气\|上座\|票务\|商业\|转播\|合计）:217、档位 5 列:703、事件 4 列:848、花名册 9 列（号码\|球员\|位置\|年龄\|CA\|PA\|工资\|合同\|分配，seg 行内编辑）:1040 |

测试耦合面：`tests/growth-match-entry.test.ts` 是 API 级；`web/src/pages/ClubDetail.test.tsx:201` 只挂载 CoachPanel 不断言表结构；`tests/mobile-baseline.test.ts` 白名单含 BrandsPage width 96/72/84——**订正**：卡片化后桌面表格分支保留这三处内联定宽（评审 P0-1 的桌面列宽回退），白名单条目**保留不动**且「每条恰中 1 次」必须继续成立（批准计划文本里「删三条」作废，以本节为准）。

## 1. 设计裁决

- **CoachPanel 选「粘性首列」否决「列分组」**：粘性保住 P-表格保底（密集阅读 = 规范横滚），零新增状态、零隐藏数据；列分组要折叠状态机 + 隐藏数据，触控成本与回归风险都高。
- **断点**：管理页卡片化统一 **≤760**（与管理壳同档，不给管理端引入第四种行为）；CoachPanel 粘性 **≤640**（club 公开页档）。900 档不扩散（球员库专属）。
- **实现方式**：卡片化用 `useMediaQuery`（`web/src/lib/use-media.ts`）**分支渲染**——窄屏渲染卡片、桌面渲染原表格，两端 DOM 互斥（桌面零变化铁律；mobile-baseline TC-SWP-01 数的是 TSX 源码 `<table>`，桌面分支保留则 48/48 不变）。粘性纯 CSS 媒体块。
- **桌面零变化铁律**照 v6.19.0/v6.20.0 同款执行。

## 2. 用户操作流线

### ① 成长录入（≤760 卡片）
1. 管理侧栏「成长录入」（窄屏经 v6.20.0 抽屉）→ 比赛列表保持横滚阅读 → 点「录数据」行内展开面板。
2. 面板头：主/客队 chip 可换行、≥36 触控；金徽标本场合计 +XP。
3. 花名册变**单列卡片流**，每球员一卡（沿用 v6.19.0 铭牌卡语言 styles.css:3253 起：#fffdf7 底、#e6dcc8 描边、12px 圆角、focus-visible 橙框）：
   - 卡头：球员名 + 位置徽章 + 状态徽标（已录来源 / 训练营 / 校验问题）。
   - 字段网格（2 列）：出场大 checkbox、评分（`inputmode=decimal` 拉数字键盘）、零封 checkbox、夺回球权、扑救。
   - 只读条：进球 / 助攻（自动通道已录值，标「自动」）。
   - 卡脚：本场 XP 实时复算金徽标 + 本行保存钮（脏行高亮）。
4. 状态规则与现表格完全一致：已录格 = 禁用控件 +「已录」徽标（重复提交 no-op、无纠正通道如实标注）；trainee 整卡置灰 +「训练营不按场次计」；校验失败字段红框。
5. **粘性汇总条**（面板内 sticky，`entry-sumbar`）：本场合计 XP + 脏行数 + 「全部保存」——窄屏下全部保存从 entry-head 移入汇总条，单手拇指够得着；桌面不渲染汇总条。
6. 切队 / 收起 / 切路由的 guard 确认条不变；「查看」模式全卡只读标来源。

### ② BrandsPage（≤760 卡片）
赞助品牌表 → 卡流：卡头品牌名 → 行业 / 热度 / 档位（select + 锁 checkbox 同排）字段网格 → 卡脚 保存 / 删除（复用行处理器）；新增品牌表单三字段全宽堆叠；报价表为阅读表保持横滚。**桌面表格分支原样保留（含 width 96/72/84 内联定宽与白名单）**。

### ③ ImportsPage（≤760 表单重排）
label.field 单列全宽、textarea/select 100%；两小表保持横滚。CSS 为主，预期零 TSX 改动。

### ④ CoachPanel（≤640 粘性）
财务表与花名册 `<table>` 加 opt-in 类 `coach-sticky`：前两列（窗口+对手 / 号码+球员）`position:sticky; left:0`，显式背景 + 右缘分隔阴影防透底；档位/事件表不粘；全部包 ≤640 媒体块。

## 3. 类名契约（e2e 依赖）

`entry-cards` / `entry-card` / `entry-card-head` / `entry-card-grid` / `entry-card-foot` / `entry-sumbar`；`brand-cards` / `brand-card` / `brand-card-grid`；`coach-sticky`（table 级 opt-in）。

## 4. e2e 与测试联动

- **⑭ 成长录入卡片流**（375：开面板 → 改评分 → XP 徽标实时变 → 保存 → 已录锁定态 → 查看模式只读）。前置：本地 dev 库迁移状态核查，必要时 apply + 种子一场已确认比赛（本地 TOUR_DB 旧 schema admin 端点 500 有 ⑪ 后置先例）。
- **⑮ CoachPanel 粘性**（375：财务表横向滚后对手列仍可见且 computed position:sticky；1280 无粘性）。
- ⑫ 26 路由零溢出自动回归；vitest 白名单不动；API 级测试不受影响，按失败小修 + 补卡片状态用例。

## 5. 实施动线与验收

动线（延续 m00396 裁决「中档/复杂交 subagent、简单自己做」）：subagent A（重）= GrowthEntryPage 卡片化 + **styles.css 全部新块**（含 ②③④ 类名；B 禁改 styles.css——v6.20.0 先例）；subagent B（中）= BrandsPage / ImportsPage / CoachPanel TSX；subagent C = qa-test-planner → `docs/test-plans/v6.21.0-edit-panel-mobile.md`；主会话 = spec/e2e ⑭⑮/整合验证/code-review/收口 bump 6.21.0。

验收：typecheck 三份全清；vitest ≥69 文件全绿（白名单不动保持绿）；build；e2e 15/15（⑫ 26/26 + ⑭⑮）；桌面 1280 DOM 零变化（卡片分支桌面不渲染、粘性 ≤640 才生效）；code-review 收敛后合入。push 等令（与 v6.20.0 可一次 push）。
