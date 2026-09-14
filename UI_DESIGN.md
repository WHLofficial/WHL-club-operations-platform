# WHL 俱乐部运营平台 · 前端 UI 设计

| 项 | 内容 |
|---|---|
| 版本 | v1.0.1（v1.0 四裁决定稿 + 实现阶段徽章原图量化校色落定，§3 令牌为准值） |
| 日期 | 2026-09-12 |
| 状态 | 设计定稿，实现属开发阶段（本轮不写前端代码） |
| 参照系 | 赛事系统 `WHL-tournament-management-system/src/styles.css`、竞猜系统 `WHL-Daily-Activities-System/public/style.css` |
| 配套文档 | [PRD.md](./PRD.md) · [TECH_DESIGN.md](./TECH_DESIGN.md)（§6.7-6.10 谈判与保密、§17 规约） |

---

## 1. 家族定位：同构不同色

WHL 家族的既有设计语言（两个参照站逐文件核实）：**DOM 结构与类名词汇同源，每站一个专属主色**——

| 站 | 主色 | 结构样式 |
|---|---|---|
| WHL 赛事系统 | 球场绿 `#0e7a46`（顶栏墨绿 `#0a3d24`） | React 19 + 全局 styles.css（~2600 行，含门户） |
| WHL 竞猜系统 | 品牌蓝 `#1652f0` | 原生 JS + 单文件 style.css（249 行） |
| **WHL 俱乐部（本站）** | **徽章焦橙 + 巧克力棕 + 奶油纸** | React 19 + 全局 styles.css（估 700-800 行） |

结构级照抄清单（来自两参照站的「同构词汇」）：`topbar`（整条色底 + `inset 0 -3px 0` 底部描边）、`brand / nav-links / nav-tab.is-active / userbox / role-badge`、`card / a.card`、`auth-card`（顶边 3px 主色）、`label.field`、胶囊徽章（999px）、`seg` 分段、`table-wrap + td.num`（tabular-nums）、`banner.info/warn/bad`、toast（底部胶囊、busy 态「处理中…」、两段式确认）、dashed 分隔线、640px 单断点、`prefers-reduced-motion` 全关。

**个性来源 = WHL 徽章本体**（复古贴纸风：焦橙底 / 奶油白球体 / 巧克力棕字母 / 浅蓝衬底；原图 `E:\DeskBox\bhdjb\图片\微信图片_20251130151009_220_160.jpg`，实现阶段拷入仓库资产目录）。全站主题 = **复古档案室**：奶油纸背景 + 棕墨文字 + 合同卷宗 + 印章意象，铺满球员、市场、账本、审核全部页面。

## 2. 技术路径

- **栈**：React 19 + react-router 7 + Vite（与赛事系统同栈，PRD 已定 React SPA）；**不引 Tailwind / 组件库 / CSS-in-JS**。
- **样式架构**：全局单文件 `src/styles.css`（估 700-800 行 = 家族基础 ~250 + 档案室主题扩展 ~500），设计令牌全部集中在 `:root`；动态值才用 inline style。
- **浅色主题，无暗色切换**（家族硬惯例）；`index.html` 的 `theme-color` = 顶栏棕。
- **移动端**：单一断点 `@media (max-width: 640px)`，CSS-only 适配（卡柜单列、表格 `overflow-x:auto` 横滚、触摸目标 ≥36px）；`viewport-fit=cover`。
- **动效纪律**：家族克制——本站唯一新增 keyframe 是**盖章 scale-in**（§4.1）；live 类动效沿赛事 `livepulse` 若被复用，同样尊重 reduced-motion；其余动效仅 hover/过渡。
- **纸张质感**：全站底噪 = SVG `feTurbulence` data-uri 背景层，透明度 ≤4%（照赛事头条对撞卡的颗粒做法）；不引入任何外部纹理图片。

## 3. 令牌表（`:root`）

> v1.0 的色值为视觉估读；实现阶段已对徽章原图（2048×2048）做 PIL quantize 校色（`scripts/calibrate_tokens.py`），下表为**校色后准值**。主色焦橙原图实测 `#db813a` 白字对比仅 2.91，按「加深不换色」规则压至 `#a4612c`（对比 4.86 ≥ 4.5）；金/银作正文字时用加深档 `--gold-deep`/`--silver-deep` 保证可读，`--gold`/`--silver` 保留作徽章底与线条。

| 令牌 | 校色后值 | 来源 / 用途 |
|---|---|---|
| `--paper` | `#fdf4e3` | 奶油纸页面底（徽章贴纸白，量化主色），家族最暖一站 |
| `--card` | `#fffdf7` | 卡片底（贴纸白） |
| `--ink` | `#2b1d12` | 棕墨正文（对 paper 对比 14.9） |
| `--muted` | `#7a6a5a` | 暖灰次要文字（加深至对 paper 4.76 ≥ 4.5） |
| `--terracotta` | `#a4612c` | **主色**：主按钮底、选中态、tab 激活（白字对比 4.86） |
| `--terracotta-deep` | `#8e5426` | 主按钮 hover（白字对比 6.09） |
| `--terracotta-tint` | `#f7e3cd` | 浅焦橙底：信息条、选中底、行情条 |
| `--cocoa` | `#87451c` | 徽章字母棕（量化）：**顶栏底**、brand 字、档案卷宗描边；顶栏奶油字对比 6.6 |
| `--cocoa-deep` | `#4b2610` | 顶栏底部 3px 描边、印章深线 |
| `--sky` | `#b0c8d0` | 徽章浅蓝衬底（量化）：**挂牌中/进行中徽章底**、链接强调（家族 live 橙在本站让位给品牌，见下） |
| `--sky-deep` | `#37505e` | 浅蓝徽章深字（对 sky 对比 4.86） |
| `--gold` | `#c99b3f` | 金：金徽章底、印章金线 |
| `--gold-deep` | `#8f6a1e` | 金色正文字（身价数字等，对 paper 4.53） |
| `--silver` | `#9aa0a6` | 银：银徽章底 |
| `--silver-deep` | `#6e747b` | 银色正文字（对 card 4.64） |
| `--ok / --bad / --warn` | `#0f9960 / #dc2626 / #d97706` | 状态色沿家族原值（warn 仅 banner，避免与主色橙混淆） |
| `--border` | `#e6dcc8` | 边框（暖调，替代家族冷灰线） |
| `--mono` | 沿赛事栈 `ui-monospace, "JetBrains Mono", …` | **一切数字**（CA/PA/身价/工资/余额/截止倒计时）mono + `tabular-nums` |
| 圆角刻度 | 4 / 6 / 8 / 10 / 12 / 14 / 999px | 沿家族 |

连带裁决：家族「进行中=橙」在本站与主色冲突 → **进行中/挂牌中改用 `--sky` 浅蓝系**（徽章自身就是橙底蓝衬的配色）；成功绿/危险红/警告橙保留家族语义。

## 4. 组件规格

### 4.1 基础组件（类名照抄家族，仅换令牌）

| 组件 | 类名 | 本站差异 |
|---|---|---|
| 顶栏 | `.topbar .brand .nav-links .nav-tab.is-active .userbox .role-badge` | 底 `--cocoa`、描边 `--cocoa-deep`、字奶油白；**brand = 徽章图（圆裁 24px）+ 「WHL 经理办公室」** |
| 卡片 | `.card / a.card` | 白底 `--card`、1px `--border`、radius 12px、无阴影；hover 才浮起（边框变 `--terracotta` + `0 2px 10px rgba(74,39,8,.12)`） |
| 按钮 | `.btn / .btn-ghost / .btn-danger / .btn-sm` | 实心 `--terracotta` 白字、hover `--terracotta-deep`；不可逆操作两段式确认（「再点一次确认」） |
| 表单 | `label.field / .error-msg / .hint` | input focus 焦橙边 + `0 0 0 3px rgba(164,97,44,.15)` 光环 |
| 徽章 | `.badge.{green|orange|blue|purple|gray|red}` | 胶囊 999px 浅底深字六色对（沿竞猜模式）；**live/挂牌中用新增 `.badge.sky`（--sky 底 / --sky-deep 字）** |
| 分段 | `.seg label.on` | 选中焦橙底白字 |
| 表格 | `.table-wrap th td.num` | 表头米黄 `#f3ead9`、行 hover 奶油 `#f7f0e0`、数字列右对齐 mono |
| 提示条 | `.banner.{info|warn|bad}` | info 用 `--terracotta-tint` |
| Toast | `.toast(.err)` | 棕墨 `--ink` 底白字胶囊 |
| 弹窗 | 遮罩 `rgba(43,29,18,.55)` + blur(5px) | radius 14px、大阴影 |
| 跨站按钮 | `.cross-tour / .cross-guess` | 家族互敬：→赛事用绿色草纹渐变、→竞猜用竞猜蓝（照抄竞猜「去赛事平台」按钮实现，换色即可） |

### 4.2 签名组件（档案室意象，本站个性所在）

**印章 `.stamp`** —— 全站的核心个性件：

- 纯 CSS：双线框（外 2px + 内 1px `--cocoa-deep`，间隙 2px）、圆角 6px、内文 13px/800 字距 2px、整体 `rotate(-3deg)`；
- 变体：`.stamp-ok`（已核准，绿）、`.stamp-bad`（已驳回，红）、`.stamp-force`（强制成约，棕金）、`.stamp-hold`（冻结中，浅蓝）、`.stamp-burn`（销毁，灰）；
- 动效：落章 `scale(1.6→1) + opacity` 0.25s ease-out——**全站唯一新增 keyframe**，`prefers-reduced-motion` 时直接呈现终态；
- 用于：审核队列结果、成交单、合同 source 标注、资金冻结/解冻、匹配差额销毁记录。

**球员卡 `.player-card`** —— 贴纸语言：

- 外层贴纸白边（`border: 6px solid #fff` + 1px `--border` 外圈，即徽章贴纸的白描边手法）、内层奶油面 + 棕描边；hover 微浮起；
- 头行：姓名 + **徽章章位**（🥇/🥈，白名单内）；CA / PA 大数字 `--mono` 28px/800；身价金色 mono；
- 尾行：经纪人档位章（🕴 温和/普通/苛刻）+ 注册状态胶囊；挂牌中的球员卡加 `.badge.sky`「挂牌中」。

**档案卡 `.dossier`** —— 球员详情页容器：

- 左：`.player-card`；右：卷宗区（标题「合同卷宗」+ 打字机风条款表格：违约金/工资/效力起点/保护期至/合同类型/source；子区块用 `border-top: 1px dashed` 分隔，家族惯例）；
- 卷宗关键事件（签约/续约/直败/强约）旁盖 `.stamp`。

**流水账 `.ledger-book`** —— 财政页容器：

- 手账格线：行间淡棕横线（`repeating-linear-gradient` 或 1px border）、日期 mono、摘要中文、金额右对齐 mono（收入 `--ok` / 支出 `--bad`，行首「收/支」小字章）；
- 余额大字 mono 置顶；流水类型用胶囊徽章而非 emoji。

### 4.3 图标与文案口径（已裁决：克制 + 功能白名单）

- **品牌位**：顶栏与页脚用 WHL 徽章图（圆裁），**不用 emoji 品牌**（家族：赛事=纯文字、竞猜=🎯、本站=真徽章）。
- **装饰零 emoji**：状态/动作一律 CSS 印章、胶囊徽章、图形；禁止 📢💰📊 类装饰图标。
- **emoji 白名单（功能必需，仅此三组）**：满意度 😍🙂😐😠（TECH_DESIGN §6.9 文案）；金银徽章 🥇🥈；经纪人档位 🕴。白名单外出现 emoji 视为 bug。
- **文案语气**：沿家族口语化有人味（「还没有挂牌。窗口开了之后，这里就是市场。」「提交成功，截止前可以随时改」）；操作反馈走 toast + busy 态；空状态纯 `.muted` 文字无插画。

### 4.4 站内用词表（已裁决 2026-09-14：界面说人话，工程词不上屏）

| 旧词 / 内部词 | 站内用词 | 备注 |
|---|---|---|
| RC / release fee | 违约金 | 通道 C 导入的 CSV 表头说明可保留 RC（那是文件列名，不是界面用词） |
| 注册快照 / 查快照 | 注册名单 / 查名单 | 「快照」不上屏 |
| 体检 / 准入体检 | 资格检查 | 「跑一遍资格检查」 |
| 旁路 | 方式 | 「两种方式」「方式单据」 |
| 收口 / 窗尾收口 | 截止处理 | 「保护期重新收口到 X」→「保护期从 X 重新起算」 |
| 销毁 | 回收 | 税回收、差额回收、解约费回收 |
| 名单 `20/20-30` | `20/30` | 数量/上限；超上限红、低于下限蓝（下限数字不展示，只写进规则提示行） |
| 工资合计 X m | 工资 X/Y m | Y=工资帽；帽未配置时只显示 X |

## 5. 页面规格（玩家操作 × 主题化体验）

| 页面 | 布局与体验要点 |
|---|---|
| 登录 / 建队 | 家族 `.auth-card`（380px 窄卡 + 焦橙顶边）；认证码绑定 = 「档案登记卡」文案；绑定成功盖 `.stamp-ok` |
| 球队中心 | 容器 960px（沿赛事）；顶部球队头（队徽 TeamLogo 模式 + 余额大字 mono + 工资帽余量条）；阵容名单家族表格（一行一球员，缩略球员卡列可选）；一线队/训练营 `.seg` 分段；注册校验结果用 banner |
| 球员详情 | `.dossier` 档案卡（§4.2）；FC 细分属性收纳进折叠 `details`；换版/成长历史入卷宗时间线 |
| 转会市场（挂牌板） | 读作「卡柜」：在挂单 = `.player-card` 卡片流（grid，移动端单列）；每卡带当前最高价（mono）+ 出价人数 + 截止倒计时（mono，沿竞猜 `countdown()` 文案）；出价历史表格；我的出价带 `.stamp-hold`（冻结中）/已解冻章 |
| 签约谈判会话 | E 数值 28px mono 置顶（「经纪人开价」）；报价输入 + `.seg` 快捷档；每轮反馈 = 满意度 😍🙂😐😠 + 剩余次数；终结态盖章：成约 `.stamp-ok` / 直败 `.stamp-force` / 强约 `.stamp-force`；全程不出现任何判定数值（TECH_DESIGN §6.10） |
| 财政账本 | `.ledger-book` 流水账（§4.2）；筛选按 kind 胶囊；大额变动 banner |
| 审核队列（管理组） | 待审单 = 待批文件卡（单据摘要 + 证据备注）；批准/驳回按钮点击即盖章动效 + `.stamp-ok/.stamp-bad` 落卡 |
| 成长页 | XP 棕墨进度条（焦橙填充）；升级二选一 = 双卡对比（方案表）；徽章墙 = 🥇🥈收集格；档位核定记录入卷宗 |
| 通知中心 | 收件篮列表（mono 时间 + 模板摘要）；未读小蓝点用 `--sky` |
| 移动端（全局） | 640px 断点：卡柜/档案单列、表格横滚、顶栏换行、触摸目标 ≥36px；微信内观感优先（家族策略） |

## 6. 实现阶段校色与待办

1. ~~量化校色~~ **已完成（v1.0.1）**：`scripts/calibrate_tokens.py` 对徽章原图 quantize，四主令牌已按量化结果落定（见 §3 表）；主按钮白字对比 4.86 达标。
2. 徽章图拷入仓库（`public/` 或 `src/assets/`，原图 1500×1500 需出 48/72/96px 圆裁变体或 CSS 圆裁）。
3. 挂牌板顶部「市场快讯 ticker」为**可选件**（赛事 portal 已有母题，是否复用到市场页开发时定）。
4. 除盖章 scale-in 外不新增任何 keyframe；所有动效过 reduced-motion。
5. 验收基线：三个对照页（球员详情 / 挂牌板 / 账本）与赛事系统并排看——结构气质一致、颜色气质一眼是「俱乐部站」。
