-- 01-release.sql · 解约 5 人(规则 4.4.4 全口径,src/worker/transfers.ts:1236 同源)
-- Hu Hetao 13232(131681)/ Liberali 9443(131681)/ Müller 1791(10)/ Alleyne 9390(10)/ Skov Olsen 1238(10)
-- 幂等:players 带归属+状态守卫,重跑 changes=0;growth_events OR IGNORE;audit NOT EXISTS。

-- ===== Hu Hetao 13232(131681 → free,CA 68 回 base_ca 62)=====
UPDATE players SET club_id = NULL, status = 'free', number = NULL, ca = COALESCE(base_ca, ca),
  growth_xp = 0, levels_applied = 0,
  transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
  not_for_sale = 0, transfer_listed_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 13232 AND club_id = 131681 AND status IN ('normal','listed');
UPDATE contracts SET is_active = 0 WHERE player_id = 13232 AND is_active = 1;
DELETE FROM player_playstyles WHERE player_id = 13232;
INSERT OR IGNORE INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
VALUES (13232, 'termination:cpu-squad-fill-20261108', 9, 2, 'reset', 0, 0, 'auto', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_release', 'player', 13232,
  '{"club_id":131681,"status":"normal","ca":68,"number":12}',
  '{"club_id":null,"status":"free","ca":62,"number":null}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_release' AND target_type='player' AND target_id=13232);

-- ===== Mattia Liberali 9443(131681 → free,CA 69 回 base_ca 65)=====
UPDATE players SET club_id = NULL, status = 'free', number = NULL, ca = COALESCE(base_ca, ca),
  growth_xp = 0, levels_applied = 0,
  transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
  not_for_sale = 0, transfer_listed_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 9443 AND club_id = 131681 AND status IN ('normal','listed');
UPDATE contracts SET is_active = 0 WHERE player_id = 9443 AND is_active = 1;
DELETE FROM player_playstyles WHERE player_id = 9443;
INSERT OR IGNORE INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
VALUES (9443, 'termination:cpu-squad-fill-20261108', 9, 2, 'reset', 0, 0, 'auto', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_release', 'player', 9443,
  '{"club_id":131681,"status":"normal","ca":69,"number":24}',
  '{"club_id":null,"status":"free","ca":65,"number":null}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_release' AND target_type='player' AND target_id=9443);

-- ===== Marius Müller 1791(10 → free,CA 75 = base_ca)=====
UPDATE players SET club_id = NULL, status = 'free', number = NULL, ca = COALESCE(base_ca, ca),
  growth_xp = 0, levels_applied = 0,
  transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
  not_for_sale = 0, transfer_listed_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1791 AND club_id = 10 AND status IN ('normal','listed');
UPDATE contracts SET is_active = 0 WHERE player_id = 1791 AND is_active = 1;
DELETE FROM player_playstyles WHERE player_id = 1791;
INSERT OR IGNORE INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
VALUES (1791, 'termination:cpu-squad-fill-20261108', 9, 2, 'reset', 0, 0, 'auto', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_release', 'player', 1791,
  '{"club_id":10,"status":"normal","ca":75,"number":12}',
  '{"club_id":null,"status":"free","ca":75,"number":null}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_release' AND target_type='player' AND target_id=1791);

-- ===== Max Alleyne 9390(10 → free,CA 66 = base_ca)=====
UPDATE players SET club_id = NULL, status = 'free', number = NULL, ca = COALESCE(base_ca, ca),
  growth_xp = 0, levels_applied = 0,
  transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
  not_for_sale = 0, transfer_listed_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 9390 AND club_id = 10 AND status IN ('normal','listed');
UPDATE contracts SET is_active = 0 WHERE player_id = 9390 AND is_active = 1;
DELETE FROM player_playstyles WHERE player_id = 9390;
INSERT OR IGNORE INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
VALUES (9390, 'termination:cpu-squad-fill-20261108', 9, 2, 'reset', 0, 0, 'auto', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_release', 'player', 9390,
  '{"club_id":10,"status":"normal","ca":66,"number":68}',
  '{"club_id":null,"status":"free","ca":66,"number":null}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_release' AND target_type='player' AND target_id=9390);

-- ===== Andreas Skov Olsen 1238(10 → free,CA 76 = base_ca)=====
UPDATE players SET club_id = NULL, status = 'free', number = NULL, ca = COALESCE(base_ca, ca),
  growth_xp = 0, levels_applied = 0,
  transfer_listed = 0, list_price = NULL, min_offer_price = NULL, offer_auto = 0,
  not_for_sale = 0, transfer_listed_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1238 AND club_id = 10 AND status IN ('normal','listed');
UPDATE contracts SET is_active = 0 WHERE player_id = 1238 AND is_active = 1;
DELETE FROM player_playstyles WHERE player_id = 1238;
INSERT OR IGNORE INTO growth_events (player_id, match_ref, season, window_seq, event_type, value, xp, source, recorded_by, created_at)
VALUES (1238, 'termination:cpu-squad-fill-20261108', 9, 2, 'reset', 0, 0, 'auto', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO audit_log (actor, action, target_type, target_id, before, after, at, origin)
SELECT NULL, 'cpu_squad_fill_release', 'player', 1238,
  '{"club_id":10,"status":"normal","ca":76,"number":7}',
  '{"club_id":null,"status":"free","ca":76,"number":null}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backchannel'
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='cpu_squad_fill_release' AND target_type='player' AND target_id=1238);
