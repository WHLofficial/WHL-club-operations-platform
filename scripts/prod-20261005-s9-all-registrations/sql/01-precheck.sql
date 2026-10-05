-- 预检（只读）：期望 clubs_n=20 / roster_now=570 / trainee_contracts_now=69 / registrations_now=0 / status 全 normal
-- config 段是当前开关与豁免状态：写批前 squads_include_trainee 必须已为 true（顺序铁律，见 README §2）
SELECT season FROM seasons WHERE status = 'preparing' ORDER BY season DESC LIMIT 1;
SELECT COUNT(*) AS preparing_n FROM seasons WHERE status = 'preparing';
SELECT COUNT(*) AS clubs_n FROM clubs;
SELECT COUNT(*) AS roster_now FROM players WHERE club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681) AND status IN ('normal', 'listed');
SELECT COUNT(*) AS trainee_contracts_now FROM players p JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 AND ct.contract_type = 'trainee' WHERE p.club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681);
SELECT COUNT(*) AS registrations_now FROM registrations WHERE season = 9 AND club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681);
SELECT COUNT(*) AS registrations_season FROM registrations WHERE season = 9;
SELECT status, COUNT(*) AS n FROM players WHERE club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681) GROUP BY status;
SELECT key, value FROM config WHERE key IN ('squads_include_trainee', 'squad_min', 'squad_max', 'trainee_max', 'ca_pa_limits', 'registration_check_mode') ORDER BY key;
