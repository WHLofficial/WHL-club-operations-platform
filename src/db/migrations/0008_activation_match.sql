-- 0008 · 激活匹配窗（v0.6.0）：训练营激活沿用 activation_deadline（5 分钟首价窗），
-- 普通球员激活首价落定后进入匹配等待，match_deadline 记被激活方 24h 匹配窗截止。
ALTER TABLE listings ADD COLUMN match_deadline TEXT;
