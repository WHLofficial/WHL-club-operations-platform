-- 统一认证步骤③收口（auth 项目 P0-10，TECH_DESIGN §6.3）：本地会话存 userinfo 下发的
-- claims（姓名/锁定/待改密/角色/权限），会话解析不再查 TOUR_DB user 表——账号真源已在
-- auth 库，收口后新账号在赛事库无行。判定走权限点（§6.3），role 仅为页面展示投影。
-- 旧会话行 claims 为 NULL → 视为未登录，重新走一次 OIDC 登录即恢复。
ALTER TABLE oidc_session ADD COLUMN claims TEXT;
