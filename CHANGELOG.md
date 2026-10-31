# 变更记录

本项目按**各仓语义化版本**推进（2026-09-25 起；此前为全项目共享增量号，原号与新版本的对照表见 [ROADMAP.md](./ROADMAP.md) 顶部），每次生产部署以 Cloudflare Worker 的 Version id 标记（仓库无 git tag）。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

各版本的裁决、交付清单与验收数字见 [ROADMAP.md](./ROADMAP.md)。

## [v6.64.5] · 撤回「出价当日不判定」：18:43 出价当晚 21:43 截止（2026-10-31）

**Fixed**

- `bidDeadline` 删掉 v6.64.3 加的 `if (dayStr <= bidDayStr) continue;`。规则 4.4.7 的口径是「挂牌次日起，交易日 18:00-23:00 内、自上一出价起静默满 3 小时即截止」——**判定起点是挂牌日次日，不是出价次日**：挂牌当天不管几点出价都不可能当日成交（`minOffsetDays = 1`，强拍 2）。那行把「出价当日」也一并跳过，副作用是 18:43 的出价被推到次日 21:00；生产实拍 B. Mbeumo（listing 14）18:43:30 出价、落库截止 11-01 21:00，按规则应为当晚 21:43:30。
- 恢复后的口径：18:00-20:00 之间出价 → 当晚 21:00-23:00 截止（静默段装得进时段就当日判定）；20:00 之后出价（如 20:30 → 23:30 越过时段尾）仍顺延下一交易日 21:00；交易日历顺延、强拍 X+2 不变。
- 生产数据订正（owner 授权）：三张被旧逻辑推后的挂牌 `deadline_at` 改回按规则算出的时刻——listing 14 B. Mbeumo `2026-10-31T13:43:30.152Z`、listing 10 M. Kerkez `2026-10-31T13:43:07.666Z`、listing 2 Y. Diomande `2026-10-31T14:11:01.590Z`。

**验收**：typecheck 三份全清；`tests/market-rules.test.ts` **22 例**全绿（含新增回归锚「18:43 出价 → 当日 21:43」与护栏「挂牌当天出价仍进不了当天」）；全量 178 文件 / 2,887 例中 2 例失败属 v6.64.4 在途工作（`NOTIFY_META` 47 vs 50、注册名单 422），在干净 HEAD 上同样失败，与本版无关。测试计划 `docs/test-plans/v6.64.5-bid-deadline-same-day.md`。判级 **patch**（零迁移、零新端点；一行规则回退 + 三行数据订正）。

**已上线（2026-10-31）**：owner 要求「只部署本次改的代码」，故在 `origin/main`（`533b12f`）之上单独 cherry-pick 本版一枚后 push（`533b12f..c4a7729`），**未随行另一会话的 v6.64.4 五枚提交**。生效 Version `29581a52-2914-4d3c-bdb3-7369eab48e58` @2026-10-31T11:50:27Z（零迁移）。上线回读：health 200；线上入口 `assets/index-XxoOfqQw.js`（717941 B）含版本串 `6.64.5`×1、含 `6.64.4`×0、「自助取消」「下放」均 0 ⇒ 确认只带本版；三张订正挂牌 `deadline_at` 回读仍为 13:43:30 / 13:43:07 / 14:11:01。数据订正先行、部署随后，21:43 前若再有出价也按新规则重算。

## [v6.64.3] · 激活竞价截止后训练营合同同样进 24h 匹配窗 + 出价死线跳过出价当日（2026-10-31）

**Fixed**

- 训练营合同被激活的挂牌在竞价截止后不再「直进待审」，与正式合同同口径进 24 小时匹配窗（`settleByContractType` 撤豁免）：被激活方可付「新违约金 > 竞价最高价」的差额把球员留下（成约即转正式合同），放行或到期未决定则按竞价最高价成交进待审。当晚 21:00 首次挂牌结算的生产预期：#23（Barrios，训练营激活）进 `matched_pending`。
- 出价死线堵漏（`bidDeadline` 判定日跳过出价当日）：X 日 18:00-20:59 的出价不再产生「当日 21:00 截止」，死线恒为下一交易日 21:00（节假日按交易日历顺延；强制拍卖仍比普通挂牌多一天）。存量已落库的 `deadline_at` 不回改，只影响未来出价推进。
- 前端两处「训练营直进待审 / 直进管理组审核」文案与激活流程口径统一；源码三处头注释同步。

**验收**：typecheck 三份全清；vitest **177 文件 / 2,860 例**全绿；`npm run build` 通过；变异验证 M1/M2 定向变红。测试计划 `docs/test-plans/v6.64.3-trainee-match-and-bid-deadline.md`。判级 **patch**（零迁移、零新端点、零契约变更）。

## [v6.64.2] · 无东家的名单行把广告板打白屏（2026-10-31）

**Fixed**

- `/market/board` 白屏。生产 player 90（Iñigo Martínez）在 10-31 04:54Z 被解约（`transfers id=36`，`from_club_id=33`）后成了自由身，但**旧东家的挂牌标记没清**——`players.transfer_listed` 仍是 1 ⇒ 广告板按 `transfer_listed = 1` 把他捞出来，行的 `clubName` 是 null ⇒ `TeamLogo` 的 `colorOf()` 对 null 做 `for..of` 抛 `TypeError: t is not iterable`，React 无错误边界整棵树卸载，整页白得只剩底色。三处一起修：`TeamLogo` 的 `name` 改可空并按空队名兜底（`—`）、广告板副标题 `clubName ?? '—'`、`TransferBoardRow` 类型照真实载荷改成 `clubId: number | null` / `clubName: string | null`（旧类型写死 `string`，让 null 骗过了 typecheck）。
- `GET /api/market/transfer-board` 名单口径加 `AND p.club_id IS NOT NULL`：名单语义是「各队挂出的转会名单」，没有东家的人在板上既没有卖家可报价、卡面也没有球队，属于过期的挂牌标记。
- 解约完成时一并清挂牌设置（`transfer_listed = 0`、`list_price` / `min_offer_price` / `transfer_listed_at` 置 NULL、`offer_auto` / `not_for_sale` 归 0），从源头断掉「离队后仍带着旧东家的名单与标价」这类脏数据；下家接手后也不会继承别人的挂牌价。
- 广告板补齐「自动下架」口径（`GET /api/market/transfer-board` 的 WHERE 一次收口）：**已在转会区挂牌中**（`status = 'listed'`，任何阶段——listed / bidding / matched_pending，此时转会区另有要价与截止，不重复展示、也不该出现两套价格）、**已退役**（不可交易）、**训练营合同**（固定条款，卖出走激活不走报价）、**非卖品**（`not_for_sale = 1`，一切报价自动拒，摆出来只会招来必被拒的报价）、**已有买定在走流程**（存在 `pending_review` / `signing` 的 transfers，等审核或签约谈判中）一律不出现在板上；`total` 同步。
- 球员换队成约时清掉旧东家的报价设置（同一个 `UPDATE players` 里连同 `club_id` 一起改），避免离队后旧标价跟着球员挂到新东家名下。

**根因链**：解约不清挂牌 → 广告板捞到无东家行 → 队名为 null → TeamLogo 抛错 → 无错误边界整页白屏。修复不会让历史脏数据回魂：SQL 已挡在板外，前端也做了 null 兜底（KV 里 1h 的旧缓存带着 null 行也不会再白屏）。

**验收**：typecheck 三份全清；vitest **177 文件 / 2,860 例**全绿（v6.64.1 基线 177/2,856，+4 例）；`npm run build` 通过。测试计划 `docs/test-plans/v6.64.2-board-clubless.md`。判级 **patch**（零迁移、零新端点；公开端点名单口径收紧一行）。

## [v6.64.1] · 签约谈判在途的球员不能再被海捞（2026-10-31）

**已上线（2026-10-31）**：push `8b189cc..42931e1` 触发 CF Workers Builds 自动部署，生效 Version `53b6aa02-50d8-45bb-b609-c320e2ccf21e` @2026-10-31T07:25:00Z（零迁移）。上线回读：health 200、入口资产 `index-D9OFJQ2i.js` 与本地 6.64.1 构建同名同哈希、两名在签约谈判的生产球员 `seaSign` 返回新文案、干净自由身仍可捞。

**Fixed**

- 海捞资格链补「在签约谈判」一关。海捞单审核通过后单据进 `signing`（签约谈判），球员此时还没过户、`players.club_id` 仍为空，而旧的在途判定（`findInFlight`）只认 `pending_review`——同一名球员还能被第二家（或原队）再提一张单，两张单最后会抢同一名球员。现在 `checkSeaSignEligible`（`src/worker/bypass.ts`）在 pending 之后加 `signing` 判定，返回 400「这名球员的海捞单已经进入签约谈判，等它成约或作废再操作」（`stage='signing'`、`errCode='sea_signing'`）。
- `GET /api/market/sea-lookup` 的批量快照副本同步改口径（`status IN ('pending_review','signing')` 一条查询、按状态分两个集合），球员页与情报台不会再给出相反结论。明标提交、暗标出标、开标重判共用同一条资格链，一处生效全覆盖；已作废/已成约的单据不受影响（后者由归属关接手，文案不同）。

**验收**：typecheck 三份全清；vitest **177 文件 / 2,856 例**全绿（v6.64.0 基线 177/2,854，+2 例）；`npm run build` 通过。测试计划 `docs/test-plans/v6.64.1-sea-signing-gate.md`。判级 **patch**（零迁移、零新端点、零契约变更）。

## [v6.64.0] · 被激活挂牌的在途收入纳入预期收入（2026-10-31）

**已上线（2026-10-31）**：迁移 `0087` 于 push 前 apply 生产（重放三资金触发器，零数据写入），push `d5f9224..8b189cc` 触发 CF Workers Builds 自动部署，生效 Version `a102024c-b5db-4f7f-a979-db708bed2268` @2026-10-31T06:25:08Z（同批带上 v6.63.3 两枚）。上线探针：health 200、线上资产 `index-Jec9N4rn.js` 与本地 6.64.0 重构建 sha256 逐字节一致、版本串 `6.64.0`、`/api/club/balance` 匿名 401。判级 minor（资金闸口径变更 + 展示字段新增，契约向后兼容）。测试计划 `docs/test-plans/v6.64.0-activation-income.md`。

**Changed**

- 预期收入额度加**源③**：被激活挂牌（`type='activation'` 且 `activated_by IS NOT NULL`、仍在 listed/bidding）的在途收入计入——毛额 = MAX(最高 active 出价, 激活价 ask_price)，激活价保底（激活方已提交申请、作废即收缩）；税沿用分段累进与过户实算同源；`matched_pending` 起由 transfers 源②接管不重复计。出价/报价/海捞的可用资金判定随之变宽（迁移 `0087` 重放三个资金触发器，同源新公式）。
- `GET /api/club/balance` 新增 `activationIncome`（被激活挂牌在途税后净额，未乘 k）与 `activationCredit`（×k 后与 creditLine 同层）；财政页余额卡「（含预期收入 Y m · 其中被激活挂牌 Z m）」，Z>0 才显示，title 注明口径。

**Fixed**

- 修正 v6.57.0 的错误注释「激活是签入方掏钱不产生卖方收入」——激活挂牌的卖家（球员现属队）一直由 transfers 源②计收入；首版源③还抓掉 SQLite 两参 `MAX(NULL, ask)` 传播 NULL 的真缺陷（出价缺失时整行被静默跳过，`COALESCE(出价, 0)` 修掉）。

**验收**：typecheck 三份全清；vitest **177 文件 / 2,854 例**全绿（v6.63.3 基线 177/2,851）；e2e 29/29；变异三靶恰红（删源③ / 去 COALESCE / matched_pending 不退场）；code-review 🟡×1 已修（TC-M02 幂等重放用例补上）。

## [v6.63.3] · 旁路操作费用预览：解约 / 海捞确认前看得见要花多少（2026-10-31）

**已上线（2026-10-31）**：随 v6.64.0 同批 push（Version `a102024c`，见上条）。

**Fixed**

- 解约确认面板（球员页左栏 + 工作台「续约与解约」）此前只有公式文案，费用数字只在提交成功回执里出现；现在确认前就显示本次解约费：付费档「本次解约费 X m = 违约金 ×（3 − 效力 N 赛季）× 10%，审核时收取」、效力满 3 赛季明示「本次解约免费」、无含违约金合同保持公式文案（服务端仍 409）。
- 海捞明标面板此前只写「签入即付海捞费」不带金额；现在随输入实时显示「海捞费 X m（新违约金的 30%）」；暗标面板「冻结 X」改同一派生（顺带修掉输入 0 / 非法值时显示「冻结 0 / 冻结 Infinity」的旧行为）。

**Changed**

- 新增 `web/src/lib/bypass-fee-preview.ts`：`terminationFeePreview` / `freeAgentFeePreview` 派生自 `src/core/bypass-rules.ts` 单一出处（组件不抄公式）；违约金 / 效力 / 输入缺失或非法回 null，调用侧退回公式文案不冒充免费。金额真源仍是服务端提交实算与回执。

**验收**：`npm run typecheck` 三份全清；`npm test` **177 文件 / 2,851 例**全绿（v6.63.2 基线 175/2,843）；`npm run build` 通过；code-review-skill 复查一处并已修（`releaseFee <= 0` 守卫）。零迁移、零新端点、零后端改动。测试计划 `docs/test-plans/v6.63.3-bypass-fee-preview.md`。

## [v6.63.2] · 海捞单直签训练营按 5m 违约金重算签入费（2026-10-31）

**已上线（2026-10-31）**：push `b043e27..d5f9224` 触发 CF Workers Builds 自动部署，生效 Version **`a8940315-d4d2-481c-9875-33397b568443`** @2026-10-31T05:10:47Z（零迁移）；线上入口资产 `index-BBQdC4HH.js`、谈判分包 `MarketDeskPage-CadCsNBG.js` 已含「签入费合计 / 补收 / 可用资金不够会被挡下」文案，线上版本串 `6.63.2`。

**Added**

- 海捞（明标与暗标胜出同一条路）的单据在「直接签训练营」时，签入费按训练营固定的 5m 违约金重算：提交价低于 5m **补收**差额（否则等于拿 2m 违约金花 0.6m 白拿一份 5m 训练营合同），高于 5m **退还**多收的差额，正好 5m 不动。结算落在成约动作里（`chooseTrainee`）、`settleActiveSession` 之前，同批把 `transfers.extra_fee` 改成 1.5，钱走 `ledger_entries` 的 `free_agent_fee_topup` / `free_agent_fee_refund` 两笔流水（幂等键 `(club, kind, transfer, refId)`，重放不长钱、不吞钱）。补收过不了资金闸（可支配含预期收入额度）就 409 挡下，不白过成约；退款是入账，不设资金闸。
- 核心纯函数 `freeAgentFeeGap(paidFee, contractRc)`（`src/core/bypass-rules.ts`）：正数补收、负数退还、0 不动，前端与后端同源。
- 谈判卡片「直接签训练营」按钮下明示方向与金额：会补收 Xm / 会退回 Xm（合计 1.5m），补收口径附「可用资金不够会被挡下」。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npm test` **175 文件 / 2,843 例**全绿（v6.63.1 基线 175/2,837，+6 例 = 差额函数 3 例 + 端到端 3 例）；`npm run build` 通过；code-review-skill 复查无阻断项。零迁移、零新端点。测试计划 `docs/test-plans/v6.63.2-trainee-sign-fee-gap.md`。

## [v6.63.1] · 暗标截止后的收标态收口 + 同额落败文案（2026-10-31）

**已上线（2026-10-31）**：push `f412485..` 触发 CF Workers Builds 自动部署（版本号随本轮 bump，线上版本串 `6.63.1`）。

**Fixed**

- 海捞暗标**截止后**（`closing`，批次尚未开标）不再露出可点的出标 / 改标 / 撤回入口：`useSeaPhase` 在 `sealed`/`closing` 态每 30 秒轮询（此前完全不轮询 —— `sealed→closing`（到点）与 `closing→open`（开标）这两次翻转只有服务端知道，页面会永远停在「收标中 00:00」，开标后也不自愈）；海捞页横幅改「暗标段已截止，等待开标」、撤回按钮隐藏、「我的出标」徽标改「已截止」；球员页按钮改禁用态「收标已截止 · 等待开标」，不再回落到「海捞签入」（那条路后端必 409 `sea_sealed_phase`）。
- `sea_sealed_lost` 的同额落败文案由「有更高的密封标」改为「被别人以同额但更早、或更高的密封标拿下」，与「同额先出胜」的排序口径一致（`tests/sea-sealed.test.ts` 同额用例补断言）。

## [v6.63.0] · 徽章 × PlayStyle 全面合并（2026-10-31）

**已上线（2026-10-31）**：迁移 `0086` 于 push 前 apply 生产（`Executed 5 commands in 303.32ms`，全表台账与迁移同源表达式对账 silver_drift=0 / gold_drift=0）；push `56d00fd..f412485`（7 个提交）触发 CF Workers Builds 自动部署，生效 Version `310624e6-1cae-4ad8-8f1e-e0e03a95c175` @2026-10-31T04:10:31Z（发布轮 package.json 漏 bump，随 `f412485` 订正重部署）。上线探针：`?ps=` 抑制/发放命中、列表与详情 `playstyles` 合并清单、`sort=ps/badges` 全部实测通过，线上版本串 `6.63.0`。判级 minor（台账口径重定义但存储形状不变、契约字段名不变、tour 零代码自愈）。测试计划 `docs/test-plans/v6.63.0-playstyle-merge.md`。

**Changed**

- 「徽章」域全面收口为「PlayStyle」：台账 `badges_silver/gold` 从「只数发放所得」改为**全量派生值**（= FC 槽数减被发放金抑制的银槽 + 发放明细行数），写路径五处（成长 levelup / 中国计划 / 商店买徽章与银升金 / 转会 china 回收 / 解约 / 导入）全部改为明细变更后同批重算；解约不再台账归零（FC 自带槽计数保留）；上限守卫收敛到槽位结构 12 银 / 3 金，`config.badge_cap_silver/gold` 与管理端直写徽章数退役。
- 银金跨段规则（修复 247/557 存量违规根因「判重只做同段」）：择银遇金三语境同挡；成长择金遇银自动「去银留金」（发放银删行、FC 银走可逆抑制——金在展示/计数/筛选/meta 四口径消失、金行消失自动回归）；商店择金遇银挡并引导走「银升金」。
- 位置资格（单向）：外场拿不到 GK 专属项（基础 ID 51-56，银金两段），GK 可见全部 36 项；position 未知保守挡。
- 读侧统一：`sort=ps` 与 `sort=badges` 同指台账列和；`?ps=` 覆盖发放所得（被抑制银不命中）；列表行与详情端点下发合并清单 `playstyles`（含抑制与来源）；`/api/players/meta` 的 `playstyles` 改合并清单（形状不变，tour 零代码自愈）。
- 前端：球员库/球队页「徽章」列退役并入 PlayStyle 列（默认列换 `ps`，旧列偏好静默收敛）；成长选择器标「替换银版」、商店双向互斥（保留「徽章」俗称）；详情右翼与对比页挂来源角标；BadgeCounts 与 levelup 通知文案改「金/银 PlayStyle」。

**Removed**

- 迁移 0086：`idx_players_sort_ps`（15 槽计数索引，sort=ps 改走 0036 台账索引后无用，每次重导省 18,301 行写）；config 两帽键；球员 247 的违规发放银 24 行（删银保金；557 零变更走派生抑制）。

**验收**：typecheck 三份全清；vitest **175 文件 / 2,836 例全绿**（v6.62.0 基线 174/2,831）；e2e 29/29；变异验证 4 靶全命中；code-review 🔴×1（`?ps=` 金值进发放明细 IN 未剥 +100）已修 + 补端到端锁。

## [v6.62.0] · 普通续约免费机会（2026-10-31）

**已上线（2026-10-31）**：push `6141102..4cd2d52`（`7381a2c` 后端 + `b9b0bf8` 前端 + `fdcb4f6` 评审修复 + `4cd2d52` 海捞守护用例补提交），CF Workers Builds Version `dbc4564d-09d6-47f9-809b-f722159113c5`（2026-10-31T00:37:29Z）；迁移 `0085` 先于 push apply。上线探针：生产 `contracts` 517 行 `SUM(free_rc_change_used)=0`、`d1_migrations` 末条 `0085`、health 200、线上资产 `index-O44TeQIk.js`。**上线后裁决追加（同日 push `4cd2d52..56d00fd`，Version `d759a4f8`）**：停审的 0085 前在途续约单（生产 9 张）也按免费走——审核侧与成约侧判定放宽为「evidence 未显式 `false` 即免费」（旧单提交时机会必然未消耗，零不公；显式 `false` 的新单仍收费），三权益闭环（免 30% / 保护期不收口 / apply 消耗），零迁移零数据批。判级 minor。设计真源：`docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md` rev22 §5.6（owner 拍板四题：自动动用 / 30% 维持审核通过时扣 / 降价同消耗 / 匹配不刷新；grilling Q1 收口定稿：免费续约是唯一保留保护期的续约）。

**Added**

- `contracts.free_rc_change_used`（迁移 0085，DEFAULT 0 零回填）：每份合同一次免费改违约金续约——`used=0` 的合同下一张续约单**自动**走免费通道：提价免收差额 30%（审核侧凭 evidence `freeRcChange` 跳过 `chargeBypassFee`，缺字段的历史在途单按非免费兼容）、不收口保护期（pending `protection_ticks_new = NULL`，apply 侧 COALESCE 接住）；apply 成功同批消耗（CASE 内联在 contracts 同一句 UPDATE）；降价同消耗。0079 零写入的 `contract_pending_changes.free_rc_change` 启用为当次标记。
- 转会后刷新：`completeTransfer` 换队 UPDATE / 买回桥接两态 / 海捞与无归属新签 upsert（excluded 兜底防旧行残留）四路归 0；match 与闹涨薪接受不消耗。
- UI：`/api/club/squad` 下发 `freeRcAvailable`（仅本队教练面）；DeskTab 续约入口「本次免费：提价不收差额、保护期不变」提示与提交回执按方向分支；ContractDualView 待生效行渲染「本次免费」徽标。

**Changed**

- DeskTab 续约 hint 的旧保护期口径订正：「原保护期自审核通过起结束 / 重新起算」→ 收口 = 在本窗关闭时结束（免费续约是唯一保留保护期的续约）。

**验收**：typecheck 三份全清；vitest **174 文件 / 2,816 例全绿**（v6.61.0 基线 173/2,798，净 +1 文件 / +18 例）；build 6.62.0；e2e 29/29；本地迁移 0085 落表；变异验证三靶恰红（审核侧改回无条件重算 / 换队 UPDATE 与 upsert 漏归 0 / apply 漏置 1）。测试计划 `docs/test-plans/v6.62.0-renewal-free.md`。

## [v6.61.0] · 属性成长加成（2026-10-30）

**已上线（2026-10-30）**：push `d5889d0..0cde538`，CF Workers Builds Version `bc3c082e-4abe-4df1-ae55-ac0b21d65624`（2026-10-30T17:17:35Z）；迁移 `0084` 先于 push apply。前置生产数据批（同日执行，用户确认）：S9 属性回写 6 片落库（254 人 × 2,336 键回 FC26db 原值，`--verify` 差异 0）+ 公开缓存代际键 bump 两轮（1288 回写后 / 1289 部署后）。判级 minor。34 项细分属性改为「初始属性 + CA 成长点数」统一展示：`delta = max(0, ca − COALESCE(base_ca, ca))`、`显示属性 = min(99, 初始 + delta)`，唯一 helper `src/core/growth-attrs.ts`，列表/筛选/排序/详情/meta/导出五处共用；开关 `growth_attr_bonus`（默认开，'0'=三处回源值，双向实测）；页面不加「含成长」标注。生产探针：三方一致（列表 == 详情 == 导出 xlsx，样本 delta 13/8/3/0，撞 99 封顶验证过）、初始视图回源值、门将键同样加成、非 34 项键（身高/CA/PA/PSID）原样；tour 仓 meta 为纯展示消费、契约形状未变，无需发版。上线记录见 ROADMAP v6.61.0 节。

**Added**

- `src/core/growth-attrs.ts`：`growthDelta` / `buffedValue` / `buffedAttrs` / `growthDeltaSql` / `attrValueSql`（SQL 取值表达式唯一生成器，缺键透传 NULL）；`tests/growth-attrs.test.ts` 20 例。
- config 注册 `growth_attr_bonus`（默认 '1'）+ 迁移 `0084_growth_attr_bonus.sql`。
- S9 属性回写批 `scripts/prod-20261025-s9-attr-rewind/`：254 人 × 2,336 键改回 FC26db 原值（S9 手工订正转为由 delta 重新加成，避免「S9 值 + delta」双份）；只读预检 0 差异，**写生产库等用户确认**。

**Changed**

- `src/worker/routes/players.ts`：attr 取值/区间筛选/属性排序吃加成值，详情 `gameAttrs` 与 `/players/meta` attrs 整包加成；列表与 meta 缓存键带开关后缀 `:b{0|1}`；顺带修 attr 缺键取值从 0 回归 null（缺键不再凭空得 delta）。
- `scripts/prod-20261011-s10-export-squad/gen-export.ts`：34 项能力列走同一 `buffedValue` 出口；`--verify` 加 0–99 越界断言；快照带 `base_ca` 与 `attrBonusEnabled`（旧快照需重跑）。

**验收**：typecheck 三份全清；vitest **173 文件 / 2,798 例全绿**；build 6.61.0。测试计划 `docs/test-plans/v6.61.0-attr-growth.md`。

## [v6.60.11] · 兼任本队教练的管理账号能自己选成长方案（2026-10-30）

**已上线（2026-10-30）**：与 v6.60.10 同趟推送 `81d9926..d5889d0`，CF Workers Builds Version `4002b34f-389f-4443-87ce-908f332906be`（2026-10-30T13:33:05.580Z）。无迁移、无 schema 变更。依据用户口径：「我作为超管和里昂教练，怎么不能选我队人的成长方案？」。判级 patch。

**Fixed**

- v6.60.5 把成长入口从「本队教练或管理组」收成「球员所属俱乐部的教练」时，判据写成了 `user.role === 'admin' || 绑定不匹配`——管理组账号被角色一票否决，连带把「超管本人就是这支队教练」的情况也挡在外面（生产里超管兼任里昂教练）。现在两处服务端闸（`POST /api/growth/levelup/:playerId`、`POST /api/growth/china-playstyles/:playerId`，`src/worker/routes/growth.ts`）只按认证中心绑定判：`getBoundClub(user)` 的俱乐部必须等于球员 `club_id`。没绑队的纯管理账号 `getBoundClub` 返回 null，照样 403——「管理组不能代办」的初衷不变，变的是「兼任教练的管理账号能自己办」。
- `web/src/pages/Player.tsx`：`GrowthBlock` 的 `canManage` 由 `user?.role === 'coach' && isMine` 改为 `isCoach && isMine`（`isCoach` = 教练或管理组，`isMine` = 绑定俱乐部就是这名球员现属俱乐部），与服务端同口径；按钮与只读提示的切换只认绑定。
- 测试：`tests/growth.test.ts` 新增 1 例——把管理账号绑到球员所属俱乐部后可升级（200，CA 78→79），绑的是别队则 403；`web/src/pages/Player.test.tsx` 的 TC-GROWTH-PERM-03 改判「兼任本队教练的管理账号能选方案」、新增 TC-GROWTH-PERM-04「管理账号绑的不是这支队时仍只读」。

**同轮生产数据（无代码变更）**：`config.squad_min` 19 → **20**（一线队下限），脚本 `scripts/prod-20261030-squad-limits-revert/04-squad-min-20.sql`，回滚见该目录 README。

**验收**：typecheck 三份全清；vitest **172 文件 / 2770 例全绿**（`tests/growth.test.ts` 29 例、`Player.test.tsx` 32 例）。

**上线回读**：入口资产 `assets/index-DNEanvbb.js` + `assets/index-zWdqEd9v.css`（与本地构建同哈希；JS 714,915 B / gzip 225.71 kB、CSS 113,889 B）；`/api/health` 三项 d1/tour_db/kv 全 ok；`/api/market/listings` 200、24 条在售，强拍三条（id 19/18/17）在位次 1–3（v6.60.10 的排序同时生效）；`config` 四项 `squad_min=20 / squad_max=30 / trainee_max=7 / ca_pa_limits 两档 growthPa87=6`。

## [v6.60.10] · 强制挂牌在转会区置顶、卡头「强拍」徽标（2026-10-30）

**已上线（2026-10-30）**：与 v6.60.11 同趟推送 `81d9926..d5889d0`，CF Workers Builds Version `4002b34f-389f-4443-87ce-908f332906be`（2026-10-30T13:33:05.580Z）。无迁移、无 schema 变更。依据用户口径：「强制挂牌在转会区始终排在最前」。判级 patch。

**Changed**

- `src/worker/routes/market.ts`：卡柜 `GET /api/market/listings` 的排序由 `ORDER BY l.id DESC` 改为 `ORDER BY CASE l.type WHEN 'forced' THEN 0 ELSE 1 END, l.id DESC`——管理端挂的强制拍卖单恒在这 50 条里排最前，同一档内仍按新旧倒序；仍是一条语句，不额外加查询。已核全仓无 `cursor` 消费方（`web/src/lib/queries.ts:215` 的 `useBoard`、`:225` 的 `usePlayerListing`、`web/src/pages/admin/MarketPage.tsx:427` 都是单次取），键集翻页若将来启用也只会在同一档内连续。
- `web/src/pages/market/MarketBoardPage.tsx`：卡头 `.badge-stack` 里补一枚红色「强拍」徽标（`listing.type === 'forced'`），放在激活徽标之前。排序把强拍顶到最前后，光靠位置看不出它为什么在最前，徽标把这层身份说出来。浮层与卡头共用的 `listingBadge()`（`web/src/pages/market/MarketListingOverlay.tsx:22`）不动，forced 单在浮层里仍按竞价状态显示「竞价中」。
- 测试：新增 `tests/market-listing-order.test.ts` 3 例——两条强拍 + 两条普通混排后取序为 `[4,2,3,1]`、强拍 id 更小仍置顶（`[1,9,5]`）、`status=all` 与 `status=active` 同口径；`web/src/pages/market/MarketCard.test.tsx` 新增「强拍徽标」1 例（forced 出「强拍」，normal / activation 都不出）。

**同轮生产数据（无代码变更）**：按用户口径「＜87 且 PA≥87 且未练满可成长改回6个，一线队改回30人上限，训练营改回7人上限」，生产 `config` 三行回调——`squad_max` 32 → **30**、`trainee_max` 8 → **7**、`ca_pa_limits` 顶级 `growthPa87` 7 → **6**（次级本就是 6）。代码默认值本来就是 30 / 7 / 6（`src/core/config.ts:125-130`、`src/core/squad-rules.ts:18-19`），是生产库被调上去的，故只改数据；`squad_min`(19) / `gk_min` / `ge90` / `ge87` 不动。SQL 与回滚语句见 `scripts/prod-20261030-squad-limits-revert/`；`CONFIG_TTL_MS = 60_000`，改完一分钟内全边缘生效，不清缓存、不重新部署。

**验收**：typecheck 三份全清；vitest **172 文件 / 2768 例全绿**（新增 `tests/market-listing-order.test.ts` 3 例、`MarketCard.test.tsx` +1 例）；build `index-16jJxkri.js` 714.95 kB / gzip 225.72 kB、CSS `index-zWdqEd9v.css`（与 v6.60.9 同哈希）。

## [v6.60.9] · 挂牌卡窄屏 CA/PA 挪到价格三行右边（2026-10-30）

**已上线（2026-10-30）**：push `2cf8df6..81d9926`（分支 `fix/v6.60.5-forced-fc-growth-perm` → `main`，同趟带上 v6.60.8 的上线记录 `b1d1c46`），CF Workers Builds 自动部署 Version `1d276ba6-462f-44e7-b3af-6c32c29f1874` @2026-10-30T13:00:23.546Z；无迁移、无 schema 变更。依据用户口径：「挂牌卡窄屏把CAPA模块放在挂牌价当前最高出价次数的右边，以节省纵向空间」。判级 patch。

**Changed**

- `web/src/pages/market/MarketBoardPage.tsx`：`MarketCard` 的 `.mkt-rail`（CA/PA）与 `.mkt-rows`（挂牌价 / 当前最高 / 出价次数）包进新的 `.mkt-card-mid`。桌面形态不变（CA/PA 自成一条压在价格三行上），DOM 顺序也不动（rail 仍在前），换位只靠 CSS。
- `web/src/styles.css`：新增 `.mkt-card-mid`（`flex-direction: column`）与 `@media (max-width: 760px)` 重排块——容器翻成 `row`，`.mkt-rail` 给 `order: 1` 换到右边（读屏顺序仍按 DOM）、`flex: 0 0 auto` 不被压，`.mkt-rows` 给 `flex: 1 1 auto` 吃左侧剩余宽度；rail 原有的左边框在横排下正好当分隔线，不另加边框。真机几何（构建产物 + 卡片真 DOM 在 Chrome 里量）：375 视口卡片高 **258px → 191.4px**（省 66px，等于 rail 一整条 + 层间 8px）；320 视口价格三行仍有 142px 宽、`rowOverflow=false`、文档零横向溢出；1440 视口仍竖排（rail 在 rows 上方）。
- 测试：`web/src/pages/market/MarketCard.test.tsx` 新增「中段容器」1 例（rail 与 rows 同属 `.mkt-card-mid`、DOM 顺序仍 rail 在前、卡脚在容器外）；新增 `tests/market-card-narrow-layout.test.ts` 3 例——文本级锁住容器竖排基规则、「≤760 块里 row + `.mkt-rail{order:1}` + `.mkt-rows{flex:1 1 auto}`」、以及 JSX 里 rail/rows 确实落在容器内（媒体块或 order 被下批重构删掉就红）。

**验收**：typecheck 三份全清；vitest **171 文件 / 2764 例全绿**（新增 `tests/market-card-narrow-layout.test.ts` 3 例、`MarketCard.test.tsx` +1 例）；build `index-BNmzvrwg.js` 714.95 kB / gzip 225.71 kB（原始 714,946 B）、CSS `index-zWdqEd9v.css` 113.89 kB；e2e **29/29**（首轮 ⑫ 全路由 375 溢出扫描超时误报，单跑 ⑫ 92s 通过，全量重跑 29/29）。

**上线回读**：线上入口资产 `index-BNmzvrwg.js` ＋ `index-zWdqEd9v.css`（与本地构建同哈希）；`/api/health` 200；`/api/market/listings` 200。

## [v6.60.8] · 挂牌卡队徽与领先买家、浮层首开、CA/PA 配色（2026-10-30）

**已上线（2026-10-30）**：push `cf9b74b..2cf8df6`（分支 `fix/v6.60.5-forced-fc-growth-perm` → `main`，与 v6.60.7 同一趟推送），CF Workers Builds 自动部署 Version `7fb2d985-7dfd-435e-857f-225b14305387` @2026-10-30T11:58:58.619Z；无迁移、无 schema 变更。依据用户口径：「修复转会区卡片队徽显示回退到色块+首字的问题」「修复剩余时间右边显示的不是当前领先买家的问题」，以及随后追加的「点击挂牌卡浮层首次开启慢」「挂牌卡的 CA/PA 要对齐五档配色方案」。判级 patch。

**Fixed**

- **队徽回落色块**：`web/src/pages/market/MarketBoardPage.tsx` 调 `TeamLogo` 时没传 `logoKey`，卖方与领先买家的队徽一律走 `team-logo-fallback`（队名哈希色块 + 首字）。现在页面用 `useClubsList()`（`/api/clubs`，服务端 clubs scope 缓存 24h、公开放行）折一张 `club_id → logoKey` 映射，`logoOf(clubId)` 同时传给卡片与浮层；浮层「卖方」行由 `MarketListingOverlay` 的 `logoOf?` 透到 `OverlayBody` 后一并生效。队徽真源仍是比赛系统 `team.logo_key`（`/api/clubs` 内部走 AUTH_DB `team.club_id` → TOUR_DB `team.logo_key`），本平台 `clubs.logo_key` 休眠列照旧不读不写；不把两次只读塞进 `/market/listings`（该端点无 `cachedJson`、公开限流 60 req/60s/IP，热路径不加读）。
- **卡脚右侧改为当前领先买家**：`MarketCard` 的 `.mkt-card-foot` 右半原先是卖方队名 + 卖方徽，与卡头重复且看不出谁在领先；现渲染 `highestBidder`（`领先` 小标签 + 买家队徽 + 队名，`.mkt-tn-lab` 新增），无人出价时给「无人领先」占位（`.mkt-tn.mkt-tn-none`），卖方向由卡头承担。与浮层 `MarketListingOverlay` 的「当前最高」行、`SideOps` 的同一口径对齐。
- **浮层首开慢**：浮层是点开才挂载的，详情请求（还要先跑 30s 合并的惰性结算）整个压在点下去那一刻。前端新增 `useListingPrefetch()`（`web/src/lib/queries.ts`，与 `useListingDetail` 共用 `listingDetailQuery(id)` 的 key/URL），卡片在 `onPointerEnter` / `onPointerDown` / `onFocus` 时 `prefetchQuery`，点开时多半已在缓存，且沿用全局 30s staleTime 不会白重取；后端 `src/worker/routes/market.ts` 详情端点把 `MAX(amount)`（最高活跃出价）与 `market_bid_paused` 两条串行 `await` 并进首个 `Promise.all`，整个端点从四趟 D1 往返降到两趟。
- **CA/PA 五档配色**：`web/src/styles.css` 的 `.mkt-rail-num` 自带 `color: var(--ink)`，与 `.attr-*` 同特异性又后定义，把 CA/PA 的档位色整片压成墨色（类照挂、色全丢）。按全仓既有写法（同 `.sqc-v.attr-*`）补 `.mkt-rail-num.attr-bad|weak|mid|solid|good` 五条覆盖，无值占位仍走 `--ink`。
- 测试：`web/src/pages/market/MarketCard.test.tsx` 改卡脚口径并新增「卡脚领先买家」4 例、「详情预取」1 例（12 例）；新增 `tests/market-card-attr-tone.test.ts` 2 例——文本级锁住五档覆盖规则存在且排在基规则之后（类名挂不挂看得见，层叠结果只有 CSS 能定，组件测试照绿）。

**验收**：typecheck 三份全清；vitest **170 文件 / 2760 例全绿**（新增 `tests/market-card-attr-tone.test.ts` 2 例、`MarketCard.test.tsx` +1 例）；build `index-BLrSp8W9.js` 714.95 kB / gzip 225.71 kB（原始 714,946 B）；e2e **29/29**（本地 wrangler 8791 读构建产物）。

**上线回读**：线上入口资产 `index-BLrSp8W9.js`（与本地构建同哈希）＋ `index-Cn8Mlo9O.css`（含 `.mkt-rail-num.attr-good`、`.mkt-tn-lab`），页脚版本 6.60.8；`/api/health` 三项 d1 / tour_db / kv 全 ok；`/api/clubs` 200 且 **20 支球队 logoKey 全非空**（队徽走真图的前置，抽查 `team/21/…png`）；`/api/market/listings` 200；`/api/market/listings/999999` 仍 404「这单挂牌不存在（或还没产生）」（详情端点并行化后 404 行为不变）。

## [v6.60.7] · CPU 队球员可强制拍卖，成交款销毁（2026-10-30）

**未上线**：本地分支 `fix/v6.60.5-forced-fc-growth-perm`，待用户下令发布；无迁移、无 schema 变更。依据用户口径：「CPU 队球员不参与强制拍卖改掉，可以参与，跟自由身一样」。判级 patch。

**Changed**

- 管理端强制拍卖取消 CPU 队门将：`src/worker/bypass.ts` `inspectForcedAuction` 不再对 `is_cpu` 球队报 400；预检与建单都可挂 CPU 球员。`approveTransferDeal` 对 `from_club_id` 为空或卖方为 CPU 的强制拍卖统一按成交价固定 F，跳过 RC 第一步直接谈工资。
- 成交与下架按「无收款人」处理：`src/worker/transfers.ts` 的 `saleFromClubId` 对 CPU 卖方置空（买方照付、**成交款销毁**、无卖方 `transfer_out`/`transfer_tax`），但球员落位用 `moveFromClubId` 仍从 CPU 队摘出，并新签 `release_fee = 成交价` 的合同；中国徽章回收/合同快照/需求清理改用 `moveFrom` 判据。
- `src/worker/market-settle.ts`：CPU 卖方到期无人出价不收下架费、不写 `delist_fee`、不造 `forced_no_bid` 解约单，球员留在 CPU 队；普通挂牌与有归属强拍行为不变。
- 市场列表/详情/我的出价对 CPU 卖方仍显示球队名（`seller_club_id` 非空），与自由身「自由身」展示不同；金额结算口径相同。

**验收**：typecheck 三份全清；vitest **169 文件 / 2754 例全绿**（`tests/forced-auction.test.ts` 增 CPU 成交与 CPU 无人出价用例，原 CPU 400 用例改为可挂）；build `index-CO-4PJe-.js` 714.95 kB / gzip 225.70 kB（原始 714,946 B）；e2e **29/29**（本地 wrangler 8791 读构建产物）。

**遗留**：发布待用户明确下令。

## [v6.60.6] · 单据详情路由抢占暗标读接口（2026-10-30）

**线上故障修复**：`GET /api/transfers/sea-sealed` 在生产恒返回 400「单据 ID 不对」。`src/worker/routes/market.ts` 的公开单据详情 `app.get('/transfers/:id')` 随 `marketRoutes` 在 `src/worker/index.ts:77` 先于 `transfersRoutes`（`:80`）挂载，Hono 先命中先赢，`sea-sealed` 被当单据 ID 解析成 `NaN`。教练侧 `useSeaPhase` 因此恒为 error（`retry:false`），`SideOps` 落回「海捞签入」按钮、`/market/free` 倒计时卡片整块不渲染——暗标段上线当日实际无法出标。

**已上线（2026-10-30）**：push `2e1692f..cf9b74b`（分支 `fix/v6.60.5-forced-fc-growth-perm`），CF Workers Builds 自动部署 Version `1742a5c3-11ff-4ed5-b195-13ad24e488c9` @2026-10-30T10:53:51Z；无迁移、无 schema 变更。上线回读：`GET /api/transfers/sea-sealed` 由 400 变 401「未登录」（说明请求已落到教练读接口的守卫上）、`GET /api/transfers/999999` 仍 404（数字单据详情照旧）、`GET /api/transfers/free-agent` 由 400 变 404（非数字路径不再被单据详情接住）、`/api/health` d1/tour_db/kv 全 ok、`/` 200。线上入口资产 `index-DYE0HKG3.js`：本版仅改后端，哈希变化来自页脚版本号注入口径（`vite.config.ts` 从 package.json 注入 `6.60.6`）。判级 patch。

**Fixed**

- `src/worker/routes/market.ts:1172` 路径参数加数字限定：`app.get('/transfers/:id{[0-9]+}')`，非数字路径交回 `transfersRoutes`；数字单据详情行为不变（不存在的 ID 仍 404）。
- `tests/sea-sealed.test.ts` 补回归用例：`GET /api/transfers/sea-sealed` 必须 200 且 `state==='sealed'`，同时 `GET /api/transfers/999999` 仍 404。此前该路径只有 POST 覆盖，GET 一律直接调 `loadSeaPhaseView` 函数，所以抢占一直没被测试发现。

## [v6.60.5] · 强制拍卖认 FC ID、自由身可挂、期限 X+2；成长入口按归属收口（2026-10-30）

**已上线（2026-10-30）**：push `ffbb870..c30a7d0`（分支 `fix/v6.60.5-forced-fc-growth-perm`），CF Workers Builds 自动部署 Version `d5c2a0b1-d9a1-42f8-9ff5-08aa77abd45e` @2026-10-30T10:18:19Z；无迁移、无 schema 变更。生产 `/`、`/players`、`/market`、`/admin/market`、`/api/market/listings`、`/api/players` 全 200，`/api/health` d1/tour_db/kv 全 ok；线上资产 `index-9JmPjVqr.js` 与本地构建一致（714,834 B）。依据用户口径：「管理端强制拍卖仍然会报错无归属或不存在」「自由身也能强制挂牌，拍卖款销毁」「强制拍卖期限 X 日挂牌 X+2 日预计成交」「管理组也不能替他人选成长方案」。判级 patch。

**Fixed**

- 管理端强制拍卖 ID 口径：`src/worker/bypass.ts` `inspectForcedAuction` 先按平台 `players.id` 查，查不到再按 `players.fc_id` 查（平台 ID 优先）；球员页上的 FC ID 现在可直接填。两套 ID 都查不到才报 404「球员不存在（平台 ID 和 FC ID 都查不到这个号）」；`ForcedAuctionReference` / 前端类型新增 `fcId`。
- 自由身也可强制挂牌：预检放行 `club_id IS NULL AND status='free'`，`listings.seller_club_id` 留空；成交时 `completeTransfer` 走 `saleFromClubId = null` 分支，买方照付、**成交款销毁**，并按成交价新签合同。自由身单取消回到 `free`；到期无人出价不收下架费、不造解约单（原本就没有合同可解）；有归属球员仍按下架费 + 解约处置。
- 预检里的在途判断改用解析后的平台 `player.id`（原来直接拿用户输入，FC ID 会查错行）。
- 强制拍卖期限延长：`src/core/market-rules.ts` `bidDeadline` 新增 `minOffsetDays`，强制拍卖创建、出价重算、列表/详情存量回退、惰性结算回退统一按 2 起算（X 日挂牌最早 X+2 日判定/预计成交）；普通挂牌保持 X+1。
- 管理端面板：预检失败不再被 `.catch(() => null)` 吞掉，直接显示后端原因；输入标签与说明改为「平台 ID 或 FC ID 都认，自由身也能强拍」；自由身成交款销毁、无下架费的口径写进提示。
- 球员页成长权限：`web/src/pages/Player.tsx` 的 `GrowthBlock` 新增 `canManage`（仅球员所属俱乐部的教练；管理组也不能代办），非所属教练（含管理组）不再渲染升级方案按钮与中国计划发放控件，只显示「只有球员所属俱乐部的教练能…」说明；服务端 `routes/growth.ts` 同步收紧——无绑定或非球员所属俱乐部一律 403，管理组不再豁免。

**验收**：typecheck 三份全清；vitest **169 文件 / 2752 例全绿**（新增强制拍卖 FC ID/自由身/X+2 用例、自由身成交/无出价用例与球员页成长权限三条（含管理组不可代办））；build `index-9JmPjVqr.js` 714.83 kB / gzip 225.69 kB；e2e **29/29**（本地 wrangler 8791 读构建产物）。

**遗留**：无（上线完成）；跨仓通知模板白名单仍待确认。

## [v6.60.4] · 放行即保护期结束（2026-10-30）

**已上线（2026-10-30）**：push `51bd43d..4671c36`（分支 `fix/v6.60.3-ca-pa-cap`），CF Workers Builds 自动部署 Version `69aa5509-0f0f-4945-b246-2268d8eb2429` @2026-10-30T08:29:48Z；无迁移、无 API 形状变更。生产 `/`、`/market`、`/api/health` 全 200（d1/tour_db/kv 全 ok）；线上资产 `index-DcqhI3Bf.js` 与本地构建逐字节一致（714,540 B，含 `6.60.4` 版本串）。判级 patch。依据用户口径：「放行球员应该是立即结束保护期，不是关窗后」。

**Changed**

- `src/worker/demand-ops.ts` `directTrioStatements`：第二条由写 `contract_pending_changes(source='rejection', protection_ticks_new=0)` 改为同批 `UPDATE contracts SET protection_ticks = 0 WHERE player_id = ? AND is_active = 1 AND club_id = ? AND guard`；rejectDemand、counterDemand 升档、expireDemands 升档三条路径共用，保护期当场结束，不再等关窗。
- `src/worker/transfers.ts` 买回 A 分支（原直拒恢复）：同一批把 rejection pending 换成 `UPDATE contracts SET protection_ticks = 0`，挂在 transfer 状态守卫上，排在合同快照恢复之后；价格两列仍原样。
- 文案同步：`src/worker/notify.ts` 两处站内信、`web/src/pages/market/desk/DemandSection.tsx` 确认/后果/升档文案、`web/src/pages/player/SideOps.tsx` 两处状态行，统一「保护期立即结束/已结束」。
- 历史 rejection pending 行仍由 `applyPendingContractChanges` 兼容（旧数据按原关窗时点 apply），新路径不再产生。

**验收**：typecheck 三份全清；vitest **169 文件 / 2745 例全绿**（`tests/demand-ops.test.ts` direct/升档断言改为无 pending + `contracts.protection_ticks=0` + 价格不变；`tests/renewal-window.test.ts` 买回 A 分支同步；`web/src/pages/market/desk/DemandSection.test.tsx` 新文案）；build `web/dist/assets/index-DcqhI3Bf.js` **714.54 kB / gzip 225.60 kB**。

**遗留**：无。

## [v6.60.3] · 成长 CA 不得超过 PA（2026-10-30）

**已上线（2026-10-30）**：push `7d14dd4..556cbb2`（分支 `fix/v6.60.3-ca-pa-cap`），CF Workers Builds 自动部署 Version `b0680776-2eae-4346-ae29-a0afaec6c836` @2026-10-30T08:04:16Z；无迁移、无 schema/API 形状变更。判级 patch（P0 竞速修复）。依据用户口径：「成长不能超过PA」。

**Fixed**

- `src/worker/growth.ts` `applyLevelUp`：读取 `ca/pa`，方案 CA 增量按 `max(0, min(plan.ca, pa - ca))` 截断；SQL 再用 `ca = MIN(COALESCE(pa, ca + ?), ca + ?)` 兜底，任何路径都不会把 CA 写超 PA。
- 带徽章的成长不受影响：CA 到顶后方案仍按原数量发银/金徽章、级数照常消费；返回/审计/通知使用实际入账 CA 增量（`requestedCa` 另存原方案值）。
- 生产数据订正：`players.id=42`（W. Pacho，club 33）本窗 S9W2 三次 +1CA 升级后 92/90；按「回退本窗」口径恢复 CA 89、levels_applied 0、保留 growth_xp 34 与徽章，删除 levelup 事件 7941/7948/7949，并写 `growth_levelup_rollback` 审计。订正后生产 `ca > pa` 行数为 0。

**验收**：typecheck 三份全清；vitest `tests/growth.test.ts` **28 例全绿**（新增 TC-GROWTH-PA-01 截断/到顶、TC-GROWTH-PA-02 到顶仍发徽章）；全量套件在新增 PA-02 前为 **169 文件 / 2744 例全绿**；build `web/dist/assets/index-DB3FXRkK.js` **714.55 kB / gzip 225.61 kB**，线上逐字节一致（714,552 B，含 `6.60.3`）。

**遗留**：无（保护期「立即结束」是同日另一项修复，另行记录）。

## [v6.60.2] · 强制拍卖：取消须有归属、无归属成交款销毁（2026-10-30）

**已上线（2026-10-30）**：push `dabfccf..f577661`（分支 `fix/v6.60.2-forced-auction-ownership`），CF Workers Builds 自动部署 Version `4b7c5258-7df6-4151-9098-4b1b6d26a98a` @2026-10-30T07:46:32Z；无迁移，无 API 形状变更。生产 `/`、`/market`、`/api/health` 全 200（d1/tour_db/kv 全 ok），管理端强制拍卖预检匿名 401；线上资产 `index-Bur5g9dD.js` 与本地构建逐字节一致（714,552 B，含 `6.60.2` 版本串）；部署后复核生产券账（巴黎 5 / 利物浦 15）、318 人 XP 4307.5、球员 2 free 均未被改动。判级 patch。依据用户同日口径：「强制拍卖取消必须有归属的限制，无归属球员拍卖得到的钱是走销毁」。

**Changed**

- `src/worker/bypass.ts` `cancelForcedAuction`：取消前 LEFT JOIN 球员校验归属；原卖家为空、球员无归属或已不在原卖家，409「球员已无归属或已不在原俱乐部，不能取消强制拍卖」，不再把无归属球员强改成 `normal`；还原语句同时押 `club_id = 原卖家 AND status='listed'`；审计补 `sellerClubId`。
- `src/worker/market-settle.ts` `settleListingForReview`：强制拍卖成交建单时，若球员已无归属（`players.club_id IS NULL`），transfer 的 `from_club_id` 写 NULL——成交款没有收款人，走现有「from 为空」路径销毁。
- `src/worker/transfers.ts` `completeTransfer`：先读球员当前归属；强制拍卖只有「仍归原卖家」或「已无归属」两种可过户，归属变成别队直接 409「球员归属已变更，强制拍卖单不能过户」。`saleFromClubId` 统一承接卖方账务/球员归属守卫/徽章回收/合同快照/demand 作废：无归属时不记 `transfer_out`、不记 `transfer_tax`（成交款全额销毁），球员从 `club_id IS NULL` 落到买方，并按谈判结果新签/复活合同；审计 after 加 `proceedsDestroyed: true`。

**验收**：typecheck 三份全清；vitest **169 文件 / 2743 例全绿**（新增 `tests/forced-auction.test.ts` 两条：无归属取消 409 且不改球员状态；无归属成交买方扣 5m、卖方零入账、球员与合同落到买方）；build `web/dist/assets/index-Bur5g9dD.js` **714.55 kB / gzip 225.61 kB**；e2e **29/29**（本地 wrangler 8791 读构建产物）。

**遗留**：未 push/部署，等用户明确下令；生产运营发券/XP/解约已另行执行并留审计，不属于本版本代码变更。

## [v6.60.1] · 球员页角色带恢复（2026-10-29）

**已上线（2026-10-29）**：push `b4468a5..49bafcd`（分支 `fix/v6.60.1-player-roles`），CF Workers Builds 自动部署 Version `14f48584-68d0-48d8-83e3-aa85da1b15d5` @2026-10-29T14:43:33Z；无后端、迁移或契约变化。生产 `/api/health` 200（d1/tour_db/kv 全 ok），线上资产 `index-pp6VPxdP.js` 与本地构建逐字节一致（714,552 B）；生产球员页 `/players/17`（重定向到 `/players/230621`）实渲染顶卡「角色 GK 门将 ++」（`role-chip role-plusplus`），1280 与 320 两档均无横向溢出。判级 patch。

**Fixed**

- v6.56.0 球员页全页重排（`f5f2453`）删除了属性页签头部 `RoleID1–5` 角色带，提交说明称已上移顶卡与右翼，但实际只搬了位置 chips 与热区图，角色带整块没有落点——球员页不再显示任何角色，只有对比页还保留。
- 现补回顶卡 hero：`角色` 标签 + 五槽 chips，`+` / `++` 沿用 `role-plus` / `role-plusplus` 配色；空槽与占位 `0` 由 `roleChs` 过滤，无有效角色时整条不渲染（不摆空标签）。新增 `.player-hero-roles` 样式，随窄屏换行、不横向溢出。
- FIT 卡的「最合适位置 / 角色」是推荐结果，与这条「球员当前装备角色」语义不同，两者并存。

**验收**：typecheck 三份全清；vitest **169 文件 / 2741 例全绿**（新增 TC-PLAYER-ROLE-01/02：角色带在顶卡且 `+` 档配色正确、占位 0/null 时整条不渲染）；build `web/dist/assets/index-pp6VPxdP.js` **714.55 kB / gzip 225.61 kB**；e2e **29/29**（本地 wrangler 8791 读构建产物）。

**遗留**：无（生产 1280/320 两档已实测角色带渲染且不溢出）。

## [v6.60.0] · 激活通知截图弹窗（2026-10-29）

**已上线（2026-10-29）**：push `186f087..373bd7a`（分支 `feat/v6.60.0-activation-proof-dialog`），CF Workers Builds 自动部署 Version `44b7e14d-696e-438b-ba80-b91dae4780b6` @2026-10-29T13:53:55Z；无迁移、无 schema 变更，也无后端/契约变更，沿用 `POST /api/media/activation`（5MB，png/jpeg/webp）→ `POST /api/market/activations`（`playerId` + `proofMediaKey`）。生产 `/`、`/players`、`/market`、`/shop`、`/ledger` 与 `/api/health` 全 200（d1/tour_db/kv 全 ok），`POST /api/market/activations` 匿名 401；线上资产 `index-Ck8kRwo1.js` 与本地最终构建逐字节一致（714,139 B，含「上传激活通知截图」「激活挂牌已提交」「6.60.0」文案）。上线记录文档提交触发同构重部署 Version `832f9492-4733-4f3a-9fae-047f4276b7b5` @2026-10-29T13:57:16Z，前端资产哈希不变。判级 minor（激活流程新增强制截图引导，用户可见）。设计与测试计划见 `docs/superpowers/specs/2026-10-29-activation-proof-dialog-design.md`、`docs/test-plans/v6.60.0-activation-proof-dialog.md`。

**Added**

- 新增共用弹窗 `web/src/pages/market/ActivationProofDialog.tsx`：拖拽/点选 png、jpg、webp，≤5MB，object URL 预览、可重新选择；按空文件 / 类型 / 体积顺序校验并就地报错；提交中锁关闭（Esc、遮罩、取消、重选），失败留在弹窗可重试，只有点「确认激活」才真正上传+建单。
- 文案：标题「上传激活通知截图」；说明「激活前，先在 QQ 私信对方主教练，再把通知截图传上来。」；三项检查为俱乐部名、球员名、「竞价结束后请选择是否匹配」；有真实队名/球员名时拼示例，否则回退规则原文。
- 两个激活入口统一走该弹窗：转会市场激活页（`MarketActivationPage`）与球员页 `SideOps`；删除隐藏 file input 与旧「证据制」长说明。

**Changed**

- 激活成功后的失效与提示沿用原链路：市场页失效 `['market','activatable']` / `['market','board']` 并摆出首价表单；SideOps 走 `refreshAfterMutation()` 并提示「激活挂牌已提交：5 分钟内出首价才算数。」。
- `web/src/styles.css` 新增 `.proof-*`（拖拽区/清单/示例/预览/错误）样式。

**验收**：typecheck 三份全清；vitest **169 文件 / 2739 例全绿**（较 v6.59.0 基线 167/2724 净 +2 文件 / +15 例，含组件 11 例、市场页提交链 2 例、SideOps 成功链 1 例）；build `web/dist/assets/index-Ck8kRwo1.js` **714.14 kB / gzip 225.52 kB**；e2e **29/29**（本地 wrangler 8791 读构建产物）。code-review 无阻断项；已补「先上传截图拿 key，再带 `playerId`+`proofMediaKey` 建激活」与 SideOps 成功路径用例。

**遗留**：上线后需手机真机手测相册选图、桌面拖拽与失败重试（本地 e2e 不覆盖真实相册）。

## [v6.59.0] · 消费中心「球场与冠名」页签 + 子设施档位上限 + 队壳首窗（2026-10-29）

**已上线（2026-10-29）**：push `1db7dee..f584130`（分支 `feat/v6.59.0-venue-tab`），CF Workers Builds 自动部署 Version `bab2d987-cc20-420b-ad55-20e62cc8bfb5` @2026-10-29T08:16:13Z（此后仅文档提交的同构重部署，前端资产哈希不变）；无迁移、无 schema 变更。生产冒烟 `/api/health`、`/`、`/shop`、`/players`、`/market`、`/ledger` 全 200，`build-info` 与队壳下单匿名 401，线上 `ShopPage-DgSGhRTF.js` 与本地构建逐字节一致（含「球场与冠名 / 已达上限 / 建议达到 / 赛季第 1 个窗口」文案）。判级 minor（消费中心页结构、施工规则与队壳窗口均有用户可见变化，端点仅新增响应字段，向后兼容）。测试计划见 `docs/test-plans/v6.59.0-venue-tab-shell-window.md`。

**Added**

- 消费中心新增「球场与冠名」页签并排第一：设施经营卡与冠名市场卡从主栏底部移入该页签，其余商品页签不再渲染两卡；`?tab=venue` 可深链直达，缺省仍落「买 PA」。
- `GET /api/club/stadium/build-info` 新增 `facilityCap` 与每项设施的 `cap` / `canUpgrade`（子设施上限 = 球场档位 `tier+1`，最高 5）；`maxOpenTierName` 供前端展示开放到的档位名。

**Changed**

- 球场升级删除「容量 ≥ 下一档 `min_seats`」硬闸：座位低于建议值也能升档（仍受开放进度 `stadium_max_open_tier` 与资金/消费券闸约束）；文案改「建议达到 N 座」，`nextTier.capacityOk` 字段移除。
- 面向用户的球场档位整体 +1（库内 `tier=0` 显示「社区级 (1)」）：设施卡、升级行、开放进度、主场档案四处统一。
- 子设施上限随球场档位：社区级只能升到 1 级，升球场后逐级解锁；到当前上限显示「已达上限（升级球场后解锁）」，只有 5 级才显示「满级」；五个子设施改为各自成行并附效果说明，医疗中心本轮前端隐藏。
- 队壳申请只在赛季第 1 个窗口（`window_seq=1` 且开窗）放行：后端 409 `shell_first_window`，前端按钮同口径禁用并显示专属提示。

**验收**：typecheck 三份全清；vitest **167 文件 / 2724 例全绿**；build `index-CPlHw6a3.js` 710.75 kB / gzip 222.89 kB；e2e **29/29**（⑱ 改为校验页签顺序与 `?tab=venue` 两卡归属，375 下页签 6 个可横滑、`.facility-row` 四行零溢出）。

## [v6.58.1] · FIT 卡展示修复（色块/百分号/门将口径）+ 候选名单按钮配色（2026-10-29）

**已上线（2026-10-29）**：push `250c375..29be48b`（分支 `fix/v6.58.1-fit-display`），CF Workers Builds 自动部署，前端资产 `index-C1cbOFAR.js`；生产 `/api/health` 200，`/players/17`（Donnarumma）FIT 卡四行为 99% / 92% / 85% / 0%，分数背景透明。tour 仓 v5.11.1 同口径同日发布（`78ad9c2..b007f62`，资产 `index-BiZQNXZt.js`）。判级 patch（纯展示修复，无契约与数据变更）。

**Fixed**

- FIT 适配度卡的主数字不再被色块覆盖：v6.58.0 把分数与进度条也挂上 `.fit-dot-*`，而 `.fit-dot-good/mid/low` 自带实心底色、文字又染同色，数字渲染成纯色方块。现拆成 `fit-tone-*`（只给文字/条上色），`.fit-dot-*` 只留给圆点；分数后统一加 `%`（如 `99%`）。
- 门将口径改为**引擎级**（用户追加要求「tour 那边的计算公式也要对齐」）：`fitTile` 对门将群把三个门将槽位的个人内百分位映射到 **85–99**（99/92/85，最差也绿档）、外场槽位统一 **0%**（门将不客串，不再隐藏）；场上群球员的 GK 槽位仍无档。展示层删除 `gkDisplayTile` 二次映射。tour 仓同口径修复（v5.11.1：`shared/fitScore.ts` + `fitTileTip` 门将外场文案 + `fitBenchTopTags` 跳过跨群槽），club 移植件与 tour 逐字同步，`fit-dual-run.fixture.json` 按 tour 新引擎重生成（`_meta.tourRef=tactics-v5.10-v5.11@3e6e91f`）。
- 球员页「加入候选名单」按钮去掉 `btn-ghost`，恢复主色赭色 `--terracotta`（#a4612c），与「加入对比」同色；选中态用 `--terracotta-deep`。

**验收**：club typecheck 三份全清；vitest **167 文件 / 2722 例全绿**（引擎门将映射/外场 0/对拍快照同步 + 新增 tip 用例）；e2e **29/29**；build `index-C1cbOFAR.js` 710.74 kB / gzip 224.25 kB。tour typecheck 两份全清、vitest **57 文件 / 697 例通过（7 跳过）**、build `index-hxiuqAVQ.js` 501.63 kB / gzip 161.97 kB。本地用生产 Donnarumma 属性实测：FIT 卡 `GK 门将 99%` / `GK 清道夫门将 92%` / `GK 出球型门将 85%` / `LB 边后卫 0%`，分数背景透明；登录态按钮背景 `rgb(164, 97, 44)` 与「加入对比」一致。

## [v6.58.0] · 候选名单（FM shortlist）+ 消费券俱乐部级券账（2026-10-29）

**已上线（2026-10-29）**：push `b712c32..e16c74f`（17 个提交，含 code-review 修复），CF Workers Builds 部署 Version `81ee3c18-cc28-455e-a8b0-ceb1d73b4595` @2026-10-29T05:22:31Z。迁移 `0082` 于 push 前 apply、`0083` 在确认线上版本后 apply（顺序见下方 Fixed 🔴）；上线对账生产 20 俱乐部 / 18 账户 / 18 球场，旧列 `build_credit` 全 0 ⇒ `migrate` 流水 0 条、券余额 0、`vouchers` vs `SUM(voucher_entries)` 零差异；冒烟 `/api/health` 200、公开页 200、`?shortlist=1` 与券端点匿名 401、前端资产 `index-F1ljf5ws.js`。跨仓通知模板白名单（`shortlist_*` 三模板，与 `demand_*` 同款）仍待办。判级 minor（新增用户可见能力；建设券语义升格、旧列清零，无跨仓契约破坏）。设计/测试计划见 `memory/plan-v6.58.0-shortlist-voucher.md`、`docs/test-plans/v6.58.0-shortlist-voucher.md`。

**Added**

- 候选名单（FM shortlist）：俱乐部级私人跟踪名单（`player_shortlist`，cap=`shortlist_cap` 默认 30，界 0–100）；五端点 GET 列表 / GET ids / POST / PATCH 备注 / DELETE；球员库星标列（登录态可见，窄屏卡片同）、「只看候选名单」筛选与 `?shortlist=1`（服务端绕公开缓存）、球员页 SideOps 开关、球队页工作台 ShortlistCard。
- 三事件站内信：被挂牌（挂牌价 + 预计截止）/ 被签走（成交价 + 买方）/ 解约变自由身（原俱乐部）；只发收藏者俱乐部且排除操作方。五条成交路径统一挂在 `completeTransfer`，解约挂 `completeTermination`。
- 消费券（券账）：`ledger_accounts.vouchers` + `voucher_entries`，券余额与流水同批原子；建设域支出/返还改走券账，随机事件发券改 `event_grant`；消费中心工单**先券后钱**强制全额抵扣、拒绝双退（现金 `amount−voucher_used` + 券 `voucher_used` 各自回原）；财政账本新增「消费券流水」页签；管理端 `POST /api/admin/vouchers/grant`（按俱乐部或全量、`requestId` 幂等）+ 俱乐部页行内发放入口。
- 迁移 `0082` 建表/加列、`0083` 把存量 `stadiums.build_credit` 幂等搬进券账（补账户行、写 `migrate` 流水、按流水重算余额、清零旧列；拆两枚文件保证可重放测试）。

**Changed**

- 「建设券」统一更名「消费券」，审计字段 `buildCredit`→`voucherBalance`，`GET /club/stadium/build-info` 回 `voucherBalance`；config 注册 `shortlist_cap`（注册表 88 键）。

**Changed（同日用户追加裁决）**

- 强制拍卖到期/窗尾无人出价：不再「球员留队」，改按**解约处置**——球员去归属变自由身（解约单 `type=termination`、`idempotency_key=forced_no_bid:{listingId}` 留档），`checkSeaSignEligible` 的本窗解约禁签闸自然生效（**本窗所有球队都不能海捞他**）；10% 下架费照收。成长清零/徽章/候选名单「解约」通知复用 `completeTermination`，不另起一套解约语义；admin 强制拍卖说明与卖家浮层文案同步。
- 球员页 FIT 适配度卡改展示**个人内百分位**（`fitTile`，即绿/黄/橙三档的同一依据），主数字与分值条都换百分位，不再显示 `rankShown` 绝对分——避免「本站估算 FIT 分」被当成第二种能力值；展示行改按百分位降序。

**Fixed**

- `GET /club/shortlist/ids` 补 `entries[{id,playerId}]`：首版只回 `playerIds`，球员页 SideOps 取行 id 移出时 `undefined.find` 白屏（e2e ⑤f/⑯/㉑ 捡出）。

**Fixed（2026-10-29 code-review：2 🔴 + 11 🟡 全部修复）**

- 🔴 券余额等值守卫在 REAL 上精确比较：`0.4` / `0.11` 这类常见余额扩建直接 409（`0.4−0.1=0.30000000000000004`）。删等值守卫（`changes()>0` 串联已足够），`voucherMovement` 金额与余额 `ROUND(…,2)`，`0083` 搬运与重算同步取整。
- 🔴 上线顺序丢券：runbook 改为「`0082` → 部署 → 确认版本 → `0083`」（原因见上方未上线说明）。
- 🟡 零券施工不再落 0 元 `build_use` 流水；事件负向 `build_credit` 按可用券截断、工单负券按 0 抵不多收现金；强拍解约失败清理半成品 `pending_review` 单（不再挡住重试）；候选列表补 `fcId`；发券改为**逐家审计 + 40 家分片 + 返回 `granted/replayed`**（`all=true` 跳过 CPU 队）；发券 UI 的 `requestId` 改为打开表单时固定（超时重试不会换 id 双发）；候选通知改**有界并发 8**（单个 watcher 失败不阻断其余）；球员页/球队台/球员库三处候选操作失败接 toast；券流水支持游标「再看 30 笔」；`GLOSSARY` 补「事件发放」来源；FIT 档位改为 `fitTone()` 直接返回档位（去掉字符串裁剪）；星标/移出去掉 refetch + invalidate 双拉。

**验收**：typecheck 三份全清；vitest **167 文件 / 2721 例全绿**（新增 7 例评审回归）；e2e **29/29**（本地 shared 模式）；build 成功（`index-F1ljf5ws.js` 710.67 kB / gzip 224.22 kB）；测试计划 §四变异 **7/7 命中**（其中挂牌截止断言原为空转，已补强为「截止时刻真值」值断言后命中）。

## [v6.57.2] · 球员页窄屏操作区前置 + fit 图例删除（2026-10-29）

**已随 2026-10-29 批次上线**（Version `a05fb061-4ca1-4d6c-b587-ae592fb30c3d`，push `0fa1141..b712c32` 共 24 提交，0081 已于 push 前 apply；上线记录见 [ROADMAP.md](./ROADMAP.md) v6.57.2 节）。判级 patch，两项用户裁决，测试计划 `docs/test-plans/v6.57.2-narrow-ops-first.md`。

**Changed**

- 球员页窄屏（≤1050）堆叠序改为：顶卡 → **操作区**（报价/挂牌/海捞/续约）→ 主列页签 → 位置分布/身份徽章/PlayStyles；宽屏（>1050）布局不动（grid-template-areas 双口径，DOM 阅读序不变）。
- FIT 适配度卡底部的图例说明文字（「数字 = 联盟绝对适配…」）整段删除，对应死样式一并清理。

## [v6.57.1] · 收口审：三组终验与变异验证捡出的修复 + 性能口径补测（2026-10-29）

**已随 2026-10-29 批次上线**（迁移 0081 已于 push 前 apply 到生产）。判级 patch。终验/变异/修复由 dynamic-workflows 收口工作流执行（全 Flash），全量证据与不修项清单见 [ROADMAP.md](./ROADMAP.md) v6.57.1 节。

**Fixed**

- config 注册 `expected_income_rate` 键（运营调 k 不再 400「未注册的 config 键」，默认 1.0）。
- 球员页：被激活挂牌球员恢复「挂牌中」可见性（重排回归）；属性页签空态不再掏空主列；窄屏横滑页签路由切换后滚进视野；≤360 顶栏首行间距。
- 报价/还价/接受弹层与解约确认区补「本次动用预期收入」行（v6.57.0 设计 §2.3 补漏）。
- 提交切分倒置 rebase：v6.55.0 等四个提交重写为单点 checkout 自包含（原引用 v6.57 才落地的符号，bisect 有坑；未推送故安全）。

**Added（测试与审计）**

- TC-A/TC-B 计划缺口补强：occupy 非卖品守卫源码文本锁、多笔意向清单断言、dup 409 幽灵冻结残留断言、额度子查询 EXPLAIN 结构锁、TC-B-038 作废/静默超时三向合取等（vitest 164 文件 / 2696 例全绿）。
- fit 对拍改快照制常开锁（原写死路径恒 skip）+ role.json 反推跨检 + smoke 探针判据与 fit 渲染同源。
- `scripts/d1-read-audit/probe-expected-income.mjs` 生产只读探针（SQL 直接 import ledger.ts 真函数，零漂移）与实测登记（`README.md` 第十二节）：balance 8/12/2 行读、credit（触发器写放大单位）7/6/1、breakdown 8/7/2，三来源基表全 SEARCH 走索引。
- 额度线**并发压测口径**（`scripts/load/credit-line-load.mjs` + 测试计划 `docs/test-plans/v6.57.1-concurrency-load.md`，本地真栈）：800 并发读快照恒等式零违例；24 并发挤兑恰 `floor(可支配/100)`=15 单接受、9 单资金拒、零 5xx；压后库内/快照对账吻合；直库超冻被 0081 触发器拦截。

## [v6.57.0] · 预期收入额度线：窗口内预支未到账的卖人收入（2026-10-28）

**已随 2026-10-29 批次上线**（迁移 0081 已于 push 前 apply 到生产）。判级 minor。设计 `docs/superpowers/specs/2026-10-27-expected-income-credit-line-design.md`、测试计划 `docs/test-plans/v6.57.0-expected-income-credit-line.md`（38 TC）。

**Added**

- **额度公式**：`expectedIncome = Σ每球员在途净额取最高`（源① 挂牌最高 active 出价 / 源② 待审·签约中**成交类**单——type 白名单 `transfer/activation/forced_auction`，挡 rc_change 等假额度）× k（config `expected_income_rate`，钳制式：缺行 1.0、写非法值归 0 = 关闸，fail 严格方向）；`available = balance − held + creditLine`。落空自然收缩（驳回/作废即缩水，负可用挡冻结型支出，「负=欠款」沿用现状哲学）。
- **迁移 0081**：0005/0063/0070 三个资金触发器资金式接额度子查询，顺手包死全部 NULL 可达闸位（幽灵挂牌/无账本行/幽灵标原为 fail-open）；非资金闸逐字保留。
- **四处公式真源收口**：ledger.ts 单点定义 + balance 端点统一走 ledger（新字段 expectedIncome/creditLine）+ chargeBypassFee 批内守卫同步接额度（堵 409 死锁）与 settled/extra_fee 双守卫（堵静默失败）+ 五处资金文案标明含额度。
- **前端增强档**：Ledger/转会台余额行「可支配 X m（含预期收入 Y m）」+ 负可用中性红字；MarketBoardPage/ListingsBidsSection 两处自算收编；`credit-line.ts` 动用额（旧冻结回加四处同源）；出价/海捞/续约/匹配确认区「本次动用预期收入 W m」。球场扩建与商场工单保持现金口径不动（Q4 明确排除）。

## [v6.56.0] · 球员页全页重排 + fit 适配度引擎移植（2026-10-28）

**已随 2026-10-29 批次上线**。判级 minor。计划 `memory/plan-v6.55.0-attr-head-relayout.md`、测试计划 `docs/test-plans/v6.56.0-attr-head-relayout.md`（25 TC）。

**Added**

- **fit 引擎移植**（自 tour 仓 `shared/`）：`web/src/lib/fit/`——fitScore 双指标（fitTile 个人内百分位分池出档 / rankShown 联盟绝对分）、roleFit 49 槽权重冻结表；断言逐字迁移 + `fit-parity.test.ts` 对 tour 引擎全量快照双跑（tour 仓不在场自动 skip）。
- **球员页 hero + 双翼重排**：顶卡 hero（贴纸卡框 + CA/PA/身价大数字 + quads + 对比入口）、双翼 `minmax(0,1fr)|300px`、属性页签雷达 350 宽 + fit 卡（前 4 槽三态色点 85/50）、右翼 SideOps 置顶 + 热区 + 身份徽章卡 + PlayStyles 卡；旧 `.attr-head`/`.star-line`/`.dossier` 布局退役，1050 双翼临界断点（mobile-baseline 静态锁改写）；雷达/热区语义零变化回归锁。

## [v6.55.0] · 标价↔最低报价自动对齐 + 意向单多笔并存·开窗择一（2026-10-28）

**已随 2026-10-29 批次上线**（零迁移零生产写）。判级 minor。设计 `docs/superpowers/specs/2026-10-27-intent-multi-and-price-align-design.md`、测试计划 `docs/test-plans/v6.55.0-intent-multi-and-price-align.md`（31 TC）。

**Added**

- **标价对齐**：降标价（含首挂）⇒ 最低报价自动对齐降至新标价（`minOfferPriceAdjusted{from,to}` 回执，前端回灌草稿）；抬底线/标价上升维持 400；审计仅对齐时追加 `minAlignedTo`（哨兵不弱化）。
- **意向单多笔并存**：唯一性球员级 → 买方级；卖方开窗择一确认，落选方自动失效收口 + `offer_intent_lost` 落选通知（NOTIFY_META 43→44）；确认 occupy 双闸（悬挂 accepted + 非卖品赛跑）、fulfill 批收口 UPDATE、`finalizeOffer` 终态守卫（堵资金洞）、`rollbackGhostOffer`、开窗提醒翻页取全 + 按球员聚合分角色文案。

## [v6.54.1] · 收口审捡出的市场域修复：标价区间与挂牌同规、边界取整、toast/z-index（2026-10-26）

**本地实现完成，未 push / 未 deploy，随 v6.54.0 同批上线**。判级 patch（独立于闹涨薪的市场域缺陷修复，v6.54.0 收口审发现）。测试计划 `docs/test-plans/v6.54.1-transfer-price-bounds.md`。

**Fixed**

- **标价区间与挂牌同规**（堵绕底洞）：`setOfferSettings` 的标价原用 `[1, 1.5×RC]`（与最低报价同区间）——标价 1m + 达线自动同意可绕开挂牌「五折底线」整条成交；现改用 `listingPriceBounds`（下限 = max(1, ⌈min(0.5×违约金, 0.5×身价)⌉)，上限 ⌊1.5×违约金⌋）。最低报价保持私密拒线语义 `[1, ⌊1.5×RC⌋]` 不动（v6.33.0 口径）。
- **边界取整**：出价/报价强制整数的体系里边界不该露小数——挂牌与标价上限 `floor`、下限 `ceil`（`market-rules.ts` / `offer-rules.ts`）。
- 前端：SideOps 报价面板显示挂牌下限（新增 `web/src/lib/transfer-bounds.ts`，评审后改派生自 `src/core` 单一出处（`3ae29c7`），与挂牌面板共用区间提示）；toast 3 秒定时器挂 ref（修连发被提前抹掉 + 卸载后 `setToast` 抛错）；toast z-index 100 → 950（修被 ≤760 底部抽屉压住）。

## [v6.54.0] · 球员主动要求续约/涨薪（闹涨薪）：生成、收件箱、还价、拒绝三件套、关窗生效（2026-10-26）

**本地实现完成，未 push / 未 deploy**。判级 **minor**（新域：合同要求收件箱 + 四张新表 + 6 个教练端点 + 球员页/球队页公开徽章；无破坏性契约变更）；`package.json` 6.53.5 → **6.54.0**。设计 `docs/superpowers/specs/2026-10-21-player-renewal-demand-design.md`（rev20）、计划 `memory/plan-v6.54.0-renewal-demand.md`、测试计划 `docs/test-plans/v6.54.0-renewal-demand.md`。

**上线前置（未执行）**：迁移 **`0079_renewal_demand.sql`**（`contract_demands` / `contract_pending_changes` / `contract_demand_attempts` / `transfer_requests` 四表 + `transfers` 快照三列）与 **`0080_contract_demands_status_expires.sql`** 必须先 apply 生产再 push——CF Workers Builds 只跑 `vite build && wrangler deploy`、无迁移步骤。**2026-10-26 只读查证**（`npx wrangler d1 migrations list whl-club --remote`）：两条仍在「Migrations to be applied」，生产未 apply。

**Added**

- 闹涨薪引擎 `src/worker/demand-ops.ts`：常规窗生成（门槛 → 倾向分 p → 确定性闸 → PPS 6 条/队硬上限，UNIQUE + `INSERT OR IGNORE` 幂等）、还价同请求即时判定（3 轮、判定种子 `seededUnit([demand_id, round], 21)`）、接受写 `contract_pending_changes(source='demand', rc_fee=0)`、直拒三件套（保护期失效 pending + 全联盟通告 + `transfer_requests.released`「不满」徽章）、累计第 2 次终局升档、过期与 24h 提醒、离队作废；纯函数层 `src/core/demand-rules.ts`（概率/金额/RC floor 取整/计数/判定）。
- 教练端路由 `src/worker/routes/contract-demands.ts`：收件箱三组 + `wageContext`、`accept` / `counter` / `preview`（零副作用）/ `reject`、存续转会申请、本队待生效合同（`/api/club/pending-contracts`）。
- 数据面接线（收口审修复补全）：`openWindow` 成功后调用生成批（返回值新增 `demandsCreated`，失败不阻塞开窗）；`scheduledTick` 新增 `ensureCurrentWindowDemands` 幂等补跑（当前窗无 demand 行才跑，TC-RD-18 #3）。
- 挂牌驱赶：`POST /api/market/listings` 与管理端强制拍卖在同一批里把待处理 demand 置 `expired`（`void_reason='listing'`，计数侧 `byListing` 过滤 ⇒ **不计累计终局**），并把存续转会申请 `pending → listed` 且回填 `listing_id` / `last_listing_window_seq`（§11.2 / §11.1）。
- 「不满」徽章全联盟可见（§5.4 三件套之三）：`GET /api/players/:id` 与 `GET /api/players` 列表行新增 `unsatisfied`（`transfer_requests.status='released'` 存续），球员页状态区与球队页阵容卡渲染「不满」；`released → resolved`（重签/离队）即摘除。

**Changed（既有行为变更 ①，必须单独上报）**

- **普通续约（`rc_change`）改关窗生效**（§5.7）：谈成时 contracts 的 `wage` / `release_fee` / `protection_ticks` **一字不动**，改写成 `contract_pending_changes(source='renewal')`；4.4.6「保护期收口」语义保留、时点迁移（`protection_ticks_new=baseTicks`，不写 NULL）；30% 续约费仍在审核通过时即时扣、写流水与审计，pending 记 `rc_fee` / `rc_fee_charged_at`，关窗 apply 不再扣款。4.4.10 窗内回滚（挂牌/激活/解约）改为**作废 renewal pending** + 退费。`source`（成约方式）不在关窗前不变的三列内，保持即时更新。
- **既有行为变更 ②**：`createRcChange` 新增「该球员存在未终局签约谈判 session（`active` + `signing`）→ 409」，堵住续约单进入 signing 后同一球员还能再提第二张续约单的旧缺口；另加「已有在途 `contract_pending_changes` → 409」（一球员最多 1 条待生效变更）。

**Fixed（收口审发现的实现缺口）**

- `triggerDemandBatch` 生产代码零调用点 ⇒ 开窗与 cron 双入口接线（此前 `contract_demands` 在生产永远是空表，收件箱/还价/通胀/三件套整链空转）。
- `contract_pending_changes.source='renewal'` 零写入点 ⇒ 普通续约改用关窗生效（见上）。
- 挂牌端点零 demand 处理 ⇒ 挂牌驱赶已接线（见上）。
- 「不满」徽章原只经本队教练两个私有面返回，他队/访客不可见 ⇒ 公开球员详情与列表行新增 `unsatisfied`（见上）。

**验收（本轮实测）**

- `npm run typecheck`（默认 + worker + tests 三份）**0 error**。
- `npm run build` 成功：入口 `dist/assets/index-CcG2ixpN.js` 686.04 kB / gzip 218.16 kB。
- 定向 vitest（未跑全量，全量由实施工作流统一门禁）：`bypass-routes` 19、`renewal-window` 14、`demand-ops` 39、`demand-api` 20、`window-machine` 14、`players-sort-indexes` 98、`players-library` 59、`market-routes` 39、`market-intel` 26、`demand-schema` 13、`ledger-audit-lock` 9、`routes` 50、`activation-match` 11、`ops-schedule` 17、`mobile-baseline` 44、`Player.test.tsx` 17 —— **16 文件 / 489 例全绿**。
- 注：收口时仓库根的 `npm run typecheck` 被另一会话在途的 `src/worker/offers.ts:1011`（v6.54.1 标价区间改造：`listingPriceBounds` 收到 `number | null`）打成红——该文件不在本增量改动集内，未触碰；本轮全部改动文件在 18:39 的 typecheck 与 16 文件定向测试中均无错。
- 新增回归：开窗生成 + 生成抛错不阻塞开窗（TC-RD-18 #1/#4）、`ensureCurrentWindowDemands` 幂等补跑（#3）、挂牌驱赶扩 expired 与申请转 listed、renewal 真实链路写 pending（contracts 不动 + `protection_ticks_new` 非 NULL + `rc_fee` 对账）、窗内回滚作废 renewal pending、「不满」徽章匿名/他队可见与 resolved 摘除、在途 pending 续约 409。

**已知未覆盖 / 待办**

- **生产迁移 0079/0080 未 apply**（见上）；apply 后仍需按发布纪律先迁移再 push。
- 全量 `npm test` / e2e 未在本轮执行（工作流统一跑）。
- 跨仓通知白名单（`demand_created` / `demand_deadline` / `demand_resolved` / `demand_rejected_public`）本地无法证实，上线前与插件侧确认（与 `window_signals` 同批）。
- `match`（匹配报价）不在 §5.7 枚举内，仍按 4.3.3 即时落库（边界已在 `transfers.ts` 注释写明）。

## [v6.53.5] · 字体源切换到平台共享源 fonts.whleague.win/v1（2026-10-25）

**已上线（2026-10-25）**：① 阶段 0 基建经用户授权执行完毕——桶 `whl-fonts` 建好，九件对象 put（`immutable` 头随 put 写入），CORS 配好（`*` / GET；实测坑：wrangler 4.131.1 拒 S3 风格裸数组，`cors.json` 须用 R2 API 形状 `{"rules":[{"allowed":{…}}]}`，收尾提交 `59a1674`），`fonts.whleague.win` 经 CLI 绑域生效（`wrangler r2 bucket domain add --zone-id 1fe7b8d2…`，证书约 1 分钟，期间 403）；验证过设计稿 TC-0a/0b/0d——九件全 200、`content-type` 逐件正确、`cache-control: public, max-age=31536000, immutable`、二次请求 `cf-cache-status: HIT`、带 Origin 回 `access-control-allow-origin: *`、线上 MANIFEST 与本地逐字段一致。② 用户令「上线」后 push `6d6c862..59a1674`（5 枚）⇒ CF Workers Builds 自动部署 Version **`cf6abdcf-e42e-4962-98fb-9db9983789e7`**（2026-10-25T02:52:24Z）；**四仓同轮上线**（探索B 阶段 1–3 一次做完）：tour push `65e481f..df63dcf` ⇒ Version `5a5b9dc4-bbd3-45ef-9d0f-d8626eb32310`（02:53:15Z）；guess push `8c47dc2..e943160` ⇒ Version `8ac03686-d9c9-45dd-b3cd-4dce59de808e`（02:53:54Z）；auth push `d177aca..95afac0`（**变更集两枚一起**：`a86dbc1` 切换 + `95afac0` CSP 指令顺序修正——font-src 若追加在 BASE_CSP 末尾，client 回调 origin 会整批灌进 font-src 且 form-action 丢白名单，生产登录跳不回 client）⇒ Workers Builds 自动出包（02:52:30Z，auth 也已接自动构建）后另有手动 `wrangler deploy`，生效 Version `3c82d375-6161-4e0e-bad9-bd0dd09ccfaf`（02:54:21Z；CLI 回显 `75a2629c` 为另一值，已知现象）。③ 线上回读（同日实测）：四站全部命中共享源——club 首页 preload 绝对 URL（crossorigin）+ CSS `index-BYHmvzgM.css` 内五件字体各 1 处；tour 同（`index-UJ1T41Zz.css`）；guess 两页 preload + `style.css` 6 处；auth `/login` HTML 四件 URL 且 CSP 头为修正后形态 `font-src https://fonts.whleague.win; form-action 'self' https://club.whleague.win https://guess.whleague.win https://tour.whleague.win`。**已知事项**：guess 线上页脚 `APP_VERSION` 暂为 1.1.1（1.1.2 双写在另一会话在途增量手里，落提交后随下次 push 归位）；TC-1 跨站缓存复用需浏览器实测（curl 无法演示按顶层站点的缓存分区）；阶段 4 清理（删四仓本地 woff2、auth 撤 assets 绑定）待令。判级 **patch**（纯展示层：5 条 `@font-face` 的 `src` 与 1 条 preload 换绝对 URL；零端点、零迁移、零业务规则改动）；`package.json` 6.53.4 → **6.53.5**。设计依据 `docs/superpowers/specs/2026-10-24-shared-font-source-design.md`（探索B · 阶段 1 = club 切换），计划 `memory/plan-v6.53.5-shared-font-source.md`，测试计划 `docs/test-plans/v6.53.5-shared-font-source.md`。

**改动**

- `web/src/styles.css`：顶部 5 条 `@font-face` 的 `src` 从 `/fonts/…` 相对路径换 **`https://fonts.whleague.win/v1/…`** 绝对 URL——衬线从本仓单仓子集 `noto-serif-sc-600-subset.woff2`（298,088 B / 2187 字）换成四仓并集 **`noto-serif-sc-600-union.woff2`**（330,604 B / 2389 字，`scripts/platform-fonts/output/v1/` MANIFEST 实测），Inter / JetBrains 四件同名直换（字节与本地逐字相同）。`unicode-range`、`font-weight` 区间（宋体 600 / Inter 100 900 / JBMono 100 800）、`font-display: swap` 全部原样保留，仍无 `local()`。文件头注释加版本锚「字体版本：v1（升级时全局替换 fonts.whleague.win/v1/）」，字体说明改指 `scripts/platform-fonts/README.md`。
- `web/index.html`：`inter-latin` 的 preload `href` 换绝对 URL，`crossorigin` 保留（字体天然 CORS 模式，缺失会双下载）；注释里的宋体字节数同步订正 298KB → 331KB（union）。
- `web/public/fonts/` 本地 5 个 woff2 **保留不删**：阶段 4 清理另轮授权，本轮留作回滚垫（`git revert` 即回本地自托管）。

**收益口径（设计稿 §7）**：四站顶层站点同为 `https://whleague.win` ⇒ HTTP 缓存同分区，Inter/JBMono/union 衬线在 club / tour / guess / auth 四站各只下载一次；四站全访首次字体传输 1.43MB → 约 0.47MB（−67%）。club 单仓代价：衬线 298,088 → 330,604 B（+33KB，union 比 club 单仓子集只多 4.5% 字）。

**验收**：本仓无字体断言（v6.53.2 起即无，grep `tests/` 无 woff2/fonts 引用），`tests/domains.test.ts` 的 apex 扫描不受影响（`fonts.whleague.win` 是子域，`whleague\.win(?![a-z0-9.-])` 负向断言不误伤）。全量 test / typecheck 由实施工作流统一执行（四仓门禁全绿：club 基线 + 切换后各一轮、auth 修复 1 轮后过）；共享源响应头三件套与 OFL 可达（TC-0 系列）已于阶段 0 后实测通过；线上回读见上段；TC-1 跨站缓存复用待浏览器实测、e2e 29 场景待下轮回归顺带跑（本轮 CSS/HTML 改动无交互面变化）。

## [v6.53.4] · 原生表单控件继承站点字体（2026-10-24）

**已上线 2026-10-24**：push `a187494..4578e8d`，Workers Builds 自动出包，生产 Version **`f0889ec2-a4c6-4cb0-ba9d-b59aeace3ee7`**。判级 **patch**（纯展示层：一条继承规则 + 一条 `.mono` 输入规则；零端点、零迁移）。`package.json` 6.53.2 → **6.53.4**（工作区里 6.53.3 已被另一笔未提交的 oidc 会话 TTL 改动占用，本轮不碰 `src/lib/oidc.ts`）。

**缘起**：用户反馈「club 注册工作台和阵容部分没有应用新字体选型」。先核生产：`assets/index-a0t867je.css` 与本地 `web/dist` 逐字一致，`h1,h2,h3{font-family:var(--font-display)}`、`body{font-family:var(--font-sans)}`、5 条 `@font-face` 都在线上 —— 三套字体与标题规则确实生效了。漏的是**原生表单控件不继承 `body` 字体**：Windows 上 `button` / `select` / `input` 落到 Arial，中文退到标准雅黑、`▾` 退到 Cambria Math。CDP 实测 `/clubs/1` 工作台页签 26 个控件里 **13 个 Arial**（`.sqc-assign-btn` 的「一线队 ▾ / 未分配 ▾」共 11 颗、两个「选一名球员…」`select`、续约表单的 `input.mono`）；阵容页签只有图标按钮 `.user-menu-btn` 命中（无可见文字）。

**改动**：`web/src/styles.css`（`body` 规则之后）

- `button, input, select, textarea { font-family: inherit; }` —— 字号、字重、颜色、边框一律不动，只把字族接回正文栈。
- `input.mono, textarea.mono, select.mono { font-family: var(--mono); }` —— 违约金 / 报价输入框里装的是金额，跟表格数字列同族。
- `span` / `td` 上的 `.mono` 仍不设全局规则：会改多张表的列宽（v6.53.2 待办③，另开一轮评估）。

**验收实测**：CDP `CSS.getPlatformFontsForNode` 复核 —— `.sqc-assign-btn` 从 `Cambria Math + Microsoft YaHei` 变为 `Microsoft YaHei UI`，`select` 从 `Arial + Microsoft YaHei` 变为 `Inter + Microsoft YaHei UI`，两个页签的 Arial 控件 **13 → 0**；`h3` 仍是 `Noto Serif SC SemiBold`、`.sqc-v.num` 仍是 `JetBrains Mono`（没被顺带改掉）。`npm run typecheck` 三份 **0 error**；`npm run test` **144 文件 / 2390 例全绿**；`npm run test:e2e` **29/29**（含 375 零溢出断言）；`npm run build` ✓。截图 `C:/tmp/fontwork/fix-desk-1440.png`、`fix-squad-1440.png`、`fix-desk-375.png`、`fix-squad-375.png`，另加按钮/下拉 3x 特写。

**上线回读**：生产 CSS 从 `assets/index-a0t867je.css` 变为 **`assets/index-Sa2bA2mD.css`**（96,366 B），含 `button,input,select,textarea{font-family:inherit}` 与 `input.mono,textarea.mono,select.mono{font-family:var(--mono)}`；`noto-serif-sc-600-subset.woff2` 200 / 298,088 B、`inter-latin` 200 / 48,444、`jbmono-latin` 200 / 40,404；匿名打开 `/players?limit=20`，页脚 **v6.53.4**，8 个可见 `button/select/input` 的 computed 首族全为 `Inter`。

**界面口径（没变）**：h4 及以下小标题（位置分布 / 年龄结构 / CA 结构 / 阵容名单 / 门将·1）仍是黑体 —— 衬线只用在 17.5px 以上标题，13–14px 宋体笔画发虚（`UI_DESIGN.md` §7.4）。

## [v6.53.2] · 全站字体方案：标题宋体 + 正文 Inter + 数字 JetBrains Mono（2026-10-21）

**本地实现完成，未 push / 未 deploy**（上线后回写 Version id 与线上核对结果）。判级 **patch**（纯展示层：换字体、加字体资产与加载声明；零端点、零迁移、零业务规则改动）；`package.json` 6.53.1 → **6.53.2**。计划与裁决 `memory/plan-v6.53.2-font-scheme.md`，测试计划 `docs/test-plans/v6.53.2-font-scheme.md`。

**缘起**：用户要求「给这个中文 Web 应用定一套字体方案，从选型到落地」。原状是 `font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`，全站无任何 `@font-face`，标题与正文同族，数字只有 19 处 `var(--mono)` 真等宽。

**选型**（三套角色，详见 `UI_DESIGN.md` §7）

- **标题**：Noto Serif SC 600 自托管子集（298,088 B）→ `Source Han Serif SC / Songti SC / STSong / SimSun`。`h1` 页面标题、`h2` 球员名、`h3` 卡片小标题统一衬线，呼应「复古档案室 / 合同卷宗」母题；子集只有 600 一档，**全站标题不要写 700/800**（合成粗体会糊 CJK）。
- **正文**：`'Inter'`（只覆盖拉丁，48,444 B + latin-ext 74,328 B）→ 系统黑体（`PingFang SC / Hiragino Sans GB / Microsoft YaHei UI / Microsoft YaHei / Noto Sans SC`）。中文正文**不自托管**：12–13px 密集表格下系统字体 hinting 更稳，也省掉 300KB+ 首屏载荷。
- **数字**：`'JetBrains Mono'`（40,404 B + latin-ext 15,196 B）**放在栈首**——原 `--mono` 把 `ui-monospace` 放第一位，JetBrains 永远轮不到。

**改动**：`web/src/styles.css` 顶部 5 条 `@font-face`（全部 `font-display: swap`；Inter / JetBrains 按 fontsource 标准区间拆 latin / latin-ext 两条 `unicode-range`，后者只在 `Š/Đ/Ł` 出现时下载）；`:root` 新增 `--font-display` / `--font-sans` / `--font-mono`，`--mono` 改为 `var(--font-mono)` 别名（19 处旧引用不用改）；`body` 改用 `var(--font-sans)`；新增 `h1,h2,h3 { font-family: var(--font-display); font-weight: 600 }`。`web/index.html` 只 preload `inter-latin.woff2`（`crossorigin`），298KB 宋体不抢首屏带宽。新增 `web/public/fonts/`（5 个 woff2 + 3 份 OFL + `README.md`）与 `scripts/build-serif-subset.py`（下载 600 TTF → 扫 `web/src` + `src` + 生产 20 队名 + Latin 区段 + 标点 → `pyftsubset`；当前 2187 字，其中 CJK 1526；原 TTF 与字符表落 `scripts/.font-cache/`，已 gitignore）。

**不做什么**：不给中文正文加网络字体；不加 `.mono` 全局规则（球员库 `td.mono` 等仍走正文族，改它要动多张表列宽，留待单独评估）；不动 `Ledger.tsx:202` 的 `strong.mono`（30px 余额仍是 Inter 700）。

**验收实测**：`npm run typecheck` 三份 0 error；`npm run test` **144 文件 / 2390 例全绿**；`npm run test:e2e` **29/29**（含 ⑫ 全路由 375×812 零溢出、㉑ 球员页 375 卡内不横滑）；`npm run build` ✓，`dist/fonts/` 5 woff2 随 public 拷入。截图对照 1440 / 375 的 `/`、`/players`、`/players/260002`、`/clubs`、`/ledger`、`/market`：标题换宋体后可读、无豆腐块，`Ø` 等 Latin-1 字形在子集内。抓包核对 `/`、`/players`、`/players/260002`、`/ledger` 四页：每页只请求 3 个 latin 文件（48,444 + 298,088 + 40,404 = **386,936 B**），**没有任何 latin-ext 请求**，`unicode-range` 懒加载成立。**已知副作用**：Inter 比原 `Segoe UI` 略宽，球员库表格 1440 下横向溢出比改造前多约 19px；该表本就靠 `.table-wrap` 横滚（table 1107px vs 容器 852px），属既有行为，本轮不做列宽手术。

**维护**：球队改名或界面新增生僻字后跑一次 `python scripts/build-serif-subset.py`；不跑则标题逐字回退 `SimSun`（仍是衬线，不会变黑体）。

## [v6.53.1] · 成长录入「非成长」徽章改为小 × 图标（2026-10-21）

**已上线 2026-10-21（Version `9c9fd6f7-b74a-4505-a783-d1b187306a4d`，push `7c4de47..4a6e629`）**。判级 **patch**（纯前端样式 + 文案）；`package.json` 6.53.0 → **6.53.1**。

**改动**：成长录入页两处「非成长 · 不计 XP」文字徽章（卡片头 `web/src/pages/admin/GrowthEntryPage.tsx:1187`、桌表行首 `:1389`）改为小 `×` 图标徽章，原语义移入 `title` / `aria-label`（悬停与读屏仍可获知）；`web/src/styles.css` 新增 `.badge.x-mark`（更小内边距、`cursor: help`）。行为不变：非成长球员照常录入、`growth_events.xp` 仍为 0。

**上线记录**：push 后 Workers Builds 未在 7 分钟内出包，改用仓库自带 `npm run deploy` 手动发布 → Version `9c9fd6f7-b74a-4505-a783-d1b187306a4d`；线上入口 `assets/index-Clhw19kI.js` 与本地 `web/dist` 一致；`/api/health` 200、`/venue` 200、`/api/club/venue-plan` 未登录 401。本次无迁移。

## [v6.53.0] · 球场档期 P0（容量驱动收入 + 设施门槛 + 场馆经营页）（2026-10-20）

**已上线 2026-10-21**（Version `a7df4fe3-3264-4724-b70a-7ad8c38ca54d`，push `b776ae8..7c4de47`；迁移 `0078_venue_slots_p0.sql` 已于 push 前 apply 生产）。判级 **minor**（新页面 / 新端点 / 新规则 + 迁移 `0078`）；`package.json` 6.52.0 → **6.53.0**。计划文件 `memory/plan-v6.53.0-venue-slots-p0.md`，测试计划 `docs/test-plans/v6.53.0-venue-slots-p0.md`。

**缘起与拍板**：用户锁定「场馆档期」独立页（Q8-1）与档期窗 = 转会窗；设计稿 `memory/design-venue-slots-explore.md` 与四份工作流在迁移号、文件名、枚举、通知 key、API 形状上的冲突按计划 §0 的 A1–A14 裁决收口（迁移 `0078` / `0078_venue_slots_p0.sql` / `idx_season_windows_open` / `venue_policy ∈ {'','money','fans','reputation'}` / `cost_base=0.275` + 每座成本 + 草皮独立掷 / P0 不直给死忠 / 一张 `venue_window_settlements` / `consumption` 锚到窗口开关 / 不加 `planned_close_at` / `venue_window_open` + `venue_slot_reminder` / 新 `venue-plan` 三端点并删旧 `bookings` / 只用状态码 + 中文 message / 独立 `/venue` 页 / `activity_slots` 改「每窗档位上限」默认 `'4'`）。P0 九项 = ①容量派生档位 ②容量驱动收入 − 成本栈 + 饱和 ③五类活动 + 设施门槛 ④关窗结算 + 账本 + 死忠演化 ⑤`/venue` 页 + 两条提醒 ⑥窗口节奏 + `consumption` 开关 ⑦并发开窗唯一索引 ⑧失败开窗不先重掷 ⑨六条验收。

**规则变更**

- **槽位**：容量 `<15000 → 2`、`15000–29999 → 3`、`≥30000 → 4`；再由 `activity_slots`（默认 `'4'`，`0` = 关闭档期预订，硬上限 20）钳制。无 `stadiums` 行按 2 槽。
- **收入**：单槽毛收入 = 容量 × 票价 × 利用率（capacity 型）或固定额（flat 型）；设施乘数、冠名 `attendBuff`、声望乘数依次相乘；同窗同活动饱和 `1 / 0.7 / 0.45 / 0.45` **按同类序位**乘在毛收入上；运营成本按档照付。四档容量单槽期望净额：35000 演唱 **3.75** / 22000 **2.06** / 17000 **1.41** / 12000 **0.76**；电竞 **2.15 / 1.24 / 0.89 / 0.54**；青训 0.7；开放日 0.2；企业日 rep20 **0.63**、rep100 **1.35**。
- **活动与门槛**：演唱会、电竞（转播 L2）、企业日（商业 L1 + 声望 ≥20）、青训营（青训 L1）、开放日；预览逐槽给 `unlockReason`（不 reject），保存与事件赠档必须拒。
- **后果**：关窗按槽落三条账本流水（活动收入 `+gross` / 草皮 `−damage` / 运营成本 `−opsCost`），`summary.activityTotal` 改「活动净现金」并新增 `activityOpsCost`；声望赛季末 ×0.9；上座乘数 K=5 逐场 −1、新季首窗清零，事件预置（K=0）仍一场即清。
- **入口与提醒**：独立 `/venue`「场馆经营」页（首页卡 + 主场页入口，消费中心删 `BookingsCard`）；开窗逐队发 `venue_window_open`，关窗前 `runVenueReminderTick` 对未排满的队发 `venue_slot_reminder`（`venue_reminder_at` 去重）。
- **API**：新增 `GET/PUT /api/club/venue-plan` + `POST /api/club/venue-plan/preview`（只读、不落库、无需开窗）；同版删除 `GET/POST /api/club/bookings`。PUT 为 partial、一次 `db.batch` 原子提交，窗关闭或 `consumption` 关闭 ⇒ 409。

**迁移 `0078_venue_slots_p0.sql`**（`tests/d1.ts` 的 `MIGRATION_FILES` 已追加）

1. `CREATE UNIQUE INDEX IF NOT EXISTS idx_season_windows_open ON season_windows(status) WHERE status='open'`（同时刻至多 1 个 open 窗）。
2. `season_windows.venue_reminder_at TEXT NOT NULL DEFAULT ''`（关窗提醒去重）。
3. `stadiums.venue_reputation REAL NOT NULL DEFAULT 0 CHECK 0–100`。
4. `stadiums.attendance_mod_matches INTEGER NOT NULL DEFAULT 0 CHECK ≥0`（不锁 0–5，K 是代码常量）。
5. 有界回填：仅 `next_attendance_mod <> 1 AND attendance_mod_matches <> 0` 归 0；正常库写 0 行。
6. `clubs.venue_policy TEXT NOT NULL DEFAULT '' CHECK IN ('','money','fans','reputation')`。
7. `clubs.city TEXT`（可空，P0 纯预留）。
8. `venue_window_settlements(club_id, season, window_seq, reputation_gain, attend_mod, bookings, created_at, PK(club_id,season,window_seq))`。
9. `ops_schedule.consumption` 双 `none` → `window_open` / `window_close`（只改双 none，不覆盖运营手工锚点）。

**交付**

- 服务端：新建 `src/core/venue.ts`（`slotsForCapacity` / `satMultAt` / `venueQuote` / `quotePlan` / `activityUnlockReason` / `recommendPlan` / 配置校验，零 import）；重写 `src/worker/venue-ops.ts`（三类定价、饱和、草皮实际/期望分离、三条账本、`venue_window_settlements` 幂等、容量/设施/声望三闸、`venueSlotStatement` + `bookSlot`）；新建 `src/worker/venue-reminders.ts`（`runVenueReminderTick`，`index.ts` 的 `runSettleTick` 内 try/catch 调用，不计入 `tickChanged`）。
- 结算与窗口：`src/worker/home.ts`（`VenueContext`、`activityTotal` 净现金、`activityOpsCost`、K=5 逐场递减）；`src/worker/window-machine.ts`（新季首窗清零、重掷并入 `openBatch`、开窗通知、返回 `venueReset` / `venueNotified`）；`src/worker/season-settle.ts`（声望 ×0.9，冠军通知改读 `seasonsIdx`）；`src/worker/event-ops.ts`（`venue_reputation` 入上下文、赠档按容量派生槽数并过设施/声望闸）。
- 路由与通知：`src/worker/routes/clubs.ts`（新增 `GET/PUT /club/venue-plan` + `POST /club/venue-plan/preview`，删除旧 `GET/POST /club/bookings`）；`src/worker/notify.ts` 两条模板；`src/core/notify-meta.ts` 两条 4 字标签（`category='window'`，模板数 37 → 39）；`src/core/config.ts`（`activity_config` 五类活动新默认、`activity_slots='4'`、`window_length_hours='168'` 入白名单）。
- 前端：新建 `web/src/pages/venue/VenuePlanPage.tsx` + `venue-preview.ts` + `venue-plan.css`；`App.tsx` 路由、`api.ts` 类型、`queries.ts` hooks、`notify-links.ts` 深链 `/venue`；首页 `.nav-card` 与 `club/VenueTab.tsx` 入口；`shop/ShopPage.tsx` / `shop/venueCards.tsx` 删旧档期卡。
- 测试：新增 `tests/venue-core.test.ts`、`tests/venue-slots-migration.test.ts`、`tests/venue-reminder.test.ts`、`web/src/pages/venue/venue-preview.test.ts`、`web/src/pages/venue/VenuePlanPage.test.tsx`；改写 `tests/venue-ops.test.ts`、`tests/home.test.ts`、`tests/window-machine.test.ts`、`tests/event-ops.test.ts`、`tests/season-settle.test.ts`、`tests/notify.test.ts`、`src/core/notify-meta.test.ts`、`web/src/lib/notify-links.test.ts`、`tests/ops-schedule.test.ts`、`tests/naming-tiers.test.ts`、`tests/config.test.ts`、`tests/contract-ticks.test.ts` 等。

**实施偏差 / 如实登记**

- **本轮为「实现 + 评审修复」两段**：实现后跑了四路只读代码评审，修掉 2 个 🔴（保存中仍可改档 → 成功后静默清空；PUT 四道闸的单测全打在已无生产调用方的 `bookSlot` 上）与一批 🟡（预览失败仍显示旧 totals、历史 `idle` 档显示「已排」、提醒先发后占位、临时窗误报、`slots=0` 仍发开窗信、硬编码 K/钳制、超界档位清不掉、死类型/死键、GET 契约与「预览不写库」无测试等）。
- 本机闸门（2026-10-20 复核轮）：`npm run typecheck` 三份 tsconfig **0 error**、`npm run build` 成功、`npm run db:migrate:local` 应用 `0078` 且二次 apply 输出 `✅ No migrations to apply!`、`npm run test:e2e` **29/29**。
- **上线记录（2026-10-21）**：apply 前只读确认生产 `season_windows` 中 `status='open'` **0 行**（唯一索引不会撞）→ `wrangler d1 migrations apply whl-club --remote` **Executed 10 commands / 14.45ms** → 回读：`stadiums` 新列 2、`clubs` 新列 2、`season_windows.venue_reminder_at` 1、`idx_season_windows_open` 1、`venue_window_settlements` 表 1、`ops_schedule.consumption` 锚 = `window_open`/`window_close`、`migrations list` 无待应用 → push `b776ae8..7c4de47` → CF 自动部署 Version **`a7df4fe3-3264-4724-b70a-7ad8c38ca54d`**（100%）；线上入口 `assets/index-DgP-mRWU.js` 与本地 `web/dist` 逐字一致；`/api/health`、`/api/players?limit=1`、`/api/market/listings`、`/api/clubs`、`/api/squads` 全 200；`/api/club/venue-plan` 未登录 **401**（路由在位，非 404）；`/venue` 200。
- `scripts/e2e/smoke.mjs` 已加入 `/venue` 的 `㉓ 场馆经营` 场景与 `ROUTES` 项；经济模型已从 `scratch/` 复制进版本库 `scripts/venue/cadence-model.mjs`，C2 的 109.24 / 13.24 / 7.02 / 5.29 / 2.99 可在干净检出复跑。
- 有意保留的口径：一档固定三条账本流水（即使金额为 0），`venue_window_settlements.bookings` 记档期表行数（含历史 `idle`）——两者都是幂等/审计凭据，与「真正结算了几档」分开看。
- 真实并发仍由唯一索引兜底；单测以「串行第二次 409 + `BEFORE INSERT` trigger 中止回滚」覆盖，不等同 D1 真并发压测。

**测试**：全量 `npm test` **144 文件 / 2390 例全绿**（exit 0；Duration 103.43s；较实现轮 +6 例：PUT 四道闸、GET 字段契约、预览不写库、草皮等级降损、声望按上座率缩放、锁定活动仍计价）；`npm run typecheck`（三份 tsconfig）**0 error**；`npm run build` 成功（7.18s）；`npm run db:migrate:local` 二次幂等；`npm run test:e2e` **29/29**（含新增 ㉓）。用例覆盖迁移九条与失败无半状态、槽数边界、四档报价、饱和同类序位、设施/声望三闸、期望 vs 实际草皮、三条流水与台账幂等、K=5 与事件同窗、首窗清零、声望衰减与冠军通知、两条通知与深链、提醒去重、方针保存与预览、并发开窗与重掷回滚、页面 2/3/4 槽与 375 布局。测试计划 `docs/test-plans/v6.53.0-venue-slots-p0.md`。

## [v6.52.0] · 非成长球员不计成长 XP（数据照收）+ 训练营 / 中国计划 / 里程碑三类结算过滤（2026-10-20）

**已上线 2026-10-20**（Version `0386f797-ee98-4f1e-bd3f-98cf809e0918`，push `878ad1b..b776ae8`；迁移 `0077` 已于 push 前 apply 生产，`Executed 2 commands`）。判级 **minor**（规则变更 + 迁移 + 存量数据订正）；`package.json` 6.51.13 → **6.52.0**。

**缘起与拍板**：用户 m06019「1growable = 0，2后者，3非成长的xp清零，给我计划」⇒ 判定口径 = `growable = 0`、从源头挡、存量 XP 清零；m06100 更正「不，是非成长不计XP，但数据仍然接收，因为有别的功能要用这些数据」⇒ **不禁行、不 400 拒收、OCR 照常预填**；本轮追加「训练营 / 中国计划 / 里程碑三类结算也过滤」。计划文件 `memory/plan-v6.52.0-growth-nongrowable.md`。

**规则变更（新门槛，PRD 已补一条）**

- **可成长 = `COALESCE(players.growable, 0) = 1`**，`NULL` 落非成长侧（与既有索引口径一致）。
- **①录入台批量 / ②单人补录 / ③赛果确认自动钩子 / ⑦改值重放 = 主闸归零**：事件行与 `value` **照写**（球员「比赛」tab / 成长史 / 累计基数 / 去重锚都要用），但 `growth_events.xp` 存 **0**、`players.growth_xp` **不累加** —— 两者同口径，不出现「行 +20 但总数没动」。
- **④训练营 / ⑤中国计划 / ⑥里程碑 = 查询层过滤**：非成长球员连事件行都不产生（历史行保留、不追溯删除）。这三类是纯 XP 合成事件、不承载比赛数据，属于「数据照收」的唯一例外。
- **升级闸门**：`applyLevelUp` 对非成长球员恒 **409「非成长球员不能消费升级」**，判定排在 `pending` 之前（迁移清零后 pending 本就为 0，先判 pending 会让新文案不可观测）。
- **待升级口径收窄**：结算待办表（`src/worker/growth.ts:449-455`）与球员页 `pendingLevelUps`（`src/worker/routes/growth.ts:83`）只算可成长球员（见「实施偏差」）。

**迁移 `0077_growth_nongrowable_reset.sql`**（`tests/d1.ts` 的 `MIGRATION_FILES` 已追加，排在 0076 之后）

- `UPDATE players SET growth_xp = 0 … WHERE COALESCE(growable, 0) = 0 AND COALESCE(growth_xp, 0) <> 0`；事件行、`levels_applied` 不动。
- 尾守卫不可省：去掉后 SQLite 把匹配的 **7,827 行**都计入 `rows_written`（值没变也算）；带上只写真正有 XP 的 **116 行**（apply 前实测：116 名非成长球员合计 **413 XP**，计划期读数为 372，期间旧代码又记了 41；6 人待升级），重放为 **0 行**。
- 不可精确回滚（清零前 `growth_xp` ≠ `SUM(growth_events.xp)`），迁移注释给了近似重算 SQL。

**交付**

- `src/worker/growth.ts`：主闸 XP 语句加 `AND COALESCE(growable, 0) = 1`；事件 INSERT 的 `xp` 改 `CASE WHEN COALESCE((SELECT growable …), 0) = 1 THEN ? ELSE 0 END`（bind 链多一次 `playerId`）；`recordGrowthEvent` 改按事件 INSERT（`results[1]`）判定是否新入账（否则非成长球员的新事件会被误报 `duplicate`，回 200 而非 201）；三类结算查询加 `growable` 过滤（`growth.ts:334` / `:362` / `:406`，里程碑 JOIN 留在派生表内层）；结算待办表加过滤；升级闸门 409。
- `src/worker/routes/admin/growth.ts`：面板 DTO / 批量 SELECT / 单人 SELECT / 花名册 SQL 增 `growable`；批量在**构造 events 时**归零（`xpOn = xpEligible && growable === 1`），响应 `totalXp` / 逐行 `xp` 与审计 detail 都不虚报；单人补录用 `creditedXp = growable === 1 ? xp : 0` 一处供入账 / 审计 / 响应三处共用；改值重放对非成长球员**跳过重放**（只改 `value` / `recorded_by`，被改行保持现有 `xp`，链上其他行与 `growth_xp` 不动），并对 `growth_xp` 的 UPDATE 加 `growable` 兜底。
- `src/worker/results.ts`：`granted` 语义明确为「新入账的**成长事件条数**」（非成长球员的事件也计数），字段名与前端类型不变。
- `src/worker/routes/growth.ts`：球员成长载荷补 `growable`，非成长球员 `pendingLevelUps` 恒 0。
- 前端：`GrowthEntryPage.tsx` 非成长行标灰徽标「非成长 · 不计 XP」（卡片头 + 桌面表格）、`rowXp` 在累加 `extraXp` **之前**返回 0（合计与四处展示都经它）、提示条说明「录入照收，只是不计成长 XP」、输入与截图预填**不禁用**；`SeasonsPage.tsx` 赛果确认 toast 改「自动记了 N 条成长事件」；`api.ts` 的 `MatchEntryPlayer` 加 `growable`。

**实施偏差（如实登记）**：计划 §4.3 原写「`pendingLevelUps` 不按 `growable` 收窄」，实现改为**一并收窄** —— `season-settle` 的重判只改 `growable`、不清 `growth_xp`，不收窄的话超龄/练满球员会长期显示「N 次待升级」而点下去必 409；迁移清零只覆盖 apply 那一刻，收窄才覆盖之后的重判。

**测试**：新增 `tests/growth-nongrowable.test.ts` **22 例**（TC-NG-01a…TC-NG-11b，覆盖迁移、主闸、三类结算、自动钩子与 `retryUnresolvedResults`、录入台批量、单人补录、改值重放、升级闸门、消费方、前端静态锁、迁移注册与幂等）；全量 `npm test` **139 文件 / 2278 例全绿**（v6.51.13 基线 138/2256，净 **+1 文件 / +22 例**；复跑耗时 93.62s）。**已跑**：`npm run typecheck`（三份 tsconfig）0 error、`npm run build` ✓、`npm run db:migrate:local`（0077 已应用）；**未跑**：`npm run test:e2e`（需 8791 常驻 dev server）。测试计划 `docs/test-plans/v6.52.0-growth-nongrowable.md`。

**上线记录（2026-10-20）**：生产 apply **0077**（`Executed 2 commands in 12.56ms`）→ push `878ad1b..b776ae8` → CF Workers Builds 自动部署 Version **`0386f797-ee98-4f1e-bd3f-98cf809e0918`**（100% 流量，Created 2026-10-20T00:25:57Z）→ 回读：非成长球员 **7,827 人**、`growth_xp != 0` **0**；可成长球员 **152 人**仍有 XP；`growth_events` **1,429 条 / 915 XP** 未动；线上入口 `assets/index-DMeaHSCF.js` 与本地构建 **sha256 逐字节一致**（`48e6291…`）；`/api/health` 200、`/api/players?limit=1` 200。

## [v6.51.13] · 成长录入截图识别：解析按图片内容缓存（选边不再重复调模型）（2026-10-17）

**已上线 2026-10-18**（Version `245d6ffa-f415-4aad-9e55-a7527516824f`，push `bba0af8..878ad1b`；本版**无迁移**；与 v6.51.12 同批上线，`package.json` 6.51.11 → 6.51.13）。发布前补跑全量闸门：`npx vitest run` **138 文件 / 2256 例全绿**、`npm run test:e2e` **28 / 28**（dev 8791）、typecheck 三份 0 error、build ✓；线上入口 `assets/index-DkytDFBO.js` 与本地 `web/dist/assets/index-DkytDFBO.js` sha256 逐字节一致（`49817fd5bee3f1eeddb5dba91ffd83fad8aa7b1bd34c101a0fdbccb4e2334ae5`；线上 `index.html` 与本地仅差 Cloudflare 边缘注入的 `__CF$cv$params` 与隐藏锚点），`/api/health` 200 / 匿名 `/api/admin/brands` 401 / `/api/clubs` 200。

**缘起（用户提问 + 裁决）**：用户问「成长录入，截图识别，当到达需要用户选边的分支时，选边后现在的行为难道是再调用一遍 LLM 吗？」—— 是：选边会把同一张图重发，端点无条件重跑视觉模型（`side` 只覆盖队名判定）。用户比较 A（首次解析随错误回传、前端回传）与 B（服务端按图哈希缓存）后裁决「**B**」。

**口径：同一张图的解析只发生一次**

- 键 = 规范化 base64 的 `sha256Hex`（`src/lib/crypto.ts:4`）；值 = 模型的**原始解析**；TTL **600 秒**；承载在 `SESSION_KV`（与限流、代际键同一个 KV）。
- 缓存里**绝不放 entries**（含 playerId）：队侧、花名册、预填每次现算 ⇒ 换边、甚至换一场比赛复用同一份解析都安全。
- **只缓存页签合法的结果**：不可解析 / 非 Summary·Goalkeeping 一律不写缓存 ⇒ 用户重试仍会重新打模型（保住今天的重试语义）。
- KV 读/写异常全吞：KV 故障时退化成「每次都调模型」的旧行为，不影响本次响应。

**交付**：`src/worker/routes/admin/growth.ts` —— 新增 `OCR_CACHE_TTL_SEC = 600`、`readOcrCache` / `writeOcrCache`；端点里 `cacheKey = 'ocr:' + sha256Hex(image.base64)`，命中即跳过 `llmVisionJson`，页签校验通过后写回；新增 `import { sha256Hex } from '../../../lib/crypto.ts'`。

**收益**：歧义/对不上时点「主队 / 客队」不再多花一次视觉调用（此前每次选边 = 重新上传 ~0.8 MB 图 + 一次完整识别，几秒）；同图重复上传（分两侧传同一张、传完不确定又传一遍）同样命中；**刷新页面后重传同一张图也命中**（缓存不依赖浏览器内存），换设备、换管理员同理。

**为什么选 B 而非 A**：A 要改错误契约（响应体恒为 `{ error, code }`，见 `src/worker/index.ts:99-100`）与前端（保留并回传解析），且载荷活在浏览器内存里（刷新即丢）；B 零契约变更、零前端改动，解析恒由服务端产生且与图片内容绑死（无「图 A + 解析 B」的篡改面）。

**测试**：`tests/growth-ocr-endpoint.test.ts` 新增 4 例 —— TC-EP-C1 歧义选边续跑（视觉调用计数仍为 1，且按**选中的那一侧**认人）/ TC-EP-C2 同图重传命中 + `data:` 前缀与换行规范化后同键 + 换一张图不共享 / TC-EP-C3 坏页签不缓存（同图重试仍打模型）/ TC-EP-C4 KV 读与写都抛错时不阻断识别。该文件 **23 例全绿**；`npm run typecheck`（tsc ×3）**0 error**。按用户要求收尾只跑定向用例 ⇒ **全量 `npm test` 与 `npm run test:e2e` 本增量未跑**（发布前需补）。

**测试计划**：`docs/test-plans/v6.51.13-ocr-parse-cache.md`。**版本号未 bump、未 push**（bump 与 push 属发布动作，待令）。

## [已上线] · 生产批 — S9 冠军杯小组赛池降到 192.5 + 次级入场奖金补至顶级水平（不占本仓版本号）（2026-10-17）

**已执行（2026-10-17）**：纯数据批（**零代码、零迁移、零 API 变更**）；作用域 = 生产 D1 `whl-club` 的 `config` 一行 upsert + 7 家次级球队账本补发。

缘起（用户指令）：①「降低奖金池到192.5」（m03014）②「即本赛季不再留冠军杯小组赛奖池里的剩余部分进行分配」（m03018）③「将次级入场奖金补发到顶级水平」（m03020）。

规则与口径：
- **池 200 → 192.5**：`src/worker/season-settle.ts:146-156` 冠军杯小组赛结算 `remaining = round(pool − paid, 2)`，仅 `remaining > 0 && totalWins > 0` 才按胜场占比分给有胜场的队；S9 实测 `paid = 192.50`（25 胜 × 7.00 + 7 平 × 2.50，弃权判负、`is_cpu` 一侧不计）⇒ 池写 192.5 时 `remaining = 0`，本赛季不再分配剩余池（用户 ② 的意图）。池只有降到 ≤ `paid` 才成为硬上限。
- **写入方式**：`config` 表 upsert 整串 `prize_table` JSON（SQL 侧 `json_object(...)` 构造；除 `champions_group.pool` 外其余字段与 `src/core/config.ts:137-146` 默认逐字一致，生成器自检逐字段比对）。此前生产 `prize_table` **0 行**（生效值 = 代码默认 200）⇒ 本批写入后由 config 覆盖，S10 起再调只改这一行。
- **次级入场补至顶级**：入场奖金 = 赛季末一次性按级别发（顶级 `league_premier.entry` 20 / 次级 `league_second.entry` 7.5，差 2.67 倍 = 设计稿 `memory/design-s9-income-system.md:65` 的 D3 缺陷）；生产 `memo LIKE '%入场%'` 0 笔（结算尚未跑、一分未发）⇒ **现在补差额 12.50 × 7 家 = 87.50M**（不改 config 的 `entry`：用户用词是「补发」；差额 + 结算基础额 7.5 = 20 = 顶级水平；且 L1 联盟版权池计划取代入场奖金，改 config 会让这笔钱将来发不出去）。
- **名单 7 家**（`is_cpu = 0`）：1 阿森纳 / 2 阿斯顿维拉 / 14 诺丁汉森林 / 21 拜仁慕尼黑 / 243 皇家马德里 / 280 奥林匹亚科斯 / 112172 RB莱比锡；排除 10 曼城(CPU)、131681 AC米兰(CPU)。**CPU 判据取 whl-club `clubs.is_cpu`**（AUTH_DB `team` 里 112172 的名字是历史 CPU 期标签「RB莱比锡(CPU)」，而 whl-club 里 `name='RB莱比锡'`、`is_cpu=0`、有账本账户 ⇒ 在名单内），与结算 `clubIdByTourTeam`（`src/worker/prizes.ts:60-76`，第 73 行排除 `is_cpu`）口径一致。

执行记录与回读：
- 预检（只读）：`prize_table` 0 行 / `paid` 192.50 / `entry_topup` 0 笔 / 已结算赛事 0 / 守恒 0 / 全联盟 1287.31；7 家批前余额 49.68 / 32.42 / 109.05 / 63.10 / 42.20 / 49.94 / −1.71。
- 执行：`sql/02-config-pool-patch.sql` **changes 2**（审计 1 + upsert 1）、`sql/03-entry-topup.sql` **changes 14**（7 家 × 2 条，无 changes=0）⇒ 重放两文件 **16 条全 changes=0**（幂等成立）。
- 回读：`prize_table` 1 行且 `champions_group` = `{"entry":15,"pool":192.5,"win":7,"draw":2.5}`；`entry_topup` **7 笔 / 87.50**、逐队恰好 1 笔；守恒 0；全联盟余额 1287.31 → **1374.81（+87.50）**；7 家各 +12.50（112172 由 −1.71 → 10.79 转正）。
- 回滚工件：`rollback/01-undo-entry-topup.sql`（7 笔补偿 −12.50，`manual_adjust` + `ref_type='batch_rollback_entry_topup'`，**不删原流水**）+ `rollback/02-undo-config-pool.sql`（删 config 行 ⇒ 回代码默认 200）。
- 本地演练（`.wrangler/state` 副本 + `--persist-to`）已过：写入 → 重放不变 → 回滚归位 → 重放回滚无新增。
- 批次目录 `scripts/prod-20261017-s9-pool-and-entry-topup/`（README 含工件 sha256 与遗留项）；测试计划 `docs/test-plans/prod-2026-10-17-s9-pool-and-entry-topup.md`。
- 通道坑（登记）：`exec-shards.mjs` 走 `--command` ⇒ 拒含 `" % & | < >` 的语句（`prize_table` JSON 改用 `json_object(...)` 构造）；生产 `--remote` 偶发 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 崩溃与 `Proxy environment variables detected` 之后 fetch 失败，**首轮两条写入各撞一次且均已只读复核确认零落库**（`prize_table` 0 行 / `entry_topup` 0 笔），再 `--retry=3` 重跑即成功。

遗留：① 结算仍按 config 发基础入场额（顶级 20 / 次级 7.5），本批只补差额 ⇒ 次级球队结算合计 = 20（= 顶级水平）；S10 若 L1 版权池取代入场奖金，需另行处理 ② 池 192.5 是 **S9 专用值**（= 本赛季 `paid`）；S10 起若目标 120 必须与逐场单价（胜 4.0 / 平 1.5）**同批**下调，只动池不生效 ③ 冠军杯淘汰赛（`champions_ko`）与超级杯未动 ④ 涉及 CPU 的 6 场里 #6「AC米兰(CPU) 2-1 阿森纳」是 CPU 方胜 ⇒ 对 `paid` 计 0（结算口径正确，非缺陷）。

## [v6.51.12] · 点球决胜按平局（发奖口径）——代码修正 + S9 冠军杯小组赛 4 场生产订正（2026-10-17）

**已上线 2026-10-18**（Version `245d6ffa-f415-4aad-9e55-a7527516824f`，push `bba0af8..878ad1b`，与 v6.51.13 同批；生产订正已于 2026-10-17 执行）。发版后小组赛/联赛的「平比分 + 点球」按平局发奖；淘汰赛口径不变。判级 **patch**（无新端点、无迁移、无前端改动；只改发奖判胜口径与结算 `paid` 口径）。

缘起（用户 m02671，原文）：「点球决胜按平局重新发」。

规则：**平比分 + 点球分胜负**的场次，在**小组赛/联赛**口径下按平局发奖（双方各 2.5），点球胜者只作用于**淘汰赛**口径（晋级与晋级奖金）。战绩侧早已如此（`src/worker/home.ts` formPtsOf「点球决胜按平局计——用户裁决 2026-09-16」、`season-settle.ts` leagueStandings、`naming-ops.ts` betCountSql），**只有发奖侧漏了 stage 闸**。

交付：① `src/worker/prizes.ts` `outcome()`：点球与 `winnerTeamId` 两条兜底一并限定在 `stage_kind ∉ {group, round_robin}`（原来无条件生效 ⇒ 点球场按胜发 7.0）；② `src/worker/season-settle.ts` `aggregateRecords()`：同一 stage 闸（小组赛剩余池 `paid` 口径）+ **一侧未映射时照样计已映射一侧**（原来整场跳过 ⇒ `paid` 算少、剩余池补发会突破池上限）；③ 生产订正批 `scripts/prod-20261017-s9-pk-draw-fix/`：收回 3 笔 7.00（`kind='manual_adjust'` + `ref_type='pk_rollback_prize'`，不删原流水）+ 按平局补发 7 笔 2.50（对手侧用平台 canonical 键、点球胜方侧用 `match_*_fix` 键防日后重放双发；CPU 一侧不补）⇒ **净 −3.50M**，逐队 280 / 241 / 112172 各 −4.50（112172 余额 −1.71，欠账）、11 / 45 / 2 / 21 各 +2.50。

范围与执行：全库「平比分 + 点球」恰好 **4 场**，全在 S9 冠军杯小组赛（#10 / #16 / #18 / #22；联赛 0 场）。生产 **20/20** 条语句生效（changes 6 + 14）、重放全 0、守恒 0、`pk_rollback_n=3 / canonical_prize_n=7 / draw_2_5_n=7`。口径收口：小组赛 `match_*` / `match_*_fix` 流水 = **35 笔 / 213.50M**（28 胜 × 7.00 + 7 平 × 2.50），被收回的 3 笔 7.00 已由订正流水抵消 ⇒ **实发 192.50**；结算 `paid` = 192.50 ⇒ `remaining = 7.50`（0.30/胜）⇒ **小组赛总支出恰好 = 池上限 200**（旧口径 `paid`=168 ⇒ 会补 32 而突破到 228）。

**更正（如实登记）**：我在 m02661 答复「本赛季小组赛已发放 168」是**错报** —— 当时按 `memo LIKE '冠军杯%'` 统计，漏了 4 笔非标准 memo（弃权场 #2 的 id 254，以及 3 笔 memo 误写「联赛胜场奖金（比赛 #N，CPU 期补发）」的 #18 id 256 / #22 id 264 / #27 id 257）；真实即时值 = **196.00**（28 笔 × 7.00），订正后 = 192.50。据此重算的池下调算术同步更正（见 `memory/plan-s9-s10-economy-revolution-rollout.md` 附录 D）：**只动池最多省 7.5/赛季**（初稿写 32 是错的），要拿到设计稿的 −80 必须**池 120 + 逐场单价同批下调**（胜 7.0→4.0 / 平 2.5→1.5，缺一无效）。

验收：`npm run typecheck`（三份 tsconfig）0 error；`npx vitest run` **138 文件 / 2252 例全绿**（净 +2 = `tests/season-settle.test.ts` 两例：小组赛点球场按平局 / 剩余池 `paid` 与即时同口径含 CPU 对手侧照计）；`npm run build` ✓。测试计划 `docs/test-plans/v6.51.12-pk-draw-payout.md`。

本地提交：`4a1f144`（fix(settle)）+ `6ac2459`（chore(scripts) 订正批）+ docs(v6.51.12)（本枚）——**未 push**（代码修正随下次授权发布走；生产订正批已执行完毕）。

## [v6.51.11] · 成长录入三修：游戏截断名兜底（认人第六层）+「不保存，继续」只丢当前队侧 + 截图上传改 JPEG（2026-10-17）

**已上线（2026-10-17）**：push `40ae714..bba0af8`（6 枚，含 v6.51.10 上线回写 `33a6b4b`）⇒ CF Workers Builds 自动部署 Version **`0d4c2583-e896-4f2d-bfc2-ecf3df634a08`**（Version Created 2026-10-17T07:23:50.214Z、deployment 07:23:51.087Z、Source `Unknown (deployment)`、100% 流量）；零迁移 ⇒ 无需 apply。回读：`GET /` 200、`/api/health` 200（`{"ok":true,"checks":{"d1":"ok","tour_db":"ok","kv":"ok"}}`）、匿名 `POST /api/admin/growth/match-entry/1/ocr` ⇒ 401；线上入口 `assets/index-C_AZu9Zs.js`（663,314 B）、页面 chunk `assets/GrowthEntryPage-CvZ1TBqL.js`（36,171 B）、CSS `assets/index-BGPWLRxy.css`（94,381 B）三件与本地 dist **逐字节一致**（`cmp` 通过）；线上页面 chunk 内含新前端代码（`toDataURL("image/jpeg", …)`、确认条「换队侧只丢弃当前队侧」「丢弃全部草稿」）⇒ 三项改动在线（截断前缀层在 worker 侧，随同一 Version 部署）。判级 **patch**（无新端点、无迁移、**零提示词改动、模型不变**）。缘起（用户）：① m17643「认人失败 1 行：T. Alexander-Arn...——请在表内手填，是不是长名字会被截断？如果是的话，探查生产库内球员名，防止截断」；② m17741「我知道了，是游戏画面截断了，要探索这种情况下的兜底方案」（三选一 → 选「前缀层自动认回」）；③ 同轮追加指令「点击「不保存，继续」应当只丢弃当页的未保存项目」；④ m17852「评估ocr后处理速度，试图优化」。

诊断：FC26 赛后 Player Performance 表的 Name 列在约 16 字符后截断（截图里就是 `T. Alexander-Arn…`），视觉模型**照抄截断文本**（探针实测尾部是三个 ASCII `.`，不是 U+2026；不猜全名），而生产库名字完整（`T. Alexander-Arnold` id 62 / club 9 利物浦 / 19 字符）⇒ 旧五层认人（含 v6.51.4「姓+首字母」）全落空，落到「请在表内手填」。生产核对：rostered 570 人中 `LENGTH(name) > 16` = **8** 名（R. Floriani Mussolini 21 / T. Alexander-Arnold 19 / Francisco Conceição 19 / S. Milinković-Savić 19 / Gabriel Martinelli 18 / Cristhian Mosquera 18 / A. Zambo Anguissa 17 / Cristiano Ronaldo 17），这 8 名的 16 字符可见前缀在各自花名册内**全部唯一**。

交付：① **截断前缀层**（`src/core/growth-ocr.ts`）：`matchRosterPlayer` 第六层 `'truncated-prefix'`——尾部带省略号痕迹（`/(?:\.{2,}|…)$/`）时剥痕折叠成字母数字键（`nameKeyOf`，键长 ≥4 才算），本侧花名册里**唯一**前缀命中才认（命中 ≥2 回 null，宁缺勿错）；`'K. Mbappé'` 之类正常名与无痕迹短名不受影响；`web/src/lib/api.ts` matched union 同步第六值。② **「不保存，继续」只丢当前队侧**（`web/src/pages/admin/GrowthEntryPage.tsx`）：换队侧闸门只看当前队侧是否脏（新 `sideDirty` + `onSideDirtyChange`），`discardDrafts` 只重建当前队侧 ⇒ 另一队侧草稿保留；确认条文案改为「…收起面板、切换比赛、切换视图会丢弃全部草稿；换队侧只丢弃当前队侧的草稿（另一队侧的草稿保留）。都不提交。」③ **截图上传改 JPEG 0.92**（`web/src/lib/ocr-image.ts`）：2× 放大后 PNG（2.3-3.7 MB）改 JPEG q92（0.57-0.71 MB，≈1/5），超 `OCR_MAX_DECODED_BYTES` 再降 q80、仍超退回原图。

速度实测（m17852）：服务端后处理纯计算 ≈ **0.4 ms**（parseOcrVision 2.7 µs + buildOcrEntries 409.7 µs + ocrCrossChecks 0.3 µs；生产 D1 单查 `sql_duration_ms` 0.6 ms）⇒ 全程 7.5-8.5 s 里 <1%；模型调用占 ~80-90% 且**对体积不敏感**（5 张真图 PNG vs JPEG q92 逐行零差异、prompt tokens 同为 6925、耗时 7073-8376 ms 无编码相关性）⇒ 唯一可优化的是浏览器侧上传（3.0-4.9 MB base64 → ~0.9 MB），故改 JPEG。

验收：`npm run typecheck`（三份 tsconfig）0 error；`npx vitest run` **138 文件 / 2250 例全绿**（v6.51.10 基线 138/2246，净 +4 = TC-MATCH-06/07 + TC-ENTRY-E16/E17）；`npm run build` ✓ 入口 `web/dist/assets/index-C_AZu9Zs.js`（663,314 B / gzip 210.88 kB，sha256 `7b290ddae85753be593691b011f0087fd71199f0ad73de97e2e26ecefc04cd2e`，含版本串 6.51.11）+ 页面 chunk `web/dist/assets/GrowthEntryPage-CvZ1TBqL.js`（36,171 B / gzip 11.04 kB，sha256 `532ed55843a02879cadf312e4abcc2538605c082f240cf60af3ffdf0ec07434a`）；CSS 入口 `index-BGPWLRxy.css` 未变（零样式改动）。测试计划 `docs/test-plans/v6.51.11-truncated-name-discard-scope-and-jpeg.md`。

不做/未覆盖：① 真机体感（上传体积 ≈1/5）待用户验收；② 端到端墙钟不可压（模型侧）；③ JPEG 下 `selected` 块偶尔更稀疏（除解析外无下游消费者）；④ 截断键长 <4 的极端短名不兜底（宁缺勿错）。

待核：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型 `LLM_MODEL` 上限未知）。

本地提交：`45e1084`（fix(worker) 截断前缀层）+ `0f815a0`（fix(web) 不保存继续只丢当前队侧）+ `3186897`（perf(web) 截图上传改 JPEG）+ `a1ea125`（chore 版本号 6.51.10→6.51.11）+ docs(v6.51.11)（本枚 `bba0af8`）；push `40ae714..bba0af8`（6 枚）已执行（含 v6.51.10 上线回写 `33a6b4b`）。

## [v6.51.10] · 成长录入：`growth_events(match_ref, player_id)` 索引（迁移 0076）+ 列表行悬停预取（2026-10-16）

**已上线（2026-10-17）**：迁移 `0076_growth_events_match_ref_index.sql` 已先 apply 生产（`npm run db:migrate:remote` ⇒ `Executed 2 commands in 3.55ms`、0076 ✅；只读核验 `idx=1 / sqlite_autoindex_growth_events_1=1 / growth_events=774 行 / 索引 2 列`）；push `cbacac6..40ae714`（5 枚，含 v6.51.9 上线回写 `c85c23c`）⇒ CF Workers Builds 自动部署 Version **`81e9fcce-6f7e-4ab2-a9eb-fce8043fff1c`**（Created 2026-10-17T00:37:55Z，100% 流量）。判级 **patch**（纯读路径优化：无新端点、无页面、**零提示词改动、模型不变、SQL 逐字未改**、响应逐字段等价）。缘起＝v6.51.9 收尾后用户两问「悬停预取没有做吗」「迁移 CREATE INDEX idx_growth_events_match_ref ON growth_events (match_ref) 没有做吗」——D/E 两项当时按用户裁决「ABC 全做」排除，据两问补做本版。

交付：① **D 新索引**（迁移 `0076_growth_events_match_ref_index.sql`）：`CREATE INDEX IF NOT EXISTS idx_growth_events_match_ref ON growth_events (match_ref, player_id);` —— 第二列不是可有可无：`EXPLAIN QUERY PLAN` 实测（node:sqlite 造 3 场 × 40 人）只建 `(match_ref)` 时面板那条 `WHERE match_ref = ? ORDER BY player_id, id` 仍要 `USE TEMP B-TREE FOR ORDER BY`，带上 `player_id` 后三处 match_ref 查询（列表 recorded 计数 `src/worker/routes/admin/growth.ts:368` / 面板已录事件 `:402` / 保存前查已录 `:694`）全部 `SEARCH ... USING [COVERING] INDEX idx_growth_events_match_ref (match_ref=?)` 且无临时 B 树（非唯一索引末键是 rowid ⇒ match_ref 等值段内天然按 `(player_id, id)` 有序）；`player_id` 前缀查询（`src/worker/player-matches.ts:62`）仍走 UNIQUE 的 `sqlite_autoindex_growth_events_1`，不受影响。迁移登记进 `tests/d1.ts` 的 `MIGRATION_FILES`（守卫 TC-MIG-03 断言目录内最新一枚 = 数组末项）。② **E 悬停预取**：`web/src/pages/admin/GrowthEntryPage.tsx` 列表行 `<tr onMouseEnter/onFocus={() => prefetchPanel(m.matchId)}>`，预取写进与面板**同一个 query key**（`matchEntryPanelKey`）、新鲜期 `PANEL_PREFETCH_STALE_MS = 30_000`（与 `web/src/main.tsx` 全局 staleTime 同口径，显式写死——全局若被改成 0 这条预取就退化成白拉）；已展开那场不重复拉；预取失败清掉缓存条目（`getQueryState(key)?.status === 'error'` → `removeQueries`），点开照旧正常取数、**不闪「面板加载失败」**。

验收：`npm run typecheck`（三份 tsconfig）0 error；`npx vitest run` **138 文件 / 2246 例全绿**（v6.51.9 基线 137/2239，净 +7 = TC-IDX-01..05 + TC-ENTRY-E14/E15）；`npm run build` ✓ 入口 `web/dist/assets/index-D3qBMZhr.js`（663,314 B / gzip 210.88 kB，sha256 `8cc937acf8514c417f86ec149c2d95ad241393e0bca4bf2c55a240a202a892fe`，含版本串 6.51.10）+ 页面 chunk `web/dist/assets/GrowthEntryPage-BFSZ17wJ.js`（35,969 B / gzip 10.95 kB，sha256 `bf82e034945f742aabdf17e7147737dc25690b333da503a1ec0c6c8e838c92f0`）；CSS 入口 `index-BGPWLRxy.css` 未变（零样式改动）。测试计划 `docs/test-plans/v6.51.10-growth-match-ref-index-and-prefetch.md`。

上线回读：`/` 200（入口 `assets/index-D3qBMZhr.js` + CSS `assets/index-BGPWLRxy.css`）、`/api/health` 200（d1/tour_db/kv 全 ok）、匿名 `POST /api/admin/growth/match-entry/1/ocr` ⇒ 401 `{"error":"未登录"}`；入口、页面 chunk、CSS 三件与本地 dist **逐字节一致**（sha256 `8cc937ac…` / `bf82e034…` / `dd4f5b5c…`）；线上页面 chunk 含预取代码（`<tr onMouseEnter/onFocus>` + `prefetchQuery({queryKey, staleTime})` + `getQueryState`→`removeQueries` 分支）。**生产 `EXPLAIN QUERY PLAN` 已核**（本次顺带收口「未验证项 2」）：列表计数 ⇒ `SEARCH ge USING COVERING INDEX idx_growth_events_match_ref (match_ref=?)`、面板行 ⇒ `SEARCH growth_events USING INDEX idx_growth_events_match_ref (match_ref=?)` 且**无 TEMP B-TREE** 行。

不做/未覆盖：① 真机体感与生产 `EXPLAIN QUERY PLAN` 未跑（上线后可跑一条只读 `EXPLAIN QUERY PLAN` 核对走索引）；② 面板内其它请求（OCR、保存后失效）不加预取；③ 触摸端（窄屏卡片视图）无 hover 语义，维持原样；④ 不做滚动可见性/空闲预取。

待核：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型 `LLM_MODEL` 上限未知）。

本地提交：`41512cd`（feat(worker) 索引迁移 + EXPLAIN 用例）+ `4db82b9`（feat(web) 悬停预取 + 页面用例）+ `9434774`（chore 版本号 6.51.9→6.51.10）+ `40ae714`（docs(v6.51.10)）；push `cbacac6..40ae714` 已执行（含 v6.51.9 上线回写 `c85c23c`）。

## [v6.51.9] · 成长录入页提速：比赛列表与录入面板取数并发化 + 停赛复算去重（2026-10-16）

**已上线（2026-10-16）**：push `a10a22f..cbacac6`（5 枚，含 v6.51.8 上线回写 `efc9d66`）⇒ CF Workers Builds 自动部署 Version `6c87d629-ce3a-46dd-9f73-2152e5edfcec`（@2026-10-16T23:51:51Z，100% 流量）；回读：`/api/health` 200（d1/tour_db/kv 全 ok）、线上入口 `assets/index-DsDpFJV5.js`（663,313 B / sha256 `31bba750…`）、页面 chunk `assets/GrowthEntryPage-Bxtugy8H.js`（35,556 B / sha256 `7cdfca62…`）、CSS 入口 `assets/index-BGPWLRxy.css`（94,381 B / sha256 `dd4f5b5c…`）三件与本地逐字节一致、匿名 `POST /api/admin/growth/match-entry/1/ocr` ⇒ 401「未登录」；零迁移 ⇒ 无需 apply。判级 **patch**（性能与读量治理——无新端点、无页面、**零迁移、零前端改动、零提示词改动、模型不变**，**SQL 逐字未改**，只改取数顺序与并发度）。缘起＝用户「先停，再做一个：改善成长录入页面比赛列表和录入面板的加载速度，先出方案」；诊断给出 A/B/C/D/E 五项，用户裁决「完成后做成长录入优化，**ABC 全做**」（D 新索引与 E 悬停预取不做）。

诊断（生产只读）：列表端点主查询 `duration 8.34ms` 但 `rows_read 77,708` ⇒ 慢的不是 SQL，而是**串行往返次数**——列表约 22 趟（主查询 + 每场逐队 `SELECT id FROM clubs WHERE name = ?` + 赛事名）、面板约 17 趟（八段串行：场次行 → 两队归属 → 赛事名 → 停赛复算 → 已录事件 → 主花名册 → 客花名册 → 累计基数）。

交付：① **列表端点（A）**——主查询与 `SELECT id, name FROM clubs` 并发取，队名 → 俱乐部归属改**内存查表**（新增 `clubIdMapOf` / `entrySideOf`，与 `resolveEntrySide` 同口径——CPU 队/空名短路、查不到留 null；后者保留给 OCR 与批量等单场调用方），赛事名仍单独一趟（跨库、依赖主查询的 `tournament_id`）⇒ 约 22 趟 → **3 条 / 2 波**，且与场次/队数无关（原实现队名各不相同时一场两趟，同名缓存只掩盖了重名那几场）；② **面板端点（B）**——八段串行并成**三波**：① 场次行 ∥ clubs 全表 ∥ 已录事件 ∥ 停赛复算 ② 赛事名 ∥ 两侧花名册（一次 `DB.batch`；CPU 侧 `bind(clubId ?? -1)` 走索引空集，等价于原来「不查」并换取语句位置恒定、结果按 `[主, 客]` 下标对齐）③ 累计基数（依赖花名册 id）⇒ 本库 6 条 + 赛事库 8 条；③ **停赛复算去重（C）**——`src/worker/tour-suspension.ts` 的 `loadTeamDiscipline(tourDb, tournamentId, teamId, entryIds)` 不再自查「本队有哪些 entry」（调用方已持有本场两侧 entry），且「比赛序 ∥ 红黄牌事件」并发；`suspendedPlayersAtMatch` 的「配置 ∥ 两侧 entry」并发、两侧队伍的数据并发取 ⇒ 查询 **9 条 → 7 条**。收窄 entry 集合不改判定（已写入注释并被 TC-SUS-15 钉住）：本队别的 entry 的序列只有「事件记在别的 entry 上」的球员会用到，而那些球员本场 `seq.findIndex((m) => m.id === matchId)` 恒为 -1，原实现同样整人跳过。

验收：`npm run typecheck`（三份 tsconfig）0 error；`npx vitest run` **137 文件 / 2239 例全绿**（v6.51.8 基线 137/2235，净 +4 = TC-LIST-06 / TC-PANEL-05 / TC-SUS-14 / TC-SUS-15，取数趟数用 `Proxy` 包 `prepare` 记 SQL 文本做守卫，断言时须过滤兼容模式会话那趟 `TOUR_DB user` 查询）；`npm run build` ✓ 入口 `web/dist/assets/index-DsDpFJV5.js`（663,313 B / gzip 210.88 kB，sha256 `31bba7504e685ee1df66e79980df02f1f0caad5712ace18a18a8d6605b880638`，含版本串 6.51.9）+ 页面 chunk `web/dist/assets/GrowthEntryPage-Bxtugy8H.js`（35,556 B，sha256 `7cdfca6270198d659304ff9d076cfcf7ed7c78ddd9a752b4ff67e55e44cb5d5a`）；CSS 入口 `index-BGPWLRxy.css` 未变（零前端改动）。测试计划 `docs/test-plans/v6.51.9-growth-entry-query-batching.md`。

不做/未覆盖：① D 新索引 `growth_events(match_ref)`；② E 列表悬停预取（先看本版体感）；③ 真机体感与生产 `rows_read` 净变化未实测（本地测试库无网络延迟，量化不出 RTT 收益）。

待核：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型 `LLM_MODEL` 上限未知）。

本地提交：`e58028d`（fix(worker) 取数并发化）+ `6ea0696`（test(worker) 趟数守卫）+ `8c7c908`（chore 版本号 6.51.8→6.51.9）+ `cbacac6`（docs(v6.51.9)）；push `a10a22f..cbacac6` 已执行（含 v6.51.8 上线回写 `efc9d66`）。

## [v6.51.8] · 截图识别「队名对不上」也能选边定侧 + 模型照抄英文名时自动分侧：冷门队不再只能重传（2026-10-16）

**已上线（2026-10-16）**：push `3a141fb..a10a22f`（6 枚，含 v6.51.7 上线回写），CF Workers Builds 自动部署 Version **`69b30fe3-2b93-4f1a-8401-34c6b848ed6b`**（deployment `9c430ee9-106d-4919-9f52-624b485a3d7a` @16:59:09Z）。判级 **patch**（同一处识别响应分支的补充：对不上的那条路多回一个可选 side 的机器码、前端多认一个码——无新端点、无新页面、**零迁移、零提示词改动、模型不变**）；上线只需 push（CF Workers Builds 自动部署），无需 apply 迁移。同日按用户追加「并入，然后发布」并入**英文名兜底分侧**（新增 `src/core/fc26-team-names.ts` 镜像 + 生成器 `scripts/gen-fc26-team-names.mjs`，仍无新端点/新页面/迁移）。**上线回读**：`GET /` 200 且入口仍是 `assets/index-Ddpx2Jdr.js`（663,313 B，sha256 与本地逐字节一致——兜底分侧在 Worker 侧，前端资产未变）；`/api/health` 200；匿名 `POST /api/admin/growth/match-entry/1/ocr` → 401。

缘起（用户）：一是报障「第 3 张识别失败：截图队名「OLYMPIACOS FC」对不上这场比赛（奥林匹亚科斯 vs 皇家马德里），确认传对图了吗」（第 4 张同队名）；二是随即指出恢复通道缺位——「返回让用户选边的功能没有真正成立」「这个功能没有体现啊」。

根因：v6.51.3 给「两侧一样像」（同城同名片段，如慕尼黑 vs 拜仁慕尼黑/慕尼黑1860）装了提示 + 主队/客队/取消三颗按钮，**但对不上（`if (!matched)`）那条分支当时没带 code** ⇒ 前端只认 `code === 'ocr_team_ambiguous'`，这条路一律落成红字「识别失败」。而队名对不上并不代表这张图的评分不能用：`shownTeam = ocr.teamRaw ?? ocr.team` 且没有「（识别为「…」）」括注 ⇒ 这条报错里模型给的就是英文原名（提示词里「没有通行中文译名时才照抄原文」的逃逸口被 OLYMPIACOS 命中），用户看到英文名 + 「确认传对图了吗」，自然会重传。

交付：① 服务端 `src/worker/routes/admin/growth.ts` 的 unmatched 分支改回 `code = 'ocr_team_unmatched'`，文案改为「截图队名「X」…对不上这场比赛（A vs B）——确实是这张图的队名，就点按钮选边；传错图请点取消」（仍然 400，`side` 直通逻辑不变：同一张图带 `side: 'home' | 'away'` 重发即跳过队名匹配）；② 前端 `web/src/pages/admin/GrowthEntryPage.tsx` 的 `runOcr` catch 同时认 `ocr_team_ambiguous` 与 `ocr_team_unmatched`，两条路走同一条待选行（提示带模型读到的英文原文 + 主队/客队/取消三颗按钮，选边用同一份 base64 续跑、取消则不预填）；③ 测试：TC-EP-13 补 code 与「点按钮选边」文案断言，页面新增 TC-ENTRY-E13（OLYMPIACOS FC 英文名 → 提示带英文原文 + 三颗按钮 + 选主队续跑 `body.side === 'home'`、报告条不落红字）。

④ **并入英文名兜底分侧**（用户追加「并入，然后发布」）：`src/core/fc26-team-names.ts` = `web/assets/ref/team.json` 的 Worker 侧镜像（696 条 `{id, name}`，生成器 `scripts/gen-fc26-team-names.mjs`，一致性由 `tests/fc26-teams.test.ts` 逐条钉死）；`fc26TeamIdOfName`（`src/core/growth-ocr.ts`）两趟匹配——先严格层（逐字 / 剥俱乐部前后缀的核心名相等），只有严格层没命中才退到宽松包含，**唯一命中才算**，多命中（只写 `Manchester`、镜像里两个 id 同名的 `AC Milan`）/游戏假名（`MILANO FC`）/空值一律回 null；端点（`src/worker/routes/admin/growth.ts`）**中文命中优先**，只在中文落空或歧义时用 `teamRaw ?? team` 的英文原文查队号、再与本场两侧 `clubId`（= FC26 队号）对齐，命中即照常认人预填、用户不必点按钮；两侧俱乐部查询合并成一次（同一份缓存既给选边也给取花名册用，顺带少一次查询）。

验收：`npm run typecheck`（三份 tsconfig）0 error；`npx vitest run` **137 文件 / 2235 例全绿**（v6.51.7 基线 136/2230；净 +5 = 镜像 2 例 + TC-TEAM-06 英文名→队号 + TC-EP-18 兜底分侧 + 上一段的 TC-ENTRY-E13）；`npm run build` ✓ 入口 `web/dist/assets/index-Ddpx2Jdr.js`（663,313 B，sha256 `1ce0a01262de243c118a72183c43cc910e1c84f620fbe4fa0abbcf4c83e0737e`，含版本串 6.51.8）+ 页面 chunk `web/dist/assets/GrowthEntryPage-DqIvzlA6.js`（35,556 B，sha256 `63b8fc82b6ba4ec2df5ab9ebc427d795522e0677954f8fe28d540c9205367371`）；CSS 入口未变（兜底分侧全在 Worker 侧，前端资产与上一段逐字节相同）。

原「留待补」的确定性英文名兜底已在本版落地（见交付 ④）；仍不做/覆盖不到的三处：① 姓名拼写容错层（用户此前裁决「暂时不做」）；② 游戏内显示假名的 4 支（Milano FC / Lombardia FC / Bergamo Calcio / Latium）——镜像存的是改回后的真名，截图给假名时查不到，落回按钮选边；③ CPU 俱乐部的英文名（`AC Milan` 在镜像里对应老 id 47 与新 id 131681 两条同名 ⇒ 多命中不猜）——CPU 侧花名册本就为空，桥接意义有限。

待核：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型 `LLM_MODEL` 上限未知）。

## [v6.51.7] · 零封联动收窄到「这张图里识别到的门将」（2026-10-16）

**已上线（2026-10-16）**：判级 **patch**（同一处草稿合并逻辑的口径修正，无新端点、无页面、**零迁移、零服务端改动、零提示词改动**——识别条目与模型不变，改的只是录入面板的自动勾选范围）；push `c451c06..3a141fb`（4 枚，含 v6.51.6 上线回写 `e5cd7e6`）触发 CF Workers Builds 自动部署 Version `b6933b16-00ac-4fb3-aa59-e5ca21932f6c`（@2026-10-16T15:17:31Z）；回读：线上入口 `assets/index-DpFqkcsf.js`（663,313 B，sha256 `de50706addbec6bd4237585498508a6cbe46db727a3ca41931ee5a64f926a6d9`）与页面 chunk `assets/GrowthEntryPage-DTGACkY6.js`（35,523 B，sha256 `cdc3dbd5947dcf187de22db60ada542f6b7f56429cff224504f69189b4eb5335`）与本地逐字节一致、`/api/health` 200（d1/tour_db/kv 全 ok）、匿名 `POST /api/admin/growth/match-entry/1/ocr` 401。

缘起（用户裁决）：先问「零封联动自动勾 2 名门将是什么机制」；随后判定现行行为不对——「不对吧，不应该联动的，上传的截图已经足够证明哪个门将上场了」；并要求把**已经被联动的清理掉**。

根因：`web/src/lib/growth-ocr.ts` 的 `mergeOcrEntries` 在本侧失球 0 时，把**整队** `position === 'GK'` 且未停赛、未录过（未锁定）的门将行全部自动勾零封（原注释还写着「无论识别条目里有没有他」）⇒ 双门将俱乐部（如佛罗伦萨 M. Carnesecchi + É. Mendy）会把**替补门将**也勾上、各 0.5 XP，而保存即锁定。证据链本可判断谁上场：服务端 `src/core/growth-ocr.ts:314` 明确写「N/A/没识别到评分 = 没上场，不预填」，门将页再按 `ocr.gk` 点名胜任门将 ⇒ **识别条目里出现的门将就是上场的门将**。

交付：`mergeOcrEntries` 先建 `shownGk`（只收 `entries` 里出现、`position === 'GK'`、未停赛的行），联动只勾这些行；失球 0 仍以**已确认比分**为权威（条目没带零封、例如门将页失球被读成 >0 时照勾），已锁定与已勾的行不动；文件头口径说明与 docstring 同步注明这次收窄；报告行「零封联动自动勾 N 名门将」随之只数真正上场的门将。

生产核查（只读，回答「已经被联动的清理掉」）：**库里没有需要清理的行**——全库 `clean_sheet` 36 条**全部 `source = 'auto'`**（CB 7 / CDM 15 / CM 2 / GK 1 / LB 6 / RB 5，即补账后的 auto 总数），`source = 'manual'` 的零封 **0 条** ⇒ OCR 联动从未写入过数据库；全库唯一门将零封是 `growth_events` id 702（A. Areola，诺丁汉森林，`match_ref = '173'`，0.5 XP，`auto`），来自确认钩子（该场诺丁汉森林 2:0 曼城(CPU)，他在赛事侧有一条助攻事件所以进了 `seen`），与联动无关。用户点过的 match 33 手录批次（13:03–13:05Z）只有 appearance 32 / rating 32 / duels_won 19 / saves 2、**无 clean_sheet**（该场 2:1，两侧都不该有零封）⇒ 看到过的自动勾只存在于浏览器草稿，刷新面板即回基线。

测试：`web/src/lib/growth-ocr.test.ts` 的 TC-FE-03 重写为「只看图里的门将」——6 行夹具 + 5 条识别条目（图里的 GK 勾、没出现在图里的 GK 不勾、已勾不重复计、已录锁定不动、停赛不碰、ST 不碰）断言 `gkAuto === 1`；失球 2 时 `gkAuto === 0`。定向 7 例通过；全量 **136 文件 / 2230 例全绿**。闸门：`npm run typecheck`（三份 tsconfig）0 error；`npm run build` ✓ 入口 `assets/index-DpFqkcsf.js`（663,313 B / gzip 210.88 kB，sha256 `de50706addbec6bd4237585498508a6cbe46db727a3ca41931ee5a64f926a6d9`，含版本串 6.51.7）+ `assets/GrowthEntryPage-DTGACkY6.js`（35,523 B，sha256 `cdc3dbd5947dcf187de22db60ada542f6b7f56429cff224504f69189b4eb5335`），CSS 入口未变。测试计划 `docs/test-plans/v6.51.7-clean-sheet-scope.md`。

**待核**：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型 `LLM_MODEL` 上限未知，仍未核）。

## [v6.51.6] · 赛事侧成长数据自动补账：没解析到的场次由 cron 重放钩子补齐（2026-10-16）

**已上线（2026-10-16）**：判级 **patch**（同一条链的自愈补丁，无新端点、无页面、**零迁移**）；push `a637bd1..c451c06`（4 枚，含 v6.51.5 上线回写 `269dbdf`）触发 CF Workers Builds 自动部署 Version `64c65af4-8e0b-42fb-8ad1-7d9f2d1398d3`（@2026-10-16T14:12:38Z）；回读：`/api/health` 200（d1/tour_db/kv 全 ok）、线上入口 `assets/index-DvQRIwgv.js`（663,313 B，sha256 `91f85c525c92224d69f68fd3d0df61512138a0439882dfdd95a06851f7530d9a`，含版本串 6.51.6）与本地逐字节一致；**生产补账随既有 cron 三跳收敛**（14:15 / 14:20 / 14:25Z 各一跳）：`needs_review = 1` **56 → 36 → 16 → 0**，且无一条 `result_confirmations` 留下「自动重试 N 次」或「已放弃」（56 场全部在额度内自愈）。

**缘起（用户）**：用户报「发现生产库有一些应当从赛事侧自动生成的成长数据没有生成」；诊断确认后裁决「**算了，还是自动重试吧**」（此前两版口径——先授权动手、后改「一次性补漏吧，不做大工程了」——均作废）。

**根因**：确认钩子只在**确认那一刻**跑一次，认不到球员只标 `needs_review` 不重试。2026-09-20 首批回填时两库 `fc_id` 关联尚未落值、姓名回落又扛不住赛事侧全名（`Paulo Dybala`）vs 平台侧官方缩写名（`P. Dybala`）⇒ 当天 62 场确认**零 auto 事件**（09-21 的 7 场部分成功，21 条），09-20/21 两批 69 场里仅 6 场有 auto 事件，事件级缺口 **170 个进球 + 140 次助攻**，56 场挂「N 项没解析到」至今无人收敛（自动确认本身健康：116 场完赛 / 116 场确认 / 0 漏确认）。

**交付**：① `src/worker/results.ts` 新增 `retryUnresolvedResults(env, cap = 20): XpRetrySummary`（`UNRESOLVED_RETRY_MAX = 3`）——扫 `needs_review = 1 AND review_note LIKE '%没解析到%'` 且排除「通知发送失败」「自动重试已放弃」的场次（`ORDER BY match_id LIMIT cap`），逐场 `replayHooksForMatch`（`{ notify: false }`，不重发通知）；通了清标记，没通在**重放重写后的 note** 上追加「（自动重试 N 次）」（计数器从重放前的 note 解析——`reviewOf` 会重建整条 note），第 3 次起写「自动重试已放弃：第 N 次仍没解析到，修完数据后可从管理端重放」不再占位；单场异常只 `console.warn` 不中断跳。② `src/worker/index.ts`：`runSettleTick` 在 `autoConfirmResults` 之后调用，响应体多 `xpRetry`；`tickChanged` 增第 4 参 `xpRetry: XpRetrySummary` 与 `xpRetry.healed > 0` 条件——补账写 `players.growth_xp`，而 `growthXp` 在公开球员载荷里（`src/worker/routes/players.ts:1211`）⇒ **只有真补到账的跳才付这次公开缓存 purge**，稳态（无欠账）恒为 0。③ `TECH_DESIGN.md:978` 的 `cron_tick` 行同步。

**幂等（重放安全的前提，已逐条核实）**：XP = `growth_events` 的 `UNIQUE(player_id, match_ref, event_type)` + `growth_xp` 增量 `NOT EXISTS` 闸（`src/worker/growth.ts:140-157`）；奖金 = `ledgerMovement` 的 `(club_id, kind, ref_type, ref_id)` 默认幂等闸（`src/worker/ledger.ts:29`）；比赛日收入 = `match_attendance` 有行即整段早退（`src/worker/home.ts:330`）；通知钩子重放直接跳过 ⇒ 三账都不双记。

**测试**：`tests/results.test.ts` 新增两例——TC-XP-01 自动补账成功（补数据后 `{ scanned: 1, healed: 1, failed: 0 }`、`needs_review=0` / `review_note=NULL`、`growth_events` 单条 goal 不双记、`players.growth_xp = 0.5`、再跑 `{ scanned: 0, healed: 0, failed: 0 }`）；TC-XP-02 一直解析不到（三次依次写「自动重试 1 次」「2 次」「自动重试已放弃」，第四次不再被扫；把 note 改回含「通知发送失败」时 `scanned = 0` 不碰）⇒ 全量 **136 文件 / 2230 例**全绿（v6.51.5 基线 136 / 2228，净 +2 例）；`npm run typecheck` 三份 0 error；build 入口 `assets/index-DvQRIwgv.js`（663,313 B，sha256 `91f85c525c92224d69f68fd3d0df61512138a0439882dfdd95a06851f7530d9a`，含版本串 6.51.6）；CSS 入口 `index-BGPWLRxy.css` 未变（零前端改动）。

**回读（上线后核对，2026-10-16）**：① `needs_review = 1` 三跳内 56 → 0；② auto 事件 **+268 条**（`goal` 99 → 230、`assist` 78 → 194、`clean_sheet` 15 → 36；`growth_events` 总数 463 → 731）——比诊断时的朴素估算（赛事侧 170 球 / 140 助）少，差额是**属于 CPU 俱乐部的进球者/助攻者没有平台球员可入账、被 `resolve()` 静默跳过**（既有设计），不是漏账；③ 抽 `match_ref='33'` 核对：用户手录 85 条 + 自动 6 条（3 球 3 助、各 0.5 XP）并存，无重复入账；④ 仍未核：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型上限未知）。

## [v6.51.5] · 截图识别输入侧稳定化：上传前 2× 放大（不换模型、不改提示词）（2026-10-16）

**已上线（2026-10-16）**：判级 **patch**（同一条链的可读性修补，无新能力）；**零迁移、零服务端改动、零提示词改动**，push `dff7fd9..a637bd1`（4 个提交，含 v6.51.4 上线回写 `67ad2fb`）触发 CF Workers Builds 自动部署 Version `13a090d1-c5e9-4b96-80d6-4b8f88ad74ff`（@2026-10-16T12:50:14Z）；回读：`/api/health` 200（d1/tour_db/kv 全 ok）、线上入口 `assets/index-CISzZnED.js`（663,313 B，sha256 `081b5c3cd2eb61d423f3486e955c866699894baa1dde48941100d8e3302c5424`）、页面 chunk `assets/GrowthEntryPage-oKNtpqgZ.js`（35,422 B，sha256 `ca0d144a352d72e30a391cb4ef36fa39c18391093d17e993947cf6d53ac5d8d6`）与 CSS `index-BGPWLRxy.css` 三件**均与本地逐字节一致**、匿名 OCR 端点 401。

**缘起**：4 张真图在管理端跑完后用户报「有识别错误」，并在追问稳定性的同时定调「不要换模型」；spike 结论必须满足这条约束。

**根因**：视觉模型对图像按像素切块——1920×1080 原图里表格姓名占的像素太少，两处误读是**系统性**的（glm-4.6v-flashx 关思考连跑 2 轮 × 4 张 = 8 次调用，逐次输出一字不差：`M. Carnesecchi` → `Carnesechi`、`A. Garnacho` → `Garmacho`）⇒ 「跑两遍取一致」这类重试没有收益，只能改输入（或换模型，已排除）。

**交付**：① 新增 `web/src/lib/ocr-image.ts`——`ocrUpscaleTarget(w, h)`（2× 等比放大、最长边封顶 4096、已超长边不缩小）+ `fileToOcrBase64(file)`（`createImageBitmap` → canvas 平滑放大 → PNG；解码后超 4.5MB 回退 JPEG 0.92；再超或环境不支持 / 解码失败则退回原图 base64，**不阻断上传**）；② `web/src/pages/admin/GrowthEntryPage.tsx` 删本地 `fileToBase64`，OCR 主路径改调该助手（歧义选边重试复用同一份 base64 的逻辑不变）；③ 顺手订正 `runOcr` 上方过期注释（原文写「glm-4v-flash 免费档限流」，模型早已换）。

**实测（4 张真图，glm-4.6v-flashx 关思考；探针在 %TEMP%，不入库）**：原图 3580 tok / 6–9 s / 固定两处误读 → 全图 2× 放大 6925 tok / 8.7–9.7 s / **4/4 全对**（Carnesecchi、Garnacho 均读对，队名 / teamRaw / 页签 / 数字与原先一致）；用浏览器 canvas 同款双线性插值放大两张问题图同样读对（PNG 1.79 / 2.17 MB，服务端 5MB 上限内）；**裁切方案实测否决**——裁掉右半会连带丢队名区域，3/4 图 team 变「未知」、teamRaw 为 null。

**测试**：`web/src/lib/ocr-image.test.ts` 8 例（TC-IMG-01..08：尺寸算法含封顶 / 不缩小 / 非法尺寸、base64 字节估算、正常放大路径、PNG 超限回退 JPEG 0.92、双超限退回原图、无 `createImageBitmap`、解码失败、已到 4096 不放大）；`web/src/pages/admin/GrowthEntryPage.test.tsx` 新增 TC-ENTRY-E12（mock 助手，钉住「页面确实走了这道工序」）⇒ 全量 **136 文件 / 2228 例**全绿（v6.51.4 基线 135 / 2219，净 +1 文件 +9 例）；`npm run typecheck` 三份 0 error；build 入口 `assets/index-CISzZnED.js`（663,313 B，sha256 `081b5c3cd2eb61d423f3486e955c866699894baa1dde48941100d8e3302c5424`，含版本串 6.51.5）+ `assets/GrowthEntryPage-oKNtpqgZ.js`（35,422 B，sha256 `ca0d144a352d72e30a391cb4ef36fa39c18391093d17e993947cf6d53ac5d8d6`）；CSS 未变。

**成本**：单图输入 token 3.6k → 6.9k，仍在 [0,32K) 最便宜档 ⇒ 约 0.002 元/图（原 ≈0.0015），一场四图 ≈0.8 分钱；延迟无实质差异（7.6–9.7 s）。

**待核**：真实浏览器 canvas 放大效果以管理端 4 张图复跑验收（预期认人失败清零）；`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200` 仍未核（文本模型上限未知）。

## [v6.51.4] · 截图识别三修：认人容忍「姓+首字母」形态 + 视觉模型换 glm-4.6v-flashx 且默认关思考 + 「不保存，继续」真丢草稿（2026-10-16）

**已上线（2026-10-16）**：判级 **patch**（同一条链上的缺陷修补：认人误报 / 模型额度与耗时 / 丢弃草稿没丢）；**零迁移 ⇒ 无需 apply**，push `e04c478..dff7fd9`（5 个提交）触发 CF Workers Builds 自动部署 Version `85f2f272-22a3-40ae-a2d3-fdb99465fda6`（@2026-10-16T12:08:19Z）；回读：`/api/health` 200（d1/tour_db/kv 全 ok）、线上入口 `assets/index-Cy37Jlw2.js`（sha256 `1008a0c1fa029ee7878f2cdffd7c207687735200dfbba0d43a4d559b80eff0f5`）与本地逐字节一致、`assets/GrowthEntryPage-BVTD6iRd.js`（sha256 `7b7f2eaaf401342d9ddd30108f4c752379c1053e61ebac31be1a2b6ef8976d66`）亦逐字节一致、匿名 OCR 端点 401；生产视觉模型与 max_tokens 已随 `wrangler secret put` 生效（Source = Secret Change 自动部署：`LLM_VISION_MODEL=glm-4.6v-flashx` → Version `54459c29-c53d-4fcb-b33f-bf5fd922c94b`、`LLM_VISION_MAX_TOKENS=8192` → Version `112ca117-31ae-4c5c-ac35-d3469f8673e3`）。

**缘起（用户）**：① 「1修」（先修认人）——4 张真图共 12 行「认人失败」里 7 行其实是库里写法与截图写法不一致；② 「顺便把模型改成 GLM-4.6V-FlashX，现在有额度了」（随后更正「flashx，不是 flash 那个免费模型」，并要求「应该先试图获取 model 元数据列表」）；③ 报 bug「点击不保存，继续后没有丢弃未保存改动」；④ 要账单估算与「怎么把输入压到 32K 以下」。

**根因**：① `matchRosterPlayer` 四层阶梯全是整名相等比较，跨不过「首字母缩写 vs 全名 vs 只存姓」（库里 `Marc Cucurella` / `Pedro Neto` / `Aleix García` / `Carvajal` / `Ibañez` vs 截图 `M. Cucurella` / `P. Neto` / `A. García` / `D. Carvajal` / `R. Ibáñez`）；② 生产视觉模型是免费档 `glm-4v-flash`（持续限流不可用），且 `glm-4.6v` 系列默认开思考——思考 token 计费且把单图耗时拉到 13–16s；③ 「不保存，继续」只执行了 pending 动作：收起 / 切比赛 / 切视图靠面板重挂丢草稿，唯独**换队侧不重挂**，草稿留着（横幅当时还写着「换队侧的草稿会保留」）。

**交付**：
① `src/core/growth-ocr.ts` 认人第五层：`matchRosterPlayer` 四层之后加「姓相同 + 首字母兼容」形态层（新私有 `nameShapeOf`、导出 `isSameSurnameShape`），命中唯一回 `matched: 'surname-initial'`，多命中仍回 null 不猜；`OcrEntry.matched` 联合类型加第 5 值，`web/src/lib/api.ts` 同步镜像。
② 视觉模型换 `glm-4.6v-flashx` + 关思考：`src/lib/llm.ts` 新增 `llmVisionThinkingEnabled(env)`，请求体对智谱端点（`bigmodel.cn`）默认带 `thinking: { type: 'disabled' }`（`LLM_VISION_THINKING=on` 时保留思考；非智谱端点不带该私有字段）；`src/worker/env.ts` 新增 `LLM_VISION_THINKING?`；生产 secret 已切（模型 + `LLM_VISION_MAX_TOKENS=8192`，8192 是必需项——缺省 1024 会被 4.6v 的思考吃满）。
③ `web/src/pages/admin/GrowthEntryPage.tsx` 丢弃语义订正：新增 `discardRef`（页面）与 `discardDrafts`（面板，用当前 data 重建两侧行），「不保存，继续」handler 改为「清 pending → 通知面板丢弃 → 执行 pending 动作」；确认条文案改为「收起面板、切换比赛、切换视图或换队侧，确认后都会丢弃草稿（不提交）」。

**实测（真实模型 + 生产提示词 1798 字符 + `E:\成长录入图` 4 张）**：`glm-4.6v-flashx` 开思考 13.2–16.1s / out 1604–1958 / reasoning 2097–2762 字符；**关思考 6.6–9.5s / out 652–765 / reasoning 0**，四张图名单与开思考完全一致（同一处小误读 `M. Carnesechi` 两边相同），生产 `extractJsonObject` 均可解析；免费档 `glm-4.6v-flash` 本轮复测仍全 429（code 1305）⇒ 不用。`glm-4v-flash` 也接受 `thinking` 字段（HTTP 200）⇒ 回滚安全。模型清单端点 `GET /api/paas/v4/models` 只列 11 个文本模型、不含任何视觉 id。

**账单（官方 pricing.md，2026-10-16 查；GLM-4.6V-FlashX 输入 [0,32K) 0.15 / 输出 1.5、[32K,128K) 0.3 / 3、缓存命中 0.03 元每百万 tokens）**：实测单图出站 `prompt_tokens` 3,572–3,649（约 1k 提示词 + 约 2.5k 图像）⇒ 已落在**最便宜的 [0,32K) 档**；关思考单图 ≈ 3.58k 输入 + 0.66k 输出 ≈ **0.0015 元/图**（开思考 ≈ 0.0031 元/图）⇒ 4 张/场 ≈ 0.6 分钱。

**测试**：`tests/growth-ocr.test.ts` TC-MATCH-04（形态层七行命中 + 拼写错不救 + 同姓两人不猜）、TC-MATCH-05（`isSameSurnameShape` 十组）；`tests/growth-ocr-endpoint.test.ts` TC-EP-04b（只给姓走形态层）、TC-EP-17（出站 thinking.disabled / `LLM_VISION_THINKING=on` 时不带 / 非智谱端点不带）；`web/src/pages/admin/GrowthEntryPage.test.tsx` TC-ENTRY-E10（换队侧 + 不保存 → 两侧都回基线）、TC-ENTRY-E11（收起 + 不保存 → 重开回基线）。闸门：`npm run typecheck`（三份 tsconfig）0 error；`npx vitest run` **135 文件 / 2219 例全绿**；`npm run build` ✓ 入口 `assets/index-Cy37Jlw2.js`（663,313 B，sha256 `1008a0c1fa029ee7878f2cdffd7c207687735200dfbba0d43a4d559b80eff0f5`，含版本串 6.51.4）。

**待核**：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（文本模型 `LLM_MODEL` 的上限未知；换模型时若小上限会同样 400）。

## [v6.51.3] · 截图识别的队名对侧：模型改输出中文队名 + 译名/前后缀漂移容忍 + 同城同前缀歧义保护 + 歧义一键选边（提示带截图英文原文）（2026-10-16）

**已上线（2026-10-16）**：判级 **patch**（同一能力的缺陷修补：库里中文队名 vs 截图英文队名必然对不上，识别结果被 400 拦下）；**零迁移 ⇒ 无需 apply**，push `0a07264..e04c478`（10 个提交，含本版 7 枚与 v6.51.2 上线回写、并行会话 2 枚）后 CF Workers Builds 自动部署 Version `43364b87-66f8-49a2-aff4-1921140df1aa`（2026-10-16T10:26:22Z）。零生产写；前端只动成长录入页的识别报告区（歧义那张渲染成一行提示 + 主队 / 客队 / 取消三颗按钮）。上线回读：`/api/health` 200（`d1` / `tour_db` / `kv` 全 ok）、线上入口 `assets/index-BWgmRcm6.js` sha256 `705e5f3ce3217561d78bdb20d5102f0769425609ebcbb13d49121cf4fbd9cd4e` 与本地构建**逐字节一致**、匿名 `POST /api/admin/growth/match-entry/1/ocr` ⇒ 401（路由挂载 + 守卫生效）。

**缘起（用户）**：管理端成长录入 4 张图全报「截图队名「FIORENTINA」/「CHELSEA」对不上这场比赛（切尔西 vs 佛罗伦萨），确认传对图了吗」——「卡在中英对应了」。

**根因**：`src/worker/routes/admin/growth.ts` 的队名对侧只做同语言归一化等值/双向包含，而库里 `clubs.name` 是中文（生产 20 队全中文），FC26 截图上是英文真名（`OCR_PROMPT` 也要求照抄截图）。

**交付**：① `OCR_PROMPT` —— `team` 字段要求输出中文队名，JSON 示例值改 `"team": "切尔西"`，并给一条映射示例（CHELSEA → 切尔西、FIORENTINA → 佛罗伦萨、FC BAYERN MÜNCHEN → 拜仁慕尼黑、RB LEIPZIG → RB莱比锡、REAL BETIS → 皇家贝蒂斯），无通行译名才照抄原文。② `src/core/growth-ocr.ts` 新增队名对侧纯函数 `teamNameKey`（折叠大小写/变音符 → 去空格标点 → 反复剥首尾 `rb/fc/ac/…/cpu` 前后缀）、`teamNameMatchStrength`（**强度分层**：3 归一化逐字 / 2 核心名相等 / 1 归一化或核心名互相包含（≥2 字才认））、`isSameTeamName`、`matchOcrTeamSide`（强度高者胜出，两侧同强度回 `'ambiguous'`）。③ 端点改用 `matchOcrTeamSide`，并新增 **`side` 入参直通**（带 `side` 即跳过队名匹配、按指定侧走：歧义提示里选边后用同一张图原样重发，模型只给英文名时也救得回；非法值 400「side 只能是 home 或 away」）；对不上仍是原 400 文案（逐字加截图原文/中文括注）；歧义回 **400 `code=ocr_team_ambiguous`**，文案「截图队名「FC BAYERN MÜNCHEN」（识别为「慕尼黑」）这场两侧都像（A vs B），分不清主客——请点按钮选边，或换一张队名更完整的截图」。④ **歧义保护（应对同城同前缀的队，用户提出）**：「慕尼黑」对拜仁慕尼黑 vs 慕尼黑1860、「皇家」对皇家马德里 vs 皇家贝蒂斯都是同强度 ⇒ 不猜、也不默认主队；写全了则强度更高的一侧胜出（「国际米兰」3 胜「AC米兰」1；「米兰」按核心名相等 2 判给 AC米兰）。⑤ **歧义一键选边（用户 m15308 / m15342 / m15362）**：`OCR_PROMPT` 增 `teamRaw`（照抄截图英文原名，只给用户核对、不参与匹配）；前端识别报告区把歧义那张渲染成一行提示（**显示模型读到的英文原文**，例「截图队名「FC BAYERN MÜNCHEN」（识别为「慕尼黑」）…」）+「主队 X」/「客队 Y」/**「取消（这张图不预填）」** 三颗按钮 —— 选边用同一张图带 `side` 续跑（不必重选文件，其余图结果保留），**取消**应对确实传错图的情况（该张不预填、不再打服务端、手填内容不动）。不猜 = 零预填 + 一行提示，绝不默认主队把花名册认到错侧。

**实测（生产提示词 + 用户 4 张真图 + `glm-4v-flash`，探针 `%TEMP%/probe-ocr.mjs`）**：中文队名 **4/4 精确命中**（佛罗伦萨 ×2 / 切尔西 ×2，与库内逐字相同），**球员名保持英文缩写**（未被中文化），HTTP 200 / 12.1–16.3 s、usage in=3572、out 561–681、`finish_reason=stop`、JSON 可解析、rows 12；提示词 1555 → 1686 字符。**复测（歧义保护落地后同口径重跑）**：4/4 仍全中，耗时 15.8 / 14.1 / 15.3 / 15.2 s（平均 **15.1 s**，无一次重试），出参 654 / 651 / 681 / 645 tokens（占 1024 上限 63–67 %，有约 1/3 余量，12 行场景不会触顶），`finish_reason` 全为 `stop`；抽查一张门将页全文 JSON：`tab=goalkeeping` 页签识别正确、9 名首发 + 3 个 SUB（`rating: null`，规则被遵守）、门将自检 `saves 1 + goalsConceded 2 = shotsOnTarget 3` 成立、`selected: null`、评分与计数均为 JSON number、球员名英文。**已否决**「把本场两个候选中文名写进提示词让模型二选一」：0/4 生效（模型照抄英文原文）—— 条件式指令在这档小模型上不可靠，直接给映射示例才有效。**终稿提示词（含 `teamRaw` 要求，1798 字符）再测**：4/4 HTTP 200，`team` 仍中文（佛罗伦萨 ×2 / 切尔西 ×2）、`teamRaw` = `FIORENTINA` ×2 / `CHELSEA` ×2，球员名仍英文缩写，`finish_reason=stop`、out 571–666 tokens、11.8–20.1 s。

**测试**：`tests/growth-ocr.test.ts` 新增 **TC-TEAM-01/02/03/04/05**（核心名 / 同队判定 / 落侧强度择高 / 歧义保护（慕尼黑·皇家·米兰双雄）/ 强度分层）与 **TC-OCR-05**（`teamRaw` 解析：照抄收下，缺失 / 空白 / 非字符串回 null）；`tests/growth-ocr-endpoint.test.ts` 新增 **TC-EP-11**（出站提示词锁中文队名 + `teamRaw` 口径）、**TC-EP-12**（译名漂移 + CPU 尾标不再误报）、**TC-EP-13**（英文队名仍 400 且文案点名对阵）、**TC-EP-14**（国际米兰 vs AC米兰 写全判对；只写「慕尼黑」两侧都像 ⇒ 400 报「分不清主客」+ `code=ocr_team_ambiguous`）、**TC-EP-15**（`side` 直通：歧义片段与英文队名都能靠 side 走通；非法 side 400）、**TC-EP-16**（歧义文案带 `teamRaw` 英文原文）；`web/src/pages/admin/GrowthEntryPage.test.tsx` 新增 **TC-ENTRY-E8**（歧义提示 + 三颗按钮 + 选边用同一张图续跑）与 **TC-ENTRY-E9**（取消：不预填、不再打服务端、待选行收掉、手填值不动）。闸门：`npm run typecheck` 0 error；`npx vitest run` **135 文件 / 2213 例全绿**（基线 135/2199，净 +14）；`npm run build` ✓ 入口 `web/dist/assets/index-BWgmRcm6.js`（663.31 kB / gzip 210.88 kB，sha256 `705e5f3ce3217561d78bdb20d5102f0769425609ebcbb13d49121cf4fbd9cd4e`，含版本串 `6.51.3`）。测试计划 `docs/test-plans/v6.51.3-ocr-team-name-chinese.md`。

**待核（未并本版）**：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（事件结构草稿走文本模型 `LLM_MODEL`，上限未知）。

## [v6.51.2] · 视觉识别 max_tokens 订正：缺省 4096 → 1024（模型硬上限）+ `LLM_VISION_MAX_TOKENS` 可配 + 截断明确报错（2026-10-16）

**已上线（2026-10-16）**：判级 **patch**（缺陷修补，零新增能力、零契约变化）；**零迁移 ⇒ 无需 apply，push 即部署**。push `ee46840..0a07264`（含上轮 v6.51.1 上线回写），CF Workers Builds 自动部署 Version `3f2a8e22-6799-4172-9357-0e9d733e422b`（2026-10-16T05:59:01Z）。上线回读：`/api/health` 200（`d1` / `tour_db` / `kv` 全 ok）、线上入口 `assets/index-D_Vc8k4n.js` sha256 `9ceb33bfba2e54d5fedefb48e0ff7c43d10dc52fc598e566d19fdf58f78d0fc1` 与本地构建**逐字节一致**（663 283 B）、OCR 端点匿名 401（路由挂载 + 守卫生效）。本地闸门：`npm run typecheck` 三份 0 error、`npx vitest run` **135 文件 / 2199 例**全绿、`npm run build` 成功（入口含版本串 `6.51.2`）。

**缘起（用户 m14677）**：「成长录入截图识别报LLM 返回 400：`{"error":{"code":"1210","message":"max_tokens参数非法：限制数值范围[1,1024]"}}`，图片来自 `E:\成长录入图`」—— 管理端成长录入的截图识别**自 v6.43.0 上线起必错**，与图片、网络无关（4 张 PNG 均过魔数与 5MB 校验，报错在 0.4s 参数校验阶段返回、不进推理）。

**根因**：`src/lib/llm.ts` 的 `llmVisionJson(env, image, prompt, maxTokens = 4096)` 缺省写死 4096，而生产视觉模型 `LLM_VISION_MODEL` = `glm-4v-flash`（免费档）只接受 [1,1024]；`scratch/v643-spike/spike.mjs:174` 原有按模型分档（`/glm-4v-flash/.test(model) ? 1024 : 4096`），移植进生产代码时丢失。诊断阶段实机探针复现（智谱直调、`E:\成长录入图` 真图）：4096 → 400（回包原文一字不差）；1024 → 200 / 24s / `usage in=3492 out=648` / `finish_reason=stop` / 解析 12 行。

**交付**：① `src/lib/llm.ts` —— 新增 `VISION_MAX_TOKENS_DEFAULT = 1024` 与 `llmVisionMaxTokens(env)`（读 `LLM_VISION_MAX_TOKENS`，缺省 / 非法一律 1024），`llmVisionJson` 签名改 `maxTokens?: number`、缺省时取 env 值；② `src/worker/env.ts` 声明 `LLM_VISION_MAX_TOKENS?: string`（换付费视觉模型时抬高，不必改代码）；③ `finish_reason === 'length'` 由「不是合法 JSON」改判为点名截断：`视觉模型输出被截断（max_tokens=… 用满），请重试或调大 LLM_VISION_MAX_TOKENS`，且**截断后即便 JSON 仍可解析也判失败**（漏记球员比要求重试更贵）。调用点 `src/worker/routes/admin/growth.ts:491` 无需改动（吃新缺省）。

**测试**：`tests/growth-ocr-endpoint.test.ts` 新增 **TC-EP-08**（缺省 1024 + 非法 env 回落 1024）、**TC-EP-09**（`LLM_VISION_MAX_TOKENS=4096` → 出站 4096）、**TC-EP-10**（截断报错点名、可解析也不放行），该文件 7 → 10 例。测试计划 `docs/test-plans/v6.51.2-ocr-vision-maxtokens.md`。

**待核（未并本版）**：`src/worker/routes/admin/events.ts:182` 的 `maxTokens: 1200`（事件结构草稿，走文本模型 `LLM_MODEL`）—— 文本模型上限未知，若同为 1024 上限会以同样方式 400。**另**：备选视觉模型 `glm-4.6v-flash` 经实测**不采纳**（该模型存在、上限 [1,32768]，但 1024 输出即被推理吃满、且连续调用 429 `code 1305 该模型当前访问量过大`，用户裁决放弃，继续只用 `glm-4v-flash`）。**上线后待办（用户侧）**：用 `E:\成长录入图` 的 4 张图在管理端成长录入页各跑一次识别（真实端到端；自动化只覆盖到出站参数与回包解析）。

## [v6.51.1] · 品牌池表格显示微调：来源/状态列不再折行 + 新增「总部」只读展示列 + 收窄行业/热度列宽（2026-10-16）

**已上线 2026-10-16**（Version `7fc239a6-ff2f-4283-b6c6-955a12b26e0d`，push `0f5a216..ee46840`；**零迁移 ⇒ 无 apply**，无生产写；线上资产与本地构建逐字一致：入口 `assets/index-SfH_zacy.js`（sha256 `47d20a2b3f59…`，含版本串 `6.51.1`）+ 惰性块 `assets/BrandsPage-BuCzDGdC.js`（sha256 `794ed8a1ca6f…`，含「总部」）+ `assets/index-G3fpYeiH.css`（含 `.brand-meta-cell`）；回读 `/api/health` 200、`/api/clubs` 200、匿名 `/api/admin/brands` 401）。判级 **patch**：无新增能力、零契约变化 —— 纯管理端展示微调。**缘起（用户 m02096 / m02183）**：①「来源 状态两列对应文字折行了，减小字号」；②「行业和热度减小列宽，加入『总部』一列，在行业之前（仅展示列）」。

**交付（`web/src/pages/admin/BrandsPage.tsx` + `web/src/styles.css`）**：① 来源 / 状态两列挂 `.brand-meta-cell`（`font-size: 12px` + `white-space: nowrap`；规则落样式表、行内不带尺寸 ⇒ 不触 `tests/mobile-baseline.test.ts` 的固定宽禁令），列窄时不再把「种子 / 在池」折成两行；② 桌面表格在「行业」之前插入只读「总部」列（取该行 `hq`，空值显示「—」，不挂任何输入控件），列序变为 品牌 / 总部 / 行业 / 热度 / 档位 / 来源 / 状态 / 生效冠名 / 操作（9 列，展开行 `colSpan` 8 → 9）；窄屏卡片流的元信息行同步补「总部 {hq}」；③ 行业输入框 96 → 72（值恒为 2 字）、热度 72 → 56（值形如 `0.95`；档位 84 不动），`tests/mobile-baseline.test.ts` 的 `FIXED_WIDTH_ALLOWLIST` 两条同步登记（各恰好命中 1 次、清单外零命中）。

**测试**：`web/src/pages/admin/BrandsPage.test.tsx` 新增 **TC-BR-04**（列序九列 + 总部格为纯文本且无 `input` / `select` / `textarea` + 来源/状态两列类名 + `.brand-meta-cell` 规则静态锁），该文件 4 例。闸门：`npm run typecheck` 三份 0 error；`npx vitest run` **135 文件 / 2196 例**全绿；`npm run build` 成功。浏览器实测（本地 dev 8791，1280×720）：表头 9 列、28 行；首行总部「巴塞尔」72px 宽且无控件、行业框 72px、热度框 56px、来源/状态 12px 单行。测试计划 `docs/test-plans/v6.51.1-brand-table-display.md`。

## [已上线] · tour 侧增量 — 积分榜重算自愈（tour 单仓，不占本仓版本号）（2026-10-15，Version 5cf7decb-c375-49e3-873b-0dc5fbcd6be0）

**本仓无任何代码改动**（本节是共享台账里的一条；赛事仓自身的权威文档是 `PRD.md` / `TECH_DESIGN.md`）。赛事仓 3 个提交（`8676d4e` feat(standings) / `6358f42` feat(admin) / `4183832` feat(web)）**已 push**（`81f0643..4183832`）并自动部署（该仓已接 CF Workers Builds，push 即构建）；迁移 `0029_rebuild_pending.sql` 已 apply 生产。设计与实施计划在该仓 `docs/`（按该仓 `.gitignore:13` 的 `docs/` 约定不入库）。

**缘起**：2026-10-15 拜仁 vs 曼城（`match` 193）终场提交只落了半截——比赛已标 `finished`、积分榜未重算、`audit_log` 也没有 `match_finish` 行（终场提交两段式 + D1 无跨语句事务，第二段失败时只有 `AdvancerError` 会回滚）。用户在比赛系统管理端用「扣分再取消扣分」触发重算修好了那场的榜面值，本轮把病根堵上。

**交付**：① 迁移 `0029`：欠账表 `rebuild_pending`（语义「后续处理没跑完」）+ `standing.carried_played`（对账不被源阶段后续开打污染）；② `worker/lib/rebuild-guard.ts`：主写入与欠账标记同批提交、后续处理全部成功后**单独一批**销账、`AdvancerError` 不降级（调用方回滚并同批删标记）、`healPendingRebuilds` 每小时 cron 兜底；③ 六写入点接线（报分 / 带入 ×2 / 赛程生成 ×2 / 删单场 / 删阶段场次 / 扣分），报分降级回 200 + `standingsPending: true`；④ 管理端 `GET /api/admin/tournaments/:id/standings-health` 体检（欠账 + 对账等式 `played == 本阶段 finished 数 + carried_played`）与 `POST /:id/rebuild-standings` 一键重算（**先重算后清账**，审计 `standings_rebuild`），前端黄条 +「立即重算积分榜」+ 报分文案「比分已记录，积分榜正在补算」。

**验收**：赛事仓 `npm run typecheck` 0 error；`npm test` **628 passed | 7 skipped**（53 文件，新增 `tests/rebuild.selfheal.test.ts` 15 例）；`npm run build` ✓。生产只读核验：`rebuild_pending` 表在场、`standing` 16 列、`carried_played <> 0` 行数 0（历史行待补账）。回读：`/api/health` 200、匿名体检端点 401、公开榜 stage 2 未被扰动（曼城 played 8 / 10 分第 4，拜仁 played 8 / 9 分第 5）、线上两份资产 sha256 与本地 `dist/` 逐字节一致。

**待办（用户侧一次性）**：赛事管理页点一次「立即重算积分榜」补历史 `carried_played`（补账前带带入阶段黄条为预期假阳性）—— **2026-10-16 用户已执行**：生产只读核验 `standing.carried_played <> 0` = **16 行**、`rebuild_pending` = **0 行**、按 `played == 本阶段 finished 场次 + carried_played` 对账**不一致 0 行**（黄条转健康；公开榜数值未变）。详见 [ROADMAP.md](./ROADMAP.md) 的「tour 侧增量 · 积分榜重算自愈」节。

**版本收口（2026-10-16）**：赛事仓 `chore(release): 收口 v5.8.0` 提交 `d150f88`（`package.json` 5.7.4 → 5.8.0 + `VERSIONS.md` 第 58 行）已 push（`4183832..d150f88`）并由 CF Workers Builds 自动部署 Version `1bc9288c-b74a-4431-bd7d-68b13bfbce38`（2026-10-16T10:26:48Z）；线上入口 `assets/index-NQ57Q1kq.js` sha256 `2ec90d7fbc2ffc999954e03aff2ecd23dfa08058cd22a692797eac9aa2f99a3e` 与本地 `dist/` 逐字节一致，`/api/health` 200。判级 **minor**（新增管理端端点与用户可见能力）。

## [v6.51.0] · 强制拍卖解禁与可指定挂牌价（前六降参考值 + 预检端点）+ 品牌池三批（全虚构化 28 家 / 冠名落点名 / 企业档案 / 招商性格与对赌抽签引擎）（2026-10-15）

**已上线 2026-10-16**（Version `5d4385eb-6e88-45fa-bb2c-1ee065eea221`，push `0157d87..0f5a216`；迁移 `0071` → `0072` → `0073` → `0074` → `0075` 已按序 apply 生产 —— 五条全 ✅、`migrations list --remote` 无待应用；回读通过：`brand_pool` **28 行** / `origin='中资'` **6** / `style='对赌'` **7** / 档案 9 列 28 行齐备 / 13 个真实品牌名残留 **0**；`naming_contracts` 新列 `venue_name`、`bet_terms` 均在（存量 0 行）；线上资产与本地构建逐字一致：主包 `index-SaRKu1mz.js` + 新惰性块 `ShopPage-yP3didCV.js`（含「签下将命名为」）/ `BrandsPage-DAGlYRL2.js`（含「招商性格」）均 200）。本地闸门全绿：`npm run typecheck` 三份 0 error；`npx vitest run` **135 文件 / 2195 例**全绿；`npm run build` 成功。**上线顺序硬约束 = 迁移 `0071` → `0072` → `0073` → `0074` → `0075` 一次 apply 生产 → push → 部署 → 回读**（五个迁移按序、不可打乱：`0073` 的全虚构化改名必须早于 `0074`/`0075` 的档案与性格配种，否则配种落不到行上）。迁移无破坏性改动（`ALTER TABLE … ADD COLUMN … DEFAULT ''` + 幂等 `UPDATE` / `INSERT OR IGNORE`），且生产 `naming_contracts` 实测 **0 行** ⇒ 改名与落点名影响面为零（`market_offers` 走 `brand_id`，不受影响）。`scripts/e2e/smoke.mjs` 的 ㉓ 步已改为新口径（28 家 / 全虚构名 / 「中资」6 家 / `style='对赌'` 7 家），已在本地 dev（8791）实测 **27 / 28 通过**——本版 ㉓ 通过；唯一失败 ㉒ 成长档位是 **v6.48.0 存量缺陷**（断言要 `action='club_country_set'` 的行，而端点 `src/worker/routes/admin/growth-tier.ts:113` 只筛 `growth_tier%`，两者同出提交 `1593362`；`audit_log` 里那行确实写入了），本版未擅自改端点过滤。**（2026-10-16 已修正 —— 用户裁决「只改断言、不扩端点过滤」：㉒ 改为按行 id 增量断「效果」，改国家后变更清单的新增行数须 === 重算回报的 `up + down` 且每行都是 `action='growth_tier_set'` / `targetType='player'` / `after.auto === true`（`growth_tier_recompute` 批次汇总行只由管理端批量重算入口写，这条路径上不产生）；修正后本地 dev 8791 `npm run test:e2e` = **28 / 28**。详见 `docs/test-plans/v6.48.0-growth-tier-auto.md` 文末「修正」段。）**

**独立复审后的三处实现修正（code-review-skill，同日）**：① 对赌阈值的样本场次 `n` 改为 `expectedWindowScale(samples)` 给出的**近 3 窗同尺度场次均值**（`home` = 主场场次、`all` = 已确认全部场次）—— 原实现读 `season_windows.tournament_id` 取赛程，该列在 `0014` 迁移后**已休眠**（全仓唯一写点 `src/worker/window-machine.ts:170`），生产 `n` 会恒 0 导致四个计数型指标永久出池；② **反解尺度 = 结算尺度**（`attend`/`sellout` 用主场尺度，`points`/`goals`/`cleansheet` 用全窗尺度 —— 结算只读 `result_confirmations`，无主客区分），否则线被顶到 0.916–0.974、破经济式与支出界；③ **G3 加固**：每项奖金 = `min(0.25, 1 / windows_total) × 底价`（4 窗仍是 0.25；`windows_total` 调大也不破 G2 ≤ 1.20× / G3 ≤ 2.0× 底价），结算不再读 `bonus_amount`（配置 `bet.bonusRate = 0.7` 保留为旧展示口径：`0.7 × 对赌费 ≈ 0.49 × 底价`）。新增 `tests/naming-bet-scale.test.ts`（8 例：尺度来源回归锁 / 蒙特卡洛达线率带 / 签约→结算闭环 / G3 任意窗数）。修正细节与实测数值见 `memory/design-brand-pool-structure.md` §4.9。

**缘起（用户 m13213）**：「把管理端强制拍卖改为无限制，本队非门将CA前六仅作为一个校验参考值，不强制；品牌池写一些新东西，并统一品牌名为中文」。**追加（用户 m13596）**：「强制拍卖可指定挂牌价，并入此版」。**品牌池三批（同版并入 v6.51.0，设计见 `memory/design-brand-pool-structure.md`）**：① 全池**虚构化 + 欧洲化**（池 16 → 28 家，22 家欧洲属地 + 6 家中资，避免真实品牌名）；② 品牌**企业档案**（英文名 / 全称 / 品牌色 / 口号 / 总部 / 简介 / 性质）落地到管理端可编辑、教练端可展示；③ 冠名**落点名**（`品牌·球场原名`，中点连接）写进合同与球场档案；④ 招商**性格**决定递什么套餐（稳健 / 进取 / 对赌），对赌合同签约时按品牌**偏好标签**抽签生成两条窗级指标条款（取代逐品牌硬编码），并带四层硬护栏。


**交付（强拍人选解禁，`src/worker/bypass.ts` + `src/worker/routes/admin/market.ts`）**：删掉三道硬闸 —— 门将 400、`ca IS NULL` 409、队内非门将 CA 排名 >6 的 409。保留五道闸 = 球员存在且有归属（404）、转会窗未开（409 `no_window`）、时刻表 `transfer_forced_auction` 段（`opBlockReason`）、CPU 队球员（400，CPU 队不入账）、状态非 `normal` 与已在市场流程里（400）。新建导出 `inspectForcedAuction(env, playerIdInput)`：一次算出参考值 `reference = {playerId, playerName, clubId, clubName, position, ca, isGk, caRank, topSixLine, inTopSix, nonGkWithCa}`（`caRank` = 队内非门将 `ca` 严格更高者 + 1；`topSixLine` = 队内非门将 CA 降序第 6 名；门将 / 缺 CA ⇒ `caRank` / `inTopSix` 为 `null`）与 `blockers[]`（status / message / errCode）。建单 `POST /api/admin/forced-auctions` 内部调它、`blockers[0]` 抛同文案 `HttpError`，**响应新增 `reference`**；正常竞价链、整单 50% 税、取消链全不变。新增只读预检 `GET /api/admin/forced-auctions/preview?playerId=`（管理端），只回 `{reference, blockers}` 且**不写库**。为让预检能「给原因」，`src/worker/ops-schedule.ts` 抽出 `opBlockReason(db, opKey)`、`assertOpOpen` 改走它（行为零变化）。

**交付（可指定挂牌价，用户 m13596）**：建单体新增可选 `askPrice`（单位 m；缺省 = `FORCED_AUCTION_PRICE` 1m，即 4.4.5 原口径，老调用方行为不变）。`src/worker/bypass.ts` 新导出 `parseForcedAuctionPrice(input)`：`undefined` / `null` / `''` 回默认 1；否则 `Number()` 后校验「有限且 > 0」（不满足 ⇒ 400 `挂牌价须为正数（单位 m）`，与普通挂牌同文案）+ `round2` 两位小数。落库 `listings.ask_price`、审计 `after.askPrice`、响应 `askPrice` 三处同用该值。**下游口径自动随价、零额外改动**：起拍价 = 挂牌价（`validateBidAmount` 首价门槛 ⇒ 「首笔出价不得低于挂牌价 X m」）、下架费 = `delistFee` = 10% × 挂牌价（默认 1m 时仍 0.1m，向后兼容；6m 挂牌即 0.6m）、成交税 = 整单 50% × 成交价。

**交付（管理端 `web/src/pages/admin/MarketPage.tsx`）**：球员 ID 一填即显示参考值行 ——「非门将 CA 队内第 N 位（前六线 CA X），落在前六 / 不在前六（同样可挂）」，门将与缺 CA 各有专门文案，末尾缀「⚠ 现在挂出会被拒：<原因>」或「可挂出」；新增「挂牌价（m）」输入（默认 1、`step 0.5`、填非正数即禁用挂出按钮），POST 带上 `askPrice`；提示文案改为「按给定挂牌价强拍（默认 1m，起拍价即挂牌价，之后每次加价 ≥ 1m；窗尾无人出价按下架费 10% 挂牌价收）」+「人选不限——本队任何正式球员都可挂…『非门将 CA 前六』只是填了球员 ID 后给出的参考值（并标出前六线），不拦截挂出」；成功 toast 带球员名、参考值（标注「不强制」）与本次挂牌价（`res.askPrice`）。

**交付（品牌池扩编，迁移 `0071_brand_pool_expand.sql`）**：`CVS Health` → **西维斯健康**（`brand_pool` 改 + `naming_contracts` 兜底改，两处幂等）；新增 9 家（全 `source='builtin'` / `status='adopted'`，`INSERT OR IGNORE` 幂等）：青云乳业 0.82 饮食 / 长风汽车 0.88 汽车 / 白马体育 0.86 运动 / **极星运动 0.95 运动（新兴）** / 天工重工 0.74 制造 / **鲸涛饮品 0.91 饮食（新兴）** / 磐石银行 0.79 金融 / 迅达通讯 0.84 科技 / 星野文旅 0.68 文旅。`naming_industry_factors` 默认表补 汽车 1.05 / 金融 1.15 / 制造 1.1 / 文旅 0.9（未登记行业回 1.0 不变；**config 键数不变**）。**档位与名额口径不动**：新品牌热度最高 0.95 < 1.0 ⇒ 头部仍是亚马逊 / 麒麟生物 / 阿迪达斯；关窗自动校准照旧按热度重算（`tier_locked` 优先）。

**交付（冠名落点名，迁移 `0072_brand_venue_naming.sql`）**：`naming_contracts` 新增 `venue_name`（`TEXT NOT NULL DEFAULT ''`；落库即快照 ⇒ 之后品牌改名或球场更名不影响已生效合同的展示名）。`src/worker/naming-ops.ts` 新导出 `composeVenueName(brand, stadiumName)`（`品牌·球场原名`，中点连接；球场名为空回 `''`）与 `venueNameOf(snapshot, brand, stadiumName)`（快照优先、空则现拼 ⇒ 老合同也能显示）。三个写入点全部补值：新签（`src/worker/market-ops.ts` 的 `acceptOffer`）、接班转正（`activateQueuedStatements`）、续约（`renewNaming` 的 `UPDATE`）。读侧：`GET /api/me/club` 的 `home.namingVenueName`、`namingContractDto.venueName`、报价卡 `offerDto.venueName`、`src/worker/weather-ops.ts` 的 `stadium.venueName`（无冠名 `''`，`stadium.name` 语义不变 ⇒ 消费点零改动）。站内信 `naming_offer_activated` 改「✅ 品牌接替生效：「{落点名}」正式启用（{套餐}套餐，{费率}M/窗 × N 窗）。」+ 品牌署名行「—— {品牌}（{总部}）」（无落点名回落「「{品牌}」冠名 {球队} 正式生效」）。前端：`web/src/pages/club/VenueTab.tsx` 球场标题用落点名（无冠名回落球场原名）、`web/src/pages/shop/venueCards.tsx` 报价卡加「签下将命名为 {落点名}」与合同卡标题用落点名。

**交付（品牌池全虚构化与欧洲化，迁移 `0073_brand_fictionalize.sql`）**：池 **16 → 28 家** = **22 家欧洲属地造词名 + 6 家中资**（长风汽车 / 白马体育 / 青云乳业 / 精卫重工 / 星海通讯 / 霜降茶业，全在「口碑」档）。12 家真实品牌名改虚构名（亚马逊 → 奥维恩、麒麟生物 → 凯利昂生物、阿迪达斯 → 维洛、可口可乐 → 斯科尔汽水、海底捞 → 洛森餐饮、极星运动 → 诺迪运动、鲸涛饮品 → 维奥莱饮品、迅达通讯 → 埃斯洛通讯、磐石银行 → 罗讷银行、天工重工 → 莱茵斯重工、`CVS Health` / 西维斯健康 → 埃尔巴草本、星野文旅 → 奥拉维文旅），`brand_pool` 与 `naming_contracts.brand` 两处幂等 `UPDATE`（后者为兜底，实际生产 `naming_contracts` 为 0 行）；新增 12 家（维斯兰科技 0.93 科技 / 瓦隆酿造 0.90 饮食 / 塞拉越野 0.89 运动 / 诺德保险 0.87 金融 / 泰拉蒙汽车 0.86 汽车 / 瑟兰制药 0.84 医疗 / 洛朗烘焙坊 0.83 饮食 / 精卫重工 0.81 制造 / 霜降茶业 0.78 饮食 / 比特兰科技 0.76 科技 / 梅尔泽证券 0.74 金融 / 阿尔维文旅 0.70 文旅；`INSERT OR IGNORE` / `source='builtin'` / `status='adopted'`）。热度、行业、档位布局一律不动（头部仍 奥维恩 / 凯利昂生物 / 维洛）。回滚 = 反向 `UPDATE` + `DELETE` 新增 12 家。**如实登记**：22 家欧式名全为造词（OVIEN / VILO / SKOLL / CALEON…），按构造不指向真实公司，但**未经商标库核验**（核查渠道未打通），建议上线后抽查 3–5 个。

**交付（企业档案 7 列，迁移 `0074_brand_profiles.sql`）**：`brand_pool` 新增 `name_en` / `full_name` / `color` / `slogan` / `hq` / `intro` / `origin`（全 `TEXT NOT NULL DEFAULT ''`）+ 28 家档案配种（22 家欧洲属地；6 家中资 `origin='中资'` 且属地为中国城市）。管理端 `GET /api/admin/brands` 增 9 列（含 `style` / `prefer`），`POST` 可选带档案字段，`PATCH /api/admin/brands/:id` 增校验（`name_en` ≤ 40 / `full_name` ≤ 30 / `slogan` ≤ 20 / `hq` ≤ 20 / `intro` ≤ 80 字；`color` 空或 `^#[0-9A-Fa-f]{6}$`；`origin` ∈ {`''`,`中资`}；「至少给一个字段」的判断含档案键；审计 before/after 全字段）。`web/src/pages/admin/BrandsPage.tsx` 行内编辑与新增表单加 7 个输入（色值取色器 + 文本兜底、简介 textarea、性质下拉；列表行显示色块 + 英文名 + 「中资」标签）。教练端展示：`web/src/pages/shop/venueCards.tsx` 报价卡与现约卡在品牌名后缀口号小字、加「总部 · 行业」hint、`origin` 非空时加「中资」小标签（现约卡另给简介折叠展开）；`src/worker/routes/clubs.ts` 的 `namingContractDto` / `offerDto` 平铺 `brandProfile`。品牌池列表的档案 / 招商性格区**默认收起**（每行一个「档案」按钮展开、再点「收起」；池子 28 家时全展开会把表格拉得很长），展开态只存该行。

**交付（招商性格与对赌抽签引擎，迁移 `0075_brand_style.sql`）**：`brand_pool` 新增 `style`（稳健 / 进取 / 对赌，空 = 按档位回退）与 `prefer`（1–3 个偏好标签，逗号分隔），`naming_contracts` 新增 `bet_terms`（条款快照 JSON；空 = 老合同走旧绝对线）；28 家配种，其中 **7 家 `style='对赌'`**（维斯兰科技 / 洛森餐饮 / 塞拉越野 / 泰拉蒙汽车 / 洛朗烘焙坊 / 霜降茶业 / 比特兰科技）。`src/worker/market-ops.ts` 新导出 `packageNoForBrand(tier, style)`（稳健→1 / 进取→2 / 对赌→3，空回 `packageNoForTier`）：招商轮（`buildRoundStatements`）与事件上门（`spawnVisitOffer`）都按性格递套餐；招商轮排序键改 `(prefer 命中数 desc, 底价 desc)` ⇒ 品牌偏好的队伍优先收到报价（`loadClubSignals` 从死忠 / 容量 / 上赛季上座率前 25% 与上赛季冠军算出每队命中标签）；情绪演化 `evolveSatisfactionForClub` 并入偏好加成（每条命中 +0.02、封顶 +0.04；配置键 `market_satisfy_config` 增 `preferBonus` / `preferBonusCap`）。**对赌条款引擎**（`src/worker/naming-ops.ts`）：签约 / 接班转正 / 续约三处按 `buildBetTerms(db, clubId, brand, season, windowSeq)` 生成快照 —— 6 条窗级指标（上座率 / 满座场次 / 死忠增长 / 积分 / 进球 / 零封）先按适用性进池，再用品牌 `prefer` 标签加权轮盘抽两条（第二条排除同相关族），队伍强度三分位定目标概率 p（强 0.34 / 中 0.42 / 弱 0.50）反解阈值（样本场次 `n` 取**近 3 窗同尺度场次均值** `expectedWindowScale`：`attend` / `sellout` 用主场尺度、`points` / `goals` / `cleansheet` 用全窗尺度 ⇒ **反解尺度 = 结算尺度**），再用近 3 窗历史回测纠偏（命中率出 [0.30,0.55] 则 p 反向调 ±0.06、最多两档、钳 [0.28,0.58]），结果写 `bet_terms` v2 快照（`seed` / `p` / `strength` / `backtest` / `dropped` / `items[].guard`）。随机源沿用仓内 `seededUnit`，seed = `(season, windowSeq, clubId, 品牌哈希)` ⇒ **同签名结果恒定（关窗批重跑逐字一致、测试可复现）**，多样性靠换季换窗重抽。**四层硬护栏**：G1 阈值上下限（唯一实现点 `betGuardBounds`；触界即**剔除重抽**、绝不钳低）、G1c 兜底链（可行池 ≥2 抽 2 条 = 单窗上限 1.20×底价 / =1 抽 1 条 = 0.95× / =0 取「触界最轻」一条钳到上限记 `guard='ceil'` / 无基线且本窗无主场走池默认基线记 `guard='pool_default'` / 结算侧无条款或无主场 ⇒ 零奖金不倒扣记 `no_data`）、G2 单窗支出 ∈ [0.70, 1.20]×底价（每项奖金 = 底价 × `min(0.25, 1 / windows_total)`，费率 0.70；不达线不倒扣）、G3 合同期累计奖金 ≤ 2.0×底价且累计支出 ≤ 4.80×底价、G4 无主场场次的窗 `attend` 判不达（不沿用旧的「无主场缺省 1」；计数型天然不达）、G5 快照与结算审计留 `dropped` / `guard` / `no_data`。**结算双路**（`windowNamingStatements`）：`bet_terms` 非空 ⇒ 逐条评估、每条各发一笔 `naming_bonus`（memo「{品牌} 对赌奖金（{指标} 达线：实 X / 线 Y）」）；空 / v1 旧格式 / 坏 JSON ⇒ 走旧 `bet_attend` / `bet_fans` 逻辑（老合同零改动、不抛错）。前端：品牌池页可编辑性格（下拉）与偏好标签（4 个标签勾选，≤3），对赌合同卡展示实际两条指标与每窗进度。
**测试**：`tests/forced-auction.test.ts` 首例改写为「人选不限」（第七 / 门将 / 前六 / 豪门第七 / 缺 CA 五个人选各自 201 + 参考值断言）+ 两个新用例（预检形状 / 404 / 401 / 关窗 `no_window` 与建单同句 / 预检不写库；CPU 与在流程里的同一句 400）+ 第三例「挂牌价可指定」（缺省 1m、指定 5m 落库并抬高首价门槛（4 被拒、5 通过）、`3.456 → 3.46`、6m 窗尾无人出价下架费 0.6m、非正数与非数字 400 且不落库），该文件共 9 例；品牌池敏感断言同步为 16 家口径（`tests/naming-ops.test.ts` 种子名单与计数、`tests/market-rounds.test.ts` offerCount 7→16 与 12→30、TC-OFFER-10 计数、`CVS Health` → `西维斯健康` 26 处）；`scripts/e2e/smoke.mjs` 加 ㉓。文档：`PRD.md` 规则行、`TECH_DESIGN.md` 规则行与端点行、`docs/test-plans/v6.51.0-forced-auction-and-brand-pool.md`、`memory/plan-v6.51.0-forced-auction-and-brand-pool.md`。

**测试（品牌池三批）**：新增 `tests/naming-bet-terms.test.ts` **22 例**（阈值反解与 `z_p` 表 / 池默认基线 / G1 上下限逐条与 `prefer` 权重表逐字段 / 抽签池装配与 G1c 兜底链（含合成状态锁 `guard='ceil'`、同族池只抽 1 条、`B ≥ 0.85` 时 `attend` 不进池）/ 端到端确定性（同签名逐字一致 + `seed = (season, windowSeq, clubId, 品牌哈希)`）与 `prefer` 权重偏向（固定样本 60+60 次统计）/ 结算双路与 G2（≤1.20×、≥0.70×底价）、G3（4 窗 ≤2.0×与 ≤4.80×底价）、G4（`homePlayed=0` 判不达记 `no_data`）、v2 空条款不回退旧线）+ 新增 `tests/naming-brand-profile.test.ts` **11 例**（`packageNoForBrand` 映表与上门递价 `package_no=3`、招商轮 `prefer` 命中优先入选、管理端档案与性格校验（`color` / `origin` / `style` / `prefer` 非法 400、长度卡线 201、PATCH 只覆盖给到的字段且审计 before/after 全字段）、落点名写入与读侧（签约 `venue_name='奥维恩·老特拉福德'`、`/api/me/club` 的 `namingVenueName`、老合同现拼、解约后 `null`、报价卡预告）、`prefer` 加成 0.02 / 封顶 0.04）+ 新增 `tests/naming-bet-scale.test.ts` **8 例**（`expectedWindowScale` 尺度来源回归锁（含「不读休眠列 `season_windows.tournament_id`」的集成锁）/ 反解尺度 = 结算尺度的反向锁与蒙特卡洛达线率带（|经验 − 解析| < 0.04）/ 签约→结算闭环（基线窗只扣费不发奖金、上峰窗两条各 0.4）/ G3 对任意 `windows_total` 成立）。改名与计数同步：`tests/naming-ops.test.ts`（28 家名单与计数）、`tests/market-rounds.test.ts`（offerCount 16→28 等五处 + 头部/新兴品牌改按性格递套餐）、`tests/event-ops.test.ts`（8 处）、`tests/naming-tiers.test.ts`、`tests/fixtures.test.ts` 与 `tests/weather-forecast.test.ts`（`venueName: ''`）、`scripts/e2e/smoke.mjs` ㉓（28 家虚构名 / 无 13 个真实名残留 / 「中资」恰 6 家 / `style='对赌'` 恰 7 家）。**本批实测发现（如实登记）**：① `guard='ceil'` 分支（可行池 = 0）在当前参数下生产不可达 —— `fans` 恒可入池（池默认基线 0.03、σ 兜底 0.02、`z ∈ [−0.202, 0.583]` ⇒ 线 ∈ [0.026, 0.042] ⊂ G1 的 [0.01, 0.05]），故该分支仅由合成状态用例锁定；② `z ≤ 0`（p ≥ 0.5，弱队）时 `attend` 线 = 基线 B < G1 下限 B+0.01 ⇒ 必然触界剔除（护栏优先级高于「弱队更易达线」的取向）；③ 仓内无死忠历史表 ⇒ `fans` 恒走池默认基线（数据可得性硬限制）；④ 计数型反解实现取「最大的 T 使 P(X ≥ T) ≥ p」（即 (1−p) 分位），与设计文字「取最小整数 T」字面不符、按经济意图（单条达线概率 ≈ p）落地并在代码注释说明。新增 `web/src/pages/admin/BrandsPage.test.tsx` **3 例**（桌面表格进页面全收起 / 只展开点中的那一行、再点回收起且邻居不受影响 / 窄屏卡片流同样默认收起可展开）。文档同步：`ROADMAP.md` 本节、`AGENTS.md` 当前状态、测试计划 `docs/test-plans/v6.51.0-brand-pool-fictionalize-profile-style.md`；设计与交付记录 `memory/design-brand-pool-structure.md`、`memory/plan-brand-fictionalize-pool.md`、`memory/plan-brand-profile-and-style.md`、`memory/plan-v6.51.0-brand-venue-naming.md`。

## [v6.50.0] · 海捞两阶段（暗标段密封标 + 明标段原样）：窗口批次制 + 统一开标 + 管理端开标口（2026-10-15）

**已上线 2026-10-15**（Version `c1f7e6a6-0f69-4d79-b9dc-9b04b3cf66af`，push `0157d87`；迁移 `0070` 已 apply 生产，回读通过；生产 config 无 `sea_enabled` 键 ⇒ 关闭态）。本地闸门全绿：`npm run typecheck` 三份 0 error；`npx vitest run` **131 文件 / 2147 例**全绿；`npm run build` 成功。**上线顺序硬约束 = 迁移 `0070` 先 apply 生产 → push → 部署 → 回读**（新代码要读 `sea_batches` / `sea_sealed_bids`，并给 `transfers` 加 `sealed_bid_id`）。**上线后仍保持关闭**：`sea_enabled` 默认 `false` ⇒ 线上行为与上线前逐字一致；确认无误后再单独一步改 `true` 才真正开暗标段（同一步不做，回滚位保持）。

**缘起**：用户 m11201「头脑风暴探索转会各类型定时关闭，以及海捞分为暗标阶段和明标阶段」⇒ 经组织方式探索后由用户裁决**窗口批次制**（一窗两段：开窗时自由身池整体进暗标批次、统一截止开标；之后进明标段 = 现有海捞流程原样）。设计定稿 12 条口径与落地偏差见 `memory/design-sea-two-phase.md`。

**交付（数据层，迁移 `0070_sea_sealed.sql`）**：`sea_batches(id, season, window_seq, status sealed|settling|opened|cancelled, sealed_at, deadline_at, reminded_at, opened_at, opened_by, note, created_at)` + UNIQUE `(season, window_seq)`；`sea_sealed_bids(id, batch_id, player_id, club_id, new_release_fee, hold_id, status sealed|won|lost|void|withdrawn, submitted_at, updated_at, resolved_at, void_reason)` + UNIQUE `(batch_id, player_id, club_id)` + 两组查询索引；`fund_holds` 插入守卫触发器 `fund_holds_sea_sealed_guard`（`WHL_SEA_REJECT_CLOSED` / `_AMOUNT` / `_FUNDS`，与 0005/0037 同形）；`transfers.sealed_bid_id` 列 + 部分唯一索引 `idx_transfers_sealed_bid` + `transfers_sea_sealed_release` 终态触发器（单据 `rejected`/`completed` 时释放或结算冻结）。`tests/d1.ts` MIGRATION_FILES 追加（数组顺序 = 应用顺序）。

**交付（服务层，`src/worker/sea-sealed.ts` 新建）**：阶段判定 `loadSeaPhase`（`sea_enabled=false` 时不生效）+ 批次惰性创建 `ensureSeaBatch`（时刻表 `transfer_sea_sealed` 行进段**且终点是具体时间**才建批——随窗锚拿不到统一截止，不开批次）+ 出标/改标/撤回（**单批原子**：改标 = 改价 + 释放旧冻结 + 插新冻结同一批）+ 开标 `openSeaBatch`（按球员分组取最高价、同额取最早 → **重跑资格链** `checkSeaSignEligible`（用批次自己的 season/window_seq 当窗口引用，关窗开标时没有开放窗口）→ 胜出者建 `free_agent/pending_review` 单 + `review_task` 复用现有审核链、其余解冻 + 通知 → 批次 `opened` + 审计 `sea_batch_open`；幂等靠批次 `sealed → settling` 的 claim UPDATE）+ `openSealedBatchOnWindowClose` / `expireDueSeaBatches` / `remindDueSeaBatches` + 管理端 `openNow` / `extendSeaBatch` / `cancelCurrentBatch`。

**交付（引擎与触发点）**：`src/worker/expiry-ops.ts` 注册第三适配器 `sea_sealed`（`opsKey: 'transfer_sea_sealed'`：到点开标 / 提前 **24h** 提醒，`reminded_at` 抢占）；`closeWindow` 末段钩子「关窗时批次仍 sealed ⇒ 立即开标」（best-effort，不阻塞关窗）；`sea_enabled=false` 时 tick 把还 sealed 的批次**整批作废 + 解冻**（回滚不留悬挂冻结）。通知 4 模板：`sea_sealed_lead` / `sea_sealed_lost` / `sea_batch_open` / `sea_sealed_deadline`（类目统一 `window`——海捞单不是 offer 实体，`notificationRefOf` 返回 null）。config 加 `sea_enabled`（默认 `false`）、`sea_sealed_hours`（默认 `72`，仅管理端表单默认值，实际以时刻表具体时间为准）。

**交付（教练侧）**：`GET|POST /api/transfers/sea-sealed` + `POST /api/transfers/sea-sealed/withdraw`（轻读守卫：受罚俱乐部也看得见倒计时与公示）；海捞页阶段横幅（收标中倒计时 / 已截止 / 已开标 + 「我的出标（只有自己看得见）」+ 开标公示）；球员档案 E 态在收标期内把「海捞签入」换成密封标表单（出标/改标/撤回 + 冻结提示 + 倒计时），明标段维持原按钮；常规海捞入口在收标期被 409 `sea_sealed_phase` 硬拦。

**交付（管理端）**：`GET|POST /api/admin/sea-sealed`（`open` / `extend` / `cancel`，与窗口开关同级 `requireAdmin`）+ 转会页「海捞暗标段」段：批次摘要 + 逐标明账（金额与出标方在管理端可见）+ 立即开标（两段式确认）/ 延长（批次与时刻表终点**同改**）/ 取消（全部作废 + 解冻，说明会发给出标方）。

**验收**：新增 `tests/sea-sealed.test.ts` **25 例**（阶段与惰性建批 / 密封标与冻结守恒 / 开标重跑资格链与幂等 / 关窗立即开标与到点 tick / 提醒 / `sea_enabled=false` 整批作废 / 明标衔接与迁移守卫 / 审核结算链 / 管理端明账与延长取消）；`tests/mobile-baseline.test.ts` **+3** 静态锁（TC-SEA-01/02/03）；注册表计数四处同改（`CONFIG_KEYS` 83→85；通知模板 33→37 及类目表 `window` 扩员）。

**评审踩坑（八处）**：① 出标改标必须**单批原子**——触发器按「标上的价 × 30%」校验冻结额，分两批会留下「价已改、冻结没换」的中间态，新标路径失败还会留孤儿标行；② `chargeBypassFee` 里销毁密封冻结的语句必须放在 `extra_fee` 更新**之前**，否则 `statements[last]` 不再指 `extra_fee`、幂等判断失效；③ 新标用 `INSERT … last_insert_rowid()` 同批取 `bidId`（与 `createBypassTransfer` 建 `review_task` 同手法）；④ 触发器裸错经 `mapSealedTriggerError` 映射成人话（`WHL_SEA_REJECT_FUNDS` → 400「出标即冻结，冻结没过账这标就不算数」等）；⑤ 作废原因取 `checkSeaSignEligible` 的 `verdict.reason`（被挂牌时说「当前状态不能海捞」，不是内部代号）；⑥ `cancelCurrentBatch` 把管理组写的说明**兼作**标作废原因发给出标方；⑦ `readJson` 返回 `unknown`，body 取参要先 `as Record<string, unknown> | null`；⑧ 暗标通知类目选 `window` 而非 `offer`——`offer` 类目会强制取 `data.offerId`，而海捞单不是 offer 实体。

**文档同步**：`docs/test-plans/v6.50.0-sea-sealed.md`；`memory/design-sea-two-phase.md`（口径 12 条 + 落地偏差 8 条）、`memory/plan-v6.50.0-sea-sealed.md`。

**待办**：明标段起点需与暗标终点对齐（时刻表 `transfer_sea_open` 行填同一具体时间，管理端表单已提示）；上线后单独一步开 `sea_enabled`；其余见 [ROADMAP.md](./ROADMAP.md)。

## [v6.49.0] · 运营时刻表（11 键双锚）+ 统一到期引擎（报价回合 48h / 谈判静默 72h）+ 管理端只读甘特图 + 教练侧置灰读秒（2026-10-14）

**已上线 2026-10-15**（Version `c1f7e6a6-0f69-4d79-b9dc-9b04b3cf66af`，push `0157d87`；迁移 `0069` 已 apply 生产，回读通过）。本地闸门全绿：`npm run typecheck` 三份 0 error；`npx vitest run` **130 文件 / 2119 例**全绿；`npm run build` 成功。**上线顺序硬约束 = 迁移 `0069` 先 apply 生产 → push → 部署 → 回读**（新代码要读 `ops_schedule` 表）。版本号顺延 **v6.49.0**（v6.48.0 被并行会话 growth-tier 占用；迁移号同理从 `0069` 起，避开其 `0068`）。

**缘起**：用户 m11201「头脑风暴探索转会各类型定时关闭」+ m11287「每一种转会操作和消费中心整体都要可以设置开始时间结束时间」⇒ 从「各类型定时关闭」升级为**统一运营时刻表**：10 项转会操作 + 消费中心整体各自可设开始/结束时间；随附用户 m11307 的三种随窗形态（随开窗起 / 随关窗止 / 随开窗起随关窗止）与 m11312「锚点不要 offset 要具体时间」。

**交付（数据层，迁移 `0069_ops_schedule_expiry.sql`）**：`ops_schedule(op_key PK, start_anchor, start_at, end_anchor, end_at, requires_window, close_inflight, note, updated_by, updated_at)` + **11 行种子全为 `none/none`（不限制）** ⇒ 上线即与上线前行为逐字一致；`offers.expiry_anchor_at/reminded_at` + `negotiation_sessions.expiry_anchor_at/reminded_at` + 两索引。`tests/d1.ts` MIGRATION_FILES 追加（数组顺序 = 应用顺序）。

**交付（规则层，`src/core/ops-schedule.ts` 新建 = 零 import 纯函数）**：`OPS_KEYS` 11 键（10 转会 + `consumption`；仅 `transfer_offer`/`transfer_negotiation` 为 `requiresWindow:false`）、`resolveOpsRow`（五态 `unrestricted/not_started/open/closed`，随窗两锚解析窗口 `openedAt/closedAt`）、`opsStateLabel`、`fmtBeijingMinute`、`validateOpsInput`（六条文案）、`OPS_PRESETS`（A/B/C/none 一键预设）。

**交付（引擎层，`src/worker/ops-schedule.ts` + `src/worker/expiry-ops.ts` 新建）**：`loadOpsRows`（60s 缓存）/`loadWindowRef`/`assertOpOpen`（409 `op_not_started` / `op_closed`，文案含北京时间）/`opsScheduleView`/`saveOpsRow`（审计 `ops_schedule_set`，`guardSql='changes() > 0'`）；`runExpiryTick(env, origin)` 挂 **`runSettleTick` 第 5 步**（独立 try/catch；返回体加 `expiry`；`tickChanged` 追加判据），`EXPIRY_LIMIT=50`、提前 **24h** 提醒（`reminded_at` 抢占）。

**交付（两适配器）**：① 报价回合时限（锚 `MAX(o.expiry_anchor_at, o.updated_at)`）——`expireDueOffers`/`remindDueOffers`，到期 `finalizeOffer` + `offer_events(kind='expire')` + 解冻 + 通知 `offer_expired`（reason `deadline`）/ 提前 `offer_deadline`；② 签约谈判静默超时（锚 `MAX(expiry_anchor_at, created_at, MAX(attempts.created_at))`）——`closeSilentSessions`/`remindSilentSessions`，到期七语句收口 `voidSigningCore`（自 `market-intervene.ts` 抽出复用，`playerRestoreSql` 一并迁入 `negotiations.ts`）+ 通知 `negotiation_timeout`/`negotiation_deadline`。**存量宽限**：首次扫描把存量 pending 行的锚回填为 `now + N 小时`（不按历史锚实时算），避免首 tick 批量误杀；`close_inflight` 默认 `0`，关窗时按行决定是否收口在途单。

**交付（闸门 15 处）**：`assertOpOpen` 接入挂牌/出价（`routes/market.ts` 两处）、海捞/解约/续约/强制拍卖（`bypass.ts` 四处）、激活（`market-ops.ts` acceptOffer）、设施扩建/升级/改建（`stadium-ops.ts` 三处）、档期（`venue-ops.ts` bookSlot）、冠名两处（`naming-ops.ts`）、消费工单（`routes/shop.ts`）、报价四处（发起/还价/接受/意向确认）、谈判三处（提交违约金/报工资/选青训）。**收口类动作（拒绝/撤回/过期）不接闸——钱不能被时段卡住**；读路径不接。

**交付（端点与管理端）**：`GET /api/ops-schedule`（公开，教练侧取闸门真源）+ `GET|PUT /api/admin/ops-schedule`（PUT body `{key,startAnchor,startAt,endAnchor,endAt,requiresWindow,closeInflight,note}`）。管理端新页 `/admin/schedule`（侧栏「转会与经营」组内「时刻表」）：逐项时段表单（预设钮 + 双锚 select + `datetime-local` + 两个复选框）+ **只读甘特图**（手绘 SVG，时间轴 + 11 行区间条 + 窗口背景带 + 当前时刻线 + 悬停 `<title>` 全量信息 + 点行跳到该行表单；随窗止画虚线箭头标「关窗即止」，`none` 行画满宽斜纹灰带「不限制」）。

**交付（教练侧置灰读秒）**：`web/src/lib/ops-gate.ts`（模块级单例 + `useSyncExternalStore`，60s TTL，取不到就按未加载不禁用）+ `web/src/components/OpsGateNote.tsx`（复用 `useCountdown`/`fmtClock`）+ `web/src/lib/datetime.ts` 新增 `zhWallToUtcIso`/`utcIsoToZhWall`/`zoneOffsetMs`（固定 +08:00，回程校验拒绝 `2026-02-30`/13 月/24:00）+ 9 个写入口接线（球员页左栏挂牌/海捞/报价、市场竞价表单、广告板报价、激活页、谈判两步、消费中心五卡 + 球场三卡）。

**验收**：typecheck 三份 0 error；vitest **130 文件 / 2119 例**全绿（新增 `tests/ops-schedule.test.ts` 16 + `tests/expiry-ops.test.ts` 15 + `web/src/lib/gantt.test.ts` 23 + `web/src/lib/ops-gate.test.ts` 9；`datetime.test.tsx` +6、`mobile-baseline.test.ts` +3 静态锁、`notify-meta` 锁 30→33 模板）；`npm run build` 成功（`SchedulePage-*.js` 独立懒加载块）。

**评审·踩坑（六处，都是闸门抓到的）**：① `resolveOpsRow` 的 `unrestricted` 按解析时间判会把「随窗锚 + 当前无窗」误判成不限制 ⇒ 改按**锚型**判；② `runExpiryTick` 的关窗收口多带一个 `resolved.endAt !== null` 条件，会让「随关窗止 + 勾了收口」失效 ⇒ 删除；③ `alignFloor` 的 `offsetMs` 符号写反（北京日刻度画在 08:00）⇒ 修为 `Math.floor((ms+offsetMs)/step) * step - offsetMs`；④ `useOpsGate` 插在组件早退之后 ⇒ `Rendered more hooks than during the previous render`（`FacilityOpsCard`/`MarketActivationPage`）⇒ 提到组件顶部并加静态锁；⑤ 往 `.table-wrap` 内插提示条会撞 `mobile-baseline` 的 `<table>` 紧邻行锁 ⇒ 提示条挪到 `table-wrap` 之前；⑥ `tsconfig.tests.json` 下 `readFileSync(new URL(...))` 类型不兼容 ⇒ 测试读文件一律相对路径。

**文档同步**：`docs/test-plans/v6.49.0-ops-schedule.md`（七段：范围与风险 / 自动化用例 / 变异验证 / 回归闸门 / 本地验证 / 生产写批 / 未验证项）；设计稿与计划 `memory/design-ops-schedule-expiry.md`、`memory/plan-v6.49.0-ops-schedule.md`。

**待办（上线后）**：① 按需把 11 行从 `none` 改成真实时段（管理端操作，逐行即时生效）；② 若生产 pending 报价/谈判多于 50，存量宽限需多个 tick 回填（只写锚不动作）；③ 甘特图真机窄屏观感目视。

## [v6.48.0] · 成长档位自动核定：五条件规则层（SQL 真源 + TS 镜像）+ 重算引擎 + 九个触发点全挂钩 + 管理端「成长档位」页 + 队壳国家必填（2026-10-14）

**已上线 2026-10-15**（Version `c1f7e6a6-0f69-4d79-b9dc-9b04b3cf66af`，push `0157d87`；迁移 `0068` 已 apply 生产、回读通过；**首次回填仍待管理端操作**）。本地闸门全绿：`npm run typecheck` 三份 0 error；`npx vitest run` **129 文件 / 2105 例**全绿；`npm run build` 成功；**变异 8 处全命中**。上线动作顺序：迁移 **0068** apply（生产，含 20 行队壳国家初始值）→ push → 部署 → 回读 → **首次回填**（管理端「成长档位」页：一键重算 → 预览 → 确认 → 回读分布 + 抽查口径）。判级 minor——新增两列（`clubs.country`、`players.growth_tier_locked`）、新增管理端六个端点与一个管理页、公开球员页响应加 `tierBasis`；无破坏性契约变更。

**缘起**：用户 m08652「检查一下成长档位计算是否正确」。排查结论：生产 18,301 名球员**全员 1 档**、`growth_tier` 在审计里零记录，而按 §10.3 的叠加口径应有约 1,768 人 >1 档——平台**从来没有自动计算过**，档位只是管理端「档位核定」的手工输入（且建队/导入链都不写它）。设计逐节批准（m08987/m08993「没问题」）后开工（m09029）。用户硬约束四条：**建档必填国家**、**rekey 换壳必须 `--new-country`**、**编辑入口兜底补录**、**机器通道留空即标「未设国家」**；口径两条：**自动核定 + 人工覆盖**（锁定后可解除）、**回落按当前状态可升可降**。

**交付（数据层）**：迁移 `0068_growth_tier_auto.sql`——`ALTER TABLE clubs ADD COLUMN country INTEGER`（可空，FC NationID 空间）+ `ALTER TABLE players ADD COLUMN growth_tier_locked INTEGER NOT NULL DEFAULT 0`；随后 6 条 `UPDATE clubs SET country = ?`（均带 `country IS NULL` 守卫）写入 **20 行生产队壳**的初始国家（英格兰 14 × 8 队 / 德国 21 × 3 / 意大利 27 × 3 / 法国 18 × 2 / 西班牙 45 × 3 / 希腊 22 × 1），并带期望 changes 与回滚语句。`src/core/nations.ts` 新建（`web/assets/ref/nation.json` 218 条 FC NationID 的 Worker 侧镜像 + `nationName(id)` 宽容查询），一致性由 `tests/nations.test.ts` 逐条断言（含港澳台 158/172/213 三个独立编号钉死）。

**交付（规则层，`src/core/growth-tier.ts` 新建 = 唯一真源）**：`GROWTH_TIER_MIN/MAX`、`GrowthTierConditionKey`、`GROWTH_TIER_CONDITIONS`（键序 c1..c5，分值 1/1/1/2/1，带 label/hint 供两端共用）、`TIER_CONDITION_SQL`、`GROWTH_TIER_SQL = MIN(1 + c1 + c2 + c3 + 2·c4 + c5, 5)`、`GROWTH_TIER_SELECT`/`GROWTH_TIER_MISSING_SELECT`（明细一次取全：当前档/锁定/队壳国家/五条件/自动档/两条缺失标记）、TS 镜像 `evaluateGrowthTier(input)`（`hits` + `missing`）、`gameAttrInt`、`tierConditionDetails`（命中/数据缺失/未命中三态）。口径：c1 = `game_attrs.TeamID = club_id`（现实效力按来源球队）、c2 = `game_attrs.naID = clubs.country`、c3 = `china_plan = 1`（只认 naID 155）、c4 = `is_future_star = 1`、c5 = `age <= 18`；**缺数据不猜**——`club_id`/`TeamID`/`naID`/`clubs.country` 缺任一，条件记假并标「数据缺失」。设计期预演（生产数据）：档 1 16,533 / 2 1,612 / 3 113 / 4 27 / 5 16 ⇒ **1,768 升、0 降**。

**交付（重算引擎，`src/worker/growth-tier.ts` 新建）**：三种 scope（`players` 单批 id / `fcIds` 导入收尾 / `clubs` 某队 / `all` 全量）；**只写差异行**（`growth_tier <> 自动值`），**锁定行一律跳过**并单列计数；每条 UPDATE 带 `(id, 旧档, 未锁定)` 守卫，审计以 `changes() > 0` 为闸；每批 100 条（每条 = UPDATE + 审计两语句）、`IN (...)` 绑定参数按 90 分片（D1 上限 100）；keyset 分页取变更行（`p.id > afterId`），明细上限 200（`truncated` 如实回报）；`recomputeGrowthTiers`（预览 `apply:false` 不写库 / 执行后另写一条批次汇总审计）、`hookTierRecompute`（触发点轻量挂钩：不跑计数聚合）、`clubsWithoutCountry`（未设国家的队 + 队内人数）。审计：`growth_tier_set`（人工与自动共用，`after.auto` 区分，自动行带 `conditions` 快照）、`growth_tier_recompute`（scope/升降/锁定/批次数）、`growth_tier_unlock`、`club_country_set`（targetType `club`）。

**交付（触发点九项全挂钩）**：① 球员导入收尾（`players-import.ts` confirmImport 末尾，fcIds 范围）；② 合同导入认领（`contracts-import.ts` 每 chunk 认领 UPDATE 之后）；③ 转会过户 / ④ 解约去归属（`transfers.ts` completeTransfer / completeTermination 的 batch 之后，`statusChange > 0` 才跑，续约/匹配 amendment 不动归属故跳过）；⑤ 管理端改队壳国家（`routes/admin/clubs.ts` 新增 `POST /clubs/:id/country`：写库 + 审计 + 该队重算，返回升降计数）；⑥ 管理端改未来之星（`routes/admin/players.ts` 的 PATCH 与 batch，批量按 id 集合重算）；⑦ 单人核定 / ⑧ 批量改档（写值 + **置锁**，不重算）；⑨ 解除锁定（清标记 → 立即重算 → 读回实际档位）。不挂钩：赛季结算、窗口机器（不写归属/国家/未来之星）。**建档必填**：`POST /clubs` 走 `parseCountry`（无效即 400「必须选择队壳国家（FC 国家编号，如 14 = 英格兰）」），`createClubFromTourTeam` 参数加 `country?`——机器通道（`routes/internal.ts`）与批量同步（`teamSync.ts`）留空不猜，落 `NULL` 并进「未设国家的队」提示；`GET /clubs` 下发 `country`/`countryName`。

**交付（端点与管理端）**：`src/worker/routes/admin/growth-tier.ts` 新建（6 端点：`GET|POST /growth/tier-recompute`（预览 / 执行，可带 `clubId`）、`GET /growth/tier-changes`（读 `audit_log` 的 `growth_tier%`，before/after 解析后下发）、`GET /growth/tier-clubs-without-country`、`GET|POST /growth/:playerId/tier`（明细 / 人工核定=写值+置锁）、`POST /growth/:playerId/tier/unlock`），`routes/admin/growth.ts` 里旧的单人核定端点整段移出（路径不变，原位留注释指路）；`routes/admin/index.ts` 挂载。公开 `GET /players/:id/growth` 加 `player.tierBasis`（自动值 / 锁定态 / 队壳国家 / 五条件三态）。前端：`web/src/pages/admin/TierPage.tsx` 新建（一键重算计数条 + 条件说明 + 明细前 200 行 + 未设国家的队 + 变更清单）、路由 `/admin/tier` + 侧栏「成长档位」、`ClubsPage` 建档必填国家 + 列表「队壳国家」列与改国家入口、`PlayersPage` 核定区改「自动核定，人工可覆盖」（依据明细 + 解除锁定）、`Player.tsx` 档位徽章旁新增 `TierBasisLine`（五条件短标签 + 人工/自动标记 + 队壳国家）、`lib/tier.ts`（条件短标签两端共用）、`styles.css` 新增 `.tier-chips`/`.tier-basis`/`.up-mark`/`.down-mark`。

**交付（rekey 工件）**：`scripts/rekey-team/rekey-team.mjs` v2.4.0——换壳模式**必填** `--new-country`（无合法国家即 exit 1，收口模式带该参数只提示忽略）；换壳前读旧 `clubs.country` 进报告（读不到时提示「迁移 0068 是否已应用」）；03 工件在 `clubs.id` 搬迁**之后**追加 `UPDATE clubs SET country = <N> WHERE id = <NEW>`（写在父行搬迁之前会对不上任何行、静默空转），回滚注释填回旧值；README/工件检查清单加「换壳后到管理端档位页补一次重算」（手写 SQL 绕过管理端入口 ⇒ 自动挂钩不触发）。

**测试**：新增 `tests/growth-tier.test.ts`（12 例：SQL 真源与 TS 镜像在同一组 12 条 fixture 上逐条对齐 + 边界 + 坏 JSON + `gameAttrInt`）、`tests/growth-tier-recompute.test.ts`（12 例：预览不写库 / 只写差异 / 锁定跳过 / 并发改过不盲写 / 分片与截断 / 审计口径）、`tests/growth-tier-routes.test.ts`（22 例：建档必填、改国家、六个端点、公开页依据、四个触发点直调、**源码扫描**锁「写 `players.club_id` 的文件必须调 `hookTierRecompute`」）、`tests/nations.test.ts`（4 例）；既有测试随契约更新（`admin-clubs-create`/`team-sync`/`routes`/`tier`/`market-routes`/`window-machine`/`activation*`/`bypass-routes`/`club-visibility`/`ledger`/`negotiation-routes`/`forced-auction` 的建队夹具补 `country`，`CpuConvertPage.test.tsx` 夹具补两字段，`AdminLayout.test.tsx` 12 → 14 项）。e2e `scripts/e2e/smoke.mjs` 新增 **㉒**（档位预览形状 + 建档缺国家 400 + 球员页 `tierBasis` + 改国家→重算→变更清单回读，旧值可读时自动写回）。**变异 8 处全命中**：去 MIN 上限截断 / 18 岁边界 `<18` / 锁定取反 / country NULL 不再记缺失 / 审计丢 conditions / 转会过户不挂钩 / 建档不校验国家 / 人工核定不置锁。

**评审·踩坑（两处真实缺陷，都是测试闸门抓到的）**：① **坏 JSON 兜底写法**——`json_valid(x) AND json_extract(x, …)` 在 SELECT 投影里**会抛 `malformed JSON`**（AND 两侧不保证短路，优化器先求 `json_extract`），必须 `CASE WHEN json_valid(x) THEN … END`；且比较结果要套 `COALESCE(…, 0)`，否则 NULL 会顺着 `1 + (c1) + …` 把整条档位表达式污染成 NULL（`MIN(NULL, 5) = NULL`）。② **审计守卫不能复用「旧档」谓词**——UPDATE 先执行、旧档在审计求值时已经变了，写出来的审计**恒为空**（发现时「写差异 + 每条审计」用例拿到空数组）；改用 `changes() > 0`（`ledgerMovement` 的既有形态）。夹具教训三条：`players` 上有 `idx_players_sort_ps` 这类**表达式索引**，往真表写坏 JSON 在 INSERT 那一刻就抛错（坏数据只可能来自历史路径 ⇒ 规则层测试改用裸表验表达式）；导入链**只给 4 支 CPU 队**写队籍（`clubIdForTeam`），导入挂钩用例的 `TeamID` 必须是 CPU 队号；`/api/admin/players/batch` 收 `items: [{id, …}]`（字段平铺，不是 `{updates:{…}}`）。并发工作流：另一会话的 v6.49.0「时刻表」与本版同时改 `AdminLayout.tsx`（侧栏 12 → 14 项）与 `web/src/App.tsx`，闸门判读时要排除对方未完成的 `SchedulePage.tsx` / `ops-schedule.test.ts` 报错。

**文档同步**：TECH_DESIGN §4（数据边界表加「队壳国家」行）、§5.1（`clubs.country` 与 `players.growth_tier_locked` 注释）、**§10.3 整节重写**（条件表 + 数据 + 引擎 + 触发点表 + 端点 + 审计 + 管理端 + 首次回填 + 两处实现教训）；ROADMAP 本节；测试计划 `docs/test-plans/v6.48.0-growth-tier-auto.md`；AGENTS.md 状态；设计/计划稿 `memory/design-growth-tier-auto.md`、`memory/plan-v6.48.0-growth-tier-auto.md`。

**待办（上线后）**：① 首次回填并回读分布（预期 1,768 升 / 0 降；抽查哈兰德 club 14 ≠ TeamID 10 ⇒ 档 1、贝林厄姆 club 2、naID 14 = 阿斯顿维拉 country 14 ⇒ 档 2）；② `config.tier_conditions` 是**死配置**（注册了键但全仓无读取者），确认后清理或标注；③ 年龄滚动（c5 目前按导入时的 `age` 静态判定）留待后续版本。

## [v6.47.0] · 经济革命 T0 发版批 0：忠诚奖金改「忠诚支出」（扣款）+ 取消穷鬼线（`wage_floor_gap` 默认 0）+ 效力支出费率排程 + 开放 2 档并下调 1 档基础维护费（2026-10-13）

**已上线**（2026-10-13T15:53:55Z，Version `534aafdb-2192-41c7-99f6-cb725cf86996`；push `460f590..892e861`；自定义域名回读通过：入口 bundle 含 `6.47.0` 与「忠诚支出」标签、无「忠诚奖金」残留）。零迁移、零 DDL；判级 minor——① 忠诚从「发钱」改为「扣钱」（账本方向反转）② 新增 config 白名单键 `wage_floor_gap`（默认 `0` ⇒ 取消穷鬼线）③ `loyalty_tiers` 默认排程加收官档 ④ `tier_table[1].base_maintenance` 5.0 → 3.5。⚠️ 本版与两批生产写批**成对执行**：**先发版、后落库**（顺序颠倒 ⇒ S9 中期窗在旧代码下把 −591.65 反向发成 +591.65，一进一出差 **1183.30**）；实际执行顺序 = push 15:53 → 批 B 15:57 → 批 A 15:59，符合约束。

**缘起**（用户四条 + 此前已定三条）：①「**T0，但不开窗**，头脑风暴明确实施细节」——在 `memory/plan-s9-s10-economy-revolution-rollout.md` 的 T0 批次内落代码与工件、**不开窗**（不触发关窗批、不产生任何生产动账）；②「**T3a 提前到此批，并将之前因穷鬼线多扣的退回**」；③「不要忘了用 architecture-designer / game-economy-designer」；此前已定：**忠诚 = 俱乐部支出**、**按每个球员效力时长分别分档**、**费率排程 = 效力 0.5/1 收 5%、1.5/2 收 10%、2.5/3 收 20%、≥3.5 不收**、**扣款时点仍是每赛季第二个正式窗关窗**。

**交付（worker）**：
- **忠诚方向反转**（`src/worker/season-settle.ts`）：`loyaltyMovements` 由 `delta: agg.amount`（入账）改为 **`delta: -agg.amount`**（出账）；memo 由「忠诚奖金（S…）」改「**忠诚支出**（S…）」；审计 `action` 由 `'loyalty_bonus'` 改 **`'loyalty_charge'`**（`after.amount` 仍记扣款绝对值）；兜底排程补收官档（`[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]`，与 config 默认同源）。账本无余额下限守卫（`ledger_accounts` 直接累加）⇒ 负号即「**欠款**」语义：余额不足时扣成负值、下窗自然补扣（欠账三选一中的默认实现，另两选项需再发版）。连带注释/类型：`src/worker/window-machine.ts` 关窗响应 `loyalty`（`count` = 人次数、`total` = 扣款绝对值）、`src/worker/contract-ticks.ts`、`src/worker/routes/admin/market.ts`、`src/worker/routes/admin/seasons.ts`（顺带订正该处本已过时的「忠诚奖金 → growable」序）。
- **取消穷鬼线（零发版可回滚）**：`src/core/config.ts` 新增白名单键 **`wage_floor_gap`（默认 `'0'`）**；`src/worker/window-payroll.ts` 改 `const floorGap = (await config.getNumber('wage_floor_gap')) ?? 0;` + `const floor = cap === null || floorGap <= 0 ? null : cap - floorGap;`，去掉对 `WAGE_FLOOR_GAP` 的 import；`src/core/squad-rules.ts` 保留该常量作历史留档（注释写明旧行为 = 该键设 `'15'` ⇒ 顶级 53 / 次级 43）。⇒ 未来重启下限或调裕度都是**一次 `PUT /api/admin/config`**，不必发版。
- **费率排程固化**：`loyalty_tiers` 默认改 `'[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]'`（收官 0 档由实现里的 `rate <= 0 → continue` 跳过，不写 0 元流水）。口径要点：扣款只发生在**每赛季第 2 个常规窗**，而窗刻度每赛季走 2 步 ⇒ **两次扣款之间效力 +1.0 赛季**、每份合同共扣 **3 期 = 终身 35% × RC**（不是 6 期 70%）。
- **维护费与档位**：`tier_table` 第 1 档 `base_maintenance` **5.0 → 3.5**（升档后基础维护压力减半，配合生产写批把 `stadium_max_open_tier` 开到第 2 档）。
- **前端与镜像**：`web/src/lib/api.ts`（`LEDGER_KIND_LABELS.loyalty = '忠诚支出'` + 类型注释）、`web/src/pages/Ledger.tsx`（KIND_OPTIONS 补 `loyalty`）、`web/src/pages/admin/MarketPage.tsx` 与 `SeasonsPage.tsx`（中期窗「另扣忠诚支出」）；`scripts/prod-20261004-influence-recalc/engine.mjs` 的 `TIER_TABLE_DEFAULTS` 镜像同步（与 `src/core/config.ts` 逐字对齐，`tests/influence-recalc-engine.test.ts` 断言两者相等）。
- **测试**：`tests/season-settle.test.ts` 忠诚用例改断言负号 + `loyalty_charge`（`total` 仍为绝对值）、新增「收官档：效力 ≥3.5 免收」用例（效力 4.0 免收 + 效力 2.0 收 10% ⇒ 只 1 人 / 10）；三个下限用例**显式插 `wage_floor_gap='15'`** 回到旧口径验证、新增「取消穷鬼线（默认 0）」用例（Σ 33.37 ⇒ 实扣 −33.37、`wageFloorClubs=0`、memo 无尾注）；`tests/config.test.ts` / `tests/market-rounds.test.ts` / `tests/naming-tiers.test.ts` 的 `CONFIG_KEYS` 长度断言 80 → **81**。

**验收**：`npm run typecheck` 三份 tsconfig 0 error；`npx vitest run` 全量 **122 文件 / 1997 例**全绿（v6.46.0 基线 122/1995，净 +2 例）；`npm run build` 成功。

**生产写批（两批，2026-10-13 已按授权执行并回读验收）**：
- **批 B `scripts/prod-20261013-wage-floor-refund/`**（15:57 执行，先于批 A）：退回 S9 第 1 窗因旧下限多扣的 **+28.78**。预检 7 项全部命中（三队 wage 行仍为 −53 / −43 / −53、`balance_after` 16.82 / 42.95 / 50.29，Σ现行合同 49.23 / 37.62 / 33.37，顺移规模 6 / 6 / 12，账户 = 最新 `balance_after`，**全账本账链 0 断点**）；主件 `rows_written` **30**（3 改行 + 24 顺移 + 3 账户对齐）；验收回读：三队 wage 行 **−49.23 / −37.62 / −33.37**、memo 改为「…；穷鬼线已取消（用户令 2026-10-13），按现行合同实扣」、账户 **27.87 / 54.44 / 55.34** 且与最新流水 `balance_after` 相等、账链 0 断点、其余 15 队 wage 合计 −902.46 不变（三队合计 −120.22 ⇒ 全联盟工资口 −1022.68 = 预期）、三队现金合计 **108.87 → 137.65**。做法是**订正历史行**（原地改 wage 行金额 + 改 memo 尾注 + 整队后续流水 `balance_after` 顺移 24 条 + 账户对齐），**不新增流水行**（避免被读成 faucet）⇒ 必须整队顺移账链。本地已用 `node:sqlite` 复刻三队真实流水序列验证（`scratch/verify-refund-sql.mjs`：主件 30 → 重放 0 → 回滚 30 → 重放 0，账链全程一致）。bookmark `00002120-0000000e-00005103-…`。
- **批 A `scripts/prod-20261013-t0-economy-patch/`**（15:59 执行）：3 键落库（`loyalty_tiers` 排程 / `wage_floor_gap='0'` / `stadium_max_open_tier='2'`）。预检：config 8 行、**三键均未落库**、`kind='loyalty'` 流水 **0** 笔、窗口仅 S9 W1 已关（中期窗未开）、`config_set` 审计当时为空（无并发写者）；主件 6 语句 `changes 6`；验收回读：三键值 = `[[0.5,0.05],[1.5,0.10],[2.5,0.20],[3.5,0]]` / `0` / `2`，`config` 行数 **8 → 11**，`audit_log` 新增 3 条 `config_set`（id 257–259，`origin='machine'`、`before.value=null`），账本 393 行与窗口 1 行**零改动**、`loyalty` 流水仍 0。**取代** `scripts/prod-20261013-loyalty-tier-schedule/`（保留作历史、勿再执行）。bookmark `00002120-00000016-00005103-…`。

**评审·踩坑**：① 忠诚方向反转**必须与排程落库同批、且发版在前**（否则 S9 中期窗按旧代码把 −591.65 发成 +591.65，差 1183.30）；② 扣款只发生在赛季第 2 个常规窗 ⇒ 两次间隔窗刻度 +1.0 赛季 ⇒ 排程实际只走 3 期（终身 35%×RC），排程里的 `[3.5,0]` 是**收官档**而非装饰；③ 账本无余额下限 ⇒ 负号即「欠款」，4 支次级队（阿森纳/维拉/拜仁/RBL）同窗现金不足会被扣成负值（RBL 最重）；④ 退回历史多扣**不能新增流水**（会被读成 faucet）⇒ 原地改行 + 整队顺移 + 账户对账三件必须同批，且顺移条数取决于该队工资行之后的流水数（本轮 6/6/12）；⑤ `WAGE_FLOOR_GAP` 常量保留但不再被引用，避免既有文档/生成器口径断裂；⑥ 改历史行属订正类，本批不写 `audit_log`（与 `scripts/prod-20261012-*` 天气订正批同口径），留痕走执行记录与 `03-verify` 回读。

**文档同步**：TECH_DESIGN §7.1 kind 表（`loyalty` 行改 `−`、阶段改 P1 中期窗关窗）、§7.2 发行/回收（忠诚移出「发行」、进「回收」）、§11 结算段与关窗批、§13 config 表（新增 `wage_floor_gap` 行 + `wage_cap`/`loyalty_tiers`/`tier_table` 三行口径）、§15 假设 5/14/40；PRD 4.7 赛季结算行与假设 5；ROADMAP 本节；测试计划 `docs/test-plans/v6.47.0-economy-t0-patch.md`；排期稿 `memory/plan-s9-s10-economy-revolution-rollout.md` §4（T3a 并入 T0 + 退回批）。

**待拍板（执行后的剩余项）**：① 欠账策略取值——**当前为「允许负余额」（零额外代码）**，若要「归零」或「单列欠款账」需再发版；② 决策日历 A 档最后一条：冠军杯池 200 是否下调（S9 结算前改都有效）；③ T1 中期窗的开窗时点与时长（建议 ≥5 天，且开窗后立即 `POST /brands/market-round/reopen`）。

## [v6.46.0] · 球员页「比赛」页签：比赛数据进档案 + 补录放开到全部已确认非弃权场次 + 评分入库放宽 0–10（2026-10-13）

**已上线**（2026-10-13 用户「推送发布」：push `63864e2..09a9700`（11 枚 = 本版四枚 `0671f15`/`6d7a3bd`/`ec419cc`/`09a9700` + 前序 v6.45.1 四枚 `0d473ad`/`5f42449`/`de71eb0`/`2e1f14d` + v6.44.0 状态回写 `8a7f1e5` + v6.44.0/v6.45.0 发布记录回写 `2b2ec14` + 2026-10-11 S9 天气订正批工件 `26d5208`）⇒ CF Workers Builds 自动部署 Version `f2c82825-63ec-4e8c-b427-1f35f589a054`（version created 2026-10-13T00:12:24.775Z、deployment 00:12:25.728Z、100%、Source `Unknown (deployment)`）；零迁移、零 DDL、零生产写、零前置 secret/配置。上线回读：线上 `assets/index-CU9W7KKJ.js`（sha256 `e2cb1d0d…55a09`）与 `assets/index-CY2IZrGm.css`（sha256 `22c7aa10…f5b8d`）与本地 HEAD 重构建**逐字节一致**、线上入口含版本串 `6.46.0`、CSS 含 `matches-table`/`rating-badge`/`matches-subrow`、`/api/health` 200、`GET /api/players/239085/matches` 200（`{player:{id:1,name:"Erling Haaland",position:"ST"}}` + S9 次级联赛/冠军杯两行 + 合计「出场 6 / 进球 5 / 助攻 2」）、`/api/players/abc/matches` 400、`/api/players/999999999/matches` 404、匿名 `GET /api/admin/growth/match-entry/1` 与匿名 `POST /api/admin/growth/events` 均 401）。判级 minor——新增公开只读端点 `GET /api/players/:id/matches` 与录入台可录范围放开。

**缘起**：用户先在 visual companion 里定稿 UI（s3→s6 屏，确认「没问题UI了」），口径四条逐次拍定——①「球员面板加数据」；②「出场数按成长图像识别口径来，同时新增平均评分（学习FM的样式）放在出场后面，去除motm列」；③「均分两位小数，像FM一样改成白色字+分段配色背景，而且配色方案缺乏对比度，且难以表现优劣，要参考FM；门将数据的进球助攻换成零封」；④「还有失球」与「扑救数代替点球未进」。三问拍板（AskUserQuestion）：出场 = 四源并集「有记录即出场」；均分 = 放宽评分入库 0–10.0（<7.0 记 0 XP，XP 档位表不动）；成长覆盖不到的赛事 = 同时放开补录范围。**榜单页 `/stats` 与 `GET /api/stats` 挂起不在本批**（用户中途纠正范围：「你理解有误，本次任务是球员面板加数据」）。

**交付（worker）**：`src/core/player-matches.ts` 新建（456 行纯聚合）——`COMPETITION_LABEL` / `COMP_ORDER`（顶级→次级→冠军杯→超级杯→资格赛，未知排最后）/ `EVENT_TEXT` / `aggregatePlayerMatches(input)`；口径：先丢 `walkoverSide` 非空行、无确认行的场次整场丢弃（连成长记录也不认）；出场 `appeared = growthTypes.size > 0 || sources.has('event') || sources.has('lineup')`（缺阵不计）；黄牌同场有 `red_2y` 归 0、红牌含 `red` + `red_2y`；乌龙不计个人进球；伤退按场上限 1；门将事件串首推「零封/失球 N」（取 `result_confirmations` 比分快照）、末推「扑救 N」；汇总键 `season|competitionType|tournamentId`，均分按赛事与赛季双桶累加、合计行 `competitionName='合计'` 用**加权平均**；赛季倒序、流水按日期倒序（空最后）。`src/worker/player-matches.ts` 新建（221 行取数）——`ID_CHUNK = 50`、`LINEUP_SCAN_LIMIT = 2000`、`isStarterWithin` 要求 JSON 可解析且首发恰 11 人含该球员（**链式沿用不算**）；四源 = growth_events（`match_ref` 非空六类事件）→ club 集合（`players.club_id` + completed 转会两端）→ `tourTeamIdsByClub` → TOUR_DB `player` 补队号 → `match_event`（`player_id OR assist_player_id`）→ `tactic_submission JOIN match status IN ('live','finished')` → `injury_miss JOIN injury`，并集回查 `result_confirmations` 后聚合。`src/worker/tournament-names.ts` 新建（`loadTournamentNames`/`tournamentNameOf`，从录入台抽出共用）。`routes/players.ts` 新增 `GET /api/players/:id/matches`（`:id` 兼容 fc_id 与内部 id；400「球员 ID 不对」/404「球员不存在」；公开只读、不限流不缓存，与同页 `/growth`、`/transfers` 同口径）。`routes/admin/growth.ts`：`MATCH_ENTRY_WHERE` 去掉赛事限定只留非弃权（**能录与计 XP 解耦**）；新增 `xpEligibleOf(row)` 并随列表/面板下发 `xpEligible`；批量端点对非 XP 场次的零封/夺回球权/扑救整批 400（「本场不计成长 XP，X 的零封录不了，只能录出场与评分」）且这些行 `xp` 写 0；单条端点按数字锚查 `result_confirmations` 判 XP（查不到按不计 XP 保守处理）；`manualEventOf` 评分放宽 0.0–10.0。`src/core/growth-ocr.ts`：有评分即预填出场 + 评分（去掉 ≥7.0 门槛与警告）。

**交付（web）**：`lib/api.ts` 加 `PlayerMatchesResponse` 等四类；`lib/player-matches-view.ts` 新建（`ratingTier` 六档、`ratingText` 汇总 2 位/流水 1 位、`flowTitle`/`flowEvents`/`scoreText`/`narrowSubline`/`statColumns` 场上与门将两套八列、`NARROW_STAT_COLUMNS = 4`）；`pages/player/MatchesTab.tsx` 新建——汇总表 `table.matches-table.zebra`（11 列 = 赛事/出场*/均分 + 八列，赛季分组行 `tr.matches-season`、合计行 `tr.matches-sum`）+ 均分白字六档徽章（`.rating-badge.t1..t6`，无评分 `.rating-none`「—」）+ 门将变体（进球/助攻/点球未进 → 零封/失球/扑救）+ 逐场流水（`.matches-flow > .matches-row` 两行式：标题 + 橙色事件串 + 比分 + 当场评分）+ 三条脚注；窄屏（页内既有 `useMediaQuery('(max-width: 760px)')`，非设计稿 640）裁到 7 列 + 每赛事一条**整行副行**（`tr.matches-subrow > td[colspan=7]`，9px 小字）+ 按赛事序号成对染色 `.matches-alt`（窄屏不用 `nth-child`——两行一组会错位）+ 密度档 `.matches-table-narrow`；`Player.tsx` 加第 5 页签 `matches`（标签「比赛」，query `['player', id, 'matches']`、`enabled: tab === 'matches'`）；`styles.css` 新增 v6.46.0 块（`.zebra` 工具类偶数行 `#faf4e7`，刻意比 hover `#f7f0e0` 浅；合计行 `#f3ead9` + 上边线 `#d9cbb2`；赛季行 `var(--terracotta-tint)`；六档徽章 `#065f46`/`#166534`/`#4d7c0f`/`#a16207`/`#c2410c`/`#b91c1c`，白字对比 ≥4.9:1），并顺带修掉 v6.31.0 广告板注释里 `.tb-*` 提前闭合注释导致的 esbuild CSS 语法警告。录入台（`GrowthEntryPage.tsx`、`lib/growth-ocr.ts`）：评分校验/占位改 0.0–10.0；`noXp = match.xpEligible === false` ⇒ 三个计数器禁用（卡片与表格各 3 处）、头徽章与粘性汇总条改「本场不计成长 XP」、行首挂「不计 XP」徽章、XP 列按住 0、新增提示块；OCR 合并传 `allowCounters = !noXp`（非 XP 场次不预填零封/扑救并在识别报告里说明原因）；页说明文案订正。

**验收**：`npm run typecheck` 三份全清；vitest 全量 **122 文件 / 1995 例**全绿（v6.45.1 基线 119/1964，净 +3 文件 +31 例：`tests/player-matches.test.ts` 13 例、`web/src/lib/player-matches-view.test.ts` 9 例、`web/src/pages/player/MatchesTab.test.tsx` 5 例 + TC-BATCH-11/12 + TC-FE-07 + TC-ENTRY-E7，并改写 TC-LIST-01 / TC-PANEL-03 / TC-BATCH-04、07 / TC-DRAFT-01、02 / TC-EP-04、07 与 `growth.test.ts` 重复补录用例）；`npm run build` 成功（版本号 bump 后终版 `web/dist/assets/index-CU9W7KKJ.js` 639.79 kB / gzip 202.06 kB，`GrowthEntryPage-F8Tykvi2.js` 31.96 kB；CSS 已无 `Unexpected "*"` 警告）；e2e 新增 **㉑ 球员页「比赛」页签**（1280 = 11 列 + 赛季行 + 合计行 + 徽章跨 ≥3 档 + 卡内不溢出；375 = 7 列 + 副行 `colspan=7` + 文档与卡内零横滑；端点打桩，因本地 TOUR_DB 是旧 schema 缺 `tactic_submission`/`injury`/`injury_miss`），**全量 26/26 通过**（`scratch/e2e-v6460-full2.log`；首轮 25/26 的 ① 首页为刚重建 dist 后的冷启动抖动，单跑 1/1 复现即过）；**变异 8 处全命中**（M1 出场去 lineup → TC-PM-01/TC-PME-01；M2 两黄变一红归零前置 `false &&` → TC-PM-02；M3 弃权丢弃前置 `false &&` → TC-PM-04/TC-PME-03；M4 档位 `>= 8.5` 改 `>` → TC-PMV-01；M5 窄屏内边距放大 → e2e ㉑「375 卡内横向溢出 47px（表格 339 / 卡片 292）」；M6 `xpEligibleOf` 恒真 → TC-LIST-01/TC-PANEL-03/TC-BATCH-11、12；M7 OCR 恢复 `< 7` 跳过 → TC-EP-04、07 + TC-DRAFT-01、02；M8 评分下界回到 7 → TC-BATCH-04、11 + `growth.test.ts`）。真机走查（`VACUUM INTO` 副本环境 + 种子数据）：阿四 9004 九场两赛季六档徽章全覆盖、弃权场（成长里有 9.9 分）整场丢弃、两黄变一红排除、门将 9001 零封/失球取比分 + 扑救取 saves；桌面 1280 表格 820 = 卡 820（无横滑），窄屏 375 修前 424 > 292（横滑 132px）→ 副行改整行后 292 = 292（零横滑）。测试计划 `docs/test-plans/v6.46.0-player-matches-tab.md`。

**评审·踩坑**：① CSS 注释里绝不能出现 `*/`——写「赛事/出场*/均分」把注释提前闭合，esbuild 报 `Unexpected "*"` 语法警告（本版顺手修掉这条既有噪声）；② 窄屏副行不能塞回「赛事」格（9px `nowrap` 把首列撑到 144px ⇒ 卡内横滑 56px），改独立整行 + 密度档；③ 窄屏每赛事两行使 `nth-child` 斑马纹错位 ⇒ 窄屏改 JS 挂 `.matches-alt`；④ 静态闸门 TC-SWP-01 要求 `<table>` 的上一非空行就是 `.table-wrap`，注释不能插在两者之间；⑤ e2e 取样前必须先 `goto` 同源页（否则相对 `fetch` 报 `Failed to parse URL`）；⑥ 本地取样球员是门将 ⇒ 表头断言要容纳场上/门将两变体；⑦ `cleanSheetSide` 只是「本侧失球 0」的描述、不受 `allowCounters` 影响（别把描述当开关断言）；⑧ `PlayerMatchesInput.teamNameById` 只装「我的队」，测试塞两队会让 `side` 判不出；⑨ `node:sqlite` 拒绝双引号字符串字面量 ⇒ 夹具改绑参；⑩ 本地走查副本必须用 `VACUUM INTO` 导出（`cp -r` 会搬走活动 WAL ⇒ workerd 反复崩，日志 `The Workers runtime crashed unexpectedly and is being restarted (crash #1)`）。

## [v6.45.1] · 成长录入：列表列全部可录场次 + 赛事/轮次视图切换 + 手录值可改后重提（XP 按差额）（2026-10-12）

**已上线**（2026-10-13 随 v6.46.0 同批发布：push `63864e2..09a9700` 含本版四枚 `0d473ad`/`5f42449`/`de71eb0`/`2e1f14d` ⇒ CF Workers Builds 自动部署 Version `f2c82825-63ec-4e8c-b427-1f35f589a054`（version created 00:12:24.775Z）；零迁移、零 DDL、零生产写；上线回读见 v6.46.0 条目）。判级 patch——无新增端点、零迁移、零 DDL，契约只在响应与类型上新增 `updated` 与列表去截断。用户两条：① 「展示50场的限制去掉，显示所有的并可切换显示赛事和轮次」；② 「按赛果确定的值不可在录入面板改，其余皆可改，并可提交，收起一场比赛时如果有未保存改动则警告，可选保存或丢弃」。裁决（AskUserQuestion）：轮次视图口径 = **「赛事加轮次，不算窗口」**、**不加「只看未录」筛选**；改值走**支持改值**（选项 3「取消勾选已录的出场/零封 = 删事件回收 XP」本轮不做，界面提示里说明现状）。

**缘起**：① 列表——线上可录场次已到 **100** 场（全 season 9），`LIMIT 50` 会让最早那批场次彻底看不见；且赛事/轮次两种视角各有各的用处（找某一轮的全部比赛 vs 找某赛事的进度）。② 改值——原口径「已录值不可改（平台暂无成长事件删除通道）」把手工录错的值钉死了：`UNIQUE(player_id, match_ref, event_type)` 下重申同锚只是静默 no-op，而赛果自动行（进球/助攻/赛果零封）本就该以赛果为准；用户要求**手录值（评分 / 夺回球权 / 扑救）可改后重提**，并在丢草稿前警告。

**交付（worker）**：`src/worker/routes/admin/growth.ts`：① 列表 SQL 去掉 `LIMIT 50`（保留 `ORDER BY rc.confirmed_at DESC, rc.match_id DESC`），头注改口径（线上 100 场、前端两种视图展示）；② 新增 `EVENT_TYPE_LABELS`（出场/评分/零封/夺回球权/扑救/进球/助攻）供 400 文案；③ 新增 `replayEventChain(db, playerId, eventType, change)`——读该球员同类型事件按 `ORDER BY created_at, id` 重放（`base` 从 0 累加、被改行用新值），返回 `{xp, extra:[{id,xp}], delta}`，用于累计项（夺回球权每 12 次 1、扑救每 8 次 1 且单场 >8 额外 1）改值后**同一球员同类型的后续事件 XP 连带重算**；④ 批量端点预读扩成 `SELECT id, player_id, event_type, value, xp, source ... WHERE match_ref = ?` 并建 `Map<'playerId|eventType', ExistingEventRow>`，按锚分**三分支**——同值 no-op / `source='manual'` 且值不同则改值（`UPDATE growth_events SET value, xp, recorded_by` + 链上后续行 `UPDATE xp` + `UPDATE players SET growth_xp = growth_xp + Σ(new−old)`，差额可为负）/ `source='auto'` 且值不同则**整批 400**「X 的{零封}由赛果确定，不能在录入台修改」（零写入零审计）；⑤ 语句构建改 `signals[{kind:'insert'|'update'|'noop', index, deltaXp}]` 记各自在 batch 里的下标，批后按 `results[sig.index].meta.changes === 1` 判 applied；⑥ 审计 `after = {matchId, written, updated, duplicates, entries}`（entries 每项带 `kind` 与 `previousValue`）；⑦ 响应 `{ok, written, updated, duplicates, totalXp, perPlayer:[{playerId,name,xp,written,updated,duplicates}]}`，`written > 0 || updated > 0` 才 201（同值重提仍是 200 + duplicates）。

**交付（web）**：`web/src/lib/api.ts`（`MatchEntryPerPlayerResult`/`MatchEntrySubmitResult` 加 `updated`，列表端点注释改「列全部可录场次」）；`web/src/lib/growth-entry-group.ts`（抽 `tournamentKeyOf`/`roundKeyOf`/`tournamentLabelOf`——**两视图共用轮次键** `t{tid}|{round}|{stageName}`、不含窗口；新增 `MatchEntryRoundView{key,label,tournament,matches}` 与 `groupMatchEntriesByRound` 单层分组）；`web/src/pages/admin/GrowthEntryPage.tsx`：① 列表头 `.list-head` + `.seg`（`role="radiogroup"`「按赛事」/「按轮次」，偏好写 `localStorage['whl.growth-entry.view']`，非法值回落 `tournament`），**切换视图也过 `guard`**（切视图会重挂面板丢草稿）；② 新增 `renderRows`/`tournamentView`/`roundView` 共用行渲染（轮次视图组头「第 N 轮 · 赛事名 · N 场」）；③ 锁定口径重做——`lockMark`（出场/零封：查看模式或已录即锁，是「记过」标记不可撤销）/`lockNum`（评分/夺回球权/扑救：查看模式或「已录且来源非 manual」才锁），`cellCls` 给「已录但仍可改」的格子加 `.editable`；④ `applyResult` 不再给数值项上锁（只锁提交过的出场/零封）、`base` 前移照旧，结果文案区分「新录 N 项 / 改 N 项」且 XP 按差额显示（**可为负**）；⑤ 保存管线拆 `runSubmitEntries`（真干）+ `submitEntries`（`savingRef` 在飞闸，返回 `Promise<boolean>`）、按 `BATCH_SUBMIT_MAX = 50` 分块提交并合并同球员多次结果、新增 `saveAllSides()`（两侧脏行合并提交，非法行计数后拒绝放行）与 `savedText()`；⑥ 收起确认条三选「继续编辑 / 保存并继续 / 不保存，继续」，「保存并继续」先 `await` 在飞的保存（`saveAllSides` 开头 `if (inflight) await inflight;`）再按最新 `rowsRef.current` 算脏行——否则刚落地的那一行会被漏掉；⑦ 文案：页面提示段去掉「已录值不可改」、面板 edit 模式加改值规则行、view 模式提示改「要改值请点「录数据」」；⑧ 已录的手录值**不能清空**（清空等于删事件、平台没有删除通道）——`rowIssues` 对评分/夺回球权/扑救各加一条「已录的 X 不能清空（没有删除通道），填新值即可改」⇒ 行内红字 + 行内保存禁用 + `saveAll` 计入 skipped + 确认条「保存并继续」不提交也不放行，堵掉「永远算脏却永远存不进」的死角。`web/src/styles.css`：新增 `.list-head`（h3 与段控件同行）与 `.entry-table td.recorded.editable` / 窄屏 `.entry-card-field.recorded.editable`（土黄描边 + 浅色斜纹，位置在各自 `.recorded` 规则之后）。

**验收**：`npm run typecheck` 三份全清；vitest 全量 **119 文件 / 1964 例**全绿（v6.45.0 基线 118/1948，净 +1 文件 +16 例：`web/src/pages/admin/GrowthEntryPage.test.tsx` 6 例 TC-ENTRY-E1..E6、`web/src/lib/growth-entry-group.test.ts` 新增 TC-GRP-07/08/09、`tests/growth-match-entry.test.ts` 新增 TC-EDIT-01..07 并改写 TC-LIST-03（去 50 上限断言）与 TC-BATCH-01/10 的 `updated` 字段）；`npm run build` 成功（`web/dist/assets/index-*.js` 650.27 kB，产物在 `web/dist` 不在根 `dist`）；e2e **25/25**（脚本 ⑭ 按新契约改造：XP 实时复算 + 保存后手录格仍带 `recorded editable`、只读侧对照、按锚点回滚 SQL——改值是 UPDATE，`created_at` 不变所以按时间圈不到；新增 `E2E_ONLY=<标题片段>` 场景过滤便于单场景迭代）；变异 **8 处全命中**——M1 去掉 manual 改值豁免（`found.source === 'manual' ||`）→ TC-EDIT-01..04 红；M1b auto 拒改的 `throw` 换 `continue` → TC-EDIT-05 红；M2 `replayEventChain` 里改值行用旧值 → TC-EDIT-03 红；M3 状态码退回 `written > 0 ? 201 : 200` → 3 例红；M4 `lockNum` 去掉 manual 豁免 → E1/E2/E4 红；M5 `BATCH_SUBMIT_MAX` 50→1000 → E4 红；M6 切视图按钮不过 `guard` → E3 红（**第一次只变异了「按赛事」一侧没红**，E3 已扩成双向）；M8 删 `saveAllSides` 里的 `if (inflight) await inflight;` → E5 红。测试计划 `docs/test-plans/v6.45.1-growth-entry-list-and-panel-edit.md`。

**评审/踩坑**：① e2e ⑭ 一度稳定挂 `locator.waitFor: Timeout 15000ms exceeded`（等 `.entry-panel` detach）——真因**不是产品 bug**：早前失败的轮次都在末尾回滚 SQL 之前就挂了，本地库留着手录 `rating` 行 ⇒ 面板一打开该格就带旧值且已是 `recorded editable`，e2e 的「填值 + 等 class」条件打字当下即满足 ⇒ 保存还在飞就去点「收起」⇒ 行基线未前移仍算脏 ⇒ 确认条拦住、面板不卸载。修法两侧：产品侧「保存并继续」等飞行中保存（`savingRef` + `await inflight`），e2e 侧改成等真实 POST 响应（`saveResponse` 由 `onSave` 兑现）；增量单测 TC-ENTRY-E5 钉住（M8 座实）。② 变异必须**先确认测试有牙**：M6 第一次只变异了单侧按钮，测试不红是因为用例只走正向切换——扩成双向后即红。③ 本地 dev 的赛事库副本是旧 schema（v6.45.0 起的 `scripts/local-tour-schema.mjs` 幂等补列）——停赛查询 500 会让 e2e ⑭ 必挂。④ 工具口径：`wrangler deployments list` 旧→新（看最新用 `tail`）；访问生产须 `curl --noproxy '*'`；批量改写文档一律用 Edit 逐处改（Node 脚本按跨行锚点取段会吞整行）。⑤ **code-review 复审追加一轮**（收口前按 `AGENTS.md:57` 审 diff）：审出「已录值可清空 → 该行永远算脏却永远存不进」的边界缺陷（修法见交付 ⑧ + TC-ENTRY-E6），另修测试里 `let settle = null` 被 TS 收窄成 `never` 导致的 TS2349（`settle?.()` 要改成对象持有的 `gate.resolve`——vitest 不做类型检查所以只绿不报，靠 `npm run typecheck` 才抓得到）；改完重跑 typecheck 三份 / vitest 119·1964 / build / e2e 25-25 全过。

## [v6.45.0] · 成长录入：按赛事/轮次分组 + 停赛硬拦截 + 出场改识别记账 + 训练营放开逐场（2026-10-12）

**已上线**（2026-10-12 发布：push `2b48197..63864e2`（5 枚 = 前序 S9 订正批工具 `8f10161` + 本版四枚 `85aaa14`/`013d111`/`114257f`/`63864e2`）⇒ CF Workers Builds 自动部署 Version `100a7bdb-48a6-4f86-9ea7-c5fa8b1637b6`（version created 2026-10-12T07:17:34.637Z、deployment 07:17:35.957Z、100%、Source `Unknown (deployment)`）；零迁移、零 DDL、零生产写、零前置 secret/配置。上线回读：线上 `assets/index-CF75cdet.js`（sha256 `61222e3c…b2ddf`）与 `assets/index-lqBVTO5f.css`（sha256 `70a47562…8442e`）与本地 HEAD 重构建逐字节一致、线上入口含版本串 `6.45.0`、`/api/health` 200、`/api/players?limit=1` 200、匿名 `POST /api/admin/growth/match-entry/1/ocr` 与匿名面板端点均 401）。缘起（用户四项拍板 2026-10-12）：①「成长录入按赛事/轮次分组」——原列表一长条，分不清哪场属于哪个赛事哪一轮；②「出场交截图识别 + 人工」——FC26 的 `match_event` 里根本没有「出场」事件，自动通道靠「有事件」反推上场名单天然残缺（没碰球的登记者一条事件都没有），故**删掉自动出场事件**，改由录入台截图识别预填 + 人工确认；③「赛果端阻止停赛球员录入」——停赛本就该缺席，录成长等于凭空发 XP；④「训练营连自动通道一起放开，赛季固定 XP 保留」——原口径（训练营不按场次、只走赛季结算 40/15）作废，两条线并行累加。交付（worker）：`src/worker/tour-suspension.ts` 新建——只读赛事库复算「某场某球员是否在服停赛」，逐条镜像赛事仓 `worker/lib/suspension.ts` 的规则与 SQL 顺序（直红 `redBan=2`、两黄变一红 `red2yBan=1`、累积 `yellowThreshold=3` 张停 1 场并清零、红黄并行叠加、「先消耗后触发」（由语句顺序保证）、pending 场与弃权方不消耗停赛、轮空场不进比赛序、`yellowResetAt` 锚点按 `created_at` 拆两段重放且接力 ban 不重复消耗；比赛序 `ORDER BY stage.sort_order, round, slot, leg, id`；事件按球员 `p.team_id` 收窄、entry 取自事件自身的 `me.entry_id`）；`suspendedPlayersAtMatch(tourDb, matchId)` → `Map<赛事 player.id, {reason,total,serving}>`（`serving` = 本场是第几场，**消耗前捕获**），`suspensionLabel` 出「直红 · 停 2 场」文案；**跨库只读直查、不做 HTTP、不落库**（赛事仓引擎是纯派生实现，跨库也没有可读的停赛表）。`src/worker/routes/admin/growth.ts`：面板端点随花名册下发 `suspended`（本库 `players.fc_id` 为空判不出停赛 → null 不锁），批量端点与单条端点整行 400 点名「X 本场停赛（直红 · 停 2 场），不能录成长」（**不静默跳过**——静默跳过会让管理组以为录上了）；列表 DTO 补 `tournamentId/tournamentName`（赛事名在赛事库，第二趟 IN 查，查不到归「未关联赛事」）；删除「训练营球员不按场次」的整行 400 闸。`src/worker/results.ts`：删自动出场事件、删进球/助攻/零封三处的训练营 `continue`；头注重写口径。交付（web）：`web/src/lib/growth-entry-group.ts` 新建（`groupMatchEntries`/`roundGroupLabel` 纯函数：按赛事 → 轮次两级并组、按首次出现序、轮次键带赛事前缀不跨赛事混并）；`GrowthEntryPage` 列表改两级组头渲染（「赛事名 · N 场」「第 N 轮 · stage · N 场」，比赛行首列改「S{赛季} · 赛事类型 · 窗口 N」）、停赛行整行置灰标红（`row-suspended` + `badge red` + `bad-text`）、桌面与卡片两处各 10 处 `disabled`、保存跳过、识别合并整行跳过且不参与门将零封联动；训练营由「整行锁定」降级为纯徽标。已知边界：球员同时命中多条停赛时只报最先消耗的那一条；`b.from <= i` 在本次循环次序下恒真（与赛事仓逐字一致，保留并加注）。验收：`npm test` **118 文件 / 1948 例全绿**（v6.44.0 基线 116/1927，+2 文件 +21 例；新增 `tests/tour-suspension.test.ts` 13 例、`web/src/lib/growth-entry-group.test.ts` 6 例）；`npm run typecheck` 三份全清；`npm run build` 成功（`dist/assets/index-*.js` 650.27 kB）；e2e **25/25**；**变异 7 处全命中**（弃权方消耗停赛→TC-SUS-07；黄牌阈值 `>=` 改 `>`→5 例红；pending 不消耗守卫去掉→TC-SUS-02；面板 `suspended` 恒 null→TC-PANEL-04；批量停赛闸关掉→TC-BATCH-03；分组键去掉赛事前缀→TC-GRP-01/02；恢复自动出场→4 例红）。测试计划 `docs/test-plans/v6.45.0-growth-entry-grouping-suspension.md`。工具：`scripts/local-tour-schema.mjs`（幂等补列 + 回填事件 `entry_id/created_at`）——本地 dev 的赛事库副本是旧 schema，不跑它 e2e ⑭ 会 500（线上赛事库是当前 schema，不受影响）。

## [v6.44.0] · 天气同步入站：插件预报推送 → 平台落库（含上座算式抽取与 S9 订正批工件）（2026-10-12）

**已上线**（平台侧 2026-10-12 上线（本轮回读部署列表确认）：用户 push `2b48197` ⇒ CF Workers Builds Version `1daf0aaf-924f-4f6f-960a-1975d9dd11c9`（version created 04:40:07.907Z、deployment 04:40:08.682Z、100%、Source `Unknown (deployment)`）；同轮 04:38:52.459Z 另有 Source `Secret Change` 版本 `313aa3c6-92d5-4dc3-9e81-b6905098629b` = 平台配 `WEATHER_SYNC_SECRET`。零迁移、零生产写。前置核对：匿名 `POST /api/internal/weather-sync` → 403 `bad_signature`（未配应为 503 `unconfigured`）⇒ 密钥确已配置、fail-closed 生效；**插件仓 v2.12.0 已部署并完成全量推送**（2026-10-12 回读确认：服务器 Docker 容器 `astrbot_ajcs-astrbot_aJCs-1`（AstrBot 4.28.1）宿主 bind mount 直改 11 个源文件 → `docker restart` → 日志 `Migrated matches: added wx_coef column` + `Database schema migrated 12 -> 13`；配置 `club_sync_url=https://club.whleague.win`/`club_sync_secret`/`club_sync_season=9`（插件赛季号 2 ↔ 平台 S9）；推送回执 `{rounds:20, matches:116, fixed:116, corrected:23, delta:26.1945, push_ok:20, push_error:0}`，平台逐场 verdict **created 103 / skipped_no_stadium 13 / unmatched 0 / unchanged 0 / replaced 0 / bad_weather 0**（13 场 = 主队是 CPU 队），插件自家冲正 23 场合计 **+26.1945**）；订正批工件**已生成，并已于 2026-10-13T01:32Z 执行完毕**：`--ts=2026-10-12T11:45:00Z`、`authoritative.json` 103 行 ⇒ `sql/02-recalc.sql`（237 句/26 批，sha256 `64db49f5…0418a`）订正 **78 场**（类型不一致 59 + 仅系数 19；精确 66 / 估计 12）净 **+0.63**（比赛日收入 162.23 → 162.86，账本 78 笔——含 7 场零差额留痕）、`sql/02a-type-only.sql`（177 句/20 批）保守 59 场、`sql/03-verify-balance.sql`/`03a-verify-rows.sql`、`rollback/01-undo.sql`（237 句/24 批）、`report.md`（逐场 78 行 + 逐队净变化 + 残余不确定度）、`manifest.json`/`report-data.json`；分类 可订正 78 / 只改天气 3 / 跳过 9 / 无权威 0 / 异常 0，`--out=<临时目录>` 重跑逐字节一致、`exec-shards --dry` 三份全过）。缘起（用户五条裁决）：①「真源=插件→平台」——插件已有天气预报与系数，平台只在结算时现抽，两侧同场不同天气导致上座与比赛日收入长期对不上，故只做**正向**同步（插件推、平台收），不做反向；②「粒度=天气类型 + 系数」——不只同步晴/雨/雪，把 `wx_coef` 一并推送，平台结算直接吃插件系数；③「范围=正向同步 + 回填 S9」——不止以后，S9 已结算的 90 场也要收敛；④「回填时如果缺少系数，则在天气档内重随，注意重算顺序」；⑤「已结算的错误历史账两侧都要订正」+ 自动化要求「插件一条命令全量（含自家冲正）、平台一次授权全量一批」。交付（平台）：`src/core/attendance.ts` 新建——上座与三档收入算式抽成纯函数 `computeMatchAttendance(formula, factors, rng)`（导出 `uniform`/`round2`，**rng 消费顺序 = perturbation 先、fill 后**），`src/worker/home.ts` 改调用并 `export { uniform }`（既有金样逐位不变，抽取行为保持）；`src/core/name-fold.ts` 加 `normTeamName`（trim + 剥尾部 `(CPU)`/`（CPU）`）；`src/worker/weather-ops.ts` 追加天气同步域——`parseWeatherPush`（形状矩阵校验，code ∈ bad_body/bad_season/unknown_competition/bad_round/bad_items/bad_item）、`applyWeatherPush`（`COMPETITION_TYPE_BY_NAME` 三级映射 → `season_tournaments` 绑定 → `MATCH_SELECT` 按 `normTeamName(home)|normTeamName(away)` 唯一匹对 → `match_weather` `INSERT … ON CONFLICT(match_id) DO UPDATE SET weather/wx_coef/forecast_by='revenue-plugin'`，**推者赢**；逐场 verdict ∈ created/replaced/unchanged/unmatched/skipped_no_stadium/bad_weather + `settled` 标记，`unmatched` 与 `bad_weather` 不阻塞同轮其余场次；写语句与审计行同批 `env.DB.batch`，**零写入不写审计**）；`POST /api/internal/weather-sync`（`src/worker/routes/internal.ts`，独立密钥 `WEATHER_SYNC_SECRET`——与 `TEAM_SYNC_SECRET` 分设，未配 503 fail-closed，验签 `POST|path|ts|body` HMAC-SHA256 ±300s）；审计 `action='weather_sync'`/`origin='machine'`/`actor=null`。交付（插件 v2.12.0）：schema v13 `matches.wx_coef REAL`（`_migrate` 幂等 ALTER）、`formula.roll_weather_with_coef` + `attendance(..., wx_coef=None)`（显式系数优先，否则现抽）、`forecast_round`/`set_weather` 落库系数、`_record_one` 传 `match["wx_coef"]`（NULL 回落）、`services/club_sync.py`（规范串 `POST|path|ts|body`、`ensure_ascii=False,separators=(",",":")` 同一字节串签名与发送、5xx/网络异常重试 3 次且每次重取 ts、4xx 不重试、未配置旁路）、指令 `/主场天气推送 [预览]`（按轮：补抽落库 `WHERE wx_coef IS NULL` → 推送 → 自家冲正已结算且系数为空的场次，delta 入账 `note='天气订正|match:<id>'`，`apply_weather_correction` 单事务原子幂等 + 余额同步）、配置 `club_sync_url`/`club_sync_secret`、`requirements.txt` 加 aiohttp。交付（订正批工件，**已执行**）：`scripts/prod-20261011-s9-weather-recalc/`——`01-precheck.sql`（A–I 九段只读预检）+ `capture-snapshot.mjs`/`snapshot.json` + `capture-authoritative.mjs`（推送后抓 `forecast_by='revenue-plugin'`）+ `gen-recalc-sql.ts`（**两档口径**：计划行可对上时按 `plan.json` 的 `factors.demand` 反推 K0 做精确重算 `demandNew = K0 × coef/mid` 且按 `demandNew` 与容量比大小决定满座，残余 ≤1 席；否则按系数比·期望中性归一 `A_new = round(A_old × coef/mid(range[w_p]))`，残余上界 ≈8% + 3% 扰动；收入按平台算式重算、`broadcast` 与上座无关保持原值；满座场只向下 `min` 且 `floor(capacity×0.999)` 封顶；权威系数落在区间外**硬跳过**；账本 `kind='manual_adjust'`/`ref_type='wx_fix'`/memo 前缀 `天气订正·match:<id>`（禁 `|`，走 `--command` 通道）；`selfCheck()` 硬断言不过即不产出）+ `sql/02-recalc.sql`/`02a-type-only.sql`/`03-verify-balance.sql`/`03a-verify-rows.sql`/`rollback/01-undo.sql`/`manifest.json`/`report-data.json`（推送后以真实权威存证重新生成，已于 2026-10-13T01:32Z 执行）+ README 八节。推送前盘点（生产快照 `--remote` @2026-10-12T02:19:36Z）：S9 已结算 90 行、比赛日收入合计 **162.23**、天气 晴29/多云37/雨19/雪5、已清零 5（全弃权场）、满座 20、账实不符/缺赛果/缺球场/异常 = 0/0/0/0、`match_weather` **全库 0 行**（平台从未有预报行 ⇒ 平台当时系数无处可查，这也是估算档口径的来源）、可精确重算 **72** 行、敏感度（权威系数取 0.75–1.25）合计变化区间 −38.79…+43.51。验收：typecheck 三份全清、vitest 全量 **116 文件 / 1927 例**全绿（v6.43.1 基线 114/1898）、build 成功（`index-Bq3_6zyQ.js` 650.25 kB / gzip 206.28 kB）、e2e **25/25**、插件 `python tests/run_all.py` **279 项 0 failed**（s0–s18）、跨仓签名金标准向量两侧逐字同值（`whl-golden-secret` + ts `1700000000` → `8ecf0abc…d1469e633`）、演练 selfCheck 通过且 `exec-shards.mjs --dry` 折 23 批通过。测试计划 `docs/test-plans/v6.44.0-weather-sync.md`。生产待办：① 平台 `wrangler secret put WEATHER_SYNC_SECRET` —— **已完成**（2026-10-12，Version `313aa3c6`）；② 插件仓部署 v2.12.0（`pip install aiohttp`）并填 `club_sync_url`/`club_sync_secret` —— **已完成**（容器内 aiohttp 3.14.1 已装，无需 pip；另加 `club_sync_season=9`）；③ 推送后跑 `capture-authoritative.mjs` + 生成器出 02*/03*/rollback/报告 —— **已完成**（见上）；④ 订正批执行 —— **已完成**（2026-10-13T01:32Z，用户授权后：`sql/02-recalc.sql` 经 `exec-shards.mjs --remote --chunk=20 --retry=2` **237/237 句提交、changes 237、rows_written 471、失败批 0**——每句恰改 1 行 ⇒ 旧值守卫全部命中、无静默 no-op；复查 18 队余额 = 基线 + 净变化（16 队与工件注释里的逐队期望值逐字相同，club 1 `49.68` / club 112172 `2.16` 与期望之差恰等于快照后新结算的 match 194：主场 +4.08 = 1.18 + 2.90、客场奖金 +6.70）、账本 `wx_fix` **78 行合计 +0.63**、`wx_fix_undo` 0 行、守恒位 `Σbalance − Σamount` = **0.00**、`att_old_n` 6 / `att_new_n` 78 / `wx_old_n` 0 / `wx_new_n` 59；收敛核对 **81/81**——78 订正 + 3 只改天气场的平台 `match_attendance.weather`、`match_weather.weather`、`match_weather.wx_coef` 与 `authoritative.json`（推送落地时 11:43:54Z 的 103 行原文）逐场一致；执行前预检的漂移已解释：match 194 预报行随推送落库（11:42:57Z）、赛果 14:35:06Z 才确认 ⇒ 该场结算时吃的就是权威预报、本就收敛，其 3 条账本流水与 club 1 球迷演化均为追加，原 90 行上座行逐行未变；工件口径订正：`03` 注释 `wx_fix` 计数 71→**78**、`03a` 注释 `att_old_n` 0→**6**、`manifest` 02 期望语句数 234→**237**、`report-data.json` `ledgerEntries` 71→**78**（另加 `ledgerEntriesNonZero` 71）、`rollback/01-undo.sql` 234→**237** 句（补 3 场只改天气的还原），`02`/`02a` 重跑逐字节不变、sha256 仍是实跑内容；回滚未使用、保持备用）。 **推送与部署（2026-10-13）**：`git push origin main`（`09a9700..460f590`，3 枚 = 并行会话 `1ea2cc8` + 本批执行记录回写 `771e8a3`/`460f590`）⇒ CF Workers Builds 自动部署 Version `9a6e6daf-0e0a-4572-9675-d2f5892e9c8b` @2026-10-13T02:37:22Z（纯文档与工件改动、bundle 不变）；插件仓同轮推送 `da93a2e..1b36cf8`（`origin/master` = `1b36cf8`）。

## [v6.43.1] · 截图识别：门将页行合并去重 + 单入口多选上传 + 提示词 V4（2026-10-11）

**已上线**（2026-10-12，CF Workers Builds 自动部署 Version `30766a68`，push `b5fda14..7a06906`；零迁移、零生产写；线上入口资产与本地重构建逐字节一致、版本串 `6.43.1`）。缘起（用户两条裁决）：①「第一张外场图片常常不能包含所有球员，部分球员数据在门将那一页上，因此应当合并去重」——Goalkeeping 页左表常带 Summary 页滚动条外的后卫与替补，v6.43.0 的 `buildOcrEntries` 在门将页只吃 `gk` 块、左表 rows 全丢弃，这些球员进不了预填；②「可不可以只保留一个上传入口，可多选图片？」——Summary / 门将页两按钮并成一个多选入口。交付：`src/core/growth-ocr.ts` `buildOcrEntries` 两页签都先吃 rows（`pushRows` 提取共用）、goalkeeping 再把 `gk` 块并进门将同人条；端点去 `kind` 请求参数（页签由模型识别结果决定，非两张业务页签仍 502 点名）；前端 `mergeOcrEntries` 逐格三态去重——同值计 `deduped` 不重写、异值保留先填值并出「评分识别 X 与已填 Y 冲突，保留已填值」提示（顺带关死「等待期手填被覆盖」残余口子）；GrowthEntryPage 单一多选入口、逐张**顺序**识别逐张合并（glm-4v-flash 免费档 429 限流，不并行）、单张失败继续下一张、按钮显「识别中 i/n…」进度、报告行逐张给「预填 X 格、去重 Y 格…」；`OCR_PROMPT` V4（新增「左表在两个业务页签下都会出现……rows 都要转录左表可见的全部行，一行不许丢；门将本人也在左表里，他的 RR 就是评分」段 + 规则 1/3 收窄，schema 未动）。验收：typecheck 三份全清、vitest 全量 **114 文件 / 1898 例**全绿（v6.43.0 基线 114/1894）、build 成功；A/B 实测 V4 对 V3 零回退（4 图 × 2 模型 8 次调用行数据 36/36 格全对、gk 五项全对、类型全 number；三个打分 flag 全定性为假象或无消费方采样噪声，见 `memory/spike-v6.43.0-vision.md` 第二轮）；测试计划 `docs/test-plans/v6.43.1-growth-ocr-merge.md`。

## [v6.43.0] · 成长录入截图识别：上传 FC26 赛后截图自动预填（2026-10-11）

**已上线**（2026-10-11 用户令「发布」：push `a3a9e8a..b5fda14` ⇒ CF 自动部署 Version `b2927d42-6669-4590-9682-a05dda102488` @10:07:39Z；上线前置 = 生产已配 `LLM_API_BASE` / `LLM_API_KEY` / `LLM_VISION_MODEL`（智谱 key，`glm-4v-flash`）三件套；回读 health 200、OCR 端点匿名 401、线上入口资产与本地重构建逐字节一致）。零迁移、零生产写。缘起与裁决：用户「探索如何实现更自动化的成长录入」——每场四张 FC26 赛后截图人工逐格录太慢；① 识别通道选**智谱 BigModel**（spike 实测 `glm-4v-flash` 免费、四图两轮 8 次全对（48 格行数据 + 门将五项 100%），`glm-4.1v-thinking-flash` 47/48，17-27s/图；结论落 `memory/spike-v6.43.0-vision.md`）；② 「夺回球权」不识别（左表只有 POS|Name|RR|G|AST，Possession Won 只在右栏选中球员详情，全队拿不到）保持手填；③ 入口 = 管理端成长录入页增强（上传 → 识别 → 预填 → 人工确认保存，写路径复用既有批量补录端点），不做教练端自助、不存 R2。识别只自动化**出场 / 评分 / 零封 / 扑救**四项；进球助攻不预填（自动通道已有）但交叉校验警告。交付：`src/lib/llm.ts` `llmVisionJson`（vision 消息体、temperature 0.1、90s、未配置 503、`extractJsonObject` 尾扫容错）+ `LLM_VISION_MODEL`（缺省回落 `LLM_MODEL`）；`src/core/growth-ocr.ts` 纯函数四件（`parseOcrVision` 宽容解析 / `matchRosterPlayer` 四层认人阶梯 official→折叠→display→折叠、歧义不猜 / `buildOcrEntries`——rating<7.0 只预填出场并警告「7.0 以下不给 XP」、门将 conceded===0 勾零封 / `ocrCrossChecks` 比分双向 + Saves+Conceded=OnTarget 内部一致性）；`POST /api/admin/growth/match-entry/:matchId/ocr`（魔数嗅探 PNG/JPEG + ≤5MB + 页签不符 502 + 队名 foldName 匹配，**零 DB 写零审计**）；前端 `web/src/lib/growth-ocr.ts` `mergeOcrEntries`（只写未锁格、已录格逐格 skipped 带原因、训练营跳过、duelsWon 永不写）+ GrowthEntryPage 上传识别卡 + 零封场手填夺回球权自动勾该行零封（m00084「有手填的即为防守球员」）。验收：typecheck 三份全清、新测试 24 例 + 全量 **114 文件 / 1894 例**全绿（基线 111/1866）、build 成功、e2e **25/25**、变异 **6 处全命中**；提交 `20853b0`（13 文件 +1319/−7）+ 评审修复 `4b84c99`——code-review 修 1 个 🟡（`runOcr` 以发起那一刻的 rows 快照为合并基底，识别 13-90 秒期间的手填会被响应覆盖 ⇒ `rowsRef` 同步镜像 + 写点统一 `setRowsTracked`），nit 4 条登记不改。**提示词打磨（同日追加，未 bump）**：`OCR_PROMPT` 按 prompt-master 重构并 A/B 实测——V3 采纳版（关键约束前置 + 全键必填 + GK 自检锚 + schema 带真实数字示例行、数字一律 JSON number）8 次调用行数据 48/48 格全对且类型统一，详见 `memory/spike-v6.43.0-vision.md`。**生产待办**：`wrangler secret put LLM_API_BASE / LLM_API_KEY / LLM_VISION_MODEL`（用户自备智谱 key；未配 = 503 旁路，手填照旧，识别可绕过）；免费档 429 限流时把 `LLM_VISION_MODEL` 换 `glm-4.1v-thinking-flash`。

## [v6.42.0] · 夺回球权 / 扑救改跨场累计入账（2026-10-11）

**已上线**（2026-10-11 随 v6.43.0 同批 push 上线，Version `b2927d42-6669-4590-9682-a05dda102488`）。零迁移、零生产写。缘起：用户给规则原文要求核查引擎——(6) 夺回球权（仅防守球员）**每 12 次 1 点**、(7) 扑救（仅门将）**每 8 次 1 点、单场多于 8 次额外得 1**，均为**跨场累计**且 (7) 两部分独立；实现 `xpForEvent` 把两项都按单场值算，累计从未成立（核查表 (1)-(5) 全符，(6)(7) 是唯一实质缺口）。生产只读摸底：`growth_events` 里 `duels_won` / `saves` **零行**，无历史账要重算。交付：`xpForEvent` 加第三参 `base=0`（duels = `floor((base+value)/12) − floor(base/12)`，saves 同式 K=8 + `(value>8?1:0)`——单场跨档自动连跨、加成只看本场值、其余类型不累计）；`manualEventOf` duels 收**非负整数**（0 = 确认防守球员）并**撤「算出 0 XP 直接拒」**（不足一档是合法 0 XP 行；saves 仍正整数）；`loadCumulativeBases`（SUM 历史 duels_won+saves）单/批端点传基数；面板花名册加 `duelsTotal`/`savesTotal`（含本场已录行，前端基数 = 总数 − 已录值防重复累计）；前端 `growth-xp.ts` 重写同口径 + 录入页基数接线与「历史累计 N 次」提示。验收：三份测试 56 例全绿（TC-BATCH-04/08 改写 + TC-BATCH-10 跨场累计）、变异 **3 处全命中**、typecheck 三份全清、vitest 全量绿（收口轮 111 文件）；提交 `46010d4`（9 文件 +175/−40）。教训：改「累计」规则先改断言口径（旧例「不足一档拒收」就是错口径的实现镜像）；`seedEvent` 不碰 `growth_xp`，跨场用例须自造历史行。

## [v6.41.0] · 顶栏右上角 ≡ 菜单：显示时区 + 退出登录收进同一弹层（2026-10-11）

**已上线**（2026-10-11：`git push` `a386cb1..a3a9e8a` 5 枚 ⇒ CF Workers Builds **Version `c218ff1b-935a-422e-84d1-32c04ba05d97`** @2026-10-11T05:23:19.086Z、`wrangler deployments status` **100%**、**无迁移**；回读线上 `assets/index-BOIhKxZm.js`（sha256 `1b7e2474c70112e32be6691f0d82469a6ead36d531e21443f06e864eb04e0838`）与 `assets/index-9zVDH5dV.css`（`0ffb44f33f34e0319630fbfec10de75409406975d475ec6c34fd48086f347633`）**与本地 `web/dist` 逐字节一致**、页脚渲染 `· v6.41.0`、包内旧 `tz-btn` 0 处，实渲染菜单与本地 e2e 同形，375 几何 `按钮右缘 348 / clientW 360 / scrollW 360 / 弹层右缘 348`；用户 m07093「将topbar的退出登录和时区调整放到右上角菜单中，菜单图标是≡」+ 同轮追加「计划对其他仓也实施相似改动，本仓完成后生成提示词」）。纯前端收纳重构，**零后端改动、零迁移、零生产写**：`/api/me`、`/api/auth/logout`、`localStorage['whl.tz']` 与 `whl:tz-change` 事件链一字不动。**缘起**：v6.25.0 起「显示时区」是顶栏一枚平铺下拉、退出登录是用户区里一枚平铺表单，两件低频控件常年占着首行位置。**交付**：① `web/src/components/TopBar.tsx` —— `tzOpen/tzRef` 改名 `menuOpen/menuRef`（外点 / Esc 关闭 effect 原样），用户三态条件块（收件篮 / 用户名 / 超管 / 角色徽标；**登出表单已从块内删除**）之后**平级**新增 `.user-menu-wrap`（**未登录也渲染**——时区对公开页生效是 v6.25.0 的既有约束），按钮 `aria-label="菜单"` + `aria-haspopup="menu"` + `aria-expanded`、`title` 带当前档（`菜单（显示时区：北京时间）`），弹层 `role="menu"` = 小标题「显示时区：…」+ 三档 `role="menuitemradio"`（当前档前缀 `✓ `，点选即 `setTzPref` 并收起）+ 分隔线 + 仅 `user && authMode === 'oidc'` 渲染的原生表单登出（`role="menuitem"`）；② `web/src/styles.css` —— `.tz-wrap/.tz-btn/.tz-pop` 整体改名 `.user-menu-wrap/.user-menu-btn/.user-menu`（`right: 0` 右锚不变；`min-width` 132→**148**，理由是小标题「显示时区：北京时间」11 个全角字符在 132 下会折行），新增 `.user-menu-head` / `.user-menu-sep` / `.user-menu form { margin: 0 }`（登出原生表单不撑高弹层）；③ `scripts/e2e/smoke.mjs` ⑰ 改选择器并补 375 几何 + 最坏情况探针；④ 新增 `web/src/components/TopBar.test.tsx` 6 例与 `tests/mobile-baseline.test.ts` 静态锁 TC-MENU-11/12/13。**不变量**：菜单对所有人渲染（在三态条件之后）；登出只在「已登录 + OIDC」（兼容模式不给假入口）；登出仍是原生表单整页 POST（302 链由浏览器跟随、后端顺带吊销本地会话并清 cookie）；时区口径与事件链不动；零残留（顶栏不再有 `.tz-btn`/`.tz-pop`/`.tz-wrap`，用户区直下不再有登出表单）；弹层右锚 `right: 0`。**验收**：typecheck 三份 tsconfig 0 error；vitest **111 文件 / 1866 例**全绿（改前基线 110/1857，净增 1 文件 + 9 例 = TopBar.test.tsx 6 + mobile-baseline 3）；`npm run build` 成功（bump 前 `assets/index-BBh3OHQ_.js`，e2e 跑在它上面；bump 6.41.0 后重建 `assets/index-BOIhKxZm.js`，体积与 gzip 完全相同 650.15 kB / 206.23 kB——只差内嵌版本串）；e2e **25/25**（含改写后的 ⑰）；变异 M1–M3 实测（M1 把登出表单搬回用户区顶部 ⇒ TC-MENU-12 红 / 11·13 绿；M2 删 `aria-haspopup="menu"` ⇒ TC-MENU-11 红；M3 CSS `right: 0`→`-40px` 且 `.user-menu form` 的 `margin: 0`→`8px 0` ⇒ TC-MENU-13 红）；测试计划 `docs/test-plans/v6.41.0-topbar-user-menu.md`。**375 实测与最坏情况口径**：⑰ 探针实测 `≡ 按钮右缘 348/375、userbox 宽 131、文档宽 360、弹层右缘 348`（无横向溢出）；把退役的登出按钮按旧样式塞回用户区再量，`占 72px（userbox 131→211）、文档宽仍 360/375、用户名宽 57→57` ⇒ **旧布局在 375 下并没有溢出**（它靠吃首行空档），本次收益是「收掉低频控件 + 让出 72px 首行余量」而非「修掉溢出」。**教训**：① 组件测试按 `role` 找元素，把菜单挪进登录态条件里、或把登出搬回平铺，组件测试**仍会绿** ⇒ 形态类约束必须另加文本扫描闸门（本版 TC-MENU-11/12/13）；② Windows 文件是 CRLF，`node -e` 里按 `\n` 拼字面量做替换会静默失配 ⇒ 用正则定位；③ 判定 dev 是否在跑要 `curl --noproxy '*'`（本机代理会把 localhost 也代理走，8791 上看到的是假 502）；④ 生产回读时浏览器自动化对这枚按钮的**真实指针点击**不生效（Playwright `locator.click()` 超时、坐标点击无反应；`elementFromPoint` 证实按钮无遮挡）⇒ 行为回读改直调 React `onClick` 完成——判为自动化环境限制而非产品问题（同一份源码在本机 e2e ⑰ 用真实点击跑通 25/25，且线上字节与本地逐字节一致）。**待办**：无（已上线；其他仓的同款改动走另出的提示词）。

## [v6.40.2] · 谈判桌开桌即读 + 读路径往返压缩（结算合并 / 写路径先结算 / 批量合并 / 认证探针合一 / 索引 0067）+ 顶栏「转会中心」双文案（2026-10-09）

**已上线**（2026-10-10；用户 m05396「头脑风暴修复 1 宽屏的转会中心 topbar 被错误地改名为转会中心；2 摊开转会谈判桌的等待时间过长」→ m05512「再仔细检查想想还有没有性能优化的空间」→ m05561「甲乙丙」批准三段：甲 客户端 / 乙 服务端 / 丙 索引迁移）。**性能基线（改前生产实测）**：`GET /api/market/listings?status=active` 均值 ≈**3.955s**（3.208–4.986s，3 次独立连接）、`GET /api/health`（3 条 D1）≈**1.894s**、`GET /`（静态地板）≈1.1s ⇒ 拟合出**地板 ≈1.1s + 约 220ms/每条 D1 语句**，主导项是**往返条数**而非数据量（生产 offers 8 / listings 0 / bids 0；`served_by_colo: KIX`、`sql_duration_ms 1.24`）；往返账：详情 **13** 条、列表 **14** 条、开桌（详情 + 底价设置）≈**26** 条 ≈ 5.7s。**缘起（修复①）**：v6.37.2 为窄屏收纳引入 `.nav-tf`/`.nav-ts` 双文案时，`/market` 这一条被写成裸文本「转会」⇒ 桌面（>640px）也显短文案（其余 6 项都是双 span，`aria-label` 一直是「转会中心」故测试全绿）；**缘起（修复②）**：点「谈判桌」后浮层立即挂载但内容被 `loading` 门住（「正在摊开谈判桌…」），详情请求冷发（`useOfferDetail` 无 `placeholderData`）、底价设置还要等详情回来才发（`settingsPlayerId` 取自 `deskOffer.role`）⇒ 两趟串行 + 无播种。**交付**：**甲（客户端，开桌即读）**① `OffersSection.tsx` 新增模块级 `seedFromList(list.data, id)`——用列表行 + 顶层 `club` 拼 `OfferDetailResponse` 当占位（`buyerClub`/`sellerClub` 按 `role` 分配、`season`/`windowSeq` 置 0、`resolvedAt` null、`events: []`）；② `web/src/lib/queries.ts` 抽 `offerDetailQuery(id)` 描述符，`useOfferDetail(id, enabled, seed?)` 挂 `placeholderData: seed ?? undefined`（TanStack 5 的 placeholder **不进缓存**，键 `qk.offer(id)` 与行为不变）；③ 底价设置自动并行（零代码——`role` 来自列表行，播种后同帧有值）；④ 行尾按钮加 `onPointerEnter`/`onFocus` → `qc.prefetchQuery(offerDetailQuery(o.id))`；⑤ `OfferDesk` 加 `eventsLoading` prop，事件区空态改三态（「正在读取谈判记录…」/「谈判记录没读出来，重开一次可以再试。」/「这一单还没有事件记录。」）。**乙（服务端，压往返）**① `settleOverdue` 增 opt-in `coalesceMs`——模块级在飞 Promise + 上次 summary + 30s 窗口（不传/≤0/显式 `now` 永远真跑；cron、关窗、写路径都不传），四个只读入口（`GET /api/offers`、`GET /api/offers/:id`、`GET /api/market/listings`、`GET /api/market/listings/:id`）传 `30_000`；顺带给 `GET /api/market/listings` 补 `assertPublicRate(c, 'market')`（此前既无鉴权又整跑结算，匿名可放大）；② 写路径先真结算——`src/worker/routes/offers.ts` 五个写端点（POST /offers、counter、accept、reject、withdraw）与 `POST /api/market/listings` 动作前 `await settleOverdue(c.env, { origin: 'user' })`（到期/失效单先收口，动作随后被拒）；③ 批量合并——结算三段扫描（expired / remnants / matchExpired）合一次 `db.batch`（前提：前两段按「有无出价」互斥、第三段新建行的 `match_deadline` 恒在未来 ⇒ 互不可生；`active` 扫与 broken 自愈扫保持单独，它们读前段所写；`expireStaleOffers` 两扫**不合批**——第二扫带「同球员已有生效挂牌」子查询而第一扫循环会建挂牌行）、详情（主查询 + 事件）与列表（主查询 + 两计数）各合一批；配套把 `tests/d1.ts` 的假 D1 从「只回 `{meta:{changes}}`」扩成每条回 `{results, meta}`（与真实 `D1Result[]` 对齐）；④ 认证两探针合一——`src/worker/binding.ts` 的 `hasTeamBinding` + `boundClubId` 合成按 `Request` 记忆化的 `getTeamBinding(env, request, userId) → {bound, clubId}`（`LEFT JOIN team` 保住「绑了但 team 行缺失」⇒ `bound=true`/`clubId=null`；失败不缓存），全仓 `getBoundClub(c.env, user.id)` 调用点补传 `c.req.raw`（唯一例外 `src/worker/routes/admin/clubs.ts:603`——那里的 userId 是目标用户、不是会话用户）。**丙（索引）**：迁移 `src/db/migrations/0067_settle_scan_indexes.sql` 三条 `CREATE INDEX`（`idx_offers_status_id` / `idx_listings_status_type_activation_deadline` / `idx_listings_status_type_match_deadline`），**只加索引、无表结构变更、无回填**，`tests/d1.ts` 的 `MIGRATION_FILES` 同步登记。**不变量（回归锁）**：凡带 `aria-label` 的顶栏项都是 `.nav-tf` + `.nav-ts` 双 span（桌面显全称 / ≤640 显短文案，CSS 两条显隐规则成对）；开桌单据头只用列表行已有字段、事件区未到必须显占位句（不得显「还没有事件记录」）；`placeholderData` 不进缓存；合并只对只读入口生效（写路径与 cron 永远真跑）；合批不改结算语义；认证探针合一不改「绑了但 team 行缺失」的语义。**回归闸门**：`tests/settle-coalesce.test.ts`（新建 5 例，计数版 D1：TC-SETTLE-01 合并命中 / TC-SETTLE-02 单飞 / TC-SETTLE-03 写路径先真结算 / TC-BUDGET-01 详情冷读 ≤8、列表冷读 ≤8、命中 ≤4）+ `web/src/pages/market/desk/OffersSection.test.tsx` 29 例（净增 TC-DESK-11 详情悬置即读 / 12 底价并行 / 13 深链仍骨架 / 14 悬停预取）+ `tests/mobile-baseline.test.ts` 33 例（净增 TC-TOPBAR-01 双 span 静态锁 / 01b CSS 成对）+ e2e 1440 档 `innerText === '转会中心'`、375 档 `=== '转会'`。**验收**：typecheck 三份 tsconfig **0 error**；vitest **110 文件 / 1857 例**全绿（改前基线 109 / 1843）；`npm run build` 成功（`index-C1zLN69G.js` 649.98 kB / `MarketDeskPage-Cc134CEE.js` 32.00 kB）；e2e **25/25**；变异 M1–M6 实测（M1 去 `coalesceMs` ⇒ 4 红；M2 去在飞共享 ⇒ 仅 TC-SETTLE-02 红；M3 去 accept 写路径结算 ⇒ TC-SETTLE-03 红；M4 详情 batch 拆两条 await ⇒ 详情预算红、列表绿；M5 顶栏退回裸「转会」⇒ 静态守卫红 + 变异 build 浏览器探针 `{"wide":"转会"}`（断言必红）；M6 抽 `placeholderData` ⇒ TC-DESK-11/12 红）。**测试计划**：`docs/test-plans/v6.40.2-desk-open-latency.md`。**评审登记**：开桌不做事件流乐观渲染（轮次归属只能由服务端算，猜错会撒谎）；30s 窗口的时效由「写路径必真结算」兜住；不用 env 开关/WeakMap(env) 键控（前者要给 52 个夹具逐个加配置，后者生产 env 是否按请求重建不确定）⇒ 取仓内 `resetGuards` 同款「模块级状态 + `resetSettleCoalesce()` 挂在 `createTestD1()`」；`admin/clubs.ts` 的 `getBoundClub` 保持不传 request。**教训**：① 性能问题的第一刀是**数往返**而不是读代码——220ms/条的算术拟合一眼看出「13 条 vs 4 条」才是病根（数据量只有 8 行）；② 模块级状态一旦引入就会污染同进程用例（乙-1 落地后全量 vitest 5 文件 42 例红，单跑却绿），清零出口要挂在**所有夹具都经过的地方**（`createTestD1`）而不是逐个测试文件；③ 合批前必须逐条确认「后扫是否读前扫所写」（`expireStaleOffers` 两扫因此不能合，market-settle 的 `active` 扫同理）；④ 跨层「同类探针」重复查询是隐性往返大户（认证两探针合一省掉每请求一次跨库读）。**上线（2026-10-10）**：迁移 `npx wrangler d1 migrations apply whl-club --remote` ⇒ `0067_settle_scan_indexes.sql` **✅**（Executed 4 commands in 2.15ms；`migrations list --remote` ⇒ `✅ No migrations to apply!`；三条索引经 `sqlite_master` 查证在场）；push `7e84420..a386cb1`（6 枚，含前两轮遗留 `85f56a2` / `d1ba7b0`）⇒ CF Workers Builds **Version `3ea21cee-b787-48bd-b1d1-2aca0918f19e`** @2026-10-10T04:46:26.190Z（`deployments status` 100%）。**上线回读（经自定义域名 `https://club.whleague.win`）**：入口 `assets/index-C1zLN69G.js` sha256 `4be30579682e63290c6a0f45482b3e305042906c9f876775a7fb37670a119b05`、`assets/index-DmzAlzoh.css` `4a63b71c289fecb5bb7b1eeed2f0dd0bcb45a801b6d2000296592064c68f3af3`、路由块 `assets/MarketDeskPage-Cc134CEE.js` `f6a5df9d8178bb76256730b89f593ab8cf74ab8755734130885c2cda16e88ce5` —— 三份与本地 `web/dist` **逐字节一致**；包内版本串 `6.40.2`；`nav-tf`/`nav-ts` 各 **7** 处（7 条带 `aria-label` 的顶栏项都是双 span）；desk chunk 新文案「正在读取谈判记录」/「谈判记录没读出来」各 1；CSS 三条显隐规则在线；接口 `/api/health` 200、`/api/clubs?limit=1` 200、`/api/offers?box=in` / `/api/offers/1` / `/api/negotiations?mine=1` / `POST /api/offers/1/withdraw` 全 401（路由在场、鉴权生效）、`GET /api/offers/1/withdraw` 404（只有 POST，符合预期）。**性能改前/改后对照（同法匿名 curl）**：`listings active` 改前 5 次 4.221/3.870/3.551/5.084/3.803s（均值 **4.106s**）⇒ 改后 26 次采样均值 **2.172s**（**1.89×**），其中**命中合并 14 次**均值 **1.298s**（最快 1.180s）、**未命中 12 次**均值 **3.190s**（仍优于改前，来自三段合批与 0067 索引）；`health` 1.665/1.540/1.494s（对照项，未动该路径）；`rumors` 3.269s / `players` 2.164s（当日网络略慢于基线日 ⇒ 上述改后偏保守）。**isolate 级合并（上线复核结论）**：`cf-ray` 十连发全部落在同一 colo（AMS），但命中/未命中仍在**同一 colo 内交替** ⇒ 模块级合并状态是 **isolate 级**，CF 同 colo 可并发多个 isolate（或空闲即回收），实测命中率 **14/26 ≈ 54%**；这是**尽力而为**的优化（正确性不依赖它——写路径、cron、关窗永远真跑），实现已复核无缺陷（在飞共享、成功才记 `settleLastAt`、`finally` 清在飞）。**待办**：无（发布与回读完成；观察项：低流量下合并命中率受 isolate 复用影响）。明确不做：私有响应进 Cache API、会话/绑定跨请求缓存、底价设置折进详情、改 cron 频次、动结算规则本身、深链预取端点。

## [v6.40.1] · 报价谈判桌角色契约订正（详情 `myRole` 键名漂移 ⇒ 卖方被当买方）+ 动作栏按角色收敛（越权颗不渲染）+ 同意按钮文案（2026-10-09）

**已上线**（2026-10-09 发布，用户令 m05132「发布」；push `6da17ec..7e84420`（4 枚：`e2c7082` 上批 v6.40.0 同版本补充发布记录回写 + 本批 `7306137` 契约订正 / `a8a09d8` 测试 / `7e84420` docs 收口）触发 CF 自动部署，生产 Version **`dc788500-3ef3-4f16-8b82-2871de122188`** @2026-10-09T11:13:40Z；回读经自定义域名 `https://club.whleague.win` 全过——入口 `index-B3EHNjsn.js`（sha256 `928c7533…`）/ `index-DmzAlzoh.css`（`4a63b71c…`）与本地构建**逐字节一致**，路由块 `MarketDeskPage-BqxaQTLr.js`（`c85ec167…`）同 sha256 且新文案在线（同意并挂牌 ×1 / 挂意向单 ×3 / 撤回意向 ×3 / 这一单已经了结 ×4），旧文案已清零（`只有买方能撤回` 0 次、`同意（` 0 次），CSS 新规则 `.nego-actions>.btn:last-child:nth-child(odd){grid-column:1 / -1}` 在线，包内版本串 `6.40.1`，`/api/offers?box=in`·`/api/offers/1`·`POST /api/offers/1/withdraw` 匿名 401（路由在场、非 404）而 `/api/health`·`/api/clubs?limit=1` 200，`d1 migrations list whl-club --remote` ⇒ `No migrations to apply!`。零迁移、零生产写、零新端点——改一处响应键名 + 前端交互收敛）。**缘起**：用户 m04521「为什么我是卖家，但 撤回报价是亮的？？？？」（附图：手机端谈判桌浮层，当前有效价 10m（首报 10m · R0）/ 买方 皇家马德里 / 卖家 里昂 / 轮到谁 你 / 四颗按钮 还价、同意（10m，同意即挂牌）、拒绝、撤回报价）→ 追问「那么为什么我作为卖家，拒绝按钮是不可点的」→ 中途插入「同意按钮文案改成：同意并挂牌/挂意向单（根据状态不同选不同文案）·报价」。**根因不是置灰观感，是跨层键名漂移**：worker 详情接口 `GET /api/offers/:id` 发的是 `myRole`（`src/worker/routes/offers.ts:202`），而列表接口每行发的是 `role`（同文件 :111）；前端类型 `OfferDetailResponse.offer` 继承 `OfferListItem`（`web/src/lib/api.ts:2011` 声明 `role: 'buyer' | 'seller'`）⇒ `web/src/pages/market/desk/OffersSection.tsx:448` 的 `offer?.role === 'seller'` 运行期恒 `undefined` ⇒ **所有人被当买方**：卖方「拒绝」恒灰（用户问题 2）、「撤回报价」恒亮（问题 1），连带意向单态卖方无法确认挂牌、卖方底价/自动同意永不显示、气泡左右镜像；买方视角恰好看起来正常，故一直没被发现。**为什么三层测试全绿**：组件夹具与 e2e 夹具都自己写 `role`（与前端错误读法同形 ⇒ 组件层 `seller` 为真）、worker 集成只断言 `myRole`（服务端自洽），**没有任何一层把两侧键名对照过**。**交付**：① `src/worker/routes/offers.ts:204` 键改 `role: myRole,`（与列表同名同义，前端与两套夹具零改动即变真，附注释说明）；② `OffersSection.tsx` 动作栏由「四颗恒在 + 置灰 + `title`」改为按 角色×状态 收敛——新增 `buyer`、`canWithdraw = buyer && (pending || intent)`、渲染门 `showAccept = !intent || seller`、拒绝包 `{seller && …}`、撤回包 `{buyer && …}`，并补可见理由 `counterWhy` / `acceptWhy`（原来只有 `title`，触屏永不显示）；③ 同意按钮文案改 `同意并挂牌（Xm）`（待回复单）/ `挂意向单（Xm）`（意向单态，服务端动作仍是 `acceptOffer` 的确认挂牌）；④ `web/src/styles.css` 新增 `.nego-actions > .btn:last-child:nth-child(odd) { grid-column: 1 / -1; }`（三颗时末颗占满整行，不与第一颗挤同格）。**动作矩阵**：卖方待回复单 = 还价（轮到我才亮）/ 同意并挂牌 / 拒绝（任意轮次可点，撤回报价不渲染）；买方待回复单 = 还价 / 同意并挂牌 / 撤回报价（拒绝不渲染）；卖方意向单 = 还价（恒灰）/ 挂意向单 / 放弃；买方意向单 = 还价（恒灰）/ 撤回意向；了结单 = 留下的颗全灰（`title` 这一单已经了结）。**不变量**：详情 `role` 与列表同名同义且响应里不再出现 `myRole`（契约门 `expect('myRole' in d.offer).toBe(false)`）；前端收敛只改观感、**服务端权限一字不动**（`rejectOffer` 非卖方 403「只有卖方能拒绝；买方要终止请用撤回」/ `withdrawOffer` 非买方 403「只有买方能撤回报价」/ `acceptOffer` 意向单只有卖方确认挂牌 409）；气泡左右归位以「自己那一队」为基准；金额整数档 `moneyIntText(12.5)` 渲染 `12.5m`。**回归闸门**：`tests/offers.test.ts` 契约门 + `web/src/pages/market/desk/OffersSection.test.tsx` 25 例（动作矩阵逐字锁 6 格 / 气泡左右归位 / 买卖两视角 / 卖方拒绝可点回归门 / 了结单两角色镜像例 / StrictMode 门）+ e2e ⑤c 两视角（卖方 3 颗 + 拒绝 `isEnabled` + 末颗 `grid-column` 计算值 `1/-1`；买方 3 颗 + 撤回报价 `isEnabled` + 还价 `isDisabled` + `.nego-b` 首条 `me`）。**验收**：typecheck 三份 tsconfig 0 error；vitest **109 文件 / 1846 例**全绿（v6.40.0 收口基线 108 / 1812；评审后 1846 = 评审前 1845 + 了结单买方镜像例 1）；`npm run build` 成功（`index-CxX1NWhD.js` / `MarketDeskPage-Cye7qedj.js`；发布前含 `:10` 头注释订正重建 ⇒ `index-B3EHNjsn.js` / `MarketDeskPage-BqxaQTLr.js`，即线上产物）；e2e **25/25**；变异 M1–M5 实测（M1 键名回退 ⇒ worker 红 1；M2 `seller = true` ⇒ 组件红 4 + **e2e ⑤c 红**；M3 气泡判据反转 ⇒ 红 2；M4 文案回退 ⇒ 红 4；M5 等价改写渲染门 ⇒ 全绿 24/24）。**测试计划**：`docs/test-plans/v6.40.1-offer-role-contract.md`（取代 `v6.40.0-nego-chat-ui.md` 的「动作栏固定四颗」口径——那次拍板是在漂移 bug 生效期间做出的，用户看过根因后改拍「越权那颗直接隐藏」）。**评审**（code-review-skill 全量，2026-10-09）：**可发布、阻塞项 0**；2 medium + 6 low 全部登记在测试计划 §七——① M1「settled 买方仍渲染恒灰的『撤回报价』」处置为**保留代码**（R1 的「不渲染」只针对**角色**，状态不满足走置灰；与卖方 settled 三颗全灰对称）+ 订正计划表 settled 两行 + 补买方 settled 镜像例（原先只有卖方例，那条 `撤回报价 === null` 是靠角色门命中的假绿）；② M2「意向单态按钮文案『挂意向单』与服务端动作（确认挂牌）打架」按用户原话保留并登记一行改法；③ low 六条（`canAccept` 无窗口状态输入 ⇒ 窗未开时服务端 409 而前端可点、e2e 详情桩只特判 id=4、注释/文档漂移三处已修、计划原写「原 12 例」实为 HEAD 22 例已订正、矩阵默认事件夹具不自洽、计划文件同批入库）。**教训**：① 跨层键名漂移 + 夹具自证会让三层测试同时失效，契约门必须落在「响应里不许出现旧键」这一侧（只断言新键在场挡不住改名）；② 跑 e2e 前先确认 8791 只有单一 dev server——Windows 允许同端口多监听，残留实例持旧资产清单 ⇒ 模块脚本返回 `text/html` ⇒ 首轮 e2e 仅 4/25（清掉全部 `npm run dev` 链后单实例重启即 25/25）；③ `moneyIntText` 自带 `m` 且有小数就带小数（`12.5m`），e2e 正则须容小数；④ 断言要盯住「门是哪一个」——同一条 `toBeNull()` 可能被角色门与状态门双双满足，只补镜像夹具才能证明锁的是哪一道。**待办**：`OfferDetailResponse.counterpart` 类型声明了但详情不返回（无人读）；intent 态「还价」置灰只有 `title` 无可见理由；意向单态「挂意向单」与动作语义（确认挂牌）的偏差按用户原话保留（口径歧义：也可能被读作「窗未开时同意」，若如此则应按**窗口状态**而非单据状态选文案）。

## [v6.40.0] · 站内信徽章（30 模板 × 八类类目）+ 类目页签与「本类全部已读」+ 整行跳转（ref 精确 / 类目兜底）+ 见过即已读 + 收件篮窄屏两行卡（2026-10-09）

**已上线**（2026-10-09 发布，用户令 m04432「发布」；push `74540bc..c894914`（4 枚：v6.39.3 上线回写 + 本版三枚）触发 CF 自动部署，生产 Version **`20753413-e7b9-4330-ab1c-8e7552a362c0`** @2026-10-09T01:27:33Z；回读经自定义域名 `https://club.whleague.win` 全过——入口 `index-BfG4c2cV.js` / `index-CvaBN-D4.css` 与本地构建 sha256 逐字节一致、包内版本串 `6.40.0`、窄屏两行卡规则（`.inbox-row{display:grid;grid-template-areas:"head time go" "text text text";min-height:44px}`）与徽章文案逐字在线、路由块 `MarketDeskPage-uPkjwtTx.js` 同 sha256 且含「不在当前列表里」、`/api/health`·`/api/clubs`·`/api/players?limit=1`·`/api/market/deals` 200 而四个站内信端点匿名 401（路由在场）、`d1 migrations list` ⇒ `No migrations to apply!`。零迁移、零生产写、零新端点——只扩既有端点契约）。**缘起**：用户 m03242「脑暴下一个功能，给所有类型的站内信分配徽章，并实现跳转功能，以及窄屏显示优化」；四条拍板（m03254 答）——① 徽章模板一一对应但配色切成八类；② 跳转「类目落点 + 有据时精确」；③ 整行跳转、已读改「见过即已读」；④ 窄屏重点＝页签筛选 / 徽章与时间重排 / 未读置顶与日期分组 / 两行卡片加高点击区，且页签与未读置顶桌面端同样生效。**判级 minor**（两处用户可见新能力 + 一条既有语义变更）。**交付**：① 新 `src/core/notify-meta.ts`——`NOTIFY_CATEGORIES` 八类（result 赛果 green / growth 成长 gold / offer 报价 blue / activation 激活 sky / event 事件 orange / naming 命名 purple / shop 商城 red / window 窗口 gray）+ `NOTIFY_META` 30 条模板中文 label + `categoryOf` / `templatesOf`（服务端筛选与前端徽章同源，不手抄第二份清单）+ `notificationRefOf`（按 data 抽 `offerId` / `playerId` / `orderId`，只造 UI 真能定位的三型 ref；`event_*` / `naming_*` / `window_signals` 刻意不造）；② worker——通知载荷扩为 `{text, ref?}`（`src/worker/activations.ts` / `growth.ts` / `market-settle.ts` / `notify.ts` / `offers.ts` / `shop-ops.ts` / `routes/market.ts` 各生成点补实体 id），列表 item 增 `clubId` / `ref`，`GET /api/notifications?category=` 只筛本类（`template IN (…)` 参数化，非法类目 400 不静默退全量），`GET /api/notifications/unread-count?by=category` 给 `byCategory`（`GROUP BY template` 后在 JS 用 `categoryOf` 归并），`POST /api/notifications/read {all, category}` 只清本类；**既有语义不破**——列表 `unread` 仍是全量口径（顶栏红点同源）、游标语义不变（满页 + 第 31 行才给 `nextCursor`）、不带 `?by` 时返回体与旧版逐字一致；③ 前端——新 `web/src/lib/notify-links.ts`（ref 精确落点 → 类目固定落点 → `null`（整行不可点）；需要 `clubId` 的行没有就返 `null`，绝不猜）；`web/src/pages/Notifications.tsx` 重做：八类页签 + 徽章（中文 label + 类目色 + `title` 挂原始模板名）+ 未读置顶与日期分组（今天 / 昨天 / YYYY-MM-DD）+ 整行按钮跳转 + 见过即已读（IntersectionObserver 预读约 120px；标已读不回改本页视觉，避免刚滚过就跳位闪烁；无 IO 环境退化为渲染即标记）；`OffersSection` 吃 `?offer=` 直接开谈判桌、`ShopPage` 吃 `?order=` 展开工单并 `.is-target` 高亮，目标不在已载入列表时出提示条而不是静默；④ 窄屏 ≤640 收件篮两行卡（第 1 行徽章 + 时间右对齐、第 2 行正文满宽，行点击区 ≥44px）。**回归闸门**：`src/core/notify-meta.test.ts`（12 例，含 8 类顺序/配色与「8 类 × 30 模板成员表」两处**字面量锁**）、`web/src/lib/notify-links.test.ts`（10 例）、`web/src/pages/Notifications.test.tsx`（13 例）、`tests/notify.test.ts`（16 例，API 契约 TC-API-01–06）、`web/src/pages/shop/ShopPage.test.tsx`（3 例）、`web/src/pages/market/desk/OffersSection.test.tsx`（12 例，含 StrictMode 回归门）、`tests/mobile-baseline.test.ts` TC-NB-STR-01/02/03 静态门、`tests/core-zero-import.test.ts`（`src/core/notify-meta.ts` 入纯数据模块表，防 env/hono 拖进前端 bundle）、e2e 新增 ⑳ 段（四行种子：徽章文案/配色/可点性/日期分组 + 刷新后未读点消失 + 三条跳转 URL + 375 两行网格几何）。**验收**：typecheck 三份 tsconfig 0 error；vitest **108 文件 / 1812 例**全绿（开工前基线 104 / 1744；1812 = 评审修复前 1811 + StrictMode 回归门 1 例）；`npm run build` 成功；e2e **25/25**（⑫ 全路由 375 扫描含 `/notifications` 360/375 零溢出）；变异 M1–M5 实测（M1 红 2 / M2 红 5 / M3 红 3 / M4 红 2 / M5 等价全绿）；L6 读量探针（`scripts/d1-read-audit/probe-notify-category.mjs`，生产只读）**裁决不建迁移 0066**——最坏 27 行/次（未读最多的用户走 `GROUP BY template` 出 `USE TEMP B-TREE`），远低于 README §5.4 的 1,000 行/次验收线，且 `template IN` 实测是残差谓词（9 槽 → 1 槽读量不变）。测试计划 `docs/test-plans/v6.40.0-notification-badges.md`。**教训**：① 组件测试的期望值不许从被测常量现算——`Notifications.test.tsx` 原写 `const tone = NOTIFY_CATEGORIES.find((c) => c.id === meta.category)!.tone`，挪类目/换色都抓不到（变异 M2 首轮组件全绿即此），改字面量 `TONE` 表 + 8 枚代表对后同一变异红 5；② 变异预期按实测订正：M1 只红 2（TC-LINK-01 / TC-JUMP-01 吃的是现成 ref、不经 `notificationRefOf`）、M4 的 TC-CAT-01 不可达（`by=category` 不走 `categoryCond`，组件测试也看不到服务端 SQL）；③ 探针标签别借 surface 名——同一 SQL 形状在多 surface 重复会串位，按 SQL 形状命名（会话查询 / 列表 / 未读数 / 标已读）；④ 几何断言并入 e2e 比另起打桩探针更省也更真（375 两行直接量 `gridTemplateAreas`）。**待办**：`?listing=` 激活页精确落点（激活页列表实体是球员、无工单/挂单实体，现走 `ref:{player}` 跳 `/players/<id>`）、TopBar 未读红点（只有点无数字，不动）、QQ/FEISHU 渠道文案与推送/邮件。

**同版本补充 · 报价/签约谈判对话式改造（含 R1 拒绝摆明面）**：缘起用户令 m04806「报价谈判系统UI显示改为对话式，新增拒绝报价功能。新UI需要通过visual companion定稿」；布局 B（清单不动 + 对话浮层）与拒绝语义 R1（规则不动、只把「拒绝」摆到明面）经 companion v1 屏点选定稿，实施级细节经 v2/v3/v4 屏三轮复审，D1 甲（逐轮反馈落库）/ D2 甲（还价带附言）/ D4 乙（抽共享浮层壳）与四档边界 0.2 / 0.5 / 0.8 由用户 m05270 / m05348 拍板；用户 m05439「并且合并到6.40.0」⇒ 视同本版一起上线（`package.json` 保持 6.40.0 不 bump）。**交付**：① `web/src/lib/useOverlayShell.ts` 收编浮层壳（锁背景滚动 / Esc / Tab 循环 / 焦点归位）唯一出处，`web/src/pages/player/ComparePickerOverlay.tsx` 与 `web/src/pages/market/MarketListingOverlay.tsx` 改接，删掉自认的第三份副本；② 报价页签改对话式「谈判桌」浮层（桌面居中 / ≤760px 底部抽屉，复用 `.mkt-ov` 那套）：单据头（**卖方**多打一枪 `GET /api/players/:id/offer-settings` 才显示底价与自动同意开关——买方不泄底价；非名单球员不留空行）+ 事件流（`open`/`counter` 走左右气泡、其余 8 种 kind 走居中系统行；note 有值直显原文、空才用前端兜底句）+ 动作栏固定四颗（还价 / 同意 / 拒绝 / 撤回，越权置灰 + `title` 说理由）；**R1**——卖方待回复单任意轮次都能拒（拒绝常驻，不再受「轮到谁」限制）、拒绝/撤回/放弃改两段式就地确认并说清冻结去向；还价带 100 字附言（`{amount, note}`，服务端 `NOTE_MAX = 100` 兜底）；清单 ≤760px 改卡片行（横滑根因 `.table-wrap{overflow-x:auto}`）；③ 签约谈判页签把报价记录表折进卡内对话流（我方报价在右 / 经纪人逐轮反馈在左 / 结果与结算走系统行）+ 工资实时成功率档位（`POST /api/negotiations/:sessionId/preview` → `{forecast, risk}`；四档 0.2/0.5/0.8 硬编码只在 Worker 侧、零副作用、次数满 409 不替玩家强约、350ms 防抖、本地不合规不发请求、失败静默）；④ 后端：迁移 `src/db/migrations/0066_negotiation_feedback.sql`（`negotiation_attempts` 加 `feedback TEXT` + `risk INTEGER NOT NULL DEFAULT 0`，旧行 NULL = 无反馈）+ 抽 `evaluateWage` 让提交 / 预览 / 列表读时现算三处同源 + `attempts` DTO 扩 `at` / `feedback`；⑤ 金额双口径（报价 / 标价 / 底价 / 违约金整数走 `moneyIntText`；工资类两位小数走 `money()` + `m`）+ 气泡与系统行时间到秒（新增 `fmtDateTimeSec`）。**不变量**：判定公式与涉密参数（`src/worker/negotiation-secret.ts` / `negotiation-context.ts`）一字不动；事后满意度阈值 0.25/0.6/0.9 不动——预览四档是**另一套词**，有意并存；拒绝侧 worker 零改动（R1 只摆明面）；`GET /api/offers` / `:id` 契约未变；站内信深链 `?offer=` 不回归。**明确不做**：买方拒绝、R2「名单报价一律进人工」、R3「达线等表态超时」、R4 反悔通道、签约谈判加「终止谈判」、改判定公式、全站统一金额口径；按钮名「谈判桌」保留。**验收**：typecheck 三份 tsconfig 0 error；vitest **109 文件 / 1843 例**全绿（基线 108 / 1812，净 +31）；`npm run build` 成功；e2e **25/25**（⑤c 新增浮层 / 对话流 / 档位断言）；变异 M1–M6 实测（红 1 / 1 / 1 / 1 / 1 / 2，等价变异 1 枚登记）。**测试计划**：`docs/test-plans/v6.40.0-nego-chat-ui.md`。**已上线**（2026-10-09 发布，用户令 m06414「发布」；序 = 先 apply 生产迁移再 push——`npm run db:migrate:remote` 对 `0066_negotiation_feedback.sql` 执行 3 条命令 / 7.08ms，`pragma_table_info('negotiation_attempts')` 只读回读 `feedback` 与 `risk` 两列在场；随后 push `c894914..6da17ec`（6 枚：`cd828c6` 上批 v6.40.0 发布记录回写 + 本批 `36480cd` 壳 / `ad60659` 后端 / `546c810` 报价页签 / `0409fc0` 签约谈判页签 / `6da17ec` docs 收口）触发 CF 自动部署，生产 Version **`3171764d-4647-4dd1-85b4-445652998c44`** @2026-10-09T07:07:45Z；回读经自定义域名 `https://club.whleague.win` 全过——入口 `index-BHHqTTN9.js`（sha256 `b1e7d53e…`）/ `index-Bh7Tdj42.css`（`daf299f6…`）与本地构建**逐字节一致**，路由块 `MarketDeskPage-CBBjmo64.js`（`978a7de9…`，原 `MarketDeskPage-uPkjwtTx.js`）同 sha256 且含新文案（谈判桌 / 成功率很低 / 正在掂量 / 这一单已经了结 / 关闭谈判桌 / 拒绝这份报价 / 放弃这张意向单 / 撤回这张意向单 / 冻结的 / 有谈崩风险 / 再想想），CSS 新规则在线（`nego-panel` / `nego-stream` / `live-pill` / `.is-vlow` / `mkt-desk-card` / `.dc-mid`），包内版本串 `6.40.0`，端点闸门 `/api/negotiations/1/preview` 匿名 POST 401（路由在场）、`/api/negotiations?mine=1` 401、`/api/offers?box=in` 401 而 `/api/health` 与 `/api/clubs?limit=1` 200，`d1 migrations list whl-club --remote` ⇒ `✅ No migrations to apply!`。本机本地 D1 的迁移记账与 schema 脱节属预存在漂移，已按既有手法用 `wrangler d1 execute --local` 补列，未做破坏性重置）。

## [v6.39.3] · 球员库球队名前接队徽缩略图（宽屏球队格 + 窄屏铭牌卡；映射抽 src/worker/club-logos.ts 共用）（2026-10-08）

**已上线**（2026-10-08 发布，用户令 m04745「发布」：push `c534523..74540bc`（2 枚：v6.39.2 上线回写 `f1b912f` + 本枚）触发 CF 自动部署（Workers Builds），生产 Version **`d8093411-9eea-40fd-9611-0299f8595bf4`** @2026-10-08T15:14:29Z；自定义域 https://club.whleague.win 回读通过——入口资产 `index-C19jn4zM.js`/`index-Gfv8Dt1q.css` → **`index-DbqKwyYi.js`（642519 B）/`index-CxZEtVWu.css`（82694 B）**、包内版本串 `6.39.3` 恰 1 处、`.lib-club{display:inline-flex;align-items:center;gap:6px}` 逐字在线、生产 `GET /api/players?limit=3` 三行均带真 `clubLogoKey`（`team/18/1788577356249.png` 等）且与 `GET /api/clubs` 同 clubId 的 `logoKey` 逐字一致 3/3、真机（系统 Chrome 免登录公开页）`/players` 1280→20 行 / 19 个 `a.lib-club` 全为解码成功真图（`naturalWidth` 160）、375→20 张窄卡 / 19 个 `.lib-card-sub .team-logo` 真图，两视口 0 色块回落 / 0 页面报错（截图 `scratch/probe-live-players-1280.png`、`-375.png`）；零迁移、零生产写、纯展示层 + worker 读路径）。**缘起**：用户 m04476「下一个修复：球员库界面球队名前应该用队徽缩略图」。**根因（两处老形态）**：窄屏铭牌卡的所属球队行早已渲染 `TeamLogo`，但只传 `name`、没传 `logoKey` ⇒ 永远只出队名哈希色块（首字方块）；宽屏表格的球队格干脆是纯文本 `<Link>`，连徽都没有。**交付**：① 抽 `src/worker/club-logos.ts`（`loadClubTourTeams` = AUTH_DB `club_id → tour_team_id`；`loadTeamLogos` = TOUR_DB `team.logo_key`）——原本是 `routes/clubs.ts` 里的两个本地函数，`/api/players` 也要用 ⇒ 提为共用模块，两个端点各写一份必然漂（真源始终是比赛系统 `team.logo_key`，本平台 `clubs.logo_key` 全仓无人写）；② `GET /api/players` 在 `cachedJson` 计算体内补 `clubLogoKey`（按页内 club_id 去重查一次，自由身恒 null）；③ 前端 `PlayerLibraryRow.clubLogoKey` + 宽屏球队格改 `a.lib-club`（徽 + 队名，`inline-flex` 对齐）+ 窄屏卡片补 `logoKey`；无徽回落哈希色块、自由身仍是纯文本「自由身」。**判级 patch**：展示订正（球队名前多一枚缩略图），无新增端点、无契约语义变更。**回归闸门**：① worker `tests/players-library.test.ts` 队徽用例（AUTH_DB 映射 + TOUR_DB logo_key；自由身 / 无映射 / 有映射无徽三种 null 形态）；② 组件 `web/src/pages/PlayersLibrary.test.tsx` 三例（宽屏链接且自由身不给徽 / 无徽回落 span / 窄屏卡片真 src）；③ 静态锁 `tests/mobile-baseline.test.ts` TC-CREST-01（两处 `logoKey={p.clubLogoKey}`、`a.lib-club`、`.lib-club` inline-flex、后端走共用模块且 `clubs.ts` 不留本地副本）；④ e2e ⑧ 三视口加「窄屏卡片有 `.team-logo`、宽屏每个 `a.lib-club` 都有徽」；⑤ 探针 `scratch/probe-players-crest.mjs`（打桩 players + media：宽屏 2 张真图解码 36px、显示 18px、1 个色块、1 行自由身；窄屏同款）。**验收**：typecheck 三份 tsconfig 0 error；vitest **104 文件 / 1759 例**（v6.39.2 基线 1754，净 +5）；`npm run build` ✓；e2e **24/24**。**教训**：① 「只传 name 的 TeamLogo」是静默降级——组件自带 fallback，肉眼看到色块不会以为坏了，断言要落在 `logoKey` 是否传下去；② 给行类型加必填字段会掀出所有行夹具（`players-lens.test.ts` / `ClubDetail.test.tsx` / `players-library.test.ts` 的 `freshEnvWithHistory`），typecheck 是唯一一次抓全的闸门；③ 本地库 `team.logo_key` 全 NULL ⇒ e2e/探针只能断「徽元素存在」，真图解码要靠探针打桩。

## [v6.39.2] · 桌面球队页宽卡列对齐（列头与值区同款等宽轨网格 / 身份列 170→210 / 列距 14→22）+ 注册台列集 13→11 列 + 金额单位紧贴数字（2026-10-08）

**已上线**（2026-10-08 发布，用户令 m04382「v6.39.2发布」：push `b12ed0e..c534523`（2 枚，另一枚为并行会话 `fda0680` docs）触发 CF 自动部署，生产 Version **`c60c18a3-246a-4b7b-a30a-d5c041005a29`** @2026-10-08T11:23:55Z；零迁移、零生产写、纯前端 CSS 与组件层；判级 patch——展示订正 + 缺陷修补，无新增能力、无契约变更。**上线回读**（经自定义域 `club.whleague.win`）：入口由 `assets/index-Bqs8uSoc.js` + `index-By7gD_8t.css` 换为 `assets/index-C19jn4zM.js`（642376 B）+ `assets/index-Gfv8Dt1q.css`（82637 B）；包内版本串 `6.39.2` 恰 1 处；CSS 四个几何 token 与 `.sqc-group.wide{…}` 三条派生规则、`.sqc-card.wide .sqc-m{display:grid;grid-template-columns:repeat(auto-fit,minmax(var(--sqc-wmin, 58px),1fr));…}`、`.sqc-group.wide .sqc-ghead{gap:var(--sqc-cgap);padding:8px 14px 8px 11px}` 与设计逐字在线；v6.39.1 的 `.sqc-v.attr-*` 五条分段色规则亦在包内；公开页 `/clubs` 系统 Chrome 载入无 `pageerror`、金额紧贴匹配 20 处 / 带空格 0 处 ⇒ 裁决已生效）。**缘起**（用户令 m03731，v6.39.1 收尾途中实时提出）：「表头和数据不对齐；名字列宽度太低，且与后面数据距离太近」——桌面 `/clubs/:id?tab=squad` 同一屏。**根因**（两条并存）：① 桌面列头与值区**各排各的**——组头宽屏分支渲染的是 `[...cells, ...extras].map(c => c.label).join(' ')` 的右对齐标签串（`web/src/pages/club/card-parts.tsx` 的 CardGroup，注释原文「定稿 14-B：列头退化为组头右侧的标签串，不逐列对齐」），值区是 flex 平铺（v6.39.1 起 `justify-content: space-between`）⇒ 13 个值各按自身宽窄摊开，与列头结构上不可能对齐；② 身份列定宽 170px + 列距 14px（`.sqc-card.wide .sqc-id` / `.sqc-card.wide{gap}`）在 13 列值区面前偏窄偏紧。**交付**：① `web/src/pages/club/card-parts.tsx` 的 CardGroup 抽出 `legendCells` **一份列表**（`[...cells, ...extras].map(c => <span className="sqc-k">{c.label}</span>)`）给宽窄两分支共用——宽屏 `<span className="sqc-glegend">`、窄屏 `<span className="sqc-m sqc-gcols" aria-hidden="true">`（消除两分支漂移，正是本 bug 家族病因）；② `web/src/styles.css`——`.sqc-glegend` 由右对齐文本串改**网格**（轨模板与值区逐字相同）；新增 `.sqc-group.wide` 几何 token 块（唯一出处，改一处两边同步）：`--sqc-idw: 210px`（170→210）/ `--sqc-cgap: 22px`（14→22）/ `--sqc-wgap: 6px` / `--sqc-wmin: 58px` / `--sqc-assignw: 92px`；`.sqc-group.wide .sqc-ghead{gap: var(--sqc-cgap); padding: 8px 14px 8px 11px}` + `.sqc-gtitle{flex: none; width: var(--sqc-idw)}`（组头有 3px 色条边框、行卡没有 ⇒ 左内边距取 11 使 3 + 11 = 14 与行卡对齐、右取 14 ⇒ 两侧内容盒同宽同起点，列头网格与值区网格**像素级重合**，不是「大致对齐」）；`.sqc-group.wide .sqc-ghead.has-assign{padding-right: calc(14px + var(--sqc-assignw) + var(--sqc-cgap))}`（注册名单行尾有「分配 ▾」列，列头右侧须让出同宽）；`.sqc-card.wide .sqc-m` 由 flex 平铺改 `display: grid` + `repeat(auto-fit, minmax(var(--sqc-wmin, 58px), 1fr))` + `gap: 4px var(--sqc-wgap, 6px)`；`.sqc-card.wide .sqc-v.num{white-space: nowrap}`（数值不折行——值区折行比溢出几个像素难看，6px 列距兜住常见溢出；金额单位紧贴数字后格内一般已无空格可折，此规则作为数值格的硬保证保留；可加列 `.sqc-v-extra` 不在此列、保持折行不截断）；`.sqc-card.wide.has-assign .sqc-assign{width: var(--sqc-assignw)}`（按钮文案会变宽窄，不定宽值区就被挤歪）；③ `web/src/pages/club/DeskTab.tsx` 的 CardGroup 增传 `assign`（此前没传 ⇒ `.has-assign` 从未落位）。**用户裁决两条（本增量途中实时提出，同版收口）**：④ **注册工作台桌面列 13 → 11**——`web/src/lib/club-cards.ts` 新增 `DESKTOP_CELLS_DESK`（= `DESKTOP_CELLS.filter(c => c.key !== 'baseCa' && c.key !== 'growthGap')`，舍「初始CA」「成长空间」、保留「成长档位」），`card-parts.tsx` 的 RegCard 与 `DeskTab.tsx` 两处接线切到它（SquadTab/SquadCard 仍全 13 列）；缘由是注册台行尾恒有「分配 ▾」列（`--sqc-assignw`），值区只剩 754px @1280 ⇒ 13 列会折两行，舍这两列后 11 列单行放下（阵容页签值区 868px 装得下全 13 列）。⑤ **金额单位 m 紧贴数字**（「150.00 m」→「150.00m」）——前端 143 处：`moneyIntText`（`web/src/lib/club-cards.ts:122`）、`money`（`web/src/lib/players-library.ts:480`）、筛选器单位字面（`players-library.ts:404/406/407` 的 `' m'`）与各页内联拼接（球队页 / 球员页 / 财政账本 / 市场 / 消费中心 / 管理端等，含散文里的值「±10m」「固定 0.75m/半赛季」），e2e 夹具与断言同步；**worker/core 文案（`src/**`）本轮不动**——`src/worker/window-payroll.ts` 的 memo「未达顶级下限 53 m，按下限扣」是生产订正批 `scripts/prod-20261006-s9-wage-floor-fix/` 的核对串、且被 `tests/season-settle.test.ts:291-292` 断言，动它会牵动该批与约 35 条后端断言（用户看到的是界面观感，后端消息不在该屏）。**用 auto-fit 而非 grid-auto-flow: column**：13 列在 761–1100px 视口放不下时整列折行、列头同款同折（后者会把 13 列硬挤一行并截断）；`--sqc-wmin` 定 58px 是量出来的——最宽值形如「180.00m」（身价带两位小数，单位紧贴数字后 8 字符 ≈55px），58 让 auto-fit 扩张到 ≈61–63px 恰好容下并留 8–10px 余量；注册台取 11 列后 754px 值区正好落 11 轨（63px/轨）单行、不再折行。**验收**：typecheck 三份 tsconfig 0 error、`npm run build` 成功、vitest **104 文件 / 1754 例**全绿（v6.39.1 基线 104/1748，净 +6 例：card-parts 列头结构 +1、RegCard 11 格 +1、club-cards 注册台列集 +1、TC-WIDE 静态锁 +3）、e2e **24/24**（⑨ 桌面分支几何锁改写 + ⑩ 新增桌面注册名单步：11/11 格 + 列头文案须为 11 列且不含初始CA/成长空间 + 值区单行）。桌面探针（`scratch/probe-wide-card-desktop.mjs`，两 tab × 1280/1440）实测——阵容：`headPadL 11 / titleW = idW = 210 / cgap 22 / legendW = mW = 868 / display grid / 13 轨 / 列头格与值格逐列右缘差 maxRightDelta 0 / 值区单行 / 轨宽 61px / 文档零横向溢出`；注册名单：`headPadR 128（= 14 + 92 + 22）/ assignW 92 / legendW = mW = 754 / 11 轨 ⇒ 值区**单行**（用户裁决）/ maxRightDelta 1 / 轨宽 63px / 最宽值「150.00m」余量 10px` + 截图留痕（`scratch/probe-wide-squad-1280.png` / `scratch/probe-wide-desk-1280.png`）。**回归闸门**：① e2e ⑨ 桌面分支（v6.39.1 的 `display: flex` 锁替换为——`display grid` + 轨数 13 + 轨宽极差 ≤1px + 列头格与值格各 13 + 逐列右缘差 ≤2px + `idW ≥ 200 && cgap ≥ 20` + 13 格顶差 ≤3px）；② e2e ⑩ 新增桌面步（1280 → `/clubs/1?tab=desk`：11/11 列头格与值格 + 列头文案须为 11 列且不含「初始CA/成长空间」+ 值区单行 + 逐列右缘差 ≤2px + `assignW ≥ 80` + `|legendW − mW| ≤ 2px`）；③ `web/src/pages/club/card-parts.test.tsx` 列头结构（wide 与窄屏列名同序且 === `DESKTOP_CELLS` 标签 / 传 `assign` 时组头带 `has-assign`）；④ `tests/mobile-baseline.test.ts` TC-WIDE-01/02/03 静态锁（列头与值区轨模板逐字相同 + 基类 `.sqc-m` 仍是 grid / 组头 padding 与 token 唯一定义、`--sqc-idw ≥ 200`、`--sqc-cgap ≥ 20` / 分配列定宽 + `has-assign` 的 padding-right + DeskTab 传 `assign` 而 SquadTab 不传）；⑤ `web/src/pages/ClubDetail.test.tsx` 列名断言随结构订正（原比对 `legend.textContent` 整串，改逐格 `.sqc-k` 文本数组比对）；⑥ `web/src/lib/club-cards.test.ts` 注册台列集用例（`DESKTOP_CELLS_DESK` 11 列 + 键序 + === 全列滤掉 baseCa/growthGap）；⑦ `web/src/pages/club/card-parts.test.tsx` RegCard 宽卡用例（wide 出 `.wide.has-assign` 且值格 === `DESKTOP_CELLS_DESK.length`，窄卡仍按视图 3 格）；⑧ `tests/mobile-baseline.test.ts` TC-WIDE-04（`DeskTab` 必须用 `DESKTOP_CELLS_DESK`、不得再出现全列 `DESKTOP_CELLS`；`SquadTab` 反之——`\b` 不吃 `_DESK` 后缀）。测试计划 `docs/test-plans/v6.39.2-wide-card-align.md`。**教训**：① 「两份独立渲染路径」是「表头与数据对不上」这类问题的通用病因——修法不是把标签串调得更像，而是两侧共用一份列表 + 同一套轨模板；② 断言 CSS 网格**别匹配 `auto-fit` 字面**——`getComputedStyle().gridTemplateColumns` 给的是解算后的使用值（逐轨像素），永远不会出现模板字面，要锁「等宽轨网格」就断言轨数 + 轨宽极差（本轮 e2e 首跑即因此假红）；③ `tests/mobile-baseline.test.ts` 的 `declarations()` 按 `(?:^|;)\s*prop\s*:` 抓声明 ⇒ token 块里声明之间夹注释会让后面的 token 抓不到（`--sqc-idw` 紧跟 `{` 能抓到、`--sqc-cgap` 前面隔了行尾注释就抓不到，TC-WIDE-02 首跑红即此）⇒ token 每行一条、行尾不留注释，说明写规则上方；④ 改源码后必须先 `npm run build` 再跑探针/e2e（`wrangler dev` 服务 `dist/` 静态产物，无 HMR）——本轮首次探针跑出旧值白跑一轮；⑤ **构建成功 ≠ 产物正确**：`vite build` 不做类型检查，缺 import 的符号照样构建成功、运行时才 `ReferenceError`（本轮 ⑪ 场景逮到 `DESKTOP_CELLS_DESK is not defined`——那次 build 跑在补 import 之前）⇒ 顺序应是 typecheck → build → e2e，且 build 必须晚于最后一次源码改动；⑥ 判断命令退出码别走管道（`npm run typecheck 2>&1 | tail` 的 `$?` 是 `tail` 的，本轮因此把一份有 TS2552 的输出读成了 `EXIT=0`）。

## [v6.39.1] · 桌面球队页宽卡回归修复：`.sqc-card.wide .sqc-m` 补回 `display: flex`（v6.37.1 起的线上破版）（2026-10-08）

**已上线**（随 v6.39.0 同轮授权 push 部署，Version `c5cea3f8-33f5-48f4-8229-bab6c2f16b2f`，2026-10-08T10:17:13Z，自定义域 `club.whleague.win` 回读通过；零迁移、零生产写、纯 CSS 一行 + 三处回归闸门；判级 patch——缺陷修补，无新增能力）。**缘起**：用户附电脑端截图（`/clubs/66?tab=squad`）「电脑端显示bug，排查相似问题，修复」——分组标题右侧 13 列名列得整整齐齐，但每行球员渲染成窄卡形态（值区 3 列窄网格逐格堆叠）。**根因**（三路只读侦察一致）：`web/src/styles.css:6570` 基类 `.sqc-m` 是 `display: grid`（窄屏 `--sqc-mcols × --sqc-cw` 同构网格），桌面覆盖块 `.sqc-card.wide .sqc-m` 只写了 flex 子属性（`flex: 1` / `flex-wrap` / `justify-content` / `align-items` / `gap`）**漏写 `display: flex`** ⇒ 桌面值区仍是 grid，而 `--sqc-mcols` / `--sqc-cw` 只在窄屏下发（`web/src/pages/club/SquadTab.tsx:145-146`），回退成 `repeat(3, 48px)` 定宽三列，13 个指标折多行挤在右侧。**引入点 `b72d37e`（v6.37.1）**：该次把基类 `.sqc-m` 由 `display:flex` 改 grid，commit message 与当时 CHANGELOG 都写了「桌面 wide 由既有 `.sqc-card.wide .sqc-m{display:flex}` 覆盖不受影响」——**该断言错误**：覆盖块从来没写过 `display:flex`，原先靠的就是基类那个值；此后 v6.37.2 / v6.38.1 / v6.39.0 都没碰 wide 块，回归一路带到线上。**交付**：① `web/src/styles.css` 的 `.sqc-card.wide .sqc-m` 补 `display: flex`（注释移规则体上方并写明「基类是 grid，桌面必须显式覆盖回 flex」，因 `tests/mobile-baseline.test.ts` 的 `cssRules` 正则会把规则体内注释当声明、且注释文本会污染选择器匹配）；② 回归闸门三处——`scripts/e2e/smoke.mjs` ⑨ 段桌面分支新增几何锁（`.sqc-m` computed `display === 'flex'` + 值格恰 13 + 13 格顶差 ≤3px，失败信息带实测 display 与 `grid-template-columns`）、`web/src/pages/club/card-parts.test.tsx` 新增「宽窄结构」三例（wide 出 `article.sqc-card.wide` 且走 `DESKTOP_CELLS` 13 格 / 窄卡不带 `.wide` 且 basic 3 格 / 组头 wide 走 `.sqc-glegend`、窄屏走 `.sqc-gcols`）、`tests/mobile-baseline.test.ts` 新增 TC-WIDE-01 静态锁（wide 块必含 `display:flex`、基类 `.sqc-m` 仍是 grid、两处使用点都接了 `wide=`）。**相似问题排查**：全仓 sqc 机制只有两个使用点——`SquadTab.tsx`（阵容，线上出问题处）与 `DeskTab.tsx`（注册名单），二者共用同一套 CSS 与 `DESKTOP_CELLS`，wide 接线都正确 ⇒ 同款 bug 同款修，一处 CSS 覆盖两处；登记两处「同类隐患」不改（`PlayersLibrary.tsx:53` 球员库是独立机制 lib-card/表、断点 900 与主机制 760 不一致，当前不坏；宽窄判定走 `matchMedia` viewport 而非容器查询，宽视口 + 窄容器会误拿 wide，当前两处皆全宽不触发）。**验收**：修复前红基线（e2e 全量唯一失败 = 新几何断言，实测 `display=grid、grid-template-columns=48px 48px 48px`）→ 修复后 typecheck 三份 0 error、`npm run build` 成功、e2e **24/24**、vitest **104 文件 / 1748 例**全绿（v6.39.0 基线 104/1744，净 +4 例）、桌面探针 1280×900 实测四行卡 `display=flex / vCount=13 / topSpread=0 / 值区宽 916px 高 21px / 行高 65px / 文档零横向溢出` 并截图留痕。测试计划 `docs/test-plans/v6.39.1-wide-card-display.md`。**教训**：① 「基类改值、以为变体覆盖块会兜住」——变体块只写了子属性时，被改掉的基类属性会直接穿透到桌面（同类形态见 v6.37.2 P4：`.club-stat .stat-value` 压过 `.stat-value-small`，small 类从未生效）；CSS 覆盖必须逐属性核对，别只看选择器特异性；② 桌面几何此前零覆盖（⑨ 桌面分支只验组头标签串文本）⇒ 一条断言都没红，破版一路带到线上三个版本；③ `cssRules()` 的 `/[^{}]+/` 正则把规则体内注释当声明读，且注释里的选择器字样会污染文本级判据 ⇒ 注释写规则体上方。

## [v6.39.0] · 工资帽按级别（68/58）+ 窗末扣款级别下限（帽 − 15 ⇒ 53/43）+ CPU 队不入账 + 消费中心窄屏过宽修复（2026-10-08）

**已上线**（Version `c5cea3f8-33f5-48f4-8229-bab6c2f16b2f`，2026-10-08T10:17:13Z，push main 触发 CF 自动部署；代码侧零迁移、零 API 契约变更，另有生产数据订正一批；判级 minor——两处用户可见变化 + 一批生产数据订正）。**缘起**（用户四条指令）：①「上次扣工资时忽略了一点：顶级联赛未达53，次级联赛未达43工资的球队，扣工资时按53/43扣除，这个数字是对应级别工资帽-15」；四问四答落定口径——存两项帽值（顶级 68 / 次级 58）、代码算「帽 − 15」，并把平台既有工资帽机制从全局单值改为**按级别**；worker **永久生效 + 本次补扣**；未定级不扣且「工资帽阵容限制也按级别显示」；补扣「直接把上次的扣款记录改改」（原地改行，不做补偿分录）。②「cpu也不扣工资」——与奖金/主场收入/拍卖同口径，CPU 队不入账。③ 附 /shop 375 视口截图「修复消费中心过宽问题，排查类似问题」+「之前的计划呢，加上一起做」⇒ 窄屏修复与工资任务同批。**交付**：① 规则层 `src/core/squad-rules.ts` 新增 `DEFAULT_WAGE_CAP_BY_TIER = { premier: 68, second: 58 }` 与 `WAGE_FLOOR_GAP = 15`（引擎 `checkSquad` 与 rule id `wage_cap` 未动）；② 配置层 `src/core/config.ts` 的 `wage_cap` 由「无默认（`get` 返回 null）」改为分套 json 默认（键表未加键，仍 80 条登记 / 唯一 78，三处「80」断言不动），`src/worker/squad-context.ts` 按级别取值（`config` 覆盖 → 常量默认；未定级仍 500 不回退）；③ 扣款层 `src/worker/window-payroll.ts` 工资段 `floor = cap − 15`、`total < floor` 按下限扣 + memo 尾注「；未达顶级/次级下限 N m，按下限扣」+ `summary.wageFloorClubs`，CPU 队在**工资与富人税两段都跳过**（余额不动、无流水）；④ 前端 `web/src/pages/club/DeskTab.tsx` 工资帽文案与进度条按级别；⑤ 窄屏：`web/src/styles.css` 新增 `.shop-main`/`.shop-side`（`min-width: 0`，治两栏吃 `min-width:auto` 被子设施行/工单内容顶宽致整页横向溢出）与 `@media (max-width: 640px)` 内 `.seg` 单行横滑，`web/src/pages/shop/ShopPage.tsx` 两栏改类名（删内联 `flex/minWidth`）、`venueCards.tsx` 子设施行改 `flex + wrap`（项内仍 nowrap）；⑥ 闸门：`tests/mobile-baseline.test.ts` 新增 TC-SHOP-01/02 静态锁、`scripts/e2e/smoke.mjs` ⑱ 追加 375×812 几何段（文档零溢出 + 越界元素入失败消息 + `.seg`/子设施行几何）；⑦ 生产订正批 `scripts/prod-20261006-s9-wage-floor-fix/` **已于 2026-10-08 执行并收敛**（S9 第 1 窗 3 队原地改数 −49.23→−53 / −33.37→−53 / −37.62→−43，差 28.78 m 从余额再扣，余额与后续 `balance_after` 顺移；可选件 04 = CPU 241/112172 追溯回冲经用户令执行）——首跑事故、生成器修复与验收数字见下文「生产执行与上线」。**验收**：typecheck 三份 tsconfig 0 error、vitest **104 文件 / 1744 例**全绿（v6.38.1 基线 104/1738，净 +6 例）、`npm run build` 成功、e2e **24/24**（⑫ `/shop` 375 零溢出、⑱ 新段全过）；变异 3 枚实测（`WAGE_FLOOR_GAP 15→0` ⇒ 2 红、工资段去 CPU 排除 ⇒ 恰 1 红、删 `.shop-main` 的 `min-width: 0` ⇒ 恰 1 红）+ 等价变异 1 枚登记（下限判定 `total < floor` 改 `<=` 无红——等号点两支额度相同、memo 与计数皆以 `charge > total` 判）；375 实测页签 `{ovx:auto, wrap:nowrap, scrollable:true, buttons:5}`、子设施行 `{display:flex, wrap:wrap, rows:6, right:253/375}`。测试计划 `docs/test-plans/v6.39.0-wage-cap-by-tier.md`。**教训**：① 形状级演练用的夹具 id 整齐相邻，掩住了锚缺陷——`nextChainIntact` 实现成 `JOIN ledger_entries w2 ON w2.id + 1 = n.id`（假设同队下一条流水 `id + 1`），而生产各队 id 交错分配 ⇒ 锚恒假、①顺移全空跑（详见「生产执行与上线」）；锚必须按同队 id 区间取 `MIN`，不能假设相邻；② 生成 SQL 时 `>` 会撞执行器的 shell 元字符闸（cmd.exe 当重定向）⇒ 行窗改写 `BETWEEN … AND 2147483647`、判据用 `substr` 相等与 `instr(…) != 0`；③ 内联 `style={{ minWidth: 0 }}` 会被本仓 TC-SWP-02 固定宽禁令拦下 ⇒ 布局尺寸一律落 CSS 类。**待办**：① 可选美化：≤640 的 `.seg` 补细滚动条声明（与 `.dossier-tabs` 一致）。

**生产执行与上线（2026-10-08 回写）**：用户令「跑订正，CPU财政回溯，发布6.39.0」三件连做。**事故**：首跑 `02-wage-floor-fix.sql`（06:40:13Z）只落下 **4/9 条 changes**（期望 13）——上述锚恒假 ⇒ ①顺移、③账户对账空跑，留下半成品态（工资行已改数、下游 `balance_after` 未顺移、账户与尾行对不上）。**修复**：锚改 `nextRowId(id)`（同队 id 区间内 `MIN`）+ `nextChainBroken(id)`，每队语句序改 **②工资行触底 → ①顺移下游 → ③账户对账**，预检扩到 A–I（H = CPU 两队全流水、I = 链诊断含 `no-downstream` 三态，`(SELECT w.id + 1 …)` 的旧写法在 I 段一并订正）；先用生产真值夹具在本地复刻演练 34 断言全绿，再重跑 02（10:04:13Z）**changes 9**（club 5 ①③、club 449 ①六行 + ③，club 280 三条空跑因已完整），重放 **changes 0**；跑 04（10:05:24Z）**changes 19**（241 十二处、112172 七处），重放 **changes 0**。**验收**：03 件 v1 3/3、v2 三队 `consistent`、v3 Σ−149（3 行）、v4 其余 15 队 Σ−902.46 零波及、v5 CPU 两行 amount 0；终态 club 5 **23.42** / club 280 **42.95** / club 449 **29.35** / club 241 **86.40** / club 112172 **49.80**（账户余额 = 流水尾行 `balance_after`）；全账链 `LAG(balance_after)` 自检五队共 **67 行 0 断点**；财政净影响 = 工资多扣 −28.78 + CPU 退回 +119.17 = **+90.39**。**发布与回读**：提交 `b12ed0e`（只含本批 11 件，+937/−255）→ `git push origin main`（`ae73c63..b12ed0e`，带上 v6.38.0 之后 8 枚本地提交）→ CF 自动部署 **Version `c5cea3f8-33f5-48f4-8229-bab6c2f16b2f`**（10:17:13Z）；经 `club.whleague.win` 回读：入口包内嵌版本串 **6.39.1**（唯一匹配 ⇒ 未提交的 v6.39.2 在制品没上线）、`/api/health` 三资源 ok、`/api/squads`、`/api/market/transfer-board`（7 人）、`/api/players?limit=2`、`/api/players/6`（Rodri + contract）全 200；**资产字节一致**（从 HEAD 干净重构建，js `5457ce14…` / css `2c897127…` 与线上 sha256 逐一相同）；探针 `/api/clubs/241`（401 = 教练鉴权路由）与 `/api/clubs/241/squad`（路径不存在，该文件只注册 `/clubs/:id/standing`）非缺陷。执行留痕：`scripts/prod-20261006-s9-wage-floor-fix/report.md`、批 README §4/§5.2/§6、`snapshot.json`（跑前 06:38:24Z / 跑后 10:08:51Z）。**订正（2026-10-09，用户令「巴萨和RB莱比锡已经不是CPU球队了…只有真正是CPU的才不扣」）**：CPU 期冲正 04 判定为**误冲并已撤销**——绑定真源（`whl-auth` 只读）显示 club 241 → `team` id 6 / `account_id` 21（`bound_at 2026-10-03T16:52:38.879Z`）、club 112172 → `team` id 18 / `account_id` 14（`2026-09-23T05:00:25.035Z`），两队绑定日均**早于** S9 第 1 窗扣款（`2026-10-06T03:08:00.611Z`）⇒ 扣款当时已非 CPU 队，扣款本身正确；CPU 判据只认当前 `clubs.is_cpu = 1`（现仅 10 曼城(CPU) / 131681 AC米兰(CPU)：无绑定、无流水、0 合同），不认「扣款当时是 CPU」。执行 `rollback/02-cpu-refund-optional.sql` ⇒ **changes 21**（241 十二处 / 112172 九处）、重放 **changes 0**；终态 club 241 账户 86.40 → **24.92**、club 112172 49.80 → **−4.63**（负值合规）；同轮全量核查 18 支非 CPU 队 charged = Σ 现行合同（5 / 280 / 449 三队按下限 53 / 43 / 53）、CPU 两队 0 流水、全账链 0 断点；财政净影响回到 **−28.78**（04 退回的 119.17 已收回）。新增复查件 `sql/05-verify-cpu-undo.sql`（v1–v5，取代 03 件 v4 的「其余 15 队 Σ −902.46」口径 ⇒ 现为 −1021.63）、`report.md` §8、批 README §3/§4/§8.1。

## [v6.38.1] · 窄卡排版订正：徽章跟名同行 + 值区右侧 3/4 均分 + 值格分段色 + 效力单位改「年」（2026-10-08）

**本地收口，未 push**（零迁移、零生产写、纯前端与一处 worker 文案）。**缘起**（用户两条实时指令）：①（v6.37.2 两行式上线后）「既然变成现在排版，内联徽章可以显示在球员名右侧而非下边了；对于第二行数据，倾向于在右侧 3/4 区域平均分布，而非在整行平均分布」；②「属性值应用本仓已有的分段配色方案，同时效力时长单位改成年，该效力时间的『年』语义同『赛季』」。**交付**：① `styles.css`——组头列头 `.sqc-ghead .sqc-gcols` 与行值区 `.sqc-card:not(.wide) .sqc-m` 同款改 `flex-basis:75% + margin-left:auto`（值区不再整行均分，左侧让出与名字区相当的 1/4，无论 gcols 与组名同行还是折行都贴右、列头与值格起点对齐 ≤3px）；`.sqc-id` 改横向流（row + wrap + center，`.sqc-nm` flex:none、`.sqc-subline` basis 100% 强制独占下一行）——徽章跟在名字右侧、放不下才折；`.sqc-id` 补 `min-width:96px`（`.sqc-id{flex:1}` 的 basis 是 0%，观众态卡无分配下拉时第一行累进装得下 ⇒ 值区不折行、名字区被 grow 压成 32px 的 e2e ⑨ 实测回归，min-width 参与换行累进后值区必折）。② 值格分段色——`club-cards.ts` 的 `CardCell` 增可选 `shade`（只给 0-99 能力值刻度列：CA/PA/初始 CA；年龄/成长差值/金额/效力/文本不设，套了会被误读——同 `lensChipFor` colored 的适用域边界），`card-parts.tsx` 的 `metricValues` 对 shade 列套 `attrClass` 五档类；`styles.css` 五档色值提 `:root --attr-*` token（`.attr-*` 与新增 `.sqc-v.attr-*` 0-2-0 覆盖组共用，改色单一出处）。③ 效力单位全仓「赛季」→「年」7 处：卡片 `club-cards.ts` / 横表 `club-columns.tsx` / 详情表 `Player.tsx` / chip `players-library.ts`（区间组 label 与 lensChip 两处）/ 筛选器 `FilterPanel.tsx` / worker 分段 `routes/clubs.ts YEARS_BANDS`（「0.5 年内 / 1–1.5 年 / 2–2.5 年 / 3 年及以上」，key 与阈值不动）；语义：1 年 = 1 赛季，数值口径不变。④ e2e `smoke.mjs`——⑨ 名字区断言改量 `.sqc-id` 容器（min-width 96 落位）、⑨/⑲ `mBasis` 锁 `'75%'` + `margin-left` 计算值 ≥60px（computed 是用后像素而非 `auto` 字面）、新增徽章与名字 top 差 ≤3px 同行锁、效力夹具与断言赛季→年。**验收**：typecheck 三份 0 error；vitest **104 文件 / 1738 例**全绿（基线 104/1736，+2 例：shade 适用域锁 + 值格渲染类锁；另有 `club-columns.test` / `players-library.test` / `PlayersLibrary.test` / `ClubDetail.test` / `smoke.mjs` 共 6 处存量断言随单位同步订正）；e2e **24/24**；探针 360×760 截图目测：徽章跟名同行、值区右 3/4 起排与列头对齐、五档色可辨（82/84/85/88/92 绿、75/78 琥珀、年龄与缺值中性）；变异 M1（删 `ca.shade` ⇒ 渲染抽样红）/ M2（`年`回`赛季` ⇒ 取值口径红）各恰好 1 红、撤回复绿。测试计划 `docs/test-plans/v6.38.1-narrow-card-tone.md`。**教训**：工作区有未提交改动时禁用 `git checkout -- <file>` 做变异撤回——本轮 M2 变异脚本失配后误把当日全部未提交改动回滚（vitest 立红 2 例暴露），重打三处 Edit 后复绿；变异实验撤回一律用 Edit 精确还原。

## [v6.38.0] · 公开端点 /api/players/meta：批量取球员元数据供跨仓名册同步（2026-10-07）

**已上线**（2026-10-07 发布：push `b4f010e..ae73c63`（8 枚，与 v6.37.2 窄屏两行式模块同轮）触发 CF 自动部署，生产 Version **`2f7bb425-b145-4fce-8496-0ba3e6a1d31d`** @2026-10-07T05:50:57Z；线上入口资产 `index-D6fopAWj.js` 与本地 6.38.0 构建 sha256 逐字节一致（`e256a33a…`）、线上 JS 版本串 `6.38`；push 前 `migrations list --remote` 报 No migrations to apply（零迁移）；回读 health + players/clubs/squads/market 全 200、`/api/players/meta?fcIds=1` 200 空数组；发布记录 docs 枚按仓规只本地 commit 不 push）**纯新增公开只读端点**——既有端点行为逐字不变，向后兼容，判级 minor）。**缘起**：兄弟仓 WHL-tournament-management-system 的名册同步要按 EA `fc_id` 批量拉 FC26 球员元数据（身高 / `game_attrs` / PlayStyle）；契约由对面仓给出、**字段名不许改**：`GET /api/players/meta?fcIds=<逗号分隔 fc_id>` → 200 `{ players: [{ fcId, height, attrs, playstyles }] }`；fcIds 上限 90、超限或含非法值 400、匿名公开只读、查不到的 fcId 直接不出现不报错。**交付**（`src/worker/routes/players.ts`，注册在 `loadRoster` 之后、`/players/:id` 之前——「meta」否则会被当成球员 ID 落进详情分支，同 roster 的坑；import 补 `playstyleIdOf`）：① `META_FC_IDS_MAX = 90`（与 `src/worker/players-import.ts:75-87` 的 `WHERE fc_id IN (…)` 分批同值）；② `parseMetaFcIds` 校验——缺参 400「缺少 fcIds 参数」/ 超 90 个 400「fcIds 最多 90 个」/ 每段须十进制正整数（`/^\d+$/` + `Number.isSafeInteger` + `> 0`），`1e3`、`0x10`、`1.5`、负数、空段一律 400「fcIds 含非法值「…」」，Set 去重；**校验在 `cachedJson` 之前**（否则 400 会被缓存住）；③ `loadPlayersMeta` 一条 `SELECT players.fc_id, players.game_attrs, pp.psid, pp.kind FROM players LEFT JOIN player_playstyles pp ON pp.player_id = players.id WHERE players.fc_id IN (…) ORDER BY players.fc_id, pp.slot`，输出按请求顺序、查不到跳过、重复去重；④ 字段口径——`height` 取 `game_attrs.height`（**players 表本就没有身高列**，身高只在 71 键 `game_attrs` JSON 里：属性页 `web/src/pages/Player.tsx:761` 与对比页 `web/src/pages/PlayerCompare.tsx:540` 同此口径），`metaHeightOf` 只认 number 与非空数字字符串，取不到给 `null`（避开 `Number(null) = 0`）；`attrs` = `game_attrs` **原样整包**（不做字段筛选，空/非对象给 null）；`playstyles` = 发放明细表 `player_playstyles` 的 psid 数组经 `playstyleIdOf(psid, kind)`，**金徽换算成基础 ID + 100**（与 `web/assets/ref/playstyle.json` 同编号空间：银 1-99 / 金 101-199；表里 `psid` 存基础 ID、金徽由 `kind='gold'` 表示、槽位银 1-12 / 金 13-15）；⑤ 公开只读照 `/players` 与 `/players/roster`：`assertPublicRate(c, 'players')` + `cachedJson('players:meta:' + canonicalQuery(c.req.url), ttlForScope('players', …))`，`/api/players` 前缀的写路径 purge 映射 `src/lib/cache-policy.ts:66` 已就绪即复用。**验收**：typecheck 三份 0 error；vitest **103 文件 / 1731 例**全绿（基线 103/1727，+4 例全落 `tests/players-library.test.ts` 新 describe「球员元数据批量 /api/players/meta（v6.38.0）」——字段逐项（attrs 原样 / height / 金徽 +100 / 顺序 / 不命中）/ 空值兜底 / 参数校验（含恰好 90 个放行、第 91 个 400）/ 去重与全 miss 空数组）；响应实测（内存 D1 夹具）`{"players":[{"fcId":2500801,"height":189,"attrs":{…原样整包…},"playstyles":[4,126]},{"fcId":2500802,"height":null,"attrs":null,"playstyles":[]}]}`（126 = 金徽基础 ID 26 + 100）；本版无前端改动故未跑 e2e 与 build。**教训**：给 `players.game_attrs` 插坏 JSON 会被库直接拒（`Error: malformed JSON`）——迁移 `0034` 的 `json_extract` 表达式索引 `idx_players_sort_ps` 在插入时求值 ⇒ 生产库里不可能存在坏 JSON 行；测试里「解析失败」分支改用合法但非对象的 `'null'` 覆盖，代码里的 try/catch 仅作防御（同 `/players/:id` 详情的写法）。**待办**：① 随下一次被授权 push 与代码同轮上线（`docs:` 枚按仓规只本地 commit）；② **code-review-skill 未跑（登记待办）**——纯新增公开只读端点、无既有路径改动；③ 对面仓若要合并 FC 源槽位（`game_attrs.PSID1-15`）需自行读 `attrs`——本端点 `playstyles` 只取发放明细表（徽章真相源）。

## [v6.37.2] · 窄屏两行式卡片定稿：名字区/值区/分配下拉/顶栏/nav 五处真机崩坏收敛（2026-10-07）

**已上线**（2026-10-07 发布：push `b4f010e..ae73c63`（8 枚，与 v6.38.0 公开端点模块同轮）触发 CF 自动部署，生产 Version **`2f7bb425-b145-4fce-8496-0ba3e6a1d31d`** @2026-10-07T05:50:57Z；线上资产 `index-D6fopAWj.js` 与本地 6.38.0 构建 sha256 逐字节一致、线上 JS 版本串 `6.38`；零迁移；发布记录 docs 枚按仓规只本地 commit 不 push。**版本号叙事**：本地收口时按用户裁决「版本号6.37.x」回落 6.37.2，发布令下「bump 到 6.38.0」——两模块同轮统一以 6.38.0 上线）。**缘起**：v6.37.1 上线后 360×760 探针自查（Spike 路径，探针 `scratch/mobile-audit/probe.mjs`）实锤五处：① P1 名字区仍碎——v6.37.1 只算观众态账，教练视角还有分配下拉 `.sqc-assign` 71px 恒占行尾 + 层级 padding 共 68px（container 32 + `.card` 36 + `.sqc-card` 24）未入账 ⇒ 教练态合同视图名字区实测 23px、成长/市场 0px（逐字竖排）；② P2 内联徽章「+N」是死元素——`sqc-badge-more` 只有 title 无 onClick（手机无 hover）；③ P3 超管 nav 8 项 453px > 可视 336px 溢出；④ P4 ClubDetail 页头「当前窗口」值「第 9 赛季 · 窗口 1」孤字折行——`.club-stat .stat-value`(22px, 0-2-0) 权重压过 `.stat-value-small`(16px, 0-1-0) 致其后者从未生效；⑤ P5 转会表格横滚维持现状（用户裁决不引入滑动）。用户裁决（实时）：「padding 占太多，不希望引入滑动」⇒ nav/表格一律不允许横向滑动方向；「卡片达标在哪，年龄CAPA的显示都分行了」⇒ 否决值区折 2 列（2+1 孤行）；「其他视图也是，数据部分一坨屎」⇒ 否决一切值区折行形态 ⇒ **定稿两行式（SofaScore 形态）**：第一行序号+名字+分配下拉回行尾，第二行值区独占整行 1fr 均分（3 值 ~90px/格、合同 4 值 ~68px/格），组头列头同款 1fr 网格逐列对齐。**交付**：① `styles.css`——`.sqc-card:not(.wide)` `flex-wrap:wrap` + `:not(.wide) .sqc-m` `order:1; flex-basis:100%` + 1fr 轨道；`.sqc-ghead` flex-wrap + padding 对称 10/10 + `.sqc-ghead .sqc-gcols` flex-basis:100%（gcols 与行值同构网格，特异性 0-2-0 压过 `.sqc-m` 基类钉宽轨道）；`.sqc-k`/`.sqc-v` 去钉宽；≤640：`.container` 16→12、`.card` 18→12、`.sqc-card` 12→10（局部媒体块紧跟基类防 818 块反压）；topbar-inner gap 10 + padding 10/12、nav-links gap 4→2、nav-tab 12.5px/6px 7px；`.nav-ts`/`.nav-tf` 双文案显隐（桌面全称、≤640 短文案、aria-label 保全称）；`.club-head-numbers .stat-value.stat-value-small` 回 16px + nowrap（0-3-0，仅 ClubDetail 页头容器）。② `card-parts.tsx`——`VIEW_GRID_COLS` = basic 3 / growth 3 / contract 4 / market 3（列数＝值数，值不折行）；`CardBadges` 的「+N」span→button（useState 展开/收回、`aria-expanded` + 中文 aria-label，照 CardSubline 位置 +N 先例）；`card-parts.test.tsx` 新增 2 例（折叠计数/展开收回/aria 翻转）。③ `club-cards.ts`——`moneyIntText` 带 ` m` 单位（37 → `37 m`、12.5 → `12.5 m`）。④ `TopBar.tsx`——nav 四项改双 span（我的球队/球员库/球队库/消费中心/财政账本）+「转会中心」直接短文案「转会」。⑤ e2e——smoke `⑨` mobile 段收紧为两行式口径（名字区 ≥150px / 位置摘要非空 / 值格零溢出 / 值区 rows===1 / 组头尾格错位 ≤3px / nav 全页签右缘 ≤ 视口），新增 **`⑲` 教练态 375 场景**（me/club + club/squad 桩走 own 分支：分配下拉真渲染宽 ≥40px、`mBasis === '100%'`、值区单行、列头对齐、nav 收纳、零横向滚动；工作台 own 页签 ⑨ 观众态根本进不了，是 v6.37.1 盲区的针对性补口）。**验收**：typecheck 三份 0 error；vitest **104 文件 / 1735 例**全绿（基线 103/1727；+1 文件 2 例 card-parts + Agent B 同步改写若干、v6.38.0 的 4 例 meta 并入基线）；e2e **24/24**（23 + 新增 ⑲；⑨ 收紧断言过）；build 成功；探针实测（360 教练视角修复后）：名字区——基本 168 / 成长 148 / 合同 128 / 市场 144px（修复前 63/0/23/0），分配下拉折行退场、页面 scrollWidth === 360 零横向溢出、nav 越界 535→0；变异验证 M1（`.sqc-m` basis 100%→88% ⇒ ⑨ tailDelta 35px 红 + ⑲ mBasis 红）/ M2（contract 4→2 ⇒ 列数锁例红）/ M3（`moneyIntText` 去 m ⇒ 金额 2 例红）/ M4'（撤 tf 隐藏 ⇒ ⑨+⑲ navFit `520 > 375` 双红）全命中。测试计划 `docs/test-plans/v6.37.2-squad-two-row-narrow.md`。**教训**：① `npm run dev` = `wrangler dev` 服务 **vite build 后的 hash 静态资产，无 HMR**——改源码后不 `npm run build` 就跑 e2e 测的是旧资产（本轮首测变异全绿的假象即由此来）；② 变异必须制造「比原样式更宽」的差值才有锁力（删 `.nav-ts` 显示规则会让双 span 全空、nav 反而变短测不出）；③ e2e 桩的行 DTO 要跟当前组件契约同步——DESK_SQUAD 桩还是 v6.23.0 旧表形（无 uid），RegCard 副行 `uid.replace` 即崩白屏（真后端 `src/worker/routes/registration.ts` 一直下发 uid，生产无此 bug，纯测试桩过期）；⑲ waitFor 卡死先看 e2e-fail 截图分辨「未渲染」vs「渲染崩」，⑪ 的未捕获错误收集会替在途场景兜出崩溃栈。

## [v6.37.1] · 窄屏球队卡修复：指标区网格化折列，修球员名逐字竖排（2026-10-07）

**已上线**（2026-10-07 发布：push `c10069b..ee336a8`（6 枚，含上一轮 v6.37.0 发布记录回写）触发 CF 自动部署，生产 Version `ec2b0174-cff7-4a96-a840-e09aacb39b0f` @2026-10-07T01:52:49Z（push 后约 80 秒确认）；线上入口资产 `index-DOQ8L5kH.js` / `index-Dsm4lZA2.css` 与本地 6.37.1 构建 sha256 逐字节一致（`3798b5b0…`）、线上 JS 版本串 `6.37.1`；回读 health + players/clubs/squads/market 全 200；发布记录 docs 枚按仓规只本地 commit 不 push）。提交链 `b72d37e` fix(web) + `7726e4c` fix(club-cards) + `872988f` test(e2e) + `ccc5a9f` fix(web) 审查订正 + 本枚 docs；零迁移、零生产写、零 API 契约变更——纯前端 CSS/组件层。**缘起**：v6.37.0 上线后真机验收崩坏——球队页窄屏卡片合同视图（4 列指标）与基本视图球员名被压成逐字竖排（「Jo/rd/an/Pi/ck/fo/rd」），市场/成长视图（3 列）副行位置摘要（`.sqc-pos`）被压没，合同值「0.5 赛季」格内碎两行；e2e/vitest 全绿但窄屏真机未实测是盲区（v6.37.0 已登记）。**根因**：`.sqc-m` 单行 flex 按 `--sqc-cw × 列数` 钉死总宽（合同 4×52=208px 吃光 ~360px 行宽），`.sqc-id` min-width:0 + `.sqc-nm` overflow-wrap:anywhere 令名字区 min-content 退化为 1 字符 ⇒ 逐字断行；副行 `.sqc-pos` 可缩（ellipsis）而 `.sqc-uid` 不可缩 ⇒ 3 列视图 pos 被挤没。**交付**：① 每视图网格列数 `VIEW_GRID_COLS`（card-parts.tsx：basic/contract=2、growth/market=3）经 `--sqc-mcols` 由 SquadTab/DeskTab 下发，`.sqc-m` 与组头列头 `.sqc-gcols` 改**同构 grid**（`repeat(var(--sqc-mcols,3), var(--sqc-cw,48px))` + `justify-content:end`）——组头标签与行值逐格对齐保持，4 值视图折 2 行给名字区让回 ~176px（360px 实测宽度账）；桌面 wide 由既有 `.sqc-card.wide .sqc-m{display:flex}` specificity 覆盖不受影响。② 合同列宽 52→60px + `.sqc-v` nowrap + 效力值去空格（`club-cards.ts`「1.5 赛季」→「1.5赛季」，值源唯一改动、桌面表格/球员库口径不动）治值格碎行。③ `.sqc-subline` 加 flex-wrap 保位置摘要不被压没。④ **审查订正**（`ccc5a9f`）：nowrap 收窄到 `.sqc-card:not(.wide) .sqc-v`（可加列长值——来源球队名 ~70px > 52px 格、PlayStyle 多徽章排 ~120px——窄屏从格内折行变格间重叠、桌面从折行变撑开的真回归）；可加列值格挂 `sqc-v-extra` 窄屏 `overflow:hidden + ellipsis` 截断兜底。**验收**：typecheck 三份 0 error；vitest **103 文件 / 1727 例**全绿（基线 1726 +1「窄屏网格列配置」锁：四视图列数映射 + contract 60px）；e2e **23/23**（⑨ 合同视图新增窄屏四断言：名字区 ≥100px / 位置摘要非空 / 值格 scrollWidth 零溢出 / 值区 top 去重 ≤2 行）；变异 M1 删两处 `--sqc-mcols` 下发 ⇒ 宽度断言红（名字区实测 44px）、M2 cw 回 52 ⇒ vitest 60px 锁红。测试计划 `docs/test-plans/v6.37.1-squad-card-narrow.md`。**教训**：e2e 几何断言先写「4 值同行」再改 2 列网格是自相矛盾——修正为「≤2 行」上界锁（崩坏形态逐值一行会超界）；首跑全绿后新增的断言必须重跑验证，不能沿用旧绿。



## [v6.37.0] · 球队页两表弃表改卡 + 球员对比入口浮层选人（2026-10-06）

**已上线**（2026-10-06 深夜发布，用户令「发布」；push `18a19aa..c10069b`（10 提交，两模块同轮）触发 CF 自动部署，生产 Version **`5026da80-5a88-4d3d-b73e-181f4e43b776`** @2026-10-06T23:52:03Z（push 后约 2 秒）；零迁移、零生产写，生产迁移现状本仓已到 `0065`；线上资产 `index-CVrQgIEu.js` 与本地 6.37.0 构建 sha256 逐字节一致、版本串 `6.37.0`，health + 四关键接口全 200）。阵容名单与注册名单（球队页两张 11 列宽表）弃表改卡：位置四组容器（门将/后卫/中场/前锋，未知殿后「其他」）+ 行解剖卡（号码 + 姓名 + 徽章 + 副行[标记/位置摘要/uid] + 右侧指标区）；桌面全 13 列合并、组头右对齐标签串承担表头（SofaScore「分组即容器」× 懂球帝「身份块+右对齐指标」融合，视觉定稿走画板逐屏裁决）；窄屏（≤760px）四视图 chips（基本/成长/合同/市场）+「列…」长尾自选，同构 DOM 互斥。**交付**：① 规则层——激活价 `Math.round` 整数化、报价拒非整数；② 数据层——`GET /api/club/squad` 行下发 `influence`（`src/worker/influence.ts` 抽共用）；③ 纯函数层 `web/src/lib/club-cards.ts`（分组/徽章优先级/激活价镜像/整数金额/位置摘要/四视图 CELL 定义，全 getter nullish 守卫）+ 共享组件 `card-parts.tsx`（CardGroup/SquadCard/RegCard/CardBadges 1+N/AssignmentSelect 行尾「分配 ▾」/ViewChips）+ `club-columns.tsx` 拆 `clubCellContent`/`clubCellClass` + `parseCardExtras` 长尾池滤内置键 + styles.css `.sqc-` 专属前缀段并摘除两段死粘列 CSS（`table-sticky-2` 只剩市场成交表+出价历史、`coach-sticky` 只剩 VenueTab）+ e2e ⑨ 重写卡片口径（三视口）；④ 测试——`club-cards.test.ts` 15 例（含 API 漂移守卫）、`club-columns.test.ts` 22 例、`ClubDetail.test.tsx` 44 例改写（matchMedia 桩）、`mobile-baseline.test.ts` 21 例（表基线 45、死选择器回归锁）。**验收**：typecheck 三份 0 error；vitest 103 文件 / 1726 例本版范围全绿（全量 1 红 TC-CMP-URL-05 属并行会话对比模块在途，非本版）；e2e **23/23**；build 成功；变异验证 5 点全命中（2 处首轮空转各补钉后命中）；code-review 无阻塞（2 条 🟢 a11y 备注登记不改：列头 aria-hidden 读屏丢列语义、ViewChips tablist 无 tabpanel 关联）。测试计划 `docs/test-plans/v6.37.0-club-tables-to-cards.md`（24 TC，变异留痕已回填）；其余点位映射留档 `docs/mobile-table-map.md`。

**球员对比入口浮层选人（同版第二模块）**（已上线，Version 同上；提交链 `3ba82c2` feat(web) + `7990a9c` fix(compare) + `200f554` test(e2e) + 本枚 docs 收口；零迁移、零生产写；与上模块同属 v6.37.0——用户指令「并行会话和你做的同属一个版本号，不要多 bump」，package.json 维持 6.37.0）。**缘起与拍板**：用户报两个 bug——球员页「⇄ 加入对比」按钮位置异常（`.player-card-compare` 容器在 styles.css 零定义）+ 点进对比页再回球员库选另一人时第一名没勾上（一人态「＋ 从球员库选」裸 `/players` 丢 `?compare=`）；用户拍板不做跳转流修补、改**页内浮层选人**（方案 B），UI 视觉稿经 visual companion 画板定稿（桌面居中 420px 浮层 / ≤760px 底部抽屉，三槽三色 = 对比页 `COMPARE_COLORS`）。**交付**：① 新建 `web/src/pages/player/ComparePickerOverlay.tsx`——壳照 MarketListingOverlay（createPortal / 遮罩点击关 / panel `role=dialog aria-modal` / ✕ / ≤760px 底部抽屉 + safe-area + reduced-motion），焦点陷阱 + 锁滚 + 焦点归位照 PlayersLibrary 抽屉（仓库第三份副本，暂不抽公共件）；搜索与球员库搜索框共用 `['players-roster']` 缓存（打开拉一次名册 blob 后全本地 `suggestPlayers` 过滤，零逐键请求、不撞公开限流）；槽位固定 3 格、自己恒占 A 色（`colorFor` 色随人走）、候选排除自己、已选行保留显 ✓ 再点移除、确认 `onConfirm([own, ...picked])` 才 `navigate('/players/compare?ids=…')`；`styles.css` 新增 `.cmp-picker-*` 组（配方照 `.mkt-ov`）+ 补 `.player-card-compare`（bug1）。② 入口 Link 改 button 开浮层（Player.tsx）。③ 一人态回库补 `?compare=<fcId>`（bug2）。④ spec `docs/superpowers/specs/2026-10-05-player-compare-design.md` §16 修订节——入口 B「点击跳转」条款作废，§0 位置 / §8 URL 即事实源 / §9 库勾选契约不变。**验收**：typecheck 三份 0 error、vitest **103 文件 / 1726 例**全绿、e2e **23/23**（⑤f 改写为浮层链路：1a 初始态 + Esc 关 / 1b 搜索入槽确认落 2 人态 / 1c 一人态 URL 直达保留形态回归）；变异验证 M1–M5 全命中（拆确认闸 / 上限 2→3 / 删排除自己 / ids 顺序翻转 / 一人态退回裸 `/players`，各恰好目标断言 1 红）；测试计划 `docs/test-plans/v6.37.0-compare-entry-overlay.md`（TC-CMP-PICK-01…09 + 回归 + 变异留痕）；code-review 无阻塞（🟢 登记不改：空查询只显提示不出默认候选——名册 96.9% 是自由身、默认 8 条全是噪音；满员阈值 2 双处硬编码由 M2 钉住；toast z-index 100 低于浮层 900 沿用 `.mkt-ov` 既有口径）。**教训（已入记忆）**：球员页规范 URL 效果会在详情落定后 `navigate(replace)` 重挂载整页——测试从内部 id 地址进时第一下点击落在被 React 换掉的游离节点上（onClick 不触发），必须直接从 fc_id 地址进。

## [v6.36.0] · 弃权语义订正：walkover_side 记的是弃权方（判负方）+ 全库奖金订正批（2026-10-06）

**已上线**（2026-10-06 发布，用户令「发布」；同轮缘起令 m02403「查询生产库中巴塞罗那和莱比锡赛果，按赛果发场次奖金，并查询杯赛小组赛奖金池是否已分配完毕」→ m02478「弃权场败方不发钱，检查全库，收回这些奖金，并修订规则」→ m02516「这些原则要在代码层面修复」；提交链 `c3ad191` fix(worker) 代码 + `b088112` chore(scripts) 生产批工件 + `18a19aa` docs 收口 + 本枚发布记录；**零迁移、零 API 契约变更**，但**本版含生产写**——订正批 9 批 / 57 语句 / changes 57 已执行、双复核差异 0，与既往「零生产写」版本不同，故显式登记）。**执行序**：① push 前 `npx wrangler d1 migrations list whl-club --remote` 报 `✅ No migrations to apply!`（生产已到 `0065`，本版零迁移 ⇒ 无 apply 步骤）② `git push origin main`（`2cd076b..18a19aa`，5 提交）触发 CF Workers Builds 自动部署 → 生产 Version **`85fa0ed7-fe16-4f89-a15d-b54e05818a81`** @2026-10-06T05:16:44Z（Source `Unknown (deployment)`，push 后约 25 秒；上一条 `1658a9a3-…` = v6.35.0）③ 上线回读**通过**（经自定义域名 `https://club.whleague.win`，本机对 `*.workers.dev` 段仍被网络污染：DNS 解析到 `31.13.96.192` / `face:b00c` 段即 Facebook 地址、TCP 通但 TLS 握手失败 exit 35，故改走自定义域名）——`/api/health` 200 且 `d1`/`tour_db`/`kv` 全 ok；线上入口 `assets/index-QIgrfJD-.js` **631,182 B（与本地构建逐字节同尺寸）**、内嵌版本串 `6.36.0`、`assets/index-0jB_-PvF.css` 与本地构建同名（JS 文件名变化仅因版本串 6.35.0→6.36.0，本版无前端逻辑改动）；`/api/players?limit=1`、`/api/market/listings`、`/api/clubs`（3707 B）、`/api/squads`（43064 B）、`/api/market/deals` 全 200，`/api/admin/events/pool` 与 `/api/offers` 匿名 401；**本版两处线上实证**：(a) 上座清零 —— 公开只读面 `/api/fixtures?tournament_id=&round=` 逐场核对，5 场弃权场（#2 / #31 / #38 / #165 / #172）`attendance` 全为 `0`，同轮其余场次上座正常（9788 / 13157 / 13855 / 7374 / 7863 等），改动范围精确；(b) 补录转会单 —— `/api/market/deals` 公开成交流显示 28 条（24 `match` + 4 `rc_change`，全 S9 第 1 窗，金额与 CSV 逐行一致，如 Mokio 6 / Martinelli 17 / Miguel Gutiérrez 21 / Schlotterbeck 65 / Bouaddi 20）。弃权战报方向文案（`弃权负`/`弃权胜`）走登录态端点（`/api/clubs/:id` 匿名 401）未做线上回读，由 1699 例测试与代码评审覆盖。按仓规收口 `docs:` 枚与发布记录枚**只本地 commit 不 push**。

**缘起与拍板**：排查「巴塞罗那 241 / RB 莱比锡 112172 为何零奖金」时发现平台把 `walkover_side` 当胜方读。权威语义（tour 仓 `migrations/0013_walkover.sql` 列注释 + tour 生产 10 场 `note`/`winner` 双向核对）：`''`＝普通场、`'home'`/`'away'`＝该侧弃权（比分记 0:3，弃权方 0）、`'both'`＝双弃权——即**记的是弃权方（判负方）**。后果：弃权方拿胜场奖金、真胜者拿败方出场补贴（方向整片反），且弃权场照发比赛日收入。三处口径用户拍板（2026-10-06）：① 弃权场胜方照发胜场奖金、**弃权方一分不发**（连败方出场补贴也没有）② 范围＝**全库对齐**（含其他真胜者差额）③ 弃权场比赛日收入**一并收回**。

**交付**：① 新建纯函数唯一出处 `src/core/walkover.ts`（`isWalkover` / `walkoverWinnerSide` / `walkoverLoser`，含四态与 `both` 语义）。② `src/worker/prizes.ts`：`outcome()` 弃权优先（胜者＝弃权方对面，`both → 'none'`）；联赛与超级杯两条**败方出场补贴**各加 `!isWalkover(...)` 护栏。③ `src/worker/home.ts`：`formPtsOf` 改调 `walkoverLoser`；`matchAttendanceStatements` 加 `walkoverSide` 入参并在弃权场**整块早退**（不落上座、不发 `revenue`、不跑死忠演化），`src/worker/results.ts:364-372` 调用点透传。④ `src/worker/season-settle.ts`：`aggregateRecords`（双弃权双方各记一负）、资格赛止步保底（`both` 两侧都进 losers）、`leagueStandings`（弃权按 3:0 判负给对侧）。⑤ `src/worker/event-ops.ts` `lastResultOf`、`src/worker/naming-ops.ts` `brandHeatDelta` / `windowWinRate` 改调同款。⑥ `src/worker/routes/clubs.ts:868-874` 主场战报（该表只收自家主场 ⇒ 本队恒为 home）由反向改「`'home'` = 弃权负 / `'away'` = 弃权胜」。⑦ 离线引擎副本 `scripts/prod-20261004-influence-recalc/engine.mjs` 的 `formPtsOf` 同步订正（parity 测试抓出）。⑧ 测试：新建 `tests/walkover-semantics.test.ts`（16 例，含奖金 7 例、收入早退 2 例、战绩 4 例）+ 订正 6 处把旧口径当「仓库既有口径」钉住的老测试（`event-ops` / `naming-ops` / `home` / `influence-recalc-engine` / `club-visibility` / `naming-tiers`）。⑨ 生产批 `scripts/prod-20261006-s9-walkover-fix/`：**收回 9 笔 39.74**（弃权方胜场奖金 4 笔 32.20 + 弃权场收入 5 笔 7.54）、**补发 12 笔 75.20**（巴塞罗那 8 场 CPU 跳过漏发 47.9 + 弃权场真胜者；莱比锡 2 场 11.8；贝蒂斯 1 场 7.0）、**差额 5 笔 19.00**（真胜者被误按败方发过补贴，补齐 3.8×5）、**上座清零 5 行**（门票合计 7.54；`UPDATE ... SET attendance/ticket/commercial/broadcast = 0` 保留行与 weather——行是收入幂等闸、主场战报以它挂载）；净 **+54.46**，`ledger_entries` id 245–270（26 笔）。生成器带 `selfCheck()` 硬断言（键不重复 / 不给弃权方补发 / 不与已发流水同场双发 / 四块总额）与 `--verify` 只读复核，并支持 `--ts=` 复现时间戳（02–05 分片逐字可复现）；工件含 `01-precheck.sql`、`05-verify.sql`、`rollback/01-undo.sql`（52 语句）+ `rollback/05-attendance-restore.sql`、`manifest.json`、README/report（写分片按 `.gitignore` 不入库）。

**验收与后效**：typecheck 三份 0 error；vitest **102 文件 / 1699 例**全绿（基线 101 / 1683；+1 文件 +16 例）；build 成功且主包 `index-C4GaOVbP.js` 631.18 kB **哈希未变**（改动全在后端 worker/core，不进 vite 产物）；测试计划 `docs/test-plans/v6.36.0-walkover-semantics.md`（58 TC，留痕已回填）。生产批双复核**差异 0**：`sql/05-verify.sql` → `bal_1 39.33 | bal_2 18.92 | bal_14 92.42 | bal_21 51.13 | bal_241 24.92 | bal_449 48.98 | bal_110374 29.14 | bal_112172 -15.89 | wo_rollback_n 9 | fix_n 5 | wo_prize_n 22 | wo_att_n 5 | wo_att_dirty_n 0 | conserve 0`；`gen-walkover-fix.ts --verify` 逐队 8/8、上座 5/5、收回 9/9、补发 12/12、差额 5/5、守恒 0（批后另有管理员「接队资金」2 笔各 +30.00 计入 `POST_BATCH` 期望值）。**回滚工件未执行**（仅备用；逆序建议先 05 后 01）。登记不改：弃权场死忠（fans）演化未回滚（精确回滚需按窗重放整条死忠链）、弃权场 XP 不回收（`results.ts:559` 布尔闸旧口径即正确）、CPU 队（10 / 131681）3 场胜方 21.90 m 按 `cpuClubIds` 闸不发、双弃权（`both`）生产未涉及（代码已定义：双方都不发钱/不发收入/战绩双方判负）、cron 持续写账（验收用守恒位而非绝对笔数）。**遗留问句已答**：杯赛小组赛奖金池**未分配完毕**——`season_tournaments` 三条（tournament 1 `league_premier` / 2 `league_second` / 3 `champions_cup`）`stage_settled_at` 全 NULL、全库无任何非 `match_home`/`match_away` 的 `prize` 流水 ⇒ 入场奖金 / 资格赛保底 / 小组赛剩余池一分未发；本轮代码修复是该结算的前置。生产迁移现状：本仓已到 `0065`（本版零迁移）。

## [v6.35.0] · 位置热区图 + 六维雷达刻度五档对齐 + 徽章/PlayStyle 口径统一（2026-10-06）

**已上线**（2026-10-06 发布，用户令「发布」；提交链 `bb175db` docs（v6.34.0 发布记录回写）+ `809ca49` feat(web) 热区图纯函数与共享组件 + `1b2aa32` feat(web) 球员页接入 + 雷达共享件统一对比页 + `029043e` fix(api) 成交参照 fee 护栏 + `e77dbf7` feat(web) 徽章/PlayStyle 口径统一 + `3d3308c` test(e2e) + `2cd076b` docs（收口）；零迁移、零生产写、零 API 契约变更——后端只动了一处读路径护栏）。**执行序**：① push 前实测生产无待 apply 迁移（`migrations list --remote` 报 `✅ No migrations to apply!`，本仓已到 `0065`）⇒ 无需 apply；② `git push origin main`（`38e5a5c..2cd076b`，7 个提交）触发 CF Workers Builds 自动部署 → Version **`1658a9a3-b16f-46bb-ad65-980d1945992a`**（@2026-10-06T00:52:21Z，Source `Unknown (deployment)`，本地时间 2026-10-06 08:52；上一条 `6df4be40-…` 即 v6.34.0）；③ **上线回读未完成**——本机网络对 `*.workers.dev` 段不通（DNS 解析到 `199.96.63.163`，443/80 均超时；`curl` 报 `000`、WebFetch 10s 超时、`node fetch` failed，`curl --resolve` 强制指 CF anycast 同样 `000`），对照 `api.cloudflare.com` 有响应、`example.com` 200、`git push` github.com 成功 ⇒ 出网正常、仅该主机名或边缘段被拦，重试一次仍不通，回读待网络恢复补（本版实证只有 push 范围与部署记录，未见应用层异常迹象）。按仓规收口 `docs:` 枚与本次发布记录枚**只本地 commit 不 push**（push 即触发 CF 自动部署）。

**缘起与拍板**：用户令「位置热区可视化，并且将对比页六维图与球员面板页样式统一。修复本仓徽章和 playstyle 的不统一问题。」设计定稿两份：`docs/superpowers/specs/2026-10-05-player-heatmap-radar-ticks-design.md`（热区图三列拓扑照 sofifa、主位绿 `#2b8a3e` / 副位榈绿 `#66a80f`、12 块全在场、纯门将特例；雷达五档环带 20% 内叠 + 55% 环线 + 白点虚线边）与 `docs/superpowers/specs/2026-10-06-badge-playstyle-unification-design.md`（计数唯一出处 + 三密度 + 色板 token 收敛 + PlayStyle 两形态）。三处口径均取推荐项（2026-10-06 用户拍板）。

**交付**：① **热区图**——纯函数 `web/src/lib/heatmap.ts`（`HEAT_VIEW` 245×200、`HEAT_CODES` 12 码、`HEAT_SLOTS` 坐标、`heatPositionsOf` / `heatStateOf` / `heatToneClass`）+ 共享组件 `PositionHeatmap`（12 `rect` + 12 `text` 恒在场、aria 摘要两态），落球员页属性页签头部（`.attr-head` 三列，≤760px 堆叠）与对比页 2 人态身份卡两侧（3 人态与吸顶条不出）。② **雷达统一**——`AttrRadar` 泛化为 `variant: head|big|small|mini` + `bands: tier|neutral` + `ariaHidden`，对比页 1/2/3 人态与吸顶条全改调共享件（原私有 `RadarChart` / `MiniRadar` / `dataPoints` 与旧类名整块删除，样式收进共享件段）；`web/src/lib/radar.ts` 扩 `RADAR_BAND_BOUNDS` / `bandFrac` / `tierColorOf`。③ **徽章 / PlayStyle 统一**——新建 `BadgeCounts`（`badgeCountItems` 是「金在前 + 零值抑制」的唯一出处；`icon` / `text` / `chip` 三密度）+ `PlaystyleBadge` 加 `compact`（表格列形态，不挂 `ps-badge`、不拉图标）；`club-columns.tsx` 的 `psNames` 换 `psBadgesOf`（空槽 `0` 与 core `playstyleSlotsOf` 同口径，修掉表格显示「0」）；色板收敛 6 枚 `--badge-*` token；球员页四调用点（卡头 / 升级方案 / 提示句 / 完成 toast）与对比页、球员库卡片全部改调共享件。④ **顺带修缺陷三处**：`positionName` 空槽护栏（`Number(null) === 0` 而 `position.json` 的 id 0 是 GK ⇒ 空槽被错译成门将）、`.attr-*` 缺 `fill`（SVG `<text>` 不吃 `color`，v6.19.0 起的轴数值套档色实际未生效）、`/api/players/:id` 的 seaComps `signFee` 对 `fee ≤ 0` 的历史成交行抛 `RangeError` 打成 500（本地 30 名球员中 5 名命中）。

**验收**：typecheck 三份 0 error；vitest **101 文件 / 1683 例**全绿（基线 98 / 1622）；build 成功（`index-C4GaOVbP.js` 631.18 kB / gzip 199.82 kB、`index-0jB_-PvF.css` 74,796 B）；e2e **23/23**（⑤f 改探针取样数据驱动——判据与渲染同源，本地只有 1 名带可上雷达存档时断言降级并备注；⑯ 补 375 属性页签空态闸门 + 有存档球员头部几何；⑫ 375 零溢出含对比页）；测试计划 `docs/test-plans/v6.35.0-heatmap-radar-badge.md`（留痕已回填）；code-review（审 `38e5a5c..HEAD`）**P0 0 / P1 1**（v6.35.0 记录与版本号未入库——由本枚关闭）**/ P2 4**（空钩子类名补色规则、e2e 探针判据同源、表格单元格补组装级断言 3 条已修；本地草稿文件 1 条登记不改）**/ P3 6**（注释与实现不符、`basePlaystyleId` 复用、clamp 去重 3 条已修；单人 aria-label 变更登记、图标目录为空、compact 名称口径 3 条登记不改），评审另列 10 条「已核查无问题」（head 变体逐项等价、旧类名零残留、token 影响对账、`freeAgentFee(` 全仓无漏网、e2e 非空转等）。已知登记：无存档球员不出数据多边形（有意行为变化）、对比页中性环带（唯一有意视觉差异）、表格 badges 列 text 密度新增金/银分色（有意视觉变化之二）、compact 基础名 vs 整徽带后缀名、playstyle 图标目录为空（老问题）。生产迁移现状：本仓已到 `0065`（本版零迁移）。

## [v6.34.0] · 球员对比：独立对比页 + 详情页入口 + 球员库勾选（纯能力对比，2–3 人）（2026-10-05）

**已上线**（2026-10-06 发布，用户令「发布」；提交链 `aac8985` feat(players) + `96bc117` feat(compare) 纯函数 + `d5a3ad7` docs(test-plans) + `1dd6e8e` refactor(web) 共享件 + `c4e3379` feat(compare) 对比页 + `f1e9598` feat(compare) 入口与库勾选 + `7db9ff0`/`a2376ef` test(e2e) + `d90bc5c` fix 评审 P0 + `64180e1` fix 键归一测试 + `a1afa8e` refactor PlaystyleBadge + `38e5a5c` docs 收口；零迁移）。**执行序**：① push 前实测生产无待 apply 迁移（`migrations list --remote` 报 `✅ No migrations to apply!`，本仓已到 `0065`）⇒ 无需 apply；② `git push origin main`（`907c5a1..38e5a5c`，14 个提交，含 v6.33.1 发布记录回写）触发 CF Workers Builds 自动部署 → Version **`6df4be40-3b97-493a-82bb-7a095886fded`**（@2026-10-05T20:50:36Z，Source `Unknown (deployment)`，本地时间 2026-10-06 04:50）；③ 上线回读：线上入口 `assets/index-ChUUQqk5.js` + `assets/index-hOYUad5h.css` 与本地 6.34.0 构建逐字同名、线上 JS 版本串 `6.34.0`；`/api/health`、`/api/players?limit=1`、`/api/market/listings`、`/api/clubs`（3707B）、`/api/squads`（43064B）全 200，`/api/admin/events/pool` 与 `/api/offers` 匿名 401；**详情端点 `GET /api/players/1` 实测出 `influence: 12.5`**——本版唯一后端增量的线上实证。前置验收：typecheck 三份全清、vitest 98 文件 / 1622 例全绿、build 成功。

**缘起与拍板**：用户令「球员对比功能实现」；硬需求＝对比页 URL 含全部参与球员 id、改 id 即改对比（唯一事实源）；纯能力对比（雷达/34 属性/体型·位置·花式·逆足·惯用脚/角色/徽章·徽章数/影响力）；2–3 人上限 3；门将＝混比统一外场六维、纯门将用 GK 六轴；桌面 A＋E＋F；胜负标记乙（胜方加粗、等值双粗、数字球员本命色）；颜色 A #8e5426 / B #37505e / C #6d4aa8。

**交付**：详情端点补 `influence`（`influenceOf(coefs, p.ca, p.pa, p.growable === 1, p.prestige)`，与列表同源）+ 类型补 `influence`/`fcId`；`web/src/lib/compare.ts`（parseCompareIds/colorFor/rowMarks/groupAverages）+ `web/src/lib/radar.ts`（GK_RADAR/groupAverage/starText/axesFor/axisValue）+ 共享件 `AttrRadar`/`PlaystyleBadge` + `qk.player`/`usePlayerDetail`（id String 归一）；新公开路由 `/players/compare` 对比页（A＋E＋F、状态机 9 态、吸顶雷达条、热区图虚线占位、URL 只读）；入口两件（详情页「⇄ 加入对比」、球员库勾选列＋吸底收集栏（上限 3/跨筛选保留/`/players?compare=` 预勾选））。

**验收**：typecheck 三份 0 error、vitest **98 文件 / 1622 例**全绿（净 +7 文件/+84 例）、build 成功（`index-ChUUQqk5.js` 628.96 kB / gzip 198.95 kB）、e2e **23/23**（⑤f 对比链路 + ⑫ 375 纳入对比页）；测试计划 `docs/test-plans/v6.34.0-player-compare.md`（65 TC，留痕已回填）；code-review **P0 1（radar 漏入库，已补）/ P1 3（键归一测试、375 扫描、URL-06 断言，均已补）/ P2 6 / P3 5**，微变异实做 5 条全还原。已知登记：库槽位色 vs 对比页存活序色差异（无害）、`groupAverage` 逐键 null 按 0 计（既有口径）、窄屏细节待手工、`PlayersLibrary.test.tsx:537` 既有竞态偶发。生产迁移现状：本仓已到 `0065`（本版零迁移）。

## [v6.33.1] · 特例期一线队/训练营同场参赛：名册含训练营开关 + 注册校验三态 + 全员注册工件 + 全站文案改名（2026-10-05）

**已上线**（2026-10-05 发布，用户令「先发布」；提交链 `c9c5bcf` fix(web) + `1bff080` feat + `1f480b7` fix 评审 + `96779c8` docs(test-plans) + `dfd6e87` feat(web) 改名 + `0cc1275` chore(scripts) 注册批工件 + `907c5a1` docs 收口；零迁移）。**执行序（顺序未反）**：① push `4e5d9f9..907c5a1` 触发 CF Workers Builds → Version **`a08d7f3c-318d-427f-bee3-d858e6983f33`**（@2026-10-05T15:49:32Z；线上入口 `assets/index-BcjvHca1.js` sha256 `58b0023a…` 与本地构建逐字节一致、版本串 `6.33.1`）② 生产预检 9 条全过（season=9 / 20 队 570 人 / 训练营合同 69 / registrations 0 行 / status 全 normal）③ 开 `squads_include_trainee=true` + 四键豁免（`squad_min=19` / `squad_max=32` / `trainee_max=8` / `ca_pa_limits.premier.growthPa87=7`，直写 D1 回读全对）④ 写批 570 行注册 + 69 人 `status='trainee'` ⑤ verify：**570 = 一线队 501 + 训练营 69**、逐队零差异、stray 0 ⑥ bump KV `cache:epoch:public` `22 → 23` → 回读 `/api/squads`：20 队 **570 人 / 69 行 `squad='trainee'`**，逐队与 D1 一致。

**缘起**：用户提出「tour 平台只取一线队人员……由于特殊情况，一线队和训练营都能参赛，如果此时注册有训练营无法参赛的风险」。核查链：注册写 `players.status='trainee'`（`src/worker/routes/registration.ts:366-371`）→ `/api/squads` 只发 `status IN ('normal','listed')` → 赛事仓整点 cron 把该球员从 tour `player` 表删除 → `validateAssign` 失败无法进阵容。规则原文（4.2）：「阵容注册分为一线队注册与训练营注册，所有参赛球员必须完成注册方可出战正式比赛」，两条注册线都可出战。用户拍 **T1 手动开关**。

**交付**：config 注册表 **78 → 80**——`squads_include_trainee`（默认 `'false'`；开关开时名册含 trainee 且每行附 `squad` 字段，缓存键并入开关值防旧口径写进新代际键）+ `registration_check_mode`（**enforce / warn / off 三态**，脏值回落 enforce；warn = 放行但红字在、off = 只做归属与重复校验，隔离 `checkSquad` 全部七条；管理端扫描不受档位影响；审计 `after` 恒带 issues 规则清单）；`GET /club/squad` 下发 `checkMode`，DeskTab 三态横幅与红字同步。**全员注册批工件** `scripts/prod-20261005-s9-all-registrations/`（season=9、20 队 570 行 = 一线队 501 + 训练营 69，CPU 两队全一线队；含生成器 / 分片 SQL / manifest / 回滚 / README runbook；**未执行任何生产写**）。**全站文案改名**：球队中心 → 我的球队、球队 → 球队库。顺带修广告板报价弹层透明（缺 `.card` 类）。

**验收与后效**：测试计划 `docs/test-plans/v6.33.1-trainee-play-allowance.md`（32 TC）；vitest **91 文件 / 1538 例**全绿、typecheck 三份全清；code-review P1-1（缓存键）/ P1-2（off 档七条）已修并变异验证。已知后效：**回 enforce 前先收名单**（否则提交 422）；特例期训练营球员**不记场次 XP**（先观察）；CSV 164 名非平台球员暂不处理。生产迁移现状：本仓已到 `0065`。

## [v6.33.0] · 转会名单公开标价：最低报价转私密 + 广告板报价入口（2026-10-05）

**已上线**（2026-10-05 发布，用户令「发布」；提交 `480a1ee` docs(spec) + `a755cc7` feat 后端 + `fb451b8` feat 前端 + `cbdd7ba` test + `4e5d9f9` docs 收口）。**执行序（顺序未反）**：① 迁移 `0065_list_price.sql` 先 apply 生产——`Executed 3 commands in 3.03ms`，回读台账 head = `0065_list_price.sql`、`players` 四列在场、名单行 2 行全回填（B. Mbeumo 18 / O. Marmoush 18）；② `git push origin main`（`b9cd7a9..4e5d9f9`）触发 CF Workers Builds，约 1 分钟出 Version `69041242-34b7-4500-a6da-269586c0c9d3`（@2026-10-05T07:06:53Z）；③ **bump KV `cache:epoch:public` `17 → 18`**（`/api/market/transfer-board` 与球员详情走 `cachedJson` 代际键，旧形状载荷最长存活 24h）。**上线回读**：线上 `index-Cd07juMr.js` / `index-gjLtH_Uw.css` / `MarketAdBoardPage-MRvBa5OE.js` 与本地构建 sha256 逐字节一致，线上 JS 版本串 `6.33.0`、广告板分块含 `adb-bid-btn`；`/api/health`、`/api/market/transfer-board`（2 行 `listPrice:18`）、`/api/players/67`、`/api/players/142` 全 200 且**全端点 0 处 `minOfferPrice`**（详情只出 `listPrice`）；`GET /api/players/:id/offer-settings` 与 `/api/admin/brands` 匿名 401。生产迁移现状：本仓已到 `0065`。

用户 brainstorming 拍板五条：进转会名单**必填公开标价**（`[1, 1.5×违约金]`）；**最低报价（底线）全系统私密**（公开面零下发）；**同意线改钉标价**（无标价回落底线），达线且对方开了自动同意才直接成交；**低于标价视为砍价**走人工谈判、**低于底线恒自动拒**；广告板卡脚加**圆形报价按钮**（点了直接发起报价，预填标价）。

新增：`players.list_price`（迁移 0065，回填在名单行）+ `GET /api/players/:id/offer-settings`（本队教练，五字段）+ `autoRespondKind` 双线化 + `AdBidModal` 报价弹层 + 报价区块「砍价」徽标；`transferPriced` 改由 `list_price` 派生。收口：公开面（transfer-board / 球员列表与详情 / 报价列表与谈判桌 / 通知 / 审计）全部只出 `listPrice`，「低于对方底线」类文案不再带数额——`minOfferPrice` 仅活在私密端点。测试计划 `docs/test-plans/v6.33.0-list-price.md`；验收 vitest **90 文件 / 1521 例**全绿（净 +20）、typecheck 三份全清、build（`index-Cd07juMr.js` 609.94 kB / gzip 193.74 kB）、e2e **22/22**、变异 **M1–M7 全命中零空转**；code-review P0 0 / P1 0（登记不改 6 条）。

## [v6.32.0] · 转会台页签化 + 市场域信息架构重排（2026-10-05）

**已上线**（2026-10-05 发布，用户令「修复roadmap，随后发布」；**零迁移、零生产数据写**，直接 push 触发 CF 自动部署：push `3306bb3..ed9503d`（7 枚 = v6.32.0 五枚 + v6.30.0 标题补写 1 + 本条）⇒ 生产 Version **`96436df1-de82-4007-bde6-ac59961078a0`** @2026-10-05T03:39:54Z；**上线回读抓到队徽真源缺陷**（transfer-board `logoKey` 全 null——本平台 `clubs.logo_key` 全仓无人写、生产全 NULL，真源在 tour 库）⇒ 热修 push `ed9503d..b9cd7a9` ⇒ 生产 Version **`292d0884-acc2-474f-a2e3-20859fc7376a`** @2026-10-05T03:49:42Z（两次均 Source `wrangler`；CF API 经 `curl --resolve api.cloudflare.com:443:<IP>` 直连取证——wrangler/Node 侧 DNS 间歇失败，`GET /accounts` 订正记录里的 account id 笔误「…a01ccec」→「…a01cec」）。**上线回读**：`/api/health` 200、SPA `/market/desk` 200、入口 `assets/index-C9J6_5Ha.js` sha256 `febfd58d…81cd` 与本地 6.32.0 构建**逐字节一致**（含版本串 `6.32.0`、「自动挂牌」在场 /「自动成交」零命中）、`GET /api/market/transfer-board` 行带 `logoKey` 且热修后与 `/api/clubs` 同源同值（巴黎圣日耳曼 `team/1/1788576927024.png`）、worker 代码直读含 `club_logo_key`→改含 TOUR_DB 合并。push 前硬闸：typecheck 三份全清 + vitest **90 文件 / 1501 例**全绿 + build（`index-C9J6_5Ha.js` 608.69 kB / gzip 193.37 kB，CSS `index-CDCHJSke.css` 与 6.31.0 同 hash=零 CSS 改动）。

缘起：用户 brainstorming「当前我的转会台页面乱，探索整治方案」；三问拍板 = **更大信息架构重排**（页签化 + 跨页归属去重）/ **页签自带计数**（删独立待办速览条）/ **流水线说明条精简一行**。**IA 裁决矩阵**：全站成交公示归情报页（不动）；我队转会队史归球队中心转会页签（唯一历史台账，不动）；**转会台删「已落定的谈判」表**（工作台只放进行中，工资随球员合同页签可查）；出价历史（per-listing）与议价时间线（per-offer）属上下文视图保留；我发出的报价留在报价页签（页签名「收到报价」改「报价」，box in/out 次级切换保留）。

**转会台页签化（/market/desk）**：三区块（签约谈判 / 收到报价 / 我的出价）同屏长滚动改真页签——照球队中心 dossier-tabs 模式（`.seg.dossier-tabs` + `?tab=` + 条件挂载），页签自带计数（谈判 = active 会话数 / 报价 = in+out 两侧 pendingMine 之和 / 出价 = active 出价数，与区块同 query 键缓存复用），待办速览条与滚动对齐机制（rAF 轮询 + wheel/touch/keydown 三重监听约 35 行）退役；`?tab=` 语义全保留（nego/offers/bids + mine alias + 非法值回落不改写 URL），SideOps 深链与旧路由换址不受影响。清理：money() 三份实现收口 shared、死类名 `.row-open` 删除、谈判规则展示常量具名（轮次 3 / 训练营 0.75/5）、`useMyNegotiations` 收编 `lib/queries.ts`（`qk.myNegotiations`）。

**广告板顺带（同轮用户令）**：说明行「出价达线自动成交」→「出价达线自动挂牌」；球员卡左上角队徽接 R2 实图——`GET /api/market/transfer-board` 在 `cachedJson` 计算体内按本页名单 `club_id` 去 **TOUR_DB `team.logo_key`** 点查并合并进载荷（照 `/api/clubs` 同口径；本平台 `clubs.logo_key` 全仓无人写、生产全 NULL——**首发版误读休眠列被上线回读抓出，热修订正**），BoardCard/FeaturedCard 的 TeamLogo 接实图、无徽回队名哈希色块（缓存 TTL 内旧载荷缺字段时同样回退，优雅降级）。

**验收**：typecheck 三份全清、vitest **90 文件 / 1501 例**全绿（基线 89/1491，净 +1 文件 / +10 例）、build 成功（`index-CnFbuqoy.js` 608.69 kB / gzip 193.37 kB）、e2e **22/22**（⑤c 重写后全过、⑫ `/market/desk` 375 零溢出）；变异 **M1–M8 全命中**（M8 首轮空转——前端测试 mock 不到后端映射，补 `tests/ad-board.test.ts` logoKey 双侧断言后命中；M4 证明 search 串断言抓不住同址重复导航，改用 `useLocation().key` 集合探针）；code-review P0 0 / P1 1 已修（settled-only 教练见空区块 → 判空改按 active）。测试计划 `docs/test-plans/v6.32.0-market-desk-tabs.md`。

## [v6.31.0] · 转会广告板：转会名单球员一览 + 着重度预留（2026-10-05）

**已上线**（2026-10-05 发布，用户令「发布」；**迁移 `0064_ad_board.sql`**——发布顺序硬约束执行到位：先 `npm run db:migrate:remote` apply **@2026-10-05T02:08Z**（5 commands / 107.87ms；回读四件套全过 = `players.transfer_listed_at` 列在场（`pragma_table_info` 计数 1）/ `player_promotions` 表在场且 **0 行**（写路径本版不实现）/ `idx_players_transfer_listed` 在场且 SQL 与迁移逐字一致（`CREATE INDEX idx_players_transfer_listed ON players(id) WHERE transfer_listed = 1`）与 `idx_player_promotions_active` 在场 / `d1_migrations` 台账 head = `0064_ad_board.sql`（前两行 0063/0062）；生产转会名单存量 1 人且 `transfer_listed_at` 全 NULL（历史不回填的既定口径））再 push `dc36971..3306bb3`（10 枚 = 本版 spec 1 + A/B/C/D 四枚 + 增补四枚 + 既存 v6.30.0 回写 1）触发 CF 自动部署 ⇒ 生产 Version **`366b2439-51e3-4e46-9d6b-7e51082ded1c`** @2026-10-05T02:09:07.039901Z；上线回读：`/api/health` 三检 ok（d1/tour_db/kv）、入口 `assets/index-CNaikSfR.js`（sha256 `87ece5e5cce8908235762ad1f0929e5c148e80ee7b20ed3f5c5d233b5c94e089`，608517 B）/ CSS `assets/index-CDCHJSke.css`（sha256 `037c245f4092c11c89f5f33a5bc929e943259f4369ab6b5b70a2317c1d78db66`，63810 B）/ 懒加载 `assets/MarketAdBoardPage-DqAVvjIt.js`（sha256 `2124274231a280dad044b5fc18173b6db638c94dbc4951a67bfb9614c61e5c2e`）与本地 `web/dist` **逐字节一致**、worker 代码直读（CF API `workers/scripts/whl-club/content/v2`，1586323 B）含 **`market-transfer-board:${limit}`（旧键形 `${limit}:${bucket}` **0 处**，P1-2 机制修复确已上线）**、`shuffleWithSeed` ×3 / `transferBoardBucket` ×3 / `TRANSFER_BOARD_ROTATE_MS` ×2、公开端点 `GET /api/market/transfer-board` 200（`total=1`、18 字段、样本 `Bryan Mbeumo` id 67 emphasis 0 `minOfferPrice` 18）/ SPA `/market/board`·`/market`·`/players`·`/clubs` 全 200、需登录端点一律 401（`/api/admin/overview`·`/api/admin/clubs`·`/api/admin/config`·`/api/admin/shop/orders`·`/api/admin/m0`·`/api/admin/market/pause-bids`）、**生产真实浏览器探针（Playwright + 系统 Chrome，临时脚本不入库）10/10**：板页说明文案逐字一致 / 1 张普通卡（`Bryan Mbeumo` · 最低报价 18.00 m）/ 「换一批」按规则隐藏（普通档 < 2）/ `/market` teaser 在场 + 文案逐字「各队公开挂出的转会名单。」+ 入口 `查看全部 1 人 →` → `/market/board` + 1 张迷你卡 / 375 宽零横向溢出（scrollWidth 360 / client 375）/ 零未捕获前端错误）。**生产数据现实（如实登记）**：转会名单只有 1 人 ⇒ 广告板只 1 张卡、「换一批」不渲染、置顶带整条不渲染；`player_promotions` 0 行 ⇒ 着重度恒为普通档，三档五杠杆要等「列入转会名单时的有偿选项」付费写路径落地才有真实数据。用户令：brainstorming「增加一个页面用于展示各队列入转会名单的球员（类似广告板），预留不同着重度的展示接口」；四问答复 = 只收转会名单（`players.transfer_listed = 1`，与既有「在售市场」的 listings 挂牌竞价互补）/ 着重度是为「**列入转会名单时的有偿选项**」预留的接口（付费流程本版不实现）/ 转会中心新增项但插入位置不在最末、并在 `/market` 的转会区之上加小卡片兼作入口 / 名单内球员最低报价公开。视觉定稿（brainstorming 视觉伴侣四屏 + 用户四选）：结构 = **顶部置顶带 + 卡栅格**、置顶区**纵向堆叠**（几条通栏就几行）、小卡片 = **三张迷你卡**、命名「**广告板**」、着重度**三档五杠杆**（0 普通 / 1 推荐 = 金色左轨 + 名字加粗 + 橙角标 / 2 置顶 = 金边 + 淡金渐变底 + 名字加大 + 金角标 + 置顶带内通栏；「预留更醒目手段」即这套可扩展的杠杆表）。**迁移 `0064_ad_board.sql`**：`players.transfer_listed_at TEXT`（进名单首戳；重复保存保留原戳；退出名单置 NULL；**历史存量不回填**）+ 表 `player_promotions`（`id/player_id/club_id/tier/cost/ref_type/ref_id/starts_at/ends_at/created_at`，有效 = `ends_at > now`；**本版只有读路径**，付费写路径形态写进设计文档）+ 部分索引 `idx_players_transfer_listed ON players(id) WHERE transfer_listed = 1` + `idx_player_promotions_active (player_id, ends_at)`。**打戳**：`src/worker/offers.ts` 的 `setOfferSettings` 单条 UPDATE 加 `transfer_listed_at = CASE WHEN ? = 1 THEN COALESCE(transfer_listed_at, <now>) ELSE NULL END`，第 5 个绑定值与 `transfer_listed` 同值（复用入参、不新增形参），守卫与审计零改动。**端点 `GET /api/market/transfer-board`**（`src/worker/routes/market.ts`）：公开 + `assertPublicRate('market')` + `cachedJson`（缓存键**含 limit**，TTL 走 market 1h；写路径 `/api/players` 前缀自动 purge 全部公开 scope ⇒ 改报价设置后立即新鲜，不陈旧到 TTL）；只收 `transfer_listed = 1`；`LEFT JOIN clubs` 取队名、`LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1` 取违约金；`ROW_NUMBER()` 取每球员**现行最高档**推广（同档取最晚到期，过期不算，tier 越界按 0）；`ORDER BY 着重度 DESC → 挂出时间 DESC（NULL 当最旧）→ id DESC`；`COUNT(*) OVER ()` 出 `total`（与 limit 解耦）；limit 默认与上限 200、非整数 / ≤0 / 空串一律回落默认；行 19 字段含 `minOfferPrice`（**数值公开**，用户拍板）、`releaseFee`、`listedAt`、`emphasis`、`emphasisUntil`、`notForSale`、`transferPriced`。**前端**：新公开页 `/market/board`（`web/src/pages/market/MarketAdBoardPage.tsx` = h1「转会市场 · 广告板」+ `MarketNav` + 说明行 + 单面板：置顶带（**无置顶整条连标题一起消失**）→ 卡栅格 → 截断提示「共 N 人在名单，这里展示前 M 人」→ 状态图例；空态「现在没有球队挂出转会名单。」）；`MarketNav` 五项 → **六项**（「广告板」插在「在售市场」之后）；`/market` 顶部 `AdBoardTeaser`（三张迷你卡 + 「查看全部 N 人 →」，**无数据整块不渲染**，用 `compareDocumentPosition` 钉在转会区之上）；`web/src/lib/datetime.ts` 新增 `fmtAgo`（今天 / 昨天 / N 天前，按**显示时区**日历日算差，页面不许自算相对时间）；`web/src/styles.css` 新增 ⑨ 区块 `.adb-*`（≤820/≤640 折叠 + reduced-motion；**不引新色**——淡金底取既有 `.badge.gold` 底色 `#f5e8cf`）。**测试**：`tests/ad-board.test.ts`（9 例：名单口径 / 排序三键 / 着重度最高档与过期与越界 / limit 五态 / 行字段 / 缓存与写后新鲜度）、`tests/offers.test.ts` 打戳 3 例（首戳 / 保戳 / 清戳）、`web/src/pages/market/MarketAdBoardPage.test.tsx`（14 例）、`web/src/lib/datetime.test.tsx` fmtAgo 4 例（含「按日历日不是 24 小时差」与换时区口径）、`tests/mobile-baseline.test.ts`（`TSX_BASELINE` 52 → **77** 重设 + MarketNav 六项 + TC-SWP-05 改按 `@media` 块配平取正文，不再尾切）、e2e 新增 **⑤e 场景**（21 → **22** 场景：板页两区 + 置顶带标题两段 DOM + 截断 + 图例 + teaser 位置与空数据双态；⑫ 375 宽零溢出 29 路由）。验收：typecheck 三份全清、vitest **89 文件 / 1482 例**全绿（v6.30.0 基线 87/1452，净 +2 文件 / +30 例）、build 成功 3.86s、e2e **22/22**；测试计划 `docs/test-plans/v6.31.0-ad-board.md`（A 14 / B 4 / C 10 / D 6 / E 6 共 40 TC + 变异 M1–M24）；变异实跑 21 条 **20 条变红且红的都是对应断言**（M1–M14、M16–M20、M22、M24），M11 经 17 类输入实测证明**等价**（`Number('')` 已是 0，被 `parsed > 0` 拒掉，删 `trim` 判断行为不变）、M15 为 SQLite 等价变异（NULL 排序）、M21/M23 只能靠 e2e 375 视口验（已由 ⑫ 全路由零溢出兜底）；判级 **minor**（新增用户可见能力，零跨仓）。设计 spec `docs/superpowers/specs/2026-10-05-transfer-ad-board-design.md`。

**增补（同日收口）· 普通档轮换 + 手动「换一批」**：用户追问「列入转会名单但没有有偿提升优先级的，每次展示顺序随机？」⇒ 三选一答复「**1，也支持用户手动按键变换顺序**」。落地：新纯函数模块 `src/core/ad-board.ts`（`TRANSFER_BOARD_ROTATE_MS = 5 * 60_000`、`transferBoardBucket(nowMs) = Math.floor(nowMs / TRANSFER_BOARD_ROTATE_MS)`、种子化 `shuffleWithSeed`（mulberry32 + Fisher–Yates，返回新数组）—— **必须种子化**：同一份缓存值会被多个 isolate / colo 读到，它们必须算出同一排列，否则同一时刻不同 isolate 顺序不一致、用户刷新一下顺序就变）；**洗牌放在 `cachedJson` 之后、缓存键只有 limit**（`` `market-transfer-board:${limit}` ``）—— 桶号若进键，本端点重读会从 `86400÷1h = 24` 抬到 `86400÷5min = 288` 次/天/形状/colo（**12 倍**，code-review P1-2 判为读量预算违规后改成「洗牌出缓存」；仓库预算模型见 `src/lib/cache-policy.ts:5-7`，`roster` 就是为此拉长 TTL 的先例），出缓存后按 `emphasis !== 0` / `=== 0` 分流并**只洗普通档** `[...paid, ...shuffleWithSeed(unpinned, transferBoardBucket(Date.now()))]`（缓存值不可原地改，必须新建数组）（付费档保持 SQL 序 ⇒ 付费位相对位置与「按到期时间排」语义不受轮换影响；SQL 尾键 `id DESC` 仍是洗牌输入序，保证同桶内跨 isolate 输入一致）；页面说明行改 flex 行 + 「换一批」按钮（`ShuffleIcon` 手绘线稿，仅当普通档 ≥ 2 时渲染），点击用 `Math.random()` **本地**重排普通档（最多试 8 次取第一个与当前不同的排列，兜底 `reverse()`；纯客户端、不打端点、不动付费档），状态 `manualIds` 只存 id 序列并以「长度相等 ∧ id 集包含」守卫，名单增减即回落服务端桶序（重挂载/重取数也回落，属预期）。测试：`tests/ad-board.test.ts` 9 → **14 例**（新增轮换 3 + core 2）、`web/src/pages/market/MarketAdBoardPage.test.tsx` 14 → **18 例**（含「名单变短回落」「名单变长回落」两条守卫用例）、e2e **⑤e 扩夹具**（第 4 行普通档姆巴佩 + route 按 `?limit=` 切片 + 栅格 2→3 + 「展示前 4 人」+ 换序断言）。验收：typecheck 三份清、vitest **89 文件 / 1491 例**全绿（本增量 +9 = 后端 5 + 前端 4）、build 成功 9.95s、e2e **22/22**；变异 M25–M35 **11 条全红**（不洗牌 / 连付费档一起洗 / **桶号进缓存键（P1-2 回归哨兵）** / 洗牌不种子化 / 桶长写错 / reshuffle 空转 / 按钮守卫放宽 / SQL 尾键翻转 / 点击只回落 / 守卫去长度项 / 种子与桶号脱钩；**M34 首轮未逮住**——只测「变短」时 id 集检查已覆盖该分支，补「变长」用例 TC-ADB-69 后判红）；测试计划 `docs/test-plans/v6.31.0-ad-board.md` §7 已按实跑回填（TC-ADB-56–69 + M25–M35 表 + §7.5 执行结果 + **§7.6 code-review 处置**：P0 0 / P1 2 / P2 5，P1-2 改机制、P2-3 `:focus-visible` 与 P1-1/P2-4 文档笔误已修，P2-1 只换顺序不换成员、P2-2 `reshuffle` 闭包语义、P2-5 未跟踪杂物登记不改）；spec 增补 §3.3 排序与轮换口径（§0 裁决第 10 条）。版本仍为 **6.31.0**（同一未发布版本内的增补）。

## [v6.30.0] · 球队中心页签化 + 三类施工开窗闸 + 两表列集重定（2026-10-04）

**已上线**（2026-10-04，用户令「发布」；**零迁移**——本版不碰 `src/db/migrations/`。发布顺序硬约束执行到位：先 `npm run db:migrate:remote` apply 并行流 `0063`（v6.29.0）**@2026-10-04T14:55:43Z**（16 commands / 18.07ms；回读 head 已记该行、`offers.season`/`window_seq` 放开可空、`fund_holds_offer_guard` 触发器与 5 个索引在场、`offers`/`offer_events` 两表 0 行不变）再 push `03b0513..dc36971`（13 枚）触发 CF 自动部署 ⇒ 生产 Version **`b4face69-61fd-4bce-bf5b-b1880552014a`** @2026-10-04T14:57:00.774Z；上线回读：`/api/health` 三检 ok、入口 `assets/index-KVVKruya.js`（sha256 `ebf398e17240fbad938e817dc21d520e3edafce42b0a5afa8a383550245b90fa`）/ CSS `index-DSXwwKYB.css`（sha256 `cd5cfbcfd1ed1132e8df9cee0919dbc82510378a9ca5a1c55b6d277420a3e467`）/ 懒加载 `ShopPage-bcm43L85.js`（sha256 `9bc07ad385a9711d3c2a9439998e3ff672959729db6cec3bb2a674cbe72fe181`，含「转会窗口没开，开窗后才能施工」）与本地 `web/dist` **逐字节一致**、线上版本串 `6.30.0`、线上 CSS 含 `.transfer-status`、worker 代码直读含 `no_window`/`transferPriced`/`transfer_listed`/`not_for_sale`/`markerOf`、SPA 四路由 200、需登录端点一律 401、公开 `GET /api/players` 列表行已带 `transferListed`/`notForSale`/`transferPriced`）。用户 brainstorming「探索球队中心页面信息整理，现在平铺页面太长」+ 追加「顺便修复：球场扩建和升级设施需要开窗才能做」；四问答复 = 自家球队中心优先 / 页签式（Tab + `?tab=` 深链）/ 可激进删减（清单逐条确认）/ 桌面与 375 都要好用。**A 段（球队中心页签化）**：`web/src/pages/ClubDetail.tsx` 544 → 156 行只留页头 + 页签壳（`.seg.dossier-tabs` `role=radiogroup`；自家 `OWN_TABS` 五个 = 工作台/阵容/转会/战绩/主场，访客 `GUEST_TABS` 三个 = 阵容/转会/战绩；默认落第一个可见页签，非法值与无权页签**回落且不改写 URL**；页头常驻队徽·队名·分级/CPU/排名徽章，自家多一行状态 资金·一线队人数·当前窗口），原教练台 `web/src/pages/club/CoachPanel.tsx`（813 行）拆成 `parts.tsx`（共享小件）+ `SquadTab`/`TransfersTab`/`ResultsTab`/`VenueTab`/`DeskTab` 五个页签并删除；**按需加载**——常驻只有 detail/standing/me-club 三个请求，其余端点只在激活页签挂载（自家首屏 4–5 个 vs 改造前恒定 7 个）。删减清单落地：① 删消费中心入口大卡（降级为主场页签一行「去消费中心经营设施 →」）② 删 `.card.club-head` 三格卡（并进页头状态行）③ 删位置分布档内细位明细（四档改一行文字 `.club-position-line`）④（总身价→青训人数）**用户否决、保留总身价** ⑤⑥ 两表列集重定 ⑦ 近期事件表默认折叠 `<details>` ⑧ 保留年龄直方图/CA 堆叠/效力年限图/联赛排名/近期战绩/禁令 banner/页头徽章/名单 >100「查看更多」。**B 段（三类施工开窗闸）**：`expandStadium`（`src/worker/stadium-ops.ts:117-119`）/ `upgradeStadiumTier`（`:189`）/ `upgradeFacilityLevel`（`:255`）在参数与状态校验之后、`payAndRefund` 之前插 `getOpenWindow` 闸 → 409 `no_window`（文案「转会窗口没开，现在不能扩建球场 / 升级球场档位 / 升级设施」，参数非法仍先报 400）；`GET /api/club/stadium/build-info` 下发 `open: win !== null`（与三闸同源），前端 `web/src/pages/shop/venueCards.tsx` 三类按钮按 `open` 置灰 + 卡内提示 `CLOSED_BUILD_HINT`。**C 段（两表列集重定 + 转会状态图标）**：新建 `web/src/lib/club-columns.tsx` 共享列系统——阵容名单 11 固定列（标记/号码/UID/姓名/年龄/位置/CA/PA/违约金/工资/转会状态）+ 注册名单 11 固定列（**分配最左** + 其余同序去掉转会状态）+ 可选列池 16 项（球员库 `COL_DEFS` 去掉工资/解约金；默认全不显示；`?cols=` / `?regcols=` 两个键分开、与 `?tab=` 互不干扰）；新建 `web/src/components/StatusIcons.tsx` 手绘 SVG 线稿四态（拍卖锤 挂牌中 > 清单 转会名单 > 欧元 已标价 > 锁 非卖品；单元格只出图标、全称走 `title`/`aria-label`，窄屏靠表下一行图例）；后端 `GET /api/players` 列表行补 `transferListed`/`notForSale`/`transferPriced`（**`min_offer_price` 数值绝不下发**）、`GET /api/club/squad` 补可选列所需字段（`marker` 走 `markerOf(base_ca ?? ca, pa, growable, ca)`，与详情页逐字同口径）；球员库改从共享模块取渲染器（import + re-export，列集与行为零变化）；窄屏粘性列（阵容 ≤760 钉「标记+号码+姓名」、注册 ≤640 钉「分配+姓名」，`:has()` 认表不误伤同 class 的主场战报表）。验收：typecheck 三份全清、vitest **87 文件 / 1452 例**全绿（v6.29.0 基线 85/1419，本版净 +2 文件 / +33 例）、build 成功 3.99s、e2e **21/21**（⑨ 球队页三视口逐页签、⑮ 粘性几何、⑫ 375 宽零溢出 28 路由）；测试计划 `docs/test-plans/v6.30.0-club-center-rework.md`（A 13 / B 8 / C 12 共 33 TC + 变异 M1–M18）；判级 **minor**（新增用户可见能力 + 三类施工收紧，零迁移零跨仓）。同工作区并行流 v6.29.0「关窗期报价与意向单 + 消费提交开窗闸」已由另一会话收口（两版共用 `409 no_window` 口径、分枚提交互不夹带）。

## [v6.29.0] · 关窗期报价与意向单 + 消费提交开窗闸（2026-10-04）

**本地收口待发布**（迁移 `0063` 生产未 apply，发布顺序 = 先 `npm run db:migrate:remote` 再 push；push 即 CF 自动部署上线）。同工作区并行流「球队中心页签化 + 三类施工开窗闸」经用户裁决另立 **v6.30.0**，两版共用 `409 no_window` 口径、分枚提交互不夹带——本版只落消费工单闸，施工三闸（扩建球场 / 升级档位 / 升级设施）归 v6.30.0。用户令：「消费项目也是开窗才能做，同时未开窗时开放报价，如果成交挂为意向单，开窗时提醒双方。」**范围裁决**（AskUserQuestion）：① 消费与转会两块都改；② 意向单开窗后**只提醒、卖方手动确认**（不自动推进、不直接过户；卖方开窗后手动再点一次同意才生成挂牌，买方随时可撤、卖方开窗后可放弃）；③ 消费闸含五类商品与设施升级同口径（本版落消费工单闸）。

**转会侧（放开关窗期报价）**：`placeOffer`（`src/worker/offers.ts:117`）与 `counterOffer`（`:252`）删掉窗闸；`acceptOffer`（`:563`）按窗态分流——窗口开着照旧 `accepted` + 立即挂牌，窗口关着落 `offers.status='intent'`（**意向单**：不挂牌、不动兄弟 pending 单、买方冻结继续保持），关窗期达线自动同意同样只落意向单（否则会写出 `season`/`window_seq` 为 NULL 的挂牌）；`expireStaleOffers`（`:628-691`）删掉「窗关即过期」条件，只剩球员状态变化自愈（过期 reason 不再有 `window`）。**一球员一意向单两处硬锁**：`enterIntent`（`:524`）带 `NOT EXISTS` 原子闸（已有意向单时同意另一条 pending → 409 `intent_exists`）、挂牌端点（`src/worker/routes/market.ts:240`）同码拦下（窗口开着也不给挂）；非卖方确认 409 `intent_seller_only`、卖方无窗确认 409 `no_window`。**开窗联动**：`src/worker/window-machine.ts:206-224` 开窗批提交成功后双方各排一条 `offer_intent_window_open`（提醒失败只吞异常，不影响开窗已提交）；卖方确认走既有挂牌链路（归到当前开着的窗 + 挂牌 + 兄弟单 `offer_expired`(reason `sold`) + hold 转正 + 领先出价 + `confirm` 事件 + 买方 `offer_intent_confirmed`），买方撤回（`withdraw`）与卖方放弃（`reject`）都释放冻结并给对方 `offer_intent_closed`（`data.action` 区分）；通知模板 4 个（`offer_intent_created` / `offer_intent_window_open` / `offer_intent_confirmed` / `offer_intent_closed`）。

**消费侧（关窗期收紧）**：`POST /api/shop/orders`（`src/worker/routes/shop.ts:97`）在花费逻辑前、403 绑定检查后加 `getOpenWindow` 闸，关窗 409 `no_window`；GET 读路径、管理端代录（external 两步流）、工单审批与拒绝都不受影响（存量 pending 单关窗后照常审批）；档期、冠名等既有动作口径不变。

**迁移与前端**：`src/db/migrations/0063_offers_intent.sql` 重建 `offers` 与 `offer_events`（`season`/`window_seq` 放开可空 + `offer_events.kind` 注释增 `intent`/`confirm`），`fund_holds_offer_guard` 触发器及 4 条索引（`idx_offers_seller` / `idx_offers_buyer` / `idx_offers_player` / 唯一部分索引 `idx_offers_active_pair`）逐字复原，`tests/d1.ts` 的 `MIGRATION_FILES` 显式清单加登记。前端：`OffersSection.tsx` 徽标「意向单·等开窗」+ 谈判桌按角色分派动作（卖方确认挂牌 / 放弃，买方只有撤回）、`SideOps.tsx:696` 报价按钮关窗不再置灰、`MarketDeskPage.tsx`（`OFFER_STATUS_FILTERS` 加 `intent`、「我收到的」页签 `intentsMine` 徽标）、`ShopPage.tsx` 与 `venueCards.tsx` 关窗态提示、`web/src/lib/api.ts`（`OfferStatus` 加 `'intent'` + `intentsMine`）。

**验收与测试**：typecheck 三份全清、vitest **85 文件 / 1419 例**全绿（含并行流用例）。测试计划 `docs/test-plans/v6.29.0-offer-intent-shop-gate.md`（TC-INT 15 / TC-PEND 2 / TC-WIN 1 / TC-D 5 / TC-UI 6 / TC-MIG-03 + 变异 10 条）；新文件 `tests/offer-intents.test.ts`（15 例）、`web/src/pages/market/desk/OffersSection.test.tsx`（6 例）；`tests/shop-orders.test.ts:626` TC-D01–D05、`tests/window-machine.test.ts:139`、`tests/offers.test.ts` 改写两例；`tests/weather-forecast.test.ts` 的 `MIGRATION_FILES` 登记校验由「尾部锁死 0062」改为版本无关（取 `src/db/migrations` 目录按名排序最新一枚比对，加 0063 后原断言必红，已验证非空转）。判级 **minor**。实现动线：后端报价链 / 测试计划与用例 / 前端三个 subagent 并行（文件面不相交），主会话集成验收与提交。

## [v6.28.0] · 影响力体系：级别系数 + 死忠每场演化（2026-10-04）

**A 段（公式）**：球队总影响力改为 **(队壳 + 阵容) × 级别系数 + 奖励分**——级别系数进 config 新键 `influence_tier_coefs`（默认 `{"premier":1.2,"second":1.0}`，逐档兜底、坏 JSON 回出厂值不炸上座钩子）；级别一律按 `deriveClubTier` 报名派生（**不读** `clubs.league_tier` 休眠列），未定级/未报名 → 系数 1.0（CPU 队即此情形）。`teamInfluence(stadium, playerSum, tierCoef)` 第三参**必填**（防漏传静默降级）；上座 demand 的对手系数与死忠目标同源（都用同一 `homeInfluence`），管理端详情/CPU 向导预览/seed-ops 用同一套系数（seed-ops 不拿表单级别当系数）。**B 段（死忠每场演化）**：赛果确认钩子④里死忠即时演化一次（比赛日体感），与上座/收入同批原子落账，系数走 config 新键 `fans_grow_rate_per_match` / `fans_drop_rate_per_match`（默认 `0.2` = 窗系数 `0.5` × 0.4），幂等闸仍是 `match_attendance` 主键；关窗批对**本窗有主场场次**的队不再演化（防双记账，现值即窗末值），只对无主场场次的队按窗系数兜底演化一次；窗级事件信号 `fan_mood` **按窗一次**、放在演化之后（不随每场重复、防放大）。迁移 `0062_stadiums_fans_window_start.sql`（`stadiums` 加列 `fans_window_start`，本窗开始时的 fans）：关窗批每队无条件把快照推进到窗末值，冠名对赌的 `fansGrowth` 按「窗初快照 → 窗末」算（拿现值当基准会把增长率算成 0）——**发布顺序硬约束：先 apply 0062 再 push**。**C 段（生产数据批，独立等授权）**：`scripts/prod-20261004-influence-recalc/`——四步 CLI（snapshot/plan/apply/verify）+ 纯函数重演引擎（逐因子镜像运行期口径）+ 20 队图值 `values.json` + 交叉验证闸 `tests/influence-recalc-engine.test.ts`（19 例：常量镜像、纯函数矩阵、钩子④落库值对拍、链式推进、账本链重放）；apply 默认只打印、`--yes` 才先备份再逐文件执行（**已执行**，见文末）。干跑（初值一律 1800 口径）：fans 28800 → 52024.14、上座 699921 → 972885、比赛日收入 104.96 → 145.96、账本总额 919.16 → 960.16；14 场需求≥容量走 sell_out_fill。执行顺序：**0062 → 代码上线 → `apply --yes` → `verify`**；皇马（`243`）奖励分由用户补值为 0（`values.json` 落 `bonus_source: "given"`，plan 待补条目清零）。**D 段（管理端导航）**：侧栏 12 项归四域（赛事运营 / 球队与名册 / 转会与经营 / 系统，总览不套组标题、`to=` 全不变），「消费」改「消费工单」；**E 段（总览）**：补「待审消费工单」（`shop_orders.status='pending'`）与「待选事件」（`status='pending' AND event_type='choice'`，即发型残留 pending 不计）两卡（6 → 8 张）。评审修复：两处影响力构成文案（教练台主场档案卡 + 管理端球场卡）改为「（球员 + 队壳）× 级别系数 + 奖励分」——旧加法文案在系数 ≠ 1 时与总数对不上，payload 补 `influence.tierCoef` + `web/src/lib/influence.ts` 格式化。测试计划 `docs/test-plans/v6.28.0-influence-system.md`（A–E 五块 42 TC + 变异 M1–M17）；验收：typecheck 三份全清、vitest **82 文件 / 1369 例**全绿（v6.27.0 基线 78/1331，净 +4 文件 / +38 例）、build 成功、e2e **21/21**（⑫ 375 宽零溢出扫描 28 路由）；变异 M1–M17 十九条全命中（M9 含 a/c/d 三变体：丢 mood / 顺序错 / 顺序错+放大）。判级 minor（新增用户可见能力；无跨仓消费）。**已上线**（2026-10-04，用户令「1发布2执行 3皇马奖励分是0」）：迁移 `0062` 先 apply @11:21:42Z（回读：`fans_window_start` 列 `REAL NOT NULL DEFAULT 0`、16 行 `= fans`）→ push `2736413..03b0513`（6 提交）⇒ 本仓 Version **`7ecb15a1-a8f6-4b16-974c-f810bed52370`** @2026-10-04T11:22:42.102Z（deployment `22d383f5-07d1-4632-973e-57067c911612`）。上线回读：`/api/health` 三检 ok；入口 `assets/index-C_-lc4t5.js`、CSS `index-d1JcVntj.css`、懒加载块 `AdminLayout-DlR4_BEm.js` / `OverviewPage-DC5o3RDb.js` 的 sha256 与本地 `web/dist` **逐字节一致**（入口含版本串 `6.28.0`、CSS 含 `.admin-nav-group-title`）；线上 worker 代码（CF API `/content/v2`）含 `influence_tier_coefs` / `fans_window_start` / `fans_grow_rate_per_match`；`/api/admin/*` 未认证一律 401。**C 段数据批已执行**：`apply --yes` @11:26:03.237Z（先全量备份到 `backup/2026-10-04T11-25-23-869Z/` + 落 `applied.marker`，**293 条语句 / 5 个 SQL 文件**全部 `success: true`）→ `verify` **9/9 PASS**；独立通道（CF REST D1 query）回读：fans 合计 **52024.143496**（16 队，`fans_window_start` 同值）、上座 **972885**、比赛日收入 **145.96**、账本总额 **960.16**，16 队壳/奖励分与 `values.json` 图值逐字相等、4 支 CPU 队无 stadium 行；回滚走 `sql/99-rollback.sql`（320 条逐行还原，含新列）。**执行后已 purge 公开读缓存**：本批经 `wrangler d1 execute` 直写 D1、绕过 worker 写路径 ⇒ `purgePublicCaches` 不会自动跑，而公开缓存新鲜度靠写路径 purge（TTL 只是兜底：`fixtures` 1h / `clubs` 24h），故把代际键 `cache:epoch:public` 由 **6 → 7**（CF REST，与任一管理端写操作同效）；purge 后走公开读路径端到端对拍 `GET /api/fixtures`（tournament 1/2/3 × round 1–7，浏览器 UA）取到 **78 场**有上座场次，逐场与 `plan.json` 的 `matchPlans[].after.attendance` **一致 78 / 不一致 0**。

## [v6.27.0] · CPU 队接管向导：管理端五步把 CPU 队转人类队（2026-10-04）

管理端新增「CPU 接管向导」——把生产 4 支 CPU 队（曼城 `10` / 巴塞罗那 `241` / RB莱比锡 `112172` / AC米兰 `131681`）转成人类俱乐部，管理员零 SQL、零跨仓操作。**跨仓（tour 仓 v5.2.0）**：新增 `POST /api/internal/team-rename`——HMAC 与 team-upsert 逐字同口径（签名串 `POST|{path}|{ts}|{raw}` 含路径、±300s 窗口、`timingSafeEqual` 定长比较、未配 503 / 错签 403）；体 `{id,name}`，名已同则早退 `{renamed:false}`，撞名 409 指名占用者，写审计；审计 `actor_user_id` 放开可空 ⇒ 迁移 `0025_audit_actor_nullable.sql` 重建 `audit_log`（**部署顺序硬约束：先 apply 0025 再部署 worker**，否则审计 INSERT 撞 NOT NULL 整批回滚报 500）。**本仓**：`tourClient.pushTeamRename`（永不抛错、10s 超时）+ 四端点全走权限 `club.clubs.manage` 并写审计——`GET cpu-convert`（状态聚合 + 图值预设）、`POST rename-tour`（前置 `is_cpu=1`，代调 tour，失败 502 且本仓零改动可重试）、`POST rename-local`（`UPDATE clubs SET name=?, is_cpu=0 WHERE id=? AND is_cpu=1` 幂等摘标，撞名 409）、`POST seed-ops`（一次 batch 全幂等：主场 12000/0 级/壳奖励按入参/fans 公式现算 + 账本 0 余额 + 五设施 0 级 + 联赛级别）。**前端**：新页 `web/src/pages/admin/CpuConvertPage.tsx`（路由 `/admin/clubs/cpu-convert`，侧栏不加项；五步卡片，步 4 复用 `POST /api/admin/clubs/:id/bindcode` 发认证码、步 5 绑定确认 + 异常解绑兜底），入口两处（球队页 CPU 行「接管向导」按钮 + 总览「CPU 队」卡）；无 `?id=` 时显示 CPU 队选择器。测试计划 `docs/test-plans/v6.27.0-cpu-convert-guide.md`（A/B/C/D 四块 27 TC + 变异 M1–M8）。验收：typecheck 三份全清、vitest **78 文件 / 1331 例**全绿（v6.26.1 基线 75/1298，净 +3 文件 / +33 例）、build 成功、e2e **21/21**（⑫ 375 宽零溢出扫描补 `/admin/clubs/cpu-convert`）；变异 M1–M10 十处全命中。判级 minor（新增用户可见能力）。**已上线**（2026-10-04，用户令「都发布」）：tour 仓先 apply 迁移 `0025` @04:42:14Z（回读 `audit_log` 783 行不变、`actor_user_id` 可空、两索引重建）再 push `65602ff..ecfbecd` ⇒ tour Version `b909e20b-ff8b-4e78-8423-c5165f63e60e` @04:43:42.739Z；本仓零迁移随其后，push `ea0e113..2736413` ⇒ 本仓 Version `41f3aa1a-4f35-420a-931b-0e417f5fc955` @04:45:41.680Z；上线回读：health 三检全 ok、四端点未认证 401、SPA 页 200、线上版本串 `6.27.0`、tour 无签名请求 403。

## [v6.26.1] · 绿标「练满去标」+ 球员库吸底横向滚动条 + 顶栏消费中心入口（2026-10-03）

三项修正。① 🟢 growth 标记判定加「未练满」（现值 `ca < pa`）——`markerOf` 加第 4 参、`markerWeightSql` 同源表达式与注册合规 `checkSquad` growth 名额三处同步（用户拍板：练满球员不显示绿标也不占 🟢 注册名额）；根因是 `growable` 只在赛季结算/建季重算、`applyLevelUp` 抬 CA 不即时归零，练满球员一直挂绿标。判定表达式变更 ⇒ 迁移 `0061` DROP 后按新表达式重建 `idx_players_sort_marker`（apply 写 ≈18.3k 行；不重建则 `sort=marker`/`?marker=` 退化整表扫）；keyset 游标结构不变。语义注：练满球员再买 PA（抬高 PA）后 `ca<pa` 重新成立，绿标回归——设计使然；离队恢复初始 CA 同理。② 球员库表格吸底镜像横向滚动条（visual companion 三方案可操作演示，用户选 A）：`StickyScrollbar` 组件 sticky bottom:0 镜像轨 + 双向 scrollLeft 同步（syncing 标志防回环）+ ResizeObserver，只挂球员库桌面（>900px，窄屏是卡片网格），`.table-wrap` 的 overflow/position 一字不动（e2e ⑪ 依赖、粘列组件靠其滚动上下文）。e2e ⑪/⑧ 表格探针补**双向**同步断言——变异 M4 暴露单向覆盖缺口后补齐，反向微变异恰好红在目标断言。③ TopBar 补「消费中心」NavLink（v6.26.0 漏了顶栏入口）+ CoachPanel 注册规则文案加「且未练满」。测试计划 `docs/test-plans/v6.26.1-marker-scrollbar.md`（15 TC + 变异 M1–M4）；验收：typecheck 三份清、vitest 75 文件 / 1298 例全绿（净 +1）、e2e 21/21、变异 M1–M3 命中 + M4 补探针后命中。判级 patch。**已上线**（2026-10-04 发布：迁移 `0061` 先 apply 到生产（`Executed 3 commands in 63.62ms`，核验 `idx_players_sort_marker` 新表达式含 `AND ca < pa`），push `7381009..ea0e113` 触发 CF 自动部署 Version `3864ac6b-fd57-404b-b4d9-845c6c17ae48` @2026-10-04T02:27:41Z；上线回读含练满语义生产实测——3 名练满球员（Tonali / Szoboszlai / Šeško）`marker` 全 null、`?marker=growth` 全为未练满球员；线上资产与版本串 `6.26.1` 核对一致）。

## [v6.26.0] · 消费中心 + 外部工单：五类商品工单审核制 + 球场消费三卡迁入（2026-10-04）

新增消费中心 `/shop`（B 布局左右分栏：左主栏商品页签 + 球场三卡，右栏我的工单常驻行内展开），教练提交即扣费、管理组审核通过自动改数据 / 拒绝自动退款。五类商品：买 PA（15m/点，上限 `fc26_pa_cap`=95）、徽章（银 4m / 金 8m / 银升金 6m，3 金 12 银，走 `player_playstyles` 明细 source='shop'/'external'）、角色（新增 +5m / ++12m / 单升双 10m / 去除 5m，上限 5 个、只能在注册位置下新增）、位置热区（增 5m / 去除 5m / 替换 8m，主位不可动、GK 三禁、上限 4 个、新增须与现有热区相邻、去除连带清角色）、队壳申请（5m，豪门名单进 `shop_hpremium_clubs` 只拦不收，管理组线下建壳交付绑定码）；**外部工单**（管理端折叠卡代录）：积分兑换 / 奖励等外部增益纯效果单不进账本，创建 → 确认两步。位置相邻关系为固定常量 22 条边（按图像素实测定稿，不用 FC 官方表），前后端同源 + tests 逐值锁。价格全进 `shop_prices` config JSON（12 键）。球场消费三卡（设施经营 / 冠名市场 / 球场档期）自 CoachPanel 整体迁入；账本加「消费」列。迁移 `0060`（shop_orders + player_purchases 台账 + 三 config 键，注册表 72→75）——**发布顺序硬约束：先 apply 迁移再 push**。审批批 = 效果 / 台账 / 审计挂 PENDING_GUARD + 状态流转批末（并发抢单零重复执行）；`ledgerMovement` 语句结构订正（账户批首持守卫、流水以 changes()>0 为闸），修掉带余额守卫时「同批扣款自食流水守卫」的结构缺陷。导入按台账重放保护（PA / 角色 / 位置槽位，整体幂等）。测试计划 `docs/test-plans/v6.26.0-shop.md`；验收：typecheck 三份清、vitest 75 文件 / 1297 例全绿、e2e 21/21、变异 M1–M8 七命中 + M5 覆盖缺口补 TC-A09b2、code-review 修 2 处（zones 定长 4 位防打错槽 / 徽章台账计数钳界）。判级 minor。**已上线**（2026-10-04 发布：迁移 `0060` 先 apply 到生产（`Executed 9 commands in 3.82ms`，核验两表 + 三索引 + 三 config 键在场），push `b75cff5..7381009` 触发 CF 自动部署 Version `9c1eb258-8524-4869-bb0e-9c7369f0a11a` @2026-10-04T00:10:15Z；上线回读 shop 三端点匿名 401、线上资产与版本串 `6.26.0` 核对一致）。

## [v6.25.0] · 显示时区偏好化：内部 UTC 达标 + 外部显示可调默认北京（2026-10-03）

四仓时区普查确认存储层已一致 UTC ISO TEXT ⇒ 内部零改动；本版只做展示层。新增 `web/src/lib/datetime.ts` 共享时区层：偏好三档（北京时间默认 / UTC / 跟随浏览器）存 localStorage 键 `whl.tz`，`whl:tz-change` 自定义事件 + `storage` 事件双同步（本页即切、跨标签页跟随），消费端唯一入口 `useTimeFmt()`（`time/dateTime/date/label`），Intl zh-CN `formatToParts` 短横线格式、null/非法 ISO 统一 `'—'`。顶栏时钟图标下拉（未登录也可见）+ 收件篮信封图标化（未读红点锚图标右上、条数播报不变）。全站时间消费点收敛 22 处：裸切片 18 + 纯日期切片 4 + 浏览器本地 `getHours` 2 处，CoachPanel 硬编码「（UTC）」改随档标注；静态锁 `tests/datetime-display.test.ts` 锁死 Intl 单点化与裸切片清零。倒计时读秒不动（绝对时刻差与时区无关）。e2e ⑰：时钟下拉切 UTC 时间串即变 + 收件篮图标化 + Esc 关闭。验收：typecheck 三份清、vitest 74 文件 / 1271 例全绿、e2e 20/20、code-review 修 4 处（含 ClubsPage 过期时间死分支）。判级 minor（纯展示层，服务端判定零改动）。**已上线**（2026-10-03 与 v6.24.1 同批 push `3842154..b75cff5`，CF 自动部署 Version `cfb72cf3-b23d-45fa-82a0-256110468917` @2026-10-03T16:36:14Z；线上资产与本地构建 sha256 一致、线上版本串 `6.25.0`）。

## [v6.24.1] · 强制拍卖并入统一截止规则（2026-10-03）

用户裁决：除激活首价窗外，一切挂牌都遵循同一套截止时间规则，强制拍卖也不例外（反转 v6.24.0 评审 P0-2 的豁免口径——当时为躲「幻影倒计时」选择不落列不显示，正确做法是创建时补落列）。`bypass.ts` createForcedAuction 创建即按 `bidDeadline` 首算落 `deadline_at`；列表/详情展示条件与结算提前收口同步放开 forced（激活 listed 仍豁免，由首价窗判线）。到期无人出价 → 提前下架 + 10% 下架费；窗尾收口与管理方取消出口保留；`ledgerMovement` 幂等闸防双扣费。验收：typecheck 三份清、vitest 72 文件 / 1259 例全绿、变异 2 处恰好各自目标断言红。判级 minor（同仓语义闭环，无跨仓消费）。**已上线**（2026-10-03 与 v6.25.0 同批 push，生产 Version `cfb72cf3-…` @2026-10-03T16:36:14Z）。

## [v6.24.0] · 转会市场改版：三入口统一竞价 + 卡片浮层改版（2026-10-03）

转会规则闭环改版（brainstorming 多轮拍板 + spec 九节 + 计划含九条用户操作流线）：废除「激活跳过竞价」这唯一例外——激活挂牌先进首价窗（5 分钟、仅激活方、价格锁定激活价）落价后转 `bidding` 公开竞价，截止判定与普通挂牌同轨；竞价截止后按卖方合同类型分流（训练营直进待审 / 正式合同开 24h 匹配窗，**匹配基准=竞价最终最高价**，原为首价）。挂牌创建即落 `deadline_at`（listed 也落、无人出价也显示倒计时）、listed 到期提前收口（activation/forced 例外）。**出价只收整数**（激活首价豁免）、出价框预填符合规则的最低出价（ceil 口径）、成功文案「✓ 出价成功（N m），截止时刻已刷新。」。**归零即拒三层**：客户端倒计时归零禁提交、服务端时钟校验过线 409、触发器 `fund_holds_bid_deadline_guard`（迁移 `0059` 重建，新增激活首价窗过线分支）事务内最后防线；结算兜底收口。**前端**：在售市场卡片改 rail 骨架 A（左栏 CA/PA 大数字、`attrClass` 同源五档色阶、TeamLogo、三态徽标、hh:mm:ss 读秒——`use-countdown` 全局单例 + performance 单调差值防校时回拨）；点击开浮层（桌面居中弹层 / ≤760 底部抽屉，出价历史与匹配决定搬入）；转会台 tab 改「签约谈判 / 收到报价 / 我的出价」并删挂牌表单（`?tab=mine` alias）；激活独立页 `/market/activation`（含首价窗出价入口）；MarketNav 五项；暗黑模式修复（`color-scheme: light` + 显式色）与 375px 防折行。**code-review-skill 评审修 2×P0 + 4×P1 + 4×P2**：非整数激活价首价死锁（ask_price 可为 31.5 类保护期倍率，首价路径脱离整数校验）、强制拍卖单被提前下架收费（listed 收口仅对 normal）、结算批内守卫补齐（players/fund_holds/audit 加 EXISTS 守卫）、listed 无活跃出价卡无单据 pending_review + 审计刷行、`BidPlaceResult` 契约同步（deadlineAt/matchPhase:'bidding'）、文案订正（「按竞价最高价成交」）。测试计划 `docs/test-plans/v6.24.0-market-revamp.md`（qa-test-planner：TC-A/B/C 三组 25 例 + 变异 M1–M10 全红 + 评审增补 TC-R01–R08）。typecheck 三份全清、vitest **72 文件 / 1258 例**全绿（v6.23.0 基线 69/1228，净 +3 文件 / +30 例）、e2e **19/19**、build 成功。判级 minor（新增用户可见能力 + 竞价规则闭环；无跨仓消费）。**本地收口待发布**（迁移 `0059` 生产未 apply，发布顺序 = 先 `npm run db:migrate:remote` 再 push；push 即 CF 自动部署上线）。

## [v6.23.0] · 转会中心：市场 / 报价 / 谈判三域前端合并（2026-10-03）

转会信息架构合并（brainstorming 四问拍板：深合并「我的转会台」/ TopBar 三合一「转会中心」/ 旧路由重定向含 box 映射 / 转会流水线 UI 显式呈现）。**新页 `/market/desk`（我的转会台）**：流水线说明条（五段 挂牌/报价→竞价→管理组审核→签约谈判→成约过户 + 机制句「报价被接受 ≠ 成交，同意后自动生成挂牌继续竞价」）→ 待办速览三计数（轮到我 / 进行中谈判 / 竞价中，从同页区块数据派生零额外请求，点击切区）→ 谈判区 → 报价区 → 挂牌+出价区；`?tab=nego|offers|mine` 深链定位（2 秒对齐窗口，滚轮/触摸/按键即停）。**旧 `Offers.tsx` / `Negotiations.tsx` / `MarketMinePage.tsx` 三页删除**，组件原样搬进 `market/desk/`（git rename 86–88%）；`/offers` → `?tab=offers&box=in|out`、`/negotiations` → `?tab=nego`（replace、重定向路由不挂 RequireUser 由 desk 自己拦）；`/market/mine` 退役。TopBar 三入口合一「转会中心」；MarketNav 四项（「我的」→「我的转会台」）；SideOps「我收到的报价」、Home 入口卡同步。阶段徽标：报价行 accepted 改「已接受·挂牌竞价中」、出价行 won+listing 待审核、谈判卡「第一步 · 定违约金 / 工资谈判 · 剩 N 轮」。**评审修三处**：P0 滚动对齐 effect 的时间闸原只挡循环不挡单次对齐，顶栏未读数每 60s 轮询触发 re-render 会把用户从下方区块拽回区块顶（时间闸挪进 align 首行 + deps 换 `myClub?.id` 原始值）；P1 `/api/me/club` 拉取失败被误诊为「未绑定俱乐部」（按 `MyClubState.failed` 分流文案）；顺手修旧谈判子组件 `useToast` 不渲染 `toastNode` 导致操作成功提示永远不显示（随搬家一并修复）。**零后端改动、零迁移、零生产写。**测试计划 `docs/test-plans/v6.23.0-transfer-hub.md`（TC-RED/NAV/AUTH/DESK/BDG/ACT/RESP/LNK 21 例；变异 V1–V8 全红后还原全绿；TC-BDG-02 的出价行「谈判中」阶段因无数据源落空并已在计划内订正）。typecheck 三份全清、vitest **69 文件 / 1228 例**全绿（v6.22.0 基线 69/1225，净 +3 例 = mobile-baseline 新增「转会中心导航静态契约」describe）、e2e **19/19**（基线 16 + ⑤b 换址 / ⑤c 转会台结构 / ⑤d 匿名软提示含经 `/offers` 重定向路径）、build 成功（`MarketDeskPage` 独立 chunk ≈26.6 kB）。判级 minor（新增用户可见能力与信息架构改版；无跨仓消费——三旧路由同仓同批换址）。**已上线**（2026-10-03 发布，push `4b8acc3..147b170` 触发 CF 自动部署，生产 Version `0b2a6b83-cf28-46eb-8ba8-44de771b3c75` @2026-10-03T02:29:32Z；上线回读 health/rumors/deals/listings 全 200、四路径 SPA 入口全 200、线上资产 `index-CIMWGMJC.js` 与本地 6.23.0 重构建 sha256 逐字节一致、线上版本串 `6.23.0`）。

## [v6.22.0] · 窄屏整治第三批：公开阅读页——球员页事件卡 + 参考型宽表粘列 + 顶栏渐隐提档（2026-10-02）

窄屏整治第三批（spec `docs/superpowers/specs/2026-10-02-mobile-public-reading-design.md`，含用户操作流线九条）。**Player 转会/成长两表 ≤760 卡片化**（`useMediaQuery` 两端 DOM 互斥，桌面 1280 逐字节零变化；卡片字段语义逐条照抄表格版）；**参考型宽表粘前两列** `.table-sticky-2` ≤760（市场情报成交表 / 出价历史 / 阵容名单三张裸表，首列三态定宽 `--stky-c1` + `:has()` 认表逐表覆盖）；**`.dossier` 单列断点 640→900**；**顶栏页签渐隐 mask 提档 ≤640→≤1024**（挪走非复制，中屏同样需要滚动提示；TopBar JS 零改动）；**toast 点击穿透**（`pointer-events:none` + 成长录入汇总条在场时 `body:has()` 上抬）。e2e 15→16（⑯ 公开阅读几何：dossier 单列 + 页签横滑 computed 断言 + 事件卡 fit ±1px + intel 粘列第二列留视口 + 无缝 ≤1px）；`tests/mobile-baseline.test.ts` 增 v6.22.0 五例 + 媒体块归属例。零迁移零生产写。**已上线**（2026-10-02 发布，生产 Version `ec101c38-2920-4203-ba70-26616efec815`——push `928834c..543773f` 后 CF Workers Builds 未触发部署，手工 `wrangler deploy` 补齐）。判级 minor。测试计划 `docs/test-plans/v6.22.0-public-reading-mobile.md`（33 TC + 6 变异）；vitest 69 文件 / 1225 例全绿（v6.21.0 基线 69/1219，净 +6 例）、e2e 16/16、code-review P0 0 / P1 1 / P2 3 / P3 3（修登分明）。

**Added**
- Player.tsx 转会记录/成长事件 ≤760 卡片流（event-cards/event-card/event-card-head/event-card-grid/event-card-foot）。
- 三张参考型宽表挂 `className="table-sticky-2"`（MarketIntelPage / MarketBoardPage / ClubDetail）。
- e2e ⑯ 公开阅读几何；静态闸门 v6.22.0 五例 + 媒体块归属例。

**Changed**
- styles.css 新增五块：≤900 dossier 单列 / ≤760 dossier-tabs 横滑 / ≤760 event-cards 铭牌卡 / ≤760 table-sticky-2 粘前两列（`--stky-c1` 默认 6em + `:has()` 逐表 8em/9em）/ toast pointer-events + `body:has(.entry-sumbar)` 上抬；≤1024 顶栏渐隐 mask 块（自 ≤640 挪入）。
- TopBar 页签渐隐从 ≤640 提档到 ≤1024（mask 规则整体挪移，641–1024 中屏同样生效；TopBar JS 无改动）。
- `.dossier` 单列断点 640→900（>900 双栏 280px+1fr 桌面零变化）。

## [v6.21.0] · 窄屏整治第二批：编辑面板卡片化 + 品牌卡 + 教练台粘性列（2026-10-02）

窄屏整治第二批（spec `docs/superpowers/specs/2026-10-02-mobile-remediation-batch2.md`，含用户操作流线与两轮订正记录）。**成长录入 ≤760px 卡片化**：表格/卡片互斥分支（`useMediaQuery`），铭牌卡语言字段网格 2 列（评分 `inputMode=decimal`），已录/训练营/校验问题/脏行状态语义逐条照抄表格版，进球/助攻只读标「自动」；常驻汇总条（本场合计 XP + 脏行数 + 全部保存）`createPortal` 挂 body、`position:fixed` 贴视口底（sticky 在 `.table-wrap` 滚动容器内无行程，评审期再修面板出宽：`container-type:inline-size` + `width:100cqw`，e2e fit ±1px 断言锁死）。**BrandsPage 赞助表 ≤760 卡片化**：brand-card 四控件网格 + brand-card-meta 来源/状态/生效冠名与桌面 8 列对等 + 窄屏新增品牌表单；桌面表格分支含白名单 96/72/84 逐字节保留。**CoachPanel 财务/花名册表 ≤640 粘性前两列**（`coach-sticky`，显式底色防透底）。ImportsPage 核查零改动。e2e 13→15（⑭ 成长补录卡片流含 fit 几何 + POST 拦截 + 回滚幂等、⑮ coach-sticky 条件几何）；`tests/mobile-baseline.test.ts` 增 TC-SWP-05 与 v6.21.0 五静态例。零迁移零生产写。**已上线**（2026-10-02 发布，与 v6.20.0 同一次 push/部署）。判级 minor。测试计划 `docs/test-plans/v6.21.0-edit-panel-mobile.md`（33 TC + 6 变异）；vitest 69 文件 / 1219 例全绿（v6.20.0 基线 69/1213，净 +6 例）、e2e 15/15、code-review P0 0 / P1 2 / P2 5 / P3 3（修登分明）。

**Added**
- GrowthEntryPage 窄屏卡片分支 + 常驻汇总条（portal 到 body、fixed 贴视口底、脱流 padding 补偿）。
- BrandsPage 窄屏品牌卡（brand-cards/brand-card/brand-card-grid/brand-new-form/brand-card-meta）。
- e2e ⑭ 成长补录卡片流、⑮ coach-sticky 条件几何；静态闸门 TC-SWP-05 + v6.21.0 五例（TC-ENT-03/09、TC-REG-02、TC-BRD-02、TC-IMP-03）。

**Changed**
- styles.css 新增 ≤760 entry 卡片 / ≤380 单列回落 / ≤760 brand 卡片 / ≤760 imports 表单重排 / ≤640 coach-sticky 五块；`.table-wrap` ≤760 加 `container-type:inline-size`（面板 `100cqw` 出宽前提）。

**Fixed**
- 补录面板在主表 td 内随 min-content 出宽（≈1.5× 视口、保存钮出屏）：sticky+100cqw+td padding:0 三层修复；汇总条 sticky 无行程改 fixed；删除零引用死规则 `.brand-card-head` / `.brand-card-foot`（TSX 实际用 `<b>` 与 `.btn-row`）。

## [v6.20.0] · 窄屏整治第一批：管理壳抽屉骨架 + 全站保底横扫（2026-10-02）

全站移动端窄屏整治第一批（设计 spec `docs/superpowers/specs/2026-10-02-mobile-remediation-design.md`，批次路线 v6.21 编辑面板卡片化 + CoachPanel 粘性列、v6.22 公开阅读页 + iOS 真机抽验）。**管理壳 ≤760px 侧栏收抽屉**：切换钮「☰ 管理导航 · 当前页名」+ 固定抽屉（宽 min(280px,85vw)）+ 遮罩，焦点陷阱 / 锁滚 / 焦点归位照球员库抽屉范式，Esc / 遮罩 / × / 路由切换四条关闭路径；>760px 桌面 DOM 零变化。**顶栏 ≤640px 页签横滑**：贴边渐隐 + active 页签 scrollIntoView 居中（尊重 prefers-reduced-motion）。**全站保底横扫**：内联固定宽 10 处收 `min(N,100%)`（其中表格内 4 处经评审回退定宽——百分比分量会改变 ≥761px 桌面列宽分配，窄屏保底由 `.table-wrap` 横滚承担）；48 张表格核实全部已有 `.table-wrap` 包裹（立项探查「约 9 页裸表」系误报）；`.ledger-book` / `.inbox-text` 两处窄屏残余溢出修复。**e2e 11→13**：新增 ⑫ 全路由 375×812 零溢出扫描（26 路由）与 ⑬ 管理抽屉全交互 + 宽屏零变化铁律；静态闸门 `tests/mobile-baseline.test.ts` 把表格包裹 / 固定宽禁令（白名单双向核对）/ 触控 ≥36 固化为 vitest 红线。零迁移零生产写。**已上线**（2026-10-02 发布，与 v6.21.0 同一次 push/部署）。判级 minor。测试计划 `docs/test-plans/v6.20.0-mobile-skeleton-baseline.md`（31 TC + 6 变异）；vitest 69 文件 / 1213 例全绿（v6.19.0 基线 68/1209，净 +1 文件 / +4 例）、e2e 13/13、code-review P0 1 / P1 3 / P2 4 / P3 6（修登分明）。

**Added**
- 管理壳窄屏抽屉（类名契约 `admin-nav-toggle` / `admin-sidebar.open` / `admin-drawer-mask` / `admin-drawer-close`，e2e ⑬ 锁定）。
- `tests/mobile-baseline.test.ts` 静态闸门 4 例（表格保底穷尽扫描 / 内联固定宽禁令 + 允许清单 5 条双向核对 / styles.css 触控 ≥36 规则级锁 / 判据自检）。
- e2e ⑫ 全路由 375 零溢出扫描、⑬ 管理抽屉开合 / 焦点循环 / 四条关闭路径 / 宽屏 DOM 零变化。

**Changed**
- 顶栏 ≤640 页签横滑加贴边渐隐与 active 居中（reduced-motion 降级）；`.search-suggest` 浮层窄屏 min(260px,86vw)。
- BrandsPage / admin MarketPage / OverviewPage / SystemPage / CoachPanel 共 10 处内联固定宽收窄屏保底（表格内 4 处评审后回退定宽，白名单登记）。
- `UI_DESIGN.md` 断点口径订正：「单一 640px」→ 实际三档 640/760/900。

**Fixed**
- `.ledger-book` 窄屏隐式列撑破（`minmax(0,1fr)`）；`.inbox-text` 缺 `min-width:0` 溢出 3px；`.admin-drawer-close` / `.lib-drawer-close` 命中区 <36 补足 36×36。

## [v6.19.0] · 球员库移动端卡片化 + 全仓数值五档分段配色（2026-10-02）

球员库 `/players` 在 ≤900px（与筛选抽屉同断点）把 12 列横向滚动表格整表换成**铭牌卡网格**：左竖轨位置药丸（主位独占 + 副位两枚一行、奇数孤行自动居中）与 CA/PA 大字，卡身姓名（长名换行不出省略号）+ 标记 emoji + 队徽/俱乐部/年龄/状态徽章（自由身灰 chip），下部固定行序属性列表（身价/违约金/徽章 chips/影响力）+ 受筛选项透镜行（attr 筛选优先恰 1 条，排序键/筛选维度按白名单补位，去重上限 2）；窄屏新增排序行（30 键 + attr 动态项 + 升降切换），显示列窄屏隐藏。桌面 >900px DOM 零变化——唯一例外：**标记列从可选列提为固定第二列（UID 后）**，且 CA/PA/初始 CA 列字色随五档变化。**数值分段配色全仓统一**：sofifa.com 实测五档（≤50 红 / ≤60 橙 / ≤70 琥珀金 `#b7892b`——原档黄 `#fcc419` 在奶油底上 ~1.6:1 不可读，唯一替换档 / ≤80 榈绿 / ≥81 绿），`attrClass` 收归 `web/src/lib/players-library.ts` 共享，球员面板头部 CA/PA、六维雷达轴数值、属性页签与分组均值、球员库表格、移动端卡片同源。零迁移零生产写（后端零改动，卡片所需字段列表端点已全部返回）。**已发布**（2026-10-02，push `368a1e0..7e14248` 触发 CF 自动部署，生产 Version `9e371144`，上线回读与资产比对全过）。判级 minor。测试计划 `docs/test-plans/v6.19.0-players-mobile-cards.md`（19 TC + 5 变异全命中）；vitest 68 文件 / 1209 例全绿（v6.18.0 基线 67/1194，净 +1 文件 / +15 例）、e2e 11/11、code-review P0 0 / P1 0 / nit 三条登记。

**Added**
- 窄屏铭牌卡网格 `.lib-cards` 与窄屏排序行 `.lib-sortrow`（`PlayersLibrary.tsx` narrow 分支；类名一律 `lib-card-` 前缀防撞既有规则）。
- `web/src/lib/players-library.ts`：`attrClass` 五档分段、`money`（自页面移入）、`SORT_KEY_LABELS`、`sortLabel`、`LENS_WHITELIST`、`LensChip`/`lensChips` 透镜纯函数。
- `web/src/lib/players-lens.test.ts` 15 例（attrClass 边界 / lensChips 口径 / 排序标签全集 / money）。

**Changed**
- 桌面表格：标记列从可选列提为固定第二列（UID 之后），`COL_DEFS`/`autoColsFor`/`renderCol` 的 marker 行退役。
- `.attr-good/.attr-mid/.attr-low` 三档类改五档 `.attr-bad/attr-weak/attr-mid/attr-solid/attr-good`（sofifa 实测色值，`attr-low` 退役）。
- e2e ⑧ 球员库三视口：窄视口等待与断言切到卡片列（`.lib-cards .lib-card`），宽屏追加卡片/排序行不存在的反向断言。

**Fixed**
- `PlayersLibrary.test.tsx` 的 api mock 缺 `mediaUrl`（窄屏卡片引入 TeamLogo 后取未定义导出直接抛错，9 例红）。

## [v6.18.0] · 市场信息架构改版（2026-10-02）

市场 nav 四项：**在售市场**（原「市场板」改名）/ **海捞**（成交动态与 CPU 捞人榜撤、改海捞区 + 激活球员）/ **市场情报**（新第四 tab，匿名可读）/ 我的。**海捞区** = 输入 ID 或名字搜索（数字点查 / 名字折叠搜索 LIMIT 8），信息条带「可捞 / 不可捞 + 原因」（批量判定与详情 seaSign 同源，一致性测试锁）。**激活球员** = 全部可激活球员（外队 normal+trainee，正式合同缺违约金的行标「缺违约金合同」置灰）+ 保留仅训练营模式；激活补齐证据上传链路（先传 QQ 通知截图拿 `proofMediaKey` 再提交——此前按钮缺该字段必 400）。**市场情报** = 传闻（系统自动派生、真真假假：种子钉 `[season, windowSeq]` 同窗稳定下窗换血，真料按事实方向分族套不确定语气、假料随机组合带不撞真实关系守卫，响应不下发真假字段）+ 已达成交易（全部 completed 单据倒序 50 条，走迁移 `0058` 的 `idx_transfers_status_time` 索引早停，≈150 行/次）。退役三端点：`/api/market/sea-signs`、`/api/market/cpu-board`、`/api/market/trainees`。**未发布**（本地完成，发布时迁移 `0058` 先 apply 生产再 push）。判级 minor。测试计划 `docs/test-plans/v6.18.0-market-ia.md`；vitest 67 文件 / 1194 例全绿（v6.17.0 基线 65/1169，净 +2 文件 / +25 例）、e2e 11/11、变异 V1–V15 全命中、code-review P0 0 / P1 2（已修）/ P2-P3 登记或小修。

**Added**
- `GET /api/market/rumors`（公开 + guard）：传闻生成器 `src/worker/rumors.ts`（seededUnit 确定性抽签；假料球员 seededUnit 随机 id 主键点查，零全表扫）。
- `GET /api/market/deals`（公开 + guard）：全部 completed 转会单据倒序 50 条（transfer/activation/forced_auction/free_agent/rc_change/termination/match，中文标签前端 `TRANSFER_TYPE_LABEL`）。
- `GET /api/market/sea-lookup?q=`（教练）：数字 → `firstPlayerByRef` 点查（fc_id 优先）；名字 → 双列折叠 LIKE；批量可捞判定 4 查询，stage 顺序与文案逐字对齐 `checkSeaSignEligible`（一致性用例锁跨实现相等）。
- `GET /api/market/activatable`（教练）：替换 trainees；`mode=all|trainee` + `q` + `limit` 钳 1..100；行带 activationFee 两口径（trainee 5m / 正式按保护期倍数）、`justSigned`、`activatedThisWindow`（批量）。
- 迁移 **`0058_transfers_status_time.sql`**（transfers 全表扫的治理索引）+ cache scope `'market'`（TTL 1h，PUBLIC_SCOPES 4→5）。

**Fixed**
- 正式合同 `release_fee` NULL/0 的球员曾让 activatable 名单整页 500（`activationFee` 对非正数抛 RangeError 未捕获）→ 行级费用 null + 前端「缺违约金合同」置灰 + 提交链同口径 409（对齐 bypass.ts 既有文案）。
- 激活按钮链路断裂：MarketFreePage 只发 `playerId` 而后端强制 `proofMediaKey`（证据制）⇒ 必 400——补齐截图上传→提交流程（复用 SideOps 的 `apiUpload` 通道）。
- rumors 假料球员查询 `p.club_id` 未别名成 `clubId` ⇒ 「不指向现效力队」守卫因键名不匹配从未生效（被旧池序的抽签运气掩盖，`ORDER BY p.id` 落地后暴露）——别名修复。

## [v6.17.0] · 海捞情报台（2026-10-01，2026-10-02 上线 · Version `e500cbd9-…`）

市场「海捞」tab 从自由球员名单改版为**教练决策情报页**。三段：**成交动态**（全服已完成海捞倒序 30 条：球员+CA / 原东家→捞入队 / 新违约金 / 海捞费 / 窗，本窗行高亮）、**CPU 捞人榜**（CPU 队可捞名单 CA 降序，行内违约金输入实时试算 30% 海捞费，点击进球员页）、**训练营激活原样保留**。球员详情新增 `seaSign`（资格判定与 `createFreeAgent` 守卫链同源：窗口 / 归属 / 状态 / 本窗禁签 / 在途单据，不可签原因原文下发）与 `seaComps`（成交定价锚：现值 CA±5 内最近 ≤5 笔同档成交，无同类回落全局最近 3 笔；仅判定 ok 时计算）。禁签按用户裁决不做内容展示（「这个窗签不了，对经理的意义有限」；CPU 榜天然不含禁签球员）。零迁移、零生产写。**已上线**（2026-10-02 发布：零迁移直接 push `b9ecda1..376ad12` 触发 CF 自动部署，生产 Version `e500cbd9-3da8-4b3e-92ef-8cba9cff1671` @2026-10-01T16:15:38Z；上线回读全过——基础端点 200、两新端点匿名 401、free-agents 404、公开详情出 `seaSign`/`seaComps` 新字段、线上资产与本地逐字节一致）。判级 minor。测试计划 `docs/test-plans/v6.17.0-sea-sign-intel.md`（30 TC = P0 19 / P1 9 / P2 2，8 变异）；vitest 65 文件 / 1169 例全绿（v6.16.0 基线 64/1140，净 +1 文件 / +29 例）、e2e 11/11、code-review P0 0 / P1 1（公开详情面白算参照，一行修）已修、P2/P3 登记（见 ROADMAP v6.17.0 节）。

**Added**
- `GET /api/market/sea-signs`（教练）：全服已完成海捞成交 `ORDER BY completed_at DESC, id DESC` LIMIT 30，透出新违约金（`fee`）与海捞费（`signFee` = 30%）；可选 `?season=&windowSeq=` 过滤（非正整数 400）。
- `GET /api/market/cpu-board`（教练）：CPU 队可捞名单（`is_cpu=1` 且 `status IN ('free','normal')`）按 CA 降序 LIMIT 500（CROSS JOIN clubs 驱动，防优化器塌成扫全部自由身）。
- 球员详情 `GET /api/players/:id` 新增 `seaSign {eligible, reason}` 与 `seaComps {scope: same_tier|global|none, rows}`。

**Changed**
- `src/worker/bypass.ts`：`ensureNotInFlight` 重构为 `findInFlight`（listings → transfers `pending_review`）+ 抛错壳；新增 `checkSeaSignEligible` 判定域（守卫链 window→ownership→status→banned→listing→pending 原顺序原文案）；`createFreeAgent` 改吃判定结果抛错，行为逐字不变（termination / rcChange 共用路径不受影响，变异 V8 座实联动面）。
- 市场页「海捞」→「海捞情报」（`MarketFreePage` 重写三段 + `SideOps` E 态开关改吃后端前置判定——原先只判窗口，其余提交后才知 400/409）。

**Removed**
- `GET /api/market/free-agents`（唯一消费是旧名单段，同批换情报台；原实测 36,274 行/次，为全站最大读放大器）。

**Fixed**（顺带）
- SideOps 海捞费恒显「—」：`apiPost<{fee:number}>` 泛型误用恒 undefined，改用 `FreeAgentResult` 展示。

## [v6.16.0] · 管理端成长批量补录台（2026-10-01）

把「一人一事件」的单人补录表单升级为**按场比赛、花名册行内批量补录**（参照 growth 插件 webui 的 fixtures 页交互）。选一场已确认比赛 → 内嵌面板 → 主/客队花名册一行一人行内编辑（出场 / 评分 / 零封 / 夺回球权 / 扑救，进球助攻只读）→ 本场 XP 实时复算 → 脏检测确认条 → 单行 + 全部保存（只提交脏行）。补录 `matchRef=比赛 id` 与自动通道同锚，`UNIQUE(player_id, match_ref, event_type)` 天然防重复发 XP；已录格锁定（平台无删除/纠正通道，如实标注来源）。零迁移、零生产写。**已上线**（2026-10-01 发布，用户下令「推送」）：push `748803d..7891561`（7 提交 = v6.15.0 发布记录 docs 枚 + v6.16.0 六枚）触发 CF 自动部署，Version `5cddbf5b-…` @2026-10-01T12:38:10Z；上线回读 `/api/health` / `/api/clubs` / 公开 `/api/fixtures` 全 200、匿名探针三个新端点均 401（挂载且守卫生效）、线上资产 `index-DzKR-MbB.js`（sha256 `27ee8e14…`）与本地构建逐字节一致。判级 minor。测试计划 `docs/test-plans/v6.16.0-growth-entry.md`（34 TC = P0 24 / P1 8 / P2 2，5 变异）；vitest 64 文件 / 1140 例全绿（基线 62/1113，净 +2 文件 / +27 例）、e2e 11/11、变异验证 5/5 全命中、code-review 修 2（entries 上限 50 行 / 未保存确认条文案）+ 1 并发边界注释。

**Added**
- 管理端三端点（`src/worker/routes/admin/growth.ts`）：`GET /api/admin/growth/match-entry`（比赛列表：可计 XP 场近 50 场，口径与自动钩子同源 `MATCH_ENTRY_WHERE`——联赛两级全阶段 + 冠军杯小组赛 + 排弃权；每场带已录事件数与双方 clubId/CPU 标记）、`GET /api/admin/growth/match-entry/:matchId`（双方花名册 + 已录事件预填）、`POST /api/admin/growth/match-entry/:matchId`（批量补录：校验全前置、单 `db.batch` 原子、审计 `growth_manual_event_batch` 恰一条、entries ≤50 行）。
- 管理端侧栏第 3 项「成长录入」`/admin/growth`（GrowthEntryPage）+ 前端 XP 复算纯函数 `web/src/lib/growth-xp.ts`（与后端 `xpForEvent` 同口径，头注释互指）。

**Changed**
- PlayersPage 成长引擎卡：移除旧单人补录表单（档位核定/宣告成长期/赛季结算/批量维护不动）。`POST /api/admin/growth/events` 端点保留（校验抽 `manualEventOf` 与批量共用，行为逐字不变），但无比赛关联的补录从此无 UI 入口。

## [v6.15.0] · 场次天气预报（revenue 插件触发口径）+ 预留 tour 展示接口（2026-10-01）

天气从「赛果确认时逐场现掷」改为「管理员按轮手动预报」（参照插件 `fixture_service.forecast_round`），**预报时天气类型与系数 wx 一并提前抽定落库**（用户裁决）；确认钩子按「事件预置 > 场次预报 > 现掷」消费，无预报场次行为逐字不变。概率/区间/上座公式**零数值改动**（40/30/20/10 为 2026-09-16 用户裁决值）。含迁移 `0057_match_weather.sql`。**已上线**（2026-10-01 发布）：迁移 `0057` 先 apply 生产、push `8cf8f12..748803d`（4 提交）触发 CF 自动部署，Version `20c24c71-…` @2026-10-01T11:50:15Z；上线回读 `/api/health` / 公开 `/api/fixtures` 200、匿名探针 401、线上资产 sha256 与本地 6.15.0 重构建逐字节一致。判级 minor。测试计划 `docs/test-plans/v6.15.0-weather-forecast.md`（50 TC = P0 34 / P1 13 / P2 3）；vitest 62 文件 / 1113 例全绿（基线 60/1062，净 +2 文件 / +51 例）、变异验证 5 处全命中、code-review 独立评审 0 blocking（5 important 已修）。

**Added**
- **按轮预报**：`GET/POST /api/admin/weather/forecast?tournament_id=&round=`（预览零 rng 零落库 / 触发对未预报未确认的主队场次逐场抽类型 + `uniform(weather_ranges[weather])` 抽系数落库；定位键 `(tournament_id, round)`，season 由赛季绑定解析，无绑定 409；已预报保留、已确认跳过、CPU 队与无球场队跳过；审计 `weather_forecast` origin='user'）。权限键 `club.registrations.manage`。
- **公开预留接口**：`GET /api/fixtures?tournament_id=&round=`（🌐 匿名 + `assertPublicRate` + `cachedJson`，新 `CacheScope` `'fixtures'` TTL 1h）——该轮主场比赛的天气（已确认取实际、否则预报、都无 null）、球场（名/容量/档位）、上座；收入三件套刻意不在白名单（评审收窄，经营数据只进管理端预览）。供 tour 平台将来拉取展示。
- **管理端「天气预报」卡**（SeasonsPage）：赛事下拉 + 轮次 + 预览表（四态：已确认/已预报/未预报/跳过）+ 生成预报（四段结果横幅）。

**Changed**
- 确认钩子（`home.ts` `matchAttendanceStatements`）：预报命中时天气与 wx 直取 `match_weather` 落库值（rng 剩 perturbation+fill 两口），memo 标「（赛前预报）」；预报行校验 club_id（改期/换边不错配）、消费后保留。事件预置命中时跳过预报点查。
- `cache-policy.ts`：`CacheScope` 加 `'fixtures'`（PUBLIC_SCOPES 3→4，一次 purge 仍只花一次 KV 写）；`rollWeather`/`uniform`/`asRange` 自 home.ts 导出共用。

**Fixed**（评审修复 `3d062fc`）
- 轮次参数严格解析：`Number('')`/`Number(null)` 均为 0——空串 `?round=` 或 body `round:null` 原会真的对第 0 轮抽定落库；改 `parseRoundParams` 严格校验 + round 上界 200，GET/POST 文案统一。
- 公开面/预览的预报行校验 club_id（与消费端同口径），改期/换边后旧预报不再展示（新增 TC-PUB-03b 锁）。
- 审计 after `forecasted` → `attempted`（并发撞闸时 batch 内无法回写实际数）；raced 回读缺行不再给空天气。

**已知不改**
- 淘汰赛/无轮号（`match.round` NULL）场次不在预报范围（触发四段全空，与该轮没排赛不可区分）；`wx_coef`/`weather` 无 CHECK 约束（人工改库文本 wx → 收入整批失败进 needsReview，实测无 NaN 落库）；tour 侧消费端、教练端天气展示未做（本轮只在本仓开口子）。

## [v6.14.0] · C3 招商轮：品牌报价制 + 主动签约退役（2026-09-29）

差异排期 C 块第三块（参照插件 `market_service` / `market_rounds` / `market_offers`）。含迁移 `0055_market_rounds.sql`（`market_rounds` + `market_offers` 两表与三个部分唯一索引；`claim_token` 抢锁列在未 apply 窗口期直接加入本迁移）与 `0056_event_seed_brand_visit.sql`（即发种子「品牌上门」，池 30 → 31）。**已上线**（2026-09-29 发布）：迁移先 apply 生产、push `07f050c..8cf8f12`（7 枚）触发 CF 自动部署，Version `df0640af-…` @2026-09-29T10:09:11Z；上线回读公开端点 200 / 匿名探针 401 / 旧 sign 404 / 线上资产 sha256 与本地一致。判级 minor（新增用户可见能力；`POST /api/club/naming/sign` 退役为同仓 web 客户端同批替换、无跨仓消费）。测试计划 `docs/test-plans/v6.14.0-c3.md`（69 TC = P0 46 / P1 19 / P2 3 / P3 1）；vitest 60 文件 / 1062 例全绿（基线 59/990，净 +1 文件 / +72 例）、e2e 11/11、变异验证 17 处 + 评审修复后 2 处全命中。

**Added**
- **招商轮与定向报价**：关窗批清盘旧轮（`pending` → `expired`；整轮无人签品牌热度 −`ignored` 钳 [0.5,1.5]）+ 开新轮；每品牌每轮向三档挑出的 3 支球队各发 1 份报价（头部盯估值最高的 `min(2, offersPerBrand)` 队 / 新兴盯中游 / 口碑广撒零报价队兜底；估值 = `namingBaseFee` × 行业系数；头部进取 pkg2、其余稳健 pkg1）；TTL 72h（config `market_round_rules {offersPerBrand:3, offerTtlHours:72}`，注册表 71 → 72）；`uq_market_round_open` 部分唯一索引保全局最多一个 open 轮。
- **报价收件箱与 accept 端点**：`GET /club/naming/quote` 改造为「当前合同 + 续约 + 收到的报价」（无约只回 `{offers}`）；新增 `POST /club/naming/offers/:id/accept`——无约直接签约；有约 `mode: queued`（现合同到期后接替，`uq_market_offer_queued` 一队一接班位）或 `mode: terminate`（解除当前合约、赔付沿用既有口径后即签）；queued 转正三触发点（关窗批尾 / 退约路由 / 关窗兜底）。
- **管理端招商轮视图**：`GET /brands/market-round`（轮状态 + 全状态报价流水）+ `POST /brands/market-round/reopen`（手动清盘重开，审计 `market_round_reopen`）；BrandsPage 招商轮区块（四状态徽标 + 手动重开）。
- **`offer_spawn` 真落库**：`brand_visit`「品牌上门」即发种子（新条件键 `requires_no_naming`，池 30 → 31）；事件递价经 `spawnVisitOffer` 挂当前开放轮（无开放轮 / 撞唯一索引走落空播报）；LLM 草稿条件白名单同步。
- **通知**：`naming_offer`（收到报价）与 `naming_offer_activated`（接替生效）两模板。
- **品牌热度**：`market_heat_rules` 加 `deal: 0.02`（签约）/ `ignored: -0.03`（整轮无人签）。

**Fixed**
- **转正批语句顺序缺陷（测试轮实测抓出）**：`activateQueuedStatements` 的 offer 占坑 UPDATE 排在合同 INSERT 之后 ⇒ 守卫读不到本批状态而恒假（offer 永停 queued、审计不落、queued 唯一位永不释放）；改为占坑 UPDATE 提前到合同 INSERT 之前。
- **`acceptOffer` 抢锁闭环（claim_token）**：原抢锁批「抢锁赢家与下游守卫不一致」可半笔提交、抢输方非零改行 ⇒ `market_offers` 加 `claim_token` 列，signed 路径守卫全上提抢锁句、后续语句统一 claim 守卫、批后按抢锁句 `meta.changes` 判 409「报价已被处理或条件已变化」；terminate 赔款改 `ref('offer', offerId)` 幂等 + claim 守卫。
- queued 分支撞 `uq_market_offer_queued` 由 500 改预检 409「已有一份待接替报价」；`spawnVisitOffer` 去重谓词与唯一索引同口径（去 `status` 谓词）；转正语句无条件生成（同批被腾出的冠名位当窗即转正）。

**Changed**
- **签约入口唯一化**：删 `POST /api/club/naming/sign`，冠名获取只走招商轮报价；冠名卡签约区改「收到的报价」（有约换约行内二选一）。
- `offer_spawn` 由「恒落空播报」改真落库（`PENDING_EFFECT_KEYS` 空集，前端展示不再标注「C3 生效」）。
- config 注册表 71 → 72（新键 `market_round_rules`）；事件池种子 30 → 31（`brand_visit`）；`tests/d1.ts` MIGRATION_FILES +2。

**已知不改**
- `spawnVisitOffer` 的 INSERT 在事件批之外（进程中途挂掉留孤儿报价）；queued 转正不复查品牌名额；转正审计双路径重复行；terminate 换约残余竞态（名额预检与抢锁之间名额被抢 → 退约成功而无新约，极小概率）。

## [v6.13.0] · C2 冠名深度：档位性格 + 情绪演化 + 品牌主动解约 + 联赛冠军加成（2026-09-28）

差异排期 C 块第二块。含迁移 `0054_brand_tiers.sql`（`brand_pool` 加 `tier` CHECK 三档 / `tier_locked`，种子按校准规则预设 3 头部 2 新兴）——**已随 2026-09-28 发布批次上线**：`0054` 于 push 前 apply 到生产（`Executed 5 commands in 3.56ms`；只读核验 `brand_pool` 3 头部 / 2 新兴 / 2 口碑、`d1_migrations` 末条 `0054_brand_tiers.sql`），随后 push `77f6eea..07f050c`（14 个提交）触发 CF Workers Builds 自动部署，生产 Version `1e3cc95a-7f43-41ee-8fd4-93fe69169774`（2026-09-28T15:50:43Z）；线上资产 `index-nK5xirMD.js` + `index-BY0ef8kg.css` 与本地 v6.13.0 构建 sha256 逐字节一致（线上 JS 版本串 `6.13.0`），公开端点 200 / 匿名探针 401 回读全过。判级 minor。测试计划首次按 qa-test-planner 约定设计（`docs/test-plans/v6.13.0-c2.md`）。插件只当参照系，可玩性偏离逐条留痕（见 ROADMAP v6.13.0 节）。

**Added**
- **品牌档位**：头部 / 新兴 / 口碑三档（config `market_tier_profiles` 全参数性格：情绪地板 0.7/0.6/0.5、负向敏感 ×1.5/1.0/0.75、活动收入加成 +2%（头部）、死忠涨粉加成 +0.5%（口碑））；config `market_tier_rules`（topSeatRatio 8 / emergingSlots 2 / topHeatFloor 1.0 / emergingHeatFloor 0.9）；关窗批首自动校准——热度降序前 ceil(俱乐部数/8) 家且 heat≥1.0 → 头部、≥0.9 → 新兴、其余口碑；**头部可空缺不注水**；`tier_locked=1` 锁档跳过校准；管理端品牌池页档位下拉 + 锁定开关（审计带前后档位）。
- **品牌方情绪演化**（接管 v6.12.0 的纯展示）：两信号步进——上座（≥goodAttend +1 / ≤badAttend −1 / 无主场场次 0，不借中性上座率拿正向）+ 战绩（窗内胜率 ≥0.55 +1 / ≤0.45 −1，点球按平、弃权按取胜方，与 formPtsOf 同口径）；delta = 0.5×0.05×s_attend + 0.3×0.05×s_result，负向 ×档位 penaltyMult，钳 [0,2] round3；剩 1 窗的合同本窗到期不演化（防与 expire 抢行）；事件情绪即时落库（v6.12.0）保留、不进演化（Q2 裁决，避免双记账）。关窗后教练收 `naming_mood` 站内信（含两信号人话注记）。
- **品牌主动解约**：演化后 satisfaction 跌破当前档位地板 → 同批 terminated（windows_remaining=0、ended 刻定格），无赔偿；`naming_terminated` 站内信；冠名卡 sat ≤ 地板 +0.1 出「低情绪预警」红标（地板随约下发）。
- **签约档位名额**：头部 1 队 / 新兴 2 队 / 口碑不限；预检 409（文案点名档位限数）+ INSERT 原子 COUNT 守卫双保险（并发不超卖）；报价端点透出 `tier` 与 `quotaLeft`（口碑 null），签约列表徽标 + 名额提示、满额禁用。**修复真缺陷**：守卫初版对不限额档 bind 0 使 `COUNT < 0` 恒假——口碑档品牌签约恒 409，由测试抓出并修正（不限额档不加子查询）。
- **联赛冠军加成**（挂既有赛季结算按钮）：`settleSeason` 批内定位 `league_premier` 绑定（0 或 >1 条 → note 进 warnings 走 acknowledged），`result_confirmations` 自算积分表（胜 3 平 1 负 0、点球按平、弃权判负净胜球 3:0、双方弃权不计），榜首 tiebreak 积分 → 净胜球 → 队名（AUTH 目录名，缺行回落队 id）；冠军队有 active 冠名则品牌热度 +`champion`（0.10，钳 [0.5,1.5]）+ 满意度 +`championSatisfaction`（0.10，钳 [0,2]），全部语句挂 `(SELECT status FROM seasons WHERE season=?) != 'settled'` 守卫（重放 / 并发零改行）；审计 `champion_bonus` 同闸；结算返回体带冠军明细；冠军队收 `naming_champion` 站内信（无冠名走「无落点」分支）。
- **buff 生效点**：档期活动收入 ×(1+attendBuff)（头部 +2%，memo 带加成标注）；死忠演化涨粉系数 ×(1+fansBuff)（口碑 +0.5%），掉粉不受影响。

**Fixed**
- `signNaming`：口碑档（不限额）签约恒 409 的真缺陷（名额守卫在不限额档 bind 0，`naming-tiers` TC-QUOTA-04 抓出）。

**Changed**
- config 注册表 68 → 71（`market_satisfy_config` / `market_tier_profiles` / `market_tier_rules`），`market_heat_rules` 默认加 `champion: 0.10`。

## [v6.12.0] · D3 随机事件域：满意度与经营信号消费端 + LLM 草稿工坊 + 种子扩池（2026-09-28）

差异排期 D 块第三块。含迁移 `0051_naming_satisfaction.sql` / `0052_event_seeds_batch2.sql` / `0053_event_drafts.sql`，并直接编辑了尚未 apply 的 `0047_event_pool.sql`（补 satisfaction / signals）。**已随 2026-09-28 发布批次上线**：`0045`–`0053` 共 9 枚迁移于 push 前 apply 到生产，push `68fc154..77f6eea` 触发 CF 自动部署（Version `55a54d84-9ca6-4b7d-999f-27064197238d`，2026-09-28T10:02:19Z）；线上资产 `index-CF1Lyhhj.js` 与本地 v6.12.0 构建逐字节一致。

**Added**
- **品牌方情绪真落库**：`naming_contracts.satisfaction`（`0051`，默认 1.0）；事件 `satisfaction` 效果按 `event_clamps.satisfaction=0.5` 钳幅、`MAX(0, MIN(2, …))` 累加、PENDING_GUARD 幂等，无生效冠名播报落空；冠名卡展示「品牌方情绪：低落 / 平静 / 高涨」（数值 + 状态标签，阈值纯展示）。
- **经营信号三消费点**：config 新键 `event_signals`（`fan_mood` step ±2 / `upkeep` mult 0.5–2 / `fee_mod` mult 0.5–2，同插件 `SIGNAL_DEFAULTS`）；效果值经 `cleanSignals` 清洗后入 `effects_json`，关窗批 `collectWindowSignals` 聚合（step 求和 / mult 连乘后终钳）——维护费 ×upkeep、死忠演化 ×(1+fan_mood/100)、冠名费 ×fee_mod，账本 memo 带信号说明，有非中性信号的队另收 `window_signals` 站内信。
- **LLM 草稿工坊**（管理端 only，不进玩家请求路径）：`src/lib/llm.ts`（OpenAI 兼容通用接入，`LLM_API_BASE` / `LLM_API_KEY`（secret）/ `LLM_MODEL` 三变量，未配 503 旁路、失败 502 带原文）；`event_drafts` 表（`0053`）+ 6 个管理端点：生成（text 改写文案 / struct 结构草稿过 `clampEventDraft` 钳制）、草稿列表、修订（PATCH，struct 重过钳制）、采纳（text 写 `event_pool.template` / struct INSERT 池，event_id 撞车 409）、废弃；全程审计。管理端事件页新增「草稿工坊」区。
- **种子扩池 24 → 30**（`0052`，主题与效果经用户确认）：名宿回访 / 赞助商突击考察（即发）+ 吉祥物出道 / 广告牌争议 / 看台 Wi-Fi 升级 / 城市嘉年华（选择）；存量 `0047` 种子补 satisfaction（brand_crisis / brand_anniv）与 signals（tifo_viral / bad_press / new_wave / merch_hit / scalper_raid / food_fest / derby_buzz）。
- **同队待选上限**：`event_rules.maxPending=3`——随机抽取达上限跳过（计 capped）、点名触发 409。
- `pickEvent` 剔除「选择型无选项且不设时限」的永久 pending 窄口；教练端事件视图 pending 分页口径统一钳 1..50。

**Changed**
- 超时兜底状态改记 **`expired`**（`0048` 列注释原义「expired = 超时兜底」归位；玩家 / 管理员结算仍 `resolved`，读侧 `status <> 'pending'` 兼容），结算回执与流水带「（超时自动结算）」；事件流水状态列加「超时结算」徽标。
- `runSettleTick` 把超时兜底挪到通知补发之后并各自 try/catch（v6.11.0 登记的可选改进兑现：迁移未 apply 类故障只挂兜底一环，不再连坐通知与缓存 purge）。
- 选项概率表的「（v6.12.0 生效）」标注收窄为只剩 `offer_spawn` 带「（C3 生效）」（satisfaction / signals 本版起真落库）。
- `resolveEvent` 白读收敛：无选项 / 选项均无结果的跳过路径不再装队况与效果依赖。

**Fixed**（变异验证 13 处全命中；首轮 2 处空转按最坏情况口径补强测试后命中——维护费信号加金额对账断言、llm-status 加「部分配置 = 未配置」用例；code-review 修复 2 条：非草稿行隐藏无效操作按钮、移除未用的 `loadEventRules` 装载）

**已知不改**：`window_signals` 通知无去重闸（关窗批失败重试可能重发，信号内容幂等）；选择型拖到归档窗关闭后结算的信号不消费（幅度小，登记接受）；`window_signals` 模板名同样待跨仓白名单确认。

## [v6.11.0] · D2 随机事件域：选择型事件 + 玩家互动 + 超时兜底（2026-09-28）

差异排期 D 块第二块（参考 AstrBot 插件 `event_engine.py` 的 `_resolve_choice` / `_roll_option` 与倒计时式选项处理）。含迁移 `0050_event_occurrence_reminded.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0050_event_occurrence_reminded.sql`：`event_occurrences` 加 `reminded_at TEXT NOT NULL DEFAULT ''`——cron 每 5 分钟一跳，靠这一列保证同一条待选只提醒一次。选择型的 `choice_no` / `outcome_json` / `deadline_at` 在 `0048` 一次建全 ⇒ **本版零结构改动**（0048 的设计目标在此兑现）。
- `src/worker/event-ops.ts`：`worstOption`（净额 = `money − maintenance` 取最小，并列按选项号、结果下标升序）/ `rollOptionOutcome`（选项内 `w` 加权选结果，权重 `max(1, trunc(w))`，抽样种子钉在 `[occurrenceId, choiceNo]` 上 ⇒ 「确定性伪随机替代插件的强制重算」在本仓同样成立，重放同结果）/ `renderChoiceText` / `shortDeadline`；`resolveEvent`（玩家选定 / 净额最差兜底 / 选项号越界同样按最差兜底 / 无选项信息跳过；效果语句与状态 UPDATE 放**同一批**，幂等以 occurrence 行的 `pending` 为闸，并发抢行改 0 行 ⇒ 409）/ `expirePendingEvents`（cron 兜底 + 24h 提醒，**只挑 `deadline_at IS NOT NULL`** 的行——D1 已知残留的即发型 `pending` 行不会被误结算）/ `listClubEvents`（教练端待选 + 最近已结）。
- 抽取侧放开选择型：`triggerEventBatch` 的随机路径不再只抽即发型（抽中只挂待选、当刻不落效果），点名触发对选择型同样放行（D1 的「要等 v6.11.0（D2）开放」400 已撤）。
- 端点（权限键 `club.squad.manage`）：`GET /api/club/events`（待选含选项全文 + 最近已结）、`POST /api/club/events/:id/choose`（归属 403 / 已结 409 / 选项号越界 400 在**路由层**拦下；引擎层的宽容兜底留给超时与无效号路径，玩家自己点错号码不该静默吃最差结果）。
- cron 接线（`src/worker/index.ts`）：`runSettleTick` 加 `expirePendingEvents`；`tickChanged` 加 `events.expired > 0`（兜底会落死忠/影响力等公开列）；24h 提醒只写 `notifications` 与 `reminded_at`，**不算公开数据变更**、不触发 purge。
- 通知模板（`src/worker/notify.ts`）：`event_resolved`（结算回执，含口径与效果播报）、`event_deadline`（距时限 24h 提醒）。
- 前端：`web/src/pages/club/CoachPanel.tsx` 新增「事件」卡（待选逐条列选项 + 一键选定、最近已结表，结算后失效刷新）；`web/src/lib/api.ts` / `queries.ts` 补类型与 `qk.events`；管理端 `web/src/pages/admin/EventsPage.tsx` 点名下拉放开选择型并标出「即发 / 选择」。

**Changed**
- `tests/event-ops.test.ts` 两例按 v6.11.0 语义订正：选择型参与随机抽取（D1 断言「池里只有选择型 ⇒ 掷中也不触发」已反转）、点名触发选择型不再 400。
- 超时口径文案统一改为「按**资金**最差结果自动结算」（触发通知 / `event_deadline` 模板 / 教练端卡片两处）：`worstOption` 只比 `money − maintenance` 净额，不含死忠与影响力，原文案说「最差」会让玩家按错预期。
- 选项概率表按权重**归一**后印百分比（原来是「把原始 `w` 当百分数」，只在同一选项内合计 100 时才等价）。

**Fixed**（code-review-skill 只读评审：**无 P0**——不会重复加钱 / 丢钱 / 公开数据错乱；共 2 P1 / 6 P2 / 9 P3）
- 概率表不再把本版**不落账**的三键当卖点：`satisfaction` / `signals` / `offer_spawn` 在展示侧带「（v6.12.0 生效）」标注（种子 `0047_event_pool.sql` 里 brand 系选项就有「65% 品牌满意度 +0.15」，本版一条 SQL 都不产生）。
- 超时扫描加下界 `deadline_at >= now − 7 天`：结算不掉的残行（「俱乐部已不在册」）会永久 pending 且 deadline 已过期，而扫描是 `ORDER BY id LIMIT 50` ⇒ 积满 50 条后整个超时兜底会静默停摆（终态化留 D3）。
- 24h 提醒查询补下界 `deadline_at > now`：否则会给已过期的行推「还有不到 24 小时可选」。
- 结算审计挂 `PENDING_GUARD` 并挪到批次首位（`AuditEntry` 新增可选 `guardSql` / `guardParams`，`src/lib/audit.ts` 带守卫时走 `INSERT…SELECT…WHERE`，与 `src/worker/bypass.ts` 手写那版同形）：原来并发抢输的一方会留下一条 `after` 快照并未生效的审计行。
- 结算 UPDATE 补写 `effects_json`（原来恒 `'{}'`，而 `0048` 的列注释写明「选择型为选中分支的效果」，管理端 occurrences 视图读它）。
- 教练端选定事件后补 invalidate `qk.myClub` + `['club','balance']`：事件效果改死忠 / 影响力，同页「主场档案」卡直接渲染它们，与设施升级 / 冠名同口径。
- `parseEventOptions` 按 `no` 去重丢后者：路由结算用 `find` 取第一个同号选项，重复号会让「按钮显示 A、实际结算到另一个 A」。
- `EVENT_TICK_LIMIT` 由字符串拼进 SQL 改为绑定参数。

**记为已知、本轮不改**：`runSettleTick` 无 try/catch 且 `expirePendingEvents` 排在通知补发之前 ⇒ 若 `0050` 未 apply，引用 `reminded_at` 的普通 SQL 错误会每 5 分钟把整个 tick 打断（**靠「先 apply 再 push」的纪律解决**，可选改进是挪到通知之后 + 各自 try/catch）；新通知模板名是否被插件按白名单拒收**本地无法证实**（插件仓 grep 不到 `/notify` 路由实现）⇒ 待确认；空 `options` + `choiceDeadlineHours <= 0` ⇒ 永久 pending（窄口）；INSERT occurrence 与触发审计分两批；视图分页口径不一（pending 硬编码 `LIMIT 20` vs recent 钳 1..50）；**随机池不再滤即时型**后掷中约 77% 是选择型（`0047` 权重即时型 28 / 选择型 94），且无「同队同时最多 N 条待选」上限 ⇒ D3 一并评估。

**验收**
- `npm run typecheck` 三份全清；`npx vitest run` **57 文件 / 950 例全绿**（v6.10.0 基线 56/916，净 +1 文件 / +34 例，全在新建的 `tests/event-choice.test.ts`）；`npm run build` = `dist/assets/index-DLnw5qCr.js` 608.24 kB / gzip 192.43 kB。
- 变异验证两轮。D2 本体 9 处：**7 处命中**——最差挑成最好 3 红 / 选项内权重被忽略 1 红 / cron 兜底连 `deadline_at IS NULL` 的即发型残留行也吃 1 红 / 路由不拦越界选项号 1 红 / 路由不校验归属 1 红 / 教练端 pending 不看 `event_type` 1 红 / `choiceDeadlineHours=0` 也设时限 1 红。**2 处未命中**（`resolveEvent` 的 UPDATE 闸、24h 提醒的抢闸）：同一不变量各被两道守卫守着（前者有 `row.status !== 'pending'` 早检，后者有查询里的 `reminded_at = ''` 过滤），单线程测试不可独立观测 —— 两处守卫的代码注释均已写明职责是**并发与重放**防线，不因未命中而删除。首轮这两条脚本报 `NO SUMMARY` 是脚本把成功路径的 stdout 清空了，重跑后确认是「变异未被捕获」而非「脚本空转」。评审修复新增 7 处**全命中**：展示标注 1 红 / 7 天下界 1 红 / 提醒下界 1 红 / 审计守卫 1 红 / `effects_json` 1 红 / 概率归一 3 红 / 选项去重 1 红。

**生效面**：迁移 apply + push 后——玩家（教练）在球队中心能看到待选事件并选定，逾期由 cron 按资金最差自动结算并广播回执，距时限 24h 收到提醒。

**后续（详见 `ROADMAP.md` 同名节「下一步（待令）」）**：
- ~~发布需单独授权~~ —— **已于 2026-09-28 随 v6.12.0 发布批次上线**（`0045`–`0050` 先 apply 到生产，再 push `68fc154..77f6eea`，Version `55a54d84-…`）。
- D3（v6.12.0）：`satisfaction` / `signals` / `offer_spawn` 三类消费端落库 + LLM 文案（仅管理端生成 + 落库审校）+ 种子池扩到 ~30；一并评估超时残行终态化与 `expired` 语义、选择型占比 ~77% 是否设待选上限、空 options 窄口、视图分页口径。
- 待确认（跨仓）：`event_resolved` / `event_deadline` 模板名是否被插件按白名单拒收。
- 更远：C2 冠名深度（满意度三信号 / 品牌主动解约 / 档位性格）、C3 招商轮。

## [v6.10.0] · D1 随机事件域：事件池 + 管理端触发 + 11 键效果即时结算（2026-09-28）

差异排期 D 块第一块（参考 AstrBot 插件 `event_engine.py` / `event_effects.py` 搬到本仓）。含迁移 `0047_event_pool.sql` / `0048_event_occurrences.sql` / `0049_stadium_event_pending.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0047_event_pool.sql`：`event_pool (id, event_id UNIQUE, name, category, weight, event_type, conditions_json, effects_json, options_json, soft_conditions, template, source, status, created_at)` + 24 条种子（6 即发 + 18 选择，逐字同插件 `DEFAULT_EVENTS`）。迁移 `0048_event_occurrences.sql`：`event_occurrences`（选择型的 `choice_no` / `outcome_json` / `deadline_at` 一次建全 ⇒ D2 零迁移）+ 两索引。迁移 `0049_stadium_event_pending.sql`：`stadiums` 加 `next_attendance_mod`（默认 1）与 `next_weather`（默认空）。
- config 两键：`event_rules`（命中概率 0.4 / 每队 1 次 / 同事件上限 2 队 / 软条件衰减 0.25 / 选项时限 72h）与 `event_clamps`（money 8、fans_pct 0.05、maintenance 5、brand_heat 0.3、build_credit 5、influence 10、booking_cancel 2）；注册表 65 → **67**。
- `src/worker/event-ops.ts`：条件判定（tier / capacity（**max_capacity 为本仓补**）/ fans / balance / facility_min / `weather_is` 读预置 / `last_result` / `requires_naming` / `requires_activity`）→ 加权单抽（软条件按 `softConditionFactor` 衰减参与、同事件 `maxOccurrences` 上限）→ **11 键效果**（`money` 记 `kind='event'`、`maintenance` 本仓改记 `kind='maintenance'`、`fans_pct` / `attendance_mod` 乘法叠加 / `brand_heat` / `build_credit` / `influence` / `facility` ±1 级 / `booking_cancel` 降序撤档 / `booking_gift` 补空档 / `weather_set`；`satisfaction` / `signals` / `offer_spawn` 留 v6.12.0，本批只播报）。
- **幂等以 occurrence 行自己当闸**（本仓事件没有关窗批可依附）：非账本效果语句一律追加 `AND (SELECT status FROM event_occurrences WHERE id = ?) = 'pending'`，同批末句置 `resolved`；批次自带审计 `action='event_trigger'`（`origin` = `user` / `cron_tick`）。
- 关窗消费：`home.ts matchAttendanceStatements` 读 `next_weather`（合法则替代现掷天气）与 `next_attendance_mod`（乘进需求），同批清零——**一次性，只对下一场主场生效**。
- 端点（权限键 `club.clubs.manage`）：`GET/PATCH /api/admin/events/pool`（池只读 + 启停）、`POST /api/admin/events/trigger`（无参按概率给所有队各掷一次；`clubIds` + `eventId` 点名绕过概率与条件）、`GET /api/admin/events/occurrences`。
- 前端：新建 `web/src/pages/admin/EventsPage.tsx`（侧栏第 10 项「事件」：触发区 + 池表启停 + 流水表）；账本加「事件」列；通知模板 `event_triggered`（即时型触发即广播）。

**评审修复**（code-review-skill）：① `loadEventContexts` 原先给 `clubIds` 里任何 id 都装上下文，管理端点名写错 id 会留下幽灵 occurrence 与流水 ⇒ 改为只给 `clubs` 表里真实存在的 id 装；② `GET /events/occurrences` 的 `?season=` / `?limit=` 空串被 `Number('')` 吃成 0（静默回落空列表 / limit 钳成 1 条）⇒ 空串按没给算。

**口径**：事件**不绑窗口**（两仓窗口语义不同，用户裁决），发生在赛季进行中、可多次触发，occurrence 只归档触发时的 (赛季, 窗)；D1 只开放即发型，选择型点名触发回 400「要等 v6.11.0（D2）开放」。**不做**：自定义事件编辑、招商轮（C3）、品牌主动解约与档位性格（C2 后段）、LLM 进玩家请求路径（D3 只做管理端生成 + 落库审校）。**已知残留**：occurrence 的 INSERT 与效果批不是同一批（先 INSERT 拿 id 再落效果），进程中途挂掉会留 `status='pending'` 的即发型残留行 ⇒ D2 的 `expirePendingEvents` 必须只挑 `deadline_at IS NOT NULL` 的选择型。

**验收**：typecheck 三份全清、vitest **56 文件 / 916 例全绿**（v6.9.0 基线 55/873，净 +1 文件 / +43 例）、build 成功（`dist/assets/index-Txp-AYZf.js` 605.38 kB / gzip 191.68 kB）；变异验证 12 处全命中（`requires_naming` 失效 / `maxOccurrences` 失效 / money 不钳幅 / `PENDING_GUARD` 失效 / 抽取不过滤即发型 / 撤档取最小档位 / 弃权记失败方 / 不消费 `next_weather` / 不乘 `next_attendance_mod` / 幽灵队守卫失效 / `?limit=` 空串 / `?season=` 空串）。



## [v6.9.0] · E 块球场档期：活动预订 + 关窗结算入账（2026-09-28）

差异排期 E 块（参考 AstrBot 插件球场档期域搬到本仓）。含迁移 `0046_venue_bookings.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0046_venue_bookings.sql`：`venue_bookings (id, club_id, season, window_seq, slot_no, activity_type, booked_by, created_at)` + `UNIQUE (club_id, season, window_seq, slot_no)`（唯一约束自带索引，按队+赛季+窗查档期走索引；参考插件无索引）。
- config 两键：`activity_slots`（默认 2，界 0–20）与 `activity_config`（演唱会 3.0–8.0 + 损坏概率 0.15 / 损坏 2.0–5.0、电竞赛事 2.0–4.0、球迷开放日 0.5、青训夏令营 1.0 + 青训系数 0.1、空置 0，逐字同插件）；注册表 63 → **65**。
- `src/worker/venue-ops.ts`：档位活动的确定性结算——`seededUnit(seed, draw)`（FNV-1a + splitmix32）把「收入 / 损坏额 / 损坏判定」三次抽取钉在 `[club_id, season, window_seq, slot_no]` 上；`activityIncome` 与插件 `formula.py:497` 严格同序（先收入 → 草皮损坏（概率 ×(1−0.15×pitch_level)）→ concert 收入 ×(1+0.1×pitch_level) / youth_camp ×(1+0.1×youth_level)）；`bookSlot` 同槽位改订走 `ON CONFLICT DO UPDATE` 并回传原档期。
- 关窗结算：活动收入 `kind='activity'`、草皮损坏 `kind='maintenance'`，**都挂 `ref_type='booking'` `ref_id=档位行 id`**（与基础维护费的 `('maintenance','window',…)` 闸分离，互不干扰）；关窗批内每队结算，临时窗照算；`HomeWindowSummary` 增 `activityClubs` / `activityTotal`。
- 端点：`GET /api/club/bookings`（当前开窗或 `?season=&windowSeq=` 历史查询）+ `POST /api/club/bookings`（201 回 `{booking, previous}`；越界/未知活动 400、非开窗 409），权限键 `club.squad.manage`。
- 前端：教练面板新增「主场档期」卡（每队每窗按 `activity_slots` 排活动，非开窗只读）；账本新增「活动」列；`api.ts` / `queries.ts` 补 `BookingsResponse` / `BookingResult` / `qk.bookings`。

**评审修复**（code-review-skill）：`GET /api/club/bookings` 的显式历史参数原先 `Number('')` → 0、`Number('abc')` → NaN 都静默回落到当前开窗；改为成对校验（缺一参 400、非整数 400），`getOpenWindow` 收敛成一次调用。`tests/ledger-audit-lock.test.ts` 白名单加 `worker/venue-ops.ts`（自动路径并入关窗批，ref 锚回档位行，可重建）。

**口径**：预订免费不收钱，收益只在窗末入账；同一档位重复关窗时账本闸按 `(kind,'booking',档位 id)` 拦下，汇总数是「本窗生成额」口径（与维护费/冠名一致）；活动类型窗内可反复改（同一行、闸不变）。**不做**：插件 `open_day` 的 `fans_pct`（插件自身未实现）、档期与比赛日冲突校验（插件也没有）。

**验收**：typecheck 三份全清、vitest **55 文件 / 873 例全绿**（v6.8.0 基线 54/859，净 +1 文件 / +14 例）、build 成功；变异验证 8 处全命中（草皮减免 / concert 加成 / 青训加成 / `seededUnit` 丢 draw / 损坏挂错闸 / 越界忽略 `activity_slots` / 去开窗校验 / 关窗批不并入档期）。

## [v6.8.0] · C1 冠名活化：品牌池落库 + 行业系数 + 续约 + 热度动态（2026-09-28）

差异排期 C1 块（参考 AstrBot 插件冠名域的深度搬到本仓）。含迁移 `0045_brand_pool.sql`，已随 2026-09-28 发布批次 apply 到生产并上线（Version `55a54d84-…`）。

**Added**
- 迁移 `0045_brand_pool.sql`：`brand_pool (id, brand UNIQUE, heat, source, status, industry, created_at)` + 7 家种子（`INSERT OR IGNORE`，品牌名/热度/行业与插件 `brand_service.py:17-25` 逐字同）。此前 7 家品牌硬编码在 `src/worker/naming-ops.ts` 的 `DEFAULT_BRANDS` 常量里。
- config 两键：`naming_industry_factors`（医疗 1.2 / 运动 1.1 / 科技 1.3 / 饮食 1.0，未登记行业回 1.0）与 `market_heat_rules`（连胜 +0.03 / 连败 −0.02 / 热度钳制 0.5–1.5）；注册表 61 → 63。
- 冠名报价乘行业系数（`baseFee = round3(namingBaseFee(...) × industryFactor)`）；签约改查品牌池，弃用品牌回 400「不在品牌池」。
- `renewNaming`：只剩最后 1 窗可续，按当前队况与品牌现热度重算三套餐、原地换约，审计 `action='naming_renew'`。端点 `POST /api/club/naming/renew`；`GET /api/club/naming/quote` 有现约时多下发 `renewal`（品牌已弃用则 null）。
- 热度动态：关窗时按近 3 场战绩演化品牌热度（全胜 +0.03 / 全败 −0.02 / 其余不动；点球按平、弃权按取胜方），SQL 侧 `MAX/MIN` 钳制，同品牌多队同窗累加互不覆盖。
- 管理端品牌池三端点（`GET/POST /api/admin/brands`、`PATCH /api/admin/brands/:id`，权限键 `club.clubs.manage`）：列表带生效冠名数、新增自定义品牌（热度界内、行业 ≤10 字）、改热度/行业/弃用；**弃用守卫**——还有 active 合同的品牌不可弃用（插件无此校验，本仓补）。
- 前端：新建 `web/src/pages/admin/BrandsPage.tsx`（侧栏第 9 项「品牌池」）；教练端冠名卡在 `windowsRemaining === 1` 时出现续约入口。

**评审修复**（code-review-skill）：`GET /admin/brands` 生效冠名数改一次 `LEFT JOIN` 聚合（原按品牌相关子查询无索引可依）；`PATCH /admin/brands/:id` 空 body → 400（原先落空转 UPDATE + 审计）；`renewNaming` 审计改在 UPDATE 真改行之后写（并发 0 行不再留描述未发生变更的审计）。

**口径**：热度调整无独立幂等闸，靠关窗批首句窗口状态原子闸（失败整批回滚），与 fans UPDATE 同机制；合同费用是签约快照，热度只影响之后的报价与续约。

**验收**：typecheck 三份全清、vitest **54 文件 / 859 例全绿**（v6.7.0 基线 54/847，净 +12）、build 成功；变异验证 5 处（去行业系数 3 红 / 续约放开仅剩 1 窗 2 红 / 热度不钳上限 1 红 / 连败改升温 2 红 / 弃用品牌仍可签约 1 红——末条首轮空转，补测后命中）。

## [v6.7.0] · B 块可见性：近期主场战报 + 窗口财务汇总（2026-09-28）

差异排期 B 块（参考 AstrBot 插件「主场收入系统」的可见性能力搬到网页端）。零迁移、零生产写，纯只读端点 + 前端展示。

**Added**
- `GET /api/club/home-matches`（教练端）：最近 10 场主场的天气 / 上座（含上座率）/ 票务 / 商业 / 转播 / 合计收入与对手比分赛果（胜/平/负/点球/弃权）。对手名用 `result_confirmations.away_team` 确认时快照；`match_id` UNIQUE 保证 JOIN 不放大行。此前 `match_attendance`（迁移 0018）没有任何读端点。
- `GET /api/club/finance-summary?season=`（教练端，缺省当前可见赛季）：比赛日收入按 `match_attendance (season, window_seq)` 精确归窗；其余流水按 `created_at` 折叠进 `season_windows [opened_at, closed_at]`（两端含、在开窗口吃掉其后全部），出每窗 byKind / 净额 / 期末余额；窗外流水进 `outside` 不计入赛季合计。closingBalance 按 `(created_at, id)` 取末笔，不假设 id 与时间同序。
- 前端：教练面板新增「近期主场战报」卡（主场档案卡之后）；财政账本页新增「窗口财务汇总」卡（教练可见，工资/维护费/冠名/富人税固定列 + 其他归并 + 赛季合计行）；`queries.ts` 加 `useHomeMatches` / `useFinanceSummary`。
- 测试 `tests/club-visibility.test.ts` 10 例：六态赛果、上座率、LIMIT 截断、窗端点边界（恰等 opened_at / closed_at）、在开窗口吞流水、窗外归 outside、乱序插入、跨季混入、期末余额回退与浮点尾差收口。

**评审修复**（commit `5327b27`）：金额求和统一 round2（0.1+0.2 尾差）；赛季期末余额回退到最后一笔有流水的窗口；前端「冠名」列补 `naming_penalty`（违约罚金）。

**验收**：typecheck 三份全清、vitest **54 文件 / 847 例全绿**（v6.6.3 基线 53/837）、build 成功；变异验证 4 处（含端改开区间 / closingBalance 退化按 id / matchday 漏赛季过滤 / 胜负判定取反）各恰好 1 红。

## [v6.6.3] · fix 订正：青训等级接入死忠演化 + 战绩查询按 tour 队 id 认人（2026-09-28）

**Fixed**
- **青训设施等级接入死忠演化**（`src/worker/home.ts`）：`windowHomeStatements` 调 `evolveFans` 此前没传 `youthLevel`（默认 0 级），青训设施买到 5 级（累计 44M）对死忠涨粉零作用。现循环前一条批量查询建 Map 传入，涨粉系数 ×(1+0.03n)；掉粉路径不受青训影响（插件 fans_service 同口径）。
- **`clubFormPts` 队 id 语义订正**（`src/worker/home.ts` + `src/worker/prizes.ts` 新增 `tourTeamIdsByClub`）：赛果快照表存比赛系统队 id，函数原先拿 club id 查、靠生产 20/20「两套 id 逐队相等」的巧合命中（米兰 legacy 47 vs 131681 期间恒返中性 4）。现参数改认 tour 队 id：确认钩子直接用主队 tour id（零额外查询），窗末结算走 AUTH_DB 反向映射（**刻意不做 CPU 过滤**——战绩是描述性口径不是发钱闸）；无映射回中性 4 分。

**验收**：零迁移零生产写、无前端改动。typecheck 三份全清；vitest **53 文件 / 837 例全绿**（v6.6.2 台账 53/833，净 +4）；变异验证三处各恰好 1 红。生产当前 20/20 id 相等 ⇒ A2 在生产数值上零变化，纯防将来 rekey/扩队再翻车。**已随 2026-09-28 发布批次上线**（Version `55a54d84-…`）。

## [v6.6.2] · 排序索引 batch 8（`fc_id` 排序侧 + 初始视图 `pa`）+ `fc_id` 筛选保持裸列的实测例外（2026-09-27）

**缘起与裁决**：`scripts/d1-read-audit/README.md` §5.3 / §10 的候选清单只剩 **2** 个可建索引的键（`fc_id` 排序侧 + `view=initial` 的 `pa` 变体，2 × 18,301 = 36,602 行写），本批收口，索引批次到此结束。当日配额（UTC 2026-09-27T09:19）实测：账号合计读 314,949（6.3%）/ 写 1,032（1.0%）⇒ 写余 98,968 行，两条索引占 37%，额度无压力。

**新增**
- 迁移 `0044_players_sort_indexes_batch8.sql`：`idx_players_sort_fc_id`（`COALESCE(fc_id, 0)`）、`idx_players_sort_initial_pa`（`COALESCE(COALESCE(json_extract(game_attrs, '$.PA'), pa), 0)`），均尾列 `id`；`tests/d1.ts` 的 `MIGRATION_FILES` 追加。
- `scripts/d1-read-audit/verify-0044.mjs`（结构 + EXPLAIN 的只读证据生成器，口径同 `verify-0043.mjs`）。

**修正**
- `scripts/measure-d1-reads.mjs`：`sort-fc-id` 与 `sort-pa-initial` 两条标签从「顺延 / 未建索引」改成「0044 表达式索引」。

**两条裁决（均以实测为准）**
- **`fc_id` 筛选保持裸列**：该列自带 UNIQUE 索引（`src/db/migrations/0001_init.sql:23` 的 `fc_id INTEGER UNIQUE`），裸列等值筛选是 **1 行**读（`SEARCH … sqlite_autoindex_players_2 (fc_id=?)`）；按 §8 的「等值键异键时同源」写法改成 `COALESCE(fc_id, 0) = ?` 会认不出 UNIQUE 索引 ⇒ 掉到 **18,301 行**。⇒ 给 §8 规则补一条实测例外：**筛选列自带 UNIQUE 索引时必须保持裸列**。`src/worker/routes/players.ts` 的 fc_id 筛选一行未动，只加测试锁钉住。
- **`fc_id` 排序侧建索引**，而不是把排序表达式改裸列去吃 UNIQUE 索引（方案乙零写、实测纯排序 21 行 / 第 2 页 22 行确实可用）：keyset 游标拿排序表达式当键，裸列遇 NULL 比较恒假会**静默漏行 / 翻页截断**，而 `fc_id` 在 DDL 里可空 ⇒ 按最坏情况取上界；写额度充裕，不值得为省 18,301 行写换这个上界。

**实测与验收**：零配额前置 `scripts/check-sort-index-feasibility.mjs` **17/17 通过**；`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 833 例全绿**（v6.6.1 台账 53/826，净 +7）；`tests/players-sort-indexes.test.ts` 本文件 **98 例全绿**（原 91）。变异验证两处：删掉 0044 的 fc_id `CREATE INDEX` ⇒ **恰好 4 例红**（三条 `sort=fc_id` 计划用例 + schema 计数用例）；把 fc_id 筛选改成同源 ⇒ **恰好 1 例红**（新加的例外锁）；均非空转，改动后还原。

**生产（2026-09-27）**：apply `echo y | npx wrangler d1 migrations apply whl-club --remote` ⇒ 只列 `0044`、`Executed 3 commands in 157.33ms`、状态 ✅；**实写记账 +36,621 行**（当日 `whl-club` 写 268 → **36,889 = 36.9%**；预估 36,602，差 19 是校验开销）。结构核对（`verify-0044.mjs`）：`idx_players_sort_%` **23 → 25**、`tbl_name='players'` 的索引 **28 → 30**、`d1_migrations` **44** 条（末条 `0044`）。计划形状：`sort=fc_id` 与 `view=initial&sort=pa` 两条纯排序均 `SCAN players USING COVERING INDEX <新索引>`，带 keyset 游标的第 2 页 `SEARCH … USING COVERING INDEX <新索引> (<expr><?`（尾列 `id` 确实进了索引，否则仍会临时排序）。收益（`measure-d1-reads.mjs`，增量合并进 `measurements-after.json`）：`sort=fc_id` **36,602 → 24 行/次**、`view=initial&sort=pa` **36,602 → 61 行/次**。

**登记未改**：`view=initial` 只影响排序与显示口径、**不影响 ca/pa 的区间筛选**（`RANGE_PARAMS` 的 `src` 写死为存量列）⇒ 初始视图下按 `ca_min=100` 筛会按存量 CA 过滤、却显示初始 CA。属索引批次之前就有的口径不一致，改它是行为变更，登记待办不顺手改。

**部署（2026-09-27 已执行）**：本批**无 `src/` 运行时改动**（只加两条索引 + 测试锁 + 脚本）⇒ 索引与线上已有的排序表达式同源，**收益在 apply 那一刻就已生效**；push `6925cbd..68fc154` 把攒下的 docs 提交一起带走，CF 自动部署 Version `c15bb1ea-5d3c-4619-9730-687e99fbeaae`（2026-09-27T16:25:37Z）。上线核对：线上入口资产 `assets/index-DkUnWIV2.js` / `assets/index-BY0ef8kg.css` 与本地 6.6.2 构建**逐字同名**、线上 JS 内含 `6.6.2`；`sort=fc_id` 与 `view=initial&sort=pa` 线上 200、`/api/offers` 401。

## [v6.6.1] · 排序索引 batch 7（`china_plan` / `agent_tier` / `growth_gap` 两个口径）+ 成长空间筛选同源（2026-09-26 完成，2026-09-27 上线）

**缘起与裁决**：`scripts/d1-read-audit/README.md` §5.3 的候选清单还剩 4 个可建索引的键，用户裁决「现在是半夜，写额度可以尽可能全用」⇒ 按当日写额度排满 **4 条**（4 × 18,301 = 73,204；5 条必超）。选 `china_plan` / `agent_tier` / `growth_gap` **两个视图口径**；`fc_id` 顺延（`sqlite_autoindex_players_2` 已让筛选侧 seek，只差排序侧）；`growth_gap` 按迁移 `0036` 定下的规矩两个口径同轮建；明确排除 `influence`（排序表达式是运行时参数化的 `influenceExpr(coefs)`，系数取自库表 ⇒ 系数一改索引即失配）与合同维度键（挂 JOIN 的 `contracts` 上，`players` 索引覆盖不到）。

**新增**
- 迁移 `0043_players_sort_indexes_batch7.sql`：`idx_players_sort_china_plan`（`COALESCE(china_plan, 0)`）、`idx_players_sort_agent_tier`（`COALESCE(agent_tier, 0)`）、`idx_players_sort_growth_gap`（`COALESCE(pa, 0) - COALESCE(ca, 0)`）、`idx_players_sort_initial_growth_gap`（初始视图口径的同一差值），均尾列 `id`；`tests/d1.ts` 的 `MIGRATION_FILES` 追加。
- `scripts/d1-read-audit/verify-0043.mjs`（结构 + EXPLAIN 的只读证据生成器，从 `scratch/` 提升为受版本管理的工件）。

**修正**
- `src/worker/routes/players.ts`：`china_plan` / `agent_tier` 从裸列改走 `eqFilter`（同键裸列、异键同源，口径同 v6.4.1）；`growth_gap` 区间从裸差值改成两侧各套 `COALESCE` 的**同源**写法 + 双侧 `IS NOT NULL` 守卫 —— 裸差值任一侧为 NULL 整行被排除，套了 `COALESCE` 会把「两边都没录」的行当成 0 放进来。
- `scripts/measure-d1-reads.mjs`：四条形状标签从「未建索引」改成「0043 表达式索引」，`sort-fc-id` 标注顺延，新增形状 `sort-growth-gap-initial`。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 826 例全绿**（v6.6.0 台账 53/810）。变异验证两处：删掉 growth_gap 的双侧守卫 ⇒ **恰好 2 例红**；删掉 `eqFilter` 的同键分支 ⇒ **恰好 6 例红**。零配额前置 `scripts/check-sort-index-feasibility.mjs` **17/17 通过**。apply（用户已放行当日写额度）：`Executed 5 commands in 215.43ms`；实写 **+73,211 行**（当日写 18,721 → **91,932 = 91.9%**）。生产核对：`idx_players_sort_%` **19 → 23**、`tbl_name='players'` 的索引 **24 → 28**、`d1_migrations` **43** 条；四条纯排序 `SCAN players USING COVERING INDEX <新索引>`（21 行/次），`growth_gap` 区间 + 同键排序在两个视图口径下各自 `SEARCH … USING INDEX`。收益：`sort=china_plan` / `sort=agent_tier` / `sort=growth_gap` / `view=initial&sort=growth_gap` 四条 **37,635 → 22 行/次**。

**部署（2026-09-27 已执行）**：迁移先于 2026-09-26 apply 到生产；代码随后于 **2026-09-27 推送**（`49e6802..6925cbd`，同轮带上尚未推送的 v6.6.0 三枚提交）⇒ CF 自动部署 Version **`1f5498c5-569e-41e9-8544-7901c1beae65`**（Created `2026-09-27T08:11:24Z`）。上线核对：线上入口资产 `assets/index-DWMy6Pr5.js` / `assets/index-BY0ef8kg.css` 与本地在 6.6.1 下构建的产物**逐字同名**、线上 JS 版本串 `6.6.1`；`/api/health`、三个新排序键、`growth_gap_min` 筛选全 200，`/api/offers` 401。部署后按 `scripts/d1-read-audit/README.md` §6 口径重跑了端点级读数：排序侧四格仍 **22 行/次**；另补测筛选面 6 个形状（README §10），其中 `growth_gap` 区间 + 同键排序两个视图口径 **37,635 → 22**。

## [v6.6.0] · 球员库按角色筛选（五槽 OR，不建索引）（2026-09-26 完成，2026-09-27 随 v6.6.1 的推送一起上线）

**新增**
- 球员库：左栏「更多筛选」的 PlayStyle 旁新增「角色」多选下拉（`?role=7,107` 逗号多值），分 `角色 +`（ID 1-49）与 `角色 ++`（ID 101-149）两段、段内按名字首段的位置码分组；摘要条一条 chip「角色：…」（不拆两段）。
- 筛选语义：RoleID1-5 五槽**任一命中即算**（槽位与档位无对应关系，故不像 ps 那样按槽段切分）；`+` 与 `++` 是同一角色的两档但**筛时当两个独立值、互不命中**（照 PlayStyle 银/金裁决），不做家族合并；参数白名单 1-49 ∪ 101-149（100 空档），去重去 0、上限 100 项。
- `src/core/fc26.ts` 角色常量与纯函数（`ROLE_SLOT_COUNT` / `ROLE_SLOT_KEYS` / `ROLE_BASE_MAX` / `ROLE_PLUS_BASE` / `ROLE_PLUS_MIN` / `ROLE_PLUS_MAX` / `isRoleId` / `isRolePlusId` / `ROLE_FILTER_MAX_ITEMS`）。

**裁决：原计划的「索引批」（路线 A）弃用，改走纯 OR（路线 C）**
- 用户下指令「先做索引批」时原定 5 条部分表达式索引 + `sort=id` 惰性 UNION 驱动。动工前三条实测否掉了它：① 计划的驱动形状把「其它筛选」留外层、内层 UNION 带 `LIMIT ?`，**带其它筛选会静默漏行**（翻页跳过角色命中集里第 N 条之后又满足筛选的人），只在「角色是唯一筛选」时正确；② 唯一正确的全量下推变体在带 `ct.*` / 非索引筛选时计划退化（`SCAN ct` / `SCAN p` + `TEMP B-TREE`）；③ 生产只读实测 `role=11`（2,772 人持有）—— 驱动形状 **21,626 行/次**、五槽 OR 靠 `ORDER BY id` 早停只 **188 行/次**，即索引路的收益只覆盖稀有角色、常见角色反慢两个数量级，而代价是 33,742 行写。
- ⇒ **零迁移、零生产写**（省下 33,742 行，当日账号池余量 81,001 行）。索引批登记为「已量化、待配额」的独立候选（`scripts/d1-read-audit/README.md` §5.3）。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 810 例全绿**（v6.5.0 基线 53/803，净 +7 = 新增角色 7 例）；build 成功；e2e **11/11**。变异验证两处 —— role 分支砍成一槽 ⇒ **3 例红**、值清单改成家族匹配（`IN (n, n+100)`）⇒ **4 例红**；还原后 `diff` 逐字一致。生产只读实测（管理通道，零写）：五槽占用 18,301 / 9,670 / 4,850 / 881 / 40；95 个合法值持有中（98 − 3 个 0 持有），46 个持有 <21 人；角色唯一筛选首屏（LIMIT 21）持有 1/5 人 18,301、24 人 4,455、130 人 2,623、490 人 873、2,772 人 188；COUNT 恒 ≈18,301。

**部署边界（等指令）**：无迁移、无生产写 ⇒ push 即自动部署；部署后按 README §6 口径重跑 `scripts/measure-d1-reads.mjs` 补 role 形状到 `measurements-after.json`。

## [v6.5.0] · 球员「标记」属性（🔴🟡🟢）+ 队徽方框修复（2026-09-26，已上线：迁移 `0042` 先 apply，push `e95122c..a8bb833` 后 CF 自动部署 Version `3bea29d7`）

**新增**
- 球员「标记」：把注册合规的三档梯度（规则 4.2.2）互斥切分成 🔴（初始CA≥90）/ 🟡（87-89）/ 🟢（＜87 且 PA≥87 且可成长），不落档无标记。**实时计算不落库**——判定是 `COALESCE(base_ca, ca)` + PA + growable 的纯函数（`src/core/squad-rules.ts` 的 `markerOf`），列表与详情响应由服务端现算（`marker` 字段）。
- 球员库：可选列「标记」（不落档整格空置）、左栏「标记」筛选下拉（`?marker=ge90,ge87` 逗号多值）、表头点排序（`sort=marker` 按权重 🔴→🟡→🟢→无标记）、摘要条 chip。
- 球员页：球员卡右上徽标（悬停出全称）。
- 迁移 `0042`：`idx_players_sort_marker` 权重表达式索引（排序/筛选/索引三处共用 `markerWeightSql` 同源表达式；apply 一次性写 ≈18,301 行）。

**修复**
- 队徽方框：v6.4.0 改动 7 抽走圆形后，`.team-logo` 常驻的 1px 边框在方形徽（球员页/球队详情页）上显形成方框；边框移入 `.team-logo-round`，球队列表圆形徽外观不变。

**实测与验收**：typecheck 三份全清；vitest **53 文件 / 803 例全绿**（v6.4.1 基线 53/789）；`INDEXED_SORTS` 18 → 19 条；build 成功；e2e **11/11**。已知形状：`sort=marker&marker=…` 同键组合落 TEMP B-TREE，但只排等值命中组（≤~120 行）代价可忽略。**部署**：迁移 `0042` 先 apply（`Executed 2 commands in 47.58ms`，索引 SQL 只读核验一致）→ push 后 CF 自动部署 Version `3bea29d7`；上线回读 marker 筛选/排序全 200、线上资产 `index-BdMUWht2.js` 与本地 dist 逐字一致。

## [v6.4.1] · 筛选侧同源化——等值键按排序口径分写法（2026-09-26 完成，随 v6.5.0 的推送上线）

**缘起**：batch 6（迁移 `0038`）把筛选侧无条件改成与排序表达式同源（`COALESCE(col, 0) = ?`），当次只量了 `sort=growth_tier&growth_tier=3` 一格（18,302 → 1）就当成无条件更优。用户要求按最坏情况复核（原话：「`agent_tier` 每个窗口都会重随，总有不是全 2 的时候；`marketvalue` 也会有赋值和改动，重新评估」「测试的时候要以最坏的情况做打算，底线思维」「任何测试都是这样」），复核推翻了原结论。

**修正**
- 区间键保持同源（`SEARCH … (<expr> op ?)`）并加 `AND col IS NOT NULL` 守卫 —— `COALESCE` 会把「没录过」算成 0，`market_value<=500` 不加守卫会把全 NULL 的 18,301 行算成命中。
- 等值键按排序口径分写法：筛选键 ≠ 排序键 → 同源（读量 = 命中行数）；筛选键 = 排序键 → **裸列**（顺索引早停，上界 1 × 表）—— 同源在此时落 `+TEMP B-TREE` 读完整个同值组再排，上界 **2 × 表**（实测 `growth_tier=1` 36,602、`is_future_star=0` 36,395）。逐格有 2 格同源更省（`foot=0` 8,877、`growth_tier=3` 1），但那是命中组小的运气，值域会变 ⇒ 按上界取裸列。
- `src/worker/routes/players.ts`：`RANGE_PARAMS` 每条加 `src`（同源表达式）+ 区间循环改写；新增 `eqFilter(col, key, value, sortKey)` 与 `parseSortKey(c)`；`growable` / `foot` / `growth_tier` / `is_future_star` 改走 `eqFilter`（`china_plan` 保持裸列）；`countPlayers` 传 `'id'`；文件头注释补版本行。
- `tests/players-sort-indexes.test.ts`：新增 describe「筛选侧与排序表达式索引同源（v6.4.1）」= 5 条区间 SEARCH 锁 + 4 条同键等值「写裸列且不得 TEMP B-TREE」+ 异键同源 SEARCH 锁 + 区间守卫文本锁 + NULL 身价端到端语义锁（自建 3 行夹具）；删掉 batch 6 已被设计反转的 2 例。
- `scripts/d1-read-audit/probe-samesource.mjs`（新，只读证据生成器）；`scripts/d1-read-audit/README.md` 追加第八节（机制四条 + 24 行实测矩阵 + 裁决依据 + 净效果逐键 + 语义守卫 + 测试锁 + 复现命令），§5.5 三处订正（两行「已收」数字标为**带条件**、batch 6「配方」补修正）。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 789 例全绿**（v6.4.0 基线 53/779，净 +10 = 新增 12 − 删掉 2）；变异验证两处 —— `eqFilter` 同键分支失效 ⇒ **恰好 4 例红**、区间守卫删掉 ⇒ **恰好 2 例红**。生产只读复测（管理通道，零写）24 格与 README §8 逐格一致。净效果（v6.4.0 线上 → 本版）：`ca>=100` 18,301 → **1**、`prestige>=5` 18,301 → **15**、`base_ca>=100` 18,301 → **1**（同键排序时）、`is_future_star=1`+`sort=id` 924 → **21**、`growth_tier=1`+同键排序 36,602 → **21**、`growable=1`+同键排序 20,948 → **21**、`foot=1`+同键排序 27,726 → **21**、`is_future_star=0`+同键排序 36,395 → **125**；两格变差：`growth_tier=3`+同键排序 1 → 18,301、`foot=0`+同键排序 8,877 → 13,884（按上界取舍，见上）。

**部署边界（等指令）**：无迁移、无生产写 ⇒ push 即自动部署；部署后按 README §6 口径重跑 `scripts/measure-d1-reads.mjs` 更新 `measurements-after.json`（该文件由线上端点产生，未部署前仍是旧代码读数）。

## [v6.4.0] · 报价设置解耦 + 激活通知证据制 + 竞价截止绝对时刻化（2026-09-26，已上线：迁移 `0040`/`0041` 先 apply，push `6dc0eb5..5d5beb6` 后 CF 自动部署 Version `2c4a81e6`）

**缘起**：四项既定整改 + 三项 UI 改动打包。用户裁决逐条：「截止的语义就是经计算后的绝对时刻，不容 5 分钟差错」「没进转会名单的应该也可以设置最低报价和是否自动应答」「低于线都按自动拒绝」「激活通知应当是除了站内信外，激活方要在激活时证明他在 QQ 给被激活方发了激活通知，而且被激活方可以举报（聚宝）」「举报不冻结匹配窗」「去掉『（成交等过户确认）』」「当前最高要带当前最高的队名」「球员被挂牌时左栏下方也该有转会信息与出价途径，不然用户在哪里出价」「右栏默认展示改属性、队徽的圆圈除了球队列表都去掉」。D1 性能逐项算清：新增读面 ≈ 0。

**新增**
- 迁移 `0040_listing_deadline_activation_proof.sql`：listings 加 `deadline_at`（落库的绝对截止时刻）+ `activation_proof`（激活 QQ 通知截图 key）+ 触发器 `fund_holds_bid_deadline_guard`（冻结语句原子拦过线出价，`WHL_BID_REJECT_DEADLINE`）；`0041_players_offer_auto.sql`：players 加 `offer_auto`（达线自动同意开关）。`tests/d1.ts` 追加两者（41 个）。
- **改动 A 截止绝对时刻化**：出价成功即按 `bidDeadline()` 把新静默期的绝对截止落库（普通出价推进带 `deadline_at > now` 过线守卫）；激活推进与结算收口清列；读路径（列表/详情）与惰性结算两级判定——先读列、存量行 NULL 回落实时算（兼容）。
- **改动 B 报价设置解耦**：`autoRespondKind` 重写为 `(minOfferPrice, offerAuto, amount)`——低于线一律 auto_reject（与开关无关、即时退回），达线且 `offer_auto=1` 才 auto_accept，没设线走人工；`transfer_listed` 不再参与判定。`setOfferSettings` 解耦：最低报价/开关不必进名单，进名单仍必填线；无线时开关存 0；非卖品压掉线与开关。PUT 端点加 `offerAuto`，players 详情透出。
- **改动 3 文案**：`offer_accepted` / `offer_auto_accepted` 去「（成交等过户确认）」，auto 两模板去「转会名单」字样。
- **改动 4 激活通知证据制**：`POST /api/media/activation`（本仓首个 R2 写端点：教练鉴权、key 服务端生成 `activation/<clubId>/`、限 png/jpg/webp 与 5MB）；`createActivation` 必填 `proofMediaKey`（两个激活入口同步），落 `listings.activation_proof`；站内信五模板（`activation_notice` 附证据 / `activation_reported` / `activation_matched` / `activation_passed` / `activation_match_expired`）；举报端点 `POST /api/market/listings/:id/activation-report`（仅被激活方）——只建 `activation_report` 核查任务 + 通知激活方，**不改挂牌状态、不冻结匹配窗**；管理端审核队列扩 IN 两值（report 行按 kind 分流渲染 + 截图链接）、`POST /api/admin/reviews/:id/resolve` 收口（裁定不自动改数据，写备注进审计）、overview 计数同步。
- **改动 5**：转会区列表聚合补领先出价方（active 出价每单至多一条），`MarketListing.highestBidder`，卡片「当前最高」显示「队名 · 金额」。
- **改动 6**：`GET /api/market/listings?player_id=` 按球员查现行挂牌；`usePlayerListing` hook；出价表单抽成共享组件 `MarketBidForm`；SideOps 挂牌态换数据源（修 useBoard 客户端 find 的分页截断漏单），B 态（本队挂牌，含训练营球员被别队激活）加举报入口，**新增「外队挂牌中」分支（挂牌信息 + 出价表单）——顺带修掉别队挂牌球员落 C 态、暴露必 4xx 报价/激活按钮的真缺陷**。
- **改动 7**：球员页右栏默认页签改「属性」；`TeamLogo` 加 `circle` prop（默认 true：Clubs 列表照旧圆形；ClubDetail 与球员页传 false 出方形徽）；圆形样式抽 `.team-logo-round`。

**实测与验收**：`npm run typecheck` 三份全清；`npx vitest run` **53 文件 / 779 例全绿**（v6.3.2 基线 53/772；自动应答 describe 重写四例、解耦设置用例、证据制三例、出价落库 deadline_at + 触发器兜底、列表聚合与 player_id 过滤等新增 7 例）；`npm run build` 成功（主 bundle `index-C68fzOUs.js` 592.10 KB / gzip 188.26 KB）；e2e **11/11**。定向变异已由同源测试锁覆盖（触发器 `WHL_BID_REJECT_DEADLINE` 在用例内直接验证）。**教训**：media 子应用挂在 `/api/media`，新端点路径要写 `/activation`（写 `/media/activation` 会 404）；本地 `.wrangler/state` 的 D1 处于「schema 已在、`d1_migrations` 为空」陈旧态，`npm run db:migrate:local` 必然报错，新列直接 `npx wrangler d1 execute whl-club --local --file …` 落地。

**部署边界（等指令）**：上线序列 = 先 apply 迁移 `0040`/`0041` 到生产 → push（CF 自动部署）；代码读 `deadline_at`/`activation_proof`/`offer_auto` 列，与 v6.3.2 同理有「先迁移后 push」硬约束。

## [v6.3.2] · 审计来源通道（`origin`）与 actor 契约收口（2026-09-26，已上线：迁移 `0039` 先 apply，push `eb7adb7..1f6ea16` 后 CF 自动部署 Version `70ce7423`）

**缘起**：v6.3.1 补齐了「钱动了，谁认领」的人类留痕，但普查暴露两件事：① cron / 惰性结算触发的审计 `actor` 是 NULL 或 0，「无人可归因」与「忘了传 actor」在日志里长得一样；② `actor` 只能回答「谁做的」，回答不了「**哪条入口**触发的」——同一笔惰性结算，可能是管理员关窗顺手跑的，也可能是某个用户 GET 列表顺手跑的，排查时无法区分。本版给 `audit_log` 加 `origin` 列正面回答通道，并把 `actor` 契约统一为「人类行为人 id，机器一律 NULL」。

**新增**
- 迁移 `src/db/migrations/0039_audit_origin.sql`：`ALTER TABLE audit_log ADD COLUMN origin TEXT`（可空）+ `CREATE INDEX idx_audit_log_origin ON audit_log (origin, id DESC)`；`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0039`。
- `src/lib/audit.ts` 导出 `export type AuditOrigin = 'user' | 'cron_tick' | 'lazy_settle' | 'backchannel' | 'machine'`；`AuditEntry.origin` **必填**（TS 层强制，新增审计点漏写编译不过）。
- 管理端审计日志新增 `?origin=` 精确过滤（与既有 `?action=` 前缀过滤并列，AND 语义），响应加 `origin` 字段；前端「来源」下拉 + 五值中文标签（`AUDIT_ORIGIN_LABELS`），操作者单元格改为「操作者 · 来源」。
- `scripts/prod-20260926-audit-origin-backfill/`：历史行回填工件（`01-precheck` / `02-backfill` / `03-verify` / `99-rollback` / README），**已于 2026-09-26 执行：100 行全部回填，`null_origin = 0`、`bad1`–`bad4` 全 0**。
- 同源锁扩 4 例：`src/**` 内 `actor: 0` 哨兵绝迹、两处手写 `INSERT INTO audit_log` 的列清单必须含 `origin`（tsc 管不到手写 SQL）、`AuditOrigin` 五值在场、四个机器常量确实被用上。

**变更**
- **`actor` 契约**：机器行为一律 NULL，`0` 哨兵退役（自动赛果确认与认证中心全端登出原先写 0，现写 NULL）；`result_confirmations.confirmed_by` 新行写 NULL（列可空）。读侧仍兼容显示历史 `0` 为「系统」。
- **全部审计写入点声明来源通道**（约 60 处 / 22 文件）：管理端 / 教练自助 / 玩家操作 ⇒ `user`；`runSettleTick`（cron 与 `POST /api/cron/tick` 共用）与 `autoConfirmResults` ⇒ `cron_tick`；市场 / 报价 / 谈判 GET 顺手结算 ⇒ `lazy_settle`（**actor 保持 NULL，不把惰性结算记到触发用户头上**）；认证中心推送的全端登出 ⇒ `backchannel`；内部机器通道建队 ⇒ `machine`。关窗时管理员触发的惰性结算记 `user`（触发者是人，不新造 `window_close` 值）。
- 共享 helper 一律**穿参**而非硬编码：`settleOverdue` / `settleListingForReview` / `expireStaleOffers` / `finalizeOffer` / `rejectOfferCore` / `confirmResult` / `completeTransfer` / `completeTermination` / `rejectTransfer` / `healSettlement` / `createBypassTransfer` / `createClubFromTourTeam`；两处手写 SQL（`src/lib/audit.ts`、`src/worker/bypass.ts` 的 `chargeBypassFee`）列清单同步加 `origin`。
- 顺带（用户插入的 UI 请求）：市场板与谈判页的「位置 · CA · PA」行改为「位置 · 年龄 岁 · CA · PA」并去掉 CA/PA 文字标签（`web/src/pages/market/MarketBoardPage.tsx`、`web/src/pages/Negotiations.tsx`）。
- 契约写入 `TECH_DESIGN.md` **§17.6 actor / origin 契约**（两列分工表 + 五值判据 + 部署顺序硬约束），§17.5「已知次级缺陷」标为已修；`scripts/ledger-audit/README.md` 覆盖表加 origin 列、§5-1 标已修、§6 补二次普查快照；`coverage.sql` 加 S11 / S12 两条 origin 查询；`scripts/README.md` 加新工件索引；`package.json` 6.3.1 → 6.3.2。

**生产只读预检（2026-09-26，`Rows written = 0`）**：`audit_log` 共 **100 行 / max_id 100**，分布 `result_confirm 74（actor=0）` / `auth_login 15` / `auth_backchannel_logout 3（actor=0）` / `season_bind_tournament 3` / `club_bind 3` / `auth_logout 1` / `season_create 1`；**财政类审计仍 0 条**。回填期望：`lazy_settle 0` / `cron_tick 74` / `backchannel 3` / `user 23`，合计 100 行、回填后无 NULL 残留（第 ④ 条 `actor IS NOT NULL ⇒ user` 的依据：旧代码只有机器路径写 `actor = 0`，没有任何机器路径会传非空 actor）。

**实测**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **53 文件 / 772 例全绿**（v6.3.1 基线 53/767，新增 5 = 同源锁 +4、admin-system +1）；全新内存库跑全部 39 个迁移，`audit_log` 末列为 `origin:TEXT`、`idx_audit_log_origin (origin, id DESC)` 在场；`npm run build` 成功（主 bundle `index-Dx2i3s22.js` 584.87 KB / gzip 186.23 KB；hash 随 `__APP_VERSION__` 注入的版本号变化）。**`npm run db:migrate:local` 未跑成**：本地 `.wrangler/state/v3/d1` 被在跑的 dev server（workerd）占用，且该库处于「schema 已在、`d1_migrations` 为空」的陈旧态（报 `table players already exists`），与本次改动无关 ⇒ 0039 的干净落地改由两条路证明：① 全新内存库跑全部迁移（`tests/d1.ts` 的 `applyMigrations`）；② `npx wrangler d1 migrations apply whl-club --local --persist-to scratch/d1-check` —— 39/39 全 ✅，随后查得 `audit_log` 末列为 `origin:TEXT`、索引 SQL 为 `CREATE INDEX idx_audit_log_origin ON audit_log (origin, id DESC)`。

**上线（2026-09-26 已部署，Version `70ce7423-a61b-44ca-bc1e-b6c58be99370`，08:26:51Z）**：**部署顺序硬约束**——代码引用 `origin` 列，而 CF Workers Builds 只跑 `vite build && wrangler deploy`（**无迁移步骤**）⇒ **先 apply 迁移、再 push**。本轮按此执行：① `npx wrangler d1 migrations list whl-club --remote` 实测待应用项只有 `0039_audit_origin.sql`；② `npm run db:migrate:remote` 报 `Executed 3 commands in 2.13ms`、`0039_audit_origin.sql ✅`；③ 生产只读回读 `audit_log` 末列 `origin:TEXT`、`idx_audit_log_origin (origin, id DESC)` 在场、`COUNT(*) = 100` 且 `origin IS NULL = 100`（历史行待回填）；④ `git push origin main`（`eb7adb7..1f6ea16`）；⑤ 线上首页资产由 `index-Ccub4jvf.js` 变为 `index-Dx2i3s22.js`（= 本地 dist 产物）⇒ 部署落地。

**历史行 `origin` 回填（2026-09-26 已执行，用户授权）**：回填前复跑只读预检，工件假设仍成立（`total = 100`、`max_id = 100`、`origin IS NULL = 100`、`origin IS NOT NULL = 0`、`id > 100` 的 NULL 行 0 条 ⇒ 迁移与新代码上线后尚无新审计行写入，`99-rollback.sql` 的 `id <= 100` 边界仍准确）。`npx wrangler d1 execute whl-club --remote --yes --file=scripts/prod-20260926-audit-origin-backfill/02-backfill.sql` 报 `Total queries executed = 4`、`Rows written = 200`、`sql_duration_ms 4.10`、`changed_db true`；`03-verify.sql` 只读验收**逐项与期望一致**：`total 100` / `null_origin 0` / `user 23` / `cron_tick 74` / `backchannel 3` / `lazy_settle 0` / `machine 0` / `other 0`，反例 `bad1`–`bad4` 全 0。回填后分布：`cron_tick·result_confirm·actor=0` 74（2026-09-20T05:45:06.359Z → 2026-09-25T13:15:37.697Z）、`backchannel·auth_backchannel_logout·actor=0` 3、`user` 23（`auth_login` 15 / `season_bind_tournament` 3 / `club_bind` 3 / `auth_logout` 1 / `season_create` 1）。**刻意未做**：`actor = 0` 的历史哨兵保持原样（`0` 是历史值，读侧按「系统」兼容显示；通道已由 `origin` 说明）。**未执行回滚**（不需要）。

## [v6.3.1] · 财政域留痕补齐与一笔线上订正（2026-09-26，已上线：与 v6.3.2 同轮部署，Version `70ce7423`）

**缘起**：生产普查（报告落 `scripts/ledger-audit/`）发现账本只保证「钱对不对」，不保证「人认不认领」——除自动奖金（`prize`）与自动主场收入（`revenue`）外，生产上唯一一笔支出是慕尼黑1860（club 33）的球场扩建 −0.50M，而 `audit_log` 里**零留痕**，操作人只能靠相邻的 `club_bind` 审计行反推。本版补齐人类触发路径的留痕，并把那笔支出按补偿分录口径订正。

**新增**
- `tests/ledger-audit-lock.test.ts`（5 例，同源锁）：静态扫描 `src/**` 强制四条约束——白名单外凡含 `ledgerMovement(` 的文件必须同时具备审计能力（`createAuditStatement` / `writeAudit`）；白名单文件必须**仍然**在写账本（防豁免区腐烂）；`INSERT INTO audit_log` 只许出现在 `src/lib/audit.ts` 与 `src/worker/bypass.ts`；`src/worker/routes/clubs.ts` 四个自助财政端点必须传 `user.id`，`window_close` 审计必须带 `payroll` / `home` 汇总。
- `scripts/ledger-audit/`：`README.md` 财政域留痕普查报告（每个 kind 的写入点 / 审计 action / actor 来源、白名单理由、已知次级缺陷、生产实证、权威锚点）与 `coverage.sql`（10 条只读复核查询，S3 是 `Σbalance − Σamount = 0` 守恒硬断言）。
- `scripts/prod-20260926-rollback-stadium-expand/`：线上订正工件（`01-precheck.sql` / `02-rollback.sql` / `03-verify.sql` / `99-rollback.sql` / `README.md`）。

**变更**
- **球场三端点留痕**：`expandStadium` / `upgradeStadiumTier` / `upgradeFacilityLevel` 各加必填末参 `actor`，同批写 `stadium_expand` / `stadium_upgrade` / `facility_upgrade` 审计（`target_type='stadium'`，`before` 为改动前三列、`after` 为新值 + `seats`/`cost`/`creditUsed`/`cash`/`refund`）；`src/worker/routes/clubs.ts` 三处端点传 `user.id`。守卫取值改为按语句下标显式定位。
- **冠名解约留痕**：`terminateNaming(env, clubId, actor)` 写 `naming_terminate`（`target_type='naming_contract'`，赔款为 0 也留痕）；路由端点传 `user.id`。
- **审核类附加费留痕**：`chargeBypassFee` 加第 7 参 `actor`，手写条件 INSERT `bypass_fee`——`createAuditStatement` 表达不了 `WHERE`，而该审计必须与账本自己的幂等闸及批内余额/状态守卫**逐字一致**，否则审核重放或并发动用余额时会留下「钱没扣、审计说扣了」的失实行；故排在账本之前落库，守卫取末条 `transfers` UPDATE 的 `meta.changes`。这是全仓第二处手写 `INSERT INTO audit_log`（第一处是 `src/lib/audit.ts` 自己）。
- **关窗批汇总**：`window_close` 审计的 `after` 增两个键 `payroll`（`PayrollSummary`：`wageClubs`/`wageTotal`/`taxClubs`/`taxTotal`）与 `home`（`HomeWindowSummary`：`maintenanceClubs`/`maintenanceTotal`/`fansClubs`/`namingClubs`/`namingTotal`），让自动扣款也归因到「谁关的窗」。
- 留痕判据三档写入 `TECH_DESIGN.md` §17.5（人类触发必留痕 / 自动但可重建锚回业务对象 / 账本原语分层不留痕）；`scripts/README.md` 加 `ledger-audit/` 与 `prod-20260926-*` 两处索引。
- `package.json` 版本 6.3.0 → 6.3.1。

**实测**：typecheck 三份全清；vitest **53 文件 / 767 例全绿**（v6.3.0 基线 52/762，含新增锁测试 5 例与 stadium/naming/window/bypass 四处行为断言）；build 成功（主 bundle `index-D8FGDNfM.js` 584.84 KB / gzip 186.22 KB；前端版本号由 `vite.config.ts` 的 `__APP_VERSION__` 从 package.json 注入，故 hash 随 6.3.0→6.3.1 变化、字节数不变）。

**上线（2026-09-26：生产库已订正；代码与 v6.3.2 同轮部署，Version `70ce7423`）**：`02-rollback.sql` 经 `--file` 执行 `changes=4` / `last_row_id=163`；`03-verify.sql` 十列全中——club 33 容量回到 **12000**、建设券 **0**、余额 **56.51**、`manual_adjust` **1** 条、原 `stadium_expand` 流水**仍在**、**守恒 `drift = 0`**、流水共 **163** 笔（`prize` 103 / `revenue` 58）。订正口径为**补偿分录**：新增 `manual_adjust` +0.5（id=163，memo 指回原流水 id=141），`ledger_accounts.balance` 差额加回，**原流水未删未改**（账本只增，删行会破坏 `balance_after` 链）。不可逆影响面为空：该队历史最大上座 **10140** < 原容量 12000，扩建从未影响过任何一场的上座与收入。

## [v6.3.0] · 报价 / 议价子系统（2026-09-26，已上线：本次 push 前线上 Version `fefd7366`，02:31Z；迁移 `0037` 已 apply 到生产）

**新增**
- 迁移 **`0037_offers.sql`**：`players` 加三列（`transfer_listed` / `min_offer_price` / `not_for_sale`，报价设置）；`offers` 报价单表（多买方可并发同挂一球员，partial unique `idx_offers_active_pair` 只拦同买方重复）+ `offer_events` 谈判桌事件流 + 触发器 `fund_holds_offer_guard`（与 0005 同形：offer 仍 pending / 冻结额与报价单一致 / 可用资金足额，错误码 `WHL_OFFER_REJECT_*`）。
- 纯逻辑 `src/core/offer-rules.ts`：金额边界（下限 1 m、上限 1.5×违约金）、严格抬高、轮次判定、名单自动应答（达线 auto_accept / 低于 auto_reject）。
- 业务编排 `src/worker/offers.ts`：送报价（报价即冻结 + 名单球员立即自动应答）/ 还价（买方还价顶替冻结、卖方还价不动资金）/ **同意即挂牌事务**（占用批 + 履约批：建挂牌 → hold 转正 → 领先出价 → 球员 listed → 兄弟单 expired 释放冻结；幂等可重入，崩溃窗口由 `expireStaleOffers` 自愈补履约）/ 拒绝 / 撤回 / 惰性过期（窗关 / 球员状态变 / 同球员已挂牌三因）/ 报价设置。买方接受卖方抬价后的还价时先补足冻结再占用。
- 路由 `src/worker/routes/offers.ts`：`GET /offers`（box in|out + 状态筛选 + 游标分页 + `pendingMine` 徽标数）、`GET /offers/:id`（含事件时间线，买卖双方可见）、`POST /offers`、`POST /offers/:id/counter|accept|reject|withdraw`、`PUT /players/:id/offer-settings`。触发器兜底裸错（`WHL_OFFER_REJECT_*` / partial unique）在业务层映射为可读 4xx（与 market 的 `WHL_BID_REJECT_*` 同形）。
- 通知 8 模板（`offer_received/countered/accepted/rejected/withdrawn/expired/auto_accepted/auto_rejected`）；「同意即挂牌，成交要等过户确认」口径（用户裁决 2026-09-25）贯穿通知、徽章与按钮文案。
- 前端：`/offers` 转会报价页（两页签 + 状态筛选 + 清单表格 + 谈判桌），顶栏「转会报价」入口；球员页左栏 `SideOps` 五态骨架接线真实端点（拆出 `web/src/pages/player/SideOps.tsx`）——报价设置真实读写、续约/挂牌/解约/报价/激活/海捞全可用、B 态显示真实要价与最高出价、D 态非卖品报价禁用。

**变更**
- `src/worker/market-settle.ts`：`settleOverdue` 开头先跑 `expireStaleOffers`（cron / 窗开关 / 读路径三处调用点全覆盖）。
- `src/lib/cache-policy.ts`：`WRITE_SCOPE_PREFIXES` 加 `/api/offers` 与 `/api/players`（offer-settings 挂后者）。
- `src/worker/routes/players.ts`：球员详情响应加 `transferListed / minOfferPrice / notForSale` 三字段。
- **随批交付（独立改动线）**：迁移 **`0038_players_sort_indexes_batch6.sql`** 两条排序索引（`growth_tier` / `future_star`），并把这两列的等值筛选侧改成与索引同源的 `COALESCE(col, 0) = ?`——一条索引同时收排序与筛选（`tests/players-sort-indexes.test.ts` 新增「seek 不是全索引扫」断言锁死）。

**实测**：typecheck 三份全清；vitest **52 文件 / 762 例全绿**（v6.2.0 基线 51/728，含新增 `tests/offers.test.ts` 26 例与变异验证三件套：删严格抬高 / 删 partial unique / 删触发器各定向变红）；build 成功（主 bundle `index-DFG2gxUk.js` 584.84 KB / gzip 185.35 KB，较 v6.2.0 +2.2 KB）；e2e **11/11**；双会话浏览器手测全链路 PASS（报价 → 收件 → 同意 → 挂牌 B 态 → 非卖品 D 态 → 海捞 E 态 → offer-settings 保存与清回），截图落 `scratch/manual-v63-*.png`。迁移 0037 已在本地 D1 apply。

## [v6.2.0] · 球员页展示层改版（2026-09-25，已上线：本次 push 前线上 Version `fefd7366` 已含本版）

**新增**
- 球员页左栏五态骨架 `SideOps`（`web/src/pages/Player.tsx`）：本队未挂牌 = 报价设置（转会名单 / 最低报价 / 非卖品，全禁用）+ 续约/挂牌/解约 + 「我收到的报价」入口；本队挂牌中 = 「转会区 · 本队挂牌中」信息卡；别队真人 = 报价/激活；非卖品 = 报价禁用（后端暂无字段，运行时不可达）；CPU 队/自由身 = 海捞签入。**控件全部禁用，真实数据与动作接线在 v6.3.0 报价子系统。**
- 属性页签头部两栏：左 = 标题/位置/角色，右 = **队徽 96px**（`TeamLogo`，logoKey 借公开 `GET /api/clubs` 的 `ClubSummary.logoKey`，哈希色块兜底）+ **232×156 光图六维雷达**（轴标签 = 三字母 + 数值；`radar-card` 卡框与文字 legend 整块删除）。

**变更**
- 状态词两表合一：删 `web/src/lib/ref.ts` 的 `STATUS_LABEL`（正常/无归属），全站统一用 `players-library.ts` 那套（在队/自由身）。
- 术语：「挂牌板 / 挂牌单」→「转会区」（市场板 h3 一处界面文案 + 6 处注释；页面大标题「转会市场」不动）。
- **转会窗门控（用户裁决「转会操作只有窗开时开放，管理端可手动开关」）**：球员页左栏接公开 `GET /api/seasons/current`，关窗出「转会窗未开放」提示条（后端六类转会写操作本就有 409 `no_window` 守卫、管理端开/关窗 UI 已存在，均零改动）；**改号也归转会窗管**（用户补令）——`POST /api/club/players/:id/number` 加窗守卫（关窗 409），球员页号码编辑入口关窗收起改只读。
- 队徽与 CPU 判据数据源：球员详情页按需拉公开 `GET /api/clubs`（与球队页共用 `qk.clubsList` 缓存键，服务端 24h scope 缓存）。
- `package.json` 版本 6.1.1 → 6.2.0。

**实测**：typecheck 三份全清；vitest **51 文件 / 728 例全绿**（含新增关窗 409 用例）；build 成功（主 bundle gzip 183.15 KB，较 v6.1.1 +0.7 KB）；e2e **11/11**；五态浏览器手测 + 窗关/窗开两态翻转实测全过（本地夹具临时翻转、测后还原），截图落 `scratch/manual-*.png`。

## [v6.1.1] · Sentry 错误追踪接入（2026-09-25，已上线：Version `b05e86db`）

**新增**
- `wrangler.jsonc`：`compatibility_flags: ["nodejs_compat"]`（Sentry SDK 依赖 AsyncLocalStorage）+ `version_metadata` 绑定（Sentry release 自动 = Cloudflare 部署版本 ID）。
- `src/worker/index.ts`：`@sentry/hono/cloudflare` 的 `sentry()` 中间件挂在一切路由之前（errors-only：`tracesSampleRate: 0`，SDK 默认过滤让带 status 的 3xx/4xx 业务错误不上报）；cron 从 `ctx.waitUntil` 改 `await` 并加 `withMonitor('club-settle-tick')`（Sentry Crons check-in 监控）；新增 `POST /api/cron/sentry-probe`（CRON_KEY 守卫）作上线验证探针。`app.onError` 与全部报错 JSON 形状不动。
- `src/worker/env.ts`：`SENTRY_DSN?`（secret，未配 = SDK 完全不初始化、零上报零网络）、`SENTRY_ENVIRONMENT?`、`CF_VERSION_METADATA?`。
- `web/src/lib/sentry.ts` + `main.tsx`：`@sentry/react` errors-only 初始化（不引 replay/ErrorBoundary）；DSN 空串 = 未接入。
- `tests/sentry.test.ts` 3 例（DSN 未配旁路 / 探针 403 / 探针 500 JSON 形状）。

**变更**
- `tests/media.test.ts`：waitUntil 精确计数 `toHaveLength(1)` 放宽为 `≥1`——Sentry 会在同一 executionCtx 登记自己的 flush drain（生产语义：让 isolate 活到事件发完）。
- `package.json` 版本 6.1.0 → 6.1.1；新增依赖 `@sentry/hono` / `@sentry/cloudflare` / `@sentry/react`（v11.0.0，首个第三方 SaaS 运行时依赖）。

**实测**：typecheck 三份全清；vitest **51 文件 / 727 例全绿**（基线 724）；build 成功且主 bundle `index-BqdBJFJR.js`（477,874 B / gzip 149,563 B）**与改动前逐字节同 hash**——前端 DSN 为空串时 rollup 把整个 SDK 死代码消除，填 DSN 后须实测增量（硬线 ~35KB gzip）；e2e **11/11**；`wrangler deploy --dry-run` worker 打包通过。

**上线（2026-09-25）**：Sentry 账号已建（EU 区 org，6 项目）；生产 `SENTRY_DSN` 已配（Source `Secret Change`，Version `6066268f-…`，10:01:17Z）；前端 DSN 已填（提交 `a502043`）并实测 @sentry/react 进包 gzip 增量 **32.92 KB**（149,563 → 182,479 B，硬线内贴线过）；push 后 Workers Builds 自动部署 Version **`b05e86db-…`**（10:24:56Z），回读 `/api/health` 200、`POST /api/cron/sentry-probe` 无 key 403（该路由只在 v6.1.1 代码 ⇒ 新代码生效）、线上首页资产 `index-DwvQl1O1.js` 与本地 dist 逐字一致。**待回读**：带生产 CRON_KEY 打 probe 在控制台见事件、Crons 页确认 `club-settle-tick` monitor（首个 `*/5` 整点自动创建）。配额口径：errors 5k/月 = org 级共享池（6 项目共用，官方文档核对）；免费档全 org 只含 1 个 cron monitor（check-in 次数不占 errors 额度）。

## [维护] · 排序索引 batch 6：迁移 `0038`（2026-09-25 已 apply 到生产：无运行时行为变化）

**缘起（本批换了选键依据）**：batch 4/5 是「配额能推几条推几条」，本批先查清「这 6 个键到底有没有人用」再选，结果**推翻了原计划**：① `web/src/lib/players-library.ts:273` 的 `DEFAULT_COLS = ['marketValue', 'badges']` ⇒ 这 6 个键**一个都不是默认可见列**，排序要用户先手动挑列才发生；② 用户真正会做的是**筛选**，而筛选侧走**裸列**（`players.growth_tier = ?`，`src/worker/routes/players.ts:295-320`）与排序侧的 `COALESCE(col, 0)`（`:80-88` `buildSortExprs`）**不同源** ⇒ 表达式索引帮不上筛选 —— 这就是「排序降了、筛选没降」的机制。

**设计裁决**：排序侧不动（仍 `COALESCE(col, 0)`），索引建 `(COALESCE(col, 0), id)`，**筛选侧改成 `COALESCE(col, 0) = ?` 与索引同源**。否掉原计划的「排序改裸列 + 普通列索引」：keyset 游标拿排序表达式当键，裸列一旦为 NULL 比较恒为假会**静默漏行**（`src/worker/routes/players.ts:96` 的 years 注释写明这条规矩），而这五列在 `src/db/migrations/0001_init.sql:18-23` 是可空的（生产当前 NULL 数 0，但口径不该依赖数据现状）；两条路的写配额相同。

**交付**
- `src/db/migrations/0038_players_sort_indexes_batch6.sql`（**2026-09-25 已 apply**，报 `Executed 3 commands in 62.85ms`）：`idx_players_sort_growth_tier`（`COALESCE(growth_tier, 0), id`）、`idx_players_sort_future_star`（`COALESCE(is_future_star, 0), id`）。**apply 绕开未授权的 `0037`**：`0037_offers.sql` 是另一会话在途的报价子系统迁移，用仓库配置跑 `d1 migrations apply` 会把它一起 apply ⇒ 临时配置 `scratch/wrangler-0038.jsonc`（`migrations_dir: "migrate-0038"`，目录里只放 0038）先 `migrations list --remote` 确认只剩 0038 再 apply；apply 后账本核对最新 = `0038`、上一条 = `0036` ⇒ 0037 未被 apply。
- `src/worker/routes/players.ts`：筛选侧 `filters.push('COALESCE(players.growth_tier, 0) = ?')` + 循环里 `['is_future_star', 'COALESCE(players.is_future_star, 0)']`。
- 同源锁：`tests/players-sort-indexes.test.ts` 元组加第 4 元素 `filter`、新增 2 条「等值筛选走同一条索引」用例、`INDEXED_SORTS` 16 → **18 条**；`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0038`；`scripts/measure-d1-reads.mjs` 补 **9 条探针**（6 个未建索引键 + `view=initial&sort=pa` + 2 条筛选形状）。

**关键发现（SQLite 计划器）**：索引首列被等值约束时，SQLite **不再用它出 ORDER BY** —— `scratch/probe-0038-plan.mjs` 七种组合实测：只排序 → `SCAN … USING COVERING INDEX`（有序、无临时排序）；筛选 + 同键排序（含 ASC / 无 id 尾列变体）→ `SEARCH … USING COVERING INDEX (…=?)` + **`USE TEMP B-TREE FOR ORDER BY`**。⇒ 筛选侧收益是「读量从全表扫降到命中子集」，不是提前停；用例因此只锁 `SEARCH`，不断言无临时排序。

**收益实测**（读数落 `scripts/d1-read-audit/measurements-after.json`）：`sort=growth_tier` 37,635 → **22**、`sort=future_star` → **22**、`sort=growth_tier&growth_tier=3` 18,302 → **1**、`sort=future_star&is_future_star=1` 18,504 → **307**。未建索引的 `china_plan` / `agent_tier` / `fc_id` / `growth_gap` / `view=initial&sort=pa` 五条仍 37,635（把 §5.1 的类级推断再实测一次）。生产 `sqlite_master` 核对 `idx_players_sort_%` **16 → 18 条**；生产 EXPLAIN：排序 `SCAN players USING COVERING INDEX idx_players_sort_growth_tier`、筛选 `SEARCH players USING COVERING INDEX idx_players_sort_growth_tier (<expr>=?)`。

**写入记账**：本次 apply 实写 **≈36,607 行**（apply 前当日 `whl-club` 写 55,075 → apply 后 **91,682 = 91.7%**）⇒ **当日写额度已贴顶，剩余 ~8,318 行放不下第三条索引（18,301）**，本批到此为止。

**验收**：`npm run typecheck` 三份 tsconfig 全清（当时 16 个错误全落在另一会话在途的 `tests/offers.test.ts`，本批四个文件零错误）；`npx vitest run` **52 文件 / 762 例全绿**（基线 50/724，多出的 2 文件来自另一会话在途的 offers 测试）；`npm run build` 成功。

**还剩**：`china_plan` / `agent_tier` / `fc_id` / `growth_gap` 四个键 + `view=initial` 口径的 `pa` / `growth_gap` 两个变体；这四个键与 `growth_tier` 同性质（排序表达式 + 裸列筛选），可照本批配方用一条索引收两面。**代价**：`players` 索引 21 → **23** 条（upsert 重导成本口径需按同一方法重算，本批未做）。

## [维护] · 排序索引 batch 4/5：迁移 `0035` / `0036`（2026-09-24 / 09-25，两个迁移已 apply 到生产：无运行时行为变化）

用户 m04225 裁决「先看看剩余写限额，能推几条是几条」⇒ 先实测当日配额，再按余量把第 5 节清单上的排序索引推进生产。**不改 `src/` 与 `web/`**：只有两个迁移、测试与文档 ⇒ 运行时代码与前端产物零变化。

**新增**
- `src/db/migrations/0035_players_sort_indexes_batch4.sql`（**2026-09-24T23:54Z apply，UTC 归零前 6 分钟**，报 `Executed 3 commands`）：`idx_players_sort_position`（12 项 `CASE position WHEN 'GK' THEN 1 … ELSE 0 END, id`，逐字等于 `src/worker/routes/players.ts` 的 `POSITION_SORT_CASE`，**索引侧必须去掉 `players.` 限定符**，否则 SQLite 报 `the "." operator prohibited in index expressions`）+ `idx_players_sort_growable`（`COALESCE(growable, 0), id`）。选这两条的理由：它们是 `web/src/lib/players-library.ts` 的 `FIXED_COLUMNS`（位置 / 成长，永远在表头、不可隐藏），暴露面最大，表达式也最安全。
- `src/db/migrations/0036_players_sort_indexes_batch5.sql`（**2026-09-25T00:00Z 归零后 apply**，报 `Executed 4 commands`）：`idx_players_sort_badges`（`(COALESCE(badges_silver, 0) + COALESCE(badges_gold, 0)), id`）、`idx_players_sort_base_ca`（`COALESCE(base_ca, 0), id`）、`idx_players_sort_foot`（`COALESCE(foot, 0), id`）。**刻意跳过 `growth_gap`**（理由写进迁移注释）：它在默认视图下可静态索引，但 `view=initial` 口径下 pa/ca 换成另一套表达式，单独建默认视图那条只覆盖一半场景 ⇒ 与 `view=initial` 的 `pa` 变体同轮处理。
- `scripts/measure-d1-reads.mjs` 补 5 条探针：`sort-position` / `sort-growable` / `sort-badges` / `sort-base-ca` / `sort-foot`（原 SHAPES 里没有这 5 个键，不补就没有「改后」读数可对）。
- `tests/players-sort-indexes.test.ts` 的 `INDEXED_SORTS` 11 → **16 条**（新增 5 条各带 cursor / `order=asc` 三形状），`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0035` / `0036`。

**配额实测**（`scratch/quota-check.mjs`，走 Cloudflare GraphQL `d1AnalyticsAdaptiveGroups`）
- 2026-09-24T23:49Z：`whl-club` 读 221,080（4.4%）/ 写 54,997（55.0%）；**账号池余量 ≈44,541 行 ⇒ 2 条索引（36,602）放得下、3 条（54,903）会超** —— 这是把本批拆成 `0035`（2 条）/ `0036`（3 条）并跨归零点分两次 apply 的根本原因。
- 2026-09-24 终值：`whl-club` 写 **91,604 行 = 91.6%**（`0034` 的 54,919 + `0035` 的 36,602 + 零头），当日写额度贴顶用满。
- 2026-09-25（归零后）：`whl-club` 写 **54,909 行 = 54.9%**（`0036` 的 3 条）。
- 顺带修了脚本里**过期的库名映射**（实际 `whl` = `ec3cc695-70bc-47ab-a454-5ca62ec22dd6`、`whl-auth` = `8f48bd5e-5d1b-4d62-ba4f-bf9b0cdb09eb`、第四个库 `b76d1129-77ae-4844-931c-1c7b00a9b048`；`whl-club` 一直是对的），并支持 `node scratch/quota-check.mjs 2026-09-24` 查指定 UTC 日期。

**收益实测**（`scripts/d1-read-audit/measurements-after.json`，改前 → 改后）

| 形状 | 索引来源 | 改前 | 改后 |
| --- | --- | --- | --- |
| `sort=position` | `0035` | 37,635 | **22** |
| `sort=growable` | `0035` | 37,635 | **22** |
| `sort=badges` | `0036` | 37,635 | **22** |
| `sort=base_ca` | `0036` | 37,635 | **54** |
| `sort=foot` | `0036` | 37,635 | **22** |

**副产品**：`0036` 生效**前**实测 `sort=badges` / `sort=base_ca` / `sort=foot` 三条恰好各 **37,635 行**，把审计报告 §5.1 那句「剩余键各 37,635 行/次」的类级推断变成了直接实测。一次测量假象：`sort=foot` 首跑报 `0 行 [0 + undefined]`（statements 0 条、0ms），重跑即得 22 行 —— 是 wrangler 偶发抓取失败，不是索引问题。

**生产核对**：`sqlite_master` 里 `idx_players_sort_%` **11 → 16 条**（两次只读 `wrangler d1 execute --remote`，`rows_written: 0`）；`players` 表索引总数 **16 → 21**。

**操作技巧（下次复用）**：`wrangler d1 migrations apply` 会把目录里**所有 pending 一次做完**，所以为了在归零前只推 `0035`，先把 `0036` 临时 `mv` 到 `scratch/0036-pending.sql`，`npx wrangler d1 migrations list whl-club --remote` 确认只剩 `0035`，apply 后再 `mv` 回 `src/db/migrations/`。首次 apply 撞了一次 `AuthenticationError`（wrangler 日志 `"errorType":"AuthenticationError"`、`durationMs:2699`），**直接重试同一条命令即成功**（令牌抖动，不是权限问题）。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **50 文件 / 724 例全绿**（`0034` 批之后是 709，本批 +15 = 5 条形状 × 3）。

**文档同步**：`scripts/d1-read-audit/README.md` 新增 §3.3（三批收益合并表 + 探针口径 + 写入记账）、§5.1 分类行改为「已建 7 / 剩余 6」、§5.3 第 3 条补 2026-09-25 进展、§5.5 补 5 行「已收」、§六 补 `--only=` 只接一个形状与 5 条新探针的说明；`scripts/players-import/README.md` 写入成本口径 **16 → 21 索引**（upsert 重跑 11 → **14 行/人 = 256,214**，全量重导须跨 **5** 个 UTC 日）；`README.md` 迁移 34 → **36**；`ROADMAP.md` 维护节加 batch 4/5 段；`AGENTS.md` 生产迁移段 `0034` → `0036` 与当前状态 bullet。

**下一批待令**：清单上还剩 **6** 个可建索引的键（`growth_gap` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id`），仍按「每天最多 3 条」分批；`view=initial` 口径另欠 `pa` / `growth_gap` 两个变体。

## [维护] · 上线口径订正：push 到 main 会触发 CF 自动部署（2026-09-24，文档：无运行时行为变化）

2026-09-24 实测确认：本仓与 `tour` / `whl-auth` / `whl-guess` 四仓都接了 Cloudflare 的 Git 集成（Workers Builds）—— `git push origin main` 之后约 30–60 秒，CF 在服务端自动构建并部署对应 Worker，不需要任何本地命令。证据：同日三仓推送（用户只下令 push、未下令 deploy）后 `whl-club` 部署 `04:33:27.890Z`（Version `a65570f8-…`）、`whl-auth` `04:33:45.766Z`（`458e0e94-…`）、`whl-guess` `04:34:15.675Z`（`c6d741aa-…`），顺序与 push 顺序一致、间隔 30–60 秒；未推送的 `tour` 无新部署。同轮更早还有一次交叉验证：手动 `npm run deploy` 出的 `a573ade7`（03:37:53Z）两分钟后被 push 触发的 `c5e796f6`（03:40:13Z）顶掉。

排除项与取证边界：四仓都没有 `.github/` ⇒ 不是 GitHub Actions，是 CF 服务端的集成；`wrangler deployments list` 的 Source 字段**不区分**来源（自动部署同样报 `wrangler` / `Unknown (deployment)`，因为构建容器里跑的就是 `wrangler deploy`）；构建日志拿不到 —— OAuth token 缺 `workers_builds` 读权限（`/accounts/<id>/builds/*` 一律 `Authentication error`，wrangler 无 `builds` 子命令）⇒ 构建命令是否含 typecheck 未能验证，只能看 CF 面板 Settings → Builds。

⇒ `AGENTS.md` 危险清单的 `git push` 条与「部署即 push」段已同步订正：**push 即上线，「只推不部署」不存在；已 push 后不必再手动 `npm run deploy`（冗余且会被自动部署顶掉）；push 前必须本地 `npm run typecheck` + `npm test` 全绿。**

## [维护] · players 全量覆盖的写入成本口径订正（2026-09-24，文档：无运行时行为变化）

用户 m02214 问「如果随后更新或者完全覆盖了 players 表，索引需要重写吗」⇒ 结论：走 `INSERT` / `UPDATE` / `DELETE`（含本仓导入用的 `INSERT ... ON CONFLICT(fc_id) DO UPDATE` upsert）时 SQLite 自动维护全部索引，无需 `REINDEX`；`UPDATE` 只为「SET 列表里出现过的列」所属的索引写新条目。唯一例外是 `DROP TABLE players` 式重建 —— 索引一起消失（本条目写作时是 16 条，`0035`/`0036` 之后是 **21 条**），而 `d1_migrations` 仍记着 `0033`–`0036` 已 apply ⇒ `wrangler d1 migrations apply` 不会重跑，必须手工重建。

`scripts/players-import/README.md` 的「写入成本」段此前仍写首灌当时的「4 个索引 / 每人 5 次写入 / 91.5k」，现已拆为「（首灌当时）」+ 新增「重跑成本已随索引增多放大（2026-09-24 实测订正）」小节：16 索引清单（14 条显式 + `uid` / `fc_id` 两个 UNIQUE 自动索引）、四种覆盖方式的成本表（新插入 17 行/人 = 311,117；本文件的 upsert 重跑 11 行/人 = **201,311**；`DELETE FROM players` 全清 17 行/人 = 311,117；全清 + 重灌 34 行/人 = 622,234），以及两条纪律 —— 不要用 `DELETE FROM players;` 做覆盖（中断即半空表、无回滚点，该语句仅作首灌回滚记录保留；upsert 幂等可中断续跑）、不要用 `DROP TABLE` 重建。⇒ 全量重导已不可能一天做完（201k 起，须按 19 个分片跨 3–4 个 UTC 日；首灌当时 91.5k 一天塞得下，该数字已不可复现）。（2026-09-25 起该口径已随 `0035`/`0036` 再订正为 **21 索引**：新插入 22 行/人 = 402,622、upsert 重跑 **14 行/人 = 256,214**、全清 22 行/人、全清+重灌 44 行/人 = 805,244，须跨 5 个 UTC 日；详见本文件同批「排序索引 batch 4/5」条目。）

## [维护] · 遗留项第 5 节最小步 —— 下一批排序索引写成迁移 0034（2026-09-24，迁移 `0034` 已 apply 到生产并部署上线（Version `a573ade7-…`）：无运行时行为变化）

遗留项普查第 5 节（D1 读量治理后续批次）的结论是「主体已在v3.2.0 治完，剩下的是**写配额换读量**的排期清单，属产品判断而非配额判断」（2026-09-22 搁置它的当日理由——写配额被 `0029`+`0030` 吃掉 73.2%——现已不成立：2026-09-24 实测当日写 10 行 / 读 2,969 行）。本轮只走最小步：先做候选表达式的真引擎体检，再写下一批索引与同源测试锁，代码部分**不动生产**（迁移的 apply 于同日单独授权执行，见文末）。

**新增**
- `scripts/check-sort-index-feasibility.mjs`：候选排序表达式体检器（仿 `scripts/check-name-fold-depth.mjs`，`wrangler d1 execute --local --persist-to .wrangler/rehearsal` 逐条 `CREATE INDEX` 后立刻 `DROP`，零配额）。本轮 15 个候选（13 个可建索引键 + 初始视图 `ca` + `attr` 抽样）**15/15 通过** ⇒ D1 表达式树深度上限 100 对这批形态不构成限制（`ps` 的 15 项链可通过），且 **`json_extract` 可以出现在索引表达式里**（索引侧表达式禁止 `.` 限定符，故写非限定列名）。
- `src/db/migrations/0034_players_sort_indexes_batch3.sql`（**2026-09-24 已 apply 到生产**）三条排序索引：
  - `idx_players_sort_uid ON players(COALESCE(CAST(SUBSTR(uid, 3) AS INTEGER), 0), id)`
  - `idx_players_sort_ps ON players(((json_extract(game_attrs, '$.PSID1') IS NOT NULL) + … + (… '$.PSID15' …)), id)`（15 项，逐字与 `src/worker/routes/players.ts` 的 `PS_COUNT_EXPR` 同源，由 `PS_SLOT_COUNT` 生成）
  - `idx_players_sort_initial_ca ON players(COALESCE(COALESCE(base_ca, ca), 0), id)` —— 必须是这层**完整嵌套**：`buildSortExprs` 在初始视图的 `caExpr = COALESCE(players.base_ca, players.ca)` 外还套了一层 `COALESCE(…, 0)`，只建内层匹配不上（这正是 `view=initial&sort=ca` 此前静默失配成 37,635 行/次的原因）。
- `tests/players-sort-indexes.test.ts`：`INDEXED_SORTS` 由 8 条扩到 **11 条**（改三元组 `[sort, index, extra?]`，支持 `&view=initial` 这类附加查询串），每条仍是「真实路由 SQL 的 `EXPLAIN QUERY PLAN` 必须命中指定索引」+ cursor / `order=asc` 三形状；新增 2 条同源锁（`ps` 表达式必须由 `PS_SLOT_COUNT` 生成、initial-ca 必须含完整嵌套 `COALESCE`）。`tests/d1.ts` 的 `MIGRATION_FILES` 追加 `0034`。

**验证**
- 定点：`npx vitest run tests/players-sort-indexes.test.ts` **37 例全绿**（原 26 + 新 11）。
- 变异验证（`scratch/mutate-0034.mjs`，已备份还原）：把 initial-ca 索引改成只建内层、`ps` 索引删掉 `PSID15` 一项 ⇒ **8 例变红**（两条形状各 3 条 EXPLAIN + 各 1 条同源锁）⇒ 新锁不是空转。
- `npm run typecheck`（三份 tsconfig）全清；`npx vitest run` **50 文件 / 709 例全绿**（原 698 + 11）。
- 文档同步：`README.md` 迁移 33 → **34**（当时写明 `0034` 已写好未 apply、一次 ≈5.5 万行写须单独占配额日；同日 apply 后已改为「已 apply」并写入实测数字）、测试 698 → **709**；`scripts/d1-read-audit/README.md` §5.3 第 3/4 条与 §5.5 三行订正 —— 顺带查明 §5.5 的 `sort=name` 候选**早已由迁移 `0033`（2026-09-23 apply）完成**，该行此前已过期。

**生产 apply（2026-09-24 已执行，用户授权「0034应用」）**：`0034` 三条索引合计实测 **54,919 行 `rows_written`**（占当日写配额 54.9%，在自留预算 ≤6 万内）；生产侧核对 —— `sqlite_master` 里 `idx_players_sort_%` 共 11 条，三条新索引在 `EXPLAIN QUERY PLAN` 下均为 `SCAN players USING COVERING INDEX`；收益实测（读数落 `scripts/d1-read-audit/measurements-after.json`）：`view=initial&sort=ca` 37,635 → **54**、`sort=uid` → **24**、`sort=ps` → **22** 行/次。worker 已于同日部署上线（Version `a573ade7-b32f-4c85-bbaf-56a07e612281`，2026-09-24T03:37:52Z，Source `Unknown (deployment)`；wrangler 报 `No updated asset files to upload` ⇒ 无运行时代码与产物变化，线上首页资产仍 `index-CpdvAUf3.js` + `index-CgbAjyeh.css`）。清单上还剩 11 个可建索引的键（`base_ca` / `badges` / `growth_gap` / `position` / `growable` / `foot` / `growth_tier` / `future_star` / `china_plan` / `agent_tier` / `fc_id` 一类），按每天最多 3 条继续分批。



## [维护] · 遗留项普查收口（第 0/4/6 节）— 文档订正 + 死代码清理（2026-09-23，**未部署**：无运行时行为变化）

三路深度普查（文档层 / 代码层 / 记忆层）把本仓遗留项按 0–8 节登记；本轮执行其中第 0（过期表述）、4（代码层清理）、6（文档数字漂移）三节。

**文档订正（第 0/6 节）**
- v6.1.0 的「未提交未部署」全部订正为已提交、已推送、已部署：`AGENTS.md`（v6.1.0 bullet 首句、⑩ 部署前置、`npm test` 数字、生产版本链补生效版 `bd467125`）、`ROADMAP.md`（状态行与待办①②）、`CHANGELOG.md`（v6.1.0 节标题与状态段）。
- 数字漂移：`README.md` 迁移 30 → **33**（`0001`…`0033`，含 `0032`/`0033` 于 2026-09-23T09:29Z 同轮 apply）、测试 39 文件 / 539 例 → **50 / 698**、e2e 9 → **11 场景**、生产状态 `627508e5` / 迁移 `0030` → **`bd467125` / `0033`**；密钥补 `TEAM_SYNC_SECRET`、变量补 `TOUR_API_BASE`。
- 「v3.0.0 未部署」残留风险订正：`ROADMAP.md` v3.0.0 台账行与 `scripts/prod-20260920-s9-contracts/README.md` §11.8 首条都改为「2026-09-21 已随 Version `b83ec876` 上线，面板建合同不再落 DDL 默认刻度」。

**代码清理（第 4 节）**
- 删 10 个零引用导出（逐个 `grep -rn "\b名字\b"` 复核，只命中定义行）：`web/src/lib/api.ts` 的 `MeResponse` / `apiPatch` / `ClubDto` / `TransferDetail` / `ReviewDecisionResult`、`web/src/lib/ref.ts` 的 `PlayStyleRow` / `RoleRow`、`src/worker/tourClient.ts` 的 `pushError`（其「出站失败只回报文案不抛」的口径注释移到 `PushResult` 上）、`src/worker/market-settle.ts` 的 `transferTypeFor`、`src/worker/stadium-ops.ts` 的 `FacilityKey`。
- 订正 3 处过期注释：`src/worker/home.ts`（设施扩建/升级已随v2.5.0 落地，见 `src/worker/stadium-ops.ts`）、`src/worker/results.ts`（站内信派发已实现）、`wrangler.jsonc`（cron 逻辑已在 `src/worker/index.ts` 的 `scheduled()` 实现）。`src/db/migrations/0018_home.sql` 的同类过期注释**刻意不动**——该迁移已 apply 到生产，按仓库规矩不得再改。

**验证**：`npm run typecheck`（三份 tsconfig）全清、`npx vitest run` **50 文件 / 698 例全绿**。

## [已上线] · v6.1.0 — 球队与俱乐部双向建档同步（tour + club 两仓）（2026-09-23，本仓 Version `bd467125-2ccb-4516-86b4-f963bdc5fda6` / 赛事仓 Version `02590a8e-f314-4721-a823-147817a5ce17`）

本轮两仓同时改（本仓 `WHL-club-operations-platform` + 赛事仓 `WHL-tournament-management-system`），**两仓均已提交、推送并部署上线**（本仓 4 提交 `be28524` / `ce49e77` / `8379508` / `f250c29`，`origin/main` = `f250c29`；赛事仓 4 提交 `ad80d75` / `588f384` / `1ab678a` / `5f07002`，该仓 `origin/main` = `5f07002`）。部署前两侧都已 `wrangler secret put TEAM_SYNC_SECRET`（同值）；生产实测无签名 `POST /api/internal/team-upsert` 在两个 host 上都回 403 `{"error":"bad_signature","message":"签名校验失败"}` ⇒ 路由在线、密钥在位且 fail-closed 生效（密钥缺失会回 503，故 403 已排除「未配」）。**未验证**：两侧密钥是否同值（无只读 HMAC 端点，唯一验法是一次零写 upsert 探测 = 生产写动作）。

**背景**：球队（`team.id`）与俱乐部（`clubs.id`）本来就是同一个号（游戏内球队编号，两库早前一起 rekey 过），但两边只能各建各的 —— 赛事系统建队不登记俱乐部；本仓建俱乐部又硬性要求「赛事系统里先有这支队」（否则 404「赛事系统里没有这支球队，请先在赛事系统建队」）。谁先建都得手工去另一侧补一次。

**边界调整（v5.0.0 的例外）**：v5.0.0 定下「名册只拉不推」（赛事仓 `worker/lib/clubRoster.ts` 顶部原文），本轮只对**「球队建档」**这一个写动作破例放开对称推送，**名册仍一行都不推**。理由：建档是一次性事件、两侧都可能先发起、且赛事仓读不到本仓库（反向拉不出「本仓有而赛事无」）。赛事仓那段注释已原文保留并补上这次调整的声明。

**新增**
- `src/lib/hmac.ts`：`hmacHex` + `verifyTeamSync`（签名串 `` `POST|${path}|${ts}|${rawBody}` ``、头 `X-Timestamp`/`X-Sign`、HMAC-SHA256 小写 hex、时间窗 ±300s，与认证中心 `machine.ts` 同一口径）。本仓 `src/worker/notify.ts` 原先私有的 `hmacHex` 抽到这里共用。
- `src/worker/tourClient.ts`：`pushTeamToTour`（**永不抛错**，失败回中文口径：未配基址 / 未配密钥 / 对方不可达 / 透传对方 message）。
- `src/worker/routes/internal.ts`：`POST /api/internal/team-upsert`（幂等建档：同 id 已有则 200 `{created:false, nameDiffers}` **不覆写**）。未配密钥 → **503**（写端点 fail-closed，不像 `assertCronKey` 那样「没配就放行」）。
- `src/worker/routes/admin/teamSync.ts`：`GET /api/admin/team-sync` 三段差异（只有赛事有 / 只有本仓有 / 两边名字不同）+ `POST /api/admin/team-sync/apply`（**每次重算 diff 再动手**，防照几分钟前的清单盲写；不匹配当前差异 → 409）。
- 前端 `web/src/pages/admin/ClubsPage.tsx` 新增「球队同步对账」卡片（`web/src/lib/adminQueries.ts` 加 `TEAM_SYNC_KEY` / `fetchTeamSync`）。
- `tests/team-sync.test.ts` 26 例：入站端点（正签建档 + 认证登记 + 审计 actor 留空 / 幂等 nameDiffers / 签名矩阵 错签·缺签·过期·非数字全 403 且不落库 / 换密钥 403 / 未配密钥 503 / 入参校验 400 / 名字被占 409）、公开缓存失效登记、`computeTeamSyncDiff` 纯函数、对账端点、出站 `pushTeamToTour`、**跨仓签名金标准**、**真实风险**各一组。

**变更**
- `src/worker/routes/admin/clubs.ts`：原 `POST /clubs` 的核心抽成导出的 `createClubFromTourTeam()`（名字 ≤40、`leagueTier` 只收 premier/second、id 撞号 409、名字重复 409、审计 `club_create`、`authRegisterTeam` 失败不回滚只置 `authLinked=false`）；`POST /clubs` 改为「赛事系统已有该队 → 原逻辑；没有 → **先推建队，成功再本地建档**；推送失败 → 502 且不建档」。原来的「赛事系统里没有这支球队」404 被自动建队取代。
- `src/worker/env.ts` 加 `TEAM_SYNC_SECRET`；`src/worker/index.ts` 挂 `/api/internal`。
- **`src/lib/cache-policy.ts` 的 `WRITE_SCOPE_PREFIXES` 加 `/api/internal`** —— 否则「建了俱乐部但公开目录最长陈旧 24h」。

**赛事仓侧（tour，权威文档见其 `PRD.md` / `TECH_DESIGN.md` §4.5）**
- 新增 `worker/lib/clubSync.ts`（出站 + 验签）、`worker/lib/teamBulk.ts`（「游戏球队 ID 队名」解析，`NAME_MAX = 40` / `BULK_MAX = 64`）、`worker/routes/internal.ts`（入站端点）。
- `worker/routes/admin/teams.ts`：建队/批量建队改「游戏球队 ID + 队名」并推送（**队名上限 32 → 40** 对齐本仓 `clubs.name`），新增 `POST /:id/sync-club` 重试入口。
- `worker/routes/admin/tournaments.ts`：批量报名同样改「ID + 队名」，**改为按 id 认队**（原先按名字），名字不一致进 `nameMismatch` 报告（登记以库里为准）。
- 前端 `src/pages/AdminTeams.tsx`（游戏球队 ID 输入 + EA 目录软校验：命中显示官方队名、未命中黄字警告但允许建队；同步按钮 + 失败红字）、`src/pages/TournamentManage.tsx`。
- 新增 `shared/fc26Teams.json`（由本仓 `web/assets/ref/team.json` 复制，696 条）+ `shared/fc26Teams.ts`（`fc26TeamName` / `isKnownFc26Team`）。

**验收**
- 本仓 `npm run typecheck` 全清（三个 tsconfig）；`npx vitest run` **50 文件 / 698 例全通过**。
- 赛事仓 `npm run typecheck` 全清；`npx vitest run` **16 文件 204 例通过 + 1 文件 7 例跳过**。
- **跨仓签名金标准**（两仓各一份、逐字同值）：`GOLDEN_SECRET = "increment-37-golden-secret"` / `GOLDEN_TS = 1767225600` / `GOLDEN_RAW = '{"id":700,"name":"Arsenal","operator":1}'` / `GOLDEN_HEX = "1437a305e893ae6c65364c50cc953a178e1edfa38f2f2040ae961966db065d30"`。hex 是 `node:crypto` 独立算出的**死值**（不是用被测代码算的），两侧任一方偷改算法/路径/签名串立刻红；两边还各有「入站接受对面那份金标准签名」的用例证明常量互通。

**已知后果 / 真实风险（已测出并留痕）**
- **推送不可撤销**：从本仓发起时先推、后本地建档；若推送成功而本地名字撞车 409，赛事系统那支队撤不回来，只能靠对账页的「只有赛事有」列出来处理。`tests/team-sync.test.ts` 的「真实风险」describe 钉住了这条可见性。
- 认证中心 `club_id` 已被别的球队占用（`club_taken` 400）**不阻断建档**：`authLinked=false`、俱乐部行照落，管理端可点「重新登记」补。
- 赛事仓 `UNIQUE(org_id, name)`：入站建档前先单查名字占用并 409 点名「队名「X」已被球队 #N 占用」（原 catch 回的是「球队 ID #N 已被占用」，会把本仓操作员带偏）。
- **明确不做**：改名不联动（只在对账页显示 `nameDiffers`）；删队不联动（本仓没有删除端点）；球员名册仍严格只拉；报名、赛果、账目一律不动。

## [已上线] · tour 侧增量 — 赛事仓错误契约收口 + 账号投影对账（tour 单仓，不占本仓版本号）（2026-09-23，Version 9c51052f-a50c-44c8-8078-b318fd7f226b）

本轮**本仓没有任何代码改动**，交付全部落在赛事仓 `WHL-tournament-management-system`（其权威文档是 `PRD.md` / `TECH_DESIGN.md`，后者已随本轮补 §4.2 与 §8）；本节进本仓 CHANGELOG 是因为当时沿用「全项目共享增量号」旧规则（该规则已于 2026-09-25 废止，改用各仓语义化版本 ⇒ 本仓不为这一轮分配版本号，正文一律称它「tour 侧增量」）。赛事仓 2 个提交（`7f4d69a` 代码 + `952f470` 文档）**已 push**（`dee2292..952f470`），连同 v5.0.0 的 4 个提交一并补齐，该仓 `origin/main` = `952f470`。部署：`9c51052f-…`，2026-09-23T13:02:42Z，Source `wrangler`，`Total Upload: 582.96 KiB / gzip: 133.33 KiB`。

**编号**：赛事仓那轮代码注释原写「34」，而 34（apex 域名收口）与 35（显示名与球衣号落库）当日已被本仓占用 ⇒ 当时在共享序列下回填为「36」（改 6 处标签：`worker/index.ts`、`worker/routes/oidc.ts`、`tests/oidc.test.ts`）。

**修复**
- **账号投影（`FOREIGN KEY constraint failed` 致 500 的根因）**：账号真源收口认证中心后赛事库 `user` 表没有写入方，而 14 列外键仍指向 `user(id)`（`tactic.created_by` / `match_event.created_by` / `audit_log.actor_user_id` …）⇒ 新账号「登录一切正常，写存档或报分才 500」。新增 `worker/lib/accountMirror.ts`：`mirrorAccountStmt` 是 `INSERT INTO user (id, name, password_hash, role, locked, created_at) VALUES (?, ?, ?, 'coach', ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, locked = excluded.locked, created_at = excluded.created_at`（**`role` 与 `password_hash` 绝不进 updater**，口令写哨兵值 `"!oidc-no-password"`）；`runAccountMirror` 为整点对账入口，只补行与改名、**不删行**。`worker/routes/oidc.ts` 的 callback 把账号投影与 `INSERT INTO oidc_session` 放进同一批 `c.env.DB.batch([...])`（否则症状是「登录成功但一写就撞外键」）。
- **未捕获异常一律回 JSON**：`worker/index.ts` 新增 `app.onError`，回 `c.json({ error: "internal", message: "服务异常，请稍后重试" }, 500)` 并留日志。Hono 默认输出 `text/plain` 的 `Internal Server Error`，前端 `res.json()` 解析失败、只剩一句「请求失败（500）」，报错无明细（2026-09-23 那次只能反查 D1 才定位到外键）。
- **错误文案收口**：`src/api.ts` 新增 `fallbackMessage(status)`（≥500「服务暂时不可用（N），请稍后重试」/ 404「内容不存在或已被删除」/ 401「登录已过期，请重新登录」/ 403「没有权限执行此操作」/ 其余「请求失败（N）」），并把 `TypeError` 转成「网络异常，请检查网络后重试」（WebKit 报 `Load failed`、Chromium 报 `Failed to fetch`，原样抛会把英文糊上界面）；worker 侧统一 `{ error, message }` 形状（`portal.ts`「该比赛暂无战报（仅完赛场自动成文）」「该轮暂无综述」「轮次参数不合法」、`interact.ts`「比赛 id 不合法」、`admin/announcements.ts` 三个 code + 中文 message），19 个页面与组件消费。

**新增**
- `scripts/oidc-user-mirror/20260923-backfill-user-13-17.sql`（幂等 `ON CONFLICT(id) DO NOTHING`）；**实测未执行** —— 整点对账已自行补齐 user 13–17，回填 SQL 已无操作对象，留着当恢复路径。
- `tests/oidc.test.ts` 3 例：登录回调把账号投影进本库 user 表 / 定时对账补没登录过的账号并同步改名与注册时间且不删行 / 未捕获异常 500 回 JSON 且日志留方法与路径。

**验收**
- 赛事仓 `npm run typecheck` 全清；`npx vitest run` **15 文件 / 147 例通过 + 1 文件 7 例跳过**（`tests/admin.live.test.ts` 属基线；v5.0.0 评审后基线 15/144 ⇒ +3 例）；`npm run build` 成功（`dist/assets/index-CR7ktr7d.js` 444.71 kB / gzip 144.17 kB、`index-C4fgwNax.css` 69.80 kB）；`wrangler d1 migrations list whl --remote` ⇒ `✅ No migrations to apply!`。
- 部署后回读：`/api/health` 200、`/api/public/announcement` 200、`/api/public/weekly` 200（`weekStart 2026-09-21` / `played 7` / `goals 20`）；`/api/public/matches/999999/report` ⇒ 404 `{"error":"not_found","message":"该比赛暂无战报（仅完赛场自动成文）"}`、`/api/public/tournaments/999/round/999/1` ⇒ 404 `{"error":"not_found","message":"该轮暂无综述"}` ⇒ 新错误契约在线；线上 `index-CR7ktr7d.js` 内含三条新前端文案。
- 名册同步已实际开跑：赛事库 `whl.player` 实测 `{"total":570,"with_number":570,"distinct_num":71}`，`id 20801 = Cristiano Ronaldo / team 45 / #7`（旧 id 241/243 已因v5.0.0 rekey 不存在）⇒ 赛事库是从本仓拉回显示名与 s901 号码的下游镜像。

**已知后果**
- ~~赛事仓 6 个提交未 push~~ —— **已订正**：2026-09-23 已 push（`dee2292..952f470`）。口径更新：用户同日明确「部署推送都得一块啊」，此后「部署」即同时授权该仓 push。
- 赛事仓当日 **08:37:07Z（`71de6d01-…`）与 08:47:45Z（`49563d64-…`）已部署过两次** ⇒ v5.0.0 + 本轮代码在本地提交之前就已上线（这也是整点 cron 覆盖赛事库号码成立的前提）。
- 门户路由挂在 `/api/public`（`worker/index.ts:32` 的 `app.route("/api/public", portalRoutes)`），**不是 `/api/portal`**；`wrangler deployments list` 列的 id 是 deployment id 而非 version id（版本要读 JSON 的 `versions[].version_id`）。

## [已上线] · v6.0.0 — 显示名与球衣号落库：号码真源迁到 FC26 存档表（s901）+ D1 写通道整改（2026-09-23，Version 835031b5-1ddb-428e-9805-01ce3cc9a3c5）

本轮**没有任何 `src/` 或 `web/src/` 代码改动**（表结构与读端点早在v4.0.0/v5.0.1 上线），改动集中在 `scripts/player-names/` 两个脚本与文档；生产数据落库已执行并生效（不经 HTTP 写路径，早于部署即对用户可见）。`scripts/` 与文档已推送（`3f33aab..d4dcf34`）并随 Version `835031b5-…`（2026-09-23T12:12:42Z）部署上线，线上下发的 Worker 与资产同上一版（wrangler 报 `No updated asset files to upload`）。

**修复**
- **生产 `players` 五列落库**：`scripts/player-names/load.mjs --remote --yes-prod --numbers --purge` 执行 46 条语句（`display_name.sql` 44 条 / `number.sql` 2 条）全部成功、无重试。落库前 `display_name`/`first_name`/`number` 计数全 0，落库后 `total 18301 / display_name 17470 / first_name 17329 / last_name 17099 / common_name 2549 / number 570`。
- **缓存失效（`load.mjs` 新增 `--purge`）**：读 `cache:epoch:public` 现值 +1 写回（实测 **1 → 2**）。这一步不是可选项 —— 脚本直写 D1 不走 HTTP，`src/worker/index.ts:25-42` 的 purge 中间件（判据「非 GET/HEAD + 响应 2xx + 路径命中 `WRITE_SCOPE_PREFIXES`」）不触发，而分级 TTL 是 players 1h / roster 24h / clubs 24h，不 bump 代际键则公开读最长 24h 才看到新值；代际键带版本号（`src/lib/guard.ts:105`），bump 一次 L1 + L2 同时作废。
- **号码真源从赛事库改到 FC26 存档表（s901）**：`derive.mjs` 不再读 `whl.player`。原因见「已知后果」——赛事仓的名册同步按「姓名、号码一律以 club 为准」写库，`/api/squads` 于 2026-09-23T09:29:30Z 首次上线后，下一个整点 cron 用我方当时的**空号码**覆盖了赛事库 `player` 的 570 个号码（`name` 同时被换成我方缩写名，570/570 逐字相同即证据；D1 时间点回读不可用，只能靠外部副本恢复）。
- **`derive.mjs --refresh` 在本机崩溃**：`Error: spawnSync npx.cmd EINVAL`（errno -4071，Node v24.12.0），与v4.0.0 评审在 `load.mjs` 修掉的是同一类 bug（当时只修了 `load.mjs`）⇒ 改用 `execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', …])` 跑 `node_modules/wrangler/bin/wrangler.js`。

**新增**
- 号码派生源 `E:/BaiduNetdiskDownload/FC Editor by decoruiz Alpha v21.5_2/player_tables/s901/splitted`：20 个 xlsx（一队一份，文件名 `<FC26 club_id> - <队名>.xlsx`，表体只有两列无表头：球衣号 + 全名），实测 570 人 / 20 队 / 号码空行 0 / 队内重号 0，与赛事仓 Sep16 独立副本 `players-dump.json` 姓名号码 **570/570 一致**。`readS901()` 用 `xlsx@^0.18.5` 读表；文件名不合规或号码为空一律 `exit 2`。
- 认人四级阶梯（每级只认唯一命中，`claimed` Set 防重复占用）：逐字相同 → 归一化相同 → 同队同姓唯一 → 队内唯一余量。实测 **565 / 3 / 2 / 0**，逐队人数对账 `clubCountMismatch = 0`。
- `load.mjs` 的每条语句失败自动重试 3 次（`sleep(2000)`）+ `cleanForCommand()` 注释行清洗 + `MAX_SQL_CHARS = 30_000` 上限保护。

**变更**
- **D1 写通道由 `--file` 改为 `--command`**：`--file` 走 D1 异步 import 端点，对**合法** SQL 间歇性报假错（已见 `{"D1_RESET_DO":true}`、《SQL code did not contain a statement. [code: 7500]》、`syntax error` 且 offset 比文件本身还长、`X [ERROR] {` 截断），同一条语句隔 30 秒重跑就 `success:true / rows_written:400`；`WRANGLER_LOG_SANITIZE=false` 抓到的请求体完整无误，换随机文件名与 md5 去重无关。`--command` 走同步 /query 端点。
- `derive.mjs` 的 `BATCH` 由 1000 降到 **400**（每批约 22KB，要塞进 Windows 命令行）。
- `derive.mjs` 的 `REMOTE` 删掉 `tour-players`（db `whl`）与 `team-map`（db `whl-auth`），只剩 `players`（db `whl-club`）；审计 CSV 表头 `tour_name,tour_number` → `s901_name,s901_number`。
- `scripts/player-names/README.md` 整篇重写：数据源表加 s901（标注**球衣号真源**）、记「赛事系统 `whl.player` 不再是号码来源」、球衣号四级阶梯、生产落库计数与回读结果、`--purge` 的存在理由、踩坑清单由两条扩到四条。

**验收**
- 预检 `--dry-run --numbers --purge` ⇒ `44 条 / 最大 22645 B` + `2 条 / 最大 7062 B` = **46 条 / 977642 B**；只给 `--remote` ⇒ `拒绝执行：写生产必须同时给 --remote --yes-prod。`；`derive.mjs` 退出码 0。
- 落库 ⇒ `完成 46/46` + `公开缓存版本号 1 → 2`，exit 0；KV 复核 = `2`。
- 点查 fc 20801 ⇒ `Cristiano Ronaldo` / `C. Ronaldo` / `dos Santos Aveiro` / `Cristiano Ronaldo` / `7`；五例同人异名落库正确（200104 `Heung Min Son`#7、226456 `Pablo Fornals`#12、264432 `Abdessamad Ezzalzouli`#15、264846 `Mosquera`#4、276048 `Matias Fernandez-Pardo`#27）。
- 独立复算（按行解析生成 SQL 的 VALUES、处理 `''` 转义）：17,470 数据行、fn 17,329 / ln 17,099 / cn 2,548 / dn 17,470 非 NULL、重复 fc 0；号码侧 570/570 s901 行在 `number.sql` 中都有「同 club_id 且持有该号码」的人，异常 0。
- 公开回读：`GET /api/squads` ⇒ 200 / 30,983 B，20 队 570 人、`number !== null` **570**；`GET /api/players?limit=2` ⇒ 200，含 `name:'Erling Haaland'` + `officialName:'E. Haaland'`（列表小字有真值）。
- 回归：`npm run typecheck` 三份全清；`npx vitest run` **49 文件 / 667 例全绿**，与v5.0.1 基线逐项一致（本轮无 `src`/`web` 改动）。

**已知后果**
- **赛事库自此只是下游镜像**：赛事仓 cron（**已于tour 侧增量 开跑**，实测赛事库 `whl.player` 570/570 已具号码）会把 `/api/squads` 的显示名与号码写回 `whl.player`（方向正确，但本仓是唯一真源，赛事库任何本地改动都会被下一次整点覆写）。
- 831 人回落官方缩写名（FC26 后期补丁新增 `nameid > 41,189`，本机字典没有），本轮未动。
- 两处口径差无影响：`out/display-names.csv` 的 first_name/last_name 非空数（17,897 / 17,198）比落库多（这两列只有 CSV 审计快照在写，全仓无代码读它们，`grep` 只命中 `src/core/player-name.ts:5` 注释）；`common_name` 落库 2,549 比 SQL 多 1 行（那行库里本来就有值，`COALESCE` 按设计不覆盖）。
- `data/tour-players.json` 缓存已被 `--refresh` 覆盖成空号码版本，不再能当交叉校验源。

## [已上线] · v5.0.1 — apex 域名收口（排名代理 530 根因）+ 边缘 504 归因（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

3 个提交（`9506d00` / `ea6d717` / `5ae73e8`）已推送（`2ad239b..5ae73e8`）并部署，**同轮把v4.0.0/v5.0.0 一起带上线**；**生产迁移 0032/0033 同轮 apply**（用户裁决「先 apply 0032+0033 再整条部署」）。

**修复**
- `whleague.win`（主域 apex）不部署任何服务、DNS 也无 A 记录（`nslookup -type=A` 对 8.8.8.8 / 223.5.5.5 / 1.1.1.1 均无答案，`curl` 返回 000），赛事系统正确入口是 `tour.whleague.win`。三处生效引用改 tour 子域：`wrangler.jsonc` 的 `TOUR_API_BASE`、`web/src/lib/api.ts:70` 的 `TOUR_SITE_URL`（6 处外链：`TopBar.tsx:92` / `RequireUser.tsx:27` / `admin/AdminLayout.tsx:45` / `Home.tsx:24`、`:42`、`:81`）、`src/worker/routes/auth.ts:35` 的 `TOUR_HOME`（用在 `:52`/`:83`/`:274`，生产 `AUTH_MODE=oidc` 暂不可达）。
- **生产 5xx 根因**：`TOUR_API_BASE` 配 apex 时，`src/worker/routes/clubs.ts:574-575` 每次都请求 `https://whleague.win/api/public/tournaments/<id>/standings` 并必然 **530**（CF 分析 24h 内 `/2/standings` 17 次、`/1/standings` 15 次）。因 `clubs.ts:604` 只在变量**缺失**时优雅降级（返回「排名暂不可用」），配了死地址反而每次真发请求、每次都失败 ⇒ 球队详情页排名区块永久不可用而其余区块正常，长期不显形。
- 同步 `tests/oidc.test.ts:231`/`:240` 断言与 `src/worker/env.ts:27-29` 注释。

**新增**
- `tests/domains.test.ts`（6 例）域名回归锁：四例锁三个常量（非 apex 且是 `whleague.win` 子域）、一例全仓扫描（`src` + `web/src` + `tests` + `wrangler.jsonc` + `web/index.html`，零排除项）、一例锁 `src/lib/oidc.ts` 不出现真正的 `Domain=` 赋值且 `OIDC_*COOKIE` 都以 `__Host-` 开头。判据 `EFFECTIVE_APEX = /https:\/\/whleague\.win(?![a-z0-9.-])/` 不误伤子域与注释里的裸 apex；本文件自己用 `APEX_URL` 拼接、无连续 apex 字面量，故全仓扫描无需排除自身。

**不改（含理由）**
- `src/lib/oidc.ts:6` 注释里的 `Domain=whleague.win`：cookie 域属性、跨子域共享会话的前提，apex 在此正确（两个 cookie 都是 `__Host-` 前缀，本身不许设 Domain）。
- 赛事仓 `WHL-tournament-management-system/worker/routes/oidc.ts:36` 注释仍写「线上 whleague.win」（实际 tour 子域）：超本仓范围，只报不改。

**边缘 504 归因（结论：不改代码）**：CF 分析 24h 的 `cache.whl-club.internal` 79 次与 `club.whleague.win` 30 次**都不是用户请求**，而是边缘 Cache API 自身的操作记录 —— 前者 host 由 `src/lib/guard.ts:158` 的 `L2_ORIGIN` 合成（无 route、无 DNS，路径即 `l2Key` 输出格式），后者只是键改用真实 URL（`src/worker/routes/media.ts:43`/`:56` 用 `c.req.url`）。这解释了 504 名单按 host 精确二分（club 侧清一色 `/api/media/*`，零 `/api/clubs*` 与 `/api/players*`）。已排除媒体文件缺失（两个 504 样本 URL 在两个 host 上都 200）。**判定：不需要动 `src/lib/cache-policy.ts` 或 `cachedJson`**（standing 300s 是全站最短 TTL、也是它在 `.internal` 占多数的原因，5 分钟是排名产品语义）。登记两处潜伏风险不改：冷回填 `await l2Put` 在响应关键路径（`guard.ts:248`，media 侧已挪进 `waitUntil`）、`l2Match`/`l2Put`/`caches.default.match`/R2 `get`/`arrayBuffer` 全无超时。

**验收**：`npm run typecheck` 三份全清；`npx vitest run` **49 文件 / 667 例全绿**（v5.0.0 基线 48/661 ⇒ +1 文件 / +6 例）；`npm run build` 成功（`index-C6eShBli.js` + `index-CgbAjyeh.css`）；dist 扫描无 apex。变异验证：三个常量各自改回 apex ⇒ 每次**恰好 2 例红**。上线核对：`tour.whleague.win/api/public/tournaments/{1,2}/standings` 均 **200**（3403B / 7131B）、`whleague.win` 仍 000、`/api/health` / `/api/clubs` / `/api/squads` / `/api/players?view=initial` / `/api/players/roster` 全 200、`/api/clubs/1` 与 `/api/clubs/1/standing` 匿名 401、线上资产与本地 dist 逐字一致、线上 JS 内域名只剩 `guess.whleague.win` 与 `tour.whleague.win`。**未验证**：`/api/clubs/:id/standing` 端到端（需登录会话，匿名 401）；CF 分析 530 归零需按 24h 窗口在面板观察。

**已知后果**：~~生产 `players.display_name` 仍全 NULL（落库脚本未跑）⇒ 显示名与球衣号对用户仍不可见（回落缩写名）~~ —— **已在v6.0.0 订正**：生产落库已执行（17,470 显示名 / 570 号码），`/api/squads` 与 `/api/players` 回读已出真值；~~赛事仓未部署 ⇒ `/api/squads` 已上线但赛事侧名册同步尚未开跑~~ —— **已在tour 侧增量 订正**（赛事仓 2026-09-23 部署，整点名册同步已开跑）。

## [已上线] · v5.0.0 — 名册真源归位：全平台一线队名册端点 + 赛事平台拉取同步 + 球员写入口下线（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

本仓 2 个提交（`aed2f67` + 评审 `d84371d`）+ 赛事仓 2 个提交（`ffcbc40` + 评审 `728f523`）。**本仓部分已于 2026-09-23 随v5.0.1 一并推送并部署**（`/api/squads` 生产实测 200 / 29670B）；**赛事仓部分已于 2026-09-23 部署（tour 侧增量；当日 08:37Z / 08:47Z 两次 + 13:02Z 一次）**，名册同步 cron 已开跑（赛事库 `whl.player` 570/570 具号码）。v4.0.0 把球衣号编辑入口搬回本平台后，赛事系统的 `player` 表成了第二份真源（两个写者互相覆盖），本增量把名册真源收到本平台并关掉赛事侧的写路径。

**新增**
- 端点 `GET /api/squads`（`src/worker/routes/squads.ts`）：一次 JOIN 出 20 队 570 人的一线队名册，返回 `{ squads: [{ clubId, clubName, players: [{ fcId, name, number }] }] }`。公开只读，`assertPublicRate` + `cachedJson`（roster scope，24h）；姓名走 `sqlDisplayName()`，`ORDER BY c.name, p.fc_id` 后 JS 线性归并，不做 N+1。
- 赛事仓 `worker/lib/clubRoster.ts`：`fetchClubSquads` / `syncRosters`（三方对账，以 fcId 当 `player.id`）/ `runRosterSync`（cron 入口，失败只记日志不抛）。
- 赛事仓端点 `POST /api/admin/sync-rosters`（`?dryRun=1` 只算不写，非 dryRun 写审计）；`wrangler.jsonc` 加 `triggers.crons = ["0 * * * *"]` 与 `vars.CLUB_API_BASE`（撤掉该行 = 同步整体跳过，即回滚开关）。

**变更**
- **赛事系统球员表转为只读镜像**：`POST /:id/players`、`POST /:id/players/bulk`、`PATCH /:id/players/:pid`、`DELETE /:id/players/:pid` 四个端点删除，`TeamDetail.tsx` 的录入 / 批量导入 / 改名 / 删除 UI 换成只读名单表；队级端点（建队 / 批量建队 / 改名 / 删队 / 队徽）保留。
- 赛事仓同步的三条防御：空快照整体跳过；形状坏抛错不写库；只对快照里出现过的队做删除（一次拉取失败不会清空别队名单）。外键拒绝的删除进 `kept` 报告保留（有比赛事件 / 伤停引用的球员不能删）。

**评审修复（`d84371d` / `728f523`）**
- 本仓 `tests/squads.test.ts` 种子行序改成两队 id 交替 + status 交替：原种子恰好是「插入序 = 期望输出序」，把 `ORDER BY c.name, p.fc_id` 删掉测试照样绿，而归并是「相邻行同 club_id 才并组」、正确性全押在那条 ORDER BY 上。改后删 ORDER BY 或删尾列都能定向变红。
- 赛事仓 `fetchClubSquads` 补 `AbortSignal.timeout(10_000)`（原来没有 signal，对方挂住时 cron 的 catch 永不执行、一行日志都没有）；快照里某队 `players: []` 直接抛错（原来只挡 `squads.length === 0`，挡不住「快照非空但某队名单空」，该队会被当 stale 整队删光）。各补一条测试并变异验证定向变红。

**验收**：本仓 typecheck 三份全清、vitest **48 文件 / 661 例全绿**（v4.0.0 基线 47/659）、build 产物 `index-Bco7kOHW.js` 与v4.0.0 逐字同 hash（只加后端路由）、e2e **11/11**；赛事仓 typecheck 全清、vitest **15 文件 / 144 例通过 + 1 文件跳过**（基线 14/121，评审后 142→144）、build 成功。读量实测走 `idx_players_status` 点查（无 `SCAN p`，约 570 行）。变异验证四处定向变红（空快照守卫、未知队过滤、ORDER BY 整条 / 尾列、拉取超时信号）。

**已知后果（评审查出，本轮不改）**：没有一线队球员的俱乐部整个从 `squads` 数组消失（赛事仓只对快照里出现过的队做删除 ⇒ 被清空的队会留陈旧镜像行，失败方向是保留而非丢数据）；赛事仓自动删除球员后 `tactic.roster_json` / `tactic_submission.assign_json` 会留悬挂 id（JSON 无外键，教练下次保存战术会撞 400，手工删除时代同样存在）；伤停的 CASCADE 实际不可达（伤停必挂 `match_event`，而 `match_event.player_id` 是 NO ACTION ⇒ 删除会失败行进 `kept`）。

## [已上线] · v4.0.0 — 球员名口径改造：FC26 派生显示名 + 球衣号归属转移 + 档案页按 fc_id 寻址（2026-09-23，Version 7a00c107-214b-4ce0-8769-e9bcae7c4a55）

用户 m01803「开工」，任务 = 球员名口径改造（显示名取自 FC26 存档）+ 球衣号归属从赛事平台转回本平台 + 球员档案页 URL 改 fc_id + 两系统阵容同步 + D1 读额度优化。8 个提交（`c07c18a` / `54a98ef` / `341c7cd` / `e2d81ed` / `097cd34` / `6135bbc` / `770875b` / `0e6a524`）。**代码已于 2026-09-23 随v5.0.1 一并推送并部署，生产迁移 0032/0033 同轮 apply**（apply 后实测：新增列 5、`idx_players_sort_name` 存在、`display_name` 非空 0 / 总行 18301）；**生产数据落库（`scripts/player-names/load.mjs --remote --yes-prod`）仍未执行** ⇒ 显示名与球衣号功能对用户暂不可见（`COALESCE(display_name, name)` 回落缩写名）。跨仓部分（赛事平台转只读 + 阵容同步）另立v5.0.0。

**新增**
- 迁移 `0032_players_display_name_number.sql`：`players` 加 `first_name` / `last_name` / `common_name` / `display_name` / `number` 五列（全 TEXT）。`players.name` 语义不变（仍是 FC26db 官方缩写名，导入对齐键仍是 fc_id）。
- 迁移 `0033_players_name_sort_index.sql`：`idx_players_sort_name` 姓名排序表达式索引（排序键换成折叠的显示名后同源重建）。
- `scripts/player-names/`：`derive.mjs`（从 FC26 存档 `base_players.csv` + `playernames.txt` + `cards.csv` 派生显示名与球衣号，产出落库 SQL + 审计 CSV）、`load.mjs`（逐条语句写 D1，`--dry-run` / `--local` / `--remote --yes-prod`）、`README.md`。
- 端点 `POST /api/club/players/:id/number`：教练给本队球员定号 / 改号 / 清号（整数 1–99、同俱乐部不重复、写审计）。球衣号数据源由赛事平台 `player.number` 转来（570/570 按 fc_id 归属、归属不一致 0）。
- 前端 `web/src/lib/player-link.ts` 的 `playerPath()`；`src/core/player-name.ts` 的 `sqlDisplayName()` / `rowDisplayName()`；`src/worker/player-ref.ts` 的 `firstPlayerByRef()`。

**变更**
- **球员名显示口径**：所有面向前端的球员名字段改为 FC26 派生的显示名（`COALESCE(display_name, name)`）。派生规则 = `commonname 原样 || 名+姓 || cards.csv 完整人名（矛盾则弃用） || 空回落 players.name`。18,301 人派生成功 17,470（commonname 2,548 / 名+姓 14,527 / cards 兜底 395），**570 名俱乐部球员全部有显示名**。列表行同时出 `officialName`（官方缩写名），前端在两者不同时出小字。
- **姓名搜索改双列 OR**（显示名 + `players.name`，同一 pattern 推两次）：只看显示名则按姓搜不到几百个单词显示名的人（`Ederson`/`Isaac`），只看 `name` 则 `Erling Haaland` 搜不到。
- **球员档案页 URL 改 fc_id**：`GET /players/:id` 与 `/transfers`、`/growth` 先按 `fc_id = ?` 点查、未命中回落内部 `id`（fc_id 空间 19541–279948 与内部 id 1–18301 零重叠，两次都是唯一索引点查）；前端链接统一走 `playerPath()`，旧 id URL 自动 replace 成规范地址。写端点仍只收内部 id。
- **阵容表加只读号码列**；合同页签恒有「球衣号」行（仅本队教练可改）；谈判成约后弹「给新援定号」（可跳过）。
- **比赛结果归属改按 fc_id 认人**：原先靠 `club_id + name` 等值匹配，而赛事平台存完整人名、本库存官方缩写名 ⇒ 两侧写法不同的人会漏；现在先 `WHERE fc_id = ?`（不按 club_id 过滤，转会后旧比赛仍算他的成长），姓名只作回落。

**修复**
- 换队与解约清空球衣号（球衣号属于俱乐部，留着旧号会让「同队不重复」在两个队之间打架）；合同导入的认领 UPDATE 同样清。
- **落库脚本三处跑不通**（评审发现，均实测确认）：`derive.mjs` 产出 `BEGIN;`/`COMMIT;` 而 D1 拒收 SQL 事务控制语句 ⇒ 一条都落不了库（已去掉事务控制，并说明每条语句按 fc_id 独立更新、可整体重跑）；`number.sql` 的 CTE 列数不匹配（声明 6 列只给 2 值）；`load.mjs` 用 `spawnSync('npx.cmd')` 在 Node 24 / Windows 上直接 `EINVAL`（改用 `process.execPath` 跑 `node_modules/wrangler/bin/wrangler.js`）。另修 `load.mjs` 语句计数器（原先传对象、永远 0）并加事务控制语句守卫。

**验收**：`npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **47 文件 / 659 例全绿**（v3.4.0 基线 46/642）；`npm run build` 成功（`index-Bco7kOHW.js` 477.77 kB / gzip 150.38 kB）；`npm run test:e2e` **11/11 通过**。变异验证四处定向变红（索引表达式错一字符退化 `TEMP B-TREE`、`fc_id` 归属加 `AND 0`、两处 `number = NULL` 删除、链接回落顺序反转）。落库链路本地端到端跑通且幂等（19 条语句，fc 20801 落成 `Cristiano Ronaldo` / `7`）。

## [已上线] · v3.4.0 — 球队页：公开列表 + 登录详情 + 自家队中心合并 + 只读媒体路由（2026-09-22）

用户 m12793 下达「新增球队页（列表 + 详情）」，并特别要求注意性能、省 D1 额度。17 个提交（`70dc811` / `545ad90` / `e0411de` / `5dbfe41` / `a84c748` / `779ee6b` / `5b90031` / `32068be` / `00092b4` / `57e68a6` / `829063f` / `aa0aea2` / `50e69f5` / `6464d0b` / `5f7c3d6` / `d759b86` / `2ad239b`），**已推送（`466df81..d759b86` 16 个 + `d759b86..2ad239b` 1 个）并部署上线**（生产 Version `7a178d81-dccc-4696-a7d7-7d8c61eaa683` → `64020454-405c-479a-9a62-8197444f4f52` / `adb3a5ae-dbc5-4648-bf62-383e1108923d`）。**本增量零迁移**（计划中的 `0032` 部分索引在步骤 1 实测后被裁掉），故推送无生产 DDL 耦合；生产迁移仍到 0031。

**新增**
- 端点 `GET /api/clubs`（公开）：一次算完 20 队，固定 4 条 whl-club 语句 + AUTH_DB/TOUR_DB 各 1~2 条，**无逐队查询**；clubs scope 缓存 24h + `assertPublicRate`。响应 `{ clubs: [{ id, name, isCpu, tier, logoKey, squad:{senior,trainee}, avgCa, totalValue, totalWage }] }`。
- 端点 `GET /api/clubs/:id`（需登录）+ `GET /api/clubs/:id/standing`（排名代理）：队头 / 阵容结构 / 合同结构 / 转会往来 / 近期战绩；阵容一条语句取全队后在 JS 里算三个维度分布，避免三条 GROUP BY。
- 端点 `GET /api/media/*`（公开）：镜像比赛系统的媒体路由，**只读不写、不碰任何 D1**，是球队页里唯一的零 D1 读面。key 白名单 `/^(team|tournament)\/\d+\//`、边缘缓存命中即返、`immutable` + ETag。
- 前端页面 `web/src/pages/Clubs.tsx`（公开，按顶级/次级/未定级三段卡片）、`web/src/pages/ClubDetail.tsx`（阵容组 / 运营组 / 战绩组，三组结构分析全用 **CSS 自绘图表**，不引图表库）、组件 `web/src/components/TeamLogo.tsx`（有 logoKey 出 `<img>`，否则按队名哈希出首字色块）。
- 入口四处：顶栏「球队」页签、首页 nav-card、球员库归属球队列、球员档案页眉队名；市场页卖方名与出价方名也链到 `/clubs/:id`。

**变更**
- `/club` 从「我的球队中心」页改为**重定向壳**：在途给加载态、未绑定去 `/bind`、已绑定去 `/clubs/<我的队>`。原 897 行内容整体搬进 `web/src/pages/club/CoachPanel.tsx`，只在详情页里、且登录者正是本队教练时渲染。搬迁中故意去掉的只有三处：页面外壳（container + h1）、`!overview?.club` 分支（改 `return null`）、`club-head` 里的队名与分级徽章（详情页页头已给）。
- 球队页 URL 的 id 一律是**平台库 `clubs.id`**（裁决 Q17，已写进 `AGENTS.md`）。
- **详情页结构分析按用户裁决整改**（步骤 11a，用户 m14999 批准；配色只用站点既有调色板变量，不新造颜色）：位置分布改**门将/后卫/中场/前锋四档纯文字**（原 `GK CB CM ST` 是错的，且按裁决不用图示），档内给细位明细；年龄结构改**等宽 3 岁箱 + 竖直直方图**（`≤18 / 19–21 / 22–24 / 25–27 / 28–30 / ≥31`，代价已知：当季 `age_cap` 不再是档界）；CA 结构改 **`90+ / 85–89 / 80–84 / 70–79 / <70` 横向占比条**（分母是全队人数而非各档之和，带 0–100% 刻度轴与行尾人数）；三组指标区由等权 10 格网格改为「**三格主指标 + 一行语义明细**」（能力 / 资产 / 荣誉）。效力年限保持原普通升序横向柱状图。
- **详情页结构分析的样式整改**（步骤 11b，用户 m15308/m15319；用户明确「不是换展示项目，是样式上太割裂」⇒ 只改样式、不增删数据项）：主指标与明细行收进同一块 `.club-summary`（淡奶油底 + 一道左侧焦橙竖线，**去掉逐格竖线与明细行顶部分割线**——那正是「小字与上方割裂」的来源）；年龄直方图去掉 `max-width: 460px` 并把轨道高由 72px 提到 **128px**（原 460×72 是 6.4:1 扁条，现约 370×128 = 2.9:1）；CA 由「逐档横条」改为**一根 100% 堆叠条 + 0–100% 刻度轴 + 逐档图例**（段色是同一 `--terracotta` 的深浅阶梯，**颜色仍只来自 CSS**，只渲染非零档）；阵容组三张图进 `.club-figures` 宽屏三列铺满卡片、运营组用 `.club-split`（左 summary / 右效力年限图，900px 折一列），消掉右侧大片空白。顺带修两处实测缺陷：`.band-label` 宽 4.5em → 6.5em + `nowrap`（「3 赛季及以上」原会折两行）、0 人档不再渲染 `.band-bar`（`min-width: 2px` 会把 0 读成「有一点」，与直方图 0 人不出柱同口径）。

**修复**
- **CSS 类名冲突污染球员档案页**（评审发现）：本增量新追加的 `.pos-chip` 与 `web/src/pages/Player.tsx:568` 在用的 `.pos-chip-main` 同特异性且位置更晚，覆盖其 `background:var(--ink)` 而 `color:var(--paper)` 仍生效，**球员页第一个位置徽章变浅底浅字不可读**。修法是新增类一律带 `club-` 前缀。
- **`/club` 重定向把「请求失败」当成「未绑定」**（评审发现）：`useMyClub` 在 `isError` 时 `club: null`，而全局 `retry: false` ⇒ 一次失败即终态，会把绑着队的教练送去写着「一账号只能绑一支队」的 `/bind`。修法是 `MyClubState` 新增 `failed`，壳在该状态下留在原地报错。
- 订正两处**错误注释**：`src/worker/routes/clubs.ts` 与 `src/worker/home.ts` 里原先写「`clubFormPts` 绑 club id 才恒不命中」——生产实测证伪（见下）。
- **「总身价」全站显示 `0.00 m`**（部署后最小化回读抓到）：`GET /api/clubs` 20 队 `totalValue` 全 0。根因是 `players.market_value` 生产 18,301 行**全 NULL**（该列属运营列，`src/core/import.ts:3` 明写导入「绝不触碰运营列（status/contracts/badges/growth/market_value/agent_tier）」，只有 admin PATCH 会写），而 `CLUB_SQUAD_AGG_SQL` 写的是 `SUM(COALESCE(p.market_value, 0))`，把「没人录过」压成 0 这个具体的假话。修法：聚合改 `SUM(p.market_value)`（全 NULL 时 SUM 出 NULL）、`totalValue` 类型改 `number | null`、前端 `money(null)` 回 `—`（与球员库 `web/src/pages/PlayersLibrary.tsx:58` 同口径）；**`totalWage` 口径不变**（CPU 队无合同 ⇒ 0 是真话）。提交 `2ad239b`，重新部署后生产复验 20 队全部 `null`。

**结论（步骤 9，只读核对，不改代码行为）**
- `result_confirmations.home_team_id / away_team_id` 存的是**比赛系统队 id**（迁移 0017），而 `clubFormPts` 绑的是 club id，语义上确实是两套 id。
- 但生产实测（2026-09-22）AUTH_DB `team` 表 20 行**逐队 `club_id` = `tour_team_id`**，`result_confirmations` 69 行的队 id 全落在这 20 个值内且 20 队各有 6–7 条已确认赛果 ⇒ 函数**算得出真值**，此前「命中恒 0 ⇒ 战绩系数恒 1.0」的结论**是错的**。
- 定性为**潜伏缺陷，非现行故障**：米兰的 `tour_team_id` 曾长期是 legacy 47 而 `club_id` 是 131681，直到 2026-09-19 rekey 才统一，那段时间本函数对米兰恒返中性 4。将来若新增 club 的 id 不等于其 tour 队 id，本函数会静默退化成「永远中性」。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **46 文件 / 642 例全绿**（v3.3.0 基线 40/573）；`npm run build` 成功（`web/dist/assets/index-C7pOcE6p.js` 474.57 kB / gzip 149.44 kB、`index-BT5YAIcz.css` 34.57 kB / gzip 7.58 kB）；`npm run test:e2e` **11/11 通过**（三视口；新增球队页两场景，截图落 `scratch/e2e-clubs-*.png` 与 `scratch/e2e-clubs-detail-*.png`）。
- 上线回读（2026-09-22）：`https://club.whleague.win/` 200 且首页资产与本地 build 逐字一致；匿名 `GET /api/clubs/1` → 401（符合裁决 Q1）；`GET /api/clubs` → 200、20 队、`logoKey` 20/20 非空；生产已配 `TOUR_API_BASE="https://whleague.win"`；生产迁移查得「✅ No migrations to apply!」⇒ 已在 0031。
- 读量（生产实测）：`/api/clubs` 聚合 1,032 行（全表 18,301，SQLite 靠 `WHERE club_id IS NOT NULL` 范围扫跳过 17,731 行 NULL）；`GET /api/clubs/:id` 151 行（club 1）/ 165 行（club 9，生产阵容最大 37 人）；`/api/clubs/:id/standing` 11 行；`/api/media/*` **0 行 D1**。验收线为列表 ≤3,000 行、详情 ≤500 行。
- 变异验证多处均能定向变红（教练区块身份判定、`/club` 两个 Navigate 目标、`failed` 分支、`平均成长空间`、积分榜 TTL、CA 条分母、直方图归一、图表溢出）。
- **本机 e2e 对球队页读端点仍是打桩**：本地 TOUR_DB 的 `team` 表 schema 陈旧（无 `logo_key` / `club_id`，只有 4 行）⇒ 那两个端点在 127.0.0.1 必然 500，属环境陈旧而非代码回归；本地库补到与生产同形后可撤桩。
- 详见 `ROADMAP.md` v3.4.0 节。

## [已上线] · v3.3.0 — 球员面板专项整改：术语三改 + 合同卷宗对齐 + 六维图与 PlayStyles 归位 + 徽章×PlayStyle 合并 + 转会记录页签（2026-09-22，Version d266036d-aa2e-43be-94ac-7f40972df7bb）

用户一次下达六项球员面板整改。前四项是文案与布局，后两项动了数据层：**「徽章」从「只有计数、身份靠管理组在 FC 阵容文件人工落实」改为平台自己记明细**（`player_playstyles`），并补上球员转会记录页签。8 个提交（`f4d4a68` / `e74148f` / `de3c04c` / `60c8dd5` / `1c44506` / `d38b39f` / `6bd9138` / `da7a1f6`），**已推送（`5394268..da7a1f6`）、已部署、生产迁移 `0031` 已 apply**。

**新增**
- `src/core/fc26.ts` 新增 PlayStyle 发放口径：`PS_GRANTABLE_BASE_IDS`（36 项基础 ID：1-8 / 11-16 / 21-26 / 31-35 / 41-45 / 51-56，与 `web/assets/ref/playstyle.json` 银段逐项一致）、`isGrantablePlaystyleId`、`playstyleIdOf(base, kind)`、`playstyleKindOf`、`playstyleSlotRange`（银 1-12 / 金 13-15）、`nextFreePlaystyleSlot`、`playstyleSlotsOf(attrs)`、`mergePlaystyleSlots`、`planPlaystylePicks`（白名单 → 段内重复 → 已拥有 → 银数量 → 金数量 → 落槽，逐层报错）。
- 迁移 `0031_player_playstyles.sql`：明细表 `player_playstyles`（`player_id / slot / kind / psid(基础 ID 1-99) / source(growth|china|manual) / granted_by / created_at`）+ `UNIQUE(player_id,slot)` + `UNIQUE(player_id,kind,psid)` + 段界 CHECK + 索引；末尾把 `config.badge_cap_silver` 由 `15` 改写为 **`12`**。`tests/d1.ts` 的 `MIGRATION_FILES` 已登记。
- 新端点 `POST /api/growth/china-playstyles/:playerId`（本队教练或管理组）：把一直没人读的 `china_badges`（默认 3）落成真发放，名额**一次发满**、`source='china'`，离队即回收。
- 新端点 `GET /api/players/:id/transfers`（公开只读）：只列 `status='completed'` 的单据，LEFT JOIN clubs 出双方队名，按 `completed_at DESC, id DESC` 取最近 50 条。
- 前端：球员详情第 4 页签「**转会记录**」；`web/src/lib/ref.ts` 导出 `TRANSFER_TYPE_LABEL`（从 `web/src/pages/admin/MarketPage.tsx` 抽出共用）；`Player.tsx` 新增 `PlaystylePickGrid` 选择器与中国计划发放块。

**变更**
- **术语三改全系统对齐**（21 文件，纯文案/注释）：「到顶」→「**非成长**」、「经纪人档位」→「**经纪人性格**」、「档案」→「**合同**」（限指代球员合同页签/成长记录的那批）、「效力球队」→「**来源球队**」。**例外保持原貌**：CHANGELOG/ROADMAP 历史条目、`PRD.md:5` 版本行、已 apply 的迁移注释、`scripts/prod-*/README`，以及「主场/球场档案」语义与主题名「复古档案室」、容器名「档案卡 `.dossier`」；摘要条 chip 与球员库表格列名仍叫「经纪人」（沿用v3.1.1 裁决）。
- 合同卷宗排版：新增 `.dossier-table` 作用域 —— 标签列定宽 6.5em、值列统一左对齐、数值列等宽 `tabular-nums`（此前 `td.mono` 三行与 `td.num` 两行字体与对齐不一致，因为全局 `.mono` 规则根本不存在）。
- 六维雷达从属性页**搬到左栏球员卡下方**（`.dossier-side` 纵列 + `.radar-card`），属性页网格第二行空位放 **PlayStyles 卡**（桌面固定 4 列、`.ps-card` 跨两列、900px 以下两列）。
- **徽章 × PlayStyle 合并**：升级方案带徽章时**必须一并交 `picks`**（数量须与方案一致、白名单内、同段不重复、未被 FC 源同段占用、槽位有空），台账 `badges_silver/badges_gold` 与明细 `player_playstyles` 同批写；徽章上限口径**统一为 12 银 / 3 金**（`badge_cap_silver` 默认 15→12，筛选校验与 admin 校验文案同步改 0-12；**DDL CHECK 仍 0..15、历史台账不 clamp**）。
- 回收与折算：转会成约删 `source='china'` 明细并同步减台账；解约删该球员全部明细；大换版（major）按 kind 保留最早 `ceil(n/3)` 行（`FOLD_PLAYSTYLES_SQL`，`generate-sql.ts` 拼在最后一片末尾）。
- `GET /api/players/:id/growth` 返回 `playstyleDetails` 与 `player.chinaPlaystyles {quota,granted,left}`；属性页 PlayStyles 列表 = FC 源槽 ∪ 明细（按 kind+基础 ID 去重，FC 源优先）。
- 文档口径同步：`TECH_DESIGN.md` 决策表第 10 条把「15 与 12 是两个口径，别混」改写为**已统一**并补发放/回收口径，`player_playstyles` DDL 入 §5 建表清单，§10.2/§10.4 补 picks 与明细折算，config 表 `badge_cap_silver` 改 12，端点表加 2 行；`UI_DESIGN.md` 球员详情行改为四页签 + 左栏雷达卡 + PS 卡嵌网格 + 徽章墙 x/12。

**修复**
- **`src/worker/transfers.ts` 海捞签入误回收中国计划徽章**（评审发现）：china 明细回收原先只 gate 在 `!amendment`，于是**海捞真自由身**（`type='free_agent'` 且 `from_club_id IS NULL`）被当成离队 —— 签入即删掉他的 china 明细并扣台账。改为 `amendment || transfer.from_club_id === null ? 0 : (COUNT…)`（从 CPU 队摘人 `from_club_id` 不为空，照旧回收）。回归测试 `tests/bypass-routes.test.ts` 新增「海捞真自由身是签入不是离队」，变异验证（去掉守卫）可复现两行明细被删。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **40 文件 / 573 例全绿**（v3.2.1 基线 39/550）；`npm run build` 成功（`web/dist/assets/index-C56W4cF9.js` 457.55 kB / gzip 145.20 kB）。
- 真浏览器复核（本地 8791，球员 9100 / 9001）：合同页签 7 行全左对齐、数值列等宽；属性页网格恰 4 列、第二行 = DEF/PHY + PS 卡（5 银 + 1 金）；左栏雷达卡常驻；升级方案选满 35 个银选项之一后确认 ⇒ `ca 76→78`、明细落 `{slot:2,silver,psid:2,source:'growth'}`（跳过被 FC PSID1 占用的槽 1）；中国计划发 3 个 ⇒ 徽章墙 🥈 4/12、明细 3 行 `source='china'`；转会页签 6 列无横向溢出。
- 变异验证：海捞守卫（去掉 ⇒ 明细被删）、折算 SQL、槽号口径、白名单过滤均能变红。
- **上线核对（2026-09-22T11:42Z，4 次线上只读请求）**：迁移 `0031` apply 报 `Executed 4 commands`；`player_playstyles` 表与索引各 1、当时 0 行；生产 `config` 无 `badge_cap_silver` 行（迁移那条 `UPDATE` 空转，上限由代码默认值 12 生效）；线上 `/players` HTML 引用 `assets/index-C56W4cF9.js`（与本地产物同名）；`GET /api/players/1/transfers` ⇒ `{"transfers":[]}`；`GET /api/players/1/growth` ⇒ 含 `playstyleDetails` 与 `player.chinaPlaystyles = {quota:3,granted:0,left:3}`；`GET /api/players?badges_silver_min=13` ⇒ 400「badges_silver_min 应为 0-12」（上限 12 已上线）。

**待办**
- 记录不改的遗留：台账可能 > 12（历史 cap 15）会显示「🥈 15/12」；徽章墙分母硬编码 12/3；方案卡 disabled 让「先选满再确认」toast 在 UI 上不可达；双击发放撞 UNIQUE 会让第二个请求 500（不写脏数据）；0 徽章方案多传 picks 被静默忽略。
- PlayStyle 图标资产包仍待供给（`assets/icons/playstyles/{id}.webp`，缺图降级 🥇🥈）。
- 生产 `player_playstyles` 上线时 0 行，首次真实发放（升级选徽章方案 / 中国计划）建议人工跟一单核对明细落槽。

## [已上线] · v3.2.1 — 球员库 UI 缺陷收口：档案页 15 槽徽章 + 多选面板高度上限 + 表格不折行（2026-09-22，Version 627508e5-f7c6-4e6d-90a2-5f95a82466bb）

v3.2.0 上线后，用户 m12257 裁决「建索引先搁置（当日写限额不足）、海捞池后续会有新调整、球员库 UI 小瑕疵可以现在修」，本增量只修三处 UI 缺陷，不建索引、不动海捞池契约、不写生产数据。5 个提交已于 2026-09-22 推送（`76aaeb9..91bc2d3`）并部署为 Version `627508e5-f7c6-4e6d-90a2-5f95a82466bb`，部署后线上 `/players` 的 HTML 引用 `index-C_n2o0KE.js` / `index-D-qmdoLZ.css`，与本地 `web/dist/assets/` 同名。本轮**不跑生产 API 回读**（不涉后端，省 D1 读额度）。

**新增**
- `src/core/fc26.ts` 新增 `PS_SLOT_KEYS`：由 `PS_SLOT_COUNT` 派生的 `PSID1 … PSID15` 槽位键表（此前档案页是手抄数组，与槽数常量无关联）。
- `web/src/lib/ref.ts` 新增 `playstyleBadges(attrs)`（返回 `{ psid, slot, gold }[]`，扫全 15 槽、只收正整数槽值、`slot` 1 起）与 `PlaystyleBadgeSlot` 类型。

**变更**
- 球员档案页（`web/src/pages/Player.tsx`）的 PlayStyles 徽章由手抄的 `PSID1-7` + `PSID13-15` 改为**按槽位扫全 15 槽**（银 `PSID1-12` + 金 `PSID13-15`），只渲染有值的槽、不给空槽占位 —— 落在 `PSID8-12` 的银徽章从此可见（v3.1.1 遗留 ②；生产实测 `PSID8` 有 3 人）。
- 多选下拉面板的高度上限从 CSS 收回到组件：`web/src/components/MultiSelect.tsx` 新增 `PANEL_MAX_PX = 480` / `PANEL_MAX_VH = 0.7`，`place()` 取 `min(可用空间, 480, 0.7 × 视口高)`（不低于兜底 160px）；`web/src/styles.css` 里那条被内联样式顶掉、从未生效的 `.multiselect-panel { max-height: min(70vh, 480px) }` 删除（遗留 ④）。
- 球员库表格单元格**一律不折行**（`.library-main td { white-space: nowrap }`），列宽不够时由外层 `.table-wrap` 横向滚动承担；管理员页表格不受影响（遗留 ⑤）。
- 摘要条「筛选（N）」的计数口径经用户裁决**维持现状**（数 chip 条数，位置选 12 个仍显示 1），文档里「已接受」改写为「已裁决维持现状」（遗留 ③）。
- 文档口径同步：`TECH_DESIGN.md` 徽章决策表把「档案页只渲染 `PSID1-7`+`PSID13-15` ⇒ `PSID8-12` 可筛不可见」整句替换为全 15 槽口径，并点明「槽号是 1 起」与「徽章墙 🥈 x/15 的 15 是 `badge_cap_silver` 台账上限、与 12 个银槽是两个口径，别混」；`UI_DESIGN.md` 补 15 槽渲染（不给空槽占位）、单元格不折行（附实测宽度）与面板上限；`ROADMAP.md` v3.1.1 遗留段落逐条改口径。

**修复**
- `web/src/pages/PlayersLibrary.tsx` 的 `psNames` 把 `.map` 的 **0 起下标**当槽号传给 `playstyleIsGold(psid, slot)`（后者语义是 1 起）⇒ 下标 12（= `PSID13` 金槽）走不到金槽分支，银段 ID 落在金槽时列表显示成银、与档案页 🥇 不一致（仅异常数据可见）。改为 `slot + 1`，并把 `psNames` 导出以便单测。
- `tests/core-zero-import.test.ts` 的依赖判据 `/^\s*(import|export\s+.*from)/` 会把 `export const PS_SLOT_KEYS: readonly string[] = Array.from(` 里的 `Array.from` 误判为依赖（`from` 命中），把零依赖模块判红。改为抽出 `hasStaticDependency(line)`：`import` 行首 ∥ `export … from '…'`（带引号）∥ 任意位置的 `import(`/`require(`（抓动态 import），并补判据自测。
- `web/src/lib/api.ts` 之类的既有契约未动；`GET /api/players` 等接口行为与本增量无关（纯前端 + 文档）。

**验收**
- `npm run typecheck` 三份 tsconfig 全清；`npx vitest run` **39 文件 / 550 例全绿**（v3.2.0 基线 39/539 ⇒ 步骤 1 +5、步骤 2 +2、评审修正 +4）；`npm run build` 成功（`web/dist/assets/index-C_n2o0KE.js` 451.12 kB / gzip 143.00 kB + `index-D-qmdoLZ.css` 27.62 kB / gzip 6.36 kB）；本地 8791 + `npm run test:e2e` **9/9 通过**（三视口表格探针：0 个折行单元格、表格最小宽 876px vs 容器 854 / 815 / 290）。
- 三处改动都做过**变异验证**：`flatMap` 改 `slice(0, 7)` ⇒ 2 例红；面板上限改 `Infinity` ⇒ 5 例红；删掉 `white-space: nowrap` ⇒ e2e 报「108 个单元格仍会折行」；`psNames` 改回 0 起下标 ⇒ 1 例红。
- 不跑生产 API 回读（纯前端改动，省 D1 读额度）；部署后只取线上 `/players` HTML 核对 JS hash。

**待办**
- 推送 + 部署 + 线上产物核对（步骤 5）。
- 不在本增量范围（用户已指令搁置或另有安排）：下一批 4 条候选排序索引（`view=initial&sort=ca` / `uid` / `ps` / `name`，写限额不足）、姓名子串 FTS5、`attr:*` 34 键物化子表、海捞池 `LIMIT 300` 无分页无筛选、30 人 `naID`/`FootID` 补录、PlayStyle 图标包待供给。

## [已上线] · v3.2.0 — 球员库 D1 读消耗治理：去整表 COUNT + 两级缓存与代际失效 + 6 条索引 + 全站读面普查（2026-09-22，Version 7c5b5879-0003-421c-9bf2-6026a4674afe）

v3.1.1 收尾时生产 `/api/players*` 全线 500，排查确认是 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起，比部署早约 2 小时）。用户就此立项：「目前球员库相对稳定，现在查找的 D1 读消耗过大！」。先量化再治理——用「真实路由 + 假 D1 抓 SQL」的测量脚本打生产读 `meta.rows_read`，拿到 30 个形状的物理事实，再按写配额（免费档 10 万行/日）排优先级。全部步骤已于 2026-09-22 推送并部署为 Version `7c5b5879-0003-421c-9bf2-6026a4674afe`（步骤 0–5 先上 `91635aca`，步骤 6 再上 `7c5b5879`），部署后 8 请求最小化回读全部符合预期。

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
  - **生产 `/api/players*` 全线 500 的真因**（v3.1.1 收尾时的悬案）：D1 免费档当日行读配额耗尽，限额按 UTC 零点归零、自动恢复。排查中确立**三个假阳性判据**：`/api/health` 只读 `sqlite_schema`（不计配额）；`wrangler d1 execute --remote` 是管理通道（不受限）；`/api/clubs/directory` 缓存键是固定字符串且 stale 刷新分支吞掉 loader 错误（D1 全挂也回 200）。拿真错误文本的办法：临时给 onError 加 `__diag` 字段 + `wrangler dev --remote`（本地代码 + 生产绑定，不需部署）。
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

## [已上线] · v3.1.1 — 球员库左栏 UI 收口：多选下拉替代 chip 墙 + 区间成对 + PlayStyle 银/金分槽（2026-09-21，Version 3455087e-4bdb-4a63-b40f-8df943d80892）

用户对刚上线的v3.1.0 左栏提了 8 条反馈（同行元素未对齐、表格上方空白过多、查找框灰字过长、位置 16 个 chip 太占地方、同一属性的上下限占两行、「属性键」用英文键、「经纪人」叫法、PlayStyle 与显示列也该是多选下拉），另附带要求**修掉金徽筛选**。本轮只改前端与筛选语义，**不写任何生产数据、不碰缓存与限流数值**；生产读消耗的量化与治理被用户明确挪到下一增量（当日 D1 读额度已超限，见 ROADMAP v3.1.1 节的「裁决」与「遗留」）。本增量已于 2026-09-21 推送（`89e039d..30c7cdc`，7 个提交）并部署为 Version `3455087e-4bdb-4a63-b40f-8df943d80892`；部署后生产 `/api/players*` 一律 500，排查确认为 **D1 免费档当日行读配额耗尽**（2026-09-21T15:20Z 起全站真实表读失败，比本次部署早约 2 小时；限额按 UTC 零点归零），最小化生产回读顺延到额度归零之后。**回读已于 2026-09-22T00:01:52Z（本地 08:01，归零后 1 分 52 秒）补做**：`/api/health`、`?sort=name`、`?ps=25`、`?ps=125`、`?ps=1,101`、`/api/players/roster` 六个端点全部 200，另用 `?ps=125&limit=3` / `?ps=25&limit=3` 各一次（合计 8 请求）实测银/金分槽语义在生产成立（金值只命中 `PSID13-15`、银值只命中 `PSID1-12`，互不串），cron 自 00:00:34Z 起恢复成功。

- **新增**
  - **`MultiSelect` 多选下拉组件**（`web/src/components/MultiSelect.tsx`）：走原生 **Popover API**（面板进 top layer，不被窄屏抽屉的 `position:fixed + overflow-y:auto` 裁切），自管 open 态（浏览器的 light-dismiss 一勾就关，多选要能连点），三条关闭路（再点触发器 / 点面板外 / Esc——Esc 里 `preventDefault()`，否则一次 Esc 会连抽屉一起关），面板位置按触发器 `getBoundingClientRect()` 现算并随滚动/缩放跟随，**下方不足 220px 就翻到触发器上方贴底**。位置（12 码位）、显示列（18 列）、PlayStyle 三处接入（v3.1.1）。
  - **属性中文名表成为单一来源**：`web/src/lib/ref.ts` 新增导出 `ATTR_LABELS`（34 项中文名）与 `ATTR_GROUPS`（七组：速度 / 射门 / 传球 / 盘带 / 防守 / 体格 / 门将），球员档案页（原来自写两份、未导出）与筛选面板共用同一份，并有 `ref.test.ts` 断言「与 `ATTR_KEYS` 逐序全等、无重复」。
  - **控件行统一**：`:root` 新增 `--control-h: 34px` 与 `.control-row`（工具条与左栏共用），同行控件底边齐平（v3.1.1）。
  - **e2e 探针**（`scripts/e2e/smoke.mjs` ⑧）：多选面板几何与命中测试（整块在视口内、`elementFromPoint` 命中面板内部、与触发器不重叠、高度 ≥160）、同行控件底边逐对对齐（并断言量到非空）、翻页条按线上量级文案量页面横向溢出（v3.1.1）。
- **变更**
  - **区间上下限合并成对**：原先 14 个 `num()` 每个占一行（「CA ≥」「CA ≤」各一行），改为每对一行两列、label 在左、placeholder 标「最低 / 最高」——CA / PA / 成长空间 / 初始 CA / 年龄 / 身价 / 影响力 7 对 + 属性 1 对（选中属性后出现，label 是该属性中文名）+ 合同 3 对（工资 / 解约金 / 效力时长）（v3.1.1）。
  - **位置**：16 个 chip（四个组 chip + 12 个码位）→ 多选下拉，只放 12 个码位（`POSITION_GROUPS` 随之下线）；点选仍是多选，URL 仍是 `position=CB,ST`（v3.1.1）。
  - **PlayStyle**：72 个 chip（银金同列、点金徽必然 400）→ 多选下拉，顶层分「银徽章 / 金徽章」两段、段内按 EA 六类（射门 / 传球 / 防守 / 控球 / 体格 / 门将）分组，各 36 项；不带搜索框（v3.1.1）。
  - **显示列**：`details` + chip 组 → 同一个多选下拉（`恢复自动` 移入面板页脚，仅手动改过时出现）（v3.1.1）。
  - **摘要条与翻页条合并成一行**（chips 靠左、翻页靠右，都在表格正上方），无筛选时不再渲染「未设筛选条件」占位——原先摘要条是全宽独立一行、分页条居中在表格上方，两者叠加出约 150px 空白（v3.1.1）。
  - 搜索框占位由 `按姓名找（支持去变音：sesko → Šeško）` 改为 **`查找`**（`aria-label="按姓名找"` 保留，去变音能力不变，只去掉占位里的教学文案）（v3.1.1）。
  - 筛选面板「属性键」→ **「属性」**，下拉 34 项按七组 `<optgroup>` 分组、选项写中文名（原先 34 个英文键平铺）；「经纪人」→ **「经纪人性格」**（仅筛选面板 label 与档案页的「经纪人性格 🕴」；摘要条 chip 的「经纪人：温和」与表格列名仍叫「经纪人」，用户裁决值此）；（v3.1.1）。
  - **PlayStyle 命中语义收口**：库里 15 个 PS 槽 = **银槽 1-12 + 金槽 13-15**（金徽落库存「基础 ID + 100」）。改为**银值只比银槽、金值只比金槽**，不再「基础 ID 或 其 +100 命中任一槽」——旧语义下筛银徽章会捞出只挂金徽章的球员（v3.1.1）。
  - PlayStyle 筛选参数白名单由「1-99」改为 **「银 1-99 ∪ 金 101-199」**（100 是空档）+ 去重 + 上限 100 项（超限 400）；槽位与段位常量（`PS_SLOT_COUNT=15` / `PS_SILVER_SLOT_COUNT=12` / `PS_GOLD_BASE=100` / `isPlaystyleId` / `isGoldPlaystyleId`）全部落到 `src/core/fc26.ts`，前后端与档案页共用，不再各写写死字面量（v3.1.1）。
- **修复**
  - **点金徽 chip 必然 400**：前端 `filtersToQuery` 序列化 `ps` 时没有任何白名单、后端只收 1-99，而旧面板铺出的金徽 chip 会序列化成 101-156 ⇒ 随本轮语义收口改掉（v3.1.1）。
  - **多选面板掉出视口**（真浏览器实测）：触发器贴近视口底部时，面板落在 806–966 而视口高 800，掉在视口外、点不到也滚不到 ⇒ 落位改为「下方不足 220px 翻到上方贴底」；同时落位**必须在 `showPopover()` 之后**（之前面板是 `display:none`，`offsetWidth` / `scrollHeight` 量到 0，「面板想要多高」恒为 0，翻转几乎永不触发）（v3.1.1）。
  - **窄屏勾选框标签被拆成三行**：375px 抽屉里 `.lib-adv-grid .field.check` 被 flex 压到 96px，「仅未来之星」渲染成「仅未 / 来之 / 星」⇒ 加 `white-space: nowrap`，整条换行而不拆字（v3.1.1）。
  - 两条 e2e 断言被评审指出是空洞的：翻页条原断 `scrollWidth > clientWidth`（CJK 会换行，永不可能失败）、同行判据原按 `top` 归行（`.control-row` 是 `align-items:flex-end`，底边对齐的成对控件顶边本就不同，会被判成不同行而跳过）⇒ 改为「页面级横向溢出」与「纵向相交归行 + 比底边 + 断言量到非空」（v3.1.1）。
- **待办**
  - **球员库 D1 读消耗的量化与治理**（v3.2.0）：本增量原计划的第一步是打生产实测，但 2026-09-21 当日 D1 读额度已超限（免费档按 UTC 零点归零），用户裁决整体挪到下一增量 ⇒ 本增量**未做任何读消耗测量，也未改缓存 / 限流 / 查询行为**。
  - **档案页只渲染银槽 `PSID1-7` 与金槽 `PSID13-15`**，而筛选与导入的口径是银槽 1-12 ⇒ 落在 `PSID8-12` 的银徽章「可筛不可见」（既存问题，v3.1.1 未修；**v3.2.1 已修**）。
  - 摘要条「筛选（N）」数的是 chip 条数：位置选 12 个仍显示 1（chip 粒度按用户裁决合并，计数口径随之如此，已接受）。
  - 1280 宽下表格里「Baseline Utd」「20.00 m」「2金7银」会折行（列宽所致，非本轮引入）。

## [已上线] · v3.0.0–26 — Version b83ec876（2026-09-21）

2026-09-21 推送 39 个提交（`29c8199..d17cbdd`）→ 部署 Worker（v3.1.0 只改代码与文档、无需迁移；v3.0.0 的 `0028` 已于同日随合同导入批 apply）。`wrangler deploy` CLI 回显 Current Version ID `81e93c74-228f-4fee-9d87-9fecf602d360`；`wrangler deployments status` 的 100% 流向为 `b83ec876-9fc7-4c16-8d01-0cba3d8ab5e5`（同一批、相隔 5 秒，与v2.3.0–24 的 `90bfd78f` / `c0e0d130` 同形态）。

生产回读：`/api/health` 三资源 ok；`/api/players?limit=1` 200；`/api/players?sort=name` 200（修复前直接 500）；`/api/players?name=sesko` 返回 `B. Šeško`（去变音折叠在线上生效）；`/api/players/roster` 200 / 325262 字节；`ca` / `market_value` / `attr:finishing` / `years` 四个排序键与 `effective_years_min` / `protected` / `attr=finishing&attr_min` 三个筛选查询全 200。

## v3.1.0 — 球员库筛选搬进左栏（2026-09-21 上线，见上方部署记录）

- **新增**
  - **姓名去变音搜索**：新增 `src/core/name-fold.ts`，JS 侧 `foldName` 与 SQL 侧 `sqlFold` 用同一张 `FOLD_SPEC` 映射表（两侧规则同源，避免「折了一侧、另一侧没折」的静默漏搜）；球员库 `?name=` 改 `sqlFold('players.name') LIKE ? ESCAPE '\'`，「sesko」能搜到「Šeško」；导入侧 `warnUnfoldable` 对表外字符只警告不挡行，配套硬闸 `unmappedNameChars` 与只读脚本 `scripts/scan-name-chars.mjs`、链深守卫 `scripts/check-name-fold-depth.mjs`（v3.1.0）。
  - **轻量名册端点** `GET /api/players/roster`：单条 SQL 拼「姓名|俱乐部ID|球员ID」多行文本，5 分钟缓存下限；前端**聚焦搜索框才拉**（从不点搜索框的人不付这个代价），之后本地过滤 + 键盘上下选 + 点条目跳 `/players/:id`（v3.1.0）。
  - **球员库左栏**：筛选与显示列搬进球员列左侧 sticky 定宽栏（260px），桌面可收起且收起态记 `localStorage`；生效条件摘要条常驻、每条 chip 可单独撤销（v3.1.0）。
  - **窄屏筛选抽屉**：900px 断点下左栏改为左侧滑出抽屉，遮罩 / × / Esc 三条关闭路、背景锁滚、焦点陷阱与归位（v3.1.0）。
  - **前端组件测试基建**：devDeps 加 jsdom 与 @testing-library（react / dom / user-event），`vitest.config.ts` 加 react 插件并把 include 扩到 `web/**/*.test.ts(x)`（v3.1.0）。
- **变更**
  - **排序键 6 → 29 个**（表头每一列都可排）：`SORT_KEY_NAMES` 与 `TEXT_SORT_KEYS` 提到零 import 的 `src/core/players-sort.ts`，前后端共用同一份（原来各写一份字面量）；文本键（`name` / `contract_type` / `source`）走文本游标 `decodeTextCursor`；新增 `attr:<属性键>` 排序键，属性白名单与后端同源（`FC26_GAME_ATTR_COLUMNS` 从 `sprintspeed` 起切，34 项 = 29 外场 + 5 门将）（v3.1.0）。
  - 球员库排序交互由下拉框改为**点表头**，两态循环（升 → 降 → 升），`sort`/`order` 继续留 URL；默认态不给任何列打 active（服务端默认按 `players.id ASC`，标「UID ↑」是说假话）（v3.1.0）。
  - `PlayersLibrary.tsx` 853 → 598 行（`a7b92c0` 抽离那一步为 340 行，后续左栏/抽屉/表头排序各步又增回）：筛选控件抽成 `web/src/components/FilterPanel.tsx`（12 props），筛选模型拆到 `web/src/lib/players-library.ts`（Filters / EMPTY_FILTERS / RANGE_URL_KEYS / COL_DEFS / autoColsFor / sortColumnVisible / parseColsParam），行为不变（v3.1.0）。
  - 顶栏高度不再写死：`web/src/components/TopBar.tsx` 用 ResizeObserver（**`box: 'border-box'`**）实测回写 `--topbar-h`，吸顶元素避让顶栏（用户放大字号后顶栏更高，写死的 54px/102px 会压住侧栏）（v3.1.0）。
- **修复**
  - **`sqlFold` 的 REPLACE 链撞 D1 表达式树深度上限**：253 项链在真引擎上报 `D1_ERROR: Expression tree is too large (maximum depth 100)`，`?name=` 与 `sort=name` 直接 500（node:sqlite 上限 1000，本地单测测不出）⇒ 折叠表裁到生产实测 87 项，并加 `SQL_FOLD_DEPTH_LIMIT` / `SQL_FOLD_ENTRY_BUDGET` 与守卫脚本（v3.1.0）。
  - **焦点陷阱漏掉收起 `<details>` 里的元素**：Chrome 对收起 details 内元素不返回 `offsetParent === null`，导致清单末位错位、Tab 逃到 body（375 实测第 25 次）⇒ 显式排除 `details:not([open])` 后代、保留其 summary（v3.1.0）。
  - **关闭抽屉的焦点归位不能在同帧 focus()**：入口按钮所在工具条此时是 inert，`focus()` 被浏览器静默忽略、activeElement 掉到 body ⇒ 改为置标记、由 effect 在 `drawerOpen` 变 false 后再 focus（v3.1.0）。
  - 窄屏吸顶规则按类名裸命中抽屉内的筛选行，把「位置」那组 chip 头两行压住 ⇒ 规则改名 `.lib-toolbar` 并限定作用域；抽屉抬头补 sticky（v3.1.0）。
  - `foldName` 删掉 NFD 与整段 `toLowerCase`（只做查表替换 + ASCII 小写），`unmappedNameChars` 加形状变体判据 `FOLD_SHAPED`（弯引号/花式空格/不可见字符原先被跳过、永不报警）（v3.1.0）。
  - `attrSortExpr` 加 `+ 0`、`growth_gap` 两侧 COALESCE（属性值混字符串会让游标 NaN 或比较恒假）（v3.1.0）。
  - 锁滚在 Windows 经典滚动条下整页横跳 16px ⇒ `html, body { scrollbar-gutter: stable }`（v3.1.0）。
- **待办**
  - ~~本轮只改代码与文档，未 push 未部署~~ → **2026-09-21 已随 Version `b83ec876` 推送并部署**（`29c8199..d17cbdd`，39 个提交）；v3.0.0 的 worker 也一并上线。
  - 窄屏抽屉锁滚靠 `body { overflow: hidden }`，iOS 上不彻底（已加 `overscroll-behavior: contain` 兜底，真机未验）。

## v3.0.0 — 合同期与财政节点改窗刻度（2026-09-21 上线，见上方部署记录）

- **新增**
  - **合同期改窗刻度**（迁移 0028）：`contracts` 加 `service_ticks`（签约基数 = 签约时点已关常规窗数）/`protection_ticks`（保护期结束的绝对窗数）/`signed_season`+`signed_window_seq`（展示），`season_windows` 加 `is_temporary`；效力 = 0.5 × 已关常规窗数（1 常规窗 = 半赛季），保护期 = 签约后 3 个常规窗，解约免费门槛 = 6 个常规窗（3 赛季）；纯函数在 `src/core/bypass-rules.ts`，计数助手 `src/worker/contract-ticks.ts`（v3.0.0）。
  - **窗分型**：开窗 `POST /api/admin/windows/open` body 加 `temporary`；同赛季常规窗上限 2（季初 + 中期，第 3 个非临时窗硬拦 409）；季初/中期不落库，按同赛季非临时窗顺序派生（v3.0.0）。
  - **忠诚奖金改发放点**：从赛季结算按钮移到**赛季中期窗关窗**时发（`kind='loyalty' ref_type='window' ref_id=season*100+windowSeq` 幂等，逐队合并一条流水），关窗响应回显 `loyalty`（v3.0.0）。
  - **导入历史合同**：按 `effective_from` 反查签约基数并落保护期刻度（训练营无保护期），`service_ticks`/`protection_ticks` 随之 upsert（v3.0.0）。
- **变更**
  - 关窗扣款顺序改 **富人税 → 工资**，富人税税基含未扣工资（`资金` 与 `ΣRC+资金` 取多，不再减本窗工资）；临时窗只扣富人税 + 维护费（不扣工资、不收冠名租金也不递减剩余窗数），死忠演化每种窗照做（v3.0.0）。
  - 续约/匹配把保护期收口到审核通过当下：`protection_ticks` 置为当前已关常规窗数（判定恒不成立），`service_ticks` 效力基数不动（v3.0.0）。
  - 球员库/球员详情/球队页的效力与保护期按赛季展示（`serviceSeasons`/`protected`），筛选 `effective_years_*`、`protected=in|out` 改窗刻度 SQL；管理端开窗表单加「临时窗」复选框、窗列表加窗类型列（v3.0.0）。
  - `contracts.protected_until`（旧口径 signed_at + 548 天）保留留档，判定不再读；`loyalty_tiers` 档位单位由「年」改「赛季」（数值不变）（v3.0.0）。
- **修复**
  - 球员库效力筛选原会把无合同的球员按基数 0 当满效力：加 `ct.player_id IS NOT NULL` 闸（v3.0.0）。
  - 空数组求和得到 `-0` 会让关窗响应与断言别扭：`PayrollSummary` 汇总归一为 `0`（v3.0.0）。
- **待办**
  - 迁移 0028 **已于 2026-09-21 随合同导入批 apply 到生产**（生产迁移现到 0028）；~~worker 仍未部署~~ → **2026-09-21 已随 Version `b83ec876` 部署上线**（网页面板建合同不再落 DDL 默认刻度）。
  - 0028 是纯加列迁移（5 条 `ALTER TABLE ADD COLUMN`，无数据回填——apply 时生产 `contracts` 与 `season_windows` 分别为 0 / 1 行），比 0027 的 7.3 万行写轻得多。

## [已上线] · v2.3.0–24 — Version 90bfd78f（2026-09-20）

2026-09-20 推送 50 个提交（`9f05116..fe60273`）→ 生产迁移 apply 0022–0027（生产迁移现到 0027）→ 部署 Version `90bfd78f-fae4-4584-8d52-871486aa46c0`。生产回读：`/api/health` 三资源 ok；0026 的 CPU 回填核对通过（id 10 / 241 / 112172 / 131681 均 `is_cpu=1`）；v2.3.0–23 新增路由在生产返回 401（未登录）而非 404。

### 新增

- **球员库**：接口补 `total` 与整套筛选域（身价/声望/成长空间/初始 CA/惯用脚/成长档位/未来之星/中国计划/经纪人档位/PlayStyle 多选/位置四槽多选/细分属性区间/合同域）；页面改版为 SoFIFA 式可变列 + 更多筛选折叠面板 + URL query 持久化（v2.3.0）。
- **俱乐部目录工具**：新建俱乐部必填游戏队号（赛事库校验 + 队名预填 + 指定 id 建行 + 认证目录 upsert，失败可重试）；`GET /api/clubs/directory`；管理端多教练绑定逐个解绑；换队号 rekey 只读预演工具 `scripts/rekey-team/`（v2.3.0）。
- **站内信收件篮**：`GET /api/notifications`、`GET /api/notifications/unread-count`、`POST /api/notifications/read`，未读判定用独立列 `read_at`（迁移 0022），赛果确认与升级两处写入点内部改双通道（每个绑定账号一条 web 行进收件篮，绑了 QQ 的另加一条 qq 投递行）（v2.4.0）。
- **设施经营**：球场扩建、档位升级、子设施升级与建设券（迁移 0023 给 `stadiums` 加 `build_credit` 列），用户端 `GET /api/club/stadium/build-info` 与 `expand` / `upgrade` / `facilities/upgrade`，管理端 `GET|POST /api/admin/clubs/:id/stadium`；建设支出按 25% 返券、券只抵后续建设支出（先券后钱），config 新增 `facility_prices` 与 `stadium_max_open_tier` 两键（v2.5.0）。
- **冠名市场**：品牌池报价 / 签约 / 退约 + 窗末收租（迁移 0024 `naming_contracts`，费用条款快照列化 + 部分唯一索引拦一队双签），`GET /api/club/naming/quote` 与 `sign` / `terminate`，config 新增 `naming_params`（v2.6.0）。
- **赛果自动化**：cron 自动确认赛果（每轮上限 20 场，actor=0 系统留痕）、通知钩子重放 `POST /api/admin/results/:id/replay-hooks`、人工复核（迁移 0025 给 `result_confirmations` 加 `needs_review` / `review_note`）与 auth 三事件审计，config 新增 `results_auto_confirm`（v2.7.0）。
- **换版机制**：小换版 / 大换版两种模式（CA 换算与成长清零口径），导入预览警告与合同校验（v2.8.0）。
- **性能与守护**：`players` 四条排序表达式索引（迁移 0027）；公开 GET 的进程内限流与 TTL + stale-while-revalidate 缓存（`src/lib/guard.ts`，`PUBLIC_CACHE_TTL_MS`）；e2e 冒烟脚本 `scripts/e2e/smoke.mjs`（8 场景）与 `npm run test:e2e`（v2.8.1）。

### 变更

- `clubs.is_cpu` 列化（迁移 0026，由队名后缀回填），CPU 队不再靠名称判断（v2.8.0）。
- 顶栏响应式重排：桌面单行，窄屏品牌/用户区与导航分两行横滑（v2.3.0）。
- 公开 GET 的缓存与限流都是 isolate 内 `Map`：重启即清、多 isolate 不共享；KV 方案因免费档写配额否决。

### 修复

- 赛果通知钩子重放会重复发通知：重放跳过通知钩子（v2.7.0 收口审查发现）。
- 确认钩子（XP / 通知 / 奖金 / 上座）原先同步执行且裸奔，任一失败会把已入档的确认炸掉并让重试撞 409：改为逐个吞错收集（v2.7.0）。
- 账本幂等闸原按 `(kind, ref_type, ref_id)` 全局查重，多队同窗结算只有第一队落账：改按 `(club_id, kind, ref_type, ref_id)`（v2.6.0 前置修复，生产未触发）。
- 收件篮「标记已读」在 ids 超过 D1 单查询绑定参数上限 100 时报 500：改按 100 分块 `db.batch`（v2.4.0 收口审查发现）。
- 设施升级批次漏了 `build_credit` 的 UPDATE，建设券只进提示不落库（v2.5.0 冒烟发现）。
- 合同导入的 `clubId` 不存在时预览放行、落库才撞外键 500：preview 与 confirm 都改 404（v2.8.0）。
- 换队号 rekey 在换壳模式下 `tour_team_id` 空闲但认证库 `club_id` 已被占，只在执行期才炸：预演加撞号闸（v2.3.0）。
- 缓存键直接用原始查询串导致 `?a=1&b=2` 与 `?b=2&a=1` 重复装载：改为 `canonicalQuery` 归一；缓存条目无上限（键外部可控）会堆内存：加 64 条上限按插入序淘汰（v2.8.1 收口审查发现）。
- 球员库「上一页」用 `fetchPreviousPage` 会与页码错位，改为页码状态 + 缓存回退；无限查询最后一页按钮仍亮（v5 里 `getNextPageParam` 返回 `null` 仍算有下一页）（v2.2.0 收口审查发现）。

### 文档

- `README.md` 重写（原先只有一行标题）：定位、文档索引、技术栈、快速开始、命令表、绑定资源与权限、迁移纪律、测试、目录结构、部署现状（v2.8.2）。
- 新建项目级 `AGENTS.md`（危险操作清单、开发与测试口径、代码与提交规范）与 `CHANGELOG.md`（本文件）、`scripts/README.md`（脚本性质分级 + 生产工件执行状态）（v2.8.2）。
- `TECH_DESIGN.md` 与代码对齐：§13 补 5 个已落地 config 键并修正 2 个「待定」键、§15 假设加分类口径与编号归位、§17.1 补表达式索引规约、§17.3 按 `src/lib/guard.ts` 现状改写并写明「不用 KV 做 SWR」的裁决、§12 与假设 23 记 web 收件篮落地、附录 A 通知行拆分并标注冻结范围（v2.8.2）。
- 删除过期草稿 `handoff-20260916.md`（停在v1.5.0），其中仍有效的三条（球员库逐队源数据位置与字段口径、导入通道选择、`--file` 通道外键陷阱）已迁入 ROADMAP 与 `scripts/README.md`（v2.8.2）。

### 待办

- push 与部署已于 2026-09-20 完成（见本节开头的部署记录）；0027 的 7.3 万行写已随当日 apply 计入。
- 生产回填已于 2026-09-20 执行完毕：16 队队籍（`scripts/prod-20260919-roster-backfill/`，444 人，只写队籍不造合同），复查全库 assigned 551 = 4 支 CPU 队 107 + 本批 444、free 17750。
- `clubs.is_cpu` 四个 CPU 队（id 10 / 241 / 112172 / 131681）回填已于 2026-09-20 部署后核对通过（均 `is_cpu=1`）。
- 遗留：球员库 30 人缺字段补录未执行（源数据缺 `naID`/`FootID`，`scripts/players-import/overlay-missing.ts`）。

## [已上线] · v2.2.0 用户端重构 — Version 6ed7446c（2026-09-19）

- Market 拆为三页：`/market`（挂牌板 + 详情出价，公开）、`/market/free`（海捞签入 + 训练营激活，需登录）、`/market/mine`（我的挂牌 + 我的出价，需登录）。
- 用户端登录守卫 `RequireUser`（软卡不重定向）与 `AuthContext`（`/api/me` 全站单点拉取，顶栏/首页/管理端的 props 钻透退役）。
- 用户端 8 页数据层接入 TanStack Query，写后精确 invalidate。
- 注册合规逐人标红：按球员展开行级红底 + 规则短标签。

## [已上线] · v2.1.0 管理端重构 — Version 4d03eb57（2026-09-19）

- 管理端从单页拆为左侧栏壳 + 8 个子路由（总览/赛季/球员/导入/转会/俱乐部/财政/系统），React.lazy 分包；后端 `admin.ts` 拆为 `routes/admin/` 八域，URL 零变更。
- 新增暂停出价：全局 config 开关 `market_bid_paused` + 单挂牌列（迁移 0021 `listings.bid_paused`），只挡新出价，不改变结算时刻。
- config 超管全开（独立权限点 `club.config.manage.super`，GET 明文 / PUT 逐键编辑 + 审计 `config_set`）、`GET /api/admin/overview`（isolate 60s 缓存 + `?fresh=1`）、`GET /api/admin/audit-log`。
- 统一两段式确认按钮 `ConfirmButton`，批量维护改结构化逐行预览。

## [已上线] · 早期v0.1.0–14（2026-09-12 ~ 2026-09-19）

- v0.1.0 地基：纯 Worker + 共享登录 + schema + SPA 壳。
- v0.2.0 球队与球员主数据（管理端最小集）。
- v0.3.0 阵容注册与合规。
- v0.4.0 转会市场（挂牌竞价链）。
- v0.5.0 签约谈判（signing）。
- v0.6.0 旁路操作 + 激活匹配 + 窗口。
- v0.7.0 财政、赛季与通知（MVP 收口）；6.1 走查修复与球员库（四裁决落地）。
- v1.0.0 球队绑定上收认证中心（auth + tour + club 三仓，`AUTH_DB` 只读接入）。
- v1.1.0 球员库统一 + FC26 ID 对齐。
- v1.2.0 分级派生（报名定级，club 单仓）。
- v1.3.0 异常告警 + 管理介入 + 批量维护。
- v1.4.0 赛季结算域。
- v1.5.0 主场收入域（存量主场数据迁移）。
- v1.6.0 成长域校准（成长期 / 解约清零 / 中国计划闸门）。
- v2.0.0 CPU 队与队籍口径（`clubs.is_cpu` 代码侧与球员库首灌）。

早期各次的部署 Version 记录见 `wrangler deployments list --name whl-club` 与 ROADMAP 对应章节。
