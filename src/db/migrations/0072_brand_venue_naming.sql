-- v6.51.0 批 1：冠名上球场（品牌·球场原名 的中点命名）。
-- 只加一列快照：签约/接班转正/续约时把「品牌·球场名」写入合同，球场改名后旧约仍显示签约时点名称；
-- 读侧统一口径 = 快照非空用快照、为空（老合同/未 apply）现场 compose、无冠名 null。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）。
-- 回滚：ALTER TABLE naming_contracts DROP COLUMN venue_name;（SQLite 3.35+ 支持；D1 已支持）

ALTER TABLE naming_contracts ADD COLUMN venue_name TEXT NOT NULL DEFAULT '';
