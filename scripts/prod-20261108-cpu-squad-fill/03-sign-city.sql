-- 03-sign-city.sql · 曼城(10)签 10 人(S9/W2)
-- 口径:CPU 队球员全员无合同(生产实测 2026-11-08:两支 CPU 队 contracts=0,18 支真人队 22-37 份),
--       新签 10 人同样不落 contracts 行;工资帽/违约金/海捞费均不适用。
-- 幂等:players 守卫 status='free';audit NOT EXISTS。重跑零改行。

-- ===== Bruno Fernandes 38(CM,CA87,bCA87 占 🟡)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 38 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 38,
  '{"club_id":null,"status":"free","ca":87}',
  '{"club_id":10,"status":"normal","ca":87}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=38);

-- ===== Mile Svilar 137(GK,CA84,PA87 占 🟢)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 137 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 137,
  '{"club_id":null,"status":"free","ca":84}',
  '{"club_id":10,"status":"normal","ca":84}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=137);

-- ===== Exequiel Palacios 110(CM,CA84)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 110 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 110,
  '{"club_id":null,"status":"free","ca":84}',
  '{"club_id":10,"status":"normal","ca":84}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=110);

-- ===== Dejan Kulusevski 161(CM,CA83)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 161 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 161,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":10,"status":"normal","ca":83}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=161);

-- ===== Alexander Sørloth 149(ST,CA83)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 149 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 149,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":10,"status":"normal","ca":83}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=149);

-- ===== Jean-Philippe Mateta 206(ST,CA82)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 206 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 206,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":10,"status":"normal","ca":82}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=206);

-- ===== Yannick Carrasco 284(LW,CA81)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 284 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 284,
  '{"club_id":null,"status":"free","ca":81}',
  '{"club_id":10,"status":"normal","ca":81}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=284);

-- ===== Maxim De Cuyper 465(LB,CA80)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 465 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 465,
  '{"club_id":null,"status":"free","ca":80}',
  '{"club_id":10,"status":"normal","ca":80}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=465);

-- ===== Carlos Romero 756(LB,CA78)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 756 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 756,
  '{"club_id":null,"status":"free","ca":78}',
  '{"club_id":10,"status":"normal","ca":78}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=756);

-- ===== Joel Ordoñez 1335(CB,CA76,PA87 占 🟢)=====
UPDATE players SET club_id = 10, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1335 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 1335,
  '{"club_id":null,"status":"free","ca":76}',
  '{"club_id":10,"status":"normal","ca":76}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=1335);
