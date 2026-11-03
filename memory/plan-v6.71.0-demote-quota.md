# v6.71.0 下放名额（按队/按窗）+ 训练营硬拦 + 自愈地板

日期：2026-11-03
分支：feat/v6.68.0-admin-id-tag（沿用）

## 用户裁决

1. 下放时**作废**待生效续约（`contract_pending_changes` / `contract_demands`），不是拦。
2. 下放时**硬拦**训练营人数上限 `trainee_max`（默认 7）。
3. 名额只对**本窗 9:2** 授予，过期自然回到默认 2；不做长期按队配置。
4. 生产数据：切尔西 5 条只改 `players.status`；Virgili RC 改回 5（自愈 bug 写坏）。

## 目标

- 皇马(243)/诺丁汉森林(14)/RB莱比锡(112172) 本窗各 7 个下放名额，其余队仍 2。
- 下放入口同时守住：名额、训练营上限、待生效变更。
- 修掉 `healSettlement` 训练营地板缺失 + `completeTransfer` 不置 `terms_applied`。
- 合同导入同步 `players.status`，防再产生 5 条那种双向卡死。

## 改动

### 1. `src/core/config.ts`

- `CONFIG_KEYS` 新增 `demote_quota`。
- `CONFIG_DEFAULTS.demote_quota = '{"default":2}'`。
- 结构：`{ default?: number, by_club?: { [clubId]: number }, by_window?: { "season:windowSeq": { [clubId]: number } } }`。
- 解析优先级：`by_window[win][clubId]` → `by_club[clubId]` → `default` → 2；只接受 0..99 整数。
- `tests/config.test.ts` 的 `CONFIG_KEYS.length` 87 → 88。

### 2. `src/worker/promotion.ts`

- 删/改 `DEMOTE_QUOTA_PER_WINDOW` 的直接使用；新增 `demoteQuotaFor(db, clubId, win)`。
- 新增 `traineeCountFor(db, clubId)` + `traineeMaxFor(db)`。
- 预检：名额、训练营上限，错误文案带实际数字。
- 批次 guard 分三层：
  - `statusGuard`：球员 `status='normal'` 且 `club_id=clubId`。
  - `insertGuard`：statusGuard + 名额子查询 `< quota` + 训练营人数子查询 `< trainee_max`。
  - `settledGuard`：statusGuard + `EXISTS (transfers WHERE idempotency_key='demote:{pid}:{season}:{windowSeq}')`。
- INSERT 用 insertGuard；审计/合同 UPDATE/players UPDATE/作废语句全部用 settledGuard，INSERT 0 行整批 no-op。
- 作废：`contract_demands`（pending/countered/accepted → void, void_reason='demoted', resolved_at=now）与 `contract_pending_changes`（pending → void, void_reason='demoted'）。转会申请不强制 resolved。
- 审计 after 带 `voidedDemandIds` / `voidedPendingIds`（从预检查出，审计里列出）。

### 3. `src/worker/negotiations.ts`

- `healSettlement` 的 `releaseFee`：`session.settle_source === 'trainee' ? TRAINEE_RELEASE_FEE : session.release_fee ?? TRAINEE_RELEASE_FEE`。

### 4. `src/worker/transfers.ts`

- `completeTransfer` 在 `dealTerms` 存在时，批内追加 `UPDATE transfers SET terms_applied = 1 WHERE id = ? AND terms_applied = 0`（放在成约状态 UPDATE 之后）。

### 5. 合同导入

- 找到 S9 合同导入的落库执行点（脚本只产 SQL 则改生成器/文档），在写合同后按 `contract_type` 同步 `players.status`：`trainee → trainee`，`formal → normal`。
- 若导入只经脚本执行，生成 SQL 里追加 `UPDATE players SET status=...`。

### 6. UI 文案

- `web/src/pages/player/SideOps.tsx:857`：不写死「2 个名额」。
- `web/src/pages/market/desk/NegotiationsSection.tsx:738`：去掉「2 个」。

### 7. 测试

- `tests/promotion.test.ts`：
  - 默认 2 名额不变（TC-D2 回归）。
  - config `demote_quota.by_window["1:2"]` 给 club 1 = 7：连下 7 人成功、第 8 人 409；club 2 仍 2。
  - 非法/越界值回落默认。
  - `trainee_max=1` 时已有 1 名 trainee，再下放 409；上限内成功。
  - 下放时 pending 续约被 void（合同条款不变），audit 带 id。
  - 并发/幂等：同球员重复下放 409。
- `tests/negotiation-heal`（新或并入现有）：trainee 会话 release_fee=1 的已完成单，heal 后合同 RC=5。
- `tests/transfers`：`completeTransfer` 带 dealTerms 成约后 `terms_applied=1`，再跑 heal 不重放。
- 路由级 E2E：POST /api/transfers/demote 成功 → GET 履历/合同口径。

### 8. 生产数据修复（代码上线后执行）

```sql
-- 切尔西 5 条：按合同类型对齐 players.status
UPDATE players SET status='trainee' WHERE id IN (671,1331) AND status='normal';
UPDATE players SET status='normal'  WHERE id IN (915,1148,1157) AND status='trainee';
-- Virgili：自愈写坏，RC 改回 5
UPDATE contracts SET release_fee=5 WHERE player_id=2292 AND is_active=1 AND contract_type='trainee';
```

### 9. 生产配置（部署后）

`demote_quota`（超管 PUT /api/admin/config）：

```json
{"default":2,"by_window":{"9:2":{"243":7,"14":7,"112172":7}}}
```

## 验证

- `npm test` 全绿（至少 promotion/config/negotiation/transfers 四组）。
- `npm run typecheck`。
- 生产只读复核：名额计数、trainee 人数、pending 清理。

## 完成状态（2026-11-03）

- 代码、测试、文案、测试计划增补均已完成并 `npm run deploy` 上线；push `615dd2e..915db6e` 到 `main` 触发 CF 自动部署。
- Version：手动部署 `99b7169e-9acd-4adf-b33e-82f378603088` → 自动部署 `39184915-3978-4189-8bce-8682c5487e94`（同产物 `assets/index-De3yG08v.js`，版本串 6.71.0）。
- `npm run typecheck` 三份清；`npm test` **192 文件 / 3,007 例全绿**；`npm run build` 通过。
- 生产数据修复已执行：切尔西 671/1331→trainee（changes 2）、915/1148/1157→normal（changes 3）、Virgili 2292 RC→5（changes 1）。
- `demote_quota` 已 upsert 并回读：243/14/112172 = 7、default 2。
- 可用名额提醒：皇马现有 3 名 trainee，`trainee_max=7` ⇒ 本窗最多再下放 4 人；诺丁汉 1 ⇒ 6；莱比锡 0 ⇒ 7。要真正用满 7 个名额，需先上调现有 trainee 或调高全局 `trainee_max`。
- 环境备注：本机解析器对 `api.cloudflare.com` 返回畸形响应，已在 hosts 加临时映射 `104.19.192.29 api.cloudflare.com` 恢复 wrangler 访问；后续如再遇 `Unable to resolve Cloudflare's API hostname` 先检查该行。

