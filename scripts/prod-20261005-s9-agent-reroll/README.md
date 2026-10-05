# 全库经纪人性格随机化批（`players.agent_tier`，2026-10-05 执行）

## 1. 缘起与口径

用户令（2026-10-05）：对全库球员经纪人性格做一次随机。

执行前实测：`players` 全表 **18301 行**，`agent_tier` 全是默认值 2（`distinct_tiers = 1`、`nulls = 0`、越界 0），即「温和 / 苛刻」两档在库里从来没出现过。

**口径（拍板）**：每名球员**独立均匀掷 1 / 2 / 3**（温和 / 普通 / 苛刻），一次性铺满全库；**不设**生产开窗重掷的 0.3 概率门槛。理由：前态全为 2，若照 `agent_reroll_prob=0.3` 走，七成球员仍会停在 2，看不出「随机」这件事；本批是数据铺底（首次让三档真实存在），不是开窗事件重掷。目标分布与生产重掷一致（三档等概率），随机源为 `crypto.randomInt(1, 4)`。

## 2. 工件

| 文件 | 说明 |
| --- | --- |
| `gen-agent-reroll-sql.ts` | 生成器。CLI：`[--verify] [--local]`。分页 5000 行读 `players`，逐人掷档，按新档位分组出 `UPDATE` |
| `exec-shards.mjs` | 执行器（自 2026-09-20 批复制；通道纪律见同批合同 README §6） |
| `sql/01-precheck.sql` | 只读预检（行数 18301 / distinct 1 / null 0 / 越界 0） |
| `sql/02-reroll.sql` | 63 条 `UPDATE`（每条 300 个 id，最长单条 1888 字节，在 4000 字节闸内） |
| `sql/03-verify.sql` | 只读验收（三档分布 + 越界/null 复查） |
| `sql/manifest.json` | 逐行 `(id, old, new)` 18301 条（审计凭据；**不入库**——`old` 恒为 2、`new` 可从 `02-reroll.sql` 反推） |
| `rollback/01-rollback.sql` | 单条 `UPDATE … WHERE agent_tier IN (1, 3)`（前态统一才成立，见 §5） |
| `agent-reroll-report.md` | 分布表 + 四份工件 sha256 |

写入形状（与 `src/worker/window-machine.ts:149` 的生产重掷同形，只差批次标记）：

```sql
UPDATE players SET agent_tier = <t>, updated_at = '2026-10-05T08:06:11.584Z' WHERE id IN (…300 个 id…);
```

## 3. 执行记录（2026-10-05，生产）

| 步 | 命令 | 结果 |
| --- | --- | --- |
| 预检 | `node exec-shards.mjs sql/01-precheck.sql --remote` | `players_total 18301 / distinct_tiers 1 / nulls 0 / out_of_range 0` ✓ |
| 落库 | `node exec-shards.mjs sql/02-reroll.sql --remote --retry=3` | 63 条全过（每批 600 变动，末批 358），`changes 18301` / `rows_written 36602` |
| 验收 A | `node exec-shards.mjs sql/03-verify.sql --remote` | `1 温和 6020 / 2 普通 6223 / 3 苛刻 6058`，实际改动 **12078** 行（6223 行掷回原值） |
| 验收 B | `node gen-agent-reroll-sql.ts --verify` | manifest 18301 行逐行比对，残留差异 **0** |

## 4. 执行后必做：bump 公开缓存代际

`agent_tier` 在公开读路径的缓存载荷里（`src/worker/routes/players.ts:92` 的 `COALESCE(players.agent_tier, 0)`；同文件 `:225` `:852` `:877` 三处 `cachedJson`），不 bump 则旧档位最长存活 24h。缓存键形为 `${scope}:v${epoch}:${key}`（`src/lib/guard.ts:215-218`），所以只需把人手改的数据对应的代际号 +1：

```
node node_modules/wrangler/bin/wrangler.js kv key put cache:epoch:public 19 --binding SESSION_KV --remote
```

本轮实测 18 → 19（KV 命名空间 `87e2d78308bc47e9b36dc6de53be0458`）。合同批（同日的 55 行）不直接改公开载荷形状，故两批执行完**统一 bump 一次**。

## 5. 回滚

`node exec-shards.mjs rollback/01-rollback.sql --remote` —— 单条 `UPDATE players SET agent_tier = 2, updated_at = '<批次 ts>' WHERE agent_tier IN (1, 3)`。它**只在「前态全库统一为 2」这个前提成立时正确**；若期间发生过开窗重掷或人工改档，需按 `manifest.json` 逐行重建（manifest 未入库，可从 `02-reroll.sql` 取 `new` 值、`old` 恒 2 复原）。

## 6. 遗留与影响面

- 生产开窗重掷照旧生效：`src/worker/window-machine.ts:119-140` 按 `agent_reroll_prob`（默认 0.3）在每次开窗时重掷三档等概率——本批只是给了三档一个真实起点，不改变该机制；`config` 里的 `agent_tiers`（`src/core/config.ts:233`，各档要价系数区间）本次未动。
- 展示点：球员页 `web/src/pages/Player.tsx:458`、筛选面板 `web/src/components/FilterPanel.tsx:227`、球员库 `web/src/lib/players-library.ts:335`；筛参 `agent_tier`（`src/worker/routes/players.ts:354`）。
- 线上回读（同日）：`/api/players?agent_tier=1` `/2` `/3` 各 200 且样本档位与筛参一致；球员详情 `agentTier` 与合同字段一并可见（如 Isak 3、Lamine Yamal 3、Kimmich 2）。列表响应键为 `['players','nextCursor']`（无 `total`），故分布数字以 D1 验收为准，不用 API 求和。
