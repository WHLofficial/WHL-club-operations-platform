# S9 全员注册批 · 20 队全写（一线队 + 训练营）· 2026-10-05 生成

> **本目录只交付工件，未执行任何生产写。** 生成器取数全程只发 SELECT（`wrangler d1 execute --remote` 只读）；
> `exec-shards.mjs` 加了安全闸：`--remote` 不带 `--yes` 只打印批计划（dry-run）。
> 开关翻转、四键豁免、写批、回滚全部另等令。

## 1. 缘起与范围

用户 2026-10-05 令「将所有队的球员都注册完毕」（计划 `.zcode/plans/plan-trainee-play-allowance.md` §2 增量 B）。
口径（用户 m00980 拍定）：**训练营名单 = 持训练营合同（`contracts.contract_type='trainee'`、`is_active=1`）的球员**；
同队其余全部一线队；**20 队全写**（CPU 两队 AC米兰 131681 / 曼城 10 没有训练营合同，全部一线队）。

写入两件事（快照整体替换）：

| 工件 | 内容 | 期望 changes |
| --- | --- | --- |
| `sql/02-registrations.sql` | `DELETE`（season=9 + 本批 20 队）清底 + 每队一条多行 `INSERT OR IGNORE`（570 行） | 570（DELETE 命中 0） |
| `sql/03-status-trainee.sql` | `UPDATE players SET status='trainee'`（69 人显式 id 清单） | 69 |

生成时实测（2026-10-05，生产只读）：**season=9**（`seasons.status='preparing'` 最新一条，created_at 2026-09-18T00:32:17.537Z）、
**20 队 570 人 = first_team 501 + trainee 69**；逐队拆分与计划 §2.2c **完全一致**（差异清单见 `report.md` §「与计划的差异」：无）。
生产批前基线：570 人全 `status='normal'`、`registrations` 表全空、69 人训练营合同全部满足「可成长且 PA−CA＞0」。

## 2. 顺序铁律：写批前先把 `squads_include_trainee` 置 `true`

```
第①步 precheck → 第②步【开关 true】→ 第③步 四键豁免 → 第④⑤步 写批 → 第⑥步 verify
```

- **为什么必须先把开关置 true**：写批会把 69 人 `players.status` 改成 `trainee`。名册端点 `/api/squads`（赛事仓
  `worker/lib/clubRoster.ts` 整点同步的唯一数据源）在开关关闭时只发 `status IN ('normal','listed')`，开关打开才加
  `'trainee'`。开关没开就写批 ⇒ 赛事仓下个整点把这 69 人从 tour 的 `player` 表 DELETE ⇒ 阵容写不进（`validateAssign` 失败）。
- 开关默认 `'false'`。管理端「平台参数」页（`web/src/pages/admin/SystemPage.tsx` 自动列全部 `CONFIG_KEYS`）可改；
  或 `PUT /api/admin/config`（超管），体 `{"key":"squads_include_trainee","value":"true"}`（value 为字符串，`null` 回默认）。
- 生效窗口：开关值已并进 `/api/squads` 的缓存键（`squads:all:${includeTrainee}`），翻转后最坏等 config 记忆化
  ≤60s 即换键重算，24h TTL 只是兜底。
- **部署前提**：支持该开关的代码（v6.33.1，本地 commit `1bff080`）必须先上线——否则生产行为里没有这个键，
  写批后 69 人会被赛事侧当作「已离队」删掉。

## 3. 四处超限队的 config 豁免（教练侧体检）

这四队按实际数据写会撞教练侧注册校验（`checkSquad`），已拍「豁免」（计划 §2.3）：不改名单，把四处阈值临时放到实际数据上沿。
四键只被 `src/worker/squad-context.ts` 的 `loadSquadContext` 读，调用方三处（工作台 GET、提交 POST、管理端合规扫描）口径一致。

| 键 | 现默认 | 特例期 | 为谁 | 设置（`PUT /api/admin/config` 体） |
| --- | --- | --- | --- | --- |
| `squad_min` | 20 | 19 | 纽卡斯尔联（一线队 19） | `{"key":"squad_min","value":"19"}` |
| `squad_max` | 30 | 32 | 利物浦（一线队 32） | `{"key":"squad_max","value":"32"}` |
| `trainee_max` | 7 | 8 | 佛罗伦萨（训练营 8） | `{"key":"trainee_max","value":"8"}` |
| `ca_pa_limits` | premier `growthPa87=6` | premier `growthPa87=7` | 皇家马德里（一线队 growth 7） | 见下（JSON 文本） |

`ca_pa_limits` 必须写全 premier 三字段（`checkSquad` 直读 `limits.ge90/ge87/growthPa87`，缺字段取 undefined）：

```json
{"key":"ca_pa_limits","value":"{\"premier\":{\"ge90\":1,\"ge87\":4,\"growthPa87\":7},\"second\":{\"ge90\":1,\"ge87\":3,\"growthPa87\":6}}"}
```

- `second` 不写会回落默认 `{ge90:1,ge87:3,growthPa87:6}`（`loadSquadContext` 的 `limitsJson?.[tier] ?? DEFAULT`），本表给全两档是图省事。
- **回滚**：四键 `value=null` 即回默认（或按默认值写回）；`ca_pa_limits` 删键回默认。期后佛罗伦萨/利物浦/纽卡/皇马
  会重新变红，需教练收名单或维持豁免。
- 改配置走 HTTP 写路径会触发公开缓存代际 purge（`/api/admin` 在 `WRITE_SCOPE_PREFIXES` 内），写批本身不会（见 §4 第⑧步）。

## 4. 执行 runbook（全部待令）

```bash
# ① precheck（只读）：期望 clubs_n=20 / roster_now=570 / trainee_contracts_now=69 / registrations_now=0 / status 全 normal
node exec-shards.mjs sql/01-precheck.sql --remote --yes

# ② 开关 true（见 §2；PUT /api/admin/config 或平台参数页）

# ③ 四键豁免（见 §3）

# ④ 写批①：21 条语句 5 批；期望 changes 合计 570（DELETE 清底命中 0 + 20 条多行 INSERT 570 行）
node exec-shards.mjs sql/02-registrations.sql --remote --yes --retry=3

# ⑤ 写批②：1 批；期望 changes 69
node exec-shards.mjs sql/03-status-trainee.sql --remote --yes --retry=3

# ⑥ verify（权威，只读）：期望 570 / 69 / 501 / players 501+69 / stray_rows=0，逐队拆分与 report.md 一致
node exec-shards.mjs sql/04-verify.sql --remote --yes

# ⑦ 公开缓存 bump（见第⑧步说明）→ 回读 /api/squads：570 人 + 69 行 squad='trainee'
npx wrangler kv key get cache:epoch:public --binding SESSION_KV --remote
npx wrangler kv key put cache:epoch:public <现值+1> --binding SESSION_KV --remote
curl -s https://club.whleague.win/api/squads | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const a=j.squads.flatMap(x=>x.players);console.log('players',a.length,'trainee',a.filter(p=>p.squad==='trainee').length)})"
#   期望 players 570 trainee 69；再抽查每队人数与 report.md 拆分表一致
```

- ⑧ **为什么需要 bump**：本批经 `wrangler d1 execute` 直写 D1，不经过 `src/worker/index.ts` 的写路径 purge 中间件；
  `/api/squads` 的 L2 载荷按代际键缓存（`${scope}:v${epoch}:${key}`，`src/lib/guard.ts:105/218`），不 bump 则公开读最长
  到 TTL（roster 24h）才看到新的 `squad` 字段。bump 口径与 v6.0.0 落库批 `scripts/player-names/load.mjs` 的 `--purge` 相同
  （读现值再写 +1；键不存在等价 0）。注意 `kv key put` 是远程写，与写批同一授权批次执行。
- exec-shards 的 `--retry` 默认 0；本批工件幂等（`INSERT OR IGNORE` + DELETE 清底 + UPDATE 显式 id），可开 `--retry=3`。
- `--remote` 不带 `--yes` 只打印批计划；`--dry` 同理。命令通道限制：单条 ≤4000 字节、语句不含 `" % & | < >`
  （本批单条最长 1106 字节，dry-run 已核）。

## 5. 回滚

```bash
node exec-shards.mjs rollback/01-rollback.sql --remote --yes
# 期望：删 570 行 registrations + 69 人 status 回 normal（changes 合计 639）
```

- 守卫：`DELETE` 限 `season=9 + 本批 20 队`；status 还原用**显式 69 id 清单**（不用 `contract_type` 反查——批后状态已变），
  且要求 `status='trainee'`（批后又被其他流程改过的行不覆盖）。
- **顺序**：回滚 status 之后再考虑把开关翻回 `false`。反过来（先关开关）会让 69 人从 `/api/squads` 摘掉、赛事仓整点删人；
  待 rollback 把 status 还原成 `normal` 后，下个整点同步再把他们带回（自愈，但有窗口）。
- `registrations` 无外键（`src/db/migrations/0001_init.sql:67-73`，仅 PK + `idx_registrations_player`），删除不受 FK 限制；
  `players.status` 变更会经 `/api/squads` 联动赛事仓（下个整点）。
- 公开缓存的 bump 同 §4 第⑧步（回滚后同样要 bump 一次）。

## 6. 已知后效（执行后必读）

- **回 enforce 前先收名单**：四键豁免**不含** `trainee_size` / `trainee_growth`——训练营人数须 ≤ `trainee_max`
  （特例期 8 恰覆盖佛罗伦萨 8），且每名训练营球员「可成长且 PA−CA>0」（生成时 69/69 满足，见 `report.md`）。
  期后把四键改回默认时红灯会回来：佛罗伦萨 8>7、利物浦 32>30、纽卡 19<20、皇马 growth 7>6。
  若批期用过 `registration_check_mode=warn|off` 放行，回 `enforce` 前同样先收名单，否则任何提交 422 `squad_invalid`。
- 特例期训练营球员**不记场次 XP**（`src/worker/results.ts` 四类事件对 trainee continue），成长只走赛季结算固定 XP
  （`trainee_season` 40 / 半程 15，锚 `trainee:${season}` 幂等）——已拍「先观察」。
- 开关保持 `true` 期间赛事仓看到的是一份 570 人名单（69 行带 `squad:'trainee'`）；赛事仓只取 `fcId/name/number`，
  未知字段忽略，加字段安全。

## 7. 工件

| 文件 | 说明 |
| --- | --- |
| `gen-registrations-sql.mjs` | 生成器（生产只读）。`node gen-registrations-sql.mjs` 生成；`--verify` 把生产现状与 manifest 逐行比对（漂移检测，只读）；`--local` 读本地 D1 |
| `exec-shards.mjs` | 执行器（自 `prod-20261005-s9-cpu-contracts` 复制，只加 `--remote` 需显式 `--yes` 的安全闸） |
| `sql/01-precheck.sql` | 只读预检（9 条：赛季、clubs、名册、训练营合同、注册现状、status 分布、config 段） |
| `sql/02-registrations.sql` | 写批①：DELETE 清底 + 20 条多行 INSERT OR IGNORE（570 行） |
| `sql/03-status-trainee.sql` | 写批②：1 条 UPDATE（69 人 → trainee） |
| `sql/04-verify.sql` | 只读验收（6 条：570/69/501、逐队拆分、status 分布、stray 0） |
| `sql/manifest.json` | 生成时点、赛季、逐文件 sha256、逐队拆分、69 个 trainee id、570 行逐行明细（clubId/playerId/fcId/name/squad/ct） |
| `rollback/01-rollback.sql` | 回滚：DELETE（season+20 队）+ UPDATE 69 人 status 回 normal |
| `report.md` | 逐队「一线队+训练营」拆分 vs 计划 §2.2c、训练营 69 人明细、工件哈希、执行命令 |

## 8. 生成与本地自检记录（2026-10-05）

- 生成：`node gen-registrations-sql.mjs`（生产只读）→ 570 行 / 训练营 69 / season=9；与计划 §2.2c 差异：**无**。
- 语义自检（node:sqlite 内存库，按 manifest 造 570 人 + 69 训练营合同夹具）：precheck → 写批连跑两遍（幂等，
  570/69/501 不变）→ verify 逐队对账 → 回滚连跑两遍（0 行 + 570 normal）→ 回滚后再写批，全部通过。
- 语法/通道自检：`node --check` 两脚本通过；`exec-shards.mjs` 对五个 SQL 文件 dry-run 全过
  （02 为 5 批、单条最长 1106 字节，无 shell 元字符）。
- 本批生成与自检**未对生产执行任何写语句**（全部为 `SELECT` 与本地内存库）。
