-- 0093 · transfers 成交快照四列（model-refit Phase 3 §5.2）：成交那一刻把球员的能力等级与
-- 位置组拍进单据，插件侧「真实成交回归」因此用历史等级而非当前等级（后来升级不污染旧成交）。
--   player_level     REAL  成交时的 ability_level（§6.7 十档映射，年龄 ≤ young_blend_age 按 (CA档+PA档)/2 混合）
--   player_role      TEXT  成交时的位置组，口径 = 插件回归模型的 CB/FB/MF/FW/GK（FB=边后卫；
--                          与平台四档 DF 不同——拆出 CB/FB 是拟合语义，别混用）
--   snapshot_source  TEXT  'deal_time'（成交时写入）/ 'current_backfill'（下方历史回填）
--   snapshot_at      TEXT  快照写入时刻
ALTER TABLE transfers ADD COLUMN player_level REAL;
ALTER TABLE transfers ADD COLUMN player_role TEXT;
ALTER TABLE transfers ADD COLUMN snapshot_source TEXT;
ALTER TABLE transfers ADD COLUMN snapshot_at TEXT;

-- 历史一次性回填：只读当前 players 数据补快照（不猜历史等级），来源标 'current_backfill'。
-- 守卫 snapshot_source IS NULL：幂等（重放/中途崩不重复写），且若代码先于迁移上线，
-- 已写成 'deal_time' 的行绝不被覆盖。等级/角色算不出（缺 CA/PA/年龄、位置不在映射内）写 NULL。
-- 等级 SQL 逐字复刻 core/negotiation-rules.ts 的 ratingLevel/abilityLevel（阈值漂移即测试红）。
UPDATE transfers
   SET player_level = (
         SELECT CASE
                  WHEN p.ca IS NULL OR p.pa IS NULL OR p.age IS NULL THEN NULL
                  WHEN p.age <= COALESCE((SELECT CAST(value AS INTEGER) FROM config WHERE key = 'young_blend_age'), 25)
                    THEN (
                      CASE WHEN p.ca >= 93 THEN 10 WHEN p.ca >= 90 THEN 9 WHEN p.ca >= 87 THEN 8 WHEN p.ca >= 84 THEN 7
                           WHEN p.ca >= 80 THEN 6 WHEN p.ca >= 75 THEN 5 WHEN p.ca >= 70 THEN 4 WHEN p.ca >= 65 THEN 3
                           WHEN p.ca >= 60 THEN 2 ELSE 1 END
                      +
                      CASE WHEN p.pa >= 93 THEN 10 WHEN p.pa >= 90 THEN 9 WHEN p.pa >= 87 THEN 8 WHEN p.pa >= 84 THEN 7
                           WHEN p.pa >= 80 THEN 6 WHEN p.pa >= 75 THEN 5 WHEN p.pa >= 70 THEN 4 WHEN p.pa >= 65 THEN 3
                           WHEN p.pa >= 60 THEN 2 ELSE 1 END
                    ) / 2.0
                  ELSE CASE WHEN p.ca >= 93 THEN 10 WHEN p.ca >= 90 THEN 9 WHEN p.ca >= 87 THEN 8 WHEN p.ca >= 84 THEN 7
                            WHEN p.ca >= 80 THEN 6 WHEN p.ca >= 75 THEN 5 WHEN p.ca >= 70 THEN 4 WHEN p.ca >= 65 THEN 3
                            WHEN p.ca >= 60 THEN 2 ELSE 1 END
                END
           FROM players p WHERE p.id = transfers.player_id
       ),
       player_role = (
         SELECT CASE p.position
                  WHEN 'GK' THEN 'GK'
                  WHEN 'CB' THEN 'CB'
                  WHEN 'RB' THEN 'FB'
                  WHEN 'LB' THEN 'FB'
                  WHEN 'CDM' THEN 'MF'
                  WHEN 'RM' THEN 'MF'
                  WHEN 'CM' THEN 'MF'
                  WHEN 'LM' THEN 'MF'
                  WHEN 'CAM' THEN 'MF'
                  WHEN 'RW' THEN 'FW'
                  WHEN 'ST' THEN 'FW'
                  WHEN 'LW' THEN 'FW'
                  ELSE NULL
                END
           FROM players p WHERE p.id = transfers.player_id
       ),
       snapshot_source = 'current_backfill',
       snapshot_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status = 'completed'
   AND snapshot_source IS NULL;
