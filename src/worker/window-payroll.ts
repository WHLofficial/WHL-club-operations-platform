// 窗末结算扣款（v1.4.0，TECH_DESIGN §11「窗口 closed 触发结算」；v3.0.0 按窗类型分支）：
// 常规窗（is_temporary=0）：富人税 → 工资。工资 = Σ现行合同（is_active=1）wage（m/半赛季，一窗全额；
//   训练营合同 wage 存 0.75 同口径），未达级别下限（帽值−15 = 顶级 53 / 次级 43，用户令 2026-10-06）按下限扣；
//   CPU 队不入账（用户令 2026-10-06）——工资与富人税都跳过。
// 临时窗（is_temporary=1）：只扣富人税，工资不扣（规则口径：临时窗不是半赛季节点）。
// 富人税（§9.2）= max(资金>125m → 资金×20%，球队价值(ΣRC+资金)>700m → 价值×5%)；
//   税基含未扣工资（v3.0.0 裁决：税最先扣，balance 不减本窗工资），故流水顺序税在前。
// 维护费在 home.ts 的 windowHomeStatements（临时窗照收，按本窗主场数）；余额可扣成负（欠账下窗自然补扣）；
// 假设 28：富人税只在窗末收，赛季结算不重复收。
// 幂等：ledgerMovement 幂等闸按 (club_id, kind, ref_type, ref_id)，ref_type='window'、ref_id=season*100+windowSeq；
// 关窗批的窗口状态 UPDATE 行数做原子闸，闸 0 行=关窗已并发完成、同批扣款一并回滚。
import type { Env } from './env.ts';
import { createConfigService } from '../core/config.ts';
import { DEFAULT_WAGE_CAP_BY_TIER, WAGE_FLOOR_GAP } from '../core/squad-rules.ts';
import { cpuClubIds } from './growth.ts';
import { ledgerMovement } from './ledger.ts';
import { deriveClubTiers, type Tier } from './tier.ts';

export interface PayrollSummary {
  wageClubs: number;
  wageTotal: number;
  taxClubs: number;
  taxTotal: number;
  /** 触发级别下限（帽值−15）按下限扣的队数（v6.39.0） */
  wageFloorClubs: number;
}

export interface PayrollOptions {
  /** 是否扣工资（常规窗 true、临时窗 false） */
  chargeWages: boolean;
}

export async function windowPayrollStatements(
  env: Env,
  season: number,
  windowSeq: number,
  opts: PayrollOptions,
): Promise<{ statements: ReturnType<Env['DB']['prepare']>[]; summary: PayrollSummary }> {
  const db = env.DB;
  const refId = season * 100 + windowSeq;
  const movements: { clubId: number; delta: number; kind: 'wage' | 'luxury_tax'; memo: string }[] = [];
  // CPU 队不入账（用户令 2026-10-06「cpu也不扣工资」，与奖金/主场收入/拍卖同口径）：工资与富人税都跳过
  const cpuIds = await cpuClubIds(db);

  // 工资：现行合同（is_active=1）逐俱乐部汇总扣款；临时窗不扣
  const wages = opts.chargeWages
    ? await db
        .prepare(
          `SELECT ct.club_id, COALESCE(SUM(ct.wage), 0) AS total, COUNT(*) AS n
           FROM contracts ct WHERE ct.is_active = 1 AND ct.club_id IS NOT NULL AND ct.wage IS NOT NULL
           GROUP BY ct.club_id`,
        )
        .all<{ club_id: number; total: number; n: number }>()
    : { results: [] as { club_id: number; total: number; n: number }[] };

  // 富人税：税基 = 当前余额（含未扣工资，税最先扣）+ 球队价值（ΣRC + 余额）
  const config = createConfigService(db);
  const cashThreshold = (await config.getNumber('luxury_cash_threshold')) ?? 125;
  const cashRate = (await config.getNumber('luxury_cash_rate')) ?? 0.2;
  const valueThreshold = (await config.getNumber('luxury_value_threshold')) ?? 700;
  const valueRate = (await config.getNumber('luxury_value_rate')) ?? 0.05;
  const clubs = await db
    .prepare(
      `SELECT a.club_id, a.balance,
              COALESCE((SELECT SUM(ct.release_fee) FROM contracts ct WHERE ct.club_id = a.club_id AND ct.is_active = 1), 0) AS rc_total
       FROM ledger_accounts a`,
    )
    .all<{ club_id: number; balance: number; rc_total: number }>();
  for (const c of clubs.results) {
    if (cpuIds.has(c.club_id)) continue;
    const cashBase = c.balance;
    const valueBase = c.balance + c.rc_total;
    const tax1 = cashBase > cashThreshold ? cashBase * cashRate : 0;
    const tax2 = valueBase > valueThreshold ? valueBase * valueRate : 0;
    const tax = Math.round(Math.max(tax1, tax2) * 100) / 100;
    if (tax > 0) {
      movements.push({
        clubId: c.club_id,
        delta: -tax,
        kind: 'luxury_tax',
        memo: `富人税（资金 ${Math.round(cashBase * 100) / 100}m、球队价值 ${Math.round(valueBase * 100) / 100}m，两项取多）`,
      });
    }
  }
  // 扣工资下限（v6.39.0，用户令 2026-10-06）：实扣 = max(Σ现行合同工资, 级别帽值−15)；
  // 未定级（报名派生不出级别）不适用下限，照旧按 Σ 工资扣。
  const capJson = await config.getJson<Partial<Record<Tier, number>>>('wage_cap');
  const payableClubs = wages.results.filter((w) => w.total > 0 && !cpuIds.has(w.club_id));
  const tiers = await deriveClubTiers(env, season, payableClubs.map((w) => w.club_id));
  let wageFloorClubs = 0;
  for (const w of payableClubs) {
    const total = Math.round(w.total * 100) / 100;
    const tier = tiers.get(w.club_id) ?? null;
    const cap = tier === null ? null : capJson?.[tier] ?? DEFAULT_WAGE_CAP_BY_TIER[tier];
    const floor = cap === null ? null : cap - WAGE_FLOOR_GAP;
    const charge = floor !== null && total < floor ? floor : total;
    if (charge > total) wageFloorClubs += 1;
    const floorNote = charge > total ? `；未达${tier === 'premier' ? '顶级' : '次级'}下限 ${charge} m，按下限扣` : '';
    movements.push({
      clubId: w.club_id,
      delta: -charge,
      kind: 'wage',
      memo: `球员工资（S${season} 第 ${windowSeq} 窗，${w.n} 人现行合同${floorNote}）`,
    });
  }

  const wageMoves = movements.filter((m) => m.kind === 'wage');
  const taxMoves = movements.filter((m) => m.kind === 'luxury_tax');
  /** 归一 -0（空数组求和会得到 -0，序列化与断言都别扭） */
  const round2 = (n: number): number => {
    const v = Math.round(n * 100) / 100;
    return v === 0 ? 0 : v;
  };
  const summary: PayrollSummary = {
    wageClubs: wageMoves.length,
    wageTotal: round2(-wageMoves.reduce((s, m) => s + m.delta, 0)),
    taxClubs: taxMoves.length,
    taxTotal: round2(-taxMoves.reduce((s, m) => s + m.delta, 0)),
    wageFloorClubs,
  };
  const statements = movements.flatMap((m) =>
    ledgerMovement(db, { clubId: m.clubId, delta: m.delta, kind: m.kind, refType: 'window', refId, memo: m.memo }),
  );
  return { statements, summary };
}
