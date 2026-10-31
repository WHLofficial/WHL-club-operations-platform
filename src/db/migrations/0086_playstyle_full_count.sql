-- 0086：徽章 × PlayStyle 台账全量收口（v6.63.0）
--
-- 背景：「徽章」=「发放所得的 PlayStyle」被拆成三份存储、两套名字；台账 players.badges_silver/gold
-- 只数发放所得、15 槽只在 game_attrs 里，同一球员在球员库「徽章」列与「PlayStyle」列各显示半个概念。
-- v6.63.0 把台账改成派生值：badges_silver/gold = 合同清单段内数量 = FC 槽数（减被发放金抑制的银槽）
-- + 发放明细行数（player_playstyles）。写路径全部改为明细变更后重算（growth.ts recountBadgeStatements），
-- 本迁移一次性把存量台账对齐到同一公式，并清掉历史违规行与随语义作废的对象。
--
-- 本迁移的三段与幂等性：
--   ① 清洗存量违规：球员 247 曾在 51 秒内连续两笔升级先发银 24 再发金 24（发放判重只做同段去重
--     的历史后果），按裁决「删银保金」删掉那行发放银；金 24 行与 FC 槽原样保留。重放时无行可删。
--     球员 557（FC 自带银 1/31 + 升级发金 1/31）**零数据变更**——金顶银是可逆抑制：FC 银槽留在
--     game_attrs 里，四口径（展示/计数/筛选/meta）由读侧派生消失，金行消失时自动回归。
--   ② 台账 backfill：对全表按全量公式重算（表达式与 src/core/playstyle-rules.ts 的 fullCountSql
--     逐字同源，tests/playstyles.test.ts 有逐字锁）。幂等：纯派生 UPDATE，重跑结果不变。
--     ⚠️ 远端 apply 写入量 ≈ 每行 2 列 × 18,301 ≈ 36,602 行（免费档日写约 73%）——单独授权、低峰执行。
--   ③ 退役对象：idx_players_sort_ps（0034 的 15 槽计数索引，sort=ps 改走台账列后无用，每次重导
--     省 18,301 行写）；config.badge_cap_silver/badge_cap_gold 两行（上限守卫收敛到槽位结构
--     12 银 / 3 金，代码侧 src/core/config.ts 注册表已同步退役）。
--
-- 回滚：无法单独回滚台账（派生值，可再次重算）；①删掉的发放银 247 行不可恢复（历史留档见审计）。
-- 适用前提：运行时写路径已随本迁移同版上线（旧代码的增量式台账 + 新 backfill 会互相覆盖，但
-- 任何一次明细变更后的重算都会重新对齐，最终一致）。

-- ① 清洗：247 删发放银 24（557 零变更）
DELETE FROM player_playstyles
 WHERE player_id = 247
   AND kind = 'silver'
   AND psid = 24;

-- ② 台账 backfill（= fullCountSql('silver') / fullCountSql('gold') 的逐字展开）
UPDATE players SET
  badges_silver = (CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID1') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID1') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID2') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID2') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID3') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID3') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID4') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID4') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID5') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID5') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID6') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID6') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID7') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID7') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID8') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID8') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID9') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID9') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID10') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID10') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID11') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID11') AS INTEGER)) THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID12') AS INTEGER) > 0 AND NOT EXISTS (SELECT 1 FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold' AND pp.psid = CAST(json_extract(players.game_attrs, '$.PSID12') AS INTEGER)) THEN 1 ELSE 0 END + (SELECT COUNT(*) FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'silver')),
  badges_gold = (CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID13') AS INTEGER) > 100 THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID14') AS INTEGER) > 100 THEN 1 ELSE 0 END + CASE WHEN CAST(json_extract(players.game_attrs, '$.PSID15') AS INTEGER) > 100 THEN 1 ELSE 0 END + (SELECT COUNT(*) FROM player_playstyles pp WHERE pp.player_id = players.id AND pp.kind = 'gold')),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- ③ 退役：15 槽计数排序索引与两枚台账帽 config 键
DROP INDEX IF EXISTS idx_players_sort_ps;

DELETE FROM config
 WHERE key IN ('badge_cap_silver', 'badge_cap_gold');
