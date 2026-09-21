# prod-20260921-s9-free-status —— 全部自由身球员补标 `status = 'free'`（已于 2026-09-21 执行）

口径来源：用户裁决 2026-09-21——「球员库里只要没在 20 队的 status 都应该是 free」。
状态：**已于 2026-09-21 生产执行完毕**（单条 UPDATE / 17427 行 / `rows_written` 34854，验收七列全中；见 §十二）。

---

## 一、这批做什么

对 `players` 表一条批量 UPDATE：凡无归属（`club_id IS NULL`）且 `status <> 'free'` 的行，
把 `status` 写成 `'free'`、`updated_at` 写成本批时间戳。**期望触达 17427 行**。

只写 `status` 与 `updated_at` 两列；能力（`ca`/`pa`/`base_ca`/`game_attrs`）、合同、成长字段
（`growth_xp`/`levels_applied`/徽章）、队籍（`club_id`）**一行不动**，也**不走解约路径**
（`src/worker/transfers.ts:352-363` 那条会把 CA 回基准、清 XP 的解约恢复）。

## 二、为什么单开一批

上一批 `scripts/prod-20260921-s9-free-leftover/`（2026-09-21 已执行）只处理了 **304 名 s901 之外的遗留球员**
（平台在册但不在 s901 联盟名单），把它们 `club_id → NULL` + `status → 'free'`。
平台既存的 17427 名自由身（早于本轮就无归属）当时 `status` 仍是 `'normal'`——
本批就是把这批人补齐，让「状态」列与归属一致。

两批无重叠：上一批的 304 行 `status` 已是 `'free'`，本批守卫 `status <> 'free'` 天然排除它们。

## 三、集合与口径

- 平台 `clubs` 表恰好 **20 行**（16 人控 + 4 CPU：10 曼城 / 241 巴塞罗那 / 112172 RB莱比锡 / 131681 AC米兰）⇒「没在 20 队」= `players.club_id IS NULL`。
- 归属判定只看 `club_id`：球员库「自由身」筛选（`src/worker/routes/players.ts:160-166`）、
  海捞池（`src/worker/routes/market.ts:270`）、合同导入认领守卫（`src/worker/contracts-import.ts:252`）。
  `status` 是**标签层**：库内「自由身」一直由 `club_id IS NULL` 表达，`status` 只出现在状态筛选、闸门与 UI 徽章。
- 因此本批不改变任何归属/可签性，只让状态标签与归属口径一致（web 端 `STATUS_LABEL.free = 「自由身」`，灰徽，
  `web/src/pages/PlayersLibrary.tsx:22-30`）。

## 四、现场快照（2026-09-21T01:09Z，`npx wrangler d1 execute whl-club --remote --json --command`，只读）

| 项 | 实测 |
| --- | --- |
| `players` 总数 | 18301 |
| `club_id IS NULL`（自由身） | **17731** |
| ├ 其中 `status='free'` | 304（上一批释放的遗留） |
| └ 其中 `status='normal'`（本批目标） | **17427** |
| `club_id IS NOT NULL`（在册） | 570，全部 `status='normal'` |
| `club_id IS NOT NULL AND status='free'` | 0 |
| 守卫表 `contracts`/`listings`/`registrations`/`negotiation_sessions`/`transfers`/`bids` | 全 0 |

## 五、落库形状与守卫

```sql
UPDATE players SET status = 'free', updated_at = '2026-09-21T01:10:00.000Z'
WHERE club_id IS NULL AND status <> 'free';
```

- **幂等**：守卫 `status <> 'free'` ⇒ 重放 `changes = 0`。
- 写入量：约 **17427 × 2 ≈ 34.9k `rows_written`**（`status` 上有索引，`club_id` 未变），免费档 10 万/天可承受。
- `players` 无外键约束，故可用 `--file`（不受 `scripts/README.md` 里「含外键或大事务必须走 `--command`」约束）。

## 六、影响面核查（逐点，均已核代码）

把 17427 名自由身的 `status` 从 `'normal'` 改成 `'free'`，唯一变化是「状态标签」；所有以 `status` 当闸门的地方
要么先按 `club_id` 拦掉自由身，要么本来就接受 `'free'`：

| 代码点 | 逻辑 | 自由身受影响吗 |
| --- | --- | --- |
| `src/worker/bypass.ts:362` 海捞 | 只拒 `retired`/`listed` | 否，`'free'` 通过（海捞池 `src/worker/routes/market.ts:270` 本就含 `free`） |
| `src/worker/activations.ts:48,50` 激活 | 先拒 `club_id IS NULL`，再要求 `normal\|trainee` | 否，自由身在第 48 行就被拒 |
| `src/worker/bypass.ts:435,442` 强制拍卖 | 先拒 `club_id IS NULL`，再要求 `normal` | 否，同上 |
| `src/worker/bypass.ts:194` 续约 / `:276` 解约 | 作用于本队球员（有合同/归属） | 否 |
| `src/worker/routes/registration.ts:37,205` 报名 | 候选按 `club_id = ?` 取人；只拒 `retired` | 否 |
| `src/worker/routes/market.ts:315` 训练营激活池 | 要求 `status='trainee' AND club_id IS NOT NULL` | 否 |
| `src/worker/results.ts` 出场 XP | 按球队比赛记录匹配在册球员；整类跳过 `trainee` | 否 |
| `src/worker/routes/players.ts:170-176` 状态筛选 | 白名单含 `free`，按 `players.status = ?` 过滤 | 是（预期内）：状态列筛「自由身」现在会命中全部 17731 人 |
| `web/src/pages/PlayersLibrary.tsx:22-30` 徽章 | `free → 「自由身」`，灰徽 | 是（预期内）：显示与归属一致 |
| `src/worker/routes/admin/players.ts:14` 管理端 PATCH | `status` 可改（白名单同枚举） | 否，不影响 |

结论：**无功能副作用**，只有状态标签语义变准。

## 七、执行步骤

```bash
# 1. 执行前复查（只读）——期望与 §四 表一致
npx wrangler d1 execute whl-club --remote --file "$(pwd)/scripts/prod-20260921-s9-free-status/01-precheck.sql"
# 注意：远端 --file 只回聚合摘要；要看实际结果列须把 SQL 收成单行走 --command

# 2. 执行（期望 changes = 17427）
npx wrangler d1 execute whl-club --remote --file "$(pwd)/scripts/prod-20260921-s9-free-status/01-free-status.sql"

# 3. 验收（把 02-verify.sql 最后一行整行复制进 --command，单行 SQL）
npx wrangler d1 execute whl-club --remote --json --command "<02-verify.sql 最后一行的 SQL>"
```

## 八、验收判据（`02-verify.sql`）

| 列 | 期望 |
| --- | --- |
| `null_club` | 17731 |
| `free_now` | 17731（自由身全部为 `free`） |
| `rostered` | 570 |
| `rostered_not_normal` | 0 |
| `touched`（`updated_at = '2026-09-21T01:10:00.000Z'`） | 17427 |
| `free_total` | 17731 |
| `bad_free_with_club` | 0 |
| 守卫表六张 | 仍全 0 |

## 九、回滚

`99-rollback.sql`：按 `club_id IS NULL AND status='free' AND updated_at='2026-09-21T01:10:00.000Z'` 三重条件
把本批触达的 17427 行还原成 `'normal'`，**不会误伤**上一批释放的 304 人（它们的 `updated_at` 是那批的时间戳）。
`updated_at` 的原值未留档，回滚会把它写成 `'2026-09-21T01:15:00.000Z'`。

## 十、为什么不需要生成器

无源数据要读：目标集合完全由库内条件（`club_id IS NULL AND status <> 'free'`）定义，
一条带守卫的语句即可，且天然幂等。前几批要生成器是因为要从 xlsx/CSV 逐行取旧值与目标值——
本批没有逐行信息可落，故直接写 SQL 工件（与 `scripts/prod-20260920-s9-window-baseline/` 同形）。

## 十一、工件清单

| 文件 | 作用 |
| --- | --- |
| `01-precheck.sql` | 执行前只读快照（行尾注释为 2026-09-21 实测值） |
| `01-free-status.sql` | 落库语句（单条 UPDATE，守卫 `status <> 'free'`；头注释含口径与影响面） |
| `02-verify.sql` | 验收七列 + 守卫表（远端须走 `--command` 才看得到结果行） |
| `99-rollback.sql` | 回滚（按 `updated_at` 时间戳精确圈定） |

## 十二、执行记录（2026-09-21）

### 执行前复查（`01-precheck.sql`，`--file`）

| 项 | 实测 |
| --- | --- |
| 语句数 | 7（`rows_read` 73246 / `rows_written` 0 = 纯只读） |
| `players` 总数 | 18301 |
| `club_id IS NULL` | 17731（`status`：`free` 304 / `normal` 17427） |
| `club_id IS NOT NULL` | 570（全 `normal`） |
| `bad_free_with_club` | 0 |
| 守卫表六张 | 全 0 |

与 §四 快照完全一致，放行。

### 落库（`01-free-status.sql`，`--file`）

| 项 | 实测 |
| --- | --- |
| Total queries executed | 1 |
| Rows read / Rows written | 17732 / **34854**（= 17427 × 2，`status` 索引列 + 行） |
| `meta.changes` | 17428（D1 已知偏差：比实际行数多 1，历批同形） |
| sql_duration_ms | 179.6 |

### 验收（`02-verify.sql` 的单行 SQL，`--command`）

七列全中：

| 列 | 期望 | 实测 |
| --- | --- | --- |
| `null_club` | 17731 | **17731** |
| `free_now` | 17731 | **17731** |
| `rostered` | 570 | **570** |
| `rostered_not_normal` | 0 | **0** |
| `touched`（`updated_at = '2026-09-21T01:10:00.000Z'`） | 17427 | **17427** |
| `free_total` | 17731 | **17731** |
| `bad_free_with_club` | 0 | **0** |

分组复核：`club_id IS NULL` → 全 `free` ×17731；`club_id IS NOT NULL` → 全 `normal` ×570；守卫表六张仍全 0。

### 执行后状态

- 在册 **570**（全 `normal`，队籍与 s901 对齐后的联盟世界名单）；自由身 **17731**（全 `status='free'`）。
- 归属/可签性/能力/合同/成长字段一行未动；6 张守卫表仍全 0。
- 本批写入量 34854 rows_written（当日累计 ≈ 35.8k，免费档 10 万/天）。

### 未验证项与备注

- 未用 admin 会话在页面复核球员库「状态＝自由身」筛选与徽章渲染（纯展示口径，代码已核 `web/src/pages/PlayersLibrary.tsx:22-30`）。
- `99-rollback.sql` 未执行，可用（按 `updated_at = '2026-09-21T01:10:00.000Z'` 圈定 17427 行；`updated_at` 原值未留档）。
