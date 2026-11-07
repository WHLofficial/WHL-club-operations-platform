-- 00-precheck.sql · 只读预检(执行 01 前逐项核对)
-- 预期:P1 拟签 25 人全部 status='free'、club_id NULL、transfer_listed=0;
--       P2 淘汰 5 人 club_id/status 与预期一致、growth 全零;
--       P3 活跃挂单 0 行;P4 两队标记档占用在限额内;P5 当前窗 S9/W2 open。

-- P1 拟签 25 人现态(米兰 14 + 曼城 10 + 弹性 Marcos Leonardo 515 不签,列出只为确认仍在池)
SELECT id, display_name, position, age, ca, status, club_id, transfer_listed, list_price
FROM players WHERE id IN (
  70,95,144,154,166,183,240,256,272,291,341,452,494,579,   -- 米兰 14
  38,110,137,149,161,206,284,465,756,1335,                 -- 曼城 10
  515                                                      -- 弹性(不签)
) ORDER BY id;

-- P2 淘汰 5 人现态(预期:13232/9443 club 131681;1791/9390/1238 club 10;全 normal;growth_xp=0;levels_applied=0)
SELECT id, display_name, club_id, status, ca, base_ca, growth_xp, levels_applied, number
FROM players WHERE id IN (13232, 9443, 1791, 9390, 1238) ORDER BY id;

-- P3 活跃挂单(预期 0 行;delisted 终态不算冲突)
SELECT player_id, seller_club_id, type, status FROM listings
WHERE player_id IN (70,95,144,154,166,183,240,256,272,291,341,452,494,579,
                    38,110,137,149,161,206,284,465,756,1335,
                    13232,9443,1791,9390,1238)
  AND status <> 'delisted';

-- P4 两队现役标记档占用(预期:米兰 ge87=1/growth=1;曼城 0/0;限额 ge87≤4、growth≤6)
SELECT club_id,
  SUM(CASE WHEN base_ca >= 87 THEN 1 ELSE 0 END) ge87,
  SUM(CASE WHEN ca < 87 AND pa >= 87 AND growable = 1 THEN 1 ELSE 0 END) growth_pa87
FROM players WHERE club_id IN (10, 131681) AND status IN ('normal','listed')
GROUP BY club_id;

-- P5 当前窗(预期最新一行 season=9 window_seq=2 status='open')
SELECT id, season, window_seq, status, opened_at, closed_at
FROM season_windows ORDER BY id DESC LIMIT 1;
