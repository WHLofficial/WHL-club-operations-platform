// 运营时刻表只读（v6.49.0）：教练侧与匿名访客都能看「这个操作现在开着吗」，
// 用于按钮置灰与倒计时；管理端另有 /api/admin/ops-schedule（GET/PUT）。
// 只回状态与解析后的时间，不含任何配置细节。
import { Hono } from 'hono';
import type { Env } from '../env.ts';
import { opsScheduleView } from '../ops-schedule.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/ops-schedule', async (c) => {
  const view = await opsScheduleView(c.env.DB);
  return c.json(view);
});

export default app;
