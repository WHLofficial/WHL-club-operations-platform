# 球员库移动端卡片化 · 设计定稿（v6.16.0 前置）

- 日期：2026-10-02
- 状态：**设计定稿，未实现**。实现（源码 / 测试 / 收口）等用户另行下令。
- 流程：brainstorming（superpowers）三版式选型 → visual companion 逐细节可视化迭代 12 屏（`.superpowers/brainstorm/2335-1790925706/`，gitignore）→ 本 spec → **配色二轮**（v13 面板三档试色 → v14 sofifa 实测五档对照，`.superpowers/brainstorm/2986-1790927418/`）。
- 参考视觉：sofifa 手机版球员卡（仅参考信息组织，风格主体取自本站既有设计语言：纸色 / 陶土 / 卷宗卡）；**数值分段配色直接采用 sofifa 实测五档**（黄档换琥珀金，见 §5）。

## 1 · 目标与触发

- 球员库（`/players`）在 **≤900px**（与现有筛选抽屉 `DRAWER_QUERY` 同断点）把横向滚动表格**整表替换**为铭牌卡网格；桌面（>900px）表格**布局与交互零变化**——唯一例外是 CA/PA/初始 CA 列字色随 §5 全仓分段配色变化（v14 用户裁决）。
- 实现方式：`narrow`（`useMediaQuery`）JSX 条件渲染——`narrow ? 卡片列 : 现有表格`，桌面 DOM 完全不变。
- 工具条（筛选抽屉 / 当前·初始 / 搜索）、摘要条 chips、翻页条、抽屉交互全部不动。

## 2 · 卡片结构（铭牌卡，自上而下）

### 2.1 左竖轨（76px，陶土 tint）

底色 `#f7e3cd`、右侧 `1px solid #ecd5b4` 分隔，内容纵向居中：

1. **位置药丸（全量展示）**：
   - 主位（`positions[0]`）独占一行居中：米白底 `#fffdf7` + `1px solid #b07a45` 描边 + 深陶土粗体 `#8e5426`，字号 10px。
   - 副位（其余位置）：**flex-wrap 居中流式，两枚一行**；奇数时孤行自动居中（flex-wrap 天然行为，0/1/2/3 个副位均无特判）。透明底 + `1px solid #e3cda4` 描边 + 浅陶土 `#a5764a`。
   - 位置码来自 `row.positions`（PosID1-4 槽位）。
2. **CA 大字**：mono 24px，按值套 §5 五档分段色（`attrClass`），下方「CA」10px 小标（72% 透明度）。
3. **PA 次大字**：mono 17px，同一函数套色，下方「PA」小标。层级：CA 主、PA 辅。
- `view=initial` 时 CA/PA 自动取视图口径值（`buildViewExprs` 已处理，前端直接用 `row.ca/row.pa`）。

### 2.2 身体区

1. **姓名行**：姓名 15.5px 粗体，`overflow-wrap: anywhere` ——**允许换行、永不出省略号**（生产存在长复合名）；**标记 emoji 钉右上**（title 出 `MARKER_LABEL` 全称；无标记则右上空置）。球员号码不上卡（用户裁决）。
2. **副行**：`TeamLogo` 18px 方形 + 俱乐部名 · `N岁` · 状态徽章（仅 `status !== 'normal'` 时显示，复用 `STATUS_BADGE`/`STATUS_LABEL`，如「挂牌中」「训练营」）。自由身：无 logo 无俱乐部名，灰底「自由身」chip。
3. **属性列表（一行一个，行间 `1px dashed #efe6d2`）**：
   - **标签列 56px 定宽**（muted 色），值 mono 紧跟标签左对齐（sofifa 式两列；否决了 space-between 右对齐——短值「—」与标签间死区大）。
   - **行序固定**：身价 → 违约金 → 徽章 → 影响力 → 受筛选项。
   - 取值与格式：身价 `money(marketValue)`、违约金 `money(releaseFee)`、徽章「2金」「5银」小 chips（金银全 0 则**整行隐藏**）、影响力 `influence.toFixed(2)`。null 一律「—」。
   - **受筛选项行（lens）**：追加在列表末尾，标签深陶土粗体 `#8e5426`、值加粗；值为 0-99 能力值（attr 透镜）时按 §5 五档套色，白名单其他维度（声望 / 工资 / 效力时长 / 经纪人档等）非 0-99 刻度保持中性墨色；无受筛信息则无此行。**不单开卡底条**（用户否决）。

### 2.3 整卡交互

- 整卡 `<Link>` → `playerPath(row)`（fc_id 寻址唯一入口）；俱乐部名不做嵌套链接（`<a>` 不可嵌套）。
- hover `translateY(-2px)` 浮起 + 阴影加深；`:focus-visible` 焦橙描边（键盘可达）。

## 3 · 透镜（受筛选项）口径

优先级与上限（纯函数 `lensChips(filters, row)`，落 `web/src/lib/players-library.ts`）：

1. `filters.attr` 非空 → **单条** `{ATTR_LABELS[attr]} {attrValue}`（后端已随行返回 `attrValue`，零额外读）。
2. 否则：当前**排序键** ∈ 白名单 → 1 条；生效**筛选维度** ∈ 同白名单 → 补位；去重后**最多 2 条**。
3. 白名单：`prestige`（声望）/ `base_ca`（初始 CA）/ `growth_gap`（成长空间）/ `wage`（工资）/ `release_fee`（违约金）/ `years`（效力时长）/ `agent_tier`（经纪人）。卡面已展示的维度（身价/影响力/徽章/CA/PA/年龄等）不进透镜。
4. 无命中 → 整行不渲染。

## 4 · 网格与排序行

- 卡片网格：`repeat(auto-fill, minmax(290px, 1fr))`——手机单列、平板两列；每页 20 张（PAGE_SIZE 不变）。
- **排序行**（窄屏专属，工具条第二行）：排序 `<select>`（30 个固定键 + 当前 `attr:*` 动态项；中文标签来自新增 `SORT_KEY_LABELS`，派生自 `FIXED_COLUMNS` + `COL_DEFS` + `{id: '默认顺序'}`）+ 升/降切换按钮（`sort='id'` 时禁用）。选择即 `set('sort', key)` + `firstOrderFor(key)`。
- **「显示列」在窄屏隐藏**（CSS 隐藏 FilterPanel 的显示列 MultiSelect 所在 `.lib-chip-row`）：列概念只属于桌面表格。

## 5 · 数值分段配色（sofifa 实测五档，全仓统一）

- **来源**：sofifa.com 官网实测（2026-10-02 抓取）：页面内联脚本常量 `COLOR_0_50…COLOR_80_99` 与 `awsm.min.js` 的 `color(point)` 函数（`<51` / `<61` / `<71` / `<81`）两处同阈值互证；其六边形雷达图 echarts visualMap 用同一套 pieces。球员详情页对匿名请求有登录墙（跳 `/signIn`，cookie 预热无效），但全部口径在公开静态资源中取得。
- **五档色值与阈值**（0-99 刻度）：

| 区间 | 色值 | 说明 |
|---|---|---|
| ≤50 | 红 `#e03131` | sofifa 原档 |
| 51-60 | 橙 `#fd7e14` | sofifa 原档 |
| 61-70 | 琥珀金 `#b7892b` | **唯一替换档**：sofifa 原档黄 `#fcc419` 在本站奶油底（`#fffdf7` / `#f7e3cd`）上对比度仅 ~1.6:1 不可读；用户裁决换与陶土系同族的琥珀金（可读性 ~3:1，接近现面板橙档） |
| 71-80 | 榈绿 `#66a80f` | sofifa 原档 |
| ≥81 | 绿 `#2b8a3e` | sofifa 原档 |

- **适用域（0-99 能力值刻度）**：CA、PA、细分属性值、属性分组均值、初始 CA（`baseCa`）。**不适用、保持中性墨色**：金额（身价 / 违约金 / 工资）、影响力、声望（0-10 标度）、效力时长、成长空间（差值）、经纪人档位。
- **全仓统一落点（现状已逐点查证）**：
  - `web/src/pages/Player.tsx:62` 的三档 `attrClass` 改五档，并**挪到 `web/src/lib/players-library.ts` 共享导出**——面板与卡片同源一个函数；类名草案 `attr-bad / attr-weak / attr-mid / attr-solid / attr-good`（`attr-low` 退役）。
  - `web/src/styles.css:2399-2407` 三条 `.attr-*` 规则改五条。
  - `Player.tsx:435/:439` 面板头部 CA/PA（现素色 `mono ca-pa`）套色；`Player.tsx:114` 六维雷达轴数值（`radar-axis-val`）套色；属性页签值（`:787`）与分组均值（`:778`）经 `attrClass` 自动跟随五档。
  - `web/src/pages/PlayersLibrary.tsx:596-597` 球员库表格 CA/PA 列（现素色）与 `:103` 初始 CA 列套色。
  - 移动端卡片竖轨 CA/PA 与 lens 属性行同函数。

## 6 · 代码落点（实现轮的边界，本轮不动）

| 文件 | 改动 |
|---|---|
| `web/src/lib/players-library.ts` | `money()` 移入并导出（页面删本地副本）；五档 `attrClass()` 移入并导出（§5）；`SORT_KEY_LABELS`；`LensChip` 类型 + `lensChips(filters, row)` 纯函数 |
| `web/src/pages/PlayersLibrary.tsx` | `narrow` 分支渲染 `.lib-cards` 卡片列 + `.lib-sortrow`；import `TeamLogo`；表格 CA/PA/初始 CA 列套 §5 色（`:596-597` / `:103`） |
| `web/src/pages/Player.tsx` | `attrClass` 改 import 共享五档版；面板头部 CA/PA（`:435/:439`）与雷达轴数值（`:114`）套色（属性页签与分组均值经函数自动跟随） |
| `web/src/styles.css` | `.lib-cards` / `.lib-card-*` / `.lib-sortrow` ≈120 行（`lib-` 前缀防撞详情页 `.player-card`）；显示列窄屏隐藏；`prefers-reduced-motion` 补一条；`.attr-*` 三条改五条（§5） |
| 后端 / 迁移 | **零改动**（`attrValue` 已随行返回，D1 读量零增加） |

## 7 · 已知边界与裁决留痕

- 配色二轮（v13/v14）：先按用户原话「属性值、CA 值复用球员面板属性的分段配色」出屏（v13，现面板三档试色）；用户改令「探索 sofifa 分段配色并应用」→ 官网实测五档出对照屏（v14，防人机验证走公开静态资源），拍板「五档 + 黄档换琥珀金 `#b7892b`」并升级为**全仓统一**（面板 CA/PA、雷达轴数值、表格 CA/PA/初始 CA 列一并套色，用户原话「整个仓的CAPA属性等都用此配色」）。
- 多属性筛选后端不支持（单 `attr` 参数）→ 透镜最多 1 条属性行。
- 生产 `players.market_value` 18,301 行全 NULL（导入不触碰运营列）→ 身价恒「—」，用户裁决仍保留槽位。
- 列表接口无 `logoKey` → 队徽走 TeamLogo 色块+首字兜底，零新增请求。
- 位置展示历经 5 轮迭代（ST+1 截断 → 全量实心 → 全量墨色 → 横排一行 → **主位+副位药丸竖排**定稿）；「ST+1」截断被用户否决（不全），实心陶土/墨色被否决（轨内糊/配色不符）。
- 透镜从「独立卡底条 + 迷你进度条」改为「属性列表末尾高亮行、纯文字」——进度条被否决（过度设计），单开一轨被否决。
- **教训（companion 框架类名撞车）**：配套框架自带 `.main { flex: 1 }`，样机曾用 `class="main"` 做主位药丸导致纵向撑形（v3「上下太长疑似 bug」、v5-v7「画成啥了」的真凶）。实现时新增类名一律 `lib-` 前缀、不用通用单词。
- 样机脚手架的收缩适配（`max-width` 无固定宽 + 外层 flex 按内容收缩）曾使内容短的卡片坍缩到 189px；真实现为网格轨道恒满宽，无此问题。

## 8 · 实现轮的验收口径（预告，届时 qa-test-planner 出正式计划）

- typecheck 三份全清；vitest 全绿（基线 67 文件 / 1194 例，v6.18.0 台账）；build 成功；e2e 全绿（基线 11/11，smoke.mjs 补窄视口用例）。
- 桌面 DOM 零变化（`narrow=false` 不渲染卡片；例外：CA/PA/初始 CA 列字色随 §5 变化，属预期）；D1 读量零变化（零后端改动）。
- `lensChips` 纯函数单测（新建 `tests/players-lens.test.ts`）：attr 优先 / 排序键命中 / 筛选维度补位 / 去重 / 上限 2 / 空集不渲染 / null 值。
- `attrClass` 五档边界单测：50/51、60/61、70/71、80/81 八个边界值各归对档；变异验证按最坏情况口径——按将来最可能的重构方式弄坏（退回面板旧三档阈值 50/70），确认恰是边界例变红。
