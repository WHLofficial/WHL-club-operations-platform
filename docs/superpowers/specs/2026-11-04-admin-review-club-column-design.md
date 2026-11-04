# 审核队列「俱乐部」列设计（2026-11-04）

> 需求来源：owner 反馈（m01479）「审核队列里要加上队名啊，我现在都不知道是谁做的交易或者海捞等等，就像消费工单一样」。
> 裁决：**A · 独立俱乐部列**（不是把队名拼进摘要）。本轮先落文档，不动代码。

## 1. 问题

### 1.1 现象

管理端审核队列（`/admin/market` 顶部「审核队列」）里，海捞、解约、续约、匹配留队四类单据只看得到金额/条款摘要，看不到是哪家俱乐部做的。

### 1.2 链路：数据有，前端吃掉了

- 后端 `GET /api/admin/reviews` 已经两次 JOIN `clubs`，响应里带 `transfer.fromClubName` / `transfer.toClubName`（`src/worker/routes/admin/reviews.ts:325`、`:365-366`）。
- 前端「内容」列是 `summary ?? (fromClubName → toClubName)`（`web/src/pages/admin/MarketPage.tsx:400-406`）。
- `bypassSummary()`（同文件 `:31-55`）对 `rc_change` / `termination` / `free_agent` / `match` 四类 `payload.kind` 返回非空摘要，于是 `summary` 短路，队名永远不渲染；只有普通 `transfer` / `activation` / `forced_auction`（`kind` 为空）才走 `from → to`。

### 1.3 生产分布（2026-11-04 实读，`review_tasks` 共 178 条 `transfer_confirm`）

| kind | 条数 | 队名现状 |
|---|---|---|
| （普通 / 激活 / 强拍） | 45 | ✅ 可见 |
| `free_agent`（海捞） | 61 | ❌ 被摘要顶掉 |
| `termination`（解约） | 48 | ❌ |
| `rc_change`（续约） | 23 | ❌ |
| `match`（匹配留队） | 1 | ❌ |

当前唯一一条待审（`review_tasks#176`）是解约单，操作方拜仁慕尼黑，队列里看不到。约 **3/4** 的历史审核单属于「队名被摘要顶掉」的四类。

### 1.4 与消费工单的差距

消费工单有独立「俱乐部」列，名字 + 可点 ID 标签（`web/src/pages/admin/AdminShopPage.tsx:135`、`:151-153`）：

```tsx
<td>{o.clubName ?? '—'} <IdTag kind="俱乐部" value={o.clubId} /></td>
```

审核队列既没有这一列，DTO 也只有队名、没有 `fromClubId` / `toClubId` / `activatorClubId`（`web/src/lib/api.ts:1089-1099`），无法复用 `IdTag`。

## 2. 目标 / 非目标

**目标**

1. 审核队列每一行都能一眼看出「哪家俱乐部做的」。
2. 与消费工单同构：队名 + `IdTag kind="俱乐部"`，ID 可复制。
3. 不改任何业务规则、结算口径、审核动作、摘要内容。

**非目标**

- 不把队名拼进摘要（`bypassSummary` 的金额/条款口径保持原样）。
- 不重做审核队列表格视觉，不做移动端专项。
- 不新增端点、不改权限；只扩展现有 `GET /api/admin/reviews` 的响应字段（向后兼容）。

## 3. 列语义（按单据类型取义）

新增「俱乐部」列，渲染规则：

| 单据类型 | 取哪个俱乐部 | 展示 |
|---|---|---|
| `transfer` / `activation` / `forced_auction` | `fromClubId` → `toClubId` | `曼联 → 尤文图斯` |
| `free_agent`（海捞） | `toClubId`（签入方） | `RB莱比锡` + 小字「签入」；`fromClubName` 非空时第二行小字「原队 佛罗伦萨」 |
| `termination`（解约） | `fromClubId`（操作方） | `拜仁慕尼黑` + 小字「解约」 |
| `rc_change`（续约） | `fromClubId`（= `toClubId`） | `巴塞罗那` + 小字「续约」 |
| `match`（匹配留队） | `fromClubId`（= `toClubId`） | `巴塞罗那` + 小字「留队」 |
| `activation_report`（激活举报） | `activatorClubId` | `巴黎圣日耳曼` + 小字「激活方」 |

- 名字后统一挂 `IdTag kind="俱乐部"`；id 或名字为空时只渲染 `—`，不挂标签。
- 角色小字只起消歧作用，不参与排序/筛选；字号继承 `.muted`。
- 普通单的两端都可能为空（强拍/自由身转出方为空）→ 空缺端显示 `—`，不隐藏箭头。

**列顺序**：

```
[勾选] | 球员 | 俱乐部 | 单据 | 内容 | 金额（m） | 状态 | 操作/结果
```

「俱乐部」紧跟「球员」，与消费工单「俱乐部」在前、「摘要」在后的阅读顺序一致；「单据」保持类型徽章 + 转会 IdTag 不动。

## 4. API 变更（加性，零迁移）

`src/worker/routes/admin/reviews.ts` 的 SELECT 增加：

```sql
COALESCE(t.from_club_id, l.seller_club_id) AS from_club_id,
COALESCE(t.to_club_id, l.activated_by)     AS to_club_id,
l.activated_by                             AS activator_club_id,
```

映射：

- `report` 增加 `activatorClubId: number | null`（与现有 `activatorClubName` 并排）。
- `transfer` 增加 `fromClubId: number | null`、`toClubId: number | null`。

`web/src/lib/api.ts` 的 `AdminReviewRow` 同步加三个字段。旧前端读到多余字段无害；新前端对旧后端字段缺失按 `null` 处理（`?? null`），无需版本协商。

## 5. 前端实现要点

`web/src/pages/admin/MarketPage.tsx`：

1. 表头在「球员」后插入 `<th>俱乐部</th>`。
2. 激活举报行与成交行各 insert 一个 `<td>`；两处共用一个小函数 `clubCell(r)`，避免两套口径。
3. `clubCell` 只读 `r.transfer.type` / `r.report` 与三个新字段，不碰 `payload`。
4. 窄屏沿用 `.table-wrap` 横向滚动；不加 `hidden-*` 类，也不折叠成第二行——审核员在窄屏同样需要队名。
5. 键盘游标、批选、`row-hit` 高亮、`id=review-transfer-*` 均不动（列位置变化不影响）。

## 6. 边界与空值

- `free_agent` 的 `from_club_id` 可能为 NULL（真自由身）或 CPU 原队（海捞来源）；前者只显示签入方，后者第二行「原队 X」。
- `termination` 的 `to_club_id` 恒为 NULL → 只显示解约方。
- 激活举报没有 `transfers` 行，只能走 `l.activated_by`；`activator_name` 与 id 都为空时显示 `—`。
- 俱乐部改名/删除：与全站一致，走实时 JOIN；历史单显示当前队名。

## 7. 测试

| 编号 | 层 | 断言 |
|---|---|---|
| TC-RV-CLUB-01 | API（`tests/bypass-routes.test.ts` 旁） | 海捞单响应 `transfer.toClubId` 非空、`fromClubId` 为空；`toClubName` 与种子俱乐部一致 |
| TC-RV-CLUB-02 | API | 解约单 `fromClubId` 非空、`toClubId` 为空 |
| TC-RV-CLUB-03 | API | 激活举报行 `report.activatorClubId` 与 `activatorClubName` 同时存在且互相匹配 |
| TC-RV-CLUB-04 | 前端（`MarketPage` 渲染测试） | 普通单单元格文本含 `曼联` 与 `尤文图斯`，两个 `IdTag kind="俱乐部"` |
| TC-RV-CLUB-05 | 前端 | 海捞单单元格含签入队名与「签入」；解约单含操作队名与「解约」；`rc_change` / `match` 同样不丢队名 |
| TC-RV-CLUB-06 | 前端 | 空值：`toClubId` / 名字为 null 时渲染 `—`，不渲染 `IdTag`（最坏情况口径） |

现有 `web/src/pages/admin/MarketPage.summary.test.tsx` 只锁摘要字符串，不受影响；表头新增列需检查是否有测试按 `<th>` 数量断言（目前未见 `colSpan`）。

## 8. 影响面

- `src/worker/routes/admin/reviews.ts`（SELECT + 映射）
- `web/src/lib/api.ts`（`AdminReviewRow` 类型）
- `web/src/pages/admin/MarketPage.tsx`（表头 + 两种行）
- `tests/bypass-routes.test.ts` / `tests/activation.test.ts` 或新增前端测试
- 收口时 `CHANGELOG.md` + `ROADMAP.md`

零迁移、零新端点、零缓存策略变更（管理端响应本就 `private`）。

## 9. 版本

判级 **minor**（UI 信息 + 加性 DTO 字段），目标版本 v6.76.0。不涉及资金、结算、审核动作语义，可独立上线。
