# 实施计划 · v6.53.2 字体方案（选型 → 落地）

> 用户口径（m00004）：「给这个中文 Web 应用定一套字体方案，从选型到落地」。
> 判级 **patch**（纯展示层：换字体、加字体资产与加载声明；无新端点、无迁移、无业务规则改动）。
> 本文件记录**已做的裁决**与验收数字；不写实现代码。执行者不需要参与过选型访谈。

---

## 1. 选型裁决

| # | 问题 | 裁决 | 理由 |
|---|---|---|---|
| F1 | 标题用什么 | **Noto Serif SC 600** 自托管子集 + 系统宋体回退 | 视觉母题是「复古档案室 / 合同卷宗」；22px 页面标题、17.5px 卡片标题下宋体笔画清楚。系统自带宋体（SimSun）在 22px 尚可、在 17px 已发虚，故自托管 |
| F2 | 正文中文用什么 | **系统黑体**（PingFang SC / Microsoft YaHei UI / Noto Sans SC），不自托管 | 中文正文子集也要 300KB+；而正文是首屏最大文本块，为「换掉雅黑」付这个代价不划算。12–13px 密集表格下系统字体的 hinting 最稳 |
| F3 | 正文西文用什么 | **Inter**（自托管，只覆盖拉丁） | 数字、球员英文名、`CA/PA` 缩写出现频率高；Inter 的 x-height 与雅黑接近，中英混排不跳 |
| F4 | 数字用什么 | **JetBrains Mono**（自托管变量字体），放栈首 | 原栈 `ui-monospace` 在第一位，JetBrains 永远轮不到（即便安装/自托管）。v6.53.2 起 `--font-mono` 把 JetBrains 放最前，`--mono` 作旧名别名 |
| F5 | 中文标点缺失怎么办 | 允许逐字回退到 `SimSun` | 子集只覆盖站点实际用字；新增生僻字时标题掉到宋体系回退，仍是衬线，不会变黑体。再生成脚本见 `web/public/fonts/README.md` |
| F6 | 要不要给中文正文做网络字体 | **不做** | 与 F2 同因；品牌辨识度由「标题宋体 + 数字等宽 + 奶油纸」承担 |
| F7 | preload 哪些 | 只 preload `inter-latin.woff2`（48KB） | 正文拉丁首屏必用；298KB 宋体子集不跟首屏 JS 抢带宽，交给 CSS 发现 + `swap` |
| F8 | 字体来源与许可 | 三个字体族都自托管，均 **OFL-1.1** | 仓库无字体依赖；OFL 允许子集化与自托管（保留许可与版权声明） |

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `web/src/styles.css` | 顶部 5 条 `@font-face`（宋体 600 一条、Inter latin/latin-ext 两条、JetBrains Mono latin/latin-ext 两条，全部 `swap`）；`:root` 新增 `--font-display` / `--font-sans` / `--font-mono`，`--mono` 改为 `var(--font-mono)`；`body` 的 `font-family` 改 `var(--font-sans)`；新增 `h1,h2,h3 { font-family: var(--font-display); font-weight: 600 }` |
| `web/index.html` | 新增一条 `<link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>` |
| `web/public/fonts/` | 5 个 woff2：`noto-serif-sc-600-subset.woff2` 298,088 B、`inter-latin.woff2` 48,444 B、`inter-latin-ext.woff2` 74,328 B、`jbmono-latin.woff2` 40,404 B、`jbmono-latin-ext.woff2` 15,196 B；3 份 OFL 许可；`README.md`（来源 / 再生成 / 许可） |
| `scripts/build-serif-subset.py` | 新增：下载 600 TTF → 扫 `web/src` + `src` + 生产 20 队名 + Latin 区段 + 标点 → `pyftsubset` 出 woff2（2187 字，其中 CJK 1526） |
| `.gitignore` | 忽略 `scripts/.font-cache/`（14.8MB 原 TTF 与字符表） |
| `UI_DESIGN.md` | 令牌表补三行字体令牌；新增 §7 字体系统（角色 / 文件 / 加载策略 / 两条硬约束） |
| `package.json` | 6.53.1 → **6.53.2** |

## 3. 实现细节（照做即可复现）

1. **子集命令**：`python -m fontTools.subset NotoSerifSC_600SemiBold.ttf --text-file=chars.txt --output-file=... --flavor=woff2 --layout-features=kern,liga,locl,ccmp --glyph-names --symbol-cmap --legacy-cmap --notdef-glyph --notdef-outline --recommended-glyphs`。实测产物 298,088 B；字体内部保留 `ccmp/kern/liga/locl` 四个特性（fonttools 读回核对）。
2. **`unicode-range`**：Inter / JetBrains 的 latin 与 latin-ext 用 fontsource 标准区间各写一条 `@font-face`；latin-ext 只在页面出现 `Š/Đ/Ł/ő` 时下载。
3. **字体族名**：沿用 `'Noto Serif SC'` / `'Inter'` / `'JetBrains Mono'`，`@font-face` 不带 `local()`，不会误用系统同名完整版。
4. **不要给标题写 700/800**：宋体子集只有 600 一档，合成粗体会糊；全站 h1–h3 统一 600。

## 4. 验收实测

- `npm run typecheck`：三份 tsconfig 全清（0 error）。
- `npm run test`：**144 文件 / 2390 例全绿**（字体改动不新增用例；无快照/字体断言）。
- `npm run test:e2e`：**29/29 场景通过**，含 ⑫ 全路由 375×812 零溢出扫描、㉑ 球员页 375 卡内不横滑（JetBrains 比原 `ui-monospace` 宽，未触发新横滑）。
- `npm run build`：成功；`dist/fonts/` 5 个 woff2 与 3 份 OFL 随 public 拷入。
- 截图对照（本地 1440 / 375，`/players`、`/players/:id`、`/clubs`、`/`、`/ledger`、`/market`）：标题换宋体后可读、无豆腐块；latin-ext 未命中时不下载。
- 已知量化副作用：Inter 比原 `Segoe UI` 略宽，球员库表格在 1440 下横向溢出比改造前多约 19px；该表本就靠 `.table-wrap` 横滚（最小宽 876px vs 桌面容器 854px），故属既有行为，不做列宽手术。

## 5. 待办 / 后续

- 球队改名、或界面新增生僻字后，跑一次 `python scripts/build-serif-subset.py`；不跑则标题掉到 `SimSun`（仍是衬线）。
- `.mono` 类在部分表格（球员库 UID/CA/PA）没有全局 `font-family`，是 v3.3.0 的既有收口，不在本轮改动范围；若日后要让「一切数字等宽」，需单独评估列宽。
- 若将来做 `font-display: optional` 或 metric-matched fallback，可再压 CLS；当前标题行高固定 1.6、CJK 字宽同为 1em，首屏未见明显跳动。

## 6. 收口补记（v6.53.4，2026-10-24）

用户反馈「注册工作台和阵容部分没有应用新字体选型」，排查结论是**方案已生效、原生控件未覆盖**：

- 线上 CSS `assets/index-a0t867je.css` 与本地 `web/dist` 逐字一致，`h1,h2,h3` 衬线规则与 `body` 的 `var(--font-sans)` 都在线；不是发布遗漏。
- `button` / `select` / `input` 不继承 `body` 字体，Windows 上落到 Arial（中文退标准雅黑、`▾` 退 Cambria Math）。CDP `CSS.getPlatformFontsForNode` 实测 `/clubs/1` 工作台 26 个控件里 13 个 Arial（11 颗 `.sqc-assign-btn` + 2 个 `select` + `input.mono`），阵容页签只有无文字图标按钮命中。
- 修法：`styles.css` 加 `button, input, select, textarea { font-family: inherit; }`；另给 `input.mono / textarea.mono / select.mono` 指定 `var(--mono)`。`span`/`td` 的 `.mono` 仍不设全局规则（列宽另评）。
- 复核：两页签 Arial 控件 13 → 0；`h3` 仍 `Noto Serif SC SemiBold`、`.sqc-v.num` 仍 `JetBrains Mono`；typecheck 0 error、vitest 144 文件 / 2390 例、e2e 29/29、build ✓。
- 口径未变：h4 及以下 13–14px 小标题保持黑体，衬线只在 17.5px 以上标题（UI_DESIGN §7.4）。
