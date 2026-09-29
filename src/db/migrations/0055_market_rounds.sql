-- 0055_market_rounds.sql · v6.14.0 C3 招商轮
-- 每轮品牌招商：非临时窗的关窗批内清盘旧轮（未签 pending → expired、整轮无人签品牌热度 −0.03）
-- 并开新轮（名额未满的 adopted 品牌各定向 3 队递报价）。报价被接受即成 naming_contracts（合同快照列化同 0024）。
-- 轮不绑「目标窗口」：下一窗的 window_seq 由管理端开窗时才定（可指定任意值），关窗时不可预知——
-- opened_season/opened_window 只记开轮时刻所关的窗作归档；部分唯一索引保证全局最多一个 open 轮。
-- 报价何时能签由 accept 侧校验（轮 open + 有开着的窗口），与轮行解耦。
-- offer 状态机：pending（待签）→ accepted（签约生效）/ queued（有 active 冠名时选「到期后自动接替」的待生效态，
--   转正点：现合同到期 / 球队退约 / 品牌侧解约）/ expired（TTL 过线或关窗清盘）。
-- package_json 存套餐快照（pkg_name / bonusAmount / betAttend / betFans 等）+ 槽位语义（slot，当前恒 'naming'，
--   轮逻辑不写死冠名——将来赞助分层时换数据不改引擎）。
-- 回滚：DROP TABLE market_offers; DROP TABLE market_rounds;
CREATE TABLE IF NOT EXISTS market_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_season INTEGER NOT NULL,
  opened_window INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
  opened_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE TABLE IF NOT EXISTS market_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,                   -- market_rounds.id
  brand_id INTEGER NOT NULL,                   -- brand_pool.id
  club_id INTEGER NOT NULL,                    -- clubs.id（平台库主键）
  package_no INTEGER NOT NULL,
  amount REAL NOT NULL,                        -- 每窗费（M 口径同 naming_contracts.fee_per_window）
  windows INTEGER NOT NULL,
  package_json TEXT NOT NULL DEFAULT '{}',     -- 套餐快照 + slot 语义
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'queued', 'expired')),
  created_at TEXT NOT NULL,
  expire_at TEXT NOT NULL
);

-- 同一轮里一品牌对一队只递一份报价（重发即落空，offer_spawn 同此闸）；前缀可服务按轮查
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_offers_round ON market_offers (round_id, brand_id, club_id);
-- 全局最多一个 open 轮（清盘与开轮同在关窗批，批内自洽）
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_round_open ON market_rounds (status) WHERE status = 'open';
-- 一队同时最多一份「到期后自动接替」的接班报价
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_offer_queued ON market_offers (club_id) WHERE status = 'queued';
-- 教练端收件箱：按队查当前有效报价
CREATE INDEX IF NOT EXISTS idx_market_offers_club ON market_offers (club_id, status);
