// 名单视图（v6.67.0 D1/D7）：名单不再由教练手动维护，而是**由现行合同推导**——
// contract_type='formal' → 一线队，'trainee' → 训练营，没有本队 active 合同 → 未签约区。
// 归属与合同永远同源（players.club_id = contracts.club_id），所以「窗口期买进的人看不见」
// 这类漂移不可能再发生。registrations 表降级为关窗存档（D3），读路径不再依赖它。
import type { SquadPlayer } from '../core/squad-rules.ts';
import { sqlDisplayName } from '../core/player-name.ts';
import { createConfigService } from '../core/config.ts';
import { serviceSeasons } from '../core/bypass-rules.ts';

/** 一行的形状：既够 checkSquad 用（SquadPlayer），也带展示需要的 status / releaseFee */
export interface SquadViewRow extends SquadPlayer {
  clubId: number;
  status: string;
  releaseFee: number | null;
}

export interface SquadView {
  /** 一线队（formal 合同） */
  firstTeam: SquadViewRow[];
  /** 训练营（trainee 合同） */
  trainee: SquadViewRow[];
  /** 未签约：本队、未退役、但没有本队 active 合同（不占人数、不计工资，D2） */
  unsigned: SquadViewRow[];
}

interface Row {
  player_id: number;
  club_id: number;
  name: string;
  position: string | null;
  ca: number | null;
  pa: number | null;
  base_ca: number | null;
  growable: number;
  status: string;
  contract_player_id: number | null;
  wage: number | null;
  release_fee: number | null;
  contract_type: string | null;
}

function selectSql(where: string): string {
  return `SELECT p.id AS player_id, p.club_id, ${sqlDisplayName('p')} AS name, p.position, p.ca, p.pa, p.base_ca, p.growable, p.status,
                 ct.player_id AS contract_player_id, ct.wage, ct.release_fee, ct.contract_type
          FROM players p
          LEFT JOIN contracts ct ON ct.player_id = p.id AND ct.is_active = 1 AND ct.club_id = p.club_id
          WHERE ${where}
          ORDER BY p.id`;
}

function toRow(r: Row): SquadViewRow {
  const hasContract = r.contract_player_id !== null;
  const contractType: 'formal' | 'trainee' | null =
    r.contract_type === 'trainee' ? 'trainee' : r.contract_type === 'formal' ? 'formal' : null;
  return {
    clubId: r.club_id,
    playerId: r.player_id,
    name: r.name,
    position: r.position,
    ca: r.ca,
    pa: r.pa,
    // 规则 4.2.2 的梯度口径：初始 CA 缺省回退现值（与 routes/players.ts 同源）
    initialCa: r.base_ca ?? r.ca,
    growable: r.growable === 1,
    hasContract,
    contractType,
    wage: hasContract ? r.wage ?? 0 : null,
    releaseFee: hasContract ? r.release_fee : null,
    status: r.status,
  };
}

function bucket(rows: SquadViewRow[]): SquadView {
  const view: SquadView = { firstTeam: [], trainee: [], unsigned: [] };
  for (const row of rows) {
    if (!row.hasContract) view.unsigned.push(row);
    else if (row.contractType === 'trainee') view.trainee.push(row);
    // 合同类型只有 formal / trainee 两值；脏值按 formal 归一线队，宁可多算人数也不让人凭空消失
    else view.firstTeam.push(row);
  }
  return view;
}

/** 单队名单视图。退役球员不进名单（与旧提交口径一致：退役不能注册）。 */
export async function loadSquadView(db: D1Database, clubId: number): Promise<SquadView> {
  const rows = await db
    .prepare(selectSql("p.club_id = ? AND p.status <> 'retired'"))
    .bind(clubId)
    .all<Row>();
  return bucket(rows.results.map(toRow));
}

/** 多队一次取（管理端看板/报表用，避免 20 次往返）。返回按 clubId 分组的视图。 */
export async function loadSquadViews(db: D1Database, clubIds: number[]): Promise<Map<number, SquadView>> {
  const out = new Map<number, SquadView>();
  if (clubIds.length === 0) return out;
  const ph = clubIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(selectSql(`p.club_id IN (${ph}) AND p.status <> 'retired'`))
    .bind(...clubIds)
    .all<Row>();
  const grouped = new Map<number, SquadViewRow[]>();
  for (const r of rows.results) {
    const row = toRow(r);
    const list = grouped.get(row.clubId);
    if (list) list.push(row);
    else grouped.set(row.clubId, [row]);
  }
  for (const id of clubIds) out.set(id, bucket(grouped.get(id) ?? []));
  return out;
}

/** 视图行 → checkSquad 需要的形状（未签约行不进体检：D2） */
export function toSquadPlayer(row: SquadViewRow): SquadPlayer {
  return {
    playerId: row.playerId,
    name: row.name,
    position: row.position,
    ca: row.ca,
    pa: row.pa,
    initialCa: row.initialCa,
    growable: row.growable,
    hasContract: row.hasContract,
    contractType: row.contractType,
    wage: row.wage,
  };
}

/**
 * 预计忠诚支出（规则 4.3.2）：只在中期末窗关窗时扣，按关窗后的窗刻度算效力
 * （1 个常规窗 = 0.5 赛季），取满足的最高档 × 合同违约金。这里按「现行合同不变、
 * 下一个常规窗就是中期窗」预演一次，只做展示，不落账。
 *
 * 与 `src/worker/season-settle.ts` 的 `loyaltyMovements` 同口径（同 config 键、同取档规则、
 * 同两位小数舍入口径），差别只是不写流水。
 */
export async function projectLoyaltyExpense(
  db: D1Database,
  clubId: number,
  ticksAfterClose: number,
): Promise<{ total: number; count: number }> {
  const tiersRaw = await createConfigService(db).get('loyalty_tiers');
  const tiers = (tiersRaw ? JSON.parse(tiersRaw) : [[0.5, 0.05], [1.5, 0.1], [2.5, 0.2], [3.5, 0]]) as [number, number][];
  tiers.sort((a, b) => a[0] - b[0]);
  const contracts = await db
    .prepare(
      `SELECT release_fee, service_ticks FROM contracts
       WHERE is_active = 1 AND club_id = ? AND release_fee IS NOT NULL`,
    )
    .bind(clubId)
    .all<{ release_fee: number; service_ticks: number | null }>();
  let total = 0;
  let count = 0;
  for (const ct of contracts.results) {
    const seasons = serviceSeasons(ct.service_ticks ?? 0, ticksAfterClose);
    let rate = 0;
    for (const [minSeasons, r] of tiers) if (seasons >= minSeasons) rate = r;
    if (rate <= 0 || ct.release_fee <= 0) continue;
    total = Math.round((total + Math.round(ct.release_fee * rate * 100) / 100) * 100) / 100;
    count += 1;
  }
  return { total, count };
}
