# 徽章计数与 PlayStyle 徽标口径统一 · 设计定稿（2026-10-06）

状态：**已实现并上线**（v6.35.0，2026-10-06 本地完成 → 同日发布，生产 Version `1658a9a3-b16f-46bb-ad65-980d1945992a`）。落地形态见 §2，落点清单见 §2.4，已知差异见 §3。

> 时点说明：本文与同轮的 `2026-10-05-player-heatmap-radar-ticks-design.md`（热区图 + 雷达统一）同批交付，两者共用球员页属性页签头部的三列布局，其余无耦合。行号以 v6.35.0 实现轮 HEAD 为准。

## 0. 裁决链（用户指令留痕）

1. 用户令（2026-10-06）：「位置热区可视化，并且将对比页六维图与球员面板页样式统一。**修复本仓徽章和 playstyle 的不统一问题。**」
2. 三口径裁决（同日，用户点选推荐项）：徽章统一＝**语义统一 + 共享件覆盖**（不是「全站改同一形态」）——计数语义（金在前 / 零值抑制 / 金白银银的写法）收敛成一份，形态按场合保留差异。

## 1. 现状盘点（统一前的四类不一致）

1. **计数文案五种**：球员卡头 `🥇×N`/`🥈×N`（金在前）；升级方案行 `planBadgeText`（**银在前**）；升级完成 toast（**银在前**）；对比页徽章数行 `金 N · 银 N`（**无零值抑制**，全 0 也出两枚）；球员库卡片 chip `N金`/`N银`；球队页表格 `N金 N银`（双 0 出 `—`）；SquadTab 荣誉散文「金徽章 N 枚 · 银徽章 M 枚」。
2. **三套金底色板**：`.badge.gold`（`#f5e8cf` / `--gold-deep`）、`.ps-gold`（底同 `#f5e8cf`，但描边用饱和 `--gold: #c99b3f`）、`.lib-card-chip-gold`（`#f5e5bf` / `#e2c98f` / `#8a5a00`）与 `.lib-card-chip-silver`（`#eeeae2` / `#d8d2c4` / `#6b665c`）——同一族色被手写三遍，且金徽描边两种口径。
3. **两套 PlayStyle 渲染**：`web/src/components/PlaystyleBadge.tsx`（pill 底 + webp 图标 + 🥇/🥈 + 名称，详情页与对比页用）vs `web/src/lib/club-columns.tsx` 的 `psNames`（纯文本 `金·名称` + `、` 连接，表格列用）。表格列退化成纯文本的根因是**性能**：一名球员最多 15 个槽，表格每行铺 webp 图标等于每格多出 N 个请求。名称口径也随之分叉（金段显示规则两处各写一遍）。
4. **空槽 `0` 缺陷**：`psIds` 数组里的空槽（`0`）在表格 ps 列被显示成「0」——`src/worker/routes/players.ts` 与 `registration.ts` 造数组时只把 null/undefined/非有限数归 null，`0` 原样透出；而 core 的 `src/core/fc26.ts` `playstyleSlotsOf` 明确「空槽 / 0 / 非数字都不产出条目」。同族陷阱（空槽经 `Number()` 归零被错译）另在 `positionName` 上发生，已在热区图轮修掉（见该 spec §7）。

## 2. 统一口径

### 2.1 计数：`BadgeCounts`（`web/src/components/BadgeCounts.tsx`）

- **唯一出处** `badgeCountItems(silver, gold)`：**金在前 + 零值抑制**（`gold > 0` 先 push，再 `silver > 0`；两枚全 0 出空数组）。组件与文字摘要都从这一处取，不再各写一遍。
- 组件签名 `BadgeCounts({ silver, gold, density = 'icon', className, sep })`；`items.length === 0` 时**整个组件不渲染**，由调用方决定出「—」（表格 / 对比页）还是「不加徽章」（升级方案）。
- 三密度（**场合差异，非语义差异**）：
  - `icon` `🥇×2 🥈×1` —— 卡片头 / 升级方案行 / 提示句：emoji 自带颜色、宽度最小；`title` 挂 `金徽章`/`银徽章`（符号读不出金银）。
  - `text` `2金 1银` —— 表格单元格与对比页：数字在前，窄列不抢眼；不挂 `title`（文字已写明）；金/银分色走 `.badge-count-text-{gold|silver}` → `--badge-*-fg` token（对比页的 `.cmp-badgecnt` 在样式表更靠后，`color: var(--muted)` 盖掉这层 ⇒ 两列计数在对比页保持同色对齐，与改前一致）。
  - `chip` `2金 1银` —— 球员库卡片：带底色块，与「自由身」chip 同族（`badge-chip` + `badge-chip-{gold|silver}`）。
- `BADGE_KIND_LABEL = { gold: '金徽章', silver: '银徽章' }`：句子场合（升级完成 toast「金徽章 +2」）用全称，与散文口径一致。

### 2.2 色板收敛为 token（`web/src/styles.css:22-29`）

- 新增 `--badge-gold-bg: #f5e8cf` / `--badge-gold-line: #e2c98f` / `--badge-gold-fg: var(--gold-deep)`、`--badge-silver-bg: #eeeae2` / `--badge-silver-line: #d8d2c4` / `--badge-silver-fg: var(--silver-deep)`。
- `.badge.gold` 改走 token —— **渲染结果零变化**（同色值）。
- `.ps-gold` 改走 token —— **有意视觉变化之一**：描边由饱和 `--gold` 收成浅金 `--badge-gold-line`（原对比过强、与其余金徽不同族）。
- `.badge-count-text-gold` / `.badge-count-text-silver` 新增（评审 P2-2 补：`BadgeCounts` 生成的类此前是空钩子，表格里金/银计数不分色）：取 `--badge-gold-fg` / `--badge-silver-fg` —— **有意视觉变化之二**，只落在球员库 / 球队页表格的 badges 列（对比页被 `.cmp-badgecnt` 盖回 muted）。`icon` 密度不铺色（🥇/🥈 自带颜色，类名只作钩子）。
- `.lib-card-chip-gold` / `.lib-card-chip-silver` 删除（唯一消费者就是改掉的卡片 chip），改由 `.badge-chip` / `.badge-chip-{gold|silver}` 承担；`.lib-card-free` 保留并改成自带 sizing 的独立规则（仍被球员库「自由身」chip 用）。

### 2.3 PlayStyle：`PlaystyleBadge` compact + `psBadgesOf`

- `PlaystyleBadge({ psid, gold, compact = false })`：整徽路径（pill + webp 图标）DOM / 类名 / 文案 / aria 逐字不变；`compact` 路径 = `ps-badge-compact`（金徽多一枚 `ps-badge-compact-gold`）+ `🥇/🥈` + 名称。**不挂 `ps-badge`**（避免与 pill 的 padding / radius 抢优先级）、**不拉图标**（表格性能）、金徽走 `--badge-gold-*` 上色、银徽只留文字（整列十几枚银徽全上底色太吵）。
- `psBadgesOf(row)`（`web/src/lib/club-columns.tsx:182`）取代 `psNames`：返回 `{ psid, gold }[]` 供渲染。槽号 = 数组下标 + 1（`playstyleIsGold` 收槽号）；`v === null || !Number.isInteger(v) || v <= 0` 跳过（**与 core `playstyleSlotsOf` 同口径**，修掉空槽显示「0」）；`psid` 归一到 base id（`basePlaystyleId(v)`，来自 `src/core/fc26.ts` —— 评审 P3-8：别在调用点再手写 `>= 100 / -100`）。
- **名称口径已知差异（登记）**：整徽显示 ref 表原值（金段 id 在 ref 表里有自己一行，名称带后缀，如「精准搓射 +」），compact 显示 base id 名（如「大力射门」）——与表格列历史口径一致，同一球员在详情页与表格里可能一处带后缀一处不带。

### 2.4 落点清单

| 页面 / 位置 | 形态 | 调用点 |
|---|---|---|
| 球员页卡头 | `BadgeCounts density="icon"` | `web/src/pages/Player.tsx:350` |
| 球员页升级方案行 | `density="icon"`，全 0 出「不加徽章」 | `web/src/pages/Player.tsx:859-862` |
| 球员页提示句 | `density="icon"`（内嵌句子） | `web/src/pages/Player.tsx:872` |
| 球员页升级完成 toast | 句子（`BADGE_KIND_LABEL`，金在前） | `web/src/pages/Player.tsx:200` |
| 对比页徽章数行 | `density="text"`，全 0 出「—」，`sep` = `.cmp-dt` | `web/src/pages/PlayerCompare.tsx:650-653` |
| 球员库卡片 | `density="chip"` | `web/src/pages/PlayersLibrary.tsx:605-609` |
| 球员库 / 球队页表格 badges 列 | `density="text"`，双 0 出「—」 | `web/src/lib/club-columns.tsx:202-208` |
| 球员库 / 球队页表格 ps 列 | `PlaystyleBadge compact`（空出「—」） | `web/src/lib/club-columns.tsx:228-234` |
| 球队页阵容荣誉散文 | 不动（散文「金徽章 N 枚 · 银徽章 M 枚」） | `web/src/pages/club/SquadTab.tsx:70` |

## 3. 不做与已知边界

- **不改台账语义**：金 / 银仍由 `badgesGold` / `badgesSilver`（台账计数）与 core `playstyleIsGold`（槽位判定）定，本轮只统一呈现。
- **不做「全站同一形态」**：表格 `text` 与卡片 `icon`/`chip` 的密度差异是场合差异（列宽、扫读方式不同），不是语义差异 —— 强行统一会让窄列变吵或让卡片丢色。
- **散文与 CHANGELOG 文案不纳入**：SquadTab 荣誉行、升级方案说明句等散文保留自然语言，只保证计数顺序（金在前）与全称口径一致。
- **compact 不铺 webp 图标**：这是表格列此前退化成纯文本的根因，本轮用「紧凑文本形态」解决而不是「恢复图标」；若将来要图标，应先做图标字体或 sprite，不引入每行 N 个请求。
- **`psBadgesOf` 的输入是 `psIds` 数组**：列表端点的 `psIds` 由 worker 侧组装，空槽形态（`null` vs `0`）取决于上游；本函数对两者都跳过，属防御性口径。
- **整徽的 webp 图标目录目前是空的（老问题，登记不改）**：`web/assets/playstyle/` 无文件 ⇒ 整徽的 `<img class="ps-icon">` 请求一律 404，靠 `onError` 把图标隐藏、退化成「emoji + 名称」。本轮未修（不在统一口径范围内）；将来补图标时按 `ps-badge` 既有 DOM 结构直接放文件即可，compact 路径不受影响（本就不拉图标）。

## 4. 测试与验收

- 纯函数：`web/src/components/BadgeCounts.test.tsx`（`badgeCountItems` 金在前 / 零值抑制 / 全 0 空数组 3 例 + `badgeCountLabel` 三密度 1 例）；`web/src/pages/PlayersLibrary.test.tsx`（`psBadgesOf` 5 例，含 `[null, 0, 1.5, -3, 7]` 空槽矩阵与全空 / 无 `psIds`）。
- 组件：`BadgeCounts.test.tsx` 渲染 5 例（icon title / text 类名 / chip 类 / 全 0 不渲染 / className + sep）；`web/src/components/PlaystyleBadge.test.tsx`（整徽 3 例零变化 + compact 2 例）；`web/src/pages/PlayerCompare.test.tsx` TC-CMP-POS-05/06（`2金 · 3银` 与全 0「—」）。
- 组装层：`web/src/lib/club-columns.test.ts` 新增 2 例（评审 P2-4 补，收口前完成）——badges 列（双 0 出「—」/ 有值走 `BadgeCounts` `density="text"` 且 props 正确）与 ps 列（空槽与非法值出「—」/ 有徽章走 `PlaystyleBadge` `compact` 且金段 ID 归一）的元素级断言。**原登记的覆盖缺口已关闭**：这两个 `<td>` 是本轮唯一改过的表格组装点，此前只有 `psBadgesOf` / `BadgeCounts` 的底层单测。
- 验收门槛：`npm run typecheck` 三份清 + `npm test` 全绿 + `npm run build` 成功 + e2e 全过 + code-review-skill 到绿。

## 5. 版本

判级 minor（用户可见的一致性修复 + 一处空槽显示缺陷修复）；零迁移、零 API 变更。版本落 **6.35.0**（与热区图 / 雷达统一同轮，见该 spec §6）。
