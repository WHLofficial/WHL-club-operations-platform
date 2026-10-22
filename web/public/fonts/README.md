# 字体文件（v6.53.2）

标题宋体、正文西文、数字等宽三套角色；选型理由与加载策略见 [UI_DESIGN.md §7](../../../UI_DESIGN.md)。

| 文件 | 用途 | 来源 |
|---|---|---|
| `noto-serif-sc-600-subset.woff2` | 标题 `h1/h2/h3`（600） | `@expo-google-fonts/noto-serif-sc@0.4.4` 的 600 TTF，按本站字符集子集化 |
| `inter-latin.woff2` / `inter-latin-ext.woff2` | 正文拉丁（100–900 变量） | `@fontsource-variable/inter@5.2.5` → `files/inter-latin-wght-normal.woff2` / `inter-latin-ext-wght-normal.woff2` |
| `jbmono-latin.woff2` / `jbmono-latin-ext.woff2` | 数字等宽（100–800 变量） | `@fontsource-variable/jetbrains-mono@5.2.5` → `files/jetbrains-mono-latin-wght-normal.woff2` / `jetbrains-mono-latin-ext-wght-normal.woff2` |

四个 Latin 文件从 jsDelivr 原样下载、未做改动；`unicode-range` 写在 `web/src/styles.css` 的 `@font-face` 里，latin-ext 只在页面出现相应字符时下载。

## 重新生成标题子集

界面新增生僻字、或球队改名后标题掉字（回退成 SimSun）时跑：

```bash
pip install fonttools brotli
python scripts/build-serif-subset.py
```

脚本会：

1. 下载 14.8MB 的 `NotoSerifSC_600SemiBold.ttf` 到 `scripts/.font-cache/`（已 gitignore）；
2. 扫 `web/src/**/*.{ts,tsx,css}`、`src/**/*.ts`、`web/index.html` 的全部字符，加上生产 20 支球队名、ASCII/Latin-1/Latin-Ext-A、常用中英标点，写出字符表；
3. 用 `pyftsubset` 产出 `noto-serif-sc-600-subset.woff2`（当前约 298KB，2187 字，其中 CJK 1526）。

字体名沿用 `Noto Serif SC`，`@font-face` 不带 `local()`，不会命中用户机器上的完整版。

## 许可

三个字体族均为 SIL Open Font License 1.1，全文见同目录：

- `OFL-NotoSerifSC.txt`
- `OFL-Inter.txt`
- `OFL-JetBrainsMono.txt`

OFL 允许子集化与自托管（保留许可与版权声明即可），不得单独售卖字体。
