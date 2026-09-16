// 组装合规引擎的规则上下文（§13 config：squad_min/squad_max/gk_min/trainee_max/wage_cap/ca_pa_limits）
// 增量 9：tier 改由报名派生（worker/tier.ts），调用方必须先解析出级别再进来——
// 派生不到（未报名/未绑定）一律由上层 400 拦截，这里不再静默回退 premier。
import { createConfigService } from '../core/config.ts';
import { DEFAULT_CA_PA_LIMITS, type SquadLimits, type SquadRuleContext } from '../core/squad-rules.ts';
import { HttpError } from '../lib/http.ts';
import type { Tier } from './tier.ts';

export async function loadSquadContext(db: D1Database, tier: Tier | null): Promise<SquadRuleContext> {
  const config = createConfigService(db);
  const [squadMin, squadMax, gkMin, traineeMax, wageCap, limitsJson] = await Promise.all([
    config.getNumber('squad_min'),
    config.getNumber('squad_max'),
    config.getNumber('gk_min'),
    config.getNumber('trainee_max'),
    config.getNumber('wage_cap'),
    config.getJson<Partial<Record<Tier, SquadLimits>>>('ca_pa_limits'),
  ]);
  if (tier === null) throw new HttpError(500, '分级未解析（未报名定级赛事），不能加载合规规则');
  return {
    tier,
    limits: limitsJson?.[tier] ?? DEFAULT_CA_PA_LIMITS[tier],
    squadMin: squadMin ?? 20,
    squadMax: squadMax ?? 30,
    gkMin: gkMin ?? 1,
    traineeMax: traineeMax ?? 7,
    wageCap,
  };
}
