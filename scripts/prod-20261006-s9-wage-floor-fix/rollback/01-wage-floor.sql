-- 01 回滚工资触底订正：把 S9 第 1 窗三队工资行还原成原扣款额（逐条带守卫 ⇒ 重放 changes = 0）
-- 顺序：② 工资行还原 → ① 后续流水 balance_after 还原 → ③ 账户对账
-- ② 的守卫是 NEW 态标记（amount = 触底值 且 memo 含下限尾注），跑完翻回 OLD 态
-- ① 的守卫 = OLD 态 且 下一条本队流水与工资行不相接 ⇒ 只在「② 已还原、下游仍被顺移」时执行

-- club 5 切尔西：还原 -53 → -49.23（后续流水 balance_after +3.77）
-- ②' 工资行还原：amount → -49.23、balance_after +3.77、memo 去掉下限尾注
UPDATE ledger_entries
SET amount = -49.23,
    balance_after = ROUND(balance_after + 3.77, 2),
    memo = REPLACE(memo, '；未达顶级下限 53 m，按下限扣）', '）')
WHERE club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -53 AND instr(memo, '，按下限扣）') != 0;

-- ①' 该队工资行之后的流水 balance_after 整体 +3.77（把 ① 的顺移加回）
-- 守卫：工资行已还原成原值 且 下一条本队流水与工资行不相接（= ②' 已跑而 ①' 未跑的中途态）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after + 3.77, 2)
WHERE club_id = 5
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 5 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 5 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = -49.23 AND substr(x.memo, -7) = ' 人现行合同）')
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 5 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 5 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 5 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 5 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 5 切尔西：② 之后余额比最新流水多 3.77——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 5
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1), 2);

-- club 280 奥林匹亚科斯：还原 -43 → -37.62（后续流水 balance_after +5.38）
-- ②' 工资行还原：amount → -37.62、balance_after +5.38、memo 去掉下限尾注
UPDATE ledger_entries
SET amount = -37.62,
    balance_after = ROUND(balance_after + 5.38, 2),
    memo = REPLACE(memo, '；未达次级下限 43 m，按下限扣）', '）')
WHERE club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -43 AND instr(memo, '，按下限扣）') != 0;

-- ①' 该队工资行之后的流水 balance_after 整体 +5.38（把 ① 的顺移加回）
-- 守卫：工资行已还原成原值 且 下一条本队流水与工资行不相接（= ②' 已跑而 ①' 未跑的中途态）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after + 5.38, 2)
WHERE club_id = 280
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 280 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 280 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = -37.62 AND substr(x.memo, -7) = ' 人现行合同）')
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 280 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 280 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 280 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 280 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 280 奥林匹亚科斯：② 之后余额比最新流水多 5.38——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 280
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1), 2);

-- club 449 皇家贝蒂斯：还原 -53 → -33.37（后续流水 balance_after +19.63）
-- ②' 工资行还原：amount → -33.37、balance_after +19.63、memo 去掉下限尾注
UPDATE ledger_entries
SET amount = -33.37,
    balance_after = ROUND(balance_after + 19.63, 2),
    memo = REPLACE(memo, '；未达顶级下限 53 m，按下限扣）', '）')
WHERE club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901
  AND ROUND(amount, 2) = -53 AND instr(memo, '，按下限扣）') != 0;

-- ①' 该队工资行之后的流水 balance_after 整体 +19.63（把 ① 的顺移加回）
-- 守卫：工资行已还原成原值 且 下一条本队流水与工资行不相接（= ②' 已跑而 ①' 未跑的中途态）
UPDATE ledger_entries
SET balance_after = ROUND(balance_after + 19.63, 2)
WHERE club_id = 449
  AND id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 449 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647
  AND EXISTS (SELECT 1 FROM ledger_entries x WHERE x.club_id = 449 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901 AND ROUND(x.amount, 2) = -33.37 AND substr(x.memo, -7) = ' 人现行合同）')
  AND NOT EXISTS (SELECT 1 FROM ledger_entries n WHERE n.club_id = 449 AND n.id = (SELECT MIN(m.id) FROM ledger_entries m WHERE m.club_id = 449 AND m.id BETWEEN (SELECT w.id + 1 FROM ledger_entries w WHERE w.club_id = 449 AND w.kind = 'wage' AND w.ref_type = 'window' AND w.ref_id = 901) AND 2147483647) AND ROUND(n.balance_after, 2) = ROUND((SELECT x.balance_after FROM ledger_entries x WHERE x.club_id = 449 AND x.kind = 'wage' AND x.ref_type = 'window' AND x.ref_id = 901) + n.amount, 2));

-- club 449 皇家贝蒂斯：② 之后余额比最新流水多 19.63——账户余额对齐到该队最新一条流水（守卫：不相等才写；预检 B 段已验不变式成立）
UPDATE ledger_accounts
SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1),
    updated_at = '2026-10-08T10:08:37.458Z'
WHERE club_id = 449
  AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
  AND ROUND(balance, 2) != ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1), 2);
