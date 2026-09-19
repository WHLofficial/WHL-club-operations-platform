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

**球员库首灌（2026-09-18 已执行）**：`E:/Downloads/FC26db20251217_fixed.xlsx` 的 `Base` 表（实际 **18407** 数据行，文档旧记 18408 含表头）+ Growth+ 名单，复用端上归一化代码（`src/core/import.ts` 的 `normalizeImportBatch`，按 1000 行切片，与 `web/src/pages/Admin.tsx` 同口径）离线产 SQL 后 `wrangler d1 execute --file` 逐片直写生产（19 片）；**入库 18301 人**，被校验拦下 30 行（源值缺 `naID`=`#N/A` 与 `FootID`=`Not Found` 两列，本地与在线源均无源可补 → 搁置，生产至今 18301）。工具与报告在 `scripts/players-import/`（`generate-sql.ts` 产片、`overlay-missing.ts` 增量补录、`missing-fields-30.csv` 填值模板、`nation-id-reference.csv` 218 国、`players-import-report.md`），口径见该目录 README。另：主场存量（`scripts/revenue-import/`）16 球场 + 80 设施行同批直写生产；按 `name` 匹配俱乐部的旧脚本 `stadium-import.sql` 已删除（会给 4 支平台无档案球队造 NULL `club_id` 脏行），生产版只剩 `stadium-import-prod.sql`（显式 `club_id`，2026-09-18 执行）。

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

## 外部依赖与待输入

| 依赖 | 影响增量 | 状态 |
|---|---|---|
| 平台 D1 创建（wrangler d1 create whl-club） | 部署（本地 dev 不需要） | 待执行 |
| 平台部署域必须是 .whleague.win 子域（共享 cookie） | 部署 | 待定子域 |
| PlayStyle 图标资产包（`assets/icons/playstyles/{id}.webp`） | 增量 1 球员卡 | 待供给（缺图降级 🥇🥈） |
| 工资帽数值（随赛季大名单） | 增量 2 工资帽 | config 项，不阻塞 |
