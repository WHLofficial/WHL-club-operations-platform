# 球员主动要求续约/涨薪（闹涨薪）设计

- 日期：2026-10-21
- 状态：rev21，P0 主体已拍板（floor、免收 rc_fee、合同变更窗口关闭生效、双版本合同、行内小字、注册工作台双口径/双预检/名单行/窄屏）；**拒绝后果已定稿（rev20 拍板）：S5+S4″ 中等强度——直拒 = 保护期失效 + 全联盟通告 + 「不满」徽章；谈崩/过期 = 申请挂起 + 下窗按通胀公式必再提；累计第 2 次终局升档（§5.4，否决留档含强制挂牌/RC 降档/成长冻结）**；**折价威胁已定稿（rev21 拍板）：本段已有终局（N≥1）的要求按概率携带「不给涨则激活费立即折到 X」，任意档终局兑现、立即生效不等关窗，深度解锁池抽档、托底最低挂牌价（§5.8）——后果集（保护期/折价/徽章/通告）整体改为终局落库即生效，rejection pending 废止；下窗必再提放宽到所有终局**；**经理侧收进合同谈判区（`/market/desk` 签约谈判页签，rev19 owner 指令）**；**rev22：免费续约机会转正（§5.6 定稿）——已实现（v6.62.0，分支 `feat/v6.62.0-renewal-free` 3 提交待 push；测试计划 `docs/test-plans/v6.62.0-renewal-free.md`，变异三靶恰红）**；待实现
- 范围：设计稿，不改代码、不写迁移、不写测试实现
- 相关：`docs/superpowers/specs/2026-10-20-rumor-authenticity-immersion-design.md`（只复用文档纪律，不复用传闻域）
- 技能：domain-modeling、game-economy-designer、brainstorming、grilling、architecture-designer、codebase-design、qa-test-planner、frontend-design、humanizer-zh、code-review-skill
- 视觉定稿进度（visual companion，brainstorm 会话 `2504-1792807839`）：**已定稿** = 阵容页桌面+窄屏（屏 01/03）、注册工作台桌面（屏 31，cap 进卡片 + 帽线 flag + 值格小字）、行内小字写法（`(+1.20)3.70` 桌面 / `3.70(+1.20)` 窄屏第三行）；**未定稿** = 谈判区要求卡（屏 40 是 DeskTab 收件箱首稿，位置已按 rev19 改判 + 含三处过时残留，见 §10.1）、ContractDualView 三态、窄屏注册工作台+超帽确认弹窗（屏 36–39 为迭代尝试）、SideOps 只读态；rev18/19 已把未定稿四块的 UI 规格补到实施级，待新一轮 companion 定稿。

- rev4（m04060）：闹涨薪免收 `rc_fee`；新增 §5.6「普通续约的免费机会（未来）」——每人/每合同一次免费改 RC，不收费、不结束保护期，转会后刷新；用完后再次续约结束保护期，提高 RC 收差额 30%，降低免费。
- rev5（m04098）：所有合同变更（闹涨薪 + 普通续约）**窗口关闭才生效**；关闭前完成的挂牌/激活/转会一律按原违约金；离队则 pending 变更作废。新增 §5.7。
- rev6（m04126）：本队教练可见「当前生效 / 待生效」两版合同；新增 §10.4 的可读性方案、数据契约与状态。
- rev7（m04136）：补球队页（ClubDetail/SquadTab）方案——不新增列，用「current → pending」紧凑标记 + 合同抽屉；访客只见 current；新增 TC-RD-29/30。
- rev8（m04157）：行内箭头太挤，改为「名单只挂 badge；两版合同集中在待生效面板」；新增 `useClubPendingContracts`，roster 只回 `hasPending`；拒绝行内双值/双列/toggle/drawer-only 四种方案。
- rev9（m04176）：补注册工作台（DeskTab）的工资口径——当前窗按 current，cap bar 加待生效投影段；注册校验/扣款不被 pending 改变；新增 TC-RD-31。
- rev10（m04180）：注册工作台不能只画投影段；新增「待生效工资」逐人明细 + current/projected 双合规预检；projected 失败不得静默放行（硬规则阻止，工资项二次确认）。
- rev11（m04186）：注册工作台球员名单行内补 `待生效` badge + 工资/RC 第二行「关窗后」；球队页阵容名单仍只 badge；两套 view model。新增 TC-RD-32。
- rev12（m04192）：补窄屏（≤640/760）——名单卡片化、合同卡上下两段、注册名单第二行保留、面板/抽屉全屏；新增 TC-RD-33。
- rev13（m04198）：取消 badge/上滚/面板；球队页在现有工资/RC 数据下加一行小字「关窗后 ...」，当前值仍是主值；roster 直接带 pending 金额（仅自家）。
- rev16（m04936）：取消工资扣款下限；注册工作台只保留工资帽硬上限，关窗超帽强制拍卖；UI 改为核验项清单。
- rev15（m04824）：窄屏保持新值在前 `3.70(+1.20)`；桌面仍是差额在前 `(+1.20)3.70`。
- rev14（m04434/m04441）：普通续约非免费 30% 改为接受时即时扣、apply 不重复扣；UI 不再写「免费」；窄屏 360px 合同视图 4 列放不下 `(+1.20)3.70`，A 的窄屏形态改为 `.sqc-m` 下方整行第三行。
- rev17（m05621/m05633）：最终拒绝不再提供安抚，改为强制挂牌——价格 `bounds.min`、不可撤、无人出价下一窗续挂；连续 2 窗未卖出是否按 RC 强制离队列入 §14.2 #19 待拍板；新增 TC-RD-34。
- rev18（2026-10-25，本仓会话）：① **owner 澄清「强制挂牌」是建议、非定案**——§5.4 重写为方案空间比较（S1–S6），先推荐 S5+S4（梯度后果 + 保护期失效，rev19 又升级为 S4′），§14.2 新增 #20 待拍板；受牵连的 §0/§1.3/§2.1/§5.3/TC-RD-34 同步改写。② 补齐四块未定稿 UI 的实施级规格：§10.1 五状态/还价（含档位预览与低还价防呆）/拒绝双路径/超帽警示/wageContext 契约/通知模板，并订正屏 40 三处残留（「合同剩 N 季」不存在该字段、「他还价」方向反了、安抚/手动挂牌按钮）；§10.2 SideOps 只读四态与按钮禁用矩阵；§10.4 ContractDualView 三态与 void 可见面澄清；§10.5 超帽确认弹窗与窄屏收口。③ 还价判定时机定为「POST 即时判定」（与签约谈判一致），countered 不作为持久等待态（§5.3）。④ 新增端点 `POST /:id/preview` 与 `wageContext`（§7），TC-RD-35–40（§12）。
- rev19（2026-10-25，owner 两条修正）：① **高 RC 盲区**——owner 点破「经理认为此价格必无人问津就可以肆意拒绝涨薪」：凡依赖买家意愿的后果（挂牌/原价激活）威慑都随 RC 升高归零；当时升级为 S5+S4′（保护期失效 + RC 降档），rev20 又撤（见否决留档）。② **位置**——owner 指令「球员要求涨薪放在合同谈判区」：§10.1 整节从 DeskTab 独立卡改判为 `/market/desk`「签约谈判」页签的对话流卡（v6.40.0 nego 语言，无弹窗、卡内展开），站内信/SideOps 深链 `?tab=negotiations&demand=<id>`；§14.2 新增 #21。`contract_pending_changes` 加 `protection_ticks_new` 列与 `source='rejection'`。
- rev20（2026-10-25，owner grilling 定稿）：拒绝后果**定稿 S5+S4″ 中等强度**——owner 依次否决 RC 降档（「直接违约金降档感觉不合适」+ 补刀「降档连预期工资也跟着降」：expectedWage ∝ RC^0.45，降档会掐断再闹资格并压低谈判锚 = 给经理反向奖励）与成长冻结（「过于硬」：惩罚错位到无决策权的真人球员 + 量级爆仓），并接受 Q1 三件套强度与 Q2 不做自行挂牌权。**直拒 = 保护期失效 + 全联盟通告 + 「不满」徽章**（`transfer_requests.released` 终态、重签/离队摘除；不动价格/成长/资金）；**谈崩/过期 = 申请挂起 + 下窗必再提按通胀公式**（`r=clamp(gap,0.30,0.60)`、`rc_raise=0.25` 顶格——rev19 口述「只抬下限」对 gap 40–60% 人群无效，已修正为一次开满 gap）；通知加 `demand_rejected_public`；TC-RD-34/#20/文案全部按定稿改写。**漏洞扫描（owner 令）**：expired 计入累计终局（「放任过期」原为零成本无限拖延）+ 计数按球员×俱乐部隔离；挂牌驱赶有意不计终局；「假意接受、旧价卖人」登记 §5.7 已知后果（交易页提示 + 球员作废通知，不硬堵）。**术语平民化（owner 令 domain-modeling）**：GLOSSARY 增闹涨薪域 12 条（「他的底线」不叫「底价」、「没谈成」不叫「谈崩」），§2.1 加界面用语列。**同窗一次不变量 + 段口径 + 回原队（owner 裁决）**：同窗闹涨薪/续约二选一（双侧服务端守卫，顺带堵既有重复续约单缺口）；计数只有换队才清零（同队续约不清，堵洗计数循环）；**回原队 = 当作人没走过（owner 三次订正定稿）**——判据是「本窗是否已闹过涨薪」：**B 无纠葛买回**（本窗无 demand 行）可以谈判、按 `renewalRaise` 续约基准跑（首版的前东家判定在此分支复活）、占本窗额度、不计终局；**A 窗内已闹买回**（本窗 demand 行存在）跳过谈判纯回归（工资/RC 按行现值）、原直拒**恢复直拒分支**、其他终局**计一次 expired**（新段计数）；**物理面一律延续**（换队时快照效力/保护期/签约时刻进 transfer 行、买回恢复——堵保护期重开与效力洗解约费两个漏洞）；海捞/训练营不适用。详见 §5.4「回原队」小节与 TC-RD-43。代码事实经 Explore 查证锚定（`ensureNotInFlight` 不查 session、amendment/换队分支语义、`completeTransfer` 作废锚点），详见 §5.4 相关小节与 TC-RD-42/43、#23。
- rev21（2026-10-31，本仓会话，owner 拍板「折价威胁」）：① **新机制 §5.8 折价威胁**——本段已有终局（N≥1）的要求按 `p_threat(N)=0.25/0.50/0.75/1.0` 携带**条件威胁**「这次不给涨，激活费立即折到 X」；深度按**解锁池**均匀抽（N=1→{0.90}、N=2→+{0.85}、N=3→+{0.80}、N≥4→+{0.75}，浅档永在池内、N 只加深不锁定——owner 明确否定「0.9 抽不到」）；X = §5.5 同款网格取整(现 RC × 抽中档)、托底 `listingPriceBounds.min`（`src/core/market-rules.ts:34`）；**任意档终局**（direct/collapse/lowball/expired）兑现、**立即生效不等关窗**；寿命与「不满」徽章同（挂 `transfer_requests.released` 行新列 `discount_fee`），洗地摘除、买回 A 分支恢复、更深兑现覆盖；训练营/无 RC 不适用。② **后果集时点改为终局即生效**——保护期失效/折价/徽章/通告全部当场落库，不再等关窗；rejection pending（`protection_ticks_new` 列与 `source='rejection'`）**废止**，当窗禁续约由「同窗一次」需求行守卫承担；§5.7「关窗生效」收窄为工资/RC 合同列。③ **下窗必再提放宽到所有终局**（含 direct）——坐实 §11.1 生成行原有 p=1.0 写法，§5.3/TC-RD-09 的「可再提/概率提高」模糊表述同步订正（幅度问题随之消失）；经理付费出口 = 接受要求，续约重建保护期在接受、gap 关闭之后才可行。④ **文案三轮订正留档**：折价是**价格状态的立即变化**不是「被立即激活」（激活是要有买家发起的交易事件）；拒绝确认弹窗是事前条件式（「确认后…」）、后果态/通告是事后已然式（「已降为」），不得混用；「关窗起保护期结束」全量改即时口径。⑤ `contract_demands` 加 `discount_threat_fee`；阶梯数值进 config 新键 `demand_threat_rules`；TC-RD-44–48 新增，TC-RD-08/09/34 按新口径改写。
- rev22（2026-10-31，本仓会话，owner 拍板「免费续约转正」）：**§5.6 转正**（随 v6.62.0 实施，迁移 0085 编号与 rev21 折价威胁的实施顺序协调）。brainstorming 对账（§5.6 rev4 原文 × rev18–20 机制 × 现行代码）自洽七处（同窗一次/段计数/闹涨薪不消耗/4.4.10 回滚/余额预检/保护期 NULL 语义/CPU 脚本批）、实现级陷阱三处（contracts upsert 列清单残留旧值；`approveTransferDeal` 无上下文重算费用、豁免必须挂 evidence；A 分支免费列不快照）、owner 拍板四题：① **自动动用**（不设经理勾选——保护期延续对俱乐部纯收益，自动不亏）；② 30% 差额**维持审核通过时扣**（现行流程无独立「接受」时刻）；③ **降价同消耗**（否则「降价白嫖保护期→提价又免费」两次白嫖）；④ **匹配不刷新**（同「同队改 RC 不算转会」口径）。0079 零写入的 pending 级 `free_rc_change` 启用为当次标记（前端 `freeRcChange` 字段现成）。**grilling Q1 已定稿（收口）**：续约收口保护期、免费续约唯一保留——rev21「重建保护期」叙事与 TC-RD-34「保护期重置」按此订正，`protection_ticks_new` 列保留（rejection 使用废止），否决理由留档见 §5.6。TC-RD-49 新增（44–48 已被 rev21 占用）；§16「不改变 createRcChange 行为」补 rev22 例外。

## 0. 一句话结论

把「闹涨薪」做成**常规开窗时由球员发起的涨薪要求事件**：球员按现有 `expectedWage`/`abilityLevel` 算出市场预期，结合合同落差、近 10 场表现、核心度、成长潜力和经纪人档位决定谁更可能提；俱乐部在**合同谈判区（`/market/desk` 签约谈判页签的「球员要求」对话流卡）**进行**与现有谈判相同规则的多轮还价**（最多 3 轮），接受即改 `contracts.wage`。P0 同时做 floor：球员要求把最低违约金提高到 X，接受时同事务改工资 + RC，**不收费**；cap/买断放 P1。**拒绝后果已定稿（rev20，S5+S4″ 中等强度）：直接拒绝 = 保护期失效 + 全联盟通告 + 「不满」徽章——不动价格、不动成长、不动资金；3 轮谈崩/过期 = 转会申请挂起 + 下窗必再提且按通胀公式一次开到市场价；累计第 2 次终局升档**。**折价威胁（rev21）：本段已有终局（N≥1）的要求按概率携带「这次不给涨，激活费立即折到 X」的条件威胁，深度随终局次数解锁（0.90→0.75 解锁池均匀抽）、托底最低挂牌价，任意档终局兑现且立即生效——后果集（保护期失效/折价/徽章/通告）全部在终局落库那一刻生效，只有工资/RC 的合同变更仍等关窗**。P0 不碰合同到期、不碰士气、不碰公开媒体。**联动（rev22 转正）**：普通续约有一次免费改 RC 机会——自动动用、提价免 30% 差额且不收口保护期、转会后刷新（见 §5.6）；闹涨薪不消耗该机会。

## 1. 问题与边界

### 1.1 用户要什么

开窗时，球员可以主动向现俱乐部提出续约/涨薪；俱乐部可以同意、还价或拒绝。目标是让合同、工资、窗口和球员主动性产生可感知的互动，同时不破坏现有转会/续约/财政规则。

### 1.2 现有「续约」不是延长合同期

代码事实：

- `contracts` 的字段是 `id, player_id (UNIQUE), club_id, release_fee, wage, contract_type, source, signed_at, effective_from, protection_ticks, is_active`（`protection_ticks` = 保护期结束的绝对窗数，NULL=无保护期；v6 早期文档误写 `protected_until`，本版订正），**没有合同到期字段**。
- `service_ticks` 是当前合同的服务起点；`src/worker/contract-ticks.ts:5` 用 `0.5 * (closedRegularTicks - service_ticks)` 算服务赛季，不是一个到期日。
- `src/worker/bypass.ts:273` 的「续约（规则 4.4.6 合同期内更改违约金）」是**经理发起**：窗口内、本队球员、`status='normal'`、有含 RC 的现行合同、训练营合同拒绝、新 RC 在边界内；提高 RC 收差额 30%（`:334`），创建同队 `rc_change` 转会（`:345`），审批后 `openNegotiationSession(..., renewalRaise: true)`（`:799`）。
- 所以现有「续约」= 改 RC + 工资重谈，**不是**延长合同年限。本文因此把新功能叫「涨薪要求」/「球员要求新合同」，P0 不承诺「合同到期」。

### 1.3 P0 做与不做

**做**：常规窗生成、收件箱、多轮还价（最多 3 轮，规则同现有谈判）、接受/拒绝、接受后真实工资扣款、**最低违约金 floor（P0，所有有 RC 的正式合同）**、拒绝生成转会申请（后果已定稿 rev20 S5+S4″，§5.4）、**折价威胁（rev21，§5.8）**、3 日截止、审计、UI/文案。

**不做**：合同到期/自由身谈判、球员士气/性格、队友影响、公开声明/媒体（P1）、CPU 可见收件箱（P1）、违约金 cap/买断（P1）、新的工资硬帽。

## 2. 领域模型（domain-modeling）

### 2.1 术语

| 术语 | 定义 | 不是什么 | 界面用语（GLOSSARY 已收口，rev20） |
|---|---|---|---|
| 涨薪要求 | 球员在常规开窗期向现俱乐部提出提高 `contracts.wage` 的事件 | 不是转会报价，不是自由身谈判 | 分组名「球员要求」；一条叫「涨薪要求」 |
| 市场预期 | 现有谈判引擎的 `expectedWage(level, releaseFee)`，不是外部市场价 | 不是其他俱乐部的工资 | 「市场价」（不显示精确值） |
| 要求工资 | 球员本次希望达到的 `wage`（m/半赛季），分阶段靠近市场预期 | 不是 `expectedWage` 本身 | 「他要 3.70m/窗」 |
| 心理底价 | 球员可接受的最低还价；低于它直接拒绝 | 不是公开字段（本队经理可见） | **「他的底线 3.25」**（不用「底价」——与转会区「最低报价」撞义） |
| 最低违约金 floor | 球员要求俱乐部 `release_fee >= rc_floor`（X>当前 RC） | 不是买断 cap，不是转会费 | 「违约金 20→25（固定条款）」（数字自明，不出术语） |
| 还价 | 俱乐部对要求工资的一次反向报价；最多 3 轮 | 不是转会费 | 「还价」 |
| 接受 | 俱乐部同意某一轮工资，原子更新 wage + RC floor，不收费 | 不是签新合同，不走同队转会/二次审批 | 「接受 / 按 3.40 接受」 |
| 拒绝 | 经理明确点「拒绝」（放人表态），或 3 轮未达成的终局 | 不是合同到期不续约 | 「明确放人」（direct 档）/「没谈成」（collapse/expired 档） |
| 转会申请 | 球员要求离队的记录，存续期间该球员禁止续约 | 不是球员已离队，不必然等于挂牌 | 「转会申请挂着」 |
| 不满标记 | 直拒后球员页/球队页对全联盟可见的徽章（`released` 态存续即标记） | 不是士气系统 | 「不满」徽章 |
| 保护期失效 | 直拒三件套之一：`protection_ticks` 置已过（rev21 起当场生效），球员可被按 RC 原价激活挖走 | 不是降价，不是解约 | 「保护期已结束，可按违约金原价激活」 |
| 折价威胁 | rev21：带威胁的要求在终局时把球员激活费立即降到 X（§5.8）；条件兑现件，不是可接受条款 | 不是降价卖人（不动挂牌价），不是拒绝对球员的补偿 | 「这次要是不给涨，他的激活费立即降到 X」 |
| 通胀公式 | 被拒/谈崩过的球员下窗必再提，涨幅 `clamp(gap, 30%, 60%)`、`rc_raise` 顶格 25%——一次开到市场预期 | 不是罚则，是他要得更狠 | 「下窗他必再提，而且一次开到市场价」 |
| 强制挂牌 | 已否决的候选方案（§5.4 留档） | 已作废 | 界面不出现 |
| 常规窗 | `season_windows.is_temporary=0` 的窗口；关窗扣工资 | 不是临时窗 | 「开窗期」 |

### 2.2 关键边界

1. **主体是球员×现俱乐部**，不是买方俱乐部。
2. **P0 改 wage + 最低违约金 floor**：接受时 `wage=target`、`release_fee=rc_floor`，**不收费**；`protection_ticks`（S4 直拒档除外）、`contract_type`、`source` 不变。**不创建同队 `rc_change` 转会、不走二次审批**；复用 `createRcChange` 的 RC 边界，但**不复用 30% 计费**（本功能免收）；抽公共 helper。
3. **工资是真实成本**：`src/worker/window-payroll.ts` 在每个常规窗关窗时扣 Σ `active contracts.wage`；CPU 队跳过；临时窗只扣富人税、不扣工资。
4. **没有球员士气字段**；`satisfaction` 是冠名品牌合同满意度，不是球员情绪。P0 的「闹」只通过事件状态、转会申请、后果（§5.4）和文案表达。
5. **`wage_cap` 已取消扣款下限**：`window-payroll` 不再按 `cap - gap` 补扣；本文不新增硬帽，只保留注册工资帽硬上限（关窗超帽强制拍卖球员）。
6. **窗口关闭才生效（合同列）**：任何 wage/release_fee 变更（闹涨薪接受、普通续约）都先写 pending；`contracts` 的 wage/release_fee 在窗口关闭前不变。**rev21：拒绝后果（保护期失效/折价/徽章/通告）在终局落库那一刻当场生效，不走 pending**；关闭前完成的挂牌/转会按原 `release_fee` 计算；激活按发起时点的保护期/折价状态计价（在途按进价）；球员在关闭前离队则 pending 作废。详见 §5.7 / §5.8。

## 3. 现状流程（只列相关）

### 3.1 窗口

- `src/worker/window-machine.ts:72 openWindow` 把 `season_windows.status` 置 `open`，支持临时窗。
- `src/worker/window-payroll.ts` 在常规窗关闭时结算工资；CPU 队跳过；富人税按余额/球队价值。
- 现有续约在 `src/worker/bypass.ts:297` 有窗口闸：`转会窗口没开，现在不能续约`。

### 3.2 工资与谈判

- `src/worker/negotiation-context.ts`：`wageParamA=0.02`、`B=1.9`、`C=0.45`、`attemptDecay=0.95`、`sigmoidSlope=-9`、`sigmoidMid=0.8`、`wageMin=0.01`、`wageMax=20`、`maxAttempts=3`、`youngBlendAge=25`、`renewalRaise=[0.05,0.15]`。
- `src/worker/negotiation-secret.ts`：`expectedWage(level, releaseFee, a, b, c) = round(a * level**b * releaseFee**c * 100)/100`；`successRate(offered, expected, slope, mid) = 1/(1+exp((slope*(offered/expected-mid))/0.4))`。
- `abilityLevel(ca,pa,age,25)`：年龄 ≤25 时取 `(CA等级 + PA等级)/2`，否则取 CA 等级；等级由 `ratingLevel` 的十档界（60/65/70/75/80/84/87/90/93）决定。
- 示例：CA 85 / PA 90 / 24 岁 → `(7+9)/2=8`；RC 20m → `0.02 * 8^1.9 * 20^0.45 ≈ 4.0m`。不是外部市场价，是现有引擎的公平工资。
- `src/worker/negotiations.ts:115 openNegotiationSession`：`:136` `level=abilityLevel(...)`；`:140` `expectedWage`；`:143` `renewalRaise` 乘 `1+[0.05,0.15]`；写 `negotiation_sessions(transfer_id, ...)`。
- `negotiation_sessions` 绑定 `transfer_id`；本功能 P0 **不复用**它，但复用 `expectedWage`/`successRate`/`attemptDecay`/`maxAttempts` 的规则，保证「与现有谈判完全相同」的体感。

### 3.3 UI

- 经理侧：`web/src/pages/club/DeskTab.tsx:509`「续约与解约」。
- 球员侧：`web/src/pages/player/SideOps.tsx:2` 续约/挂牌/解约。
- 目前没有「球员要求」收件箱，也没有球员主动事件。

## 4. 方案空间（brainstorming）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| A 通知式 | 球员只发提示，经理自己走现有续约 | 改动最小 | 没有闭环，要求没有后果 | 不选 |
| B 二元要求 | 接受/拒绝，无还价 | 简单 | 谈判感弱 | 不选 |
| C 多轮要求 | 要求 + 最多 3 轮还价 + 转会申请 | 与现有谈判同规则，有后果 | 需要新表/新 UI/挂牌联动 | **P0** |
| D 完整复用 negotiation_sessions | 直接复用 transfer-bound session | 代码最少 | 要造假转会/改 transfer_id 语义 | 不选 |
| E 隐藏士气 | 加 morale，要求由低士气触发 | 看似自然 | 全局新系统，难校准 | 不选 |

选择 C：复用工资数学和谈判节奏，但把「要求」建成独立域，不污染转会 session。

## 5. 推荐设计（P0）

### 5.1 谁更可能提要求（真实分布）

不按 CA 排序；用「要求倾向分」`score`，再做确定性抽样：

```
gapScore        = clamp((expected - wage) / max(wage, 0.01), 0, 1)
performanceScore= clamp((avgRating10 - 6.0) / 3.0, 0, 1) * 0.7
                 + clamp(appearances10 / 10, 0, 1) * 0.3
appsScore       = first_team ? clamp(appsLast10 / 10, 0, 1) : 0
rankScore       = first_team ? clamp(1 - (caRankInClub - 1) / max(nFirstTeam - 1, 1), 0.15, 1) : 0.15
posRankScore    = first_team ? clamp(1 - (caRankInPosition - 1) / max(nPosition - 1, 1), 0.15, 1) : 0.15
valueScore      = clamp(wage / max(clubWageMedian, 0.01), 0, 1)
coreScore       = 0.40*appsScore + 0.25*rankScore + 0.20*posRankScore + 0.15*valueScore
potentialScore  = clamp((pa - ca) / max(pa, 1), 0, 1) * 0.6
                 + (age <= 23 ? 0.25 : age <= 25 ? 0.15 : 0)
                 + (is_future_star ? 0.15 : 0)
agentScore      = (agent_tier - 1) / 2   // 1/2/3 -> 0/0.5/1
score           = 0.30*gapScore + 0.25*performanceScore + 0.20*coreScore
                 + 0.15*potentialScore + 0.10*agentScore
p               = clamp(0.04 + 0.84*score**1.3, 0.04, 0.60)
```

- 数据源：`players`（ca/pa/age/growable/is_future_star/agent_tier）、`contracts`（wage/release_fee）、`registrations`（`squad='first_team'`）、近 10 场 `growth_events`（`appearance`/`rating`/`goal`/`assist`）。
- 无近 10 场数据：`performanceScore=0.4`（中性），不直接判 0；不把新援/替补永久排除。
- 核心度不再只看 CA 排名前 11：`appsScore`（近 10 场出场/10）、`rankScore`（队内 CA 排名，排名 >12 仍有 0.15 底）、`posRankScore`（同位置组内 CA 排名，避免 GK/ST 被全队中场淹没）、`valueScore`（工资/队内工资中位数）。`clubWageMedian` 用本队 active 合同工资中位数；无数据时 `valueScore=0.5`、`appsScore=0.3`，不直接判 0。
- 位置组：GK/DEF/MID/FWD；`caRankInPosition` 在同组内排；`nPosition` 是该组 first_team 人数。
- 硬门槛：`wage>0`、`gap>=0.08`、`status='normal'`、`contract_type='formal'`、`expected>=wage`、不在挂牌/转会中、**无进行中签约谈判 session**（`negotiation_sessions.status='active'` 且 `transfers.status='signing'`——与关窗检查同口径，`src/worker/window-machine.ts:331`；续约单进入 signing 后同样占用，见下「同窗一次不变量」）、无 pending/countered 要求、**无在途 `contract_pending_changes`**（ensure 幂等补跑可能在窗中途执行，需排除）；**`transfer_requests` 的 `released` 终态行不挡生成（rev21 明写）**——直拒后下窗照常再生成（p=1.0），新 demand 与存续中的旧 released 行（徽章/折价载体）跨窗共存，`UNIQUE(player_id, club_id, demand_id)` 无冲突。
- 频率：`1 次/球员/窗`；每俱乐部每窗最多 `6` 条；通过哈希的球员用 **PPS 加权无放回抽样**（Efraimidis-Sprakis：`key=-ln(u)/p`，`u=1-seededUnit([season,window,player],21)`，取 key 最小的 6 条；通过 ≤6 全取），**不是按 p 排序硬取 top-6**；同窗唯一键。
- 确定性：`seededUnit([season, windowSeq, player_id], 20) < p`；不随请求变化。
- 只在**常规窗**生成；临时窗不生成（不扣工资，免费涨薪会破坏经济）。

#### 5.1.1 概率分布（生产校准 2026-10-21，凸曲线 + 60% 上限）

生产基线（season 9 window 1）：517 份 active 合同、399 名 normal/formal/wage>0，按 `gap>=8%` 和 pending/intent offer 排除后 **205 名合格、16 队有合格球员、4 队为 0**；队均 12.8 人（6–21）。

线性 `0.08+0.50*score` 的离散度太窄：p10–p90 只有 18.9%–29.7%，队均 3.11，但高分和低分拉不开。改用凸曲线：

```text
p = clamp(0.04 + 0.84*score^1.3, 0.04, 0.60)
```

| score | 0.20 | 0.30 | 0.40 | 0.50 | 0.60 | 0.70 | 0.80 | 1.00 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 单窗 p | 14.4% | 21.6% | 29.5% | 38.1% | 47.2% | 56.8% | 60% | 60% |

生产实测（205 人）：

- p10 15.6%、p50 23.7%、p90 32.4%、最大 45.8%；比线性的 18.9%–29.7% 明显更散。
- 队均 **3.043 条**（中位 2.79、最大 5.99）；当前数据没有球队顶到 6（最高 5.99，刚好不触发），也没有球员触发 60% 上限（最高 score 0.5845 → p 45.8%）。
- 60% 是**未来高 score 球员的 ceiling**，不是当前生产值；score≥0.80 才到 60%，当前最高 0.5845。要让现役第一人摸到 60%，只能把 score 抬到 0.80 或单独加明星档，那会把队均推高到 3.9 左右，不建议。
- 全 20 队口径 2.43（4 队没有合格球员）；每队合格 6–21 人，平均 12.8 人。
- 单球员两窗累计（若仍合格、未被挂牌）：15.6%→28.8%、23.7%→41.8%、32.4%→54.3%、45.8%→70.6%、60%→84.0%。
- 4 队没有合格球员（没有 normal/formal 且 gap≥8% 的合同），不能生成要求；这不是概率问题。要全 20 队都至少 1 条，只能放宽资格（如 gap<8% 或非 first_team），不建议 P0 做。
- 显示集仍用 PPS（`key=-ln(u)/p`，取最小 6），不是 top-6；高 p 入选率更高，但低 p 有非零机会。
- 这是 season 9 window 1 的快照；换季/换窗/球员涨薪后要重跑校准，不能把 3.043 写死。

### 5.2 要求金额

- 市场预期 `expected` 用当前 RC + `abilityLevel` 计算，不乘 `renewalRaise`。
- 单次涨幅 `r = clamp(0.80 * gap, 0.15, 0.50)`；`target = round(wage*(1+r), 2)`；`target = min(target, expected, wageMax=20)`；若 `target <= wage` 不生成。
- `floor = max(round(target*0.90,2), round(wage*1.05,2))`；低于 floor 的还价直接拒绝。
- `raise_pct = round((target-wage)/wage, 4)`。
- 示例：`wage=2.5`、`expected=4.0`，`gap=60%`，本次 `r=48%` → `target=3.70`，一次跨到市场预期的 80%；下个窗口再提到 `4.0`。

### 5.3 生命周期（多轮，规则同现有谈判）

```
pending --经理接受 target--> accepted
pending --经理还价 (round 1..3)--> 即时判定（同请求返回）：
  c >= target --> accepted（按 c）
  floor <= c < target 且判定接受 --> accepted（按 c）
  floor <= c < target 且判定拒绝、round < 3 --> 谈判中（等经理下一轮，回到 pending-式呈现）
  floor <= c < target 且判定拒绝、round = 3 --> rejected（谈崩终局）
  c < floor --> rejected（视为拒绝整条要求）
pending --经理直接拒绝--> rejected（明确放人）
pending/谈判中 --3 日到期或窗口关闭--> expired
rejected --按 §5.4 拍板方案--> 转会申请 + 后果（梯度，见 §5.4）
accepted --窗口关闭且未离队--> applied
accepted --窗口关闭前离队--> void
```

- **判定时机（rev18 定）：POST `/counter` 在同一请求内即时判定并返回结果**，与签约谈判 `offerWage` 的体感一致；`countered` 因此**不是持久等待态**，UI 里没有「等球员考虑」的中间屏——「还价中」在呈现上=「谈判进行中（第 N/3 轮）」的卡内徽标 + 上一轮记录。状态机仍保留 `countered` 值兼容已写入行，但正常流不长期停留。
- 轮数：最多 **3 轮**，与 `maxAttempts=3` 一致；每轮经理报价 `c`，球员按 `successRate(c, target, -9, 0.8)` 判定接受/拒绝；`attemptDecay=0.95` 用于每轮期望衰减（与现有谈判相同）。
- 还价区间：`c ∈ [floor, target]`；`c < floor` 视为最终拒绝（`rejected`）；`c >= target` 直接 `accepted`。**还价只改工资，`rc_floor` 固定；不接受 floor 只能拒绝整条要求。**
- 还价记录：`contract_demand_attempts`，每轮 `round, wage, accepted, created_at`；最多 3 行。
- **两种终局的区分（梯度后果的输入，rev18）**：`rejected.source ∈ {'direct'（经理点拒绝）, 'collapse'（3 轮谈崩）, 'lowball'（还价低于 floor）}`；后果梯度见 §5.4。`lowball` 归入 `collapse` 档还是 `direct` 档随 #20 一起拍板（推荐 `collapse`：经理本意是还价不是放人）。
- 经理直接拒绝：`rejected.source='direct'`，写转会申请。
- 接受：**不直接改 `contracts`**；写 `contract_pending_changes`（source='demand'，wage_new=成交值 c 或 target，release_fee_new=rc_floor，rc_fee=0，status='pending'）；`contract_demands.status='accepted'`、`applied_at=NULL`；同一 batch/事务；窗口关闭时按 §5.7 决定 apply 或 void；失败 409。
- 过期：`expires_at = min(created_at+3 天, 当前窗关闭时间)`；到点 `expired`；不生成转会申请；**下窗必再提（p=1.0）——rev21 订正：所有终局一视同仁（含 direct），原「下窗可再提/被拒过概率提高（幅度随 #20 定）」的模糊表述废止，幅度问题随之消失**。
- 并发：所有状态变更 `WHERE status IN (...)`；影响行数 0 → 409「要求已处理」。
- 审计：`contract_demands` + `contract_demand_attempts` + `transfer_requests` 保留；接受时 wage/RC 都在 audit 里，`rc_fee=0`；拒绝时记 `resolution='rejected'`、`resolved_by`、`rejected_source`。

### 5.4 拒绝的后果：方案空间（rev18 重开，待拍板 #20）

这里的「拒绝」是拒绝本次涨薪要求，不是合同到期不续约（本设计没有合同到期字段）。rev17 曾把「强制挂牌」记为已拍板；owner 已澄清那是**建议而非定案**，本节重开比较。

先摆机制事实（已查证）：

- **保护期**（`contracts.protection_ticks`，绝对窗数、NULL=无）：保护期内**激活费加价**——`src/core/bypass-rules.ts:49`：RC≤20 ×2、>20 ×1.5；出保护期激活 = RC 原价。保护期是挖角（激活）的唯一溢价墙。
- **挂牌**是经理动作：要价区间 `listingPriceBounds`（下限 `min(RC×0.5, 身价×0.5)` 且 ≥1m，上限 1.5×RC）；挂牌期间禁止续约（`bypass.ts` 现行规则）；无人出价窗尾自动下架。
- 文档旧稿把保护期字段误写作 `protected_until`，实际是 `protection_ticks`；§6 数据模型已订正。

**方案比较**（威慑 = 拒绝的真实代价；控制权 = 经理对时机/价格的可逆性；公平风险 = 对联盟实力分布的扭曲；实现 = 相对 P0 主体的增量）：

| 方案 | 做法 | 威慑 | 控制权 | 公平风险 | 实现 | 一致性/自洽 |
|---|---|---|---|---|---|---|
| S1 强制挂牌·最低价（rev17 建议） | 拒绝 → 自动按 `bounds.min` 挂牌，不可撤不可改价，无人出价下一窗续挂直到卖出 | 极强（必卖+最低价） | 零（价格时机全失） | **高**：核心球员半价甩卖，买家盯崩盘捡漏成制度套利 | 大：自动挂牌 service + 失败重试 + 跨窗续挂 ensure + 全部边角 | 挂牌本由经理定价（v6.33.0 标价体系），自动贱卖与之相悖；谈成/必卖二值、梯度断裂 |
| S2 申请挂起·手动挂牌（屏 40 形态） | 拒绝 → 申请 pending 常驻收件箱；经理可选「挂牌」（区间内自定价）；不挂无硬后果 | 弱（拖延零成本） | 全 | 低 | 小 | 自洽差：经理最优解=全不理（3 天过期无代价），要求系统退化为邮件噪音 |
| S3 纯软（冷却+再提） | 拒绝/过期 → 本窗终局，下窗可再提；无申请表、无卡 | 无 | 全 | 无 | 最小（连 transfer_requests 都不要） | P0 完全没有后果面 |
| S4 保护期失效 | 拒绝 → `protection_ticks` 清为已过（同批写 pending、关窗生效），任何队可按 **RC 原价**激活挖走；挂牌仍由经理决定 | 中：悬顶压力持续，但激活低频（QQ 通知+首价窗+审核），非必然；**高 RC 下趋零（盲区，见下段）** | 中：不被迫卖；想留就下窗重谈 | 低：原价激活、无贱卖 | 小：一个字段 + 申请卡展示；自动挂牌链路整段不需要 | 现有规则语言（激活溢价墙），球员「不给钱就把自己暴露给买家」叙事自然 |
| S5 梯度后果（与上述组合） | 区分终局来源：**直接拒绝**（点「拒绝」=明确放人）走硬后果；**3 轮谈崩/过期**（没谈拢，非表态）走软后果 | 分层 | 分层 | 取决于硬后果选谁 | 中（两分支） | 最好：「拒绝」按钮语义就是「你走吧」；谈崩只是「这次没成」 |
| S6 强制挂牌·经理定价+可撤一次 | 拒绝 → 必须限时挂牌、区间自定价、出价前可撤（撤则下窗必提且涨幅上限提高） | 强 | 中 | 低-中 | 最大（时限/撤回/再犯三套机制） | 规则复杂度不适合 P0 |

**高 RC 盲区（owner 2026-10-25 点破）**：凡后果依赖「别的俱乐部来买」的方案（S1/S2/S4 的挂牌与激活路径），威慑都随 RC 升高衰减——经理算准「这价格必无人问津」就可以肆意拒绝。最需要牙齿的群体（高 CA 核心，闹得最凶）恰恰是经理抬高了 RC 的那批人。**rev20 终审（owner 连续否决重惩罚后定调）**：闹涨薪是常规运营事件，后果必须「可感知，但不动价格锚、不动成长、不动资金池」——RC 降档与成长冻结两个候选先后被否（否决理由见下段），硬侧收敛为中等强度三件套（失效 + 通告 + 徽章），盲区残余（高 RC 老将的市场压力弱）诚实接受，由通告、徽章与真人球员积怨兜底。

**已否决的硬后果候选（留档防返潮）**：

- **RC 降档（rev19 曾推荐，rev20 撤）**：① 叙事生硬——RC 是俱乐部资产的价格条款，被拒球员单方面改低没有对应现实机制；② 第三方折价套利——降档价挖人仍是「盯崩盘捡漏」，S1 的病根换个形式回来；③ 代价失衡——接受 = 每窗 +1.20m，拒绝 = RC 25→17 一次性蒸发 8m（RC 100 蒸发 30m，顶十几个赛季涨幅），理性经理从此不敢拒绝，涨薪变勒索机；④ **expectedWage 连锁（owner 补刀）**——`expectedWage ∝ RC^0.45`，降档把预期工资同步拉低 ~15%：gap 门槛可能不再满足（球员被剥夺再闹资格）、未来所有谈判锚被压低（拒绝从零成本变**有奖励**，鼓励经理故意谈崩给球员降价）。
- **成长冻结（rev19 组合件，rev20 撤）**：① 惩罚错位——成长是真人球员玩家的核心玩法，决策者是经理，惩罚落在无决策权的玩家头上；② 量级爆仓——19 岁高潜冻几窗 = 数十点 CA 永久损失，与降档同类的失衡。
- **拒绝罚金**：叙事牵强（拒绝自己的球员为什么给联盟交钱）、土豪免疫。
- **球员自行挂牌权**：给了真人球员自力出口，但挂牌期间禁续约的现有规则会让经理彻底失去挽回通道，且球员定价不可控——P0 不做，死局反馈强烈则 P1 单独立项。

**推荐（rev20 定稿）：S5 + S4″**——梯度后果，中等强度：

1. **直接拒绝**（`rejected.source='direct'`，经理点「明确放人」）→ 三件套，**rev21 起全部在终局落库那一刻生效（不再等关窗）**、不动任何价格（`wage`/`release_fee` 原样）：
   - **保护期失效**：`protection_ticks` **当场**置已过（**不再写 rejection pending**——rev21 废止该 pending，延时职责由即时生效承担、当窗禁续约由「同窗一次」需求行守卫承担），激活溢价（×1.5–2）立即消失，任何队可按 **RC 原价**激活；
   - **全联盟通告**：`demand_rejected_public` **当场**发全部 user club（「XX 已被明确放行：保护期已结束，可按违约金原价激活」；带折价兑现时价格写 X，见 §5.8）；
   - **持续「不满」徽章**：当场可挂——球员页/球队页对全联盟可见的状态徽章（与挂牌中/谈判中同级），重签或离队后摘除——通告是一次性站内信，徽章让状态持续可见。载体 = `transfer_requests` 新终态 `released`（存续即不满标记；重签时置 `resolved`）。
   - 后果句：「确认后保护期立即结束，任何球队都能按违约金原价 25m 激活他；全联盟会收到通告，他挂着『不满』标记，直到离队或重签。」
   - 后悔药（rev21 修订；保护期句按 rev22 收口口径订正）：当窗洗地被「同窗一次」挡住（本窗 demand 行任意状态 → 续约 409，rejection pending 不再承担此责）；下窗他仍合格则**必再提**（p=1.0，见第 2 条）——经理的付费出口 = **接受要求**；接受后 gap 关闭、不再生成。**保护期失效在本俱乐部不可恢复（rev22 grilling Q1 收口定稿）**：续约按 4.4.6 收口保护期、免费续约（§5.6）只保留现状不恢复；后续续约的收益 = 摘徽章与折价（洗地）＋免费通道可用时免 30% 差额；或挂牌卖出——代价真实可见。
2. **谈崩 / 低于 floor / 过期**（`source='collapse'/'lowball'`、`expired`）→ 申请挂起（谈崩/低还价）或不生成（过期），无合同变化；经理可手动挂牌（现有链路、区间自定价）；**下窗必再提且按通胀公式**。**rev21 放宽：direct 档同样必再提——所有终局一视同仁**，堵「直拒后靠概率拖过第二次终局」的缝（ratchet 依赖他会回来；§11.1 生成行原「p=1.0 未分档」的写法就此坐实）。
3. **通胀公式（rev20 修正版，rev19 口述的「只抬下限」对 gap 40–60% 人群无效，已修）**：被拒/谈崩过的球员再生成 demand 时 `r = clamp(gap, 0.30, 0.60)`（普通为 `clamp(0.80×gap, 0.15, 0.50)`），`rc_raise = 0.25` 顶格（普通 5%–25% 按 score）；`target` 仍受 `min(expected, 20)` 封顶。效果：**一次开到市场预期**（普通是跨 80% 留尾巴）；gap ≤ 30% 的球员两种公式都到顶，通胀主要加压中大落差群体。经理激励 = 拖着不谈下次更贵、早接受早省钱。
4. **累计升档（rev20 补洞：expired 也计数）**：同一名球员**累计第 2 次终局**——`rejected` 任意档**或 `expired`**（跨窗合计，任意组合）——时，即使谈崩/过期也升级走直拒三件套。动机：只数 rejected 的话，「放任过期」是最便宜的规避路径（零操作、零申请、零计数、无限拖延），比故意谈崩还省事；把 expired 计入后**「被无视两次 ≈ 被放人」**，经理的全部策略路径收敛为「要么付钱接受、要么最多拖一窗然后吃三件套」。故意谈崩（≥floor 出低价三轮）与 lowball 同理计入，无净收益。**计数口径（rev20 修订：堵「便宜续约洗计数」洞）——只有「转会」才换段清零**：段 = 球员 × 俱乐部（`contract_demands.club_id` 天然分段）；**同队续约/重签不清零**（只关徽章与申请——否则「过期 → 同窗免费续约改 RC 清零 → 再过期」可无限循环，计数永远到不了 2）；**多次转会回到原队 = 每次都是新段**，计数从零、走常规转会签约链路，不背历史包袱（owner 裁决 2026-10-25「按自己续约处理」）。花钱安抚过还继续亏待，下次直接按已累计的档位重罚。
5. **挂牌驱赶不算终局（有意设计）**：经理在闹涨薪期间主动挂牌 → demand 自动 expired（§11.2），**不计入**累计终局——挂牌本身就是给出路（新俱乐部会带新合同谈判），且经理承担被买走风险、无人出价收下架费、挂牌期间禁续约；球员被挂牌 ≠ 被无视。
6. **申请存续与禁续约**：`transfer_requests` 存续期间（`pending`/`listed`）禁普通续约（防谈崩后当窗续约洗地）——**direct 档例外**：后果**当场落库**（rev21，无 rejection pending），禁续约由「同窗一次」需求行守卫自然承担（本窗任意状态 demand → 409），徽章与激活通道持续到重签/离队。
7. `lowball` 归 `collapse` 档，随 #20 已确认。

**同窗一次不变量（rev20，owner 裁决 2026-10-25）**：同一窗口，一名球员与一支俱乐部之间**最多一条合同谈判线**——闹涨薪或续约（改违约金）二选一，先到先占。两侧守卫：

- **续约侧（`createRcChange`，挂 `ensureNotInFlight` 之后）**：① 本窗存在该球员的 `contract_demands` 行（`UNIQUE(player_id, season, window_seq)`，**任意状态**——expired 也占用本窗额度，堵「故意过期后同窗便宜续约安抚」）→ 409「本窗他的合同谈判机会已经用过，下窗再谈」；② 该球员存在未终局签约谈判 session（`active` + `signing`）→ 409（**顺带堵既有缺口**：现状 `ensureNotInFlight` 只查 listings 活跃与 transfers 待审（`bypass.ts:44-64`），续约单进入 signing 后同一球员可再提交第二张续约单——本守卫一并关掉）。
- **闹涨薪侧（ensure 生成门槛）**：见 §5.1 硬门槛——active session 与在途 pending 均排除。
- 竞态：两侧入口都有唯一键/守卫，谁先到谁占，后者 409；无窗口期。
- UI 面：SideOps「续约」在本窗有 demand 行（任意状态）时禁用（§10.2 矩阵补 expired 态）。

**段与作废锚点（rev20，代码事实已查证）**：「球员×俱乐部段」的结束锚点 = `completeTransfer` 的**换队分支**（`src/worker/transfers.ts:210-217` 唯一改 `players.club_id` 处）；**amendment（续约/匹配）分支不换队**（效力、保护期延续，`transfers.ts:258-268`）——与计数口径同构：换队才清零、同队续约不清。**在途 pending 的作废语句挂 `completeTransfer` 批内合同处理段（第 5 项处），只对 `!amendment` 生效**（续约不 void 自己的 pending）。

**回原队按续约处理（rev20 三次修订定稿，owner 精确化：「计终局仅限窗内已闹涨薪的；本窗无谈判的仍可谈判，按续约谈判」）**——「按续约」的真义是**当作人没走过**（amendment 语义）。买回原队（转会/激活入口；海捞与训练营**不适用**，合同已终止/条款固定，走各自常规通道）按「本窗是否已闹过涨薪」分两支：

1. **B 无纠葛买回（本窗无该球员对该俱乐部的 demand 行）→ 可以谈判，按续约谈判跑**：签约谈判按 `renewalRaise: true` 基准（expectedWage × 1.05–1.15——前东家判定挂 `openNegotiationSession`，买方 ∈ 球员历史效力俱乐部即触发）；转会费照付、审核照走；谈成后工资/RC 按谈判结果、`signed_at` = now（真新签）；**占用本窗额度**（同窗一次：此后本窗不能再闹涨薪/续约，demand 侧门槛自动互斥）；不计终局，段计数新段从零。
2. **A 窗内已闹（本窗 demand 行存在，卖出时已终局）→ 跳过谈判纯回归**（本窗额度已耗尽）：无签约谈判环节，工资/RC/合同类型按合同行**现值**带回（别队期间涨幅对球员有效，买方无压价口子）；按本窗 demand 的终局类型分支——**direct（明确放人）→ 恢复直拒分支**：「不满」徽章重挂、全联盟通告重发、保护期失效状态延续（快照恢复值即已过）；**其他（谈崩/过期）→ 买回计一次 expired 终局**（计入**新段**计数——「被卖又被买回 ≈ 被折腾一次」；旧段计数已随段结束不延续，再终局一次即升档三件套）。
3. **物理面一律延续（两种买回共用，堵重锚漏洞）**：普通换队分支会重锚 `service_ticks`（洗解约免费线）与重开保护期（洗直拒后果）——买回不重锚。实现：**换队分支执行时把被覆盖前的 `service_ticks`/`protection_ticks`/`signed_at` 快照进 transfer 行**（新增三列）；买回时**恢复快照**——效力冻结在离开时点、离开期间照常走表（等于从未离开），保护期取离开时的剩余状态，A 分支签约时刻一并回到离开时点（B 分支谈成后以新签时刻覆盖）。快照数据天然完备：所有「离开」都发生在系统运行期（首批导入球员的第一次卖出起就有快照，不存在重建历史问题）。
4. **段计数**：回原队算新段（闹涨薪生成资格按新段常规概率）；B 不计终局，A2 计入新段；direct 的后果恢复不因新段清零——「段」只管生成资格与通胀计数，不管已执行后果的存续。

不推荐 S1 的三条主因不变（贱卖套利 / 剥夺定价权 / 实现面最大）。S4″ 实现面：rejection pending（`protection_ticks_new` 列承载失效）+ 通告模板 + 徽章（`transfer_requests.released` 终态即标记）+ 通胀公式纯函数；无自动挂牌链、无价格变更、无成长耦合。若 owner 仍要挂牌路径，S5+S1-lite（RC 原价、仅 direct 档）可选，但 RC 原价挂牌在高 RC 下同样落入无人问津盲区，且与三件套叠加并无增量。

- 球员在申请期间被交易/解约：`transfer_requests.status='resolved'`，收件箱关闭；pending 变更按 §5.7 void。
- 「连续 2 窗无人出价按 RC 强制离队」仍是独立待拍板项（§14.2 #19，仅 S1/S2 的挂牌路径需要它；S4 无挂牌环节，#19 随之失效）。

### 5.5 最低违约金 floor（P0）

owner 已拍板：P0 做 floor，不做 cap。语义是球员要求俱乐部把 `release_fee` 提高到不低于 `rc_floor` 的承诺；这是「别把我贱卖」的留队型条款，不是买断/离队条款。

- 适用：所有有 active RC 的正式合同；`release_fee<=0`（无 RC）的球员只提工资，不提 floor。
- 金额：`rc_raise = clamp(0.05 + 0.20*score, 0.05, 0.25)`；`raw_floor = max(current_rc, round(current_rc*(1+rc_raise),2))`；`rounded = raw_floor >= 5 ? ceil((raw_floor - 2.5)/5)*5 : ceil(raw_floor - 0.5)`；若 `rounded < current_rc`，再 `+= raw_floor >= 5 ? 5 : 1`，保证不低于当前 RC。即 **5 及以上按 2.5 为中点归低一档；5 以下按 0.5 为中点归低一档到整数**：5–7.5 归 5、7.51–12.5 归 10、12.51–17.5 归 15；≤4.5 归 4、>4.5 归 5，依此同理（2.5 归 2、2.51 归 3）。所有 `rc_floor` 都是整数，不做小数 floor。
- 硬约束：`rc_floor >= current_rc` 永远成立。取整只带来向下偏差：若 `rounded < current_rc`，5 以下 `+1`、5 及以上 `+5`，直到不低于当前 RC。
- **费用：P0 不收费。** 闹涨薪的 `rc_fee` 恒为 0；接受时不查俱乐部余额、不扣款、不生成财务流水。提高 RC 是球员要求的一部分，不是经理发起的付费续约。现有 `createRcChange` 的「提高 RC 收差额 30%」不适用于本功能；未来的普通续约免费机会见 §5.6。
- 固定条件：`rc_floor` 是**接受条件，不是还价维度**。经理可以还价工资，但还价不改变 `rc_floor`；如果经理不接受这个 floor，只能拒绝整条要求（→ 转会申请）。
- 原子性：接受 = 同一事务内 `wage=target`、`release_fee=rc_floor`、写 audit；**不扣费**；不创建同队 `rc_change` 转会、不走二次审批；复用 `createRcChange` 的 RC 边界，但**不复用 30% 计费**。
- 拒绝/过期：不改合同；`rc_fee` 恒 0。
- 示例：当前 RC 20m、score 0.7 → `rc_raise=19%`，`raw_floor=23.8m`，`rc_floor=25m`，接受工资 3.70m；**RC 与工资在窗口关闭后一起生效，不收 1.50m**。当前 RC 2.5m、score 0.6 → `raw_floor=2.93m`，`rc_floor=3m`，不收费。当前 RC 12m、score 0.4 → `raw_floor=13.56m`，`rc_floor=15m`，不收费。
- 边界：任何 `current_rc` 已经是 5 的倍数、且 `raw_floor <= current_rc+2.5` 时，`rc_floor` 回到 `current_rc`，接受时 `release_fee` 不变、仍然不收费；这是“2.5 中点归低一档”的副作用。`current_rc=5` 时就是 `raw_floor<=7.5` 回到 5，`raw_floor>7.5` 才到 10。
- 取整示例：2.4→2、2.5→2、2.6→3、2.93→3、4.2→4、**4.5→4**、**4.51→5**、5.2→5、7.4→5、**7.5→5**、**7.51→10**、12.4→10、**12.5→10**、12.6→15、**17.5→15**、17.6→20、23.8→25。若取整结果低于 current_rc，按档位 +1/+5（例如 current_rc=2.5、raw=2.5 → 3；current_rc=4.2、raw=4.2 → 5；current_rc=7.5、raw=7.5 → 10）。
- P1：cap/买断（球员要求把 RC 降到 X，方便离队）不在 P0；若要支持，`rc_direction='cap'`，需先确认降低 RC 的规则/费用。

### 5.6 普通续约的免费机会（rev22 转正，随 v6.62.0 实施）

owner m04060 的规则（rev4 登记，rev22 拍板转正）：每位球员/每份合同有一次**免费改违约金（RC）续约**机会。rev22 修订一处：提高 RC 的 30% 差额**维持审核通过时扣**（原文「接受续约时即时扣款」作废——现行流程提交→审核→谈判强制成约，没有独立「接受」时刻；`chargeBypassFee` 时点不动）。

- **语义一句话**：`free_rc_change_used = 0` 的合同，下一张普通续约单（`rc_change`）**自动**走免费通道——提价免收差额 30%、**不收口保护期**（`protection_ticks` 保持原值、按原窗数自然到期，不是延长）；apply 成功即置 1。用完后一切维持现状（提价收 30% @审核通过、续约收口保护期）。降价同消耗（拍板 ③——免费通道的实质权益是「不收口保护期」，与方向无关）；训练营合同仍 400（固定条款）；免费机会不改变 RC 边界、`renewalRaise` 谈判基准、同窗一次守卫。
- **字段**：迁移 **0085**（编号以实施时点为准，与 rev21 折价威胁的实施顺序协调）`ALTER TABLE contracts ADD COLUMN free_rc_change_used INTEGER NOT NULL DEFAULT 0`（合同级真源；回滚注释照 0028 模式；`tests/d1.ts` 的 `MIGRATION_FILES` 追加）。0079 已落但零写入的 `contract_pending_changes.free_rc_change`（DEFAULT 0）**启用**为「当次是否走免费通道」标记——前端 `PendingContractView.freeRcChange`（`api.ts`）字段现成，接上渲染。
- **提交侧**（`createRcChange`）：读现行合同 `free_rc_change_used` → `isFree = (used = 0)`；`changeFee = isFree ? 0 : rcChangeFee(old, new)`（免费时余额预检自动跳过）；evidence/payload 增加 `freeRcChange: isFree`；pending INSERT 写 `free_rc_change = isFree`、免费时 `protection_ticks_new = NULL`（列语义「该项不变」，apply 侧 `COALESCE` 现成接住）；非免费维持 `= baseTicks`（4.4.6 收口）。
- **审核侧（豁免真正落点）**：`approveTransferDeal` case 'rc_change' 现用 `rcChangeFee(ev.oldReleaseFee, transfer.fee)` **无上下文重算**——必须从 evidence 读 `freeRcChange`，true 则跳过 `chargeBypassFee`；只改提交侧拦不住审核扣款。evidence 无该字段的历史在途单按非免费（兼容：降价单本就 fee=0）。
- **apply 侧**：`applyPendingContractChanges` 的 `PendingApplyRow` 增加 `free_rc_change`，免费行 apply 时同批 `UPDATE contracts SET free_rc_change_used = 1`；「不做 source 分支」注释同步更新（source 已按 rev21 收窄为 `('demand','renewal')`）。消耗时点 = **apply**：离队 void（`void_reason='left_club'`）与 4.4.10 回滚都发生在 apply 前 ⇒ 天然不消耗；退款循环按 `extra_fee > 0` 过滤自动跳过免费单。
- **contracts 全部写入点清点**：`completeTransfer` 换队分支 `INSERT … ON CONFLICT(player_id) DO UPDATE SET` 逐列枚举，必须加 `free_rc_change_used = excluded.free_rc_change_used`（INSERT 默认 0 ⇒ 换队新合同归零 = 「转会后刷新」；B 分支买回新签同路径归零）；match 即时落库 UPDATE **不动该列**（拍板 ④）；闹涨薪接受 pending（`source='demand'`，`protection_ticks_new=NULL`）apply 不碰该列（**闹涨薪不消耗**，rev4 既定）；管理端建合同走 DEFAULT 0。
- **回原队对账（rev20 机制）**：A 分支买回（纯回归）免费列**不**加进 transfers 快照（快照三列不动）——买回后用合同行现值（通常是别队新签的 0=可用，实际是**多**一次机会而非少；免费机会不是资产，保护期才是且已快照），owner 接受；B 分支买回（新签）走换队 upsert ⇒ 归 0（刷新）。
- **存量兼容**：零回填——历史合同 DEFAULT 0 = 「还没用过」；0085 上线时在途续约单 evidence 无 `freeRcChange` 按非免费，无兼容坑。
- **UI**（§10.2 续约表单）：免费可用时提交入口提示「本次免费：提价不收差额、保护期不变」；已用时维持现状提示（提价收 30%）；pending 投影渲染「本次免费」小字；GLOSSARY 界面用语待 domain-modeling 定稿（不叫「免费次数」裸词）。
- **保护期口径（rev22 grilling Q1 已定稿：收口）**：续约按现行 4.4.6 **收口**保护期（`protection_ticks_new = baseTicks`），免费续约是**唯一**保留保护期的续约（写 NULL）——rev21「续约重建保护期」叙事作废（直拒后的保护期在本俱乐部不可恢复，后悔药出口 = 接受要求或挂牌卖出，§5.4 第 1 条已订正）；TC-RD-34「保护期重置」字样同步订正；`protection_ticks_new` 列保留（rejection 使用废止，renewal 与免费续约仍写该列）。重建口径的否决理由留档：掏空 rev20 直拒「悬顶压力持续」的威慑（保护期失效变一窗限时效果）、免费通道塌缩成打折券、推翻 v6.54.0 已实现语义。
- **TC（§12 增 TC-RD-49）**：首次免费不收口保护期 / 二次收费 + 收口 / 降价同消耗 / 换队与 B 买回刷新 / match 与闹涨薪不消耗 / 二次提价余额不足拒绝（免费时不可达）/ 4.4.10 回滚与离队 void 不消耗 / A 买回用现值 / 审核 evidence 无标记按非免费 / UI 提示。变异验证三靶（按将来最可能重构方式）：approve 侧改回无条件 `rcChangeFee` 重算；upsert 列清单漏加新列；apply 漏置 1。

### 5.7 生效时点：窗口关闭才生效

这是 rev5 的不变式，优先级高于“接受即改合同”的旧稿：

- 所有合同变更（闹涨薪接受、普通续约改 RC）只写 `contract_pending_changes`；`contracts.wage/release_fee/protection_ticks` 在窗口关闭前保持旧值。**rev21 例外与收窄**：拒绝后果里的保护期失效与折价**不在** pending 之列——两者在终局落库那一刻当场生效（§5.4 第 1 条 / §5.8），且都不改 `wage`/`release_fee` 数值，本节「关闭前交易按原 RC」对它们无涉（激活按发起时点状态计价、在途按进价）；`protection_ticks_new` 列与 `source='rejection'` 随之废止，`source` 收窄为 `('demand','renewal')`。
- 关闭结算顺序（固定）：
  1. **先按旧合同结算本窗工资**（`window-payroll` 读旧 `wage`，新 `wage` 下一窗才计费）。
  2. 处理该窗已完成的 `transfer`/`activation`/`forced_auction`/`free_agent` 等交易，全部读旧 `release_fee`。
  3. 对仍在原俱乐部、且该窗没有完成转会的 pending 逐条 apply：写新 wage/release_fee、处理保护期；**不再扣款**——非免费普通续约的 30% 已在接受时即时扣（闹涨薪 `rc_fee=0`）。
  4. 对已离队球员的 pending 置 `void`：demand 置 `void`，不 apply；demand 不扣费；普通续约已扣的 30% 不自动退（默认，owner 可另定），不消耗免费续约机会。

**费用时序测试**：普通续约非免费时，接受时余额扣一次（写 `rc_fee_charged_at`）；apply 不再扣；void 不退；闹涨薪 `rc_fee=0` 且不写流水。
  5. 开下一窗。
- 关闭前完成的任何交易一律按原 `release_fee`；pending 对 `transfer`/`activation` 逻辑不可见。挂牌本身不改合同：关闭前成交按旧 RC；未成交则关闭时 apply，下一窗起用新 RC。
- **已知后果（rev20 漏洞扫描登记）：假意接受、旧价卖人**——接受零成本稳住球员（申请/不满都不会产生），随后在关窗前把人按**旧 RC** 卖出，pending 随离队 void、新合同作废，买家捡了新旧 RC 差价。这是 §5.7 不变量（关窗前交易按原 RC）的副作用，硬堵需破坏不变量，不做；轻修两条：① 挂牌/激活/转会确认页对该球员明示「他有待生效涨薪（违约金 20→25），卖出后新合同作废、按当前违约金 20 成交」（买家知情）；② 卖出时给球员本人发通知「俱乐部接受了你的要求但随后将你出售，新合同作废」（真人积怨可见）。声誉与买家抬价（知道内情的买家会压价？不——买家按旧 RC 反而赚，不会压）之外，经理的真实代价 = 失去球员——与「拒绝后卖人」同价，套利空间仅剩「省了三件套」，登记接受（**2026-10-25 owner 拍板「可接受」，维持登记不硬堵**）。
- 一球员同时最多 1 条 pending；第二条（闹涨薪或普通续约）返回 409，先解决/撤回旧的。
- 通知：接受时「已接受，窗口关闭后生效」；apply 后「已生效」；void 后「因离队未生效」。UI 在关闭前显示旧工资/旧 RC，并标注 pending。

### 5.8 折价威胁（rev21，2026-10-31 owner 拍板）

**语义**：本段已有终局（N≥1）的球员再生成要求时，按概率携带一条**条件威胁**——「这次不给涨，激活费立即折到 X」。三个定位一次说清：它**不是可接受条款**（经理接受的是工资包，威胁只在终局时兑现——可接受路线会让理性经理永远拒绝、接受分支沦为死支），**不是拒绝后果的自动牙**（由要求行携带、按概率掷出，谈判桌上明示——这是球员的筹码，不是系统的罚则），**不参与还价**（与 `rc_floor` 同为固定件，还价只改工资）。填的洞：rev20 三件套的价格侧后果（保护期失效）对保护期已过/无保护期的球员是空转——溢价本来就不存在；折价让「你敢再无视我」对这批球员重新有价格牙。

**触发与执行**：

- 携带威胁的要求以**任意档**终局（direct / collapse / lowball / expired）→ 折价**立即生效**（终局落库那一刻，不等关窗）：该球员激活费降为 X，任何球队可按 X 发起激活。
- 生效面：只对新发起的激活；在途激活按进价（兑现前已发起的激活不被改价）。标准激活费 = `activationFee(RC, protectionTicks, currentTicks)`；生效后实际激活费 = `min(标准激活费, X)`（X 恒低于 RC，min 实际恒取 X，保留作防御；保护期内球员第二档终局时保护期失效与折价同刻生效，min 自动取低）。
- 不碰合同列：RC / 工资 / 保护期数值不变（保护期失效是另一条后果、同样当场生效），不违 §5.7「关窗前交易按原 RC」——折价是激活通道的价格状态，不是合同条款。

**X 的算法**（创建要求时算定；要求与其终局都发生在同窗内、合同列关窗才变，RC/身价无漂移）：

1. `k` = 在已解锁深度池内**均匀抽一档**（池见下）；
2. `X = rcGridRound(current_rc × k)`——取整函数与 §5.5 完全同款（≥5 按 2.5 中点归到 5 的倍数、<5 归整数、中点归低）；
3. 托底：`X = max(X, listingPriceBounds(current_rc, market_value).min)` = `max(1, ceil(min(RC×0.5, 身价×0.5)))`（`src/core/market-rules.ts:34`）——折得再狠也不低于他自己挂牌能挂的底价；
4. 训练营合同（激活固定 5m）与无 RC 合同（`release_fee` NULL/0）不携带威胁。

**解锁池与概率**（数值进 config 注册表新键 `demand_threat_rules`：概率表 + 深度池，逐字段兜底加载，上线前按生产重校准只改 config）：

- 威胁出现概率 `p_threat(N)`：N=1 → 0.25、N=2 → 0.50、N=3 → 0.75、N≥4 → 1.0（单调；「要求折价的概率随次数增大」）。
- 深度池按 N **累积解锁**：N=1 → {0.90}；N=2 → +{0.85}；N=3 → +{0.80}；N≥4 → +{0.75}。**已解锁的浅档永远在池内**（owner 明确：N 增大只是解锁更低的档，不代表 0.90 抽不到了）——经理只知道本次上界（池内最深档），不知道实际抽中哪档。
- 抽签 `seededUnit([demand_id], 23)` 确定性，同 seed 同结果。
- 后续兑现的更深 X **覆盖**旧值（状态随最近一次兑现更新，只升深不回浅）。梯子在 0.75 封顶——再深归 P1 的买断/cap。

**寿命**：与「不满」徽章同寿命——状态挂 `transfer_requests` 的 `released` 行（`discount_fee` 列，NULL=无），直到重签或离队；下窗普通续约洗地时与徽章一并摘除；回原队 A 分支恢复直拒时一并恢复（沿用 TC-RD-43 的快照/恢复语义，`src_protection_ticks` 快照恢复值即已过）。

**文案（定稿，2026-10-31，owner 三轮订正后）**：

- 威胁行（他的气泡追加一行）：「这次要是不给涨，他的激活费立即降到 X——任何球队都能按这个价激活他。」
- 拒绝确认（事前条件式；带威胁时替换价格句）：「明确放他走？确认后他的激活费立即降为 X，保护期立即结束——从那一刻起任何球队都能按这个价激活他；全联盟会收到通告，他挂着『不满』标记直到离队或重签。」（无威胁时去掉折价句、其余同）
- 卡内后果态（事后已然式）：「已放行 · 激活费已降为 X · 保护期已结束 · 任何球队都能按这个价激活他 · 全联盟已收通告 · 『不满』标记直到离队/重签」（无折价时写「可按违约金原价激活」）
- `demand_rejected_public`：「XX 已被明确放行：保护期已结束，可按 X 激活（违约金 X 折）。」（无折价时：「可按违约金原价 25m 激活」）

**表述纪律（owner 两轮订正留档，实现文案必须遵守）**：折价是**价格状态的立即变化**，不是「被立即激活」——激活是要有买家发起、走 QQ 通知 + 首价窗 + 审核的交易事件；拒绝确认弹窗是**事前条件式**（「确认后…立即降为」），后果态与通告是**事后已然式**（「已降为/已结束」），不得混用时态。顺带的机制收益：立即生效意味着折价在窗内有真实时间被买家兑现（QQ 通知 + 首价窗 + 审核的低频节奏在窗内跑得完），不存在「窗内即过期来不及出手」。

**与时点的关系**：本节与 §5.4 第 1 条同属 rev21 口径——后果集（保护期失效 / 折价 / 徽章 / 通告）全部在终局落库那一刻生效；「关窗生效」只适用于工资/RC 的合同变更（§5.7 不变）。

## 6. 数据模型

```sql
CREATE TABLE contract_demands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  window_seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','countered','accepted','rejected','expired','void')),
  current_wage REAL NOT NULL,
  expected_wage REAL NOT NULL,
  target_wage REAL NOT NULL,
  floor_wage REAL NOT NULL,
  raise_pct REAL NOT NULL,
  rc_current REAL NOT NULL DEFAULT 0,
  rc_floor REAL NOT NULL DEFAULT 0,
  rc_fee REAL NOT NULL DEFAULT 0, -- 接受时已扣金额（闹涨薪恒 0）；apply 不重复扣；未来普通续约非免费时 30% 在接受时即时扣
  -- rev21：折价威胁价 X（NULL=本条不带威胁；N≥1 按 demand_threat_rules 概率掷出；任意档终局时按 §5.8 立即兑现；同窗固定）
  discount_threat_fee REAL,
  round INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  reminded_at TEXT NOT NULL DEFAULT '', -- 24h 截止提醒一次性闸（空串=未提醒，同 0050 event_occurrences 模式；rev20 实施补）
  applied_at TEXT,
  void_reason TEXT,
  seed INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (player_id, season, window_seq)
);
CREATE INDEX idx_contract_demands_club_status
  ON contract_demands(club_id, status, expires_at);
CREATE INDEX idx_contract_demands_player
  ON contract_demands(player_id, season, window_seq);

CREATE TABLE contract_pending_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('demand','renewal')),
  demand_id INTEGER,
  wage_new REAL NOT NULL,
  release_fee_new REAL,
  -- rev21：rev19 的 protection_ticks_new 列与 source='rejection' 废止——拒绝后果（保护期失效/折价/徽章/通告）终局当场生效，不再写 pending
  rc_fee REAL NOT NULL DEFAULT 0, -- 接受时已扣；apply 不重复扣
  rc_fee_charged_at TEXT,
  free_rc_change INTEGER NOT NULL DEFAULT 0, -- rev22：启用为「当次是否走免费通道」标记（createRcChange 写入；前端 freeRcChange 渲染）
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','void')),
  effective_window_seq INTEGER NOT NULL,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT
);
CREATE UNIQUE INDEX idx_pending_one_per_player
  ON contract_pending_changes(player_id) WHERE status='pending';
CREATE INDEX idx_pending_club_status
  ON contract_pending_changes(club_id, status, effective_window_seq);

CREATE TABLE contract_demand_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demand_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  wage REAL NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (demand_id, round)
);

CREATE TABLE transfer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  demand_id INTEGER,
  -- 终局来源（§5.4 梯度）：direct=经理明确放人（走硬后果）；collapse=3 轮谈崩；lowball=还价低于 floor
  source TEXT NOT NULL CHECK (source IN ('direct','collapse','lowball')),
  listing_id INTEGER,          -- 仅经理手动挂牌后回填（软档）；未挂牌为 NULL
  last_listing_window_seq INTEGER,
  -- rev21：released 行携带的折价激活价 X（NULL=无；存续即生效，重签/离队摘除；洗地/买回恢复随徽章；更深兑现覆盖）
  discount_fee REAL,
  -- pending=谈崩档挂起 / listed=已手动挂牌 / released=直拒档后果已执行（存续即「不满」徽章标记，重签置 resolved）/ resolved=关闭
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','listed','released','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE (player_id, club_id, demand_id)
);
```

- 不新增 `contract_until`；不新增士气表。
- **既有表增列（rev20）**：`transfers` 加 `src_service_ticks`/`src_protection_ticks`/`src_signed_at` 三列（换队分支覆盖合同行前快照；买回原队时恢复，见 §5.4「回原队」）；`contracts` 不加列（`protection_ticks` 已有）。
- **既有表增列/废止（rev21）**：`contract_demands` 加 `discount_threat_fee`（威胁价，NULL=不带）；`transfer_requests` 加 `discount_fee`（兑现后的折价激活价，挂 released 行）；`contract_pending_changes.protection_ticks_new` 与 `source='rejection'` **废止**。折价阶梯数值进 config 注册表新键 `demand_threat_rules`（概率表 + 深度池，逐字段兜底加载）。激活计价点（`src/worker/activations.ts` 的 askPrice 与 `src/worker/routes/market.ts` 的 `activationFee` 展示字段）各多查一行：该球员存续中的 `released` 行 `discount_fee`，取 `min(标准, X)`。
- **既有表增列（rev22）**：`contracts` 加 `free_rc_change_used INTEGER NOT NULL DEFAULT 0`（免费续约机会，合同级真源；迁移 0085 编号以实施时点为准，与 rev21 协调）。rev21「`protection_ticks_new` 列废止」订正为「rejection 对该列的使用废止」——renewal 收口路径（`transfers.ts` 成约批）仍写该列，列本体保留；悬挂点见 §5.6。
- `seed` 存生成概率的确定性种子；还价判定用 `seededUnit([demand_id, round], 21)`。
- `expires_at` 由生成时计算：`min(created_at+3d, window_close)`。
- 若 P1 做 cap/买断：`contract_demands` 加 `demand_kind/rc_direction/rc_target`，或单独 `contract_demand_rc` 表；不要塞 JSON。

## 7. API 与权限

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/club/contract-demands` | `requireCoach`，本俱乐部 | 当前窗待处理（新/谈判中）+ 已接受待生效 + 最近 expired/rejected；含球员、当前/目标/涨幅、剩余时间、轮次与逐轮记录、`wageContext`（见下） |
| POST | `/api/club/contract-demands/:id/accept` | 本俱乐部 | 接受 target + rc_floor；写 pending 变更，不收费 |
| POST | `/api/club/contract-demands/:id/counter` | 本俱乐部 | `{ wage }`；只改工资，rc_floor 固定；最多 3 轮；**同请求即时判定并返回结果**（§5.3） |
| POST | `/api/club/contract-demands/:id/preview` | 本俱乐部 | `{ wage }` → `{ forecast }`；零副作用（不落库/不耗轮次/不审计）；`forecast` 按四档 0.2/0.5/0.8 量化 `successRate(wage, target)`：「成功率很高/过半/偏低/很低」——与 v6.40.0 谈判 preview 同一套词与边界，判定基准不同（这里对 target、谈判对 eff） |
| POST | `/api/club/contract-demands/:id/reject` | 本俱乐部 | 直接拒绝（`source='direct'`）；后果按 §5.4 拍板方案，**当场落库生效（rev21：保护期失效/徽章/通告/折价兑现，不等关窗）** |
| GET | `/api/club/transfer-requests` | 本俱乐部 | pending/listed 申请；含 `source`、后果状态（按拍板方案） |

- **`wageContext`（GET 响应字段，rev18 新增）**：`{ currentTotal, pendingDelta, wageCap }`——当前窗 Σ active wage、已接受未生效增量、工资帽。接受确认弹窗的超帽警示由它驱动（§10.1）；只对本队教练返回。
- **通知模板（rev18 补、rev20 增 `demand_rejected_public`，进 `src/worker/notify.ts`，跨仓白名单待确认——与 `window_signals` 同批问）**：`demand_created`（开窗生成时给俱乐部：「张三提出了涨薪要求」）、`demand_deadline`（剩 24h 未处理，`reminded_at` 式一次性闸，参照 v6.11.0 `event_deadline`）、`demand_resolved`（接受/拒绝结果；拒绝时同步发球员本人视角「你的转会申请已提交」）、**`demand_rejected_public`（全联盟通告，S4″ 三件套之一；rev21 起**终局当场**发出、不再等关窗**，第 2 次终局升档时同样发）：发全部 user club「XX 已被明确放行：保护期已结束，可按违约金原价 25m 激活」，带折价兑现时写「可按 X 激活（违约金 X 折）」（§5.8）**。
- 所有端点校验 `club_id` 属于当前教练；不跨俱乐部。
- 不提供公开端点；不把 `expected_wage`/`floor_wage` 暴露给非本俱乐部（本队教练可见 floor——还价防呆需要）。
- 不接受客户端传 `player_id`/`target_wage`；只接受 demand id + counter wage。
- 拒绝后果的执行（保护期失效/折价状态写入/手动挂牌入口）由 reject 与申请卡内部处理，不提供独立的公开写端点（手动挂牌走现有 `/api/market/listings`）。
- 限流：写端点走现有教练写限流；GET 按俱乐部缓存 5s。
- 错误：404/403/409（已处理/窗口已关/工资或 RC 越界/超过 3 轮）；本功能不收费，不存在余额不足分支。

## 8. 触发实现

```ts
// 伪代码，不是实现
async function ensureContractDemands(env, season, windowSeq) {
  const win = await loadWindow(season, windowSeq)
  if (!win || win.is_temporary) return
  const clubs = await listUserClubs() // active, non-CPU
  for (const club of clubs) {
    const rows = await loadEligiblePlayers(club.id) // normal, formal, no pending, not listed
    const passed = rows
      .map(p => ({ p, ...scoreDemand(p) }))
      .filter(x => x.eligible)
    const picks = weightedSamplePPS(passed, 6) // key=-ln(1-u)/p，取最小 6
    for (const x of picks) {
      await insertDemandIfAbsent(x) // INSERT OR IGNORE
    }
  }
}
```

- 生成时算 `rc_floor/rc_fee`：`current_rc=contract.release_fee`；`rc_raise=clamp(0.05+0.20*score,0.05,0.25)`；`rc_floor=max(current_rc, round(current_rc*(1+rc_raise),2))`；`rc_fee=0`（闹涨薪免收）；无 RC 则两者为 0，退化为 wage-only。写入 demand 后不随还价变化。
- 放在 `openWindow` 成功后调用；同时给 `scheduledTick` 一个「当前窗未 ensure 则补一次」的幂等入口。
- **关闭结算**：新增 `applyPendingContractChanges(season, windowSeq)`，在窗口关闭的 worker 流程里、交易结算之后、开下一窗之前调用；顺序见 §5.7。必须幂等（`status='pending'` 条件更新）；关窗与交易同 tick 时先交易后 apply。
- 不做每 tick 全量扫描；每窗一次 + 幂等补漏。
- 查询批量化：一次取俱乐部球员 + 合同 + `registrations` + 近 10 场 `growth_events` 聚合；避免 N+1；每个俱乐部最多 6 条写入。
- CPU 俱乐部 P0 跳过；P1 可静默自动接受/拒绝，不写收件箱。
- 过期清理：`scheduledTick`/开窗时 `UPDATE contract_demands SET status='expired' WHERE status IN ('pending','countered') AND expires_at<=now`；同时关闭对应 `transfer_requests`（若有）？

## 9. 经济设计（game-economy-designer）

### 9.1 成本

- 工资按常规窗扣：`window-payroll` 的 Σ `active contracts.wage`；接受要求后，下一个常规窗开始增加 `target - current`。
- **生效时点**：窗口关闭前 `contracts` 不变；本窗工资按旧 `wage` 结算，新 `wage` 从下一窗开始计费；关闭前交易按旧 `release_fee`（见 §5.7）。
- **注册工作台**：当前窗工资校验按 `current`；cap bar 画 `current + Σ pending delta` 的待生效投影段，并逐人列出待生效工资；projected 再跑一遍合规预检，失败不得静默放行（§10.5）。
- 赛季成本按 2 个常规窗估算：`2 * (target - current)`；若实际常规窗数不同，以窗口表为准。
- 富人税：工资上升 → 余额/球队价值比变化，可能进入富人税；这是现有 sink。
- 工资帽是硬上限：关窗时超过工资帽，必须强制拍卖球员降到帽下；注册工作台仍显示当前/待生效和超帽预警，提交时可确认，真正处理在关窗。球员/合同页仍用「每窗工资」「赛季工资」。

### 9.2 数值边界

- 单次涨幅 15%–50%；`target <= expected`；`floor >= current*1.05`；RC floor 5%–25%，`rc_fee=0`。
- 触发门槛 `gap >= 8%`；`gap` 超过 100% 按 50% 上限，仍分阶段到 expected。
- 频率：1 次/球员/窗；硬上限 6 条/队/窗；生产校准均值 3.04 条/队/窗（16 队；4 队无合格）；挂牌中不再生成；**曾终局（任意档，rev21 起含 direct）的球员下窗必再提（p=1.0，通胀公式）；`released` 终态行不挡生成（§5.1）**。
- 截止：3 天，且不晚于窗口关闭；过期不生成转会申请。
- 反刷：同窗唯一、每俱乐部 6 条、pending 去重、3 轮上限；接受后不能同窗再提；拒绝不退款。
- 通胀观察：接受率、平均涨幅、工资总额/俱乐部、富人税俱乐部数；平均涨幅 >15% 或工资总额环比 >20% 时先降 `p`/上限。

### 9.3 示例

| 当前工资 | expected | gap | 本次涨幅 | target | 每窗增加 | 赛季约增加 |
|---:|---:|---:|---:|---:|---:|---:|
| 2.5 | 4.0 | 60% | 48% | 3.70 | +1.20 | +2.40 |
| 8.0 | 9.0 | 12.5% | 15% | 9.00 | +1.00 | +2.00 |
| 3.0 | 3.2 | 6.7% | 不触发 | — | — | — |

（单位 m/半赛季；示例只验证公式。）

### 9.4 最低违约金 floor

- 与 §5.5 同一公式；**闹涨薪不收费**，`rc_fee=0`，不查余额、不扣款；接受确认/审计里明确写 0。
- 经济含义：提高 RC 是球员换涨薪时给出的留队承诺，P0 免费；本功能的成本只体现在工资增量。普通续约的免费机会与 30% 差额见 §5.6，不适用于闹涨薪。
- 反刷：`rc_floor` 同窗固定，不接受还价；拒绝/过期不收费；接受后同一球员同窗不能再提。
- 数值观察：`rc_fee` 不再作为成本指标；看工资增量、floor 接受率、拒绝后的挂牌转化。

## 10. UI 与文案（frontend-design + humanizer-zh）

### 10.1 经理侧：合同谈判区的「球员要求」卡（rev19：owner 指令「球员要求涨薪放在合同谈判区」）

**位置（rev19 定）**：`/market/desk` **「签约谈判」页签**（`NegotiationsSection.tsx`）顶部新增「球员要求」分组——转会谈判 session 卡之上、同页签内。理由：闹涨薪本质是合同谈判，与 v6.40.0 对话式谈判桌同一家；球队工作台（DeskTab）**不再**加卡，只留入口——`demand_created` 站内信与 SideOps 只读块的链接都深链 `?tab=negotiations&demand=<id>`（对齐 v6.40.0 `?offer=` 深链先例），落地后对应卡高亮 `.is-target`。空态（分组无卡时不渲染分组头）：「这个窗口没有球员提出要求。」。分组头右侧 pill `当前 66.60 · 待生效 +1.50`（= `wageContext`，已接受未生效计入 delta）。

**卡形态 = 对话流卡（v6.40.0 `SessionCard`/`nego-stream` 语言，不做独立弹窗）**：

- 卡头：球员名（链接）+ badge「涨薪要求」+ 轮次徽标「第 1/3 轮 · 剩 N 轮」+ 截止「10-27 14:00 到期」+ 副行（位置 · 年龄 · CA · **效力 N 赛季**——系统无合同期限字段，屏 40 的「合同剩 2 季」已订正）。
- 对话流（`nego-stream` 气泡，系统行与人物气泡）：开场系统行「他提出了涨薪要求」→ 他的气泡：要求工资 3.70m/窗（当前 2.50）、违约金 20→25（固定条款，无 RC 要求的球员不写此行）→ **带折价威胁时追加一行（rev21 §5.8）：「这次要是不给涨，他的激活费立即降到 X——任何球队都能按这个价激活他。」**→ 你的每次还价气泡 + 他的当场回应（接受/「没谈拢，还差得远」/第 3 轮拒绝）。**球员不再还价**（屏 40「他还价 3.40」方向已订正：经理还价、球员判定）。
- 底部动作栏（活跃态）：`接受 / 还价 / 拒绝` 三键（ nego 动作栏样式：接受=主、拒绝=danger ghost）。
- 收口态（v6.40.0「这一单已经了结」式，卡不消失、动作栏换状态行）：见下表。

**五状态**（排序 = 剩余时间升序 → 谈判中 → 已接受 → 已拒绝/过期尾部；>2 条过期折叠计数行）：

| 状态 | 呈现 | 动作 |
|---|---|---|
| 新要求（pending） | 对话流首屏（开场气泡）+ 动作栏 | 接受（主按钮）/ 还价 / 拒绝 |
| 谈判中（round 2–3） | 流内已有一轮以上还价与回应；轮次徽标随轮更新 | 同上（「接受」= 按他要价 target 全额接受） |
| 已接受（accepted） | 状态行「已接受，待生效 · 关窗后 3.70 / 25」+ 链接去球员页双版本合同卡 | 无按钮 |
| 已拒绝（rejected） | 状态行变后果态（S4″ 已拍板）；直拒=「已放行 · 激活费已降为 X（无折价时：可按违约金原价 25m 激活）· 保护期已结束 · 全联盟已收通告，他挂着『不满』标记，直到离队或重签」，谈崩=「转会申请挂着 · 下窗他还会再提，而且开价更狠」+ 挂牌入口 | 后果态展示 / 挂牌入口（软档） |
| 已过期（expired） | 尾部弱化「这个窗口没有谈成 · 下个窗口他还会再提，而且开价更狠」（rev21：必再提） | 无按钮 |

- 卡内副行：位置 · 年龄 · CA · **效力 N 赛季**（`service_ticks` 换算；屏 40 写「合同剩 2 季」是错的——本系统没有合同期限字段，已订正）。
- 谈判中的「他还价」方向错误订正（屏 40 残留）：本流程**经理还价、球员判定**，球员不再还价；徽标写「上轮你出 3.20 未成」。

**还价（卡内就地展开，非弹窗；先例 = v6.40.0 谈判桌动作栏 + OfferStep 卡内输入）**：点「还价」后动作栏下方展开输入区——

- 摘要行：`他要 3.70 · 当前 2.50 · 违约金 20→25（固定条款，不参与还价）` + 轮次提示「第 2 次还价，共 3 次」。
- 输入行：工资（`step 0.01`，两位小数）+ 一条 `floor → target` 区间条（斜纹底），当前输入值在条上打点；`c >= target` 时提示「等于他的要价，会直接成交」。
- **档位预览**：输入 350ms 防抖调 `preview` 端点，四档文案（成功率很高/过半/偏低/很低）+ 危险后缀与 v6.40.0 谈判同词；`role="status" aria-live="polite"`。
- **低还价防呆**：`c < floor` 时送出按钮置灰 + 红字「低于 3.33 他会视为拒绝整条要求并提交转会申请；要拒绝请点『拒绝』」——服务端仍保留 `<floor → rejected` 语义（API 兼容），UI 把「低还价=拒绝」收敛到显式拒绝入口，防止误触终局。
- 送出后判定即时返回：接受 → 对话流追加「他接受了 3.40」+ 卡转已收口；拒绝 → 流内他的回应气泡 + 轮次徽标更新；轮次用尽 → 流内终局回应 + 卡转后果态。

**接受确认（卡内两段式，先例 = 训练营两段式）**：点「接受」展开确认摘要：行 1 工资 `2.50 → 3.70m/窗`、行 2 每赛季 `+2.40m`、行 3 违约金 `20 → 25m`、行 4 费用 `0`、行 5 生效 `关窗后；关窗前交易按原违约金`；**超帽警示行（`wageContext` 驱动）**：接受后 projected 超帽时显示「当前 66.60m/窗，另有待生效 +1.50m；这笔 +1.20m，接受后 69.30m/窗，超工资帽 1.30m。关窗时需强制拍卖球员」并把按钮降为 danger「仍然接受」；未超帽不渲染。注脚「接受后不会立刻扣钱；工资和违约金在关窗时一起生效。」

**拒绝确认（卡内两段式，先例 = nego 拒绝改造；文案为事前条件式——rev21）**：直接拒绝为「明确放他走？确认后保护期立即结束——任何球队都能按违约金原价 25m 激活他；全联盟会收到通告，他挂着『不满』标记直到离队或重签。」；**带折价威胁时（§5.8）价格句替换为「确认后他的激活费立即降为 X，保护期立即结束——从那一刻起任何球队都能按这个价激活他」**；3 轮谈崩的终局回应为「3 轮没谈成。他会提交转会申请，他的激活费也已降为 X（无威胁时不写此句）；下个窗口他还会再提，而且直接开到市场价。」；按钮「再想想 / 明确放人（danger）」。屏 40 的「先安抚」按钮为 rev17 前残留，已删（无安抚通道）。

**后果态（原转会申请卡，rev19 并入要求卡收口行 + 页签顶部后果摘要行；事后已然式——rev21）**：S4″ 直拒档卡内状态行「已放行 · 激活费已降为 X（无折价时：可按违约金原价激活）· 保护期已结束 · 全联盟已收通告 · 『不满』标记直到离队/重签」；谈崩档「转会申请挂着 · 下窗他会再提且开价更狠」+ **「挂牌」入口**（经理手动，打开现有挂牌表单、区间定价；屏 40 的「一键挂牌」保留为该入口，但改为打开挂牌面板而非自动最低价）；已挂上 →「已挂牌 · 要价 X · 等出价」（链接转会区）。

**注册工作台**（仍在球队工作台，不随谈判区搬）：工资 stat/cap bar 用「当前 + 待生效投影」双口径，并**逐人列出待生效工资**（§10.5）；名单 pending 行加第二行「待生效」；当前窗校验按 current，projected 做第二遍合规预检；projected 失败不得静默放行。
- 响应式：≤760 转会台清单本就卡片行（v6.40.0 已做），要求卡同形；卡内展开区天然无弹窗；复用卡体系与现有色板（terracotta 主按钮 / warn 琥珀提示 / danger 红），不新增色板。

### 10.2 球员侧 SideOps 只读态（rev18 实施级）

P0 球员侧**零操作**：不提供球员在客户端发起/回应要求的入口，服务端窗口事件生成、引擎代球员判定。SideOps 只做状态同步。

**位置**：`SideOps.tsx` 顶部（`.side-closed-note` 同款视觉语言的只读块 `.side-demand-note`），位于「报价设置」之前。渲染条件：本队教练视角（现 SideOps 已渲染的场景）查看该球员时；非教练不渲染（球员本人的知情面走站内信 `demand_resolved`，不占 SideOps）。

**四态文案**（教练视角，主语用球员名）：

| demand 状态 | 文案 |
|---|---|
| 新要求/谈判中 | 「张三已提出涨薪要求（3.70m/窗 · 违约金提到 25m），到 <截止时间> 为止。[去谈判桌处理 →]」（链 `/market/desk?tab=negotiations&demand=<id>`）；谈判中补「上轮你出 3.20 未成，还剩 N 轮」 |
| 已接受 | 「已接受 · 关窗后生效（3.70m/窗 · 违约金 25）。[看双版本合同 →]」 |
| 已拒绝 | S4″ 已定：「已明确放行：保护期已结束、全联盟已收通告，挂着『不满』标记」或「转会申请挂着 · 下窗他会再提且开价更狠」 |
| 已过期 | 「这个窗口没有谈成。放任不理也算一次——再有下次，他就当被放人了。」 |

**按钮禁用矩阵（防 409 与防呆；rev20 补同窗一次不变量）**：**本窗存在 demand 行（任意状态，含已过期）→「续约」一律禁用**，title「本窗他的合同谈判机会已经用过，下窗再谈」（服务端 `createRcChange` 同守卫 409，UI 只是前置）；分状态说明——

- demand 存续（新/谈判中）：「续约」禁用，title「他正在闹涨薪，先处理收件箱里的要求」（否则经理续约写 pending 会撞每人一条 pending 的 409）；挂牌/解约保留，展开面板内加一句「挂牌/解约会作废他的涨薪要求」（挂牌时 demand 自动 expired，§11.2）。
- 已接受（pending 变更在途）：「续约」禁用（二次 pending 409），title「已有待生效合同变更」；挂牌/解约保留并提示「关窗前离队会让新合同作废」。
- 已拒绝（申请存续）：「续约」禁用（§5.4 共同硬约束：申请期间禁续约）；挂牌/解约照常。
- 不改「报价设置」区（意图标记与要求无冲突）。

### 10.3 文案

- 接受后：「已接受；新合同在窗口关闭后生效。」
- 窗口关闭后：「新合同已生效。本窗工资仍按旧值结算，下一窗按新数字扣。」
- 待生效期间：「待生效 · 窗口关闭后」；不写「pending」。
- 还价：「俱乐部还价 X；你还有 N 轮。」
- 最终拒绝（direct 档，S4″ 已拍板；即时口径——rev21）：「谈判结束。他提交了转会申请；保护期已结束——任何球队都能按违约金原价激活他（带折价兑现时：激活费已降为 X），全联盟都会知道，他挂着『不满』标记直到离队或重签。」
- 谈崩终局（collapse 档）：「3 轮没谈成。他提交了转会申请，下个窗口还会再提。」
- 手动挂牌（软档入口）：「已按你的要价挂牌，等出价。」（S1 自动挂牌则为「已按最低合规价挂牌。不能撤单，等出价。」）
- 过期：「这个窗口没有谈成。下个窗口他还会再提。」（rev21：必再提）
- 禁止「系统认为」「AI 建议」等出戏词。

### 10.4 两版合同：当前生效 vs 待生效（仅本队教练）

**目标**：教练同时看到当前合同和待生效版本，但不会误以为有两份合同；一眼知道哪份现在有效、哪份何时生效、哪些条款变了、关闭前交易按哪版 RC。

**方案比较（brainstorming）**

- A 两张并列卡：拒绝。视觉等权，像两份合同，先读哪张不清楚。
- B 只在合同卡上加一句「将变为」：拒绝。看不到完整待生效版本，审计/对比差。
- C **单卡双列对比表 + 顶部时间箭头**：选 C。当前=实线/主色，待生效=虚线/琥珀；变化行高亮，未变行降权。
- D 纯时间线：拒绝。叙事好但字段扫描差；只借用顶部箭头。

**桌面线框**

```text
┌ 合同 · 本队教练可见 ──────────────────────────────────────┐
│ 当前生效 ───────────────▶ 待生效（窗口关闭后）              │
│                            [球员要求] [本窗关闭时]           │
├──────────┬──────────────┬───────────────────────────────┤
│ 项目     │ 当前生效     │ 待生效（窗口关闭后）            │
│ 工资     │ 2.50m/半赛季 │ 3.70m   +1.20m                 │
│ 违约金   │ 20m          │ 25m     +5m                     │
│ 保护期   │ 至第 9 窗    │ 不变                            │
│ 合同类型 │ 正式         │ 不变                            │
└──────────┴──────────────┴───────────────────────────────┘
  ⚠ 关闭前交易仍按当前违约金 20m；待生效 25m 不适用于本窗。
```

**移动端**

```text
当前生效
工资 2.50m/半赛季 · 违约金 20m · 保护期至第 9 窗
        ↓ 窗口关闭后
待生效 [球员要求]
工资 3.70m（+1.20m） · 违约金 25m（+5m）
保护期 不变
⚠ 关闭前交易按当前违约金 20m
```

**可读性规则**

1. **先结论后细节**：标题写「合同（1 份，待生效 1 版）」，不写「两份合同」；顶部先给「窗口关闭后生效」和「关闭前交易仍按当前 RC」。
2. **当前在左/上，待生效在右/下**；中间箭头写「窗口关闭后」。阅读顺序永远是当前 → 待生效。
3. **变化行高亮，未变行降权**：工资/违约金/保护期逐行显示；变化的行给 `+/-` 与「0 费用/不变」；未变的行保留值但用弱化色，不能隐藏。
4. **术语**：只用「当前生效」「待生效（窗口关闭后）」，禁止「旧合同/新合同」（暗示两份合同）、禁止「pending」。
5. **交易确认必须显示旧 RC**：挂牌成交/激活/转会确认框显示「当前违约金 20m」并加一句「待生效 25m 不适用于本窗交易」；确认按钮不因 pending 改变。
6. **离队 void**：待生效列替换为一行「因离队未生效」，不保留幽灵待生效；历史里可查，但不在当前合同卡占位。
7. **关闭瞬间**：toast「新合同已生效」；当前列更新，待生效列消失；本窗工资仍按旧值结算。
8. **权限**：只有本队教练看到待生效；公开页/其他俱乐部只返回当前合同，不泄漏 pending 的工资/RC。
9. **可访问性**：用 `<table>` + 行标题（移动端 `dl`）；每行 `aria-label`「当前工资 2.50m；待生效工资 3.70m，窗口关闭后生效」；变化不只靠颜色，必须带文字/图标；键盘可达；对比度沿用现有色板。
10. **响应式**：≥1024px 双列表；<640px 上下堆叠；不出现横向滚动；长合同名/金额换行不截断。窄屏细则见下方「窄屏（≤640/760）」。
11. **窄屏（≤760 球队页名单 / ≤640 合同与注册）**：
    - 球队页名单沿用现有 ≤760 卡片视图：姓名行只挂 `待生效` badge，工资/RC 仍只显示 current，不出现箭头/第二行；点 badge 滚到上方面板对应卡。
    - 待生效面板 ≤640 从两列表格变成「一条一张卡」，字段用 `<dl>`：
      ```
      张三 · 球员要求 · 本窗关闭时生效
      当前生效
      工资 2.50 · 违约金 20 · 保护期 第 9 窗
              ↓ 窗口关闭后
      待生效
      工资 (+1.20)3.70 · 违约金 (+5)25 · 保护期 不变
      ⚠ 关闭前交易按当前违约金 20m
      [查看合同]
      ```
    - 合同抽屉/球员页 ≤640 改成全屏 bottom sheet：顶部 sticky「当前 → 关窗后」+ 旧 RC 警告；内容单列；关闭按钮 44px；焦点陷阱；ESC/返回。
    - 金额换行、长名字两行、触控目标 ≥44px；badge 是按钮；屏幕阅读器顺序固定为 标题 → 生效时点 → 当前 → 待生效 → 旧 RC 警告。
    - 窄屏不隐藏待生效第二行/面板；如果空间不够，折叠的是“长尾条款/未变行”，不是 pending 本身。

**状态**

| 状态 | 合同卡 | 收件箱 |
|---|---|---|
| 无 pending | 只显示当前列 | 无 |
| 已接受，窗口未关（**pending 态**） | 双列；待生效列琥珀/terracotta-tint 底 + 变化行 `+Δ`；顶部时间箭头「当前生效 →（本窗关闭后）→ 待生效」；底部 ⚠「关窗前交易仍按当前违约金 20m」 | 要求卡折叠为「已接受，待生效」 |
| 关闭 apply（**已生效态**） | 单列新值；**生效后首个窗口内**顶部一行小字「新合同已生效 · 本窗工资已按旧值 2.50m 结算」，下一窗起消失 | 记录「已生效」 |
| 关闭前离队（**void 态**） | 合同卡对教练不再可见（球员已离队）——「因离队未生效」**不在合同卡呈现** | 历史行「已接受 → 因离队未生效」+ 通知 |
| 普通续约 pending | 双列；来源 badge「普通续约」；免费/收费文案 | 无收件箱卡 |
| 二次 pending | 阻止；409「已有待生效合同变更」 | 不出现双 pending |

- **void 可见面澄清（rev18）**：`void` 的判定发生在关窗批（球员已离队），此时本队教练既看不到该球员的合同卡、也看不到阵容行——它的真实呈现面是**收件箱历史行 + 站内信**（「球员已转会，待生效变更作废」）。§10.4 早期把「待生效=因离队未生效」画在合同卡里是不成立的，已订正；阵容页行内小字在离队瞬间自然消失（人不在名单里）。
- **窄屏堆叠（rev18 定稿口径）**：≤640 合同卡从双列表变上下两块——上块「当前生效」（实线卡）→ 中间箭头「窗口关闭后」→ 下块「待生效」（terracotta-tint 底 + badge「球员要求」），变化字段带 `(+1.20)` 后缀、未变行降权保留；⚠ 行收尾。与 §10.4 早期「移动端」线框一致，正式定稿进本轮视觉稿。

**数据契约**

```ts
interface ContractView {
  current: {
    wage: number; releaseFee: number; protectionTicks: number | null;
    contractType: 'formal' | 'trainee'; source: string;
  };
  pending: null | {
    status: 'pending';
    source: 'demand' | 'renewal';
    wage: number; releaseFee: number; protectionTicks: number | null;
    effectiveWindowSeq: number; effectiveAt: string;
    rcFee: number; freeRcChange: boolean;
  };
}
```

- 复用现有本队合同查询/DTO，只加 `pending`；不新增公开端点。
- `pending` 是同一份合同的投影，不是第二份合同；`GET` 只对本队教练返回。
- 失效：accept/apply/void/关窗后清缓存；公开页永远只读 `current`。

**球队页面（ClubDetail / SquadTab）**

rev13 推翻 badge + 上滚 + 面板：badge 只告诉“有”，要看数值还得滚/点开，没必要。改成**在现有合同数据旁边加小字**，当前和关窗后出现在同一格，扫表即可完成。

- **球队价值（m05061）**：球队页头部和注册工作台都显示；`teamValue = 资金余额 + Σ active 合同违约金`（与 `src/worker/window-payroll.ts` 富人税同口径）；两处同值：头部放在资金余额旁，注册工作台放在工资下方、CA 分类行最右（绿色右边）；窄屏“核验一行”中在工资下方/绿右边；显示 `580.00/700m` 这类值，上限 700m。超过 700 仍按现有富人税 5% 在关窗扣，不新增注册硬上限。

```text
阵容名单
球员    工资                    违约金
张三    2.50                   20
李四    3.10                   18

待生效  工资 (+1.20)3.70 · 违约金 (+5)25
        工资 (+0.30)3.40
王五    2.80                   22
```

- 工资/违约金仍是 current 主值；pending 行在数值下方加一行小字：11px、warning/amber，**只写(差额)新值**（`(+1.20)3.70`、`(+5)25`），不写「关窗后」，不写「免费」。**没有箭头、没有 badge、没有面板、没有点击/滚动。**
- 只有 pending 行多一行；非 pending 行不变；行高自适应。
- 排序/筛选/工资总额/平均工资仍按 current；小字不参与统计。
- 顶部可留一行静态汇总「2 份待生效 · 工资 +1.80m/窗」，纯提示，不提供跳转/滚动。
- 访客/其他俱乐部：无小字、无汇总，只有 current。
- 窄屏：同一张卡片里 current 一行 + 小字一行；小字可换行、不截断；无横向滚动；没有可点 badge，触控不受影响。
- 边界：void/close 后小字消失或变成新 current；RC-only pending 只加 RC 小字；wage-only 只加工资小字；一球员最多 1 条 pending。
- **数据边界（codebase-design）**：`useClubRoster` 对自家教练的行 DTO 增加 `pendingWage`/`pendingReleaseFee`（可空）+ `pendingSource`；访客不返回。`ContractCell` 只负责格式化 current + 可选小字；完整合同仍在球员页 `ContractDualView`。不再有 `ContractBadge`/`ContractPendingPanel`。
- **为什么不是 badge/面板**：badge 需要上滚或点开才看到数值，属于多一步；小字把“当前/待生效”放在同一决策点，且不新增列、不新增导航。
- **窄屏 360px 的硬限制**：合同视图 `.sqc-m` 是 4 列 1fr（约 68px/格），`(+1.20)3.70` 放不进单格；窄屏不做值格内联，改为 `.sqc-m` 下方**整行第三行**：`待生效 工资 3.70(+1.20) · 违约金 25(+5)`；行内不出现「关窗后/免费」。这是窄屏唯一不横向溢出的形态，桌面仍用值格内联。
- **格式约定**：桌面 pending 小字用 `(+1.20)3.70`（差额在前，方便和当前值比）；窄屏整行第三行用 `3.70(+1.20)`（新值在前，读起来像完整合同值）。两边不混用。
- **测试**：TC-RD-29 行内小字/访客；TC-RD-30 交易旧 RC + 小字不误读；TC-RD-33 窄屏。

**组件**

- `ContractCell`：阵容/注册名单共用；入参 `current`、可选 `pending`、`unit`；渲染主值 + 小字，不处理业务状态。
- `ContractDualView`：球员页/DeskTab 的完整双列；`viewerRole !== 'club_coach'` 时只渲染 current。
- `ContractComparisonTable`：完整双列的行标题/变化行；只被 `ContractDualView` 使用。
- `ContractSmallPending`：小字的格式化（`(+1.20)3.70`、`(+5)25`、`不变`）；**不追加「免费」**，免费信息只在确认/悬浮说明。
- 位置：`DeskTab.tsx` 合同块、`SideOps.tsx` 本队球员页、`SquadTab.tsx`/注册名单的 `ContractCell`；公开页/访客用 `ContractSummary`（current only）。
- 不新增色板；pending 小字用现有 warning/amber，当前值保持主色。

### 10.5 注册工作台的工资口径与合规预检（DeskTab）

只画 cap bar 的投影段不够。教练在提交注册前必须能逐人看到“谁待生效、涨多少、关窗后工资多少、合规预检过不过”，否则 pending 会变成隐性合规风险。工作台必须把待生效工资**写出来**，不能只藏在球员页合同卡里。

**工资区**

```text
注册 · 工作台
工资  66.60m/窗        待生效 68.10m（+1.50）   [待生效 2]
当前窗实线 ────────────────  待生效斜纹 ────

待生效工资
张三  2.50 → (+1.20)3.70  [球员要求] [本窗关闭时生效]  [查看]
李四  3.10 → 3.40（+0.30）  [普通续约] [本窗关闭时生效]  [查看]

合规预检
当前窗：通过
关窗时：请确认 —— 预计超工资帽 0.10m/窗（当前 66.60m/窗，待生效 68.10m/窗，工资帽 68.00m/窗），需强制拍卖球员
[提交注册]（会提示：2 份合同待生效）
```

- 主值 = `Σ active contracts.wage`（current），cap bar 实线段；注册校验/本窗扣款按它。
- **cap bar 横轴（动态放大）**：`axisMin = max(0, min(current, projected) - 2)`，`axisMax = max(工资帽, current, projected) + 2`；不固定 0，也不在 UI 标起点。右侧留 2m 给帽线标签；帽线标签放在线左侧，避免和右端/投影撞车。
- **工资帽线用醒目色**：4px 红色（`--bad`），无光晕，线左侧标签「工资帽 68.00」（不贴右端）；当前金色、斜纹待生效、超帽段红色。
- 副值 = `current + Σ(pending.wage-current)`，斜纹段 + `待生效 +X/窗`；**逐人明细**列出球员、`当前 → 待生效 (+Δ)`、来源（球员要求/普通续约）、生效时点；最多 3 条 + 查看全部。
- 名单行内只挂 `待生效` badge，不重复金额；明细、面板、阵容页三处同源，不出现数量/金额不一致。
- 关窗 apply 后 current 变成 projected，明细/投影段消失；void 后 projected 回退。

**注册工作台球员名单**

工作台名单和球队页阵容名单不是同一种读法：球队页是扫阵容，行内只挂 badge；注册工作台是合规/审计，pending 行必须把工资/RC 的第二行写出来。

- 当前工资是主值；pending 行在工资格下方加第二行 `待生效 (+1.20)3.70`，不替换主值、不用箭头。
- 不再挂可点 badge；pending 由工资/RC 格第二行「待生效」直接表达；RC 列若存在，pending RC 同样第二行 `(+5)25`；只有 RC 变更（工资不变）时只显示 RC 第二行，工资格不加。
- 非 pending 行不渲染第二行/badge；只有 pending 行多一行，行高不变太多。
- 表头加 `仅看待生效` 筛选 + 计数 `2`；排序、工资总额、平均工资仍按 current；筛选不改变统计口径。
- 行点开合同卡（不是 badge 点击）；第二行有 `aria-label`「当前工资 2.50；待生效 3.70，加 1.20」。
- 窄屏卡片：工资/RC 格下第二行；不横向滚动。
- 数据：注册名单 DTO 增加 `hasPending` + `pendingWage`/`pendingReleaseFee`（仅本队教练）；球队页 roster 仍只 `hasPending`；两套 view model，避免一个组件按角色塞字段。
- 边界：void/close 后第二行消失或变成新 current；RC-only pending 不改工资总额，但 badge/RC 行仍显示；一球员最多 1 条 pending。

**合规预检（current / projected 双跑）**

- 当前窗：按 current 跑现有注册规则（人数、门将、CA 梯度、工资帽等），与今天一致。
- 待生效：按 projected 再跑一遍，显示 `待生效预检：通过 / 需确认 / 不通过`；失败项逐条列出。
- 提交：
  - current 不通过 → 按现有规则阻止。
  - current 通过、projected 不通过 → **不得静默放行**：硬规则（人数/门将/CA/工资帽等）直接阻止；工资项先显示差异和原因并二次确认；**P0 注册工资帽是硬上限，关窗时超帽触发强制拍卖球员，不是软预算；`wage_cap` 已取消扣款下限，只作为注册工资帽，不要混用**。
  - current/projected 都通过 → 正常提交。

**超帽确认弹窗（rev18 补，未画过）**：projected 超帽时点「提交注册名单」弹确认——桌面居中 `.modal-mask/.modal-card`，≤760 底部抽屉。内容五件：

1. 标题「关窗后将超过工资帽」+ 副行「当前窗合规；问题出在待生效合同」。
2. 数字行：`当前 66.60 → 关窗后 68.10 / 帽 68.00 · 超 0.10`（超的数额 danger 红）。
3. 驱动明细：逐条列出把 projected 顶过帽的待生效合同（球员 · `+Δ` · 来源），最多 3 条 + 查看全部。
4. 后果句：「关窗时必须强制拍卖球员降到帽下；拍卖收入与降幅由系统按现行规则处理。」
5. 动作：「去处理」（关弹窗、滚到待生效明细/名单，主路径）+「仍要提交」（danger，二次击确认；提交的是**当前窗合规**的名单，超帽留给关窗）。

- 弹窗不阻止提交（当前窗本身合规），它保证「知道后果仍提交」是显式选择；硬规则失败（人数/门将/CA）不走这个弹窗，直接阻止。
- 窄屏提交按钮 sticky 底部时，同一弹窗从底部滑出（复用 `useOverlayShell`），按钮排布上下堆叠、触控目标 ≥44px。
- 修正路径：关窗前把待生效球员交易/激活走（pending void，projected 回退），或调整注册/谈判；明细行给「去处理」入口。不能“先提交、关窗后再说”。
- 状态：pending 只涨工资（target≥current），不会改变当前工资总额；但 projected 会改变工资总额/预算判断，所以必须显示。
- 测试 TC-RD-31：逐人明细；current/projected 双预检；projected 工资失败二次确认、硬规则阻止；关窗/void 后重算；访客/无 pending 不渲染。

**窄屏（≤640px）**

- 统计 2×2；CA/价值一行：`🔴 初始≥90 2/2 · 🔴+🟡 初始≥87 4/4 · 🟢 可成长 6/6 · 球队价值 580/700m`，保留 emoji、去掉前面的红黄绿小色块；球队价值在绿右边/工资下方；帽线标签放条下方；筛选用横向 chip；名单卡片第三行可见；不横向滚动。
- 名单从表格变卡片，每条最多 3 行：
  ```
  张三  [待生效]
  当前  工资 2.50 · 违约金 20
  3.70(+1.20) · 25(+5)
  ```
  非 pending 行只有前两行；pending 第三行必须在卡内可见，不能折叠/横滑。
- 顶部工资双值改两行：`当前 66.60m/窗` / `待生效 68.10m（+1.50）`；cap bar 横向全宽，斜纹段保留；横轴动态放大，工资帽红线置顶。
- `仅看待生效` 变成可换行 chip 组，不横向滚动；合规预检「当前窗/待生效」上下堆叠；提交按钮 sticky 底部，带 projected 警告，点击前二次确认。
- 待生效工资明细最多 2 条 + 查看全部；每条 3 行：名字/来源/生效时点、当前→待生效、去处理。
- 375px 测试；不横向滚动；不隐藏 pending 第二行（合规必须可见）。

## 11. 状态机与边界

### 11.1 允许的转移

| 当前 | 动作 | 下一个 | 校验 |
|---|---|---|---|
| pending | accept | accepted | 窗口 open；合同 active；wage/release_fee 与 current 一致 |
| pending | counter（即时判定） | accepted / 谈判中 / rejected | c∈[floor,target] 判定；c<floor 视为终局；round<3（§5.3） |
| pending | reject | rejected（source=direct） | 生成 transfer_request + 后果**当场落库**（rev21：保护期失效/徽章/通告/折价兑现，不等关窗） |
| pending/谈判中 | expires | expired | 3 天/关窗；不生成申请 |
| accepted/rejected/expired | 任意 | 不变 | 409 |
| transfer_request(pending) | 经理手动挂牌 | listed | 走现有挂牌端点与区间定价（S2/S5 软档；S1 为自动 bounds.min） |
| transfer_request 存续 | 球员被交易/解约 | resolved | 收件箱关闭；pending 变更按 §5.7 void |
| 下窗 ensure | 曾 rejected/expired 且仍合格 | 再生成 demand | p=1.0 必再提（**rev21：含 direct，任意终局**）；按通胀公式 `r=clamp(gap,0.30,0.60)`、`rc_raise=0.25`（§5.4 已定） |

### 11.2 最坏情况

- 同一球员同窗重复 ensure：唯一键 + `INSERT OR IGNORE`。
- 两个教练同时接受/还价：`WHERE status IN (...)` + 影响行数 0 → 409。
- 接受时工资/RC 已被另一流程改动：`WHERE wage=current_wage AND release_fee=rc_current`；失败回滚/409。
- 窗口关闭与接受并发：以窗口状态为准；关窗后拒绝写。
- 3 天到期与还价并发：`WHERE expires_at>now`；过期 409。
- 球员被挂牌/转会中：生成时排除；已生成的 pending 在球员进入挂牌/转会流程时自动 expired（**不计累计终局**——挂牌是给出路，见 §5.4 第 5 条）。
- 直拒不再写 rejection pending（rev21）：后果当场落库，与在途 pending 无碰撞面；保留「在途 pending 时拒绝 409」防御（理论不可达——续约谈判中不生成要求）。
- 折价兑现与激活并发：兑现落库前已发起的激活按进价完成，落库后新发起的按 min(标准, X) 计价（§5.8）；以发起时点为准，不重算在途单。
- 训练营/自由身/退役：不生成。
- 俱乐部余额负：不阻止接受；工资照扣，富人税照算；这是经理决策。
- CPU：P0 不生成。
- 临时窗：不生成。
- 转会申请后球员被交易/解约：request `resolved`，收件箱关闭。
- 多轮谈判第 3 轮仍拒绝：必须生成转会申请（不能静默丢弃）；后果按 §5.4 拍板方案执行。
- 若拍板含挂牌路径（S1/S2/S5 软档）：手动挂牌走现有校验；S1 自动挂牌失败保持 pending 重试；无人出价下一窗续挂，不回到 `normal`，同窗不立即重挂。

## 12. 测试计划（qa-test-planner）

### 12.1 单元/集成

- TC-RD-01 生成资格：normal/formal/active contract、wage>0、gap≥8%；trainee/free/retired/listed 不生成。
- TC-RD-02 概率确定性：同 seed 同结果；不同窗口变化；`p` 边界 0/1.00（clamp 到 0.04–0.60）。
- TC-RD-03 频率/上限/选择：1 次/球员/窗；每俱乐部最多 6（目标平均≈3）；同窗唯一；重复 ensure 幂等；PPS 加权可复现，通过 ≤6 全取，>6 时不是 top-6 硬切。
- TC-RD-04 目标公式：15%–50%、target≤expected、floor≥wage*1.05、wageMax 截断；rc_floor 5%–25%、rc_fee=0。
- TC-RD-05 分布：高 gap/表现/核心/潜力/agent_tier 的球员 `p` 更高；无表现数据用中性 0.4；CA 排名 >12 core 仍有 0.15 底；位置组排名/工资中位数参与 coreScore。
- TC-RD-06 多轮：3 轮上限；每轮 `successRate`；低于 floor 直接拒绝；第 3 轮拒绝生成转会申请。
- TC-RD-07 接受：接受写 pending、contracts 不变；窗口关闭且未离队才 apply；下一常规窗 payroll 用新 wage；关闭前工资用旧值；临时窗不扣。
- TC-RD-08 拒绝：transfer_request 生成（`source` 落 direct/collapse/lowball 正确）；后果按 §5.4 定稿分支断言（S4″：direct **当场**保护期失效、无 pending，collapse 不改保护期）；无安抚通道。
- TC-RD-09 过期：3 天/关窗取较早；不生成转会申请；下窗必再提（p=1.0，rev21 所有终局）。
- TC-RD-10 并发：双 accept、accept+counter、关窗+accept、过期+accept，影响行数/409。
- TC-RD-11 权限：非本队 403、未登录 401、客户端伪造 target 无效。
- TC-RD-12 不泄漏：非本队/公开端点看不到 expected/floor。
- TC-RD-13 合同字段：关闭 apply 后 wage=target、release_fee=rc_floor、rc_fee=0（不扣款）；protection_ticks（S4 直拒档除外）/contract_type/source 不变；拒绝/过期/void 不变。
- TC-RD-14 工资上限：target>wageMax 截断；target<wage 不生成。
- TC-RD-15 挂牌/谈判中：不生成；已生成自动过期。
- TC-RD-16 UI：空态/加载/错误/接受/还价（3 轮）/拒绝并转申请行/申请后果态/过期；键盘可达；文案不出现系统词。
- TC-RD-17 经济：工资账单、富人税、CPU 跳过；赛季 2 窗估算。
- TC-RD-18 触发器：常规窗、开窗成功、临时窗不生成；ensure 失败不阻塞开窗。
- TC-RD-19 审计：round/attempts/seed/resolved_by/transfer_request/listing_id 落库。
- TC-RD-20 回归：现有 `createRcChange`、`window-payroll`、`negotiations`、挂牌/转会不受影响。
- TC-RD-21 违约金 cap（P1）：只做 cap 时 X<当前 RC；降低 RC 的规则/费用需确认。
- TC-RD-22 违约金 floor（P0）：所有有 RC 的 demand 带 rc_floor>当前；rc_fee=0（免收）；无 RC 退化为 wage-only；counter 不改 rc_floor；接受写 pending、关闭 apply 时 wage+RC 同事务、不扣费；拒绝/过期/void 不改合同。
- TC-RD-23 概率分布：固定 100 个窗口种子，统计 score 分桶的 p 与入选率；高 p 桶入选率显著高，低 p 桶仍有非零样本；每队显示 0–6 条、平均≈3，6 条是尾部；两窗累计接近 §5.1.1。
- TC-RD-24 关闭生效：接受后 `contracts` 不变；关闭前 `activation`/`transfer` 用旧 RC，pending 置 void；关闭后未离队 apply，下一窗工资用新 wage；关闭前 payroll 用旧 wage。
- TC-RD-25 普通续约 pending：首次免费机会在 apply 时消耗；离队 void 不消耗；二次续约按 §5.6 收费/收口保护期；免费/收费都在关闭 apply 时发生。
- TC-RD-26 双版本合同：本队教练 GET 同时返回 current/pending；公开页/其他俱乐部只返回 current；变化行有文字 delta，未变行保留；颜色不是唯一信息；375px 无横向滚动。
- TC-RD-27 交易按旧 RC：pending 存在时，挂牌成交/激活/转会确认显示当前 RC；成交后 pending void；成交价按旧 RC，不按待生效 RC。
- TC-RD-28 关闭/离队状态：关闭 apply 后 current 更新、pending 消失、toast；关闭前离队 pending=void 并显示「因离队未生效」；二次 pending 409。
- TC-RD-29 球队页行内小字：自家 SquadTab 工资/违约金主值为 current，pending 行下方出现「关窗后 X（+Δ）」；无 badge/面板/箭头/滚动；工资总额不含 pending；访客无小字；375px 小字换行不截断。
- TC-RD-30 球队页交易/行内：小字只表达“关窗后”，交易确认仍显示「关闭前交易按当前 RC」；小字不改变挂牌/激活成交价；关闭/void 后小字消失或变新 current。
- TC-RD-34 拒绝后果（S4″ 已拍板；rev21 口径）：direct 档**当场** `protection_ticks` 置已过（**无 pending**；`release_fee`/`wage` 不变！断言无价格变更）、`demand_rejected_public` **当场**发全部 user club、`transfer_requests.status='released'` 且「不满」徽章立即可见、折价威胁兑现时 `discount_fee` 当场生效（激活费立即降为 X）；重签 → `resolved`、徽章与折价摘除（保护期不恢复——rev22 Q1 收口定稿，同队重签≠新合同）；当窗洗地续约撞「同窗一次」409。collapse 档申请存续期 `createRcChange` 409、手动挂牌走现有区间。**通胀公式**：任意终局（rev21 含 direct）后再生成 demand 的 `r=clamp(gap,0.30,0.60)`、`rc_raise=0.25`（对照普通 `clamp(0.80×gap,0.15,0.50)`/score 浮动；gap 10%/25%/48%/60%/90% 五档 target 逐值断言）。**累计终局**：计数含 `expired`（两次放任过期 → 升档三件套；过期+谈崩混计同理）；计数按「球员×俱乐部」隔离（转会后新东家从零）；**挂牌触发的 expired 不计数**。**假意接受**：接受后关窗前卖出 → pending void、成交按旧 RC、交易确认页含待生效提示、球员本人收到作废通知。
- TC-RD-35 谈判区五态（rev19 位置）：「球员要求」分组挂 `/market/desk` 签约谈判页签顶部、DeskTab 无卡；对话流卡（开场气泡/还价气泡/当场回应）；深链 `?tab=negotiations&demand=<id>` 高亮；排序按剩余时间；副行是「效力 N 赛季」（无合同期限字段）；已接受/已拒绝/过期收口态；>2 条过期折叠计数；≤760 与转会台卡片行同形。
- TC-RD-36 还价卡内展开：区间条 floor→target 与打点；`c>=target` 提示直接成交；`c<floor` 送出置灰 + 警示文案（服务端仍保留 <floor→rejected）；档位预览四档调 preview 端点；送出同请求返回判定并写进对话流；无弹窗。
- TC-RD-37 preview：零副作用（不落库/不耗轮次/不审计）；四档边界值 0.2/0.5/0.8 落档正确；非本队 403。
- TC-RD-38 超帽确认弹窗：projected 超帽时触发；数字行/驱动明细/后果句/双按钮齐备；「仍要提交」二次击；硬规则失败不走弹窗直接阻止；≤760 底部抽屉。
- TC-RD-39 SideOps 只读态：四态文案；demand 存续/已接受/申请存续时「续约」禁用与 title；挂牌/解约保留并带作废提示；非教练不渲染；「去谈判桌处理」深链正确。
- TC-RD-40 接受确认与 wageContext：未超帽不渲染警示行；超帽警示数字 = current+pendingDelta+本笔；确认按钮降 danger；GET 响应 `wageContext` 仅本队教练可见。
- TC-RD-41 通知：`demand_created`/`demand_deadline`（24h 一次性闸）/`demand_resolved` 三模板落库与触发时机；deadline 不重复发。
- TC-RD-42 同窗一次不变量（rev20）：① 本窗 demand 行存在（pending/countered/accepted/rejected/**expired** 逐态）→ `createRcChange` 409「本窗他的合同谈判机会已经用过」；② 未终局签约谈判 session（active+signing）→ 再提交续约 409（顺带堵既有重复续约单缺口）；③ ensure 生成门槛：active session / 在途 pending 各排除一例；④ 竞态：demand 生成与续约提交并发，恰一条线成立；⑤ 过期后同窗续约 409、下窗放行；⑥ **计数口径**：同队续约（amendment）后计数不清零、徽章关闭；换队（ownership）清零；转会回原队 = 新段从零（段锚点 `completeTransfer` 换队分支）；在途 pending 作废语句在 `completeTransfer` 批内且 `!amendment` 不作废。
- TC-RD-43 回原队按续约处理（rev20 三次修订定稿）：**B 无纠葛买回**（本窗无 demand 行）——签约谈判照常开、按 `renewalRaise` 基准（×1.05–1.15，前东家判定挂 `openNegotiationSession`）；谈成后工资/RC = 谈判结果、signed_at=now；占用本窗额度（此后本窗 demand 生成被门槛排除）；不计终局。**A 窗内已闹买回**（本窗 demand 行存在）——跳过签约谈判（无 session 创建）、工资/RC/合同类型 = 合同行现值；direct → 「不满」徽章重挂 + 通告重发 + 保护期失效延续（快照恢复值即已过）；谈崩/过期 → 计一次 expired 终局（新段计数 +1，旧段不延续；再终局一次升档三件套）。**物理面**——换队分支快照 `service_ticks`/`protection_ticks`/`signed_at` 进 transfer 行；A/B 买回均恢复快照（效力冻结在离开时点、离开期间照常走表；保护期取离开时剩余状态；B 以新签时刻覆盖 signed_at）；对照断言：普通换队（非前东家）仍重锚。**例外与往返**——海捞/训练营买回不适用（走常规通道）；多次往返（A→B→A→B→A）逐段快照/恢复正确、每次回归按 B/A 定性（判据 = 本窗 demand 行存在与否）。
- TC-RD-31 注册工作台工资/合规：工资 stat 显示 current + 关窗后 projected，并逐人列出待生效工资（球员/当前→关窗后/来源）；current 与 projected 各跑一遍注册预检；projected 工资失败必须二次确认，硬规则失败阻止；关窗 apply 后 current 更新、明细消失；void 后 projected 回退；无 pending/访客不渲染。
- TC-RD-32 注册工作台名单：pending 行工资格第二行 `关窗后 X（+Δ）`、RC 列第二行（若有）；无 badge；非 pending 行无第二行；`仅看待生效` 筛选计数正确、工资总额仍按 current；窄屏无横向滚动；void/close 后第二行消失/更新。
- TC-RD-33 窄屏：375/640/760 三档；球队页卡片 current + 小字、注册名单 pending 第三行可见；无横向滚动/元素不截断；小字不截断；抽屉全屏、ESC/焦点返回。
- TC-RD-44 折价威胁生成（rev21）：N=1/2/3/≥4 的要求携带威胁概率 0.25/0.50/0.75/1.0（`seededUnit([demand_id], 23)` 确定性，同 seed 同结果）；N=0 永不携带；训练营/无 RC 合同不携带；`discount_threat_fee` 落库且同窗固定。
- TC-RD-45 X 算法：深度池按 N 累积解锁（N=1 {0.90} → N≥4 {0.90,0.85,0.80,0.75}）池内均匀抽，**浅档永远可抽中**（构造种子断言 0.90 在 N≥4 仍可出现）；X = §5.5 同款网格取整（≥5 按 2.5 中点归档、<5 归整数、中点归低）；托底 `max(X, max(1, ceil(min(RC×0.5, 身价×0.5))))`——构造低身价球员断言托底生效。
- TC-RD-46 兑现时点：任意档终局（direct/collapse/lowball/expired）落库那一刻 `discount_fee` 生效；生效后**新发起**激活按 `min(标准激活费, X)` 计价；**在途激活按进价**（兑现前已发起的不被改价）；`wage`/`release_fee`/保护期数值断言不变（无合同列变更）。
- TC-RD-47 寿命与覆盖：折价与「不满」徽章同摘（重签 → `resolved`、折价消失；离队随行）；下窗普通续约洗地一并摘除；回原队 A 分支恢复直拒时折价一并恢复；后续更深兑现覆盖旧值（只升深不回浅）。
- TC-RD-48 必再提放宽（rev21）：direct 后下窗合格 → p=1.0 再生成且带通胀公式（与 collapse/expired 同）；`released` 终态行不挡生成（released 行与新 demand 跨窗共存）；接受后 gap<8% 不再生成（资格闸仍然有效）。
- TC-RD-49 免费续约机会（rev22）：① `free_rc_change_used=0` 提价续约——审核不扣款（无 `rc_change_fee` 流水）、pending `free_rc_change=1` 且 `protection_ticks_new IS NULL`、关窗 apply 后 RC 新值生效而 `protection_ticks` 不变、`free_rc_change_used=1`；② 同合同二次提价——审核通过即扣 30%、`protection_ticks_new=baseTicks`（apply 后保护期收口）、余额不足 400；③ 降价续约——同样消耗（apply 置 1）、本就不收费；④ 换队卖出 → B 分支买回——新合同归 0；match 成约——免费标记不变；⑤ 闹涨薪接受——`free_rc_change_used` 不变；⑥ 4.4.10 回滚与离队 void——pending 作废、机会未消耗（再续约仍免费）、免费单退款循环跳过；⑦ A 分支买回——免费列用合同行现值、transfers 不加快照列；⑧ 兼容——0085 前在途单 evidence 无 `freeRcChange` 按非免费；⑨ UI——续约入口「本次免费」提示与 pending 投影渲染。变异验证三靶：approve 侧改回无条件 `rcChangeFee` 重算（免费单被扣款断言红）、upsert 漏加新列（换队/B 买回残留断言红）、apply 漏置 1（二次续约仍免费断言红）。

### 12.2 回归门

- `npx vitest run` 全量；typecheck 三份；build；本地 D1 迁移（若后续实现）。
- 设计阶段只写测试计划，不跑实现；实现时必须先补测试再写代码。

## 13. 分期

| 阶段 | 内容 | 不做 |
|---|---|---|
| P0 | 常规窗生成、收件箱、多轮还价（3 轮）、接受/拒绝、最低违约金 floor、转会申请（后果按 §5.4 拍板）、折价威胁（§5.8）、3 日截止、工资扣款、审计、UI/文案 | 合同到期、士气、公开声明、CPU 收件箱、违约金 cap |
| P1 | 公开声明/媒体、CPU 静默处理、违约金 cap/买断 | 队友影响、球迷反应 |
| P2 | 合同到期/自由身谈判、经纪人个性、更衣室 | 新货币/新硬帽 |

## 14. owner 已拍板 / 仍需拍板

### 14.1 已拍板（2026-10-21）

| # | 决策 | 答案 |
|---|---|---|
| 1 | P0「续约」语义 | **改工资 + floor；不改合同期** |
| 2 | 本次涨幅 | **15%–50%**（按 gap 的 80%，clamp；一次跨到 gap 的 80%） |
| 3 | 拒绝后果 | **rev20 已拍板：S5+S4″ 中等强度**——直拒 = 保护期失效 + 全联盟通告 + 「不满」徽章（不动价格/成长/资金）；谈崩/过期 = 申请挂起 + 下窗必再提按通胀公式；累计第 2 次终局升档。历程：rev17 强制挂牌（owner 澄清为建议）→ rev18 重开比较 → rev19 降档（否）→ rev20 定稿（§5.4 否决留档） |
| 4 | 还价轮数 | **与现有谈判完全相同**：最多 3 轮，`maxAttempts=3`、`attemptDecay=0.95`、`successRate`；**判定即时**（rev18） |
| 5 | CPU 俱乐部 | **P0 不生成** |
| 6 | 公开程度 | **私下要求 P0；公开声明 P1** |
| 7 | 频率/上限 | **1 次/球员/窗；硬上限 6 条/队/窗；生产校准 3.04 条/队/窗（16 队；4 队无合格）**；被拒绝后挂牌/申请存续期间不再生成（其余后果随 #20） |
| 8 | 截止 | **3 日**（且不晚于窗口关闭） |
| 9 | 最低违约金 | **P0 做 floor**：所有有 RC 的正式合同带 `rc_floor`；`rc_raise=5%+20%*score`（5%–25%），`rc_fee=0`（免收）；还价只改工资，floor 固定 |
| 24 | 折价威胁（rev21，2026-10-31） | **任意终局第 2 次起解锁的条件威胁**：N≥1 的要求按 0.25/0.50/0.75/1.0 概率携带「不给涨则激活费立即折到 X」；深度池累积解锁 {0.90}→+{0.85}→+{0.80}→+{0.75}、池内均匀抽（浅档永可抽中，owner 明确）；X = §5.5 网格取整(现 RC×k)、托底最低挂牌价 `listingPriceBounds.min`；**任意档终局兑现、立即生效不等关窗**；寿命与「不满」徽章同（挂 released 行）；**后果集整体改为终局即生效**（保护期/折价/徽章/通告），rejection pending 废止；下窗必再提放宽到所有终局（含 direct）。详见 §5.8 |

### 14.2 P1 待确认规则

10. **违约金 cap（P1）**：球员要求把 RC 降到 X 方便离队；P1 再做，需先确认降低 RC 的规则/费用。
11. ~~**免费续约机会（未来，not P0）**~~ **已转正（rev22 拍板 2026-10-31，随 v6.62.0 实施）**：每人/每合同一次免费改 RC——自动动用、不收费、不收口保护期、转会后刷新、降价同消耗；用完后维持现状（提价 30% @审核通过 + 收口保护期）；匹配/闹涨薪不消耗不刷新；A 分支买回不快照免费列。详见 §5.6 与 TC-RD-49；续约×保护期已按**收口**定稿（rev22 grilling Q1），rev21「重建保护期」叙事订正。
12. **窗口关闭才生效（m04098）**：闹涨薪接受与普通续约都写 pending；关闭前完成的挂牌/激活/转会按原 RC；离队则 pending 作废；关闭顺序见 §5.7。
13. **双版本合同（m04126）**：本队教练可见 current/pending 两版；单卡双列 + 顶部时间箭头；变化行高亮、未变行降权；公开/其他俱乐部只见 current；交易确认显示旧 RC。详见 §10.4。
14. **球队页（m04136，rev13 修订）**：不新增 tab/列；SquadTab/注册名单在现有工资/RC 数值下加一行小字「关窗后 X（+Δ）」，current 仍是主值；无 badge/面板/滚动；工资总额不含 pending；访客无小字。详见 §10.4。
15. **注册工作台工资/合规（m04176，rev10 修订）**：当前窗按 current；cap bar 加 projected 斜纹段，并**逐人写出待生效工资**；注册做 current/projected 双预检；projected 工资失败二次确认、硬规则失败阻止；关窗 apply 后重算；**P0 注册工资帽是硬上限，关窗超帽强制拍卖球员**。详见 §10.5。
16. **注册工作台名单（m04186）**：pending 行加 `待生效` badge + 工资/RC 第二行「关窗后」；非 pending 行不加；表头 `仅看待生效` 筛选；排序/工资总额仍按 current；球队页阵容名单仍只 badge。详见 §10.5。
17. **窄屏（m04192）**：≤760 球队页名单用卡片 + 行内小字；≤640 注册名单单列卡片，pending 第二/第三行必须可见，不横向滚动；抽屉全屏 bottom sheet。详见 §10.4/§10.5。
18. **行内小字（m04198）**：取消 badge/上滚/面板；pending 直接在现有合同数据下加小字「关窗后」，当前值仍是主值；roster 对自家教练返回 pending 金额，访客不返回。
19. ~~**2 窗未卖出（待拍板）**~~ **已作废（rev20）**：#20 定稿 S4″ 无自动挂牌环节，本项随之失效。
20. **拒绝后果方案（rev20 已拍板，历程见 §14.1 #3）**：**S5+S4″** ——直拒（明确放人）= 保护期失效（激活溢价消失、原价可激活）+ 全联盟通告 `demand_rejected_public` + 「不满」徽章（`transfer_requests.released` 存续即标记，重签/离队摘除）；全部不动价格/成长/资金，高 RC 盲区残余（老将市场压力弱）诚实接受，由通告+徽章+真人积怨兜底。谈崩/低于 floor/过期 = 申请挂起 + 下窗必再提（p=1.0）按**通胀公式** `r=clamp(gap,0.30,0.60)`、`rc_raise=0.25` 顶格（一次开到市场预期）；累计第 2 次终局自动升档走 direct 三件套；`lowball` 归 collapse 档（已确认）；**不做**球员自行挂牌权（P1 再议）。否决留档：S1 贱卖套利 / RC 降档（叙事+套利+失衡+expected 连锁）/ 成长冻结（惩罚错位+爆仓）/ 罚金（叙事牵强+土豪免疫）。
21. **位置（rev19，owner 指令「球员要求涨薪放在合同谈判区」）**：`/market/desk`「签约谈判」页签顶部「球员要求」分组、对话流卡（v6.40.0 语言）；球队工作台不加卡，入口 = 站内信/SideOps 深链 `?tab=negotiations&demand=<id>`。
22. **视觉定稿（已定稿，2026-10-25 owner「视觉可按之前定稿」）**：谈判区要求卡五态 + 卡内还价/接受/拒绝（§10.1）、ContractDualView 三态（§10.4）、窄屏注册工作台 + 超帽确认弹窗（§10.5）、SideOps 只读态（§10.2）——按视觉稿现状定稿（viz 六区块，已程序化自检 320–1280 零溢出）；已定稿屏 03/18/31 语言沿用。
23. **同窗一次不变量 + 段计数口径 + 回原队按续约（rev20，owner 裁决 2026-10-25；回原队部分经 owner 二次订正）**：同窗一名球员与一支俱乐部最多一条合同谈判线（闹涨薪或续约二选一，任意终局都占用本窗额度）——双侧守卫（`createRcChange` 查本窗 demand 行任意状态 + 查未终局 session，顺带堵既有「续约单 signing 中可再提第二张」缺口；ensure 生成门槛排除 active session/在途 pending），详见 §5.4 与 TC-RD-42。**计数清零 = 只有换队**（amendment 续约不清零，堵「过期→便宜续约洗计数」循环）。**回原队 = 当作人没走过（owner 三次订正定稿，判据 = 本窗是否已闹）**：无纠葛买回（本窗无 demand 行）可谈判、按 `renewalRaise` 续约基准、占本窗额度、不计终局；窗内已闹的买回（本窗 demand 行存在）跳过谈判纯回归——原直拒**恢复直拒分支**、其他终局**计一次 expired**（新段计数）；**物理面一律延续**（换队时快照效力/保护期/签约时刻进 transfer 行、买回恢复——堵保护期重开与效力洗解约费两个漏洞）；海捞/训练营不适用。详见 §5.4「回原队」小节与 TC-RD-43。

## 15. 技能使用记录

| skill | 用在哪 | 产出 |
|---|---|---|
| domain-modeling | §2 术语/边界 | 把「涨薪要求」和「续约/转会/士气」切开；合同无到期字段 |
| game-economy-designer | §9 数值/成本/反刷 | 15–60% 跳跃、1/窗/人、硬上限 6/队/窗（生产校准均值 3.04）、3 日、floor 免收、工资扣款、富人税、无硬帽 |
| brainstorming | §4 方案空间 | A–E 比较，选 C；rev22 对账 §5.6 × rev18–20 机制——自洽七处 + 实现级陷阱三处（upsert 列清单/approve 重算/A 分支不快照） |
| grilling | §14 决策树 | 9 个 P0 已拍板 + 1 个未来免费续约规则 + 1 个 P1 cap 规则；rev22 免费续约四题已拍（自动动用/扣款时点/降价消耗/match 不刷新）+ Q1 保护期口径已拍（**收口**，rev21 重建叙事订正） |
| architecture-designer | §5/§6/§11 | 多轮状态机、attempts/transfer_requests、并发/幂等 |
| codebase-design | §8/§7 | 新模块、批量化、复用 expectedWage/successRate |
| qa-test-planner | §12 | 34 条测试、回归门、最坏情况 |
| frontend-design | §10 | 收件箱、多轮、转会申请卡、空态/确认 |
| humanizer-zh | §10.3 | 去系统腔，球员/俱乐部视角 |
| code-review-skill | 设计评审 | 边界/权限/并发/测试覆盖 red team |

## 16. 非目标

- 不改 `negotiation_sessions` 的 `transfer_id` 语义。
- 不新增工资硬帽、货币、士气、性格、媒体系统。
- 不改变现有经理发起续约（`createRcChange`）的行为。**rev22 例外**：免费续约机会在此流程内加分支（费用豁免 + 保护期不收口 + 消耗标记），守卫/区间/谈判/关窗生效等其余行为不变。
- 不做球员在客户端主动发起要求；服务端事件生成。
- 不把 `expected_wage`/`floor_wage` 暴露给非本俱乐部。
- 不提供安抚；拒绝后果按 §5.4 拍板方案执行（无自动撤单/改价通道）。
