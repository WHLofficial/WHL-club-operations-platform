-- S9 队籍收尾 · 遗留球员释放自由身（回滚）分片 02
-- 生成器 scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts；生成时点 2026-09-21T00:14:45.780Z
-- 覆盖第 201-304 条语句（共 304 条）；未在册判据源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 口径：写 players.club_id（→ NULL）+ status（→ 'free'）+ updated_at，不动能力 / 合同 / 成长字段
-- 守卫：WHERE fc_id = ? AND club_id IS NULL AND status = 'free' ⇒ 重复执行 changes = 0
-- 81324 Gustavo Mancha NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 81324 AND club_id IS NULL AND status = 'free';
-- 82424 G. Kouraklis NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 82424 AND club_id IS NULL AND status = 'free';
-- 193476 R. Cabella NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 193476 AND club_id IS NULL AND status = 'free';
-- 212091 Rodinei NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 212091 AND club_id IS NULL AND status = 'free';
-- 215399 Rúben Vezo NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 215399 AND club_id IS NULL AND status = 'free';
-- 216194 Dani García NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 216194 AND club_id IS NULL AND status = 'free';
-- 226766 Daniel Podence NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 226766 AND club_id IS NULL AND status = 'free';
-- 227055 Gelson Martins NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 227055 AND club_id IS NULL AND status = 'free';
-- 231887 Y. Yazıcı NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 231887 AND club_id IS NULL AND status = 'free';
-- 234986 P. Retsos NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234986 AND club_id IS NULL AND status = 'free';
-- 235949 Gabriel Strefezza NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 235949 AND club_id IS NULL AND status = 'free';
-- 240493 A. Paschalakis NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 240493 AND club_id IS NULL AND status = 'free';
-- 240702 R. Yaremchuk NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 240702 AND club_id IS NULL AND status = 'free';
-- 241788 M. Taremi NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 241788 AND club_id IS NULL AND status = 'free';
-- 242287 F. Ortega NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242287 AND club_id IS NULL AND status = 'free';
-- 243586 A. El Kaabi NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 243586 AND club_id IS NULL AND status = 'free';
-- 243686 Chiquinho NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 243686 AND club_id IS NULL AND status = 'free';
-- 246679 G. Biancone NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 246679 AND club_id IS NULL AND status = 'free';
-- 251942 Costinha NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 251942 AND club_id IS NULL AND status = 'free';
-- 257368 L. Pirola NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257368 AND club_id IS NULL AND status = 'free';
-- 262109 A. Kalogeropoulos NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 262109 AND club_id IS NULL AND status = 'free';
-- 271461 B. Onyemaechi NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 271461 AND club_id IS NULL AND status = 'free';
-- 276998 Diogo Nascimento NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 276998 AND club_id IS NULL AND status = 'free';
-- 74717 Manu González NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74717 AND club_id IS NULL AND status = 'free';
-- 76420 Germán García NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 76420 AND club_id IS NULL AND status = 'free';
-- 79478 M. Mensah NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79478 AND club_id IS NULL AND status = 'free';
-- 80806 Iván Corralejo NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80806 AND club_id IS NULL AND status = 'free';
-- 193352 R. Rodríguez NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 193352 AND club_id IS NULL AND status = 'free';
-- 194911 Adrián NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 194911 AND club_id IS NULL AND status = 'free';
-- 197781 Isco NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 197781 AND club_id IS NULL AND status = 'free';
-- 198141 Bartra NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 198141 AND club_id IS NULL AND status = 'free';
-- 198951 C. Bakambu NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 198951 AND club_id IS NULL AND status = 'free';
-- 203747 Héctor Bellerín NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 203747 AND club_id IS NULL AND status = 'free';
-- 212602 Diego Llorente NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 212602 AND club_id IS NULL AND status = 'free';
-- 221087 Pau López NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 221087 AND club_id IS NULL AND status = 'free';
-- 224158 S. Amrabat NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 224158 AND club_id IS NULL AND status = 'free';
-- 226226 G. Lo Celso NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 226226 AND club_id IS NULL AND status = 'free';
-- 228520 Chimy Ávila NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 228520 AND club_id IS NULL AND status = 'free';
-- 235945 Marc Roca NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 235945 AND club_id IS NULL AND status = 'free';
-- 237034 Cucho Hernández NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 237034 AND club_id IS NULL AND status = 'free';
-- 241184 Junior Firpo NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 241184 AND club_id IS NULL AND status = 'free';
-- 241867 Aitor Ruibal NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 241867 AND club_id IS NULL AND status = 'free';
-- 246657 Álvaro Valles NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 246657 AND club_id IS NULL AND status = 'free';
-- 252324 Riquelme NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 252324 AND club_id IS NULL AND status = 'free';
-- 267430 N. Deossa NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 267430 AND club_id IS NULL AND status = 'free';
-- 272487 Dani Pérez NULL/free -> 449/normal
UPDATE players SET club_id = 449, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 272487 AND club_id IS NULL AND status = 'free';
-- 72180 N. Fortini NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 72180 AND club_id IS NULL AND status = 'free';
-- 74926 E. Kouadio NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74926 AND club_id IS NULL AND status = 'free';
-- 80505 E. Košpo NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80505 AND club_id IS NULL AND status = 'free';
-- 80508 R. Braschi NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80508 AND club_id IS NULL AND status = 'free';
-- 180930 E. Džeko NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 180930 AND club_id IS NULL AND status = 'free';
-- 206654 Pablo Marí NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 206654 AND club_id IS NULL AND status = 'free';
-- 219584 L. Lezzerini NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 219584 AND club_id IS NULL AND status = 'free';
-- 223697 R. Gosens NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 223697 AND club_id IS NULL AND status = 'free';
-- 225439 R. Mandragora NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 225439 AND club_id IS NULL AND status = 'free';
-- 234112 Dodô NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234112 AND club_id IS NULL AND status = 'free';
-- 235866 C. Kouamé NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 235866 AND club_id IS NULL AND status = 'free';
-- 237499 A. Sabiri NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 237499 AND club_id IS NULL AND status = 'free';
-- 238004 A. Guðmundsson NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238004 AND club_id IS NULL AND status = 'free';
-- 238370 M. Pongračić NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238370 AND club_id IS NULL AND status = 'free';
-- 240777 L. Ranieri NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 240777 AND club_id IS NULL AND status = 'free';
-- 242418 T. Lamptey NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242418 AND club_id IS NULL AND status = 'free';
-- 244634 S. Sohm NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 244634 AND club_id IS NULL AND status = 'free';
-- 248385 R. Piccoli NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 248385 AND club_id IS NULL AND status = 'free';
-- 253162 H. Nicolussi Caviglia NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 253162 AND club_id IS NULL AND status = 'free';
-- 258104 G. Infantino NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 258104 AND club_id IS NULL AND status = 'free';
-- 258976 F. Parisi NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 258976 AND club_id IS NULL AND status = 'free';
-- 262236 A. Richardson NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 262236 AND club_id IS NULL AND status = 'free';
-- 264044 M. Viti NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 264044 AND club_id IS NULL AND status = 'free';
-- 266596 J. Fazzini NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 266596 AND club_id IS NULL AND status = 'free';
-- 275325 T. Martinelli NULL/free -> 110374/normal
UPDATE players SET club_id = 110374, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 275325 AND club_id IS NULL AND status = 'free';
-- 73398 Rômulo NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 73398 AND club_id IS NULL AND status = 'free';
-- 74207 K. Nedeljković NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74207 AND club_id IS NULL AND status = 'free';
-- 74512 V. Gebel NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74512 AND club_id IS NULL AND status = 'free';
-- 79107 A. Maksimović NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79107 AND club_id IS NULL AND status = 'free';
-- 80096 J. Masanka Bungi NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80096 AND club_id IS NULL AND status = 'free';
-- 195365 K. Kampl NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 195365 AND club_id IS NULL AND status = 'free';
-- 212188 T. Werner NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 212188 AND club_id IS NULL AND status = 'free';
-- 222331 L. Klostermann NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 222331 AND club_id IS NULL AND status = 'free';
-- 222546 L. Zingerle NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 222546 AND club_id IS NULL AND status = 'free';
-- 228579 B. Henrichs NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 228579 AND club_id IS NULL AND status = 'free';
-- 233195 X. Schlager NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 233195 AND club_id IS NULL AND status = 'free';
-- 238463 A. Haidara NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238463 AND club_id IS NULL AND status = 'free';
-- 242187 C. Baumgartner NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242187 AND club_id IS NULL AND status = 'free';
-- 242879 M. Vandevoordt NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242879 AND club_id IS NULL AND status = 'free';
-- 257876 N. Seiwald NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257876 AND club_id IS NULL AND status = 'free';
-- 276216 E. Banzuzi NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 276216 AND club_id IS NULL AND status = 'free';
-- 277887 M. Finkgräfe NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 277887 AND club_id IS NULL AND status = 'free';
-- 278061 T. Gomis NULL/free -> 112172/normal
UPDATE players SET club_id = 112172, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 278061 AND club_id IS NULL AND status = 'free';
-- 72179 L. Torriani NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 72179 AND club_id IS NULL AND status = 'free';
-- 73286 D. Odogu NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 73286 AND club_id IS NULL AND status = 'free';
-- 80809 M. Pittarella NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80809 AND club_id IS NULL AND status = 'free';
-- 81252 C. Balentien NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 81252 AND club_id IS NULL AND status = 'free';
-- 205812 P. Terracciano NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 205812 AND club_id IS NULL AND status = 'free';
-- 213666 R. Loftus-Cheek NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 213666 AND club_id IS NULL AND status = 'free';
-- 232411 C. Nkunku NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 232411 AND club_id IS NULL AND status = 'free';
-- 237942 P. Estupiñán NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 237942 AND club_id IS NULL AND status = 'free';
-- 240277 M. Gabbia NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 240277 AND club_id IS NULL AND status = 'free';
-- 242664 A. Saelemaekers NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242664 AND club_id IS NULL AND status = 'free';
-- 253473 S. Ricci NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 253473 AND club_id IS NULL AND status = 'free';
-- 254840 S. Pavlović NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 254840 AND club_id IS NULL AND status = 'free';
-- 257186 A. Jashari NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257186 AND club_id IS NULL AND status = 'free';
-- 278237 D. Bartesaghi NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 278237 AND club_id IS NULL AND status = 'free';
-- 279782 Z. Athekame NULL/free -> 131681/normal
UPDATE players SET club_id = 131681, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 279782 AND club_id IS NULL AND status = 'free';
