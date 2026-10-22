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
