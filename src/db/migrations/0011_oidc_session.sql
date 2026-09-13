-- 统一认证迁移步骤②（auth 项目 PRD P0-5，club 试点）：OIDC 本地会话。
-- club_session cookie 只存随机 token，本表按 sha256(token) 建行；
-- 不存姓名/角色快照——用户信息仍每次现查 TOUR_DB，与共享 cookie 模式行为完全等价
-- （账号真源收口到 auth 库是迁移步骤③的事）。
CREATE TABLE oidc_session (
  token_hash TEXT PRIMARY KEY,
  sub TEXT NOT NULL,             -- auth 账号 id（过渡期即 tour user id）
  auth_sid TEXT NOT NULL,        -- auth 登录会话指纹（ID token 的 sid；back-channel 登出按此吊销）
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_oidc_session_sid ON oidc_session (auth_sid);
