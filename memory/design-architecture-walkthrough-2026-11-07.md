# 架构走查报告（2026-11-07，2026-11-09 重建落盘）

> **重建说明**：原报告为会话内渲染的 HTML，未落盘；本文为事后重建。走查时的逐文件明细清单
> 已不可恢复，只保留结论级发现与候选清单。标 **[复测]** 的数字是重建时重新实测的订正版，
> 其余为走查原始结论。深度化词汇（模块 / 接缝 / 深度 / 适配器 / 杠杆 / 局部性 / 删除测试）
> 见 improve-codebase-architecture skill。

## 核心发现

1. **「在途 / 挂牌」状态机散落 11 个文件**：同一个「这名球员能不能动」的判定在 bypass.ts、
   routes/market.ts、offers.ts、negotiation-guard.ts、activations.ts、demand-ops.ts、
   transfers.ts 等处各写一份，靠注释协议（「两处口径必须同步改」）与跨实现测试锁维持。
   **[复测]** 走查时为 7+ 处重复判定。
2. **关单（挂牌收口）实现 5 份**：listings 状态机的写侧收口（成交 / 下架 / 过期 / 取消）
   分散在 market-settle.ts、window-machine.ts、activations.ts、bypass.ts、transfers.ts。
3. **前后端契约靠手抄**：`web/src/lib/api.ts` 手写全部响应类型，与 269 处 `c.json(...)`
   内联构造零机制关联。
   **[复测]** api.ts 3181 行、262 个类型/接口、129 枚提交碰过——全仓最大 churn 热点
   （走查时记 3170 行 / 68 次改动为某窗口口径）；api.ts 内「字段与 src/worker/xxx 一一对应」
   注释多处；`api.ts:1224` 有 drift 事后手工收紧的痕迹（transfer.type string→联合类型）。
   走查时记的「2 次类型白屏」具体 incident 出处未能在 git/记忆中重新钉死，按未经查证处理。
4. **生命周期语义无单一 owner**：球员运营状态（normal/listed/trainee/free/retired…）的
   流转规则分散在市场、成长、合同、结算各域，每个域自己解释 `players.status`。
5. **关窗管线单函数巨批**：`src/worker/home.ts` 关窗批是一个巨型顺序函数，设施 / 上座 /
   工资 / 事件 / 信号 / 冠名热度的耦合靠代码顺序表达，无阶段接缝。

## 候选清单（按杠杆排序）

| # | 候选 | 一句话 | 状态 |
| --- | --- | --- | --- |
| 1 | **球员在途状态读模型（PlayerMarketState）** | 「能不能动」判定收成深模块 flowState/seaVerdicts/ensureNotInFlight，消灭注释协议 | ✅ **已完成上线**（v6.80.0 两批，Version `3679aca4`，2026-11-08） |
| 2 | **挂牌收口 advance(listingId, cause)** | 5 份关单实现收成唯一写侧入口；transfers.ts:918 的成交回写、状态机 UPDATE 归此 | ✅ **已实施（v6.83.0，本地未 push）**：`src/core/listing-state.ts` 转移表（12 cause）+ `src/worker/listing-ops.ts` 唯一写侧入口，12 处写点 / 7 文件收编（`81c3f4d` → `1862889` → 评审修复 `da0e808`）；非法转移按零变化降级为 `changes=0` 静默 no-op，core 表仅语义真源与测试验证器，409 只留调用方原有预检；源码锁 listing-ops 外零直写；vitest 209 文件 / 3213 例全绿（修复前口径）+ 定向 21/21；计划 32 例实际 21 例、变异 4/11，缺口登记。细节见 ROADMAP v6.83.0 节与测试计划 §9 对照 |
| 3 | **共享契约层** | api.ts 262 份手抄类型与 269 处 c.json 之间立一条类型接缝（src/contract/ 单一真源） | ✅ **已实施（v6.82.0，本地未 push）**：六批 batch1–6 落地（24/54/64/70/31/26 型，`0de3f09`…`4e50318`）+ 评审修复 `77d8060`；api.ts 3181→729 行手抄清零改转发、AGENTS.md 契约行入库；vitest 207 文件 / 3202 例全绿；TC-LOCK 源码锁未落地留待办；C（Hono RPC）归远期。细节见 ROADMAP v6.82.0 节与测试计划 §10 对照 |
| 4 | **PlayerOpsState** | players.status 流转规则的单一 owner（生命周期状态机） | 未立项 |
| 5 | **ContractPendingChange** | 谈判「待生效 / 关窗后生效」变更的显式建模（现靠合同行 + 台账推断） | 未立项 |
| 6 | **关窗管线阶段化** | home.ts 关窗批拆阶段接缝（每阶段独立可测、可重放） | 未立项 |

## 讨论记录

- **#1**：2026-11-07 grilling 九裁决 → 2026-11-08 两批交付上线（含第二批：挂牌 dup 四态统一、
  `ACTIVE_LISTING_STATES_SQL` 常量单源；撤出项与 signing 双谓词兜底裁决见
  `~/.zcode/cli/memories/.../plan-v6.80.0-player-flow-state.md`）。
- **#3（2026-11-09 讨论）**：路线 A（共享类型真源，src/contract/，worker handler 返回值标注 +
  api.ts 改 import type，运行时零变化）为推荐；B（只加运行时契约测试）治标；
  C（Hono RPC）结论——**现在没有必要**：C 的核心价值（响应单一真源）A 已覆盖，A 的契约类型
  就是将来 C 的 `c.json<T>` 标注（A 是 C 的严格前置子集）；C 的独有增量（契约工件归零 +
  请求侧自动类型化）抵不过本仓 220 端点 / api.ts 3181 行的存量重写成本、前后端 typecheck
  耦合与框架耦合。若将来要 C，正确姿势是 A 落地后仅对新域渐进采用 hc。
  排期注意：#3 首批避开 market/offer 域（与 #2 错开），候选起点 players/growth 或 workbench 域。
  **实施结果（2026-11-09）**：用户追加「几批全弄清楚一锅端」覆盖上述排期注意，六批全域一锅端
  施工 + 评审修复完毕，本地未 push；验收与偏差（TC-LOCK 源码锁未落地、锚点缺口总账等）见
  ROADMAP v6.82.0 节与 `docs/test-plans/v6.82.0-contract-layer.md` §10「实际交付对照」。
