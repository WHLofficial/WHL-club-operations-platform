-- 1860 重开 Bastoni 合同谈判（transfer 139 / session 78）。
-- 目标：让慕尼黑1860 回到「签约谈判 · 第一步 定新违约金」，自己定违约金，再走工资谈判。
-- 不动钱、不动归属、不撤销交易；成交时由 applyContractTerms 覆写合同 545 的条款。
-- 前置：本文件只跑一次；跑前先跑 01-precheck.sql 核对形态，跑后跑 03-verify.sql 回读。

-- 1) 会话回到 active、回到第一步
--    清 E / settled_* 让前端 needsReleaseFee 判为「还没定违约金」；release_fee 28 留着当预填。
--    attempt_count 保持 1：新报价的 attempt_no 会是 2，不会和历史那行撞 (session_id, attempt_no)。
UPDATE negotiation_sessions
   SET status = 'active',
       expected_wage = NULL,
       settled_at = NULL,
       settled_wage = NULL,
       settle_source = NULL,
       expiry_anchor_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       reminded_at = ''
 WHERE id = 78 AND transfer_id = 139 AND status = 'settled';

-- 2) 允许条款再落一次：applyContractTerms 见到 terms_applied = 1 会直接返回 already
UPDATE transfers
   SET terms_applied = 0
 WHERE id = 139 AND status = 'completed' AND terms_applied = 1;

-- 3) 补一条真实口径的过户前快照（当时 Bastoni 是真自由身、没有现行合同）
--    ① rcBoundsFor 读到 contract = null ⇒ 自由定违约金（不补的话会拿冻结的 28 当基准，被卡在 14~42）
--    ② 这笔单以后也能走「撤销交易」（revertDeal 要求快照存在）
--    baseTicks = 1 与合同 545 的 service_ticks 一致；fee/tax 与原成交一致（28 / 14）。
UPDATE transfers
   SET pre_settle_snapshot = '{"contract":null,"player":{"club_id":null,"status":"listed"},"saleFromClubId":null,"baseTicks":1,"returnSnapshot":null,"fee":28,"tax":14}'
 WHERE id = 139 AND pre_settle_snapshot IS NULL;

-- 4) 合同行保持原样（release_fee 28 / wage 4）：不删不建，避免队伍出现「无合同」状态；
--    成约时 applyContractTerms 用会话谈定的条款整行覆写。
