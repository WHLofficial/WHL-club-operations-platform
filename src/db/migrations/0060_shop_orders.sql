-- 0060：消费中心工单两表（v6.26.0）。
--
-- shop_orders = 消费工单流水：教练端五类商品（买 PA / 徽章 / 角色 / 位置热区 / 队壳）提交即建单并扣费，
-- 管理组审核通过才真正改数据、拒绝自动退款；source='external' 是管理组代录的外部增益工单
-- （积分兑换 / 奖励等），纯效果单不进账本（amount 为 NULL），创建与确认两步。
-- payload_json 是各类商品的参数（教练端提交时校验、审批时重校验），形状见 src/worker/shop-ops.ts。
-- amount 在提交时锁定进单，config 改价不影响已提交的单。
--
-- player_purchases = 已购属性台账（导入保护）：教练买下的 PA 点 / 角色 / 位置热区在这里逐笔记账，
-- 球员名单重导入会整列覆盖 game_attrs / pa，confirmImport 按这笔台账在每 chunk 批内重放，
-- 「导入 + 重放」整体幂等。徽章不进这张表 —— player_playstyles 本身就是明细台账（source='shop'/'external'）。
--
-- ⚠️ 远端 apply 写入量：两张空表 + 4 条索引 + 3 行 config upsert，量级可忽略。
-- 回滚：DROP TABLE shop_orders; DROP TABLE player_purchases; 并把三条 config 键 DELETE。

CREATE TABLE IF NOT EXISTS shop_orders (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('club', 'external')),
  club_id INTEGER NOT NULL,
  ordered_by INTEGER NOT NULL,               -- 发起人用户 id（club=教练 / external=管理组操作员）
  category TEXT NOT NULL CHECK (category IN ('pa', 'badge', 'badge_upgrade', 'role', 'position', 'club_shell')),
  payload_json TEXT NOT NULL,
  amount REAL,                               -- club=平台内金额（提交时锁定）；external=NULL 不进账本
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note TEXT,                                 -- 提交备注；队壳单通过时可写交付壳名
  reviewed_by INTEGER,                       -- 审核人（管理组用户 id）
  reviewed_at TEXT,
  reject_reason TEXT,                        -- 拒绝理由（拒绝时必填，退款通知带给教练）
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_club ON shop_orders (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS player_purchases (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('pa', 'role', 'position')),
  value_json TEXT NOT NULL,                  -- pa:{"points":N} / role:{"slot":n,"roleId":R,"prevRoleId":R|null} / position:{"slot":n,"posId":P,"prevPosId":P|null}
  order_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_purchases_player ON player_purchases (player_id, field);

-- 消费价格表（JSON，管理端 config 可改；键语义见 src/core/config.ts 的默认值注释）
INSERT INTO config (key, value, updated_at)
  VALUES ('shop_prices', '{"paPerPoint":15,"clubShell":5,"badgeSilver":4,"badgeGold":8,"badgeSilverToGold":6,"roleAddPlus":5,"roleAddPlusPlus":12,"roleUpgrade":10,"roleRemove":5,"positionAdd":5,"positionRemove":5,"positionReplace":8}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(key) DO NOTHING;
-- 豪门俱乐部名单（JSON 数组的俱乐部 id；队壳申请走群内咨询，系统只拦不收）
INSERT INTO config (key, value, updated_at)
  VALUES ('shop_hpremium_clubs', '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(key) DO NOTHING;
-- FC26 当前版本 PA 上限（2025.12.17 版本为 95；买 PA 不得超过）
INSERT INTO config (key, value, updated_at)
  VALUES ('fc26_pa_cap', '95', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(key) DO NOTHING;
