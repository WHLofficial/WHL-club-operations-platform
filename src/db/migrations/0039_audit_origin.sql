-- 0039 · audit_log 增 origin（触发通道，v6.3.2）
-- 缘起：审计行只记 actor（谁做的），机器产生的行一律 actor=NULL，于是「定时 cron / 业务请求顺带
-- 的惰性结算 / 外部机器通道」三种来源塌成同一个 NULL，管理端只能显示成破折号；而另有一批路径
-- 用 0 当「系统」哨兵（result_confirm 自动确认、backchannel 登出），两个哨兵并存且本仓没有
-- users 表来定义 0 —— 谁也说不清 0 是什么。本列回答 actor 答不了的问题：这条是谁触发的。
-- 可空是刻意的：历史行（2026-09-26 之前）没有来源可考，NULL = 未知；不要为了「统一」回填假值。
-- 应用层契约见 src/lib/audit.ts：AuditEntry.origin 必填，取值 user / cron_tick / lazy_settle /
-- backchannel / machine。
ALTER TABLE audit_log ADD COLUMN origin TEXT;

-- 管理端「按通道筛 + 按 id 倒序」的复合索引（与 idx_audit_log_target 同层级）
CREATE INDEX idx_audit_log_origin ON audit_log (origin, id DESC);
