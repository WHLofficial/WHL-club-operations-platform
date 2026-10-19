-- v6.52.0：非成长球员（growable = 0）不再参与成长 XP —— 存量清零（用户 m06019 拍板）。
-- 判定口径与既有索引一致：COALESCE(growable, 0) = 1 才算可成长。
-- 事件行留档不删（成长史/球员比赛 tab 仍要读这些数据）；levels_applied 不动
-- （生产实测非成长球员 levels_applied 全为 0 ⇒ 清零后 pending 自然归 0）。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0059/0069/0070/0071 约定）。
-- 尾部守卫 COALESCE(growth_xp, 0) <> 0 不可省：SQLite 会把匹配行都计入 rows_written，
-- 去掉后一次 apply 要写 7,827 行；带上只写真正有 XP 的约 116 行，且重放为 0 行。
UPDATE players SET growth_xp = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE COALESCE(growable, 0) = 0
   AND COALESCE(growth_xp, 0) <> 0;
-- 回滚：不可精确还原（清零前的 growth_xp ≠ SUM(growth_events.xp)：解约/导入清零不删事件、改值重放会改事件 xp），
-- 只能近似重算：
--   UPDATE players SET growth_xp = (SELECT COALESCE(SUM(xp),0) FROM growth_events WHERE player_id = players.id)
--    WHERE COALESCE(growable, 0) = 0;
