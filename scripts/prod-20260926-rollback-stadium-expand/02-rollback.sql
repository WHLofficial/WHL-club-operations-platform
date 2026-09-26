-- 正向订正：撤销 2026-09-21 club 33（慕尼黑1860）的那笔球场扩建。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20260926-rollback-stadium-expand/02-rollback.sql
--   --file 通道下整批是一个事务（ROADMAP.md:217），三句要么全成要么全回滚。
--
-- 口径（用户 2026-09-26 裁决）：**补偿分录，保留原流水**。原 ledger_entries id=141 是只增
-- 账本的一环，删掉会打断 balance_after 链，因此不动它；改为在账面加回 0.50 并补一条
-- kind='manual_adjust' 的反向流水（前端「手动调整」标签已收录），memo 指回 id=141。
--
-- 顺序有依赖：② 必须早于 ③ —— 语句 ③ 的 balance_after 取的是加回后的余额。
--
-- 每句都带守卫，重跑 changes 全为 0：
--   ① 只命中「扩建后」这一状态（capacity 12500 且 build_credit 0.13）
--   ② 只命中存在的账户（club 33 必然存在）
--   ③ NOT EXISTS 防重复入账（同 club + kind + ref 只补一次）
--
-- 不改：match_attendance / revenue / naming_contracts / club_facilities / cache:epoch:public
--       ——理由见 README「不可逆影响面」与「为什么不 bump 缓存代际」。

-- ① 把球场改回扩建前（capacity 12000 / build_credit 0.00）。期望 changes = 1。
UPDATE stadiums
   SET capacity     = 12000,
       build_credit = 0.00,
       updated_at   = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 33
   AND capacity = 12500
   AND build_credit = 0.13;

-- ② 账面加回 0.50（按差额，绝不 SET 绝对值）。期望 changes = 1。
UPDATE ledger_accounts
   SET balance    = balance + 0.50,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 33;

-- ③ 补一条补偿流水，balance_after 取 ② 之后的最新余额。期望 changes = 1。
INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 33,
       'manual_adjust',
       0.50,
       (SELECT balance FROM ledger_accounts WHERE club_id = 33),
       'stadium',
       33,
       '回滚 2026-09-21 球场扩建（原流水 id=141，-0.50M；capacity 12500→12000、build_credit 0.13→0）',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (
         SELECT 1 FROM ledger_entries
          WHERE club_id = 33
            AND kind = 'manual_adjust'
            AND ref_type = 'stadium'
            AND ref_id = 33
       );
