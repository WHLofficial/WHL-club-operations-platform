-- 回读：三行都要等于目标值（squad_max=30 / trainee_max=7 / growthPa87 两档=6）。
SELECT key, value,
       CASE key
         WHEN 'squad_max'      THEN value = '30'
         WHEN 'trainee_max'    THEN value = '7'
         WHEN 'ca_pa_limits'   THEN json_extract(value, '$.premier.growthPa87') = 6
                               AND json_extract(value, '$.second.growthPa87') = 6
       END AS ok
  FROM config
 WHERE key IN ('squad_max', 'trainee_max', 'ca_pa_limits');
