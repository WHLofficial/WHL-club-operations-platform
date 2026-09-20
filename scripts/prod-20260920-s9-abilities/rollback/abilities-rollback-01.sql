-- S9 能力导入（回滚）分片 01
-- 生成器 scripts/prod-20260920-s9-abilities/gen-abilities-sql.ts；生成时点 2026-09-20T15:59:02.880Z
-- 覆盖第 1-200 条语句（共 257 条）；源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 守卫：WHERE fc_id = ? AND ca = '新' AND pa = ... ⇒ 重复执行 changes = 0
-- 回滚把 ca/pa 与「本批动过的槽位」还原为导入前的值（未动过的字段不在语句里）
-- 277225 Jon Martín
UPDATE players SET ca = 73, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277225 AND ca = 76 AND pa = 84;
-- 269186 O. Óskarsson
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269186 AND ca = 76 AND pa = 80;
-- 272455 Pablo Marín
UPDATE players SET ca = 73, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272455 AND ca = 75 AND pa = 82;
-- 264701 A. Zakharyan
UPDATE players SET ca = 73, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264701 AND ca = 75 AND pa = 81;
-- 264862 M. Akliouche
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264862 AND ca = 83 AND pa = 86;
-- 266096 Tomás Araújo
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 266096 AND ca = 82 AND pa = 86;
-- 239977 N. Kühn
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 239977 AND ca = 79 AND pa = 81;
-- 241811 Sergio Gómez
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241811 AND ca = 80 AND pa = 82;
-- 70888 A. Khalaili
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 70888 AND ca = 78 AND pa = 86;
-- 277689 C. Harder
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277689 AND ca = 76 AND pa = 85;
-- 261865 Miguel Gutiérrez
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 261865 AND ca = 83 AND pa = 85;
-- 277031 A. Khusanov
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277031 AND ca = 80 AND pa = 86;
-- 251566 Gabriel Martinelli
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251566 AND ca = 82 AND pa = 84;
-- 270409 Savinho
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 270409 AND ca = 83 AND pa = 86;
-- 260599 A. Varela
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260599 AND ca = 82 AND pa = 85;
-- 277427 N. O'Reilly
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277427 AND ca = 79 AND pa = 85;
-- 71351 J. Mokio
UPDATE players SET ca = 69, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 71351 AND ca = 71 AND pa = 88;
-- 243702 D. Spence
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243702 AND ca = 81 AND pa = 83;
-- 76624 Vitor Reis
UPDATE players SET ca = 71, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 76624 AND ca = 74 AND pa = 84;
-- 72159 M. Moore
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 72159 AND ca = 73 AND pa = 86;
-- 245155 M. Kudus
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 245155 AND ca = 82 AND pa = 83;
-- 274445 K. Konaté
UPDATE players SET ca = 71, game_attrs = json_set(game_attrs, '$.finishing', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 274445 AND ca = 72 AND pa = 83;
-- 256079 M. Caicedo
UPDATE players SET ca = 88, game_attrs = json_set(game_attrs, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256079 AND ca = 89 AND pa = 90;
-- 246669 B. Saka
UPDATE players SET ca = 88, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246669 AND ca = 89 AND pa = 90;
-- 260592 B. Šeško
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL, '$.PSID7', 0, '$.PSID8', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260592 AND ca = 88 AND pa = 88;
-- 257179 Gonçalo Inácio
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257179 AND ca = 86 AND pa = 86;
-- 256516 Nico Williams
UPDATE players SET ca = 86, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256516 AND ca = 88 AND pa = 89;
-- 272500 C. Baleba
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.interceptions', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272500 AND ca = 81 AND pa = 86;
-- 251854 Pedri
UPDATE players SET ca = 89, game_attrs = json_set(game_attrs, '$.shortpassing', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251854 AND ca = 90 AND pa = 93;
-- 273906 Renato Veiga
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 273906 AND ca = 79 AND pa = 84;
-- 278340 P. Comuzzo
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 278340 AND ca = 78 AND pa = 86;
-- 275291 N. Pisilli
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 275291 AND ca = 75 AND pa = 84;
-- 266041 L. Koleosho
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 266041 AND ca = 75 AND pa = 79;
-- 276682 C. Ndour
UPDATE players SET ca = 70, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 276682 AND ca = 74 AND pa = 83;
-- 271575 S. Pafundi
UPDATE players SET ca = 68, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 271575 AND ca = 72 AND pa = 84;
-- 76396 A. Natali
UPDATE players SET ca = 60, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 76396 AND ca = 64 AND pa = 82;
-- 77786 Li Ruiyue
UPDATE players SET ca = 48, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 77786 AND ca = 56 AND pa = 63;
-- 252154 M. Carnesecchi
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL, '$.PSID2', 0, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 252154 AND ca = 86 AND pa = 88;
-- 251517 J. Gvardiol
UPDATE players SET ca = 85, game_attrs = json_set(game_attrs, '$.standingtackle', NULL, '$.RoleID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251517 AND ca = 86 AND pa = 88;
-- 257279 Álex Baena
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL, '$.PSID8', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257279 AND ca = 86 AND pa = 88;
-- 241852 M. Diaby
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241852 AND ca = 85 AND pa = 85;
-- 236610 M. Kean
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL, '$.PSID4', 0, '$.PSID5', 0, '$.PSID6', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 236610 AND ca = 84 AND pa = 86;
-- 236987 B. Kamara
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.longpassing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.PSID2', 0, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 236987 AND ca = 84 AND pa = 85;
-- 257057 A. Onana
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.interceptions', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257057 AND ca = 81 AND pa = 83;
-- 233731 A. Isak
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 233731 AND ca = 88 AND pa = 88;
-- 256197 P. Hincapié
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256197 AND ca = 85 AND pa = 89;
-- 264240 Gavi
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL, '$.PSID4', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264240 AND ca = 85 AND pa = 87;
-- 247090 E. Fernández
UPDATE players SET ca = 85, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247090 AND ca = 87 AND pa = 88;
-- 251852 K. Adeyemi
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251852 AND ca = 84 AND pa = 86;
-- 257711 R. Calafiori
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257711 AND ca = 83 AND pa = 85;
-- 263620 R. Lavia
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 263620 AND ca = 80 AND pa = 85;
-- 241236 A. Semenyo
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241236 AND ca = 82 AND pa = 83;
-- 265526 G. Restes
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 265526 AND ca = 79 AND pa = 86;
-- 262118 T. Livramento
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262118 AND ca = 83 AND pa = 86;
-- 268737 S. Nypan
UPDATE players SET ca = 70, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 268737 AND ca = 73 AND pa = 86;
-- 256790 J. Musiala
UPDATE players SET ca = 88, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256790 AND ca = 90 AND pa = 92;
-- 266127 L. Hall
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.interceptions', NULL, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 266127 AND ca = 81 AND pa = 86;
-- 234396 A. Davies
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 234396 AND ca = 85 AND pa = 87;
-- 241159 M. Guéhi
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241159 AND ca = 84 AND pa = 85;
-- 242964 A. Gordon
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 242964 AND ca = 83 AND pa = 85;
-- 254117 M. Beier
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 254117 AND ca = 80 AND pa = 84;
-- 269136 K. Mainoo
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269136 AND ca = 79 AND pa = 85;
-- 74463 Marc Bernal
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 74463 AND ca = 77 AND pa = 86;
-- 263193 E. Bitshiabu
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 263193 AND ca = 76 AND pa = 87;
-- 255253 Vitinha
UPDATE players SET ca = 89, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 255253 AND ca = 91 AND pa = 91;
-- 243630 J. David
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.finishing', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243630 AND ca = 82 AND pa = 84;
-- 277179 Fermín
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277179 AND ca = 82 AND pa = 87;
-- 74094 M. Liberali
UPDATE players SET ca = 65, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.PSID1', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 74094 AND ca = 69 AND pa = 84;
-- 269476 Hu Hetao
UPDATE players SET ca = 62, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269476 AND ca = 68 AND pa = 73;
-- 279202 F. Camarda
UPDATE players SET ca = 65, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL, '$.PSID1', 0, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 279202 AND ca = 68 AND pa = 87;
-- 251470 C. De Ketelaere
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251470 AND ca = 83 AND pa = 86;
-- 259583 D. Udogie
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259583 AND ca = 81 AND pa = 84;
-- 72093 Martim Fernandes
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 72093 AND ca = 77 AND pa = 85;
-- 269859 A. Vermeeren
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269859 AND ca = 78 AND pa = 87;
-- 264309 A. Güler
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264309 AND ca = 84 AND pa = 89;
-- 263578 Balde
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.PSID4', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 263578 AND ca = 85 AND pa = 87;
-- 272449 Pablo Barrios
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272449 AND ca = 85 AND pa = 88;
-- 256853 M. Tillman
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256853 AND ca = 85 AND pa = 87;
-- 239085 E. Haaland
UPDATE players SET ca = 91, pa = 93, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 239085 AND ca = 94 AND pa = 95;
-- 253149 J. Frimpong
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 253149 AND ca = 84 AND pa = 85;
-- 278016 Murillo
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 278016 AND ca = 84 AND pa = 86;
-- 257470 A. Elanga
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257470 AND ca = 82 AND pa = 83;
-- 244067 M. Lacroix
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 244067 AND ca = 83 AND pa = 83;
-- 268896 H. Larsson
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 268896 AND ca = 79 AND pa = 86;
-- 241436 C. Bassey
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241436 AND ca = 79 AND pa = 81;
-- 259714 M. Röhl
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259714 AND ca = 76 AND pa = 82;
-- 243580 L. Openda
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.finishing', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243580 AND ca = 83 AND pa = 84;
-- 245367 X. Simons
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 245367 AND ca = 84 AND pa = 86;
-- 252371 J. Bellingham
UPDATE players SET ca = 90, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 252371 AND ca = 91 AND pa = 94;
-- 248243 E. Camavinga
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 248243 AND ca = 85 AND pa = 87;
-- 246606 Fran García
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 246606 AND ca = 79 AND pa = 80;
-- 231410 Brahim
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 231410 AND ca = 82 AND pa = 82;
-- 253306 M. Ugarte
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.longpassing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 253306 AND ca = 79 AND pa = 82;
-- 71178 S. El Mala
UPDATE players SET ca = 73, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 71178 AND ca = 75 AND pa = 86;
-- 276372 I. Ansah
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 276372 AND ca = 73 AND pa = 83;
-- 268259 N. Weiper
UPDATE players SET ca = 70, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 268259 AND ca = 71 AND pa = 84;
-- 78063 L. Karl
UPDATE players SET ca = 68, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 78063 AND ca = 70 AND pa = 86;
-- 247819 N. Schlotterbeck
UPDATE players SET ca = 86, game_attrs = json_set(game_attrs, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247819 AND ca = 87 AND pa = 88;
-- 241096 S. Tonali
UPDATE players SET ca = 86, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241096 AND ca = 88 AND pa = 88;
-- 275298 A. Pavlović
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 275298 AND ca = 83 AND pa = 87;
-- 256261 M. Thiaw
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256261 AND ca = 83 AND pa = 85;
-- 250959 A. Stiller
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 250959 AND ca = 85 AND pa = 87;
-- 254022 N. Woltemade
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 254022 AND ca = 82 AND pa = 85;
-- 269701 N. Brown
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269701 AND ca = 79 AND pa = 85;
-- 271114 D. Seimen
UPDATE players SET ca = 68, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 271114 AND ca = 74 AND pa = 84;
-- 244257 J. Burkardt
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 244257 AND ca = 84 AND pa = 85;
-- 266237 P. Wanner
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 266237 AND ca = 76 AND pa = 86;
-- 263765 T. Bischof
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 263765 AND ca = 79 AND pa = 86;
-- 258729 Gabri Veiga
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 258729 AND ca = 82 AND pa = 86;
-- 262881 R. Ríos
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262881 AND ca = 80 AND pa = 83;
-- 278780 F. Jeltsch
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 278780 AND ca = 76 AND pa = 87;
-- 258601 M. Sangaré
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 258601 AND ca = 78 AND pa = 84;
-- 271057 Gustavo Sá
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 271057 AND ca = 78 AND pa = 85;
-- 260926 K. Schade
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260926 AND ca = 80 AND pa = 83;
-- 257919 R. Reitz
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 257919 AND ca = 79 AND pa = 83;
-- 256500 N. Collins
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256500 AND ca = 76 AND pa = 84;
-- 278228 E. Baum
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 278228 AND ca = 74 AND pa = 84;
-- 276602 A. Ouédraogo
UPDATE players SET ca = 71, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 276602 AND ca = 75 AND pa = 86;
-- 256325 J. Šutalo
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256325 AND ca = 80 AND pa = 82;
-- 260815 Arnau Martínez
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260815 AND ca = 79 AND pa = 83;
-- 274288 O. Gloukh
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 274288 AND ca = 78 AND pa = 85;
-- 263370 V. Barco
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 263370 AND ca = 78 AND pa = 84;
-- 260952 A. Schjelderup
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260952 AND ca = 77 AND pa = 83;
-- 265774 K. De Winter
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 265774 AND ca = 75 AND pa = 84;
-- 277643 Lamine Yamal
UPDATE players SET ca = 89, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL, '$.PSID7', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277643 AND ca = 92 AND pa = 95;
-- 247635 K. Kvaratskhelia
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247635 AND ca = 89 AND pa = 90;
-- 251806 Q. Timber
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251806 AND ca = 81 AND pa = 85;
-- 268889 Álvaro Carreras
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 268889 AND ca = 82 AND pa = 88;
-- 270531 O. Diomande
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 270531 AND ca = 81 AND pa = 87;
-- 250753 A. Trubin
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.gkdiving', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 250753 AND ca = 81 AND pa = 87;
-- 254088 Amad
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.PSID2', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 254088 AND ca = 80 AND pa = 85;
-- 235243 M. de Ligt
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 235243 AND ca = 83 AND pa = 84;
-- 251805 J. Timber
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251805 AND ca = 85 AND pa = 87;
-- 242641 R. Aït-Nouri
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 242641 AND ca = 82 AND pa = 85;
-- 259868 P. Sarr
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259868 AND ca = 81 AND pa = 85;
-- 247649 J. Branthwaite
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247649 AND ca = 80 AND pa = 85;
-- 259913 G. Sudakov
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259913 AND ca = 81 AND pa = 87;
-- 274559 K. Páez
UPDATE players SET ca = 73, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 274559 AND ca = 74 AND pa = 84;
-- 279173 F. Mastantuono
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 279173 AND ca = 80 AND pa = 88;
-- 256630 F. Wirtz
UPDATE players SET ca = 88, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.PSID8', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256630 AND ca = 89 AND pa = 92;
-- 243812 Rodrygo
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL, '$.PSID6', 0, '$.PSID13', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243812 AND ca = 86 AND pa = 89;
-- 248550 Vivian
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 248550 AND ca = 86 AND pa = 87;
-- 241637 A. Tchouaméni
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 241637 AND ca = 85 AND pa = 87;
-- 278349 D. Huijsen
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL, '$.PSID13', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 278349 AND ca = 84 AND pa = 89;
-- 251752 L. Chevalier
UPDATE players SET ca = 83, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251752 AND ca = 85 AND pa = 88;
-- 215914 N. Kanté
UPDATE players SET game_attrs = json_set(game_attrs, '$.PSID3', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 215914 AND ca = 85 AND pa = 85;
-- 264846 Cristhian Mosquera
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.reactions', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264846 AND ca = 78 AND pa = 85;
-- 266160 Mika Mármol
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 266160 AND ca = 77 AND pa = 82;
-- 74209 Antoñito Cordero
UPDATE players SET ca = 69, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 74209 AND ca = 73 AND pa = 85;
-- 260443 S. Ibrahim
UPDATE players SET ca = 64, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 260443 AND ca = 65 AND pa = 72;
-- 77812 Xuan Zhijian
UPDATE players SET ca = 55, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 77812 AND ca = 60 AND pa = 71;
-- 258885 Luiz Júnior
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.reactions', NULL, '$.gkdiving', NULL, '$.gkhandling', NULL, '$.gkkicking', NULL, '$.gkpositioning', NULL, '$.gkreflexes', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 258885 AND ca = 80 AND pa = 83;
-- 278901 A. Bouaddi
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 278901 AND ca = 80 AND pa = 86;
-- 73885 C. Kostoulas
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL, '$.PSID1', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 73885 AND ca = 77 AND pa = 85;
-- 73884 C. Mouzakitis
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL, '$.PSID1', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 73884 AND ca = 77 AND pa = 86;
-- 242530 N. Okafor
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 242530 AND ca = 77 AND pa = 79;
-- 70497 K. Karetsas
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 70497 AND ca = 74 AND pa = 86;
-- 258781 I. Zabarnyi
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 258781 AND ca = 82 AND pa = 85;
-- 270077 K. Koulierakis
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 270077 AND ca = 78 AND pa = 85;
-- 271121 Q. Hartman
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 271121 AND ca = 78 AND pa = 83;
-- 242453 S. van den Berg
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 242453 AND ca = 78 AND pa = 83;
-- 275328 C. Uzun
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 275328 AND ca = 78 AND pa = 86;
-- 259377 Yeremy Pino
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 259377 AND ca = 81 AND pa = 88;
-- 264298 C. Bradley
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.slidingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264298 AND ca = 79 AND pa = 84;
-- 277295 O. Bobb
UPDATE players SET ca = 76, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277295 AND ca = 77 AND pa = 84;
-- 238794 Vini Jr.
UPDATE players SET ca = 89, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 238794 AND ca = 91 AND pa = 92;
-- 256196 W. Pacho
UPDATE players SET ca = 87, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256196 AND ca = 89 AND pa = 90;
-- 264652 B. Barcola
UPDATE players SET ca = 84, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.PSID4', 0), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264652 AND ca = 86 AND pa = 88;
-- 237692 P. Foden
UPDATE players SET ca = 85, game_attrs = json_set(game_attrs, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 237692 AND ca = 86 AND pa = 88;
-- 262088 H. Haraldsson
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262088 AND ca = 79 AND pa = 84;
-- 265450 J. Bakayoko
UPDATE players SET ca = 78, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 265450 AND ca = 79 AND pa = 85;
-- 279604 Jauregizar
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 279604 AND ca = 81 AND pa = 87;
-- 276471 Altimira
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.interceptions', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 276471 AND ca = 78 AND pa = 83;
-- 76739 Pablo García
UPDATE players SET ca = 70, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 76739 AND ca = 72 AND pa = 86;
-- 76740 Ángel Ortiz
UPDATE players SET ca = 70, game_attrs = json_set(game_attrs, '$.crossing', NULL, '$.reactions', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 76740 AND ca = 71 AND pa = 81;
-- 244778 Trincão
UPDATE players SET ca = 82, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 244778 AND ca = 83 AND pa = 84;
-- 252802 W. Singo
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.defensiveawareness', NULL, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 252802 AND ca = 81 AND pa = 85;
-- 256903 Gonçalo Ramos
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 256903 AND ca = 81 AND pa = 84;
-- 242444 João Félix
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.positioning', NULL, '$.vision', NULL, '$.shortpassing', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 242444 AND ca = 81 AND pa = 83;
-- 263205 B. Yılmaz
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 263205 AND ca = 81 AND pa = 83;
-- 243057 N. Williams
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.crossing', NULL, '$.reactions', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 243057 AND ca = 80 AND pa = 82;
-- 255475 Antony
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 255475 AND ca = 82 AND pa = 84;
-- 277211 Franculino
UPDATE players SET ca = 74, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277211 AND ca = 75 AND pa = 82;
-- 262027 T. Muharemović
UPDATE players SET ca = 72, game_attrs = json_set(game_attrs, '$.standingtackle', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 262027 AND ca = 73 AND pa = 79;
-- 74071 R. Floriani Mussolini
UPDATE players SET ca = 69, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 74071 AND ca = 70 AND pa = 77;
-- 75085 V. Adžić
UPDATE players SET ca = 67, game_attrs = json_set(game_attrs, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 75085 AND ca = 68 AND pa = 79;
-- 271421 D. Doué
UPDATE players SET ca = 85, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 271421 AND ca = 87 AND pa = 91;
-- 277954 K. Yıldız
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277954 AND ca = 84 AND pa = 89;
-- 272505 Endrick
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 272505 AND ca = 82 AND pa = 89;
-- 251570 R. Cherki
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 251570 AND ca = 83 AND pa = 88;
-- 264697 M. Amoura
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 264697 AND ca = 82 AND pa = 84;
-- 255001 N. Rovella
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 255001 AND ca = 82 AND pa = 84;
-- 247246 K. Thuram
UPDATE players SET ca = 81, game_attrs = json_set(game_attrs, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.interceptions', NULL, '$.standingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 247246 AND ca = 83 AND pa = 85;
-- 258966 A. Cambiaso
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.crossing', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.stamina', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 258966 AND ca = 82 AND pa = 82;
-- 265188 G. Scalvini
UPDATE players SET ca = 77, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 265188 AND ca = 81 AND pa = 86;
-- 261050 Francisco Conceição
UPDATE players SET ca = 79, game_attrs = json_set(game_attrs, '$.shortpassing', NULL, '$.ballcontrol', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 261050 AND ca = 80 AND pa = 86;
-- 255654 P. Kalulu
UPDATE players SET ca = 80, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.interceptions', NULL, '$.headingaccuracy', NULL, '$.defensiveawareness', NULL, '$.standingtackle', NULL, '$.slidingtackle', NULL, '$.jumping', NULL, '$.strength', NULL, '$.aggression', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 255654 AND ca = 81 AND pa = 85;
-- 268474 L. Lucca
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.shotpower', NULL, '$.longshots', NULL, '$.volleys', NULL, '$.shortpassing', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL, '$.headingaccuracy', NULL, '$.strength', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 268474 AND ca = 77 AND pa = 79;
-- 269728 J. Bahoya
UPDATE players SET ca = 75, game_attrs = json_set(game_attrs, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 269728 AND ca = 76 AND pa = 86;
-- 277782 Wang Yudong
UPDATE players SET ca = 62, game_attrs = json_set(game_attrs, '$.sprintspeed', NULL, '$.acceleration', NULL, '$.finishing', NULL, '$.positioning', NULL, '$.longshots', NULL, '$.vision', NULL, '$.longpassing', NULL, '$.shortpassing', NULL, '$.agility', NULL, '$.reactions', NULL, '$.ballcontrol', NULL, '$.dribbling', NULL), updated_at = '2026-09-20T15:59:02.880Z' WHERE fc_id = 277782 AND ca = 68 AND pa = 77;
