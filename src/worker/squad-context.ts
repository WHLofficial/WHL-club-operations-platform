// 组装合规引擎的规则上下文（§13 config：squad_min/squad_max/gk_min/trainee_max/wage_cap/ca_pa_limits）
import { createConfigService } from '../core/config.ts';
import { DEFAULT_CA_PA_LIMITS, type SquadLimits, type SquadRuleContext } from '../core/squad-rules.ts';

export async function loadSquadContext(db: D1Database, tier: string | null): Promise<SquadRuleContext> {
  const config = createConfigService(db);
  const [squadMin, squadMax, gkMin, traineeMax, wageCap, limitsJson] = await Promise.all([
    config.getNumber('squad_min'),
    config.getNumber('squad_max'),
    config.getNumber('gk_min'),
    config.getNumber('trainee_max'),
    config.getNumber('wage_cap'),
    config.getJson<Partial<Record<'premier' | 'second', SquadLimits>>>('ca_pa_limits'),
  ]);
  const tierKey = tier === 'premier' || tier === 'second' ? tier : null;
  return {
    tier: tierKey,
    limits: tierKey ? limitsJson?.[tierKey] ?? DEFAULT_CA_PA_LIMITS[tierKey] : DEFAULT_CA_PA_LIMITS.premier,
    squadMin: squadMin ?? 20,
    squadMax: squadMax ?? 30,
    gkMin: gkMin ?? 1,
    traineeMax: traineeMax ?? 7,
    wageCap,
  };
}
