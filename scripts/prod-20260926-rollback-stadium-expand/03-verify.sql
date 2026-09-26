-- 执行后复查（只读，单行多标量）。本文件由 --file 通道执行，见 README。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/03-verify.sql
--
-- 断言（前 7 列与订正结果一一对应，最后 3 列是恒等式/信息位）：
--   cap_33      = 12000          球场改回扩建前
--   credit_33   = 0.0            建设券返还清掉
--   bal_33      = 56.51          club 33 加回 0.50（56.01 → 56.51）
--   ma33        = 1              补偿流水存在且只有一条
--   expand33    = 1              原流水 id=141 保留（只增账本，不删历史）
--   newest33    = manual_adjust  club 33 最新一笔就是该补偿流水
--   conserve    = 0              守恒：Σ(balance) == Σ(amount)，无凭空余额
--   entries/prize/revenue        信息位：随比赛确认持续增长，**不作断言**
--
-- 注：entries 每次跑都会变（cron 逐场写 prize/revenue），所以不要把绝对笔数当验收条件；
--     守恒位 conserve=0 才是与增长无关的硬断言。

SELECT
  (SELECT capacity     FROM stadiums        WHERE club_id = 33)                                   AS cap_33,
  (SELECT build_credit FROM stadiums        WHERE club_id = 33)                                   AS credit_33,
  (SELECT balance      FROM ledger_accounts WHERE club_id = 33)                                   AS bal_33,
  (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 33 AND kind = 'manual_adjust' AND ref_type = 'stadium' AND ref_id = 33) AS ma33,
  (SELECT COUNT(*) FROM ledger_entries WHERE club_id = 33 AND kind = 'stadium_expand')            AS expand33,
  (SELECT kind FROM ledger_entries WHERE club_id = 33 ORDER BY id DESC LIMIT 1)                   AS newest33,
  (SELECT ROUND((SELECT SUM(balance) FROM ledger_accounts) - (SELECT SUM(amount) FROM ledger_entries), 2)) AS conserve,
  (SELECT COUNT(*) FROM ledger_entries)                                                           AS entries,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'prize')                                      AS prize,
  (SELECT COUNT(*) FROM ledger_entries WHERE kind = 'revenue')                                    AS revenue;
