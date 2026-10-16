export interface Env {
  DB: D1Database;
  TOUR_DB: D1Database;
  // v1.0.0：认证中心 D1 只读绑定——球队绑定真源（team/team_binding），平台不写；未配置回落本地休眠表
  AUTH_DB?: D1Database;
  SESSION_KV: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CRON_KEY?: string;
  // bot 通知投递（§12）：AstrBot 接收插件公网入口 + 共享签名密钥（wrangler secret）
  SYNC_BASE_URL?: string;
  SYNC_SECRET?: string;
  rng?: () => number;
  // 统一认证迁移步骤②（auth 项目 PRD P0-5）：AUTH_MODE="oidc" 显式开启 RP 模式（v1.2.0
  // 显式化），OIDC_ISSUER/OIDC_CLIENT_ID 为连接变量；未配 AUTH_MODE = 兼容模式（共享
  // cookie 透传）——回滚开关就是撤掉 AUTH_MODE 重新部署
  AUTH_MODE?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  // v1.0.0 机器通道（发码/烧码/解绑走 auth 机器 API）：与 auth 仓 BIND_SECRET 同值
  // （wrangler secret put AUTH_BIND_SECRET，与 auth 仓 BIND_SECRET 同值）
  AUTH_BIND_SECRET?: string;
  // v3.2.0：公开读缓存 TTL 的**覆盖开关**（显式给数，含 0=旁路）。
  // 生产**不配**——分级口径在 `src/lib/cache-policy.ts`（players 1h / roster 24h / clubs 24h），
  // 新鲜度靠写路径 purge；测试配 '0' 让断言不受缓存影响。
  PUBLIC_CACHE_TTL_MS?: string;
  // v3.4.0：比赛系统公开基址（球队详情代理积分榜用，如 https://tour.whleague.win）。
  // 未配 = 排名区块整体降级（前端显示「排名暂不可用」），不查任何库。
  // v5.0.1：填 apex whleague.win 不算降级——会真的发请求，每次都 530，排名区块永久不可用。
  TOUR_API_BASE?: string;
  // v6.1.0：球队建档双向同步的共享密钥（与赛事仓同值，wrangler secret put TEAM_SYNC_SECRET）。
  // 出站未配 = 只记同步失败、不阻断本地建俱乐部；入站未配 = /api/internal/* 一律 503（写端点 fail-closed）。
  TEAM_SYNC_SECRET?: string;
  // v6.44.0：天气同步（插件侧天气真源 → 平台 match_weather）的共享密钥。**刻意与 TEAM_SYNC_SECRET 分开**
  // （wrangler secret put WEATHER_SYNC_SECRET，与插件配置 club_sync_secret 同值）：两把钥匙开两个端点，
  // 插件那侧只需知道天气这一把，旋转任一把不影响另一条通道。
  // 入站未配 = POST /api/internal/weather-sync 一律 503（写端点 fail-closed，同 team-upsert）。
  WEATHER_SYNC_SECRET?: string;
  // v6.1.1：Sentry 错误追踪（@sentry/hono/cloudflare 中间件）。DSN 走 secret
  // （wrangler secret put SENTRY_DSN；配 secret 会生成 Source=Secret Change 的新版本）。
  // **未配 = 完全旁路**：SDK 不初始化、零上报零网络，本地 .dev.vars 不配即可。
  // SENTRY_ENVIRONMENT 仅本地联调时配（如 'development'），生产缺省即 'production'。
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  // v6.1.1：wrangler version_metadata 绑定（只读）——Sentry SDK 从 env 自动检测该绑定的
  // id 作为 release（优先级低于 SENTRY_RELEASE 环境变量，本仓不配后者）。
  CF_VERSION_METADATA?: { id: string };
  // v6.12.0（D3）：LLM 草稿工坊（管理端 only）——OpenAI 兼容 chat/completions，三变量都不绑具体厂商。
  // 未配 LLM_API_KEY（或 BASE/MODEL）= 端点 503 旁路；LLM_API_KEY 走 secret（wrangler secret put）。
  LLM_API_BASE?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  // v6.43.0：成长录入截图识别用的视觉模型，缺省回落 LLM_MODEL（免费档 glm-4v-flash 已实测够用，
  // 见 memory/spike-v6.43.0-vision.md）。
  LLM_VISION_MODEL?: string;
  // v6.51.2：视觉调用 max_tokens（缺省 1024）。glm-4v-flash 只接受 [1,1024] —— 写 4096 会被
  // 参数校验直接打回（400 code 1210，v6.43.0–v6.51.1 的真实故障）；换付费视觉模型时用这个变量抬高。
  LLM_VISION_MAX_TOKENS?: string;
  // v6.51.4：智谱视觉模型的思考开关。抽字段用不上推理，缺省关（thinking: disabled）——
  // glm-4.6v-flashx 实测同图关思考快一倍、输出 token 减半、名单一致；=on/enabled/true 时保留思考。
  LLM_VISION_THINKING?: string;
}
