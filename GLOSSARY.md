# WHL Club Operations Platform

## 赛季与转会窗

**转会窗（开窗期）**:
The period when the transfer market is open. In WHL this is the off-season: no league matches; listings, bids and offers are active.
_Avoid_: 窗口 (alone), 休赛期 (alone when the market state matters)

**休赛期**:
The no-league-match period. In WHL it coincides with the open transfer window; prefer "开窗期（休赛期）" when the market state matters.
_Avoid_: using 休赛期 for the no-window period

**无开窗期（赛季进行中）**:
The period when no transfer window is open; league matches run and the market is cold.
_Avoid_: 休赛期, 冷窗 (as a calendar period)

**冷窗**:
The no-open-window market state; a UI/cache state, not a calendar period. Prefer "无开窗期（赛季进行中）" in prose.
_Avoid_: using 冷窗 as a synonym for 休赛期

**开窗状态（phase）**:
The public window phase: `open` = transfer window open (off-season); `closed` = transfer window closed (season in progress).
_Avoid_: `offseason` for the closed phase

## 球员在途

**在途**:
球员正被市场/审核/签约流程占用：有活跃挂牌（listed / bidding / matched_pending / pending_review 四态之一）、有待审单据（transfers 的 pending_review）、或有未结束的签约谈判会话（active）——任一成立即在途。在途期间不能重复挂牌、不能上调激活、不再生成球员要求。界面口语说「已经有一单在市场流程里了」。
_Avoid_: 正在交易（看不出卡在哪一关）, 流程中, 占用中

## 球员要求（闹涨薪）

**球员要求**:
球员在开窗期主动向俱乐部提出的新合同诉求（涨工资、提高违约金）。页面上的分组名就叫「球员要求」；一条具体诉求叫「涨薪要求」。
_Avoid_: 收件箱（这只是承载它的地方）, 闹涨薪（口语，不进界面）

**要求工资**:
他这次希望拿到的工资。UI 写「他要 3.70m/窗」。
_Avoid_: 目标工资, target

**他的底线**:
他能接受的最低还价，再低他会视为拒绝整条要求并提交转会申请。UI 写「他的底线 3.25」。
_Avoid_: 底价, 心理底价（与转会区的「最低报价」撞义——那是卖家的线，这是球员的线）

**市场价**:
按他的能力与现行违约金算出的公平工资（谈判引擎口径）。UI 不显示精确值，只说「开到市场价」。
_Avoid_: 市场预期（界面不用）, expected wage

**待生效 / 关窗后生效**:
已谈成但还没写进合同的变更——关窗那一刻才真正生效，关窗前的交易仍按老合同算。
_Avoid_: pending, 旧合同/新合同（听起来像两份合同）

**已生效 / 因离队未生效**:
关窗后写进合同了 / 人在关窗前走了所以没写成。历史记录用语。
_Avoid_: applied, void

**转会申请**:
被拒绝的球员要求离队的挂号，挂着期间俱乐部不能再给他续约。
_Avoid_: 强制转会（他没走成之前只是申请）

**不满（标记）**:
被「明确放人」后挂在球员身上的全联盟可见状态，直到他离队或重新签约。
_Avoid_: 士气（P0 没有士气系统）, released（界面不出现）

**明确放人**:
经理在拒绝确认里点的那个决定——后果是保护期结束、全联盟通告、挂「不满」。与「没谈成」区分：这是表态，那是结果。
_Avoid_: 直接拒绝（机制词，界面叫「明确放人」）

**没谈成**:
三轮还价没谈拢，或三天没回应到期了。
_Avoid_: 谈崩（界面不用）

**保护期**:
合同上的一段防挖墙时期——期内别的队要激活他得付溢价（违约金的 1.5–2 倍），出了保护期按违约金原价。「明确放人」的后果之一就是保护期结束。
_Avoid_: protected until, protection ticks（界面不出现）

**折价威胁**:
他放出的条件——「这次不给涨，他的激活费立即降到 X」。要求里带这句话时，没谈成或被「明确放人」的那一刻，激活费真的就降了。折价不是独立状态，是「不满」的一部分：不满期间激活费就是折后价（要求里没带这句话的不满，按原价）。
_Avoid_: 被立即激活（折价是价格变了，人要等真有队来买）, 降价卖人（挂牌价不动）, 折扣（界面写具体数字）, 折价状态（不单说，归在「不满」里）

## 候选名单与消费券

**候选名单**:
教练把感兴趣的球员挂进本俱乐部的私人跟踪名单（FM shortlist 语义）——任何俱乐部、任何状态的球员都能收，纯选材跟踪工具。名单球员被挂牌、被签走、解约变自由身时，站内信通知收藏者俱乐部；但操作方俱乐部自己触发的事件不通知自己。
_Avoid_: 收藏（听起来像粉丝向）, 关注, watchlist, 收藏夹

**消费券**:
俱乐部在现金之外的第二种资金：只能用于消费抵扣（先券后钱），不可转账、不可兑现。来源 = 建设支出按比例返还 + 事件发放 + 管理组发放。由早期只抵建设的「建设券」升格统一而来，旧名不再使用。
_Avoid_: 建设券（旧名）, 代金券, 积分, build credit

## 激活

**激活通知**:
激活方在 QQ 私信被激活方主教练的消息，必须包含激活方名、球员名和匹配提醒（竞价结束后请选择是否匹配）。这是规则要求的通知，不是系统自动发送的站内信。
_Avoid_: 激活私信（界面不用）, 通知截图（单独使用指代不明）

**激活通知截图**:
上述激活通知的截图，激活方把它上传给转会管理方作为凭证。界面标题写「上传激活通知截图」。
_Avoid_: 证据图, 证明图, 证据制（内部流程词）, QQ 截图（单独使用指代不明）

## PlayStyle（原「徽章」域）

**PlayStyle**:
球员身上的技能特型，同一域概念只有一个名字。一份身上最多 15 个槽（12 银 + 3 金），每槽一枚；来源两个——FC 档案自带（跟着 FC 存档版本走）与平台发放（成长方案 / 中国计划 / 消费中心 / 管理组）。银金两段互斥：同一个 PlayStyle 有了金版就不能再选银版，反过来成长时选金版会自动把已有银版替换掉；被金版顶住的银版在所有界面、计数与筛选里都不出现，金版移除后自动回来。外场球员拿不到门将专属项（6 个 GK 项），门将可见全部。
_Avoid_: 徽章（除消费中心商店语境外的界面一律写 PlayStyle）, 金徽章/银徽章（计数场合写「金 PlayStyle / 银 PlayStyle」）, 花式（与 skillmoves 撞义）

**徽章（仅商店语境）**:
消费中心商店页签里的商品俗称——页签叫「徽章」、按钮叫「买银徽章 / 银徽升金」，因为货架语境里「徽章」比「PlayStyle 碎片」更像商品。出了那个页面（成长、球员库、通知、报表）一律写 PlayStyle。
_Avoid_: 把它带进其它界面或文档的正文

**全量计数**:
球员页头与列表上的 🥇×N 🥈×N 数的是「FC 自带 + 发放所得」的总和（被金顶住的银不算），上限 12 银 / 3 金也按这个口径守——不是「发出去几个」。台账（badges_silver/gold）就是它的存库形态，随任何发放 / 回收 / 解约 / 重导自动重算。
_Avoid_: 只数发放所得（v6.62 之前的旧口径）, 手工改计数（它是派生值，改了也会被重算冲掉）

