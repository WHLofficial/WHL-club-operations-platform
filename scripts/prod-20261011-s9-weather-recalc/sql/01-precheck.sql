-- S9 天气订正批 · 生产只读预检（whl-club）
-- 标签与 capture-snapshot.mjs 的 LABELS 一一对应（A–H），每条必须是以 SELECT 开头的单条语句。
-- 用途：gen-recalc-sql.ts 据此判定「哪些已结算场次的可证输入差异」，并算系数比缩放。

-- A 赛季↔赛事绑定（赛事名 → tournament_id / competition_type）
SELECT season, tournament_id, competition_type, created_at
FROM season_tournaments
ORDER BY season, tournament_id;

-- B 平台侧预报行（含 forecast_by：1=管理端抽，'revenue-plugin'=插件推送）——推送前的这一份是
--   平台结算当时用过的天气与系数，推送后会被覆盖，故必须在推送前抓。
SELECT match_id, club_id, season, tournament_id, round, weather, wx_coef, forecast_by, created_at
FROM match_weather
WHERE season >= 9
ORDER BY season, tournament_id, round, match_id;

-- C 已结算上座行（本批的订正对象；存在即已结算，取消场不写此表）
SELECT match_id, club_id, season, window_seq, weather, attendance, ticket, commercial, broadcast, created_at
FROM match_attendance
WHERE season >= 9
ORDER BY season, window_seq, match_id;

-- D 球场现状（容量/档次/影响/球迷；fans 与 fans_window_start 供报告口径说明，不参与系数比缩放）
SELECT club_id, capacity, tier, shell_influence, bonus_points, fans, next_attendance_mod, next_weather, fans_window_start
FROM stadiums
ORDER BY club_id;

-- E 商业/转播设施等级（结算时点值已不可考，仅作报告参考；缩放法不改等级）
SELECT club_id, facility_key, level
FROM club_facilities
WHERE facility_key IN ('commercial', 'broadcast')
ORDER BY club_id, facility_key;

-- F 账本余额（订正分录的 balance_after 链起点）
SELECT club_id, balance, updated_at
FROM ledger_accounts
ORDER BY club_id;

-- G 比赛日收入与相关奖金流水（找 canonical 锚：kind='revenue' / ref_type='match' / ref_id=match_id）
SELECT id, club_id, kind, amount, balance_after, ref_type, ref_id, memo, created_at
FROM ledger_entries
WHERE (kind = 'revenue' AND ref_type = 'match')
   OR (kind = 'prize' AND ref_type IN ('match_home', 'match_away', 'match_home_fix', 'match_away_fix'))
   OR ref_type IN ('wo_rollback_prize', 'wo_rollback_revenue')
ORDER BY id;

-- H 赛果确认快照（队名/轮次/弃权/胜者；本轮为报告与范围判定的权威名单）
SELECT match_id, season, window_seq, tournament_id, competition_type, stage_name, round,
       home_team, away_team, score_home, score_away, walkover_side, winner_team, confirmed_at
FROM result_confirmations
WHERE season >= 9
ORDER BY season, round, match_id;

-- I 生效中的主场系数表（weather_ranges 是期望中性归一的唯一真源——生产配置可能覆盖代码默认值，
--   故中点必须读这一份，不能直接吃 src/core/config.ts 的默认）
SELECT key, value, updated_at
FROM config
WHERE key = 'attendance_model';
