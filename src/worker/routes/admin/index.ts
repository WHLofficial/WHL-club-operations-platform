// 管理端路由聚合（附录 A〔1〕，🛡=requireAdmin 全覆盖）：
// v2.1.0 拆分为八域子文件（clubs/config/players/finance/seasons/growth/market/reviews）
// + overview（总览轻计数，commit 6），全部挂在根前缀，对外 URL 与单文件时期逐字一致。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import clubsRoutes from './clubs.ts';
import configRoutes from './config.ts';
import playersRoutes from './players.ts';
import financeRoutes from './finance.ts';
import seasonsRoutes from './seasons.ts';
import growthRoutes from './growth.ts';
import marketRoutes from './market.ts';
import reviewsRoutes from './reviews.ts';
import overviewRoutes from './overview.ts';
import teamSyncRoutes from './teamSync.ts';

const app = new Hono<{ Bindings: Env }>();

app.route('/', clubsRoutes);
app.route('/', configRoutes);
app.route('/', playersRoutes);
app.route('/', financeRoutes);
app.route('/', seasonsRoutes);
app.route('/', growthRoutes);
app.route('/', marketRoutes);
app.route('/', reviewsRoutes);
app.route('/', overviewRoutes);
// v6.1.0：球队建档双向同步的对账面（GET /api/admin/team-sync + POST /api/admin/team-sync/apply）
app.route('/', teamSyncRoutes);

export default app;
