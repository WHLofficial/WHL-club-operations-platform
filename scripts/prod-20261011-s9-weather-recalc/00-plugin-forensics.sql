-- S9 天气同步前 · 插件生产库取证（用户服务器代跑，只读）
-- 库文件：AstrBot 插件数据目录 revenue_system.db（astrbot_plugin_whleague_revenue_system）
-- 用法：sqlite3 revenue_system.db < 00-plugin-forensics.sql
-- 目的：确认 ①schema 版本（wx_coef 应不存在）②S9 各轮天气与结算覆盖 ③队名拼写 ④账本现状

.mode box
.headers on

-- ① 版本与表结构
SELECT 'schema_version' AS k, value AS v FROM plugin_config WHERE key='schema_version';
SELECT name FROM pragma_table_info('matches') WHERE name IN ('wx_coef','weather','result');

-- ② S9 每轮覆盖：总场/已预报天气/已结算（非 C）
SELECT season_number, competition, round_no,
       COUNT(*) AS matches,
       SUM(CASE WHEN weather IS NOT NULL AND weather <> '' THEN 1 ELSE 0 END) AS weathered,
       SUM(CASE WHEN result IS NOT NULL AND result <> 'C' THEN 1 ELSE 0 END) AS settled
FROM matches
GROUP BY season_number, competition, round_no
ORDER BY season_number, competition, round_no;

-- ③ S9 天气类型分布（全库）
SELECT weather, COUNT(*) AS n FROM matches
WHERE weather IS NOT NULL AND weather <> '' GROUP BY weather ORDER BY n DESC;

-- ④ 联赛状态（当前窗）
SELECT * FROM league_state;

-- ⑤ 账本规模：按队×窗
SELECT team_name, season_number, window_seq, COUNT(*) AS txns, ROUND(SUM(amount),2) AS total
FROM revenue_transactions GROUP BY team_name, season_number, window_seq
ORDER BY season_number, window_seq, team_name;

-- ⑥ 队名拼写（与 tour 对照：(CPU) 后缀、空格）
SELECT DISTINCT home_team FROM matches ORDER BY home_team;

-- ⑦ 已结算场次明细（S9 末窗，供订正批锚点核对）
SELECT id, season_number, window_seq, round_no, competition, home_team, away_team,
       weather, result, attendance, ROUND(ticket_revenue,2) AS ticket,
       ROUND(commercial,2) AS commercial, ROUND(broadcast,2) AS broadcast
FROM matches
WHERE result IS NOT NULL AND result <> 'C'
ORDER BY season_number DESC, competition, round_no, id;
