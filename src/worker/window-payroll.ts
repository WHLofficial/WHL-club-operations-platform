// 窗末结算扣款（增量 11，TECH_DESIGN §11「窗口 closed 触发结算」；增量 25 按窗类型分支）：
// 常规窗（is_temporary=0）：富人税 → 工资。工资 = Σ现行合同（is_active=1）wage（m/半赛季，一窗全额；
//   训练营合同 wage 存 0.75 同口径）。
// 临时窗（is_temporary=1）：只扣富人税，工资不扣（规则口径：临时窗不是半赛季节点）。
// 富人税（§9.2）= max(资金>125m → 资金×20%，球队价值(ΣRC+资金)>700m → 价值×5%)；
//   税基含未扣工资（增量 25 裁决：税最先扣，balance 不减本窗工资），故流水顺序税在前。
// 维护费在 home.ts 的 windowHomeStatements（临时窗照收，按本窗主场数）；余额可扣成负（欠账下窗自然补扣）；
// 假设 28：富人税只在窗末收，赛季结算不重复收。
// 幂等：ledgerMovement 幂等闸按 (club_id, kind, ref_type, ref_id)，ref_type='window'、ref_id=season*100+windowSeq；
// 关窗批的窗口状态 UPDATE 行数做原子闸，闸 0 行=关窗已并发完成、同批扣款一并回滚。
import type { Env } from './env.ts';
import { createConfigService } from '../core/config.ts';
import { ledgerMovement } from './ledger.ts';

export interface PayrollSummary {
  wageClubs: number;
  wageTotal: number;
  taxClubs: number;
  taxTotal: number;
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
  for (const w of wages.results) {
    if (w.total <= 0) continue;
    movements.push({ clubId: w.club_id, delta: -Math.round(w.total * 100) / 100, kind: 'wage', memo: `球员工资（S${season} 第 ${windowSeq} 窗，${w.n} 人现行合同）` });
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
  };
  const statements = movements.flatMap((m) =>
    ledgerMovement(db, { clubId: m.clubId, delta: m.delta, kind: m.kind, refType: 'window', refId, memo: m.memo }),
  );
  return { statements, summary };
}
