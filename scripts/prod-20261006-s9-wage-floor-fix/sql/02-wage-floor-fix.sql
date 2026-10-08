-- 02 工资触底订正：S9 第 1 窗（ref_id = 901）三队工资行改成级别下限额度
-- 订单：顶级 5 切尔西 49.23 → 53（+3.77）/ 449 皇家贝蒂斯 33.37 → 53（+19.63）/ 次级 280 奥林匹亚科斯 37.62 → 43（+5.38）
-- 合计再扣 28.78 m；每队三条语句（工资行触底 → 顺移后续流水 → 账户对账），顺序不得调换

-- club 5 切尔西（顶级，帽 68、下限 53、S9 第 1 窗实扣 49.23）
-- ② 工资行触底：amount → -53、balance_after −3.77、memo 补下限尾注（与 worker floorNote 逐字一致）
UPDATE ledger_entries
SET amount = -53,
    balance_after = ROUND(balance_after - 3.77, 2),
    memo = REPLACE(memo, ' 人现行合同）', ' 人现行合同；未达顶级下限 53 m，按下限扣）')
WHERE club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -49.23 AND substr(memo, -7) = ' 人现行合同）';

-- ① 该队工资行之后的流水 balance_after 整体 −3.77（只动 balance_after，不动金额）
-- 守卫：工资行已在触底态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after - 3.77, 2)
WHERE club_id = 5
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 5 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 5 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = -53 AND instr(x.memo, '，按下限扣）') != 0)
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 5 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 5 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 5 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 5 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 5 切尔西：② 之后余额比最新流水少 3.77——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 5
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1), 2);

-- club 280 奥林匹亚科斯（次级，帽 58、下限 43、S9 第 1 窗实扣 37.62）
-- ② 工资行触底：amount → -43、balance_after −5.38、memo 补下限尾注（与 worker floorNote 逐字一致）
UPDATE ledger_entries
SET amount = -43,
    balance_after = ROUND(balance_after - 5.38, 2),
    memo = REPLACE(memo, ' 人现行合同）', ' 人现行合同；未达次级下限 43 m，按下限扣）')
WHERE club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -37.62 AND substr(memo, -7) = ' 人现行合同）';

-- ① 该队工资行之后的流水 balance_after 整体 −5.38（只动 balance_after，不动金额）
-- 守卫：工资行已在触底态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after - 5.38, 2)
WHERE club_id = 280
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 280 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 280 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = -43 AND instr(x.memo, '，按下限扣）') != 0)
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 280 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 280 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 280 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 280 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 280 奥林匹亚科斯：② 之后余额比最新流水少 5.38——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 280
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1), 2);

-- club 449 皇家贝蒂斯（顶级，帽 68、下限 53、S9 第 1 窗实扣 33.37）
-- ② 工资行触底：amount → -53、balance_after −19.63、memo 补下限尾注（与 worker floorNote 逐字一致）
UPDATE ledger_entries
SET amount = -53,
    balance_after = ROUND(balance_after - 19.63, 2),
    memo = REPLACE(memo, ' 人现行合同）', ' 人现行合同；未达顶级下限 53 m，按下限扣）')
WHERE club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -33.37 AND substr(memo, -7) = ' 人现行合同）';

-- ① 该队工资行之后的流水 balance_after 整体 −19.63（只动 balance_after，不动金额）
-- 守卫：工资行已在触底态 且 下一条本队流水与工资行不相接（顺移一旦发生 → 相接 ⇒ 重放空跑）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after - 19.63, 2)
WHERE club_id = 449
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 449 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 449 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = -53 AND instr(x.memo, '，按下限扣）') != 0)
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 449 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 449 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 449 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 449 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 449 皇家贝蒂斯：② 之后余额比最新流水少 19.63——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 449
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1), 2);
