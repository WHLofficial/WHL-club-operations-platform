-- v1.3.0：俱乐部转会禁令（管理组冻结/解冻某俱乐部的转会权限，违规处罚用）
ALTER TABLE clubs ADD COLUMN transfer_banned INTEGER NOT NULL DEFAULT 0;
