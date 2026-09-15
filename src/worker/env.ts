export interface Env {
  DB: D1Database;
  TOUR_DB: D1Database;
  // 增量 7：认证中心 D1 只读绑定——球队绑定真源（team/team_binding），平台不写；未配置回落本地休眠表
  AUTH_DB?: D1Database;
  SESSION_KV: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CRON_KEY?: string;
  // bot 通知投递（§12）：AstrBot 接收插件公网入口 + 共享签名密钥（wrangler secret）
  SYNC_BASE_URL?: string;
  SYNC_SECRET?: string;
  rng?: () => number;
  // 统一认证迁移步骤②（auth 项目 PRD P0-5）：配置即切换 OIDC 登录；
  // 未配置 = 兼容模式（共享 cookie 透传）——回滚开关就是撤掉这两个变量
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  // 增量 7 机器通道（发码/烧码/解绑走 auth 机器 API）：与 auth 仓 BIND_SECRET 同值
  // （wrangler secret put AUTH_BIND_SECRET）；配了 OIDC_ISSUER 即随部署一起配
  AUTH_BIND_SECRET?: string;
}
