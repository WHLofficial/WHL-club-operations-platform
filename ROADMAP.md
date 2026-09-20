# WHL 俱乐部运营平台 · 开发增量计划

| 项 | 内容 |
|---|---|
| 版本 | v1.0（2026-09-12，开发就绪评审产物） |
| 口径 | 每个增量独立可验收；增量内先服务端后前端；全部实现受 TECH_DESIGN 规约约束（§6.10 保密 / §17 D1 rows read） |
| 配套 | [PRD.md](./PRD.md)（做什么） · [TECH_DESIGN.md](./TECH_DESIGN.md)（怎么建） · [UI_DESIGN.md](./UI_DESIGN.md)（长什么样） |

---

## 增量 0 · 地基（纯 Worker + 共享登录 + schema + SPA 壳）

**交付**：
- 纯 Worker 脚手架：wrangler.jsonc（assets + D1 平台库/TOUR_DB 只读 + 共享 KV + R2 + cron 5min + smart placement）、package.json、tsconfig×2、vite、.gitignore
- 共享登录透传：`whl_session` cookie → 共享 KV `sess:{token}` → TOUR_DB user 表 → 角色（admin/coach/viewer，locked=1 只读，must_change_pw 403 引导回赛事系统）
- D1 迁移 0001：§5 全部建表 + §17 索引
- `/api/health`（三资源可达）+ `/api/me`；SPA 壳：TopBar（cocoa+金描边+徽章图+「WHL 经理办公室」）、家族令牌 styles.css、Home 状态页、四个占位页
- core/tax.ts（交易税分段累进+强制拍卖 50%）+ Vitest 首测；徽章图入库

**验收**：wrangler dev 本地起；持赛事系统 cookie 打开自动认人、角色正确；`npm run typecheck && npm test` 绿。

## 增量 1 · 球队与球员主数据（管理端最小集）

**交付**：
- config 服务（§13 键注册表：D1 config 表唯一来源 + isolate 内存缓存 60s + 涉密键掩码读取）
- 管理端：建俱乐部 / 8 位认证码 / 教练绑定 / 解绑（§3.2）
- **球员导入管线**（TECH_DESIGN §5.4）：FC26db 主源 + FC Editor 队壳通道，前端解析两段式预览确认，upsert 幂等只写 FC 源列，foot/position/prestige/china_plan 归一化，参考表静态 JSON 生成
- 期初余额导入（§14）；球员列表 + 球员卡首版（档案卡 dossier：球员卡 + 合同卷宗 + PSID 徽章小图标渲染）

**验收**：导入真实 FC26db 样例 → 球员卡 CA/PA/位置/国籍/徽章图标正确；绑队走通；运营列不被导入覆盖。

## 增量 2 · 阵容注册与合规

**交付**：注册名单提交、限额校验（20-30 人含门将 / 训练营 ≤7 / CA·PA 限额梯度 / 工资帽 P1 占位）、注册快照、准入体检报告（P1 首版）。

**验收**：合规名单通过、三种违规名单各被拒且报错可读。

## 增量 3 · 转会市场（挂牌竞价链）

**交付**：挂牌（价格校验）/ 出价（资金冻结 fund_holds）/ 抬价 / 截止惰性判定 + 顺延（交易日历）/ 无人出价下架费 / 审核队列（成交确认）/ 交易税 / 划款过户（completed 幂等单点）；挂牌板（卡柜）+ 出价历史 + 我的出价（冻结章）。

**验收**：双浏览器走通「挂牌→竞价→截止→审核→过户→账本可查」；并发出价不双花（§16 并发测试）。

## 增量 4 · 签约谈判（signing）

**交付**：成交确认自动开会话、新 RC 提交（±10/±50% 校验）、E 快照（§6.7 全公式：幂律/续约加薪/sigmoid/衰减）、≤3 轮报价、满意度文案、直败与强约结算、成约即过户（transfer 单 signing→completed）、经纪人档位 + 窗口重掷、§6.10 保密规约落地（服务端隔离模块/API 面收敛/掩码/零注释/测试数值断言）。

**裁决（2026-09-12）**：① 激活成交与普通成交一样走谈判（六条成约路径统一适用，无豁免）；② 所有谈判会话均可在成约前直签训练营合同（固定 0.75m/5m，不占 4.3.4(3) 每窗 2 名下放名额，落库 source=trainee）。

**验收**：谈判三终局（成功/强约/直败）各走通；保密审计清单逐条过（响应无 p/eff/阈值、SPA bundle 无判定常数、日志无判定值）。

**状态**：主体完成（含直签训练营与激活成交入谈判）；窗口重掷随增量 6 窗口推进落地。

## 增量 5 · 旁路操作 + 激活匹配 + 窗口

**交付**：海捞（新 RC 不设限）、续约（改违约金，规则 4.4.6 全套）、解约、激活（一窗一次 + 5 分钟出价窗 + 24h 匹配窗 + 差额销毁）、强制拍卖（1m 挂牌特例）；窗口状态机（open/close/推进前置校验无活跃会话 + 强制结算开关）。

**验收**：六类操作全路径 + 窗内回滚 4.4.10（§16 状态机测试全绿）。

**状态**：主体完成。旁路五入口（/api/transfers/*）+ 市场激活/匹配（首价即成交价、训练营直进待审、正式进 24h 匹配窗、差额审核时销毁）+ 强制拍卖（1m/CA 前六/税 50%）+ 窗口状态机（open/close/前置校验/window_force_settle 强结）+ 4.4.10 窗内回滚（RC+保护期还原+续约费退还）+ 前端全套（球队中心续约/解约、市场海捞与匹配面板、管理端窗口/强制拍卖/旁路审核单据渲染）；配套裁决与假设落 TECH_DESIGN §6.2/6.3/§15。

## 增量 6 · 财政、赛季与通知（MVP 收口）

**交付**：流水账页（ledger-book）、手动记账兜底、赛季/窗口管理（绑定赛事）、赛果只读同步 + 确认钩子、XP 事件（自动 match_event + 补录）、成长结算首版（升级方案二选一 / 档位核定）、bot 通知（HMAC 投递 + AstrBot 接收插件）、M0 监控报表。

**验收**：PRD §5 MVP 闭环走查剧本全通；通知到达 QQ。

**状态**：主体完成（8 commits：b76ea06…978dcf1，244 测试）。财政流水账+手动记账、赛季建档/绑定赛事、赛果确认（快照幂等+XP 自动钩子）、XP 补录与赛季结算（里程碑/训练营/中国计划）、升级二选一+档位核定、bot 通知（HMAC 投递+AstrBot 接收插件，写入点=赛果确认/升级）、M0 报表；口径裁决落 TECH_DESIGN §15 假设 20-23。「通知到达 QQ」需部署配 SYNC_* 后联调；web 通知收件篮 P1。

## 增量 6.1 · 走查修复与球员库（四裁决落地）

**交付**：走查四裁决落地——绑定层级重构（赛事绑赛季、窗口只管转会准入，0014 迁移+绑定管理端多赛事列表）、初始球员库（0015 initial_club_id+当前/初始双视图）、球员页页内页签（档案/属性/成长+六组细分卡/位置矩阵/星级行/角色带/六维雷达门将换轴）、家族用词表清扫+人数/工资卡口径（超上限红、低于下限蓝）；球员库公开页（筛选+keyset 游标分页）。

**验收**：走查问题清单一问一题闭环；code review（code-review-skill）通过。

**状态**：完成（12 commits：63d92db…b651278，259 测试）。裁决与口径落 TECH_DESIGN §11/§15 假设 24-25、PRD 4.7、UI_DESIGN §4.4/§5；review 修复球员库请求竞态与绑定列表排序。推送与部署待需求方确认。

## 增量 7 · 球队绑定上收认证中心（auth + tour + club 三仓）

**交付**：球队绑定真源上收 auth（推翻 auth TECH_DESIGN §5.3「球队不进 auth」旧裁定并改判记录）——auth 0008 迁移三表（team 目录 / team_bind_code 中央码表 / team_binding 绑定）+ 机器端点五条 HMAC；tour/club 双入口发码烧码写同一张中央表（烧码 auth 单事务原子），两侧旧绑定表休眠保留防回滚、经只读 AUTH_DB 派生读；club 教练判定改「绑定即教练」（auth 对新账号自动发 club.coach，权限点无区分度）；存量迁移脚本 `migrate-team-bindings.mjs` 以 tour team_member 为基准（目录按队名精确匹配，冲突/单边出报告人工裁决）。

**验收**：tour 与 club 绑定/发码互通指向同一绑定关系；一账号一队全生态生效；三仓测试全绿（auth 96 / tour 16 / club 263）。

**状态**：已上线（2026-09-15 部署）。三仓推送（club 8824c42+123846c+7f513ce、auth 32405a6+e5a94d1+47bd100+1eebbb1+726415b、tour 31850c6+471797e）+ code review 通过（修复烧码并发竞速双绑定——条件 INSERT...SELECT 原子闸；register/link 审计同批化）。生产：auth 0008 远端迁移 + 迁移 SQL 已执行（目录 20 队/绑定 10 条/冲突 0/单边 0，club 侧目录关联待 clubs 表有数据后用 /api/team/link 补）；BIND_SECRET 已轮换（AstrBot 插件 bind_secret 需同步，否则 QQ 绑定验签失败）；auth 94cf8114 / tour efc97d59 / club 0303622e，机器端点验签烟测通过（正确密钥进业务层、错密钥 401）。生产补数据：16 支真实俱乐部已建（id=**FC26 TeamID**、name=tour 中文队名，2026-09-18 核对 16/16；原文误记为 tour team id；CPU 4 队当时未建——2026-09-18 更正为应建，见增量13 CPU 待办；`seed-clubs.sql` 存档未提交）并经 /api/team/link 全部关联目录（linked 16/16，里昂→club 2 已验）。

## 增量 8 · 球员库统一 + FC26 ID 对齐（进行中）

方向已裁决：以 club 球员库为准、tour 只读取（tour 侧不再独立维护球员库）；增量 7 已把 auth team 目录（tour_team_id ↔ club_id）建好留路。XP 名字匹配不动。

**FC26 ID 对齐（2026-09-16 已执行）**：球员/球队真源改挂 FC26 数据库 id（用户四裁决：①club `clubs.id` 换 EA id；②tour `team.id` 整体换 id 级联历史；③球员库 18408 人**暂缓导入**，成熟后经 agent 导入；④tour 570 球员同步换 EA id）。执行与验证：

- 匹配：tour 570 球员对 FC26db 18408 人——516 自动匹配 / 54 歧义 / 0 未中（`player-match.json`）；54 歧义后经 s901 阵容表复核全解（`s901-resolve.json`，52 同名唯一命中+2 队籍收窄，`rekey-fc26-s901.sql` 227 句补键已执行），570/570 均 EA id。
- tour 全库重键：team/player 两阶段 temp 中转（`rekey-fc26.sql` 574 句），team_member/entry/auth_code/tactic_submission.slots_json（110 处）/tactic.roster_json（91 处）/match_event/motm_vote 级联；本地彩排（生产快照 `fc26-test-dump.sql`，未提交）FK 违规 0 后生产经 D1 REST `/query` 单事务执行 567 句成功——**`--file` import 通道 defer_foreign_keys 会失效致 FK 回滚，必须走 `--command`/REST 通道**。
- 跨库目录同步：club `clubs.id` 重键 EA、auth `team.tour_team_id`+`team.club_id` 重键（`rekey-cross-auth.sql`，同为两阶段）；终验三库 0 孤儿、auth↔tour↔club 名称 0 不符，里昂 66/66。
- 脚本归档 tour 仓 `scripts/fc26-id-rekey/`。club 仓 `seed-clubs.sql` 已过时（id 已重键，勿再执行）。

**遗留**：`clubs.league_tier` 待需求方给分级（建表语句 tier 仅建时可定）；球员库导入（18408 人）暂缓。

**球员库首灌（2026-09-18 已执行）**：`E:/Downloads/FC26db20251217_fixed.xlsx` 的 `Base` 表（实际 **18407** 数据行，文档旧记 18408 含表头）+ Growth+ 名单，复用端上归一化代码（`src/core/import.ts` 的 `normalizeImportBatch`，按 1000 行切片，与 web 端 `web/src/lib/imports.ts` + `web/src/pages/admin/ImportsPage.tsx` 同口径）离线产 SQL 后 `wrangler d1 execute --file` 逐片直写生产（19 片）；**入库 18301 人**，被校验拦下 30 行（源值缺 `naID`=`#N/A` 与 `FootID`=`Not Found` 两列，本地与在线源均无源可补 → 搁置，生产至今 18301）。工具与报告在 `scripts/players-import/`（`generate-sql.ts` 产片、`overlay-missing.ts` 增量补录、`missing-fields-30.csv` 填值模板、`nation-id-reference.csv` 218 国、`players-import-report.md`），口径见该目录 README。另：主场存量（`scripts/revenue-import/`）16 球场 + 80 设施行同批直写生产；按 `name` 匹配俱乐部的旧脚本 `stadium-import.sql` 已删除（会给 4 支平台无档案球队造 NULL `club_id` 脏行），生产版只剩 `stadium-import-prod.sql`（显式 `club_id`，2026-09-18 执行）。

## 增量 9 · 分级派生（报名定级，club 单仓）

**交付**：联赛级别不再建队时定死（`clubs.league_tier` 休眠）——当季级别由「auth 目录 club_id↔tour_team_id → season_tournaments 定级赛事（仅 league_premier/league_second，杯赛不参与）→ TOUR_DB entry 报名」三跳派生（`src/worker/tier.ts`，同 request memo）；注册提交派生不到级别 400 拦下（tier_pending），注册页报名状态条（红=未报名提示等待/绿=已报名+级别徽章）；管理端建队删定级单选、列表/注册快照/准入体检改派生显示（体检未报名标 tier_missing），clubs 概览徽章空显「未定级」；建队端点双模（AUTH_DB 未配置回滚通道照旧写休眠列）。

**验收**：升降级=换季报名哪座定级赛事就在哪级，club 库零人工写入；多赛事报名（联赛+杯赛）适配；tier.test.ts 7 用例 + 全量回归。

**状态**：完成（271 测试绿 + build ✓）。裁决与口径落 TECH_DESIGN §5.3/假设 27、PRD 4.3、UI_DESIGN 球队中心。推送与部署待需求方确认；生产上线前提：赛季开始前在 tour 建好甲级/乙级两座定级赛事并完成报名。

## 增量 10 · 异常告警 + 管理介入 + 批量维护（已完成 1d83315+3aa1795）

**裁决**（2026-09-16）：三域三增量排期=增量10（小件：告警+管理介入+批量维护）→增量11（赛季结算域：奖金自动+结算按钮+忠诚奖金+growable 重判+下季封存）→增量12（主场收入域：收入公式+设施经营+死忠演化，设施数据模型一次建全）；告警=强制审（命中进 review_tasks 打标，钱不动，宁误报不漏报）；管理介入四类全要（任意单据可撤/关+成交裁定扩权+俱乐部转会禁令+面板统一进审核页）；审核页批准可改裁定价。

**交付**：a 属性批量维护（POST /players/batch 整批原子 ≤200 + 前端文本行解析）；b 俱乐部转会禁令（clubs.transfer_ban 端点+守卫点买卖三 POST+谈判/签约，GET 不拦）；c 异常出价告警三判据（大额 review_amount_threshold 默认 40/短窗抬价/步长拉锯，结算时打标 review_tasks+审核页 ⚠️ 徽章，吞错不阻塞）；d 管理介入扩权（撤出价/强制送审/强制作废/强制成交/作废签约+审核页裁定价批准+admin_fee_adjust 审计）。

**验收**：告警命中单据全额进人工审核（资金零自动放行）；管理组可撤/关任意阶段单据且资金解冻球员还原；批量改属性整批原子回滚；禁令俱乐部无法挂牌/出价/签约。

**状态**：a/b/c/d 全部完成，code review 无阻塞项（284 测试绿 + tsc ✓ + build ✓）。

## 增量 11 · 赛季结算域（已完成 6a9073d+c9aef8c）

**裁决**（2026-09-16）：①奖金分界=逐场即时入账（联赛胜平负/超级杯胜负/小组赛每胜平/淘汰赛晋级）+「赛事完结结算」通用按钮（入场/资格赛保底/小组赛剩余池按胜场占比）；②工资在窗末自动扣（增量 11 实现关窗批并入）；③忠诚奖金=现合同 effective_from 起算到结算时点、入俱乐部账；④结算前置=硬阻断（窗口未关/审核未清/谈判 active/市场未收尾）+软警示（未确认完赛果 acknowledged=true 确认后放行）。

**交付**：迁移 0017（seasons.age_cap + season_tournaments.stage_settled_at + 赛果快照补两队 tour id/stage_kind）；config 新键 prize_table/loyalty_tiers；prizes.ts 即时入账（AUTH_DB 目录映射 club_id，ledgerMovement 幂等闸 ref_type 分侧）；season-settle.ts 完结结算（stage_settled_at 原子闸）/赛季结算（忠诚分档+growable 重判+settled）/体检；window-payroll.ts 窗末工资+富人税（税基=扣完工资后余额）并入关窗批；管理端四端点 + 前端建季年龄上限/结算体检/结算按钮/绑定行完结结算。

**验收**：奖金幂等（同场重确认/重结算不双发）；完结结算 409 幂等；结算硬阻断 409、软警示需确认；忠诚档位 [[0.5,5%],[1.5,10%],[2.5,20%]] 取最高档；富人税=max(资金>125→20%，价值>700→5%)；growable=CA<PA 且 age≤本季上限。293 测试绿 + tsc ✓ + build ✓。

**注**：下季封存初始化并入「按季独立」语义（growable 重判在结算批按本季 age_cap 执行，下季建档时再按新上限重判）；死忠演化留位增量 12。

## 增量 12 · 主场收入域（已完成 a4a5dc0 + review 修复）

**裁决**（2026-09-16 两轮拍板）：①收入=赛果确认即时入账三分（维护费/死忠演化留窗末）；②天气按 40/30/20/10 概率确认时掷出固化；③存量=revenue 插件库导出一次性导入；④设施扩建/升级操作先不做留远期（数据模型一次建全）；⑤影响力=球员项按规则 v5.2 公式自动算（0.25/0.13）+队壳/奖励分管理组维护；⑥近3场=平台已确认赛果，点球决胜按平局计；⑦冠名市场/活动档期/主场事件 P2 不做。

**交付**：迁移 0018（stadiums/club_facilities/match_attendance）；config 键 attendance_model（全套系数）+tier_table；worker/home.ts（影响力公式/上座/三分收入/维护费/死忠演化全套纯函数+两入口）；确认钩子④（revenueError 回显）+关窗批并入（closeWindow 返回 home 摘要）；管理端 GET/POST /clubs/:id/stadium + 教练端 /me/club 主场档案；前端俱乐部主场卡+管理端球场编辑卡；scripts/revenue-import/（存量 20 队导出 SQL+报告）。

**验收**：上座/收入/维护费/演化公式与 revenue 插件逐系数一致（tests/home.test.ts 8 用例，rng 注入确定值断言）；确认/关窗幂等双闸；301 测试绿+tsc+build；规则出处=v5.2 §4.1.2/4.1.3+主规则 §5.1（假设 30-33 立档）。

## 增量 13 · 成长域校准（成长期 / 解约清零 / 中国计划闸门）

**裁决**（2026-09-18，用户逐条给规则）：①只有在玩家队的球员才有成长；②解约立刻恢复初始，口径=**数值归零、历史留档**（用户追问确认）；③里程碑的「累计」只算**当前成长期内**的进+攻——成长期**可手动宣告，也可在开窗时勾选复选框自动宣告**，且**不与窗口绑定**（用户原话：一个赛季可以有多个成长期，通常是两个窗口之间，但有时可能改变）；④中国球员计划 XP 需**在册现行合同**；⑤tour 平台队名带「(CPU)」后缀的队伍自动识别为 CPU 队，其球员无成长。

**交付**：迁移 0019（`growth_periods`：id/season/start_event_id/source/note/declared_by/declared_at）；`worker/growth.ts` 新增 `loadGrowthPeriod`/`listGrowthPeriods`/`growthPeriodStatements`/`growthResetStatements`，里程碑改「当期内 + 最后一次 reset 之后」累计、去重锚改 `milestone:{期号}:{划断序号}:{阈值}`；`worker/transfers.ts` 解约批内清零（`ca=COALESCE(base_ca,ca)`、growth_xp/levels_applied/badges_silver/badges_gold=0）+ reset 划断行；中国计划查询加在册合同 JOIN；`window-machine.ts` `openWindow` 第 5 参 `declareGrowthPeriod` 同批宣告（返回 `growthPeriodDeclared`）；管理端 `GET/POST /api/admin/growth/periods`（审计 `growth_period_declared`）+ `/windows/open` 透传；前端管理端「成长期」面板 + 开窗复选框 + 成长史 `reset` 标签（「解约重置」）。CPU 队规则：`growth.ts` 新增 `isCpuTeam()`（严格半角「(CPU)」后缀），`results.ts` 的队名→俱乐部解析（XP 匹配 `resolve()` 与确认通知 `queueResultNotifications()`）对 CPU 队静默跳过——不计 XP 也不进 `xp.unresolved`（用户裁决：严格匹配，且 CPU 队球员视同海里球员）。

**验收**：成长期三用例（划断后重新累计、手动宣告、开窗勾选同批宣告）+ 多球员里程碑分组回归；**修掉一个 P0 潜伏 bug**——里程碑 totals 查询的 `GROUP BY ge.player_id` 与 `scanRows` 的游标条件拼在同一层，`GROUP BY` 后接 `AND ge.player_id > ?` 会被解析成分组表达式：游标为 0 时全表折成一组、非 0 时在两行间来回跳 → 两名以上有进/助攻事件的球员会**死循环（生产会挂住 worker）**，修法=外层再套一层 `SELECT … FROM (…GROUP BY…) x WHERE x.id > 0`。回归用例已实测能抓住该 bug（换回坏写法即失败）；CPU 队用例（阿森纳 vs 巴塞罗那(CPU)：只记玩家队 XP、CPU 队不进未匹配提示，撤掉守卫即失败）。**309 测试绿 + tsc ✓ + build ✓**。

**待办**：迁移 0019 未 apply 生产、worker 未部署（与 `/me/club` 500 修复同批待部署）。→ **2026-09-19 已办**：0019 已 apply 生产（`d1_migrations` 记到 0020），worker 已由同一批部署上线（线上 `/api/players` 已回 `clubId`/`clubName`、`/api/admin/growth/periods` 有路由被 401 拦下＝增量13 路由在线上）。

**CPU 口径（2026-09-18）**：严格匹配队名半角后缀「(CPU)」（不做全角/大小写容错）+ CPU 队球员无成长（赛果整队静默跳过，已实现）。**2026-09-18 用户更正语义**：CPU 队球员「视同海里球员」只指**转会上视同**（即可海捞）——平台仍要为这 4 支 CPU 队（巴塞罗那(CPU)/曼城(CPU)/RB莱比锡(CPU)/AC米兰(CPU)）建 clubs 行、其球员要带 `club_id`，并且海捞名单查询条件必须相应改造。本节先前的「不建行、按无归属留在海捞池」记载作废。六问细则已全部裁决并落地，见「增量 14」。

**CPU 六问的裁决记录（2026-09-18 逐条，来自本节原先的问题清单）**：1) 队名带「(CPU)」后缀、判定沿用 `isCpuTeam` 队名口径（**不加列、不做迁移**）；2) 存量 107 人 `club_id` = **导入逻辑写 + 一次性 SQL 回填**；3) 队 id 用**游戏真 id**（米兰 `131681`/国米 `131682`/拉齐奥 `115841`/亚特兰大 `115845`）+ 对外显示真名；4) `initial_club_id` **删除**（用户裁定「无意义」）；5) CPU 队球员代表 CPU 队出场**维持整队跳过、不计 XP**；6) auth 目录**补 4 行 club_id 但平台入账侧禁止 CPU 队入账**。原「已查明的事实」四条（三处「海里球员 = `club_id IS NULL`」闸门、平台 club id 与 tour 编号两套体系、clubs 无 CPU 标记列、`isCpuTeam` 吃队名）仍然有效，细节见 TECH_DESIGN 假设 36/37。

**六问之前的两项关键澄清**：①平台 `clubs.id` = **FC26 TeamID**（16 支联盟队逐条对上）。**2026-09-19 更正**：原写「tour `team.id` 是另一套内部编号 1–21、4 支 CPU 队在 tour 侧是 id 6/16/19/21」与生产不符——tour 库与 auth 库的 `team` 表实测都已统一到 FC 队 id 空间（20 行：16 支联盟队 `id`/`tour_team_id` 逐条等于平台 `clubs.id`；4 支 CPU 队为 `10`/`47`/`241`/`112172`，其中米兰当时还带 legacy 号 47（须跨号映射到平台 `clubs.id 131681`）——**2026-09-19 已收口**：tour 与 auth 两侧的米兰都改成 `131681`，四个 id 空间（tour `team.id` / auth `tour_team_id` / auth `club_id` / 平台 `clubs.id`）完全一致，见增量 14「生产执行」⑥；国米/拉齐奥/亚特兰大 131682/115841/115845 在目录里没有行，仅存在于球员 `game_attrs.TeamID`）。②第三方 fixed 快照里 CPU 队与 4 支 EA 未授权队的编号（241/10/112172/47 与 39/44/46/47）与游戏真表不一致，本轮查清后统一到游戏真 id。

## 增量 14 · CPU 队与队籍口径（代码已推送，生产数据侧 2026-09-19 已执行）

**裁决**（2026-09-18，承接增量 13 的 CPU 六问）：①CPU 队 clubs 行 name = `巴塞罗那(CPU)/曼城(CPU)/RB莱比锡(CPU)/AC米兰(CPU)`（与 tour 队名逐字一致），CPU 判定沿用 `isCpuTeam` 的队名半角「(CPU)」后缀口径——**不加列、不做迁移**；②存量 107 名 CPU 队球员的 `club_id` = **导入逻辑写 + 一次性 SQL 回填**；③4 支 EA 未授权队的队 id 用**游戏真 id**（米兰 `131681`、国米 `131682`、拉齐奥 `115841`、亚特兰大 `115845`）+ **对外显示真名**（用户原话：「球队名仍要是AC Milan。国米，拉齐奥，亚特兰大也是这样的情况，一并解决」）；④`initial_club_id` **删除**（用户：「所以这个无意义，可以去掉这一字段了」）；⑤被海捞签下的 CPU 球员，其代表 CPU 队出场的赛果**维持整队跳过（不计 XP）**；⑥auth 目录**补上 4 行 club_id 但平台入账侧禁止 CPU 队入账**。

**交付**：迁移 0020（`ALTER TABLE players DROP COLUMN initial_club_id`）。`core/fc26.ts` 加 `FC26_TEAM_ID_ALIASES`（39→115845 / 44→131682 / 46→115841 / 47→131681）+ `normalizeTeamId`（legacy 号一次换真号）+ `FC26_CPU_TEAM_IDS`（10/241/112172/131681）；`core/import.ts` 的 `NormalizedPlayer` 增 `clubId`（`clubIdForTeam`：只有 4 支 CPU 队写，其余 NULL），两通道的 `gameAttrs.TeamID`/`teamid` 走归一化；`players-import.ts` 的 `upsertStatement` INSERT 加 `club_id`（`ON CONFLICT DO UPDATE` 不含它，免覆盖认领/解约后的事实归属）。三处「海里球员 = `club_id IS NULL`」闸门放行 CPU 队：海捞名单（`routes/market.ts`，全员附东家名、上限 100→300）、海捞签入（`bypass.ts` `createFreeAgent` 放行并把 `fromClubId` 记成 CPU 队 id——原为 null 时过户守卫 `club_id IS ?` 会更新 0 行、球员摘不走）、通道 C 认领（`contracts-import.ts`，classify 与落库闸同步）。CPU 队不入账：`prizes.ts` 的 `clubIdByTourTeam` 用 `cpuClubIds` 过滤（auth 目录里 club_id 照补，奖金/主场收入不发）、强制拍卖拒绝 CPU 队球员（`bypass.ts` `createForcedAuction`，理由=成交价会记到 CPU 队头上）。`growth.ts` 加 `CPU_CLUB_IDS_SQL`/`cpuClubIds`（SQL 侧 `substr(name, -5) = '(CPU)'`，与 `isCpuTeam` 逐字对齐）。删列出口：`routes/players.ts`（`view=initial` 保留 CA=base_ca、PA=导入值的口径；归属列两视图都打当前归属）+ 前端 `web/src/lib/api.ts`、`pages/{PlayersLibrary,Player,Market}.tsx`；`web/assets/ref/team.json` 补 4 条「真 id → 真名」+ `scripts/gen_ref_json.py` 的 `TEAM_NAME_OVERRIDES`（再生成不丢，旧 id 条目保留给未重键的历史 `game_attrs`）。

**验收**：**316 测试绿 + 三份 tsc 干净 + vite build 通过**。新增 6 组用例：队籍与别名（通道 A 三行落 241/131681/null、通道 B 只换 `game_attrs.teamid` 不写 club_id——最初写错断言即被抓住）、通道 C 认领 CPU 球员（预览 claim、确认后归属）、海捞 CPU 球员全链（名单带东家 → 成约后从 CPU 队摘出 → `ledger_entries` 里 CPU 队 0 流水）、强制拍卖拒绝、平台队打 CPU 队只发平台侧奖金、`clubIdByTourTeam` 过滤；`tests/players-library.test.ts` 四处改造（0015 回填用例保留 + 新增 0020 删列用例）。code review 自查修掉两项：①SQL 侧原用 `LIKE '%(CPU)'`（SQLite 对 ASCII 不区分大小写，会与 `isCpuTeam` 的严格口径分叉）→ 改 `substr(name, -5)`；②海捞名单 `LIMIT 100` 在池里多了 107 名 CPU 球员后会藏掉低 CA 那半截 → 改 300。

**生产执行（2026-09-19，全部逐条复查通过）**：①**补迁移账目**——0016/0017/0018 当初是 `--file` 直跑、`d1_migrations` 只记到 0015，先插回三条记账（`scripts/prod-20260919-increment14/00-migration-bookkeeping.sql`）再 `migrations apply --remote` 走完 0019+0020（复查 `growth_periods` 表在、`players.initial_club_id` 列已无、`d1_migrations` 20 行）；②**4 支 CPU 队 clubs 行**（`01-cpu-clubs.sql`：`10 曼城(CPU)`/`241 巴塞罗那(CPU)`/`112172 RB莱比锡(CPU)`/`131681 AC米兰(CPU)`，status='active'）；③**107 人 `club_id` 回填**（`02-backfill-cpu-club-id.sql`，幂等护栏 `club_id IS NULL`，复查分布 10→26/241→28/112172→29/131681→24）；④**105 人 `game_attrs.TeamID` 重键到游戏真号**（`03-rekey-teamid.sql`，须在 ②③ 之后跑，复查 115841→30/115845→27/131681→24/131682→24、旧号 39/44/46/47 清零）；⑤**auth 目录 4 行 `club_id`**（`04-auth-team-links.sql`，在 auth 仓执行；**注意跨号映射 `tour_team_id 47 → club_id 131681`**，写 47 会绕开 `cpuClubIds` 过滤＝给不存在的俱乐部记账）。worker 与前端由同批 `wrangler deploy` 上线（线上 `/api/players` 已回 `clubId`/`clubName`、无 `initialClubName` ⇒ 0019/0020 删列安全）。五个工件都带回滚语句写在头注释里。⑥**米兰队 id 统一 131681**（`scripts/prod-20260919-milan-rekey/01-tour-rekey-team-id.sql` 在 tour 库、`02-auth-tour-team-id.sql` 在 auth 库）：tour `team.id 47→131681` 连带 `player.team_id` 25 行、`entry.team_id` 2 行（其余 6 张引用 `team(id)` 的表在 47 上 0 行，一并写上作幂等保障）；auth `team.tour_team_id 47→131681`。复查：tour `team` 表 20 行含 `131681 = AC米兰(CPU)` 不含 47、`player.team_id=131681` 25 行、`entry.team_id=131681` 2 行、`audit_log` 里 `target_id=47 AND target_type='match'` 的 10 行**未动**（那是比赛 id 撞号，误改会污染审计）；auth 四支 CPU 队全部 `tour_team_id = club_id`（241/10/112172/131681）。**执行方式有硬约束**：D1 的 `PRAGMA defer_foreign_keys = ON` 在 `--file` 导入通道下失效，父行先改会被 FK 立即拦下并整批回滚 → 必须走 `--command`（本地 D1 用同名结构实测过：无 defer 报 `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT`，带 defer 一次通过，且批中任一语句失败整批回滚不留半成品）。

---

## 增量 15 · 管理端重构（壳 + 8 子页 + admin 拆分 + config 超管全开 + 暂停出价；2026-09-19 已部署上线）

**裁决**（2026-09-19 脑暴，见 refactor-plan-decisions 记忆）：①管理端从 2993 行单页拆左侧栏壳 + 8 子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；②后端 `admin.ts`（1381 行/47 端点）拆 `routes/admin/` 八域，URL 零变；③数据层接 TanStack Query（仅管理端，用户端留增量 16）；④新增暂停出价（全局 config 开关 + 单挂牌列，两者都要——用户：「转会干预里增加暂停出价→两者都做」）；⑤config 超管全开零认证中心改动（超管权限点平台侧投影）；⑥批量维护结构化逐行预览，消灭静默剔除。

**交付**（6 个 commit）：`421ca8b` 八域拆分（47 端点逐字节等价，子代理审查通过）；`dd94c5b` 壳 + 8 页（section 原样搬迁，headless h2 计数对基线）；`148cf12` TanStack Query（共享 ADMIN_CLUBS_KEY 四处去重、写后 invalidate）；`a4c4418` ConfirmButton 统一 16 个两段式确认 + usePrompt 替代 2 处 window.prompt + 导入切片泛型助手 + 批量维护逐行预览表；`afc39b7` 暂停出价（迁移 0021 `listings.bid_paused` + config 键 `market_bid_paused` + 4 管理端点 + 出价入口 423 双码 `bid_paused`/`listing_bid_paused` + 板/详情透出 + 用户端禁用提示；语义：只挡新出价，不改变结算时刻）；`3519fea` config 超管全开（独立权限点 `club.config.manage.super`，两登录模式各自投影；GET 明文/PUT 逐键编辑 + 审计 `config_set`，涉密键审计只落掩码）+ `GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1` 强拉）+ `GET /api/admin/audit-log`（limit 钳 100、action 前缀过滤）+ 系统页编辑/审计日志区 + 总览计数卡 + 顶栏超管徽章。

**验收**：**327 测试绿 + 三份 tsc 干净**（暂停出价 +4 用例、admin-system +7 用例）；本地 D1 已打 0021；headless 冒烟转会/系统/总览页通过。收口 code review 修掉：系统页 config 读取失败误显「读取中…」、总览刷新连发 3 请求（改单次 fetchQuery + fresh=1）、3 处指向旧 admin.ts 的注释。**生产执行（2026-09-19，用户下令部署）**：迁移工件 `scripts/prod-20260919-increment15/001-add-bid-paused.sql`（含回滚语句）；先复查远端 `d1_migrations` 干净（记到 0020）→ `wrangler d1 migrations apply whl-club --remote` 打 0021（复查 `pragma_table_info('listings')` 出现 `bid_paused INTEGER NOT NULL DEFAULT 0`，账目 21 行）→ `npm run build`（构建前清掉本地冒烟残留的 `dist/_headers`，构建后确认不复活）→ `wrangler deploy` 同批上线 worker 与前端，Version `4d03eb57-cfd2-4d85-92e2-aa89f96528e2`（deployments list 尾部确认 100% 生效）。线上抽查：首页 200、`/api/admin/overview`、`/api/admin/config`、`POST /api/admin/market/pause-bids` 未登录均 401（新路由已生效非 404）、index.html 引用的 `index-CaF-le0n.js` 与本次构建产物一致。

---

## 增量 16 · 用户端重构（Market 拆三页 + 登录守卫 + AuthContext + TanStack Query 铺开 + 注册逐人标红；2026-09-19 本地完成）

**裁决**（refactor-plan-decisions 记忆）：①Market=子路由三页 `/market`（挂牌板+详情出价，公开）、`/market/free`（海捞签入+训练营激活，需登录）、`/market/mine`（挂牌我的球员+我的出价，需登录），seg 子导航切换；②用户页守卫 `RequireUser` 软卡不重定向（沿管理端 AdminLayout 风格），匿名显示对应登录入口（oidc 统一登录 / 兼容模式去赛事系统）；③AuthContext 落地——`/api/me` 全站单点拉取（useQuery `['me']`，staleTime Infinity，登录登出都是整页跳），TopBar/Home/AdminLayout 的 props 钻透退役；④用户端 8 页数据层全接 TanStack Query（key 设计沿用管理端口径，写后精确 invalidate，不引 useMutation）；⑤注册逐人标红——`SquadIssue.playerIds` 后端早有、前端从没用过，改后按球员展开行级红底 + 规则短标签 badge（title 悬浮完整 message），compliance 预检与 422 打回双源生效；⑥worker 侧零改动。

**交付**（7 个 commit）：`92a1d03` AuthContext（lib/auth.tsx，me 拉失败按匿名兜底不卡加载闸）；`25cecc9` RequireUser 守卫（/club /bind /negotiations /ledger + 市场后两页）；`2f5b885` Market 拆三页（875 行单页退役，`pages/market/` 四文件：BoardPage/FreePage/MinePage/shared，区块原样搬迁；三态区分「加载中/无俱乐部/非教练」——首版把两者都落 null 会永远停在「正在确认」，冒烟抓出）；`ddde5c9` 数据层（`lib/queries.ts` 共享 qk：me/club、squad、my-bids、board、listing、free-agents、trainees；游标页 useInfiniteQuery；出价→板+我的出价+详情联动失效，绑队→me/club 失效）；`daf3c93` 注册标红（`row-flagged` 浅红底 + `ISSUE_RULE_LABEL` 七规则短标签；规则级问题 playerIds 为空自然不命中，banner 兜底）；`5dc9152` 收口审查修复（见验收）。

**验收**：**327 测试绿 + 三份 tsc 干净 + build 过**；headless 冒烟：市场三页切换/匿名守卫软卡/注册标红（本地三库种最小数据：auth team+binding、club 赛季+定级赛事+6 人名单+合同+含不可成长训练营的快照、tour 最小 entry 表，体检返回 `trainee_growth playerIds=[9005]` → 阿五行红底+badge 截图确认）/球员库分页钮到底状态正确。**收口 code review 修掉 3 处**：①无限查询 `getNextPageParam` 返回 null 在 v5 里仍算有下一页（只有 undefined 才是到底）→ `?? undefined`，否则最后一页按钮还亮、点了重复拉第一页；②球员库「上一页」不能用 `fetchPreviousPage`（它是往前补页不是回退，页码与行会错位）→ 页码状态 + 缓存回退还原旧游标栈语义；③市场详情切卡保留旧详情（placeholderData keepPreviousData，旧行为）。

---

## 增量 17 · 体验修缮 + 俱乐部目录工具（2026-09-19 本地完成；2026-09-20 已部署 Version 90bfd78f，生产队籍回填同日执行完毕）

**裁决**（计划 `.zcode/plans/plan-sess_4cad139a-6977-4a40-9531-f7cf24c68499.md`）：①换队壳=换游戏队号（rekey 口径）；②新建俱乐部必填游戏队号+自动建 auth 目录；③多教练同权限、逐个解绑；④队籍回填只写队籍不造合同；⑤徽章筛=具体 PlayStyle 多选；⑥**列显示与筛选双向联动**（筛选激活→列自动加入，取消→自动移除，手动勾选过则手动为准）；⑦年龄快捷预设不做；⑧站内信顺延增量 18。

**交付**（9 个 commit）：`15f5950` TopBar 响应式重排（桌面单行、≤640px 品牌用户区/导航两行横滑）；`c158068` 球员库接口扩展（total+新增筛选：身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/34 细分属性区间/合同域全整套：has_contract+周薪+解约金+formal/trainee+成约方式+保护期+效力年限+UID/fc_id 精确查号）；`52bc412` 球员库改版（翻页条上移带「共 N 名 · 共 M 页 · 第 X 页」、每页 20、SoFIFA 式可变列双向联动、更多筛选折叠面板、URL query 持久化、UID 去 fc 前缀）；`09890a8`+`d0d8e3c` 新建俱乐部必填 gameTeamId（TOUR_DB 校验+队名预填+指定 id 建 clubs 行+`authRegisterTeam` upsert 建 auth 目录，失败不回滚可重试；双模 league_tier 保留；GET /clubs 改 bindings 数组+前端多教练逐个解绑）；`54a8e45`+`f9ee04c` 换队号 rekey 预演工具 `scripts/rekey-team/`（三库核查清单+硬闸+01/02/03 SQL 工件+README；f9ee04c 补换壳模式 auth `club_id` UNIQUE 撞号预演闸——`tour_team_id` 空闲但 `club_id` 被占执行期才炸，本地演练双向验证：干扰行在→exit 2 无工件、删→正常产出）；`05c8e06` 16 队队籍回填预检+SQL 工件 `scripts/prod-20260919-roster-backfill/`（444 人幂等 UPDATE，逐行期望数）。

**验收**：**342 测试绿 + 三份 tsc 干净 + build 过**（新增 15 用例：游戏队号三库建档/缺号 404/重号 409/目录失败重试/多教练 bindings/球员库新筛选域）。本地冒烟：新建俱乐部三库落行、多教练双绑定显示与逐个解绑（stale dist 曾误显未绑定，重建后正常）、rekey 演练 A 执行+回滚、演练 B 负向闸 exit 2。收口 code review 修两项：测试夹具统一吃 gameTeamId（10 文件 106 失败→全绿）；rekey 换壳 club_id 撞号闸（上述 f9ee04c）。**Windows 踩坑**：`npx.cmd` spawnSync 无 shell EINVAL（Node 24）→ `execFileSync(process.execPath, [wrangler.js…])`；UNION ALL compound SELECT 实测 ~8 项上限 → 标量子查询别名 `'table.column'` 每批 100。

**待办（已于 2026-09-20 全部完成）**：①push —— 增量 17 随增量 17–24 共 50 个提交一并推送（`9f05116..fe60273`）；②部署 —— 与 bindings 数组、前端 `AdminClubRow` 同代次发布，出 Version `90bfd78f`；③生产执行 16 队 roster backfill（444 人，`scripts/prod-20260919-roster-backfill/`）—— 同日下令执行，444 行写入、复查通过，记录见该目录 README。

---

## 增量 18 · 站内信 web 收件篮（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**裁决**：原增量 17 顺延至此（增量 17 插队批顶替）；写入点不扩——赛果确认与升级两处照旧调 `queueClubNotification`，内部改双通道；未读判定独立列 `read_at`，不复用投递状态 `status`。

**交付**（3 个 commit）：`14af2f3` 服务端——迁移 0022（`notifications.read_at`）；`queueClubNotification` 双通道：每个绑定账号一条 `channel='web'` 行（`status='sent'` 免投递，进收件篮），绑了 QQ 的另加一条 `qq` 投递行（两通道互不挤占，qq_links 未命中的教练也有站内信了）；`dispatchPendingNotifications` 加 `channel='qq'` 过滤双保险；新 `routes/notifications.ts` 三端点（列表 id 倒序游标 30/页 + 未读数、`unread-count`、`read` ids/all 双模式只动本人 web 行幂等）。`104fa97` 前端——`/notifications` 收件篮页（mono 时间 + 模板徽章摘要、未读 sky 蓝点加粗、点行标已读、全部已读、游标「再看 30 条」）+ TopBar 用户区收件篮入口与未读蓝点（60s 轮询 + 聚焦拉取）+ 顺手修 `--cream` 未定义变量（52bc412 潜伏 bug）。`999068d` review 修复——`read` 的 ids 超 D1 单查询绑定参数上限 100 会 500，改按 100 分块 `db.batch`（150 条用例）。

**验收**：**347 测试绿 + 三份 tsc 干净 + build 过**（notify.test.ts 期望全面升级 + 收件篮 5 新用例：本人隔离/游标分页/标已读幂等与他人不可动/分块/投递通道只认 qq）。本地 8791 冒烟：双通道落行、三端点、headless CDP cookie 注入截页——顶栏蓝点、未读徽章、蓝点加粗行逐项目视确认。

---

## 增量 19 · 设施经营——球场扩建 / 档位升级 / 子设施升级 + 建设券（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**规则口径**（revenue 插件 README §三/§四 + `_conf_schema.json` + formula.py:407）：扩建 0.1M/100 座、限当前档位座位区间；升级按**当前档** upgrade_cost、需容量 ≥ 新档 min_seats + `stadium_max_open_tier` 开放闸（默认 1，S9 只开 0→1）；子设施五类 0–5 级费用 `3,5,8,12,16`（config 键 `facility_prices` 六位串）。建设支出全额 × `voucher_refund`(0.25) 返建设券，券只抵后续建设支出（先券后钱）；混合支付时账本只记现金，memo 注明券抵。

**交付**（3 个 commit + 1 修复）：`937c68f` 服务端——迁移 0023（`stadiums.build_credit`）；新 `stadium-ops.ts`（扩建/升级/设施升级三操作 + 券拆分 `splitPayment`/`creditRefund`；玩家主动操作全部 `idempotent: false` 关账本幂等闸；三条 UPDATE 各带守护条件，`changes===0` → 409，与全库惯例一致）；`routes/clubs.ts` 四端点（`GET /club/stadium/build-info` 一次拉全预览 + 三个 POST）；config 增 `facility_prices`/`stadium_max_open_tier` 两键（58→59）。`1cf1d8a` 前端——球队中心设施经营卡：扩建输入（100 座步进校验 + 档位余量提示）、档位升级（未开放/容量不足置灰带 title）、五类子设施逐级升级；费用提示券抵与实付，操作后失效 `stadiumBuild`/`myClub`/`balance` 三查询。`fa973a5` 修复——冒烟抓到真 bug：设施升级 batch 漏了 `build_credit` 的 UPDATE，券只进提示不落库；补语句 + 券余额断言。

**验收**：**355 测试绿 + 三份 tsc 干净 + build 过**（stadium-ops.test.ts 8 用例：券拆分/返券、扩建成功与四种闸、升级两档闸、设施升级全链含券余额落库断言、路由冒烟）。本地 8791 冒烟实测闭环：commercial 1→2 级返回 `{cost:5, creditUsed:0.25, cash:4.75, refund:1.25}`，库内 `build_credit 0.25→1.25`、`balance 46.65→41.9`、level=2 全对；headless 截图确认设施经营卡渲染与数据一致。

---

## 增量 20 · 冠名市场——品牌池报价 / 签约 / 退约 + 窗末收租（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**前置修复**：`801b422` 账本幂等闸补 club 维度——NOT EXISTS 原按 (kind, ref_type, ref_id) **全局**查重，而窗末结算给每个俱乐部记同 (kind, 'window', refId) 流水，多队关窗 wage/maintenance 只有第一队落账（生产未触发，下次关窗必炸）。闸改按 (club_id, kind, ref_type, ref_id)，全调用方核对无人依赖全局语义，补两俱乐部同 ref 回归用例。

**规则口径**（revenue 插件 brand_service.py / window_service.py / formula.py:462 实读）：品牌池 7 家无排他（多队可签同一品牌）；底价/窗 = (0.5 + 0.3×容量万 + 0.12×死忠万) × 热度，按签约时队况锁定整约；三套餐 稳健 6 窗×0.85 / 进取 2 窗×1.25 / 对赌 4 窗×0.7 + 达线奖金（上座≥0.8 或死忠增长≥0.03，奖金=保底×0.7）；提前解约赔剩余窗口费用 30%（当窗照收，remaining−1 口径）。

**交付**：`390fac4` 服务端——迁移 0024 `naming_contracts`（费用条款快照列化，部分唯一索引拦一队双签）；`naming-ops.ts`（品牌池常量 / 底价 / 三套餐 / sign / terminate / 窗末结算语句）；`windowHomeStatements` 并入收租+窗口递减+到期+对赌奖金（幂等靠前置修复后的账本闸）；`routes/clubs.ts` 三端点（quote 现算报价 / sign / terminate）+ `/me/club` home 加 `namingBrand`；config 单键 `naming_params`（JSON，仿 tier_table），键数 59→60。`d29ffbd` 前端——球队中心冠名卡（无约列品牌×三套餐签约按钮，有约展示条款与剩余窗口、退约 confirm 回显赔金），主场档案标题「品牌·球场名」。

**v1 未做**（跟进插件现行口径：满意度解约在行情演化接入前不生效）：品牌主动解约/满意度、续约、品牌自定义套餐变体、LLM 生成品牌、admin 品牌池管理、行业系数（一律 1.0）、fee_mod 信号系数。

**验收**：**367 测试绿 + 三份 tsc 干净**（naming-ops 11 用例：底价/套餐数值断言、签约快照、双签 409、野品牌 400、窗口闸、赔金计算、最后 1 窗赔金 0、窗末收租/奖金达线四象限/到期 expired；ledger 前置修复回归 2 用例）。本地 8791 冒烟全链：报价数值手算吻合（21000 座/1800 死忠/亚马逊 → 1.497）→ 签约快照 → 主场档案显示「亚马逊·酋长球场」（截图）→ 退约赔金 0.943=3×1.048×0.3、流水 −0.943、状态 terminated。

---

## 增量 21 · 赛果自动化——cron 自动确认 / 钩子重放 / 人工复核 / auth 审计（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**P0 修复**：确认钩子原本裸奔——XP/通知在快照落库后同步执行，任一失败把已入档的确认炸掉且 409 挡住重试。`b9dc6db` 把四钩子（XP/通知/奖金/上座）收进 `runHooks` 逐个吞错收集，确认主体不再被钩子拖死。

**交付**：①`autoConfirmResults` 挂进 `runSettleTick`（cron `*/5`）：扫绑定赛事完赛未确认场次逐场入档，actor=0 系统留痕，每轮 cap 20，单场失败计 failed 不挡整轮；config 开关 `results_auto_confirm`（数值口径，0=off），键数 60→61。②`replayHooksForMatch` + `POST /admin/results/:id/replay-hooks`：钩子参数优先取 TOUR_DB 现况（stage_config/winner_team_id 快照表没有，清库时回退快照），幂等靠 XP UNIQUE 锚/奖金账本闸/上座主键。③迁移 0025 `result_confirmations` 加 needs_review/review_note：任一钩子异常或 XP unresolved 非空即标「待复核」（note 截 300）。④auth 三事件审计：auth_login / auth_logout / auth_backchannel_logout（backchannel actor=0），writeAudit 尽力而为不阻塞登录主流程。⑤前端（`54e6797`）：SeasonsPage 已确认列表「复核」列（待复核徽章 title 带 note + 重放钩子按钮 + cron 口径提示语），SystemPage 审计 actor=0 显示「系统」。

**review 修复**：`0463d38` 重放不再重排通知——`queueClubNotification` 无去重锚，原实现重放一次就给绑定账号重复插 web/QQ 行；改为重放跳过通知钩子（notifications 无锚是根因，schema 加锚留待有真实重复需求再议），原确认时通知失败的信号保留在复核标记里不丢。另修 replay 回退快照时 `m.id` 误用确认行 id 的埋雷（未被调用，一并收紧）。

**验收**：**369 测试绿 + 三份 tsc 干净**（results 新增自动确认两用例：干净场 actor=0 入档/开关 off 跳过；unresolved 标复核→补录→replay 清标记且 XP 不双记、通知不重排；oidc 三处审计断言）。本地 8791 全链冒烟：本地 whl 库种裁剪版比赛结构 + 两场完赛（一场全可解析、一场客队「幽灵 FC」不可解析）→ `POST /api/cron/tick` 一次 `confirmed=2 flagged=1` → 快照 confirmed_by=0/needs_review 与 note 全对 → XP 8 事件 6.5 值、上座两行、通知按绑定账号落库 → replay-hooks 两场 201 且二次 tick confirmed=0、XP 总量不变 → SeasonsPage 截图复核列徽章+按钮齐备。**0022-0025 四迁移随下次部署 apply --remote。**

---

## 增量 22 · 换版机制与导入加固——小/大换版模式 / 合同导入校验 / 预览警告 / CPU 列化（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**I1 换版模式**（规则 §5.4 / TECH_DESIGN §10.4，`1161ee9`）：导入原 upsert 把 CA 拉回源值但保留 growth_xp/levels/徽章——既非小换版也非大换版的缺陷。`players_import` 加 `mode`：**小换版**（缺省）成长全保留、CA 增量平移（`ca = excluded.ca + max(ca−base_ca, 0)`）；**大换版**经验清零、成长 CA 与徽章各保留 1/3 向上取整（SQLite 整数除法 `(δ+2)/3` 即 ceil）、levels_applied 归零；`base_ca` 都刷到新源值；新插入路径两模式等价。预览统计加 growthPlayers（δ>0 将受影响人数）与 xpToWipe（大换版将清零经验总量）；确认审计批次带 mode。前端导入页加模式选择（大换版红色警示 + armed 二次确认沿用），预览块渲染换版统计与警告表。离线脚本 generate-sql.ts 加 `--mode`（`4ff6634` 分片头与报告记录模式，生产执行可追溯）。**档案划断口径**：成长字段归零 + 审计留痕，不插 growth_events/growth_periods 行（18k 行级插入会打爆 D1 写配额）。

**I3+I4+is_cpu（`9bfacf9`）**：①合同导入 clubId 不存在原本预览放行、落库撞 FK 500——preview/confirm 双 404；②导入管线加 warnings 清单（TeamID/teamid 脏值按无队籍落库但不静默）+ naID 值域 1-1000 挡行（通道 B nationality 同口径）；③迁移 0026 `clubs.is_cpu`（按队名 (CPU) 后缀回填），`cpuClubIds`/`CPU_CLUB_IDS_SQL` 改走列，tour 侧 `isCpuTeam` 队名判定保留；`FC26_CPU_TEAM_IDS` 常量保留（导入源口径）。

**验收**：**376 测试 + 三份 tsc + build 全绿**（新增 import.test.ts 7 用例：naID 值域/TeamID 警告、小换版平移+成长保留、大换版 ceil 折算+清零、δ≤0、新插入等价、mode 400、合同 404、cpuClubIds 走列）。本地 8791 冒烟：两名 δ=5/XP12/银7金2 球员实导——minor → ca 75、成长字段原样；major → ca 72、xp 0、levels 0、银3金1；naID 5000 挡行、坏 clubId 404；导入页模式选择器截图核验。**部署注意：0026 --remote apply 后须核查 `SELECT id,name,is_cpu FROM clubs` 命中 4 支 CPU 队**（回填按队名后缀，若生产队名无后缀则手工 UPDATE）。

---

## 增量 23 · 性能与守护——排序表达式索引 / 进程内限流 / TTL SWR 缓存 / e2e 冒烟（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**范围裁决**：脑暴原案是「KV 限流 + KV 缓存」，实测否决——KV 免费档写约 1k 次/天，公开 GET 每请求写计数或刷缓存会打爆写配额。改**进程内**（module 级 Map）实现，代价是 isolate 重启即清、多 isolate 不共享，朋友局流量可接受（口径写在 `src/lib/guard.ts` 头注释）。

**① 排序表达式索引**（`5ab715c`）：球员库排序走 `COALESCE(col, 0)` 表达式 + `id`（`players.ts` SORT_EXPRS），普通列索引匹配不上，18k 行每次全扫排序。迁移 0027 建 4 条 `CREATE INDEX idx_players_sort_{ca,pa,age,market_value} ON players(COALESCE(<col>, 0), id)`。本地 EXPLAIN QUERY PLAN 实证三条查询均 `SCAN players USING COVERING INDEX idx_players_sort_*`（无排序步骤）。influence 排序（表达式内联 config 系数）与 `view=initial` 排序无法静态索引，保持全扫（低频可接受）。

**② 公开 GET 守护**（`ecea30d`）：新增 `src/lib/guard.ts`——`memoryRateLimit(key,limit,windowMs)` 固定窗口限流（Map 超 10k 清过期桶）、`assertPublicRate(c,scope)` 60 req/60s/IP（`CF-Connecting-IP` 回落 `'local'`，超限 429）、`cachedJson(key,ttlMs,loader,ctx?)` TTL+SWR（新鲜直回；过期回旧值 + 后台单飞刷新防击穿；**ttlMs≤0 = 旁路**）、`waitUntilOf(c)`、`resetGuards()`。挂点 `/api/players`（列表体抽成 `listPlayers(c)`）与 `/api/clubs/directory`；TTL 取 `env.PUBLIC_CACHE_TTL_MS`（未配/0 = 旁路，故测试环境天然不缓存），生产 vars 配 20000。

**③ 自审修复**（`18841a6`）：`cacheStore` 原本无淘汰——键来自外部可控的查询串，公开 GET 每换一个查询串就多一条，构造请求能把 isolate 内存堆到 OOM（`rateBuckets` 有 10k 兜底，缓存没有）。加条数上限 64（单条响应 4KB 量级）+ 超限按插入序淘汰最旧（跳过正在刷新的）；键改用 `canonicalQuery` 按参数名排序归一（`?a=1&b=2` 与 `?b=2&a=1` 同一份数据，原本算两个键重复装载）。

**④ e2e 冒烟**（`652b04f`）：`scripts/e2e/smoke.mjs` + `npm run test:e2e`——playwright-core + 系统 Chrome，对 dev 8791 黑盒跑 8 场景：首页渲染、会话生效、公开接口、球员库翻页文案与排序交互、市场页、管理端可达、收件篮、无未捕获前端错误（失败自动截图到 `scratch/`）。会话种子只动本地：cookie `whl_session` → 共享 KV `sess:{token}` → TOUR_DB `user` 表（`wrangler kv key put --local`，绝不用 `--remote`——该命名空间与赛事/竞猜共用）。

**验收**：**387 测试 / 30 文件绿 + 三份 tsc 干净 + build 过**（guard.test.ts 11 用例：限流窗口/分桶、缓存命中、SWR 过期回旧值+单飞、ttl≤0 旁路、61 次请求 429、键归一、超限淘汰；players-library.test.ts 加文件级 `beforeEach(resetGuards)`——该文件密集打 /api/players，不清计数真会撞 60 次限流）。e2e 8/8 通过（rebuild 后复跑）。**部署注意：0027 远端 apply 一次性写 ≈18301×4≈73k rows_written，须择日或当天不叠加其他写**（见 D1 配额口径）。

**遗留**：e2e 跑的是本机 dev 进程（该进程早于 `AUTH_MODE` 变量启动，实际在兼容模式），故只覆盖兼容模式会话路径；OIDC 模式下的登录态场景与 `PUBLIC_CACHE_TTL_MS` 生效路径由单元测试覆盖，未做端到端。重启 dev 后按 `npm run dev` 起的进程会是 OIDC 模式，届时 e2e 需改种 `oidc_session` 行 + `__Host-club_session` cookie（脚本头部注释已写明）。

---

## 增量 24 · 文档收口——README / AGENTS.md / CHANGELOG / scripts 索引 / TECH_DESIGN 与现状对齐（2026-09-20 本地完成；同日已部署 Version 90bfd78f）

**范围**：不改任何运行时代码，只把仓库文档拉到与代码一致的现状，并清掉过期草稿。盘点发现三处空白——`README.md` 仅 30 字节标题（自 Initial commit 起未动）、无项目级 `AGENTS.md`、无 `CHANGELOG.md`；`TECH_DESIGN.md` 有五处与代码冲突（config 键表缺 5 键、§15 假设未分类、§17.3 仍写 KV SWR 方案、附录 A 通知行过期、§12 通知实现未记双通道）。

**① README 重写**（`cbadbb8`）：定位、文档索引、技术栈、快速开始、常用命令（与 `package.json` 逐条对齐）、绑定资源表（三 D1 + KV + R2 + assets + secret/vars + cron）、迁移章节（27 个文件 0001–0027，只对 `DB`；新增迁移须追加 `tests/d1.ts` 的 `MIGRATION_FILES`）、测试与 e2e、目录结构、部署现状、约定与边界。

**② 项目级 AGENTS.md 新建**（`97ffa68`）：三库权限表、危险清单（deploy / `--remote` 写 / 生产迁移 / `scripts/prod-*` 工件 / 球员库全量重导入 / 30 人补录 / 16 队队籍回填 / push）、开发口径（端口 8791/8795/8792；改前端不 build 看不到；AUTH_MODE 与兼容模式；会话解析在 `src/lib/session.ts`、cookie 名在 `src/lib/oidc.ts`）、测试与迁移纪律、代码与提交规范（Edit/Write 禁终端改文件、core/lib/worker/routes 分层、guard.ts 口径）、文档纪律、当前状态。用户级 AGENTS.md 仍先注入，本文件只做项目收窄。

**③ CHANGELOG.md 新建**（`2d78587`）：Keep a Changelog 风格；本项目按增量推进、以 Cloudflare Version id 标记（仓库无 git tag）。[未发布] = 增量 17–24（自审后补 24）；[已上线] 增量 16（`6ed7446c`）与增量 15（`4d03eb57`）；早期增量 0–14 各一行标题。

**④ scripts/README.md 新建**（`d99ae79`）：按性质分级（只读 / 产工件 / 写生产 / 未执行）+ 顶层脚本表 + 各子目录说明；生产工件状态逐个标注（increment14 已执行、increment15 已执行、milan-rekey 已执行、**roster-backfill 未执行**——该行状态后来在执行回填后已改为「已执行」）；执行纪律：含外键或大事务的工件必须 `--command` 或 D1 REST `/query`（`--file` 通道让 `PRAGMA defer_foreign_keys` 失效，会整批回滚）。

**⑤ TECH_DESIGN 与现状对齐**（`3eec8e2`）：§13 把 `review_amount_threshold`（`40`）与 `bid_pattern_alert`（`{"windowMinutes":30,"maxRaises":3,"colludeRounds":6}`）由「待定」改实值，补 5 个已落地键（`window_force_settle` / `market_bid_paused` / `stadium_max_open_tier` / `naming_params` / `results_auto_confirm`），`facility_prices` 改精确值，表尾补注册表口径（61 条登记 / 唯一键 59 / 无默认键）；§15 加分类口径（已定 / 假设 / 已解决 / 可配置 / 已执行 / 已撤销）并把 27 号归位到 26 号之后；§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写（进程内限流 + TTL SWR，明确「不用 KV」的配额理由）；§12 记通知双通道、假设 23 由「假设」改「已定（增量 18 补 web 收件篮）」；附录 A 通知行拆为 web 三端点〔18〕与 qq 投递〔6〕，表头加「冻结于增量 6 era，增量 7+ 不回填」的范围说明。

**⑥ 过期草稿清理**：`handoff-20260916.md`（停在增量 12，四仓 HEAD 快照全过期）删除；其中仍有效的三条已迁走——球员库逐队源数据位置与字段口径、导入通道选择（离线脚本产 SQL 走 D1 REST `/query`）、`--file` 通道 FK 陷阱（后两条进 `scripts/README.md`，第一条进本节下方「外部依赖与待输入」表）。

**⑦ 自审修正**（`4de31df` / `b22ef5a`）：逐处核路径 / 命令 / 键名 / 版本号，抓到并修四处事实错——`scripts/README.md` 把球员库首灌写成「未执行」（实为 2026-09-18 已执行入库 18301，靠生产 `SELECT COUNT(*)` 定案）、`README.md` 把待 apply 迁移写成只有 0026/0027（实为 0022–0027）、`README.md` 写 admin 八域（实为九域）、`ROADMAP.md` 增量 12 段引用已不存在的 `web/src/pages/Admin.tsx`（改指 `web/src/lib/imports.ts` + `web/src/pages/admin/ImportsPage.tsx`）；另把「领先 39 个提交」这类硬编码改成实时口径，并顺手把下方「外部依赖与待输入」里已完成的依赖行（平台 D1、部署子域）改口径、`UI_DESIGN.md` 两处计划路径补上实现落点。

**验收**：文档里每处路径、命令、键名、版本号均以代码或联网只读查证为准（`wrangler deployments list --name whl-club` 实证生产最新 Version = 增量 16 的 `6ed7446c`，`wrangler d1 migrations list whl-club --remote` 实证生产迁移停在 0021，`SELECT COUNT(*) FROM players` 实证生产 18301 人、缺字段列为空——据此纠正了「球员库首灌未执行」的误记）；`npm test` 387 用例 / 30 文件不变（本轮不碰代码，仅 0027 头注释一行）。

**遗留**：附录 A 只修过期行、不回填增量 7+ 新增路由（表头已写明冻结范围）；TECH_DESIGN §15 各条只补落地增量号，未逐条回代码核位置；e2e 仍只覆盖兼容模式会话路径（增量 23 遗留）。

**部署（2026-09-20，用户下令执行）**：推送 50 个提交（`9f05116..fe60273`）→ 生产 D1 apply 0022–0027（生产迁移现到 0027，0027 的四条索引一次性写约 7.3 万行）→ `npm run deploy` 出 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`（取代增量 16 的 `6ed7446c`）。生产回读：`/api/health` 三资源 ok；`/api/me` 为 oidc 模式；首页与 `/api/clubs/directory`、`/api/players`（含 `sort=ca` 表达式索引路径）200；增量 17–23 新增路由（`/api/notifications*`、`/api/club/stadium/build-info`、`/api/club/naming/quote`、`/api/admin/overview`）返回 401 未登录而非 404，确认新代码已上线；0026 的 `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）核对均 `is_cpu=1`。**同日另批**：16 队队籍回填已单独执行完毕（444 行，见增量 17 节与 `scripts/prod-20260919-roster-backfill/README.md`）。仍未执行：30 人缺字段补录。

---

## 增量 25 · 合同期与财政节点改窗刻度——效力/保护期/解约费按常规窗计时 + 窗分型（临时窗）+ 忠诚奖金移入中期窗 + 税最先扣（2026-09-20 本地完成，push/部署等令）

**范围**：规则以赛季/半赛季为主刻度（4.2.3 工资帽半赛季周期、4.3.1 保护期 1.5 赛季、4.3.2 忠诚奖金按赛季、4.4.4 效力满 3 年免费解约），原实现按自然日折算（`PROTECTION_DAYS = 548` 天、`(now − effective_from) ÷ 365.25` 年），属口径错；本轮把合同期与资金动账节点一并定时点。

**裁决**（2026-09-20 用户逐条拍板）：①窗分型 = 开窗表单复选框「临时窗」，落库 `season_windows.is_temporary`，季初/中期按同赛季非临时窗顺序派生（不落库）；②效力只由**常规窗**关窗推进（每窗 +0.5 赛季），临时窗 +0、赛季结算不推进；③保护期 = 签约后经历 3 个常规窗关窗解除（= 效力 1.5，即 1.5 赛季只保护 2 窗）；④忠诚奖金改在**每赛季中期窗**（同赛季第 2 个非临时窗）关窗时发一次，季初/临时窗不发；⑤满 3 年免费解约 ⇔ 效力 ≥3.0 ⇔ 6 个常规窗；⑥训练营球员无保护期（`protection_ticks` NULL）；⑦续约/匹配把 `protection_ticks` 置为当前窗数（保护期即刻结束）、`service_ticks` 效力基数不动；⑧临时窗关窗只扣富人税 + 维护费（不扣工资、不收冠名租金；维护费按本窗已确认主场数照收）；⑨临时窗不递减冠名剩余窗数（与不收租同步）；⑩冠名前端仍按赛季展示（落库按窗，界面 = 窗数 ÷ 2）；⑪同赛季非临时窗上限 2（第 3 个服务端硬拦 409，要加窗只能勾临时窗）；⑫效力 0 不可被激活（临时窗期间签约者也要等下个常规窗关窗）；⑬保护期显示改二值「保护 / 非保护」；⑭富人税最先扣、税基含未扣工资（`balance` 与 `balance + ΣRC` 两项取多）。

**交付**（5 个 commit）：
- `2120dce` 迁移 `0028_contract_window_ticks.sql`（contracts 加 `service_ticks` NOT NULL DEFAULT 0 / `protection_ticks` / `signed_season` / `signed_window_seq`，season_windows 加 `is_temporary` NOT NULL DEFAULT 0；纯加列、无回填）+ `tests/d1.ts` 的 `MIGRATION_FILES` 追加。
- `2543e05` 判定与写库改窗刻度：`src/core/bypass-rules.ts` 重写为纯函数（`serviceSeasons` / `isProtected` / `protectionTicksFor` / `activationFee` / `terminationFee`）；新增 `src/worker/contract-ticks.ts`（`currentWindow` / `closedRegularTicks` / `windowBaseTicks` / `regularWindowOrdinal`）；`src/worker/{activations,bypass,transfers,contracts-import}.ts` 与 `src/worker/routes/players.ts` 改为按窗刻度读写（导入按 `effective_from` 反查签约基数）；测试 `tests/{bypass-rules,bypass-routes,activation,activation-match,players-library}.test.ts`。
- `71de78d` 关窗批按窗类型分支：`src/worker/window-machine.ts`（开窗 `temporary` 入参 + 常规窗上限 2 硬拦 + 列表带窗类型；关窗按 `is_temporary` 分派并回显 `loyalty`）、`window-payroll.ts`（`chargeWages` + 税最先扣、税基含未扣工资 + `-0` 归一）、`home.ts`（`chargeNaming`，临时窗不收租不递减）、`season-settle.ts`（忠诚奖金抽成 `loyaltyMovements`，幂等 `kind='loyalty' ref_type='window'`）、`routes/admin/market.ts`；测试 `tests/{home,season-settle,window-machine}.test.ts`。
- `fc68060` 前端：`web/src/lib/api.ts` 类型 + `pages/{PlayersLibrary,Player,Club}.tsx`（效力/保护期按赛季展示、保护期二值）+ `pages/admin/{MarketPage,SeasonsPage}.tsx`（临时窗复选框、窗类型列、忠诚奖金回显、冠名按赛季换算）。
- `e74138d` 自审补测：新增 `tests/contract-ticks.test.ts`（6 例）+ 修正两处注释（`regularWindowOrdinal` 对临时窗的返回值、`closedRegularTicks` 的日期串截断口径）。

**验收**：`npm test` **31 文件 / 397 用例全绿**（原基线 30 / 387），`npm run typecheck`（三份 tsconfig）与 `npm run build` 过。自审（code-review-skill 四阶段）无阻断项：全部调用点核对无遗漏（`PROTECTION_DAYS` / `protected_until` / `365.25` 仅剩迁移注释与导入模板映射）；`currentWindow` 与原 `getOpenWindow` 的 SQL 逐字一致（只多读 `is_temporary`），无回归；`settleSeason` 的 `growable` 批次下标在语句数减少后仍正确。

**遗留**：`0028` 未 apply（本地已到 0028，生产停在 0027；纯加列迁移，生产 `contracts` / `season_windows` 均 0 行）；旧列 `protected_until`（signed_at + 548 天）保留留档、判定不再读；导入历史合同的签约基数按日期串截断，与签约同日关的窗不计（效力算得更年轻，已在 `closedRegularTicks` 注明）；e2e 冒烟未跑（本轮不涉页面结构，仍是增量 23 的 8 场景）。

**文档**：TECH_DESIGN §6.3（窗内回滚还原 `protection_ticks`）、§8 窗末结算（临时窗不收冠名租金）、§11 结算段与关窗批（增量 25 改口径三条）、§13 `loyalty_tiers` 单位改赛季、§15 假设 13/14 重写为窗刻度 + 新增假设 39（窗分型与效力推进点）/40（临时窗扣费与忠诚奖金中期发）、附录 A 窗口两行与赛季结算行；PRD 合同台账/解约/续约/赛季结算/假设 5；UI_DESIGN 卷宗条款与「收口」文案；README 与 AGENTS.md 的迁移数与测试数；CHANGELOG [未发布] 增量 25 节。

---

## 外部依赖与待输入

| 依赖 | 影响增量 | 状态 |
|---|---|---|
| 平台 D1 创建（wrangler d1 create whl-club） | 部署 | 已完成（`whl-club` / `73154873-d5ae-42b0-a630-25f5ef60053d`） |
| 平台部署域必须是 .whleague.win 子域（共享 cookie） | 部署 | 已定并上线 `club.whleague.win` |
| PlayStyle 图标资产包（`assets/icons/playstyles/{id}.webp`） | 增量 1 球员卡 | 待供给（缺图降级 🥇🥈；`web/public/assets/` 现只有 `brand/`） |
| 工资帽数值（随赛季大名单） | 增量 2 工资帽 | config 项，不阻塞（`wage_cap` 无默认值） |
| 球员库源数据（FC Editor 逐队导出）：`E:\BaiduNetdiskDownload\FC Editor by decoruiz Alpha v21.5_2\player_tables\`（每队一个 `{id} - {Team}.xlsx`）；口径 `fc_id` = EA id 为 upsert 键、`prestige` ← `internationalrep`(1-5)、`base_ca` = 导入时 CA、`game_attrs` = FC 源 61 列 | 后续增量补录 / 重导 | 参考路径：首灌已于 2026-09-18 执行（入库 18301）；此逐队源供后续核对与增量补录用 |
| 球员库导入通道 | 球员库首灌 | 已裁决：管理端网页通道要 OIDC 会话（离线脚本拿不到），走 `scripts/players-import/generate-sql.ts` 产分片 SQL + D1 REST `/query`；`--file` 通道遇 FK / 大事务会因 `PRAGMA defer_foreign_keys` 失效整批回滚 |
| 30 人缺字段补录工件（`scripts/players-import/overlay-missing.ts` + `missing-fields-30.csv`，源缺 `naID` / `FootID`，需人工填值） | 球员库收口 | **等令，未执行**（生产现 18301 人，2026-09-20 查证） |
| 16 队队籍回填工件（`scripts/prod-20260919-roster-backfill/01-roster-backfill-16.sql`，444 人幂等 UPDATE，只写队籍不造合同） | 增量 12 后收口 | **已执行**（2026-09-20，444 行；复查全库 assigned 551 = CPU 4 队 107 + 本批 444） |
| S9 窗基线工件（`scripts/prod-20260920-s9-window-baseline/`：直造一条已关季初常规窗 + 62 行 `result_confirmations` 与 50 行 `match_attendance` 的 `window_seq` 0→1） | 生产数据侧 | **已执行**（2026-09-20 经 `--command` 逐条跑：changes 1 / 62 / 50 与期望一致，验收 9 项全中 → `windows_s9=1, w1_closed=1, open_windows=0, rc_one=62, ma_one=50, season_status=preparing`；代价：该窗 ≈117.5m 维护费与死忠演化不会被任何关窗批收取） |
| 20 队（含 CPU）队籍对齐工件（源 `FC Editor…/player_tables/s901` 队壳文件；`scripts/prod-20260920-s9-club-align/`：570 人按队壳对齐，481 条 `UPDATE players SET club_id`（改队 158 + 认领 323），只写队籍一列） | 生产数据侧 | **已于 2026-09-21 执行**（481 语句 / rows_written 962 / touched 481；验收：已对齐 570、剩余差异 0、入籍 874 = 551+323、自由身 17427，逐队人数与预估逐队吻合）；合同批的 84 行异队冲突已归零（16 队 462 行全部可导）；**遗留 304 人（275 人不在联盟世界任何一线队名单 + 29 人所在队在平台不存在）已由 `scripts/prod-20260921-s9-free-leftover/` 出工件释放自由身，待配额执行** |
| 16 队合同导入（源 `E:\Downloads\一线队-S9.csv`；计划书 `scripts/prod-20260920-s9-contracts/README.md`：现可导 378 行（claim 298 + create 80）、84 行异队冲突、164 行无目标队；工件待产） | 生产数据侧 | **等令，未执行**；硬前置 = 迁移 0028 已 apply **且** 增量 25 已部署（否则刻度列写不进去，或落成「无保护期」） |
| S9 遗留球员释放自由身（`scripts/prod-20260921-s9-free-leftover/`：304 名「在册但不在联盟世界 20 队名单」者 → `club_id = NULL` + `status = 'free'`，304 条幂等 UPDATE 2 片 + 回滚 + 预检/验收/报告/README） | 生产数据侧 | **等令 + 等配额，未执行**（用户 2026-09-21 裁定口径「clubID改null，status改free」；工件已产、本地演练通过；2026-09-21 凌晨 D1 免费档日读取配额跑满，待 UTC 00:00 重置）。目标态：在册 570 / 自由身 17731 / `free` 304 |
| 20 队（含 CPU）能力导入（源 `FC Editor…/player_tables/s901`；`scripts/prod-20260920-s9-abilities/`，口径 **Case B**：只改现值 `ca`/`pa` + `json_set` 合并 34 项能力项与 `RoleID1-5`/`PSID1-15`，**不动 `base_ca`/`$.CA`/`$.PA`/队籍**；工件已产 = 257 条语句 2 片 + 回滚 + 预检/验收/报告，本地演练已证守卫幂等） | 生产数据侧 | **等令，未执行**（涨幅以 delta = `ca`−`base_ca` 形式存在：换版按 delta 继承、解约被剥掉、报名合规停在换版前） |
