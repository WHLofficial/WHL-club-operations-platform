# S9 属性回写批（v6.61.0 任务 1 · 2026-10-30）

把 S9（2026-09-20/21）人工订正进 `game_attrs` 的 34 项属性键改回 **FC26db 初始值**，让 `game_attrs` 恢复「官方初始存档」语义。S9 的 CA 涨幅保留 —— v6.61.0 起属性展示由 `delta = max(0, ca − base_ca)` 统一加成，不回写这批键的话那 254 人是「S9 值 + delta」双份。

## 口径

- **只动 2,336 个 34 项属性键**（254 人，平均 9.2 键/人）；`ca` / `pa` / `base_ca` / `game_attrs` 其余 37 个键一律不碰 ⇒ 合规、定价、换版逻辑零影响。
- 初始值源：`E:/Downloads/FC26db20251217_fixed.xlsx` 的 Base sheet（平台 v0.2.0 导入源，CA/PA 与 S9 写入前 253/253 全中）。
- S9 写入值源：`scripts/prod-20260920-s9-abilities/sql/abilities-update-0{1,2}.sql` 的 `json_set` 键值（257 条语句，其中 254 条带属性键）。
- S9 值 − FC26db 原值全为正（+1:1074 / +2:748 / +3:276 / +4:129 / +5:60 / +6:19 / +7:9 / +8:20 / +9:1）。

## 文件

| 文件 | 说明 |
|---|---|
| `gen-rewind-sql.ts` | 生成器 + 只读预检/验收（本脚本**绝不写库**） |
| `sql/01-06-rewind.sql` | 分片（≤50 人/片，.gitignore 忽略，可逐字复现） |
| `rewind-report.md` | 生成报告：分布 / 分片 sha256 / **逐人逐键 2,336 行比对表** |
| `precheck-report.md` | 只读预检结果（库内现值 == S9 写入值？） |
| `verify-report.md` | 写后验收结果（34 项 == FC26db？+ 抽 5 人全键表） |

## 用法

```bash
node gen-rewind-sql.ts                       # 生成分片 + 报告（本地，不碰库）
node gen-rewind-sql.ts --precheck            # 只读预检（生产 SELECT），差异必须 0
node gen-rewind-sql.ts --verify              # 写后验收（生产 SELECT），差异必须 0
```

## 执行步骤（等用户确认后）

1. 逐片 `npx wrangler d1 execute whl-club --remote --file sql/NN-rewind.sql -y`（01→06 顺序；每片守卫不匹配即 changes=0，不会误伤）。
2. `node gen-rewind-sql.ts --verify` 差异必须 0。
3. **手动 bump 公开缓存代际**：回写直写 D1 不经 HTTP 写路径、不触发 purge，须把 SESSION_KV 的 `cache:epoch:public` 值 +1，否则公开读最长 24h 还出旧值（v6.0.0 教训）。

## 回滚

- S9 的 `abilities-update-0{1,2}.sql` **原样重放**即可改回 S9 值（其 WHERE 守卫是写入前旧 CA/PA；若期间 CA 又涨过则守卫不命中，需按 `rewind-report.md` 逐键回填）。
- **S9 的 `rollback/abilities-rollback-0*.sql` 在回写后作废** —— 那份是把键置 NULL，不是恢复原值。

## 留痕（2026-10-30）

- 生成：6 片 / 254 人 / 2,336 键（`rewind-report.md` 含逐片 sha256 与逐键表）。
- 只读预检：**players 缺行 0 / 守卫键不匹配 0**（`precheck-report.md`，两轮：15:47Z 宽口径 + 16:26Z 严格 typeof 口径）。
- **写库：已于 2026-10-31 执行完毕（用户确认）**。逐片 `wrangler d1 execute --remote --file`：
  01–05 各 50 人（rows_read 50 / rows_written 200）、06 4 人（4 / 16），合计 **254 人 / rows_written 1,016**（每行 4 写 = players 行 + 3 条索引项）。
  幂等实证：重放第 1 片 rows_written = **0**（守卫全不命中；汇总 `changes:1` 是 D1 计数噪音，以 rows_written 为准）。
- **写后验收：`--verify` 与 FC26db 差异 0**（2,336 键全过）+ 抽 5 人 34 项全键表全 ✓（`verify-report.md`，2026-10-30T17:09Z 生产）。
- **缓存代际：`cache:epoch:public` 1287 → 1288**（SESSION_KV，wrangler kv key put，读回确认）——脚本直写 D1 不经 HTTP 写路径，此步保证公开读立即出回写后的新值。
- 尚未做：`0084` apply 生产、push 上线（等用户下令；顺序见 ROADMAP v6.61.0 节「上线注意」）。
