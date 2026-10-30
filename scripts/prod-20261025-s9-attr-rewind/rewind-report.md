# S9 属性回写批 · 生成报告

- 生成时点：2026-10-30T16:25:52.072Z
- 源（初始属性）：E:/Downloads/FC26db20251217_fixed.xlsx 的 Base sheet（ID 列对 fc_id）
- 源（S9 写入值）：scripts/prod-20260920-s9-abilities/sql/abilities-update-01.sql + scripts/prod-20260920-s9-abilities/sql/abilities-update-02.sql（解析自 UPDATE 语句的 json_set）
- 覆盖：254 人 / 2336 个 34 项属性键（守卫键数相同）
- 分片：6 片（每片 ≤ 50 人），落 C:\Users\bhdjb\whlProgram\WHL-club-operations-platform\scripts\prod-20261025-s9-attr-rewind\sql（.gitignore 忽略，可由本生成器逐字复现）
- updated_at：2026-10-30T16:25:52.072Z

## 1 S9 写入值 − FC26db 原值 分布（handoff §3 实测口径，应全为正）

- +1: 1074
- +2: 748
- +3: 276
- +4: 129
- +5: 60
- +6: 19
- +7: 9
- +8: 20
- +9: 1

## 2 分片清单

| 分片 | 人数 | 键数 | 字节 | sha256 |
|---|---|---|---|---|
| sql/01-rewind.sql | 50 | 478 | 41258 | 19ade2111c032c80… |
| sql/02-rewind.sql | 50 | 395 | 35515 | 464a90ab66272d8d… |
| sql/03-rewind.sql | 50 | 458 | 40120 | b569d1d0d1b980d5… |
| sql/04-rewind.sql | 50 | 469 | 40976 | 2991017f9694ac85… |
| sql/05-rewind.sql | 50 | 487 | 42091 | c8abc3a7fe86e2d7… |
| sql/06-rewind.sql | 4 | 49 | 4460 | 3a0f5c914ed776aa… |

## 3 每人键数分布

1键×22人、2键×12人、3键×8人、4键×6人、5键×9人、6键×17人、7键×4人、8键×4人、9键×5人、10键×10人、11键×7人、12键×137人、13键×13人

## 4 逐人逐键比对（FC26db 原值 ← S9 写入值）

| fc_id | 姓名 | 键 | FC26db 原值 | S9 写入值 | 差(S9−原) |
|---|---|---|---|---|---|
| 70004 | S. Mayulu | ballcontrol | 81 | 83 | +2 |
| 70004 | S. Mayulu | dribbling | 78 | 80 | +2 |
| 70004 | S. Mayulu | finishing | 73 | 74 | +1 |
| 70004 | S. Mayulu | interceptions | 69 | 71 | +2 |
| 70004 | S. Mayulu | longpassing | 74 | 76 | +2 |
| 70004 | S. Mayulu | longshots | 68 | 69 | +1 |
| 70004 | S. Mayulu | positioning | 79 | 81 | +2 |
| 70004 | S. Mayulu | reactions | 73 | 75 | +2 |
| 70004 | S. Mayulu | shortpassing | 78 | 80 | +2 |
| 70004 | S. Mayulu | stamina | 75 | 77 | +2 |
| 70004 | S. Mayulu | standingtackle | 67 | 68 | +1 |
| 70004 | S. Mayulu | vision | 76 | 78 | +2 |
| 70497 | K. Karetsas | acceleration | 85 | 86 | +1 |
| 70497 | K. Karetsas | agility | 88 | 89 | +1 |
| 70497 | K. Karetsas | ballcontrol | 77 | 79 | +2 |
| 70497 | K. Karetsas | dribbling | 79 | 81 | +2 |
| 70497 | K. Karetsas | finishing | 66 | 67 | +1 |
| 70497 | K. Karetsas | longpassing | 71 | 72 | +1 |
| 70497 | K. Karetsas | longshots | 70 | 71 | +1 |
| 70497 | K. Karetsas | positioning | 59 | 61 | +2 |
| 70497 | K. Karetsas | reactions | 55 | 57 | +2 |
| 70497 | K. Karetsas | shortpassing | 73 | 75 | +2 |
| 70497 | K. Karetsas | sprintspeed | 69 | 70 | +1 |
| 70497 | K. Karetsas | vision | 72 | 74 | +2 |
| 70888 | A. Khalaili | acceleration | 78 | 81 | +3 |
| 70888 | A. Khalaili | ballcontrol | 79 | 82 | +3 |
| 70888 | A. Khalaili | crossing | 72 | 75 | +3 |
| 70888 | A. Khalaili | dribbling | 78 | 81 | +3 |
| 70888 | A. Khalaili | finishing | 78 | 81 | +3 |
| 70888 | A. Khalaili | longpassing | 65 | 68 | +3 |
| 70888 | A. Khalaili | positioning | 70 | 73 | +3 |
| 70888 | A. Khalaili | reactions | 65 | 68 | +3 |
| 70888 | A. Khalaili | shortpassing | 65 | 68 | +3 |
| 70888 | A. Khalaili | sprintspeed | 83 | 86 | +3 |
| 70888 | A. Khalaili | stamina | 82 | 85 | +3 |
| 70888 | A. Khalaili | vision | 70 | 73 | +3 |
| 71178 | S. El Mala | acceleration | 79 | 80 | +1 |
| 71178 | S. El Mala | ballcontrol | 74 | 76 | +2 |
| 71178 | S. El Mala | crossing | 61 | 63 | +2 |
| 71178 | S. El Mala | dribbling | 85 | 87 | +2 |
| 71178 | S. El Mala | finishing | 72 | 73 | +1 |
| 71178 | S. El Mala | longpassing | 59 | 60 | +1 |
| 71178 | S. El Mala | positioning | 72 | 73 | +1 |
| 71178 | S. El Mala | reactions | 71 | 72 | +1 |
| 71178 | S. El Mala | shortpassing | 69 | 71 | +2 |
| 71178 | S. El Mala | sprintspeed | 79 | 80 | +1 |
| 71178 | S. El Mala | stamina | 60 | 61 | +1 |
| 71178 | S. El Mala | vision | 67 | 68 | +1 |
| 71351 | J. Mokio | aggression | 51 | 52 | +1 |
| 71351 | J. Mokio | ballcontrol | 73 | 74 | +1 |
| 71351 | J. Mokio | defensiveawareness | 69 | 70 | +1 |
| 71351 | J. Mokio | interceptions | 67 | 69 | +2 |
| 71351 | J. Mokio | longpassing | 71 | 72 | +1 |
| 71351 | J. Mokio | reactions | 66 | 67 | +1 |
| 71351 | J. Mokio | shortpassing | 73 | 74 | +1 |
| 71351 | J. Mokio | slidingtackle | 68 | 69 | +1 |
| 71351 | J. Mokio | stamina | 59 | 60 | +1 |
| 71351 | J. Mokio | standingtackle | 71 | 72 | +1 |
| 71351 | J. Mokio | strength | 74 | 75 | +1 |
| 71351 | J. Mokio | vision | 67 | 68 | +1 |
| 71651 | J. Acheampong | aggression | 70 | 72 | +2 |
| 71651 | J. Acheampong | ballcontrol | 70 | 71 | +1 |
| 71651 | J. Acheampong | defensiveawareness | 73 | 75 | +2 |
| 71651 | J. Acheampong | headingaccuracy | 71 | 73 | +2 |
| 71651 | J. Acheampong | interceptions | 72 | 74 | +2 |
| 71651 | J. Acheampong | jumping | 84 | 85 | +1 |
| 71651 | J. Acheampong | reactions | 70 | 72 | +2 |
| 71651 | J. Acheampong | shortpassing | 70 | 72 | +2 |
| 71651 | J. Acheampong | slidingtackle | 72 | 74 | +2 |
| 71651 | J. Acheampong | sprintspeed | 76 | 77 | +1 |
| 71651 | J. Acheampong | standingtackle | 73 | 75 | +2 |
| 71651 | J. Acheampong | strength | 76 | 78 | +2 |
| 71998 | T. George | acceleration | 80 | 81 | +1 |
| 71998 | T. George | ballcontrol | 70 | 71 | +1 |
| 71998 | T. George | crossing | 66 | 67 | +1 |
| 71998 | T. George | dribbling | 72 | 73 | +1 |
| 71998 | T. George | positioning | 68 | 69 | +1 |
| 71998 | T. George | reactions | 68 | 69 | +1 |
| 71998 | T. George | shortpassing | 68 | 69 | +1 |
| 71998 | T. George | vision | 69 | 70 | +1 |
| 72093 | Martim Fernandes | acceleration | 82 | 83 | +1 |
| 72093 | Martim Fernandes | ballcontrol | 75 | 77 | +2 |
| 72093 | Martim Fernandes | crossing | 75 | 77 | +2 |
| 72093 | Martim Fernandes | defensiveawareness | 70 | 72 | +2 |
| 72093 | Martim Fernandes | headingaccuracy | 55 | 56 | +1 |
| 72093 | Martim Fernandes | interceptions | 69 | 71 | +2 |
| 72093 | Martim Fernandes | reactions | 73 | 75 | +2 |
| 72093 | Martim Fernandes | shortpassing | 73 | 74 | +1 |
| 72093 | Martim Fernandes | slidingtackle | 71 | 73 | +2 |
| 72093 | Martim Fernandes | sprintspeed | 81 | 83 | +2 |
| 72093 | Martim Fernandes | stamina | 74 | 76 | +2 |
| 72093 | Martim Fernandes | standingtackle | 73 | 75 | +2 |
| 72159 | M. Moore | acceleration | 77 | 78 | +1 |
| 72159 | M. Moore | agility | 76 | 77 | +1 |
| 72159 | M. Moore | ballcontrol | 72 | 73 | +1 |
| 72159 | M. Moore | crossing | 71 | 72 | +1 |
| 72159 | M. Moore | dribbling | 75 | 76 | +1 |
| 72159 | M. Moore | finishing | 66 | 67 | +1 |
| 72159 | M. Moore | longshots | 69 | 70 | +1 |
| 72159 | M. Moore | positioning | 68 | 69 | +1 |
| 72159 | M. Moore | reactions | 69 | 70 | +1 |
| 72159 | M. Moore | shortpassing | 70 | 71 | +1 |
| 72159 | M. Moore | sprintspeed | 76 | 77 | +1 |
| 72159 | M. Moore | vision | 70 | 71 | +1 |
| 72997 | Rodrigo Mora | acceleration | 80 | 83 | +3 |
| 72997 | Rodrigo Mora | agility | 83 | 86 | +3 |
| 72997 | Rodrigo Mora | ballcontrol | 80 | 84 | +4 |
| 72997 | Rodrigo Mora | dribbling | 78 | 82 | +4 |
| 72997 | Rodrigo Mora | finishing | 70 | 74 | +4 |
| 72997 | Rodrigo Mora | longpassing | 70 | 73 | +3 |
| 72997 | Rodrigo Mora | longshots | 65 | 69 | +4 |
| 72997 | Rodrigo Mora | positioning | 75 | 79 | +4 |
| 72997 | Rodrigo Mora | reactions | 79 | 83 | +4 |
| 72997 | Rodrigo Mora | shortpassing | 78 | 82 | +4 |
| 72997 | Rodrigo Mora | sprintspeed | 74 | 77 | +3 |
| 72997 | Rodrigo Mora | vision | 78 | 82 | +4 |
| 73884 | C. Mouzakitis | ballcontrol | 74 | 79 | +5 |
| 73884 | C. Mouzakitis | dribbling | 72 | 76 | +4 |
| 73884 | C. Mouzakitis | finishing | 59 | 63 | +4 |
| 73884 | C. Mouzakitis | interceptions | 64 | 68 | +4 |
| 73884 | C. Mouzakitis | longpassing | 71 | 76 | +5 |
| 73884 | C. Mouzakitis | longshots | 71 | 75 | +4 |
| 73884 | C. Mouzakitis | positioning | 65 | 69 | +4 |
| 73884 | C. Mouzakitis | reactions | 70 | 75 | +5 |
| 73884 | C. Mouzakitis | shortpassing | 77 | 82 | +5 |
| 73884 | C. Mouzakitis | stamina | 72 | 76 | +4 |
| 73884 | C. Mouzakitis | standingtackle | 62 | 66 | +4 |
| 73884 | C. Mouzakitis | vision | 77 | 82 | +5 |
| 73885 | C. Kostoulas | acceleration | 84 | 88 | +4 |
| 73885 | C. Kostoulas | ballcontrol | 70 | 75 | +5 |
| 73885 | C. Kostoulas | dribbling | 73 | 77 | +4 |
| 73885 | C. Kostoulas | finishing | 73 | 78 | +5 |
| 73885 | C. Kostoulas | headingaccuracy | 72 | 76 | +4 |
| 73885 | C. Kostoulas | longshots | 58 | 62 | +4 |
| 73885 | C. Kostoulas | positioning | 70 | 75 | +5 |
| 73885 | C. Kostoulas | reactions | 69 | 73 | +4 |
| 73885 | C. Kostoulas | shortpassing | 71 | 75 | +4 |
| 73885 | C. Kostoulas | shotpower | 70 | 74 | +4 |
| 73885 | C. Kostoulas | sprintspeed | 87 | 91 | +4 |
| 73885 | C. Kostoulas | strength | 79 | 83 | +4 |
| 73885 | C. Kostoulas | volleys | 58 | 62 | +4 |
| 74071 | R. Floriani Mussolini | acceleration | 68 | 69 | +1 |
| 74071 | R. Floriani Mussolini | ballcontrol | 70 | 71 | +1 |
| 74071 | R. Floriani Mussolini | crossing | 70 | 71 | +1 |
| 74071 | R. Floriani Mussolini | dribbling | 70 | 71 | +1 |
| 74071 | R. Floriani Mussolini | finishing | 51 | 52 | +1 |
| 74071 | R. Floriani Mussolini | positioning | 68 | 69 | +1 |
| 74071 | R. Floriani Mussolini | reactions | 66 | 67 | +1 |
| 74071 | R. Floriani Mussolini | shortpassing | 68 | 69 | +1 |
| 74071 | R. Floriani Mussolini | sprintspeed | 78 | 79 | +1 |
| 74071 | R. Floriani Mussolini | vision | 58 | 59 | +1 |
| 74094 | M. Liberali | acceleration | 75 | 78 | +3 |
| 74094 | M. Liberali | agility | 83 | 86 | +3 |
| 74094 | M. Liberali | ballcontrol | 66 | 70 | +4 |
| 74094 | M. Liberali | crossing | 56 | 60 | +4 |
| 74094 | M. Liberali | dribbling | 65 | 69 | +4 |
| 74094 | M. Liberali | finishing | 61 | 65 | +4 |
| 74094 | M. Liberali | longshots | 56 | 59 | +3 |
| 74094 | M. Liberali | positioning | 65 | 69 | +4 |
| 74094 | M. Liberali | reactions | 67 | 70 | +3 |
| 74094 | M. Liberali | shortpassing | 67 | 70 | +3 |
| 74094 | M. Liberali | sprintspeed | 65 | 68 | +3 |
| 74094 | M. Liberali | vision | 62 | 65 | +3 |
| 74209 | Antoñito Cordero | acceleration | 76 | 79 | +3 |
| 74209 | Antoñito Cordero | ballcontrol | 70 | 74 | +4 |
| 74209 | Antoñito Cordero | crossing | 65 | 69 | +4 |
| 74209 | Antoñito Cordero | dribbling | 71 | 75 | +4 |
| 74209 | Antoñito Cordero | finishing | 64 | 67 | +3 |
| 74209 | Antoñito Cordero | longpassing | 56 | 59 | +3 |
| 74209 | Antoñito Cordero | positioning | 69 | 72 | +3 |
| 74209 | Antoñito Cordero | reactions | 67 | 70 | +3 |
| 74209 | Antoñito Cordero | shortpassing | 65 | 69 | +4 |
| 74209 | Antoñito Cordero | sprintspeed | 79 | 82 | +3 |
| 74209 | Antoñito Cordero | stamina | 63 | 66 | +3 |
| 74209 | Antoñito Cordero | vision | 65 | 68 | +3 |
| 74463 | Marc Bernal | aggression | 69 | 72 | +3 |
| 74463 | Marc Bernal | ballcontrol | 76 | 79 | +3 |
| 74463 | Marc Bernal | defensiveawareness | 68 | 71 | +3 |
| 74463 | Marc Bernal | interceptions | 71 | 74 | +3 |
| 74463 | Marc Bernal | longpassing | 74 | 77 | +3 |
| 74463 | Marc Bernal | reactions | 73 | 76 | +3 |
| 74463 | Marc Bernal | shortpassing | 78 | 81 | +3 |
| 74463 | Marc Bernal | slidingtackle | 73 | 76 | +3 |
| 74463 | Marc Bernal | stamina | 62 | 65 | +3 |
| 74463 | Marc Bernal | standingtackle | 75 | 78 | +3 |
| 74463 | Marc Bernal | strength | 69 | 72 | +3 |
| 74463 | Marc Bernal | vision | 72 | 74 | +2 |
| 75085 | V. Adžić | acceleration | 66 | 67 | +1 |
| 75085 | V. Adžić | ballcontrol | 69 | 70 | +1 |
| 75085 | V. Adžić | dribbling | 70 | 71 | +1 |
| 75085 | V. Adžić | finishing | 68 | 69 | +1 |
| 75085 | V. Adžić | longpassing | 65 | 66 | +1 |
| 75085 | V. Adžić | longshots | 67 | 68 | +1 |
| 75085 | V. Adžić | positioning | 65 | 66 | +1 |
| 75085 | V. Adžić | reactions | 65 | 66 | +1 |
| 75085 | V. Adžić | shortpassing | 68 | 69 | +1 |
| 75085 | V. Adžić | vision | 61 | 62 | +1 |
| 76396 | A. Natali | aggression | 55 | 59 | +4 |
| 76396 | A. Natali | ballcontrol | 57 | 60 | +3 |
| 76396 | A. Natali | defensiveawareness | 59 | 63 | +4 |
| 76396 | A. Natali | headingaccuracy | 59 | 63 | +4 |
| 76396 | A. Natali | interceptions | 60 | 64 | +4 |
| 76396 | A. Natali | jumping | 62 | 65 | +3 |
| 76396 | A. Natali | reactions | 57 | 60 | +3 |
| 76396 | A. Natali | shortpassing | 62 | 65 | +3 |
| 76396 | A. Natali | slidingtackle | 58 | 62 | +4 |
| 76396 | A. Natali | sprintspeed | 60 | 63 | +3 |
| 76396 | A. Natali | standingtackle | 62 | 66 | +4 |
| 76396 | A. Natali | strength | 63 | 67 | +4 |
| 76624 | Vitor Reis | aggression | 69 | 71 | +2 |
| 76624 | Vitor Reis | ballcontrol | 67 | 69 | +2 |
| 76624 | Vitor Reis | defensiveawareness | 71 | 74 | +3 |
| 76624 | Vitor Reis | headingaccuracy | 70 | 73 | +3 |
| 76624 | Vitor Reis | interceptions | 72 | 75 | +3 |
| 76624 | Vitor Reis | jumping | 74 | 76 | +2 |
| 76624 | Vitor Reis | reactions | 69 | 71 | +2 |
| 76624 | Vitor Reis | shortpassing | 73 | 75 | +2 |
| 76624 | Vitor Reis | slidingtackle | 70 | 73 | +3 |
| 76624 | Vitor Reis | sprintspeed | 74 | 76 | +2 |
| 76624 | Vitor Reis | standingtackle | 72 | 75 | +3 |
| 76624 | Vitor Reis | strength | 70 | 73 | +3 |
| 76687 | Estêvão | acceleration | 91 | 93 | +2 |
| 76687 | Estêvão | ballcontrol | 81 | 83 | +2 |
| 76687 | Estêvão | crossing | 77 | 79 | +2 |
| 76687 | Estêvão | dribbling | 84 | 86 | +2 |
| 76687 | Estêvão | finishing | 74 | 76 | +2 |
| 76687 | Estêvão | longpassing | 69 | 71 | +2 |
| 76687 | Estêvão | positioning | 75 | 77 | +2 |
| 76687 | Estêvão | reactions | 74 | 76 | +2 |
| 76687 | Estêvão | shortpassing | 75 | 77 | +2 |
| 76687 | Estêvão | sprintspeed | 89 | 91 | +2 |
| 76687 | Estêvão | stamina | 67 | 69 | +2 |
| 76687 | Estêvão | vision | 75 | 77 | +2 |
| 76739 | Pablo García | acceleration | 79 | 81 | +2 |
| 76739 | Pablo García | ballcontrol | 70 | 72 | +2 |
| 76739 | Pablo García | crossing | 61 | 63 | +2 |
| 76739 | Pablo García | dribbling | 71 | 73 | +2 |
| 76739 | Pablo García | finishing | 67 | 69 | +2 |
| 76739 | Pablo García | longpassing | 62 | 64 | +2 |
| 76739 | Pablo García | positioning | 69 | 71 | +2 |
| 76739 | Pablo García | reactions | 64 | 66 | +2 |
| 76739 | Pablo García | shortpassing | 68 | 70 | +2 |
| 76739 | Pablo García | sprintspeed | 79 | 81 | +2 |
| 76739 | Pablo García | stamina | 59 | 61 | +2 |
| 76739 | Pablo García | vision | 69 | 71 | +2 |
| 76740 | Ángel Ortiz | crossing | 68 | 69 | +1 |
| 76740 | Ángel Ortiz | interceptions | 67 | 68 | +1 |
| 76740 | Ángel Ortiz | reactions | 68 | 69 | +1 |
| 76740 | Ángel Ortiz | slidingtackle | 65 | 66 | +1 |
| 76740 | Ángel Ortiz | stamina | 72 | 73 | +1 |
| 76740 | Ángel Ortiz | standingtackle | 66 | 67 | +1 |
| 77573 | Li Hao | gkdiving | 61 | 65 | +4 |
| 77573 | Li Hao | gkhandling | 59 | 63 | +4 |
| 77573 | Li Hao | gkkicking | 57 | 60 | +3 |
| 77573 | Li Hao | gkpositioning | 62 | 66 | +4 |
| 77573 | Li Hao | gkreflexes | 67 | 71 | +4 |
| 77573 | Li Hao | reactions | 59 | 63 | +4 |
| 77786 | Li Ruiyue | aggression | 55 | 62 | +7 |
| 77786 | Li Ruiyue | ballcontrol | 35 | 43 | +8 |
| 77786 | Li Ruiyue | defensiveawareness | 51 | 59 | +8 |
| 77786 | Li Ruiyue | interceptions | 40 | 48 | +8 |
| 77786 | Li Ruiyue | longpassing | 46 | 54 | +8 |
| 77786 | Li Ruiyue | reactions | 49 | 56 | +7 |
| 77786 | Li Ruiyue | shortpassing | 46 | 54 | +8 |
| 77786 | Li Ruiyue | slidingtackle | 46 | 53 | +7 |
| 77786 | Li Ruiyue | stamina | 64 | 71 | +7 |
| 77786 | Li Ruiyue | standingtackle | 46 | 54 | +8 |
| 77786 | Li Ruiyue | strength | 66 | 73 | +7 |
| 77786 | Li Ruiyue | vision | 42 | 49 | +7 |
| 77812 | Xuan Zhijian | acceleration | 72 | 77 | +5 |
| 77812 | Xuan Zhijian | ballcontrol | 47 | 52 | +5 |
| 77812 | Xuan Zhijian | crossing | 49 | 54 | +5 |
| 77812 | Xuan Zhijian | defensiveawareness | 50 | 55 | +5 |
| 77812 | Xuan Zhijian | headingaccuracy | 47 | 51 | +4 |
| 77812 | Xuan Zhijian | interceptions | 49 | 54 | +5 |
| 77812 | Xuan Zhijian | reactions | 49 | 54 | +5 |
| 77812 | Xuan Zhijian | shortpassing | 48 | 53 | +5 |
| 77812 | Xuan Zhijian | slidingtackle | 48 | 53 | +5 |
| 77812 | Xuan Zhijian | sprintspeed | 54 | 59 | +5 |
| 77812 | Xuan Zhijian | stamina | 75 | 80 | +5 |
| 77812 | Xuan Zhijian | standingtackle | 52 | 57 | +5 |
| 77940 | Zhang Haoran | gkdiving | 52 | 60 | +8 |
| 77940 | Zhang Haoran | gkhandling | 49 | 57 | +8 |
| 77940 | Zhang Haoran | gkkicking | 51 | 58 | +7 |
| 77940 | Zhang Haoran | gkpositioning | 47 | 54 | +7 |
| 77940 | Zhang Haoran | gkreflexes | 48 | 56 | +8 |
| 77940 | Zhang Haoran | reactions | 30 | 37 | +7 |
| 78063 | L. Karl | acceleration | 70 | 72 | +2 |
| 78063 | L. Karl | agility | 77 | 79 | +2 |
| 78063 | L. Karl | ballcontrol | 74 | 76 | +2 |
| 78063 | L. Karl | dribbling | 76 | 78 | +2 |
| 78063 | L. Karl | finishing | 62 | 64 | +2 |
| 78063 | L. Karl | longpassing | 57 | 59 | +2 |
| 78063 | L. Karl | longshots | 70 | 72 | +2 |
| 78063 | L. Karl | positioning | 64 | 66 | +2 |
| 78063 | L. Karl | reactions | 58 | 60 | +2 |
| 78063 | L. Karl | shortpassing | 62 | 64 | +2 |
| 78063 | L. Karl | sprintspeed | 68 | 70 | +2 |
| 78063 | L. Karl | vision | 68 | 70 | +2 |
| 231410 | Brahim | ballcontrol | 85 | 86 | +1 |
| 231410 | Brahim | dribbling | 84 | 85 | +1 |
| 231410 | Brahim | shortpassing | 82 | 83 | +1 |
| 233731 | A. Isak | ballcontrol | 86 | 87 | +1 |
| 233731 | A. Isak | finishing | 90 | 91 | +1 |
| 233731 | A. Isak | positioning | 89 | 90 | +1 |
| 234396 | A. Davies | acceleration | 95 | 96 | +1 |
| 234396 | A. Davies | ballcontrol | 85 | 86 | +1 |
| 234396 | A. Davies | crossing | 85 | 86 | +1 |
| 234396 | A. Davies | defensiveawareness | 72 | 73 | +1 |
| 234396 | A. Davies | headingaccuracy | 74 | 75 | +1 |
| 234396 | A. Davies | interceptions | 79 | 80 | +1 |
| 234396 | A. Davies | reactions | 86 | 87 | +1 |
| 234396 | A. Davies | shortpassing | 84 | 85 | +1 |
| 234396 | A. Davies | slidingtackle | 73 | 74 | +1 |
| 234396 | A. Davies | sprintspeed | 93 | 94 | +1 |
| 234396 | A. Davies | stamina | 79 | 80 | +1 |
| 234396 | A. Davies | standingtackle | 74 | 75 | +1 |
| 234577 | Diogo Costa | gkdiving | 83 | 85 | +2 |
| 234577 | Diogo Costa | gkhandling | 78 | 80 | +2 |
| 234577 | Diogo Costa | gkkicking | 82 | 84 | +2 |
| 234577 | Diogo Costa | gkpositioning | 83 | 85 | +2 |
| 234577 | Diogo Costa | gkreflexes | 86 | 88 | +2 |
| 234577 | Diogo Costa | reactions | 83 | 85 | +2 |
| 235152 | F. Kadıoğlu | interceptions | 75 | 76 | +1 |
| 235152 | F. Kadıoğlu | slidingtackle | 77 | 78 | +1 |
| 235152 | F. Kadıoğlu | standingtackle | 77 | 78 | +1 |
| 235243 | M. de Ligt | defensiveawareness | 82 | 83 | +1 |
| 235243 | M. de Ligt | standingtackle | 81 | 82 | +1 |
| 236610 | M. Kean | acceleration | 84 | 85 | +1 |
| 236610 | M. Kean | ballcontrol | 83 | 84 | +1 |
| 236610 | M. Kean | dribbling | 82 | 83 | +1 |
| 236610 | M. Kean | finishing | 88 | 89 | +1 |
| 236610 | M. Kean | headingaccuracy | 83 | 84 | +1 |
| 236610 | M. Kean | longshots | 69 | 70 | +1 |
| 236610 | M. Kean | positioning | 86 | 87 | +1 |
| 236610 | M. Kean | reactions | 78 | 79 | +1 |
| 236610 | M. Kean | shortpassing | 68 | 69 | +1 |
| 236610 | M. Kean | shotpower | 87 | 88 | +1 |
| 236610 | M. Kean | sprintspeed | 87 | 88 | +1 |
| 236610 | M. Kean | strength | 72 | 73 | +1 |
| 236772 | D. Szoboszlai | acceleration | 77 | 79 | +2 |
| 236772 | D. Szoboszlai | agility | 78 | 79 | +1 |
| 236772 | D. Szoboszlai | ballcontrol | 86 | 88 | +2 |
| 236772 | D. Szoboszlai | dribbling | 84 | 86 | +2 |
| 236772 | D. Szoboszlai | finishing | 79 | 81 | +2 |
| 236772 | D. Szoboszlai | longpassing | 84 | 86 | +2 |
| 236772 | D. Szoboszlai | longshots | 80 | 82 | +2 |
| 236772 | D. Szoboszlai | positioning | 83 | 85 | +2 |
| 236772 | D. Szoboszlai | reactions | 86 | 88 | +2 |
| 236772 | D. Szoboszlai | shortpassing | 86 | 88 | +2 |
| 236772 | D. Szoboszlai | sprintspeed | 81 | 82 | +1 |
| 236772 | D. Szoboszlai | vision | 84 | 86 | +2 |
| 236987 | B. Kamara | ballcontrol | 80 | 81 | +1 |
| 236987 | B. Kamara | interceptions | 85 | 86 | +1 |
| 236987 | B. Kamara | longpassing | 77 | 78 | +1 |
| 236987 | B. Kamara | shortpassing | 84 | 85 | +1 |
| 236987 | B. Kamara | standingtackle | 86 | 87 | +1 |
| 237692 | P. Foden | ballcontrol | 89 | 90 | +1 |
| 237692 | P. Foden | dribbling | 89 | 90 | +1 |
| 238074 | R. James | crossing | 88 | 89 | +1 |
| 238074 | R. James | defensiveawareness | 83 | 84 | +1 |
| 238074 | R. James | interceptions | 82 | 83 | +1 |
| 238074 | R. James | reactions | 84 | 85 | +1 |
| 238074 | R. James | slidingtackle | 82 | 83 | +1 |
| 238074 | R. James | stamina | 68 | 69 | +1 |
| 238074 | R. James | standingtackle | 83 | 84 | +1 |
| 238616 | Pedro Neto | acceleration | 92 | 93 | +1 |
| 238616 | Pedro Neto | ballcontrol | 82 | 84 | +2 |
| 238616 | Pedro Neto | crossing | 80 | 82 | +2 |
| 238616 | Pedro Neto | dribbling | 83 | 85 | +2 |
| 238616 | Pedro Neto | finishing | 77 | 78 | +1 |
| 238616 | Pedro Neto | longpassing | 67 | 68 | +1 |
| 238616 | Pedro Neto | positioning | 79 | 80 | +1 |
| 238616 | Pedro Neto | reactions | 80 | 81 | +1 |
| 238616 | Pedro Neto | shortpassing | 78 | 80 | +2 |
| 238616 | Pedro Neto | sprintspeed | 90 | 91 | +1 |
| 238616 | Pedro Neto | stamina | 81 | 82 | +1 |
| 238616 | Pedro Neto | vision | 80 | 81 | +1 |
| 238794 | Vini Jr. | acceleration | 95 | 96 | +1 |
| 238794 | Vini Jr. | ballcontrol | 90 | 92 | +2 |
| 238794 | Vini Jr. | crossing | 81 | 82 | +1 |
| 238794 | Vini Jr. | dribbling | 93 | 95 | +2 |
| 238794 | Vini Jr. | finishing | 88 | 89 | +1 |
| 238794 | Vini Jr. | longpassing | 77 | 78 | +1 |
| 238794 | Vini Jr. | positioning | 86 | 87 | +1 |
| 238794 | Vini Jr. | reactions | 85 | 86 | +1 |
| 238794 | Vini Jr. | shortpassing | 83 | 84 | +1 |
| 238794 | Vini Jr. | sprintspeed | 95 | 96 | +1 |
| 238794 | Vini Jr. | stamina | 84 | 85 | +1 |
| 238794 | Vini Jr. | vision | 85 | 86 | +1 |
| 239085 | E. Haaland | acceleration | 80 | 84 | +4 |
| 239085 | E. Haaland | ballcontrol | 83 | 87 | +4 |
| 239085 | E. Haaland | dribbling | 79 | 83 | +4 |
| 239085 | E. Haaland | finishing | 96 | 98 | +2 |
| 239085 | E. Haaland | headingaccuracy | 85 | 89 | +4 |
| 239085 | E. Haaland | longshots | 83 | 84 | +1 |
| 239085 | E. Haaland | positioning | 95 | 98 | +3 |
| 239085 | E. Haaland | reactions | 94 | 98 | +4 |
| 239085 | E. Haaland | shortpassing | 78 | 82 | +4 |
| 239085 | E. Haaland | shotpower | 94 | 98 | +4 |
| 239085 | E. Haaland | sprintspeed | 92 | 96 | +4 |
| 239085 | E. Haaland | strength | 93 | 97 | +4 |
| 239085 | E. Haaland | volleys | 90 | 93 | +3 |
| 239977 | N. Kühn | ballcontrol | 78 | 79 | +1 |
| 239977 | N. Kühn | crossing | 67 | 68 | +1 |
| 239977 | N. Kühn | dribbling | 81 | 82 | +1 |
| 239977 | N. Kühn | finishing | 74 | 75 | +1 |
| 239977 | N. Kühn | positioning | 75 | 76 | +1 |
| 239977 | N. Kühn | shortpassing | 71 | 72 | +1 |
| 241096 | S. Tonali | aggression | 84 | 85 | +1 |
| 241096 | S. Tonali | ballcontrol | 85 | 87 | +2 |
| 241096 | S. Tonali | defensiveawareness | 81 | 83 | +2 |
| 241096 | S. Tonali | interceptions | 84 | 86 | +2 |
| 241096 | S. Tonali | longpassing | 83 | 85 | +2 |
| 241096 | S. Tonali | reactions | 84 | 86 | +2 |
| 241096 | S. Tonali | shortpassing | 86 | 88 | +2 |
| 241096 | S. Tonali | slidingtackle | 81 | 82 | +1 |
| 241096 | S. Tonali | stamina | 87 | 88 | +1 |
| 241096 | S. Tonali | standingtackle | 84 | 86 | +2 |
| 241096 | S. Tonali | strength | 82 | 83 | +1 |
| 241096 | S. Tonali | vision | 79 | 80 | +1 |
| 241159 | M. Guéhi | aggression | 79 | 80 | +1 |
| 241159 | M. Guéhi | ballcontrol | 77 | 78 | +1 |
| 241159 | M. Guéhi | defensiveawareness | 85 | 86 | +1 |
| 241159 | M. Guéhi | headingaccuracy | 81 | 82 | +1 |
| 241159 | M. Guéhi | interceptions | 83 | 84 | +1 |
| 241159 | M. Guéhi | reactions | 85 | 86 | +1 |
| 241159 | M. Guéhi | shortpassing | 80 | 81 | +1 |
| 241159 | M. Guéhi | slidingtackle | 85 | 86 | +1 |
| 241159 | M. Guéhi | standingtackle | 84 | 85 | +1 |
| 241159 | M. Guéhi | strength | 80 | 81 | +1 |
| 241236 | A. Semenyo | acceleration | 78 | 79 | +1 |
| 241236 | A. Semenyo | ballcontrol | 82 | 83 | +1 |
| 241236 | A. Semenyo | crossing | 75 | 76 | +1 |
| 241236 | A. Semenyo | dribbling | 83 | 84 | +1 |
| 241236 | A. Semenyo | positioning | 82 | 83 | +1 |
| 241236 | A. Semenyo | reactions | 81 | 82 | +1 |
| 241236 | A. Semenyo | shortpassing | 76 | 77 | +1 |
| 241236 | A. Semenyo | sprintspeed | 82 | 83 | +1 |
| 241236 | A. Semenyo | vision | 77 | 78 | +1 |
| 241436 | C. Bassey | defensiveawareness | 79 | 80 | +1 |
| 241436 | C. Bassey | standingtackle | 78 | 79 | +1 |
| 241461 | Ferran Torres | acceleration | 86 | 89 | +3 |
| 241461 | Ferran Torres | ballcontrol | 84 | 87 | +3 |
| 241461 | Ferran Torres | dribbling | 83 | 86 | +3 |
| 241461 | Ferran Torres | finishing | 86 | 89 | +3 |
| 241461 | Ferran Torres | headingaccuracy | 79 | 82 | +3 |
| 241461 | Ferran Torres | positioning | 85 | 88 | +3 |
| 241461 | Ferran Torres | reactions | 82 | 85 | +3 |
| 241461 | Ferran Torres | shortpassing | 82 | 85 | +3 |
| 241461 | Ferran Torres | shotpower | 82 | 85 | +3 |
| 241461 | Ferran Torres | sprintspeed | 82 | 85 | +3 |
| 241461 | Ferran Torres | strength | 73 | 76 | +3 |
| 241461 | Ferran Torres | volleys | 81 | 84 | +3 |
| 241637 | A. Tchouaméni | aggression | 80 | 81 | +1 |
| 241637 | A. Tchouaméni | ballcontrol | 81 | 82 | +1 |
| 241637 | A. Tchouaméni | defensiveawareness | 81 | 82 | +1 |
| 241637 | A. Tchouaméni | interceptions | 83 | 84 | +1 |
| 241637 | A. Tchouaméni | longpassing | 84 | 85 | +1 |
| 241637 | A. Tchouaméni | reactions | 82 | 83 | +1 |
| 241637 | A. Tchouaméni | shortpassing | 85 | 86 | +1 |
| 241637 | A. Tchouaméni | slidingtackle | 80 | 81 | +1 |
| 241637 | A. Tchouaméni | stamina | 83 | 84 | +1 |
| 241637 | A. Tchouaméni | standingtackle | 83 | 84 | +1 |
| 241637 | A. Tchouaméni | strength | 82 | 83 | +1 |
| 241637 | A. Tchouaméni | vision | 81 | 82 | +1 |
| 241811 | Sergio Gómez | acceleration | 76 | 77 | +1 |
| 241811 | Sergio Gómez | ballcontrol | 79 | 80 | +1 |
| 241811 | Sergio Gómez | crossing | 81 | 82 | +1 |
| 241811 | Sergio Gómez | dribbling | 79 | 80 | +1 |
| 241811 | Sergio Gómez | finishing | 73 | 74 | +1 |
| 241811 | Sergio Gómez | positioning | 75 | 76 | +1 |
| 241811 | Sergio Gómez | reactions | 75 | 76 | +1 |
| 241811 | Sergio Gómez | shortpassing | 81 | 82 | +1 |
| 241811 | Sergio Gómez | sprintspeed | 70 | 71 | +1 |
| 241811 | Sergio Gómez | stamina | 78 | 79 | +1 |
| 241811 | Sergio Gómez | vision | 80 | 81 | +1 |
| 241852 | M. Diaby | dribbling | 89 | 90 | +1 |
| 242444 | João Félix | ballcontrol | 81 | 82 | +1 |
| 242444 | João Félix | dribbling | 82 | 83 | +1 |
| 242444 | João Félix | positioning | 82 | 83 | +1 |
| 242444 | João Félix | shortpassing | 79 | 80 | +1 |
| 242444 | João Félix | vision | 80 | 81 | +1 |
| 242453 | S. van den Berg | defensiveawareness | 78 | 79 | +1 |
| 242453 | S. van den Berg | standingtackle | 80 | 81 | +1 |
| 242530 | N. Okafor | finishing | 78 | 79 | +1 |
| 242530 | N. Okafor | positioning | 76 | 77 | +1 |
| 242641 | R. Aït-Nouri | slidingtackle | 80 | 81 | +1 |
| 242964 | A. Gordon | acceleration | 89 | 90 | +1 |
| 242964 | A. Gordon | ballcontrol | 82 | 83 | +1 |
| 242964 | A. Gordon | crossing | 80 | 81 | +1 |
| 242964 | A. Gordon | dribbling | 84 | 85 | +1 |
| 242964 | A. Gordon | finishing | 78 | 79 | +1 |
| 242964 | A. Gordon | positioning | 80 | 81 | +1 |
| 242964 | A. Gordon | reactions | 82 | 83 | +1 |
| 242964 | A. Gordon | shortpassing | 78 | 79 | +1 |
| 243014 | B. Mbeumo | dribbling | 84 | 85 | +1 |
| 243057 | N. Williams | crossing | 77 | 78 | +1 |
| 243057 | N. Williams | interceptions | 78 | 79 | +1 |
| 243057 | N. Williams | reactions | 78 | 79 | +1 |
| 243057 | N. Williams | slidingtackle | 82 | 83 | +1 |
| 243057 | N. Williams | stamina | 79 | 80 | +1 |
| 243057 | N. Williams | standingtackle | 79 | 80 | +1 |
| 243580 | L. Openda | finishing | 84 | 85 | +1 |
| 243630 | J. David | finishing | 84 | 85 | +1 |
| 243702 | D. Spence | acceleration | 87 | 88 | +1 |
| 243702 | D. Spence | ballcontrol | 78 | 79 | +1 |
| 243702 | D. Spence | crossing | 76 | 77 | +1 |
| 243702 | D. Spence | defensiveawareness | 77 | 78 | +1 |
| 243702 | D. Spence | headingaccuracy | 71 | 72 | +1 |
| 243702 | D. Spence | interceptions | 74 | 75 | +1 |
| 243702 | D. Spence | reactions | 78 | 79 | +1 |
| 243702 | D. Spence | shortpassing | 78 | 79 | +1 |
| 243702 | D. Spence | slidingtackle | 75 | 77 | +2 |
| 243702 | D. Spence | sprintspeed | 88 | 89 | +1 |
| 243702 | D. Spence | stamina | 76 | 77 | +1 |
| 243702 | D. Spence | standingtackle | 77 | 78 | +1 |
| 243715 | W. Saliba | aggression | 83 | 84 | +1 |
| 243715 | W. Saliba | defensiveawareness | 89 | 90 | +1 |
| 243715 | W. Saliba | headingaccuracy | 83 | 84 | +1 |
| 243715 | W. Saliba | interceptions | 88 | 89 | +1 |
| 243715 | W. Saliba | reactions | 87 | 88 | +1 |
| 243715 | W. Saliba | shortpassing | 80 | 81 | +1 |
| 243715 | W. Saliba | slidingtackle | 88 | 89 | +1 |
| 243715 | W. Saliba | standingtackle | 90 | 91 | +1 |
| 243715 | W. Saliba | strength | 88 | 89 | +1 |
| 243812 | Rodrygo | acceleration | 88 | 90 | +2 |
| 243812 | Rodrygo | ballcontrol | 87 | 89 | +2 |
| 243812 | Rodrygo | crossing | 77 | 79 | +2 |
| 243812 | Rodrygo | dribbling | 88 | 90 | +2 |
| 243812 | Rodrygo | finishing | 78 | 80 | +2 |
| 243812 | Rodrygo | longpassing | 72 | 73 | +1 |
| 243812 | Rodrygo | positioning | 82 | 84 | +2 |
| 243812 | Rodrygo | reactions | 82 | 84 | +2 |
| 243812 | Rodrygo | shortpassing | 79 | 81 | +2 |
| 243812 | Rodrygo | sprintspeed | 87 | 89 | +2 |
| 243812 | Rodrygo | stamina | 78 | 80 | +2 |
| 243812 | Rodrygo | vision | 83 | 85 | +2 |
| 244067 | M. Lacroix | aggression | 81 | 83 | +2 |
| 244067 | M. Lacroix | ballcontrol | 69 | 71 | +2 |
| 244067 | M. Lacroix | defensiveawareness | 81 | 83 | +2 |
| 244067 | M. Lacroix | headingaccuracy | 77 | 79 | +2 |
| 244067 | M. Lacroix | interceptions | 83 | 85 | +2 |
| 244067 | M. Lacroix | jumping | 85 | 86 | +1 |
| 244067 | M. Lacroix | reactions | 82 | 84 | +2 |
| 244067 | M. Lacroix | shortpassing | 71 | 73 | +2 |
| 244067 | M. Lacroix | slidingtackle | 79 | 81 | +2 |
| 244067 | M. Lacroix | sprintspeed | 93 | 94 | +1 |
| 244067 | M. Lacroix | standingtackle | 82 | 84 | +2 |
| 244067 | M. Lacroix | strength | 84 | 86 | +2 |
| 244257 | J. Burkardt | acceleration | 82 | 83 | +1 |
| 244257 | J. Burkardt | ballcontrol | 82 | 84 | +2 |
| 244257 | J. Burkardt | dribbling | 82 | 84 | +2 |
| 244257 | J. Burkardt | finishing | 86 | 88 | +2 |
| 244257 | J. Burkardt | headingaccuracy | 74 | 76 | +2 |
| 244257 | J. Burkardt | longshots | 76 | 77 | +1 |
| 244257 | J. Burkardt | positioning | 85 | 87 | +2 |
| 244257 | J. Burkardt | reactions | 83 | 85 | +2 |
| 244257 | J. Burkardt | shortpassing | 74 | 75 | +1 |
| 244257 | J. Burkardt | shotpower | 83 | 85 | +2 |
| 244257 | J. Burkardt | sprintspeed | 83 | 85 | +2 |
| 244257 | J. Burkardt | strength | 76 | 78 | +2 |
| 244257 | J. Burkardt | volleys | 82 | 83 | +1 |
| 244675 | Sancet | ballcontrol | 85 | 86 | +1 |
| 244675 | Sancet | dribbling | 84 | 85 | +1 |
| 244675 | Sancet | shortpassing | 84 | 85 | +1 |
| 244675 | Sancet | vision | 82 | 83 | +1 |
| 244778 | Trincão | ballcontrol | 83 | 84 | +1 |
| 244778 | Trincão | dribbling | 86 | 87 | +1 |
| 244778 | Trincão | positioning | 82 | 83 | +1 |
| 244778 | Trincão | shortpassing | 80 | 81 | +1 |
| 244778 | Trincão | vision | 82 | 83 | +1 |
| 245155 | M. Kudus | dribbling | 88 | 89 | +1 |
| 245367 | X. Simons | ballcontrol | 85 | 86 | +1 |
| 245367 | X. Simons | dribbling | 86 | 87 | +1 |
| 245367 | X. Simons | positioning | 79 | 80 | +1 |
| 245367 | X. Simons | shortpassing | 83 | 84 | +1 |
| 245367 | X. Simons | vision | 84 | 85 | +1 |
| 246104 | R. Gravenberch | ballcontrol | 87 | 88 | +1 |
| 246104 | R. Gravenberch | defensiveawareness | 80 | 81 | +1 |
| 246104 | R. Gravenberch | interceptions | 88 | 89 | +1 |
| 246104 | R. Gravenberch | longpassing | 84 | 85 | +1 |
| 246104 | R. Gravenberch | reactions | 86 | 87 | +1 |
| 246104 | R. Gravenberch | shortpassing | 86 | 87 | +1 |
| 246104 | R. Gravenberch | standingtackle | 82 | 83 | +1 |
| 246147 | M. Greenwood | acceleration | 82 | 84 | +2 |
| 246147 | M. Greenwood | ballcontrol | 85 | 87 | +2 |
| 246147 | M. Greenwood | crossing | 78 | 80 | +2 |
| 246147 | M. Greenwood | dribbling | 84 | 86 | +2 |
| 246147 | M. Greenwood | finishing | 83 | 84 | +1 |
| 246147 | M. Greenwood | longpassing | 76 | 77 | +1 |
| 246147 | M. Greenwood | positioning | 84 | 86 | +2 |
| 246147 | M. Greenwood | reactions | 85 | 86 | +1 |
| 246147 | M. Greenwood | shortpassing | 79 | 81 | +2 |
| 246147 | M. Greenwood | sprintspeed | 84 | 85 | +1 |
| 246147 | M. Greenwood | stamina | 79 | 80 | +1 |
| 246147 | M. Greenwood | vision | 80 | 81 | +1 |
| 246191 | J. Alvarez | acceleration | 86 | 87 | +1 |
| 246191 | J. Alvarez | ballcontrol | 88 | 89 | +1 |
| 246191 | J. Alvarez | dribbling | 87 | 88 | +1 |
| 246191 | J. Alvarez | finishing | 88 | 89 | +1 |
| 246191 | J. Alvarez | headingaccuracy | 78 | 79 | +1 |
| 246191 | J. Alvarez | longshots | 86 | 87 | +1 |
| 246191 | J. Alvarez | positioning | 88 | 89 | +1 |
| 246191 | J. Alvarez | reactions | 88 | 89 | +1 |
| 246191 | J. Alvarez | shortpassing | 83 | 84 | +1 |
| 246191 | J. Alvarez | shotpower | 88 | 89 | +1 |
| 246191 | J. Alvarez | sprintspeed | 85 | 86 | +1 |
| 246191 | J. Alvarez | strength | 72 | 73 | +1 |
| 246191 | J. Alvarez | volleys | 84 | 85 | +1 |
| 246420 | J. Doku | acceleration | 95 | 96 | +1 |
| 246420 | J. Doku | agility | 93 | 94 | +1 |
| 246420 | J. Doku | ballcontrol | 83 | 84 | +1 |
| 246420 | J. Doku | crossing | 80 | 81 | +1 |
| 246420 | J. Doku | dribbling | 91 | 93 | +2 |
| 246420 | J. Doku | finishing | 72 | 73 | +1 |
| 246420 | J. Doku | longshots | 70 | 71 | +1 |
| 246420 | J. Doku | positioning | 79 | 80 | +1 |
| 246420 | J. Doku | reactions | 77 | 78 | +1 |
| 246420 | J. Doku | shortpassing | 78 | 79 | +1 |
| 246420 | J. Doku | sprintspeed | 89 | 90 | +1 |
| 246420 | J. Doku | vision | 80 | 81 | +1 |
| 246606 | Fran García | acceleration | 90 | 91 | +1 |
| 246606 | Fran García | ballcontrol | 77 | 78 | +1 |
| 246606 | Fran García | crossing | 72 | 73 | +1 |
| 246606 | Fran García | defensiveawareness | 68 | 69 | +1 |
| 246606 | Fran García | headingaccuracy | 54 | 55 | +1 |
| 246606 | Fran García | interceptions | 73 | 74 | +1 |
| 246606 | Fran García | reactions | 71 | 72 | +1 |
| 246606 | Fran García | shortpassing | 77 | 78 | +1 |
| 246606 | Fran García | slidingtackle | 73 | 75 | +2 |
| 246606 | Fran García | sprintspeed | 88 | 89 | +1 |
| 246606 | Fran García | stamina | 82 | 83 | +1 |
| 246606 | Fran García | standingtackle | 79 | 80 | +1 |
| 246669 | B. Saka | acceleration | 87 | 88 | +1 |
| 246669 | B. Saka | agility | 85 | 86 | +1 |
| 246669 | B. Saka | ballcontrol | 88 | 89 | +1 |
| 246669 | B. Saka | crossing | 90 | 91 | +1 |
| 246669 | B. Saka | dribbling | 89 | 90 | +1 |
| 246669 | B. Saka | finishing | 84 | 85 | +1 |
| 246669 | B. Saka | longshots | 81 | 82 | +1 |
| 246669 | B. Saka | positioning | 86 | 87 | +1 |
| 246669 | B. Saka | reactions | 88 | 89 | +1 |
| 246669 | B. Saka | shortpassing | 85 | 86 | +1 |
| 246669 | B. Saka | sprintspeed | 81 | 82 | +1 |
| 246669 | B. Saka | vision | 86 | 87 | +1 |
| 246863 | F. Nmecha | ballcontrol | 83 | 85 | +2 |
| 246863 | F. Nmecha | dribbling | 85 | 87 | +2 |
| 246863 | F. Nmecha | finishing | 74 | 75 | +1 |
| 246863 | F. Nmecha | interceptions | 79 | 81 | +2 |
| 246863 | F. Nmecha | longpassing | 83 | 85 | +2 |
| 246863 | F. Nmecha | longshots | 79 | 80 | +1 |
| 246863 | F. Nmecha | positioning | 77 | 79 | +2 |
| 246863 | F. Nmecha | reactions | 84 | 86 | +2 |
| 246863 | F. Nmecha | shortpassing | 84 | 86 | +2 |
| 246863 | F. Nmecha | stamina | 79 | 81 | +2 |
| 246863 | F. Nmecha | standingtackle | 84 | 85 | +1 |
| 246863 | F. Nmecha | vision | 78 | 80 | +2 |
| 246875 | O. Kossounou | aggression | 78 | 81 | +3 |
| 246875 | O. Kossounou | ballcontrol | 69 | 72 | +3 |
| 246875 | O. Kossounou | defensiveawareness | 80 | 83 | +3 |
| 246875 | O. Kossounou | headingaccuracy | 79 | 82 | +3 |
| 246875 | O. Kossounou | interceptions | 81 | 84 | +3 |
| 246875 | O. Kossounou | jumping | 80 | 83 | +3 |
| 246875 | O. Kossounou | reactions | 76 | 79 | +3 |
| 246875 | O. Kossounou | shortpassing | 76 | 79 | +3 |
| 246875 | O. Kossounou | slidingtackle | 80 | 83 | +3 |
| 246875 | O. Kossounou | sprintspeed | 84 | 87 | +3 |
| 246875 | O. Kossounou | standingtackle | 83 | 86 | +3 |
| 246875 | O. Kossounou | strength | 79 | 82 | +3 |
| 247090 | E. Fernández | ballcontrol | 86 | 88 | +2 |
| 247090 | E. Fernández | dribbling | 80 | 81 | +1 |
| 247090 | E. Fernández | finishing | 76 | 77 | +1 |
| 247090 | E. Fernández | interceptions | 74 | 75 | +1 |
| 247090 | E. Fernández | longpassing | 89 | 90 | +1 |
| 247090 | E. Fernández | longshots | 74 | 75 | +1 |
| 247090 | E. Fernández | positioning | 81 | 82 | +1 |
| 247090 | E. Fernández | reactions | 86 | 87 | +1 |
| 247090 | E. Fernández | shortpassing | 88 | 90 | +2 |
| 247090 | E. Fernández | stamina | 86 | 87 | +1 |
| 247090 | E. Fernández | standingtackle | 75 | 76 | +1 |
| 247090 | E. Fernández | vision | 86 | 88 | +2 |
| 247172 | J. Durán | ballcontrol | 79 | 80 | +1 |
| 247172 | J. Durán | finishing | 82 | 83 | +1 |
| 247172 | J. Durán | headingaccuracy | 69 | 70 | +1 |
| 247172 | J. Durán | positioning | 79 | 80 | +1 |
| 247172 | J. Durán | shotpower | 86 | 87 | +1 |
| 247246 | K. Thuram | ballcontrol | 83 | 85 | +2 |
| 247246 | K. Thuram | dribbling | 81 | 83 | +2 |
| 247246 | K. Thuram | finishing | 77 | 78 | +1 |
| 247246 | K. Thuram | interceptions | 81 | 83 | +2 |
| 247246 | K. Thuram | longpassing | 80 | 82 | +2 |
| 247246 | K. Thuram | longshots | 75 | 76 | +1 |
| 247246 | K. Thuram | positioning | 78 | 80 | +2 |
| 247246 | K. Thuram | reactions | 79 | 81 | +2 |
| 247246 | K. Thuram | shortpassing | 83 | 85 | +2 |
| 247246 | K. Thuram | stamina | 81 | 83 | +2 |
| 247246 | K. Thuram | standingtackle | 84 | 86 | +2 |
| 247246 | K. Thuram | vision | 78 | 80 | +2 |
| 247635 | K. Kvaratskhelia | acceleration | 85 | 87 | +2 |
| 247635 | K. Kvaratskhelia | agility | 86 | 87 | +1 |
| 247635 | K. Kvaratskhelia | ballcontrol | 88 | 90 | +2 |
| 247635 | K. Kvaratskhelia | crossing | 79 | 81 | +2 |
| 247635 | K. Kvaratskhelia | dribbling | 89 | 91 | +2 |
| 247635 | K. Kvaratskhelia | finishing | 81 | 83 | +2 |
| 247635 | K. Kvaratskhelia | longshots | 86 | 88 | +2 |
| 247635 | K. Kvaratskhelia | positioning | 87 | 89 | +2 |
| 247635 | K. Kvaratskhelia | reactions | 84 | 86 | +2 |
| 247635 | K. Kvaratskhelia | shortpassing | 87 | 89 | +2 |
| 247635 | K. Kvaratskhelia | sprintspeed | 86 | 88 | +2 |
| 247635 | K. Kvaratskhelia | vision | 85 | 87 | +2 |
| 247649 | J. Branthwaite | standingtackle | 81 | 82 | +1 |
| 247819 | N. Schlotterbeck | defensiveawareness | 87 | 88 | +1 |
| 247819 | N. Schlotterbeck | interceptions | 84 | 85 | +1 |
| 247819 | N. Schlotterbeck | standingtackle | 88 | 89 | +1 |
| 247819 | N. Schlotterbeck | strength | 87 | 88 | +1 |
| 247827 | M. Olise | acceleration | 83 | 84 | +1 |
| 247827 | M. Olise | ballcontrol | 87 | 88 | +1 |
| 247827 | M. Olise | crossing | 80 | 81 | +1 |
| 247827 | M. Olise | dribbling | 88 | 89 | +1 |
| 247827 | M. Olise | finishing | 84 | 85 | +1 |
| 247827 | M. Olise | longpassing | 81 | 82 | +1 |
| 247827 | M. Olise | positioning | 85 | 86 | +1 |
| 247827 | M. Olise | reactions | 86 | 87 | +1 |
| 247827 | M. Olise | shortpassing | 86 | 87 | +1 |
| 247827 | M. Olise | sprintspeed | 74 | 75 | +1 |
| 247827 | M. Olise | stamina | 85 | 86 | +1 |
| 247827 | M. Olise | vision | 88 | 89 | +1 |
| 248243 | E. Camavinga | ballcontrol | 86 | 88 | +2 |
| 248243 | E. Camavinga | dribbling | 84 | 86 | +2 |
| 248243 | E. Camavinga | finishing | 64 | 66 | +2 |
| 248243 | E. Camavinga | interceptions | 82 | 84 | +2 |
| 248243 | E. Camavinga | longpassing | 84 | 86 | +2 |
| 248243 | E. Camavinga | longshots | 70 | 72 | +2 |
| 248243 | E. Camavinga | positioning | 73 | 75 | +2 |
| 248243 | E. Camavinga | reactions | 82 | 84 | +2 |
| 248243 | E. Camavinga | shortpassing | 86 | 88 | +2 |
| 248243 | E. Camavinga | stamina | 84 | 86 | +2 |
| 248243 | E. Camavinga | standingtackle | 82 | 84 | +2 |
| 248243 | E. Camavinga | vision | 83 | 85 | +2 |
| 248465 | I. Maatsen | crossing | 77 | 78 | +1 |
| 248465 | I. Maatsen | interceptions | 76 | 77 | +1 |
| 248465 | I. Maatsen | reactions | 78 | 79 | +1 |
| 248465 | I. Maatsen | slidingtackle | 78 | 79 | +1 |
| 248465 | I. Maatsen | stamina | 74 | 75 | +1 |
| 248465 | I. Maatsen | standingtackle | 72 | 73 | +1 |
| 248550 | Vivian | aggression | 87 | 89 | +2 |
| 248550 | Vivian | ballcontrol | 76 | 78 | +2 |
| 248550 | Vivian | defensiveawareness | 83 | 85 | +2 |
| 248550 | Vivian | headingaccuracy | 80 | 82 | +2 |
| 248550 | Vivian | interceptions | 87 | 89 | +2 |
| 248550 | Vivian | jumping | 89 | 91 | +2 |
| 248550 | Vivian | reactions | 85 | 87 | +2 |
| 248550 | Vivian | shortpassing | 79 | 81 | +2 |
| 248550 | Vivian | slidingtackle | 83 | 85 | +2 |
| 248550 | Vivian | sprintspeed | 78 | 79 | +1 |
| 248550 | Vivian | standingtackle | 85 | 87 | +2 |
| 248550 | Vivian | strength | 83 | 85 | +2 |
| 250753 | A. Trubin | gkdiving | 77 | 78 | +1 |
| 250959 | A. Stiller | aggression | 71 | 73 | +2 |
| 250959 | A. Stiller | ballcontrol | 85 | 87 | +2 |
| 250959 | A. Stiller | defensiveawareness | 77 | 79 | +2 |
| 250959 | A. Stiller | interceptions | 80 | 82 | +2 |
| 250959 | A. Stiller | longpassing | 83 | 85 | +2 |
| 250959 | A. Stiller | reactions | 85 | 87 | +2 |
| 250959 | A. Stiller | shortpassing | 88 | 90 | +2 |
| 250959 | A. Stiller | slidingtackle | 69 | 71 | +2 |
| 250959 | A. Stiller | stamina | 80 | 82 | +2 |
| 250959 | A. Stiller | standingtackle | 78 | 80 | +2 |
| 250959 | A. Stiller | strength | 67 | 69 | +2 |
| 250959 | A. Stiller | vision | 87 | 89 | +2 |
| 251470 | C. De Ketelaere | acceleration | 71 | 72 | +1 |
| 251470 | C. De Ketelaere | ballcontrol | 86 | 87 | +1 |
| 251470 | C. De Ketelaere | dribbling | 85 | 86 | +1 |
| 251470 | C. De Ketelaere | finishing | 78 | 79 | +1 |
| 251470 | C. De Ketelaere | longpassing | 80 | 81 | +1 |
| 251470 | C. De Ketelaere | longshots | 79 | 80 | +1 |
| 251470 | C. De Ketelaere | positioning | 82 | 83 | +1 |
| 251470 | C. De Ketelaere | reactions | 77 | 78 | +1 |
| 251470 | C. De Ketelaere | shortpassing | 83 | 84 | +1 |
| 251470 | C. De Ketelaere | sprintspeed | 70 | 71 | +1 |
| 251470 | C. De Ketelaere | vision | 83 | 84 | +1 |
| 251517 | J. Gvardiol | standingtackle | 85 | 86 | +1 |
| 251566 | Gabriel Martinelli | dribbling | 85 | 86 | +1 |
| 251570 | R. Cherki | acceleration | 75 | 76 | +1 |
| 251570 | R. Cherki | agility | 81 | 82 | +1 |
| 251570 | R. Cherki | ballcontrol | 88 | 90 | +2 |
| 251570 | R. Cherki | crossing | 76 | 78 | +2 |
| 251570 | R. Cherki | dribbling | 91 | 93 | +2 |
| 251570 | R. Cherki | finishing | 75 | 77 | +2 |
| 251570 | R. Cherki | longshots | 75 | 76 | +1 |
| 251570 | R. Cherki | positioning | 73 | 75 | +2 |
| 251570 | R. Cherki | reactions | 78 | 79 | +1 |
| 251570 | R. Cherki | shortpassing | 82 | 83 | +1 |
| 251570 | R. Cherki | sprintspeed | 75 | 76 | +1 |
| 251570 | R. Cherki | vision | 86 | 87 | +1 |
| 251752 | L. Chevalier | gkdiving | 84 | 86 | +2 |
| 251752 | L. Chevalier | gkhandling | 79 | 81 | +2 |
| 251752 | L. Chevalier | gkkicking | 73 | 75 | +2 |
| 251752 | L. Chevalier | gkpositioning | 80 | 82 | +2 |
| 251752 | L. Chevalier | gkreflexes | 86 | 88 | +2 |
| 251752 | L. Chevalier | reactions | 80 | 82 | +2 |
| 251805 | J. Timber | acceleration | 76 | 77 | +1 |
| 251805 | J. Timber | ballcontrol | 81 | 82 | +1 |
| 251805 | J. Timber | crossing | 79 | 80 | +1 |
| 251805 | J. Timber | defensiveawareness | 83 | 84 | +1 |
| 251805 | J. Timber | interceptions | 83 | 84 | +1 |
| 251805 | J. Timber | reactions | 85 | 86 | +1 |
| 251805 | J. Timber | shortpassing | 81 | 82 | +1 |
| 251805 | J. Timber | slidingtackle | 82 | 83 | +1 |
| 251805 | J. Timber | sprintspeed | 76 | 77 | +1 |
| 251805 | J. Timber | stamina | 83 | 84 | +1 |
| 251805 | J. Timber | standingtackle | 85 | 86 | +1 |
| 251806 | Q. Timber | ballcontrol | 81 | 82 | +1 |
| 251806 | Q. Timber | dribbling | 79 | 80 | +1 |
| 251806 | Q. Timber | interceptions | 78 | 79 | +1 |
| 251806 | Q. Timber | longpassing | 78 | 79 | +1 |
| 251806 | Q. Timber | positioning | 78 | 79 | +1 |
| 251806 | Q. Timber | reactions | 82 | 83 | +1 |
| 251806 | Q. Timber | shortpassing | 82 | 83 | +1 |
| 251806 | Q. Timber | stamina | 79 | 80 | +1 |
| 251806 | Q. Timber | standingtackle | 76 | 77 | +1 |
| 251806 | Q. Timber | vision | 78 | 79 | +1 |
| 251809 | S. Botman | aggression | 84 | 85 | +1 |
| 251809 | S. Botman | ballcontrol | 74 | 75 | +1 |
| 251809 | S. Botman | defensiveawareness | 84 | 86 | +2 |
| 251809 | S. Botman | headingaccuracy | 81 | 82 | +1 |
| 251809 | S. Botman | interceptions | 82 | 84 | +2 |
| 251809 | S. Botman | jumping | 82 | 83 | +1 |
| 251809 | S. Botman | reactions | 80 | 81 | +1 |
| 251809 | S. Botman | shortpassing | 77 | 78 | +1 |
| 251809 | S. Botman | slidingtackle | 82 | 83 | +1 |
| 251809 | S. Botman | sprintspeed | 63 | 64 | +1 |
| 251809 | S. Botman | standingtackle | 83 | 85 | +2 |
| 251809 | S. Botman | strength | 89 | 90 | +1 |
| 251852 | K. Adeyemi | acceleration | 96 | 98 | +2 |
| 251852 | K. Adeyemi | ballcontrol | 80 | 82 | +2 |
| 251852 | K. Adeyemi | crossing | 73 | 75 | +2 |
| 251852 | K. Adeyemi | dribbling | 84 | 86 | +2 |
| 251852 | K. Adeyemi | finishing | 81 | 83 | +2 |
| 251852 | K. Adeyemi | longpassing | 69 | 70 | +1 |
| 251852 | K. Adeyemi | positioning | 82 | 84 | +2 |
| 251852 | K. Adeyemi | reactions | 82 | 84 | +2 |
| 251852 | K. Adeyemi | shortpassing | 74 | 76 | +2 |
| 251852 | K. Adeyemi | sprintspeed | 96 | 98 | +2 |
| 251852 | K. Adeyemi | stamina | 77 | 79 | +2 |
| 251852 | K. Adeyemi | vision | 74 | 76 | +2 |
| 251854 | Pedri | shortpassing | 91 | 92 | +1 |
| 252042 | João Pedro | acceleration | 79 | 84 | +5 |
| 252042 | João Pedro | ballcontrol | 82 | 87 | +5 |
| 252042 | João Pedro | dribbling | 84 | 89 | +5 |
| 252042 | João Pedro | finishing | 80 | 85 | +5 |
| 252042 | João Pedro | headingaccuracy | 79 | 84 | +5 |
| 252042 | João Pedro | longshots | 72 | 74 | +2 |
| 252042 | João Pedro | positioning | 81 | 86 | +5 |
| 252042 | João Pedro | reactions | 81 | 86 | +5 |
| 252042 | João Pedro | shortpassing | 78 | 83 | +5 |
| 252042 | João Pedro | shotpower | 80 | 85 | +5 |
| 252042 | João Pedro | sprintspeed | 77 | 82 | +5 |
| 252042 | João Pedro | strength | 70 | 75 | +5 |
| 252042 | João Pedro | volleys | 77 | 82 | +5 |
| 252145 | Nuno Mendes | acceleration | 94 | 96 | +2 |
| 252145 | Nuno Mendes | ballcontrol | 84 | 86 | +2 |
| 252145 | Nuno Mendes | crossing | 81 | 83 | +2 |
| 252145 | Nuno Mendes | defensiveawareness | 79 | 81 | +2 |
| 252145 | Nuno Mendes | headingaccuracy | 73 | 74 | +1 |
| 252145 | Nuno Mendes | interceptions | 81 | 83 | +2 |
| 252145 | Nuno Mendes | reactions | 83 | 85 | +2 |
| 252145 | Nuno Mendes | shortpassing | 80 | 82 | +2 |
| 252145 | Nuno Mendes | slidingtackle | 82 | 84 | +2 |
| 252145 | Nuno Mendes | sprintspeed | 95 | 97 | +2 |
| 252145 | Nuno Mendes | stamina | 85 | 87 | +2 |
| 252145 | Nuno Mendes | standingtackle | 87 | 89 | +2 |
| 252154 | M. Carnesecchi | gkdiving | 86 | 88 | +2 |
| 252154 | M. Carnesecchi | gkhandling | 83 | 85 | +2 |
| 252154 | M. Carnesecchi | gkkicking | 74 | 75 | +1 |
| 252154 | M. Carnesecchi | gkpositioning | 85 | 86 | +1 |
| 252154 | M. Carnesecchi | gkreflexes | 86 | 87 | +1 |
| 252154 | M. Carnesecchi | reactions | 74 | 75 | +1 |
| 252371 | J. Bellingham | ballcontrol | 91 | 92 | +1 |
| 252371 | J. Bellingham | dribbling | 91 | 92 | +1 |
| 252371 | J. Bellingham | positioning | 89 | 90 | +1 |
| 252371 | J. Bellingham | shortpassing | 90 | 91 | +1 |
| 252371 | J. Bellingham | vision | 89 | 90 | +1 |
| 252802 | W. Singo | defensiveawareness | 77 | 78 | +1 |
| 252802 | W. Singo | standingtackle | 81 | 82 | +1 |
| 253149 | J. Frimpong | ballcontrol | 83 | 84 | +1 |
| 253149 | J. Frimpong | crossing | 82 | 83 | +1 |
| 253149 | J. Frimpong | defensiveawareness | 74 | 75 | +1 |
| 253149 | J. Frimpong | interceptions | 77 | 78 | +1 |
| 253149 | J. Frimpong | reactions | 84 | 85 | +1 |
| 253149 | J. Frimpong | shortpassing | 78 | 79 | +1 |
| 253149 | J. Frimpong | slidingtackle | 79 | 80 | +1 |
| 253149 | J. Frimpong | sprintspeed | 93 | 94 | +1 |
| 253149 | J. Frimpong | stamina | 85 | 86 | +1 |
| 253149 | J. Frimpong | standingtackle | 71 | 72 | +1 |
| 253306 | M. Ugarte | ballcontrol | 74 | 75 | +1 |
| 253306 | M. Ugarte | defensiveawareness | 74 | 75 | +1 |
| 253306 | M. Ugarte | interceptions | 80 | 81 | +1 |
| 253306 | M. Ugarte | longpassing | 78 | 79 | +1 |
| 253306 | M. Ugarte | shortpassing | 77 | 78 | +1 |
| 253306 | M. Ugarte | standingtackle | 78 | 79 | +1 |
| 254022 | N. Woltemade | acceleration | 64 | 65 | +1 |
| 254022 | N. Woltemade | ballcontrol | 83 | 85 | +2 |
| 254022 | N. Woltemade | dribbling | 85 | 86 | +1 |
| 254022 | N. Woltemade | finishing | 82 | 84 | +2 |
| 254022 | N. Woltemade | headingaccuracy | 80 | 82 | +2 |
| 254022 | N. Woltemade | longshots | 66 | 67 | +1 |
| 254022 | N. Woltemade | positioning | 83 | 85 | +2 |
| 254022 | N. Woltemade | reactions | 81 | 82 | +1 |
| 254022 | N. Woltemade | shortpassing | 79 | 80 | +1 |
| 254022 | N. Woltemade | shotpower | 82 | 83 | +1 |
| 254022 | N. Woltemade | sprintspeed | 69 | 70 | +1 |
| 254022 | N. Woltemade | strength | 83 | 84 | +1 |
| 254022 | N. Woltemade | volleys | 73 | 74 | +1 |
| 254088 | Amad | acceleration | 88 | 89 | +1 |
| 254088 | Amad | ballcontrol | 80 | 81 | +1 |
| 254088 | Amad | dribbling | 83 | 84 | +1 |
| 254088 | Amad | finishing | 77 | 78 | +1 |
| 254088 | Amad | longpassing | 71 | 72 | +1 |
| 254088 | Amad | longshots | 69 | 70 | +1 |
| 254088 | Amad | positioning | 78 | 79 | +1 |
| 254088 | Amad | reactions | 77 | 78 | +1 |
| 254088 | Amad | shortpassing | 76 | 77 | +1 |
| 254088 | Amad | vision | 77 | 78 | +1 |
| 254117 | M. Beier | ballcontrol | 82 | 83 | +1 |
| 254117 | M. Beier | dribbling | 80 | 81 | +1 |
| 254117 | M. Beier | finishing | 82 | 83 | +1 |
| 254117 | M. Beier | headingaccuracy | 72 | 73 | +1 |
| 254117 | M. Beier | positioning | 82 | 83 | +1 |
| 254117 | M. Beier | reactions | 79 | 80 | +1 |
| 254117 | M. Beier | shortpassing | 74 | 75 | +1 |
| 254117 | M. Beier | shotpower | 80 | 81 | +1 |
| 254117 | M. Beier | sprintspeed | 86 | 87 | +1 |
| 254117 | M. Beier | strength | 53 | 54 | +1 |
| 255001 | N. Rovella | aggression | 78 | 80 | +2 |
| 255001 | N. Rovella | ballcontrol | 80 | 82 | +2 |
| 255001 | N. Rovella | defensiveawareness | 76 | 78 | +2 |
| 255001 | N. Rovella | interceptions | 78 | 81 | +3 |
| 255001 | N. Rovella | longpassing | 80 | 82 | +2 |
| 255001 | N. Rovella | reactions | 77 | 79 | +2 |
| 255001 | N. Rovella | shortpassing | 82 | 85 | +3 |
| 255001 | N. Rovella | slidingtackle | 76 | 78 | +2 |
| 255001 | N. Rovella | stamina | 85 | 87 | +2 |
| 255001 | N. Rovella | standingtackle | 77 | 79 | +2 |
| 255001 | N. Rovella | strength | 62 | 64 | +2 |
| 255001 | N. Rovella | vision | 79 | 81 | +2 |
| 255253 | Vitinha | ballcontrol | 88 | 90 | +2 |
| 255253 | Vitinha | dribbling | 91 | 93 | +2 |
| 255253 | Vitinha | finishing | 81 | 82 | +1 |
| 255253 | Vitinha | interceptions | 85 | 86 | +1 |
| 255253 | Vitinha | longpassing | 89 | 91 | +2 |
| 255253 | Vitinha | longshots | 88 | 89 | +1 |
| 255253 | Vitinha | positioning | 81 | 82 | +1 |
| 255253 | Vitinha | reactions | 88 | 90 | +2 |
| 255253 | Vitinha | shortpassing | 90 | 92 | +2 |
| 255253 | Vitinha | stamina | 88 | 89 | +1 |
| 255253 | Vitinha | standingtackle | 79 | 80 | +1 |
| 255253 | Vitinha | vision | 90 | 92 | +2 |
| 255475 | Antony | dribbling | 82 | 83 | +1 |
| 255654 | P. Kalulu | aggression | 80 | 81 | +1 |
| 255654 | P. Kalulu | ballcontrol | 74 | 75 | +1 |
| 255654 | P. Kalulu | defensiveawareness | 82 | 83 | +1 |
| 255654 | P. Kalulu | headingaccuracy | 75 | 76 | +1 |
| 255654 | P. Kalulu | interceptions | 82 | 83 | +1 |
| 255654 | P. Kalulu | jumping | 83 | 84 | +1 |
| 255654 | P. Kalulu | reactions | 80 | 81 | +1 |
| 255654 | P. Kalulu | shortpassing | 77 | 78 | +1 |
| 255654 | P. Kalulu | slidingtackle | 79 | 80 | +1 |
| 255654 | P. Kalulu | sprintspeed | 83 | 84 | +1 |
| 255654 | P. Kalulu | standingtackle | 83 | 84 | +1 |
| 255654 | P. Kalulu | strength | 73 | 74 | +1 |
| 256079 | M. Caicedo | aggression | 86 | 87 | +1 |
| 256079 | M. Caicedo | ballcontrol | 83 | 84 | +1 |
| 256079 | M. Caicedo | defensiveawareness | 84 | 85 | +1 |
| 256079 | M. Caicedo | interceptions | 88 | 89 | +1 |
| 256079 | M. Caicedo | longpassing | 84 | 85 | +1 |
| 256079 | M. Caicedo | reactions | 87 | 88 | +1 |
| 256079 | M. Caicedo | shortpassing | 86 | 87 | +1 |
| 256079 | M. Caicedo | slidingtackle | 88 | 89 | +1 |
| 256079 | M. Caicedo | stamina | 91 | 92 | +1 |
| 256079 | M. Caicedo | standingtackle | 87 | 88 | +1 |
| 256196 | W. Pacho | aggression | 86 | 88 | +2 |
| 256196 | W. Pacho | ballcontrol | 69 | 71 | +2 |
| 256196 | W. Pacho | defensiveawareness | 90 | 92 | +2 |
| 256196 | W. Pacho | headingaccuracy | 82 | 84 | +2 |
| 256196 | W. Pacho | interceptions | 84 | 86 | +2 |
| 256196 | W. Pacho | jumping | 90 | 92 | +2 |
| 256196 | W. Pacho | reactions | 86 | 88 | +2 |
| 256196 | W. Pacho | shortpassing | 78 | 80 | +2 |
| 256196 | W. Pacho | slidingtackle | 82 | 84 | +2 |
| 256196 | W. Pacho | sprintspeed | 85 | 87 | +2 |
| 256196 | W. Pacho | standingtackle | 90 | 92 | +2 |
| 256196 | W. Pacho | strength | 89 | 91 | +2 |
| 256197 | P. Hincapié | aggression | 87 | 89 | +2 |
| 256197 | P. Hincapié | ballcontrol | 74 | 75 | +1 |
| 256197 | P. Hincapié | defensiveawareness | 83 | 85 | +2 |
| 256197 | P. Hincapié | headingaccuracy | 79 | 81 | +2 |
| 256197 | P. Hincapié | interceptions | 83 | 85 | +2 |
| 256197 | P. Hincapié | jumping | 88 | 89 | +1 |
| 256197 | P. Hincapié | reactions | 82 | 83 | +1 |
| 256197 | P. Hincapié | shortpassing | 78 | 79 | +1 |
| 256197 | P. Hincapié | slidingtackle | 88 | 90 | +2 |
| 256197 | P. Hincapié | sprintspeed | 88 | 89 | +1 |
| 256197 | P. Hincapié | standingtackle | 85 | 87 | +2 |
| 256197 | P. Hincapié | strength | 77 | 79 | +2 |
| 256261 | M. Thiaw | aggression | 77 | 79 | +2 |
| 256261 | M. Thiaw | ballcontrol | 76 | 78 | +2 |
| 256261 | M. Thiaw | defensiveawareness | 80 | 82 | +2 |
| 256261 | M. Thiaw | headingaccuracy | 80 | 82 | +2 |
| 256261 | M. Thiaw | interceptions | 81 | 83 | +2 |
| 256261 | M. Thiaw | jumping | 88 | 90 | +2 |
| 256261 | M. Thiaw | reactions | 80 | 82 | +2 |
| 256261 | M. Thiaw | shortpassing | 81 | 83 | +2 |
| 256261 | M. Thiaw | slidingtackle | 81 | 83 | +2 |
| 256261 | M. Thiaw | sprintspeed | 78 | 80 | +2 |
| 256261 | M. Thiaw | standingtackle | 80 | 83 | +3 |
| 256261 | M. Thiaw | strength | 83 | 85 | +2 |
| 256325 | J. Šutalo | aggression | 71 | 72 | +1 |
| 256325 | J. Šutalo | ballcontrol | 77 | 78 | +1 |
| 256325 | J. Šutalo | defensiveawareness | 78 | 79 | +1 |
| 256325 | J. Šutalo | headingaccuracy | 74 | 75 | +1 |
| 256325 | J. Šutalo | interceptions | 83 | 84 | +1 |
| 256325 | J. Šutalo | jumping | 88 | 89 | +1 |
| 256325 | J. Šutalo | reactions | 77 | 78 | +1 |
| 256325 | J. Šutalo | shortpassing | 74 | 75 | +1 |
| 256325 | J. Šutalo | slidingtackle | 76 | 77 | +1 |
| 256325 | J. Šutalo | sprintspeed | 79 | 80 | +1 |
| 256325 | J. Šutalo | standingtackle | 78 | 80 | +2 |
| 256325 | J. Šutalo | strength | 87 | 88 | +1 |
| 256500 | N. Collins | aggression | 72 | 73 | +1 |
| 256500 | N. Collins | ballcontrol | 69 | 70 | +1 |
| 256500 | N. Collins | defensiveawareness | 73 | 75 | +2 |
| 256500 | N. Collins | headingaccuracy | 73 | 75 | +2 |
| 256500 | N. Collins | interceptions | 73 | 75 | +2 |
| 256500 | N. Collins | jumping | 89 | 90 | +1 |
| 256500 | N. Collins | reactions | 70 | 71 | +1 |
| 256500 | N. Collins | shortpassing | 71 | 72 | +1 |
| 256500 | N. Collins | slidingtackle | 68 | 69 | +1 |
| 256500 | N. Collins | sprintspeed | 88 | 89 | +1 |
| 256500 | N. Collins | standingtackle | 76 | 78 | +2 |
| 256500 | N. Collins | strength | 79 | 81 | +2 |
| 256516 | Nico Williams | acceleration | 94 | 95 | +1 |
| 256516 | Nico Williams | ballcontrol | 85 | 87 | +2 |
| 256516 | Nico Williams | crossing | 82 | 84 | +2 |
| 256516 | Nico Williams | dribbling | 88 | 90 | +2 |
| 256516 | Nico Williams | finishing | 79 | 80 | +1 |
| 256516 | Nico Williams | longpassing | 75 | 76 | +1 |
| 256516 | Nico Williams | positioning | 80 | 82 | +2 |
| 256516 | Nico Williams | reactions | 82 | 83 | +1 |
| 256516 | Nico Williams | shortpassing | 82 | 84 | +2 |
| 256516 | Nico Williams | sprintspeed | 92 | 93 | +1 |
| 256516 | Nico Williams | stamina | 81 | 82 | +1 |
| 256516 | Nico Williams | vision | 82 | 83 | +1 |
| 256630 | F. Wirtz | ballcontrol | 89 | 90 | +1 |
| 256630 | F. Wirtz | dribbling | 89 | 90 | +1 |
| 256630 | F. Wirtz | shortpassing | 89 | 90 | +1 |
| 256630 | F. Wirtz | vision | 90 | 91 | +1 |
| 256790 | J. Musiala | acceleration | 85 | 87 | +2 |
| 256790 | J. Musiala | agility | 94 | 95 | +1 |
| 256790 | J. Musiala | ballcontrol | 85 | 87 | +2 |
| 256790 | J. Musiala | dribbling | 94 | 96 | +2 |
| 256790 | J. Musiala | finishing | 86 | 88 | +2 |
| 256790 | J. Musiala | longpassing | 79 | 81 | +2 |
| 256790 | J. Musiala | longshots | 82 | 84 | +2 |
| 256790 | J. Musiala | positioning | 88 | 90 | +2 |
| 256790 | J. Musiala | reactions | 89 | 91 | +2 |
| 256790 | J. Musiala | shortpassing | 87 | 89 | +2 |
| 256790 | J. Musiala | sprintspeed | 75 | 77 | +2 |
| 256790 | J. Musiala | vision | 84 | 86 | +2 |
| 256853 | M. Tillman | acceleration | 83 | 86 | +3 |
| 256853 | M. Tillman | agility | 79 | 81 | +2 |
| 256853 | M. Tillman | ballcontrol | 84 | 87 | +3 |
| 256853 | M. Tillman | dribbling | 83 | 86 | +3 |
| 256853 | M. Tillman | finishing | 75 | 78 | +3 |
| 256853 | M. Tillman | longpassing | 75 | 77 | +2 |
| 256853 | M. Tillman | longshots | 84 | 87 | +3 |
| 256853 | M. Tillman | positioning | 78 | 81 | +3 |
| 256853 | M. Tillman | reactions | 81 | 84 | +3 |
| 256853 | M. Tillman | shortpassing | 80 | 83 | +3 |
| 256853 | M. Tillman | sprintspeed | 84 | 86 | +2 |
| 256853 | M. Tillman | vision | 79 | 82 | +3 |
| 256903 | Gonçalo Ramos | acceleration | 73 | 74 | +1 |
| 256903 | Gonçalo Ramos | ballcontrol | 78 | 79 | +1 |
| 256903 | Gonçalo Ramos | dribbling | 76 | 77 | +1 |
| 256903 | Gonçalo Ramos | finishing | 82 | 83 | +1 |
| 256903 | Gonçalo Ramos | headingaccuracy | 83 | 84 | +1 |
| 256903 | Gonçalo Ramos | positioning | 85 | 86 | +1 |
| 256903 | Gonçalo Ramos | reactions | 81 | 82 | +1 |
| 256903 | Gonçalo Ramos | shortpassing | 72 | 73 | +1 |
| 256903 | Gonçalo Ramos | shotpower | 82 | 83 | +1 |
| 256903 | Gonçalo Ramos | sprintspeed | 73 | 74 | +1 |
| 256903 | Gonçalo Ramos | strength | 79 | 80 | +1 |
| 257057 | A. Onana | interceptions | 80 | 81 | +1 |
| 257057 | A. Onana | shortpassing | 80 | 81 | +1 |
| 257179 | Gonçalo Inácio | aggression | 78 | 82 | +4 |
| 257179 | Gonçalo Inácio | ballcontrol | 75 | 79 | +4 |
| 257179 | Gonçalo Inácio | defensiveawareness | 82 | 87 | +5 |
| 257179 | Gonçalo Inácio | headingaccuracy | 83 | 88 | +5 |
| 257179 | Gonçalo Inácio | interceptions | 82 | 87 | +5 |
| 257179 | Gonçalo Inácio | jumping | 85 | 89 | +4 |
| 257179 | Gonçalo Inácio | reactions | 76 | 80 | +4 |
| 257179 | Gonçalo Inácio | shortpassing | 81 | 85 | +4 |
| 257179 | Gonçalo Inácio | slidingtackle | 79 | 83 | +4 |
| 257179 | Gonçalo Inácio | sprintspeed | 76 | 80 | +4 |
| 257179 | Gonçalo Inácio | standingtackle | 82 | 87 | +5 |
| 257179 | Gonçalo Inácio | strength | 82 | 87 | +5 |
| 257279 | Álex Baena | acceleration | 79 | 81 | +2 |
| 257279 | Álex Baena | ballcontrol | 84 | 86 | +2 |
| 257279 | Álex Baena | crossing | 85 | 87 | +2 |
| 257279 | Álex Baena | dribbling | 83 | 85 | +2 |
| 257279 | Álex Baena | finishing | 77 | 79 | +2 |
| 257279 | Álex Baena | longpassing | 83 | 84 | +1 |
| 257279 | Álex Baena | positioning | 82 | 84 | +2 |
| 257279 | Álex Baena | reactions | 82 | 84 | +2 |
| 257279 | Álex Baena | shortpassing | 87 | 89 | +2 |
| 257279 | Álex Baena | sprintspeed | 79 | 81 | +2 |
| 257279 | Álex Baena | stamina | 78 | 80 | +2 |
| 257279 | Álex Baena | vision | 84 | 86 | +2 |
| 257289 | H. Ekitiké | acceleration | 85 | 86 | +1 |
| 257289 | H. Ekitiké | ballcontrol | 86 | 87 | +1 |
| 257289 | H. Ekitiké | dribbling | 87 | 88 | +1 |
| 257289 | H. Ekitiké | finishing | 83 | 84 | +1 |
| 257289 | H. Ekitiké | headingaccuracy | 77 | 78 | +1 |
| 257289 | H. Ekitiké | positioning | 86 | 87 | +1 |
| 257289 | H. Ekitiké | reactions | 83 | 84 | +1 |
| 257289 | H. Ekitiké | shortpassing | 82 | 83 | +1 |
| 257289 | H. Ekitiké | shotpower | 83 | 84 | +1 |
| 257289 | H. Ekitiké | sprintspeed | 87 | 88 | +1 |
| 257289 | H. Ekitiké | strength | 69 | 70 | +1 |
| 257470 | A. Elanga | acceleration | 93 | 94 | +1 |
| 257470 | A. Elanga | agility | 85 | 86 | +1 |
| 257470 | A. Elanga | ballcontrol | 80 | 82 | +2 |
| 257470 | A. Elanga | crossing | 79 | 80 | +1 |
| 257470 | A. Elanga | dribbling | 82 | 84 | +2 |
| 257470 | A. Elanga | finishing | 75 | 77 | +2 |
| 257470 | A. Elanga | longshots | 67 | 68 | +1 |
| 257470 | A. Elanga | positioning | 78 | 80 | +2 |
| 257470 | A. Elanga | reactions | 78 | 79 | +1 |
| 257470 | A. Elanga | shortpassing | 75 | 76 | +1 |
| 257470 | A. Elanga | sprintspeed | 91 | 92 | +1 |
| 257470 | A. Elanga | vision | 78 | 79 | +1 |
| 257534 | C. Palmer | ballcontrol | 89 | 90 | +1 |
| 257534 | C. Palmer | shortpassing | 87 | 88 | +1 |
| 257534 | C. Palmer | vision | 89 | 90 | +1 |
| 257711 | R. Calafiori | acceleration | 74 | 75 | +1 |
| 257711 | R. Calafiori | ballcontrol | 78 | 79 | +1 |
| 257711 | R. Calafiori | crossing | 77 | 79 | +2 |
| 257711 | R. Calafiori | defensiveawareness | 79 | 80 | +1 |
| 257711 | R. Calafiori | headingaccuracy | 79 | 80 | +1 |
| 257711 | R. Calafiori | interceptions | 79 | 81 | +2 |
| 257711 | R. Calafiori | reactions | 81 | 82 | +1 |
| 257711 | R. Calafiori | shortpassing | 80 | 81 | +1 |
| 257711 | R. Calafiori | slidingtackle | 81 | 83 | +2 |
| 257711 | R. Calafiori | sprintspeed | 72 | 73 | +1 |
| 257711 | R. Calafiori | stamina | 85 | 86 | +1 |
| 257711 | R. Calafiori | standingtackle | 80 | 82 | +2 |
| 257919 | R. Reitz | ballcontrol | 78 | 80 | +2 |
| 257919 | R. Reitz | dribbling | 77 | 79 | +2 |
| 257919 | R. Reitz | finishing | 73 | 74 | +1 |
| 257919 | R. Reitz | interceptions | 86 | 87 | +1 |
| 257919 | R. Reitz | longpassing | 77 | 79 | +2 |
| 257919 | R. Reitz | longshots | 68 | 69 | +1 |
| 257919 | R. Reitz | positioning | 74 | 76 | +2 |
| 257919 | R. Reitz | reactions | 73 | 75 | +2 |
| 257919 | R. Reitz | shortpassing | 78 | 80 | +2 |
| 257919 | R. Reitz | stamina | 79 | 81 | +2 |
| 257919 | R. Reitz | standingtackle | 77 | 78 | +1 |
| 257919 | R. Reitz | vision | 75 | 77 | +2 |
| 258498 | B. Verbruggen | gkdiving | 79 | 81 | +2 |
| 258498 | B. Verbruggen | gkhandling | 76 | 77 | +1 |
| 258498 | B. Verbruggen | gkkicking | 78 | 79 | +1 |
| 258498 | B. Verbruggen | gkpositioning | 78 | 79 | +1 |
| 258498 | B. Verbruggen | gkreflexes | 82 | 83 | +1 |
| 258498 | B. Verbruggen | reactions | 76 | 77 | +1 |
| 258601 | M. Sangaré | ballcontrol | 78 | 80 | +2 |
| 258601 | M. Sangaré | dribbling | 76 | 78 | +2 |
| 258601 | M. Sangaré | finishing | 61 | 63 | +2 |
| 258601 | M. Sangaré | interceptions | 80 | 82 | +2 |
| 258601 | M. Sangaré | longpassing | 75 | 77 | +2 |
| 258601 | M. Sangaré | longshots | 68 | 70 | +2 |
| 258601 | M. Sangaré | positioning | 68 | 70 | +2 |
| 258601 | M. Sangaré | reactions | 74 | 76 | +2 |
| 258601 | M. Sangaré | shortpassing | 78 | 80 | +2 |
| 258601 | M. Sangaré | stamina | 85 | 87 | +2 |
| 258601 | M. Sangaré | standingtackle | 75 | 77 | +2 |
| 258601 | M. Sangaré | vision | 76 | 78 | +2 |
| 258729 | Gabri Veiga | acceleration | 73 | 76 | +3 |
| 258729 | Gabri Veiga | agility | 72 | 75 | +3 |
| 258729 | Gabri Veiga | ballcontrol | 83 | 86 | +3 |
| 258729 | Gabri Veiga | dribbling | 81 | 84 | +3 |
| 258729 | Gabri Veiga | finishing | 77 | 80 | +3 |
| 258729 | Gabri Veiga | longpassing | 79 | 82 | +3 |
| 258729 | Gabri Veiga | longshots | 79 | 82 | +3 |
| 258729 | Gabri Veiga | positioning | 72 | 75 | +3 |
| 258729 | Gabri Veiga | reactions | 76 | 79 | +3 |
| 258729 | Gabri Veiga | shortpassing | 81 | 84 | +3 |
| 258729 | Gabri Veiga | sprintspeed | 78 | 81 | +3 |
| 258729 | Gabri Veiga | vision | 79 | 82 | +3 |
| 258781 | I. Zabarnyi | aggression | 77 | 78 | +1 |
| 258781 | I. Zabarnyi | ballcontrol | 68 | 69 | +1 |
| 258781 | I. Zabarnyi | defensiveawareness | 82 | 84 | +2 |
| 258781 | I. Zabarnyi | headingaccuracy | 77 | 78 | +1 |
| 258781 | I. Zabarnyi | interceptions | 79 | 81 | +2 |
| 258781 | I. Zabarnyi | jumping | 90 | 91 | +1 |
| 258781 | I. Zabarnyi | reactions | 80 | 81 | +1 |
| 258781 | I. Zabarnyi | shortpassing | 77 | 78 | +1 |
| 258781 | I. Zabarnyi | slidingtackle | 79 | 80 | +1 |
| 258781 | I. Zabarnyi | sprintspeed | 84 | 85 | +1 |
| 258781 | I. Zabarnyi | standingtackle | 82 | 84 | +2 |
| 258781 | I. Zabarnyi | strength | 85 | 86 | +1 |
| 258885 | Luiz Júnior | gkdiving | 77 | 80 | +3 |
| 258885 | Luiz Júnior | gkhandling | 77 | 79 | +2 |
| 258885 | Luiz Júnior | gkkicking | 70 | 72 | +2 |
| 258885 | Luiz Júnior | gkpositioning | 77 | 79 | +2 |
| 258885 | Luiz Júnior | gkreflexes | 77 | 79 | +2 |
| 258885 | Luiz Júnior | reactions | 75 | 77 | +2 |
| 258966 | A. Cambiaso | acceleration | 79 | 81 | +2 |
| 258966 | A. Cambiaso | ballcontrol | 82 | 84 | +2 |
| 258966 | A. Cambiaso | crossing | 82 | 84 | +2 |
| 258966 | A. Cambiaso | defensiveawareness | 77 | 79 | +2 |
| 258966 | A. Cambiaso | headingaccuracy | 62 | 64 | +2 |
| 258966 | A. Cambiaso | interceptions | 74 | 76 | +2 |
| 258966 | A. Cambiaso | reactions | 78 | 80 | +2 |
| 258966 | A. Cambiaso | shortpassing | 80 | 82 | +2 |
| 258966 | A. Cambiaso | slidingtackle | 76 | 78 | +2 |
| 258966 | A. Cambiaso | sprintspeed | 79 | 81 | +2 |
| 258966 | A. Cambiaso | stamina | 78 | 80 | +2 |
| 258966 | A. Cambiaso | standingtackle | 79 | 81 | +2 |
| 259031 | L. Delap | acceleration | 76 | 77 | +1 |
| 259031 | L. Delap | ballcontrol | 78 | 79 | +1 |
| 259031 | L. Delap | dribbling | 78 | 79 | +1 |
| 259031 | L. Delap | finishing | 80 | 82 | +2 |
| 259031 | L. Delap | headingaccuracy | 73 | 74 | +1 |
| 259031 | L. Delap | longshots | 74 | 75 | +1 |
| 259031 | L. Delap | positioning | 79 | 80 | +1 |
| 259031 | L. Delap | reactions | 77 | 78 | +1 |
| 259031 | L. Delap | shortpassing | 69 | 70 | +1 |
| 259031 | L. Delap | shotpower | 85 | 86 | +1 |
| 259031 | L. Delap | sprintspeed | 81 | 82 | +1 |
| 259031 | L. Delap | strength | 84 | 85 | +1 |
| 259031 | L. Delap | volleys | 78 | 79 | +1 |
| 259307 | M. Gusto | acceleration | 87 | 88 | +1 |
| 259307 | M. Gusto | ballcontrol | 77 | 78 | +1 |
| 259307 | M. Gusto | crossing | 79 | 81 | +2 |
| 259307 | M. Gusto | defensiveawareness | 75 | 77 | +2 |
| 259307 | M. Gusto | headingaccuracy | 53 | 54 | +1 |
| 259307 | M. Gusto | interceptions | 76 | 78 | +2 |
| 259307 | M. Gusto | reactions | 76 | 78 | +2 |
| 259307 | M. Gusto | shortpassing | 76 | 77 | +1 |
| 259307 | M. Gusto | slidingtackle | 75 | 77 | +2 |
| 259307 | M. Gusto | sprintspeed | 81 | 82 | +1 |
| 259307 | M. Gusto | stamina | 85 | 87 | +2 |
| 259307 | M. Gusto | standingtackle | 76 | 78 | +2 |
| 259377 | Yeremy Pino | acceleration | 78 | 79 | +1 |
| 259377 | Yeremy Pino | ballcontrol | 81 | 82 | +1 |
| 259377 | Yeremy Pino | crossing | 79 | 80 | +1 |
| 259377 | Yeremy Pino | dribbling | 84 | 85 | +1 |
| 259377 | Yeremy Pino | finishing | 76 | 77 | +1 |
| 259377 | Yeremy Pino | positioning | 81 | 82 | +1 |
| 259377 | Yeremy Pino | shortpassing | 81 | 82 | +1 |
| 259516 | Johnny Cardoso | ballcontrol | 82 | 83 | +1 |
| 259516 | Johnny Cardoso | interceptions | 82 | 83 | +1 |
| 259516 | Johnny Cardoso | longpassing | 80 | 81 | +1 |
| 259516 | Johnny Cardoso | shortpassing | 82 | 83 | +1 |
| 259516 | Johnny Cardoso | standingtackle | 81 | 82 | +1 |
| 259583 | D. Udogie | slidingtackle | 74 | 75 | +1 |
| 259714 | M. Röhl | acceleration | 78 | 79 | +1 |
| 259714 | M. Röhl | agility | 74 | 75 | +1 |
| 259714 | M. Röhl | ballcontrol | 74 | 76 | +2 |
| 259714 | M. Röhl | dribbling | 78 | 79 | +1 |
| 259714 | M. Röhl | finishing | 66 | 67 | +1 |
| 259714 | M. Röhl | longpassing | 68 | 69 | +1 |
| 259714 | M. Röhl | longshots | 63 | 64 | +1 |
| 259714 | M. Röhl | positioning | 74 | 75 | +1 |
| 259714 | M. Röhl | reactions | 73 | 74 | +1 |
| 259714 | M. Röhl | shortpassing | 76 | 78 | +2 |
| 259714 | M. Röhl | sprintspeed | 83 | 84 | +1 |
| 259714 | M. Röhl | vision | 76 | 78 | +2 |
| 259868 | P. Sarr | ballcontrol | 80 | 81 | +1 |
| 259868 | P. Sarr | dribbling | 81 | 82 | +1 |
| 259868 | P. Sarr | longpassing | 80 | 81 | +1 |
| 259868 | P. Sarr | positioning | 77 | 78 | +1 |
| 259868 | P. Sarr | reactions | 83 | 84 | +1 |
| 259868 | P. Sarr | shortpassing | 82 | 83 | +1 |
| 259868 | P. Sarr | stamina | 85 | 86 | +1 |
| 259868 | P. Sarr | vision | 78 | 79 | +1 |
| 259913 | G. Sudakov | ballcontrol | 81 | 82 | +1 |
| 259913 | G. Sudakov | shortpassing | 79 | 80 | +1 |
| 259913 | G. Sudakov | vision | 81 | 82 | +1 |
| 260443 | S. Ibrahim | ballcontrol | 60 | 61 | +1 |
| 260443 | S. Ibrahim | finishing | 63 | 64 | +1 |
| 260443 | S. Ibrahim | positioning | 64 | 65 | +1 |
| 260592 | B. Šeško | acceleration | 79 | 87 | +8 |
| 260592 | B. Šeško | ballcontrol | 81 | 89 | +8 |
| 260592 | B. Šeško | dribbling | 79 | 87 | +8 |
| 260592 | B. Šeško | finishing | 81 | 90 | +9 |
| 260592 | B. Šeško | headingaccuracy | 82 | 90 | +8 |
| 260592 | B. Šeško | longshots | 75 | 77 | +2 |
| 260592 | B. Šeško | positioning | 81 | 89 | +8 |
| 260592 | B. Šeško | reactions | 73 | 81 | +8 |
| 260592 | B. Šeško | shortpassing | 74 | 82 | +8 |
| 260592 | B. Šeško | shotpower | 85 | 93 | +8 |
| 260592 | B. Šeško | sprintspeed | 87 | 95 | +8 |
| 260592 | B. Šeško | strength | 83 | 91 | +8 |
| 260592 | B. Šeško | volleys | 75 | 83 | +8 |
| 260599 | A. Varela | aggression | 84 | 85 | +1 |
| 260599 | A. Varela | ballcontrol | 78 | 80 | +2 |
| 260599 | A. Varela | defensiveawareness | 79 | 81 | +2 |
| 260599 | A. Varela | interceptions | 79 | 81 | +2 |
| 260599 | A. Varela | longpassing | 76 | 78 | +2 |
| 260599 | A. Varela | reactions | 78 | 80 | +2 |
| 260599 | A. Varela | shortpassing | 81 | 83 | +2 |
| 260599 | A. Varela | slidingtackle | 77 | 78 | +1 |
| 260599 | A. Varela | stamina | 84 | 85 | +1 |
| 260599 | A. Varela | standingtackle | 77 | 79 | +2 |
| 260599 | A. Varela | strength | 76 | 77 | +1 |
| 260599 | A. Varela | vision | 76 | 77 | +1 |
| 260815 | Arnau Martínez | slidingtackle | 74 | 75 | +1 |
| 260823 | N. Fagioli | ballcontrol | 81 | 83 | +2 |
| 260823 | N. Fagioli | dribbling | 78 | 79 | +1 |
| 260823 | N. Fagioli | finishing | 56 | 57 | +1 |
| 260823 | N. Fagioli | interceptions | 70 | 71 | +1 |
| 260823 | N. Fagioli | longpassing | 81 | 83 | +2 |
| 260823 | N. Fagioli | longshots | 70 | 71 | +1 |
| 260823 | N. Fagioli | positioning | 62 | 63 | +1 |
| 260823 | N. Fagioli | reactions | 74 | 75 | +1 |
| 260823 | N. Fagioli | shortpassing | 81 | 83 | +2 |
| 260823 | N. Fagioli | stamina | 68 | 69 | +1 |
| 260823 | N. Fagioli | standingtackle | 74 | 75 | +1 |
| 260823 | N. Fagioli | vision | 77 | 79 | +2 |
| 260908 | M. Kerkez | acceleration | 88 | 89 | +1 |
| 260908 | M. Kerkez | ballcontrol | 76 | 77 | +1 |
| 260908 | M. Kerkez | crossing | 80 | 81 | +1 |
| 260908 | M. Kerkez | defensiveawareness | 76 | 77 | +1 |
| 260908 | M. Kerkez | headingaccuracy | 60 | 61 | +1 |
| 260908 | M. Kerkez | interceptions | 78 | 79 | +1 |
| 260908 | M. Kerkez | reactions | 78 | 79 | +1 |
| 260908 | M. Kerkez | shortpassing | 77 | 78 | +1 |
| 260908 | M. Kerkez | slidingtackle | 80 | 82 | +2 |
| 260908 | M. Kerkez | sprintspeed | 87 | 88 | +1 |
| 260908 | M. Kerkez | stamina | 90 | 91 | +1 |
| 260908 | M. Kerkez | standingtackle | 78 | 79 | +1 |
| 260926 | K. Schade | acceleration | 93 | 94 | +1 |
| 260926 | K. Schade | ballcontrol | 78 | 80 | +2 |
| 260926 | K. Schade | crossing | 72 | 73 | +1 |
| 260926 | K. Schade | dribbling | 79 | 81 | +2 |
| 260926 | K. Schade | finishing | 78 | 79 | +1 |
| 260926 | K. Schade | longpassing | 64 | 65 | +1 |
| 260926 | K. Schade | positioning | 78 | 79 | +1 |
| 260926 | K. Schade | reactions | 75 | 76 | +1 |
| 260926 | K. Schade | shortpassing | 73 | 75 | +2 |
| 260926 | K. Schade | sprintspeed | 92 | 93 | +1 |
| 260926 | K. Schade | stamina | 72 | 73 | +1 |
| 260926 | K. Schade | vision | 71 | 72 | +1 |
| 260952 | A. Schjelderup | acceleration | 83 | 85 | +2 |
| 260952 | A. Schjelderup | agility | 84 | 85 | +1 |
| 260952 | A. Schjelderup | ballcontrol | 79 | 81 | +2 |
| 260952 | A. Schjelderup | crossing | 69 | 71 | +2 |
| 260952 | A. Schjelderup | dribbling | 81 | 83 | +2 |
| 260952 | A. Schjelderup | finishing | 70 | 72 | +2 |
| 260952 | A. Schjelderup | longshots | 61 | 62 | +1 |
| 260952 | A. Schjelderup | positioning | 70 | 72 | +2 |
| 260952 | A. Schjelderup | reactions | 73 | 75 | +2 |
| 260952 | A. Schjelderup | shortpassing | 70 | 72 | +2 |
| 260952 | A. Schjelderup | sprintspeed | 77 | 78 | +1 |
| 260952 | A. Schjelderup | vision | 73 | 74 | +1 |
| 261050 | Francisco Conceição | ballcontrol | 83 | 84 | +1 |
| 261050 | Francisco Conceição | shortpassing | 78 | 79 | +1 |
| 261530 | Dário Essugo | aggression | 81 | 83 | +2 |
| 261530 | Dário Essugo | ballcontrol | 71 | 73 | +2 |
| 261530 | Dário Essugo | defensiveawareness | 75 | 77 | +2 |
| 261530 | Dário Essugo | interceptions | 75 | 78 | +3 |
| 261530 | Dário Essugo | longpassing | 70 | 72 | +2 |
| 261530 | Dário Essugo | reactions | 73 | 75 | +2 |
| 261530 | Dário Essugo | shortpassing | 74 | 76 | +2 |
| 261530 | Dário Essugo | slidingtackle | 74 | 76 | +2 |
| 261530 | Dário Essugo | stamina | 76 | 78 | +2 |
| 261530 | Dário Essugo | standingtackle | 76 | 78 | +2 |
| 261530 | Dário Essugo | strength | 83 | 85 | +2 |
| 261530 | Dário Essugo | vision | 70 | 72 | +2 |
| 261865 | Miguel Gutiérrez | acceleration | 82 | 83 | +1 |
| 261865 | Miguel Gutiérrez | ballcontrol | 82 | 83 | +1 |
| 261865 | Miguel Gutiérrez | crossing | 84 | 85 | +1 |
| 261865 | Miguel Gutiérrez | defensiveawareness | 76 | 77 | +1 |
| 261865 | Miguel Gutiérrez | headingaccuracy | 68 | 69 | +1 |
| 261865 | Miguel Gutiérrez | interceptions | 77 | 79 | +2 |
| 261865 | Miguel Gutiérrez | reactions | 80 | 81 | +1 |
| 261865 | Miguel Gutiérrez | shortpassing | 82 | 83 | +1 |
| 261865 | Miguel Gutiérrez | slidingtackle | 76 | 78 | +2 |
| 261865 | Miguel Gutiérrez | sprintspeed | 80 | 81 | +1 |
| 261865 | Miguel Gutiérrez | stamina | 85 | 86 | +1 |
| 261865 | Miguel Gutiérrez | standingtackle | 78 | 80 | +2 |
| 262027 | T. Muharemović | standingtackle | 76 | 77 | +1 |
| 262088 | H. Haraldsson | acceleration | 77 | 78 | +1 |
| 262088 | H. Haraldsson | ballcontrol | 81 | 82 | +1 |
| 262088 | H. Haraldsson | dribbling | 81 | 82 | +1 |
| 262088 | H. Haraldsson | finishing | 69 | 70 | +1 |
| 262088 | H. Haraldsson | longshots | 66 | 67 | +1 |
| 262088 | H. Haraldsson | positioning | 76 | 77 | +1 |
| 262088 | H. Haraldsson | reactions | 76 | 77 | +1 |
| 262088 | H. Haraldsson | shortpassing | 79 | 80 | +1 |
| 262088 | H. Haraldsson | vision | 79 | 80 | +1 |
| 262118 | T. Livramento | acceleration | 80 | 82 | +2 |
| 262118 | T. Livramento | ballcontrol | 78 | 80 | +2 |
| 262118 | T. Livramento | crossing | 79 | 82 | +3 |
| 262118 | T. Livramento | defensiveawareness | 77 | 79 | +2 |
| 262118 | T. Livramento | headingaccuracy | 56 | 58 | +2 |
| 262118 | T. Livramento | interceptions | 78 | 81 | +3 |
| 262118 | T. Livramento | reactions | 78 | 80 | +2 |
| 262118 | T. Livramento | shortpassing | 77 | 79 | +2 |
| 262118 | T. Livramento | slidingtackle | 78 | 81 | +3 |
| 262118 | T. Livramento | sprintspeed | 84 | 86 | +2 |
| 262118 | T. Livramento | stamina | 80 | 83 | +3 |
| 262118 | T. Livramento | standingtackle | 80 | 83 | +3 |
| 262138 | C. Lukeba | defensiveawareness | 80 | 81 | +1 |
| 262138 | C. Lukeba | headingaccuracy | 81 | 82 | +1 |
| 262138 | C. Lukeba | interceptions | 80 | 81 | +1 |
| 262138 | C. Lukeba | standingtackle | 85 | 86 | +1 |
| 262138 | C. Lukeba | strength | 78 | 79 | +1 |
| 262621 | G. Mamardashvili | gkdiving | 84 | 85 | +1 |
| 262621 | G. Mamardashvili | gkhandling | 81 | 82 | +1 |
| 262621 | G. Mamardashvili | gkpositioning | 84 | 85 | +1 |
| 262621 | G. Mamardashvili | gkreflexes | 84 | 85 | +1 |
| 262859 | L. Colwill | aggression | 84 | 85 | +1 |
| 262859 | L. Colwill | ballcontrol | 77 | 78 | +1 |
| 262859 | L. Colwill | defensiveawareness | 81 | 83 | +2 |
| 262859 | L. Colwill | headingaccuracy | 79 | 80 | +1 |
| 262859 | L. Colwill | interceptions | 81 | 82 | +1 |
| 262859 | L. Colwill | jumping | 84 | 85 | +1 |
| 262859 | L. Colwill | reactions | 78 | 79 | +1 |
| 262859 | L. Colwill | shortpassing | 79 | 80 | +1 |
| 262859 | L. Colwill | slidingtackle | 80 | 81 | +1 |
| 262859 | L. Colwill | sprintspeed | 73 | 74 | +1 |
| 262859 | L. Colwill | standingtackle | 81 | 83 | +2 |
| 262859 | L. Colwill | strength | 79 | 80 | +1 |
| 262881 | R. Ríos | ballcontrol | 83 | 84 | +1 |
| 262881 | R. Ríos | dribbling | 82 | 83 | +1 |
| 262881 | R. Ríos | finishing | 67 | 68 | +1 |
| 262881 | R. Ríos | interceptions | 68 | 69 | +1 |
| 262881 | R. Ríos | longpassing | 78 | 79 | +1 |
| 262881 | R. Ríos | longshots | 75 | 76 | +1 |
| 262881 | R. Ríos | positioning | 62 | 63 | +1 |
| 262881 | R. Ríos | reactions | 83 | 84 | +1 |
| 262881 | R. Ríos | shortpassing | 80 | 81 | +1 |
| 262881 | R. Ríos | stamina | 88 | 89 | +1 |
| 262881 | R. Ríos | standingtackle | 79 | 80 | +1 |
| 262881 | R. Ríos | vision | 78 | 79 | +1 |
| 263193 | E. Bitshiabu | defensiveawareness | 74 | 75 | +1 |
| 263193 | E. Bitshiabu | interceptions | 71 | 72 | +1 |
| 263193 | E. Bitshiabu | standingtackle | 76 | 77 | +1 |
| 263193 | E. Bitshiabu | strength | 92 | 93 | +1 |
| 263205 | B. Yılmaz | dribbling | 77 | 78 | +1 |
| 263370 | V. Barco | ballcontrol | 79 | 81 | +2 |
| 263370 | V. Barco | dribbling | 77 | 79 | +2 |
| 263370 | V. Barco | finishing | 42 | 43 | +1 |
| 263370 | V. Barco | interceptions | 74 | 76 | +2 |
| 263370 | V. Barco | longpassing | 78 | 80 | +2 |
| 263370 | V. Barco | longshots | 52 | 53 | +1 |
| 263370 | V. Barco | positioning | 73 | 75 | +2 |
| 263370 | V. Barco | reactions | 75 | 77 | +2 |
| 263370 | V. Barco | shortpassing | 80 | 82 | +2 |
| 263370 | V. Barco | stamina | 78 | 80 | +2 |
| 263370 | V. Barco | standingtackle | 74 | 76 | +2 |
| 263370 | V. Barco | vision | 77 | 79 | +2 |
| 263578 | Balde | acceleration | 90 | 92 | +2 |
| 263578 | Balde | ballcontrol | 81 | 83 | +2 |
| 263578 | Balde | crossing | 82 | 84 | +2 |
| 263578 | Balde | defensiveawareness | 77 | 79 | +2 |
| 263578 | Balde | headingaccuracy | 71 | 72 | +1 |
| 263578 | Balde | interceptions | 78 | 80 | +2 |
| 263578 | Balde | reactions | 80 | 82 | +2 |
| 263578 | Balde | shortpassing | 82 | 84 | +2 |
| 263578 | Balde | slidingtackle | 80 | 82 | +2 |
| 263578 | Balde | sprintspeed | 91 | 93 | +2 |
| 263578 | Balde | stamina | 77 | 79 | +2 |
| 263578 | Balde | standingtackle | 80 | 82 | +2 |
| 263620 | R. Lavia | aggression | 79 | 80 | +1 |
| 263620 | R. Lavia | ballcontrol | 78 | 80 | +2 |
| 263620 | R. Lavia | defensiveawareness | 78 | 79 | +1 |
| 263620 | R. Lavia | interceptions | 78 | 80 | +2 |
| 263620 | R. Lavia | longpassing | 76 | 78 | +2 |
| 263620 | R. Lavia | reactions | 77 | 78 | +1 |
| 263620 | R. Lavia | shortpassing | 79 | 81 | +2 |
| 263620 | R. Lavia | slidingtackle | 77 | 78 | +1 |
| 263620 | R. Lavia | stamina | 65 | 66 | +1 |
| 263620 | R. Lavia | standingtackle | 78 | 80 | +2 |
| 263620 | R. Lavia | strength | 77 | 78 | +1 |
| 263620 | R. Lavia | vision | 75 | 76 | +1 |
| 263765 | T. Bischof | ballcontrol | 81 | 83 | +2 |
| 263765 | T. Bischof | dribbling | 80 | 82 | +2 |
| 263765 | T. Bischof | finishing | 64 | 65 | +1 |
| 263765 | T. Bischof | interceptions | 58 | 60 | +2 |
| 263765 | T. Bischof | longpassing | 78 | 80 | +2 |
| 263765 | T. Bischof | longshots | 77 | 78 | +1 |
| 263765 | T. Bischof | positioning | 61 | 63 | +2 |
| 263765 | T. Bischof | reactions | 78 | 80 | +2 |
| 263765 | T. Bischof | shortpassing | 82 | 84 | +2 |
| 263765 | T. Bischof | stamina | 81 | 83 | +2 |
| 263765 | T. Bischof | standingtackle | 68 | 70 | +2 |
| 263765 | T. Bischof | vision | 78 | 80 | +2 |
| 264240 | Gavi | ballcontrol | 85 | 87 | +2 |
| 264240 | Gavi | dribbling | 86 | 88 | +2 |
| 264240 | Gavi | finishing | 71 | 73 | +2 |
| 264240 | Gavi | interceptions | 79 | 81 | +2 |
| 264240 | Gavi | longpassing | 82 | 84 | +2 |
| 264240 | Gavi | longshots | 70 | 72 | +2 |
| 264240 | Gavi | positioning | 81 | 83 | +2 |
| 264240 | Gavi | reactions | 86 | 88 | +2 |
| 264240 | Gavi | shortpassing | 84 | 86 | +2 |
| 264240 | Gavi | stamina | 84 | 86 | +2 |
| 264240 | Gavi | standingtackle | 78 | 80 | +2 |
| 264240 | Gavi | vision | 83 | 85 | +2 |
| 264298 | C. Bradley | slidingtackle | 75 | 76 | +1 |
| 264309 | A. Güler | acceleration | 78 | 79 | +1 |
| 264309 | A. Güler | ballcontrol | 84 | 86 | +2 |
| 264309 | A. Güler | crossing | 82 | 84 | +2 |
| 264309 | A. Güler | dribbling | 85 | 87 | +2 |
| 264309 | A. Güler | finishing | 76 | 77 | +1 |
| 264309 | A. Güler | longpassing | 82 | 83 | +1 |
| 264309 | A. Güler | positioning | 80 | 82 | +2 |
| 264309 | A. Güler | reactions | 80 | 81 | +1 |
| 264309 | A. Güler | shortpassing | 84 | 86 | +2 |
| 264309 | A. Güler | sprintspeed | 69 | 70 | +1 |
| 264309 | A. Güler | stamina | 75 | 76 | +1 |
| 264309 | A. Güler | vision | 84 | 85 | +1 |
| 264453 | M. van de Ven | defensiveawareness | 83 | 84 | +1 |
| 264453 | M. van de Ven | interceptions | 83 | 84 | +1 |
| 264453 | M. van de Ven | standingtackle | 84 | 85 | +1 |
| 264492 | Yeremay | acceleration | 84 | 85 | +1 |
| 264492 | Yeremay | ballcontrol | 77 | 79 | +2 |
| 264492 | Yeremay | crossing | 72 | 74 | +2 |
| 264492 | Yeremay | dribbling | 80 | 82 | +2 |
| 264492 | Yeremay | finishing | 70 | 71 | +1 |
| 264492 | Yeremay | longpassing | 68 | 69 | +1 |
| 264492 | Yeremay | positioning | 71 | 72 | +1 |
| 264492 | Yeremay | reactions | 78 | 79 | +1 |
| 264492 | Yeremay | shortpassing | 72 | 74 | +2 |
| 264492 | Yeremay | sprintspeed | 83 | 84 | +1 |
| 264492 | Yeremay | stamina | 67 | 68 | +1 |
| 264492 | Yeremay | vision | 71 | 72 | +1 |
| 264652 | B. Barcola | acceleration | 89 | 91 | +2 |
| 264652 | B. Barcola | agility | 88 | 89 | +1 |
| 264652 | B. Barcola | ballcontrol | 84 | 86 | +2 |
| 264652 | B. Barcola | crossing | 81 | 83 | +2 |
| 264652 | B. Barcola | dribbling | 86 | 88 | +2 |
| 264652 | B. Barcola | finishing | 80 | 82 | +2 |
| 264652 | B. Barcola | longshots | 74 | 75 | +1 |
| 264652 | B. Barcola | positioning | 84 | 86 | +2 |
| 264652 | B. Barcola | reactions | 82 | 83 | +1 |
| 264652 | B. Barcola | shortpassing | 83 | 85 | +2 |
| 264652 | B. Barcola | sprintspeed | 94 | 95 | +1 |
| 264652 | B. Barcola | vision | 79 | 80 | +1 |
| 264697 | M. Amoura | acceleration | 94 | 96 | +2 |
| 264697 | M. Amoura | ballcontrol | 86 | 88 | +2 |
| 264697 | M. Amoura | dribbling | 85 | 87 | +2 |
| 264697 | M. Amoura | finishing | 83 | 85 | +2 |
| 264697 | M. Amoura | headingaccuracy | 63 | 65 | +2 |
| 264697 | M. Amoura | longshots | 78 | 80 | +2 |
| 264697 | M. Amoura | positioning | 85 | 87 | +2 |
| 264697 | M. Amoura | reactions | 83 | 85 | +2 |
| 264697 | M. Amoura | shortpassing | 77 | 79 | +2 |
| 264697 | M. Amoura | shotpower | 78 | 80 | +2 |
| 264697 | M. Amoura | sprintspeed | 87 | 89 | +2 |
| 264697 | M. Amoura | strength | 45 | 47 | +2 |
| 264697 | M. Amoura | volleys | 84 | 86 | +2 |
| 264701 | A. Zakharyan | acceleration | 79 | 80 | +1 |
| 264701 | A. Zakharyan | ballcontrol | 74 | 75 | +1 |
| 264701 | A. Zakharyan | crossing | 72 | 73 | +1 |
| 264701 | A. Zakharyan | dribbling | 71 | 73 | +2 |
| 264701 | A. Zakharyan | finishing | 68 | 69 | +1 |
| 264701 | A. Zakharyan | longpassing | 75 | 76 | +1 |
| 264701 | A. Zakharyan | positioning | 69 | 70 | +1 |
| 264701 | A. Zakharyan | reactions | 72 | 73 | +1 |
| 264701 | A. Zakharyan | shortpassing | 72 | 73 | +1 |
| 264701 | A. Zakharyan | sprintspeed | 77 | 78 | +1 |
| 264701 | A. Zakharyan | stamina | 68 | 69 | +1 |
| 264701 | A. Zakharyan | vision | 73 | 74 | +1 |
| 264846 | Cristhian Mosquera | aggression | 77 | 78 | +1 |
| 264846 | Cristhian Mosquera | defensiveawareness | 77 | 78 | +1 |
| 264846 | Cristhian Mosquera | headingaccuracy | 77 | 78 | +1 |
| 264846 | Cristhian Mosquera | interceptions | 77 | 78 | +1 |
| 264846 | Cristhian Mosquera | reactions | 75 | 76 | +1 |
| 264846 | Cristhian Mosquera | shortpassing | 73 | 74 | +1 |
| 264846 | Cristhian Mosquera | slidingtackle | 76 | 77 | +1 |
| 264846 | Cristhian Mosquera | standingtackle | 80 | 81 | +1 |
| 264846 | Cristhian Mosquera | strength | 74 | 75 | +1 |
| 264862 | M. Akliouche | acceleration | 75 | 78 | +3 |
| 264862 | M. Akliouche | ballcontrol | 85 | 88 | +3 |
| 264862 | M. Akliouche | crossing | 76 | 79 | +3 |
| 264862 | M. Akliouche | dribbling | 84 | 87 | +3 |
| 264862 | M. Akliouche | finishing | 72 | 75 | +3 |
| 264862 | M. Akliouche | longpassing | 74 | 77 | +3 |
| 264862 | M. Akliouche | positioning | 74 | 77 | +3 |
| 264862 | M. Akliouche | reactions | 78 | 81 | +3 |
| 264862 | M. Akliouche | shortpassing | 80 | 83 | +3 |
| 264862 | M. Akliouche | sprintspeed | 74 | 77 | +3 |
| 264862 | M. Akliouche | stamina | 77 | 80 | +3 |
| 264862 | M. Akliouche | vision | 82 | 85 | +3 |
| 265188 | G. Scalvini | aggression | 81 | 84 | +3 |
| 265188 | G. Scalvini | ballcontrol | 70 | 73 | +3 |
| 265188 | G. Scalvini | defensiveawareness | 79 | 83 | +4 |
| 265188 | G. Scalvini | headingaccuracy | 73 | 76 | +3 |
| 265188 | G. Scalvini | interceptions | 81 | 85 | +4 |
| 265188 | G. Scalvini | jumping | 74 | 77 | +3 |
| 265188 | G. Scalvini | reactions | 77 | 80 | +3 |
| 265188 | G. Scalvini | shortpassing | 72 | 75 | +3 |
| 265188 | G. Scalvini | slidingtackle | 80 | 83 | +3 |
| 265188 | G. Scalvini | sprintspeed | 55 | 58 | +3 |
| 265188 | G. Scalvini | standingtackle | 82 | 86 | +4 |
| 265188 | G. Scalvini | strength | 71 | 74 | +3 |
| 265450 | J. Bakayoko | ballcontrol | 81 | 82 | +1 |
| 265450 | J. Bakayoko | crossing | 73 | 74 | +1 |
| 265450 | J. Bakayoko | dribbling | 83 | 84 | +1 |
| 265450 | J. Bakayoko | finishing | 74 | 75 | +1 |
| 265450 | J. Bakayoko | positioning | 74 | 75 | +1 |
| 265450 | J. Bakayoko | shortpassing | 72 | 73 | +1 |
| 265526 | G. Restes | gkdiving | 78 | 79 | +1 |
| 265526 | G. Restes | gkhandling | 74 | 75 | +1 |
| 265526 | G. Restes | gkpositioning | 77 | 78 | +1 |
| 265526 | G. Restes | gkreflexes | 80 | 81 | +1 |
| 265774 | K. De Winter | aggression | 71 | 72 | +1 |
| 265774 | K. De Winter | ballcontrol | 67 | 68 | +1 |
| 265774 | K. De Winter | defensiveawareness | 74 | 75 | +1 |
| 265774 | K. De Winter | headingaccuracy | 76 | 77 | +1 |
| 265774 | K. De Winter | interceptions | 71 | 72 | +1 |
| 265774 | K. De Winter | reactions | 71 | 72 | +1 |
| 265774 | K. De Winter | shortpassing | 68 | 69 | +1 |
| 265774 | K. De Winter | slidingtackle | 76 | 77 | +1 |
| 265774 | K. De Winter | standingtackle | 79 | 80 | +1 |
| 265774 | K. De Winter | strength | 70 | 71 | +1 |
| 266041 | L. Koleosho | acceleration | 92 | 95 | +3 |
| 266041 | L. Koleosho | ballcontrol | 72 | 75 | +3 |
| 266041 | L. Koleosho | crossing | 66 | 69 | +3 |
| 266041 | L. Koleosho | dribbling | 75 | 78 | +3 |
| 266041 | L. Koleosho | finishing | 64 | 66 | +2 |
| 266041 | L. Koleosho | longpassing | 56 | 58 | +2 |
| 266041 | L. Koleosho | positioning | 66 | 69 | +3 |
| 266041 | L. Koleosho | reactions | 66 | 69 | +3 |
| 266041 | L. Koleosho | shortpassing | 64 | 67 | +3 |
| 266041 | L. Koleosho | sprintspeed | 91 | 93 | +2 |
| 266041 | L. Koleosho | stamina | 67 | 69 | +2 |
| 266041 | L. Koleosho | vision | 67 | 70 | +3 |
| 266096 | Tomás Araújo | aggression | 73 | 77 | +4 |
| 266096 | Tomás Araújo | ballcontrol | 76 | 80 | +4 |
| 266096 | Tomás Araújo | defensiveawareness | 75 | 79 | +4 |
| 266096 | Tomás Araújo | headingaccuracy | 74 | 78 | +4 |
| 266096 | Tomás Araújo | interceptions | 78 | 82 | +4 |
| 266096 | Tomás Araújo | jumping | 89 | 93 | +4 |
| 266096 | Tomás Araújo | reactions | 78 | 82 | +4 |
| 266096 | Tomás Araújo | shortpassing | 78 | 82 | +4 |
| 266096 | Tomás Araújo | slidingtackle | 74 | 78 | +4 |
| 266096 | Tomás Araújo | sprintspeed | 83 | 86 | +3 |
| 266096 | Tomás Araújo | standingtackle | 80 | 84 | +4 |
| 266096 | Tomás Araújo | strength | 82 | 86 | +4 |
| 266127 | L. Hall | interceptions | 77 | 78 | +1 |
| 266127 | L. Hall | slidingtackle | 80 | 81 | +1 |
| 266160 | Mika Mármol | aggression | 72 | 74 | +2 |
| 266160 | Mika Mármol | ballcontrol | 72 | 73 | +1 |
| 266160 | Mika Mármol | defensiveawareness | 75 | 77 | +2 |
| 266160 | Mika Mármol | headingaccuracy | 71 | 73 | +2 |
| 266160 | Mika Mármol | interceptions | 76 | 78 | +2 |
| 266160 | Mika Mármol | jumping | 86 | 87 | +1 |
| 266160 | Mika Mármol | reactions | 69 | 71 | +2 |
| 266160 | Mika Mármol | shortpassing | 74 | 76 | +2 |
| 266160 | Mika Mármol | slidingtackle | 75 | 77 | +2 |
| 266160 | Mika Mármol | sprintspeed | 82 | 83 | +1 |
| 266160 | Mika Mármol | standingtackle | 76 | 78 | +2 |
| 266160 | Mika Mármol | strength | 74 | 76 | +2 |
| 266237 | P. Wanner | acceleration | 77 | 80 | +3 |
| 266237 | P. Wanner | agility | 76 | 79 | +3 |
| 266237 | P. Wanner | ballcontrol | 75 | 79 | +4 |
| 266237 | P. Wanner | dribbling | 75 | 79 | +4 |
| 266237 | P. Wanner | finishing | 60 | 63 | +3 |
| 266237 | P. Wanner | longpassing | 71 | 74 | +3 |
| 266237 | P. Wanner | longshots | 55 | 58 | +3 |
| 266237 | P. Wanner | positioning | 68 | 72 | +4 |
| 266237 | P. Wanner | reactions | 70 | 73 | +3 |
| 266237 | P. Wanner | shortpassing | 76 | 80 | +4 |
| 266237 | P. Wanner | sprintspeed | 73 | 76 | +3 |
| 266237 | P. Wanner | vision | 74 | 78 | +4 |
| 268259 | N. Weiper | ballcontrol | 68 | 69 | +1 |
| 268259 | N. Weiper | dribbling | 69 | 70 | +1 |
| 268259 | N. Weiper | finishing | 72 | 73 | +1 |
| 268259 | N. Weiper | headingaccuracy | 72 | 73 | +1 |
| 268259 | N. Weiper | positioning | 72 | 73 | +1 |
| 268259 | N. Weiper | reactions | 68 | 69 | +1 |
| 268259 | N. Weiper | shotpower | 68 | 69 | +1 |
| 268438 | A. Garnacho | acceleration | 88 | 90 | +2 |
| 268438 | A. Garnacho | ballcontrol | 79 | 81 | +2 |
| 268438 | A. Garnacho | crossing | 75 | 77 | +2 |
| 268438 | A. Garnacho | dribbling | 80 | 83 | +3 |
| 268438 | A. Garnacho | finishing | 77 | 79 | +2 |
| 268438 | A. Garnacho | longpassing | 66 | 68 | +2 |
| 268438 | A. Garnacho | positioning | 78 | 80 | +2 |
| 268438 | A. Garnacho | reactions | 77 | 79 | +2 |
| 268438 | A. Garnacho | shortpassing | 74 | 76 | +2 |
| 268438 | A. Garnacho | sprintspeed | 84 | 86 | +2 |
| 268438 | A. Garnacho | stamina | 74 | 76 | +2 |
| 268438 | A. Garnacho | vision | 73 | 75 | +2 |
| 268474 | L. Lucca | acceleration | 54 | 55 | +1 |
| 268474 | L. Lucca | ballcontrol | 72 | 73 | +1 |
| 268474 | L. Lucca | dribbling | 68 | 69 | +1 |
| 268474 | L. Lucca | finishing | 80 | 82 | +2 |
| 268474 | L. Lucca | headingaccuracy | 81 | 82 | +1 |
| 268474 | L. Lucca | longshots | 68 | 69 | +1 |
| 268474 | L. Lucca | positioning | 79 | 80 | +1 |
| 268474 | L. Lucca | reactions | 72 | 73 | +1 |
| 268474 | L. Lucca | shortpassing | 65 | 66 | +1 |
| 268474 | L. Lucca | shotpower | 85 | 86 | +1 |
| 268474 | L. Lucca | sprintspeed | 70 | 71 | +1 |
| 268474 | L. Lucca | strength | 81 | 82 | +1 |
| 268474 | L. Lucca | volleys | 75 | 76 | +1 |
| 268737 | S. Nypan | ballcontrol | 72 | 75 | +3 |
| 268737 | S. Nypan | dribbling | 70 | 73 | +3 |
| 268737 | S. Nypan | finishing | 66 | 68 | +2 |
| 268737 | S. Nypan | interceptions | 60 | 63 | +3 |
| 268737 | S. Nypan | longpassing | 70 | 73 | +3 |
| 268737 | S. Nypan | longshots | 66 | 68 | +2 |
| 268737 | S. Nypan | positioning | 69 | 72 | +3 |
| 268737 | S. Nypan | reactions | 70 | 73 | +3 |
| 268737 | S. Nypan | shortpassing | 71 | 74 | +3 |
| 268737 | S. Nypan | stamina | 75 | 78 | +3 |
| 268737 | S. Nypan | standingtackle | 58 | 60 | +2 |
| 268737 | S. Nypan | vision | 72 | 75 | +3 |
| 268889 | Álvaro Carreras | acceleration | 84 | 85 | +1 |
| 268889 | Álvaro Carreras | ballcontrol | 82 | 83 | +1 |
| 268889 | Álvaro Carreras | crossing | 79 | 80 | +1 |
| 268889 | Álvaro Carreras | defensiveawareness | 73 | 74 | +1 |
| 268889 | Álvaro Carreras | headingaccuracy | 55 | 56 | +1 |
| 268889 | Álvaro Carreras | interceptions | 78 | 80 | +2 |
| 268889 | Álvaro Carreras | reactions | 81 | 82 | +1 |
| 268889 | Álvaro Carreras | shortpassing | 76 | 77 | +1 |
| 268889 | Álvaro Carreras | slidingtackle | 75 | 77 | +2 |
| 268889 | Álvaro Carreras | sprintspeed | 86 | 87 | +1 |
| 268889 | Álvaro Carreras | stamina | 89 | 90 | +1 |
| 268889 | Álvaro Carreras | standingtackle | 76 | 77 | +1 |
| 268896 | H. Larsson | ballcontrol | 80 | 81 | +1 |
| 268896 | H. Larsson | shortpassing | 83 | 84 | +1 |
| 269087 | L. Yoro | aggression | 73 | 76 | +3 |
| 269087 | L. Yoro | ballcontrol | 69 | 72 | +3 |
| 269087 | L. Yoro | defensiveawareness | 77 | 80 | +3 |
| 269087 | L. Yoro | headingaccuracy | 76 | 79 | +3 |
| 269087 | L. Yoro | interceptions | 79 | 82 | +3 |
| 269087 | L. Yoro | jumping | 81 | 84 | +3 |
| 269087 | L. Yoro | reactions | 79 | 82 | +3 |
| 269087 | L. Yoro | shortpassing | 75 | 78 | +3 |
| 269087 | L. Yoro | slidingtackle | 80 | 83 | +3 |
| 269087 | L. Yoro | sprintspeed | 72 | 74 | +2 |
| 269087 | L. Yoro | standingtackle | 82 | 85 | +3 |
| 269087 | L. Yoro | strength | 75 | 78 | +3 |
| 269136 | K. Mainoo | ballcontrol | 80 | 82 | +2 |
| 269136 | K. Mainoo | dribbling | 82 | 83 | +1 |
| 269136 | K. Mainoo | finishing | 73 | 74 | +1 |
| 269136 | K. Mainoo | interceptions | 74 | 75 | +1 |
| 269136 | K. Mainoo | longpassing | 78 | 80 | +2 |
| 269136 | K. Mainoo | longshots | 62 | 63 | +1 |
| 269136 | K. Mainoo | positioning | 74 | 75 | +1 |
| 269136 | K. Mainoo | reactions | 78 | 79 | +1 |
| 269136 | K. Mainoo | shortpassing | 79 | 81 | +2 |
| 269136 | K. Mainoo | stamina | 74 | 75 | +1 |
| 269136 | K. Mainoo | standingtackle | 77 | 78 | +1 |
| 269136 | K. Mainoo | vision | 76 | 78 | +2 |
| 269186 | O. Óskarsson | acceleration | 73 | 75 | +2 |
| 269186 | O. Óskarsson | ballcontrol | 74 | 76 | +2 |
| 269186 | O. Óskarsson | dribbling | 68 | 70 | +2 |
| 269186 | O. Óskarsson | finishing | 74 | 76 | +2 |
| 269186 | O. Óskarsson | headingaccuracy | 73 | 75 | +2 |
| 269186 | O. Óskarsson | longshots | 69 | 70 | +1 |
| 269186 | O. Óskarsson | positioning | 76 | 78 | +2 |
| 269186 | O. Óskarsson | reactions | 74 | 76 | +2 |
| 269186 | O. Óskarsson | shortpassing | 72 | 74 | +2 |
| 269186 | O. Óskarsson | shotpower | 75 | 77 | +2 |
| 269186 | O. Óskarsson | sprintspeed | 74 | 76 | +2 |
| 269186 | O. Óskarsson | strength | 76 | 78 | +2 |
| 269186 | O. Óskarsson | volleys | 69 | 70 | +1 |
| 269476 | Hu Hetao | acceleration | 83 | 88 | +5 |
| 269476 | Hu Hetao | ballcontrol | 45 | 50 | +5 |
| 269476 | Hu Hetao | crossing | 57 | 63 | +6 |
| 269476 | Hu Hetao | defensiveawareness | 56 | 62 | +6 |
| 269476 | Hu Hetao | headingaccuracy | 35 | 40 | +5 |
| 269476 | Hu Hetao | interceptions | 62 | 68 | +6 |
| 269476 | Hu Hetao | reactions | 55 | 61 | +6 |
| 269476 | Hu Hetao | shortpassing | 49 | 54 | +5 |
| 269476 | Hu Hetao | slidingtackle | 52 | 58 | +6 |
| 269476 | Hu Hetao | sprintspeed | 84 | 89 | +5 |
| 269476 | Hu Hetao | stamina | 85 | 91 | +6 |
| 269476 | Hu Hetao | standingtackle | 57 | 63 | +6 |
| 269701 | N. Brown | acceleration | 87 | 88 | +1 |
| 269701 | N. Brown | ballcontrol | 79 | 80 | +1 |
| 269701 | N. Brown | crossing | 75 | 76 | +1 |
| 269701 | N. Brown | defensiveawareness | 73 | 74 | +1 |
| 269701 | N. Brown | interceptions | 71 | 72 | +1 |
| 269701 | N. Brown | reactions | 74 | 75 | +1 |
| 269701 | N. Brown | shortpassing | 78 | 79 | +1 |
| 269701 | N. Brown | slidingtackle | 80 | 81 | +1 |
| 269701 | N. Brown | sprintspeed | 79 | 80 | +1 |
| 269701 | N. Brown | stamina | 80 | 81 | +1 |
| 269701 | N. Brown | standingtackle | 76 | 77 | +1 |
| 269728 | J. Bahoya | dribbling | 78 | 79 | +1 |
| 269859 | A. Vermeeren | ballcontrol | 82 | 83 | +1 |
| 269859 | A. Vermeeren | shortpassing | 86 | 87 | +1 |
| 270077 | K. Koulierakis | aggression | 82 | 83 | +1 |
| 270077 | K. Koulierakis | ballcontrol | 70 | 71 | +1 |
| 270077 | K. Koulierakis | defensiveawareness | 77 | 79 | +2 |
| 270077 | K. Koulierakis | headingaccuracy | 73 | 74 | +1 |
| 270077 | K. Koulierakis | interceptions | 78 | 80 | +2 |
| 270077 | K. Koulierakis | jumping | 83 | 84 | +1 |
| 270077 | K. Koulierakis | reactions | 73 | 74 | +1 |
| 270077 | K. Koulierakis | shortpassing | 73 | 74 | +1 |
| 270077 | K. Koulierakis | slidingtackle | 75 | 76 | +1 |
| 270077 | K. Koulierakis | sprintspeed | 68 | 69 | +1 |
| 270077 | K. Koulierakis | standingtackle | 75 | 77 | +2 |
| 270077 | K. Koulierakis | strength | 78 | 80 | +2 |
| 270409 | Savinho | acceleration | 89 | 90 | +1 |
| 270409 | Savinho | agility | 90 | 91 | +1 |
| 270409 | Savinho | ballcontrol | 84 | 85 | +1 |
| 270409 | Savinho | crossing | 81 | 82 | +1 |
| 270409 | Savinho | dribbling | 86 | 88 | +2 |
| 270409 | Savinho | finishing | 74 | 75 | +1 |
| 270409 | Savinho | longshots | 67 | 68 | +1 |
| 270409 | Savinho | positioning | 79 | 80 | +1 |
| 270409 | Savinho | reactions | 79 | 80 | +1 |
| 270409 | Savinho | shortpassing | 79 | 80 | +1 |
| 270409 | Savinho | sprintspeed | 85 | 86 | +1 |
| 270409 | Savinho | vision | 80 | 81 | +1 |
| 270531 | O. Diomande | aggression | 83 | 84 | +1 |
| 270531 | O. Diomande | ballcontrol | 69 | 70 | +1 |
| 270531 | O. Diomande | defensiveawareness | 79 | 80 | +1 |
| 270531 | O. Diomande | headingaccuracy | 79 | 80 | +1 |
| 270531 | O. Diomande | interceptions | 76 | 77 | +1 |
| 270531 | O. Diomande | reactions | 73 | 74 | +1 |
| 270531 | O. Diomande | shortpassing | 71 | 72 | +1 |
| 270531 | O. Diomande | slidingtackle | 76 | 77 | +1 |
| 270531 | O. Diomande | standingtackle | 82 | 83 | +1 |
| 270531 | O. Diomande | strength | 90 | 91 | +1 |
| 270673 | W. Zaïre-Emery | ballcontrol | 81 | 84 | +3 |
| 270673 | W. Zaïre-Emery | dribbling | 78 | 81 | +3 |
| 270673 | W. Zaïre-Emery | finishing | 66 | 68 | +2 |
| 270673 | W. Zaïre-Emery | interceptions | 79 | 81 | +2 |
| 270673 | W. Zaïre-Emery | longpassing | 81 | 84 | +3 |
| 270673 | W. Zaïre-Emery | longshots | 69 | 71 | +2 |
| 270673 | W. Zaïre-Emery | positioning | 76 | 78 | +2 |
| 270673 | W. Zaïre-Emery | reactions | 79 | 82 | +3 |
| 270673 | W. Zaïre-Emery | shortpassing | 82 | 85 | +3 |
| 270673 | W. Zaïre-Emery | stamina | 88 | 91 | +3 |
| 270673 | W. Zaïre-Emery | standingtackle | 80 | 82 | +2 |
| 270673 | W. Zaïre-Emery | vision | 79 | 82 | +3 |
| 270821 | M. Penders | gkdiving | 79 | 84 | +5 |
| 270821 | M. Penders | gkhandling | 74 | 79 | +5 |
| 270821 | M. Penders | gkkicking | 78 | 82 | +4 |
| 270821 | M. Penders | gkpositioning | 73 | 77 | +4 |
| 270821 | M. Penders | gkreflexes | 77 | 82 | +5 |
| 270821 | M. Penders | reactions | 68 | 72 | +4 |
| 270857 | Mateus Fernandes | acceleration | 73 | 74 | +1 |
| 270857 | Mateus Fernandes | agility | 84 | 85 | +1 |
| 270857 | Mateus Fernandes | ballcontrol | 79 | 81 | +2 |
| 270857 | Mateus Fernandes | dribbling | 80 | 81 | +1 |
| 270857 | Mateus Fernandes | finishing | 69 | 70 | +1 |
| 270857 | Mateus Fernandes | longpassing | 77 | 78 | +1 |
| 270857 | Mateus Fernandes | longshots | 73 | 74 | +1 |
| 270857 | Mateus Fernandes | positioning | 75 | 76 | +1 |
| 270857 | Mateus Fernandes | reactions | 78 | 79 | +1 |
| 270857 | Mateus Fernandes | shortpassing | 79 | 81 | +2 |
| 270857 | Mateus Fernandes | sprintspeed | 67 | 68 | +1 |
| 270857 | Mateus Fernandes | vision | 79 | 81 | +2 |
| 271057 | Gustavo Sá | acceleration | 74 | 78 | +4 |
| 271057 | Gustavo Sá | agility | 74 | 78 | +4 |
| 271057 | Gustavo Sá | ballcontrol | 75 | 79 | +4 |
| 271057 | Gustavo Sá | dribbling | 73 | 77 | +4 |
| 271057 | Gustavo Sá | finishing | 67 | 71 | +4 |
| 271057 | Gustavo Sá | longpassing | 72 | 76 | +4 |
| 271057 | Gustavo Sá | longshots | 68 | 72 | +4 |
| 271057 | Gustavo Sá | positioning | 74 | 78 | +4 |
| 271057 | Gustavo Sá | reactions | 74 | 78 | +4 |
| 271057 | Gustavo Sá | shortpassing | 76 | 80 | +4 |
| 271057 | Gustavo Sá | sprintspeed | 75 | 79 | +4 |
| 271057 | Gustavo Sá | vision | 77 | 81 | +4 |
| 271114 | D. Seimen | gkdiving | 67 | 73 | +6 |
| 271114 | D. Seimen | gkhandling | 63 | 68 | +5 |
| 271114 | D. Seimen | gkkicking | 67 | 72 | +5 |
| 271114 | D. Seimen | gkpositioning | 65 | 70 | +5 |
| 271114 | D. Seimen | gkreflexes | 73 | 78 | +5 |
| 271114 | D. Seimen | reactions | 71 | 76 | +5 |
| 271121 | Q. Hartman | slidingtackle | 75 | 76 | +1 |
| 271421 | D. Doué | acceleration | 85 | 87 | +2 |
| 271421 | D. Doué | agility | 88 | 90 | +2 |
| 271421 | D. Doué | ballcontrol | 89 | 91 | +2 |
| 271421 | D. Doué | crossing | 74 | 76 | +2 |
| 271421 | D. Doué | dribbling | 91 | 93 | +2 |
| 271421 | D. Doué | finishing | 78 | 80 | +2 |
| 271421 | D. Doué | longshots | 83 | 85 | +2 |
| 271421 | D. Doué | positioning | 81 | 83 | +2 |
| 271421 | D. Doué | reactions | 85 | 87 | +2 |
| 271421 | D. Doué | shortpassing | 81 | 83 | +2 |
| 271421 | D. Doué | sprintspeed | 82 | 84 | +2 |
| 271421 | D. Doué | vision | 78 | 80 | +2 |
| 271575 | S. Pafundi | acceleration | 83 | 86 | +3 |
| 271575 | S. Pafundi | agility | 87 | 90 | +3 |
| 271575 | S. Pafundi | ballcontrol | 74 | 77 | +3 |
| 271575 | S. Pafundi | dribbling | 73 | 76 | +3 |
| 271575 | S. Pafundi | finishing | 56 | 59 | +3 |
| 271575 | S. Pafundi | longpassing | 66 | 69 | +3 |
| 271575 | S. Pafundi | longshots | 65 | 68 | +3 |
| 271575 | S. Pafundi | positioning | 58 | 61 | +3 |
| 271575 | S. Pafundi | reactions | 58 | 61 | +3 |
| 271575 | S. Pafundi | shortpassing | 70 | 74 | +4 |
| 271575 | S. Pafundi | sprintspeed | 71 | 74 | +3 |
| 271575 | S. Pafundi | vision | 68 | 71 | +3 |
| 272449 | Pablo Barrios | ballcontrol | 84 | 86 | +2 |
| 272449 | Pablo Barrios | dribbling | 83 | 85 | +2 |
| 272449 | Pablo Barrios | finishing | 70 | 71 | +1 |
| 272449 | Pablo Barrios | interceptions | 83 | 85 | +2 |
| 272449 | Pablo Barrios | longpassing | 81 | 83 | +2 |
| 272449 | Pablo Barrios | longshots | 72 | 73 | +1 |
| 272449 | Pablo Barrios | positioning | 76 | 78 | +2 |
| 272449 | Pablo Barrios | reactions | 82 | 84 | +2 |
| 272449 | Pablo Barrios | shortpassing | 85 | 87 | +2 |
| 272449 | Pablo Barrios | stamina | 85 | 87 | +2 |
| 272449 | Pablo Barrios | standingtackle | 80 | 82 | +2 |
| 272449 | Pablo Barrios | vision | 80 | 82 | +2 |
| 272455 | Pablo Marín | ballcontrol | 75 | 77 | +2 |
| 272455 | Pablo Marín | dribbling | 75 | 77 | +2 |
| 272455 | Pablo Marín | finishing | 70 | 71 | +1 |
| 272455 | Pablo Marín | interceptions | 70 | 72 | +2 |
| 272455 | Pablo Marín | longpassing | 72 | 74 | +2 |
| 272455 | Pablo Marín | longshots | 71 | 73 | +2 |
| 272455 | Pablo Marín | positioning | 74 | 76 | +2 |
| 272455 | Pablo Marín | reactions | 71 | 73 | +2 |
| 272455 | Pablo Marín | shortpassing | 74 | 76 | +2 |
| 272455 | Pablo Marín | stamina | 63 | 65 | +2 |
| 272455 | Pablo Marín | standingtackle | 72 | 74 | +2 |
| 272455 | Pablo Marín | vision | 74 | 76 | +2 |
| 272500 | C. Baleba | interceptions | 82 | 83 | +1 |
| 272505 | Endrick | acceleration | 88 | 92 | +4 |
| 272505 | Endrick | ballcontrol | 77 | 82 | +5 |
| 272505 | Endrick | dribbling | 78 | 83 | +5 |
| 272505 | Endrick | finishing | 78 | 83 | +5 |
| 272505 | Endrick | headingaccuracy | 70 | 75 | +5 |
| 272505 | Endrick | longshots | 74 | 78 | +4 |
| 272505 | Endrick | positioning | 76 | 81 | +5 |
| 272505 | Endrick | reactions | 77 | 82 | +5 |
| 272505 | Endrick | shortpassing | 68 | 73 | +5 |
| 272505 | Endrick | shotpower | 79 | 84 | +5 |
| 272505 | Endrick | sprintspeed | 86 | 91 | +5 |
| 272505 | Endrick | strength | 71 | 76 | +5 |
| 272505 | Endrick | volleys | 74 | 78 | +4 |
| 272834 | João Neves | ballcontrol | 87 | 89 | +2 |
| 272834 | João Neves | dribbling | 84 | 86 | +2 |
| 272834 | João Neves | finishing | 71 | 72 | +1 |
| 272834 | João Neves | interceptions | 85 | 87 | +2 |
| 272834 | João Neves | longpassing | 86 | 88 | +2 |
| 272834 | João Neves | longshots | 73 | 74 | +1 |
| 272834 | João Neves | positioning | 79 | 81 | +2 |
| 272834 | João Neves | reactions | 85 | 87 | +2 |
| 272834 | João Neves | shortpassing | 86 | 88 | +2 |
| 272834 | João Neves | stamina | 92 | 94 | +2 |
| 272834 | João Neves | standingtackle | 84 | 85 | +1 |
| 272834 | João Neves | vision | 84 | 86 | +2 |
| 272926 | L. Bergvall | ballcontrol | 78 | 81 | +3 |
| 272926 | L. Bergvall | dribbling | 79 | 82 | +3 |
| 272926 | L. Bergvall | finishing | 65 | 67 | +2 |
| 272926 | L. Bergvall | interceptions | 77 | 80 | +3 |
| 272926 | L. Bergvall | longpassing | 79 | 82 | +3 |
| 272926 | L. Bergvall | longshots | 69 | 71 | +2 |
| 272926 | L. Bergvall | positioning | 75 | 78 | +3 |
| 272926 | L. Bergvall | reactions | 77 | 80 | +3 |
| 272926 | L. Bergvall | shortpassing | 80 | 83 | +3 |
| 272926 | L. Bergvall | stamina | 79 | 82 | +3 |
| 272926 | L. Bergvall | standingtackle | 76 | 79 | +3 |
| 272926 | L. Bergvall | vision | 78 | 81 | +3 |
| 272978 | J. Hato | acceleration | 87 | 88 | +1 |
| 272978 | J. Hato | ballcontrol | 78 | 80 | +2 |
| 272978 | J. Hato | crossing | 66 | 68 | +2 |
| 272978 | J. Hato | defensiveawareness | 74 | 76 | +2 |
| 272978 | J. Hato | headingaccuracy | 69 | 70 | +1 |
| 272978 | J. Hato | interceptions | 77 | 79 | +2 |
| 272978 | J. Hato | reactions | 79 | 81 | +2 |
| 272978 | J. Hato | shortpassing | 79 | 81 | +2 |
| 272978 | J. Hato | slidingtackle | 73 | 75 | +2 |
| 272978 | J. Hato | sprintspeed | 84 | 86 | +2 |
| 272978 | J. Hato | stamina | 69 | 71 | +2 |
| 272978 | J. Hato | standingtackle | 77 | 79 | +2 |
| 273018 | Andrey Santos | ballcontrol | 80 | 83 | +3 |
| 273018 | Andrey Santos | dribbling | 77 | 80 | +3 |
| 273018 | Andrey Santos | finishing | 69 | 71 | +2 |
| 273018 | Andrey Santos | interceptions | 78 | 80 | +2 |
| 273018 | Andrey Santos | longpassing | 79 | 82 | +3 |
| 273018 | Andrey Santos | longshots | 72 | 74 | +2 |
| 273018 | Andrey Santos | positioning | 77 | 80 | +3 |
| 273018 | Andrey Santos | reactions | 79 | 82 | +3 |
| 273018 | Andrey Santos | shortpassing | 82 | 85 | +3 |
| 273018 | Andrey Santos | stamina | 91 | 94 | +3 |
| 273018 | Andrey Santos | standingtackle | 81 | 83 | +2 |
| 273018 | Andrey Santos | vision | 79 | 82 | +3 |
| 273651 | J. Quansah | aggression | 75 | 77 | +2 |
| 273651 | J. Quansah | ballcontrol | 71 | 73 | +2 |
| 273651 | J. Quansah | defensiveawareness | 75 | 77 | +2 |
| 273651 | J. Quansah | headingaccuracy | 74 | 76 | +2 |
| 273651 | J. Quansah | interceptions | 73 | 75 | +2 |
| 273651 | J. Quansah | jumping | 82 | 83 | +1 |
| 273651 | J. Quansah | reactions | 71 | 73 | +2 |
| 273651 | J. Quansah | shortpassing | 71 | 73 | +2 |
| 273651 | J. Quansah | slidingtackle | 76 | 78 | +2 |
| 273651 | J. Quansah | sprintspeed | 73 | 74 | +1 |
| 273651 | J. Quansah | standingtackle | 74 | 76 | +2 |
| 273651 | J. Quansah | strength | 79 | 81 | +2 |
| 273906 | Renato Veiga | aggression | 83 | 85 | +2 |
| 273906 | Renato Veiga | ballcontrol | 74 | 75 | +1 |
| 273906 | Renato Veiga | defensiveawareness | 75 | 77 | +2 |
| 273906 | Renato Veiga | headingaccuracy | 71 | 73 | +2 |
| 273906 | Renato Veiga | interceptions | 74 | 76 | +2 |
| 273906 | Renato Veiga | jumping | 85 | 86 | +1 |
| 273906 | Renato Veiga | reactions | 76 | 77 | +1 |
| 273906 | Renato Veiga | shortpassing | 77 | 78 | +1 |
| 273906 | Renato Veiga | slidingtackle | 77 | 79 | +2 |
| 273906 | Renato Veiga | sprintspeed | 78 | 79 | +1 |
| 273906 | Renato Veiga | standingtackle | 77 | 79 | +2 |
| 273906 | Renato Veiga | strength | 82 | 84 | +2 |
| 274288 | O. Gloukh | ballcontrol | 82 | 83 | +1 |
| 274288 | O. Gloukh | dribbling | 84 | 85 | +1 |
| 274288 | O. Gloukh | finishing | 74 | 75 | +1 |
| 274288 | O. Gloukh | longshots | 72 | 73 | +1 |
| 274288 | O. Gloukh | positioning | 69 | 70 | +1 |
| 274288 | O. Gloukh | reactions | 69 | 70 | +1 |
| 274288 | O. Gloukh | shortpassing | 75 | 76 | +1 |
| 274288 | O. Gloukh | vision | 76 | 77 | +1 |
| 274445 | K. Konaté | finishing | 72 | 73 | +1 |
| 274559 | K. Páez | ballcontrol | 74 | 75 | +1 |
| 274559 | K. Páez | dribbling | 75 | 76 | +1 |
| 274559 | K. Páez | positioning | 71 | 72 | +1 |
| 274559 | K. Páez | shortpassing | 72 | 73 | +1 |
| 274559 | K. Páez | vision | 72 | 73 | +1 |
| 275138 | L. Camara | ballcontrol | 77 | 79 | +2 |
| 275138 | L. Camara | dribbling | 76 | 77 | +1 |
| 275138 | L. Camara | finishing | 65 | 66 | +1 |
| 275138 | L. Camara | interceptions | 74 | 75 | +1 |
| 275138 | L. Camara | longpassing | 79 | 80 | +1 |
| 275138 | L. Camara | longshots | 75 | 76 | +1 |
| 275138 | L. Camara | positioning | 72 | 73 | +1 |
| 275138 | L. Camara | reactions | 76 | 77 | +1 |
| 275138 | L. Camara | shortpassing | 81 | 83 | +2 |
| 275138 | L. Camara | stamina | 81 | 82 | +1 |
| 275138 | L. Camara | standingtackle | 76 | 77 | +1 |
| 275138 | L. Camara | vision | 77 | 78 | +1 |
| 275291 | N. Pisilli | ballcontrol | 76 | 79 | +3 |
| 275291 | N. Pisilli | dribbling | 74 | 77 | +3 |
| 275291 | N. Pisilli | finishing | 65 | 67 | +2 |
| 275291 | N. Pisilli | interceptions | 72 | 74 | +2 |
| 275291 | N. Pisilli | longpassing | 71 | 74 | +3 |
| 275291 | N. Pisilli | longshots | 68 | 70 | +2 |
| 275291 | N. Pisilli | positioning | 68 | 71 | +3 |
| 275291 | N. Pisilli | reactions | 76 | 79 | +3 |
| 275291 | N. Pisilli | shortpassing | 77 | 80 | +3 |
| 275291 | N. Pisilli | stamina | 62 | 65 | +3 |
| 275291 | N. Pisilli | standingtackle | 72 | 74 | +2 |
| 275291 | N. Pisilli | vision | 65 | 68 | +3 |
| 275298 | A. Pavlović | aggression | 58 | 60 | +2 |
| 275298 | A. Pavlović | ballcontrol | 83 | 86 | +3 |
| 275298 | A. Pavlović | defensiveawareness | 81 | 83 | +2 |
| 275298 | A. Pavlović | interceptions | 76 | 79 | +3 |
| 275298 | A. Pavlović | longpassing | 85 | 87 | +2 |
| 275298 | A. Pavlović | reactions | 81 | 83 | +2 |
| 275298 | A. Pavlović | shortpassing | 86 | 89 | +3 |
| 275298 | A. Pavlović | slidingtackle | 77 | 79 | +2 |
| 275298 | A. Pavlović | stamina | 77 | 79 | +2 |
| 275298 | A. Pavlović | standingtackle | 76 | 79 | +3 |
| 275298 | A. Pavlović | strength | 74 | 76 | +2 |
| 275298 | A. Pavlović | vision | 79 | 81 | +2 |
| 275328 | C. Uzun | ballcontrol | 79 | 80 | +1 |
| 275328 | C. Uzun | dribbling | 81 | 82 | +1 |
| 275328 | C. Uzun | positioning | 78 | 79 | +1 |
| 275328 | C. Uzun | reactions | 74 | 75 | +1 |
| 275328 | C. Uzun | shortpassing | 77 | 78 | +1 |
| 275328 | C. Uzun | vision | 75 | 76 | +1 |
| 275507 | M. Sarr | aggression | 70 | 71 | +1 |
| 275507 | M. Sarr | ballcontrol | 63 | 64 | +1 |
| 275507 | M. Sarr | defensiveawareness | 77 | 78 | +1 |
| 275507 | M. Sarr | headingaccuracy | 75 | 76 | +1 |
| 275507 | M. Sarr | interceptions | 77 | 78 | +1 |
| 275507 | M. Sarr | jumping | 78 | 79 | +1 |
| 275507 | M. Sarr | reactions | 75 | 76 | +1 |
| 275507 | M. Sarr | shortpassing | 71 | 72 | +1 |
| 275507 | M. Sarr | slidingtackle | 74 | 75 | +1 |
| 275507 | M. Sarr | standingtackle | 78 | 79 | +1 |
| 275507 | M. Sarr | strength | 80 | 81 | +1 |
| 276372 | I. Ansah | finishing | 73 | 74 | +1 |
| 276372 | I. Ansah | positioning | 74 | 75 | +1 |
| 276471 | Altimira | interceptions | 77 | 78 | +1 |
| 276602 | A. Ouédraogo | ballcontrol | 78 | 81 | +3 |
| 276602 | A. Ouédraogo | dribbling | 82 | 85 | +3 |
| 276602 | A. Ouédraogo | finishing | 63 | 66 | +3 |
| 276602 | A. Ouédraogo | interceptions | 52 | 55 | +3 |
| 276602 | A. Ouédraogo | longpassing | 69 | 72 | +3 |
| 276602 | A. Ouédraogo | longshots | 58 | 61 | +3 |
| 276602 | A. Ouédraogo | positioning | 71 | 74 | +3 |
| 276602 | A. Ouédraogo | reactions | 74 | 77 | +3 |
| 276602 | A. Ouédraogo | shortpassing | 78 | 82 | +4 |
| 276602 | A. Ouédraogo | stamina | 67 | 70 | +3 |
| 276602 | A. Ouédraogo | standingtackle | 52 | 55 | +3 |
| 276602 | A. Ouédraogo | vision | 73 | 76 | +3 |
| 276682 | C. Ndour | ballcontrol | 75 | 79 | +4 |
| 276682 | C. Ndour | dribbling | 73 | 77 | +4 |
| 276682 | C. Ndour | finishing | 59 | 62 | +3 |
| 276682 | C. Ndour | interceptions | 58 | 62 | +4 |
| 276682 | C. Ndour | longpassing | 72 | 76 | +4 |
| 276682 | C. Ndour | longshots | 61 | 64 | +3 |
| 276682 | C. Ndour | positioning | 68 | 72 | +4 |
| 276682 | C. Ndour | reactions | 70 | 74 | +4 |
| 276682 | C. Ndour | shortpassing | 74 | 78 | +4 |
| 276682 | C. Ndour | stamina | 57 | 61 | +4 |
| 276682 | C. Ndour | standingtackle | 59 | 62 | +3 |
| 276682 | C. Ndour | vision | 73 | 77 | +4 |
| 277031 | A. Khusanov | aggression | 79 | 81 | +2 |
| 277031 | A. Khusanov | ballcontrol | 69 | 71 | +2 |
| 277031 | A. Khusanov | defensiveawareness | 77 | 79 | +2 |
| 277031 | A. Khusanov | headingaccuracy | 75 | 77 | +2 |
| 277031 | A. Khusanov | interceptions | 79 | 81 | +2 |
| 277031 | A. Khusanov | jumping | 87 | 89 | +2 |
| 277031 | A. Khusanov | reactions | 77 | 79 | +2 |
| 277031 | A. Khusanov | shortpassing | 69 | 71 | +2 |
| 277031 | A. Khusanov | slidingtackle | 78 | 80 | +2 |
| 277031 | A. Khusanov | sprintspeed | 90 | 92 | +2 |
| 277031 | A. Khusanov | standingtackle | 78 | 80 | +2 |
| 277031 | A. Khusanov | strength | 79 | 81 | +2 |
| 277179 | Fermín | acceleration | 76 | 77 | +1 |
| 277179 | Fermín | ballcontrol | 82 | 83 | +1 |
| 277179 | Fermín | dribbling | 82 | 83 | +1 |
| 277179 | Fermín | finishing | 79 | 80 | +1 |
| 277179 | Fermín | longshots | 79 | 80 | +1 |
| 277179 | Fermín | positioning | 83 | 84 | +1 |
| 277179 | Fermín | reactions | 79 | 80 | +1 |
| 277179 | Fermín | shortpassing | 81 | 82 | +1 |
| 277179 | Fermín | vision | 81 | 82 | +1 |
| 277211 | Franculino | ballcontrol | 75 | 76 | +1 |
| 277211 | Franculino | finishing | 79 | 80 | +1 |
| 277211 | Franculino | positioning | 73 | 74 | +1 |
| 277225 | Jon Martín | aggression | 73 | 76 | +3 |
| 277225 | Jon Martín | ballcontrol | 67 | 69 | +2 |
| 277225 | Jon Martín | defensiveawareness | 75 | 78 | +3 |
| 277225 | Jon Martín | headingaccuracy | 71 | 74 | +3 |
| 277225 | Jon Martín | interceptions | 77 | 80 | +3 |
| 277225 | Jon Martín | jumping | 79 | 81 | +2 |
| 277225 | Jon Martín | reactions | 73 | 75 | +2 |
| 277225 | Jon Martín | shortpassing | 69 | 71 | +2 |
| 277225 | Jon Martín | slidingtackle | 68 | 71 | +3 |
| 277225 | Jon Martín | sprintspeed | 68 | 70 | +2 |
| 277225 | Jon Martín | standingtackle | 70 | 73 | +3 |
| 277225 | Jon Martín | strength | 78 | 81 | +3 |
| 277295 | O. Bobb | ballcontrol | 77 | 78 | +1 |
| 277295 | O. Bobb | crossing | 73 | 74 | +1 |
| 277295 | O. Bobb | dribbling | 82 | 83 | +1 |
| 277295 | O. Bobb | finishing | 67 | 68 | +1 |
| 277295 | O. Bobb | positioning | 73 | 74 | +1 |
| 277295 | O. Bobb | shortpassing | 76 | 77 | +1 |
| 277427 | N. O'Reilly | acceleration | 73 | 74 | +1 |
| 277427 | N. O'Reilly | ballcontrol | 76 | 77 | +1 |
| 277427 | N. O'Reilly | crossing | 78 | 79 | +1 |
| 277427 | N. O'Reilly | defensiveawareness | 74 | 75 | +1 |
| 277427 | N. O'Reilly | headingaccuracy | 73 | 74 | +1 |
| 277427 | N. O'Reilly | interceptions | 76 | 77 | +1 |
| 277427 | N. O'Reilly | reactions | 76 | 77 | +1 |
| 277427 | N. O'Reilly | shortpassing | 78 | 79 | +1 |
| 277427 | N. O'Reilly | slidingtackle | 74 | 75 | +1 |
| 277427 | N. O'Reilly | sprintspeed | 76 | 77 | +1 |
| 277427 | N. O'Reilly | stamina | 75 | 76 | +1 |
| 277427 | N. O'Reilly | standingtackle | 76 | 77 | +1 |
| 277643 | Lamine Yamal | acceleration | 88 | 90 | +2 |
| 277643 | Lamine Yamal | ballcontrol | 90 | 92 | +2 |
| 277643 | Lamine Yamal | crossing | 89 | 91 | +2 |
| 277643 | Lamine Yamal | dribbling | 92 | 95 | +3 |
| 277643 | Lamine Yamal | finishing | 83 | 85 | +2 |
| 277643 | Lamine Yamal | longpassing | 84 | 86 | +2 |
| 277643 | Lamine Yamal | positioning | 88 | 90 | +2 |
| 277643 | Lamine Yamal | reactions | 88 | 90 | +2 |
| 277643 | Lamine Yamal | shortpassing | 88 | 90 | +2 |
| 277643 | Lamine Yamal | sprintspeed | 84 | 86 | +2 |
| 277643 | Lamine Yamal | stamina | 73 | 75 | +2 |
| 277643 | Lamine Yamal | vision | 88 | 90 | +2 |
| 277689 | C. Harder | acceleration | 74 | 76 | +2 |
| 277689 | C. Harder | ballcontrol | 70 | 72 | +2 |
| 277689 | C. Harder | dribbling | 71 | 73 | +2 |
| 277689 | C. Harder | finishing | 76 | 78 | +2 |
| 277689 | C. Harder | headingaccuracy | 75 | 77 | +2 |
| 277689 | C. Harder | positioning | 74 | 76 | +2 |
| 277689 | C. Harder | reactions | 72 | 74 | +2 |
| 277689 | C. Harder | shortpassing | 68 | 70 | +2 |
| 277689 | C. Harder | shotpower | 81 | 83 | +2 |
| 277689 | C. Harder | sprintspeed | 75 | 77 | +2 |
| 277689 | C. Harder | strength | 81 | 83 | +2 |
| 277689 | C. Harder | volleys | 66 | 68 | +2 |
| 277782 | Wang Yudong | acceleration | 85 | 91 | +6 |
| 277782 | Wang Yudong | agility | 80 | 85 | +5 |
| 277782 | Wang Yudong | ballcontrol | 64 | 70 | +6 |
| 277782 | Wang Yudong | dribbling | 60 | 66 | +6 |
| 277782 | Wang Yudong | finishing | 68 | 74 | +6 |
| 277782 | Wang Yudong | longpassing | 46 | 52 | +6 |
| 277782 | Wang Yudong | longshots | 55 | 61 | +6 |
| 277782 | Wang Yudong | positioning | 65 | 71 | +6 |
| 277782 | Wang Yudong | reactions | 64 | 70 | +6 |
| 277782 | Wang Yudong | shortpassing | 52 | 58 | +6 |
| 277782 | Wang Yudong | sprintspeed | 88 | 94 | +6 |
| 277782 | Wang Yudong | vision | 55 | 61 | +6 |
| 277954 | K. Yıldız | acceleration | 85 | 88 | +3 |
| 277954 | K. Yıldız | agility | 83 | 86 | +3 |
| 277954 | K. Yıldız | ballcontrol | 86 | 90 | +4 |
| 277954 | K. Yıldız | dribbling | 86 | 90 | +4 |
| 277954 | K. Yıldız | finishing | 79 | 82 | +3 |
| 277954 | K. Yıldız | longpassing | 70 | 73 | +3 |
| 277954 | K. Yıldız | longshots | 79 | 82 | +3 |
| 277954 | K. Yıldız | positioning | 79 | 83 | +4 |
| 277954 | K. Yıldız | reactions | 74 | 77 | +3 |
| 277954 | K. Yıldız | shortpassing | 75 | 79 | +4 |
| 277954 | K. Yıldız | sprintspeed | 84 | 87 | +3 |
| 277954 | K. Yıldız | vision | 77 | 81 | +4 |
| 278016 | Murillo | aggression | 81 | 82 | +1 |
| 278016 | Murillo | ballcontrol | 73 | 74 | +1 |
| 278016 | Murillo | defensiveawareness | 81 | 83 | +2 |
| 278016 | Murillo | headingaccuracy | 79 | 80 | +1 |
| 278016 | Murillo | interceptions | 83 | 84 | +1 |
| 278016 | Murillo | jumping | 95 | 96 | +1 |
| 278016 | Murillo | reactions | 82 | 83 | +1 |
| 278016 | Murillo | shortpassing | 75 | 76 | +1 |
| 278016 | Murillo | slidingtackle | 84 | 85 | +1 |
| 278016 | Murillo | sprintspeed | 78 | 79 | +1 |
| 278016 | Murillo | standingtackle | 82 | 84 | +2 |
| 278016 | Murillo | strength | 90 | 91 | +1 |
| 278228 | E. Baum | acceleration | 76 | 77 | +1 |
| 278228 | E. Baum | ballcontrol | 69 | 70 | +1 |
| 278228 | E. Baum | crossing | 70 | 71 | +1 |
| 278228 | E. Baum | defensiveawareness | 67 | 68 | +1 |
| 278228 | E. Baum | headingaccuracy | 58 | 59 | +1 |
| 278228 | E. Baum | interceptions | 66 | 68 | +2 |
| 278228 | E. Baum | reactions | 68 | 69 | +1 |
| 278228 | E. Baum | shortpassing | 68 | 69 | +1 |
| 278228 | E. Baum | slidingtackle | 67 | 69 | +2 |
| 278228 | E. Baum | sprintspeed | 75 | 76 | +1 |
| 278228 | E. Baum | stamina | 91 | 92 | +1 |
| 278228 | E. Baum | standingtackle | 69 | 71 | +2 |
| 278340 | P. Comuzzo | aggression | 79 | 83 | +4 |
| 278340 | P. Comuzzo | ballcontrol | 69 | 73 | +4 |
| 278340 | P. Comuzzo | defensiveawareness | 79 | 83 | +4 |
| 278340 | P. Comuzzo | headingaccuracy | 71 | 75 | +4 |
| 278340 | P. Comuzzo | interceptions | 78 | 82 | +4 |
| 278340 | P. Comuzzo | jumping | 69 | 72 | +3 |
| 278340 | P. Comuzzo | reactions | 76 | 80 | +4 |
| 278340 | P. Comuzzo | shortpassing | 65 | 69 | +4 |
| 278340 | P. Comuzzo | slidingtackle | 74 | 78 | +4 |
| 278340 | P. Comuzzo | sprintspeed | 61 | 64 | +3 |
| 278340 | P. Comuzzo | standingtackle | 76 | 80 | +4 |
| 278340 | P. Comuzzo | strength | 63 | 67 | +4 |
| 278349 | D. Huijsen | aggression | 79 | 81 | +2 |
| 278349 | D. Huijsen | ballcontrol | 82 | 83 | +1 |
| 278349 | D. Huijsen | defensiveawareness | 82 | 84 | +2 |
| 278349 | D. Huijsen | headingaccuracy | 83 | 85 | +2 |
| 278349 | D. Huijsen | interceptions | 83 | 85 | +2 |
| 278349 | D. Huijsen | jumping | 85 | 86 | +1 |
| 278349 | D. Huijsen | reactions | 81 | 83 | +2 |
| 278349 | D. Huijsen | shortpassing | 85 | 86 | +1 |
| 278349 | D. Huijsen | slidingtackle | 82 | 84 | +2 |
| 278349 | D. Huijsen | sprintspeed | 74 | 75 | +1 |
| 278349 | D. Huijsen | standingtackle | 82 | 84 | +2 |
| 278349 | D. Huijsen | strength | 78 | 80 | +2 |
| 278780 | F. Jeltsch | aggression | 71 | 74 | +3 |
| 278780 | F. Jeltsch | ballcontrol | 65 | 68 | +3 |
| 278780 | F. Jeltsch | defensiveawareness | 70 | 74 | +4 |
| 278780 | F. Jeltsch | headingaccuracy | 69 | 72 | +3 |
| 278780 | F. Jeltsch | interceptions | 70 | 74 | +4 |
| 278780 | F. Jeltsch | jumping | 75 | 78 | +3 |
| 278780 | F. Jeltsch | reactions | 69 | 72 | +3 |
| 278780 | F. Jeltsch | shortpassing | 67 | 70 | +3 |
| 278780 | F. Jeltsch | slidingtackle | 75 | 78 | +3 |
| 278780 | F. Jeltsch | sprintspeed | 73 | 76 | +3 |
| 278780 | F. Jeltsch | standingtackle | 78 | 82 | +4 |
| 278780 | F. Jeltsch | strength | 75 | 78 | +3 |
| 278901 | A. Bouaddi | aggression | 68 | 71 | +3 |
| 278901 | A. Bouaddi | ballcontrol | 78 | 81 | +3 |
| 278901 | A. Bouaddi | defensiveawareness | 68 | 71 | +3 |
| 278901 | A. Bouaddi | interceptions | 76 | 79 | +3 |
| 278901 | A. Bouaddi | longpassing | 79 | 82 | +3 |
| 278901 | A. Bouaddi | reactions | 73 | 76 | +3 |
| 278901 | A. Bouaddi | shortpassing | 81 | 84 | +3 |
| 278901 | A. Bouaddi | slidingtackle | 68 | 71 | +3 |
| 278901 | A. Bouaddi | stamina | 78 | 81 | +3 |
| 278901 | A. Bouaddi | standingtackle | 76 | 79 | +3 |
| 278901 | A. Bouaddi | strength | 72 | 75 | +3 |
| 278901 | A. Bouaddi | vision | 78 | 81 | +3 |
| 279044 | Geovany Quenda | acceleration | 87 | 88 | +1 |
| 279044 | Geovany Quenda | ballcontrol | 81 | 82 | +1 |
| 279044 | Geovany Quenda | crossing | 71 | 72 | +1 |
| 279044 | Geovany Quenda | dribbling | 80 | 82 | +2 |
| 279044 | Geovany Quenda | finishing | 63 | 64 | +1 |
| 279044 | Geovany Quenda | longpassing | 70 | 71 | +1 |
| 279044 | Geovany Quenda | positioning | 74 | 75 | +1 |
| 279044 | Geovany Quenda | reactions | 64 | 65 | +1 |
| 279044 | Geovany Quenda | shortpassing | 74 | 75 | +1 |
| 279044 | Geovany Quenda | sprintspeed | 83 | 84 | +1 |
| 279044 | Geovany Quenda | stamina | 75 | 76 | +1 |
| 279044 | Geovany Quenda | vision | 74 | 75 | +1 |
| 279173 | F. Mastantuono | acceleration | 79 | 81 | +2 |
| 279173 | F. Mastantuono | ballcontrol | 80 | 82 | +2 |
| 279173 | F. Mastantuono | crossing | 72 | 74 | +2 |
| 279173 | F. Mastantuono | dribbling | 82 | 85 | +3 |
| 279173 | F. Mastantuono | finishing | 70 | 72 | +2 |
| 279173 | F. Mastantuono | longpassing | 72 | 74 | +2 |
| 279173 | F. Mastantuono | positioning | 76 | 78 | +2 |
| 279173 | F. Mastantuono | reactions | 74 | 76 | +2 |
| 279173 | F. Mastantuono | shortpassing | 77 | 79 | +2 |
| 279173 | F. Mastantuono | sprintspeed | 73 | 75 | +2 |
| 279173 | F. Mastantuono | stamina | 73 | 75 | +2 |
| 279173 | F. Mastantuono | vision | 78 | 80 | +2 |
| 279202 | F. Camarda | acceleration | 65 | 67 | +2 |
| 279202 | F. Camarda | ballcontrol | 69 | 72 | +3 |
| 279202 | F. Camarda | dribbling | 66 | 68 | +2 |
| 279202 | F. Camarda | finishing | 68 | 71 | +3 |
| 279202 | F. Camarda | headingaccuracy | 66 | 69 | +3 |
| 279202 | F. Camarda | longshots | 61 | 63 | +2 |
| 279202 | F. Camarda | positioning | 61 | 64 | +3 |
| 279202 | F. Camarda | reactions | 61 | 64 | +3 |
| 279202 | F. Camarda | shortpassing | 61 | 63 | +2 |
| 279202 | F. Camarda | shotpower | 67 | 70 | +3 |
| 279202 | F. Camarda | sprintspeed | 68 | 70 | +2 |
| 279202 | F. Camarda | strength | 58 | 60 | +2 |
| 279202 | F. Camarda | volleys | 61 | 63 | +2 |
| 279604 | Jauregizar | ballcontrol | 80 | 81 | +1 |
| 279604 | Jauregizar | dribbling | 77 | 78 | +1 |
| 279604 | Jauregizar | finishing | 72 | 73 | +1 |
| 279604 | Jauregizar | interceptions | 83 | 84 | +1 |
| 279604 | Jauregizar | longpassing | 77 | 78 | +1 |
| 279604 | Jauregizar | longshots | 77 | 78 | +1 |
| 279604 | Jauregizar | positioning | 74 | 75 | +1 |
| 279604 | Jauregizar | reactions | 83 | 84 | +1 |
| 279604 | Jauregizar | shortpassing | 81 | 82 | +1 |
| 279604 | Jauregizar | stamina | 84 | 85 | +1 |
| 279604 | Jauregizar | standingtackle | 79 | 80 | +1 |
| 279604 | Jauregizar | vision | 80 | 81 | +1 |

## 5 执行与验收（等用户确认后）

1. `node gen-rewind-sql.ts --precheck` —— 只读预检，期望「差异 0」；有差异 = 键后来被动过，先人工看。
2. 逐片 `npx wrangler d1 execute whl-club --remote --file sql/NN-rewind.sql -y`，每片前后各跑一次预检（后一次应只剩「已回写键」的守卫不匹配 = 预期）。
3. `node gen-rewind-sql.ts --verify` —— 期望「差异 0」+ 抽 5 人全键表。
4. 回写直写 D1 不经 HTTP 写路径 ⇒ 手动 bump 公开缓存代际键 `cache:epoch:public`（SESSION_KV）。
5. 回滚：S9 的 `abilities-update-0{1,2}.sql` 原样重放（守卫是写入前旧 CA/PA，重放 changes=0 的风险见 S9 README）；**S9 的 rollback/abilities-rollback-0*.sql 在回写后作废**（那是把键置 NULL，不是恢复原值）。
