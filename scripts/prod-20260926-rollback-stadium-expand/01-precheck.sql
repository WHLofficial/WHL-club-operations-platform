-- 只读预检：确认要回滚的那笔球场扩建，以及回滚会碰到的面。
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/01-precheck.sql
--
-- 期望值（2026-09-26 实测快照，见 README「预检快照」）：
--   ① ledger_entry_141 = club_id 33 / kind stadium_expand / amount -0.5 / balance_after 49.01
--      ref_type stadium / ref_id 33 / created_at 2026-09-21T07:38:46.192Z
--   ② stadiums_33      = capacity 12500 / tier 0 / build_credit 0.13 / fans 1800
--   ③ balance_33       = 56.01，ledger_total = 162 笔 / 16 户 / 合计 715.56
--   ④ windows_closed_after_expand = 0（唯一关过的窗在 2026-09-18T01:01，早于扩建
--      ⇒ 关窗批的 wage/luxury_tax/maintenance/naming 五类仍全为 0）
--   ⑤ club33_entries_after_expand = 1 —— 是 id=142 的自动奖金（prize 7.00 / match_away #15
--      / 2026-09-21T08:26:01.152Z），**不是**人工流水，也不与补偿分量冲突
--   ⑥ club33_home_after_expand = 0 且 club33_home_max = 10140 —— 扩建后 club 33 没踢过主场，
--      历史最大上座 10140 也从未触到 12500 的封顶 ⇒ 没有任何上座/收入被这次扩建影响
--
-- club 33 全部 4 笔流水（id=100 revenue / 123 prize / 141 stadium_expand / 142 prize）中
-- **没有 manual_adjust**，故 02 的补偿分录守卫不会撞车。本文件只报告，不做任何修改。

SELECT 'ledger_entry_141' AS probe,
       id, club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at
  FROM ledger_entries
 WHERE id = 141;

SELECT 'stadiums_33' AS probe,
       club_id, name, capacity, tier, shell_influence, bonus_points, fans, build_credit, updated_at

  FROM stadiums
 WHERE club_id = 33;

SELECT 'balance_33' AS probe,
       club_id, balance, updated_at
  FROM ledger_accounts
 WHERE club_id = 33;

SELECT 'ledger_total' AS probe,
       (SELECT COUNT(*)             FROM ledger_entries)  AS entries,
       (SELECT COUNT(*)             FROM ledger_accounts) AS accounts,
       (SELECT ROUND(SUM(balance),2) FROM ledger_accounts) AS sum_balances;

SELECT 'windows_closed_after_expand' AS probe,
       COUNT(*) AS n
  FROM season_windows
 WHERE closed_at > '2026-09-21T07:38:46.192Z';

SELECT 'club33_entries_after_expand' AS probe,
       COUNT(*) AS n, GROUP_CONCAT(DISTINCT kind) AS kinds
  FROM ledger_entries
 WHERE club_id = 33 AND created_at > '2026-09-21T07:38:46.192Z';

SELECT 'club33_home_after_expand' AS probe,
       COUNT(*) AS n,
       MAX(attendance) AS max_attendance,
       SUM(CASE WHEN attendance >= 12500 THEN 1 ELSE 0 END) AS capped_at_12500
  FROM match_attendance
 WHERE club_id = 33 AND created_at > '2026-09-21T07:38:46.192Z';
