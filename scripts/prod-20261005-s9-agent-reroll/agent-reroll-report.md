# 全库经纪人性格随机化报告（players.agent_tier）

生成时点：2026-10-05T08:06:11.584Z（updated_at 批次标记；回滚按它写明）
口径：每名球员独立均匀掷 1/2/3（温和/普通/苛刻），一次性铺满全库 18301 行；
  与开窗期生产重掷同目标分布（src/worker/window-machine.ts:119-140，0.3 概率、三档等概率）。

## 分布

| 档位 | 随机化前 | 随机化后 |
| --- | --- | --- |
| 1 温和 | 0 | 6020 |
| 2 普通 | 18301 | 6223 |
| 3 苛刻 | 0 | 6058 |

实际改动 12078 行（其余 6223 行掷回原值）。

## 执行

```
node exec-shards.mjs sql/01-precheck.sql --remote            # 期望 18301 / 1 / 0 / 0
node exec-shards.mjs sql/02-reroll.sql --remote --retry=3    # 63 条 → changes 合计 18301
node exec-shards.mjs sql/03-verify.sql --remote              # 分布须与上表「随机化后」一致
node gen-agent-reroll-sql.ts --verify                        # 逐行核对 manifest，期望「残留差异 0」
```

执行后必须 bump KV `cache:epoch:public`（/api/players* 走 cachedJson，见生成器头注释）。
回滚：`node exec-shards.mjs rollback/01-rollback.sql --remote`（前态统一值 2）

## 工件摘要

- `sql/01-precheck.sql` sha256 `769ccea9d64cfbe1f21b67efc09e104c599ecc21ad289bded467aaa0869661e5`
- `sql/02-reroll.sql` sha256 `64e0c3a9407590f044ac807950e17b3212e3d6f0c30629a9cd67cb04f7c68fc1`
- `sql/03-verify.sql` sha256 `58f2beaa7cb398539e15b144475b2788d8f907f6f41b5f621315b24ea249c598`
- `rollback/01-rollback.sql` sha256 `16c8e8f0cfbc55222e6efa16f002268f48d9cb948784aeac846a87cd51ad6045`
- `sql/manifest.json` 逐行 (id, old, new) 18301 条（审计凭据；不可复现，故随 sql/ 不入库）
