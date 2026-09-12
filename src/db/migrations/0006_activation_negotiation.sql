-- 激活挂牌（规则 4.4.2，TECH_DESIGN §6.2）与签约谈判（§6.7/§6.8）增量列。
-- listings.type 词汇扩展：normal/forced 之外新增 activation（训练营球员激活挂牌）。
ALTER TABLE listings ADD COLUMN activated_by INTEGER REFERENCES clubs;      -- 激活方俱乐部（激活挂牌专属）
ALTER TABLE listings ADD COLUMN activation_deadline TEXT;                   -- 5 分钟首价窗截止（激活方落价或失效后清空）

-- 谈判会话的新违约金（提交时定，成约时落合同；E 快照存在 expected_wage）
ALTER TABLE negotiation_sessions ADD COLUMN release_fee REAL;

-- 经纪人档位已在 0001 players.agent_tier（默认 2 普通），此处无需变更。

-- 一名球员同时只能有一单活跃挂牌（普通挂牌与激活挂牌共用；并发双挂由 DB 兜底，
-- 路由层查重仅作可读报错）。失效/下架/完成后的历史挂牌不受限。
CREATE UNIQUE INDEX idx_listings_active_player
  ON listings(player_id) WHERE status IN ('listed', 'bidding', 'pending_review');
