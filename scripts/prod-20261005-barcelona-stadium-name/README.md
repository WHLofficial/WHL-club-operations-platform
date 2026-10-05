# 巴萨主场名修正：占位「巴塞罗那主场」→「诺坎普球场」（2026-10-05 执行）

## 1. 缘起与前态

用户令（2026-10-05）：「将巴萨主场名修正为诺坎普球场」。

`stadiums.name`（`club_id = 241`，巴塞罗那）执行前是**占位值**「巴塞罗那主场」（hex `E5B7B4E5A19EE7BD97E982A3E4B8BBE59CBA`，6 字，`updated_at 2026-10-04T15:03:28.557Z`，来自 CPU 接管/seed 流程的默认命名）。同表另外 17 行都是真实球场名（酋长球场 / 维拉公园球场 / 斯坦福桥球场 / 安菲尔德球场 / 老特拉福德球场 / 圣地亚哥·伯纳乌球场 / 红牛竞技场 …），故修正口径 = 与全表一致的真实名，不带后缀、不带赞助商。

## 2. 工件与执行

| 文件 | 说明 |
| --- | --- |
| `01-precheck.sql` | 只读：现值 + `hex(name)` 指纹 + 全表行数 |
| `02-fix.sql` | 带守卫 `UPDATE`（仅当现值仍是占位名才写） |
| `03-verify.sql` | 只读：新值 + hex + 其他队未被本批改动 |
| `rollback/01-rollback.sql` | 退回占位名（守卫：仅当现值是「诺坎普球场」） |

执行通道复用同日的 `../prod-20261005-s9-cpu-contracts/exec-shards.mjs`（未再复制一份）：

```
node ../prod-20261005-s9-cpu-contracts/exec-shards.mjs 02-fix.sql --remote --retry=3
→ 1 条语句 → changes 合计 1、rows_written 合计 1，失败批 0
```

两条通道细节：① 语句里**不能出现 `%`**（exec-shards 的 shell 元字符闸会 exit 3），所以 `updated_at` 写**字面量** `'2026-10-05T08:25:47.000Z'` 而不是 `strftime('%…')`；② 中文值经 `--command`（cmd.exe → npx → wrangler）通道写入，落库后用 `hex(name)` 逐字节复核，**未发生编码损坏**。

## 3. 验收（生产只读回读）

| 项 | 期望 | 实测 |
| --- | --- | --- |
| `club_id = 241` 的 `name` hex | `E8AFBAE59D8EE699AEE79083E59CBA`（诺坎普球场，5 字） | 一致 ✓ |
| `updated_at` | `2026-10-05T08:25:47.000Z` | 一致 ✓ |
| 其他 17 行的 `updated_at` 被本批改动数 | 0 | 0 ✓ |
| 全表行数 | 18 | 18 ✓ |

## 4. 影响面与缓存

- 展示点（**都需鉴权，均不走 `cachedJson` 公开缓存**）：管理端球队档案「主场档案」区块（`GET /clubs/:id/stadium`，`src/worker/routes/clubs.ts:695-732`）、教练台 `GET /me/club`（同文件 `:721` 的 `name`）、管理端天气预报预览（`src/worker/weather-ops.ts:93`）、`GET /club/home-matches` 的球场联表（`src/worker/routes/clubs.ts:842`）。
- 事件播报的 `{stadium}` 占位取自同列（`src/worker/event-ops.ts:520-523`：`name !== '' ? name : \`${ctx.name}主场\``）⇒ 之后触发的事件会用新名；**已固化的历史事件文本不改写**。
- **本次无需 bump KV 代际**：球场名不在任何公开 `cachedJson` 载荷里（公开的 `/clubs`、`/clubs/directory`、`/clubs/:id`、`/clubs/:id/standing` 都不含球场名）⇒ `cache:epoch:public` 仍是 19（同日两批数据操作后的值）。

## 5. 回滚

`node ../prod-20261005-s9-cpu-contracts/exec-shards.mjs rollback/01-rollback.sql --remote`（守卫使重放安全；若期间已被改成别的名字则不生效，需人工确认）。
