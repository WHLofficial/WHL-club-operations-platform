-- 回滚：删掉本批导入的合同（按批次标记 source+生成时点精确圈定，不误伤其他来源的合同）
-- 生成时点 2026-09-21T01:46:58.647Z；本批 462 条；执行：node ../exec-shards.mjs rollback/contracts-rollback.sql --remote
-- 队籍无需回滚：本批 462 行全部是 create（队籍对齐批已把球员放进目标队），生成器未产出任何 players 更新。

DELETE FROM contracts WHERE source = 'import' AND signed_at = '2026-09-21T01:46:58.647Z';

-- 回滚后自查（期望 0）：
SELECT COUNT(*) AS left_rows FROM contracts WHERE source = 'import' AND signed_at = '2026-09-21T01:46:58.647Z';
