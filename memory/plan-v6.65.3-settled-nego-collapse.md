# v6.65.3 计划 · 已结算 / 已作废谈判的折叠区

状态：**待 owner 拍板 Q1–Q5 后开工**。零迁移预案（作废原因从 `audit_log` 派生）。
前置：v6.65.2（进行中会话折叠）已上线 Version `77daa2c2-cb76-4275-b47a-46bdcffae23a`。

## 1. 缘起

owner 在 v6.65.2 的 grilling 里定：「已结算折叠区有必要单开一版」。玩家视角的缺口是——一场谈判成交或被作废之后，**这条记录在本俱乐部彻底消失**：谈定多少工资、什么时候结束的、为什么作废，都查不到。`negotiation_sessions` 里数据是全的（52 行：active 9 / settled 43），只是前端把非 active 的行丢掉了。

## 2. 现状事实（已核）

| # | 事实 | 位置 |
|---|---|---|
| 1 | `listMySessions` 的 SQL 是 `WHERE s.club_id = ? ORDER BY s.id DESC LIMIT 50`，**active / settled / cancelled 混排**，50 行上限会被历史挤占；生产当前 52 行、单队最多 9 行，尚未触发 | `src/worker/negotiations.ts:1980+`（`listMySessions`） |
| 2 | 会话状态只有三种：`active` / `settled` / `cancelled`；`settle_source` ∈ `negotiation` / `direct` / `forced` / `trainee`，文案由 `settleMessage()` 给四段 | `src/worker/negotiations.ts:54-66`、`:797` |
| 3 | `cancelled` 的行在 DTO 里 `settled: null`，且 **DTO 不含 `settled_at`** ⇒ 前端拿不到结束时间 | `src/worker/negotiations.ts` DTO 映射 |
| 4 | 作废原因不在会话表上，落在 `audit_log`：`action` ∈ `negotiation_timeout`（`after.reason` = `silence_timeout` / `ops_end`）、`transfer_self_cancel`、`admin_negotiation_void`（`after.reason` = 管理组填的理由） | `src/worker/negotiations.ts:815-823`、`src/worker/bypass.ts:591`、`src/worker/market-intervene.ts:139` |
| 5 | 前端只渲染 `active`：`const active = sessions.filter(s => s.status === 'active')`，其余行直接丢弃 | `web/src/pages/market/desk/NegotiationsSection.tsx` |
| 6 | 成交工资在 `settled_wage`；作废的会话没有工资 | `negotiation_sessions.settled_wage` |

## 3. 待拍板（每条附推荐）

- **Q1 形态**：谈判页签底部加「已结束的谈判」区块（推荐）／单独子页签／混进现有列表只标灰。
- **Q2 条数与分页**：默认 10 条 + 「查看更多」按钮，游标 `before=<sessionId>&limit=10`（推荐）；**同时把 active 与 ended 拆成两条查询**，active 不再受 50 上限挤压。备选：不分页，一次 30 条封顶。
- **Q3 卡头信息**：球员 · 结局徽标（成交 / 作废）· 谈定工资（作废显示「未签约」）· 结束时间 · 对方俱乐部（推荐）。
- **Q4 正文内容**：只放「最终报价 + 结局文案」，不拉完整对话流（推荐，避免历史页一次拉几百条 `negotiation_attempts`）；作废的会话正文放作废原因。
- **Q5 作废原因口径**：从 `audit_log` 批量派生（**零迁移**，一条 `target_type='negotiation' AND target_id IN (...)` 的查询，`after.reason` → 人话映射：`silence_timeout`「静默超时自动作废」/ `ops_end`「时段收口自动作废」/ `self_cancel`「教练自助取消」/ 其他「管理组作废：<理由>」）——推荐。备选：迁移 `0088` 给会话加 `void_reason` 列（展示最精确，但要 apply 迁移后才能部署）。

## 4. 范围

**In**：谈判页签的「已结束」区块；`GET /api/negotiations?mine=1` 的 ended 分页参数与 `endedAt` / `outcome` / `voidReason` 字段；折叠交互复用 v6.65.2；本地记忆「已结束区是否展开」。

**Out**：修改结算与作废逻辑（本版只读）；管理端历史；跨俱乐部的转会记录（有「我的转会台」原有区块承载）；已结束会话的对话流完整回放。

## 5. 交付物

1. `src/worker/negotiations.ts` · `listMySessions` 拆两条查询：active 全量、ended `LIMIT` + `before` 游标；DST 补 `endedAt`（`settled_at`）、`outcome: 'signed' | 'void'`、`voidReason`。
2. `src/worker/negotiations.ts` · 新 `loadVoidReasons(db, sessionIds)`：一条 `audit_log` 批量查询 + reason 映射（纯映射函数放 `src/core/negotiation-rules.ts` 便于单测）。
3. `src/worker/routes/negotiations.ts` · `?mine=1` 接受 `endedBefore` / `endedLimit`（默认 10，上限 50），非法值 400。
4. `web/src/lib/api.ts` · DTO 三字段 + 查询参数。
5. `web/src/pages/market/desk/NegotiationsSection.tsx` · 「已结束的谈判」区块（折叠卡 + 结局徽标 + 查看更多），复用 `SessionCard` 的卡头/正文骨架。
6. `web/src/styles.css` · 结局徽标两态（成交绿 / 作废灰）。
7. 测试：`tests/negotiations*.test.ts` 补 ended 分页与 reason 映射；`NegotiationsSection.test.tsx` 补区块渲染、加载更多、作废原因三例。

## 6. 验收

- `npm run typecheck` 三份全清；全量 `npm test` 全绿（基线 180 文件 / 2,912 例）。
- 变异靶：去掉 `before` 游标条件 ⇒ 重复加载同一页应红；把 `endedLimit` 上限去掉 ⇒ 传 500 应按 50 截断的用例应红。
- 生产回读：club 73 谈判页签应显示「已结束」区块，且 8 条进行中 + 历史互不挤压。

## 7. 风险

- 历史页如果误把 `attempts` 一起拉，单次响应会膨胀（Q4 已规避：ended 不返回 attempts 数组，只返回最后一条报价）。
- 若 owner 选 Q5 的备选（加列），部署顺序变成「先 apply 0088、再 push」，且要把迁移登记进 `tests/d1.ts` 的 `MIGRATION_FILES`。
