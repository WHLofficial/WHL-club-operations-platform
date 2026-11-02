# 让慕尼黑1860 重开 Bastoni 的合同谈判（transfer 139 / session 78）

**日期**：2026-11-02（生产 v6.67.0，Version `03aa9167`）
**执行状态**：**未执行**——脚本已就位，写库需要 owner 明确下令。
**一句话**：把 session 78 从 `settled` 拉回 `active`、清掉预期的工资与结算痕迹、允许条款重落一次，并补一条真实口径的过户前快照。**不动钱、不动球员归属、不撤销交易。**

## 为什么

v6.67.0 之前，强制拍卖的违约金在成交时就被定死成成交价（`fixedReleaseFee = fee`），买家只能谈工资。Bastoni（player 43）这笔 28m 的单在 2026-11-01T14:22:06Z 按旧口径走完签约谈判：违约金 28m、工资 4m。

v6.67.0 起强制拍卖一律放开违约金，买家在签约谈判里自己定。owner 要求让这笔单也回到「自己定违约金」的流程（m01207 / m01250：「我只想让1860重新谈合同」）。

## 生产实测（2026-11-02T08:1xZ）

| 项 | 值 |
| --- | --- |
| session | id 78，`status='settled'`，`release_fee=28`，`expected_wage=4.66`，`settled_wage=4`，`attempt_count=1`，`settled_at=2026-11-01T14:22:06.927Z` |
| transfer | id 139，`type='forced_auction'`，`status='completed'`，`fee=28`，`terms_applied=1`，`pre_settle_snapshot` 为 **NULL** |
| 合同 | id 545，player 43，club 33，`release_fee=28`，`wage=4`，`service_ticks=1`，`protection_ticks=4`，`signed_at=2026-11-01T23:59:42.436Z` |
| 球员 | player 43 `A. Bastoni`，`club_id=33`（慕尼黑1860） |
| 账 | 仅 1 行：club 33 `transfer_in` −28（自由身卖方，无卖方入账，28m 已销毁） |
| 窗口 | `season_windows` id 2 / season 9 / window_seq 2 `status='open'` |

## 为什么不是「撤销交易」

`src/worker/deal-revert.ts` 的 `revertDeal` 是**整单回滚**：退买方 28m、球员回自由身、合同删除。owner 只要重谈合同，不要撤销归属和流水。而且这条单的 `pre_settle_snapshot` 是 NULL（0088 在 14:50Z 才 apply，这单 14:22Z 就成交了），`revertDeal` 会直接 409「没有过户前快照，无法撤销」。

## 怎么跑（需 owner 授权）

```bash
# 0) 只读核对形态
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261102-bastoni-reopen/01-precheck.sql

# 1) 写库（三条 UPDATE，见 02-apply.sql）
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261102-bastoni-reopen/02-apply.sql

# 2) 回读
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261102-bastoni-reopen/03-verify.sql
```

跑完之后，1860 的主教练在「转会 → 我的转会台（`/market/desk`）」就能看到 Bastoni 的会话回到「第一步 · 定违约金」，输入框预填 28、提示可自由定（`rcBounds` 为 null）。

## 影响面

- 只有 session 78 / transfer 139 / 该快照字段被改动；合同、球员、账本、其它会话都不动。
- 重开后如果在窗口关闭前一直没定违约金：静默引擎 72h 后按「预填 28 当违约金 + 该 RC 的预期工资」收口（`settleAtBaseTerms` 的 v6.67.0 分支），结果与现在的 28m 合同同量级，不会签出工资 0。
- 重开后如果 1860 定了新违约金：成约时 `applyContractTerms` 覆写合同 545 的 `release_fee / wage / service_ticks / protection_ticks / signed_*`，钱不再动（转会费已结）。

## 回滚

```sql
UPDATE negotiation_sessions
   SET status = 'settled', expected_wage = 4.66, settled_wage = 4,
       settled_at = '2026-11-01T14:22:06.927Z', settle_source = 'negotiation',
       expiry_anchor_at = '2026-11-01T13:30:14.886Z', reminded_at = ''
 WHERE id = 78;

UPDATE transfers SET terms_applied = 1, pre_settle_snapshot = NULL WHERE id = 139;
```

注意：回滚不会删除 1860 已经提交的 `negotiation_attempts` 行；如果已经成约（合同被覆写），回滚会话状态也没有意义——那时应当按新合同为准。
