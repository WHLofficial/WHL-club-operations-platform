-- 正向订正：撤销 2026-11-02 皇马（club 243）的两笔球场支出。
--
-- 执行：npx wrangler d1 execute whl-club --remote --file=scripts/prod-20261102-rollback-stadium-243/02-rollback.sql
--
-- 口径：**补偿分录，保留原流水**。ledger_entries / voucher_entries 都是只增账本，
-- 删 702/703/83/84/85 会打断 balance_after 链；原行不动，补反向流水（同
-- scripts/prod-20260926-rollback-stadium-expand 的口径）。
--
-- 顺序与守卫（每句都带幂等闸，整批重跑 changes 全为 0）：
--   ① 球场回到扩建前：capacity 20000→12000、tier 1→0
--   ② 现金 +8.00（原流水 702，扩建）      余额 11.78→19.78
--   ③ 现金 +1.80（原流水 703，升级）      余额 19.78→21.58
--   ④ 券 +1.20：退回升级时抵扣的 1.20（原券流水 84）   0.45→1.65
--   ⑤ 券 −1.20：收回扩建返还的 1.20（原券流水 83）     1.65→0.45
--   ⑥ 券 −0.45：收回升级返还的 0.45（原券流水 85）     0.45→0
--   ⑦ 审计一条：stadium_rollback
--
-- 远端 `--file` 走 D1 import 通道（wrangler 4.131），不依赖批内 changes()：
-- 每步用「前一步的余额/券余额 + 前一步流水已存在」串成链，只在前一步确实
-- 落地时才执行；任一步缺失，后续整条链空转，由 03-verify 报警。
-- ②–⑦ 都要求球场已回到 12000/tier 0，保证「球场没改成功就一分钱不动」。
--
-- 不动：match_attendance / naming_contracts / club_facilities / cache:epoch:public
--   ——两笔之后 0 场主场、0 条新账本流水、设施全 0、无冠名合同；capacity/tier
--   不在任何 cachedJson 公开端点（先例 README 已逐项核对）。

-- ① 球场改回扩建前。期望 changes = 1。
UPDATE stadiums
   SET capacity   = 12000,
       tier       = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND capacity = 20000
   AND tier = 1;

-- ② 现金加回 8.00（扩建）。余额闸：11.78（回滚前）→ 落账后 19.78。
UPDATE ledger_accounts
   SET balance    = balance + 8.00,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND ROUND(balance, 2) = 11.78
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND EXISTS (SELECT 1 FROM ledger_entries
                WHERE id = 702 AND club_id = 243 AND kind = 'stadium_expand'
                  AND amount = -8.00 AND ref_type = 'stadium' AND ref_id = 243)
   AND NOT EXISTS (SELECT 1 FROM ledger_entries
                    WHERE club_id = 243 AND kind = 'manual_adjust'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '回滚 2026-11-02 球场扩建%');

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243,
       'manual_adjust',
       8.00,
       (SELECT balance FROM ledger_accounts WHERE club_id = 243),
       'stadium',
       243,
       '回滚 2026-11-02 球场扩建（原流水 id=702，-8.00M；capacity 20000→12000）',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries
                    WHERE club_id = 243 AND kind = 'manual_adjust'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '回滚 2026-11-02 球场扩建%')
   AND ROUND((SELECT balance FROM ledger_accounts WHERE club_id = 243), 2) = 19.78;

-- ③ 现金加回 1.80（升级）。余额闸：19.78 → 21.58；且要求 ② 的流水已在。
UPDATE ledger_accounts
   SET balance    = balance + 1.80,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND ROUND(balance, 2) = 19.78
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND EXISTS (SELECT 1 FROM ledger_entries
                WHERE club_id = 243 AND kind = 'manual_adjust'
                  AND ref_type = 'stadium' AND ref_id = 243
                  AND memo LIKE '回滚 2026-11-02 球场扩建%')
   AND EXISTS (SELECT 1 FROM ledger_entries
                WHERE id = 703 AND club_id = 243 AND kind = 'stadium_upgrade'
                  AND amount = -1.80 AND ref_type = 'stadium' AND ref_id = 243)
   AND NOT EXISTS (SELECT 1 FROM ledger_entries
                    WHERE club_id = 243 AND kind = 'manual_adjust'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '回滚 2026-11-02 球场升级%');

INSERT INTO ledger_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243,
       'manual_adjust',
       1.80,
       (SELECT balance FROM ledger_accounts WHERE club_id = 243),
       'stadium',
       243,
       '回滚 2026-11-02 球场升级（原流水 id=703，-1.80M；tier 1→0、消费券 0.45→0）',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM ledger_entries
                    WHERE club_id = 243 AND kind = 'manual_adjust'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '回滚 2026-11-02 球场升级%')
   AND ROUND((SELECT balance FROM ledger_accounts WHERE club_id = 243), 2) = 21.58;

-- ④ 退回升级时抵扣的 1.20（原券流水 84）。券闸：0.45 → 1.65。
UPDATE ledger_accounts
   SET vouchers   = ROUND(vouchers + 1.20, 2),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND ROUND(vouchers, 2) = 0.45
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND EXISTS (SELECT 1 FROM voucher_entries
                WHERE id = 84 AND club_id = 243 AND kind = 'build_use'
                  AND amount = -1.20 AND ref_type = 'stadium' AND ref_id = 243)
   AND NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND kind = 'build_refund'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '撤销球场升级抵扣%');

INSERT INTO voucher_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243,
       'build_refund',
       1.20,
       (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243),
       'stadium',
       243,
       '撤销球场升级抵扣，退回 1.20M（原券流水 id=84）',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND kind = 'build_refund'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '撤销球场升级抵扣%')
   AND ROUND((SELECT vouchers FROM ledger_accounts WHERE club_id = 243), 2) = 1.65;

-- ⑤ 收回扩建返还的 1.20（原券流水 83）。券闸：1.65 → 0.45；且要求 ④ 的流水已在。
UPDATE ledger_accounts
   SET vouchers   = ROUND(vouchers - 1.20, 2),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND ROUND(vouchers, 2) = 1.65
   AND ROUND(vouchers, 2) >= 1.20
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND EXISTS (SELECT 1 FROM voucher_entries
                WHERE club_id = 243 AND kind = 'build_refund'
                  AND ref_type = 'stadium' AND ref_id = 243
                  AND memo LIKE '撤销球场升级抵扣%')
   AND EXISTS (SELECT 1 FROM voucher_entries
                WHERE id = 83 AND club_id = 243 AND kind = 'build_refund'
                  AND amount = 1.20 AND ref_type = 'stadium' AND ref_id = 243)
   AND NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND kind = 'build_use'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '撤销球场扩建返还%');

INSERT INTO voucher_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243,
       'build_use',
       -1.20,
       (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243),
       'stadium',
       243,
       '撤销球场扩建返还，收回 1.20M（原券流水 id=83）',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND kind = 'build_use'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '撤销球场扩建返还%')
   AND ROUND((SELECT vouchers FROM ledger_accounts WHERE club_id = 243), 2) = 0.45;

-- ⑥ 收回升级返还的 0.45（原券流水 85）。券闸：0.45 → 0；且要求 ⑤ 的流水已在。
UPDATE ledger_accounts
   SET vouchers   = ROUND(vouchers - 0.45, 2),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE club_id = 243
   AND ROUND(vouchers, 2) = 0.45
   AND ROUND(vouchers, 2) >= 0.45
   AND EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND EXISTS (SELECT 1 FROM voucher_entries
                WHERE club_id = 243 AND kind = 'build_use'
                  AND ref_type = 'stadium' AND ref_id = 243
                  AND memo LIKE '撤销球场扩建返还%')
   AND EXISTS (SELECT 1 FROM voucher_entries
                WHERE id = 85 AND club_id = 243 AND kind = 'build_refund'
                  AND amount = 0.45 AND ref_type = 'stadium' AND ref_id = 243)
   AND NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND kind = 'build_use'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '撤销球场升级返还%');

INSERT INTO voucher_entries (club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at)
SELECT 243,
       'build_use',
       -0.45,
       (SELECT ROUND(vouchers, 2) FROM ledger_accounts WHERE club_id = 243),
       'stadium',
       243,
       '撤销球场升级返还，收回 0.45M（原券流水 id=85）',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM voucher_entries
                    WHERE club_id = 243 AND kind = 'build_use'
                      AND ref_type = 'stadium' AND ref_id = 243
                      AND memo LIKE '撤销球场升级返还%')
   AND ROUND((SELECT vouchers FROM ledger_accounts WHERE club_id = 243), 2) = 0;

-- ⑦ 审计一条（actor NULL：生产脚本无站内账号；origin=user 表示 owner 指令触发）。
INSERT INTO audit_log (actor, action, target_type, target_id, origin, before, after, at)
SELECT NULL,
       'stadium_rollback',
       'stadium',
       243,
       'user',
       '{"capacity":20000,"tier":1,"vouchers":0.45,"ledgerIds":[702,703],"voucherIds":[83,84,85]}',
       '{"capacity":12000,"tier":0,"vouchers":0,"cashRefund":9.8,"voucherNet":-0.45,"reason":"owner 2026-11-02 指令回滚球场扩建与升级"}',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE EXISTS (SELECT 1 FROM stadiums WHERE club_id = 243 AND capacity = 12000 AND tier = 0)
   AND EXISTS (SELECT 1 FROM ledger_entries
                WHERE club_id = 243 AND kind = 'manual_adjust'
                  AND ref_type = 'stadium' AND ref_id = 243
                  AND memo LIKE '回滚 2026-11-02 球场扩建%')
   AND EXISTS (SELECT 1 FROM ledger_entries
                WHERE club_id = 243 AND kind = 'manual_adjust'
                  AND ref_type = 'stadium' AND ref_id = 243
                  AND memo LIKE '回滚 2026-11-02 球场升级%')
   AND ROUND((SELECT balance FROM ledger_accounts WHERE club_id = 243), 2) = 21.58
   AND ROUND((SELECT vouchers FROM ledger_accounts WHERE club_id = 243), 2) = 0
   AND NOT EXISTS (SELECT 1 FROM audit_log
                    WHERE action = 'stadium_rollback' AND target_type = 'stadium' AND target_id = 243);
