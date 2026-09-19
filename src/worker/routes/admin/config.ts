// 管理端 · config 键注册表（§13，涉密键掩码；原 admin.ts config 域，增量 15 拆分）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createConfigService } from '../../../core/config.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/config', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const service = createConfigService(c.env.DB);
  return c.json({ config: await service.listMasked() });
});

export default app;
