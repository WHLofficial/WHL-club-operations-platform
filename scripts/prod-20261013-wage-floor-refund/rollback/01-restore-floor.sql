-- 生产批 prod-20261013-wage-floor-refund · 回滚件：恢复穷鬼线多扣（9 条语句）
-- 目标库：whl-club（生产，--remote）
-- 口径：用户令「直接把上次的扣款记录改改」⇒ 原地改回（amount / balance_after / memo），不新增补偿分录
--       （与 scripts/prod-20261013-t0-economy-patch/ 的 key ② 配合：取消穷鬼线 wage_floor_gap='0'）。
-- 依据：scratch/econ-refund.mjs（只读）→ scratch/econ-refund.out.txt；三队 wage 行 ref_type='window'、ref_id=901（S9 第 1 窗）
--   club 5    切尔西　　　　 顶级  31 人  Σ49.23  原扣 −53.00  ⇒ −49.23  退回 +3.77
--   club 280  奥林匹亚科斯　 次级  30 人  Σ37.62  原扣 −43.00  ⇒ −37.62  退回 +5.38
--   club 449  皇家贝蒂斯　　 顶级  25 人  Σ33.37  原扣 −53.00  ⇒ −33.37  退回 +19.63
-- 合计退回：+28.78 m（= 3 队 × 各自多扣额）
-- 语义：把三队 wage 行改回 −53.00 / −43.00 / −53.00（即「按下限扣」的原状）并顺移回退。
-- 幂等：与主件同形（守卫换成新金额 + 新 memo 尾注；②③ 均为相接/相等检测）⇒ 重放 changes 0。
-- 注意：本回滚只还原账本；若同时回滚了 config 键 ②（wage_floor_gap 删行），则下一次关窗批会重新按下限扣。

-- 回滚（club 449 皇家贝蒂斯）：−53.00 → −33.37，退回 19.63 m
UPDATE ledger_entries
   SET amount = -53.00,
       balance_after = ROUND(balance_after + -19.63, 2),
       memo = REPLACE(memo, '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣', '；未达顶级下限 53 m，按下限扣')
 WHERE club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -33.37
   AND instr(memo, '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣') > 0;

-- 顺移（club 449）：工资行之后的全部本队流水 balance_after -19.63
UPDATE ledger_entries
   SET balance_after = ROUND(balance_after + -19.63, 2)
 WHERE club_id = 449
   AND id > (SELECT w.id FROM ledger_entries w WHERE w.club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00)
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00)
   AND NOT EXISTS (
         SELECT 1 FROM ledger_entries n
          WHERE n.club_id = 449
            AND n.id = (SELECT MIN(m.id) FROM ledger_entries m
                         WHERE m.club_id = 449
                           AND m.id > (SELECT w2.id FROM ledger_entries w2 WHERE w2.club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00))
            AND ROUND(n.balance_after, 2) = ROUND((SELECT w3.balance_after FROM ledger_entries w3 WHERE w3.club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00) + n.amount, 2)
       );

-- 账户对齐（club 449）：balance := 本队最新 balance_after
UPDATE ledger_accounts
   SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 449
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.club_id = 449 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00)
   AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
   AND ROUND(balance, 2) <> ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 449 ORDER BY e.id DESC LIMIT 1), 2);

-- 回滚（club 280 奥林匹亚科斯）：−43.00 → −37.62，退回 5.38 m
UPDATE ledger_entries
   SET amount = -43.00,
       balance_after = ROUND(balance_after + -5.38, 2),
       memo = REPLACE(memo, '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣', '；未达次级下限 43 m，按下限扣')
 WHERE club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -37.62
   AND instr(memo, '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣') > 0;

-- 顺移（club 280）：工资行之后的全部本队流水 balance_after -5.38
UPDATE ledger_entries
   SET balance_after = ROUND(balance_after + -5.38, 2)
 WHERE club_id = 280
   AND id > (SELECT w.id FROM ledger_entries w WHERE w.club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -43.00)
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -43.00)
   AND NOT EXISTS (
         SELECT 1 FROM ledger_entries n
          WHERE n.club_id = 280
            AND n.id = (SELECT MIN(m.id) FROM ledger_entries m
                         WHERE m.club_id = 280
                           AND m.id > (SELECT w2.id FROM ledger_entries w2 WHERE w2.club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -43.00))
            AND ROUND(n.balance_after, 2) = ROUND((SELECT w3.balance_after FROM ledger_entries w3 WHERE w3.club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -43.00) + n.amount, 2)
       );

-- 账户对齐（club 280）：balance := 本队最新 balance_after
UPDATE ledger_accounts
   SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 280
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.club_id = 280 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -43.00)
   AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
   AND ROUND(balance, 2) <> ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 280 ORDER BY e.id DESC LIMIT 1), 2);

-- 回滚（club 5 切尔西）：−53.00 → −49.23，退回 3.77 m
UPDATE ledger_entries
   SET amount = -53.00,
       balance_after = ROUND(balance_after + -3.77, 2),
       memo = REPLACE(memo, '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣', '；未达顶级下限 53 m，按下限扣')
 WHERE club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -49.23
   AND instr(memo, '；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣') > 0;

-- 顺移（club 5）：工资行之后的全部本队流水 balance_after -3.77
UPDATE ledger_entries
   SET balance_after = ROUND(balance_after + -3.77, 2)
 WHERE club_id = 5
   AND id > (SELECT w.id FROM ledger_entries w WHERE w.club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00)
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00)
   AND NOT EXISTS (
         SELECT 1 FROM ledger_entries n
          WHERE n.club_id = 5
            AND n.id = (SELECT MIN(m.id) FROM ledger_entries m
                         WHERE m.club_id = 5
                           AND m.id > (SELECT w2.id FROM ledger_entries w2 WHERE w2.club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00))
            AND ROUND(n.balance_after, 2) = ROUND((SELECT w3.balance_after FROM ledger_entries w3 WHERE w3.club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00) + n.amount, 2)
       );

-- 账户对齐（club 5）：balance := 本队最新 balance_after
UPDATE ledger_accounts
   SET balance = (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 5
   AND EXISTS (SELECT 1 FROM ledger_entries w WHERE w.club_id = 5 AND kind = 'wage' AND ref_type = 'window' AND ref_id = 901 AND ROUND(amount, 2) = -53.00)
   AND (SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1) IS NOT NULL
   AND ROUND(balance, 2) <> ROUND((SELECT e.balance_after FROM ledger_entries e WHERE e.club_id = 5 ORDER BY e.id DESC LIMIT 1), 2);
