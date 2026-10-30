# 编制与成长名额回调（2026-10-30）

用户令（原话）：「＜87 且 PA≥87 且未练满可成长改回6个，一线队改回30人上限，训练营改回7人上限」。

只改生产 `config` 表三行数据，**不动代码**：`src/core/config.ts` 的默认值本来就是 30 / 7 / 6，是生产库被调上去的。

| 键 | 改前 | 改后 | 生效面 |
| --- | --- | --- | --- |
| `squad_min` | `19` | **`20`** | 注册校验 `squad_size` 下限、工作台「一线队 N/上限」的下限（同轮追加，脚本 `04-squad-min-20.sql`） |
| `squad_max` | `32` | **`30`** | 注册校验 `squad_size`、教练工作台「一线队 N/上限」 |
| `trainee_max` | `8` | **`7`** | 注册校验 `trainee_size`、工作台「训练营 N/上限」 |
| `ca_pa_limits` | premier `growthPa87: 7`、second `6` | 两档都 **`6`** | 注册校验 `ca_pa` 的成长名额档、阵容卡片绿标计数 |

`ge90` / `ge87` / `gk_min` 保持原值。

## 执行

```bash
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261030-squad-limits-revert/01-precheck.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261030-squad-limits-revert/02-apply.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261030-squad-limits-revert/04-squad-min-20.sql
npx wrangler d1 execute whl-club --remote --file scripts/prod-20261030-squad-limits-revert/03-verify.sql
```

`config` 在 isolate 内存里按 `CONFIG_TTL_MS = 60_000` 缓存，改完最多一分钟全边缘生效；不用清缓存、不用重新部署。

## 回滚

```sql
UPDATE config SET value = '19' WHERE key = 'squad_min';
UPDATE config SET value = '32' WHERE key = 'squad_max';
UPDATE config SET value = '8'  WHERE key = 'trainee_max';
UPDATE config SET value = json_set(value, '$.premier.growthPa87', 7, '$.second.growthPa87', 6) WHERE key = 'ca_pa_limits';
```

## 注

直写 D1 不经过 `PUT /api/admin/config`，因此**不会**产生 `audit_log` 的 `config_set` 记录（与本仓其它 `scripts/prod-*` 数据批同口径）；需要留痕时走管理端那条路。
