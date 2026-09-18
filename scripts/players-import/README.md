# 球员库离线导入（FC26db Base → players）

把 FC26db 当季全量球员灌进生产 `players`（首次建库 18301 人）。之所以走离线脚本而不是管理端网页导入：
`POST /api/admin/players/import/{preview,confirm}` 前有 `requireAdmin(..., 'club.players.import')`，需 OIDC 会话，
脚本拿不到 token；而部署前端走 UI 又受部署 gate 限制。

## 用法

```
node scripts/players-import/generate-sql.ts [xlsx路径] [每片语句数]
# 默认：E:/Downloads/FC26db20251217_fixed.xlsx、1000 语句/片
```

流程：读 `Base` 表 + `Growth+` 未来之星名单 → 按 `ID` 去重（源侧重复行整行同内容，保首行）→ 每 1000 行切片喂
`src/core/import.ts` 的 `normalizeImportBatch('A', …)`（与 `web/src/pages/Admin.tsx` 的 `IMPORT_SLICE` 同口径）
→ 经 `src/worker/players-import.ts` 的 `upsertStatement` 渲染成 SQL 字面量。SQL 文本与参数顺序直接取自生产函数
（喂假 DB 捕获 `prepare/bind`），生产改了这里自动跟上，不手抄。

输出：`sql/players-import-NN.sql`（**不入库**，见根 `.gitignore`；30MB 级生成物）+ `players-import-report.md`
（字段口径表、被拦下的行、每片行区间/字节/sha256 清单——sha256 即写进生产 D1 的逐字节内容，是入库的审计凭据）。

## 生产执行记录（2026-09-18）

```
npx wrangler d1 execute whl-club --remote --file scripts/players-import/sql/players-import-NN.sql  # 19 片，按序号
```

写入后核验：`n=18301 / uniq_fcid=18301 / uniq_uid=18301 / bound(club_id)=0 / game_attrs 71 键=18301 / null=0 / bad_json=0`；
`prestige` 分布 `1→17497 2→269 3→466 4→55 5→14`；`china_plan=399`、`is_future_star=104`（Growth+ 名单）、`growable=10474`。
回滚：`DELETE FROM players;`（导入前为空表，全量首灌，无跨表引用）。重跑幂等（`ON CONFLICT(fc_id) DO UPDATE`，只更 FC 源列）。

**写入成本**：D1 的 `rows_written` 把索引条目也算一行写入——`players` 有 4 个索引（`uid`/`fc_id` 两个 UNIQUE 自动索引、
`idx_players_club`、`idx_players_status`），故每名球员 = 1 行表 + 4 行索引 = **5 次写入**，本次 18301 × 5 ≈ 91.5k 行
（Workers Free 档上限 10 万行/天）。别为验证反复重跑。

## 未入库的输入

- **30 行 `naID = #N/A`**（`nationality`/`internationalrep` 同为 `#N/A`）：FC26db 国籍反查未命中，`FC26db…_backup.xlsx`
  的 `Main` 表同样是 `#N/A`，本地无源可补 → 校验拦下。日后补到 naID 重跑即幂等入账。
- **`club_id` 全为 NULL**：导入只写 FC 源列，不碰运营列（§5.4），全体球员初始未归属，绑队另行处理。
- **审计行未写**：绕过管理端即无 `players_import` 审计记录，本次以报告 + 分片 sha256 作为凭据。

## 数据缺口

文档（ROADMAP / TECH_DESIGN / 交接）写 18408 人，实际 `Base` 表 max_row=18408 = 表头 1 行 + 数据 18407 行，
多出来的 1 是表头被算进去的。源里另有 76 个重复 ID，故唯一球员 18331。
