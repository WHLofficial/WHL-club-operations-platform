# 设计定稿：审核通过即过户（扣款与归属变更挪到签约谈判之前）

来源：用户 2026-11-01 三条裁决——
① 「为什么挂牌截止之后变成待审核了（即使是审核之后、谈判之后）？」
② 「不是先过户、合同暂沿用旧条款、之后再重签；是把扣钱、挪球员的操作放在谈判之前，不然在买家谈判前，卖家的阵容里一直有该球员，而买家没有。……谈判不可能导致球员退回原队，不用防这点。」
③ 流程指令「先落文档，然后 brainstorming，然后 grilling」。

本文件 = 三轮问答后的定稿，实现以本文件为准。目标版本 **v6.66.0**，三期落地（§8）。
**状态：已实现（2026-11-01，三期同一版本号，三个本地提交）。** 实测口径见 `docs/test-plans/v6.66.0-listing-closeout.md` §6–§7 与 ROADMAP 的 v6.66.0 节；本文件保留为裁决依据，不再随实现细节微调。

---

## 0. 锁定的裁决

| # | 议题 | 裁决 |
|---|---|---|
| D1 | 翻转范围 | **全部单据统一翻转**：换队四类（`transfer` / `activation` / `forced_auction` / `free_agent`）+ `rc_change` / `match` / `promotion` |
| D2 | 谈判破裂 | 不设「退回原队」出口。三条出口：谈成 / 次数用尽或超时按 E 强约 / 接受训练营条款 |
| D3 | 谈判失败兜底 | 保留 72h 静默超时，超时 = 按 E 强约（`forced`），**不再作废** |
| D4 | 审核时的体检 | 不新增工资帽/阵容人数前置校验（现状没做，本轮也不做） |
| D5 | 撤销 | 成约后也可撤销，**限关窗前**；关窗后工资已结算则不可撤 |
| D6 | 撤销范围 | **覆盖「本队留人」类**（`rc_change` / `match` / `promotion` 也可撤）——用户 Q7 答「要」 |
| D7 | 回滚快照 | 存 `transfers` 新增 JSON 列 `pre_settle_snapshot`（迁移 0088），不建新表 |
| D8 | 撤销入口 | 复用 `src/worker/market-intervene.ts:132` 的 `adminCancelSigning`，改名 `adminRevertDeal`；理由必填，进审计 + `evidence`，二次确认 |
| D9 | 界面 | 球员卡/阵容行加「合同谈判中」小标；市场页「待审核」页签保留（收口后自然变空，不改名） |
| D10 | 历史脏数据 | 一次性修复脚本收 14 条 `completed` 的挂单为 `delisted`（只改 listings 一个字段，§7） |

> Q7 的「要」与我的推荐相反，我按「要覆盖本队留人类」执行。若理解有误，这是唯一需要回退的一条。

---

## 1. 问题 A：成交的挂单永远停在「待审核」

### 1.1 机制

截止判定把挂单从 `bidding` 改写成 `pending_review`，这是设计意图（`src/worker/market-settle.ts:75`，同批还建 `transfers(pending_review)` + `review_tasks`）。语义 = 「竞价已结束，结果待管理组确认」。

问题在收口：**这个状态没有任何一条成功路径能离开它。**

| 环节 | 代码 | 是否回写 listings |
|---|---|---|
| 审核通过 | `src/worker/bypass.ts:1009` `approveTransferDeal` | 否（只把 transfers 改 `signing` 并开谈判会话） |
| 谈判成约 | `src/worker/negotiations.ts:542` → `src/worker/transfers.ts:181` `completeTransfer` | 否（全文不碰 listings） |
| 审核驳回 | `src/worker/transfers.ts:951` | 是 → `delisted`，note「审核驳回」 |
| 谈判作废 | `src/worker/negotiations.ts:812` `voidSigningCore` | 是 → `delisted` |

即：**只有失败路径收口，成功路径不收口**。全仓 `UPDATE listings SET status` 只有 8 处，没有一处是成交收口。

### 1.2 生产事实（2026-11-01 只读查询）

- `listings` 状态分布：`bidding` 17 / `listed` 5 / `matched_pending` 2 / `pending_review` **20** / `delisted` 5。
- 这 20 条的联单状态：`completed` **14**、`signing` 6、`rejected` 0。
- 即 **14 条「球员已过户、钱已划转」的挂单永远停在待审核**。例：listing 27 → transfer 95 `completed` 2026-10-31T18:30Z（Désiré Doué 现属 RB 莱比锡）；listing 26 → transfer 94（Diogo Costa 现属里昂）。

### 1.3 后果（硬阻断，不是显示问题）

- `src/worker/bypass.ts:49` `findInFlight()` 把 `pending_review` 当「球员还在市场流程里」。它是**续约**（`bypass.ts:363`）、**解约**（`:488`）、**海捞**（`:879`）、**上调/下调**（`src/worker/promotion.ts:127`、`:257`）的统一前置闸 ⇒ 这 14 名球员上述操作全被拒（「这名球员已经有一单在市场流程里了」）。
- 挂牌查重 `src/worker/routes/market.ts:264` 含 `pending_review`；唯一索引 `idx_listings_active_player`（`src/db/migrations/0006_activation_negotiation.sql:13`）同样 ⇒ 不能再挂牌、不能被激活。
- UI：`statusFilter()`（`src/worker/routes/market.ts:85-100`）`active` 不含 `pending_review`、`ended` 只查 `delisted` ⇒ 永远躺在「待审核」页（`web/src/pages/market/shared.tsx:10/19/27`）。

根因：`pending_review` 一个状态背了两个语义——「竞价结束待人工审」和「结果已处理」。

---

## 2. 目标流程

```
bidding ──截止──→ pending_review ──审核通过──→ 【扣款 + 过户 + 挂单收口】──→ 签约谈判 ──→ 条款生效
                       │                     （球员已在买方队内，wage/RC 沿用旧值）
                       └──审核驳回──→ rejected + listing delisted
```

关键点：

1. **审核通过 = 终局交易**。买方付钱、卖方收钱、球员归属变更，全在谈判之前。之后卖方阵容里已无此人。
2. **谈判对象变了**：不再是「给一张转会单签合同」，而是「对一名已在买方队内的球员谈合同」——与 `completeTransfer` 的 `amendment` 分支（`src/worker/transfers.ts:451-510`）同形状，只改 wage / release_fee / contract_type。
3. **合同行必须随人一起走**（不是可选项）：工资帽、续约、激活、薪资结算全读 `contracts.club_id`（`src/worker/squad-context.ts:35`、`src/worker/demand-ops.ts:1770`、`src/worker/window-payroll.ts:52`）。过户瞬间合同 `club_id` 改为买方，wage/RC 保持原值——这正是无 terms 桥接分支 `src/worker/transfers.ts:642-656` 在做的事，把它从「兜底」提升成主路径。
4. **`promotion` 是例外**：无审核步（`src/worker/transfers.ts:482` 注释「上调无审核步，成约即唯一扣费点」），附加费 `promotionSurcharge(dealTerms.releaseFee)` 依赖谈成的 RC ⇒ 物理上无法在谈判前结算。它保持「谈判成约时才结算」，只是改走同一个 `applyContractTerms`。

---

## 3. 模块设计

### 3.1 归属与钱（沿用 `completeTransfer`）

审核通过时调 `completeTransfer(env, transferId, actor, origin)` **不带 terms**：扣款、税、账本、`players.club_id`、`contracts.club_id`、`transfers.status='completed'` 一次走完，然后写 `listings → delisted`。

对 `rc_change` / `match` 这两类 amendment，`completeTransfer` 今天没有无条款分支（`else if (!amendment)` 在 `src/worker/transfers.ts:624`）⇒ 本轮把「写合同的语句」整段挪进 `applyContractTerms`，`completeTransfer` 只保留「带 terms 时 = 结算 + 立即 apply」的兼容壳。

### 3.2 新函数 `applyContractTerms`（`src/worker/transfers.ts`）

```ts
applyContractTerms(db, transferId, terms: {
  wage: number; releaseFee: number; contractType?: 'formal' | 'trainee';
}): D1PreparedStatement[]
```
返回语句而非直接执行，便于并入调用方的 batch（保持 `claim_token` 式的单批原子性）。写入范围与今天 `completeTransfer` 的 dealTerms 分支逐字等价：`contracts.wage / release_fee / contract_type / club_id / service_ticks / protection_ticks / signed_at / free_rc_change_used`。

### 3.3 谈判会话挂在已完成的单上

| 文件 | 现状 | 目标 |
|---|---|---|
| `src/worker/negotiations.ts:133` | `status !== 'pending_review'` 抛 409 | 接受 `completed`（会话挂在已结算的单上） |
| `src/worker/negotiations.ts:155` | `UPDATE transfers SET status='signing'` | 删除（不再改 transfer 状态） |
| `src/worker/negotiations.ts:542` `settleActiveSession` | 调 `completeTransfer(...terms)` | 改调 `applyContractTerms` |
| `src/worker/negotiations.ts:787-826` `voidSigningCore` | 还原球员 + 挂单回 `delisted` | 退役；只保留 D3 的强约路径 |
| `src/worker/negotiations.ts` `healSettlement` | 要求 `transfer.status === 'signing'` | 改为「会话 settled 且条款未落」的重放（见 §3.6） |

### 3.4 「谈判在途」判据必须换（最大的坑）

全仓把「谈判在途」编码成 `transfers.status='signing'`，至少 8 处 `JOIN negotiation_sessions s JOIN transfers t … AND t.status='signing'`：

| 位置 | 作用 | 不换的后果 |
|---|---|---|
| `src/worker/bypass.ts:379` | 普通续约闸 | 续约被放行 |
| `src/worker/window-machine.ts:385` | 上调窗关强约清单 | 关窗不再强约 |
| `src/worker/window-machine.ts:401` | 关窗强制结算清单 | 关窗跨过在途谈判 |
| `src/worker/activations.ts:74` | 上调谈判期不可被激活 | 可被激活 |
| `src/worker/promotion.ts:45`、`:284` | 上调资格/谈判查询 | 重复开单 |
| `src/worker/demand-ops.ts:194` | 涨薪诉求生成 | 重复生成诉求 |
| `src/worker/season-settle.ts:222` | 赛季结算阻塞 | 赛季推进不被挡 |

判据统一改 `negotiation_sessions.status = 'active'`。**这一期可独立上线，行为不变。**

### 3.5 `findInFlight` 补一段

`src/worker/bypass.ts:46-61` 增加「该球员有 active 谈判会话」→ 返回 `'negotiation'`。否则过户后球员是买方 `normal`，条款未定期间可被立刻再挂牌/再激活，全仓无保护期闸。

### 3.6 幂等与重放

- 过户本身幂等：`ledgerMovement` 闸按 `(club_id, kind, ref_type, ref_id)`；`transfers` 状态 UPDATE 带 `AND status IN (...)`。
- 条款落地幂等：`applyContractTerms` 的 UPDATE 带 `AND (SELECT status FROM negotiation_sessions WHERE id = ?) = 'settled'`，并在同批末句置 `terms_applied=1`（迁移 0088 一列，或复用 `evidence` JSON——取前者，判据要能索引）。
- `healSettlement` 改为：会话 `settled` 且 `terms_applied=0` → 重放 `applyContractTerms`。过户已在前一步完成，不需要重放。

### 3.7 账本与税

- 扣款时机前移到审核通过，幂等闸不变。
- 预期收入额度源②（`src/worker/ledger.ts` `inflightIncomeSql()`：`transfers.status IN ('pending_review','signing')`）在过户后自动退出，卖方收入变现金，不重复计。
- **税基写死**：`completeTransfer` 用过户时刻现行合同的 `release_fee` 算分段税（`src/worker/transfers.ts:240` 附近）。谈判把 RC 谈高不补税——方向安全（抬 RC 只让卖方多交税），写进文档不再改。

---

## 4. 撤销（`revert`）

### 4.1 适用条件（三条全满足才可撤）

1. transfer 为 `completed` 且 `terms_applied=1`；
2. `currentWindow(db)`（`src/worker/contract-ticks.ts:14-28`）非 null —— 关窗前；
3. 该球员此后没有新的成交/激活（`transfers` 里同一 player 之后无 `completed` 行）。

### 4.2 动作（单批）

- 退款：买方 `transfer_in` 反向一笔 + 卖方 `transfer_out` 反向，税**不退**（写进审计说明）。
- 归属：`players.club_id` / `contracts.club_id` 回卖方（`free_agent` / `forced_auction` 的 CPU 卖方退到 null 侧，按 snapshot 还原）。
- 合同：按 `pre_settle_snapshot` 还原 wage / RC / contract_type / ticks。
- 单据：`transfers.status='reverted'`（`0001_init.sql:110-127` 无 CHECK 约束，可直接新增值），`reverted_at` / `revert_reason` 落列。
- 挂单：恢复为 `delisted`（挂牌本身不复活——重新挂牌要重新走市场）。

### 4.3 amendment 类（D6 追加）

`rc_change` / `match` / `promotion` 无归属变化，撤销 = 退费 + 按快照回滚合同；`players` 不动。`promotion` 撤回首要把 `contract_type` 回 `trainee`，附加费退还。

### 4.4 入口

`adminRevertDeal`（原 `adminCancelSigning`，`src/worker/market-intervene.ts:132`）：理由必填，写 `audit_log`（`action='transfer_revert'`）与 `transfers.evidence`，前端二次确认。

---

## 5. 界面

- 球员卡/阵容行：「合同谈判中」小标（复用现有紫色徽 `.badge-review` 样式），条件 = 该球员有 active 会话。
- 市场「待审核」页签保留，收口后自然变空。
- 管理端：单据行显示 `reverted` 徽标 + 撤销按钮（仅在 §4.1 三条满足时可见）。

---

## 6. 迁移 0088

```sql
ALTER TABLE transfers ADD COLUMN pre_settle_snapshot TEXT;      -- JSON，过户前合同/球员快照
ALTER TABLE transfers ADD COLUMN terms_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transfers ADD COLUMN reverted_at TEXT;
ALTER TABLE transfers ADD COLUMN revert_reason TEXT;
```
`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0088_*.sql`（漏了夹具与迁移脱节）。

---

## 7. 历史数据修复（D10）

一次性脚本 `scripts/prod-20261101-listing-closeout/`，不是迁移、不是新代码行为：

```sql
UPDATE listings
   SET status = 'delisted',
       deadline_note = '已成交（历史收口 2026-11-01）'
 WHERE status = 'pending_review'
   AND EXISTS (SELECT 1 FROM transfers t
                WHERE t.idempotency_key = 'listing:' || listings.id
                  AND t.status = 'completed');
```

- 关联键：`transfers.idempotency_key` 的 `listing:<id>`（`src/worker/transfers.ts:84-87` `listingIdFromTransfer`）。
- 预期 14 行；只改 listings 一个字段，不动 transfers / players / 账本。
- 6 条 `signing` 的不动，等它们按新路径一次收口。
- 风险：一次性放开 14 人可续约/解约/挂牌（这是期望结果）。
- 回滚：备份 14 个 id，反向 UPDATE。
- 先 `--local` 验，再 `--remote`（写操作，需单独授权）。

---

## 8. 分期与发布顺序

| 期 | 内容 | 迁移 | 可独立上线 |
|---|---|---|---|
| 一 | `completeTransfer` 成功收口 listings；历史数据修复；`findInFlight` 补 negotiation 段 | 无 | 是 |
| 二 | 8 处 `signing` 判据换 `session active`（行为不变，纯判据） | 无 | 是 |
| 三 | 顺序翻转：`approveTransferDeal` → 过户 → 开会话；`applyContractTerms`；`voidSigningCore` 退役；`adminRevertDeal`；前端标记 | **0088 先 apply** | 否 |

发布：`npm run typecheck` + `npm test` + `npm run build` 全绿 → `docs/test-plans/v6.66.0-transfer-before-negotiation.md`（qa-test-planner 产出）→ 0088 先 apply → push（自动部署）。

---

## 9. 测试（最坏情况口径）

- **变异验证**：① 删 `listings` 收口 ⇒ 断言红；② 删 `findInFlight` 的 negotiation 段 ⇒ 红；③ 8 处判据任意一处漏改 ⇒ 红（每处一条断言）；④ `applyContractTerms` 的 settled 闸删掉 ⇒ 重放测试红；⑤ 撤销的窗口闸删掉 ⇒ 关窗后撤销测试红。
- **边界**：`completed` 重复调用、会话 settled 两次、撤销后再撤销、`free_agent`（卖方 null）、`promotion`（trainee→formal）。
- **迁移**：0088 幂等重跑、账本与库脱节重建。
- **生产回读**：修复脚本执行后 `pending_review` 且 `completed` 的联单数 = 0；14 名球员续约端点 200。

---

## 10. 文档同改

- `TECH_DESIGN.md` §6.1 状态图（`pending_review → 批准 → 过户 → 谈判 → 条款`）。
- `TECH_DESIGN.md` §6.4 不变式 2「completed 的到达时机 = 签约谈判成约（成约即过户）」——**必须推翻改写**。
- `TECH_DESIGN.md:389`「训练营球员 → pending_review」——v6.64.3 起已不成立，顺手订正。

---

## 11. 风险

| 风险 | 说明 | 处置 |
|---|---|---|
| 8 处判据漏改 | 静默失效，无报错 | 第二期独立上线 + 全仓 grep 锁（`t.status='signing'` 归零）+ 逐处断言 |
| 条款未定期间球员可被再挂牌 | `findInFlight` 补段 | 第一期就补，不等到第三期 |
| 条款未定即付款 | 买方可能买贵 | 用户已接受；税基按过户时刻 RC 固定 |
| 「作废」入口残留 | 会造出「人在买方、无有效合同」 | 第三期同批删除 `voidSigningCore`，测试覆盖 |
| 撤销造出双重套利 | 关窗前反复买卖 | §4.1 第三条（该球员此后无新成交）；关闭窗后禁撤 |
| `promotion` 无法前置结算 | 附加费依赖谈成 RC | 明确列为唯一例外，走 `applyContractTerms` |
