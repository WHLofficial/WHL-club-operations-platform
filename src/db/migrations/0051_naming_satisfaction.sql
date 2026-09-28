-- 0051_naming_satisfaction.sql · v6.12.0 D3 品牌满意度（只落事件满意度）
-- naming_contracts 加 satisfaction：事件效果（satisfaction 键）按钳幅 ±0.5 累加，钳 [0,2]，
-- 1.0 中性起点（口径同参考插件 db/schema.py 的 naming.satisfaction REAL DEFAULT 1.0）。
-- 三信号演化（上座/战绩加权）与「低于下界品牌主动解约」整块留 C2，本版只落事件效果与展示。
-- 回滚：ALTER TABLE 不可回滚，SQLite 3.35+ 可 DROP COLUMN satisfaction;
ALTER TABLE naming_contracts ADD COLUMN satisfaction REAL NOT NULL DEFAULT 1.0;
