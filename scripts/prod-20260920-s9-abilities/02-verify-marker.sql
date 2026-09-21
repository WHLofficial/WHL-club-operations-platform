-- 只读验收（批次标记口径）：执行后跑一次
--   node scratch/run-verify.mjs scripts/prod-20260920-s9-abilities/02-verify-marker.sql
-- 与 02-verify.sql 等价：该文件把「源 570 行」逐列核对，本文件把范围收窄为「本批落库的 257 行」
-- —— 本批全部语句都写 updated_at = '2026-09-20T15:59:02.880Z'（生成时点常量），该时刻为全库唯一。
-- 覆盖完整性由 gen-abilities-sql.ts --verify（源 570 行逐行重算，期望「剩余差异 0 行」）保证。
-- 期望（2026-09-21 实测）：touched = 257（本批语句数）、delta_gt0 = 254、null_core = 0、gold_rows = 35、gold_slots = 36、ca_vs_attr = 254
--   gold_rows / gold_slots 量的是「范围内**持有**金徽（PSID13-15 ≥ 101）的行 / 槽数」= 状态数，
--   不是本批增量；本批**新增/变更**的金徽是 4 行 / 5 槽。

SELECT
  (SELECT COUNT(*) FROM players WHERE updated_at = '2026-09-20T15:59:02.880Z') AS touched,
  (SELECT COUNT(*) FROM players WHERE updated_at = '2026-09-20T15:59:02.880Z' AND ca <> COALESCE(base_ca, ca)) AS delta_gt0,
  (SELECT COUNT(*) FROM players WHERE updated_at = '2026-09-20T15:59:02.880Z' AND (ca IS NULL OR pa IS NULL OR base_ca IS NULL)) AS null_core,
  (SELECT COUNT(*) FROM players WHERE updated_at = '2026-09-20T15:59:02.880Z' AND ((CASE WHEN COALESCE(json_extract(game_attrs, '$.PSID13'), 0) >= 101 THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(json_extract(game_attrs, '$.PSID14'), 0) >= 101 THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(json_extract(game_attrs, '$.PSID15'), 0) >= 101 THEN 1 ELSE 0 END)) > 0) AS gold_rows,
  (SELECT COALESCE(SUM((CASE WHEN COALESCE(json_extract(game_attrs, '$.PSID13'), 0) >= 101 THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(json_extract(game_attrs, '$.PSID14'), 0) >= 101 THEN 1 ELSE 0 END) + (CASE WHEN COALESCE(json_extract(game_attrs, '$.PSID15'), 0) >= 101 THEN 1 ELSE 0 END)), 0) FROM players WHERE updated_at = '2026-09-20T15:59:02.880Z') AS gold_slots,
  (SELECT COUNT(*) FROM players WHERE updated_at = '2026-09-20T15:59:02.880Z' AND ca <> COALESCE(json_extract(game_attrs, '$.CA'), ca)) AS ca_vs_attr;
