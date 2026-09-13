-- 统一认证步骤③收口（auth 项目 P0-10，TECH_DESIGN §6.3）：绑定人姓名随绑定落库——
-- 管理端绑定列表不再现查 TOUR_DB user 表（账号真源已收口 auth 库，收口后新账号在赛事库
-- 无行）。旧行 user_name 为空，读取时回退赛事库 user 表一次性兜底，随重新绑定自然补全。
ALTER TABLE club_bindings ADD COLUMN user_name TEXT;
