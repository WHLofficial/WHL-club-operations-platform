-- 0078_venue_slots_p0.sql · v6.53.0 球场档期 P0（计划 §2）
-- 用途：把「非比赛日档位 / 场馆经营」所需的最小结构落到 D1。
-- 列语义：
--   season_windows.venue_reminder_at  关窗提醒去重标记，'' = 未提醒过（§6.2）
--   stadiums.venue_reputation         场馆声望 0–100（REAL：加点 ×上座率、赛季末 ×0.9 会出小数）
--   stadiums.attendance_mod_matches   多场上座乘数剩余主场场数，0 = 无待消费（K 固定 5，不锁进 CHECK）
--   clubs.venue_policy                玩家方针：'' 未选 / money / fans / reputation（默认只出预览、不落效果）
--   clubs.city                        城市，可空；NULL 与 '' 都表示未填（与 0068 的 country 同风格）
--   venue_window_settlements          窗末副作用幂等台账：一队一窗一行，唯一插入成功才写声望/上座乘数
-- 顺序不可重排：唯一可能失败的 CREATE UNIQUE INDEX 必须放第 1 条，
-- 生产若已有两个 status='open' 行，迁移在第一条就炸、一列都没加，重跑落在同一位置同一错误，不留半状态。
-- 迁移执行器自行包事务：文件内不写 BEGIN/COMMIT（同 0069/0077 约定）。
-- 回滚（逆序执行；第 ⑨ 条的 UPDATE 只在 0078 确实把它从双 none 改过时才回滚，
-- 原非 none 的锚点不要跑这条）：
--   UPDATE ops_schedule
--      SET start_anchor = 'none', start_at = NULL,
--          end_anchor = 'none', end_at = NULL,
--          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
--    WHERE op_key = 'consumption';
--   DROP TABLE IF EXISTS venue_window_settlements;
--   ALTER TABLE clubs DROP COLUMN city;
--   ALTER TABLE clubs DROP COLUMN venue_policy;
--   ALTER TABLE stadiums DROP COLUMN attendance_mod_matches;
--   ALTER TABLE stadiums DROP COLUMN venue_reputation;
--   ALTER TABLE season_windows DROP COLUMN venue_reminder_at;
--   DROP INDEX IF EXISTS idx_season_windows_open;
--   回填的逆操作：UPDATE stadiums SET attendance_mod_matches = 0;

-- ① 同时刻 ≤1 个 open 窗（P0 第 ⑦ 项）。放第 1 条：本文件唯一可能失败的 DDL
--    现状 DB 只有 UNIQUE(season, window_seq)（0001_init.sql:172-182），
--    应用层 COUNT 检查（window-machine.ts:82-85）与 INSERT（:170）不同批 ⇒ 并发拦不住。
CREATE UNIQUE INDEX IF NOT EXISTS idx_season_windows_open
  ON season_windows(status) WHERE status = 'open';

-- ② 关窗提醒去重标记（§6.2）。'' = 未提醒过
ALTER TABLE season_windows ADD COLUMN venue_reminder_at TEXT NOT NULL DEFAULT '';

-- ③ 场馆声望 0–100（锁定决策 6）。REAL 而非 INTEGER：加点 ×上座率、赛季末 ×0.9 都会出小数
ALTER TABLE stadiums ADD COLUMN venue_reputation REAL NOT NULL DEFAULT 0
  CHECK (venue_reputation >= 0 AND venue_reputation <= 100);

-- ④ 多场上座乘数载体（锁定决策 7，K 固定 5）：剩余主场场数，0 = 无待消费
--    不写 BETWEEN 0 AND 5：K 是代码常量，锁进 CHECK 后改 K 要重建表
ALTER TABLE stadiums ADD COLUMN attendance_mod_matches INTEGER NOT NULL DEFAULT 0
  CHECK (attendance_mod_matches >= 0);

-- ⑤ 存量回填：设计 Q12「随机事件预置仍一场即清（不置 K）」⇒ 存量 next_attendance_mod<>1 保持 K=0。
--    列默认就是 0，这条只把「将来若有人手工置过 K」拉回 0；正常迁移写 0 行。
UPDATE stadiums SET attendance_mod_matches = 0
 WHERE next_attendance_mod <> 1 AND attendance_mod_matches <> 0;

-- ⑥ 玩家方针（锁定决策 8）：空串 = 未选，默认只出预览、不落任何效果
ALTER TABLE clubs ADD COLUMN venue_policy TEXT NOT NULL DEFAULT ''
  CHECK (venue_policy IN ('', 'money', 'fans', 'reputation'));

-- ⑦ 城市（锁定决策 9）：可空；NULL 与 '' 都表示未填。与 0068 的 clubs.country 同风格
ALTER TABLE clubs ADD COLUMN city TEXT;

-- ⑧ 窗末副作用幂等台账（A7）：一队一窗一行，唯一插入成功才允许写声望/上座乘数
CREATE TABLE IF NOT EXISTS venue_window_settlements (
  club_id         INTEGER NOT NULL,
  season          INTEGER NOT NULL,
  window_seq      INTEGER NOT NULL,
  reputation_gain REAL NOT NULL DEFAULT 0,
  attend_mod      REAL NOT NULL DEFAULT 1,
  bookings        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (club_id, season, window_seq)
);

-- ⑨ 消费中心的窗口闸（P0 第 ⑥ 项）：requires_window=1 单独不产生闸门，
--    必须把两端锚到窗口开关；只改「当前双 none」的行，不覆盖运营手工配置。
UPDATE ops_schedule
   SET start_anchor = 'window_open',
       start_at = NULL,
       end_anchor = 'window_close',
       end_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE op_key = 'consumption'
   AND start_anchor = 'none'
   AND end_anchor = 'none';
