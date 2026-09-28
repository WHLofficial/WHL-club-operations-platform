-- 0053_event_drafts.sql · v6.12.0 D3 LLM 草稿工坊（管理端 only）
-- LLM 生成的事件文案 / 结构草稿落这里，管理端审校（编辑→采纳/废弃）后才真正进 event_pool；
-- 池表永远只装已审事件（草稿不参与抽取）。LLM 只碰文案与创意，数值效果由结构 + config 钳制决定。
-- kind: text=改写某事件的播报文案（采纳时写 event_pool.template）
--       struct=新事件结构草稿（采纳时 INSERT event_pool，event_id 撞车 409）
-- status: draft=待审 / adopted=已采纳 / discarded=已废弃
-- 回滚：DROP TABLE event_drafts;
CREATE TABLE IF NOT EXISTS event_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'struct')),
  payload_json TEXT NOT NULL,             -- text: {template} / struct: 完整事件字段（event_id/name/category/weight/conditions/effects/options/template…）
  source_event_id TEXT,                   -- text 草稿的改写对象（event_pool.event_id）；struct 为 NULL
  note TEXT NOT NULL DEFAULT '',          -- 生成参数 / 审校备注
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'adopted', 'discarded')),
  created_by INTEGER,                     -- 管理员账号 id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_event_drafts_status ON event_drafts (status, id DESC);
