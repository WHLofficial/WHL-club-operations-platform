-- 0015 · 初始归属 initial_club_id（v0.7.1 裁决 2：初始球员库=导入时数据；
-- 导入数据里的归属仅供成长判断「本队」使用，XP 场次匹配仍按当前归属名单）
-- 回填口径：最早一条归属变更（transfer/activation/match/forced_auction/termination，from_club_id 非空）的 from_club_id；
-- 只海捞过（free_agent，from 为空）= 导入时无归属，留 NULL；完全没转过会 = 导入即现属。

ALTER TABLE players ADD COLUMN initial_club_id INTEGER;

UPDATE players SET initial_club_id = (
  SELECT t.from_club_id FROM transfers t
  WHERE t.player_id = players.id AND t.from_club_id IS NOT NULL
    AND t.type IN ('transfer', 'activation', 'match', 'forced_auction', 'termination')
  ORDER BY t.id ASC LIMIT 1
)
WHERE initial_club_id IS NULL
  AND EXISTS (
    SELECT 1 FROM transfers t2
    WHERE t2.player_id = players.id AND t2.from_club_id IS NOT NULL
      AND t2.type IN ('transfer', 'activation', 'match', 'forced_auction', 'termination')
  );

UPDATE players SET initial_club_id = NULL
WHERE initial_club_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM transfers t2
    WHERE t2.player_id = players.id AND t2.from_club_id IS NOT NULL
      AND t2.type IN ('transfer', 'activation', 'match', 'forced_auction', 'termination')
  )
  AND EXISTS (SELECT 1 FROM transfers t3 WHERE t3.player_id = players.id AND t3.type = 'free_agent');

-- 其余（完全没转过会）：导入即现属；海捞行已被上一步显式置 NULL 并在此排除
UPDATE players SET initial_club_id = club_id
WHERE initial_club_id IS NULL AND club_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transfers t3 WHERE t3.player_id = players.id AND t3.type = 'free_agent');
