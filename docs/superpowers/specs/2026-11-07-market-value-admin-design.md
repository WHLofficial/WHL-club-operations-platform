# 身价初值与调价页设计（2026-11-07）

状态：grilling 完成（2026-11-07），待开工。
涉及仓库：`WHL-club-operations-platform`（本仓）+ `astrbot_plugin_whleague_advisor`（下称插件）。

## 0. 背景与目标

- 插件估价模型对全量球员有预计算参考价（插件本地 `player_scores.fair_mid`）；平台 `players.market_value`（身价）生产 18,301 行全 NULL，设计口径为「管理员赋值（无公式）」。
- 目标（用户裁决后收窄）：
  1. **模型只提供初值**——把模型参考价写入 `market_value`（仅填 NULL），并作为参考显示；
  2. **调价页参考显示**——管理端调身价时能看到模型参考价与最近成交；
  3. **管理端按阶梯增减**——±一档由页面实现，服务端不做强校验。
- 已裁决事项（grilling 2026-11-07）：
  1. 写入通道 = 插件出 SQL、用户 wrangler 执行（否决 bot HMAC 推送端点）；拒绝在插件注册管理员命令；
  2. 阶梯 30 以上按 5 分档；
  3. `modelValue` 随公开 `/api/players` 下发（不设 admin-only 端点）；
  4. 细则五条：snap 距离并列取低档；身价页默认 status=normal；手输 off-ladder 只前端提示不拦；「最近成交」只认 `status='completed'` 且 type ∈ {transfer, activation, forced_auction}（与插件「真实成交」口径一致）；种子 UPDATE 不动 `updated_at` 且注释行带模型版本；
  5. **种子覆盖 = 全部非退役球员按曲线价复算，trainee / free 不例外**（trainee 不用 5m 激活成本口径；曲线是成年球员成交拟合，对 trainee 是外推，用户知情选择）。

## 1. 范围

**做**：`players.model_value` 列；`GET /api/players` 带出 `modelValue` + opt-in `withLastDeal`；管理端「身价」页（±一档、暂存、批量提交走现有端点、最近成交列）；插件离线种子脚本（曲线价统一复算，不读 `player_scores`）。
**不做**：服务端阶梯校验；bot 工具展示身价；fair 计算任何改动；「保护手动值」机制；bot HMAC 推送端点；插件命令注册。

## 2. 身价阶梯（规则定稿）

档表（升序）：

| 区间 | 档 |
|---|---|
| ≤10 | 整数 1–10（步长 1） |
| 10 < v ≤ 30 | 12, 13, 15, 17, 18, 20, 22, 23, 25, 27, 28, 30 |
| v > 30 | 5 的倍数 ≥ 35：35, 40, 45, 50, …（无限延伸） |

纯函数语义（两端实现必须一致）：

- `snap(x)`：与 x 距离最小的档；**距离并列取低档**；x ≤ 0 → 1。
- `next(x)` / `prev(x)`：档表中最小的大于 x / 最大的小于 x 的档（x 不在档上时同样良定义）。

对拍样例（两端测试共用同一组断言）：

```
snap(0.4)=1   snap(5)=5     snap(10)=10   snap(10.5)=10
snap(11)=10   snap(11.4)=12 snap(14)=13   snap(31)=30
snap(32)=30   snap(32.5)=30 snap(33)=35   snap(52)=50
next(9)=10    next(10)=12   next(28)=30   next(30)=35   next(35)=40
prev(12)=10   prev(30)=28   prev(35)=30
```

## 3. 平台改动

### 3.1 迁移 `0095_player_model_value.sql`

```sql
-- 模型参考价：bot 离线脚本生成的 SQL 写入（全量覆盖），管理端只读展示；不是规则输入
ALTER TABLE players ADD COLUMN model_value REAL;
-- 身价页最近成交相关子查询用
CREATE INDEX IF NOT EXISTS idx_transfers_player ON transfers(player_id, id);
```

（迁移编号以实施时 `src/db/migrations/` 实际最大号顺延。）

### 3.2 `GET /api/players`（routes/players.ts）

- select（~:721）加 `players.model_value`，行映射（~:891）加 `modelValue: r.model_value`。公开带出模型参考价——bot 在群里本就公开报估价，无新增泄露。
- opt-in `withLastDeal=1`：select 追加一条相关子查询
  `(SELECT json_object('fee',t.fee,'season',t.season,'windowSeq',t.window_seq) FROM transfers t WHERE t.player_id = players.id ORDER BY t.id DESC LIMIT 1) AS last_deal`，
  行映射 `lastDeal: 解析或 null`。成交口径与 `/api/market/deals` 对齐（实施时核对该路由的 WHERE，若有状态过滤则同款）。不带参数时 SQL 与 payload 完全不变。

### 3.3 管理端「身价」页 `/admin/values`

- `web/src/pages/admin/ValuesPage.tsx` 新页；`App.tsx` 路由 + AdminLayout 导航加「身价」。
- 筛选：球队下拉（`GET /api/clubs`）+ 状态（默认 normal，可选全部/trainee/free）；列表 `GET /api/players?club_id=&status=&withLastDeal=1&limit=100`，游标「加载更多」。
- 行：球员 / 位置·年龄·CA / 现身价（marketValue）/ 模型参考（modelValue）/ 最近成交（`xx.x m · S9 窗2`，无成交 —）/ `[−一档] [+] [还原]`。
- 阶梯实现：`web/src/lib/valueLadder.ts`（snap/next/prev 纯函数）+ vitest 对拍样例。
- 交互：±一档写入暂存 `pendingEdits`（行内高亮新值，可手输绝对值——off-ladder 只前端红字提示不拦截）；底部「提交 N 条变更」按 ≤200/批切分调 `POST /api/admin/players/batch`（body `{items:[{id, marketValue}]}`，原子、审计 `player_batch`），成功后失效 query 缓存重拉。

## 4. 插件改动（运行时零改动、零网络、零命令注册）

### 4.1 `services/market_value.py`（纯函数，pytest 可测，不依赖 AstrBot）

- `snap_to_ladder(x)` + 常量（§2 同规则、同对拍样例）。
- `load_curve_model(conn)`：从 `model_params` 装载已发布曲线参数与角色统计（与 `scores.py` 同款装载口径；缺失抛 `ModelUnavailable`）。
- `collect_rows(conn)`：`players` 全表条件 `status != 'retired'`，逐人复算曲线价：`ability_level` → `role_group` → `comp_mid` / `gk_outfield_mid`（GK）→ `fair_spread` 门禁（角色统计不足跳过该人）→ `age_adjustments` + `apply_adjustments`。**trainee / free / normal / listed 一视同仁，全部按曲线价**（2026-11-07 裁决）；复算不出（无参数 / 无角色统计 / level 缺失）的跳过。
- `generate_seed_sql(rows, generated_at, model_version)`：

```sql
-- whl model-value seed | 2026-11-07T12:00:00 | model=<version> | rows=<n>
UPDATE players SET model_value = 12, market_value = COALESCE(market_value, 12) WHERE id = 12345;
```

一行一条 UPDATE；返回 (sql_text, summary)。

### 4.2 `scripts/generate_value_seed.py`（薄 CLI，仅 stdlib + 本仓 services）

- 用法：`python scripts/generate_value_seed.py <advisor.db路径> [-o market_values_seed.sql]`；脚本头 `sys.path` 指向仓根，只 import `services.market_value`（实施时确认 `services/__init__.py` 无 AstrBot 依赖）。
- 输出摘要：行数、跳过数（复算不出）、档位分布 top、与本地同步 market_value 的差异数；打印现成命令行：
  `cd C:\Users\bhdjb\whlProgram\WHL-club-operations-platform && npx wrangler d1 execute whl-club --remote --file=<绝对路径>`。

## 5. 操作流程

1. 平台仓改动 commit → **push 即生产部署**（Workers Builds）；部署后需对 D1 跑迁移（`npm run db:migrate:remote`）。
2. 插件仓跑 `scripts/generate_value_seed.py` → 得 SQL 文件 + 摘要。
3. 手动执行 wrangler 命令 → `model_value` 全量写入、`market_value` 只填 NULL。
4. 管理端「身价」页日常 ± 调价。
5. 模型重拟合后：重跑 2–3（`model_value` 刷新、`market_value` 不动）。

## 6. 边界与已知代价

- **挂牌下限激活**：`market_value` 一旦非 NULL，挂牌下限变为 `min(0.5RC, 0.5×身价)`（`market-rules.ts:24`，平台既有规则），球队总值、身价筛选同步生效。执行种子 = 接受该规则上线。
- 公开端缓存：种子后 `modelValue`/`marketValue` 在公开列表 ≤1h 延迟可见（SQL 直写不走写路径清缓存）；之后的 ± 调价走 batch 端点，正常清缓存。
- SQL 直写**无审计**（后续 ± 调价有 `player_batch` 审计）；种子文件自带注释行作为记录。
- 阶梯规则存在两份实现（前端 TS / 插件 Python），靠同一组对拍样例锁定。
- 初值 snap 后的档位与模型原值最多差半档宽；曲线价复算不出的球员不入种子（原 rc_fallback 语义 = 模型给不出市场价）。
- **trainee 身价与激活成本并存**：trainee 按曲线价录入后，身价可能显著高于 5m 激活成本；激活通道本身仍收 5m（平台规则不变），身价只作参照与挂牌下限输入。

## 7. 测试

- 平台：vitest——`valueLadder` 对拍样例全表；`/api/players` 带 `modelValue`、`withLastDeal` 有无参数两形态（跟随仓内路由测试惯例）；构建通过。
- 插件：pytest——`TestSnapToLadder`（对拍样例）、`TestCurveMid`（trainee/free/normal 同一曲线口径、GK 分支、角色统计缺失跳过）、`TestCollectRows`（retired 排除、model_params 缺失报 `ModelUnavailable`）、`TestGenerateSeedSql`（COALESCE 语义、注释行含模型版本、id 对应）；全量 pytest 绿 + code-review-skill。

## 8. 版本与提交切分

- 平台 v6.79.0：commit 1 = 迁移 + `/api/players` 字段；commit 2 = 身价页。CHANGELOG `[6.79.0]`。
- 插件：版本号不动（运行时零改动），commit = `services/market_value.py` + `scripts/generate_value_seed.py` + tests；CHANGELOG 不加条目。
- push：两仓均等用户明确指令（平台 push 即部署，见 §5）。
