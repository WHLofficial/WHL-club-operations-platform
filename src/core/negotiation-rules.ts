// 签约谈判公开规则（规则 4.3.1/4.3.4、TECH_DESIGN §6.7/§6.8）：能力等级映射、成长年龄
// 判定、新违约金合法区间、经纪人性格名。预期工资与成败判定在 Worker 侧涉密模块
// （worker/negotiation-secret.ts），本文件与 web/ 均不得引用（§6.10-1）。

// 训练营合同双固定（规则 4.3.4(1)）：工资 0.75m/半赛季、违约金 5m
export const TRAINEE_WAGE = 0.75;
export const TRAINEE_RELEASE_FEE = 5;

// 经纪人性格（§6.8，公开属性；players.agent_tier）
export const AGENT_TIER_LABELS: Record<number, string> = {
  1: '温和',
  2: '普通',
  3: '苛刻',
};

// CA/PA → 能力等级（十档，§6.7 公开映射表）
export function ratingLevel(rating: number): number {
  if (rating >= 93) return 10;
  if (rating >= 90) return 9;
  if (rating >= 87) return 8;
  if (rating >= 84) return 7;
  if (rating >= 80) return 6;
  if (rating >= 75) return 5;
  if (rating >= 70) return 4;
  if (rating >= 65) return 3;
  if (rating >= 60) return 2;
  return 1;
}

// 能力等级 L：年龄 ≤ 成长年龄取 (CA等级 + PA等级) / 2（可 .5 步进），否则取 CA等级
export function abilityLevel(ca: number, pa: number, age: number, growthAge: number): number {
  const caLevel = ratingLevel(ca);
  if (age <= growthAge) return (caLevel + ratingLevel(pa)) / 2;
  return caLevel;
}

// 新违约金合法区间（规则 4.3.1）：旧 RC ≤ 20 → ±10m；> 20 → ±50%；下限至少 1，整数 m
export function releaseFeeBounds(oldFee: number): [number, number] {
  if (oldFee <= 20) {
    return [Math.max(1, oldFee - 10), oldFee + 10];
  }
  return [Math.max(1, Math.ceil(oldFee * 0.5)), Math.floor(oldFee * 1.5)];
}

/**
 * 谈判作废原因 → 玩家看得懂的一句话（v6.65.4）。
 * 入参是落库原值：`audit_log.action` 与 `audit_log.after` 里的 `reason`。
 * 三条写入点见 negotiations.ts（超时）、bypass.ts（自助取消）、market-intervene.ts（管理介入）。
 */
export function voidReasonText(action: string | null, reason: string | null): string {
  const why = (reason ?? '').trim();
  if (why === 'silence_timeout') return '静默超时自动作废：超过静默时限还没有新报价';
  if (why === 'ops_end') return '时段收口自动作废：谈判时段结束时仍没谈成';
  if (why === 'self_cancel') return '教练自助取消';
  if (action === 'admin_negotiation_void') return why ? `管理组作废：${why}` : '管理组作废';
  if (action === 'negotiation_timeout') return '超时自动作废';
  if (action === 'transfer_self_cancel') return '教练自助取消';
  return why ? `已作废：${why}` : '已作废';
}
