# 实施计划 · v6.53.0 球场档期 P0（容量驱动收入 + 设施门槛 + 场馆经营页）

> 依据：`memory/design-venue-slots-explore.md`（2026-10-20 答复记录 / §6.9 分期 / §7.1 数值 / §7.6 Plan A / §8.1 代码硬约束 / §9 Q12 清单）。
> 本文件只写「改哪里、改成什么、怎么验」；不写实现代码。执行者不需要参与过访谈。
> HARD GATE：本文件落盘不改任何业务代码、不改迁移、不提交。`npm run deploy` / 任何 `--remote` 写操作 / 生产迁移 apply 一律等用户下令（AGENTS.md 危险清单）。
> 修订：2026-10-20 复核后 v2。24 条复核意见逐条处置见文末「复核处置」；§0–§12 结构保持不变。

---

## 0. 四块工作流的冲突裁决（先读这一节）

四份工作流在迁移号、文件名、枚举取值、通知模板 key、API 形状上互相不一致。下面每条都是**已裁决**，照做即可，不要再改回。

| # | 冲突点 | 四份工作流的说法 | 裁决 | 理由 |
|---|---|---|---|---|
| A1 | 迁移号 | 设计文档 `memory/design-venue-slots-explore.md:734/740/745/810/887/948` 原写 0077，已订正为 0078（2026-10-20 修订）；四个工作流都自行改成 0078 | **用 0078** | 0077 已被 v6.52.0 的 `0077_growth_nongrowable_reset.sql` 占用并已 apply 生产（`AGENTS.md:120` 上线记录）。`src/db/migrations/` 现有 77 枚，字典序最末即该文件，无 0078 |
| A2 | 迁移文件名 | `0078_venue_slots_p0.sql` / `0078_venue_capacity_economy.sql` / `0078_venue_operations.sql` | **`0078_venue_slots_p0.sql`** | 本轮范围就是「档期 P0」九项，名字与里程碑一致；四份工作流的 DDL 全部合并进这一枚（P0 只发一次迁移，省一次生产 apply 窗口） |
| A3 | 唯一索引名 | `idx_season_windows_open` / `_single_open` / `_one_open` | **`idx_season_windows_open`** | 与仓内既有命名（`idx_` + 表 + 语义）一致；名字只影响回滚脚本与回读断言，越短越好 |
| A4 | `venue_policy` 枚举 | `money/fans/reputation`（data、ui） vs `money/popularity/reputation`（effects） | **`'' \| 'money' \| 'fans' \| 'reputation'`** | 前端三张卡是「多赚钱 / 攒人气 / 树口碑」，`fans` 直连 `stadiums.fans` 语义；`popularity` 在本仓无对应列，空串 = 未选（默认只预览） |
| A5 | 单槽成本是否与草皮损坏重复计费 | econ：`opsCost=0.8+0.00002×cap` 且损坏另计（净额掉到 3.225）；effects：拆成 `cost_fixed 0.275` + 每座，使 L0 期望合计 = 0.8 | **采用拆分**：`cost_base=0.275` + `cost_per_seat` + 草皮损坏独立掷（期望 0.525） | §7.1 的 `0.8 + 0.00002×容量` **本就含期望草皮修复**（5.25−1.5=3.75）。拆开后期望净额仍是 §7.1 的 3.75/2.06/1.41/0.76，且保留了损坏的随机性；若按 econ 写法会与设计数字差 −14% |
| A6 | 上座乘数是否附带死忠增量 | effects：open_day +4 / youth +2（新增 `fans_delta`） | **P0 不新增活动直给死忠**；「攒人气」先比 `fans_delta`（P0 默认全 0，P1 预留）再比下 5 场上座乘数 | 设计 P0 ④ 的「关窗死忠演化」已由 `home.ts:641` 的 `evolveFans` 承接，不是活动直给；`venue-ops.ts:8` 登记不做 `fans_pct`；Q12 效果载体只列 `next_attendance_mod`。A6 旧理由「Q12 九项未含死忠」错误：P0 ④ 明确含关窗演化。`fans_delta` 只进 schema 与推荐口径，P0 默认 0，不改成长曲线 |
| A7 | 声望/乘数幂等载体 | econ/effects 都提 `venue_reputation_log` | **一张表 `venue_window_settlements`**，同时盖住声望 + 上座乘数 | 两个副作用都要「只生效一次」；一张表一次 `INSERT OR IGNORE` + 一条 `changes() > 0` 的 UPDATE 即可（同 `src/worker/ledger.ts:58-59` 既有写法），比两张表少一半语句 |
| A8 | `ops_schedule` 是否改锚 / 加新 op_key | 设计 §九⑥ 要 `consumption` 置 `window_open/window_close`；effects 反对（会把扩建/设施/冠名一起关进窗内）；ui 把它列为前置依赖 | **改锚**：0078 第 ⑨ 条把 `consumption` 两端锚到 `window_open`/`window_close`（仅当前双 none 时） | `requires_window=1` 只是登记字段：`ops-schedule.ts:91` 双 none 直接放行，`resolveOpsRow` 判 `unrestricted`，`assertOpOpen` 只看锚点；不置锚 P0 ⑥ 与验收②不可能成立。副作用：`market-ops.ts:619`、`naming-ops.ts:992/1055`、`venue-ops.ts:241` 的消费中心操作也进窗——这是设计 §九⑥ 的明确要求；运营若要窗内暂停档期，P1 再开 `venue_booking` op_key。 |
| A9 | 关窗时刻从哪来 | effects/UI 都想加 `season_windows.planned_close_at` 并改管理端开窗接口 | **不加 `planned_close_at`**；`closesAt = opened_at + config window_length_hours`（默认 168h），另加 `venue_reminder_at` 仅作去重 | 用户锁定口径是「2 常规窗 × 7 天，7 天是运营参考值」。加 `planned_close_at` 要动开窗接口 body、管理端表单、`routes/admin/market.ts` 透传，收益只是「每窗可订不同长度」，P0 不值 |
| A10 | 通知模板 key 与类目 | `venue_close_reminder`（ui） vs `venue_slot_reminder`（effects/econ） | **`venue_window_open` + `venue_slot_reminder`**，都归 `category='window'` | 不新增第 9 个类目：`src/core/notify-meta.test.ts:51` 锁 `NOTIFY_CATEGORIES` = 8。深链不能靠 `case 'window'`（那样 `window_signals`/`sea_*` 会被一起带去 /venue），必须在 `web/src/lib/notify-links.ts` 里加模板显式判断 |
| A11 | API 形状 | data/econ/effects 扩 `GET/POST /api/club/bookings`；ui 要 `GET/PUT /api/club/venue-plan` | **`GET/PUT /api/club/venue-plan` + `POST /api/club/venue-plan/preview`（只读、不落库）；同版删除 `GET/POST /api/club/bookings`** | 预览必须按草稿算同类序位；GET 的逐槽 options 只表示「该槽若排同类下一个」，不能加总（4 演唱逐槽相加 15.00，实际 7.65）。响应形状不兼容；两套端点两份公式必然漂移。SPA 与 Worker 同版发布；调用方是待删的 `BookingsCard` 与 `tests/venue-ops.test.ts:292-348` 那段旧路由测试，两者同轮改写 |
| A12 | 错误码 | ui 要 `NO_WINDOW`/`FACILITY_REQUIRED` 等码 | **只用 HTTP 状态码 + 中文 message**，前端原样展示 | 仓内 `HttpError`（`src/lib/http.ts`）现有契约就是 `{error: message}`；不引错误码枚举，少一层前端映射 |
| A13 | 前端落点 | econ/effects 扩消费中心卡片；ui 新建 `/venue` 页并迁出 | **独立 `/venue` 页 + 首页卡 + 主场页入口，消费中心删 `BookingsCard`** | 用户锁定 Q8-1 = 独立「场馆经营」页。`web/src/pages/Home.tsx:55-82` 是 `.nav-card` 栅格（教练 6 张、管理员多 1 张；文件共 94 行，**没有** `:110-111` 注释）；「顶栏 8 项在 360px 已满」是 Q8-1 的设计约束，不是代码注释。新增卡走首页 `.nav-card` 栅格 |
| A14 | `activity_slots` 语义 | econ：改成「每窗上限，默认 4」；effects：不动 | **改成「每窗档位上限」，默认 `'4'`，`0` = 关闭档期预订** | cap 若留 `'2'`（`src/core/config.ts:216`），容量派生的 3/4 槽会被立刻压回 2，Plan A 对 18 队里 15 队失效。保留该键同时保住 `tests/event-ops.test.ts:806-807` 用 `activity_slots=1` 造「档位已满」的手段 |

---

## 1. 背景与已锁定决策（照抄 LOCKED，不改写）

1. **档期窗 = 转会窗**：不新增窗口体系；开/关窗仍由管理端手工触发；档期记录挂在 `ops_schedule`（`consumption` 行 `requires_window=1`）；不做 `window_plan`、不做自动开窗（Q7b=D）。
2. **槽位按容量**：容量 <15000 → 2 槽；15000–29999 → 3 槽；≥30000 → 4 槽；槽长 = 窗长/槽数（Plan A）。
3. **收入按容量驱动**：单槽毛收入 = 容量 × 票价 × 座位利用率；同窗饱和系数 1 / 0.7 / 0.45 / 0.45 逐档作用在毛收入上；维护费按槽计。
4. **五类活动**：演唱会、电竞、企业日、青训营、开放日；青训 0.7、开放日 ≤0.2 为基准乘数；企业日现金 0.9/档、上座 ×1.00；具体数值以设计文档 §7.1 为准。
5. **设施门槛**：电竞需转播 L2、青训营需青训 L1、企业日需商业 L1；`facility_prices` 默认 `0.1,3,5,8,12,16`（L1=3、L2 累计 8）。
6. **场馆声望 0–100** 存 `stadiums.venue_reputation`：≥20 才可排企业日；企业日收入 ×(0.5+声望/100)；加点 企业日+3、演唱/电竞+2、青训/开放日+1（按上座率缩放）；赛季末 ×0.9。
7. **效果载体**：上座乘数统一作用「下 5 场」主场（K=5 固定，因为库里没有 fixtures 表）；乘性叠加、钳 [0.5,2.0]；每场消费后 −1、归 0 清；新季首窗前清零未消费部分（Q12）。
8. **玩家方针**（Q8-2）：档期页三张卡「多赚钱 / 攒人气 / 树口碑」，默认不选只预览；选中后出一键推荐、可改单；按队记住（`clubs.venue_policy TEXT`）。
9. **城市**（Q10c）：加 `clubs.city TEXT`（可空）；P0 不做分流。演出池（Q10a/Q10b）、保险（Q11）都不在 P0。
10. **本期只做 P0 清单 9 项**；P1 = O6 + 声望阶梯；P2 = 保险/演出池/暗标/城市分流/伤停。

P0 九项（设计 §九 Q12）在本计划的落点：

| # | 清单项 | 落点 |
|---|---|---|
| ① | 档位按容量派生 | `src/core/venue.ts` `slotsForCapacity`（§4.1） |
| ② | 容量驱动收入 − 成本栈 + 饱和 | `src/core/venue.ts` `venueQuote` + `src/worker/venue-ops.ts` 重写（§4.2） |
| ③ | 5 类活动 + 设施门槛 | `activity_config` 新默认（§3）+ `activityUnlockReason`（§4.1） |
| ④ | 后果落点 | 关窗批内 `venue_window_settlements` + 账本科目 + 既有 `evolveFans` 关窗演化（`src/worker/home.ts:641`）（§4.2、§4.3） |
| ⑤ | 入口与两条提醒 | `/venue` 页 + 开窗站内信 + 关窗前 tick（§5、§6） |
| ⑥ | 窗口节奏 + 开关 | 0078 第 ⑨ 条把 `ops_schedule.consumption` 锚到 `window_open`/`window_close`；`bookSlot` 保留 `isWindowOpen` + `assertOpOpen`（§2.2、§4.2） |
| ⑦ | 并发开窗唯一索引 | 迁移 0078 第 1 条（§2） |
| ⑧ | 失败开窗不先重掷 | 经纪人重掷并入 `openBatch`，失败整批回滚（§4.4） |
| ⑨ | P0 验收 6 条 | §7.4 |

---

## 2. 迁移 0078

### 2.1 文件与登记

- 新建 `src/db/migrations/0078_venue_slots_p0.sql`。
- `tests/d1.ts:161`（`'0077_growth_nongrowable_reset.sql',` 之后）追加 `'0078_venue_slots_p0.sql',`。**必须追加**：`tests/weather-forecast.test.ts` 的 TC-MIG-03 取 `src/db/migrations` 里按名排序的最新一枚 `.sql`，断言它正是 `tests/d1.ts` 源码里最后登记的那个。
- 文件头按仓规写：用途、列语义、逐条回滚语句。**文件内不写 `BEGIN/COMMIT`**（迁移执行器自行包事务，见 `0069_ops_schedule_expiry.sql:2`）。

### 2.2 完整 DDL（顺序即文件顺序，不要重排）

```sql
-- ① 同时刻 ≤1 个 open 窗（P0 第 ⑦ 项）。放第 1 条：本文件唯一可能失败的 DDL
--    现状 DB 只有 UNIQUE(season, window_seq)（0001_init.sql:172-182），
--    应用层 COUNT 检查（window-machine.ts:82-85）与 INSERT（:170）不同批 ⇒ 并发拦不住。
CREATE UNIQUE INDEX IF NOT EXISTS idx_season_windows_open
  ON season_windows(status) WHERE status = 'open';

-- ② 关窗提醒去重标记（§6.2）。'' = 未提醒过
ALTER TABLE season_windows ADD COLUMN venue_reminder_at TEXT NOT NULL DEFAULT '';

-- ③ 场馆声望 0–100（锁定决策 6）。REAL 而非 INTEGER：加点 ×上座率、赛季末 ×0.9 都会出小数
ALTER TABLE stadiums ADD COLUMN venue_reputation REAL NOT NULL DEFAULT 0
  CHECK (venue_reputation >= 0 AND venue_reputation <= 100);

-- ④ 多场上座乘数载体（锁定决策 7，K 固定 5）：剩余主场场数，0 = 无待消费
--    不写 BETWEEN 0 AND 5：K 是代码常量，锁进 CHECK 后改 K 要重建表
ALTER TABLE stadiums ADD COLUMN attendance_mod_matches INTEGER NOT NULL DEFAULT 0
  CHECK (attendance_mod_matches >= 0);

-- ⑤ 存量回填：设计 Q12「随机事件预置仍一场即清（不置 K）」⇒ 存量 next_attendance_mod<>1 保持 K=0。
--    列默认就是 0，这条只把「将来若有人手工置过 K」拉回 0；正常迁移写 0 行。
UPDATE stadiums SET attendance_mod_matches = 0
 WHERE next_attendance_mod <> 1 AND attendance_mod_matches <> 0;

-- ⑥ 玩家方针（锁定决策 8）：空串 = 未选，默认只出预览、不落任何效果
ALTER TABLE clubs ADD COLUMN venue_policy TEXT NOT NULL DEFAULT ''
  CHECK (venue_policy IN ('', 'money', 'fans', 'reputation'));

-- ⑦ 城市（锁定决策 9）：可空；NULL 与 '' 都表示未填。与 0068 的 clubs.country 同风格
ALTER TABLE clubs ADD COLUMN city TEXT;

-- ⑧ 窗末副作用幂等台账（A7）：一队一窗一行，唯一插入成功才允许写声望/上座乘数
CREATE TABLE IF NOT EXISTS venue_window_settlements (
  club_id         INTEGER NOT NULL,
  season          INTEGER NOT NULL,
  window_seq      INTEGER NOT NULL,
  reputation_gain REAL NOT NULL DEFAULT 0,
  attend_mod      REAL NOT NULL DEFAULT 1,
  bookings        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (club_id, season, window_seq)
);

-- ⑨ 消费中心的窗口闸（P0 第 ⑥ 项）：requires_window=1 单独不产生闸门，
--    必须把两端锚到窗口开关；只改「当前双 none」的行，不覆盖运营手工配置。
UPDATE ops_schedule
   SET start_anchor = 'window_open',
       start_at = NULL,
       end_anchor = 'window_close',
       end_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE op_key = 'consumption'
   AND start_anchor = 'none'
   AND end_anchor = 'none';
```

**回滚（写在文件头注释里）**：
```sql
-- 仅当 0078 第 ⑨ 条确实改过（原双 none）时执行；原非 none 的锚点不要跑这条
UPDATE ops_schedule
   SET start_anchor = 'none', start_at = NULL,
       end_anchor = 'none', end_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE op_key = 'consumption';
DROP TABLE IF EXISTS venue_window_settlements;
ALTER TABLE clubs DROP COLUMN city;
ALTER TABLE clubs DROP COLUMN venue_policy;
ALTER TABLE stadiums DROP COLUMN attendance_mod_matches;
ALTER TABLE stadiums DROP COLUMN venue_reputation;
ALTER TABLE season_windows DROP COLUMN venue_reminder_at;
DROP INDEX IF EXISTS idx_season_windows_open;
-- 回填的逆操作：UPDATE stadiums SET attendance_mod_matches = 0;
```

### 2.3 为什么这个顺序、为什么能重跑

- 把唯一可能失败的 `CREATE UNIQUE INDEX` 放第 1 条：生产若已有两个 `status='open'` 行，迁移在第一条就炸，**一列都没加**，重跑落在同一位置同一错误，不会出现「列加了、账本没记」的半状态。数据工作流已在 node:sqlite 3.50.4 上实测该失败路径（两 open 行 → `UNIQUE constraint failed: season_windows.status`，`pragma_table_info('stadiums')` 里 `venue_reputation` 仍为 0）。
- `ALTER TABLE ADD COLUMN` 天然不可重跑（实测重跑报 `duplicate column name`），幂等守卫是 `d1_migrations` 账本；索引与表用 `IF NOT EXISTS`。
- 四列都满足 SQLite 的 ADD COLUMN 限制：`NOT NULL` 带常量默认值、无 `PRIMARY KEY`/`UNIQUE`、无非常量默认值。`ALTER + CHECK` 同句有生产先例 `0054_brand_tiers.sql:9`。
- 第 ⑨ 条是 `UPDATE`，重跑命中 0 行；`WHERE start_anchor='none' AND end_anchor='none'` 保证不覆盖运营已手工改过的锚。若 0069 的 `consumption` 行不存在，先由 §2.4 预检发现，不靠 0078 兜底（`INSERT OR IGNORE` 会掩盖缺行）。
- **`venue_bookings` 不需要新索引**：`0046_venue_bookings.sql:15` 已有 `UNIQUE (club_id, season, window_seq, slot_no)`，同队同窗重复占槽由它拦（`bookSlot` 的 upsert 目标列写死在这个组合上，`src/worker/venue-ops.ts:249-259`，不得改）。`slot_no` 的上界只能应用层校验（容量派生、非静态，且给既有表加 CHECK 要重建表）；容量只增不减（唯一写路径 `src/worker/stadium-ops.ts:136` 是 `capacity = capacity + ?`）⇒ 已存在的 `slot_no` 永远不会超出新派生的槽数。
- `show_pool_id` + 演出池部分唯一索引**不进 0078**（P0 无演出池，空列空索引在 P0/P1 期间无人读，P2 单开 `0079`）。

### 2.4 生产 apply 前后的只读检查（写操作须用户下令）

```sql
-- apply 前（必须 ≤1，否则第 1 条索引失败）
SELECT COUNT(*) AS open_cnt FROM season_windows WHERE status = 'open';
-- apply 前：登记存量 one-shot 数量（回填预期写 0 行），并与 next_attendance_mod 的实际分布对照
SELECT COUNT(*) AS pending FROM stadiums WHERE next_attendance_mod <> 1;
-- apply 前：确认这两个配置键有没有被运营显式改过（见 §9 R2/R7，决定是否要人工改配置）
SELECT key, value FROM config WHERE key IN ('activity_slots', 'activity_config');
-- apply 前：consumption 行必须存在且为双 none（否则第 ⑨ 条不会改它）
SELECT op_key, start_anchor, end_anchor, requires_window
  FROM ops_schedule WHERE op_key = 'consumption';
-- apply 后回读（应依次为 2 / 2 / 1 / 0 / window_open+window_close / 0078_venue_slots_p0.sql）
SELECT COUNT(*) FROM pragma_table_info('stadiums') WHERE name IN ('venue_reputation','attendance_mod_matches');
SELECT COUNT(*) FROM pragma_table_info('clubs')    WHERE name IN ('venue_policy','city');
SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_season_windows_open';
SELECT COUNT(*) FROM stadiums WHERE venue_reputation < 0 OR venue_reputation > 100;
SELECT start_anchor, end_anchor FROM ops_schedule WHERE op_key = 'consumption';
SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1;
```

---

## 3. 配置与数据

### 3.1 `activity_config` 新默认（`src/core/config.ts:217-223` 整段替换）

键名 snake_case；`parseDef`（`src/worker/venue-ops.ts:40-63`）的白名单必须同步扩到这些键，否则会被静默丢弃。

```json
{
  "concert":   { "name": "演唱会", "pricing": "capacity", "price_per_seat": 0.00015, "fill_rate": 1.0,
                 "cost_base": 0.275, "cost_per_seat": 0.00002,
                 "attend_mod": 0.95, "reputation_gain": 2,
                 "pitch_boost_per_level": 0.1, "pitch_damage_prob": 0.15, "damage_min": 2.0, "damage_max": 5.0 },
  "esports":   { "name": "电竞赛事", "pricing": "capacity", "price_per_seat": 0.00008, "fill_rate": 1.0,
                 "cost_base": 0.3, "cost_per_seat": 0.00001, "broadcast_boost_per_level": 0,
                 "attend_mod": 1.0, "reputation_gain": 2,
                 "requires_facility": "broadcast", "requires_level": 2 },
  "youth_camp":{ "name": "青训夏令营", "pricing": "flat", "income": 0.7,
                 "attend_mod": 1.007, "reputation_gain": 1, "youth_boost_per_level": 0.1,
                 "requires_facility": "youth", "requires_level": 1 },
  "open_day":  { "name": "球迷开放日", "pricing": "flat", "income": 0.2,
                 "attend_mod": 1.005, "reputation_gain": 1 },
  "corporate": { "name": "企业日", "pricing": "flat", "income": 0.9,
                 "attend_mod": 1.0, "reputation_gain": 3, "income_rep_base": 0.5,
                 "requires_facility": "commercial", "requires_level": 1, "requires_reputation": 20 },
  "idle":      { "name": "空置", "pricing": "flat", "income": 0, "attend_mod": 1, "reputation_gain": 0 }
}
```

- **`blurb`（前端活动卡副标题）**：默认 JSON 每个活动再加一条 `blurb`（一句中文，如演唱会「单场现金最高，草皮损耗也最高」），`parseDef` 白名单加 `blurb`，`VenueActivityDef.blurb: string`（缺省 `''`）；`GET /venue-plan` 的 `activities[].blurb` 只从 config 读，不在路由里硬编码，`validateActivityConfig` 只校验是字符串、长度 ≤40。
- **旧键兼容（保留旧经济，不静默改数）**：
  - `income_min` / `income_max` 同时存在 → `pricing:'legacy_range'`，保留 `incomeMin`/`incomeMax`；`income = round3((min+max)/2)` 只用于展示与缺省兜底，**不再把区间压成 flat**。
  - 只有 `income` → `pricing:'flat'`。
  - `youth_level_factor` → `youthBoostPerLevel`；`pitch_damage_prob` / `damage_min` / `damage_max` 原样保留。
  - `venueQuote` 的 `legacy_range` 分支**逐字复刻现有 `activityIncome` 的乘序**：`gross = (incomeMin + rolls.income × (incomeMax − incomeMin)) × 设施乘数 × (1 + attendBuff) × satMult`；其中 `concert` 设施乘数 = `1 + (pitch_boost_per_level ?? 0.1) × pitch`，`youth_camp` = `1 + youthBoostPerLevel × youth`，其余 = 1；round3。**`costBase/costPerSeat` 缺省 0**：旧 `activityIncome` 只有草皮损坏、没有运营成本，别把新默认 `0.275/0.00002` 套到旧键上。
  - `loadActivityCatalog` 返回 `legacyKeys: string[]`；`GET /venue-plan` 的 `configWarning` 非空，管理端 config 页显示「仍是旧 activity_config，Plan A 未生效」。
  - 目的：生产若已显式改过 `activity_config`，新代码不会把它读成空目录，也不会把旧区间悄悄换成新经济；运营必须显式替换成新 JSON 才切到 Plan A（§9 R2）。旧配置只保留**金额区间与掷点**；饱和、设施门槛、声望加成仍按 P0 生效（这是新玩法，不是旧经济的一部分），`configWarning` 要把这句话带给运营。
- **`fans_delta`**：`parseDef` 读取，缺省 0；默认 JSON 不写（P0 全 0）。它只进 `recommendPlan` 的「攒人气」排序，不参与 `venueQuote` 金额；P1 要加活动直给死忠时再用。
- 新键 `income_rep_base`（企业日的 `0.5 + 声望/100` 基线）与 `requires_reputation` 必须进白名单；`requires_facility` 只允许 `broadcast|youth|commercial`。
- 电竞 `broadcast_boost_per_level` 设计稿只写「加成」未给系数，P0 取 **0**（否则转播 L2 解锁时 gross ×1.2，与 §7.1 的 `2.15` 对不上）；留键是为了 P1 调参，不改公式。

### 3.2 `activity_slots` 与 `window_length_hours`

| 键 | 现在 | 改成 | 说明 |
|---|---|---|---|
| `activity_slots` | `'2'`（`src/core/config.ts:216`） | `'4'` | 语义改为**每窗档位上限**（0 = 关闭档期预订）；实际槽数由容量派生后再被它钳制（`min(派生, 上限, 20)`） |
| `window_length_hours` | 不存在 | `'168'` | 新增：`CONFIG_KEYS`（`src/core/config.ts:76-77` 旁）与 `CONFIG_DEFAULTS`（`:106`）都要加；只进白名单没有默认值时 `getNumber` 返回 null（`fetchRaw` 走 `?? null`），`closeAtMs` 退化成 `openedAt`、提醒永不触发。仅用于「预计关窗时刻 = opened_at + N 小时」与关窗提醒阈值 |
| `facility_prices` | `'0.1,3,5,8,12,16'`（`src/core/config.ts:185`） | **不动** | L1 = 3M、L2 累计 3+5 = 8M，与锁定决策 5 一致，无需改 |

### 3.3 口径自检（手算复核，未跑代码）

按上表公式复算设计 §7.1 / §7.6 的数字，四组全部吻合：

| 容量 | 演唱会 期望净额 | 电竞 期望净额 | 青训 | 开放日 |
|---|---|---|---|---|
| 35000 | 5.25 − 0.975 − 0.525 = **3.75** | 2.8 − 0.65 = **2.15** | 0.7 | 0.2 |
| 22000 | 3.3 − 0.715 − 0.525 = **2.06** | 1.76 − 0.52 = **1.24** | 0.7 | 0.2 |
| 17000 | 2.55 − 0.615 − 0.525 = **1.41** | 1.36 − 0.47 = **0.89** | 0.7 | 0.2 |
| 12000 | 1.8 − 0.515 − 0.525 = **0.76** | 0.96 − 0.42 = **0.54** | 0.7 | 0.2 |

企业日：`0.9 × (0.5 + rep/100)` ⇒ rep=20 → **0.63**、rep=100 → **1.35**。

饱和**必须按「同类活动在本窗的序位」**（不是 `slot_no`）。反向验证：35000 排 2 演唱 + 2 电竞，按同类序位 = `5.25×1.7 + 2.8×1.7 = 13.685`，减成本 `(0.975+0.65)×2 = 3.25`、减损坏 `0.525×2 = 1.05` ⇒ **9.385 ≈ 设计 §7.6 的 9.39**；若按 `slot_no` 序位（4 号位是电竞、0.45）只有 7.14，对不上。同理 35000 排 4 演唱 = `5.25×2.6 − 3.9 − 2.1 = 7.65`（无饱和口径 = 15.00），也吻合。

联盟级（生产容量分布 12000×10 / 17000×1 / 22000×3 / 35000×4 ⇒ 槽数 10×2+1×3+3×3+4×4 = **48 槽/窗**，与设计一致）：全部排演唱会 = 30.6 + 10.125 + 2.0625 + 9.8 = **≈52.59**，与设计 §7.6「有饱和 52.59」逐位吻合。这是**单窗**数字，用来锁饱和公式，不是 C2 基线。

**C2 模型基线（与静态公式分开）**：本轮只读复跑 `node scripts/venue/cadence-model.mjs --esports=off`，O1 的 `incomeLeague=54.62`/窗；两常规窗合计 **109.24m/季**（设计 §8.7：116.02 已退役，109.24 生效）。按档 `incomePerClubAvg`：35000 6.62/窗 → **13.24/季**；22000 3.51 → **7.02**；17000 2.645 → **5.29**；12000 1.50 → **2.99**。模型含 0.85 预订率等假设，不能由 §3.1 静态公式直接复现；§7.2 的 3.75/2.06/... 锁公式，§7.4 的 109.24 锁经济，两者不要混用。**模型不施加设施门槛**（`--esports=off` 已排除电竞；35000 的「3 演唱 + 1 青训」是模型组合，若该队青训 L0 实际只能排开放日，金额低于 13.24，不据此判失败）；设施门槛由 §7.4 第 6 条单独验收。

---

## 4. 服务端

### 4.1 新建 `src/core/venue.ts`（纯逻辑，零 import）

放这里的理由：AGENTS.md 要求纯逻辑进 `src/core/`；它是单测、worker 结算、路由三处唯一共享的公式源；零 import 因此不需要进 `tests/core-zero-import.test.ts:15` 的 `PURE_DATA_MODULES`（该列表只强制那三个文件）。

```ts
export const SLOT_HARD_MAX = 20;
export const SATURATION_MULTS = [1, 0.7, 0.45, 0.45] as const;
export const ATTENDANCE_K = 5;
export const ATTEND_MOD_MIN = 0.5;
export const ATTEND_MOD_MAX = 2.0;
export const REP_MIN = 0;
export const REP_MAX = 100;
export const REP_SEASON_DECAY = 0.9;

export type VenuePricing = 'capacity' | 'flat' | 'legacy_range';

export interface VenueActivityDef {
  name: string;
  pricing: VenuePricing;
  pricePerSeat: number; fillRate: number; income: number;
  incomeMin: number; incomeMax: number;         // legacy_range / 展示用；0 = 未设
  costBase: number; costPerSeat: number;
  attendMod: number; reputationGain: number; fansDelta: number;
  pitchBoostPerLevel: number; youthBoostPerLevel: number; broadcastBoostPerLevel: number;
  pitchDamageProb: number; damageMin: number; damageMax: number;
  incomeRepBase: number;
  requiresFacility: 'broadcast' | 'youth' | 'commercial' | null;
  requiresLevel: number;
  requiresReputation: number | null;
}

export interface VenueContext {
  capacity: number; reputation: number;
  pitchLevel: number; youthLevel: number; broadcastLevel: number;
  attendanceRate: number;      // 本窗主场上座率，0 场按 1
  attendBuff: number;          // 冠名品牌档位加成（现有 home.ts:705 口径）
}

export interface VenueQuote {
  gross: number; opsCost: number;
  damage: number;              // 本次 rolls 掷出的实际草皮修复（结算入账）
  expectedDamage: number;      // 期望值 = prob × (min+max)/2（预览/推荐用）
  net: number;                 // gross − opsCost − damage（结算口径）
  expectedNet: number;         // gross − opsCost − expectedDamage（预览/推荐口径）
  attendanceMod: number; reputationGain: number;
}

export interface VenueSlotQuote {
  slotNo: number; activity: string; saturation: number;
  gross: number; opsCost: number;
  expectedDamage: number; expectedNet: number;
  attendanceMod: number; reputationGain: number;
}

export interface VenueTotals {
  gross: number; opsCost: number;
  expectedDamage: number; expectedNet: number;
  attendanceMod: number; reputationGain: number;
}

export function slotsForCapacity(capacity: number | null | undefined, slotCap: number): number;
export function satMultAt(ordinal: number): number;                     // 0-based；≥3 取 0.45
export function venueQuote(def: VenueActivityDef, ctx: VenueContext, satMult: number,
                           rolls: { income: number; damage: number; damageRoll: number }): VenueQuote;
export function quotePlan(input: {
  capacity: number; slots: number; defs: Record<string, VenueActivityDef>;
  facilities: Map<string, number> | Record<string, number>;
  reputation: number; attendanceRate: number; attendBuff: number;
  picks: { slotNo: number; activity: string | null }[];
}): { quotes: VenueSlotQuote[]; totals: VenueTotals };
export function activityUnlockReason(
  def: VenueActivityDef,
  facilities: Map<string, number> | Record<string, number>,
  reputation: number,
): string | null;   // 返回可直接给玩家看的中文；null = 已解锁
export function recommendPlan(input: {
  capacity: number; slots: number; policy: 'money' | 'fans' | 'reputation';
  defs: Record<string, VenueActivityDef>;
  facilities: Map<string, number> | Record<string, number>;
  reputation: number; attendanceRate: number; attendBuff: number;
  existing: { slotNo: number; activity: string }[];
}): { policy: string; picks: { slotNo: number; activity: string }[]; totals: VenueTotals };
export function validateActivityConfig(raw: unknown): string | null;
export function validateActivitySlots(raw: unknown): string | null;
```

实现口径（写代码时逐字对齐，不要自创）：

- `slotsForCapacity(cap, slotCap)`：先 `if (slotCap <= 0) return 0`；`base = (!cap || cap <= 0) ? 2 : cap < 15000 ? 2 : cap < 30000 ? 3 : 4`；返回 `min(base, trunc(slotCap), SLOT_HARD_MAX)`。无 `stadiums` 行的队（如曼城 id=10、AC 米兰 id=131681）`cap=0` ⇒ 2 槽，与设计 :368 的 fallback 一致。
- `venueQuote`：
  - `base`：`capacity` 型 = `capacity × pricePerSeat × fillRate`；`flat` 型 = `income`；`legacy_range` 型 = `incomeMin + rolls.income × (incomeMax − incomeMin)`。
  - 设施乘数：`capacity`/`flat` = `1 + pitchBoostPerLevel×pitchLevel + youthBoostPerLevel×youthLevel + broadcastBoostPerLevel×broadcastLevel`；`legacy_range` 复刻旧序（concert 用 `pitchBoostPerLevel`，youth 用 `youthBoostPerLevel`，不乘 broadcast）。
  - `gross = round3(base × 设施乘数 × (1 + attendBuff) × satMult × (incomeRepBase > 0 ? incomeRepBase + reputation/100 : 1))`。
  - `opsCost = round3(costBase + costPerSeat × capacity)`（**不乘饱和、不乘任何加成**，按档照付）。
  - `prob = max(0, pitchDamageProb × (1 − 0.15 × pitchLevel))`；`damage = rolls.damageRoll < prob ? round3(damageMin + (damageMax − damageMin) × rolls.damage) : 0`；`expectedDamage = round3(prob × (damageMin + damageMax) / 2)`。只对 `pitchDamageProb > 0` 的活动有值。
  - `net = round3(gross − opsCost − damage)`；`expectedNet = round3(gross − opsCost − expectedDamage)`。
  - `attendanceMod = def.attendMod`；`reputationGain = round2(def.reputationGain × clamp(attendanceRate, 0, 1))`。
  - 全部金额 round 到 3 位小数（与现 `src/worker/venue-ops.ts:133-151` 的 round3 口径一致）。
- `quotePlan`：
  - 把 `picks` 去重（同 slotNo 后者覆盖）、按 `slotNo` 升序；只处理 `1..slots` 且 `activity` 非空、非 `idle` 的项。
  - 同类序位：`counts = Map<activity, number>`，每项 `sat = satMultAt(counts.get(activity) ?? 0)`，然后 `counts++`。
  - 每项用 `venueQuote(def, ctx, sat, { income: 0.5, damage: 0.5, damageRoll: 0.5 })`，只取 `gross/opsCost/expectedDamage/expectedNet/attendanceMod/reputationGain`；`quotes[]` 不含实际 `damage`。
  - 聚合：`totals.gross/opsCost/expectedDamage/expectedNet` 求和 round3；`attendanceMod` = 逐项 `clamp(prev × def.attendMod, 0.5, 2.0)`（无项 = 1）；`reputationGain` 求和 round2。
- `activityUnlockReason` 文案模板：`需要转播设施 L2（当前 L0）` / `需要青训设施 L1（当前 L0）` / `需要商业设施 L1（当前 L0）` / `需要场馆声望 ≥20（当前 12）`；多条件同时不满足时**全列出并用「；」连接**。
- `recommendPlan` 贪心（保已排、只填空槽、按 `slotNo` 升序、跳过锁定/未知活动）：
  - 每一步对每个候选活动调一次 `quotePlan`，用整盘 `totals` 比较；`money` 取 `expectedNet` 最大，`reputation` 取 `reputationGain` 最大。
  - `fans` 取二元组 `(sum(fansDelta), totals.attendanceMod)` 最大（P0 所有 `fansDelta=0` ⇒ 退化为上座乘数最大；P1 加 `fans_delta` 后自动生效）。同分按 `defs` 的键序稳定取第一个。
  - `existing` 里的已排项原样保留；若已排活动当前被锁，也不移除（只提示）。
  - 返回最后一次 `quotePlan` 的 `totals`。
- `validateActivityConfig`：每类活动只允许白名单键（含旧键 `income_min/income_max/youth_level_factor`），未知键 = 报错（消灭 `parseDef` 静默丢弃）；拒绝 `income < 0`、`costBase < 0`、`pricePerSeat < 0`、`fillRate < 0 || fillRate > 1`、`attend_mod` 不在 0.5..2、`reputation_gain` 不在 0..10、`fans_delta` 不在 0..5、`requires_level` 不在 0..5、未知 `requires_facility`、`income_max < income_min`、`pricing` 不在枚举、`legacy_range` 缺 min/max。
- `validateActivitySlots`：必须是整数 0..20 的字符串/数字，否则报错。

### 4.2 `src/worker/venue-ops.ts`（重写主体）

| 行 | 现状 | 改成 |
|---|---|---|
| `:15-19` | `SLOT_MIN/SLOT_MAX/DEFAULT_SLOTS/PITCH_*` | 保留 `SLOT_MIN`；`SLOT_MAX` 改引 `SLOT_HARD_MAX`；`DEFAULT_SLOTS` 删（改由 core 派生）；`PITCH_DAMAGE_REDUCTION_PER_LEVEL`（`:18`）与 `PITCH_CONCERT_BOOST_PER_LEVEL`（`:19`）**也删**——私有常量，只被 `activityIncome`（`:144`/`:147`）使用，换成 core 的 `venueQuote` 后必成未使用局部量，`tsconfig.worker.json:9` 的 `noUnusedLocals` 报 TS6133；两个系数（0.15 / 0.1）随公式写进 `src/core/venue.ts` 的字面量（core 保持零 import） |
| `:21-31` | `ActivityDef { name, income, incomeMin, incomeMax, pitchDamageProb, damageMin, damageMax, youthLevelFactor }` | 改为 re-export core 的 `VenueActivityDef`；旧字段只活在 `parseDef` 的 `legacy_range` 分支里 |
| `:33-36` | `ActivityCatalog { slots, types }` | `{ slotCap: number; types: Record<string, VenueActivityDef>; legacyKeys: string[] }` |
| `:40-63` | `parseDef` 白名单 7 键 | 白名单扩到 §3.1 全部键 + 旧键兼容（`income_min/max` → `pricing:'legacy_range'`，保留 min/max；`income` → `flat`） |
| `:66-80` | `loadActivityCatalog` 返回 `slots`（config `activity_slots`，默认 2） | 返回 `slotCap`（默认 4）、`legacyKeys`；不再 clamp 成「槽数」；`types` 为空仍 500 |
| `:133-151` | `activityIncome(def, activityType, pitchLevel, youthLevel, rolls, attendBuff)` | 改 `activityQuote(def, ctx: VenueContext, satMult, rolls): VenueQuote`，内部调 core 的 `venueQuote`；**删除旧函数**（不再留薄包装，见 §7.2 的 `naming-tiers` 改测） |
| `:154-197` | `bookingSettlement(env, row, catalog, pitchLevel, youthLevel, attendBuff)`（单行） | 保签名骨架，参数换 `(env, row, catalog, ctx, satMult)`；返回 `{ statements, gross, opsCost, damage }`；账目见下 |
| `:201-220` | `windowActivityStatements(env, clubId, season, windowSeq, catalog, levels:{pitch,youth,attendBuff?})` | 新签名见下；追加「窗末副作用」两条语句；返回 `gross/opsCost/damage/net` 与 `bookings` |
| `:226-269` | `bookSlot` 只校验序号/活动/开窗/op | 拆成 `venueSlotStatement` + `bookSlot` 包装；新增容量/设施/声望三道闸；槽上界用容量派生 |

`windowActivityStatements` 新签名：

```ts
export async function windowActivityStatements(
  env: Env, clubId: number, season: number, windowSeq: number,
  catalog: ActivityCatalog,
  ctx: VenueContext,
): Promise<{
  statements: D1PreparedStatement[];
  gross: number; opsCost: number; damage: number; net: number;
  reputationGain: number; attendMod: number; bookings: number;
}>;
```

- 排序：`listBookings`（`:93-102`）已 `ORDER BY slot_no`；计算饱和时用 `Map<activityType, count>` 逐行取**同类序位**（不是 `slot_no`）。
- **多档上座乘数逐档连乘**：`attendMod` 初值 1，每结算一个非 idle 档位就 `attendMod = clamp(attendMod × def.attendMod, 0.5, 2.0)`；`windowActivityStatements` 只返回这一个聚合值，关窗批只写一次 `UPDATE stadiums`。`reputationGain` 逐档求和（round2）。
- 无预订 ⇒ 返回空语句、全 0，**不写台账**（无副作用）。
- 有预订 ⇒ 逐行落三条互不冲突的账本流水（`src/worker/ledger.ts:33` 的幂等闸是 `(club_id, kind, ref_type, ref_id)`，所以必须靠 `ref_type` 区分）：

| 科目 | kind | ref_type | ref_id | amount |
|---|---|---|---|---|
| 活动收入 | `activity` | `booking` | `venue_bookings.id` | `+gross` |
| 草皮修复 | `maintenance` | `booking` | `venue_bookings.id` | `−damage` |
| 运营成本 | `maintenance` | `booking_ops` | `venue_bookings.id` | `−opsCost` |

> 注：现有实现把 `income` 直接当毛收入入账（`venue-ops.ts:174-182`），新口径下 `income` 与净额拆开。**裁决**：`activity` 流水入 `+gross`，`maintenance/booking_ops` 入 `−opsCost`，`maintenance/booking` 入 `−damage`。教练在流水页看到的三条加起来 = 净额，且与 `summary.activityTotal` 一致。`memo` 仍以「{活动名}（S{season} 第 {window_seq} 窗 {slot_no} 号档期」开头（现有断言前缀不破），末尾追加「（毛 5.25 × 饱和 0.70）」「（运营成本 0.98）」。

- 尾部追加窗末副作用（**按队一次，不是按槽**）：
  ```sql
  INSERT OR IGNORE INTO venue_window_settlements
    (club_id, season, window_seq, reputation_gain, attend_mod, bookings, created_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

  UPDATE stadiums SET
    venue_reputation = MAX(0, MIN(100, ROUND(venue_reputation + ?, 1))),
    next_attendance_mod = CASE WHEN ? <> 1
      THEN MAX(0.5, MIN(2.0, ROUND(next_attendance_mod * ?, 3)))
      ELSE next_attendance_mod END,
    attendance_mod_matches = CASE WHEN ? <> 1
      THEN CASE
        WHEN attendance_mod_matches = 0 AND next_attendance_mod <> 1 THEN 0  -- 事件预置仍一场即清
        ELSE MAX(attendance_mod_matches, 5)
      END
      ELSE attendance_mod_matches END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE club_id = ? AND changes() > 0;
  ```
  第二条的 `changes() > 0` 读的是**上一条 INSERT OR IGNORE 是否真的插入了行**（同 `src/worker/ledger.ts:58-59` 既有写法）：重跑关窗批时 INSERT 被忽略 ⇒ 0 ⇒ 声望/乘数不二次叠加。`?` 分别是 `reputationGain`、`attendMod`（三次）与 `clubId`。
  - `CASE` 里的 `attendance_mod_matches` / `next_attendance_mod` 都是**本语句执行前的旧值**：`K=0, mod=1.5`（事件预置）+ 活动 0.95 ⇒ 新 mod 1.425、K 仍 0，下一场即清；`K=0, mod=1` + 活动 0.95 ⇒ K=5；`K=5` + 活动 ⇒ K 仍 5。活动与事件同窗时，事件的「一场即清」优先（活动 5 场效果会在那一场后一并清掉，见 §9 R3）。

`bookSlot` 拆法：

```ts
export async function venueSlotStatement(
  env: Env,
  input: { clubId: number; season: number; windowSeq: number; slotNo: number; activityType: string | null; bookedBy?: string },
  catalog: ActivityCatalog,
): Promise<D1PreparedStatement>;   // activityType === null ⇒ DELETE 该槽；否则 upsert 必须显式 SET booked_by（PUT 传 ''，覆盖事件赠档的 '事件' 时才清得掉，否则旧值残留、GET 的 bookings[].bookedBy 会显示错来源）
export async function bookSlot(env, input, catalog?): Promise<{ booking: VenueBookingRow; previous: VenueBookingRow | null }>;
```

校验顺序固定（任何一步失败抛 `HttpError`，message 直接给玩家看）：

1. 槽号：`slotNo` ∈ `1..slotsForCapacity(venue.capacity, catalog.slotCap)`，否则 400 `档位序号应在 1-N 之间（本队容量 X 座，本窗 N 个档位）`
2. 活动存在且不等于 `idle`（空置用 `activityType: null` 清空），否则 400 `没有「X」这种活动`；`idle` 单独给 `空置档不用保存，选「暂不排」即可`
3. 设施/声望：`activityUnlockReason` 非空 ⇒ 400 该文案
4. 开窗：`isWindowOpen` 否则 409 `档期只能在开着的窗口里订，这一窗已经关了`（保留 `:237-239` 现有文案）
5. `assertOpOpen(env.DB, 'consumption')`（保留 `:241`；0078 改锚后它才真正生效）

`capacity`、设施等级与当前乘数一次性取：新增 `loadVenueContext(db, clubId): Promise<{ capacity: number; hasStadium: boolean; venueReputation: number; nextAttendanceMod: number; attendanceModMatches: number; facilities: Map<string, number> }>`（`stadiums` 无行 ⇒ `capacity: 0`、`hasStadium: false`、声望 0、`nextAttendanceMod: 1`、`attendanceModMatches: 0`、设施空；**不要**回退 20000）。GET 的 `attendance.mod` 取 `nextAttendanceMod`；`matchesLeft` 取 `nextAttendanceMod !== 1 ? Math.max(1, attendanceModMatches) : 0`（事件预置 K=0 也要在 UI 显示「还剩 1 场」，不能显示 0）。

### 4.3 `src/worker/home.ts`

| 行 | 改什么 |
|---|---|
| `:334` | 主场上座查询的 SELECT 列表加 `attendance_mod_matches` |
| `:402` | 传 `nextAttendanceMod` 不变；读取端不钳（钳位由写入端负责） |
| `:460` | 消费改「按场次递减、到 0 清零」：`next_attendance_mod = CASE WHEN attendance_mod_matches <= 1 THEN 1 ELSE next_attendance_mod END`、`attendance_mod_matches = CASE WHEN attendance_mod_matches > 0 THEN attendance_mod_matches - 1 ELSE 0 END`，`next_weather = ''` 保持 |
| `:473-486`、`:568-576` | `HomeWindowSummary` 加 `activityOpsCost: number`，并在 `:568-576` 的 `const summary: HomeWindowSummary = { … }` 字面量里补 `activityOpsCost: 0`（漏了必 TS2741）；`activityTotal` 语义改「本窗活动净现金」（`gross − opsCost − damage`） |
| `:554` | 设施查询 `IN ('youth','pitch')` → `IN ('youth','pitch','broadcast','commercial')`（后两个给门槛校验与报价用） |
| `:551` | `windowHomeStatements` 内已有的 stadium 批量取数（`s.capacity`/`s.fans` 来源）SELECT 列表加 `venue_reputation`、`next_attendance_mod`、`attendance_mod_matches`；它们要作为 `VenueContext` 传给 `windowActivityStatements` |
| `:702-710` | 调用改传完整 `VenueContext`（`capacity`/`reputation`/`pitch`/`youth`/`broadcast`/`attendRate`/`attendBuff`）；`summary.activityTotal = round2(gross − opsCost − damage)`，并累加 `summary.activityOpsCost` |
| `:614-615` | 基础维护费**不动**（仍按主场场次），活动成本是另一层 |

`K = 5` 的消费语义（对齐 `tests/event-ops.test.ts:1002-1015` 的既有断言）：`K=0` 且 `next_attendance_mod ≠ 1` 是**随机事件预置的一场性效果**，仍然只作用下一场后清零（`attendance_mod_matches <= 1` 分支命中）；`K=5` 是活动给的，逐场 −1、第 5 场后归 1。因此 `src/worker/event-ops.ts:839-850` 的预置**不需要改**。

### 4.4 `src/worker/window-machine.ts`

- `openWindow`（`:71-80`）返回类型加 `venueReset: boolean`、`venueNotified: number`。
- **新季首窗清零**（锁定决策 7 最后一句）：在构造 `openBatch` 前 `SELECT COUNT(*) AS n FROM season_windows WHERE season = ?`；`n === 0` 时向同一批追加
  `UPDATE stadiums SET next_attendance_mod = 1, attendance_mod_matches = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE next_attendance_mod <> 1 OR attendance_mod_matches <> 0`。
  放在 `:159-178` 的 `openBatch` 里（`INSERT season_windows` 前后均可），失败时整批回滚 ⇒ 不会出现「窗没开但乘数被清」。
- **经纪人重掷并入开窗批（P0 ⑧）**：删除 `:155` 的 `if (statements.length > 0) await db.batch(statements);`；把 `...statements` 放到 `openBatch` 最前面（`INSERT seasons` 之前）。`statements` 为空时无影响。这样 `openBatch` 因并发 UNIQUE 失败时，重掷语句一起回滚，不会出现「窗没开、经纪人却被重掷」。`audit` 的 `after.rerolled` 仍是预扫描计数（不需要读批后结果）。
- **开窗站内信**：`await db.batch(openBatch)`（`:191-208`）成功之后、返回之前，复用 `:209-230` 的 try/catch「通知失败不影响开窗」模式：`SELECT s.club_id, s.capacity FROM clubs c LEFT JOIN stadiums s ON s.club_id = c.id WHERE c.status = 'active'`，逐队 `queueClubNotification(env, clubId, 'venue_window_open', { season, windowSeq, slots: slotsForCapacity(capacity, slotCap) })`；返回值累加 `venueNotified`。
- **audit 口径**：`window_open` 的 `after` 只能放 batch 前已知的 `{season, windowSeq, isTemporary, growthPeriodDeclared, playersScanned, rerolled, venueReset}`；**不要**把 `venueNotified` 放进 audit（audit 语句在 batch 前构造，拿不到批后通知数）。通知数从返回值与 `notifications` 表读（§7.4 第 1 条）。
- **不改** `:82-85` 的 COUNT 预检（它给的是友好 409 文案，真正的并发闸是 §2 的唯一索引）。

### 4.5 `src/worker/routes/clubs.ts`

- **删除** `:1301-1369`：`GET /club/bookings`（`:1301` 起）与 `POST /club/bookings`（`:1340` 起，`:1369` 的 `});` 结束）。**保留** `:1371` 的随机事件注释与 `:1373` 的 `app.get('/club/events'`——旧计划的 `:1340-1375` 会误删 events 路由头，已纠正。删完同步收尾 import：`:24` 的 `import { bookSlot, listBookings, loadActivityCatalog, type VenueBookingRow }` 去掉 `bookSlot`（新 PUT 走 `venueSlotStatement`，`bookSlot` 在 clubs.ts 再无引用；`noUnusedLocals` 下留着必 TS6133）。`:1290` 的 `bookingDto` 由新 GET 的 `bookings[]` 继续复用（字段形状不变），别删成未使用函数。
- **新增** `GET /club/venue-plan`（注册路径**不带 `/api`**：clubs.ts 挂在 `/api` 路由器下，对外即 `/api/club/venue-plan`；照抄带 `/api` 会变成 `/api/api/...`。`requireCoach('club.squad.manage')`，getBoundClub 失败 403 `先绑定俱乐部再排档期`）：

```ts
interface VenuePlanResponse {
  clubId: number;
  window: { status: 'open' | 'closed'; season: number; windowSeq: number;
            openedAt: string; closesAt: string | null; reminderSent: boolean } | null;
  capacity: number;
  hasStadium: boolean;
  slotCount: number;                       // 派生槽数（= slots.length，自检用）
  slotCap: number;                         // config activity_slots
  reputation: number;
  attendance: { mod: number; matchesLeft: number; clamp: [number, number] };
  facilities: { key: string; label: string; level: number }[];
  activities: { key: string; name: string; blurb: string; unlocked: boolean;
                requirements: { label: string; need: number; current: number }[] }[];
  slots: {
    slotNo: number; saturation: number; booked: string | null;
    quote: { activity: string; gross: number; opsCost: number;      // 该槽当前口径；空槽为 null
             expectedDamage: number; expectedNet: number;
             attendanceMod: number; reputationGain: number } | null;
    options: { activity: string; gross: number; opsCost: number;
               expectedDamage: number; expectedNet: number;
               attendanceMod: number; reputationGain: number; unlockReason: string | null }[];
  }[];
  policy: 'money' | 'fans' | 'reputation' | null;
  recommendations: Record<'money' | 'fans' | 'reputation',
    { policy: string; picks: { slotNo: number; activity: string }[]; totals: VenueTotals }>;
  bookings: { id: number; slotNo: number; activityType: string; activityName: string;
              bookedBy: string; createdAt: string }[];   // booked_by 是 TEXT（赠档写 '事件'），别按 number 解析
  configWarning: string | null;            // legacyKeys 非空时给前端提示
}
```

  - 金额单位「百万」、3 位小数由服务端算好；**前端只展示 preview.totals，不逐槽加总**。
  - `slots[i].options` 覆盖 5 类活动 + `idle`(空置)；`saturation` 是**该槽若排「同类下一个」时**的系数——前端只展示，不推导，也不用于合计。
  - `slots[i].quote` 只在已排槽非 null：按该槽**已排活动**在本窗的同类序位调用同一个 `venueQuote`（与 preview 同口径），给页面显示「这一槽现在排的是什么、值多少」；空槽 null。
  - `window = null` 表示当前没有进行中的窗：仍返回 `slots` 与 `options`（可试排、不可保存）。
  - `closesAt = openedAt + window_length_hours`，仅在 `window !== null` 时给；`opened_at` 为空（存量脏行）⇒ `closesAt: null`，前端降级为「关窗由管理员触发」。
  - `reminderSent` 取 `season_windows.venue_reminder_at <> ''`。**不要**扩 `getOpenWindow`（它只 SELECT `season, window_seq`，被十几处调用）；新增 `getVenueWindow(db)` 专门查 `season, window_seq, opened_at, venue_reminder_at`（§6.2）。
  - `attendanceRate` 由 `loadVenueContext` 算：`SELECT COALESCE(SUM(attendance),0) AS total, COUNT(*) AS n FROM match_attendance WHERE club_id=? AND season=? AND window_seq=?`；`n > 0 && capacity > 0 ? total/(capacity*n) : 1`（与 `home.ts:601-610` 完全同口径）。无窗时用 1。
  - `attendBuff` 由 `loadVenueContext` 算：`SELECT nc.brand, bp.tier FROM naming_contracts nc JOIN brand_pool bp ON bp.brand = nc.brand WHERE nc.club_id=? AND nc.status='active'`，再 `loadTierProfiles` 取 `attendBuff`；无冠名 = 0（与 `home.ts:632` 同口径）。
- **新增** `POST /club/venue-plan/preview`（对外 `/api/club/venue-plan/preview`，注册同样不带 `/api`；只读，不落库，不需要开窗）：
  - body `{ slots: { slotNo: number; activity: string | null }[] }`（**完整草稿**，缺省槽 = 空置）。
  - 校验槽号 `1..slotCount`、重复槽 400、未知活动 400；设施/声望**不 reject**，只在每槽 `unlockReason` 返回（预览要能显示已排但已锁的项）。
  - 调 `quotePlan` 返回 `{ slots: VenueSlotQuote[], totals: VenueTotals, unlockReasons: Record<number, string> }`。
  - 不写任何表；不调 `bookSlot`；`requireCoach` 与 GET 相同。
- **新增** `PUT /club/venue-plan`（对外 `/api/club/venue-plan`），body `{ slots?: { slotNo: number; activity: string | null }[]; policy?: 'money' | 'fans' | 'reputation' | null }`：
  - 语义：只改 body 里出现的槽（partial）；`activity: null` = 清空该槽；`policy` 省略 = 保持、`null` = 清空。
  - 无开着的窗 ⇒ 409 `现在没有开着的窗，档期保存不了`（沿用现有 `:1341` 的语义措辞）。
  - **ops 闸**：窗口检查之后、构建语句之前调 `assertOpOpen(env.DB, 'consumption')`（与 `bookSlot` 同口径，见 `venue-ops.ts:241`）；运营把 consumption 改成 absolute 或临时关闭时必须 409。前端 `useOpsGate` 只是提示，不能替代服务端校验。
  - 流程：先全部校验（`venueSlotStatement` 逐个构建，第 1 个失败就抛）⇒ 把所有语句 + 可选的 `UPDATE clubs SET venue_policy = ? WHERE id = ?` 塞进**一次 `db.batch`**（原子，D1 batch 语义）。
  - 门槛校验只对**新增/改动的槽**做：body 里与已保存值相同的槽不重验设施/声望（否则设施降级后连「保持原样」都保存不了）；新增/改动命中 `activityUnlockReason` ⇒ 400。
  - 返回 `{ slots: VenueSlotQuote[], policy, totals }`（`totals` = 保存后整窗的 `quotePlan`，预期口径）。
  - 非法 `policy` ⇒ 400。

### 4.6 其它服务端文件

| 文件 | 改什么 |
|---|---|
| `src/worker/season-settle.ts:531-540` | 赛季末声望衰减。在 push 前记录 `const growableIdx = statements.length;` 与 `const seasonsIdx = statements.length + (growableStmt ? 1 : 0) + champion.statements.length;`；批内顺序 = `...statements` → growable → `...champion.statements` → `UPDATE seasons SET status='settled' …`（索引 `seasonsIdx`）→ `UPDATE stadiums SET venue_reputation = ROUND(MAX(0, venue_reputation) * 0.9, 2), updated_at = … WHERE venue_reputation > 0 AND changes() > 0`。`growable` 改读 `batchResults[growableIdx]`；**冠军通知改读 `batchResults[seasonsIdx]`，不要读 `batchResults[batchResults.length - 1]`**（批尾现在是 stadium 衰减，P0 初期 rep 全 0 时 changes=0，会把冠军通知吞掉） |
| `src/worker/event-ops.ts:285-296`、`:352-372` | `EventStadium` 加 `venue_reputation: number`；`loadEventContexts` 的 stadiums SELECT 加 `venue_reputation`（`capacity` 已有，不要重复加）；`:406` 的无行 fallback 对象补 `venue_reputation: 0`。`tests/event-ops.test.ts:184`、`tests/event-choice.test.ts:214`、`tests/market-rounds.test.ts:245` 三处 `stadium: {` 字面量同步补 `venue_reputation: 0`（`grep -n 'next_attendance_mod:' tests/*.ts` 只有这三处是 `stadium: {` 字面量，其余是 `sqlGet`/`toMatchObject`；tests 的 tsconfig 是 strict，漏一处就 TS2741） |
| `src/worker/event-ops.ts:737-746`、`:1117-1125`、`:1405-1415` | **不要**给 `EffectRunContext` 加 `capacity`（它是批级共享）；`applyEventEffects(env, ctx: EventClubContext, …)` 里直接用 `ctx.stadium.capacity` 与 `ctx.stadium.venue_reputation` |
| `src/worker/event-ops.ts:1000-1030` | 赠档：`for (i = SLOT_MIN; i <= slotsForCapacity(ctx.stadium.capacity, ec.catalog.slotCap); i++)` 找空槽；写库前调 `activityUnlockReason(def, ctx.facilities, ctx.stadium.venue_reputation)`，非空则**不 INSERT**，`notes.push('赠档 …（' + reason + '，落空）')`；无空槽/无窗/未知活动的现有文案保留。赠档不得绕过设施/声望闸 |
| `src/worker/notify.ts:40-143` | `renderNotification` 加两个 case（见 §6.1），保留 default 的 `data.text` 兜底；**不**给 `queueClubNotification`（`:151-153`）加 options 参数 |
| `src/core/notify-meta.ts:43` | `NOTIFY_META` 加两条 4 字标签（`场馆开窗` / `档期提醒`），`category: 'window'`；顺手把 `:42` 的注释「33 个模板」改成 39（`:41` 是空行；测试里四处 37→39 与 `expected.window` 数组见 §6.1） |
| 新建 `src/worker/venue-reminders.ts` | `runVenueReminderTick(env, now?)`（§6.2） |
| `src/worker/index.ts:187-232`、`:234-250` | 在 `dispatchPendingNotifications`（`:196`）之前调用 reminder tick，包 try/catch；**不计入** `tickChanged` |
| `src/worker/routes/admin/config.ts` | 写 `activity_config` / `activity_slots` 前调 `validateActivityConfig` / `validateActivitySlots`，非法 400（该文件本轮**未复核**，实施时按函数名定位，不引具体行号） |

---

## 5. 前端

### 5.1 路由与入口（三处，不加顶栏第 9 项）

| 文件 | 改什么 |
|---|---|
| `web/src/App.tsx:59` 附近 | 加 `const VenuePlanPage = lazy(() => import('./pages/venue/VenuePlanPage.tsx'));`（照 `:19-58` 现有 lazy 写法） |
| `web/src/App.tsx:146-155` 之后、`:157` 的 `/offers` 重定向之前（`:156` 是注释行，别把 Route 插进注释里） | `<Route path="/venue" element={<RequireUser><VenuePlanPage /></RequireUser>} />` |
| `web/src/pages/Home.tsx:64-67`（消费中心卡之后） | 加一张「场馆经营」`.nav-card` → `/venue`；`.nav-card` 栅格在 `:55-82`（文件共 94 行），**不要**引用不存在的 `:110-111`，也不要动顶栏。同一处把 `:66` 消费中心卡文案里的「球场档期」删掉——功能已移出，否则同页两处提档期、其中一处指向不存在的能力 |
| `web/src/pages/club/VenueTab.tsx:125` | **保留**原链接「去消费中心经营设施 →」（`web/src/pages/ClubDetail.test.tsx:1223`/`:1232` 与 e2e ⑱ `smoke.mjs:3064` 都断言这串文本，改了必红；设施/冠名仍在消费中心，文案本身仍准确），在其后**新增**一条「去场馆经营排档期 →」→ `/venue`；另改 `:1-3` 文件头注释（仍写「设施经营/冠名市场/球场档期三卡」）里的档期表述 |
| `web/src/pages/shop/ShopPage.tsx:16`、`:166`、`:1-2`、`:127`；`web/src/pages/shop/venueCards.tsx:1-2` | 删 `BookingsCard` 的 import 与渲染；`ShopPage.tsx:1-2` 与 `venueCards.tsx:1-2` 的文件头注释都要把「球场档期」从三卡里去掉（删块后注释还写着档期就与实现不符） |
| `web/src/pages/shop/venueCards.tsx:522-641` | 整块删除 `BookingsCard`；连带 `:8-10` 的 `Booking*` 类型导入与块内 `incomeText`（`:573`）。**保留** `money2`（`:30`）、`seasonsOf`（`:25`）、`FacilityOpsCard`（`:84`）、`NamingCard`（`:246`） |

### 5.2 数据层

- `web/src/lib/api.ts`：删 `BookingActivityOption`（`:1485`）/`BookingsResponse`（`:1502-1512`）/`BookingResult`（`:1514`）三处类型（删 `POST /club/bookings` 后无引用，改完 `grep` 确认零命中）；同时删 `web/src/lib/queries.ts` 的 `qk.bookings`；按 §4.5 的 `VenuePlanResponse`、`VenueSlotQuote`、`VenueTotals` 新增类型，另定义 `VenuePreviewResponse = { slots: VenueSlotQuote[]; totals: VenueTotals; unlockReasons: Record<number, string> }`（§5.2 的 `useVenuePreview` 要用；全篇只此一处定义，别只写名字），并在 api.ts **导出 `VenueSlotDto = VenuePlanResponse['slots'][number]`**（§5.3 的纯函数层要用）；`BookingRow` `:1493` 可保留为 `bookings[]` 的元素类型。
- `web/src/lib/queries.ts:41` 旁加 `venuePlan: ['club', 'venue-plan'] as const`、`venuePreview: ['club', 'venue-plan', 'preview'] as const`；在 `useHomeMatches`（`:412`）之后加 `useVenuePlan(enabled: boolean)`（`useQuery` + `api`，**不引 `useMutation`**，照 `useShopCatalog` `:453` 的写法）。**不要**在 `useQuery` 上写 `onSuccess`：v5 的 `useQuery` 没有这个选项，写了要么 typecheck 红、要么每次取数成功就自我失效；失效点放在页面 PUT 保存成功后 `qc.invalidateQueries({ queryKey: qk.venuePlan })`，预览请求不失效。
- 再加 `useVenuePreview(picks: readonly { slotNo: number; activity: string | null }[], enabled: boolean)`：`useQuery` 的 `queryFn` 调 `apiPost<VenuePreviewResponse>('/api/club/venue-plan/preview', { slots: picks })`（`api` 是只发 GET 的普通函数、没有 `.post`；POST 用 `apiPost`，见 `api.ts:69`），`queryKey` 含 `picks` 的序列化；页面用 `useDeferredValue` + 250ms 防抖后再传。`placeholderData: keepPreviousData`，避免每次改单闪空。这是只读 POST，不是写操作。
- `enabled` 由页面传 `isCoach && club !== null`，避免访客空打请求。

### 5.3 纯函数层 `web/src/pages/venue/venue-preview.ts`

```ts
// 依赖 §5.2 在 api.ts 导出：export type VenueSlotDto = VenuePlanResponse['slots'][number];
export type VenueDraft = Record<number, string | null | undefined>;   // undefined = 沿用 slot.booked；null = 明确清空
// 必须含 undefined：`Record<number, string | null>` 的索引访问是 `string | null`，`draft[n] === undefined` 报 TS2367；改 `??` 又会把「明确清空」和「沿用」混成一义
export function effectivePick(slot: VenueSlotDto, draft: VenueDraft): string | null;
export function draftToPicks(slots: readonly VenueSlotDto[], draft: VenueDraft): { slotNo: number; activity: string | null }[];
export function diffDraft(slots: readonly VenueSlotDto[], draft: VenueDraft): { slotNo: number; activity: string | null }[];
export function samePicks(draft: VenueDraft, picks: { slotNo: number; activity: string }[]): boolean;
```

**删除 `composeTotals`**。前端不再逐槽加总、不再连乘乘数、不再钳制；合计一律用 `POST /preview` 返回的 `totals`（服务端按草稿的同类序位算）。本文件只负责「草稿 → picks」与「草稿是否改动」。

### 5.4 页面 `web/src/pages/venue/VenuePlanPage.tsx`（+ 可选的 `venue-plan-parts.tsx`）

- 身份三态闸照 `web/src/pages/shop/ShopPage.tsx:59-77` 的原文：loading「正在确认你的俱乐部身份…」/ `clubFailed && isCoach`「俱乐部身份暂时取不到，请稍后刷新重试。」/ `!isCoach || club === null` 分「还没有绑定俱乐部…」「这里只对教练开放…」。
- 头图区：容量（`hasStadium=false` 显示「未建球场，按 2 档试排」）/ 派生槽数 / 声望 / 三项设施等级 badge（`broadcast`/`youth`/`commercial`）。
- 窗口横幅：`window?.status === 'open'` → 「第 S 季 W 窗进行中，本窗还可排 X 档」（X 按**已保存**的 `slots.filter(s => s.booked === null).length`；X=0 显示「本窗档期已排满」）；无窗 → 「当前没有进行中的转会窗，可以先试排；开窗后才能保存」。**不写「损失/少赚多少」**（中性提示口径）。
- 倒计时：`window?.closesAt` 存在才用 `web/src/lib/use-countdown.ts` 的 `useCountdown` + `fmtClock` 显示；`reminderSent` 为真显示「关窗提醒已发到站内信」；字段缺省降级为「关窗由管理员手工触发」，不编时刻。
- 三张方针卡：`多赚钱 / 攒人气 / 树口碑`，各显示 `recommendations[p].totals` 的预期净额 / 下 5 场上座乘数 / 声望增量；`policy` 非空时打「上次用」badge，但**不自动套用**。按钮「按此方针排满」用 `recommendations[p].picks` 覆盖本地 draft（旁边常驻「放弃改动」），卡上注明「方针只是推荐口径，保存前可逐档改」。
- 档位网格：直接渲染 `slots`（**前端不自己算槽数**）。每槽：档位号 + 空/已排 badge + 饱和系数 badge（`saturation !== 1` 时显示 ×0.7 / ×0.45）+ `<select>`（「暂不排」+ 5 类）+ 该槽当前口径数字，一律取 `slot.quote`（空槽为 null 时显示「—」）。**不要用 `options` 回填**：`options` 是「该槽若排同类下一个」的口径，同槽已有同类时会把下一档数字当成当前档。未解锁项 `disabled` 且 label 带「（未解锁）」；已排但门槛已不满足的仍保留为可选项，卡下加一行「当前已排，但门槛已不满足」（以后端 `unlockReason` 为准）。
- 活动目录：5 张 `.vop-act` 卡，全部取 `activities[]`（含 `unlocked` 与 `requirements` 的具体原因；`activities[]` 里还有 `idle` 供保存校验，UI 过滤 `key === 'idle'`，只渲染 5 张）；点击已解锁卡 = 填第一个空槽，无空槽 toast「先把某个档位改成暂不排」。
- sticky 结算条：用 `useVenuePreview` 的 `totals` 显示预期毛收入 / 运营成本 / 草皮 / 净额 / 下 5 场乘数 / 声望 + `已排 N/M`；预览加载中保留上一份并显示小 spinner；预览失败时显示「预期数字暂时算不出，保存仍可用服务端校验」，不阻断保存。保存按钮在 `hasChanges === false`、无窗、`useOpsGate('consumption')` blocked 时 disabled 并给 title 原因；保存成功 toast + `setDraft({})` + invalidate；失败**保留 draft**，把 `ApiError.message` 落到页内 `.vop-error`（门槛文案由服务端给，前端不硬编码等级判断）。
- 样式：`web/src/styles.css:7902` 之后追加，只用 `.vop-` 前缀（`.vop-page/.vop-banner/.vop-policies/.vop-policy/.vop-slots/.vop-slot/.vop-acts/.vop-act/.vop-summary/.vop-error`）；栅格 `repeat(auto-fill,minmax(240px,1fr))`，≤640px 单列；`select { width:100%; min-width:0 }`；375 宽不得横向滚动。

### 5.5 通知落点

`web/src/lib/notify-links.ts:36-41` 的 `notificationLink` 里，在 `categoryOf` 守卫之后、`switch` 之前加：

```ts
if (template === 'venue_window_open' || template === 'venue_slot_reminder') return '/venue';
```

**不要**改 `case 'window'`（会把 `window_signals` / `sea_*` 一起带去 /venue）。前提是两条模板已进 `NOTIFY_META`（`src/core/notify-meta.ts:43`），否则 `categoryOf` 返回 null、落点直接 null。

---

## 6. 通知与运营

### 6.1 两条模板

| key | 文案 | data | 触发点 |
|---|---|---|---|
| `venue_window_open` | `【场馆开窗】S{season} 第 {windowSeq} 窗已开，本窗有 {slots} 个档位可排，去「场馆经营」页安排。` | `{season, windowSeq, slots}` | `openWindow` 批成功后（§4.4） |
| `venue_slot_reminder` | `【档期提醒】S{season} 第 {windowSeq} 窗约 {hoursLeft} 小时后关闭，你还有 {remain} 个档位没排（已排 {booked}/{slots}）。` | `{season, windowSeq, slots, booked, hoursLeft, remain}` | `runVenueReminderTick`（§6.2） |

- `src/core/notify-meta.ts:43`（`NOTIFY_META` 起点；`:42` 是注释、`:41` 是空行）加两条，`label` 4 字、`category: 'window'`；`:42` 的注释「33 个模板」顺手改成 39。**`src/core/notify-meta.test.ts` 有四处硬编码 37 必须改 39**：`:35 templates`、`:42 labels`、`:101 members`、`:102 Set(members).size`。`expected` 类目字面量表（`:60-100`）里的 `window` 数组（现 5 条：`window_signals`/`sea_sealed_lead`/`sea_sealed_lost`/`sea_batch_open`/`sea_sealed_deadline`）补两条新模板；不同步必红。只有 `:37` 的 parity 断言不写数字、自动成立——别把它算成已覆盖。
- `renderNotification`（`src/worker/notify.ts:40`）两个 case 走 `data.*` 拼文本；默认分支仍是 `data.text` 兜底。

### 6.2 关窗提醒 `runVenueReminderTick(env, now?)`

新文件 `src/worker/venue-reminders.ts`，返回 `{ sent: number; skipped: number; failed: number }`。

1. 用新增的 `getVenueWindow(db)` 取唯一 `status='open'` 的窗（§2 的唯一索引保证至多一条）：`SELECT season, window_seq, opened_at, venue_reminder_at FROM season_windows WHERE status='open' ORDER BY season DESC, window_seq DESC LIMIT 1`。**不要**改 `getOpenWindow`（`src/worker/seasons.ts:29-37` 只返回 season/window_seq，被多处调用）。
2. `closeAtMs = openedAt + window_length_hours × 3600_000`（`src/core/config.ts` 新键，默认 168）；`openedAt` 为空 ⇒ 本次跳过。
3. `threshold = min(24h, (closeAtMs − openedAtMs) / 3)`；`remaining = closeAtMs − now`。
4. 只在 `0 < remaining <= threshold` 且 `season_windows.venue_reminder_at = ''` 时执行。
5. 收件人：`SELECT c.id, COALESCE(s.capacity, 0) AS capacity, COUNT(b.id) AS booked FROM clubs c LEFT JOIN stadiums s ON s.club_id = c.id LEFT JOIN venue_bookings b ON b.club_id = c.id AND b.season = ? AND b.window_seq = ? WHERE c.status = 'active' GROUP BY c.id, s.capacity`，只给 `booked < slotsForCapacity(capacity, slotCap)` 的队发（无 stadium 行按 2 槽）。
6. 发完 `UPDATE season_windows SET venue_reminder_at = ? WHERE season = ? AND window_seq = ? AND venue_reminder_at = ''`。**即使 `queueClubNotification` 返回 0 也标记已提醒**（否则每 5 分钟重发）；代价是极端失败会漏一条，可接受。若 `changes() = 0`，说明别的 tick 已标记，计入 `skipped`。
7. 调用点：`src/worker/index.ts` 的 `runSettleTick`（`:187`）里、`dispatchPendingNotifications`（`:196`）之前，整段 try/catch，失败只记 `{error}`，绝不阻断结算；**不**并入 `tickChanged`（`:227-243`），避免只发提醒也触发公开缓存清理。

### 6.3 去重与失败语义

- 开窗通知靠「`openWindow` 成功一次」天然去重（重复调用在 `:82-85` 或 UNIQUE 上 409，不会走到通知）。
- 关窗提醒靠 `venue_reminder_at`。
- 两条通知都走 `queueClubNotification` 现有双通道（web 行 `status='sent'` + qq 行 `status='pending'`）。QQ 模板白名单在 AstrBot 侧跨仓维护，本地无法证实（设计 §10.2），列为 §9 R6。

---

## 7. 测试与验收

### 7.1 命令（逐条可复制）

```bash
# 1) 类型（三份 tsconfig）
npm run typecheck

# 2) 全量单测（Vitest；新增迁移后空库路径靠它覆盖）
npm test

# 3) 新增/改动的单测单跑（迭代用）
npx vitest run tests/venue-slots-migration.test.ts tests/venue-core.test.ts tests/venue-ops.test.ts \
  tests/home.test.ts tests/window-machine.test.ts tests/venue-reminder.test.ts \
  tests/notify.test.ts tests/season-settle.test.ts tests/event-ops.test.ts \
  tests/ops-schedule.test.ts tests/naming-tiers.test.ts

# 4) 构建（前端改动必须 build 才进 web/dist）
npm run build

# 5) 本地 D1 存量库升级（当前本地账本末项实测为 0077）
npm run db:migrate:local        # 再跑一次应报无待应用迁移

# 6) e2e（需先 build，且另开终端 npm run dev 起 8791）
npm run test:e2e
E2E_ONLY=㉓ npm run test:e2e    # 只跑新场景（E2E_ONLY 开关见 scripts/e2e/smoke.mjs:171）

# 7) 经济模型（只读、无 DB；§7.4 第 7 条的 109.24 口径）
node scripts/venue/cadence-model.mjs --esports=off
```

> 本轮**未运行**上述 1–6 的任何 `npm` 命令（HARD GATE 未解除，且 0078 文件尚不存在）。所有 `npm test` / `npm run typecheck` / `npm run build` / `npm run test:e2e` 结论均为「待实施后验证」，不得写成已通过。第 7 条模型本轮只读复跑过，输出 `incomeLeague=54.62`/窗（见 §3.3），不是测试通过。

### 7.2 单测断言（照抄即用）

`tests/venue-core.test.ts`（新建，锁公式）：

- `slotsForCapacity`：`(14999,4)=2`、`(15000,4)=3`、`(29999,4)=3`、`(30000,4)=4`、`(35000,2)=2`（上限生效）、`(12000,0)=0`、`(0,4)=2`、`(null,4)=2`。
- `satMultAt`：`[1, 0.7, 0.45, 0.45, 0.45]`（下标 0..4）。
- 单槽**预期**净额（`expectedDamage=0.525`）：35000 演唱 `gross 5.25 / opsCost 0.975 / expectedDamage 0.525 / expectedNet 3.75`；22000 `3.3 / 0.715 / 0.525 / 2.06`；17000 `2.55 / 0.615 / 0.525 / 1.41`；12000 `1.8 / 0.515 / 0.525 / 0.76`；电竞 35000 `2.8 / 0.65 / 0 / 2.15`、12000 `0.96 / 0.42 / 0 / 0.54`；青训 `0.7`；开放日 `0.2`；企业日 rep=20 `0.63`、rep=100 `1.35`。
- 单槽**实际**掷点（与预期分开）：35000 演唱 `rolls={income:0.5, damage:0.5, damageRoll:0}` ⇒ `damage 3.5 / net 0.775`；`damageRoll:0.99` ⇒ `damage 0 / net 4.275`；两种都 `expectedDamage 0.525 / expectedNet 3.75`。**不要**再用一个 `damage` 值同时断言「实际」和「期望」。
- `quotePlan`：35000 排 4 演唱 ⇒ 逐槽 `expectedNet` `3.75 / 2.175 / 0.8625 / 0.8625`，合计 `7.65`；`capacity=35000` 排 `2 演唱 + 2 电竞` 合计 ≈ `9.385`；`attendanceMod` 两档 `open_day + youth_camp` ⇒ `1.005 × 1.007 = 1.012035` → `1.012`（round3）。
- `activityUnlockReason`：broadcast 0 级 + 电竞 ⇒ 含 `转播设施 L2（当前 L0）`；reputation 12 + 企业日 ⇒ 含 `声望 ≥20（当前 12）`；已解锁 ⇒ `null`。
- `validateActivityConfig`：未知键 / 负值 / `requires_level: 9` / `income_max < income_min` / `fillRate: 1.5` / `fillRate: -0.1` 各返回非 null；默认 JSON 返回 null；旧 `income_min/max` 返回 null（合法 legacy）。
- `parse/quote legacy_range`：`{income_min:3, income_max:8}` + `rolls.income=0.5` ⇒ gross `5.5`；换 roll 必须变（`0` ⇒ 3、`1` ⇒ 8），证明不是 flat 中点；`legacyKeys` 含该键。
- `recommendPlan`：`capacity=35000, slots=4, broadcast=2, youth=1, commercial=1, rep=20` ⇒ `money` 预期净额合计 ≈ `9.385`（4 演唱只有 7.65）；`fans` 首选 `youth_camp`（P0 全 `fansDelta=0`，1.007 > 1.005）；给合成 def 设 `fansDelta=1` 时 `fans` 改选它（锁住 P1 口径）；`reputation` 首选 `corporate`（3 点，未锁定）。

`tests/venue-ops.test.ts`（改写，`seedClub` 的 `capacity=20000` 现在派生 3 槽）：

- 现有断言重算：`:170-175` 的越界文案 `1-2` 改 `1-3`（`seedClub` capacity=20000 ⇒ 3 槽）；`:184` 的 `slots` 改 `slotCap`；`:179-184` 的 `activity_slots=1` 用例改断言「上限压过派生」（`slotCap=1 ⇒ 1 槽`）。**`:236-250` 幂等用例整段重写**：旧断言 `again.income`（`:247`）/`again.extraMaintenance`（`:248`）/`again.slots`（`:249`）与 `:288` 的 `toEqual({ statements: [], income: 0, extraMaintenance: 0 })` 都引用已删除字段，改成新返回 `{ statements, gross, opsCost, damage, net, reputationGain, attendMod, bookings }` 的对应字段；`:302` 的 `slots: 2` 在待删的旧路由 describe（`:292-348`）里，随该段一并改成新 GET 的 `slotCount === 3`。
- **`:275-277` 的 `activityTotal` 断言必须重算**：新口径 `summary.activityTotal = SUM(kind='activity') − SUM(kind='maintenance' ref_type='booking_ops') − SUM(kind='maintenance' ref_type='booking')`，不再等于 `activityTotal + damageTotal`；同时新增 `summary.activityOpsCost` 断言。这个断言在 `tests/venue-ops.test.ts`，**不在** `tests/home.test.ts`。
- **整块替换，不逐行挑**：`tests/venue-ops.test.ts:11` 的 `activityIncome` 旧导入（删函数后必 TS2305）；`:120-159` 有一整个 `describe('活动结算口径（activityIncome，插件 formula.activity_income）')` 直接调用 `activityIncome` 约 10 次（`RANGE_MIN`/`RANGE_MAX`/`damageRoll` 等旧入参），必须按 `venueQuote` 新签名整段重写或删除，**不能只删 import**（否则未定义标识符，typecheck 与 vitest 双红）；`:212`/`:243`/`:245` 的 6 参 `windowActivityStatements(..., { pitch: 0, youth: 0 })`、`:287` 的 `bookingSettlement(fx.env, row!, cat, 0, 0)` 旧签名（改签名后必 TS2554）按 §4.2 整体替换。`activityIncome` 的另一处真实调用在 `tests/naming-tiers.test.ts`（TC-BUFF-01）。
- 新增：35000 排 4 演唱的逐槽 `expectedNet` 依次 `3.75 / 2.175 / 0.8625 / 0.8625`（若饱和错作用在净额上会得 7.34 而不是 7.65）；`capacity=35000` 排 `2 演唱 + 2 电竞` 合计 ≈ 9.385。
- 新增：`capacity=12000` 的队排电竞 ⇒ 400 且文案含 `转播设施 L2`；排企业日且声望 12 ⇒ 400 且含 `声望 ≥20`。
- 新增：一档结算后 `SELECT kind, ref_type, amount FROM ledger_entries WHERE ref_id = <bookingId>` 恰好三行 `(activity,booking,+gross)`、`(maintenance,booking,−damage)`、`(maintenance,booking_ops,−opsCost)`；列名是 `amount`（`0001_init.sql:194`，**没有 `delta`**），前两行 `ref_type` 都是 `booking`，**不要**断言 `ref_type` 唯一，改断言 `COUNT(*) = 3` 且三个 `(kind, ref_type)` 组合齐全。
- `tests/venue-ops.test.ts:292-348` 的 `describe('教练端档期路由（/api/club/bookings）')` 整段打的是本轮删除的 GET/POST 路由（`:299`/`:307` 起），保留必 404：随 §4.5 删除同步改写为 `GET/PUT /club/venue-plan` + `POST /preview` 三条用例，或整段删除后由下面的新端点用例覆盖。
- 新增：`GET /api/club/venue-plan` 在 `capacity=20000` 返回 `slotCount === 3`、`slotCap === 4`、`activities.length === 6`（含 idle）、`slots.length === 3`；`PUT` 越界 `slotNo=4` ⇒ 400 文案含 `1-3`；无 stadium 行 ⇒ `capacity:0 / hasStadium:false / slotCount:2`。
- 新增：`POST /preview` 排 4 演唱返回 `totals.expectedNet 7.65`（不是逐槽 options 相加的 15.00）；body 不变时 GET 与 preview 对同一 picks 的合计一致。

`tests/home.test.ts`（`:293-337`、`:619`）：

- `maintenanceTotal`（`:296` 的 3.6）不变（基础维护费口径没动）；`activityTotal` 改为净现金口径后重算；`summary.activityOpsCost` 有值。**精确的 `activityTotal` 账本断言放 `tests/venue-ops.test.ts:275-277`**，这里只断言字段存在与大于 0。
- 新增幂等：`windowHomeStatements` 连跑两次（`:315` 已有先例）后 `SELECT COUNT(*) FROM venue_window_settlements` 仍为 1，`venue_reputation` 不二次加、`attendance_mod_matches` 不二次置 5。
- 新增 K=5：`attendance_mod_matches=5`、`next_attendance_mod=0.95`，连续 5 次主场消费后回到 `1 / 0`，中途每场 −1；`(K=0, mod=1.5)` 一场后回 `1 / 0`（锁死 `tests/event-ops.test.ts:1002-1015` 的既有语义）。
- 新增事件预置 + 活动同窗：`(K=0, mod=1.5)` + 活动 0.95 ⇒ 关窗后 `mod=1.425 / K=0`；下一场后 `1 / 0`（不得置 5）。
- 新增多档乘数：`open_day + youth_camp` 同窗 ⇒ 关窗后 `next_attendance_mod=1.012`、`attendance_mod_matches=5`（两次 UPDATE 只发生一次，按聚合值写）。

`tests/venue-slots-migration.test.ts`（新建）：四列存在且默认值正确；CHECK 四边（声望 >100 / <0、matches <0、`venue_policy` 非法枚举）都抛；回填写 0 行（存量 `next_attendance_mod<>1` 的 K 保持 0，事件预置不被延长）；`idx_season_windows_open` 拒绝第 2 个 open 窗但允许多个 closed；`ops_schedule.consumption` 迁移后 `start_anchor='window_open'`、`end_anchor='window_close'`、`requires_window=1`；**「先改成 absolute 再跑迁移不覆盖」必须停在 0077**：`applyMigrations(sqlite, '0077_growth_nongrowable_reset.sql')`（`tests/d1.ts:161` 的 upTo 语义）→ seed `consumption` 行并改成 `absolute` → `runMigration(sqlite, '0078_venue_slots_p0.sql')`；`runMigration` 是整文件 `exec`（`tests/d1.ts:173-176`），对已含 0078 列的库重跑会在第 2 条 `ALTER` 报 `duplicate column name`，永远到不了第 ⑨ 条 UPDATE。既有 `tests/contract-ticks.test.ts:79-82` 同时 seed 两条 `status='open'`（season2 W2 + 临时 W3），建 `idx_season_windows_open` 后该夹具必 UNIQUE 失败——把临时窗改成 `closed` 是必要配合，不改业务代码。全量扫过 `tests/*.ts`，`seedWindows` 一次 seed 两条 open 的只有这一处；其余文件若在 `npm test` 里冒出同类冲突，按同一办法「先关旧窗再开新窗」修夹具。`applyMigrations(sqlite)` 空库不抛。

`tests/window-machine.test.ts`：对已无窗的 season 开窗 ⇒ `venueReset === true` 且 `stadiums` 回到 `1 / 0`；该 season 第二窗 ⇒ 不重置；开窗通知失败（mock `queueClubNotification` 抛错）⇒ 仍返回 `ok`、`season_windows` 已 open。
- **P0 ⑧ 原子性**：在测试库建 `CREATE TRIGGER fail_open BEFORE INSERT ON season_windows BEGIN SELECT RAISE(ABORT,'boom'); END;`，调用 `openWindow` 期望抛错，随后 `SELECT agent_tier FROM players` 与调用前逐行相同（重掷已回滚）；删除 trigger 后重跑成功且 `rerolled` 有值。
- 并发：两条 `openWindow` 串行模拟（第一条成功、第二条 409）⇒ `season_windows` 只有 1 个 open；失败那条不改 `players.agent_tier`。

`tests/venue-reminder.test.ts`（新建）：`window_length_hours=6` 造「2h 后关窗」⇒ 只给 `booked < slots` 的队发；无 stadium 行的队按 2 槽判断；`venue_reminder_at` 写后重跑不重发；`tickChanged` 输出不受影响。

`tests/notify.test.ts` / `src/core/notify-meta.test.ts`：两个模板渲染文本；模板数 37 → 39；labels 37 → 39。

`web/src/lib/notify-links.test.ts`（既有文件追加）：`venue_window_open`/`venue_slot_reminder` ⇒ `/venue`；`window_signals` 仍 ⇒ `/clubs/{id}?tab=desk`（锁住「不改 `case 'window'`」）。

`tests/season-settle.test.ts`：有声望队结算一次 ⇒ `venue_reputation` ×0.9；**无声望队（rep=0）首次结算仍发 `naming_champion`**（批尾 stadium UPDATE changes=0，但 `seasonsIdx` 读到的是 seasons 翻转=1）；重跑结算不再衰减、不重发。

`tests/event-ops.test.ts`：
- 赠档在 `broadcast=0` 时排电竞 ⇒ 不写 `venue_bookings`，note 含 `转播设施 L2`；`broadcast=2` 时正常赠档。
- 同批两队容量 12000/35000 ⇒ 赠档分别落在 2 槽/4 槽范围内（用 `ctx.stadium.capacity`，不是批级 `ec.capacity`）。
- `:1002-1015` 的事件预置一场即清保持绿。

`tests/naming-tiers.test.ts`：`:17` 的 `activityIncome` import 改 `venueQuote`（或 `activityQuote`）；`:429-436` 的 TC-BUFF-01（断言 `:434-435`）改为 `venueQuote(def, ctx, 1, rolls)` vs `venueQuote(def, {...ctx, attendBuff:0.02}, 1, rolls)`，断言 `buffed.gross === base.gross * 1.02`、`expectedDamage` 不变。同时 `:430` 的 `def` 字面量要补成新键（`pricePerSeat`/`fillRate`/`costBase`/`costPerSeat`/`damageProb`…）并去掉 `def as never` 强转：旧字面量只有 `incomeMin/incomeMax/pitchDamageProb/income`，新公式读 `pricePerSeat/fillRate` 会得 `NaN`，而 `as never` 让 typecheck 看不见，失败只出现在 vitest 里、容易被误判成公式写错。**删旧函数前先改这个测试**，否则 typecheck 红。

`tests/ops-schedule.test.ts`（`:195`/`:213` 两条断言必须改写，否则 0078 改锚后必红）：`:195` 由「11 行全部双 none」改为「`consumption` 行 = `('window_open','window_close')`、其余 10 行仍双 none」；`:213` 由「全部 `unrestricted`/不限制」改为「`consumption` 行 `state='open'`/`进行中`（`seedWorld` 有开窗，`view.window.openedAt='2026-07-01T00:00:00Z'`）、其余 10 行仍 `unrestricted`/不限制」；另补一例无开窗（不 seed 窗或关窗后）⇒ `consumption` 行 `state='closed'`/`已结束`、`opBlockReason('consumption')` 非 null。判定逻辑在 `src/core/ops-schedule.ts:79-100`（双 none 才 unrestricted，随窗锚无开窗一律 closed）。

`web/src/pages/venue/venue-preview.test.ts`（新建）：`draftToPicks` 把未改的槽还原为 `slot.booked`、`null` 明确清空；`diffDraft` 只出改动槽；恢复原值后 `samePicks === true`；不再有 `composeTotals` 可测。

`web/src/pages/venue/VenuePlanPage.test.tsx`（新建，`// @vitest-environment jsdom`，照 `venueCards.test.tsx` 的 `vi.mock` + `QueryClientProvider(retry:false)` + `MemoryRouter` 范式）：3 槽渲染、未解锁 `disabled` + title、无窗保存 disabled、改单后 `apiPut` body 只含改动槽、保存失败 draft 仍在、preview 请求带完整 picks 且防抖只发一次、preview 失败时页面仍可保存。另补 §7.4 第 10 条的两条断言：点「按此方针排满」后 draft 覆盖全部槽（保存时 `apiPut` body 的槽数 = `slots.length`）、`hasStadium=false` 时显示「未建球场，按 2 档试排」（e2e ㉓ 只断言 `.vop-policy` 数量为 3，不覆盖点击行为）。

### 7.3 e2e

- `scripts/e2e/smoke.mjs:2240` 的 `ROUTES`（375 溢出扫描）加 `'/venue'`。
- `:2979` 的 ⑱ 断言改为「消费中心有设施经营/冠名市场、**没有**球场档期」；`:3064` 的 `text().includes('消费中心')` 依赖 `VenueTab.tsx:125` 原链接文案不变（§5.1 已规定保留原文案、只新增一条）。
- 文件末尾新增一例：**最后一个 `check(` 是 `:3566` 的「④ 强制拍卖人选解禁 + 品牌池全虚构化扩编（v6.51.0）」**，不是 `:3456` 的 ㉒；新场景插在 `:3566` 之后，编号取 ㉓（顺序编号最大 +1）。mock `GET /api/club/venue-plan` 返回固定 fixture、`POST /api/club/venue-plan/preview` 返回与 fixture 一致的 `totals`（照 `:1967-1985` 的 `page.route` + `ok19` 写法，**不需要真实开窗**），断言 `.vop-slot` 数 ∈ {2,3,4} 且等于 fixture 的 `slots.length`、`.vop-policy` = 3、`.vop-act` = 5、375 无横向溢出、无窗时保存 disabled、改一槽后 sticky 条用 preview 的 `totals`（不等于逐槽 options 相加）。

### 7.4 P0 验收清单（设计 §九 ⑨ 六条 + 本期补充）

全部在 HARD GATE 解除后执行；每条都要能指到具体 SQL / 命令的输出。

1. 真实开一扇窗、关一扇窗后 `SELECT * FROM audit_log WHERE action IN ('window_open','window_close') ORDER BY id DESC` 有对应行，`after.venueReset` / `after.rerolled` 可读；**`venueNotified` 不在 audit 里**，改读 `openWindow` 返回值与 `notifications` 表中 `template='venue_window_open' AND created_at >= :opened_at` 的行数（`notifications` 无 season/window 列，必须带时间下界，否则会把上一窗的通知算进来）。
2. `GET /api/club/venue-plan` 在开窗 / 闭窗两种状态都 200，字段与 §4.5 契约逐项对齐（`window` 可为 null）；由 `tests/venue-ops.test.ts` 的 `expect(Object.keys(body).sort()).toEqual([…契约字段])` 锁住（否则只能人工对读）；`POST /preview` 不需要开窗、200、不写库（前后 `SELECT COUNT(*) FROM venue_bookings` 不变）。
3. **ops_schedule 闸生效**：开窗后 `SELECT start_anchor,end_anchor FROM ops_schedule WHERE op_key='consumption'` = `window_open/window_close`；`opBlockReason('consumption')` 为 `null`（`opsStateLabel='进行中'`）；关窗后同一查询返回非 null（`已结束`）；关窗后 `PUT /api/club/venue-plan` 409（先命中 `isWindowOpen`，文案不变；`bookSlot` 已无 HTTP 入口，别写 curl）。
4. 连续两次 `openWindow` 第二次被拒（`有一个窗口开着` 或 UNIQUE 触发的 409），`SELECT COUNT(*) FROM season_windows WHERE status='open'` = 1；失败那条**不得**改 `players.agent_tier`（P0 ⑧）。真实并发由 `idx_season_windows_open` 兜底；测试库单连接，`tests/window-machine.test.ts` 用「串行第二次 + trigger 中止回滚」两条用例覆盖，不要求复现真并发。
5. 至少一队真实排档后关窗：`SELECT kind, ref_type, amount, memo FROM ledger_entries WHERE ref_type IN ('booking','booking_ops')`（列名 `amount`，没有 `delta`）每档可见三条（收入 / 草皮 / 运营成本）；`venue_window_settlements` 有该队一行。
6. 设施 0 级被拒且返回所需等级：`PUT /api/club/venue-plan` 排电竞 ⇒ 400 文案含 `转播设施 L2`；`stadiums.next_attendance_mod` 在下一场主场后仍按 K 递减——读 `next_attendance_mod` 与 `attendance_mod_matches` 两列（**没有 `demand` 字段**；单场上座还受天气/随机影响，别用上座数判断），`attendance_mod_matches` 每场 −1、5 场后回 `1 / 0`；事件预置（K=0）仍一场即清。
7. **C2 经济基线**：`node scripts/venue/cadence-model.mjs --esports=off` 的 O1 `incomeLeague` ×2 = 109.24（±0.01）；按档两窗合计 35000 13.24 / 22000 7.02 / 17000 5.29 / 12000 2.99。脚本已入版本库 `scripts/venue/cadence-model.mjs`（`scratch/` 被 `.gitignore:11` 忽略，实现轮已复制）。模型是经济验收入口；§7.2 的 3.75/2.06/... 是公式单测，两者都要绿。
8. 生产只读回读（apply 后）：§2.4 六条断言全中；`SELECT COUNT(*) FROM stadiums WHERE next_attendance_mod <> 1 AND attendance_mod_matches <> 0` = 0（存量事件预置仍是 K=0）。
9. **采纳率是观察指标，不是发布门槛**：`SELECT (SELECT COUNT(DISTINCT club_id) FROM venue_bookings WHERE season=:s AND window_seq=:w) AS booked_clubs, (SELECT COUNT(*) FROM club_bindings) AS human_clubs;` 记录实际值；设计 Q8-2 写的是「待拍板」，不设 `≥50%` 硬门槛。
10. 前端：`VenuePlanPage.test.tsx` 用四份 fixture（`slots.length` 2/3/3/4，容量 12000/17000/22000/35000）断言分别渲染 2/3/3/4 个 `.vop-slot`，e2e ㉓ 只保一个 fixture；`hasStadium=false` 断言文案「未建球场，按 2 档试排」；三张方针卡能填满槽位；保存失败 draft 不清空；无窗时保存按钮 `disabled` **且 `title` 含「当前没有进行中的转会窗」**（与 `hasChanges === false` 的 disabled 区分开）；消费中心不再有「球场档期」；通知点进来落到 `/venue`；375 无横向滚动。

---

## 8. 实施顺序（三批，每批可独立验收）

改造面横跨 core / worker / web，按「纯逻辑与数据 → 服务端 → 前端」切，避免中途出现「后端换了形状、前端还在读旧 shape」的假绿。每批结束都可以单独跑该批的验收命令；批次之间不要求生产可用（P0 对外只暴露一次）。

### 第 1 批 · 地基（迁移 + 纯逻辑 + 配置默认）

1. `src/db/migrations/0078_venue_slots_p0.sql`（§2.2，含第 ⑨ 条 ops 锚点）+ `tests/d1.ts:161` 登记。
2. `src/core/venue.ts`（§4.1）。
3. `src/core/config.ts`：`activity_config` 新默认、`activity_slots: '4'`、新增 `window_length_hours: '168'` 并进白名单（§3）。
4. 新测：`tests/venue-slots-migration.test.ts`、`tests/venue-core.test.ts`。

**独立验收点**：`npm run db:migrate:local` 两次（第一次 Applied 0078、第二次无待应用）；`npx vitest run tests/venue-slots-migration.test.ts tests/venue-core.test.ts` 全绿；`npm run typecheck` 绿。此时业务行为**零变化**（新列无人读、`activity_config` 新默认尚未被新代码消费、ops 锚点只影响尚未调用的 `assertOpOpen` 语义）。

### 第 2 批 · 服务端结算与接口

5. `src/worker/venue-ops.ts` 重写（§4.2）。
6. `src/worker/home.ts`（§4.3）、`src/worker/event-ops.ts`（§4.6 的 `ctx.stadium.capacity`、`venue_reputation`、赠档闸）。
7. `src/worker/window-machine.ts`（§4.4，含重掷并批）、`src/worker/season-settle.ts`（§4.6，索引修正）。
8. `src/worker/notify.ts` + `src/core/notify-meta.ts` + 新建 `src/worker/venue-reminders.ts` + `src/worker/index.ts` 接线（§6）。
9. `src/worker/routes/clubs.ts` 换成 `GET/PUT /club/venue-plan` + `POST /preview`（§4.5）；admin config 语义校验。
10. 改既有测试 + 新测：`tests/venue-ops.test.ts`、`tests/home.test.ts`、`tests/window-machine.test.ts`、`tests/venue-reminder.test.ts`、`tests/notify.test.ts`、`src/core/notify-meta.test.ts`、`tests/season-settle.test.ts`、`tests/event-ops.test.ts`、`tests/event-choice.test.ts`、`tests/market-rounds.test.ts`、`tests/naming-tiers.test.ts`、`tests/ops-schedule.test.ts`；另把 `tests/contract-ticks.test.ts:79-82` 的两条 open 窗夹具改成「一条 open + 一条 closed」（配合 `idx_season_windows_open`，不改业务代码）。

**独立验收点**：§7.1 的第 3 条命令全绿 + `npm run typecheck`。此时 API 已是新形状，前端 `/shop` 的旧 `BookingsCard` 会 404 —— 所以第 2 批与第 3 批必须**同一次部署**发布（本计划分 3 批只是施工顺序，不是发版节奏）。

### 第 3 批 · 前端、e2e 与文档

11. `web/src/lib/api.ts` 类型、`web/src/lib/queries.ts` 查询与 preview hook（§5.2）。
12. 新建 `web/src/pages/venue/venue-preview.ts`、`VenuePlanPage.tsx`、`(+venue-plan-parts.tsx)`、两个测试文件（§5.3、§5.4）。
13. `web/src/App.tsx`、`Home.tsx`、`club/VenueTab.tsx` 三处入口（§5.1）。
14. 删除 `ShopPage`/`venueCards.tsx` 的 `BookingsCard`（§5.1）；`styles.css` 追加 `.vop-*`。
15. `web/src/lib/notify-links.ts`（§5.5）；在**既有** `web/src/lib/notify-links.test.ts` 的矩阵里追加两条正例（`venue_window_open`/`venue_slot_reminder` ⇒ `/venue`）与一条反例（`window_signals` 仍 ⇒ `/clubs/{id}?tab=desk`），不新建测试文件。
16. e2e：ROUTES、⑱、新场景 ㉓（§7.3）。
17. 文档：§12。

**独立验收点**：`npm run build` 成功且产物有 `VenuePlanPage` 独立 chunk；`npm test` 全绿；`npm run test:e2e` 全绿（⑫ 375 扫描含 `/venue`）；手工按 §7.4 第 10 条过一遍。

---

## 9. 风险与开放问题（每条给出默认处理方式）

| # | 风险 / 未决 | 默认处理（照做，不再询问） | 失效条件（先写出它会怎样坏） |
|---|---|---|---|
| R1 | 生产 `season_windows` 若已有 ≥2 个 `open` 行，0078 第 1 条索引直接失败 | apply 前跑 §2.4 第一条；>1 行则**先人工关掉多出来的窗**（走 `POST /api/admin/windows/close`），再 apply。若确实需要两窗并存则整枚迁移重排（把索引挪到 0079） | 只读检查跳过 ⇒ 迁移在第一条炸，本地 `Extant` 无变化但生产 apply 窗口被浪费 |
| R2 | 生产 `config` 表里若存在显式 `activity_slots='2'` / 旧 `activity_config`，新默认不会生效 | 迁移**不覆盖** config（那是运营数据）。§2.4 第三条只读回读；旧 `activity_config` 按 §3.1 的 `legacy_range` **保留旧经济**并让 `configWarning`/管理端提示；要切 Plan A 必须由运营在管理端改成 `4` / 新 JSON。若 `legacyKeys` 非空就上线，视为发布阻断 | 没查就上线 ⇒ 旧经济继续跑、Plan A 静默失效，且报表看起来「正常」；`legacy_range` 至少不会把旧数悄悄改成中点 |
| R3 | 「上座乘数写 5 场」与随机事件的一场性效果共用 `next_attendance_mod` / `attendance_mod_matches` | 已改：`K=0, mod≠1` 视为事件预置，活动结算只乘 mod、**不置 K**（SQL 的 `CASE WHEN attendance_mod_matches = 0 AND next_attendance_mod <> 1 THEN 0`）；事件预置仍一场即清。活动 5 场效果在「事件+活动」同窗时会被那一场一起清掉，页脚注写「与一次性事件叠加时以事件为准」 | 若运营反馈活动效果被事件吞掉：P1 加 `pending_event_mod` 独立列，本期不做 |
| R4 | 企业日声望门槛 ≥20 按每窗 +2~3 点要 2–3 季才到 | 保持 20（锁定决策 6）。试点窗文案注明「企业日需累积声望」 | 试点窗无人能排企业日 ⇒ 只影响一个活动，不影响其余五类 |
| R5 | 设施全 0：试点窗 18 队里电竞/青训/企业日全部锁死，只剩演唱会/开放日 | 保持锁定（这就是 P0 要验证的门槛）。是否发升级券/预置等级属运营决策，不在本计划 | 采纳率（§7.4 第 9 条）是观察值，不是门槛；若低于 50% 先看是不是「只剩 2 类活动」导致，不开硬闸 |
| R6 | 两条通知走 QQ 通道，AstrBot 侧模板白名单跨仓无法本地证实 | 保持双通道（`queueClubNotification` 不加 options）；若线上 QQ 侧静默丢弃，只影响 QQ，站内信仍到 | 若出现「QQ 收到空白/默认文案」，再决定加 `webOnly` 参数 |
| R7 | 推荐/预览用 `expectedNet`（草皮按期望扣），关窗结算用种子实际掷点；单槽最多差约 4.5m（实际 damage 2–5 对期望 0.525），多槽叠加更大 | 接受期望口径，卡面写「预期」；关窗流水才是准数。`VenueQuote` 同时返回 `damage/expectedDamage`，两个口径不混 | 玩家投诉「推荐值与实收不符」时，改成按种子复算（会引入对 booking 顺序的依赖，不做） |
| R8 | 关窗时刻是 `opened_at + 168h` 的**估计**，运营可能提前关窗 | 提醒文案写「约 N 小时后关闭」；实际以管理端动作为准 | 若运营频繁提前关，提醒会「发早了」，属可接受噪音 |
| R9 | 经纪人重掷并入 `openBatch` 后，批更大；并发失败时整批回滚（包括重掷） | **本期改**：`...statements` 放 `openBatch` 最前；用 `CREATE TRIGGER ... RAISE(ABORT)` 测失败路径，确认 `players.agent_tier` 不变。代价是单批语句数 +最多 90/档×3 档，D1 batch 上限内 | 若出现「开窗成功但重掷丢失」，查 `openBatch` 是否漏了 `...statements`；若出现 batch 过大超时，再改回「先写 reroll 日志、失败补偿」的方案 |
| R10 | `venue_policy` / `city` 两列在 P0 里没有消费方（只存不用） | 加列 + 一个只读/只存的 `PUT /club/venue-plan` 的 `policy` 字段；`city` 本轮**无任何读写入口**（纯预留） | 若评审要求「不加无用列」，删 `city` 一行 DDL 即可（`venue_policy` 必须留，方针卡要用） |
| R11 | 旧 `POST /api/club/bookings` 删除后，任何外部脚本/书签会 404 | 接受（SPA 同版发布，仓内无其它调用方） | 若发现离线脚本调用，改成保留一版返回 410 + 提示 |
| R12 | 改 `consumption` 锚点后，商城/冠名/档期一起进窗（`market-ops.ts:619`、`naming-ops.ts:992/1055`、`venue-ops.ts:241`） | 这是设计 §九⑥ 的明确要求，照做。运营若要在窗内暂停档期，管理端把 `consumption` 临时改回双 none（不改代码）；P1 再开 `venue_booking` 独立 op_key | 若出现「关窗后教练无法买设施/冠名」的集中投诉，先把 `consumption` 锚点回滚为 none（§11），再评估拆 op_key |
| R13 | `POST /preview` 每次改单一次请求，4 槽 × 6 活动也最多 4 次/秒 | 250ms 防抖 + `placeholderData` 保留上一份；服务端只读、无 DB 写、按 `clubId` 走内存鉴权 | 若 D1 读量成为问题，改为 GET 返回 `options[].expectedNetByOrdinal` 的离线表（本期不做） |
| R14 | 生产 `ops_schedule.consumption` 可能已被运营改成非双 none | 0078 第 ⑨ 条的 `WHERE` 只改双 none；§2.4 预检会显示实际锚点；非双 none 时**不覆盖**，由运营确认 | 若生产是 `absolute` 且运营希望保留，P0 ⑥ 的验收②要按实际配置解释；不要为了过验收强行改运营数据 |

**已从「开放问题」升级为「裁决」的条目**：草皮与成本是否重复计费（A5）、饱和按同类序位还是槽序（§3.3 反推验证）、`activity_slots` 去留（A14）、死忠增量（A6，改为 `fans_delta` 预留 + 关窗演化）、`ops_schedule` 是否改锚（A8，改为改锚）、通知模板 key（A10）、方针枚举（A4）、`planned_close_at`（A9）、一键推荐的覆盖语义（§5.4「覆盖本地 draft」）、旧端点下线节奏（A11）。

---

## 10. 明确不做（P1/P2 边界）

**P0 不做（也不在这次迁移里预留半成品）**：

- 顶栏第 9 项（`web/src/pages/Home.tsx:55-82` 的 `.nav-card` 栅格；「360px 装不下」是 Q8-1 的设计约束）
- 前端重算收入 / 槽数 / 门槛；前端实现贪心推荐；前端逐槽加总（一律用 `/preview` 的 `totals`）
- 活动直给死忠增量（A6；`fans_delta` 只进 schema 与推荐排序，P0 全 0）；草皮 condition 展示
- 演出池 `show_pool_id` + 部分唯一索引（P2，留 `0079`）
- 保险（Q11）、暗标、城市分流（Q10c 只加列）
- `season_windows.planned_close_at`、管理端开窗表单改动
- `venue_booking` 独立 op_key（P1；本期用 `consumption` 锚点）
- 新季声望阶梯 / 排行榜（P1）
- 跨窗滚动预订 O6（P1）
- 球员伤停、比赛内效果（编辑器路线，关闭不做）
- 自动开窗 / 自动排期 / 定时任务开关（Q7b=D）

**留给 P1 的最小入口**（本期只保证不挡路）：

- `venue_booking` op_key（若要「窗还开着但只暂停档期预订」）
- `fans_delta` 配置键（已进 schema，默认 0；P1 填数即生效）
- `clubs.city` 的分流规则（列已就位）

---

## 11. 回滚

三层，按代价从低到高：

1. **只回滚代码（首选）**。0078 全是**加列 + 加索引 + 加表 + 有界回填 + 一条 UPDATE**，旧代码读这些表时全部显式列名（`home.ts:334/375/551`、`market-ops.ts:166/301/737`、`naming-ops.ts:592/739/815/1004`、`stadium-ops.ts:27`、`weather-ops.ts:95/460`、`routes/admin/clubs.ts:325/371/433`；`INSERT INTO stadiums` 也显式列名，`routes/admin/clubs.ts:582`），新列吃默认值即可 ⇒ 回滚 Worker 到上一 Version 不会崩。CF Workers Builds 保留上一 Version，回滚 = 重新部署上一 Version（生产操作，须用户下令）。
2. **回滚数据**（不需改 DDL）：
   ```sql
   -- 仅当 0078 第 ⑨ 条确实改过（原双 none）时执行；原非 none 的锚点不要跑这条
   UPDATE ops_schedule
      SET start_anchor = 'none', start_at = NULL,
          end_anchor = 'none', end_at = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE op_key = 'consumption';
   DELETE FROM venue_window_settlements;
   UPDATE stadiums SET attendance_mod_matches = 0;
   UPDATE stadiums SET next_attendance_mod = 1 WHERE next_attendance_mod <> 1;  -- 仅在确认无事件预置待消费时执行
   UPDATE clubs SET venue_policy = '' WHERE venue_policy <> '';
   ```
   注意：回滚数据**不会**撤销已经结算的 `activity` / `maintenance` 流水（账本只增不改，见 `src/worker/ledger.ts` 的审计锁）。要冲正只能再落一条反向流水（不在本期范围）。ops 锚点回滚会同时放行商城/冠名/档期，属预期副作用。
3. **回滚 DDL**（最坏情况，需重建表风险最小的顺序）：
   ```sql
   DROP INDEX IF EXISTS idx_season_windows_open;      -- 恢复「允许两窗并存」的旧行为，先删索引
   DROP TABLE IF EXISTS venue_window_settlements;
   ALTER TABLE clubs    DROP COLUMN city;
   ALTER TABLE clubs    DROP COLUMN venue_policy;
   ALTER TABLE stadiums DROP COLUMN attendance_mod_matches;
   ALTER TABLE stadiums DROP COLUMN venue_reputation;
   ALTER TABLE season_windows DROP COLUMN venue_reminder_at;
   ```
   `DROP COLUMN` 在 SQLite 3.35+ 可用（D1 满足），但**不会**自动删掉依赖该列的 CHECK 约束之外的索引；本迁移没有额外索引落在这些列上，所以这条路径可行。生产执行 DDL 回滚属危险清单外的新操作，必须先请用户确认。
   **`d1_migrations` 不会自动回退**：手工 DDL 回滚后要同步删掉账本里的 0078 行（`DELETE FROM d1_migrations WHERE name='0078_venue_slots_p0.sql'`），否则下次 apply 会被当成「已应用」而静默跳过。

---

## 12. 需要同步的文档

| 文件 | 写什么 |
|---|---|
| `docs/test-plans/v6.53.0-venue-slots-p0.md`（新建，按 qa-test-planner） | TC 编号 + 前置/步骤/预期/优先级 + 回归套件。覆盖：迁移预检与回读、ops 锚点、`slotsForCapacity` 边界、饱和按同类序位、设施三闸、`expectedDamage` vs 实际 `damage`、K=5 消费与重放幂等、事件预置+活动同窗、首窗清零、声望衰减与冠军通知、开窗通知、关窗提醒、方针保存与 `/preview`、并发开窗与重掷回滚、375 布局 |
| `docs/test-plan.md` | 版本基线（`:3` 仍是 v6.6.1）与「现有自动化基线」（`:15` 仍写 53 文件 / 826 例）都过期：在 §2 范围表加「球场档期（v6.53.0）」一行，并把基线计数刷成本轮 `npm test` 的实际数字 |
| `CHANGELOG.md` | 顶部新节 `## [v6.53.0] · 球场档期 P0（容量驱动收入 + 设施门槛 + 场馆经营页）（日期）`，照 v6.52.0 的写法：判级 minor、`package.json` 6.52.0 → 6.53.0、迁移 `0078`、缘起引用本计划文件 |
| `ROADMAP.md` | 加一节 v6.53.0：范围（P0 九项）、14 条裁决（§0 表）、数字验收（§3.3 的 3.75/2.06/...、52.59、C2 109.24/13.24）、遗留（R3/R4/R5/R9/R10/R12） |
| `AGENTS.md` | 在「上线记录」段 `:120` 那一行（v6.52.0 / 0077）**之后追加** 0078 一行（结构相同：版本 / Version id / 迁移号 / 回读数字）。**没有独立的「当前基线」行可改**：全文只有 `:120` 这处历史记录含 0077，别去改历史行 |
| `package.json:5` | `"version": "6.52.0"` → `"6.53.0"` |
| `memory/plan-v6.53.0-venue-slots-p0.md` | 本文件即该增量开工前落盘的计划 |

---

## 附：本计划的自我核对

- 本轮**实际运行**的只有读文件、grep 与一次只读模型复跑：`package.json:5` 版本 6.52.0、`:15` `db:migrate:local`、`:16` `db:migrate:remote`、`:17`（`test:e2e` = `node scripts/e2e/smoke.mjs`）；`src/db/migrations/` 末五枚到 `0077_growth_nongrowable_reset.sql`；`tests/d1.ts:161` 登记 0077；`tests/ops-schedule.test.ts:109/194-195/212-213/220` 四处 =11 断言；`src/worker/venue-ops.ts` 269 行逐段；`src/worker/home.ts:334/460/473-486/512-517/551/554/614-615/702-710`；`src/worker/window-machine.ts:71-80/82-85/120-155/159-178/191-208/209-230`；`src/worker/season-settle.ts:531-540`；`src/worker/notify.ts:40/151-153`；`src/core/notify-meta.ts:42-43`；`src/core/notify-meta.test.ts:35/42/51`（另 `expected` 类目表在 :60-100）；`src/worker/routes/clubs.ts:1301-1369`；`src/worker/event-ops.ts:285-314/352-372/737-746/1000-1030`；`web/src/App.tsx:146-156`；`web/src/lib/api.ts:1485/1502-1514`；`web/src/lib/queries.ts:41/412/453`；`web/src/pages/shop/venueCards.tsx:522-641`；`web/src/pages/shop/ShopPage.tsx:16/166`；`web/src/pages/club/VenueTab.tsx:125`；`web/src/lib/notify-links.ts:36-41`；`src/core/config.ts:37/76-77/185/215-223`；`0069_ops_schedule_expiry.sql:1-31`（`('consumption', 1)`）；`scripts/e2e/smoke.mjs:171`（`E2E_ONLY`）、`:2240`（`ROUTES`）、`:2979`（⑱）、`:3456`（㉒）、`:3566`（最后一个 `check(`，④ v6.51.0）；`tests/naming-tiers.test.ts:17/429-436`；`tests/venue-ops.test.ts:170-184/249/275-277/302`；`web/src/pages/Home.tsx` 94 行、`.nav-card` `:55-82`。
- 本轮**没有运行**任何 `npm` 命令、没有任何迁移被执行、没有任何测试通过与否的结论。§7.1 列出的是实施后必须跑的命令，不是已跑记录。
- §3.3 的四档净额、饱和反推（9.385 / 7.65）、联盟合计 52.59 是**本轮手算复核**（按 §3.1 公式逐项算）；C2 的 109.24/13.24 是**本轮只读复跑** `node scripts/venue/cadence-model.mjs --esports=off` 的输出（`incomeLeague=54.62`/窗，×2），不是手算。工作流报告的 node:sqlite DDL 实测属其自身静默期实验，**本轮未复现**。
- 未复核项已在正文标注：`src/worker/routes/admin/config.ts` 的行号（来自 econ 工作流）、`docs/test-plan.md` 的具体行号。实施时按函数名/小节标题定位。

---

## 复核处置（24 条逐条）

> 说明：原复核编号 20 与 1 是同一问题（season-settle 冠军守卫），23 与 14 是同一问题（无 stadium 行 fallback）；下表保留原编号，重复项标「同 1 / 同 14」，不丢任何一条。

| # | 严重度 | 复核点 | 处置 | 落点 | 说明 |
|---|---|---|---|---|---|
| 1 | high | `season-settle.ts:539` 冠军通知读批尾，追加 stadium UPDATE 后漏发 | **改** | §4.6、§7.2 `season-settle.test.ts` | 记录 `seasonsIdx`，冠军守卫改读 `batchResults[seasonsIdx]`；stadium 衰减追加在 seasons UPDATE 之后 |
| 2 | high | 预览逐槽加总高估（4 演唱 15.00 vs 实际 7.65），`slots[i].saturation` 单值无法表示草稿序位 | **改** | §0 A11、§4.1 `quotePlan`、§4.5 `POST /preview`、§5.3/§5.4、§7.2/§7.3 | 新增只读 `POST /preview`，服务端按草稿同类序位算；前端删 `composeTotals`，只显示 `preview.totals`；GET options 明确「只表示下一个」 |
| 3 | high | 删旧端点 `:1340-1375` 会误删 `/club/events`（POST 实际 `:1369` 结束，`:1373` events） | **改** | §4.5 | 删除范围改为 `:1301-1369`，保留 `:1371` 注释与 `:1373` events |
| 4 | high | `damage` 实际掷点与 §7.2 期望 0.525 不可兼得（`damageRoll` 是命中伯努利，`damage` 是额度） | **改** | §3.3、§4.1 `VenueQuote`、§7.2 | 拆 `damage/expectedDamage` 与 `net/expectedNet`：预览/推荐用 expected，结算用实际；测试分别断言 `damageRoll=0/0.99` 与 `expectedDamage=0.525` |
| 5 | medium | `EffectRunContext` 批级共享无 capacity；`EventClubContext.stadium.capacity` 已有且批量 SELECT 已含 | **改** | §4.6 event-ops | 不加 `EffectRunContext.capacity`；赠档上界用 `ctx.stadium.capacity`，`loadEventContexts` 只补 `venue_reputation` |
| 6 | medium | `tests/naming-tiers.test.ts:17/:429-436` 仍 import `activityIncome`，删函数会红 | **改** | §7.2、§8 第 2 批第 10 项 | 改测 `venueQuote`（buff 断言 `gross ×1.02`、`expectedDamage` 不变）；删旧函数前先改测试 |
| 7 | medium | `activityTotal` 断言在 `tests/venue-ops.test.ts:275-277` 不在 `home.test` | **改** | §7.2 `venue-ops.test.ts`、`home.test.ts` | 精确账本断言移到 venue-ops：`activity − booking_ops − booking`；home.test 只断言字段存在与幂等 |
| 8 | medium | 旧键兼容「flat+均值+仍掷点」自相矛盾，且旧经济静默运行 | **改** | §3.1、§9 R2 | 旧区间改为 `pricing:'legacy_range'`，逐字复刻旧掷点；`legacyKeys`/`configWarning` 显式提示，切 Plan A 必须运营换 JSON |
| 9 | medium | 多档 attendMod 应逐档连乘，计划只返回单值 | **改** | §4.2 `windowActivityStatements`、§7.2 `home.test.ts` | 聚合 `attendMod` 逐档 `clamp(prev×def.attendMod,0.5,2.0)`，关窗只写一次；测试 `1.005×1.007=1.012` |
| 10 | medium | 事件赠档 `:1021-1027` 绕过设施/声望闸 | **改** | §4.6 event-ops、§7.2 `event-ops.test.ts` | 赠档写库前调 `activityUnlockReason`，锁了就不 INSERT 并记「落空」；补 broadcast=0 用例 |
| 11 | medium | `window_open` audit `after` 在 batch 前构造，`venueNotified` 读不到 | **改** | §4.4、§7.4 第 1 条 | audit 只放 `venueReset/rerolled`；`venueNotified` 从返回值与 notifications 表读 |
| 12 | low | `getOpenWindow` 不返回 opened_at | **改** | §4.5、§6.2 | 新增 `getVenueWindow(db)` 查 `opened_at/venue_reminder_at`；不改被十几处调用的 `getOpenWindow` |
| 13 | low | `reputationGain` 需要本窗主场上座率，GET 未定义来源 | **改** | §4.5 `loadVenueContext` | 用 `match_attendance` 的 `SUM(attendance)/(capacity×COUNT(*))`，公式与 `home.ts:601-610` 完全一致；无窗/0 场按 1 |
| 14 | low | `loadVenueVenue` fallback 20000→3 槽 与 `slotsForCapacity(0)→2` 冲突 | **改** | §4.2 `loadVenueContext`（原名已弃用）、§4.5 `hasStadium`、§7.2 | 无 stadium 行 ⇒ `capacity:0 / hasStadium:false`、2 槽；GET 显示「未建球场，按 2 档试排」；不回落 20000 |
| 15 | low | 计划引 `Home.tsx:110-111` 不存在（文件 94 行，nav-card `:55-84`） | **改** | §0 A13、§5.1、§10、附录 | 改为 `:55-82`（grep 实测栅格结束行）；明确「360px 装不下」是设计约束，不是代码注释 |
| 16 | low | e2e 最后 `check(` 是 `:3566` 的④，不是 `:3456` ㉒ | **改** | §7.3、附录 | 新场景 ㉓ 插在 `:3566` 之后；ROUTES `:2240`、⑱ `:2979` 不变 |
| 17 | high | A8/P0⑥ 把 `ops_schedule` 写成已满足零改动，但 `requires_window=1` 单独不产生闸门 | **改** | §0 A8、§1 P0 ⑥、§2.2 ⑨、§2.4、§7.4 第 3 条、§9 R12 | 0078 第 ⑨ 条改 `consumption` 锚点为 `window_open/window_close`（仅双 none）；补预检/回读与 `opBlockReason` 验收 |
| 18 | high | P0⑧ 失败开窗不得先提交经纪人重掷（现在 `window-machine.ts:120-155` 先独立 batch） | **改** | §4.4、§7.2 `window-machine.test.ts`、§9 R9 | 删 `:155` 独立 batch，`...statements` 并入 `openBatch` 最前；用 trigger 造失败，断言 `players.agent_tier` 不变 |
| 19 | medium | 计划未写 C2 基线 109.24（116.02 退役），验收仍是 9b-1 口径 | **改** | §3.3、§7.4 第 7 条、§12 ROADMAP | 写入 O1 `incomeLeague=54.62`×2=109.24 与按档 13.24/7.02/5.29/2.99；与 52.59 单窗、3.75 单槽分开 |
| 20 | medium | 同 1（无声望队首次结算漏发） | **同 1** | 同 1 | 已由 `seasonsIdx` 修正覆盖；测试加 rep=0 + champion 用例 |
| 21 | medium | `attendance_mod_matches = MAX(...,5)` 把事件预置（K=0,mod≠1）延长为 5 场 | **改** | §4.2 尾部 SQL、§9 R3、§7.2 `home.test.ts` | `CASE WHEN attendance_mod_matches=0 AND next_attendance_mod<>1 THEN 0 ELSE MAX(...)`；补事件+活动同窗用例 |
| 22 | low | A6 以「Q12 未含死忠」为由不加，但设计 P0④ 明确关窗死忠演化，fans 推荐缺死忠维度 | **改** | §0 A6、§4.1 `recommendPlan`、§7.2 | 改理由为「关窗演化已有、活动不直给」；`fansDelta` 进 schema（P0=0），`fans` 推荐先比 `fansDelta` 再比乘数 |
| 23 | low | `loadVenueVenue` fallback 20000 与设计 fallback 2 槽不一致 | **同 14** | 同 14 | 已统一为 capacity 0 / 2 槽 |
| 24 | low | `0 > fillRate > 1` 恒 false | **改** | §4.1 `validateActivityConfig`、§7.2 | 改为 `fillRate < 0 \|\| fillRate > 1`；补 1.5 与 −0.1 用例 |
| 25 | low | 采纳率 ≥50% 是设计「待拍板」却写成硬门槛 | **改** | §7.4 第 9 条、§9 R5 | 降为观察指标，记录实际值，不设发布闸 |
| 26 | low | 计划测试命令本轮未执行，只能声明未跑 | **不改（保持声明并加强）** | §7.1 注、附录 | 明确 1–6 未跑、不得写已通过；仅第 7 条模型只读复跑，单独注明不是测试 |
