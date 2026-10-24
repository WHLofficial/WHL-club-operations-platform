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

## 上传 runbook（占位，待补全）

> 本小节由下一位补全：`whl-fonts` 桶创建、`wrangler r2 object put` 逐文件命令（含 `--content-type` / `--cache-control "public, max-age=31536000, immutable"`）、桶 CORS 配置、`fonts.whleague.win` 自定义域绑定，与上传后的只读验收（设计稿 §5.3 响应头契约、§10 TC-0 系列）。**在补全并获授权前，不执行任何 R2 写操作。**
