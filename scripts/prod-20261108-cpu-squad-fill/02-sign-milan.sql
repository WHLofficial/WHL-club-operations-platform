-- 02-sign-milan.sql · AC米兰(131681)签 14 人(S9/W2)
-- 口径:CPU 队球员全员无合同(生产实测 2026-11-08:两支 CPU 队 contracts=0,18 支真人队 22-37 份),
--       新签 14 人同样不落 contracts 行;工资帽/违约金/海捞费均不适用。
-- 幂等:players 守卫 status='free';audit NOT EXISTS。重跑零改行。

-- ===== Patrik Schick 70(ST,CA85)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 70 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 70,
  '{"club_id":null,"status":"free","ca":85}',
  '{"club_id":131681,"status":"normal","ca":85}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=70);

-- ===== Marc-André ter Stegen 95(GK,CA85)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 95 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 95,
  '{"club_id":null,"status":"free","ca":85}',
  '{"club_id":131681,"status":"normal","ca":85}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=95);

-- ===== Mateo Retegui 144(ST,CA83)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 144 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 144,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=144);

-- ===== Amir Rrahmani 183(CB,CA83)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 183 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 183,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=183);

-- ===== Stanislav Lobotka 166(CM,CA83)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 166 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 166,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=166);

-- ===== Pedro Gonçalves 154(LM 标签,打 CM,CA83)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 154 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 154,
  '{"club_id":null,"status":"free","ca":83}',
  '{"club_id":131681,"status":"normal","ca":83}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=154);

-- ===== Daniel Muñoz 272(RB,CA82)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 272 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 272,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":131681,"status":"normal","ca":82}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=272);

-- ===== Matthijs de Ligt 256(CB,CA82)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 256 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 256,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":131681,"status":"normal","ca":82}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=256);

-- ===== Pierre-Emile Højbjerg 240(CDM,CA82)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 240 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 240,
  '{"club_id":null,"status":"free","ca":82}',
  '{"club_id":131681,"status":"normal","ca":82}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=240);

-- ===== Carlos Augusto 341(LB,CA81)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 341 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 341,
  '{"club_id":null,"status":"free","ca":81}',
  '{"club_id":131681,"status":"normal","ca":81}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=341);

-- ===== Dušan Vlahović 291(ST,CA81)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 291 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 291,
  '{"club_id":null,"status":"free","ca":81}',
  '{"club_id":131681,"status":"normal","ca":81}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=291);

-- ===== Noussair Mazraoui 494(RB,CA80)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 494 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 494,
  '{"club_id":null,"status":"free","ca":80}',
  '{"club_id":131681,"status":"normal","ca":80}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=494);

-- ===== Ismaël Bennacer 452(CDM,CA80)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 452 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 452,
  '{"club_id":null,"status":"free","ca":80}',
  '{"club_id":131681,"status":"normal","ca":80}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=452);

-- ===== Robin Gosens 579(LB/LWB,CA79)=====
UPDATE players SET club_id = 131681, status = 'normal', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 579 AND club_id IS NULL AND status = 'free';
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_sign', 'player', 579,
  '{"club_id":null,"status":"free","ca":79}',
  '{"club_id":131681,"status":"normal","ca":79}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_sign' AND target_type='player' AND target_id=579);
