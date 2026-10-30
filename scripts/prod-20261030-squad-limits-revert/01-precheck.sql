-- 编制与成长名额回调（2026-10-30，用户令）：
--   一线队上限 32 → 30
--   训练营上限 8 → 7
--   CA<87 且 PA≥87 且未练满的可成长名额 顶级 7 → 6（次级本就是 6）
-- 只读预检：三行现值 + 涉及的表/键都取出来对一眼，跑 apply 之前先看一眼输出。
SELECT key, value FROM config WHERE key IN ('squad_min', 'squad_max', 'gk_min', 'trainee_max', 'ca_pa_limits');
