// 前端展示的版本号：构建时由 vite.config.ts 从 package.json 的 version 注入（单一真源）
declare const __APP_VERSION__: string;

/** 未注入时（如单测环境直接跑源码）回落 'dev' */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
