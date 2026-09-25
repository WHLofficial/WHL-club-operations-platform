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
}
