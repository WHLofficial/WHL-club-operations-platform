import * as Sentry from '@sentry/react';

// v6.1.1：whl-club-web 项目的 DSN（EU 区 ingest）。Sentry 的 DSN 是设计上的公开标识
// （可进前端产物），空串 = 旁路（init 直接跳过、SDK 被 rollup 摇掉）。
const SENTRY_WEB_DSN =
  'https://a5914c6da75e84dc381847bd898bf73a@o4512146377736192.ingest.de.sentry.io/4512146409259088';

// errors-only：不引 performance/replay，控 bundle 体积与免费档额度（5k errors/月）。
// 覆盖面：渲染崩溃（React 渲染期异常）、未处理 rejection、事件回调里漏接的异常；
// TanStack Query 的请求错误进 query state 不走 window.onerror，API 5xx 由 Worker 侧上报。
export function initSentry(): void {
  if (!SENTRY_WEB_DSN) return;
  Sentry.init({
    dsn: SENTRY_WEB_DSN,
    environment: 'production',
    sampleRate: 1,
    tracesSampleRate: 0,
  });
}
