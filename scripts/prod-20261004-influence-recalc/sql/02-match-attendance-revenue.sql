-- 02 match_attendance：上座与三分收入重算（78 场；weather 保持库中已记录值不变）
-- 由 scripts/prod-20261004-influence-recalc/recalc.mjs plan 生成（2026-10-04T06:41:11.515Z）
-- 口径真源：src/worker/home.ts（v6.28.0）；重演随机项取区间中点、天气取库中已记录值
-- 本文件不自动执行：apply 默认只打印，需要显式 --yes

-- #33 切尔西：上座 8842 → 9554（雨，form 4）；收入 1.33 → 1.43
UPDATE match_attendance SET attendance = 9554, ticket = 1.43, commercial = 0, broadcast = 0 WHERE match_id = 33;
-- #36 利物浦：上座 10743 → 10834（多云，form 4）；收入 1.61 → 1.63
UPDATE match_attendance SET attendance = 10834, ticket = 1.63, commercial = 0, broadcast = 0 WHERE match_id = 36;
-- #32 尤文图斯：上座 13186 → 13157（晴，form 4）；收入 1.98 → 1.97
UPDATE match_attendance SET attendance = 13157, ticket = 1.97, commercial = 0, broadcast = 0 WHERE match_id = 32;
-- #52 切尔西：上座 11689 → 15668（晴，form 4）；收入 1.75 → 2.35
UPDATE match_attendance SET attendance = 15668, ticket = 2.35, commercial = 0, broadcast = 0 WHERE match_id = 52;
-- #49 曼联：上座 8085 → 8658（雪，form 4）；收入 1.21 → 1.3
UPDATE match_attendance SET attendance = 8658, ticket = 1.3, commercial = 0, broadcast = 0 WHERE match_id = 49;
-- #34 巴黎圣日耳曼：上座 10130 → 10724（多云，form 4）；收入 1.52 → 1.61
UPDATE match_attendance SET attendance = 10724, ticket = 1.61, commercial = 0, broadcast = 0 WHERE match_id = 34;
-- #41 切尔西：上座 8831 → 13068（雨，form 4）；收入 1.32 → 1.96
UPDATE match_attendance SET attendance = 13068, ticket = 1.96, commercial = 0, broadcast = 0 WHERE match_id = 41;
-- #31 皇家贝蒂斯：上座 6942 → 7202（多云，form 4）；收入 1.04 → 1.08
UPDATE match_attendance SET attendance = 7202, ticket = 1.08, commercial = 0, broadcast = 0 WHERE match_id = 31;
-- #163 奥林匹亚科斯：上座 7029 → 7374（多云，form 4）；收入 1.05 → 1.11
UPDATE match_attendance SET attendance = 7374, ticket = 1.11, commercial = 0, broadcast = 0 WHERE match_id = 163;
-- #164 阿斯顿维拉：上座 6117 → 6303（雨，form 4）；收入 0.92 → 0.95
UPDATE match_attendance SET attendance = 6303, ticket = 0.95, commercial = 0, broadcast = 0 WHERE match_id = 164;
-- #165 拜仁慕尼黑：上座 12208 → 12699（晴，form 4）；收入 1.83 → 1.9
UPDATE match_attendance SET attendance = 12699, ticket = 1.9, commercial = 0, broadcast = 0 WHERE match_id = 165;
-- #40 慕尼黑1860：上座 7057 → 7789（多���，form 4）；收入 1.06 → 1.17
UPDATE match_attendance SET attendance = 7789, ticket = 1.17, commercial = 0, broadcast = 0 WHERE match_id = 40;
-- #39 曼联：上座 9578 → 13855（多云，form 4）；收入 1.44 → 2.08
UPDATE match_attendance SET attendance = 13855, ticket = 2.08, commercial = 0, broadcast = 0 WHERE match_id = 39;
-- #38 佛罗伦萨：上座 12927 → 12735（晴，form 4）；收入 1.94 → 1.91
UPDATE match_attendance SET attendance = 12735, ticket = 1.91, commercial = 0, broadcast = 0 WHERE match_id = 38;
-- #42 里昂：上座 7914 → 8682（晴，form 4）；收入 1.19 → 1.3
UPDATE match_attendance SET attendance = 8682, ticket = 1.3, commercial = 0, broadcast = 0 WHERE match_id = 42;
-- #44 巴黎圣日耳曼：上座 8875 → 11225（晴，form 0）；收入 1.33 → 1.68
UPDATE match_attendance SET attendance = 11225, ticket = 1.68, commercial = 0, broadcast = 0 WHERE match_id = 44;
-- #45 里昂：上座 6477 → 9916（多云，form 4）；收入 0.97 → 1.49
UPDATE match_attendance SET attendance = 9916, ticket = 1.49, commercial = 0, broadcast = 0 WHERE match_id = 45;
-- #46 尤文图斯：上座 9304 → 11532（雨，form 4）；收入 1.4 → 1.73
UPDATE match_attendance SET attendance = 11532, ticket = 1.73, commercial = 0, broadcast = 0 WHERE match_id = 46;
-- #43 利物浦：上座 11193 → 13938（多云，form 4）；收入 1.68 → 2.09
UPDATE match_attendance SET attendance = 13938, ticket = 2.09, commercial = 0, broadcast = 0 WHERE match_id = 43;
-- #47 纽卡斯尔联：上座 5727 → 5860（雪，form 4）；收入 0.86 → 0.88
UPDATE match_attendance SET attendance = 5860, ticket = 0.88, commercial = 0, broadcast = 0 WHERE match_id = 47;
-- #172 阿斯顿维拉：上座 6616 → 8575（多云，form 4）；收入 0.99 → 1.29
UPDATE match_attendance SET attendance = 8575, ticket = 1.29, commercial = 0, broadcast = 0 WHERE match_id = 172;
-- #170 诺丁汉森林：上座 7620 → 8636（晴，form 4）；收入 1.14 → 1.3
UPDATE match_attendance SET attendance = 8636, ticket = 1.3, commercial = 0, broadcast = 0 WHERE match_id = 170;
-- #167 阿森纳：上座 8317 → 8727（晴，form 4）；收入 1.25 → 1.31
UPDATE match_attendance SET attendance = 8727, ticket = 1.31, commercial = 0, broadcast = 0 WHERE match_id = 167;
-- #171 奥林匹亚科斯：上座 7068 → 7863（多云，form 4）；收入 1.06 → 1.18
UPDATE match_attendance SET attendance = 7863, ticket = 1.18, commercial = 0, broadcast = 0 WHERE match_id = 171;
-- #173 诺丁汉森林：上座 6912 → 8091（多云，form 4）；收入 1.04 → 1.21
UPDATE match_attendance SET attendance = 8091, ticket = 1.21, commercial = 0, broadcast = 0 WHERE match_id = 173;
-- #174 皇家马德里：上座 7103 → 7419（多云，form 4）；收入 1.07 → 1.11
UPDATE match_attendance SET attendance = 7419, ticket = 1.11, commercial = 0, broadcast = 0 WHERE match_id = 174;
-- #175 皇家马德里：上座 9351 → 11610（晴，form 7）；收入 1.4 → 1.74
UPDATE match_attendance SET attendance = 11610, ticket = 1.74, commercial = 0, broadcast = 0 WHERE match_id = 175;
-- #10 曼联：上座 15351 → 21824（晴，form 9）；收入 2.3 → 3.27
UPDATE match_attendance SET attendance = 21824, ticket = 3.27, commercial = 0, broadcast = 0 WHERE match_id = 10;
-- #9 巴黎圣日耳曼：上座 8689 → 12719（雨，form 3）；收入 1.3 → 1.91
UPDATE match_attendance SET attendance = 12719, ticket = 1.91, commercial = 0, broadcast = 0 WHERE match_id = 9;
-- #5 慕尼黑1860：上座 8174 → 10600（多云，form 7）；收入 1.23 → 1.59
UPDATE match_attendance SET attendance = 10600, ticket = 1.59, commercial = 0, broadcast = 0 WHERE match_id = 5;
-- #7 佛罗伦萨：上座 11961 → 15254（晴，form 3）；收入 1.79 → 2.29
UPDATE match_attendance SET attendance = 15254, ticket = 2.29, commercial = 0, broadcast = 0 WHERE match_id = 7;
-- #4 纽卡斯尔联：上座 9557 → 11423（晴，form 6）；收入 1.43 → 1.71
UPDATE match_attendance SET attendance = 11423, ticket = 1.71, commercial = 0, broadcast = 0 WHERE match_id = 4;
-- #1 里昂：上座 5820 → 9788（雨，form 3）；收入 0.87 → 1.47
UPDATE match_attendance SET attendance = 9788, ticket = 1.47, commercial = 0, broadcast = 0 WHERE match_id = 1;
-- #3 利物浦：上座 13430 → 19682（晴，form 4）；收入 2.01 → 2.95
UPDATE match_attendance SET attendance = 19682, ticket = 2.95, commercial = 0, broadcast = 0 WHERE match_id = 3;
-- #2 皇家贝蒂斯：上座 7463 → 9081（雨，form 9）；收入 1.12 → 1.36
UPDATE match_attendance SET attendance = 9081, ticket = 1.36, commercial = 0, broadcast = 0 WHERE match_id = 2;
-- #53 慕尼黑1860：上座 10140 → 11904（晴，form 7）；收入 1.52 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 53;
-- #178 阿森纳：上座 4480 → 5205（雨，form 1）；收入 0.67 → 0.78
UPDATE match_attendance SET attendance = 5205, ticket = 0.78, commercial = 0, broadcast = 0 WHERE match_id = 178;
-- #50 皇家贝蒂斯：上座 8213 → 11502（多云，form 6）；收入 1.23 → 1.73
UPDATE match_attendance SET attendance = 11502, ticket = 1.73, commercial = 0, broadcast = 0 WHERE match_id = 50;
-- #51 佛罗伦萨：上座 8673 → 12929（雨，form 3）；收入 1.3 → 1.94
UPDATE match_attendance SET attendance = 12929, ticket = 1.94, commercial = 0, broadcast = 0 WHERE match_id = 51;
-- #54 纽卡斯尔联：上座 7165 → 9699（多云，form 3）；收入 1.07 → 1.45
UPDATE match_attendance SET attendance = 9699, ticket = 1.45, commercial = 0, broadcast = 0 WHERE match_id = 54;
-- #181 诺丁汉森林：上座 6513 → 8465（雨，form 6）；收入 0.98 → 1.27
UPDATE match_attendance SET attendance = 8465, ticket = 1.27, commercial = 0, broadcast = 0 WHERE match_id = 181;
-- #59 里昂：上座 5159 → 10283（雪，form 3）；收入 0.77 → 1.54
UPDATE match_attendance SET attendance = 10283, ticket = 1.54, commercial = 0, broadcast = 0 WHERE match_id = 59;
-- #60 巴黎圣日耳曼：上座 10139 → 17269（雨，form 6）；收入 1.52 → 2.59
UPDATE match_attendance SET attendance = 17269, ticket = 2.59, commercial = 0, broadcast = 0 WHERE match_id = 60;
-- #58 曼联：上座 12547 → 21824（多云，form 7）；收入 1.88 → 3.27
UPDATE match_attendance SET attendance = 21824, ticket = 3.27, commercial = 0, broadcast = 0 WHERE match_id = 58;
-- #55 尤文图斯：上座 10704 → 15123（多云，form 4）；收入 1.61 → 2.27
UPDATE match_attendance SET attendance = 15123, ticket = 2.27, commercial = 0, broadcast = 0 WHERE match_id = 55;
-- #180 拜仁慕尼黑：上座 9224 → 10410（多云，form 2）；收入 1.38 → 1.56
UPDATE match_attendance SET attendance = 10410, ticket = 1.56, commercial = 0, broadcast = 0 WHERE match_id = 180;
-- #56 利物浦：上座 13476 → 24419（多云，form 9）；收入 2.02 → 3.66
UPDATE match_attendance SET attendance = 24419, ticket = 3.66, commercial = 0, broadcast = 0 WHERE match_id = 56;
-- #179 阿斯顿维拉：上座 4775 → 6921（多云，form 0）；收入 0.72 → 1.04
UPDATE match_attendance SET attendance = 6921, ticket = 1.04, commercial = 0, broadcast = 0 WHERE match_id = 179;
-- #13 皇家马德里：上座 10781 → 11904（晴，form 7）；收入 1.62 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 13;
-- #20 曼联：上座 10710 → 21824（多云，form 5）；收入 1.61 → 3.27
UPDATE match_attendance SET attendance = 21824, ticket = 3.27, commercial = 0, broadcast = 0 WHERE match_id = 20;
-- #15 阿森纳：上座 4859 → 5299（雨，form 1）；收入 0.73 → 0.79
UPDATE match_attendance SET attendance = 5299, ticket = 0.79, commercial = 0, broadcast = 0 WHERE match_id = 15;
-- #17 诺丁汉森林：上座 7158 → 9760（多云，form 4）；收入 1.07 → 1.46
UPDATE match_attendance SET attendance = 9760, ticket = 1.46, commercial = 0, broadcast = 0 WHERE match_id = 17;
-- #11 皇家贝蒂斯：上座 5339 → 7629（多云，form 0）；收入 0.8 → 1.14
UPDATE match_attendance SET attendance = 7629, ticket = 1.14, commercial = 0, broadcast = 0 WHERE match_id = 11;
-- #19 奥林匹亚科斯：上座 6130 → 7317（雨，form 3）；收入 0.92 → 1.1
UPDATE match_attendance SET attendance = 7317, ticket = 1.1, commercial = 0, broadcast = 0 WHERE match_id = 19;
-- #65 皇家贝蒂斯：上座 8874 → 12641（晴，form 3）；收入 1.33 → 1.9
UPDATE match_attendance SET attendance = 12641, ticket = 1.9, commercial = 0, broadcast = 0 WHERE match_id = 65;
-- #62 切尔西：上座 10380 → 16374（多云，form 3）；收入 1.56 → 2.46
UPDATE match_attendance SET attendance = 16374, ticket = 2.46, commercial = 0, broadcast = 0 WHERE match_id = 62;
-- #14 纽卡斯尔联：上座 7020 → 10843（多云，form 3）；收入 1.05 → 1.63
UPDATE match_attendance SET attendance = 10843, ticket = 1.63, commercial = 0, broadcast = 0 WHERE match_id = 14;
-- #66 纽卡斯尔联：上座 9829 → 11904（晴，form 6）；收入 1.47 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 66;
-- #64 慕尼黑1860：上座 8318 → 11904（多云，form 7）；收入 1.25 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 64;
-- #67 里昂：上座 9360 → 11904（晴，form 6）；收入 1.4 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 67;
-- #186 阿森纳：上座 6095 → 7037（晴，form 1）；收入 0.91 → 1.06
UPDATE match_attendance SET attendance = 7037, ticket = 1.06, commercial = 0, broadcast = 0 WHERE match_id = 186;
-- #70 尤文图斯：上座 12325 → 17341（多云，form 5）；收入 1.85 → 2.6
UPDATE match_attendance SET attendance = 17341, ticket = 2.6, commercial = 0, broadcast = 0 WHERE match_id = 70;
-- #185 皇家马德里：上座 7707 → 10453（雨，form 7）；收入 1.16 → 1.57
UPDATE match_attendance SET attendance = 10453, ticket = 1.57, commercial = 0, broadcast = 0 WHERE match_id = 185;
-- #63 佛罗伦萨：上座 13669 → 21824（晴，form 6）；收入 2.05 → 3.27
UPDATE match_attendance SET attendance = 21824, ticket = 3.27, commercial = 0, broadcast = 0 WHERE match_id = 63;
-- #69 慕尼黑1860：上座 6615 → 11904（雨，form 4）；收入 0.99 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 69;
-- #68 曼联：上座 7947 → 19934（雪，form 4）；收入 1.19 → 2.99
UPDATE match_attendance SET attendance = 19934, ticket = 2.99, commercial = 0, broadcast = 0 WHERE match_id = 68;
-- #184 拜仁慕尼黑：上座 8659 → 11274（雨，form 3）；收入 1.3 → 1.69
UPDATE match_attendance SET attendance = 11274, ticket = 1.69, commercial = 0, broadcast = 0 WHERE match_id = 184;
-- #71 利物浦：上座 11570 → 25762（晴，form 3）；收入 1.74 → 3.86
UPDATE match_attendance SET attendance = 25762, ticket = 3.86, commercial = 0, broadcast = 0 WHERE match_id = 71;
-- #183 奥林匹亚科斯：上座 6210 → 7316（多云，form 2）；收入 0.93 → 1.1
UPDATE match_attendance SET attendance = 7316, ticket = 1.1, commercial = 0, broadcast = 0 WHERE match_id = 183;
-- #29 巴黎圣日耳曼：上座 16096 → 28786（晴，form 7）；收入 2.41 → 4.32
UPDATE match_attendance SET attendance = 28786, ticket = 4.32, commercial = 0, broadcast = 0 WHERE match_id = 29;
-- #28 尤文图斯：上座 9649 → 17221（多云，form 3）；收入 1.45 → 2.58
UPDATE match_attendance SET attendance = 17221, ticket = 2.58, commercial = 0, broadcast = 0 WHERE match_id = 28;
-- #25 慕尼黑1860：上座 6954 → 11904（雨，form 6）；收入 1.04 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 25;
-- #30 切尔西：上座 9563 → 17112（多云，form 3）；收入 1.43 → 2.57
UPDATE match_attendance SET attendance = 17112, ticket = 2.57, commercial = 0, broadcast = 0 WHERE match_id = 30;
-- #22 阿斯顿维拉：上座 10133 → 11904（晴，form 6）；收入 1.52 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 22;
-- #26 拜仁慕尼黑：上座 10103 → 14687（晴，form 2）；收入 1.52 → 2.2
UPDATE match_attendance SET attendance = 14687, ticket = 2.2, commercial = 0, broadcast = 0 WHERE match_id = 26;
-- #21 里昂：上座 9453 → 11904（多云，form 9）；收入 1.42 → 1.79
UPDATE match_attendance SET attendance = 11904, ticket = 1.79, commercial = 0, broadcast = 0 WHERE match_id = 21;
-- #27 佛罗伦萨：上座 13834 → 21824（晴，form 6）；收入 2.08 → 3.27
UPDATE match_attendance SET attendance = 21824, ticket = 3.27, commercial = 0, broadcast = 0 WHERE match_id = 27;
-- #23 利物浦：上座 7087 → 17377（多云，form 0）；收入 1.06 → 2.61
UPDATE match_attendance SET attendance = 17377, ticket = 2.61, commercial = 0, broadcast = 0 WHERE match_id = 23;
