-- 验收（只读）：期望 registrations_now=570 / trainee_rows=69 / first_team_rows=501 / players：normal 501 + trainee 69 / stray_rows=0
SELECT COUNT(*) AS registrations_now FROM registrations WHERE season = 9 AND club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681);
SELECT COUNT(*) AS trainee_rows FROM registrations WHERE season = 9 AND club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681) AND squad = 'trainee';
SELECT COUNT(*) AS first_team_rows FROM registrations WHERE season = 9 AND club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681) AND squad = 'first_team';
SELECT club_id, COUNT(*) AS total, SUM(squad = 'trainee') AS trainee, SUM(squad = 'first_team') AS first_team FROM registrations WHERE season = 9 AND club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681) GROUP BY club_id ORDER BY club_id;
SELECT status, COUNT(*) AS n FROM players WHERE club_id IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681) GROUP BY status;
SELECT COUNT(*) AS stray_rows FROM registrations WHERE season != 9 OR club_id NOT IN (1, 2, 5, 9, 10, 11, 13, 14, 21, 33, 45, 66, 73, 241, 243, 280, 449, 110374, 112172, 131681);
