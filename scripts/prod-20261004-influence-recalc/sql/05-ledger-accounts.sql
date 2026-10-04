-- 05 ledger_accounts：账户余额对齐链末值（updated_at 不动）
-- 由 scripts/prod-20261004-influence-recalc/recalc.mjs plan 生成（2026-10-04T06:41:11.515Z）
-- 口径真源：src/worker/home.ts（v6.28.0）；重演随机项取区间中点、天气取库中已记录值
-- 本文件不自动执行：apply 默认只打印，需要显式 --yes

-- club 1：31.759999999999998 → 32.14
UPDATE ledger_accounts SET balance = 32.14 WHERE club_id = 1;
-- club 2：32.949999999999996 → 33.87
UPDATE ledger_accounts SET balance = 33.87 WHERE club_id = 2;
-- club 5：64.39000000000001 → 67.77000000000001
UPDATE ledger_accounts SET balance = 67.77000000000001 WHERE club_id = 5;
-- club 9：63.320000000000014 → 70
UPDATE ledger_accounts SET balance = 70 WHERE club_id = 9;
-- club 11：68.53 → 75.08
UPDATE ledger_accounts SET balance = 75.08 WHERE club_id = 11;
-- club 13：66.08 → 67.66000000000001
UPDATE ledger_accounts SET balance = 67.66000000000001 WHERE club_id = 13;
-- club 14：52.13 → 53.14000000000001
UPDATE ledger_accounts SET balance = 53.14000000000001 WHERE club_id = 14;
-- club 21：32.93 → 34.25
UPDATE ledger_accounts SET balance = 34.25 WHERE club_id = 21;
-- club 33：79.99000000000001 → 82.82000000000002
UPDATE ledger_accounts SET balance = 82.82000000000002 WHERE club_id = 33;
-- club 45：63.39 → 66.25
UPDATE ledger_accounts SET balance = 66.25 WHERE club_id = 45;
-- club 66：71.92 → 74.68
UPDATE ledger_accounts SET balance = 74.68 WHERE club_id = 66;
-- club 73：71.48 → 75.50999999999999
UPDATE ledger_accounts SET balance = 75.50999999999999 WHERE club_id = 73;
-- club 243：62.64999999999999 → 63.61
UPDATE ledger_accounts SET balance = 63.61 WHERE club_id = 243;
-- club 280：39.76 → 40.29
UPDATE ledger_accounts SET balance = 40.29 WHERE club_id = 280;
-- club 449：56.82 → 58.510000000000005
UPDATE ledger_accounts SET balance = 58.510000000000005 WHERE club_id = 449;
-- club 110374：61.059999999999995 → 64.58
UPDATE ledger_accounts SET balance = 64.58 WHERE club_id = 110374;
