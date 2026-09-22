# WHL 俱乐部运营平台 · 技术方案

| 项 | 内容 |
|---|---|
| 版本 | v1.4（开发就绪评审：导入管线 §5.4 / config 键注册表 §13 / API 契约 附录 A / 部署前置 §14.0 / 通知插件规格 §12） |
| 日期 | 2026-09-12 |
| 状态 | 已确认方案，待开发 |
| 配套文档 | [PRD.md](./PRD.md)（功能全景/优先级/决策记录） · [UI_DESIGN.md](./UI_DESIGN.md)（前端风格/令牌/组件规格） · [ROADMAP.md](./ROADMAP.md)（开发增量计划） |

---

## 1. 技术选型（每项：用什么 + 为什么 + 代价）

| 选型 | 理由与代价 |
|---|---|
| **纯 Worker（Workers with static assets）：Hono 4 + React SPA 同仓同发** | 与比赛系统同款形态（assets 托管 SPA + `run_worker_first: ["/api/*"]`），登录/中间件/迁移/部署模式直接照抄；对比 Pages+Functions 的结论：Pages Functions 无 cron 触发器（竞猜系统被迫拆出独立 cron-worker 项目，而本平台转会截止兜底需要 cron）、bindings 主要靠 dashboard 点配不即代码、不支持 Smart Placement，且官方方向已明确新项目推荐 Workers；代价是 D1 无 ORM，迁移手写 |
| **平台独立 D1 库 + 跨绑定只读比赛系统 D1** | 平台数据独立演进、独立备份；赛果不回写、不污染比赛系统；代价是跨库无 JOIN，赛果同步在代码层做 |
| **跨绑定共享 KV 会话命名空间** | 竞猜系统已验证此范式（同 KV id 存 `sess:{token}`），登录态零协议改造；代价是共享命名空间需要绑定命名纪律 |
| **惰性结算 + Cron Trigger 兜底**（不用真定时器） | 所有倒计时（竞价截止/5 分钟出价窗/24h 匹配窗）都存截止时间戳，状态推进靠「相关请求访问时先结算到期任务」+ cron 每 5 分钟扫描兜底；幂等可重跑，秒级精度不依赖 cron 频率 |
| **R2 共享媒体库** | 队徽、导入文件、球员头像与比赛系统同一套（whl-media）；无代价 |
| **bot 通知：HTTP API + HMAC 签名 → AstrBot 接收插件** | 竞猜系统已有同款对接协议可抄；代价是 AstrBot 侧要写约 30 行接收插件（验签+发 QQ 消息+绑定命令） |
| **LLM 文案（P2）：Workers 直调 LLM API** | revenue 插件 llm_writer.py 的结构（provider 调用 + JSON 多级兜底提取 + 注册表钳幅）证明钳制是纯代码，可平移；代价是 Workers 无 AstrBot provider 体系，要自带 API key 配置 |
| **测试：Vitest** | 状态机、税公式、XP 计算全是纯函数，单测覆盖成本低；迁移用 D1 本地模拟 |

规模假设：几十支球队、几百球员、单窗几十笔操作——Workers/D1/KV 余量极大，无风险。

## 2. 总体架构

```
┌─ Cloudflare ─────────────────────────────────────────────┐
│  纯 Worker（单一部署单元：assets 托管 React SPA）           │
│  run_worker_first: ["/api/*"] → Hono (/api/*)             │
│                            │                              │
│   ┌──────────┬───────────┼───────────┬──────────────┐    │
│   │ D1 平台库 │ D1 比赛系统 │ KV 会话    │ R2 媒体       │    │
│   │ (读写)    │ (只读绑定)  │ (共享读)   │ (共享)        │    │
│   └──────────┴───────────┴───────────┴──────────────┘    │
│                            │                              │
│              Cron Trigger（每 5 分钟：截止扫描/到期结算）    │
└────────────────────────────┼──────────────────────────────┘
                             │ HTTPS + HMAC 签名
                    AstrBot 接收插件（QQ 通知推送 + /绑定 命令）
```

模块划分（Worker 内）：

```
src/
  routes/     auth(透传校验) / clubs / players / squad / market / ledger /
              growth / season / admin / notify
  core/       state-machine.ts(转会状态机) / deadlines.ts(惰性结算) /
              tax.ts / attendance.ts(上座与收入) / xp.ts / economy.ts(富人税)
  db/         migrations/ (手写 SQL) / dao/ (原子原语，仿 revenue claim_* 模式)
  lib/        session.ts(跨 KV 读会话) / hmac.ts / audit.ts / config.ts
web/          React SPA（挂牌板/球队中心/球员卡/管理端/审核队列；风格与令牌见 UI_DESIGN.md）
```

## 3. 登录与身份打通

### 3.1 共用登录（照抄竞猜系统范式）

参考实现：`WHL-Daily-Activities-System/functions/_lib/auth.ts:85-129`。

1. wrangler 绑定比赛系统的 KV（SESSION_KV，id `87e2d78308bc47e9b36dc6de53be0458`）与 D1（TOUR_DB，库名 whl，id `ec3cc695-70bc-47ab-a454-5ca62ec22dd6`）。
2. 请求带 `whl_session` cookie → 读 KV `sess:{token}` → 得 userId → 查 TOUR_DB user 表 → 载入角色。
3. `must_change_pw=1` 视为未登录（与竞猜一致）；平台自身不设注册/登录页。
4. 角色沿用：`coach`→教练，`admin`/`superadmin`→管理组，locked→只读。
5. 平台库镜像最小用户信息（user_id、显示名），不写比赛系统 user 表。

### 3.2 俱乐部绑定（增量 7 改判：真源上收认证中心）

**增量 7 起绑定真源在 auth 库**（tour 与 club 的球队认证本不相通，裁决上收统一，见 auth TECH_DESIGN §5.3 改判）：auth 0008 三表——`team`（tour team ↔ club club 的目录，`tour_team_id`/`club_id` 唯一可空）、`team_bind_code`（中央码表）、`team_binding`（UNIQUE(account_id) 一账号一队，一队可多账号）。本侧流程不变：管理组建俱乐部 → 生成 8 位一次性认证码 → 教练网页提交 → 绑定；但发码/烧码/解绑都改走 auth 机器 API（`src/worker/authClient.ts`，HMAC X-Sign = hex(SHA-256(BIND_SECRET, "POST|path|ts|raw"))，错误映射 invalid_code→400 / already_bound→409 / 其余 502）；烧码在 auth 单事务原子。绑定关系经只读 `AUTH_DB` D1 绑定派生读（`binding.ts` 两跳：team_binding → team.club_id → 本地 clubs 补名）。OIDC 教练判定改「**绑定即教练**」（auth 对所有新账号自动发 club.coach，权限点无区分度；管理点仍走权限点，未绑定的准教练凭权限点保留旁路进绑前端点）。本地 `club_bind_code`/`club_bindings` 表**休眠保留防回滚**（代码不再读写；AUTH_DB 未配置时回落本地表即回滚通道）。管理端列表的绑定/最新码改读 AUTH_DB（绑定人姓名取 auth account.name）。通知收件人（§12）同步改两跳派生。存量迁移见 auth 仓 `scripts/migrate-team-bindings.mjs`（以 tour team_member 为基准，club 绑定校对，冲突/单边人工裁决）。

### 3.3 QQ 桥（P1）

平台「绑定 QQ」页：用户填 QQ 号 → 平台生成 6 位验证码 → 用户在 QQ 群发 `/绑定 6位码` → AstrBot 接收插件调平台 API 核销 → 写 `qq_links(user_id, qq UNIQUE)`。QQ 号仅用于通知投递，不做身份凭证。

## 4. 数据边界表（谁读谁写）

| 数据 | 谁写 | 谁读 | 说明 |
|---|---|---|---|
| user / 会话（比赛系统 D1 + 共享 KV） | 比赛系统 | 平台跨绑定只读 | 平台不写 user 表 |
| **球队绑定（auth 库，增量 7）** | **auth（机器 API 写：发码/烧码/解绑/登记/关联）** | **平台 AUTH_DB 只读派生** | **平台不写 auth 库；写通道=机器端点** |
| 平台业务库（球员/合同/转会/账本/窗口/成长） | 平台 | 平台 | 唯一事实源 |
| 赛程赛果 | 比赛系统 | 平台跨绑定只读（仅已绑定赛事） | 平台不回写 |
| 赛果衍生数据（奖金/门票收入/XP） | 平台 | — | 赛果确认钩子生成，存平台库 |
| AstrBot 三插件库（revenue/growth/negotiation） | 冻结退役 | 迁移期一次性导出 | 切换后弃用 |
| 积分插件库 | 积分插件 | 不互通 | 仅预留 `exchange_reserved` 流水类型 |

## 5. 数据模型草图

### 5.1 实体关系总览

```
user(比赛系统) ── club_bindings ── clubs ── ledger_accounts ── ledger_entries
                                     │              │
                                     │         fund_holds(出价冻结)
                                     │
players ── contracts ── clubs        listings ── bids ── transfers ── review_tasks
   │  │                                                   │
   │  └─ growth_events / badges                           season_windows(绑定 tournament_id)
   └─ registrations(赛季注册快照)
notifications / qq_links / audit_log / config
```

### 5.2 players（球员主数据，唯一事实源）

```sql
-- 核心列（平台自治）
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  uid TEXT UNIQUE NOT NULL,          -- 与现行球员 uid 体系一致
  name TEXT NOT NULL,
  club_id INTEGER,                   -- NULL = 无归属（可海捞）；CPU 队球员建档即带 CPU 队 id，且同样可海捞（增量 14）
  position TEXT,                     -- GK/CB/LB/RB/CDM/CM/LM/RM/...（防守位置判定用）
  foot INTEGER DEFAULT 1,            -- 惯用脚 0=左脚 1=右脚（导入归一化：FC26db FootID 1右/2左、FC Editor preferredfoot 文本）
  age INTEGER,
  ca INTEGER, pa INTEGER,            -- 现行能力/潜力
  growable INTEGER DEFAULT 1,        -- 可成长标记
  prestige REAL DEFAULT 0,           -- 国际声望 1-5（FC26db internationalrep 导入映射；无源时管理组手填）
  market_value REAL,                 -- 身价：管理员赋值（无公式）
  status TEXT DEFAULT 'normal',      -- normal/listed/trainee/free/retired
  growth_tier INTEGER DEFAULT 1,     -- 成长档位 1-5
  growth_xp REAL DEFAULT 0,          -- 当前成长经验
  is_future_star INTEGER DEFAULT 0,  -- 未来之星（档位+2；源=FC26db Growth+ 名单 + 管理组核定）
  china_plan INTEGER DEFAULT 0,      -- 中国球员加强计划（naID=155 China PR 自动判定，见 §5.2）
  agent_tier INTEGER DEFAULT 2,      -- 经纪人性格 1温和/2普通/3苛刻（公开属性，玩家可见；窗口推进以 0.3 概率重掷，见 §6.8）
  fc_id INTEGER,                     -- EA 球员 ID：FC Editor playerid = FC26db ID（同键已验证，导入对齐键）
  badges_silver INTEGER DEFAULT 0,   -- 成长所得银徽章计数（上限 15，CHECK 约束；身份由管理组在 FC 阵容文件落实，平台不追踪明细，见 §5.2/§15#10）
  badges_gold INTEGER DEFAULT 0,     -- 成长所得金徽章计数（上限 3，CHECK 约束）
  game_attrs TEXT,                   -- 当季 FC 源全量 JSON：FC26db Base 94 列（键=表头名）/ 历史赛季 FC Editor 61 列（清单见下）
  created_at TEXT, updated_at TEXT
);
```

> **FC 属性字段清单（v1.3 与 FC26db 去重合并 + 存储简化定稿）**：属性源双轨——**FC26db（FC26 赛季全库，`Base` 94 列，18408 球员）为当季主源**；FC Editor（s901 阵容版本，61 列，按俱乐部分文件如 `1 - Arsenal.xlsx`）为 FC25 历史赛季源。两源 **playerid = ID 同键**（已对队壳名单 30/30 全中验证）。
>
> **存储口径（简化裁决：查找类字段只存 ID，名称与图标由前端渲染）**：`game_attrs` 只存 ID 键列（`naID / TeamID / PosID1-4 / RoleID1-5 / PSID1-15 / NumofPS`）与非查找原值列（`ID / Name / Age / CA / PA / height / weight / weakfoot / skillmoves / hashighqualityhead / internationalrep` + 34 细分属性）；**惯用脚例外——归一化为平台列 `foot`（0=左脚 1=右脚，FC26db FootID 1右/2左、FC Editor preferredfoot 文本在导入时转换），FootID/Foot 不落库**。文本列（`nationality / Team / Position1-4 / Role1-5 / PlayStyles1-8 / PlayStyles+`）不落库。参考表（NationID 219 / PlayStyleID 73 / PositionID 13 / RoleID 100 / TeamID 693，约 1100 行）做成**随 SPA 版本发布的静态 JSON**，前端按 ID 渲染名称；**PlayStyleID 行含图标键，图标按 `assets/icons/playstyles/{id}.webp` 约定命名——前端徽章小图标能力就此预留**（图标资产包为实现阶段素材，缺图时降级为 🥇🥈 文本徽章）。已验证：PlayStyleID 覆盖 **0-156 双段**（银段 0-56、金段=基础 ID+100 且 `en`/`chs` 均带 ` +` 后缀，如 7→107 Low driven shot→Low driven shot +；随 SPA 发布的 `web/assets/ref/playstyle.json` 共 73 行 = 占位 0 + 银 36 + 金 36）；RoleID 完整编码角色+熟练度（如 141='ST Advanced Forward ++'）；**PSID 槽共 15 个 = 银槽 1-12 + 金槽 13-15**（金徽落库存「基础 ID + 100」，故银段 1-99、金段 101-199，100 是空档；槽位与段位常量由 `src/core/fc26.ts` 单一承载，增量 27 收口）；ID 槽(15)比文本槽(8)更全，弃文本零损失。FC Editor（FC25）历史源仅 position 文本在导入时规范化为 PositionID；role/playstyles 文本无 ID 反查表，归档保留原文（仅存档展示）。
>
> 合并清单 = FC26db 94 列 ∪ FC Editor 独有 4 列（birthdate/number/playerjointeamdate/contractvaliduntil，仅 FC25 归档；平台效力起点以 contracts.effective_from 为准）。下表字段另落独立列或参与平台逻辑：
>
> | 分组 | FC26db 列（当季主源） | FC Editor 列（FC25 历史源） | 平台用途 |
> |---|---|---|---|
> | 主键 | `ID` | `playerid` | 同键 → `fc_id`（导入对齐） |
> | 姓名 | `Name`（单列） | firstname / lastname / commonname | → players.name |
> | 能力主值 | **`CA` / `PA`（官方直给）** | overallrating / potential | → ca/pa 独立列；原「CA=overallrating」映射假设就此坐实 |
> | 年龄 | `Age` | birthdate | → age（FC26db 无出生日期；年龄按库内值 + 赛季结算推进） |
> | 国籍 | `naID` + `nationality`（ID+文本双列） | nationality（纯代码） | **NationID 表 219 国随源提供，中国 = 155 China PR** → china_plan 自动判定 |
> | 脚 / 逆足 / 花式 | `FootID`+`Foot`（1右/2左）/ `weakfoot` / `skillmoves` | preferredfoot / weakfootabilitytypecode | skillmoves 为新增存档；FootID 表随源 |
> | 位置 | Position1-4 + PosID1-4（PositionID 表 13 位） | Position / Position2-4 | → position 列（防守位置判定、XP 规则用） |
> | 角色 | Role1-5 + RoleID1-5（RoleID 表 100 条中英双语，+/- 熟练度内嵌名中） | role1-5 | 存档展示 |
> | 徽章 | `PlayStyles1-15` + `PSID1-15` + `NumofPS`；`PlayStyles+`（独立列） | Playstyles / Playstyles+ | **银徽章 = 银槽 `PSID1-12`、金徽章 = 金槽 `PSID13-15`（金槽存基础 ID+100）**；PlayStyleID 表（0-156 双段，含中文名/分类/**图标键**）→ 前端渲染名称与小图标；平台台账只记计数（badges_silver/gold，见 players 表） |
> | 声望 | `internationalrep`（1-5） | — | → prestige 列导入映射（原纯手填字段有了源） |
> | 归属 | `TeamID` + `Team`（TeamID 表 693 队） | teamid / playerjointeamdate / contractvaliduntil / number | TeamID→存档；队壳归属以平台 contracts 为准；number 仅 FC Editor 源有 |
> | 细分属性 | **34 项 finishing…gkreflexes 两源同名直通** | 同左 | 仅存档（球员卡展示） |
> | 其他 | `hashighqualityhead` | — | 仅存档 |
>
> 随源参考表（导入工具直接消费，无需另建）：FC26db 内嵌 NationID / PlayStyleID / PositionID / RoleID / TeamID / FootID；`EAFC 26 IDs.xlsx` 另提供 LeagueID(53) / StadiumID(1000，含主队) / TeamID(800 扩展) / IconHeroList（ICON/HERO 改名辅助，参考不并入）。**Growth+ 表（105 行）= 未来之星名单** → `is_future_star` 初始源（管理组终审）；其 BackEnd 页「成长年龄=25」与本站 young_blend_age 默认一致。MainBackup（18688×17，SoFIFA 风格引用）为第三方备份源，仅对账参考、不并入字段。FC Editor 源日期格式 DD/MM/YYYY；s901 为阵容版本号，与 §10.4 换版工具对齐。

### 5.3 其余核心表

```sql
CREATE TABLE clubs (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
  league_tier TEXT,                 -- 增量 9 起休眠：级别由赛季定级赛事报名派生（worker/tier.ts）；AUTH_DB 未配置时回落读此列（回滚通道）
  logo_key TEXT, status TEXT, created_at TEXT
);
CREATE TABLE club_bindings (        -- 增量 7 起休眠（真源 auth team_binding；保留防回滚，AUTH_DB 未配置时回落读此表）
  club_id INTEGER REFERENCES clubs, user_id INTEGER UNIQUE,  -- 一账号一队
  bound_at TEXT
);
CREATE TABLE qq_links (
  user_id INTEGER PRIMARY KEY, qq TEXT UNIQUE,
  verified_at TEXT
);

CREATE TABLE contracts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER UNIQUE REFERENCES players,   -- 一球员一份现行合同
  club_id INTEGER REFERENCES clubs,
  release_fee REAL, wage REAL,                   -- RC（m）/ 工资（m/半赛季）
  contract_type TEXT DEFAULT 'formal',           -- formal/trainee
  source TEXT,                                   -- 成约方式：negotiation(报价成功)/forced(3轮强约)/direct(直败结算)；导入历史数据=import
  signed_at TEXT, effective_from TEXT,           -- 签约时点 / 效力起点（展示与审计留档）
  service_ticks INTEGER NOT NULL DEFAULT 0,      -- 签约基数：签约时点已关常规窗数（增量 25，效力刻度）
  protection_ticks INTEGER,                      -- 保护期结束的绝对窗数 = 基数+3；NULL=无保护期（训练营）
  signed_season INTEGER, signed_window_seq INTEGER, -- 签约窗（展示用；导入不落）
  protected_until TEXT,                          -- 旧口径列（signed_at+548 天），增量 25 起判定不再读，留档
  is_active INTEGER DEFAULT 1
);

CREATE TABLE registrations (                     -- 赛季注册快照（准入体检基准）
  season INTEGER, club_id INTEGER, player_id INTEGER,
  squad TEXT,                                     -- first_team/trainee
  PRIMARY KEY (season, club_id, player_id)
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  player_id INTEGER, seller_club_id INTEGER,
  type TEXT DEFAULT 'normal',                     -- normal/forced（强制拍卖）
  ask_price REAL,
  status TEXT,                                    -- 见 §6 状态机
  listed_at TEXT, listed_day TEXT,                -- N 日（挂牌日）
  last_bid_at TEXT,                               -- 静默计时基准
  deadline_note TEXT,                             -- 顺延记录
  window_seq INTEGER, season INTEGER
);
CREATE TABLE bids (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings,
  club_id INTEGER, amount REAL, created_at TEXT,
  status TEXT,                                    -- active/superseded/withdrawn/won
  hold_id INTEGER                                 -- 资金冻结引用
);
CREATE TABLE fund_holds (                         -- 出价冻结（防空头报价）
  id INTEGER PRIMARY KEY,
  club_id INTEGER, amount REAL,
  status TEXT,                                    -- held/released/settled
  ref_type TEXT, ref_id INTEGER, created_at TEXT
);

CREATE TABLE transfers (                          -- 六类操作统一单据
  id INTEGER PRIMARY KEY,
  type TEXT,      -- transfer/activation/match(匹配)/free_agent(海捞)/termination(解约)/rc_change(改违约金，平台展示名「续约」)/forced_auction
  player_id INTEGER, from_club_id INTEGER, to_club_id INTEGER,
  fee REAL, tax REAL, extra_fee REAL,             -- 成交价/交易税/附加费(下架费/解约费/改RC费/匹配差额)
  matched INTEGER DEFAULT 0,                      -- 是否被匹配
  status TEXT,                                    -- pending_review/completed/rejected/cancelled
  evidence TEXT,                                  -- 截图/备注（人工审依据）
  review_task_id INTEGER, season INTEGER, window_seq INTEGER,
  idempotency_key TEXT UNIQUE,                    -- 过户幂等
  created_at TEXT, completed_at TEXT
);
CREATE TABLE review_tasks (
  id INTEGER PRIMARY KEY, type TEXT, ref_id INTEGER,
  payload TEXT, status TEXT,                      -- open/approved/rejected
  requested_by INTEGER, decided_by INTEGER, decided_at TEXT, note TEXT
);

CREATE TABLE negotiation_sessions (              -- 签约工资谈判会话（transfer 单即案例，自动创建）
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER UNIQUE REFERENCES transfers,
  player_id INTEGER, club_id INTEGER,            -- 签约方（买方/匹配方/海捞方/本队）
  expected_wage REAL,                            -- 基础快照 E（重设新 RC 时更新；含续约加薪）
  attempt_count INTEGER DEFAULT 0,
  status TEXT,                                   -- active/settled/cancelled
  created_at TEXT, settled_at TEXT
);
CREATE TABLE negotiation_attempts (              -- 报价流水（eff_expected 仅服务端可见，见 §6.10）
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES negotiation_sessions,
  attempt_no INTEGER, offered_wage REAL, eff_expected REAL,
  result TEXT,                                   -- success/fail/direct_fail
  created_at TEXT,
  UNIQUE (session_id, attempt_no)
);

CREATE TABLE seasons (season INTEGER PRIMARY KEY, status TEXT, ...);
CREATE TABLE season_windows (
  id INTEGER PRIMARY KEY, season INTEGER, window_seq INTEGER,
  status TEXT,                                    -- open/closed
  tournament_id INTEGER,                          -- 每赛季从比赛系统选择绑定的赛事
  competition_type TEXT,                          -- league_premier/league_second/champions_cup/super_cup/qualifying
  opened_at TEXT, closed_at TEXT
);

CREATE TABLE ledger_accounts (
  club_id INTEGER PRIMARY KEY, balance REAL NOT NULL, updated_at TEXT
);
CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY,
  club_id INTEGER, kind TEXT NOT NULL,            -- 见 §7.1 枚举
  amount REAL NOT NULL,                           -- 正=入账 负=出账
  balance_after REAL NOT NULL,                    -- 防错账
  ref_type TEXT, ref_id INTEGER, memo TEXT, created_at TEXT
);

CREATE TABLE growth_events (                      -- XP 事件（自动+补录）
  id INTEGER PRIMARY KEY,
  player_id INTEGER, match_ref TEXT,              -- 比赛系统 match id
  season INTEGER, window_seq INTEGER,
  event_type TEXT, value REAL, xp REAL,           -- 出场/评分/进球/助攻/零封/夺权/扑救/里程碑/reset(解约划断)
  source TEXT,                                    -- auto(比赛系统事件)/manual(管理组补录)
  recorded_by INTEGER, created_at TEXT,
  UNIQUE (player_id, match_ref, event_type)       -- 防重复记 XP
);
CREATE TABLE growth_periods (                      -- 成长期（增量 13）：里程碑只累计当期事件
  id INTEGER PRIMARY KEY,
  season INTEGER, start_event_id INTEGER NOT NULL, -- 界：只累计 growth_events.id > start_event_id
  source TEXT NOT NULL DEFAULT 'manual',           -- manual(管理组宣告)/window_open(开窗勾选)
  note TEXT, declared_by INTEGER, declared_at TEXT
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY, club_id INTEGER, user_id INTEGER,
  channel TEXT,                                   -- qq/web
  template TEXT, payload TEXT,
  status TEXT,                                    -- pending/sent/failed
  created_at TEXT, sent_at TEXT
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY, actor INTEGER, action TEXT,
  target_type TEXT, target_id INTEGER,
  before TEXT, after TEXT, at TEXT
);
CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);  -- 全部可调参数见 §13
```

### 5.4 球员导入管线（FC26db / FC Editor → 平台）

**通道**：

| 通道 | 源 | 用途 |
|---|---|---|
| A · 当季主源 | FC26db `Base` 94 列（xlsx/csv，管理端网页上传） | 属性主数据批量导入/赛季刷新 |
| B · 队壳名单 | FC Editor s901 队壳文件（61 列） | 队壳归属名单与 FC25 历史归档 |
| C · 名单合同模板 | 管理组 CSV（uid, RC, 工资, 效力起点, 合同类型） | contracts 初建（两源均无 RC/工资列） |

**解析位置**：xlsx 解析放**前端**（SheetJS，管理端网页解析后提交规范化 JSON）——避免 Worker 打包大型解析库；Worker 侧只做 schema 校验与落库。解析与提交两段式：预览（统计+抽样+错误明细）→ 确认落库（沿谈判插件 `import_require_confirm` 纪律）。

**列校验**：必需列存在（通道 A：ID/Name/Age/CA/PA/naID/PosID1…；通道 B：playerid/commonname/Position…）；数值边界（CA/PA 1-99、Age 14-50，沿插件 import 边界纪律）；同批重复 ID 报告；单批 ≤5000 行事务提交，超量分批。

**归一化**（落独立列）：

| 平台列 | 通道 A | 通道 B |
|---|---|---|
| `fc_id` | `ID` | `playerid`（同键） |
| `uid` | `fc{ID}`（假设：联赛现行 uid 若另有体系，换成映射表） | 同左 |
| `name` | `Name` | commonname 优先，缺省拼 firstname+lastname |
| `ca` / `pa` | `CA` / `PA` | overallrating / potential |
| `age` | `Age` | birthdate 推算 |
| `foot` | FootID 1右→1、2左→0 | preferredfoot 文本 Right→1、Left→0 |
| `position` | PosID1 → PositionID 表名 | Position 文本 → PositionID 反查 |
| `prestige` | `internationalrep` | — |
| `china_plan` | naID=155 自动置 1 | 国籍代码同表判定 |
| `is_future_star` | Growth+ 名单上传 → 预置建议值，**管理组核定后生效**（核定写 audit） | — |
| `game_attrs` | §5.2 ID-only 口径全量 | 原文归档（role/playstyles 文本无反查表） |

**upsert 幂等**（关键约束）：`ON CONFLICT(fc_id) DO UPDATE` **只写 FC 源列**（上表 + height/weight/weakfoot/skillmoves 等）；**绝不触碰运营列**——status、contracts、badges_silver/gold、growth_tier/xp、market_value、agent_tier、registrations。`club_id` 是唯一例外且只在**新插入**时写（增量 14，用户裁决：CPU 队球员的队籍，4 支 CPU 队之外的球员落 NULL）；冲突时不更新，免得覆盖认领/解约/转会后的事实归属。重复导入安全，运营数据零风险。

**参考表静态 JSON**：导入工具顺带从源文件生成 NationID/PlayStyleID(含图标键)/PositionID/RoleID/TeamID 五张 JSON 进 `web/assets/ref/`，随 SPA 版本发布（前端渲染名称与徽章小图标的数据源，换赛季重新生成）。

**审计与回滚**：每批次写 audit_log（批次号/通道/新增/覆盖/跳过/失败统计）；失败重跑幂等（同 fc_id 覆盖为同结果），无独立回滚需求。

## 6. 转会状态机（核心）

### 6.1 普通转会（挂牌竞价）状态图

```
draft ──挂牌(价格校验)──→ listed ──首笔出价──→ bidding
                                              │
        ┌─────────────────────────────────────┘
        ▼ 每次访问/cron 扫描时惰性判定（规则 4.4.7）
   [截止判定] N+1 日起，交易日 18:00-23:00 内，now - last_bid_at ≥ 3h ?
        │
        ├─ 是 → pending_review（管理组人工审）
        │         ├─ 批准 → signing（签约谈判自动开启，见 §6.7）
        │         │           └─ 成约（negotiation/forced/direct）→ completed（划款+税+过户，幂等单点）
        │         └─ 驳回 → rejected（解冻资金，恢复挂牌或下架）
        │
        ├─ 否（3 小时内有新出价）→ 等待；若已过 23:00 → 顺延下一交易日 18-23 点
        │
        └─ 全程无人出价（到窗尾）→ delisted（挂牌方付挂牌价 10% 下架费）
```

### 6.2 激活 + 匹配分支

```
listed（挂牌中或任意球员）──激活(校验：一窗一球员一次、效力>0、保护期倍数)──→ activation_opened
   │  5 分钟首价窗（秒级惰性结算；只有激活方能出价、金额恰等于激活价，他人出价无效）
   ├─ 激活方落首价 → 首价即成交价（激活挂牌永不开放后续竞价）
   │     ├─ 训练营球员 → pending_review（固定条款无匹配）→ 直签训练营/谈判
   │     └─ 正式球员 → matched_pending（被激活方 24h 匹配窗）
   │           ├─ 匹配：新 RC > 首价（不受 4.4.6 幅度约束，假设 16）→ 差额审核时销毁 → 球员留队（挂牌落 delisted 终态）→ match 单 → signing
   │           └─ 放行/到期 → 按激活价成交 → pending_review → signing
   └─ 5 分钟内未落价 → invalid（激活作废；假设：已消耗一窗一次额度）
```

与插件的关键差异：谈判插件由管理员手动 `/创建谈判` 建案例；平台在审核通过后**状态机自动创建谈判会话**并分配签入方，E 在会话创建或重设新 RC 时快照。signing 态统一走 §6.7；只有解约（termination）无工资谈判、审核通过直接 completed。

激活金额（挂牌价）：训练营球员固定 5m（4.3.4）；正式球员 = RC × 倍数——保护期内 RC≤20m→2 倍、>20m→1.5 倍，保护期外 1 倍（保护期判定见假设 13）；刚签约（效力 0）不可激活。

### 6.3 旁路操作（不走竞价，直接生成 transfer 单；除解约外审核通过后自动进入 signing，见 §6.7）

| 操作 | 关键校验 | 费用 |
|---|---|---|
| 海捞 | 目标球员无归属**或挂在 CPU 队名下**（增量 14；解约禁签名单内的本窗不可签）；**新违约金不设上下限**（裁决：自平衡——定得低签入费与工资都便宜，但球员随时可被激活撬走；定得高则签入费贵。原「定价人工审」取消）；复签翻新历史合同行（contracts.player_id 全局唯一，UPSERT） | 新 RC × 30% |
| 解约 | 有合同、未挂牌/未激活挂牌/未在解约流程中 | 效力 ≥3 赛季（= 6 个常规窗关窗）免费；否则 RC×(3−效力)×0.1，效力=0.5×常规窗关窗数（增量 25 改窗刻度，假设 14）；本窗被解约球员全联盟禁签；CA 恢复 base_ca，成长数值（XP/已升级数/徽章计数）清零并写 reset 划断行（增量 13，假设 19）。**无工资谈判，审核通过直接 completed** |
| 续约（=规则 4.4.6 合同期内更改违约金，内部枚举 rc_change 不变） | 合同期内、未挂牌/未解约；幅度：RC≤20m→±10m、RC>20m→±50% | 提高=差额×30%；降低=免费；保护期收口到审核通过当下（`protection_ticks` = 当前已关常规窗数 → 判定恒不成立；`service_ticks` 效力基数不动）；工资重谈（预期工资加薪 5%-15%，见 §6.7） |
| 强制拍卖 | 准入体检失败触发；管理方 1m 挂牌；人选队内 CA 前六（含并列、不含门将） | 交易税率 50%（特例）。走挂牌链，成交后同样进 signing |

旁路单据与市场成交共用审核队列与 approveTransferDeal 链：批准后除解约直接 completed 外，续约/海捞/匹配按 F 定死条款自动开签约谈判（续约/匹配禁直签训练营——留人操作必须有工资重谈）。**附加费时点（假设 15）**：续约费/解约费/海捞签入费/匹配差额在审核通过时收（(kind, ref) 幂等闸防重），提交时只做可用余额预检。**窗内回滚（4.4.10，假设 18）**：续约完成后同窗内被挂牌/激活挂牌/解约/强制拍卖 → RC+保护期还原（`release_fee` 与 `protection_ticks` 回写原值，仍归属原队时）+ 续约费退还（rc_change_refund）；匹配不触发回滚。

### 6.4 不变式（全状态机通用）

1. **资金冻结先行**：出价即创建 fund_holds 冻结；被超/撤回/驳回时解冻；成交时结算划转。余额不足拒绝出价。
2. **过户单点执行**：只有 `completed` 状态的 transfer 单触发过户（球员归属、合同、账本三方变更），幂等键 = transfer_id，失败可安全重试。**completed 的到达时机 = 签约谈判成约（成约即过户）**；解约单除外（审核通过即 completed）。
3. **窗口校验在入口**：所有转会操作先校验当前窗口 open；窗外只读。
4. **全量审计**：每个状态迁移写 audit_log（涉密参数键除外，见 §6.10）。
5. **窗内回滚规则（4.4.10）**：续约（改违约金）后被挂牌/激活/解约 → 更改无效回滚；窗内多次转会回原队视作续约按 4.4.6 处理。
6. **窗口推进前置校验**：存在活跃谈判会话（signing）时禁止推进窗口/赛季（沿插件范式阻塞）；管理组可强制按 E 结算或取消会话后推进（假设，开关可配置）。

### 6.5 截止自动化的 Workers 实现

```ts
// 惰性结算入口：任何挂牌相关请求先跑一遍
async function settleOverdue(db: D1Database, now: Date) {
  // 1) activation_opened 且 expires_at < now → 判定无效/进入匹配窗
  // 2) matched_pending 且 expires_at < now → 自动按激活价成交（或匹配已提交则走匹配）
  // 3) bidding 且处于交易日 18-23 点窗口、now - last_bid_at >= 3h → pending_review
  // 4) bidding 但当前不在 18-23 点 → 记录顺延至下一交易日（交易日历可配置）
}

// cron 每 5 分钟兜底（wrangler.toml [triggers] crons = ["*/5 * * * *"]）
// 扫描 status IN ('bidding','activation_opened','matched_pending') 的 listing 逐个 settleOverdue
// 全部幂等：重复执行无副作用（状态迁移用乐观锁 UPDATE ... WHERE status=?）
```

竞价截止时区与「18-23 点」按平台统一时区（ Asia/Shanghai ）判定，交易日历存 config。

### 6.6 交易税（分段累进，卖方付，基数成交价 P）

```
tax(P, RC) = min(P, RC)×0.10
           + max(0, min(P, 1.5RC) − RC)×0.20
           + max(0, P − 1.5RC)×0.40
```

强制拍卖特例：整单税率 50%。成交价分配：卖家得 P − tax；税销毁（回收）。

### 6.7 签约谈判会话（signing）：自动开启 + 工资判定（整套移植谈判插件 `services/formula.py`，系数全部可配置）

规则 4.3.3 只给机制不给公式。**裁决：直接移植谈判插件已实现的判定族**（`formula.py:12-92`、`negotiation_service.py:425-510`、`DESIGN_V120.md`），全部参数入 config，默认值取插件现值。

**流程**（与插件差异：插件=管理员手动 `/创建谈判` 建案例；平台=成交审核通过后状态机自动创建会话并分配签入方）：

```
审核通过 → 自动创建 negotiation_sessions（分配买方/匹配方/海捞方/本队）
  → 签约方提交新违约金 F（校验 ±10/±50%；匹配单的 F 在提交匹配时已定且须高于最高价，海捞 F 无上下限）
  → 快照 E（续约单乘加薪系数，见下）→ 玩家可见 E 数值（沿插件）
  → ≤3 次工资报价 → 成约 → contracts 落库（source=negotiation/forced/direct）→ transfer 单 completed（成约即过户）
```

**预期工资基础快照 E**：

```
E_base = round(a × L^b × F^c, 2)          # a=0.02, b=1.9, c=0.45（wage_param_a/b/c，保密，掩码展示）
  L = 能力等级（公开映射表）：≥93→10；90–92→9；87–89→8；84–86→7；80–83→6；75–79→5；70–74→4；65–69→3；60–64→2；≤59→1
  年龄 ≤ 成长年龄（默认 25，可配）→ L = (CA等级 + PA等级) / 2（可 .5 步进）；否则 L = CA等级
  F = 本次约定的新违约金——六条成约路径（普通转会/激活成交/匹配/海捞/拍卖/续约）统一适用；解约无工资谈判
续约单：E = E_base × U(1.05, 1.15)（规则 4.3.3「续约时加薪 5%-15%」，区间端点可配置）；其余成约路径不加上浮
训练营球员：固定 0.75m/半赛季（规则 4.3.4，不走公式）
样例：L5+F10→1.2；L8+F50→6.0；L10+F100→12.6（M/半赛季，与平台工资口径一致）
```

**单次报价判定**（事务内，顺序固定；对外只报结果，不展示成功率数值）：

```
1. 单调性：报价须高于上一次（不耗次数）；报价区间 [wage_min, wage_max] = [0.01, 20.00] M/半赛季
2. eff = E（第 1 次）或 E × 0.95（第 2/3 次，attempt_decay_multiplier=0.95，保密）
3. p = 成功率(报价/eff)：ratio ≥ 1.0 → 1.0；否则 p = 1/(1+e^(−9×((ratio−0.6)/0.4−0.5)))（sigmoid，中点 ratio=0.8；保密）
4. 直败判定（保密，见 §6.8 档位参数）：p < 档位阈值 且 roll < 档位概率
   → 谈判立即终结，按 settle_wage 成约 source=direct（末次报价按 E，其余按 eff）
5. 原成功率 roll；未成且 attempt_no ≥ 3 → 按基础 E 强制成约 source=forced（规则 4.3.3「3 轮未谈拢直接满足预期工资」）
```

**直签训练营出口（需求方裁决 2026-09-12）**：所有谈判会话（普通成交/激活成交/匹配/海捞/拍卖）在成约前均可选择「直接签训练营合同」——条款固定 0.75m/半赛季、违约金 5m（规则 4.3.4(1)），**不占 4.3.4(3) 每窗 2 名正式转训练营的名额**（该名额只约束「正式合同转训练营」的下放操作，签约时直接选训练营是另一条路径）。落库 source=trainee、contract_type=trainee，球员落训练营状态。激活成交与普通成交一样走谈判（同日裁决：撤销「激活成交直接过户」的临时口径——训练营合同双固定不构成谈判豁免，买方仍可在谈判中改签正式合同）。

**结算与过户的崩溃自愈**：成约分两个 batch——① 会话侧（attempt 流水 + attempt_count + `settled_wage`/`settle_source` 快照）；② `completeTransfer` 过户单点（幂等，守卫放宽到 signing 态，携带 ContractTerms 写新合同：wage/新 RC/source/contract_type/signed_at）。两批之间崩溃时，下次触碰（GET 列表 / 报价 / 直签）检测「会话已结算但 transfer 仍 signing」即按会话快照重放过户；反向（次数已满但会话未结算）沿插件模式补强约自愈。

### 6.8 经纪人性格（公开属性，玩家可见）

- `players.agent_tier`：1 温和 / 2 普通 / 3 苛刻，默认 2；导入不设列，全部默认普通。
- **窗口演化**：进入新窗口/赛季的推进事务内（推进校验已保证无活跃会话），全球员以 `agent_change_probability=0.3` 三档等概率重掷；会话存续期档位恒定（E 已快照，不受重掷影响）。
- **玩家可见**：球员详情页、待谈判列表、谈判会话页显示档位名（温和/普通/苛刻）；含义公开——数值越高经纪人越强硬、压价风险越大。
- **直败参数按档位**（保密，config 存 JSON，管理端掩码）：1→(阈值 0.15, 直败概率 0.30)；2→(0.25, 0.50)；3→(0.35, 0.70)。

### 6.9 满意度反馈文案（替换「把握分档」，公开）

服务端按 p 选文案返回，阈值与 p 值永不回传前端：

| p 区间（保密） | 文案 |
|---|---|
| ≥ 0.9 | 😍 经纪人非常满意 |
| [0.6, 0.9) | 🙂 经纪人比较满意 |
| [0.25, 0.6) | 😐 经纪人不太满意 |
| < 0.25 | 😠 经纪人很不满意 |

p 低于该球员档位阈值时文案附加「（报价过低，有谈崩风险）」。谈判结果文案：直败=「❌ 报价过低，谈判直接失败，已按该次预期工资结算」；强约=「已按预期工资强制成约（3 轮未谈拢）」；直签训练营=「已按训练营合同签入（工资 0.75m/半赛季、违约金 5m，不占本窗下放名额）」。

### 6.10 判定保密开发规约（强制性，开发与代码评审逐条对照）

公式与参数已由需求方确认**保密且需强化措施**，以下为将来代码的硬性要求（形式对齐 §17）：

1. **服务端隔离**：E/p/直败全部计算只在 Worker 侧独立模块（如 `server/lib/settle-secret.ts`）实现；该模块禁止被 `web/` 与 `shared/` 引用，构建产物（SPA bundle）不得含任何判定常数。
2. **API 面收敛**：谈判相关响应只含 结局/剩余次数/满意度文案/风险布尔/E 数值；p、eff_expected、阈值、衰减系数、档位参数一律不出服务端。
3. **E 数值展示**：会话创建/重设新 RC 时向签约方展示 E 数值（沿插件）；公式与系数不展示。
4. **配置掩码**：涉密 config 键（wage_param_a/b/c、attempt_decay_multiplier、agent_tiers、sigmoid 参数、满意度阈值）在管理端查看时值掩码为「（内部参数，已隐藏）」，键名保留；audit_log 不记录涉密键的新旧值（仅记「已修改」）。
5. **零注释实现**：涉密函数零注释零 docstring、常量内联（沿插件 `formula.py` 姿态）；语义放在本设计与测试断言里，不进代码。
6. **随机与日志**：判定随机数用 `crypto.getRandomValues`；Worker 日志与 observability 输出不落判定输入/输出/p 值。
7. **测试纪律**：涉密逻辑的测试仅「输入→输出数值断言」，无解释性注释、无规则描述。

## 7. 经济系统设计

### 7.1 流水类型枚举（ledger_entries.kind）

| kind | 方向 | 阶段 |
|---|---|---|
| `opening_import` | + | P0 期初余额导入 |
| `manual_adjust` | ± | P0 管理组手动记账 |
| `prize_*`（联赛/冠军杯/超级杯各类） | + | P0 手动模板 / P1 自动 |
| `ticket` / `commercial` / `broadcast` | + | P1 主场收入 |
| `transfer_out`（卖方净得）/ `transfer_in`（买方付款） | ± | P0 |
| `transfer_tax` / `delist_fee` / `termination_fee` / `rc_change_fee`（续约费，枚举名不变） | −（销毁） | P0 |
| `rc_change_refund`（4.4.10 窗内回滚退还续约费） | + | P0 |
| `match_diff_burn`（匹配差额） | −（销毁） | P0 |
| `free_agent_fee`（海捞签入费=新 RC×30%） | −（销毁） | P0 |
| `wage` | −（销毁） | P1 每半赛季按注册名单扣 |
| `facility_build` / `facility_maintenance` | ± | P1 |
| `luxury_tax` | −（销毁） | P1 窗口结算 |
| `loyalty_bonus` | + | P1 赛季结算 |
| `event_*` | ± | P2 随机事件 |
| `exchange_reserved` | — | P2 预留，MVP 不启用 |

### 7.2 发行与回收

- **发行（货币进入）**：期初导入（一次性）、赛事奖金、主场收入、忠诚奖金、活动奖励（P2）。
- **回收（货币退出/销毁）**：工资、交易税、下架费、解约费、续约费（改 RC 费）、海捞签入费（新 RC×30%）、匹配差额、富人税、维护费。

### 7.3 防通胀与防刷

| 风险 | 对策 |
|---|---|
| 通胀 | 回收项覆盖规则内一切收费；富人税是强力自动回收器（125m/20% 与 700m/5%）；M0 监控报表（P1）让管理组可见货币总量 |
| 空头报价/竞价刷单 | 出价即冻结；出价全量留痕；同一挂牌的出价序列公开可查 |
| 关联交易/自抬价 | 连续抬价告警、关联出价告警（P1）；大额交易强制人工审（阈值可配置） |
| 低买高卖套利 | 规则自带的激活倍数（2 倍/1.5 倍）+ 保护期 + 匹配机制本身就是防抢劫设计；平台忠实实现 |
| 资金杠杆 | 禁借贷（v5.1 第三章）；转会费当窗付清（成交即全款，状态机天然满足）；余额不足拒绝出价 |

### 7.4 账本原子性（仿 revenue 插件 claim_* 模式）

- 一切余额变更走 DAO 原语：`BEGIN IMMEDIATE` 事务内「校验余额 → 写流水（含 balance_after）→ 更新账户」，D1 单写者特性天然防并发双花。
- 冻结资金不扣余额、单独记账（fund_holds），可用余额 = balance − Σ(活跃 hold)。出价校验用可用余额。

## 8. 主场收入引擎（公式全按 revenue 插件移植）

**优先级声明：主场相关一律以 revenue 插件实现为准；主规则 v5.1 第三章「比赛日收益 2.00m/万」不采用。** 以下公式与系数全部进 config 可配置。

### 8.1 上座人数（revenue `services/formula.py:361-386`）

```
上座 = min(
  容量 × U(0.985, 0.999),
  死忠球迷数 × 上座倍数 × 球场等级系数 × 战绩系数 × 天气系数 × 对手系数
             × U(0.97, 1.03) × next_attendance_mod
)
战绩系数：form_pts = Σ(胜3/平1/负0)，不足 3 场按中性 4 分（formula.py:266-281）
```

### 8.2 比赛日收入三分（revenue `formula.py:389-397`）

```
票房 = 上座 / 10000 × 1.5M
商业 = 上座 / 10000 × 0.1M × 商业区等级
转播 = 0.3M × 灯光等级
```

### 8.3 配套机制（P1 窗口结算一并移植）

| 机制 | 公式/参数（revenue 来源） |
|---|---|
| 死忠演化 | 死忠球迷数按上座/满意度演化（formula.py:435-459） |
| 维护费 tier_maintenance | 按球场档位收（formula.py:213-218） |
| 设施扩建 | 0.1M/100 座；支出返 25% 建设券（build_credit_ratio=0.25） |
| 设施升级差价 | 等级 1→5 价格表 "3,5,8,12,16"（M）（formula.py:407）；五类设施 0-5 级 |
| 事件（P2） | 0.4/事件/窗触发、上限 2 次/窗；14 效果键钳幅 money±8M、fans±5%、satisfaction±0.5 |

**增量 12 实现状态（代码 a4a5dc0 + review 修复）**：全部进 `worker/home.ts`，系数进 config 键 `attendance_model`（天气概率用户裁决 **晴40/多云30/雨20/雪10**、form_coef_table、attendance_multiplier、三分单价、死忠带/涨掉粉系数、influence 系数）与 `tier_table`（球场 0-4 档）。

- **影响力**（规则 v5.2 §4.1.2/4.1.3 + 主规则 v5.1 §5.1）：能力等级十档表（≥93→10 … ≤59→1），可成长=(CA档+PA档)/2、非成长=CA档；球员影响力=系数×能力等级×国际声望（可成长 0.25/非成长 0.13，规则原文；口径=在册现行合同，假设 32）；球队影响力=Σ球员+队壳影响力（管理组后台）+奖励分（管理组后台）。
- **比赛日收入（确认即入账，用户裁决）**：赛果确认钩子④——AUTH_DB 目录映射主场 club → 无球场行/已入账则跳过；天气在确认时按概率掷出固化（假设 30）；上座=min(容量×U(0.985,0.999)，死忠×4.0×(1+0.35×档)×attend_coef×近3场系数×天气×对手×U(0.97,1.03))，对手系数=1+5%×客队影响力/主队影响力（主队≤0 取 1，revenue 口径）；三分=票房 1.5M/万+商业 0.1M/万×商业区级+转播 0.3M×灯光级；`ledgerMovement kind='revenue' ref='match'` + `match_attendance`（match_id 主键）双闸幂等；收入失败 revenueError 回显不阻塞确认。
- **窗末结算（并入关窗批）**：维护费=档位基础(2.0-14)+每万座费率(0.8-0.2)×容量万×本窗已确认主场场次（假设 33，`kind='maintenance' ref='window'`）；死忠演化每队一轮（目标=影响力阶梯 26/22/15/12 逐带；涨 0.5×(0.6+0.4×上座率)×(1+3%青训)，掉 0.5×(1+0.8×(1−上座率))，战绩 Pts≥7 ×1.05/≤1 ×0.95，钳 [0,10000]）；冠名收租（增量 20）**仅常规窗**收，临时窗不收租也不递减 `windows_remaining`。维护费与死忠演化**每种窗都照做**（增量 25）。
- **近 3 场战绩**（假设 31）：平台已确认赛果（不含本场），胜3平1负0，**点球决胜按平局计**（用户裁决 2026-09-16），弃权按 winner 记胜负，不足 3 场中性 4 分。
- **设施经营（扩建/升级）留远期**：数据模型已建全（stadiums/club_facilities），操作界面与建设券扣款后续增量做。存量=revenue 插件库导出（scripts/revenue-import/，20 队容量/档位/死忠+设施 SQL，队壳/奖励分置 0 管理组维护）。
- 管理端：GET/POST /clubs/:id/stadium（球场名/容量/档位/队壳影响力/奖励分，stadium_update 审计）；教练端 /me/club 带主场档案。冠名市场/活动档期/主场事件 P2 不做（用户确认）。

## 9. 赛事奖金与富人税（主规则 v5.1 第三章）

### 9.1 奖金表（config 存储，单位 m）

| 赛事 | 项目 | 金额 |
|---|---|---|
| 顶级联赛 | 入场奖金 20；每胜 8.5 / 平 6.6 / 负 4.7 | 每赛季 |
| 次级联赛 | 入场奖金 7.5；每胜 6.7 / 平 4.8 / 负 2.9 | 每赛季 |
| 冠军杯资格赛 | 止步保底 7.5 | 每赛季 |
| 冠军杯小组赛 | 入场 15；总池 200（不含入场）；每胜 7.0 / 平 2.5；剩余按胜场分配 | 每赛季 |
| 冠军杯淘汰赛 | 8 强 7.5 / 4 强 10 / 决赛 12.5 / 夺冠 +5（可累加） | 每赛季 |
| 超级杯 | 胜 4.0 / 负 2.0 | 每场 |

P0：管理组用奖金模板手动记账（选赛事类型 → 自动算好待确认）；P1：绑定赛事赛果自动计算入账（资格赛/小组赛/淘汰赛状态由比赛系统 tournament→stage 结构判断）。

**增量 11 实现状态（P1 已落地）**：config 键 `prize_table`（JSON，默认=上表原文）+ `worker/prizes.ts`。分界裁决（2026-09-16）：单场可定值的**逐场即时入账**（联赛胜平负/超级杯胜负/小组赛每胜平/淘汰赛晋级），随赛果确认钩子入俱乐部账；一次性项（入场奖金/资格赛止步保底/小组赛剩余池）走「赛事完结结算」按钮一次结清。tour 队 id → club_id 经 AUTH_DB 目录映射（`clubIdByTourTeam`），AUTH_DB 未配置不发奖金（回滚通道口径）；入账一律经 `ledgerMovement` 幂等闸，`ref_type='match_home'/'match_away'`、`ref_id=matchId`（同场重确认/重放不双发）；淘汰赛晋级按「赢下该场后所在轮的队伍数」推档（stage.config_json entry_count，8→7.5/4→10/2→12.5/1→champion+5，征程逐场各领各档）。

**赛事完结结算**：`POST /api/admin/season-bindings/:id/stage-settle`（`settleTournamentStage`）。按绑定 competition_type 发：联赛=每参赛队入场奖金；qualifying=确认赛果里输过至少一场的队各得保底（假设 29）；champions_cup=仅当有过小组赛确认赛果时，剩余池=200−已即时发放（胜 7/平 2.5）按胜场占比分；super_cup 无一次性项只盖结算戳。幂等闸=`season_tournaments.stage_settled_at`（UPDATE NULL→now 原子闸，闸 0 行=并发重复，409）。

### 9.2 富人税（每窗口结束，P1 自动）

```
税1 = 资金 > 125m ? 资金 × 20% : 0
球队价值 = Σ(在册球员违约金 RC) + 资金
税2 = 球队价值 > 700m ? 球队价值 × 5% : 0
富人税 = max(税1, 税2)      # 两项均满足取较多者
```

平台可全量自动算（RC 在 contracts、资金在 ledger_accounts），窗口关闭时由窗口结算流程执行并入账。

**增量 11 实现**：`worker/window-payroll.ts`，关窗批（closeWindow）并入：工资=Σ现行合同 wage 全额（一窗=半赛季扣全额）；`ref_type='window'`、`ref_id=season*100+windowSeq` 幂等闸（关窗状态 UPDATE 行数做原子闸，重放不双扣）；余额可扣成负（欠账下窗自然补扣）。维护费归增量 12（设施模型就位后插本批）。富人税只在窗末收，赛季结算不重复收（假设 28）。

**增量 25 改口径**：①扣款顺序=**富人税 → 工资**（流水顺序同此），税基=`资金` 与 `ΣRC+资金`（**含未扣工资**，不再减本窗工资）——用户裁决「税最先扣，税基不含工资扣除」（假设 28）；②**按窗类型分支**：常规窗（`is_temporary=0`）扣富人税+工资+维护费+冠名收租，临时窗只扣富人税+维护费（不扣工资、不收也不递减冠名租金）；③忠诚奖金自本增量起在**赛季中期窗**（同赛季第 2 个常规窗）关窗时发，不再在赛季结算按钮里发（假设 39/40）。

### 9.3 其他约束

- 禁止玩家间资金借贷（平台不提供任何转账功能，资金流动只经系统事件）。
- 转会费当窗付清：成交即全款划转，无分期（状态机天然满足）。

## 10. 成长引擎（规则 =《5.+球员成长》全文）

### 10.1 XP 事件与计算

| 事件 | XP | 来源 | 限制 |
|---|---|---|---|
| 出场 | 1/次 | 比赛系统自动 | 一线队，仅联赛与冠军杯小组赛 |
| 评分 | 7.0-7.9→1；8.0-8.9→2；9.0-9.9→3；10.0→4 | 管理组补录 | 同上 |
| 进球 / 助攻 | 各 0.5 | 比赛系统自动（match_event goal/assist） | 同上 |
| 进+攻里程碑 | 5→+1；10→+2；15→+3；20→+4；之后每+5→+4 | 自动（累计计算） | 同上；**只累计当前成长期内**（增量 13） |
| 零封 | 0.5/次 | 自动/补录 | 仅防守球员：CDM/LB/CB/RB/GK；无 CDM 则 CM、无边卫则 LM/RM |
| 夺回球权 | 每 12 次 1 | 管理组补录 | 仅防守球员 |
| 扑救 | 每 8 次 1；单场 >8 次额外 1 | 管理组补录 | 仅门将 |
| 训练营球员 | 固定 40/完整赛季；15/半赛季 | 结算时生成 | 不按场次 |
| 中国球员计划 | 每赛季额外 20 | 结算时生成 | china_plan=1 **且在册现行合同**（增量 13） |

去重：`UNIQUE(player_id, match_ref, event_type)`；自动事件由赛果确认钩子生成，补录走管理组界面并留痕。

**成长期（增量 13，用户裁决 2026-09-18）**：里程碑的「累计」只算**当前成长期内**的进+攻。当前成长期 = `growth_periods` 里 id 最大的一行，界 = `start_event_id`（只累计 `growth_events.id > start_event_id` 的事件；**不读 window_seq——成长期与窗口解耦**）；一行都没有时退回全生涯口径（期号 0、界 0，兼容增量 13 之前的行为）。宣告方式两种：管理组在成长引擎「成长期」面板手动宣告（`source='manual'`，审计 `growth_period_declared`），或开窗时勾选「同时宣告新成长期」由 `openWindow` 同批宣告（`source='window_open'`，审计 `window_open` 的 after 带 `growthPeriodDeclared`）。里程碑去重锚 = `milestone:{期号}:{划断序号}:{阈值}`。

**解约重置（增量 13）**：解约（termination）批准时把 players 当前状态归零——`ca = COALESCE(base_ca, ca)`、`growth_xp = 0`、`levels_applied = 0`、`badges_silver = 0`、`badges_gold = 0`（= 恢复初始），同批写一条 `event_type='reset'`、value/xp 皆 0 的划断行（match_ref `termination:{transferId}`）。历史 `growth_events` 一行不删（成长史展示用）；里程碑只累计该球员**最后一次** reset 之后的事件，`reset_id` 进里程碑去重锚。

### 10.2 升级与方案选择

```
每 10 点成长经验 → 升级 1 次（可跨多级结算）
每次升级按成长档位二选一：
  档1: [1CA] | —
  档2: [2CA] | —
  档3: [3CA] | [2CA+1银徽章]
  档4: [4CA] | [2CA+2银] / [3CA+1银]
  档5: [5CA] | [3CA+1金徽章] / [3CA+2银]
```

实现：结算生成「升级待办」→ 教练（或管理组）选方案 → 写入 CA 与徽章计数（badges_silver/badges_gold，上限 15 银/3 金）→ 审计留痕。方案表与徽章效果存 config；徽章身份（具体 PlayStyle）由管理组在 FC 阵容文件落实，平台只记计数（§5.2 简化裁决，球员卡小图标按 PSID 经静态参考表渲染）。

### 10.3 成长档位（初始 1、上限 5，管理组核定）

条件叠加：现实效力俱乐部与游戏队壳一致 +1；第一国籍（会籍）与队壳国家一致 +1；中国国籍（大陆）+1；未来之星 +2；≤18 岁 +1。

### 10.4 换版工具（P2）

| 换版 | 处理 |
|---|---|
| 小换版（同大版本，换阵容名单版本） | 成长经验、CA、徽章全部保留 |
| 大换版（游戏大版本更替，如 FC25→FC26） | 经验清零；成长所得 CA 保留 1/3（向上取整）；徽章按数量保留 1/3（向上取整）随机抽取 |

实现：球员表记录 `base_ca`（非成长所得 CA），换版时 CA = base_ca + ceil(成长CA/3)，徽章按计数保留 ceil(n/3)（计数化后无个体可随机，银/金各自向上取整）。可成长年龄上限按赛季规则（S1≤25/S2≤24/S3+≤23）在赛季结算时判定冻结。

## 11. 赛程绑定与窗口状态机

增量 6.1 层级裁决：**赛季是上集，赛事和窗口是并列的下级**。赛事绑赛季（一赛季多座赛事，一座赛事只进一个赛季），窗口只管转会准入，不再挂赛事。

```
seasons(season=N, status: preparing → running → settled)
  ├─ season_tournaments(tournament_id UNIQUE + competition_type，赛果来源，一赛季多座)
  └─ season_windows(window_seq, status: open → closed，只驱动转会准入)
```

- 绑定后平台跨库拉取该 tournament 的 schedule/matches（只读），赛果 finished 后出现在「赛果确认」队列 → 管理组确认 → 触发奖金（P0 手动/P1 自动）、主场收入、XP 事件；确认时点记录窗口号（确认时刻的开放窗，否则最近一窗，否则 0，见假设 25）。
- 窗口状态机驱动一切准入：窗口 open 才允许转会操作；窗口 closed 触发结算（富人税、维护费、工资）。
- 赛季结算（增量 11 已实现按钮化；增量 25 忠诚奖金移出）：前置体检（硬阻断：窗口未关/审核未清/谈判 active/市场未收尾；软警示：未确认完赛果需 acknowledged=true）→ growable 重判（本季 seasons.age_cap，规则 4.1.1）→ seasons.status='settled'（UPDATE 原子闸，重复 409）。忠诚奖金自增量 25 起改在**赛季中期窗关窗时**发（现合同 `service_ticks` 起算到本窗关窗后的窗刻度，`loyalty_tiers` 取满足的最高档，逐队合并入俱乐部账，幂等 `kind='loyalty' ref_type='window'`）。富人税/工资在窗末收不重复（假设 28）；死忠演化留位增量 12；年龄+1/下季注册重置由「按季独立」天然承载（growable 在下季建档时按新上限重判）。
- 赛事完结结算（增量 11）：绑定赛事全部赛果确认完后，管理组按绑定行点「完结结算」发放一次性项（§9.1），stage_settled_at 幂等。
- 存量迁移（0014）：旧 season_windows.tournament_id 的绑定回填进 season_tournaments，窗口上两列休眠保留。

## 12. 通知系统

| 事件 | 收件人 |
|---|---|
| 挂牌成功 / 下架 / 被激活 | 卖方俱乐部教练 |
| 新出价 / 被超价 / 截止前 1 小时提醒 | 挂牌相关各方 |
| 截止成交 / 审核请求 / 审核结果 | 买卖双方 + 管理组 |
| 签约谈判开启（自动）/ 成约 / 直败结算 / 强制成约 | 签约方俱乐部教练 |
| 激活开启（5 分钟窗）/ 匹配提醒（24h 窗） | 激活方与被激活方 |
| 资金变动（大额） | 俱乐部教练 |
| 窗口开启/关闭、结算完成 | 全体教练 |

实现：`notifications` 表双通道（增量 18）——每个绑定账号一条 `channel='web'` 行（`status='sent'` 免投递，直接进 web 收件篮），绑了 QQ 的另加一条 `channel='qq'` 行由投递器发送（HMAC 签名 POST 到 AstrBot 接收插件，复用竞猜系统对接协议）→ 失败重试（惰性：下次 cron 扫 `channel='qq'` 的 pending）。模板渲染纯代码，无 LLM（P2 事件文案才用 LLM）。web 收件篮端点见附录 A〔18〕。

**AstrBot 侧接收插件规格**（新写一个约 30 行的小插件，协议照抄竞猜 `docs/astrbot-sync-api.md`）：

1. HTTP 端点收 POST；验签 `X-Timestamp`/`X-Sign` = HMAC-SHA256(SYNC_SECRET, `method|path|ts|body`)，时间窗 ±300s（平台与插件各配同一 SYNC_SECRET，`wrangler secret` + 插件配置各存一份）。
2. 消息体 `{qq, template, payload}`：payload 渲染纯代码模板 → `bot.send_private_msg(qq, text)`；qq 未知时忽略并记日志（绑定率不强制）。
3. 返回 `{ok:true}`；平台侧按 HTTP 200 标 sent，否则留 pending 下轮 cron 重试。
4. 绑定命令沿用 §3.3 QQ 桥（`/绑定 6位码` 调平台 API 核销），与赛事/竞猜的 `/绑定` 相互独立、互不冲突（各自插件各自命令域）。

## 13. 可配置参数总表（config 键注册表）

**机制**：D1 `config` 表唯一来源，代码内 defaults 兜底（config 表缺键=用默认）；Worker 端 `config.get(key)` 走 isolate 内存缓存 **TTL 60s**（读多写少，管理端改后 ≤60s 生效，朋友局可接受）；数值键解析失败回退默认（沿插件 defaults 纪律）；**涉密键（§6.10）管理端查看掩码「（内部参数，已隐藏）」，audit 不记新旧值**。下列为全量键名与默认值：

| 键 | 默认 | 说明 |
|---|---|---|
| `tax_rates` | `0.10,0.20,0.40` | 交易税三段梯度 |
| `auction_tax_rate` | `0.5` | 强制拍卖整单税率 |
| `listing_floor_coefs` | `0.5,0.5` | 挂牌价下限系数（0.5RC 与 0.5身价取低） |
| `listing_cap_coef` | `1.5` | 挂牌价上限（×RC） |
| `bid_step_min` | `1` | 抬价最小步长（m） |
| `delist_fee_rate` | `0.10` | 下架费率（×挂牌价） |
| `match_diff_dest` | `burn` | 匹配差额去向（裁决=销毁，保留键防翻案） |
| `deadline_hours` | `18,23` | 竞价截止判定时段 |
| `silence_hours` | `3` | 截止静默时长 |
| `activation_window_min` | `5` | 激活出价窗 |
| `match_window_hours` | `24` | 匹配窗 |
| `trade_calendar` | `none` | 交易日历（none=自然日；json=节假日表） |
| `squad_min` / `squad_max` | `20` / `30` | 一线队人数 |
| `gk_min` | `1` | 门将下限 |
| `trainee_max` | `7` | 训练营上限 |
| `ca_pa_limits` | json（premier:1/4/6；second:1/3/6，规则 4.2.2 原文） | CA/PA 限额梯度（premier/second 两套） |
| `wage_cap` | `null` | 工资帽（m/半赛季，随赛季大名单填入） |
| `prize_table` | json | 赛事奖金表（§9.1） |
| `loyalty_tiers` | `[[0.5,0.05],[1.5,0.10],[2.5,0.20]]` | 忠诚奖金档位 [起效赛季, RC 比例]，取满足的最高档（§11；增量 25 单位由「年」改「赛季」，1 常规窗=0.5 赛季） |
| `luxury_cash_threshold` / `luxury_cash_rate` | `125` / `0.20` | 富人税（资金） |
| `luxury_value_threshold` / `luxury_value_rate` | `700` / `0.05` | 富人税（球队价值） |
| `attendance_model` | json | 主场收入全套系数（revenue 移植，§8；天气概率 40/30/20/10） |
| `tier_table` | json | 球场档位 0-4（座位区间/维护费/上座系数/升级费） |
| `facility_prices` | `0.1,3,5,8,12,16` | 首位=扩建单价（M/100 座），后五位=子设施升到 1-5 级费用 |
| `maintenance_table` | json | 设施维护费表 |
| `voucher_refund` | `0.25` | 建设券返还比例 |
| `xp_per_level` | `10` | 每级经验 |
| `upgrade_plans` | json | 升级二选一方案表（§10.2） |
| `tier_conditions` | json | 成长档位条件（§10.3） |
| `trainee_xp_full` / `trainee_xp_half` | `40` / `15` | 训练营赛季/半赛季 XP |
| `china_xp_bonus` | `20` | 中国计划赛季加成 |
| `china_badges` | `3` | 中国计划自选银徽章数（离队失效） |
| `badge_cap_silver` / `badge_cap_gold` | `15` / `3` | 徽章持有上限（DB CHECK 同步约束） |
| `wage_param_a` 🔒 | `0.02` | 预期工资系数（§6.7） |
| `wage_param_b` 🔒 | `1.9` | 同上 |
| `wage_param_c` 🔒 | `0.45` | 同上 |
| `attempt_decay` 🔒 | `0.95` | 轮间预期衰减 |
| `sigmoid_slope` / `sigmoid_mid` 🔒 | `-9` / `0.8` | 成功率曲线参数 |
| `satisfaction_thresholds` 🔒 | `0.25,0.6,0.9` | 满意度分档阈值 |
| `agent_tiers` 🔒 | json | 三档直败参数 (0.15,0.30)/(0.25,0.50)/(0.35,0.70) |
| `agent_reroll_prob` 🔒 | `0.3` | 窗口推进档位重掷概率 |
| `wage_min` / `wage_max` | `0.01` / `20.00` | 报价区间（m/半赛季，非涉密） |
| `max_attempts` | `3` | 报价轮数上限（非涉密） |
| `young_blend_age` | `25` | 年轻球员等级混合年龄 |
| `renewal_raise` | `0.05,0.15` | 续约加薪区间（规则 4.3.3） |
| `review_amount_threshold` | `40` | 大额强制审阈值（m；增量 10 落地） |
| `bid_pattern_alert` | `{"windowMinutes":30,"maxRaises":3,"colludeRounds":6}` | 连续抬价/关联出价告警阈值（增量 10 落地） |
| `window_force_settle` | `false` | 关窗遇活跃谈判会话时是否允许强制按 E 结算（假设 12 的开关）〔5〕 |
| `market_bid_paused` | `false` | 全局暂停出价开关；单挂牌级另看 `listings.bid_paused` 列〔15〕 |
| `stadium_max_open_tier` | `1` | 球场档位开放进度（S9 仅开放 0→1）〔19〕 |
| `naming_params` | json（底价 `base` 0.5 / `perCapacityWan` 0.3 / `perFansWan` 0.12 / `terminatePenalty` 0.3；套餐 `stable` 6 窗×0.85、`short` 2 窗×1.25、`bet` 4 窗×0.7 + 达线奖金 ×0.7） | 冠名市场底价与三套餐〔20〕 |
| `results_auto_confirm` | `on` | cron 每 5 分钟自动确认完赛场次（`0`/`off` 关）〔21〕 |

🔒 = 涉密键（§6.10：掩码展示、audit 不记值、不进前端）。

注册表在 `src/core/config.ts` 的 `CONFIG_KEYS` 共 61 条登记（唯一键 59 个——`prize_table` 与 `attendance_model` 各重复登记一次，读取按名取默认，无副作用）；有默认值的键见同文件 `CONFIG_DEFAULTS`，`wage_cap` / `maintenance_table` / `upgrade_plans` / `tier_conditions` 无默认，缺省时 `get` 返回 null。

## 14. 迁移与部署

### 14.0 部署前置（首次上线 checklist）

1. `npx wrangler d1 create whl-club` → 把 database_id 填入 wrangler.jsonc（本地 dev 用模拟，不需要这步）。
2. `npx wrangler d1 migrations apply whl-club --remote` → 建表。
3. **部署域必须是 `.whleague.win` 子域**（如 club.whleague.win）——共享登录 cookie `whl_session` 由赛事系统种在主域，子域才能读到；平台自己不种任何 cookie。
4. KV（共享会话）与 R2（whl-media）复用比赛系统资源，wrangler.jsonc 已带 id/桶名，无需新建；部署账号 token 需 D1+KV+R2+Workers 部署权限。
5. cron 触发器随 `wrangler deploy` 自动注册（*/5）；部署后跑一次 `POST /api/cron/tick`（X-Cron-Key，secret 存 `wrangler secret put`）验证结算通道。
6. `wrangler secret put CRON_KEY` 设置内部 cron 密钥（附录 A 的 tick 端点用）。
7. observability 已在 wrangler.jsonc 开启；Smart Placement 部署后 ~15 分钟热身属正常。

### 14.1 数据迁移

| 来源 | 数据 | 动作 |
|---|---|---|
| revenue 插件（有少量记录） | club_balance 余额、stadium 基础字段（容量/等级/死忠/影响力）、设施等级 | 一次性导出脚本（SQLite → CSV/JSON）→ 平台导入工具写入 `ledger_accounts`（kind=opening_import）与球场字段；量小到几十行，管理组手工重录亦可接受 |
| growth 插件 | 未启用，零迁移 | 球员名单 CSV（uid/姓名/球队）直接进平台导入 |
| negotiation 插件 | 未启用，零迁移 | — |
| 比赛系统 | 账号/赛事 | 不迁移，共享与绑定 |
| 积分系统 | 不动 | — |

Cutover 步骤：①平台部署 → ②导入期初余额与球场数据 → ③管理组演练一个完整测试窗（挂牌→竞价→截止→审核→成交）→ ④公告切换，关闭三插件写入口（下线命令）→ ⑤插件代码与 db 保留不删。回退 = 重新启用现行半手动流程，无沉没成本。

## 15. 假设与待办

分类口径：**已定** = 已裁决并落地（每条的落地位置见 ROADMAP 对应增量节的「裁决 / 交付」段）；**假设** = 仍开放，待确认或待数值输入；**已解决** = 调研或映射类问题已闭环；**可配置** = 等外部数值填 config，不阻塞开发；**已执行** = 生产侧动作已完成；**已撤销** = 被后续裁决推翻。编号沿用历史编号，不重排（27 号原排在 28/29 之后，已归位到 26 号之后）；新增条目续编。

| # | 类型 | 内容 |
|---|---|---|
| 1 | 假设 | 交易日 = 自然日（可配置交易日历），待确认 |
| 2 | 可配置 | 工资帽数值：随每赛季大名单填入 config，不阻塞开发 |
| 3 | 已定 | 工资/谈判判定整套移植谈判插件 `formula.py` 实公式（§6.7），参数默认取插件现值全部可配置，「占位系数校准」待办撤销 |
| 4 | 已定 | FC 属性字段 = FC Editor 表头 61 列（§5.2）全量入 game_attrs；徽章效果随 Playstyles 映射确认后定义 |
| 5 | 假设 | 忠诚奖金 2-2.5 年档按 1.5-2 年档（10%）处理，可配置 |
| 6 | 假设 | 激活出价窗开启即消耗「一窗一次」额度 |
| 7 | 假设 | 监管量化标准（规则引用的 8.1.1/8.1.4 不在手头）= 管理组裁量 + 阈值可配置 |
| 8 | 假设 | 联网调研同类玩法（Hattrick/FPL/FM）未能成功（官方 wiki 403、FPL JS 渲染、Wikipedia 超时），经济参照以现行规则与 revenue 插件实测为准，未引入外部来源数值 |
| 9 | 已解决 | CA=overallrating、PA=potential 映射：FC26db 官方列名直接为 CA/PA，且 playerid=ID 同键已验证（§5.2） |
| 10 | 已解决 | 徽章闭环定稿：映射 银=银槽 `PSID1-12`、金=金槽 `PSID13-15`（PS+ ID=基础+100，§5.2）；台账只记计数 badges_silver/gold（CHECK 上限 15/3）；**比赛效果由 FC 游戏引擎原生承担，平台无效果逻辑**（比赛在真实 FC 中进行，平台只读赛果）；发放时选具体 PlayStyle 属管理组操作（发放界面可给选择器生成落地清单，操作辅助非数值计算）；前端按 PlayStyleID 静态参考表渲染名称与小图标（`assets/icons/playstyles/{id}.webp` 约定，资产包实现阶段补，缺图降级 🥇🥈）。**筛选口径（增量 27 收口）**：筛银徽章**只比银槽**、筛金徽章**只比金槽**，不再「基础 ID 或其 +100 命中任一槽」（旧语义下筛银徽章会捞出只挂金徽章的球员）；参数白名单 = 银 1-99 ∪ 金 101-199（去重 + 上限 100 项）。**渲染口径（增量 29 收口）**：属性页与列表都按槽位渲染**全 15 槽**（银 `PSID1-12` + 金 `PSID13-15`），与筛选/导入同源（`PS_SLOT_KEYS` 由 `PS_SLOT_COUNT` 派生；原先的「属性页只渲染 `PSID1-7`+`PSID13-15` ⇒ `PSID8-12` 可筛不可见」已消除）；槽号是 **1 起**（列表 `psNames` 的数组下标须 `+1` 再传 `playstyleIsGold`）。徽章墙的「🥈 x/15」那个 **15 是台账计数上限** `badge_cap_silver`（config，DDL CHECK 0..15），与「12 个银槽」是两个口径，别混 |
| 11 | 已解决 | 国籍代码表：FC26db 内嵌 NationID 219 国（中国=155 China PR），导入工具随源消费（§5.2） |
| 12 | 假设 | 窗口推进遇活跃谈判会话默认阻塞，管理组可强制按 E 结算/取消后推进（§6.4 不变式 6），开关可配置 |
| 13 | 已定（增量 25 改窗刻度） | 保护期判定 = **转会窗刻度**：`contracts.protection_ticks`（= 签约基数 + 3 个常规窗）×`season_windows.is_temporary=0`；`当前已关常规窗数 < protection_ticks` 即在保护期内。训练营合同无保护期（NULL）。旧列 `protected_until`（曾按 signed_at + 548 天）保留留档、判定不再读 |
| 14 | 已定（增量 25 改窗刻度） | 效力 = **0.5 × (已关常规窗数 − contracts.service_ticks)**（1 个常规窗关窗 = 0.5 赛季，临时窗关窗不推进）；解约费阶梯、激活效力校验、忠诚奖金分档、球员库筛选共用此口径。旧口径「实际天数 ÷ 365.25、不足 1 年按 0 计」作废 |
| 15 | 已定 | 旁路附加费（续约费/解约费/海捞签入费/匹配差额）在审核通过时收，不随提交扣款；提交时只做可用余额预检；收费以 (kind, ref) 幂等闸防重试重复扣（§7.4） |
| 16 | 已定 | 匹配新 RC 不受 4.4.6 幅度约束（新 RC 须 > 首价即可，差额销毁本身是代价）；生涯每名球员只能被匹配一次 |
| 17 | 已定 | 激活挂牌无公开竞价段（§6.2 修正定稿）：5 分钟首价窗内激活方落价即成交价，首价后训练营球员直进待审、正式球员进 24h 匹配窗；激活挂牌永不开放后续竞价 |
| 18 | 已定 | 4.4.10 窗内回滚口径：还原 RC 与保护期（仍归属原队时）+ 退还续约费（rc_change_refund）；工资不随回滚（已谈成的工资是谈判终局，恢复会破坏谈判快照口径） |
| 19 | 已定（增量 13 补全「恢复初始」= 数值归零 + 历史留档） | 解约属性恢复：CA 恢复 base_ca（players.base_ca 缺省时保持现 CA），growth_xp / levels_applied / badges_silver / badges_gold 全部清零；同时写一条 `event_type='reset'`（value/xp=0，match_ref `termination:{id}`）作划断行，历史 growth_events 行保留供成长史展示，里程碑只累计最后一次 reset 之后的事件；合同行 is_active=0 留档（复签海捞走 UPSERT 翻新，contracts.player_id 全局唯一） |
| 20 | 已定（增量 13 补 CPU 例外） | 自动 XP 球员匹配：比赛系统队名 = 平台俱乐部名 → 比赛系统球员名 = 平台名单名（clubs 无 tour team 键、tour player.id 与平台 uid/fc_id 无关，不建映射表）；解不开的进 confirm 响应 `xp.unresolved` 由管理组补录兜底；**CPU 队（队名带 (CPU)）例外：整队静默跳过，不进 unresolved**（假设 36） |
| 21 | 已定 | own_goal / 红黄牌 / 伤停事件不记 XP（§10.1 无对应项）；同场同类型多事件按「球员×类型」聚合成一条（去重锚 UNIQUE(player_id, match_ref, event_type) 一场一类型只容一行，value 记次数、XP=单次×次数）；进球含 goal 与 pen_goal |
| 22 | 已定 | XP 计入范围 = league_premier / league_second 全部场次 + champions_cup 仅 stage.kind='group'（小组赛）；super_cup / qualifying / 冠军杯淘汰赛不计；弃权场（walkover_side 非空）不计；训练营球员不按场次（走赛季结算固定 XP） |
| 23 | 已定（增量 18 补 web 收件篮） | 通知收件人解析 = 俱乐部绑定教练（club_bindings）→ qq_links.qq，未绑 QQ 静默跳过（§12 绑定率不强制）；通知排队与投递尽力而为，不阻塞确认/升级主流程；web 收件篮已在增量 18 落地（端点 `/api/notifications` 系列，非原设想的 `/api/me/notifications`），未读判定用独立列 `read_at` |
| 24 | **已撤销**（增量 14 裁决 4） | 球员初始归属 `initial_club_id`（0015 立）**已删除**（迁移 0020 `DROP COLUMN`）：它从不参与成长判定（「本队」一律看 `players.club_id`），只是球员库初始视图一列 + 球员卡一行字，用户裁定「无意义，去掉」。球员库 `view=initial` 保留 CA=base_ca、PA=导入值的口径；归属列两种视图都显示**当前**归属 |
| 25 | 已定 | 赛果确认记录的窗口号 = 确认时点：确认时刻的开放窗，否则最近一窗，否则 0（增量 6.1：绑定不再依赖窗口，窗口号仅作入账归属标记） |
| 26 | 已定（增量 7） | 球队绑定真源上收 auth（三表 team/team_bind_code/team_binding；机器端点五条 HMAC）；本侧旧表 club_bind_code/club_bindings 休眠保留防回滚，AUTH_DB 未配置时回落读本地表（回滚通道）；发码 team_not_found 不自动登记目录（提示先登记关联，与 tour 侧自愈 register 不同）；OIDC 教练判定=绑定即教练（管理点仍走权限点；未绑定的准教练凭 club.* 权限点保留旁路进绑前端点） |
| 27 | 已定（增量 9） | 俱乐部分级不再建队时定死（clubs.league_tier 休眠）：当季级别由「auth 目录 club_id↔tour_team_id → season_tournaments 定级赛事（仅 league_premier/league_second，杯赛不参与）→ TOUR_DB entry 报名」三跳派生（worker/tier.ts）；注册提交派生不到级别一律 400 拦下（tier_pending「尚未在赛事平台报名，请等待赛事平台管理员确认报名」），注册页带报名状态探测（红=未报名/绿=已报名）；同时报两座定级赛事视为数据异常 500；AUTH_DB 未配置时回落读休眠列（回滚通道）；升降级=换季报名哪座定级赛事就在哪级，club 库零人工写入 |
| 28 | 已定（增量 11；增量 25 改税基） | 富人税/工资只在窗末（closeWindow 批）收，赛季结算不重复收（§11 结算顺序里「富人税」步即窗末已收项，结算按钮不再扣）；工资=Σ现行合同 wage 全额、一窗=半赛季扣全额；**税最先扣，税基取未扣工资的余额**（`资金` 与 `ΣRC+资金` 两项取多），临时窗只收富人税不扣工资 |
| 29 | 已定（增量 11） | 资格赛止步保底口径：确认赛果里输过至少一场的队各得保底 7.5，多轮晋级失败口径一致（不区分止步轮次）；赢家不发 |
| 30 | 已定（增量 12） | 比赛日天气在赛果确认时按概率掷出并固化（晴 40/多云 30/雨 20/雪 10），同场不重掷（§8 上座公式天气系数；确认即入账的输入之一） |
| 31 | 已定（增量 12） | 近 3 场战绩口径 = 平台已确认赛果（不含本场）：胜 3 平 1 负 0，**点球决胜按平局计**（用户裁决 2026-09-16），弃权按 winner 记胜负，不足 3 场取中性 4 分 |
| 32 | 已定（增量 12） | 球员影响力闸门 = 在册现行合同（`contracts.is_active=1 AND contracts.club_id = players.club_id`），**不看 players.club_id**；无合同/已解约不计入球队影响力 |
| 33 | 已定（增量 12） | 维护费 = 档位基础(2.0-14) + 每万座费率(0.8-0.2)×容量(万) × 本窗已确认主场场次，并入关窗批，`kind='maintenance' ref='window'` 幂等 |
| 34 | 已定（增量 13） | 成长期 = 里程碑累计边界（用户裁决 2026-09-18）：由管理组手动宣告或开窗时勾选自动宣告，**不与窗口绑定**（一个赛季可有多个成长期，通常落在两个窗口之间，也可能变）；界 = `growth_periods.start_event_id`（只累计其后事件），无宣告行时按全生涯口径 |
| 35 | 已定（增量 13） | 中国球员计划 XP（每季 +20）闸门 = `china_plan=1` **且在册现行合同**（与训练营同口径，用户裁决 2026-09-18）；无归属/已解约的中国球员不发 XP |
| 36 | 已定（增量 13 立、增量 14 收口） | CPU 队判定 = 比赛系统队名以半角「(CPU)」结尾（**严格匹配**，不做全角括号/大小写/首尾空格容错：队名即口径，改名即重新判定）。CPU 队球员**无成长**（`results.ts` 的 `resolve()` / `queueResultNotifications()` 两处队名→俱乐部解析整队静默跳过：不计 XP，也不进 `xp.unresolved`），但在**转会意义上视同海里球员**（可被海捞、可被认领）。增量 14 落地（用户裁决 2026-09-18 六问逐条）：①平台为 4 支 CPU 队建 clubs 行——`巴塞罗那(CPU)`/`曼城(CPU)`/`RB莱比锡(CPU)`/`AC米兰(CPU)`，name 与 tour 队名逐字一致，id = 游戏真队 id `241/10/112172/131681`；判定复用 `isCpuTeam` 的队名后缀口径（不加列、无迁移）。②其球员建档即带 `club_id`（建档导入只给 `FC26_CPU_TEAM_IDS` 写，见 §5.4），三处「海里球员 = `club_id IS NULL`」闸门放行：海捞名单 `GET /api/market/free-agents`（`src/worker/routes/market.ts:267`，全员附东家名）、海捞签入 `createFreeAgent`（`src/worker/bypass.ts:359`，且 `fromClubId` 记 CPU 队 id，过户守卫才摘得走人）、通道 C 合同导入认领（`src/worker/contracts-import.ts:122/135/212`）。③CPU 队**一律不入账**：`clubIdByTourTeam` 白名单过滤（`src/worker/prizes.ts:70`，auth 目录里 club_id 照补、但奖金与主场收入不发）、强制拍卖拒绝 CPU 队球员（`src/worker/bypass.ts:435`）；中国计划 XP 因无平台合同不发（假设 35），主场收入因无球场行天然不发，管理组手工补录不受限（人工判断）。实现：`growth.ts` 的 `isCpuTeam()` + `CPU_CLUB_IDS_SQL` + `cpuClubIds(db)`（SQL 侧用 `substr(name, -5) = '(CPU)'`，与 `isCpuTeam` 逐字对齐，避免 LIKE 的大小写不敏感造成两种口径分叉） |
| 37 | 已定（增量 14 裁决 3） | 队 id 口径 = **游戏真 id**：EA 未授权的 4 支俱乐部在游戏里用假名 + 新号（AC Milan → `131681` Milano FC、Inter → `131682` Lombardia FC、Lazio → `115841` Latium、Atalanta → `115845` Bergamo Calcio），而第三方 fixed 快照（`FC26db20251217_fixed.xlsx`，即导入源与 `scripts/gen_ref_json.py` 的源）仍带旧 FIFA 号（`39/44/46/47`）——EAFC 26 IDs 表的 1..199 段里这 4 个号整段不存在（假名↔真身对应关系靠 FC Editor 的 `player_tables/{id} - {Team}.xlsx` 球员名单逐队核对确认）。口径：`clubs.id` 与 `players.club_id` 都落游戏真 id；`src/core/fc26.ts` 的 `FC26_TEAM_ID_ALIASES`（39→115845 / 44→131682 / 46→115841 / 47→131681）在导入归一化时一次性换号（同时写进 `game_attrs.TeamID`），保证**重跑导入落在同一 id 空间**；**对外显示名仍是真名**——`web/assets/ref/team.json` 补 4 条「真 id → 真名」，`scripts/gen_ref_json.py` 的 `TEAM_NAME_OVERRIDES` 保证再生成不丢，旧 id 条目刻意保留（未重键的历史 `game_attrs` 仍要显示得出队名）。受影响面：游戏表 1..199 段缺失号 ∩ 平台实际出现的号 = `{39,44,46,47}`。计数口径务必区分：**107 人** = 4 支 CPU 队球员（巴萨 28 + 曼城 26 + 莱比锡 29 + 米兰 24，假设 36）；**105 人** = 4 支游戏假名队球员（亚特兰大 27 + 国米 24 + 拉齐奥 30 + 米兰 24），两集合只在米兰 24 人重叠 |
| 38 | 已执行（2026-09-19 生产） | 增量 14 的生产动作，全部跑完并逐条复查：①建 4 支 CPU 队 clubs 行（id `241/10/112172/131681`，name 如上，status='active'）；②107 名 CPU 队球员 `club_id` 回填（复查分布 10→26/241→28/112172→29/131681→24）+ 105 名假名队球员 `game_attrs.TeamID` 重键（复查 115841→30/115845→27/131681→24/131682→24，旧号 39/44/46/47 清零）；③auth 目录 `team` 补 4 行 club_id——**实测 tour_team_id 已是 FC id 空间**（10→10 / 241→241 / 112172→112172 / **47→131681**，米兰跨号映射；原计划的 tour 6/16/19/21 口径作废）；④迁移 0019+0020 已 apply（先补 0016–0018 三条记账，否则 `migrations apply` 会从 0016 重跑报对象已存在），worker 与前端已同批上线。工件 `scripts/prod-20260919-increment14/00..04-*.sql`（各带期望 changes 与回滚语句）。⑤**米兰队 id 收口 131681**（同日追加，`scripts/prod-20260919-milan-rekey/01-tour-rekey-team-id.sql` + `02-auth-tour-team-id.sql`）：tour `team.id 47→131681` 连带 `player.team_id` 25 行、`entry.team_id` 2 行（其余 6 张引用 `team(id)` 的表在 47 上 0 行），auth `team.tour_team_id 47→131681`（club_id 早已是 131681）；这样 tour id / auth `tour_team_id` / auth `club_id` / 平台 `clubs.id` 四个空间米兰全为 131681，平台按 tour id 反查不再需要跨号映射。执行通道约束：**必须 `--command`**（`PRAGMA defer_foreign_keys = ON` 在 `--file` 通道下失效 → 父行先改被 FK 立即拦下并整批回滚）；`audit_log.target_id=47` 的 10 行是 `target_type='match'`（比赛 id 撞号）**不得修改** |
| 39 | 已定（增量 25） | 窗分型与效力推进点：转会窗分**常规窗**（季初/中期，同赛季最多 2 个——第 3 个非临时窗硬拦 409）与**临时窗**（管理端开窗勾选 `temporary`）；只有常规窗关窗推进效力（+0.5 赛季）与保护期计数（`season_windows.is_temporary=0`），临时窗关窗不推进。季初/中期不落库，按同赛季非临时窗的 `window_seq` 顺序派生（第 1 个=季初、第 2 个=中期，见 `src/worker/contract-ticks.ts`）。效力基数 `contracts.service_ticks` = 签约时点已关常规窗数（运行期签约取当下计数；导入历史合同按 `effective_from` 截断取值） |
| 40 | 已定（增量 25） | 临时窗扣费口径 + 忠诚奖金中期发：临时窗关窗只扣**富人税 + 维护费**（死忠照演化），不扣工资、不收冠名租金也不递减 `windows_remaining`；常规窗扣富人税+工资+维护费+冠名收租。忠诚奖金在**赛季中期窗**（同赛季第 2 个常规窗）关窗时发一次（`loyalty_tiers` 按窗刻度赛季分档、逐队合并成一条流水、幂等 `kind='loyalty' ref_type='window' ref_id=season*100+seq`），赛季结算按钮不再发放 |

**增量 14 实现状态（CPU 队与队籍口径，代码已推送、生产数据侧 2026-09-19 已执行）**：迁移 0020（删 `initial_club_id`）；`core/fc26.ts` 加 `FC26_TEAM_ID_ALIASES`/`normalizeTeamId`/`FC26_CPU_TEAM_IDS`；`core/import.ts` 的 `NormalizedPlayer` 增 `clubId`（`clubIdForTeam`：只有 4 支 CPU 队写）与两通道的 `gameAttrs.TeamID`/`teamid` 归一化；`players-import.ts` 的 `upsertStatement` INSERT 加 `club_id`（DO UPDATE 不含）；`growth.ts` 加 `CPU_CLUB_IDS_SQL`/`cpuClubIds`；`routes/market.ts` 海捞名单放行 CPU 队并返回 `clubName`（上限 100→300：池里多了 107 名 CPU 球员）；`bypass.ts` 海捞放行 + `fromClubId` 记原队、强制拍卖拒绝 CPU 队球员；`contracts-import.ts` 认领放行；`prizes.ts` 入账过滤；`routes/players.ts` 删 `initial_club_id` 出口（`view=initial` 保留 CA/PA 口径，归属列两视图都打当前归属）；前端 `web/src/lib/api.ts`、`pages/{PlayersLibrary,Player,Market}.tsx` 同步；`web/assets/ref/team.json` + `scripts/gen_ref_json.py` 补 4 条真名。测试：新增 6 组用例（队籍与别名、通道 C 认领 CPU 球员、海捞 CPU 球员全链、强制拍卖拒绝、CPU 侧不入奖金、`clubIdByTourTeam` 过滤）+ `players-library` 四处改造；**316 测试绿 + 三份 tsc 干净 + vite build 通过**。

## 16. 测试策略

- **纯函数单测**：税公式（边界：P=RC/1.5RC/0）、富人税（两项取多）、上座与收入、XP 计算（评分档位/里程碑/去重）、挂牌价上下限、解约费、激活倍数、签约判定族（E 幂律/续约加薪/sigmoid/直败边界/强约——**仅数值断言，见 §6.10-7**）。
- **状态机测试**：六类操作全路径（含顺延、无人出价、匹配、回滚 4.4.10、signing 自动开启与三种成约）用内存 D1 跑迁移与断言。
- **并发测试**：同一挂牌并发出价 → 冻结与成交不双花（D1 串行写验证）。
- **迁移演练**：revenue 导出样例 → 导入 → 对账。

## 17. D1 rows read 开发规约

D1 按「查询扫描过的行数」计费（索引扫描同样计入，免费档每天约 500 万行读），开发全程按本节执行。手法提炼自比赛系统 WHL-tournament-management-system 的实测经验——其 `migrations/0012_perf_indexes.sql` 与 `migrations/0018_read_quota_indexes.sql`（文件名即"读配额"）就是行读配额被吃掉后的补救与教训。

### 17.1 索引规约（最大头）

1. 只增表（`ledger_entries` / `audit_log`）**上线即建** `(kind, id)`、`(target_type, target_id, id)` 型索引——比赛系统是配额报警后才补的，不重演。
2. 高频过滤+排序的列表直接建带排序尾列的复合索引：`listings(status, listed_at DESC)`、`bids(listing_id, amount DESC)`、截止扫描专用 `listings(status, deadline_at)`——让「最新 N 条」与 cron 扫描只走索引区间，免全表扫、免排序。
3. 外键列全部配索引；上线后定期清理与 UNIQUE 前缀重复的冗余索引（纯写放大）。
4. 排序表达式里带 `COALESCE` 的列表建**表达式索引**：如球员库按 CA/PA/年龄/身价排序，建 `CREATE INDEX idx_players_sort_ca ON players(COALESCE(ca, 0), id)`（增量 23，迁移 0027，四条同构）——让「排序 + 游标」走覆盖索引，消掉全表扫与排序步骤（本地 `EXPLAIN QUERY PLAN` 实证为 `SCAN players USING COVERING INDEX idx_players_sort_*`）。增量 28 同法补 `0029`（声望 / 归属 `COALESCE(club_id,0)` / 状态 CASE 权重三条）与 `0030`（`players(club_id, ca DESC, id)`，为海捞名单的驱动表连接备）；**表达式必须与 `buildSortExprs` 逐字一致，否则优化器静默不用索引**（增量 28 实测：`sort=club`/`status` 在 0029 之前 37,635 行、之后 43/22 行）。三条纪律：① 一条索引 ≈ 全表一行写（18,301 名球员），免费档日写 10 万行 ⇒ 每天最多 3 条；② 表达式行数多的键（姓名折叠 87 项链、PlayStyle 15 槽计数）建前先过 **D1 表达式树深度上限 100** 的体检；③ **迁移一旦 apply 到生产就不得再改**。

### 17.2 查询规约

1. 禁 N+1：批量 `IN (...)` 取扁平行 + JS 里 Map 归组；D1 单查询 bind 上限 100，约定 **90 一批**分块、批间 `Promise.all` 并行。
2. 显式列清单，禁 `SELECT *`。
3. 列表页一律硬 LIMIT + 游标翻页（`before` 时间戳/序号），**不算总数、不用 OFFSET**；COUNT 仅用于廉价守卫（所有权校验、`n>0` 布尔）。审查口径（增量 28）：**响应契约里不带 `total`** —— `GET /api/players` 只回 `players` + `nextCursor`（一次 56 行），前端翻页条改游标式文案；确实需要总数的地方（管理端筛选计数）走带 `CRON_KEY` 的内部端点 `GET /api/cron/players-count`，或把 COUNT 挂到与列表同 scope 的两级缓存上（`countAllPlayers`）。**去 COUNT 是本项目读量治理的最大单笔**：默认浏览一页 18,819 行里 COUNT 占 18,763 行（99.7%），且它不带游标、每翻一页重算整表。
4. 单语句原子写消灭读-改-写：条件更新 `UPDATE ... SET balance = balance + ? WHERE ... AND balance + ? >= 0`；upsert `ON CONFLICT DO UPDATE ... RETURNING` 一条语句完成变更+回读。
5. 资格/上下文校验压成一条 JOIN 查询，不串行多趟往返。
6. 昂贵聚合**写时算**（仿比赛系统 standings：报分时全量重算派生表、与业务写入合并进同一 batch）；读路径只做索引点查/小区间 JOIN。
7. **不能静态索引的表达式就换写法，别硬加索引**（增量 28 海捞名单实例）：`WHERE club_id IS NULL OR club_id IN (子查询) ORDER BY ca DESC LIMIT 300` 在生产 97% 球员无归属的数据下退化为 `MULTI-INDEX OR` + 临时排序 ⇒ 先试索引无效（4 种列组合都不消 `TEMP B-TREE`），改成 `UNION ALL` 两分支 + CPU 支用 **`FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id`**（小表当驱动、固定连接顺序）后 36,274 → 843 行，结果集逐行不变。SQLite 约束：复合 SELECT 的分支不能自带 `ORDER BY`/`LIMIT`，必须包一层子查询。
8. **判断「D1 是否可用」不能用这三条**（增量 28 教训）：`/api/health` 只读 `sqlite_schema`、`wrangler d1 execute --remote` 是管理通道、`/api/clubs/directory` 缓存键固定且 stale 刷新吞错 —— 配额触顶时它们全是 200，而 worker 侧真实表读全 500。要看真错误文本：临时给 onError 加诊断字段 + `wrangler dev --remote`（本地代码 + 生产绑定，不需部署）。

### 17.3 事务与缓存规约

1. **钱的原子性比比赛系统更严**：一笔业务（流水 + 余额 + 审计）合并进单个 `db.batch`（隐式事务）一次提交；比赛系统终场「先写后重算」的两段式仅适用于幂等可重算的派生表，**账本禁用**。
2. 公开 GET 走 `src/lib/guard.ts`（增量 23 起，增量 28 重做缓存层）：`assertPublicRate(c, scope)` 按同 IP 60 次/60 秒限流（超限 429）；`cachedJson(key, ttlMs, loader, { scope, env, ctx })` 是**两级缓存**——L1 进程内（`Map`，上限 64 条按插入序淘汰）+ L2 边缘 Cache API（跨 isolate，合成 URL 作键，`cache-control: max-age` 管过期，全程 try/catch 旁路）。TTL 口径单一来源 `src/lib/cache-policy.ts`：列表 1h、名册 24h、目录 24h（`PUBLIC_CACHE_TTL_MS` 退化为显式覆盖，配 `0` 即旁路、生产不配）。缓存键 = `${scope}:v${epoch}:${canonicalQuery}`（`canonicalQuery` 参数顺序无关）。
3. **新鲜度靠写路径 purge，TTL 只是兜底**（增量 28 裁决⑩）：代际键 `cache:epoch:public` 存 KV（isolate 记忆 5s），写路径 bump 一次 = L1 与 L2 同时失效；键空间无穷（筛选 × 排序 × 游标）且 Cache API 无前缀删除、`cache.delete` 只作用于当前 colo，所以不能按键枚举 purge。挂钩只有两处：`src/worker/index.ts` 的 `/api/*` middleware（非 GET/HEAD + 响应 2xx + `scopesForWritePath` 命中）与 `scheduled()`（tick 真改了数据才 purge）。KV 读失败时本次请求按 60s 短 TTL（fail-short，宁可多读不可陈旧）。**不用 KV 存载荷**（增量 23 裁决仍成立）：KV 免费档写约 1k 次/天，且该绑定与登录会话共用，公开 GET 每请求写缓存会打爆写配额。
4. R2 媒体一律版本化 key + `Cache-Control: immutable` 长缓存，同 PoP 重复浏览不打 R2。
5. 公开路径跳过会话检查（每请求省一次 KV get + D1 user 点查）。

### 17.4 反模式黑名单（比赛系统踩过/残留的）

1. 逐行相关 COUNT 子查询——rows_read 随「行数 × 子表行数」增长。
2. 冷缓存未命中一次 20-40 查的重读路径（feed 教训）——聚合类宁写时物化。
3. 两段式非原子写——对积分可幂等自愈，对钱禁止。
4. 每次写全量重写大派生表——写放大 O(集合大小)，需自知规模边界。

## 附录 A · API 路由清单（契约冻结首层）

权限列：👤=coach 及以上 / 🛡=管理组 / 🌐=公开。分页一律硬 LIMIT + 游标（§17）；错误统一 `{error, code?}`。标〔增量 n〕= ROADMAP 对应增量交付。

> **冻结范围**：本表冻结于增量 6 era（末次整体维护），增量 7 起新增/变更的端点**不回填本表**，以 ROADMAP 各增量节的「交付」段与 `src/worker/routes/` 现码为准——回填会造成文档与实现双轨漂移。增量 7+ 的主要新增面：认证四端点（`/api/auth/login|sync|callback|logout|backchannel-logout`，增量 7）、球员库扩展与批量维护（增量 17）、俱乐部目录与换队号（`/api/clubs/directory`、`/api/admin/clubs/tour-team`、`register-auth`、`transfer-ban`，增量 17）、通知三端点（增量 18）、设施与冠名（`/api/club/stadium/*`、`/api/club/facilities/upgrade`、`/api/club/naming/*`，增量 19/20）、赛果自动化（`/api/admin/results/:id/replay-hooks`，增量 21）、球员库姓名去变音搜索与轻量名册端点 `GET /api/players/roster`、排序键扩到 29 列（增量 26）、球员库 PlayStyle 筛选语义改「银值只比银槽 / 金值只比金槽」且 `ps` 白名单改「银 1-99 ∪ 金 101-199」（无新增端点，增量 27）、`/api/admin/overview` 与 `/api/admin/audit-log`（增量 15）、`GET /api/cron/players-count`（增量 28，内部计数端点：`CRON_KEY` fail-closed、只认 `X-Cron-Key` 头；同轮 `GET /api/players` 去掉响应里的 `total`，契约改为只有 `players` + `nextCursor`）。

| 模块 | 端点 | 权限 | 说明 |
|---|---|---|---|
| 系统 | GET `/api/health` | 🌐 | 三资源可达性 |
| 系统 | GET `/api/me` | 🌐 | 登录态（null=未登录） |
| 俱乐部 | POST `/api/admin/clubs` | 🛡 | 建队〔1〕 |
| 俱乐部 | GET `/api/admin/clubs` | 🛡 | 俱乐部列表（含绑定状态/最近认证码）〔1〕 |
| 俱乐部 | POST `/api/admin/clubs/:id/bindcode` | 🛡 | 生成 8 位认证码〔1〕 |
| 俱乐部 | POST `/api/clubs/bind` | 👤 | 认证码绑队〔1〕 |
| 俱乐部 | GET `/api/me/club` | 👤 | 我的球队概览（余额/名单数/窗口态）〔1〕 |
| 俱乐部 | POST `/api/admin/bindings/unbind` | 🛡 | 解绑〔1〕 |
| 系统 | GET `/api/admin/config` | 🛡 | config 键注册表（涉密键掩码，§13）〔1〕 |
| 球员 | POST `/api/admin/players/import/preview` · `/confirm` | 🛡 | 导入管线两段式（§5.4）〔1〕 |
| 球员 | GET `/api/players/:id` | 🌐 | 球员卡数据〔1〕 |
| 球员 | GET `/api/players?club_id=&status=&cursor=` | 🌐 | 球员列表〔1〕 |
| 球员 | PATCH `/api/admin/players/:id` | 🛡 | 改身价/状态/档位等（审计）〔1〕 |
| 球员 | POST `/api/admin/players/attributes-batch` | 🛡 | 属性批量维护（P1）〔7+〕 |
| 注册 | GET `/api/club/squad` · POST `/api/club/registrations` | 👤 | 名单与提交校验〔2〕 |
| 注册 | GET `/api/admin/registrations?season=` | 🛡 | 注册快照查询〔2〕 |
| 注册 | GET `/api/admin/compliance?season=` | 🛡 | 准入体检报告（P1 首版：对快照重跑合规引擎，只报告不触发强制拍卖）〔2〕 |
| 市场 | GET `/api/market/listings?status=&cursor=` | 🌐 | 挂牌板（卡柜；含匹配窗字段 matchDeadline/matchPhase）〔3〕 |
| 市场 | POST `/api/market/listings` | 👤 | 挂牌（价格校验+冻结检查）〔3〕 |
| 市场 | GET `/api/market/listings/:id` | 🌐 | 详情+出价历史〔3〕 |
| 市场 | POST `/api/market/listings/:id/bids` | 👤 | 出价（冻结先行；激活首价响应带 matchPhase/matchDeadline/settledForReview）〔3〕 |
| 市场 | GET `/api/market/trainees` | 👤 | 可激活训练营名单（含本窗已激活标记）〔3〕 |
| 市场 | POST `/api/market/activations` | 👤 | 激活挂牌（`/api/transfers/activation` 的同义早期路径）〔3〕 |
| 市场 | GET `/api/market/free-agents` | 👤 | 自由球员名单（海捞候选；标记本窗禁签）〔5〕 |
| 市场 | GET `/api/me/bids` | 👤 | 我的出价（冻结状态章）〔3〕 |
| 审核 | GET `/api/admin/reviews?status=open` · POST `/:id/approve` · `/reject` | 🛡 | 审核队列（市场成交+旁路单据统一入口，payload 按 kind 渲染）〔3〕 |
| 窗口 | GET `/api/admin/windows` | 🛡 | 赛季与窗口台账〔5〕 |
| 窗口 | POST `/api/admin/windows/open` | 🛡 | 开窗（无在开窗口前置；全球员经纪人性格重掷；body `temporary` 开临时窗；同赛季常规窗上限 2）〔5〕 |
| 窗口 | POST `/api/admin/windows/close` | 🛡 | 关窗（惰性结算→前置校验→closed→窗尾收口；force 需 window_force_settle=true；按窗类型扣费，中期窗发忠诚奖金并回显 loyalty）〔5〕 |
| 拍卖 | POST `/api/admin/forced-auctions` · POST `/:id/cancel` | 🛡 | 强制拍卖建单/取消（1m 挂牌、队内 CA 前六不含门将、整单税 50%）〔5〕 |
| 转会 | POST `/api/transfers/activation` · `/match` · `/free-agent` · `/termination` · `/rc-change` | 👤 | 五类旁路/分支入口〔5〕 |
| 转会 | GET `/api/transfers/:id` | 🌐 | 单据详情〔3〕 |
| 谈判 | GET `/api/negotiations?mine=1` | 👤 | 我的活跃签约谈判〔4〕 |
| 谈判 | POST `/api/negotiations/:transferId/release-fee` | 👤 | 提交新 RC（E 快照）〔4〕 |
| 谈判 | POST `/api/negotiations/:sessionId/offer` | 👤 | 报价（满意度文案返回）〔4〕 |
| 谈判 | POST `/api/negotiations/:sessionId/trainee` | 👤 | 直签训练营合同（0.75/5 双固定，不占下放名额；2026-09 裁决）〔4〕 |
| 赛季 | GET `/api/seasons/current` | 🌐 | 当前赛季/窗口〔6〕 |
| 赛季 | POST `/api/admin/seasons` · `/advance-window` · `/:id/bind-tournament` · `/:id/unbind-tournament` · GET `/:id/tournaments` | 🛡 | 赛季管理〔6〕 |
| 赛果 | GET `/api/admin/results/queue` · POST `/:id/confirm` | 🛡 | 赛果确认（触发奖金/XP）〔6〕 |
| 财政 | GET `/api/club/ledger?cursor=` · GET `/api/club/balance` | 👤 | 流水账〔6〕 |
| 财政 | POST `/api/admin/ledger/opening-import` | 🛡 | 期初余额导入（§14.1，kind=opening_import）〔1〕 |
| 财政 | POST `/api/admin/ledger/manual` | 🛡 | 手动记账兜底〔6〕 |
| 成长 | GET `/api/players/:id/growth` | 🌐 | XP 事件与成长史〔6〕 |
| 成长 | POST `/api/admin/growth/events` | 🛡 | 补录（评分/扑救/夺权）〔6〕 |
| 成长 | POST `/api/admin/growth/settlement/run` | 🛡 | 赛季结算（XP/升级待办；忠诚奖金自增量 25 起在中期窗关窗发 P1）〔6〕 |
| 成长 | POST `/api/growth/levelup/:playerId` | 👤 | 升级方案二选一（本队教练或管理组）〔6〕 |
| 成长 | POST `/api/admin/growth/:playerId/tier` | 🛡 | 档位核定 1-5（§10.3）〔6〕 |
| 通知 | GET `/api/notifications?cursor=` · GET `/api/notifications/unread-count` · POST `/api/notifications/read` | 👤 | web 收件篮（只读本人 `channel='web'` 行，id 倒序游标 30/页；`read` 支持 ids/all，幂等）〔18〕 |
| 通知 | bot 投递（无 web 端点）：cron 每 5 分钟扫 `channel='qq'` 的 pending → HMAC POST 到 AstrBot 插件（§12；写入点=赛果确认/升级，假设 23） | 内部 | QQ 推送〔6〕 |
| 监管 | GET `/api/admin/m0` | 🛡 | M0 报表（Σ余额/冻结/kind 分解/俱乐部明细）〔6〕 |
| 监管 | POST `/api/cron/tick`（X-Cron-Key） | 内部 | 手动触发惰性结算（与 scheduled 等价）〔3〕 |

> 契约细节（出入参 schema）随各增量实现时在前端 api 层与 Vitest 契约测试中冻结；本表只冻结路径/权限/时点，防范围漂移。
