# 球员库导入报告（FC26db Base → players）

源文件：`E:/Downloads/FC26db20251217_fixed.xlsx`｜表 `Base`｜数据行 18407
去重：源侧重复 ID 76 个（整行同内容，保留首行）→ 唯一行 18331
可入库：**18301**｜被校验拦下：30
分片：19 个文件（每片 1000 行），目录 `scripts/players-import/sql/`
未来之星名单（Growth+）：104 人｜命中导入行 104 人

## 字段口径

| 列 | 来源 |
| --- | --- |
| uid / fc_id | `fc{ID}` / `ID`（EA 球员 id，ON CONFLICT(fc_id) upsert 幂等） |
| name | `Name` |
| ca / pa / base_ca | `CA` / `PA`（base_ca = 导入时 CA，§10.4 换版基准） |
| age | `Age` |
| foot | `FootID` 1右→1、2左→0 |
| position | `PosID1` → PositionID 表（-1/未知 → NULL） |
| prestige | `internationalrep` 原值（#N/A → NULL） |
| china_plan | `naID`=155（China PR）置 1 |
| growable | 规则 4.1.1：导入时年龄 ≤25 置 1，赛季结算再重判 |
| is_future_star | Growth+ 名单建议值（管理组终审口径） |
| game_attrs | FC26db 71 列 ID-only JSON（TECH_DESIGN §5.2） |

`club_id` 不在导入列内（import 管线裁决：只写 FC 源列，不碰运营列）——导入后全体为未归属，绑队另行处理。

## 分片清单

`sha256` 是写入生产 D1 的逐字节内容（`npx wrangler d1 execute whl-club --remote --file <片>`）。
生成物目录不进版本库（见 `.gitignore`），本清单即入库的审计凭据；重跑脚本可逐字节复现。

| 分片 | 行区间 | 行数 | 字节 | sha256 |
| --- | --- | --- | --- | --- |
| players-import-01.sql | 1-1000 | 1000 | 1692846 | `b7c8ce2d539ea3633353afc935922357146cf4051ee7d07109dd05041e62cda3` |
| players-import-02.sql | 1001-2000 | 1000 | 1692274 | `d1278a5d2cd94fa20b425041f6837327a267eeecaeab93f09b75b1a92761aa0c` |
| players-import-03.sql | 2001-3000 | 1000 | 1692087 | `21a5000c420895104069874679c6691197331de83a185f72a686d51e0dde8679` |
| players-import-04.sql | 3001-4000 | 1000 | 1692207 | `02e20fcbb4719014bf3792ee10e0d2f7ccbe6df68aca802c52446521c6e95826` |
| players-import-05.sql | 4001-5000 | 1000 | 1691668 | `032f574d6fed4d21d41d887f9986f990795ceafd6f4b7d7335ffe0b9950922b1` |
| players-import-06.sql | 5001-6000 | 1000 | 1691784 | `1433c7d28454fcec3ffd289285a1368db35d0e3dafbf60d65d6013a3ba0f30d1` |
| players-import-07.sql | 6001-7000 | 1000 | 1691582 | `7b47b409c5b1502c4588e684fe323aaf4051d89bebd49e3e4bc94107a43cdd5d` |
| players-import-08.sql | 7001-8000 | 1000 | 1691591 | `a125786b076714be2b55caea4dea5bd06e8080aa09dfbf52976c759ef4b336f1` |
| players-import-09.sql | 8001-9000 | 1000 | 1691393 | `531ed302ce7fa1b21aa0c09ffa1b38805dd66b3d4299930b8059df173eba1ed3` |
| players-import-10.sql | 9001-10000 | 1000 | 1690968 | `ddecc9251229a9e571525f2c45f2dcf5a922457210cbeb7a46f32d2c74794a7d` |
| players-import-11.sql | 10001-11000 | 1000 | 1690524 | `28cda40d9a15da7b0e4f85df46209c83a4cad2581f5982728b0f3102075d1edb` |
| players-import-12.sql | 11001-12000 | 1000 | 1690255 | `806f86ff60a44a3a92878ff001889787a761078a49ffeed02f84cf449bd6d667` |
| players-import-13.sql | 12001-13000 | 1000 | 1690029 | `4aaa865519ba27b80adca124f68be2e8880cd3f501513e90268de4743d222145` |
| players-import-14.sql | 13001-14000 | 1000 | 1689822 | `f75cb56c75cf0bce0b9e8388b8932a9ea1b54e7f66b1f9edafb9fa9401b13704` |
| players-import-15.sql | 14001-15000 | 1000 | 1689125 | `621424513b8f57b620a3f3862264b5b14e231f58f19dcd68b93d39d703ae121b` |
| players-import-16.sql | 15001-16000 | 1000 | 1688746 | `436780bc8df678a7d53dee3448b1d48ba7bbb9d35f8e3674383719736248f3f2` |
| players-import-17.sql | 16001-17000 | 1000 | 1688242 | `48bcb0051709bedbdb264dcefb0cbbaff8221f4e605641fdba87eed4cc5bc6da` |
| players-import-18.sql | 17001-18000 | 1000 | 1688509 | `1a779a267f2b5d3c294d00b2410a2ed60a4418345aaadc3755b9d105224c0864` |
| players-import-19.sql | 18001-18301 | 301 | 508612 | `8c9e570a4ef12718c45a98fa218a592120b2d8216ebac9f21cfb376b5944dbdf` |

## 被拦下的行

| 源表行号 | ID | 姓名 | 字段 | 原因 |
| --- | --- | --- | --- | --- |
| 1922 | 253108 | M. Cham | naID | naID 缺失 |
| 3599 | 231616 | E. Riis | naID | naID 缺失 |
| 4355 | 259465 | I. Jensen | naID | naID 缺失 |
| 5101 | 271710 | B. Yusuf | naID | naID 缺失 |
| 5312 | 209973 | J. Nsame | naID | naID 缺失 |
| 5669 | 242222 | L. Selahi | naID | naID 缺失 |
| 6011 | 228101 | G. Cotugno | naID | naID 缺失 |
| 6228 | 216698 | M. García | naID | naID 缺失 |
| 6235 | 198131 | G. Grozav | naID | naID 缺失 |
| 6762 | 246422 | Sidnei Tavares | naID | naID 缺失 |
| 7201 | 210876 | B. Hüseynov | naID | naID 缺失 |
| 8841 | 76537 | João Paulo | naID | naID 缺失 |
| 9466 | 233190 | D. Palacio | naID | naID 缺失 |
| 9737 | 199044 | J. Bokila | naID | naID 缺失 |
| 9764 | 73990 | Pau Cabanes | naID | naID 缺失 |
| 9813 | 236617 | T. Vlietinck | naID | naID 缺失 |
| 9967 | 72269 | L. Kourouma | naID | naID 缺失 |
| 10358 | 71450 | M. Bundgaard | naID | naID 缺失 |
| 11805 | 252884 | D. Jefferies | naID | naID 缺失 |
| 12225 | 266898 | L. Etoga | naID | naID 缺失 |
| 13844 | 75502 | P. Ba | naID | naID 缺失 |
| 14093 | 243790 | Wang Zhen'ao | naID | naID 缺失 |
| 14553 | 239783 | G. Garner | naID | naID 缺失 |
| 15606 | 266632 | L. Liș | naID | naID 缺失 |
| 16528 | 280142 | D. Ruward | naID | naID 缺失 |
| 17720 | 271255 | A. Abdulrauof | naID | naID 缺失 |
| 17980 | 277856 | J. Collins | naID | naID 缺失 |
| 18037 | 71438 | A. Kuzhiyil | naID | naID 缺失 |
| 18281 | 73274 | D. Meitei | naID | naID 缺失 |
| 18296 | 277518 | He Xiaoke | naID | naID 缺失 |

说明：`naID 缺失` 的 30 行源值是 `#N/A`（FC26db 国籍反查未命中），backup 版同样为 `#N/A`，本地无源可补；国际声望同步缺失。补齐后重跑即幂等入账。
