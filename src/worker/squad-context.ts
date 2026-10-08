// 组装合规引擎的规则上下文（§13 config：squad_min/squad_max/gk_min/trainee_max/wage_cap/ca_pa_limits）
// v1.2.0：tier 改由报名派生（worker/tier.ts），调用方必须先解析出级别再进来——
// 派生不到（未报名/未绑定）一律由上层 400 拦截，这里不再静默回退 premier。
// v6.39.0：wage_cap 从「全局单值」改「按级别」（顶级 68 / 次级 58，用户令 2026-10-06）。
import { createConfigService } from '../core/config.ts';
import {
  DEFAULT_CA_PA_LIMITS,
  DEFAULT_WAGE_CAP_BY_TIER,
  parseRegistrationCheckMode,
  type RegistrationCheckMode,
  type SquadLimits,
  type SquadRuleContext,
} from '../core/squad-rules.ts';
import { HttpError } from '../lib/http.ts';
import type { Tier } from './tier.ts';

export async function loadSquadContext(db: D1Database, tier: Tier | null): Promise<SquadRuleContext> {
  const config = createConfigService(db);
  const [squadMin, squadMax, gkMin, traineeMax, wageCapJson, limitsJson] = await Promise.all([
    config.getNumber('squad_min'),
    config.getNumber('squad_max'),
    config.getNumber('gk_min'),
    config.getNumber('trainee_max'),
    config.getJson<Partial<Record<Tier, number>>>('wage_cap'),
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
    // v6.39.0：工资帽按级别（用户令 2026-10-06：顶级 68 / 次级 58；config 的 wage_cap 覆盖整表或按档覆盖）
    wageCap: wageCapJson?.[tier] ?? DEFAULT_WAGE_CAP_BY_TIER[tier],
  };
}

/** 注册校验放行档（v6.33.1 特例期开关）：教练侧「工作台读取」与「提交校验」共用这一个读法，
 *  口径与白名单都收在 core/squad-rules 的 parseRegistrationCheckMode（坏值一律回 enforce）。 */
export async function loadRegistrationCheckMode(db: D1Database): Promise<RegistrationCheckMode> {
  return parseRegistrationCheckMode(await createConfigService(db).get('registration_check_mode'));
}
