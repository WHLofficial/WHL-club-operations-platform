-- 0094 · PlayStyle 来源覆盖（v6.78.0）
--
-- 背景一：成长徽章按「数量 1/3 向上取整」继承到下赛季（5.+ 球员成长 §5.4）。S9 大名单里 41 枚继承徽章
-- 本来就在 FC 槽（game_attrs.PSID*）里，另外 27 枚既不在 FC 也无发放明细。若把 41 枚再插进
-- player_playstyles，fullCountSql 会把 FC 与明细各算一次（台账翻倍）；清 FC 槽又会动 raw FC/导出、
-- 触发金压同基础银，且下次导入会把 FC 槽刷回来。故继承只做「标记」：合并清单命中 (段, 基础 ID) 时
-- 把来源覆盖为 growth（角标显示「成长」），槽位/psid/计数/筛选/导出全部不动。
--
-- 背景二：S9 导入时 7 枚门将银徽（Diogo Costa 52/53/56、Penders 52/53/54/55）被写进 FC 槽，
-- 但实际是消费所得（商店）。同样不搬 FC 槽，只加一条 source='shop' 的标记，合并清单把 FC 源角标
-- 覆盖为「商店」，计数/槽位/raw FC 都不动；下次导入也不会把标记刷掉。
--
-- 本表不是发放明细：不占槽、不参与可逆抑制、不进 fullCountSql、不写 audit_log 的发放动作。
-- 未来换版若 FC 槽被新版数据覆盖，标记仍在；要让它重新出现在清单里，需要另做「虚拟项」读取（本增量不做）。
--
-- ⚠️ 远端 apply 只建表 + 索引，量级可忽略；数据行由 S8-S9 继承清单与消费来源清单单独导入。
-- 回滚：DROP INDEX idx_player_playstyle_origin_player; DROP TABLE player_playstyle_origin;
CREATE TABLE IF NOT EXISTS player_playstyle_origin (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  season INTEGER NOT NULL,                   -- 标记所属赛季（S8→S9 写 9）
  kind TEXT NOT NULL,                        -- silver / gold
  psid INTEGER NOT NULL,                     -- 基础 ID（1-99）；金徽的 +100 由 kind 表示
  source TEXT NOT NULL,                      -- 覆盖后的来源：growth / shop / china / external / manual
  note TEXT,                                 -- 例：'S8→S9 1/3 继承'、'消费所得'
  created_at TEXT,
  UNIQUE (player_id, season, kind, psid),    -- 同一赛季同一段同一基础只标一次
  CHECK (kind IN ('silver', 'gold')),
  CHECK (psid BETWEEN 1 AND 99),
  CHECK (source IN ('growth', 'shop', 'china', 'external', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_player_playstyle_origin_player
  ON player_playstyle_origin (player_id, season);
