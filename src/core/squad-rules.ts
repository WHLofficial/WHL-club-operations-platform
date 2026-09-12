// 阵容注册合规引擎（规则 4.2 + PRD §4.3）：纯函数，注册提交校验与管理端体检共用。
// 口径：一线队 squad_min-squad_max 人含 ≥gk_min 门将；训练营 ≤trainee_max 人且可成长（PA−CA＞0）；
// CA/PA 梯度按俱乐部级别，以**初始CA**计（规则 4.2.2 原文；= players.base_ca，裁决：跟随 FC 源
// 刷新 = §10.4 非平台成长所得 CA），CA≥87 计数含 CA≥90；工资帽按半赛季（P1，null=未配置跳过）。

export const TRAINEE_WAGE = 0.75; // 训练营合同固定工资（m/半赛季，规则 4.3.4）
export const TRAINEE_RC = 5; // 训练营合同固定违约金（m，规则 4.3.4：激活倍数固定 1 倍与其对齐）
export const S1_GROWABLE_AGE_CAP = 25; // 规则 4.1.1：第一赛季 ≤25 岁为可成长球员（S2≤24/S3+≤23 由赛季结算重判）

export interface SquadLimits {
  ge90: number;
  ge87: number;
  growthPa87: number;
}

// 规则 4.2.2 的梯度原文（config 表可用同名键覆盖）
export const DEFAULT_CA_PA_LIMITS: Record<'premier' | 'second', SquadLimits> = {
  premier: { ge90: 1, ge87: 4, growthPa87: 6 },
  second: { ge90: 1, ge87: 3, growthPa87: 6 },
};

export interface SquadPlayer {
  playerId: number;
  name: string;
  position: string | null;
  ca: number | null;
  pa: number | null;
  /** 初始CA（base_ca，随 FC 源刷新；缺省回退当前 CA）。规则 4.2.2 的梯度口径 */
  initialCa: number | null;
  growable: boolean;
  hasContract: boolean;
  wage: number | null;
}

export interface SquadRuleContext {
  tier: 'premier' | 'second' | null;
  limits: SquadLimits;
  squadMin: number;
  squadMax: number;
  gkMin: number;
  traineeMax: number;
  wageCap: number | null;
}

export type SquadIssueRule =
  | 'squad_size'
  | 'gk'
  | 'trainee_size'
  | 'trainee_growth'
  | 'ca_pa'
  | 'wage_cap'
  | 'contract';

export interface SquadIssue {
  rule: SquadIssueRule;
  message: string;
  playerIds: number[];
}

export interface SquadStats {
  firstTeam: number;
  trainee: number;
  goalkeepers: number;
  ge90: number;
  ge87: number;
  growthPa87: number;
  wageTotal: number;
}

export interface SquadCheckResult {
  pass: boolean;
  issues: SquadIssue[];
  stats: SquadStats;
}

const TIER_LABEL: Record<'premier' | 'second', string> = { premier: '顶级联赛', second: '次级联赛' };

// 报错点名：最多列 5 人，更多的用「等」收尾
function nameList(players: SquadPlayer[]): string {
  const names = players.map((p) => p.name);
  if (names.length <= 5) return names.join('、');
  return `${names.slice(0, 5).join('、')} 等 ${names.length} 人`;
}

export function checkSquad(firstTeam: SquadPlayer[], trainee: SquadPlayer[], ctx: SquadRuleContext): SquadCheckResult {
  const issues: SquadIssue[] = [];
  const stats: SquadStats = {
    firstTeam: firstTeam.length,
    trainee: trainee.length,
    goalkeepers: firstTeam.filter((p) => p.position === 'GK').length,
    ge90: 0,
    ge87: 0,
    growthPa87: 0,
    wageTotal: 0,
  };

  if (stats.firstTeam < ctx.squadMin || stats.firstTeam > ctx.squadMax) {
    issues.push({
      rule: 'squad_size',
      message: `一线队注册人数须在 ${ctx.squadMin}-${ctx.squadMax} 人之间，当前 ${stats.firstTeam} 人`,
      playerIds: [],
    });
  }
  if (stats.goalkeepers < ctx.gkMin) {
    issues.push({
      rule: 'gk',
      message: `一线队须至少注册 ${ctx.gkMin} 名门将，当前 ${stats.goalkeepers} 名`,
      playerIds: [],
    });
  }
  if (stats.trainee > ctx.traineeMax) {
    issues.push({
      rule: 'trainee_size',
      message: `训练营最多注册 ${ctx.traineeMax} 人，当前 ${stats.trainee} 人`,
      playerIds: [],
    });
  }
  const badTrainee = trainee.filter((p) => !p.growable || p.pa === null || p.ca === null || p.pa - p.ca <= 0);
  if (badTrainee.length > 0) {
    issues.push({
      rule: 'trainee_growth',
      message: `训练营球员必须可成长且 PA−CA＞0：${nameList(badTrainee)}`,
      playerIds: badTrainee.map((p) => p.playerId),
    });
  }

  if (ctx.tier !== null) {
    const ge90 = firstTeam.filter((p) => p.initialCa !== null && p.initialCa >= 90);
    const ge87 = firstTeam.filter((p) => p.initialCa !== null && p.initialCa >= 87);
    // 「可成长球员」按 4.1.1 的正式定义（年龄判定，赛季结算冻结为 growable 标记）；
    // 训练营条款才额外要求 PA−CA＞0，第三档不要求——长满的球员仍占坑
    const growth = firstTeam.filter(
      (p) => p.initialCa !== null && p.pa !== null && p.initialCa < 87 && p.pa >= 87 && p.growable,
    );
    stats.ge90 = ge90.length;
    stats.ge87 = ge87.length;
    stats.growthPa87 = growth.length;
    if (ge90.length > ctx.limits.ge90) {
      issues.push({
        rule: 'ca_pa',
        message: `${TIER_LABEL[ctx.tier]}一线队初始CA≥90 的球员最多 ${ctx.limits.ge90} 名，当前 ${ge90.length} 名：${nameList(ge90)}`,
        playerIds: ge90.map((p) => p.playerId),
      });
    }
    if (ge87.length > ctx.limits.ge87) {
      issues.push({
        rule: 'ca_pa',
        message: `一线队初始CA≥87 的球员最多 ${ctx.limits.ge87} 名（含初始CA≥90），当前 ${ge87.length} 名：${nameList(ge87)}`,
        playerIds: ge87.map((p) => p.playerId),
      });
    }
    if (growth.length > ctx.limits.growthPa87) {
      issues.push({
        rule: 'ca_pa',
        message: `一线队初始CA＜87 且 PA≥87 的可成长球员最多 ${ctx.limits.growthPa87} 名，当前 ${growth.length} 名：${nameList(growth)}`,
        playerIds: growth.map((p) => p.playerId),
      });
    }
  }

  const noContract = [...firstTeam, ...trainee].filter((p) => !p.hasContract);
  if (noContract.length > 0) {
    issues.push({
      rule: 'contract',
      message: `这些球员还没有现行合同（等管理组导入合同模板）：${nameList(noContract)}`,
      playerIds: noContract.map((p) => p.playerId),
    });
  }

  for (const p of [...firstTeam, ...trainee]) stats.wageTotal += p.wage ?? 0;
  if (ctx.wageCap !== null && stats.wageTotal > ctx.wageCap) {
    issues.push({
      rule: 'wage_cap',
      message: `注册球员工资合计 ${stats.wageTotal.toFixed(2)} m/半赛季，超出工资帽 ${ctx.wageCap} m`,
      playerIds: [],
    });
  }

  return { pass: issues.length === 0, issues, stats };
}
