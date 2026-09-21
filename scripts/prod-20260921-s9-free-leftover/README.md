# S9 队籍收尾 · 遗留球员释放自由身（一次性生产工件）

> 状态：**已于 2026-09-21 生产执行完毕**（304 条语句、912 rows_written，验收六列全中；见 §十三）。本批口径由用户 2026-09-21 裁定：`clubID改null，status改free`。
> 前序：`scripts/prod-20260920-s9-club-align/`（队籍对齐）已于 2026-09-21 生产执行完毕（570 人对齐、在册 874、自由身 17427）。

---

## 一、这一批做什么

把**平台在册、但不在联盟世界 20 队名单里**的球员释放为自由身：`players.club_id → NULL`、`players.status → 'free'`、`updated_at` 打上生成时点。

- 集合定义：`players.club_id IS NOT NULL`（在册 874）**减去** s901 队壳文件里的 570 个 `fc_id` ⇒ **304 人**。
- 一行不动：能力（`ca`/`pa`/`base_ca`/`game_attrs`）、合同（`contracts`）、成长（`growth_xp`/`levels_applied`/徽章）、`market_value`、其他资料列。
  —— 本批**不走解约路径**，故刻意不做 `src/worker/transfers.ts:358` 那套「CA 回 `base_ca` + XP/等级/徽章清零」；用户明确担心写归属会连带弄错成长，这里只动归属与状态标签。

## 二、为什么单开一批

- 队籍对齐批只负责「让 s901 那 570 人落到正确队壳」；这 304 人是**反向**问题（平台有、联盟世界没有），两者集合不交。
- 合同批（`scripts/prod-20260920-s9-contracts/`）与能力批（`.../s9-abilities/`）的 fc_id 全在 570 人集合内，与本批无交集；本批先跑不会影响它们的分类结果。
- 跑完之后「联盟世界名单 = 平台在册名单 = 570 人」，后续合同批的 `create`/`claim` 判断与报名候选才算干净。

## 三、数据源与集合怎么定

- 源：`E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901`（20 个 `<clubs.id> - <队名>.xlsx`，sheet `Squad Info`，键 `playerid`，文件名正则 `/^(\d+)\s*-\s*(.+)\.xlsx$/i`，`splitted/` 子目录天然被过滤）⇒ 570 个 fc_id。
- 生产：`SELECT fc_id, name, club_id, status FROM players WHERE club_id IS NOT NULL`（生成时点 874 行）。
- 补集在**本地**算（不往 SQL 里塞 570 项 `NOT IN` 长串）。
- 生成器会先查 `club_id IS NOT NULL AND fc_id IS NULL` 的行数，**非 0 直接报错**：`fc_id` 是本批唯一定位键，为空则该行会被读成 `fc_id = 0` 产出一条永不命中的假语句（本地演练时踩到过）。

## 四、现场快照（2026-09-21 执行前）

| 项 | 值 |
| --- | --- |
| 在册（`club_id IS NOT NULL`） | 874 |
| 自由身（`club_id IS NULL`） | 17427 |
| `status = 'free'` 行数 | **0**（全库 18301 行都是 `status='normal'`） |
| 待释放 | **304** |
| 守卫表 `contracts`/`listings`/`registrations`/`negotiation_sessions`/`transfers`/`bids` | 全 0 |
| 本批写后预期 | 在册 570、自由身 17731、`status='free'` 304 |

待释放球员按现挂队伍分布（释放后各队名单 = 联盟世界队壳行数）：

| 队 | id | 待释放 | 释放后名单 |
| --- | --- | --- | --- |
| 慕尼黑1860 | 33 | 29 | 26 |
| 奥林匹亚科斯 | 280 | 26 | 30 |
| 里昂 | 66 | 25 | 31 |
| 佛罗伦萨 | 110374 | 25 | 31 |
| 皇家贝蒂斯 | 449 | 23 | 25 |
| 诺丁汉森林 | 14 | 22 | 23 |
| RB莱比锡（CPU） | 112172 | 18 | 26 |
| 纽卡斯尔联 | 13 | 16 | 23 |
| AC米兰（CPU） | 131681 | 15 | 25 |
| 曼联 | 11 | 14 | 25 |
| 利物浦 | 9 | 12 | 37 |
| 拜仁慕尼黑 | 21 | 12 | 37 |
| 尤文图斯 | 45 | 12 | 31 |
| 巴塞罗那（CPU） | 241 | 10 | 29 |
| 阿斯顿维拉 | 2 | 9 | 30 |
| 切尔西 | 5 | 9 | 31 |
| 巴黎圣日耳曼 | 73 | 8 | 29 |
| 皇家马德里 | 243 | 8 | 23 |
| 曼城（CPU） | 10 | 6 | 28 |
| 阿森纳 | 1 | 5 | 30 |
| **合计** | | **304** | **570** |

## 五、落库形状与守卫

每行一条语句（每片 200 条，分片见 `sql/`）：

```sql
-- 206585 Kepa 1/normal -> NULL/free
UPDATE players SET club_id = NULL, status = 'free', updated_at = '<生成时点>'
 WHERE fc_id = 206585 AND club_id IS 1 AND status = 'normal';
```

- **守卫双列**：`club_id IS 旧值 AND status = 旧值`（`IS` 对非空值等价 `=`，null 安全）⇒ 重放、错版、他人先改过时 `changes = 0`。
- 回滚（`rollback/`，反向同形）：`SET club_id = 旧值, status = 旧status` + `WHERE fc_id = ? AND club_id IS NULL AND status = 'free'`。
- `players.club_id` / `players.status` 都**没有外键**（`src/db/migrations/0001_init.sql:8,17`），故本批可用 `--file` 分片执行，不受 `scripts/README.md:66` 的 `PRAGMA defer_foreign_keys` 纪律约束。
- 写入量：304 条 UPDATE × **3** 次行写 = **912 rows_written**（实测；写 `club_id` + `status` 两个索引列 ⇒ 行 + `idx_players_club` + `idx_players_status`。只写 `club_id` 的队籍对齐批是每条 2 次）。

## 六、为什么同时写 `status = 'free'`

- 归属判定**只看 `club_id`**：球员库「自由身」筛选（`src/worker/routes/players.ts:160-166`）、海捞池（`src/worker/routes/market.ts:270`）、合同导入认领守卫（`src/worker/contracts-import.ts:252`）。`status` 是标签层（球员库徽章/状态筛选，`web/src/pages/PlayersLibrary.tsx:22-30`）。
- 平台既存 17427 名自由身是 `status='normal'` + `club_id IS NULL`；本批按用户裁定改用 `free` 标（语义上更准：`free` 在库里原本只由解约路径 `src/worker/transfers.ts:358` 写入）。⇒ 执行后库里会出现两种「自由身」标法，属预期。
- 入队后会自动规范化：转会落位 `UPDATE players SET club_id = ?, status = ?`（`src/worker/transfers.ts:199`，值由新合同类型推出 `:128-136`）⇒ 签下后变回 `normal`/`trainee`，不会残留 `free` 徽章。
- 副作用提示：`status='free'` 不影响任何闸门（续约要 `normal`、解约要 `normal|trainee`、激活要 `normal|trainee` 等只看在本队时的状态），这 304 人本来就不在任何队里。

## 七、影响面

- 这 304 人不再属于 20 队名单：本季出场 XP 不再匹配（`src/worker/results.ts:608` 按 `club_id` 解析）、防线位置池按剩余在册球员现算（`src/worker/growth.ts:240-253`）、升级方案权限与通知收件人随之改变（`src/worker/routes/growth.ts:98`、`src/worker/growth.ts:533`）。
- 20 队报名候选名单从 874 收回到 **570**（= 联盟世界名单）。
- **不动能力与成长**：`ca`/`base_ca`/`growth_xp`/`levels_applied`/徽章一行不改 ⇒ 这批人与「被解约」不同，将来若被签下不会从初始态重新成长（差异是有意的，用户口径）。
- EA 原始队籍不会丢：留在 `game_attrs.$.TeamID`。

## 八、执行步骤（已于 2026-09-21 执行，步骤留档）

0. 生成工件：`node scripts/prod-20260921-s9-free-leftover/gen-free-leftover-sql.ts`（对 `--remote` 只读抓旧队籍/旧 status，产出分片与报告）。
1. 生产只读复查：`node gen-free-leftover-sql.ts --verify` ⇒ 期望「s901 名单 570；在册 874；遗留 304」，退出码 4（有差异）；再跑 `01-precheck.sql`。
   - ⚠️ **免费档日读取配额**：2026-09-21 凌晨本账号 rows read 配额曾被跑满（Cloudflare 报 `exceeded D1's free tier daily row read limit`，UTC 00:00 重置 = 本地 08:00）。生成/预检 + 执行请安排在同一天配额重置后，别和其他大批次叠。
2. 逐片执行：`npx wrangler d1 execute whl-club --remote --file <绝对路径>`（`sql/free-leftover-update-01.sql`、`-02.sql`）。
   - 注意：`--file` 即使加 `--json` 也只回聚合摘要（`Rows read/written` + `meta`），**取不到结果行**；要看 SELECT 列必须用 `--command`（单行 SQL）。
   - `meta.changes` 在 D1 不可靠（队籍对齐批里 481 语句报 201/201/82），按 `Rows written` 与验收查询判断。
3. 验收：重跑 `--verify` ⇒ 期望「遗留 0」（退出码 0）；跑 `02-verify.sql` 看六列判据。

## 九、验收判据

| 列 | 期望 | 含义 |
| --- | --- | --- |
| `want_rows` | 304 | 内联的 fc_id 条数（`json_each`，刻意不用 `VALUES`：SQLite compound SELECT 上限 500） |
| `still_rostered` | 0 | 期望集合里还有人挂队（应无） |
| `status_not_free` | 0 | 期望集合里 `status != 'free'` 的行（应无） |
| `null_club` | 17731 | 全库自由身（17427 + 304） |
| `rostered_now` | 570 | 全库在册（= 联盟世界名单） |
| `touched` | 304 | `updated_at = '<生成时点>'` 的行 |

另附逐队 `roster_now` 查询，应逐队等于 s901 队壳行数（见 §四表末列）。

## 十、回滚

```
npx wrangler d1 execute whl-club --remote --file <绝对路径>/rollback/free-leftover-rollback-01.sql
npx wrangler d1 execute whl-club --remote --file <绝对路径>/rollback/free-leftover-rollback-02.sql
```

回滚把 `club_id`（NULL → 旧队）与 `status`（`free` → 旧值）一起还原，守卫按导入后的新值 ⇒ 重复执行 `changes = 0`。回滚分片必须随本目录提交（旧值执行后无法再从库内复现）。

## 十一、工件清单

| 文件 | 内容 |
| --- | --- |
| `gen-free-leftover-sql.ts` | 生成器：读 s901 队壳 + 只读抓生产在册 → 产分片/回滚/预检/验收/报告 |
| `01-precheck.sql` | 执行前只读复查（在册/自由身/`free` 计数 + 6 张守卫表 + 逐队名单 + status 分布） |
| `02-verify.sql` | 执行后验收（六列判据 + 逐队名单） |
| `free-leftover-report.md` | 生成报告：逐队分布 / 守卫表 / 分片 sha256 / 说明 |
| `sql/free-leftover-update-01..02.sql` | 落库分片（**gitignore**：含生成时点的生产旧值，不可逐字节复现） |
| `rollback/free-leftover-rollback-01..02.sql` | 回滚分片（**提交**） |

> 除生成器与 README 外，上表工件（分片/回滚/预检/验收/报告）都由生成器产出、**随执行记录一起提交**：分片与回滚内嵌生成时点的生产旧值，本地演练用的那份不能当生产工件用。

## 十二、本地演练（2026-09-21）

在本地 D1（`--local`）上生成并跑了一遍完整往返，结论：落库写双列成功、重放 `changes = 0`、回滚把 `club_id`/`status` 一起还原、回滚重放 `changes = 0`。本地库有一行 `fc_id` 为空（`阿七`），据此给生成器加了「在册行 `fc_id` 为空即报错」的守卫。

## 十三、执行记录（2026-09-21）

### 执行前复查（只读，全中）

| 项 | 期望 | 实测 |
| --- | --- | --- |
| `rostered_now` | 874 | 874 |
| `null_club` | 17427 | 17427 |
| `free_now` | 0 | 0 |
| 六张守卫表（contracts/listings/registrations/negotiation_sessions/transfers/bids） | 全 0 | 全 0 |
| 逐队 `roster_now` | = §四「释放后名单」列 + 待释放列 | 逐队吻合（合计 874） |

生成器 `--verify` 报「s901 名单 570 人；在册 874 人；遗留 304 人」，生成时点 `2026-09-21T00:14:45.780Z`（UTC）。

### 逐片执行（`npx wrangler d1 execute whl-club --remote --file <分片>`）

| 分片 | 语句 | rows_read | rows_written | meta.changes |
| --- | --- | --- | --- | --- |
| `sql/free-leftover-update-01.sql` | 200 | 200 | 600 | 201（不可靠，忽略） |
| `sql/free-leftover-update-02.sql` | 104 | 104 | 312 | 105（同上） |
| **合计** | **304** | 304 | **912** | — |

### 验收（全中）

- `--verify` → 「s901 名单 570 人；在册 570 人；**遗留 0 人**」（退出码 0），在册 status 分布 `normal×570`。
- `02-verify.sql` 六列：`want_rows` **304** / `still_rostered` **0** / `status_not_free` **0** / `null_club` **17731** / `rostered_now` **570** / `touched` **304**。
- 逐队 `roster_now` 逐队等于 s901 队壳行数：阿森纳 30、阿斯顿维拉 30、切尔西 31、利物浦 37、曼城(CPU) 28、曼联 25、纽卡斯尔联 23、诺丁汉森林 23、拜仁慕尼黑 37、慕尼黑1860 26、尤文图斯 31、里昂 31、巴黎圣日耳曼 29、巴塞罗那(CPU) 29、皇家马德里 23、奥林匹亚科斯 30、皇家贝蒂斯 25、佛罗伦萨 31、RB莱比锡(CPU) 26、AC米兰(CPU) 25（合计 570）。

### 执行后状态

- 在册 **570**（= 联盟世界名单）、自由身 **17731**、`status='free'` **304**；六张守卫表仍全 0。
- 20 队报名候选名单从 874 收回 570；合同批 / 能力批的 fc_id 全在 570 内，不受影响。

### 未验证项与过程备注

- 未用 admin 会话在页面复核（球员库「自由身」筛选、海捞池）；只做了库内与生成器的数据层验收。
- 执行期间遇到两次环境故障，均与工件无关、重试即恢复：`npx wrangler` 在 Node v24 + Windows 下偶发 libuv 断言崩溃（`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`），以及 OAuth token 恰在 2026-09-20T17:45:24Z 到期时的一次「non-interactive environment」报错。
- 回滚（§十）两条分片可用，守卫按导入后新值（`club_id IS NULL AND status = 'free'`），重复执行不写。
