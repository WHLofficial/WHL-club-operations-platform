-- S9 队籍收尾 · 遗留球员释放自由身（回滚）分片 01
-- 生成器 scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts；生成时点 2026-09-21T00:14:45.780Z
-- 覆盖第 1-200 条语句（共 304 条）；未在册判据源 E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901
-- 口径：写 players.club_id（→ NULL）+ status（→ 'free'）+ updated_at，不动能力 / 合同 / 成长字段
-- 守卫：WHERE fc_id = ? AND club_id IS NULL AND status = 'free' ⇒ 重复执行 changes = 0
-- 206585 Kepa NULL/free -> 1/normal
UPDATE players SET club_id = 1, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 206585 AND club_id IS NULL AND status = 'free';
-- 210697 C. Nørgaard NULL/free -> 1/normal
UPDATE players SET club_id = 1, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 210697 AND club_id IS NULL AND status = 'free';
-- 230666 Gabriel Jesus NULL/free -> 1/normal
UPDATE players SET club_id = 1, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 230666 AND club_id IS NULL AND status = 'free';
-- 235794 E. Eze NULL/free -> 1/normal
UPDATE players SET club_id = 1, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 235794 AND club_id IS NULL AND status = 'free';
-- 278773 M. Lewis-Skelly NULL/free -> 1/normal
UPDATE players SET club_id = 1, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 278773 AND club_id IS NULL AND status = 'free';
-- 80816 B. Burrowes NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80816 AND club_id IS NULL AND status = 'free';
-- 200110 M. Bizot NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 200110 AND club_id IS NULL AND status = 'free';
-- 221660 V. Lindelöf NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 221660 AND club_id IS NULL AND status = 'free';
-- 226162 E. Buendía NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 226162 AND club_id IS NULL AND status = 'free';
-- 233049 J. Sancho NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 233049 AND club_id IS NULL AND status = 'free';
-- 258444 E. Guessand NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 258444 AND club_id IS NULL AND status = 'free';
-- 260247 M. Rogers NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 260247 AND club_id IS NULL AND status = 'free';
-- 264209 L. Bogarde NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 264209 AND club_id IS NULL AND status = 'free';
-- 275468 Andrés García NULL/free -> 2/normal
UPDATE players SET club_id = 2, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 275468 AND club_id IS NULL AND status = 'free';
-- 202652 R. Sterling NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 202652 AND club_id IS NULL AND status = 'free';
-- 222104 T. Adarabioyo NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 222104 AND club_id IS NULL AND status = 'free';
-- 230918 T. Chalobah NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 230918 AND club_id IS NULL AND status = 'free';
-- 242578 B. Badiashile NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242578 AND club_id IS NULL AND status = 'free';
-- 248158 G. Slonina NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 248158 AND club_id IS NULL AND status = 'free';
-- 248695 W. Fofana NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 248695 AND club_id IS NULL AND status = 'free';
-- 258485 F. Jörgensen NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 258485 AND club_id IS NULL AND status = 'free';
-- 269495 F. Buonanotte NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 269495 AND club_id IS NULL AND status = 'free';
-- 278813 Marc Guiu NULL/free -> 5/normal
UPDATE players SET club_id = 5, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 278813 AND club_id IS NULL AND status = 'free';
-- 70824 G. Leoni NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 70824 AND club_id IS NULL AND status = 'free';
-- 79922 Á. Pécsi NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79922 AND club_id IS NULL AND status = 'free';
-- 80376 R. Ngumoha NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80376 AND club_id IS NULL AND status = 'free';
-- 212831 Alisson NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 212831 AND club_id IS NULL AND status = 'free';
-- 222514 F. Woodman NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 222514 AND club_id IS NULL AND status = 'free';
-- 225100 J. Gomez NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 225100 AND club_id IS NULL AND status = 'free';
-- 232487 W. Endo NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 232487 AND club_id IS NULL AND status = 'free';
-- 242434 C. Jones NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 242434 AND club_id IS NULL AND status = 'free';
-- 247601 R. Williams NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 247601 AND club_id IS NULL AND status = 'free';
-- 252897 C. Ramsay NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 252897 AND club_id IS NULL AND status = 'free';
-- 271975 Stefan Bajcetic NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 271975 AND club_id IS NULL AND status = 'free';
-- 279128 T. Nyoni NULL/free -> 9/normal
UPDATE players SET club_id = 9, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 279128 AND club_id IS NULL AND status = 'free';
-- 203574 J. Stones NULL/free -> 10/normal
UPDATE players SET club_id = 10, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 203574 AND club_id IS NULL AND status = 'free';
-- 204246 M. Bettinelli NULL/free -> 10/normal
UPDATE players SET club_id = 10, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 204246 AND club_id IS NULL AND status = 'free';
-- 207410 M. Kovačić NULL/free -> 10/normal
UPDATE players SET club_id = 10, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 207410 AND club_id IS NULL AND status = 'free';
-- 224081 K. Phillips NULL/free -> 10/normal
UPDATE players SET club_id = 10, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 224081 AND club_id IS NULL AND status = 'free';
-- 263063 J. Trafford NULL/free -> 10/normal
UPDATE players SET club_id = 10, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 263063 AND club_id IS NULL AND status = 'free';
-- 271574 R. Lewis NULL/free -> 10/normal
UPDATE players SET club_id = 10, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 271574 AND club_id IS NULL AND status = 'free';
-- 74142 D. León NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74142 AND club_id IS NULL AND status = 'free';
-- 163264 T. Heaton NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 163264 AND club_id IS NULL AND status = 'free';
-- 200145 Casemiro NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 200145 AND club_id IS NULL AND status = 'free';
-- 203263 H. Maguire NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 203263 AND club_id IS NULL AND status = 'free';
-- 212198 Bruno Fernandes NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 212198 AND club_id IS NULL AND status = 'free';
-- 233064 M. Mount NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 233064 AND club_id IS NULL AND status = 'free';
-- 234574 Diogo Dalot NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234574 AND club_id IS NULL AND status = 'free';
-- 236401 N. Mazraoui NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 236401 AND club_id IS NULL AND status = 'free';
-- 238041 T. Malacia NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238041 AND club_id IS NULL AND status = 'free';
-- 239301 L. Martínez NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 239301 AND club_id IS NULL AND status = 'free';
-- 243647 A. Bayındır NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 243647 AND club_id IS NULL AND status = 'free';
-- 250961 J. Zirkzee NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 250961 AND club_id IS NULL AND status = 'free';
-- 269233 T. Fredricson NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 269233 AND club_id IS NULL AND status = 'free';
-- 277432 P. Dorgu NULL/free -> 11/normal
UPDATE players SET club_id = 11, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 277432 AND club_id IS NULL AND status = 'free';
-- 163600 J. Ruddy NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 163600 AND club_id IS NULL AND status = 'free';
-- 198032 D. Burn NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 198032 AND club_id IS NULL AND status = 'free';
-- 198039 M. Gillespie NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 198039 AND club_id IS NULL AND status = 'free';
-- 203487 J. Lascelles NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 203487 AND club_id IS NULL AND status = 'free';
-- 203841 N. Pope NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 203841 AND club_id IS NULL AND status = 'free';
-- 206085 J. Murphy NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 206085 AND club_id IS NULL AND status = 'free';
-- 207650 E. Krafth NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 207650 AND club_id IS NULL AND status = 'free';
-- 233934 A. Ramsdale NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 233934 AND club_id IS NULL AND status = 'free';
-- 234742 H. Barnes NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234742 AND club_id IS NULL AND status = 'free';
-- 234824 Y. Wissa NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234824 AND club_id IS NULL AND status = 'free';
-- 237329 J. Willock NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 237329 AND club_id IS NULL AND status = 'free';
-- 258805 H. Ashby NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 258805 AND club_id IS NULL AND status = 'free';
-- 270357 M. Thompson NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 270357 AND club_id IS NULL AND status = 'free';
-- 270519 W. Osula NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 270519 AND club_id IS NULL AND status = 'free';
-- 270617 A. Murphy NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 270617 AND club_id IS NULL AND status = 'free';
-- 274246 L. Miley NULL/free -> 13/normal
UPDATE players SET club_id = 13, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 274246 AND club_id IS NULL AND status = 'free';
-- 74242 Z. Abbott NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74242 AND club_id IS NULL AND status = 'free';
-- 79402 Igor Jesus NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79402 AND club_id IS NULL AND status = 'free';
-- 79629 Jair Cunha NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79629 AND club_id IS NULL AND status = 'free';
-- 192123 C. Wood NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 192123 AND club_id IS NULL AND status = 'free';
-- 199641 M. Sels NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 199641 AND club_id IS NULL AND status = 'free';
-- 202750 W. Boly NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 202750 AND club_id IS NULL AND status = 'free';
-- 216325 A. Gunn NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 216325 AND club_id IS NULL AND status = 'free';
-- 227813 O. Zinchenko NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 227813 AND club_id IS NULL AND status = 'free';
-- 230978 T. Awoniyi NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 230978 AND club_id IS NULL AND status = 'free';
-- 234724 John Victor NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234724 AND club_id IS NULL AND status = 'free';
-- 235173 I. Sangaré NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 235173 AND club_id IS NULL AND status = 'free';
-- 235642 R. Yates NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 235642 AND club_id IS NULL AND status = 'free';
-- 236015 M. Gibbs-White NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 236015 AND club_id IS NULL AND status = 'free';
-- 236499 Douglas Luiz NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 236499 AND club_id IS NULL AND status = 'free';
-- 237819 N. Domínguez NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 237819 AND club_id IS NULL AND status = 'free';
-- 240740 C. Hudson-Odoi NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 240740 AND club_id IS NULL AND status = 'free';
-- 253444 A. Kalimuendo NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 253444 AND club_id IS NULL AND status = 'free';
-- 254243 E. Anderson NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 254243 AND club_id IS NULL AND status = 'free';
-- 256008 Morato NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 256008 AND club_id IS NULL AND status = 'free';
-- 257980 D. Ndoye NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257980 AND club_id IS NULL AND status = 'free';
-- 260145 O. Hutchinson NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 260145 AND club_id IS NULL AND status = 'free';
-- 264349 J. McAtee NULL/free -> 14/normal
UPDATE players SET club_id = 14, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 264349 AND club_id IS NULL AND status = 'free';
-- 76337 L. Klanac NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 76337 AND club_id IS NULL AND status = 'free';
-- 77126 W. Mike NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 77126 AND club_id IS NULL AND status = 'free';
-- 79317 Santos Daiber NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79317 AND club_id IS NULL AND status = 'free';
-- 81240 J. Bärtl NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 81240 AND club_id IS NULL AND status = 'free';
-- 167495 M. Neuer NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 167495 AND club_id IS NULL AND status = 'free';
-- 186569 S. Ulreich NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 186569 AND club_id IS NULL AND status = 'free';
-- 209889 R. Guerreiro NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 209889 AND club_id IS NULL AND status = 'free';
-- 234205 H. Ito NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234205 AND club_id IS NULL AND status = 'free';
-- 237086 Kim Min Jae NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 237086 AND club_id IS NULL AND status = 'free';
-- 248266 S. Boey NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 248266 AND club_id IS NULL AND status = 'free';
-- 250955 J. Stanišić NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 250955 AND club_id IS NULL AND status = 'free';
-- 259197 N. Jackson NULL/free -> 21/normal
UPDATE players SET club_id = 21, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 259197 AND club_id IS NULL AND status = 'free';
-- 73089 S. Dulić NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 73089 AND club_id IS NULL AND status = 'free';
-- 76291 C. Lippmann NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 76291 AND club_id IS NULL AND status = 'free';
-- 76594 L. Faßmann NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 76594 AND club_id IS NULL AND status = 'free';
-- 76596 S. Althaus NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 76596 AND club_id IS NULL AND status = 'free';
-- 78543 E. Erdoğan NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 78543 AND club_id IS NULL AND status = 'free';
-- 79241 M. Qela NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79241 AND club_id IS NULL AND status = 'free';
-- 80222 P. Bachmann NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80222 AND club_id IS NULL AND status = 'free';
-- 200610 K. Volland NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 200610 AND club_id IS NULL AND status = 'free';
-- 210006 T. Dähne NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 210006 AND club_id IS NULL AND status = 'free';
-- 211899 F. Niederlechner NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 211899 AND club_id IS NULL AND status = 'free';
-- 211953 R. Vollath NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 211953 AND club_id IS NULL AND status = 'free';
-- 224421 M. Reinthaler NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 224421 AND club_id IS NULL AND status = 'free';
-- 226686 M. Christiansen NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 226686 AND club_id IS NULL AND status = 'free';
-- 233707 S. Haugen NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 233707 AND club_id IS NULL AND status = 'free';
-- 236675 K. Jakob NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 236675 AND club_id IS NULL AND status = 'free';
-- 238647 M. Schröter NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238647 AND club_id IS NULL AND status = 'free';
-- 238779 J. Verlaat NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238779 AND club_id IS NULL AND status = 'free';
-- 238793 T. Jacobsen NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238793 AND club_id IS NULL AND status = 'free';
-- 238953 M. Wolfram NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 238953 AND club_id IS NULL AND status = 'free';
-- 241277 J. Steinkötter NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 241277 AND club_id IS NULL AND status = 'free';
-- 243932 D. Philipp NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 243932 AND club_id IS NULL AND status = 'free';
-- 244413 M. Pfeifer NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 244413 AND club_id IS NULL AND status = 'free';
-- 251456 S. Voet NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 251456 AND club_id IS NULL AND status = 'free';
-- 257144 P. Hobsch NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257144 AND club_id IS NULL AND status = 'free';
-- 257332 M. Rittmüller NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257332 AND club_id IS NULL AND status = 'free';
-- 269866 T. Danhof NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 269866 AND club_id IS NULL AND status = 'free';
-- 270014 T. Deniz NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 270014 AND club_id IS NULL AND status = 'free';
-- 270116 R. Schifferl NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 270116 AND club_id IS NULL AND status = 'free';
-- 276191 P. Maier NULL/free -> 33/normal
UPDATE players SET club_id = 33, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 276191 AND club_id IS NULL AND status = 'free';
-- 74329 J. Rouhi NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74329 AND club_id IS NULL AND status = 'free';
-- 189342 C. Pinsoglio NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 189342 AND club_id IS NULL AND status = 'free';
-- 198009 M. Perin NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 198009 AND club_id IS NULL AND status = 'free';
-- 205175 A. Milik NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 205175 AND club_id IS NULL AND status = 'free';
-- 208574 F. Kostić NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 208574 AND club_id IS NULL AND status = 'free';
-- 211320 D. Rugani NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 211320 AND club_id IS NULL AND status = 'free';
-- 231512 L. Kelly NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 231512 AND club_id IS NULL AND status = 'free';
-- 239763 E. Zhegrova NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 239763 AND club_id IS NULL AND status = 'free';
-- 246430 D. Vlahović NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 246430 AND club_id IS NULL AND status = 'free';
-- 251870 J. Cabal NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 251870 AND club_id IS NULL AND status = 'free';
-- 257290 João Mário NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 257290 AND club_id IS NULL AND status = 'free';
-- 268802 F. Miretti NULL/free -> 45/normal
UPDATE players SET club_id = 45, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 268802 AND club_id IS NULL AND status = 'free';
-- 74883 E. Molebe NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74883 AND club_id IS NULL AND status = 'free';
-- 77093 L. Diarra NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 77093 AND club_id IS NULL AND status = 'free';
-- 77631 T. Barišić NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 77631 AND club_id IS NULL AND status = 'free';
-- 78145 A. Gomes Rodríguez NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 78145 AND club_id IS NULL AND status = 'free';
-- 80067 K. Merah NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80067 AND club_id IS NULL AND status = 'free';
-- 80690 Mathys De Carvalho NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80690 AND club_id IS NULL AND status = 'free';
-- 208364 Clinton Mata NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 208364 AND club_id IS NULL AND status = 'free';
-- 210372 R. Ghezzal NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 210372 AND club_id IS NULL AND status = 'free';
-- 211256 N. Tagliafico NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 211256 AND club_id IS NULL AND status = 'free';
-- 219683 C. Tolisso NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 219683 AND club_id IS NULL AND status = 'free';
-- 220093 H. Hateboer NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 220093 AND club_id IS NULL AND status = 'free';
-- 225782 A. Maitland-Niles NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 225782 AND club_id IS NULL AND status = 'free';
-- 225859 M. Niakhaté NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 225859 AND club_id IS NULL AND status = 'free';
-- 234078 O. Mangala NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234078 AND club_id IS NULL AND status = 'free';
-- 234371 R. Descamps NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 234371 AND club_id IS NULL AND status = 'free';
-- 247050 P. Šulc NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 247050 AND club_id IS NULL AND status = 'free';
-- 256104 T. Tessmann NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 256104 AND club_id IS NULL AND status = 'free';
-- 256970 A. Karabec NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 256970 AND club_id IS NULL AND status = 'free';
-- 262102 R. Kluivert NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 262102 AND club_id IS NULL AND status = 'free';
-- 263139 D. Greif NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 263139 AND club_id IS NULL AND status = 'free';
-- 263815 Abner Vinícius NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 263815 AND club_id IS NULL AND status = 'free';
-- 264325 M. Satriano NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 264325 AND club_id IS NULL AND status = 'free';
-- 268763 E. Nuamah NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 268763 AND club_id IS NULL AND status = 'free';
-- 276747 A. Laâziri NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 276747 AND club_id IS NULL AND status = 'free';
-- 276901 Afonso Moreira NULL/free -> 66/normal
UPDATE players SET club_id = 66, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 276901 AND club_id IS NULL AND status = 'free';
-- 74449 I. Mbaye NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74449 AND club_id IS NULL AND status = 'free';
-- 78216 N. Kamara NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 78216 AND club_id IS NULL AND status = 'free';
-- 78549 Q. Ndjantou NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 78549 AND club_id IS NULL AND status = 'free';
-- 81659 M. Jangeal NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 81659 AND club_id IS NULL AND status = 'free';
-- 220814 L. Hernández NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 220814 AND club_id IS NULL AND status = 'free';
-- 240225 M. Safonov NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 240225 AND club_id IS NULL AND status = 'free';
-- 243780 Lee Kang In NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 243780 AND club_id IS NULL AND status = 'free';
-- 279880 Renato Marin NULL/free -> 73/normal
UPDATE players SET club_id = 73, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 279880 AND club_id IS NULL AND status = 'free';
-- 74462 Gerard Martín NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74462 AND club_id IS NULL AND status = 'free';
-- 75068 Guille Fernández NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 75068 AND club_id IS NULL AND status = 'free';
-- 75156 Toni Fernández NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 75156 AND club_id IS NULL AND status = 'free';
-- 80663 Jofre Torrents NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80663 AND club_id IS NULL AND status = 'free';
-- 80674 Dro NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80674 AND club_id IS NULL AND status = 'free';
-- 192448 M. ter Stegen NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 192448 AND club_id IS NULL AND status = 'free';
-- 213661 A. Christensen NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 213661 AND club_id IS NULL AND status = 'free';
-- 265600 R. Bardghji NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 265600 AND club_id IS NULL AND status = 'free';
-- 277908 D. Kochen NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 277908 AND club_id IS NULL AND status = 'free';
-- 278046 Pau Cubarsí NULL/free -> 241/normal
UPDATE players SET club_id = 241, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 278046 AND club_id IS NULL AND status = 'free';
-- 75572 Fortea NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 75572 AND club_id IS NULL AND status = 'free';
-- 75747 Diego Aguado NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 75747 AND club_id IS NULL AND status = 'free';
-- 77851 Víctor Valdepeñas NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 77851 AND club_id IS NULL AND status = 'free';
-- 80807 Thiago Pitarch NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 80807 AND club_id IS NULL AND status = 'free';
-- 222509 Dani Ceballos NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 222509 AND club_id IS NULL AND status = 'free';
-- 243952 A. Lunin NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 243952 AND club_id IS NULL AND status = 'free';
-- 272503 Sergio Mestre NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 272503 AND club_id IS NULL AND status = 'free';
-- 278394 Fran González NULL/free -> 243/normal
UPDATE players SET club_id = 243, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 278394 AND club_id IS NULL AND status = 'free';
-- 74085 N. Botis NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74085 AND club_id IS NULL AND status = 'free';
-- 74697 L. Scipioni NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 74697 AND club_id IS NULL AND status = 'free';
-- 79110 S. Pnevmonidis NULL/free -> 280/normal
UPDATE players SET club_id = 280, status = 'normal', updated_at = '2026-09-21T00:14:45.780Z' WHERE fc_id = 79110 AND club_id IS NULL AND status = 'free';
