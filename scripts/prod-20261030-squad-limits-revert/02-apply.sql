-- 写入（回滚值见 README）：只动这三行，squad_min / gk_min / 其它键一律不碰。
-- ca_pa_limits 用 json_set 只改两个 growthPa87，保留 ge90 / ge87 等其它字段原值。
UPDATE config SET value = '30' WHERE key = 'squad_max';
UPDATE config SET value = '7'  WHERE key = 'trainee_max';
UPDATE config
   SET value = json_set(value, '$.premier.growthPa87', 6, '$.second.growthPa87', 6)
 WHERE key = 'ca_pa_limits';
