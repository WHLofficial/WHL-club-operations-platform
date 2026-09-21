import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 四组 include：
// - src/** 与 tests/** 是 Worker 侧（node 环境，不挂 jsdom）
// - web/** 是前端（增量 26 步骤 9 起有组件测试）。前端测试文件顶部用
//   `// @vitest-environment jsdom` 声明环境；没声明的在 node 下跑 —— 纯函数测试不需要 DOM。
// plugins 挂 react：.tsx 测试文件的 JSX 转换与组件模块加载都靠它。
export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "web/**/*.test.ts",
      "web/**/*.test.tsx",
    ],
  },
});
