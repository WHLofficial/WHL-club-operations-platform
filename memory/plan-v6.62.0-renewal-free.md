# v6.62.0 实施计划 · 普通续约免费机会（§5.6 rev22 转正）

- 日期：2026-10-31
- 状态：**已实施（2026-10-31）**——分支 `feat/v6.62.0-renewal-free`（自 v6.61.0 收口点切出），3 个提交：`7381a2c`（迁移 0085 + 后端四点接线 + TC-RF-01..13）/ `b9b0bf8`（UI）/ `fdcb4f6`（评审修复）；**迁移先 apply 再 push 的纪律不变，push 待用户指令**。实测与偏差见文末「实施留痕」。
- 设计真源：`docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md` rev22 §5.6（brainstorming 对账 + grilling Q1 收口全部定稿）
- 测试计划：`docs/test-plans/v6.62.0-renewal-free.md`（TC-RF-01..13 + 变异三靶 M-01..03 + RG-RF + TC-P 探针）

## 目标

owner m04060 的「每份合同一次免费改 RC 续约」转正落地：`free_rc_change_used=0` 的合同，下一张普通续约单**自动**走免费通道——提价免收 30% 差额（审核侧跳过扣款）、不收口保护期（pending 写 `protection_ticks_new=NULL`）；apply 成功即置 1；降价同消耗；换队刷新（B 买回归 0、A 买回用现值）；match 与闹涨薪不消耗；训练营 400 / 同窗一次 / RC 边界 / renewalRaise 基准全部维持现状。

## 交付物

1. 迁移 `0085_contracts_free_rc_change.sql`：`ALTER TABLE contracts ADD COLUMN free_rc_change_used INTEGER NOT NULL DEFAULT 0`（回滚注释照 0028 模式）+ `tests/d1.ts` 的 `MIGRATION_FILES` 追加。
2. `src/worker/bypass.ts` `createRcChange`（提交侧）：读 `free_rc_change_used` → `isFree`；`changeFee = isFree ? 0 : rcChangeFee(...)`（免费跳过余额预检）；evidence 加 `freeRcChange: isFree`。
3. `src/worker/bypass.ts` `approveTransferDeal` case 'rc_change'（审核侧，**豁免真落点**）：evidence `freeRcChange=true` 则跳过 `chargeBypassFee`；无字段按非免费（兼容）。
4. `src/worker/transfers.ts` amendment rc_change 分支：pending INSERT 写 `free_rc_change = isFree`；免费时 `protection_ticks_new = NULL`，非免费维持 `= baseTicks`。
5. `src/worker/demand-ops.ts` `applyPendingContractChanges`：行投影加 `free_rc_change`；免费行同批 `UPDATE contracts SET free_rc_change_used = 1`（挂行守卫）；「不做 source 分支」注释按 rev21 source 收窄订正。
6. `src/worker/transfers.ts` `completeTransfer` 换队 upsert：列清单加 `free_rc_change_used = excluded.free_rc_change_used`。
7. 前端续约表单（§10.2）：免费可用提示「本次免费：提价不收差额、保护期不变」；已用维持现状；pending 投影「本次免费」小字（`PendingContractView.freeRcChange` 字段现成，接渲染）。
8. 文档：ROADMAP v6.62.0 节 + CHANGELOG（Added 一条）+ 设计稿状态行转「已实现」。

## 步骤

1. 迁移 0085 + `tests/d1.ts` 追加 + TC-RF-13 测试。
2. 提交侧 createRcChange（步骤 2 项）+ TC-RF-01 步骤 1 / TC-RF-03 步骤 1 / TC-RF-11。
3. 审核侧 approveTransferDeal（步骤 3 项）+ TC-RF-01 步骤 2 / TC-RF-02 / TC-RF-10。
4. amendment 分支 + apply 侧（步骤 4/5 项）+ TC-RF-01 步骤 3–4 / TC-RF-06/07/08。
5. upsert 列（步骤 6 项）+ TC-RF-04/05/09。
6. UI（步骤 7 项）+ TC-RF-12。
7. 变异三靶 M-01..03 定向变红确认。
8. 回归门五道 + code-review-skill 审查 + 修复复测。
9. **迁移先 apply 再 push**（CF 自动部署无迁移步骤）；push 只在用户下令的那轮做。

## 验收口径

- TC-RF-01..13 全绿；三变异靶恰红（失败的是目标断言）。
- typecheck 三份清、vitest 全绿（基线 173 文件 / 2,798 例，预期净增 1 describe / 20–25 例）、build 成功、e2e 11/11。
- 本地迁移幂等重跑过；生产 apply 后 `SELECT SUM(free_rc_change_used) FROM contracts` = 0（零回填）。

## 风险边界

- **豁免双落点**：只改提交侧拦不住审核扣款（`approveTransferDeal` 无上下文重算）——evidence 是唯一通道，审核侧必读。
- **upsert 残留**：换队 `DO UPDATE SET` 逐列枚举漏加新列 = 用过机会的球员换队后免费被偷走（变异靶 M-02）。
- **消耗时点**：只在 apply；void / 4.4.10 回滚发生在 apply 前天然不消耗；免费单退款循环按 `extra_fee>0` 过滤天然跳过（断言不得引入退款流水）。
- **守卫不放开**：训练营 400 / 同窗一次 409 / RC 边界 / renewalRaise 基准 / 闹涨薪不消耗——免费通道一律不改变。
- **保护期收口定稿**（grilling Q1）：非免费续约 `protection_ticks_new=baseTicks`，免费续约写 NULL——免费续约是唯一保留保护期的续约；不得复活 rev21「重建保护期」叙事（否决理由留档设计稿 §5.6）。
- **与 rev21 折价威胁协调**：两增量共用 contracts/transfer_requests 域但字段不相交（本增量只加 contracts 列；折价挂 transfer_requests.released 行）；实施顺序谁先谁后都不冲突，迁移号按先到者占用。

## 明确不做

- 经理勾选开关（owner 拍板自动动用）、闹涨薪消耗免费机会、免费改变 RC 边界或谈判基准、免费单退款、`contract_pending_changes.free_rc_change` 之外的表加列。

## 实施留痕（2026-10-31，实施后回填）

- **迁移号**：0085（v6.61.0 已占 0084，rev21 折价威胁未实施、无冲突）。
- **代码偏差一处（对设计稿的订正）**：设计稿 §5.6 把换队分支记成「`INSERT … ON CONFLICT` 逐列枚举」——实际代码普通换队走 **UPDATE**（无 DEFAULT 兜底），B 买回也走换队 UPDATE；真实落点是四处：换队 UPDATE 与买回桥接两态显式 `free_rc_change_used = 0`、海捞与无归属两处 upsert 加 `excluded` 列。已同步 ROADMAP/CHANGELOG 表述。
- **变异靶同步**：M-02 拆两变体验证（换队 UPDATE 漏 0 / upsert 漏 excluded 列），各自恰红。
- **验收实测**：typecheck 三份清；vitest 174 文件 / 2,816 例全绿（基线 173/2,798）；build 6.62.0；e2e 29/29；本地迁移落表；变异三靶恰红；code-review-skill 无 🔴、🟡×2 已修（免费降价回执方向词、迁移回滚注释）。
- **上线（2026-10-31 已执行）**：① 0085 生产 apply（`Executed 2 commands in 2.67ms`）；② push `6141102..4cd2d52` → main，CF 自动部署 Version `dbc4564d-09d6-47f9-809b-f722159113c5`（00:37:29Z）；③ 探针：contracts 517 行 SUM=0、迁移末条 0085、health 200、线上资产 `index-O44TeQIk.js`；TC-P-02/03 待真实免费单后核对。
- **发布轮插曲**：M-02b 海捞复签守护用例曾漏提交（变异时临时写入），发布前补提交 `4cd2d52` 并重跑变异恰红；另一会话从 `c1be7ba` 切出 `feat/v6.63.0-playstyle-merge`，该提交曾误落其上，已指针归位——该分支头仍指 `4cd2d52`（共享 commit，merge 无重复），多会话共用仓库时提交前先 `git branch --show-current` 核对。
