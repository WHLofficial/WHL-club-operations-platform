-- 生产批 prod-20261013-t0-economy-patch · 01 前置只读体检（不写任何一行）
-- 目标库：whl-club（生产，--remote）。执行通道：npx wrangler d1 execute whl-club --remote --file=<本文件>

-- 1) config 表现状（写前基线；确认 loyalty_tiers / wage_floor_gap / stadium_max_open_tier 三键均未落库）
SELECT key, value, updated_at FROM config ORDER BY key;

-- 2) 首次忠诚扣款尚未发生（S9 中期窗未关 ⇒ 应为 0 行；若 >0 行说明方向修正或排程已过时点，须停下重评估）
SELECT COUNT(*) AS loyalty_entries FROM ledger_entries WHERE kind = 'loyalty';

-- 3) 窗口状态（S9 只应有 W1 已关；中期窗未开 ⇒ 本批落在首次扣款之前）
SELECT id, season, window_seq, status, is_temporary, opened_at, closed_at FROM season_windows ORDER BY id;

-- 4) 球场档位与容量基线（键 ③ 放开 2 档的影响面：tier=1 且容量 <45000 的队将被解锁）
SELECT s.club_id, c.name, s.capacity, s.tier FROM stadiums s JOIN clubs c ON c.id = s.club_id
 WHERE c.is_cpu = 0 ORDER BY s.tier DESC, s.capacity DESC;

-- 5) 工资流水基线（供批 B 退回件比对：3 队应仍为按下限扣的 −53 / −43 / −53）
SELECT id, club_id, amount, memo FROM ledger_entries WHERE kind = 'wage' AND ref_type = 'window' AND ref_id = 901 ORDER BY club_id;

-- 6) 最近 config_set 审计（确认无并发写入者）
SELECT id, actor, action, origin, before, after, at FROM audit_log WHERE action = 'config_set' ORDER BY id DESC LIMIT 5;
