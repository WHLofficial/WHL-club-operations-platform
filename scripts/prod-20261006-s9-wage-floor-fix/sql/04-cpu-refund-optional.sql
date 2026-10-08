-- 04 CPU 期工资冲正：241 巴塞罗那 −61.48 / 112172 RB莱比锡 −57.69（用户 2026-10-08 令「CPU财政回溯」）
-- 采用「直接改上次记录」的同款形状：amount → 0（保留行与 ref 供审计）、余额与后续 balance_after 还原、memo 记原因
-- 若用户改口径为「补一笔 manual_adjust 补偿分录」，则不要用本件，另出补偿分录件

-- club 241 巴塞罗那（CPU 期，S9 第 1 窗实扣 61.48）
-- ② 工资行冲正：amount → 0（保留行与 ref 供审计）、balance_after +61.48、memo 记原因
UPDATE ledger_entries
SET amount = 0,
    balance_after = ROUND(balance_after + 61.48, 2),
    memo = REPLACE(memo, ' 人现行合同）', ' 人现行合同；CPU 队不入账（用户令 2026-10-06），已冲正）')
WHERE club_id = 241 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -61.48 AND substr(memo, -7) = ' 人现行合同）';

-- ① 该队工资行之后的流水 balance_after 整体 +61.48（含接队后的奖金/接队资金等 5–10 行）
-- 守卫：工资行已在冲正态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after + 61.48, 2)
WHERE club_id = 241
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 241 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 241 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = 0 AND instr(x.memo, '已冲正') != 0)
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 241 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 241 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 241 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 241 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 241 巴塞罗那：② 之后余额比最新流水多 61.48——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 241 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 241
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 241 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 241 ORDER BY e.id DESC LIMIT 1), 2);

-- club 112172 RB莱比锡（CPU 期，S9 第 1 窗实扣 57.69）
-- ② 工资行冲正：amount → 0（保留行与 ref 供审计）、balance_after +57.69、memo 记原因
UPDATE ledger_entries
SET amount = 0,
    balance_after = ROUND(balance_after + 57.69, 2),
    memo = REPLACE(memo, ' 人现行合同）', ' 人现行合同；CPU 队不入账（用户令 2026-10-06），已冲正）')
WHERE club_id = 112172 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -57.69 AND substr(memo, -7) = ' 人现行合同）';

-- ① 该队工资行之后的流水 balance_after 整体 +57.69（含接队后的奖金/接队资金等 5–10 行）
-- 守卫：工资行已在冲正态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after + 57.69, 2)
WHERE club_id = 112172
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 112172 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 112172 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = 0 AND instr(x.memo, '已冲正') != 0)
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 112172 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 112172 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 112172 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 112172 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 112172 RB莱比锡：② 之后余额比最新流水多 57.69——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 112172 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 112172
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 112172 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 112172 ORDER BY e.id DESC LIMIT 1), 2);
