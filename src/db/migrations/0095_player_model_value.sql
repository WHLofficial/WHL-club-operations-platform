-- 0095 · 球员模型参考价（v6.79.0 身价初值与调价页）
--
-- 模型参考价：bot 离线脚本生成 SQL 写入（全量覆盖），管理端只读展示；不是规则输入。
-- 写入通道 = 插件仓 scripts/generate_value_seed.py 出 SQL、wrangler d1 execute 手动执行（无审计，
-- 种子注释行自带记录）；market_value 初值由种子 COALESCE 只填 NULL，与 model_value 分开两列。
--
-- 回滚：SQLite 3.35+ 支持 ALTER TABLE players DROP COLUMN model_value（D1 现行版本可用）；
--       索引回滚 = DROP INDEX IF EXISTS idx_transfers_player; 再按 0001 原样建单列索引。
--
-- ⚠️ 同名索引重建：0001 已建过单列 idx_transfers_player(player_id)，同名 IF NOT EXISTS 会被
--    静默吞掉（复合索引永远建不出来），所以先 DROP 再建——(player_id, id) 前缀覆盖原单列
--    全部用途，demand-ops 等按 player_id 点查的旧查询不受影响。
DROP INDEX IF EXISTS idx_transfers_player;
-- 模型参考价：bot 离线脚本生成的 SQL 写入（全量覆盖），管理端只读展示；不是规则输入
ALTER TABLE players ADD COLUMN model_value REAL;
-- 身价页最近成交相关子查询用
CREATE INDEX IF NOT EXISTS idx_transfers_player ON transfers(player_id, id);
