# 2026-11-01 · 成交挂单收口（v6.66.0 一次性修复）

## 为什么

挂牌截止把挂单从 `bidding` 写成 `pending_review`（`src/worker/market-settle.ts:75`，同批建 `transfers(pending_review)` + 审核任务），这是设计意图。问题在成功路径没有收口：审核通过只推进 `transfers`，`completeTransfer`（`src/worker/transfers.ts:181`）全文不碰 `listings`，只有失败路径（`transfer` 审核驳回 `:951`、谈判作废 `negotiations.ts:812`）写 `delisted`。

后果不是显示问题：`src/worker/bypass.ts` 的 `findInFlight()` 把 `pending_review` 当「球员还在市场流程里」，续约 / 解约 / 海捞 / 上调全部 400；挂牌查重与唯一索引 `idx_listings_active_player` 同样拦。

## 2026-11-01 生产实测

- `pending_review` 共 **20** 条：联单 `completed` **14** 条、`signing` 6 条、`rejected` 0 条。
- 修的是那 14 条（球员已过户、钱已划转）。
- 6 条 `signing` 已按新路径（v6.66.0 起成交即收口）自行收口，不手工改。

## 怎么跑

```bash
# 1) 只读预检
npx wrangler d1 execute whl-club --local  --file scripts/prod-20261101-listing-closeout/01-precheck.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261101-listing-closeout/01-precheck.sql

# 2) 本地先写一遍，确认识别到预期的 14 行
npx wrangler d1 execute whl-club --local  --file scripts/prod-20261101-listing-closeout/02-apply.sql
npx wrangler d1 execute whl-club --local  --file scripts/prod-20261101-listing-closeout/03-verify.sql

# 3) 生产（写操作，需单独授权）
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261101-listing-closeout/02-apply.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261101-listing-closeout/03-verify.sql
```

## 影响面

- 只改 `listings.status` / `listings.deadline_note` 两列。
- 不动 `transfers` / `players` / `contracts` / 账本 / 冻结。
- 副作用 = 这 14 名球员立刻恢复续约、解约、再挂牌、被激活的资格（这正是修复的目的）。

## 回滚

`01-precheck.sql` 的输出就是待改 id 清单，回滚按 id 逐条还原：

```sql
UPDATE listings SET status = 'pending_review', deadline_note = NULL
 WHERE id IN (/* 预检输出的 listing_id */)
   AND status = 'delisted'
   AND deadline_note = '已成交（历史收口 2026-11-01）';
```

回滚只影响「能不能对这 14 人做操作」，不会造成资金或归属错账。

## 不做什么

- 不改那 6 条 `signing`（它们的球员还没过户）。
- 不动 `orphan_no_transfer` 计数：预检若出现非 0，说明有挂单没有联单，停下单独查，不并入本次修复。
