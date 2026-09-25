-- 0031：PlayStyle 明细表 player_playstyles（v3.3.0，徽章 × PlayStyle 合并）
--
-- 背景：平台此前只有台账计数 players.badges_silver / badges_gold，PlayStyle 只以 PSID1-15 键躺在
-- players.game_attrs 里（那是 FC 源数据，导入即整列覆盖）。于是升级方案、中国计划发出去的「银/金徽章」
-- 只涨数字、发不出具体 PlayStyle；config 的 china_badges=3 更是一直没有代码读它。本表把
-- 「哪个槽、哪个 PlayStyle、谁发的、什么来源」落成明细，game_attrs 仍归 FC 源数据，
-- 属性页的清单 = 两者按槽位合起来（去重后展示）。
--
-- 槽位口径：15 槽里 1-12 银槽、13-15 金槽。psid 存基础 ID（1-99），金徽由 kind='gold' 表示 ——
-- FC 源数据里金徽存的是「基础 ID + 100」，两侧换算走 src/core/fc26.ts 的 basePlaystyleId / playstyleIdOf。
--
-- 上限统一：badge_cap_silver 由 15 改 12，与「12 个银槽」合并成一个口径。理由是物理上装不下第 13 个
-- 银徽章，台账上限再挂 15 只会让徽章墙的 x/15 与属性页的 12 个槽对不上。DDL 里的
-- CHECK (badges_silver BETWEEN 0 AND 15) 不动（已 apply 的迁移不改写），历史台账不 clamp。
--
-- ⚠️ 远端 apply 写入量：建表 + 建索引 + 改 1 行 config，量级可忽略。
-- 回滚：DROP TABLE player_playstyles; 并把 config.badge_cap_silver 改回 '15'。
CREATE TABLE IF NOT EXISTS player_playstyles (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  slot INTEGER NOT NULL,                     -- 槽号（1 起）
  kind TEXT NOT NULL,                        -- silver / gold
  psid INTEGER NOT NULL,                     -- 基础 ID（1-99）；金徽的 +100 由 kind 表示
  source TEXT NOT NULL,                      -- growth=升级方案 / china=中国计划 / manual=管理端直发
  granted_by INTEGER,                        -- 发放人（管理组用户 id）
  created_at TEXT,
  UNIQUE (player_id, slot),                  -- 一个槽只放一个 PlayStyle
  UNIQUE (player_id, kind, psid),            -- 同一段（银/金）里不重复
  CHECK (kind IN ('silver', 'gold')),
  CHECK (psid BETWEEN 1 AND 99),
  CHECK ((kind = 'silver' AND slot BETWEEN 1 AND 12) OR (kind = 'gold' AND slot BETWEEN 13 AND 15))
);

CREATE INDEX IF NOT EXISTS idx_player_playstyles_player ON player_playstyles (player_id, slot);

UPDATE config
   SET value = '12', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE key = 'badge_cap_silver';
