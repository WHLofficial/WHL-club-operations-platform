# 计划 · v6.66.0 审核通过即过户（成交挂单收口 → 判据替换 → 顺序翻转）

## 缘起

owner 2026-11-01 两问：「为什么挂牌截止之后变成待审核了（即使是审核之后、谈判之后）？」「应当在谈判之前球员就过户、钱就划转，要考虑到谈判不可能导致球员退回原队的，不用防这点。」随后澄清「不是先过户、合同暂沿用旧条款、之后再重签；是把扣钱、挪球员的操作放在谈判之前」，并要求「先落文档，然后 brainstorming，然后 grilling」；grilling 十问后下令「按顺序开工，并分配版本号」，又纠偏「分配一个版本号比较好吧」⇒ 全案 **v6.66.0**，三期 = 同版本三个提交。

设计定稿：`memory/design-transfer-before-negotiation.md`（裁决 D1–D10、8 处判据表、迁移 0088 四列、风险表）。

## 第 1 期 · 成交挂单收口（已完成，2026-11-01）

- [x] `src/worker/transfers.ts`：`completeTransfer` 成功批次补 `UPDATE listings SET status = 'delisted', deadline_note = '已成交'`（白名单四态，幂等）
- [x] `src/worker/bypass.ts`：`findInFlight` 加 `'negotiation'` 段（`s.status='active' AND t.status <> 'signing'`）+ `ensureNotInFlight` 文案
- [x] `tests/listing-closeout.test.ts` 2 例；变异三靶全红
- [x] `scripts/prod-20261101-listing-closeout/`（01 预检 / 02 应用 / 03 回读 / README）
- [x] `docs/test-plans/v6.66.0-listing-closeout.md`、CHANGELOG、ROADMAP 节
- [x] `package.json` 6.65.4 → 6.66.0（v6.65.5 已被 `memory/plan-v6.65.5-shop-all-players.md` 占用，跳号）
- [x] typecheck 三份全清、`npm test` 181 / 2,939 全绿
- [ ] 本地 commit

## 第 2 期 · 判据替换（已完成，2026-11-01）

把「谈判在途」的判据从 `transfers.status='signing'` 换成「存在 active 会话」，为第 3 期铺路。8 处：

| # | 位置 | 现判据用途 |
| --- | --- | --- |
| 1 | `src/worker/bypass.ts:379` | 普通续约闸「他还有一场签约谈判没结束」 |
| 2 | `src/worker/window-machine.ts:385` | 上调窗关强约清单 |
| 3 | `src/worker/window-machine.ts:401` | 关窗强制结算清单 |
| 4 | `src/worker/activations.ts:74` | 上调谈判期不可被激活（promoLock） |
| 5 | `src/worker/promotion.ts:45` | 上调前置检查 |
| 6 | `src/worker/promotion.ts:284` | 上调成约 |
| 7 | `src/worker/demand-ops.ts:194` | 涨薪诉求生成 |
| 8 | `src/worker/season-settle.ts:222` | 赛季结算阻塞 |

落实：新模块 `src/worker/negotiation-guard.ts`（`ACTIVE_SESSION_SQL` + `findActiveNegotiationSession` / `findActivePromotionSession` / `findNegotiationInFlight`）；8 处全部替换，另加海捞两处口径（`checkSeaSignEligible` + `/api/market/sea-lookup` 批量副本）；新增 `tests/negotiation-guard.test.ts` 5 例。验收：typecheck 三份全清、`npm test` 182 / 2,944 全绿（既有 2,939 例零改动）、变异两靶全红。

原做法备忘：抽一个共用片段（形如 `EXISTS (SELECT 1 FROM negotiation_sessions s WHERE s.transfer_id = t.id AND s.status = 'active')`），逐处替换；因今天所有 active 会话都挂在 `signing` 单据上，替换后行为等价 ⇒ 全量测试必须零变化（181 / 2,939 不动）。变异验证：把新判据改成恒真，看 8 处对应的既有用例是否变红。

## 第 3 期 · 顺序翻转（迁移 0088，已完成 2026-11-01）

- [x] 迁移 `0088_transfer_terms_after_ownership.sql`：`transfers` 加 `pre_settle_snapshot TEXT`（JSON）/ `terms_applied INTEGER NOT NULL DEFAULT 0` / `reverted_at` / `revert_reason` + `idx_transfers_player_status`；`tests/d1.ts` 的 `MIGRATION_FILES` 已登记
- [x] `completeTransfer`：首句写 `pre_settle_snapshot`；`else if (!amendment)` 补 `contract === null` 时的占位合同 UPSERT（wage/RC 0、signed_at NULL）
- [x] 审核通过分流改为：`approveTransferDeal` 的 `settleThenOpen` = 先 `completeTransfer`（不带条款）→ 再 `openNegotiationSession`；`openNegotiationSession` 的硬闸接受 `pending_review | completed`
- [x] `applyContractTerms(env, transferId, terms, actor, origin)`（`src/worker/transfers.ts`）：按类型写 wage/RC/合同类型/签约时刻，`terms_applied` 幂等闸；`settleActiveSession`、`healSettlement` 成约只写条款，不再二次过户
- [x] `promotion` 例外：无审核步且附加费依赖谈成 RC，仍走谈判成约（`applyContractTerms` 对其 409）
- [x] `adminRevertDeal`（由 `adminCancelSigning` 改造，`POST /api/admin/negotiations/:id/void`）：completed 走 `revertDeal`、signing 仍走 `voidSigningCore`；理由必填、限 `currentWindow(db) != null`、之后无新成交单；快照还原归属+资金+条款，单据置 `reverted`（`src/worker/deal-revert.ts`）
- [x] `voidSigningCore` 对 completed 单短路（人已在买方）；`healSettlement` 按 completed/signing 分流；`closeSilentSessions` 对 completed 单改强约
- [x] 前端「合同谈判中」紫色小标（球员页在途区，数据源 `/api/club/players/:id/requests` 的 `negotiating`），市场页「待审核」页签保留
- [x] 测试计划扩到 §7；全量回归 184 文件 / 2,952 例；变异三靶全红

## 硬约束

- 未授权不 push、不 deploy、不跑 `--remote` 写；修复脚本的 `--remote` 需单独授权。
- 迁移先 apply 生产再 push（第 3 期）。
- 判级：第 1 期 minor；第 3 期为 minor（可见行为变化，无 DB 破坏性改动）。
