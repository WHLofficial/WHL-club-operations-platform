// 谈判参数装配（§13 config 键 → 谈判引擎上下文），与 market-context 同范式：缺省回退注册表默认值。
// 涉密键只在此处汇集供 Worker 判定使用，不回传前端（§6.10-2）。
import { createConfigService } from '../core/config.ts';

export interface AgentTierParams {
  threshold: number;
  probability: number;
}

export interface NegotiationContext {
  wageParamA: number;
  wageParamB: number;
  wageParamC: number;
  attemptDecay: number;
  sigmoidSlope: number;
  sigmoidMid: number;
  satisfaction: [number, number, number];
  agentTiers: [AgentTierParams, AgentTierParams, AgentTierParams];
  wageMin: number;
  wageMax: number;
  maxAttempts: number;
  youngBlendAge: number;
  renewalRaise: [number, number];
}

function num(v: number | null, fallback: number): number {
  return Number.isFinite(v) ? (v as number) : fallback;
}

const DEFAULT_TIERS: [AgentTierParams, AgentTierParams, AgentTierParams] = [
  { threshold: 0.15, probability: 0.3 },
  { threshold: 0.25, probability: 0.5 },
  { threshold: 0.35, probability: 0.7 },
];

function parseTiers(raw: unknown): [AgentTierParams, AgentTierParams, AgentTierParams] {
  if (!Array.isArray(raw) || raw.length !== 3) return DEFAULT_TIERS;
  const tiers = raw.map((row) => {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const threshold = Number(row[0]);
    const probability = Number(row[1]);
    if (!Number.isFinite(threshold) || !Number.isFinite(probability)) return null;
    return { threshold, probability };
  });
  if (tiers.some((t) => t === null)) return DEFAULT_TIERS;
  return tiers as [AgentTierParams, AgentTierParams, AgentTierParams];
}

export async function loadNegotiationContext(db: D1Database): Promise<NegotiationContext> {
  const config = createConfigService(db);
  const [a, b, c, decay, slope, mid, satisfaction, tiersRaw, wageMin, wageMax, maxAttempts, youngBlendAge, renewalRaiseRaw] = await Promise.all([
    config.getNumber('wage_param_a'),
    config.getNumber('wage_param_b'),
    config.getNumber('wage_param_c'),
    config.getNumber('attempt_decay'),
    config.getNumber('sigmoid_slope'),
    config.getNumber('sigmoid_mid'),
    config.getNumberList('satisfaction_thresholds'),
    config.getJson('agent_tiers'),
    config.getNumber('wage_min'),
    config.getNumber('wage_max'),
    config.getNumber('max_attempts'),
    config.getNumber('young_blend_age'),
    config.getNumberList('renewal_raise'),
  ]);
  const sat = satisfaction && satisfaction.length === 3 ? satisfaction : [0.25, 0.6, 0.9];
  const raise = renewalRaiseRaw && renewalRaiseRaw.length === 2 ? renewalRaiseRaw : [0.05, 0.15];
  return {
    wageParamA: num(a, 0.02),
    wageParamB: num(b, 1.9),
    wageParamC: num(c, 0.45),
    attemptDecay: num(decay, 0.95),
    sigmoidSlope: num(slope, -9),
    sigmoidMid: num(mid, 0.8),
    satisfaction: [sat[0], sat[1], sat[2]],
    agentTiers: parseTiers(tiersRaw),
    wageMin: num(wageMin, 0.01),
    wageMax: num(wageMax, 20),
    maxAttempts: Math.max(1, Math.trunc(num(maxAttempts, 3))),
    youngBlendAge: num(youngBlendAge, 25),
    renewalRaise: [num(raise[0], 0.05), num(raise[1], 0.15)],
  };
}
