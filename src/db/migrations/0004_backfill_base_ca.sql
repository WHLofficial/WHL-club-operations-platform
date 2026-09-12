-- 0004 · 回填初始CA与可成长判定（规则 4.2.2 限额以初始CA计；4.1.1 第一赛季 ≤25 岁可成长）。
-- 增量 1 的导入未写 base_ca、growable 恒为默认 1；存量球员按当前值初始化，幂等可重复执行。
-- 口径裁决：初始CA 跟随 FC 源刷新（= §10.4 非平台成长所得 CA，随每次导入更新）；
-- growable 由首次导入按年龄初始化，此后赛季结算重判、管理端 PATCH 可修正（留审计）。
UPDATE players SET base_ca = ca WHERE base_ca IS NULL AND ca IS NOT NULL;
UPDATE players SET growable = CASE WHEN age IS NOT NULL AND age <= 25 THEN 1 ELSE 0 END;
