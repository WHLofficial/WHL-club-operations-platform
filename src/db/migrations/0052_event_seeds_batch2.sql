-- 0052_event_seeds_batch2.sql · v6.12.0 D3 种子扩池（24 → 30）
-- 插件 DEFAULT_EVENTS 与 0047 逐字同、无可搬余量 ⇒ 6 条为本仓手写（风格对齐 0047 种子），
-- 主题与效果按用户 2026-09-28 脑拍板确认的草案：
--   legend_visit   名宿回访       即发/4  fan_mood+2、satisfaction+0.25（无冠名落空）
--   sponsor_audit  赞助商突击考察 即发/3  requires_naming；upkeep×1.2、fee_mod×0.9（考核期）
--   mascot_debut   吉祥物出道     选择/5  大办 −4m+情绪2 / 简办 −1m+情绪1 / 取消 情绪−1
--   adboard_row    广告牌争议     选择/4  requires_naming；撤广告 fee_mod×0.9 / 强挺 情绪+0.3+粉丝−2 / 道歉 粉丝+1+情绪−0.15
--   wifi_upgrade   看台 Wi-Fi 升级 选择/4  自费 −3m+情绪2+维护×1.1 / 拉赞助 情绪+0.2+冠名费×1.05 / 搁置无变化
--   city_fair      城市嘉年华     选择/5  黄金档 −5m+情绪2+冠名×1.1 / 标准 −2m+情绪1 / 缺席 情绪−1
-- fan_mood / upkeep / fee_mod 是经营信号（signals）的三键，关窗批消费（home.ts）；
-- satisfaction 落 naming_contracts.satisfaction（0051）。
-- 回滚：DELETE FROM event_pool WHERE event_id IN ('legend_visit','sponsor_audit','mascot_debut','adboard_row','wifi_upgrade','city_fair');
INSERT OR IGNORE INTO event_pool
  (event_id, name, category, weight, event_type, conditions_json, effects_json, options_json, soft_conditions, template, source, status, created_at)
VALUES
  ('legend_visit', '名宿回访', '球迷舆情', 4, 'instant', '{}', '{"signals":{"fan_mood":2.0},"satisfaction":0.25}', '[]', 0,
   '传奇名宿突然现身 {stadium} 看台，{team} 球迷又惊又喜，社交媒体一片沸腾。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('sponsor_audit', '赞助商突击考察', '冠名联动', 3, 'instant', '{"requires_naming":true}', '{"signals":{"upkeep":1.2,"fee_mod":0.9}}', '[]', 0,
   '冠名品牌组建考察团突访 {stadium}，{team} 连夜整改场馆，考核期费用与让利同步上桌。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('mascot_debut', '吉祥物出道', '球迷舆情', 5, 'choice', '{}', '{}',
   '[{"no":1,"name":"高调出道","desc":"全城巡游造势","outcomes":[{"w":60,"effects":{"money":-4.0,"signals":{"fan_mood":2.0}}},{"w":40,"effects":{"money":-5.5}}]},{"no":2,"name":"低调亮相","desc":"主场首秀小成本","outcomes":[{"w":70,"effects":{"money":-1.0,"signals":{"fan_mood":1.0}}},{"w":30,"effects":{"money":-1.5}}]},{"no":3,"name":"取消企划","desc":"把钱省下来","outcomes":[{"w":80,"effects":{}},{"w":20,"effects":{"signals":{"fan_mood":-1.0}}}]}]',
   0, '市场部拟了份吉祥物企划书，{team} 的看台需要一个新宠，办不办?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('adboard_row', '广告牌争议', '冠名联动', 4, 'choice', '{"requires_naming":true}', '{}',
   '[{"no":1,"name":"撤下争议广告","desc":"息事宁人让利品牌","outcomes":[{"w":70,"effects":{"signals":{"fee_mod":0.9}}},{"w":30,"effects":{"money":-1.0,"signals":{"fee_mod":0.95}}}]},{"no":2,"name":"公开力挺品牌","desc":"商业立场压过球迷","outcomes":[{"w":55,"effects":{"satisfaction":0.3,"signals":{"fan_mood":-2.0}}},{"w":45,"effects":{"satisfaction":-0.1,"signals":{"fan_mood":-1.0}}}]},{"no":3,"name":"出面道歉调停","desc":"两边都安抚","outcomes":[{"w":65,"effects":{"signals":{"fan_mood":1.0},"satisfaction":-0.15}},{"w":35,"effects":{"money":-0.5}}]}]',
   0, '{team} 场边的品牌广告被球迷组织抗议冒犯，三方都在等俱乐部表态。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('wifi_upgrade', '看台 Wi-Fi 升级', '商业机会', 4, 'choice', '{}', '{}',
   '[{"no":1,"name":"自费整体升级","desc":"体验立竿见影","outcomes":[{"w":65,"effects":{"money":-3.0,"signals":{"fan_mood":2.0,"upkeep":1.1}}},{"w":35,"effects":{"money":-3.5,"signals":{"fan_mood":1.0}}}]},{"no":2,"name":"拉品牌共建","desc":"冠名 Wi-Fi 换投入","outcomes":[{"w":60,"effects":{"satisfaction":0.2,"signals":{"fee_mod":1.05}}},{"w":40,"effects":{"money":-0.5}}]},{"no":3,"name":"搁置","desc":"先用旧网络","outcomes":[{"w":90,"effects":{}},{"w":10,"effects":{"signals":{"fan_mood":-1.0}}}]}]',
   0, '{stadium} 的看台 Wi-Fi 老旧卡顿被球迷吐槽上热搜，升级方案两选一。', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('city_fair', '城市嘉年华', '商业机会', 5, 'choice', '{}', '{}',
   '[{"no":1,"name":"黄金档位参展","desc":"压轴日主场舞台","outcomes":[{"w":60,"effects":{"money":-5.0,"signals":{"fan_mood":2.0,"fee_mod":1.1}}},{"w":40,"effects":{"money":-5.0,"signals":{"fan_mood":1.0}}}]},{"no":2,"name":"标准展位","desc":"按部就班","outcomes":[{"w":75,"effects":{"money":-2.0,"signals":{"fan_mood":1.0}}},{"w":25,"effects":{"money":-2.5}}]},{"no":3,"name":"缺席","desc":"节省开支","outcomes":[{"w":80,"effects":{}},{"w":20,"effects":{"signals":{"fan_mood":-1.0}}}]}]',
   0, '城市嘉年华向 {team} 发来邀请函，展位档位决定曝光量，选哪档?', 'builtin', 'adopted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
