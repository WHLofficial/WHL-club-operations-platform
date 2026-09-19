// §13 可配置参数总表：D1 config 表唯一来源，代码内 defaults 兜底。
// Worker isolate 内存缓存 TTL 60s（读多写少，管理端改后 ≤60s 生效）；
// 数值键解析失败回退默认；涉密键（§6.10）对外只出掩码，值不进前端、不进审计。
import { DEFAULT_CA_PA_LIMITS } from './squad-rules.ts';

export const CONFIG_TTL_MS = 60_000;
export const CONFIG_MASK = '（内部参数，已隐藏）';

// 全量键注册表（§13 顺序）；值一律按 TEXT 存取。
export const CONFIG_KEYS = [
  'tax_rates',
  'auction_tax_rate',
  'listing_floor_coefs',
  'listing_cap_coef',
  'bid_step_min',
  'delist_fee_rate',
  'match_diff_dest',
  'deadline_hours',
  'silence_hours',
  'activation_window_min',
  'match_window_hours',
  'trade_calendar',
  'squad_min',
  'squad_max',
  'gk_min',
  'trainee_max',
  'ca_pa_limits',
  'wage_cap',
  'prize_table',
  'luxury_cash_threshold',
  'luxury_cash_rate',
  'luxury_value_threshold',
  'luxury_value_rate',
  'attendance_model',
  'facility_prices',
  'maintenance_table',
  'voucher_refund',
  'xp_per_level',
  'upgrade_plans',
  'tier_conditions',
  'trainee_xp_full',
  'trainee_xp_half',
  'china_xp_bonus',
  'china_badges',
  'badge_cap_silver',
  'badge_cap_gold',
  'wage_param_a',
  'wage_param_b',
  'wage_param_c',
  'attempt_decay',
  'sigmoid_slope',
  'sigmoid_mid',
  'satisfaction_thresholds',
  'agent_tiers',
  'agent_reroll_prob',
  'wage_min',
  'wage_max',
  'max_attempts',
  'young_blend_age',
  'renewal_raise',
  'window_force_settle',
  'market_bid_paused',
  'review_amount_threshold',
  'bid_pattern_alert',
  'prize_table',
  'loyalty_tiers',
  'attendance_model',
  'tier_table',
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

// 有具体默认值的键；json 类与「待定」键缺省（get 返回 null）。
export const CONFIG_DEFAULTS: Partial<Record<ConfigKey, string>> = {
  tax_rates: '0.10,0.20,0.40',
  auction_tax_rate: '0.5',
  listing_floor_coefs: '0.5,0.5',
  listing_cap_coef: '1.5',
  bid_step_min: '1',
  delist_fee_rate: '0.10',
  match_diff_dest: 'burn',
  deadline_hours: '18,23',
  silence_hours: '3',
  activation_window_min: '5',
  match_window_hours: '24',
  trade_calendar: 'none',
  squad_min: '20',
  squad_max: '30',
  gk_min: '1',
  trainee_max: '7',
  ca_pa_limits: JSON.stringify(DEFAULT_CA_PA_LIMITS), // 规则 4.2.2 梯度原文，config 表可覆盖
  luxury_cash_threshold: '125',
  luxury_cash_rate: '0.20',
  luxury_value_threshold: '700',
  luxury_value_rate: '0.05',
  // 增量 10：异常出价告警阈值（大额强制审 40m；短窗连续抬价/最小步长拉锯判据，JSON 可覆盖）
  review_amount_threshold: '40',
  bid_pattern_alert: '{"windowMinutes":30,"maxRaises":3,"colludeRounds":6}',
  // 增量 11：奖金表（TECH_DESIGN §9.1 原文，JSON 可覆盖）+ 忠诚奖金档位 [起效年限, RC 比例]
  prize_table: JSON.stringify({
    league_premier: { entry: 20, win: 8.5, draw: 6.6, loss: 4.7 },
    league_second: { entry: 7.5, win: 6.7, draw: 4.8, loss: 2.9 },
    qualifying: { fallback: 7.5 },
    champions_group: { entry: 15, pool: 200, win: 7.0, draw: 2.5 },
    champions_ko: { quarterfinal: 7.5, semifinal: 10, final: 12.5, champion: 5 },
    super_cup: { win: 4.0, loss: 2.0 },
  }),
  loyalty_tiers: '[[0.5,0.05],[1.5,0.10],[2.5,0.20]]',
  // 增量 12：主场收入引擎全套系数（revenue 插件移植，TECH_DESIGN §8；天气概率 40/30/20/10 用户裁决 2026-09-16；
  // 影响力系数=规则 4.1.3 原文可成长 0.25/非成长 0.13）
  attendance_model: JSON.stringify({
    weather_probabilities: { 晴: 0.4, 多云: 0.3, 雨: 0.2, 雪: 0.1 },
    weather_ranges: { 晴: [1.05, 1.25], 多云: [0.9, 1.04], 雨: [0.8, 0.89], 雪: [0.75, 0.79] },
    form_coef_table: { 0: 0.7, 1: 0.74, 2: 0.85, 3: 0.94, 4: 1.0, 5: 1.04, 6: 1.1, 7: 1.19, 8: 1.22, 9: 1.25 },
    attendance_multiplier_base: 4.0,
    attendance_multiplier_per_tier: 0.35,
    ticket_revenue_per_10k: 1.5,
    commercial_per_10k_per_level: 0.1,
    broadcast_per_match_per_level: 0.3,
    sell_out_fill: [0.985, 0.999],
    perturbation: [0.97, 1.03],
    neutral_form_pts: 4,
    default_influence: 90,
    fans_target_table: { bands: [{ max_influence: 120, slope: 26 }, { max_influence: 160, slope: 22 }, { max_influence: 200, slope: 15 }, { max_influence: 0, slope: 12 }] },
    fans_cap: 10000,
    fans_grow_rate: 0.5,
    fans_grow_heat_base: 0.6,
    fans_grow_heat_span: 0.4,
    fans_drop_rate: 0.5,
    fans_drop_heat_extra: 0.8,
    influence_coef_growable: 0.25,
    influence_coef_static: 0.13,
  }),
  // 球场档位 0-4（座位区间/维护费/上座系数/升级费；远期扩建校验用）
  tier_table: JSON.stringify({
    0: { name: '社区级', min_seats: 12000, max_seats: 25000, base_maintenance: 2.0, per_10k_rate: 0.8, attend_coef: 1.0, upgrade_cost: 3.0 },
    1: { name: '地区级', min_seats: 20000, max_seats: 35000, base_maintenance: 5.0, per_10k_rate: 0.55, attend_coef: 1.1, upgrade_cost: 4.5 },
    2: { name: '大区级', min_seats: 25000, max_seats: 45000, base_maintenance: 8.0, per_10k_rate: 0.35, attend_coef: 1.2, upgrade_cost: 6.0 },
    3: { name: '国家级', min_seats: 35000, max_seats: 60000, base_maintenance: 11.0, per_10k_rate: 0.28, attend_coef: 1.3, upgrade_cost: 10.0 },
    4: { name: '国际级', min_seats: 50000, max_seats: 100000, base_maintenance: 14.0, per_10k_rate: 0.2, attend_coef: 1.4, upgrade_cost: 0.0 },
  }),
  voucher_refund: '0.25',
  xp_per_level: '10',
  trainee_xp_full: '40',
  trainee_xp_half: '15',
  china_xp_bonus: '20',
  china_badges: '3',
  badge_cap_silver: '15',
  badge_cap_gold: '3',
  wage_param_a: '0.02',
  wage_param_b: '1.9',
  wage_param_c: '0.45',
  attempt_decay: '0.95',
  sigmoid_slope: '-9',
  sigmoid_mid: '0.8',
  satisfaction_thresholds: '0.25,0.6,0.9',
  agent_tiers: '[[0.15,0.30],[0.25,0.50],[0.35,0.70]]',
  agent_reroll_prob: '0.3',
  wage_min: '0.01',
  wage_max: '20.00',
  max_attempts: '3',
  young_blend_age: '25',
  renewal_raise: '0.05,0.15',
  window_force_settle: 'false',
  market_bid_paused: 'false',
};

export const CONFIG_SECRET_KEYS: ReadonlySet<string> = new Set([
  'wage_param_a',
  'wage_param_b',
  'wage_param_c',
  'attempt_decay',
  'sigmoid_slope',
  'sigmoid_mid',
  'satisfaction_thresholds',
  'agent_tiers',
  'agent_reroll_prob',
]);

export function isSecretKey(key: string): boolean {
  return CONFIG_SECRET_KEYS.has(key);
}

export function maskIfSecret(key: string, value: string | null): string | null {
  return isSecretKey(key) ? CONFIG_MASK : value;
}

interface CacheEntry {
  value: string | null;
  at: number;
}

// module 级 = isolate 级：同一 Worker 实例的多次请求共享
const cache = new Map<string, CacheEntry>();

export function resetConfigCache(): void {
  cache.clear();
}

export interface ConfigService {
  /** 原值：库里没有就落默认，再没有就是 null */
  get(key: ConfigKey): Promise<string | null>;
  getNumber(key: ConfigKey): Promise<number | null>;
  getNumberList(key: ConfigKey): Promise<number[] | null>;
  getJson<T>(key: ConfigKey): Promise<T | null>;
  /** 写库并立刻失效本 isolate 缓存；value=null 删覆盖（回到默认）。键必须在注册表内 */
  set(key: ConfigKey, value: string | null): Promise<void>;
  /** 管理端视图：涉密键只给掩码 */
  listMasked(): Promise<{ key: string; value: string | null; secret: boolean }[]>;
}

export function createConfigService(db: D1Database, opts: { now?: () => number } = {}): ConfigService {
  const now = opts.now ?? Date.now;

  async function fetchRaw(key: ConfigKey): Promise<string | null> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CONFIG_TTL_MS) return hit.value;
    const row = await db
      .prepare('SELECT value FROM config WHERE key = ?')
      .bind(key)
      .first<{ value: string | null }>();
    const value = row?.value ?? CONFIG_DEFAULTS[key] ?? null;
    cache.set(key, { value, at: now() });
    return value;
  }

  return {
    get: (key) => fetchRaw(key),

    async getNumber(key) {
      const raw = await fetchRaw(key);
      const parsed = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(parsed)) return parsed;
      const fallbackRaw = CONFIG_DEFAULTS[key];
      if (fallbackRaw === undefined) return null;
      const fallback = Number(fallbackRaw);
      return Number.isFinite(fallback) ? fallback : null;
    },

    async getNumberList(key) {
      const raw = await fetchRaw(key);
      const source = raw === null ? CONFIG_DEFAULTS[key] : raw;
      if (source === undefined || source === null) return null;
      const parts = source.split(',').map((s) => Number(s.trim()));
      if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) {
        const fallback = CONFIG_DEFAULTS[key];
        if (fallback === undefined || fallback === raw) return null;
        return fallback.split(',').map((s) => Number(s.trim()));
      }
      return parts;
    },

    async getJson<T>(key: ConfigKey) {
      const raw = await fetchRaw(key);
      const source = raw === null ? CONFIG_DEFAULTS[key] : raw;
      if (source === undefined || source === null) return null;
      try {
        return JSON.parse(source) as T;
      } catch {
        const fallback = CONFIG_DEFAULTS[key];
        if (fallback === undefined || fallback === raw) return null;
        try {
          return JSON.parse(fallback) as T;
        } catch {
          return null;
        }
      }
    },

    async set(key, value) {
      if (!CONFIG_KEYS.includes(key)) {
        throw new RangeError(`未注册的 config 键：${key}`);
      }
      await db
        .prepare(
          `INSERT INTO config (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(key, value)
        .run();
      cache.delete(key);
    },

    async listMasked() {
      const rows = await db.prepare('SELECT key, value FROM config').all<{ key: string; value: string | null }>();
      const stored = new Map(rows.results.map((r) => [r.key, r.value]));
      return CONFIG_KEYS.map((key) => ({
        key,
        value: maskIfSecret(key, stored.get(key) ?? CONFIG_DEFAULTS[key] ?? null),
        secret: isSecretKey(key),
      }));
    },
  };
}
