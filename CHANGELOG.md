# 变更记录

本项目按「增量」推进，每次生产部署以 Cloudflare Worker 的 Version id 标记（仓库无 git tag）。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

各增量的裁决、交付清单与验收数字见 [ROADMAP.md](./ROADMAP.md)。

## [未发布] · 增量 29 — 球员库 UI 缺陷收口：档案页 15 槽徽章 + 多选面板高度上限 + 表格不折行（2026-09-22 本地完成，待部署）

**新增**
- `src/core/fc26.ts` 新增 `PS_SLOT_KEYS`：由 `PS_SLOT_COUNT` 派生的 `PSID1 … PSID15` 槽位键表（此前档案页是手抄数组，与槽数常量无关联）。
- `web/src/lib/ref.ts` 新增 `playstyleBadges(attrs)`（返回 `{ psid, slot, gold }[]`，扫全 15 槽、只收正整数槽值、`slot` 1 起）与 `PlaystyleBadgeSlot` 类型。

**变更**
- 球员档案页（`web/src/pages/Player.tsx`）的 PlayStyles 徽章由手抄的 `PSID1-7` + `PSID13-15` 改为**按槽位扫全 15 槽**（银 `PSID1-12` + 金 `PSID13-15`），只渲染有值的槽、不给空槽占位 —— 落在 `PSID8-12` 的银徽章从此可见（增量 27 遗留 ②；生产实测 `PSID8` 有 3 人）。
- 多选下拉面板的高度上限从 CSS 收回到组件：`web/src/components/MultiSelect.tsx` 新增 `PANEL_MAX_PX = 480` / `PANEL_MAX_VH = 0.7`，`place()` 取 `min(可用空间, 480, 0.7 × 视口高)`（不低于兜底 160px）；`web/src/styles.css` 里那条被内联样式顶掉、从未生效的 `.multiselect-panel { max-height: min(70vh, 480px) }` 删除（遗留 ④）。
- 球员库表格单元格**一律不折行**（`.library-main td { white-space: nowrap }`），列宽不够时由外层 `.table-wrap` 横向滚动承担；管理员页表格不受影响（遗留 ⑤）。
- 摘要条「筛选（N）」的计数口径经用户裁决**维持现状**（数 chip 条数，位置选 12 个仍显示 1），文档里「已接受」改写为「已裁决维持现状」（遗留 ③）。
- 文档口径同步：`TECH_DESIGN.md` 徽章决策表把「档案页只渲染 `PSID1-7`+`PSID13-15` ⇒ `PSID8-12` 可筛不可见」整句替换为全 15 槽口径，并点明「槽号是 1 起」与「徽章墙 🥈 x/15 的 15 是 `badge_cap_silver` 台账上限、与 12 个银槽是两个口径，别混」；`UI_DESIGN.md` 补 15 槽渲染（不给空槽占位）、单元格不折行（附实测宽度）与面板上限；`ROADMAP.md` 增量 27 遗留段落逐条改口径。

**修复**
- `web/src/pages/PlayersLibrary.tsx` 的 `psNames` 把 `.map` 的 **0 起下标**当槽号传给 `playstyleIsGold(psid, slot)`（后者语义是 1 起）⇒ 下标 12（= `PSID13` 金槽）走不到金槽分支，银段 ID 落在金槽时列表显示成银、与档案页 🥇 不一致（仅异常数据可见）。改为 `slot + 1`，并把 `psNames` 导出以便单测。
- `tests/core-zero-import.test.ts` 的依赖判据 `/^\s*(import|export\s+.*from)/` 会把 `export const PS_SLOT_KEYS: readonly string[] = Array.from(` 里的 `Array.from` 误判为依赖（`from` 命中），把零依赖模块判红。改为抽出 `hasStaticDependency(line)`：`import` 行首 ∥ `export … from '…'`（带引号）∥ 任意位置的 `import(`/`require(`（抓动态 import），并补判据自测。
- `web/src/lib/api.ts` 之类的既有契约未动；`GET /api/players` 等接口行为与本增量无关（纯前端 + 文档）。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**（增量 28 基线 39/539 ⇒ 步骤 1 +5、步骤 2 +2、评审修正 +4）；`npm run build` 成功（`web/dist/assets/index-C_n2o0KE.js` 451.12 kB / gzip 143.00 kB + `index-D-qmdoLZ.css` 27.62 kB / gzip 6.36 kB）；本地 8791 + `npm run test:e2e` **9/9 通过**（三视口表格探针：0 个折行单元格、表格最小宽 876px vs 容器 854 / 815 / 290）。
- 三处改动都做过**变异验证**：`flatMap` 改 `slice(0, 7)` ⇒ 2 例红；面板上限改 `Infinity` ⇒ 5 例红；删掉 `white-space: nowrap` ⇒ e2e 报「108 个单元格仍会折行」；`psNames` 改回 0 起下标 ⇒ 1 例红。
- 不跑生产 API 回读（纯前端改动，省 D1 读额度）；部署后只取线上 `/players` HTML 核对 JS hash。

**待办**
- 推送 + 部署 + 线上产物核对（步骤 5）。
- 不在本增量范围（用户已指令搁置或另有安排）：下一批 4 条候选排序索引（`view=initial&sort=ca` / `uid` / `ps` / `name`，写限额不足）、姓名子串 FTS5、`attr:*` 34 键物化子表、海捞池 `LIMIT 300` 无分页无筛选、30 人 `naID`/`FootID` 补录、PlayStyle 图标包待供给。

## [已上线] · 增量 28 — 球员库 D1 读消耗治理：去整表 COUNT + 两级缓存与代际失效 + 6 条索引 + 全站读面普查（2026-09-22，Version 7c5b5879-0003-421c-9bf2-6026a4674afe）

增量 27 收尾时生产 `/api/players*` 全线 500，排查确认是 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起，比部署早约 2 小时）。用户就此立项：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」。先量化再治理——用「真实路由 + 假 D1 抓 SQL」的测量脚本打生产读 `meta.rows_read`，拿到 30 个形状的物理事实，再按写配额（免费档 10 万行/日）排优先级。全部步骤已于 2026-09-22 推送并部署为 Version `7c5b5879-0003-421c-9bf2-6026a4674afe`（步骤 0–5 先上 `91635aca`，步骤 6 再上 `7c5b5879`），部署后 8 请求最小化回读全部符合预期。

- **新增**
  - **测量工具两件**：`scripts/measure-d1-reads.mjs`（球员库 30 形状 + 6 设计探针）与 `scripts/measure-surface-reads.mjs`（全站 21 条读面），共用 `scripts/d1-read-audit/harness.mjs`。核心手法是**用 Hono 的 `app.request()` 调真实路由 + 注入只记录不执行的假 D1**，把路由实际执行的 SQL 与绑定参数原样抓下来内联后打生产 —— 不手抄 SQL，所以路由改了 SQL 复测自动跟着变（步骤 7 的验收复测直接复用）。三个必须知道的约束：每个读面跑在独立进程（`--only=<id>`，否则 `config` 的 isolate 内 60s 缓存把后续读面抹成 0）；只执行 SELECT（`selectOnly`，GET 里也可能藏写语句）；鉴权靠假 D1 回管理员 claims + 探针 cookie。
  - **定标报告** `scripts/d1-read-audit/README.md`（含原始数据 `measurements.json` / `measurements-after.json` / `surface-measurements.json`）：30 形状基线、6 探针、成本模型、阈值判定与候选清单、全站普查、验收表与豁免清单。
  - **内部计数端点 `GET /api/cron/players-count`**：列表去掉整表 COUNT 后，唯一还需要总数的地方（管理端筛选计数）走这里。**fail-closed**：未配 `CRON_KEY` 一律 403；密钥**只认 `X-Cron-Key` 请求头**（不接受 `?key=`，避免密钥进日志）。
  - **分级缓存**：`src/lib/cache-policy.ts` 的 TTL 单一来源表（球员库列表 1h、名册 24h、俱乐部目录 24h；`PUBLIC_CACHE_TTL_MS` 退化为显式覆盖，配 `0` 即旁路、生产**不配**），KV 代际键 `cache:epoch:public`（isolate 记忆 5s）配写路径 purge，`EPOCH_FAIL_SHORT_MS = 60_000` 兜 KV 读失败。
  - **迁移 `0029_players_sort_indexes_batch2.sql`**（声望 / 归属 / 状态三条排序表达式索引）与 **`0030_players_club_ca_index.sql`**（`players(club_id, ca DESC, id)`，为海捞名单驱动表连接备的）。
  - **同源锁死测试**：`tests/players-sort-indexes.test.ts` 断言语义 SQL 的 `EXPLAIN QUERY PLAN` 命中对应索引；`tests/market-routes.test.ts` 新增「海捞名单查询计划」用例（断言含 `idx_players_club_ca`、含 `SCAN cp`、不含 `MULTI-INDEX OR`）；`tests/admin-system.test.ts` 用记录型 D1 断言 overview 的全表 COUNT 一小时内只跑一次。都做了变异验证（改回去立刻红）。
- **变更**
  - **球员库列表去掉整表 COUNT**：`GET /api/players` 响应**不再有 `total`**，只有 `players` + `nextCursor`（keyset 游标；无更多数据时 `nextCursor` 为 `null`）。前端翻页条文案随之改为游标式（「第 N 页 · 已加载 N 名 · 还有更多／已到末页」），不再显示总数。
  - **两级缓存取代单层**：`cachedJson` 由「进程内 Map 单层」改为 **L1 进程内 + L2 边缘 Cache API**（合成 URL 作键、`cache-control: max-age` 管过期、全程 try/catch 旁路）；缓存键 = `${scope}:v${epoch}:${canonicalQuery}`。
  - **失效从 TTL 兜底改为写路径 purge**：挂钩收敛到两处 —— `/api/*` middleware（非 GET/HEAD + 2xx + `scopesForWritePath` 命中）与 `scheduled()`（tick 真改了数据才 purge）；每次 purge 只做一次 KV 写（代际键单版本）。
  - **前端 `staleTime`**：React Query 全局默认 30s、球员库列表 60s，并补两处写后失效。
  - **`/api/market/free-agents` 查询改写**：原 `WHERE (p.club_id IS NULL OR p.club_id IN (CPU 子查询))` 在生产 97% 球员无归属的数据下退化为 `MULTI-INDEX OR` + 临时排序（36,274 行/次），改写为 `UNION ALL` 两分支 + CPU 支用 `FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id` 固定连接顺序 ⇒ **843 行/次（降 97.7%）**，结果集与旧版逐行一致（25 组随机数据 top-300 逐字节比对全等）。
  - **`/api/admin/overview` 的全表 COUNT 接入球员库列表同 scope 的两级缓存**（`countAllPlayers`，冷缓存仍 18,449 行但 1h 内多 isolate 只算一次、命中 0 行）。
  - **`AuthApiError` 去掉 TS 参数属性**（唯一需要代码生成的语法，Node 类型剥离不支持），否则 `authClient` 的六个读面在测量脚本里加载不了。
  - **`public/admin` 三处产物均为本次构建**：`index-DZu3s6Fn.js`（与步骤 5 同 hash，步骤 6 无前端改动）。
- **修复**
  - **生产 `/api/players*` 全线 500 的真因**（增量 27 收尾时的悬案）：D1 免费档当日行读配额耗尽，限额按 UTC 零点归零、自动恢复。排查中确立**三个假阳性判据**：`/api/health` 只读 `sqlite_schema`（不计配额）；`wrangler d1 execute --remote` 是管理通道（不受限）；`/api/clubs/directory` 缓存键是固定字符串且 stale 刷新分支吞掉 loader 错误（D1 全挂也回 200）。拿真错误文本的办法：临时给 onError 加 `__diag` 字段 + `wrangler dev --remote`（本地代码 + 生产绑定，不需部署）。
  - **`selectOnly` 原本放行整个 `WITH`**（`WITH … DELETE` 在 SQLite 合法 ⇒ 等于把写语句送上生产）⇒ 收紧为「`SELECT`，或 `WITH` 且不含写动词」并单测 9 种入参。
  - **`?attr=` 单独给会 400**（前端选一个属性就报错）⇒ `attr` 单独给合法、区间空串等同没给。
- **验收**
  - 30 形状生产复测（仅耗 338,980 行）：默认浏览一页 **18,819 → 56 行**（第 5 页 52、初始视图 56、`sort=id` 56）；`sort=ca/pa` 18,821/18,824 → **58/61**、`sort=age`/`market_value` → **22/22**（0027）；`sort=prestige/club/status` 56,398 → **53/43/22**（0029）；筛选各形状全部降到百级（`club_id=5` 64、`club_id=free` 22、`status=normal` 58、`growable=1` 95、`position=ST` 110、`ps=25` 293、`attr≥80` 88、`ca_min=80` 56）。容量推演：默认浏览从 **265 次/日** 升到 **89,285 次/日**。
  - 未达标形状逐条豁免（报告 §5.5）：8 个全表扫排序键 56,398–56,400 → 37,635–37,637（只降 33% = 纯去 COUNT；键在 `contracts`、依赖窗刻度子查询或内联运行时 config 系数的都不能静态索引），姓名查找 36,606 → 18,304（`LIKE '%x%'` 子串匹配用不了 B-tree，只能 FTS5 trigram）。
  - 测试 `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 539 例全绿**；`npm run test:e2e` 9/9；最小化回读 8 请求全符预期（`/api/health` 200、`/api/players?limit=1` 200 且**已无 `total`**、`sort=prestige`/`sort=status` 200、`/api/players/roster` 200、`/api/clubs/directory` 200、`/api/market/free-agents` 与 `/api/admin/overview` 均 401 未登录而非 500）。
  - 额度（UTC 2026-09-22）：读 1,993,427 行（39.9%）、写 73,220 行（73.2%）。
- **待办 / 登记未做**
  - 下一批可建索引（每条 18,301 行写，免费档自留 6 万/日 ⇒ 每天最多 3 条）：`view=initial&sort=ca`（`COALESCE(base_ca, ca)`）、`sort=uid`、`sort=ps`（15 项链，须先过 D1 表达式树深度体检）、`sort=name`。
  - 姓名子串查找的 FTS5 trigram、`attr:*` 34 键的物化子表：独立主题。
  - 海捞池已 17,731 人而 `LIMIT 300` 无分页无筛选（「除 CA 最高 300 人外都看不到」是产品级问题，本增量只治读量、不动契约）。

## [已上线] · 增量 27 — 球员库左栏 UI 收口：多选下拉替代 chip 墙 + 区间成对 + PlayStyle 银/金分槽（2026-09-21，Version 3455087e-4bdb-4a63-b40f-8df943d80892）

用户对刚上线的增量 26 左栏提了 8 条反馈（同行元素未对齐、表格上方空白过多、查找框灰字过长、位置 16 个 chip 太占地方、同一属性的上下限占两行、「属性键」用英文键、「经纪人」叫法、PlayStyle 与显示列也该是多选下拉），另附带要求**修掉金徽筛选**。本轮只改前端与筛选语义，**不写任何生产数据、不碰缓存与限流数值**；生产读消耗的量化与治理被用户明确挪到下一增量（当日 D1 读额度已超限，见 ROADMAP 增量 27 节的「裁决」与「遗留」）。本增量已于 2026-09-21 推送（`89e039d..30c7cdc`，7 个提交）并部署为 Version `3455087e-4bdb-4a63-b40f-8df943d80892`；部署后生产 `/api/players*` 一律 500，排查确认为 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起全站真实表读失败，比本次部署早约 2 小时；限额按 UTC 零点归零），最小化生产回读顺延到额度归零之后。**回读已于 2026-09-22T00:01:52Z（本地 08:01，归零后 1 分 52 秒）补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 六个端点全部 200，另用 `?ps=125&limit=3` / `?ps=25&limit=3` 各一次（合计 8 请求）实测银/金分槽语义在生产成立（金值只命中 `PSID13-15`、银值只命中 `PSID1-12`，互不串），cron 自 00:00:34Z 起恢复成功。

- **新增**
  - **`MultiSelect` 多选下拉组件**（`web/src/components/MultiSelect.tsx`）：走原生 **Popover API**（面板进 top layer，不被窄屏抽屉的 `position:fixed + overflow-y:auto` 裁切），自管 open 态（浏览器的 light-dismiss 一勾就关，多选要能连点），三条关闭路（再点触发器 / 点面板外 / Esc——Esc 里 `preventDefault()`，否则一次 Esc 会连抽屉一起关），面板位置按触发器 `getBoundingClientRect()` 现算并随滚动/缩放跟随，**下方不足 220px 就翻到触发器上方贴底**。位置（12 码位）、显示列（18 列）、PlayStyle 三处接入（增量 27）。
  - **属性中文名表成为单一来源**：`web/src/lib/ref.ts` 新增导出 `ATTR_LABELS`（34 项中文名）与 `ATTR_GROUPS`（七组：速度 / 射门 / 传球 / 盘带 / 防守 / 体格 / 门将），球员档案页（原来自写两份、未导出）与筛选面板共用同一份，并有 `ref.test.ts` 断言「与 `ATTR_KEYS` 逐序全等、无重复」。
  - **控件行统一**：`:root` 新增 `--control-h: 34px` 与 `.control-row`（工具条与左栏共用），同行控件底边齐平（增量 27）。
  - **e2e 探针**（`scripts/e2e/smoke.mjs` ⑧）：多选面板几何与命中测试（整块在视口内、`elementFromPoint` 命中面板内部、与触发器不重叠、高度 ≥160）、同行控件底边逐对对齐（并断言量到非空）、翻页条按线上量级文案量页面横向溢出（增量 27）。
- **变更**
  - **区间上下限合并成对**：原先 14 个 `num()` 每个占一行（「CA ≥」「CA ≤」各一行），改为每对一行两列、label 在左、placeholder 标「最低 / 最高」——CA / PA / 成长空间 / 初始 CA / 年龄 / 身价 / 影响力 7 对 + 属性 1 对（选中属性后出现，label 是该属性中文名）+ 合同 3 对（工资 / 解约金 / 效力时长）（增量 27）。
  - **位置**：16 个 chip（四个组 chip + 12 个码位）→ 多选下拉，只放 12 个码位（`POSITION_GROUPS` 随之下线）；点选仍是多选，URL 仍是 `position=CB,ST`（增量 27）。
  - **PlayStyle**：72 个 chip（银金同列、点金徽必然 400）→ 多选下拉，顶层分「银徽章 / 金徽章」两段、段内按 EA 六类（射门 / 传球 / 防守 / 控球 / 体格 / 门将）分组，各 36 项；不带搜索框（增量 27）。
  - **显示列**：`details` + chip 组 → 同一个多选下拉（`恢复自动` 移入面板页脚，仅手动改过时出现）（增量 27）。
  - **摘要条与翻页条合并成一行**（chips 靠左、翻页靠右，都在表格正上方），无筛选时不再渲染「未设筛选条件」占位——原先摘要条是全宽独立一行、分页条居中在表格上方，两者叠加出约 150px 空白（增量 27）。
  - 搜索框占位由 `按姓名找（支持去变音：sesko → Šeško）` 改为 **`查找`**（`aria-label="按姓名找"` 保留，去变音能力不变，只去掉占位里的教学文案）（增量 27）。
  - 筛选面板「属性键」→ **「属性」**，下拉 34 项按七组 `<optgroup>` 分组、选项写中文名（原先 34 个英文键平铺）；「经纪人」→ **「经纪人性格」**（仅筛选面板 label 与档案页的「经纪人性格 🕴」；摘要条 chip 的「经纪人：温和」与表格列名仍叫「经纪人」，用户裁决值此）；（增量 27）。
  - **PlayStyle 命中语义收口**：库里 15 个 PS 槽 = **银槽 1-12 + 金槽 13-15**（金徽落库存「基础 ID + 100」）。改为**银值只比银槽、金值只比金槽**，不再「基础 ID 或 其 +100 命中任一槽」——旧语义下筛银徽章会捞出只挂金徽章的球员（增量 27）。
  - PlayStyle 筛选参数白名单由「1-99」改为 **「银 1-99 ∪ 金 101-199」**（100 是空档）+ 去重 + 上限 100 项（超限 400）；槽位与段位常量（`PS_SLOT_COUNT=15` / `PS_SILVER_SLOT_COUNT=12` / `PS_GOLD_BASE=100` / `isPlaystyleId` / `isGoldPlaystyleId`）全部落到 `src/core/fc26.ts`，前后端与档案页共用，不再各写写死字面量（增量 27）。
- **修复**
  - **点金徽 chip 必然 400**：前端 `filtersToQuery` 序列化 `ps` 时没有任何白名单、后端只收 1-99，而旧面板铺出的金徽 chip 会序列化成 101-156 ⇒ 随本轮语义收口改掉（增量 27）。
  - **多选面板掉出视口**（真浏览器实测）：触发器贴近视口底部时，面板落在 806–966 而视口高 800，掉在视口外、点不到也滚不到 ⇒ 落位改为「下方不足 220px 翻到上方贴底」；同时落位**必须在 `showPopover()` 之后**（之前面板是 `display:none`，`offsetWidth` / `scrollHeight` 量到 0，「面板想要多高」恒为 0，翻转几乎永不触发）（增量 27）。
  - **窄屏勾选框标签被拆成三行**：375px 抽屉里 `.lib-adv-grid .field.check` 被 flex 压到 96px，「仅未来之星」渲染成「仅未 / 来之 / 星」⇒ 加 `white-space: nowrap`，整条换行而不拆字（增量 27）。
  - 两条 e2e 断言被评审指出是空洞的：翻页条原断 `scrollWidth > clientWidth`（CJK 会换行，永不可能失败）、同行判据原按 `top` 归行（`.control-row` 是 `align-items:flex-end`，底边对齐的成对控件顶边本就不同，会被判成不同行而跳过）⇒ 改为「页面级横向溢出」与「纵向相交归行 + 比底边 + 断言量到非空」（增量 27）。
- **待办**
  - **球员库 D1 读消耗的量化与治理**（增量 28）：本增量原计划的第一步是打生产实测，但 2026-09-21 当日 D1 读额度已超限（免费档按 UTC 零点归零），用户裁决整体挪到下一增量 ⇒ 本增量**未做任何读消耗测量，也未改缓存 / 限流 / 查询行为**。
  - **档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15`**，而筛选与导入的口径是银槽 1-12 ⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（既存问题，增量 27 未修；**增量 29 已修**）。
  - 摘要条「筛选（N）」数的是 chip 条数：位置选 12 个仍显示 1（chip 粒度按用户裁决合并，计数口径随之如此，已接受）。
  - 1280 宽下表格里「Baseline Utd」「20.00 m」「2金7银」会折行（列宽所致，非本轮引入）。

## [已上线] · 增量 25–26 — Version b83ec876（2026-09-21）

2026-09-21 推送 39 个提交（`29c8199..d17cbdd`）→ 部署 Worker（增量 26 只改代码与文档、无需迁移；增量 25 的 `0028` 已于同日随合同导入批 apply）。`wrangler deploy` CLI 回显 Current Version ID `81e93c74-228f-4fee-9d87-9fecf602d360`；`wrangler deployments status` 的 100% 流向为 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（同一批、相隔 5 秒，与增量 17–24 的 `90bfd78f` / `c0e0d130` 同形态）。

生产回读：`/api/health` 三资源 ok；`/api/players?limit=1` 200；`/api/players?sort=name` 200（修复前直接 500）；`/api/players?name=sesko` 返回 `B. Šeško`（去变音折叠在线上生效）；`/api/players/roster` 200 / 325262 字节；`ca` / `market_value` / `attr:finishing` / `years` 四个排序键与 `effective_years_min` / `protected` / `attr=finishing&attr_min` 三个筛选查询全 200。

## 增量 26 — 球员库筛选搬进左栏（2026-09-21 上线，见上方部署记录）

- **新增**
  - **姓名去变音搜索**：新增 `src/core/name-fold.ts`，JS 侧 `foldName` 与 SQL 侧 `sqlFold` 用同一张 `FOLD_SPEC` 映射表（两侧规则同源，避免「折了一侧、另一侧没折」的静默漏搜）；球员库 `?name=` 改 `sqlFold('players.name') LIKE ? ESCAPE '\'`，「sesko」能搜到「Šeško」；导入侧 `warnUnfoldable` 对表外字符只警告不挡行，配套硬闸 `unmappedNameChars` 与只读脚本 `scripts/scan-name-chars.mjs`、链深守卫 `scripts/check-name-fold-depth.mjs`（增量 26）。
  - **轻量名册端点** `GET /api/players/roster`：单条 SQL 拼「姓名|俱乐部ID|球员ID」多行文本，5 分钟缓存下限；前端**聚焦搜索框才拉**（从不点搜索框的人不付这个代价），之后本地过滤 + 键盘上下选 + 点条目跳 `/players/:id`（增量 26）。
  - **球员库左栏**：筛选与显示列搬进球员列左侧 sticky 定宽栏（260px），桌面可收起且收起态记 `localStorage`；生效条件摘要条常驻、每条 chip 可单独撤销（增量 26）。
  - **窄屏筛选抽屉**：900px 断点下左栏改为左侧滑出抽屉，遮罩 / × / Esc 三条关闭路、背景锁滚、焦点陷阱与归位（增量 26）。
  - **前端组件测试基建**：devDeps 加 jsdom 与 @testing-library（react / dom / user-event），`vitest.config.ts` 加 react 插件并把 include 扩到 `web/**/*.test.ts(x)`（增量 26）。
- **变更**
  - **排序键 6 → 29 个**（表头每一列都可排）：`SORT_KEY_NAMES` 与 `TEXT_SORT_KEYS` 提到零 import 的 `src/core/players-sort.ts`，前后端共用同一份（原来各写一份字面量）；文本键（`name` / `contract_type` / `source`）走文本游标 `decodeTextCursor`；新增 `attr:<属性键>` 排序键，属性白名单与后端同源（`FC26_GAME_ATTR_COLUMNS` 从 `sprintspeed` 起切，34 项 = 29 外场 + 5 门将）（增量 26）。
  - 球员库排序交互由下拉框改为**点表头**，两态循环（升 → 降 → 升），`sort`/`order` 继续留 URL；默认态不给任何列打 active（服务端默认按 `players.id ASC`，标「UID ↑」是说假话）（增量 26）。
  - `PlayersLibrary.tsx` 853 → 598 行（`a7b92c0` 抽离那一步为 340 行，后续左栏/抽屉/表头排序各步又增回）：筛选控件抽成 `web/src/components/FilterPanel.tsx`（12 props），筛选模型拆到 `web/src/lib/players-library.ts`（Filters / EMPTY_FILTERS / RANGE_URL_KEYS / COL_DEFS / autoColsFor / sortColumnVisible / parseColsParam），行为不变（增量 26）。
  - 顶栏高度不再写死：`web/src/components/TopBar.tsx` 用 ResizeObserver（**`box: 'border-box'`**）实测回写 `--topbar-h`，吸顶元素避让顶栏（用户放大字号后顶栏更高，写死的 54px/102px 会压住侧栏）（增量 26）。
- **修复**
  - **`sqlFold` 的 REPLACE 链撞 D1 表达式树深度上限**：253 项链在真引擎上报 `D1_ERROR: Expression tree is too large (maximum depth 100)`，`?name=` 与 `sort=name` 直接 500（node:sqlite 上限 1000，本地单测测不出）⇒ 折叠表裁到生产实测 87 项，并加 `SQL_FOLD_DEPTH_LIMIT` / `SQL_FOLD_ENTRY_BUDGET` 与守卫脚本（增量 26）。
  - **焦点陷阱漏掉收起 `<details>` 里的元素**：Chrome 对收起 details 内元素不返回 `offsetParent === null`，导致清单末位错位、Tab 逃到 body（375 实测第 25 次）⇒ 显式排除 `details:not([open])` 后代、保留其 summary（增量 26）。
  - **关闭抽屉的焦点归位不能在同帧 focus()**：入口按钮所在工具条此时是 inert，`focus()` 被浏览器静默忽略、activeElement 掉到 body ⇒ 改为置标记、由 effect 在 `drawerOpen` 变 false 后再 focus（增量 26）。
  - 窄屏吸顶规则按类名裸命中抽屉内的筛选行，把「位置」那组 chip 头两行压住 ⇒ 规则改名 `.lib-toolbar` 并限定作用域；抽屉抬头补 sticky（增量 26）。
  - `foldName` 删掉 NFD 与整段 `toLowerCase`（只做查表替换 + ASCII 小写），`unmappedNameChars` 加形状变体判据 `FOLD_SHAPED`（弯引号/花式空格/不可见字符原先被跳过、永不报警）（增量 26）。
  - `attrSortExpr` 加 `+ 0`、`growth_gap` 两侧 COALESCE（属性值混字符串会让游标 NaN 或比较恒假）（增量 26）。
  - 锁滚在 Windows 经典滚动条下整页横跳 16px ⇒ `html, body { scrollbar-gutter: stable }`（增量 26）。
- **待办**
  - ~~本轮只改代码与文档，未 push 未部署~~ → **2026-09-21 已随 Version `b83ec876` 推送并部署**（`29c8199..d17cbdd`，39 个提交）；增量 25 的 worker 也一并上线。
  - 窄屏抽屉锁滚靠 `body { overflow: hidden }`，iOS 上不彻底（已加 `overscroll-behavior: contain` 兜底，真机未验）。

## 增量 25 — 合同期与财政节点改窗刻度（2026-09-21 上线，见上方部署记录）

- **新增**
  - **合同期改窗刻度**（迁移 0028）：`contracts` 加 `service_ticks`（签约基数 = 签约时点已关常规窗数）/`protection_ticks`（保护期结束的绝对窗数）/`signed_season`+`signed_window_seq`（展示），`season_windows` 加 `is_temporary`；效力 = 0.5 × 已关常规窗数（1 常规窗 = 半赛季），保护期 = 签约后 3 个常规窗，解约免费门槛 = 6 个常规窗（3 赛季）；纯函数在 `src/core/bypass-rules.ts`，计数助手 `src/worker/contract-ticks.ts`（增量 25）。
  - **窗分型**：开窗 `POST /api/admin/windows/open` body 加 `temporary`；同赛季常规窗上限 2（季初 + 中期，第 3 个非临时窗硬拦 409）；季初/中期不落库，按同赛季非临时窗顺序派生（增量 25）。
  - **忠诚奖金改发放点**：从赛季结算按钮移到**赛季中期窗关窗**时发（`kind='loyalty' ref_type='window' ref_id=season*100+windowSeq` 幂等，逐队合并一条流水），关窗响应回显 `loyalty`（增量 25）。
  - **导入历史合同**：按 `effective_from` 反查签约基数并落保护期刻度（训练营无保护期），`service_ticks`/`protection_ticks` 随之 upsert（增量 25）。
- **变更**
  - 关窗扣款顺序改 **富人税 → 工资**，富人税税基含未扣工资（`资金` 与 `ΣRC+资金` 取多，不再减本窗工资）；临时窗只扣富人税 + 维护费（不扣工资、不收冠名租金也不递减剩余窗数），死忠演化每种窗照做（增量 25）。
  - 续约/匹配把保护期收口到审核通过当下：`protection_ticks` 置为当前已关常规窗数（判定恒不成立），`service_ticks` 效力基数不动（增量 25）。
  - 球员库/球员详情/球队页的效力与保护期按赛季展示（`serviceSeasons`/`protected`），筛选 `effective_years_*`、`protected=in|out` 改窗刻度 SQL；管理端开窗表单加「临时窗」复选框、窗列表加窗类型列（增量 25）。
  - `contracts.protected_until`（旧口径 signed_at + 548 天）保留留档，判定不再读；`loyalty_tiers` 档位单位由「年」改「赛季」（数值不变）（增量 25）。
- **修复**
  - 球员库效力筛选原会把无合同的球员按基数 0 当满效力：加 `ct.player_id IS NOT NULL` 闸（增量 25）。
  - 空数组求和得到 `-0` 会让关窗响应与断言别扭：`PayrollSummary` 汇总归一为 `0`（增量 25）。
- **待办**
  - 迁移 0028 **已于 2026-09-21 随合同导入批 apply 到生产**（生产迁移现到 0028）；~~worker 仍未部署~~ → **2026-09-21 已随 Version `b83ec876` 部署上线**（网页面板建合同不再落 DDL 默认刻度）。
  - 0028 是纯加列迁移（5 条 `ALTER TABLE ADD COLUMN`，无数据回填——apply 时生产 `contracts` 与 `season_windows` 分别为 0 / 1 行），比 0027 的 7.3 万行写轻得多。

## [已上线] · 增量 17–24 — Version 90bfd78f（2026-09-20）

2026-09-20 推送 50 个提交（`9f05116..fe60273`）→ 生产迁移 apply 0022–0027（生产迁移现到 0027）→ 部署 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`。生产回读：`/api/health` 三资源 ok；0026 的 CPU 回填核对通过（id 10 / 241 / 112172 / 131681 均 `is_cpu=1`）；增量 17–23 新增路由在生产返回 401（未登录）而非 404。

### 新增

- **球员库**：接口补 `total` 与整套筛选域（身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/细分属性区间/合同域）；页面改版为 SoFIFA 式可变列 + 更多筛选折叠面板 + URL query 持久化（增量 17）。
- **俱乐部目录工具**：新建俱乐部必填游戏队号（赛事库校验 + 队名预填 + 指定 id 建行 + 认证目录 upsert，失败可重试）；`GET /api/clubs/directory`；管理端多教练绑定逐个解绑；换队号 rekey 只读预演工具 `scripts/rekey-team/`（增量 17）。
- **站内信收件篮**：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`，未读判定用独立列 `read_at`（迁移 0022），赛果确认与升级两处写入点内部改双通道（每个绑定账号一条 web 行进收件篮，绑了 QQ 的另加一条 qq 投递行）（增量 18）。
- **设施经营**：球场扩建、档位升级、子设施升级与建设券（迁移 0023 给 `stadiums` 加 `build_credit` 列），用户端 `GET /api/club/stadium/build-info` 与 `expand` / `upgrade` / `facilities/upgrade`，管理端 `GET|POST /api/admin/clubs/:id/stadium`；建设支出按 25% 返券、券只抵后续建设支出（先券后钱），config 新增 `facility_prices` 与 `stadium_max_open_tier` 两键（增量 19）。
- **冠名市场**：品牌池报价 / 签约 / 退约 + 窗末收租（迁移 0024 `naming_contracts`，费用条款快照列化 + 部分唯一索引拦一队双签），`GET /api/club/naming/quote` 与 `sign` / `terminate`，config 新增 `naming_params`（增量 20）。
- **赛果自动化**：cron 自动确认赛果（每轮上限 20 场，actor=0 系统留痕）、通知钩子重放 `POST /api/admin/results/:id/replay-hooks`、人工复核（迁移 0025 给 `result_confirmations` 加 `needs_review` / `review_note`）与 auth 三事件审计，config 新增 `results_auto_confirm`（增量 21）。
- **换版机制**：小换版 / 大换版两种模式（CA 换算与成长清零口径），导入预览警告与合同校验（增量 22）。
- **性能与守护**：`players` 四条排序表达式索引（迁移 0027）；公开 GET 的进程内限流与 TTL + stale-while-revalidate 缓存（`src/lib/guard.ts`，`PUBLIC_CACHE_TTL_MS`）；e2e 冒烟脚本 `scripts/e2e/smoke.mjs`（8 场景）与 `npm run test:e2e`（增量 23）。

### 变更

- `clubs.is_cpu` 列化（迁移 0026，由队名后缀回填），CPU 队不再靠名称判断（增量 22）。
- 顶栏响应式重排：桌面单行，窄屏品牌/用户区与导航分两行横滑（增量 17）。
- 公开 GET 的缓存与限流都是 isolate 内 `Map`：重启即清、多 isolate 不共享；KV 方案因免费档写配额否决。

### 修复

- 赛果通知钩子重放会重复发通知：重放跳过通知钩子（增量 21 收口审查发现）。
- 确认钩子（XP / 通知 / 奖金 / 上座）原先同步执行且裸奔，任一失败会把已入档的确认炸掉并让重试撞 409：改为逐个吞错收集（增量 21）。
- 账本幂等闸原按 `(kind, ref_type, ref_id)` 全局查重，多队同窗结算只有第一队落账：改按 `(club_id, kind, ref_type, ref_id)`（增量 20 前置修复，生产未触发）。
- 收件篮「标记已读」在 ids 超过 D1 单查询绑定参数上限 100 时报 500：改按 100 分块 `db.batch`（增量 18 收口审查发现）。
- 设施升级批次漏了 `build_credit` 的 UPDATE，建设券只进提示不落库（增量 19 冒烟发现）。
- 合同导入的 `clubId` 不存在时预览放行、落库才撞外键 500：preview 与 confirm 都改 404（增量 22）。
- 换队号 rekey 在换壳模式下 `tour_team_id` 空闲但认证库 `club_id` 已被占，只在执行期才炸：预演加撞号闸（增量 17）。
- 缓存键直接用原始查询串导致 `?a=1&b=2` 与 `?b=2&a=1` 重复装载：改为 `canonicalQuery` 归一；缓存条目无上限（键外部可控）会堆内存：加 64 条上限按插入序淘汰（增量 23 收口审查发现）。
- 球员库「上一页」用 `fetchPreviousPage` 会与页码错位，改为页码状态 + 缓存回退；无限查询最后一页按钮仍亮（v5 里 `getNextPageParam` 返回 `null` 仍算有下一页）（增量 16 收口审查发现）。

### 文档

- `README.md` 重写（原先只有一行标题）：定位、文档索引、技术栈、快速开始、命令表、绑定资源与权限、迁移纪律、测试、目录结构、部署现状（增量 24）。
- 新建项目级 `AGENTS.md`（危险操作清单、开发与测试口径、代码与提交规范）与 `CHANGELOG.md`（本文件）、`scripts/README.md`（脚本性质分级 + 生产工件执行状态）（增量 24）。
- `TECH_DESIGN.md` 与代码对齐：§13 补 5 个已落地 config 键并修正 2 个「待定」键、§15 假设加分类口径与编号归位、§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写并写明「不用 KV 做 SWR」的裁决、§12 与假设 23 记 web 收件篮落地、附录 A 通知行拆分并标注冻结范围（增量 24）。
- 删除过期草稿 `handoff-20260916.md`（停在增量 12），其中仍有效的三条（球员库逐队源数据位置与字段口径、导入通道选择、`--file` 通道外键陷阱）已迁入 ROADMAP 与 `scripts/README.md`（增量 24）。

### 待办

- push 与部署已于 2026-09-20 完成（见本节开头的部署记录）；0027 的 7.3 万行写已随当日 apply 计入。
- 生产回填已于 2026-09-20 执行完毕：16 队队籍（`scripts/prod-20260919-roster-backfill/`，444 人，只写队籍不造合同），复查全库 assigned 551 = 4 支 CPU 队 107 + 本批 444、free 17750。
- `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）回填已于 2026-09-20 部署后核对通过（均 `is_cpu=1`）。
- 遗留：球员库 30 人缺字段补录未执行（源数据缺 `naID`/`FootID`，`scripts/players-import/overlay-missing.ts`）。

## [已上线] · 增量 16 用户端重构 — Version 6ed7446c（2026-09-19）

- Market 拆为三页：`/market`（挂牌板 + 详情出价，公开）、`/market/free`（海捞签入 + 训练营激活，需登录）、`/market/mine`（我的挂牌 + 我的出价，需登录）。
- 用户端登录守卫 `RequireUser`（软卡不重定向）与 `AuthContext`（`/api/me` 全站单点拉取，顶栏/首页/管理端的 props 钻透退役）。
- 用户端 8 页数据层接入 TanStack Query，写后精确 invalidate。
- 注册合规逐人标红：按球员展开行级红底 + 规则短标签。

## [已上线] · 增量 15 管理端重构 — Version 4d03eb57（2026-09-19）

- 管理端从单页拆为左侧栏壳 + 8 个子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；后端 `admin.ts` 拆为 `routes/admin/` 八域，URL 零变更。
- 新增暂停出价：全局 config 开关 `market_bid_paused` + 单挂牌列（迁移 0021 `listings.bid_paused`），只挡新出价，不改变结算时刻。
- config 超管全开（独立权限点 `club.config.manage.super`，GET 明文 / PUT 逐键编辑 + 审计 `config_set`）、`GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1`）、`GET /api/admin/audit-log`。
- 统一两段式确认按钮 `ConfirmButton`，批量维护改结构化逐行预览。

## [已上线] · 早期增量 0–14（2026-09-12 ~ 2026-09-19）

- 增量 0 地基：纯 Worker + 共享登录 + schema + SPA 壳。
- 增量 1 球队与球员主数据（管理端最小集）。
- 增量 2 阵容注册与合规。
- 增量 3 转会市场（挂牌竞价链）。
- 增量 4 签约谈判（signing）。
- 增量 5 旁路操作 + 激活匹配 + 窗口。
- 增量 6 财政、赛季与通知（MVP 收口）；6.1 走查修复与球员库（四裁决落地）。
- 增量 7 球队绑定上收认证中心（auth + tour + club 三仓，`AUTH_DB` 只读接入）。
- 增量 8 球员库统一 + FC26 ID 对齐。
- 增量 9 分级派生（报名定级，club 单仓）。
- 增量 10 异常告警 + 管理介入 + 批量维护。
- 增量 11 赛季结算域。
- 增量 12 主场收入域（存量主场数据迁移）。
- 增量 13 成长域校准（成长期 / 解约清零 / 中国计划闸门）。
- 增量 14 CPU 队与队籍口径（`clubs.is_cpu` 代码侧与球员库首灌）。

早期各次的部署 Version 记录见 `wrangler deployments list --name whl-club` 与 ROADMAP 对应章节。
