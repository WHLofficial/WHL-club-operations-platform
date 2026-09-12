export interface Env {
  DB: D1Database;
  TOUR_DB: D1Database;
  SESSION_KV: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CRON_KEY?: string;
  rng?: () => number;
}
