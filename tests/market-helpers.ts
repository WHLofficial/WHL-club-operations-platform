// C3 招商轮测试替身：signNaming（v6.14.0 退役）的等价物——给队造一份指定套餐的 pending
// 报价（按现行底价公式快照、挂当前 open 轮，无轮先开）并立即 acceptOffer。
// 供 naming-ops / naming-tiers / market-rounds 测试共用。
import { acceptOffer } from '../src/worker/market-ops.ts';
import { HttpError } from '../src/lib/http.ts';
import {
  buildPackages,
  industryFactor,
  loadIndustryFactors,
  loadNamingParams,
  namingBaseFee,
  type NamingContractRow,
} from '../src/worker/naming-ops.ts';
import type { Env } from '../src/worker/env.ts';

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** 找当前 open 轮，没有就开一个（不开市场语句，纯测试夹具）。 */
export async function seedOpenRound(env: Env, season = 1, windowSeq = 1): Promise<number> {
  const open = await env.DB
    .prepare(`SELECT id FROM market_rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1`)
    .first<{ id: number }>();
  if (open) return open.id;
  const out = await env.DB
    .prepare(`INSERT INTO market_rounds (opened_season, opened_window, status, opened_at) VALUES (?, ?, 'open', ${nowSql})`)
    .bind(season, windowSeq)
    .run();
  return Number(out.meta.last_row_id);
}

/** 造一份 pending 报价（品牌/套餐/金额按现行公式快照），返回 offer id。 */
export async function seedOffer(
  env: Env,
  clubId: number,
  brand: string,
  packageNo: number,
): Promise<number> {
  if (!Number.isInteger(packageNo) || packageNo < 1 || packageNo > 3) {
    throw new HttpError(400, '套餐号需为 1-3');
  }
  const roundId = await seedOpenRound(env);
  const def = await env.DB
    .prepare(`SELECT id, heat, industry FROM brand_pool WHERE brand = ? AND status = 'adopted'`)
    .bind(brand)
    .first<{ id: number; heat: number; industry: string }>();
  if (!def) throw new HttpError(400, `品牌「${brand}」不在品牌池`);
  const stadium = await env.DB
    .prepare('SELECT capacity, fans FROM stadiums WHERE club_id = ?')
    .bind(clubId)
    .first<{ capacity: number; fans: number }>();
  if (!stadium) throw new HttpError(404, '俱乐部还没有球场档案');
  const [params, factors] = await Promise.all([loadNamingParams(env.DB), loadIndustryFactors(env.DB)]);
  const baseFee = Math.round(namingBaseFee(params, stadium.capacity, stadium.fans, def.heat) * industryFactor(factors, def.industry) * 1000) / 1000;
  const pkg = buildPackages(params, baseFee)[packageNo - 1]!;
  const out = await env.DB
    .prepare(
      `INSERT INTO market_offers (round_id, brand_id, club_id, package_no, amount, windows, package_json, status, created_at, expire_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ${nowSql}, '9999-12-31T00:00:00.000Z')`,
    )
    .bind(
      roundId, def.id, clubId, pkg.packageNo, pkg.feePerWindow, pkg.windows,
      JSON.stringify({ slot: 'naming', pkgName: pkg.pkgName, baseFee, bonusAmount: pkg.bonusAmount, betAttend: pkg.betAttend, betFans: pkg.betFans, brandHeat: def.heat }),
    )
    .run();
  return Number(out.meta.last_row_id);
}

/** signNaming 的测试替身：造 pending 报价 → acceptOffer（无 active 冠名时自动成约）。 */
export async function signViaOffer(env: Env, clubId: number, brand: string, packageNo: number): Promise<NamingContractRow> {
  const offerId = await seedOffer(env, clubId, brand, packageNo);
  const out = await acceptOffer(env, offerId, clubId, undefined, null);
  if (!out.contract) throw new HttpError(409, `signViaOffer 未成约（result=${out.result}）`);
  return out.contract;
}
