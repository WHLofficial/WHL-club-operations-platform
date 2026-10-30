-- v6.61.0 属性成长加成开关（34 项细分属性按「初始属性 + delta」展示；'0' = 关）
-- 语义见 src/core/growth-attrs.ts；开关读取处 createConfigService(...).getNumber('growth_attr_bonus')
INSERT INTO config (key, value, updated_at)
  VALUES ('growth_attr_bonus', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(key) DO NOTHING;
