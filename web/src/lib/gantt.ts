// 甘特图几何（v6.49.0）：纯函数，无 React、无 Intl、无 DOM。
// 语义 = 把「运营时刻表」的行解析结果换算成 0..1 的横向分数，交给 components/GanttChart.tsx 用 viewBox 画静态 SVG。
// 刻度只算时间点，文案一律由组件走 useTimeFmt() 渲染（切时区偏好即同步）；日/周刻度的对齐偏移由 datetime.zoneOffsetMs 传入。

const H = 3600_000;
const DAY = 24 * H;

export const GANTT_PAD_MS = H; // 可视范围两侧各留 1h，避免条贴着边缘
export const GANTT_EMPTY_SPAN_MS = DAY; // 行上没有任何时间点（如窗口已关）：now ± 24h

export interface GanttTickStep {
  stepMs: number;
  kind: 'time' | 'day' | 'week';
}

/** 刻度粒度自适应：≤6h 每小时 / ≤48h 每 6h / ≤14d 每天 / 更长每周 */
export function pickTickStep(spanMs: number): GanttTickStep {
  if (spanMs <= 6 * H) return { stepMs: H, kind: 'time' };
  if (spanMs <= 48 * H) return { stepMs: 6 * H, kind: 'time' };
  if (spanMs <= 14 * DAY) return { stepMs: DAY, kind: 'day' };
  return { stepMs: 7 * DAY, kind: 'week' };
}

/** 时间点刻度之间的次刻度步长（只在 time 档画无标签的细线） */
export function minorStepOf(step: GanttTickStep): number | null {
  return step.kind === 'time' && step.stepMs > H ? H : null;
}

/**
 * 向下对齐到「显示时区的 stepMs 整数倍」。
 * offsetMs = 显示时区相对 UTC 的偏移（+8h）：墙钟 = 时间点 + offset，墙钟是 step 的整数倍即对齐，
 * 所以先加 offset 再取整、最后减回来（不校正就会把日期线画在北京时间早上 8 点）。
 */
export function alignFloor(ms: number, stepMs: number, offsetMs: number): number {
  return Math.floor((ms + offsetMs) / stepMs) * stepMs - offsetMs;
}

/** [fromMs, toMs] 区间内所有对齐刻度点（含两端内最近的） */
export function ticksIn(fromMs: number, toMs: number, stepMs: number, offsetMs: number): number[] {
  const out: number[] = [];
  if (stepMs <= 0 || toMs < fromMs) return out;
  for (let t = alignFloor(fromMs, stepMs, offsetMs); t <= toMs; t += stepMs) {
    if (t >= fromMs) out.push(t);
  }
  return out;
}

export interface GanttRange {
  from: number;
  to: number;
}

export interface GanttRangeRow {
  resolvedStartAt: string | null;
  resolvedEndAt: string | null;
}

export interface GanttRangeInput {
  now: number;
  windowOpenedAt: string | null;
  rows: readonly GanttRangeRow[];
}

/**
 * 可视范围：from = min(窗口 openedAt, 各行起点, now) − 1h，to = max(各行终点, now) + 1h。
 * 行上没有任何可用时间点（典型：窗口已关，随窗锚的行解析成 null）⇒ now ± 24h，至少能看到现在。
 */
export function ganttRange(input: GanttRangeInput): GanttRange {
  const pts: number[] = [input.now];
  const push = (iso: string | null): void => {
    if (!iso) return;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) pts.push(ms);
  };
  push(input.windowOpenedAt);
  for (const row of input.rows) {
    push(row.resolvedStartAt);
    push(row.resolvedEndAt);
  }
  if (pts.length === 1) {
    return { from: input.now - GANTT_EMPTY_SPAN_MS, to: input.now + GANTT_EMPTY_SPAN_MS };
  }
  const from = Math.min(...pts) - GANTT_PAD_MS;
  const to = Math.max(...pts) + GANTT_PAD_MS;
  return { from, to: to - from < GANTT_PAD_MS * 2 ? from + GANTT_PAD_MS * 2 : to };
}

/** 时间点 → 0..1 横向分数（越界钳制） */
export function fracOf(ms: number, range: GanttRange): number {
  const span = range.to - range.from;
  if (span <= 0) return 0;
  const f = (ms - range.from) / span;
  if (!Number.isFinite(f) || f < 0) return 0;
  return f > 1 ? 1 : f;
}

export type GanttRowBar =
  | { kind: 'none' } // 两端都不限制：满宽斜纹灰带
  | { kind: 'window_closed' } // 随窗锚，但当前没有开放窗口：满宽灰纹（窗口已关）
  | { kind: 'bar'; left: number; right: number; openEnded: boolean };

export interface GanttBarRow {
  startAnchor: string;
  endAnchor: string;
  resolvedStartAt: string | null;
  resolvedEndAt: string | null;
  endIsWindowClose: boolean;
}

/**
 * 一行 → 条几何。
 * openEnded = 终点动态（随关窗止 / 只限起点）：条画到右缘 + 虚线箭头标注，不假装有个具体终点。
 * 起点不限制但终点有具体时间 ⇒ 条从左缘起（「一直可用，到点结束」）。
 */
export function rowBar(row: GanttBarRow, range: GanttRange): GanttRowBar {
  if (row.startAnchor === 'none' && row.endAnchor === 'none') return { kind: 'none' };
  const sMs = row.resolvedStartAt ? Date.parse(row.resolvedStartAt) : Number.NaN;
  const eMs = row.resolvedEndAt ? Date.parse(row.resolvedEndAt) : Number.NaN;
  const hasS = Number.isFinite(sMs);
  const hasE = Number.isFinite(eMs);
  if (!hasS && !hasE) return { kind: 'window_closed' };
  const left = hasS ? fracOf(sMs, range) : 0;
  const right = hasE ? fracOf(eMs, range) : 1;
  return {
    kind: 'bar',
    left: Math.min(left, right),
    right: Math.max(left, right),
    openEnded: !hasE,
  };
}

/** 当前时刻线的分数（画「现在」那条竖线） */
export function nowFrac(range: GanttRange, now: number): number {
  return fracOf(now, range);
}
