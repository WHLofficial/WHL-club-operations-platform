# v6.65.2 · 签约谈判区每条会话可折叠（卡头摘要 + 正文收起）

## 缘起

玩家建议：签约谈判区内每一条谈判都能折叠。owner 定口径（m02355）：**B 的交互 + C 的信息密度，默认多张全收起**。

- B（交互）= 受控折叠：卡头右侧 chevron 按钮 + `aria-expanded` / `aria-controls`，展开态记 localStorage。
- C（信息密度）= 卡头常驻关键信息：球员、阶段、「剩 N 轮」、上次报价、预期工资、静默剩余时间；完整对话流与报价框收进正文。

现状动机：生产 `negotiation_sessions status='active'` 有 9 条（club 73 一家占 8 条），`SessionCard` 每条都把整段 `.nego-thread` 对话流 + 报价框摊开，一屏只装得下一条多。

## 现状（已查证）

- `web/src/pages/market/desk/NegotiationsSection.tsx`（532 行）：`NegotiationsSection()` 渲 `DemandSection` + 标题 + hint + `active.map(SessionCard)`（`active = sessions.filter(s => s.status === 'active')`）；`SessionCard`（`:192`）结构为 `<section className="card">` → `<h3>`（球员 `<Link>` + 「谈判中」+ 阶段徽标 + 经纪人档位）→ `<p className="hint">`（from → to、成交价、位置/年龄/CA/PA）→ `<div className="nego-thread">`（开场行 + 每轮三条气泡）→ 动作区（`ReleaseFeeStep` `:277` / `OfferStep` `:340`）。
- `lastOffer` 已在 `SessionCard` `:205` 算好（`s.attempts` 末条 `offeredWage`），现在只传给 `OfferStep`，没进卡头。
- `OfferStep` 内 `wage` / `confirmTrainee` 两段式确认、`ReleaseFeeStep` 内 `fee`、以及 350ms 防抖 preview 全是组件内 `useState` ⇒ **折叠必须用 CSS/`hidden` 隐藏而不是条件渲染**，否则收起再展开会把已填的工资与二次确认态清空。
- `web/src/styles.css:8183-8185` 明写 `.nego-thread` 只是不滚动容器，整页滚动——折叠不引入内滚动。
- 静默作废 72h，锚 = `MAX(expiry_anchor_at, created_at, 最后一次报价)`（`src/worker/negotiations.ts:821-843` 的 `SILENT_ANCHOR_SQL`），到点走 `closeSilentSessions`（`:854`）→ `voidSigningCore`。DTO `NegotiationSession`（`web/src/lib/api.ts:1008-1027`）没有这个时间，前端算不出倒计时。
- 测试闸门：`web/src/pages/market/desk/NegotiationsSection.test.tsx`（288 行）依赖 `.nego-sys` / `.nego-b.me` 计数与 `screen.getByRole('button', { name })`。

## 裁决

单会话按现状全展开；**≥2 条时全部收起**，用户手动展开/收起记在 localStorage。折叠是纯前端视图态，不动任何接口语义。

### 卡头（收起态也可见）

单行 flex：左侧 `<h3>` 内容（球员链接 + 谈判中 + 阶段徽标 + 经纪人档位）不变；右侧 chevron 按钮（`aria-expanded`、`aria-controls=nego-body-<id>`、`aria-label`「展开/收起谈判详情」，展开时图标旋转 180°）。

摘要行沿用 `<p className="hint">`，**只放三段**（grilling Q2）：`上次报价 {lastOffer}m`（无报价时「尚未报价」）、`预期工资 {expectedWage}m`（`releaseFee === null` 时「待定」）、`静默还剩 {n}h`（`n <= 0` 显示「即将作废」）。阶段与「剩 N 轮」留在 `h3` 徽标上，成交价 / 位置 / 年龄 / CA / PA 收进正文——摘要行控制在单行内，窄屏不换三行。

### 正文

`.nego-thread` + 动作区包进 `<div id="nego-body-<id>" className="nego-body" hidden={!open}>`。`hidden` 属性 + `styles.css` 里 `.nego-body[hidden] { display: none; }`，保证组件不卸载、`useState` 与防抖定时器都活着。

### 点击热区（grilling Q3）

卡头容器 `onClick` 切折叠，但 `e.target.closest('a, button, input, textarea, select')` 命中时直接返回——点球员名仍是导航，点 chevron 由按钮自身的 `onClick` 处理（`stopPropagation`，避免一次点击翻两次）。chevron 是真 `<button type="button">`，键盘可达；卡头不包 `<button>`，避免嵌套交互元素。

### 静默倒计时（grilling Q1）

后端把 `expiresAt` 算好放进 DTO：`loadSessions` 用同一份 `SILENT_ANCHOR_SQL` 取锚，JS 侧加 `negotiation_silence_hours`（默认 72）转 ISO 回传。前端卡头显示剩余小时数，**组件内每分钟 tick 一次重算**（`useEffect` + `setInterval(60_000)`，卸载清理），`n <= 0` 时显示「即将作废」。

### 有新反馈提示（grilling Q4）

最小版：localStorage 记每个会话的 `lastSeenAt`（展开时写 `now`）。当 `attempts` 末条时间晚于 `lastSeenAt` 时，卡头显示「· 有新反馈」小字。不做红点、不做未读数。

### 状态持久化（grilling Q5）

`localStorage` 键 `whl-nego-fold-v1`，值 `{ "<sessionId>": "open" | "closed" }`；`lastSeenAt` 另存 `whl-nego-seen-v1`。读取时用当前 `active` 集合裁剪不存在的 id 并回写，另设 100 条上限；写入失败（隐私模式）静默吞掉。**默认值只在没有记录时生效**：`active.length >= 2 ? 'closed' : 'open'`。

## 明确不在本版（owner 已定，另开一版）

「已结算（N）」折叠区：`NegotiationsSection` 目前只渲染 `status === 'active'` 的会话，成交/作废结果只在邮箱与球员页可见。owner 认为值得做，但它是独立一块列表（分页、成交与作废两态、`settled.message` 文案、复用折叠组件），与「让 active 列表可折叠」分两版落地。

## 交付物

1. `src/worker/negotiations.ts` `loadSessions`（`:640` 起）：SELECT 复用 `SILENT_ANCHOR_SQL` 取锚（空串转 null），JS 侧按 `ctx` 的静默小时数算出 `expiresAt`（ISO）回传；只在 DTO 加字段，不改任何判定逻辑。
2. `web/src/lib/api.ts`：`NegotiationSession` 加 `expiresAt: string | null`。
3. `web/src/pages/market/desk/NegotiationsSection.tsx`：`SessionCard` 拆卡头/正文两层；新增 `useFoldState`（读写 localStorage、裁剪、上限、默认值）与 `useMinuteTick`（60s 重算剩余）；摘要行三段；`有新反馈` 判定用 `lastSeenAt`；展开时写 `lastSeenAt`。
4. `web/src/styles.css`：`.nego-head`（flex + 间距）、`.nego-fold`（无边框按钮 + chevron 过渡）、`.nego-body[hidden]`、`.nego-fresh`（有新反馈小字）；不动 `.nego-thread`。
5. `web/src/pages/market/desk/NegotiationsSection.test.tsx`：单会话默认展开（既有用例基本不动）+ 新增：① 两条会话默认全收起、正文不可见；② 点 chevron 展开后 `.nego-thread` 与按钮都可见、`aria-expanded` 翻转；③ 收起再展开后已填的工资输入值仍在（状态未丢）；④ localStorage 里 `closed` 的会话渲染后仍收起、且残留 id 被裁剪；⑤ 点球员名不触发折叠；⑥ 摘要行显示三段、`attempts` 末条晚于 `lastSeenAt` 时出现「有新反馈」。
6. `package.json` 版本 bump **6.65.2**（6.65.0 / 6.65.1 已被其他会话占用）。
7. `ROADMAP.md` / `CHANGELOG.md` 条目；`docs/test-plans/v6.65.2-nego-collapse.md`。

## 验收口径

- `npx vitest run web/src/pages/market/desk/NegotiationsSection.test.tsx` 全绿，且把默认值改回「恒展开」时 §5 的用例①必红（突变验证）。
- `npm run typecheck` 三份 tsconfig 全清。
- 全量 `npm test` 不低于当前基线（178 文件 / 2,887 例，另一会话可能已推进）。
- `npm run build` 通过。
- 手工：club 73 教练台（8 条 active）首屏 8 条全部收起、卡头能看到上次报价 / 预期工资 / 静默剩余；展开一条填工资、收起、再展开，输入值还在。

## 风险边界

- 只动前端组件 + 一个 SELECT 派生字段 + DTO 类型；**零迁移、零生产写**。
- 不改 `DemandSection`（续约要求卡）与已结算会话的展示逻辑。
- `expiresAt` 是新增字段，旧前端忽略它不受影响；`SILENT_ANCHOR_SQL` 复用同一常量，避免两处口径漂移。
- push 需 owner 另行下令（push 即自动部署）。

## 决策记录（grilling 2026-10-31）

- Q1 静默倒计时：做，前端每分钟重算（方案 c）。
- Q2 摘要行：只放三段（上次报价 / 预期工资 / 静默剩 Xh）。
- Q3 点击热区：卡头整行可点，排除 `a/button/input/textarea/select`；chevron 是真按钮。
- Q4 有新反馈：做最小版小字提示，本地 `lastSeenAt` 判定，无红点无未读数。
- Q5 存储：读取时按 `active` 裁剪 + 100 条上限，不按俱乐部隔离。
- Q6 已结算折叠区：不在本版，另开一版。
