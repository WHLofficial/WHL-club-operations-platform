#!/usr/bin/env node
// 窗口开放节奏 / 时长量化模型（球场档期，Plan A 档位）。
// 无依赖、纯计算、确定性。只读生产快照作为输入；不连库、不写库。
//
// 复跑：
//   node scripts/venue/cadence-model.mjs
//   node scripts/venue/cadence-model.mjs --catalog=legacy --mix=cashMax
//   node scripts/venue/cadence-model.mjs --json
//
// 参数（全部可覆盖）：
//   --catalog=q3|legacy      收入底盘（q3 = 设计文档 §7.1 容量驱动−成本栈；legacy = 现行 config 缺省）
//   --mix=cashMax|balanced   活动分布（cashMax = 每队按净额取最优活动/组合；balanced = 钱/情绪/品牌三轴配比）
//   --saturation=on|off      同窗同活动饱和（on = 第 2 次 ×0.7、第 3 次 ×0.45、第 4 次 ×0.45，作用在 gross，成本按次照付；off = 旧口径）
//   --uptake=0.85            覆盖所有方案的预订率（用于敏感性扫描；不给则用各方案自带假设）
//   --season-days=35         赛季日历天数（S9：2026-09-18 开季，9 轮，按 5 周估）
//   --rounds=9               每赛季轮次（S9 顶级 9 轮 / 次级 8 轮；统一取 9）
//   --home-matches=5.7778    每队每赛季主场场次（生产 match_attendance 104 行 / 18 队）
//   --prize=62.5             每队每赛季已入账奖金（S9：ledger prize 1124.60 / 18）
//   --home-rev=10.4          每队每赛季主场收入（S9：revenue 186.75 / 18）
//   --wage=56.8              每队每常规窗工资（S9：wage 1022.68 / 18；m/半赛季）
//   --poorest-balance=10.79  最穷队起始余额（生产现值；文档 2026-10-17 快照为 2.79）
//   --poorest-home-rev=3.17  最穷队（RB莱比锡）自己赛季主场收入（审计 2026-10-13 实测）
//   --tier=observed|zero     维护费档位（observed = 审计实测档位；zero = 全 0 档）

const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const s = a.slice(2);
    const i = s.indexOf('=');
    const k = i < 0 ? s : s.slice(0, i);
    const v = i < 0 ? 'true' : s.slice(i + 1);
    out[k] = v;
  }
  return out;
}

const ARG = parseArgs(process.argv.slice(2));
const OPT = {
  catalog: ARG.catalog === 'legacy' ? 'legacy' : 'q3',
  mix: ARG.mix === 'balanced' ? 'balanced' : 'cashMax',
  slotsMode: ARG.slots === 'current' ? 'current' : 'planA',
  seasonDays: Number(ARG['season-days'] ?? 35),
  rounds: Number(ARG.rounds ?? 9),
  homeMatches: Number(ARG['home-matches'] ?? 104 / 18),
  prize: Number(ARG.prize ?? 62.5),
  homeRev: Number(ARG['home-rev'] ?? 10.4),
  wage: Number(ARG.wage ?? 56.8),
  poorestBalance: Number(ARG['poorest-balance'] ?? 10.79),
  poorestHomeRev: Number(ARG['poorest-home-rev'] ?? 3.17),
  tier: ARG.tier === 'zero' ? 'zero' : 'observed',
  saturation: ARG.saturation !== 'off',
  esports: ARG.esports !== 'off',
  youthCash: ARG['youth-cash'] === undefined ? 1.0 : Number(ARG['youth-cash']),
  openDayCash: ARG['open-day-cash'] === undefined ? 0.5 : Number(ARG['open-day-cash']),
  uptakeOverride: ARG.uptake === undefined ? null : Number(ARG.uptake),
  json: ARG.json === 'true',
};

// ---- 生产快照（2026-10-19 只读；来源：本轮任务提供的生产数据） ----
// capacity / fans / balance 为生产现值；wage 用联盟均值 56.8（任务给定；审计逐队值见 econ-institution.mjs）
const CLUBS = [
  { id: 1, name: '阿森纳', cap: 12000, fans: 2084.0, balance: 62.18 },
  { id: 2, name: '阿斯顿维拉', cap: 12000, fans: 3057.9, balance: 44.92 },
  { id: 5, name: '切尔西', cap: 22000, fans: 3447.8, balance: 39.51 },
  { id: 9, name: '利物浦', cap: 35000, fans: 4628.7, balance: 147.30 },
  { id: 11, name: '曼联', cap: 22000, fans: 4581.2, balance: 101.72 },
  { id: 13, name: '纽卡斯尔联', cap: 12000, fans: 3689.5, balance: 88.35 },
  { id: 14, name: '诺丁汉森林', cap: 12000, fans: 2858.8, balance: 128.25 },
  { id: 21, name: '拜仁慕尼黑', cap: 35000, fans: 2600.8, balance: 75.60 },
  { id: 33, name: '慕尼黑1860', cap: 12000, fans: 4031.2, balance: 102.58 },
  { id: 45, name: '尤文图斯', cap: 35000, fans: 3309.3, balance: 117.79 },
  { id: 66, name: '里昂', cap: 12000, fans: 4761.2, balance: 103.31 },
  { id: 73, name: '巴黎圣日耳曼', cap: 35000, fans: 4374.9, balance: 145.12 },
  { id: 241, name: '巴塞罗那', cap: 12000, fans: 3546.9, balance: 49.17 },
  { id: 243, name: '皇家马德里', cap: 12000, fans: 2861.2, balance: 54.70 },
  { id: 280, name: '奥林匹亚科斯', cap: 12000, fans: 2137.3, balance: 66.20 },
  { id: 449, name: '皇家贝蒂斯', cap: 17000, fans: 2828.0, balance: 63.84 },
  { id: 110374, name: '佛罗伦萨', cap: 22000, fans: 3938.9, balance: 54.82 },
  { id: 112172, name: 'RB莱比锡', cap: 12000, fans: 1229.0, balance: 10.79 },
];

// 维护费档位（src/core/config.ts:177-181；observed = 审计 2026-10-13 实测档位）
const TIERS = [
  { name: '社区级', base: 2.0, per10k: 0.8 },
  { name: '地区级', base: 3.5, per10k: 0.55 },
  { name: '大区级', base: 8.0, per10k: 0.35 },
  { name: '国家级', base: 11.0, per10k: 0.28 },
  { name: '国际级', base: 14.0, per10k: 0.2 },
];
function tierOf(club) {
  if (OPT.tier === 'zero') return 0;
  // 审计实测：12000/17000 → 0；22000/35000 → 1
  return club.cap >= 22000 ? 1 : 0;
}

// ---- Plan A：档位按容量（已锁定） ----
// <15000 → 2；15000–29999 → 3；≥30000 → 4（档/窗）
function slotsFor(cap) {
  if (OPT.slotsMode === 'current') return 2; // 生产现状：config.activity_slots 缺省 2
  if (cap < 15000) return 2;
  if (cap < 30000) return 3;
  return 4;
}
function tierLabel(cap) {
  if (cap < 15000) return '小';
  if (cap < 30000) return '中';
  return '大';
}

// ---- 活动收入底盘 ----
// legacy：现行 config 缺省（src/core/config.ts:217-223）；演唱会用期望值（3–8 均值 5.5，
//   损坏 15% × (2–5 均值 3.5) = 0.525），即 §1.3 的净 4.975。
// q3：设计文档 §7.1 的容量驱动 − 成本栈（示意系数，P0 精调）；
//   concert gross 0.00015×cap − (0.8 + 0.00002×cap)
//   esports gross 0.00008×cap − (0.3 + 0.00001×cap)
//   open_day 0.5；youth_camp 1.0（青训 0 级）
// 饱和作用在 gross 上、成本按次照付（Plan A 收口 §饱和耦合）。
function activityParts(catalog, key, cap) {
  if (catalog === 'legacy') {
    if (key === 'concert') return { gross: 5.5, cost: 0.525 }; // 成本 = 期望草皮损坏
    if (key === 'esports') return { gross: 3.0, cost: 0 };
    if (key === 'open_day') return { gross: 0.5, cost: 0 };
    if (key === 'youth_camp') return { gross: 1.0, cost: 0 };
    return { gross: 0, cost: 0 };
  }
  if (key === 'concert') return { gross: 0.00015 * cap, cost: 0.8 + 0.00002 * cap };
  if (key === 'esports') return OPT.esports ? { gross: 0.00008 * cap, cost: 0.3 + 0.00001 * cap } : { gross: 0, cost: 0 };
  if (key === 'open_day') return { gross: OPT.openDayCash, cost: 0 };
  if (key === 'youth_camp') return { gross: OPT.youthCash, cost: 0 };
  return { gross: 0, cost: 0 };
}
function activityNet(catalog, key, cap) {
  const p = activityParts(catalog, key, cap);
  return p.gross - p.cost;
}

const ACTIVITIES = ['concert', 'esports', 'open_day', 'youth_camp'];
const BALANCED_MIX = { concert: 0.4, esports: 0.2, open_day: 0.2, youth_camp: 0.2 };
// 同窗同活动饱和系数（§6.5 只定义到第 3 次；第 4 次按 Plan A 收口建议取 0.45 地板，待 Q12 定稿）
const SAT_MULT = [1, 0.7, 0.45, 0.45];
// 整数次使用的累计价值（gross × 饱和系数 − cost，每次照付成本）
function valueOfCount(club, key, count) {
  const { gross, cost } = activityParts(OPT.catalog, key, club.cap);
  let v = 0;
  for (let k = 1; k <= count; k++) v += gross * (SAT_MULT[k - 1] ?? SAT_MULT[SAT_MULT.length - 1]) - cost;
  return v;
}
// 分数配比用的期望饱和乘数（把 1/0.7/0.45 看作阶梯的积分）：c≤1 → c；1<c≤2 → 1+0.7(c−1)；…
function expectedSatUnits(c) {
  let left = c;
  let units = 0;
  for (let i = 0; i < SAT_MULT.length && left > 0; i++) {
    const take = Math.min(left, 1);
    units += take * SAT_MULT[i];
    left -= take;
  }
  if (left > 0) units += left * SAT_MULT[SAT_MULT.length - 1];
  return units;
}
function bestSatMix(club) {
  const n = slotsFor(club.cap);
  let best = { value: -Infinity, counts: null };
  const rec = (idx, remaining, counts) => {
    if (idx === ACTIVITIES.length - 1) {
      counts[ACTIVITIES[idx]] = remaining;
      const v = sum(ACTIVITIES.map((k) => valueOfCount(club, k, counts[k])));
      if (v > best.value + 1e-9) best = { value: round3(v), counts: { ...counts } };
      return;
    }
    for (let c = 0; c <= remaining; c++) {
      counts[ACTIVITIES[idx]] = c;
      rec(idx + 1, remaining - c, counts);
    }
  };
  rec(0, n, {});
  return best;
}

function netPerSlot(club) {
  if (OPT.mix === 'balanced') {
    if (!OPT.saturation) {
      return round3(sum(ACTIVITIES.map((k) => BALANCED_MIX[k] * activityNet(OPT.catalog, k, club.cap))));
    }
    // 分数配比：每类活动的期望次数 × 期望饱和乘数 − 成本
    return round3(
      sum(
        ACTIVITIES.map((k) => {
          const p = activityParts(OPT.catalog, k, club.cap);
          return expectedSatUnits(BALANCED_MIX[k]) * p.gross - BALANCED_MIX[k] * p.cost;
        }),
      ),
    );
  }
  if (!OPT.saturation) {
    // cashMax：每队按净额取最优活动（q3 下 12000 座的最优是青训营 1.0，不是演唱会 0.76）
    return round3(Math.max(...ACTIVITIES.map((k) => activityNet(OPT.catalog, k, club.cap))));
  }
  // 有饱和：在槽位数内枚举活动组合，取价值最高的组合（可能混排）
  return round3(bestSatMix(club).value / slotsFor(club.cap));
}
function cashMaxActivity(club) {
  if (OPT.saturation) {
    const best = bestSatMix(club);
    const counts = best.counts;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${k}×${c}`)
      .join('+');
  }
  const entries = ACTIVITIES.map((k) => [k, activityNet(OPT.catalog, k, club.cap)]);
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}
// 全排同一活动（用于「全排演唱会」上界，与最优混合对照）
function allSamePerSlot(club, key) {
  if (!OPT.saturation) return round3(activityNet(OPT.catalog, key, club.cap));
  return round3(valueOfCount(club, key, slotsFor(club.cap)) / slotsFor(club.cap));
}

// ---- 维护费：base + per_10k × (容量/10000) × 本窗主场场次（src/worker/home.ts:614） ----
// 每窗都收（临时窗照收，window-machine.ts:298-302）；played 按窗均分主场场次（近似）。
function maintenancePerWindow(club, windows) {
  const t = TIERS[tierOf(club)];
  const played = OPT.homeMatches / windows;
  return t.base + t.per10k * (club.cap / 10000) * played;
}

// ---- 方案 ----
// closes 用「赛季进度 0..1」表示；每个窗口一个 close。
// regularAt：哪些窗口是常规窗（推进工资/效力/冠名）；其余为临时窗。
const SEASON = OPT.seasonDays;
function twoWindowCloses(windowDays) {
  const d = windowDays / SEASON;
  return [
    { open: 0, close: d, regular: true },
    { open: 0.5, close: 0.5 + d, regular: true },
  ];
}
function perRoundCloses(regularAt) {
  const out = [];
  const step = 1 / OPT.rounds;
  const dur = 1 / SEASON; // 每轮 24h 短窗
  for (let i = 0; i < OPT.rounds; i++) {
    out.push({ open: i * step, close: i * step + dur, regular: regularAt.includes(i) });
  }
  return out;
}

const SCENARIOS = [
  {
    key: 'O1',
    label: '全赛季常开（1 窗）+ 关窗结算',
    windows: 1,
    closes: [{ open: 0, close: 1, regular: true }],
    openProbability: 1.0,
    uptake: 0.85,
    settle: 'close',
  },
  {
    key: 'O2',
    label: '全赛季常开（1 窗）+ 预订即结算',
    windows: 1,
    closes: [{ open: 0, close: 1, regular: true }],
    openProbability: 1.0,
    uptake: 0.85,
    settle: 'instant',
  },
  {
    key: 'O3-48h',
    label: '2 常规窗 × 48h（关窗结算）',
    windows: 2,
    closes: twoWindowCloses(2),
    openProbability: 1.0,
    uptake: 0.55,
    settle: 'close',
  },
  {
    key: 'O3-72h',
    label: '2 常规窗 × 72h（关窗结算）',
    windows: 2,
    closes: twoWindowCloses(3),
    openProbability: 1.0,
    uptake: 0.70,
    settle: 'close',
  },
  {
    key: 'O3-7d',
    label: '2 常规窗 × 7 天（关窗结算）',
    windows: 2,
    closes: twoWindowCloses(7),
    openProbability: 1.0,
    uptake: 0.85,
    settle: 'close',
  },
  {
    key: 'O4',
    label: '每轮短窗（9 窗 = 2 常规 + 7 临时；24h/窗）',
    windows: OPT.rounds,
    closes: perRoundCloses([0, 4]), // 季初 + 中期为常规，其余临时
    openProbability: 1.0,
    uptake: 0.75,
    settle: 'close',
  },
  {
    key: 'O5',
    label: '手动开窗 + 强制提醒（2 常规窗 × 7 天；开窗概率 0.9）',
    windows: 2,
    closes: twoWindowCloses(7),
    openProbability: 0.9,
    uptake: 0.85,
    settle: 'close',
  },
  {
    key: 'O6',
    label: '滚动预订下一窗（叠加在 2×7d 上；同 2 窗同成本，u 假设 0.85→0.90）',
    windows: 2,
    closes: twoWindowCloses(7),
    openProbability: 1.0,
    uptake: 0.90,
    settle: 'close',
  },
];

// 常规窗数量（工资/效力刻度由它驱动，contract-ticks.ts:30-45）
function regularCount(sc) {
  return sc.closes.filter((c) => c.regular).length;
}
function uptakeOf(sc) {
  return OPT.uptakeOverride === null ? sc.uptake : OPT.uptakeOverride;
}

// ---- 联盟软管汇总 ----
function leagueForScenario(sc) {
  const rows = CLUBS.map((club) => {
    const slots = slotsFor(club.cap);
    const ceiling = sc.windows * slots;
    const effective = sc.openProbability * uptakeOf(sc);
    const expectedBookings = ceiling * effective;
    const net = netPerSlot(club);
    const income = expectedBookings * net;
    // 期望值：开窗概率同时作用于收入与成本（窗没开 ⇒ 既没档期收入，也不扣工资/维护）
    // —— O5 的 0.9 就是「手动开窗仍可能忘记」；S9 现状该概率实测为 0。
    const wages = regularCount(sc) * OPT.wage * sc.openProbability;
    const maint = sc.windows * maintenancePerWindow(club, sc.windows) * sc.openProbability;
    return {
      club,
      tier: tierLabel(club.cap),
      slots,
      ceiling,
      expectedBookings,
      netPerSlot: net,
      income,
      wages,
      maintenance: maint,
      netAfterCosts: OPT.prize + OPT.homeRev + income - wages - maint,
    };
  });
  const total = {
    clubs: rows.length,
    slotsPerWindow: sum(rows.map((r) => r.slots)),
    ceiling: sum(rows.map((r) => r.ceiling)),
    expectedBookings: sum(rows.map((r) => r.expectedBookings)),
    income: round2(sum(rows.map((r) => r.income))),
    wages: round2(sum(rows.map((r) => r.wages))),
    maintenance: round2(sum(rows.map((r) => r.maintenance))),
    baseline: round2(rows.length * (OPT.prize + OPT.homeRev)),
    netAfterCosts: round2(sum(rows.map((r) => r.netAfterCosts))),
    regularWindows: regularCount(sc),
    // 按「1 常规窗 = 0.5 赛季」年化：整季应有 2 次工资。O1/O2 只收 1 次，差额就是少收的工资。
    wageNormalized: round2(2 * OPT.wage * rows.length * sc.openProbability),
    netAfterCostsNormalized: round2(sum(rows.map((r) => r.netAfterCosts)) - (2 - regularCount(sc)) * OPT.wage * rows.length * sc.openProbability),
    // 只按「窗口按计划开」看（p=1，成本全收）：O5/O6 的期望净额好看只是因为「没开窗 ⇒ 没扣工资」。
    netAfterCostsPlanned: round2(
      rows.length * (OPT.prize + OPT.homeRev) +
        (sum(rows.map((r) => r.income)) - sum(rows.map((r) => r.wages)) - sum(rows.map((r) => r.maintenance))) /
          (sc.openProbability || 1),
    ),
  };
  return { rows, total };
}

// ---- 最穷队现金流（RB莱比锡：12000 座，现余额 10.79；文档 10-17 快照 2.79） ----
// 奖金/主场按天线性入账（近似；S9 实际按场确认）；活动收入在窗关时到账（settle=close）或按天摊（instant）。
function poorestCashflow(sc, startBalance) {
  const club = CLUBS.find((c) => c.id === 112172);
  const slots = slotsFor(club.cap);
  const effective = sc.openProbability * uptakeOf(sc);
  const totalActivity = sc.windows * slots * effective * netPerSlot(club);
  const closes = [...sc.closes].sort((a, b) => a.close - b.close);
  const wageAt = new Map();
  const maintAt = new Map();
  for (const c of closes) {
    wageAt.set(c.close, (wageAt.get(c.close) ?? 0) + (c.regular ? OPT.wage * sc.openProbability : 0));
    maintAt.set(c.close, (maintAt.get(c.close) ?? 0) + maintenancePerWindow(club, sc.windows) * sc.openProbability);
  }
  // 活动收入分配
  const activityAtClose = new Map();
  if (sc.settle === 'close') {
    const perWindow = totalActivity / closes.length;
    for (const c of closes) activityAtClose.set(c.close, (activityAtClose.get(c.close) ?? 0) + perWindow);
  }
  const events = [...new Set([...wageAt.keys(), ...maintAt.keys(), ...activityAtClose.keys()])].sort((a, b) => a - b);
  let balance = startBalance;
  let minBalance = balance;
  let firstCloseBalance = null;
  let lastDay = 0;
  for (const day of events) {
    // 线性入账奖金+主场收入
    const accrue = (OPT.prize + OPT.poorestHomeRev) * (day - lastDay) / 1;
    balance += accrue;
    // instant 结算：活动收入按时间线性摊
    if (sc.settle === 'instant') balance += totalActivity * (day - lastDay);
    balance -= (wageAt.get(day) ?? 0) + (maintAt.get(day) ?? 0);
    balance += activityAtClose.get(day) ?? 0;
    lastDay = day;
    if (firstCloseBalance === null) firstCloseBalance = balance;
    minBalance = Math.min(minBalance, balance);
  }
  // 尾部到季末
  balance += (OPT.prize + OPT.poorestHomeRev) * (1 - lastDay);
  if (sc.settle === 'instant') balance += totalActivity * (1 - lastDay);
  minBalance = Math.min(minBalance, balance);
  return {
    start: round2(startBalance),
    firstClose: round2(firstCloseBalance ?? balance),
    min: round2(minBalance),
    end: round2(balance),
    totalActivity: round2(totalActivity),
    wages: round2(regularCount(sc) * OPT.wage * sc.openProbability),
    maintenance: round2(sc.windows * maintenancePerWindow(club, sc.windows) * sc.openProbability),
  };
}

// ---- 注意力 ----
function attention(sc) {
  const rows = [];
  for (const tier of ['小', '中', '大']) {
    const cap = tier === '小' ? 12000 : tier === '中' ? 22000 : 35000;
    const slots = slotsFor(cap);
    const decisions = sc.windows * slots;
    const club = CLUBS.find((c) => c.cap === cap) ?? CLUBS[0];
    const income = decisions * sc.openProbability * uptakeOf(sc) * netPerSlot(club);
    rows.push({
      tier,
      decisions,
      perWeek: round2(decisions / (SEASON / 7)),
      income: round2(income),
      perDecision: round2(income / decisions),
    });
  }
  return rows;
}

// ---- 输出 ----
const lines = [];
function log(s = '') { lines.push(s); }

log('窗口开放节奏 / 时长 · 球场档期量化模型');
log(`输入：catalog=${OPT.catalog}  mix=${OPT.mix}  slots=${OPT.slotsMode}  saturation=${OPT.saturation ? 'on(1/0.7/0.45/0.45，gross 侧)' : 'off'}  seasonDays=${SEASON}  rounds=${OPT.rounds}  homeMatches=${round2(OPT.homeMatches)}  prize=${OPT.prize}/队  homeRev=${OPT.homeRev}/队  wage=${OPT.wage}/常规窗${OPT.uptakeOverride === null ? '' : `  uptake=${OPT.uptakeOverride}`}`);
log('生产快照：18 队（12000×10 / 17000×1 / 22000×3 / 35000×4），余额 10.79–147.30；venue_bookings 0 行；S9 窗只有 1 行合成 W1（closed，01:00→01:01）');
log('Plan A：<15000→2 / 15000–29999→3 / ≥30000→4 档/窗。');
log('');

const results = [];
function leagueIncomePerWindow(perSlotFn) {
  return round2(sum(CLUBS.map((c) => slotsFor(c.cap) * perSlotFn(c))));
}
for (const sc of SCENARIOS) {
  const { rows, total } = leagueForScenario(sc);
  const poor = poorestCashflow(sc, OPT.poorestBalance);
  const poorDoc = poorestCashflow(sc, 2.79);
  const att = attention(sc);
  results.push({ key: sc.key, label: sc.label, total, rows, poor, poorDoc, attention: att });

  log(`== ${sc.key} · ${sc.label} ==`);
  log(`  常规窗 ${total.regularWindows} 个；可订上限 ${total.ceiling} 次/季（联盟 ${total.slotsPerWindow} 槽/窗）；预期预订 ${round2(total.expectedBookings)} 次/季`);
  log(`  档位净额：小 ${round2(netPerSlot(CLUBS.find((c) => c.cap === 12000)))} / 中17k ${round2(netPerSlot(CLUBS.find((c) => c.cap === 17000)))} / 中22k ${round2(netPerSlot(CLUBS.find((c) => c.cap === 22000)))} / 大 ${round2(netPerSlot(CLUBS.find((c) => c.cap === 35000)))} m/槽`);
  const fullMix = leagueIncomePerWindow((c) => netPerSlot(c));
  const fullConcert = leagueIncomePerWindow((c) => allSamePerSlot(c, 'concert'));
  log(`  满预订单窗（u=1）：最优混合 ${fullMix} / 全排演唱会 ${fullConcert} m（区间 = 全排 … 最优混合）`);
  log(`  档期净收入：联盟 ${total.income} m/季（${round2(total.income / 18)}/队）；工资 ${total.wages}；维护 ${total.maintenance}；基线（奖金+主场）${total.baseline}`);
  log(`  俱乐部净额（含基线、工资、维护，未计富人税）：${total.netAfterCosts} m/季（${round2(total.netAfterCosts / 18)}/队）`);
  log(`  年化工资口径（1 窗 = 0.5 赛季 ⇒ 整季 2 次工资）：${total.wageNormalized}；净额 ${total.netAfterCostsNormalized} m/季（${round2(total.netAfterCostsNormalized / 18)}/队）`);
  log(`  若窗口按计划开（p=1，成本全收）：${total.netAfterCostsPlanned} m/季（${round2(total.netAfterCostsPlanned / 18)}/队）`);
  log(`  最穷队（RB莱比锡，起始 ${OPT.poorestBalance}）：首窗关后 ${poor.firstClose} / 季内最低 ${poor.min} / 季末 ${poor.end}；年化工资口径季末 ${round2(poor.end - (2 - total.regularWindows) * OPT.wage * sc.openProbability)}`);
  log(`  最穷队（文档 2.79 起始）：首窗关后 ${poorDoc.firstClose} / 季内最低 ${poorDoc.min} / 季末 ${poorDoc.end}；年化工资口径季末 ${round2(poorDoc.end - (2 - total.regularWindows) * OPT.wage * sc.openProbability)}`);
  log(`  注意力：${att.map((a) => `${a.tier} ${a.decisions} 次/季（${a.perWeek}/周，期望 ${a.perDecision} m/次，含 uptake）`).join('；')}`);
  log('');
}

// ---- 预订率敏感性（u 扫描） ----
// 只比「档期收入 − 维护费」的现金差（工资两者都应按 2 次常规窗年化，不动）。
log('== 预订率敏感性：档期收入（联盟 m/季） ==');
const UPTAKES = [0, 0.2, 0.45, 0.65, 0.85];
const scanKeys = ['O1', 'O3-48h', 'O3-72h', 'O3-7d', 'O4'];
log('u'.padEnd(7) + scanKeys.map((k) => k.padEnd(10)).join(''));
for (const u of UPTAKES) {
  const cells = scanKeys.map((k) => {
    const sc = SCENARIOS.find((x) => x.key === k);
    return `${round2(leagueIncomePerWindow((c) => netPerSlot(c)) * sc.windows * sc.openProbability * u)}`.padEnd(10);
  });
  log(`${u.toFixed(2)}`.padEnd(7) + cells.join(''));
}
log('');
const o1 = results.find((r) => r.key === 'O1');
const o3 = results.find((r) => r.key === 'O3-7d');
const o3h = results.find((r) => r.key === 'O3-48h');
const extraMaint = round2(o3.total.maintenance - o1.total.maintenance);
const mixPerWindow = leagueIncomePerWindow((c) => netPerSlot(c));
const concertPerWindow = leagueIncomePerWindow((c) => allSamePerSlot(c, 'concert'));
log(`O3-7d 相对 O1 多一个窗的维护费：${extraMaint} m/季（${o3.total.maintenance} − ${o1.total.maintenance}）`);
log(`现金平衡点 u：全排演唱会 ${round2((extraMaint / concertPerWindow) * 100)}%（${extraMaint}/${concertPerWindow}）；最优混合 ${round2((extraMaint / mixPerWindow) * 100)}%（${extraMaint}/${mixPerWindow}）`);
log(`O3-48h 相对 O1 的维护差：${round2(o3h.total.maintenance - o1.total.maintenance)} m/季（与 O3-7d 同，维护按窗收、与时长无关）`);
log('');

// 分档汇总表
log('== 分档：每队每赛季档期预期净收入（m，已乘开窗概率与预订率） ==');log('方案'.padEnd(8) + '小(2槽)'.padEnd(12) + '中17k(3槽)'.padEnd(14) + '中22k(3槽)'.padEnd(15) + '大(4槽)'.padEnd(12) + '联盟合计');
for (const r of results) {
  const pick = (cap) => r.rows.find((x) => x.club.cap === cap);
  const s = pick(12000), m17 = pick(17000), m22 = pick(22000), l = pick(35000);
  log(
    r.key.padEnd(8) +
    `${round2(s.income)}`.padEnd(12) +
    `${round2(m17.income)}`.padEnd(14) +
    `${round2(m22.income)}`.padEnd(15) +
    `${round2(l.income)}`.padEnd(12) +
    `${r.total.income}`,
  );
}
log('');

// 每轮短窗的规则冲突量化
log('== 每轮短窗的规则冲突（同一个 9 窗，三种口径） ==');
log('口径'.padEnd(28) + '常规窗'.padEnd(8) + '工资/季'.padEnd(12) + '合同刻度/季'.padEnd(14) + '维护/季'.padEnd(12) + '备注');
const perRoundBase = results.find((r) => r.key === 'O4');
for (const [label, regular, note] of [
  ['2 常规 + 7 临时（合法）', 2, '临时窗不扣工资/不推进刻度/不收冠名'],
  ['9 常规（需去掉上限 2）', 9, '效力 +4.5 赛季/季，保护期与解约费体系失效'],
]) {
  log(
    label.padEnd(28) +
    `${regular}`.padEnd(8) +
    `${round2(regular * OPT.wage * 18)}`.padEnd(12) +
    `${round2(regular * 0.5)}`.padEnd(14) +
    `${perRoundBase.total.maintenance}`.padEnd(12) +
    note,
  );
}
log('');

// 现金时点
log('== 钱何时到账 ==');
for (const r of results) {
  const sc = SCENARIOS.find((x) => x.key === r.key);
  const when = sc.settle === 'instant' ? '预订时' : `关窗时（${sc.closes.length} 次/季）`;
  log(`${r.key.padEnd(8)} ${when}`);
}
log('');

// JSON
const json = {
  inputs: OPT,
  saturation: {
    on: OPT.saturation,
    multipliers: SAT_MULT,
    note: '作用在 gross 上、成本按次照付；第 4 次 0.45 为 Plan A 收口建议值，待 Q12 定稿',
  },
  planA: { slots: { small: 2, medium: 3, large: 4 }, capacityThresholds: [15000, 30000] },
  clubs: CLUBS.map((c) => ({
    ...c,
    tier: tierLabel(c.cap),
    slots: slotsFor(c.cap),
    cashMaxMix: cashMaxActivity(c),
    netPerSlot: netPerSlot(c),
  })),
  scenarios: results.map((r) => ({
    key: r.key,
    label: r.label,
    regularWindows: r.total.regularWindows,
    ceilingPerSeason: r.total.ceiling,
    expectedBookingsPerSeason: round2(r.total.expectedBookings),
    incomeLeague: r.total.income,
    incomePerClubAvg: round2(r.total.income / 18),
    wagesLeague: r.total.wages,
    wageNormalizedLeague: r.total.wageNormalized,
    maintenanceLeague: r.total.maintenance,
    baselineLeague: r.total.baseline,
    netAfterCostsLeague: r.total.netAfterCosts,
    netAfterCostsPerClub: round2(r.total.netAfterCosts / 18),
    netAfterCostsNormalizedLeague: r.total.netAfterCostsNormalized,
    netAfterCostsNormalizedPerClub: round2(r.total.netAfterCostsNormalized / 18),
    netAfterCostsPlannedLeague: r.total.netAfterCostsPlanned,
    netAfterCostsPlannedPerClub: round2(r.total.netAfterCostsPlanned / 18),
    byTier: ['小', '中', '大'].map((t) => {
      const rows = r.rows.filter((x) => x.tier === t);
      return {
        tier: t,
        clubs: rows.length,
        slotsPerWindow: rows[0]?.slots ?? 0,
        ceiling: rows.reduce((a, b) => a + b.ceiling, 0),
        expectedBookings: round2(rows.reduce((a, b) => a + b.expectedBookings, 0)),
        incomePerClubAvg: round2(rows.reduce((a, b) => a + b.income, 0) / rows.length),
        netAfterCostsPerClubAvg: round2(rows.reduce((a, b) => a + b.netAfterCosts, 0) / rows.length),
      };
    }),
    poorest: {
      start: r.poor.start,
      firstClose: r.poor.firstClose,
      min: r.poor.min,
      end: r.poor.end,
      startDoc: r.poorDoc.start,
      firstCloseDoc: r.poorDoc.firstClose,
      minDoc: r.poorDoc.min,
      endDoc: r.poorDoc.end,
      endNormalized: round2(r.poor.end - (2 - r.total.regularWindows) * OPT.wage * SCENARIOS.find((x) => x.key === r.key).openProbability),
      endDocNormalized: round2(r.poorDoc.end - (2 - r.total.regularWindows) * OPT.wage * SCENARIOS.find((x) => x.key === r.key).openProbability),
    },
    attention: r.attention,
  })),
  uptakeSensitivity: {
    uptakes: UPTAKES,
    scenarios: scanKeys,
    breach: {
      extraMaintenanceO3VsO1: extraMaint,
      breakevenUAllConcert: round3(extraMaint / concertPerWindow),
      breakevenUMix: round3(extraMaint / mixPerWindow),
    },
  },
};

if (OPT.json) {
  console.log(JSON.stringify(json, null, 2));
} else {
  console.log(lines.join('\n'));
  console.log('== JSON ==');
  console.log(JSON.stringify(json, null, 2));
}
