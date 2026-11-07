-- 03-sign-city.sql · 曼城(10)签 10 人(S9/W2,source='import')
-- 工资/违约金拟议值(可执行前调整):合计 wage 22.9 m / RC 315 m;帽 58,占 39%
-- 幂等:players 守卫 status='free';contracts NOT EXISTS;audit NOT EXISTS。重跑零改行。

-- ===== Bruno Fernandes 38(CM,CA87,bCA87 占 🟡)wage 4.5 / RC 50 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 38 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 38, 10, 50, 4.5, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 38 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 38,
  '{"club_id":null,"status":"free","ca":87}',
  '{"club_id":10,"status":"normal","ca":87,"wage":4.5,"release_fee":50}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=38);

-- ===== Mile Svilar 137(GK,CA84,PA87 占 🟢)wage 3.0 / RC 40 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 137 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 137, 10, 40, 3.0, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 137 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 137,
  '{"club_id":null,"status":"free","ca":84}',
  '{"club_id":10,"status":"normal","ca":84,"wage":3.0,"release_fee":40}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=137);

-- ===== Exequiel Palacios 110(CM,CA84)wage 2.6 / RC 40 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 110 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 110, 10, 40, 2.6, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 110 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 110,
  '{"club_id":null,"status":"free","ca":84}',
  '{"club_id":10,"status":"normal","ca":84,"wage":2.6,"release_fee":40}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=110);

-- ===== Dejan Kulusevski 161(CM,CA83)wage 2.5 / RC 35 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 161 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 161, 10, 35, 2.5, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 161 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 161,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":10,"status":"normal","ca":83,"wage":2.5,"release_fee":35}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=161);

-- ===== Alexander Sørloth 149(ST,CA83)wage 2.4 / RC 35 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 149 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 149, 10, 35, 2.4, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 149 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 149,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":10,"status":"normal","ca":83,"wage":2.4,"release_fee":35}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=149);

-- ===== Jean-Philippe Mateta 206(ST,CA82)wage 2.1 / RC 30 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 206 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 206, 10, 30, 2.1, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 206 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 206,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":10,"status":"normal","ca":82,"wage":2.1,"release_fee":30}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=206);

-- ===== Yannick Carrasco 284(LW,CA81)wage 1.9 / RC 25 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 284 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 284, 10, 25, 1.9, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 284 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 284,
  '{"club_id":null,"status":"free","ca":81}',
  '{"club_id":10,"status":"normal","ca":81,"wage":1.9,"release_fee":25}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=284);

-- ===== Maxim De Cuyper 465(LB,CA80)wage 1.6 / RC 20 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 465 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 465, 10, 20, 1.6, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 465 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 465,
  '{"club_id":null,"status":"free","ca":80}',
  '{"club_id":10,"status":"normal","ca":80,"wage":1.6,"release_fee":20}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=465);

-- ===== Carlos Romero 756(LB,CA78)wage 1.3 / RC 12 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 756 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 756, 10, 12, 1.3, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 756 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 756,
  '{"club_id":null,"status":"free","ca":78}',
  '{"club_id":10,"status":"normal","ca":78,"wage":1.3,"release_fee":12}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=756);

-- ===== Joel Ordoñez 1335(CB,CA76,PA87 占 🟢)wage 1.0 / RC 8 =====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1335 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 1335, 10, 8, 1.0, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 1335 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 1335,
  '{"club_id":null,"status":"free","ca":76}',
  '{"club_id":10,"status":"normal","ca":76,"wage":1.0,"release_fee":8}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=1335);
