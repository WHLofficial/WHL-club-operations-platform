import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 版本号单一真源 = package.json 的 version（各仓语义化版本，口径见 ROADMAP.md 顶部）
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  root: "web",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8791",
    },
  },
  build: {
    outDir: "dist",
    // 兼容国产浏览器旧内核（百度 / QQ 浏览器在红米等机型上常见 Chromium 66–79）：
    // Vite 默认 target 是 es2020，产物里的 `??`（空值合并，Chrome 80+）会让旧内核在
    // 解析期直接 SyntaxError，整个 bundle 一行不执行、页面只剩 CSS 背景色。
    // 降到 chrome79 / safari13 后语法全部降级，实测 gzip 仅 +4KB。
    target: ["chrome79", "safari13"],
  },
});
