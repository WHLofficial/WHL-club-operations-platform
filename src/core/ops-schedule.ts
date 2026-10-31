// 运营时刻表（v6.49.0）纯逻辑：操作键定义 + 双锚解析 + 状态判定 + 保存校验 + 预设。
// 零 import（前后端共用；tests/core-zero-import.test.ts 守卫），设计见 memory/design-ops-schedule-expiry.md。
// 锚只两种取值：随窗（window_open / window_close）或具体时间（absolute）；非随窗端一律填具体时间，
// 不做「开窗 + N 小时」偏移（用户令 2026-10-14）。全行 none = 与上线前逐条一致。

export type OpsStartAnchor = 'none' | 'window_open' | 'absolute';
export type OpsEndAnchor = 'none' | 'window_close' | 'absolute';

// unrestricted = 不限时段（现状）；not_started = 还没到起点；open = 时段内；closed = 已结束（含随窗行无开放窗口）
export type OpsState = 'unrestricted' | 'not_started' | 'open' | 'closed';

export interface OpsKeyMeta {
  key: string;
  label: string;
  group: string;
  requiresWindow: boolean; // 该操作是否本来就受现有窗口闸门约束（迁移 seed 同值；管理端表单默认）
  desc: string;
  /** 缺种子行时的合成默认锚（v6.64.4：迁移 0069 只种了当时登记的 11 键；缺省 none = 不限制） */
  defaultStartAnchor?: OpsStartAnchor;
  defaultEndAnchor?: OpsEndAnchor;
}

// 12 个操作键：11 项转会操作 + 消费中心整体。审核单不设时段（管理组工作流，非球员操作）。
export const OPS_KEYS: readonly OpsKeyMeta[] = [
  { key: 'transfer_listing', label: '挂牌与出价', group: '转会', requiresWindow: true, desc: '上架挂牌与对挂牌出价（含强制拍卖同链）' },
  { key: 'transfer_offer', label: '报价', group: '转会', requiresWindow: false, desc: '对名单球员发起报价 / 还价（v6.29.0 起不受窗口限制）' },
  { key: 'transfer_negotiation', label: '签约谈判', group: '转会', requiresWindow: false, desc: '审核通过后的工资谈判（提交新违约金 / 出价）' },
  { key: 'transfer_sea_sealed', label: '海捞·暗标段', group: '转会', requiresWindow: true, desc: '自由身池密封标段（统一截止开标）' },
  { key: 'transfer_sea_open', label: '海捞·明标段', group: '转会', requiresWindow: true, desc: '开标后的公开海捞（先到先得，现有流程）' },
  { key: 'transfer_activation', label: '激活', group: '转会', requiresWindow: true, desc: '按违约金激活他队球员' },
  { key: 'transfer_match', label: '匹配窗', group: '转会', requiresWindow: true, desc: '激活 / 正式合同的 24h 匹配窗' },
  { key: 'transfer_termination', label: '解约', group: '转会', requiresWindow: true, desc: '解约本队球员（进海捞池）' },
  { key: 'transfer_rc_change', label: '续约', group: '转会', requiresWindow: true, desc: '改违约金续约（rc-change）' },
  { key: 'transfer_promotion', label: '上调/下放', group: '转会', requiresWindow: true, desc: '一线队 ⇄ 训练营双向调整（下放即时转训练营条款，上调开签约谈判）', defaultStartAnchor: 'window_open', defaultEndAnchor: 'window_close' },
  { key: 'transfer_forced_auction', label: '强制拍卖', group: '转会', requiresWindow: true, desc: '管理端发起的强制拍卖挂牌' },
  { key: 'consumption', label: '消费中心', group: '消费', requiresWindow: true, desc: '消费工单 / 球场扩建升级 / 设施 / 冠名 / 档期预订' },
];

export type OpsKey = string;

export function opsKeyMeta(key: string): OpsKeyMeta | null {
  for (const meta of OPS_KEYS) if (meta.key === key) return meta;
  return null;
}

export function opsLabelOf(key: string): string {
  return opsKeyMeta(key)?.label ?? key;
}

export interface OpsRow {
  opKey: string;
  startAnchor: OpsStartAnchor;
  startAt: string | null;
  endAnchor: OpsEndAnchor;
  endAt: string | null;
  requiresWindow: boolean;
  closeInflight: boolean;
  note: string;
}

// 当前开放窗口的引用（opened_at 是随开窗锚的唯一来源；closedAt 非 null 表示已关，视为无窗口）
export interface OpsWindowRef {
  openedAt: string;
  closedAt: string | null;
}

export interface OpsResolved {
  startAt: string | null;      // 解析后的起点（随窗锚取窗口 opened_at）
  endAt: string | null;        // 解析后的终点；endIsWindowClose=true 时为 null（动态边界）
  endIsWindowClose: boolean;
  state: OpsState;
}

function windowIsOpen(window: OpsWindowRef | null): boolean {
  return window !== null && window.closedAt === null;
}

/**
 * 解析一行时刻表 + 当前窗口 → 起止与状态。
 * 无开放窗口时：任何随窗锚（window_open / window_close）的行一律 closed（随窗关闭）；
 * 两端都是具体时间的行不受窗口影响，照常判定。
 */
export function resolveOpsRow(row: OpsRow, window: OpsWindowRef | null, nowIso: string): OpsResolved {
  const open = windowIsOpen(window);
  const startAt =
    row.startAnchor === 'window_open' ? (open ? window!.openedAt : null) : row.startAnchor === 'absolute' ? row.startAt : null;
  const endIsWindowClose = row.endAnchor === 'window_close';
  const endAt = row.endAnchor === 'absolute' ? row.endAt : null;

  let state: OpsState;
  // 「不限制」看的是锚型（两端都没设），不是解析后的时间：
  // 随窗锚在没开窗时解析成 null，若按时间判会被误判成「不限制」而漏掉「随窗关闭」。
  if (row.startAnchor === 'none' && row.endAnchor === 'none') {
    state = 'unrestricted';
  } else if (!open && (row.startAnchor === 'window_open' || endIsWindowClose)) {
    state = 'closed';
  } else if (startAt !== null && nowIso < startAt) {
    state = 'not_started';
  } else if (endAt !== null && nowIso > endAt) {
    state = 'closed';
  } else {
    state = 'open';
  }
  return { startAt, endAt, endIsWindowClose, state };
}

export function opsStateLabel(state: OpsState): string {
  switch (state) {
    case 'unrestricted':
      return '不限制';
    case 'not_started':
      return '未开始';
    case 'open':
      return '进行中';
    case 'closed':
      return '已结束';
  }
}

// UTC ISO → 北京时间「YYYY-MM-DD HH:mm」（中国无夏令时，固定 +08:00；与 core/market-rules.ts 的 shanghaiDateStr 同口径）
export function fmtBeijingMinute(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const s = new Date(ms + 8 * 3600_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

function isIsoMinute(v: string | null): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
}

export interface OpsInput {
  startAnchor: string;
  startAt: string | null;
  endAnchor: string;
  endAt: string | null;
  requiresWindow: boolean;
}

/** 保存校验：返回错误文案（400），合法返回 null。 */
export function validateOpsInput(input: OpsInput): string | null {
  if (input.startAnchor !== 'none' && input.startAnchor !== 'window_open' && input.startAnchor !== 'absolute') {
    return '起点锚只支持：不限制 / 随开窗 / 具体时间';
  }
  if (input.endAnchor !== 'none' && input.endAnchor !== 'window_close' && input.endAnchor !== 'absolute') {
    return '终点锚只支持：不限制 / 随关窗 / 具体时间';
  }
  if (input.startAnchor === 'absolute' && !isIsoMinute(input.startAt)) return '起点要填具体时间（北京时间）';
  if (input.endAnchor === 'absolute' && !isIsoMinute(input.endAt)) return '终点要填具体时间（北京时间）';
  if ((input.startAnchor === 'window_open' || input.endAnchor === 'window_close') && !input.requiresWindow) {
    return '随窗锚点的行必须同时勾选「需要开窗」';
  }
  if (input.startAnchor === 'absolute' && input.endAnchor === 'absolute' && input.startAt! >= input.endAt!) {
    return '终点要晚于起点';
  }
  return null;
}

// ---- 管理端一键预设（只定锚型；具体时间那一端由表单里的 datetime-local 填） ----

export interface OpsPreset {
  id: 'A' | 'B' | 'C' | 'none';
  label: string;
  hint: string;
  startAnchor: OpsStartAnchor;
  endAnchor: OpsEndAnchor;
}

export const OPS_PRESETS: readonly OpsPreset[] = [
  { id: 'A', label: 'A 随开窗起 · 到点止', hint: '开窗即开始，到具体时间结束（如海捞·暗标段）', startAnchor: 'window_open', endAnchor: 'absolute' },
  { id: 'B', label: 'B 到点起 · 随关窗止', hint: '到具体时间才开始，随关窗结束（如海捞·明标段）', startAnchor: 'absolute', endAnchor: 'window_close' },
  { id: 'C', label: 'C 随开窗起 · 随关窗止', hint: '全程跟着窗口（如消费中心整体）', startAnchor: 'window_open', endAnchor: 'window_close' },
  { id: 'none', label: '不限制（现状）', hint: '清空时段，只保留原有规则', startAnchor: 'none', endAnchor: 'none' },
];
