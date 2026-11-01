# 2026-11-02 · 强制拍卖放开新违约金（v6.67.0 一次性修复）

## 为什么

v6.60.5 / v6.60.7 起，强制拍卖在卖方是**自由身**或 **CPU 队**时，审核通过就把新违约金定死成成交价（`fixedReleaseFee = transfer.fee`），买家只能谈工资。2026-11-01 的裁决改成与普通转会同一口径：**有过户前合同就按它的 ±10/±50% 定，没有就自由定**。

代码改完后，在途的三单仍带着旧的「RC = 成交价 + 预期工资」开会，前端会直接进工资谈判。这次数据修复把它们的 `expected_wage` 清空，让它们回到「第一步 · 定违约金」，由买家自己定。

## 2026-11-01 生产实测

| transfer | 球员 | 卖方 | 买方 | 成交价 = 旧 RC | 旧 expected_wage |
| --- | --- | --- | --- | --- | --- |
| 139 | A. Bastoni (43) | 自由身 | 慕尼黑1860 (33) | 28 | 4.66 |
| 140 | C. Pulisic (69) | AC米兰(CPU) | 里昂 (66) | 15 | 2.73 |
| 141 | T. Reijnders (78) | AC米兰(CPU) | 曼联 (11) | 10 | 2.27 |

三单均 `transfers.status = 'signing'`、会话 `active`，且这三名球员在 `contracts` 里**没有任何行**（`active_contracts = 0`）⇒ 新口径下 `rcBounds = null`，可以自由定。

## 只清 `expected_wage`，为什么不清 `release_fee`

- `release_fee` 留着正好当第一步的预填值（买家看到 28 / 15 / 10，改不改自己决定）。
- 清成 NULL 反而有坑：`settleActiveSession` 的兜底是 `session.release_fee ?? TRAINEE_RELEASE_FEE`，关窗强制结算时会落成 5m。
- 前端第一步的判据是 `releaseFee === null || (type === 'forced_auction' && expectedWage === null)`，所以「RC 有值 + E 为空」就是「预填但没确认」。

## 怎么跑

```bash
# 1) 只读预检（本地 + 生产各一遍，确认 3 行、数字与上表一致）
npx wrangler d1 execute whl-club --local  --file scripts/prod-20261102-forced-rc-open/01-precheck.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261102-forced-rc-open/01-precheck.sql

# 2) 本地先写一遍，确认影响 3 行
npx wrangler d1 execute whl-club --local  --file scripts/prod-20261102-forced-rc-open/02-apply.sql
npx wrangler d1 execute whl-club --local  --file scripts/prod-20261102-forced-rc-open/03-verify.sql

# 3) 生产（写操作，需单独授权；上线回读通过后立刻跑）
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261102-forced-rc-open/02-apply.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261102-forced-rc-open/03-verify.sql
```

## 影响面

- 只改 `negotiation_sessions.expected_wage` 三列（3 行）。
- 不动 `transfers` / `players` / `contracts` / 账本 / 冻结；不产生任何资金流水。
- 副作用 = 三个买方（慕尼黑1860 / 里昂 / 曼联）回到签约谈判第一步，必须自己定 RC + 谈工资；**关窗前没定完就按 409 卡住，不能强制结算**（与普通转会一致）。

## 回滚

`02-apply.sql` 幂等（`expected_wage IS NOT NULL` 才动），回滚就是按原值写回：

```sql
UPDATE negotiation_sessions SET expected_wage = 4.66 WHERE transfer_id = 139 AND status = 'active';
UPDATE negotiation_sessions SET expected_wage = 2.73 WHERE transfer_id = 140 AND status = 'active';
UPDATE negotiation_sessions SET expected_wage = 2.27 WHERE transfer_id = 141 AND status = 'active';
```
