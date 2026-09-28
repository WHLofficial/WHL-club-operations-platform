-- v6.8.0 冠名活化：品牌池落库（原 naming-ops.ts 硬编码 DEFAULT_BRANDS 7 家迁出，
-- 品牌名与 0024 合同表里可能存在的 active 合同逐字同 ⇒ 存量合同天然兼容）。
-- 热度/行业管理端可调（naming_industry_factors / market_heat_rules 两个 config 键配套）。
-- 满意度/档位性格体系（tier/packages_json/tier_locked 列）缓议留 C2，届时 ADD COLUMN。
-- 回滚：DROP TABLE brand_pool;
CREATE TABLE brand_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL UNIQUE,
  heat REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'builtin',   -- builtin=种子 / custom=管理端新增
  status TEXT NOT NULL DEFAULT 'adopted',   -- adopted=在池 / discarded=弃用（有 active 合同禁弃）
  industry TEXT NOT NULL DEFAULT '通用',
  created_at TEXT NOT NULL
);

-- 种子：与 v2.6.0 起硬编码的 DEFAULT_BRANDS 逐字同值；幂等（重跑不重复）
INSERT OR IGNORE INTO brand_pool (brand, heat, source, status, industry, created_at) VALUES
  ('麒麟生物', 1.2, 'builtin', 'adopted', '医疗', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('阿迪达斯', 1.1, 'builtin', 'adopted', '运动', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('亚马逊', 1.3, 'builtin', 'adopted', '科技', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('可口可乐', 1.0, 'builtin', 'adopted', '饮食', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('海底捞', 0.9, 'builtin', 'adopted', '饮食', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('星海通讯', 0.8, 'builtin', 'adopted', '科技', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('CVS Health', 0.7, 'builtin', 'adopted', '医疗', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
