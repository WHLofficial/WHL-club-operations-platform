-- S9 队籍对齐（回滚）分片 03
-- 生成器 scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 2026-09-20T15:39:19.313Z
-- 覆盖第 401-481 条语句（共 481 条）；源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 口径：只写 players.club_id（+ updated_at），不动能力/合同/状态/成长字段
-- 守卫：WHERE fc_id = ? AND club_id IS 新值 ⇒ 重复执行 changes = 0
-- 188545 R. Lewandowski 241 -> 66
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 188545 AND club_id IS 66;
-- 246420 J. Doku 10 -> 66
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 246420 AND club_id IS 66;
-- 257289 H. Ekitiké 9 -> 66
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 257289 AND club_id IS 66;
-- 240950 Pedro Gonçalves NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 240950 AND club_id IS 66;
-- 272926 L. Bergvall NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 272926 AND club_id IS 66;
-- 238074 R. James 5 -> 66
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 238074 AND club_id IS 66;
-- 210008 A. Rabiot 131681 -> 66
UPDATE players SET club_id = 131681, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 210008 AND club_id IS 66;
-- 260908 M. Kerkez 9 -> 66
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 260908 AND club_id IS 66;
-- 229188 V. Pavlidis NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 229188 AND club_id IS 66;
-- 259307 M. Gusto 5 -> 66
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 259307 AND club_id IS 66;
-- 210881 J. McGinn 2 -> 66
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 210881 AND club_id IS 66;
-- 207862 M. Ginter NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 207862 AND club_id IS 66;
-- 235152 F. Kadıoğlu NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 235152 AND club_id IS 66;
-- 252064 L. Krejčí NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 252064 AND club_id IS 66;
-- 272781 E. Ben Seghir NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 272781 AND club_id IS 66;
-- 258378 M. Godts NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 258378 AND club_id IS 66;
-- 204935 J. Pickford NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 204935 AND club_id IS 66;
-- 266866 Éderson NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 266866 AND club_id IS 66;
-- 234060 Y. Herrera NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 234060 AND club_id IS 66;
-- 250789 D. Bakwa 14 -> 66
UPDATE players SET club_id = 14, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 250789 AND club_id IS 66;
-- 275048 C. Talbi NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 275048 AND club_id IS 66;
-- 278903 J. Jacquet NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 278903 AND club_id IS 66;
-- 272785 C. Mawissa NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 272785 AND club_id IS 66;
-- 214584 F. Armani NULL -> 66
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 214584 AND club_id IS 66;
-- 262138 C. Lukeba 112172 -> 66
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 262138 AND club_id IS 66;
-- 78012 Y. Diomande 112172 -> 66
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 78012 AND club_id IS 66;
-- 259516 Johnny Cardoso NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 259516 AND club_id IS 73;
-- 72997 Rodrigo Mora NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 72997 AND club_id IS 73;
-- 268421 M. Tel NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 268421 AND club_id IS 73;
-- 246191 J. Alvarez NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 246191 AND club_id IS 73;
-- 246863 F. Nmecha NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 246863 AND club_id IS 73;
-- 257534 C. Palmer 5 -> 73
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 257534 AND club_id IS 73;
-- 234577 Diogo Costa NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 234577 AND club_id IS 73;
-- 243014 B. Mbeumo 11 -> 73
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 243014 AND club_id IS 73;
-- 241461 Ferran Torres 241 -> 73
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 241461 AND club_id IS 73;
-- 256675 O. Marmoush 10 -> 73
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 256675 AND club_id IS 73;
-- 251809 S. Botman 13 -> 73
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 251809 AND club_id IS 73;
-- 269087 L. Yoro 11 -> 73
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 269087 AND club_id IS 73;
-- 244675 Sancet NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 244675 AND club_id IS 73;
-- 227678 E. Konsa 2 -> 73
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 227678 AND club_id IS 73;
-- 208920 N. Aké 10 -> 73
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 208920 AND club_id IS 73;
-- 231416 D. Lukébakio NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 231416 AND club_id IS 73;
-- 204923 M. Sabitzer NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 204923 AND club_id IS 73;
-- 251804 S. Dest NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 251804 AND club_id IS 73;
-- 80170 Wesley NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 80170 AND club_id IS 73;
-- 276295 T. Barry NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 276295 AND club_id IS 73;
-- 240091 G. Vicario NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 240091 AND club_id IS 73;
-- 216267 A. Robertson 9 -> 73
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 216267 AND club_id IS 73;
-- 221992 H. Lozano NULL -> 73
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 221992 AND club_id IS 73;
-- 258498 B. Verbruggen NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 258498 AND club_id IS 9;
-- 248465 I. Maatsen 2 -> 9
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 248465 AND club_id IS 9;
-- 270857 Mateus Fernandes NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 270857 AND club_id IS 9;
-- 275138 L. Camara NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 275138 AND club_id IS 9;
-- 252144 Eduardo Quaresma NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 252144 AND club_id IS 9;
-- 235790 K. Havertz 1 -> 9
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 235790 AND club_id IS 9;
-- 211688 Gayà NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 211688 AND club_id IS 9;
-- 264453 M. van de Ven NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 264453 AND club_id IS 9;
-- 77940 Zhang Haoran NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 77940 AND club_id IS 9;
-- 273651 J. Quansah NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 273651 AND club_id IS 9;
-- 233556 R. Orsolini NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 233556 AND club_id IS 9;
-- 247172 J. Durán NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 247172 AND club_id IS 9;
-- 246174 H. Elliott 2 -> 9
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 246174 AND club_id IS 9;
-- 279044 Geovany Quenda NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 279044 AND club_id IS 9;
-- 266097 Geny Catamo NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 266097 AND club_id IS 9;
-- 230938 F. Kessié NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 230938 AND club_id IS 9;
-- 270674 Alberto Costa NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 270674 AND club_id IS 9;
-- 226853 J. St. Juste NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 226853 AND club_id IS 9;
-- 271132 Gabriel Silva NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 271132 AND club_id IS 9;
-- 276048 Fernandez-Pardo NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 276048 AND club_id IS 9;
-- 275592 R. van Bommel NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 275592 AND club_id IS 9;
-- 277482 L. Sauer NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 277482 AND club_id IS 9;
-- 209297 Fred NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 209297 AND club_id IS 9;
-- 258881 O. Nwobodo NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 258881 AND club_id IS 9;
-- 279934 I. Subiabre NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 279934 AND club_id IS 9;
-- 231747 K. Mbappé 243 -> 9
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 231747 AND club_id IS 9;
-- 231281 T. Alexander-Arnold 243 -> 9
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 231281 AND club_id IS 9;
-- 228702 F. de Jong 241 -> 9
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 228702 AND club_id IS 9;
-- 226268 F. Dimarco NULL -> 9
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 226268 AND club_id IS 9;
-- 238095 N. Milenković 14 -> 9
UPDATE players SET club_id = 14, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 238095 AND club_id IS 9;
-- 240679 T. Koopmeiners 45 -> 9
UPDATE players SET club_id = 45, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 240679 AND club_id IS 9;
-- 204638 W. Orban 112172 -> 9
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:39:19.313Z' WHERE fc_id = 204638 AND club_id IS 9;
