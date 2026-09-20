-- S9 队籍对齐（回滚）分片 02
-- 生成器 scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 2026-09-20T15:57:58.261Z
-- 覆盖第 201-400 条语句（共 481 条）；源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 口径：只写 players.club_id（+ updated_at），不动能力/合同/状态/成长字段
-- 守卫：WHERE fc_id = ? AND club_id IS 新值 ⇒ 重复执行 changes = 0
-- 229942 A. Disasi 5 -> 2
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229942 AND club_id IS 2;
-- 188377 K. Walker NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 188377 AND club_id IS 2;
-- 207557 R. Olsen NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 207557 AND club_id IS 2;
-- 252371 J. Bellingham 243 -> 2
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 252371 AND club_id IS 2;
-- 248243 E. Camavinga 243 -> 2
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 248243 AND club_id IS 2;
-- 213331 J. Tah 21 -> 2
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 213331 AND club_id IS 2;
-- 246606 Fran García 243 -> 2
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246606 AND club_id IS 2;
-- 231410 Brahim 243 -> 2
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231410 AND club_id IS 2;
-- 240130 Éder Militão 243 -> 2
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 240130 AND club_id IS 2;
-- 253306 M. Ugarte 11 -> 2
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 253306 AND club_id IS 2;
-- 246923 J. Ramsey 13 -> 2
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246923 AND club_id IS 2;
-- 71178 S. El Mala NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 71178 AND club_id IS 21;
-- 250723 K. Koné NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 250723 AND club_id IS 21;
-- 276372 I. Ansah NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 276372 AND club_id IS 21;
-- 268259 N. Weiper NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268259 AND club_id IS 21;
-- 247819 N. Schlotterbeck NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247819 AND club_id IS 21;
-- 241096 S. Tonali 13 -> 21
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241096 AND club_id IS 21;
-- 256261 M. Thiaw 13 -> 21
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256261 AND club_id IS 21;
-- 227647 M. Mittelstädt NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 227647 AND club_id IS 21;
-- 250959 A. Stiller NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 250959 AND club_id IS 21;
-- 254022 N. Woltemade 13 -> 21
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 254022 AND club_id IS 21;
-- 269701 N. Brown NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 269701 AND club_id IS 21;
-- 271114 D. Seimen NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 271114 AND club_id IS 21;
-- 244257 J. Burkardt NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244257 AND club_id IS 21;
-- 266237 P. Wanner NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 266237 AND club_id IS 21;
-- 214096 T. Kleindienst NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 214096 AND club_id IS 21;
-- 258729 Gabri Veiga NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258729 AND club_id IS 21;
-- 262881 R. Ríos NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262881 AND club_id IS 21;
-- 257540 A. Knauff NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257540 AND club_id IS 21;
-- 278780 F. Jeltsch NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 278780 AND club_id IS 21;
-- 258601 M. Sangaré NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258601 AND club_id IS 21;
-- 271057 Gustavo Sá NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 271057 AND club_id IS 21;
-- 237646 D. Muñoz NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 237646 AND club_id IS 21;
-- 260926 K. Schade NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 260926 AND club_id IS 21;
-- 258437 E. Emegha NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258437 AND club_id IS 21;
-- 264219 E. Poku NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264219 AND club_id IS 21;
-- 268916 M. Krattenmacher NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268916 AND club_id IS 21;
-- 279622 N. Aséko NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 279622 AND club_id IS 21;
-- 257919 R. Reitz NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257919 AND club_id IS 21;
-- 262659 N. Atubolu NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262659 AND club_id IS 21;
-- 256500 N. Collins NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256500 AND club_id IS 21;
-- 278228 E. Baum NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 278228 AND club_id IS 21;
-- 258315 B. Arrey-Mbi NULL -> 21
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258315 AND club_id IS 21;
-- 276602 A. Ouédraogo 112172 -> 21
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 276602 AND club_id IS 21;
-- 255971 S. Hezze 280 -> 21
UPDATE players SET club_id = 280, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 255971 AND club_id IS 21;
-- 256325 J. Šutalo NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256325 AND club_id IS 241;
-- 260815 Arnau Martínez NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 260815 AND club_id IS 241;
-- 274288 O. Gloukh NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 274288 AND club_id IS 241;
-- 263370 V. Barco NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 263370 AND club_id IS 241;
-- 260952 A. Schjelderup NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 260952 AND club_id IS 241;
-- 265774 K. De Winter 131681 -> 241
UPDATE players SET club_id = 131681, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 265774 AND club_id IS 241;
-- 231866 Rodri 10 -> 241
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231866 AND club_id IS 241;
-- 247635 K. Kvaratskhelia 73 -> 241
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247635 AND club_id IS 241;
-- 234236 P. Schick NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 234236 AND club_id IS 241;
-- 242458 A. Dovbyk NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 242458 AND club_id IS 241;
-- 251806 Q. Timber NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251806 AND club_id IS 241;
-- 268889 Álvaro Carreras 243 -> 241
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268889 AND club_id IS 241;
-- 270531 O. Diomande NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 270531 AND club_id IS 241;
-- 250753 A. Trubin NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 250753 AND club_id IS 241;
-- 255069 Nico González 10 -> 241
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 255069 AND club_id IS 241;
-- 254088 Amad 11 -> 241
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 254088 AND club_id IS 241;
-- 235243 M. de Ligt 11 -> 241
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 235243 AND club_id IS 241;
-- 251805 J. Timber 1 -> 241
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251805 AND club_id IS 241;
-- 242641 R. Aït-Nouri 10 -> 241
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 242641 AND club_id IS 241;
-- 259868 P. Sarr NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259868 AND club_id IS 241;
-- 247649 J. Branthwaite NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247649 AND club_id IS 241;
-- 207421 L. Trossard 1 -> 241
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 207421 AND club_id IS 241;
-- 259913 G. Sudakov NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259913 AND club_id IS 241;
-- 186345 K. Trippier 13 -> 241
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 186345 AND club_id IS 241;
-- 274559 K. Páez NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 274559 AND club_id IS 241;
-- 245235 A. Bah NULL -> 241
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 245235 AND club_id IS 241;
-- 256630 F. Wirtz 9 -> 243
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256630 AND club_id IS 243;
-- 235073 G. Kobel NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 235073 AND club_id IS 243;
-- 248550 Vivian NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 248550 AND club_id IS 243;
-- 236496 M. Guendouzi NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 236496 AND club_id IS 243;
-- 257191 A. Stach NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257191 AND club_id IS 243;
-- 251752 L. Chevalier 73 -> 243
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251752 AND club_id IS 243;
-- 226161 Marcos Llorente NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 226161 AND club_id IS 243;
-- 277846 Nico Paz NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277846 AND club_id IS 243;
-- 215914 N. Kanté NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 215914 AND club_id IS 243;
-- 200104 Son Heung Min NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 200104 AND club_id IS 243;
-- 216201 Iñaki Williams NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 216201 AND club_id IS 243;
-- 264846 Cristhian Mosquera 1 -> 243
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264846 AND club_id IS 243;
-- 165153 K. Benzema NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 165153 AND club_id IS 243;
-- 220793 D. Sánchez NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 220793 AND club_id IS 243;
-- 275324 A. Diao NULL -> 243
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 275324 AND club_id IS 243;
-- 224656 O. Aina 14 -> 243
UPDATE players SET club_id = 14, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 224656 AND club_id IS 243;
-- 266160 Mika Mármol NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 266160 AND club_id IS 280;
-- 74209 Antoñito Cordero NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 74209 AND club_id IS 280;
-- 260443 S. Ibrahim NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 260443 AND club_id IS 280;
-- 77812 Xuan Zhijian NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 77812 AND club_id IS 280;
-- 258885 Luiz Júnior NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258885 AND club_id IS 280;
-- 278901 A. Bouaddi NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 278901 AND club_id IS 280;
-- 73885 C. Kostoulas NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 73885 AND club_id IS 280;
-- 227236 A. Zambo Anguissa NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 227236 AND club_id IS 280;
-- 229261 D. Zakaria NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229261 AND club_id IS 280;
-- 246321 D. Maeda NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246321 AND club_id IS 280;
-- 242530 N. Okafor NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 242530 AND club_id IS 280;
-- 70497 K. Karetsas NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 70497 AND club_id IS 280;
-- 268804 Mario Gila NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268804 AND club_id IS 280;
-- 212194 J. Brandt NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 212194 AND club_id IS 280;
-- 232498 Isi NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232498 AND club_id IS 280;
-- 258781 I. Zabarnyi 73 -> 280
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258781 AND club_id IS 280;
-- 270077 K. Koulierakis NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 270077 AND club_id IS 280;
-- 241509 Mauro Júnior NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241509 AND club_id IS 280;
-- 73078 K. Sano NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 73078 AND club_id IS 280;
-- 232711 J. Stage NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232711 AND club_id IS 280;
-- 259633 G. Konstantelias NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259633 AND club_id IS 280;
-- 254551 G. Mikautadze NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 254551 AND club_id IS 280;
-- 251156 A. Bertaccini NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251156 AND club_id IS 280;
-- 248165 A. Rațiu NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 248165 AND club_id IS 280;
-- 271121 Q. Hartman NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 271121 AND club_id IS 280;
-- 242453 S. van den Berg NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 242453 AND club_id IS 280;
-- 264330 C. Zafeiris NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264330 AND club_id IS 280;
-- 275328 C. Uzun NULL -> 280
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 275328 AND club_id IS 280;
-- 259377 Yeremy Pino NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259377 AND club_id IS 33;
-- 264298 C. Bradley 9 -> 33
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264298 AND club_id IS 33;
-- 277295 O. Bobb 10 -> 33
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277295 AND club_id IS 33;
-- 238794 Vini Jr. 243 -> 33
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 238794 AND club_id IS 33;
-- 256196 W. Pacho 73 -> 33
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256196 AND club_id IS 33;
-- 264652 B. Barcola 73 -> 33
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264652 AND club_id IS 33;
-- 251421 B. Johnson NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251421 AND club_id IS 33;
-- 239818 Rúben Dias 10 -> 33
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 239818 AND club_id IS 33;
-- 230899 A. Lookman NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 230899 AND club_id IS 33;
-- 237692 P. Foden 10 -> 33
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 237692 AND club_id IS 33;
-- 204525 Iñigo Martínez NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 204525 AND club_id IS 33;
-- 247263 E. Tapsoba NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247263 AND club_id IS 33;
-- 237681 T. Kubo NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 237681 AND club_id IS 33;
-- 210257 Ederson NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 210257 AND club_id IS 33;
-- 223848 S. Milinković-Savić NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 223848 AND club_id IS 33;
-- 186942 İ. Gündoğan NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 186942 AND club_id IS 33;
-- 262088 H. Haraldsson NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262088 AND club_id IS 33;
-- 232639 R. Doan NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232639 AND club_id IS 33;
-- 200159 S. Ortega 10 -> 33
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 200159 AND club_id IS 33;
-- 210047 F. Schär 13 -> 33
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 210047 AND club_id IS 33;
-- 200724 Nacho Fernández NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 200724 AND club_id IS 33;
-- 213516 Ricardo Horta NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 213516 AND club_id IS 33;
-- 231478 L. Martínez NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231478 AND club_id IS 33;
-- 233096 D. Dumfries NULL -> 33
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 233096 AND club_id IS 33;
-- 236703 D. Raum 112172 -> 33
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 236703 AND club_id IS 33;
-- 265450 J. Bakayoko 112172 -> 33
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 265450 AND club_id IS 33;
-- 279604 Jauregizar NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 279604 AND club_id IS 449;
-- 203376 V. van Dijk 9 -> 449
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 203376 AND club_id IS 449;
-- 229558 D. Upamecano 21 -> 449
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229558 AND club_id IS 449;
-- 192985 K. De Bruyne NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 192985 AND club_id IS 449;
-- 244778 Trincão NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244778 AND club_id IS 449;
-- 225116 A. Meret NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 225116 AND club_id IS 449;
-- 224293 Rúben Neves NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 224293 AND club_id IS 449;
-- 252802 W. Singo NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 252802 AND club_id IS 449;
-- 256903 Gonçalo Ramos 73 -> 449
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256903 AND club_id IS 449;
-- 242444 João Félix NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 242444 AND club_id IS 449;
-- 263205 B. Yılmaz NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 263205 AND club_id IS 449;
-- 235410 Y. En-Nesyri NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 235410 AND club_id IS 449;
-- 264388 Moleiro NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264388 AND club_id IS 449;
-- 243057 N. Williams 14 -> 449
UPDATE players SET club_id = 14, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243057 AND club_id IS 449;
-- 277581 Samu NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277581 AND club_id IS 449;
-- 245371 T. Almada NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 245371 AND club_id IS 449;
-- 266039 Pubill NULL -> 449
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 266039 AND club_id IS 449;
-- 277211 Franculino NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277211 AND club_id IS 45;
-- 262027 T. Muharemović NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262027 AND club_id IS 45;
-- 74071 R. Floriani Mussolini NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 74071 AND club_id IS 45;
-- 231443 O. Dembélé 73 -> 45
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231443 AND club_id IS 45;
-- 271421 D. Doué 73 -> 45
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 271421 AND club_id IS 45;
-- 272505 Endrick 243 -> 45
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 272505 AND club_id IS 45;
-- 251570 R. Cherki 10 -> 45
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251570 AND club_id IS 45;
-- 264697 M. Amoura NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264697 AND club_id IS 45;
-- 255001 N. Rovella NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 255001 AND club_id IS 45;
-- 230869 Unai Simón NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 230869 AND club_id IS 45;
-- 265188 G. Scalvini NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 265188 AND club_id IS 45;
-- 20801 Cristiano Ronaldo NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 20801 AND club_id IS 45;
-- 268474 L. Lucca NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268474 AND club_id IS 45;
-- 269728 J. Bahoya NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 269728 AND club_id IS 45;
-- 277909 E. Kroupi NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277909 AND club_id IS 45;
-- 74310 N. Savona 14 -> 45
UPDATE players SET club_id = 14, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 74310 AND club_id IS 45;
-- 277782 Wang Yudong NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277782 AND club_id IS 45;
-- 77573 Li Hao NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 77573 AND club_id IS 45;
-- 224232 N. Barella NULL -> 45
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 224232 AND club_id IS 45;
-- 260823 N. Fagioli 110374 -> 45
UPDATE players SET club_id = 110374, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 260823 AND club_id IS 45;
-- 264492 Yeremay NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264492 AND club_id IS 5;
-- 275507 M. Sarr NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 275507 AND club_id IS 5;
-- 246147 M. Greenwood NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246147 AND club_id IS 5;
-- 270821 M. Penders NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 270821 AND club_id IS 5;
-- 194765 A. Griezmann NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 194765 AND club_id IS 5;
-- 277869 M. Kayode NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277869 AND club_id IS 5;
-- 228813 Aleix García NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 228813 AND club_id IS 5;
-- 247257 Ibañez NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247257 AND club_id IS 5;
-- 275353 Z. El Ouahdi NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 275353 AND club_id IS 5;
-- 261299 A. Scott NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 261299 AND club_id IS 5;
-- 273748 J. Panichelli NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 273748 AND club_id IS 5;
-- 246875 O. Kossounou NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246875 AND club_id IS 5;
-- 270039 Diego Moreira NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 270039 AND club_id IS 5;
-- 271807 E. Nwaneri 1 -> 5
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 271807 AND club_id IS 5;
-- 241643 V. Johansson NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241643 AND club_id IS 5;
-- 265459 T. Morton 66 -> 5
UPDATE players SET club_id = 66, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 265459 AND club_id IS 5;
-- 200155 H. Vanaken NULL -> 5
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 200155 AND club_id IS 5;
-- 262863 A. Nusa 112172 -> 5
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262863 AND club_id IS 5;
-- 239053 F. Valverde 243 -> 66
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 239053 AND club_id IS 66;
-- 247827 M. Olise 21 -> 66
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247827 AND club_id IS 66;
-- 246104 R. Gravenberch 9 -> 66
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246104 AND club_id IS 66;
-- 243715 W. Saliba 1 -> 66
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243715 AND club_id IS 66;
