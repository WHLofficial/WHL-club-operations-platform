import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 构建目标静态锁：Vite 默认 target 是 es2020（Chrome 87+），旧内核（百度 / QQ 浏览器
// 在红米等机型上常见 Chromium 66–79）遇到产物里的 `??` 会在解析期 SyntaxError，
// 整个 bundle 不执行、页面只剩 CSS 背景色。这条锁防止 target 被删回默认。
describe("构建目标兼容旧内核", () => {
  const config = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

  it("build.target 显式声明 chrome79", () => {
    expect(config).toMatch(/target:\s*\[[^\]]*"chrome79"[^\]]*\]/);
  });

  it("build.target 显式声明 safari13", () => {
    expect(config).toMatch(/target:\s*\[[^\]]*"safari13"[^\]]*\]/);
  });

  it("不再出现 esnext 目标（会保留 ?? 等新语法）", () => {
    expect(config).not.toMatch(/target:\s*"esnext"/);
  });
});
