# 设计定稿：运营时刻表 + 统一到期引擎 + 管理端甘特图

来源：用户 2026-10-14 四轮指令与裁决（窗口批次制 / 明标段=现有海捞原样 / 每一种转会操作+消费中心整体可设开始结束时间 / 三种随窗形态且非随窗端填具体时间 / 管理端只读甘特图）。本文件为增量 1（v6.49.0）的设计定稿。

## 1. 两层一套时钟

- **时刻表 = 闸门（同步）**：每行到点开/关，写路径进不来。
- **到期引擎 = 收口器（异步）**：终点到点，把该操作的在途物按规则收口（解冻 / 过期 / 开标）。
- 共用一张表与同一个「终点」边界——运营设一次，闸门与收口自动一致。

## 2. 三种随窗形态（锚只两种取值：随窗 or 具体时间；无 offset）

| 形态 | 起点锚 | 终点锚 | 典型用途 |
|---|---|---|---|
| A 随开窗起、关窗前结束 | `window_open` | `absolute`（具体时间） | 海捞·暗标段（开窗起、到点开标） |
| B 开窗后才起、随关窗结束 | `absolute`（具体时间） | `window_close` | 海捞·明标段（开标后起、随关窗收） |
| C 随开窗起、随关窗结束 | `window_open` | `window_close` | 消费中心整体、挂牌、激活等 |
| 兜底 | `absolute` | `absolute` | 跨窗 / 与窗口无关的固定时段 |

非随窗的一端一律填**具体日期时间**（北京时间输入，存 UTC）。不做「开窗 + N 小时」偏移。

## 3. 表 `ops_schedule`（迁移 `0069_ops_schedule_expiry.sql`）

```
op_key TEXT PRIMARY KEY
start_anchor TEXT NOT NULL DEFAULT 'none'   -- none | window_open | absolute
start_at TEXT NULL                           -- absolute 时的 UTC ISO
end_anchor TEXT NOT NULL DEFAULT 'none'      -- none | window_close | absolute
end_at TEXT NULL
requires_window INTEGER NOT NULL DEFAULT 1   -- 是否叠加现有窗口闸门
close_inflight INTEGER NOT NULL DEFAULT 1    -- 到点是否由引擎收口在途物
note TEXT NOT NULL DEFAULT ''
updated_by INTEGER
updated_at TEXT
```

同一迁移加：`offers.reminded_at`、`negotiation_sessions.reminded_at`（TEXT NOT NULL DEFAULT ''）+ 扫描索引。seed 12 行**锚全 `none`**。

**默认即安全位**：全部 `none` ⇒ 行为与今天完全一致（只保留现有窗口闸门）；管理端套预设或填具体时间才生效。

## 4. 解析与判定

纯函数在 `src/core/ops-schedule.ts`（零 import，前后端共用，受 `tests/core-zero-import.test.ts` 守卫）；读库在 `src/worker/ops-schedule.ts`。每行按**当前开放窗口**解析成 `{startAt|null, endAt|null, endIsWindowClose}`：

- 起点：`window_open` ⇒ `season_windows.opened_at`；`absolute` ⇒ `start_at`；`none` ⇒ 无下界。
- 终点：`window_close` ⇒ 动态边界（关窗那一刻）；`absolute` ⇒ `end_at`；`none` ⇒ 无上界。
- 无开放窗口时：随窗锚的行 ⇒ 状态 `closed`（随窗关闭）；`absolute` 行仍按具体时间判。
- 校验（保存时 400）：`absolute` 必须配合法 ISO；任一端为随窗锚 ⇒ `requires_window` 必须为 1；解析出的终点早于起点 ⇒ 拒绝。

## 5. 闸门语义

`assertOpOpen(db, opKey)`：`now < 起点` ⇒ 409 `op_not_started`「X 还没开始（北京时间 …）」；`now > 终点` ⇒ 409 `op_closed`「X 已结束（北京时间 …）」。`requires_window=1` 时现有窗口闸门照旧叠加（不动现有代码，只加一道）。服务器时钟唯一权威（v6.24.0），前端不参与判定。

## 6. 收口归属

- 终点为 `absolute` ⇒ **引擎**在到点时收口（`close_inflight=1`）。
- 终点为 `window_close` ⇒ **关窗流程**收口（现有 `closeWindow` 的 settleOverdue + 阻塞闸 + force，不新增机制）；`close_inflight=0` 的行只关新操作。
- 关窗早于 `absolute` 终点 ⇒ 海捞批次立即开标（见海捞两阶段设计）。

## 7. 操作键（12 行）

`transfer_listing` 挂牌与出价、`transfer_offer` 报价、`transfer_negotiation` 签约谈判、`transfer_sea_sealed` 海捞·暗标段、`transfer_sea_open` 海捞·明标段、`transfer_activation` 激活、`transfer_match` 匹配窗、`transfer_termination` 解约、`transfer_rc_change` 续约、`transfer_forced_auction` 强制拍卖、`consumption` 消费中心整体（工单/球场扩建升级/设施/冠名接受·续约·退约/档期预订）。审核单不设时段（管理组工作流）。

`requires_window` 默认按现状对齐：挂牌/出价、激活、海捞、解约、续约、强制拍卖、匹配、消费中心 = 1；**报价、签约谈判 = 0**（v6.29.0 有意不受窗口限制）。

## 8. 读接口与管理端

- `GET /api/ops-schedule` → 每行 `{key,label,startAt,endAt,startAnchor,endAnchor,requiresWindow,state}` + `window{openedAt,closedAt}` + `now`；state ∈ `unrestricted|not_started|open|closed`（服务端算）。教练侧按钮置灰 + 北京时间文案 + 读秒（复用 `web/src/lib/use-countdown.ts`）。
- `web/src/pages/admin/SchedulePage.tsx`「运营时刻表」：12 行，每行起点/终点二选一（随开窗·随关窗 ⇄ 具体时间）+ `datetime-local`（标注北京时间）+ 两个复选（需开窗/到点收口）+ 备注 + 逐行保存；每行一键套预设 A/B/C；顶部「全部按预设填充」「全部清空（回现状）」。
- 端点 `GET/PUT /api/admin/ops-schedule[/:opKey]`，审计 `ops_schedule_set` origin `'user'`（before/after 全量）。
- 时区：`web/src/lib/datetime.ts` 新增 `zhWallToUtcIso('2026-10-07T22:00')` → UTC ISO（固定 +08:00）+ 单测；显示一律走 `useTimeFmt()`/`fmtDateTime`。

## 9. 管理端只读甘特图（已裁决「只读可视化」）

- 三层：`web/src/lib/gantt.ts` 纯几何（范围推导/归一化/刻度粒度/行条）+ `gantt.test.ts`；`web/src/components/GanttChart.tsx` 静态 SVG（viewBox 定宽、类名 `gantt-*`、`role="img"` + 每行 `<title>`）；容器在 `SchedulePage.tsx`。
- **手绘 SVG，不引图表库**（`web/src/lib/heatmap.ts:3` 明文先例；Gantt 库自带日期/时区口径会与 v6.25.0 单点规则打架）。
- 刻度文字必须出自 `web/src/lib/datetime.ts`（`tests/datetime-display.test.ts` 禁其他文件写 `Intl.DateTimeFormat`/`timeZone:`、禁裸切片）。
- 范围推导：`from = min(窗口 openedAt, 各行起点, now) − 1h`，`to = max(各行终点, now) + 1h`；无开放窗口 ⇒ `now ± 24h` + 空态「当前没有开放窗口」。
- 开放式终点：`window_close` 行 = 实条 + 虚线箭头到右缘标「关窗即止」；`none` 行 = 满宽斜纹灰带「不限制」。颜色沿用现有状态色。
- 刻度粒度自适应：≤6h 每小时、≤48h 每 6h、≤14d 每天、更长每周。
- 样式全部落 `web/src/styles.css` 的 `gantt-*` 段（TC-SWP-02 禁内联 `minWidth`）；外层 `overflow-x:auto` 窄屏横滑。
- 交互：悬停显示具体起止、点击行跳到该行编辑表单；图上不写库。

## 10. 风险与缓解

- **时刻表误配全线关闭**：全行默认 `none`；管理端每行显示当前状态预览 + 甘特图复核；改动全量进 `audit_log`。
- **自动收口误杀**：两级提醒（`reminded_at` 抢占）+ **存量宽限**（存量 pending 不按历史锚实时算，首次扫描按 now+N 小时回填）+ `close_inflight` 可逐行关闭。
- **5 分钟粒度**：cron `*/5`（`wrangler.jsonc:70-76`）⇒ 到点误差 ≤5 分钟，与现有挂牌同口径。
- **随窗锚与窗口生命周期耦合**：无开放窗口时随窗行一律 `closed`。
- **具体时间需每轮更新**：只有具体时间那一端每轮更新；随窗端永不用改。
- **与 `expireStaleOffers`（`src/worker/offers.ts:777`）共存**：触发条件不同、均幂等，不冲突。
