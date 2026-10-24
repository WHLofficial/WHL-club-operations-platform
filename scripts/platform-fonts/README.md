# 平台字体（共享字体源 · 探索B）

四仓（club / tour / guess / auth）共享的字体唯一真源：衬线 union 子集 + Inter / JetBrains Mono + OFL 许可，统一在本目录生成、按版本目录（`output/v1/`）发布到共享源。设计依据：`docs/superpowers/specs/2026-10-24-shared-font-source-design.md`（§5.2 桶布局、§6 union 裁决数据、ADR-6 管线收敛）。

## 产物（output/v1/，已 gitignore）

| 文件 | 说明 |
|---|---|
| `noto-serif-sc-600-union.woff2` | Noto Serif SC 600 四仓并集子集（`scripts/build-platform-fonts.py` 生成） |
| `inter-latin.woff2` / `inter-latin-ext.woff2` | 正文拉丁（100–900 变量），`@fontsource-variable/inter@5.2.5` 原样拷贝自 `web/public/fonts/` |
| `jbmono-latin.woff2` / `jbmono-latin-ext.woff2` | 数字等宽（100–800 变量），`@fontsource-variable/jetbrains-mono@5.2.5` 原样拷贝 |
| `OFL-NotoSerifSC.txt` / `OFL-Inter.txt` / `OFL-JetBrainsMono.txt` | 三族 SIL OFL 1.1 许可全文（OFL 要求分发时附带，上传共享源时一并传） |
| `chars.txt` | union 字符表（子集化输入，覆盖性验收用） |
| `MANIFEST.json` | 每文件 sha256 / 字节数 / content-type / 说明，及字符总数与 CJK 计数、生成日期 |

## union 字符集口径

- 四仓源码扫描并集：glob 逐仓照抄各仓现脚本（club `build-serif-subset.py`、tour / guess 各自 `build-fonts.py`），auth 仓并入其 `src/**/*.ts`；
- + 生产 20 支中文球队名 + Latin-1 / Latin Extended-A（`U+0020–U+024F`）+ 常用中文标点（口径同 club 现脚本）；
- 四仓默认按 sibling 布局取 `C:/Users/bhdjb/whlProgram/` 下四仓，可用 `--club-root` 等参数覆盖（ADR-6 假设）。

## 重新生成

```bash
pip install fonttools brotli
python scripts/build-platform-fonts.py                 # 首次会从 jsDelivr 下载 14.8MB TTF 到 scripts/.font-cache/
python scripts/build-platform-fonts.py --skip-download # 离线：缓存缺失即报错，不联网
```

衬线 union 重跑触发：任一仓新增界面文案含新汉字（球队改名 / 新功能）→ 重跑 → 产物进 `output/v<N+1>/`（**内容变即升版本，不改写老版本路径**，ADR-4）→ 各仓 CSS 版本常量跟升。缺字兜底不变：标题逐字回落 `SimSun`。

## 许可

三族均为 SIL Open Font License 1.1：允许子集化与自托管/共享源分发（须随附许可与版权声明，即上面的三份 `OFL-*.txt`），不得单独售卖字体。

## 上传 runbook（阶段 0 · 基建）

> ①–③ 都是 **R2 remote 写操作**，执行前须获用户明确授权（本仓危险清单：任何 `--remote` 写）。旗标拼写已于 2026-10-25 对 `wrangler 4.131.1` 的 `--help` 文本逐一核实（`npx wrangler r2 object put --help` / `npx wrangler r2 bucket cors --help` / `npx wrangler r2 bucket create --help`）；凡未在 `--help` 里出现的旗标或面板路径，一律标「未验证」。产物字节口径见 `output/v1/MANIFEST.json`（v1 实测：union woff2 330,604 B，字符集 2389 / CJK 1697，2026-10-25 生成）。

### ① 建桶

```bash
npx wrangler r2 bucket create whl-fonts
```

`--location`（choices: `weur` / `eeur` / `apac` / `wnam` / `enam` / `oc`）已核实可省略，省略走账户默认。

### ② 对象逐件 put（设计稿 §5.2 桶布局共 **9 件**）

注：对象清单以设计稿 §5.2 桶布局为准，共 **9 件** = 5 woff2 + 3 OFL + MANIFEST.json；`chars.txt` 是本地覆盖性审计工件，桶布局不含它，**不上传**。woff2 的 `content-type` 用 `font/woff2`，OFL 三件与 MANIFEST.json 用 `text/plain`（与 MANIFEST 自记口径一致）；`cache-control` 全部 `public, max-age=31536000, immutable`（put 时写入对象元数据，事后改不了）。`--remote` 为 `--help` 已核实旗标，显式写明以免误投本地。

```bash
# woff2 ×5（font/woff2）
npx wrangler r2 object put whl-fonts/v1/noto-serif-sc-600-union.woff2 --file scripts/platform-fonts/output/v1/noto-serif-sc-600-union.woff2 --content-type font/woff2 --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/inter-latin.woff2        --file scripts/platform-fonts/output/v1/inter-latin.woff2        --content-type font/woff2 --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/inter-latin-ext.woff2    --file scripts/platform-fonts/output/v1/inter-latin-ext.woff2    --content-type font/woff2 --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/jbmono-latin.woff2       --file scripts/platform-fonts/output/v1/jbmono-latin.woff2       --content-type font/woff2 --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/jbmono-latin-ext.woff2   --file scripts/platform-fonts/output/v1/jbmono-latin-ext.woff2   --content-type font/woff2 --cache-control "public, max-age=31536000, immutable" --remote
# OFL ×3 + MANIFEST.json（text/plain）
npx wrangler r2 object put whl-fonts/v1/OFL-NotoSerifSC.txt     --file scripts/platform-fonts/output/v1/OFL-NotoSerifSC.txt     --content-type text/plain --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/OFL-Inter.txt           --file scripts/platform-fonts/output/v1/OFL-Inter.txt           --content-type text/plain --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/OFL-JetBrainsMono.txt   --file scripts/platform-fonts/output/v1/OFL-JetBrainsMono.txt   --content-type text/plain --cache-control "public, max-age=31536000, immutable" --remote
npx wrangler r2 object put whl-fonts/v1/MANIFEST.json           --file scripts/platform-fonts/output/v1/MANIFEST.json           --content-type text/plain --cache-control "public, max-age=31536000, immutable" --remote
```

（`--content-type` 缩写 `--ct`、`--cache-control` 缩写 `--cc` 已核实；`-f` 是 `--file` 的缩写。）

### ③ 桶 CORS

配置文件即本目录 `cors.json`（`AllowedOrigins: ["*"]` + `AllowedMethods: ["GET"]`，字体加载是无凭据简单请求，够了）：

```bash
npx wrangler r2 bucket cors set whl-fonts --file scripts/platform-fonts/cors.json
```

`--file` 必填、`-y`（跳确认）与 `-J`（jurisdiction）均已核实。**已知坑**：wrangler 对 CORS 配置文件有校验 bug（设计稿 §9 步骤 4 引的 issue），合法 JSON 也可能报错——失败就改走面板：R2 → `whl-fonts` → Settings → CORS Policy → 手工贴 `cors.json` 内容（面板路径以当前 UI 为准，「未验证」）。配完只读核对：`npx wrangler r2 bucket cors list whl-fonts`（只读，无授权顾虑）。

### ④ 面板绑自定义域 `fonts.whleague.win`

r2.dev 与 S3 API 端点**不走边缘缓存**，对象级 `Cache-Control` 不生效（设计稿 §4），必须自定义域。面板步骤（路径以当前 UI 为准，「未验证」）：

1. Cloudflare Dashboard → R2 → `whl-fonts` → Settings → Custom Domains → **Connect Domain**；
2. 填 `fonts.whleague.win`（须是本账户 zone 下的子域，DNS 记录由面板自动建）；
3. 等状态变 Active（证书签发通常几分钟）。

### ⑤ 验证（只读）

```bash
# 三头 + 边缘缓存命中（§5.3 契约 / TC-0a）
curl -sI https://fonts.whleague.win/v1/inter-latin.woff2
curl -sI https://fonts.whleague.win/v1/inter-latin.woff2   # 第二次请求，cf-cache-status 应为 HIT
# CORS 头要带 Origin 才回（TC-0b）
curl -sI -H "Origin: https://club.whleague.win" https://fonts.whleague.win/v1/inter-latin.woff2
# OFL 公开可达（TC-0d）
curl -sI https://fonts.whleague.win/v1/OFL-NotoSerifSC.txt
# MANIFEST 对账：线上 MANIFEST.json 与本地逐字段一致
curl -s https://fonts.whleague.win/v1/MANIFEST.json
```

逐条核：`access-control-allow-origin: *`（带 Origin 的请求）、`cache-control: public, max-age=31536000, immutable`、`content-type: font/woff2`（OFL 为 `text/plain`）、第二次请求 `cf-cache-status: HIT`。覆盖性（TC-0c）已在上传前本地完成（13 串抽样逐字在 `chars.txt`，含三仓文案与 2 个中文队名）；浏览器无豆腐验证随各仓切换阶段做。

### ⑥ 回滚口径

- **老版本路径常驻**（ADR-3/ADR-4）：`/v1/` 内容永不变、永不删除，发布新版进 `/v2/`。某仓升版后异常，把该仓 CSS 的版本常量改回 `/v1/` 即完成回滚，无需重传任何对象。
- **各仓回滚**：阶段 4（删本地 woff2）之前，`git revert` 该仓切换提交即回本地自托管；阶段 4 之后 = revert + 恢复字体文件（git 历史里都有，设计稿 §9）。
- **桶级**：CORS 配错可改 `cors.json` 重跑 ③，或 `npx wrangler r2 bucket cors delete whl-fonts`（子命令已核实存在）后重配；自定义域在面板 Settings → Custom Domains 解绑。删桶不在 runbook 范围（破坏性操作，另行走授权）。
