-- 生产批 prod-20261013-loyalty-tier-schedule · 01 前置只读体检（不写任何一行）
-- 目标库：whl-club（生产，--remote）

-- 1) config 表现状（写前基线；确认 loyalty_tiers 尚未落库）
SELECT key, value, updated_at FROM config ORDER BY key;

-- 2) 首次忠诚扣款尚未发生（S9 中期窗未关 ⇒ 应为 0 行）
SELECT COUNT(*) AS loyalty_entries FROM ledger_entries WHERE kind = 'loyalty';

-- 3) 窗口状态（S9 只应有一扇 W1 已关；中期窗未开 ⇒ 本批落在首次扣款之前）
SELECT id, season, window_seq, status, is_temporary, opened_at, closed_at FROM season_windows ORDER BY id;

-- 4) 最近 config_set 审计（确认无并发写入者）
SELECT id, actor, action, origin, before, after, at FROM audit_log WHERE action = 'config_set' ORDER BY id DESC LIMIT 5;
