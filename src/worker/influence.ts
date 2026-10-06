// 球员影响力（规则 4.1.3）JS 侧共用模块：players 列表游标翻页与 club/squad 名册
// 必须逐位一致（v6.37.0 起报名名单卡也下发 influence）。SQL 版表达式仍在
// routes/players.ts（influenceExpr），系数加载与 JS 镜像在此，两边不许漂移。
import { createConfigService } from '../core/config.ts';
import { playerAbilityLevel } from './home.ts';
import type { Env } from './env.ts';

export function influenceOf(coefs: { g: number; s: number }, ca: number | null, pa: number | null, growable: boolean, prestige: number | null): number {
  const coef = growable ? coefs.g : coefs.s;
  return Math.round(coef * playerAbilityLevel(ca, pa, growable ? 1 : 0) * (prestige ?? 0) * 100) / 100;
}

export async function influenceCoefs(db: Env['DB']): Promise<{ g: number; s: number }> {
  try {
    const raw = await createConfigService(db).get('attendance_model');
    if (raw) {
      const model = JSON.parse(raw) as { influence_coef_growable?: unknown; influence_coef_static?: unknown };
      const g = Number(model.influence_coef_growable);
      const s = Number(model.influence_coef_static);
      if (Number.isFinite(g) && g >= 0 && g <= 1 && Number.isFinite(s) && s >= 0 && s <= 1) return { g, s };
    }
  } catch {
    // 配置缺失或坏 JSON：退回规则 4.1.3 原文系数
  }
  return { g: 0.25, s: 0.13 };
}
