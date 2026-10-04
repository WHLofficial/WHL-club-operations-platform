-- 01 stadiums：队壳影响力/奖励分导入 + 死忠（fans / fans_window_start）窗末值（16 队）
-- 由 scripts/prod-20261004-influence-recalc/recalc.mjs plan 生成（2026-10-04T06:41:11.515Z）
-- 口径真源：src/worker/home.ts（v6.28.0）；重演随机项取区间中点、天气取库中已记录值
-- 本文件不自动执行：apply 默认只打印，需要显式 --yes

-- 阿森纳（club 1，second）：影响力 57.70 → 101.57；fans 1800 → 1968.0176760928
UPDATE stadiums SET shell_influence = 33.87, bonus_points = 10, fans = 1968.0176760928, fans_window_start = 1968.0176760928 WHERE club_id = 1;
-- 阿斯顿维拉（club 2，second）：影响力 82.64 → 157.93；fans 1800 → 2853.9086388941546
UPDATE stadiums SET shell_influence = 47.29, bonus_points = 28, fans = 2853.9086388941546, fans_window_start = 2853.9086388941546 WHERE club_id = 2;
-- 切尔西（club 5，premier）：影响力 75.62 → 175.09；fans 1800 → 3283.567536048574
UPDATE stadiums SET shell_influence = 57.89, bonus_points = 30, fans = 3283.567536048574, fans_window_start = 3283.567536048574 WHERE club_id = 5;
-- 利物浦（club 9，premier）：影响力 104.75 → 280.98；fans 1800 → 4179.917368032389
UPDATE stadiums SET shell_influence = 71.86, bonus_points = 90, fans = 4179.917368032389, fans_window_start = 4179.917368032389 WHERE club_id = 9;
-- 曼联（club 11，premier）：影响力 117.89 → 250.99；fans 1800 → 4424.5449990810675
UPDATE stadiums SET shell_influence = 73.41, bonus_points = 45, fans = 4424.5449990810675, fans_window_start = 4424.5449990810675 WHERE club_id = 11;
-- 纽卡斯尔联（club 13，premier）：影响力 96.08 → 176.58；fans 1800 → 3375.9415920468855
UPDATE stadiums SET shell_influence = 37.92, bonus_points = 35, fans = 3375.9415920468855, fans_window_start = 3375.9415920468855 WHERE club_id = 13;
-- 诺丁汉森林（club 14，second）：影响力 77.10 → 113.87；fans 1800 → 2431.349477597109
UPDATE stadiums SET shell_influence = 36.77, bonus_points = 0, fans = 2431.349477597109, fans_window_start = 2431.349477597109 WHERE club_id = 14;
-- 拜仁慕尼黑（club 21，second）：影响力 81.02 → 136.93；fans 1800 → 2600.84198050185
UPDATE stadiums SET shell_influence = 32.91, bonus_points = 23, fans = 2600.84198050185, fans_window_start = 2600.84198050185 WHERE club_id = 21;
-- 慕尼黑1860（club 33，premier）：影响力 102.07 → 171.46；fans 1800 → 3756.3486662153127
UPDATE stadiums SET shell_influence = 28.66, bonus_points = 35, fans = 3756.3486662153127, fans_window_start = 3756.3486662153127 WHERE club_id = 33;
-- 尤文图斯（club 45，premier）：影响力 90.98 → 190.47；fans 1800 → 3305.7049728568913
UPDATE stadiums SET shell_influence = 66.24, bonus_points = 20, fans = 3305.7049728568913, fans_window_start = 3305.7049728568913 WHERE club_id = 45;
-- 里昂（club 66，premier）：影响力 123.38 → 266.98；fans 1800 → 4600.97105646187
UPDATE stadiums SET shell_influence = 78, bonus_points = 50, fans = 4600.97105646187, fans_window_start = 4600.97105646187 WHERE club_id = 66;
-- 巴黎圣日耳曼（club 73，premier）：影响力 122.69 → 259.30；fans 1800 → 3923.911173770798
UPDATE stadiums SET shell_influence = 55.51, bonus_points = 70, fans = 3923.911173770798, fans_window_start = 3923.911173770798 WHERE club_id = 73;
-- 皇家马德里（club 243，second）：影响力 72.79 → 109.79；fans 1800 → 2692.7741650027942
UPDATE stadiums SET shell_influence = 37, bonus_points = 0, fans = 2692.7741650027942, fans_window_start = 2692.7741650027942 WHERE club_id = 243;
-- 奥林匹亚科斯（club 280，second）：影响力 42.71 → 98.06；fans 1800 → 2193.5304833968344
UPDATE stadiums SET shell_influence = 50.35, bonus_points = 5, fans = 2193.5304833968344, fans_window_start = 2193.5304833968344 WHERE club_id = 280;
-- 皇家贝蒂斯（club 449，premier）：影响力 76.57 → 143.96；fans 1800 → 2849.9323965412214
UPDATE stadiums SET shell_influence = 35.32, bonus_points = 25, fans = 2849.9323965412214, fans_window_start = 2849.9323965412214 WHERE club_id = 449;
-- 佛罗伦萨（club 110374，premier）：影响力 107.87 → 201.40；fans 1800 → 3582.881313403389
UPDATE stadiums SET shell_influence = 36.27, bonus_points = 50, fans = 3582.881313403389, fans_window_start = 3582.881313403389 WHERE club_id = 110374;
