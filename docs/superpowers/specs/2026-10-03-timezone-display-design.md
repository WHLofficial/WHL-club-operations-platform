# 设计稿 · 显示时区偏好化：内部统一 UTC + 外部显示可调（默认北京）

日期：2026-10-03 · 版本目标 6.25.0 · 状态：已批准（plan 三轮收敛，UI 裁决两轮）

## 1. 背景与裁决

四仓普查（2026-10-03，结论在项目记忆 `timezone-conventions-four-repos.md`）：**存储层四仓一致——UTC ISO TEXT、无 epoch 列**，「内部统一 UTC」现状已达标，无需迁移。风险集中在三层：

1. **club 展示分裂**（本增量靶点）：市场卡截止按浏览器本地时区渲染（`market/shared.tsx`、`MarketListingOverlay.tsx`），台账/通知/管理端/教练台是裸 UTC 切片（多数无「UTC」标注）——同一时刻不同页面可差 8 小时；
2. **daily 仓 cron 承诺错 8 小时**（跨仓待办）；
3. **tour 仓前后端日期不同源 + UTC 周一 weekKey**（跨仓待办）。

用户裁决：**内部统一 UTC（现状确认），外部显示时间可调、默认北京；偏好存浏览器 localStorage；时区切换用时钟图标，收件篮同时换图标（未读红点保留在图标右上）。**

## 2. 方案

### 2.1 共享时间层 `web/src/lib/datetime.ts`

- 偏好 `TzPref = 'asia/shanghai' | 'utc' | 'system'`，localStorage 键 `whl.tz`，非法/缺失回落 `'asia/shanghai'`；隐私模式等 localStorage 异常静默降级（仅本次会话生效）。
- 写入后派发 `whl:tz-change` 自定义事件；hook 另监听 `storage` 事件 → 跨标签页同步。
- 格式化：`Intl.DateTimeFormat('zh-CN', { hourCycle: 'h23', timeZone })` + `formatToParts` 自拼 `YYYY-MM-DD HH:mm` 短横线格式（与现有 UI 视觉一致）；formatter 按 `pref+opts` Map 缓存；`system` 档不传 `timeZone`（Intl 默认本机时区）。
- 三个纯函数 `fmtDateTime` / `fmtTime` / `fmtDate`（null/undefined/非法 ISO 统一 `'—'`）+ `useTzPref()` 订阅 hook + `useTimeFmt()` 消费入口（返回 `{ label, time, dateTime, date }`，pref 变化即重渲染）。
- **重渲染约定**：渲染时间的组件必须调 `useTimeFmt()`（或 `useTzPref()`），不许只 import 裸函数——否则切档不刷新。

### 2.2 顶栏图标化（TopBar.tsx）

- **时区切换**：时钟 inline SVG 图标按钮（零新依赖）→ 小型下拉（北京时间默认 / UTC / 跟随浏览器，当前项 `✓`），外点/Esc 关闭，交互样式参照 `MultiSelect.tsx` 的 Popover 模式；`aria-label="显示时区"`，title 随选中值。
- **收件篮**：信封 inline SVG 替换「收件篮」文字链接，`aria-label`/`title="站内信收件篮"` 保留；未读红点沿用 `.inbox-unread-dot`，CSS 锚到图标右上角。e2e ⑦ 锁的是收件篮页 h1 非顶栏文字，不受影响。

### 2.3 消费点替换（9 处）

Ledger / Notifications / GrowthEntryPage / BrandsPage / EventsPage(deadline) / OffersSection / CoachPanel（标注「（UTC）」→「（{label}）」）/ market shared.tsx / MarketListingOverlay —— 全换 `useTimeFmt()`。倒计时不动（绝对时刻差与时区无关）；服务端判定、触发器、`deadline_at` 语义不变。

### 2.4 测试

- 单测 `web/src/lib/datetime.test.tsx`：默认北京/UTC 确定性格式、非法输入、持久化 + 事件重渲染、system 烟测。
- 静态锁 `tests/datetime-display.test.ts`：`web/src` 只有 datetime.ts 出现 `Intl.DateTimeFormat`/`timeZone:`；裸时间切片精确模式清零（`.slice(0, 16).replace` 与 `.slice(5, 16)`）。
- e2e ⑰：时钟图标在场 + 切 UTC 后同处时间串变化 + 收件篮图标与红点。

## 3. 四仓约定（本次定稿，跨仓增量按此执行）

1. **存储**：一律 UTC ISO TEXT（`toISOString()` 或 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`），禁 epoch 列、禁 `datetime('now')` 空格格式入新列（破坏 ISO 字典序比较）。
2. **展示**：走共享 Intl 层 + 用户偏好（默认 `Asia/Shanghai`），禁裸 UTC 切片直显、禁 getHours 本地渲染；无法确定时刻语义的旧文案标注随偏好走。
3. **业务日历日**：按上海日历日（club `shanghaiDateStr` / daily `shanghaiDate` 已达标；tour 周界待改）。
4. **cron 承诺**：表达式按 UTC 写，注释与 UI 文案必须写换算后的北京时刻（daily 待修）。

## 4. 跨仓待办（不在 6.25.0 实现，各自仓另令）

- **daily**：`0 9 * * *` 实为北京 17:00，注释与 `public/admin.js:521` 承诺 09:00 → 改 `0 1 * * *` 或改文案；同库两套 UTC 格式混用的字典序风险收敛。
- **tour**：后端 `cnDate`（UTC 日期）vs 前端本地时区不同源；周报 `mondayUTC` 改上海周一动 weekKey 连续性，需排期拍板。
- **auth**：零展示代码，维持 UTC ISO 出 DTO 即可；登记「expires_at 字符串比较依赖写入口径统一」的结构性约束。

## 5. 风险与边界

- 忘调 hook 的组件切档不刷新 → 评审专项核对 9 处全走 `useTimeFmt()`。
- 静态切片锁用精确模式，避免误伤非时间切片。
- `system` 档 CI 时区不定 → 单测只烟测。
- 时区切换只影响显示，不触碰倒计时 / 服务端判定 / 落库。
