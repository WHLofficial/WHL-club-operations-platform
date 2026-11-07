-- 02-sign-milan.sql · AC米兰(131681)签 14 人(S9/W2,source='import')
-- 工资/违约金拟议值(可执行前调整):合计 wage 31.5 m / RC 415 m;帽 68,占 46%
-- 幂等:players 守卫 status='free';contracts NOT EXISTS;audit NOT EXISTS。重跑零改行。

-- ===== Patrik Schick 70(ST,CA85)wage 3.5 / RC 50 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 70 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 70, 131681, 50, 3.5, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 70 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 70,
  '{"club_id":null,"status":"free","ca":85}',
  '{"club_id":131681,"status":"normal","ca":85,"wage":3.5,"release_fee":50}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=70);

-- ===== Marc-André ter Stegen 95(GK,CA85)wage 3.2 / RC 50 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 95 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 95, 131681, 50, 3.2, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 95 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 95,
  '{"club_id":null,"status":"free","ca":85}',
  '{"club_id":131681,"status":"normal","ca":85,"wage":3.2,"release_fee":50}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=95);

-- ===== Mateo Retegui 144(ST,CA83)wage 2.4 / RC 35 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 144 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 144, 131681, 35, 2.4, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 144 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 144,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83,"wage":2.4,"release_fee":35}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=144);

-- ===== Amir Rrahmani 183(CB,CA83)wage 2.4 / RC 35 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 183 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 183, 131681, 35, 2.4, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 183 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 183,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83,"wage":2.4,"release_fee":35}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=183);

-- ===== Stanislav Lobotka 166(CM,CA83)wage 2.3 / RC 35 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 166 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 166, 131681, 35, 2.3, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 166 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 166,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83,"wage":2.3,"release_fee":35}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=166);

-- ===== Pedro Gonçalves 154(LM 标签,打 CM,CA83)wage 2.2 / RC 30 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 154 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 154, 131681, 30, 2.2, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 154 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 154,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83,"wage":2.2,"release_fee":30}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=154);

-- ===== Daniel Muñoz 272(RB,CA82)wage 2.2 / RC 30 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 272 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 272, 131681, 30, 2.2, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 272 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 272,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":131681,"status":"normal","ca":82,"wage":2.2,"release_fee":30}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=272);

-- ===== Matthijs de Ligt 256(CB,CA82)wage 2.4 / RC 40 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 256 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 256, 131681, 40, 2.4, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 256 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 256,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":131681,"status":"normal","ca":82,"wage":2.4,"release_fee":40}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=256);

-- ===== Pierre-Emile Højbjerg 240(CDM,CA82)wage 2.0 / RC 25 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 240 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 240, 131681, 25, 2.0, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 240 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 240,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":131681,"status":"normal","ca":82,"wage":2.0,"release_fee":25}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=240);

-- ===== Carlos Augusto 341(LB,CA81)wage 2.0 / RC 30 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 341 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 341, 131681, 30, 2.0, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 341 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 341,
  '{"club_id":null,"status":"free","ca":81}',
  '{"club_id":131681,"status":"normal","ca":81,"wage":2.0,"release_fee":30}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=341);

-- ===== Dušan Vlahović 291(ST,CA81)wage 2.2 / RC 35 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 291 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 291, 131681, 35, 2.2, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 291 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 291,
  '{"club_id":null,"status":"free","ca":81}',
  '{"club_id":131681,"status":"normal","ca":81,"wage":2.2,"release_fee":35}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=291);

-- ===== Noussair Mazraoui 494(RB,CA80)wage 1.7 / RC 25 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 494 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 494, 131681, 25, 1.7, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 494 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 494,
  '{"club_id":null,"status":"free","ca":80}',
  '{"club_id":131681,"status":"normal","ca":80,"wage":1.7,"release_fee":25}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=494);

-- ===== Ismaël Bennacer 452(CDM,CA80)wage 1.6 / RC 20 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 452 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 452, 131681, 20, 1.6, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 452 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 452,
  '{"club_id":null,"status":"free","ca":80}',
  '{"club_id":131681,"status":"normal","ca":80,"wage":1.6,"release_fee":20}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=452);

-- ===== Robin Gosens 579(LB/LWB,CA79)wage 1.4 / RC 15 =====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 579 AND club_id IS NULL AND status = 'free';
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source, signed_at, effective_from, is_active, service_ticks, protection_ticks, signed_season, signed_window_seq, free_rc_change_used)
SELECT 579, 131681, 15, 1.4, 'formal', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%d', 'now'), 1, 0, 4, 9, 2, 0
WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = 579 AND is_active = 1);
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 579,
  '{"club_id":null,"status":"free","ca":79}',
  '{"club_id":131681,"status":"normal","ca":79,"wage":1.4,"release_fee":15}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=579);
