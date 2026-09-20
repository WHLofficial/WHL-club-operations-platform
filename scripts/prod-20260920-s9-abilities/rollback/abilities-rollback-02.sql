-- S9 能力导入（回滚）分片 02
-- 生成器 scripts/prod-20260920-s9-abilities/gen-abilities-sql.ts；生成时点 2026-09-20T15:59:02.880Z
-- 覆盖第 201-257 条语句（共 257 条）；源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 守卫：WHERE fc_id = ? AND ca = '新' AND pa = ... ⇒ 重复执行 changes = 0
-- 回滚把 ca/pa 与「本批动过的槽位」还原为导入前的值（未动过的字段不在语句里）
-- 77573 Li Hao
UPDATE players SET ca = 63, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 77573 AND ca = 67 AND pa = 76;
-- 260823 N. Fagioli
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260823 AND ca = 78 AND pa = 81;
-- 259031 L. Delap
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259031 AND ca = 80 AND pa = 85;
-- 264492 Yeremay
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264492 AND ca = 78 AND pa = 84;
-- 275507 M. Sarr
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.PSID1', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 275507 AND ca = 77 AND pa = 84;
-- 71651 J. Acheampong
UPDATE players SET ca = 73, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.PSID1', 0, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 71651 AND ca = 75 AND pa = 85;
-- 71998 T. George
UPDATE players SET ca = 71, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 71998 AND ca = 72 AND pa = 84;
-- 76687 Estêvão
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL, '$.PSID5', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 76687 AND ca = 81 AND pa = 89;
-- 246147 M. Greenwood
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246147 AND ca = 85 AND pa = 87;
-- 273018 Andrey Santos
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL, '$.PSID5', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 273018 AND ca = 83 AND pa = 87;
-- 252042 João Pedro
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 252042 AND ca = 84 AND pa = 84;
-- 262859 L. Colwill
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262859 AND ca = 82 AND pa = 84;
-- 272978 J. Hato
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272978 AND ca = 80 AND pa = 88;
-- 270821 M. Penders
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL, '$.PSID1', 0, '$.PSID2', 0, '$.PSID3', 0, '$.PSID4', 0, '$.PSID5', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 270821 AND ca = 81 AND pa = 86;
-- 268438 A. Garnacho
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 268438 AND ca = 81 AND pa = 84;
-- 261530 Dário Essugo
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 261530 AND ca = 78 AND pa = 83;
-- 238616 Pedro Neto
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 238616 AND ca = 84 AND pa = 84;
-- 246875 O. Kossounou
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246875 AND ca = 83 AND pa = 85;
-- 247827 M. Olise
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247827 AND ca = 88 AND pa = 89;
-- 246104 R. Gravenberch
UPDATE players SET ca = 86, game_attrs = json_set(game_attrs, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246104 AND ca = 87 AND pa = 89;
-- 243715 W. Saliba
UPDATE players SET ca = 88, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.reactions', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243715 AND ca = 89 AND pa = 90;
-- 246420 J. Doku
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246420 AND ca = 84 AND pa = 86;
-- 257289 H. Ekitiké
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257289 AND ca = 85 AND pa = 88;
-- 272926 L. Bergvall
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272926 AND ca = 81 AND pa = 87;
-- 238074 R. James
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.crossing', NULL, '$.reactions', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 238074 AND ca = 84 AND pa = 85;
-- 260908 M. Kerkez
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.PSID4', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260908 AND ca = 83 AND pa = 85;
-- 259307 M. Gusto
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259307 AND ca = 81 AND pa = 84;
-- 235152 F. Kadıoğlu
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.interceptions', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 235152 AND ca = 80 AND pa = 81;
-- 262138 C. Lukeba
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262138 AND ca = 81 AND pa = 88;
-- 259516 Johnny Cardoso
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.longpassing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259516 AND ca = 82 AND pa = 86;
-- 72997 Rodrigo Mora
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.RoleID5', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 72997 AND ca = 81 AND pa = 89;
-- 70004 S. Mayulu
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 70004 AND ca = 78 AND pa = 86;
-- 252145 Nuno Mendes
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 252145 AND ca = 89 AND pa = 90;
-- 272834 João Neves
UPDATE players SET ca = 86, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL, '$.RoleID5', 0, '$.PSID6', 0, '$.PSID7', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272834 AND ca = 88 AND pa = 91;
-- 246191 J. Alvarez
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246191 AND ca = 88 AND pa = 90;
-- 246863 F. Nmecha
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246863 AND ca = 85 AND pa = 86;
-- 257534 C. Palmer
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257534 AND ca = 88 AND pa = 90;
-- 234577 Diogo Costa
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL, '$.PSID4', 0, '$.PSID5', 0, '$.PSID6', 0, '$.PSID13', 0, '$.PSID14', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 234577 AND ca = 86 AND pa = 89;
-- 243014 B. Mbeumo
UPDATE players SET ca = 85, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243014 AND ca = 86 AND pa = 86;
-- 241461 Ferran Torres
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL, '$.RoleID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241461 AND ca = 86 AND pa = 86;
-- 256675 O. Marmoush
UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256675 AND ca = 83 AND pa = 84;
-- 251809 S. Botman
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.RoleID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251809 AND ca = 84 AND pa = 85;
-- 269087 L. Yoro
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.RoleID4', 0, '$.PSID13', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269087 AND ca = 81 AND pa = 86;
-- 244675 Sancet
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.RoleID5', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 244675 AND ca = 84 AND pa = 88;
-- 270673 W. Zaïre-Emery
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL, '$.PSID6', 0, '$.PSID7', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 270673 AND ca = 83 AND pa = 87;
-- 227678 E. Konsa
UPDATE players SET game_attrs = json_set(game_attrs, '$.RoleID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 227678 AND ca = 83 AND pa = 84;
-- 258498 B. Verbruggen
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 258498 AND ca = 81 AND pa = 85;
-- 248465 I. Maatsen
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.crossing', NULL, '$.reactions', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 248465 AND ca = 80 AND pa = 84;
-- 270857 Mateus Fernandes
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 270857 AND ca = 79 AND pa = 85;
-- 275138 L. Camara
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 275138 AND ca = 79 AND pa = 85;
-- 264453 M. van de Ven
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264453 AND ca = 84 AND pa = 86;
-- 236772 D. Szoboszlai
UPDATE players SET ca = 85, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 236772 AND ca = 87 AND pa = 87;
-- 262621 G. Mamardashvili
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262621 AND ca = 85 AND pa = 87;
-- 77940 Zhang Haoran
UPDATE players SET ca = 48, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 77940 AND ca = 56 AND pa = 61;
-- 273651 J. Quansah
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 273651 AND ca = 77 AND pa = 83;
-- 247172 J. Durán
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.ballcontrol', NULL, '$.headingaccuracy', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247172 AND ca = 80 AND pa = 85;
-- 279044 Geovany Quenda
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL, '$.PSID5', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 279044 AND ca = 78 AND pa = 88;
