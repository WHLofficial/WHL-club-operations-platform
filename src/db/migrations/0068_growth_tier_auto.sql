-- 0068_growth_tier_auto.sql · v6.48.0 成长档位自动核定（§10.3）
--
-- 两列：
--   clubs.country              队壳国家（FC NationID 空间；名称表见 web/assets/ref/nation.json，
--                              Worker 侧镜像 src/core/nations.ts）。现实事实，只能人工录入：
--                              建档必填、管理端可改、换壳随 rekey --touch-club --new-country 工件更新。
--   players.growth_tier_locked 人工锁定：锁定的球员自动重算一律跳过（可解除）。单人核定写值即置锁。
--
-- 档位规则从「管理组手工判断」改为平台自动核定（口径 = §10.3 五条件叠加、上限 5）：
--   tier = MIN(1 + 现实效力与队壳一致 + 会籍与队壳国家一致 + 中国国籍（大陆） + 2×未来之星 + ≤18 岁, 5)
-- 缺数据不猜：club_id / game_attrs.TeamID / game_attrs.naID / clubs.country 缺任一，对应条件记 0。
--
-- 回填：仅 20 行现存队壳国家（现实事实，管理组口径）。球员档位不由本迁移回填——上线后经管理端
--       「首次回填预览 → 确认执行」跑一次全量重算（预览与执行同一重算器）。
-- 回滚：ALTER TABLE 不可回滚；SQLite 3.35+ 可 DROP COLUMN（已写入的国家值与档位不恢复）。
ALTER TABLE clubs ADD COLUMN country INTEGER;
ALTER TABLE players ADD COLUMN growth_tier_locked INTEGER NOT NULL DEFAULT 0;

-- 英超 8 队 → 英格兰（14）
UPDATE clubs SET country = 14 WHERE country IS NULL AND id IN (1, 2, 5, 9, 10, 11, 13, 14);
-- 拜仁慕尼黑 / 慕尼黑1860 / RB莱比锡 → 德国（21）
UPDATE clubs SET country = 21 WHERE country IS NULL AND id IN (21, 33, 112172);
-- 尤文图斯 / 佛罗伦萨 / AC米兰 → 意大利（27）
UPDATE clubs SET country = 27 WHERE country IS NULL AND id IN (45, 110374, 131681);
-- 里昂 / 巴黎圣日耳曼 → 法国（18）
UPDATE clubs SET country = 18 WHERE country IS NULL AND id IN (66, 73);
-- 巴塞罗那 / 皇家马德里 / 皇家贝蒂斯 → 西班牙（45）
UPDATE clubs SET country = 45 WHERE country IS NULL AND id IN (241, 243, 449);
-- 奥林匹亚科斯 → 希腊（22）
UPDATE clubs SET country = 22 WHERE country IS NULL AND id = 280;
