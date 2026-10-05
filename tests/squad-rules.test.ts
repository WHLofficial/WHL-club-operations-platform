// 合规引擎单测（规则 4.2）：人数/门将/训练营/CA·PA 梯度/工资帽/合同
import { describe, expect, it } from 'vitest';
import { checkSquad, DEFAULT_CA_PA_LIMITS, MARKER_WEIGHT, markerOf, markerWeightSql, parseRegistrationCheckMode, TRAINEE_WAGE, type SquadPlayer, type SquadRuleContext } from '../src/core/squad-rules.ts';

function player(overrides: Partial<SquadPlayer> = {}): SquadPlayer {
  return {
    playerId: 1,
    name: '球员一',
    position: 'CM',
    ca: 80,
    pa: 85,
    initialCa: 80,
    growable: true,
    hasContract: true,
    wage: 1,
    ...overrides,
  };
}

function ctx(overrides: Partial<SquadRuleContext> = {}): SquadRuleContext {
  return {
    tier: 'premier',
    limits: DEFAULT_CA_PA_LIMITS.premier,
    squadMin: 20,
    squadMax: 30,
    gkMin: 1,
    traineeMax: 7,
    wageCap: null,
    ...overrides,
  };
}

// 拼一支默认合规的一线队：n 人，1 门将，工资统一 wage
function firstTeam(n: number, wage = 1, overrides: Partial<SquadPlayer> = {}): SquadPlayer[] {
  return Array.from({ length: n }, (_, i) =>
    player({
      playerId: i + 1,
      name: `球员${i + 1}`,
      position: i === 0 ? 'GK' : 'CM',
      ca: 80,
      pa: 85,
      wage,
      ...overrides,
    }),
  );
}

describe('阵容注册合规引擎（规则 4.2）', () => {
  it('20 人含门将的合规名单通过，统计口径正确', () => {
    const res = checkSquad(firstTeam(20), [], ctx());
    expect(res.pass).toBe(true);
    expect(res.issues).toEqual([]);
    expect(res.stats).toMatchObject({ firstTeam: 20, trainee: 0, goalkeepers: 1, ge90: 0, ge87: 0, growthPa87: 0, wageTotal: 20 });
  });

  it('人数不足与超限各报一条可读错误', () => {
    const few = checkSquad(firstTeam(19), [], ctx());
    expect(few.pass).toBe(false);
    expect(few.issues[0]).toMatchObject({ rule: 'squad_size', message: '一线队注册人数须在 20-30 人之间，当前 19 人' });

    const many = checkSquad(firstTeam(31), [], ctx());
    expect(many.issues[0]).toMatchObject({ rule: 'squad_size', message: '一线队注册人数须在 20-30 人之间，当前 31 人' });
  });

  it('没有门将被拒', () => {
    const res = checkSquad(firstTeam(20, 1, { position: 'ST' }), [], ctx());
    expect(res.issues).toEqual([expect.objectContaining({ rule: 'gk', message: '一线队须至少注册 1 名门将，当前 0 名' })]);
  });

  it('训练营超 7 人被拒', () => {
    const trainee = Array.from({ length: 8 }, (_, i) => player({ playerId: 100 + i, name: `青训${i + 1}`, ca: 60, pa: 75 }));
    const res = checkSquad(firstTeam(20), trainee, ctx());
    expect(res.issues).toEqual([expect.objectContaining({ rule: 'trainee_size', message: '训练营最多注册 7 人，当前 8 人' })]);
  });

  it('训练营球员不可成长或 PA−CA≤0 被拒（点到名）', () => {
    const trainee = [
      player({ playerId: 101, name: '张三', ca: 60, pa: 75 }),
      player({ playerId: 102, name: '李四', growable: false, ca: 60, pa: 75 }),
      player({ playerId: 103, name: '王五', ca: 70, pa: 70 }),
    ];
    const res = checkSquad(firstTeam(20), trainee, ctx());
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].rule).toBe('trainee_growth');
    expect(res.issues[0].message).toContain('李四、王五');
    expect(res.issues[0].playerIds).toEqual([102, 103]);
  });

  it('初始CA≥90 超过 1 名被拒（顶级）', () => {
    const team = firstTeam(20);
    team[1] = player({ playerId: 2, name: '巨星甲', position: 'ST', initialCa: 91, ca: 91, pa: 95 });
    team[2] = player({ playerId: 3, name: '巨星乙', position: 'CAM', initialCa: 90, ca: 90, pa: 93 });
    const res = checkSquad(team, [], ctx());
    const caIssue = res.issues.filter((i) => i.rule === 'ca_pa');
    expect(caIssue).toHaveLength(1); // ≥87 只有 2 名，没超
    expect(caIssue[0].message).toContain('顶级联赛一线队初始CA≥90 的球员最多 1 名，当前 2 名');
    expect(caIssue[0].playerIds).toEqual([2, 3]);
  });

  it('梯度按初始CA计：入会后长到 90 的球员不占 ≥90/≥87 档', () => {
    const team = firstTeam(20);
    // 入会时 86，已长到 92：不占 ≥90/≥87 档（练满不占第三档见下一条专测）
    team[1] = player({ playerId: 2, name: '成长股', initialCa: 86, ca: 92, pa: 92 });
    const res = checkSquad(team, [], ctx());
    expect(res.stats.ge90).toBe(0);
    expect(res.stats.ge87).toBe(0);
    expect(res.issues).toHaveLength(0);
  });

  it('练满（现值 ca >= pa）不占 growth 名额，未练满的对照仍占（v6.26.1 拍板）', () => {
    const team = firstTeam(20);
    // initialCa 86＜87、PA 90≥87、growable=true，但 ca=pa=90 已练满 → 不计入 growthPa87、无 issue
    team[1] = player({ playerId: 2, name: '练满', initialCa: 86, ca: 90, pa: 90 });
    const maxed = checkSquad(team, [], ctx());
    expect(maxed.stats.growthPa87).toBe(0);
    expect(maxed.issues).toHaveLength(0);
    // 未练满对照（ca 88 < pa 90）计入第三档
    team[2] = player({ playerId: 3, name: '未练满', initialCa: 86, ca: 88, pa: 90 });
    const mixed = checkSquad(team, [], ctx());
    expect(mixed.stats.growthPa87).toBe(1);
    expect(mixed.issues).toHaveLength(0);
  });

  it('初始CA≥87 梯度：顶级 4 名上限，次级 3 名（计数含 ≥90）', () => {
    const team = firstTeam(20);
    team[1] = player({ playerId: 2, name: '球员2', position: 'ST', initialCa: 89, ca: 89, pa: 92 });
    team[2] = player({ playerId: 3, name: '球员3', position: 'CAM', initialCa: 88, ca: 88, pa: 90 });
    team[3] = player({ playerId: 4, name: '球员4', position: 'CB', initialCa: 87, ca: 87, pa: 89 });
    team[4] = player({ playerId: 5, name: '球员5', position: 'GK', initialCa: 91, ca: 91, pa: 93 });
    team[5] = player({ playerId: 6, name: '球员6', position: 'CM', initialCa: 87, ca: 87, pa: 88 });
    // 顶级：≥90=1 没超，≥87=5 > 4 → 一条
    const premier = checkSquad(team, [], ctx({ tier: 'premier', limits: DEFAULT_CA_PA_LIMITS.premier }));
    expect(premier.issues.map((i) => i.message)).toEqual([
      '一线队初始CA≥87 的球员最多 4 名（含初始CA≥90），当前 5 名：球员2、球员3、球员4、球员5、球员6',
    ]);
    // 次级：≥87=5 > 3 → 同样一条，幅度不同
    const second = checkSquad(team, [], ctx({ tier: 'second', limits: DEFAULT_CA_PA_LIMITS.second }));
    expect(second.issues.map((i) => i.message)).toEqual([
      '一线队初始CA≥87 的球员最多 3 名（含初始CA≥90），当前 5 名：球员2、球员3、球员4、球员5、球员6',
    ]);
  });

  it('初始CA＜87 且 PA≥87 的可成长球员超过 6 名被拒', () => {
    const team = firstTeam(20);
    for (let i = 1; i <= 7; i++) team[i] = player({ playerId: i + 1, name: `高潜${i}`, initialCa: 80, ca: 80, pa: 88 });
    const res = checkSquad(team, [], ctx());
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].message).toContain('初始CA＜87 且 PA≥87 的可成长球员最多 6 名，当前 7 名');
    // 不可成长的不计入该档
    const withStub = [...team];
    withStub[1] = player({ playerId: 2, growable: false, initialCa: 80, ca: 80, pa: 88 });
    expect(checkSquad(withStub, [], ctx()).issues).toHaveLength(0);
  });

  it('工资帽：配置后超限被拒，未配置（null）跳过', () => {
    const team = firstTeam(20, 2);
    const capped = checkSquad(team, [], ctx({ wageCap: 30 }));
    expect(capped.issues).toHaveLength(1);
    expect(capped.issues[0].rule).toBe('wage_cap');
    expect(capped.issues[0].message).toContain('工资合计 40.00 m/半赛季，超出工资帽 30 m');
    expect(checkSquad(team, [], ctx({ wageCap: null })).issues).toHaveLength(0);
    // 训练营工资也计入
    const withTrainee = checkSquad(firstTeam(20, 2), [player({ playerId: 99, wage: TRAINEE_WAGE })], ctx({ wageCap: 40 }));
    expect(withTrainee.issues).toHaveLength(1);
    expect(withTrainee.issues[0].rule).toBe('wage_cap');
  });

  it('缺现行合同被拒（一线队与训练营都查）', () => {
    const team = firstTeam(20);
    team[5] = player({ playerId: 6, name: '白板', hasContract: false });
    const res = checkSquad(team, [player({ playerId: 101, name: '青训', ca: 60, pa: 75, hasContract: false })], ctx());
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].rule).toBe('contract');
    expect(res.issues[0].message).toContain('白板、青训');
    expect(res.issues[0].playerIds).toEqual([6, 101]);
  });

  it('未设级别的俱乐部跳过 CA/PA 梯度', () => {
    const res = checkSquad(firstTeam(20), [], ctx({ tier: null }));
    expect(res.pass).toBe(true);
    expect(res.stats.ge87).toBe(0);
  });
});

// 标记（v6.5.0）：三档互斥切分的边界。与 checkSquad 的三档计数同口径，改判定两边要一起改
describe('markerOf 三档互斥切分', () => {
  it('🔴 初始CA≥90（90 是下界）', () => {
    expect(markerOf(90, null, false, null)).toBe('ge90');
    expect(markerOf(95, 60, false, 60)).toBe('ge90');
  });

  it('🟡 初始CA 87-89（87 是下界、90 让位给 🔴）', () => {
    expect(markerOf(87, null, false, null)).toBe('ge87');
    expect(markerOf(89, null, false, null)).toBe('ge87');
  });

  it('🟢 初始CA＜87 且 PA≥87 且可成长且未练满（PA 87 是下界、四条件缺一不可）', () => {
    expect(markerOf(86, 87, true, 80)).toBe('growth');
    expect(markerOf(86, 87, true, 86)).toBe('growth');
    expect(markerOf(0, 99, true, 0)).toBe('growth');
    expect(markerOf(86, 86, true, 80)).toBeNull();
    expect(markerOf(86, 87, false, 80)).toBeNull();
    // v6.26.1 未练满：ca < pa 才落绿；ca=87/88/90（练满或反超）→ null（练满去绿标）
    expect(markerOf(86, 87, true, 87)).toBeNull();
    expect(markerOf(86, 87, true, 88)).toBeNull();
    expect(markerOf(86, 87, true, 90)).toBeNull();
  });

  it('不落档 / 初始CA 缺失 / PA 缺失：无标记', () => {
    expect(markerOf(86, 80, true, 80)).toBeNull();
    expect(markerOf(null, 99, true, 90)).toBeNull();
    expect(markerOf(86, null, true, 86)).toBeNull();
    // 现值 CA 缺失（NULL）不落绿：与 SQL 侧 `ca < pa` 的 NULL→ELSE 0 同语义
    expect(markerOf(86, 87, true, null)).toBeNull();
  });

  it('SQL 权重表达式与 JS 判定同源（阈值与权重取自同一常量）', () => {
    const sql = markerWeightSql(true);
    expect(sql).toContain('COALESCE(players.base_ca, players.ca) >= 90');
    expect(sql).toContain(`THEN ${MARKER_WEIGHT.ge90}`);
    expect(sql).toContain(`THEN ${MARKER_WEIGHT.ge87}`);
    expect(sql).toContain(`THEN ${MARKER_WEIGHT.growth}`);
    expect(sql).toContain('players.pa >= 87 AND players.growable = 1 AND players.ca < players.pa');
    // 索引侧（迁移 0061）必须是非限定列名——SQLite 禁止索引表达式里的限定名
    const bare = markerWeightSql(false);
    expect(bare).not.toContain('players.');
    expect(bare).toContain('COALESCE(base_ca, ca) >= 90');
    expect(bare).toContain('pa >= 87 AND growable = 1 AND ca < pa');
  });
});

// 注册校验放行档（v6.33.1）：config 原始值是自由文本，解析必须白名单化——
// 只有 'warn' / 'off' 被原样认下，其余（含 NULL、空串、脏值）一律回落 'enforce'，
// 保证「坏值绝不意外放行」。大小写、前后空格都按「非白名单成员」处理。
describe('parseRegistrationCheckMode 白名单解析', () => {
  it('白名单三值：enforce / warn / off', () => {
    expect(parseRegistrationCheckMode('enforce')).toBe('enforce');
    expect(parseRegistrationCheckMode('warn')).toBe('warn');
    expect(parseRegistrationCheckMode('off')).toBe('off');
  });

  it('缺值与空串回落 enforce（未配置 = 照拦，不是放行）', () => {
    expect(parseRegistrationCheckMode(null)).toBe('enforce');
    expect(parseRegistrationCheckMode(undefined)).toBe('enforce');
    expect(parseRegistrationCheckMode('')).toBe('enforce');
  });

  it('脏值与大小写变体回落 enforce', () => {
    expect(parseRegistrationCheckMode('乱写')).toBe('enforce');
    expect(parseRegistrationCheckMode('ENFORCE')).toBe('enforce');
    expect(parseRegistrationCheckMode('WARN')).toBe('enforce');
    expect(parseRegistrationCheckMode('off ')).toBe('enforce');
  });
});
