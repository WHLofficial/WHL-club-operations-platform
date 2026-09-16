-- 增量 11（赛季结算域）：
-- seasons.age_cap            —— 可成长年龄上限（规则 4.1.1：大版本第 1/2/3+ 季 25/24/23 递减；建季时管理组直接填本季上限）
-- season_tournaments.stage_settled_at —— 赛事完结结算时点（一次性项幂等闸：入场奖金/资格赛保底/小组赛剩余池只发一次）
ALTER TABLE seasons ADD COLUMN age_cap INTEGER;
ALTER TABLE season_tournaments ADD COLUMN stage_settled_at TEXT;
-- 赛果快照补两队 tour team id（奖金入账按 id 走 AUTH_DB 目录映射 club_id，队名只做展示）
ALTER TABLE result_confirmations ADD COLUMN home_team_id INTEGER;
ALTER TABLE result_confirmations ADD COLUMN away_team_id INTEGER;
ALTER TABLE result_confirmations ADD COLUMN stage_kind TEXT; -- 完结结算区分小组赛/淘汰赛确认赛果
