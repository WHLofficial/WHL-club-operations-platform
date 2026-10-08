-- 02（可选件的回滚）CPU 队工资回冲还原：把两行退回 S9 第 1 窗实扣额
-- 只在执行过 sql/04-cpu-refund-optional.sql 之后才需要；逐条带守卫 ⇒ 重放 changes = 0

-- club 241 巴塞罗那(CPU)：还原 0 → -61.48（后续流水 balance_after −61.48）
-- ① 该队工资行之后的流水 balance_after 整体 −61.48
UPDATE ledger_entries
SET balance_after = ROUND(balance_after - 61.48, 2)
WHERE club_id = 241
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 241 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries n JOIN ledger_entries w2 ON w2.id + 1 = n.id WHERE n.club_id = 241 AND w2.club_id = 241 AND w2.kind = 'wage' AND w2.ref_type = 'window' AND w2.ref_id = 901 AND ROUND(n.balance_after, 2) = ROUND(w2.balance_after + n.amount, 2))
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 241 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = 0 AND instr(x.memo, '已冲正') != 0);

-- ② 工资行还原：amount → -61.48、balance_after −61.48、memo 去掉冲正说明
UPDATE ledger_entries
SET amount = -61.48,
    balance_after = ROUND(balance_after - 61.48, 2),
    memo = REPLACE(memo, '；CPU 队不入账（用户令 2026-10-06），已冲正）', '）')
WHERE club_id = 241 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = 0 AND instr(memo, '已冲正') != 0;

-- club 241 巴塞罗那(CPU)：② 之后余额比最新流水多 61.48——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 241 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T04:12:48.220Z'
WHERE club_id = 241
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 241 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 241 ORDER BY e.id DESC LIMIT 1), 2);

-- club 112172 RB莱比锡(CPU)：还原 0 → -57.69（后续流水 balance_after −57.69）
-- ① 该队工资行之后的流水 balance_after 整体 −57.69
UPDATE ledger_entries
SET balance_after = ROUND(balance_after - 57.69, 2)
WHERE club_id = 112172
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 112172 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries n JOIN ledger_entries w2 ON w2.id + 1 = n.id WHERE n.club_id = 112172 AND w2.club_id = 112172 AND w2.kind = 'wage' AND w2.ref_type = 'window' AND w2.ref_id = 901 AND ROUND(n.balance_after, 2) = ROUND(w2.balance_after + n.amount, 2))
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 112172 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = 0 AND instr(x.memo, '已冲正') != 0);

-- ② 工资行还原：amount → -57.69、balance_after −57.69、memo 去掉冲正说明
UPDATE ledger_entries
SET amount = -57.69,
    balance_after = ROUND(balance_after - 57.69, 2),
    memo = REPLACE(memo, '；CPU 队不入账（用户令 2026-10-06），已冲正）', '）')
WHERE club_id = 112172 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = 0 AND instr(memo, '已冲正') != 0;

-- club 112172 RB莱比锡(CPU)：② 之后余额比最新流水多 57.69——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 112172 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T04:12:48.220Z'
WHERE club_id = 112172
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 112172 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 112172 ORDER BY e.id DESC LIMIT 1), 2);
