# 玩家队 → CPU 队反向转换设计

- 日期：2026-11-11
- 状态：设计稿，待实现
- 目标版本：v6.79.0（暂定；当前线上 v6.78.0）
- 口径拍板：保留阵容和合同；默认阻止在途人工状态；不做强制转换。

## 1. 背景

平台已有「CPU 队 → 玩家队」接管向导（v6.27.0）：

- `GET /api/admin/clubs/:id/cpu-convert` 只读预检；
- `POST /api/admin/clubs/:id/rename-tour` 赛事侧改名；
- `POST /api/admin/clubs/:id/rename-local` 本仓改名并 `is_cpu=0`；
- `POST /api/admin/clubs/:id/seed-ops` 铺主场基建。

实现位于 `src/worker/routes/admin/clubs.ts:429-620`，UI 位于 `web/src/pages/admin/CpuConvertPage.tsx`。

但反向「玩家队 → CPU 队」没有任何端点或 UI。更关键的是，**只把 `clubs.is_cpu` 翻成 1 不是一次完整转换**：

1. 教练鉴权只看绑定关系，不看 `is_cpu`；原教练仍能操作；
2. 赛事/成长侧另有「队名是否以 `(CPU)` 结尾」的口径；
3. 绑定在 AUTH_DB，跨系统没有原子事务；
4. 在途谈判、挂牌、报价、待审过户会悬空；
5. 保留合同意味着全队球员会立刻变成可海捞对象。

因此需要一条显式的、分步幂等的管理端向导，而不是一个「改一列」的按钮。

## 2. 目标与非目标

### 目标

- 管理端把一支人类队安全转成 CPU 队；
- 转换后没有账号还能以教练身份操作这支队伍；
- 赛事侧队名、本仓队名、`is_cpu` 三者一致；
- 转换过程可重试、可审计、可复核；
- 保留阵容和合同，不产生解约/清队副作用；
- 不新增数据库迁移。

### 非目标

- 不自动清理在途谈判、挂牌、报价、待审过户；有这些状态时默认阻止；
- 不自动解约、不释放球员、不改合同；
- 不自动通知教练（由管理组线下沟通）；
- 不做批量转换；
- 不在本期实现认证中心的「撤销未使用绑定码」接口；先用平台侧绑定守卫兜底；
- 不做「强制转 + 自动撤单退款」模式。

## 3. 关键口径

### 3.1 保留阵容和合同

转换只改队名和 `is_cpu`，不动：

- `players` 归属；
- `contracts`；
- 余额、账本、球场、设施、联赛级别、`status`、`transfer_banned`。

后果必须明确写进向导：

- CPU 队球员按 `src/worker/player-flow-state.ts:185-186` 的既有口径按「无归属」处理，可被海捞；
- CPU 队不产生转会费；
- 现有合同不构成海捞的归属障碍。

### 3.2 默认阻止在途

以下任一存在时，预检返回阻断项，不允许转换：

- 该队 `negotiation_sessions.status='active'`；
- 该队作为卖方的未终态挂牌；
- 该队作为买方或卖方的 `offers.status IN ('pending','intent')`；
- 该队相关的 `transfers.status='pending_review'`；
- 关联的 open `review_tasks`；
- 建议名撞 `clubs.name` UNIQUE；
- 建议名超过 40 字。

不自动撤单、不自动退款、不自动终止谈判。

### 3.3 安全不变量

转换完成后必须同时满足：

- `clubs.is_cpu=1`；
- `clubs.name` 以半角 `(CPU)` 结尾；
- 赛事系统 `team.name` 以半角 `(CPU)` 结尾（tour 查无此队时允许缺失并给出警告）；
- 该队绑定账号数为 0；
- 没有 active 谈判/挂牌/报价/待审过户；
- 合同与球员归属未被改动。

## 4. 现状证据

### 4.1 已有可复用件

- 赛事改名：`pushTeamRename`，失败不写本仓；现有 `rename-tour` 已示范。
- 本仓改名：`UPDATE clubs SET name=?, is_cpu=... WHERE id=? AND is_cpu=...`。
- 解绑：`src/worker/authClient.ts:75-77` 的 `authUnbindTeam(env, accountId)`；管理端 `POST /bindings/unbind` 在 `src/worker/routes/admin/clubs.ts:662-690`。
- 审计：`writeAudit`；现有动作 `club_cpu_rename_tour`、`club_cpu_rename_local`、`club_unbind`。
- 预检聚合：`GET /clubs/:id/cpu-convert` 的查询结构可镜像。

### 4.2 需要补的缺口

1. **教练鉴权**：`requireCoach` 只看绑定（`src/lib/session.ts:218-240`）；`getBoundClub` 也不看 `is_cpu`（`src/worker/binding.ts:65`）。
2. **批量解绑**：现有向导只 `LIMIT 1` 展示绑定人（`src/worker/routes/admin/clubs.ts:452`）；实际一个队可挂多个账号（生产里昂 66 有 2 个）。
3. **未使用绑定码**：`team_bind_code` 最长 30 天有效；`/clubs/bind` 烧码后不检查目标队是否 CPU（`src/worker/routes/clubs.ts:654-690`）。
4. **双口径**：平台用 `clubs.is_cpu`；tour/成长用 `isCpuTeam` 看队名后缀（`src/worker/growth.ts:298-304`）；迁移 `src/db/migrations/0026_clubs_is_cpu.sql` 也是按后缀回填。
5. **在途状态**：`window-machine.ts:434-448` 用 active 谈判阻止关窗；`offers.ts:165` 禁止 CPU 卖方走报价；`transfers.status='pending_review'` 会留下无法处理的待审单。
6. **跨系统原子性**：D1 + TOUR HTTP + AUTH HTTP，没有分布式事务；现有接管也是分步、可重试。

### 4.3 `is_cpu` 的行为面

- `src/worker/window-payroll.ts:92`：CPU 不扣工资/税；
- `src/worker/prizes.ts:70-71`：CPU 不发奖金/主场收入；
- `src/worker/growth.ts:296-315`：CPU 比赛不计成长；
- `src/worker/demand-ops.ts:190`：需求单只给真人队；
- `src/worker/notify.ts:293`：站内信/QQ 只通知真人队；
- `src/worker/routes/admin/vouchers.ts:46`：消费券只发真人队；
- `src/worker/offers.ts:165`：CPU 卖方不能走报价；
- `src/worker/workbench.ts`：工作台隐藏 CPU 队。

### 4.4 生产快照（2026-11-11 只读）

- CPU 队仅 2 支：`10 曼城(CPU)`、`131681 AC米兰(CPU)`；均 `is_cpu=1`、0 合同、0 余额、27/24 名球员，是空壳。
- 16 支球队有绑定；最多 2 个账号（里昂 66）。
- 0 条 active 挂牌、0 条 pending 报价、0 条待处理需求；1 场 active 谈判（巴塞罗那 241 / Rodri，`rc_change`，已完成）。
- 接管先例：241/112172 于 2026-10-04 由四步向导完成；无反向先例。
- `club_unbind` 全库仅 1 条历史（球队 449 / 账号 10，2026-10-29），批量解绑未在生产验证。

## 5. 方案总览

```
P0 安全守卫
  ├─ requireCoach：CPU 队不可执教
  └─ /clubs/bind：CPU 队的码绑定后立即回滚

五步向导
  ① 预检（只读）
  ② 赛事侧改名（tour）
  ③ 本仓改名 + is_cpu=1
  ④ 批量解绑全部账号
  ⑤ 复核（再跑一次预检）
```

`is_cpu=1` 在第③步落库；在第④步之前，原教练已经被 P0 守卫挡住。即使解绑部分失败，也不会留下可操作的教练入口。

## 6. 后端设计

### 6.1 P0：教练鉴权守卫

`src/worker/binding.ts`：

- `BoundClub` 增加 `is_cpu: number`；
- `getBoundClub` 的 SELECT 补 `is_cpu`；
- 增加请求级记忆化（同请求内 `requireCoach` 与后续 `getBoundClub` 只查一次）。

`src/lib/session.ts`：

- `requireCoach` 在确认已绑定后取绑定俱乐部；
- 若 `club.is_cpu === 1`，抛 `HttpError(403, '该队已转为 CPU 队，请联系管理组')`；
- 管理端 `requireAdmin` 分支在此前返回，不受影响。

注意：

- 不要把 `is_cpu` 过滤塞进 `getBoundClub` 本身；管理端解绑预查仍需要拿到 CPU 队。
- 守卫是行为收紧；生产现有 CPU 队 0 绑定，不会误伤。
- 每个教练请求多一次本地 D1 读；用请求级记忆化把同一请求压到一次。

### 6.2 P0：绑定码守卫

`src/worker/routes/clubs.ts` 的 `POST /clubs/bind`：

1. `authBindTeam` 成功后拿到 `teamId`；
2. 直接查 `AUTH_DB.team` 的 `club_id`（不要复用 `getTeamBinding` 的请求内缓存——绑定前可能已缓存 `bound=false`）；
3. 查 `clubs.is_cpu`；
4. 若为 1：
   - 调 `authUnbindTeam` 回滚；
   - 写审计 `club_bind_rejected_cpu`；
   - 返回 409 `{ error: 'cpu_club', message: '该队已转为 CPU 队，不能绑定' }`。

如果回滚失败：返回 502 并说明「绑定已建立但解绑失败，请联系管理组」；P0 守卫仍会挡住教练操作。

### 6.3 契约类型

在 `src/contract/batch4.ts` 新增：

```ts
export interface CpuDetachBlocker {
  key: string;
  label: string;
  detail: string;
}

export interface CpuDetachState {
  club: { id: number; name: string; isCpu: boolean; leagueTier: string | null; status: string };
  tour: { id: number; name: string } | null;
  bindings: { userId: number; userName: string | null; boundAt: string }[];
  unusedCodes: { expiresAt: string | null; createdAt: string }[];
  contracts: { active: number; total: number };
  players: number;
  balance: number;
  suggest: { newName: string; nameError: string | null };
  blockers: CpuDetachBlocker[];
  warnings: CpuDetachBlocker[];
  checks: {
    isCpu: boolean;
    tourName: boolean;
    localName: boolean;
    bindings: boolean;
    codes: boolean;
  };
  ready: boolean;
}

export interface CpuDetachRenameTourResult {
  ok: boolean;
  renamed: boolean;
  name: string;
}

export interface CpuDetachRenameLocalResult {
  ok: boolean;
  changed: boolean;
  flipped: boolean;
  name: string;
}

export interface CpuDetachUnbindResult {
  ok: boolean;
  unbound: number[];
  alreadyUnbound: number[];
  failed: { userId: number; code: string; message: string }[];
}
```

`web/src/lib/api.ts` 重导出这些类型；`web/src/lib/adminQueries.ts` 增加：

```ts
export const CPU_DETACH_KEY = (id: number) => ['admin', 'cpu-detach', id] as const;
export async function fetchCpuDetach(id: number): Promise<CpuDetachState> {
  return api<CpuDetachState>(`/api/admin/clubs/${id}/to-cpu`);
}
```

### 6.4 预检

`GET /api/admin/clubs/:id/to-cpu`，权限 `club.clubs.manage`。

查询：

- `clubs`：id/name/is_cpu/league_tier/status；
- `TOUR_DB.team`：id/name；
- AUTH_DB 全部绑定（`team_binding` join `team`/`account`）；未配置 AUTH_DB 时回落 `club_bindings`；
- AUTH_DB 未使用且未过期的 `team_bind_code`（`used_at IS NULL AND expires_at > now`）；取不到时 `unusedCodes=[]` 并加 warning；
- `contracts`：该队合同总数/active 数；
- `players`：该队球员数；
- `ledger_accounts.balance`；
- 阻断项：active 谈判、未终态挂牌、pending/intent 报价、`pending_review` 过户、open review_tasks；
- 名字：默认 `当前名 + '(CPU)'`（已带后缀则不变），校验 40 字与 UNIQUE。

`blockers` 为空才 `ready=true`。

### 6.5 写操作

#### ① 赛事侧改名

`POST /api/admin/clubs/:id/to-cpu/rename-tour`，权限 `club.clubs.manage`。

- body `{ name: string }`；
- 服务端强制 `name.endsWith('(CPU)')`，长度 ≤ 40；
- 调 `pushTeamRename`；
- 失败 502，本仓零改动；
- 成功写审计 `club_cpu_detach_tour`，`after: { from, to }`；
- 幂等：tour 名已经是目标名，返回 `renamed:false`。

#### ② 本仓改名 + 置 CPU

`POST /api/admin/clubs/:id/to-cpu/rename-local`，权限 `club.clubs.manage`。

- body `{ name: string }`；
- 服务端强制后缀与长度；
- SQL 带 `NOT EXISTS` 阻断条件，避免「预检后、更新前」插入在途单：

```sql
UPDATE clubs
SET name = ?, is_cpu = 1
WHERE id = ? AND is_cpu = 0
  AND NOT EXISTS (SELECT 1 FROM negotiation_sessions s WHERE s.club_id = ? AND s.status = 'active')
  AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.seller_club_id = ? AND l.status IN ('active','matched_pending'))
  AND NOT EXISTS (
    SELECT 1 FROM offers o
    WHERE (o.buyer_club_id = ? OR o.seller_club_id = ?)
      AND o.status IN ('pending','intent')
  )
  AND NOT EXISTS (SELECT 1 FROM transfers t WHERE (t.from_club_id = ? OR t.to_club_id = ?) AND t.status = 'pending_review')
```

（实际 SQL 以各表真实状态值为准，实现时把状态集合收敛到一处常量。）

- `changes=0` 时重查预检：若已是 CPU 且名字相同，返回 `changed:false, flipped:false`；否则 409 `blocked`，带 blockers。
- 撞 `clubs.name` UNIQUE 回 409 `name_taken`。
- 成功写审计 `club_cpu_detach_local`，`after: { from, to, isCpu: 1 }`。
- 若 `is_cpu=1` 但名字不匹配（修复场景），允许只改名字，返回 `changed:true, flipped:false`；不能借此绕过阻断项。

#### ③ 批量解绑

`POST /api/admin/clubs/:id/to-cpu/unbind-all`，权限 `club.bindings.unbind`。

- 执行时重新查全部绑定，不信预检快照；
- 逐个 `authUnbindTeam`；
- 成功进 `unbound`，`not_bound` 进 `alreadyUnbound`，其他错误进 `failed`；
- 每成功一个写审计 `club_cpu_detach_unbind`，`before: { userId }`；
- 返回 `{ ok: failed.length === 0, ... }`；部分失败不回滚已解绑账号，允许重试。

### 6.6 复核

复用 `GET /clubs/:id/to-cpu`：

- `checks.isCpu`：`is_cpu=1`；
- `checks.tourName`：tour 名为 null 或后缀正确；
- `checks.localName`：本仓名后缀正确；
- `checks.bindings`：绑定数 0；
- `checks.codes`：无未使用未过期码（或仅 warning）；
- `ready = 所有硬性 checks 为 true 且 blockers 为空`。

## 7. UI 设计

### 7.1 入口

`web/src/pages/admin/ClubsPage.tsx:319` 附近：

- 现有：`club.isCpu` 显示「接管向导」；
- 新增：`!club.isCpu` 显示「转 CPU」，链接 `/admin/clubs/to-cpu?id=${club.id}`。

路由加在 `web/src/App.tsx:207` 附近：

```tsx
<Route path="clubs/to-cpu" element={<AdminToCpuPage />} />
```

### 7.2 页面

新建 `web/src/pages/admin/ToCpuPage.tsx`，镜像 `CpuConvertPage.tsx`：

- 无 id：列出 `!isCpu` 的人类队选择器；
- 有 id：五步向导。

步骤卡：

1. **预检**：显示俱乐部、tour 队名、全部绑定人、合同/球员数、余额、阻断项、警告；有阻断时后续按钮禁用。
2. **赛事侧改名**：默认建议名 `xxx(CPU)`；允许编辑，但提交时服务端强制后缀；失败可重试。
3. **本仓改名 + 置 CPU**：`ConfirmButton` 二次确认；确认框写明「保留阵容和合同；转 CPU 后球员可被海捞，且 CPU 不收转会费」。
4. **批量解绑**：列出全部绑定账号；确认后一次解绑；部分失败逐行显示并可重试。
5. **复核**：展示五项检查和最终 `ready`。

查询键：`CPU_DETACH_KEY(id)`；动作后 invalidate `CPU_DETACH_KEY`、`ADMIN_CLUBS_KEY`，必要时 invalidate 总览。

### 7.3 权限提示

- 预检/改名：`club.clubs.manage`；
- 解绑：`club.bindings.unbind`；
- 如果当前账号缺少解绑权限，第 4 步显示禁用和说明，不假装成功。

## 8. 失败处理与回滚

| 失败点 | 状态 | 处理 |
|---|---|---|
| ① 预检有阻断 | 未写 | 先清在途，重新预检 |
| ② tour 改名失败 | 本仓未动 | 重试；tour 侧失败不落本仓 |
| ② 成功、③ 失败 | tour 已 CPU、本仓仍人类 | 重试③；短窗口内成长/通知已停、工资/奖金仍按人类队 |
| ③ 成功、④ 部分失败 | 本仓已 CPU、部分账号仍绑定 | 教练被 P0 守卫挡住；重试④ |
| ⑤ 复核失败 | 已写 | 按 checks 逐项修复；必要时用接管向导回滚 |

回滚到人类队：

1. 赛事侧改名去 `(CPU)`；
2. 本仓改名并 `is_cpu=0`；
3. `seed-ops` 已存在会 no-op；
4. 发码重新绑定。

合同和阵容一直在，不需要数据恢复。

## 9. 测试计划

### 纯逻辑

- `cpuSuffixName`：已带后缀不重复、40 字边界、空格/全角括号、空名。

### 路由

新增 `tests/cpu-detach.test.ts`：

- 预检：2 个绑定、active 谈判、未终态挂牌、pending/intent 报价、待审过户分别命中阻断。
- 干净队：`ready=true`，建议名正确。
- 赛事改名：失败时本仓 `is_cpu`/名字不变；成功写审计。
- 本仓改名：撞名 409；重放 `changed=false`；阻断条件命中时 `changes=0` 且返回 blockers。
- 解绑：0/1/2 个绑定；`not_bound` 视为已解绑；一个 502 时部分成功、可重试。
- 复核：`is_cpu=1`、两侧名后缀、绑定 0。

### 守卫

- CPU 绑定教练访问 `/api/me/club` 和任一教练端点 → 403。
- 管理端解绑 CPU 队仍 200。
- `/clubs/bind` 用 CPU 队的码 → 409，且回滚为未绑定。
- 人类队绑定不受影响。

### UI

`web/src/pages/admin/ToCpuPage.test.tsx`，镜像 `CpuConvertPage.test.tsx`：

- 人类队入口存在、CPU 队入口不存在；
- 阻断项禁用后续按钮；
- 部分解绑失败展示；
- 复核五项通过。

### 最坏情况

- 2 个绑定 + 40 字队名 + 30 份合同 + active 谈判；
- 解绑一个失败；
- 预检 D1 读量约 10 条；教练守卫每请求多 1 条 D1 读（请求内记忆化）；
- 批量解绑 N 个账号，生产最多 2 个，代码上限设 10。

### 命令

- `npm run typecheck`
- `npm test`
- `npm run build`
- code-review-skill 审查

## 10. 上线顺序

1. P0 守卫（`binding.ts`、`session.ts`、`/clubs/bind`）+ 测试，先上线；
2. 预检/改名/解绑端点 + 契约类型；
3. `ToCpuPage` + 入口 + 测试；
4. 文档、ROADMAP/CHANGELOG；
5. 首次生产转换由管理端手动执行，需用户单独下令。

无 D1 迁移；代码回滚安全。

## 11. 后续增强

- 认证中心增加「撤销未使用绑定码」接口，替代平台侧绑定守卫；
- 可选「强制转」模式：自动撤单、退款、终止谈判，需要独立设计与补偿；
- 转换前给绑定教练发站内信/QQ 通知（本期不做，避免误发）；
- 批量转换多个队（本期不做）。

## 附录 A：生产事实

| 项 | 值 |
|---|---|
| CPU 队 | 10 曼城(CPU)、131681 AC米兰(CPU) |
| CPU 队合同 | 0 |
| CPU 队余额 | 0 |
| CPU 队球员 | 27 / 24 |
| 有绑定的队 | 16 |
| 单队最多绑定 | 2（里昂 66） |
| active 挂牌 | 0 |
| pending 报价 | 0 |
| 待处理需求 | 0 |
| active 谈判 | 1（巴塞罗那 241 / Rodri，rc_change） |
| 接管先例 | 241/112172，2026-10-04 |
| 反向先例 | 无 |
| `club_unbind` 历史 | 1 条（449 / 账号 10，2026-10-29） |
