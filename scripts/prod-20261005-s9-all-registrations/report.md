# S9 全员注册批报告（20 队全写：一线队 + 训练营）

生成时点：2026-10-05T15:31:25.406Z（同为 `players.updated_at` 的批标记）
数据源：生产 whl-club **只读**（wrangler d1 execute --remote 的 SELECT，未发任何写语句）
目标赛季：season=9（seasons.status='preparing' 最新一条）
口径：训练营 = 持训练营合同（contracts.contract_type='trainee'、is_active=1）⇒ registrations.squad='trainee'；
同队其余 = 'first_team'；训练营球员同时写 players.status='trainee'。

## 总计

- 20 队 **570 行** registrations（first_team 501 + trainee 69）
- 训练营 **69 人**；写 status='trainee' 的 id 清单见 `sql/03-status-trainee.sql`
- CPU 两队单列：曼城(CPU) 28（全一线队，训练营 0）；AC米兰(CPU) 25（全一线队，训练营 0）
- 训练营球员可成长且 PA−CA＞0（trainee_growth 口径）：69/69
- 合同类型分布（注册口径）：formal 399 / trainee 69 / 无合同 53 / normal 49
- club_id 落在本批 20 队但 status 不在 ('normal','listed') 的球员：0 人

## 逐队拆分（实际 vs 计划 §2.2c）

| 队 | club_id | 总计 | 一线队 | 训练营 | 计划（总计） | 对账 |
| --- | --- | --- | --- | --- | --- | --- |
| 阿森纳 | 1 | 30 | 26 | 4 | 30（训练营 4） | ✓ |
| 阿斯顿维拉 | 2 | 30 | 30 | 0 | 30（训练营 0） | ✓ |
| 切尔西 | 5 | 31 | 26 | 5 | 31（训练营 5） | ✓ |
| 利物浦 | 9 | 37 | 32 | 5 | 37（训练营 5） | ✓ |
| 曼城(CPU)（CPU） | 10 | 28 | 28 | 0 | 28（训练营 0） | ✓ |
| 曼联 | 11 | 25 | 23 | 2 | 25（训练营 2） | ✓ |
| 纽卡斯尔联 | 13 | 23 | 19 | 4 | 23（训练营 4） | ✓ |
| 诺丁汉森林 | 14 | 23 | 21 | 2 | 23（训练营 2） | ✓ |
| 拜仁慕尼黑 | 21 | 37 | 30 | 7 | 37（训练营 7） | ✓ |
| 慕尼黑1860 | 33 | 26 | 23 | 3 | 26（训练营 3） | ✓ |
| 尤文图斯 | 45 | 31 | 27 | 4 | 31（训练营 4） | ✓ |
| 里昂 | 66 | 31 | 27 | 4 | 31（训练营 4） | ✓ |
| 巴黎圣日耳曼 | 73 | 29 | 24 | 5 | 29（训练营 5） | ✓ |
| 巴塞罗那 | 241 | 29 | 23 | 6 | 29（训练营 6） | ✓ |
| 皇家马德里 | 243 | 23 | 22 | 1 | 23（训练营 1） | ✓ |
| 奥林匹亚科斯 | 280 | 30 | 26 | 4 | 30（训练营 4） | ✓ |
| 皇家贝蒂斯 | 449 | 25 | 20 | 5 | 25（训练营 5） | ✓ |
| 佛罗伦萨 | 110374 | 31 | 23 | 8 | 31（训练营 8） | ✓ |
| RB莱比锡 | 112172 | 26 | 26 | 0 | 26（训练营 0） | ✓ |
| AC米兰(CPU)（CPU） | 131681 | 25 | 25 | 0 | 25（训练营 0） | ✓ |

### 与计划的差异

无——逐队与计划 §2.2c 完全一致。

## 训练营 69 人明细（按队）

### 阿森纳（1）：4 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 1832 | 269186 | O. Óskarsson |
| 2453 | 264701 | A. Zakharyan |
| 2486 | 272455 | Pablo Marín |
| 2698 | 277225 | Jon Martín |

### 切尔西（5）：5 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 671 | 259031 | L. Delap |
| 1212 | 264492 | Yeremay |
| 1331 | 275507 | M. Sarr |
| 2808 | 71651 | J. Acheampong |
| 3667 | 71998 | T. George |

### 利物浦（9）：5 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 574 | 248465 | I. Maatsen |
| 641 | 258498 | B. Verbruggen |
| 926 | 270857 | Mateus Fernandes |
| 963 | 275138 | L. Camara |
| 18245 | 77940 | Zhang Haoran |

### 曼联（11）：2 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 287 | 245155 | M. Kudus |
| 3538 | 274445 | K. Konaté |

### 纽卡斯尔联（13）：4 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 847 | 265526 | G. Restes |
| 1709 | 263193 | E. Bitshiabu |
| 2103 | 74463 | Marc Bernal |
| 4530 | 268737 | S. Nypan |

### 诺丁汉森林（14）：2 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 158 | 272449 | Pablo Barrios |
| 215 | 256853 | M. Tillman |

### 拜仁慕尼黑（21）：7 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 2413 | 71178 | S. El Mala |
| 2840 | 276372 | I. Ansah |
| 3768 | 276602 | A. Ouédraogo |
| 4268 | 268259 | N. Weiper |
| 5255 | 268916 | M. Krattenmacher |
| 6325 | 78063 | L. Karl |
| 7833 | 279622 | N. Aséko |

### 慕尼黑1860（33）：3 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 370 | 259377 | Yeremy Pino |
| 830 | 264298 | C. Bradley |
| 1146 | 277295 | O. Bobb |

### 尤文图斯（45）：4 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 1825 | 277211 | Franculino |
| 3407 | 262027 | T. Muharemović |
| 5429 | 74071 | R. Floriani Mussolini |
| 7375 | 75085 | V. Adžić |

### 里昂（66）：4 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 730 | 250789 | D. Bakwa |
| 1438 | 275048 | C. Talbi |
| 1697 | 278903 | J. Jacquet |
| 1702 | 272785 | C. Mawissa |

### 巴黎圣日耳曼（73）：5 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 333 | 259516 | Johnny Cardoso |
| 884 | 268421 | M. Tel |
| 946 | 72997 | Rodrigo Mora |
| 1156 | 276295 | T. Barry |
| 1292 | 70004 | S. Mayulu |

### 巴塞罗那（241）：6 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 802 | 256325 | J. Šutalo |
| 831 | 260815 | Arnau Martínez |
| 925 | 274288 | O. Gloukh |
| 1255 | 263370 | V. Barco |
| 1432 | 260952 | A. Schjelderup |
| 2150 | 265774 | K. De Winter |

### 皇家马德里（243）：1 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 951 | 279173 | F. Mastantuono |

### 奥林匹亚科斯（280）：4 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 1707 | 266160 | Mika Mármol |
| 5296 | 74209 | Antoñito Cordero |
| 10796 | 260443 | S. Ibrahim |
| 17088 | 77812 | Xuan Zhijian |

### 皇家贝蒂斯（449）：5 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 420 | 279604 | Jauregizar |
| 794 | 277537 | Natan |
| 1003 | 276471 | Altimira |
| 4508 | 76739 | Pablo García |
| 4831 | 76740 | Ángel Ortiz |

### 佛罗伦萨（110374）：8 人

| player_id | fc_id | 姓名 |
| --- | --- | --- |
| 1045 | 273906 | Renato Veiga |
| 2141 | 278340 | P. Comuzzo |
| 3032 | 266041 | L. Koleosho |
| 3074 | 275291 | N. Pisilli |
| 4515 | 276682 | C. Ndour |
| 6170 | 271575 | S. Pafundi |
| 14970 | 76396 | A. Natali |
| 18229 | 77786 | Li Ruiyue |

## 工件与哈希

- `sql/01-precheck.sql` sha256 `a5e5be93507313076ed88808a82db28e07395059d77dc284089c323825d192c3`
- `sql/02-registrations.sql` sha256 `fe04e72a016660c2da0c99d2ccc7691be0866fc95673324768ab8fdedfafc4df`
- `sql/03-status-trainee.sql` sha256 `1034aa7389efb4cb1845ac032411b44c2191520c5e2031326b437e893e3ba2d4`
- `sql/04-verify.sql` sha256 `2220c9d78f9e25d7f4931b48deb53fb7838331c89a766102f2c928f56ff9c327`
- `rollback/01-rollback.sql` sha256 `68c04d78301df2477c2e35e2227b5dfe51c3a49384f849ca34412aac74a09554`

## 执行（人工，另等令）

```
node exec-shards.mjs sql/01-precheck.sql --remote --yes          # 只读预检，期望 20 / 570 / 69 / 0 且 status 全 normal
node exec-shards.mjs sql/02-registrations.sql --remote --yes --retry=3  # 写批①：DELETE 清底 + 570 行 INSERT（changes 合计 570）
node exec-shards.mjs sql/03-status-trainee.sql --remote --yes --retry=3 # 写批②：69 人 status='trainee'（changes 69）
node exec-shards.mjs sql/04-verify.sql --remote --yes            # 只读验收，期望 570 / 69 / 501 / stray 0
node exec-shards.mjs rollback/01-rollback.sql --remote --yes     # 回滚（如需）：删 570 行 + 69 人 status 回 normal
```

注意：`--remote` 不带 `--yes` 只打印批计划（dry-run）；写批前必须先翻 `squads_include_trainee=true`（顺序铁律）。
`--verify` 模式可把生产现状与本 manifest 逐行比对（漂移检测，只读）。
