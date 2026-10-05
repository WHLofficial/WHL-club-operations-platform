# S9 合同导入批 · 巴塞罗那 + RB 莱比锡（2026-10-05 执行）

## 1. 缘起与范围

用户令（2026-10-05）：按 `E:\Downloads\一线队-S9.csv` 导入巴塞罗那与 RB 莱比锡两队的合同信息。

2026-09-20 批已导入 16 支用户操控队的 462 行合同，当时 4 支 CPU 队（10 曼城 / 241 巴塞罗那 / 112172 RB 莱比锡 / 131681 AC 米兰）的合同**明确未导**，理由是那轮用户只点了 16 队。本批补前两队，共 **55 行**：

| 队 | club_id | 正式 | 训练营 | 合计 |
| --- | --- | --- | --- | --- |
| 巴塞罗那 | 241 | 23 | 6 | 29 |
| RB 莱比锡 | 112172 | 26 | 0 | 26 |

曼城（10，10 行）与 AC 米兰（131681，16 行）仍缺，见 §7。

## 2. 口径（与 2026-09-20 批逐条同源）

| 项 | 口径 |
| --- | --- |
| CSV 列 | col5 ID → `players.fc_id`（5–6 位纯数字判球员行）；col19 违约金 → `release_fee`；col20 工资 → `wage`；col27 效力年 → `service_ticks` |
| 训练营行 | 违约金/工资两列写「训练营」的 6 行（巴萨青训，fc 256325 / 260815 / 274288 / 263370 / 260952 / 265774）→ `release_fee=5`（TRAINEE_RC）、`wage=0.75`（TRAINEE_WAGE）、`contract_type='trainee'`、`protection_ticks=NULL` |
| 刻度 | 全库存量合同 ticks=1（本仓现行刻度），生成器 `--ticks=1` |
| service_ticks | `ticks − 2 × 效力年`（效力年 2.5 / 2 / 1.5 / 1 / 0 → −4 / −3 / −2 / −1 / 1），负数合法 |
| protection_ticks | `service_ticks + 3`（训练营为 NULL） |
| 生效日 | `effective_from='2026-09-18'`（赛季锚点，与 9 月批一致） |
| 批次标记 | `signed_at='2026-10-05T08:04:39.843Z'`（生成时点；回滚按它精确删） |
| source | `'import'`（与端上通道写入区分） |

## 3. 工件

| 文件 | 说明 |
| --- | --- |
| `gen-cpu-contracts-sql.ts` | 生成器。CLI：`[CSV 路径] [--verify] [--local] [--ticks=N]`。闸门：有效行数不符 EXPECTED（29/26）→ exit 3；刻度未知 → exit 4；球员缺失或队籍不符 → exit 5；已有合同 → exit 6 |
| `exec-shards.mjs` | 执行器（自 2026-09-20 批复制；通道纪律见其头注释与 §6） |
| `sql/01-precheck.sql` | 只读预检（4 条） |
| `sql/02-contracts.sql` | 55 条带守卫 `INSERT … SELECT` |
| `sql/03-verify.sql` | 只读验收（5 条：行数 / 训练营数 / 保护期异常 / service 区间 / 按队分布） |
| `sql/manifest.json` | 生成时的 CSV、刻度、55 行明细与逐文件 sha256 |
| `rollback/01-rollback.sql` | 按 `signed_at` + 55 个 player_id 精确删（1 条） |
| `contracts-report.md` | 55 行逐行明细 + 四份工件 sha256 |

INSERT 形状（`NOT EXISTS` 守卫 ⇒ 重放零副作用，可安全 `--retry`）：

```sql
INSERT INTO contracts (player_id, club_id, release_fee, wage, contract_type, source,
                       signed_at, effective_from, service_ticks, protection_ticks, is_active)
SELECT p.id, <clubId>, <rc>, <wage>, '<type>', 'import',
       '<ts>', '2026-09-18', <service>, <protection>, 1
  FROM players p
 WHERE p.fc_id = ? AND p.club_id = ? AND p.id = ?
   AND NOT EXISTS (SELECT 1 FROM contracts WHERE player_id = p.id);
```

列序照 `src/worker/contracts-import.ts:186-214` 的规范 upsert（端上通道的列序是同一份）；`contracts` 表上无触发器（`src/db/migrations/0001_init.sql:53` 建表，仅 `idx_contracts_club` 索引），故回滚只需删 `contracts` 行。

## 4. 执行记录（2026-10-05，生产）

| 步 | 命令 | 结果 |
| --- | --- | --- |
| 预检 | `node exec-shards.mjs sql/01-precheck.sql --remote --retry=3` | `players_in_scope 55 / existing_contracts 0 / closed_regular_windows 1 / open_windows 0` ✓ |
| 落库 | `node exec-shards.mjs sql/02-contracts.sql --remote --retry=3` | 6 批，`changes 55` / `rows_written 165` |
| 验收 A | `node gen-cpu-contracts-sql.ts --verify` | 期望 55 行 / 库内匹配 55 行 / 残留差异 **0** |
| 验收 B | `node exec-shards.mjs sql/03-verify.sql --remote` | `contracts_now 55 / trainee_rows 6 / normal_without_protection 0 / trainee_with_protection 0`；按队 `241: 29 / 112172: 26` |
| 汇总核对 | 另查（只读） | `rc_sum 828` / `wage_sum 119.17`，与报告逐行明细合计一致 |

通道抖动：预检首跑与落库批 4、批 6 各失败一次（`exit 1` / Windows `exit 3221226505` UV 崩溃），`--retry=3` 重试通过；两次失败输出里都没有 `changes=0` 的批，故不存在半途落库。

## 5. 本地演练（通道级）

本地 D1 是 30 人 dev 夹具（无 241 / 112172 两队、21 份存量合同、窗口不是 closed 常规窗）⇒ 数据级本地演练不可行。改做**通道级**演练（`../scratch/rehearse-20261005.mjs`，`scratch/` 不入库）：同形状 INSERT 落 1 行 → 重放仍 1 行（守卫幂等）→ UPDATE 档位生效 → 清理后本地复原（contracts 21 行 / 30 人档位全 2）。首次演练落 0 行是守卫**正确空转**（选中的样本球员本地已有合同），不是语法问题。

## 6. 执行器通道纪律（`exec-shards.mjs`）

- `node exec-shards.mjs <sql> --remote|--local [--chunk=10] [--dry] [--retry=N] [--persist-to=dir]`；把工件折成单行语句再走 `wrangler d1 execute --command`。
- 单条 > 4000 字节直接 exit 3（cmd.exe 命令行约 5.5KB 上限）；语句含 `"` `%` `&` `|` `<` `>` 直接 exit 3（shell 会抢先解释）。本批最长单条 396 字节。
- `--retry` 默认 0：只对**带守卫、重放 changes=0** 的工件安全（本批 INSERT / 预检 / 验收 / 回滚都符合）。
- `--local` 不回传 `meta.changes`（恒 0），本地判断按行数。
- Windows 偶发 `exit 3221226505` + `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c`，重试即可（本批三次命中）。

## 7. 回滚与遗留

- 回滚：`node exec-shards.mjs rollback/01-rollback.sql --remote`（删本批 55 行；`source='import'` + `signed_at` + 55 个 id 三重限定，不碰 9 月批与端上通道写的合同）。
- 遗留一：曼城（10）与 AC 米兰（131681）仍无合同，需要时用同一生成器把 `CLUBS` 扩到四队重跑（EXPECTED 行数同步改）。
- 遗留二：端上通道 C 表达不了效力年（既有结论），本批的 `service_ticks` 只能靠离线批给。
- 影响面：两队球员自此有违约金条款与工资 —— 可被违约金强挖，合同保护期参与窗口逻辑；`contracts` 写入不影响公开缓存形状，但相邻的全库档位随机化批改了 `/api/players*`，故两批执行完统一 bump 了一次 KV 代际（18 → 19，见同批 README）。
