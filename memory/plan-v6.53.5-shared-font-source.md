# 实施计划 · v6.53.5 字体源切换到平台共享源（探索B · 阶段 1 = club）

> 设计依据：`docs/superpowers/specs/2026-10-24-shared-font-source-design.md`（rev1），本计划按其 §8 各仓切换清单、§9 落地阶段（阶段 1）、§10 验收口径落成 club 仓执行件。
> 判级 **patch**（纯展示层：`@font-face` 的 `src` ×5 与 preload ×1 换绝对 URL；零端点、零迁移、零业务规则、零字体文件增删）。
> **状态：本地提交完成；R2 阶段 0（建桶 / 对象 put / CORS / 绑域）与 push 均未执行**——`fonts.whleague.win` 域名尚未建立，本地不可解析是预期，不是缺陷。

## 1. 目标

- club 仓字体从「本仓 `web/public/fonts/` 自托管」切到平台共享源 **`https://fonts.whleague.win/v1/`**（R2 桶 `whl-fonts` + 自定义域，设计稿 ADR-1/B1）。
- 衬线从 club 单仓子集换**四仓并集单文件** `noto-serif-sc-600-union.woff2`（ADR-2；330,604 B / 2389 字 vs 单仓 298,088 B / 2187 字，只多 4.5% 字）。
- 打开「同顶层站点共享 HTTP 缓存」收益面：四站全访首次字体 1.43MB → 约 0.47MB（§7）。club 是四仓中第一个切换（§9 阶段 1），tour / guess / auth 后续各自跟。
- 本地 woff2 **保留不删**（阶段 4 清理另轮授权），`git revert` 即回本地自托管。

## 2. 交付物（6 文件，一枚提交）

| 文件 | 改动 |
|---|---|
| `web/src/styles.css` | 5 条 `@font-face` 的 `src` 换 `https://fonts.whleague.win/v1/…`（衬线文件名换 `noto-serif-sc-600-union.woff2`，其余四件同名）；`unicode-range` / `font-weight` 区间 / `font-display: swap` 原样保留、仍无 `local()`；文件头注释加版本锚「字体版本：v1（升级时全局替换 fonts.whleague.win/v1/）」并改指 `scripts/platform-fonts/README.md` |
| `web/index.html` | `inter-latin` preload 的 `href` 换绝对 URL，`crossorigin` 保留（字体天然 CORS 模式，缺失即双下载）；注释字节数 298KB → 331KB（union） |
| `package.json` | 6.53.4 → **6.53.5** |
| `CHANGELOG.md` | v6.53.5 条目，标注「待上线：R2 阶段 0 远程动作与 push 未执行」 |
| `memory/plan-v6.53.5-shared-font-source.md` | 本文件 |
| `docs/test-plans/v6.53.5-shared-font-source.md` | 测试计划（qa-test-planner 口径） |

**不改**：`web/public/fonts/`（本地副本全保留）；`tests/`（club 无字体断言，§8「无字体测试联动」）；`src/lib/oidc.ts` 与 `tests/oidc.test.ts`（他人在途改动，不碰）；`scripts/build-platform-fonts.py` 与 `scripts/platform-fonts/`（前序提交 d646fb1 / 9560586 已落）。

## 3. 步骤

1. 通读设计稿 §5（终态架构）、§8（各仓差异）、§9（阶段）、§10（验收）。
2. `styles.css` 头注释 + 5 条 `src` 换 URL；`index.html` preload 换 URL。
3. 版本 patch +1（6.53.4 → 6.53.5，以 package.json 文件现状为准）。
4. CHANGELOG 条目 + 计划文件 + 测试计划文件。
5. 全量 test / typecheck / build 由**工作流脚本统一跑**（本会话不自行跑全量套件）。
6. 只 `git add` 上述 6 文件，提交 `feat(ui): 字体源切换到平台共享源 fonts.whleague.win/v1（待上线）`。**不 push**（push 即上线，且域名未建时上线会让字体 404/530 落回退栈——虽不破相（TC-4 兜底），但白白吃一次降级窗口）。
7. 域名上线顺序（后续轮次）：先走 `scripts/platform-fonts/README.md` 阶段 0 runbook（① 建桶 → ② put 9 件 → ③ CORS → ④ 绑域 → ⑤ 只读验收 TC-0 系列）→ TC-0 全绿 → 再 push 本提交。

## 4. 验收口径（最坏情况优先，摘自 §10；详表见测试计划）

- **结构锁（本地可验，随全量套件）**：`@font-face` 与 preload 全部命中 `^https://fonts\.whleague\.win/v1/` 且 5 条版本一致；`swap` / 无 `local()` / preload 只 inter-latin 且带 `crossorigin` 的既有断言口径保留（club 本无字体断言，此口径登记进测试计划，待域名上线后随 e2e 补实测）。
- **TC-0a/b/d（域名上线后，只读）**：`/v1/inter-latin.woff2` 三头（`access-control-allow-origin: *` / `cache-control: public, max-age=31536000, immutable` / `content-type: font/woff2`）、二次请求 `cf-cache-status: HIT`；带 Origin 跨源 GET 回 ACAO `*`；OFL 三件 200。
- **TC-1（核心收益证据）**：清缓存访问 club（下 4+1 件）→ DevTools 证 inter-latin 是网络请求；四仓切完后第二站起共享字体显示 `(disk cache)`。
- **TC-2**：preload 双下载检查——network 面板 inter-latin 只一条请求。
- **TC-3**：普通页面无 `inter-latin-ext` 请求（懒加载不回归）。
- **TC-4（最坏）**：共享源整体不可用（当前域名未建即是活体场景）→ club 全站可读，标题落 `SimSun` 逐字回退（仍是衬线）、正文系统黑体、数字回退等宽栈，无 FOIT、无布局破相。
- **线上回读（push 后）**：线上入口 CSS 含 5 条 `fonts.whleague.win/v1/` URL；页脚 v6.53.5；`/api/health` 200。

## 5. 风险边界

- **域名未建窗口期即最坏场景 TC-4 的活体**：若本提交在阶段 0 之前被 push 上线，四站字体全部落回退栈（`swap` + 多级回退，无阻塞渲染路径）；不破相但有降级窗口——所以 push 严格排在 TC-0 全绿之后。
- **CORS 配错**（§11）：字体不加载 + 控制台报错，页面照常可读；面板重配即愈，无需部署。
- **union 漏字**：新文案含新汉字未重跑 `build-platform-fonts.py` → 标题逐字回退 `SimSun`（club F5 既有口径，仍衬线）；重跑升 `/v2/` 即愈，老 `/v1/` 常驻不删（ADR-4 回滚面）。
- **四仓版本漂移**：允许短暂不齐（§5.4），漂移仓只是不参与跨站复用，无正确性影响。
- **明确不做**（§12）：不删本地 woff2（阶段 4 另轮）、不动 `--font-*` 令牌与回退栈、不做 metric-matched fallback、不做 CJK unicode-range 切片（union 330KB 远低于 600KB 触发线）。
- **测试断言不得访问 `fonts.whleague.win`**：域名未建，本地不可解析是预期；相关断言只做静态结构锁（URL 前缀 + 版本一致性），网络类 TC 全部标记「待域名上线后执行」。
