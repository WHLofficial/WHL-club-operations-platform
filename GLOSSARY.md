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

## 候选名单与消费券

**候选名单**:
教练把感兴趣的球员挂进本俱乐部的私人跟踪名单（FM shortlist 语义）——任何俱乐部、任何状态的球员都能收，纯选材跟踪工具。名单球员被挂牌、被签走、解约变自由身时，站内信通知收藏者俱乐部；但操作方俱乐部自己触发的事件不通知自己。
_Avoid_: 收藏（听起来像粉丝向）, 关注, watchlist, 收藏夹

**消费券**:
俱乐部在现金之外的第二种资金：只能用于消费抵扣（先券后钱），不可转账、不可兑现。来源 = 建设支出按比例返还 + 管理组发放。由早期只抵建设的「建设券」升格统一而来，旧名不再使用。
_Avoid_: 建设券（旧名）, 代金券, 积分, build credit

