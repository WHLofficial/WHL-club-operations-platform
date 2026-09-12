-- 增量 4（§6.7）：谈判会话结算快照——settle 与过户分两个 batch，崩溃后按这两列自愈重放。
-- settle_source 枚举：negotiation（报价成约）/ forced（3 轮强约）/ direct（直败结算）/
-- trainee（直签训练营合同，需求方裁决：所有谈判均可直签训练营，不占 4.3.4(3) 每窗 2 名下放名额）。
ALTER TABLE negotiation_sessions ADD COLUMN settled_wage REAL;
ALTER TABLE negotiation_sessions ADD COLUMN settle_source TEXT;
