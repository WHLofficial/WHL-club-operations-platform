-- 增量 6：成长结算首版（TECH_DESIGN §10.2）。levels_applied = 已消费的升级次数，
-- 待办数 = floor(growth_xp / xp_per_level) − levels_applied（结算生成、教练选方案时逐次消费）。
ALTER TABLE players ADD COLUMN levels_applied INTEGER NOT NULL DEFAULT 0;
