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
}
