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

## 增量 25 · 合同期与财政节点改窗刻度——效力/保护期/解约费按常规窗计时 + 窗分型（临时窗）+ 忠诚奖金移入中期窗 + 税最先扣（2026-09-20 本地完成，2026-09-21 随 Version b83ec876 上线）

**范围**：规则以赛季/半赛季为主刻度（4.2.3 工资帽半赛季周期、4.3.1 保护期 1.5 赛季、4.3.2 忠诚奖金按赛季、4.4.4 效力满 3 年免费解约），原实现按自然日折算（`PROTECTION_DAYS = 548` 天、`(now − effective_from) ÷ 365.25` 年），属口径错；本轮把合同期与资金动账节点一并定时点。

**裁决**（2026-09-20 用户逐条拍板）：①窗分型 = 开窗表单复选框「临时窗」，落库 `season_windows.is_temporary`，季初/中期按同赛季非临时窗顺序派生（不落库）；②效力只由**常规窗**关窗推进（每窗 +0.5 赛季），临时窗 +0、赛季结算不推进；③保护期 = 签约后经历 3 个常规窗关窗解除（= 效力 1.5，即 1.5 赛季只保护 2 窗）；④忠诚奖金改在**每赛季中期窗**（同赛季第 2 个非临时窗）关窗时发一次，季初/临时窗不发；⑤满 3 年免费解约 ⇔ 效力 ≥3.0 ⇔ 6 个常规窗；⑥训练营球员无保护期（`protection_ticks` NULL）；⑦续约/匹配把 `protection_ticks` 置为当前窗数（保护期即刻结束）、`service_ticks` 效力基数不动；⑧临时窗关窗只扣富人税 + 维护费（不扣工资、不收冠名租金；维护费按本窗已确认主场数照收）；⑨临时窗不递减冠名剩余窗数（与不收租同步）；⑩冠名前端仍按赛季展示（落库按窗，界面 = 窗数 ÷ 2）；⑪同赛季非临时窗上限 2（第 3 个服务端硬拦 409，要加窗只能勾临时窗）；⑫效力 0 不可被激活（临时窗期间签约者也要等下个常规窗关窗）；⑬保护期显示改二值「保护 / 非保护」；⑭富人税最先扣、税基含未扣工资（`balance` 与 `balance + ΣRC` 两项取多）。

**交付**（5 个 commit）：
- `2120dce` 迁移 `0028_contract_window_ticks.sql`（contracts 加 `service_ticks` NOT NULL DEFAULT 0 / `protection_ticks` / `signed_season` / `signed_window_seq`，season_windows 加 `is_temporary` NOT NULL DEFAULT 0；纯加列、无回填）+ `tests/d1.ts` 的 `MIGRATION_FILES` 追加。
- `2543e05` 判定与写库改窗刻度：`src/core/bypass-rules.ts` 重写为纯函数（`serviceSeasons` / `isProtected` / `protectionTicksFor` / `activationFee` / `terminationFee`）；新增 `src/worker/contract-ticks.ts`（`currentWindow` / `closedRegularTicks` / `windowBaseTicks` / `regularWindowOrdinal`）；`src/worker/{activations,bypass,transfers,contracts-import}.ts` 与 `src/worker/routes/players.ts` 改为按窗刻度读写（导入按 `effective_from` 反查签约基数）；测试 `tests/{bypass-rules,bypass-routes,activation,activation-match,players-library}.test.ts`。
- `71de78d` 关窗批按窗类型分支：`src/worker/window-machine.ts`（开窗 `temporary` 入参 + 常规窗上限 2 硬拦 + 列表带窗类型；关窗按 `is_temporary` 分派并回显 `loyalty`）、`window-payroll.ts`（`chargeWages` + 税最先扣、税基含未扣工资 + `-0` 归一）、`home.ts`（`chargeNaming`，临时窗不收租不递减）、`season-settle.ts`（忠诚奖金抽成 `loyaltyMovements`，幂等 `kind='loyalty' ref_type='window'`）、`routes/admin/market.ts`；测试 `tests/{home,season-settle,window-machine}.test.ts`。
- `fc68060` 前端：`web/src/lib/api.ts` 类型 + `pages/{PlayersLibrary,Player,Club}.tsx`（效力/保护期按赛季展示、保护期二值）+ `pages/admin/{MarketPage,SeasonsPage}.tsx`（临时窗复选框、窗类型列、忠诚奖金回显、冠名按赛季换算）。
- `e74138d` 自审补测：新增 `tests/contract-ticks.test.ts`（6 例）+ 修正两处注释（`regularWindowOrdinal` 对临时窗的返回值、`closedRegularTicks` 的日期串截断口径）。

**验收**：`npm test` **31 文件 / 397 用例全绿**（原基线 30 / 387），`npm run typecheck`（三份 tsconfig）与 `npm run build` 过。自审（code-review-skill 四阶段）无阻断项：全部调用点核对无遗漏（`PROTECTION_DAYS` / `protected_until` / `365.25` 仅剩迁移注释与导入模板映射）；`currentWindow` 与原 `getOpenWindow` 的 SQL 逐字一致（只多读 `is_temporary`），无回归；`settleSeason` 的 `growable` 批次下标在语句数减少后仍正确。

**遗留**：~~`0028` 未 apply~~ → **2026-09-21 已随合同导入批 apply 到生产（生产迁移现到 0028）**；~~worker 仍未部署~~ → **2026-09-21 已随 Version `b83ec876` 上线**（网页面板建合同不再落 DDL 默认刻度）；旧列 `protected_until`（signed_at + 548 天）保留留档、判定不再读；导入历史合同的签约基数按日期串截断，与签约同日关的窗不计（效力算得更年轻，已在 `closedRegularTicks` 注明）；e2e 冒烟未跑（本轮不涉页面结构，仍是增量 23 的 8 场景）。

**文档**：TECH_DESIGN §6.3（窗内回滚还原 `protection_ticks`）、§8 窗末结算（临时窗不收冠名租金）、§11 结算段与关窗批（增量 25 改口径三条）、§13 `loyalty_tiers` 单位改赛季、§15 假设 13/14 重写为窗刻度 + 新增假设 39（窗分型与效力推进点）/40（临时窗扣费与忠诚奖金中期发）、附录 A 窗口两行与赛季结算行；PRD 合同台账/解约/续约/赛季结算/假设 5；UI_DESIGN 卷宗条款与「收口」文案；README 与 AGENTS.md 的迁移数与测试数；CHANGELOG [未发布] 增量 25 节。

---

## 增量 26 · 球员库筛选搬进左栏——筛选/显示列左置 + 表头点排序（29 键）+ 姓名去变音搜索 + 窄屏抽屉（2026-09-21 完成并随 Version b83ec876 上线）

**范围**：球员库（`/players`）的筛选控件原先横铺在表格上方、随表格一起滚走；搜索只做裸 `LIKE`（「sesko」搜不到「Šeško」）；排序只有 6 个键、走下拉框。本轮把筛选与显示列搬进球员列左侧的固定栏（窄屏改抽屉）、搜索走去变音折叠、排序键扩到表头每一列且可点表头排序。**不写任何生产数据**；push 与部署等令（2026-09-21 已下令并执行，见本节的「上线」段与 `CHANGELOG.md` 顶部的 Version 记录）。

**裁决**（2026-09-21 用户一问一题逐条拍板，共 19 项；要点如下）：
① 桌面左栏**可收起**、sticky、定宽 260px，收起态记 `localStorage`；② 窄屏用 **900px 断点的左侧滑出抽屉**（遮罩 / × / Esc 三条关闭路），否决「塌回表格上方」（那正是要省掉的）；③ 排序列 = **表头全部列可点**，两态循环（升 → 降 → 升），`sort`/`order` 继续留 URL；④ 搜索**只做拉丁去变音**，不做中文拼音、不做词序分词、不做容错拼写；⑤ 搜索框**聚焦才预载轻量名册**并本地过滤推荐（不逐键请求），点推荐直接跳 `/players/:id`；⑥ 工具条只留搜索框 + 视图段、**整行 sticky 吸顶**，「筛选（N）」按钮兼作抽屉入口；⑦ 生效条件摘要条常驻、每条 chip 可单独撤销；⑧ 仍是一张 `.card` + 竖向分隔线；⑨ 断点 900px，不动 `.admin-shell` 的 760px；⑩ 验收 = 前端组件测试基建 + e2e 三视口截图。
明确不做：`name_folded` 物化列（只在折叠表撞 D1 深度上限时才换）、引 UI 库、改 `PromptDialog`、改限流数值。

**交付**（18 个 commit = 16 个功能与测试 + 2 个收口文档；10 步 + 3 轮过审修正）：
- `78a8713` 新增 `src/core/name-fold.ts`（`FOLD_SPEC` 码位映射表 + `foldName` / `sqlFold` / `unmappedNameChars` / `describeChars` / `foldNameQuery` / `likeContains` / `foldNamePattern`）+ `tests/name-fold.test.ts` + `scripts/bench-name-fold.mjs`；`d02df47` 过审修正（表项重复检测、链深与 GLOB 守卫的实测说明）。
- `afe3f78` `src/worker/routes/players.ts` 姓名过滤由裸 `LIKE` 改 `sqlFold('players.name') LIKE ? ESCAPE '\'` + `foldNamePattern(q)`，新增 `GET /api/players/roster`（单条 SQL 拼「姓名|俱乐部ID|球员ID」多行文本，`ROSTER_CACHE_TTL_MS = 300_000`），`src/core/import.ts` 加 `warnUnfoldable` 只警告不挡行；`5dc0c12` 过审修正（结构性消除两侧漂移、名册行格式、缓存下限、空白查询词）。
- `03e47a8` 排序键 6 → **29 个** `SORT_KEY_NAMES`，`TEXT_SORT_KEYS = {name, contract_type, source}` 走文本游标 `decodeTextCursor`，`buildSortExprs({caExpr,paExpr,inflExpr})`，27 键 × 升降 × 3 页矩阵测试。
- `a7b92c0` 抽出 `web/src/components/FilterPanel.tsx`（12 props）与 `web/src/lib/players-library.ts`（Filters / EMPTY_FILTERS / RANGE_URL_KEYS / filtersFromUrl / filtersToQuery / COL_DEFS / autoColsFor），`PlayersLibrary.tsx` 853 → 340 行（该提交内；收口时 598 行，后续左栏/抽屉/排序各步增回），行为不变。
- `510fcba` 左栏栅格 `260px minmax(0,1fr)` + sticky + 收起态记 `players-library:side` + 摘要条；`2f954c8` 过审修正（`--topbar-h` 避让顶栏、姓名 chip 同步清搜索缓冲、窄屏兜底、属性三项联动）。
- `80134ae` 表头点排序 + 后端 `attr:<属性键>` 排序键（本步抓到阻断性真 bug，见验收）；`db6b2a3` 过审修正（默认态不再谎报排序列、排序列消失即回落 `sortColumnVisible`、折叠闸补形状变体、属性键单一来源、`parseColsParam`）。
- `776a777` 新增 `web/src/components/PlayerSearchBox.tsx` + `web/src/lib/roster.ts`（`parseRoster` / `suggestPlayers` / `ROSTER_SUGGEST_LIMIT = 8`）。
- `23d37b5` 窄屏抽屉（新增 `web/src/lib/use-media.ts` 的 `useMediaQuery`，走 matchMedia 而非 resize）+ `web/src/components/TopBar.tsx` 用 ResizeObserver 实测回写 `--topbar-h`；`2aa3692` 过审修正（抽屉内不再误吸顶、抬头吸顶、背景 inert、锁滚不横跳、焦点归位）。
- `23f6493` 前端组件测试基建（devDeps jsdom ^29.1.1 / @testing-library/react ^16.3.3 / @testing-library/dom ^10.4.2 / @testing-library/user-event ^14.6.7，package.json 里带 caret；`vitest.config.ts` 加 react 插件、include 扩到 `web/**/*.test.ts(x)`）+ `scripts/e2e/smoke.mjs` 三视口截图场景；`abbe1cb` 排序键表提到 `src/core/players-sort.ts`（零 import）前后端共用同一份 + `tests/core-zero-import.test.ts` 守卫；`30c77fa` 过审修正（Tab 焦点循环补全、摘要条 inert、e2e 断言补强）。
- `a31997f` 与紧随的收口文档提交：`src/core/name-fold.ts` 头注释的悬空引用改指本节；ROADMAP 加本节、CHANGELOG 加 [未发布] 增量 26 节、README 测试数与 e2e 场景数、AGENTS 当前状态、UI_DESIGN 球员库行、TECH_DESIGN 附录 A 冻结说明。

**验收**：`npm test` **36 文件 / 481 用例全绿**（原基线 31 / 397），`npm run typecheck`（三份 tsconfig）与 `npx vite build` 过（index gzip 141.75 kB）；`E2E_PERSIST_TO=.wrangler/rehearsal node scripts/e2e/smoke.mjs` **9/9 场景通过**（原 8）；真浏览器（本机 Chrome，375 / 900 / 1280 三视口）24 项断言全过——抽屉内 106 个 chip 无一被遮挡、表格+工具条+摘要条三块背景区 inert、`role=dialog` + `aria-modal=true`、连按 60 次 Tab 始终留在抽屉内（含顶栏）、已被内层消化的 Esc 不关抽屉、开关前后 `clientWidth` 375→375 无横跳、375↔1280 两个方向的焦点都交还入口按钮、console 错误 0（**真机手测**，探针在 gitignored 的 `scratch/verify-drawer-fix.mjs`，记录见记忆目录 `increment26-execution-state.md`；仓库未落脚本，`scripts/e2e/smoke.mjs` 的窄屏场景只覆盖其中 6 条）。
**两个只有真引擎 / 真浏览器能抓到的真 bug**：① `sqlFold` 的 REPLACE 链撞 **D1 表达式树深度上限 100**（`D1_ERROR: Expression tree is too large (maximum depth 100)`，`?name=` 与 `sort=name` 直接 500；node:sqlite 上限 1000 所以本地单测**测不出**）⇒ 折叠表由 253 项裁到**生产实测 87 项**（18301 行姓名 / 3048 行含非 ASCII 逐位核对），新增 `SQL_FOLD_DEPTH_LIMIT = 100` / `SQL_FOLD_ENTRY_BUDGET = 92` 与 `scripts/check-name-fold-depth.mjs`（改表必跑）；② 焦点循环的清单不能用 `offsetParent !== null` 过滤收起 `<details>` 的内容（Chrome 对收起 details 内元素**不返回 null**），否则真实最后一个可聚焦元素是显示列的 `<summary>`、往后 Tab 无人拦（375 实测第 25 次 Tab 逃到 body）⇒ 改为显式排除 `details:not([open])` 后代、保留其 `:scope > summary`。
另有两条口径修正：`foldName` 只做「查表替换 + ASCII 小写」（删掉 NFD 与整段 toLowerCase，否则库里出现西里尔/希腊大写会「JS 折了 SQL 没折」静默 0 命中）；`unmappedNameChars` 加形状变体判据 `FOLD_SHAPED = /[\p{Z}\p{Pd}\p{Pi}\p{Pf}\p{Cf}]/u`（弯引号/花式空格/不可见字符最容易从网页粘进来，原先直接跳过、永不报警）。`sqlFold` 形态 = `CASE WHEN expr GLOB '*[^ -~]*' THEN lower(<REPLACE 链>) ELSE lower(expr) END`，守卫把 18301 行的每查询成本从 483ms 降到 93ms、语义不变。

**遗留**：窄屏抽屉锁滚仍靠 `body { overflow: hidden }`（iOS 上不彻底，已加 `overscroll-behavior: contain` 兜底，真机未验）；`aria-modal="true"` 而顶栏渲染在 `<Routes>` 之外、不在 inert 区内（已用 Tab 焦点循环把顶栏挡在循环外，未提成共享 inert hook）；e2e 的焦点断言只在窄屏场景覆盖。

**上线**（2026-09-21）：用户下令后推送 39 个提交（`29c8199..d17cbdd`）并部署，Version `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（`wrangler deploy` CLI 回显的 Current Version ID 为 `81e93c74-228f-4fee-9d87-9fecf602d360`，同一批相隔 5 秒）。生产迁移无需 apply（`d1 migrations list --remote` 报 No migrations to apply，已到 0028）。生产回读全部通过：`/api/health` 三资源 ok，`/api/players?sort=name` 200（修复前 500），`?name=sesko` 返回 `B. Šeško`，`/api/players/roster` 200 / 325262 字节，另四个排序键与三个筛选查询全 200。

**文档**：本节 + `CHANGELOG.md` [未发布] 增量 26 节 + `README.md` 测试数与 e2e 场景数 + `AGENTS.md` 当前状态 + `src/core/name-fold.ts` 头注释（原「见 ROADMAP 的增量 26 记录」是悬空引用，由本节补上）+ 记忆目录 `increment26-plan.md` / `increment26-execution-state.md`。

---

## 增量 27 · 球员库左栏 UI 收口——多选下拉替代 chip 墙 + 区间成对 + PlayStyle 银/金分槽（2026-09-21 已上线，Version `3455087e`）

**范围**：增量 26 把筛选搬进左栏后，用户对实际观感提了 8 条反馈——同一行元素没对齐（工具条与左栏各一处）；球员列表上方空白太多；查找框灰字一整句太长；位置是 16 个 chip 铺 5 行；「更多筛选」里同一属性的最大值/最小值各占一行；属性下拉列的是 34 个英文键；「经纪人」叫法像人而不是性格；PlayStyle 与显示列也该是多选下拉。本轮把这 8 条逐条落地，并修掉随第 8 条暴露的**金徽筛选必然 400**。**不写任何生产数据、不碰缓存 / 限流 / 查询行为**。

**裁决**（2026-09-21 用户一问一题逐条拍板，共 13 项；要点如下）：
① 同行对齐走**控件行组件化**（工具条与左栏共用一套行布局与统一高度），不做零散 margin 微调；② 表格上方空白 = **摘要条与翻页条合并成一行** + **无筛选时不渲染摘要条**（「未设筛选条件」占位取消）；③ 搜索框灰字**只保留「查找」**；④ 属性下拉 label 改「属性」、选项写**中文名**、按**七组小标题**分组；⑤ 区间上下限：凡同一属性的最大/最小**合并成一对、一行两列**（左最小、右最大）；⑥ 「经纪人」→「**经纪人性格**」（仅筛选面板 label 与档案页；摘要条 chip 与表格列名仍叫「经纪人」）；⑦ 位置改**多选下拉**、**只放 12 个码位**（四个组 chip 下线，一键选「后卫」的能力随之消失，用户接受）；⑧ PlayStyle 也改多选下拉、**不带搜索框**、顶层分「**银徽章 / 金徽章**」两段（各 36 项）、段内按 EA 六类分组；⑨ **金徽不再算命中**（筛银徽章只看银槽 ⇒ 这是后端行为改动）；⑩ 显示列改同一个多选下拉；⑪ 摘要条粒度：**位置一条、银徽章一条、金徽章一条**（点 × 清掉整类），区间上下限仍各一条 chip（删一个不带走另一个）；⑫ 多选面板用**原生 Popover API**（进 top layer，不被窄屏抽屉裁切）；⑬ **生产读消耗的量化与治理整条挪到增量 28**——原计划第一步是打生产实测，但 2026-09-21 当日 D1 读额度已超限（免费档按 UTC 零点归零），用户裁决「步骤一先搁置」。
明确不做：不改缓存 / 限流数值、不改除 ps 外的后端语义、不引 UI 库、不动 `.admin-shell` 的 760px 断点、不写生产数据。

**交付**（6 个 commit，每步一 commit + code-review-skill 过审）：
- `f09c957` 步骤 1：控件行统一（`:root --control-h: 34px` + `.control-row`，`.library-controls` 只留外边距）+ 搜索框占位改「查找」。
- `c14bd71` 步骤 2：`web/src/lib/ref.ts` 导出 `ATTR_LABELS`（34 项中文名）与 `ATTR_GROUPS`（七组），档案页删掉两份本地副本改为 import；`FilterPanel.tsx` 删 `num()` 工厂、新增 `pair(minKey, maxKey, label, hint?)` 渲染一行两列（区间 7 对 + 属性 1 对 + 合同 3 对），属性下拉改「属性」+ `<optgroup>` 七组 + 中文名，「经纪人」→「经纪人性格」；新增 `web/src/lib/ref.test.ts`（与 `ATTR_KEYS` 逐序全等、无重复）。
- `24efb8e` 步骤 3：新增 `web/src/components/MultiSelect.tsx`（Popover / 自管 open 态 / 三条关闭路 / 位置现算），位置（12 码位）与显示列（18 列）接入，`POSITION_GROUPS` 与 `.lib-cols` 下线；新增 `MultiSelect.test.tsx` 6 例。
- `92bdc55` 步骤 4：`src/core/fc26.ts` 出 `PS_SLOT_COUNT = 15` / `PS_SILVER_SLOT_COUNT = 12` / `PS_GOLD_BASE = 100` / `isPlaystyleId` / `isGoldPlaystyleId`；后端 ps 过滤改为**银值只比银槽、金值只比金槽**（白名单「银 1-99 ∪ 金 101-199」，去重 + 上限 100 项）；前端 `filtersFromUrl` / `filtersToQuery` 两侧同步用同一判据；PlayStyle 面板改银/金两段（各 36 项、段内六类）；`web/src/pages/Player.tsx` 与 `ref.ts` 的写死槽位口径改走常量。
- `53ef515` 步骤 5：摘要条与翻页条合并成 `.lib-bar` 一行（chips 靠左、翻页 `margin-left:auto` 靠右），无筛选不渲染摘要条；`filterChips` 的位置与银/金各合成一条 chip（`psChipName` 去掉参考表自带的 `" +"` 后缀）；`scripts/e2e/smoke.mjs` ④ 断言随之改写。
- `016a1ba` 步骤 6：多选面板**下方不足 220px 时翻到触发器上方贴底**（落位抽成导出纯函数 `panelPlacement`，新增 4 例单测）+ 窄屏勾选框标签 `white-space: nowrap` + e2e ⑧ 新增面板几何/命中、同行控件底边对齐、翻页条按线上量级量页面横向溢出三组探针。

**验收**：`npm run typecheck`（三份 tsconfig）全清；`npx vitest run` **38 文件 / 497 用例全绿**（增量 26 收口时 36 / 481，本增量 +2 文件 / +16 例：`ref.test.ts` 3 + `MultiSelect.test.tsx` 10 + 页面与 lib 的改写）；`npm run build` 成功（部署产物 `web/dist/assets/index-C3PsHajD.js` 451.03 kB / gzip 142.93 kB + `index-C87Bz2k9.css`）；`npm run test:e2e` **9/9 场景通过**（⑧ 三视口 1280×900 / 900×800 / 375×812）。e2e 新增断言的实测输出：`desktop 工具条 3 对 / 左栏 2 对，底边偏差 []`（对齐从「看着别扭」变成可失败的硬断言）、`位置 触发器底 403 面板 409–843（视口 900）`、`PlayStyle 触发器底 800 面板 8–760（视口 800）`、`翻页条：高度 30，页面 1265/1280`。真浏览器截图（`scratch/e2e-players-{desktop,tablet,mobile}[-multiselect[-ps]].png`，8 张）逐张复核：工具条三件套与左栏两行底边齐平、摘要条与翻页条合并成表格正上方一行、位置/显示列/PlayStyle 均为下拉、375px 抽屉里 CA/PA/成长空间/初始 CA/年龄/身价/影响力 各一行两列。

**两个只有真浏览器能抓到的真 bug**：① **多选面板掉出视口**：把 PlayStyle 触发器滚到抽屉下沿后，面板落在 806–966 而视口高 800，掉在视口外、点不到也滚不到 ⇒ 加向上翻转；且**落位必须在 `showPopover()` 之后**——之前面板命中 `[popover]:not(:popover-open)`、UA 样式是 `display:none`，`offsetWidth` / `scrollHeight` 量到 0，「面板想要多高」恒为 0，翻转几乎永不触发（改用常量 `MIN_PANEL_ROOM = 220` 判据正是为了绕开这个坑，评审抓出后已修）。② **375px 抽屉里勾选框标签被拆成三行**：`.lib-adv-grid .field.check` 被 `flex: 1 1 96px` 压到 96px，「仅未来之星」渲染成「仅未 / 来之 / 星」⇒ `white-space: nowrap`。
另有两条 e2e 断言被评审判定为**空洞**（`pagerProbe` 断 `scrollWidth > clientWidth` 不可能失败，CJK 会换行；同行判据按 `top` 归行会跳过底边对齐但顶边不同的成对控件）⇒ 改为「页面级横向溢出」与「纵向相交归行 + 只比底边 + 断言量到非空」，并把「同行控件 N 对」打进日志以证非空集。

**上线（2026-09-21）**：7 个提交推送（`89e039d..30c7cdc`，`git rev-list --count origin/main..HEAD` = 0）；`npm run deploy` 成功（Total Upload 526.87 KiB / gzip 125.02 KiB，绑 5 资源 + `AUTH_MODE=oidc` + `PUBLIC_CACHE_TTL_MS=20000`，custom domain `club.whleague.win` + cron `*/5 * * * *`）。`wrangler deploy` CLI 回显 `ff9c2e91-25a0-4ce1-be19-d9b50bc0a136`，`wrangler deployments status --name whl-club` 显示生产 100% 流量 Version **`3455087e-4bdb-4a63-b40f-8df943d80892`**（2026-09-21T17:13:35Z）——与增量 26 一样，CLI 回显的 Current Version ID 与 deployments status 里的 Version 是两个值。

**部署后回读失败的真实原因（重要，非本增量引入）**：`/api/health` 200、`/api/clubs/directory` 200，但 `/api/players?limit=1` / `?sort=name` / `?ps=25` / `?ps=125` / `/api/players/roster` / `/api/players/1` **一律 500**（体 54 字节的统一兜底文案）。逐层排查确认是 **D1 免费档当日行读配额已耗尽**：临时把 `src/worker/index.ts` 的 onError 加上 `__diag` 字段、用 `npx wrangler dev --remote`（本地代码 + 生产绑定）打 `GET /api/players?limit=1`，拿到 `D1_ERROR: Your account has exceeded D1's free tier daily row read limit…`（该诊断补丁已还原，未部署）。旁证：Cloudflare 分析 API 的 `workersInvocationsAdaptive` 显示 `scriptThrewException` **自 2026-09-21T15:20:22Z 起**、其后每 5 分钟一条（cron 也全失败），**比本次部署早约 2 小时**；`d1AnalyticsAdaptiveGroups` 显示当日 whl-club `rowsRead` **4,350,235** / readQueries 5311（免费档上限 500 万行/日）。管理通道（`wrangler d1 execute --remote`）不受该限制，故 `SELECT COUNT(*) FROM players` = 18301、主列表 SELECT 原样都能跑通 —— **用管理通道或 `/api/health` 判断 D1 是否可用会得到假阳性**（`/api/clubs/directory` 的缓存键是固定串，`?x=1` 仍命中同一条目，且 stale 刷新分支 `.catch(() => {})` 吞掉 loader 错误）。限额按 UTC 零点归零 ⇒ 最小化生产回读（`/api/health` + `?sort=name` + `?ps=25` + `?ps=125`，≤6 请求）**顺延到额度归零之后**，未阻塞部署。
**回读已补做（2026-09-22T00:01:52Z = 本地 08:01，归零后 1 分 52 秒）**：`/api/health`（三资源 ok）、`/api/players?sort=name&limit=1`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster`（321693 字节）**六个端点全部 200**，`?sort=name` 200 也证明增量 26 的折叠表达式深度修复在生产生效。另花 2 次请求（合计 8 次，超出原预算 2 次）做语义实测：`?ps=125&limit=3` 返回 `total=4`、三行全部命中金槽 `PSID13=125` 且银槽无 25；`?ps=25&limit=3` 返回 `total=650`、行内 25 只出现在银槽（`PSID4` / `PSID3` / `PSID1`），这些球员的金槽值（142 / 103）**没有**被银值查询捞出来 ⇒ **「银值只比银槽、金值只比金槽」的新语义在生产成立**（列表响应形状 `{players, total, nextCursor}`）。cron 最后一次失败为 2026-09-21T23:55:17Z，**00:00:34Z 起恢复成功**（`workersInvocationsAdaptive`）。排查副作用一条：Cloudflare 分析 API 用的 wrangler OAuth 令牌于 2026-09-21T18:13:20Z 过期，`npx wrangler whoami` 会刷新它，之后 GraphQL 才可用。

**遗留**：① **球员库 D1 读消耗的量化与治理**（增量 28，含本增量被挪走的那部分）；② 档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15`，而筛选与导入口径是银槽 1-12 ⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（**增量 29 已修**：档案页按槽位扫全 15 槽）；③ 摘要条「筛选（N）」数的是 chip 条数，位置选 12 个仍显示 1（chip 粒度合并的必然结果，**增量 29 裁决维持现状**）；④ 多选面板内联 `maxHeight` 会覆盖 CSS 的 `min(70vh, 480px)`，内容超高时面板可长过 480px（**增量 29 已修**：上限收到组件常量，CSS 那条死规则删除）；⑤ 1280 宽下表格里「Baseline Utd」「20.00 m」「2金7银」会折行（列宽所致，非本轮引入；**增量 29 已修**：球员库单元格一律不折行，改由容器横向滚动）。

**文档**：本节 + `CHANGELOG.md` [未发布] 增量 27 节 + `UI_DESIGN.md` 球员库行 + `TECH_DESIGN.md` 的 PlayStyle 槽位口径（原写「银槽 1-7 / 金槽 13 起」，改为「15 槽 = 银 1-12 + 金 13-15」）+ `README.md` 测试数与 e2e 场景描述 + `AGENTS.md` 当前状态。

---

## 增量 28 · 球员库 D1 读消耗的量化与治理（2026-09-22 已上线，Version `7c5b5879`）

**范围**：9/21 事故（免费档 5,000,000 行/日读配额耗尽、`/api/players*` 全 500、cron 每 5 分钟失败）的根治。已确认的读放大：默认浏览一页 = 主查询 7 行 + COUNT 18,763 行（**COUNT 占 99.96%**，且每翻一页重算整表）；筛选/排序形状全表扫约 55,000 行/次。D1 按**扫描行数**计费，只有能让查询走索引并提前停下的改动才真降读量。本增量做四件事：量化、去 COUNT、缓存层治理（分级 TTL + 边缘缓存 + 写路径主动失效）、物化昂贵形状；并把全站其余读面一并普查。**不做**：不新增线上观测端点、不新增回归门禁、不动除本主题外的后端语义。

**裁决**（2026-09-22 用户一问一题逐条拍板，共 14 项；要点如下）：
① 量化手段 = `wrangler d1 execute --remote` 复刻形状读 `meta.rows_read` + 生产合成探针（不选 D1 analytics 归因、不选本地 EXPLAIN）；② **COUNT 去掉**，UI 改游标式；③ 启用**边缘 Cache API**（跨 isolate）；④ 查询侧走**物化高频表达式列**；⑤ 公开列表**彻底不带 total**，另开 CRON_KEY 守卫的内部计数端点；⑥ 物化清单「**先测再定**」；⑦ 分页条**保留按钮式、只换文案**；⑧ 前端加 **staleTime**、页大小保持 20；⑨ **全站读面普查**；⑩ **分级兜底 TTL：名册 / 俱乐部目录 24h + 球员列表 1h，配写路径主动 purge**（先经「只用 purge」vs「长 TTL + purge」对比后定稿：purge 管新鲜度、TTL 只管失效兜底；名册单次 18,301 行，300s 兜底最坏 288 次/日 = 527 万行/日会单独爆掉预算，故固定键给 24h 并靠写后精确删保新鲜）；⑪ purge 用**代际键（scope epoch）**（`/api/players` 键空间 = 筛选 × 排序 × cursor，无穷且 Cache API 无前缀删除，按键枚举不可行）；⑫ 尽全力治理，实在不行升档；⑬ 验收 = **单形状上限 + 容量推演**（日均指标作废——系统未正式投用，当前频次分布无意义）；⑭ 交付 = 脚本 + 报告落 repo。

**技术路径**：
- **量化**：新脚本 `scripts/measure-d1-reads.mjs` 对形状跑 `d1 execute --remote --json` 读 `meta.rows_read`。**SQL 不手抄**——用 Hono 的 `app.request()` 调真实路由 + 假 D1 捕获路由实际执行的 SQL 与绑定参数（手抄必然与线上漂移且静默失真；这样步骤 7 复测直接复用）。最终测 **30 形状 + 6 探针**。
- **去 COUNT**：删 `players.ts:610-617` 的 COUNT 与响应 `total`；密钥校验抽成 `assertCronKey(c)` 到 `src/lib/guard.ts`，新增内部端点 `GET /api/cron/players-count`。
- **缓存**：新增 `src/lib/cache-policy.ts`（scope → TTL 表：列表 1h / 名册 24h / 俱乐部目录 24h + `EPOCH_FAIL_SHORT_MS = 60_000`）；`guard.ts` 的 `cachedJson` 加 L2 边缘层，键 `${scope}:v${epoch}:${canonicalQuery}`，epoch 读 KV（isolate 记忆 5s，**读失败 fail-short 按 60s**）；**TTL 由自写的 `x-cached-at` 头判定**，不依赖 Cache API 对 `Cache-Control` 的实现；`purgeScope()` = epoch+1（跨 colo 全局失效，L1/L2 同时失效），固定键顺手 `cache.delete` 精确删。
- **purge 挂钩**：**不在 27 个含写语句的文件里逐个接**（实测 27 个，散接必漏）——只挂两处：`src/worker/index.ts` 的 middleware（非 GET 且 2xx 时按路径前缀表 purge）+ `scheduled()`（tick 真改了列表可见数据时才 purge；只写通知不触发）。
- **物化**：阈值写死——单次 ≥10,000 行且能被 UI 触发 ⇒ 做；≥10,000 但不可触发 ⇒ 记豁免理由；<10,000 ⇒ 不动。单日写入预算 ≤6 万行（免费档 10 万，留 40% 给业务写）⇒ **每天最多 3 条索引**（每条 18,301 行写）。步骤 1 已把 29 个排序键分类（见报告 5.1）：4 个已有 0027 索引、16 个可建 players 单表表达式索引、7 个**不能**（在 `ct.*` / 依赖 `season_windows` 子查询 / 内联运行时 config 系数）、`name` 因 87 项链需先过深度体检、`attr:*` 34 键需物化子表。**第一批（3 条 = 54,903 行写）取 `prestige` / `club` / `status`**（**已于步骤 4 执行**，见下方步骤 4 记录）——理由是表达式最安全（单表纯列/COALESCE/CASE，不像 `ps` 有 15 项链、`name` 有 87 项链）且都在前端默认列/排序下拉里可见；**不按热度选**（用户已裁决当前频次数据无意义）。其余登记「已量化、待配额」分天清单，每批后跑 `--only=<形状>` 复测。迁移 `0029_*`，索引尾列带 `id`，物化表达式与 `buildSortExprs` 共用常量。
- **前端**：QueryClient 加 `staleTime: 30_000`（球员库列表 60s）。（分页条文案原定本步，但 `total` 契约在步骤 2 就变了、不改文案页面会显示 NaN ⇒ **已随步骤 2 完成**，步骤 5 只剩 `staleTime`。）

**分步**（每步一 commit + code-review-skill 过审）：0 基线 + 额度核查 + 计划落盘 → 1 测量与报告 → 2 去 COUNT + total 契约 + 内部计数端点 → 3 分级缓存 + 边缘缓存 + 代际键 + 中心化 purge → 4 物化列/索引（迁移 0029）→ 5 前端 staleTime（分页文案已随步骤 2 完成）→ 6 全站读面普查与处置（**已完成 2026-09-22**：`free-agents` 36,274 → 843 行、`admin-overview` 的全表 COUNT 接入两级缓存；见下方步骤 6 记录）→ 7 验收复测 + 部署 + 最小化回读（**已完成 2026-09-22**：部署与最小化回读随步骤 0–5 提前做过一次，步骤 6 上线后又做了一次全量验收复测 + 8 请求回读；见下方「部署与回读」与「步骤 7 记录」）→ 8 文档与记忆收口（**已完成 2026-09-22**：repo 五份文档 + 记忆四处；见下方步骤 8 记录）。

**验收标准**：主指标 = **单形状上限**（步骤 1 实测后修正：默认浏览一页 ≤70 行，现 18,819 ⇒ 去 COUNT 后 56、命中缓存 0；有索引的排序/筛选形状 ≤70 行，实测 22–64；无索引的排序/筛选形状目标 ≤1,000 行且**必须靠新建索引达成**，本增量因写配额只能覆盖第一批，未覆盖的逐条写豁免理由）；**容量推演**替代实测日均（`5,000,000 ÷ 单次读量 = 每日可承受请求数`）；`npm run typecheck` 三份 tsconfig 全清、`npx vitest run` 全绿、`npm run test:e2e` 全绿、`npm run build` 成功；筛选/排序/分页结果与改前逐条一致（除 total 移除与分页条文案）。

**风险点**：① `caches.default` 在 wrangler dev/miniflare 与生产行为可能不同 ⇒ 步骤 3 第一件事实测，不支持则旁路；② 边缘缓存按 colo 存储，`cache.delete` 只作用于当前 colo（跨 colo 靠 epoch，这正是选代际键的原因）；③ 写配额（物化 + 建索引 ≤6 万行/日，超了分天）；④ 去 total 是信息损失（运维可查内部端点）；⑤ purge 漏接 ⇒ 列表最长陈旧 1h、固定键 24h（有界、自愈），报告给「写路径 → purge 映射表」；⑥ 测量本身花生产读配额（开工时实测 UTC 2026-09-22 平台库已读 167,528 行 = 3.4%，余量充足）；⑦ 物化列与查询表达式分叉 ⇒ 共用常量 + 单测锁死；⑧ 1h/24h 兜底意味着 **purge 是新鲜度的唯一保证**，fail-short 与映射表不得省略；⑨ 升档兜底（Workers Paid $5/月，读 25B/月）本增量不自行执行，届时回报用户；⑩ **生产 `whl-club` 原本没有配 `CRON_KEY`**（步骤 2 实测 `wrangler secret list` 只有 `AUTH_BIND_SECRET`）⇒ `POST /api/cron/tick` 的密钥守卫在生产是 fail-open（每次触发跑 settleOverdue 的 11 条 config 读 + 5 组 listing 扫）。**已由用户裁决并修复（2026-09-22）**：配好 `CRON_KEY` secret，新计数端点与 tick 都真正受守卫保护；tick 保持默认语义（未配时放行便于本地联调）、计数端点保持 fail-closed + 只认 `X-Cron-Key` 头。

**步骤 0 记录（2026-09-22）**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **38 文件 / 497 例全绿**；工作区干净（HEAD `994ded9`）。当日 D1 额度核查（GraphQL `d1AnalyticsAdaptiveGroups`，UTC 2026-09-22）：whl-club 读 167,528 行（3.4%）/ 73 次读查询、写 0；whl（赛事库）2,641 行；whl-auth 6 行 ⇒ 余量充足。查额度前 `npx wrangler whoami` 刷新过 OAuth 令牌（该令牌 2026-09-21T18:13:20Z 曾过期）。

**步骤 1 记录（2026-09-22）**：新增 `scripts/measure-d1-reads.mjs`（用 Hono 的 `app.request()` 调真实路由 + 假 D1 捕获实际 SQL 与绑定参数，内联后打生产读 `meta.rows_read`；**不手抄 SQL**，所以步骤 7 复测直接复用）+ 报告 `scripts/d1-read-audit/README.md` + 原始数据 `measurements.json`（**30 形状 + 6 探针**，累计读约 118 万行 = 免费档 24%；逐形状最新值合计 1,084,282 行）。实测要点：① 默认浏览一页 18,819 行中 **COUNT 占 18,763（99.7%）**、主查询仅 56；② 无索引排序主查询 **37,635 行**；③ 全表扫 + 排序是 **2 行/行**（18,301 → 36,602），不带排序 1 行/行；④ **受控探针证明两个 LEFT JOIN 成本为 0**（同样扫描 + 排序，加不加 JOIN 都是 36,602），真实主查询多出的 1,033 行来源未隔离（未解释项，占该形状 2%）；⑤ **「两段式查询能砍一半」实测只省 2.6%（36,654），假设不成立** ⇒ 全表扫形状的唯一出路是走索引提前停下；⑥ 0027 表达式索引实测有效：`ca` 58 / `pa` 61 / `age` 22 / `market_value` 22 对比无索引 37,635 = **降 99.8%**；⑦ **索引不是「有列索引就行」**：`sort=club` / `sort=status` 的排序表达式是 `COALESCE(club_id,0)` / CASE 权重 ⇒ 列索引失配、实测仍 37,635；`view=initial` 把 ca 换成 `COALESCE(base_ca, ca)` ⇒ 0027 索引立刻失效（61 → 37,635）；`ca_min=` 区间筛选同样不匹配 0027 的 `COALESCE(col,0)` 表达式索引；反之 `club_id=free`（`IS NULL`）能吃上 `idx_players_club`，主查询只读 22 行；⑧ 最贵单次形状 = **11 个全表扫排序 56,398–56,400 行**（免费档下单独跑只能承受 **88 次/日**）+ 姓名查找 36,606 行（`LIKE '%x%'` 用不了 B-tree，只能上 FTS5）。**两处计划偏差已记录**：(a) 验收目标「默认浏览一页 ≤20 行」按实测**不可达**（21 行输出 × 约 2.7 行/行 ⇒ 下限约 56），改 ≤70；(b) 物化阈值「≥10,000 且可触发 ⇒ 做」与写配额冲突（每条索引 18,301 行写、免费档 10 万/日、计划自留 ≤6 万 ⇒ **每天最多 3 条**；5.1 表里可建单表表达式索引的排序键 16 个、加上筛选列与 34 个 attr 键全做要 120 万+行写、至少 20 天），步骤 4 改为**按前端默认暴露面分批、分天执行**，其余登记为「已量化、待配额」。只读评审（code-review-skill，无 🔴）修掉了报告里 9 处数字/口径问题（无索引排序键数、6 个键其实**不能**建静态表达式索引、join 成本断言超出证据、验收下限自相矛盾等），评审结论已全部并入 `scripts/d1-read-audit/README.md` 第五节。

**步骤 2 记录（2026-09-22）**：去 COUNT + total 契约 + 内部计数端点。
- **后端**（`src/worker/routes/players.ts`）：筛选块整段抽成 `buildPlayerFilters(c, exprs)`（返回 `filters / filterArgs / attrValueExpr / psSlotSelects`；**cursor 条件仍只在 `listPlayers` 里拼**，计数端点不需要它）；列表删掉那条整表 COUNT、响应去 `total`（改 `{ players, nextCursor }`）；新增视图口径单一来源 `buildViewExprs(c)`（view 校验 + `influenceCoefs` + `caExpr/paExpr/inflExpr/coefs`），列表与计数共用（`coefs` 一并返回，响应里的 influence 用 JS 镜像算，必须与 SQL 表达式同源）；新增导出 `countPlayers(c)`，复算同一份 filters 跑原 COUNT。
- **守卫**：`src/lib/guard.ts` 新增 `assertCronKey(c, opts)`（把原 `/api/cron/tick` 的内联校验抽出来，默认语义不变：`X-Cron-Key` 或 `?key=`、未配 secret 放行）；`src/worker/index.ts` 新增 `GET /api/cron/players-count`，**收紧为 `{ allowUnset: false, queryKey: false }`** —— 实测生产 `whl-club` 只有 `AUTH_BIND_SECRET`、**没有 `CRON_KEY`**（`npx wrangler secret list`，2026-09-22），放行等于公开一个每次 18,763 行的读放大器；只认头是为了不让 GET 把密钥写进访问日志。
- **前端**：`web/src/lib/api.ts` 的 `PlayersLibraryResponse` 去 `total`；`web/src/pages/PlayersLibrary.tsx` 删 `total/totalPages`，改 `loadedCount`（各页 players 长度之和）+ `hasNextPage`，分页条文案 = `第 K 页 · 已加载 N 名 · 还有更多 / 已到末页`（**原定步骤 5 的文案随契约变更提前到这里 ⇒ 步骤 5 只剩 staleTime**）。
- **等价性验证**（一次性脚本，`scratch/` 已 gitignore）：`scratch/eq-check.mjs` 同时 import 改前（`git show HEAD:` 的副本）与改后路由，用假 D1 抓各自**实际执行的 SQL** 比对 ⇒ **28 个列表形状的主查询 SQL 与绑定参数逐字全等**（改前每形状 2 条语句 → 改后 1 条；roster 1 条、detail 4 条不变）；`scratch/eq-count.mjs` 把 `countPlayers` 挂最小 Hono app、打同一份形状 ⇒ **28 个形状的 COUNT SQL 与参数全等**。踩坑：两个 app 实例共用模块级缓存（config 服务、guard 的 cacheStore）⇒ 两次捕获之间必须 `resetGuards()`；COUNT 判别式必须锚在语句开头，因为主查询 SELECT 列表里内联的 `CURRENT_TICKS_SQL` 自带 `COUNT(*)`；`src/worker/index.ts` 因 `src/worker/authClient.ts` 的 TS 参数属性在 Node strip-only 模式下 import 不了（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），故计数端点用最小 Hono app 复现。
- **测试**：`tests/players-library.test.ts` 计数用例改走 `count17`（带 `X-Cron-Key`），新增「未配 CRON_KEY ⇒ 403（fail-closed）」与「`?key=` 连对的也不收（只认头）」；`tests/guard.test.ts` 两条缓存用例的观测量从 `total` 换成 `players.length` + `status=listed` 筛选；`web/src/pages/PlayersLibrary.test.tsx` 新增游标式分页条两例（`nextCursor` 有值 ⇒「还有更多」+ 点下一页真去取下一页且 URL 带 `cursor=`；为 null ⇒「已到末页」+ 按钮禁用且点击不发请求）；`scripts/e2e/smoke.mjs` ③ 断言 `!('total' in pj)`、④ 分页文案正则与探针替换文案同步。
- **验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **38 文件 / 501 例全绿**（步骤 1 后基线 497）；`npm run build` 成功（`web/dist/assets/index-CtmI3UpL.js` 451.04 kB / gzip 142.93 kB）；`npm run test:e2e` **9/9 通过**。
- **生产 CRON_KEY（2026-09-22，用户裁决「保留 key」后执行）**：`npx wrangler secret put CRON_KEY --name whl-club` 配好 32 字节随机密钥（值不入库，本地 `.dev.vars` 同值、已 gitignore）。`wrangler secret list` 现为 `AUTH_BIND_SECRET` + `CRON_KEY`。**副作用与验证**：配 secret 会立刻生成一个新生产版本（Source `Secret Change`，代码不变）⇒ 生产 Version 由 `3455087e` 变为 **`31c58da7-6611-4634-8c22-678a0f9e6876`**（2026-09-22T02:17:47Z，100% 流量）；生产 `POST /api/cron/tick` 无密钥实测 **403 `{"error":"cron 密钥不对"}`**（敞口已关）、`/api/health` 200；本地 8791 实测计数端点：无密钥 403、`X-Cron-Key` 头 200 `{"count":9}`、`?key=` 403（header-only 生效）。注意：**fail-closed 的计数端点要等增量 28 部署后才在生产存在**，此刻生产上并没有这个端点。
- **只读评审（code-review-skill）**：**无 🔴、结论可合入**；4 条 🟡 全部处理 —— ① 计数端点 fail-open + 读放大 ⇒ 改 fail-closed + 只认头（并实测确认生产没配 CRON_KEY）；② `?key=` 会把密钥写进访问日志 ⇒ 同上；③ 列表与计数的表达式装配重复、将来必分叉 ⇒ 抽 `buildViewExprs`；④ 新分页文案缺点击/组件测试 ⇒ 补两例。评审确认：`buildPlayerFilters` 是逐字搬移、`filterArgs` 与占位符 lockstep、`nextCursor` 判定逻辑未动、`guard.test.ts` 改写后仍是真的回归护栏（非空洞断言）、全仓无其它 `total` 消费者。

**步骤 3 记录（2026-09-22）**：分级缓存 + 边缘 Cache API + 代际键 purge + 中心化挂钩。
- **前置实测（排除计划风险 ①）**：临时在 `src/worker/index.ts` 加 `GET /api/__probe/cache` 探针（put/match/delete + 合成 URL），用 `npx wrangler dev --remote --port 8803`（本地代码 + 生产绑定、不部署）打四次：`hasCaches: true`；put→match 往返成功（`content-type: application/json` 保留）；**第二次请求 `matchBefore` 非 null（243ms）⇒ L2 跨请求/跨 isolate 在边缘真的命中**；`delete` 生效。探针已还原（未进提交）。
- **新增 `src/lib/cache-policy.ts`（口径单一来源）**：`CACHE_TTL_MS = { players: 1h, roster: 24h, clubs: 24h }`、`EPOCH_FAIL_SHORT_MS = 60_000`、`EPOCH_MEMO_MS = 5_000`、`PUBLIC_SCOPES`、`ttlForScope(scope, override)`（显式给数含 0 就照它，否则回落分级表）、`WRITE_SCOPE_PREFIXES`（8 条前缀 → 全部三个 scope，含 `/api/growth`）、`scopesForWritePath(path)`（**按路径段边界**匹配：`/api/club` 命中 `/api/club/squad`，**不**命中 `/api/clubs/directory`）。表里每条写路径都给全部三个 scope 的理由写在注释里：市场/转会/协商/注册都会改 `contracts`（→ 列表的合同列、名册的归属），`/api/growth/levelup/:id` 会 `UPDATE players` 的 `ca`/`badges_*`（列表的档位与影响力吃这几个字段），管理端几乎什么都能改。刻意**不列**的：`/api/notifications`（只写 notifications）、`/api/auth`（只写会话）。
- **`src/lib/guard.ts`**：新增 L2 边缘层（合成 URL 作键 `https://cache.whl-club.internal/<encodeURIComponent(key)>`，TTL 写在 `cache-control: max-age`，全程 try/catch —— `caches` 缺失（Node/vitest 实测 `typeof caches === 'undefined'`）或写失败都只当少一次复用）；代际键 `${scope}:v${epoch}:${key}`；`getCacheEpoch(env)`（isolate 记忆 5s；KV 读失败 ⇒ `degraded`，本次请求按 `min(ttl, 60s)` 处理，即 fail-short）；`purgePublicCaches(env)`（一次 KV 读 + 一次 KV 写 + 清 L1）。`cachedJson` 新签名带 `{ scope, env, ctx }`：ttl≤0 旁路最先判 → 读版本号 → L1 新鲜直回 → 过期走 SWR（单飞 + `ctx.waitUntil`）→ L1 未命中问 L2（命中只回填 L1）→ 否则 loader + 回填 L1 + 写 L2。
- **两处偏离计划字面（都有实测理由，已记录）**：(a) `wrangler.jsonc` **删掉** `PUBLIC_CACHE_TTL_MS: "20000"`（计划写「20000 → 3600000」）——一个全局数字无法同时服务「键空间无穷的列表」与「固定键单次 18,301 行的名册」，生产口径改由分级表承载，变量退化为显式覆盖（测试配 `'0'`）；(b) **公开缓存共用一个版本号 `cache:epoch:public`**（计划写「缓存键带 scope 版本号」）——`WRITE_SCOPE_PREFIXES` 里每条写路径都命中全部三个 scope，分开存只会让一次 purge 花三次 KV 写、而三个版本号永远同步移动；KV 是**与登录会话共用**的绑定、免费档仅 1000 写/天，拿「用户登不上去」的风险换零收益不划算。新增测试锁死「一次 purge 只花一次 KV 写」。
- **`src/worker/index.ts` 中心化挂钩**：`app.use('/api/*', …)` 注册在**所有 `app.route()` 之前**（Hono 的 compose 里路由返回响应就结束链路，注册在后面根本不执行）；判据 = 非 GET/HEAD + 响应 2xx + 路径前缀命中 ⇒ `purgePublicCaches`（有 `executionCtx` 就 `waitUntil`，否则就地 await）。`scheduled()` 改为 tick 真改了**公开数据**才 purge：`tickChanged` 只看 `settleOverdue` 的 `{settled,delisted,voided,notesUpdated,healed}`（挂牌结算写 `contracts`/`players.club_id`，正是列表的合同列与名册归属），**刻意不看** `notify`（只写 notifications）与 `autoResults`（只写 result_confirmations）——它们不在公开 scope 里，算进来会让每个 tick 都可能白 purge 一次，而每次 purge 之后第一个名册请求就要全表扫 18,301 行（288 次/天 ≈ 527 万行，单这一项就吃掉免费档）。
- **路由**：`players` 列表用 `ttlForScope('players', …)`、roster 用 `ttlForScope('roster', …)`（**删掉本地 `ROSTER_CACHE_TTL_MS = 300_000` 常量**，注释写明 300s 时每天 288 次 × 18,301 行 = 527 万行会单独打爆免费档）、`clubs` 目录用 `ttlForScope('clubs', …)`，三处都传 `{ scope, env, ctx }`。
- **测试**：`tests/guard.test.ts` 从 12 例扩到 **23 例**——`ttlForScope` 分级/覆盖/非法值回落、`scopesForWritePath` 段边界（含 `/api/clubs/directory`、`/api/notifications/read` 不被捞、`/api/growth/levelup/7` 被捞）、**默认分级 TTL（不配变量）同 query 第二次命中缓存**、`purgePublicCaches` 直接调用后列表立刻见新数据、**middleware 端到端**（`POST /api/cron/tick` 2xx ⇒ 自动 purge；404 ⇒ 不 purge；GET ⇒ 不改版本号）、fail-short（KV 抛错 ⇒ `degraded` 且 61s 就刷新而不是等 1h）、**后台刷新失败仍复位 `refreshing`**（否则该 entry 永久停在刷新中、此后过期也再不刷新）、**L2 打桩**（清 L1 模拟换 isolate 仍从 L2 命中；purge 后旧代际键不可达；`caches` 缺失时静默旁路）、一次 purge 只花一次 KV 写。`freshEnv()` 的 `SESSION_KV` 从 `{} as never` 换成真实 KV 桩。`tests/{players-library,routes}.test.ts` 的 env 显式加 `PUBLIC_CACHE_TTL_MS: '0'`（此前靠「未配即旁路」的旧默认，新默认是分级 TTL）；`tests/growth.test.ts` 未改（它只打未缓存的 `/api/players/:id/growth`）。
- **验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **38 文件 / 513 例全绿**（步骤 2 后基线 501）；`npm run build` 成功（`web/dist/assets/index-CtmI3UpL.js` 451.04 kB / gzip 142.93 kB，与步骤 2 同 hash——本步无前端改动）；本地 8791 + `npm run test:e2e` **9/9 通过**（含三视口探针与截图）。
- **只读评审（code-review-skill）**：**无 🔴**，判定「设计方向与 fail-short、单飞、代际键这些细节都成立」，2 条 🟡 + 2 条 🟢 全部处理 —— ① `/api/growth` 是写路径却漏在 `WRITE_SCOPE_PREFIXES` 外（`POST /growth/levelup/:id` 会 `UPDATE players` 的 `ca`/`badges_*`）⇒ 补进前缀表并加断言；② `tickChanged` 原递归收集所有数字过宽（`notify.checked` 残留待发通知即 >0）⇒ 收窄到 settle 字段（本次进一步把 `autoResults` 也排除，理由见上）；③ 🟢 后台刷新失败不复位 `refreshing` ⇒ 该 entry 永久停在刷新中、此后一直伺服陈旧值（**非本步引入，但 1h/24h 长 TTL 把后果从 5 分钟放到 24 小时**）⇒ 加 `.finally` 复位 + 补回归用例；④ 🟢 `max(本地记忆, KV 现值)+1` 不能完全防并发回退（需两个并发 purge + 错位陈旧读，影响有界、下次 purge 自愈）⇒ 注释记录。评审核对通过：middleware 位置与 `c.res` 时机（Hono `compose` 在每个 handler 层级 catch，`HttpError` 由 `onError` 转成对应 status，**写失败不会 purge**）、单一代际键的理由成立、`cacheStore.clear()` 无误清、L2 与 L1 的 `l2Put` TTL 一致、无漏加 `'0'` 的测试文件。

**步骤 4 记录（2026-09-22）**：排序表达式索引第一批（迁移 `0029`）+ 同源锁死测试。
- **迁移 `src/db/migrations/0029_players_sort_indexes_batch2.sql`**：三条表达式索引 `idx_players_sort_prestige`（`COALESCE(prestige, 0), id`）、`idx_players_sort_club`（`COALESCE(club_id, 0), id`）、`idx_players_sort_status`（`CASE status WHEN … END, id`）。选它们的理由见报告 §5.3：表达式最安全（不像 `ps` 有 15 项链、`name` 有 87 项链）+ 前端默认列/排序下拉直接可见；**不按热度选**（系统未正式投用，用户已裁决频次数据无意义）。尾列一律带 `id`——keyset 游标是 (排序键, id) 双列比较，缺了它带 cursor 的页仍会临时排序。
- **本地探针先证明再上线**（`scratch/idx-probe.mjs`，node:sqlite 合成 20,000 名球员 + 30 队 + contracts + season_windows）：建索引前三个排序都是 `SCAN players … USE TEMP B-TREE FOR ORDER BY`；建索引后 `SCAN players USING INDEX …` 且**无临时排序**，**带游标的页同样吃索引**（OR 形式与行值形式游标的字节码逐条相同）；索引体积 59–60 页。踩坑：node:sqlite 没有 `generate_series`（编译选项），要 JS 循环插数据。
- **同源锁死测试** `tests/players-sort-indexes.test.ts`（22 例）：用「记录型 D1 包装」调**真实路由** `/api/players?sort=<键>&limit=1` 抓下主查询 SQL，再对测试库跑 `EXPLAIN QUERY PLAN`，断言 `USING INDEX idx_players_sort_<键>` 且不含 `TEMP B-TREE`（无筛选 / 带游标 / `order=asc` 三种），覆盖 0027 四条 + 0029 三条共 7 个键。表达式索引只在表达式树逐字相等时才生效，排序表达式一改索引就**静默失效**（读量涨约 1000 倍，而接口返回一模一样、功能测试全绿）——这条测试就是防那个静默失效。**做过变异验证**：把 `0029` 的 status CASE 里 `trainee`/`free` 权重对调，两个 status 用例立刻红（退回全表扫），改回即绿 ⇒ 断言不是空洞的。`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0029_players_sort_indexes_batch2.sql`。
- **生产应用**：`wrangler d1 migrations list whl-club --remote` 只列出 0029（生产在 0028）；`migrations apply --remote` 执行 4 条命令 112ms（三条 `CREATE INDEX` + 一条迁移记账）。当天 whl-club 写量 0 行、读 152 万行（30.5%，是步骤 1 测量本身的消耗），54,903 行写卡在自留的 6 万/日预算内。本地 `.wrangler/state/v3` 用 `d1 execute --local --file=` 手工补同三条（本地 `d1_migrations` 表是空的，迁移命令不可用）。
- **生产复测（同一脚本、同一 URL）**：`sort=prestige` 56,398 → **53 行**、`sort=club` 56,398 → **43**、`sort=status` 56,398 → **22**（降 99.9%），单次耗时 1.4–2.0ms（原 135–152ms）⇒ 验收目标「无索引形状 ≤1,000 行」在这三个形状上达成。剩余 8 个全表扫排序键仍 37,635 行/次（`view=initial&sort=ca`、`wage`、`name`、`ps`、`influence`、`uid`、`years`、`protected`），登记为「已量化、待配额」分天清单（剩余 13 个可建索引的键 ≈238k 行写 ≈4 天）。
- **测量脚本修正**：报表列原写「其中 COUNT」= 第 2 条起的语句，步骤 2 去掉 COUNT 后这个列名会把主查询读量标成 COUNT ⇒ 改为按 SQL 文本归类（列表判据 `LEFT JOIN clubs cc`、计数判据锚定 `^\s*SELECT COUNT\(\*\) AS n FROM players`——主查询内联的 `CURRENT_TICKS_SQL` 自带 `COUNT(*)`，不锚定会误判），列名改「列表 | 计数 | 其它」；三个已建索引的形状标签同步更新。报告 `scripts/d1-read-audit/README.md` 新增 §3.1 复测节、§5.1 分类表加「0029 已建」行、§5.3 建议 2 标注已执行。
- **验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 535 例全绿**（步骤 3 后基线 38/513，本步 +22）；`npm run build` 成功（`web/dist/assets/index-CtmI3UpL.js` 451.04 kB / gzip 142.93 kB，无前端改动故与步骤 3 同 hash）；本地 8791 + `npm run test:e2e` **9/9 通过**。
- **只读评审（code-review-skill）**：结论可合入、无 🔴，独立复核了三条索引表达式与查询表达式逐字等价（SQLite 对唯一表上的裸列名与限定名解析到同一表达式，0027 也是裸列名写法）、测试确实在跑 SQL（`ttlForScope('players','0')` 返回 0 ⇒ `cachedJson` 旁路 L1/L2；`resetGuards()` 清限流桶与缓存）且断言非空洞。3 条 🟡 已全部处置：① `README.md` 迁移计数与生产迁移状态过期（28→29 个文件、`0028`→`0029`，`AGENTS.md` 同步）——已改，并补一句「迁移一旦 apply 到生产就不得再改」的纪律（`0029` 已 apply，此后要改只能新增 `0030`，否则线上记账与新环境重放漂移）；② 测试只锁了默认降序、且**「同一列既筛选又排序」时索引服务不了排序**——已补 `order=asc` 用例（7 个键，测试 15→22 例），缺口本身经本地 `EXPLAIN QUERY PLAN` 实测确认（`WHERE status=? ORDER BY <status CASE>` 与 `WHERE club_id=? ORDER BY COALESCE(club_id,0)` 都退回临时排序，因为筛选条件写的是裸列、与排序表达式不是同一个表达式；`ca>=?` 因范围筛选 + 同源表达式反而两条都吃上），**读量受命中行数约束而非全表扫故不阻断**，已写入报告 §3.1 的「已知缺口」并登记为后续候选（要收掉得让筛选也用 `COALESCE(club_id,0)`，会改变 `club_id IS NULL` 的语义）；③ `measurements.json` 里三条复测条目的 `label` 与新增字段缺失（JSON 是脚本改标签**之前**跑出来的）——已用现行脚本重跑那三个形状（约 120 行读）刷新，并在报告 §6 写明字段分层口径（有 `list_rows`/`count_rows` 的是步骤 2 之后的产物，没有的只有 `statements`/`metas`/`rows_read_total`）。
- **写放大（评审 🟢，未量化，记录）**：三条索引对**后续** players 写路径（球员导入/全量重导、`growth` 的 `UPDATE players`、转会改 `club_id`/`status`）有长期写放大，目前只记录了 apply 期的 54,903 行；免费档日写 10 万行，将来大批量重导前要按「写行数 × 索引数」估一次。

**步骤 5 记录（2026-09-22）**：前端请求节流（`staleTime`）。分页条文案已随步骤 2 的契约变更完成，所以本步只剩节流一件事。
- **`web/src/main.tsx`**：QueryClient 全局默认加 `staleTime: 30_000`（保留增量 15 的 `retry: false`、`refetchOnWindowFocus: false`）。理由：同一页反复挂载、切走再回来不该重发请求——每次未命中都是 D1 实读；而写路径有两条保险（前端显式改数据处仍走 `invalidateQueries`，它绕过 `staleTime` 强制重取；服务端有写路径代际键 purge）。
- **`web/src/pages/PlayersLibrary.tsx`**：列表 `useInfiniteQuery` 加 `staleTime: 60_000`（query 级覆盖客户端默认）。列表每页都是实读（默认浏览 56 行/页，贵形状数千行），60s 内复用已加载的页。
- **新测试**（`web/src/pages/PlayersLibrary.test.tsx` 新增 describe「增量 28：列表 staleTime」）：用**同一个 QueryClient**（只关 `retry`，保留默认 `gcTime`，否则卸载即回收、测的就成了 gcTime）渲染 → 卸载 → 再渲染，断言 `/api/players?` 请求次数仍是 1；另一例用假计时器（`vi.useFakeTimers({ shouldAdvanceTime: true })`）把时钟推过 60s 后重新挂载，断言这次**必须**重取——只测「新鲜期内不重取」的话，`staleTime` 误设成 `Infinity` 也能过。**做过变异验证**：删掉 `staleTime: 60_000` 第一例立刻红；改成 `Infinity` 第二例立刻红 ⇒ 两条断言都不是空洞的。
- **只读评审（code-review-skill）**：结论「可合入、无 🔴」；语义面逐条核对通过（query 级覆盖客户端默认、新鲜期重新挂载不发请求、`invalidateQueries` 绕过 `staleTime`、`refetchInterval` 不受 `staleTime` 影响、客户端 30s/60s 均短于服务端分级 TTL ⇒ 方向安全）。两条 🟡 是「既存瑕疵被本改动放大」，本步顺手修掉：
  - `web/src/pages/admin/FinancePage.tsx`：期初导入与手动记账成功后只 `setResult`，不失效别的页面——管理员随即切到流水账页会在 30s 内看不到刚入的账。两处各补 `void qc.invalidateQueries({ queryKey: ['club', 'balance'] })` 与 `{ queryKey: ['ledger'] }`（`Ledger.tsx` 的键是 `['club','balance']` 与 `['ledger', kind]`）。
  - `web/src/pages/market/MarketFreePage.tsx`：海捞申请成功后不失效 `qk.freeAgents`（同文件 `ActivateSection` 有失效先例）。补 `void qc.invalidateQueries({ queryKey: qk.freeAgents })`。
  - 🟢 记录未改：聚焦重取在 30s 内被抑制（`useUnreadCount` 的 60s 轮询本身不受影响）；列表 60s 与全局 30s 的粒度差是有意的。
- **诚实记录**：全局那 30s 没有直接测试（`main.tsx` 在模块加载时就 `createRoot(...).render`，jsdom 里没法只 import 取它的 QueryClient），被锁住的是真正要紧的那条——球员库列表的 60s。

**部署与回读（2026-09-22，步骤 0–5 一起上线；原计划在步骤 7，经用户指示提前）**：
- 推送 `994ded9..dbf55c7`（6 个提交），`git rev-list --count origin/main..HEAD` = 0。
- `npm run deploy`：Total Upload **532.29 KiB / gzip 126.89 KiB**（上传 18 文件、5 个已存在），绑 5 资源 + `AUTH_MODE=oidc` + `OIDC_ISSUER` + `OIDC_CLIENT_ID`（**vars 里已无 `PUBLIC_CACHE_TTL_MS`**，符合步骤 3 的口径改动），custom domain `club.whleague.win` + cron `*/5 * * * *`，CLI 回显 `Current Version ID: 4d6119f4-aa22-47ea-979b-ce9a46c6736f`。
- `npx wrangler deployments status --name whl-club`：生产 100% 流量 Version **`91635aca-92d3-4921-8208-d9f7912aaec7`**（Created 2026-09-22T04:19:18Z）。**与增量 26/27 一样，CLI 回显与 deployments status 是两个值**（`4d6119f4-…` vs `91635aca-…`）。
- 最小化回读 8 个请求（`scratch/readback28.mjs`）**全部符合预期**：`/api/health` 三资源 ok；`/api/players?limit=1` **响应已无 `total`** 且带 `nextCursor`（步骤 2 的契约在生产生效）；`?sort=name`、`?sort=prestige`、`?ps=125` 全 200；`/api/cron/players-count` 无密钥 **403 `cron 密钥不对`**、带 `X-Cron-Key` **200 `count=18301`**（fail-closed 守卫在生产生效）；`/api/players/roster` 200。
- 线上前端产物核对：live `/players` 的 HTML 引用 **`index-DZu3s6Fn.js` + `index-C87Bz2k9.css`**，与本地 `web/dist/assets/` 同名 ⇒ 部署的正是本次构建。
- 迁移：本步无新迁移（`0029` 已在步骤 4 apply），部署后 `d1 migrations list whl-club --remote` 仍报 No migrations to apply。
- **步骤 7 的剩余部分**：只有「部署后按形状复测一遍读量」（步骤 4 已复测三条索引形状；去 COUNT 后的默认浏览 56 行/次已在步骤 1 后的本地路径验证，生产侧随这次回读间接确认），以及增量收尾时的最小化回读记录。
- **验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 537 例全绿**（步骤 4 后基线 39/535，本步 +2）；`npm run build` 成功（`web/dist/assets/index-DZu3s6Fn.js` 451.07 kB / gzip 142.94 kB）；本地 8791 + `npm run test:e2e` **9/9 通过**。

**步骤 6 记录（2026-09-22）**：全站读面普查与两个 ≥10,000 行的读面处置。
- **普查工具**：新增 `scripts/measure-surface-reads.mjs`（18 个 URL 读面 + 展开的 3 个 cron 任务 = 21 条），与 `measure-d1-reads.mjs` 共用新抽出的 `scripts/d1-read-audit/harness.mjs`（真实路由 + 假 D1 抓 SQL + 内联参数 + 打生产读 `meta.rows_read`）。三个方法要点：① **每个读面跑在独立进程**（`--only=<id>`）——`src/core/config.ts` 把 config 读在 isolate 内缓存 60s，同进程连跑会把后面读面的配置读量抹成 0；② **只执行 SELECT**（`selectOnly`）——GET 里也可能藏写语句（`/api/market/*` 每次请求前先跑 `settleOverdue`），原样打生产就是真写；③ **鉴权靠假会话**——假 D1 对 `oidc_session` 查询回管理员 claims + 请求带 `cookie: __Host-club_session=probe-token`，否则 `requireUser`/`requireAdmin` 在 401 处提前退出、一条业务 SQL 都抓不到（可行性已在开工前单独验证）。
- **普查结果**（`scripts/d1-read-audit/surface-measurements.json`）：**`GET /api/market/free-agents` 36,274 行/次是全站最大读放大器**（教练可触发、无缓存）；`GET /api/admin/overview` 18,449 行/次（含 `SELECT COUNT(*) FROM players` 18,301，仅管理端）；**其余全部 ≤105 行**（`/api/me/club` 105、`/api/club/squad` 65、`/api/clubs/directory` 20、notifications 15、market 各端点 1–11 …）；cron 三段合计 82 行/轮 × 288 轮/日 ≈ 2.4 万行/日（可忽略），其中 `dispatchPendingNotifications` 在生产是 **0 语句**（未配 `SYNC_BASE_URL` ⇒ `skipped:'unconfigured'` 空转）。
- **处置一 `/api/market/free-agents`：36,274 → 843 行/次（降 97.7%）、37.5 → 8.3ms**。病灶是 `WHERE (p.club_id IS NULL OR p.club_id IN (CPU 子查询)) … ORDER BY p.ca DESC LIMIT 300` 撞上「生产 97% 球员无归属」⇒ `MULTI-INDEX OR` + 临时排序，必须读全部 17,731 行。**先试索引失败**：迁移 `0030` 建 `idx_players_club_ca ON players(club_id, ca DESC, id)` 后单独重测仍 36,271 行（本地探针逐个试 4 种列组合，没有一条能消掉 `TEMP B-TREE`）。**改写成两层**：① 拆 `UNION ALL` 两分支（无归属 / CPU 队）⇒ 19,141，无归属支 300 行达标、CPU 支仍 18,540；② 把 CPU 支写成 **`FROM clubs cp CROSS JOIN players p ON p.club_id = cp.id`**（clubs 表当驱动、固定连接顺序）⇒ 计划变 `SCAN cp | SEARCH p USING INDEX idx_players_club`、**239 行**，结果与旧版逐行一致。变体对照：`JOIN`（非 CROSS）仍 18,982、加 `INDEXED BY` 仍 239（不需要索引提示）。**同源锁死**：`tests/market-routes.test.ts` 新增「海捞名单查询计划」用例，用真实路由 SQL 跑 `EXPLAIN QUERY PLAN`，断言含 `idx_players_club_ca`、含 `SCAN cp`、**不含 `MULTI-INDEX OR`**；**变异验证**（`CROSS JOIN` 换回 `LEFT JOIN` ⇒ 用例立刻红）。SQLite 坑：复合 SELECT 的分支不能自带 `ORDER BY`/`LIMIT`（报 `ORDER BY clause should come after UNION ALL not before`），每个分支必须包一层子查询。
- **处置二 `/api/admin/overview`：冷缓存 18,449 行不变，治理的是频次**。新增 `countAllPlayers(c)`（`src/worker/routes/players.ts`），把那条全表 COUNT 挂到**公开列表同一个 scope `players`** 的两级缓存上 ⇒ 与列表共享同一份代际键、写路径 purge 一起失效，1h 内多 isolate 只算一次、命中即 0 行。带筛选的总数仍走内部端点，不共用本缓存。**新测试**（`tests/admin-system.test.ts`）用记录型 D1 计数该 SQL：隔掉 isolate 缓存（`resetOverviewCache()`）后再请求，`players` 数字仍正确且该 SQL 只跑过一次；**变异验证**（换回直连 COUNT ⇒ `expected 2 to be 1` 立刻红）。
- **写配额（计划偏差，记录）**：`0030` 那条索引 18,301 行写；apply 前当日已因 `0029` 用掉 54,915（54.9%），加上它到约 **73.2k/100k（73%）**，**超出计划自留的「≤6 万行/日」**——接受的依据是系统未正式投用、当日业务写为 0。生产 apply：`d1 migrations apply whl-club --remote` → `Executed 2 commands in 43.30ms`，`idx_players_club_ca` 已确认存在（生产现有 10 个 `idx_players%` 索引）。本地 `.wrangler/state/v3` 的 `0030` 于收尾时手工补建（`--local --file=…` 报 `already exists` ⇒ 现与生产同为 10 条 `idx_players%` 索引；本地 `d1_migrations` 表为空、`db:migrate:local` 不可用，只能手工补）。
- **顺带修掉的工具障碍**：`src/worker/authClient.ts` 的 `AuthApiError` 原用 TS **参数属性**（`constructor(public code: string, …)`）——那是唯一需要「代码生成」的 TS 语法，Node 的类型剥离不支持（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）⇒ 凡 import 它的模块在 Node 里都加载不了，`/api/clubs/directory`、`/api/me/club`、`/api/club/balance`、`/api/club/ledger`、`/api/club/stadium/build-info` 五个读面抓不到 SQL。改成显式字段赋值后 18 个读面全部可测。
- **登记未做**：海捞池已是 17,731 人而 `LIMIT 300` 无分页、无筛选（路由注释「约 107 人 + 190+」早已失真）⇒「除 CA 最高的 300 人外都看不到」是**产品级问题**，本增量只治读量，不动契约。
- **文档**：报告新增第七节「全站读面普查与处置」（普查表 + 两个处置的完整证据链 + 工具障碍）；`scripts/README.md` 索引补三行（两支测量脚本 + `d1-read-audit/`）。
- **只读评审（code-review-skill，结论「可合入」）**：无 🔴、无 🟡，5 条 🟢。评审**独立复核通过**的关键项：用合成库 + 25 组随机数据把旧/新 free-agents SQL 的 top-300 逐字节比对（**25/25 全等**，证明等价、无重复、无漏行；`UNION ALL` 分支必须包子查询这条写法必要且正确）；`test` 的 EQP 断言在 400/20、17731/107、0/0、5/0 四种规模下性质稳定、对「删索引 / 退回 `IN (子查询)` / 漏 CPU 支」会变红；`CPU_CLUB_IDS_SQL` 删除无断链（`src/worker/contracts-import.ts:13`/`:252` 仍在用）；`MIGRATION_FILES` 已登记 `0030`；`countAllPlayers` 与列表同 scope 的 purge 链路成立（KV 单键 bump 跨 isolate 生效）；`authClient` 改写严格等价且全仓无同类残留；测试 fixture 加 `PUBLIC_CACHE_TTL_MS: '0'` **不是假绿**（该文件本就只验 isolate 层，两级缓存由 `tests/guard.test.ts` 覆盖）。🟢 处置：① `selectOnly` 原本放行整个 `WITH`（`WITH … DELETE/UPDATE/INSERT` 在 SQLite 里合法 ⇒ 等于把写语句送上生产）⇒ **已收紧为「`SELECT`，或 `WITH` 且不含写动词」并单测过 9 种入参**；② `measure-surface-reads.mjs` 的 `who` 字段从未被读取（鉴权一律用探针管理员会话）⇒ 加注释说明它是「谁能触发」的文档字段、不参与鉴权；③ 报告补一句「本地空库与远端生产读数不可混读」（`target` 字段即此口径）；④ `?fresh=1` 不刷新 players 数字属已知取舍（已注释登记）；⑤ 重构后 `captureSurface` 会附带 cookie 与 `TOUR_DB`/`AUTH_DB` —— 重构时已用 `--local --dump` 与重构前基线逐条 `diff` 过 30 个形状（SQL 逐字相同），故无需复验。
- **验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 539 例全绿**（步骤 5 后基线 39/537，本步 +2）；**诚实记录**：全量运行中出现过**一次未复现的偶发失败**（538/539，当时未捕获用例名；测试不依赖本步新增的脚本，随后 4 次全量 + 3 次前端子集运行均全绿）；`npm run build` 成功（`web/dist/assets/index-DZu3s6Fn.js` 451.07 kB / gzip 142.94 kB，与步骤 5 同 hash ⇒ 本步无前端改动）；本地 8791 + `npm run test:e2e` **9/9 通过**；本地 D1 已手工补建 `0030`（现与生产同为 10 条 `idx_players%` 索引）。

**步骤 7 记录（2026-09-22）**：验收复测（30 形状）+ 步骤 6 上线 + 最小化回读。
- **全量验收复测**：`node scripts/measure-d1-reads.mjs --json-out=scripts/d1-read-audit/measurements-after.json` ⇒ **本次仅耗 338,980 行**（步骤 1 是 118 万，因为 COUNT 已不在）。逐条「改前 → 现在」表写入报告 **§3.2**。要点：默认浏览一页 18,819 → **56**（第 5 页 18,815 → 52、初始视图 → 56、`sort=id` → 56）；0027 四条 18,785–18,824 → **22 / 22 / 58 / 61**；0029 三条 56,398 → **53 / 43 / 22**；筛选 `club_id=5` 127 → 64、`club_id=free` 17,754 → 22、`status=normal` 1,090 → 58、`growable=1` 18,683 → 95、`position=ST` 18,507 → 110、`ps=25` 18,629 → 293、`attr=sprintspeed≥80` 18,593 → 88、`ca_min=80` 18,638 → 56；名册 18,301（命中 0，治理频次）、详情 4 不变。
- **未达标与豁免（逐条写入报告 §5.5）**：8 个全表扫排序键 56,398–56,400 → **37,635–37,637**（只降 33% = 纯去 COUNT），姓名查找 36,606 → **18,304**。豁免理由分三类：① **下一批候选**（形态允许静态索引，只差写配额，每条 18,301 行写）——`view=initial&sort=ca`（ca 被换成 `COALESCE(base_ca, ca)`，与 0027 的 `COALESCE(ca, 0)` 是两个表达式 ⇒ 索引静默失配）、`sort=uid`、`sort=ps`（15 项链，须先过表达式树深度体检）、`sort=name`（87 项链折叠）；② **不能静态索引**——`wage`/`release_fee`/`contract_type`/`source` 键在 `ct.*`，`years`/`protected` 还内联 `CURRENT_TICKS_SQL`（随赛季推进变化），`influence` 内联运行时 config 系数（系数一改索引即失效）；③ **根本用不了 B-tree**——姓名查找是 `LIKE '%sesko%'` 子串匹配，唯一出路是 FTS5 trigram（独立主题、登记），`attr:<键>` 34 键需物化子表。无索引的筛选形状（`growable=1` 95 / `position=ST` 110 / `ps=25` 293 / `attr≥80` 88）虽 >70 但未列豁免：它们没有可用索引且读量受命中行数约束，已随去 COUNT 从 1.8 万降到百级。
- **容量推演**：免费档 5,000,000 行/日下，默认浏览一页从 **265 次/日** 升到 **89,285 次/日**；最贵的仍可触发形状（37,635 行的 `sort=name`，只在用户点表头姓名列时发生）**133 次/日**。主指标（默认浏览 ≤70、有索引形状 ≤70）全部达成。
- **部署**：先 push 步骤 6（`28bd8ba..d4aebc2`），再 `npm run deploy` ⇒ Total Upload **533.53 KiB / gzip 127.46 KiB**、Worker Startup 2ms、绑定 5 资源 + 3 个 vars（`AUTH_MODE`/`OIDC_ISSUER`/`OIDC_CLIENT_ID`，vars 里仍无 `PUBLIC_CACHE_TTL_MS`）、custom domain + cron 不变；`No updated asset files to upload`（前端产物与步骤 5 同 hash）。CLI 回显 `7cb80a9b-c213-4ed2-b2f3-183c304808ec` vs `deployments status` 的 **Version `7c5b5879-0003-421c-9bf2-6026a4674afe`**（Created 2026-09-22T05:25:16Z）——**又一个两值对照**（增量 26 `81e93c74` vs `b83ec876`；增量 27 `ff9c2e91` vs `3455087e`；本次 `7cb80a9b` vs `7c5b5879`）。
- **最小化回读（8 请求，全部符合预期）**：`/api/health` 200；`/api/players?limit=1` 200 且**响应已无 `total`**、`nextCursor="1"`；`?sort=prestige&limit=1` 200 `nextCursor="5~22"`；`?sort=status&limit=1` 200 `nextCursor="4~18301"`（权重 4 = free）；`/api/players/roster` 200（321,693 字节）；`/api/clubs/directory` 200；`/api/market/free-agents` **401 `未登录`**、`/api/admin/overview` **401 `未登录`**（两者都需会话，401 而非 500 ⇒ 改写后的海捞名单查询与 overview 都未破坏路由）。
- **额度**（`scratch/quota-check.mjs`，UTC 2026-09-22）：whl-club 读 **1,993,427 行（39.9%）**、写 **73,220 行（73.2%）**（写量含 0029 的 54,915 + 0030 的 18,301）。首次运行报 `getaddrinfo ENOTFOUND api.cloudflare.com`（已知 wrangler 网络抖动）⇒ 重试即过。
- **文档**：报告新增 §3.2（30 形状改前/改后验收表 + 容量推演）与 §5.5（未达标形状豁免清单），标题与 §一 补「治理后现状见 §3.2/§5.5」的指引。

**步骤 8 记录（2026-09-22）**：文档与记忆收口（纯文档提交）。
- **repo 五处**：`CHANGELOG.md` 顶部新增增量 28 上线条目（新增/变更/修复/验收/待办 五段，含测量机件三约束、计数端点 fail-closed、分级缓存与代际键、`0029`/`0030`、同源锁死测试、去 `total` 契约、海捞改写、`AuthApiError` 改写、三个假阳性判据、验收数字与遗留）；`README.md` 四处（测试数 38/497 → **39/539**、迁移文件 29 → **30** 且 apply 段补 `0029`/`0030` 与写配额提醒、生产状态行改为最新 Version `7c5b5879` 并补增量 28 回读结论「列表无 `total`、一次 56 行」、本地坑①补 `0029`/`0030` 的手工补法）；`AGENTS.md` 两处（生产 Version 行补 `7c5b5879` 与两值对照第三组、增量 28 条目由「进行中」改「已全流程收口」）；`UI_DESIGN.md` 翻页条改游标式文案（不显示总数）；`TECH_DESIGN.md` 三处（§17.1 索引规约补 `0029`/`0030` 与三条纪律、§17.2 第 3 条补「响应契约不带 `total`」并新增第 7/8 条——不能静态索引就换写法（含 `CROSS JOIN` 实例）、判断 D1 可用性的三个假阳性判据、附录 A 冻结范围补 `GET /api/cron/players-count`）。
- **记忆四处**：新建 `increment28-execution-state.md`（缘起/交付链/关键机件/验收数字/遗留）；`MEMORY.md` 插入索引行并把增量 28 计划行改「已全部落地」；`club-platform-project-state.md`（frontmatter description + 新增 2026-09-22 节）；`club-platform-d1-quota.md`（description + 治理成效与三条新纪律段）。



## 增量 29 · 球员库 UI 缺陷收口——档案页 15 槽徽章 + 多选面板高度上限 + 表格不折行（2026-09-22 已上线，Version `627508e5`）

**缘起**：增量 27 遗留的五条 UI 瑕疵里，用户 m12257 指令「**建索引先搁置，因为今日写限额不足；海捞池后续会有新调整；球员库 UI 小瑕疵可以现在修**」⇒ 本增量只修球员库 UI 瑕疵，索引与海捞池契约都不动。

**范围**：三处真实缺陷 + 两处口径同步。① **档案页徽章槽位**：`web/src/pages/Player.tsx:336` 硬编码 `['PSID1'…'PSID7','PSID13','PSID14','PSID15']` + `i < 7 ? i + 1 : 13 + (i - 7)` 推槽号，而筛选/导入/后端口径是银槽 `PSID1-12` + 金槽 `PSID13-15`（`src/core/fc26.ts` 的 `PS_SLOT_COUNT = 15` / `PS_SILVER_SLOT_COUNT = 12`）⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（生产槽位分布实测：PSID8 = 3 人、PSID9-12 = 0 人，今天最多影响 3 人，但是真口径缺陷；列表徽章列读的是台账列 `players.badges_silver/badges_gold`，所以会出现「列表 8 银、档案页只列 7 个」）。② **多选面板高度上限**：`web/src/components/MultiSelect.tsx` 的 `place()` 每次把 `maxHeight: Math.max(160, 可用空间)` 写进内联样式、无 480px/70vh 上限 ⇒ `web/src/styles.css` 的 `.multiselect-panel { max-height: min(70vh, 480px) }` 是死规则（1200px 高窗口、触发器靠上时面板会被拉到约 1100px）。③ **表格折行**：`styles.css` 的 `th` 有 `white-space: nowrap`、**`td` 没有**，默认 12 列（FIXED 10 + 默认 `DEFAULT_COLS = ['marketValue','badges']`）挤在约 980px ⇒「Baseline Utd」「20.00 m」按空格断、「2金7银」按 CJK 任意断。**不做**：不建索引（用户指令搁置）、不动海捞池契约、不写生产数据、不动 `.admin-shell` 的 760px 断点、不改 `badge_cap_silver` 口径、不跑生产 API 回读。

**裁决**（2026-09-22 用户一问一题，共 5 项）：① 档案页徽章区 = 「**扩到 15 + 金徽区别，但有多少渲染多少，不渲染『未设置』**」；② 表格折行 = 「**所有单元格都不换行**」（第一问答「没懂」⇒ 用 ASCII 图重问）；③ 多选面板高度上限 = 「**JS 守上限**」（上限收进组件常量、删掉 CSS 那条死规则）；④ 摘要条「筛选（N）」计数 = 「**维持现状：数摘要条条数**」（只在文档里把「已接受」改写为「已裁决维持现状」）；⑤ 金徽视觉区分沿用既有的 `.ps-gold` + 🥇/🥈 + title「（金）」（`Player.tsx` 早有，无需新增）。

**分步**（每步一 commit + code-review-skill 过审）：0 基线 → 1 档案页 15 槽（`e3b5033`）→ 2 多选面板高度上限（`da875f1`，评审修正 `b8739d5`）→ 3 表格不折行（`fa29934`）→ 4 文档与记忆收口 → 5 推送 + 部署 + 前端产物核对。

**验收标准**：三处改动在真浏览器可见且不外溢（e2e 三视口 1280×900 / 900×800 / 375×812 全绿）；每处改动都做**变异验证**（断言必须能变红）；`npm run typecheck` 三份 tsconfig 全清、`npx vitest run` 全绿、`npm run build` 成功、`npm run test:e2e` 9/9；部署后线上 `/players` HTML 引用的 JS hash 与本地 `web/dist/assets/` 同名。

**风险点**：① 「所有单元格都不折行」的直接代价是**横向滚动**——实测表格最小宽 **876px** vs 桌面容器 854px（约 22px 横滚）、移动端容器 290px 必然横滚；已按用户裁决接受，代价记在 UI_DESIGN 与本文件。② 本机 D1 夹具只有 9 名球员、名字短，折行在本地**复现不出来** ⇒ e2e 那组断言锁的是口径（computed `white-space`）而不是布局，已在探针注释与提交信息里诚实标注。③ `MultiSelect` 的面板上限用 `innerHeight`，而 CSS `70vh` 在移动端指的是 large viewport ⇒ 两者在移动端有细微差异（记录未改）。

**步骤 0 记录（2026-09-22）**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 539 例全绿**（16.38s）；`git status --short` 空、HEAD `76aaeb9`。

**步骤 1 记录（2026-09-22，commit `e3b5033`，5 文件）**：档案页徽章扫全 15 槽，槽位键由槽数派生。
- `src/core/fc26.ts`：在 `PS_SLOT_COUNT` 与 `PS_SILVER_SLOT_COUNT` 之间新增 `export const PS_SLOT_KEYS: readonly string[] = Array.from({ length: PS_SLOT_COUNT }, (_, i) => `PSID${i + 1}`)` —— 原先档案页手抄 `PSID1-7` + `PSID13-15`，与 `PS_SLOT_COUNT = 15` 无关联，所以增删槽位必然漂移；改为派生后两边同一个来源。
- `web/src/lib/ref.ts`：新增 `export interface PlaystyleBadgeSlot { psid: number; slot: number; gold: boolean }` 与 `export function playstyleBadges(attrs)` —— `PS_SLOT_KEYS.flatMap` 扫全 15 槽，`Number.isInteger(psid) && psid > 0` 才收（空值 / `0` / `'abc'` 都不产出条目），`gold: playstyleIsGold(psid, slot)`，`slot = i + 1`（**1 起**）。
- `web/src/pages/Player.tsx`：删掉硬编码数组与 `i < 7 ? i + 1 : 13 + (i - 7)` 推导，改 `const playstyles = playstyleBadges(attrs)`；`PlaystyleBadge` 的 props 收窄为 `{ psid, gold }`（`slot` 只用于渲染 key），金徽区分沿用既有的 `.ps-gold` + 🥇/🥈 + title「（金）」。
- 测试 `web/src/lib/ref.test.ts` 新增 4 例：扫全 15 槽（`{PSID8: 25, PSID12: 7}` ⇒ `[{25,8,false},{7,12,false}]`，正是原先渲染不到的两槽）；金/银判定（含「金段 ID 落银槽」、`PSID15 = 156`）；空槽不产出（`{}` / `0` / `null` / `undefined` / 非数字）；槽位键与 core 同源（长度 = `PS_SLOT_COUNT`、首 `PSID1`、尾 `PSID15`、全部是 `FC26_GAME_ATTR_COLUMNS` 成员）。**变异验证**：`PS_SLOT_KEYS.flatMap` 改 `PS_SLOT_KEYS.slice(0, 7).flatMap` ⇒ 前两例立刻红（已还原）。
- **顺带修掉一个真 bug（`tests/core-zero-import.test.ts`）**：零依赖守卫的判据 `/^\s*(import|export\s+.*from)/` 会把 `export const PS_SLOT_KEYS: readonly string[] = Array.from(` 判成依赖（`from` 命中了 `Array.from`），报 `这些模块会被打进前端 bundle，不能有依赖: expected [ Array(1) ] to deeply equal []`。改为抽出 `function hasStaticDependency(line)`：`/^\s*import/` ∥ `/^\s*export[^'"]*from\s+['"]/` ∥ `/(?:import|require)\s*\(/`（**判据必须带引号**，否则 `Array.from(` 之类又被命中；第三条不锚行首是为了抓 `await import('./x')`，代价是注释/字符串里的 `import(` 也会命中 —— 宁枉勿纵），并新增判据自测 1 例（正向 6 + 反向 2）。已知边界（沿用原判据）：多行 `export {
…
} from '…'` 抓不到。
- 验收：typecheck 清；`npx vitest run` **39 文件 / 544 例全绿**；`npm run build` 成功（`web/dist/assets/index-DRPp0z40.js` 451.08 kB / gzip 142.97 kB）。

**步骤 2 记录（2026-09-22，commit `da875f1` + 评审修正 `b8739d5`）**：多选面板高度上限交回组件。
- `web/src/components/MultiSelect.tsx`：新增 `PANEL_MAX_PX = 480` / `PANEL_MAX_VH = 0.7`，`panelPlacement` 里的 `maxHeight` 改为 `Math.max(MIN_PANEL_HEIGHT, Math.min(room, cap))`，`cap = Math.min(PANEL_MAX_PX, view.height * PANEL_MAX_VH)`；注释记下「视口高 < 约 229px 时 `0.7×高` 会小于兜底 160，兜底优先」。
- `web/src/styles.css`：`.multiselect-panel` 删掉 `max-height: min(70vh, 480px)`（该规则从未生效：`place()` 在 `open` 后**无条件**调用、每次开面板/滚动/缩放都写内联 `maxHeight`），原位留注释指向组件常量。全仓再无其它 `max-height` 来源。
- 测试 `web/src/components/MultiSelect.test.tsx`：`panelPlacement` 用例由 12 例变 12 例（改 3 加 2）——下方充足 / 贴底翻转 / 半缝翻转三例的 `maxHeight` 由「可用空间」改为 **480**；新增「高视口 1400 仍 480」「极矮视口 400 由 70vh 收口到 280」；视口 120 仍兜底 160 不变。**变异验证**：`cap` 改 `Number.POSITIVE_INFINITY` ⇒ 5 例红（已还原）。
- **评审 3 条 🟡**：① 守卫判据自测没钉住「抓不到」的边界 ⇒ 补非行首动态 import 判据 + 2 例自测（自测现 10 个 expect）；② `TECH_DESIGN.md`/`CHANGELOG.md`/`ROADMAP.md` 三处旧口径 ⇒ 步骤 4 改；③ **真口径 bug**：`web/src/pages/PlayersLibrary.tsx` 的 `psNames` 用 `.map((v, slot) => …)` 的 **0 起下标**当槽号传给 `playstyleIsGold(psid, slot)`，而后者语义是 **1 起** ⇒ 下标 12（= `PSID13` 金槽）走不到金槽分支，银段 ID 落在金槽时列表显示成银、与档案页 🥇 不一致（仅异常数据可见）⇒ 改为 `playstyleIsGold(v, slot + 1)` 并把 `psNames` 改为 `export`，`web/src/pages/PlayersLibrary.test.tsx` 新增 describe「psNames：槽号从 1 起」4 例。**变异验证**：改回 `slot` ⇒ 恰好 1 例红。
- 评审 🟢 已采纳：`Player.tsx` 的 `PlaystyleBadge` props 收窄、删掉 `type PlaystyleBadgeSlot` 的 import。🟢 仅记录：commit message 里「正向 5 例/反向 2 例」实为 6/2；`Number.isInteger` 比旧 `isFinite` 严；`PANEL_MAX_VH` 用 `innerHeight` 而 CSS `70vh` 在移动端是 large viewport。
- 真浏览器复核（e2e 三视口探针）：平板上 PlayStyle 面板 280–760（**被 480 封顶**）、移动端 292–772 —— 上限确实生效。
- 验收：typecheck 清；`npx vitest run` **39 文件 / 546 例全绿**。

**步骤 3 记录（2026-09-22，commit `fa29934`）**：球员库表格单元格一律不折行。
- `web/src/styles.css`：在 `.lib-bar` 块之后新增 `.library-main td { white-space: nowrap; }`（`th` 早已 `nowrap`）。作用域限定球员库，管理员页表格靠折行塞长文案不受影响；列宽不够由 `.table-wrap` 的 `overflow-x: auto` 承担（该容器早已存在）。
- `scripts/e2e/smoke.mjs`：新增 `tableLayoutProbe()` + `assertTableNoWrap(label, t)`，在场景 ⑧ 的三个视口末尾调用；断言 `cells > 0`、`notNowrap === 0`、表头 `nowrap`、容器 `overflow-x ∈ {auto, scroll}`，并打印表格宽 / 容器宽。**变异验证**：临时把规则改成注释 ⇒ 三视口量到「非 nowrap 108」、场景 ⑧ 报 `desktop：有 108 个单元格仍会折行`、9 → 8/9（已还原）。
- 实测证据：**108 个单元格**全部单行；表格最小宽 **876px** vs 容器桌面 854 / 平板 815 / 移动 290 ⇒ 桌面约 22px 横滚、移动端必然横滚；页面级不溢出（由 `pagerProbe` 的 `!pager.pageOverflow` 把关）。**诚实边界**（已写进探针注释与提交信息）：本机夹具只有 9 名球员、名字短，折行复现不出来 ⇒ 这组断言锁的是口径（computed 值），不是布局。
- 验收：typecheck 清；`npx vitest run` **39 文件 / 550 例全绿**；`npm run build` 成功（`web/dist/assets/index-C_n2o0KE.js` 451.12 kB / gzip 143.00 kB + `index-D-qmdoLZ.css` 27.62 kB / gzip 6.36 kB）；`npm run test:e2e` **9/9**。

**步骤 4 记录（2026-09-22，纯文档提交）**：文档与记忆收口。
- `ROADMAP.md`：新增本节；并把增量 27 遗留五条**逐条改口径**（② `PSID8-12` 可筛不可见 → **增量 29 已修**、③ 摘要条「筛选（N）」→ **增量 29 裁决维持现状**、④ 面板 `maxHeight` 顶掉 CSS 上限 → **已修**、⑤ 1280 宽折行 → **已修**；① D1 读消耗那条第 282 行早前已改为「增量 28」）。
- `TECH_DESIGN.md`（徽章闭环决策表第 10 条）：末尾「已知渲染口径差：档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15` ⇒ `PSID8-12` 可筛不可见」整句替换为「**渲染口径（增量 29 收口）**：档案页与列表都按槽位渲染**全 15 槽**……与筛选/导入同源（`PS_SLOT_KEYS` 由 `PS_SLOT_COUNT` 派生）；槽号是 **1 起**（列表 `psNames` 的数组下标须 `+1` 再传 `playstyleIsGold`）。徽章墙的「🥈 x/15」那个 **15 是台账计数上限** `badge_cap_silver`（config，DDL CHECK 0..15），与「12 个银槽」是两个口径，别混」—— 这处正是只读评审 🟡2 指出的三处旧口径之一。
- `UI_DESIGN.md`：球员详情行补「按槽位渲染全 15 槽（银 `PSID1-12` + 金 `PSID13-15`），只渲染有值的槽、不给空槽占位」；球员库行末尾的版本注记改为「（增量 26 改版、增量 27 收口、增量 29 补表格与槽位口径）」并补两句：**单元格一律不折行**（列宽不够改由 `.table-wrap` 横向滚动，实测表格最小宽 876px vs 桌面容器 854px）、**多选面板高度上限由组件守**（480px / 70vh）。
- `CHANGELOG.md`：顶部新增 `## [未发布] · 增量 29 …（2026-09-22 本地完成，待部署）`（新增/变更/修复/验收/待办 五段）；并把增量 27 条目里那句「（既存问题，本增量不修）」改为「（既存问题，增量 27 未修；**增量 29 已修**）」。
- `AGENTS.md`：当前状态补增量 29 一行（本地完成、4 commit `e3b5033`/`da875f1`/`b8739d5`/`fa29934`、未推送未部署、5 项裁决与两个顺带修的 bug）。
- 记忆目录（`~/.zcode/cli/memories/projects/whl-club-operations-platform-59a36e78dc8d8fb3/memory/`）：新建 `increment29-plan.md`（评审指出的缺失：5 项裁决 + 5 步 + 边界 + 验收口径）与 `increment29-execution-state.md`（缘起/交付链/三处缺陷根因/三处修法/实测数字/两个顺带修的 bug/遗留）；`MEMORY.md` 顶部插两行索引；`club-platform-project-state.md` 的 frontmatter description 追加增量 29 段并新增「2026-09-22：增量 29」节。
- 验收：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**（纯文档改动不影响）；`git status --short` 仅剩本次 5 个文档文件。

**步骤 5 记录（2026-09-22）**：推送 + 部署 + 前端产物核对（本增量无后端改动，**刻意不跑生产 API 回读**以省 D1 读额度；当日写额度已用 73.2%）。
- `git push origin main` ⇒ `76aaeb9..91bc2d3`（5 个提交：`e3b5033`/`da875f1`/`b8739d5`/`fa29934`/`91bc2d3`），`git rev-list --count origin/main..HEAD` = 0。
- `npm run deploy` **第一次失败**：`Unable to resolve Cloudflare's API hostname (api.cloudflare.com or dash.cloudflare.com)`（既知的 wrangler → CF API DNS 抖动，与增量 27/28 同源）；**重试一次即成功** ⇒ Total Upload **533.62 KiB / gzip 127.47 KiB**、`Uploaded 19 files (4 already uploaded)`、绑 5 资源 + vars 不变、custom domain + cron 不变。
- Version 口径：`wrangler deploy` CLI 回显 Current Version ID **`627508e5-f7c6-4e6d-90a2-5f95a82466bb`**；`wrangler deployments status --name whl-club` 的 Version 也是 **`627508e5-…`**（Created 2026-09-22T07:02:52Z，Author `p_h_han@foxmail.com`）—— **增量 26/27/28 每次都出现的「CLI 回显 ≠ deployments status」两值现象，本增量首次不成立**（上一版仍为 `7c5b5879-…`）。
- 线上核对（不消耗 D1 读）：`GET https://club.whleague.win/players` 的 HTML 引用 `assets/index-C_n2o0KE.js` + `assets/index-D-qmdoLZ.css`，与本地 `web/dist/assets/` **同名** ⇒ 增量 29 前端已确认上线。
- 验收（步骤 3 后已跑，纯文档改动不影响）：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**；`npm run build` 成功；`npm run test:e2e` **9/9**。


---

## 增量 30 · 球员面板专项整改——术语三改 + 合同卷宗对齐 + 六维图与 PlayStyles 归位 + 徽章×PlayStyle 合并 + 转会记录页签（2026-09-22 已上线，Version `d266036d`）

**缘起**：用户 m00004 一次下达六项球员面板整改（术语口径、合同卷宗排版、属性文案、布局归位、徽章与 PlayStyle 合并、转会记录功能）。前四项是 UI/文案，后两项要动数据层与端点。

**范围与交付**：① **术语三改全系统对齐**——「到顶」→「非成长」、「经纪人档位」→「经纪人性格」、「档案」→「合同」（限指代球员合同页签/成长记录的那批文案与注释）、「效力球队」→「来源球队」；② **合同卷宗左右对齐与字体**——新增 `.dossier-table` 作用域（标签列定宽 6.5em、值列统一左对齐、数值列等宽 `tabular-nums`）；③ **六维雷达从属性页搬到左栏球员卡下方**（新增 `.dossier-side` 纵列 + `.radar-card`，axes/values 计算上提到页面级）；④ **PlayStyles 从属性页尾部搬进属性网格第二行空位**（网格桌面固定 `repeat(4,1fr)`、`.ps-card` 跨两列、900px 以下两列）；⑤ **徽章 × PlayStyle 合并**（见下）；⑥ **转会记录页签**（见下）。

**第 5 项（数据层核心）**：原「徽章」只是 `players.badges_silver/badges_gold` 两个计数、PlayStyle 身份由管理组在 FC 阵容文件里人工落实，两边天然会漂。本增量把身份收回平台：
- `src/core/fc26.ts` 新增 `PS_GRANTABLE_BASE_IDS`（**36 项基础 ID**：1-8 / 11-16 / 21-26 / 31-35 / 41-45 / 51-56，与 `web/assets/ref/playstyle.json` 银段逐项一致；金徽 ID 严格 = 基础 +100）与 `isGrantablePlaystyleId` / `playstyleIdOf` / `playstyleKindOf` / `playstyleSlotRange` / `nextFreePlaystyleSlot` / `playstyleSlotsOf` / `mergePlaystyleSlots` / `planPlaystylePicks`。
- 迁移 `0031_player_playstyles.sql` 建明细表：`player_id / slot(1-15) / kind(silver|gold) / psid(基础 ID 1-99) / source(growth|china|manual) / granted_by / created_at`，`UNIQUE(player_id,slot)` + `UNIQUE(player_id,kind,psid)` + 段界 CHECK（银 1-12 / 金 13-15），并把 `config.badge_cap_silver` 由 15 改写成 **12**。
- `applyLevelUp` 加第 5 参 `picks`：带徽章的方案**必须一次选满**（数量须与方案一致、白名单内、同段不重复、未被 FC 源同段占用、槽位有空），台账与明细同批写。
- 新端点 `POST /api/growth/china-playstyles/:playerId`：把一直没人读的 `china_badges`（默认 3）落成真发放，名额一次发满、`source='china'`。
- 回收：`completeTransfer` 成约时删 `source='china'` 明细并同步减台账（**转出方为空的海捞是签入不是离队，不动**）；`completeTermination` 解约时删该球员全部明细。
- 大换版折算：`FOLD_PLAYSTYLES_SQL`（窗口函数 CTE 先算排名再删，避免 DELETE 自引用本表）每 kind 留最早 `ceil(n/3)` 行，`generate-sql.ts` 拼在最后一片末尾。
- `GET /api/players/:id/growth` 返回 `playstyleDetails` 与 `player.chinaPlaystyles {quota,granted,left}`；属性页列表 = FC 源槽 ∪ 明细（按 kind+基础 ID 去重，FC 源优先）。

**第 6 项**：`GET /api/players/:id/transfers`（只列 `status='completed'`，LEFT JOIN clubs 出双方队名，最近 50 条）+ 球员详情第 4 页签「转会记录」；`TRANSFER_TYPE_LABEL` 从 `web/src/pages/admin/MarketPage.tsx` 抽到 `web/src/lib/ref.ts` 共用。

**裁决**：① 术语「摘要条 chip 与表格列名仍叫『经纪人』」沿用增量 27 裁决（不动）；② 主题名「复古档案室」、容器名「档案卡 `.dossier`」、「主场/球场档案」不是本轮口径对象；③ 上限口径**统一为 12 银**（此前 `TECH_DESIGN.md` 写「15 与 12 是两个口径，别混」，本增量改写）；④ 明细行 `psid` **存基础 ID**、金徽由 `kind` 表示（读出来用 `playstyleIdOf` 还原）；⑤ 中国计划发放**同时加台账**，离队回收时同步减。

**边界（计划期，不做）**：不部署、不 push、不 apply 生产迁移、不重导入球员库、不重建 players 表、不加依赖、不做顺手重构、不改 DDL CHECK(0..15)、不 clamp 历史台账。**注**：前三项为计划期边界，已于步骤 9 按用户明确指令（「推送部署」）执行。

**分步**（每步一 commit）：1 术语三改（`f4d4a68`，21 文件）→ 2+4 合同卷宗对齐与布局归位（`e74148f`）→ 5 core（`de3c04c`）→ 5 worker（`60c8dd5`）→ 6 worker 端点（`1c44506`）→ 5+6 web（`d38b39f`）→ 评审修复（`6bd9138`）→ 文档收口（本节）。

**验收标准**：六项在真浏览器可见且不外溢；每处改动做**变异验证**（断言必须能变红）；`npm run typecheck` 三份 tsconfig 全清、`npx vitest run` 全绿、`npm run build` 成功、`npm run test:e2e` 9/9；`code-review-skill` 过审。

**步骤 1–4 记录（2026-09-22）**：术语三改（`f4d4a68`，21 文件，纯文案/注释；**例外保持原貌**：CHANGELOG/ROADMAP 历史条目、`PRD.md:5` 版本行、已 apply 的迁移注释、`scripts/prod-*/README`，以及「主场/球场档案」语义）；合同卷宗与布局（`e74148f`，`web/src/pages/Player.tsx` + `web/src/styles.css`）——诊断是「全局 `.mono` 规则不存在，而 `td.num` 自带右对齐+等宽」⇒ 三行 `td.mono` 与两行金额字体/对齐不一致，故新增 `.dossier-table` 作用域统一左对齐并给数值列补等宽；雷达搬到 `.dossier-side` 下的 `.radar-card`，PlayStyles 成为 `.attr-group-grid` 第 7 项（`.ps-card` 跨两列）。真浏览器复核（1440×1000 / 820×1100）：合同页签 7 行全左对齐、数值列等宽；属性页网格恰 4 列、第二行 = DEF/PHY + PS 卡；左栏雷达卡常驻；820px 下网格两列。

**步骤 5–6 记录（2026-09-22）**：core `de3c04c`（白名单与槽位口径 + `badge_cap_silver` 默认改 12 + `web/src/lib/ref.ts` 的 `playstyleBadges` 改走 `playstyleSlotsOf` + 新增 `tests/playstyles.test.ts` 12 例）；worker `60c8dd5`（迁移 0031 + `tests/d1.ts` 登记 + growth 发放/回收/折算 + 中国计划端点 + 上限 12 落点）；worker 端点 `1c44506`（`GET /players/:id/transfers` + 4 例）；web `d38b39f`（选择器、中国计划发放块、转会页签、类型层、样式）。真浏览器复核（本地 8791，球员 9100）：点方案 2 展开 **35 个银选项**（36 − 已拥有 PSID1），选满后其余 disabled；确认后 `GET /growth` 复核 ca 76→78、明细落 `{slot:2,silver,psid:2,source:'growth'}`（**跳过被 FC PSID1 占用的槽 1**）；中国计划选 3 个发放后徽章墙 🥈 4/12、明细 3 行 `source='china'`、`granted_by=1`；属性页实测 `gridTemplateColumns = 198.1px ×4`、PS 卡跨两列、卡内 5 银 + 1 金（FC PSID13=102 与银「吊射」共存）；转会页签 6 列无横向溢出。

**步骤 7 记录（2026-09-22，commit `6bd9138`）**：`code-review-skill` 过审后修 1 个真实缺陷 + 5 条记录不改。
- 🟡 **真缺陷（已修）**：`src/worker/transfers.ts` 的 china 明细回收原先只 gate 在 `!amendment`，于是**海捞真自由身**（`type='free_agent'` 且 `from_club_id IS NULL`）会被当成离队 —— 签入即删掉他的 china 明细并扣台账。改为 `amendment || transfer.from_club_id === null ? 0 : (COUNT…)`（从 CPU 队摘人 `from_club_id` 不为空，照旧回收）。回归测试 `tests/bypass-routes.test.ts` 新增「海捞真自由身是签入不是离队」，**变异验证**（去掉守卫）⇒ 两行 china 明细被删、断言变红。
- 🟢 **记录不改**（遗留）：① 台账可能 > 12（历史 cap 15 遗留），徽章墙会显示「🥈 15/12」（迁移注释已声明历史台账不 clamp）；② `Player.tsx` 徽章墙分母 12/3 是硬编码，改 config 不跟随（增量前也是硬编码）；③ 方案卡 `disabled={busy || (armedPlan === i && !picksReady)}` 让 `choosePlan` 里「先选满再确认」那条 toast 在 UI 上不可达（防御性死代码）；④ 双击发放/升级会撞 UNIQUE 让第二个请求 500，不会写脏数据；⑤ `resolvePlaystylePicks` 对「0 徽章方案」直接返回 `[]`，多传的 picks 被静默忽略（无状态变化）。

**步骤 8 记录（2026-09-22，纯文档提交）**：文档与记忆收口 —— `TECH_DESIGN.md`（决策表第 10 条把「15 与 12 是两个口径，别混」改写为**已统一**并补发放/回收口径、`player_playstyles` DDL 入 §5 建表清单、§10.2/§10.4 补 picks 与明细折算、§5.4 upsert 幂等段补明细列、config 表 `badge_cap_silver` 改 12、端点表加 2 行）；`UI_DESIGN.md` 球员详情行改为四页签 + 左栏雷达卡 + PS 卡嵌网格 + 徽章墙 x/12；`ROADMAP.md` 本节；`CHANGELOG.md` 顶部新增增量 30 条目；`AGENTS.md` 当前状态补一行；记忆目录新建 `increment30-plan.md` / `increment30-execution-state.md`。

**验收（步骤 1–7 实测）**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **40 文件 / 573 例全绿**（增量 29 基线 39/550 ⇒ core +12、worker 测试改 2 加 4 + 中国计划 3 + 折算 1 + 回收 1 + 海捞回归 1）；`npm run build` 成功（`web/dist/assets/index-C56W4cF9.js` 457.55 kB / gzip 145.20 kB）；变异验证 4 处（`flatMap` 类改动、槽号、折算 SQL、海捞守卫）均能变红。

**步骤 9 记录（2026-09-22，推送 + 部署 + 生产迁移）**：用户明确下令「推送部署」后执行。
- 推送：`git push origin main` ⇒ `5394268..da7a1f6`（8 个提交），`git rev-list --left-right --count origin/main...HEAD` = `0 0`。
- 生产迁移：`npx wrangler d1 migrations list whl-club --remote` 只报 `0031_player_playstyles.sql` 一条待应用（生产原在 0030）⇒ `npx wrangler d1 migrations apply whl-club --remote`（非交互环境自动确认）**Executed 4 commands in 4.46ms，✅**。**先迁移后部署**：旧版 worker 不引用 `player_playstyles`，故无窗口期。
- 迁移后只读核对：`sqlite_master` 里表与索引各 1（`tbl=1`/`idx=1`）；`SELECT value FROM config WHERE key='badge_cap_silver'` = **null** —— 生产 `config` 本来就没有这一行，迁移里那条 `UPDATE` 空转，上限由代码默认值（`CONFIG_DEFAULTS`，本增量已改 12）生效；`SELECT COUNT(*) FROM player_playstyles` = 0（功能刚上线，尚无明细）。
- 部署：`npm run deploy`（build + `wrangler deploy`）⇒ **Version `d266036d-aa2e-43be-94ac-7f40972df7bb`**（2026-09-22T11:42:02Z，100% 流量；`deployments list` 记录与 CLI 回显一致）；产物 `index-C56W4cF9.js` 457.55 kB / gzip 145.20 kB、`index-Dp9bc019.css`；Worker Startup Time 3 ms、Total Upload 545.23 KiB / gzip 130.54 KiB。
- **线上只读核对**（4 次请求，未做全量回读以省 D1 读额度）：`https://club.whleague.win/players` HTML 引用 `assets/index-C56W4cF9.js`（与本地产物同名）；`GET /api/players/1/transfers` ⇒ `{"transfers":[]}`（新端点通、球员 1 存在未 404）；`GET /api/players/1/growth` ⇒ 顶层键 `player,playstyleDetails,events`、`playstyleDetails: []`、`player.chinaPlaystyles = {quota:3,granted:0,left:3}`（新字段与新配额口径均生效）；`GET /api/players?badges_silver_min=13` ⇒ **400「badges_silver_min 应为 0-12」**（上限 15→12 已上线）；`GET /api/players/99999999/transfers` ⇒ 404。

**待办**：① 上述 5 条 🟢 遗留；② PlayStyle 图标资产包仍待供给（缺图降级 🥇🥈）；③ 生产库 `player_playstyles` 目前 0 行 —— 首次真实发放（升级选徽章方案 / 中国计划）建议人工跟一单核对明细落槽。


## 增量 31 · 球队页（公开列表 + 登录详情 + 自家队中心合并）

**状态**：2026-09-22 完成步骤 0–12（含 11a 结构分析整改与 11b 样式整改），**已推送并部署上线**（推送 `466df81..d759b86` 16 个提交 + `d759b86..2ad239b` 1 个；生产 Version `7a178d81-dccc-4696-a7d7-7d8c61eaa683` → `64020454-405c-479a-9a62-8197444f4f52` / `adb3a5ae-dbc5-4648-bf62-383e1108923d`）。**本增量不含迁移**（0032 在步骤 1 被裁掉），故推送无生产 DDL 耦合；生产迁移仍到 0031。

**缘起**：用户 m12793 下达「新增球队页（列表 + 详情）」，并特别要求注意性能、省 D1 额度。经脑暴发散 → 一问一题裁决（Q1–Q17）→ 技术路径与用户操作动线 → 计划。计划稿 v1 被拒后修订重交（编号因增量 30 已占用改为 31，迁移号改 0032，后又在步骤 1 裁掉）。

**范围与交付**：公开 **`/clubs`** 列表页；需登录的 **`/clubs/:id`** 详情页；**`/club` 改重定向**到自家队详情，原「我的球队中心」（`web/src/pages/Club.tsx`，897 行）整体搬进详情页教练区块；入口四处；新增 `GET /api/clubs`、`GET /api/clubs/:id`（+ `GET /api/clubs/:id/standing`）、`GET /api/media/*` 三个端点。
**不做**：改球员库或市场读面契约、国籍分布、详情页财政与主场组、改 `clubFormPts` 代码、引图表库、写生产数据、动 `.admin-shell` 断点。

**技术路径**
- **① `GET /api/clubs`（公开）** —— 一次算完 20 队：固定 4 条 whl-club 语句 + AUTH_DB/TOUR_DB 各 1~2 条，**无逐队查询**；clubs scope 缓存（24h）+ `assertPublicRate('clubs')`。聚合 `CLUB_SQUAD_AGG_SQL` 带 `WHERE club_id IS NOT NULL` ⇒ SQLite 改写成范围扫跳过 17,731 行 NULL（**实测读 1,032 行**，全表 18,301）；`contracts.player_id` 是 UNIQUE ⇒ LEFT JOIN 无扇出。响应 `{ clubs: [{ id, name, isCpu, tier, logoKey, squad:{senior,trainee}, avgCa, totalValue, totalWage }] }`。`tier.ts` 抽出 `loadLeagueList`（`derive` 内部改用它，SQL 逐字不变）并新增 `deriveClubTiers` 批量派生：**一队双定级**（单队 `derive` 会抛 500）在批量里降级 `null` + `console.warn`，AUTH_DB 映射冲突也降级告警、**不 last-wins**。队徽取比赛系统 `team.logo_key`（本平台 `clubs.logo_key` 全仓无人写无人渲染）。
- **② `GET /api/clubs/:id`（需登录，同一 clubs scope）** —— 队头 + 阵容结构 + 合同结构 + 转会往来 + 近期战绩；阵容**一条语句**取全队（走 `idx_players_club_ca`）在 JS 里算三个维度分布，避免三条 GROUP BY。战绩绑**比赛系统队 id**（`result_confirmations` 存的是 tour team id，见迁移 0017），90 分钟口径、双弃权双方各记负。排名走代理 `GET /api/clubs/:id/standing`：`TOUR_API_BASE` 未配即降级且**零查库**，失败不落缓存（`StandingUnavailable`）、响应体限 2MB。**验收冷算 151 行（club 1）/ 165 行（club 9，生产阵容最大 37 人）**，排名 11 行，均远低于 500 行线。
- **③ `GET /api/media/*`（公开）** —— 镜像比赛系统的公开媒体路由，**只读不写**，key 白名单 `/^(team|tournament)\/\d+\//` + 长度 ≤1024；边缘缓存（`caches.default`，jsdom/node 无 `caches` 时静默旁路）命中即返，`immutable` + ETag + `waitUntil(cache.put)`；残缺百分号编码不接住就是匿名 500，已 catch 回 `{error:'not_found'}`。**本路由不碰任何 D1**，是球队页里唯一的零 D1 读面。走本域而非直连比赛系统的理由：R2 桶 `whl-media` 已绑定本 Worker（`MEDIA`），同源取图省一次跨站请求与 DNS，也无 CORS / 混内容问题。**不加 `assertPublicRate`**：零 D1 读且命中边缘缓存后连 R2 都不打，而限流是 60/min/IP，一屏 20 个队徽会被正常浏览打成 429（比赛系统同样不限流）。
- **前端** —— `web/src/pages/Clubs.tsx`（按顶级/次级/未定级三段出卡片，生产 20 队一屏放得下 ⇒ 无筛选无分页；整卡链 `/clubs/:id`；空段整段不渲染）；`web/src/pages/ClubDetail.tsx`（三组结构分析，每组「三格主指标 + 一行语义明细」，见下方步骤 11a）；`web/src/components/TeamLogo.tsx`（有 logoKey 出 `<img>` 走 `mediaUrl()`，否则按队名哈希出首字色块，同队三处同色）；路由 `/clubs` 进公开组、`/clubs/:id` 进 `RequireUser` 组、`/club` 改 `<Navigate>`。

**裁决（Q1–Q17）**：列表公开 / 详情需登录；列表 4 指标（阵容人数拆一线队+训练营、平均 CA、总身价、工资总额）；按分级分段卡片；详情三组（阵容/运营/战绩），**不含财政与主场**；统一 `/clubs/:id` 且 `/club` 重定向；分级批量派生、未定级归第三段；队徽参照 tour 平台、镜像其 media 路由；入口四处；CPU 队显示带标记；训练营 = `players.status='trainee'`；结构分析全要，**年龄用 CSS 自绘柱状图不引图表库**；教练区块仅「已登录且绑定该队」渲染；**Q17 = 球队页 URL id 一律用平台库 `clubs.id`**（长期有效，已写进 `AGENTS.md`）。术语沿用增量 30：非成长 / 经纪人性格 / 合同 / 来源球队。

**分步**（每步一 commit + code-review-skill 过审）：0 生产只读事实核对 + 计划落盘（计划在 `.zcode/plans/plan-sess_4cad139a-6977-4a40-9531-f7cf24c68499.md`，`.zcode/` 已 gitignore）→ 1 读量实测（`70dc811`）→ 2 媒体路由（`e0411de`）→ 3 列表端点（`5dbfe41`）→ 4 `TeamLogo` + `/clubs` 列表页（`a84c748`）→ 5 入口四处（`779ee6b`）→ 6 详情端点 + 读量证据（`5b90031` + `32068be`）→ 7 详情页（`00092b4`）→ 8 教练区块迁移 + `/club` 重定向（`57e68a6`）→ 9 `clubFormPts` 只读核对（`829063f`）→ 10 文档收口（本节）。另有 `545ad90` 把 Q17 写进 `AGENTS.md`。

**步骤 1 记录（2026-09-22，`70dc811`）**：读量量化后**裁掉迁移 0032**。原计划给 `players` 建部分覆盖索引 `WHERE club_id IS NOT NULL`（索引内约 570 条），实测发现 `WHERE club_id IS NOT NULL` 的聚合本来就只读 1,032 行（SQLite 直接范围扫跳过 17,731 行 NULL），索引收益不足以抵一条生产 DDL ⇒ 本增量零迁移。

**步骤 6–8 的关键手法**：读量实测不靠估算，而是**调真实路由抓 SQL**（`mountApp` + 自带假 D1 按 SQL 文本回生产同形的值），逐条 `inlineParams` 后打生产 `--remote --json`（工件 `scripts/d1-read-audit/measure-club-detail.mjs` + `club-detail-measurements.json`）。评审抓到并修掉的真缺陷：**CSS 类名冲突污染球员档案页** —— 新追加的 `.pos-chip` 与 `web/src/pages/Player.tsx:568` 在用的 `.pos-chip-main` 同特异性且位置更晚 ⇒ 覆盖其 `background:var(--ink)` 而 `color:var(--paper)` 仍生效，球员页第一个位置徽章变浅底浅字不可读；修法是新增类一律带 `club-` 前缀。另一处是 `/club` 重定向把「请求失败」当成「未绑定」（`useMyClub` 在 `isError` 时 `club: null`，而全局 `retry: false` ⇒ 一次失败即终态），会把绑着队的教练送去写着「一账号只能绑一支队」的 `/bind`；修法是 `MyClubState` 新增 `failed` 并让壳在该状态下留在原地报错。

**步骤 9 记录（2026-09-22，`829063f`，本增量的最重要结论）**：`clubFormPts` 的「真 bug」**被证伪**。
- 语义上确实是两套 id：`result_confirmations.home_team_id / away_team_id` 存**比赛系统队 id**（迁移 0017 原话「赛果快照补两队 tour team id」，写入源是 `results.ts` 从 TOUR_DB 读出的 `TourMatchRow`），而 `clubFormPts` 绑的是 **club id**。
- 但生产实测（2026-09-22）：AUTH_DB `team` 表 20 行**逐队 `club_id` = `tour_team_id`**（1/2/5/9/10/11/13/14/21/33/45/66/73/241/243/280/449/110374/112172/131681 全等）；`result_confirmations` 69 行的队 id 全落在这 20 个值内，**20 队各有 6–7 条已确认赛果**。⇒ 函数**算得出真值**，`form_coef_table` 取的是真实战绩档、`evolveFans` 的 ≥7 / ≤1 分支会触发。此前「命中恒 0 ⇒ 战绩系数恒 1.0」的结论**是错的**。
- 定性为**潜伏缺陷，非现行故障**：历史上确有真实失效窗口 —— 米兰的 `tour_team_id` 长期是 legacy 47 而 `club_id` 是 131681，直到 2026-09-19 rekey 才统一，那段时间本函数对米兰恒返中性 4。将来若新增 club 的 id 不等于其 tour 队 id，本函数会**静默退化成「永远中性」**。
- 处置：按计划**不改代码行为**，只订正两处注释（`src/worker/home.ts` 的 `clubFormPts` 上方、`src/worker/routes/clubs.ts` 的 `CLUB_FORM_SQL` 上方），写明 id 语义、生产实测的巧合与正确写法（照 `prizes.ts` 的 `clubIdByTourTeam` 先映射）。

**步骤 11 记录（2026-09-22，e2e 三视口 + 全量验收）**：`scripts/e2e/smoke.mjs` 新增场景 **⑨「球队页三视口：列表分段 / 详情三组 / 结构图不溢出」**（1280×900 / 900×800 / 375×812）与 **⑩「匿名看详情给登录引导且不泄露；`/club` 取不到球队时不误跳 `/bind`」**，原 ⑨ 顺延为 ⑪。
- **本机必须打桩**：本地 TOUR_DB（`whl`）的 `team` 表是**旧 schema**（无 `logo_key`、无 `club_id`，只有 4 行）⇒ `GET /api/clubs` 与 `GET /api/clubs/:id` 在本机必然 500（`D1_ERROR: no such column: logo_key`，抛在 `loadTeamLogos`），是环境陈旧而非代码回归。故球队页读端点用 `page.route()` 回夹具（打完即撤），其余请求仍走真服务端；判据仍是**真浏览器里的渲染与几何**（jsdom 量不到）。`/api/me/club` 也打桩，但理由不是「本地取不到」——它只读 AUTH_DB `team_binding`/`team` 与 whl-club，本机其实 200 带 club，打桩是为造出「非教练观众」与「取不到」两种受控情形。
- **匿名那条踩到的坑**：本地 `AUTH_MODE=oidc`，匿名进站先被「无感同步登录态」探针（`web/src/lib/auth.tsx:23` 的 `syncProbe` → `/api/auth/sync`）整页跳走，本机认证中心不在接入名单 ⇒ 停在登录错误页，`RequireUser` 的软提示分支根本走不到。修法：匿名 context 里把 `/api/me` 钉成 `{user:null, authMode:'shared', authHome:null}`（无 syncProbe）。
- **评审 4 条遗留全部修掉**：🔴「结构图几何断言恒真」（`.band-bar` 是 `.band-track` 的百分比宽子元素，且全局 `* { box-sizing: border-box }` ⇒ `bar.right ≤ track.right ≤ chart.right` 由盒模型保证，任何回归都抓不到）改为量**图表与所在卡片的边界**与**图表自身的 `scrollWidth`**；三处注释失真订正（本地 TOUR_DB 不是空库、`/api/me/club` 不是取不到）；⑩ 自己桩的 500 改为**自己认领**（从 `badResponses` 里 splice 掉），不再依赖 ⑪ 的噪声白名单兜底，并新增「桩真被请求到」的计数断言；⑩ 的 `.club-block count === 0` 补上「且无错误横幅」，把「被守卫挡下」与「加载失败」分开。

**步骤 11a 记录（2026-09-22，详情页结构分析整改，用户 m14999 批准）**：用户对结构分析的展示方式连续下整改令 —— 位置分布 `GK CB CM ST` 是错的应改四档、年龄与 CA 档位重定、并要求「**年龄与 CA 应该是水平条形图或直方图**」且「**若干行数据也没有层次，没有主次，展示方式很差劲**」。经脑暴（bounded 型）与两轮 AskUserQuestion 定案，**硬约束是配色只用站点既有调色板变量**（`--terracotta` / `#f3ead9` / `--border` / `--muted` / `--ink`，不新造颜色）。
- **位置分布：不用图示**（`src/core/fc26.ts` 新增 `POSITION_GROUP_BY_POSITION` 与 `POSITION_GROUPS`），出**门将/后卫/中场/前锋四档恒出**（「0 门将」本身是信号），档内细位按 `POSITION_BY_ID` 顺序拼 `CM 1 · CDM 1`；`byPosition` 契约由 `{position,count}[]` 改为 `{key,label,count,detail}[]`。
- **年龄结构：等宽 3 岁箱 + 竖直直方图**（`Histogram`，`AGE_BANDS` 改 `≤18 / 19–21 / 22–24 / 25–27 / 28–30 / ≥31`）。**已知代价**：直方图的前提是等宽箱，故「成长年龄上限」（生产 `age_cap = 25`）**不再是档界**；因此不需要新增 `getVisibleSeasonCap`，档位是纯常量。柱高 = 人数 / 最高档人数，0 人档不设 `min-height`（给 0 画 2px 会假装有 1 人），人数标在柱顶故不画 y 轴。
- **CA 结构：横向占比条**（`ShareBar`，`CA_BANDS` 改 `90+ / 85–89 / 80–84 / 70–79 / <70`，**降序**）。分母是**全队人数**而非「各档之和」（有人缺 CA 时条长之和 <100% 是实话），带 0–100% 刻度轴与行尾绝对人数。档界 70/80/84/90 与游戏自己的「能力等级」阶梯对齐（`src/core/negotiation-rules.ts` 的 `ratingLevel` 十档是 60/65/70/75/80/84/87/90/93，也是谈判等级与身价/工资的定价依据）；因档不等宽（70–79 宽 10、80–84 宽 5）故用横条讲「档位」而不是用直方图讲「数值分箱」。→ **步骤 11b 已改为「一根 100% 堆叠条 + 图例」，见下。**
- **效力年限**（`byYears`）保持原普通升序横向柱状图（`BandChart`），不参与改造。
- **三组指标重排**：删掉等权 10 格 `.club-stats` 网格，改为 `.club-hero`（**三格主指标**，左侧 2px terracotta 竖线、dd 21px/600 等宽数字）+ `.club-detail-line`（**一行语义明细**，按「能力 / 资产 / 荣誉」分组带粗体前缀）。阵容组主 = 阵容人数（+N 青训）/ 平均 CA / 总身价；运营组主 = 在册合同 / 保护期内 / 未保护；战绩组主 = 名次 / 积分（扣分副标）/ 胜平负。`.club-stats`/`.club-stat` 保留给 `ImportPreviewBlock` 与 `CoachPanel` 用。
- **无障碍口径**：四张图都用 `<ul>/<li>` 而不是 `role="img"`（后者会把整棵子树当装饰，档位标签与人数读不到），图形部分 `aria-hidden="true"`。
- **变异验证**：把 CA 条分母改成「按最大档归一」⇒ 只有「CA 占比」那条红；把直方图柱高改成「按总人数归一」⇒ 只有「年龄直方图」那条红；把 `.club-share` 加 `min-width: 2000px` ⇒ e2e ⑨ 在 desktop 就报「有结构图超出所在卡片」（**证几何断言非恒真**）。三处均定向变红、其余全绿。

**步骤 11b 记录（2026-09-22，详情页结构分析样式整改，用户 m15308/m15319）**：用户看图后提四条 —— 「三个主要数字下的其他数据小字与上方过于割裂；直方图长宽比失衡，难看；横向条形图是让你画成一个水平柱子展示比例的；右侧空白区域没有利用好，难看」，并明确更正「**不是换展示项目，是样式上太割裂**」（即不得增删数据项，只改样式）。四条处置：
- **割裂 ⇒ `.club-summary`**：主指标与明细行搬进同一块淡奶油底（`--cream`）+ 左侧 3px `--terracotta` 竖线 + 右侧圆角。**`.club-hero-item` 去掉逐格 `border-left`**（逐格画线让每个数字各成一张小卡，而下面那行小字没有线，正是「割裂」的来源），`.club-detail-line` 去掉 `border-top` 与 `padding-top`，整块只留一道左线。
- **长宽比 ⇒ 直方图变高**：`.club-histogram` 去掉 `max-width: 460px`（宽度交给图排列宽，约 370px），`.club-hist-track` 高度 72px → **128px**。原状 460×72 是 6.4:1 的扁条、每列还是 76×72 的方块；现约 370×128 = 2.9:1，每列高略大于宽。
- **CA ⇒ 一根 100% 堆叠条**：`ShareBar` 重写为 `.club-share-plot`（0–100% 刻度轴 + `.club-share-stack` > `.club-share-seg`）+ `.club-share-legend`（**五档恒出**，色块 + 档名 + `N 人 · X%`）。段宽分母仍是全队人数，**只渲染 count>0 的档**（0 宽段无意义）；段色是同一 `--terracotta` 的深浅阶梯（内联 `opacity`，取 `SEG_ALPHA = [1, 0.82, 0.63, 0.44, 0.27]`，越强的档越深），**颜色仍只来自 CSS**。缺 CA 的人没填满的那截由米色底板显出。
- **右侧空白 ⇒ `.club-figures` 与 `.club-split`**：阵容组三张图进 `.club-figures`（`repeat(auto-fit, minmax(260px,1fr))`）⇒ 宽屏三列铺满卡片；运营组用 `.club-split`（左 = 合同结构 summary、右 = 效力年限图，900px 折一列）。`.band-chart` 也去掉 `max-width: 460px`（否则并排时右列空一截）。
- **顺带两处实测缺陷**：`.band-label` 宽 4.5em → **6.5em + `nowrap`**（「3 赛季及以上」这类档名在 4.5em 下折成两行，图立刻变丑）；`BandChart` 的 **0 人档不再渲染 `.band-bar`**（它有 `min-width: 2px`，给 0 画 2px 会读成「有一点」——与直方图 0 人不出柱同一口径）。
- **测试同步**：`web/src/pages/ClubDetail.test.tsx` 的 CA 用例改断 `.club-share-seg`（宽度只对非零档）+ `.club-share-legend-row`（五档、title 与 `N 人 · X%`）；`scripts/e2e/smoke.mjs` ⑨ 改量 `.club-share-stack`/`.club-share-seg`/`.club-share-legend-row`，几何遍历清单扩为 `['.club-figures','.club-split','.club-histogram','.club-share-plot','.band-chart']`（并排容器也会被网格轨道撑破，图自己不会滚）。
- **变异验证**：把 `ShareBar` 的 `denom` 由全队人数改成「按最大档归一」⇒ 只有 CA 那条用例红（21 绿）；变异前后 build hash 逐字节一致（`index-DdVd-lyb.js`）。
- **未采纳**：运营组左列 summary 下方仍有约 150px 卡片留白（右列效力年限图更高）；改成居中/拉伸都更难看，判定为可接受的留白。

**步骤 12 记录（推送 + 部署 + 最小化回读）**：
- **推送**：用户 m15490「先推送部署再说」下令后执行。`git push origin main` → `466df81..d759b86`（增量 31 的 16 个提交），随后 totalValue 修复再推 `d759b86..2ad239b`。推送前用 `git diff --stat origin/main..HEAD -- src/db/migrations` 确认为空 ⇒ 零迁移。**本机沙箱会拦网络**：`npx wrangler ...` 报 `Unable to resolve Cloudflare's API hostname`，需 `dangerouslyDisableSandbox` **并加 `NODE_OPTIONS=--dns-result-order=ipv4first`**（`nslookup` 先回 IPv6，Node 默认 verbatim 顺序导致解析失败）。
- **部署**：`NODE_OPTIONS=--dns-result-order=ipv4first npm run deploy`（= `build && wrangler deploy`），上传 19 个资产、Total Upload 567.39 KiB / gzip 136.51 KiB。生产迁移查得 **「✅ No migrations to apply!」⇒ 已在 0031**（AGENTS.md 里「生产原在 0030」的说法已过时）。生产 vars 含 `TOUR_API_BASE="https://whleague.win"`（排名代理基址已配好）。
- **回读（2026-09-22）**：`https://club.whleague.win/` 200，首页资产 `index-DdVd-lyb.js` + `index-BT5YAIcz.css` 与本地 build 逐字一致；匿名 `GET /api/clubs/1` → **401**（符合裁决 Q1）；`GET /api/clubs` → 200、**20 队**、`logoKey` 20/20 非空、`squad.senior` 23–37、`avgCa` 77.6–83.4、`totalWage` 有真实值（如利物浦 73.55）；4 支 CPU 队（131681 米兰 / 112172 莱比锡 / 241 巴萨 / 10 曼城）`totalWage` 与 `totalValue` 均 0（无合同，符合预期）。
- **回读抓到一个生产可见缺陷（已修，commit `2ad239b`）**：20 队 `totalValue` **全为 0**（含 31 人、avgCa 80.7 的佛罗伦萨），而 `totalWage` 有真实值 ⇒ 列表页第 3 项指标「总身价」全站显示 `0.00 m`。生产只读实测根因：`SELECT COUNT(*) AS total, SUM(CASE WHEN market_value IS NULL THEN 1 ELSE 0 END) AS nulls, SUM(market_value) FROM players` → `{"total":18301,"nulls":18301,"zeros":0,"sumv":0}` ⇒ **`players.market_value` 生产 18,301 行全 NULL**（该列是运营列，`src/core/import.ts:3` 明写导入「绝不触碰运营列（status/contracts/badges/growth/market_value/agent_tier）」，只有 admin PATCH 会写）。缺陷本身在聚合口径：`CLUB_SQUAD_AGG_SQL` 写 `SUM(COALESCE(p.market_value, 0))`，把「没人录过」压成 0 这个具体的假话。**球员库早就处理对了**（`web/src/pages/PlayersLibrary.tsx:58` 的 `money(x: number | null)` 对 null 回 `—`）。修法：聚合改 `SUM(p.market_value)`（全 NULL 时 SUM 出 NULL）、两处 `totalValue` 类型改 `number | null` 并 `?? null`、详情页改「全队都没录身价 ⇒ null」、前端 `money(null)` 回 `—`；**`totalWage` 口径不变**（CPU 队无合同 ⇒ 0 是真话）。测试：`tests/clubs-list.test.ts` 新增「无身价队」（2 人有合同无 market_value ⇒ `totalValue` null / `totalWage` 5）+ 空队由 `toBe(0)` 改 `toBeNull()`，`tests/clubs-detail.test.ts` 新增同类用例，`web/src/pages/Clubs.test.tsx` 新增 `metric(card,label)` 辅助断言 CPU 卡「总身价 `—` / 工资总额 `0.00 m`」，`web/src/pages/ClubDetail.test.tsx` 新增「全队都没录身价时显示 —」，e2e ⑨ 新增巴萨卡「总身价 = `—`」断言。变异验证两条定向变红（后端改回 `COALESCE`、前端 `money(club.totalValue ?? 0)`）后复绿。重新部署后生产复验：20 队 `totalValue` 全 `null`，首页资产 `index-C7pOcE6p.js` 与本地逐字一致。
- **观察到的版本记录怪象（非本增量引入）**：`wrangler deployments list` 显示每次 `wrangler deploy` 会落**两条**部署记录（增量 31 为 `67938a92-…` 17:42:21 与 `7a178d81-…` 17:42:22；修复那次为 `64020454-…` 17:58:08 与 `adb3a5ae-…` 17:58:17，CLI 回显的是前者、`deployments status` 的当前版是后者）。两次产物一致（线上资产 hash 与本地 build 相同），故不影响行为。

**验收（步骤 1–12 实测）**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **46 文件 / 642 例全绿**（增量 30 基线 40/573 ⇒ 本增量 +6 文件 / +69 例）；`npm run build` 成功（`web/dist/assets/index-C7pOcE6p.js` **474.57 kB / gzip 149.44 kB**、`index-BT5YAIcz.css` 34.57 kB / gzip 7.58 kB）；`npm run test:e2e` **11/11 通过**（三视口；新增球队页两场景）。变异验证多处（教练区块身份判定、`/club` 两个 Navigate 目标、`failed` 分支、`平均成长空间`、积分榜 TTL、CA 条分母、直方图归一、图表溢出、后端 `COALESCE`、前端 `money(totalValue ?? 0)`）均能定向变红。

**待办**：① `players.market_value` 生产 18,301 行全 NULL 且无录入入口 ⇒ 球队页「总身价」指标全站恒显示 `—`（产品级待决：运营补录 / 给派生公式 / 撤掉该指标，见步骤 12）；② `CoachPanel`（874 行）搬迁后无专属组件测试，只有经详情页的 2 条冒烟断言（搬迁前就存在的覆盖薄弱）；③ `clubFormPts` 的 id 口径可择机改成显式映射（见步骤 9）；④ 顶栏「球队中心」tab 仍指向 `/club`，重定向后高亮落在「球队」tab —— 已接受（给 TopBar 加 `useMyClub()` 会让每个登录用户每次加载多打一次 `/api/me/club`，与省 D1 额度主线相悖）；⑤ 年龄档界不再包含当季 `age_cap`（步骤 11a 的已知代价，等宽箱优先）；⑥ 本机 e2e 的球队页读端点仍是打桩（本地 TOUR_DB `team` 表 schema 陈旧），若将来本地库补到与生产同形，可撤桩改成真端到端；⑦ 运营组左列留白约 150px（步骤 11b 已知取舍）。


## 增量 32 · 球员名口径改造——FC26 派生显示名 + 球衣号归属转移 + 档案页按 fc_id 寻址

**状态**：2026-09-23 完成步骤 1–8（8 个提交），本地全绿（typecheck 三份 / vitest **47 文件 659 例** / build / e2e **11/11**）。**未推送、未部署**（生产迁移仍到 0031），等令。跨仓部分（赛事平台转只读 + 阵容同步）另立增量 33。

**缘起**：用户 m01803「开工」，任务 = 球员名口径改造（显示名取自 FC26 存档）+ 球衣号归属从赛事平台转回本平台 + 球员档案页 URL 改 fc_id + 两系统阵容同步 + D1 读额度优化。基线经两轮重查修订（计划稿假设 HEAD=`466df81`，实测已到 `d759b86` ⇒ 增量 31 球队页已推送部署，本增量编号由 31 改 32、迁移号仍 0032/0033）。

**范围与交付**
- 迁移 `0032_players_display_name_number.sql`：`players` 加 `first_name` / `last_name` / `common_name` / `display_name` / `number` 五列（全 TEXT）。
- `scripts/player-names/`：`derive.mjs`（读 FC26 存档 + 三份远端只读查询，产出落库 SQL）+ `load.mjs`（逐条语句写 D1）+ `README.md`。
- 迁移 `0033_players_name_sort_index.sql`：姓名排序表达式索引（排序键换显示名后同源重建）。
- 端点：`POST /api/club/players/:id/number`（球衣号，仅所属俱乐部教练）；`GET /players/:id` 与 `/transfers`、`/growth` 三个读端点改按 **fc_id** 寻址（内部 id 回落）；列表/详情/roster/市场/谈判/审核/球队页等 11 个携带球员名的面全部出显示名。
- 前端：球员档案页 URL 自动规范化到 fc_id、标题补官方缩写名小字；11 处球员链接统一走 `playerPath()`；合同页签恒有「球衣号」行（教练可改）；阵容表加只读号码列；谈判成约后弹「给新援定号」（可跳过）。

**不做**：动 `players.name` 语义（仍是 FC26db 官方缩写名，导入对齐键仍是 fc_id）、给导入模板换显示名、赛事平台侧改动（属增量 33）、生产数据落库（`load.mjs --remote` 需双开关 + 用户授权）。

**技术路径**
- **① 显示名派生（三源优先级）** —— `commonname 原样 || (名 && 姓 ? 名+' '+姓) || cards.csv 完整人名（同 pid 多行名字矛盾则弃用） || 空`，空交回 SQL 回落 `players.name`。三源：`E:/FC26 LE v26.3.5/player_presets/base_players.csv`（22,348 行 × 149 列，四个文本姓名列**全空**，只有 nameid：`playerid`=0 / `firstnameid`=114 / `lastnameid`=145 / `playerjerseynameid`=146 / `commonnameid`=147）、`E:/FST存档修改器编辑器v1.2.0/config/playernames.txt`（UTF-16LE，41,190 条，max nameid 41,189）、`E:/FC26 LE v26.3.5/player_presets/cards.csv`（24,731 行，法定全名，18,850 个 pid）。**cards 只能兜底不能当主口径**：与赛事系统逐字命中只有 418/570（`Cristiano Ronaldo dos Santos Aveiro` vs tour `Cristiano Ronaldo`、`Li Hao` vs `Hao Li` 语序不同），且 21 个 pid 的多行名字自相矛盾。**不加「补姓」启发式**：俱乐部 149 个 commonname 里 51 人本就是单词（`Ederson`/`Rodrygo`/`Gabriel`/`Antony`/`Marquinhos`），tour 也正是这么写的，补姓会把它们全改坏（`Ederson` → `Ederson Santana de Moraes`）。
- **② 显示名贯通（口径只此一处）** —— 新建 `src/core/player-name.ts`：`sqlDisplayName(table = 'players')` → `COALESCE(${table}.display_name, ${table}.name)`、`rowDisplayName(row)` → `row.display_name ?? row.name`。列表/详情/roster/市场/谈判/审核/球队页转会/结算通知/导入报错文案共 11 个面改用它；**故意不改** `src/worker/players-import.ts`（FC26 官方缩写名是导入对齐键 fc_id 的伴生语义，导入模板里就是它）与 `src/worker/results.ts` 读的 TOUR_DB `player.name`（那是 tour 自己的全名）。列表行同时出 `officialName`（= `players.name`），前端在两者不同时出小字。**搜索必须两列 OR**：`` (`${sqlFold(sqlDisplayName())} LIKE ? ESCAPE '\\' OR ${sqlFold('players.name')} LIKE ? ESCAPE '\\') `` 同一 pattern 推两次 —— 只看显示名则按姓搜不到几百个单词显示名的人（`Ederson`/`Isaac`），只看 `name` 则 `Erling Haaland` 搜不到。
- **③ fc_id 寻址** —— 新建 `src/worker/player-ref.ts`：`firstPlayerByRef<T>(db, columns, ref)` 先 `WHERE fc_id = ?` 点查、未命中再 `WHERE id = ?`。fc_id 空间 19541–279948 与内部 id 1–18301 零重叠，但**不靠区间判断**；两次都是唯一索引点查（实测 `SEARCH players USING COVERING INDEX sqlite_autoindex_players_2 (fc_id=?)` / `USING INTEGER PRIMARY KEY (rowid=?)`），保留 id 回落是因为老分享链接与前端缓存里可能还是内部 id。**写端点一律只收内部 id**（调用方手上有详情载荷的 `id`）。前端新增 `web/src/lib/player-link.ts` 的 `playerPath(p) => /players/${p.fcId ?? p.id}`，11 处链接全走它（散在 11 处手写模板串必漂移）；名册第三段 `COALESCE(fc_id, id)` 与它同源，`RosterEntry.id` 随之改名 `fcId`。
- **④ 迁移 0033（同源表达式索引）** —— 排序键从「折叠的官方缩写名」换成「折叠的显示名」后，`sort=name` 原本就是 37,635 行/次全表扫（`scripts/d1-read-audit/README.md:64` 明写「无索引 + 折叠表达式」，0027 只覆盖 ca/pa/age/market_value、0029 只覆盖 prestige/club/status），所以这不是「让已有索引失效」而是继续裸奔 ⇒ 补 `idx_players_sort_name`。**两个非显然约束**：SQLite **禁止索引表达式里出现限定列名**（`COALESCE(players.display_name, players.name)` 报 `the "." operator prohibited in index expressions`）⇒ 索引侧写非限定名 `COALESCE(display_name, name)`，而限定名查询表达式**仍能命中**（实测 ORDER BY 形状 `SCAN players USING INDEX idx_probe_name_fold`、游标形状 `SEARCH … USING INDEX … (<expr>>?)`），同源性靠 EXPLAIN 锁死而非文本比对；NAME_FOLD 87 项链深贴 D1 上限 100，建索引前用真引擎实测过（WHERE / ORDER BY / 游标三种形状 + CREATE INDEX 全过）。尾列 `id` 是 keyset 游标 `(排序键, id)` 双列比较所需。
- **⑤ 球衣号归属转移** —— 号码原属赛事平台（`whl.player.number`，570 行全有值、纯整数、1–99），本增量搬回本平台：端点校验整数 1–99、同俱乐部不重复（查后写，理由写在注释里：`players` 是全局表，唯一索引只认列与常量、不认关联子查询，做不出「按 club_id 分区唯一」，20 队 / 570 人规模一次点查足够）、`null`/`''` = 清号（正常操作）、写 `audit_log`、`AND club_id = ?` 写闸。**换队/解约即清号**（球衣号是俱乐部的东西，留着旧号会让「同队不重复」在两个队之间打架），`contracts-import` 的认领 UPDATE 同样清。缓存不用手接：`src/lib/cache-policy.ts` 的 `WRITE_SCOPE_PREFIXES` 含 `['/api/club', PUBLIC_SCOPES]`，`POST /api/club/players/:id/number` 自动三 scope 全 purge。
- **⑥ 比赛结果按 fc_id 认人** —— `src/worker/results.ts` 的 `recordAutoXpForMatch` 原先靠 `club_id + name` 等值匹配，而 tour 存完整人名、本库存官方缩写名 ⇒ 两侧写法不同的人会漏。改为先 `WHERE fc_id = ?`（**不按 club_id 过滤** —— 事件归属的是「这个人」，转会后旧比赛仍算他的成长）、`??` 再姓名回落。队名仍按「队名 = 俱乐部名」解（零封要的是当场那支队的防守位置表）。
- **⑦ 落库脚本** —— `derive.mjs` 产出 `out/display_name.sql`（17,470 条 / 959,842 B，每 1,000 行一条 `WITH v(fc,fn,ln,cn,dn) AS (VALUES …) UPDATE … FROM v WHERE players.fc_id = v.fc`）、`out/number.sql`（570 条）、`out/display-names.csv`（审计表）；空值写 NULL 而非空串（否则 `COALESCE` 不回落）。`load.mjs` 按单引号切语句（人名里的分号不会切断、`''` 转义安全）、逐条写临时文件走 `--file`（Windows 命令行放不下 50KB 的 `--command`）、`--dry-run` / `--local` / `--remote --yes-prod`（双开关）。

**裁决**：`players.name` 语义不变、显示处一律 `COALESCE(display_name, name)`；显示名规则 = commonname 优先（不加补姓启发式）；cards.csv 只作兜底；`/players/:id` 的 `:id` 用裸数字 fc_id（内部 id 回落，前端 replace 成规范 URL）；号码 1–99、同队不重复、换队/解约清空；号码明细存基础 ID（增量 30 的 `player_playstyles` 口径不变）；赛事平台球员表转只读（增量 33）。

**分步**（每步一 commit）：1 迁移 0032 + `tests/d1.ts`（`c07c18a`）→ 2 派生脚本（`54a98ef`）→ 3 显示名贯通后端 + 4 fc_id 寻址（`341c7cd`）→ 迁移 0033 + 排序索引锁死测试（`e2d81ed`）→ 5 号码端点与三处 UI（`097cd34`）→ 6 链接改 fcId + 官方名小字 + 旧 id 替换（`6135bbc`）→ 7 results 按 fc_id 归属（`770875b`）→ 8 验收复测 + 文档收口（本节）→ 评审修复（`0e6a524`）。另有 `0dd0784` / `c46d11c` 两个提交是增量 31 的文档收口订正。

**步骤 2 记录（派生实测）**：18,301 人 → 显示名 **17,470**（commonname 2,548 / 名+姓 14,527 / cards 兜底 395 / 空 831），回落 `players.name` 831；**570 名俱乐部球员全部有显示名**（149 / 420 / 1）；球衣号 **570/570** 按 fc_id 归属、归属不一致 **0**。派生不出的 1,236 人缺口全在球员库长尾：base_players.csv 引用了 29,638 个 nameid，其中 1,170 个 > 41,189（FC26 后期补丁新增，本机字典没有），FC25 的 `playernames.csv` 实测 0 命中。570 人里与 tour 逐字不一致 5 例（`Son Heung Min` 语序、`Fornals`、`Abde`、`Cristhian Mosquera`、`Fernandez-Pardo`），是 tour 自己的短名/语序，**后续跨系统同步以 FC26 派生名为准**。

**步骤 8 记录（验收与三处真缺陷）**
- 本地 dev D1（`.wrangler/state/v3/d1`）**缺 0032/0033**（`d1_migrations` 只有 5 行、`players` 无新列）⇒ e2e 首跑 7/11 失败、`/api/players` 500。`npm run db:migrate:local` 会因 `table players already exists` 失败（本地库是手工快照），解法是单跑两个迁移文件 `npx wrangler d1 execute whl-club --local --file=…`。补齐后 e2e **11/11 全绿**。
- **评审发现并逐条实测确认的三个真缺陷（`0e6a524`）**：① `derive.mjs` 产出 `BEGIN;`/`COMMIT;` 而 **D1 拒收 SQL 事务控制语句**（`please use the state.storage.transaction() … instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements`，本地与远端一样），`load.mjs` 逐条发送 ⇒ 第一条就抛错、一条都落不了库（fail-closed，不脏数据）；② `number.sql` 的 CTE 列数不匹配（声明 6 列只给 2 值）；③ `load.mjs` 用 `spawnSync('npx.cmd')`，**Node 24 在 Windows 上直接 `EINVAL`**（`.cmd`/`.bat` 现在必须带 `shell`），改用 `process.execPath` 跑 `node_modules/wrangler/bin/wrangler.js`。另修 `load.mjs` 语句计数器（传的是 `{sql,bytes}` 对象，永远 0）+ 加事务控制语句守卫，`0032` 回滚注释补「先 `DROP INDEX idx_players_sort_name`」（`display_name` 被 0033 引用，不先删索引列删不掉）。
- **落库链路端到端实测**：`--local --numbers` 19 条语句全部执行、**重复执行结果不变**；fc 20801 落成 `display_name='Cristiano Ronaldo'` / `number='7'`（与 tour 一致），不在派生集里的行（fc 999999）五列保持 NULL 未被碰。
- **不可见字符事故**：手打 0033 的索引表达式时静默丢了 5 个不可见字符（长度 1789 vs 应为 1794）⇒ 改用 node 从 `sqlFold()` 生成该行落盘并验证 byte-exact。项目惯例同样反对源码里放原始不可见字符（`tests/players-library.test.ts:607-608` 注释，测试里用 `char(769)`/`char(173)` 构造）。
- **浏览器实测（本地 8791）**：`/players/9501`（内部 id）URL 自动变 `/players/260001`（fc_id）、标题出显示名 + 官方缩写名小字；`display_name` 为 NULL 的人不出小字；球员库列表链接实测走 fc_id；合同页签恒有「球衣号」行；`?name=erling` / `?name=haaland` / `?name=odegaard` 双列搜索都命中且未触发 D1 表达式深度上限。
- **dev server 坑**：反复 `(npx wrangler dev &)` 会留多个 workerd 进程，端口 LISTENING 但请求全挂死（curl 000、日志已 Ready）⇒ 用 PowerShell 按命令行匹配 `wrangler|workerd|miniflare` 全杀后只起一个；`cachedJson` 的 L1 缓存（players scope TTL 1h）在进程内，种完数据必须重启才能看到。

**验收（步骤 1–8 实测）**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **47 文件 / 659 例全绿**（增量 31 基线 46/642 ⇒ +1 文件 / +17 例）；`npm run build` 成功（`web/dist/assets/index-Bco7kOHW.js` **477.77 kB / gzip 150.38 kB**，增量 31 基线 474.57 kB）；`npm run test:e2e` **11/11 通过**（补齐本地迁移后）。变异验证四处均能定向变红：`idx_players_sort_name` 的表达式错一个字符（`'), 'Ó'` → `'), 'O'`）退化成 `TEMP B-TREE`；`results.ts` 的 `WHERE fc_id = ?` 加 `AND 0` ⇒ fc_id 归属用例失败；`transfers.ts` 两处 `number = NULL` 删掉 ⇒ 换队/解约两条用例各失败；球员链接回落顺序反转 ⇒ 新增的 ClubDetail 两条用例失败。

**待办**：① 增量 33（跨仓：赛事平台球员表转只读、四写端点下线、阵容同步、`GET /api/squads`），需单独授权部署；② 生产落库未执行（`load.mjs --remote --yes-prod` 或先推送再跑），故生产目前仍是缩写名 + 无号码；③ 生产迁移 0032/0033 未 apply（推送部署时一次写 ≈ 18,301 行/条，审计要求索引批 ≤3 条/批、分天跑）；④ 831 人派生不出显示名（字典缺号长尾），若要补齐需更新版 FC26 字典；⑤ 赛事平台与本平台 5 人姓名写法不一致，同步时以 FC26 派生名为准（清单在 `scripts/player-names/README.md`）。


## 增量 33 · 名册真源归位——`GET /api/squads` + 赛事平台拉取同步 + 球员写入口下线（跨仓）

**状态**：2026-09-23 完成步骤 9–11（本仓 1 个提交 `aed2f67`，赛事仓 1 个提交 `ffcbc40`），两仓本地全绿。**未推送、未部署**，等令。步骤 12（部署与上线核对）属危险清单，需单独授权。

**缘起**：增量 32 把球衣号的编辑入口搬回本平台（`POST /api/club/players/:id/number`）之后，赛事系统的 `player` 表（`name` + `number`）就成了第二份真源——两个写者互相覆盖。本增量把名册真源收到本平台：本仓出一个只读的全平台一线队名册端点，赛事仓改为按小时拉取同步，并把赛事仓全部球员写入口下线。

**范围与交付（本仓，步骤 9）**
- 新建 `src/worker/routes/squads.ts`，端点 `GET /api/squads`：一次 JOIN 出 20 队 570 人的一线队名册，返回 `{ squads: [{ clubId, clubName, players: [{ fcId, name, number }] }] }`。公开只读，走 `assertPublicRate(c, 'squads')` + `cachedJson('squads:all', ttlForScope('roster', c.env.PUBLIC_CACHE_TTL_MS), loader, { scope: 'roster', env, ctx })`。挂载在 `src/worker/index.ts`（growthRoutes 之后、notificationsRoutes 之前）。
- 口径：`p.club_id IS NOT NULL AND p.status IN ('normal','listed') AND p.fc_id IS NOT NULL`；姓名走 `sqlDisplayName('p')`（与球员库同一口径，`COALESCE(display_name, name)`）；`ORDER BY c.name, p.fc_id`，JS 线性归并成按队分组（**不做 N+1**）。`fc_id` 为空的行不出——赛事系统按 fc_id 认人，没有 fc_id 就落不了地。
- 新增 `tests/squads.test.ts`（2 例）：① 分组与口径（只出 normal/listed、姓名走 display_name 回落、fc_id 为空不出、自由身不在任何队）；② 省额度（整个请求只发 1 条含 `JOIN clubs` 的 SQL，`fx.captured` 长度 = 1）。

**范围与交付（赛事仓，步骤 10–11）**
- 新建 `worker/lib/clubRoster.ts`：`fetchClubSquads(base)` 拉本端点并逐层校验形状（坏数据抛错）；`syncRosters(db, squads, {dryRun})` 三方对账——club 有/tour 无 → INSERT（**以 fcId 当 `player.id`**）、两队不同 → 改 `team_id`、名与号码以 club 为准 UPDATE、club 无/tour 有 → DELETE（被外键拒绝则保留并进 `kept` 报告，逐条 try/catch 才拿得到是哪一行）；`runRosterSync(env)` 为 cron 入口（配置缺失或失败只记日志、不抛）。
- 三条防御：空快照整体跳过；形状坏抛错不写库；**只对快照里出现过的队做删除**（否则一次拉取失败就会清空别队名单）。另加「同一 fcId 出现在两队 ⇒ 抛错」与「未知队整体跳过」。
- 端点 `POST /api/admin/sync-rosters`（`?dryRun=1` 只算不写；非 dryRun 写 `accountAuditStmt` 审计 `action='player.sync_rosters'`）；`wrangler.jsonc` 加 `triggers.crons = ["0 * * * *"]` 与 `vars.CLUB_API_BASE = "https://club.whleague.win"`（**撤掉这一行 = 同步整体跳过**，可作回滚开关）。
- **球员写入口全部下线**：`POST /:id/players`、`POST /:id/players/bulk`、`PATCH /:id/players/:pid`、`DELETE /:id/players/:pid` 四个端点删除，`src/pages/TeamDetail.tsx` 的录入 / 批量导入 / 改名 / 删除 UI 换成只读名单表（附说明：名单由俱乐部平台同步，签约解约定号改号请到俱乐部平台操作）。队级端点（建队 / 批量建队 / 改名 / 删队 / 队徽）全部保留。

**不做**：动 `players.name` 语义（仍是 FC26db 官方缩写名）、给导入模板换显示名、在赛事仓保留任何球员写路径、生产迁移 apply、生产数据落库、部署（全部需单独下令）。

**验收（步骤 9–11 实测）**
- 本仓：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **48 文件 / 661 例全绿**（增量 32 基线 47/659 ⇒ +1 文件 / +2 例）；`npm run build` 成功（`web/dist/assets/index-Bco7kOHW.js` 477.77 kB / gzip 150.38 kB，**与增量 32 逐字同 hash** —— 步骤 9 只加后端路由，前端产物不该变）；`npm run test:e2e` **11/11 通过**。
- 赛事仓：`npm run typecheck` 全清；`npx vitest run` **15 文件 / 142 例通过 + 1 文件跳过**（增量 33 前基线 14 文件 / 121 例 ⇒ +1 文件 / +21 例，新增 `tests/rosterSync.test.ts`）；`npm run build` 成功（`dist/assets/index-B9HQN9LX.js` 442.52 kB / gzip 143.49 kB）。
- 读量：`EXPLAIN QUERY PLAN` 实测 = `SEARCH p USING INDEX idx_players_status (status=?)` + `SEARCH c USING INTEGER PRIMARY KEY (rowid=?)` + `USE TEMP B-TREE FOR ORDER BY`，**无 `SCAN p`**，读约 570 行。
- 变异验证两处定向变红（赛事仓）：空快照守卫加 `&& false` ⇒ 「空快照整体跳过」用例失败；未知队过滤改成不过滤 ⇒ 「快照里的队本仓一支都没有」用例失败。
- 本地实测：`GET /api/squads` 在 dev（8791）返回真实分组数据；赛事仓同步对账的 10 条用例覆盖首次建行 / 稳态零写 / 换队改名改号 / 删除 / 外键拦下 / 空快照 / 未知队 / 同人两队 / dryRun / 空串号码等价 null。

**踩坑（写进测试注释与记忆）**
- **`instrument(sqlite)` 必须记语句的 `run()` 而不是 `prepare()`** —— `syncRosters` 在 dryRun 下照样把语句 prepare 出来，只是从不执行；一开始记 prepare 会让「dryRun 一行不写」用例误报通过。
- 赛事仓 `tsconfig.json` 只 include `src`/`shared`，**tests 不参与 typecheck**；测试写法是 `import app from "../worker/index"`（无扩展名）+ `app.request(...)`，会话用 KV 的 `sess:tok-admin` + Cookie `whl_session=tok-admin`。
- 默认导出改用 `Object.assign(app, { scheduled(...) })` 而不是换一个对象，**保持默认导出仍是那个 Hono 实例** ⇒ 测试里 `app.request(...)` 一行不用改。

**评审补丁（2026-09-23，两仓各一个提交）**
- 本仓 `d84371d`：`tests/squads.test.ts` 的种子行序改成两队 id 交替 + status 交替。原种子恰好是「插入序 = 期望输出序」，把 `ORDER BY c.name, p.fc_id` 整条删掉测试照样绿（rowid 序与 `idx_players_status` 序都会给出刚好正确的分组）——归并是「相邻行同 club_id 才并组」，正确性完全押在那条 ORDER BY 上，测试却无分辨力。改后变异验证：删掉整条 ORDER BY ⇒ 红（`expected [ '曼城', '阿森纳', '曼城' ] to deeply equal [ '曼城', '阿森纳' ]`）；`ORDER BY c.name` 去掉尾列 ⇒ 红（`expected [ '阿森纳', '曼城' ] to deeply equal [ '曼城', '阿森纳' ]`）。
- 赛事仓 `728f523`：`fetchClubSquads` 补两处防线 —— ① `AbortSignal.timeout(10_000)`（原来没有 signal，对方挂住时 cron 的 catch 永不执行，一行日志都没有，observability 也抓不到）；② 快照里某队 `players: []` 直接抛错（原来只挡 `squads.length === 0`，挡不住「快照非空但某队名单空」——该队会被当成 stale 整队删光）。两条各补一条测试并变异验证定向变红（守卫改 `=== -1` ⇒ `promise resolved "[ { clubId: 10, …(2) } ]" instead of rejecting`；去掉 signal ⇒ 用例 5015ms 超时）。另修正 `kept` 的 reason 文案「有比赛事件/伤停引用，保留」→「有比赛事件引用，保留」。
- 复测：本仓 typecheck 三份清 / vitest **48 文件 661 例**（用例数不变，只改 fixture）；赛事仓 typecheck 清 / vitest **15 文件 144 例通过 + 1 文件跳过**（142 → +2）。

**已知后果（评审查出，本轮不改）**
- 没有一线队球员的俱乐部**整个从 `squads` 数组消失**（不是空数组）。因为赛事仓「只对快照里出现过的队做删除」，一个被清空的队其镜像行永远不会被清掉——失败方向是保留陈旧数据，不是丢数据。
- 赛事仓自动删除球员后，`tactic.roster_json` / `tactic_submission.assign_json` 里会留下悬挂的球员 id（JSON 文本无外键），教练下次保存战术时 `validateAssign` 会抛 400「队长与定位球里点到了不属于该球队的球员」。手工删除时代同样存在，属既有后果；要修得动教练子系统，本轮不碰。
- 赛事仓「伤停随球员级联删除」（`injury.player_id ON DELETE CASCADE`）**实际不可达**：伤停必须挂在一条 `match_event` 上，而 `match_event.player_id` 无 `ON DELETE`（NO ACTION）⇒ 有伤停的球员必然删不掉、行进 `kept`。仅当那个事件的球员后来被清空时，伤停与缺阵记录才会随之消失。
- 赛事仓手动同步端点没有 UI，`/api/health` 也不含上次同步时间 ⇒ 每小时静默失败无处发现；`deleted` 计的是尝试数而非 `meta.changes`；分批 batch 无原子性（注释已声明）。

**待办**：① 两仓部署（需单独授权）；② 首次同步前先跑 `POST /api/admin/sync-rosters?dryRun=1` 核对预期（计划预期：号码 0 改动、名字一批被改写、0 增 0 删）；③ 生产迁移 0032/0033 仍未 apply、生产数据未落库（见增量 32 待办）。


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
| 球员库 D1 读消耗的量化与治理（增量 27 步骤 1 原计划：生产 `rows_read` 抽样 + 按 URL 统计重复率与命中率 + 必要时只读统计端点；再据此选「缓存/查询微调 / 静态快照 / 只改前端」） | 增量 28 | **已完成（2026-09-22 上线，Version `7c5b5879`）**——30 形状生产实测（默认浏览一页 18,819 → **56 行**、容量 265 → 89,285 次/日、海捞名单 36,274 → **843**）＋去整表 COUNT（列表契约不再带 `total`）＋两级缓存与代际键 purge＋迁移 `0029`/`0030`；8 个全表扫排序键与姓名查找逐条豁免（报告 §5.5），FTS5 与 `attr:*` 物化子表登记为独立主题。范围 / 14 项裁决 / 分步 / 验收 / 风险见上方「增量 28」节 |
| 16 队队籍回填工件（`scripts/prod-20260919-roster-backfill/01-roster-backfill-16.sql`，444 人幂等 UPDATE，只写队籍不造合同） | 增量 12 后收口 | **已执行**（2026-09-20，444 行；复查全库 assigned 551 = CPU 4 队 107 + 本批 444） |
| S9 窗基线工件（`scripts/prod-20260920-s9-window-baseline/`：直造一条已关季初常规窗 + 62 行 `result_confirmations` 与 50 行 `match_attendance` 的 `window_seq` 0→1） | 生产数据侧 | **已执行**（2026-09-20 经 `--command` 逐条跑：changes 1 / 62 / 50 与期望一致，验收 9 项全中 → `windows_s9=1, w1_closed=1, open_windows=0, rc_one=62, ma_one=50, season_status=preparing`；代价：该窗 ≈117.5m 维护费与死忠演化不会被任何关窗批收取） |
| 20 队（含 CPU）队籍对齐工件（源 `FC Editor…/player_tables/s901` 队壳文件；`scripts/prod-20260920-s9-club-align/`：570 人按队壳对齐，481 条 `UPDATE players SET club_id`（改队 158 + 认领 323），只写队籍一列） | 生产数据侧 | **已于 2026-09-21 执行**（481 语句 / rows_written 962 / touched 481；验收：已对齐 570、剩余差异 0、入籍 874 = 551+323、自由身 17427，逐队人数与预估逐队吻合）；合同批的 84 行异队冲突已归零（16 队 462 行全部可导）；**遗留 304 人（275 人不在联盟世界任何一线队名单 + 29 人所在队在平台不存在）已于 2026-09-21 由 `scripts/prod-20260921-s9-free-leftover/` 释放自由身（`club_id = NULL` + `status = 'free'`）** |
| 16 队合同导入（源 `E:\Downloads\一线队-S9.csv`；`scripts/prod-20260920-s9-contracts/`：生成器 + 462 条带守卫 `INSERT … SELECT` 10 片 + 执行器 `exec-shards.mjs` + 预检/验收/回滚/报告） | 生产数据侧 | **已于 2026-09-21 执行**（先 apply 迁移 0028；10 片 = 462 语句 / changes 462 / rows_written 1386；逐行复核 462 / 命中 462 / 差异 0；验收 11 列全中 —— 462 行全 `import`、formal 399 / trainee 63、`bad_*` 全 0；逐队 16 行与效力年分布（0 赛季 163…2.5 赛季 79）全中；`players` 未被本批改写、6 张守卫表仍 0）。刻度口径 `service_ticks = 当前刻度(1) − 2×效力年`、`protection_ticks = service_ticks + 3`（训练营 NULL）。**未部署增量 25**（本轮无部署令）⇒ 面板侧残留风险见该目录 README §11.8 |
| S9 遗留球员释放自由身（`scripts/prod-20260921-s9-free-leftover/`：304 名「在册但不在联盟世界 20 队名单」者 → `club_id = NULL` + `status = 'free'`，304 条幂等 UPDATE 2 片 + 回滚 + 预检/验收/报告/README） | 生产数据侧 | **已于 2026-09-21 执行**（用户 2026-09-21 裁定口径「clubID改null，status改free」；304 语句 / rows_written 912；验收六列全中：`want_rows` 304 / `still_rostered` 0 / `status_not_free` 0 / `null_club` 17731 / `rostered_now` 570 / `touched` 304，逐队名单回到联盟世界人数） |
| 全部自由身补标 `status='free'`（`scripts/prod-20260921-s9-free-status/`：一条带守卫的批量 UPDATE，把其余 17427 名既存自由身补齐，只写 `status`/`updated_at`） | 生产数据侧 | **已于 2026-09-21 执行**（用户裁决「球员库里只要没在 20 队的 status 都应该是 free」；Rows written 34854 = 17427×2，`touched` 17427；验收七列全中 → 自由身 17731 全 `free`、在册 570 全 `normal`、`bad_free_with_club` 0、守卫表全 0）。现态：在册 570（全 `normal`）/ 自由身 17731（全 `free`） |
| 20 队（含 CPU）能力导入（源 `FC Editor…/player_tables/s901`；`scripts/prod-20260920-s9-abilities/`，口径 **Case B**：只改现值 `ca`/`pa` + `json_set` 合并 34 项能力项与 `RoleID1-5`/`PSID1-15`，**不动 `base_ca`/`$.CA`/`$.PA`/队籍**） | 生产数据侧 | **已于 2026-09-21 执行**（两片 = 200 + 57 条语句 / rows_written 400 + 112 = 512 写；执行前 `--verify` 报差异 257 与语句数一致、执行后 **570 / 570 / 差异 0**；验收六列 `touched 257` / `delta_gt0 254` / `null_core 0` / `gold_rows 35` / `gold_slots 36` / `ca_vs_attr 254`）。涨幅以 delta = `ca`−`base_ca` 形式存在：换版按 delta 继承、解约被剥掉、报名合规停在换版前（口径已用户裁定接受）；`gold_rows/slots` 量的是「范围内持有金徽的行/槽」= 状态数，本批**变更**为 4 行 / 5 槽（原工件把 4/5 写成 SQL 期望，已更正） |
