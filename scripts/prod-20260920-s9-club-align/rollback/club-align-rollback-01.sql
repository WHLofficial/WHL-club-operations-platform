-- S9 队籍对齐（回滚）分片 01
-- 生成器 scripts/prod-20260920-s9-club-align/gen-club-align-sql.ts；生成时点 2026-09-20T15:57:58.261Z
-- 覆盖第 1-200 条语句（共 481 条）；源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 口径：只写 players.club_id（+ updated_at），不动能力/合同/状态/成长字段
-- 守卫：WHERE fc_id = ? AND club_id IS 新值 ⇒ 重复执行 changes = 0
-- 277225 Jon Martín NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277225 AND club_id IS 1;
-- 269186 O. Óskarsson NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 269186 AND club_id IS 1;
-- 272455 Pablo Marín NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 272455 AND club_id IS 1;
-- 264701 A. Zakharyan NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264701 AND club_id IS 1;
-- 232363 M. Škriniar NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232363 AND club_id IS 1;
-- 264862 M. Akliouche NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264862 AND club_id IS 1;
-- 199503 G. Xhaka NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 199503 AND club_id IS 1;
-- 266096 Tomás Araújo NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 266096 AND club_id IS 1;
-- 239977 N. Kühn NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 239977 AND club_id IS 1;
-- 222737 Malcom NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 222737 AND club_id IS 1;
-- 245630 Y. Fofana 131681 -> 1
UPDATE players SET club_id = 131681, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 245630 AND club_id IS 1;
-- 230142 Oyarzabal NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 230142 AND club_id IS 1;
-- 241811 Sergio Gómez NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241811 AND club_id IS 1;
-- 235944 Brais Méndez NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 235944 AND club_id IS 1;
-- 246672 Barrenetxea NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246672 AND club_id IS 1;
-- 258775 L. Sučić NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 258775 AND club_id IS 1;
-- 219789 H. Traoré NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 219789 AND club_id IS 1;
-- 209499 Fabinho NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 209499 AND club_id IS 1;
-- 246139 Iñaki Peña NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246139 AND club_id IS 1;
-- 233738 Zubeldia NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 233738 AND club_id IS 1;
-- 274536 M. Bombito NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 274536 AND club_id IS 1;
-- 256097 Javi López NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256097 AND club_id IS 1;
-- 70888 A. Khalaili NULL -> 1
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 70888 AND club_id IS 1;
-- 205452 A. Rüdiger 243 -> 1
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 205452 AND club_id IS 1;
-- 240243 Matheus Cunha 11 -> 1
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 240243 AND club_id IS 1;
-- 193080 De Gea 110374 -> 1
UPDATE players SET club_id = 110374, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 193080 AND club_id IS 1;
-- 277689 C. Harder 112172 -> 1
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277689 AND club_id IS 1;
-- 261865 Miguel Gutiérrez NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 261865 AND club_id IS 10;
-- 251566 Gabriel Martinelli 1 -> 10
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251566 AND club_id IS 10;
-- 229880 A. Wan-Bissaka NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229880 AND club_id IS 10;
-- 260599 A. Varela NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 260599 AND club_id IS 10;
-- 229476 W. Anton NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229476 AND club_id IS 10;
-- 244749 N. Aguerd NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244749 AND club_id IS 10;
-- 212616 R. De Paul NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 212616 AND club_id IS 10;
-- 71351 J. Mokio NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 71351 AND club_id IS 10;
-- 220876 F. Honorat NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 220876 AND club_id IS 10;
-- 206511 M. Arnold NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 206511 AND club_id IS 10;
-- 228383 K. Grabara NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 228383 AND club_id IS 10;
-- 241522 J. Wind NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241522 AND club_id IS 10;
-- 257073 Tiago Tomás NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257073 AND club_id IS 10;
-- 228946 M. Svanberg NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 228946 AND club_id IS 10;
-- 240017 A. Skov Olsen NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 240017 AND club_id IS 10;
-- 244261 L. Majer NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244261 AND club_id IS 10;
-- 254566 P. Wimmer NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 254566 AND club_id IS 10;
-- 243702 D. Spence NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243702 AND club_id IS 10;
-- 76624 Vitor Reis NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 76624 AND club_id IS 10;
-- 208375 M. Müller NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 208375 AND club_id IS 10;
-- 72159 M. Moore NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 72159 AND club_id IS 10;
-- 262105 J. Duranville NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262105 AND club_id IS 10;
-- 76250 M. Alleyne NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 76250 AND club_id IS 10;
-- 256948 C. Tzolis NULL -> 10
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256948 AND club_id IS 10;
-- 240709 R. Baku 112172 -> 10
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 240709 AND club_id IS 10;
-- 245155 M. Kudus NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 245155 AND club_id IS 11;
-- 274445 K. Konaté NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 274445 AND club_id IS 11;
-- 231521 E. Palacios NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231521 AND club_id IS 11;
-- 256079 M. Caicedo 5 -> 11
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256079 AND club_id IS 11;
-- 234378 D. Rice 1 -> 11
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 234378 AND club_id IS 11;
-- 247103 D. Hancko NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247103 AND club_id IS 11;
-- 246669 B. Saka 1 -> 11
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 246669 AND club_id IS 11;
-- 257179 Gonçalo Inácio NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257179 AND club_id IS 11;
-- 256516 Nico Williams NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256516 AND club_id IS 11;
-- 248148 Zubimendi 1 -> 11
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 248148 AND club_id IS 11;
-- 272500 C. Baleba NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 272500 AND club_id IS 11;
-- 270086 António Silva NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 270086 AND club_id IS 11;
-- 243576 Pedro Porro NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243576 AND club_id IS 11;
-- 212218 A. Laporte NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 212218 AND club_id IS 11;
-- 202556 M. Depay NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 202556 AND club_id IS 11;
-- 254796 N. Madueke 1 -> 11
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 254796 AND club_id IS 11;
-- 182224 Wang Dalei NULL -> 11
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 182224 AND club_id IS 11;
-- 251854 Pedri 241 -> 11
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251854 AND club_id IS 11;
-- 241486 J. Koundé 241 -> 11
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241486 AND club_id IS 11;
-- 259532 Joan García 241 -> 11
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259532 AND club_id IS 11;
-- 273906 Renato Veiga NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 273906 AND club_id IS 110374;
-- 275291 N. Pisilli NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 275291 AND club_id IS 110374;
-- 266041 L. Koleosho NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 266041 AND club_id IS 110374;
-- 271575 S. Pafundi NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 271575 AND club_id IS 110374;
-- 76396 A. Natali NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 76396 AND club_id IS 110374;
-- 77786 Li Ruiyue NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 77786 AND club_id IS 110374;
-- 209331 M. Salah 9 -> 110374
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 209331 AND club_id IS 110374;
-- 207865 Marquinhos 73 -> 110374
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 207865 AND club_id IS 110374;
-- 208128 H. Çalhanoğlu NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 208128 AND club_id IS 110374;
-- 252154 M. Carnesecchi NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 252154 AND club_id IS 110374;
-- 251517 J. Gvardiol 10 -> 110374
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251517 AND club_id IS 110374;
-- 257279 Álex Baena NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257279 AND club_id IS 110374;
-- 239231 Marc Cucurella 5 -> 110374
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 239231 AND club_id IS 110374;
-- 241852 M. Diaby NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241852 AND club_id IS 110374;
-- 204963 Carvajal 243 -> 110374
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 204963 AND club_id IS 110374;
-- 236987 B. Kamara 2 -> 110374
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 236987 AND club_id IS 110374;
-- 229348 A. Robinson NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229348 AND club_id IS 110374;
-- 192629 Iago Aspas NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 192629 AND club_id IS 110374;
-- 211110 P. Dybala NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 211110 AND club_id IS 110374;
-- 210413 A. Romagnoli NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 210413 AND club_id IS 110374;
-- 257057 A. Onana 2 -> 110374
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257057 AND club_id IS 110374;
-- 208722 S. Mané NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 208722 AND club_id IS 110374;
-- 216460 J. Giménez NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 216460 AND club_id IS 110374;
-- 223959 L. Torreira NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 223959 AND club_id IS 110374;
-- 188567 P. Aubameyang NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 188567 AND club_id IS 110374;
-- 206113 S. Gnabry 21 -> 110374
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 206113 AND club_id IS 110374;
-- 239093 J. Clauss NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 239093 AND club_id IS 110374;
-- 234642 É. Mendy NULL -> 110374
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 234642 AND club_id IS 110374;
-- 233731 A. Isak 9 -> 112172
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 233731 AND club_id IS 112172;
-- 232656 T. Hernández NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232656 AND club_id IS 112172;
-- 256197 P. Hincapié 1 -> 112172
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256197 AND club_id IS 112172;
-- 264240 Gavi 241 -> 112172
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264240 AND club_id IS 112172;
-- 212622 J. Kimmich 21 -> 112172
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 212622 AND club_id IS 112172;
-- 247090 E. Fernández 5 -> 112172
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 247090 AND club_id IS 112172;
-- 251852 K. Adeyemi NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251852 AND club_id IS 112172;
-- 230621 G. Donnarumma 10 -> 112172
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 230621 AND club_id IS 112172;
-- 241084 L. Díaz 21 -> 112172
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241084 AND club_id IS 112172;
-- 233486 R. Le Normand NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 233486 AND club_id IS 112172;
-- 226271 Fabián Ruiz 73 -> 112172
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 226271 AND club_id IS 112172;
-- 244260 Dani Olmo 241 -> 112172
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244260 AND club_id IS 112172;
-- 225375 K. Laimer 21 -> 112172
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 225375 AND club_id IS 112172;
-- 257711 R. Calafiori 1 -> 112172
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257711 AND club_id IS 112172;
-- 226851 B. Pavard NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 226851 AND club_id IS 112172;
-- 192505 R. Lukaku NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 192505 AND club_id IS 112172;
-- 229582 G. Mancini NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229582 AND club_id IS 112172;
-- 229391 Palhinha NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229391 AND club_id IS 112172;
-- 263620 R. Lavia 5 -> 112172
UPDATE players SET club_id = 5, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 263620 AND club_id IS 112172;
-- 222492 L. Sané NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 222492 AND club_id IS 112172;
-- 241236 A. Semenyo NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241236 AND club_id IS 112172;
-- 235805 F. Chiesa 9 -> 112172
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 235805 AND club_id IS 112172;
-- 209658 L. Goretzka 21 -> 112172
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 209658 AND club_id IS 112172;
-- 259694 Mingueza NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259694 AND club_id IS 112172;
-- 243559 De Frutos NULL -> 112172
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243559 AND club_id IS 112172;
-- 263887 J. Urbig 21 -> 112172
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 263887 AND club_id IS 112172;
-- 265526 G. Restes NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 265526 AND club_id IS 13;
-- 261188 I. Ndiaye NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 261188 AND club_id IS 13;
-- 268737 S. Nypan NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268737 AND club_id IS 13;
-- 256790 J. Musiala 21 -> 13
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256790 AND club_id IS 13;
-- 158023 L. Messi NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 158023 AND club_id IS 13;
-- 232293 V. Osimhen NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232293 AND club_id IS 13;
-- 234396 A. Davies 21 -> 13
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 234396 AND club_id IS 13;
-- 241159 M. Guéhi NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241159 AND club_id IS 13;
-- 220901 David Raya 1 -> 13
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 220901 AND club_id IS 13;
-- 254117 M. Beier NULL -> 13
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 254117 AND club_id IS 13;
-- 269136 K. Mainoo 11 -> 13
UPDATE players SET club_id = 11, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 269136 AND club_id IS 13;
-- 245152 S. Giménez 131681 -> 13
UPDATE players SET club_id = 131681, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 245152 AND club_id IS 13;
-- 74463 Marc Bernal 241 -> 13
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 74463 AND club_id IS 13;
-- 263193 E. Bitshiabu 112172 -> 13
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 263193 AND club_id IS 13;
-- 253163 R. Araujo 241 -> 13
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 253163 AND club_id IS 13;
-- 255253 Vitinha 73 -> 13
UPDATE players SET club_id = 73, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 255253 AND club_id IS 13;
-- 243630 J. David 45 -> 13
UPDATE players SET club_id = 45, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243630 AND club_id IS 13;
-- 277179 Fermín 241 -> 13
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 277179 AND club_id IS 13;
-- 272600 Marc Casadó 241 -> 13
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 272600 AND club_id IS 13;
-- 74094 M. Liberali NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 74094 AND club_id IS 131681;
-- 269476 Hu Hetao NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 269476 AND club_id IS 131681;
-- 217870 G. Di Lorenzo NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 217870 AND club_id IS 131681;
-- 279202 F. Camarda NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 279202 AND club_id IS 131681;
-- 251470 C. De Ketelaere NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 251470 AND club_id IS 131681;
-- 232488 C. Romero NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232488 AND club_id IS 131681;
-- 204485 R. Mahrez NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 204485 AND club_id IS 131681;
-- 213345 K. Coman NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 213345 AND club_id IS 131681;
-- 244669 M. Hjulmand NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244669 AND club_id IS 131681;
-- 259583 D. Udogie NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259583 AND club_id IS 131681;
-- 72093 Martim Fernandes NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 72093 AND club_id IS 131681;
-- 269859 A. Vermeeren NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 269859 AND club_id IS 131681;
-- 202126 H. Kane 21 -> 131681
UPDATE players SET club_id = 21, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 202126 AND club_id IS 131681;
-- 232580 Gabriel 1 -> 131681
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232580 AND club_id IS 131681;
-- 264309 A. Güler 243 -> 131681
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 264309 AND club_id IS 131681;
-- 263578 Balde 241 -> 131681
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 263578 AND club_id IS 131681;
-- 240638 T. Reijnders 10 -> 131681
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 240638 AND club_id IS 131681;
-- 218667 Bernardo Silva 10 -> 131681
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 218667 AND club_id IS 131681;
-- 197445 D. Alaba 243 -> 131681
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 197445 AND club_id IS 131681;
-- 231936 B. White 1 -> 131681
UPDATE players SET club_id = 1, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231936 AND club_id IS 131681;
-- 185122 P. Gulácsi 112172 -> 131681
UPDATE players SET club_id = 112172, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 185122 AND club_id IS 131681;
-- 208333 E. Can NULL -> 131681
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 208333 AND club_id IS 131681;
-- 272449 Pablo Barrios NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 272449 AND club_id IS 14;
-- 256853 M. Tillman NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 256853 AND club_id IS 14;
-- 216547 Rafa NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 216547 AND club_id IS 14;
-- 239085 E. Haaland 10 -> 14
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 239085 AND club_id IS 14;
-- 210514 João Cancelo NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 210514 AND club_id IS 14;
-- 253149 J. Frimpong 9 -> 14
UPDATE players SET club_id = 9, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 253149 AND club_id IS 14;
-- 232756 F. Tomori 131681 -> 14
UPDATE players SET club_id = 131681, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 232756 AND club_id IS 14;
-- 257470 A. Elanga 13 -> 14
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 257470 AND club_id IS 14;
-- 215590 Ayoze NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 215590 AND club_id IS 14;
-- 244067 M. Lacroix NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 244067 AND club_id IS 14;
-- 223334 Joelinton 13 -> 14
UPDATE players SET club_id = 13, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 223334 AND club_id IS 14;
-- 231447 D. Malen 2 -> 14
UPDATE players SET club_id = 2, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231447 AND club_id IS 14;
-- 268896 H. Larsson NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 268896 AND club_id IS 14;
-- 262402 Sergi Cardona NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 262402 AND club_id IS 14;
-- 241436 C. Bassey NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 241436 AND club_id IS 14;
-- 253124 Matheus Nunes 10 -> 14
UPDATE players SET club_id = 10, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 253124 AND club_id IS 14;
-- 193105 A. Areola NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 193105 AND club_id IS 14;
-- 259714 M. Röhl NULL -> 14
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 259714 AND club_id IS 14;
-- 233419 Raphinha 241 -> 14
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 233419 AND club_id IS 14;
-- 243580 L. Openda 45 -> 14
UPDATE players SET club_id = 45, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 243580 AND club_id IS 14;
-- 192119 T. Courtois 243 -> 14
UPDATE players SET club_id = 243, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 192119 AND club_id IS 14;
-- 231677 M. Rashford 241 -> 14
UPDATE players SET club_id = 241, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 231677 AND club_id IS 14;
-- 195864 P. Pogba NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 195864 AND club_id IS 2;
-- 224294 L. Cook NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 224294 AND club_id IS 2;
-- 245367 X. Simons NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 245367 AND club_id IS 2;
-- 215441 S. Guirassy NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 215441 AND club_id IS 2;
-- 177003 L. Modrić 131681 -> 2
UPDATE players SET club_id = 131681, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 177003 AND club_id IS 2;
-- 229906 L. Bailey NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 229906 AND club_id IS 2;
-- 202695 J. Tarkowski NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 202695 AND club_id IS 2;
-- 220502 M. Zaccagni NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 220502 AND club_id IS 2;
-- 183898 Á. Di María NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 183898 AND club_id IS 2;
-- 233084 N. Molina NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 233084 AND club_id IS 2;
-- 240947 T. Mitchell NULL -> 2
UPDATE players SET club_id = NULL, updated_at = '2026-09-20T15:57:58.261Z' WHERE fc_id = 240947 AND club_id IS 2;
