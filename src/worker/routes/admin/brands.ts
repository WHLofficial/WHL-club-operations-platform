// 品牌池管理（v6.8.0 冠名活化）：列表 / 新增自定义品牌 / 调热度·行业·弃用。
// 热度界 0.5–1.5（与 market_heat_rules 钳制边界一致）；弃用守卫：有 active 合同的品牌禁弃
// （插件没这校验，我们补——弃了会让该合同续不了约、热度也不再演化）。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { writeAudit } from '../../../lib/audit.ts';
import { nowSql, readJson } from './shared.ts';
import { loadHeatRules } from '../../naming-ops.ts';

const app = new Hono<{ Bindings: Env }>();

function validateHeat(heat: unknown, rules: { clampLow: number; clampHigh: number }): number {
  if (typeof heat !== 'number' || !Number.isFinite(heat) || heat < rules.clampLow || heat > rules.clampHigh) {
    throw new HttpError(400, `热度需在 ${rules.clampLow}–${rules.clampHigh} 之间`);
  }
  return heat;
}

app.get('/brands', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  // 生效冠名数走一次 LEFT JOIN 聚合（品牌名上没有索引，相关子查询会按品牌数重复扫 naming_contracts）
  const rows = (
    await c.env.DB
      .prepare(
        `SELECT b.id, b.brand, b.heat, b.source, b.status, b.industry, b.created_at,
                COUNT(nc.id) AS active_contracts
         FROM brand_pool b
         LEFT JOIN naming_contracts nc ON nc.brand = b.brand AND nc.status = 'active'
         GROUP BY b.id ORDER BY b.id`,
      )
      .all()
  ).results;
  return c.json({ brands: rows });
});

app.post('/brands', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const body = (await readJson(c)) as { brand?: unknown; heat?: unknown; industry?: unknown } | null;
  const name = typeof body?.brand === 'string' ? body.brand.trim() : '';
  if (name.length < 1 || name.length > 20) throw new HttpError(400, '品牌名需 1-20 字');
  const rules = await loadHeatRules(c.env.DB);
  const heat = validateHeat(body?.heat, rules);
  const industry = typeof body?.industry === 'string' && body.industry.trim() !== '' ? body.industry.trim() : '通用';
  if (industry.length > 10) throw new HttpError(400, '行业名需 ≤10 字');
  const out = await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO brand_pool (brand, heat, source, status, industry, created_at)
         SELECT ?, ?, 'custom', 'adopted', ?, ${nowSql()}
         WHERE NOT EXISTS (SELECT 1 FROM brand_pool WHERE brand = ?)`,
      )
      .bind(name, heat, industry, name),
  ]);
  if ((out[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, `品牌「${name}」已存在`);
  const row = await c.env.DB
    .prepare(`SELECT id, brand, heat, source, status, industry, created_at FROM brand_pool WHERE brand = ?`)
    .bind(name)
    .first<{ id: number; brand: string; heat: number; source: string; status: string; industry: string; created_at: string }>();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'brand_create',
    targetType: 'brand_pool',
    targetId: row?.id ?? null,
    origin: 'user',
    after: { brand: name, heat, industry, source: 'custom' },
  });
  return c.json({ brand: row }, 201);
});

app.patch('/brands/:id', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '品牌 id 不对');
  const row = await c.env.DB
    .prepare(`SELECT id, brand, heat, source, status, industry FROM brand_pool WHERE id = ?`)
    .bind(id)
    .first<{
      id: number;
      brand: string;
      heat: number;
      source: string;
      status: string;
      industry: string;
    }>();
  if (!row) throw new HttpError(404, '品牌不存在');
  const body = (await readJson(c)) as { heat?: unknown; industry?: unknown; status?: unknown } | null;
  if (body?.heat === undefined && body?.industry === undefined && body?.status === undefined) {
    throw new HttpError(400, '没有要改的字段（heat / industry / status 至少给一个）');
  }

  let heat = row.heat;
  if (body?.heat !== undefined) {
    const rules = await loadHeatRules(c.env.DB);
    heat = validateHeat(body.heat, rules);
  }
  let industry = row.industry;
  if (body?.industry !== undefined) {
    if (typeof body.industry !== 'string' || body.industry.trim() === '' || body.industry.trim().length > 10) {
      throw new HttpError(400, '行业名需 1-10 字');
    }
    industry = body.industry.trim();
  }
  let status = row.status;
  if (body?.status !== undefined) {
    if (body.status !== 'adopted' && body.status !== 'discarded') throw new HttpError(400, 'status 只能是 adopted 或 discarded');
    if (body.status === 'discarded' && row.status === 'adopted') {
      const active = await c.env.DB
        .prepare(`SELECT COUNT(*) AS n FROM naming_contracts WHERE brand = ? AND status = 'active'`)
        .bind(row.brand)
        .first<{ n: number }>();
      if ((active?.n ?? 0) > 0) throw new HttpError(409, `品牌「${row.brand}」还有 ${active?.n} 份生效冠名，先等合同到期或解约再弃用`);
    }
    status = body.status;
  }

  await c.env.DB.batch([
    c.env.DB
      .prepare(`UPDATE brand_pool SET heat = ?, industry = ?, status = ? WHERE id = ?`)
      .bind(heat, industry, status, id),
  ]);
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'brand_update',
    targetType: 'brand_pool',
    targetId: id,
    origin: 'user',
    before: { brand: row.brand, heat: row.heat, industry: row.industry, status: row.status },
    after: { brand: row.brand, heat, industry, status },
  });
  return c.json({ brand: { ...row, heat, industry, status } });
});

export default app;
