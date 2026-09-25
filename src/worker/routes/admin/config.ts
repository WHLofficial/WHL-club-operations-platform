// 管理端 · 系统域（v2.1.0）：config 查看/超管写入口 + 审计日志查询
// （原 admin.ts config 域；超管全开与审计日志为v2.1.0 commit 6 新增）
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { requireAdmin, requireSuperAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { HttpError } from '../../../lib/http.ts';
import {
  CONFIG_KEYS,
  CONFIG_MASK,
  createConfigService,
  isSecretKey,
  type ConfigKey,
} from '../../../core/config.ts';
import { readJson } from './shared.ts';

const app = new Hono<{ Bindings: Env }>();

// GET /api/admin/config —— 普通管理 listMasked（涉密键掩码），超管 listRaw（全键明文 + secret 标记）
app.get('/config', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const service = createConfigService(c.env.DB);
  const isSuper = user.permissions.includes('club.config.manage.super');
  return c.json({
    config: isSuper ? await service.listRaw() : await service.listMasked(),
    editable: isSuper,
  });
});

// PUT /api/admin/config —— 超管逐键编辑（{key, value}，value=null 回默认）；审计 config_set 记 before/after
// （涉密键的 before/after 由调用方保证只含掩码值，§6.10）
app.put('/config', async (c) => {
  const user = await requireSuperAdmin(c.env, c.req.raw);
  const body = (await readJson(c)) as { key?: unknown; value?: unknown } | null;
  if (typeof body?.key !== 'string' || !CONFIG_KEYS.includes(body.key as ConfigKey)) {
    throw new HttpError(400, '未注册的 config 键');
  }
  if (body.value !== null && typeof body.value !== 'string') throw new HttpError(400, 'value 须为字符串或 null（回默认）');
  const key = body.key as ConfigKey;
  const value = body.value ?? null;

  const service = createConfigService(c.env.DB);
  const before = await service.get(key);
  await service.set(key, value);
  // 值变化才算改动（写同值也允许，但审计照记，口径与 elsewhere 一致：动作即留痕）
  const mask = (v: string | null) => (isSecretKey(key) ? CONFIG_MASK : v);
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'config_set',
    targetType: 'config',
    targetId: null,
    before: { key, value: mask(before) },
    after: { key, value: mask(value) },
  });
  return c.json({ ok: true, key, value: mask(value) });
});

// GET /api/admin/audit-log?limit=&action= —— 最近审计（id DESC，limit 缺省 100 上限 100，
// action 前缀过滤）。非超管请求者：config_set 里涉密键的值再掩一道（写入侧已掩，双保险 §6.10）
app.get('/audit-log', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw);
  const isSuper = user.permissions.includes('club.config.manage.super');
  const limitRaw = Number(c.req.query('limit') ?? 100);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 100;
  const action = (c.req.query('action') ?? '').trim();

  const rows = await c.env.DB.prepare(
    `SELECT id, actor, action, target_type, target_id, before, after, at
     FROM audit_log ${action ? 'WHERE action LIKE ?' : ''}
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(...(action ? [`${action}%`, limit] : [limit]))
    .all<{ id: number; actor: number | null; action: string; target_type: string; target_id: number | null; before: string | null; after: string | null; at: string }>();

  return c.json({
    entries: rows.results.map((r) => {
      const maskSecret = (raw: string | null): string | null => {
        if (isSuper || !raw || r.action !== 'config_set') return raw;
        try {
          const parsed = JSON.parse(raw) as { key?: unknown; value?: unknown };
          if (typeof parsed.key === 'string' && isSecretKey(parsed.key)) {
            return JSON.stringify({ ...parsed, value: CONFIG_MASK });
          }
        } catch {
          // 不是合法 JSON 的历史行，原样透出
        }
        return raw;
      };
      return {
        id: r.id,
        actor: r.actor,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        before: maskSecret(r.before),
        after: maskSecret(r.after),
        at: r.at,
      };
    }),
  });
});

export default app;
