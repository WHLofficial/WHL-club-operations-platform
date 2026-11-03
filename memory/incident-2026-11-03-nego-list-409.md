# 事故：签约谈判页签整个空掉（2026-11-03，club 66）

**症状**：教练打开转会台「签约谈判」页签，计数 0、无任何球员行，规则说明下面只有一条黄框「上调单在成约时结算，不走条款落地」；该队当时有两笔在谈上调单（Jacquet / Mawissa）。

**根因链路**
1. `listMySessions`（`src/worker/negotiations.ts`）读列表时对「已结束区」行逐条 `healSettlement`，条件是 `settled` + `settle_source` + 单据 `signing|completed`。
2. `applyContractTerms`（`src/worker/transfers.ts`）把 `if (transfer.type === 'promotion') throw 409` 排在 `terms_applied` 幂等闸之前。
3. 该队有一条已成品上调会话（Talbi，transfer 188，`completed` + `terms_applied=1`）⇒ 每次读列表都重放 409，整个 `GET /api/negotiations?mine=1` 失败。
4. 前端把失败映射成 `loadError` 黄条、`sessions` 保持 null ⇒ 进行中行 / 「正在翻谈判夹…」/ 空态卡 / 已结束折叠四个分支全不渲染。

**修法（v6.72.1）**
- 自愈扫描跳过 `promotion + completed`（成约时已结算，没有待落条款），并给每行包 try/catch 只 `console.warn`。
- `terms_applied` 幂等闸提到状态/上调拦截之后、上调拦截之前 ⇒ 已结算上调单重放返回 `already`。
- 回归：`tests/negotiation-routes.test.ts`「已结算的上调单不会打断列表」、`tests/apply-contract-terms.test.ts`「已结算的上调单重放返回 already」。

**排查口径**：页面「有标题 + 有 hint + 只有一个黄框、计数 0」= 列表请求整体失败；先看 `GET /api/negotiations?mine=1` 的真实状态码与 error 文案，不要从 CSS / 分组逻辑找。
