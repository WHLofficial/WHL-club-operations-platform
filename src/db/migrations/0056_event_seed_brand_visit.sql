-- 0056_event_seed_brand_visit.sql · v6.14.0 C3 「品牌上门」种子（池 30 → 31）
-- 插件 DEFAULT_EVENTS 无 offer_spawn 事件（靠 LLM/自定义注入），本仓落 1 条即发种子让效果键真实可触发；
-- requires_no_naming 是 C3 新条件键（无生效冠名才触发，比插件的落空兜底干净）。
-- offer_spawn：从 adopted 且无 active 冠名的品牌按热度加权挑一家，向本队递稳健套餐报价挂当前开放招商轮；
-- 无开放轮 / 撞 UNIQUE → 落空播报（event-ops.ts）。
-- 回滚：DELETE FROM event_pool WHERE event_id = 'brand_visit';
INSERT OR IGNORE INTO event_pool
  (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json, soft_conditions, template, source, status, created_at)
VALUES
  ('brand_visit', '品牌上门', '招商', 5, 'instant', '{"requires_no_naming":true}', '{"offer_spawn":1}', '[]', 0,
   '{team} 近期的赛场表现与看台人气引来品牌侧注意，一家赞助商主动登门洽谈合作。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
