-- 0002 · 俱乐部绑定认证码（TECH_DESIGN §3.2，与比赛系统 auth_code 同构）
-- 明码只在生成响应里出现一次，库存 sha256；一次有效、可设过期。
CREATE TABLE club_bind_code (
  id INTEGER PRIMARY KEY,
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT,
  used_by INTEGER,               -- 烧码后记绑定人（user.id）
  used_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_club_bind_code_hash ON club_bind_code(code_hash);
CREATE INDEX idx_club_bind_code_club ON club_bind_code(club_id, id DESC);
