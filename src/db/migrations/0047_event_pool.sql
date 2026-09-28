-- 0047_event_pool.sql · v6.10.0 随机事件（D 块）
-- 事件池：与参考插件 services/event_engine.py DEFAULT_EVENTS 逐字同的种子（插件注释写「22 条」是陈旧的，
-- 实际清点 **24 条 = 6 即发型 + 18 选择型**）。conditions/effects/options 都存 JSON 文本，
-- 由 event-ops.ts 解析：conditions 走 conditionOk（硬条件），effects 走 11 键效果表，options 是选择型的分支表。
-- soft_conditions=1 时条件不满足按 权重×event_rules.softConditionFactor 衰减参与抽取，而非硬剔除（种子全为 0）。
-- v6.10.0 只开放即发型触发；选择型（event_type='choice'）在 v6.11.0 开放（表结构已建全，届时零迁移）。
-- 回滚：DROP TABLE event_pool;
CREATE TABLE IF NOT EXISTS event_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '通用',
  weight INTEGER NOT NULL DEFAULT 10,
  event_type TEXT NOT NULL DEFAULT 'instant',   -- instant=触发即结算 / choice=玩家选一项后结算
  conditions_json TEXT NOT NULL DEFAULT '{}',   -- 硬触发条件（min_tier / requires_naming / requires_activity …）
  effects_json TEXT NOT NULL DEFAULT '{}',      -- 即发型效果（11 键）
  options_json TEXT NOT NULL DEFAULT '[]',      -- 选择型选项 [{no,name,desc,outcomes:[{w,effects}]}]
  soft_conditions INTEGER NOT NULL DEFAULT 0,   -- 1=条件不满足时衰减权重参与抽取
  template TEXT NOT NULL DEFAULT '',            -- 播报模板（{team} / {stadium} 占位）
  source TEXT NOT NULL DEFAULT 'builtin',       -- builtin=种子 / custom=管理端新增
  status TEXT NOT NULL DEFAULT 'adopted',       -- adopted=在池 / discarded=停用（不再参与抽取）
  created_at TEXT NOT NULL
);

-- 种子：24 条（幂等，重跑不重复）。取值与插件 DEFAULT_EVENTS 逐字一致。
INSERT OR IGNORE INTO event_pool
  (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json, soft_conditions, template, source, status, created_at)
VALUES
  -- ─── 即发型（6 条） ─────────────────────────
  ('storm_buzz', '暴雨滂沱', '天气衍生', 8, 'instant', '{}', '{"attendance_mod":0.85}', '[]', 0,
   '暴雨突袭，{stadium} 门前的长队湿了一半，{team} 球迷热情不减。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('tifo_viral', 'TIFO出圈', '球迷舆情', 7, 'instant', '{}', '{"fans_pct":0.03,"money":1.0}', '[]', 0,
   '{team} 球迷的巨型 TIFO 刷爆社交平台，{stadium} 一夜出圈。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('bad_press', '负面报道', '媒体', 5, 'instant', '{}', '{"fans_pct":-0.02}', '[]', 0,
   '一篇关于 {team} 的更衣室传闻登上头条，部分球迷表示要冷静观望。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('relic_found', '球场挖出文物', '意外之财', 2, 'instant', '{}', '{"money":6.0}', '[]', 0,
   '施工队在 {stadium} 地下挖到疑似文物，随后文旅部门送来一笔补偿金。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('subsidy', '政府补贴', '意外之财', 3, 'instant', '{}', '{"money":4.0}', '[]', 0,
   '{team} 获评城市标杆俱乐部，{stadium} 拿到了政府补贴。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('security_break', '安保存漏洞', '场地故障', 3, 'instant', '{}', '{"money":-2.5,"fans_pct":-0.01}', '[]', 0,
   '安检口被曝出漏洞，{team} 加急整改并缴纳了罚款。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- ─── 选择型（18 条；v6.11.0 开放，先入库） ─────────────────────────
  ('pitch_disease', '草皮病害', '场地故障', 8, 'choice', '{}', '{}',
   '[{"no":1,"name":"整块翻新草皮","desc":"一步到位，代价高","outcomes":[{"w":60,"effects":{"money":-3.0}},{"w":40,"effects":{"maintenance":4.0,"attendance_mod":0.9}}]},{"no":2,"name":"局部修补省钱","desc":"花小钱赌一把","outcomes":[{"w":50,"effects":{"money":-1.0,"fans_pct":0.01}},{"w":50,"effects":{"maintenance":3.0,"attendance_mod":0.85}}]}]',
   0, '球场的草皮最近越长越秃，{team} 需要决定怎么处理。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('light_fail', '灯光故障', '场地故障', 6, 'choice', '{}', '{}',
   '[{"no":1,"name":"连夜抢修灯光","desc":"保证夜场正常","outcomes":[{"w":70,"effects":{"money":-2.0}},{"w":30,"effects":{"maintenance":2.0,"attendance_mod":0.9}}]},{"no":2,"name":"租移动照明车","desc":"临时顶上","outcomes":[{"w":50,"effects":{"money":-0.5,"attendance_mod":1.05}},{"w":50,"effects":{"money":-3.5,"attendance_mod":0.95}}]}]',
   0, '比赛日灯光跳闸两小时，{stadium} 现场一片手电筒海，怎么补救?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('roof_leak', '顶棚漏水', '场地故障', 6, 'choice', '{}', '{}',
   '[{"no":1,"name":"赶在雨前修顶","desc":"花钱买保险","outcomes":[{"w":70,"effects":{"money":-2.0}},{"w":30,"effects":{"maintenance":3.0,"attendance_mod":0.9}}]},{"no":2,"name":"先遮再商议","desc":"省钱拖修","outcomes":[{"w":50,"effects":{"money":-0.5,"fans_pct":0.01}},{"w":50,"effects":{"maintenance":4.0,"attendance_mod":0.85}}]}]',
   0, '{stadium} 的顶棚在雨夜漏了水，维修队给出两套方案。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('fan_clash', '球迷冲突', '球迷舆情', 5, 'choice', '{}', '{}',
   '[{"no":1,"name":"高调道歉并处罚","desc":"平息舆论，成本高","outcomes":[{"w":60,"effects":{"money":-4.0,"fans_pct":0.02}},{"w":40,"effects":{"money":-6.0,"fans_pct":-0.01}}]},{"no":2,"name":"低调冷处理","desc":"省事但风险大","outcomes":[{"w":40,"effects":{"money":-1.0}},{"w":60,"effects":{"money":-5.0,"fans_pct":-0.03}}]}]',
   0, '客队球迷与主队球迷在 {stadium} 外发生冲突，{team} 要尽快表态。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('new_wave', '新球迷浪潮', '球迷舆情', 6, 'choice', '{}', '{}',
   '[{"no":1,"name":"办球迷开放日","desc":"小投入拉口碑","outcomes":[{"w":70,"effects":{"fans_pct":0.04,"money":-0.5}},{"w":30,"effects":{"fans_pct":0.01,"money":-1.5}}]},{"no":2,"name":"推出低价学生票","desc":"薄利多销搏长期","outcomes":[{"w":50,"effects":{"fans_pct":0.05,"money":-1.0}},{"w":50,"effects":{"money":0.5,"fans_pct":-0.01}}]}]',
   0, '社区推广见效，一群年轻人把 {stadium} 当成了周末打卡地，怎么接住?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('merch_hit', '周边爆款', '商业机会', 7, 'choice', '{}', '{}',
   '[{"no":1,"name":"加班加单补货","desc":"趁热度冲一波销售","outcomes":[{"w":60,"effects":{"money":5.0,"maintenance":1.0}},{"w":40,"effects":{"money":-1.5,"maintenance":3.0}}]},{"no":2,"name":"线上限量抽签","desc":"饥饿营销保口碑","outcomes":[{"w":50,"effects":{"money":4.0,"fans_pct":0.02}},{"w":50,"effects":{"money":0.5,"fans_pct":-0.02}}]}]',
   0, '{team} 新年款围巾脱销，周边商品盈利大涨，要不要趁机加码?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('scalper_raid', '黄牛泛滥', '商业机会', 5, 'choice', '{}', '{}',
   '[{"no":1,"name":"实名购票+人脸入场","desc":"动真格清理黄牛","outcomes":[{"w":60,"effects":{"money":-2.0,"fans_pct":0.03}},{"w":40,"effects":{"maintenance":4.0,"fans_pct":0.01}}]},{"no":2,"name":"与票务平台合作","desc":"技术封堵，成本中等","outcomes":[{"w":70,"effects":{"money":-1.0,"fans_pct":0.02}},{"w":30,"effects":{"money":-3.0,"fans_pct":-0.02}}]}]',
   0, '黄牛把 {team} 主场球票炒到三倍，俱乐部打算清理。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('food_fest', '球场美食节', '商业机会', 6, 'choice', '{}', '{}',
   '[{"no":1,"name":"自营加放15个摊","desc":"摊租全收","outcomes":[{"w":60,"effects":{"money":3.0}},{"w":40,"effects":{"money":-1.0,"maintenance":1.5}}]},{"no":2,"name":"免铺租换流量","desc":"让利引流","outcomes":[{"w":60,"effects":{"fans_pct":0.03,"money":1.0}},{"w":40,"effects":{"money":-2.0}}]}]',
   0, '{stadium} 美食节开了 18 个小吃摊，怎么运营赚得更多?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('doc_film', '纪录片取景', '媒体', 5, 'choice', '{}', '{}',
   '[{"no":1,"name":"免费借景","desc":"换口碑曝光","outcomes":[{"w":70,"effects":{"fans_pct":0.03,"money":-1.0}},{"w":30,"effects":{"fans_pct":0.01,"money":-2.5}}]},{"no":2,"name":"收取拍摄场地费","desc":"明码标价","outcomes":[{"w":50,"effects":{"money":2.0}},{"w":50,"effects":{"money":-0.5,"fans_pct":-0.01}}]}]',
   0, '有纪录片团队进驻 {stadium}，为 {team} 拍一个比赛日，怎么谈?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('extra_broadcast', '追加转播', '媒体', 5, 'choice', '{}', '{}',
   '[{"no":1,"name":"追加投入信号制作","desc":"自掏腰包提画质","outcomes":[{"w":70,"effects":{"money":4.0,"maintenance":0.5}},{"w":30,"effects":{"money":-1.5,"maintenance":2.0}}]},{"no":2,"name":"按现行制式上","desc":"零成本佛系","outcomes":[{"w":60,"effects":{"money":1.5}},{"w":40,"effects":{"money":-0.5}}]}]',
   0, '{team} 的主场比赛被追加为全国转播场次，转播分成怎么最大化?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('guest_ghost', '演唱会嘉宾鸽了', '档期联动', 5, 'choice', '{"requires_activity":"concert"}', '{}',
   '[{"no":1,"name":"紧急补位嘉宾","desc":"高价临时请人","outcomes":[{"w":60,"effects":{"money":2.0,"maintenance":1.0}},{"w":40,"effects":{"money":-3.0,"maintenance":2.0}}]},{"no":2,"name":"全额退票+补偿","desc":"花钱保口碑","outcomes":[{"w":50,"effects":{"money":-4.0,"fans_pct":0.03}},{"w":50,"effects":{"money":-6.0,"fans_pct":-0.02}}]}]',
   0, '原定在 {stadium} 开唱的嘉宾临时鸽了，退票潮来袭。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('concert_pack', '档期爆满加场', '档期联动', 5, 'choice', '{"requires_activity":"concert"}', '{}',
   '[{"no":1,"name":"加开一场","desc":"吃满热度","outcomes":[{"w":60,"effects":{"money":5.0,"maintenance":1.5}},{"w":40,"effects":{"money":-1.0,"maintenance":4.0}}]},{"no":2,"name":"不加场，卖贵一点","desc":"物以稀为贵","outcomes":[{"w":60,"effects":{"money":3.0,"fans_pct":-0.01}},{"w":40,"effects":{"money":-1.0}}]}]',
   0, '{stadium} 演唱会门票秒空，主办方问要不要加场。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('brand_crisis', '冠名品牌危机', '冠名联动', 4, 'choice', '{"requires_naming":true}', '{}',
   '[{"no":1,"name":"声援品牌共渡难关","desc":"留人情换长约","outcomes":[{"w":60,"effects":{"money":-3.0,"fans_pct":0.02}},{"w":40,"effects":{"money":-4.0,"fans_pct":-0.02}}]},{"no":2,"name":"紧急换广告位","desc":"切割风险","outcomes":[{"w":50,"effects":{"money":-4.0,"fans_pct":0.02}},{"w":50,"effects":{"money":1.0}}]}]',
   0, '冠名品牌出事了，{team} 的球场广告位被下架整改。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('brand_anniv', '冠名周年庆', '冠名联动', 4, 'choice', '{"requires_naming":true}', '{}',
   '[{"no":1,"name":"全力赞助庆典","desc":"借势营销","outcomes":[{"w":70,"effects":{"money":4.0,"fans_pct":0.02,"maintenance":0.5}},{"w":30,"effects":{"money":-1.0,"fans_pct":-0.01}}]},{"no":2,"name":"只提供场地","desc":"稳赚不亏","outcomes":[{"w":60,"effects":{"money":2.5}},{"w":40,"effects":{"money":-0.5,"maintenance":1.0}}]}]',
   0, '冠名品牌在 {stadium} 办周年嘉年华，赠送 {team} 一笔营销赞助。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('derby_buzz', '德比热度', '商业机会', 6, 'choice', '{}', '{}',
   '[{"no":1,"name":"加急印限量球衣","desc":"抢德比财","outcomes":[{"w":60,"effects":{"money":6.0,"maintenance":1.0}},{"w":40,"effects":{"money":-2.0,"maintenance":2.0}}]},{"no":2,"name":"提高包厢价格","desc":"趁热抬价","outcomes":[{"w":50,"effects":{"money":4.0,"fans_pct":-0.01}},{"w":50,"effects":{"money":-1.5,"fans_pct":-0.02}}]}]',
   0, '德比大战将至，{stadium} 的球票一票难求，气氛提前被点燃。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('vip_luxury', 'VIP礼遇升级', '商业机会', 4, 'choice', '{}', '{}',
   '[{"no":1,"name":"升级包厢软装","desc":"高投入高回报","outcomes":[{"w":60,"effects":{"money":4.0,"maintenance":2.0}},{"w":40,"effects":{"money":-3.0,"maintenance":3.0}}]},{"no":2,"name":"与豪华酒店联名","desc":"借名头少投入","outcomes":[{"w":60,"effects":{"money":3.0,"fans_pct":0.01}},{"w":40,"effects":{"money":-1.5,"fans_pct":-0.01}}]}]',
   0, '{stadium} 的 VIP 包厢推出香槟套餐，要不要借机升级?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('brand_cocreate', '品牌联合营销', '冠名联动', 4, 'choice', '{"requires_naming":true}', '{}',
   '[{"no":1,"name":"联名球衣上市","desc":"大干一场","outcomes":[{"w":60,"effects":{"money":5.0,"fans_pct":0.02,"brand_heat":0.05}},{"w":40,"effects":{"money":-2.0,"satisfaction":-0.1}}]},{"no":2,"name":"门店互相引流","desc":"稳妥试点","outcomes":[{"w":70,"effects":{"money":2.0,"satisfaction":0.05}},{"w":30,"effects":{"money":-0.5}}]}]',
   0, '冠名品牌找上门：想在 {stadium} 搞一波联合营销，方案摆上了桌。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('brand_poach', '竞品挖角', '冠名联动', 3, 'choice', '{"requires_naming":true}', '{}',
   '[{"no":1,"name":"加码稳住现品牌","desc":"忠诚为本","outcomes":[{"w":65,"effects":{"satisfaction":0.15}},{"w":35,"effects":{"money":-2.0,"satisfaction":-0.05}}]},{"no":2,"name":"接触竞价的新品牌","desc":"待价而沽","outcomes":[{"w":50,"effects":{"money":3.0,"satisfaction":-0.2}},{"w":50,"effects":{"money":-1.0,"satisfaction":-0.1}}]}]',
   0, '竞品品牌私下接触 {team}，想撬走你家的冠名商。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
