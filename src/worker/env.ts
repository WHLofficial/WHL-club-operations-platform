export interface Env {
  DB: D1Database;
  TOUR_DB: D1Database;
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
}
