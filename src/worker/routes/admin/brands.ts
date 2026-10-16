// 品牌池管理（v6.8.0 冠名活化）：列表 / 新增自定义品牌 / 调热度·行业·档位·弃用。
// 热度界 0.5–1.5（与 market_heat_rules 钳制边界一致）；弃用守卫：有 active 合同的品牌禁弃
// （插件没这校验，我们补——弃了会让该合同续不了约、热度也不再演化）。
// 档位（v6.13.0 C2）：tier 三档枚举校验 + tier_locked 手动锁档（锁住的行关窗自动校准跳过）。
// 招商轮（v6.14.0 C3）：当前轮与报价流水只读 + 手动「清盘+开轮」恢复按钮（幂等语义：每次执行
// 都会清掉当前 open 轮未签报价并重开一轮，重复执行得到新轮，审计留痕）。
import { Hono } from 'hono';
import type { Env } from '../../env.ts';
import { HttpError } from '../../../lib/http.ts';
import { requireAdmin } from '../../../lib/session.ts';
import { createAuditStatement, writeAudit } from '../../../lib/audit.ts';
import { nowSql, readJson } from './shared.ts';
import { loadHeatRules, BRAND_TIERS, BRAND_STYLES, PREFER_TAGS } from '../../naming-ops.ts';
import { getOpenWindow } from '../../seasons.ts';
import { buildRoundStatements, getOpenRound } from '../../market-ops.ts';

const app = new Hono<{ Bindings: Env }>();

function validateHeat(heat: unknown, rules: { clampLow: number; clampHigh: number }): number {
  if (typeof heat !== 'number' || !Number.isFinite(heat) || heat < rules.clampLow || heat > rules.clampHigh) {
    throw new HttpError(400, `热度需在 ${rules.clampLow}–${rules.clampHigh} 之间`);
  }
  return heat;
}

// 企业档案（v6.51.0 批 2）：字段上限与枚举；空串一律表示「未登记」（前端回落不渲染该行/标签）
const PROFILE_TEXT_LIMITS = { name_en: 40, full_name: 30, slogan: 20, hq: 20, intro: 80 } as const;
type ProfileTextField = keyof typeof PROFILE_TEXT_LIMITS;
const ORIGINS = ['', '中资'];

function validateProfileText(key: ProfileTextField, value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, `${key} 要是字符串`);
  const v = value.trim();
  if (v.length > PROFILE_TEXT_LIMITS[key]) throw new HttpError(400, `${key} 最多 ${PROFILE_TEXT_LIMITS[key]} 字`);
  return v;
}

function validateColor(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'color 要是字符串');
  const v = value.trim();
  if (v !== '' && !/^#[0-9A-Fa-f]{6}$/.test(v)) throw new HttpError(400, 'color 要写成 #RRGGBB 或留空');
  return v;
}

function validateOrigin(value: unknown): string {
  if (typeof value !== 'string' || !ORIGINS.includes(value.trim())) throw new HttpError(400, 'origin 只能是空或「中资」');
  return value.trim();
}

// 招商性格（v6.51.0 批 3）：style 决定递什么套餐，prefer 决定对赌抽签权重偏向
function validateStyle(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'style 要是字符串');
  const v = value.trim();
  if (v !== '' && !(BRAND_STYLES as readonly string[]).includes(v)) {
    throw new HttpError(400, `style 只能是 ${BRAND_STYLES.join(' / ')} 或留空`);
  }
  return v;
}

/** prefer：空串清空；否则 1–3 个不重复标签（逗号分隔，标签枚举与抽签权重表同源）。 */
function validatePrefer(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'prefer 要是字符串');
  const raw = value.trim();
  if (raw === '') return '';
  const tags = raw.split(',').map((t) => t.trim()).filter((t) => t !== '');
  if (tags.length < 1 || tags.length > 3) throw new HttpError(400, 'prefer 给 1–3 个标签');
  if (new Set(tags).size !== tags.length) throw new HttpError(400, 'prefer 标签不能重复');
  for (const t of tags) {
    if (!(PREFER_TAGS as readonly string[]).includes(t)) throw new HttpError(400, `prefer 标签只能是 ${PREFER_TAGS.join(' / ')}`);
  }
  return tags.join(',');
}

/** 档案字段的整块校验（POST 全给默认空串，PATCH 只覆盖给到的键）。 */
function readProfileFields(body: Record<string, unknown>): {
  nameEn: string;
  fullName: string;
  color: string;
  slogan: string;
  hq: string;
  intro: string;
  origin: string;
  style: string;
  prefer: string;
} {
  return {
    nameEn: validateProfileText('name_en', body.nameEn ?? body.name_en ?? ''),
    fullName: validateProfileText('full_name', body.fullName ?? body.full_name ?? ''),
    color: validateColor(body.color ?? ''),
    slogan: validateProfileText('slogan', body.slogan ?? ''),
    hq: validateProfileText('hq', body.hq ?? ''),
    intro: validateProfileText('intro', body.intro ?? ''),
    origin: validateOrigin(body.origin ?? ''),
    style: validateStyle(body.style ?? ''),
    prefer: validatePrefer(body.prefer ?? ''),
  };
}

app.get('/brands', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  // 生效冠名数走一次 LEFT JOIN 聚合（品牌名上没有索引，相关子查询会按品牌数重复扫 naming_contracts）
  const rows = (
    await c.env.DB
      .prepare(
        `SELECT b.id, b.brand, b.heat, b.source, b.status, b.industry, b.tier, b.tier_locked, b.created_at,
                b.name_en, b.full_name, b.color, b.slogan, b.hq, b.intro, b.origin, b.style, b.prefer,
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
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const name = typeof body?.brand === 'string' ? body.brand.trim() : '';
  if (name.length < 1 || name.length > 20) throw new HttpError(400, '品牌名需 1-20 字');
  const rules = await loadHeatRules(c.env.DB);
  const heat = validateHeat(body?.heat, rules);
  const industry = typeof body?.industry === 'string' && body.industry.trim() !== '' ? body.industry.trim() : '通用';
  if (industry.length > 10) throw new HttpError(400, '行业名需 ≤10 字');
  const p = readProfileFields(body ?? {});
  const out = await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO brand_pool (brand, heat, source, status, industry, name_en, full_name, color, slogan, hq, intro, origin, style, prefer, created_at)
         SELECT ?, ?, 'custom', 'adopted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql()}
         WHERE NOT EXISTS (SELECT 1 FROM brand_pool WHERE brand = ?)`,
      )
      .bind(name, heat, industry, p.nameEn, p.fullName, p.color, p.slogan, p.hq, p.intro, p.origin, p.style, p.prefer, name),
  ]);
  if ((out[0]?.meta.changes ?? 0) === 0) throw new HttpError(409, `品牌「${name}」已存在`);
  const row = await c.env.DB
    .prepare(
      `SELECT id, brand, heat, source, status, industry, tier, tier_locked, created_at,
              name_en, full_name, color, slogan, hq, intro, origin, style, prefer
       FROM brand_pool WHERE brand = ?`,
    )
    .bind(name)
    .first();
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'brand_create',
    targetType: 'brand_pool',
    targetId: (row as { id: number } | null)?.id ?? null,
    origin: 'user',
    after: { brand: name, heat, industry, source: 'custom', ...p },
  });
  return c.json({ brand: row }, 201);
});

app.patch('/brands/:id', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '品牌 id 不对');
  const row = await c.env.DB
    .prepare(
      `SELECT id, brand, heat, source, status, industry, tier, tier_locked,
              name_en, full_name, color, slogan, hq, intro, origin, style, prefer
       FROM brand_pool WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      brand: string;
      heat: number;
      source: string;
      status: string;
      industry: string;
      tier: string;
      tier_locked: number;
      name_en: string;
      full_name: string;
      color: string;
      slogan: string;
      hq: string;
      intro: string;
      origin: string;
      style: string;
      prefer: string;
    }>();
  if (!row) throw new HttpError(404, '品牌不存在');
  const body = (await readJson(c)) as Record<string, unknown> | null;
  const PROFILE_KEYS = ['nameEn', 'name_en', 'fullName', 'full_name', 'color', 'slogan', 'hq', 'intro', 'origin', 'style', 'prefer'];
  if (
    body?.heat === undefined &&
    body?.industry === undefined &&
    body?.status === undefined &&
    body?.tier === undefined &&
    body?.tierLocked === undefined &&
    !PROFILE_KEYS.some((k) => body?.[k] !== undefined)
  ) {
    throw new HttpError(400, '没有要改的字段（heat / industry / status / tier / tierLocked / 档案字段至少给一个）');
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
  let tier = row.tier;
  if (body?.tier !== undefined) {
    if (typeof body.tier !== 'string' || !BRAND_TIERS.includes(body.tier as never)) {
      throw new HttpError(400, `tier 只能是 ${BRAND_TIERS.join(' / ')}`);
    }
    tier = body.tier;
  }
  let tierLocked = row.tier_locked;
  if (body?.tierLocked !== undefined) {
    if (body.tierLocked !== 0 && body.tierLocked !== 1) throw new HttpError(400, 'tierLocked 只能是 0（跟随自动校准）或 1（锁档）');
    tierLocked = body.tierLocked;
  }
  // 企业档案与招商性格：只校验动过的键（整块 readProfileFields 会把未给字段清空，PATCH 不能这么干）
  const nameEn = body?.nameEn !== undefined || body?.name_en !== undefined ? validateProfileText('name_en', body?.nameEn ?? body?.name_en) : row.name_en;
  const fullName = body?.fullName !== undefined || body?.full_name !== undefined ? validateProfileText('full_name', body?.fullName ?? body?.full_name) : row.full_name;
  const color = body?.color !== undefined ? validateColor(body.color) : row.color;
  const slogan = body?.slogan !== undefined ? validateProfileText('slogan', body.slogan) : row.slogan;
  const hq = body?.hq !== undefined ? validateProfileText('hq', body.hq) : row.hq;
  const intro = body?.intro !== undefined ? validateProfileText('intro', body.intro) : row.intro;
  const origin = body?.origin !== undefined ? validateOrigin(body.origin) : row.origin;
  const style = body?.style !== undefined ? validateStyle(body.style) : row.style;
  const prefer = body?.prefer !== undefined ? validatePrefer(body.prefer) : row.prefer;

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE brand_pool SET heat = ?, industry = ?, status = ?, tier = ?, tier_locked = ?,
           name_en = ?, full_name = ?, color = ?, slogan = ?, hq = ?, intro = ?, origin = ?, style = ?, prefer = ?
         WHERE id = ?`,
      )
      .bind(heat, industry, status, tier, tierLocked, nameEn, fullName, color, slogan, hq, intro, origin, style, prefer, id),
  ]);
  await writeAudit(c.env.DB, {
    actor: user.id,
    action: 'brand_update',
    targetType: 'brand_pool',
    targetId: id,
    origin: 'user',
    before: {
      brand: row.brand,
      heat: row.heat,
      industry: row.industry,
      status: row.status,
      tier: row.tier,
      tier_locked: row.tier_locked,
      name_en: row.name_en,
      full_name: row.full_name,
      color: row.color,
      slogan: row.slogan,
      hq: row.hq,
      intro: row.intro,
      origin: row.origin,
      style: row.style,
      prefer: row.prefer,
    },
    after: {
      brand: row.brand,
      heat,
      industry,
      status,
      tier,
      tier_locked: tierLocked,
      name_en: nameEn,
      full_name: fullName,
      color,
      slogan,
      hq,
      intro,
      origin,
      style,
      prefer,
    },
  });
  return c.json({ brand: { ...row, heat, industry, status, tier, tier_locked: tierLocked, name_en: nameEn, full_name: fullName, color, slogan, hq, intro, origin, style, prefer } });
});

// 招商轮视图：当前 open 轮优先，否则最近一条已结轮；报价流水含已签/已废全状态
app.get('/brands/market-round', async (c) => {
  await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const round =
    (await getOpenRound(c.env.DB)) ??
    (await c.env.DB
      .prepare(`SELECT id, opened_season, opened_window, status, opened_at, settled_at FROM market_rounds ORDER BY id DESC LIMIT 1`)
      .first<{ id: number; opened_season: number; opened_window: number; status: string; opened_at: string; settled_at: string | null }>());
  const offers = round
    ? (
        await c.env.DB
          .prepare(
            `SELECT o.id, o.round_id, o.club_id, o.package_no, o.amount, o.windows, o.status, o.created_at, o.expire_at,
                    b.brand, cl.name AS club_name
             FROM market_offers o
             JOIN brand_pool b ON b.id = o.brand_id
             LEFT JOIN clubs cl ON cl.id = o.club_id
             WHERE o.round_id = ? ORDER BY o.id`,
          )
          .bind(round.id)
          .all()
      ).results
    : [];
  return c.json({ round, offers });
});

// 手动「清盘+开轮」：自动链路的恢复路径。语义 = 清掉当前 open 轮（未签 pending 作废 + 无人签品牌
// 热度 −ignored）并按当刻队况重开一轮；无开着的窗口时 409（轮没有可归属的窗口期）。
app.post('/brands/market-round/reopen', async (c) => {
  const user = await requireAdmin(c.env, c.req.raw, 'club.clubs.manage');
  const win = await getOpenWindow(c.env.DB);
  if (!win) throw new HttpError(409, '当前没有开着的窗口，开不了招商轮');
  const build = await buildRoundStatements(c.env, win.season, win.windowSeq);
  const statements = [...build.settleStatements, ...build.openStatements];
  const audit = createAuditStatement(c.env.DB);
  statements.push(
    audit({
      actor: user.id,
      action: 'market_round_reopen',
      targetType: 'market_round',
      targetId: null,
      origin: 'user',
      after: { season: win.season, windowSeq: win.windowSeq, hadOpenRound: build.hadOpenRound, offerCount: build.offerCount },
    }),
  );
  await c.env.DB.batch(statements);
  return c.json({
    ok: true,
    hadOpenRound: build.hadOpenRound,
    offerCount: build.offerCount,
    offersPerClub: build.offersPerClub,
  });
});

export default app;
